/* ================= GW.UI.dom（声明式 DOM 层·零玩家可见文案） =================
   这一层只回答一个问题：**怎么用对象描述一块界面，然后只改变化的那几个字。**

   作者写法（三种等价，越上面越常用）：
     h('div.slot#id.a.b', { on:{ click }, text: ctx => ctx.vm.x })     // hyperscript 速记
     node('button.ui-btn', { text }, [ ...children ])                  // 带 children
     { t:'div', c:'ui-slot', attrs:{ title: ctx => ... }, children:[…] } // 纯对象

   动态值：attrs / props / style / text / class 位置都可以放函数，签名 (ctx) => 值，
     ctx = { vm 当前视图模型, item 列表项, index 下标, panel 拥有者, parent, el }。
     协调器每轮求值一次并**与上次比：值没变就不碰 DOM**（PLAN_REFACTOR §7 的 bind 语义）。

   列表：list + cell + keyOf，同 key 复用节点（旧手牌的 handSig 跳过重建，在这里变成通用机制）。

   本层禁则（tools/layer_check.cjs 机检）：零玩家可见中文、零 innerHTML、
     document.* 只允许 createElement('canvas')。
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});

  const isFn = (v) => typeof v === 'function';
  const HIDE = 'ui-hide';                     // 统一隐藏类（样式在 index.html 的 .ui-hide）

  function el(tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* 把 'div.ui-slot.sel#x' 拆成 {tag, classes, id} */
  function parseTag(s) {
    let tag = 'div'; const cls = []; let id = null;
    const m = String(s || 'div').split(/([.#])/);
    let mode = '';
    for (let i = 0; i < m.length; i++) {
      const p = m[i];
      if (p === '.' || p === '#') { mode = p; continue; }
      if (!p) continue;
      if (!mode) tag = p;
      else if (mode === '.') cls.push(p);
      else id = p;
    }
    return { tag, cls, id };
  }

  function toSpec(input) {
    if (input == null) return null;
    if (typeof input === 'string' || typeof input === 'number') return { t: '#text', text: String(input) };
    return input;
  }

  /* 声明式速记：h('span.chip.on', { text }, childA, childB…) */
  function h(tagSel, props) {
    const p = parseTag(tagSel);
    const spec = Object.assign({}, props || {});
    spec.t = p.tag;
    /* 静态类名进 c；动态 class（函数）留在 spec.class 由 applySelf 求值 —— 混进 c 会被 join 成函数源码 */
    spec.c = [p.cls.join(' '), (typeof spec.c === 'function' ? null : spec.c)].filter(Boolean).flat();
    if (p.id) spec.attrs = Object.assign({ id: p.id }, spec.attrs || {});
    const kids = [];
    for (let i = 2; i < arguments.length; i++) {
      const a = arguments[i];
      if (Array.isArray(a)) kids.push.apply(kids, a); else kids.push(a);
    }
    if (kids.length) spec.children = (spec.children || []).concat(kids);
    return spec;
  }
  /* 与 h 同义，只是 children 走位置参数（写给习惯 JSX 的人） */
  function node(tagSel, props, children) {
    const args = [tagSel, props];
    if (children !== undefined) args.push(children);
    return h.apply(null, args);
  }

  /* ---------- 动态值写入（全部先比后写） ---------- */
  function writeClass(e, v) {
    const s = Array.isArray(v) ? v.filter(Boolean).join(' ') : (v || '');
    if (e.__cls !== s) { e.__cls = s; e.className = s; }
  }
  function writeAttr(e, k, v) {
    const s = (v === null || v === undefined || v === false) ? null : String(v);
    const cache = e.__attr || (e.__attr = {});
    if (cache[k] === s) return;
    cache[k] = s;
    if (s === null) e.removeAttribute(k); else e.setAttribute(k, s);
  }
  function writeProp(e, k, v) {
    const cache = e.__prop || (e.__prop = {});
    if (cache[k] === v) return;
    cache[k] = v;
    if (e[k] !== v) e[k] = v;
  }
  /* 写内联样式：一律先比后写。**自定义属性（--ui-*）必须走 setProperty**，
     e.style['--ui-tone']=… 是静默失败（旧版冷却遮罩的 --ui-cd 就是这么一直没生效的）。
     组件的颜色一律用自定义属性传给 CSS（元素色 = --ui-tone），别在这儿拼颜色字符串。 */
  const setOne = (e, k, v) => { if (k.charAt(0) === '-') e.style.setProperty(k, v); else e.style[k] = v; };
  const clearOne = (e, k) => { if (k.charAt(0) === '-') e.style.removeProperty(k); else e.style[k] = ''; };
  function writeStyle(e, obj) {
    const last = e.__style || (e.__style = {});
    for (const k in last) if (!(k in obj)) { clearOne(e, k); delete last[k]; }
    for (const k in obj) {
      const v = obj[k] == null ? '' : String(obj[k]);
      if (last[k] === v) continue;
      last[k] = v;
      if (v === '') clearOne(e, k); else setOne(e, k, v);
    }
  }
  function writeText(e, v) {
    const s = v == null ? '' : String(v);
    if (e.__text === s) return;
    e.__text = s; e.textContent = s;
  }
  /* 给拖拽层 / 提示层复用的安全写入口 */
  UI.setStyle = writeStyle;
  UI.setText = writeText;
  UI.setClass = writeClass;

  /* ---------- 事件：建一次监听，触发时查当前 spec（复用节点不掉监听） ---------- */
  function bindEvents(w) {
    const map = w.spec.on;
    if (!map || w.__on) return;
    w.__on = {};
    for (const name in map) {
      for (const ev of name.split(/,\s*|\s+/)) {
        if (!ev || w.__on[ev]) continue;
        w.__on[ev] = true;
        const capture = ev.charAt(0) === '^';
        const type = capture ? ev.slice(1) : ev;
        w.el.addEventListener(type, (e) => {
          const fn = w.spec.on && w.spec.on[ev];
          if (fn) fn(e, w.ctx || {});
        }, capture);
      }
    }
  }

  /* ================= Widget：一个 VNode 的活体 ================= */
  class Widget {
    constructor(spec, root) {
      this.spec = spec || { t: 'div' };
      this.root = root || this;
      this.children = [];
      this.key = this.spec.key != null ? String(this.spec.key) : null;
      this.el = null;
      this.ctx = null;
      this.attached = true;
    }

    eval(v, ctx) { return isFn(v) ? v(ctx) : v; }

    create(ctx) {
      this.ctx = ctx;
      const s = this.spec;
      const tag = s.t || 'div';
      this.el = (tag === '#text') ? document.createTextNode('') : el(tag, s.attrs ? this.staticAttrs(s, ctx) : null);
      this.applySelf(ctx);
      this.buildChildren(ctx);
      if (s.ref && this.root.refs) this.root.refs[s.ref] = this;
      bindEvents(this);
      return this.el;
    }

    staticAttrs(s, ctx) {
      const out = {};
      for (const k in s.attrs) out[k] = this.eval(s.attrs[k], ctx);
      return out;
    }

    /* 换一份 spec 复用同一节点（列表复用、面板重绑定都走这里） */
    rebind(spec, ctx) {
      const sameTag = ((spec && spec.t) || 'div') === ((this.spec && this.spec.t) || 'div');
      this.spec = spec || { t: 'div' };
      this.key = this.spec.key != null ? String(this.spec.key) : null;
      if (!sameTag) {
        const p = this.el && this.el.parentNode;
        const fresh = new Widget(this.spec, this.root).create(ctx);
        if (p) p.replaceChild(fresh, this.el);
        this.el = fresh;
        this.children = [];
        if (this.spec.ref && this.root.refs) this.root.refs[this.spec.ref] = this;
        bindEvents(this);
        return;
      }
      this.ctx = ctx;
      if (this.spec.ref && this.root.refs) this.root.refs[this.spec.ref] = this;
      this.applySelf(ctx);
      this.buildChildren(ctx);
      bindEvents(this);
    }

    applySelf(ctx) {
      const s = this.spec, e = this.el;
      if (!e) return;
      if (s.t === '#text') { writeText(e, this.eval(s.text, ctx)); return; }

      const parts = [];
      if (s.c) Array.isArray(s.c) ? parts.push.apply(parts, s.c) : parts.push(s.c);
      if (s.class) parts.push(this.eval(s.class, ctx));
      if (typeof s.when === 'function') {
        this.attached = !!s.when(ctx);
        if (!this.attached) parts.push(HIDE);
      }
      writeClass(e, parts);

      if (s.attrs) for (const k in s.attrs) writeAttr(e, k, this.eval(s.attrs[k], ctx));
      if (s.props) for (const k in s.props) writeProp(e, k, this.eval(s.props[k], ctx));
      if (s.style) {
        let obj = null;
        if (typeof s.style === 'function') obj = s.style(ctx) || {};
        else { obj = {}; for (const k in s.style) obj[k] = this.eval(s.style[k], ctx); }
        writeStyle(e, obj);
      }
      if (s.text !== undefined) writeText(e, this.eval(s.text, ctx));
      /* after：确实需要命令式补一刀的地方（画布图章、焦点…），自己负责脏检查 */
      if (typeof s.after === 'function') s.after(e, ctx);
    }

    buildChildren(ctx) {
      const s = this.spec, e = this.el;
      if (!e || e.nodeType === 3) return;
      if (typeof s.list === 'function') { this.syncList(s.list(ctx) || [], ctx); return; }
      const kids = s.children || [];
      const want = kids.length;
      while (this.children.length < want) {
        const w = new Widget(toSpec(kids[this.children.length]), this.root);
        e.appendChild(w.create(Object.assign({}, ctx, { parent: this })));
        this.children.push(w);
      }
      while (this.children.length > want) {
        const w = this.children.pop();
        w.dispose();
        if (w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el);
      }
      for (let i = 0; i < want; i++) {
        this.children[i].rebind(toSpec(kids[i]), Object.assign({}, ctx, { parent: this, index: i }));
      }
    }

    /* keyed diff：同 key 复用、新 key 插入、旧 key 回收，顺序以新数组为准 */
    syncList(items, ctx) {
      const s = this.spec, e = this.el;
      const keyOf = s.keyOf || ((it, i) => String(i));
      const old = new Map();
      this.children.forEach((w, i) => old.set(w.key == null ? ('#' + i) : w.key, w));
      const next = [];
      let anchor = e.firstChild;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = String(keyOf(item, i));
        const cellCtx = Object.assign({}, ctx, { item: item, index: i, parent: this });
        const spec = toSpec(s.cell ? s.cell(item, i, cellCtx) : item) || { t: 'div' };
        let w = old.get(key);
        if (w) { old.delete(key); w.rebind(spec, cellCtx); }
        else { w = new Widget(spec, this.root); w.create(cellCtx); }
        next.push(w);
        if (w.el !== anchor) e.insertBefore(w.el, anchor);
        else anchor = anchor ? anchor.nextSibling : null;
      }
      for (const w of old.values()) {
        if (w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el);
        w.dispose();
      }
      this.children = next;
    }

    update(ctx) {
      this.ctx = ctx;
      this.applySelf(ctx);
      const s = this.spec;
      if (typeof s.list === 'function') { this.syncList(s.list(ctx) || [], ctx); return; }
      const kids = s.children || [];
      if (kids.length === this.children.length) {
        for (let i = 0; i < this.children.length; i++) {
          this.children[i].update(Object.assign({}, ctx, { parent: this, index: i }));
        }
      } else this.buildChildren(ctx);
    }

    mount(parentEl, before) {
      if (this.el && this.el.parentNode !== parentEl) {
        if (before) parentEl.insertBefore(this.el, before); else parentEl.appendChild(this.el);
      }
      return this;
    }

    dispose() {
      for (const w of this.children) w.dispose();
      this.children.length = 0;
      if (this.spec && this.spec.ref && this.root.refs) delete this.root.refs[this.spec.ref];
      this.el = null;
    }

    query(selector) { return this.el && this.el.querySelector(selector); }
  }

  /* 根树：一个面板的整棵树。refs 收集 ref → Widget，留给确实需要命令式的小动作（聚焦搜索框等）。 */
  class Tree {
    constructor(spec) {
      this.refs = {};
      this.widget = new Widget(toSpec(spec), null);
      this.widget.root = this;
      this.ctx = { vm: {} };
    }
    mount(parentEl, ctx) {
      this.ctx = Object.assign({ vm: {} }, ctx || {});
      this.el = this.widget.create(this.ctx);
      parentEl.appendChild(this.el);
      return this;
    }
    render(vm, extra) {
      this.ctx = Object.assign({}, this.ctx, { vm: vm }, extra || {});
      this.widget.update(this.ctx);
      return this;
    }
    get node() { return this.widget.el; }
  }

  UI.dom = { h, node, Widget, Tree, parseTag, el, isFn };
})(window.GW);
