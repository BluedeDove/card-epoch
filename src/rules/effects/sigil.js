/* js/rules/effects/sigil.js · sigil 原子（S3 收尾）
   一张卡可以铺多座阵：dx/dz 相对落点偏移，sigilId 决定 preset；battle 只认 preset。 */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.sigil = function (ef, card, p, ctx) {
    var m = ctx.match, aimS = ctx.aim;
    if (ctx.aim && (ef.dx || ef.dz)) {
      var sx1 = ctx.aim.x + (ef.dx || 0), sz1 = ctx.aim.z + (ef.dz || 0);
      aimS = { x: sx1, y: ctx.aim.y, z: sz1, gx: Math.floor(sx1), gy: ctx.aim.gy, gz: Math.floor(sz1), face: ctx.aim.face };
    }
    m.addSigil(card, p, aimS, ef.delay, ef.ttl, ef.sigilId || null);
  };
})(window.GW);
