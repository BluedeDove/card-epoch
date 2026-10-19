/* src/ui/fake-cursor.js · 像素假光标（DOM 层，零文案）
   为什么要有：指针锁定（瞄准）时浏览器会藏真鼠标，退出锁定的瞬间又可能因为各种原因不回来；
   直接在 UI 层画一个像素箭头，跟随 pointermove，就能保证"任何时候都看得见鼠标"。
   规则：
     - 瞄准（pointerLocked）时隐藏假光标（准星承担它）；
     - 面板/菜单打开、自由鼠标时显示假光标，并给 body 加 gw-fake-cursor（真光标隐藏）；
     - 输入框获得焦点时切回原生光标（否则选不了字、看不见光标位置）。
   不改任何游戏状态，只读 document.pointerLockElement。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var UI = G.UI || (G.UI = {});
  var el = null, cv = null, visible = false, native = false;

  function paint() {
    cv.width = 14; cv.height = 20;
    var c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 14, 20);
    /* 像素箭头：外黑描边 + 白面 + 黄铜芯 */
    var rows = [
      'X.............', 'XX............', 'XWX...........', 'XWWX..........',
      'XWWWX.........', 'XWWWWX........', 'XWWWWWX.......', 'XWWWWWWX......',
      'XWWWWWWWX.....', 'XWWWWWWWWX....', 'XWWWWWWWWWX...', 'XWWWWWXXXXX...',
      'XWWXWWX.......', 'XWX.XWWX......', 'XX..XWWX......', 'X....XWWX.....',
      '.....XWWX.....', '......XWWX....', '......XWWX....', '.......XX.....'
    ];
    for (var y = 0; y < rows.length; y++) for (var x = 0; x < rows[y].length; x++) {
      var ch = rows[y][x];
      if (ch === 'X') { c.fillStyle = '#07060f'; c.fillRect(x, y, 1, 1); }
      else if (ch === 'W') { c.fillStyle = '#ffe9a6'; c.fillRect(x, y, 1, 1); }
    }
  }
  function mount() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'gwFakeCursor';
    cv = document.createElement('canvas');
    el.appendChild(cv);
    document.body.appendChild(el);
    paint();
    document.addEventListener('pointermove', function (e) {
      if (!el) return;
      el.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    }, true);
    document.addEventListener('pointerlockchange', apply, true);
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) { native = true; apply(); }
    }, true);
    document.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) { native = false; apply(); }
    }, true);
    apply();
  }
  function apply() {
    if (!el) return;
    var locked = !!document.pointerLockElement;
    visible = !locked && !native;
    el.style.display = visible ? 'block' : 'none';
    document.body.classList.toggle('gw-fake-cursor', visible);
  }
  UI.FakeCursor = {
    mount: mount,
    apply: apply,
    visible: function () { return visible; },
    refresh: apply
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(window.GW);
