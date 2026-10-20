/* flight · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.flight = function (ef, card, p, ctx, mult) {
    G.Rules.addStatus(p, 'fly', ef.dur || 3);
            if (ctx.fx && ctx.fx.burst) ctx.fx.burst(p.pos, '#7fd7ff', 12);
  };
})(window.GW);
