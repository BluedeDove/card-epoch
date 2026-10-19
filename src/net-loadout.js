/* ================= GW.NetLoadout（战前选牌的「牌库合法性」纯逻辑层） =================
   任务书 docs/tasks/N5_NET_LOADOUT.md 第 1 条；口径 docs/ROUTER.md §2 与 docs/NET.md §10。
   房主是双方牌库的收货方，所以**校验口径写在服务端口这一层**，不在 UI 里判第二遍：
     · 整副正好 12 张；同一张最多 2 份；id 必须存在于 G.CARDS_BY_ID；地形卡 >= 4 张
       （这是挖掘游戏，不带挖掘卡是非法构筑 —— ROUTER.md §2 的原话）。
   纪律（与 src/net-ws.js / src/net-match.js 同一条）：零 DOM、零玩家可见中文、零 THREE；
     拒绝只报 key（count/terrain/copies/unknown/empty），人话在 src/hud.js 的 H.TEXT.loadout。
     纯函数、无随机、无时钟：同一份输入必得同一份输出（tools/loadout_check.cjs 的 L0/L1/L2 逐条钉）。
   数字来源：三条上限的真源是 src/ui/viewmodel.js 的 UI.LOADOUT_RULES（「界面写的数 = 判就绪的数」
     那条老规矩）。页面里本层读同一份常量；node 量具里 UI 层没加载，才退回下面这份同名默认值——
     两边漂了由 loadout_check 的 L1 那组断言当场打回，不靠自觉。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 兜底默认值（只在 node 量具里用到：页面里一律以 UI.LOADOUT_RULES 为准） */
  var DEF = { deckSize: 12, eachMax: 2, terrainMin: 4 };
  var TERRAIN = 'terrain';                       // 与 cards.js 的 c.type 同名字符串

  /* 每次调用现读：视图层换了上限（只可能改 viewmodel 那一处），这里跟着一起变 */
  function rules() {
    var R = (G.UI && G.UI.LOADOUT_RULES) || null;
    return {
      deckSize: (R && R.deckSize > 0) ? (R.deckSize | 0) : DEF.deckSize,
      eachMax: (R && R.eachMax > 0) ? (R.eachMax | 0) : DEF.eachMax,
      terrainMin: (R && R.terrainMin >= 0) ? (R.terrainMin | 0) : DEF.terrainMin
    };
  }
  function cardOf(id) { return (typeof id === 'string' && G.CARDS_BY_ID) ? (G.CARDS_BY_ID[id] || null) : null; }
  function isTerrain(id) { var c = cardOf(id); return !!(c && c.type === TERRAIN); }

  /* ---------- validateDeck：房主收货时的唯一判据 ----------
     返回 {ok:true, terrain:地形张数} 或 {ok:false, reason:'count'|'terrain'|'copies'|'unknown'|'empty'}。
     判序写死在这里（loadout_check 的 L1 逐条钉，改序就是改语义）：
       空 → 张数 → 未知 id → 单卡份数 → 地形数。
     为什么「张数」排在「未知 id」之前：一份 13 张且夹了一张陌生卡的牌库，玩家先要被告知"多了一张"
     （改一处就好），而不是被一句"这张卡不存在"岔开注意力。 */
  function validateDeck(deck) {
    var R = rules();
    if (!Array.isArray(deck) || !deck.length) return { ok: false, reason: 'empty' };
    if (deck.length !== R.deckSize) return { ok: false, reason: 'count' };
    var counts = {}, i, id, terrain = 0;
    for (i = 0; i < deck.length; i++) {
      id = deck[i];
      if (!cardOf(id)) return { ok: false, reason: 'unknown' };
      counts[id] = (counts[id] | 0) + 1;
      if (counts[id] > R.eachMax) return { ok: false, reason: 'copies' };
      if (isTerrain(id)) terrain++;
    }
    if (terrain < R.terrainMin) return { ok: false, reason: 'terrain' };
    return { ok: true, terrain: terrain };
  }

  /* ---------- pickCounts：{卡 id: 张数} → 牌库数组 ----------
     视图状态存的是 counts（面板按它画 ×N），线上传的是数组（Match 的 cards 就是数组）。
     展开顺序 = 键的插入顺序（= 玩家第一次点那张卡的顺序），**不排序**：
     排序会把「我先点了哪张」这件事实抹掉，而两端比「自己牌库的第一个元素」靠的就是它。
     负数与 0 直接跳过（面板删到 0 会删键；外部塞进来的脏值也不许多造出牌）。 */
  function pickCounts(picks) {
    var out = [];
    if (picks && typeof picks === 'object') {
      var keys = Object.keys(picks), i, k;
      for (i = 0; i < keys.length; i++) {
        var n = picks[keys[i]] | 0;
        for (k = 0; k < n; k++) out.push(keys[i]);
      }
    }
    return out;
  }

  /* ---------- sanitize：把一份脏牌库夹回合法形状（去未知 id → 每份夹到 eachMax → 截到 deckSize） ----------
     这是**容错**用的，不是判据：判非法一律用 validateDeck。
     用途：房主对「收下后才发现被改坏」的牌库做最小修补，以及量具造边界样本。 */
  function sanitize(deck) {
    var R = rules(), out = [], counts = {}, i, id;
    if (!Array.isArray(deck)) return out;
    for (i = 0; i < deck.length && out.length < R.deckSize; i++) {
      id = deck[i];
      if (!cardOf(id)) continue;                  // 未知卡：整条丢掉
      counts[id] = (counts[id] | 0) + 1;
      if (counts[id] > R.eachMax) continue;       // 第三份起：丢掉
      out.push(id);
    }
    return out;
  }

  /* ---------- autoDeck：给量具与调试入口的一份「必定合法」的牌库（确定性，无随机） ----------
     为什么放在这一层：「前 12 张且地形 ≥4」是**判据的镜像**（validateDeck 的反面），
     调试入口与 net_e2e 都要它；写在 main.js 里就等于把判据抄第二份（AGENTS 的「两个主人」那条）。
     取牌顺序（写死，同输入同输出）：
       ① 点了 opts.element 就**先**按卡表原顺序取那一系的非地形卡，最多取 deckSize - terrainMin 张
          （点名要"这一系"，那第一位就该看见它 —— E9 判「两端自己牌库的第一个元素不同」用的就是这个位置）；
       ② 再按卡表原顺序把地形卡各取一张，凑够 terrainMin（这是挖掘游戏的下限，先满足它再谈别的）；
       ③ 剩下的名额按 地形卡 → 其余卡 的顺序补满，每张夹到 eachMax。
     卡表不够用时（理论上不会）交回一份过不了 validateDeck 的牌库：让调用方看见真话，不在这里造假。 */
  function autoDeck(opts) {
    var R = rules(), CARDS = G.CARDS || [];
    var want = (opts && opts.element) || null;
    var out = [], counts = {}, terrain = 0, i, c;
    function take(card) {
      if (!card || !card.id || out.length >= R.deckSize) return;
      if (!cardOf(card.id)) return;
      if ((counts[card.id] | 0) >= R.eachMax) return;
      counts[card.id] = (counts[card.id] | 0) + 1;
      out.push(card.id);
      if (card.type === TERRAIN) terrain++;
    }
    var terr = [], elem = [], rest = [];
    for (i = 0; i < CARDS.length; i++) {
      c = CARDS[i];
      if (!c || !c.id || !cardOf(c.id)) continue;
      if (c.type === TERRAIN) terr.push(c);
      else if (want && c.element === want) elem.push(c);
      else rest.push(c);
    }
    var elemCap = want ? Math.max(0, R.deckSize - R.terrainMin) : 0;
    for (i = 0; i < elem.length && out.length < elemCap; i++) take(elem[i]);
    for (i = 0; i < terr.length && terrain < R.terrainMin; i++) take(terr[i]);
    for (i = 0; i < elem.length && out.length < R.deckSize; i++) take(elem[i]);
    for (i = 0; i < rest.length && out.length < R.deckSize; i++) take(rest[i]);
    for (i = 0; i < terr.length && out.length < R.deckSize; i++) take(terr[i]);
    for (i = 0; out.length < R.deckSize && i < CARDS.length; i++) take(CARDS[i]);   // 兜底：允许补到第二份
    return out.slice(0, R.deckSize);
  }

  /* ---------- SIGNATURE：排序后的牌库指纹（只进日志，不给玩家看） ----------
     形如 'bolt:2,dig:1,...'。房主用它判「双方牌库是否相同」（同构筑开局的日志线索）。
     排序是为了让「同一副牌的不同点选顺序」得到同一个串；与 pickCounts 的不排序**不矛盾**：
     那边是事实顺序（要还原成牌库），这边是比对键（要归一化）。 */
  function SIGNATURE(deck) {
    var arr = Array.isArray(deck) ? deck : [];
    var counts = {}, i, id;
    for (i = 0; i < arr.length; i++) {
      id = (typeof arr[i] === 'string') ? arr[i] : String(arr[i]);
      counts[id] = (counts[id] | 0) + 1;
    }
    return Object.keys(counts).sort().map(function (k) { return k + ':' + counts[k]; }).join(',');
  }

  G.NetLoadout = {
    DEFAULTS: DEF,
    rules: rules,
    validateDeck: validateDeck,
    pickCounts: pickCounts,
    sanitize: sanitize,
    autoDeck: autoDeck,
    SIGNATURE: SIGNATURE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.NetLoadout;   // node 量具以 window 垫片加载
})(window.GW);
