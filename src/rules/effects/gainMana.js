/* gainMana · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.gainMana = function (ef, card, p, ctx, mult) {
    p.mana = Math.min(p.manaCap, p.mana + ef.amount); 
  };
})(window.GW);
