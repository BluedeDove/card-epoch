/* js/systems/sigil.js · 法阵（add/at/tick；从 battle.js 搬出，行为逐字不变）
   来源：addSigil / sigilAt / sigilTick。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function fxUid(m) { return (m._fxUid = (m._fxUid || 0) + 1); }
  function fxEv(name, data) { if (G.VFX && G.VFX.event) G.VFX.event(name, data); }
  function addSigil(m, card, owner, aim, delay, ttl, presetId) {
    if (!aim) return null;
    var preset = presetId && G.SIGILS[presetId] ? Object.assign({ id: presetId }, G.SIGILS[presetId]) : (card && G.SIGILS[card.id]);
    if (!preset) return null;
    var s = {
      id: preset.id, preset: preset, card: card, owner: owner, side: owner.side,
      pos: { x: aim.x, y: aim.gy !== undefined ? aim.gy + 1.02 : aim.y, z: aim.z },
      radius: aim.gx !== undefined && preset.radius ? preset.radius : 2.5,
      uid: fxUid(this), fx: preset.fx || null,
      born: m.time, delay: delay || 0, ttl: ttl || preset.ttl || 6, active: false, hp: preset.hp || 40, dead: false, acc: 0, frozenAcc: 0
    };
    s.radius = preset.radius || 2.5;
    m.sigils.push(s);
    m.fx.sfx('sigil');
    return s;
  };
  function sigilAt(m, aim) {
    if (!aim) return null;
    for (var i = 0; i < m.sigils.length; i++) {
      var s = m.sigils[i];
      if (Math.hypot(s.pos.x - aim.x, s.pos.z - aim.z) < s.radius + 0.6 && Math.abs(s.pos.y - aim.y) < 4) return s;
    }
    return null;
  };
  function sigilTick(m, dt, ctx) {
    for (var i = m.sigils.length - 1; i >= 0; i--) {
      var s = m.sigils[i];
      var age = m.time - s.born;
      if (s.dead || age > s.delay + s.ttl) {
        if (s.dead) { m.fx.burst(s.pos, s.preset.color, 20); fxEv('sigilBreak', { pos: s.pos, color: s.preset.color, radius: s.radius, sigil: s }); }
        else fxEv('sigilEnd', { pos: s.pos, color: s.preset.color, radius: s.radius, sigil: s });
        m.sigils.splice(i, 1); continue;
      }
      if (age < s.delay) continue;
      if (!s.active) { s.active = true; m.fx.burst(s.pos, s.preset.color, 26); m.fx.sfx('sigilGo'); fxEv('sigilGo', { pos: s.pos, color: s.preset.color, radius: s.radius, sigil: s }); }
      /* 陨星阵（preset.meteorEvery）：与"圈内周期伤害"是两条独立的线——
         陨星是**真弹**，会被墙挡住、会在空中被地形提前引爆，所以"躲到墙后面对付陨石"是真的可行。
         节拍器写成独立的累加器（不借用 s.acc），两条线的周期互不干扰。 */
      /* 多段节拍（2026-10-17 用户："所有法术都是一个大前摇、嘣一下就完了，没有二阶三阶的节奏"）：
         preset.beats = [{at, dmg, radius, knock, kind, status}]，到点各放一次——
         每段都是**真实结算**（同一套 explode/伤害通道），配 fxEv('beat') 让画面跟着换档。 */
      if (s.preset.beats && s.preset.beats.length) {
        var liveAge = age - s.delay;
        for (var bi2 = 0; bi2 < s.preset.beats.length; bi2++) {
          var bt = s.preset.beats[bi2];
          /* 已放过的拍记在**这枚法阵**上（s.beatDone），不能写回 preset——
             preset 是全局共享的数据，第一座阵打过之后所有阵就再也打不出这一拍了。 */
          s.beatDone = s.beatDone || {};
          if (s.beatDone[bi2] || liveAge < (bt.at || 0)) continue;
          s.beatDone[bi2] = 1;
          var bpos = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
          if (bt.dmg) {
            if (bt.ff) {
              /* 敌我不分（核弹级）：与 detonateNuke 同一口径——半径内**所有**实体，包括施放者。 */
              var bAll = m.all();
              for (var bj = 0; bj < bAll.length; bj++) {
                var eb2 = bAll[bj];
                if (!eb2.alive) continue;
                var bdx = eb2.pos.x - bpos.x, bdz = eb2.pos.z - bpos.z;
                if (Math.sqrt(bdx * bdx + bdz * bdz) > (bt.radius || s.radius)) continue;
                G.Rules.damage(eb2, bt.dmg, bt.kind || s.preset.kind || 'fire', m.ctx, s.owner || null);
              }
            } else {
              m.explode(s.owner || m.players[s.side], bpos, bt.dmg, bt.kind || s.preset.kind || 'fire', bt.radius || s.radius, m.ctx, { status: bt.status });
            }
          }
          if (bt.knock) {
            var kn = m.targetsInRadius(m.players[s.side], bpos, bt.radius || s.radius);
            for (var ki = 0; ki < kn.length; ki++) kn[ki].vel.y += bt.knock;
          }
          if (bt.crater) m.digCrater(bpos.x, bpos.y, bpos.z, bt.crater.r, bt.crater.depth, bt.crater.budget || 400);
          m.fx.quake && m.fx.quake(0.35 + bi2 * 0.3);
          fxEv('beat', { pos: bpos, i: bi2, n: s.preset.beats.length, radius: bt.radius || s.radius, kind: bt.kind || s.preset.kind });
        }
      }
      /* 终末（核弹级）：阵起之后只响一次。伤害与地形都走"全员 + 大碗坑"，
         特效侧由 fxEv('nuke') 接；这里只做权威结算（谁掉血、哪块地被抹掉）。 */
      if (s.preset.nuke && !s.nuked) { s.nuked = true; m.detonateNuke(s); }
      if (s.preset.meteorEvery) {
        s.meteorAcc = (s.meteorAcc || 0) + dt;
        var mGuard = 0;
        while (s.meteorAcc >= s.preset.meteorEvery && mGuard++ < 4) {
          s.meteorAcc -= s.preset.meteorEvery;
          m.spawnMeteor(s);
        }
      }
      /* 持续吸附：**每 tick** 走一次位置推移（不是每 0.4 秒给一次速度）。
         为什么不能靠速度：玩家/随从的 applyInput 每 tick 都会把速度往"输入方向"拉（44 的加速度），
         外来的速度增量 8 个 tick 就衰减光了——实测 2 秒只挪 0.34 格，读感是"黑洞没用"。
         位置推移不受这条物理约束，而且仍然会撞上墙（collideAABB 在下一 tick 照样挡）。
         力度按 preset.pull 换算成"格/秒"：pull 14 ≈ 1.4 格/秒。 */
      if (s.preset.pull) {
        var pulled2 = m.targetsInRadius(m.players[s.side], s.pos, s.radius);
        var stepIn = 0.07 * Math.min(2, (s.preset.pull || 14) / 14) * (dt / 0.05);
        for (var pq = 0; pq < pulled2.length; pq++) {
          var ee2 = pulled2[pq];
          if (ee2.st && ee2.st.sturdy) continue;
          var ex2 = s.pos.x - ee2.pos.x, ez2 = s.pos.z - ee2.pos.z;
          var el3 = Math.sqrt(ex2 * ex2 + ez2 * ez2) || 1;
          ee2.pos.x += ex2 / el3 * stepIn;
          ee2.pos.z += ez2 / el3 * stepIn;
        }
      }
      s.acc += dt;
      var ev = s.preset.tickEvery || 0.6;
      if (s.acc >= ev) {
        s.acc = 0;
        var victims = m.targetsInRadius(m.players[s.side], s.pos, s.radius);
        if (s.preset.allyOnly) {
          if (s.preset.heal) { var al = m.all().filter(function (e) { return e.side === s.side && e.alive; }); for (var q = 0; q < al.length; q++) { if (Math.hypot(al[q].pos.x - s.pos.x, al[q].pos.z - s.pos.z) < s.radius) { al[q].hp = Math.min(al[q].maxHp, al[q].hp + s.preset.heal); m.fx.heal(al[q]); } } }
          if (s.preset.id === 'totem') { m.players[s.side].mana = Math.min(m.players[s.side].manaCap, m.players[s.side].mana + 1); }
        } else {
          for (var v = 0; v < victims.length; v++) {
            if (s.preset.dmg) G.Rules.damage(victims[v], s.preset.dmg, s.preset.kind, ctx, m.players[s.side]);
            if (s.preset.slow) G.Rules.addStatus(victims[v], 'slow', s.preset.slow);
            if (s.preset.root) G.Rules.addStatus(victims[v], 'root', s.preset.root);
            if (s.preset.knock) { victims[v].vel.y += s.preset.knock; }
            /* 持续吸附（黑洞）：每个节拍往阵心拽一点。用速度增量而不是瞬移，
               所以"站着不动也被拖、往外走还能勉强撑住"——这条手感比一次性拉过去好读。 */
            if (s.preset.pull) {
              var pvx = s.pos.x - victims[v].pos.x, pvz = s.pos.z - victims[v].pos.z;
              var pl2 = Math.sqrt(pvx * pvx + pvz * pvz) || 1;
              victims[v].vel.x += pvx / pl2 * s.preset.pull * 0.35;
              victims[v].vel.z += pvz / pl2 * s.preset.pull * 0.35;
              if (victims[v].pos.y < s.pos.y + 1.5) victims[v].vel.y += 1.8;
            }
            if (s.preset.ignites) { victims[v].st.burn = 3; }
          }
          if (s.preset.frozenEvery) {
            s.frozenAcc += ev;
            if (s.frozenAcc >= s.preset.frozenEvery) { s.frozenAcc = 0; for (var f = 0; f < victims.length; f++) G.Rules.addStatus(victims[f], 'frozen', 1.4); }
          }
          if (victims.length) m.fx.burst(s.pos, s.preset.color, 8);
          /* 法阵也是元素源：陨星阵把圈里的树点着、冰川阵把圈里的水面冻住、熔池持续烤化旁边的冰。
             读 preset.kind 而不是判 id——加一种阵法只要 cards.js 里写清 kind，这里不用改。 */
          if (G.chemCatalyst && s.preset.dmg) G.chemCatalyst(s.preset.kind, s.pos, Math.max(1, Math.round(s.radius * 0.55)));
        }
        if (s.preset.once && s.active) { s.dead = true; }
      }
    }
  };

  /* 共用的小型挖坑器（陨星落点 / 核爆都走这一条）：碗形、有格数预算、永不碰基岩。
     2026-10-17 用户要求"每颗流星都要有破坏效果"——坑的形状与核弹同一套几何，只是半径小。 */

  G.Systems = G.Systems || {};
  G.Systems.Sigil = { addSigil: addSigil, sigilAt: sigilAt, sigilTick: sigilTick };
})(window.GW);
