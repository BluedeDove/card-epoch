/* js/systems/deck.js · 牌库/手牌/弃牌/类别（从 battle.js 搬出，行为逐字不变）
   搬出范围：reshuffle / drawCards / handCard / cardTypeSet / cardType / siftType /
             equipClass / takeFromHand / swapHand / discardSlot / refillHand。
   调用约定：第一个参数是状态容器 m（当前 Match 实例，S1 之后是 GameState）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function reshuffle(m, p) {
    /* 洗牌 = 把**当前牌库**与弃牌堆合并再洗（旧写法 p.deck = p.discard.slice() 把牌库整段丢掉）。
       为什么不能只取弃牌堆：drawCards 确实只在牌库空时调这里，但类别补牌（equipClass / refillHand）
       是"按类从牌库里挑"，牌库里还压着别的类的牌时也会走到这一步——那些牌就凭空消失了
       （用户 2026-10-18 报"Shift+滚轮滚一圈卡牌会消失"；实测 7 张 → 3 张）。
       合并写法在"牌库本来就空"的老路径上逐字节等价（[] + discard），洗牌用的 rng 序列也不变。 */
    if (p.discard.length) { p.deck = p.deck.concat(p.discard); p.discard = []; }
    // Fisher-Yates，用同一个 rng（抽成一处：类别补牌也要洗，两边必须同一序列）
    for (var k = p.deck.length - 1; k > 0; k--) { var j = Math.floor(m.rng() * (k + 1)); var t = p.deck[k]; p.deck[k] = p.deck[j]; p.deck[j] = t; }
  };
  function drawCards(m, p, n, silent) {
    for (var i = 0; i < n; i++) {
      if (!p.deck.length) {
        if (!p.discard.length) { if (!silent) m.fx.log(p.name + ' 牌库与弃牌堆都空了', '#8a94a6'); return; }
        m.reshuffle(p);
        if (!silent) m.fx.log(p.name + ' 重新洗入弃牌堆（' + p.deck.length + ' 张）', '#8a94a6');
      }
      if (p.hand.length >= 5) { p.discard.push(p.deck.pop()); continue; }
      p.hand.push(p.deck.pop());
    }
    m.touch('players', p.side);
  };
  function handCard(m, p, i) { return p.hand[i] ? G.CARDS_BY_ID[p.hand[i]] : null; };

  /* ---------- 出牌组（用户 2026-10-18："按**放出来干什么**分组，不是按功能类别"） ----------
       组 = 卡的 role 字段（cards.js 的纯数据）：place 放置 / dig 破坏 / move 移动 / shot 远程 /
       sigil 法阵 / ultra 超阶 / summon 召唤 / aid 辅助。它管的是**出牌手感**：
       切到"放置"手里就只有能摆方块的牌，切到"远程"就只有放出去打人的牌。
       与 type（terrain/spell/sigil/summon/utility）分开：type 仍然管图鉴筛选与流派。

       p.handClass = null → 全部（出牌后随机补一张；AI / 分屏 P2 / 老量具走这条，行为零变化）
       p.handClass = 某组 → 手持栏只装这一组；同类打光就**宁可空着**也不掺别组，
                            于是"这一格一定能放方块"是可以承诺的事。

       三条守恒（tools/hand_check.cjs + tools/bag_flow_check.cjs 量）：切组与补牌前后，
       hand+deck+discard 的多重集不变、张数不变、同种子逐字节可复现（洗牌 rng 同一处）。

       strike / build 是 2026-10-18 的旧两档分组，**只为老量具与存档保留**（按 type 派生）：
       build = 地形、strike = 非地形。界面上的轮盘已经不再转这两档。 */
  var ROLES = ['place', 'dig', 'move', 'shot', 'sigil', 'ultra', 'summon', 'aid'];
  var ROLE_SET = null;
  var LEGACY_GROUP = {
    build: function (t) { return t === 'terrain'; },
    strike: function (t) { return t !== 'terrain'; }
  };
  function roleSet() {
    if (ROLE_SET) return ROLE_SET;
    ROLE_SET = {};
    for (var i = 0; i < ROLES.length; i++) ROLE_SET[ROLES[i]] = true;
    return ROLE_SET;
  }
  var TYPE_SET = null;
  function cardTypeSet(m, ) {
    if (TYPE_SET) return TYPE_SET;                       // 类型的真源是 cards.js 的纯数据，这里不另列一份
    TYPE_SET = {};
    for (var id in G.CARDS_BY_ID) {
      var c = G.CARDS_BY_ID[id]; if (!c) continue;
      TYPE_SET[c.type || 'utility'] = true;
      if (c.role) TYPE_SET[c.role] = true;
      TYPE_SET.strike = true; TYPE_SET.build = true;     // 旧两档：老量具/存档还能切
    }
    return TYPE_SET;
  };
  function cardType(m, id) { var c = G.CARDS_BY_ID[id]; return c ? (c.type || 'utility') : 'utility'; };
  function isGroup(t) { return !!LEGACY_GROUP[t] || !!roleSet()[t]; };
  function cardGroup(m, id) { var c = G.CARDS_BY_ID[id]; return (c && c.role) || 'shot'; };
  /* 手牌/牌堆按「组或细分类型」过滤：cls = role 之一（8 组）、旧两档（strike/build）、或 5 个细分类型 */
  function inClass(m, id, cls) {
    var lg = LEGACY_GROUP[cls];
    if (lg) return lg(m.cardType(id));
    if (roleSet()[cls]) return m.cardGroup(id) === cls;
    return m.cardType(id) === cls;
  };
  function siftClass(m, arr, cls) {
    var take = [], rest = [], i;
    for (i = 0; i < arr.length; i++) { if (inClass(m, arr[i], cls)) take.push(arr[i]); else rest.push(arr[i]); }
    return { take: take, rest: rest };
  };
  /* 把一个牌堆按类拆成 {take, rest}，两边都保持原来的相对顺序 */
  function siftType(m, arr, type) {
    var take = [], rest = [], i;
    for (i = 0; i < arr.length; i++) { if (m.cardType(arr[i]) === type) take.push(arr[i]); else rest.push(arr[i]); }
    return { take: take, rest: rest };
  };
  /* 切到某一类：手里别的类的牌回牌库**底**（手牌是私有的，不丢进公开的弃牌堆），
     同类从牌库顶依次补进手牌；没补齐的那几格宁可空着。 */
  function equipClass(m, p, type) {
    if (!p) return { ok: false, reason: 'no-player' };
    if (type === null || type === 'all') {
      /* 回到「全部」必须把手牌补满：旧写法只把 handClass 置空就返回，于是"全部→打击→建筑→全部"
         滚一圈之后手里只剩建筑那 3 格，牌库里还压着 5 张 —— 玩家看到的就是"卡牌消失了"。
         补回来的优先是切类时被挪走的那几张（handKept），不够再从牌库抽。 */
      var was = !!p.handClass;
      p.handClass = null;
      if (was) fillAll(m, p);
      p.handKept = null;
      return { ok: true, handClass: null, equipped: p.hand.length };
    }
    if (!m.cardTypeSet()[type]) return { ok: false, reason: 'no-class' };
    if (!p.handClass) p.handKept = p.hand.slice();   // 记住「全部」时那副手牌，切回来时优先还原
    p.handClass = type;
    var mine = [], others = [], i;
    for (i = 0; i < p.hand.length; i++) { if (inClass(m, p.hand[i], type)) mine.push(p.hand[i]); else others.push(p.hand[i]); }
    p.hand = mine.slice(0, 5);                       // 同类优先占格，最多 5
    /* 非同类（以及同类超出 5 张的零头）整体回到牌库**底**：数组头部才是底（抽牌从尾部 pop），
       并且**必须在原牌库之前 concat**，写成赋值会把原牌库覆盖掉——上一版这里就是我写坏的丢牌 bug。 */
    var overflow = others.concat(mine.slice(5));
    p.deck = overflow.concat(p.deck);
    var need = 5 - p.hand.length;
    var s = siftClass(m, p.deck, type);
    if (!s.take.length && p.discard.length) { m.reshuffle(p); s = siftClass(m, p.deck, type); }
    var got = s.take.slice(0, Math.max(0, need));
    for (i = 0; i < got.length; i++) p.hand.push(got[i]);
    p.deck = s.rest.concat(s.take.slice(got.length));               // 剩下的同类放回牌库**顶**，补位抽得到
    return { ok: true, handClass: type, equipped: p.hand.length };
  };
  /* 回到「全部」：把手牌补回 5 格（详见 equipClass 里的说明）。
     守三条：① 只搬已经不在这副手里的牌；② 优先还 handKept 里那几张；③ 一张牌都不许丢。 */
  function fillAll(m, p) {
    var want = (p.handKept || []).slice(), k, at;
    for (k = 0; k < want.length && p.hand.length < 5; k++) {
      at = p.deck.lastIndexOf(want[k]);
      if (at >= 0) p.hand.push(p.deck.splice(at, 1)[0]);
    }
    if (p.hand.length < 5) m.drawCards(p, 5 - p.hand.length, true);
    m.touch('players', p.side);
  }
  /* ---------- 手牌自身整理：只是重排/丢掉自己已经拿到的牌，不造牌、不动牌库 ----------
     生存模式也开放（用户 2026-10-17：普通模式也该有物品栏与背包，MC 式）。
     creative.js 的 take 现在转发这里，两边不会各写一套漂移。 */
  function takeFromHand(m, p, i) {
    if (!p || !p.hand) return { ok: false, reason: 'empty' };
    i = Math.max(0, Math.min((p.hand.length || 1) - 1, i | 0));
    var id = p.hand[i]; if (!id) return { ok: false, reason: 'empty' };
    p.hand.splice(i, 1);
    m.touch('players', p.side);
    return { ok: true, cardId: id, slot: i, left: p.hand.length };
  };
  function swapHand(m, p, a, b2) {
    if (!p || !p.hand) return { ok: false, reason: 'empty' };
    var n = p.hand.length; a = a | 0; b2 = b2 | 0;
    if (a < 0 || b2 < 0 || a >= n || b2 >= n) return { ok: false, reason: 'no-box' };
    if (a === b2) return { ok: true, cardId: p.hand[a], from: a, to: b2 };
    var t = p.hand[a]; p.hand[a] = p.hand[b2]; p.hand[b2] = t;
    m.touch('players', p.side);
    return { ok: true, cardId: p.hand[b2], from: a, to: b2 };
  };
  /* 把一张牌放回/放进手持栏（拖拽落点）。同格已占则交换：被换下的牌返回给调用方（UI 把它放回光标）。 */
  function placeHand(m, p, slot, id, opts) {
    if (!p || !p.hand) return { ok: false, reason: 'empty' };
    if (!id) return { ok: false, reason: 'empty' };
    var n = p.hand.length;
    if (n >= 5 && slot >= n) return { ok: false, reason: 'slot-full' };
    slot = Math.max(0, Math.min(n, slot | 0));
    var displaced = null;
    if (slot < n) {
      displaced = p.hand[slot]; p.hand[slot] = id;
      if (opts && opts.toDiscard && displaced) p.discard.push(displaced);   // 替换：旧的进弃牌堆，不凭空消失
    } else p.hand.push(id);
    m.touch('players', p.side);
    return { ok: true, displaced: (opts && opts.toDiscard) ? null : displaced, slot: slot, left: p.hand.length };
  }
  /* 手持栏内部换位（拖拽落点）：卡已经被 takeFromHand 拿起来了，所以这里是**插入**而不是替换——
     splice(slot, 0, id) 正好等于"把这张牌挪到第 slot 格、其余依次后移"，也就是玩家看到的换位。
     旧写法让拖拽走 placeHand：目标格那张被换下来塞进光标，鼠标却已经松开，
     玩家看到的是"牌跑到鼠标上了/顺序乱了"（2026-10-18 用户报"背包里不能切换顺序"）。
     三堆守恒：这里只动 p.hand 的顺序，不增不减。 */
  function moveHand(m, p, slot, id) {
    if (!p || !p.hand) return { ok: false, reason: 'empty' };
    if (!id) return { ok: false, reason: 'empty' };
    var n = p.hand.length;
    slot = Math.max(0, Math.min(n, slot | 0));
    p.hand.splice(slot, 0, id);
    m.touch('players', p.side);
    return { ok: true, slot: slot, left: p.hand.length, moved: id };
  }
  /* 从牌库换一张到手持栏（生存模式的"整理手牌"，2026-10-18 用户要求）。
     规则只守一条：**只换不造**——从牌库里拿走的那一张，用被顶下来的那一张原位补回去，
     所以 hand+deck+discard 的张数与多重集在动作前后完全一样（tools/bag_flow_check.cjs 量它）。
     组筛选开着时只收同一组的牌：手持栏"只有放置类"这个承诺不能靠一张拖拽破掉。 */
  function dealFromDeck(m, p, slot, id) {
    if (!p || !p.hand || !p.deck) return { ok: false, reason: 'empty' };
    if (!id) return { ok: false, reason: 'empty' };
    if (p.handClass && !inClass(m, id, p.handClass)) return { ok: false, reason: 'group-mismatch' };
    var at = p.deck.lastIndexOf(id);
    if (at < 0) return { ok: false, reason: 'no-card' };
    var n = p.hand.length, displaced = null;
    slot = Math.max(0, Math.min(n, slot | 0));
    p.deck.splice(at, 1);
    if (slot < n) { displaced = p.hand[slot]; p.hand[slot] = id; }
    else p.hand.push(id);
    /* 换下来的那张回到牌库的**同一位置**：不洗牌、不掉进弃牌堆，玩家手里的牌一张都没少。 */
    if (displaced) p.deck.splice(at, 0, displaced);
    m.touch('players', p.side);
    return { ok: true, displaced: displaced, slot: slot, deckSize: p.deck.length, left: p.hand.length };
  }
  /* 光标上那张牌无处安放（手牌满格）时的兜底：进弃牌堆。
     这是"不吞牌"的最后一道闸——宁可让它进弃牌堆（洗牌后会再抽到），也不许凭空消失。 */
  function stowDiscard(m, p, id) {
    if (!p || !id) return { ok: false, reason: 'empty' };
    p.discard.push(id);
    m.touch('players', p.side);
    return { ok: true, cardId: id, via: 'discard' };
  }
  function discardSlot(m, p, i) {
    var r = m.takeFromHand(p, i);
    if (!r.ok) return r;
    p.discard.push(r.cardId);
    m.touch('players', p.side);
    return { ok: true, cardId: r.cardId, slot: r.slot };
  };
  /* 出牌后的补位：切了类就只补同类（补不上就空着），没切类照旧随机补 */
  function refillHand(m, p) {
    if (!p.handClass) { m.drawCards(p, 1, true); return; }
    var have = 0, i;
    for (i = 0; i < p.hand.length; i++) { if (inClass(m, p.hand[i], p.handClass)) have++; }
    while (have < 5) {
      var s = siftClass(m, p.deck, p.handClass);
      if (!s.take.length) {
        if (!p.discard.length) break;
        m.reshuffle(p);
        s = siftClass(m, p.deck, p.handClass);
        if (!s.take.length) break;
      }
      p.hand.push(s.take[0]);
      p.deck = s.rest.concat(s.take.slice(1));
      have++;
    }
  };

  /* ---------- 出牌入口（唯一操作通道；移动不走这里） ---------- */

  G.Systems = G.Systems || {};
  G.Systems.Deck = { reshuffle: reshuffle, drawCards: drawCards, handCard: handCard, cardTypeSet: cardTypeSet, cardType: cardType, cardGroup: cardGroup, inClass: inClass, siftType: siftType, siftClass: siftClass, equipClass: equipClass, takeFromHand: takeFromHand, swapHand: swapHand, discardSlot: discardSlot, stowDiscard: stowDiscard, placeHand: placeHand, moveHand: moveHand, dealFromDeck: dealFromDeck, refillHand: refillHand };
})(window.GW);
