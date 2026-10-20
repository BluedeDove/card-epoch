/* destroySigil · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.destroySigil = function (ef, card, p, ctx, mult) {
    var m = ctx.match;
    var sg = m.sigilAt(ctx.aim);
            if (sg) { sg.dead = true; if (ctx.fx) { ctx.fx.burst(sg.pos, '#c58cff', 24); ctx.fx.log('法阵被破阵', '#c58cff'); } }
  };
})(window.GW);
