/* js/systems/aim.js · 瞄准/射线/目标查询（从 battle.js 搬出，行为逐字不变）
   搬出范围：defaultAim / useHotkey / updateAim / rayEntity / aimEntity / targetsInRadius / entitiesAt / findStanding。
   调用约定：第一个参数是状态容器 m。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function defaultAim(m, p) {
    var cp = Math.cos(p.pitch || 0);
    var d = { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch || 0), z: Math.cos(p.yaw) * cp };
    var o = { x: p.pos.x, y: p.pos.y + 1.55, z: p.pos.z };
    var hit = m.world.raycast(o, d, 30, {});
    if (hit.hit) return { x: hit.x + 0.5 + hit.face[0] * 0.5, y: hit.y + 0.5 + hit.face[1] * 0.5, z: hit.z + 0.5 + hit.face[2] * 0.5, gx: hit.x, gy: hit.y, gz: hit.z, face: hit.face, dist: hit.dist };
    return { x: o.x + d.x * 8, y: o.y + d.y * 8, z: o.z + d.z * 8, gx: Math.floor(o.x + d.x * 8), gy: Math.floor(o.y + d.y * 8), gz: Math.floor(o.z + d.z * 8), face: [0, 1, 0], dist: 8 };
  };
  function useHotkey(m, p, hot, dirX, dirZ) {
    if (!p || !p.alive) return { ok: false, reason: '你已倒下' };
    var len = Math.sqrt((dirX || 0) * (dirX || 0) + (dirZ || 0) * (dirZ || 0));
    if (len < 1e-3) { dirX = Math.sin(p.yaw); dirZ = Math.cos(p.yaw); }
    else { dirX /= len; dirZ /= len; }
    /* 手上可能有好几张 hot 牌（2026-10-18 起"增加移动"那一组的每张卡都带 hot:'shift'）：
       第一张在冷却/付不起时**接着试下一张**，不再一张卡被判死就整次按空。
       playCard 被拒不改任何状态，所以逐张试是安全的。 */
    var tried = null;
    for (var i = 0; i < p.hand.length; i++) {
      var c = G.CARDS_BY_ID[p.hand[i]];
      if (!c || c.hot !== hot) continue;
      tried = c;
      var dist = (c.targeting && c.targeting.maxDist) ? Math.min(8, c.targeting.maxDist) : 8;
      var ax = p.pos.x + dirX * dist, az = p.pos.z + dirZ * dist;
      var ay = p.pos.y + 0.6;
      var aim = { x: ax, y: ay, z: az, gx: Math.floor(ax), gy: Math.floor(p.pos.y), gz: Math.floor(az), face: [0, 1, 0] };
      m.ctx.aim = aim;
      delete p.aimSrc;
      p.aim = aim; p.aimTarget = null;
      var ok = m.playCard(p, i);
      m.ctx.aim = null;
      if (ok) return { ok: true, cardId: c.id, index: i };
    }
    if (tried) return { ok: false, reason: '快捷键：' + tried.name + ' 出不了（魔力/冷却）', cardId: tried.id };
    return { ok: false, reason: '快捷栏里没有可用牌' };
  };

  function updateAim(m, p, origin, dir, internal) {
    p.aimSrc = internal ? 'auto' : 'ext';
    var e = m.rayEntity(p, origin, dir, p === m.players[0] ? 40 : 40);
    var w = m.world.raycast(origin, dir, 60, {});
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
  function rayEntity(m, from, origin, dir, maxD) {
    var best = null, bd = maxD;
    var ents = m.all();
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
  function aimEntity(m, p, aim) {
    if (!aim) return null;
    if (aim.ent) return [aim.ent];
    return m.targetsInRadius(p, aim, 1.2);
  };
  function targetsInRadius(m, p, aim, r) {
    var out = [];
    if (!aim) return out;
    var ents = m.all();
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
  function entitiesAt(m, x, y, z) {
    var out = [];
    var ents = m.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i]; if (!e.alive) continue;
      if (Math.floor(e.pos.x) === x && Math.floor(e.pos.z) === z && (Math.floor(e.pos.y) === y || Math.floor(e.pos.y + 1) === y)) out.push(e);
    }
    return out;
  };
  function findStanding(m, p, dest) {
    var w = m.world;
    for (var r = 0; r <= 5; r++) {
      for (var a = 0; a < 8; a++) {
        var ang = a / 8 * Math.PI * 2;
        var x = dest.x + Math.cos(ang) * r, z = dest.z + Math.sin(ang) * r;
        var sx = Math.floor(x) + 0.5, sz = Math.floor(z) + 0.5;
        var y = w.surfaceY(Math.floor(x), Math.floor(z)) + 1;
        if (y > 0 && y < w.SY - 2 && !m.entitiesAt(Math.floor(x), y, Math.floor(z)).length) return { x: sx, y: y, z: sz };
      }
    }
    return dest;
  };


  G.Systems = G.Systems || {};
  G.Systems.Aim = { defaultAim: defaultAim, useHotkey: useHotkey, updateAim: updateAim, rayEntity: rayEntity, aimEntity: aimEntity, targetsInRadius: targetsInRadius, entitiesAt: entitiesAt, findStanding: findStanding };
})(window.GW);
