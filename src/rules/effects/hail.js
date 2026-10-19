/* hail · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.hail = function (ef, card, p, ctx, mult) {
    var m = ctx.match;
    { for (var h = 0; h < ef.count; h++) m.spawnHail(p, ctx.aim, ef.dmg, h);  }
  };
})(window.GW);
