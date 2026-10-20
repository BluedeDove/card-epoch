/* status · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.status = function (ef, card, p, ctx, mult) {
    var m = ctx.match;
    /* 射线类卡牌的负面状态必须**跟着抛射物走**：以前焰矢的"点燃 3 秒"在出牌那一刻
               就往准星上的目标脸上糊，玩家那发小球根本没打中也算中了——正是用户说的
               "判定只有小球那一格、却莫名其妙掉血/不疼"的两面。
               有弹道就挂到弹上，由 battle.js 命中时结算；没有弹道（自身/范围类）才立刻结算。 */
            /* 有弹道的射线卡：状态（点燃 / 减速 / 定身）全部挂到弹上，命中才结算，带半径的按爆心范围结算。
               判据是"这一张卡有没有抛出抛射物"，不是"有没有写半径"——缠根那种带半径的定身
               以前会在出牌瞬间按准星算一遍，小球根本没打中的人也照样被定住。 */
            if (ctx.projectile && card.targeting && card.targeting.shape === 'ray') {
              ctx.projectile.status = { kind: ef.kind, dur: ef.dur, radius: ef.radius || 0 };
              
            }
            var targets = ef.radius ? m.targetsInRadius(p, ctx.aim, ef.radius) : (function () {
              var t = m.aimEntity(p, ctx.aim); return t ? [t] : [];
            })();
            for (var s = 0; s < targets.length; s++) G.Rules.addStatus(targets[s], ef.kind, ef.dur);
            /* 冰系范围状态顺手唤醒一次寒源：让霜爆/冰封在冻人的同时把脚下的水冻成冰 */
            if (ef.radius && card.element === 'ice' && ctx.aim && G.CHEM && G.CHEM.ready)
              G.CHEM.catalyst('cold', Math.floor(ctx.aim.x), Math.floor(ctx.aim.y), Math.floor(ctx.aim.z), Math.round(ef.radius * 0.7));
  };
})(window.GW);
