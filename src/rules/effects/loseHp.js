/* loseHp · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.loseHp = function (ef, card, p, ctx, mult) {
    G.Rules.damage(p, ef.amount, 'self', ctx, null, { selfHarm: true }); 
  };
})(window.GW);
