/* js/systems/projectile.js · 抛射物（fire/explode/fxColor/spawnHail，第二批）
   从 battle.js 搬出，行为逐字不变；与第一批同文件。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  var STATUS_MAP = { root: 'crystal', frozen: 'freeze', chill: 'freeze', burn: 'ignite', shock: 'thunder' };
  var ELEMENT_FUSE = { fire: 1.95, ice: 1.75, void: 1.65, nature: 1.6, physical: 1.45 };
  var ELEMENT_IMPACT_SFX = { fire: 'boom', ice: 'freeze', void: 'thunder', nature: 'crystal', rock: 'hit', physical: 'hit', neutral: 'hit' };
  function V(x, y, z) { return new G.V(x, y, z); }
  function fxUid(m) { return (m._fxUid = (m._fxUid || 0) + 1); }
  function fxEv(name, data) { if (G.VFX && G.VFX.event) G.VFX.event(name, data); }
  function stepProjectiles(m, dt) {
    var w = m.world;
    for (var i = m.projectiles.length - 1; i >= 0; i--) {
      var pr = m.projectiles[i];
      pr.life -= dt;
      /* 飞桥的桥钉：不判命中、不判伤害，只按抛物线前移并沿途铺板（见 stepQuill）。 */
      if (pr.paint) { m.stepQuill(pr, dt); if (pr.life <= 0) m.projectiles.splice(i, 1); continue; }
      var speed = Math.max(Math.abs(pr.vel.x), Math.abs(pr.vel.y), Math.abs(pr.vel.z));
      var steps = Math.max(1, Math.ceil(speed * dt / 0.28));      // 子步推进：避免高速抛射物穿模
      var sdt = dt / steps, gone = false;
      for (var k = 0; k < steps && !gone; k++) {
        /* 追踪体每子步先拐一次向：转向有上限（turn rad/s）所以画出来是**弧线**，
           再叠一条正弦横摆（weave）——用户 2026-10-17："现在的追踪导弹直直走过去没意思，
           要画弧线"。这些量全在 pr 上（出生时定死），判定仍是同一套线段命中。 */
        if (pr.home) m.steerProjectile(pr, sdt);
        var ox = pr.pos.x, oy = pr.pos.y, oz = pr.pos.z;
        var nx = pr.pos.x + pr.vel.x * sdt, ny = pr.pos.y + pr.vel.y * sdt, nz = pr.pos.z + pr.vel.z * sdt;
        /* 命中判的是**这一子步扫过的那一段**，不是末点一个球。
           42 格/秒的抛射物在一个子步里能走 0.28 格，只查末点就等于把"擦过去"读成"没打到"；
           判据从"小球体积压到敌人体积"改成"小球轨迹进入敌人的近失圈"（pr.fuse）。 */
        /* 护盾先挡：撞进盾球就没了，不进入后面的命中判定 */
        var blk = m.orbBlock(pr, ox, oy, oz, nx, ny, nz);
        if (blk) {
          if (blk.orb.hp <= 0) {
            m.fx.burst(blk.at, '#7fd7ff', 16);
            if (blk.owner.orbs) blk.owner.orbs.forEach(function (o2) { if (o2 === blk.orb) o2.hp = o2.hp; });
          }
          m.fx.burst({ x: nx, y: ny, z: nz }, pr.color || '#7fd7ff', 10);
          if (m.fx.sfx) m.fx.sfx('shield');
          fxEv('orbBlock', { pos: { x: nx, y: ny, z: nz }, side: blk.owner.side });
          gone = true; break;
        }
        var hitE = m.hitTestSegment(pr, ox, oy, oz, nx, ny, nz);
        if (hitE) {
          var ctx = m.ctx; ctx.aim = { x: pr.pos.x, y: pr.pos.y, z: pr.pos.z };
          if (pr.radius > 0) {
            m.explode(pr.owner, ctx.aim, pr.dmg, pr.kind, pr.radius, ctx, { direct: hitE, status: pr.status, falloff: true });
            if (pr.dig) m.digCrater(pr.pos.x, pr.pos.y, pr.pos.z, pr.dig.r, pr.dig.depth, 40);
          }
          else {
            G.Rules.damage(hitE, pr.dmg, pr.kind, ctx, pr.owner);
            if (pr.status && G.Rules.addStatus) {
              if (pr.status.radius) {
                /* 带半径的状态（缠根）：以命中点为爆心，把圈内敌人都缠住，
                   而不是只缠被小球蹭到的那一个。 */
                var st_ring = m.targetsInRadius(pr.owner, ctx.aim, pr.status.radius);
                for (var si = 0; si < st_ring.length; si++) G.Rules.addStatus(st_ring[si], pr.status.kind, pr.status.dur);
              } else G.Rules.addStatus(hitE, pr.status.kind, pr.status.dur);
            }
            m.fx.burst({ x: pr.pos.x, y: pr.pos.y, z: pr.pos.z }, pr.color, 10);
            m.fx.sfx('hit');
            if (pr.status && STATUS_MAP[pr.status.kind]) m.fx.sfx(STATUS_MAP[pr.status.kind]);
            fxEv('hit', { pos: pr.pos, kind: pr.kind, color: pr.color, target: hitE, pr: pr });
          }
          if (pr.kind === 'fire' && hitE.st) G.Rules.addStatus(hitE, 'burn', 3);
          G.chemCatalyst(pr.kind, pr.pos, 1);                              // 火球砸脸也把这片点着
          gone = true; break;
        }
        var id = w.get(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (id && DEFS[id] && DEFS[id].solid) {
          if (pr.radius > 0) {
            m.explode(pr.owner, { x: nx, y: ny, z: nz }, pr.dmg, pr.kind, pr.radius, m.ctx, { status: pr.status, falloff: true });
            if (pr.dig) m.digCrater(nx, ny, nz, pr.dig.r, pr.dig.depth, 40);
          }
          else { m.fx.dust(nx, ny, nz, pr.color); fxEv('impact', { pos: { x: nx, y: ny, z: nz }, kind: pr.kind, color: pr.color, pr: pr }); }
          /* 打在树上会烧起来、打在湖面上会结冰：交回物质层，别在这里自己写 burning 标记
             （以前这里只认 burn==='fire' 一种方块，草皮与木板点不着，也没有蔓延节拍）。 */
          G.chemCatalyst(pr.kind, { x: nx, y: ny, z: nz }, 1);
          gone = true; break;
        }
        pr.pos.set(nx, ny, nz);
      }
      if (gone || pr.life <= 0 || pr.pos.y < -4) m.projectiles.splice(i, 1);
    }
  };
  function steerProjectile(m, pr, dt) {
    var sp = Math.sqrt(pr.vel.x * pr.vel.x + pr.vel.y * pr.vel.y + pr.vel.z * pr.vel.z);
    if (sp < 1e-4) return;
    var ux = pr.vel.x / sp, uy = pr.vel.y / sp, uz = pr.vel.z / sp;
    var tgt = pr.target;
    if (!tgt || !tgt.alive) tgt = pr.target = m.acquireTarget(pr);
    if (tgt && tgt.alive) {
      var dx = tgt.pos.x - pr.pos.x, dy = (tgt.pos.y + tgt.h * 0.5) - pr.pos.y, dz = tgt.pos.z - pr.pos.z;
      var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var turn = Math.min(1, (pr.turn || 3.4) * dt);
      ux += (dx / L - ux) * turn; uy += (dy / L - uy) * turn; uz += (dz / L - uz) * turn;
      var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
    }
    if (pr.weave) {
      pr.wt = (pr.wt || 0) + dt;
      var wob = Math.sin(pr.wt * (pr.weaveHz || 2.8) + (pr.weavePhase || 0)) * pr.weave * dt * 5;
      var axx = -uz, axz = ux, al = Math.sqrt(axx * axx + axz * axz) || 1;
      ux += axx / al * wob; uz += axz / al * wob;
      var ul2 = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul2; uy /= ul2; uz /= ul2;
    }
    pr.vel.x = ux * sp; pr.vel.y = uy * sp; pr.vel.z = uz * sp;
  };
  function acquireTarget(m, pr) {
    var best = null, bd = 1e9;   // 追踪范围取消：全图找最近的目标
    var ents = m.all();
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (!e.alive || e.side === pr.side || e === pr.owner) continue;
      if (e.kind !== 'player' && e.kind !== 'summon') continue;
      var dx = e.pos.x - pr.pos.x, dy = e.pos.y - pr.pos.y, dz = e.pos.z - pr.pos.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  };
  /* 灵光齐射：一群会拐弯的细小光点。几只扇形散开后各自追最近的人——
     不写"导弹"，写"一群会自己找路的东西"，画面上才有烟花感。 */
  function hitTestEntity(m, pr) {
    return m.hitTestSegment(pr, pr.pos.x, pr.pos.y, pr.pos.z, pr.pos.x, pr.pos.y, pr.pos.z);
  };
  /* 线段 → 敌人：取轨迹上离敌人中点最近的那个，判定半径用抛射物自己的近失圈。
     中点取 pos.y + h/2（身体中心），与瞄准/范围结算同一口径，别在这里另发明一套"打腿也算中"。 */
  function hitTestSegment(m, pr, ax, ay, az, bx, by, bz) {
    var ents = m.all(), sx = bx - ax, sy = by - ay, sz = bz - az;
    var seg2 = sx * sx + sy * sy + sz * sz, best = null, bestRatio = 1.0001;
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (!e.alive || e.side === pr.side || e === pr.owner) continue;
      if (e.kind !== 'player' && e.kind !== 'summon') continue;
      var cx = e.pos.x, cy = e.pos.y + e.h / 2, cz = e.pos.z;
      var px = ax - cx, py = ay - cy, pz = az - cz;
      var t = seg2 > 1e-9 ? -(px * sx + py * sy + pz * sz) / seg2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var dx = px + sx * t, dy = py + sy * t, dz = pz + sz * t;
      var rr = Math.max(pr.fuse || 0.8, e.w * 1.25);
      var ratio = Math.sqrt(dx * dx + dy * dy + dz * dz) / rr;
      if (ratio < bestRatio) { bestRatio = ratio; best = e; }
    }
    return best;
  };


  function fireProjectile(m, p, card, ef, ctx, mult) {
    var o = p.eye ? p.eye() : { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z };
    var a = p.aim || { x: o.x + Math.sin(p.yaw) * 10, y: o.y + p.pitch * 6, z: o.z + Math.cos(p.yaw) * 10 };
    var sp = 42;
    /* 弹道提前量（A-1，GAMEPLAY §3.1 条 1 / §7.1 条 12）：准星选中的目标是实体时，
       按 距离/弹速 预判它匀速运动到哪，初速指向预测点而不是它当前所在。
       纯几何解：只用 e.pos / e.vel / 距离，零随机、不吃 rng；玩家与 AI 走同一条 fireProjectile。
       目标只由 AimResolver 报告：真机每帧 updateAim 把选中实体写进 aim.ent；
       没跑 updateAim 的通道（headless 探针里的 AI）沿出射线用同一个 rayEntity 补选——
       选不到就按原落点直飞，不产生第二套瞄准方向，判定半径一个字也没动。 */
    if (m.leadEnabled) {
      var lt = (a.ent && a.ent.alive) ? a.ent : null;
      if (!lt) {
        var lx = a.x - o.x, ly = a.y - o.y, lz = a.z - o.z, lL = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
        lt = m.rayEntity(p, o, { x: lx / lL, y: ly / lL, z: lz / lL }, 1e6);   // 索敌不再受射程限制
      }
      if (lt) {
        var ex = lt.pos.x - o.x, ey = (lt.pos.y + lt.h * 0.5) - o.y, ez = lt.pos.z - o.z;
        var tf = Math.sqrt(ex * ex + ey * ey + ez * ez) / sp;
        a = { x: lt.pos.x + lt.vel.x * tf, y: lt.pos.y + lt.h * 0.5 + lt.vel.y * tf, z: lt.pos.z + lt.vel.z * tf };
      }
    }
    var dx = a.x - o.x, dy = a.y - o.y, dz = a.z - o.z, L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    /* 近失引爆半径（fuse）：抛射物"是个小球"这件事没变，变的是**打偏了也算打中**——
       小球中心进入敌人这个距离内就起爆，伤害按离爆心的距离衰减（见 explode）。
       元素越爆裂近失圈越大，物理类最保守；单独调某张卡就在 cards.js 的 dmg() 里给第四个参数。 */
    var fuse = (typeof ef.fuse === 'number' && isFinite(ef.fuse)) ? ef.fuse : (ELEMENT_FUSE[ef.kind] || 1.2);
    if (ef.radius) fuse += Math.min(0.5, ef.radius * 0.18);            // 有大范围的弹，近失圈也跟着放宽一点
    /* entKind 才是"这是什么实体"，kind 是伤害类型（fire/ice/void…）。
       旧写法把两者塞进同一个 kind 键，字面量里后一个把前一个覆盖掉——于是 VFX.defaultFor 的
       'projectile' 分支从来没命中过，**抛射物拖尾一条都没画出来**（2026-10-17 node 探针实测：
       frameOf(pr,'trail').layers = 0）。现在分成两个字段；渲染插值上限也按 entKind 取。 */
    var pr = {
      uid: fxUid(this), entKind: 'projectile', born: m.time,
      pos: new V(o.x + dx / L * 0.7, o.y, o.z + dz / L * 0.7), vel: new V(dx / L * sp, dy / L * sp, dz / L * sp),
      /* 射程取消（2026-10-17 用户："把发射范围取消掉，两边就能在地图两端对轰"）：
         不再用 targeting.maxDist 卡飞行距离，改成"活到撞上东西"（9 秒 × 42 格/秒 ≈ 380 格，远超地图）。
         targeting.maxDist 从此只表示**施法范围**（见 rules 的 canPlay），与弹道无关。 */
      life: 9, owner: p, side: p.side, dmg: ef.amount * mult, kind: ef.kind,
      element: card.element, radius: ef.radius || 0, color: G.ELEMENTS[card.element].color,
      aiKind: card.id, status: null, fuse: fuse
    };
    m.projectiles.push(pr);
    /* 同一张卡里跟着这发弹道的负面状态（点燃 / 减速 / 定身）挂到弹上，命中才结算。
       以前出牌瞬间就往准星锁定的目标脸上糊状态，小球根本没打中也算中——见 rules.js 的 status 分支。 */
    if (ctx) ctx.projectile = pr;
    m.fx.sfx('shoot');
  };
  /* A-1 各档 +0.3（GAMEPLAY §4）：这是"没写 fuse 的卡"的默认近失圈；
     现役 7 张伤害 ray 卡都在 cards.js 的 dmg() 里带了显式 fuse，本表只管缺省档。 */
  var ELEMENT_FUSE = { fire: 1.95, ice: 1.75, void: 1.65, nature: 1.6, physical: 1.45 };
  /* 元素 → 音效 id（词汇表在 js/sfx-table.js，写错一个字母就是静音，audio_check 会反查）。
     以前不管什么弹砸下去都是"轰"或"啪"两声：焰矢和霜片听不出区别，
     玩家无法靠声音判断自己刚扔出去的是哪张牌 —— 现在冰落是结冰声、虚空落是雷、
     自然落是结晶、石头与打击仍是那记闷响。 */
  var ELEMENT_IMPACT_SFX = { fire: 'boom', ice: 'freeze', void: 'thunder', nature: 'crystal', rock: 'hit', physical: 'hit', neutral: 'hit' };
  /* 命中带"冻住 / 定身"状态时补一声 freeze：这是判定信息，不是装饰 ——
     被根须缠住和被打中，耳朵里必须是两件事。 */
  var STATUS_SFX = { root: 'crystal', frozen: 'freeze', chill: 'freeze', burn: 'ignite', shock: 'thunder' };
  /* 范围伤害：爆心满伤，边缘留 45%。
     为什么要衰减而不是一刀切：不衰减则"贴边蹭一下"和"正中"一样疼，玩家会觉得判定松得没边；
     线性衰减到 0 又让边缘几乎不掉血，回到"砸不疼"的老问题。0.45 这条下限取的判据是
     "站在爆心外一格仍然明显掉血"（tools/hit_check.cjs 用 1.1 / 1.8 格两个距离量它）。 */
  function explode(m, src, aim, amount, kind, radius, ctx, opts) {
    if (!aim) return;
    var r = radius || 2.5, st = opts && opts.status;
    var victims = m.targetsInRadius(src, aim, r);
    for (var i = 0; i < victims.length; i++) {
      var e = victims[i];
      var d = Math.hypot(e.pos.x - aim.x, (e.pos.y + e.h / 2) - aim.y, e.pos.z - aim.z);
      /* 衰减只给"抛射物砸地起爆"用（那里半径就是投偏了的容差，贴边不该和正中一样疼）；
         范围卡（焰华 / 霜爆 / 塌落 / 石刺）照旧圈内的全吃——它们本来就要玩家瞄准落点，
         再叠一层衰减等于悄悄砍掉这些卡的伤害。 */
      var f = !(opts && opts.falloff) || opts.direct === e ? 1 : Math.max(0.45, 1 - 0.55 * Math.min(1, d / r));
      G.Rules.damage(e, amount * f, kind, ctx, src);
      if (st && G.Rules.addStatus) G.Rules.addStatus(e, st.kind, st.dur);
    }
    m.fx.burst({ x: aim.x, y: aim.y, z: aim.z }, m.fxColor(kind), Math.min(30, 10 + Math.round(amount / 2)));
    m.fx.sfx(ELEMENT_IMPACT_SFX[kind] || (kind === 'fire' ? 'boom' : 'hit'));
    fxEv('explode', { pos: aim, kind: kind, radius: r, color: m.fxColor(kind) });
    chemCatalyst(kind, aim, Math.max(1, Math.round(r * 0.6)));
  };
  /* 元素 → 物质层的催化剂类别：火点东西、寒冻东西、虚空只让世界重算一遍邻居。 */
  function chemCatalyst(kind, pos, r) {
    if (!G.CHEM || !G.CHEM.ready || !pos) return;
    var k = kind === 'fire' ? 'heat' : (kind === 'ice' ? 'cold' : (kind === 'void' ? 'shock' : null));
    if (!k) return;
    G.CHEM.catalyst(k, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), r);
  }
  G.chemCatalyst = chemCatalyst;
  function fxColor(m, kind) {
    return { physical: '#c9d3e0', fire: '#ff7a45', ice: '#7fd7ff', nature: '#7fd97f', void: '#c58cff' }[kind] || '#ffffff';
  };
  function spawnHail(m, p, aim, dmg, i) {
    if (!aim) return;
    var r = 2.5;
    var x = aim.x + (m.rng() - 0.5) * r * 2, z = aim.z + (m.rng() - 0.5) * r * 2;
    m.projectiles.push({ uid: fxUid(this), entKind: 'projectile', born: m.time, pos: new V(x, m.world.SY - 4 + i * 0.3, z), vel: new V(0, -34, 0), life: 2.4, owner: p, side: p.side, dmg: dmg, kind: 'ice', element: 'ice', radius: 1.1, fuse: 1.5, color: '#a9dcf2', aiKind: 'hail' });
  };

  G.Systems = G.Systems || {};
  G.Systems.Projectile = {
    stepProjectiles: stepProjectiles,
    steerProjectile: steerProjectile,
    acquireTarget: acquireTarget,
    hitTestEntity: hitTestEntity,
    hitTestSegment: hitTestSegment,
    fireProjectile: fireProjectile,
    explode: explode,
    fxColor: fxColor,
    spawnHail: spawnHail
  };
})(window.GW);
