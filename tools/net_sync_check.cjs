#!/usr/bin/env node
/* tools/net_sync_check.cjs · NET-N1 权威同步纯逻辑层回归（任务书 docs/tasks/N1_NET_SYNC.md）

   S1 序列化扩字段 + 信息隔离：viewer=1 递归扫不到房主手牌/牌库顺序/弃牌/候选池；看得到自己手牌；
      handCount/deckCount 双方都有；随从/抛射物/法阵新字段（uid/aiKind/h/ttl/st、uid/color/entKind、sigils 全形）在帧上。
   S2 快照往返：apply 后镜像 players[0] == 房主 players[1]、players[1] == 房主 players[0]
      （pos/hp/mana/mats/score 逐一比）；hand 只落自己侧、deck 只留张数占位；ppos 记的是覆盖前的位置（§9.3 步 4 的顺序）。
   S3 矿归属与 over.winner 互换正确（含 owner=-1 不变）。
   S4 世界 diff：房主改 12 格（含岩浆旁放可燃物触发 chem 唤醒）→ drain 后 guest applyCells →
      两边逐格相同、Save 的 diff 数相同；drain 后 tracker 为空；detach 后不再记录。
   S5 input 编解码：encodeInput → decodeInput 往返 keys/cast 不丢、yaw/pitch 被 clamp 到 G.LOOK_LIMIT；缺帧 poll = 空白输入。
   S6 三选一：房主给 side1 排一次 offer → makeSnapshot(match,1) 的 draft 三个候选、makeSnapshot(match,0) 的 draft === null；
      takeDraft(1,id) 后房主 side1 牌库 +2。
   S7 uid 对账：同一份快照 apply 两次，随从/抛射物/法阵对象引用不变；快照少一条后对应对象被移除；preset 查不到的法阵丢弃。
   S8 外推：extrapolate(0.05) 让 pos 沿 vel 前进，连续 4 次后（>0.15s）第五次不再前进；重新收快照预算复位；只外推 localSide。

   构造口径照 tools/draft_check.cjs（64×36×64 关卡图，lodes:true 才长矿脉）。node 里跑，不依赖 GL 与页面。
   用法：node tools/net_sync_check.cjs [seed]   默认 490706；退出码非 0 = 有红。 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards/pick-pools.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js',
 'src/net-ws.js', 'src/net.js', 'src/net-match.js', 'src/save.js'].forEach(function (f) { require(path.join(ROOT, f)); });
const G = window.GW;
const NM = G.NetMatch;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const STEP = 1 / 20;

let n = 0, bad = 0;
function ck(name, okVal, detail) {
  n++; if (okVal) console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
  else { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
}
function noop() {}
const FX = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop,
             fire: noop, float: noop, ambient: noop, chemLog: noop, quake: noop };
function mkWorld(seed) {
  const w = new G.World({ size: [64, 36, 64], seed: seed >>> 0, sea: 12, lodes: true });
  w.generate();
  w.snapshotBaseline();                 // baseline 先于 Match：Save 的 diff 只数我们手动改过的格
  return w;
}
function mkMatch(seed) {
  return new G.Match({ world: mkWorld(seed), seed: seed >>> 0, mode: 'train', players: 2, fx: FX });
}
function run(m, secs, inputs) { const t = Math.round(secs / STEP); for (let i = 0; i < t; i++) m.step(STEP, inputs || [{}, {}]); return t; }
function wire(snap) { return JSON.parse(JSON.stringify(snap)); }    // 过一遍 JSON：函数/undefined 上不了线
function scan(node, st) {
  if (typeof node === 'string') st.strings.push(node);
  else if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) scan(node[i], st); }
  else if (node && typeof node === 'object') { for (const k of Object.keys(node)) { st.keys.add(k); scan(node[k], st); } }
  return st;
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }
/* 假实体（字段形状照 systems/summon.js、systems/projectile.js、systems/sigil.js 的真实产出；
   uid 固定，S1/S7 共用）。随从 st 里混一个函数与一个 0 值：serializeFor 必须把它们滤掉。 */
function fakeEnts(m) {
  m.summons.length = 0; m.projectiles.length = 0; m.sigils.length = 0;
  m.summons.push(G.baseEntity({ uid: 901, kind: 'summon', side: 0, name: '岩石魔像', aiKind: 'golem',
    hp: 20, maxHp: 20, h: 1.7, yaw: 0.5, ttl: 45, st: { burn: 3, zero: 0, fn: function () {} },
    pos: new G.V(8.5, 15.2, 9.5), vel: new G.V(1, 0, 0), alive: true }));
  m.projectiles.push({ uid: 911, entKind: 'projectile', born: 0, pos: new G.V(10, 16, 10), vel: new G.V(3, 0, 1),
    life: 9, side: 0, dmg: 8, kind: 'fire', element: 'fire', radius: 0, color: '#ff7519', aiKind: 'firebolt', status: null, fuse: 1.2 });
  m.sigils.push({ uid: 921, id: 'meteors', preset: Object.assign({ id: 'meteors' }, G.SIGILS.meteors),
    pos: { x: 20.5, y: 15, z: 20.5 }, radius: 3, born: 1, delay: 0.4, ttl: 6, active: true, dead: false, side: 1, owner: m.players[1], hp: 40, acc: 0 });
  m.sigils.push({ uid: 922, id: 'snare', preset: Object.assign({ id: 'snare' }, G.SIGILS.snare),
    pos: { x: 5, y: 14, z: 5 }, radius: 1.5, born: 0.5, delay: 0, ttl: 6, active: false, dead: false, triggered: true, side: 0, owner: m.players[0], hp: 40, acc: 0 });
}

console.log('── S1 serializeFor 扩字段 + 信息隔离（viewer=1，真 Match）');
{
  const m = mkMatch(SEED);
  m.players[0].hand = ['wall2', 'dig3'];
  m.players[0].deck = ['aa1', 'aa2', 'aa3'];
  m.players[0].discard = ['aa4'];
  m.players[0].pendingPick = ['xpick1'];
  m.players[1].hand = ['heal', 'blink'];
  m.players[1].deck = ['bb1', 'bb2', 'bb3'];
  m.players[1].discard = ['bb4'];
  fakeEnts(m);
  const snap = wire(NM.makeSnapshot(m, 1, null));
  const st = scan(snap, { strings: [], keys: new Set() });
  const strs = new Set(st.strings);
  // 隐藏信息 = 对方手牌内容 + 双方牌库顺序 + 对方 pendingPick 候选；**弃牌堆是公开的**（aa4/bb4 必须出现）。
  const hiddenHost = ['wall2', 'dig3', 'aa1', 'aa2', 'aa3', 'xpick1'];
  const leaked = hiddenHost.filter(function (id) { return strs.has(id); });
  ck('S1 viewer=1 递归扫：房主手牌/牌库顺序/候选池一条都不出现（弃牌堆除外，它公开）', leaked.length === 0, leaked.join(',') || '无泄漏');
  ck('S1 公开信息不误伤：对方弃牌堆 aa4 就在帧上（黑名单没顺手吞掉白名单）', strs.has('aa4'));
  const p0v = snap.view.players.find(function (p) { return p.side === 0; });
  const p1v = snap.view.players.find(function (p) { return p.side === 1; });
  ck('S1 看得到自己手牌（heal/blink 原样）', !!p1v && deepEq(p1v.hand, ['heal', 'blink']), p1v && JSON.stringify(p1v.hand));
  ck('S1 handCount/deckCount 双方都有且数值对', !!p0v && p0v.handCount === 2 && p0v.deckCount === 3 && !!p1v && p1v.handCount === 2 && p1v.deckCount === 3,
     p0v && ('p0 ' + p0v.handCount + '/' + p0v.deckCount + ' p1 ' + p1v.handCount + '/' + p1v.deckCount));
  ck('S1 deck 键整帧不出现（牌库顺序连自己都不许看）；pendingPick 也不出现', !st.keys.has('deck') && !st.keys.has('pendingPick'),
     [...st.keys].filter(function (k) { return k === 'deck' || k === 'pendingPick'; }).join(',') || '干净');
  ck('S1 自己牌库的顺序也不在帧上（bb1..bb3 不出现），公开弃牌堆照发（bb4 在）',
     !strs.has('bb1') && !strs.has('bb2') && !strs.has('bb3') && strs.has('bb4'));
  const su = snap.view.summons[0];
  ck('S1 随从补字段齐：uid/aiKind/name/h/yaw/ttl/st，且 st 只带 truthy 非函数键',
     !!su && su.uid === 901 && su.aiKind === 'golem' && su.name === '岩石魔像' && su.h === 1.7 && su.yaw === 0.5 && su.ttl === 45 &&
     deepEq(su.st, { burn: 3 }), su && JSON.stringify(su && su.st));
  const pr = snap.view.projectiles[0];
  ck('S1 抛射物补字段齐：uid/color/entKind', !!pr && pr.uid === 911 && pr.color === '#ff7519' && pr.entKind === 'projectile',
     pr && JSON.stringify([pr.uid, pr.color, pr.entKind]));
  ck('S1 sigils 数组：两条、presetId/kind/radius/born/delay/ttl/active/dead/triggered/side/hidden 全形',
     snap.view.sigils.length === 2 &&
     snap.view.sigils[0].presetId === 'meteors' && snap.view.sigils[0].kind === 'fire' && snap.view.sigils[0].hidden === false &&
     snap.view.sigils[0].active === true && snap.view.sigils[0].radius === 3 &&
     snap.view.sigils[1].presetId === 'snare' && snap.view.sigils[1].hidden === true && snap.view.sigils[1].triggered === true &&
     snap.view.sigils[1].side === 0 && snap.view.sigils[1].born === 0.5 && snap.view.sigils[1].ttl === 6,
     JSON.stringify(snap.view.sigils));
  ck('S1 玩家补字段：respawn 与 status 在帧上（cd 不发）', 'respawn' in p1v && deepEq(p0v.status, {}) && typeof p1v.respawn === 'number' && !('cd' in p0v));
}

console.log('── S2 快照往返：1↔0 互换逐一比');
const m2 = mkMatch(SEED);
{
  run(m2, 0.5, [{ fwd: 1 }, {}]);                       // 让双方数值不再是出厂值
  const a = m2.players[0], b = m2.players[1];
  a.hand = ['wall2', 'dig3']; a.deck = ['aa1', 'aa2', 'aa3']; a.discard = ['aa4'];
  b.hand = ['heal', 'blink']; b.deck = ['bb1', 'bb2', 'bb3']; b.discard = ['bb4'];
  b.hp = 73; b.maxHp = 100; b.shield = 4; b.mana = 5; b.mats = 7; b.score = 42; b.kills = 2; b.respawn = 1.5;
  b.pos.set(12.5, 14.25, 33.125); b.vel.set(2, 0, -1); b.st = { burn: 3, zero: 0 };
  a.hp = 88; a.maxHp = 100; a.shield = 1; a.mana = 6; a.mats = 3; a.score = 51; a.kills = 1; a.respawn = 0;
  a.pos.set(5.5, 13.25, 7.5); a.vel.set(-1, 0, 2); a.st = { slow: 2 };
  fakeEnts(m2);
}
const snap2 = wire(NM.makeSnapshot(m2, 1, null));
const mirror2 = mkMatch(SEED);
{
  const spawnX = mirror2.players[0].pos.x, spawnZ = mirror2.players[0].pos.z;
  const revBefore = mirror2.rev;
  const r = NM.applySnapshot(mirror2, snap2);
  ck('S2 applySnapshot 返回 {ok:true, tick}', r.ok === true && r.tick === snap2.tick, JSON.stringify(r));
  const me = mirror2.players[0], host = mirror2.players[1], b = m2.players[1], a = m2.players[0];
  const same = ['x', 'y', 'z'];
  const selfOk = same.every(function (k) { return near(me.pos[k], b.pos[k]); }) &&
    me.hp === b.hp && me.maxHp === b.maxHp && me.shield === b.shield && me.alive === b.alive &&
    me.score === b.score && me.mana === b.mana && me.mats === b.mats && me.kills === b.kills && near(me.respawn, b.respawn) &&
    same.every(function (k) { return near(me.vel[k], b.vel[k]); });
  ck('S2 镜像 players[0]（自己）== 房主 players[1]：pos/vel/hp/shield/alive/score/mana/mats/kills/respawn 全同',
     selfOk, JSON.stringify([me.pos.x, me.pos.y, me.pos.z, me.hp, me.mana, me.mats, me.score]) + ' vs ' + JSON.stringify([b.pos.x, b.pos.y, b.pos.z, b.hp, b.mana, b.mats, b.score]));
  const hostOk = same.every(function (k) { return near(host.pos[k], a.pos[k]); }) &&
    host.hp === a.hp && host.shield === a.shield && host.alive === a.alive && host.score === a.score &&
    host.mana === a.mana && host.mats === a.mats && host.kills === a.kills &&
    same.every(function (k) { return near(host.vel[k], a.vel[k]); });
  ck('S2 镜像 players[1]（房主）== 房主 players[0]', hostOk,
     JSON.stringify([host.pos.x, host.pos.y, host.pos.z, host.hp, host.mana, host.mats, host.score]));
  ck('S2 st 覆盖：自己烧着(burn=3)、房主减速(slow=2)，0 值被滤', me.st.burn === 3 && !('zero' in me.st) && host.st.slow === 2,
     JSON.stringify(me.st) + ' / ' + JSON.stringify(host.st));
  ck('S2 hand 只落自己那侧（mirror players[0]）；对方 hand 只剩张数占位',
     deepEq(me.hand, ['heal', 'blink']) && host.hand.length === 2 && host.hand.every(function (v) { return v === undefined; }),
     JSON.stringify(me.hand) + ' / ' + JSON.stringify(host.hand));
  ck('S2 deck 只留张数占位（双方都是空槽，顺序被抹）',
     me.deck.length === 3 && me.deck.every(function (v) { return v === undefined; }) &&
     host.deck.length === 3 && host.deck.every(function (v) { return v === undefined; }));
  ck('S2 discard 公开原样（互换落位）', deepEq(me.discard, ['bb4']) && deepEq(host.discard, ['aa4']),
     JSON.stringify([me.discard, host.discard]));
  ck('S2 先 snapshotPrev 再覆盖：ppos 记的是覆盖前（镜像自己的出生位置）',
     near(me.ppos.x, spawnX) && near(me.ppos.z, spawnZ) && !near(me.ppos.x, me.pos.x, 1e-6),
     'ppos=' + JSON.stringify([me.ppos.x, me.ppos.z]) + ' pos=' + JSON.stringify([me.pos.x, me.pos.z]));
  ck('S2 time/tick 由快照推进 + touch 使 rev 递增',
     mirror2.tick === snap2.tick && near(mirror2.time, snap2.time) && mirror2.rev > revBefore,
     'tick ' + mirror2.tick + ' rev ' + revBefore + '→' + mirror2.rev);
}

console.log('── S3 矿归属与 over.winner 互换');
{
  const ls = m2.lodeSys.lodes;
  ck('S3 这张图有 3 条矿（量具前提）', ls.length === 3, 'lodes=' + ls.length);
  ls[0].owner = 0; ls[1].owner = 1; ls[2].owner = -1;
  m2.over = { winner: 0, name: 'P1', ticks: 4242, time: 212, winReason: 'score' };
  const s3 = wire(NM.makeSnapshot(m2, 1, null));
  ck('S3 快照里带矿归属（真 Match 走 lodeSys 源）', s3.view.lodes.length === 3 && s3.view.lodes[0].owner === 0 && s3.view.lodes[1].owner === 1 && s3.view.lodes[2].owner === -1,
     JSON.stringify(s3.view.lodes.map(function (l) { return l.owner; })));
  NM.applySnapshot(mirror2, s3);
  ck('S3 apply 后 owner 0→1、1→0、-1 不变（中立/无主不许被换成某方）',
     mirror2.lodeSys.lodes[0].owner === 1 && mirror2.lodeSys.lodes[1].owner === 0 && mirror2.lodeSys.lodes[2].owner === -1,
     JSON.stringify(mirror2.lodeSys.lodes.map(function (l) { return l.owner; })));
  ck('S3 over.winner 互换且其余字段原样', mirror2.over && mirror2.over.winner === 1 && mirror2.over.winReason === 'score' && mirror2.over.ticks === 4242,
     JSON.stringify(mirror2.over));
  m2.over = null;
  NM.applySnapshot(mirror2, wire(NM.makeSnapshot(m2, 1, null)));
  ck('S3 房主未分胜负时镜像 over 回到 null（不许残留旧判定）', mirror2.over === null, JSON.stringify(mirror2.over));
}

console.log('── S4 世界 diff：房主改 12 格 → tracker → guest applyCells');
{
  const m4 = mkMatch(SEED);
  const w4 = m4.world;
  const tracker = NM.makeWorldTracker(w4);
  const cells = [];
  [[10, 2, 10], [11, 2, 10], [12, 2, 10], [10, 2, 11], [20, 2, 20], [21, 2, 20], [20, 2, 21], [30, 2, 30], [31, 2, 30], [40, 2, 40]]
    .forEach(function (c) {
      const cur = w4.get(c[0], c[1], c[2]);
      const id = cur === 0 ? G.BLOCK.STONE : 0;                // 保证与现值不同：world.set 同 id 是 no-op（不发钩子）
      cells.push([c[0], c[1], c[2], id]);
    });
  let ly = null;
  for (let y = 14; y < 25 && ly === null; y++) { if (w4.get(32, y, 32) !== G.BLOCK.LAVA && w4.get(32, y, 32) === 0) ly = y; }
  ck('S4 找到一格空气放岩浆（量具前提）', ly !== null, 'y=' + ly);
  cells.push([32, ly, 32, G.BLOCK.LAVA]);                       // 岩浆本体：reactive → 唤醒 chem
  cells.push([33, ly, 32, G.BLOCK.LEAF]);                       // 岩浆旁一格的树叶：邻居唤醒的靶子
  let changed = 0;
  cells.forEach(function (c) { if (w4.set(c[0], c[1], c[2], c[3])) changed++; });
  ck('S4 房主 12 格全部真改动（world.set 都返回 true）', changed === 12, 'changed=' + changed);
  ck('S4 chem 唤醒被触发（岩浆进场的瞬间激活队列非空）', G.CHEM.ready === true && G.CHEM.pending() > 0, 'pending=' + G.CHEM.pending());
  ck('S4 tracker 记满 12 格', tracker.size() === 12, 'size=' + tracker.size());
  const drained = tracker.drain();
  ck('S4 drain 交出 12 条 [x,y,z,id]', drained.length === 12 && drained.every(function (c) { return c.length === 4; }));
  ck('S4 drain 后 tracker 为空', tracker.size() === 0, 'size=' + tracker.size());
  const gw4 = mkWorld(SEED);
  const gm4 = new G.Match({ world: gw4, seed: SEED, mode: 'train', players: 2, fx: FX });
  const junk = [[-5, 0, 0, G.BLOCK.STONE], [9999, 1, 1, G.BLOCK.STONE], [0, -9, 0, 3], null, [7]];
  const applied = NM.applyCells(gw4, drained.concat(junk));
  ck('S4 guest applyCells：12 格写入，非法坐标/畸形条目静默跳过', applied === 12, 'applied=' + applied);
  const allSame = cells.every(function (c) { return w4.get(c[0], c[1], c[2]) === gw4.get(c[0], c[1], c[2]) && gw4.get(c[0], c[1], c[2]) === c[3]; });
  ck('S4 改过的格两边逐格相同（且等于目标 id）', allSame);
  ck('S4 整张图逐字节相同（H1 同 seed 基线 + diff 全量落齐）',
     Buffer.compare(Buffer.from(w4.blocks), Buffer.from(gw4.blocks)) === 0);
  const dh = G.Save.exportFrom(w4, null).cells, dg = G.Save.exportFrom(gw4, null).cells;
  ck('S4 Save 的 diff 数相同且逐格对齐', dh.length === dg.length && dh.length === 12 &&
     dh.map(function (c) { return c.join(','); }).sort().join('|') === dg.map(function (c) { return c.join(','); }).sort().join('|'),
     'host=' + dh.length + ' guest=' + dg.length);
  ck('S4 guest 应用 diff 也惊动它自己的 chem 钩子（只入队，guest 不 step 就零成本）', G.CHEM.pending() > 0, 'pending=' + G.CHEM.pending());
  tracker.detach();
  const more = w4.set(12, 2, 12, w4.get(12, 2, 12) === 0 ? G.BLOCK.STONE : 0);
  ck('S4 detach 后钩子摘净：再改一格 drain 仍为空', more === true && deepEq(tracker.drain(), []), 'set=' + more);
  void gm4;
}

console.log('── S5 input 编解码 + 缺帧 + clamp');
{
  const m5 = mkMatch(SEED);
  const p1 = m5.players[1];
  const msg1 = NM.encodeInput({ fwd: 1, back: 0, left: 0, right: 1, jump: 1, crouch: 1, cast: 2, lookYaw: 0.7, lookPitch: -0.3 }, { yaw: 0.75, pitch: 0.2 });
  ck('S5 encodeInput 形状：keys 七键 + 绝对 yaw/pitch，增量 lookYaw/lookPitch 不上网络',
     deepEq(Object.keys(msg1.keys).sort(), ['back', 'cast', 'crouch', 'fwd', 'jump', 'left', 'right']) && msg1.yaw === 0.75 && msg1.pitch === 0.2 &&
     !('lookYaw' in msg1) && !('lookPitch' in msg1), JSON.stringify(msg1));
  const src = NM.remoteSourceFor(m5, 1);
  ck('S5 remoteSourceFor 幂等（同一 (match,side) 拿回同一条队列）', src === NM.remoteSourceFor(m5, 1));
  const r1 = NM.decodeInput(msg1, m5, 1);
  ck('S5 decodeInput 返回 ok', r1.ok === true, JSON.stringify(r1));
  const in1 = src.poll(STEP);
  ck('S5 往返 keys/cast 不丢（fwd/right/jump/crouch/cast=2 原样，lookYaw/lookPitch 恒 0）',
     in1.fwd === 1 && in1.back === 0 && in1.left === 0 && in1.right === 1 && in1.jump === 1 && in1.crouch === 1 && in1.cast === 2 &&
     in1.lookYaw === 0 && in1.lookPitch === 0, JSON.stringify(in1));
  ck('S5 applyTo 写了绝对朝向', near(p1.yaw, 0.75) && near(p1.pitch, 0.2), p1.yaw + '/' + p1.pitch);
  NM.decodeInput({ keys: { cast: 1 }, yaw: 100, pitch: 10 }, m5, 1);
  src.poll(STEP);
  ck('S5 pitch 越界被夹到 G.LOOK_LIMIT.up', p1.pitch === G.LOOK_LIMIT.up, 'pitch=' + p1.pitch);
  ck('S5 yaw 自由角只归一化（|yaw| ≤ π，不夹——LOOK_LIMIT 没有 yaw 上下界）', Math.abs(p1.yaw) <= Math.PI + 1e-9, 'yaw=' + p1.yaw);
  NM.decodeInput({ keys: { cast: -1 }, yaw: -100, pitch: -10 }, m5, 1);
  src.poll(STEP);
  ck('S5 下仰角同样被夹到 G.LOOK_LIMIT.down', p1.pitch === G.LOOK_LIMIT.down, 'pitch=' + p1.pitch);
  ck('S5 缺帧时 poll 返回空白输入（全 0 / cast=-1，与 G.blankInput 同形）', deepEq(src.poll(STEP), G.blankInput()), JSON.stringify(src.poll(STEP)));
  const rBad = NM.decodeInput({ keys: {}, yaw: 0, pitch: 0 }, m5, 7);
  ck('S5 不存在的 side：decodeInput 明说 ok:false（不许假成功）', rBad.ok === false, JSON.stringify(rBad));
}

console.log('── S6 三选一只发给自己的那一条');
{
  const m6 = mkMatch(SEED);
  ck('S6 开局队列干净', m6.pendingDraft() === null);
  const offer = m6.offerDraft(1, 'lode', 'forest');
  ck('S6 房主给 side1 排入 offer', !!offer && offer.options.length === 3, offer && offer.options.join(','));
  const sGuest = NM.makeSnapshot(m6, 1, null);
  const sHost = NM.makeSnapshot(m6, 0, null);
  ck('S6 makeSnapshot(match,1) 带 draft：三个候选、只含 {side,source,biome,options}',
     !!sGuest.draft && sGuest.draft.side === 1 && sGuest.draft.source === 'lode' &&
     deepEq(Object.keys(sGuest.draft).sort(), ['biome', 'options', 'side', 'source']) && sGuest.draft.options.length === 3,
     JSON.stringify(sGuest.draft));
  ck('S6 makeSnapshot(match,0) 的 draft === null（对方的 offer 不发）', sHost.draft === null, JSON.stringify(sHost.draft));
  const before = m6.players[1].deck.length;
  const picked = offer.options[1];
  const r = m6.takeDraft(1, picked);
  ck('S6 takeDraft(1,id) 回执 ok', r.ok === true && r.cardId === picked, JSON.stringify(r));
  const after = m6.players[1].deck.length;
  const cnt = m6.players[1].deck.filter(function (x) { return x === picked; }).length;
  ck('S6 房主 side1 牌库 +2 且该卡两张（回执走下一份快照的可见变化）', after === before + 2 && cnt === 2, before + '→' + after + ' 张 / ' + cnt + ' 张 ' + picked);
  /* 评审追加（2026-10-18 父层）：队列里先挂着房主(side0)的 offer 时，guest 那份也必须发得出去 */
  const m6b = mkMatch(SEED);
  const offB0 = m6b.offerDraft(0, 'lode', 'desert');
  const offB1 = m6b.offerDraft(1, 'lode', 'tundra');
  ck('S6 量具前提：队列先排入 side0 的 offer、再排 side1 的（两条同挂）',
     !!offB0 && !!offB1 && m6b.drafts.length === 2 && m6b.drafts[0].side === 0 && m6b.drafts[1].side === 1,
     JSON.stringify(m6b.drafts.map(function (d) { return d.side + ':' + d.biome; })));
  const sBothG = NM.makeSnapshot(m6b, 1, null);
  const sBothH = NM.makeSnapshot(m6b, 0, null);
  ck('S6 draft 扫队列不只看头：makeSnapshot(match,1).draft = side1 那条（房主那份挂着不挡 guest）',
     !!sBothG.draft && sBothG.draft.side === 1 && sBothG.draft.source === 'lode' &&
     deepEq(sBothG.draft.options, offB1.options) && sBothG.draft.biome === offB1.biome,
     JSON.stringify(sBothG.draft));
  ck('S6 反方向 viewer 也各取各的：makeSnapshot(match,0).draft = side0 那条',
     !!sBothH.draft && sBothH.draft.side === 0 && deepEq(sBothH.draft.options, offB0.options),
     JSON.stringify(sBothH.draft));
  /* 评审追加②确认：draft 不进镜像——guest 的三选一面板由 N2 读快照渲染，不靠 mirror.drafts */
  const mirror6 = mkMatch(SEED);
  const r6 = NM.applySnapshot(mirror6, wire(sBothG));
  ck('S6 applySnapshot 不把 draft 写进 mirror（mirror.drafts 保持出厂空队）',
     r6.ok === true && Array.isArray(mirror6.drafts) && mirror6.drafts.length === 0,
     'drafts=' + JSON.stringify(mirror6.drafts));
}

console.log('── S7 uid 对账：就地改、不重建、缺的删');
{
  const m7 = mkMatch(SEED);
  fakeEnts(m7);
  const snap7 = wire(NM.makeSnapshot(m7, 1, null));
  const mirror7 = mkMatch(SEED);
  const rA = NM.applySnapshot(mirror7, snap7);
  ck('S7 首次 apply：随从/抛射物/法阵按快照落齐', rA.ok === true &&
     mirror7.summons.length === 1 && mirror7.projectiles.length === 1 && mirror7.sigils.length === 2,
     JSON.stringify([mirror7.summons.length, mirror7.projectiles.length, mirror7.sigils.length]));
  const su0 = mirror7.summons[0], pr0 = mirror7.projectiles[0], sg0 = mirror7.sigils[0];
  ck('S7 新实体 ppos 与 pos 同值（renderPos 需要，缺了会从不存在的起点起飞）',
     near(su0.ppos.x, su0.pos.x) && near(su0.ppos.y, su0.pos.y) && near(su0.ppos.z, su0.pos.z) &&
     near(su0.ppos !== su0.pos && 0, 0) && su0.ppos !== su0.pos);
  ck('S7 side 互换落位：房主随从(side0)在镜像里是敌方(side1)，快照带的 side 已翻', su0.side === 1 && mirror7.sigils[0].side === 0,
     'summon.side=' + su0.side + ' sigil.side=' + mirror7.sigils[0].side);
  NM.applySnapshot(mirror7, snap7);
  ck('S7 同一份快照 apply 两次：对象引用不变（网格池不许每 100ms 重建）',
     mirror7.summons[0] === su0 && mirror7.projectiles[0] === pr0 && mirror7.sigils[0] === sg0 &&
     mirror7.summons.length === 1 && mirror7.projectiles.length === 1 && mirror7.sigils.length === 2);
  const dupUids = new Set(mirror7.summons.concat(mirror7.projectiles, mirror7.sigils).map(function (e) { return e.uid; }));
  ck('S7 无重复 uid 条目', dupUids.size === mirror7.summons.length + mirror7.projectiles.length + mirror7.sigils.length);
  const snap7b = wire(snap7);
  snap7b.view.projectiles = [];
  NM.applySnapshot(mirror7, snap7b);
  ck('S7 快照少一条 → 对应对象被移除（就地删，数组引用不换）', mirror7.projectiles.length === 0 && mirror7.summons.length === 1);
  const snap7c = wire(snap7b);
  snap7c.view.sigils.push({ uid: 999, presetId: 'no_such_preset', pos: { x: 1, y: 1, z: 1 }, radius: 2, born: 0, delay: 0, ttl: 6, active: false, dead: false, triggered: false, side: 0, hidden: false });
  const sigArrBefore = mirror7.sigils;
  NM.applySnapshot(mirror7, snap7c);
  ck('S7 preset 查不到的法阵：丢弃该条（不造假 preset，也不误删在表的）',
     mirror7.sigils === sigArrBefore && mirror7.sigils.length === 2 && mirror7.sigils.every(function (s) { return s.uid !== 999; }),
     'sigils=' + mirror7.sigils.map(function (s) { return s.uid; }).join(','));
  ck('S7 就地改字段生效：房主随从掉血后第二次 apply，镜像 hp 跟着变（不重建也能改）', (function () {
    const su = m7.summons[0]; su.hp = 7; su.st.frozen = 1.2;
    NM.applySnapshot(mirror7, wire(NM.makeSnapshot(m7, 1, null)));
    return mirror7.summons[0] === su0 && mirror7.summons[0].hp === 7 && mirror7.summons[0].st.frozen === 1.2 && mirror7.summons[0].st.burn === 3;
  })());
}

console.log('── S8 guest 外推：3 tick 预算，到点定住');
{
  const m8 = mkMatch(SEED);
  m8.players[1].vel.set(2, 0, 0);                        // 房主侧的 guest 玩家（镜像里的 players[0]）
  m8.players[0].vel.set(5, 0, 0);                        // 房主自己的玩家（镜像里的 players[1]，不许外推）
  const snap8 = wire(NM.makeSnapshot(m8, 1, null));
  const mirror8 = mkMatch(SEED);
  NM.applySnapshot(mirror8, snap8);
  ck('S8 vel 覆盖落位：镜像 players[0].vel 来自快照（外推用最后已知速度）', near(mirror8.players[0].vel.x, 2) && mirror8.players[0].alive === true);
  const x0 = mirror8.players[0].pos.x, hx0 = mirror8.players[1].pos.x;
  let moved = 0;
  for (let i = 0; i < 4; i++) if (NM.extrapolate(mirror8, 0.05, 0) === true) moved++;
  ck('S8 前 4 次（0.20s 窗口内）都沿 vel 前进', moved === 4 && near(mirror8.players[0].pos.x, x0 + 2 * 0.2), x0 + '→' + mirror8.players[0].pos.x);
  const x4 = mirror8.players[0].pos.x;
  ck('S8 第 5 次（连续外推 >0.15s）返回 false 且定住', NM.extrapolate(mirror8, 0.05, 0) === false && mirror8.players[0].pos.x === x4, x4 + ' 不动');
  ck('S8 只外推 localSide：镜像 players[1]（房主玩家）纹丝不动', mirror8.players[1].pos.x === hx0, hx0 + '→' + mirror8.players[1].pos.x);
  NM.applySnapshot(mirror8, snap8);                     // 收新快照：位置回权威值、预算重置
  ck('S8 重新收快照后预算复位，能再次外推', NM.extrapolate(mirror8, 0.05, 0) === true);
  const m8b = mkMatch(SEED);
  m8b.players[1].vel.set(4, 0, 0);
  const mirror8b = mkMatch(SEED);
  NM.applySnapshot(mirror8b, wire(NM.makeSnapshot(m8b, 1, null)));
  ck('S8 自定义 budget：0.02s 预算下第 2 次就定住',
     NM.extrapolate(mirror8b, 0.05, 0, 0.02) === true && NM.extrapolate(mirror8b, 0.05, 0, 0.02) === false);
  mirror8.players[0].alive = false;
  ck('S8 死亡玩家不外推', NM.extrapolate(mirror8, 0.05, 0) === false);
}

console.log('');
console.log((bad ? '✗' : '✓') + ' net_sync_check：' + n + ' 条断言，' + bad + ' 红');
process.exit(bad ? 1 : 0);
