/* 原子处理器：由 rules.js 的 registry 分发；G.RULES_EFFECTS 在 rules 加载时已建。 */
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  /* spirit · 灵光追踪原子：只负责放几只、交给 battle 的抛射物推进画弧线 */
  G.RULES_EFFECTS.spirit = function (ef, card, p, ctx, mult) {
    var m = ctx.match, howMany = Math.max(1, ef.count || 3);
    for (var si2 = 0; si2 < howMany; si2++) m.fireSpirit(p, card, ef, ctx, mult, si2);
  };
})(window.GW);
