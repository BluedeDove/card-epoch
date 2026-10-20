/* src/app/router.js · 页面路由（docs/ROUTER.md §1）
   路由是**页面级导航的唯一真源**：谁在前台、地址栏 hash、前进/后退的栈，全从它派生。
   三条边界（写在这里是为了下一个会话不再抄第二份）：
     · Scene 仍只回答"暂停 / 指针"这两件事 —— 本层每次切路由**代它** enter 一次对应场景；
     · 面板显隐是视图层状态：装配层订阅本层（src/main.js 的 onRoute）去问 hud，本层不碰画面；
     · hash 只是可观测的副作用（调试与以后分享链接），不是唯一状态：没有 location 也照常工作（node 量具就是这种环境）。
   零画面操作、零 THREE、零面向玩家的文案：本层只认路由名字。机检：tools/router_check.cjs（R10 静态那五条）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  /* 路由表：与 docs/ROUTER.md §1 的表逐行对应；match 没有页面级面板（对局面板表在 SCENES 里），故 panel 为 null */
  var ROUTES = {
    menu: { scene: 'menu', panel: 'menu' },
    level: { scene: 'level', panel: 'level' },
    loadout: { scene: 'loadout', panel: 'loadout' },
    match: { scene: 'match', panel: null },
    result: { scene: 'result', panel: 'result' }
  };
  var HOME = 'menu';
  /* 向前不可回的两条：对局与结算都活在同一次开局里。冷启动（刷新 / 手工改地址）按 hash 落进它们，
     会把 menu / level / result 三个面板一起隐掉而场上根本没有对局 —— 双击 index.html 的玩家就再也点不到任何东西。
     所以"落位"时它们一律当 HOME；对局中的 go/back 仍可到（那条路径上对局是真的）。 */
  var FORWARD_ONLY = { match: true, result: true };
  var PREFIX = '#/';

  var current = { name: HOME, params: null, route: ROUTES[HOME] };
  var stack = [];                                  // 只记 name，不记 params（回来时 params 空着）
  var listeners = [];
  var watching = false;

  function win() { return (typeof window !== 'undefined' && window) ? window : null; }
  function loc() { var w = win(); return (w && w.location) ? w.location : null; }

  /* '#/level' | '/level' | 'level' → 'level'；空 / 未知 → HOME；boot=true 时把向前不可回的两条也收成 HOME */
  function nameOf(raw, boot) {
    var s = (raw == null) ? '' : String(raw);
    if (s.charAt(0) === '#') s = s.slice(1);
    while (s.charAt(0) === '/') s = s.slice(1);
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '/' || c === '?' || c === '&') { s = s.slice(0, i); break; }
    }
    if (!ROUTES[s]) s = HOME;
    if (boot && FORWARD_ONLY[s]) s = HOME;
    return s;
  }
  function emit(next, prev) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](next, prev); } catch (e) { /* 一条订阅炸了不许把导航吞掉 */ }
    }
  }
  function writeHash(name) {
    var l = loc();
    if (!l) return;                                     // 没有 location：路由照旧可用，只是地址栏不反映
    var want = PREFIX + name;
    if (l.hash === want) return;                        // 同值不重复写（每写一次都会进一条浏览器历史）
    l.hash = want;
  }
  /* 切路由的唯一执行体：go / replace / back / hashchange / start 全汇到这里，差别只在 push 与 boot */
  function navigate(name, params, push, boot) {
    var resolved = nameOf(name, boot);
    var prev = current;
    var next = { name: resolved, params: params || null, route: ROUTES[resolved] };
    if (push && prev.name !== resolved) stack.push(prev.name);   // 同页重进不压栈，否则 back 会在原地打转
    current = next;
    writeHash(resolved);
    if (G.Scene && G.Scene.enter) G.Scene.enter(ROUTES[resolved].scene, next.params);
    emit(next, prev);
    return next;
  }
  /* 浏览器后退 / 手改地址：走上同一条路，但不压栈（栈是我们自己的意图史，不是浏览器的历史）。
     先按**地址栏点名要哪一页**（nameOf 不带 boot）认一次回声：go/replace 刚写出去的那次 hashchange 里，
     current.name 已经是那一页了，直接收掉。这一步不能用"落位口径"判——把 #/match 收成 menu 之后，
     自己写的 hash 会被回声当成"用户离开了对局页"拽回菜单，主循环当场冻在 match 上（ui_check 的 AppState 就是这么红的）。
     确认是外部改动之后，再按落位口径收一次（未知名字与向前不可回的那两条回 HOME）。 */
  function onHashChange() {
    var l = loc();
    if (nameOf(l ? l.hash : '', false) === current.name) return;
    navigate(l ? l.hash : '', null, false, true);
  }

  G.ROUTES = ROUTES;
  G.Router = {
    v: 1,
    /* 切换路由：更新 hash、压栈、Scene.enter、通知监听者 */
    go: function (name, params) { return navigate(name, params, true, false); },
    /* 同上但不压栈 —— 开局与结算这类"向前不可回"走它 */
    replace: function (name, params) { return navigate(name, params, false, false); },
    /* 回上一页（栈空回 menu）；弹掉一层，否则同一层能 back 无数次 */
    back: function () {
      var name = stack.length ? stack.pop() : HOME;
      return navigate(name, null, false, false);
    },
    /* 读 location.hash 完成首次落位（缺省 menu），不压栈；顺带挂上 hashchange 监听 */
    start: function () {
      var w = win();
      if (!watching && w && w.addEventListener) { w.addEventListener('hashchange', onHashChange); watching = true; }
      var l = loc();
      stack = [];
      return navigate(l ? l.hash : '', null, false, true);
    },
    current: function () { return current; },
    /* 订阅 (next, prev)；返回取消函数（与 G.Scene.on 同一个形状） */
    on: function (fn) {
      if (typeof fn !== 'function') return function () { };
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    href: function (name) { return PREFIX + nameOf(name, false); }
  };
})(window.GW);
