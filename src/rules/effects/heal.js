/* heal · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.heal = function (ef, card, p, ctx, mult) {
    p.hp = Math.min(p.maxHp, p.hp + ef.amount); if (ctx.fx) ctx.fx.heal(p); 
  };
})(window.GW);
