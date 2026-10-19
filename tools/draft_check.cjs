#!/usr/bin/env node
/* tools/draft_check.cjs · 三选一回归（定案 docs/CARD_ECONOMY.md §2 S2/S3 + §2.1；任务书 docs/tasks/T3_DRAFT.md）

   管住什么（"占矿会给牌"这件事只能这样核对）：
     D1 卡池是真数据：三群系各 8 张 + 通用 8 张、每个 id 都在 G.CARDS_BY_ID 里、池内不重复；
        并且**与 CARD_ECONOMY §2.1 的表逐元素一致（含顺序）**——文档改了没同步过来，这里先红
     D2 名义群系：三矿互不相同（不会三条都是林海）；同 seed 两次构造一致；换 seed 至少有一次排列不同
     D3 触发：玩家站上矿平台跑 0.1s → 队列里出现 source==='lode' 的 offer，3 张互不相同且都来自该矿的池
     D4 一次只弹一个：继续站着再跑 1s，不会叠出第二个同方 offer（同方队列长度 ≤1）
     D5 选中：牌库 +2 且含该 id 两次、手牌一字不动、队列清空、占矿次数 +1
     D6 额度：三条矿各占一次后第 4 次 offer 被拒（默认 draftCapLode=3，不传也是 3）；跳过同样计次数
     D7 取样走专用流：同一群系池在两个 seed 下取到的 3 张不同（并且同 seed 重放逐元素相同）
     D8 非法输入不许有副作用：不存在的卡 id / 没有该方 offer / 卡不在 options 里 → {ok:false} 且牌库不变
     D9 评审闸对账：MatchOps 清单登记了 grantCard，且 Match 真的实现了它（登记与实面对不上=绕过权威层）

   构造口径照 tools/play_probe.cjs（64×36×64 关卡图，**lodes:true 才长矿脉**，world.js 的 opts.lodes）；
   断言与打印风格照 tools/hand_check.cjs。不依赖 GL 与页面，在 node 里跑。

   用法：node tools/draft_check.cjs [seed]   默认 490706；退出码非 0 就是不达标
*/
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards/pick-pools.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const STEP = 1 / 20;

let n = 0, bad = 0;
function ck(name, ok, detail) {
  n++; if (ok) console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
  else { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
}
function noop() {}
const FX = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop,
             fire: noop, float: noop, ambient: noop, chemLog: noop, quake: noop };
/* 关卡图：矿脉必须显式打开（world.js 的 opts.lodes，默认 false——量具自己造的世界不打开就没有矿） */
function mkWorld(seed) {
  const w = new G.World({ size: [64, 36, 64], seed: seed >>> 0, sea: 12, lodes: true });
  w.generate(); return w;
}
function mkMatch(over) {
  const o = Object.assign({ seed: SEED }, over || {});
  const seed = o.seed >>> 0;
  const w = mkWorld(seed);
  return new G.Match(Object.assign({ world: w, seed: seed, mode: 'train', players: 2, fx: FX }, o));
}
function run(m, secs) { const t = Math.round(secs / STEP); for (let i = 0; i < t; i++) m.step(STEP, [{}, {}]); return t; }
/* 把人放到某条矿的台面上（照 econ_check 口径：脚底落在台面顶块之上，占矿窗口 [L.y, L.y+3.5] 内）。
   台面中央那格的晶体先清掉——站自己占的格不该被自己的资源顶穿。 */
function standOnLode(m, side, li) {
  const L = m.lodeSys && m.lodeSys.lodes[li], p = m.players[side];
  if (!L) return null;
  m.world.set(L.x, L.y + 1, L.z, 0);
  p.pos.set(L.x + 0.5, L.y + 1 + p.h / 2 + 0.001, L.z + 0.5);
  p.vel.set(0, 0, 0); p.onGround = true; p.airHigh = null;
  return p;
}
/* 把人从台上撤走（回出生点）：D6 要一条一条矿地触发，站着不走会被上一台的归属影响判断 */
function standOff(m, side) {
  const p = m.players[side], s = m.spawnPts[side];
  p.pos.set(s.x, s.y + p.h / 2 + 0.02, s.z); p.vel.set(0, 0, 0); p.onGround = false;
  return p;
}
function sig(p) { return JSON.stringify([p.hand, p.deck, p.discard]); }
function times(arr, id) { return arr.filter(function (x) { return x === id; }).length; }

/* ---------- D1 卡池表本身 ---------- */
{
  const P = G.PICK_POOLS || {};
  const sizes = ['forest', 'desert', 'tundra', 'neutral'].map(function (k) { return k + '=' + ((P[k] || []).length); }).join(' ');
  ck('D1 三群系池各 8 张、通用池 8 张', ['forest', 'desert', 'tundra', 'neutral'].every(function (k) { return (P[k] || []).length === 8; }), sizes);
  const unknown = []; let dupPool = [];
  Object.keys(P).forEach(function (k) {
    const a = P[k] || [];
    a.forEach(function (id) { if (!G.CARDS_BY_ID[id]) unknown.push(k + '/' + id); });
    if (new Set(a).size !== a.length) dupPool.push(k);
  });
  ck('D1 池里每个 id 都在 G.CARDS_BY_ID（不发不存在的卡）', unknown.length === 0, unknown.join(',') || '全部存在');
  ck('D1 池内无重复卡（重复等于同一张卡被摆两次，三选一就废了）', dupPool.length === 0, dupPool.join(',') || '无重复');
  ck('D1 G.PICK_BIOMES 就是三群系', Array.isArray(G.PICK_BIOMES) && G.PICK_BIOMES.join(',') === 'forest,desert,tundra',
     JSON.stringify(G.PICK_BIOMES));
  const cnKeys = Object.keys(G.PICK_POOL_CN || {}).sort().join(',');
  ck('D1 显示名表覆盖三群系（T5 的文案层从这里取名字）', cnKeys === 'desert,forest,tundra', cnKeys + ' ' + JSON.stringify(G.PICK_POOL_CN));
  /* 与定案文档的表对账：池子改而文档没改（或反过来），必须当场见红，而不是等下一个会话重猜 */
  const md = require('fs').readFileSync(path.join(ROOT, 'docs/CARD_ECONOMY.md'), 'utf8');
  const ROW = { forest: '林海', desert: '黄沙', tundra: '雪原', neutral: '通用' };
  const drift = [];
  Object.keys(ROW).forEach(function (k) {
    const re = new RegExp('^\\|\\s*' + ROW[k] + '[^|]*\\|[^|]*\\|([^|]*)\\|\\s*$', 'm');
    const m0 = re.exec(md);
    if (!m0) { drift.push(k + ':\u6587\u6863\u91cc\u627e\u4e0d\u5230\u884c'); return; }
    const want = m0[1].trim().split(',').map(function (s) { return s.trim(); });
    const got = P[k] || [];
    if (want.join(',') !== got.join(',')) drift.push(k + ' 文档[' + want.join(',') + '] vs 代码[' + got.join(',') + ']');
  });
  ck('D1 与 CARD_ECONOMY §2.1 的表逐元素一致（含顺序）', drift.length === 0, drift.join(' ; ') || '一致');
}

/* ---------- D2 名义群系 ---------- */
{
  const m = mkMatch(), lb = m.lodeBiomes || [];
  const nLode = (m.world.lodes && m.world.lodes.list.length) || 0;
  ck('D2 每条矿都分到群系（长度与矿数一致）', nLode > 0 && lb.length === nLode, '矿 ' + nLode + ' 条 / ' + JSON.stringify(lb));
  ck('D2 同一张图三条矿群系互不相同（不修就是单路线）', new Set(lb).size === lb.length, JSON.stringify(lb));
  const b1 = mkMatch(), b2 = mkMatch();
  ck('D2 同 seed 两次构造排列相同（seed 派生、不吃运行期随机）',
     JSON.stringify(b1.lodeBiomes) === JSON.stringify(b2.lodeBiomes),
     JSON.stringify(b1.lodeBiomes) + ' vs ' + JSON.stringify(b2.lodeBiomes));
  const seen = {}, probes = [SEED, SEED + 1, SEED + 7, SEED + 101, SEED + 2026, 88092, 31337, 49070];
  probes.forEach(function (s) { const x = mkMatch({ seed: s }); if ((x.lodeBiomes || []).length === 3) seen[x.lodeBiomes.join(',')] = 1; });
  const kinds = Object.keys(seen).length;
  ck('D2 换 seed 至少出现两种不同排列（6 种排列里真取到多个）', kinds >= 2, kinds + ' 种：' + Object.keys(seen).join(' | '));
}

/* ---------- D3 / D4 触发与"一次只弹一个" ---------- */
{
  const m = mkMatch();
  const li = 0, L = m.lodeSys.lodes[li];
  ck('D3 这张图有矿（量具前提：lodes:true）', !!L, L ? '' : 'world.lodes.list 为空');
  const p = standOnLode(m, 0, li);
  ck('D3 站上台前队列是空的', m.pendingDraft() === null, JSON.stringify(m.drafts));
  run(m, 0.1);
  const off = m.pendingDraft();
  ck('D3 站上矿台 0.1s 就排进队列（source=lode、是这一方的）',
     !!off && off.source === 'lode' && off.side === 0, JSON.stringify(off));
  const optOk = !!off && off.options.length === 3 && new Set(off.options).size === 3;
  const pool = (G.PICK_POOLS || {})[(m.lodeBiomes || [])[li]] || [];
  const fromPool = !!off && off.options.every(function (id) { return pool.indexOf(id) >= 0; });
  ck('D3 候选恰好 3 张且互不相同', optOk, off ? off.options.join(',') : 'null');
  ck('D3 候选全部来自该矿的名义群系池（群系绑错=成长路线错）', fromPool,
     'biome=' + (off && off.biome) + ' 池=' + m.lodeBiomes[li] + ' 候选=' + (off ? off.options.join(',') : 'null'));
  run(m, 1);
  const sameSide = m.drafts.filter(function (d) { return d.side === 0; }).length;
  ck('D4 继续站着 1s 不叠第二个同方 offer（同方队列 ≤1）', sameSide === 1 && m.drafts.length === 1,
     '同方 ' + sameSide + ' 条 / 队列 ' + m.drafts.length + ' 条');
}

/* ---------- D5 选中入牌库 ---------- */
{
  const m = mkMatch();
  standOnLode(m, 0, 0); run(m, 0.1);
  const p = m.players[0], off = m.pendingDraft();
  const id = off.options[0];
  const deck0 = p.deck.length, sigBefore = sig(p), used0 = m.draftUsed.lode[0];
  const r = m.takeDraft(0, id);
  ck('D5 takeDraft 返回 ok 且带 cardId', r.ok === true && r.cardId === id, JSON.stringify(r));
  ck('D5 牌库 +2 张且该 id 恰好两张（选中卡 ×2 入本局牌库）',
     p.deck.length === deck0 + 2 && times(p.deck, id) === times(JSON.parse(sigBefore)[1], id) + 2,
     deck0 + '→' + p.deck.length + ' 张数 / 该卡 ' + times(p.deck, id) + ' 张');
  ck('D5 手牌一字不动（发牌不许顺手塞手里）', JSON.stringify(p.hand) === JSON.stringify(JSON.parse(sigBefore)[0]),
     p.hand.join(','));
  ck('D5 队列清空', m.pendingDraft() === null && m.drafts.length === 0, JSON.stringify(m.drafts));
  ck('D5 占矿次数 +1（用的是这次机会，不是白拿）', m.draftUsed.lode[0] === used0 + 1, used0 + '→' + m.draftUsed.lode[0]);
}

/* ---------- D6 整局额度与跳过 ---------- */
{
  const m = mkMatch();
  ck('D6 不传 opts 时额度默认 3/3（play_probe 那条注意）', m.draftCapLode === 3 && m.draftCapBeast === 3,
     'lode=' + m.draftCapLode + ' beast=' + m.draftCapBeast);
  const got = [];
  for (let li = 0; li < m.lodeSys.lodes.length; li++) {
    standOnLode(m, 0, li); run(m, 0.1);
    const off = m.pendingDraft();
    got.push(off ? off.source + ':' + off.biome : 'null');
    if (off) { if (li % 2 === 0) m.takeDraft(0, off.options[0]); else m.skipDraft(0); }
    standOff(m, 0);
  }
  ck('D6 三条矿各触发一次（占矿→排队的路没断）', got.length === 3 && got.every(function (x) { return x.indexOf('lode:') === 0; }),
     got.join(' '));
  ck('D6 三次用完后 draftUsed.lode 记到 3（take 与 skip 都计次）', m.draftUsed.lode[0] === 3, JSON.stringify(m.draftUsed));
  ck('D6 第 4 次 offer 被拒（额度用尽返回 null）', m.offerDraft(0, 'lode', 'forest') === null,
     'used=' + m.draftUsed.lode[0] + '/' + m.draftCapLode);
  const deckP1 = m.players[0].deck.length;
  ck('D6 被拒之后牌库没被动过（拒就是拒，不许先扣手牌）', m.players[0].deck.length === deckP1, deckP1 + ' 张');
  ck('D6 对手额度独立（一侧用尽不许拖累另一侧）', m.offerDraft(1, 'lode', 'desert') !== null && m.draftUsed.lode[1] === 0,
     JSON.stringify(m.draftUsed));
}

/* ---------- D7 专用随机流确实被 seed 化 ---------- */
{
  function draw(seed) { const m = mkMatch({ seed: seed }); const o = m.offerDraft(0, 'lode', 'forest'); return o ? o.options.join(',') : 'null'; }
  const a1 = draw(SEED), a2 = draw(SEED), b1 = draw(SEED + 31337);
  ck('D7 同 seed 同操作 → 取到的 3 张逐元素相同（可复现）', a1 === a2, a1 + ' vs ' + a2);
  ck('D7 换 seed → 同一群系池取到的 3 张不同（专用流真的被 seed 化）', a1 !== b1, SEED + '→[' + a1 + '] ' + (SEED + 31337) + '→[' + b1 + ']');
}

/* ---------- D8 非法输入不许有副作用 ---------- */
{
  const m = mkMatch(); standOnLode(m, 0, 0); run(m, 0.1);
  const p = m.players[0], q = m.players[1];
  const off = m.pendingDraft();
  const sigP = sig(p), sigQ = sig(q), usedP = JSON.stringify(m.draftUsed);
  const r1 = m.grantCard(p, 'no-such-card-xyz', 2);
  ck('D8 不存在的卡 id：grantCard 返回 ok:false 且牌库不变',
     r1.ok === false && sig(p) === sigP, JSON.stringify(r1));
  const r2 = m.takeDraft(0, 'no-such-card-xyz');
  ck('D8 卡不在 options 里：takeDraft ok:false，offer 留着、次数不烧',
     r2.ok === false && sig(p) === sigP && JSON.stringify(m.draftUsed) === usedP && m.pendingDraft() === off,
     JSON.stringify(r2));
  const r3 = m.takeDraft(1, off.options[0]);
  ck('D8 这一方没有待处理 offer：返回 ok:false 且两侧牌库都不动',
     r3.ok === false && sig(q) === sigQ && sig(p) === sigP, JSON.stringify(r3));
  const r4 = m.skipDraft(1);
  ck('D8 没有 offer 时 skipDraft 也不算成功（不许假成功）',
     r4.ok === false && JSON.stringify(m.draftUsed) === usedP, JSON.stringify(r4));
  const r5 = m.takeDraft(0, off.options[0]);
  ck('D8 同一方重复选同一张：第二次没有 offer，牌库不再 +2',
     r5.ok === true && m.takeDraft(0, off.options[1]).ok === false && p.deck.length === JSON.parse(sigP)[1].length + 2,
     '牌库 ' + p.deck.length + ' 张');
}

/* ---------- D9 评审闸对账 ---------- */
{
  const m = mkMatch();
  ck('D9 MatchOps 清单登记了 grantCard（GAMEPLAY §7.0 条 3 的评审闸）', G.MatchOps.has('grantCard') === true,
     G.MatchOps.methods.length + ' 个方法');
  const chk = G.MatchOps.check(m);
  ck('D9 登记与实面对得上：Match 实现了清单上的每一个方法', chk.ok === true, chk.missing.join(',') || '全在');
}

console.log('\n共 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
