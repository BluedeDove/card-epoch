/* ================= GW.CHEM =================
   方块与方块之间的元素交互：火扔到树上就该烧起来，冰砸到火上就该化成一摊水。

   两条硬要求（用户 2026-10-16 明确点过）：
     ① 表现要"理所当然"——反应由**物质属性**决定，不由方块名写死。加一种新方块只要填
        DEFS 那几项（flammable / burnDur / burnTo / spread / meltsTo / fluid / coolsTo /
        freezesTo / quenches / stable），本文件的反应表不用动；想加一种新反应，只动 REACT 表。
     ② 性能要友好——世界 96×40×96 = 36.8 万格，**绝不整图扫描**。抄 Noita 的 dirty rectangle：
        只有"自己会持续变化"的格常驻激活集（火、岩浆），其余格子在**自己或邻居被改动的瞬间**
        被唤醒一次（见 js/world.js 的 WORLD_HOOKS.onSet）。每 tick 两条硬预算
        （看 56 格 / 改 8 格），超了排队到下 tick，所以不存在"某一 tick 卡 20ms"。

   分层：本文件属权威层——零 DOM、零 THREE、零玩家可见文案。
   告诉玩家发生了什么只报 key（steam / obsidian / ash / ignite / melt / freeze），
   中文在 js/hud.js 的 H.TEXT.chem；看得见的火苗与蒸汽由 GW.VFX.event('react', {kind}) 交给渲染层。

   确定性：本层自带一条与对局 rng 分开的随机流（mulberry32(seed ^ 0xC0FFEE)）。
   不共用 match.rng 是故意的——共用会让"点了火"这件事改变 AI 之后的走位，
   同种子重放与已有回归基准（audit / feel_probe / vfx_check）就对不上了。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;

  var CFG = G.CHEM_CFG = {
    cellsPerTick: 56,        // 每 tick 最多"看"多少个激活格（看完的留下 tick，不丢）
    editsPerTick: 8,         // 每 tick 最多真正改写多少格（chunk 重建的唯一代价来源）
    slotSec: 0.1,            // 定时轮一格 = 100ms
    wheelSlots: 16,          // 16 槽 → 最长 1.6s 延时（够：最长的蔓延节拍 0.5s）
    queueCap: 3072,          // 激活队列容量；满了丢"新请求"，不丢已排队的（火场不会越点越卡）
    maxBurning: 420,         // 全场同时燃烧格上限：山火烧到这条线就停，不留一张无解的地图
    spreadEvery: 0.5,        // 燃烧格多久探一次邻居
    meltDelay: 0.3,          // 冰/雪被烤到"化成水"之间的延迟：先起雾、再淌水，也不许一 tick 内化完又抽干
    heatEvery: 0.45,         // 岩浆这类常驻热源多久探一次邻居
    lavaIgnite: 0.22,        // 热源每轮引燃一个可燃邻居的概率（低一点，给玩家反应时间）
    fireUp: 1.0, fireSide: 0.55, fireDown: 0.18,   // 火往上爬：向下蔓延最弱（物理上就不太成立）
    footIgnite: 0.10,        // 带 burning 的单位每 tick 点燃脚下格的概率（0.10×20Hz ≈ 2s 一次）
    bodyBurn: 0.06,          // 站进火格的单位每 tick 被燎到的概率（≈ 每 0.8s 一次）
    logThrottle: 1.1,        // 同一种反应多久允许往日志报一次（防火场刷屏）
    fxEvery: 0.14            // 同一种反应多久允许往画面报一次（粒子 + GW.VFX 事件）
  };

  /* 唤醒"原因"位。HEAT = 火焰元素直接命中（要即时给反馈）；WARM = 环境热源（岩浆淌在旁边、
     放下一块岩浆），它只把格子排进队列，真正点着要靠热源那一格自己按 lavaIgnite 概率慢慢来。
     两条分开写是因为早期把它们合成一个标记，结果"环境热源"变成了一放上去就瞬间起火。 */
  var WHY_HEAT = 1, WHY_COLD = 2, WHY_SHOCK = 4, WHY_WARM = 8;

  /* ---------- 属性判定：读 DEFS 的字段，不读方块名 ---------- */
  function flammableOf(id) { var d = DEFS[id]; return !!(d && d.flammable); }
  function meltsToOf(id) { var d = DEFS[id]; return (d && d.meltsTo) || null; }
  function freezesToOf(id) { var d = DEFS[id]; return (d && d.freezesTo) || null; }
  /* 要不要为这格排一次激活 = 它自己或者它的邻居有没有"可能起反应"。
     注意可燃物（一整片森林）**不在**这里：木头自己不会变，只有旁边着火或被点着时才需要看它，
     那是"邻居唤醒"负责的。把可燃物挡在常驻激活集之外，是这套东西跑得动的关键一条。 */
  function reactiveId(id) {
    var d = DEFS[id];
    return !!(d && (d.hot || d.fluid === 'lava' || d.quenches || d.meltsTo || d.freezesTo));
  }

  /* 六个邻居；NB[k][1] 是竖直分量，火的权重按它分配 */
  var NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  /* 反应 → 音效 id：化学层只说"发生了什么"，音色全在 js/sfx-table.js。
     这些 id 必须能在配方层查到（tools/audio_check.cjs 会拿源码里的每个 id 反查那张表）。 */
  var REACT_SFX = { ignite: 'ignite', steam: 'steam', ash: 'ash', obsidian: 'obsidian', melt: 'melt', freeze: 'freeze', caught: 'ignite' };

  /* ---------- 反应表：这就是"方块之间的更新交互"本体 ----------
     when = 这一格自己处在什么状态，act = 该做什么。表是数据，ACTS 是小函数。
     顺序有意为之：灭火排在蔓延之前（水火不容优先于火借风势），
     凝岩排在熔之前（岩浆遇水先各自成石，再谈把冰烤化）。 */
  var REACT = [
    { id: 'doused',      when: 'burning',  act: 'doused' },
    { id: 'burnout',     when: 'burning',  act: 'burnout' },
    { id: 'spread',      when: 'burning',  act: 'spread' },
    { id: 'lava_quench', when: 'lava',     act: 'lava_quench' },
    { id: 'heat_ignite', when: 'heat',     act: 'heat_ignite' },
    { id: 'heat_melt',   when: 'heat',     act: 'heat_melt' },
    { id: 'self_melt',   when: 'meltable', act: 'self_melt' },
    { id: 'cat_ignite',  when: 'cat_heat', act: 'cat_ignite' },
    { id: 'cat_freeze',  when: 'cat_cold', act: 'cat_freeze' }
  ];
  var WHEN = {
    burning: function (c) { return c.burning; },
    lava: function (c) { return c.fluid === 'lava'; },
    heat: function (c) { return c.hot || c.burning; },
    meltable: function (c) { return !!c.meltsTo; },
    cat_heat: function (c) { return (c.why & WHY_HEAT) !== 0; },
    cat_cold: function (c) { return (c.why & WHY_COLD) !== 0; }
  };

  /* 导出点放在反应表之后：早先在这里之前调用过一次 G.CHEM = {REACT: REACT}，
     对象是在表还没赋值时建的，于是 REACT / WHEN 导出的是 undefined（tools/chem_check.cjs
     第一次跑就撞在 C.REACT.map 上）。数据要在数据就位之后才交出去。 */
  var C = G.CHEM = { CFG: CFG, REACT: REACT, WHEN: WHEN };
  var ST = C.stats = { ticks: 0, cells: 0, edits: 0, requeue: 0, dropped: 0, maxQueue: 0,
                       burning: 0, byId: {}, lastCells: 0, lastEdits: 0, maxCells: 0, maxEdits: 0,
                       ms: 0, maxMs: 0, errors: 0 };

  C.world = null; C.match = null; C.ready = false; C.enabled = true;

  /* ---------- 数据结构：一次分配、反复使用（位图 368KB，不每 tick new） ---------- */
  var n = 0, queued = null, whyArr = null, ring = null, ringWhy = null, head = 0, tail = 0;
  var wheel = null, wheelCur = 0, slotAcc = 0, tickEdits = 0;
  var rng = function () { return 0.5; }, burningCount = 0, logAcc = {};

  function resetStats() {
    ST.ticks = ST.cells = ST.edits = ST.requeue = ST.dropped = ST.burning = 0;
    ST.lastCells = ST.lastEdits = ST.maxQueue = ST.maxCells = ST.maxEdits = ST.ms = ST.maxMs = ST.errors = 0;
    ST.byId = {};
  }

  C.bind = function (world, match) {
    C.world = world; C.match = match;
    n = world.SX * world.SY * world.SZ;
    if (!queued || queued.length !== n) { queued = new Uint8Array(n); whyArr = new Uint8Array(n); }
    else { queued.fill(0); whyArr.fill(0); }
    ring = new Int32Array(CFG.queueCap); ringWhy = new Uint8Array(CFG.queueCap);
    head = tail = 0; wheelCur = 0; slotAcc = 0; tickEdits = 0;
    armed = null;                                                          // 上一局的"正在化"不能带进这一局
    burnList = []; emberT = 0; emberCursor = 0;                              // 火星名单同理，不跨局
    fxAcc = {}; ST.reacts = 0; ST.fxEmitted = 0; ST.fxSuppressed = 0;
    fxAcc = {}; ST.reacts = 0; ST.fxEmitted = 0; ST.fxSuppressed = 0;
    wheel = []; for (var i = 0; i < CFG.wheelSlots; i++) wheel.push([]);
    rng = G.mulberry32(((world.seed || 0) ^ 0xC0FFEE) >>> 0);
    burningCount = 0;
    world.meta.forEach(function (v) { if (v && v.kind === 'burning') burningCount++; });
    logAcc = {};
    resetStats();
    ST.burning = burningCount;
    C.ready = true;
    return C;
  };
  C.unbind = function () { C.ready = false; C.world = null; C.match = null; };

  /* ---------- 激活队列（环形 + 定时轮） ---------- */
  function push(i, why) {
    if (i < 0 || i >= n) return false;
    /* 已经在队里（或在定时轮里等）：不占第二个名额，但**催化剂标记必须并进去**——
       不然"先被邻居改动排进队、后挨了一发冰"的那格会丢掉寒霜，水就冻不住。 */
    if (queued[i]) { if (why) whyArr[i] |= why; return false; }
    if (tail - head >= CFG.queueCap) { ST.dropped++; return false; }
    queued[i] = 1; whyArr[i] = why | 0;
    ring[tail % CFG.queueCap] = i; ringWhy[tail % CFG.queueCap] = why | 0;
    tail++;
    var q = tail - head; if (q > ST.maxQueue) ST.maxQueue = q;
    return true;
  }
  function defer(i, why, sec) {
    if (i < 0 || i >= n || queued[i]) { ST.requeue++; return; }          // 已经在等，就不占第二个名额
    queued[i] = 1;                                                        // 占住名额：定时轮里也不许重复排
    wheel[(wheelCur + Math.max(1, Math.round(sec / CFG.slotSec))) % CFG.wheelSlots].push(i * 32 + (why & 31));
    ST.requeue++;
  }
  /* 改动一格 = 这格 + 六个邻居各排一次队（最多 7 次 push：只写位图，不查世界也不改世界） */
  function wakeCell(x, y, z, why) {
    var w = C.world;
    push(w.idx(x, y, z), why | 0);
    for (var k = 0; k < 6; k++) {
      var nx = x + NB[k][0], ny = y + NB[k][1], nz = z + NB[k][2];
      if (w.inB(nx, ny, nz)) push(w.idx(nx, ny, nz), why | 0);
    }
  }
  C.wake = wakeCell;
  C.wakeBox = function (cx, cy, cz, r, why) {
    for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) for (var c2 = -r; c2 <= r; c2++) {
      if (Math.abs(a) + Math.abs(b) + Math.abs(c2) > r + 1) continue;      // 曼哈顿球，省掉八角的无用唤醒
      var x = cx + a, y = cy + b, z = cz + c2;
      if (C.world.inB(x, y, z)) wakeCell(x, y, z, why | 0);
    }
  };

  function burningAt(w, i) { var m = w.meta.get(i); return !!(m && m.kind === 'burning'); }
  C.isBurning = function (x, y, z) { return C.ready ? burningAt(C.world, C.world.idx(x, y, z)) : false; };
  C.countBurning = function () { return burningCount; };
  C.pending = function () { return tail - head; };

  /* ---------- 世界钩子：谁改了格子就唤醒谁（存储层不认识 chem，只遍历一张钩子数组） ---------- */
  if (G.WORLD_HOOKS) {
    G.WORLD_HOOKS.onSet.push(function (x, y, z, id, prev) {
      if (!C.ready || !C.enabled) return;
      var w = C.world, i = w.idx(x, y, z);
      if (!burningAt(w, i) && !reactiveId(id) && !reactiveId(prev)) return;   // 石头换石头：不打扰模拟
      wakeCell(x, y, z, 0);
    });
  }

  /* ---------- 只有这三个函数真的写世界 ---------- */
  /*  burning 格的名单：只为了"火苗持续冒火星"这一件事服务。
     激活队列每 tick 只看该反应的那几格，火星却要按渲染节律稳定地往外冒，
     所以另开一张小表（上限 = maxBurning，燃烧格本来就封了顶）。 */
  var burnList = [];
  function burnListAdd(i) { if (burnList.length < CFG.maxBurning + 8) burnList.push(i); }
  var emberT = 0, emberCursor = 0;
  function embers(dt) {
    var m = C.match, w = C.world;
    if (!m || !w || !m.fx) return;
    emberT += dt;
    if (emberT < 0.09) return;
    emberT = 0;
    if (!burnList.length) return;
    var shots = 0;
    for (var pass = 0; pass < burnList.length && shots < 6; pass++) {
      var k = (emberCursor + pass) % burnList.length, i = burnList[k];
      var perCol = w.SZ * w.SX;
      var y = Math.floor(i / perCol), rem = i - y * perCol, z = Math.floor(rem / w.SX), x = rem - z * w.SX;
      if (!burningAt(w, i)) { burnList.splice(k, 1); continue; }                     // 灭了的格子从名单里摘掉
      emberCursor = (k + 1) % (burnList.length || 1);
      shots++;
      if (m.fx.fire) m.fx.fire({ x: x + 0.5, y: y + 0.9, z: z + 0.5 });
      if ((shots & 1) === 0 && m.fx.dust) m.fx.dust(x + 0.5, y + 1.4, z + 0.5, '#ffb060');
    }
  }

  function igniteCell(w, x, y, z, def) {
    var d = def || DEFS[w.get(x, y, z)];
    if (!d || !d.flammable) return false;
    if (burningAt(w, w.idx(x, y, z))) return false;                    // 已经在烧：不重复 set（省一次 chunk 重建）
    if (burningCount >= CFG.maxBurning) return false;                  // 山火熔断
    w.set(x, y, z, d.id, { kind: 'burning', born: C.match ? C.match.time : 0, dur: d.burnDur || 3, by: 'chem' });
    burningCount++; ST.burning = burningCount;
    burnListAdd(w.idx(x, y, z));
    react('ignite', x, y, z, d.color);
    wakeCell(x, y, z, 0);
    return true;
  }
  /* "正在化"的格：受热之后先记一笔，过 meltDelay 才真的变成水。
     两个理由：① 冰一挨到热源就瞬间消失、紧接着又被岩浆凝走，玩家在 20Hz 的粒度里
     根本看不见"化开"这件事（回归脚本也抓不到，只能抓到"格子不见了"）；
     ② 化水要时间，这才是"理所当然"。Map 只装正在化的那几十格，不是整图状态。 */
  var armed = null;
  function armMelt(i) { if (!armed) armed = new Map(); armed.set(i, C.match ? C.match.time : 0); }
  function disarm(i) { if (armed) armed.delete(i); }
  function tryMelt(w, x, y, z, def, heated) {
    var i = w.idx(x, y, z);
    if (!heated) { disarm(i); return false; }
    var t0 = armed && armed.get(i);
    if (t0 === undefined) { armMelt(i); defer(i, 0, CFG.meltDelay); cc.armed = true; return false; }
    if ((C.match ? C.match.time : 0) - t0 < CFG.meltDelay * 0.6) { defer(i, 0, CFG.meltDelay); cc.armed = true; return false; }
    disarm(i);
    var toId = blockIdOfKey(def.meltsTo, B.WATER);
    if (!toBlock(w, x, y, z, toId)) { disarm(i); return false; }
    react('melt', x, y, z, DEFS[toId].color);
    return true;
  }

  function toBlock(w, x, y, z, id) {
    if (w.get(x, y, z) === id) return false;
    var i = w.idx(x, y, z);
    if (burningAt(w, i)) { burningCount = Math.max(0, burningCount - 1); ST.burning = burningCount; }
    w.set(x, y, z, id, true);                                          // extra===true：换方块时把旧 meta 清干净
    tickEdits++;
    wakeCell(x, y, z, 0);
    return true;
  }
  function extinguish(w, x, y, z) {
    if (!burningAt(w, w.idx(x, y, z))) return false;
    burningCount = Math.max(0, burningCount - 1); ST.burning = burningCount;
    w.set(x, y, z, w.get(x, y, z), true);                              // 同一格，只摘掉 burning 标记（顶点色跟着回到本色）
    tickEdits++;
    return true;
  }
  function blockIdOfKey(key, dflt) { var v = G.blockKeyToId[key]; return v === undefined ? dflt : v; }

  /* 画面反馈的闸门。一场山火会产出上千次格子转换（实测 300 tick 烧掉 600+ 格），
     每次都发粒子 + 派发一个 VFX 事件的话：① 粒子池被同一种"橙点"糊满，看不出火场结构；
     ② 渲染层的事件对象 28 个名额瞬间见底，后面真正的出招 / 法阵反馈反而画不出来。
     所以每种反应每 0.14s 只放行一次（谁先触发谁上），计数照记不误 —— 
     工具要能区分"发生了 600 次"与"给了玩家看 40 次"。 */
  var fxAcc = null;
  function react(kind, x, y, z, color) {
    var m = C.match, t = m ? m.time : 0;
    ST.reacts = (ST.reacts || 0) + 1;
    if (fxAcc[kind] !== undefined && t - fxAcc[kind] < CFG.fxEvery) { ST.fxSuppressed++; return; }
    fxAcc[kind] = t;
    ST.fxEmitted++;
    if (m && m.fx) {
      /* 一次反应给三撮粒子而不是一撮：0.14s 才放行一次，如果每次只有一颗，
         整片树冠烧起来画面上就只有零星几个点，"着火了"这件事根本读不出来。 */
      if (m.fx.dust) { m.fx.dust(x + 0.5, y + 0.9, z + 0.5, color || '#c9d3e0'); m.fx.dust(x + 0.2, y + 1.2, z + 0.3, color || '#c9d3e0'); m.fx.dust(x + 0.8, y + 1.1, z + 0.7, color || '#c9d3e0'); }
      if (m.fx.sfx && REACT_SFX[kind]) m.fx.sfx(REACT_SFX[kind]);
      if (m.fx.chemLog) logOnce(kind, m.fx, x, y, z);
    }
    if (G.VFX && G.VFX.event) G.VFX.event('react', { kind: kind, x: x + 0.5, y: y + 0.5, z: z + 0.5, color: color });
  }
  function logOnce(kind, fx, x, y, z) {
    var t0 = logAcc[kind];
    if (t0 !== undefined && C.match.time - t0 < CFG.logThrottle) return;
    logAcc[kind] = C.match.time;
    fx.chemLog(kind, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }

  /* ---------- 对外的触发入口（cards/rules/battle 只调这几个） ---------- */
  C.ignite = function (x, y, z) {
    if (!C.ready || !C.world.inB(x, y, z)) return false;
    return igniteCell(C.world, x, y, z);
  };
  /* 点燃一片（燃地卡、火焰抛射物落点、岩浆注入）：先把能烧的点着，再唤醒周围让蔓延接管 */
  C.igniteArea = function (cx, cy, cz, r, prob) {
    if (!C.ready) return 0;
    var w = C.world, lit = 0;
    r = Math.max(0, r | 0);
    for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) for (var c2 = -r; c2 <= r; c2++) {
      if (Math.abs(a) + Math.abs(b) + Math.abs(c2) > r + 1) continue;
      var x = cx + a, y = cy + b, z = cz + c2;
      if (!w.inB(x, y, z)) continue;
      var id = w.get(x, y, z);
      if (!flammableOf(id)) continue;
      if (prob !== undefined && prob < 1 && rng() > prob) continue;
      if (igniteCell(w, x, y, z)) lit++;
    }
    wakeBoxHeat(cx, cy, cz, r);
    return lit;
  };
  function wakeBoxHeat(cx, cy, cz, r) { C.wakeBox(cx, cy, cz, r + 1, WHY_HEAT); }
  /* 冻结一片（冰封、霜爆、冰墙、结冰卡、冰川阵）：半径内的水成冰 */
  C.freezeArea = function (cx, cy, cz, r) {
    if (!C.ready) return 0;
    var w = C.world, made = 0;
    r = Math.max(0, r | 0);
    for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) for (var c2 = -r; c2 <= r; c2++) {
      if (Math.abs(a) + Math.abs(b) + Math.abs(c2) > r + 1) continue;
      var x = cx + a, y = cy + b, z = cz + c2;
      if (!w.inB(x, y, z)) continue;
      var f = freezesToOf(w.get(x, y, z));
      if (!f) continue;
      if (toBlock(w, x, y, z, blockIdOfKey(f, B.ICE))) { react('freeze', x, y, z, DEFS[B.ICE].color); made++; }
    }
    C.wakeBox(cx, cy, cz, r + 1, WHY_COLD);
    return made;
  };
  /* 慢慢冷 / 慢慢热：只把这一片排进激活队列，靠 tick 自己起反应。
     与 catalyst 的区别是故意的——玩家**直接命中**要有即时反馈（catalyst 立刻点着/冻住），
     而"放下了一堵冰墙""岩浆淌在旁边"这种环境效应要慢半拍，对手才有反应时间。 */
  C.chill = function (x, y, z, r) { if (!C.ready) return 0; C.wakeBox(x, y, z, r === undefined ? 1 : r, WHY_COLD); return 1; };
  C.warm = function (x, y, z, r) { if (!C.ready) return 0; C.wakeBox(x, y, z, r === undefined ? 1 : r, WHY_WARM); return 1; };
  C.WHY = { HEAT: WHY_HEAT, COLD: WHY_COLD, SHOCK: WHY_SHOCK, WARM: WHY_WARM };
  /* 催化剂：抛射物命中、爆炸中心、法阵节拍。heat=点火 / cold=冻结 / shock=只让世界重算邻居 */
  C.catalyst = function (kind, x, y, z, r) {
    if (!C.ready) return 0;
    r = r === undefined ? 1 : r;
    if (kind === 'heat') return C.igniteArea(x, y, z, r, CFG.lavaIgnite + 0.45);
    if (kind === 'cold') return C.freezeArea(x, y, z, r);
    C.wakeBox(x, y, z, r, WHY_SHOCK);
    return 0;
  };

  /* ---------- 每格求值：查邻居 → 交给 ACTS ---------- */
  var cc = { w: null, x: 0, y: 0, z: 0, i: 0, id: 0, def: null, burning: false, hot: false,
             fluid: null, meltsTo: null, freezesTo: null, dur: 0, born: 0, why: 0, spreadMul: 1, armed: false };
  function fillCtx(w, i, why) {
    var perCol = w.SZ * w.SX;
    var y = Math.floor(i / perCol), rem = i - y * perCol;
    var z = Math.floor(rem / w.SX), x = rem - z * w.SX;
    var id = w.blocks[i], def = DEFS[id] || DEFS[0], m = w.meta.get(i);
    cc.w = w; cc.i = i; cc.x = x; cc.y = y; cc.z = z;
    cc.id = id; cc.def = def; cc.why = why | 0;
    cc.burning = !!(m && m.kind === 'burning');
    cc.hot = !!def.hot;
    cc.fluid = def.fluid || null;
    cc.meltsTo = def.meltsTo || null;
    cc.freezesTo = def.freezesTo || null;
    cc.dur = (m && m.dur) || def.burnDur || 3;
    cc.born = (m && m.born) || 0;
    cc.spreadMul = def.spread === undefined ? 1 : def.spread;
    cc.armed = false;
    return cc;
  }
  var nb = { x: 0, y: 0, z: 0, id: 0, def: null, ok: false };
  function neighbor(c, k) {                                              // 复用同一个对象，不每邻居 new
    var x = c.x + NB[k][0], y = c.y + NB[k][1], z = c.z + NB[k][2];
    nb.ok = c.w.inB(x, y, z);
    nb.x = x; nb.y = y; nb.z = z;
    nb.id = nb.ok ? c.w.get(x, y, z) : 0;
    nb.def = DEFS[nb.id] || DEFS[0];
    return nb.ok ? nb : null;
  }

  var ACTS = {
    /* 水浇灭火：燃烧格旁边只要有一格水就灭，而那格水被抽干。
       消耗水是"理所当然"的另一半——一湖水浇不灭一场山火，玩家才会去权衡灭火还是灭火圈。 */
    doused: function (c) {
      var hit = null;
      for (var k = 0; k < 6; k++) { var q = neighbor(c, k); if (q && q.def.quenches) { hit = q; break; } }
      if (!hit) return false;
      var hx = hit.x, hy = hit.y, hz = hit.z;                            // nb 是共享对象，先把坐标拷出来再用
      extinguish(c.w, c.x, c.y, c.z);
      toBlock(c.w, hx, hy, hz, B.AIR);
      react('steam', hx, hy, hz, '#dfe9f2');
      return true;
    },
    /* 烧完成灰：木头烧穿留洞，草皮烧掉露出泥土（burnTo 说的就是这个） */
    burnout: function (c) {
      if (C.match.time - c.born < c.dur) return false;
      var to = blockIdOfKey(c.def.burnTo || 'air', B.AIR);
      extinguish(c.w, c.x, c.y, c.z);
      toBlock(c.w, c.x, c.y, c.z, to);
      react('ash', c.x, c.y, c.z, '#6b6b74');
      return true;
    },
    /* 蔓延：火往上爬（权重 上 > 侧 > 下），乘上方块自己的可燃倍率 */
    spread: function (c) {
      var did = false;
      for (var k = 0; k < 6; k++) {
        var q = neighbor(c, k);
        if (!q || !q.def.flammable || burningAt(c.w, c.w.idx(q.x, q.y, q.z))) continue;
        var px = q.x, py = q.y, pz = q.z, pdef = q.def;                   // 同上：nb 会被下一次 neighbor 覆写
        var p = NB[k][1] > 0 ? CFG.fireUp : (NB[k][1] < 0 ? CFG.fireDown : CFG.fireSide);
        p *= c.spreadMul * (pdef.spread === undefined ? 1 : pdef.spread);
        if (rng() <= p) did = igniteCell(c.w, px, py, pz, pdef) || did;
      }
      defer(c.i, c.why, CFG.spreadEvery);                                 // 还在烧 → 0.5s 后再看一次邻居
      return did;
    },
    /* 岩浆遇水：先各自成石（岩浆凝成黑曜石、水被抽干）——排在"熔"之前，谁先被看到都成立 */
    lava_quench: function (c) {
      for (var k = 0; k < 6; k++) {
        var q = neighbor(c, k);
        if (!q || q.def.fluid !== 'water') continue;
        var qx = q.x, qy = q.y, qz = q.z;
        var toId = blockIdOfKey(c.def.coolsTo || 'obsidian', B.OBSIDIAN);
        toBlock(c.w, c.x, c.y, c.z, toId);
        toBlock(c.w, qx, qy, qz, B.AIR);
        react('obsidian', c.x, c.y, c.z, DEFS[toId].color);
        react('steam', qx, qy, qz, '#dfe9f2');
        return true;
      }
      defer(c.i, c.why, CFG.heatEvery);                                   // 岩浆是常驻激活格
      return false;
    },
    /* 热源引燃邻居：岩浆不必被碰，旁边的木头自己会被烤着（低概率） */
    heat_ignite: function (c) {
      if (!c.hot) return false;                                           // 燃烧格的蔓延由 spread 负责，别重复点
      var did = false;
      for (var k = 0; k < 6; k++) {
        var q = neighbor(c, k);
        if (!q || !q.def.flammable) continue;
        var px = q.x, py = q.y, pz = q.z, pdef = q.def;
        if (rng() <= CFG.lavaIgnite * (pdef.spread === undefined ? 1 : pdef.spread)) did = igniteCell(c.w, px, py, pz, pdef) || did;
      }
      defer(c.i, c.why, CFG.heatEvery);
      return did;
    },
    /* 热源把旁边的冰/雪烤化（先记一笔受热，meltDelay 之后才真的出水） */
    heat_melt: function (c) {
      var did = false;
      for (var k = 0; k < 6; k++) {
        var q = neighbor(c, k);
        if (!q || !q.def.meltsTo) continue;
        if (tryMelt(c.w, q.x, q.y, q.z, q.def, true)) did = true;
      }
      if (!did && c.burning) defer(c.i, c.why, CFG.meltDelay);           // 火还在，就去把没化完的冰再来看一眼
      return did;
    },
    /* 自己是被烤的那一方：冰旁边出现热源或火 → 化水。两边谁先被排进队列都成立，
       不必等岩浆那一格正好轮到（那条会让"冰卡拍在岩浆边"变成看运气）。 */
    self_melt: function (c) {
      var heated = false;
      for (var k = 0; k < 6; k++) {
        var q = neighbor(c, k);
        if (!q) continue;
        var qx = q.x, qy = q.y, qz = q.z, qdef = q.def;
        if (burningAt(c.w, c.w.idx(qx, qy, qz)) || qdef.hot) { heated = true; break; }
      }
      if (!heated) { disarm(c.i); return false; }                        // 热源没了：这次受热记录作废，不留脏状态
      return tryMelt(c.w, c.x, c.y, c.z, c.def, true);
    },
    /* 火系命中：半径内没点着的（可能被预算排到）下一轮补上 */
    cat_ignite: function (c) {
      var did = false;
      if (c.def.flammable) did = igniteCell(c.w, c.x, c.y, c.z, c.def);
      for (var k = 0; k < 6 && !did; k++) {
        var q = neighbor(c, k);
        if (!q || !q.def.flammable) continue;
        var px = q.x, py = q.y, pz = q.z, pdef = q.def;
        did = igniteCell(c.w, px, py, pz, pdef) || did;
      }
      return did;
    },
    /* 冰系命中：旁边的水冻成冰（"冰化掉"的反面——水遇寒该冻住） */
    cat_freeze: function (c) {
      var made = 0;
      if (c.freezesTo && toBlock(c.w, c.x, c.y, c.z, blockIdOfKey(c.freezesTo, B.ICE))) made++;
      for (var k = 0; k < 6; k++) {
        var q = neighbor(c, k);
        if (!q || !q.def.freezesTo) continue;
        if (toBlock(c.w, q.x, q.y, q.z, blockIdOfKey(q.def.freezesTo, B.ICE))) made++;
      }
      if (made) react('freeze', c.x, c.y, c.z, DEFS[B.ICE].color);
      return !!made;
    }
  };

  var nowMs = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); } : function () { return Date.now(); };

  function processCell(i, why) {
    var w = C.world, c = fillCtx(w, i, why), fired = false;
    for (var r = 0; r < REACT.length; r++) {
      var rule = REACT[r], wf = WHEN[rule.when];
      if (wf && !wf(c)) continue;
      var fn = ACTS[rule.act];
      if (!fn) continue;
      cc.armed = false;
      try {
        /* "这一格确实变了"或"这一格刚被记上正在化"都算这条反应跑过：
           熔这件事分两拍（受热记一笔 → meltDelay 之后出水），只数第二拍会让 heat_melt 永远是 0。 */
        if (fn(c) || c.armed) { ST.byId[rule.id] = (ST.byId[rule.id] || 0) + 1; fired = true; }
      } catch (err) {
        /* 一格算崩不许带走整局：主循环对 step 也有同样的护栏，但那道闸会把整个 tick 吞掉。 */
        ST.errors++;
        if (!ST.lastError) ST.lastError = String((err && err.message) || err);
      }
    }
    return fired;
  }

  /* ---------- 场上单位与火的双向交互 ---------- */
  function entityFire() {
    var m = C.match, w = C.world;
    if (!m || !m.all) return;
    var ents = m.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (!e || !e.alive || e.dead || !e.pos) continue;
      var gx = Math.floor(e.pos.x), gz = Math.floor(e.pos.z);
      var gy = Math.floor(e.pos.y - e.h / 2 + 0.1);                       // pos.y 是身体中心，脚底要减半高
      if (!w.inB(gx, gy, gz)) continue;
      var id = w.blocks[w.idx(gx, gy, gz)];
      if (id && DEFS[id].flammable && e.st && e.st.burn > 0 && rng() < CFG.footIgnite) igniteCell(w, gx, gy, gz);
      if (burningAt(w, w.idx(gx, gy, gz))) {
        if (rng() < CFG.bodyBurn) {
          if (G.Rules && G.Rules.addStatus) G.Rules.addStatus(e, 'burn', 2.4);
          if (m.fx && m.fx.fire) m.fx.fire(e.pos);
          if (m.fx && m.fx.chemLog) logOnce('caught', m.fx, gx, gy, gz);
        }
      }
    }
  }

  /* ---------- 每 tick：先倒定时轮，再按预算排空激活队列 ---------- */
  C.step = function (dt) {
    if (!C.ready || !C.enabled || !C.world || !wheel) return;
    ST.ticks++;
    var t0 = nowMs();
    slotAcc += dt;
    while (slotAcc >= CFG.slotSec) {
      slotAcc -= CFG.slotSec;
      var bucket = wheel[wheelCur];
      for (var b = 0; b < bucket.length; b++) {
        var packed = bucket[b], idx = packed >> 5, why = packed & 31;
        queued[idx] = 0;                                                  // 定时轮的占位在这里解除，然后走同一条 push
        push(idx, why);
      }
      bucket.length = 0;
      wheelCur = (wheelCur + 1) % CFG.wheelSlots;
    }
    var cells = 0;
    tickEdits = 0;
    while (head < tail && cells < CFG.cellsPerTick && tickEdits < CFG.editsPerTick) {
      var slot = head % CFG.queueCap, ci = ring[slot], cw = ringWhy[slot] | whyArr[ci];
      head++; queued[ci] = 0; whyArr[ci] = 0;
      cells++;
      processCell(ci, cw);
    }
    ST.cells += cells; ST.lastCells = cells;
    ST.edits += tickEdits; ST.lastEdits = tickEdits;
    if (cells > ST.maxCells) ST.maxCells = cells;
    if (tickEdits > ST.maxEdits) ST.maxEdits = tickEdits;
    ST.burning = burningCount;
    entityFire();
    /* 火星：按渲染节律稳定往外冒，不挂在"某一次反应"上。
       挂在反应上会闪一下；每 tick 全表扫又会烧预算，所以另开 burnList + 0.09s 一轮。 */
    embers(dt);
    var ms = nowMs() - t0;
    ST.ms += ms;
    if (ms > ST.maxMs) ST.maxMs = ms;
  };

  C.setBudget = function (o) { Object.assign(CFG, o || {}); };
  C.budget = function () { return { cellsPerTick: CFG.cellsPerTick, editsPerTick: CFG.editsPerTick, maxBurning: CFG.maxBurning }; };
})(window.GW);
