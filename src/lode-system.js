/* ================= GW.LodeSystem =================
   L4 第五类活体（定案 GAMEPLAY §7.1 条 5）：矿脉归属与产出。
   只回答一个问题："每条矿此刻归谁、该产出多少分与素材"。
   与 Projectile/Summon/Sigil/Fluid 四类 System 同构：彼此不互调，只由 Match.step 编排
   （插入位置与理由写在 battle.js 的 step 注释里——阶段顺序是确定性命门）。
   纪律：只读 world.lodes 的平台表与实体位置/存活态；写世界格子只有**一条**许可的路——
   以太晶 12 秒原位再生（定案 CARD_ECONOMY §3.3，三条边界写在 step 末尾的注释里），其余一律不许碰
   （save 的 diff 与 chem 的 onSet 唤醒纪律，§7.1 条 18）；零 rng、零 DOM、零文案。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  /* 定案数值（GAMEPLAY §2.1/§2.2 + R2 方案甲）：独占每 3s +1 分；占矿被动 +1 素材/6s（无矿者拿不到）。
     占矿宽限（opts.holdGrace ?? 0，**默认 0 = 旧行为**，误提交不改变玩家实际玩到的东西——A2-b 事故规矩）：
     离开平台后归属保留 holdGrace 秒并继续产出；对手上台（含争抢）立即清零保留。
     升温按 kimi R2 建议退役（不实现、不留半套开关）；旧"≥80 分 ×2"加速线一并删除——
     宽限把等效独占抬 4 倍后 80 分真的会到，留着它等于给测量里掺一个没人审过的变速。 */
  var SCORE_EVERY = 3.0, MATS_EVERY = 6.0;
  /* 以太晶再生秒数（定案 §3.3：采走 12 秒后原位长回）与占矿的魔力小加成（§3.1：+0.15/秒 ≈ +17%，
     体感是"在矿上出牌更顺"，不是第四条收益——§6 明确占矿只产出 分/素材/这点加成 三样）。 */
  var REGEN_SEC = 12.0, MANA_BONUS = 0.15;
  /* 占矿判定的垂直窗口：平台 3×3 有 ±1 的整平残差，跳跃顶 ~1.25 格，小柱工事 2 格——
     脚底在 [台面, 台面+3.5] 内才算"在矿上"；搭高塔凌驾不算占矿。 */
  var FEET_ABOVE = 3.5;

  function LodeSystem(match, opts) {
    this.m = match;
    this.holdGrace = (opts && opts.holdGrace != null) ? opts.holdGrace : 0;   // 默认 0 = 现状；开启走显式 opts
    this.contestedTicks = 0;
    var list = (match.world.lodes && match.world.lodes.list) || [];
    this.lodes = list.map(function (l) {
      return { x: l.x, y: l.y, z: l.z, cells: l.cells,
               owner: -1, accScore: 0, accMats: 0, contested: false,
               graceSide: -1, graceLeft: 0, graceClears: 0,
               holdSec: [0, 0], producedScore: [0, 0], producedMats: [0, 0],
               /* 首占矿三选一的触发账（定案 CARD_ECONOMY §2 S2：只有"第一次进入某方独占"才给）：
                  按 side 各记一次，矿被抢走再抢回来不会重复发奖。它与 Match.draftUsed 是两回事——
                  drafted 管"这条矿有没有给过这一方"，draftUsed 管"这一方整局还剩几次"。 */
               drafted: [false, false] };
    });
    /* 以太晶再生表（定案 §3.3）：晶体位置在生成期就由 planter 的 writeLode 写进 world.lodes.list[i].crystals，
       这里只把它摊平成一张**长度恒定 ≤9**（3 矿 × 3 格）的表，tick 里只走这张表、绝不扫世界格子。
       t = 剩余秒数（0 = 不在再生中，采一次置 12）；givenUp = 到点时那一格不是 AIR（玩家在晶体位置上
       砌了东西）就放弃这一格，不覆盖玩家地形、也不再重试；lode = 属于第几条矿，量具（econ_check E4）读它。 */
    this.crystals = [];
    for (var li = 0; li < list.length; li++) {
      var cs = list[li].crystals || [];
      for (var ci = 0; ci < cs.length; ci++)
        this.crystals.push({ x: cs[ci][0], y: cs[ci][1], z: cs[ci][2], t: 0, givenUp: false, lode: li });
    }
  }
  /* 采掘回执（由 Match.onCrystalHarvested 转过来，见 battle.js）：命中表里某一格就把计时置 12 秒。
     同一格重复采只重置计时（不会攒出第二根晶柱，也不许把表撑长）；表里没有的坐标返回 false——
     别人造的晶体不归本类管，本类也不为它排再生。 */
  LodeSystem.prototype.onHarvest = function (x, y, z) {
    for (var i = 0; i < this.crystals.length; i++) {
      var c = this.crystals[i];
      if (c.x === x && c.y === y && c.z === z) { c.t = REGEN_SEC; c.givenUp = false; return true; }
    }
    return false;
  };
  /* 占矿的魔力加成（定案 §3.1）：任一矿此刻归这一方独占就 +0.15/秒，争抢期（owner=-1）谁都不给。
     只回答一个数，**不许在这里写 p.mana**——入账在 battle.js 的累加器（一个字段一个家）。 */
  LodeSystem.prototype.manaBonusOf = function (side) {
    for (var i = 0; i < this.lodes.length; i++) if (this.lodes[i].owner === side) return MANA_BONUS;
    return 0;
  };
  /* 归属语义（§2.1 "独占期间"）：站在平台上且对方不在 = 独占；双方都在 = 争抢无主，谁都不产出。
     无记忆：不占就不产；充能进度记在矿上、非独占期暂停、换主不清零（打断不损失，
     接手继承残余进度——1v1 下直接换主是罕事，语义按"矿的充能"而不是"人的存条"）。 */
  LodeSystem.prototype.step = function (dt) {
    if (!this.lodes.length && !this.crystals.length) return;   // 无矿图：没产出也没晶体可再生
    var m = this.m, ps = m.players;
    for (var li = 0; li < this.lodes.length; li++) {
      var L = this.lodes[li];
      var on = [false, false];
      for (var pi = 0; pi < ps.length; pi++) {
        var p = ps[pi];
        if (!p.alive) continue;                       // 尸体不占矿：本 tick 被打死不多产一秒
        var feet = p.pos.y - p.h / 2;
        if (feet < L.y || feet > L.y + FEET_ABOVE) continue;
        var cx = Math.floor(p.pos.x), cz = Math.floor(p.pos.z);
        for (var ci = 0; ci < L.cells.length; ci++)
          if (L.cells[ci][0] === cx && L.cells[ci][1] === cz) { on[p.side] = true; break; }
      }
      var pres = (on[0] && on[1]) ? -1 : (on[0] ? 0 : (on[1] ? 1 : -1));   // 现态：-1 = 争抢或空台
      L.contested = on[0] && on[1];                   // 公开字段：归属可见性（远读光柱/顶栏）的唯一权威出处
      var owner;
      if (this.holdGrace > 0) {
        /* 宽限状态机：在场独占 → 刷新保留账；争抢 → 即时无主且保留清零（进攻方不需要等）；
           空台且保留未耗完 → 旧主继续产出；耗尽 → 无主。对手上台破保留计一次 graceClears。 */
        if (pres >= 0) {
          if (L.graceSide >= 0 && L.graceSide !== pres && L.graceLeft > 0) L.graceClears++;
          L.graceSide = pres; L.graceLeft = this.holdGrace;
          owner = pres;
        } else if (L.contested) {
          if (L.graceSide >= 0 && L.graceLeft > 0) L.graceClears++;
          L.graceSide = -1; L.graceLeft = 0;
          owner = -1;
        } else if (L.graceSide >= 0 && L.graceLeft > 0) {
          owner = L.graceSide;
          L.graceLeft -= dt;
          if (L.graceLeft <= 0) { L.graceLeft = 0; L.graceSide = -1; }
        } else owner = -1;
      } else owner = pres;                            // 默认 0：逐字节旧行为
      L.owner = owner;
      if (owner < 0) continue;                        // 争抢/无人：充能暂停，进度保留
      /* ---- 首占矿三选一（定案 CARD_ECONOMY §2 S2，任务书 T3）----
         这条矿**第一次**被这一方独占 → 往 Match 的队列里排一次三选一（到这儿 owner 必然 >= 0，
         争抢与空台在上面那行就 continue 掉了）。群系读 Match 构造期算好的名义群系（seed 派生，
         与实际地形无关）；pick-pools 没挂上时退回通用池，至少不吞掉这次机会。
         位置就钉在生产结算之前：同一 tick 里"上台 → 产分 → 给三选一"必须算同一个事件。
         只有 offerDraft **真的排上**才置 drafted：额度用尽（返回 null）时不置位，但那条矿本来也
         不会再给第二次（draftUsed 已满，之后每一 tick 都会返回 null，不会刷出额外机会）。
         若这一方此刻已经挂着一次没处理的三选一（面板开着会暂停逻辑，正常撞不上；holdGrace>0
         或同 tick 抢两台才可能），这次机会**保留到那次处理完**，下一 tick 再排——
         把"首次占领"丢掉比晚几秒弹窗更糟（2026-10-18 T4 报告里的第 2 条，机制线拍板）。 */
      if (L.drafted[owner] !== true) {
        if (m.offerDraft(owner, 'lode', (m.lodeBiomes && m.lodeBiomes[li]) || 'neutral')) L.drafted[owner] = true;
      }
      L.holdSec[owner] += dt;
      /* 占矿给几分问编排类（docs/MODES.md §4 钩子 2）：lode = 1（沿用今天的每 3 秒 +1），
         死亡竞赛 = 0（矿不给分，但素材与魔力照给——下面 MATS_EVERY 那条与 manaBonusOf 都不看它）。
         没挂 director 就是老行为（所有既有量具与不选玩法的老路径逐字节不变）。
         归属、首占矿三选一、producedScore 的节拍账都不动：0 分是"这个玩法不计分"，不是"没产出"。 */
      var pts = m.director ? m.director.lodePoints() : 1;
      L.accScore += dt;
      while (L.accScore >= SCORE_EVERY) { L.accScore -= SCORE_EVERY; L.producedScore[owner]++; if (pts !== 0) m.addScore(ps[owner], pts); }
      L.accMats += dt;
      while (L.accMats >= MATS_EVERY) { L.accMats -= MATS_EVERY; L.producedMats[owner]++; ps[owner].mats += 1; }
    }
    /* ---- 以太晶 12 秒原位再生（定案 §3.3）：本类**唯一**写世界格子的路径，三条边界钉死 ----
       ① 只写生成期记下的那几个原位（表长 ≤9，不扫世界、不新增条目）；
       ② 只在当前是 AIR 时写回 CRYSTAL——玩家在晶体位置砌了方块就置 givenUp 放弃这一格，
          绝不覆盖玩家地形（否则"我在矿上盖了屋子，被一根晶柱顶掉"）；
       ③ 写的内容是"回到基线"：存档 diff 里这条差异会自然消掉，chem 的 onSet 只被唤醒一次。
       稳态（没人采）时 t 全 0，这一段一次 world.get 都不做，符合"零成本稳态"那条纪律。 */
    var w = m.world, B = G.BLOCK;
    for (var ri = 0; ri < this.crystals.length; ri++) {
      var c = this.crystals[ri];
      if (c.t <= 0 || c.givenUp) continue;
      c.t -= dt;
      if (c.t > 0) continue;
      c.t = 0;
      if (w.get(c.x, c.y, c.z) === B.AIR) w.set(c.x, c.y, c.z, B.CRYSTAL);
      else c.givenUp = true;
    }
  };
  /* 占矿累计秒数（Scoreboard 加时逐级判定的第①级）：全矿各阵营独占秒数之和。
     纯读账本，不进 tick 的世界查询。 */
  LodeSystem.prototype.totalHold = function () {
    var t = [0, 0];
    for (var i = 0; i < this.lodes.length; i++) { t[0] += this.lodes[i].holdSec[0]; t[1] += this.lodes[i].holdSec[1]; }
    return t;
  };
  /* 产出速率只读出口（量具/将来 UI 用；升温退役后恒 1/3s，速率若再有曲线都从这里出） */
  LodeSystem.prototype.rateOf = function (L) { return 1 / SCORE_EVERY; };
  G.LodeSystem = LodeSystem;
})(window.GW);
