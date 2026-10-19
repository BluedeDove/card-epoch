/* draw · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.draw = function (ef, card, p, ctx, mult) {
    var m = ctx.match;
    m.drawCards(p, ef.count); 
  };
})(window.GW);
