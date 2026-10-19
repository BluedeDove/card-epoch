#!/usr/bin/env node
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js', 'src/cards.js', 'src/cards/effect-spec.js', 'src/rules.js', 'src/vfx.js', 'src/vfx-recipes.js', 'src/chem.js'].forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ← ' + extra : '')); } }

const unknown = [], noShape = [], empty = [];
let totalOps = 0;
for (const card of G.CARDS) {
  const ops = G.EffectSpec.expand(card);
  totalOps += ops.length;
  const v = G.EffectSpec.validate(ops);
  if (v.unknown.length) unknown.push(card.id + ':' + v.unknown.join(','));
  if (v.badShape.length) noShape.push(card.id + ':' + v.badShape.join(','));
  if (!ops.length && card.effects && card.effects.length) empty.push(card.id);
}
ok('卡牌数 > 60', G.CARDS.length > 60, G.CARDS.length);
ok('展开 op 总数 > 80', totalOps > 80, totalOps);
ok('没有未知 op', unknown.length === 0, unknown.slice(0, 6).join(' | '));
ok('setBlock 都映射到 shape', noShape.length === 0, noShape.slice(0, 6).join(' | '));
ok('没有卡展开成空', empty.length === 0, empty.slice(0, 6).join(' | '));

const a = JSON.stringify(G.CARDS.map((c) => G.EffectSpec.expand(c)));
const b = JSON.stringify(G.CARDS.map((c) => G.EffectSpec.expand(c)));
ok('同输入两次展开逐字节一致', a === b);
function hasFn(v) { if (typeof v === 'function') return true; if (!v || typeof v !== 'object') return false; for (const k in v) if (hasFn(v[k])) return true; return false; }
ok('展开结果无函数（可 JSON 化）', !hasFn(G.CARDS.map((c) => G.EffectSpec.expand(c))));

const wall = G.EffectSpec.expand(G.CARDS_BY_ID['wall2'])[0];
ok('wall2 → cells/line', wall && wall.op === 'cells' && wall.shape.type === 'line', JSON.stringify(wall && wall.shape));
const bridge = G.EffectSpec.expand(G.CARDS_BY_ID['bridge'])[0];
ok('bridge → trace/ballistic', bridge && bridge.shape.type === 'trace' && bridge.shape.path === 'ballistic');
const meteors = G.EffectSpec.expand(G.CARDS_BY_ID['meteors'])[0];
ok('meteors → sigil', meteors && meteors.op === 'sigil' && meteors.sigilId === 'meteors');

console.log('5) rules 接受新 spec 的 cells op');
{
  const fake = { effects: [{ op: 'cells', maxCells: 12 }] };
  ok('cardCellCap 认 cells 的 maxCells', G.Rules.cardCellCap(fake, null) === 12, G.Rules.cardCellCap(fake, null));
  const fake2 = { effects: [{ op: 'cells' }] };
  ok('cells 缺省 maxCells 回落到 9', G.Rules.cardCellCap(fake2, null) === 9, G.Rules.cardCellCap(fake2, null));
  ok('spawn/sigil 已登记为原子处理器', typeof G.RULES_EFFECTS.spawn === 'function' && typeof G.RULES_EFFECTS.sigil === 'function',
    Object.keys(G.RULES_EFFECTS).join(','));
}

console.log('\n共 ' + (pass + fail) + ' 条，失败 ' + fail);
process.exit(fail ? 1 : 0);
