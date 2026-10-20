/* ================= GW.UI.drag（拖拽控制器：光标栈 / 分堆拖 / 悬停提示 / 丢进世界） =================
   它把"手里拿着一摞东西"这件事做完整：
     · 注册过的格子（带 data-box / data-slot 的元素）用**事件委托**统一接管，不给每格挂监听；
     · 按住左键拖过格子 = 每格分一个；右键 = 对半 / 放一个；Shift+点 = 甩到配对容器；双击 = 归拢；
     · 光标上的那一摞画在 drag 层（永远最顶），并且**只在鼠标自由时**工作（锁指针时整套机制让位给瞄准）；
     · 松手时如果落点不在任何注册容器里 = 丢到世界：交出 ui.dropOnWorld 意图，由游戏解释
       （出牌 / 放置方块 / 未来捡起来的东西回流）。这就是"UI 内 ↔ 游戏内"的那条通道。

   它不判断合法性：所有权威改动都变成意图经 GW.UI.channel 问游戏，游戏说不行就原样退回（光标不清空）。
   本层禁则：零玩家可见中文（提示只报 key）、零 innerHTML。
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});

  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const HIT = '[data-box]';                       // 可交互格子：data-box="hotbar" data-slot="3"
  const THRESHOLD = 4;                             // 按下后移动超过这么多像素才算"拖起来"
  const HOVER_MS = 260;                            // 悬停多久出提示

  class DragController {
    constructor(app, bag, channel) {
      this.app = app; this.bag = bag; this.ch = channel;
      this.active = false;                 // 有一次按下的拖拽在进行
      this.button = 0;
      this.startPt = null;
      this.lastBox = null; this.lastSlot = -1;
      this.hoverBox = null; this.hoverSlot = -1; this.hoverT = 0; this.hoverPt = { x: 0, y: 0 };
      this.cursorFrom = null;              // 光标那一摞的来源格（拖到画面上出牌要用）
      this.tipEl = null; this.tipKey = '';
      this.ghostEl = null; this.ghostCanvas = null; this.ghostCount = null; this.ghostKey = '';
      this.enabled = true;
      this.hint = null;                    // 装配层可换成 H.TEXT 的提示函数（只报 key）
      this.install();
    }

    /* ---- 生命周期 ---- */
    install() {
      /* 用捕获阶段：面板内部自己也要能收到（我们只做格子语义，不吞普通按钮） */
      document.addEventListener('pointerdown', (e) => this.onDown(e), true);
      document.addEventListener('pointermove', (e) => this.onMove(e), true);
      document.addEventListener('pointerup', (e) => this.onUp(e), true);
      document.addEventListener('pointercancel', () => this.cancel());
      document.addEventListener('dblclick', (e) => this.onDbl(e), true);
      document.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
      window.addEventListener('blur', () => this.cancel());
    }
    setEnabled(on) { this.enabled = !!on; if (!on) this.cancel(); }

    /* ---- 命中：从事件目标往上找格子 ---- */
    hit(ev, selector) {
      const t = ev.target;
      if (!t || !t.closest) return null;
      return t.closest(selector || HIT);
    }
    slotOf(el, ev) {
      const box = this.bag.get(el.getAttribute('data-box'));
      if (!box) return null;
      let idx = parseInt(el.getAttribute('data-slot'), 10);
      /* 命中的是容器本身（格与格之间的缝、列表内边距）时，按指针位置算最近的一格。
         以前这里给 -1，意图带着 slot:-1 到装配层被夹成 0 —— 玩家拖到第 4 格、改的是第 1 格，
         看上去就是"拖了没反应"（2026-10-17 用户报）。 */
      if (isNaN(idx)) idx = ev ? this.nearestSlot(el, ev) : -1;
      /* 同一个容器在 HUD 与背包里可以是两种身份：谁可编辑由 DOM 上的 data-editable 说 */
      const ed = el.closest('[data-editable]');
      if (ed) box.editable = ed.getAttribute('data-editable') !== '0';
      return { box: box, idx: isNaN(idx) ? -1 : idx };
    }
    nearestSlot(el, ev) {
      const kids = el.querySelectorAll('[data-slot]');
      if (!kids.length) return -1;
      let best = -1, bd = Infinity;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const d = Math.abs(r.left + r.width / 2 - ev.clientX) + Math.abs(r.top + r.height / 2 - ev.clientY);
        if (d < bd) { bd = d; best = parseInt(kids[i].getAttribute('data-slot'), 10); }
      }
      return isNaN(best) ? -1 : best;
    }

    /* ---- 输入事件 ---- */
    onDown(ev) {
      if (!this.enabled) return;
      if (G.pointerLocked) return;                       // 锁指针时不做物品操作
      if (ev.button !== 0 && ev.button !== 2) return;
      const el = this.hit(ev);
      this.downPt = { x: ev.clientX, y: ev.clientY };
      this.downEl = el; this.downButton = ev.button;
      if (!el) { this.downBox = null; return; }
      const s = this.slotOf(el, ev); if (!s) return;
      if (s.box.editable === false && s.box.kind === 'authoritative') {   // HUD 手持栏：只选中，不拿取（MC 口径）
        if (s.idx >= 0) UI.Ops.select(this.bag, s.box.id, s.idx);
        this.downEl = null;
        this.ch && this.ch.flush(this.bag);
        this.app.invalidate('hotbar');
        return;
      }
      this.lastBox = s.box.id; this.lastSlot = s.idx;
      /* 左键点在没有东西的格子上：只是选中；有东西：按下即准备拖 */
      if (ev.button === 0 && s.box.get(s.idx)) { this.pendingPickup = true; }
      /* 点一下选中：只有手持栏那种"格位=号位"的容器才有意义。
         图鉴 / 随身格被点不该把玩家的手牌格顺带改掉（踩过：点卡顺手把选中格挪到 18）。 */
      if (s.box.kind === 'authoritative' && s.idx >= 0 && s.idx !== s.box.selected) {
        UI.Ops.select(this.bag, s.box.id, s.idx);
      }
      if (ev.button === 2) {                              // 右键立即结算（不做拖拽）
        this.run(UI.Ops.click(this.bag, s.box.id, s.idx, ev.shiftKey ? 'shift-right' : 'right'), ev);
        ev.preventDefault();
      }
    }

    onMove(ev) {
      if (!this.enabled) return;
      this.hoverPt.x = ev.clientX; this.hoverPt.y = ev.clientY;
      if (this.ghostEl) this.moveGhost(ev.clientX, ev.clientY);
      const p = this.downPt, hasButton = this.button || p;
      if (p && !this.active) {
        const moved = Math.max(Math.abs(ev.clientX - p.x), Math.abs(ev.clientY - p.y));
        if (moved >= THRESHOLD && this.downEl && this.downButton === 0) {
          /* 越过了拖拽阈值：把这一格的东西**拿起来**（图鉴是复制），进入分堆拖模式 */
          const s = this.slotOf(this.downEl, ev);
          if (s && s.box.get(s.idx) && !this.bag.cursor) {
            /* 无限源（图鉴 / 随身格货架）拖起来 = 复制一份到光标；其余容器 = 从那格拿走 */
            /* 牌库（readonly）也走 pickup：借一张到光标上，落到手持栏才真的换过去（items.js 的 borrow-deck）。 */
            const r = (s.box.kind === 'infinite' || s.box.kind === 'palette' || (s.box.kind === 'readonly' && s.box.id === 'deck'))
              ? UI.Ops.click(this.bag, s.box.id, s.idx, 'pickup')
              : UI.Ops.click(this.bag, s.box.id, s.idx, 'left');
            this.run(r, ev, true);
            /* 记住这一摞是从哪格拿的：拖到画面上 = "打出那一格的那张牌"（装配层要 slot 才接得住） */
            this.cursorFrom = { box: s.box.id, slot: s.idx, side: (s.box.side | 0) };
          }
          this.active = true; this.button = 1;
          this.bag.button = 1;
          this.downPt = null; this.downEl = null;
          this.ch && this.ch.bus.emit('ui:drag-start', { box: s && s.box.id });
          this.app.invalidate('cursor');
        }
      }
      if (this.active && this.button) {
        const el = this.hit(ev);
        if (el) {
          const s = this.slotOf(el, ev);
          if (s && (s.box.id !== this.lastBox || s.idx !== this.lastSlot)) {
            this.lastBox = s.box.id; this.lastSlot = s.idx;
            this.run(UI.Ops.dragOver(this.bag, s.box.id, s.idx), ev, true);
          }
        }
      }
      this.movedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      /* 悬停提示：只有自由鼠标、没在拖、停在某一格上够久才出 */
      const el = this.hit(ev);
      const s = el ? this.slotOf(el, ev) : null;
      const key = s ? (s.box.id + ':' + s.idx + ':' + (s.box.get(s.idx) ? s.box.get(s.idx).kind + '/' + s.box.get(s.idx).id : '-')) : '';
      if (key !== this.tipKey) {
        this.tipKey = key; this.hoverT = 0;
        this.hoverBox = s ? s.box.id : null; this.hoverSlot = s ? s.idx : -1;
        /* 换到另一格：提示先收起，等停够 260ms 再出（旧写法留着上一张卡的文本，
           光标底下挂着别的卡的说明，看着就像提示说错了东西）。详情栏主体不同：它不换主体。 */
        this.showTip(null);
        /* 详情栏的主体只**换成新看到的这一格**，离开格子只收提示不清主体：
           玩家从卡上把手移到右边的「放进手持栏」时，按钮不该先失去对象（2026-10-17 用户报"四个按钮全没用"）。
           主体唯一的清空处是关面板 clearHover()。 */
        const it = s ? s.box.get(s.idx) : null;
        if (it) {
          const dk = it.kind + '/' + it.id;
          /* 除了"是哪张卡"，还要记住"它此刻在哪个容器里"：同一张牌可以出现在牌库与手持栏两边，
             只按 id 找主体的话，卡页会指着一张不是玩家正在看的那张（详情栏的位置行与按钮门禁都要它）。 */
          this.app.model.detailBox = s.box.id;
          this.app.model.detailSlot = s.idx;
          if (this.app.model.detailKey !== dk) { this.app.model.detailKey = dk; this.app.invalidate('inv'); }
        }
      }
      /* 计时只在 frame 里按真实 dt 累加（以前这里还 +=1 充数，等于给"停着不动"掺假） */
    }

    onUp(ev) {
      const wasActive = this.active;
      this.active = false; this.button = 0; this.bag.button = 0;
      this.downPt = null;
      const el = this.downEl;
      const downWasClick = !!el && !wasActive;
      this.downEl = null;
      if (ev.button === 2) return;
      if (downWasClick) {
        /* 没拖起来 = 一次普通点击 */
        const s = this.slotOf(el, ev);
        if (s) {
          const it = s.box.get(s.idx);
          if (it) {
            const dk = it.kind + '/' + it.id;
            if (this.app.model.detailKey !== dk) { this.app.model.detailKey = dk; this.app.invalidate('inv'); }
          }
          const mode = ev.shiftKey ? 'shift-left' : 'left';
          this.run(UI.Ops.click(this.bag, s.box.id, s.idx, mode), ev, true);
        }
        return;
      }
      if (wasActive) {
        /* 拖起来后松手：
             落在某个格子上   = 分堆已处理 / 落到那一格（lastBox 可能已经离开指针，按指针下的格子算）；
             落在面板空白处   = 什么都不做（牌还在光标上，可以换个地方放）；
             落在面板外       = 交给世界（生存模式 = 朝那个方向打出，见 main.js 的 ui.dropOnWorld）。
           例外：从牌库借来的那张只认手持栏——落到别处就收掉光标（它一直在牌库里，什么都没发生），
           不许走"拖到画面 = 打出"那条路（那会打出一张牌库里还压着的牌）。 */
        const overSlot = this.hit(ev, '[data-box]');
        if (this.bag.cursor && this.bag.cursor.virtual) {
          const st0 = overSlot ? this.slotOf(overSlot, ev) : null;
          if (!(st0 && st0.box.kind === 'authoritative')) {
            this.bag.cursor = null; this.bag.cursorFromBox = null;
            this.bag.wantSay('deny', { reason: 'read-only', box: 'deck' });
            if (this.ch) this.ch.flush(this.bag);
            this.app.invalidate('cursor'); this.app.invalidate('inv'); this.app.invalidate('hotbar');
            this.ch && this.ch.bus.emit('ui:drag-end', {});
            return;
          }
        }
        const inside = overSlot || this.hit(ev, '[data-drop="keep"]');
        if (!inside) {
          const overWorld = !this.hit(ev, '.ui-bag-box,.ui-menu-box,.ui-level-box,.ui-panel,.ui-result-box');
          if (overWorld) this.run(UI.Ops.dropOnWorld(this.bag, { x: ev.clientX, y: ev.clientY }, this.cursorFrom), ev, true);
          else this.run(UI.Ops.spill(this.bag, this.cursorFrom), ev, true);
        } else if (overSlot && this.bag.cursor) {
          const st = this.slotOf(overSlot, ev);
          if (st) this.run(UI.Ops.click(this.bag, st.box.id, st.idx, 'left'), ev, true);
        }
        this.ch && this.ch.bus.emit('ui:drag-end', {});
      }
      this.pendingPickup = false;
    }

    /* 双击：HUD 手持栏 = 用这一格（出牌）；图鉴 = 放进格子并立刻打出；本地格 = 归拢 */
    onDbl(ev) {
      if (!this.enabled || G.pointerLocked) return;
      const el = this.hit(ev); if (!el) return;
      const s = this.slotOf(el, ev); if (!s) return;
      ev.preventDefault();
      if (s.box.kind === 'infinite' || s.box.kind === 'palette') this.run(UI.Ops.click(this.bag, s.box.id, s.idx, 'cast'), ev, true);
      else if (s.box.kind === 'authoritative' && s.box.editable === false) this.run(UI.Ops.use(this.bag, s.box.id, s.idx), ev, true);
      else if (s.box.editable !== false) this.run(UI.Ops.collect(this.bag, s.box.id, s.idx), ev, true);
      this.downEl = null; this.active = false;
    }

    /* 面板打开时的滚轮 = 换手持栏选中格（面板没开时这条让位给主循环，两边不会打架） */
    onWheel(ev) {
      if (!this.enabled || G.pointerLocked) return;
      if (ev.shiftKey) return;              // Shift+滚轮 = 换类别，归装配层（两边抢同一次滚动会一半失效）
      if (!this.app.isPanelOpen()) return;
      const el = this.hit(ev); if (!el) return;
      const s = this.slotOf(el, ev); if (!s || s.box.kind !== 'authoritative') return;
      const n = Math.max(1, s.box.size);
      const dir = ev.deltaY > 0 ? 1 : -1;
      const cur = s.box.selected < 0 ? 0 : s.box.selected;
      UI.Ops.select(this.bag, s.box.id, ((cur + dir) % n + n) % n);
      this.app.invalidate('hotbar');
    }

    run(res, ev, keepCursorOnFail) {
      if (!res) return;
      const flushed = this.ch ? this.ch.flush(this.bag) : { results: [] };
      const done = UI.Ops.resolve(this.bag, res.plan, flushed.results);
      /* Ops.resolve 会往 bag 里再塞一条 deny 的 wantSay：不补一次 flush，玩家就要等下一次操作才看得到，
         现场感觉就是"点了没反应"。 */
      if (this.ch && this.bag && ((this.bag.events && this.bag.events.length) || (this.bag.intents && this.bag.intents.length))) this.ch.flush(this.bag);
      if (!done.ok && keepCursorOnFail) { /* 游戏驳回：光标上的东西留着，玩家能换个地方放 */ }
      this.app.invalidate('cursor');
      this.app.invalidate('hotbar');
      this.app.invalidate('inv');
      this.app.invalidate('tray');
      return res;
    }

    /* ---- 光标上的那一摞（ghost）---- */
    frameGhost(dt) {
      const cur = this.bag.cursor;
      if (!cur) { if (this.ghostEl) this.ghostEl.classList.add('ui-hide'); }
      else {
        const key = cur.kind + '/' + cur.id + '/' + cur.count;
        if (!this.ghostEl) this.buildGhost();
        this.ghostEl.classList.remove('ui-hide');
        if (this.ghostKey !== key) {
          this.ghostKey = key;
          UI.Art.paint(this.ghostCanvas, cur, { size: 32 });
          UI.setText(this.ghostCount, cur.count > 1 ? String(cur.count) : '');
        }
        this.moveGhost(this.hoverPt.x, this.hoverPt.y);
      }
      /* 悬停计时：够久才出提示，划过去不一闪一闪。
         旧版这里有个"最近 140ms 内动过鼠标才继续计时"的闸（本意是怕提示赖在屏幕上），
         结果 260ms 这道门永远过不去：玩家停着看一张卡时提示与详情栏根本不出 ——
         详情栏空着，卡页那四个按钮就集体静默（2026-10-17 用户报"完全做不了"的第一环）。
         该管的是"还在不在同一格上"：离开时 onMove 已经 showTip(null)，关面板 clearHover() 也收，
         不需要这个闸。 */
      if (this.hoverBox != null && !this.active && !this.downPt) {
        this.hoverT += dt;
        if (this.hoverT * 1000 >= HOVER_MS) {
          const box = this.bag.get(this.hoverBox);
          const item = box && box.get(this.hoverSlot);
          this.showTip({ box: this.hoverBox, slot: this.hoverSlot, item: item });
        }
      }
    }
    moveGhost(x, y) {
      if (!this.ghostEl) return;
      UI.setStyle(this.ghostEl, { transform: 'translate(' + (x + 10) + 'px,' + (y + 12) + 'px)' });
    }
    buildGhost() {
      const d = document;
      const root = d.createElement('div');
      root.className = 'ui-cursor-stack';
      const cv = d.createElement('canvas');
      const num = d.createElement('span');
      num.className = 'ui-cursor-num';
      root.appendChild(cv); root.appendChild(num);
      this.app.layers.get('drag').el.appendChild(root);
      this.ghostEl = root; this.ghostCanvas = cv; this.ghostCount = num;
    }
    /* 提示：内容全由文案供给（describeItem）给，本层只摆位置 */
    showTip(info) {
      if (!info || !info.item) { if (this.tipEl) this.tipEl.classList.add('ui-hide'); this.tipShown = false; return; }
      if (!this.tipEl) {
        const t = document.createElement('div');
        t.className = 'ui-tooltip ui-hide';
        /* describeItem 的行式约定 = 提示的排版契约：第 1 行名称、第 2 行类型行、其余正文。
           （内容仍全部由文案层供给，这里只是分行摆位，一个中文字都不在这层造） */
        const a = document.createElement('div'), b = document.createElement('div'), c = document.createElement('div');
        a.className = 'ui-tip-t'; b.className = 'ui-tip-sub'; c.className = 'ui-tip-body';
        t.appendChild(a); t.appendChild(b); t.appendChild(c);
        this.app.layers.get('tooltip').el.appendChild(t);
        this.tipEl = t; this.tipParts = [a, b, c];
      }
      const text = this.ch && this.ch.ask('describeItem', info.item, info) || null;
      if (!text) { this.tipEl.classList.add('ui-hide'); return; }
      if (this.tipText !== text) {
        this.tipText = text;
        const lines = String(text).split('\n');
        UI.setText(this.tipParts[0], lines[0] || '');
        UI.setText(this.tipParts[1], lines[1] || '');
        UI.setText(this.tipParts[2], lines.slice(2).join('\n'));
        this.tipParts.forEach((p) => { p.classList.toggle('ui-hide', !p.textContent); });
      }
      /* 左侧一条元素色竖带：颜色来自物品自己（describeItem 同源），提示与卡面认得出是同一张 */
      const tone = info.item.meta && info.item.meta.tone;
      UI.setStyle(this.tipEl, { '--ui-tone': tone || '' });
      this.tipEl.classList.remove('ui-hide');
      const pad = 14, W = window.innerWidth, H = window.innerHeight;
      const x = Math.min(this.hoverPt.x + pad, W - this.tipEl.offsetWidth - pad);
      const y = Math.min(this.hoverPt.y + pad, H - this.tipEl.offsetHeight - pad);
      UI.setStyle(this.tipEl, { transform: 'translate(' + Math.max(pad, x) + 'px,' + Math.max(pad, y) + 'px)' });
    }
    /* 关面板 / Esc：光标上那一摞找个地方放下（塞不进就按意图丢出去，与原版一致） */
    returnCursor(prefer) {
      /* 先留一份"手上拿的是什么、从哪格拿的"：Ops.returnCursor 在收尾时会把 bag.cursor 清空，
         事后再读就只剩 null（那就成了"关个背包，牌没了"）。 */
      const held = this.bag.cursor ? { kind: this.bag.cursor.kind, id: this.bag.cursor.id, count: this.bag.cursor.count } : null;
      const from = this.cursorFrom;
      const r = UI.Ops.returnCursor(this.bag, prefer);
      if (r.via === 'void' && held) this.bag.want('ui.spill', {
        item: held,
        slot: (from && typeof from.slot === 'number') ? from.slot : null,
        side: (from && from.side) | 0
      });
      this.ch && this.ch.flush(this.bag);
      this.app.invalidate('cursor');
      this.app.invalidate('hotbar');
      this.app.invalidate('inv');
      return r;
    }
    /* 给回归脚本看的快照（不是给玩家看的，零文案） */
    snapshot() {
      const b = this.bag;
      return {
        cursor: b.cursor ? { kind: b.cursor.kind, id: b.cursor.id, count: b.cursor.count } : null,
        version: b.version,
        button: b.button,
        active: this.active,
        containers: b.list().map((c) => ({ id: c.id, kind: c.kind, size: c.size, selected: c.selected, filled: c.slots.filter(Boolean).length }))
      };
    }

    /* 面板关掉 / 指针重锁：把悬停与提示一起清掉 */
    clearHover() { this.hoverBox = null; this.hoverSlot = -1; this.hoverT = 0; this.tipKey = ''; this.showTip(null); }

    cancel() {
      this.active = false; this.button = 0; this.bag.button = 0;
      this.downPt = null; this.downEl = null; this.pendingPickup = false;
      this.showTip(null);
    }
  }
  UI.DragController = DragController;
  UI.initDrag = function (app, bag, channel) { UI.drag = new DragController(app, bag, channel); return UI.drag; };
})(window.GW);
