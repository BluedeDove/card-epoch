/* ================= GW.UI.panels（面板组装：每个面板 = 一个类 + 一张声明式结构） =================
   这就是"创建 1 个 UI 只要声明式地写一张表"的地方。每个面板是一个 Panel 子类：

     class HotbarPanel extends UI.Panel {
       spec(vm) { return {…} }            // 只写"长什么样、读哪个字段"
     }

   约定（tools/layer_check.cjs + tools/ui_check.cjs 一起拦）：
     · 面板里**不出现中文**：所有文案从 copy（js/hud.js 的 H.TEXT 对应段）注入；
     · 面板里**不查规则**：能不能出牌、扣不扣得起素材、改造几格，全由 app 写进 vm（PLAN §5.1 D5）；
     · 面板里**不写权威状态**：任何"我要做这件事"都变成意图交给 GW.UI.channel；
     · 面板不写 z-index / 不写样式字符串：布局样式在 index.html 的 .ui-* 段。

   面板清单
     Topbar     顶栏（seed / 模式 / 时间 / tick / FPS / 群系 / 创造徽章 / 逻辑异常）
     Vitals     血条面板（×2 台，分屏时第二台才出现）
     Aim        准星 + 准星下方那行信息 + 锁鼠标提示 + 帮助 + 按键条
     Log        日志（重复消息合并 ×N）
     Toast      中央提示（自动隐）
     Hotbar     手持栏（Minecraft 式：一格物品 + 数量 + 角标 + 冷却遮罩 + 键位提示，可点可拖）
     Inventory  背包（图鉴 / 随身格 / 手持栏编辑行 / 详情栏 / 调试页；打开即暂停逻辑并交还指针）
     Choice     通用选择面板（三选一以后复用它，禁止另写一套列表 DOM）
     Menu       主菜单
     Result     结算面板
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});
  const h = UI.dom.h, W = UI.Widgets;

  /* ---------- 顶栏：一切运行指标 ---------- */
  /* 三矿的小方块：颜色只走 theme.css 的令牌名（经 --ui-tone 传进 CSS），面板不写颜色值。
     归属来自 viewmodel 的 vm.lodes（= match.lodeSys.lodes 的 owner / contested）。 */
  const LODE_TONE = ['var(--el-fire)', 'var(--el-ice)', 'var(--txt-3)'];
  function lodeTone(l) {
    const o = l && typeof l.owner === 'number' ? l.owner : -1;
    return (o === 0 || o === 1) ? LODE_TONE[o] : LODE_TONE[2];
  }
  class Topbar extends UI.Panel {
    /* boardCopy = H.TEXT.board（积分榜每一行的中文标签）：面板按 displaySpec 给的行序渲染，
       它自己不认识任何玩法——有哪几行、行序如何、有没有目标 chip，全在玩法表的 display 里。 */
    constructor(copy, boardCopy) { super({ name: 'topbar', layer: 'hud', order: 10, open: true }); this.copy = copy; this.board = boardCopy || {}; }
    /* ---------- 积分榜（docs/MODES.md §5）----------
       行序与行数**完全读编排类的 displaySpec.rows**（vm.board 由 viewmodel 递进来），
       这里既不写死"比分/击杀/死亡"三行，也不判断几杀算赢；缺 board（这一局没挂编排类）
       就整个不占位，顶栏回到 T5 那两行。chip 的文字（目标 / 杀 / 不限）也在这张文案表里。 */
    rowLabel(key) {
      const R = (this.board && this.board.rows) || {};
      return R[key] || String(key || '');
    }
    chipLabel(key) {
      const B = this.board || {};
      return key === 'timeLeft' ? B.timeLeft : B.target;
    }
    chipText(chip) {
      const B = this.board || {};
      if (!chip) return '';
      if (chip.key === 'target') {
        const v = chip.value | 0;
        if (v <= 0) return B.unlimited || '';
        const U = B.units || {};
        return v + (U[chip.unit] != null ? U[chip.unit] : (B.targetUnit || ''));
      }
      if (chip.key === 'timeLeft') {
        const v = Number(chip.value);
        return (B.fmtTime && isFinite(v)) ? B.fmtTime(v) : '—';
      }
      return String(chip.value === undefined ? '' : chip.value);
    }
    boardBlock() {
      const self = this;
      const n = (k) => (ctx) => { const it = ctx.item || {}; const v = it[k]; return String(v === undefined || v === null ? 0 : v | 0); };
      return h('span.ui-top-board#ui-board', {
        attrs: { 'data-role': 'board' },
        when: (ctx) => !!(ctx.vm.board && ctx.vm.board.rows && ctx.vm.board.rows.length),
        children: [
          h('span.ui-board-rows', {
            list: (ctx) => (ctx.vm.board && ctx.vm.board.rows) || [],
            keyOf: (r, i) => String((r && r.key) || i),
            cell: (r) => h('span.ui-board-row', {
              children: [
                h('span.ui-board-k', { text: (ctx) => self.rowLabel((ctx.item || r).key) }),
                h('b.ui-board-v.mine', { text: n('mine') }),
                h('span.ui-board-sep', { text: '/' }),
                h('b.ui-board-v.theirs', { text: n('theirs') })
              ]
            })
          }),
          h('span.ui-board-chips', {
            list: (ctx) => (ctx.vm.board && ctx.vm.board.chips) || [],
            keyOf: (c, i) => String((c && c.key) || i),
            cell: (c) => h('span.ui-board-chip', {
              children: [
                h('span.ui-board-k', { text: (ctx) => self.chipLabel((ctx.item || c).key) }),
                h('b.ui-board-v', { text: (ctx) => self.chipText(ctx.item || c) })
              ]
            })
          })
        ]
      });
    }
    /* id 是给外部脚本认的锚点，字段名另给（以前拿 id 当字段名查，seed/tick 全成 '—'） */
    item(id, field, label) {
      return h('span.ui-top-item', {
        children: [h('span.ui-top-label', { text: label }), h('b#' + id, { text: (ctx) => (ctx.vm[field] != null && ctx.vm[field] !== '' ? ctx.vm[field] : '—') })]
      });
    }
    /* 比分那两块与「三矿」方块：都读 vm 的字段，缺字段就整个不占位（when 闸），
       常驻层只贴角贴边，别伸进屏幕中央 40%（ui_shot --gate 的 G 项量的就是这条） */
    /* 比分那块是编排类之前的老实现：vm.board 在场时收起（积分榜里已经按 displaySpec 画了比分那一行，
       两处并排就是同一个数写两遍）；没有编排类的老路径（不选玩法、量具直接建 Match）逐字照旧。 */
    scoreBlock() {
      const C = this.copy;
      const v = (s) => (ctx) => String((ctx.vm.score && ctx.vm.score[s]) | 0);
      return h('span.ui-top-score#ui-score', {
        when: (ctx) => !(ctx.vm.board && ctx.vm.board.rows && ctx.vm.board.rows.length),
        children: [
          h('span.ui-top-label', { text: C.scoreLabel }),
          h('b.ui-top-score-v', { text: v(0) }),
          h('span.ui-top-score-sep', { text: '/' }),
          h('b.ui-top-score-v', { text: v(1) })
        ]
      });
    }
    lodeBlock() {
      const C = this.copy;
      return h('span.ui-lodes#ui-lodes', {
        when: (ctx) => !!(ctx.vm.lodes && ctx.vm.lodes.length),
        children: [
          h('span.ui-top-label', { text: C.lodeLabel }),
          h('span.ui-lode-cells', {
            list: (ctx) => ctx.vm.lodes || [],
            keyOf: (l, i) => String(i),
            /* list 容器接管全部子节点，所以每一格自己就是一个方块（静态标签放在它外面另起一层） */
            cell: (l) => h('i.ui-lode-chip', {
              class: (ctx) => ((ctx.item && ctx.item.contested) ? ' contested' : ''),
              style: (ctx) => ({ '--ui-tone': lodeTone(ctx.item || l) })
            })
          })
        ]
      });
    }
    spec(vm) {
      const C = this.copy;
      /* 第一行＝玩家必须读到的（游戏名 / 模式 / 徽章 / 异常）；
         第二行＝开发者监控（seed · 计时 · tick · FPS · 群系 · 视角）：小字、等宽、降一档亮度。
         旧版把两档信息用「·」串成一行，看起来就是一坨调试输出——这就是"丑"的第二来源。 */
      return h('div.ui-topbar#ui-topbar', {
        attrs: { 'data-role': 'topbar' },
        children: [
          h('div.ui-top-main', {
            children: [
              h('span.ui-top-title', { text: (ctx) => ctx.vm.title || C.title }),
              h('span.ui-top-mode', { text: (ctx) => ctx.vm.modeText || '', when: (ctx) => !!ctx.vm.modeText }),
              this.scoreBlock(),
              this.boardBlock(),
              this.lodeBlock(),
              h('span.ui-gm#ui-gm', { text: (ctx) => (ctx.vm.badges ? ctx.vm.badges.join(' ') : ''), when: (ctx) => !!(ctx.vm.badges && ctx.vm.badges.length) }),
              h('span.ui-err#ui-err', { text: (ctx) => ctx.vm.errText || C.err, when: (ctx) => !!ctx.vm.err })
            ]
          }),
          h('div.ui-top-meta', {
            children: [
              this.item('ui-seed', 'seed', C.seedLabel),
              this.item('ui-time', 'time', C.timeLabel),
              /* 倒计时那一处也只留一个家：编排类给了 timeLeft（chip 画在第一条）时，
                 第二行的监控带就让位（同一个数在同一个面板里出现两遍 = 噪声，且改一处忘一处必然漂移）。
                 没有 board 或玩法不设时限 → 照旧显示这一格（不选玩法的老路径逐字不变）。 */
              (() => { const tl = this.item('ui-timeleft', 'timeLeft', C.timeLeftLabel); tl.when = (ctx) => !(ctx.vm.board && ctx.vm.board.timeLeft !== null && ctx.vm.board.timeLeft !== undefined); return tl; })(),
              this.item('ui-tick', 'tick', C.tickLabel),
              (() => { const f = this.item('ui-fps', 'fps', C.fpsLabel); f.when = (ctx) => ctx.vm.showFps !== false; return f; })(),
              this.item('ui-biome', 'biome', C.biomeLabel),
              h('span.ui-top-item', { children: [h('span.ui-top-label', { text: C.camLabel }), h('b#ui-cam', { text: (ctx) => ctx.vm.camName || '—' })] })
            ]
          })
        ]
      });
    }
  }

  /* ---------- 血条面板（一台一张，分屏时两张） ---------- */
  class Vitals extends UI.Panel {
    constructor(copy, side) {
      super({ name: 'vitals' + side, layer: 'hud', order: 12 + side, open: true });
      this.copy = copy; this.side = side || 0;
    }
    spec(vm) {
      const C = this.copy, s = this.side, n = s + 1;
      const read = (k) => (ctx) => { const p = ctx.vm.players && ctx.vm.players[s]; return p ? p[k] : ''; };
      const ratio = (k) => (ctx) => { const p = ctx.vm.players && ctx.vm.players[s]; if (!p) return 0; return W.clamp01(p[k]); };
      const bar = (cls, base, label, field) => h('div.ui-meter.' + cls + '#' + base + 'wrap' + n, {
        attrs: { 'data-role': 'meter' },
        class: (ctx) => { const p = ctx.vm.players && ctx.vm.players[s]; return (p && p[base + 'Low']) ? 'low' : ''; },
        children: [
          h('span.ui-meter-k', { text: label }),
          h('div.ui-meter-t', { children: [
            h('i.ui-meter-ghost', { style: (ctx) => ({ width: ratio(field + 'Ratio')(ctx) * 100 + '%' }) }),
            h('i', { style: (ctx) => ({ width: ratio(field + 'Ratio')(ctx) * 100 + '%' }) })
          ] }),
          h('b.ui-meter-v#' + base + 't' + n, { text: read(field + 'Text') })
        ]
      });
      const chip = (base, label, field) => h('span.ui-chip#ui-' + base + n, {
        children: [h('span.ui-chip-k', { text: label }), h('b.ui-chip-v', { text: read(field) })]
      });
      return h('div.ui-vitals' + (s ? '.p2' : '') + '#v' + n, {
        attrs: { 'data-role': 'vitals', 'data-side': String(s) },
        when: (ctx) => s === 0 || !!ctx.vm.split,
        children: [
          h('div.ui-who', { children: [h('span#ui-n' + n, { text: read('name') }), h('span.ui-lives#ui-l' + n, { text: read('lives') })] }),
          bar('hp', 'ui-hp', C.hp, 'hp'),
          bar('sh', 'ui-sh', C.shield, 'sh'),
          bar('mn', 'ui-mn', C.mana, 'mn'),
          h('div.ui-statusrow#ui-st' + n, {
            list: (ctx) => { const p = ctx.vm.players && ctx.vm.players[s]; return (p && p.statusList) || []; },
            keyOf: (x) => String(x.key),
            cell: (x) => h('span.ui-badge', { text: x.label, style: { '--ui-tone': x.color || null } })
          }),
          /* 当前类别这一枚搬到了手持栏（见 Hotbar 的 classbar）：它改的就是那五格，
             状态贴着自己的对象才读得懂；血条面板只留资源与战绩。 */
          h('div.ui-chipsrow', {
            children: [chip('mat', C.mat, 'matText'), chip('dk', C.deck, 'deckText'),
              chip('ds', C.discard, 'discardText'), chip('k', C.kill, 'killText')]
          })
        ]
      });
    }
  }

  /* ---------- 准星 + 那行信息 + 锁鼠标提示 + 帮助 + 按键条 ---------- */
  class Aim extends UI.Panel {
    constructor(copy) { super({ name: 'aim', layer: 'hud', order: 14, open: true }); this.copy = copy; }
    spec(vm) {
      const C = this.copy;
      return h('div.ui-aim', {
        attrs: { 'data-role': 'aim' },
        children: [
          h('div.ui-cross#cross', { attrs: { 'data-side': '0' }, class: (ctx) => (ctx.vm.aimHit ? 'hit' : '') }),
          h('div.ui-cross', { attrs: { 'data-side': '1' }, when: (ctx) => !!ctx.vm.split, class: (ctx) => (ctx.vm.aimHit2 ? 'hit' : '') }),
          h('div.ui-aiminfo#aiminfo', { text: (ctx) => (ctx.vm.aimText || ''), when: (ctx) => !!ctx.vm.aimText }),
          h('div.ui-lockhint#lockHint', { attrs: { 'data-role': 'lockhint' }, children: [h('b', { text: C.lockHintMain }), h('span', { text: C.lockHintSub })] }),
          h('div.ui-help#help', { attrs: { 'data-role': 'help' }, children: (C.helpLines || []).map((l, i) => h('div.ui-help-line', { children: [h('b', { text: l[0] }), h('span', { text: l[1] })] })) }),
          /* 键位带改成"键帽 + 动作"成对：旧版是一长句 10px 灰字，扫一眼读不出重点 */
          h('div.ui-keybar#keybar', { children: (C.keycaps || []).map((pair) => h('span.ui-keycap', { children: [h('span.ui-kbd', { text: pair[0] }), h('span', { text: pair[1] })] })) })
        ]
      });
    }
  }

  /* ---------- 日志（重复消息合并成 ×N，最多 8 条） ---------- */
  class Log extends UI.Panel {
    constructor(copy) { super({ name: 'log', layer: 'hud', order: 16, open: true }); this.copy = copy; this.feed = new W.Feed({}); }
    add(msg, color) { this.feed.add(msg, color); return this; }
    clear() { this.feed.clear(); return this; }
    spec(vm) {
      /* 列表容器由 diff 接管全部子节点，所以面板头必须放在它外面（同背包牌堆那条坑） */
      return h('div.ui-log#log', {
        attrs: { 'data-role': 'log' },
        children: [
          h('div.ui-head', { children: [h('span.ui-head-t', { text: this.copy.title || '' })] }),
          h('div.ui-log-body', {
            list: () => this.feed.rows.slice(), keyOf: (r) => String(r.id),
            cell: (r) => h('div.ui-log-row', {
              style: { color: r.color || null },
              children: [h('span.ui-log-msg', { text: r.msg }), h('span.ui-log-times', { text: r.n > 1 ? ' ×' + r.n : '' })]
            })
          })
        ]
      });
    }
  }

  /* ---------- 中央提示（自动隐） ---------- */
  class Toast extends UI.Panel {
    constructor(copy) {
      super({ name: 'toast', layer: 'notice', order: 40, live: true, open: true, alwaysSync: true });
      this.copy = copy; this.cur = { text: '', color: '', until: 0 };
    }
    /* 单位统一：ms 是毫秒。旧写法默认值给 1.1 又整个除 1000 —— 默认提示只活 1.1 **毫秒**，
       等于所有"点了没反应"的拒绝与提示刚写上就被摘掉（2026-10-17 用户报的"完全做不了"里，
       有很大一块是这个：系统确实回话了，只是没人看得见）。顺手在这里自己标脏，不依赖调用方记得 invalidate。 */
    push(text, color, ms) {
      const life = (ms == null ? 1100 : ms) / 1000;
      this.cur = { text: text || '', color: color || '', until: (this.app ? this.app.clock : 0) + life };
      this.dirtyTip = true;
      this.app && this.app.invalidate(this.name);
      return this;
    }
    tick(dt) {
      if (this.cur.until && this.app.clock > this.cur.until) { this.cur = { text: '', color: '', until: 0 }; this.app.invalidate(this.name); }
    }
    spec(vm) {
      const self = this;
      return h('div.ui-toast#toast', {
        attrs: { 'data-role': 'toast' },
        text: (ctx) => self.cur.text,
        class: (ctx) => (self.cur.until > 0 ? 'on' : ''),
        style: (ctx) => (self.cur.color ? { color: self.cur.color } : null)
      });
    }
  }

  /* ---------- 手持栏：Minecraft 式的一排物品格 ---------- */
  class Hotbar extends UI.Panel {
    constructor(copy, opts) {
      super(Object.assign({ name: 'hotbar', layer: 'hotbar', order: 20, live: false, open: true }, opts || {}));
      this.copy = copy; this.side = (opts && opts.side) || 0;
      this.box = (opts && opts.box) || 'hotbar';
    }
    /* 类别条（只有 P1）：全部 / 打击 / 建筑。
       *为什么挂在手持栏上*：它改的就是这五格，以前那枚"类别"挂在左下血条面板里，
       玩家在手持栏切卡、再到左下去确认，两个视线落点对不上（用户："分不同模式使用时跟背包对不上"）。
       条上的数字 = 手里+牌库+弃牌堆里这一类的张数，空位有解释（同类打光宁可空着）。 */
    /* 出牌组指示条：当前组 + 前后切换 + 自动开火状态。
       为什么不再把 8 个组全平铺：组从 2 个变成 8 个，全铺会占掉两行、把手持栏顶得很高；
       全表在背包左栏（那里有位置逐个数张数），HUD 只留"现在是哪一组、怎么换、在不在连发"。 */
    classbar(vm) {
      const C = this.copy, ch = UI.channel;
      const curOf = (v) => {
        const a = (v && v.classes) || [], k = (v && v.handClass) || 'all';
        for (let i = 0; i < a.length; i++) if (a[i].key === k) return { it: a[i], at: i, all: a };
        return { it: a[0] || { key: 'all', n: 0 }, at: 0, all: a };
      };
      const step = (dir) => () => {
        const c2 = curOf(vm), a = c2.all;
        if (!a.length) return;
        const next = a[((c2.at + dir) % a.length + a.length) % a.length];
        ch.request('ui.selectClass', { type: next.key, side: 0 });
      };
      const name = (ctx) => { const k = ((ctx.vm.classes || []).filter((x) => x.key === ((ctx.vm.handClass) || 'all'))[0] || {}).key || 'all'; return (C.classNames || {})[k] || k; };
      const count = (ctx) => { const it = (ctx.vm.classes || []).filter((x) => x.key === ((ctx.vm.handClass) || 'all'))[0]; return String((it && it.n) | 0); };
      return h('div.ui-classbar#classbar' + (this.side + 1), {
        attrs: { 'data-role': 'classbar' },
        children: [
          h('span.ui-classbar-k#ui-cls' + (this.side + 1), { text: C.chipClass || '' }),
          h('button.ui-classstep', { attrs: { type: 'button', 'data-dir': '-1', title: C.classTip || '' }, text: C.prev || '', on: { click: (ev) => { ev.preventDefault(); ev.stopPropagation(); step(-1)(); } } }),
          h('span.ui-classnow', { attrs: { 'data-role': 'classnow' }, children: [h('span', { text: (ctx) => name(ctx) }), h('b', { text: (ctx) => count(ctx) })] }),
          h('button.ui-classstep', { attrs: { type: 'button', 'data-dir': '1', title: C.classTip || '' }, text: C.next || '', on: { click: (ev) => { ev.preventDefault(); ev.stopPropagation(); step(1)(); } } }),
          h('span.ui-autochip#autoChip', {
            attrs: { 'data-role': 'auto', title: C.autoTip || '' },
            class: (ctx) => (ctx.vm.autoFire ? 'on' : ''),
            text: (ctx) => (ctx.vm.autoFire ? (C.autoOn || '') : (C.autoOff || ''))
          })
        ]
      });
    }
    spec(vm) {
      const C = this.copy, self = this;
      return h('div.ui-hotbar' + (this.side ? '.p2' : '') + '#' + (this.side ? 'hand2' : 'hand1'), {
        attrs: { 'data-role': 'hotbar', 'data-box': this.box, 'data-editable': '0', 'data-side': String(this.side) },
        children: [
          this.side ? null : this.classbar(vm),
          h('div.ui-hotslots', {
            attrs: { 'data-role': 'hotslots' },
            children: [],
            list: (ctx) => { const hs = ctx.vm.hands && ctx.vm.hands[self.side]; return hs || []; },
            keyOf: (it, i) => String(i),
            cell: (it, i, ctx) => W.Slot({
          box: self.box, idx: i, cls: 'ui-hotbar-slot',
          item: (c) => c.vm.hands && c.vm.hands[self.side] ? c.vm.hands[self.side][i] : null,
          sel: (c) => (c.vm.sel && c.vm.sel[self.side]) === i,
          deny: (c) => { const x = c.vm.hands[self.side][i]; return !!(x && x.meta && x.meta.deny); },
          color: (c) => { const x = c.vm.hands[self.side][i]; return x && x.meta ? x.meta.tone : null; },
          cost: (c) => { const x = c.vm.hands[self.side][i]; return x && x.meta && x.meta.cost != null ? String(x.meta.cost) : ''; },
          cd: (c) => { const x = c.vm.hands[self.side][i]; return x && x.meta && x.meta.cdText ? x.meta.cdText : ''; },
          cdFill: (c) => { const x = c.vm.hands[self.side][i]; return x && x.meta && x.meta.cdRatio ? x.meta.cdRatio : 0; },
          /* 手持栏也要说得出"我手上是第几张卡"：只给图章 + CD 的话，五格符号认不出 */
          name: (c) => { const x = c.vm.hands[self.side][i]; return x && x.meta ? x.meta.label : ''; },
          hint: (c) => String(i + 1),
          title: (c) => { const x = c.vm.hands[self.side][i]; return x && x.meta ? (x.meta.id + '｜' + x.meta.label + '\n' + (x.meta.detail || '')) : (C.emptySlot + ' ' + (i + 1)); }
            })
          })
        ].filter(Boolean)
      });
    }
  }

  /* ---------- 背包：图鉴 + 随身格 + 手持栏编辑行 + 详情栏 + 调试页 ---------- */
  class Inventory extends UI.Panel {
    constructor(copy, opts) {
      super({ name: 'inv', layer: 'panel', order: 50, pausing: true, closable: true, returnCursorOnClose: true });
      this.copy = copy;
      this.getSpec = (opts && opts.getSpec) || null;
      this.handlers = (opts && opts.handlers) || null;
    }
    onShow() {
      const el = document.getElementById('inv');
      if (el) el.classList.add('on');
      /* 面板要能用鼠标：把指针锁交还系统（net.js 的鼠标转向按 GW.pointerLocked 自己停） */
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      const lh = document.getElementById('lockHint'); if (lh) lh.classList.remove('on');
      const hud = document.getElementById('hud');
      if (hud) { this.prevOpacity = hud.style.opacity; hud.style.opacity = '0.28'; }
      if (UI.drag) UI.drag.setEnabled(true);
    }
    onHide() {
      const el = document.getElementById('inv');
      if (el) el.classList.remove('on');
      const hud = document.getElementById('hud');
      if (hud) hud.style.opacity = (this.prevOpacity == null) ? '1' : this.prevOpacity;
      this.prevOpacity = null;
      const q = document.getElementById('invQ');
      if (q && document.activeElement === q) q.blur();
      if (UI.drag) { UI.drag.returnCursor(['hand', 'tray']); UI.drag.setEnabled(false); UI.drag.clearHover(); }
    }
    /* 一个面板四块地：左边页签 + 搜索，中间手持栏 + 图鉴墙 + 随身格，右边详情栏。
       读的全是 vm（视图模型），写的动作全是意图；这里连一个中文字都没有。 */
    spec(vm) {
      const C = this.copy, self = this, ch = UI.channel;
      const tabOf = (ctx) => (ctx.vm.filters && ctx.vm.filters.tab) || C.defaultTab || 'cards';
      const notDebug = (ctx) => tabOf(ctx) !== 'debug';

      /* 页签（创造模式那种一竖排） */
      /* items 必须传**函数**：传数组会被冻在第一次渲染时的模型上（生存那排页签与类别页签
         第一次渲染时 match 还没灌进来，于是永远只剩「随身」一页、类别一组空着）。 */
      /* 页签 = BagProfile.pages（hand 由手持栏那排承担，不出页签）；catalog 在面板里叫 cards */
      const tabBar = W.Tabs({
        items: (ctx) => (ctx.vm.tabKeys || []).map((k) => {
          const key = k === 'catalog' ? 'cards' : k;
          return { key: key, label: (C.tabLabels && C.tabLabels[key]) || key };
        }),
        active: () => (vm.filters && vm.filters.tab) || C.defaultTab || 'cards',
        onPick: (k) => { vm.filters.tab = k; ch.bus.emit('ui:filter', { tab: k }); }
      });

      /* 搜索 + 计数 */
      const searchRow = h('div.ui-searchrow', {
        children: [
          W.Search({
            id: 'invQ', ref: 'search', placeholder: C.search,
            value: (ctx) => (ctx.vm.filters && ctx.vm.filters.q) || '',
            onInput: (v) => { vm.filters.q = v; ch.bus.emit('ui:filter', { q: v }); },
            onEscape: () => { vm.filters.q = ''; ch.bus.emit('ui:filter', { q: '' }); }
          }),
          h('div.ui-count#invCount', { text: (ctx) => {
            const tab = (ctx.vm.filters && ctx.vm.filters.tab) || '';
            const list = ctx.vm.catalog || [];
            /* 牌库/弃牌堆是聚合视图：条目数 ≠ 张数。两页各说各的话，不再混成一个 "6 / 7 项"。 */
            if (tab === 'deck' || tab === 'discard') {
              let cards = 0;
              for (let i = 0; i < list.length; i++) cards += (list[i] && list[i].count) || 1;
              return C.pileCount ? C.pileCount(cards, list.length) : '';
            }
            return C.count ? C.count(list.length, ctx.vm.catalogTotal || 0) : '';
          } })
        ]
      });

      /* 手持栏编辑行：背包里这一排可以拿起来、换位、扔出去 */
      const handRow = h('div.ui-block', { children: [h('div.ui-rail-h', { text: C.handLabel }), h('div.ui-handrow', {
        attrs: { 'data-box': 'hand', 'data-editable': '1', 'data-role': 'inv-hand', id: 'invHand' },
        children: [], list: (ctx) => new Array(5).fill(0), keyOf: (x, i) => String(i),
        cell: (x, i) => W.Slot({
          box: 'hand', idx: i, cls: 'ui-invhalf', iconSize: 30,
          item: (c) => (c.vm.hands && c.vm.hands[0]) ? c.vm.hands[0][i] : null,
          sel: (c) => (c.vm.sel && c.vm.sel[0]) === i,
          color: (c) => { const x = c.vm.hands[0][i]; return x && x.meta ? x.meta.tone : null; },
          hint: () => String(i + 1),
          name: (c) => { const x = c.vm.hands[0][i]; return x && x.meta ? x.meta.label : (C.emptySlot || ''); },
          title: (c) => { const x = c.vm.hands[0][i]; return x && x.meta ? (x.meta.id + '｜' + x.meta.label) : ''; }
        })
      })] });

      /* 元素 / 类型筛选片（只在卡牌页出现，方块页不需要） */
      const chips = h('div.ui-filters', {
        when: (ctx) => tabOf(ctx) === 'cards',
        children: [
          h('div.ui-chips#invEl', { list: (ctx) => elChips(ctx.vm), keyOf: (x) => x.key, cell: (x) => W.Btn({ label: x.label, active: () => vm.filters.el === x.key, onClick: () => { vm.filters.el = x.key; ch.bus.emit('ui:filter', { el: x.key }); } }) }),
          h('div.ui-chips#invTy', { list: (ctx) => tyChips(ctx.vm), keyOf: (x) => x.key, cell: (x) => W.Btn({ label: x.label, active: () => vm.filters.ty === x.key, onClick: () => { vm.filters.ty = x.key; ch.bus.emit('ui:filter', { ty: x.key }); } }) })
        ]
      });

      /* 图鉴墙：一格一个物品。点 = 放进选中格，拖 = 拿到光标上 */
      const boxOf = (ctx) => (ctx.vm.filters && ctx.vm.filters.tab === 'deck' ? 'deck' : (ctx.vm.filters && ctx.vm.filters.tab === 'discard' ? 'discard' : 'catalog'));
      const grid = h('div.ui-grid#invGrid', {
        attrs: { 'data-box': boxOf, 'data-editable': '0', 'data-role': 'catalog' },
        when: notDebug,
        children: [], list: (ctx) => ctx.vm.catalog || [], keyOf: (it) => it.kind + '/' + it.id,
        cell: (it, i) => W.Slot({
          box: boxOf, idx: i, cls: 'icard', iconSize: 48,
          item: (c) => (c.vm.catalog || [])[i] || null,
          color: () => (it.meta && it.meta.tone) || null,
          cost: () => (it.meta && it.meta.cost != null ? String(it.meta.cost) : ''),
          name: () => (it.meta ? it.meta.label : ''),
          title: () => (it.meta ? (it.meta.id + '｜' + it.meta.label + '\n' + (it.meta.detail || '')) : '')
        })
      });

      /* 随身格：UI 自己的快捷托盘，拖进拖出不惊动游戏 */
      const tray = h('div.ui-block', {
        /* 随身格只属于创造版（bags/profiles.js 的 caps.tray）：生存模式把它画出来，
           玩家就会以为"这是第二个背包"，而那里一件东西都留不住。 */
        when: (ctx) => !!(ctx.vm.bag && ctx.vm.bag.caps && ctx.vm.bag.caps.tray),
        children: [h('div.ui-rail-h', { text: C.trayLabel }), h('div.ui-tray', {
        attrs: { 'data-box': 'tray', 'data-editable': '1', 'data-role': 'tray' },
        children: [], list: (ctx) => (ctx.vm.tray || []), keyOf: (x, i) => String(i),
        cell: (x, i) => W.Slot({
          box: 'tray', idx: i, cls: 'ui-tray-slot', iconSize: 30,
          item: (c) => (c.vm.tray || [])[i] || null,
          color: () => { const x = (vm.tray || [])[i]; return x && x.meta ? x.meta.tone : null; },
          title: (c) => { const x = (c.vm.tray || [])[i]; return x && x.meta ? (x.meta.id + '｜' + x.meta.label) : (C.trayEmpty || ''); }
        })
      })] });

      /* 牌库 / 弃牌堆：只读镜像，看一眼不会被当成能改 */
      const piles = h('div.ui-piles', {
        children: [
          h('div.ui-pile#invDeck', { attrs: { 'data-box': 'deck', 'data-editable': '0' }, children: [
            h('span.ui-pile-label', { text: C.pileDeck }),
            h('span.ui-pile-num', { text: (ctx) => String((ctx.vm.players && ctx.vm.players[0] ? ctx.vm.players[0].deckN : 0) || 0) })
          ] }),
          /* 带 list 的容器由列表接管全部子节点，标签必须放在它外面（不然被 diff 掉） */
          h('div.ui-pile#invDiscard', { attrs: { 'data-box': 'discard', 'data-editable': '0' }, children: [
            h('span.ui-pile-label', { text: C.pileDiscard }),
            h('div.ui-pile-row', { list: (ctx) => (ctx.vm.discard || []), keyOf: (it) => it.kind + '/' + it.id + '/' + ((it.meta && it.meta.seq) || 0),
              cell: (it) => h('div.ui-pile-tile', { style: { '--ui-tone': (it.meta && it.meta.tone) || null }, title: () => (it.meta ? it.meta.label : '') }) })
          ] })
        ]
      });

      /* 详情栏（"卡页"）：图章井 + 名称 + 类型行 + 数值 kv + 说明 + 四个动作。
         旧版这里只有一个黑方块 + 四行小灰字，什么都不选时空着像坏了。 */
      const toneOf = (ctx) => { const it = selDetail(ctx.vm); return it && it.meta ? it.meta.tone : null; };
      const detail = h('aside.ui-detail', {
        class: (ctx) => (selDetail(ctx.vm) ? '' : 'empty'),
        children: [
          h('div.ui-rail-h', { text: C.detailHead }),
          h('canvas.ui-detail-icon', {
            style: (ctx) => { const tn = toneOf(ctx); return tn ? { '--ui-tone': tn } : null; },
            after: (el, ctx) => { const it = selDetail(ctx.vm); const k = it ? it.kind + '/' + it.id : ''; if (el.__key === k) return; el.__key = k; if (it) UI.Art.paint(el, it, { size: 96 }); else { el.width = 96; el.height = 96; } }
          }),
          h('div.ui-detail-name', { text: (ctx) => { const it = selDetail(ctx.vm); return it && it.meta ? it.meta.label : (C.detailNone || ''); } }),
          h('div.ui-detail-meta', { text: (ctx) => { const it = selDetail(ctx.vm); return it && it.meta ? (it.meta.kindLine || '') : ''; } }),
          /* 这张牌此刻在哪一格容器里：牌库 / 弃牌堆 / 手持栏 / 图鉴 / 随身格。
             同一个 canvas 上两张同 id 的卡看起来一样，不写清位置，玩家分不清"这张能不能打"。 */
          h('div.ui-detail-loc#invLoc', {
            text: (ctx) => {
              const k = ctx.vm.detailBox;
              if (!k) return '';
              const L = C.loc || {};
              return L[k] || '';
            },
            when: (ctx) => !!ctx.vm.detailBox
          }),
          h('div.ui-kv.ui-detail-kv', {
            list: (ctx) => {
              const it = selDetail(ctx.vm); if (!it || !it.meta) return [];
              const rows = [];
              if (it.meta.cost != null) rows.push([C.kvCost, String(it.meta.cost)]);
              if (it.meta.cdText) rows.push([C.kvCd, it.meta.cdText]);
              if (it.count > 1) rows.push([C.kvStack, String(it.count)]);
              return rows;
            },
            keyOf: (r) => String(r[0]),
            cell: (r) => h('div.ui-kv-row', { children: [h('span', { text: r[0] }), h('b', { text: r[1] })] })
          }),
          h('div.ui-detail-text', { text: (ctx) => { const it = selDetail(ctx.vm); return it && it.meta ? (it.meta.detail || '') : ''; } }),
          h('div.ui-detail-btns', {
            /* 四个按钮的可做/不可做由**这一局的背包能力**决定（bags/profiles.js 的 caps），
               不由按钮自己猜：生存模式没有图鉴，所以"放进手持栏"是灰的（以前它亮着，
               点下去只回一句"创造模式才能取卡"——玩家看到的就是"按钮全没用"）。
               灰色的按钮仍带一句 title 说明为什么，不许静默。 */
            children: [
              /* 主体顺序：详情栏那一张 → 手持栏当前选中格那一张 → 都没有就说清楚为什么（不许静默） */
              W.Btn({ label: C.btnToSlot, attrs: { title: (ctx) => canGive(ctx) ? '' : ((C.why || {}).give || '') },
                disabled: (ctx) => !canGive(ctx),
                onClick: () => {
                  const it = selDetail(vm);
                  /* 牌库那张（2026-10-18 用户："从背包里的卡牌往物品栏上面切换"）：
                     生存模式也能换进手持栏——换一张、被顶下来的原位回牌库，不造牌。
                     目标格 = 手持栏当前选中格（玩家在背包里点一下就能选）。 */
                  if (vm.detailBox === 'deck' && it) { ch.request('ui.dealFromDeck', { id: it.id, slot: vm.sel[0], side: 0 }); return; }
                  if (!capsOf(vm).catalog) { sayWhy('give'); return; }
                  if (!it || !isSourceBox(vm)) { sayWhy('give'); return; }
                  ch.request('ui.give', { item: it, box: 'hand', slot: vm.sel[0], side: 0, mode: 'set' });
                } }),
              W.Btn({ label: C.btnCast, attrs: { title: (ctx) => canCast(ctx) ? '' : ((C.why || {}).cast || '') },
                disabled: (ctx) => !canCast(ctx),
                onClick: () => {
                  /* 图鉴/货架（拿着就能用的复制品）：取下来立刻打出；
                     手持栏里那张：打**它所在的那一格**（不是"当前选中格"——玩家看的是这张）；
                     没有主体（刚打开、什么都没悬停）：打手持栏正选的那一格。 */
                  const pk = vm.detailBox, it = selDetail(vm);
                  if (it && capsOf(vm).catalog && (pk === 'catalog' || pk === 'tray')) { ch.request('ui.give', { item: it, box: 'hand', slot: vm.sel[0], side: 0, mode: 'cast' }); return; }
                  if (pk === 'hand' && handItem(vm, 0)) { ch.request('ui.useSlot', { box: 'hand', slot: slotOfDetail(vm), side: 0 }); return; }
                  if (!pk && handItem(vm, 0)) { ch.request('ui.useSlot', { box: 'hand', slot: vm.sel[0], side: 0 }); return; }
                  sayWhy('cast');
                } }),
              W.Btn({ label: C.btnTray, attrs: { title: (ctx) => canTray(ctx) ? '' : ((C.why || {}).tray || '') },
                disabled: (ctx) => !canTray(ctx),
                onClick: () => { if (!capsOf(vm).tray) { sayWhy('tray'); return; } const it = detailOrSlot(vm); if (!it) { sayNoItem(); return; } ch.bus.emit('ui:tray-add', { item: it }); } }),
              W.Btn({ label: C.btnDrop, attrs: { title: (ctx) => canDrop(ctx) ? '' : ((C.why || {}).drop || '') },
                disabled: (ctx) => !canDrop(ctx),
                onClick: () => { if (!handItem(vm, 0)) { sayNoItem(); return; } ch.request('ui.discard', { box: 'hand', slot: slotOfDetail(vm), side: 0 }); } })
            ]
          }),
          h('div.ui-detail-tip', { text: C.dragHint })
        ]
      });

      /* 调试页：内容全由 GW.Creative.spec() 那份数据决定 */
      const debug = h('div.ui-debug', {
        when: (ctx) => tabOf(ctx) === 'debug',
        children: [
          h('div.ui-rail-h', { attrs: { 'data-t': 'options' }, text: C.options }),
          h('div.ui-toggles#invToggles', { list: () => (vm.debug ? vm.debug.toggles : []), keyOf: (t) => t.key, cell: (t) => W.Toggle({ labelFor: (x) => (C.toggles || {})[x.key] || x.key, value: t.value, onChange: (v) => ch.request('ui.debugToggle', { key: t.key, value: v }) }) }),
          h('div.ui-segs', { list: () => (vm.debug ? vm.debug.segments : []), keyOf: (s) => s.key, cell: (s) => W.Segmented({ label: ((C.segments || {})[s.key] || {}).label || s.key, values: s.values, valueFor: (c) => (c.vm.debug ? c.vm.debug[s.key] : s.value), formatFor: (v) => fmtSeg(C, s.key, v), onPick: (v) => ch.request('ui.debugSegment', { key: s.key, value: v }) }) }),
          h('div.ui-rail-h', { attrs: { 'data-t': 'quick' }, text: C.quick }),
          h('div.ui-btns#invQuick', { list: () => (vm.debug ? vm.debug.actions : []), keyOf: (a) => a.key, cell: (a) => W.Btn({ label: (C.actions || {})[a.key] || a.key, onClick: () => ch.request('ui.debugAction', { key: a.key }) }) })
        ]
      });

      return h('div.ui-bag', {
        attrs: { 'data-role': 'bag' },
        children: [
          h('div.ui-bag-box', {
            attrs: { 'data-drop': 'keep' },
            children: [
              h('div.ui-head', {
                children: [h('span.ui-head-t', { text: (ctx) => (ctx.vm.creative ? (C.headDebug || C.head) : C.head) }), h('span.ui-head-tail', { text: C.headHint })]
              }),
              h('div.ui-bag-body', {
                children: [
                  h('aside.ui-rail', {
          children: [tabBar,
            /* 类别：切到哪一类，手持栏就只出这一类（同类打光宁可空着，绝不掺别类） */
            h('div.ui-block', {
              children: [
                h('div.ui-rail-h', { text: C.chipClass || '' }),
                /* 挂个稳定 id：断言只在自己这一组里找，别抓到图鉴那排同名的元素筛选片 */
                h('div#invClasses', {
                  children: [W.Chips({
                      /* 同上：函数版才跟着模型走 */
                    items: (ctx) => (ctx.vm.classes || []).map((c) => ({
                      key: c.key,
                      label: ((C.categories && C.categories[c.key]) || c.key) + (c.n ? ' ' + c.n : ''),
                      active: ctx.vm.handClass === c.key
                    })),
                    onPick: (it) => { ch.request('ui.selectClass', { type: it.key, side: 0 }); }
                  })]
                }),
                h('div.ui-hint', { when: (ctx) => !!ctx.vm.creative === false, text: (C.categories && C.categories.hint) || '' })
              ]
            }),
            searchRow, chips, piles, h('div.ui-hint#invHint', {
              attrs: { 'data-t': 'hint' },
              /* 方块页没有"点卡=放进手持栏"这条路（放进世界还没接），提示要按页换，
                 不能拿卡牌页的六条手势糊在一个点不动的列表下面。 */
              text: (ctx) => (tabOf(ctx) === 'blocks' ? (C.blockHint || C.hint) : C.hint)
            })]
        }),
                  h('section.ui-main', { children: [handRow, grid, debug, tray] }),
                  detail
                ]
              })
            ]
          })
        ]
      });

      /* 按钮的"当前那张"：详情栏优先，没有就用玩家正选中的那一格（不然四个按钮会静默不响应） */
  function detailOrSlot(v) { const it = selDetail(v); if (it) return it; return handItem(v, 0); }
  function handItem(v, side) {
    const hs = (v.hands && v.hands[side]) || [];
    const s = (v.sel && v.sel[side]) | 0;
    return hs[s] || null;
  }
  function sayNoItem() {
    const ch = UI.channel; if (!ch) return;
    ch.bus.emit('ui:toast', { key: 'no-item' });
    if (UI.bag && UI.bag.wantSfx) UI.bag.wantSfx('deny');
  }
  /* 按钮门禁：能不能"往手持栏放 / 收进随身格"只看这一局的背包能力（profile.caps）。
     视图层不判创造模式本身——那是 bags/profiles.js 的事，面板只读 caps。 */
  function capsOf(v) { return (v && v.bag && v.bag.caps) || {}; }
  /* 卡页的主体 = 鼠标正停在的那张卡，它在哪个容器决定"能对它做什么"：
     hand = 现在就打得出；catalog/tray = 创造模式的复制品（取下来就能打）；
     deck/discard = 只看（牌库是抽牌堆、弃牌堆要洗回去才再抽到）。 */
  function isSourceBox(v) { return v && (v.detailBox === 'catalog' || v.detailBox === 'tray'); }
  function isHandBox(v) { return v && v.detailBox === 'hand'; }
  function slotOfDetail(v) {
    return (v && v.detailBox === 'hand' && v.detailSlot >= 0) ? v.detailSlot : ((v.sel && v.sel[0]) | 0);
  }
  /* 图鉴/取卡货架（创造）能取卡；生存模式下**牌库那张**也能放进手持栏（换一张，见 items.js 的 deal-from-deck）。 */
  function canGive(ctx) {
    const v = ctx.vm;
    if (capsOf(v).catalog && isSourceBox(v)) return true;
    return v.detailBox === 'deck' && !!selDetail(v);
  }
  function canTray(ctx) { return !!capsOf(ctx.vm).tray && (isHandBox(ctx.vm) || isSourceBox(ctx.vm) || !ctx.vm.detailBox); }
  function canCast(ctx) {
    const v = ctx.vm;
    if (!v.detailBox) return !!handItem(v, 0);
    if (isSourceBox(v)) return !!capsOf(v).catalog;
    if (isHandBox(v)) return !!handItem(v, 0);
    return false;                                  // 牌库/弃牌堆里的那张：抽到手才能打
  }
  function canDrop(ctx) {
    const v = ctx.vm;
    if (!handItem(v, 0)) return false;
    return !v.detailBox || isHandBox(v);           // 别把"牌库那张"读成"扔掉我选中的格"
  }
  function sayWhy(k) {
    const ch = UI.channel; if (!ch) return;
    ch.bus.emit('ui:toast', { key: 'why-' + k });
    if (UI.bag && UI.bag.wantSfx) UI.bag.wantSfx('deny');
  }
  function selDetail(v) {
        const key = v.detailKey;
        if (!key) return null;
        const pool = (v.catalog || []).concat(v.tray || [], (v.hands && v.hands[0]) || [], v.discard || []);
        for (const it of pool) if (it && it.kind + '/' + it.id === key) return it;
        return null;
      }
      function elChips(v) {
        const out = [{ key: 'all', label: C.allElements }];
        (v.elementList || []).forEach((e) => out.push({ key: e.key, label: e.cn }));
        return out;
      }
      function tyChips(v) {
        const out = [{ key: 'all', label: C.allTypes }];
        (v.typeList || []).forEach((t) => out.push({ key: t.key, label: t.cn }));
        return out;
      }
      function fmtSeg(Cc, key, v) {
        const d = Cc.segments && Cc.segments[key];
        if (!d) return String(v);
        if (typeof d.format === 'function') return d.format(v);
        return (d.format && d.format[v]) || String(v);
      }
    }
  }

  /* ---------- 通用选择面板：三选一以后复用它（GAMEPLAY §7.3 第 3 条禁止另写一套） ---------- */
  class Choice extends UI.Panel {
    constructor(copy) { super({ name: 'choice', layer: 'choice', order: 60, pausing: true, closable: true }); this.copy = copy; this.state = null; }
    openWith(o) { this.state = o; this.show(); return this; }
    close() { this.state = null; this.hide(); return this; }
    onShow() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }
    spec(vm) {
      const self = this, C = this.copy;
      return h('div.ui-choice', {
        attrs: { 'data-role': 'choice' },
        when: () => !!self.state,
        children: [
          h('div.ui-choice-box', {
            children: [
              h('div.ui-head', {
                children: [h('span.ui-head-t', { text: C.head || '' }), h('span.ui-head-tail', { text: C.headTail || '' })]
              }),
              h('div.ui-choice-title', { text: () => (self.state && self.state.title) || C.title || '' }),
              h('div.ui-choice-hint', { text: () => (self.state && self.state.hint) || C.hint || '' }),
              W.List({
                items: () => (self.state && self.state.items) || [],
                keyOf: (it) => String(it.key != null ? it.key : it.id),
                title: (it) => it.label || (it.meta && it.meta.label) || '',
                sub: (it) => it.sub || (it.meta && it.meta.kindLine) || '',
                detail: (it) => it.detail || (it.meta && it.meta.detail) || '',
                trailing: (it) => (it.tail != null ? it.tail : (it.meta && it.meta.cost != null ? String(it.meta.cost) : '')),
                onPick: (it) => { const s = self.state; self.close(); if (s && s.onPick) s.onPick(it); }
              }),
              h('div.ui-choice-foot', { children: [W.Btn({ label: C.skip || '', onClick: () => { const s = self.state; self.close(); if (s && s.onSkip) s.onSkip(); } })] })
            ]
          })
        ]
      });
    }
  }

  /* ---------- 主菜单 ---------- */
  class Menu extends UI.Panel {
    constructor(copy) { super({ name: 'menu', layer: 'menu', order: 70 }); this.copy = copy; this.handlers = null; }
    onShow() { const el = document.getElementById('menu'); if (el) el.classList.remove('hidden'); const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '0'; }
    onHide() { const el = document.getElementById('menu'); if (el) el.classList.add('hidden'); const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '1'; }
    spec(vm) {
      const C = this.copy, self = this, ch = UI.channel;
      /* 菜单与选关共用**同一份**视图状态 vm.level（单一真源）：attrKey 就是 level 里的字段名，
         id 只是给回归脚本认的锚点。就地改字段，别中途换对象（换过一次，表单就读着旧引用不动）。 */
      const rowOf = (id, items, attrKey, pick) => h('div.ui-row#' + id, {
        list: () => items, keyOf: (x) => String(x.key),
        cell: (x) => W.Btn({ label: x.label, active: (ctx) => !!ctx.vm.level && ctx.vm.level[attrKey] === x.key, title: x.tip, attrs: {}, onClick: (ev) => pick(x.key) })
      });
      /* 分区卡片：一个分区 = 一个带小标题的盒子（旧版是"正中一列按钮 + 通栏小标题"，网页表单味就是这么来的） */
      const sect = (title, kids) => h('div.ui-sect', { children: [h('h2.ui-h2', { text: title })].concat(kids) });
      return h('div.ui-menu-box', {
        attrs: { 'data-role': 'menu' },
        children: [
          /* 左栏＝品牌 + 主行动：一进菜单眼睛先落在名字与"进入世界"上，不用往下滚表单 */
          h('div.ui-menu-brand', {
            children: [
              h('h1.ui-title', { text: C.title }),
              h('div.ui-sub', { text: C.sub }),
              h('div.ui-menu-hero'),
              h('div.ui-note', { text: C.note }),
              h('div.ui-menu-badge', { text: C.badge || '' }),
              h('div.ui-menu-tips', {
                list: () => (C.tips || []), keyOf: (t, i) => String(i),
                cell: (t) => h('div', { text: '· ' + t })
              }),
              h('div.ui-result-acts', {
                children: [
                  /* 菜单只留"招牌 + 开始 + 帮助 + 存档"（docs/LEVELS.md §0）：
                     开始 = 去选关，不在这里开局；开局是选关面板的 ui.levelStart。 */
                  W.Btn({ id: 'btnStart', cls: 'pri', label: C.btnStart, onClick: () => ch.request('ui.menuAction', { key: 'level' }) }),
                  W.Btn({ id: 'btnSettings', label: C.btnSettings, onClick: () => ch.request('ui.menuAction', { key: 'settings' }) }),
                  W.Btn({ id: 'btnHelp', label: C.btnHelp, onClick: () => ch.request('ui.menuAction', { key: 'help' }) })
                ]
              }),
              h('div.ui-kv#spec', {
                list: () => {
                  var rows = (C.spec || []).slice();
                  if (G.StatsStore && G.StatsStore.aggregate) {
                    var a = G.StatsStore.aggregate();
                    if (a && a.games > 0) rows.push([C.hist, C.histVal(a.games, a.winRate, a.avgDuration)]);
                  }
                  return rows;
                },
                keyOf: (r) => String(r[0]), cell: (r) => h('div.ui-kv-row', { children: [h('span', { text: r[0] }), h('span.ui-kv-v', { text: r[1] })] })
              })
            ]
          }),
          /* 右栏＝配置：模式 / 种子 / 卡组 / 调试 / 存档，一路往下按顺序过一遍就是焦点顺序 */
          h('div.ui-menu-form', {
            children: [
              /* 联网在菜单里不再"点了没反应"（2026-10-18 用户反馈）：点它 = 把模式选成 net 并进选关，
                 服务器/房间码/角色三字段与三步说明都在那一页——菜单不重复放一份表单。 */
              sect(C.hMode, [rowOf('modeRow', C.modes.map((m) => ({ key: m.key, label: m.label, tip: m.tip })), 'mode', (k) => { if (k === 'net') { ch.request('ui.menuPick', { field: 'mode', value: 'net' }); ch.request('ui.menuAction', { key: 'level' }); return; } ch.request('ui.menuPick', { field: 'mode', value: k }); })]),
              sect(C.hSeed, [h('div.ui-row', { children: [h('input.ui-input#seedInput', { props: { value: (ctx) => { const t = ctx.vm.level && ctx.vm.level.seed; return t != null ? t : ''; } }, attrs: { type: 'text', placeholder: C.seedPlaceholder, autocomplete: 'off', inputmode: 'numeric' }, on: { input: (ev, ctx) => { if (ctx.vm.level) ctx.vm.level.seed = ev.target.value; }, keydown: (ev) => ev.stopPropagation() } }), W.Btn({ id: 'seedRand', label: C.seedRand, onClick: () => { if (vm.level) vm.level.seed = String(Math.floor(Math.random() * 999999)); self.app && self.app.invalidate('menu'); self.app && self.app.invalidate('level'); } })] })]),
              sect(C.hDeck, [rowOf('deckRow', C.decks.map((d) => ({ key: d.key, label: d.label })), 'deck', (k) => { ch.request('ui.menuPick', { field: 'deck', value: k }); })]),
              sect(C.hMap, [rowOf('mapRow', (C.maps || []).map((m) => ({ key: m.key, label: m.label })), 'map', (k) => { ch.request('ui.menuPick', { field: 'map', value: k }); })]),
              /* 进局开启创造模式的勾选框以前是**画的**：没有 change 监听，vm 永远是 false（"勾了没反应"那条老毛病） */
              sect(C.hCreative, [h('label.ui-check', { children: [h('input#creativeOn', { attrs: { type: 'checkbox' }, props: { checked: (ctx) => !!(ctx.vm.level && ctx.vm.level.creative) }, on: { change: (ev, ctx) => { if (ctx.vm.level) ctx.vm.level.creative = !!ev.target.checked; } } }), h('span', { text: C.creativeLabel })] }), h('div.ui-note', { text: C.creativeNote })]),
              sect(C.hSave, [
                h('textarea.ui-textarea#saveBox', { attrs: { placeholder: C.savePlaceholder, spellcheck: 'false' }, props: { value: (ctx) => (vm.saveText != null ? vm.saveText : '') }, on: { keydown: (ev) => ev.stopPropagation() } }),
                h('div.ui-row', { children: [W.Btn({ id: 'btnExport', label: C.btnExport, onClick: () => ch.request('ui.menuAction', { key: 'export' }) }), W.Btn({ id: 'btnImport', label: C.btnImport, onClick: () => ch.request('ui.menuAction', { key: 'import' }) }), W.Btn({ id: 'btnLocal', label: C.btnLocal, onClick: () => ch.request('ui.menuAction', { key: 'local' }) })] })
              ])
            ]
          })
        ]
      });
    }
    start() {
      /* 首次进入世界是一次真实用户手势：音频在这里解锁（G.Audio 自己懒建 AudioContext） */
      if (window.GW && window.GW.Audio && window.GW.Audio.resume) window.GW.Audio.resume();
      const cfg = this.config();
      if (this.handlers && this.handlers.start) this.handlers.start(cfg);
    }
    /* cfg 的唯一形状（docs/LEVELS.md §2）：map / rule / mode / deck / seed / creative。
       默认值取数据层的两个 DEFAULT，不在这儿写死图名；rule 由 src/app/rule-presets.js 展开成 Match opts。 */
    config(keepSeed) {
      const C = this.copy;
      const vm = this.app.model;
      const L = vm.level || {};
      let s = String(L.seed || '').trim();
      if (!s || !keepSeed) { s = s || String(Math.floor(Math.random() * 999999)); if (vm.level) vm.level.seed = s; }
      return {
        mode: L.mode || C.modes[0].key, deck: L.deck || C.decks[0].key,
        rule: L.rule || (G.RULE_DEFAULT || 'ranked'),
        map: { id: L.map || (G.MAP_DEFAULT || 'duel-64') },
        seed: s, creative: !!L.creative
      };
    }
  }

  /* ---------- 选关（docs/LEVELS.md §4）：左地图 / 中规则 / 右模式+种子+卡组+开始 ----------
     与菜单同一套纪律：条目从 copy（H.TEXT.level 与数据层合成的纯字段）来，本面板一个中文都不写；
     当前选中项读**一份**视图状态 vm.level（就地改字段，绝不换对象——面板闭包抓的是同一个引用）；
     动作只发意图 ui.levelPick / ui.levelStart / ui.levelBack，没人接就是 no-handler，不假装成功。
     面板类交互三条硬要求都在这里：onShow 交还指针并收起锁鼠标提示；pausing 由场景表给（level 场景 pausing:true）；
     开没开是视图层状态（H.showLevel / H.hideLevel），主循环的暂停判据问 hud 不问装配层。 */
  class LevelSelect extends UI.Panel {
    constructor(copy) { super({ name: 'level', layer: 'level', order: 69, closable: true }); this.copy = copy; }
    onShow() {
      const el = document.getElementById('level'); if (el) el.classList.remove('hidden');
      const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '0';
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      const lh = document.getElementById('lockHint'); if (lh) lh.classList.remove('on');
    }
    onHide() {
      const el = document.getElementById('level'); if (el) el.classList.add('hidden');
      const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '1';
      const q = document.getElementById('levelSeedInput');
      if (q && document.activeElement === q) q.blur();
    }
    start() {
      /* 开始对局是这一次会话里的真实用户手势：音频在这里解锁（与旧菜单的「进入世界」同一条） */
      if (window.GW && window.GW.Audio && window.GW.Audio.resume) window.GW.Audio.resume();
      const ch = UI.channel; if (!ch) return;
      const r = ch.request('ui.levelStart', {});
      if (r && r.ok === false && r.reason) ch.bus.emit('ui:notify', { key: 'deny', payload: { reason: r.reason, intent: 'ui.levelStart' } });
    }
    spec(vm) {
      const C = this.copy, self = this, ch = UI.channel;
      const sel = (ctx) => (ctx.vm.level || {});
      const sync = () => { self.app && self.app.invalidate('level'); };
      /* 选中 net 不再 toast「未启用」（N1/N2 已把链路跑通，docs/NET.md §9.5）：
         写了状态就长出下面那块 .ui-level-net。真正的拒绝口径只剩一条——
         服务器一格都没填时由装配层的 ui.levelStart 说 net-offline。 */
      const pick = (field, value) => {
        ch.request('ui.levelPick', { field: field, value: value });
        /* 选中联网把三字段那一块滚进视野（用户反馈：选了联网却不知道下面还有要填的）。
           只滚不展开/不改状态，字段的显隐仍由 when 闸与 vm.level 决定。 */
        if (field === 'mode' && value === 'net') {
          setTimeout(function () {
            const b = document.getElementById('levelNet');
            if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
          }, 0);
        }
      };
      /* when 可选：联网时「你的卡组」那一栏不出现（牌库改成开局前的 loadout 里选，这一栏对联网是废弃选项）。 */
      const col = (id, title, kids, when) => h('section.ui-level-col#' + id, { when: when, children: [h('h2.ui-h2', { text: title })].concat(kids) });
      /* 同一栏里再分的小节（玩法 / 规则 / 胜分共用「玩法」这一栏）：when 闸走 ui-hide，
         与联网那三字段同一套写法——视图不判断"这一局该怎么打"，只按选中的 key 决定画不画。 */
      const part = (id, title, kids, when) => h('section.ui-level-col#' + id, { when: when, children: [h('h2.ui-h2', { text: title })].concat(kids) });
      const isLode = (ctx) => { const g = sel(ctx).game; return g === undefined || g === null || g === '' || g === 'lode'; };
      /* 玩法与胜分那两排条目：选中态比 String(...)（gameTarget 存的是数字 5 / 10 / 0，不限=0）。
         field 一律写全（data-field 是量具与键盘流的锚点），值走 ui.levelPick 交装配层——视图不直接写状态。 */
      const pickCard = (o) => h('div.ui-level-card', {
        attrs: { role: 'button', tabindex: '0', 'data-field': o.field, 'data-key': String(o.key) },
        class: (ctx) => (String(sel(ctx)[o.field]) === String(o.key) ? 'on' : ''),
        on: {
          click: (ev) => { ev.preventDefault(); pick(o.field, o.value); },
          keydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(o.field, o.value); } }
        },
        children: [
          h('div.ui-level-card-top', {
            children: [
              h('span.ui-level-name', { text: o.name }),
              h('span.ui-level-tag.rec', { text: o.rec || '', when: () => !!o.rec }),
              h('span.ui-level-tag', { text: o.tag || '', when: () => !!o.tag })
            ]
          }),
          h('div.ui-level-meta', { text: o.meta || '' }),
          h('div.ui-level-note', { text: o.note || '' })
        ]
      });
      const card = (field, it) => h('div.ui-level-card', {
        attrs: { role: 'button', tabindex: '0', 'data-field': field, 'data-key': String(it.key) },
        class: (ctx) => (sel(ctx)[field] === it.key ? 'on' : ''),
        on: {
          click: (ev) => { ev.preventDefault(); pick(field, it.key); },
          keydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(field, it.key); } }
        },
        children: [
          h('div.ui-level-card-top', {
            children: [
              h('span.ui-level-name', { text: it.name }),
              h('span.ui-level-tag.rec', { text: it.rec || '', when: () => !!it.rec }),
              h('span.ui-level-tag', { text: it.tag || '', when: () => !!it.tag })
            ]
          }),
          h('div.ui-level-meta', { text: it.meta || '' }),
          h('div.ui-level-note', { text: it.note || '' })
        ]
      });
      return h('div.ui-level-box', {
        attrs: { 'data-role': 'level' },
        children: [
          h('div.ui-level-head', { children: [h('h1.ui-title', { text: C.title }), h('div.ui-sub', { text: C.sub })] }),
          h('div.ui-level-cols', {
            children: [
              col('levelMaps', C.hMap, (C.maps || []).map((m) => card('map', m))),
              /* 第二栏＝玩法（docs/MODES.md §6 的两个轴：玩法 × 规则）：两张卡来自 G.GAME_MODES，
                 中文与一句话在 H.TEXT.game（levelCopy 现合成 C.games）；选中 lode 时下面接「规则」三条，
                 选中 deathmatch 时换成「胜分」三档（5 杀 / 10 杀 / 不限，不限=0 由 gameModeFor 解释）。
                 规则与胜分互斥出现是**视图层**的排布，权威层不认识"栏"这个概念。 */
              h('section.ui-level-col#levelGames', {
                children: [h('h2.ui-h2', { text: C.hGame })]
                  .concat((C.games || []).map((g) => pickCard({ field: 'game', key: g.key, value: g.key, name: g.name, meta: g.meta, note: g.note, rec: g.rec, tag: g.tag })))
                  .concat([
                    part('levelRules', C.hRule, (C.rules || []).map((r) => card('rule', r)), isLode),
                    part('levelGameTarget', C.hGameTarget, (C.gameTargets || []).map((t) => pickCard({ field: 'gameTarget', key: t.value, value: t.value, name: t.label, meta: t.meta, note: t.note, rec: t.rec })), (ctx) => !isLode(ctx))
                  ])
              }),
              h('aside.ui-level-side', {
                children: [
                  col('levelModes', C.hMode, (C.modes || []).map((m) => W.Btn({ label: m.label, title: m.tip, key: m.key, field: 'mode', active: (ctx) => sel(ctx).mode === m.key, onClick: () => pick('mode', m.key) }))),
                  /* 联机三字段（docs/NET.md §9.5）：只在选中「联网 PVP」时出现（when 闸）。
                     三个字段的修改一律走 ui.levelPick —— 视图不直接写状态，理由与种子框不同：
                     这三项会被装配层拼进 cfg.net 真拿去连服务器，静默写脏等于连错机器。 */
                  h('div.ui-level-net#levelNet', {
                    when: (ctx) => sel(ctx).mode === 'net',
                    children: [
                      h('h2.ui-h2', { text: C.hNet }),
                      /* 三步说明放字段上面：先讲清"要跑什么、填什么、点完会去哪"，再让人填表 */
                      h('div.ui-level-net-help', {
                        children: [
                          h('div.ui-level-net-help-t', { text: C.netHelpTitle }),
                          h('div.ui-level-net-help-list', {
                            list: () => ((C.netSteps || []).slice()),
                            keyOf: (s, i) => String(i),
                            cell: (s) => h('div.ui-level-net-step', { text: s })
                          })
                        ]
                      }),
                      h('div.ui-row', {
                        children: [
                          h('span.ui-level-net-k', { text: C.netRoomLabel }),
                          h('input.ui-input#levelNetRoom', {
                            props: { value: (ctx) => { const t = sel(ctx).netRoom; return t != null ? t : ''; } },
                            attrs: { type: 'text', placeholder: C.netRoomPlaceholder, autocomplete: 'off', spellcheck: 'false' },
                            on: { input: (ev, ctx) => { ch.request('ui.levelPick', { field: 'netRoom', value: ev.target.value }); }, keydown: (ev) => ev.stopPropagation() }
                          })
                        ]
                      }),
                      h('div.ui-row', {
                        children: [
                          h('span.ui-level-net-k', { text: C.netOfferLabel }),
                          h('textarea.ui-textarea#levelNetOffer', {
                            attrs: { rows: '3', placeholder: C.netOfferPlaceholder, spellcheck: 'false' },
                            props: { value: (ctx) => { const t = sel(ctx).netOffer; return t != null ? t : ''; } },
                            on: { input: (ev, ctx) => { ch.request('ui.levelPick', { field: 'netOffer', value: ev.target.value }); }, keydown: (ev) => ev.stopPropagation() }
                          })
                        ]
                      }),
                      h('div.ui-row', {
                        children: [
                          h('span.ui-level-net-k', { text: C.netAnswerLabel }),
                          h('textarea.ui-textarea#levelNetAnswer', {
                            attrs: { rows: '3', placeholder: C.netAnswerPlaceholder, spellcheck: 'false' },
                            props: { value: (ctx) => { const t = sel(ctx).netAnswer; return t != null ? t : ''; } },
                            on: { input: (ev, ctx) => { ch.request('ui.levelPick', { field: 'netAnswer', value: ev.target.value }); }, keydown: (ev) => ev.stopPropagation() }
                          })
                        ]
                      }),
                      h('div.ui-row', {
                        children: [
                          h('span.ui-level-net-k', { text: C.netRoleLabel }),
                          W.Btn({ label: C.netHost, key: 'host', field: 'netRole', active: (ctx) => sel(ctx).netRole === 'host', onClick: () => pick('netRole', 'host') }),
                          W.Btn({ label: C.netGuest, key: 'guest', field: 'netRole', active: (ctx) => sel(ctx).netRole === 'guest', onClick: () => pick('netRole', 'guest') })
                        ]
                      }),
                      /* 联网的「开始对局」就放在三字段下面（2026-10-18 用户反馈：填完不知道去哪开始；
                         底部那个主按钮在长列表末尾，第一次进来的人根本看不到）。两个按钮同一个意图。 */
                      h('div.ui-level-net-acts', {
                        children: [
                          W.Btn({ id: 'btnLevelStartNet', cls: 'pri', label: (C.btnNetStart || C.btnStart), onClick: () => self.start() }),
                          W.Btn({ id: 'btnNetAccept', label: C.netAccept, onClick: () => ch.request('ui.netAcceptAnswer', { answer: (sel({ vm: vm }) || {}).netAnswer || '' }) })
                        ]
                      }),
                      h('div.ui-level-net-note', { text: (ctx) => { const k = (sel(ctx) || {}).netStatus; return k ? ((C.netStatusNames || {})[k] || k) : ''; } }),
                      h('div.ui-level-net-note', { text: C.netNote })
                    ]
                  }),
                  col('levelSeed', C.hSeed, [h('div.ui-row', {
                    children: [
                      h('input.ui-input#levelSeedInput', {
                        props: { value: (ctx) => { const t = sel(ctx).seed; return t != null ? t : ''; } },
                        attrs: { type: 'text', placeholder: C.seedPlaceholder, autocomplete: 'off', inputmode: 'numeric' },
                        on: { input: (ev, ctx) => { if (ctx.vm.level) ctx.vm.level.seed = ev.target.value; }, keydown: (ev) => ev.stopPropagation() }
                      }),
                      W.Btn({ id: 'levelSeedRand', label: C.seedRand, onClick: () => { if (vm.level) vm.level.seed = String(Math.floor(Math.random() * 999999)); sync(); } })
                    ]
                  })]),
                  /* 卡组七个按钮排成两列：一列竖排要 7 行（≈308px），1280×720 那一档会把
                     「开始对局」推到视口外（实测 top=772 > 720，面板虽能滚，但主行动看不见）。
                     两列省掉 3 行 ≈130px，主按钮回到首屏；窄列仍装得下六个字。 */
                  col('levelDecks', C.hDeck, [h('div.ui-level-decks', {
                    children: (C.decks || []).map((d) => W.Btn({ label: d.label, active: (ctx) => sel(ctx).deck === d.key, onClick: () => pick('deck', d.key) }))
                  })], (ctx) => sel(ctx).mode !== 'net'),
                  h('div.ui-level-acts', {
                    children: [
                      /* 先配一副牌（可选）：不进联机也能看到并改这一局用哪 12 张（2026-10-18 用户「还是没看到选牌」） */
                      W.Btn({ id: 'btnLevelDeck', label: C.btnDeck, onClick: () => { ch.request('ui.levelDeck', {}); } }),
                      W.Btn({ id: 'btnLevelStart', cls: 'pri', label: C.btnStart, onClick: () => self.start() }),
                      W.Btn({ id: 'btnLevelBack', label: C.btnBack, onClick: () => { ch.request('ui.levelBack', {}); } })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      });
    }
  }

  /* ---------- 战前选牌（docs/ROUTER.md §2）：左卡池 / 右已选 + 计数 + 就绪 + 状态行 ----------
     与选关同一套纪律：条目从 vm 的 loadout* 字段来（viewmodel 一处算好），中文全在 H.TEXT.loadout，
     本面板一个中文字都不写；点卡 / 点 × 只说 ui.loadoutPick，就绪说 ui.loadoutReady，返回说 ui.loadoutBack ——
     三条都在 channel.js 登记过，没人接就是 no-handler，不假装成功。
     判据也不在这层：能不能就绪、缺几张，读 vm.loadoutEligible / vm.loadoutCount / vm.loadoutTerrain，
     「缺什么」那两句人话由文案表的 needCount / needTerrain 现拼。 */
  class Loadout extends UI.Panel {
    constructor(copy) { super({ name: 'loadout', layer: 'loadout', order: 68, closable: false }); this.copy = copy; }
    onShow() {
      const el = document.getElementById('loadout'); if (el) el.classList.remove('hidden');
      const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '0';
      /* 面板类交互三条硬要求：交还指针、收起「点击画面锁定鼠标」提示、开合是视图层状态（H.showLoadout） */
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      const lh = document.getElementById('lockHint'); if (lh) lh.classList.remove('on');
    }
    onHide() {
      const el = document.getElementById('loadout'); if (el) el.classList.add('hidden');
      const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '1';
    }
    ready() {
      /* 就绪是这一次会话里的真实用户手势：音频在这里解锁（与选关的「开始对局」同一条），
         发完意图就把结果交回装配层 —— 能不能开局不由这里判。 */
      if (window.GW && window.GW.Audio && window.GW.Audio.resume) window.GW.Audio.resume();
      const ch = UI.channel; if (ch) ch.request('ui.loadoutReady', {});
    }
    spec(vm) {
      const C = this.copy, self = this, ch = UI.channel;
      const pick = (id, delta) => { ch.request('ui.loadoutPick', { id: id, delta: delta }); };
      /* 状态行：只把 vm 给的 key 交给文案表翻（等待对手 / 我已就绪 / 对手已就绪 / 双方就绪 / 被退回） */
      const statusText = (ctx) => (C.statusText ? C.statusText(ctx.vm.loadoutStatus, ctx.vm) : '');
      const tailOf = (it) => (C.each ? C.each(it.n | 0) : '');
      /* valueOf 决定行上的 data-value（回归与取景脚本按它找卡，必须给卡 id 而不是行号） */
      const pool = W.List({
        items: (ctx) => ctx.vm.loadoutPool || [],
        keyOf: (it) => String(it.id),
        valueOf: (it) => String(it.id),
        title: (it) => it.label || it.id,
        sub: (it) => it.kindLine || '',
        detail: (it) => it.detail || '',
        trailing: (it) => tailOf(it),
        onPick: (it) => { pick(it.id, 1); }
      });
      return h('div.ui-loadout-box', {
        attrs: { 'data-role': 'loadout' },
        children: [
          h('div.ui-loadout-head', {
            children: [
              h('h1.ui-title', { text: (ctx) => (ctx.vm.loadoutLocal ? C.localTitle : C.title) }),
              h('div.ui-sub', { text: (ctx) => (ctx.vm.loadoutLocal ? C.localSub : C.sub) }),
              h('div.ui-loadout-status#loadoutStatus', { attrs: { 'data-status': (ctx) => String(ctx.vm.loadoutStatus || '') }, text: statusText }),
              /* 三步摆在标题下（第一次看到这一页要知道"先干什么"，不是先找按钮） */
              h('div.ui-loadout-steps#loadoutSteps', { text: (ctx) => (ctx.vm.loadoutLocal ? C.localSteps : C.steps) })
            ]
          }),
          h('div.ui-loadout-cols', {
            children: [
              h('section.ui-loadout-col#loadoutPool', {
                children: [h('h2.ui-h2', { text: C.poolHead }), pool]
              }),
              h('aside.ui-loadout-side', {
                children: [
                  h('h2.ui-h2', { text: C.pickHead }),
                  h('div.ui-loadout-picks#loadoutPicks', {
                    list: (ctx) => ctx.vm.loadoutPicks || [],
                    keyOf: (it) => String(it.id),
                    cell: (it) => h('div.ui-loadout-pick', {
                      attrs: { 'data-id': String(it.id) },
                      children: [
                        /* 张数交给文案表的 each（裸一个 1 / 2 读着像行号，×1 / ×2 才是「带了几张」） */
                        h('span.ui-loadout-pick-k', { text: (ctx) => tailOf(ctx.item || it) }),
                        h('span.ui-loadout-pick-name', { text: (ctx) => ((ctx.item || it).label || '') }),
                        h('span.ui-loadout-pick-kind', { text: (ctx) => ((ctx.item || it).kindLine || '') }),
                        W.Btn({
                          label: (C.remove || 'x'), field: 'loadoutRemove', key: String(it.id),
                          attrs: { title: C.removeTip },
                          onClick: (ev, ctx) => { const r = ctx.item || it; pick(r.id, -1); }
                        })
                      ]
                    })
                  }),
                  h('div.ui-loadout-empty', { when: (ctx) => !(ctx.vm.loadoutPicks && ctx.vm.loadoutPicks.length), text: C.emptyPicks }),
                  /* 计数行：数字读 vm，句子在文案表（面板不拼中文，也不自己判就绪） */
                  h('div.ui-loadout-count#loadoutCount', { text: (ctx) => (C.count ? C.count(ctx.vm) : '') }),
                  h('div.ui-loadout-missing#loadoutMissing', {
                    when: (ctx) => !ctx.vm.loadoutEligible,
                    text: (ctx) => {
                      const v = ctx.vm, out = [];
                      if ((v.loadoutCount | 0) !== (v.loadoutDeckSize | 0) && C.needCount) out.push(C.needCount(v));
                      if ((v.loadoutTerrain | 0) < (v.loadoutTerrainMin | 0) && C.needTerrain) out.push(C.needTerrain(v));
                      return out.join(C.needJoin || ' · ');
                    }
                  }),
                  h('div.ui-loadout-acts', {
                    children: [
                      /* 未满 12 张或地形 < 4 就 disabled（判据在 viewmodel，缺什么写在上面那行） */
                      W.Btn({ id: 'btnLoadoutReady', cls: 'pri', label: (ctx) => (ctx.vm.loadoutLocal ? C.readyLocal : C.ready), disabled: (ctx) => !ctx.vm.loadoutEligible, onClick: () => self.ready() }),
                      W.Btn({ id: 'btnLoadoutBack', label: C.back, onClick: () => { ch.request('ui.loadoutBack', {}); } })
                    ]
                  }),
                  h('div.ui-loadout-hint', { text: C.hint })
                ]
              })
            ]
          })
        ]
      });
    }
  }

  /* ---------- 结算 ---------- */
  class Result extends UI.Panel {
    constructor(copy) { super({ name: 'result', layer: 'result', order: 72, alwaysSync: false }); this.copy = copy; }
    onShow() { const el = document.getElementById('result'); if (el) el.classList.remove('hidden'); const hud = document.getElementById('hud'); if (hud) hud.classList.add('no-aim'); }
    onHide() { const el = document.getElementById('result'); if (el) el.classList.add('hidden'); const hud = document.getElementById('hud'); if (hud) hud.classList.remove('no-aim'); }
    spec(vm) {
      const C = this.copy, ch = UI.channel;
      return h('div.ui-result-box', {
        attrs: { 'data-role': 'result' },
        children: [
          h('div.ui-result-side', {
            children: [
              h('div.ui-sub', { text: C.kicker }),
              h('div.ui-result-title#resTitle', { class: (ctx) => 'ui-result-title' + (ctx.vm.result && ctx.vm.result.win ? ' win' : ' lose'), text: (ctx) => (ctx.vm.result && ctx.vm.result.title) || '' }),
              h('div.ui-result-score', { children: [
                h('div.col', { class: (ctx) => 'col' + (ctx.vm.result && ctx.vm.result.winner === 0 ? ' win' : ''), children: [h('div.k', { text: C.p1 }), h('div.v', { text: (ctx) => String((ctx.vm.result && ctx.vm.result.p1score) || 0) })] }),
                h('div.col', { class: (ctx) => 'col' + (ctx.vm.result && ctx.vm.result.winner === 1 ? ' win' : ''), children: [h('div.k', { text: C.p2 }), h('div.v', { text: (ctx) => String((ctx.vm.result && ctx.vm.result.p2score) || 0) })] })
              ] }),
              h('div.ui-result-acts', {
                children: [
                  W.Btn({ id: 'btnAgain', cls: 'pri', label: C.again, key: 'again', onClick: () => ch.request('ui.resultAction', { key: 'again' }) }),
                  W.Btn({ id: 'btnNew', label: C.newSeed, key: 'new', onClick: () => ch.request('ui.resultAction', { key: 'new' }) }),
                  W.Btn({ id: 'btnMenu', label: C.backMenu, key: 'menu', onClick: () => ch.request('ui.resultAction', { key: 'menu' }) }),
                  /* 回选关（docs/LEVELS.md §0）：结算 → 选关，不用先回标题再进一次 */
                  W.Btn({ id: 'btnLevel', label: C.backLevel, key: 'level', onClick: () => ch.request('ui.resultAction', { key: 'level' }) })
                ]
              })
            ]
          }),
          h('div.ui-result-stats', {
            children: [
              h('div.ui-rail-h', { text: C.statHead }),
              h('div.ui-kv#resKv', { list: (ctx) => ((ctx.vm.result && ctx.vm.result.rows) || []), keyOf: (r) => String(r[0]), cell: (r) => h('div.ui-kv-row', { children: [h('span', { text: r[0] }), h('b', { text: r[1] })] }) })
            ]
          })
        ]
      });
    }
  }
  /* 结算的按钮必须保留旧 id（回归脚本与 README 都点它）：Btn 里 data-key 之外再挂 id。
     data-field 同理（选关的三字段与模式栏靠它被回归脚本按 [data-field][data-key] 找到）：
     控件层 widgets.js 不认识这两个键，所以在这层的包装里补，不改公共件。 */
  const origBtn = W.Btn;
  UI.Widgets.Btn = function (o) {
    const spec = origBtn(o);
    const extra = {};
    if (o && o.id) extra.id = o.id;
    if (o && o.field) extra['data-field'] = o.field;
    /* 战前选牌的「就绪」要在构筑不合法时禁用。控件层那句 `disabled: o.disabled ? 'disabled' : null`
       是**建 spec 时算一次**的：传函数进去恒为真 → 按钮永远灰着（点了没反应就是这么做没的）。
       所以函数版 disabled 挪进 attrs，交给 dom.js 按 ctx 动态求值；顺带允许调用方补 attrs
       （title 这类顶层属性会被 dom.js 忽略，只有走 attrs 才真挂得上）。 */
    if (o && typeof o.disabled === 'function') extra.disabled = (ctx) => (o.disabled(ctx) ? 'disabled' : null);
    if (o && o.attrs) Object.assign(extra, o.attrs);
    if (Object.keys(extra).length) spec.attrs = Object.assign({}, spec.attrs || {}, extra);
    return spec;
  };

  /* ---------- 装配：把面板按表装进图层 ---------- */
  UI.build = function (opts) {
    const copy = opts.copy;
    const app = UI.boot({ throttleMs: opts.throttleMs });
    const bag = new UI.Bag();
    const channel = UI.initChannel(app.bus);
    /* 容器：三格权威（手持栏）+ 两格本地（随身）+ 图鉴（无限源）+ 只读镜像 */
    bag.add(new UI.Container({ id: 'hotbar', kind: 'authoritative', size: 5, cols: 5, side: 0, group: 'hand', pairWith: ['tray', 'catalog'], labelKey: 'hotbar' }));
    bag.add(new UI.Container({ id: 'hotbar2', kind: 'authoritative', size: 5, cols: 5, side: 1, group: 'hand', labelKey: 'hotbar2' }));
    bag.add(new UI.Container({ id: 'hand', kind: 'authoritative', size: 5, cols: 5, side: 0, group: 'hand', pairWith: ['tray'], labelKey: 'hand' }));
    /* 随身格 = 创造模式的「快捷取卡」货架（kind:'palette'），不是玩家的第二个背包。
       为什么不能再当本地容器：它的内容活在 localStorage（跨局持久），而 UI 本地写入会被视图模型
       每 60ms 用 vm.tray 覆盖回去——从手持栏拖进去 = 牌从手上消失、货架上也没有（实测 12 → 11 张）；
       而"收进随身格"是**复制**，再从货架拖回手持栏就把复制品塞进权威手牌（实测 12 → 13 张）。
       现在它只复制、不持有：没有本地写入，就没有吞牌与跨局带牌。生存模式按 profile 整块不渲染。 */
    bag.add(new UI.Container({ id: 'tray', kind: 'palette', size: 10, cols: 10, group: 'tray', pairWith: [], labelKey: 'tray' }));
    bag.add(new UI.Container({ id: 'catalog', kind: 'infinite', size: 0, cols: 12, group: 'catalog', pairWith: ['hand'], labelKey: 'catalog' }));
    bag.add(new UI.Container({ id: 'deck', kind: 'readonly', size: 1, cols: 1, group: 'piles', labelKey: 'deck' }));
    bag.add(new UI.Container({ id: 'discard', kind: 'readonly', size: 9, cols: 9, group: 'piles', labelKey: 'discard' }));
    UI.bag = bag;
    /* 建面板之前先给一个空骨架模型：spec 第一次求值时不该看到 undefined */
    app.useModel({
      filters: { tab: 'cards', el: 'all', ty: 'all', q: '' },
      players: [null, null], hands: [[], []], tray: [], catalog: [], catalogTotal: 0, discard: [],
      elementList: [], typeList: [], sel: [0, 0], badges: [], debug: null, result: null,
      split: false, running: false, seed: '—', time: '0.0', tick: '0', fps: '0', biome: '—', camName: '', err: false,
      /* 选关的表单状态（菜单与选关共用这一份，单一真源）：默认值取数据层的两个 DEFAULT。
         联机的三个字段（docs/NET.md §9.5）也在这里给初值——**必须在这份初始状态里就存在**：
         src/hud.js 的 ui.menuPick 用 `field in L` 当闸，不在状态里的字段会被静默丢掉却回 ok:true。 */
      level: {
        map: (G.MAP_DEFAULT || 'duel-64'), rule: (G.RULE_DEFAULT || 'ranked'), mode: 'train', deck: 'starter', seed: '', creative: false,
        netUrl: '', netRoom: 'ROOM', netRole: 'host',
        netOffer: '', netAnswer: '', netStatus: '',
        /* 选关的第二条轴（docs/MODES.md §6）：game = 玩法 id（G.GAME_MODES 的 key），gameTarget = 死亡竞赛的胜分
           （5 / 10 / 0，0 = 不限）。**必须在这份初值里就存在**：hud.js 的 ui.menuPick 用 `field in L` 当闸，
           不在状态里的字段会被静默丢掉却回 ok:true（联网那三条就是这么踩过的）。 */
        game: (G.GAME_DEFAULT || 'lode'), gameTarget: 10
      },
      /* 顶栏那两块（比分 / 三矿）与倒计时、关卡：给空骨架，第一次 spec 求值不该看到 undefined */
      score: [0, 0], lodes: [], timeLeft: '', ruleText: '', mapText: '',
      /* 战前选牌（docs/ROUTER.md §2）的初值：这一页在开局之前，装配层没有主循环喂 build()，
         所以骨架必须在这里就给全 —— 缺一个字段，面板第一帧就把它当 undefined 画（就绪按钮永远灰、
         计数行空白）。判就绪的三条数字读 viewmodel 的 UI.LOADOUT_RULES，这里不写第二份。
         loadout 本体（picks/ready/status/deny）只能就地改，见 viewmodel 与 hud 的同名注释。 */
      loadout: { picks: {}, ready: false, status: 'waiting', deny: '', role: '', room: '' },
      loadoutPool: [], loadoutPicks: [],
      loadoutCount: 0, loadoutTerrain: 0, loadoutReady: false, loadoutEligible: false,
      loadoutStatus: 'waiting', loadoutDeny: '', loadoutRole: '', loadoutRoom: '',
      loadoutDeckSize: (UI.LOADOUT_RULES || {}).deckSize, loadoutEachMax: (UI.LOADOUT_RULES || {}).eachMax,
      loadoutTerrainMin: (UI.LOADOUT_RULES || {}).terrainMin
    });
    const drag = UI.initDrag(app, bag, channel);
    app.bus.on('ui:sfx', (k) => { if (G.Audio && G.Audio.play && k) G.Audio.play(k); });

  /* ---------- 局内暂停菜单（2026-10-20） ----------
     MC 的 Esc：继续游戏 / 设置… / 保存并退出到标题。只做视图与意图；
     暂停的"真正效果"来自 Panel.pausing（主循环的 uiPanelOpen() 判据），指针锁由 onShow 交还。 */
  class Pause extends UI.Panel {
    constructor(copy) {
      super({ name: 'pause', layer: 'pause', order: 70, closable: true, pausing: true });
      this.copy = copy || {};
    }
    onCreate() { this.node.classList.add('ui-hide'); }
    onShow() {
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      const lh = document.getElementById('lockHint'); if (lh) lh.classList.remove('on');
      var L = this.app && this.app.layers.get('pause');
      if (L && L.el) { L.el.classList.add('on'); L.el.style.pointerEvents = 'auto'; }
      /* MC 的暂停菜单不把血条/手持栏留在背后，只留暗下去的世界。 */
      const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '0';
    }
    onHide() {
      var L = this.app && this.app.layers.get('pause');
      if (L && L.el) { L.el.classList.remove('on'); L.el.style.pointerEvents = 'none'; }
      const hud = document.getElementById('hud'); if (hud) hud.style.opacity = '1';
    }
    spec() {
      const C = this.copy, ch = UI.channel;
      return h('div.ui-pause-box', {
        attrs: { 'data-role': 'pause' },
        children: [
          h('h1.ui-title', { text: C.title || '' }),
          h('div.ui-sub', { text: C.sub || '' }),
          h('div.ui-pause-acts', {
            children: [
              W.Btn({ id: 'btnResume', cls: 'pri', label: C.resume || '', onClick: () => ch.request('ui.pauseResume', {}) }),
              W.Btn({ id: 'btnPauseSettings', label: C.settings || '', onClick: () => ch.request('ui.pauseSettings', {}) }),
              W.Btn({ id: 'btnQuit', label: C.quit || '', onClick: () => ch.request('ui.quitToTitle', {}) })
            ]
          }),
          h('div.ui-note', { text: C.note || '' })
        ]
      });
    }
  }

  /* ---------- 设置（2026-10-20）：画质 / 视角 / 键位 ----------
     纯视图：值从 vm.settings（src/settings.js 的 spec）读，改动走 channel 的四条意图。
     键位捕获：点一行后进入 wait，下一次 keydown 在**捕获阶段**被这里吞掉（不再触发游戏键），
     Esc 取消；冲突由 settings.js 判，面板只把 reason 交给通道的 ui:notify 说人话。 */
  class Settings extends UI.Panel {
    constructor(copy) {
      super({ name: 'settings', layer: 'settings', order: 68, closable: true, pausing: true });
      this.copy = copy || {};
      this.tab = 'quality';
      this.wait = null;
      const self = this;
      this._cap = function (ev) {
        if (!self.wait) return;
        ev.preventDefault(); ev.stopPropagation();
        if (ev.code === 'Escape') { self.wait = null; self.app && self.app.invalidate('settings'); return; }
        const action = self.wait; self.wait = null;
        const r = UI.channel.request('ui.rebindKey', { action: action, code: ev.code });
        if (r && r.ok === false) UI.channel.bus.emit('ui:notify', { key: 'deny', payload: { reason: r.reason || 'bad-key', intent: 'ui.rebindKey' } });
        self.app && self.app.invalidate('settings');
      };
    }
    onShow() {
      const el = document.getElementById('settings'); if (el) el.classList.remove('hidden');
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      const lh = document.getElementById('lockHint'); if (lh) lh.classList.remove('on');
      window.addEventListener('keydown', this._cap, true);
    }
    onHide() {
      const el = document.getElementById('settings'); if (el) el.classList.add('hidden');
      window.removeEventListener('keydown', this._cap, true);
      this.wait = null;
    }
    row(label, child) {
      return h('div.ui-settings-row', { children: [h('span.ui-settings-row-k', { text: label }), h('div.ui-settings-row-v', { children: [child] })] });
    }
    spec(vm) {
      const C = this.copy, self = this, ch = UI.channel;
      /* 设置面板的树只建一次，所有值都从**当前的** vm.settings 现读：
         初值（面板创建时）vm.settings 还没灌进来，抓成局部变量就会永久 NaN/空键位。 */
      const st = () => ((vm && vm.settings) || {});
      const p = () => (st().params || {});
      const keys = () => (st().keys || {});
      const set = (k, v) => ch.request('ui.setSetting', { key: k, value: v });
      const tabCls = (tab) => (ctx) => (self.tab === tab ? '' : 'ui-hide');
      const head = h('div.ui-head', { children: [h('b.ui-head-t', { text: C.title }), h('span.ui-head-tail', { text: C.sub || '' })] });
      const tabs = W.Tabs({
        items: () => Object.keys(C.tabs || {}).map((k) => ({ key: k, label: C.tabs[k] })),
        active: () => self.tab,
        onPick: (k) => { self.tab = k; self.app && self.app.invalidate('settings'); }
      });
      const quality = h('div.ui-settings-main', {
        class: tabCls('quality'),
        children: [
          h('div.ui-settings-note', { text: (C.labels || {}).note || '' }),
          this.row((C.labels || {}).quality, h('div.ui-row', {
            children: ['low', 'mid', 'high'].map((q) => W.Btn({ label: (C.qualityNames || {})[q] || q,
              active: () => p().quality === q, onClick: () => set('quality', q) }))
          })),
          this.row((C.labels || {}).renderScale, W.Range({ label: '', min: 0.5, max: 1.5, step: 0.05,
            valueFor: () => p().renderScale, format: (v) => Math.round(v * 100) + '%', onInput: (v) => set('renderScale', v) })),
          this.row((C.labels || {}).autoScale, W.Toggle({ label: '', valueFor: () => p().autoScale !== false, onChange: (v) => set('autoScale', v) })),
          this.row((C.labels || {}).post, W.Toggle({ label: '', valueFor: () => p().post, onChange: (v) => set('post', v) })),
          this.row((C.labels || {}).ssao, W.Toggle({ label: '', valueFor: () => p().ssao !== false, onChange: (v) => set('ssao', v) })),
          this.row((C.labels || {}).rays, W.Toggle({ label: '', valueFor: () => p().rays !== false, onChange: (v) => set('rays', v) })),
          this.row((C.labels || {}).raysStrength, W.Range({ label: '', min: 0, max: 0.6, step: 0.02,
            valueFor: () => p().raysStrength, format: (v) => Math.round(v * 100) + '%', onInput: (v) => set('raysStrength', v) })),
          this.row((C.labels || {}).ssaoStrength, W.Range({ label: '', min: 0, max: 1, step: 0.05,
            valueFor: () => p().ssaoStrength, format: (v) => Math.round(v * 100) + '%', onInput: (v) => set('ssaoStrength', v) })),
          this.row((C.labels || {}).clouds, W.Toggle({ label: '', valueFor: () => p().clouds, onChange: (v) => set('clouds', v) })),
          this.row((C.labels || {}).cloudQuality, h('div.ui-row', {
            children: ['low', 'mid', 'high'].map((q) => W.Btn({ label: (C.cloudNames || {})[q] || q,
              active: () => p().cloudQuality === q, onClick: () => set('cloudQuality', q) }))
          })),
          this.row((C.labels || {}).viewDistance, W.Range({ label: '', min: 64, max: 240, step: 8,
            valueFor: () => p().viewDistance, format: (v) => Math.round(v) + ((C || {}).unitGrid || ''),
            onInput: (v) => set('viewDistance', v) })),
          this.row((C.labels || {}).showFps, W.Toggle({ label: '', valueFor: () => p().showFps, onChange: (v) => set('showFps', v) }))
        ]
      });
      const view = h('div.ui-settings-main', {
        class: tabCls('view'),
        children: [
          this.row((C.labels || {}).camMode, h('div.ui-row', {
            children: ['shoulder', 'first', 'shoulderClean'].map((q) => W.Btn({ label: (C.camModeNames || {})[q] || q,
              active: () => p().camMode === q, onClick: () => set('camMode', q) }))
          })),
          this.row((C.labels || {}).fov, W.Range({ label: '', min: 50, max: 110, step: 1,
            valueFor: () => p().fov, format: (v) => Math.round(v) + '°', onInput: (v) => set('fov', v) })),
          this.row((C.labels || {}).bob, W.Range({ label: '', min: 0, max: 1, step: 0.05,
            valueFor: () => p().bob, format: (v) => Math.round(v * 100) + '%', onInput: (v) => set('bob', v) })),
          this.row((C.labels || {}).sprintKick, W.Range({ label: '', min: 0, max: 1, step: 0.05,
            valueFor: () => p().sprintKick, format: (v) => Math.round(v * 100) + '%', onInput: (v) => set('sprintKick', v) })),
          this.row((C.labels || {}).shake, W.Range({ label: '', min: 0, max: 1, step: 0.05,
            valueFor: () => p().shake, format: (v) => Math.round(v * 100) + '%', onInput: (v) => set('shake', v) })),
          h('div.ui-settings-note', { text: (C || {}).cameraNote || '' })
        ]
      });
      const keysMain = h('div.ui-settings-main', {
        class: tabCls('keys'),
        children: [
          h('div.ui-settings-note', { text: (C.labels || {}).keyNote || '' }),
          h('div.ui-keygrid', {
            list: () => (st().actions || []).map((a) => ({ a: a })),
            keyOf: (it) => it.a,
            cell: (it) => h('div.ui-keyrow', {
              class: () => (self.wait === it.a ? 'wait' : ''),
              children: [
                h('span.ui-keyrow-k', { text: ((C.actions || {})[it.a] || it.a) }),
                W.Btn({
                  label: () => (self.wait === it.a ? (C.labels || {}).keyPrompt : (C.keyName ? C.keyName((keys() || {})[it.a]) : (keys() || {})[it.a])),
                  onClick: () => { self.wait = it.a; self.app && self.app.invalidate('settings'); }
                })
              ]
            })
          }),
          h('div.ui-row.ui-row-end', { children: [
            W.Btn({ label: (C.labels || {}).resetKeys, onClick: () => ch.request('ui.resetSettings', { scope: 'keys' }) })
          ] })
        ]
      });
      const other = h('div.ui-settings-main', {
        class: tabCls('other'),
        children: [
          h('div.ui-settings-note', { text: (C || {}).rendererNote || '' }),
          h('div.ui-settings-note', { text: (C || {}).packNote || '' }),
          h('div.ui-settings-row', {
            children: [
              h('span.ui-settings-row-k', { text: (C || {}).shaderPack || '' }),
              h('div.ui-settings-row-v', { children: [
                h('label.ui-btn', { attrs: { for: 'shaderPackFile' }, text: (C || {}).loadPack || '' }),
                h('input.ui-file-hidden#shaderPackFile', {
                  attrs: { type: 'file', accept: '.zip' },
                  on: { change: (ev) => {
                    const f = ev.target.files && ev.target.files[0];
                    if (f) ch.request('ui.loadShaderPack', { file: f });
                    ev.target.value = '';
                  } }
                }),
                h('div.ui-settings-note', { text: (ctx) => {
                  const s = ctx.vm && ctx.vm.shaderPack;
                  if (!s) return (C || {}).packNone || '';
                  if (s.active) return (C.packLoaded || function (n, p) { return n + ' / ' + p; })(s.name, s.pass, !!s.gbuffer);
                  if (s.error) return (C.packFailed || function (e) { return e; })(s.error);
                  return (C || {}).packNone || '';
                } }),
                h('div.ui-settings-note', { text: (ctx) => {
                  const s = ctx.vm && ctx.vm.shaderPack;
                  return (s && s.notes && s.notes.length) ? s.notes.join(' · ') : '';
                } }),
                W.Btn({ id: 'unloadShaderPack', label: (C || {}).unloadPack, onClick: () => ch.request('ui.unloadShaderPack', {}) })
              ] })
            ]
          }),
          h('div.ui-settings-note', { text: (C || {}).storageNote || '' }),
          h('div.ui-row.ui-row-end', { children: [
            W.Btn({ label: (C.labels || {}).resetAll, onClick: () => ch.request('ui.resetSettings', { scope: 'all' }) })
          ] })
        ]
      });
      return h('div.ui-panel.ui-settings', {
        attrs: { 'data-role': 'settings' },
        children: [
          head,
          h('div.ui-settings-body', { children: [
            h('div.ui-settings-tabs', { children: [tabs] }), quality, view, keysMain, other
          ] }),
          h('div.ui-settings-foot', { children: [
            W.Btn({ label: (C.labels || {}).close, cls: 'pri', onClick: () => ch.request('ui.closeSettings', {}) })
          ] })
        ]
      });
    }
  }

    const P = {
      topbar: new Topbar(copy.topbar, copy.board),
      vitals: [new Vitals(copy.vitals, 0), new Vitals(copy.vitals, 1)],
      aim: new Aim(copy.aim),
      log: new Log(copy.log),
      toast: new Toast(copy.toast),
      hotbar: [new Hotbar(copy.hotbar, { side: 0, box: 'hotbar' }), new Hotbar(copy.hotbar, { side: 1, box: 'hotbar2', name: 'hotbar2' })],
      inv: new Inventory(copy.inv),
      choice: new Choice(copy.choice),
      menu: new Menu(copy.menu),
      level: new LevelSelect(copy.level),
      /* 战前选牌（docs/ROUTER.md §2）：注册进 loadout 层（core.js 的 LAYER_TABLE 里紧跟 level） */
      loadout: new Loadout(copy.loadout),
      result: new Result(copy.result),
      pause: new Pause(copy.pause),
      settings: new Settings(copy.settings)
    };
    Object.keys(P).forEach((k) => {
      const v = P[k];
      (Array.isArray(v) ? v : [v]).forEach((p) => app.add(p));
    });
    UI.panels = P;
    /* 门面层拿到的这个对象是 ui 与 app 之间的唯一桥：invalidate / bus 都转给 app，别在两边各存一份 */
    return {
      app: app, bag: bag, channel: channel, drag: drag, panels: P, bus: app.bus,
      invalidate: function (name) { app.invalidate(name); return this; },
      model: function () { return app.model; }
    };
  };
})(window.GW);
