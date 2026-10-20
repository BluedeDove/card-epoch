/* src/settings.js · 玩家设置（画质 / 视角 / 键位）的唯一真源
   纯数据 + 纯存取：零 DOM、零 THREE、零玩家可见文案。界面在 src/ui/panels.js 的 Settings，
   中文在 src/hud.js 的 H.TEXT.settings；把设置接到渲染/输入是装配层（src/main.js）的事。
   存 localStorage.gw.settings；键位与数值分开存，方便以后单人/联机各一套。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var KEY = 'gw.settings';

  /* 画质档是"一组结果的预设"，不是又一个数值旋钮：玩家选 low/mid/high 时，
     renderScale / post / clouds / viewDistance / bob 一起落到这组值上；单项仍可再调。 */
  var QUALITY = {
    low:    { renderScale: 0.75, post: false, clouds: true, cloudQuality: 'low',  viewDistance: 96,  particles: 0.55, ssao: false },
    mid:    { renderScale: 1.0,  post: true,  clouds: true, cloudQuality: 'mid',  viewDistance: 132, particles: 0.8,  ssao: true },
    high:   { renderScale: 1.0,  post: true,  clouds: true, cloudQuality: 'high', viewDistance: 168, particles: 1.0,  ssao: true }
  };
  var DEFAULTS = {
    quality: 'high',
    renderScale: 1.0,
    post: true,
    clouds: true,
    cloudQuality: 'high',
    viewDistance: 168,
    autoScale: true,        // 帧率低于 48 自动降渲染分辨率，高于 75 再慢慢升回玩家设定
    ssao: true, ssaoStrength: 0.38,   // SSAO 的默认值与 src/shader.js 同档；关掉后像素回到老后处理
    rays: true, raysStrength: 0.12,   // 太阳光束：bloom 亮部沿太阳方向径向累积
    fov: 70,
    bob: 1.0,             // 走路镜头摇晃 0..1
    sprintKick: 1.0,      // 疾跑 FOV kick / 侧倾 0..1
    shake: 1.0,           // 受击/震屏强度 0..1
    showFps: true,
    camMode: 'shoulder'          // shoulder | first | shoulderClean（C 键与设置页共用这一份）
  };
  /* 动作 → KeyboardEvent.code。只放"玩家会想改"的键；F3/F9 这类调试键不开放。
     lookU/lookD 是 F/V 的可访问性兜底，保留。 */
  var KEY_DEFAULTS = {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    jump: 'Space', crouch: 'ShiftLeft', sprint: 'KeyQ',
    lookU: 'KeyF', lookD: 'KeyV',
    inventory: 'KeyE', camera: 'KeyC', post: 'KeyP', help: 'KeyH', mute: 'KeyM',
    restart: 'KeyR', creative: 'KeyG', fly: 'KeyX', settings: 'KeyO',
    cast1: 'Digit1', cast2: 'Digit2', cast3: 'Digit3', cast4: 'Digit4', cast5: 'Digit5'
  };
  var KEY_ACTIONS = Object.keys(KEY_DEFAULTS);
  var KEY_ORDER = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint',
    'lookU', 'lookD', 'inventory', 'camera', 'settings', 'post', 'help', 'mute',
    'restart', 'creative', 'fly', 'cast1', 'cast2', 'cast3', 'cast4', 'cast5'];

  var P = {}, K = {}, listeners = [];
  for (var d in DEFAULTS) P[d] = DEFAULTS[d];
  for (var k in KEY_DEFAULTS) K[k] = KEY_DEFAULTS[k];

  function clampNum(v, lo, hi) { v = +v; return !isFinite(v) ? lo : Math.max(lo, Math.min(hi, v)); }
  function toBool(v) { return v === true || v === 1 || v === 'true' || v === '1'; }
  function persist() {
    try {
      if (window.localStorage) localStorage.setItem(KEY, JSON.stringify({ v: 1, params: P, keys: K }));
    } catch (e) { }
  }
  function load() {
    try {
      if (!window.localStorage) return;
      var s = localStorage.getItem(KEY); if (!s) return;
      var o = JSON.parse(s);
      if (o && o.params) for (var p in DEFAULTS) if (o.params[p] !== undefined) P[p] = o.params[p];
      if (o && o.keys) for (var q in KEY_DEFAULTS) if (o.keys[q]) K[q] = String(o.keys[q]);
    } catch (e) { }
  }
  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](P, K); } catch (e) { } } }
  function onChange(fn) { if (typeof fn === 'function') { listeners.push(fn); return function () { var j = listeners.indexOf(fn); if (j >= 0) listeners.splice(j, 1); }; } return function () { }; }

  /* 画质档：把预设里有的字段一次性写进去；单项 set 仍可覆盖它。 */
  function applyQuality(q) {
    if (!QUALITY[q]) return false;
    P.quality = q;
    var preset = QUALITY[q];
    P.renderScale = preset.renderScale; P.post = preset.post; P.clouds = preset.clouds;
    P.cloudQuality = preset.cloudQuality; P.viewDistance = preset.viewDistance;
    if (preset.ssao !== undefined) P.ssao = preset.ssao;
    persist(); emit(); return true;
  }
  function set(k, v) {
    if (k === 'quality') return applyQuality(String(v));
    if (!(k in DEFAULTS)) return false;
    if (k === 'renderScale') P[k] = clampNum(v, 0.5, 1.5);
    else if (k === 'viewDistance') P[k] = clampNum(v, 64, 240);
    else if (k === 'fov') P[k] = clampNum(v, 50, 110);
    else if (k === 'bob' || k === 'sprintKick' || k === 'shake') P[k] = clampNum(v, 0, 1);
    else if (k === 'ssaoStrength') P[k] = clampNum(v, 0, 1.5);
    else if (k === 'raysStrength') P[k] = clampNum(v, 0, 0.6);
    else if (k === 'cloudQuality') P[k] = (v === 'low' || v === 'mid' || v === 'high') ? v : 'high';
    else if (k === 'camMode') P[k] = (v === 'first' || v === 'shoulderClean' || v === 'shoulder') ? v : 'shoulder';
    else if (k === 'post' || k === 'clouds' || k === 'showFps' || k === 'autoScale' || k === 'ssao' || k === 'rays') P[k] = toBool(v);
    else return false;
    persist(); emit(); return true;
  }
  /* 键位：冲突不静默覆盖——返回 {ok:false, reason:'conflict', with:'camera'}，
     人话由 H.TEXT.settings 翻。同一个动作重复绑同一个键视为无操作成功。 */
  function setKey(action, code) {
    if (!(action in KEY_DEFAULTS)) return { ok: false, reason: 'unknown-action' };
    if (!code || typeof code !== 'string') return { ok: false, reason: 'bad-key' };
    if (K[action] === code) return { ok: true, same: true };
    for (var a in K) if (a !== action && K[a] === code) return { ok: false, reason: 'conflict', with: a };
    K[action] = code; persist(); emit(); return { ok: true };
  }
  function key(action) { return K[action] || KEY_DEFAULTS[action] || ''; }
  function resetKeys() { for (var k in KEY_DEFAULTS) K[k] = KEY_DEFAULTS[k]; persist(); emit(); }
  function reset() {
    for (var d in DEFAULTS) P[d] = DEFAULTS[d];
    for (var k in KEY_DEFAULTS) K[k] = KEY_DEFAULTS[k];
    persist(); emit();
  }
  /* KeyboardSource 的绑定表：只取它认识的动作；cast 是数组，保持与老键位一致。 */
  function bindings() {
    return {
      fwd: key('forward'), back: key('back'), left: key('left'), right: key('right'),
      jump: key('jump'), crouch: key('crouch'), sprint: key('sprint'),
      lookU: key('lookU'), lookD: key('lookD'),
      cast: [key('cast1'), key('cast2'), key('cast3'), key('cast4'), key('cast5')]
    };
  }
  function applyToSource(src) {
    if (!src || !src.b) return false;
    var b = bindings();
    for (var k in b) src.b[k] = b[k];
    return true;
  }
  function spec() {
    return { params: P, keys: K, actions: KEY_ORDER, defaults: DEFAULTS, keyDefaults: KEY_DEFAULTS, quality: QUALITY };
  }

  load();
  G.SETTINGS = {
    DEFAULTS: DEFAULTS, KEY_DEFAULTS: KEY_DEFAULTS, QUALITY: QUALITY, KEY_ORDER: KEY_ORDER,
    get: function (k) { return P[k]; }, key: key, set: set, setKey: setKey,
    applyQuality: applyQuality, reset: reset, resetKeys: resetKeys,
    bindings: bindings, applyToSource: applyToSource, spec: spec, onChange: onChange,
    params: P, keys: K
  };
})(window.GW);
