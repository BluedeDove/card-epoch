#!/usr/bin/env node
/* tools/rational_probe.cjs · RationalAgent 三组对照量表（定案 §7.1 条 17 / GAMEPLAY §5 M6a）
   回答四个问题：① 理性代理的矿独占秒数与得分构成（矿分 vs 击杀分）；② 占矿多的一方是不是胜者；
   ③ M6a 地形卡"抽到后打出"率（目标 ≥40%，AI 口径只能否证"没人打"）；④ 与镜像组的时长差。
   用法：node tools/rational_probe.cjs [seed] [games] [groups]
     seed 默认 490706；games 默认 12（按 seed+11*i 取图，同 play_probe）；groups 默认 mirror,mixed,rational。
   mixed 组按局序交替 Rational 所在侧（side = 局号 % 2），换边不偏。 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js', 'src/net.js']
  .forEach(f => require(path.join(ROOT, f)));
const { RationalAgent } = require('./rational_agent.cjs');
const G = global.window.GW;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const GAMES = Math.max(1, parseInt(process.argv[3], 10) || 12);
const GROUPS = (process.argv[4] || 'mirror,mixed,rational').split(',');
const STEP = 1 / 20, MAXT = 9600 * 2;          // 480s 钟 + 加时 90s 上限外再留余量

function noop() {}
const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop,
             shieldUp: noop, fire: noop, float: noop, ambient: noop, chemLog: noop };
function makeWorld(seed) { const w = new G.World({ size: [64, 36, 64], seed: seed >>> 0, sea: 12, lodes: true }); w.generate(); return w; }

/* 出牌/抽牌插桩（与 play_probe 同一手法，按 side 分账） */
const stat = {};
function resetStat() { stat.played = [{}, {}]; stat.drawn = [{}, {}]; stat.playedTot = [0, 0]; }
resetStat();
const proto = G.Match.prototype, oPlay = proto.playCard, oDraw = proto.drawCards;
proto.playCard = function (p, index) {
  const id = p.hand && p.hand[index], ty = (G.CARDS_BY_ID[id] || {}).type || 'unknown';
  const r = oPlay.apply(this, arguments);
  if (r) { stat.played[p.side][ty] = (stat.played[p.side][ty] || 0) + 1; stat.playedTot[p.side]++; }
  return r;
};
proto.drawCards = function (p, n, silent) {
  const before = p.hand.length, r = oDraw.apply(this, arguments);
  if (p.hand.length > before) {
    const ty = (G.CARDS_BY_ID[p.hand[p.hand.length - 1]] || {}).type || 'unknown';
    stat.drawn[p.side][ty] = (stat.drawn[p.side][ty] || 0) + 1;
  }
  return r;
};

function runGame(seed, kinds) {
  const w = makeWorld(seed);
  const m = new G.Match({ world: w, seed: seed >>> 0, mode: 'train', players: 2, fx });
  const src = kinds.map((k, side) => k === 'rational' ? new RationalAgent(m, side) : new G.Net.AISource(m, side, 1));
  let ticks = 0;
  while (!m.over && ticks < MAXT) {
    const a = src[0].poll(STEP), b = src[1].poll(STEP);
    m.step(STEP, [a, b]);
    ticks++;
  }
  /* 收成：矿分 = LodeSystem.producedScore 之和；击杀分 = 总得分 − 矿分（唯一入分口只有这两条） */
  const lodePts = [0, 0], holdSec = [0, 0], mats = [0, 0];
  if (m.lodeSys) m.lodeSys.lodes.forEach(L => {
    lodePts[0] += L.producedScore[0]; lodePts[1] += L.producedScore[1];
    holdSec[0] += L.holdSec[0]; holdSec[1] += L.holdSec[1];
    mats[0] += L.producedMats[0]; mats[1] += L.producedMats[1];
  });
  const tPlayed = [(stat.played[0].terrain || 0), (stat.played[1].terrain || 0)];
  const tDrawn = [(stat.drawn[0].terrain || 0), (stat.drawn[1].terrain || 0)];
  return {
    seed, ticks, time: m.time, over: m.over,
    winner: m.over ? m.over.winner : -1, reason: m.over ? m.over.winReason : 'timeout',
    score: m.players.map(p => p.score),
    lodePts, killPts: m.players.map((p, i) => p.score - lodePts[i]),
    holdSec, lodeMats: mats,
    terrain: [tPlayed, tDrawn],
    playedTot: stat.playedTot.slice(),
    kinds
  };
}

function median(a) { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function f1(x) { return (+x).toFixed(1); }

for (const grp of GROUPS) {
  resetStat();
  const recs = [];
  for (let i = 0; i < GAMES; i++) {
    const seed = (SEED + i * 11) >>> 0;
    let kinds;
    if (grp === 'mirror') kinds = ['ai', 'ai'];
    else if (grp === 'rational') kinds = ['rational', 'rational'];
    else kinds = (i % 2 === 0) ? ['rational', 'ai'] : ['ai', 'rational'];   // mixed：交替所在侧
    recs.push(runGame(seed, kinds));
  }
  /* 聚合 */
  const rSide = grp === 'mirror' ? [] : recs.map(r => r.kinds[0] === 'rational' ? 0 : 1);
  const wins = [0, 0];
  let rWins = 0, holderWins = 0, decided = 0, timeout = 0;
  recs.forEach((r, i) => {
    if (r.winner === 0 || r.winner === 1) { wins[r.winner]++; decided++; }
    else timeout++;
    if (grp !== 'mirror' && r.winner === rSide[i]) rWins++;
    /* 占矿多者胜：在有明确更多占矿秒数（≥5 秒差）的局里看胜负归属 */
    if (Math.abs(r.holdSec[0] - r.holdSec[1]) >= 5 && (r.winner === 0 || r.winner === 1)) {
      const holder = r.holdSec[0] > r.holdSec[1] ? 0 : 1;
      if (r.winner === holder) holderWins++;
    }
  });
  const holderGames = recs.filter(r => Math.abs(r.holdSec[0] - r.holdSec[1]) >= 5 && (r.winner === 0 || r.winner === 1)).length;
  const durs = recs.map(r => r.time);
  const agg = {
    group: grp, seed0: SEED, games: GAMES,
    wins, timeout,
    rWins: grp === 'mirror' ? null : rWins,
    durMedian: +median(durs).toFixed(1), durMean: +mean(durs).toFixed(1),
    holdMean: [f1(mean(recs.map(r => r.holdSec[0]))), f1(mean(recs.map(r => r.holdSec[1])))],
    lodePtsMean: [f1(mean(recs.map(r => r.lodePts[0]))), f1(mean(recs.map(r => r.lodePts[1])))],
    killPtsMean: [f1(mean(recs.map(r => r.killPts[0]))), f1(mean(recs.map(r => r.killPts[1])))],
    scoreMean: [f1(mean(recs.map(r => r.score[0]))), f1(mean(recs.map(r => r.score[1])))],
    lodeMatsMean: [f1(mean(recs.map(r => r.lodeMats[0]))), f1(mean(recs.map(r => r.lodeMats[1])))],
    holderWins, holderGames,
    reasons: recs.reduce((a, r) => { a[r.reason] = (a[r.reason] || 0) + 1; return a; }, {}),
    m6a: grp === 'mirror' ? null : (() => {
      let p = 0, d = 0;
      recs.forEach((r, i) => { const s = rSide[i]; p += r.terrain[0][s]; d += r.terrain[1][s]; });
      return { played: p, drawn: d, rate: d ? +(p / d).toFixed(3) : null };
    })(),
    m6aAll: (() => {
      let p = 0, d = 0;
      recs.forEach(r => { p += r.terrain[0][0] + r.terrain[0][1]; d += r.terrain[1][0] + r.terrain[1][1]; });
      return { played: p, drawn: d, rate: d ? +(p / d).toFixed(3) : null };
    })()
  };
  console.log('\n── 组 ' + grp + '（' + GAMES + ' 局，seed ' + SEED + '+11i）──');
  console.log('  胜负 side0/side1: ' + wins[0] + '/' + wins[1] + (grp === 'mirror' ? '' : '（Rational 侧胜 ' + rWins + '）') + '  超时 ' + timeout);
  console.log('  时长 中位/均值: ' + agg.durMedian + 's / ' + agg.durMean + 's  结局 ' + JSON.stringify(agg.reasons));
  console.log('  矿独占秒均值 side0/side1: ' + agg.holdMean.join(' / ') + '  矿分均值: ' + agg.lodePtsMean.join(' / ') +
    '  击杀分均值: ' + agg.killPtsMean.join(' / ') + '  总分均值: ' + agg.scoreMean.join(' / '));
  console.log('  占矿多者胜: ' + holderWins + '/' + holderGames + '（占矿秒差 ≥5s 的局）  矿素材均值: ' + agg.lodeMatsMean.join(' / '));
  if (agg.m6a) console.log('  M6a（Rational 侧）地形卡打出/抽到: ' + agg.m6a.played + '/' + agg.m6a.drawn + ' = ' + (agg.m6a.rate === null ? '—' : (agg.m6a.rate * 100).toFixed(1) + '%') +
    '（对照·含 AI 全员: ' + agg.m6aAll.played + '/' + agg.m6aAll.drawn + ' = ' + (agg.m6aAll.rate * 100).toFixed(1) + '%）');
  else console.log('  M6a（全员）地形卡打出/抽到: ' + agg.m6aAll.played + '/' + agg.m6aAll.drawn + ' = ' + (agg.m6aAll.rate * 100).toFixed(1) + '%');
  console.log('  JSON ' + JSON.stringify(agg));
}
