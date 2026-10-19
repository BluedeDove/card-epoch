#!/usr/bin/env node
/* tools/net_spike_server.cjs · NET-spike 零依赖 WebSocket 服务端（只有 node 内置模块）
   职责只有四个：房间码配对、原样转发指令帧、协议级心跳（ping/pong）、应用级 ping 回包。
   这不是游戏服务端——一行游戏逻辑都不许进（NET-spike 只回答"file:// 能不能连 / 延迟多少 / 断线多快发现"）。
   输出：stdout 首行 "PORT <n>"，之后全部事件带 [+ms] 时间戳，供驱动脚本对表。 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const t0 = Date.now();
function log(...a) { console.log('[+' + (Date.now() - t0) + 'ms]', ...a); }

const rooms = new Map();          // code -> [client, client]
let nextId = 1;

function acceptKey(key) { return crypto.createHash('sha1').update(key + GUID).digest('base64'); }

/* ---- 帧编解码（RFC6455；客户端→服务端必带掩码，服务端→客户端不掩） ---- */
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
        payload = Buffer.from(payload);                       // copy before XOR
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.slice(off + maskLen + len);
      onFrame(op, payload);
    }
  };
}

const srv = http.createServer((req, rsp) => { rsp.writeHead(426); rsp.end('websocket only\\n'); });
srv.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { id: nextId++, socket, room: null, side: -1, paired: false, lastSeen: Date.now(), dead: false };
  log('connect id=' + c.id, req.socket.remoteAddress, req.headers.origin ? ('origin=' + req.headers.origin) : 'origin=(none)');
  function send(op, s) { if (!c.dead) try { socket.write(encodeFrame(op, Buffer.from(s))); } catch (e) {} }
  c.sendText = (obj) => send(0x1, typeof obj === 'string' ? obj : JSON.stringify(obj));
  socket.on('data', makeParser((op, payload) => {
    c.lastSeen = Date.now();
    if (op === 0x8) { log('close-frame id=' + c.id); cleanup(c, 'close-frame'); return; }
    if (op === 0x9) { send(0xA, payload); return; }            // ping → pong（协议级，理论用不到：服务端是发 ping 的那方）
    if (op === 0xA) { c.lastPong = Date.now(); return; }       // 心跳回包
    if (op !== 0x1 && op !== 0x2) return;
    let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
    if (msg.type === 'join') {
      c.room = String(msg.room || '').slice(0, 24);
      let room = rooms.get(c.room);
      if (!room) { room = []; rooms.set(c.room, room); }
      if (room.length >= 2) { c.sendText({ type: 'full' }); log('room-full id=' + c.id + ' room=' + c.room); return; }
      c.side = room.length; room.push(c);
      log('join id=' + c.id + ' room=' + c.room + ' side=' + c.side);
      if (room.length === 2) {
        room.forEach((k, i) => { k.paired = true; k.sendText({ type: 'paired', side: i, room: c.room }); });
        log('paired room=' + c.room);
      }
      return;
    }
    if (msg.type === 'aping') { c.sendText({ type: 'apong', id: msg.id, t0: msg.t0, st: Date.now() }); return; }
    /* 其余帧（input / echo）原样转发给对端——服务端不解语义 */
    const room = rooms.get(c.room);
    if (c.paired && room && room.length === 2) {
      const peer = room[1 - c.side];
      if (peer && !peer.dead) peer.sendText(payload.toString('utf8'));
    }
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
  const room = rooms.get(c.room);
  if (room) {
    const peer = room[1 - c.side];
    if (peer && !peer.dead) peer.sendText({ type: 'peer-gone', reason: why });
    rooms.delete(c.room);
  }
  try { c.socket.destroy(); } catch (e) {}
}
/* 半开连接扫描：任何帧（含 pong）超过 2000ms 没到就判死 */
setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => room.forEach(c => { if (!c.dead && now - c.lastSeen > 2000) { log('half-open-timeout id=' + c.id + ' silent=' + (now - c.lastSeen) + 'ms'); cleanup(c, 'half-open-timeout'); } }));
}, 250);

srv.listen(0, '127.0.0.1', () => { console.log('PORT ' + srv.address().port); });
