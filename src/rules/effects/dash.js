/* dash · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.dash = function (ef, card, p, ctx, mult) {
    /* 方向优先用本次瞄准点（快捷键会把它设成移动方向），没有就按朝向。 */
            var fdx, fdz;
            if (ctx.aim) {
              var ddx2 = ctx.aim.x - p.pos.x, ddz2 = ctx.aim.z - p.pos.z;
              var dl2 = Math.sqrt(ddx2 * ddx2 + ddz2 * ddz2) || 1;
              fdx = ddx2 / dl2; fdz = ddz2 / dl2;
            } else { fdx = Math.sin(p.yaw); fdz = Math.cos(p.yaw); }
            p.vel.x += fdx * (ef.power || 14);
            p.vel.z += fdz * (ef.power || 14);
            p.vel.y = Math.max(p.vel.y, ef.up || 2.5);
            if (ef.iframes) p.invuln = Math.max(p.invuln || 0, ef.iframes);
            if (ctx.fx && ctx.fx.burst) ctx.fx.burst(p.pos, '#c58cff', 14);
  };
})(window.GW);
