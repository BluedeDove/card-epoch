/* swap · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.swap = function (ef, card, p, ctx, mult) {
    var m = ctx.match;
    var e2 = m.aimEntity(p, ctx.aim);
            if (e2 && e2.kind === 'summon') { var tmp = { x: p.pos.x, y: p.pos.y, z: p.pos.z }; p.pos.x = e2.pos.x; p.pos.y = e2.pos.y; p.pos.z = e2.pos.z; e2.pos.x = tmp.x; e2.pos.y = tmp.y; e2.pos.z = tmp.z; }
  };
})(window.GW);
