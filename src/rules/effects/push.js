/* 原子处理器：由 rules.js 的 registry 分发；G.RULES_EFFECTS 在 rules 加载时已建。 */
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  /* push · 以自身为心的击退 */
  G.RULES_EFFECTS.push = function (ef, card, p, ctx) {
    var m = ctx.match, hit = m.targetsInRadius(p, { x: p.pos.x, y: p.pos.y, z: p.pos.z }, 4.2);
    for (var q = 0; q < hit.length; q++) {
      if (hit[q].side === p.side) continue;
      if (hit[q].st.sturdy) continue;
      var vx = hit[q].pos.x - p.pos.x, vz = hit[q].pos.z - p.pos.z, L = Math.sqrt(vx * vx + vz * vz) || 1;
      hit[q].vel.x += vx / L * ef.power; hit[q].vel.z += vz / L * ef.power; hit[q].vel.y += ef.up || 0;
    }
    if (ctx.fx) ctx.fx.sfx('push');
  };
})(window.GW);
