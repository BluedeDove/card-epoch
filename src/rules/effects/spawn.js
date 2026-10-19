/* js/rules/effects/spawn.js · spawn 原子（S3 收尾：从 rules 的 switch 搬出）
   只做"放几只随从"，弹道元素由 card 带下去；不认识卡 id，不写文案。 */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.spawn = function (ef, card, p, ctx) {
    var m = ctx.match;
    for (var n = 0; n < ef.count; n++) m.spawnSummon(p, ef, card, ctx.aim);
  };
})(window.GW);
