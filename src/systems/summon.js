/* js/systems/summon.js · 随从（spawn/step/AI/flyer/bolt；从 battle.js 搬出，行为逐字不变）
   来源：Match.prototype.spawnSummon / removeSummon / stepSummons / aiAggro / stepFlyer / summonBolt。
   调用约定：第一个参数是状态容器 m。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  function V(x, y, z) { return new G.V(x, y, z); }
  var GRAV = (G.PHYS && G.PHYS.GRAV) || 24;
  function fxUid(m) { return (m._fxUid = (m._fxUid || 0) + 1); }
  function spawnSummon(m, owner, ef, card, aim) {
    /* 飞行体（2026-10-17）：body 更小更轻（h 1.0 / w 0.7），不吃重力、不走地面碰撞，
       悬在目标上方隔空开火或撞上去自爆。这些是**权威行为标记**（不是视觉量），
       渲染层只读它们决定光环挂在哪（见 js/vfx-render.js 的 su.fly）。 */
    var fly = !!ef.fly;
    var s = G.baseEntity({
      kind: 'summon', side: owner.side, name: (G.SUMMON_CN && G.SUMMON_CN[ef.kind]) || ef.kind, aiKind: ef.kind,
      hp: ef.hp || 20, maxHp: ef.hp || 20, dmg: ef.dmg || 5, speed: ef.speed || 3.2, ai: ef.ai || 'melee',
      taunt: !!ef.taunt, pos: new V(owner.pos.x, owner.pos.y, owner.pos.z), ttl: 45, atkCd: 0, state: 'seek',
      fly: fly, h: fly ? 1.0 : 1.7, w: fly ? 0.74 : 0.6,
      /* 两类召唤（2026-10-17 用户："要区分出自动跟踪和指向性两类"）：
         track  = 自动索敌（跟着最近的敌人跑）；
         direct = 指向性：落在施法瞄准的那个点上驻守，只打驻守圈里的敌人，目标跑出去就回岗。 */
      mode: ef.mode === 'direct' ? 'direct' : 'track',
      leash: ef.leash || 7, home: null,
      range: ef.range || 9, suicide: ef.ai === 'suicide',
      boltEl: (card && card.element) || 'physical', projSpeed: ef.projSpeed || (fly ? 26 : 24)
    });
    var st = m.findStanding(owner, { x: owner.pos.x + (m.rng() - .5) * 3, y: owner.pos.y, z: owner.pos.z + (m.rng() - .5) * 3 });
    if (fly) s.pos.set(st.x, Math.max(st.y + 1.4, owner.pos.y + 1.1), st.z);
    else s.pos.set(st.x, st.y + s.h / 2 + 0.02, st.z);
    s.uid = fxUid(this); s.born = m.time;
    s.hoverY = s.pos.y;
    if (s.mode === 'direct') {
      /* 指向性召唤**直接落在目标点**（而不是自己脚下）——这是两类最直观的差别。 */
      var hp0 = aim ? { x: aim.x, y: aim.y, z: aim.z } : { x: owner.pos.x, y: owner.pos.y, z: owner.pos.z };
      s.home = hp0;
      var stand = m.findStanding(owner, { x: hp0.x, y: hp0.y, z: hp0.z });
      if (fly) s.pos.set(stand.x, Math.max(stand.y + 1.6, hp0.y + 1.2), stand.z);
      else s.pos.set(stand.x, stand.y + s.h / 2 + 0.02, stand.z);
    }
    m.summons.push(s);
    m.fx.burst({ x: s.pos.x, y: s.pos.y + (fly ? 0.2 : 1), z: s.pos.z }, G.ELEMENTS[(card && card.element) || owner.element || 'nature'].color, fly ? 26 : 18);
    if (fly) m.fx.sfx('sigilGo');
    return s;
  };
  function removeSummon(m, s) { var i = m.summons.indexOf(s); if (i >= 0) m.summons.splice(i, 1); };
  function stepSummons(m, dt) {
    var world = m.world;
    for (var i = m.summons.length - 1; i >= 0; i--) {
      var s = m.summons[i];
      /* 2026-10-17：飞行体自爆 / 范围伤害会在**本循环里**顺手打死别的随从并 splice 掉，
         下标一错位 m.summons[i] 就是 undefined，下一行读 s.alive 直接抛
         （审计 A 项 catch 到的就是这个："Cannot read properties of undefined (reading 'alive')"）。
         这里只多一道空值守卫：已经不在表里的就当它已经没了。 */
      if (!s) continue;
      if (!s.alive) { m.summons.splice(i, 1); continue; }
      s.ttl -= dt;
      if (s.ttl <= 0) { m.fx.log(s.name + ' 消散了', '#8a94a6'); m.removeSummon(s); continue; }
      if (s.dummy) {                                 // 训练假人：只吃物理不还手，专门用来反复测伤害
        s.vel.x *= 0.7; s.vel.z *= 0.7; s.vel.y -= GRAV * dt;
        m.unstick(s); m.collideAABB(s, dt);
        continue;
      }
      /* 索敌（T4 换成「敌我表」，GAMEPLAY §2.5：新机制不许再写死 2）：敌我只由 side 决定——
         side >= 0 的对手是另一侧那一名玩家；side < 0 是「中立生态」（晶甲兽），谁都是它的敌人。
         旧写法 m.players[1 - s.side] 对中立取到 players[2] === undefined，等于「中立怪谁都不打」，
         而且与 AI 那边的敌我口径各写一份（历史上两套 fwd 就是这么翻车的）。
         单玩家图里 players[1-side] 是 undefined：nearest 的 !list[i] 守卫会把它滤掉。 */
      var foes = s.side >= 0 ? [m.players[1 - s.side]] : m.players.slice();
      var foe = nearest(s, foes);
      var target = null;
      var enemies = m.summons.filter(function (o) { return o.side !== s.side && o.alive; });
      var taunts = enemies.filter(function (o) { return o.taunt; });
      if (taunts.length) target = nearest(s, taunts);
      else if (foe) target = m.aiAggro(s) ? foe : nearest(s, enemies.concat([foe]));
      else target = nearest(s, enemies);
      /* 指向性召唤：拴在 home 上。目标跑出驻守圈就放弃、回岗——"指向"才成立。 */
      if (s.mode === 'direct' && s.home) {
        var outLeash = !target || Math.hypot(target.pos.x - s.home.x, target.pos.z - s.home.z) > s.leash;
        if (outLeash) {
          var toHome = Math.hypot(s.pos.x - s.home.x, s.pos.z - s.home.z);
          if (toHome > 1.6) {
            var hsp = s.speed * G.Rules.statusSpeed(s);
            moveToward(s, { x: s.home.x, z: s.home.z }, hsp, dt);
            s.yaw = Math.atan2(s.home.x - s.pos.x, s.home.z - s.pos.z);
            s.state = 'guard';
            if (s.fly) { m.stepFlyer(s, { pos: s.home, h: 0.5, alive: true, vel: new V(0,0,0) }, toHome, dt); continue; }
            s.vel.y -= GRAV * dt; m.unstick(s); m.collideAABB(s, dt); continue;
          }
          target = null;
        }
      }
      if (!target) { s.state = 'idle'; continue; }
      var dx = target.pos.x - s.pos.x, dz = target.pos.z - s.pos.z, dist = Math.sqrt(dx * dx + dz * dz);
      s.yaw = Math.atan2(dx, dz);
      var spd = s.speed * G.Rules.statusSpeed(s);
      if (s.fly) { m.stepFlyer(s, target, dist, dt); continue; }   // 飞行体不进地面物理分支
      if (s.ai === 'healer') {
        // 治疗者：贴近友方玩家，定期治疗；血量低时逃远
        /* 中立单位（side < 0）没有「友方玩家」：m.players[-1] 是 undefined，
           所以下面每一处用到 ally 的地方都带守卫（含 Math.hypot 前那一处），
           否则 undefined.pos.x 当场抛、整个 stepSummons 被主循环护栏吞掉，随从集体石化。 */
        var ally = s.side >= 0 ? m.players[s.side] : null;
        var ad = ally ? Math.hypot(ally.pos.x - s.pos.x, ally.pos.z - s.pos.z) : 99;
        if (ally && ad > 3) { moveToward(s, ally.pos, spd, dt); } else if (ally && ad < 2) { moveToward(s, { x: s.pos.x * 2 - ally.pos.x, z: s.pos.z * 2 - ally.pos.z }, spd, dt); }
        s.atkCd -= dt;
        if (ally && s.atkCd <= 0 && ad < 7) { s.atkCd = 2.2; ally.hp = Math.min(ally.maxHp, ally.hp + 4); m.fx.heal(ally); }
      } else {
        if (dist > 1.9) { moveToward(s, target.pos, spd, dt); s.state = 'chase'; }
        else {
          s.state = 'attack'; s.atkCd -= dt;
          if (s.atkCd <= 0) { s.atkCd = 1.2; G.Rules.damage(target, s.dmg, s.ai === 'flank' ? 'fire' : 'physical', m.ctx, s); m.fx.sfx('melee'); m.fx.burst({ x: target.pos.x, y: target.pos.y + 1, z: target.pos.z }, s.ai === 'flank' ? '#ff7a45' : '#c9a06b', 8); }
        }
        if (s.hp < s.maxHp * 0.25 && s.ai !== 'melee' || (!s.taunt && s.hp < s.maxHp * 0.2)) { s.state = 'flee'; moveToward(s, { x: s.pos.x * 2 - target.pos.x, z: s.pos.z * 2 - target.pos.z }, spd, dt); }
      }
      s.vel.y -= GRAV * dt;
      m.unstick(s);
      m.collideAABB(s, dt);
    }
    function nearest(from, list) {
      var best = null, bd = 1e9;
      for (var i = 0; i < list.length; i++) { if (!list[i] || !list[i].alive) continue; var d = Math.hypot(list[i].pos.x - from.pos.x, list[i].pos.z - from.pos.z); if (d < bd) { bd = d; best = list[i]; } }
      return best;
    }
    function moveToward(e, t, spd, dt) {
      var dx = t.x - e.pos.x, dz = t.z - e.pos.z, L = Math.hypot(dx, dz) || 1;
      e.vel.x += (dx / L * spd - e.vel.x) * Math.min(1, 18 * dt);
      e.vel.z += (dz / L * spd - e.vel.z) * Math.min(1, 18 * dt);
      if (e.onGround && (Math.abs(e.vel.x) + Math.abs(e.vel.z)) > 1 && frontBlocked(world, e)) e.vel.y = 7.0;
    }
    function frontBlocked(w, e) {
      var fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      var bx = Math.floor(e.pos.x + fx * 0.9), bz = Math.floor(e.pos.z + fz * 0.9);
      return w.solidAt(bx, Math.floor(e.pos.y), bz) || w.solidAt(bx, Math.floor(e.pos.y) + 1, bz);
    }
  };
  function aiAggro(m, s) { return s.ai === 'melee' || s.ai === 'flank'; };

  /* ---------- 飞行随从（2026-10-17 用户："召唤物现在都在地面走，想要能飞、粒子打满的"） ----------
     三条行为：ranged = 悬停在射程内绕圈隔空开火；suicide = 直接撞上去自爆；其余（flank）= 压在头上近战。
     不吃重力、不做体素碰撞（飞过去的东西不该被草台挡住），只守两条底线：
     ① 不许钻进方块里（抬到可站面之上）；② 不许飞出竞技场。
     零随机、零 rng——同种子同 tick 的轨迹可重放（play_probe 的确定性口径）。 */
  function stepFlyer(m, s, target, dist, dt) {
    var w = m.world, spd = s.st.frozen ? 0 : s.speed * G.Rules.statusSpeed(s);
    var tx = target.pos.x, tz = target.pos.z, ty = target.pos.y + target.h * 0.5;
    var gy = w.surfaceY(Math.floor(tx), Math.floor(tz)) + 1;
    var wantX, wantY, wantZ;
    if (s.suicide) {
      wantX = tx; wantZ = tz; wantY = ty + 0.2;
    } else {
      /* 绕圈：角度按 uid 定（同一次召唤的几只不会叠在一条线上），
         水平保持 hold 半径、垂直压在目标头顶稍上方。 */
      var hold = Math.max(2.2, Math.min(6.5, s.range * 0.5));
      var ang = Math.atan2(s.pos.z - tz, s.pos.x - tx) + (s.ai === 'ranged' ? 0.45 : 0.2);
      wantX = tx + Math.cos(ang) * hold;
      wantZ = tz + Math.sin(ang) * hold;
      wantY = Math.max(gy + 2.2, ty + 1.6);
    }
    var ddx = wantX - s.pos.x, ddy = wantY - s.pos.y, ddz = wantZ - s.pos.z;
    var L = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1;
    var k = Math.min(1, 5.0 * dt);
    s.vel.x += (ddx / L * spd - s.vel.x) * k;
    s.vel.y += (ddy / L * spd - s.vel.y) * k;
    s.vel.z += (ddz / L * spd - s.vel.z) * k;
    s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt; s.pos.z += s.vel.z * dt;
    /* 悬停抖动：只给视觉读感，幅度 0.12 格，0.9Hz——大了会看着像快掉下来了 */
    if (!s.suicide) s.pos.y += Math.sin(m.time * 5.6 + (s.uid || 0)) * 0.12 * dt * 4;
    /* 底线①：别钻进方块（抬起 0.6 格直到空气） */
    for (var g = 0; g < 6 && s.pos.y < w.SY - 2; g++) {
      var idc = w.get(Math.floor(s.pos.x), Math.floor(s.pos.y), Math.floor(s.pos.z));
      if (!idc || !DEFS[idc] || !DEFS[idc].solid) break;
      s.pos.y += 0.6;
    }
    /* 底线②：竞技场边界（软钳，不清零速度，免得贴边时一直悬停不动） */
    s.pos.x = Math.min(w.SX - 1.2, Math.max(1.2, s.pos.x));
    s.pos.z = Math.min(w.SZ - 1.2, Math.max(1.2, s.pos.z));
    s.pos.y = Math.min(w.SY - 1.5, Math.max(1.4, s.pos.y));
    s.yaw = Math.atan2(tx - s.pos.x, tz - s.pos.z);
    /* 攻击 */
    s.atkCd -= dt;
    if (s.suicide) {
      if (dist < 1.6) {
        m.explode(s, { x: s.pos.x, y: s.pos.y, z: s.pos.z }, s.dmg, 'fire', 2, m.ctx);
        s.hp = 0; s.alive = false;
        m.fx.log(s.name + ' 自爆', '#ff9f9f');
        m.removeSummon(s);
      }
      return;
    }
    if (s.atkCd <= 0 && !(s.st.frozen > 0)) {   // st.frozen 未定义时 undefined<=0 是 false，会把攻击整个吞掉
      if (s.ai === 'ranged' && dist <= s.range) { s.atkCd = 1.25; m.summonBolt(s, target); }
      else if (s.ai !== 'ranged' && dist < 2.8) {
        s.atkCd = 1.1;
        G.Rules.damage(target, s.dmg, s.ai === 'flank' ? 'fire' : 'physical', m.ctx, s);
        m.fx.sfx('melee');
        m.fx.burst({ x: target.pos.x, y: target.pos.y + 1, z: target.pos.z }, '#ff7a45', 10);
      }
    }
  };
  /* 飞行随从的隔空一击：走**同一套抛射物**（命中判定、近失圈、特效拖尾全部复用），
     所以"能不能打中"与玩家的弹道是同一份物理，不另写一条。 */
  function summonBolt(m, s, target) {
    if (!target || !target.alive) return null;
    var o = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    var ax = target.pos.x, ay = target.pos.y + target.h * 0.5, az = target.pos.z;
    var dx = ax - o.x, dy = ay - o.y, dz = az - o.z, L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var sp = s.projSpeed || 24, el = s.boltEl || 'void';
    var E = G.ELEMENTS[el] || G.ELEMENTS.neutral;
    var pr = {
      uid: fxUid(this), entKind: 'projectile', born: m.time,
      pos: new V(o.x + dx / L * 0.6, o.y, o.z + dz / L * 0.6),
      vel: new V(dx / L * sp, dy / L * sp, dz / L * sp),
      life: Math.min(2.6, L / sp + 0.5), owner: s, side: s.side, dmg: s.dmg,
      kind: el === 'ice' ? 'ice' : (el === 'void' ? 'void' : (el === 'fire' ? 'fire' : 'physical')),
      element: el, radius: 0, fuse: 1.0, status: null, aiKind: 'summon_bolt', color: E.color
    };
    m.projectiles.push(pr);
    m.fx.sfx('shoot');
    return pr;
  };

  /* ---------- 法阵：延时触发 + 周期结算 + 可被破坏 ---------- */
  G.Systems = G.Systems || {};
  G.Systems.Summon = {
    spawnSummon: spawnSummon,
    removeSummon: removeSummon,
    stepSummons: stepSummons,
    aiAggro: aiAggro,
    stepFlyer: stepFlyer,
    summonBolt: summonBolt
  };
})(window.GW);
