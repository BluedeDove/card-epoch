/* js/systems/damage.js · 伤害/状态/每 tick 实体维护（从 rules.js 搬出，行为逐字不变）
   来源：R.addStatus / R.statusSpeed / R.damage / R.tick 的实体段。
   规矩：hp 的唯一写入口是 damage()；R.tick 只负责编排（chem/fluid/sigil 仍在 rules）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK;
  var NO_WHEN_INVULN = { frozen: 1, root: 1, slow: 1, burn: 1, vuln: 1 };
  function addStatus(t, kind, dur, power) {
    if (!t || typeof t !== 'object') return;
    if (t.kind === 'player' && t.creative && t.creative.invuln && NO_WHEN_INVULN[kind]) return;
    if (!t.st || typeof t.st !== 'object') t.st = {};
    if (kind === 'frozen' && t.st.sturdy) return;
    t.st[kind] = dur;
    if (power) { if (!t.stPow || typeof t.stPow !== 'object') t.stPow = {}; t.stPow[kind] = power; }
  };
  function statusSpeed(t) {
    var s = 1;
    if (!t.st || typeof t.st !== 'object') t.st = {};
    if (t.st.frozen || t.st.root) return 0;
    if (t.st.slow) s *= 0.5;
    if (t.st.haste) s *= 1 + (t.stPow && t.stPow.haste ? t.stPow.haste : 0.5);
    return s;
  };


  function damage(m, t, amount, kind, ctx, src, opts) {
    if (!t || t.dead || !t.alive) return;
    var selfHarm = !!(opts && opts.selfHarm);
    if (!selfHarm && t.invuln > 0) return;
    /* 创造模式无敌：坠落伤、岩浆、AI 与自己的误伤统统不落地。
       伤害飘字与死亡仍然按普通规则走（打假人时看得到数字）。 */
    if (t.kind === 'player' && t.creative && t.creative.invuln) return;
    if (t.st.vuln) amount *= 1.35;
    if (t.kind === 'summon' && t.st.frozen) amount *= 1.25;
    if (!selfHarm && (t.shield || 0) > 0) {
      var absorbed = Math.min(t.shield, amount); t.shield -= absorbed; amount -= absorbed;
      if (ctx && ctx.fx) ctx.fx.sfx('shield');
      if (t.shield <= 0) t.shieldT = 0;
    }
    /* src 一起报给表现层：被打的人震一下、打人的那一位也震一下（"命中的重量"）。
       伤害结算本身不看它——加不加这条，血量与死亡判定一个字节都不变。 */
    if (amount > 0) { t.hp -= amount; if (ctx && ctx.fx) ctx.fx.hit(t, amount, kind, src); }
    if (t.hp <= 0) { t.hp = 0; if (m && m.kill) m.kill(t, src, ctx); }
  };
  function tick(m, dt, ctx) {
    var w = ctx.world;
    var ents = m.all();
    var ents = m.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (e.dead) continue;
      for (var key in e.cooldowns) if (e.cooldowns[key] > 0) e.cooldowns[key] = Math.max(0, e.cooldowns[key] - dt);
      for (var s in e.st) {
        if (e.st[s] > 0) {
          e.st[s] -= dt;
          if (e.st[s] <= 0) delete e.st[s];
        }
      }
      if (e.st.burn > 0) { if (e.burnTick === undefined) e.burnTick = 0; e.burnTick += dt; if (e.burnTick >= 1) { e.burnTick = 0; damage(m, e, 4, 'fire', ctx); if (ctx.fx) ctx.fx.fire(e.pos); } }
      if (e.st.regen > 0 && e.hp > 0) { e.regenAcc = (e.regenAcc || 0) + dt; if (e.regenAcc >= 1) { e.regenAcc = 0; e.hp = Math.min(e.maxHp, e.hp + ((e.stPow && e.stPow.regen) || 2)); } }
      if (e.shieldT > 0) { e.shieldT -= dt; if (e.shieldT <= 0) e.shield = 0; }
      if (e.invuln > 0) e.invuln -= dt;
      // 站在水/岩浆里
      var feet = w.get(Math.floor(e.pos.x), Math.floor(e.pos.y), Math.floor(e.pos.z));
      if (feet === B.LAVA) { e.lavaAcc = (e.lavaAcc || 0) + dt; if (e.lavaAcc > 0.35) { e.lavaAcc = 0; damage(m, e, 9, 'fire', ctx); } }
      else if (feet === B.WATER && e.kind === 'player') e.swim = true; else e.swim = false;
      var below = w.get(Math.floor(e.pos.x), Math.floor(e.pos.y - 1), Math.floor(e.pos.z));
      e.onIce = below === B.ICE && (below !== 0);
    }

  }
  G.Systems = G.Systems || {};
  G.Systems.Damage = { damage: damage, addStatus: addStatus, statusSpeed: statusSpeed, tick: tick };
})(window.GW);
