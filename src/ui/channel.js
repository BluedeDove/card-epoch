/* ================= GW.UI.channel（UI ↔ 游戏唯一通道） =================
   这一层是"UI 内跟游戏内的通道"：视图**永远不伸手进权威状态**，游戏也**永远不认识 DOM**。
   两边只说两种话：

     UI → 游戏：意图（intent）。UI 说 "ui.give / ui.useSlot / ui.dropOnWorld …"，
                 由装配层（js/main.js）注册的处理函数决定要不要执行、能不能执行，返回 {ok, …}。
                 没人接的意图一律 {ok:false, reason:'no-handler'} —— 不假装成功。
     游戏 → UI：事件（event）与数据供给（provider）。游戏 push 一个 key，UI 自己决定怎么演；
                 UI 需要 match 派生数据时 ch.ask('handVM', side)，由 app 把 viewmodel 交出来，
                 视图层不去读 window.GWAPP（PLAN §5.1「只允许向下依赖」，ui 在 app 之下）。

   未来接"物品进出世界"（挖矿进背包、把方块放回世界）只要在这里多注册一个 handler，
   视图层一行不用改 —— 用户说的"现在可能用不到，但留个通道"就是这个口子。
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});

  /* 意图词汇表：名字就是契约，注册方与调用方都只能用它。
     needs 只用于"要不要先启用创造模式"这种前置提示，真正的判定仍在处理函数里。 */
  const INTENTS = {
    'ui.selectSlot': { needs: 'running' },        // 换手持栏选中格
    'ui.useSlot': { needs: 'running' },           // 用一手持栏物品（=出牌）
    'ui.castCard': { needs: 'running' },          // 直接出一张（点卡面 / 双击）
    'ui.castAt': { needs: 'running' },            // 拖到画面上：在指定屏幕点出牌
    'ui.give': { needs: 'creative' },             // 把物品放进某一格（创造取卡 / 拖进手持栏）
    'ui.discard': { needs: 'creative' },          // 从手里扔一张
    'ui.spill': { needs: 'creative' },            // 光标上那一摞丢到窗外
    'ui.selectClass': { needs: 'running' },       // 切手持栏类别（生存模式核心交互，不要求创造）
  'ui.reorderHand': { needs: 'any' },           // 手持栏内部换位：玩家整理自己的牌，生存模式也要能用
    'ui.takeFromHand': { needs: 'any' },             // 从手持栏拿起来（生存模式整理自己的牌也要用）
    'ui.placeHand': { needs: 'any' },                // 把手上的牌放回/换到手持栏某一格
    'ui.moveHand': { needs: 'any' },                  // 手持栏内部换位（拿起来再放下 = 插入到那一格）
    'ui.dealFromDeck': { needs: 'any' },              // 生存模式从牌库换一张进手持栏（被换下的原位回牌库）
    'ui.examine': { needs: 'any' },               // 点只读镜像：只是看一眼
    'ui.readOnlyUse': { needs: 'any' },           // 点只读镜像（牌库 / 弃牌堆）
    'ui.dropOnWorld': { needs: 'any' },           // 把物品放进世界（未来：挖矿 / 放置方块）
    'ui.debugAction': { needs: 'creative' },      // 调试动作（重掷手牌 / 假人 / 清场）
    'ui.debugToggle': { needs: 'creative' },
    'ui.debugSegment': { needs: 'creative' },
    'ui.menuPick': { needs: 'any' },             // 菜单里选模式 / 选卡组（表单状态归视图）
    'ui.menuAction': { needs: 'any' },           // 进世界 / 帮助 / 存档三键 → 装配层
    'ui.resultAction': { needs: 'any' },         // 结算面板的按钮 → 装配层
    /* 选关（docs/LEVELS.md §4）：三条意图先登记再说话；没人接一律 no-handler，不许假成功 */
    'ui.levelPick': { needs: 'any' },            // 选地图 / 规则 / 模式 / 卡组 / 种子（只写视图状态）
    'ui.levelStart': { needs: 'any' },           // 开始对局 → 装配层用当前选项组 cfg 调 start
    'ui.levelBack': { needs: 'any' },            // 返回标题 → Scene.enter('menu')
    /* 战前选牌（docs/ROUTER.md §2；任务书 L1 第 4 条）：三条意图先登记再说话。
       picks 是**视图状态**（我这一局想带哪些卡），改它的处理函数在 src/hud.js；
       就绪与返回要动装配层（连/断与切页），那边没接住就一律 no-handler，不许假成功。 */
    'ui.loadoutPick': { needs: 'any' },          // 加 / 减一张（{id, delta}，上限 2 份、整副 12 张）
    'ui.loadoutReady': { needs: 'any' },         // 我就绪了 → 装配层（net 未接时只说「等对手」）
    'ui.loadoutBack': { needs: 'any' },          // 返回选关 → 装配层断开连接并切页
    'ui.levelDeck': { needs: 'any' },             // 选关 → 配牌页（不进联机也能先选一副，2026-10-18）
  };
  UI.INTENTS = INTENTS;

  class Channel {
    constructor(bus) {
      this.bus = bus || (UI.app && UI.app.bus) || new UI.Bus();
      this.bindings = [];                          // [{ns, handlers}]，后注册的先问（可覆盖）
      this.providers = new Map();                  // key → fn
      this.log = [];                               // 最近若干条意图（诊断用，回归脚本会读它）
      this.stats = { requests: 0, denied: 0, unhandled: 0 };
    }
    /* --- 装配层注册处理函数；同名后注册者赢，返回取消函数 --- */
    bind(ns, handlers) {
      const rec = { ns: ns, handlers: handlers || {} };
      this.bindings = this.bindings.filter((b) => b.ns !== ns).concat([rec]);
      return () => { this.bindings = this.bindings.filter((b) => b !== rec); };
    }
    unbind(ns) { this.bindings = this.bindings.filter((b) => b.ns !== ns); }
    has(type) {
      for (let i = this.bindings.length - 1; i >= 0; i--) if (typeof this.bindings[i].handlers[type] === 'function') return true;
      return false;
    }
    known(type) { return Object.prototype.hasOwnProperty.call(INTENTS, type); }
    /* --- UI 说一句话给游戏 --- */
    request(type, payload, silent) {
      this.stats.requests++;
      const report = (res) => {
        /* 视图直接 request 的按钮（卡页那四个）被拒时必须演出来；
           Ops 那条路由 flush(silent) 交给 Ops.resolve 统一报，免得同一次操作弹两条。 */
        if (!silent && res && res.ok === false) this.bus.emit('ui:notify', { key: 'deny', payload: { reason: res.reason, intent: type } });
        return res;
      };
      if (!this.known(type)) { this.stats.unhandled++; return report({ ok: false, reason: 'unknown-intent', intent: type }); }
      for (let i = this.bindings.length - 1; i >= 0; i--) {
        const fn = this.bindings[i].handlers[type];
        if (typeof fn !== 'function') continue;
        let out;
        try { out = fn(payload || {}, type); }
        catch (e) {
          if (console && console.error) console.error('[GW.UI.channel] handler threw: ' + type, e);
          this.stats.denied++;
          return report({ ok: false, reason: 'handler-error', intent: type });
        }
        const res = (out === undefined) ? { ok: true } : out;
        if (res && res.ok === false) this.stats.denied++;
        this._record(type, payload, res);
        return report(res);
      }
      this.stats.unhandled++;
      const res = { ok: false, reason: 'no-handler', intent: type };
      this._record(type, payload, res);
      return report(res);
    }
    _record(type, payload, res) {
      this.log.push({ type: type, payload: payload || null, ok: !!(res && res.ok), reason: (res && res.reason) || null, at: Date.now() });
      if (this.log.length > 60) this.log.shift();
    }
    /* --- 数据供给：视图层要什么，向 app 要，不去读主循环 --- */
    provide(key, fn) { this.providers.set(key, fn); return () => this.providers.delete(key); }
    ask(key) {
      const fn = this.providers.get(key);
      if (typeof fn !== 'function') return null;
      const args = Array.prototype.slice.call(arguments, 1);
      try { return fn.apply(null, args); } catch (e) { if (console && console.error) console.error('[GW.UI.channel] provider failed: ' + key, e); return null; }
    }
    /* --- 游戏 → UI 的事件回流（只报 key，中文归文案表） --- */
    push(evt, data) { this.bus.emit('game:' + evt, data); }
    onGame(evt, fn) { return this.bus.on('game:' + evt, fn); }
    /* --- 音效 / 提示：物品层与拖拽层只报 key，播与演都由外面决定（见 uiEvents） --- */
    uiEvents(handlers) {
      const off = [];
      if (handlers && handlers.sfx) off.push(this.bus.on('ui:sfx', handlers.sfx));
      if (handlers && handlers.notify) off.push(this.bus.on('ui:notify', handlers.notify));
      return () => off.forEach((f) => f());
    }
    /* 把一次 bag 操作产生的事件/意图全部投递出去 */
    flush(bag) {
      if (!bag) return { ok: true, sent: 0 };
      let sent = 0;
      for (const ev of bag.events) {
        if (ev.sfx) { this.bus.emit('ui:sfx', ev.sfx); sent++; }
        if (ev.notify) { this.bus.emit('ui:notify', { key: ev.notify, payload: ev.payload }); sent++; }
      }
      const out = [];
      /* silent=true：Ops 那条路的拒绝由 Ops.resolve 统一 wantSay 报（它知道是哪一步、哪个 plan） */
      for (const it of bag.intents) { out.push({ type: it.type, payload: it.payload, result: this.request(it.type, it.payload, true) }); sent++; }
      bag.reset();
      return { ok: true, sent: sent, results: out };
    }
  }
  UI.Channel = Channel;
  UI.channel = null;
  UI.initChannel = function (bus) { UI.channel = new Channel(bus); return UI.channel; };
})(window.GW);
