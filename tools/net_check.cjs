#!/usr/bin/env node
/* tools/net_check.cjs · NET-N2 传输层回归（任务书 NET-N2 验收逐条；N5 把版本闸抬到 v4）
   G1 六帧型往返 + 版本闸（不符显式 bye want/got 并断开，不许静默错配；want 就是 PROTO_VER=4）
   G2 serializeFor 不泄漏手牌（递归扫 guest 收到的对象；已知不同手牌做正例，空手牌假绿免疫）
   G3 seq 乱序/重复/迟到帧的确定行为（同一次出牌绝不消费两遍）
   G4 断线检测：FIN 秒级判死；应用心跳缺席 ~1s 判 stalled（协议 pong 照样回也要被抓到）
   用法：node tools/net_check.cjs        退出码非 0 = 有红。 */
'use strict';
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const HOST = require('./net_host.cjs');
global.window = {};
require(path.join('..', 'src/net-ws.js'));
const NW = global.window.GW.NetWs;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ← ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 最小 node ws 客户端（客户端帧必须带掩码，RFC6455） ---------- */
function wsClient(port) {
  const c = { msgs: [], byType: {}, closed: false, sock: null, port };
  c.send = function (obj) {
    const payload = Buffer.from(JSON.stringify(obj));
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x81, 0x80 | len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
    c.sock.write(Buffer.concat([head, mask, masked]));
  };
  c.waitType = async function (type, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 3000)) {
      const hit = c.msgs.find(m => m.type === type);
      if (hit) return hit;
      await sleep(25);
    }
    return null;
  };
  return c;
}
function wsConnect(c) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(c.port, '127.0.0.1', () => {
      sock.write('GET / HTTP/1.1' + String.fromCharCode(13, 10) + 'Host: 127.0.0.1' + String.fromCharCode(13, 10) +
        'Upgrade: websocket' + String.fromCharCode(13, 10) + 'Connection: Upgrade' + String.fromCharCode(13, 10) +
        'Sec-WebSocket-Key: ' + key + String.fromCharCode(13, 10) + 'Sec-WebSocket-Version: 13' + String.fromCharCode(13, 10, 13, 10));
    });
    c.sock = sock;
    let upgraded = false, headBuf = Buffer.alloc(0);
    const parse = HOST.makeParser((op, payload) => {
      if (op === 0x9) { /* 协议 ping：回 pong（模拟"协议活着"） */
        const mask = crypto.randomBytes(4), pl = Buffer.from(payload);
        for (let i = 0; i < pl.length; i++) pl[i] ^= mask[i & 3];
        const head = Buffer.from([0x8A, 0x80 | pl.length]);
        sock.write(Buffer.concat([head, mask, pl]));
        return;
      }
      if (op === 0x8) { c.closed = true; return; }
      if (op !== 0x1) return;
      let m; try { m = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
      c.msgs.push(m); (c.byType[m.type] = c.byType[m.type] || []).push(m);
    });
    sock.on('data', chunk => {
      if (!upgraded) {
        headBuf = Buffer.concat([headBuf, chunk]);
        const sep = headBuf.indexOf(String.fromCharCode(13, 10, 13, 10));
        if (sep < 0) return;
        upgraded = true;
        parse(headBuf.slice(sep + 4));
      } else parse(chunk);
    });
    sock.on('close', () => { c.closed = true; });
    sock.on('error', () => {});
    const iv = setInterval(() => { if (upgraded) { clearInterval(iv); resolve(c); } }, 25);
    setTimeout(() => reject(new Error('upgrade timeout')), 3000);
  });
}

(async () => {
  const srv = HOST.serve();
  const srvLog = [];
  const origLog = console.log;
  console.log = (...a) => { srvLog.push(a.join(' ')); origLog(...a); };
  const port = await new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
  console.log('── G1 六帧型往返 + 版本闸（port ' + port + '）');

  /* hello 双席 + joined + peer-joined */
  const ch = await wsConnect(wsClient(port)), cg = await wsConnect(wsClient(port));
  ch.send({ type: 'hello', ver: 4, name: 'H', side: 'host', room: 'R1', seed: 490706 });
  const joinedH = await ch.waitType('joined');
  ok('host 席 hello → joined（side=0, seed=490706）', joinedH && joinedH.side === 0 && joinedH.seed === 490706, joinedH && JSON.stringify(joinedH));
  cg.send({ type: 'hello', ver: 4, name: 'G', side: 'guest', room: 'R1' });
  const joinedG = await cg.waitType('joined');
  ok('guest 席 hello → joined（side=1, 同 seed）', joinedG && joinedG.side === 1 && joinedG.seed === 490706, joinedG && JSON.stringify(joinedG));
  const peerJoined = await ch.waitType('peer-joined');
  ok('配对成功：host 席收到 peer-joined(role=guest)', peerJoined && peerJoined.role === 'guest');

  /* input guest→host 原样到 */
  cg.send({ type: 'input', tick: 42, keys: { fwd: 1 }, play: { index: 2 }, aim: { x: 1, y: 2, z: 3 } });
  const gotInput = await ch.waitType('input');
  ok('input(guest→host) 原样到达（tick/keys/play/aim 不丢字段）',
    gotInput && gotInput.tick === 42 && gotInput.keys && gotInput.keys.fwd === 1 && gotInput.play && gotInput.play.index === 2 && gotInput.aim && gotInput.aim.z === 3,
    gotInput && JSON.stringify(gotInput));
  /* snapshot/event host→guest 原样到 */
  ch.send({ type: 'snapshot', tick: 42, world: [[1, 2, 3, 14]], view: { fake: 1 } });
  ch.send({ type: 'event', kind: 'explode', pos: { x: 1, y: 2, z: 3 } });
  const gotSnap = await cg.waitType('snapshot'), gotEv = await cg.waitType('event');
  ok('snapshot(host→guest) 原样到达', gotSnap && gotSnap.tick === 42 && gotSnap.world && gotSnap.world.length === 1);
  ok('event(host→guest) 原样到达', gotEv && gotEv.kind === 'explode');
  /* bye 中继 + 掉线原因 */
  cg.send({ type: 'bye', reason: 'client-bye' });
  const byeRelay = await ch.waitType('bye');
  ok('bye 原样中继（reason 保留）', byeRelay && byeRelay.reason === 'client-bye');
  cg.sock.destroy();
  let guestGone = [];
  for (let i = 0; i < 120 && !guestGone.includes('guest-gone'); i++) {
    guestGone = ch.msgs.filter(m => m.type === 'bye').map(m => m.reason);
    if (guestGone.includes('guest-gone')) break;
    await sleep(25);
  }
  ok('guest 断开后 host 收到 bye reason=guest-gone', guestGone.includes('guest-gone'), JSON.stringify(guestGone));

  /* 版本闸：ver 不符必须显式拒绝给原因 */
  const cBad = await wsConnect(wsClient(port));
  cBad.send({ type: 'hello', ver: 999, name: 'X', side: 'guest', room: 'R2' });
  const byeBad = await cBad.waitType('bye', 2000);
  ok('版本不符 → bye reason=version-mismatch 且带 want/got（不许静默错配）',
    byeBad && byeBad.reason === 'version-mismatch' && byeBad.want === 4 && byeBad.got === 999,
    byeBad && JSON.stringify(byeBad));
  await sleep(150);
  ok('版本拒绝后连接被断开', cBad.closed === true);
  /* 版本拒绝后不许占用席位：同房 guest 仍能进 */
  const cOk = await wsConnect(wsClient(port));
  const ch2 = await wsConnect(wsClient(port));
  ch2.send({ type: 'hello', ver: 4, name: 'H2', side: 'host', room: 'R2', seed: 1 });
  await ch2.waitType('joined');
  cOk.send({ type: 'hello', ver: 4, name: 'G2', side: 'guest', room: 'R2' });
  ok('版本不符者不占席位，后续 hello 正常配对', !!(await cOk.waitType('joined')));
  ch2.sock.destroy(); cOk.sock.destroy();

  console.log('── G2 serializeFor 不泄漏手牌（正例：两边已知不同手牌）');
  const view = {
    time: 12.5, tick: 250,
    players: [
      { side: 0, name: 'P1', pos: { x: 1, y: 2, z: 3 }, vel: { x: 0, y: 0, z: 0 }, hp: 80, maxHp: 100, shield: 5, alive: true, score: 30, mana: 6, mats: 9, kills: 2,
        hand: ['wall2', 'heal'], deck: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'], discard: ['dig3'], pendingPick: ['bloom'] },
      { side: 1, name: 'P2', pos: { x: 4, y: 5, z: 6 }, vel: { x: 1, y: 0, z: 0 }, hp: 65, maxHp: 100, shield: 0, alive: true, score: 22, mana: 3, mats: 4, kills: 1,
        hand: ['icewall', 'golem'], deck: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'], discard: ['dig'], pendingPick: ['void_lance'] }
    ],
    projectiles: [{ pos: { x: 1, y: 2, z: 3 }, vel: { x: 0, y: 0, z: 1 }, kind: 'bolt', side: 0, ttl: 1 }],
    summons: [{ side: 0, pos: { x: 2, y: 2, z: 2 }, vel: { x: 0, y: 0, z: 0 }, hp: 40, maxHp: 40, alive: true }],
    lodes: [{ x: 10, y: 15, z: 20, owner: 0, holdSec: [3, 1], producedScore: [1, 0] }]
  };
  const out1 = JSON.stringify(NW.serializeFor(view, 1));
  const out0 = JSON.stringify(NW.serializeFor(view, 0));
  const f1 = NW.serializeFor(view, 1);
  ok('viewer=1 看不到对方手牌 wall2/heal（递归全帧扫；projectile 的 kind=bolt 是允许字段不算泄漏）',
    !/wall2|heal/.test(out1), '泄漏: ' + (out1.match(/wall2|heal/) || [])[0]);
  ok('viewer=1 看不到对方 pendingPick 候选 bloom', !/bloom/.test(out1));
  ok('viewer=1 能看到自己手牌 icewall/golem（正例：证明不是"全空假绿"）', /icewall/.test(out1) && /golem/.test(out1));
  ok('viewer=0 看不到对方手牌 icewall/golem 与候选 void_lance', !/icewall|golem|void_lance/.test(out0));
  ok('viewer=0 能看到自己手牌 wall2/heal（对称正例）', /wall2/.test(out0) && /heal/.test(out0));
  ok('手牌张数双方可见（handCount=2）', f1.players.every(p => p.handCount === 2));
  ok('牌库只给张数不给顺序（无 a1..a10/b1..b8 任一项）', !/a10|b8/.test(out1) && f1.players.every(p => typeof p.deckCount === 'number' && p.deck === undefined),
    'deck=' + JSON.stringify(f1.players.map(p => p.deck)));
  ok('允许字段齐：hp/坐标/存活/分数/矿归属/抛射物/随从/弃牌堆',
    f1.players[0].hp === 80 && f1.players[1].pos.x === 4 && f1.players[1].alive === true && f1.players[0].score === 30 &&
    f1.lodes[0].owner === 0 && f1.projectiles.length === 1 && f1.summons.length === 1 && f1.players[0].discard[0] === 'dig3');

  console.log('── G3 seq 乱序/重复/迟到的确定行为');
  const chn = new NW.SeqChan();
  const feed = [1, 2, 2, 4, 3, 5, 1];
  const accepted = [];
  feed.forEach(s => { if (chn.seen('x', s)) accepted.push(s); });
  ok('重复帧(2 与 1 的第二次) 全部丢弃；乱序(4后3)与迟到(5后1) 各接受一次：接受=[1,2,4,3,5]',
    JSON.stringify(accepted) === JSON.stringify([1, 2, 4, 3, 5]) && chn.dropped === 2,
    'accepted=' + JSON.stringify(accepted) + ' dropped=' + chn.dropped);
  ok('乱序(seq 12 后到 11) 各接受一次（消费方按 tick 自排序）',
    (() => { const c2 = new NW.SeqChan(); return c2.seen('x', 12) && c2.seen('x', 11); })());
  const chn2 = new NW.SeqChan();
  ok('重连换纪元后旧 seq 不误判重复', chn2.seen('x', 9) && chn2.seen('y', 1));
  /* 同一次出牌绝不消费两遍 */
  const hand = ['a', 'b', 'c', 'd'];
  const chan3 = new NW.SeqChan();
  let consumed = 0;
  function deliver(seq) {
    if (!chan3.seen('c', seq)) return;
    consumed++; hand.splice(2, 1);                       // 消费 play.index=2
  }
  deliver(10); deliver(10); deliver(10);
  ok('同一 input(seq=10) 投递三次，出牌只消费一次', consumed === 1 && hand.length === 3,
    'consumed=' + consumed + ' hand=' + JSON.stringify(hand));

  console.log('── G3b 重连退避（桩 WebSocket 必失败：状态机与 0.5s→8s 退避序列）');
  {
    const states = [];
    const RealWS = global.WebSocket;                 /* node ≥21 自带 WebSocket——stub 必须盖住全局而非 window */
    let ctorCalls = 0;
    function FakeWS() { ctorCalls++; throw new Error('connect refused'); }
    global.WebSocket = FakeWS;
    const conn = new NW.Connection({ url: 'ws://127.0.0.1:1', room: 'X', side: 'guest', name: 'T', onState: s => states.push(s) });
    await sleep(1300);
    conn.close();
    const retries = states.filter(s => s.startsWith('retry-in-'));
    ok('连接失败进入 connecting → retry-in-500 退避链（500 起步）',
      states[0] === 'connecting' && retries[0] === 'retry-in-500',
      JSON.stringify(states.slice(0, 4)));
    ok('退避翻倍 500→1000（实测序列 ' + retries.join(',') + '）且 ctor 反复重试（' + ctorCalls + ' 次）',
      retries.length >= 2 && retries[0] === 'retry-in-500' && retries[1] === 'retry-in-1000' && ctorCalls >= 2,
      'states=' + JSON.stringify(states) + ' ctorCalls=' + ctorCalls);
    global.WebSocket = RealWS;
  }

  console.log('── G4 断线检测');
  /* FIN/RST 秒级判死 */
  const cK = await wsConnect(wsClient(port));
  cK.send({ type: 'hello', ver: 4, name: 'K', side: 'host', room: 'R3', seed: 7 });
  await cK.waitType('joined');
  const tKill = Date.now();
  cK.sock.destroy();
  let deadMs = -1;
  for (let i = 0; i < 80; i++) {
    if (srvLog.some(l => /dead id=\d+ reason=tcp-(close|error|silence)/.test(l))) { deadMs = Date.now() - tKill; break; }
    await sleep(25);
  }
  ok('socket 强杀后服务端 2s 内判死（实测 ' + deadMs + 'ms）', deadMs >= 0 && deadMs < 2000, 'deadMs=' + deadMs);
  /* 应用心跳缺席 ≈1s 判 stalled：协议 pong 照样回也要被抓到（renderer 冻结等价态） */
  const cS = await wsConnect(wsClient(port)), cW = await wsConnect(wsClient(port));
  cS.send({ type: 'hello', ver: 4, name: 'S', side: 'host', room: 'R4', seed: 8 });
  cW.send({ type: 'hello', ver: 4, name: 'W', side: 'guest', room: 'R4' });
  await cS.waitType('joined'); await cW.waitType('joined');
  const t0 = Date.now();
  let hbIv = setInterval(() => { if (tHbOn) cS.send({ type: 'hb', tick: 1, frame: 1 }); }, 100);
  var tHbOn = true;
  await sleep(600);                                        // 先发 600ms 心跳证明"活着不判"
  ok('正常发 hb 时不被误判 stalled', !srvLog.some(l => /stalled/.test(l)), '早期误判: ' + srvLog.filter(l => /stalled/.test(l))[0]);
  tHbOn = false;                                           // 停应用心跳（协议 pong 由 wsClient 自动回——"协议活着应用死"）
  const tStall = Date.now();
  let stallMs = -1, timeoutMsg = null;
  for (let i = 0; i < 100; i++) {
    if (!timeoutMsg) timeoutMsg = cW.msgs.find(m => m.type === 'timeout' && m.reason === 'peer-stalled');
    if (srvLog.some(l => /stalled id=/.test(l))) { stallMs = Date.now() - tStall; }
    if (stallMs >= 0 && timeoutMsg) break;
    await sleep(25);
  }
  ok('应用心跳缺席后 ~1s 判 stalled（实测 ' + stallMs + 'ms，阈值 1000ms）', stallMs >= 800 && stallMs < 2500, 'stallMs=' + stallMs);
  ok('对端收到 timeout reason=peer-stalled（带 lastTick/lastFrame）', !!timeoutMsg, timeoutMsg && JSON.stringify(timeoutMsg));
  tHbOn = true;                                            // 恢复心跳 → unstall
  await sleep(700);
  ok('心跳恢复后 unstall', srvLog.some(l => /unstall/.test(l)));
  clearInterval(hbIv);
  cS.sock.destroy(); cW.sock.destroy();

  srv.close();
  console.log((fail ? '✗' : '✓') + ' net_check ' + pass + ' 绿 / ' + fail + ' 红');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CHECK-FAIL', e); process.exit(1); });
