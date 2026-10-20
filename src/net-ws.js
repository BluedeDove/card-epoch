/* js/net-ws.js · 联机传输层·客户端（NET-N2；NET.md §5 冻结协议）
   依赖：无（浏览器原生 WebSocket；node 里被 net_check 以 window 垫片加载做单测）。
   只回答这一个问题：一条连接上的帧怎么编解、怎么去重、断了怎么重连。
   纪律：零 DOM、零玩家可见中文（layer_check 拦）；零游戏逻辑——Match 不在这里（N3 才接）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  /* 协议版本（NET.md §5 / §10）。v4 = N5 的战前选牌：在 v3 之上追加三条帧型
     —— loadout（guest→host，{deck,ready}）、lobby（host→guest，{hostReady,guestReady,waiting,reject?}）、
     start（host→guest，{seed,config,decks}）；hello 的 config 多带一项 game（玩法 id / 胜分）。
     v3 = N2 起的联机闭环：hello 可带 config（地图 / 规则）与 seed，joined 回 rulesOpts，
     新增 draftPick / draftSkip 两条 guest→host 帧型。
     **两端同改**：tools/net_host.cjs 的 PROTO_VER 是版本闸的另一半，只改这里会被
     服务端显式 bye reason=version-mismatch（带 want/got）挡在局外，不静默错配。 */
  var PROTO_VER = 4;

  /* ---------- seq 通道：每个 (connId, seq) 恰好交付一次（exactly-once） ----------
     规则（确定行为，写死不许各说各话）：
       见过的 seq 再到的 = 重复帧 → 丢弃——同一次出牌绝不消费两遍；
       没见过的一律接受一次（乱序/迟到也接受：帧里带 tick，先后由消费方按 tick 排，
       通道不替它做决定）；集合超 20000 条时淘汰最旧一半防膨胀。
     重连换纪元（connId 变化）时集合清空，跨纪元绝不误判重复。 */
  function SeqChan() { this.connId = null; this.seenSet = new Set(); this.rx = 0; this.dropped = 0; }
  SeqChan.prototype.seen = function (connId, seq) {
    if (connId !== this.connId) { this.connId = connId; this.seenSet.clear(); }
    if (typeof seq !== 'number' || this.seenSet.has(seq)) { this.dropped++; return false; }
    if (this.seenSet.size > 20000) { let n = 0; for (const v of this.seenSet) { this.seenSet.delete(v); if (++n > 10000) break; } }
    this.seenSet.add(seq); this.rx++; return true;
  };

  /* ---------- 连接：断开/重连（退避 0.5s→8s），应用层心跳 250ms ---------- */
  function Connection(opts) {
    this.url = opts.url; this.room = opts.room; this.side = opts.side; this.name = opts.name || '';
    this.seed = opts.seed;
    this.onFrame = opts.onFrame || function () {};
    this.onState = opts.onState || function () {};
    this.getTick = opts.getTick || function () { return 0; };
    this.ws = null; this.connId = null; this.txSeq = 0; this.chan = new SeqChan();
    this.transportFactory = opts.transportFactory || null;   // 浏览器内 WebRTC/回环传输；缺省仍是 WebSocket
    this.reconnect = opts.reconnect !== false;
    this.backoff = 500; this.closed = false; this.hbIv = null; this.frame = 0;
    this.state = 'new';
    this.connect();
  }
  Connection.prototype.setState = function (s) { this.state = s; this.onState(s); };
  Connection.prototype.connect = function () {
    if (this.closed) return;
    var self = this;
    this.setState('connecting');
    var ws;
    try {
      ws = this.transportFactory ? this.transportFactory(this) : new WebSocket(this.url);
      if (!ws) throw new Error('no transport');
    }
    catch (e) { if (this.reconnect) this.scheduleRetry(); else this.setState('closed'); return; }
    this.ws = ws;
    ws.onopen = function () {
      self.connId = 'c' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      self.txSeq = 0; self.backoff = 500;
      self.send({ type: 'hello', ver: PROTO_VER, name: self.name, side: self.side, room: self.room, seed: self.seed });
      self.setState('hello');
      clearInterval(self.hbIv);
      self.hbIv = setInterval(function () { self.send({ type: 'hb', tick: self.getTick(), frame: ++self.frame }); }, 250);
    };
    ws.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'hb') return;                       // 对端心跳不回放
      if (typeof msg.seq === 'number' && !self.chan.seen(msg.connId || 'peer', msg.seq)) return;  // 重复/迟到：丢弃
      self.onFrame(msg, self);
    };
    ws.onclose = function () {
      clearInterval(self.hbIv);
      if (self.closed) return;
      self.setState('closed');
      if (self.reconnect) self.scheduleRetry();
    };
    ws.onerror = function () { /* 浏览器不细说原因，状态机交给 onclose 推进 */ };
    /* 自定义传输可能在构造时已经 open：补一次 onopen（WebSocket 这里是 0，不会触发）。 */
    if (ws.readyState === 1) setTimeout(function () { if (ws.onopen) ws.onopen(); }, 0);
  };
  Connection.prototype.scheduleRetry = function () {
    if (this.closed) return;
    var self = this, wait = this.backoff;
    this.backoff = Math.min(8000, this.backoff * 2);
    this.setState('retry-in-' + wait);
    setTimeout(function () { if (!self.closed) self.connect(); }, wait);
  };
  Connection.prototype.send = function (msg) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    msg.seq = this.txSeq++; msg.connId = this.connId;
    this.ws.send(JSON.stringify(msg));
    return true;
  };
  Connection.prototype.close = function () {
    this.closed = true;
    clearInterval(this.hbIv);
    try { this.send({ type: 'bye', reason: 'client-bye' }); } catch (e) {}
    try { this.ws && this.ws.close(); } catch (e) {}
  };

  /* ---------- serializeFor(view, viewerSide)：按观看者过滤的白名单纯函数 ----------
     这一刀**只写成纯函数**（NET.md §4 / N2 边界）：吃普通对象、吐过滤后对象，不读 match、不接线。
     白名单（允许）：实体 hp/坐标/速度/存活/护盾/分数/矿归属/抛射物/随从/弃牌堆/双方手牌**张数**、自己手牌内容；
     黑名单（禁止）：对方手牌内容、牌库顺序（双方 deck 一律只给张数）、对方 pendingPick 候选。
     默认字段不存在即不发送——宁缺毋滥。
     N3（NET.md §9.2）只增字段（既有字段不改名不改义）：随从补 uid/aiKind/name/h/yaw/ttl/st；
     抛射物补 uid/color/entKind；新增 sigils 数组；玩家补 respawn/status（p.st 浅拷贝）。
     cd（冷却表）本轮不发（任务书 N1 第 1 条：不给，跳过）。 */
  var ENT_FIELDS = ['hp', 'maxHp', 'shield', 'alive', 'score', 'mana', 'mats', 'side', 'name', 'kills'];
  /* st/status 是 {kind: 剩余秒数} 状态字典：只挑 truthy 且非函数的键浅拷贝出去，
     挂在对象上的函数与空标记不许上线（帧体积与 JSON 可序列化性）。 */
  function pickTruthy(o) {
    var out = {};
    if (o) for (var k in o) { var v = o[k]; if (v && typeof v !== 'function') out[k] = v; }
    return out;
  }
  function serEnt(e) {
    if (!e || !e.pos) return null;
    return {
      pos: { x: +e.pos.x, y: +e.pos.y, z: +e.pos.z },
      vel: e.vel ? { x: +e.vel.x, y: +e.vel.y, z: +e.vel.z } : { x: 0, y: 0, z: 0 },
      yaw: e.yaw || 0, pitch: e.pitch || 0,
      hp: e.hp, maxHp: e.maxHp, shield: e.shield || 0, alive: !!e.alive,
      score: e.score || 0, mana: e.mana || 0, mats: e.mats || 0, side: e.side, name: e.name,
      kills: e.kills || 0
    };
  }
  function serializeFor(view, viewerSide) {
    var out = { players: [], projectiles: [], summons: [], sigils: [], lodes: [], time: view.time || 0, tick: view.tick || 0, over: view.over || null };
    var ps = view.players || [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], sp = serEnt(p);
      if (!sp) continue;
      var mine = (p.side === viewerSide);
      sp.hand = mine ? (p.hand || []).slice() : undefined;         // 自己手牌内容可发
      sp.handCount = (p.hand || []).length;                        // 双方手牌张数可发
      sp.deckCount = (p.deck || []).length;                        // 牌库只给张数（顺序是隐藏信息）
      sp.discard = (p.discard || []).slice();                      // 弃牌堆公开
      if (mine && p.pendingPick) sp.pendingPick = p.pendingPick;   // 候选池只发自己的
      sp.respawn = p.respawn || 0;                                 // N3：复活倒计时（guest 结算/死亡表现要读）
      sp.status = pickTruthy(p.st);                                // N3：燃烧/减速等状态秒数；cd 不发
      out.players.push(sp);
    }
    var pr = view.projectiles || [];
    for (var j = 0; j < pr.length; j++) {
      var q = pr[j];
      // N3 补 uid/color/entKind：uid 是 guest 侧对账的锚（见 net-match.applySnapshot），color/entKind 给渲染认实体
      out.projectiles.push({ pos: q.pos ? { x: +q.pos.x, y: +q.pos.y, z: +q.pos.z } : null, vel: q.vel ? { x: +q.vel.x, y: +q.vel.y, z: +q.vel.z } : null, kind: q.kind, side: q.side, ttl: q.ttl, uid: q.uid, color: q.color, entKind: q.entKind });
    }
    var sm = view.summons || [];
    for (var k = 0; k < sm.length; k++) {
      var su = sm[k], se = serEnt(su);
      if (se) {                                                    // N3 补随从字段（name/yaw serEnt 已带）
        se.uid = su.uid; se.aiKind = su.aiKind; se.h = su.h;
        se.ttl = su.ttl; se.st = pickTruthy(su.st);
      }
      out.summons.push(se);
    }
    var sg = view.sigils || [];
    for (var gi = 0; gi < sg.length; gi++) {
      var s2 = sg[gi];
      if (!s2 || !s2.pos) continue;
      var pre = s2.preset || null;
      out.sigils.push({
        uid: s2.uid,
        kind: pre ? (pre.kind || null) : null,
        presetId: (pre && pre.id) || s2.id || null,
        pos: { x: +s2.pos.x, y: +s2.pos.y, z: +s2.pos.z },
        radius: s2.radius, born: s2.born, delay: s2.delay, ttl: s2.ttl,
        active: !!s2.active, dead: !!s2.dead, triggered: !!s2.triggered,
        side: s2.side, hidden: !!(pre && pre.hidden)
      });
    }
    // 真 Match 的矿归属在 lodeSys.lodes（量具/夹具传入的 view 可直接带 lodes 数组，优先用它）
    var ld = view.lodes || (view.lodeSys && view.lodeSys.lodes) || [];
    for (var li = 0; li < ld.length; li++) {
      var L = ld[li];
      out.lodes.push({ x: L.x, y: L.y, z: L.z, owner: L.owner === undefined ? -1 : L.owner, holdSec: L.holdSec, producedScore: L.producedScore });
    }
    return out;
  }

  G.NetWs = { PROTO_VER: PROTO_VER, SeqChan: SeqChan, Connection: Connection, serializeFor: serializeFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.NetWs;
})(window.GW);