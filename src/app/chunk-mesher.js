/* src/app/chunk-mesher.js · 体素分块烘焙（表现层）
   从 main.js 抽出：AO、三 pass 几何（固体/液体/玻璃）、日照与块光混色、makeChunk。
   依赖 world 与材质；不写权威状态（烧火块的随机色只影响顶点色）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  G.ChunkMesher = {
    create: function (deps) {
      var atlas = deps.atlas, materials = deps.materials, group = deps.group;
    var AXES = ['x', 'y', 'z'];
    function cornerAO(w, bx, by, bz, dir, c) {
      var t1 = -1, t2 = -1;
      for (var a = 0; a < 3; a++) if (dir[a] === 0) { if (t1 < 0) t1 = a; else t2 = a; }
      if (t1 < 0 || t2 < 0) return 1;
      var p = [bx, by, bz];
      var s1 = c[t1] === 1 ? 1 : -1, s2 = c[t2] === 1 ? 1 : -1;
      var o1 = [0, 0, 0], o2 = [0, 0, 0], o3 = [0, 0, 0];
      o1[t1] = s1; o2[t2] = s2; o3[t1] = s1; o3[t2] = s2;
      var solid = function (o) {
        var gx = bx + dir[0] + o[0], gy = by + dir[1] + o[1], gz = bz + dir[2] + o[2];
        if (gx < 0 || gy < 0 || gz < 0 || gx >= w.SX || gy >= w.SY || gz >= w.SZ) return 0;
        var id = w.blocks[(gy * w.SZ + gz) * w.SX + gx];
        return (id && DEFS[id].opaque) ? 1 : 0;
      };
      var k = solid(o1) + solid(o2) + solid(o3);
      return 1 - 0.155 * k;
    }
    // pass: 'solid' 不透明固体 | 'liquid' 液体（面压到 0.86 高）| 'glass' 固体但看穿（冰）
    // 三个 pass 各一份几何、各自材质；旧版只有两个分支且 solid 分支把 opaque:false 的方块整个跳过，冰因此一帧都不画。
    function buildChunkGeometry(w, cx, cz, pass) {
      var pos = [], nor = [], uvs = [], col = [], ind = [];
      var T = atlas.size, PR = atlas.perRow;
      var x0 = cx * G.CHUNK, z0 = cz * G.CHUNK;
      var x1 = Math.min(x0 + G.CHUNK, w.SX), z1 = Math.min(z0 + G.CHUNK, w.SZ);
      var invW = 1 / (T * PR), invH = 1 / (T * 4);
      var faces = G.FACES;
      var yr = w.chunkYRange(cx, cz);
      /* 块光光场：一个 chunk 算一次（三个 pass 共用缓存）。没有光源的世界直接返回 null，
         于是下面那条通路整个跳过 —— 常态下这条改动对帧率零影响。 */
      var lf = G.LIGHT.on ? w.lightField(cx, cz) : null;
      var LV = G.LIGHT.levels;
      for (var y = yr[0]; y <= yr[1]; y++) for (var z = z0; z < z1; z++) for (var x = x0; x < x1; x++) {
        var id = w.get(x, y, z); if (!id) continue;
        var d = DEFS[id];
        // 归类：液体→liquid，固体但不遮光（冰）→glass，其余固体→solid
        var want = pass === 'liquid' ? (!d.solid && d.liquid)
                 : pass === 'glass'  ? (d.solid && !d.opaque)
                 : (d.solid && d.opaque);
        if (!want) continue;
        for (var f = 0; f < 6; f++) {
          var face = faces[f];
          var nb = w.get(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          if (nb === id) continue;                      // 同种方块之间不画内部面（冰壳/水面靠这条才不像一整块实心）
          if (nb && DEFS[nb].opaque) continue;          // 被不透明邻居挡死的面看不见，省掉
          /* 半透明与另一种半透明相邻时，**只让一侧**生成交界面。两边都画就是两张共面的面片：
             相机一动，深度比较在相等边缘来回翻转，肉眼看到的就是"半透明方块之间一闪一闪"。
             规则（各 pass 只判自己这一侧）：
               · 液体（水/岩浆）贴着任何 solid（冰/石头）→ 不画，交界面由 solid 那侧的 glass/solid pass 画；
               · 两种液体相邻（水贴岩浆）→ 只让 id 大的那侧画（岩浆 id 11 > 水 8），水面不生成；
               · 玻璃（冰）贴着液体 → 保留，另一侧已在上面被挡掉。
             这一条只影响透明 pass；不透明 solid 的既有剔除原样保留。 */
          if (pass === 'liquid' && nb && DEFS[nb].solid) continue;
          if (pass === 'liquid' && nb && DEFS[nb].liquid && id < nb) continue;
          var ndx = pos.length / 3;
          var ti = d.tiles[face.tile === 'top' ? 0 : (face.tile === 'bottom' ? 2 : 1)];
          var tX = (ti % PR) * T, tY = Math.floor(ti / PR) * T;
          var m = w.meta.get(w.idx(x, y, z));
          /* 该不该打日照射线是**每个面**一个结论（朝向决定），提到面级，四个角共用；
             岩浆/以太晶/燃烧块本来就不吃环境光，跟着一起跳过。 */
          var sunFace = G.SHADOW.strength > 0 && !d.glow && id !== B.LAVA && !(m && m.kind === 'burning') &&
                        (face.dir[0] * G.SUN_DIR[0] + face.dir[1] * G.SUN_DIR[1] + face.dir[2] * G.SUN_DIR[2]) > 0.02;
          for (var c = 0; c < 4; c++) {
            var cr = face.corners[c];
            pos.push(x + cr[0], y + cr[1] * (pass === 'liquid' ? 0.86 : 1), z + cr[2]);
            nor.push(face.dir[0], face.dir[1], face.dir[2]);
            var hu = (c === 0 || c === 2) ? 0 : 1, hv = (c === 0 || c === 1) ? 1 : 0;
            uvs.push((tX + hu * (T - 0.05)) * invW, 1 - (tY + (1 - hv) * (T - 0.05)) * invH);
            var ao = cornerAO(w, x, y, z, face.dir, cr);
            var L = face.light * ao;
            /* 日照：从这一**角**沿太阳方向打射线（不是整面一个值），角与角之间再由插值过渡，
               才有 Minecraft 那种柔和的树荫边界。面级已经筛过朝向与发光方块。 */
            if (sunFace) {
              var vy = cr[1] * (pass === 'liquid' ? 0.86 : 1);
              var sv = w.sunVis(x + cr[0] + face.dir[0] * G.SHADOW.bias,
                                y + vy + face.dir[1] * G.SHADOW.bias,
                                z + cr[2] + face.dir[2] * G.SHADOW.bias);
              if (sv < 1) L *= 1 - G.SHADOW.strength * (1 - sv);
            }
            var rr, gg, bb;
            if (m && m.kind === 'burning') { rr = 1; gg = 0.5 + Math.random() * 0.3; bb = 0.25; }
            else if (id === B.LAVA) { rr = 1; gg = 0.72; bb = 0.32; }
            else if (id === B.WATER) { var dep = Math.max(0, Math.min(1, (w.sea - y) / 8)); rr = (0.5 * L + 0.3) * (1 - dep * 0.35); gg = (0.66 * L + 0.26) * (1 - dep * 0.3); bb = (0.98 * L + 0.24) * (1 - dep * 0.12); }
            else if (d.glow) { rr = 0.92; gg = 0.64; bb = 1; }
            else if (!d.opaque) { var gb = 0.58 + 0.42 * L; rr = 0.93 * gb; gg = 0.985 * gb; bb = gb; }   // 冰：接近白但偏冷，压住"埋进雾里"的倾向
            else { rr = L; gg = L; bb = L; }
            /* 块光：把这格附近的光源（岩浆 / 火 / 以太晶）叠进顶点色。
               光源自己那几格上面已经给了固定亮色，这里跳过，否则火会白成一团、看不出是火。 */
            if (lf && !d.glow && id !== B.LAVA && !(m && m.kind === 'burning')) {
              var vy2 = cr[1] * (pass === 'liquid' ? 0.86 : 1);
              var lv = lf.get(Math.floor(x + cr[0] + face.dir[0] * 0.5),
                               Math.floor(y + vy2 + face.dir[1] * 0.5),
                               Math.floor(z + cr[2] + face.dir[2] * 0.5));
              if (lv <= 0) lv = lf.get(Math.floor(x + 0.5 + face.dir[0] * 0.6),
                                       Math.floor(y + 0.5 + face.dir[1] * 0.6),
                                       Math.floor(z + 0.5 + face.dir[2] * 0.6));   // 角点落进实心格时退回面心值
              if (lv > 0) {
                /* 加光，不是乘光。乘光会让"已经被太阳照满"的面反而变暗（我先写的乘光版实测
                   紧邻岩浆的地面亮度从 1.00 掉到 0.938 —— 看着像火把地皮烤黑了）；
                   加光在日光下几乎看不出来（那本来就该看不出来），但在阴凉处/夜里就是决定性的。
                   每通道按光源色温加，所以加出来的光是暖的、不是白的。 */
                var kk = Math.min(1, lv / LV);
                var add = G.LIGHT.add * kk, warm = G.LIGHT.warm;
                rr += warm[0] * add; gg += warm[1] * add; bb += warm[2] * add;
                /* 背光面/夜里再加一层"顶替环境光"的抬升：加光在很暗的面上总量不够，
                   这里保证贴着火的地方一定亮得起来（maxMix 控制上限，不让它过曝成一张纸） */
                var lift = kk * G.LIGHT.maxMix;
                if (rr < warm[0] * lift) rr = warm[0] * lift;
                if (gg < warm[1] * lift) gg = warm[1] * lift;
                if (bb < warm[2] * lift) bb = warm[2] * lift;
              }
            }
            col.push(Math.min(1, rr), Math.min(1, gg), Math.min(1, bb));
          }
          ind.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
        }
      }
      if (!pos.length) return null;
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(ind);
      return g;
    }
    function makeChunk(w, cx, cz) {
      var g1 = buildChunkGeometry(w, cx, cz, 'solid'), g2 = buildChunkGeometry(w, cx, cz, 'liquid'), g3 = buildChunkGeometry(w, cx, cz, 'glass');
      var grp = new THREE.Group();
      if (g1) { var m = new THREE.Mesh(g1, materials.solid); m.castShadow = false; grp.add(m); }
      /* 半透明的画序（2026-10-20 重排，见 main.js 的 RENDER_ORDER 表）：
         VFX 暗底先写深度（10），彩线（11），冰（21）写深度，水（22）写深度。
         冰先于水：俯视冰湖时水在冰下，水后画会叠在冰上；反过来才会"冰压着水"。
         两者都写深度后，后画的透明面会被正确遮挡，不再靠固定 renderOrder 硬压——
         同一块透明面在相机移动时由深度比较决定前后，不会一闪一闪。 */
      if (g2) { var m2 = new THREE.Mesh(g2, materials.liquid); m2.renderOrder = 22; grp.add(m2); }
      if (g3) { var m3 = new THREE.Mesh(g3, materials.glass); m3.renderOrder = 21; grp.add(m3); }
      group.add(grp);
      return grp;
    }
  
      return { makeChunk: makeChunk, buildGeometry: buildChunkGeometry };
    }
  };
})(window.GW);
