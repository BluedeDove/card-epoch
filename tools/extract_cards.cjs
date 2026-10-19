'use strict';
/* tools/extract_cards.cjs - 从 src/cards.js 机械抽取 56 张卡与法阵表，生成 src/cards/card-catalog.js。
   动机同 extract_dom：卡表手抄必错；数据只有一份真源，改卡请改 src/cards.js 后重跑本工具（P7 后真源即本文件）。
   用法：node tools/extract_cards.cjs [源=src/cards.js] */
var fs = require('fs');
var source = process.argv[2] || 'src/cards.js';
var src = fs.readFileSync(source, 'utf8');
var bodies = src.split('\n').filter(function (l) { return /^  C\(\{ id: /.test(l); })
  .map(function (l) { return l.trim().replace(/^C\(\{ id: /, '{ id: ').replace(/\}\);$/, '}'); });
if (bodies.length !== 56) { console.error('抽取到 ' + bodies.length + ' 张卡，预期 56 —— 源文件结构变了，先去核对'); process.exit(2); }
var head = [
  'window.GW = window.GW || {};',
  '(function (G) {',
  "  'use strict';",
  '',
  '  /* 依赖：src/cards/effect-grammar.js（效果短名）',
  '     56 张卡，纯数据。数值基准：1 魔力 = 6 伤害 = 5 护盾 = 1 格地形改造。',
  '     本文件由 tools/extract_cards.cjs 从 src/cards.js 机械生成，勿手抄改动。',
  '     等价性由 /tmp/gw_cards_check.cjs 与 .artifacts/cards-golden.json 把守。 */',
  '  var EG = G.EffectGrammar;',
  '  var dmg = EG.damage, shield = EG.shield, sb = EG.setBlock, st = EG.status, sp = EG.spawn, sg = EG.sigil;',
  '  var CARDS = G.CARDS = [];',
  '  var BY_ID = G.CARDS_BY_ID = {};',
  '',
  '  function register(o) {',
  '    scalarDefaults(o); structuralDefaults(o);',
  '    CARDS.push(o); BY_ID[o.id] = o; return o;',
  '  }',
  '  /* 默认值口径与旧版逐字段一致：cost 用 undefined 判、其余用 || */',
  '  function scalarDefaults(o) {',
  '    if (o.cost === undefined) o.cost = 1;',
  "    if (!o.rarity) o.rarity = 'common'; if (!o.element) o.element = 'neutral';",
  "    if (!o.type) o.type = 'spell'; if (!o.cooldown) o.cooldown = 0;",
  '  }',
  '  function structuralDefaults(o) {',
  '    if (!o.requires) o.requires = []; if (!o.effects) o.effects = [];',
  "    if (!o.targeting) o.targeting = { shape: 'self' };",
  '    if (!o.tags) o.tags = [o.type, o.element]; if (o.text === undefined) o.text = \'\';',
  '  }',
  '  G.registerCard = register;',
  '',
  '  var CATALOG = ['].join('\n');
var out = head + '\n' + bodies.map(function (b) { return '    ' + b; }).join(',\n') + '\n  ];\n  CATALOG.forEach(register);\n})(window.GW);\n';
fs.writeFileSync('src/cards/card-catalog.js', out);
console.log('已生成 src/cards/card-catalog.js：' + bodies.length + ' 张卡，' + out.split('\n').length + ' 行');
