/* js/app/scenes.js · 场景状态（S4）
   场景是**状态**，不是对象：ui.scene = {id, args, progress}；SCENES 只是描述表；
   enterScene/exitScene 是函数。这样"当前在哪个场景"只有一个家，面板/暂停/指针都从它派生。
   零 DOM、零 THREE、零文案（面板列表只是 id）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var SCENES = {
    boot:   { id: 'boot',   panels: [], pausing: true,  pointer: 'free' },
    menu:   { id: 'menu',   panels: ['menu'], pausing: true, pointer: 'free' },
    /* 选关（docs/LEVELS.md §0）：所有"这局怎么玩"的选择都在这里，与菜单同为暂停场景 */
    level:  { id: 'level',  panels: ['level'], pausing: true, pointer: 'free' },
    /* 联机战前选牌（docs/ROUTER.md §2）：只在 net 模式经过，由 G.Router 的 loadout 路由带进来。
       与菜单 / 选关同为暂停场景——选牌时不该有 tick 在跑；面板显隐由装配层订阅路由派生（这里只列 id）。 */
    loadout:{ id: 'loadout', panels: ['loadout'], pausing: true, pointer: 'free' },
    match:  { id: 'match',  panels: ['topbar', 'vitals', 'aim', 'log', 'toast', 'hotbar', 'inv', 'choice'], pausing: false, pointer: 'lock' },
    result: { id: 'result', panels: ['result', 'topbar', 'vitals'], pausing: true, pointer: 'free' }
  };
  var current = { id: 'boot', args: null, progress: 0 };
  var listeners = [];

  function emit(next, prev) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](next, prev); } catch (e) {}
    }
  }
  function enter(id, args) {
    var def = SCENES[id] || SCENES.boot;
    var prev = current;
    current = { id: def.id, args: args || null, progress: 0 };
    emit(current, prev);
    return current;
  }
  function progress(p) { current.progress = Math.max(0, Math.min(1, p || 0)); return current.progress; }
  function on(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function def() { return SCENES[current.id] || SCENES.boot; }
  function is(id) { return current.id === id; }
  function pausing() { return !!def().pausing; }
  function pointer() { return def().pointer; }
  function panels() { return def().panels.slice(); }
  function snapshot() { return { id: current.id, args: current.args, progress: current.progress, pausing: pausing(), pointer: pointer() }; }

  G.SCENES = SCENES;
  G.Scene = {
    v: 1,
    enter: enter,
    exit: function () { return enter('menu'); },
    progress: progress,
    on: on,
    current: function () { return snapshot(); },
    def: def,
    is: is,
    pausing: pausing,
    pointer: pointer,
    panels: panels
  };
})(window.GW);
