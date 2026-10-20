/* harvest · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.harvest = function (ef, card, p, ctx, mult) {
    var w = ctx.world;
    var t = ctx.aimTarget;
            if (t && t.id === G.BLOCK.CRYSTAL) {
              w.set(t.x, t.y, t.z, 0); p.mana = Math.min(p.manaCap, p.mana + 3); p.mats += 1;
              /* 矿上那几根晶体交给矿脉系统排 12 秒原位再生（定案 CARD_ECONOMY §3.3）：这里只报坐标，
                 队列与"只写 AIR"的边界都在 LodeSystem 里。守卫式调用——旁路单测（没有 match）或矿脉系统
                 未挂载时，就当这根采掉不再长，不影响本次收获（+1 素材 / +3 魔力 已在上一步入账）。 */
              if (ctx.match && ctx.match.onCrystalHarvested) ctx.match.onCrystalHarvested(t.x, t.y, t.z);
              if (ctx.fx) { ctx.fx.burst({ x: t.x + .5, y: t.y + .5, z: t.z + .5 }, '#b26bff', 20); ctx.fx.sfx('crystal'); }
            }
  };
})(window.GW);
