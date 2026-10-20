/* tools/hand_check.cjs · 类别手牌回归（用户 2026-10-17："整场实时性要求特别强，不能一不小心把技能当挖掘牌打出去"）
   口径：
     · p.handClass=null → 全类（老行为：出牌后随机补一张；AI / P2 / 所有既有回归走这条，行为零变化）
     · p.handClass=某类 → 手持栏只装这一类；同类打光**宁可空着**也不掺别类（"这一格一定能挖"必须可承诺）
     · 三条守恒：切类与补牌前后 hand+deck+discard 的**多重集不变**、hand 不超 5、同种子逐字节可复现
   用法：node tools/hand_check.cjs   退出码非 0 就是不达标 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/cards.js', 'src/battle.js'].forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
let n = 0, bad = 0;
function ck(name, ok, detail) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); } else console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
function mul(seed) { let s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function newMt(seed) { const mt = Object.create(G.Match.prototype); mt.rng = mul(seed); return mt; }
/* 守恒不成立时把差异直接打出来，别让人去猜 */
function diffSig(a, b) { if (a === b) return 'ok'; const A = JSON.parse(a), B = JSON.parse(b), o = {};
  [A, B].forEach(function (side) { side.forEach(function (c) { Object.keys(c).forEach(function (k) { o[k] = o[k] || { b: 0, a: 0 }; }); }); });
  Object.keys(o).forEach(function (k) { o[k].b = (A[0][k] || 0) + (A[1][k] || 0) + (A[2][k] || 0); o[k].a = (B[0][k] || 0) + (B[1][k] || 0) + (B[2][k] || 0); });
  const d = Object.keys(o).filter(function (k) { return o[k].b !== o[k].a; }).map(function (k) { return k + ' ' + o[k].b + '→' + o[k].a; });
  return d.length ? '差: ' + d.join(', ') : '签名顺序问题?'; }
function cnt(arr) { const o = {}; arr.forEach(function (x) { o[x] = (o[x] || 0) + 1; }); const s = {}; Object.keys(o).sort().forEach(function (k) { s[k] = o[k]; }); return s; }   // 键必须排序：多重集与插入顺序无关（不排序会把同一种牌判成不同）
function sig(p) { return JSON.stringify([cnt(p.hand), cnt(p.deck), cnt(p.discard)]); }
/* 守恒的正确比法：**hand+deck+discard 三堆之和**（切类一定重分布，比各堆分布是错的断言） */
function total(p) { return JSON.stringify(cnt(p.hand.concat(p.deck, p.discard))); }
function idsByType(t) { return Object.keys(G.CARDS_BY_ID).filter(function (id) { return (G.CARDS_BY_ID[id].type || 'utility') === t; }); }
function mkPlayer(hand, deck, discard) { return { hand: hand.slice(), deck: deck.slice(), discard: discard.slice(), handClass: null, name: 'P1' }; }

/* 0. 类型普查：五类都得有货，否则"切类"只是空承诺 */
const TYPES = ['terrain', 'spell', 'sigil', 'summon', 'utility'];
const census = TYPES.map(function (t) { return t + '=' + idsByType(t).length; }).join(' ');
ck('五类都有牌（不是空承诺）', TYPES.every(function (t) { return idsByType(t).length > 0; }), census);

/* 1. 未知类别：拒绝，且一张牌都不许动 */
{ const mt = newMt(7); const p = mkPlayer(['harvest', 'golem'], ['snare_trap', 'wall2'], []); const before = sig(p);
  const r = mt.equipClass(p, 'bogus-type');
  ck('未知类别被拒（不许猜）', r.ok === false && r.reason === 'no-class', JSON.stringify(r));
  ck('未知类别不改动脉堆', sig(p) === before); }

/* 2. 逐类切：纯度 + 守恒 + 上限 */
TYPES.forEach(function (t) {
  const mt = newMt(101); const deck = idsByType(t).concat(TYPES.filter(function (x) { return x !== t; }).map(function (x) { return idsByType(x)[0]; }));
  const p = mkPlayer(['heal', 'bridge'], deck, []);
  const before = total(p); const r = mt.equipClass(p, t);
  const pure = p.hand.every(function (id) { return mt.cardType(id) === t; });
  ck('切到 ' + t + '：手持栏全是这一类', r.ok === true && pure && p.hand.every(function (i) { return !!G.CARDS_BY_ID[i]; }), '手牌=' + p.hand.map(function (i) { return (G.CARDS_BY_ID[i] || { name: '?' + i }).name; }).join(','));
  ck('切到 ' + t + '：三堆之和不变（不造牌不吞牌）', total(p) === before, diffSig(before, total(p)));
  ck('切到 ' + t + '：不超 5 格', p.hand.length <= 5 && p.hand.length >= 1, '格数=' + p.hand.length);
});

/* 3. 非同类必须回到牌库**底**（数组头部才是底：抽牌从尾部 pop） */
{ const mt = newMt(3); const other = idsByType('spell')[0]; const p = mkPlayer([other, 'bridge', 'harvest'], ['wall2', idsByType('summon')[0]], []);
  mt.equipClass(p, 'terrain');
  /* 牌库底 = 数组头部（抽牌从尾部 pop）；原来的两张牌必须还在后面，不能被覆盖 */
  const atBottom = p.deck.indexOf(other) >= 0 && p.deck.indexOf(other) < 2;
  const inGame = function (id) { return p.hand.indexOf(id) >= 0 || p.deck.indexOf(id) >= 0; };
  const originalsKept = ['wall2', idsByType('summon')[0]].every(inGame);   // 只要求还在局内：同类那张已被装备到手上
  ck('手里非同类回到牌库底（不进弃牌堆、也不覆盖原牌库）', atBottom && originalsKept && p.discard.length === 0, 'deck=' + JSON.stringify(p.deck)); }

/* 4. 同类打光：宁可空着，绝不掺别类（这就是用户要的"一直挖不会甩出技能"） */
/* 全场 terrain 只有两张（另外那张在手上），任何时刻都不许出现第三张、也不许掺别类 */
{ const mt = newMt(11); const t2 = idsByType('terrain');
  const p = mkPlayer([t2[0]], [t2[1], idsByType('spell')[0], idsByType('summon')[0], idsByType('sigil')[0], idsByType('utility')[0]], []);
  const only2 = mt.equipClass(p, 'terrain');
  let pureAllRun = true, overCount = 0;
  for (let k = 0; k < 10; k++) {
    if (p.hand.length) { const id = p.hand.shift(); p.discard.push(id); }
    mt.refillHand(p);
    if (!p.hand.every(function (i) { return mt.cardType(i) === 'terrain'; })) pureAllRun = false;
    if (p.hand.length > 2) overCount++;
  }
  ck('同类打光后绝不掺别类（用户要的"不会甩出技能"）', pureAllRun, '手牌=' + p.hand.map(function (i) { return mt.cardType(i); }).join(','));
  ck('同类只有两张时最多两张（诚实空位，不硬凑五格）', only2.ok === true && overCount === 0 && p.hand.length <= 2, '格数=' + p.hand.length); }

/* 5. 没切类时行为必须与老版逐字节一致（AI / P2 / 既有回归靠这条不吃惊） */
{ const pool5 = ['heal', 'wall2', idsByType('spell')[0], 'bridge', 'golem', 'snare_trap', 'harvest'];
  const a = mkPlayer(['heal'], pool5, []);
  const b = mkPlayer(['heal'], pool5, []);
  const ma = newMt(555), mb = newMt(555);
  let same = true;
  for (let k = 0; k < 24; k++) {
    if (a.hand.length) { const id = a.hand.shift(); a.discard.push(id); }
    if (b.hand.length) { const id = b.hand.shift(); b.discard.push(id); }
    ma.refillHand(a);            // handClass=null → 内部走 drawCards
    mb.drawCards(b, 1, true);
    if (JSON.stringify([a.hand, a.deck, a.discard]) !== JSON.stringify([b.hand, b.deck, b.discard])) same = false;
  }
  ck('未切类：refillHand 与 drawCards 完全等价（老行为零漂移）', same, JSON.stringify(a.hand) + ' / ' + JSON.stringify(b.hand)); }

/* 6. 同种子可复现：200 次随机切类 + 打出，两次结果必须逐字节相同 */
{ function run(seed) { const mt = newMt(seed); const p = mkPlayer([], Object.keys(G.CARDS_BY_ID).slice(0, 24), []);
    for (let k = 0; k < 200; k++) { if (k % 7 === 0) mt.equipClass(p, TYPES[k % 5]); else if (p.hand.length) { const id = p.hand[k % p.hand.length]; p.hand.splice(k % p.hand.length, 1); p.discard.push(id); mt.refillHand(p); } }
    return sig(p); }
  ck('同种子 200 次操作可复现（洗牌只用 match.rng）', run(2026) === run(2026), run(2026).slice(0, 60)); }

/* 7. 真实初始牌库：切到挖掘至少有一张，且五类各切一遍都不空 */
{ const mt = newMt(9); const deck = (G.STARTER_DECK || []).slice();
  const empties = TYPES.filter(function (t) { const p = mkPlayer([], deck, []); mt.equipClass(p, t); return p.hand.length === 0; });
  ck('starter 牌库五类切一遍都有牌可用（不是选了个空类）', empties.length === 0, '空类=' + JSON.stringify(empties) + ' 牌库 ' + deck.length + ' 张'); }

console.log('\n共 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
