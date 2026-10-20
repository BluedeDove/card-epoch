#!/usr/bin/env node
/* tools/hit_check.cjs · 攻击卡判定范围回归（不参与游戏运行）

   要还的债（用户 2026-10-16）："扔出去是一个小球，只有小球那一块体积砸到敌人才掉血，
   非常难操作，很难对敌人造成有效伤害，并且扣的血又那么少。"

   这个脚本把那条体验变成可跑的判据，四件事一起做：
     ① 打偏要能中：横向偏 0.9 / 1.3 格（约一个人宽的一半到一臂）必须照样掉血；
     ② 明显打偏不能自动瞄：偏 2.6 格必须一点伤害都不掉，否则就是自瞄，玩家会察觉"判定糊"；
     ③ 状态要跟着弹道走：偏 2.6 格时不许有 burning / slow（旧版出牌瞬间就往准星锁定的目标脸上糊状态）；
     ④ 单发伤害落在卡面值的 ±40% 区间内：既不回到"扣得少"，也不许把某张卡顺手改成秒人。
   另外钉住两条结构约束：范围卡不吃衰减（否则等于偷偷砍 AoE），抛射物高速不穿人。

       node tools/hit_check.cjs [seed]
   全过退出码 0；任何一条红，退出码 1 并打出用例名。
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0, group = '';
function groupOf(n) { group = n; console.log('\n\u2500\u2500 ' + n); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2190 ' + extra : '')); }
}
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js'].forEach(f => require(path.join(ROOT, f)));
const G = global.window.GW, B = G.BLOCK;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const STEP = 1 / 20;

function makeField(seed, matchOpts) {
  const w = new G.World({ size: [48, 26, 48], seed: seed >>> 0, sea: 4 });
  for (let z = 0; z < 48; z++) for (let x = 0; x < 48; x++) for (let y = 0; y <= 2; y++) w.blocks[w.idx(x, y, z)] = y === 0 ? B.BEDROCK : B.STONE;
  const noop = function () {};
  const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop,
               shieldUp: noop, fire: noop, float: noop, ambient: noop, chemLog: noop };
  const m = new G.Match(Object.assign({ world: w, seed: seed >>> 0, mode: 'train', players: 2, fx: fx }, matchOpts || {}));
  return { w, m };
}
/* 打一枪：把卡塞进 P1 手牌 → 摆好敌人与落点 → 走权威 tick 直到抛射物消失，返回掉血与状态。
   全程走 Match.playCard 这条真人通道（不出别的分支），所以这里绿了就等于玩家真的能打中。 */
function shoot(cardId, opt) {
  const { w, m } = makeField(SEED + (opt.seedShift || 0));
  const p = m.players[0], t = m.players[1];
  const tx = 24.5, tz = 24.5, ty = 3 + t.h / 2 + 0.02;
  t.pos.set(tx, ty, tz); t.vel.set(0, 0, 0);
  /* 射手放在敌人正南、把"打偏"打在**垂直于射击方向**的东西向上。
     若是从侧面开枪再往敌人背后偏移准星，弹道本来就会从敌人身边掠过——
     那种摆法测出来"偏 2.6 格也掉血"是几何造成的，不是判定太松（第一版就踩了这坑）。 */
  p.pos.set(tx, 3 + p.h / 2 + 0.02, tz - (opt.dist || 8)); p.vel.set(0, 0, 0);
  t.hp = t.maxHp = 100; t.shield = 0; t.invuln = 0; t.st = {};
  p.mana = 10; p.cooldowns = {}; p.hand = [cardId]; p.buffNext = false;
  const aimY = opt.ground ? 2.2 : (ty + 0.1);          // ground = 瞄在敌人脚下的地板格里
  p.aim = { x: tx + (opt.offX || 0), y: aimY, z: tz + (opt.offZ || 0),
            gx: Math.floor(tx + (opt.offX || 0)), gy: Math.floor(aimY), gz: Math.floor(tz + (opt.offZ || 0)),
            face: [0, 1, 0], dist: opt.dist || 8 };
  const hp0 = t.hp;
  if (!m.playCard(p, 0)) return { played: false, dealt: 0, st: {} };
  for (let i = 0; i < 90 && m.projectiles.length; i++) m.step(STEP, [{}, {}]);
  return { played: true, dealt: hp0 - t.hp, st: t.st, pr: m.projectiles.length };
}
const CARDS = [
  { id: 'strike', name: '打击', kind: 'physical' },
  { id: 'bolt', name: '焰矢', kind: 'fire', status: 'burn' },
  { id: 'shard', name: '霜片', kind: 'ice', status: 'slow' },
  { id: 'void_lance', name: '虚 lance', kind: 'void' },
  { id: 'siphon', name: '虹吸', kind: 'void' },
  { id: 'entangle', name: '缠根', kind: 'nature', status: 'root' }
];

groupOf('1. 打偏也要能中（这是用户报的那件事）');
CARDS.forEach(function (c) {
  const card = G.CARDS_BY_ID[c.id];
  const ef = card.effects.filter(e => e.op === 'damage')[0];
  const amount = ef.amount;
  const hit = shoot(c.id, { offX: 0, offZ: 0 });
  ok(c.name + ' 正中：' + hit.dealt.toFixed(1) + ' 伤害（卡面 ' + amount + '）', hit.played && hit.dealt >= amount * 0.8);
  const near = shoot(c.id, { offX: 0.9, offZ: 0.2 });
  ok(c.name + ' 偏 0.9 格（约半个身位）仍然掉血：' + near.dealt.toFixed(1), near.dealt > 0);
  const arm = shoot(c.id, { offX: -0.4, offZ: 1.3 });
  ok(c.name + ' 偏 1.3 格（约一臂）仍然掉血：' + arm.dealt.toFixed(1), arm.dealt > 0);
  const out = shoot(c.id, { offX: 2.6, offZ: 0.6 });
  ok(c.name + ' 偏 2.6 格不许掉血（不能做成自瞄）：' + out.dealt.toFixed(1), out.dealt === 0);
  if (c.status) {
    ok(c.name + ' 偏 2.6 格时状态也不许糊上去（旧 bug：出牌即上状态）', !out.st[c.status], JSON.stringify(out.st));
    ok(c.name + ' 打中时 ' + c.status + ' 状态确实挂上了', !!hit.st[c.status], JSON.stringify(hit.st));
  }
  ok(c.name + ' 单发伤害落在 ±40% 区间（防顺手改超模）：' + hit.dealt.toFixed(1),
    hit.dealt <= amount * 1.4 + 0.001);
  ok(c.name + ' 的近失圈是数据给的（cards.js 有 fuse / radius，代码不写死）',
    typeof ef.fuse === 'number' && ef.radius > 0);
});

groupOf('2. 落点判定：砸地、砸脚下、远距离');
{
  const ground = shoot('bolt', { ground: true });
  ok('焰矢砸在敌人脚下的地面也掉血（爆炸看落点，不看小球体积）：' + ground.dealt.toFixed(1), ground.dealt > 0);
  const far = shoot('void_lance', { dist: 22, offX: 0.5 });
  ok('虚枪在 22 格外、偏 0.5 格仍命中（高速不穿人）：' + far.dealt.toFixed(1), far.dealt > 0);
  const graze = shoot('shard', { offX: 1.2, offZ: 0.4 });
  ok('霜片斜向偏 ~1.3 格仍能蹭到（判定用扫掠线段，不是末点一个球）：' + graze.dealt.toFixed(1), graze.dealt > 0);
}

groupOf('3. 范围卡不许被衰减顺手砍掉');
['bloom', 'frost_nova', 'spikes', 'fall'].forEach(function (id) {
  const card = G.CARDS_BY_ID[id];
  const ef = card.effects.filter(e => e.op === 'damage')[0];
  const { w, m } = makeField(SEED + 7);
  const p = m.players[0], t = m.players[1];
  t.pos.set(24.5, 3 + t.h / 2 + 0.02, 24.5); p.pos.set(20.5, 3 + p.h / 2 + 0.02, 24.5);
  t.hp = t.maxHp = 100; t.shield = 0; t.invuln = 0; t.st = {};
  p.mana = 10; p.cooldowns = {}; p.hand = [id]; p.buffNext = false;
  /* 范围卡也要摆 p.aim：playCard 会拿 p.aim 覆盖 ctx.aim（"永远有落点"那条），
     直接写 m.ctx.aim 会被它冲掉，测出来就是"一张卡没打出伤害"的假红。 */
  /* 塌落是地形卡：canPlay 要求"瞄准处有可挖的格子"，瞄在空气上会被拒（那是规则不是 bug），
     所以这张卡的落点要摆进地板里。 */
  const aimY = id === 'fall' ? 2.4 : 3.9, aimGY = id === 'fall' ? 2 : 3;
  p.aim = { x: 24.5, y: aimY, z: 24.5, gx: 24, gy: aimGY, gz: 24, face: [0, 1, 0], dist: 4 };
  const okPlay = m.playCard(p, 0);
  if (!okPlay) console.log('      （' + card.name + ' 出牌被拒绝：检查 canPlay）');
  ok(card.name + '（范围卡）圈内满伤：' + (100 - t.hp).toFixed(1) + ' vs 卡面 ' + ef.amount,
    (100 - t.hp) >= ef.amount * 0.99);
});

groupOf('4. 通道一致性：AI 与真人共用同一条出牌路径');
{
  const battle = fs.readFileSync(path.join(ROOT, 'src/battle.js'), 'utf8');
  const proj = fs.readFileSync(path.join(ROOT, 'src/systems/projectile.js'), 'utf8');
  const combat = battle + '\n' + proj;
  const net = fs.readFileSync(path.join(ROOT, 'src/net.js'), 'utf8');
  ok('battle.js 里出牌只有 playCard 一个入口（G.Rules.play 只出现一次）',
    (battle.match(/G\.Rules\.play\(/g) || []).length === 1);
  ok('net.js 的 AI 也只写指令、不碰结算（不出现 Rules.play / Rules.damage）',
    !/Rules\.play|Rules\.damage/.test(net));
  ok('抛射物命中判的是扫掠线段（hitTestSegment 存在且被 stepProjectiles 用）',
    /hitTestSegment/.test(combat) && /(?:this|m)\.hitTestSegment\(pr, ox, oy, oz, nx, ny, nz\)/.test(combat));
  ok('命中半径来自抛射物自己的近失圈，不再是写死的 0.8',
    /pr\.fuse/.test(combat) && !/Math\.max\(0\.8, e\.w \* 1\.25\)/.test(combat));
}

groupOf('5. A-1 命中修复：射程收档 + 弹道提前量（docs/TASK_A1.md §4，只许新增不许放宽）');
/* 射程收档钉在数据上：伤害 ray 卡进 18–22 带，void_lance 保 24（定案 §3.2 远程压制特例）。 */
{
  const RANGES = { strike: 18, bolt: 20, shard: 20, void_lance: 24 };
  Object.keys(RANGES).forEach(function (id) {
    ok(id + ' maxDist = ' + RANGES[id] + '（射程收档进 18–22 带，void_lance 特例保 24）',
      G.CARDS_BY_ID[id].targeting.maxDist === RANGES[id], '实测 ' + G.CARDS_BY_ID[id].targeting.maxDist);
  });
}
/* 打靶场：靶子由真实输入通道驱动横移（strafe 指令 → applyInput → SPEED=5.6 满速），
   开火前用 Match.updateAim 做瞄准解析（与真机同一条 AimResolver 通路，aim.ent 就是这么来的），
   开火后靶子继续横移直到抛射物消失。每一枪都是完整的一局小世界，seed 固定 → 逐枪可复现。 */
function rangeTrial(opt) {
  const f = makeField(SEED + 101 + opt.i, { leadEnabled: opt.lead });
  const m = f.m, p = m.players[0], t = m.players[1];
  t.pos.set(24.5, 3 + t.h / 2 + 0.02, 24.5); t.vel.set(0, 0, 0);
  p.pos.set(24.5, 3 + p.h / 2 + 0.02, 24.5 - opt.dist); p.vel.set(0, 0, 0);
  t.yaw = 0; p.yaw = 0;
  t.hp = t.maxHp = 100; t.shield = 0; t.invuln = 0; t.st = {};
  p.mana = 10; p.cooldowns = {}; p.hand = ['strike']; p.buffNext = false;
  const strafe = opt.strafe ? (opt.i % 2 ? { left: 1 } : { right: 1 }) : {};
  for (let k = 0; k < 12 && opt.strafe; k++) m.step(STEP, [{}, strafe]);   // 先加到满速再开火
  const spd = Math.hypot(t.vel.x, t.vel.z);
  const eye = p.eye();
  const c = { x: t.pos.x, y: t.pos.y + t.h * 0.5, z: t.pos.z };
  const d = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
  const L = Math.hypot(d.x, d.y, d.z) || 1;
  m.updateAim(p, eye, { x: d.x / L, y: d.y / L, z: d.z / L });
  if (!p.aim || !p.aim.ent || p.aim.ent !== t) return { setup: false, spd: spd };
  const hp0 = t.hp;
  if (!m.playCard(p, 0)) return { setup: false, spd: spd };
  for (let k = 0; k < 90 && m.projectiles.length; k++) m.step(STEP, [{}, strafe]);
  return { setup: true, spd: spd, dealt: hp0 - t.hp };
}
function rangeHitRate(opt) {
  let hits = 0, setups = 0, minSpd = 99;
  for (let i = 0; i < opt.trials; i++) {
    const r = rangeTrial({ i: i, lead: opt.lead, dist: opt.dist, strafe: opt.strafe });
    if (!r.setup) continue;
    setups++; if (r.spd < minSpd) minSpd = r.spd;
    if (r.dealt > 0) hits++;
  }
  return { hits: hits, setups: setups, trials: opt.trials, minSpd: minSpd };
}
{
  const still = rangeHitRate({ lead: true, dist: 18, strafe: false, trials: 40 });
  ok('静止靶 18 格命中 ≥95%：' + (100 * still.hits / Math.max(1, still.setups)).toFixed(1) + '%（' + still.hits + '/' + still.setups + '）',
    still.setups === still.trials && still.hits / still.setups >= 0.95,
    'setups ' + still.setups + '/' + still.trials);
  const leadOn = rangeHitRate({ lead: true, dist: 15, strafe: true, trials: 40 });
  ok('满速横移靶 15 格（提前量开）命中 ≥35%：' + (100 * leadOn.hits / Math.max(1, leadOn.setups)).toFixed(1) + '%（' + leadOn.hits + '/' + leadOn.setups + '）',
    leadOn.setups === leadOn.trials && leadOn.hits / leadOn.setups >= 0.35,
    'setups ' + leadOn.setups + '/' + leadOn.trials);
  ok('横移靶确实满速（SPEED 5.6 档，实测最低 ' + leadOn.minSpd.toFixed(2) + '）', leadOn.minSpd >= 5.0);
  const leadOff = rangeHitRate({ lead: false, dist: 15, strafe: true, trials: 40 });
  ok('对照组（同场景关提前量）命中 <10%：' + (100 * leadOff.hits / Math.max(1, leadOff.setups)).toFixed(1) + '%（' + leadOff.hits + '/' + leadOff.setups + '）——证明提升来自提前量，不是半径注水',
    leadOff.setups === leadOff.trials && leadOff.hits / leadOff.setups < 0.10,
    'setups ' + leadOff.setups + '/' + leadOff.trials);
  const replay = rangeHitRate({ lead: true, dist: 15, strafe: true, trials: 40 });
  ok('提前量零随机：同 seed 重放命中数逐枪一致（' + leadOn.hits + ' vs ' + replay.hits + '）',
    leadOn.hits === replay.hits);
}

console.log(fail ? ('\n攻击判定回归 ' + fail + ' 条未过') : '\n攻击判定回归全绿');
process.exit(fail ? 1 : 0);
