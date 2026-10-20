#!/usr/bin/env node
/* tools/determinism.cjs · 重构等价性量具（S0）
   用途：同一棵树跑两次必须逐字节一致；跨 commit 对比时哈希与逐 tick trace 必须一致。
   它只跑权威层：World + Match + 固定输入 + 固定出牌脚本，不依赖 GL / DOM / 页面。

   用法：
     node tools/determinism.cjs
     node tools/determinism.cjs --seeds 490706,88092,31337 --ticks 400 --trace
   输出最后一行：SEED <seed> HASH <u32> ...
*/
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js','src/cards.js','src/vfx.js','src/vfx-recipes.js','src/chem.js','src/rules.js','src/battle.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SEEDS = String(arg('seeds', '490706,88092,31337')).split(',').map(function (s) { return parseInt(s, 10) >>> 0; });
const TICKS = parseInt(arg('ticks', '400'), 10) || 400;
const TRACE = process.argv.indexOf('--trace') >= 0;

function fnv(h, n) { h ^= n; return Math.imul(h, 16777619) >>> 0; }
function hashState(w, m) {
  let h = 2166136261;
  const blocks = w.blocks;
  for (let i = 0; i < blocks.length; i++) h = fnv(h, blocks[i]);
  for (let s = 0; s < m.players.length; s++) {
    const p = m.players[s];
    h = fnv(h, Math.round(p.pos.x * 100)); h = fnv(h, Math.round(p.pos.y * 100)); h = fnv(h, Math.round(p.pos.z * 100));
    h = fnv(h, p.hp | 0); h = fnv(h, p.score | 0); h = fnv(h, p.kills | 0);
    h = fnv(h, p.hand.length); h = fnv(h, p.deck.length); h = fnv(h, p.discard.length);
  }
  h = fnv(h, m.projectiles.length); h = fnv(h, m.summons.length); h = fnv(h, m.sigils.length);
  h = fnv(h, m.tick);
  return h >>> 0;
}

function run(seed) {
  const w = new G.World({ size: [64, 40, 64], seed: seed });
  w.generate();
  const noop = function () {};
  const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop,
               shieldUp: noop, fire: noop, float: noop, ambient: noop, quake: noop };
  const m = new G.Match({ world: w, seed: seed, players: 2, fx: fx });
  const ids = ['strike', 'wall2', 'dig3', 'bolt', 'meteors', 'golem'];
  const trace = [];
  for (let t = 0; t < TICKS; t++) {
    if (t % 40 === 0) {
      const p = m.players[0];
      p.hand[0] = ids[(t / 40) % ids.length];
      p.mana = 99; p.mats = 99; p.cooldowns = {};
      const ax = Math.floor(p.pos.x + 5), az = Math.floor(p.pos.z);
      p.aim = { x: ax + 0.5, y: w.surfaceY(ax, az) + 1.5, z: az + 0.5,
                gx: ax, gy: w.surfaceY(ax, az), gz: az, face: [0, 1, 0] };
      m.ctx.aim = p.aim; m.ctx.aimTarget = null;
      m.playCard(p, 0);
    }
    m.step(1 / 20, [{}, {}]);
    if (TRACE) trace.push(m.tick + '|' + hashState(w, m) + '|' + m.players.map(function (p) { return p.hp + '/' + p.score; }).join(','));
  }
  const hash = hashState(w, m);
  if (TRACE) trace.forEach(function (line) { console.log('T ' + seed + ' ' + line); });
  console.log('SEED ' + seed + ' HASH ' + hash + ' time=' + m.time.toFixed(2) + ' tick=' + m.tick +
    ' scores=' + m.players.map(function (p) { return p.score; }).join(',') +
    ' hp=' + m.players.map(function (p) { return p.hp; }).join(',') +
    ' proj=' + m.projectiles.length + ' sum=' + m.summons.length + ' sig=' + m.sigils.length);
  return hash;
}

let bad = 0;
for (let i = 0; i < SEEDS.length; i++) {
  if (!run(SEEDS[i])) bad++;
}
if (bad) process.exit(1);
