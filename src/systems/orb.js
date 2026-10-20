/* js/systems/orb.js · 盾球（从 battle.js 的 orbPos / stepOrbs / orbBlock 搬出，行为逐字不变） */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function orbPos(m, p, i) {
    var sp = p.orbSpec; if (!sp) return null;
    var a = (p.orbPhase || 0) + i / sp.count * Math.PI * 2;
    return { x: p.pos.x + Math.cos(a) * sp.radius, y: p.pos.y + (i % 2 ? 0.25 : -0.2), z: p.pos.z + Math.sin(a) * sp.radius };
  };

  function step(m, dt) {
    var all = m.all();
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (!p.orbSpec) continue;
      p.orbPhase = (p.orbPhase || 0) + (p.orbSpec.spin || 1.6) * dt;
      p.orbTtl -= dt;
      if (p.orbTtl <= 0) { p.orbSpec = null; p.orbs = null; if (m.fx.burst) m.fx.burst(p.pos, '#7fd7ff', 8); }
    }
  };

  function block(m, pr, ax, ay, az, bx, by, bz) {
    var all = m.all(), sx = bx - ax, sy = by - ay, sz = bz - az;
    var seg2 = sx * sx + sy * sy + sz * sz;
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (!t.alive || t.side === pr.side || !t.orbSpec || !t.orbs) continue;
      for (var oi = 0; oi < t.orbSpec.count; oi++) {
        var orb = t.orbs[oi];
        if (!orb || orb.hp <= 0) continue;
        var oc = orbPos(m, t, oi);
        var px = ax - oc.x, py = ay - oc.y, pz = az - oc.z;
        var u = seg2 > 1e-9 ? -(px * sx + py * sy + pz * sz) / seg2 : 0;
        u = u < 0 ? 0 : (u > 1 ? 1 : u);
        var dx = px + sx * u, dy = py + sy * u, dz = pz + sz * u;
        if (dx * dx + dy * dy + dz * dz < 0.9) {   // 盾球判定半径 ~0.95 格（贴脸才漏）
          orb.hp--;
          return { owner: t, orb: orb, at: oc };
        }
      }
    }
    return null;
  };

  G.Systems = G.Systems || {};
  G.Systems.Orb = { pos: orbPos, step: step, block: block };
})(window.GW);
