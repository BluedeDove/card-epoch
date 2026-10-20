/* ================= GW.WEATHER（大气层·天气权威层） =================
   "现在什么天气 / 在哪块地方是什么天气 / 这种天气让世界变成什么样"——这三问的唯一真源。

   分工（口径照 js/chem.js：权威层零 DOM、零 THREE、零玩家可见文案，只报 key 与数字）：
     · 本层只管**状态**：把地图切成 REGIONS.cell（默认 16）见方一格的气象区，每区带
       "当前天气 / 目标天气 / 过渡进度 / 强度 / 风"，按表演化；看得见的一切（云、雨、雪、雹、
       云影、闪电、雾色）全在 js/atmos.js，那边只读不写。
     · 数值全部来自 js/atmos-data.js 的 WEATHERS / TRANSITIONS / REGIONS。加一种天气 = 只动那张表。
     · **不含任何元素/魔法知识**：WEATHERS[*].mods 那组数字是给未来的"天气×元素魔法"准备的接口，
       含义由读的一方定（例如 rain.wetness 高 ⇒ 火系点不着）。本层与渲染层都不解释它、
       也不因为它改变任何状态。要加交互请去机制层（battle / rules / chem）读，别在这里写 if。

   留给未来的读法（都是稳定接口，机制层不需要改本层就能用）：
     WEATHER.sample(x, z, out)                       // 气象区双线性插值后的完整快照（渲染层每帧读这一个）
     WEATHER.at(x, z)                                // 同上但新建对象——给"顺手读一次"的机制层，别抢渲染层的 scratch
     WEATHER.FLAG(name) / WEATHER.hasFlag(sample, name)   // 语义旗标（wet / windy / electric / …），名字表 = ATMOS_DATA.FLAGS
     sample.mods.<词表名>                            // 交互系数；词表 = ATMOS_DATA.MODS（atmos_check 反查漂移）
     GW.WEATHER_HOOKS.onRegionChange / .onLightning  // 广播（渲染层已挂 onLightning；onRegionChange 空着等人挂）
   钩子是"发生了这件事"的广播，返回值不参与结算——谁想用返回值影响状态，就是走错门了。

   确定性：与 GW.CHEM 同一个理由，本层自带独立随机流 mulberry32(seed ^ 0x5EED0000)，不共用 match.rng
   ——共用会让"起风"改变 AI 之后的走位，把 audit / feel_probe 的基准搞脏。
   同种子 + 同 tick 序列 ⇒ 逐字段可复现（tools/atmos_check.cjs 有"重放 400 tick 逐字段比对"那条）。

   预算：区数 ≤ budget.perStep 时每次 step 全量推进；更多时按 budget.wheel 分帧轮转，
   每个区按"距上次推进的真实时长"补量，所以分帧不会把过渡拉快或拖慢，也不存在"某一帧全图刷一遍"。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  var D = null;                                   // G.ATMOS_DATA，bind 时取；缺表就直接不启动（不猜默认值）
  var CFG = null;                                 // D.REGIONS
  var W = G.WEATHER_HOOKS || (G.WEATHER_HOOKS = { onRegionChange: [], onLightning: [] });
  var FLAG_CACHE = {};

  function FLAG(name) {
    if (!D) return 0;
    if (name in FLAG_CACHE) return FLAG_CACHE[name];
    var i = D.FLAGS.indexOf(name);
    var b = i < 0 ? 0 : (1 << i);                 // 不认识的名字 = 0 ⇒ 永假，不抛也不假装认识
    FLAG_CACHE[name] = b;
    return b;
  }
  function easeS(x) { return x * x * (3 - 2 * x); }
  function blend(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  /* ---------- 采样字段清单：从数据表"看"出来的，加字段不必改代码 ----------
     只收数值与数值数组；字符串（precip.kind 那种）由下面的专用字段处理，插值它没有意义。 */
  var FIELDS = null;
  function collectFields(ws) {
    var out = [], seen = {};
    function push(path, outName) {
      if (seen[outName]) return;
      seen[outName] = 1;
      /* def：这张表里"没写这个字段"时该按几算。云层的 layerK 缺省必须是 1
         （不写=这层照常长云），其余缺省 0（不写=没有这项）。缺省写死在这里，
         而不是事后再拿 undefined 补一遍——补的那一步看不见"已经被写过 0"的字段。 */
      out.push({ out: outName, path: path, def: path[0] === 'layerK' ? 1 : 0 });
    }
    function walk(obj, path, prefix) {
      for (var k in obj) {
        var v = obj[k];
        if (v instanceof Array) {
          for (var i = 0; i < v.length; i++) if (typeof v[i] === 'number') push(path.concat([k, i]), prefix + k + '#' + i);
        } else if (typeof v === 'number') push(path.concat([k]), prefix + k);
        else if (v && typeof v === 'object') walk(v, path.concat([k]), prefix + k + '_');
      }
    }
    for (var id in ws) walk(ws[id], [], '');
    return out;
  }
  function numOf(p, f) {
    var v = p;
    for (var i = 0; i < f.path.length; i++) {
      if (v === null || v === undefined) return f.def || 0;
      v = v[f.path[i]];
    }
    return typeof v === 'number' ? v : (f.def || 0);
  }

  /* ---------- 气象区 ---------- */
  function Region() {
    this.index = 0; this.x0 = 0; this.z0 = 0; this.cx = 0; this.cz = 0; this.biome = 0;
    this.from = 'fair'; this.to = 'fair'; this.t = 1; this.intensity = 1; this.want = 1;
    this.windDir = 0; this.windWant = 0; this.speed = 1; this.speedWant = 1; this.gust = 0;
    this.nextAt = 0; this.boltAt = 0; this.age = 0; this.locked = false;
    this.v = {}; this.mods = {}; this.flags = 0; this.precipKind = null; this.precipRate = 0;
  }
  var regions = [], nx = 0, nz = 0, wheelCur = 0, rnd = G.mulberry32(1);
  var ST = { bound: false, regions: 0, steps: 0, updates: 0, updatesLast: 0, maxUpdates: 0,
             bolts: 0, changes: 0, forced: 0, samples: 0, lastMs: 0, maxMs: 0 };

  function presetOf(id) { return D.WEATHERS[id] || D.WEATHERS.fair; }
  function recompute(rg) {
    var A = presetOf(rg.from), B = presetOf(rg.to), tt = easeS(clamp01(rg.t)), it = rg.intensity;
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      rg.v[f.out] = blend(numOf(A, f), numOf(B, f), tt);
    }
    rg.windX = Math.sin(rg.windDir) * rg.speed;
    rg.windZ = Math.cos(rg.windDir) * rg.speed;
    /* 强度只管"这场天气多来劲"：降水直接吃它，云量与雾吃一档下限，别一低到 0 就凭空消失 */
    rg.precipRate = (rg.v.precip_rate || 0) * it;
    var dom = tt < 0.5 ? A : B;
    rg.precipKind = (dom.precip && rg.precipRate > 0) ? dom.precip.kind : null;
    rg.v.cover = (rg.v.cover || 0) * (0.62 + 0.38 * it);
    rg.v.fog_nearK = blend(1, rg.v.fog_nearK || 1, 0.35 + 0.65 * it);
    rg.v.fog_farK = blend(1, rg.v.fog_farK || 1, 0.35 + 0.65 * it);
    rg.mods = rg.mods || {};
    var mA = A.mods || {}, mB = B.mods || {};
    for (var mk in mB) rg.mods[mk] = blend(typeof mA[mk] === 'number' ? mA[mk] : 0, mB[mk], tt);
    for (var mk2 in mA) if (!(mk2 in mB)) rg.mods[mk2] = blend(mA[mk2], 0, tt);
    rg.flags = 0;
    var fl = dom.flags;
    if (fl) for (var m = 0; m < fl.length; m++) rg.flags |= FLAG(fl[m]);
  }
  function schedule(rg, holdScale) {
    var p = presetOf(rg.to), h = p.hold || CFG.hold || [20, 60];
    rg.nextAt = rg.age + blend(h[0], h[1], rnd()) * (holdScale === undefined ? 1 : holdScale);
    rg.boltAt = rg.age + blend(CFG.lightning.every[0], CFG.lightning.every[1], rnd());
    var w = p.wind || { speed: 1, gust: 0.3, turnDeg: 30 };
    rg.speedWant = w.speed; rg.gust = w.gust || 0;
    rg.windWant = rg.windDir + (rnd() * 2 - 1) * (w.turnDeg || 30) * Math.PI / 180;
  }
  function retarget(rg, to, holdScale) {
    if (!D.WEATHERS[to]) return false;
    rg.from = rg.to; rg.to = to; rg.t = 0;
    var band = presetOf(to).rate || [1, 1];
    rg.want = blend(band[0], band[1], rnd());
    schedule(rg, holdScale);
    ST.changes++;
    for (var i = 0; i < W.onRegionChange.length; i++) W.onRegionChange[i](rg.index, rg.from, rg.to, rg.cx, rg.cz);
    return true;
  }
  function weightedByBiome(table, biome) {
    var total = 0, keys = [], ws = [];
    for (var k in table) {
      var wv = table[k] > 0 ? table[k] : 0;
      if (!wv) continue;
      var p = D.WEATHERS[k];
      if (!p) continue;
      var bw = p.biome, mul = 1;
      if (bw) { var bv = bw[biome]; if (typeof bv === 'number') mul = bv; }
      wv *= mul; total += wv; keys.push(k); ws.push(wv);
    }
    if (!keys.length) return null;
    var r = rnd() * total;
    for (var i = 0; i < keys.length; i++) { r -= ws[i]; if (r <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  function stepRegion(rg, dt) {
    ST.updates++;
    rg.age += dt;
    /* 过渡时长带一点按区号散布：全场同时开始、同时结束会长成"整屏一起变天" */
    var ease = blend(CFG.easeSec[0], CFG.easeSec[1], ((rg.index * 0.6180339887) % 1));
    if (rg.t < 1) rg.t = Math.min(1, rg.t + dt / Math.max(0.5, ease));
    rg.intensity += (rg.want - rg.intensity) * Math.min(1, dt * 0.6);
    rg.speed += (rg.speedWant - rg.speed) * Math.min(1, dt * CFG.windEase);
    var dd = rg.windWant - rg.windDir;
    dd = ((dd % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    rg.windDir += dd * Math.min(1, dt * CFG.windEase);
    if (!rg.locked && rg.age >= rg.nextAt) {
      var tab = D.TRANSITIONS[rg.to] || D.START_WEIGHTS;
      var next = weightedByBiome(tab, rg.biome);
      if (next) retarget(rg, next); else rg.nextAt = rg.age + 20;
    }
    if ((rg.flags & FLAG('electric')) && rg.intensity >= CFG.lightning.minIntensity &&
        rg.v.cover >= CFG.lightning.minCover && rg.age >= rg.boltAt) {
      var j = CFG.lightning.jitter, bolts = 1 + (rnd() < CFG.lightning.doubleK ? 1 : 0);
      for (var bi = 0; bi < bolts; bi++) {
        ST.bolts++;
        for (var hi = 0; hi < W.onLightning.length; hi++)
          W.onLightning[hi]({ x: rg.cx + (rnd() * 2 - 1) * j + bi * 1.7, y: CFG.lightning.boltY,
                              z: rg.cz + (rnd() * 2 - 1) * j, strength: rg.intensity * (bi ? 0.65 : 1) });
      }
      rg.boltAt = rg.age + blend(CFG.lightning.every[0], CFG.lightning.every[1], rnd());
    }
    recompute(rg);
  }

  function mkSample() {
    return { id: 'fair', prev: 'fair', t: 1, intensity: 1, region: 0, biome: 0, flags: 0,
             windX: 0, windZ: 0, speed: 0, gust: 0, precipKind: null, precipRate: 0, v: {}, mods: {} };
  }

  var WEATHER = G.WEATHER = {
    HOOKS: W, ready: false, stats: ST,

    /* 开局绑定：由 main.js 装配层调用。本层不认识 match，只借世界尺寸与群系。 */
    bind: function (world, opts) {
      D = G.ATMOS_DATA;
      WEATHER.ready = false;
      if (!D || !D.WEATHERS || !D.REGIONS || !world) return false;
      CFG = D.REGIONS;
      FIELDS = collectFields(D.WEATHERS);
      var cell = CFG.cell;
      nx = Math.max(1, Math.ceil(world.SX / cell));
      nz = Math.max(1, Math.ceil(world.SZ / cell));
      rnd = G.mulberry32((((opts && opts.seed) || world.seed || 1) >>> 0) ^ 0x5EED0000);
      regions = [];
      for (var iz = 0; iz < nz; iz++) for (var ix = 0; ix < nx; ix++) {
        var rg = new Region();
        rg.index = iz * nx + ix;
        rg.x0 = ix * cell; rg.z0 = iz * cell;
        rg.cx = Math.min(world.SX - 1, ix * cell + (cell >> 1));
        rg.cz = Math.min(world.SZ - 1, iz * cell + (cell >> 1));
        rg.biome = world.biomeAt ? world.biomeAt(rg.cx, rg.cz) : 0;
        var start = weightedByBiome(D.START_WEIGHTS, rg.biome) || 'fair';
        rg.from = start; rg.to = start; rg.t = 1;
        var band = presetOf(start).rate || [1, 1];
        rg.intensity = rg.want = blend(band[0], band[1], rnd());
        rg.windDir = rg.windWant = rnd() * Math.PI * 2;
        recompute(rg);
        schedule(rg, 0.15 + rnd() * 0.85);       // 起手就散开：否则一进场所有区同时变天
        regions.push(rg);
      }
      wheelCur = 0;
      ST.bound = true; ST.regions = regions.length;
      ST.steps = ST.updates = ST.updatesLast = ST.maxUpdates = ST.bolts = ST.changes = ST.forced = ST.samples = 0;
      WEATHER.ready = true;
      return true;
    },

    /* 每权威 tick 一次：main.js 在 Match.step 之后调，暂停/结算画面自然就不长。 */
    step: function (dt) {
      if (!WEATHER.ready || !(dt > 0)) return false;
      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      ST.steps++; ST.updates = 0;
      var n = regions.length, cap = Math.max(1, Math.min(CFG.budget.perStep, n));
      if (cap >= n) { for (var i = 0; i < n; i++) stepRegion(regions[i], dt); }
      else {
        var per = dt * (n / cap);
        for (var k = 0; k < cap; k++) { stepRegion(regions[wheelCur], per); wheelCur = (wheelCur + 1) % n; }
      }
      ST.updatesLast = ST.updates;
      if (ST.updates > ST.maxUpdates) ST.maxUpdates = ST.updates;
      if (t0) { var ms = performance.now() - t0; ST.lastMs = ms; if (ms > ST.maxMs) ST.maxMs = ms; }
      return true;
    },

    /* ---------- 读 ----------
       双线性插值四个最近区心 ⇒ 走过区界时"雨渐渐小下去"，不是墙一样的一条界线。
       风向不能插值（350° 与 10° 平均成 180°），所以插的是风速向量，再回推方向与大小。 */
    sample: function (x, z, out) {
      if (!WEATHER.ready) return false;
      ST.samples++;
      var s = out || mkSample();
      var cell = CFG.cell;
      var fx = (x - cell * 0.5) / cell, fz = (z - cell * 0.5) / cell;
      var ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
      if (ix < 0) { ix = 0; tx = 0; } else if (ix > nx - 2) { ix = Math.max(0, nx - 2); tx = nx > 1 ? 1 : 0; }
      if (iz < 0) { iz = 0; tz = 0; } else if (iz > nz - 2) { iz = Math.max(0, nz - 2); tz = nz > 1 ? 1 : 0; }
      var i00 = iz * nx + ix;
      var r00 = regions[Math.min(regions.length - 1, i00)];
      var r10 = regions[Math.min(regions.length - 1, i00 + 1)];
      var r01 = regions[Math.min(regions.length - 1, i00 + nx)];
      var r11 = regions[Math.min(regions.length - 1, i00 + nx + 1)];
      var w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
      var near = (tx < 0.5 ? (tz < 0.5 ? r00 : r01) : (tz < 0.5 ? r10 : r11));
      s.id = near.to; s.prev = near.from; s.t = near.t; s.intensity = near.intensity;
      s.region = near.index; s.biome = near.biome; s.flags = near.flags;
      for (var i = 0; i < FIELDS.length; i++) {
        var key = FIELDS[i].out;
        s.v[key] = r00.v[key] * w00 + r10.v[key] * w10 + r01.v[key] * w01 + r11.v[key] * w11;
      }
      var mk = near.mods;
      for (var a in mk) s.mods[a] = (r00.mods[a] || 0) * w00 + (r10.mods[a] || 0) * w10 + (r01.mods[a] || 0) * w01 + (r11.mods[a] || 0) * w11;
      var wx = r00.windX * w00 + r10.windX * w10 + r01.windX * w01 + r11.windX * w11;
      var wz = r00.windZ * w00 + r10.windZ * w10 + r01.windZ * w01 + r11.windZ * w11;
      s.windX = wx; s.windZ = wz; s.speed = Math.sqrt(wx * wx + wz * wz);
      s.gust = r00.gust * w00 + r10.gust * w10 + r01.gust * w01 + r11.gust * w11;
      s.precipRate = r00.precipRate * w00 + r10.precipRate * w10 + r01.precipRate * w01 + r11.precipRate * w11;
      s.precipKind = s.precipRate > 0 ? near.precipKind : null;
      return s;
    },

    at: function (x, z) { return WEATHER.sample(x, z, mkSample()); },

    FLAG: FLAG,
    hasFlag: function (sample, name) { var b = FLAG(name); return b ? (sample.flags & b) !== 0 : false; },

    regions: function () {
      var out = [];
      for (var i = 0; i < regions.length; i++) {
        var rg = regions[i];
        out.push({ index: rg.index, id: rg.to, prev: rg.from, t: rg.t, intensity: rg.intensity,
                   cover: rg.v.cover, biome: rg.biome, x: rg.cx, z: rg.cz,
                   windX: Math.sin(rg.windDir) * rg.speed, windZ: Math.cos(rg.windDir) * rg.speed,
                   precip: rg.precipKind, rate: rg.precipRate, locked: rg.locked });
      }
      return out;
    },

    /* ---------- 写：调试、剧本、以及未来"某个技能在脚下开一场 storm" ----------
       一律返回 {ok, ...}；不认识的天气名 {ok:false, reason:'unknown-weather'}，不许假成功。
       force 默认锁住（hold=Infinity）——截屏/复现时不希望它自己飘走；release 交还自动演化。 */
    force: function (id, opts) {
      if (!WEATHER.ready) return { ok: false, reason: 'not-bound' };
      if (!D.WEATHERS[id]) return { ok: false, reason: 'unknown-weather' };
      opts = opts || {};
      var hit = 0, rad = opts.radius === undefined ? Infinity : opts.radius;
      var lock = opts.hold === undefined ? Infinity : opts.hold;
      for (var i = 0; i < regions.length; i++) {
        var rg = regions[i];
        if (opts.x !== undefined && Math.hypot(rg.cx - opts.x, rg.cz - opts.z) > rad) continue;
        if (!retarget(rg, id, lock === Infinity ? Infinity : Math.max(0, lock))) continue;
        if (opts.intensity !== undefined) rg.want = rg.intensity = clamp01(opts.intensity);
        rg.locked = lock === Infinity;
        recompute(rg);
        hit++;
      }
      ST.forced += hit;
      return { ok: hit > 0, changed: hit, id: id };
    },
    release: function () {
      if (!WEATHER.ready) return { ok: false, reason: 'not-bound' };
      for (var i = 0; i < regions.length; i++) { regions[i].locked = false; schedule(regions[i]); }
      return { ok: true, regions: regions.length };
    },

    spec: function () {
      return { ready: WEATHER.ready, regions: regions.length, cell: CFG ? CFG.cell : 0,
               perStep: CFG ? CFG.budget.perStep : 0, wheel: CFG ? CFG.budget.wheel : 0,
               mods: D ? D.MODS : [], flags: D ? D.FLAGS : [], steps: ST.steps, bolts: ST.bolts,
               changes: ST.changes, forced: ST.forced, samples: ST.samples,
               maxUpdates: ST.maxUpdates, lastMs: +ST.lastMs.toFixed(3), maxMs: +ST.maxMs.toFixed(3) };
    },

    /* 能调的旋钮只有预算与过渡速度；越界夹住，不认的键返回 false（不静默接受） */
    set: function (k, v) {
      if (!CFG) return false;
      var n = parseFloat(v);
      if (!isFinite(n)) return false;
      if (k === 'perStep') { CFG.budget.perStep = Math.max(1, Math.min(4096, n | 0)); return true; }
      if (k === 'wheel') { CFG.budget.wheel = Math.max(1, Math.min(64, n | 0)); return true; }
      if (k === 'cell') { CFG.cell = Math.max(4, Math.min(128, n | 0)); return true; }
      if (k === 'easeMin') { CFG.easeSec[0] = Math.max(0.5, Math.min(240, n)); return true; }
      if (k === 'easeMax') { CFG.easeSec[1] = Math.max(0.5, Math.min(480, n)); return true; }
      return false;
    }
  };

})(window.GW);
