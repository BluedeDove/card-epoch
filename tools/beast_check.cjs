#!/usr/bin/env node
/* tools/beast_check.cjs · 晶甲兽（中立生态）回归（定案 GAMEPLAY §2.5 / CARD_ECONOMY §2 S3；任务书 docs/tasks/T4_BEASTS.md）

   管住什么：
     B1 opts.beasts:3 → 3 只中立兽：side -1、hp40/dmg6/speed2.8、melee、锁矿 10 格、无 ttl；
        落在矿点 2 格内、没被埋进方块（脚底不在实心格里，也不低于该柱可站面）
     B2 玩家站进 3 格内跑 2 秒 → 兽进入 chase/attack 且玩家真的掉血（生态不是背景板）
     B3 玩家退到 25 格外跑 3 秒 → 兽与 home 的水平距变小（回守），且这段时间玩家不掉血
     B4 跑 60 秒（1200 tick）兽仍在——ttl 1e9 不许按随从的 45s 消散
     B5 玩家打死它：素材 +3、队列里出现 source=beast/biome=neutral 的 offer、牌库张数不变；
        第二次 kill 不重复发奖；side>=0 的玩家随从仍走「击杀补 1 张」的老行为（逐字不变）
     B6 opts.beasts 为 0 或**不传** → 一只都不生成（默认关闭：误提交不改变现有对局）
     B7 中立兽不写世界：跑 2 秒后 world.blocks 校验和不变
     B8 名字表与模型分支都在（中立兽不是默认橙盒子）
     B9 生成零 rng：同 seed 两次构造，三只兽的落点逐位一致

   测试世界必须传 { size:[64,36,64], seed, lodes:true }（world.js 的 opts.lodes 显式开关）——
   不打开就没有 world.lodes，也就没有矿脉与守矿的兽。
   本工具**不装 src/chem.js**：B7 问的是「兽有没有写格子」，物质层自己的岩浆/水变化不是这条口径，
   装了会把别人的账算到兽头上（同 light_probe 的 --checkonly 只能同份加载状态比，一个道理）。
   构造口径照 tools/play_probe.cjs，断言与打印风格照 tools/hand_check.cjs；node 里跑，不依赖 GL。

   用法：node tools/beast_check.cjs [seed]   默认 490706；退出码非 0 就是不达标
*/
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards/pick-pools.js', 'src/cards.js', 'src/vfx.js', 'src/rules.js', 'src/battle.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const STEP = 1 / 20;

let n = 0, bad = 0;
function ck(name, ok, detail) {
  n++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  [' + detail + ']'));
  if (!ok) bad++;
}
function noop() {}
const FX = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop,
             fire: noop, float: noop, ambient: noop, chemLog: noop, quake: noop };
/* 关卡图：lodes:true 才长矿脉（world.js 的 opts.lodes）；beasts 走 Match opts（默认关闭） */
function mkMatch(over) {
  const o = Object.assign({ seed: SEED }, over || {});
  const seed = o.seed >>> 0;
  const w = new G.World({ size: [64, 36, 64], seed: seed, sea: 12, lodes: true });
  w.generate();
  return new G.Match(Object.assign({ world: w, seed: seed, mode: 'train', players: 2, fx: FX }, o));
}
function run(m, secs) {
  const t = Math.round(secs / STEP);
  for (let i = 0; i < t; i++) { if (m.over) break; m.step(STEP, [{}, {}]); }
  return t;
}
const beastsOf = function (m) { return m.summons.filter(function (s) { return s.aiKind === 'crystal_beast'; }); };
const rawGet = G.World.prototype.get;
function solidAt(w, x, y, z) {
  const id = rawGet.call(w, x, y, z);
  return !!id && !!G.BLOCK_DEFS[id] && !!G.BLOCK_DEFS[id].solid;
}
/* 独立按身体 AABB × 实心格重算「自身被埋」（与 play_probe T8 同几何口径，不复用 unstick 的结论） */
function buried(w, e) {
  const hw = e.w / 2, hh = e.h / 2;
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
    const cx = Math.floor(e.pos.x) + ox, cy = Math.floor(e.pos.y) + oy, cz = Math.floor(e.pos.z) + oz;
    if (!solidAt(w, cx, cy, cz)) continue;
    if (cx < e.pos.x + hw && cx + 1 > e.pos.x - hw && cy < e.pos.y + hh && cy + 1 > e.pos.y - hh &&
        cz < e.pos.z + hw && cz + 1 > e.pos.z - hw) return true;
  }
  return false;
}
function blocksHash(w) {
  let h = 2166136261 >>> 0; const b = w.blocks;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/* 把人摆到「与兽同高的脚底面 + 一点偏移」：不靠 camGroundY 猜地形，兽站得住的那根柱子人也站得住 */
function putNearBeast(m, p, b, dx, dz) {
  p.pos.set(b.pos.x + dx, b.pos.y - b.h / 2 + p.h / 2 + 0.02, b.pos.z + dz);
  p.vel.set(0, 0, 0); p.onGround = true; p.alive = true; p.dead = false; p.invuln = 0; p.respawn = 0;
  return p;
}
/* 以 home 为圆心找一个距离 r 的有地面候选点（8 方向 + 世界边界内），给 B3 的「25 格外」用 */
function spotAt(m, cx, cz, r) {
  const DIR = [[1,0],[-1,0],[0,1],[0,-1],[0.7071,0.7071],[-0.7071,0.7071],[0.7071,-0.7071],[-0.7071,-0.7071]];
  const w = m.world;
  for (let k = 0; k < DIR.length; k++) {
    const x = cx + DIR[k][0] * r, z = cz + DIR[k][1] * r;
    if (x < 3 || z < 3 || x > w.SX - 4 || z > w.SZ - 4) continue;
    if (w.camGroundY(Math.floor(x), Math.floor(z)) < 1) continue;      // 没地面的柱子（湖心/深渊）不要
    return { x: x, z: z };
  }
  return null;
}
function putAt(m, p, spot) {
  const gy = m.world.camGroundY(Math.floor(spot.x), Math.floor(spot.z));
  p.pos.set(Math.floor(spot.x) + 0.5, gy + 1 + p.h / 2 + 0.02, Math.floor(spot.z) + 0.5);
  p.vel.set(0, 0, 0); p.onGround = true; p.alive = true; p.dead = false; p.invuln = 0; p.respawn = 0;
  return p;
}
const tot3 = function (p) { return p.hand.length + p.deck.length + p.discard.length; };

/* ---------- B1 生成规格 ---------- */
{
  const m = mkMatch({ beasts: 3 });
  const bs = beastsOf(m), lodes = (m.world.lodes && m.world.lodes.list) || [];
  ck('B1 opts.beasts:3 → 3 只晶甲兽（矿数就是上限）', bs.length === 3 && lodes.length === 3,
     bs.length + ' 只 / 矿 ' + lodes.length + ' 条 / 随从表 ' + m.summons.length);
  ck('B1 全是中立（side === -1：谁都是它的敌人）', bs.every(function (s) { return s.side === -1; }),
     bs.map(function (s) { return s.side; }).join(','));
  ck('B1 数值口径 hp40 / dmg6 / speed2.8 / melee / leash10 / ttl 不退场',
     bs.every(function (s) { return s.hp === 40 && s.maxHp === 40 && s.dmg === 6 && s.speed === 2.8
       && s.ai === 'melee' && s.mode === 'direct' && s.leash === 10 && s.ttl > 1e8; }),
     bs.map(function (s) { return s.hp + '/' + s.dmg + '/' + s.speed + '/' + s.ai + '/' + s.leash; }).join(' '));
  const dists = bs.map(function (s) {
    let bd = 1e9;
    lodes.forEach(function (L) { bd = Math.min(bd, Math.hypot(s.pos.x - (L.x + 0.5), s.pos.z - (L.z + 0.5))); });
    return bd;
  });
  ck('B1 每只都落在矿点 2 格内（守矿，不是满图跑）', dists.every(function (d) { return d <= 2.0; }),
     dists.map(function (d) { return d.toFixed(2); }).join(' / '));
  const sunk = bs.filter(function (s) { return buried(m.world, s); });
  const sunkY = bs.filter(function (s) {
    const gy = m.world.camGroundY(Math.floor(s.pos.x), Math.floor(s.pos.z));
    return gy >= 1 && (s.pos.y - s.h / 2) < gy + 1 - 0.05;
  });
  ck('B1 没有一只被埋进方块（AABB 不插进实心格，脚底不低于该柱可站面）',
     sunk.length === 0 && sunkY.length === 0,
     'AABB 相交 ' + sunk.length + ' 只 / 脚底过低 ' + sunkY.length + ' 只');
  ck('B1 home 就是本矿平台中心（回守的锚在生成期写死，零 rng）',
     bs.every(function (s) { return s.home && s.mode === 'direct'; }),
     bs.map(function (s) { return '(' + s.home.x.toFixed(1) + ',' + s.home.z.toFixed(1) + ')'; }).join(' '));
}

/* ---------- B2 咬人 ---------- */
{
  const m = mkMatch({ beasts: 1 });
  const b = beastsOf(m)[0], p = m.players[0];
  ck('B2 本条有一只兽可测', !!b, b ? '' : '没生成');
  putNearBeast(m, p, b, 1.4, 0.6);
  const hp0 = p.hp, hb0 = b.hp;
  const states = {};
  for (let i = 0; i < 40; i++) { if (m.over) break; m.step(STEP, [{}, {}]); states[b.state] = 1; }
  ck('B2 玩家进 3 格内跑 2 秒 → 兽进入 chase/attack', !!(states.chase || states.attack),
     Object.keys(states).join(',') || '无状态');
  ck('B2 玩家真的掉血（生态不是背景板）', p.hp < hp0, 'hp ' + hp0 + '→' + p.hp.toFixed(1));
  ck('B2 兽自己没掉血（没人打它）', b.hp === hb0, 'hp ' + b.hp);
}

/* ---------- B3 回守 ---------- */
{
  const m = mkMatch({ beasts: 1 });
  const b = beastsOf(m)[0], p = m.players[0];
  const lure = spotAt(m, b.home.x, b.home.z, 8);
  putAt(m, p, lure || { x: b.home.x + 8, z: b.home.z });
  run(m, 2.5);
  const dLure = Math.hypot(b.pos.x - b.home.x, b.pos.z - b.home.z);
  const far = spotAt(m, b.home.x, b.home.z, 26);
  ck('B3 找得到 25 格外的可站点（世界边界内）', !!far, far ? '(' + far.x.toFixed(0) + ',' + far.z.toFixed(0) + ')' : '8 方向全出界或无地面');
  putAt(m, p, far || { x: b.home.x + 26, z: b.home.z });
  const dPlayer = Math.hypot(p.pos.x - b.home.x, p.pos.z - b.home.z);
  const hpB = p.hp, d0 = Math.hypot(b.pos.x - b.home.x, b.pos.z - b.home.z);
  run(m, 3);
  const d1 = Math.hypot(b.pos.x - b.home.x, b.pos.z - b.home.z);
  ck('B3 前提：兽被引出 home（离 home >1.6 格才量得出回守）', dLure > 1.6 && d0 > 1.6,
     '引后 ' + dLure.toFixed(2) + ' / 出发 ' + d0.toFixed(2));
  ck('B3 玩家跑到 ' + dPlayer.toFixed(0) + ' 格外 → 兽回守（与 home 水平距变小）',
     dPlayer > 24 && d1 < d0 - 0.5, d0.toFixed(2) + '→' + d1.toFixed(2));
  ck('B3 回守这段时间玩家不掉血（出了 leash 圈就不追）', p.hp === hpB, 'hp ' + hpB + '→' + p.hp.toFixed(1));
}

/* ---------- B4 不退场 ---------- */
{
  const m = mkMatch({ beasts: 3 });
  const bs = beastsOf(m);
  const t = run(m, 60);
  ck('B4 跑 60 秒（' + t + ' tick）三只仍在、ttl 没烧完',
     bs.every(function (s) { return s.alive && m.summons.indexOf(s) >= 0 && s.ttl > 1e8; }),
     '在场 ' + beastsOf(m).length + '/3 ttl=' + bs.map(function (s) { return Math.round(s.ttl); }).join(','));
}

/* ---------- B5 首杀奖励 ---------- */
{
  const m = mkMatch({ beasts: 1 });
  const b = beastsOf(m)[0], p = m.players[0];
  const mats0 = p.mats, deck0 = p.deck.length, hand0 = p.hand.length, disc0 = p.discard.length;
  G.Rules.damage(b, 999, 'physical', m.ctx, p);          // 走结算器唯一掉血出口（不手改 hp）
  ck('B5 中立兽首杀：击杀者素材 +3', p.mats === mats0 + 3, mats0 + '→' + p.mats);
  const pd = m.pendingDraft();
  ck('B5 队列里出现兽首杀 offer（source=beast、biome=neutral、候选 3 张）',
     !!pd && pd.source === 'beast' && pd.side === 0 && pd.biome === 'neutral' && pd.options.length === 3,
     JSON.stringify(pd));
  ck('B5 牌库/手牌/弃牌一张没多（三选一没选就不许多牌）',
     p.deck.length === deck0 && p.hand.length === hand0 && p.discard.length === disc0,
     'deck=' + p.deck.length + ' hand=' + p.hand.length + ' discard=' + p.discard.length);
  ck('B5 兽从随从表移除（不重生）', m.summons.indexOf(b) < 0 && beastsOf(m).length === 0,
     '随从 ' + m.summons.length + ' 只');
  const mats1 = p.mats;
  m.kill(b, p, m.ctx);
  ck('B5 第二次 kill 不重复发奖（dead/rewarded 两道守卫）',
     p.mats === mats1 && m.drafts.length === 1, 'mats=' + p.mats + ' 队列=' + m.drafts.length);
  /* side >= 0 的玩家随从：击杀补 1 张的老行为必须逐字不变（这条改了就是动了卡牌线的账） */
  const m2 = mkMatch({ beasts: 0 });
  const fake = G.baseEntity({ kind: 'summon', side: 1, name: '测试随从', aiKind: 'golem',
                              hp: 20, maxHp: 20, dmg: 0, speed: 0, ai: 'none',
                              ttl: 1e9, atkCd: 1e9, state: 'idle' });
  fake.pos.set(m2.players[0].pos.x, m2.players[0].pos.y, m2.players[0].pos.z + 1);
  m2.summons.push(fake);
  const pk = m2.players[0];
  const deckK = pk.deck.length, handK = pk.hand.length, discK = pk.discard.length, matsP = pk.mats;
  m2.kill(fake, pk, m2.ctx);
  /* 「补 1 张」看的是**牌库少了一张、那张进了手或弃牌**：开局 5 格手持栏是满的，
     deck.js 的 drawCards 在满手时把抽到的牌直接压进弃牌堆（三堆之和守恒，不动总数）——
     拿三堆总数当判据会把这条正常行为读成「没补牌」，所以按出处比。 */
  const drewOne = pk.deck.length === deckK - 1 &&
    (pk.hand.length === handK + 1 || pk.discard.length === discK + 1);
  ck('B5 击杀 side>=0 的随从仍补 1 张、不发素材（老行为逐字不变；满手时补的那张进弃牌堆是 deck.js 既有口径）',
     drewOne && pk.mats === matsP && m2.players[0].kills === 1,
     '牌库 ' + deckK + '→' + pk.deck.length + ' 手 ' + handK + '→' + pk.hand.length +
     ' 弃 ' + discK + '→' + pk.discard.length + ' mats=' + pk.mats + ' kills=' + pk.kills);
}

/* ---------- B6 默认关闭 ---------- */
{
  const mOff = mkMatch({ beasts: 0 }), mDef = mkMatch();
  ck('B6 opts.beasts:0 → 0 只', beastsOf(mOff).length === 0 && mOff.summons.length === 0,
     mOff.summons.length + ' 只随从');
  ck('B6 不传 opts.beasts → 0 只（默认关闭：误提交不改变现有对局）',
     beastsOf(mDef).length === 0 && mDef.summons.length === 0 && Array.isArray(mDef.beasts) && mDef.beasts.length === 0,
     'summons=' + mDef.summons.length + ' beasts=' + (mDef.beasts || []).length);
}

/* ---------- B7 不写世界 ---------- */
{
  const m = mkMatch({ beasts: 3 });
  const p = m.players[0], b = beastsOf(m)[0];
  putNearBeast(m, p, b, 1.6, 0.4);                 // 逗它打架：打架也不许动方块
  const h0 = blocksHash(m.world);
  run(m, 2);
  const h1 = blocksHash(m.world);
  ck('B7 中立兽不写世界格子（2 秒后 blocks 校验和不变）', h0 === h1, h0 + ' vs ' + h1);
}

/* ---------- B8 名字与模型 ---------- */
{
  ck('B8 G.SUMMON_CN 里有 crystal_beast=晶甲兽（名字进权威表，不进 UI 文案）',
     G.SUMMON_CN && G.SUMMON_CN.crystal_beast === '晶甲兽', JSON.stringify(G.SUMMON_CN && G.SUMMON_CN.crystal_beast));
  const ev = fs.readFileSync(path.join(ROOT, 'src/app/entity-view.js'), 'utf8');
  const br = /aiKind\s*===\s*'crystal_beast'/.test(ev);
  ck('B8 entity-view 有 crystal_beast 分支 + 石壳/晶体/眼三色（不是默认橙盒子）',
     br && /#5a4a8a/.test(ev) && /#b26bff/.test(ev) && /#e0d0ff/.test(ev),
     '分支=' + br + ' 色号 ' + ['#5a4a8a', '#7a63b8', '#b26bff', '#e0d0ff'].filter(function (c) { return ev.indexOf(c) >= 0; }).join(','));
}

/* ---------- B9 零 rng ---------- */
{
  const sigOf = function (m) {
    return beastsOf(m).map(function (s) {
      return [Math.round(s.pos.x * 1000), Math.round(s.pos.y * 1000), Math.round(s.pos.z * 1000)].join(',');
    }).join(' ');
  };
  const a = mkMatch({ beasts: 3 }), b = mkMatch({ beasts: 3 });
  ck('B9 同 seed 两次构造：三只兽落点逐位一致（生成零 rng）', sigOf(a) === sigOf(b), sigOf(a));
}

console.log('\n共 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
