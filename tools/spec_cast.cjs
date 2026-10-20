#!/usr/bin/env node
/* tools/spec_cast.cjs · 新 EffectSpec（cells）端到端：不经过 setBlock 也能建地形 */
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js','src/cards.js','src/vfx.js','src/vfx-recipes.js','src/chem.js','src/rules.js','src/battle.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW, B = G.BLOCK;
let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ← ' + extra : '')); } }

const w = new G.World({ size: [32, 24, 32], seed: 11 });
w.generate();
const noop = function () {};
const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop, fire: noop, float: noop, ambient: noop, quake: noop };
const m = new G.Match({ world: w, seed: 11, players: 2, fx: fx });
const p = m.players[0];
p.mana = 99; p.mats = 99; p.cooldowns = {};
const ax = Math.floor(p.pos.x) + 3, az = Math.floor(p.pos.z);
const gy = w.surfaceY(ax, az);
p.aim = { x: ax + 0.5, y: gy + 1.5, z: az + 0.5, gx: ax, gy: gy, gz: az, face: [0, 1, 0] };
m.ctx.aim = p.aim; m.ctx.aimTarget = null;

function count(id) { let n = 0; for (let i = 0; i < w.blocks.length; i++) if (w.blocks[i] === id) n++; return n; }
const before = count(B.PLANK);
const card = {
  id: 'spec_fill', name: 'spec', cost: 1, element: 'rock', type: 'terrain', requires: [], cooldown: 0,
  targeting: { shape: 'ray', maxDist: 9 },
  effects: [{ op: 'cells', mode: 'fill', block: 'plank', radius: 0, maxCells: 9 }]
};
const r = G.Rules.play(card, p, m.ctx);
ok('Rules.play 接受 cells 卡', r === true, JSON.stringify(r));
const after = count(B.PLANK);
ok('真的放下了木板（cells → setBlock 执行）', after > before, before + '→' + after);
ok('最多 9 格（cap 生效）', after - before <= 9, after - before);

p.mana = 99; p.mats = 99; p.cooldowns = {};
const card2 = Object.assign({}, card, { id: 'spec_wall', effects: [{ op: 'cells', mode: 'wall', block: 'brick', length: 3, height: 2, maxCells: 6 }] });
const before2 = count(B.BRICK);
const r2 = G.Rules.play(card2, p, m.ctx);
ok('墙的 cells spec 也能出', r2 === true);
ok('墙最多 6 格', count(B.BRICK) - before2 > 0 && count(B.BRICK) - before2 <= 6, count(B.BRICK) - before2);

console.log('6) 非地形原子也能走同一条出牌通道');
{
  p.mana = 99; p.mats = 99; p.cooldowns = {};
  const beforeSum = m.summons.length;
  const summonCard = { id: 'spec_summon', name: 'spec', cost: 1, element: 'rock', type: 'summon', requires: [], cooldown: 0,
    targeting: { shape: 'self' }, effects: [{ op: 'spawn', kind: 'golem', count: 1, hp: 20, dmg: 5, ai: 'melee' }] };
  const rs = G.Rules.play(summonCard, p, m.ctx);
  ok('召唤 spec 出牌成功', rs === true);
  ok('随从表 +1', m.summons.length === beforeSum + 1, beforeSum + '→' + m.summons.length);

  p.mana = 99; p.mats = 99; p.cooldowns = {};
  const beforeSig = m.sigils.length;
  const sigilCard = { id: 'spec_sigil', name: 'spec', cost: 1, element: 'fire', type: 'sigil', requires: [], cooldown: 0,
    targeting: { shape: 'circle', radius: 2, maxDist: 9 }, effects: [{ op: 'sigil', sigilId: 'meteors', delay: 0.1, ttl: 1 }] };
  const rg = G.Rules.play(sigilCard, p, m.ctx);
  ok('法阵 spec 出牌成功', rg === true);
  ok('法阵表 +1', m.sigils.length === beforeSig + 1, beforeSig + '→' + m.sigils.length);
}

console.log('\n共 ' + (pass + fail) + ' 条，失败 ' + fail);
process.exit(fail ? 1 : 0);
