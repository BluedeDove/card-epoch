/* ================= GW.UI.bags.sources（CardSource：权威源 → 只读投影） =================
   来源：docs/PLAN_SYSTEMS.md §20.3。
   每个源只回答「这一页现在有哪些条目」，不写状态、不碰 DOM、不出文案：

     · hand     手持栏：5 格，一格一张（镜像 p.hand）。
     · deck     牌库：按卡 id 聚合显示 ×N，抽牌顺序 = 顶部在前；extra.top3 给详情栏猜下一张（§20.5）。
     · discard  弃牌堆：按 id 聚合，最近在前。
     · tray     随身格：10 格本地收藏（localStorage），不进牌库。
     · catalog  图鉴：全部卡（infinite 网格）。

   口径（都来自权威层现状，照搬不重写）：
     · 牌库顶 = 数组**尾部**（battle.js 的 drawCards 用 deck.pop() 抽牌）。
     · 弃牌堆最近 = 数组**尾部**（battle.js 的 discardSlot 用 discard.push() 入堆）。
     · 聚合：同一 id 合并 count，顺序按「遍历方向上的首次出现」（§20.3 投影规则 2）。
     · 每帧现算、不缓存权威副本（§20.3 投影规则 1）；只投影 side，不写任何东西。

   不依赖 ViewModel：入参是 appLike = { match, ui, cards } 最小形状（REFACTOR_WORK B 节）。
   catalog 只在创造页显示这件事**不在这里判**——那是 profile（profiles.js）的 pages/caps 的活，
   本文件任何 snapshot 都不读 creative 标记（「没有 creative 分支漏出」由 tools/bag_check.cjs 机检）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  var HAND_SLOTS = 5;
  var TRAY_SLOTS = 10;

  /* ---------- 小工具（纯读） ---------- */
  function playerOf(app, side) {
    var m = app && app.match;
    var ps = m && m.players;
    return (ps && ps[side]) || null;
  }
  function cardById(app, id) {
    var byId = (app && app.cards && app.cards.byId) || G.CARDS_BY_ID || {};
    return byId[id] || null;
  }
  function cardItem(app, id, count) {
    return { kind: 'card', id: id, count: count, meta: { card: cardById(app, id) } };
  }
  /* 聚合：同一 id 合并 count，顺序按「遍历方向上的首次出现」。
     dir<0 = 从尾部向头（顶部/最近在前），dir>0 = 从头向尾。返回的条目顺序即显示顺序。 */
  function aggregate(arr, app, dir) {
    var items = [];
    var index = Object.create(null);   // id -> 在 items 里的下标
    for (var k = 0; k < arr.length; k++) {
      var i = dir < 0 ? (arr.length - 1 - k) : k;
      var id = arr[i];
      var pos = index[id];
      if (pos === undefined) {
        index[id] = items.length;
        items.push(cardItem(app, id, 1));
      } else {
        items[pos].count++;
      }
    }
    return items;
  }

  /* ---------- 各源 snapshot ---------- */
  function handSnapshot(app, side) {
    var p = playerOf(app, side);
    var hand = (p && p.hand) || [];
    var items = [];
    for (var i = 0; i < HAND_SLOTS; i++) items[i] = hand[i] ? cardItem(app, hand[i], 1) : null;
    var n = 0;
    for (var q = 0; q < items.length; q++) if (items[q]) n++;
    return { items: items, total: n };
  }

  function deckSnapshot(app, side) {
    var p = playerOf(app, side);
    var deck = (p && p.deck) || [];
    var top3 = [];
    for (var k = 0; k < 3 && k < deck.length; k++) top3.push(deck[deck.length - 1 - k]);
    return { items: aggregate(deck, app, -1), total: deck.length, extra: { top3: top3 } };
  }

  function discardSnapshot(app, side) {
    var p = playerOf(app, side);
    var disc = (p && p.discard) || [];
    return { items: aggregate(disc, app, -1), total: disc.length };
  }

  function traySnapshot(app, side) {
    /* 随身格是 P1 的本地收藏（§20.3 规则 3：只投影 side=0），side 参数忽略。 */
    var raw = (app && app.ui && app.ui.tray) || [];
    var items = [];
    for (var i = 0; i < TRAY_SLOTS; i++) {
      var rec = raw[i];
      if (!rec) { items[i] = null; continue; }
      items[i] = {
        kind: rec.kind || 'card',
        id: rec.id,
        count: (rec.count != null) ? rec.count : 1,
        meta: (rec.kind === 'block') ? (rec.meta || null) : { card: cardById(app, rec.id) }
      };
    }
    var total = 0;
    for (var j = 0; j < items.length; j++) if (items[j]) total++;
    return { items: items, total: total };
  }

  function catalogSnapshot(app, side) {
    var list = (app && app.cards && app.cards.list) || G.CARDS || [];
    var items = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      items.push({ kind: 'card', id: c.id, count: 1, meta: { card: c } });
    }
    return { items: items, total: list.length };
  }

  /* ---------- 意图路由（§20.3 旧意图 → 新路由，纯映射，不写状态） ----------
     旧意图词不删、只重路由：ui_check 的 INTENTS 反查与 deny 人话表继续认这些词。
     ui.give 仍要求创造模式——那由 profile.caps.catalog 把关，不在本映射里写死。 */
  var INTENT_ROUTES = {
    'ui.reorderHand': 'hand.reorder',
    'ui.useSlot': 'hand.use',
    'ui.castCard': 'hand.use',
    'ui.discard': 'hand.discard',
    'ui.takeFromHand': 'hand.take',
    'ui.give': 'catalog.take',
    'ui.selectSlot': 'UIState.select',
    'ui.selectClass': 'deck.setClass',
    'ui.examine': 'source.examine',
    'ui.readOnlyUse': 'source.examine',
    'ui.dropOnWorld': 'hand.use'
  };
  function intent(action, args) {
    var route = INTENT_ROUTES[action];
    if (!route) return null;
    return { type: route, payload: args || {} };
  }

  function source(id, authority, layout, cols, caps, snap) {
    return {
      id: id,
      authority: authority,
      page: { key: id, labelKey: 'bag.' + id, cols: cols, layout: layout },
      caps: caps,
      snapshot: snap,
      intent: intent
    };
  }

  var CardSources = {
    hand:    source('hand',    'authoritative', 'slots',   5,  { take: true,  put: true,  reorder: true,  use: true,  discard: true,  examine: true }, handSnapshot),
    deck:    source('deck',    'authoritative', 'stacks',  1,  { take: false, put: false, reorder: false, use: false, discard: false, examine: true }, deckSnapshot),
    discard: source('discard', 'authoritative', 'stacks',  1,  { take: false, put: false, reorder: false, use: false, discard: false, examine: true }, discardSnapshot),
    tray:    source('tray',    'local',         'slots',  10,  { take: true,  put: true,  reorder: true,  use: false, discard: false, examine: true }, traySnapshot),
    catalog: source('catalog', 'infinite',      'grid',   12,  { take: true,  put: false, reorder: false, use: false, discard: false, examine: true }, catalogSnapshot)
  };

  var UI = G.UI || (G.UI = {});
  var bags = UI.bags || (UI.bags = {});
  bags.sources = CardSources;
  bags.HAND_SLOTS = HAND_SLOTS;
  bags.TRAY_SLOTS = TRAY_SLOTS;
  G.CardSources = CardSources;
})(window.GW);
