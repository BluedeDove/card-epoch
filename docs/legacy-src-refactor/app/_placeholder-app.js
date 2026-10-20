/* ================= main =================
   引导 + 渲染 + 粒子 + 主循环 + 输入绑定。
   逻辑固定 20Hz 权威 tick，渲染与逻辑分离（学 Minecraft 的 tick/render 拆分）。
   ================================================= */
(function () {
  'use strict';
  var G = window.GW, B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  var STEP = 1 / 20;

  var canvas = document.getElementById('gl');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = false;

  var scene = new THREE.Scene();
  function skyTexture(topHex, botHex) {
    var cv = document.createElement('canvas'); cv.width = 4; cv.height = 128;
    var cg = cv.getContext('2d');
    var g = cg.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, topHex); g.addColorStop(0.62, botHex); g.addColorStop(1, botHex);
    cg.fillStyle = g; cg.fillRect(0, 0, 4, 128);
    var tx = new THREE.CanvasTexture(cv);
    tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearFilter;
    return tx;
  }
  var SKY = { day: skyTexture('#4d8fe0', '#bcdcf6'), night: skyTexture('#0b1030', '#26305a') };
  scene.background = SKY.day;
  scene.fog = new THREE.Fog(0x9ec9ff, 46, 150);

  var hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a4360, 0.85); scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff2d0, 0.75); sun.position.set(0.55, 1, 0.35); scene.add(sun);
  var ambient = new THREE.AmbientLight(0xffffff, 0.18); scene.add(ambient);

  var atlas = G.buildAtlas();
  var matSolid = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, side: THREE.FrontSide });
  var matLiquid = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.74, side: THREE.DoubleSide, depthWrite: false });

  var worldGroup = new THREE.Group(); scene.add(worldGroup);
  var entGroup = new THREE.Group(); scene.add(entGroup);
  var fxGroup = new THREE.Group(); scene.add(fxGroup);

  var S = { world: null, match: null, cams: [], sources: [], split: false, running: false, mode: 'train', cfg: null, helpOn: false, fps: 0 };
  window.GWAPP = S;

  /* ---------- 体素网格：分块烘焙，只重建脏块 ---------- */
  // 顶点级环境光遮蔽：角落比平面暗，体素立体感的关键
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
  function buildChunkGeometry(w, cx, cz, liquid) {
    var pos = [], nor = [], uvs = [], col = [], ind = [];
    var T = atlas.size, PR = atlas.perRow;
    var x0 = cx * G.CHUNK, z0 = cz * G.CHUNK;
    var x1 = Math.min(x0 + G.CHUNK, w.SX), z1 = Math.min(z0 + G.CHUNK, w.SZ);
    var invW = 1 / (T * PR), invH = 1 / (T * 4);
    var faces = G.FACES;
    var yr = w.chunkYRange(cx, cz);
    for (var y = yr[0]; y <= yr[1]; y++) for (var z = z0; z < z1; z++) for (var x = x0; x < x1; x++) {
      var id = w.get(x, y, z); if (!id) continue;
      var isLiquid = !DEFS[id].solid && DEFS[id].liquid;
      if (!!liquid !== isLiquid) continue;
      var d = DEFS[id];
      for (var f = 0; f < 6; f++) {
        var face = faces[f];
        var nb = w.get(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
        if (liquid) { if (nb === id) continue; if (nb && DEFS[nb].opaque) continue; }
        else { if (nb && DEFS[nb].opaque) continue; if (nb === id) continue; if (!d.opaque) continue; }
        var ndx = pos.length / 3;
        var ti = d.tiles[face.tile === 'top' ? 0 : (face.tile === 'bottom' ? 2 : 1)];
        var tX = (ti % PR) * T, tY = Math.floor(ti / PR) * T;
        for (var c = 0; c < 4; c++) {
          var cr = face.corners[c];
          pos.push(x + cr[0], y + cr[1] * (liquid ? 0.86 : 1), z + cr[2]);
          nor.push(face.dir[0], face.dir[1], face.dir[2]);
          var hu = (c === 0 || c === 2) ? 0 : 1, hv = (c === 0 || c === 1) ? 1 : 0;
          uvs.push((tX + hu * (T - 0.05)) * invW, 1 - (tY + (1 - hv) * (T - 0.05)) * invH);
          var ao = cornerAO(w, x, y, z, face.dir, cr);
          var L = face.light * ao;
          var m = w.meta.get(w.idx(x, y, z));
          if (m && m.kind === 'burning') col.push(1, 0.5 + Math.random() * 0.3, 0.25);
          else if (id === B.LAVA) col.push(1, 0.72, 0.32);
          else if (id === B.WATER) { var dep = Math.max(0, Math.min(1, (w.sea - y) / 8)); col.push((0.5 * L + 0.3) * (1 - dep * 0.35), (0.66 * L + 0.26) * (1 - dep * 0.3), (0.98 * L + 0.24) * (1 - dep * 0.12)); }
          else if (d.glow) col.push(0.92, 0.64, 1);
          else col.push(L, L, L);
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
  function makeChunk(cx, cz) {
    var w = S.world;
    var g1 = buildChunkGeometry(w, cx, cz, false), g2 = buildChunkGeometry(w, cx, cz, true);
    var grp = new THREE.Group();
    if (g1) { var m = new THREE.Mesh(g1, matSolid); m.castShadow = false; grp.add(m); }
    if (g2) { var m2 = new THREE.Mesh(g2, matLiquid); grp.add(m2); }
    worldGroup.add(grp);
    return grp;
  }
  function buildWorldMeshes() {
    while (worldGroup.children.length) { var c = worldGroup.children.pop(); c.traverse && c.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
    S.chunkMeshes = {};
    var w = S.world;
    for (var cz = 0; cz * G.CHUNK < w.SZ; cz++) for (var cx = 0; cx * G.CHUNK < w.SX; cx++) S.chunkMeshes[cx + ',' + cz] = makeChunk(cx, cz);
  }
  // 超出雾距的 chunk 不进绘制队列（真机上省下大量三角形）
  function cullFarChunks() {
    if (!S.world || !S.match) return;
    var p = S.match.players[0], far = (scene.fog ? scene.fog.far : 150) * 1.08;
    for (var k in S.chunkMeshes) {
      var pr = k.split(','), cx = pr[0] * G.CHUNK + G.CHUNK / 2, cz = pr[1] * G.CHUNK + G.CHUNK / 2;
      S.chunkMeshes[k].visible = Math.hypot(cx - p.pos.x, cz - p.pos.z) < far;
    }
  }
  function flushDirty(budget) {
    var w = S.world;
    if (!w.dirty || !w.dirty.size) return;
    var keys = Array.from(w.dirty).slice(0, budget || 2);
    for (var i = 0; i < keys.length; i++) {
      w.dirty.delete(keys[i]);
      var p = keys[i].split(','), cx = +p[0], cz = +p[1];
      if (cx < 0 || cz < 0) continue;
      var old = S.chunkMeshes[keys[i]];
      if (old) { worldGroup.remove(old); old.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
      if (cx * G.CHUNK >= w.SX || cz * G.CHUNK >= w.SZ) continue;
      S.chunkMeshes[keys[i]] = makeChunk(cx, cz);
    }
  }
  // world.set() 把脏块写进 world.dirty（Set），这里补上接口
  function patchWorldDirty() {
    var w = S.world;
    if (w._patched) return;
    w._patched = true;
    var orig = w.set.bind(w);
    w.set = function (x, y, z, id, extra) {
      var r = orig(x, y, z, id, extra);
      return r;
    };
  }

  /* ---------- 角色 / 随从 / 抛射物 的像素模型 ---------- */
  function pixelMat(hex) { return new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }); }
  function box(w2, h2, d2, hex, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, d2), pixelMat(hex));
    m.position.set(x, y, z); return m;
  }
  function makeHero(colorBody, colorLimb, colorHead) {
    var g = new THREE.Group();
    var head = box(0.62, 0.62, 0.62, '#2f2318', 0, 1.42, 0);
    var body = box(0.6, 0.78, 0.34, colorBody, 0, 0.72, 0);
    // 细描边：同一几何微微放大，避免糊成一整块黑板
    var ol = new THREE.MeshBasicMaterial({ color: 0x14122a, side: THREE.BackSide });
    var oh = new THREE.Mesh(head.geometry, ol); oh.scale.set(1.10, 1.10, 1.10); head.add(oh);
    var ob = new THREE.Mesh(body.geometry, ol); ob.scale.set(1.09, 1.08, 1.12); body.add(ob);
    var armL = box(0.2, 0.72, 0.2, colorLimb, -0.42, 0.75, 0), armR = box(0.2, 0.72, 0.2, colorLimb, 0.42, 0.75, 0);
    var legL = box(0.26, 0.8, 0.26, '#3a3550', -0.17, -0.02, 0), legR = box(0.26, 0.8, 0.26, '#3a3550', 0.17, -0.02, 0);
    g.add(head, body, armL, armR, legL, legR);
    // 头顶发色块：在越肩视角里帮自己分清左右
    // 脸贴在面朝方向那一侧（局部 -Z），后脑保留发色；越肩视角里不该看到一整块肤色
    var face = box(0.5, 0.44, 0.07, colorHead, 0, 1.38, -0.3);
    var eyeL = box(0.1, 0.1, 0.04, '#1a1626', -0.13, 1.46, -0.34), eyeR = box(0.1, 0.1, 0.04, '#1a1626', 0.13, 1.46, -0.34);
    var hair = box(0.64, 0.18, 0.64, '#231a12', 0, 1.77, 0);
    var scarf = box(0.66, 0.15, 0.42, colorBody, 0, 1.08, 0.02);
    g.add(hair, scarf, face, eyeL, eyeR);
    g.userData.parts = { head: head, armL: armL, armR: armR, legL: legL, legR: legR };
    // 肩上的卡牌（手持卡，可视化"出牌"）
    var cardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.04), pixelMat(colorLimb));
    cardMesh.position.set(0.46, 1.02, 0.18); cardMesh.rotation.set(0.2, -0.3, 0.1);
    g.add(cardMesh); g.userData.card = cardMesh;
    return g;
  }
  function makeNameTag(side) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 34;
    var tex = new THREE.CanvasTexture(cv);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(1.55, 0.42, 1);
    sp.userData = { cv: cv, tex: tex, side: side, lastHp: -1 };
    fxGroup.add(sp);
    return sp;
  }
  function updateNameTag(sp, e) {
    if (!sp) return;
    var hp = Math.max(0, Math.round(e.hp)), sh = Math.round(e.shield || 0);
    if (sp.userData.lastHp === hp + sh * 1000 + (e.alive ? 0 : 100000)) return;
    sp.userData.lastHp = hp + sh * 1000 + (e.alive ? 0 : 100000);
    var c = sp.userData.cv.getContext('2d');
    c.clearRect(0, 0, 128, 34);
    c.fillStyle = 'rgba(13,11,22,.78)'; c.fillRect(0, 0, 128, 34);
    c.strokeStyle = sp.userData.side === 0 ? '#35d0ff' : '#ff8a3d'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, 125, 31);
    c.font = 'bold 13px monospace'; c.textAlign = 'center'; c.fillStyle = '#ffd86b';
    c.fillText((e.name || '') + (sh > 0 ? ' 盾' + sh : ''), 64, 13);
    c.fillStyle = '#0a0813'; c.fillRect(8, 19, 112, 9);
    c.fillStyle = '#ff5f7a'; c.fillRect(8, 19, 112 * Math.max(0, Math.min(1, hp / e.maxHp)), 9);
    if (sh > 0) { c.fillStyle = '#7fd7ff'; c.fillRect(8, 19, 112 * Math.min(1, sh / 30), 3); }
    sp.userData.tex.needsUpdate = true;
  }
  function makeSummonMesh(e) {
    var g = new THREE.Group();
    if (e.aiKind === 'golem') {
      g.add(box(0.9, 1.1, 0.7, '#8b8b93', 0, 0.9, 0), box(0.6, 0.5, 0.5, '#7a7a82', 0, 1.6, 0), box(0.28, 0.9, 0.28, '#6f6f77', -0.62, 0.9, 0), box(0.28, 0.9, 0.28, '#6f6f77', 0.62, 0.9, 0));
      g.add(box(0.14, 0.14, 0.06, '#ff7a45', -0.14, 1.62, 0.26), box(0.14, 0.14, 0.06, '#ff7a45', 0.14, 1.62, 0.26));
    } else if (e.aiKind === 'dryad') {
      g.add(box(0.36, 1.3, 0.36, '#7a5230', 0, 0.65, 0), box(1.0, 0.7, 1.0, '#3f7d2c', 0, 1.6, 0), box(0.5, 0.4, 0.5, '#5aa832', 0, 2.05, 0));
    } else {
      var m = box(0.5, 0.5, 0.5, '#ff7a45', 0, 0.9, 0); g.add(m);
      g.add(box(0.24, 0.24, 0.24, '#ffe066', 0, 1.25, 0));
    }
    g.userData.born = true;
    return g;
  }
  var heroes = [], summonMeshes = [], projMeshes = [], projPool = [], heroMeshDirty = true;
  function ensureHeroMeshes() {
    for (var i = 0; i < 2; i++) {
      if (!heroes[i]) { heroes[i] = makeHero(i === 0 ? '#35d0ff' : '#ff8a3d', i === 0 ? '#1a7fb0' : '#b45318', '#f0d2a8'); entGroup.add(heroes[i]); heroes[i].userData.tag = makeNameTag(i); }
    }
  }

  /* ---------- 魔法阵网格：程序化法阵贴图 ---------- */
  var sigilTexCache = {};
  function sigilTexture(shape, color) {
    var key = shape + color;
    if (sigilTexCache[key]) return sigilTexCache[key];
    var S2 = 128, cv = document.createElement('canvas'); cv.width = cv.height = S2;
    var c = cv.getContext('2d');
    c.clearRect(0, 0, S2, S2);
    var grd = c.createRadialGradient(64, 64, 3, 64, 64, 60);
    grd.addColorStop(0, color); grd.addColorStop(0.45, color + 'aa'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.55; c.fillStyle = grd; c.beginPath(); c.arc(64, 64, 60, 0, 6.283); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 6;
    c.beginPath(); c.arc(64, 64, 58, 0, 6.283); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(64, 64, 46, 0, 6.283); c.stroke();
    c.beginPath(); c.arc(64, 64, 22, 0, 6.283); c.stroke();
    var n = shape === 'poly7' ? 7 : shape === 'poly6' ? 6 : shape === 'square' ? 4 : shape === 'triangle' ? 3 : shape === 'flower' ? 8 : 5;
    c.lineWidth = 2.4; c.beginPath();
    for (var i = 0; i <= n; i++) { var a = i / n * 6.283 - 1.57, r = 46; var x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.closePath(); c.stroke();
    for (var k = 0; k < n * 2; k++) { var a2 = k / (n * 2) * 6.283; c.globalAlpha = 0.55 + 0.45 * Math.sin(k * 2.1); c.beginPath(); c.arc(64 + Math.cos(a2) * 34, 64 + Math.sin(a2) * 34, 3.4, 0, 6.283); c.fill(); }
    c.globalAlpha = 1;
    for (var t2 = 0; t2 < 26; t2++) { var a3 = t2 / 26 * 6.283; c.fillRect(64 + Math.cos(a3) * 52 - 1, 64 + Math.sin(a3) * 52 - 1, 3, 3); }
    var tex = new THREE.CanvasTexture(cv);
    sigilTexCache[key] = tex; return tex;
  }
  function buildSigilMesh(s) {
    var tex = sigilTexture(s.preset.shape, s.preset.color);
    var g = new THREE.Group();
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(s.radius * 2.3, s.radius * 2.3),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2;
    g.add(ground);
    var beams = [];
    for (var i = 0; i < 2; i++) {
      var bm = new THREE.Mesh(new THREE.PlaneGeometry(s.radius * 1.9, 5.4),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
      bm.position.y = 2.7; bm.rotation.y = i * Math.PI / 2;
      g.add(bm); beams.push(bm);
    }
    g.userData.ground = ground; g.userData.beams = beams;
    return g;
  }
  function setSigilOpacity(mesh, v) {
    if (!mesh) return;
    if (mesh.userData.ground) {
      mesh.userData.ground.material.opacity = Math.min(1, v + 0.25);
      for (var i = 0; i < mesh.userData.beams.length; i++) mesh.userData.beams[i].material.opacity = v * 0.34;
    } else mesh.material.opacity = v;
  }
  var sigilMeshes = {};

  /* ---------- 粒子系统 ---------- */
  var MAXP = 900;
  var pGeo = new THREE.BufferGeometry();
  var pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  var pMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  var points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; fxGroup.add(points);
  var parts = [], pHead = 0;
  function emit(x, y, z, color, n, spd, grav) {
    var col = new THREE.Color(color);
    for (var i = 0; i < n; i++) {
      var idx = pHead++ % MAXP;
      parts[idx] = {
        x: x, y: y, z: z,
        vx: (Math.random() - .5) * spd, vy: Math.random() * spd * 0.8 + (grav === 0 ? 0 : spd * 0.25), vz: (Math.random() - .5) * spd,
        life: 0.5 + Math.random() * 0.7, grav: grav === undefined ? 14 : grav,
        r: col.r, g: col.g, b: col.b
      };
    }
  }
  function stepParticles(dt) {
    for (var i = 0; i < MAXP; i++) {
      var p = parts[i];
      if (!p) { pPos[i * 3] = 0; pPos[i * 3 + 1] = -999; pPos[i * 3 + 2] = 0; pCol[i * 3] = 0; pCol[i * 3 + 1] = 0; pCol[i * 3 + 2] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { parts[i] = null; pPos[i * 3 + 1] = -999; continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
      var f = Math.min(1, p.life * 1.6);
      pCol[i * 3] = p.r * f; pCol[i * 3 + 1] = p.g * f; pCol[i * 3 + 2] = p.b * f;
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  }

  /* ---------- 飘字（伤害数字） ---------- */
  var floats = [];
  function floatText(pos, txt, color) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 44;
    var c = cv.getContext('2d');
    c.font = 'bold 30px monospace'; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = '#000';
    c.strokeText(txt, 64, 32); c.fillStyle = color; c.fillText(txt, 64, 32);
    var tex = new THREE.CanvasTexture(cv);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(1.8, 0.62, 1); sp.position.set(pos.x, pos.y + 1.8, pos.z);
    fxGroup.add(sp);
    floats.push({ sp: sp, t: 0, vy: 1.9 });
  }
  function stepFloats(dt) {
    for (var i = floats.length - 1; i >= 0; i--) {
      var f = floats[i]; f.t += dt; f.sp.position.y += f.vy * dt; f.vy -= 3 * dt;
      f.sp.material.opacity = Math.max(0, 1 - f.t / 1.1);
      if (f.t > 1.1) { fxGroup.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); floats.splice(i, 1); }
    }
  }

  /* ---------- fx 桥接（给 Match / Rules 用） ---------- */
  var fx = {
    log: function (m, c) { G.HUD.log(m, c); },
    sfx: function (n) { G.Audio.play(n); },
    burst: function (p, color, n) { emit(p.x, p.y, p.z, color, Math.min(n || 12, 34), 5.5); },
    dust: function (x, y, z, color) { emit(x, y, z, color || '#c9d3e0', 8, 3); },
    hit: function (t, amount, kind) {
      floatText(t.pos, String(Math.round(amount)), kind === 'fire' ? '#ff9a5a' : kind === 'ice' ? '#a8e6ff' : kind === 'void' ? '#d3a8ff' : '#fff');
      emit(t.pos.x, t.pos.y + 1.1, t.pos.z, kind === 'fire' ? '#ff7a45' : '#ffffff', 10, 4);
      if (t.kind === 'player') { var cam = S.cams[t.side]; if (cam) cam.kick(Math.min(0.5, amount / 40)); }
    },
    heal: function (t) { floatText(t.pos, '+' + 4, '#7fd97f'); emit(t.pos.x, t.pos.y + 1, t.pos.z, '#7fd97f', 10, 3); },
    shieldUp: function (t) { floatText(t.pos, '盾', '#7fd7ff'); emit(t.pos.x, t.pos.y + 1, t.pos.z, '#7fd7ff', 12, 3); },
    fire: function (p) { emit(p.x, p.y + 1, p.z, '#ff7a45', 6, 3.2, 4); },
    ambient: function (biome, pos, rng) {
      var col = ['#c9d3e0', '#d9c88d', '#ffffff'][biome] || '#ffffff';
      var x = pos.x + (rng() - .5) * 26, z = pos.z + (rng() - .5) * 26, y = pos.y + 6 + rng() * 8;
      emit(x, y, z, col, 1, 0.6, -1.2);
    },
    requestCast: function (side, i) { castCard(side, i); }
  };

  /* ---------- 准星目标框 + 改造范围预览 ---------- */
  var selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)), new THREE.LineBasicMaterial({ color: 0xffd86b }));
  selBox.visible = false; fxGroup.add(selBox);
  var ghostGroup = new THREE.Group(); fxGroup.add(ghostGroup);
  var ghostMeshes = [];
  function ghost(n, hex) {
    while (ghostMeshes.length < n) {
      var ls = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
        new THREE.LineBasicMaterial({ color: 0xffd86b, transparent: true, opacity: 0.62, depthTest: false }));
      var fill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd86b, transparent: true, opacity: 0.07, depthWrite: false }));
      var grp = new THREE.Group(); grp.add(ls); grp.add(fill); grp.userData.ls = ls; grp.userData.fill = fill;
      ghostGroup.add(grp); ghostMeshes.push(grp);
    }
    for (var i = 0; i < ghostMeshes.length; i++) {
      ghostMeshes[i].visible = i < n;
      if (i < n && hex) { ghostMeshes[i].userData.ls.material.color.set(hex); ghostMeshes[i].userData.fill.material.color.set(hex); }
    }
  }

  /* ---------- 相机 ---------- */
  function aspectFor(side) {
    var W2 = window.innerWidth, H2 = window.innerHeight;
    return (S.split ? W2 / 2 : W2) / H2;
  }
  function camModePref() {
    try { var v = window.localStorage && localStorage.getItem('gw.camMode'); return G.CAM_MODES.indexOf(v) >= 0 ? v : 'shoulder'; } catch (err) { return 'shoulder'; }
  }
  function saveCamModePref(m) { try { if (window.localStorage) localStorage.setItem('gw.camMode', m); } catch (err) { } }
  function ensureCams() {
    var m = camModePref();
    for (var i = 0; i < 2; i++) {
      if (!S.cams[i]) S.cams[i] = new G.OTSCamera(aspectFor(i), { fov: 70, mode: i === 0 ? m : 'shoulder' });
      else if (i === 0) S.cams[i].setMode(m);
    }
  }
  /* C 键循环视角模式：只切本地视角（分屏下是 P1 的相机），P2 相机保持越肩 */
  function cycleCamMode() {
    if (!S.cams[0]) return;
    var m = S.cams[0].nextMode();
    saveCamModePref(m);
    G.HUD.toast('视角：' + S.cams[0].modeName(), '#ffd86b');
    G.HUD.log('视角切到 ' + S.cams[0].modeName() + '（按 C 循环：越肩 → 第一人称 → 越肩不画自己）', '#9d95c4');
    var el2 = document.getElementById('ui-cam'); if (el2) el2.textContent = S.cams[0].modeName();
  }

  /* ---------- 出牌 ---------- */
  function castCard(side, i) {
    if (!S.match) return;
    var idx = i === undefined ? G.HUD.sel[side] : i;
    var p = S.match.players[side];
    if (!p) return;
    S.ctx0 = S.ctx0 || S.match.ctx;
    S.match.ctx.aim = p.aim; S.match.ctx.aimTarget = p.aimTarget;
    if (!S.match.playCard(p, idx)) { G.Audio.play('deny'); }
    G.HUD.sel[side] = Math.min(G.HUD.sel[side], Math.max(0, p.hand.length - 1));
  }

  /* ---------- 目标瞄准（相机真实视轴定目标 → 玩家眼睛射线校验遮挡） ----------
     起点与方向都取自相机本帧的实际渲染结果（cam.aimOrigin / cam.dir），
     所以准星压在哪个格子，命中的就是那个格子；第一人称下两者天然重合。 */
  function updateAims() {
    for (var s = 0; s < 2; s++) {
      var p = S.match.players[s], cam = S.cams[s];
      if (!p || !cam) continue;
      var o = { x: cam.aimOrigin.x, y: cam.aimOrigin.y, z: cam.aimOrigin.z };
      var d = { x: cam.dir.x, y: cam.dir.y, z: cam.dir.z };
      S.match.updateAim(p, o, d);
      p.aimBlocked = false;
      if (p.aim && !p.aim.ent && !cam.isFirst()) {
        var eye = { x: p.pos.x, y: p.pos.y + 0.62, z: p.pos.z };   // 与相机 eyeH 同一个高度，两套校验不打架
        var tgt = { x: p.aim.x, y: p.aim.y, z: p.aim.z };
        var sdx = tgt.x - eye.x, sdy = tgt.y - eye.y, sdz = tgt.z - eye.z;
        var sLen = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) || 1;
        var step = { x: sdx / sLen, y: sdy / sLen, z: sdz / sLen };
        var st0 = { x: eye.x + step.x * 0.35, y: eye.y + step.y * 0.35, z: eye.z + step.z * 0.35 };
        var blk = S.world.raycast(st0, step, Math.max(0.1, sLen - 0.5), {});
        // 回退到挡视线的格子，但不回退到自己身体所在的那一格——否则准星信息会变成脚下的草地
        if (blk.hit && !(blk.x === p.aim.gx && blk.y === p.aim.gy && blk.z === p.aim.gz) &&
            !(blk.x === Math.floor(p.pos.x) && blk.z === Math.floor(p.pos.z) && Math.abs(blk.y - Math.floor(p.pos.y)) <= 1)) {
          p.aimBlocked = true;
          p.aim.x = blk.x + 0.5 + blk.face[0] * 0.5; p.aim.y = blk.y + 0.5 + blk.face[1] * 0.5; p.aim.z = blk.z + 0.5 + blk.face[2] * 0.5;
          p.aim.gx = blk.x; p.aim.gy = blk.y; p.aim.gz = blk.z;
          p.aimTarget = { x: blk.x, y: blk.y, z: blk.z, id: blk.id };
        }
      }
    }
    S.ctx0 = S.ctx0 || S.match.ctx;
    var p0 = S.match.players[0];
    if (p0) { S.match.ctx.aim = p0.aim; S.match.ctx.aimTarget = p0.aimTarget; }
  }

  /* ---------- 每帧视觉更新 ---------- */
  var shadowTex = (function () {
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var cg = cv.getContext('2d');
    var g = cg.createRadialGradient(32, 32, 3, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    cg.fillStyle = g; cg.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(cv); return t;
  })();
  function makeShadow() {
    var sp = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.6, depthWrite: false }));
    sp.rotation.x = -Math.PI / 2;
 fxGroup.add(sp); return sp;
  }
  function syncEntities(dt) {
    ensureHeroMeshes();
    for (var s = 0; s < 2; s++) {
      var p = S.match.players[s], h = heroes[s];
      if (!p || !h) continue;
      // 自己是否入画由 render 里按"这台相机"的 selfHidden 决定（分屏时对手仍然要看到我）
      h.visible = !!p.alive;
      if (h.userData.baseY === undefined) {
        var py0 = h.position.y; h.position.y = 0; h.updateMatrixWorld(true);
        var bb = new THREE.Box3().setFromObject(h); h.userData.baseY = bb.min.y;
        h.position.y = py0;
      }
      h.position.set(p.pos.x, p.pos.y - p.h / 2 - h.userData.baseY, p.pos.z);
      if (h.userData.tag) {
        var tg = h.userData.tag;
        tg.position.set(p.pos.x, p.pos.y + p.h / 2 + 0.6, p.pos.z);
        var camHere = S.cams[s];
        var dcam = camHere ? Math.hypot(tg.position.x - camHere.pos.x, tg.position.y - camHere.pos.y, tg.position.z - camHere.pos.z) : 99;
        tg.visible = !!p.alive && dcam > 3.4;          // 自己头上不挂名牌，贴脸也不闪
        if (tg.visible) updateNameTag(tg, p);
      }
      h.rotation.y = p.yaw + Math.PI;
      var moving = Math.abs(p.vel.x) + Math.abs(p.vel.z);
      var t = S.match.time * (moving > 0.6 ? 9 : 1.6);
      var sw = Math.min(1, moving / 4);
      var P = h.userData.parts;
      P.legL.rotation.x = Math.sin(t) * 0.9 * sw; P.legR.rotation.x = -Math.sin(t) * 0.9 * sw;
      P.armL.rotation.x = -Math.sin(t) * 0.7 * sw; P.armR.rotation.x = Math.sin(t) * 0.7 * sw;
      h.userData.card.visible = p.hand.length > 0;
      if (h.userData.card.visible) {
        var c = G.CARDS_BY_ID[p.hand[G.HUD.sel[s]]];
        if (c) h.userData.card.material.color.set(G.ELEMENTS[c.element].color);
      }
      if (!h.userData.shadow) h.userData.shadow = makeShadow();
      var gy = S.world.surfaceY(Math.floor(p.pos.x), Math.floor(p.pos.z)) + 0.03;
      h.userData.shadow.visible = !!p.alive;
      h.userData.shadow.position.set(p.pos.x, gy, p.pos.z);
    }
    // 随从
    for (var i = 0; i < S.match.summons.length; i++) {
      var e = S.match.summons[i];
      if (!e.mesh) { e.mesh = makeSummonMesh(e); entGroup.add(e.mesh); summonMeshes.push(e); }
      e.mesh.visible = !!e.alive;
      if (e.mesh.userData.baseY === undefined) {
        var py1 = e.mesh.position.y; e.mesh.position.y = 0; e.mesh.updateMatrixWorld(true);
        var bb2 = new THREE.Box3().setFromObject(e.mesh); e.mesh.userData.baseY = bb2.min.y;
        e.mesh.position.y = py1;
      }
      e.mesh.position.set(e.pos.x, e.pos.y - e.h / 2 - e.mesh.userData.baseY, e.pos.z);
      e.mesh.rotation.y = e.yaw + Math.PI;
      if (e.st.frozen > 0) e.mesh.material && (e.mesh.material.opacity = 1);
    }
    for (var j = summonMeshes.length - 1; j >= 0; j--) {
      var sm = summonMeshes[j];
      if (!sm.alive || S.match.summons.indexOf(sm) < 0) { entGroup.remove(sm.mesh); summonMeshes.splice(j, 1); }
    }
    // 抛射物
    for (var k = 0; k < S.match.projectiles.length; k++) {
      var pr = S.match.projectiles[k];
      if (!pr.mesh) {
        var m = projPool.pop();
        if (!m) { m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshBasicMaterial({ color: 0xffffff })); }
        m.material.color.set(pr.color || '#fff'); m.visible = true; pr.mesh = m; entGroup.add(m); projMeshes.push(pr);
      }
      pr.mesh.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      pr.mesh.rotation.x += dt * 8; pr.mesh.rotation.y += dt * 6;
    }
    for (var n = projMeshes.length - 1; n >= 0; n--) {
      var q = projMeshes[n];
      if (S.match.projectiles.indexOf(q) < 0) { entGroup.remove(q.mesh); projPool.push(q.mesh); q.mesh = null; projMeshes.splice(n, 1); }
    }
    // 法阵
    var seen = {};
    for (var g2 = 0; g2 < S.match.sigils.length; g2++) {
      var sg = S.match.sigils[g2];
      seen[g2] = 1;
      if (!sg.mesh) { sg.mesh = buildSigilMesh(sg); sg.mesh.userData.id = g2; fxGroup.add(sg.mesh); }
      var age = S.match.time - sg.born;
      sg.mesh.position.set(sg.pos.x, sg.pos.y + 0.04, sg.pos.z);
      sg.mesh.rotation.y += dt * (sg.active ? 1.4 : 0.45);
      var hidden = sg.preset.hidden && !sg.triggered;
      sg.mesh.visible = !hidden;
      var pulse = sg.active ? (0.62 + Math.sin(S.match.time * 9) * 0.3) : (0.16 + 0.35 * (age / Math.max(0.001, sg.delay)));
      setSigilOpacity(sg.mesh, pulse);
      if (sg.preset.once && sg.active && !sg.triggered) { sg.triggered = true; sg.mesh.visible = true; }
    }
    for (var key in sigilMeshes) { if (!seen[key]) { fxGroup.remove(sigilMeshes[key].mesh); delete sigilMeshes[key]; } }
    // 目标框与预览
    var p0 = S.match.players[0];
    if (p0 && p0.aimTarget) {
      selBox.visible = true;
      selBox.position.set(p0.aimTarget.x + 0.5, p0.aimTarget.y + 0.5, p0.aimTarget.z + 0.5);
    } else selBox.visible = false;
    var card = p0 && G.CARDS_BY_ID[p0.hand[G.HUD.sel[0]]];
    if (card && card.type === 'terrain' && p0.aim) {
      S.match.ctx.aim = p0.aim; S.match.ctx.aimTarget = p0.aimTarget;
      var cells = [];
      for (var e2 = 0; e2 < card.effects.length; e2++) if (card.effects[e2].op === 'setBlock') cells = G.Rules.cellsFor(card.effects[e2], card, p0, S.match.ctx);
      var eraseMode = false, fillMode = false;
      for (var ez = 0; ez < card.effects.length; ez++) { var efx = card.effects[ez]; if (efx.op !== 'setBlock') continue; if (efx.mode === 'erase') eraseMode = true; else fillMode = true; }
      ghost(cells.length, eraseMode && !fillMode ? '#ff5f7a' : (fillMode && !eraseMode ? '#7fd97f' : '#ffd86b'));
      for (var c3 = 0; c3 < cells.length; c3++) ghostMeshes[c3].position.set(cells[c3].x + 0.5, cells[c3].y + 0.5, cells[c3].z + 0.5);
      G.HUD.aimInfo('◇ ' + card.name + ' · 将改造 ' + cells.length + ' 格（上限 ' + G.Rules.MAX_TERRAIN_CELLS + '）' + (p0.aimBlocked ? ' · 视线被挡' : ''), true);
    } else if (card && card.type === 'sigil') {
      ghost(0);
      var pr2 = G.SIGILS[card.id];
      G.HUD.aimInfo('◎ ' + card.name + ' · 法阵半径 ' + (pr2 ? pr2.radius : 2.5) + ' · 延时 ' + (card.effects[0] ? card.effects[0].delay : 1) + 's', true);
    } else {
      ghost(0);
      if (p0 && p0.aim) {
        var bn = p0.aimTarget ? (DEFS[p0.aimTarget.id] ? DEFS[p0.aimTarget.id].cn : '?') : '空地';
        G.HUD.aimInfo('◎ ' + bn + ' (' + (p0.aim.gx !== undefined ? (p0.aim.gx + ',' + p0.aim.gy + ',' + p0.aim.gz) : '—') + ')' + (p0.aimBlocked ? ' · 视线被挡（命中点已回退）' : ''), !!p0.aimTarget);
      } else G.HUD.aimInfo('', false);
    }
  }

  /* ---------- 昼夜 ---------- */
  function dayNight() {
    var d = (S.match.dayT % S.match.dayLen) / S.match.dayLen;
    var sunA = Math.max(0, Math.sin(d * Math.PI * 2));
    var night = d > 0.6;
    var sky = new THREE.Color(0x9ec9ff).lerp(new THREE.Color(0x141228), night ? 0.86 : (d > 0.5 ? (d - 0.5) / 0.1 : 0));
    scene.background = night ? SKY.night : SKY.day;
    scene.fog.color = sky;
    sun.intensity = 0.25 + sunA * 0.6; hemi.intensity = night ? 0.32 : 0.85;
    var bm = S.world.biomeAt(Math.floor(S.match.players[0].pos.x), Math.floor(S.match.players[0].pos.z));
    var fogFar = [150, 130, 112][bm] || 150;
    scene.fog.near = fogFar * 0.3; scene.fog.far = fogFar;
  }

  /* ---------- 渲染 ----------
     "自己不入画"必须逐相机决定：越肩时 P1 自己的身体挡住自己的准星要隐藏，
     但这具身体在 P2 的画面里是对手，不能跟着消失。 */
  /* 谁挡准星就只藏谁：躯干/头 → 整具不画；只有腿 → 只藏腿；只有手臂或肩上那张牌 → 只画到肩。
     分屏时逐相机调用（每台相机自己的 selfHidden/legsHidden/propsHidden），画完再复原，
     这样 P1 藏起来的身体在 P2 的画面里仍然是对手，不会跟着消失。 */
  function setSelfVisible(side, on, propsOn, legsOn) {
    var h = heroes[side], p = S.match && S.match.players[side];
    if (!h || !p) return;
    h.visible = !!p.alive && on;
    if (h.userData.shadow) h.userData.shadow.visible = !!p.alive && on;
    if (on) {
      var P = h.userData.parts || {}, card = h.userData.card;
      var props = propsOn !== false, legs = legsOn !== false;
      if (P.armL) P.armL.visible = props;
      if (P.armR) P.armR.visible = props;
      if (card) card.visible = props && p.hand.length > 0;
      if (P.legL) P.legL.visible = legs;
      if (P.legR) P.legR.visible = legs;
    }
  }
  /* 把"自己"按部件给出世界 AABB，交给相机判断谁压住准星。
     core：头、躯干、后脑、发、围巾、五官；legs：两条腿；props：两条手臂 + 肩上那张牌。
     分组的意义：只藏真正挡视线的那部分，而不是整具身体一蹭到边界就全抹掉
     （上一版用整具包围盒判，斜着站时盒宽被放大、竖直跨从头到脚，镜头一压低角色就凭空消失）。
     每帧用部件自己的 matrixWorld 量，走路摆臂、描边子网格都算进去。 */
  function heroGroups(side) {
    var h = heroes[side]; if (!h) return null;
    var P = h.userData.parts || {}, card = h.userData.card;
    var out = { core: [], legs: [], props: [] };
    h.updateMatrixWorld(true);
    h.children.forEach(function (m) {
      if (!m.isMesh) return;
      // 手臂与肩上那张牌最常伸到准星前面，单独一组；腿一组；其余（头、躯干、发、围巾、五官）算躯干
      var g = 'core';
      if (m === P.armL || m === P.armR || m === card) g = 'props';
      else if (m === P.legL || m === P.legR) g = 'legs';
      if (!m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      var b = new THREE.Box3().copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);   // 含自身旋转
      if (b.isEmpty()) return;
      out[g].push({ min: b.min.clone(), max: b.max.clone() });
      m.children.forEach(function (o) {                // 描边子节点并到同一组
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        var ob = new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (!ob.isEmpty()) out[g].push({ min: ob.min.clone(), max: ob.max.clone() });
      });
    });
    return out;
  }
  function render() {
    var W2 = window.innerWidth, H2 = window.innerHeight;
    if (S.split) {
      renderer.setScissorTest(true);
      for (var s = 0; s < 2; s++) {
        var x0 = s * (W2 / 2);
        renderer.setViewport(x0, 0, W2 / 2, H2);
        renderer.setScissor(x0, 0, W2 / 2, H2);
        var cs = S.cams[s];
        setSelfVisible(s, !cs || !cs.selfHidden,
          !cs || !(cs.selfHidden || cs.propsHidden), !cs || !(cs.selfHidden || cs.legsHidden));
        renderer.render(scene, S.cams[s].cam);
      }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W2, H2);
      for (var r2 = 0; r2 < 2; r2++) setSelfVisible(r2, true, true, true);
    } else {
      renderer.setViewport(0, 0, W2, H2);
      var c0v = S.cams[0];
      setSelfVisible(0, !c0v || !c0v.selfHidden,
        !c0v || !(c0v.selfHidden || c0v.propsHidden), !c0v || !(c0v.selfHidden || c0v.legsHidden));
      renderer.render(scene, S.cams[0].cam);
      setSelfVisible(0, true, true, true);
    }
  }

  /* ---------- 主循环 ---------- */
  var acc = 0, last = 0, hudT = 0, fpsT = 0, fpsN = 0, cullT = 0;
  /* 每渲染帧取走一次转向输入。apply=false 用于暂停/结算画面：仍然清空累加器，
     否则暂停时移动过的鼠标会在恢复瞬间一次性灌进来，视角猛地一甩。 */
  function consumeLook(dt, apply) {
    if (!S.match || !S.sources) return;
    for (var s3 = 0; s3 < S.sources.length; s3++) {
      var srcL = S.sources[s3], pL = S.match.players[s3];
      if (!srcL || !pL || typeof srcL.flushLook !== 'function') continue;   // AI 源没有 flushLook，它的 lookYaw 走 tick
      var lk = srcL.flushLook(dt);
      if (apply && (lk.lookYaw || lk.lookPitch)) S.match.applyLook(pL, lk.lookYaw, lk.lookPitch);
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!S.running || !S.match) return;
    var dt = Math.min(0.12, (now - last) / 1000 || 0); last = now;
    if (S.overPause) { consumeLook(dt, false); renderHudOnly(dt); return; }
    acc += dt;
    var guard = 0, stepFailed = false;
    while (acc >= STEP && guard++ < 6) {
      var inputs = [];
      for (var i = 0; i < S.sources.length; i++) inputs.push(S.sources[i] ? S.sources[i].poll(STEP) : G.blankInput());
      try {
        S.match.step(STEP, inputs);
      } catch (err) {
        // 一个坏 tick 不能带走整个游戏：以前这里抛出去，渲染/瞄准/输入全停，画面永久定在出错那一帧
        stepFailed = true;
        S.stepErrors = (S.stepErrors || 0) + 1;
        S.lastError = String((err && err.stack) || err);
        if (S.stepErrors === 1 || S.stepErrors % 60 === 0) {
          console.error('[GW] Match.step 异常（已拦截，本帧跳过）', err);
          try { G.HUD.log('逻辑异常已拦截：' + (err && err.message || err) + '（本帧跳过，若反复出现请按 R 重开）', '#ff9f9f'); } catch (e2) { }
        }
        acc = 0;
        break;
      }
      if (S.match.over && !S.overPause) onMatchOver();
      acc -= STEP;
    }
    S.stepHealthy = !stepFailed;
    // 转向按渲染帧消费：鼠标是连续输入，只在 1/20s 的 tick 里取会让视角每几个渲染帧
    // 才跳一次（真机 160FPS 约 8 帧一跳、单跳近 10°），手感就是"画面不动、猛地一拽"。
    consumeLook(dt, true);
    // 先摆相机，再用相机本帧的真实视轴算瞄准：准星高亮与画面同一帧，转身时不差一帧
    for (var s2 = 0; s2 < 2; s2++) {
      var cam = S.cams[s2], p = S.match.players[s2];
      if (!cam || !p) continue;
      cam.update(p, S.world, dt, heroGroups(s2));
    }
    updateAims();
    syncEntities(dt);
    stepParticles(dt); stepFloats(dt); flushDirty(2); dayNight();
    cullT += dt; if (cullT > 0.3) { cullT = 0; cullFarChunks(); }
    render();
    hudT += dt; if (hudT > 0.06) { hudT = 0; G.HUD.update(S.match, S.split); G.HUD.fps(S.fps); }
    G.HUD.tickTimers(dt);
    fpsN++; fpsT += dt; if (fpsT >= 1) { S.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  }

  function renderHudOnly(dt) { G.HUD.tickTimers(dt); stepParticles(dt); stepFloats(dt); render(); }

  /* ---------- 开始 / 结束 ---------- */
  function start(cfg) {
    cfg = cfg || {};
    S.mode = cfg.mode || 'train';
    S.split = S.mode === 'split';
    S.cfg = cfg;
    var seed = (cfg.seed === undefined || cfg.seed === '') ? Math.floor(Math.random() * 999999) : (parseInt(cfg.seed, 10) >>> 0);
    if (isNaN(seed)) seed = hashStr(String(cfg.seed));
    S.world = new G.World({ size: [96, 40, 96], seed: cfg.load && cfg.load.seed !== undefined ? cfg.load.seed : seed });
    S.world.generate();
    S.world.snapshotBaseline();
    if (cfg.load) {
      var ap = G.Save.applyTo(S.world, cfg.load);
      seed = S.world.seed;
      if (ctxReady()) ctxReady().log(ap.ok ? ('已载入存档：' + ap.cells + ' 格变更（种子 ' + seed + '）') : ('存档导入失败：' + ap.reason), ap.ok ? '#7fd97f' : '#ff9f9f');
    }
    patchWorldDirty();
    buildWorldMeshes();
    var decks = [makeDeck(cfg.deck || 'starter'), makeDeck(cfg.oppDeck || (S.mode === 'train' ? pick('random') : cfg.deck || 'starter'))];
    S.match = new G.Match({
      world: S.world, seed: seed, mode: S.mode, fx: fx, lives: 2,
      players: 2, cards: decks, names: S.split ? ['P1 红方', 'P2 蓝方'] : ['你', 'AI 对手']
    });
    ensureCams();
    // 机位三个跟随通道由 snapToTarget 统一落到目标值并清速度；不要在这里直接写 curRadius，
    // 那会绕过通道写状态（cam.pos 必须是 eyeBase/yaw/半径/侧移/抬升 的纯函数）
    for (var i = 0; i < 2; i++) if (S.cams[i] && S.cams[i].snapToTarget) S.cams[i].snapToTarget();
    S.sources = [];
    S.sources.push(new G.Net.KeyboardSource({
      fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space',
      lookL: 'KeyQ', lookR: 'KeyE', lookU: 'KeyF', lookD: 'KeyV',
      cast: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']
    }, { mouseLook: true }));
    if (S.mode === 'split') {
      S.sources.push(new G.Net.KeyboardSource({
        fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight',
        lookL: 'BracketLeft', lookR: 'BracketRight', lookU: 'BracketLeft', lookD: 'BracketRight', jump2: 'Enter',
        cast: ['KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5']
      }, { mouseLook: false }));
    } else if (S.mode === 'train') {
      S.sources.push(new G.Net.AISource(S.match, 1, cfg.level || 1));
    }
    // 分屏时 P2 视角自动锁向对手（键盘转向不够用）
    if (S.mode === 'split') S.autoFace = true; else S.autoFace = false;
    G.HUD.hideMenu(); G.HUD.hideResult(); G.HUD.setSplit(S.split);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var lh0 = document.getElementById('lockHint'); if (lh0) { lh0.classList.add('on'); clearTimeout(S.hintTimer); S.hintTimer = setTimeout(function () { lh0.classList.remove('on'); }, 7000); }
    G.HUD.sel = [0, 0];
    S.overPause = false; S.running = true; last = performance.now(); acc = 0;
    G.HUD.log('世界已生成：seed ' + seed + '（' + S.world.SX + '×' + S.world.SY + '×' + S.world.SZ + ' 格，' + (S.split ? '分屏 PVP' : '训练 vs AI') + '）', '#ffd86b');
    G.HUD.log('移动不消耗卡牌；其余操作全部靠出牌。按 H 看操作。', '#9d95c4');
  }
  function pick(a) { return a === 'random' ? 'random' : a; }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function makeDeck(kind) {
    if (kind === 'starter' || !kind) return G.STARTER_DECK.slice();
    var pool = G.CARDS.filter(function (c) { return kind === 'random' ? true : c.element === kind; });
    if (!pool.length) return G.STARTER_DECK.slice();
    var rnd = G.mulberry32(hashStr(kind) ^ (S.cfg && S.cfg.seed ? parseInt(S.cfg.seed, 10) : 12345));
    var out = [];
    for (var i = 0; i < 20; i++) out.push(pool[Math.floor(rnd() * pool.length)].id);
    if (kind !== 'random') { out.push('strike', 'dig', 'place', 'draw1'); }
    return out;
  }
  function onMatchOver() {
    S.overPause = true;
    var o = S.match.over;
    var kv = [
      ['胜者', o.name], ['用时', o.time.toFixed(1) + ' 秒'], ['tick 数', o.ticks],
      ['P1 击杀', S.match.players[0].kills], ['P2 击杀', S.match.players[1].kills],
      ['P1 剩余生命', S.match.players[0].lives], ['P2 剩余生命', S.match.players[1].lives],
      ['seed', S.match.seed], ['改造上限', G.Rules.MAX_TERRAIN_CELLS + ' 格/卡']
    ].map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('');
    document.getElementById('resKv').innerHTML = kv;
    document.getElementById('resTitle').textContent = (S.mode === 'train') ? (o.winner === 0 ? '你赢了' : '你输了') : (o.name + ' 获胜');
    var fd = document.getElementById('fade'); fd.classList.add('on');
    setTimeout(function () { fd.classList.remove('on'); G.HUD.showResult(); }, 260);
  }

  /* ---------- 输入：全局键 ---------- */
  window.addEventListener('keydown', function (ev) {
    if (ev.code === 'Tab') {
      ev.preventDefault();
      var qp = S.match && S.match.players[0];
      if (qp && qp.hand.length) { G.HUD.sel[0] = (G.HUD.sel[0] + 1) % qp.hand.length; G.HUD.invalidate(); }
    }
    else if (ev.code === 'KeyT') { setSplit(!S.split); }
    else if (ev.code === 'KeyC') { cycleCamMode(); }
    else if (ev.code === 'KeyH') { S.helpOn = !S.helpOn; document.getElementById('help').style.display = S.helpOn ? 'block' : 'none'; }
    else if (ev.code === 'KeyM') { var on = G.Audio.toggle(); G.HUD.toast(on ? '声音：开' : '声音：静音', '#9d95c4'); }
    else if (ev.code === 'KeyR') { start(S.cfg || { mode: S.mode }); }
    else if (ev.code === 'F3') { ev.preventDefault(); var lv = [1, 0.75, 0.55], i = lv.indexOf(S.renderScale || 1); S.renderScale = lv[(i + 1) % lv.length]; renderer.setPixelRatio(S.renderScale * Math.min(window.devicePixelRatio || 1, 1.5)); renderer.setSize(window.innerWidth, window.innerHeight, false); G.HUD.toast('渲染分辨率 ' + Math.round(S.renderScale * 100) + '%（F3 再按切换）', '#9d95c4'); }
    else if (ev.code === 'F9') {
      ev.preventDefault();
      if (!S.match) return;
      if (ev.ctrlKey) { var box = document.getElementById('saveBox'); if (box) box.value = G.Save.toText(G.Save.exportFrom(S.world, S.match)); G.HUD.toast('已导出到菜单文本框', '#ffd86b'); }
      else { var ok = G.Save.localSave(G.Save.exportFrom(S.world, S.match)); G.HUD.toast(ok ? '本局已存到本地（菜单里可读取）' : '本地存储不可用', ok ? '#7fd97f' : '#ff9f9f'); }
    }
    else if (ev.code === 'Escape') { if (document.pointerLockElement) document.exitPointerLock(); }
    else if (ev.code === 'Space' && !S.running) ev.preventDefault();
  });
  window.addEventListener('wheel', function (ev) {
    if (!S.running) return;
    var p = S.match.players[0]; if (!p || !p.hand.length) return;
    var n = p.hand.length;
    G.HUD.sel[0] = ((G.HUD.sel[0] + (ev.deltaY > 0 ? 1 : -1)) % n + n) % n;
    G.HUD.invalidate();
  }, { passive: true });
  canvas.addEventListener('mousedown', function (ev) {
    if (!S.running) return;
    G.Audio.resume();
    if (!document.pointerLockElement && !S.split) { canvas.requestPointerLock(); return; }   // 第一次点击只锁鼠标，不误出牌
    if (ev.button === 0) castCard(0, undefined);
    else if (ev.button === 2) { var p = S.match.players[0]; if (p) { var n = p.hand.length; G.HUD.sel[0] = (G.HUD.sel[0] + 1) % Math.max(1, n); G.HUD.invalidate(); } }
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('pointerlockchange', function () {
    G.pointerLocked = !!document.pointerLockElement;
    var lh = document.getElementById('lockHint');
    if (lh && G.pointerLocked) lh.classList.remove('on');
    else if (lh && S.running && !S.split && !S.overPause) lh.classList.add('on');
  });
  window.addEventListener('resize', function () {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    for (var i = 0; i < 2; i++) if (S.cams[i]) S.cams[i].resize(aspectFor(i));
  });

  function setSplit(on) {
    if (!S.match) return;
    S.split = on;
    S.mode = on ? 'split' : 'train';
    S.autoFace = on;                     // 分屏下 P2 只用 , . 微调，主转向自动锁向对手
    if (S.match) S.match.mode = S.mode;
    S.sources = [S.sources[0]];
    if (on) S.sources.push(new G.Net.KeyboardSource({
      fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight',
      lookL: 'BracketLeft', lookR: 'BracketRight', lookU: 'BracketLeft', lookD: 'BracketRight', jump2: 'Enter',
      cast: ['KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5']
    }, { mouseLook: false }));
    else S.sources.push(new G.Net.AISource(S.match, 1, 1));
    G.HUD.setSplit(on);
    if (window.__layoutSplit) window.__layoutSplit(on);
    G.HUD.log(on ? '已切换：同屏分屏双人 PVP' : '已切换：单人训练（对手 AI）', '#ffd86b');
  }
  // 分屏下 P2 自动朝向对手（键盘转向太重，保留微调）
  var _step = null;
  function autoFacePatch() {
    if (!S.autoFace || !S.match) return;
    var p2 = S.match.players[1], p1 = S.match.players[0];
    if (!p2 || !p1 || !p2.alive) return;
    if (window.__p2Manual) return;
    var want = Math.atan2(p1.pos.x - p2.pos.x, p1.pos.z - p2.pos.z);
    var d = ((want - p2.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    p2.yaw += Math.max(-0.12, Math.min(0.12, d * 0.25));
  }
  setInterval(autoFacePatch, 33);

  /* ---------- 引导 ---------- */
  window.__layoutSplit = function (on) {
    var h1 = document.getElementById('hand1'), h2 = document.getElementById('hand2');
    if (on) { h1.style.left = '25%'; h2.style.left = '75%'; h2.style.top = 'auto'; h2.style.bottom = '14px'; h2.style.transform = 'translateX(-50%)'; }
    else { h1.style.left = '50%'; }
  };
  var __helpEl = document.getElementById('help'); if (__helpEl) __helpEl.style.display = 'none';
  G.HUD.init({
    start: function (cfg) { start(cfg); },
    cast: function (side, i) { castCard(side, i); }
  });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // 菜单背景：先造一个小世界当菜单画面
  (function menuScene() {
    S.world = new G.World({ size: [64, 24, 64], seed: 20261016 });
    S.world.generate(); patchWorldDirty(); buildWorldMeshes();
    ensureCams(); S.cams[0].cam.position.set(32, 30, 90); S.cams[0].cam.lookAt(32, 8, 32);
    (function spin() {
      requestAnimationFrame(spin);
      if (S.running) return;
      S.menuAz = (S.menuAz || 0) + 0.0016;
      var r = 74; S.cams[0].cam.position.set(32 + Math.cos(S.menuAz) * r, 34, 32 + Math.sin(S.menuAz) * r);
      S.cams[0].cam.lookAt(32, 8, 32);
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(scene, S.cams[0].cam);
    })();
  })();
  requestAnimationFrame(frame);
  window.__GW_START = start;
  window.__dbg = { scene: scene, renderer: renderer, fx: fxGroup, ent: entGroup, worldGroup: worldGroup, state: S };
  window.__GW_SNAPSHOT = function () { return G.Save.exportFrom(S.world, S.match); };
  function ctxReady() { return S.match ? S.match.fx : null; }
  window.__GW_LOAD = function (obj) { var cfg = S.cfg || { mode: S.mode }; cfg.load = obj; cfg.seed = obj.seed; start(cfg); };
  // 存档按钮与热键
  function bindSaveUI() {
    var box = document.getElementById('saveBox');
    var be = document.getElementById('btnExport'), bi = document.getElementById('btnImport'), bl = document.getElementById('btnLocal');
    if (be) be.onclick = function () {
      if (!S.match) { G.HUD.toast('先进入一局再导出', '#ff9f9f'); return; }
      var txt = G.Save.toText(G.Save.exportFrom(S.world, S.match));
      if (box) box.value = txt;
      G.HUD.toast('已导出 ' + (S.world.baseline ? '（地形变更 ' + JSON.parse(txt).cells.length + ' 格）' : ''), '#ffd86b');
      G.HUD.log('存档 JSON 已写入文本框，可复制分享', '#9d95c4');
    };
    if (bi) bi.onclick = function () {
      var v = box && box.value ? box.value.trim() : '';
      if (!v) { G.HUD.toast('文本框里没有存档 JSON', '#ff9f9f'); return; }
      var p = G.Save.fromText(v);
      if (!p.ok) { G.HUD.toast(p.reason, '#ff9f9f'); return; }
      var cfg = { mode: S.mode, deck: (S.cfg && S.cfg.deck) || 'starter', load: p.obj, seed: p.obj.seed };
      H_hideMenu(); start(cfg);
    };
    if (bl) bl.onclick = function () {
      var p = G.Save.localLoadSafe();
      if (!p.ok) { G.HUD.toast(p.reason, '#ff9f9f'); return; }
      var cfg = { mode: S.mode, deck: (S.cfg && S.cfg.deck) || 'starter', load: p.obj, seed: p.obj.seed };
      H_hideMenu(); start(cfg);
    };
  }
  function H_hideMenu() { G.HUD.hideMenu(); G.HUD.hideResult(); }
  G.Save.localLoadSafe = G.Save.localLoad;
  bindSaveUI();
})();
