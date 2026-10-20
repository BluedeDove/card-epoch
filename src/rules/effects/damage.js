/* damage · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.damage = function (ef, card, p, ctx, mult) {
    var m = ctx.match;
    if (card.targeting.shape === 'ray') m.fireProjectile(p, card, ef, ctx, mult);
            else m.explode(p, ctx.aim, ef.amount * mult, ef.kind, ef.radius, ctx);
  };
})(window.GW);
