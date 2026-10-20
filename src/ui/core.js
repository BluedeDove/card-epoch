/* ================= GW.UI.core（框架内核：总线 / 图层顺序 / 帧调度 / 面板基类） =================
   工业化 UI 的三件基础设施都在这里，别的模块只准从这里拿轮子：

   1) Bus        组件之间只通过事件说话，禁止互相伸手改字段（on/off/once/emit，返回取消函数）。
   2) LayerStack **渲染顺序由一张表决定**，不在各个面板里手写 z-index。
                图层 = 一个容器元素 + 一个 z 值 + 一条指针策略；面板注册时声明落在哪一层、层内第几位。
   3) UIApp      帧调度器：每帧的 pass 顺序固定为
                   readModel → reconcile(只刷脏面板) → motion(tween/timer) → overlay(提示/拖拽跟随)
                主循环只喂它一个 frame(dt)，不在渲染循环里散落 DOM 写入。

   Panel 基类：子类只写两件事 —— spec(vm) 交一张声明式结构、数据从 vm 里读；
              动作通过 GW.UI.channel 说给游戏，绝不自己写权威状态。

   本层禁则（tools/layer_check.cjs 机检）：零玩家可见中文、零 innerHTML。
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});

  /* ---------------- 1) 事件总线 ---------------- */
  class Bus {
    constructor() { this.map = new Map(); }
    on(type, fn) {
      const set = this.map.get(type) || this.map.set(type, new Set()).get(type);
      set.add(fn);
      return () => this.off(type, fn);
    }
    once(type, fn) {
      const off = this.on(type, (p) => { off(); fn(p); });
      return off;
    }
    off(type, fn) { const set = this.map.get(type); if (set) set.delete(fn); }
    emit(type, payload) {
      const set = this.map.get(type);
      if (!set || !set.size) return 0;
      for (const fn of Array.from(set)) {
        try { fn(payload, type); } catch (e) { if (console && console.error) console.error('[GW.UI] listener failed: ' + type, e); }
      }
      return set.size;
    }
    clear() { this.map.clear(); }
  }
  UI.Bus = Bus;

  /* ---------------- 2) 图层顺序 ----------------
     顺序 = 表里的下标，越靠后越在上面。面板不许自己写 z-index，只能声明要落在哪一层。
     mount：直接把 index.html 给的挂载点当容器（样式与 z-index 归 CSS 管，框架不插手）；
     in   ：在某个挂载点里面建一个框架自己的层（手持栏 / toast 要压在 HUD 之上，
            又必须跟 #hud 一起被淡掉，所以它们是 #hud 的子层）；
     都不写：框架在 body 上建一层（提示 / 光标上的那一摞）。
     pointer：'none' 纯显示层（不吃鼠标）；'auto' 可交互层。 */
  const LAYER_TABLE = [
    { name: 'backdrop', mount: 'fade',   pointer: 'none' },   // 淡入遮罩
    { name: 'hud',      mount: 'hud',    pointer: 'none' },   // 顶栏/血条/日志/准星信息/按键条
    { name: 'hotbar',   in: 'hud',       pointer: 'auto' },   // 手持栏（要能点、能拖进来）
    { name: 'notice',   in: 'hud',       pointer: 'none' },   // toast：压在 HUD 之上
    { name: 'menu',     mount: 'menu',   pointer: 'auto' },
    /* 选关面板（docs/LEVELS.md §4）：与菜单同一类"骨架挂载点 + 可交互"层，紧跟 menu 之后 */
    { name: 'level',    mount: 'level',  pointer: 'auto' },
    /* 战前选牌页（docs/ROUTER.md §2，任务书 L1 第 1 条）：与 level / menu 同一类"骨架挂载点 + 可交互"层，
       紧跟 level 之后 —— 它是选关的下一页，压在 level 之上、result 之下。
       口径变更（2026-10-18）：层级序列多一条 loadout；tools/ui_check.cjs 与 tools/level_check.cjs 各有一条
       把序列写死比对的断言，随本次一并追加 loadout（仍是逐字全等，不是放宽判据）。 */
    { name: 'loadout',  mount: 'loadout', pointer: 'auto' },
    { name: 'result',   mount: 'result', pointer: 'auto' },
    /* 局内暂停菜单（2026-10-20）：Esc 打开，压在 result 之上、设置之下；
       设置是从暂停里打开的下一页，Esc 先回暂停，而不是直接回游戏。 */
    { name: 'pause',    mount: null,     pointer: 'auto' },
    /* 设置界面（2026-10-20）：菜单与局内共用同一页；挂在独立 #settings 上，
       压在 result 之上、背包之下——背包开着时按 O 不能把设置塞到它下面。 */
    { name: 'settings', mount: 'settings', pointer: 'auto' },
    { name: 'panel',    mount: 'inv',    pointer: 'auto' },   // 背包（打开即暂停逻辑）
    { name: 'choice',   mount: null,     pointer: 'auto' },   // 通用选择面板（三选一复用它，见 GAMEPLAY §7.3）：
                                                                // 必须挂 body 而不是 #inv 里 —— 弹出时背包通常是关着的
    { name: 'tooltip',  mount: null,     pointer: 'none' },
    { name: 'drag',     mount: null,     pointer: 'none' }    // 光标上的那一摞，永远最顶
  ];
  UI.LAYER_TABLE = LAYER_TABLE.map((l) => l.name);

  class Layer {
    constructor(def, index, el) {
      this.name = def.name;
      this.index = index;
      this.pointer = def.pointer || 'none';
      this.el = el;
      this.panels = [];
    }
    /* 面板按 order 排在同图层内，顺序稳定可复现（回归测试要能断言它） */
    put(panel) {
      this.panels.push(panel);
      this.panels.sort((a, b) => (a.order - b.order) || String(a.name).localeCompare(String(b.name)));
      for (const p of this.panels) if (p.node && p.node.parentNode === this.el) this.el.appendChild(p.node);
    }
  }

  class LayerStack {
    constructor(doc) {
      this.doc = doc || document;
      this.layers = new Map();
      this.ordered = [];
      this.rootHost = null;
    }
    define(def) {
      if (this.layers.has(def.name)) return this.layers.get(def.name);
      const index = this.ordered.length;
      let hostEl = def.mount ? this.doc.getElementById(def.mount) : null;
      const isMount = !!hostEl;                       // 骨架给的挂载点：样式与 z 归 index.html
      if (!hostEl) {
        hostEl = this.doc.createElement('div');
        hostEl.className = 'ui-layer ui-layer-' + def.name;
        hostEl.setAttribute('data-layer', def.name);
        const parent = def.in ? this.doc.getElementById(def.in) : null;
        (parent || this.doc.body).appendChild(hostEl);
        /* 顺序只由这张表决定；框架自己建的层一律不吃指针。
           图层是"同层级板排队用的盒子"，不是遮罩：它若吃了鼠标，
           手持栏会挡住点击画面锁鼠标、choice 层会挡住整个背包（真踩过）。
           哪个面板能点，由 index.html 里该面板根元素的 pointer-events 说了算。 */
        hostEl.style.zIndex = String(10 + index * 5);
        hostEl.style.pointerEvents = 'none';
      }
      /* 图层顺序只能由这张表决定：**挂载点也要**由 LayerStack 统一写 z-index。
         旧写法只给框架自建层写 z-index，骨架里的 #settings / #menu / #result 继续吃 CSS 的 20/22，
         于是后加的 pause 自建层（z=50）会盖在设置上面——暂停菜单压在设置页上就是这个根因。 */
      hostEl.style.zIndex = String(10 + index * 5);
      const layer = new Layer(def, index, hostEl);
      this.layers.set(def.name, layer);
      this.ordered.push(layer);
      return layer;
    }
    boot() { for (const def of LAYER_TABLE) this.define(def); return this; }
    get(name) {
      return this.layers.get(name) || this.define({ name: name, mount: null, pointer: 'none' });
    }
    /* 装配层与回归脚本用它断言"渲染顺序由这张表决定"这件事没跑偏 */
    order() { return this.ordered.map((l) => l.name); }
  }
  UI.LayerStack = LayerStack;

  /* ---------------- 3) 帧调度 ---------------- */
  class Panel {
    /* opts: {name, layer, order, live:true 每帧刷（提示/拖拽这类跟手的东西）} */
    constructor(opts) {
      Object.assign(this, { name: 'panel', layer: 'hud', order: 0, live: false, open: false, mounted: false }, opts || {});
      this.app = null;
      this.tree = null;
      this.node = null;
      this.refs = null;
    }
    /* 子类实现：返回声明式 spec */
    spec() { return { t: 'div' }; }
    create(app) {
      this.app = app;
      const Tree = UI.dom.Tree;
      this.tree = new Tree(this.spec(app.model));
      const layer = app.layers.get(this.layer);
      /* 建元素 + 挂进图层一步做完（先 mount 才拿得到 node） */
      this.tree.mount(layer.el, { vm: app.model, panel: this });
      this.node = this.tree.node;
      layer.put(this);
      this.refs = this.tree.refs;
      this.mounted = true;
      if (this.onCreate) this.onCreate(app);
      app.bus.emit('panel:create', { panel: this });
      return this;
    }
    /* 只重算这一棵树的动态值（脏的时候才被调用） */
    sync(vm) { this.tree && this.tree.render(vm, { panel: this }); return this; }
    /* 每帧被调用（只有 live 面板，或自己注册了 ticker 的面板） */
    tick() { }
    /* 显隐：面板自己的节点用 ui-hide 类。要动宿主（#inv / #menu / #result 这些骨架挂载点）
       的面板自己实现 onShow / onHide —— 背包用 .on、菜单与结算用 .hidden，都是 index.html 的 CSS 口径。 */
    show() {
      if (this.open) return this;
      this.open = true;
      this.node && this.node.classList.remove('ui-hide');
      if (this.onShow) this.onShow(this);
      this.app && this.app.invalidate(this.name);
      this.app && this.app.bus.emit('panel:show', { panel: this });
      return this;
    }
    hide() {
      if (!this.open) return this;
      this.open = false;
      this.node && this.node.classList.add('ui-hide');
      if (this.onHide) this.onHide(this);
      this.app && this.app.invalidate(this.name);
      this.app && this.app.bus.emit('panel:hide', { panel: this });
      return this;
    }
    visible(on) { on ? this.show() : this.hide(); return this; }
    /* 关掉时顺手把光标上那一摞放回去（装配层的关面板入口走这里，不让牌悬在半空） */
    requestClose() {
      if (UI.drag && this.returnCursorOnClose) UI.drag.returnCursor && UI.drag.returnCursor();
      this.hide();
      return this;
    }
  }
  UI.Panel = Panel;

  class UIApp {
    constructor(opts) {
      opts = opts || {};
      this.bus = new Bus();
      this.layers = new LayerStack(opts.doc).boot();
      this.panels = new Map();
      this.seq = [];                       // 注册顺序 = 同步顺序，保证可复现
      this.dirty = new Set();
      this.tickers = new Set();
      this.model = {};                     // 唯一的视图模型（app 层灌数据，ui 只读）
      this.clock = 0;
      this.throttleMs = opts.throttleMs == null ? 60 : opts.throttleMs;   // HUD 刷新节流（现状 0.06s）
      this.acc = 0;
      this.frameCount = 0;
      this.writeCount = 0;                 // 诊断用：本帧协调器被调用过几次
    }
    add(panel) {
      if (this.panels.has(panel.name)) return this.panels.get(panel.name);
      this.panels.set(panel.name, panel);
      panel.app = this;
      panel.create(this);
      this.seq.push(panel);
      this.seq.sort((a, b) => (a.layerIndex(this.layers) - b.layerIndex(this.layers)) || (a.order - b.order));
      this.bus.emit('ui:add', { panel: panel });
      return panel;
    }
    get(name) { return this.panels.get(name); }
    layerOf(name) { const p = this.panels.get(name); return p ? p.layer : null; }
    Panel_layerIndex_helper() { }
    /* 数据变了：mark 全部（省略 name）或某个面板 */
    invalidate(name) {
      if (name === undefined) { for (const p of this.seq) this.dirty.add(p.name); }
      else this.dirty.add(name);
      return this;
    }
    /* 换用外部模型对象（viewmodel 就地写，面板读的是同一个引用，省一次拷贝） */
    useModel(obj) { if (obj && this.model !== obj) { this.model = obj; } return this.invalidate(); }
    /* app 层唯一的灌数据入口 */
    setModel(patch) {
      Object.assign(this.model, patch);
      this.invalidate();
      return this;
    }
    ticker(fn) { this.tickers.add(fn); return () => this.tickers.delete(fn); }
    /* 面板栈：最上面的可关面板（Esc 交给装配层调用，键位表的家在 main.js） */
    topPanel() {
      let top = null;
      for (const p of this.seq) if (p.open && p.closable !== false) { if (!top || p.layerIndex(this.layers) > top.layerIndex(this.layers)) top = p; }
      return top;
    }
    closeTop() { const p = this.topPanel(); if (p) { p.requestClose ? p.requestClose() : p.hide(); } return !!p; }
    isPanelOpen() { for (const p of this.seq) if (p.open && p.pausing) return true; return false; }
    /* 一帧。pass 顺序固定，别在别处插 DOM 写入。 */
    frame(dt) {
      dt = dt > 0 ? dt : 0;
      this.clock += dt; this.acc += dt * 1000;
      this.frameCount++;
      const live = this.acc >= this.throttleMs;
      if (live) this.acc = 0;
      /* ① 脏面板：重算声明树（值没变的字段根本不会写 DOM） */
      if (this.dirty.size) {
        const names = Array.from(this.dirty);
        this.dirty.clear();
        for (const name of names) {
          const p = this.panels.get(name);
          if (!p || !p.mounted) continue;
          if (p.open === false && !p.alwaysSync) continue;      // 关着的面板不浪费一帧
          try { p.sync(this.model); this.writeCount++; }
          catch (e) { this.errors = (this.errors || 0) + 1; this.lastError = (e && e.stack) || String(e); if (console && console.error) console.error('[GW.UI] panel sync failed: ' + name, e); }
        }
      }
      /* ② 动效与跟随：tween、toast 计时、提示延迟、拖拽 ghost */
      for (const p of this.seq) {
        if (p.live || this.tickers.has(p)) {
          if (p.open !== false || p.alwaysSync) {
            try { p.tick(dt, this.model); this.writeCount++; }
            catch (e) { this.errors = (this.errors || 0) + 1; this.lastError = (e && e.stack) || String(e); if (console && console.error) console.error('[GW.UI] panel tick failed: ' + p.name, e); }
          }
        }
      }
      for (const fn of Array.from(this.tickers)) { try { fn(dt, this.model); } catch (e) { if (console && console.error) console.error('[GW.UI] ticker failed', e); } }
      return this;
    }
  }
  UI.Panel.prototype.layerIndex = function (stack) { const l = stack.layers.get(this.layer); return l ? l.index : 99; };
  UI.app = null;
  UI.Bus_instance = null;
  UI.boot = function (opts) {
    if (UI.app) return UI.app;
    UI.app = new UIApp(opts);
    return UI.app;
  };
})(window.GW);
