#!/usr/bin/env node
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js','src/cards.js','src/vfx.js','src/vfx-recipes.js','src/chem.js','src/rules.js','src/battle.js','src/systems/stats-store.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ← ' + extra : '')); } }
const w = new G.World({ size: [32, 24, 32], seed: 9 }); w.generate();
const noop = function () {};
const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop, fire: noop, float: noop, ambient: noop, quake: noop };
const m = new G.Match({ world: w, seed: 9, players: 2, fx: fx });
m.step(1/20, [{}, {}]);
m.players[0].score = 75; m.finish(0, 'score');
const r1 = G.StatsStore.record(m, { mode: 'train' });
ok('记录有 seed/mode/winner/reason/stats', r1 && r1.seed === 9 && r1.mode === 'train' && r1.winner === 0 && r1.reason === 'score' && !!r1.stats);
ok('stats 有 perSide', r1.stats && r1.stats.perSide.length === 2);
G.StatsStore.clear();
ok('add 成功', G.StatsStore.add(r1).ok);
ok('list 长度 1', G.StatsStore.list().length === 1);
G.StatsStore.add(Object.assign({}, r1, { winner: 1, reason: 'time', duration: 10 }));
G.StatsStore.add(Object.assign({}, r1, { winner: -1, reason: 'overtime-tie', duration: 20 }));
const agg = G.StatsStore.aggregate();
ok('聚合局数 3', agg.games === 3, agg.games);
ok('胜负平 = 1/1/1', agg.p1Wins === 1 && agg.p2Wins === 1 && agg.draws === 1);
ok('平均时长 = (1.1+10+20)/3 ≈ 10.4', Math.abs(agg.avgDuration - ((r1.duration + 10 + 20) / 3)) < 0.2, agg.avgDuration);
ok('胜率 1/3', Math.abs(agg.winRate - 1/3) < 0.01, agg.winRate);
G.StatsStore.clear();
ok('clear 后 0 局', G.StatsStore.list().length === 0 && G.StatsStore.aggregate().games === 0);
console.log('\n共 ' + (pass + fail) + ' 条，失败 ' + fail);
process.exit(fail ? 1 : 0);
