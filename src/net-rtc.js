/* src/net-rtc.js · 浏览器内置联机（WebRTC + 手动邀请码）
   =================================================
   目标：同一个网页既能当房主，也能当加入者；不需要 node tools/net_host.cjs。
   信令不依赖外部服务器：房主把 offer 邀请码发给对手，对手回 answer 邀请码，房主确认。
   （同一浏览器两个标签页也可以走 BroadcastChannel 自动交换，见 host/join 的 bc 参数。）
   传输层只做字节通道，协议仍是 src/net-ws.js 的 Connection/SeqChan 与 main.js 的 onNetFrame；
   房主页内跑一个「Relay」模拟原 net_host 的服务端转发：hello/joined/peer-joined + 四类帧路由。
   限制：无 TURN/STUN；默认 ICE 只带主机候选，适合同一局域网/同一台机器；跨 NAT 需自备 TURN。
   零 DOM / 零玩家可见中文（错误只报 key）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var VERSION = (G.NetWs && G.NetWs.PROTO_VER) || 4;

  function parse(s) { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- 字节端点：给 Connection 用的 WebSocket 形状 ---------- */
  function DataEndpoint(ch) {
    this.ch = ch; this.readyState = ch.readyState === 'open' ? 1 : 0;
    this.onopen = null; this.onmessage = null; this.onclose = null;
    var self = this;
    ch.onopen = function () { self.readyState = 1; if (self.onopen) self.onopen(); };
    ch.onmessage = function (ev) { if (self.onmessage) self.onmessage({ data: ev.data }); };
    ch.onclose = function () { self.readyState = 3; if (self.onclose) self.onclose(); };
    if (this.readyState === 1) setTimeout(function () { if (self.onopen) self.onopen(); }, 0);
  }
  DataEndpoint.prototype.send = function (s) { if (this.readyState === 1) { this.ch.send(s); return true; } return false; };
  DataEndpoint.prototype.close = function () { try { this.ch.close(); } catch (e) { } };

  /* 房主的本地端点：Connection 以为自己在连服务器，实际把帧交给房内 Relay。 */
  function LoopEndpoint(relay) {
    this.relay = relay; this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onclose = null;
    var self = this;
    setTimeout(function () { self.readyState = 1; if (self.onopen) self.onopen(); }, 0);
  }
  LoopEndpoint.prototype.send = function (s) { var m = parse(s); if (m && this.relay) this.relay.fromHost(m); return true; };
  LoopEndpoint.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose(); };

  /* ---------- 房内 Relay：模拟 net_host 的转发与握手 ---------- */
  function Relay(opts) {
    this.room = opts.room || 'ROOM';
    this.seed = opts.seed == null ? 0 : opts.seed;
    this.config = opts.config || {};
    this.hostEp = null; this.guestEp = opts.guest || null;
    this.hostHello = false; this.guestHello = false;
    var self = this;
    if (this.guestEp) this.guestEp.onmessage = function (ev) { self.fromGuest(parse(ev.data)); };
  }
  /* hostEp 是本地回环：投递给房主 Connection 的 onmessage。
     guestEp 是 DataChannel：要真的 send 到对面，不能调用它自己的 onmessage（那是收帧口）。 */
  Relay.prototype.toHost = function (msg) {
    if (this.hostEp && this.hostEp.onmessage) this.hostEp.onmessage({ data: JSON.stringify(msg) });
  };
  Relay.prototype.toGuest = function (msg) {
    if (this.guestEp && this.guestEp.readyState === 1) this.guestEp.send(JSON.stringify(msg));
    else {
      this._q = this._q || [];
      this._q.push(msg);
      if (this._q.length > 200) this._q.shift();
    }
  };
  Relay.prototype.flush = function () {
    if (!this._q || !this.guestEp || this.guestEp.readyState !== 1) return;
    while (this._q.length) this.guestEp.send(JSON.stringify(this._q.shift()));
  };
  Relay.prototype.joined = function (side) {
    return { type: 'joined', side: side, seed: this.seed, rulesOpts: this.config, room: this.room };
  };
  Relay.prototype.bye = function (ep, reason) {
    if (ep === this.guestEp) { this.toGuest({ type: 'bye', reason: reason || 'bye' }); try { ep && ep.close && ep.close(); } catch (e) { } return; }
    this.toHost({ type: 'bye', reason: reason || 'bye' });
    try { ep && ep.close && ep.close(); } catch (e) { }
  };
  Relay.prototype.fromHost = function (msg) {
    if (!msg) return;
    if (msg.type === 'hello') {
      if (String(msg.room || '') !== this.room) { this.bye(this.hostEp, 'room-mismatch'); return; }
      if (Number(msg.ver) !== VERSION) { this.bye(this.hostEp, 'version-mismatch'); return; }
      this.hostHello = true;
      this.toHost(this.joined(0));
      if (this.guestHello) this.toHost({ type: 'peer-joined', role: 'guest' });
      return;
    }
    if (!this.hostHello) return;
    if (msg.type === 'hb') return;
    if (msg.type === 'bye') { this.bye(this.guestEp, msg.reason || 'host-bye'); return; }
    if (msg.type === 'snapshot' || msg.type === 'event' || msg.type === 'lobby' || msg.type === 'start') {
      this.toGuest(msg);
    }
  };
  Relay.prototype.fromGuest = function (msg) {
    if (!msg) return;
    if (msg.type === 'hello') {
      if (String(msg.room || '') !== this.room) { this.bye(this.guestEp, 'room-mismatch'); return; }
      if (Number(msg.ver) !== VERSION) { this.bye(this.guestEp, 'version-mismatch'); return; }
      this.guestHello = true;
      this.toGuest(this.joined(1));
      this.toHost({ type: 'peer-joined', role: 'guest' });
      return;
    }
    if (!this.guestHello) return;
    if (msg.type === 'hb') return;
    if (msg.type === 'bye') { this.bye(this.hostEp, msg.reason || 'guest-bye'); return; }
    if (msg.type === 'input' || msg.type === 'draftPick' || msg.type === 'draftSkip' || msg.type === 'loadout') {
      this.toHost(msg);
    }
  };

  /* ---------- WebRTC 基础 ---------- */
  function waitIce(pc) {
    if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; try { pc.removeEventListener('icegatheringstatechange', check); } catch (e) { } resolve(); }
      function check() { if (pc.iceGatheringState === 'complete') finish(); }
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(finish, 1800);
    });
  }
  /* ms=0 表示不按时间判死（guest 要等房主粘回应码）；ICE failed 仍然立刻拒绝。 */
  function waitOpen(dc, pc, ms) {
    if (!dc) return Promise.reject(new Error('no-channel'));
    if (dc.readyState === 'open') return Promise.resolve(dc);
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok() { if (done) return; done = true; cleanup(); resolve(dc); }
      function bad(err) { if (done) return; done = true; cleanup(); reject(new Error(err || 'channel-closed')); }
      function cleanup() {
        try { dc.removeEventListener('open', ok); dc.removeEventListener('close', bad); } catch (e) { }
        try { pc && pc.removeEventListener('iceconnectionstatechange', ice); } catch (e) { }
        if (timer) { clearTimeout(timer); timer = 0; }
      }
      function ice() {
        var st = pc && (pc.iceConnectionState || pc.connectionState);
        if (st === 'failed') bad('ice-failed');
        else if (st === 'closed') bad('ice-closed');
      }
      var timer = 0;
      dc.addEventListener('open', ok);
      dc.addEventListener('close', bad);
      if (pc) { pc.addEventListener('iceconnectionstatechange', ice); ice(); }
      if (ms) timer = setTimeout(function () { bad('ice-timeout'); }, ms);
      /* 某些浏览器在注册前已经 open，补一次 */
      if (dc.readyState === 'open') ok();
    });
  }
  /* 默认带两个公共 STUN：同机/同局域网仍走 host 候选；跨设备时至少能拿 srflx。
     没有 TURN，对称 NAT 仍然连不上，这一点错误会显式报出来，不再静默等。 */
  function pcOpts() {
    return { iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ] };
  }

  /* 房主：生成本地 offer；返回的 acceptAnswer 完成远端答案；whenOpen 等到 DataChannel。 */
  async function createHost(opts) {
    if (typeof RTCPeerConnection !== 'function') throw new Error('no-webrtc');
    var pc = new RTCPeerConnection(pcOpts());
    var dc = pc.createDataChannel('gw', { ordered: true });
    var guestEp = new DataEndpoint(dc);
    var relay = new Relay({ room: opts.room, seed: opts.seed, config: opts.config, guest: guestEp });
    guestEp.onopen = function () { relay.flush(); };
    var hostEp = new LoopEndpoint(relay); relay.hostEp = hostEp;
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    return {
      pc: pc, dc: dc, relay: relay, hostEndpoint: hostEp, guestEndpoint: guestEp,
      offer: JSON.stringify(pc.localDescription),
      acceptAnswer: async function (text) {
        var d = parse(text); if (!d) throw new Error('bad-answer');
        await pc.setRemoteDescription(d);
        return waitOpen(dc, pc, 12000);
      },
      whenOpen: function () { return waitOpen(dc, pc, 0); },
      close: function () { try { pc.close(); } catch (e) { } }
    };
  }

  /* 加入者：吃房主 offer，返回 answer；whenOpen 等到 DataChannel，endpoint 给 Connection。 */
  async function createGuest(opts) {
    if (typeof RTCPeerConnection !== 'function') throw new Error('no-webrtc');
    var pc = new RTCPeerConnection(pcOpts());
    var dc = null, ep = null;
    var find = new Promise(function (resolve) {
      pc.ondatachannel = function (ev) { dc = ev.channel; ep = new DataEndpoint(dc); resolve(ep); };
    });
    var offer = parse(opts.offer);
    if (!offer) throw new Error('bad-offer');
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return {
      pc: pc, get endpoint() { return ep; }, get dc() { return dc; },
      answer: JSON.stringify(pc.localDescription),
      whenEndpoint: function () { return find; },
      whenOpen: async function () { var e = ep || await find; await waitOpen(dc, pc, 0); return e; },
      close: function () { try { pc.close(); } catch (e) { } }
    };
  }

  /* 同浏览器标签页的自动信令（file:// 可能不可用；不可用就退回手动邀请码）。 */
  function channel(room) {
    try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel('gw-rtc-' + room) : null; } catch (e) { return null; }
  }

  G.NetRTC = {
    VERSION: VERSION,
    createHost: createHost,
    createGuest: createGuest,
    channel: channel,
    Relay: Relay,
    DataEndpoint: DataEndpoint,
    _waitIce: waitIce
  };
})(window.GW);
