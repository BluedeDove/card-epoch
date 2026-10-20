/* ================= GW.Battle =================
   实体、体素碰撞物理、抛射物、随从 AI、法阵、胜负。
   权威 tick：所有状态变更集中在 Match.step()，输入只是指令流（便于日后换联网）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS, W = G.World;
  var GRAV = 24, JUMP = 9.2, SPEED = 5.6, REACH = 9;

  function V(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  V.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  /* 掉出世界要回出生点，历史上这里调 pos.copy() 而 V 没有 copy，
     于是每个 tick 都在 Match.step 里抛 TypeError，主循环连渲染都跑不到——画面永久定住。 */
  V.prototype.copy = function (o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; };
  V.prototype.clone = function () { return new V(this.x, this.y, this.z); };
  V.prototype.len = function () { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); };
  G.V = V;

  function baseEntity(o) {
    return Object.assign({
      kind: 'summon', side: 0, pos: new V(0, 0, 0), vel: new V(0, 0, 0),
      hp: 20, maxHp: 20, shield: 0, shieldT: 0, st: {}, stPow: {}, cooldowns: {},
      alive: true, dead: false, yaw: 0, onGround: false, invuln: 0, w: 0.6, h: 1.7
    }, o);
  }
  G.baseEntity = baseEntity;

  /* ================= Match ================= */
  function Match(opts) {
    this.world = opts.world;
    this.seed = opts.seed >>> 0;
    this.rng = G.mulberry32(this.seed ^ 0x9e3779b9);
    this.mode = opts.mode || 'train';         // train | hotseat | split | net
    this.time = 0; this.tick = 0;
    this.players = [];
    this.summons = [];
    this.projectiles = [];
    this.sigils = [];
    this.fx = opts.fx || { log: function () {}, sfx: function () {}, burst: function () {}, dust: function () {}, hit: function () {}, heal: function () {}, shieldUp: function () {}, fire: function () {}, float: function () {} };
    this.lives = opts.lives || 2;               // 先赢 2 杀者胜
    this.kills = [0, 0];
    this.over = null;
    this.night = false; this.dayT = 0; this.dayLen = opts.dayLen || 120;
    this.fluidQueue = []; this.fluidT = 0;
    this.ctx = { world: this.world, match: this, fx: this.fx, rng: this.rng };
    for (var i = 0; i < (opts.players || 2); i++) this.players.push(this.makePlayer(i, opts.cards ? opts.cards[i] : null, opts.names ? opts.names[i] : null));
    this.placePlayers();
  }
  Match.prototype.makePlayer = function (side, deckIds, name) {
    var sp = this.world.spawnPoint(side);
    var deck = (deckIds && deckIds.length ? deckIds : G.STARTER_DECK).slice();
    var p = baseEntity({
      kind: 'player', side: side, name: name || ('P' + (side + 1)),
      pos: new V(sp.x, sp.y + 0.92, sp.z), hp: 100, maxHp: 100, w: 0.62, h: 1.8,
      deck: deck, hand: [], discard: [], mana: 3, manaCap: 10, manaAcc: 0, regen: 1.0,
      mats: 5, kills: 0, yaw: side === 0 ? Math.PI * 0.25 : -Math.PI * 0.75, pitch: 0,
      lives: this.lives, respawn: 0, score: 0, aim: null, aimTarget: null
    });
    for (var i = 0; i < 5; i++) this.drawCards(p, 1, true);
    p.eye = function () { var cp = Math.cos(p.pitch); return { x: p.pos.x, y: p.pos.y + 1.55, z: p.pos.z }; };
    return p;
  };
  Match.prototype.placePlayers = function () {
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i], s = this.world.spawnPoint(i);
      p.pos.set(s.x, s.y + p.h / 2 + 0.02, s.z); p.vel.set(0, 0, 0); p.onGround = false;
    }
  };
  Match.prototype.all = function () { return this.players.concat(this.summons); };
  Match.prototype.livingPlayers = function () { return this.players.filter(function (p) { return p.alive; }); };

  /* ---------- 牌库：抽 / 弃 / 洗（全部走 match.rng，可复现） ---------- */
  Match.prototype.drawCards = function (p, n, silent) {
    for (var i = 0; i < n; i++) {
      if (!p.deck.length) {
        if (!p.discard.length) { if (!silent) this.fx.log(p.name + ' 牌库与弃牌堆都空了', '#8a94a6'); return; }
        p.deck = p.discard.slice(); p.discard = [];
        // Fisher-Yates，用同一个 rng
        for (var k = p.deck.length - 1; k > 0; k--) { var j = Math.floor(this.rng() * (k + 1)); var t = p.deck[k]; p.deck[k] = p.deck[j]; p.deck[j] = t; }
        if (!silent) this.fx.log(p.name + ' 重新洗入弃牌堆（' + p.deck.length + ' 张）', '#8a94a6');
      }
      if (p.hand.length >= 5) { p.discard.push(p.deck.pop()); continue; }
      p.hand.push(p.deck.pop());
    }
  };
  Match.prototype.handCard = function (p, i) { return p.hand[i] ? G.CARDS_BY_ID[p.hand[i]] : null; };

  /* ---------- 出牌入口（唯一操作通道；移动不走这里） ---------- */
  Match.prototype.defaultAim = function (p) {
    var cp = Math.cos(p.pitch || 0);
    var d = { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch || 0), z: Math.cos(p.yaw) * cp };
    var o = { x: p.pos.x, y: p.pos.y + 1.55, z: p.pos.z };
    var hit = this.world.raycast(o, d, 30, {});
    if (hit.hit) return { x: hit.x + 0.5 + hit.face[0] * 0.5, y: hit.y + 0.5 + hit.face[1] * 0.5, z: hit.z + 0.5 + hit.face[2] * 0.5, gx: hit.x, gy: hit.y, gz: hit.z, face: hit.face, dist: hit.dist };
    return { x: o.x + d.x * 8, y: o.y + d.y * 8, z: o.z + d.z * 8, gx: Math.floor(o.x + d.x * 8), gy: Math.floor(o.y + d.y * 8), gz: Math.floor(o.z + d.z * 8), face: [0, 1, 0], dist: 8 };
  };
  Match.prototype.playCard = function (p, index) {
    if (!p.alive || index < 0 || index >= p.hand.length) return false;
    var card = G.CARDS_BY_ID[p.hand[index]];
    if (!card) return false;
    if (!p.aim) p.aim = this.defaultAim(p);                       // 永远有落点，避免空引用
    this.ctx.aim = p.aim; this.ctx.aimTarget = p.aimTarget;
    var ok = G.Rules.play(card, p, this.ctx);
    if (ok) { p.hand.splice(index, 1); p.discard.push(card.id); this.drawCards(p, 1, true); }
    return ok;
  };

  /* ---------- 体素 AABB 物理：逐轴推进 + 滑墙 ---------- */
  Match.prototype.collideAABB = function (e, dt) {
    var w = this.world, hw = e.w / 2, hh = e.h / 2;
    function blocked(nx, ny, nz) {
      // 世界外 get() 返回 0（空气），实测从岛边一步踏空就一直掉到 y<-6。
      // 竞技场边界当不可见墙：只挡实体，不改世界数据，也不影响出牌改地形。
      if (w.outOfArena(nx, ny, nz, hw, hh)) return true;
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) for (var oz = -1; oz <= 1; oz++) {
        var cx = Math.floor(nx) + ox, cy = Math.floor(ny) + oy, cz = Math.floor(nz) + oz;
        var id = w.get(cx, cy, cz); if (!id) continue;
        if (!DEFS[id].solid) continue;
        // 方块 AABB 相交测试
        if (cx < nx + hw && cx + 1 > nx - hw && cy < ny + hh && cy + 1 > ny - hh && cz < nz + hw && cz + 1 > nz - hw) return true;
      }
      return false;
    }
    var acc = e.onIce ? 0.06 : 1;
    var nx = e.pos.x + e.vel.x * dt * acc;
    if (!blocked(nx, e.pos.y, e.pos.z)) e.pos.x = nx; else e.vel.x = 0;
    var nz = e.pos.z + e.vel.z * dt * acc;
    if (!blocked(e.pos.x, e.pos.y, nz)) e.pos.z = nz; else e.vel.z = 0;
    var ny = e.pos.y + e.vel.y * dt;
    e.onGround = false;
    if (!blocked(e.pos.x, ny, e.pos.z)) {
      e.pos.y = ny;
      if (e.vel.y < 0) e.airHigh = (e.airHigh === null || e.airHigh === undefined) ? e.pos.y : Math.max(e.airHigh, e.pos.y);
    }
    else {
      if (e.vel.y <= 0) {
        e.onGround = true;
        var fallDist = (e.airHigh === null || e.airHigh === undefined) ? 0 : (e.airHigh - e.pos.y);
        if (fallDist > 3.4 && e.kind === 'player') {
          var d = Math.min(30, Math.round((fallDist - 3.4) * 5));
          if (d > 0) { G.Rules.damage(e, d, 'physical', this.ctx); this.fx.log(p_name(e) + ' 从 ' + fallDist.toFixed(1) + ' 格高处坠地，受 ' + d + ' 伤害', '#ff9f9f'); this.fx.dust(e.pos.x, e.pos.y, e.pos.z, '#c9d3e0'); }
        }
      }
      e.vel.y = 0;
    }
    if (e.onGround) e.airHigh = null;
    // 掉出世界底部
    // 兜底复活：正常情况 outOfArena 已经拦住了踏空，这里只处理被卡牌炸飞、被顶穿地形等意外。
    // pos.y 是身体中心，落点必须按"脚底 + 半高"给，否则一半身子埋进方块、每个方向都判碰撞。
    if (e.pos.y < -6) {
      e.vel.set(0, 0, 0);
      if (e.kind === 'player') {
        var sp = this.world.spawnPoint(e.side);
        e.pos.set(sp.x, sp.y + e.h / 2 + 0.05, sp.z);
        e.stuck = 0; e.airHigh = null;
        G.Rules.damage(e, 12, 'physical', this.ctx);
        this.fx.log(p_name(e) + ' 掉出世界，已在出生点复活并受 12 伤害', '#ff9f9f');
      } else { e.pos.set(e.pos.x, this.world.SY + 2, e.pos.z); this.removeSummon(e); }
    }
  };
  function p_name(e) { return e.name || (G.SUMMON_CN ? G.SUMMON_CN[e.aiKind] : e.aiKind); }

  /* ---------- 输入应用（指令流 → 状态） ---------- */
  /* 卡住检测：整个身体都在实心格内时，把自己顶到最近的地面之上 */
  Match.prototype.unstick = function (e) {
    var w = this.world, hw = e.w / 2, hh = e.h / 2;
    function hit(x, y, z) {
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) for (var oz = -1; oz <= 1; oz++) {
        var cx = Math.floor(x) + ox, cy = Math.floor(y) + oy, cz = Math.floor(z) + oz, id = w.get(cx, cy, cz);
        if (!id || !DEFS[id].solid) continue;
        if (cx < x + hw && cx + 1 > x - hw && cy < y + hh && cy + 1 > y - hh && cz < z + hw && cz + 1 > z - hw) return true;
      }
      return false;
    }
    if (!hit(e.pos.x, e.pos.y, e.pos.z)) { e.stuck = 0; return false; }
    e.stuck = (e.stuck || 0) + 1;
    if (e.stuck > 8) {                                  // 连续 8 tick 全埋在方块里 → 顶出
      var gx = Math.floor(e.pos.x), gz = Math.floor(e.pos.z), sy = w.surfaceY(gx, gz);
      e.pos.set(gx + 0.5, sy + 1 + e.h / 2 + 0.05, gz + 0.5);
      e.vel.set(0, 0, 0); e.stuck = 0;
      this.fx.log(e.name + ' 被地形卡住，已顶出', '#9d95c4');
    }
    return true;
  };
  Match.prototype.applyInput = function (p, inp, dt) {
    if (!p.alive) return;
    var mvx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), mvz = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
    var yaw = p.yaw;
    var fx = Math.sin(yaw), fz = Math.cos(yaw);
    var want = { x: fx * mvz - fz * mvx, z: fz * mvz + fx * mvx };   // 与修正后的右向一致：D 走向屏幕右
    var L = Math.sqrt(want.x * want.x + want.z * want.z);
    var spd = SPEED * G.Rules.statusSpeed(p) * (p.swim ? 0.55 : 1);
    if (L > 0.01) { want.x /= L; want.z /= L; }
    var accel = p.onGround ? 44 : 12;
    p.vel.x += (want.x * spd - p.vel.x) * Math.min(1, accel * dt / Math.max(spd, 0.01));
    p.vel.z += (want.z * spd - p.vel.z) * Math.min(1, accel * dt / Math.max(spd, 0.01));
    if (this.unstick(p)) return;
    if (inp.jump && p.onGround) { p.vel.y = JUMP; delete p.st.frozen; this.fx.sfx('jump'); }
    if (p.swim && inp.jump) p.vel.y = 3.4;
    p.vel.y -= GRAV * dt; if (p.vel.y < -40) p.vel.y = -40;
    this.applyLook(p, inp.lookYaw, inp.lookPitch);   // AI / 远端输入仍按 tick 结算
    this.collideAABB(p, dt);
  };

  /* 朝向的唯一写入点。真人鼠标由主循环每渲染帧调它（见 net.js 的 flushLook），
     AI 与远端输入则在 applyInput 里按 tick 调。yaw 归一化到 (-π,π]，
     免得持续转圈把 yaw 累成大数，让相机绕远路追赶（观感就是突然一拽）。 */
  Match.prototype.applyLook = function (p, lookYaw, lookPitch) {
    if (!p || !p.alive) return;
    if (lookYaw) {
      p.yaw += lookYaw;
      p.yaw = ((p.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }
    if (lookPitch) p.pitch = Math.max(-0.85, Math.min(0.72, p.pitch + lookPitch));
  };

  /* ---------- 瞄准：相机射线选目标 + 玩家射线校验遮挡 ---------- */
  Match.prototype.updateAim = function (p, origin, dir) {
    var e = this.rayEntity(p, origin, dir, p === this.players[0] ? 40 : 40);
    var w = this.world.raycast(origin, dir, 60, {});
    if (e && (!w.hit || e.dist < w.dist)) {
      p.aimTarget = null; p.aim = { x: e.pos.x, y: e.pos.y + e.h * 0.5, z: e.pos.z, gx: Math.floor(e.pos.x), gy: Math.floor(e.pos.y), gz: Math.floor(e.pos.z), ent: e };
      p.aimEntityRef = e;
      return;
    }
    p.aimEntityRef = null;
    if (w.hit) {
      p.aimTarget = { x: w.x, y: w.y, z: w.z, id: w.id };
      p.aim = { x: w.x + 0.5 + w.face[0] * 0.5, y: w.y + 0.5 + w.face[1] * 0.5, z: w.z + 0.5 + w.face[2] * 0.5, gx: w.x, gy: w.y, gz: w.z, face: w.face, dist: w.dist };
    } else { p.aim = null; p.aimTarget = null; }
  };
  Match.prototype.rayEntity = function (from, origin, dir, maxD) {
    var best = null, bd = maxD;
    var ents = this.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (e.kind !== 'player' && e.kind !== 'summon') continue;      // 抛射物与法阵不是可瞄准目标
      if (e === from || !e.alive || typeof e.hp !== 'number') continue;
      if (e.side === from.side) continue;                             // 不瞄准自己人
      if (e.kind === 'player' && e.side === from.side) continue;
      var ox = e.pos.x - origin.x, oy = e.pos.y + e.h / 2 - origin.y, oz = e.pos.z - origin.z;
      var t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > bd) continue;
      var cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      var d2 = cx * cx + cy * cy + cz * cz, rad = Math.max(0.55, e.w * 0.9);
      if (d2 < rad * rad) { bd = t; best = e; best.dist = t; }
    }
    return best;
  };
  Match.prototype.aimEntity = function (p, aim) {
    if (!aim) return null;
    if (aim.ent) return [aim.ent];
    return this.targetsInRadius(p, aim, 1.2);
  };
  Match.prototype.targetsInRadius = function (p, aim, r) {
    var out = [];
    if (!aim) return out;
    var ents = this.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (e.kind !== 'player' && e.kind !== 'summon') continue;   // 只命中真实体，抛射物/法阵不算目标
      if (typeof e.hp !== 'number' || (!e.st || typeof e.st !== 'object')) continue;
      if (!e.alive || e === p) continue;
      if (e.kind === 'player' && e.side === p.side) continue;
      var dx = e.pos.x - aim.x, dy = (e.pos.y + e.h / 2) - aim.y, dz = e.pos.z - aim.z;
      if (dx * dx + dy * dy + dz * dz <= (r + e.w) * (r + e.w)) out.push(e);
    }
    return out;
  };
  Match.prototype.entitiesAt = function (x, y, z) {
    var out = [];
    var ents = this.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i]; if (!e.alive) continue;
      if (Math.floor(e.pos.x) === x && Math.floor(e.pos.z) === z && (Math.floor(e.pos.y) === y || Math.floor(e.pos.y + 1) === y)) out.push(e);
    }
    return out;
  };
  Match.prototype.findStanding = function (p, dest) {
    var w = this.world;
    for (var r = 0; r <= 5; r++) {
      for (var a = 0; a < 8; a++) {
        var ang = a / 8 * Math.PI * 2;
        var x = dest.x + Math.cos(ang) * r, z = dest.z + Math.sin(ang) * r;
        var sx = Math.floor(x) + 0.5, sz = Math.floor(z) + 0.5;
        var y = w.surfaceY(Math.floor(x), Math.floor(z)) + 1;
        if (y > 0 && y < w.SY - 2 && !this.entitiesAt(Math.floor(x), y, Math.floor(z)).length) return { x: sx, y: y, z: sz };
      }
    }
    return dest;
  };

  /* ---------- 抛射物 ---------- */
  Match.prototype.fireProjectile = function (p, card, ef, ctx, mult) {
    var o = p.eye ? p.eye() : { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z };
    var a = p.aim || { x: o.x + Math.sin(p.yaw) * 10, y: o.y + p.pitch * 6, z: o.z + Math.cos(p.yaw) * 10 };
    var dx = a.x - o.x, dy = a.y - o.y, dz = a.z - o.z, L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var sp = 42;
    this.projectiles.push({
      pos: new V(o.x + dx / L * 0.7, o.y, o.z + dz / L * 0.7), vel: new V(dx / L * sp, dy / L * sp, dz / L * sp),
      life: (card.targeting.maxDist || 26) / sp, owner: p, side: p.side, dmg: ef.amount * mult, kind: ef.kind,
      radius: ef.radius || 0, color: G.ELEMENTS[card.element].color, aiKind: card.id, status: null
    });
    this.fx.sfx('shoot');
  };
  Match.prototype.explode = function (src, aim, amount, kind, radius, ctx) {
    if (!aim) return;
    var victims = this.targetsInRadius(src, aim, radius || 2.5);
    for (var i = 0; i < victims.length; i++) G.Rules.damage(victims[i], amount, kind, ctx, src);
    this.fx.burst({ x: aim.x, y: aim.y, z: aim.z }, this.fxColor(kind), Math.min(30, 10 + Math.round(amount / 2)));
    this.fx.sfx(kind === 'fire' ? 'boom' : 'hit');
  };
  Match.prototype.fxColor = function (kind) {
    return { physical: '#c9d3e0', fire: '#ff7a45', ice: '#7fd7ff', nature: '#7fd97f', void: '#c58cff' }[kind] || '#ffffff';
  };
  Match.prototype.spawnHail = function (p, aim, dmg, i) {
    if (!aim) return;
    var r = 2.5;
    var x = aim.x + (this.rng() - 0.5) * r * 2, z = aim.z + (this.rng() - 0.5) * r * 2;
    this.projectiles.push({ pos: new V(x, this.world.SY - 4 + i * 0.3, z), vel: new V(0, -34, 0), life: 2.4, owner: p, side: p.side, dmg: dmg, kind: 'ice', radius: 1.1, color: '#a9dcf2', aiKind: 'hail' });
  };
  Match.prototype.stepProjectiles = function (dt) {
    var w = this.world;
    for (var i = this.projectiles.length - 1; i >= 0; i--) {
      var pr = this.projectiles[i];
      pr.life -= dt;
      var speed = Math.max(Math.abs(pr.vel.x), Math.abs(pr.vel.y), Math.abs(pr.vel.z));
      var steps = Math.max(1, Math.ceil(speed * dt / 0.28));      // 子步推进：避免高速抛射物穿模
      var sdt = dt / steps, gone = false;
      for (var k = 0; k < steps && !gone; k++) {
        var nx = pr.pos.x + pr.vel.x * sdt, ny = pr.pos.y + pr.vel.y * sdt, nz = pr.pos.z + pr.vel.z * sdt;
        var hitE = this.hitTestEntity(pr);
        if (hitE) {
          var ctx = this.ctx; ctx.aim = { x: pr.pos.x, y: pr.pos.y, z: pr.pos.z };
          if (pr.radius > 0) this.explode(pr.owner, ctx.aim, pr.dmg, pr.kind, pr.radius, ctx);
          else { G.Rules.damage(hitE, pr.dmg, pr.kind, ctx, pr.owner); this.fx.burst({ x: pr.pos.x, y: pr.pos.y, z: pr.pos.z }, pr.color, 10); this.fx.sfx('hit'); }
          if (pr.kind === 'fire' && hitE.st) G.Rules.addStatus(hitE, 'burn', 3);
          gone = true; break;
        }
        var id = w.get(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (id && DEFS[id] && DEFS[id].solid) {
          if (pr.radius > 0) this.explode(pr.owner, { x: nx, y: ny, z: nz }, pr.dmg, pr.kind, pr.radius, this.ctx);
          else this.fx.dust(nx, ny, nz, pr.color);
          if (pr.kind === 'fire') {
            var bid = w.get(Math.floor(nx), Math.floor(ny), Math.floor(nz));
            if (DEFS[bid] && DEFS[bid].burn === 'fire') w.set(Math.floor(nx), Math.floor(ny), Math.floor(nz), bid, { kind: 'burning', born: this.time, dur: 3 });
          }
          gone = true; break;
        }
        pr.pos.set(nx, ny, nz);
      }
      if (gone || pr.life <= 0 || pr.pos.y < -4) this.projectiles.splice(i, 1);
    }
  };
  Match.prototype.hitTestEntity = function (pr) {
    var ents = this.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (!e.alive || e.side === pr.side || e === pr.owner) continue;
      if (e.kind !== 'player' && e.kind !== 'summon') continue;
      var dx = e.pos.x - pr.pos.x, dy = e.pos.y + e.h / 2 - pr.pos.y, dz = e.pos.z - pr.pos.z;
      var rr = Math.max(0.8, e.w * 1.25);
      if (dx * dx + dy * dy + dz * dz < rr * rr) return e;
    }
    return null;
  };

  /* ---------- 随从 AI（简单状态机：待机→索敌→攻击→撤退） ---------- */
  Match.prototype.spawnSummon = function (owner, ef) {
    var s = baseEntity({
      kind: 'summon', side: owner.side, name: (G.SUMMON_CN && G.SUMMON_CN[ef.kind]) || ef.kind, aiKind: ef.kind,
      hp: ef.hp || 20, maxHp: ef.hp || 20, dmg: ef.dmg || 5, speed: ef.speed || 3.2, ai: ef.ai || 'melee',
      taunt: !!ef.taunt, pos: new V(owner.pos.x, owner.pos.y, owner.pos.z), ttl: 45, atkCd: 0, state: 'seek'
    });
    var st = this.findStanding(owner, { x: owner.pos.x + (this.rng() - .5) * 3, y: owner.pos.y, z: owner.pos.z + (this.rng() - .5) * 3 });
    s.pos.set(st.x, st.y + s.h / 2 + 0.02, st.z);
    this.summons.push(s);
    this.fx.burst({ x: s.pos.x, y: s.pos.y + 1, z: s.pos.z }, G.ELEMENTS[owner.element || 'nature'].color, 18);
    return s;
  };
  Match.prototype.removeSummon = function (s) { var i = this.summons.indexOf(s); if (i >= 0) this.summons.splice(i, 1); };
  Match.prototype.stepSummons = function (dt) {
    var world = this.world;
    for (var i = this.summons.length - 1; i >= 0; i--) {
      var s = this.summons[i];
      if (!s.alive) { this.summons.splice(i, 1); continue; }
      s.ttl -= dt;
      if (s.ttl <= 0) { this.fx.log(s.name + ' 消散了', '#8a94a6'); this.removeSummon(s); continue; }
      // 索敌：优先攻击敌方玩家，其次最近敌方随从；taunt 会被优先攻击
      var foe = this.players[1 - s.side];
      var target = null;
      var enemies = this.summons.filter(function (o) { return o.side !== s.side && o.alive; });
      var taunts = enemies.filter(function (o) { return o.taunt; });
      if (taunts.length) target = nearest(s, taunts);
      else if (foe && foe.alive) target = this.aiAggro(s) ? foe : nearest(s, enemies.concat([foe]));
      else target = nearest(s, enemies);
      if (!target) { s.state = 'idle'; continue; }
      var dx = target.pos.x - s.pos.x, dz = target.pos.z - s.pos.z, dist = Math.sqrt(dx * dx + dz * dz);
      s.yaw = Math.atan2(dx, dz);
      var spd = s.speed * G.Rules.statusSpeed(s);
      if (s.ai === 'healer') {
        // 治疗者：贴近友方玩家，定期治疗；血量低时逃远
        var ally = this.players[s.side];
        var ad = ally ? Math.hypot(ally.pos.x - s.pos.x, ally.pos.z - s.pos.z) : 99;
        if (ally && ad > 3) { moveToward(s, ally.pos, spd, dt); } else if (ally && ad < 2) { moveToward(s, { x: s.pos.x * 2 - ally.pos.x, z: s.pos.z * 2 - ally.pos.z }, spd, dt); }
        s.atkCd -= dt;
        if (ally && s.atkCd <= 0 && ad < 7) { s.atkCd = 2.2; ally.hp = Math.min(ally.maxHp, ally.hp + 4); this.fx.heal(ally); }
      } else {
        if (dist > 1.9) { moveToward(s, target.pos, spd, dt); s.state = 'chase'; }
        else {
          s.state = 'attack'; s.atkCd -= dt;
          if (s.atkCd <= 0) { s.atkCd = 1.2; G.Rules.damage(target, s.dmg, s.ai === 'flank' ? 'fire' : 'physical', this.ctx, s); this.fx.sfx('melee'); this.fx.burst({ x: target.pos.x, y: target.pos.y + 1, z: target.pos.z }, s.ai === 'flank' ? '#ff7a45' : '#c9a06b', 8); }
        }
        if (s.hp < s.maxHp * 0.25 && s.ai !== 'melee' || (!s.taunt && s.hp < s.maxHp * 0.2)) { s.state = 'flee'; moveToward(s, { x: s.pos.x * 2 - target.pos.x, z: s.pos.z * 2 - target.pos.z }, spd, dt); }
      }
      s.vel.y -= GRAV * dt;
      this.unstick(s);
      this.collideAABB(s, dt);
    }
    function nearest(from, list) {
      var best = null, bd = 1e9;
      for (var i = 0; i < list.length; i++) { if (!list[i] || !list[i].alive) continue; var d = Math.hypot(list[i].pos.x - from.pos.x, list[i].pos.z - from.pos.z); if (d < bd) { bd = d; best = list[i]; } }
      return best;
    }
    function moveToward(e, t, spd, dt) {
      var dx = t.x - e.pos.x, dz = t.z - e.pos.z, L = Math.hypot(dx, dz) || 1;
      e.vel.x += (dx / L * spd - e.vel.x) * Math.min(1, 18 * dt);
      e.vel.z += (dz / L * spd - e.vel.z) * Math.min(1, 18 * dt);
      if (e.onGround && (Math.abs(e.vel.x) + Math.abs(e.vel.z)) > 1 && frontBlocked(world, e)) e.vel.y = 7.0;
    }
    function frontBlocked(w, e) {
      var fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      var bx = Math.floor(e.pos.x + fx * 0.9), bz = Math.floor(e.pos.z + fz * 0.9);
      return w.solidAt(bx, Math.floor(e.pos.y), bz) || w.solidAt(bx, Math.floor(e.pos.y) + 1, bz);
    }
  };
  Match.prototype.aiAggro = function (s) { return s.ai === 'melee' || s.ai === 'flank'; };

  /* ---------- 法阵：延时触发 + 周期结算 + 可被破坏 ---------- */
  Match.prototype.addSigil = function (card, owner, aim, delay, ttl, presetId) {
    if (!aim) return null;
    var preset = presetId && G.SIGILS[presetId] ? Object.assign({ id: presetId }, G.SIGILS[presetId]) : (card && G.SIGILS[card.id]);
    if (!preset) return null;
    var s = {
      id: preset.id, preset: preset, card: card, owner: owner, side: owner.side,
      pos: { x: aim.x, y: aim.gy !== undefined ? aim.gy + 1.02 : aim.y, z: aim.z },
      radius: aim.gx !== undefined && preset.radius ? preset.radius : 2.5,
      born: this.time, delay: delay || 0, ttl: ttl || preset.ttl || 6, active: false, hp: preset.hp || 40, dead: false, acc: 0, frozenAcc: 0
    };
    s.radius = preset.radius || 2.5;
    this.sigils.push(s);
    this.fx.sfx('sigil');
    return s;
  };
  Match.prototype.sigilAt = function (aim) {
    if (!aim) return null;
    for (var i = 0; i < this.sigils.length; i++) {
      var s = this.sigils[i];
      if (Math.hypot(s.pos.x - aim.x, s.pos.z - aim.z) < s.radius + 0.6 && Math.abs(s.pos.y - aim.y) < 4) return s;
    }
    return null;
  };
  Match.prototype.sigilTick = function (dt, ctx) {
    for (var i = this.sigils.length - 1; i >= 0; i--) {
      var s = this.sigils[i];
      var age = this.time - s.born;
      if (s.dead || age > s.delay + s.ttl) { if (s.dead) this.fx.burst(s.pos, s.preset.color, 20); this.sigils.splice(i, 1); continue; }
      if (age < s.delay) continue;
      if (!s.active) { s.active = true; this.fx.burst(s.pos, s.preset.color, 26); this.fx.sfx('sigilGo'); }
      s.acc += dt;
      var ev = s.preset.tickEvery || 0.6;
      if (s.acc >= ev) {
        s.acc = 0;
        var victims = this.targetsInRadius(this.players[s.side], s.pos, s.radius);
        if (s.preset.allyOnly) {
          if (s.preset.heal) { var al = this.all().filter(function (e) { return e.side === s.side && e.alive; }); for (var q = 0; q < al.length; q++) { if (Math.hypot(al[q].pos.x - s.pos.x, al[q].pos.z - s.pos.z) < s.radius) { al[q].hp = Math.min(al[q].maxHp, al[q].hp + s.preset.heal); this.fx.heal(al[q]); } } }
          if (s.preset.id === 'totem') { this.players[s.side].mana = Math.min(this.players[s.side].manaCap, this.players[s.side].mana + 1); }
        } else {
          for (var v = 0; v < victims.length; v++) {
            if (s.preset.dmg) G.Rules.damage(victims[v], s.preset.dmg, s.preset.kind, ctx, this.players[s.side]);
            if (s.preset.slow) G.Rules.addStatus(victims[v], 'slow', s.preset.slow);
            if (s.preset.root) G.Rules.addStatus(victims[v], 'root', s.preset.root);
            if (s.preset.knock) { victims[v].vel.y += s.preset.knock; }
            if (s.preset.ignites) { victims[v].st.burn = 3; }
          }
          if (s.preset.frozenEvery) {
            s.frozenAcc += ev;
            if (s.frozenAcc >= s.preset.frozenEvery) { s.frozenAcc = 0; for (var f = 0; f < victims.length; f++) G.Rules.addStatus(victims[f], 'frozen', 1.4); }
          }
          if (victims.length) this.fx.burst(s.pos, s.preset.color, 8);
        }
        if (s.preset.once && s.active) { s.dead = true; }
      }
    }
  };

  /* ---------- 流体逐格传播（限量，防失控） ---------- */
  Match.prototype.fluidStep = function (dt, ctx) {
    this.fluidT += dt;
    if (this.fluidT < 0.42) return;
    this.fluidT = 0;
    var w = this.world, moves = [];
    w.meta.forEach(function (val, idx) {
      if (!val || val.kind !== 'built') return;
      var y = Math.floor(idx / (w.SZ * w.SX)), rem = idx - y * w.SZ * w.SX, z = Math.floor(rem / w.SX), x = rem - z * w.SX;
      var id = w.get(x, y, z); if (!id) return;
      var def = DEFS[id];
      if (val.kind === 'built' && val.owner === -1 && val.born !== undefined && this.time - val.born > (id === B.LAVA ? 7 : 3)) { w.set(x, y, z, 0); return; }
      if (def.flows) { /* 沙子下落 */ }
      else if (id === B.LAVA) { /* 岩浆缓慢扩散 */ }
      else return;
      var below = w.get(x, y - 1, z);
      if (below === 0 && y > 1) moves.push({ x: x, y: y - 1, z: z, id: id, from: { x: x, y: y, z: z }, spread: true });
    });
    if (moves.length > 24) moves.length = 24;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (DEFS[m.id].liquid) { w.set(m.x, m.y, m.z, m.id, { kind: 'built', owner: -1, born: this.time }); }
      else { w.set(m.x, m.y, m.z, m.id, { kind: 'built', owner: -1, born: this.time }); w.set(m.from.x, m.from.y, m.from.z, 0); }
      if (ctx.fx) ctx.fx.dust(m.x + .5, m.y + .5, m.z + .5, DEFS[m.id].color);
    }
  };

  /* ---------- 死亡与胜负 ---------- */
  Match.prototype.kill = function (t, src, ctx) {
    if (t.dead) return;
    t.dead = true; t.alive = false;
    this.fx.burst({ x: t.pos.x, y: t.pos.y + 1, z: t.pos.z }, '#ffffff', 26);
    this.fx.sfx(t.kind === 'player' ? 'die' : 'summonDie');
    if (t.kind === 'summon') { this.removeSummon(t); this.fx.log(t.name + ' 被击杀', '#c9d3e0'); if (src && src.kind === 'player') { src.kills++; this.drawCards(src, 1, true); this.fx.log(src.name + ' 击杀随从，抽 1 张', '#7fd97f'); } return; }
    var p = t;
    p.lives--;
    if (src && src.kind === 'player' && src !== p) { src.kills++; this.fx.log(src.name + ' 击杀了 ' + p.name, '#ffd86b'); }
    this.fx.log(p.name + ' 倒下（剩余生命 ' + Math.max(0, p.lives) + '）', '#ff9f9f');
    if (p.lives <= 0) { this.finish(1 - p.side); return; }
    p.respawn = 2.2;
  };
  Match.prototype.respawnPlayer = function (p) {
    var s = this.world.spawnPoint(p.side);
    p.pos.set(s.x, s.y + p.h / 2 + 0.02, s.z); p.vel.set(0, 0, 0);
    p.hp = p.maxHp; p.shield = 0; p.shieldT = 0; p.st = {}; p.invuln = 2.5;
    p.alive = true; p.dead = false; p.respawn = 0;
    p.mana = Math.min(p.manaCap, 4);
    this.fx.log(p.name + ' 复活', '#7fd97f');
  };
  Match.prototype.finish = function (winnerSide) {
    if (this.over) return;
    this.over = { winner: winnerSide, name: this.players[winnerSide].name, ticks: this.tick, time: this.time };
    this.fx.sfx('win');
    this.fx.log('★ ' + this.players[winnerSide].name + ' 获胜（' + this.time.toFixed(1) + ' 秒 / ' + this.tick + ' tick）', '#ffd86b');
  };

  /* ---------- 主 tick：顺序固定，保证确定性 ---------- */
  Match.prototype.step = function (dt, inputs) {
    if (this.over) return;
    this.time += dt; this.tick++;
    this.dayT += dt; this.night = (this.dayT % this.dayLen) > this.dayLen * 0.6;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive) { if (p.respawn > 0) { p.respawn -= dt; if (p.respawn <= 0) this.respawnPlayer(p); } continue; }
      p.manaAcc += dt;
      while (p.manaAcc >= 1 && p.mana < p.manaCap) { p.manaAcc -= 1; p.mana++; }
      if (p.mana >= p.manaCap) p.manaAcc = 0;
      var inp = inputs[i] || {};
      this.applyInput(p, inp, dt);
      if (inp.cast !== undefined && inp.cast >= 0) this.playCard(p, inp.cast);
    }
    // 旁观模式相机（无玩家时）
    this.stepSummons(dt);
    this.stepProjectiles(dt);
    G.Rules.tick(dt, this.ctx);
    // 环境粒子：飘落的花/雪
    if ((this.tick % 14) === 0) {
      var p0 = this.players[0];
      var bm = this.world.biomeAt(Math.floor(p0.pos.x), Math.floor(p0.pos.z));
      this.fx.ambient(bm, p0.pos, this.rng);
    }
  };

  G.Match = Match;
  G.SUMMON_CN = { golem: '岩石魔像', dryad: '树精', wisp: '烬羽' };
  G.PHYS = { GRAV: GRAV, SPEED: SPEED, REACH: REACH };
})(window.GW);
