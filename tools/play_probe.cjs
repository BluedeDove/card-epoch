#!/usr/bin/env node
/* tools/play_probe.cjs · 玩法量表（不参与游戏运行）

   为什么必须有它：现有门禁全部在管"相机对不对、分层越不越界、手感滑不滑"，
   **没有一条断言在管"这局到底发生了什么"**。于是"我把机制调得更好玩了"这种话
   无法核对，下一个会话只能重猜。本脚本把玩法变成可复现的数字。

   两类断言，区别务必看清（别把目标线当回归，也别为了绿灯削目标线）：
     H 组（硬回归）：今天就必须全绿。红了是 bug、确定性被破坏、或有人偷偷扫全图。
     T 组（目标线）：设计验收线，当前**故意是红的**——它们是 2026-10-17 体检量出来的差距
       （starter 对局 8 分钟零击杀、抛射物命中率 1.8–2.6%、素材溢出到 70、法阵与召唤从未出现）。
       玩法改动把 T 组推绿才算达到目的；把阈值改成能过 = 自欺，必须写进给用户的说明里。

   用法：
     node tools/play_probe.cjs [seed] [aiLevel] [maxTicks] [starter|full] [games]
     默认 490706 1 9600 starter 1。项目基准三种子：490706 / 88092 / 31337。
     games > 1 时按 seed+11*i 取不同图，额外给出时长的中位与 p95（T7）。
*/
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards/pick-pools.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js', 'src/net.js',
 'src/app/map-presets.js', 'src/app/rule-presets.js']
  .forEach(f => require(path.join(ROOT, f)));
const G = global.window.GW, CAR = G.CARDS_BY_ID;

const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const LV = parseInt(process.argv[3], 10) || 1;
/* 窗口默认 10800 tick = 540 秒：Scoreboard 硬时间帽 480 秒，**平分还要进加时**（下一个得分事件定胜负）。
   旧默认 9600 恰好等于 480 秒，加时的第一个 tick 都没跑到就被截断，于是 T2 把「480s 平分进加时」误报成「局无界」
   （2026-10-17 A1-b 实测：3/12 局 45:45、30:30、31:31 全被砍在加时门前）。这不是放宽 T2——判据仍是 undecided === 0，
   加时局必须在 540 秒内分出胜负否则照样红；命令行显式传第 4 个参数仍可覆盖。 */
const MAXT = parseInt(process.argv[4], 10) || 10800;
const DECKMODE = process.argv[5] || 'starter';
const GAMES = Math.max(1, parseInt(process.argv[6], 10) || 1);
const STEP = 1 / 20;
const TYPES = ['terrain', 'spell', 'sigil', 'summon', 'utility'];

/* 目标线阈值：改这些数字必须在给用户的说明里写清理由（它们是设计口径，不是测量噪声） */
const T_PROJ_HIT = 0.30;        /* T1 抛射物命中率下限（基线实测 0.018–0.026） */
const T_HP_DROP_PER_MIN = 12;   /* T3 每 60 秒至少多少次真实掉血 */
const T_MAT_CAP = 24;           /* T4 终局素材上限：溢出=经济没有出口 */
const T_KIND_SHARE = 0.70;      /* T6 最大单一伤害元素占比上限 */
const T_MEDIAN = [270, 420];    /* T7 单局时长中位区间（秒）——这条不许动，它才是真正的健康指标 */
/* p95 上限从 500 改成 530（机制线 2026-10-17 拍板，理由写在这里而不是藏在提交信息里）：
   定案 §2.1 的最坏路径 = 480 秒硬时间帽 + 45 秒加时 = 525 秒，那是设计自己定义的上界。
   用 500 去卡一个由设计算出来的 525 是自相矛盾的口径：局越接近收束，越容易因为「合法地打到加时」被判红。
   取 530 留 5 秒余量，且仍低于探针 540 秒安全网，所以「窗口抢先结束一局」依然会被抓到。
   这不是放松要求：真正管节奏的是 T_MEDIAN 的中位区间，实测 480 秒仍然红着（终局可达性不足），
   那条才是 A2 要治的问题。改 p95 只是把尺子与定案算术对齐。 */
const T_P95 = 530;
const TTerrain = 0.50;           /* T5 terrain"抽到后打出"率下限 */

/* 硬回归阈值 */
const H_TICK_MS = 8;            /* 单 tick 逻辑预算（含 chem） */
let H_WORLD_GET = null;         /* H6 每 tick world.get 峰值上限：首轮实测后夹紧，见输出 */

let pass = 0, fail = 0, target = 0;
function group(n) { console.log('\n\u2500\u2500 ' + n); }
function hard(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2190 ' + extra : '')); }
}
function tol(name, cond, extra) {
  if (cond) { pass++; console.log('  \u25b3 ' + name); }
  else { target++; console.log('  \u25a1 ' + name + ' （目标线，未达）' + (extra ? '  \u2190 ' + extra : '')); }
}
function noop() {}
const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop,
             shieldUp: noop, fire: noop, float: noop, ambient: noop, chemLog: noop };
function typeOf(id) { const c = CAR[id]; return c ? c.type : 'unknown'; }
function fullDeck(s) {
  const r = G.mulberry32(s), ids = Object.keys(CAR), out = [], byType = {};
  ids.forEach(id => { const t = CAR[id].type; (byType[t] = byType[t] || []).push(id); });
  Object.keys(byType).forEach(t => { const p = byType[t]; for (let i = 0; i < 2 && p.length; i++) out.push(p[Math.floor(r() * p.length)]); });
  while (out.length < 12) out.push(ids[Math.floor(r() * ids.length)]);
  return out;
}
/* A1-a 起探针世界随游戏收档 64×36×64（GAMEPLAY §1：1v1 专用图；96×40×96 保留给方案 B）。
   H5 的绝对预算 2400 不随尺寸动——它是"扫全图级别回归"的闸，不是按图大小浮动的口粮。 */
function makeWorld(seed) { const w = new G.World({ size: [64, 36, 64], seed: seed >>> 0, sea: 12, lodes: true }); w.generate(); return w; }
function worldHash(w) {
  let h = 2166136261 >>> 0; const b = w.blocks;
  for (let i = 0; i < b.length; i += 7) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/* world.get 计数插桩（H6）：谁偷偷开始整图扫描，这里立刻见顶 */
let GETS = 0;
const wproto = G.World.prototype, rawGet = wproto.get;
wproto.get = function () { GETS++; return rawGet.apply(this, arguments); };

/* T8 盯梢（定案 §5）：A-1 起复活点固定在开局缓存的 match.spawnPts，对手把出生区改掉之后
   复活可能落进方块里——现在只靠 unstick 在 8 tick 内渐变顶出兜底（玩家会看到"被地形卡住，已顶出"）。
   这里独立按身体 AABB × 实心格相交重算"自身被埋"（与 battle.js unstick 同几何口径、不复用其结论），
   复活后 1 秒（20 tick）窗口内逐 tick 查。用未插桩的 rawGet：探针自己的查询不许进 H5/H6 的账。 */
const respWatch = [0, 0];
function buriedNow(w, e) {
  const hw = e.w / 2, hh = e.h / 2;
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
    const cx = Math.floor(e.pos.x) + ox, cy = Math.floor(e.pos.y) + oy, cz = Math.floor(e.pos.z) + oz;
    const id = rawGet.call(w, cx, cy, cz);
    if (!id || !G.BLOCK_DEFS[id].solid) continue;
    if (cx < e.pos.x + hw && cx + 1 > e.pos.x - hw && cy < e.pos.y + hh && cy + 1 > e.pos.y - hh && cz < e.pos.z + hw && cz + 1 > e.pos.z - hw) return true;
  }
  return false;
}

/* 统计插桩（一次性装好，跨局累计前按 reset 清空） */
const stat = {}
function resetStat() {
  stat.drawnType = {}; stat.playedType = {}; stat.attemptedType = {}; stat.projFired = 0; stat.projHit = 0;
  stat.dmgByKind = {}; stat.hpDropEvents = 0; stat.kills = 0; stat.pKills = 0; stat.sKills = 0; stat.resps = 0; stat.sigilsAdded = 0;
  stat.sigilPeak = 0; stat.summons = 0; stat.tickErr = 0; stat.err0 = null;
  stat.maxTickMs = 0; stat.overBudget = 0; stat.maxGets = 0;
  stat.respBuriedEvents = 0; stat.respBuriedMax = 0;
}
resetStat();
const proto = G.Match.prototype, o = {};
['playCard', 'drawCards', 'explode', 'kill', 'respawnPlayer', 'sigilTick',
 'fireProjectile', 'hitTestSegment', 'spawnSummon', 'addSigil'].forEach(k => { o[k] = proto[k]; });
proto.playCard = function (p, index) {
  const id = p.hand && p.hand[index], ty = typeOf(id);
  stat.attemptedType[ty] = (stat.attemptedType[ty] || 0) + 1;
  const r = o.playCard.apply(this, arguments);
  if (r) { stat.playedType[ty] = (stat.playedType[ty] || 0) + 1; p.lastCard = id; }
  return r;
};
proto.drawCards = function (p, n, silent) {
  const before = p.hand.length, r = o.drawCards.apply(this, arguments);
  if (p.hand.length > before) { const ty = typeOf(p.hand[p.hand.length - 1]);
    stat.drawnType[ty] = (stat.drawnType[ty] || 0) + 1; }
  return r;
};
proto.explode = function () { const amt = arguments[2] || 0, kd = arguments[3] || 'none';
  stat.dmgByKind[kd] = (stat.dmgByKind[kd] || 0) + amt; return o.explode.apply(this, arguments); };
proto.fireProjectile = function () { stat.projFired++; return o.fireProjectile.apply(this, arguments); };
proto.hitTestSegment = function () { const r = o.hitTestSegment.apply(this, arguments); if (r) stat.projHit++; return r; };
proto.spawnSummon = function () { stat.summons++; return o.spawnSummon.apply(this, arguments); };
proto.addSigil = function () { stat.sigilsAdded++; return o.addSigil.apply(this, arguments); };
/* 击杀计数必须分玩家与随从：kill() 对两者都调（golem 进首发后随从死得比玩家多得多）。
   早年这条没分，于是「击杀 139 / 复活 21」这种自相矛盾的数会被当成战况汇报出去（2026-10-17 就是这么差点误报）。 */
proto.kill = function () {
  stat.kills++;
  const kd = arguments[0] && arguments[0].kind;
  if (kd === 'summon') stat.sKills++; else stat.pKills++;
  return o.kill.apply(this, arguments);
};
proto.respawnPlayer = function () {
  stat.resps++;
  const r = o.respawnPlayer.apply(this, arguments);
  const p = arguments[0];
  if (p && (p.side === 0 || p.side === 1)) respWatch[p.side] = 20;   // T8：复活落点盯梢窗口 1 秒（20Hz × 20）
  return r;
};
proto.sigilTick = function () { const n = this.sigils.length; if (n > stat.sigilPeak) stat.sigilPeak = n;
  return o.sigilTick.apply(this, arguments); };

function runGame(seed) {
  const w = makeWorld(seed);
  const decks = DECKMODE === 'full' ? [fullDeck(seed + 1), fullDeck(seed + 2)] : [null, null];
  const m = new G.Match({ world: w, seed: seed >>> 0, mode: 'train', players: 2, fx, cards: decks });
  const ai = [new G.Net.AISource(m, 0, LV), new G.Net.AISource(m, 1, LV)];
  let ticks = 0; const prevHp = m.players.map(p => p.hp);
  respWatch[0] = 0; respWatch[1] = 0; const buriedCur = [0, 0];
  while (!m.over && ticks < MAXT) {
    const a = ai[0].poll(STEP), b = ai[1].poll(STEP);
    GETS = 0;
    const t0 = process.hrtime.bigint();
    try { m.step(STEP, [a, b]); }
    catch (e) { stat.tickErr++; if (!stat.err0) stat.err0 = String(e && e.message).slice(0, 200); break; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > stat.maxTickMs) stat.maxTickMs = +ms.toFixed(2);
    if (GETS > stat.maxGets) stat.maxGets = GETS;
    if (ms > H_TICK_MS) stat.overBudget++;
    m.players.forEach((p, i) => { const drop = prevHp[i] - p.hp;
      if (p.alive !== false && drop > 0.01) stat.hpDropEvents++; prevHp[i] = p.hp; });
    /* T8：复活后 1 秒窗口内逐 tick 查"自身被埋"（排在 GETS/计时快照之后，不进 H3/H5/H6 的账） */
    m.players.forEach((p, i) => {
      if (respWatch[i] <= 0) { buriedCur[i] = 0; return; }
      respWatch[i]--;
      if (p.alive && buriedNow(w, p)) {
        buriedCur[i]++;
        if (buriedCur[i] === 1) stat.respBuriedEvents++;
        if (buriedCur[i] > stat.respBuriedMax) stat.respBuriedMax = buriedCur[i];
      } else buriedCur[i] = 0;
    });
    ticks++;
  }
  return { m, ticks };
}

/* ---------- 0. 结算器单元冒烟（A0-a 返工三条的验收钉） ----------
   在跑局之前先把结算器本身钉死：素材不足不吞牌、自伤穿透护盾与无敌帧、归零走 kill 统一出口。
   统计插桩会被这些出牌弄脏，跑完立刻 resetStat() 清零，不带进正式局。 */
group('0. 硬回归 U 组：结算器单元冒烟（按格计价 / 自伤通道 / 唯一出口）');
(function unitSmoke() {
  const w = makeWorld(SEED);
  const m = new G.Match({ world: w, seed: SEED >>> 0, mode: 'train', players: 2, fx });
  const p = m.players[0];
  function aimGround(dist) {
    const fx0 = Math.sin(p.yaw), fz0 = Math.cos(p.yaw);
    const gx = Math.round(p.pos.x + fx0 * dist), gz = Math.round(p.pos.z + fz0 * dist);
    const gy = w.surfaceY(gx, gz);
    return { x: gx + 0.5, y: gy + 0.5, z: gz + 0.5, gx, gy, gz, face: [0, 1, 0] };
  }
  function setHand(pp, id, aim) {
    pp.hand[0] = id; pp.mana = pp.manaCap; pp.cooldowns = {};
    delete pp.aimSrc;                    // 手写 aim（不设 aimSrc），playCard 原样信任（同 hit_check 摆法）
    pp.aim = aim;
    pp.aimTarget = aim ? { x: aim.gx, y: aim.gy, z: aim.gz, id: w.get(aim.gx, aim.gy, aim.gz) } : null;
  }
  /* U1（R1 版"差 1 素材整牌拒付"）的前提已被 R2 的"部分成交"口径有意推翻：
     差 1 素材现在 = 建 cost-1 格的部分成交，不再拒付。拒付只剩"一格也建不了"（素材 0 / 目标全不可改造），
     由 U6 接任守住；U5 新增覆盖部分成交正面。 */
  /* U5 部分成交（定案 §2.2）：mats=3 打 6 格墙 → 真建 3 格、mats 归 0、牌进弃牌堆、魔力照扣 */
  {
    const w2 = makeWorld(SEED);
    const m2 = new G.Match({ world: w2, seed: SEED >>> 0, mode: 'train', players: 2, fx });
    const p3 = m2.players[0];
    p3.yaw = 0;                       // 轴对齐朝向：wall2 = 3×2 = 满 6 格（对角朝向是 cellsFor 四舍五入去重的 4 格）
    const fx0 = Math.sin(p3.yaw), fz0 = Math.cos(p3.yaw);
    const gx = Math.round(p3.pos.x + fx0 * 8), gz = Math.round(p3.pos.z + fz0 * 8), gy = w2.surfaceY(gx, gz);
    const wall = G.CARDS_BY_ID.wall2;
    p3.hand[0] = 'wall2'; p3.mana = 10; p3.cooldowns = {}; p3.mats = 3;
    delete p3.aimSrc; p3.aim = { x: gx + 0.5, y: gy + 0.5, z: gz + 0.5, gx, gy, gz, face: [0, 1, 0] };
    p3.aimTarget = { x: gx, y: gy, z: gz, id: w2.get(gx, gy, gz) };
    m2.ctx.aim = p3.aim; m2.ctx.aimTarget = p3.aimTarget;   // priceTerrain 读 ctx.aim，先接上再报价
    const full = G.Rules.priceTerrain(wall.effects[0], wall, p3, m2.ctx).cost;
    const brickAt = () => { let n = 0; for (let x = gx - 4; x <= gx + 4; x++) for (let y = gy - 1; y <= gy + 3; y++)
      for (let z = gz - 4; z <= gz + 4; z++) if (w2.get(x, y, z) === G.BLOCK.BRICK) n++; return n; };
    const b0 = brickAt(), d0 = p3.discard.length;
    const ok = m2.playCard(p3, 0);
    hard('U5 部分成交：mats=3 打 ' + full + ' 格墙 → 建 3 格、扣 3、牌消耗、魔力扣', ok === true &&
      brickAt() - b0 === 3 && p3.mats === 0 && p3.discard.length === d0 + 1 && p3.mana === 8,
      'ok=' + ok + ' 砖 +' + (brickAt() - b0) + ' mats=' + p3.mats + ' discard=' + p3.discard.length + ' mana=' + p3.mana);
    /* U6 一格也建不了（素材 0）才拒付：hand / discard / mana / 世界 四者均不变（守住 R1 成果） */
    p3.hand[0] = 'wall2'; p3.mana = 10; p3.cooldowns = {}; p3.mats = 0;
    delete p3.aimSrc;   // 同一 aim 复用
    const h1 = p3.hand.length, d1 = p3.discard.length, w1 = worldHash(w2);
    const ok2 = m2.playCard(p3, 0);
    hard('U6 零素材拒付：hand/discard/mana/世界 四者不变', ok2 === false && p3.hand.length === h1 &&
      p3.discard.length === d1 && p3.mana === 10 && worldHash(w2) === w1,
      'ok=' + ok2 + ' hand ' + h1 + '→' + p3.hand.length + ' discard ' + d1 + '→' + p3.discard.length + ' mana=' + p3.mana);
  }
  /* U2 自伤穿透护盾：满盾打 gift，-4 必须直接落血、护盾一格不扣 */
  {
    const p2 = m.players[1];
    p2.hp = 50; p2.shield = 10; p2.shieldT = 5; p2.invuln = 0;
    setHand(p2, 'gift', null);
    const ok = m.playCard(p2, 0);
    hard('U2 自伤穿透护盾：gift -4 落血、护盾原样', ok === true && p2.hp === 46 && p2.shield === 10,
      'hp=' + p2.hp + ' shield=' + p2.shield);
  }
  /* U3 自伤穿透无敌帧：复活保护期（invuln>0）打 gift 仍扣 4 */
  {
    p.hp = 40; p.shield = 0; p.invuln = 2.5;
    setHand(p, 'gift', null);
    const ok = m.playCard(p, 0);
    hard('U3 自伤穿透无敌帧：invuln=2.5 时 gift 仍扣 4', ok === true && p.hp === 36, 'hp=' + p.hp);
    p.invuln = 0;
  }
  /* U4 gift 把血打到 0：走 kill 统一出口（lives--、hp 夹 0、倒下） */
  {
    p.hp = 3; const lives0 = p.lives;
    setHand(p, 'gift', null);
    const ok = m.playCard(p, 0);
    hard('U4 自伤致死走 kill 统一出口（lives--、hp 夹 0）', ok === true && p.alive === false &&
      p.lives === lives0 - 1 && p.hp === 0, 'alive=' + p.alive + ' lives=' + p.lives + ' hp=' + p.hp);
    /* U7 复活不补魔（定案 §2.1）：U4 打死的 p 正在 2.2s 复活倒计时，
       驱动空输入 tick 到复活那一刻，魔力必须恰好是 2（旧值 4 = 死亡白送 4 秒回复量） */
    {
      let waited = 0;
      while (!p.alive && waited < 200) { m.step(STEP, [{}, {}]); waited++; }
      hard('U7 复活后魔力恰好 = 2（复活不补魔）', p.alive === true && p.mana === 2,
        'alive=' + p.alive + ' mana=' + p.mana + '（等了 ' + waited + ' tick）');
    }
  }
  resetStat(); respWatch[0] = 0; respWatch[1] = 0;
})();

/* ---------- 1. 硬回归：确定性 ---------- */
group('1. 硬回归 H1：同种子必须逐格可复现（玩法改动不许引入未播种随机）');
const hA = worldHash(makeWorld(SEED)), hB = worldHash(makeWorld(SEED));
hard('H1 同 seed 两次生成地形逐格一致（抽样校验和）', hA === hB, 'hash ' + hA + ' vs ' + hB);

/* ---------- 2. 跑 games 局 ---------- */
const results = [];
for (let i = 0; i < GAMES; i++) results.push(runGame(((SEED + i * 11) >>> 0)));
const r0 = results[0], m = r0.m;
const durations = results.map(x => x.m.time).sort((a, b) => a - b);
const median = durations[Math.floor(durations.length / 2)];
const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
const undecided = results.filter(x => !x.m.over).length;
const mins = m.time / 60;
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const kindShare = () => { const v = Object.values(stat.dmgByKind), s = sum(stat.dmgByKind); return s ? Math.max.apply(null, v) / s : 0; };
const hitRate = stat.projFired ? stat.projHit / stat.projFired : 0;

/* ---------- 3. 硬回归：不崩、预算、AI 同通道、零全图扫描 ---------- */
group('2. 硬回归 H2–H6：不崩 / tick 预算 / AI 同通道 / 零整图扫描');
hard('H2 整局 step 不抛异常（' + GAMES + ' 局）', stat.tickErr === 0, stat.err0 || (stat.tickErr + ' 次'));
hard('H3 单 tick 逻辑峰值 ≤ ' + H_TICK_MS + 'ms（含 chem 激活集）', stat.maxTickMs <= H_TICK_MS, 'maxTickMs=' + stat.maxTickMs);
hard('H3b 超预算 tick 数为 0', stat.overBudget === 0, stat.overBudget + ' 帧');
const netSrc = require('fs').readFileSync(path.join(ROOT, 'src/net.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const aiSeg = netSrc.slice(netSrc.indexOf('function AISource'), netSrc.indexOf('function RemoteSource'));
/* 口径：AI 允许**读**（m.players / m.summons / m.aiOff / m.rng 与纯查询 G.Rules.canPlay），
   禁的是绕过输入通道去**写**权威状态。 */
hard('H4 AISource 不写世界（world.set / blocks / meta）',
  !/world\s*\.\s*set\s*\(/.test(aiSeg) && !/world\s*\.\s*(blocks|meta)\s*\[/.test(aiSeg), 'AISource 写了世界');
hard('H4b AISource 不直接改实体状态（hp / mana / shield / lives）',
  !/\.\s*(hp|mana|shield|lives)\s*[-+*]?=[^=]/.test(aiSeg), 'AISource 顺手改了实体状态');
hard('H4c AISource 不绕过输入通道结算（playCard / spawnSummon / addSigil / Rules.damage）',
  !/\b(playCard|spawnSummon|addSigil)\s*\(/.test(aiSeg) && !/G\.Rules\s*\.\s*(damage|play)\b/.test(aiSeg), 'AISource 直接结算了');
/* H5 阈值是**绝对预算**，不再按当前实现自动上调（旧写法 maxGets × 1.5 兜底有个恶性后果：
   谁偷偷扫一次全图，阈值就悄悄抬上去，之后再也不会报）。现在它是常量，抬它必须改这一行并给用户理由。
   2400 的来历：当前实测峰值 1488（96 图、golem 与法阵都在跑），≈ 37 个「一列 40 格」；
   留到 2400 ≈ 60 列，既能抓住「多扫一整张局部图」级别的回归，又不会被正常波动误伤。
   A1-a 收档后全图是 64×36×64 = 147456 格，预算不随尺寸下调（它是回归闸，不是口粮）。 */
const GET_BUDGET = Number(process.env.GW_GET_CAP || 2400);
if (H_WORLD_GET === null) H_WORLD_GET = GET_BUDGET;
hard('H5 每 tick world.get 峰值 ≤ ' + H_WORLD_GET + '（零整图扫描纪律，64×36×64 全图 = 147456）',
  stat.maxGets <= H_WORLD_GET, '实测峰值 ' + stat.maxGets);
hard('H6 每 tick 逻辑量远低于"扫一格列"（36 格）的安全带', stat.maxGets < 4000, '峰值 ' + stat.maxGets);

/* ---------- 4. 目标线 ---------- */
group('3. 目标线 T 组（基线：starter 8 分钟零击杀、命中 1.8–2.6%、素材溢出 70）');
tol('T1 抛射物命中率 ≥ ' + Math.round(T_PROJ_HIT * 100) + '%', hitRate >= T_PROJ_HIT,
  '实测 ' + (hitRate * 100).toFixed(1) + '%（' + stat.projHit + '/' + stat.projFired + '）');
/* 标签里不许插实测值：早先这条把 m.time 插进标题，判据一直是 undecided === 0，
   但输出会显示成「能在 147s 内分出胜负」，看的人（包括复核的机制线）会以为阈值被改了。
   口径进标题，实测只进明细。 */
tol('T2 每局都必须在 tick 上限内分出胜负（不得有局跑到超时）', undecided === 0,
  undecided + '/' + GAMES + ' 局无界；末局时长 ' + Math.round(m.time) + 's');
tol('T3 每 60 秒 ≥ ' + T_HP_DROP_PER_MIN + ' 次真实掉血', stat.hpDropEvents / Math.max(0.1, mins) >= T_HP_DROP_PER_MIN,
  '实测 ' + (stat.hpDropEvents / Math.max(0.1, mins)).toFixed(1) + ' 次/分');
tol('T4 终局素材不溢出（≤ ' + T_MAT_CAP + '）', m.players.every(p => p.mats <= T_MAT_CAP),
  m.players.map(p => p.mats).join(' / '));
tol('T5 terrain"抽到后打出"率 ≥ ' + Math.round(TTerrain * 100) + '%（AI 口径，仅否证"没人打"）',
  (stat.drawnType.terrain || 0) === 0 || (stat.playedType.terrain || 0) / stat.drawnType.terrain >= TTerrain,
  '实测 ' + ((stat.playedType.terrain || 0) + '/' + (stat.drawnType.terrain || 0)));
tol('T5b 5 个类型都在实战出现过一次（默认牌库必须覆盖全部结算分支）',
  TYPES.every(t => (stat.playedType[t] || 0) > 0), TYPES.map(t => t + ':' + (stat.playedType[t] || 0)).join(' '));
tol('T6 最大单一伤害元素占比 ≤ ' + Math.round(T_KIND_SHARE * 100) + '%', kindShare() <= T_KIND_SHARE,
  JSON.stringify(stat.dmgByKind));
if (GAMES >= 10) {
  tol('T7 单局时长中位 ∈ [' + T_MEDIAN[0] + ',' + T_MEDIAN[1] + ']s 且 p95 ≤ ' + T_P95 + 's（' + GAMES + ' 局）',
    median >= T_MEDIAN[0] && median <= T_MEDIAN[1] && p95 <= T_P95, '中位 ' + median.toFixed(0) + 's p95 ' + p95.toFixed(0) + 's');
} else {
  console.log('  · T7 需 games ≥ 10 才统计（当前 ' + GAMES + ' 局，跳过）');
}
tol('T8 玩家复活后 1 秒内不得处于"自身被埋"状态（复活点已缓存为开局点位，出生区被改后落地可能埋进方块）',
  stat.respBuriedEvents === 0,
  stat.resps + ' 次复活中 ' + stat.respBuriedEvents + ' 次落地 1s 内被埋，最长连续 ' + stat.respBuriedMax + ' tick（兜底为 unstick ≤8 tick 渐变顶出）');
console.log('  · T8 明细：复活 ' + stat.resps + ' 次，落地 1s 内被埋 ' + stat.respBuriedEvents +
  ' 次，最长连续 ' + stat.respBuriedMax + ' tick');
/* T9（A0-a R2 新增）：盯"付不起就卡死手牌"导致的出牌流转停滞。
   口径：平均每局出牌 ≥ 240 次（即总次数 ≥ 240 × games）——R1 实测 2001/12 局 ≈ 167 次/局，
   旧 bug（吞牌）时代约 716 次/局。 */
tol('T9 镜像 AI 出牌流转：平均每局 ≥ 240 次（盯死手牌停滞）',
  sum(stat.playedType) / GAMES >= 240,
  '实测 ' + sum(stat.playedType) + ' 次 / ' + GAMES + ' 局 = ' + (sum(stat.playedType) / GAMES).toFixed(0) + ' 次/局');

/* ---------- 5. 目标线 L 组（A1-a 地图生成：三矿据点 + 连通闸 + 换边公平 + 浏览器挂载） ----------
   用独立的原图再生成一次：对局里的世界被卡牌改过，量不出生成期事实。
   L1–L4 是生成器的确定性属性（同 seed 恒定，不吃 AI 噪声）；L5 是静态文本检查，
   按机制线口径**现在必须是红的**（index.html 挂载是 UI 欠账，见 A1A_REPORT），挂载后转绿。 */
group('4. 目标线 L 组（A1-a：三矿据点 / 连通闸 / 露头 / 换边公平 / 挂载）');
const lw = makeWorld(SEED), li = lw.lodes;
function lodeStr(l) { return '(' + l.x + ',' + l.y + ',' + l.z + ')'; }
if (!li || !li.list.length) {
  tol('L1 三矿两两水平距 ∈ [18,40]', false, '未生成任何矿脉（' + (li && li.reason) + '）');
  tol('L2 每矿从两侧出生点 BFS 可达', false, '无矿脉');
  tol('L3 每矿晶柱露头 ≥1 格', false, '无矿脉');
  tol('L4 换边公平：side0/side1 到三矿的 BFS 步数差 ≤10%', false, '无矿脉');
} else {
  const dStr = li.dists.map(d => d.toFixed(1)).join(' / ');
  tol('L1 三矿两两水平距 ∈ [18,40]', !li.degraded && li.list.length === 3 && li.dists.every(d => d >= 18 && d <= 40),
    (li.degraded ? '已退化为单中矿图（' + li.reason + '，重排 ' + li.retries + ' 次）；' : '重排 ' + li.retries + ' 次；') +
    '坐标 ' + li.list.map(lodeStr).join(' ') + '；两两距 ' + (dStr || '—'));
  /* 镜像对（+120°/+60°）下叉积 = rA·rB·sin60° ≥ 280；±90° 共线布局叉积 = 0——
     这条就是拦"用共线换公平"的闸（机制线 2026-10-17 口径）。 */
  tol('L1b 三矿不共线（三点叉积 |cross| ≥ 100）', !li.degraded && li.list.length === 3 && Math.abs(li.cross || 0) >= 100,
    '叉积 ' + (li.cross || 0).toFixed(1) + '（镜像对下限 ≈280；近零 = 共线退化）');
  const gsp = [lw.spawnPoint(0), lw.spawnPoint(1)].map(p => ({ x: Math.floor(p.x), z: Math.floor(p.z) }));
  const g2 = G.ReachabilityGate.check(lw, gsp, li.list);
  tol('L2 每矿从两侧出生点 BFS 可达', g2.ok && g2.reach.every(r => r[0] && r[1]),
    'side0 步数 [' + g2.steps0.join(',') + '] side1 步数 [' + g2.steps1.join(',') + '] 出生点互通=' + g2.spawnLinked);
  const exposed = li.list.map(l => l.crystals.filter(c => rawGet.call(lw, c[0], c[1] + 1, c[2]) === 0).length);
  tol('L3 每矿晶柱露头 ≥1 格（地表必须有剪影，否则 harvest 收入恒为 0）', exposed.every(n => n >= 1),
    '各矿露头晶体 ' + exposed.join(' / ') + '（各矿晶体总数 ' + li.list.map(l => l.crystals.length).join(' / ') + '）');
  /* 换边公平三条（机制线 2026-10-17 修订，比旧的"逐矿裸差 ≤10%"更强不是更松）：
     ① 排序公平——双方各自到三矿的步数**排序后**逐元素比 ≤10%（玩家感知是"我没有系统性少一条矿"，
        不是"我到每条矿都等于对手到那条矿"；家门矿是健康非对称，逐矿裸差会误杀它）；
     ② 争夺性——中矿（矿0）两侧步数差 ≤10%（争夺矿必须真争得动）；
     ③ 家门矿存在性——存在 A 使 d0(A)<d1(A)，且存在另一条 B 使 d1(B)<d0(B)。
     ±120° 双翼同偏一侧会栽在 ①（排序向量 [24,24,x] vs [62,62,x]），±90° 共线栽在 L1b。 */
  const pair = g2.steps0.map((s0, i) => ({ i, s0, s1: g2.steps1[i] }));
  const srt0 = pair.map(p => p.s0).slice().sort((a, b) => a - b), srt1 = pair.map(p => p.s1).slice().sort((a, b) => a - b);
  const relOf = (a, b) => (a >= 0 && b >= 0) ? Math.abs(a - b) / Math.max(a, b, 1) : Infinity;
  const sortedRel = srt0.map((a, k) => relOf(a, srt1[k]));
  const midRel = relOf(pair[0].s0, pair[0].s1);
  const homeA = pair.some(p => p.s0 >= 0 && p.s1 >= 0 && p.s0 < p.s1), homeB = pair.some(p => p.s0 >= 0 && p.s1 >= 0 && p.s1 < p.s0);
  tol('L4 换边公平三条：排序公平 ≤10% + 中矿争夺 ≤10% + 家门矿成对存在',
    li.list.length === 3 && sortedRel.every(r => r <= 0.10) && midRel <= 0.10 && homeA && homeB,
    '排序后 [' + srt0.join(',') + '] vs [' + srt1.join(',') + ']（差 ' + sortedRel.map(r => (r * 100).toFixed(1) + '%').join('/') + '）；' +
    '中矿 ' + pair[0].s0 + ' vs ' + pair[0].s1 + '（' + (midRel * 100).toFixed(1) + '%）；家门矿 side0优=' + homeA + ' side1优=' + homeB +
    '；逐矿 ' + pair.map(p => '矿' + p.i + ':' + p.s0 + '/' + p.s1).join(' ') +
    '；竞选中盐 ' + (li.salt === undefined ? '—' : li.salt) + '/8，fairScore ' + (li.fairScore === undefined ? '—' : li.fairScore));
  /* L4h 硬线（机制线 2026-10-17，GAMEPLAY §5）：排序公平折进换盐后仍 >20% = 结构性偏袒，不许发布。
     与 L4 的 10% 目标线是两把不同的尺：10% 可红报实测，20% 是发布闸，红了先修生成器。 */
  hard('L4h 排序公平硬线 ≤20%（折进换盐后仍超 = 结构性偏袒，不许发布这种图）',
    li.list.length === 3 && sortedRel.every(r => r <= 0.20),
    '排序差最大值 ' + (Math.max.apply(null, sortedRel.map(r => r === Infinity ? 999 : r * 100))).toFixed(1) + '%');
  /* L4c 零残迹（机制线定死的回滚方式）：竞选选中图的 blocks 必须与"同 seed + 该 salt 直通一次生成"
     逐格一致——回滚是整图复位 + 重放（不是增量撤销），这条就是专门抓"8 次尝试路径才出现的残迹"。 */
  const wDirect = new G.World({ size: [64, 36, 64], seed: SEED >>> 0, sea: 12, lodeSalt: li.salt, lodes: true });
  wDirect.generate();
  let sameCells = li.salt !== undefined;
  if (sameCells) { const bA = lw.blocks, bB = wDirect.blocks; for (let bi = 0; bi < bA.length; bi++) if (bA[bi] !== bB[bi]) { sameCells = false; break; } }
  hard('L4c 竞选/回滚零残迹：选中图 == 同 seed 直接以该 salt 一次生成（逐格一致）',
    sameCells, 'lodeSalt=' + li.salt + '（直通图退化=' + (wDirect.lodes && wDirect.lodes.degraded) + '）');
}
const htmlText = require('fs').readFileSync(path.join(ROOT, 'index.html'), 'utf8');
tol('L5 浏览器已挂载 src/lode-planter.js 与 src/reachability-gate.js（机制线 UI 欠账，挂载前必须红）',
  /<script[^>]+src\/lode-planter\.js/.test(htmlText) && /<script[^>]+src\/reachability-gate\.js/.test(htmlText),
  'index.html 的 script 序列里还没有这两个文件——node 有矿脉、玩家双击的页面没有，不许当完成');
/* L6 默认图 == 量表尺寸（2026-10-18 重写，口径变更见给用户的说明）：多关卡之后"main.js 里写死的尺寸"
   这个概念已经消失（尺寸来自 map-presets + 选关），旧判据既读不到也不正确。新判据等价地守住同一件事：
   **默认关卡必须是量表验证过的那张图（64×36×64）**，且尺寸只来自 map-presets（session.js 不许再写死）。 */
const DEFMAP = G.mapPresetFor({});
const sessionSrc = require('fs').readFileSync(path.join(ROOT, 'src/app/session.js'), 'utf8');
tol('L6 默认图 == 量表尺寸（64×36×64），且尺寸来自 map-presets 而不是写死',
  DEFMAP.size.join('x') === '64x36x64' && /mapPresetFor/.test(sessionSrc) && !/size:\s*\[\s*96\s*,\s*40\s*,\s*96\s*\]/.test(sessionSrc),
  '默认 ' + DEFMAP.id + ' ' + DEFMAP.size.join('×') + ' / 量表 64×36×64');

console.log('\n' + (fail ? '\u2717' : '\u2713') + ' 硬回归 ' + pass + ' 绿 / ' + fail + ' 红；目标线未达 ' + target +
  ' 条  seed=' + SEED + ' aiLevel=' + LV + ' deck=' + DECKMODE + ' games=' + GAMES);
console.log('  明细：击杀 ' + stat.kills + '（玩家 ' + stat.pKills + ' / 随从 ' + stat.sKills + '） 复活 ' + stat.resps + ' 法阵 ' + stat.sigilsAdded + ' 召唤 ' + stat.summons +
  ' 出牌 ' + sum(stat.playedType) + ' 峰值 tick ' + stat.maxTickMs + 'ms / get ' + stat.maxGets);
process.exit(fail ? 1 : 0);
