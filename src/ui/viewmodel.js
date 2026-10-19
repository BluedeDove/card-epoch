/* ================= GW.UI.viewmodel（视图模型：把对局数据翻成"界面要读的那些字段"） =================
   PLAN_REFACTOR §7 的口径：**渲染循环不写 DOM，一切经 viewmodel；ui 不查规则。**
   所以这个文件是"数据 → 字段"的唯一一处翻译：

     · 权威数据（match / players / hand / cooldowns）在这里被读成扁平字段，面板只管显示；
     · 能不能出牌（canPlay）不在这里判定 —— 向 GW.UI.channel 问 app 注册的探针，app 不给就是 null；
     · 卡面/方块的物品条目（含名称、说明、配色、冷却文本）由 js/hud.js 注入的 makeItem 生成，
       本文件一个中文字都不出现（文案表在 hud 层，机检拦这条）。

   面板每帧读的是同一个对象（就地更新），所以脏检查比得出"哪个字段真的变了"。
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});

  const HAND_MAX = 5;

  /* ---------- 战前选牌（docs/ROUTER.md §2）：三条数值的唯一出处 ----------
     卡池 = 全部卡；同一张最多 2 份；整副正好 12 张；地形卡 ≥ 4 才让就绪（Kimi 方案 B 的既有约束：
     这是挖掘游戏，不带挖掘卡是非法构筑）。这三个数在文档里写死一份，代码里就只准出现这一次：
     面板读 vm.loadoutDeckSize / EachMax / TerrainMin，src/hud.js 的 ui.loadoutPick 读同一份常量。
     房主侧的服务端校验（同一批判据）由联机那一刀接，本层只管界面读数。 */
  const LOADOUT_RULES = { deckSize: 12, eachMax: 2, terrainMin: 4 };
  UI.LOADOUT_RULES = LOADOUT_RULES;

  /* type 的展示顺序：读 G.TYPE_CN 的 key 序（数据层给什么顺序就什么顺序，这里不排第二份） */
  function typeRank(order, t) { const i = order.indexOf(t); return i < 0 ? order.length : i; }

  class ViewModel {
    constructor(deps) {
      this.deps = deps || {};
      this.bag = this.deps.bag || UI.bag;
      this.ch = this.deps.channel || UI.channel;
      this.makeItem = this.deps.makeItem || null;      // (kind, id, count) → item（由 hud 层注入）
      /* 模型必须就地写：面板 spec 里的闭包在创建时就抓住了这个对象，
         换一个对象会让所有"点一下改个字段"的写入落空（这一条 UI 回归抓到过）。 */
      this.state = this.deps.model || {
        filters: { tab: 'cards', el: 'all', ty: 'all', q: '' },
        tray: [],
        /* detailKey = 悬停的是哪张卡；detailBox/detailSlot = 它在**哪个容器**里（卡页的位置行、按钮门禁要它）。
           同一张卡在牌库与手持栏都出现时，只按 id 分不出玩家在看哪一张。 */
        detailKey: '', detailBox: null, detailSlot: -1,
        sel: [0, 0],
        toast: { text: '', color: '', until: 0 },
        aim: { text: '', hit: false },
        /* 菜单表单的状态也是视图状态：字段名就是面板 spec 里读的那些 */
        modeRow: 'train', deckRow: 'starter', mapRow: 'island-96', seedText: '', creativeOn: false, saveText: '',
        result: null,
        /* 占矿读数（build() 每轮就地写）：先给空骨架，spec 第一次求值时不该看到 undefined */
        score: [0, 0], timeLeft: '', lodes: [], ruleText: '', mapText: '',
        /* 积分榜（编排类的 displaySpec 原样带过来；null = 这一局没挂编排类，面板整块不占位）。
           选关的两个轴（game / gameTarget）不在这里给初值：真源是 panels.js 的 useModel 那一份，
           这里再写一份就成了两处（hud.js 的 ui.menuPick 用 `field in L` 当闸，两份不一致就静默丢）。 */
        board: null,
        /* 战前选牌（docs/ROUTER.md §2）的视图状态：picks = {卡 id: 张数}。
           **只能就地改**（buildLoadout 与 src/hud.js 的 ui.loadoutPick 写的都是这一个对象）：
           换掉整个 loadout 会让面板闭包读着旧引用不动 —— 与上面 sel 那条同一个坑。 */
        loadout: { picks: {}, ready: false, status: 'waiting' },
        loadoutPool: [], loadoutPicks: [],
        loadoutCount: 0, loadoutTerrain: 0, loadoutReady: false, loadoutEligible: false, loadoutStatus: 'waiting',
        loadoutDeny: '', loadoutRole: '', loadoutRoom: '',
        loadoutDeckSize: LOADOUT_RULES.deckSize, loadoutEachMax: LOADOUT_RULES.eachMax,
        loadoutTerrainMin: LOADOUT_RULES.terrainMin
      };
      if (this.deps.model) {                       // 采用 app 已有的模型，补齐缺字段
        const m = this.deps.model;
        for (const k in this.state) if (m[k] === undefined) m[k] = this.state[k];
        this.state = m;
      }
      this._last = {};                                  // 脏检查缓存（按字段签名）
    }

    /* ---------- 随身格：UI 层自己的收藏，持久化在 localStorage（存 id，不存文案） ---------- */
    loadTray(size) {
      let ids = [];
      try {
        const raw = window.localStorage && localStorage.getItem('gw.ui.tray');
        if (raw) ids = JSON.parse(raw) || [];
      } catch (e) { ids = []; }
      this.state.tray = [];
      for (let i = 0; i < size; i++) {
        const rec = ids[i];
        this.state.tray[i] = (rec && this.makeItem) ? this.makeItem(rec.kind, rec.id, rec.count) : null;
      }
      return this.state.tray;
    }
    saveTray() {
      try {
        if (!window.localStorage) return;
        const out = this.state.tray.map((it) => (it ? { kind: it.kind, id: it.id, count: it.count } : null));
        localStorage.setItem('gw.ui.tray', JSON.stringify(out));
      } catch (e) { }
    }
    trayAdd(item, slot) {
      const list = this.state.tray;
      if (!item) return { ok: false, reason: 'empty' };
      let at = (typeof slot === 'number' && slot >= 0) ? slot : -1;
      if (at < 0) for (let i = 0; i < list.length; i++) if (!list[i]) { at = i; break; }
      if (at < 0) return { ok: false, reason: 'no-room' };
      list[at] = this.makeItem ? this.makeItem(item.kind, item.id, item.count, item.meta) : item;
      this.saveTray();
      if (UI.app) UI.app.invalidate('inv');
      return { ok: true, slot: at };
    }

    /* ---------- 主构造入口：装配层每次 H.update 调一次 ---------- */
    build(env) {
      const match = env.match, split = !!env.split;
      const vm = this.state;
      vm.running = !!env.running;
      /* 自动开火（按住左键）的视图状态：只给手持栏那枚徽章用；挑牌规则在权威层（systems/auto.js） */
      vm.autoFire = !!env.auto;
      vm.split = split;
      vm.title = env.title;
      vm.seed = env.seed != null ? String(env.seed) : (match ? String(match.seed) : '—');
      vm.modeText = env.modeText || '';
      /* 这几个数字就是 match 上的纯计数器，读它们不等于查规则（出牌合法性之类一律由 app 写进来） */
      vm.time = env.time != null ? env.time.toFixed(1) : (match ? (match.time || 0).toFixed(1) : '0.0');
      vm.tick = String(env.tick != null ? env.tick : (match ? match.tick : 0));
      vm.fps = String(env.fps || 0);
      vm.biome = env.biome || '—';
      vm.camName = env.camName || '';
      vm.err = !!env.err;
      vm.badges = env.badges || [];
      vm.sel = this.deps.sel || vm.sel;

      /* --- 占矿玩法的读数（T5）：比分 / 剩余时间 / 三矿归属 / 关卡 ---
         全是 match 上的公开计数器与归属字段，读它们不等于查规则（出牌合法性之类仍由装配层写进来）。
         本层零中文：ruleText / mapText 只带 id，人话由 src/hud.js 的 H.TEXT 翻。 */
      const ps = (match && match.players) || [];
      vm.score = [(ps[0] && ps[0].score) | 0, (ps[1] && ps[1].score) | 0];
      const tcap = (match && typeof match.timeCap === 'number') ? match.timeCap : null;
      vm.timeLeft = (tcap == null || !match) ? '' : fmtMMSS(Math.max(0, tcap - (match.time || 0)));
      const sys = match && match.lodeSys;
      const lodes = (sys && sys.lodes) || [];
      vm.lodes = [];
      for (let li = 0; li < lodes.length; li++) {
        const L = lodes[li] || {};
        vm.lodes.push({ owner: typeof L.owner === 'number' ? L.owner : -1, contested: !!L.contested });
      }
      const sess = env.app && env.app.session;
      const cfg = sess && sess.cfg;
      vm.ruleText = cfg && cfg.rule ? String(cfg.rule) : '';
      vm.mapText = cfg && cfg.map ? String((cfg.map && cfg.map.id) || cfg.map) : '';
      /* --- 积分榜（docs/MODES.md §5）：这一行是视图与编排之间**唯一**的接口 ---
         编排类不在（老路径 / 未挂玩法的对局）就给 null，面板整块不占位；
         这里不判断"几杀算赢"、不决定"有哪几行"：行序与内容全在 displaySpec 里（MODES.md §5）。 */
      vm.board = (match && match.director && match.director.displaySpec) ? match.director.displaySpec() : null;
      /* 玩法 id 只带 key，人话在 src/hud.js 的 H.TEXT.game（本层零中文，与 ruleText 同一条口径） */
      vm.gameText = (match && match.modeCfg && match.modeCfg.id) ? String(match.modeCfg.id) : '';

      /* --- 两台玩家 / 手持栏：由 Selectors.hud 统一翻译（§21，旧循环已收进 selector） --- */
      var hv = (G.Selectors && G.Selectors.hud) ? G.Selectors.hud.get({ game: { match: match } }, {
        fmt: env.fmt, makeItem: this.makeItem || null, split: split,
        ask: this.ch ? this.ch.ask.bind(this.ch) : null
      }) : null;
      vm.players = hv ? hv.players : [];
      vm.hands = hv ? hv.hands : [[], []];
      vm.discard = hv ? (hv.discard || []) : [];

      /* --- 类别手持栏（用户 2026-10-17：切到哪一类就只打那一类）---
         顺序与中文来自文案表（channel.ask('classOrder')），这里只数牌：三堆里各有多少张这一类 */
      const p0 = match && match.players ? match.players[0] : null;
      vm.handClass = (p0 && p0.handClass) || 'all';        // 面板标题用；每台各自的类别看 players[s].classKey
      vm.creative = !!(p0 && p0.creative);
      vm.classes = [];
      /* 类别只有一套：三个大模式（全部 / 打击 / 建筑）。手持栏的类别条、Shift+滚轮、背包左栏的类别片
         读的都是这一份顺序——以前背包片用 5 个细分类型、滚轮用 3 个组，同一份 handClass 被两套词表解释，
         在背包里点"挖掘"之后滚轮就再也对不上（用户："分不同模式使用时跟背包内部显示的逻辑有冲突"）。
         细分类型仍然在（cards.js 的 type 字段 + 图鉴的类型筛选），只是不再是"手持栏模式"。 */
      const order = (this.ch && this.ch.ask('classOrder')) || [];
      for (let k = 0; k < order.length; k++) {
        const t = order[k];
        let n = 0;
        if (p0) {
          const pools = [p0.hand, p0.deck, p0.discard];
          for (let q = 0; q < pools.length; q++) {
            const arr = pools[q] || [];
            for (let z = 0; z < arr.length; z++) {
              const c = G.CARDS_BY_ID[arr[z]];
              /* 组 = cards.js 的 role（放置/破坏/移动/远程/法阵/超阶/召唤/辅助），数的是这一组在三堆里的张数 */
              const hit = (t === 'all') || (c && c.role === t);
              if (hit) n++;
            }
          }
        }
        vm.classes.push({ key: t, n: n });
      }
      /* 生存：收不到图鉴/调试页，默认落在「牌库」；创造：从牌库页回来时切到图鉴 */
      if (!vm.creative && (vm.filters.tab === 'cards' || vm.filters.tab === 'blocks' || vm.filters.tab === 'debug' || vm.filters.tab === 'tray')) vm.filters.tab = 'deck';
      if (vm.creative && (vm.filters.tab === 'deck' || vm.filters.tab === 'discard')) vm.filters.tab = 'cards';

      /* --- 背包分版（§20）：页签/能力由 BagProfile 决定，面板不再自己判 creative --- */
      if (G.Selectors && G.Selectors.bag) {
        const profile = vm.creative ? 'creative' : 'survival';
        vm.bag = G.Selectors.bag.get({ match: match, ui: { bag: { profile: profile }, filters: vm.filters }, cards: { list: G.CARDS, byId: G.CARDS_BY_ID } });
        /* 页签按 **profile 声明的 pages** 长，不按"有 CardSource 的那几页"长：
           方块页 / 调试页没有 CardSource（它们不是"某个权威源的投影"），照着 selector 的
           pages 过滤会把这两页整个吃掉——创造模式的调试页（无限魔力/飞行/假人）因此在界面上
           根本点不开，只剩 卡牌/随身 两页（2026-10-18 从零操作时发现）。 */
        const profPages = (vm.bag && vm.bag.profile && vm.bag.profile.pages) || (vm.bag.pages || []).map((p2) => p2.key);
        vm.tabKeys = profPages.filter((k) => k !== 'hand');
      }
      /* --- 图鉴墙：条目与拖拽容器都从 applyFilters 一处算出来 --- */
      this._match = match;
      this.applyFilters();
      if (this.bag) {
        const tr = this.bag.get('tray');
        if (tr) {
          const list = vm.tray;
          if (tr.size !== list.length) { tr.size = list.length; tr.slots = new Array(list.length).fill(null); }
          for (let i = 0; i < list.length; i++) tr.slots[i] = list[i] || null;
        }
        const hb = this.bag.get('hotbar'), hd = this.bag.get('hand'), hb2 = this.bag.get('hotbar2');
        for (let s = 0; s < 2; s++) {
          const hand = vm.hands[s], tgt = s === 0 ? [hb, hd] : [hb2];
          for (const t of tgt) {
            if (!t) continue;
            t.size = HAND_MAX;
            if (!t.slots || t.slots.length !== HAND_MAX) t.slots = new Array(HAND_MAX).fill(null);
            for (let i = 0; i < HAND_MAX; i++) t.slots[i] = hand[i] || null;
            /* 格位 = 号位：容器里的"选中格"跟着视图的 sel 走，
               点图鉴卡要放进的就是这一格（不接这一句会永远放进 0 格） */
            t.selected = (vm.sel && vm.sel[s] != null) ? vm.sel[s] : -1;
          }
        }
        const dk = this.bag.get('deck'); if (dk) dk.selected = -1;
      }
      /* --- 战前选牌（docs/ROUTER.md §2）：这一页在开局之前，没有对局也要能画 ---
          读数与 match 无关，所以单独一个方法；页面活着时装配层没有主循环，
          改完 picks 由 src/hud.js 的 ui.loadoutPick 直接再调一次本方法（见那里的注释）。 */
      this.buildLoadout();

      /* --- 调试页：GW.Creative.spec() 那份纯数据原样带过去（面板只读它） --- */
      vm.debug = (this.deps.getSpec ? this.deps.getSpec() : null) || null;
      vm.runningCreative = !!(vm.debug && vm.debug.on);
      return vm;
    }

    /* ---------- 战前选牌（docs/ROUTER.md §2）：卡池与已选两份读数 ----------
       只读地翻出 Loadout 面板要用的那些字段，全部**就地写**（数组按下标改、多退少补，
       引用始终是面板抓住的那一个）；picks 的唯一写入口在 src/hud.js 的 ui.loadoutPick，
       那边管三条上限，这里只管「现在是什么样」。本层零中文：条目文案由注入的 makeItem 生成。
       签名（卡表长度 + 已选内容 + 就绪状态）没变就直接返回，76 个条目不必每 60ms 重建一次。 */
    buildLoadout() {
      const vm = this.state;
      const R = UI.LOADOUT_RULES;
      const L = vm.loadout || (vm.loadout = { picks: {}, ready: false, status: 'waiting' });
      if (!L.picks) L.picks = {};
      const picks = L.picks;
      const CARDS = G.CARDS || [];
      vm.loadoutDeckSize = R.deckSize; vm.loadoutEachMax = R.eachMax; vm.loadoutTerrainMin = R.terrainMin;
      /* 先数牌：总张数与地形张数各自独立数（就绪判据读的就是这两个数） */
      let count = 0, terrain = 0;
      const sigKeys = [];
      for (const id in picks) {
        const n = picks[id] | 0;
        if (n <= 0) continue;
        sigKeys.push(id + ':' + n);
        count += n;
        const c = G.CARDS_BY_ID ? G.CARDS_BY_ID[id] : null;
        if (c && c.type === 'terrain') terrain += n;
      }
      const eligible = (count === R.deckSize && terrain >= R.terrainMin);
      vm.loadoutLocal = !!L.local;                 // 配牌模式（不进联机）：面板据此换标题/按钮
      vm.loadoutCount = count;
      vm.loadoutTerrain = terrain;
      vm.loadoutEligible = eligible;
      /* 就绪 = 「按过就绪」且「构筑合法」：改过牌就得重新按过（清 ready 那一条在 hud 的 pick 里） */
      vm.loadoutReady = !!L.ready && eligible;
      vm.loadoutStatus = L.status || 'waiting';
      /* 这一页是「谁在选牌」：角色与房间码由装配层递进来（H.showLoadout(params)），
         本层只带 id，「房主 / 加入者」的说法在 H.TEXT.loadout.roles */
      vm.loadoutRole = L.role || '';
      vm.loadoutRoom = L.room || '';
      /* 上一条被拒的 reason（中文由文案表查 H.TEXT.ui.deny）：这一页盖在 #hud 之上，
         通道那条 toast 玩家看不见，所以状态行要替它把同一句话说出来 */
      vm.loadoutDeny = L.deny || '';
      const sig = CARDS.length + '|' + sigKeys.sort().join(',') + '|' + (L.ready ? 1 : 0) + '|' + (L.status || '') +
        '|' + (L.deny || '') + '|' + (L.room || '') + '|' + (L.role || '') + '|' + (L.peer || '');
      const pool = vm.loadoutPool || (vm.loadoutPool = []);
      const rows = vm.loadoutPicks || (vm.loadoutPicks = []);
      if (sig === this._loSig && pool.length === CARDS.length) return pool;
      this._loSig = sig;
      const order = (G.TYPE_CN && Object.keys(G.TYPE_CN)) || [];
      const list = CARDS.slice().sort((a, b) =>
        (typeRank(order, a.type) - typeRank(order, b.type)) || ((a.cost | 0) - (b.cost | 0)) ||
        String(a.id).localeCompare(String(b.id)));
      const write = (arr, i, rec) => {
        if (arr[i]) { for (const k in arr[i]) if (!(k in rec)) delete arr[i][k]; Object.assign(arr[i], rec); }
        else arr[i] = rec;
        return i + 1;
      };
      let pi = 0, ki = 0;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const n = picks[c.id] | 0;
        const item = this.makeItem ? this.makeItem('card', c.id, 1, { card: c }) : null;
        const meta = (item && item.meta) || {};
        const base = { id: c.id, type: c.type, cost: c.cost | 0, n: n, count: n, item: item,
          label: meta.label || c.id, kindLine: meta.kindLine || '', detail: meta.detail || '' };
        pi = write(pool, pi, base);
        if (n > 0) {
          const picked = Object.assign({}, base);
          picked.total = count; picked.eachMax = R.eachMax;
          ki = write(rows, ki, picked);
        }
      }
      pool.length = pi;
      rows.length = ki;
      return pool;
    }

    /* 图鉴条目 = 页签 + 元素 / 类型 / 关键词筛完的结果；同时写进 catalog 容器，
       让拖拽用的 data-slot 下标与屏幕上看到的一致。搜索框改一下就立刻重算，
       不等每 60ms 的那次 update（旧版也是点一下就出结果）。 */
    applyFilters() {
      const vm = this.state;
      const box = this.bag && this.bag.get('catalog');
      vm.catalog = vm.catalog || [];
      vm.catalogTotal = 0;
      if (!this.makeItem) return vm.catalog;
      const f = vm.filters;
      /* 生存页：牌库/弃牌堆是权威源的只读聚合投影（§20） */
      if (f.tab === 'deck' || f.tab === 'discard') {
        const src = G.CardSources && G.CardSources[f.tab];
        const appLike = { match: this._match, ui: { tray: vm.tray }, cards: { list: G.CARDS, byId: G.CARDS_BY_ID } };
        const snap = src ? src.snapshot(appLike, 0) : { items: [], total: 0 };
        vm.catalog = snap.items.map((it) => this.makeItem('card', it.id, it.count, { card: G.CARDS_BY_ID[it.id], readOnly: true }));
        vm.catalogTotal = snap.total;
        const roBox = this.bag && this.bag.get(f.tab);
        if (roBox) {
          roBox.size = vm.catalog.length;
          if (!roBox.slots || roBox.slots.length !== vm.catalog.length) roBox.slots = new Array(vm.catalog.length).fill(null);
          for (let i2 = 0; i2 < vm.catalog.length; i2++) roBox.slots[i2] = vm.catalog[i2];
        }
        if (box) {
          if (box.size !== vm.catalog.length || !box.slots || box.slots.length !== vm.catalog.length) {
            box.size = vm.catalog.length; box.slots = new Array(vm.catalog.length).fill(null);
          }
          for (let i = 0; i < vm.catalog.length; i++) box.slots[i] = vm.catalog[i];
        }
        return vm.catalog;
      }
      const pool = (f.tab === 'blocks') ? this.blockIds() : this.cardIds();
      const out = [];
      const q = (f.q || '').toLowerCase();
      for (let i = 0; i < pool.length; i++) {
        const rec = pool[i];
        if (f.tab !== 'blocks') {
          if (f.el !== 'all' && rec.el !== f.el) continue;
          if (f.ty !== 'all' && rec.ty !== f.ty) continue;
        }
        if (q && String(rec.hay || '').toLowerCase().indexOf(q) < 0) continue;
        out.push(this.makeItem(f.tab === 'blocks' ? 'block' : 'card', rec.id, 1, { cd: 0, card: rec.card }));
      }
      vm.catalog = out;
      vm.catalogTotal = pool.length;
      if (box) {
        if (box.size !== out.length || !box.slots || box.slots.length !== out.length) {
          box.size = out.length; box.slots = new Array(out.length).fill(null);
        }
        for (let i = 0; i < out.length; i++) box.slots[i] = out[i];
      }
      vm.elementList = this.elementList();
      vm.typeList = this.typeList();
      return out;
    }

    cardIds() {
      const out = [];
      const CARDS = G.CARDS || [];
      for (let i = 0; i < CARDS.length; i++) {
        const c = CARDS[i];
        out.push({ id: c.id, el: c.element, ty: c.type, card: c, hay: (c.name + ' ' + (c.text || '') + ' ' + c.id + ' ' + (G.TYPE_CN ? G.TYPE_CN[c.type] : '') + ' ' + (G.ELEMENTS[c.element] ? G.ELEMENTS[c.element].cn : '')) });
      }
      return out;
    }
    blockIds() {
      const out = [], DEFS = G.BLOCK_DEFS || [];
      for (let i = 1; i < DEFS.length; i++) {
        const d = DEFS[i];
        if (!d || d.key === 'bedrock' || d.key === 'air') continue;
        out.push({ id: i, hay: (d.cn || '') + ' ' + (d.key || '') });
      }
      return out;
    }
    elementList() {
      const out = [];
      for (const k in (G.ELEMENTS || {})) out.push({ key: k, cn: G.ELEMENTS[k].cn });
      return out;
    }
    typeList() {
      const out = [];
      for (const k in (G.TYPE_CN || {})) out.push({ key: k, cn: G.TYPE_CN[k] });
      return out;
    }
  }
  /* 'm:ss'：剩余时间只有一个显示口径（结算面板与顶栏共用它），不放两个函数各算一份 */
  function fmtMMSS(sec) {
    const t = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function repeatHearts(n) {
    let s = '';
    for (let i = 0; i < Math.max(0, n | 0); i++) s += '\u2665';
    return s;
  }
  UI.ViewModel = ViewModel;
})(window.GW);
