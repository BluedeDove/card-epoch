/* js/systems/auto.js · 自动开火（"按住左键就能玩"的那一层）
   用户 2026-10-18：不想管卡组分配，"选定模式之后一直按左键，系统自动帮我挑最好最合适的那张打出去，
   子弹随时在变"。

   职责只有两件事：
     1) pick(m, p)：从手牌里挑一张**现在真能放出去**的牌（G.Rules.canPlay 说行的才算）；
     2) fire(m, p)：走 Match.playCard 这条唯一通道把它打出去（扣费 / 冷却 / 补牌 / 特效全在权威层）。

   三条设计取舍：
     · **只自动打"攻击类"**（超阶 / 远程 / 法阵 / 召唤）。放置、破坏、移动、辅助不自动放——
       按住左键就在脚下砌墙、往准星挖洞、随机闪现，那不是爽，是灾难。这些仍然手动点/按数字键。
     · **组决定顺序**：超阶(0) > 远程(1) > 法阵(2) > 召唤(3)。超阶平时付不起/在冷却，
       所以绝大多数时候打的是远程；一旦大招转好了，下一发就是它——"爽"就来自这个。
     · **同分要换着打**：组内先打便宜的（连发节奏快），同一张刚打过就加罚分，
       再叠一点 `auto` 随机流（独立种子，不碰 legacy 抽牌序列）——弹道与颜色才会一直变。
   本层不碰 DOM、不出文案、不认识按键：谁按住左键是装配层（src/main.js）的事。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  /* 组 → 优先级（越小越先打）。只有这里列出的组会被自动放出。 */
  var AUTO_ROLES = { ultra: 0, shot: 1, sigil: 2, summon: 3 };

  /* 返回 {index, card, score}；没有能打的牌就返回 null（调用方什么都不做，不弹提示）。 */
  function pick(m, p) {
    if (!m || !p || !p.alive || !p.hand || !p.hand.length) return null;
    var rnd = (m.rngs && m.rngs.get) ? m.rngs.get('auto') : (m.rng || Math.random);
    var best = null, i, c, pr, can;
    for (i = 0; i < p.hand.length; i++) {
      c = G.CARDS_BY_ID[p.hand[i]];
      if (!c) continue;
      pr = AUTO_ROLES[c.role];
      if (pr === undefined) continue;                 // 放置/破坏/移动/辅助：手动才放
      can = (G.Rules && G.Rules.canPlay) ? G.Rules.canPlay(c, p, m.ctx) : null;
      if (!can || !can.ok) continue;
      /* 分数越小越先：组优先 → 便宜优先 → 冷却短的优先 → 刚打过的靠后 → 一点随机让同组轮着来 */
      var score = pr * 100 + (c.cost | 0) * 6 + (c.cooldown || 0) * 0.5;
      if (p.autoLast === c.id) score += 18;
      score += rnd() * 14;
      if (!best || score < best.score) best = { index: i, card: c, score: score };
    }
    return best;
  }

  /* canPlay 有一条"手牌为空"的护栏（它是给 playCard 用的）。换牌时手可能正好是空的，
     所以这里先临时把牌塞进手里问一句、问完撤回——只在空手时这么做，正常路径零开销。 */
  function affordable(m, p, c) {
    if (!G.Rules || !G.Rules.canPlay) return true;
    var empty = !p.hand.length;
    if (empty) p.hand.push(c.id);
    var r = G.Rules.canPlay(c, p, m.ctx);
    if (empty) p.hand.pop();
    return !!(r && r.ok);
  }
  /* ---------- 换牌（"不用管卡组"的那一半） ----------
     手里的牌打不出去（全是放置/破坏/移动/辅助）时，自动开火把其中一张放回牌库**底**、
     再从牌库里换一张"现在真能打"的攻击牌进手。守恒：一张换一张，不多不少。

     只在 handClass 是"全部"或本身就是攻击组时才换：玩家手动切到「放置」就是想砌东西，
     这时自动开火该安静地什么都不做，而不是偷偷把他的建筑牌换走。 */
  function reload(m, p) {
    if (p.handClass && AUTO_ROLES[p.handClass] === undefined) return null;
    var i, c, slot = -1, old = null;
    if (p.hand.length < 5) slot = p.hand.length;  // 有空位：直接补一格（不牺牲任何牌）
    else {                                        // 满格：把最后一张"打不出去的"换掉
      for (i = p.hand.length - 1; i >= 0; i--) {
        c = G.CARDS_BY_ID[p.hand[i]];
        if (!c || AUTO_ROLES[c.role] === undefined) { slot = i; break; }
      }
    }
    if (slot < 0) return null;                    // 手里全是攻击牌但都打不出（魔力/冷却）→ 等，不换牌
    if (slot < p.hand.length) old = p.hand[slot];
    var best = null;
    for (i = p.deck.length - 1; i >= 0; i--) {    // 牌库顶 = 数组尾部
      c = G.CARDS_BY_ID[p.deck[i]];
      if (!c || AUTO_ROLES[c.role] === undefined) continue;
      if (!affordable(m, p, c)) continue;
      var score = AUTO_ROLES[c.role] * 100 + (c.cost | 0) * 6 + (c.cooldown || 0) * 0.5;
      if (!best || score < best.score) best = { at: i, card: c, score: score };
    }
    if (!best) {
      /* 牌库里没有能打的攻击牌：牌库与弃牌堆合起来洗一次再找（标准"把弃牌堆倒回来"） */
      if (!p.discard.length) return null;
      m.reshuffle(p);
      return reload(m, p);
    }
    p.deck.splice(best.at, 1);
    if (old) { p.hand[slot] = best.card.id; p.deck.unshift(old); }   // 换下来的那张回牌库**底**（数组头部才是底）
    else p.hand.push(best.card.id);
    m.touch('players', p.side);
    return { ok: true, swappedIn: best.card.id, swappedOut: old, slot: slot };
  }

  /* 打出去。返回 {ok, index, cardId, reloaded}；没得打时 {ok:false, reason:'nothing'}。 */
  function fire(m, p) {
    var b = pick(m, p), reloaded = false;
    if (!b) {                                     // 手里没有能打的攻击牌：先换一张再试
      var rl = reload(m, p);
      if (rl && rl.ok) { reloaded = true; b = pick(m, p); }
    }
    if (!b) return { ok: false, reason: 'nothing', reloaded: reloaded };
    var ok = m.playCard(p, b.index);
    if (ok) p.autoLast = b.card.id;
    return { ok: !!ok, index: b.index, cardId: b.card.id, reloaded: reloaded };
  }

  G.Systems = G.Systems || {};
  G.Systems.Auto = { pick: pick, fire: fire, reload: reload, AUTO_ROLES: AUTO_ROLES };
})(window.GW);
