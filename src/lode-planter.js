/* js/lode-planter.js · L1 world（只在生成期跑一次，零 tick 成本）
   依赖：js/world.js（G.World / G.GroundProbe / G.BLOCK / G.mulberry32）、js/reachability-gate.js（G.ReachabilityGate）
   只回答这一个问题：三条以太矿脉（Lode）该放在哪、放下去占哪些格。

   布局（GAMEPLAY §2.4，2026-10-17 镜像对修订）：中矿 = 两出生点连线中点；
   两翼矿 = 相对出生点连线方向 +120° 与 +60°、半径 r ∈ [18,23] 各一点——一翼偏向
   一侧出生点（−0.5r 轴向分量），另一翼镜像偏向另一侧（+0.5r）：每边各有一条"家门矿"，
   中矿是争夺矿。±120° 双翼同偏一侧的旧案会让一侧系统性少一条矿，已否决（逐矿差 38–63%）；
   ±90° 双翼公平但三点共线（叉积 = 0），争夺被压成一条走廊，同样否决。
   中-翼 = r ∈ [18,23]、翼-翼 = (rA²+rB²−rA·rB)^½ ∈ [18,23]（两翼夹角 60°），
   恒在连通闸 [18,40] 内；三点叉积 = rA·rB·sin60° ≥ 280，恒不共线。
   抖动走 mulberry32(seed ^ 0x9A11 ^ salt) 独立派生——与 generate() 既有生成流（柱体→液体→
   veins 埋晶→植树）完全不共用随机号，同 seed 才逐格一致（play_probe H1 的命门）。
   多图尺度（docs/LEVELS.md §3 定案 v1，2026-10-18）：适用图 = **正方形且边长 ≥ 64**
   （w.SX === w.SZ && w.SX >= 64）；不适用（非方形 / 小于 64）原样返回 null 且一格不写。
   尺度因子 scale = w.SX / 64，**只有"距离"类常数乘 scale**：翼矿半径 [18,23]×scale、
   翼-翼与连通闸 [18,40]×scale。与距离无关的量一律不缩放（3×3 台面认证、候选环 6 格、
   步进 2 格、走廊 3 格宽、高差 ≤1）——它们是"一柱能不能站人"的尺子，与图多大无关。
   **scale = 1（64×36×64）时逐格结果与本次改动前完全一致**（乘 1 不改变任何一个数）：
   这条由 play_probe 的 H1 + L1–L4c 三种子守着，大图不退化由 tools/lode_scale_check.cjs 守着。

   换盐与回滚（GAMEPLAY §5「排序公平由生成器负责」+ 机制线 2026-10-17 定死）：
   8 次尝试全部跑完，过闸图按 ReachabilityGate.fairScore 竞选最小者（并列保序号最小）。
   **回滚 = 每次尝试后整图复位到地形基线，不做增量撤销**——漏撤一格残迹就只会在
   "8 次尝试"路径上出现、单独重放看不到，是最难查的那类 bug。被选中那次最后**重放一遍**：
   终图 = 基线 + 同一个 salt + 同一条代码路径，与"直接以该 salt 一次生成"逐格一致
   （play_probe L4c 逐格核这条，world.js 的 opts.lodeSalt 是它的直通入口）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  if (typeof require === 'function') { try { require('./reachability-gate.js'); } catch (e) { /* 浏览器走 script 序列 */ } }

  var WING_ANGLE_A = 2.0943951023931953;  /* +120°（2π/3）：偏向 side0 的家门矿 */
  var WING_ANGLE_B = 1.0471975511965976;  /* +60°（π/3）：偏向 side1 的家门矿，与 A 成 60° 镜像对 */
  /* 下面四个是**以 64 图为单位 1** 的基准常数；plant() 里按 scale = w.SX/64 乘出当次用的值。
     写成基准值 + 缩放（而不是把 27/36 直接写死）是为了 scale=1 时逐字节等于旧实现。 */
  var R_MIN = 18, R_SPAN = 6;            /* 半径 r ∈ [18,23] */
  var BAND_MID_LO = 18, BAND_MID_HI = 23;  /* 翼矿到中矿的环带 */
  var BAND_PAIR_LO = 18, BAND_PAIR_HI = 40; /* 两翼之间（= 连通闸宽） */
  var MAX_SALT = 8;                      /* 换盐上限：8 次尝试全部评分，不再首过即停 */

  /* 矿脉台面的否决表：非水非冰非岩浆（GAMEPLAY §2.4.2 的原文只有这三样），外加基岩与既有晶体。
     高度尺 camGroundY（跳过树叶）：树冠不否决——§2.4.2 没说不许在林里开矿，放置时自己清出
     一块林中空地（与主路整平砍树冠同一口径）。水/岩浆淹没柱由 noSubmerge 另查（camGroundY
     穿过液体取到水底，不查会把矿种进湖底）。
     注意不能按 DEFS.burn 否决"可燃物"——草的 burn='leaf' 是火蔓延口径，不是"不能站"；
     把草否了等于把全图绝大多数地表否掉（第一版就是这么让 37 个候选全灭的）。 */
  function rejectTop(id) {
    var B = G.BLOCK, d = G.BLOCK_DEFS[id];
    return id === B.WATER || id === B.LAVA || !d.solid || !!d.slip || id === B.BEDROCK || id === B.CRYSTAL;
  }
  function noSubmerge(w) {
    return function (x, z) {
      var B = G.BLOCK, y = w.camGroundY(x, z), a = w.get(x, y + 1, z);
      return a !== B.WATER && a !== B.LAVA;
    };
  }
  var PROBE = { maxRing: 6, angles: 6, margin: 2, rejectTop: rejectTop, ground: 'cam', flat: true };

  /* 落点探测（GAMEPLAY §2.4.2）：候选点半径 6 局部（≤37 格）找 3×3 平坦台面；
     失败沿给定方向步进 2 格重试，上限 6 次（正向 3 次后换反向 3 次，别把矿拖出闸距）。
     opts.accept(x,z)：额外接受条件——翼矿用它把落点箍在距中矿 [18,23] 的环带里，
     否则环形搜索/步进的侧滑会把中-翼距滑出 [18,40] 闸门（490706 实测 8 盐全死在 lode-distance）。 */
  function probeNear(w, cx, cz, dirX, dirZ, accept) {
    var ns = noSubmerge(w);
    var opts = Object.assign({}, PROBE, { accept: accept ? function (x, z) { return ns(x, z) && accept(x, z); } : ns });
    var at = G.GroundProbe.find(w, cx, cz, opts);
    if (at) return at;
    for (var k = 1; k <= 6; k++) {
      var sgn = k <= 3 ? 1 : -1, step = (k <= 3 ? k : k - 3) * 2;
      at = G.GroundProbe.find(w, Math.round(cx + dirX * sgn * step), Math.round(cz + dirZ * sgn * step), opts);
      if (at) return at;
    }
    return null;
  }
  /* 环带必须箍在**真实中矿平台**上，不是几何中点：平台本身可能被探测步进挪了几格，
     拿几何中点当圆心，中-翼距会漂出 [18,40]（490706 实测 23.7/15.8 就是这么来的）。
     翼 B 还要同时满足与翼 A 的两两闸距——候选探测阶段就排掉，别烧换盐次数。 */
  function wingBand(cx0, cz0, lo, hi) {
    return function (x, z) { var d = Math.hypot(x - cx0, z - cz0); return d >= lo - 1e-9 && d <= hi + 1e-9; };
  }

  /* 生成期写格（仍在 generate() 内部：snapshotBaseline 在其后，矿脉是基线的一部分，
     WORLD_HOOKS.onSet 此时为空，不污染存档 diff、不惊动 chem——GAMEPLAY §7.1 条 18 口径）。 */
  function put(w, x, y, z, id) { w.set(x, y, z, id); }
  /* 整图复位到地形基线：换盐之间的唯一"回滚"方式（机制线定死，不做增量撤销）。
     meta 生成期为空、光照登记与列高缓存随 generate() 末尾同口径重置。 */
  function restoreBase(w, base) {
    w.blocks.set(base);
    w.meta.clear();
    if (w._ct) w._ct.fill(-2);
    w._yr = {}; w._lf = {};
    w._emBuilt = false; w._em = new Map(); w._emBy = {};
    w.dirty.clear();
  }

  /* 一条矿的实体：1 格 bedrock 底座（替换台面顶块，矿点不可被抹除）+ 顶部 1 格 crystal
     + 四邻随机 2 格 crystal（晶体必须露头：地表剪影 = 经济存在，GAMEPLAY §2.4.3）。
     邻居格若不是纯空气（树/旧晶）就跳过——顶部那颗由平台认证兜底，露头恒 ≥1。 */
  function writeLode(w, rng, plat) {
    var B = G.BLOCK, cells = [];
    /* 先清出林中空地：平台 3×3 各自清到真地面之上（树冠/残干剥掉，地面块不动）。
       不清的话晶体戳在树冠底下，"地表剪影"在森林里照样不存在。 */
    for (var cx = -1; cx <= 1; cx++) for (var cz = -1; cz <= 1; cz++) {
      var gx = plat.x + cx, gz = plat.z + cz, gy = w.camGroundY(gx, gz);
      if (gy < 0) continue;
      for (var cy = Math.max(gy + 1, plat.y + 1); cy <= w.surfaceY(gx, gz); cy++) put(w, gx, cy, gz, 0);
    }
    put(w, plat.x, plat.y, plat.z, B.BEDROCK);
    put(w, plat.x, plat.y + 1, plat.z, B.CRYSTAL);
    var crystals = [[plat.x, plat.y + 1, plat.z]];
    var NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var i1 = Math.floor(rng() * 4), i2 = (i1 + 1 + Math.floor(rng() * 3)) % 4;
    [i1, i2].forEach(function (ni) {
      var nx = plat.x + NB[ni][0], nz = plat.z + NB[ni][1];
      var ny = w.camGroundY(nx, nz);
      if (ny >= 0 && w.get(nx, ny + 1, nz) === 0) {
        put(w, nx, ny + 1, nz, B.CRYSTAL);
        crystals.push([nx, ny + 1, nz]);
      }
    });
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) cells.push([plat.x + dx, plat.z + dz]);
    return { x: plat.x, y: plat.y, z: plat.z, crystals: crystals, cells: cells };
  }

  /* 主路整平（GAMEPLAY §2.4.5）：出生点→中矿 3 格宽走廊，相邻柱高差钳到 ≤1，只降不升。
     单向前钳不够：出生点若落在 20+ 的孤峰上，出方向的下崖（24→15）在前向 pass 里"已经更低"
     不会被处理，BFS 当场断在出生平台边——所以每条车道做**前向 + 后向两趟**，前趟保证
     离站爬坡 ≤1，后趟把下崖反推成楼梯（两趟都只降，不违反"只降不升"）。
     出生柱不保护：整平后重算出生点（A-1 起 spawnPts 开局缓存，读的就是完工后的世界），
     坡面本身就是 ±1 的可站立平地；矿脉平台（切比雪夫 ≤1）仍只观察不写，不许把站台刨了。
     降柱时连同柱顶积水/岩浆一起清（主路安全而绕）。 */
  function flattenCorridor(w, s, mid, protect) {
    var B = G.BLOCK;
    var dx = mid.x - s.x, dz = mid.z - s.z, n = Math.max(Math.abs(dx), Math.abs(dz));
    if (!n) return;
    var px = Math.round(-dz / n), pz = Math.round(dx / n);
    var lanes = [[0, 0]];
    if (px || pz) { lanes.push([px, pz], [-px, -pz]); }
    /* 走廊的高度尺是 camGroundY（跳过树叶）：surfaceY 把树冠当地面，88092 的林海出生区
       会在树冠高度上钳出一条悬空阶梯，真地面 14、叶子 19，BFS 当场断在出生台边。 */
    function groundAt(cx, cz) { var g = w.camGroundY(cx, cz); return g < 0 ? 0 : g; }
    function lowerTo(cx, cz, target) {                     /* 把一柱降到 target（连柱顶树冠/水/岩浆一起清） */
      var g0 = groundAt(cx, cz), top = w.get(cx, g0, cz);
      if (top === B.BEDROCK || top === B.CRYSTAL || g0 <= target) return g0;
      var yTop = w.surfaceY(cx, cz), above;
      while ((above = w.get(cx, yTop + 1, cz)) === B.WATER || above === B.LAVA) yTop++;
      for (var yy = target + 1; yy <= yTop; yy++) put(w, cx, yy, cz, 0);
      return target;
    }
    function clampPass(cells) {
      var prev = null;
      for (var i = 0; i < cells.length; i++) {
        var cx = cells[i][0], cz = cells[i][1];
        var h = groundAt(cx, cz);
        var guarded = false;
        for (var g = 0; g < protect.length; g++)
          if (Math.abs(cx - protect[g][0]) <= 1 && Math.abs(cz - protect[g][1]) <= 1) { guarded = true; break; }
        if (!guarded && prev !== null && h > prev + 1) h = lowerTo(cx, cz, prev + 1);
        /* 高差链永远跟"整平后的真实高度"走：降过的柱取新值，写不了的保护柱取原值。 */
        prev = h;
      }
    }
    for (var li = 0; li < lanes.length; li++) {
      var cells = [], lastX = null, lastZ = null;
      for (var i = 0; i <= n; i++) {
        var cx = Math.round(s.x + dx * i / n) + lanes[li][0];
        var cz = Math.round(s.z + dz * i / n) + lanes[li][1];
        if (cx === lastX && cz === lastZ) continue;
        lastX = cx; lastZ = cz;
        if (cx < 1 || cz < 1 || cx >= w.SX - 1 || cz >= w.SZ - 1) continue;
        cells.push([cx, cz]);
      }
      clampPass(cells);
      cells.reverse();
      clampPass(cells);
    }
    /* 出生台整平：走廊两趟钳完之后，把出生柱的 3×3 降到同一高度——出生点的环形搜索
       首候选（[0,0] 原地）就能在原位站住，且出生台与走廊第一格高差 ≤1（链上就是它钳出来的）。
       不这么做，孤峰出生点的 3×3 不平坦认证会失败，出生点被环形搜索甩到别处，又可能变孤岛。 */
    var h0 = groundAt(s.x, s.z);
    for (var ax = -1; ax <= 1; ax++) for (var az = -1; az <= 1; az++) {
      lowerTo(s.x + ax, s.z + az, h0);
      /* 台面上方的树冠残余也剥掉：surfaceY 把叶子当地面，留着它们出生点的 3×3 平坦认证照样失败 */
      for (var cy = h0 + 1; cy <= w.surfaceY(s.x + ax, s.z + az); cy++) put(w, s.x + ax, cy, s.z + az, 0);
    }
  }

  /* 只回答正方形且边长 ≥64 的图（64/96/128 三档由 scale 承担）；返回 world.lodes（可汇报明细），
     不适用时返回 null 且一格不写。
     opts.forceSalt：直通单盐种植（不做竞选）——play_probe L4c 用 world.js opts.lodeSalt 走到这里，
     验证"选中图 == 同 seed 直接以该 salt 一次生成"。 */
  function plant(w, opts) {
    if (w.SX !== w.SZ || w.SX < 64) return null;      /* 只认正方形图，且不小于 64（多图定案 §3） */
    var scale = w.SX / 64;                            /* 1 = 64 图：下面所有乘 scale 的量与改动前逐位相同 */
    var forceSalt = opts && opts.forceSalt !== undefined ? (opts.forceSalt >>> 0) : null;
    var sp0 = w.spawnPoint(0), sp1 = w.spawnPoint(1);
    var s0 = [Math.floor(sp0.x), Math.floor(sp0.z)], s1 = [Math.floor(sp1.x), Math.floor(sp1.z)];
    var midX = Math.round((s0[0] + s1[0]) / 2), midZ = Math.round((s0[1] + s1[1]) / 2);
    var th = Math.atan2(s1[1] - s0[1], s1[0] - s0[0]);
    var midPlat = probeNear(w, midX, midZ, Math.cos(th), Math.sin(th));
    if (!midPlat) {                                  /* 中点 6 向步进都找不到台面：如实报，不硬塞 */
      w.lodes = { degraded: true, retries: 0, reason: 'mid-platform', list: [], dists: [], cross: 0,
                  spawns: [sp0, sp1], gate: null };
      return w.lodes;
    }

    /* 一次尝试 = 同一个 salt 把三矿种上、主路整平、过闸。世界状态进 = 地形基线、出 = 候选图；
       返回的句柄足够评分（gate/fairScore）与汇报（lodes/gate/spawns/cross）。 */
    function attemptOnce(salt) {
      var rng = G.mulberry32((w.seed ^ 0x9A11 ^ salt) >>> 0);
      /* 距离类常数一律乘 scale；scale=1 时右端与旧的 "18 + Math.floor(rng()*6)" 完全同值 */
      var rMin = R_MIN * scale, rSpan = R_SPAN * scale;
      var rA = rMin + Math.floor(rng() * rSpan), rB = rMin + Math.floor(rng() * rSpan);
      var tA = th + WING_ANGLE_A, tB = th + WING_ANGLE_B;
      var bandM = wingBand(midPlat.x, midPlat.z, BAND_MID_LO * scale, BAND_MID_HI * scale);
      var platA = probeNear(w, Math.round(midX + Math.cos(tA) * rA), Math.round(midZ + Math.sin(tA) * rA), Math.cos(tA), Math.sin(tA), bandM);
      if (!platA) return { ok: false, reason: 'platform-A' };
      var bandB = wingBand(midPlat.x, midPlat.z, BAND_MID_LO * scale, BAND_MID_HI * scale);
      var bandAB = wingBand(platA.x, platA.z, BAND_PAIR_LO * scale, BAND_PAIR_HI * scale);
      var platB = probeNear(w, Math.round(midX + Math.cos(tB) * rB), Math.round(midZ + Math.sin(tB) * rB), Math.cos(tB), Math.sin(tB),
        function (x, z) { return bandB(x, z) && bandAB(x, z); });
      if (!platB) return { ok: false, reason: 'platform-B' };
      var mid = writeLode(w, rng, midPlat);
      var lodA = writeLode(w, rng, platA);
      var lodB = writeLode(w, rng, platB);
      var protect = [[midPlat.x, midPlat.z], [platA.x, platA.z], [platB.x, platB.z]];
      flattenCorridor(w, { x: s0[0], z: s0[1] }, midPlat, protect);
      flattenCorridor(w, { x: s1[0], z: s1[1] }, midPlat, protect);
      /* 闸门问的是整平后的真实世界：出生点重算一次（A-1 起 spawnPts 开局缓存，复活语义也读它）。 */
      var sp0f = w.spawnPoint(0), sp1f = w.spawnPoint(1);
      /* 闸门用缩放后的闸宽；缺省（第 4 个参数不传）就是 [18,40]，故 64 图行为不变 */
      var gate = G.ReachabilityGate.check(w, [{ x: Math.floor(sp0f.x), z: Math.floor(sp0f.z) }, { x: Math.floor(sp1f.x), z: Math.floor(sp1f.z) }], [mid, lodA, lodB],
        { distMin: BAND_PAIR_LO * scale, distMax: BAND_PAIR_HI * scale });
      var cross = (lodA.x - mid.x) * (lodB.z - mid.z) - (lodA.z - mid.z) * (lodB.x - mid.x);
      if (!gate.ok) return { ok: false, reason: gate.reasons.join('+'), gate: gate };
      return { ok: true, salt: salt, gate: gate, cross: cross, mid: mid, lodA: lodA, lodB: lodB, sp0f: sp0f, sp1f: sp1f };
    }
    function lodeInfo(fin, attempts, fair) {
      return { degraded: false, retries: fin.salt, reason: null, list: [fin.mid, fin.lodA, fin.lodB], attempts: attempts,
               dists: fin.gate.dists, cross: fin.cross, spawns: [fin.sp0f, fin.sp1f], gate: fin.gate,
               salt: fin.salt, fairScore: fair === undefined ? +G.ReachabilityGate.fairScore(fin.gate).toFixed(4) : fair };
    }
    /* 退化 = 单中矿图（主路照整、中矿照种，盐用 MAX_SALT 派生）——退化必须能报出来。 */
    function degrade(reason, attempts) {
      var rng0 = G.mulberry32((w.seed ^ 0x9A11 ^ MAX_SALT) >>> 0);
      var midOnly = writeLode(w, rng0, midPlat);
      flattenCorridor(w, { x: s0[0], z: s0[1] }, midPlat, [[midPlat.x, midPlat.z]]);
      flattenCorridor(w, { x: s1[0], z: s1[1] }, midPlat, [[midPlat.x, midPlat.z]]);
      var sp0d = w.spawnPoint(0), sp1d = w.spawnPoint(1);
      var gate0 = G.ReachabilityGate.check(w, [{ x: Math.floor(sp0d.x), z: Math.floor(sp0d.z) }, { x: Math.floor(sp1d.x), z: Math.floor(sp1d.z) }], [midOnly],
        { distMin: BAND_PAIR_LO * scale, distMax: BAND_PAIR_HI * scale });
      w.lodes = { degraded: true, retries: MAX_SALT, reason: reason, list: [midOnly], attempts: attempts,
                  dists: [], cross: 0, spawns: [sp0d, sp1d], gate: gate0 };
      return w.lodes;
    }

    /* forceSalt 直通：单盐一次种植（L4c 的"直接生成"路径；不过闸照样走退化，如实报） */
    if (forceSalt !== null) {
      var one = attemptOnce(forceSalt);
      if (one.ok) { w.lodes = lodeInfo(one, [{ salt: forceSalt, reason: 'ok(forceSalt)' }]); return w.lodes; }
      return degrade('forceSalt-' + one.reason, [{ salt: forceSalt, reason: one.reason }]);
    }

    /* 竞选：8 次尝试全部跑完，每次之后整图复位到地形基线（不做增量撤销）；
       过闸图记 fairScore 进候选，最后重放最小者——终图与"直接以该 salt 一次生成"同路径。 */
    var base = w.blocks.slice(0), attempts = [], cands = [];
    for (var salt = 0; salt < MAX_SALT; salt++) {
      var res = attemptOnce(salt);
      if (res.ok) {
        res.score = G.ReachabilityGate.fairScore(res.gate);
        attempts.push({ salt: salt, reason: 'ok', score: +res.score.toFixed(4), steps0: res.gate.steps0.slice(), steps1: res.gate.steps1.slice(), dists: res.gate.dists.map(function (d) { return +d.toFixed(1); }) });
        cands.push(res);
      } else {
        attempts.push({ salt: salt, reason: res.reason, steps0: res.gate ? res.gate.steps0.slice() : [], steps1: res.gate ? res.gate.steps1.slice() : [] });
      }
      restoreBase(w, base);
    }
    var best = G.ReachabilityGate.pickBest(cands);
    if (!best) return degrade('gate-8-salts', attempts);
    var fin = attemptOnce(best.salt);              /* 重放被选中那次：基线 + 同 salt + 同路径 */
    w.lodes = lodeInfo(fin, attempts, +best.score.toFixed(4));
    return w.lodes;
  }

  G.LodePlanter = { plant: plant };
})(window.GW);
