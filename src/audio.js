/* ================= GW.Audio =================
   音频的**门面 / 路由层**：权威层与 UI 层唯一认识的音频入口。
     G.Audio.play('boom')   放一个事件（名字来自 js/sfx-table.js）
     G.Audio.toggle()       总开关（静音写在总线上，音效与将来的 BGM 一起静音）
     G.Audio.resume()       浏览器要求用户手势后才能出声，菜单点击里调它
     G.Audio.enabled / volume
   三层的分工：本层只做"查表 + 节流 + 交给引擎"，音色数字全在 sfx-table，
   发声手段全在 audio-engine。加一个新音效 = 往表里加一条数据，这里不用动。

   零 DOM、零玩家可见文案（提示语在 js/hud.js 的 H.TEXT）；也不反向抓主循环。
   不依赖任何音频文件：所有声音都是现场合成的，离线双击 index.html 就能响。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var E = G.AudioEngine, T = (G.SfxTable && G.SfxTable.events) || {};
  /* 单位对齐：performance.now() 给的是毫秒，节流窗口就写毫秒。 */
  var lastAt = {}, RETRIGGER_MS = 28;                    // 同名事件 28ms 内不重放：同帧十几个 hit 叠成糊声
  var playCount = 0, skipThrottle = 0, skipBudget = 0;

  function ready() { return !!(E && E.supported && E.supported()); }

  function play(name, when) {
    if (!ready()) return false;
    var ev = T[name];
    if (!ev || !ev.layers || !ev.layers.length) return false;
    var now = (window.performance && performance.now ? performance.now() : Date.now());
    if (lastAt[name] && now - lastAt[name] < RETRIGGER_MS) { skipThrottle++; return false; }
    lastAt[name] = now;
    var ok = E.playLayers(ev.layers, when || 0, 'sfx');
    if (ok) playCount++; else skipBudget++;
    return ok;
  }

  G.Audio = {
    play: play,
    resume: function () { return ready() ? E.resume() : false; },
    toggle: function () { if (!ready()) return false; return !E.setMuted(!E.muted()); },
    setEnabled: function (b) { if (!ready()) return false; return E.setMuted(!b) === false; },
    get enabled() { return ready() ? !E.muted() : false; },
    set volume(v) { if (ready()) E.setVolume(v); },
    get volume() { return ready() ? E.volume() : 0; },
    has: function (name) { return !!T[name]; },
    names: function () { return Object.keys(T); },
    state: function () { return ready() ? E.state() : 'unsupported'; },
    stats: function () {
      return { played: playCount, skipThrottle: skipThrottle, skipBudget: skipBudget,
        voices: ready() ? E.voices() : 0, maxVoices: ready() ? E.maxVoices : 0, table: Object.keys(T).length };
    },
    /* 给回归脚本用：把某个事件离线渲染成采样，断言"真的响了、没顶爆" */
    render: function (name, seconds) {
      var ev = T[name];
      if (!ev || !E || !E.renderLayers) return null;
      return E.renderLayers(ev.layers, seconds || Math.max(0.4, (ev.len || 0.5) + 0.3));
    }
  };
})(window.GW);
