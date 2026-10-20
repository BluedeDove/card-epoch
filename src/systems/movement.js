/* js/systems/movement.js · 体素 AABB 物理 / 输入 / 跳跃窗口 / 视角（从 battle.js 搬出，行为逐字不变）
   来源：collideAABB / unstick / applyInput / applyLook。
   常量与 battle.js 同一来源（G.PHYS / G.LOOK_LIMIT），不另写一套数值。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  var GRAV = (G.PHYS && G.PHYS.GRAV) || 24;
  var JUMP = (G.PHYS && G.PHYS.JUMP) || 9.2;
  var SPEED = (G.PHYS && G.PHYS.SPEED) || 5.6;
  var COYOTE = 0.12, JBUF = 0.20;
  var LOOK_DEFAULT = { up: 89 * Math.PI / 180, down: -89 * Math.PI / 180 };
  function lookLimit() { return G.LOOK_LIMIT || LOOK_DEFAULT; }
  function V(x, y, z) { return new G.V(x, y, z); }
  function p_name(e) { return e.name || (G.SUMMON_CN ? G.SUMMON_CN[e.aiKind] : e.aiKind); }
  function collideAABB(m, e, dt) {
    var w = m.world, hw = e.w / 2, hh = e.h / 2;
    /* 穿墙飞行（只有创造模式的玩家会拿到这个标记）：不判体素碰撞，
       但仍被竞技场边界与 y 范围夹住——否则一松手掉出世界触发复活，调试时很烦。 */
    if (e.creative && e.creative.noclip) {
      e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.pos.z += e.vel.z * dt;
      e.pos.x = Math.min(w.SX - hw - 0.02, Math.max(hw + 0.02, e.pos.x));
      e.pos.z = Math.min(w.SZ - hw - 0.02, Math.max(hw + 0.02, e.pos.z));
      e.pos.y = Math.min(w.SY - 1.2, Math.max(hh + 0.2, e.pos.y));
      e.onGround = false; e.airHigh = null;
      return;
    }
    function blocked(nx, ny, nz) {
      // 世界外 get() 返回 0（空气），实测从岛边一步踏空就一直掉到 y<-6。
      // 竞技场边界当不可见墙：只挡实体，不改世界数据，也不影响出牌改地形。
      if (w.outOfArena(nx, ny, nz, hw, hh)) return true;
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) for (var oz = -1; oz <= 1; oz++) {
        var cx = Math.floor(nx) + ox, cy = Math.floor(ny) + oy, cz = Math.floor(nz) + oz;
        var id = w.get(cx, cy, cz); if (!id) continue;
        if (!DEFS[id].solid) continue;
        // 方块 AABB 相交测试
        if (cx < nx + hw && cx + 1 > nx - hw && cy < ny + hh && cy + 1 > ny - hh && cz < nz + hw && cz + 1 > nz - hw) return true;
      }
      return false;
    }
    /* 冰面的"滑"改到 applyInput 的 accel 上做（那边讲动量），这里不再按 0.06 抹位移：
       位移打折会让击退、落地滑行一起被吃掉，玩家感受到的是"被粘住"而不是"打滑"。 */
    var nx = e.pos.x + e.vel.x * dt;
    if (!blocked(nx, e.pos.y, e.pos.z)) e.pos.x = nx; else e.vel.x = 0;
    var nz = e.pos.z + e.vel.z * dt;
    if (!blocked(e.pos.x, e.pos.y, nz)) e.pos.z = nz; else e.vel.z = 0;
    var ny = e.pos.y + e.vel.y * dt;
    e.onGround = false;
    if (!blocked(e.pos.x, ny, e.pos.z)) {
      e.pos.y = ny;
      if (e.vel.y < 0) e.airHigh = (e.airHigh === null || e.airHigh === undefined) ? e.pos.y : Math.max(e.airHigh, e.pos.y);
    }
    else {
      if (e.vel.y <= 0) {
        e.onGround = true;
        var fallDist = (e.airHigh === null || e.airHigh === undefined) ? 0 : (e.airHigh - e.pos.y);
        if (fallDist > 3.4 && e.kind === 'player') {
          var d = Math.min(30, Math.round((fallDist - 3.4) * 5));
          if (d > 0) { G.Rules.damage(e, d, 'physical', m.ctx); m.fx.log(p_name(e) + ' 从 ' + fallDist.toFixed(1) + ' 格高处坠地，受 ' + d + ' 伤害', '#ff9f9f'); m.fx.dust(e.pos.x, e.pos.y, e.pos.z, '#c9d3e0'); }
        }
      }
      e.vel.y = 0;
    }
    if (e.onGround) e.airHigh = null;
    // 掉出世界底部
    // 兜底复活：正常情况 outOfArena 已经拦住了踏空，这里只处理被卡牌炸飞、被顶穿地形等意外。
    // pos.y 是身体中心，落点必须按"脚底 + 半高"给，否则一半身子埋进方块、每个方向都判碰撞。
    if (e.pos.y < -6) {
      e.vel.set(0, 0, 0);
      if (e.kind === 'player') {
        var sp = m.spawnPts[e.side];
        e.pos.set(sp.x, m.spawnStandY(e.side) + e.h / 2 + 0.05, sp.z);   // 与复活同一个占位检查（A1-b2 收口）
        e.stuck = 0; e.airHigh = null;
        G.Rules.damage(e, 12, 'physical', m.ctx);
        m.fx.log(p_name(e) + ' 掉出世界，已在出生点复活并受 12 伤害', '#ff9f9f');
      } else { e.pos.set(e.pos.x, m.world.SY + 2, e.pos.z); m.removeSummon(e); }
    }
  };
  function p_name(e) { return e.name || (G.SUMMON_CN ? G.SUMMON_CN[e.aiKind] : e.aiKind); }

  function unstick(m, e) {
    var w = m.world, hw = e.w / 2, hh = e.h / 2;
    function hit(x, y, z) {
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) for (var oz = -1; oz <= 1; oz++) {
        var cx = Math.floor(x) + ox, cy = Math.floor(y) + oy, cz = Math.floor(z) + oz, id = w.get(cx, cy, cz);
        if (!id || !DEFS[id].solid) continue;
        if (cx < x + hw && cx + 1 > x - hw && cy < y + hh && cy + 1 > y - hh && cz < z + hw && cz + 1 > z - hw) return true;
      }
      return false;
    }
    if (!hit(e.pos.x, e.pos.y, e.pos.z)) { e.stuck = 0; return false; }
    e.stuck = (e.stuck || 0) + 1;
    /* 顶出改渐变：一次性从深处摆回地表会把玩家单帧搬 7+ 格，相机必须跟着跳
       （cam.pos 是 eyeBase 的纯函数），审计 D 项"相机单帧最大 y 变化"就红在这（88092 实测 7.03）。
       前 8 tick 每 tick 至多升 1.0 格——AI 埋人（≤9 格改造）通常几 tick 就出来了；
       真正深渊（踏空 y=−30）仍在 stuck>8 走原来的硬顶出+居中，E 项时序不变。 */
    var gx = Math.floor(e.pos.x), gz = Math.floor(e.pos.z), sy = w.surfaceY(gx, gz);
    var topY = sy + 1 + e.h / 2 + 0.05;
    if (e.stuck <= 8 && topY - e.pos.y > 1.0) {
      e.pos.y += Math.min(1.0, topY - e.pos.y);
      e.vel.set(0, 0, 0);
      return true;
    }
    if (e.stuck > 8) {                                  // 连续 8 tick 全埋在方块里 → 硬顶出（深渊兜底）
      e.pos.set(gx + 0.5, topY, gz + 0.5);
      e.vel.set(0, 0, 0); e.stuck = 0;
      m.fx.log(e.name + ' 被地形卡住，已顶出', '#9d95c4');
    }
    return true;
  };
  function applyInput(m, p, inp, dt) {
    if (!p.alive) return;
    var mvx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), mvz = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
    var yaw = p.yaw;
    var fx = Math.sin(yaw), fz = Math.cos(yaw);
    var want = { x: fx * mvz - fz * mvx, z: fz * mvz + fx * mvx };   // 与修正后的右向一致：D 走向屏幕右
    var L = Math.sqrt(want.x * want.x + want.z * want.z);
    var cr = p.creative, fly = !!(cr && cr.fly);
    /* 法术飞行（st.fly，由 rules 的 flight 效果给）：与创造模式飞行同一套手感，
       但只在秒数内有效，且不改变创造标记。 */
    var spellFly = !!(p.st && p.st.fly > 0);
    if (spellFly) { fly = true; cr = cr || { flyV: 7.5 }; }
    /* 疾跑：只在前向移动、没在游泳时生效；速度乘在唯一的 SPEED 上，不复制第二套移动常数。
       p.sprint 是**表现层可读的派生状态**（相机 FOV/摇晃、第一人称法杖压低都读它），
       判定仍只在这里一次；AI/远端输入走同一条通道。 */
    var sprinting = !!inp.sprint && mvz > 0 && !fly && !p.swim;
    var spd = SPEED * G.Rules.statusSpeed(p) * (p.swim ? 0.55 : 1) * (fly ? (cr.flyMul || 1.9) : 1) * (sprinting ? 1.5 : 1);
    p.sprint = sprinting;
    if (L > 0.01) { want.x /= L; want.z /= L; }
    /* 转向响应：空中 12 太黏（每 tick 只把速度拉 10%，掉头要 0.75s，越肩视角下像被水拖住）→ 提到 17。
       冰面：真正的"滑"是**动量留得住**，不是把人粘住——旧的 acc×0.06 写在 collideAABB 的位移上，
       等于每 tick 抹掉 94% 的位移，实测在冰上走一步像踩水泥，那不是滑是卡。现在位移不打折，
       只把转向加速度压到 16：能走动、但刹车与转弯都迟钝，结冰/霜卡依旧有战术价值。 */
    var accel = (p.onGround || fly) ? (p.onIce && !fly ? 16 : 44) : 17;
    p.vel.x += (want.x * spd - p.vel.x) * Math.min(1, accel * dt / Math.max(spd, 0.01));
    p.vel.z += (want.z * spd - p.vel.z) * Math.min(1, accel * dt / Math.max(spd, 0.01));
    if (!(cr && cr.noclip) && m.unstick(p)) return;
    if (fly) {
      /* 创造模式飞行：不吃重力、松手悬停（空格升 / 下蹲降）。
         仍然走 collideAABB，所以"能飞但撞墙"是常态；穿墙由 noclip 单独决定，两者不绑死。 */
      if (p.st.frozen) delete p.st.frozen;
      var fv = cr.flyV || 9;
      if (inp.jump) p.vel.y = fv;
      else if (inp.crouch) p.vel.y = -fv;
      else p.vel.y *= 0.5;                        // 不清零：留 2~3 帧的起降缓冲，硬停会被读成"卡顿"
    } else {
      /* 两条容错窗口，AI 与真人共用同一套输入通道（谁也不偏袒）：
         ① 新鲜按下（这个 tick 才出现 jump）记进 jumpBuf：早按 0.14s 内落地照样起跳；
         ② 刚离地 0.12s 内还算"踩得住"（coyote）：走出边缘那一步的跳不被吞。
         按住不放**仍然只在真落地时**才连跳——否则走到崖边顺手按着跳键会自己蹦下去。 */
      var fresh = !!inp.jump && !p.prevJump;
      p.prevJump = !!inp.jump;
      if (fresh) p.jumpBuf = JBUF;
      else if (p.jumpBuf > 0) p.jumpBuf -= dt;
      if (p.onGround) p.groundT = 0; else if (isFinite(p.groundT)) p.groundT += dt;
      var buffered = p.jumpBuf > 0 && p.onGround;
      var coyoteOk = fresh && !p.onGround && p.groundT <= COYOTE;
      if ((fresh && p.onGround) || buffered || coyoteOk) {
        p.vel.y = JUMP; p.jumpBuf = 0; p.groundT = 99;   // groundT 拉满：这次 coyote 窗口不许复用
        delete p.st.frozen; m.fx.sfx('jump');
      }
      if (p.swim && inp.jump) p.vel.y = 3.4;
      p.vel.y -= GRAV * dt; if (p.vel.y < -40) p.vel.y = -40;
    }
    m.applyLook(p, inp.lookYaw, inp.lookPitch);   // AI / 远端输入仍按 tick 结算
    m.collideAABB(p, dt);
  };

  /* 朝向的唯一写入点。真人鼠标由主循环每渲染帧调它（见 net.js 的 flushLook），
     AI 与远端输入则在 applyInput 里按 tick 调。yaw 归一化到 (-π,π]，
     免得持续转圈把 yaw 累成大数，让相机绕远路追赶（观感就是突然一拽）。 */
  function applyLook(m, p, lookYaw, lookPitch) {
    if (!p || !p.alive) return;
    if (lookYaw) {
      p.yaw += lookYaw;
      p.yaw = ((p.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }
    if (lookPitch) { var L = lookLimit(); p.pitch = Math.max(L.down, Math.min(L.up, p.pitch + lookPitch)); }
  };


  G.Systems = G.Systems || {};
  G.Systems.Movement = {
    collideAABB: collideAABB,
    unstick: unstick,
    applyInput: applyInput,
    applyLook: applyLook
  };
})(window.GW);
