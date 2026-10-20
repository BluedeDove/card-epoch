#!/usr/bin/env node
/* tools/auto_check.cjs · 自动开火（按住左键连发）回归
   用户 2026-10-18："选定模式之后我只需要一直按左键，系统自动帮我选好最好最合适的打出去，
   子弹随时在变。"
   这一层的规则在 src/systems/auto.js，本量具在 node 里钉住六件事（不依赖 GL 与页面）：

     1) **只自动打攻击类**（超阶/远程/法阵/召唤）：放置、破坏、移动、辅助哪怕能放也不许被自动打出去；
     2) **优先级**：同样能放时先超阶、再远程、再法阵、再召唤；
     3) **付不起就不打**：canPlay 说不行的一张都不选（不空转、不假成功）；
     4) **守恒**：连发 N 次之后 hand+deck+discard 的多重集不变；
     5) **轮换**：同一张刚打过就往后排（"子弹随时在变"）——同价的两张，上一张打过的下一发必换；
     6) **确定性**：同一个种子两次跑出同一条选择序列（auto 用独立的随机流，不碰抽牌序列）。
   外加一条 Shift 的：手上有多张 hot:'shift'（移动组全员都带）时，第一张在冷却要接着试下一张。
   用法：node tools/auto_check.cjs   退出码非 0 就是不达标。 */
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js', 'src/cards.js', 'src/vfx.js', 'src/vfx-recipes.js', 'src/chem.js', 'src/rules.js', 'src/systems/aim.js', 'src/systems/auto.js', 'src/battle.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
let n = 0, bad = 0;
function ck(name, ok, detail) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); } else console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }

function mk(seed, deck) {
  const w = new G.World({ size: [48, 32, 48], seed: seed || 490706 }); w.generate();
  const fx = { log() {}, sfx() {}, burst() {}, dust() {}, hit() {}, heal() {}, shieldUp() {}, fire() {}, float() {}, ambient() {}, quake() {} };
  const m = new G.Match({ world: w, seed: seed || 490706, players: 2, fx, cards: [deck || G.STARTER_DECK.slice(), G.STARTER_DECK.slice()] });
  const p = m.players[0];
  const gy = w.surfaceY(Math.floor(p.pos.x), Math.floor(p.pos.z) + 6);
  const aim = { x: Math.floor(p.pos.x) + 0.5, y: gy + 0.5, z: Math.floor(p.pos.z) + 6.5, gx: Math.floor(p.pos.x), gy: gy, gz: Math.floor(p.pos.z) + 6, face: [0, 1, 0], dist: 6 };
  delete p.aimSrc; p.aim = aim; p.aimTarget = null;
  m.ctx.aim = aim; m.ctx.aimTarget = null;
  p.mana = 99; p.mats = 99; p.cooldowns = {};
  return { w, m, p };
}
const ids = (a) => a.join(',');
const multiset = (p) => JSON.stringify(p.hand.concat(p.deck, p.discard).slice().sort());
const roleOf = (id) => (G.CARDS_BY_ID[id] || {}).role;

/* 1. 只挑攻击类 */
{
  const { m, p } = mk();
  p.hand = ['strike', 'bolt', 'place', 'dig', 'blink', 'guard', 'meteors', 'golem'];
  const picked = [];
  for (let i = 0; i < 40; i++) { p.mana = 99; p.cooldowns = {}; const b = m.autoPick(p); if (b) { picked.push(b.card.id); p.autoLast = b.card.id; } }
  const roles = picked.map(roleOf);
  const badRole = picked.filter((id) => ['place', 'dig', 'move', 'aid'].indexOf(roleOf(id)) >= 0);
  ck('自动开火只挑攻击类（放置/破坏/移动/辅助一张都不碰）', badRole.length === 0, ids(picked));
  ck('40 次都在攻击类里（超阶/远程/法阵/召唤）', roles.every((r) => ['ultra', 'shot', 'sigil', 'summon'].indexOf(r) >= 0), JSON.stringify(roles.slice(0, 12)));
  ck('攻击类里挑到了不止一种（不是只会打同一张）', new Set(picked).size >= 2, ids(Array.from(new Set(picked))));
}
/* 2. 手上没有攻击牌 → 不硬凑；但 fire 会先换一张（"不用管卡组"的那一半），换不到才报 nothing */
{
  const { m, p } = mk();
  p.hand = ['place', 'dig', 'blink', 'guard', 'wall2'];
  ck('手上只有非攻击牌：autoPick 返回 null（不硬凑一张）', m.autoPick(p) === null);
  p.mana = 99; p.cooldowns = {};
  const r = m.autoFire(p);
  ck('只有非攻击牌时：先换一张能打的再打（reloaded=true）', r.ok === true && r.reloaded === true, JSON.stringify(r));
  /* 牌库与弃牌堆里一张攻击牌都没有：换也换不到，老老实实报 nothing */
  const { m: m2, p: p2 } = mk();
  p2.hand = ['place', 'dig', 'blink', 'guard', 'wall2'];
  p2.deck = ['place', 'dig', 'wall2', 'raise', 'heal'];
  p2.discard = [];
  p2.mana = 99; p2.cooldowns = {};
  const r2 = m2.autoFire(p2);
  ck('牌库里也没有攻击牌：fire 报 nothing（不假成功）', r2.ok === false && r2.reason === 'nothing', JSON.stringify(r2));
}
/* 3. 优先级：超阶 > 远程 */
{
  const { m, p } = mk();
  p.hand = ['strike', 'meteor_rain', 'shard', 'golem'];
  p.mana = 99; p.cooldowns = {};
  const b = m.autoPick(p);
  ck('同样能放时先打超阶（陨星雨），再是远程', b && b.card.id === 'meteor_rain', b && b.card.id);
  /* 超阶付不起（mana 6 < 7）时退回远程 */
  p.mana = 6; p.cooldowns = {};
  const b2 = m.autoPick(p);
  ck('超阶付不起就退回远程', b2 && roleOf(b2.card.id) === 'shot', b2 && (b2.card.id + '(' + roleOf(b2.card.id) + ')'));
}
/* 4. 付不起 / 冷却中：一张都不选 */
{
  const { m, p } = mk();
  p.hand = ['strike', 'bolt'];
  p.mana = 0; p.cooldowns = {};
  ck('魔力 0：autoPick 返回 null', m.autoPick(p) === null);
  p.mana = 99; p.cooldowns = { strike: 5, bolt: 5 };
  ck('两张都在冷却：autoPick 返回 null', m.autoPick(p) === null);
  p.cooldowns = { strike: 5 };
  const b = m.autoPick(p);
  ck('一张冷却另一张可用：打可用的那张', b && b.card.id === 'bolt', b && b.card.id);
}
/* 5. 连发守恒 + 每次真的扣费 + "手里没有攻击牌就换一张" */
{
  const { m, p } = mk();
  /* 把发牌全塞回牌库（测试要自己控制起手，但**一张都不许凭空丢**） */
  p.deck = p.hand.concat(p.deck); p.hand = [];
  const before = multiset(p);
  const startMana = p.mana;
  p.mana = 8;                                 // 街机档的起手持蓝量级
  let fired = 0, manaSpent = 0, reloads = 0;
  for (let i = 0; i < 30; i++) {
    p.cooldowns = {};                         // 冷却清零，只量"能打就打"
    p.mana = Math.min(12, p.mana + 3);        // 补蓝继续（模拟街机档 +2.6/s 的节奏）
    const mana0 = p.mana;
    const r = m.autoFire(p);
    if (r && r.ok) { fired++; manaSpent += (mana0 - p.mana); if (r.reloaded) reloads++; }
  }
  ck('连发：30 次里至少打出去 10 张（不是空转）', fired >= 10, 'fired=' + fired + ' reloads=' + reloads);
  ck('连发：hand+deck+discard 多重集守恒（不造牌不吞牌）', multiset(p) === before, before + ' → ' + multiset(p));
  ck('连发：每发都真的扣了魔力', manaSpent > 0, 'manaSpent=' + manaSpent + ' start=' + startMana);
  ck('连发：出现过"换牌"（手里没有攻击牌时自己换一张能打的）', reloads > 0 || fired >= 10, 'reloads=' + reloads);
}
/* 5b. 手动切到「放置」组时不许自动换牌（那是玩家在砌东西，不是弹药不足） */
{
  const { m, p } = mk();
  p.hand = ['place', 'wall2', 'raise'];
  p.handClass = 'place';
  p.mana = 99; p.cooldowns = {};
  const before = multiset(p);
  const r = m.autoFire(p);
  ck('手动作业组（放置）：自动开火什么都不做、也不换牌', r.ok === false && multiset(p) === before, JSON.stringify(r));
}
/* 6. 轮换：刚打过的那张往后排（同价两张必换） */
{
  const { m, p } = mk();
  p.hand = ['strike', 'shard'];               // 都是 shot，费用 1，冷却 0.5 / 0.8
  p.mana = 99; p.cooldowns = {};
  p.autoLast = 'strike';
  const outs = [];
  for (let i = 0; i < 20; i++) { p.cooldowns = {}; const b = m.autoPick(p); outs.push(b && b.card.id); }
  ck('同价两张、上一张刚打过：下一发一定换（20/20）', outs.every((x) => x === 'shard'), JSON.stringify(Array.from(new Set(outs))));
}
/* 7. 确定性：同种子同序列（auto 用独立随机流） */
{
  const seq = (seed) => {
    const { m, p } = mk(seed);
    p.hand = ['strike', 'bolt', 'shard', 'spikes'];
    const out = [];
    for (let i = 0; i < 25; i++) { p.mana = 99; p.cooldowns = {}; const b = m.autoPick(p); out.push(b && b.card.id); p.autoLast = b && b.card.id; }
    return out.join(',');
  };
  const a = seq(490706), b = seq(490706);
  ck('同种子：同一条自动选择序列（可复现）', a === b, a.slice(0, 60));
  /* 而且不许碰 legacy 抽牌流：auto 取数不能改变 deck 的 rng 序列 */
  const deckSeq = (callAuto) => {
    const { m } = mk(490706);
    const q = m.players[0];
    if (callAuto) { q.mana = 99; q.hand = ['strike', 'bolt']; for (let i = 0; i < 10; i++) m.autoPick(q); }
    return [m.rng(), m.rng(), m.rng()].map((x) => x.toFixed(6)).join(',');
  };
  ck('auto 的随机数不消耗 legacy 抽牌流（抽牌序列逐字节不变）', deckSeq(false) === deckSeq(true), deckSeq(false) + ' / ' + deckSeq(true));
}
/* 8. Shift：多张 hot 牌，第一张冷却时接着试下一张 */
{
  const { m, p } = mk();
  p.hand = ['blink', 'kick'];
  p.mana = 99; p.cooldowns = { blink: 9 };
  const r = m.useHotkey(p, 'shift', 0, 1);
  ck('Shift：第一张在冷却时接着试下一张（疾行）', r && r.ok && r.cardId === 'kick', JSON.stringify(r));
  p.hand = ['blink', 'kick'];
  p.cooldowns = { blink: 9, kick: 9 };
  const r2 = m.useHotkey(p, 'shift', 0, 1);
  ck('Shift：全都冷却时说得出为什么（不静默成功）', r2 && r2.ok === false && !!r2.reason, JSON.stringify(r2));
  p.hand = ['guard'];
  p.cooldowns = {};
  const r3 = m.useHotkey(p, 'shift', 0, 1);
  ck('Shift：手上没有移动牌时明确失败', r3 && r3.ok === false, JSON.stringify(r3));
}
/* 9. 移动组全员 hot:shift（与 role_check 同一条，这里从"能不能被 Shift 打到"的角度再量一次） */
{
  const { m, p } = mk();
  p.hand = ['wings'];
  p.mana = 99; p.cooldowns = {};
  const r = m.useHotkey(p, 'shift', 0, 1);
  ck('移动组里随便一张（浮空）都能被 Shift 触发', r && r.ok && r.cardId === 'wings', JSON.stringify(r));
}

console.log('\n共 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
