/* ================= GW.VFX =================
   特效的**计算层**：元素原子类、配方展开、时间轴相位、逐层动画量求值。
   零 DOM、零 THREE、零玩家可见文案——渲染层（main.js / shader.js）只管把这里
   交出的数字画出来；权威层（battle.js / rules.js）只在数据里挂 recipe id。

   为什么把「算」和「画」分两家：
     - 渲染侧改材质、改几何复用方式时不该动到特效语义；
     - 特效语义要能被回归脚本机检（tools/vfx_check.cjs），不依赖 GL；
     - 同一个 recipe 既能给地面法阵用，也能给抛射物拖尾、随从脚下用。

   一条硬约束：**视觉累加量不写回权威状态**。所有旋转、抖动、生长进度都是
   (recipe, entity, time) 的纯函数——同一时刻问同一个实体，永远得到同一个答案。
   这样存档、结算、（将来的）网络同步都看不见这些量，也不会被它们污染。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* ---------- 小工具 ---------- */
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, dflt) { return (typeof v === 'number' && isFinite(v)) ? v : dflt; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeIn(t) { return t * t; }
  /* 确定性随机：同一个 (seed, k) 永远同一个值。渲染层每帧重算不会闪。 */
  function hash01(seed, k) {
    var x = (seed ^ 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
    x = (x ^ (x >>> 15) + Math.imul(k + 1, 0x6d2b79f5)) >>> 0;
    return (x >>> 8) / 16777216;
  }

  /* ---------- 1. 元素原子类：任何魔法特效都由这几类拼出来 ----------
     每个类给出：fields（参数名 → [默认值, 最小, 最大]）、unit（可选的单位几何缓存键）。
     参数全部有界：越界就 clamp 并记进 errors 里当 warning，不抛异常——
     数据写错要能在机检里打行号，但不能把游戏崩掉。 */
  var CLASSES = {
    /* 同心环：连续线 / 点环 / 刻度齿环。刻度齿是「科技感」的主要来源。 */
    /* w 是「线宽」，单位约等于「几分之一格」——渲染层按它画**多条平行带**（见 js/vfx-render.js 的
       thickSeg），不再只是亮度。默认值 2026-10-16 整体上抬过一轮：用户在实机报
       "法阵太小、线条太细、看不清"，那种 1 像素的线在亮草地上基本读不出来。
       自下而上改的意思是：**默认档**在这里，配方想细要自己写小 w，而不是渲染层替它猜。 */
    ring: {
      fields: { r: [1, .05, 12], w: [1.9, 0, 7], style: ['dots', null, null],
                count: [48, 3, 256], tilt: [0, -1.5708, 1.5708], spin: [0, -6, 6],
                flow: [0, -8, 8], alpha: [1, 0, 1] },
      styles: ['solid', 'dots', 'ticks']
    },
    /* 内接多边形与星形：n 边、step 跳格（1 = 凸多边形），spike 让尖角出头。 */
    poly: {
      fields: { r: [1, .05, 12], n: [6, 3, 24], step: [1, 1, 8], w: [1.9, 0, 7],
                spike: [0, 0, 1.6], tilt: [0, -1.5708, 1.5708], spin: [0, -6, 6],
                alpha: [1, 0, 1] }
    },
    /* 放射线：从 rIn 拉到 rOut 的 spoke，jitter 给它一点手绘感。 */
    spokes: {
      fields: { rIn: [.2, 0, 12], rOut: [1, .05, 12], n: [12, 1, 96], w: [1.7, 0, 7],
                jitter: [0, 0, .5], tilt: [0, -1.5708, 1.5708], spin: [0, -6, 6], alpha: [1, 0, 1] }
    },
    /* 环上符号带：n 个等距槽位（字母、符文、小方块都由渲染层决定怎么画）。 */
    glyphs: {
      fields: { r: [.82, .05, 12], n: [12, 1, 64], size: [1.8, .05, 5],
                spin: [0, -6, 6], blink: [0, 0, 1], alpha: [1, 0, 1] }
    },
    /* 竖向柱：光柱 / 冰柱 / 落雷。count 根均匀分布在一个圆上，h 是高度。 */
    pillar: {
      fields: { r: [.9, 0, 12], count: [6, 1, 32], h: [2, .1, 16], w: [2.6, 0, 12],
                taper: [.6, 0, 1], rise: [0, 0, 12], flicker: [0, 0, 1],
                spin: [0, -6, 6], alpha: [1, 0, 1] }
    },
    /* 漏斗 / 旋涡：layers 圈半径从 rTop 收到 rBot，整体在 h 内下降。 */
    vortex: {
      fields: { rTop: [1, .05, 12], rBot: [.12, 0, 12], layers: [5, 1, 24], h: [1.6, .1, 12],
                count: [40, 3, 256], w: [1.8, 0, 7], spin: [1.2, -6, 6], alpha: [1, 0, 1] }
    },
    /* 偏心绕转体：n 个小体沿半径 r 的轨道跑，phaseOffset 给彼此错开。 */
    orbit: {
      fields: { r: [1.1, .05, 12], n: [3, 1, 24], size: [1.8, .05, 5], tilt: [0, -1.5708, 1.5708],
                spin: [.9, -6, 6], phase: [0, 0, TAU], alpha: [1, 0, 1] }
    },
    /* 扫掠弧：一段从 a0 长到 a1 的弧，用来做「扫描」「蓄力充能」。 */
    sweep: {
      fields: { r: [1, .05, 12], a0: [0, -TAU, TAU], span: [1.2, 0, TAU], speed: [2, -12, 12],
                w: [2.2, 0, 8], tilt: [0, -1.5708, 1.5708], alpha: [1, 0, 1] }
    },
    /* ---------- 2026-10-17 新增的三类原子：大招与飞行体需要的"体积感" ----------
       tilt 在旧版只开到 ±1.2（≈69°），于是所有平面层只能"躺在地上"。
       大招要的是**竖起来的冲击环**（一圈墙似的白浪往外推），那就得让平面层能立直——
       这里把平面类的 tilt 上限放到 ±π/2。放的是**上限**不是默认值：旧配方全都没写 tilt，
       行为一个字节都不变（vfx_check 的夹紧用例仍按旧默认档量）。 */
    /* 半球 / 线框罩：半径 r 的罩子，lat 圈纬线 + lon 条经线。
       大招的"罩住半张地图"、飞行体的"球壳护体"都用它——比同心环多一层法线方向的信息。 */
    dome: {
      fields: { r: [1, .05, 12], lat: [4, 1, 12], lon: [12, 3, 48], w: [1.5, 0, 7],
                spin: [0, -6, 6], squash: [.78, .1, 1], alpha: [1, 0, 1] }
    },
    /* 螺旋带：n 股从 r 收到 r*(1-taper)，在 h 高度里绕 turns 圈。
       飞行随从的"魂丝"、虚空吸积、陨星的下坠轨迹都是一条螺旋。 */
    helix: {
      fields: { r: [.9, .05, 12], n: [2, 1, 8], turns: [1.4, .1, 6], count: [26, 4, 96],
                h: [2.2, .1, 16], taper: [.7, 0, 1], w: [1.4, 0, 7], spin: [1.2, -6, 6],
                rise: [0, 0, 12], alpha: [1, 0, 1] }
    },
    /* 球 / 球壳（2026-10-17）：**完整的**立体球，不是半罩。
       用户报"爆炸怎么只炸下面不炸上面，它应该是个球的爆炸体"——根因不是这条配方写错，
       而是当时只有`dome`（半球罩、贴地）、平面原子又只能躺在地上；爆炸永远只画得出下半球。
       球体用 lat 条纬线（-90°..+90°）+ lon 条经线（极到极），上下对称，从任何角度看都是球。 */
    sphere: {
      fields: { r: [1, .05, 12], lat: [6, 2, 20], lon: [12, 3, 36], w: [1.4, 0, 7],
                spin: [0, -6, 6], open: [0, 0, 1], alpha: [1, 0, 1] }
    },
    /* 碎屑云：n 个确定性散点，半径跟着 draw 从 core 涨到 r。
       爆炸的"炸开了"读感全靠它——环只是一圈线，散点才是"东西碎了"。 */
    shards: {
      fields: { r: [1.2, .05, 12], n: [16, 1, 64], core: [.2, 0, 1], size: [.12, .03, 2],
                spin: [0.6, -6, 6], squash: [.6, .1, 1], alpha: [1, 0, 1] }
    }
  };

  /* ---------- 2. 每层可挂的动画通道 ----------
     通道不是元素，是「这一层随时间怎么变」。缺省全 0，等于静止贴图。 */
  var ANIMS = {
    draw:   { from: 0, to: 1 },    // 描线生长：本层被「画」出来的比例（0→1）
    spinAt: null,                  // 覆盖 CLASSES 里的 spin；缺省 null = 不覆盖（写成 0 会把所有层钉死不动）
    pulse:  0,                     // 半径呼吸幅度
    pulseHz: 1.6,                  // 呼吸频率
    flicker: 0,                    // 亮度抖动幅度（确定性）
    flow:   0,                     // 相位流动：刻度/符号的跑马灯速度
    fade:   1,                     // 本层整体淡入淡出比例
    /* beat（2026-10-17）：分层节拍。beatAt 是一串**绝对秒数**（相对出生），
       每个时刻该层亮度弹起、指数衰减；beatW 是每个峰的宽度，beatK 是峰值倍数。
       为什么放在计算层：用户要的是"二阶/三阶/四阶的节奏感"，
       节奏是**时间轴**的事，不该由每张卡自己写死一条配方。 */
    beatAt: null,
    beatW:  0.12,
    beatK:  1.0
  };

  /* ---------- 3. 时间轴相位：由 age / delay / ttl 推出来，纯函数 ----------
     idle   蓄力中（delay 还没走完，法阵正在被「画」出来）
     ignite 点燃瞬间（短暂爆发窗口，渲染层可以额外叠一圈冲击环）
     live   稳定期（各层异速自旋）
     decay  衰减期（转速掉、透明度掉，临期先减速再淡出） */
  /* 角速度包络：live 全速，decay 线性掉到 25%。
     「临期先减速再淡出」比一直全速淡出更像东西要散；单看这一帧也才知道该慢多少。 */
  function spinRate(age, delay, ttl, span, full) {
    if (!(span > 0)) return full;
    var start = delay + ttl - span;
    if (age <= start) return full;
    var u = clamp((age - start) / span, 0, 1);
    return full * (1 - 0.75 * u);
  }
  /* 角度必须是角速度的**积分**，不能写成 time × 瞬时速度：
     后者一减速就会让整圈角度往回跳（实测 -1.3 → -0.35，肉眼是「环倒回去」）。
     这里仍是纯函数：同一 (age) 永远同一答案，不需要往权威状态里存累加量。 */
  function angleOf(age, delay, ttl, span, full) {
    if (!(span > 0)) return age * full;
    var start = delay + ttl - span;
    if (age <= start) return age * full;
    var over = age - start;
    var u = clamp(over / span, 0, 1);
    var mAvg = 1 - 0.375 * u;                       // ∫₀ᵘ(1-0.75s)ds / u
    return start * full + over * full * mAvg;
  }
  function phaseOf(age, delay, ttl, igniteWindow) {
    var iw = num(igniteWindow, .35);
    var spinOf = 1;
    if (age < delay) return { name: 'idle', t: age, p: delay > 0 ? clamp(age / delay, 0, 1) : 1 };
    var live = age - delay;
    if (live < iw) return { name: 'ignite', t: live, p: live / iw };
    var remain = (delay + ttl) - age;
    var span = Math.min(1.2, ttl * .3);
    if (remain < span) {
      return { name: 'decay', t: live, p: clamp(remain / Math.max(.001, span), 0, 1),
               decayAt: delay + ttl - span, decaySpan: span, spin: spinOf };
    }
    return { name: 'live', t: live, p: 1, decayAt: delay + ttl - span, decaySpan: span, spin: spinOf };
  }

  /* ---------- 4. 单位几何缓存（按「形状 + 份数」缓存，渲染层直接拿去摆） ----------
     这些数组是**共享只读**的：算完一次不再变，省掉每帧分配。 */
  var unitCache = {};
  function unitRing(n) {
    var k = 'ring:' + n, a = unitCache[k];
    if (a) return a;
    a = new Float32Array(n * 2);
    for (var i = 0; i < n; i++) { var t = i / n * TAU; a[i * 2] = Math.cos(t); a[i * 2 + 1] = Math.sin(t); }
    return (unitCache[k] = a);
  }
  function unitPoly(n, step) {
    var k = 'poly:' + n + ':' + step, a = unitCache[k];
    if (a) return a;
    var pts = [], idx = 0, vis = 0;
    step = Math.max(1, step | 0);
    do { pts.push(idx); vis++; idx = (idx + step) % n; } while (idx !== 0 && pts.length <= n * step);
    a = new Float32Array(pts.length * 2);
    for (var i = 0; i < pts.length; i++) { var t = pts[i] / n * TAU - Math.PI / 2; a[i * 2] = Math.cos(t); a[i * 2 + 1] = Math.sin(t); }
    return (unitCache[k] = a);
  }
  function unitSpokes(n) {
    var k = 'spokes:' + n, a = unitCache[k];
    if (a) return a;
    a = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) {
      var t = i / n * TAU, c = Math.cos(t), s = Math.sin(t), o = i * 4;
      a[o] = c; a[o + 1] = s; a[o + 2] = c; a[o + 3] = s;   // 端点由 rIn/rOut 缩放
    }
    return (unitCache[k] = a);
  }

  /* ---------- 4b. 递归组合：节点树 → 叶子表（2026-10-17 架构重排） ----------
     病灶：旧版 frame() 是"把 recipe.layers 平铺成一个列表"，place() 只认单层的 (tilt, rot)。
     于是任何"法阵外面还有一圈旋转的法针""环里再嵌一圈环""爆炸是立体球"都写不出来——
     除非给每张卡单独加一条配方。用户要的是**组合之上自发拥有特性**，所以这里补的是结构，不是内容：
       · group：一组子节点，自带 spin（绕世界竖轴）/ tiltX / tiltZ / off，子节点继承它的变换；
       · sat：把 child 复制 n 份摆在一个圆周上（"法针环绕"就是一行数据）；
       · 任意层级，展开后仍是**扁平的叶子表**（渲染层不需要认识树，draw call 仍是一条几何）。
     变换用 3x3 旋转 + 平移，纯数字、零 THREE，符合本层纪律。 */
  function mId() { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  function mMul(a, b) {
    return [a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
            a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
            a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
  }
  function mRotX(t) { var c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function mRotY(t) { var c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function mRotZ(t) { var c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function mApply(m, v) {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
            m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
            m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  }
  /* 平面原子躺在 XY 平面、法线 +Z；立体原子（pillar/vortex/dome/helix/sphere/shards）Y 向上。
     这条分界就是旧版 place() 里那个 planar 列表，现在归到计算层当"局部坐标约定"。 */
  function isPlanar(prim) {
    return prim === 'ring' || prim === 'poly' || prim === 'spokes' ||
           prim === 'glyphs' || prim === 'orbit' || prim === 'sweep';
  }
  var TREE = {};
  function expand(id) {
    var c = TREE[id];
    if (c) return c;
    var r = RECIPES[id];
    if (!r) return null;
    var out = [];
    function walk(node, chain, depth) {
      if (!node || depth > 4) return;
      if (node.sat) {                                  /* 环绕复制：法针 / 小阵 / 碎环 */
        var n = Math.max(1, Math.min(24, node.sat.n | 0 || 4));
        var rad = num(node.sat.radius, 1), y = num(node.sat.y, 0);
        for (var i2 = 0; i2 < n; i2++) {
          var ang = num(node.sat.phase, 0) + i2 / n * TAU;
          walk(node.child || (node.children && node.children[0]), chain.concat([{
            spin: num(node.sat.spin, 0), tiltX: num(node.sat.tiltX, 0), tiltZ: num(node.sat.tiltZ, 0),
            off: [Math.cos(ang) * rad, y, Math.sin(ang) * rad]
          }]), depth + 1);
        }
        return;
      }
      if (node.group || node.children) {
        var gn = { spin: num(node.spin, 0), tiltX: num(node.tiltX, 0), tiltZ: num(node.tiltZ, 0), off: node.off || null };
        var kids = node.children || [];
        for (var k = 0; k < kids.length; k++) walk(kids[k], chain.concat([gn]), depth + 1);
        return;
      }
      out.push({
        node: node, prim: node.prim || 'ring', chain: chain, planar: isPlanar(node.prim),
        weight: num(node.weight, 1), minLod: num(node.minLod, 0), depth: depth
      });
    }
    var roots = r.layers || [];
    for (var i = 0; i < roots.length; i++) walk(roots[i], [], 0);
    TREE[id] = out;
    return out;
  }

  /* ---------- 5. 参数归一：按类夹紧，记 warning 不抛 ---------- */
  function normalize(prim, p, warn, where) {
    var cls = CLASSES[prim];
    if (!cls) { warn.push('unknown prim "' + prim + '" @' + where); return null; }
    var out = {}, k, f;
    for (k in cls.fields) {
      f = cls.fields[k];
      if (typeof f[0] === 'string') {                       // 枚举（ring.style）
        var v = (typeof p[k] === 'string') ? p[k] : f[0];
        if (cls.styles && cls.styles.indexOf(v) < 0) { warn.push('bad ' + prim + '.' + k + '="' + v + '" @' + where); v = f[0]; }
        out[k] = v; continue;
      }
      var raw = (typeof p[k] === 'number' && isFinite(p[k])) ? p[k] : f[0];
      var cc = clamp(raw, f[1], f[2]);
      if (cc !== raw) warn.push('clamp ' + prim + '.' + k + ' ' + raw + '→' + cc + ' @' + where);
      out[k] = cc;
    }
    var an = {};
    for (k in ANIMS) an[k] = (typeof p[k] === 'number' && isFinite(p[k])) ? clamp(p[k], -999, 999) : ANIMS[k];
    out.anim = an;
    out.color = (typeof p.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(p.color)) ? p.color : null;
    out.color2 = (typeof p.color2 === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(p.color2)) ? p.color2 : null;
    return out;
  }

  /* ---------- 6. 配方库：一条 recipe = anchor + layers，layers 里每项 = {prim, ...params} ---------- */
  var RECIPES = {};
  function registerRecipe(id, spec) {
    if (!id || typeof id !== 'string') return null;
    RECIPES[id] = { id: id, anchor: spec.anchor || 'ground', seed: spec.seed || 0,
                    igniteWindow: num(spec.igniteWindow, .35), scaleWithRadius: spec.scaleWithRadius !== false,
                    budget: num(spec.budget, 0),   /* 同屏叶子上限；0 = 走默认档。密度控制的配方级闸门 */
                    layers: spec.layers || [] };
    return RECIPES[id];
  }
  function validateRecipe(id) {
    var r = RECIPES[id], warn = [];
    if (!r) return { ok: false, errors: ['no such recipe "' + id + '"'] };
    if (!r.layers.length) warn.push('recipe "' + id + '" has no layers');
    for (var i = 0; i < r.layers.length; i++) {
      var lay = r.layers[i] || {}, prim = lay.prim || (lay.layers ? 'vortex' : 'ring');
      if (!normalize(prim, lay, warn, id + '#' + i)) { /* unknown prim 已记 */ }
    }
    return { ok: warn.length === 0, errors: warn };
  }

  /* 元素着色：权威层只报 kind（fire / ice / void…），色值从 G.ELEMENTS 取，
     渲染层与逻辑层都不再各写一份颜色。 */
  function palette(entity, layer) {
    if (layer.color) return { a: layer.color, b: layer.color2 || layer.color };
    var el = (entity && (entity.preset && entity.preset.kind || entity.kind2 || entity.element || entity.preset && entity.preset.element)) || 'neutral';
    var E = (G.ELEMENTS && G.ELEMENTS[el]) || { color: '#c9d3e0', accent: '#8a94a6' };
    return { a: layer.color || E.color, b: layer.color2 || E.accent || E.color };
  }

  /* ---------- 7. 逐层求值：把 (recipe, entity, time) 算成渲染层能直接用的数字 ----------
     返回 { anchor, recipe, phase, layers: [ {prim, verts, count, r, radius, rot, alpha,
     color, color2, style, w, h, taper, extra...} ] }
     传 out 可复用（渲染层每帧调用时传同一个对象，避免 GC 抖动手感）。 */
  function frame(entity, time, dt, opts) {
    opts = opts || {};
    var rid = opts.recipe || (entity && entity.preset && entity.preset.fx) || (entity && entity.fx) || opts.defaultRecipe;
    var r = RECIPES[rid];
    if (!r) return { recipe: rid || null, anchor: 'ground', phase: { name: 'live', p: 1 }, layers: [] };
    var seed = (r.seed | 0) ^ (((entity && entity.uid) | 0) * 2654435761 >>> 0) >>> 0;
    var base = opts.radius || (entity && entity.radius) || (entity && entity.preset && entity.preset.radius) || 1;
    var born = num(opts.born, entity && entity.born !== undefined ? entity.born : time);
    var delay = num(opts.delay, entity && entity.delay !== undefined ? entity.delay : 0);
    var ttl = num(opts.ttl, entity && entity.ttl !== undefined ? entity.ttl : 6);
    var ageNow = Math.max(0, time - born);
    var ph = phaseOf(ageNow, delay, ttl, r.igniteWindow);
    var t = time;
    /* 渲染层每帧问一次：160FPS × 十几个法阵 = 每秒两万次求值，如果每次都 new 一层对象，
       GC 就会把几十毫秒扫进手感里（AGENTS 的"手感不变量"记过同类坑）。
       传 opts.out（上一帧那个对象）就原地改写，**层数必须对得上**，对不上就退回新建——
       这是纯函数的写法：同一批输入永远得到同一份数字，只是省掉了分配。 */
    /* 递归组合（2026-10-17）：配方先展开成**叶子表**（每叶带一条父链），再逐叶求值。
       展开结果按配方缓存——每帧只重算"随年龄变化"的矩阵与数字，不重建结构。 */
    var leafList = expand(r.id) || [];
    /* 密度控制：渲染层按相机距离给 lod（0..1）；配方自己可以声明 budget 封顶同屏叶子数。
       超了按 weight 从高到低留、其余丢弃（稳定排序：同 weight 保序，同帧可复现）。
       这一层是"信息密度"的唯一闸门——不是让每条配方自己数层数。 */
    var lod = (typeof opts.lod === 'number') ? opts.lod : 1;
    /* 预算随距离收紧：近处全细节，远处只留 45%。这是"信息密度"的第一道闸；
       第二道是下面按 lod 对单层点数抽稀（count 打折），第三道是配方自己声明的 budget。 */
    var baseBudget = (opts.budget || r.budget || 64) | 0;
    var budget = Math.max(4, Math.round(baseBudget * (0.45 + 0.55 * clamp(lod, 0, 1))));
    var kept = [];
    for (var li = 0; li < leafList.length; li++) {
      if (leafList[li].minLod <= lod) kept.push(leafList[li]);
    }
    if (kept.length > budget) {
      var ord = kept.map(function (x, ix) { return { x: x, i: ix }; });
      ord.sort(function (a, b) { return (b.x.weight - a.x.weight) || (a.i - b.i); });
      ord.length = budget;
      ord.sort(function (a, b) { return a.i - b.i; });
      kept = ord.map(function (o2) { return o2.x; });
    }
    var pool = (opts.out && opts.out.layers && opts.out.layers.length === kept.length) ? opts.out.layers : null;
    var outLayers = pool || [];
    for (var i = 0; i < kept.length; i++) {
      var lf = kept[i], raw = lf.node || {};
      var prim = lf.prim;
      var warn = [];
      var p = normalize(prim, raw, warn, r.id + '#' + i);
      if (!p) continue;
      var an = p.anim;
      /* 生长：idle 期画出来；live 后保持 1；decay 期整体淡出 */
      /* grow：idle 期把这一层「画」出来，之后保持满值 */
      var gp = ph.name === 'idle' ? clamp(ph.p, 0, 1) : 1;
      var grow = gp * gp * (3 - 2 * gp);   // smoothstep：描线要匀速，easeOut 会「一下就亮完」
      var vis = clamp(an.fade, 0, 1) * (ph.name === 'decay' ? easeIn(ph.p) : 1) * (ph.name === 'ignite' ? (0.6 + 0.4 * ph.p) : 1);
      /* 自旋：稳定期全速，临期减速（「先停转再淡出」比一直全速淡出更像要散了） */
      var full = (typeof an.spinAt === 'number' ? an.spinAt : num(p.spin, 0));
      var rate = spinRate(ageNow, delay, ttl, ph.decaySpan, full);
      var rot = (angleOf(ageNow, delay, ttl, ph.decaySpan, full) + num(p.phase, 0)) % TAU;
      /* 呼吸 + 抖动：都取确定性 hash，帧与帧之间可复现 */
      var pulse = an.pulse ? (1 + an.pulse * Math.sin(t * TAU * an.pulseHz + i * 1.7)) : 1;
      var fl = an.flicker ? (1 - an.flicker * (0.5 + 0.5 * hash01(seed, (t * 12 | 0) * 31 + i))) : 1;
      var scale = (r.scaleWithRadius === false ? 1 : base) * pulse;
      var col = palette(entity, p);
      var L = pool ? pool[i] : {};
      var verts = null, count = 0;
      /* 抽稀：远处每条环/多边形按 lod 减点（至少留 3 个），线宽不变、形状不散。
         这一步只在点数层面省，不改变形状的语义——所以关掉特效层/近处看起来仍然一致。 */
      var dec = lod < 0.7 ? (lod < 0.4 ? 0.5 : 0.75) : 1;
      var cnt = function (v, mn) { return Math.max(mn, Math.round(v * dec)); };
      if (prim === 'ring') { verts = unitRing(count = cnt(p.count, 3)); }
      else if (prim === 'poly') { verts = unitPoly(p.n | 0, p.step | 0); count = verts.length / 2; }
      else if (prim === 'spokes') { verts = unitSpokes(cnt(p.n, 2)); count = cnt(p.n, 2); }
      else if (prim === 'glyphs') { count = cnt(p.n, 1); }
      else if (prim === 'pillar') { count = p.count | 0; }
      else if (prim === 'vortex') { count = p.layers | 0; }
      else if (prim === 'orbit') { count = p.n | 0; }
      else if (prim === 'sweep') { count = 1; }
      else if (prim === 'dome') { count = p.lat | 0; }
      else if (prim === 'helix') { count = (p.n | 0) * (p.count | 0); }
      else if (prim === 'shards') { count = p.n | 0; }
      else if (prim === 'sphere') { count = p.lat | 0; }
      if (!pool) outLayers.push(L);
      L.prim = prim; L.verts = verts; L.count = count;
      L.radius = scale;
      L.r = (p.r !== undefined ? p.r * scale : scale);
      L.rOut = (p.rOut !== undefined ? p.rOut * scale : undefined);
      L.rIn = (p.rIn !== undefined ? p.rIn * scale : undefined);
      L.rTop = (p.rTop !== undefined ? p.rTop * scale : undefined);
      L.rBot = (p.rBot !== undefined ? p.rBot * scale : undefined);
      /* h 是「格」：竖向柱与旋涡的高度不跟法阵半径走，否则大阵的雷柱会长到离谱 */
      L.h = p.h;
      L.w = p.w; L.style = p.style; L.size = p.size; L.taper = p.taper;
      L.rot = rot; L.spin = rate; L.tilt = p.tilt; L.flow = (p.flow || 0) + an.flow; L.phase = p.phase;
      /* ---- 变换（递归组合的落地点）----
         父链：组节点的 spin 绕**世界竖轴**转（法针环绕就靠它），tilt / off 依次叠加；
         叶子：先按原子自己的局部平面摆正（平面原子躺在 XY、法向 +Z；立体原子 Y 向上），再套自旋。
         这和旧 place() 的 `rotation.set(-π/2+tilt, rot, 0)` 是同一件事，只是变成了可继承的矩阵。 */
      var M = mId(), Tx = 0, Ty = 0, Tz = 0;
      for (var ci = 0; ci < lf.chain.length; ci++) {
        var g = lf.chain[ci];
        if (g.spin) M = mMul(M, mRotY(ageNow * g.spin));
        if (g.tiltX) M = mMul(M, mRotX(g.tiltX));
        if (g.tiltZ) M = mMul(M, mRotZ(g.tiltZ));
        if (g.off) {
          var ov = mApply(M, g.off);
          Tx += ov[0]; Ty += ov[1]; Tz += ov[2];
        }
      }
      /* 平面原子在两种锚点下的姿态不同：贴地阵是"躺平在 XZ"（旧 place() 的 -π/2），
         跟随体（body）是"正对镜头、在屏面内自旋"——这条差别以前藏在渲染层的 if 里，
         现在回到计算层，因为它是"局部坐标约定"，不是画法。 */
      /* 平躺 + 在平面里自旋：必须先 Rx(-π/2) 躺平，再**左乘** Ry(rot) 绕世界竖轴转。
         旧实现写的是 three 的 Euler(-π/2+tilt, rot, 0)（等价于 Rx·Ry），实测法线 = (sin rot, cos rot, 0)——
         也就是 rot 一大环就"翻倒"成斜的椭圆，而不是在原地打转（截图里那些歪掉的环就是这么来的）。
         这条是这次架构重排顺手修掉的真视觉 bug。 */
      var Mf;
      if (lf.planar && r.anchor !== 'body') Mf = mMul(M, mMul(mRotY(rot), mRotX(-Math.PI / 2 + num(p.tilt, 0))));
      else if (lf.planar) Mf = mMul(M, mMul(mRotZ(rot), mRotX(num(p.tilt, 0))));
      else Mf = mMul(M, mRotY(rot));
      L.m = Mf; L.px = Tx; L.py = Ty; L.pz = Tz;
      L.planar = lf.planar; L.depth = lf.depth;
      /* 节拍：本层在 beatAt 的每个时刻弹一下（指数衰减）。
         与 flicker 不同——flicker 是随机抖动，beat 是**可编排的**节奏，用来做多段施法。 */
      if (an.beatAt && an.beatAt.length) {
        var bAcc = 0, bw = Math.max(0.02, an.beatW);
        for (var bi = 0; bi < an.beatAt.length; bi++) {
          var dtb = ageNow - an.beatAt[bi];
          if (dtb >= -bw && dtb <= bw * 6) bAcc += Math.exp(-Math.abs(dtb) / bw);
        }
        if (bAcc > 0) fl *= (1 + an.beatK * Math.min(2.2, bAcc));
      }
      L.alpha = clamp(p.alpha * vis * grow * fl, 0, 1); L.draw = grow;
      L.color = col.a; L.color2 = col.b; L.span = p.span; L.a0 = p.a0 + t * p.speed; L.speed = p.speed;
      L.jitter = p.jitter; L.blink = p.blink; L.rise = p.rise; L.flicker = an.flicker; L.layers = p.layers;
      /* 2026-10-17 新原子带的几何参数（dome / helix / shards）。没有这些字段的原子读到的
         是 undefined，渲染层按默认档兜——旧配方不受影响。 */
      L.lat = p.lat; L.lon = p.lon; L.turns = p.turns; L.squash = p.squash; L.core = p.core;
      L.countPer = p.count;
    }
    var res = opts.out || { recipe: r.id, anchor: r.anchor, layers: outLayers };
    /* 层数对不上时（配方被换掉 / 第一次调用）outLayers 是新数组，必须挂回去，
       否则复用壳子的那一帧还在画上一份配方。 */
    res.layers = outLayers;
    res.recipe = r.id; res.anchor = r.anchor; res.seed = seed;
    var po = res.phase || (res.phase = {});
    po.name = ph.name; po.t = ph.t; po.p = ph.p;
    po.decayAt = ph.decayAt; po.decaySpan = ph.decaySpan; po.spin = ph.spin;
    res.phase = po;
    return res;
  }

  /* ---------- 7b. 卡牌自动配方（2026-10-17）----------
     用户的要求："迁移要适配到所有卡牌，不只是新做的；新的技能不是要求什么样子、一条条去达成，
     而是基础元素的组合之上自发就拥有这些特性"。所以这里不是又写一堆配方，而是**一个生成器**：
     按（元素光谱 × 卡种 × 费用档 × 卡 id 的确定性哈希）组合出结构——外层刻度环、内层多边形、
     体积（柱/旋涡/罩）、4 费以上挂环绕复制（法针圈）、6 费以上加球壳、以及 2~3 段节拍。
     同一张卡永远得到同一条（按 id 缓存），不同卡之间自然分层。手写配方（CARD_BY_ID_FX）仍然优先。 */
  var AUTO = {};
  function autoRecipe(card) {
    if (!card || !card.id) return null;
    var rid = 'auto_' + card.id;
    if (AUTO[rid]) return rid;
    var E = (G.ELEMENTS && G.ELEMENTS[card.element]) || { color: '#c9d3e0', accent: '#8a94a6' };
    var sp = E.spectrum || [E.color, E.color, E.accent, E.accent];
    var tier = Math.max(1, Math.min(8, card.cost || 1));
    var seed = hash01(card.id.length * 977 + card.id.charCodeAt(0) * 31 + card.id.charCodeAt(card.id.length - 1), 7);
    var dir = seed > 0.5 ? 1 : -1;
    var pick = function (i) { return sp[i % sp.length]; };
    var L = [];
    /* 节拍：1 费单段、3~4 费两段、5 费以上三段（"前摇 → 主击 → 余波"的节奏感） */
    var beats = tier >= 5 ? [0.12, 0.30, 0.52] : (tier >= 3 ? [0.12, 0.34] : [0.16]);
    /* 外层：刻度环（高档）/ 实线环（低档） */
    L.push({ prim: 'ring', r: 1, style: tier >= 4 ? 'ticks' : 'solid', count: 56 + tier * 6,
             w: 0.9 + tier * 0.1, spin: dir * (0.24 + tier * 0.05), flow: tier >= 4 ? 1.2 : 0,
             draw: 1, weight: 3, beatAt: beats, beatW: 0.11, beatK: 0.35,
             color: pick(1), color2: pick(2) });
    /* 内层：n 边星形，n 跟费用走（3/5/7 芒），步长 2 才出星形 */
    L.push({ prim: 'poly', r: 0.78, n: 3 + (tier % 3) * 2, step: tier >= 3 ? 2 : 1,
             spike: tier >= 2 ? 0.28 : 0, spin: -dir * (0.3 + tier * 0.04), w: 1.1,
             draw: 1, weight: 2.5, beatAt: beats, beatW: 0.1, beatK: 0.5,
             color: pick(2), color2: pick(3) });
    /* 体积：三种气质各取一（岩/焰 → 柱；霜/虚 → 旋涡；林 → 螺旋；地形 → 罩） */
    if (card.type === 'terrain') {
      L.push({ prim: 'dome', r: 0.92, lat: 4, lon: 12, w: 1.1, spin: dir * 0.3, squash: 0.6,
               weight: 2, color: pick(1), color2: pick(3) });
    } else if (card.element === 'nature') {
      L.push({ prim: 'helix', r: 0.8, n: 2, turns: 1.3, count: 18, h: 2.2 + tier * 0.2, taper: 0.7,
               w: 0.8, spin: dir * (1.2 + tier * 0.2), rise: 1.6, weight: 2,
               color: pick(1), color2: pick(3) });
    } else if (card.element === 'ice' || card.element === 'void') {
      L.push({ prim: 'vortex', rTop: 0.9, rBot: 0.08, layers: 4 + Math.min(4, tier), h: 1.6 + tier * 0.25,
               count: 32, spin: -dir * (1.4 + tier * 0.3), weight: 2, color: pick(2), color2: pick(3) });
    } else {
      L.push({ prim: 'pillar', r: 0.82, count: 4 + tier, h: 2 + tier * 0.35, w: 0.8, taper: 0.5,
               flicker: 0.3, rise: 1.8, weight: 2, color: pick(1), color2: pick(0) });
    }
    /* 4 费以上：环绕复制一圈"法针"（组合，不是特判） */
    if (tier >= 4) {
      L.push({ sat: { n: 4 + Math.min(4, tier - 3), radius: 1.1, spin: dir * (0.4 + tier * 0.06), tiltX: 0.3 },
               child: { prim: 'spokes', rIn: 0.02, rOut: 0.22 + tier * 0.01, n: 3, w: 0.8, spin: -2,
                        weight: 0.8, color: pick(3), color2: pick(1) } });
    }
    /* 6 费以上：再套一颗反向的球壳（立体，不是贴地半罩） */
    if (tier >= 6) {
      L.push({ prim: 'sphere', r: 0.78, lat: 4, lon: 10, w: 1.2, spin: -dir * 0.8, weight: 2,
               beatAt: beats, beatW: 0.14, beatK: 0.6, color: pick(2), color2: pick(0) });
    }
    /* 统一收尾：符号带（信息密度靠它撑住，但权重低，远处会被密度闸门丢掉） */
    L.push({ prim: 'glyphs', r: 0.84, n: 8 + tier * 2, size: 0.1, spin: -dir * 0.4, blink: 0.35,
             weight: 0.6, color: pick(3), color2: pick(1) });
    registerRecipe(rid, { anchor: card.type === 'summon' ? 'body' : 'ground', seed: (seed * 997) | 0,
                          budget: 24 + tier * 4, layers: L });
    AUTO[rid] = true;
    return rid;
  }

  /* ---------- 8. 事件通道：权威层只报 key，渲染层决定怎么画 ----------
     battle.js / rules.js 里调 G.VFX.event('sigilGo', {x,y,z,kind})；
     没人订阅（fx.event 不存在）时它什么都不做，绝不影响结算。 */
  var listeners = {};
  function on(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); }
  function off(name) { if (name) delete listeners[name]; }
  function event(name, data) {
    var L = listeners[name];
    if (!L || !L.length) return false;
    for (var i = 0; i < L.length; i++) { try { L[i](data || {}); } catch (e) { if (G.VFX && !G.VFX._swallow) throw e; } }
    return true;
  }

  G.VFX = {
    CLASSES: CLASSES, ANIMS: ANIMS, RECIPES: RECIPES,
    registerRecipe: registerRecipe, validateRecipe: validateRecipe,
    normalize: normalize, phaseOf: phaseOf, frame: frame, angleOf: angleOf, spinRate: spinRate,
    /* 配方自检：数据文件只留数据，检查逻辑放在这里 */
    validateAll: function () {
      var bad = [];
      for (var id in RECIPES) { var r = validateRecipe(id); if (!r.ok) bad.push(id + ': ' + r.errors.join(', ')); }
      return bad;
    },
    unitRing: unitRing, unitPoly: unitPoly, unitSpokes: unitSpokes,
    /* 递归组合的口子：回归脚本要能直接断言"展开成几片叶子、父链继承对不对" */
    expand: expand, isPlanar: isPlanar, autoRecipe: autoRecipe,
    mId: mId, mMul: mMul, mRotY: mRotY, mApply: mApply,
    on: on, off: off, event: event, hash01: hash01, clamp: clamp, num: num, _swallow: true,
    /* entity → 默认 recipe：权威层不写死特效名，渲染层只问这一句 */
    defaultFor: function (entity, role) {
      if (!entity) return null;
      var CF = G.VFX.CARD_FX || {}, PF = G.VFX.PROJECTILE_FX || {}, EF = G.VFX.ENTITY_FX || {};
      var PFE = G.VFX.PROJECTILE_FX_EL || {}, CBE = G.VFX.CARD_FX_EL || {}, CBI = G.VFX.CARD_BY_ID_FX || {};
      if (entity.kind === 'projectile' || entity.entKind === 'projectile') {
        /* 先查"这一发是谁扔的"（PROJECTILE_FX_CARD，键是 cards.js 的卡 id），再退回元素。
           陨星雨那类"弹道本身就是招牌"的卡必须走这一档：同一发火弹，焰矢与陨星不该长得一样。 */
        var pc = (G.VFX.PROJECTILE_FX_CARD || {})[entity.aiKind];
        if (pc) { var pr0 = pc[role] || pc.trail; if (pr0) return pr0; }
        var pe = PFE[entity.element];
        return (pe && pe[role]) || PF[role] || null;
      }
      if (entity.kind === 'summon') {
        /* 飞行随从与地面魔像不能共用一个光环：SUMMON_FX 按 aiKind 分档，查不到退回 summon_aura。
           权威层从头到尾只说 aiKind（cards.js 的 sp() 里那个 kind），不出现配方名。 */
        var sf = (G.VFX.SUMMON_FX || {})[entity.aiKind];
        return sf || EF.summon;
      }
      if (entity.kind === 'player') return EF.player;
      if (entity.card) {
        /* 查配方：卡 id（最具体）→ 元素（流派手感）→ 卡种（兜底）。三张表都是纯数据。 */
        var byId = CBI[entity.card.id];
        if (byId) return typeof byId === 'string' ? byId : (byId[role] || byId.cast || null);
        var el = entity.element || entity.card.element, me = CBE[el];
        if (me && (me[role] || me.cast)) return me[role] || me.cast;
        /* 手写配方之后、卡种兜底之前：给**每一张卡**自动组合一条（73 张全覆盖）。
           这就是"新卡不用一条条设计特效"的落点——它按元素×卡种×费用组合出来。 */
        var auto = autoRecipe(entity.card);
        if (auto) return auto;
        var t = entity.card.type, m = CF[t] || CF.spell;
        return m ? (m[role] || m.cast) : null;
      }
      return null;
    },
    /* 渲染层的唯一入口：不传 opts.recipe 时自动按实体类型查默认配方 */
    frameOf: function (entity, time, dt, role, opts) {
      var o = opts || {};
      if (!o.recipe) o.recipe = (entity && entity.preset && entity.preset.fx) || G.VFX.defaultFor(entity, role || 'loop');
      return G.VFX.frame(entity, time, dt, o);
    },
    /* 元素反应 → 一次性配方：GW.CHEM 只报 key（steam / obsidian / …），画什么由配方表说了算。
       查不到就返回 null，渲染层什么都不画——化学层永远不该因为特效缺失而出错。 */
    chemFor: function (kind) { var M = G.VFX.CHEM_FX || {}; return (kind && M[kind]) || null; }
  };
})(window.GW);