/* ================= GW.Creative（创造调试模式：状态与能力层） =================
   本层只干三件事：
     1) 维护调试开关（ST.opt），并把同一个标记对象挂到 players[0].creative 上，
        由 battle.js / rules.js 在**原有结算分支**里读它（不另开第二套结算通道）；
     2) 提供调试动作：给牌 / 重掷手牌 / 回满 / 训练假人 / 清场 / 飞行 / 穿墙；
     3) 把当前状态以纯数据交出去（ST.spec()），长什么样由 UI 层决定。

   职责边界（下次改动请守住）：
     · 这里不许出现 DOM、样式、中文文案、键盘监听——
       UI 结构与样式 → index.html（#inv 骨架、.inv* 规则）
       文案与渲染     → js/hud.js（H.TEXT.inv、H.showInventory、H.paintGmBadge）
       键位与装配     → js/main.js（键位表；把 spec 与 handlers 接到 hud 上）
     · 权威状态仍然只在 Match.step / Rules.play：本层写的是"玩家是不是创造模式"，
       补蓝/清冷却/锁昼夜这些每 tick 的维护在 Match.creativeUpkeep / Match.step 里做。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 能力清单：key → 默认值。UI 层拿 key 去文案表找标签，本层不关心叫什么。 */
  var TOGGLES = ['infiniteMana', 'noConsume', 'noCooldown', 'invuln', 'freeMats', 'ai', 'unlimitedCells'];
  var DEF = {
    infiniteMana: true,   // 出牌不扣蓝（canPlay 与 play 同一条口）
    noConsume: true,      // 打出后留在手上，可连发同一张
    noCooldown: true,     // 不设冷却
    invuln: true,         // 无敌，且免疫负面状态（增益照常，否则测不了加速/再生卡）
    freeMats: true,       // 地形卡不判"素材不足"
    ai: true,             // AI 对手是否上场（关掉得到干净场地）
    unlimitedCells: false,// 解除单卡地形改造上限（默认关：那是平衡规则，不是调试必需）
    dayLock: 'off',       // off | day | night
    timeScale: 1,         // 1 / 0.5 / 0.25，主循环按它拉长 tick 间隔
    flyMul: 1.9, flyV: 9  // 飞行速度倍率 / 升降速度（格/s）
  };
  var SEGMENTS = { timeScale: [1, 0.5, 0.25], dayLock: ['off', 'day', 'night'] };
  var ACTIONS = ['resetHand', 'healUp', 'spawnDummy', 'clearField'];
  /* 每次进局强制关的瞬时状态：不带旧一局的上半身状态进来 */
  var TRANSIENT = { fly: false, noclip: false };

  /* 不反过来查主循环要什么：match 由装配层（main.js start/install）交进来。
     状态层去读 window.GWAPP 就是向上依赖，PLAN_REFACTOR §5.1 的"只允许向下依赖"同样管住我们。 */
  function match() { return ST._match || null; }

  var ST = G.Creative = {
    on: false,
    opt: Object.assign({}, DEF, TRANSIENT),
    onChange: null,          // 装配层（main.js）挂回调：状态变了就重绘徽章 / 刷新面板
    DEF: DEF, TOGGLES: TOGGLES, SEGMENTS: SEGMENTS, ACTIONS: ACTIONS
  };
  function fireChange() { if (ST.onChange) { try { ST.onChange(); } catch (e) { } } }

  /* ---------- 选项持久化：只存开关，不存"创造模式是否开着" ----------
     开关可以记住，开关本身每次都从关开始：带着调试状态去跑回归验收或正常玩都不该发生。 */
  function loadOpts() {
    try {
      var s = window.localStorage && localStorage.getItem('gw.creativeOpt');
      if (!s) return;
      var o = JSON.parse(s);
      for (var k in DEF) if (typeof o[k] !== 'undefined' && typeof o[k] === typeof DEF[k]) ST.opt[k] = o[k];
    } catch (e) { }
  }
  function saveOpts() {
    try {
      if (!window.localStorage) return;
      var o = {}; for (var k in DEF) o[k] = ST.opt[k];
      localStorage.setItem('gw.creativeOpt', JSON.stringify(o));
    } catch (e) { }
  }
  loadOpts();

  /* ---------- 挂标记：本层对权威侧的唯一写入点 ---------- */
  ST.attach = function (m) {
    m = m || match(); if (!m) return;
    var o = ST.opt;
    if (ST._match !== m) {                     // 换了一局（R 重开 / 菜单再进）才清瞬时状态
      ST._match = m;
      o.fly = TRANSIENT.fly = false;
      o.noclip = TRANSIENT.noclip = false;
      if (ST.onCloseInv) ST.onCloseInv();       // 装配层负责关面板：主循环暂停判据在它那边
    }
    for (var i = 0; i < m.players.length; i++) {
      // 只给 P1（调试者本人）。P2/AI 保持普通玩家，才测得出"对手视角下的表现"。
      m.players[i].creative = (ST.on && i === 0) ? o : null;
    }
    m.aiOff = ST.on && !o.ai;
    m.dayLock = (ST.on && o.dayLock !== 'off') ? o.dayLock : null;
    m.timeScale = ST.on ? (o.timeScale || 1) : 1;
    fireChange();
  };
  ST.enable = function (on, silent) {
    ST.on = !!on;
    if (!ST.on) {
      ST.opt.fly = TRANSIENT.fly = false; ST.opt.noclip = TRANSIENT.noclip = false;
      // 面板开着时把创造关掉，会留下"看着能改、其实不推进"的假死状态：一并合上
      if (ST.onCloseInv) ST.onCloseInv();
    }
    ST.attach(match());
    if (!silent) ST.notify(on ? 'on' : 'off');
    saveOpts();
  };
  ST.timeScale = function () { return ST.on ? (ST.opt.timeScale || 1) : 1; };
  ST.set = function (k, v) {
    ST.opt[k] = v;
    if (k === 'fly' || k === 'noclip') TRANSIENT[k] = v;
    ST.attach(match());
    saveOpts();
  };
  ST.toggleFly = function () {
    if (!ST.on) ST.enable(true);
    ST.set('fly', !ST.opt.fly);
    if (ST.opt.fly) ST.set('noclip', false);
    ST.notify('fly');
  };
  ST.toggleNoclip = function () {
    if (!ST.on) ST.enable(true);
    ST.set('noclip', !ST.opt.noclip);
    if (ST.opt.noclip) ST.set('fly', true);
    ST.notify('noclip');
  };

  /* ---------- 动作 ---------- */
  function p1() { var m = match(); return m && m.players[0]; }
  /* slot 由调用方（视图层的选中格 / 装配层）传进来：本层不认识 HUD，只管手牌数据本身 */
  ST.give = function (cardId, mode, opts) {
    var p = p1();
    if (!p || !G.CARDS_BY_ID[cardId]) return { ok: false, reason: 'no-card' };
    var want = (opts && typeof opts.slot === 'number') ? opts.slot : 0;
    var slot;
    if (mode === 'append' && p.hand.length < 5) { p.hand.push(cardId); slot = p.hand.length - 1; }
    else {
      slot = p.hand.length ? Math.max(0, Math.min(want, p.hand.length - 1)) : 0;
      if (!p.hand.length) p.hand.push(cardId);
      else {
        /* 换掉的那张不许凭空蒸发：进弃牌堆（玩家看得到它去哪了，牌库/弃牌堆的张数也对得上）。
           创造模式是"无限取卡"，但"无限取"不等于"随手吞牌"——这两件事以前混在一起了。 */
        var old = p.hand[slot];
        if (old && old !== cardId && p.discard) p.discard.push(old);
        p.hand[slot] = cardId;
      }
    }
    if (mode === 'cast') {
      var idx = Math.min(slot, p.hand.length - 1);
      // 出牌走主循环那条正式通道（含 ctx.aim 装配），这里不另算一份瞄准
      if (ST.handlers && ST.handlers.cast) ST.handlers.cast(0, idx);
    }
    return { ok: true, cardId: cardId, slot: slot, mode: mode || 'set' };
  };
  /* 手持栏拖拽要的两件事：把某一格拿起来（交回光标）、格与格换位。
     与 give 同源：本层写的是"创造模式下调试者的手牌"，普通局由 Match 发牌，不经这里。 */
  ST.take = function (slot) {
    var p = p1();
    if (p && match() && match().takeFromHand) return match().takeFromHand(p, slot);   // 权威层同一份写法（生存也能拖，见 battle.js）
    if (!p || !p.hand.length) return { ok: false, reason: 'no-hand' };
    var i = Math.max(0, Math.min(p.hand.length - 1, slot | 0));
    var id = p.hand.splice(i, 1)[0];
    /* 刷新手牌 DOM 由调用方（装配层）负责：状态层不反手抓视图 */
    return { ok: true, cardId: id, slot: i, left: p.hand.length };
  };
  ST.swapHand = function (a, b) {
    var p = p1();
    if (!p || !p.hand.length) return { ok: false, reason: 'no-hand' };
    var i = Math.max(0, Math.min(p.hand.length - 1, a | 0)), j = Math.max(0, Math.min(p.hand.length - 1, b | 0));
    var t = p.hand[i]; p.hand[i] = p.hand[j]; p.hand[j] = t;
    return { ok: true, from: i, to: j };
  };
  ST.resetHand = function () {
    var p = p1(); if (!p) return { ok: false };
    p.hand.length = 0;
    for (var i = 0; i < 5; i++) p.hand.push(G.CARDS[Math.floor(Math.random() * G.CARDS.length)].id);
    return { ok: true, resetHand: true };
  };
  ST.healUp = function () {
    var p = p1(); if (!p) return { ok: false };
    p.hp = p.maxHp; p.shield = 0; p.st = {}; p.mats = 20; p.lives = Math.max(p.lives, 2);
    for (var k in p.cooldowns) p.cooldowns[k] = 0;
    return { ok: true };
  };
  ST.clearField = function () {
    var m = match(); if (!m) return { ok: false };
    m.summons.length = 0; m.sigils.length = 0; m.projectiles.length = 0;
    return { ok: true };
  };
  ST.spawnDummy = function () {
    var m = match(); if (!m) return { ok: false };
    return { ok: !!m.spawnDummy(1, 9999) };
  };
  ST.doAction = function (key) {
    var fn = ST[key];
    if (typeof fn !== 'function') return { ok: false, reason: 'no-action' };
    return fn.call(ST);
  };

  /* ---------- 交给 UI 层的纯状态（不含任何文案/DOM） ---------- */
  ST.spec = function () {
    var o = ST.opt, t = [], sg = [], ac = [];
    for (var i = 0; i < TOGGLES.length; i++) t.push({ key: TOGGLES[i], value: !!o[TOGGLES[i]] });
    t.push({ key: 'noclip', value: !!o.fly && !!o.noclip });            // 穿墙在面板上只跟飞行绑在一起
    for (var k in SEGMENTS) sg.push({ key: k, value: o[k], values: SEGMENTS[k] });
    for (var j = 0; j < ACTIONS.length; j++) ac.push({ key: ACTIONS[j] });
    return {
      on: ST.on, fly: !!o.fly, noclip: !!o.noclip, ai: !!o.ai,
      timeScale: o.timeScale, dayLock: o.dayLock, unlimitedCells: !!o.unlimitedCells,
      toggles: t, segments: sg, actions: ac
    };
  };

  /* 需要告诉玩家的话，交给装配层/hud 去说：这里只报"发生了什么"，不拼中文 */
  ST.notify = function (what) { if (ST.onNotify) { try { ST.onNotify(what); } catch (e) { } } };

  ST.install = function (handlers) {
    ST.handlers = handlers || {};
    ST.attach(match());
  };
})(window.GW);
