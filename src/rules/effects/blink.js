/* 原子处理器：由 rules.js 的 registry 分发；G.RULES_EFFECTS 在 rules 加载时已建。 */
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  /* blink · 沿瞄准方向落到可站立点（不是瞬移穿墙：findStanding 负责找落点） */
  G.RULES_EFFECTS.blink = function (ef, card, p, ctx) {
    var m = ctx.match, aim = ctx.aim || { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    var dx = aim.x - p.pos.x, dy = aim.y - p.pos.y, dz = aim.z - p.pos.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, d = Math.min(len, ef.dist);
    var dest = m.findStanding(p, { x: p.pos.x + dx / len * d, y: aim.y, z: p.pos.z + dz / len * d });
    if (ctx.fx) ctx.fx.burst(p.pos, '#c58cff', 14);
    p.pos.x = dest.x; p.pos.y = dest.y + p.h / 2 + 0.02; p.pos.z = dest.z; p.vel.set(0, 0, 0);
    if (ctx.fx) ctx.fx.burst(dest, '#c58cff', 16);
  };
})(window.GW);
