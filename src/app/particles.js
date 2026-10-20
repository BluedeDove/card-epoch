/* src/app/particles.js · 粒子与飘字（表现层，不写权威状态）
   从 main.js 抽出的自包含块：Points 池 + 飘字 Sprite 池；只依赖 THREE 与一个 Group。

   2026-10-18 用户："方块破坏不够爽，炸一堆之后要有粒子效果" —— 这一版把粒子升级成**双池**：
     · chunk（大颗碎块）：方块自己的颜色 + 明暗两档、有重量、落地会弹两下；
     · spark（小颗火星）：同色系偏亮、飞得远、衰减快，负责"炸开的那一下"。
   两池共用一套物理（重力 / 阻力 / 寿命），只是尺寸与参数不同：Points 不带贴图时画出来是**方块**，
   这正好是体素挖掉一块该有的样子（Minecraft 的 block break 就是这个口味）。

   口径不变：零 DOM（canvas 只在飘字里用，属于绘制不是 DOM 结构）、零文案、不读写权威状态。
   对外 API：emit（旧签名，兼容）/ debris（碎块）/ puff（浮尘）/ floatText / step / stepFloats。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 一个池 = 一份 BufferGeometry + 一份 PointsMaterial + 环形缓冲的粒子表。
     size 是世界单位（sizeAttenuation 打开），所以近大远小是 three 自己算的。 */
  function makePool(group, size, max) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(max * 3), col = new Float32Array(max * 3);
    for (var i = 0; i < max; i++) pos[i * 3 + 1] = -999;          // 出生即"在地下"，不画
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var mat = new THREE.PointsMaterial({ size: size, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    /* 粒子排在透明方块（冰 21 / 水 22）之后：水写深度后，水后的粒子会被深度测试正确挡掉，
       水前的粒子仍能盖在水上。旧值 3 让水永远盖在粒子上面。 */
    points.renderOrder = 30;
    group.add(points);
    var parts = new Array(max), head = 0, live = 0;

    function spawn(p) {
      var idx = head++ % max;
      if (!parts[idx]) live++;
      parts[idx] = p;
      return idx;
    }
    function step(dt) {
      dt = Math.min(dt || 0, 0.05);                                 // 掉帧时别把粒子一帧丢到天边
      for (var i = 0; i < max; i++) {
        var p = parts[i];
        if (!p) { pos[i * 3 + 1] = -999; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
        p.life -= dt;
        if (p.life <= 0) { parts[i] = null; live--; pos[i * 3 + 1] = -999; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
        if (p.drag) { var k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vz *= k; }
        p.vy -= p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        /* 落地反弹：碎块砸在地上"哒"一下再躺下（只弹一次、只吃很小的竖直速度）。
           没有这一步，碎块会直接穿过地表落到脚底的虚空里，看着像掉进了洞。 */
        if (p.floor != null && p.y < p.floor && p.vy < 0) {
          p.y = p.floor; p.vy *= -0.30; p.vx *= 0.62; p.vz *= 0.62;
          if (Math.abs(p.vy) < 0.55) { p.vy = 0; p.grav = 0; p.drag = 3.2; }
          /* 第一次落地扬一小撮灰：碎块"砸在地上"这件事要看得见（只扬一次，不累积）。 */
          if (!p.bounced) { p.bounced = true; if (POOL.onBounce) POOL.onBounce(p); }
        }
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        var f = Math.min(1, p.life * (p.fade || 1.6));               // 尾段压暗 → 自然熄灭
        col[i * 3] = p.r * f; col[i * 3 + 1] = p.g * f; col[i * 3 + 2] = p.b * f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
    var POOL = { spawn: spawn, step: step, size: size, max: max, count: function () { return live; }, points: points, onBounce: null };
    return POOL;
  }

  G.Particles = {
    create: function (deps) {
      var group = deps.group;
      var chunk = makePool(group, 0.23, 620);      // 大颗碎块
      var spark = makePool(group, 0.10, 520);      // 亮点 / 火星 / 尘土
      /* 碎块落地时的扬尘：两粒很小、几乎不吃重力、寿命 0.25s——是"哒"一下的视觉版。 */
      chunk.onBounce = function (p) {
        for (var i = 0; i < 2; i++) {
          spark.spawn({
            x: p.x + (Math.random() - .5) * 0.35, y: p.floor + 0.05, z: p.z + (Math.random() - .5) * 0.35,
            vx: (Math.random() - .5) * 0.8, vy: 0.35 + Math.random() * 0.5, vz: (Math.random() - .5) * 0.8,
            life: 0.22 + Math.random() * 0.14, grav: 0.6, drag: 2.4, fade: 2.4,
            r: p.r * 1.25, g: p.g * 1.25, b: p.b * 1.25
          });
        }
      };

      /* 把 "#rrggbb" 拆成三档色：正色 / 压暗 / 提亮。碎块是同一块方块的碎片，
         颜色不该全一样——明暗差就是"像素块被敲碎"的观感来源（同色只会像一团雾）。 */
      var shadeCache = {};
      function shades(hex) {
        var hit = shadeCache[hex];
        if (hit) return hit;
        var base = new THREE.Color(hex || '#c9d3e0');
        var dark = base.clone().offsetHSL(0, 0.04, -0.11);
        var light = base.clone().offsetHSL(0, -0.03, 0.10);
        hit = shadeCache[hex] = [[base.r, base.g, base.b], [dark.r, dark.g, dark.b], [light.r, light.g, light.b]];
        return hit;
      }

      /* 旧签名入口（main.js 的 emit 别名与 ambient/heal/hit 都还走它）：
         四散的火星，重力默认 14、寿命 0.5~1.2s —— 行为与原版一致。 */
      function emit(x, y, z, color, n, spd, grav) {
        var s = shades(color)[0], count = n | 0 || 1, sp = spd || 4;
        for (var i = 0; i < count; i++) {
          spark.spawn({
            x: x, y: y, z: z,
            vx: (Math.random() - .5) * sp, vy: Math.random() * sp * 0.8 + (grav === 0 ? 0 : sp * 0.25), vz: (Math.random() - .5) * sp,
            life: 0.5 + Math.random() * 0.7, grav: grav === undefined ? 14 : grav, drag: 0.4,
            r: s[0], g: s[1], b: s[2]
          });
        }
      }

      /* 方块碎块：destruction 的主菜。
         opts.floor = 地面 y（碎块落在上面弹一下）；opts.n 覆盖碎块数；opts.spark 覆盖火星数。 */
      function debris(x, y, z, color, n, opts) {
        opts = opts || {};
        var sh = shades(color), count = Math.max(2, Math.min(24, n | 0 || 10));
        var spread = opts.spread == null ? 2.5 : opts.spread;
        for (var i = 0; i < count; i++) {
          var c = sh[i % 3];
          chunk.spawn({
            x: x + (Math.random() - .5) * 0.55, y: y + (Math.random() - .5) * 0.55, z: z + (Math.random() - .5) * 0.55,
            vx: (Math.random() - .5) * spread * 2, vy: 1.4 + Math.random() * 2.6, vz: (Math.random() - .5) * spread * 2,
            life: 0.45 + Math.random() * 0.5, grav: 17, drag: 0.7, floor: opts.floor,
            fade: 1.1,
            r: c[0], g: c[1], b: c[2]
          });
        }
        var sparks = opts.spark == null ? 5 : opts.spark;
        for (var j = 0; j < sparks; j++) {
          var s = sh[2];
          spark.spawn({
            x: x, y: y, z: z,
            vx: (Math.random() - .5) * 9, vy: 1 + Math.random() * 3.4, vz: (Math.random() - .5) * 9,
            life: 0.16 + Math.random() * 0.22, grav: 8, drag: 2.2, fade: 2.2,
            r: s[0], g: s[1], b: s[2]
          });
        }
      }

      /* 浮尘（放置方块 / 落地 / 物质反应）：往上飘、几乎不吃重力，负责"有东西发生了"的空气感。 */
      function puff(x, y, z, color, n) {
        var s = shades(color || '#c9d3e0')[1], count = n | 0 || 4;
        for (var i = 0; i < count; i++) {
          spark.spawn({
            x: x + (Math.random() - .5) * 0.7, y: y + (Math.random() - .5) * 0.5, z: z + (Math.random() - .5) * 0.7,
            vx: (Math.random() - .5) * 1.4, vy: 0.4 + Math.random() * 0.9, vz: (Math.random() - .5) * 1.4,
            life: 0.5 + Math.random() * 0.5, grav: -0.8, drag: 1.4, fade: 1.9,
            r: s[0], g: s[1], b: s[2]
          });
        }
      }

      function step(dt) { chunk.step(dt); spark.step(dt); }

      /* ---------- 飘字（伤害数字 / 回血） ----------
         字号随数值走：小伤害是普通字，大伤害是大字——"这一发很疼"要能一眼看出来，
         不用去读数字。size 缺省 30px（原版口径）。 */
      var floats = [];
      function floatText(pos, txt, color, size) {
        var cv = document.createElement('canvas'); cv.width = 128; cv.height = 44;
        var c = cv.getContext('2d');
        var px = Math.max(20, Math.min(34, size || 30));
        c.font = 'bold ' + px + 'px monospace'; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = '#000';
        c.strokeText(txt, 64, 32); c.fillStyle = color; c.fillText(txt, 64, 32);
        var tex = new THREE.CanvasTexture(cv);
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        var sc = 1.8 * (px / 30);
        sp.scale.set(sc, sc * 0.344, 1); sp.position.set(pos.x, pos.y + 1.8, pos.z);
        sp.renderOrder = 40;   // 飘字永远在最后：水/冰/粒子的深度都不该盖住伤害数字
        group.add(sp);
        floats.push({ sp: sp, t: 0, vy: 1.9 });
      }
      function stepFloats(dt) {
        for (var i = floats.length - 1; i >= 0; i--) {
          var f = floats[i]; f.t += dt; f.sp.position.y += f.vy * dt; f.vy -= 3 * dt;
          f.sp.material.opacity = Math.max(0, 1 - f.t / 1.1);
          if (f.t > 1.1) { group.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); floats.splice(i, 1); }
        }
      }
      return {
        emit: emit, debris: debris, puff: puff, step: step, floatText: floatText, stepFloats: stepFloats,
        stats: function () { return { chunks: chunk.count(), sparks: spark.count(), maxChunks: chunk.max, maxSparks: spark.max }; }
      };
    }
  };
})(window.GW);
