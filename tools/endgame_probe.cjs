#!/usr/bin/env node
/* tools/endgame_probe.cjs · 终局量表（A2-c 固化；前身为 /tmp 一次性驱动）
   回答的问题：终局可达性机制的收束率与卫生指标——score 结局占比、越线时刻中位、
   contested（双方同台零产出）占比、宽限清零次数、素材赚取/消费/顶帽时长、走位计划切换。
   机制口径（GAMEPLAY_ENDGAME_R2 / A2-c）：占矿宽限 holdGrace、胜分 scoreWin、加时 45s 逐级判。

   用法（全部走 flags，位置参数不认）：
     node tools/endgame_probe.cjs [--group=rr|mixed|mirror|peace|all] [--grace=秒] [--score-win=分] [--seed=490706] [--games=12]
   默认 = --group=rr --grace=0 --score-win=100 —— 即"现状"（宽限关、胜分 100），
   新行为默认关闭：任何误提交都不会改变这个默认输出（A2-b 事故规矩）。

   口径备注：
   - mirror 组恒 0% score 是**正确行为**（老 AISource 从不占矿，配贴钟判分），写在这里防下一个人把它当回归。
   - "越线中位" = score 结局局的首次到线时刻中位（score 局里 = 局时长）；非 score 局不进这个统计。
   - contested 占比为 tick-lode 口径：双方同时在台的 tick ÷ （总 tick × 矿数）。
   - holdGrace 的接线：battle.js 的 LodeSystem 装配行若已转发 opts 则由 Match opts 直达；
     未转发时本工具在构造后幂等补写 m.lodeSys.holdGrace（与 H4 族兼容：量具直改字段是既有先例）。
   - peace 组（双 passive 蹲家矿）是"和平刷分成最优解"的哨兵：必须 score 结局，时刻带见 GAMEPLAY_ENDGAME_R2 §5.2。
*/
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js', 'src/net.js']
  .forEach(f => require(path.join(ROOT, f)));
const { RationalAgent } = require('./rational_agent.cjs');
const G = global.window.GW;

const ARGS = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)=(.*)$/);
  if (m) ARGS[m[1]] = m[2];
}
const SEED = (parseInt(ARGS.seed || '490706', 10) || 490706) >>> 0;
const GAMES = Math.max(1, parseInt(ARGS.games || '12', 10) || 12);
const GRACE = parseFloat(ARGS.grace || '0');
const SCORE = parseInt(ARGS['score-win'] || '100', 10) || 100;
const GROUPS = (ARGS.group || 'rr') === 'all' ? ['rr', 'mixed', 'mirror', 'peace'] : (ARGS.group || 'rr').split(',');
const STEP = 1 / 20, MAXT = 19200;
const MAT_CAP = 24;   // 只读引用 play_probe 的 T_MAT_CAP（判据不归本工具改）
const noop = () => {};
const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop, fire: noop, float: noop, ambient: noop, chemLog: noop };
function wrapPi(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }

/* 和平代理：BFS（ReachabilityGate，与闸门同尺）走向家矿平台，站上就停，从不出牌。
   卡住按 0.6s 冷却点跳（按住跳键不自跳是既有输入语义）+ 交替侧移绕障。 */
class PeaceAgent {
  constructor(m, side) {
    this.m = m; this.side = side;
    const sp = m.spawnPts[side];
    const dist = G.ReachabilityGate.bfs(m.world, Math.floor(sp.x), Math.floor(sp.z));
    const lodes = (m.world.lodes && m.world.lodes.list) || [];
    let best = null, bd = 1e9;
    lodes.forEach((L) => { const d = dist[L.z * m.world.SX + L.x]; if (d >= 0 && d < bd) { bd = d; best = L; } });
    this.home = best;
    this.field = best ? G.ReachabilityGate.bfs(m.world, best.x, best.z) : null;
    this.lastD = 1e9; this.stall = 0; this.jumpCd = 0; this.strafe = side ? 1 : -1;
  }
  poll(dt) {
    const o = { fwd: 0, back: 0, left: 0, right: 0, jump: 0, crouch: 0, cast: -1, lookYaw: 0, lookPitch: 0 };
    const p = this.m.players[this.side], L = this.home;
    if (!p.alive || !L || !this.field) return o;
    const cx = Math.floor(p.pos.x), cz = Math.floor(p.pos.z);
    const onPlat = L.cells.some(c => c[0] === cx && c[1] === cz) && Math.abs((p.pos.y - p.h / 2) - (L.y + 1)) < 2.5;
    if (onPlat) return o;
    const SX = this.m.world.SX;
    let bx = 0, bz = 0, bd = this.field[cz * SX + cx];
    if (bd === undefined || bd < 0) return o;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
      const v = this.field[(cz + d[1]) * SX + (cx + d[0])];
      if (v !== undefined && v >= 0 && v < bd) { bd = v; bx = d[0]; bz = d[1]; }
    });
    if (!bx && !bz) return o;
    const want = Math.atan2(bx, bz);
    o.lookYaw = Math.max(-0.3, Math.min(0.3, wrapPi(want - p.yaw)));
    o.fwd = 1;
    if (bd >= this.lastD) { this.stall += dt; } else { this.stall = 0; this.lastD = bd; }
    this.jumpCd -= dt;
    if (this.stall > 0.5) {
      if (this.jumpCd <= 0) { o.jump = 1; this.jumpCd = 0.6; }
      if (this.stall > 1.5) { o.right = this.strafe > 0 ? 1 : 0; o.left = this.strafe < 0 ? 1 : 0; }
      if (this.stall > 3) { this.strafe = -this.strafe; this.stall = 0.6; }
    }
    return o;
  }
}

function runGame(seed, kinds) {
  const w = new G.World({ size: [64, 36, 64], seed, sea: 12, lodes: true }); w.generate();
  const m = new G.Match({ world: w, seed, mode: 'train', players: 2, fx, scoreWin: SCORE, holdGrace: GRACE });
  /* 接线债兼容：battle.js 装配行未转发 opts 时（或未挂载时守卫 null），构造后幂等补写 */
  if (m.lodeSys && m.lodeSys.holdGrace !== GRACE) m.lodeSys.holdGrace = GRACE;
  const agents = kinds.map((k, side) => k === 'rational' ? new RationalAgent(m, side) : k === 'peace' ? new PeaceAgent(m, side) : new G.Net.AISource(m, side, 1));
  const ls = m.lodeSys ? m.lodeSys.lodes : [];
  const lastExcl = ls.map(() => -1);
  let flips = 0, contestedSec = 0, tickLodes = 0, planSwitches = 0;
  const prevMats = m.players.map(p => p.mats);
  const prevPlan = [null, null];
  const matsGained = [0, 0], matsSpent = [0, 0], pinnedSec = [0, 0];
  const crossAt = [null, null];
  let t = 0;
  while (!m.over && t < MAXT) {
    m.step(STEP, [agents[0].poll(STEP), agents[1].poll(STEP)]); t++;
    m.players.forEach((p, i) => {
      if (crossAt[i] === null && p.score >= SCORE) crossAt[i] = m.time;
      const d = p.mats - prevMats[i];
      if (d > 0) matsGained[i] += d; else matsSpent[i] -= d;
      if (p.mats >= MAT_CAP) pinnedSec[i] += STEP;
      prevMats[i] = p.mats;
    });
    agents.forEach((a, i) => {
      if (!(a instanceof RationalAgent)) return;
      const key = a.plan ? a.plan.type + ':' + (a.plan.i === undefined ? '' : a.plan.i) : 'none';
      if (prevPlan[i] !== null && key !== prevPlan[i]) planSwitches++;
      prevPlan[i] = key;
    });
    ls.forEach((L, li) => {
      tickLodes++;
      const on = [false, false];
      m.players.forEach(p => {
        if (!p.alive) return;
        const feet = p.pos.y - p.h / 2;
        if (feet < L.y || feet > L.y + 3.5) return;
        const cx = Math.floor(p.pos.x), cz = Math.floor(p.pos.z);
        if (L.cells.some(c => c[0] === cx && c[1] === cz)) on[p.side] = true;
      });
      if (on[0] && on[1]) contestedSec += STEP;
      if (L.owner >= 0 && lastExcl[li] >= 0 && L.owner !== lastExcl[li]) flips++;
      if (L.owner >= 0) lastExcl[li] = L.owner;
    });
  }
  const lodePts = [0, 0], holdSec = [0, 0], lodeMats = [0, 0];
  ls.forEach(L => {
    lodePts[0] += L.producedScore[0]; lodePts[1] += L.producedScore[1];
    holdSec[0] += L.holdSec[0]; holdSec[1] += L.holdSec[1];
    lodeMats[0] += L.producedMats[0]; lodeMats[1] += L.producedMats[1];
  });
  return {
    seed, time: m.time, winner: m.over ? m.over.winner : null, reason: m.over ? m.over.winReason : 'open',
    score: m.players.map(p => p.score), holdSec, lodePts, lodeMats,
    killPts: m.players.map((p, i) => p.score - lodePts[i]),
    flips, contestedSec, tickLodes, graceClears: ls.reduce((a, L) => a + (L.graceClears || 0), 0),
    endMats: m.players.map(p => p.mats), matsGained, matsSpent, pinnedSec, crossAt,
    planSwitches, kinds
  };
}
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

console.log('endgame_probe: group=' + GROUPS.join(',') + ' grace=' + GRACE + ' scoreWin=' + SCORE + ' seed=' + SEED + ' games=' + GAMES);
for (const grp of GROUPS) {
  const recs = [];
  for (let i = 0; i < GAMES; i++) {
    const seed = (SEED + i * 11) >>> 0;
    const kinds = grp === 'mirror' ? ['ai', 'ai'] : (grp === 'rr' || grp === 'rational') ? ['rational', 'rational'] : grp === 'peace' ? ['peace', 'peace'] : (i % 2 === 0 ? ['rational', 'ai'] : ['ai', 'rational']);
    recs.push(runGame(seed, kinds));
  }
  const wins = [0, 0]; let rWins = 0, open = 0;
  const rSide = (grp === 'mixed') ? recs.map(r => r.kinds[0] === 'rational' ? 0 : 1) : null;
  recs.forEach((r, i) => {
    if (r.winner === 0 || r.winner === 1) wins[r.winner]++;
    if (r.reason === 'open') open++;
    if (rSide && r.winner === rSide[i]) rWins++;
  });
  const reasons = {}; recs.forEach(r => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
  const crossers = recs.filter(r => r.reason === 'score').map(r => Math.min(r.crossAt[0] === null ? 1e9 : r.crossAt[0], r.crossAt[1] === null ? 1e9 : r.crossAt[1]));
  const totSec = recs.reduce((a, r) => a + r.time, 0);
  console.log('\n── ' + grp + ' × ' + GAMES + ' 局 ──');
  console.log('  score 结局 ' + (reasons.score || 0) + '/' + GAMES + '（' + (100 * (reasons.score || 0) / GAMES).toFixed(1) + '%）  越线中位 ' +
    (crossers.length ? med(crossers).toFixed(1) + 's' : '—') + '  时长中位 ' + med(recs.map(r => r.time)).toFixed(1) + 's');
  console.log('  结局分布 ' + JSON.stringify(reasons) + '  无界(open) ' + open + '  胜负 side0/side1 ' + wins[0] + '/' + wins[1] +
    (rSide ? '  Rational 侧胜 ' + rWins + '/' + GAMES + '（' + (100 * rWins / GAMES).toFixed(1) + '%）' : ''));
  console.log('  矿独占秒/侧 ' + mean(recs.map(r => r.holdSec[0])).toFixed(1) + '/' + mean(recs.map(r => r.holdSec[1])).toFixed(1) +
    '  矿分 ' + mean(recs.map(r => r.lodePts[0])).toFixed(1) + '/' + mean(recs.map(r => r.lodePts[1])).toFixed(1) +
    '  击杀分 ' + mean(recs.map(r => r.killPts[0])).toFixed(1) + '/' + mean(recs.map(r => r.killPts[1])).toFixed(1));
  console.log('  contested 占比 ' + (100 * recs.reduce((a, r) => a + r.contestedSec, 0) * 20 / Math.max(1, recs.reduce((a, r) => a + r.tickLodes, 0))).toFixed(2) + '%（tick-lode）' +
    '  宽限清零/局 ' + mean(recs.map(r => r.graceClears)).toFixed(2) + '  易主/局 ' + mean(recs.map(r => r.flips)).toFixed(2));
  console.log('  素材：终局均值 ' + mean(recs.map(r => r.endMats[0])).toFixed(1) + '/' + mean(recs.map(r => r.endMats[1])).toFixed(1) +
    '  顶帽(≥' + MAT_CAP + ')秒/侧 ' + mean(recs.map(r => r.pinnedSec[0])).toFixed(1) + '/' + mean(recs.map(r => r.pinnedSec[1])).toFixed(1) +
    '  赚取/分钟 ' + (60 * recs.reduce((a, r) => a + r.matsGained[0] + r.matsGained[1], 0) / Math.max(1, totSec)).toFixed(1) +
    '  消费/分钟 ' + (60 * recs.reduce((a, r) => a + r.matsSpent[0] + r.matsSpent[1], 0) / Math.max(1, totSec)).toFixed(1) +
    '  走位计划切换/局 ' + mean(recs.map(r => r.planSwitches)).toFixed(1));
}
