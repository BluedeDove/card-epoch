/* shield · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.shield = function (ef, card, p, ctx, mult) {
    p.shield = (p.shield || 0) + ef.amount; p.shieldT = Math.max(p.shieldT || 0, ef.dur); if (ctx.fx) ctx.fx.shieldUp(p); 
  };
})(window.GW);
