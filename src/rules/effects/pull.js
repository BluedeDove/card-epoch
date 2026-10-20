/* 原子处理器：由 rules.js 的 registry 分发；G.RULES_EFFECTS 在 rules 加载时已建。 */
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  /* pull · 以瞄准点为心的拉扯 */
  G.RULES_EFFECTS.pull = function (ef, card, p, ctx) {
    var m = ctx.match, pulled = m.targetsInRadius(p, ctx.aim, ef.radius || 4);
    for (var pi = 0; pi < pulled.length; pi++) {
      var pe = pulled[pi];
      if (pe.st && pe.st.sturdy) continue;
      var pvx = ctx.aim.x - pe.pos.x, pvz = ctx.aim.z - pe.pos.z;
      var pl = Math.sqrt(pvx * pvx + pvz * pvz) || 1;
      pe.vel.x += pvx / pl * (ef.power || 10) * 0.5;
      pe.vel.z += pvz / pl * (ef.power || 10) * 0.5;
      if (pe.pos.y < ctx.aim.y + 1.5) pe.vel.y += 2.2;
    }
    if (ctx.fx) ctx.fx.sfx('push');
  };
})(window.GW);
