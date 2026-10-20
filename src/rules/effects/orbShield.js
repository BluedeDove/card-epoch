/* 原子处理器：由 rules.js 的 registry 分发；G.RULES_EFFECTS 在 rules 加载时已建。 */
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  /* orbShield · 环绕盾球：p.orbs 是权威状态，碰撞在 battle.orbBlock */
  G.RULES_EFFECTS.orbShield = function (ef, card, p, ctx) {
    p.orbSpec = { count: Math.max(1, ef.count || 3), radius: ef.radius || 1.7, spin: ef.spin || 1.8, hp: ef.hp || 2 };
    p.orbs = [];
    for (var oi2 = 0; oi2 < p.orbSpec.count; oi2++) p.orbs.push({ hp: p.orbSpec.hp });
    p.orbTtl = ef.dur || 8; p.orbPhase = 0;
    if (ctx.fx && ctx.fx.sfx) ctx.fx.sfx('shield');
  };
})(window.GW);
