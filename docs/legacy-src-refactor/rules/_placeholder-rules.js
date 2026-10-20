/* ================= GW.Rules =================
   极小的确定性结算器：校验 → 扣资源 → 生成指令 → 写世界/改实体 → 记录。
   所有规则数据来自 cards.js，这里只有解释器（学杀戮尖塔：引擎小、数据厚）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  var MAX_TERRAIN_CELLS = 9;   // 单卡地形改造上限（防实时对战里地形变成无解干扰）

  var R = G.Rules = {};
  R.MAX_TERRAIN_CELLS = MAX_TERRAIN_CELLS;

  /* ---------- 出牌合法性校验 ---------- */
  R.canPlay = function (card, p, ctx) {
    if (!p.alive) return { ok: false, reason: '你已倒下' };
    if (!p.hand.length) return { ok: false, reason: '手牌为空' };
    if (card.cost > p.mana) return { ok: false, reason: '魔力不足（需 ' + card.cost + '）' };
    var cd = p.cooldowns[card.id] || 0;
    if (cd > 0) return { ok: false, reason: '冷却中 ' + cd.toFixed(1) + 's' };
    for (var i = 0; i < card.requires.length; i++) {
      var rq = card.requires[i];
      if (rq.mats && p.mats < rq.mats) return { ok: false, reason: '素材不足' };
      if (rq.hpBelow && p.hp > p.maxHp * rq.hpBelow) return { ok: false, reason: '生命条件不足' };
      if (rq.night && !ctx.match.night) return { ok: false, reason: '需要夜晚' };
    }
    if (card.type === 'terrain') {
      for (var k = 0; k < card.effects.length; k++) if (card.effects[k].op === 'setBlock') {
        var n = R.countCells(card.effects[k], card, p, ctx);
        if (n === 0) return { ok: false, reason: '瞄准处无法改造（换目标或走近些）' };
      }
    }
    return { ok: true, reason: '' };
  };

  /* ---------- 地形改造：目标格集合 ---------- */
  function dirXZ(p) {
    var a = p.yaw; return { x: Math.sin(a), z: Math.cos(a) };
  }
  R.cellsFor = function (ef, card, p, ctx) {
    var w = ctx.world, t = ctx.aim, out = [];
    if (!t) return out;
    var ax = t.gx, ay = t.gy, az = t.gz;
    var blockKey = ef.block || 'dirt';
    var blockId = G.blockKeyToId[blockKey] === undefined ? B.DIRT : G.blockKeyToId[blockKey];
    function push(x, y, z, id, src) {
      if (!w.inB(x, y, z)) return;
      if (out.length >= MAX_TERRAIN_CELLS) return;
      for (var i = 0; i < out.length; i++) if (out[i].x === x && out[i].y === y && out[i].z === z) return;
      // 不许把方块塞进玩家身体（会把人卡住）
      var occupant = ctx.match.entitiesAt(x, y, z);
      if (id !== 0 && occupant.some(function (e) { return e.kind === 'player' || e.kind === 'summon'; })) return;
      var cur = w.get(x, y, z);
      if (ef.mode === 'erase' && (cur === B.BEDROCK || cur === 0)) return;
      if (ef.mode !== 'erase' && cur === id) return;
      out.push({ x: x, y: y, z: z, id: id, prev: cur, owner: p.side, kind: 'built', src: src });
    }
    var d, i, j, k;
    switch (ef.mode) {
      case 'erase':
        var r = ef.radius || 0, hh = ef.height || 1;
        for (i = -r; i <= r; i++) for (j = -r; j <= r; j++) for (k = 0; k < hh; k++) push(ax + i, ay + k, az + j, 0);
        break;
      case 'fill':
        // 按瞄准面偏移：看着地面放方块 = 放在地面上，而不是替换地面（建造手感）
        var fx0 = ax, fy0 = ay, fz0 = az;
        if (t.face && ef.onHitBlock !== true) { fx0 += t.face[0]; fy0 += t.face[1]; fz0 += t.face[2]; }
        var rr = ef.radius || 0;
        for (i = -rr; i <= rr; i++) for (j = -rr; j <= rr; j++) for (k = 0; k <= (ef.height || 0); k++) push(fx0 + i, fy0 + k, fz0 + j, blockId);
        break;
      case 'column':
        for (k = 1; k <= 3; k++) push(ax, ay + k, az, blockId);
        break;
      case 'bridge':
        d = dirXZ(p);
        for (i = 1; i <= (ef.length || 5); i++) push(Math.round(p.pos.x + d.x * i) , ay, Math.round(p.pos.z + d.z * i), blockId);
        break;
      case 'wall':
        d = dirXZ(p);
        var side = { x: d.z, z: -d.x };
        var L = ef.length || 3, H = ef.height || 2;
        var bx = Math.round(t.gx), bz = Math.round(t.gz);
        for (i = 0; i < L; i++) for (k = 0; k < H; k++) push(bx + Math.round(side.x * i), ay + k, bz + Math.round(side.z * i), blockId);
        break;
      case 'cage':
        var H2 = ef.height || 3, b2 = blockId;
        for (k = 0; k < H2; k++) {
          push(ax + 1, ay + k, az, b2); push(ax - 1, ay + k, az, b2);
          push(ax, ay + k, az + 1, b2); push(ax, ay + k, az - 1, b2);
        }
        break;
      case 'ramp':
        d = dirXZ(p);
        for (i = 1; i <= (ef.length || 4); i++)
          for (k = 0; k < i; k++) push(Math.round(p.pos.x + d.x * i), ay + k, Math.round(p.pos.z + d.z * i), blockId);
        break;
      case 'shift':
        var dx = ef.dx || 2, box = [];
        for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) for (k = 0; k < 4; k++) {
          var cur = w.get(ax + i, ay + k, az + j);
          if (cur && cur !== B.BEDROCK) box.push({ x: ax + i, y: ay + k, z: az + j, id: cur });
        }
        for (i = 0; i < box.length; i++) { push(box[i].x + dx, box[i].y, box[i].z, box[i].id); out[out.length - 1] && (out[out.length - 1].eraseAt = box[i]); }
        break;
      case 'grow':
        for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) {
          if (Math.abs(i) + Math.abs(j) === 2 && ctx.rng() < 0.5) continue;
          for (k = 0; k < (ef.height || 3); k++) push(ax + i, ay + k, az + j, blockId);
        }
        break;
      case 'layer':
        for (i = -(ef.radius || 1); i <= (ef.radius || 1); i++) for (j = -(ef.radius || 1); j <= (ef.radius || 1); j++) {
          var sy = w.surfaceY(ax + i, az + j);
          push(ax + i, sy, az + j, blockId);
        }
        break;
    }
    return out;
  };
  R.countCells = function (ef, card, p, ctx) { return R.cellsFor(ef, card, p, ctx).length; };

  /* ---------- 出牌 ---------- */
  R.play = function (card, p, ctx) {
    var v = R.canPlay(card, p, ctx);
    if (!v.ok) { if (ctx.fx) ctx.fx.log(p.name + '：' + v.reason, '#ff9f9f'); return false; }
    p.mana -= card.cost;
    p.cooldowns[card.id] = card.cooldown;
    if (p.buffNext) { p.buffNextActive = true; }
    var mult = p.buffNextActive ? (1 + p.buffNextValue) : 1;
    var used = false;
    for (var i = 0; i < card.effects.length; i++) {
      var ef = card.effects[i];
      R.applyEffect(ef, card, p, ctx, mult);
      if (ef.op === 'setBlock') used = true;
    }
    p.buffNextActive = false;
    if (ctx.fx) { ctx.fx.sfx(card.type === 'terrain' ? 'terrain' : (card.type === 'sigil' ? 'sigil' : 'cast')); ctx.fx.log(p.name + ' 打出 ' + card.name, G.ELEMENTS[card.element].color); }
    return true;
  };

  R.applyEffect = function (ef, card, p, ctx, mult) {
    var w = ctx.world, m = ctx.match;
    mult = mult || 1;
    switch (ef.op) {
      case 'setBlock': {
        var cells = R.cellsFor(ef, card, p, ctx);
        if (!cells.length) return;
        var need = ef.mode === 'erase' ? 0 : 1;
        if (ef.mode !== 'erase' && p.mats < need) { if (ctx.fx) ctx.fx.log('素材不足，改造失败', '#ff9f9f'); return; }
        for (var i = 0; i < cells.length; i++) {
          var c = cells[i];
          w.set(c.x, c.y, c.z, c.id, c.id === 0 ? null : { owner: p.side, kind: 'built', born: m.time });
          if (ef.mode === 'shift' && c.eraseAt) w.set(c.eraseAt.x, c.eraseAt.y, c.eraseAt.z, 0);
          if (ctx.fx) ctx.fx.dust(c.x + 0.5, c.y + (c.id ? 1 : 0), c.z + 0.5, DEFS[c.id || c.prev] ? DEFS[c.id || c.prev].color : '#999');
        }
        if (ef.give && ef.mode === 'erase') {
          var gained = Math.max(1, Math.ceil(cells.length / 3));
          p.mats += gained;
          if (ctx.fx) ctx.fx.log('+' + gained + ' 素材', '#c9a06b');
        }
        if (ef.mode === 'fill' && ef.block === 'lava') m.addSigil(ef.block, p, ctx.aim, 0.2, 12, 'lava_pool');
        break;
      }
      case 'damage': {
        if (card.targeting.shape === 'ray') m.fireProjectile(p, card, ef, ctx, mult);
        else m.explode(p, ctx.aim, ef.amount * mult, ef.kind, ef.radius, ctx);
        break;
      }
      case 'heal': p.hp = Math.min(p.maxHp, p.hp + ef.amount); if (ctx.fx) ctx.fx.heal(p); break;
      case 'shield': p.shield = (p.shield || 0) + ef.amount; p.shieldT = Math.max(p.shieldT || 0, ef.dur); if (ctx.fx) ctx.fx.shieldUp(p); break;
      case 'status': {
        var targets = ef.radius ? m.targetsInRadius(p, ctx.aim, ef.radius) : (function () {
          var t = m.aimEntity(p, ctx.aim); return t ? [t] : [];
        })();
        for (var s = 0; s < targets.length; s++) R.addStatus(targets[s], ef.kind, ef.dur);
        break;
      }
      case 'spawn': {
        for (var n = 0; n < ef.count; n++) m.spawnSummon(p, ef);
        break;
      }
      case 'sigil': m.addSigil(card, p, ctx.aim, ef.delay, ef.ttl, null); break;
      case 'push': {
        var hit = m.targetsInRadius(p, { x: p.pos.x, y: p.pos.y, z: p.pos.z }, 4.2);
        for (var q = 0; q < hit.length; q++) {
          if (hit[q].side === p.side) continue;
          if (hit[q].st.sturdy) continue;
          var vx = hit[q].pos.x - p.pos.x, vz = hit[q].pos.z - p.pos.z, L = Math.sqrt(vx * vx + vz * vz) || 1;
          hit[q].vel.x += vx / L * ef.power; hit[q].vel.z += vz / L * ef.power; hit[q].vel.y += ef.up || 0;
        }
        if (ctx.fx) ctx.fx.sfx('push');
        break;
      }
      case 'blink': {
        var aim = ctx.aim || { x: p.pos.x, y: p.pos.y, z: p.pos.z };
        var dx = aim.x - p.pos.x, dy = aim.y - p.pos.y, dz = aim.z - p.pos.z;
        var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, d = Math.min(len, ef.dist);
        var dest = m.findStanding(p, { x: p.pos.x + dx / len * d, y: aim.y, z: p.pos.z + dz / len * d });
        if (ctx.fx) ctx.fx.burst(p.pos, '#c58cff', 14);
        p.pos.x = dest.x; p.pos.y = dest.y + p.h / 2 + 0.02; p.pos.z = dest.z; p.vel.set(0, 0, 0);
        if (ctx.fx) ctx.fx.burst(dest, '#c58cff', 16);
        break;
      }
      case 'ignite': {
        if (!ctx.aim) { ctx.aim = m.defaultAim(p); }
        var ix = Math.floor(ctx.aim.x), iy = Math.floor(ctx.aim.y), iz = Math.floor(ctx.aim.z);
        for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c2 = -1; c2 <= 1; c2++) {
          if (Math.abs(a) + Math.abs(b) + Math.abs(c2) > 3) continue;
          var id = w.get(ix + a, iy + b, iz + c2), def = DEFS[id];
          if (def && def.burn === 'fire') w.set(ix + a, iy + b, iz + c2, id, { kind: 'burning', born: m.time, dur: ef.dur });
        }
        m.addSigil(card, p, ctx.aim, 0.1, ef.dur, 'lava_pool');
        break;
      }
      case 'hail': { for (var h = 0; h < ef.count; h++) m.spawnHail(p, ctx.aim, ef.dmg, h); break; }
      case 'gainMana': p.mana = Math.min(p.manaCap, p.mana + ef.amount); break;
      case 'manaCapDown': p.manaCap = Math.max(3, p.manaCap - 1); break;
      case 'draw': m.drawCards(p, ef.count); break;
      case 'loseHp': p.hp -= ef.amount; break;
      case 'harvest': {
        var t = ctx.aimTarget;
        if (t && t.id === B.CRYSTAL) {
          w.set(t.x, t.y, t.z, 0); p.mana = Math.min(p.manaCap, p.mana + 3); p.mats += 1;
          if (ctx.fx) { ctx.fx.burst({ x: t.x + .5, y: t.y + .5, z: t.z + .5 }, '#b26bff', 20); ctx.fx.sfx('crystal'); }
        }
        break;
      }
      case 'destroySigil': {
        var sg = m.sigilAt(ctx.aim);
        if (sg) { sg.dead = true; if (ctx.fx) { ctx.fx.burst(sg.pos, '#c58cff', 24); ctx.fx.log('法阵被破阵', '#c58cff'); } }
        break;
      }
      case 'swap': {
        var e2 = m.aimEntity(p, ctx.aim);
        if (e2 && e2.kind === 'summon') { var tmp = { x: p.pos.x, y: p.pos.y, z: p.pos.z }; p.pos.x = e2.pos.x; p.pos.y = e2.pos.y; p.pos.z = e2.pos.z; e2.pos.x = tmp.x; e2.pos.y = tmp.y; e2.pos.z = tmp.z; }
        break;
      }
      case 'speed': R.addStatus(p, 'haste', ef.dur, ef.amount); break;
      case 'regen': R.addStatus(p, 'regen', ef.dur, ef.amount); break;
      case 'buffNext': p.buffNext = true; p.buffNextValue = ef.amount; break;
      case 'totem': m.addSigil(card, p, ctx.aim, 0.1, ef.dur, 'totem'); break;
    }
  };

  /* ---------- 状态 ---------- */
  R.addStatus = function (t, kind, dur, power) {
    if (!t || typeof t !== 'object') return;
    if (!t.st || typeof t.st !== 'object') t.st = {};
    if (kind === 'frozen' && t.st.sturdy) return;
    t.st[kind] = dur;
    if (power) { if (!t.stPow || typeof t.stPow !== 'object') t.stPow = {}; t.stPow[kind] = power; }
  };
  R.statusSpeed = function (t) {
    var s = 1;
    if (!t.st || typeof t.st !== 'object') t.st = {};
    if (t.st.frozen || t.st.root) return 0;
    if (t.st.slow) s *= 0.5;
    if (t.st.haste) s *= 1 + (t.stPow && t.stPow.haste ? t.stPow.haste : 0.5);
    return s;
  };
  R.damage = function (t, amount, kind, ctx, src) {
    if (!t || t.dead || !t.alive) return;
    if (t.invuln > 0) return;
    if (t.st.vuln) amount *= 1.35;
    if (t.kind === 'summon' && t.st.frozen) amount *= 1.25;
    if ((t.shield || 0) > 0) {
      var absorbed = Math.min(t.shield, amount); t.shield -= absorbed; amount -= absorbed;
      if (ctx && ctx.fx) ctx.fx.sfx('shield');
      if (t.shield <= 0) t.shieldT = 0;
    }
    if (amount > 0) { t.hp -= amount; if (ctx && ctx.fx) ctx.fx.hit(t, amount, kind); }
    if (t.hp <= 0) { t.hp = 0; ctx.match.kill(t, src, ctx); }
  };

  /* ---------- 每 tick：冷却、状态、燃烧、岩浆流动、护盾计时 ---------- */
  R.tick = function (dt, ctx) {
    var w = ctx.world, m = ctx.match;
    var ents = m.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (e.dead) continue;
      for (var key in e.cooldowns) if (e.cooldowns[key] > 0) e.cooldowns[key] = Math.max(0, e.cooldowns[key] - dt);
      for (var s in e.st) {
        if (e.st[s] > 0) {
          e.st[s] -= dt;
          if (e.st[s] <= 0) delete e.st[s];
        }
      }
      if (e.st.burn > 0) { if (e.burnTick === undefined) e.burnTick = 0; e.burnTick += dt; if (e.burnTick >= 1) { e.burnTick = 0; R.damage(e, 4, 'fire', ctx); if (ctx.fx) ctx.fx.fire(e.pos); } }
      if (e.st.regen > 0 && e.hp > 0) { e.regenAcc = (e.regenAcc || 0) + dt; if (e.regenAcc >= 1) { e.regenAcc = 0; e.hp = Math.min(e.maxHp, e.hp + ((e.stPow && e.stPow.regen) || 2)); } }
      if (e.shieldT > 0) { e.shieldT -= dt; if (e.shieldT <= 0) e.shield = 0; }
      if (e.invuln > 0) e.invuln -= dt;
      // 站在水/岩浆里
      var feet = w.get(Math.floor(e.pos.x), Math.floor(e.pos.y), Math.floor(e.pos.z));
      if (feet === B.LAVA) { e.lavaAcc = (e.lavaAcc || 0) + dt; if (e.lavaAcc > 0.35) { e.lavaAcc = 0; R.damage(e, 9, 'fire', ctx); } }
      else if (feet === B.WATER && e.kind === 'player') e.swim = true; else e.swim = false;
      var below = w.get(Math.floor(e.pos.x), Math.floor(e.pos.y - 1), Math.floor(e.pos.z));
      e.onIce = below === B.ICE && (below !== 0);
    }
    // 燃烧方块蔓延 + 到期成灰
    var burning = [];
    w.meta.forEach(function (val, idx) {
      if (val.kind !== 'burning') return;
      var y = Math.floor(idx / (w.SZ * w.SX)), rem = idx - y * w.SZ * w.SX, z = Math.floor(rem / w.SX), x = rem - z * w.SX;
      burning.push({ x: x, y: y, z: z, val: val });
    });
    for (var b = 0; b < burning.length; b++) {
      var bb = burning[b];
      if (m.time - (bb.val.born || 0) > (bb.val.dur || 4)) {
        w.set(bb.x, bb.y, bb.z, 0);
        if (ctx.fx) ctx.fx.dust(bb.x + .5, bb.y + .5, bb.z + .5, '#5a5a5a');
        continue;
      }
      bb.val.spread = (bb.val.spread || 0) + dt;
      if (bb.val.spread > 0.8) {
        bb.val.spread = 0;
        var nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        for (var n = 0; n < 6; n++) {
          var id = w.get(bb.x + nb[n][0], bb.y + nb[n][1], bb.z + nb[n][2]), def = DEFS[id];
          if (def && def.burn === 'fire') w.set(bb.x + nb[n][0], bb.y + nb[n][1], bb.z + nb[n][2], id, { kind: 'burning', born: m.time, dur: 3 });
        }
      }
    }
    // 岩浆/水流动（邻居传播，学 MC 的流体扩散，限量防失控）
    m.fluidStep(dt, ctx);
    // 法阵
    m.sigilTick(dt, ctx);
  };
})(window.GW);
