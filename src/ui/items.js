/* ================= GW.UI.items（物品/堆叠模型·纯数据·零 DOM·零中文） =================
   Minecraft 的背包之所以直观，不是因为画得好看，而是因为它有一整套**堆叠代数**：
   拿起 / 放下 / 对半 / 一格一个 / 一键归拢 / 跨容器甩。这套代数在这里，而且是纯函数：
   给它一个 bag（容器表 + 光标上的那一摞）和一次操作，它返回一份"操作计划 + 要交给游戏的意图"，
   由 GW.UI.drag 投递、tools/ui_check.cjs 在 node 里逐条断言（不用开浏览器）。

   三种容器，规则不同（这条是关键，别让视图层自己改权威状态）：
     authoritative  手持栏 = p.hand 的镜像。任何改动只能变成意图交给游戏；本层绝不本地改写。
     local          随身格（UI 自己的收藏托盘）。本层随便改，持久化由面板负责。
     infinite       图鉴（创造取卡）。拿起=复制一份，放下到它里面被拒。
     readonly       牌库 / 弃牌堆镜像。只能看与查，任何放下被拒。

   词汇表（本层对外的唯一语言，中文由 js/hud.js 的文案表出）：
     意图：ui.give / ui.takeFromHand / ui.discardSlot / ui.reorderHand / ui.useSlot / ui.selectSlot
           / ui.spill / ui.dropOnWorld / ui.examine
     事件：拒绝原因 reason = read-only / no-room / slot-full / creative-only / no-handler / not-running
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});

  /* 只当"来源"的容器：图鉴（全卡）与随身格货架（创造模式的快捷取卡）。
     点它们 = 复制一张放进手持栏；往它们里面放东西一律拒绝（它们不持有玩家的牌）。 */
  const isSource = (box) => !!box && (box.kind === 'infinite' || box.kind === 'palette');

  /* ---------- 物品注册表：kind → 上限多少、怎么比、怎么画 ---------- */
  const KINDS = new Map();
  const Items = {
    register(kind, def) {
      KINDS.set(kind, Object.assign({ maxStack: 1 }, def || {}));
      return this;
    },
    def(kind) { return KINDS.get(kind) || null; },
    has(kind) { return KINDS.has(kind); },
    kinds() { return Array.from(KINDS.keys()); },
    /* 一个物品引用：{kind,id,count,meta}。meta 只放展示数据（元素/费用/冷却），不参与相等判定。 */
    make(kind, id, count, meta) { return { kind: kind, id: id, count: count == null ? 1 : count, meta: meta || null }; },
    clone(r) { return r ? Items.make(r.kind, r.id, r.count, r.meta) : null; },
    same(a, b) {
      if (!a || !b) return false;
      if (a.kind !== b.kind || String(a.id) !== String(b.id)) return false;
      const def = KINDS.get(a.kind);
      return def && def.same ? !!def.same(a, b) : true;
    },
    max(a) { const d = KINDS.get(a && a.kind); return (d && d.maxStack) || 1; }
  };
  UI.Items = Items;

  /* ---------- 容器 ---------- */
  class Container {
    constructor(opts) {
      Object.assign(this, {
        id: 'box', size: 9, cols: 9,
        kind: 'local',                    // authoritative | local | infinite | readonly
        side: 0,                          // 0=P1 1=P2（手持栏用）
        pairWith: [],                     // quickMove 能甩去哪些容器（按 group 名）
        group: null,
        labelKey: null,                   // 文案 key
        selected: -1,
        rows: 0                           // 渲染行数（0 = 由 cols 推）
      }, opts || {});
      this.slots = new Array(this.size).fill(null);
    }
    get(i) { return (i >= 0 && i < this.size) ? (this.slots[i] || null) : null; }
    set(i, ref) { if (i >= 0 && i < this.size) this.slots[i] = ref; }
    isEmpty() { return this.slots.every((s) => !s); }
    firstEmpty() { for (let i = 0; i < this.size; i++) if (!this.slots[i]) return i; return -1; }
    indexOfSame(ref) { for (let i = 0; i < this.size; i++) if (Items.same(this.slots[i], ref)) return i; return -1; }
    countOf(ref) { let n = 0; for (let i = 0; i < this.size; i++) if (Items.same(this.slots[i], ref)) n += this.slots[i].count; return n; }
    /* 权威容器不接受本地写：这是"UI 不碰权威"这条硬规则的机制化 */
    canLocalWrite() { return this.kind === 'local' || this.kind === 'infinite'; }
    canAccept() { return this.kind === 'local' || this.kind === 'authoritative'; }
    snapshot() { return this.slots.slice(); }
  }
  UI.Container = Container;

  /* ---------- 堆叠袋 ---------- */
  class Bag {
    constructor() {
      this.containers = new Map();
      this.cursor = null;         // 光标上那一摞
      this.button = 0;            // 按住左键拖拽中
      this.intents = [];
      this.events = [];
      this.version = 0;
      this.plan = null;           // 未提交的操作计划（等通道回执）
    }
    add(c) { this.containers.set(c.id, c); return c; }
    get(id) { return this.containers.get(id) || null; }
    list() { return Array.from(this.containers.values()); }
    partners(id) {
      const c = this.get(id); if (!c || !c.pairWith.length) return [];
      /* readonly 与 palette 都不是"放下"的目的地：只读镜像改不了，货架只复制不持有。 */
      return c.pairWith.map((p) => this.get(p)).filter(Boolean).filter((t) => t.kind !== 'readonly' && t.kind !== 'palette');
    }
    bump() { this.version++; }
    reset() { this.intents.length = 0; this.events.length = 0; }
    wantSfx(k) { this.events.push({ sfx: k }); }
    wantSay(k, payload) { this.events.push({ notify: k, payload: payload || null }); }
    want(type, payload) { this.intents.push({ type: type, payload: payload || null }); }
  }
  UI.Bag = Bag;

  /* ================= 操作代数 =================
     返回 {ok, via, plan?}。plan 由通道回执后交给 Ops.resolve 决定要不要落地。 */
  const Ops = {
    /* 一次点击：mode = left | right | shift-left | shift-right */
    click(bag, boxId, idx, mode) {
      const box = bag.get(boxId); if (!box) return deny(bag, 'no-box');
      const slot = box.get(idx);
      const cur = bag.cursor;
      const shift = mode.indexOf('shift') === 0;
      const right = mode === 'right' || mode === 'shift-right';
      const evAlt = mode.indexOf('alt') >= 0;
      if (mode === 'unknown') return deny(bag, 'unknown-mode');
      /* HUD 手持栏（editable:false）只接受"选中"，不允许拿取/放下：那是 MC 自己的口径 */
      if (box.editable === false && box.kind === 'authoritative') {
        if (!cur) { Ops.select(bag, boxId, idx); return { ok: true, via: 'select-only' }; }
        bag.wantSfx('deny'); return deny(bag, 'select-only');
      }

      /* Shift+点 = 甩到配对容器 */
      if (shift) {
        if (!slot) return deny(bag, 'empty');
        const targets = bag.partners(boxId).filter((t) => t.canAccept());
        if (!targets.length) return deny(bag, 'no-partner');
        const plan = { type: 'quick', from: boxId, fromIdx: idx, items: Items.clone(slot), targets: targets.map((t) => t.id) };
        /* 目的地是权威格（手持栏）→ 只能发意图；目的地是本地格 → 自己搬 */
        if (targets[0].kind !== 'local') {
          bag.want('ui.give', { item: Items.clone(slot), box: targets[0].id, slotPolicy: 'auto', side: targets[0].side, mode: 'auto' });
          bag.wantSfx('ui');
          return { ok: true, via: 'quick-intent', plan: plan };
        }
        if (box.kind === 'local') { const r = Ops.quickMoveLocal(bag, box, targets, idx); return r; }
        if (box.kind === 'infinite') { bag.want('ui.give', { item: Items.clone(slot), box: targets[0].id, slot: -1, mode: 'auto' }); bag.wantSfx('ui'); return { ok: true, via: 'quick-infinite', plan: plan }; }
        box.want && 0;
        bag.want('ui.give', { item: Items.clone(slot), box: targets[0].id, slot: -1, mode: 'auto' });
        bag.wantSfx('ui');
        return { ok: true, via: 'quick-intent', plan: plan };
      }

      /* 图鉴（无限源，创造取卡用的那一屏）。四种手势，各有各的快：
           点一下        → 直接放进配对容器（手持栏）的选中格：最常见的"我要这张"
           拖起来 / Alt  → 复制一整摞到光标上，再按 MC 那套慢慢摆
           右键          → 复制一个到光标
           双击          → 放进格子并立刻打出（mode:'cast'） */
      if (isSource(box)) {
        bag.cursorFromBox = box;
        if (!slot) return deny(bag, 'empty');
        if (cur) { bag.wantSfx('deny'); return deny(bag, 'read-only'); }      // 图鉴不收东西
        const dst = bag.partners(boxId)[0];
        if (mode === 'cast') {
          /* slotPolicy:'selected' = "玩家手上正选的那一格"，由装配层现问现答；
             快照 dst.selected 会慢一拍（点卡的瞬间 sel 刚被键盘/滚轮改过） */
          bag.want('ui.give', { item: Items.clone(slot), box: dst ? dst.id : null, slotPolicy: 'selected', side: dst ? dst.side : 0, mode: 'cast' });
          bag.wantSfx('card'); box.selected = idx; bag.bump();
          return { ok: true, via: 'cast-from-catalog' };
        }
        if (mode === 'left' && !evAlt) {
          bag.want('ui.give', { item: Items.clone(slot), box: dst ? dst.id : null, slotPolicy: 'selected', side: dst ? dst.side : 0, mode: 'set' });
          box.selected = idx; bag.bump(); bag.wantSfx('ui');
          return { ok: true, via: 'give-to-slot' };
        }
        bag.cursor = Items.make(slot.kind, slot.id, right ? 1 : Items.max(slot), slot.meta);
        box.selected = idx; bag.bump(); bag.wantSfx('ui');
        if (bag.app) bag.app.model.detailKey = slot.kind + '/' + slot.id;
        return { ok: true, via: 'take-infinite' };
      }

      /* 只读镜像：只许看。Shift 甩入 / 放下 → 拒。
         例外（2026-10-18 用户："背包里的卡牌往物品栏上面切换"）：从牌库**拖起来**的那一张会借到光标上，
         但它还在牌库里——只有落到手持栏那一格时，才由权威层 dealFromDeck 真的换过去
         （换下来的那张原位回牌库，三堆守恒）。单击仍然是"看一眼"，只有越过拖拽阈值的 pickup 才借。 */
      if (box.kind === 'readonly') {
        if (cur) { bag.wantSfx('deny'); bag.wantSay('deny', { reason: 'read-only', box: boxId }); return deny(bag, 'read-only'); }
        if (mode === 'pickup' && box.id === 'deck') {
          if (!slot) return deny(bag, 'empty');
          bag.cursor = Items.make(slot.kind, slot.id, 1, slot.meta);
          bag.cursor.virtual = true;                 // 借来的：不在光标上"落地"，关面板/丢到别处只收掉
          bag.cursorFromBox = box;
          box.selected = idx; bag.bump(); bag.wantSfx('ui');
          return { ok: true, via: 'borrow-deck' };
        }
        bag.want('ui.examine', { box: boxId, idx: idx, item: slot });
        return { ok: true, via: 'examine' };
      }

      /* ---------- 权威容器（手持栏）：一律走意图 ---------- */
      if (box.kind === 'authoritative') {
        if (cur) {
          /* 牌库借来的那张：落到手持栏 = 从牌库换一张（被顶下来的那张原位回牌库，不是换到光标上）。 */
          if (cur.virtual) {
            if (idx < 0) bag.want('ui.dealFromDeck', { id: cur.id, box: boxId, slotPolicy: 'selected', side: box.side });
            else bag.want('ui.dealFromDeck', { id: cur.id, box: boxId, slot: idx, side: box.side });
            bag.wantSfx('ui');
            return { ok: true, via: 'deal-from-deck', plan: { type: 'deal-deck' } };
          }
          /* 同一条手持栏内部（背包这一排 ↔ 底部 HUD 手持栏）：卡已经拿在手上、数组短了一格，
             落点的语义是**插入到第 idx 格**，走 ui.moveHand。
             旧写法在这里发 placeHand：目标格那张被换进光标，可鼠标已经松开，
             玩家看到的是"顺序不对/牌跑到鼠标上了"——这就是"背包里换不了顺序"的那条路。 */
          const fromBox = bag.cursorFromBox;
          const sameHand = !!(fromBox && fromBox.group === 'hand' && box.group === 'hand' && (fromBox.side | 0) === (box.side | 0));
          if (sameHand) {
            const bareId = { kind: cur.kind, id: cur.id, count: cur.count };
            if (idx < 0) bag.want('ui.moveHand', { item: bareId, box: boxId, slotPolicy: 'selected', side: box.side });
            else bag.want('ui.moveHand', { item: bareId, box: boxId, slot: idx, side: box.side });
            bag.wantSfx('ui');
            return { ok: true, via: 'move-hand', plan: { type: 'move-hand' } };
          }
          /* 放下 / 换牌：让游戏写这一格，成功后光标清空 */
          const p = { type: 'place-authoritative', box: boxId, idx: idx, side: box.side, cursor: Items.clone(cur), whole: !right };
          /* 拖到某一格上 = 明确要这一格，用显式 idx；算不出格位时退回"选中格"，不许发负一格 */
          var placeMode = (bag.cursorFromBox && bag.cursorFromBox.kind === 'authoritative') ? 'swap' : 'replace';
          const bare = { kind: cur.kind, id: cur.id, count: cur.count };   // 意图只带身份，不把卡面 meta 塞进通道
          if (idx < 0) bag.want('ui.placeHand', { item: bare, box: boxId, slotPolicy: 'selected', side: box.side, mode: placeMode });
          else bag.want('ui.placeHand', { item: bare, box: boxId, slot: idx, side: box.side, mode: placeMode });
          bag.wantSfx('ui');
          return { ok: true, via: 'place-authoritative', plan: p };
        }
        if (!slot) return deny(bag, 'empty');
        bag.cursorFromBox = box;
        if (right) {                                  // 右键从权威格拿一半：先让游戏扣掉，再交给光标
          const p = { type: 'take-authoritative', box: boxId, idx: idx, half: true, item: Items.clone(slot) };
          bag.want('ui.takeFromHand', { box: boxId, slot: idx, side: box.side, count: Math.ceil(slot.count / 2) });
          bag.wantSfx('ui');
          return { ok: true, via: 'take-authoritative', plan: p };
        }
        const p = { type: 'take-authoritative', box: boxId, idx: idx, half: false, item: Items.clone(slot) };
        bag.cursorFromBox = box;
        bag.want('ui.takeFromHand', { box: boxId, slot: idx, side: box.side, count: slot.count });
        bag.wantSfx('ui');
        return { ok: true, via: 'take-authoritative', plan: p };
      }

      /* ---------- 本地容器（随身格）：直接改，但要过堆叠规则 ---------- */
      if (right) {
        if (!cur) {
          if (!slot) return deny(bag, 'empty');
          const half = Math.ceil(slot.count / 2);
          bag.cursor = Items.make(slot.kind, slot.id, half, slot.meta);
          slot.count -= half; if (slot.count <= 0) box.set(idx, null);
          box.selected = idx; bag.bump(); bag.wantSfx('ui');
          return { ok: true, via: 'half' };
        }
        const r = placeOne(bag, box, idx, cur);
        box.selected = idx; bag.bump();
        if (cur.count <= 0) bag.cursor = null;
        return { ok: r.ok, via: r.ok ? 'place-one' : 'deny', reason: r.reason };
      }
      if (!cur) {
        if (!slot) return deny(bag, 'empty');
        bag.cursor = slot; box.set(idx, null);
        box.selected = idx; bag.bump(); bag.wantSfx('ui');
        return { ok: true, via: 'pick' };
      }
      const r = placeStack(bag, box, idx, cur);
      box.selected = idx; bag.bump();
      if (cur.count <= 0) bag.cursor = null;
      return { ok: r.ok, via: r.ok ? 'place' : 'deny', reason: r.reason };
    },

    /* 按住左键拖过一格：每格分一个（原版 splitter drag） */
    dragOver(bag, boxId, idx) {
      const box = bag.get(boxId), cur = bag.cursor;
      if (!box || !cur) return deny(bag, 'no-drag');
      if (!bag.button) return deny(bag, 'no-button');
      /* 拖着东西划过只读容器（牌库/弃牌堆/货架）只是路过：不报错、也不改任何东西。
         以前这里每次经过都弹一句"看可以改不行"，玩家以为拖出错了（落点由松手决定）。 */
      if (box.kind === 'readonly' || isSource(box)) return { ok: false, via: 'skip' };
      const slot = box.get(idx);
      const max = Items.max(cur);
      if (slot && !Items.same(slot, cur)) return deny(bag, 'mismatch');
      if (slot && slot.count >= max) return deny(bag, 'slot-full');
      if (box.kind === 'authoritative') {
        /* 拖拽经过权威格不立即落地：等松手由 click 的 place-authoritative 统一处理。
           旧写法每划过一格就发一次 ui.give 并本地扣光标 —— 生存模式 give 被拒，光标却被扣空，
           牌从手里消失且放不回去（用户报的"一拿就放不上"就是这么来的）。 */
        box.selected = idx; bag.bump();
        return { ok: true, via: 'defer-drop' };
      }
      if (slot) slot.count += 1; else box.set(idx, Items.make(cur.kind, cur.id, 1, cur.meta));
      cur.count -= 1; if (cur.count <= 0) bag.cursor = null;
      box.selected = idx; bag.bump(); bag.wantSfx('ui');
      return { ok: true, via: 'split' };
    },

    /* 双击：把本容器同类归拢到光标 */
    collect(bag, boxId, idx) {
      const box = bag.get(boxId); if (!box) return deny(bag, 'no-box');
      const seed = box.get(idx); if (!seed) return deny(bag, 'empty');
      if (box.kind === 'authoritative') {
        const p = { type: 'collect-authoritative', box: boxId, idx: idx, item: Items.clone(seed), got: 0 };
        for (let i = 0; i < box.size; i++) {
          const s = box.get(i);
          if (!Items.same(s, seed)) continue;
          p.got += s.count;
          bag.want('ui.takeFromHand', { box: boxId, slot: i, side: box.side, count: s.count });
        }
        bag.bump(); bag.wantSfx('ui');
        return { ok: p.got > 0, via: 'collect-intent', plan: p };
      }
      const cur = bag.cursor;
      const base = (cur && Items.same(cur, seed)) ? cur : Items.make(seed.kind, seed.id, 0, seed.meta);
      const max = Items.max(base);
      for (let i = 0; i < box.size && base.count < max; i++) {
        const s = box.get(i);
        if (!Items.same(s, base)) continue;
        const take = Math.min(s.count, max - base.count);
        s.count -= take; base.count += take;
        if (s.count <= 0) box.set(i, null);
      }
      bag.cursor = base.count ? base : null;
      if (base.count) bag.wantSfx('ui');
      bag.bump();
      return { ok: base.count > 0, via: 'collect' };
    },

    /* 本地 quickMove（随身格 ↔ 随身格） */
    quickMoveLocal(bag, from, targets, idx) {
      const ref = from.get(idx); if (!ref) return deny(bag, 'empty');
      const max = Items.max(ref);
      let left = ref.count;
      for (const to of targets) {
        if (!to.canAccept() || !to.canLocalWrite()) continue;
        for (let i = 0; i < to.size && left > 0; i++) {
          const s = to.get(i);
          if (!Items.same(s, ref)) continue;
          const room = max - s.count; if (room <= 0) continue;
          const take = Math.min(room, left); s.count += take; left -= take;
        }
        for (let i = 0; i < to.size && left > 0; i++) {
          if (to.get(i)) continue;
          const take = Math.min(max, left);
          to.set(i, Items.make(ref.kind, ref.id, take, ref.meta)); left -= take;
        }
      }
      if (left === ref.count) return deny(bag, 'no-room');
      if (left > 0) ref.count = left; else from.set(idx, null);
      bag.bump(); bag.wantSfx('ui');
      return { ok: true, via: 'quick-local', moved: ref.count === 0 ? left : (ref.count - left) };
    },

    /* 光标丢到窗外 / 关面板无处安放：把"从哪一格拿的"一起交出去，
       装配层才知道该放回哪一格（旧版只给 item，生存模式只能回一句"没人接"）。 */
    spill(bag, from) {
      const cur = bag.cursor; if (!cur) return deny(bag, 'empty');
      const src = from || null;
      bag.want('ui.spill', {
        item: Items.clone(cur),
        slot: (src && typeof src.slot === 'number' && src.slot >= 0) ? src.slot : null,
        side: (src && src.side) | 0, box: (src && src.box) || null
      });
      bag.wantSfx('ui');
      return { ok: true, via: 'spill', plan: { type: 'spill', item: Items.clone(cur) } };
    },
    /* 光标丢到世界（3D 画面）上。
       卡：带上"从哪一格拿的"，装配层据此走正式出牌通道（它判 p.slot != null 才认卡，
       以前这里不发 slot，卡也一律掉进"没人接"分支 —— 拖到画面上出牌这条今天才真的通）。
       方块：仍是留给机制层的通道，没人接就诚实报 no-handler（AGENTS 那条）。 */
    dropOnWorld(bag, screen, from) {
      const cur = bag.cursor; if (!cur) return deny(bag, 'empty');
      const src = from || null;
      const slot = (src && typeof src.slot === 'number' && src.slot >= 0) ? src.slot : null;
      bag.want('ui.dropOnWorld', {
        item: Items.clone(cur), screen: screen || null,
        slot: slot, side: (src && src.side) | 0, box: (src && src.box) || null
      });
      bag.wantSfx('ui');
      return { ok: true, via: 'drop-world', plan: { type: 'drop-world', item: Items.clone(cur) } };
    },
    /* Esc / 关面板：光标那一摞找个地方放下（塞不进就丢掉，跟原版一致） */
    returnCursor(bag, prefer) {
      const cur = bag.cursor; if (!cur) return { ok: false, reason: 'empty' };
      /* 从牌库借来的那张：它从来没离开牌库，收光标就是全部动作（再 placeHand 一次会变出第二张）。 */
      if (cur.virtual) { bag.cursor = null; bag.bump(); return { ok: true, via: 'forget' }; }
      const ids = [].concat(prefer || [], ['hotbar', 'tray']);
      for (const id of ids) {
        const box = bag.get(id);
        if (!box) continue;
        if (box.kind === 'authoritative') {
          if (!cur || cur.kind !== 'card') continue;
          const free = box.firstEmpty();
          if (free < 0) continue;
          bag.want('ui.placeHand', { item: { kind: cur.kind, id: cur.id, count: cur.count }, box: id, slot: free, side: box.side });
          bag.cursor = null; bag.bump(); return { ok: true, via: 'return-hand' };
        }
        /* 收尾巴只往真正的本地容器里收：palette / infinite 是"来源"，
           把玩家手上的牌写进它们等于就地蒸发（下一帧视图模型就把它们覆盖回原样）。 */
        if (box.kind !== 'local' || !box.canAccept() || !box.canLocalWrite()) continue;
        const max = Items.max(cur);
        const same = box.indexOfSame(cur);
        if (same >= 0 && box.get(same).count < max) { box.get(same).count += cur.count; bag.cursor = null; bag.bump(); return { ok: true, via: 'merge' }; }
        const free = box.firstEmpty();
        if (free >= 0) { box.set(free, cur); bag.cursor = null; bag.bump(); return { ok: true, via: 'store' }; }
      }
      bag.cursor = null; bag.bump();
      return { ok: true, via: 'void' };
    },

    /* 选中一格（点击 / 滚轮 / 数字键都汇到这里，再走通道） */
    select(bag, boxId, idx) {
      const box = bag.get(boxId); if (!box) return deny(bag, 'no-box');
      box.selected = idx; bag.bump();
      bag.want('ui.selectSlot', { box: boxId, slot: idx, side: box.side });
      return { ok: true, via: 'select' };
    },
    use(bag, boxId, idx, opts) {
      const box = bag.get(boxId); if (!box) return deny(bag, 'no-box');
      bag.want(opts && opts.at ? 'ui.castAt' : 'ui.useSlot', { box: boxId, slot: idx, side: box.side, screen: (opts && opts.screen) || null });
      bag.bump();
      return { ok: true, via: 'use' };
    },

    /* 通道回执：只有游戏说 ok 才真的改动 UI 侧（光标清空 / 本地源扣掉） */
    resolve(bag, plan, results) {
      const ok = !results || !results.length ? true : results.every((r) => r && (r.result ? r.result.ok : true));
      if (!plan) return { ok: ok };
      if (!ok) {
        bag.wantSfx('deny');
        const bad = results.filter((r) => r.result && !r.result.ok)[0];
        bag.wantSay('deny', { reason: (bad && bad.result && bad.result.reason) || 'denied', plan: plan.type });
        return { ok: false, reason: (bad && bad.result && bad.result.reason) || 'denied' };
      }
      switch (plan.type) {
        case 'place-authoritative': {
          /* 交换：游戏回 displaced（被换下的那张），UI 把它放回光标；否则清空/扣一 */
          const res = results && results[0] && results[0].result;
          if (res && res.displaced) { bag.cursor = Items.make('card', res.displaced, 1, null); break; }
          if (plan.whole) bag.cursor = null;
          else { plan.cursor.count -= 1; bag.cursor = plan.cursor.count > 0 ? plan.cursor : null; }
          break;
        }
        case 'take-authoritative':
          bag.cursor = plan.half
            ? Items.make(plan.item.kind, plan.item.id, Math.ceil(plan.item.count / 2), plan.item.meta)
            : plan.item;
          break;
        case 'collect-authoritative':
          bag.cursor = Items.make(plan.item.kind, plan.item.id, plan.got, plan.item.meta);
          break;
        /* 换位与牌库换牌都不留光标：牌已经在权威层落位了（换下来的那张也回牌库了）。 */
        case 'move-hand': case 'deal-deck':
          bag.cursor = null;
          break;
        case 'spill': case 'drop-world':
          bag.cursor = null;
          break;
      }
      bag.bump();
      return { ok: true };
    }
  };
  UI.Ops = Ops;

  function deny(bag, reason) {
    if (bag) { bag.wantSfx('deny'); bag.wantSay('deny', { reason: reason }); }
    return { ok: false, reason: reason };
  }

  /* 本地容器的放下规则（与原版一致：先叠同类，再换整摞） */
  function placeStack(bag, box, idx, cur) {
    const max = Items.max(cur), slot = box.get(idx);
    if (!slot) { box.set(idx, Items.make(cur.kind, cur.id, cur.count, cur.meta)); cur.count = 0; return { ok: true }; }
    if (Items.same(slot, cur)) {
      const room = max - slot.count;
      if (room <= 0) return { ok: false, reason: 'slot-full' };
      const take = Math.min(room, cur.count);
      slot.count += take; cur.count -= take;
      return { ok: true };
    }
    box.set(idx, Items.make(cur.kind, cur.id, cur.count, cur.meta));
    cur.kind = slot.kind; cur.id = slot.id; cur.count = slot.count; cur.meta = slot.meta;   // 交换
    return { ok: true, swap: true };
  }
  function placeOne(bag, box, idx, cur) {
    const max = Items.max(cur), slot = box.get(idx);
    if (!slot) { box.set(idx, Items.make(cur.kind, cur.id, 1, cur.meta)); cur.count -= 1; return { ok: true }; }
    if (!Items.same(slot, cur)) return { ok: false, reason: 'slot-full' };
    if (slot.count >= max) return { ok: false, reason: 'slot-full' };
    slot.count += 1; cur.count -= 1;
    return { ok: true };
  }

  /* 供装配层 / 回归脚本消费 */
  UI.drainIntents = function (bag) { const out = bag.intents.slice(); bag.intents.length = 0; return out; };
})(window.GW);
