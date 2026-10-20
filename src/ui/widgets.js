/* ================= GW.UI.widgets（可复用控件·全部由 spec 生成·零中文） =================
   这一层是"工业化"的货架：面板要什么，就从这里取一个 spec 工厂，不各写各的 DOM。
   每个控件都是一个函数，返回声明式 spec（见 js/ui/dom.js），文案一律由调用方注入
   （copy 对象 / fmt 函数），所以本层一个中文字都不出现 —— tools/layer_check.cjs 拦这条。

   货架清单：
     Text / Btn / Chips / Toggle / Segmented / Range / Search / Tabs
     Meter（血条类）/ Badge / Kbd / Divider
     Slot（一格物品）/ SlotList（一排格子）/ Grid（图鉴格子墙）/ List（通用列表，三选一走它）
     Feed（日志：1.6s 内重复消息合并成 ×N，最多 8 条 —— 旧 hud.js 的语义原样搬进来）
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});
  const h = UI.dom.h;

  /* ---------- 原子 ---------- */
  const Text = (v, cls) => h('span' + (cls ? '.' + cls : ''), { text: v });
  const Divider = (cls) => h('div.' + (cls || 'ui-divider'));
  const Kbd = (v) => h('kbd.ui-kbd', { text: v });

  /* ---------- 按钮族 ---------- */
  function Btn(o) {
    o = o || {};
    return h('button.ui-btn' + (o.cls ? '.' + o.cls : ''), {
      text: o.label,
      title: o.title,
      attrs: { type: 'button', disabled: o.disabled ? 'disabled' : null, 'data-key': o.key || null },
      class: (ctx) => (typeof o.active === 'function' ? (o.active(ctx) ? 'on' : '') : (o.active ? 'on' : '')),
      on: {
        click: (ev, ctx) => { ev.preventDefault(); ev.stopPropagation(); if (o.onClick) o.onClick(ev, ctx); }
      }
    });
  }
  function Chips(o) {                       // 一行筛选片：items 可为数组（静态）或函数（跟着模型活）
    return h('div.ui-chips', {
      list: (ctx) => (typeof o.items === 'function' ? o.items(ctx) : (o.items || [])),
      keyOf: (it) => String(it.key),
      cell: (it) => Btn({ label: it.label, active: !!it.active, key: it.key, onClick: (ev, ctx) => o.onPick && o.onPick(it, ctx) })
    });
  }
  function Toggle(o) {                      // 调试开关：spec 里只有 key 与 value
    return h('label.ui-toggle', {
      children: [
        h('input', {
          attrs: { type: 'checkbox' },
          props: { checked: (ctx) => !!(ctx.item ? ctx.item.value : (typeof o.valueFor === 'function' ? o.valueFor(ctx) : o.value)) },
          on: { change: (ev, ctx) => o.onChange && o.onChange(ev.target.checked, ctx.item || o) }
        }),
        h('span.ui-toggle-label', { text: (ctx) => o.labelFor ? o.labelFor(ctx.item || o) : o.label })
      ]
    });
  }
  function Segmented(o) {                   // 时间流速 / 昼夜这类互斥档
    return h('div.ui-seg', {
      children: [
        h('span.ui-seg-label', { text: o.label }),
        h('div.ui-seg-btns', {
          list: () => (o.values || []).map((v) => ({ v: v })),
          keyOf: (it) => String(it.v),
          cell: (it) => Btn({
            label: (ctx) => o.formatFor ? o.formatFor(it.v, ctx) : String(it.v),
            active: (ctx) => String(o.valueFor ? o.valueFor(ctx, it.v) : o.value) === String(it.v),
            onClick: (ev, ctx) => o.onPick && o.onPick(it.v, ctx)
          })
        })
      ]
    });
  }
  /* 数值滑杆：设置界面用（FOV/视距/摇晃强度）。值由调用方格式化，组件本身零中文。 */
  function Range(o) {
    const val = (ctx) => (typeof o.valueFor === 'function' ? o.valueFor(ctx) : o.value);
    return h('div.ui-range', {
      children: [
        h('span.ui-range-k', { text: o.label }),
        h('input.ui-range-in', {
          attrs: { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step || 1) },
          props: { value: (ctx) => String(val(ctx)) },
          on: { input: (ev, ctx) => {
            /* 滑杆一动先把读数改掉：面板的脏同步有 60ms 节流，等下一帧才刷新会让玩家觉得"拖了没反应" */
            const lab = ev.target.parentNode && ev.target.parentNode.querySelector('.ui-range-v');
            if (lab && o.format) lab.textContent = o.format(+ev.target.value);
            if (o.onInput) o.onInput(+ev.target.value, ctx);
          } }
        }),
        h('b.ui-range-v', { text: (ctx) => (o.format ? o.format(val(ctx)) : String(val(ctx))) })
      ]
    });
  }
  function Search(o) {
    return h('input.ui-search', {
      ref: o.ref || 'search',
      attrs: { type: 'text', placeholder: o.placeholder, id: o.id || null, autocomplete: 'off' },
      props: { value: (ctx) => (o.value ? o.value(ctx) : '') },
      on: {
        input: (ev, ctx) => o.onInput && o.onInput(ev.target.value, ctx),
        keydown: (ev, ctx) => { ev.stopPropagation(); if (ev.key === 'Escape') { ev.preventDefault(); o.onEscape && o.onEscape(ctx); } }
      }
    });
  }
  function Tabs(o) {                        // 左侧分类栏（MC 创造模式那一竖排）：items 同样可传函数
    return h('nav.ui-tabs', {
      list: (ctx) => { const src = typeof o.items === 'function' ? o.items(ctx) : (o.items || []); return src.map((it) => ({ key: it.key, label: it.label, badge: it.badge })); },
      keyOf: (it) => it.key,
      cell: (it, i, ctx) => h('button.ui-tab' + (it.badge ? '.has-badge' : ''), {
        text: it.label,
        title: it.tip,
        class: () => (o.active() === it.key ? 'on' : ''),
        on: { click: (ev) => { ev.preventDefault(); o.onPick && o.onPick(it.key, ev); } }
      })
    });
  }

  /* ---------- 数值条：标签在左、分段条在中、数字在右（"扫一眼"的读数口径） ---------- */
  function Meter(o) {
    o = o || {};
    return h('div.ui-meter' + (o.cls ? '.' + o.cls : ''), {
      attrs: { id: o.id || null, 'data-role': 'meter' },
      class: (ctx) => (o.low ? (o.low(ctx) ? 'low' : '') : ''),
      children: [
        h('span.ui-meter-k', { text: o.label }),
        h('div.ui-meter-t', {
          children: [
            h('i.ui-meter-ghost', { style: (ctx) => ({ width: clamp01(o.ratio(ctx)) * 100 + '%' }) }),
            h('i', { style: (ctx) => ({ width: clamp01(o.ratio(ctx)) * 100 + '%' }) })
          ]
        }),
        h('b.ui-meter-v', { text: o.text })
      ]
    });
  }
  function clamp01(v) { v = +v; return !isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; }

  const Badge = (o) => h('span.ui-badge', { text: o.label, title: o.tip, style: o.style });
  const BadgeBar = (o) => h('div.ui-badgebar', {
    list: () => (o.items ? o.items() : []).filter(Boolean),
    keyOf: (it) => it.key + ':' + it.label,
    cell: (it) => Badge({ label: it.label, tip: it.tip, style: it.style })
  });

  /* ---------- 物品格子：一格 = 图章 + 数量 + 角标 + 冷却遮罩 + 键位提示 ---------- */
  function Slot(o) {                        // o: {box, idx, item, sel, hint, cost, cd, count, tone, deny, onUse}
    const keyOf = (it) => (it ? it.kind + '/' + it.id + '/' + it.count : '');
    const cell = {
      t: 'div', c: ['ui-slot'].concat(o.cls ? [o.cls] : []),
      attrs: {
        'data-box': (typeof o.box === 'function') ? ((ctx2) => o.box(ctx2)) : o.box, 'data-slot': String(o.idx), tabindex: '-1',
        /* title 必须由调用方给（回归脚本也按它找卡面）；空的时候整个属性被删掉，不留悬提示 */
        title: o.title ? ((ctx2) => o.title(ctx2)) : null
      },
      class: (ctx) => {
        const it = o.item ? o.item(ctx) : null;
        const parts = [];
        if (o.sel && o.sel(ctx)) parts.push('sel');
        if (o.deny && o.deny(ctx)) parts.push('deny');
        if (!it) parts.push('empty');
        if (o.tone) { const tn = typeof o.tone === 'function' ? o.tone(ctx) : o.tone; if (tn) parts.push('tone-' + tn); }
        return parts.join(' ');
      },
      /* 元素色只当**印章**用：交给 CSS 的 --ui-tone（底部元素带 + 费用牌底色），
         边框永远是中性色——旧版把元素色写成整格 borderColor，56 张卡就是彩虹描边，
         而且顺手把选中的黄铜框盖掉了（选中态看不见）。 */
      style: (ctx) => {
        const st = {};
        const tn = o.color ? (typeof o.color === 'function' ? o.color(ctx) : o.color) : null;
        if (tn) st['--ui-tone'] = tn;
        return Object.keys(st).length ? st : null;
      },
      on: {
        /* 只用 pointerdown/up（GW.UI.drag 统一接管），这里只补"键盘 Enter/空格 = 用这一格" */
        keydown: (ev, ctx) => { if ((ev.key === 'Enter' || ev.key === ' ') && o.onUse) { ev.preventDefault(); o.onUse(ctx); } }
      },
      children: [
        h('canvas.ui-slot-icon', {
          after: (el, ctx) => {
            const it = o.item ? o.item(ctx) : null;
            const k = keyOf(it);
            if (el.__key === k) return;                    // 同图章不重画（旧 handSig 优化在这里）
            el.__key = k;
            if (it) UI.Art.paint(el, it, { size: (o.iconSize || 32) });
            else { el.width = (o.iconSize || 32); el.height = (o.iconSize || 32); }
          }
        }),
        h('span.ui-slot-cost', { text: (ctx) => (o.cost ? o.cost(ctx) : ''), attrs: { 'data-empty': '1' } }),
        h('span.ui-slot-num', { text: (ctx) => { const it = o.item ? o.item(ctx) : null; return (it && it.count > 1) ? String(it.count) : ''; } }),
        h('span.ui-slot-cd', { text: (ctx) => (o.cd ? o.cd(ctx) : ''), style: (ctx) => (o.cdFill ? { '--ui-cd': String(clamp01(o.cdFill(ctx))) } : null) }),
        h('span.ui-slot-hint', { text: (ctx) => (o.hint ? o.hint(ctx) : '') }),
        o.name ? h('span.ui-slot-name', { text: (ctx) => (o.name(ctx) || '') }) : null
      ].filter(Boolean)
    };
    return cell;
  }
  /* 一排 / 一片格子：给个索引数组就出格子（手持栏、随身格、图鉴都用它） */
  function SlotList(o) {
    return h('div.' + (o.cls || 'ui-slots'), {
      list: (ctx) => { const n = typeof o.count === 'function' ? o.count(ctx) : o.count; return new Array(n).fill(0).map((_, i) => ({ i: i })); },
      keyOf: (it) => String(it.i),
      cell: (it, i, ctx) => o.cell ? o.cell(it.i, ctx) : Slot(Object.assign({}, o, { idx: it.i }))
    });
  }

  /* ---------- 通用列表（三选一必须复用这个，见 docs/GAMEPLAY.md §7.3 第 3 条） ---------- */
  function List(o) {
    return h('div.ui-list' + (o.cls ? '.' + o.cls : ''), {
      list: (ctx) => (o.items ? o.items(ctx) : []),
      keyOf: (it, i) => String(o.keyOf ? o.keyOf(it, i) : i),
      cell: (it, i, ctx) => h('div.ui-list-item', {
        attrs: { 'data-value': o.valueOf ? String(o.valueOf(it, i)) : String(i) },
        class: (c) => (o.pick ? 'pick' : ''),
        on: { click: (ev, c) => o.onPick && o.onPick(it, i, c) },
        children: [
          h('canvas.ui-list-icon', {
            after: (el) => {
              const k = it.kind ? it.kind + '/' + it.id : (it.item ? it.item.kind + '/' + it.item.id : '');
              if (el.__key === k) return;
              el.__key = k;
              const ref = it.item || it;
              if (ref && ref.kind) UI.Art.paint(el, ref, { size: o.iconSize || 28 });
            }
          }),
          h('div.ui-list-body', {
            children: [
              h('div.ui-list-title', { text: o.title ? o.title(it, i) : '' }),
              o.sub ? h('div.ui-list-sub', { text: o.sub(it, i) }) : null,
              o.detail ? h('div.ui-list-detail', { text: o.detail(it, i) }) : null
            ].filter(Boolean)
          }),
          o.trailing ? h('div.ui-list-tail', { text: o.trailing(it, i) }) : null
        ].filter(Boolean)
      })
    });
  }

  /* ---------- 日志：1.6s 内重复消息合并成 ×N，最多 8 条（旧 hud.js 的口径） ---------- */
  class Feed {
    constructor(opts) {
      Object.assign(this, { dedupeMs: 1600, max: 8 }, opts || {});
      this.rows = [];
      this.now = () => (performance && performance.now ? performance.now() : Date.now());
    }
    add(msg, color) {
      const t = this.now();
      const last = this.rows[this.rows.length - 1];
      if (last && last.msg === msg && last.color === color && t - last.t < this.dedupeMs) {
        last.n = (last.n || 1) + 1; last.t = t;
      } else {
        this.rows.push({ msg: msg, color: color || '', t: t, n: 1, id: (this.seq = (this.seq || 0) + 1) });
        while (this.rows.length > this.max) this.rows.shift();
      }
      return this;
    }
    clear() { this.rows.length = 0; return this; }
    spec() {
      return {
        list: () => this.rows,
        keyOf: (r) => String(r.id),
        cell: (r) => h('div.ui-log-row', {
          style: { color: r.color || null },
          children: [
            h('span.ui-log-msg', { text: r.msg }),
            h('span.ui-log-times', { text: r.n > 1 ? ' ×' + r.n : '' })
          ]
        })
      };
    }
  }

  UI.Widgets = {
    Text, Divider, Kbd, Btn, Chips, Toggle, Segmented, Range, Search, Tabs,
    Meter, Badge, BadgeBar, Slot, SlotList, List, Feed, clamp01
  };
})(window.GW);
