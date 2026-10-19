/* quake · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.quake = function (ef, card, p, ctx, mult) {
    if (ctx.fx && ctx.fx.quake) ctx.fx.quake(ef.power || 1);
            if (G.VFX && G.VFX.event) G.VFX.event('quake', { pos: ctx.aim, power: ef.power || 1 });
  };
})(window.GW);
