/* ================= GW.NetMatch（NET-N3 权威同步的纯逻辑层） =================
   任务书 docs/tasks/N1_NET_SYNC.md；设计口径 docs/NET.md §9.1～§9.4。
   这一层只回答三个问题：房主的权威状态怎么打包（makeSnapshot）、guest 的镜像怎么覆盖
   （applySnapshot，含 §9.1 的 1↔0 互换与 uid 对账）、断帧时 guest 怎么自己挪一小步（extrapolate）。
   纪律：零 DOM、零玩家可见文案、零 THREE；不做回滚重放（NET.md §3），跳变交给 snapshotPrev + renderPos 摊帧。
   依赖（都是 GW 上的同层模块，装配不在这里）：
     G.NetWs.serializeFor（net-ws.js）、G.Net.RemoteInputSource（net.js）、
     G.Match/baseEntity/V、G.SIGILS（cards.js）、G.WORLD_HOOKS（world.js）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* guest 外推预算（秒）：NET.md §8 的 3 tick 上限——收不到快照就定住，宁可定住也不穿墙。
     预算的"重置"由收快照的一方做：applySnapshot 把 extrapT 清零（任务书：budget 由调用方每收到快照重置）。 */
  var EXTRAP_BUDGET = 0.15;

  /* truthy 浅拷贝：状态字典里只带"真的有值"的键；函数/对象引用不许进镜像（与 net-ws 的 pickTruthy 同口径）。
     快照是 JSON 过来的，这里再防一手直接传对象的调用方。 */
  function truthy(o) {
    var out = {};
    if (o) for (var k in o) { var v = o[k]; if (v && typeof v !== 'function') out[k] = v; }
    return out;
  }
  /* 1↔0 互换（NET.md §9.1）：guest 本地视角恒为 side 0。中立（side/owner < 0）不换——1-(-1)=2 会把晶甲兽变成第三席。 */
  function swapSide(s) { return (typeof s === 'number' && s >= 0) ? 1 - s : s; }
  function num(v, dflt) { return (typeof v === 'number' && isFinite(v)) ? v : dflt; }
  function setVec(t, s) { if (t && s) t.set(num(s.x, 0), num(s.y, 0), num(s.z, 0)); }

  /* ---------- 世界 diff：房主侧记录器（NET.md §9.4） ----------
     往 G.WORLD_HOOKS.onSet 推一个记录器，按 x,y,z 覆盖写最新 id（同格改 10 次只发 1 条）；
     drain() 交出 [[x,y,z,id],…] 并清空；size() 给上限判断（超 4000 格/份由调用方决定整轮不发）；
     detach() 摘钩子。钩子表是全局的（一张数组所有世界共用），所以记录前核一眼
     "这一格在**我这个**世界里确实等于 id"：guest 镜像 world.set 触发的同回调写入不许混进房主的 diff。 */
  function makeWorldTracker(world) {
    var map = new Map();
    var hooks = G.WORLD_HOOKS && G.WORLD_HOOKS.onSet;
    if (!hooks || !world) {
      return { drain: function () { return []; }, size: function () { return 0; }, detach: function () {} };
    }
    var hook = function (x, y, z, id) {
      if (!world.inB(x, y, z)) return;
      if (world.get(x, y, z) !== id) return;             // 不是这个世界的写入：跳过
      map.set(x + ',' + y + ',' + z, [x, y, z, id]);     // 覆盖写最新 id
    };
    hooks.push(hook);
    return {
      drain: function () {
        var arr = []; map.forEach(function (c) { arr.push(c); }); map.clear(); return arr;
      },
      size: function () { return map.size; },
      detach: function () { var i = hooks.indexOf(hook); if (i >= 0) hooks.splice(i, 1); map.clear(); }
    };
  }

  /* guest 应用 diff：逐格 world.set；非法坐标跳过（world.set 自己也会挡，这里挡在调用前好计数）。
     guest 不跑 CHEM.step，set 触发的 chem 唤醒只入队不结算（NET.md §9.4），稳态零成本。 */
  function applyCells(world, cells) {
    if (!world || !Array.isArray(cells)) return 0;
    var n = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (!c || c.length < 4) continue;
      var x = c[0] | 0, y = c[1] | 0, z = c[2] | 0, id = c[3] | 0;
      if (!world.inB(x, y, z)) continue;
      if (world.set(x, y, z, id)) n++;
    }
    return n;
  }

  /* ---------- 打包（房主侧，每 2 tick 一份；NET.md §9.2 帧形） ----------
     draft：在 match.drafts 里找【第一条 side === viewerSide】的 offer——不是只看队列头：
     房主自己那份先挂着时，房主页的三选一由 main.js 直接读队列弹，而 guest 只靠快照里的
     draft；只看队列头会让 guest 面板在房主没处理自己那份期间永远收不到自己的 offer。
     只带 {side, source, biome, options}——队列里别的方的 offer 与内部账（draftUsed 等）不出门。 */
  function draftForSide(match, viewerSide) {
    var q = Array.isArray(match.drafts) ? match.drafts : [];
    for (var i = 0; i < q.length; i++) {
      var offer = q[i];
      if (offer && offer.side === viewerSide) {
        return { side: offer.side, source: offer.source, biome: offer.biome, options: (offer.options || []).slice() };
      }
    }
    return null;
  }
  function makeSnapshot(match, viewerSide, tracker) {
    var view = G.NetWs.serializeFor(match, viewerSide);
    var draft = draftForSide(match, viewerSide);
    return {
      tick: match.tick || 0, time: match.time || 0,
      view: view,
      cells: tracker ? tracker.drain() : [],
      draft: draft,
      over: match.over || null
    };
  }

  /* ---------- uid 对账 ----------
     不许每份快照重建整个数组（否则 main.js 的网格池每 100ms 重建一次）：
     按 uid 建 Map，已有对象就地改字段，新 uid 造最小实体，快照里没有的 uid 从数组移除。
     数组本身永远就地改（AGENTS：视图状态数组只准就地改，不许整个换掉）。 */
  function reconcile(list, arr, make, upd) {
    if (!Array.isArray(list)) return;
    var snap = Array.isArray(arr) ? arr : [];
    var byUid = new Map();
    for (var i = 0; i < list.length; i++) { var e0 = list[i]; if (e0 && e0.uid != null) byUid.set(e0.uid, e0); }
    var keep = new Set();
    for (var j = 0; j < snap.length; j++) {
      var s = snap[j];
      if (!s || s.uid == null || !s.pos) continue;
      var ex = byUid.get(s.uid);
      if (ex) { upd(ex, s); keep.add(s.uid); continue; }
      var fresh = make(s);                              // make 返回 null = 这条丢弃（如 preset 查不到）
      if (fresh) { list.push(fresh); keep.add(s.uid); }
    }
    for (var k = list.length - 1; k >= 0; k--) {
      var it = list[k];
      if (!it || it.uid == null || !keep.has(it.uid)) list.splice(k, 1);
    }
  }
  /* 新实体一律 G.baseEntity 造最小形状：pos/vel 必须是 GW.V（renderPos/collide 都调 .set/.clone），
     ppos 与 pos 相同——renderPos 需要，缺了它第一帧插值从 (0,0,0) 起飞。 */
  function entFrom(s, extra) {
    var e = G.baseEntity(extra);
    setVec(e.pos, s.pos); setVec(e.vel, s.vel);
    e.ppos = e.pos.clone();
    return e;
  }
  function makeSummon(s) {
    return entFrom(s, {
      uid: s.uid, kind: 'summon', side: swapSide(s.side),
      hp: num(s.hp, 20), maxHp: num(s.maxHp, num(s.hp, 20)), shield: num(s.shield, 0), alive: !!s.alive,
      h: num(s.h, 1.7), aiKind: s.aiKind, name: s.name, yaw: num(s.yaw, 0),
      ttl: num(s.ttl, 45), st: truthy(s.st)
    });
  }
  function updSummon(e, s) {
    setVec(e.pos, s.pos); setVec(e.vel, s.vel);
    if (typeof s.hp === 'number') e.hp = s.hp;
    if (typeof s.maxHp === 'number') e.maxHp = s.maxHp;
    if (typeof s.shield === 'number') e.shield = s.shield;
    e.alive = !!s.alive;
    if (typeof s.yaw === 'number') e.yaw = s.yaw;
    if (typeof s.ttl === 'number') e.ttl = s.ttl;
    e.st = truthy(s.st);
  }
  function makeProjectile(s) {
    return entFrom(s, {
      uid: s.uid, kind: s.kind || 'projectile', entKind: 'projectile', color: s.color,
      side: swapSide(s.side), alive: true, hp: 1, maxHp: 1
    });
  }
  function updProjectile(e, s) {
    setVec(e.pos, s.pos); setVec(e.vel, s.vel);
    if (s.color !== undefined) e.color = s.color;
  }
  function makeSigil(s) {
    var preset = (s.presetId && G.SIGILS && G.SIGILS[s.presetId]) || null;
    if (!preset) return null;                            // 查不到 preset：丢弃该条，不许造一个假 preset 顶上
    return entFrom(s, {
      uid: s.uid, kind: 'sigil', side: swapSide(s.side),
      preset: Object.assign({ id: s.presetId }, preset), id: s.presetId,
      radius: num(s.radius, preset.radius || 2.5),
      born: num(s.born, 0), delay: num(s.delay, 0), ttl: num(s.ttl, preset.ttl || 6),
      active: !!s.active, dead: !!s.dead, triggered: !!s.triggered
    });
  }
  function updSigil(e, s) {
    setVec(e.pos, s.pos);
    if (typeof s.radius === 'number') e.radius = s.radius;
    e.active = !!s.active; e.dead = !!s.dead; e.triggered = !!s.triggered;
    if (typeof s.born === 'number') e.born = s.born;
    if (typeof s.delay === 'number') e.delay = s.delay;
    if (typeof s.ttl === 'number') e.ttl = s.ttl;
  }

  /* ---------- 覆盖（guest 侧收到快照；NET.md §3 / §9.3 步 4） ----------
     顺序写死：先 snapshotPrev() 把"覆盖前"的位置记成 ppos，再整表覆盖权威字段——
     现有渲染插值（renderPos 按 acc/STEP 在 ppos→pos 之间插）于是把校正跳变摊成几帧，视觉等价回滚、
     实现上没有历史重放。写完 touch('players', 0/1) 让 HUD 的失效检测看到新 rev。 */
  function applySnapshot(mirror, snap) {
    if (!mirror || !snap || !snap.view) return { ok: false, reason: 'no-snapshot' };
    mirror.snapshotPrev();
    var vps = snap.view.players || [];
    for (var i = 0; i < mirror.players.length; i++) {
      var mp = mirror.players[i];
      if (!mp) continue;
      // §9.1：镜像 side i 对应快照里 side 1-i 的那个人（1↔0 互换）
      var sp = null;
      for (var j = 0; j < vps.length; j++) if (vps[j] && vps[j].side === 1 - mp.side) { sp = vps[j]; break; }
      if (!sp) continue;
      setVec(mp.pos, sp.pos); setVec(mp.vel, sp.vel);    // vel 覆盖：外推用"最后已知速度"（§9.3 步 2）
      mp.hp = num(sp.hp, mp.hp); mp.maxHp = num(sp.maxHp, mp.maxHp); mp.shield = num(sp.shield, 0);
      mp.alive = !!sp.alive; mp.score = num(sp.score, 0);
      mp.mana = num(sp.mana, 0); mp.mats = num(sp.mats, 0); mp.kills = num(sp.kills, 0);
      mp.respawn = num(sp.respawn, 0);
      mp.st = truthy(sp.status);
      mp.extrapT = 0;                                    // 外推预算随快照重置（调用方收快照=调这里）
      /* 手牌/牌库/弃牌：白名单在 serializeFor 已经把对方内容滤掉了，这里按"张数占位"落镜像——
         自己那侧才有 hand 内容；deck 顺序连自己都不许看（牌序是隐藏信息，镜像里只留长度）。 */
      if (Array.isArray(sp.hand)) mp.hand = sp.hand.slice();
      else mp.hand = new Array(num(sp.handCount, 0));
      mp.deck = new Array(num(sp.deckCount, 0));
      mp.discard = Array.isArray(sp.discard) ? sp.discard.slice() : [];
    }
    /* 矿归属：房主视角 → guest 视角（owner < 0 的无主/争抢保持不变）；镜像矿表按同 seed 生成，下标天然对齐。 */
    var lodes = (mirror.lodeSys && mirror.lodeSys.lodes) || [];
    var sl = snap.view.lodes || [];
    for (var li = 0; li < lodes.length && li < sl.length; li++) {
      var ow = sl[li] ? sl[li].owner : -1;
      lodes[li].owner = (typeof ow === 'number' && ow >= 0) ? 1 - ow : -1;
    }
    /* over：winner 互换（-1 平局之类保持），其余字段（name/ticks/time/winReason）原样——面板字段形状不许动。 */
    mirror.over = snap.over ? Object.assign({}, snap.over, { winner: swapSide(snap.over.winner) }) : null;
    mirror.time = num(snap.time, mirror.time);
    mirror.tick = num(snap.tick, mirror.tick);
    reconcile(mirror.summons, snap.view.summons, makeSummon, updSummon);
    reconcile(mirror.projectiles, snap.view.projectiles, makeProjectile, updProjectile);
    reconcile(mirror.sigils, snap.view.sigils, makeSigil, updSigil);
    mirror.touch('players', 0);
    mirror.touch('players', 1);
    return { ok: true, tick: snap.tick };
  }

  /* ---------- guest 本地预测：只外推 localSide（恒 0）那一位玩家 ----------
     pos += vel*dt，不做碰撞（下一份快照会纠）；连续外推超过 budget 秒就定住——
     NET.md §8 的实测毛刺约 1 秒，无限预测会让 guest 把自己"预测进墙里"。 */
  function extrapolate(mirror, dt, localSide, budget) {
    if (!(dt > 0) || !mirror || !mirror.players) return false;
    var p = mirror.players[localSide];
    if (!p || !p.alive || !p.pos || !p.vel) return false;
    var cap = (typeof budget === 'number' && budget >= 0) ? budget : EXTRAP_BUDGET;
    var t = p.extrapT || 0;
    // 定住：预算烧完不前进（budget 由调用方每收到快照重置）。
    // 1e-9 容差：dt=0.05 连加三次是 0.15000000000000002，不给容差第 4 tick 会被浮点尾巴误判成"超预算"。
    if (t > cap + 1e-9) return false;
    p.extrapT = t + dt;
    p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt; p.pos.z += p.vel.z * dt;
    return true;
  }

  /* ---------- input 编解码（NET.md §9.2 的 input 帧） ----------
     encodeInput：guest 侧把 KeyboardSource.poll 的产出 + 本机玩家镜像的绝对朝向打包成一条 input 帧。
       只带白名单字段（lookYaw/lookPitch 这类增量不进网络——朝向发绝对角）。
     decodeInput：房主侧解一条 input——交给该 side 的 RemoteInputSource（下一 tick poll 出一条），
       并当场把绝对朝向写到权威玩家（applyTo 内含夹取）。 */
  function encodeInput(polled, player) {
    var k = polled || {};
    return {
      keys: {
        fwd: k.fwd ? 1 : 0, back: k.back ? 1 : 0, left: k.left ? 1 : 0, right: k.right ? 1 : 0,
        jump: k.jump ? 1 : 0, crouch: k.crouch ? 1 : 0, sprint: k.sprint ? 1 : 0,
        cast: (typeof k.cast === 'number') ? k.cast : -1
      },
      yaw: (player && typeof player.yaw === 'number') ? player.yaw : 0,
      pitch: (player && typeof player.pitch === 'number') ? player.pitch : 0
    };
  }
  /* 每个 (match, side) 一条输入队列，挂在 match 自己的私有字段上（_netRemote 前缀，不与权威字段撞名）。 */
  function remoteSourceFor(match, side) {
    if (!match) return null;
    var map = match._netRemote || (match._netRemote = {});
    var key = 's' + side;
    var src = map[key];
    if (!src) {
      if (!G.Net || !G.Net.RemoteInputSource) return null;
      src = map[key] = new G.Net.RemoteInputSource();
    }
    return src;
  }
  function decodeInput(msg, match, side) {
    if (!msg || !match || !match.players || !match.players[side]) return { ok: false, reason: 'no-player' };
    var src = remoteSourceFor(match, side);
    if (!src) return { ok: false, reason: 'no-source' };
    src.push(msg);
    G.Net.RemoteInputSource.applyTo(match.players[side], msg);
    return { ok: true };
  }

  G.NetMatch = {
    EXTRAP_BUDGET: EXTRAP_BUDGET,
    makeWorldTracker: makeWorldTracker,
    applyCells: applyCells,
    makeSnapshot: makeSnapshot,
    applySnapshot: applySnapshot,
    extrapolate: extrapolate,
    encodeInput: encodeInput,
    decodeInput: decodeInput,
    remoteSourceFor: remoteSourceFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.NetMatch;   // node 单测（net_sync_check）以 window 垫片加载
})(window.GW);