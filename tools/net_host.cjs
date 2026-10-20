#!/usr/bin/env node
/* tools/net_host.cjs · 联机传输层·正式服务端（NET-N2；从 NET-spike 演化）
   依赖：零（node 内置 http/crypto）。只回答这一个问题：房间怎么配、帧怎么转、谁还活着。
   职责：零依赖手写 RFC6455、hello 版本闸（不符显式 bye 给 want/got，不许静默错配）、
   房间码配对（host/guest 两席）、按角色转发（input / draftPick / draftSkip / loadout→host 席，
   snapshot / event / lobby / start→guest 席；未知帧型只 log 不透传。战前选牌那三条帧型的口径见 docs/NET.md §10）、
   双道心跳——协议层 ping/pong（500ms）+ **应用层心跳**：页面每 250ms 自报 {tick,frame}，
   超时即判"画面卡死"而不只是"连接活着"（NET-spike 实测坑：Chromium 的协议 pong 由 network
   进程应答，renderer 冻结时照样回——只信协议 pong 等于放跑僵死的页面）。
   这不是权威对局端：Match 在房主页面里（N2/N3 已接），本进程只做配对/转发/心跳——
   连 config（地图 / 规则 / 玩法 game）也只原样转存，不校验关卡 id 与牌库（校验归房主页面：
   关卡归 level_check，双方牌库归 src/net-loadout.js 的 validateDeck，见 NET.md §10）。 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PROTO_VER = 4;                 /* NET.md §5 + §10 冻结（v4 = N5 战前选牌：loadout / lobby / start）；与 src/net-ws.js 同改，不符显式拒绝 */
const HB_EVERY_MS = 250;             /* 应用层心跳期望间隔（页面自报 {tick,frame}） */
const APP_STALL_MS = 1000;           /* 应用心跳缺席多久判"画面卡死" */
const TCP_DEAD_MS = 2000;            /* 协议层静默多久判死（上轮实测 RST 5–80ms 就能到） */
const t0 = Date.now();
function log(...a) { console.log('[+' + (Date.now() - t0) + 'ms]', ...a); }

function acceptKey(key) { return crypto.createHash('sha1').update(key + GUID).digest('base64'); }
function encodeFrame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
function makeParser(onFrame) {
  let buf = Buffer.alloc(0);
  return function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      let payload = buf.slice(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = buf.slice(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.slice(off + maskLen + len);
      onFrame(op, payload);
    }
  };
}

const rooms = new Map();   // code -> { host: c|null, guest: c|null }
let nextId = 1;
function peerOf(c) {
  const room = rooms.get(c.room);
  if (!room) return null;
  return c.role === 'host' ? room.guest : room.host;
}
function byeTo(c, reason, extra) {
  const msg = Object.assign({ type: 'bye', reason }, extra || {});
  c.sendText(msg);
  log('bye id=' + c.id + ' reason=' + reason + (extra ? ' ' + JSON.stringify(extra) : ''));
}

function serve(opts) {
  opts = opts || {};
  const srv = http.createServer((req, rsp) => { rsp.writeHead(426); rsp.end('websocket only' + String.fromCharCode(10)); });
  srv.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    socket.write('HTTP/1.1 101 Switching Protocols' + String.fromCharCode(13, 10) + 'Upgrade: websocket' + String.fromCharCode(13, 10) +
      'Connection: Upgrade' + String.fromCharCode(13, 10) + 'Sec-WebSocket-Accept: ' + acceptKey(key) + String.fromCharCode(13, 10, 13, 10));
    socket.setNoDelay(true);
    const c = { id: nextId++, socket, room: null, role: null, name: '', helloOk: false,
                lastSeen: Date.now(), lastHb: 0, lastHbTick: null, lastHbFrame: null, stalled: false, dead: false };
    log('connect id=' + c.id + ' origin=' + (req.headers.origin || '(none)'));
    function send(op, s) { if (!c.dead) try { socket.write(encodeFrame(op, Buffer.from(s))); } catch (e) {} }
    c.sendText = (obj) => send(0x1, typeof obj === 'string' ? obj : JSON.stringify(obj));
    socket.on('data', makeParser((op, payload) => {
      c.lastSeen = Date.now();
      if (op === 0x8) { cleanup(c, 'close-frame'); return; }
      if (op === 0x9) { send(0xA, payload); return; }
      if (op === 0xA) { return; }                                  // 协议 pong：只刷新 lastSeen（见头注的坑）
      if (op !== 0x1 && op !== 0x2) return;
      let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
      if (msg.type === 'hello') {
        /* 版本闸：不符显式 bye 给 want/got 并断开——静默错配会让两端各说各话一整局 */
        if (msg.ver !== PROTO_VER) {
          byeTo(c, 'version-mismatch', { want: PROTO_VER, got: (msg.ver === undefined ? null : msg.ver) });
          cleanup(c, 'version-mismatch');
          return;
        }
        const role = msg.side === 0 || msg.side === 'host' ? 'host' : 'guest';
        const code = String(msg.room || msg.name || '').slice(0, 24) || 'default';
        let room = rooms.get(code);
        if (!room) { room = { host: null, guest: null }; rooms.set(code, room); }
        if (room[role]) { byeTo(c, role + '-taken'); cleanup(c, role + '-taken'); return; }
        if (role === 'guest' && !room.host) { byeTo(c, 'no-host'); cleanup(c, 'no-host'); return; }
        c.room = code; c.role = role; c.name = String(msg.name || '').slice(0, 24); c.helloOk = true;
        room[role] = c;
        const seed = msg.seed !== undefined ? (msg.seed >>> 0) : crypto.randomBytes(4).readUInt32BE(0);
        room.seed = room.seed === undefined ? seed : room.seed;
        /* v3：房主的 hello 可带 config（{map:{id}, rule}，docs/NET.md §9.5）；v4 起多一项 game
           （{id, target}，docs/MODES.md §6）——本进程不认识玩法也不认识关卡，
           只原样存进房间并在**两边**的 joined 里回同一份（guest 靠它建与房主同一张图，
           房主自己的 joined 也带回，省得页面以为「我点的图就是开局用的图」）。
           第一个 hello 说了算：guest 后到，不许拿自己的 config 覆盖房主的。 */
        if (room.config === undefined && msg.config && typeof msg.config === 'object') room.config = msg.config;
        log('hello id=' + c.id + ' role=' + role + ' room=' + code + ' ver=' + msg.ver +
            (room.config ? ' map=' + JSON.stringify((room.config && room.config.map) || null) + ' rule=' + (room.config && room.config.rule) : ''));
        c.sendText({ type: 'joined', side: role === 'host' ? 0 : 1, seed: room.seed, rulesOpts: room.config || {}, room: code });
        const peer = peerOf(c);
        if (peer && !peer.dead) peer.sendText({ type: 'peer-joined', role });
        if (room.host && room.guest) log('paired room=' + code + ' seed=' + room.seed);
        return;
      }
      if (!c.helloOk) { byeTo(c, 'hello-required'); cleanup(c, 'hello-required'); return; }
      if (msg.type === 'hb') {
        /* 应用层心跳：页面自报 {tick,frame}——renderer 冻结时它停（协议 pong 那时照样回，见头注） */
        c.lastHb = Date.now(); c.lastHbTick = msg.tick; c.lastHbFrame = msg.frame;
        if (c.stalled) { c.stalled = false; log('unstall id=' + c.id); const p = peerOf(c); if (p && !p.dead) p.sendText({ type: 'peer-unstall' }); }
        return;
      }
      /* 角色路由：input / draftPick / draftSkip / **loadout** 只去 host 席（guest 不是权威，这四条都是「请求」——
         loadout 交的是 guest 自己选的牌库，能不能开局由房主判，见 NET.md §10）；
         snapshot / event / **lobby** / **start** 只去 guest 席（后两条是房主对局前的两次通知：
         谁就绪了 / 可以开局了）；其余类型一律不透传——未知帧型只 log，不代跑 */
      const peer = peerOf(c);
      if (!peer || peer.dead) return;
      if ((msg.type === 'input' || msg.type === 'draftPick' || msg.type === 'draftSkip' || msg.type === 'loadout') && c.role === 'guest') { peer.sendText(payload.toString('utf8')); return; }
      if ((msg.type === 'snapshot' || msg.type === 'event' || msg.type === 'lobby' || msg.type === 'start') && c.role === 'host') { peer.sendText(payload.toString('utf8')); return; }
      if (msg.type === 'bye') { peer.sendText(payload.toString('utf8')); log('bye-relay id=' + c.id + ' reason=' + (msg.reason || '(none)')); return; }
      log('drop id=' + c.id + ' type=' + msg.type + ' role=' + c.role + '（角色路由不允许的帧型）');
    }));
    socket.on('close', () => cleanup(c, 'tcp-close'));
    socket.on('error', (e) => { log('tcp-error id=' + c.id + ' ' + e.code); cleanup(c, 'tcp-error'); });
    c.hb = setInterval(() => { if (!c.dead) try { socket.write(encodeFrame(0x9, Buffer.from('hb'))); } catch (e) {} }, 500);
  });
  function cleanup(c, why) {
    if (c.dead) return;
    c.dead = true;
    clearInterval(c.hb);
    log('dead id=' + c.id + ' reason=' + why + (c.room ? ' room=' + c.room : ''));
    const peer = peerOf(c);
    if (peer && !peer.dead) peer.sendText({ type: 'bye', reason: c.role === 'host' ? 'host-gone' : 'guest-gone', via: why });
    if (c.room) {
      const room = rooms.get(c.room);
      if (room) {
        if (room.host === c) room.host = null;
        if (room.guest === c) room.guest = null;
        if (!room.host && !room.guest) rooms.delete(c.room);
      }
    }
    try { c.socket.destroy(); } catch (e) {}
  }
  /* 双道心跳扫描：应用层 stall（页面僵死）与协议层 dead（连接死）分开判 */
  const sweep = setInterval(() => {
    const now = Date.now();
    rooms.forEach(room => ['host', 'guest'].forEach(role => {
      const c = room[role];
      if (!c || c.dead || !c.helloOk) return;
      if (c.lastHb && !c.stalled && now - c.lastHb > APP_STALL_MS) {
        c.stalled = true;
        log('stalled id=' + c.id + ' role=' + role + ' silent=' + (now - c.lastHb) + 'ms lastTick=' + c.lastHbTick + ' lastFrame=' + c.lastHbFrame);
        const p = peerOf(c);
        if (p && !p.dead) p.sendText({ type: 'timeout', reason: 'peer-stalled', lastTick: c.lastHbTick, lastFrame: c.lastHbFrame });
      }
      if (now - c.lastSeen > TCP_DEAD_MS) cleanup(c, 'tcp-silence');
    }));
  }, 250);
  srv.on('close', () => clearInterval(sweep));
  return srv;
}

if (require.main === module) {
  const port = process.argv[2] ? parseInt(process.argv[2], 10) : 0;
  const srv = serve();
  srv.listen(port, '0.0.0.0', () => console.log('PORT ' + srv.address().port + ' ver=' + PROTO_VER + ' hb=' + HB_EVERY_MS + 'ms stall=' + APP_STALL_MS + 'ms dead=' + TCP_DEAD_MS + 'ms'));
}
module.exports = { serve, PROTO_VER, encodeFrame, makeParser };
