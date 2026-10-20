window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（纯绘制；随机源由调用方注入，保证可复现）
     每种方块的装饰画法。约定：sh(amt) = 在主色上抖动 amt 的取色函数，rnd = 随机源，T = 一格边长。
     每条画法消耗的随机数次数也是契约——旧版是"每点 2 次取位置 + 上色再 1 次"，
     改次数就等于改像素，README 的"同 seed 逐格一致"包含贴图。 */
  var MODES = {};
  function stamp(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
  function scatter(ctx, ox, oy, n, color, rnd, T) {
    for (var i = 0; i < n; i++) scatterOne(ctx, ox, oy, color, rnd, T);
  }
  /* 取随机数的顺序即契约：先 x、再 y、最后上色 */
  function scatterOne(ctx, ox, oy, color, rnd, T) {
    var x = ox + Math.floor(rnd() * T), y = oy + Math.floor(rnd() * T);
    stamp(ctx, x, y, typeof color === 'function' ? color() : color);
  }
  MODES.dirt = function () { };
  MODES.grass = function (ctx, ox, oy, sh, rnd, T) { scatter(ctx, ox, oy, 46, function () { return sh(-0.16); }, rnd, T); };
  MODES.stone = function (ctx, ox, oy, sh, rnd, T) {
    for (var k = 0; k < 4; k++) cracks(ctx, ox, oy, Math.floor(rnd() * T), Math.floor(rnd() * 6), 4 + Math.floor(rnd() * 6), sh, T);
  };
  function cracks(ctx, ox, oy, sy, sx, len, sh, T) {
    for (var m = 0; m < len; m++) stamp(ctx, ox + (sx + m) % T, oy + (sy + (m % 3 === 0 ? 1 : 0)) % T, sh(-0.22));
  }
  /* 原木侧面：每 4 像素一条竖向深纹（整列都画，形成年轮竖纹） */
  MODES.logside = function (ctx, ox, oy, sh, rnd, T) {
    for (var x = 0; x < T; x += 4) for (var y = 0; y < T; y++) stamp(ctx, ox + x, oy + y, sh(-0.14));
  };
  MODES.logtop = function (ctx, ox, oy, sh, rnd, T) { for (var r = 1; r < 8; r += 2) ring(ctx, ox, oy, r, sh); };
  function ring(ctx, ox, oy, r, sh) { for (var i = 0; i < 40; i++) ringDot(ctx, ox, oy, r, sh, i); }
  function ringDot(ctx, ox, oy, r, sh, i) {
    var a = i / 40 * Math.PI * 2;
    stamp(ctx, Math.round(ox + 8 + Math.cos(a) * r), Math.round(oy + 8 + Math.sin(a) * r), sh(i % 4 === 0 ? -0.2 : 0.02));
  }
  MODES.plank = function (ctx, ox, oy, sh, rnd, T) { rows(ctx, ox, oy, 4, function () { return sh(-0.2); }, T); joints(ctx, ox, oy, sh, T); };
  function rows(ctx, ox, oy, step, color, T) {
    for (var y = 0; y < T; y += step) for (var x = 0; x < T; x++) stamp(ctx, ox + x, oy + y, color());
  }
  function joints(ctx, ox, oy, sh, T) {
    for (var x = 0; x < T; x++) stamp(ctx, ox + x, oy + (x % 8 < 4 ? 8 : 3), sh(-0.18));
  }
  MODES.brick = function (ctx, ox, oy, sh, rnd, T) { rows(ctx, ox, oy, 5, function () { return sh(-0.25); }, T); seams(ctx, ox, oy, sh, T); };
  function seams(ctx, ox, oy, sh, T) {
    for (var y = 0; y < T; y++) stamp(ctx, ox + (y < 8 ? 7 : 15) % T, oy + y, sh(-0.25));
  }
  MODES.water = function (ctx, ox, oy, sh, rnd, T) {
    for (var w = 0; w < 5; w++) ripples(ctx, ox, oy, Math.floor(rnd() * T), sh, T);
  };
  function ripples(ctx, ox, oy, wy, sh, T) {
    for (var wx = 0; wx < T; wx++) if ((wx + wy) % 3 !== 0) stamp(ctx, ox + wx, oy + wy, sh(0.12));
  }
  MODES.lava = function (ctx, ox, oy, sh, rnd, T) { scatter(ctx, ox, oy, 26, function () { return rnd() < 0.5 ? '#ffe066' : '#ff3b1f'; }, rnd, T); };
  MODES.leaf = function (ctx, ox, oy, sh, rnd, T) { scatter(ctx, ox, oy, 20, '#1d4015', rnd, T); };
  MODES.ice = function (ctx, ox, oy, sh, rnd, T) {
    for (var k = 0; k < 3; k++) splinter(ctx, ox, oy, Math.floor(rnd() * T), Math.floor(rnd() * T));
  };
  function splinter(ctx, ox, oy, cx, cy) {
    for (var d = 0; d < 6; d++) stamp(ctx, ox + (cx + d) % 16, oy + (cy + (d % 2)) % 16, '#e9f8ff');
  }
  MODES.crystal = function (ctx, ox, oy, sh, rnd, T) { cross(ctx, ox, oy); stamp(ctx, ox + 7, oy + 7, '#ffffff'); stamp(ctx, ox + 8, oy + 8, '#ffffff'); };
  function cross(ctx, ox, oy) {
    for (var g = 0; g < 16; g++) { stamp(ctx, ox + g, oy + g, '#f0d8ff'); stamp(ctx, ox + g, oy + 15 - g, '#7a3fbf'); }
  }
  MODES.obsidian = function (ctx, ox, oy, sh, rnd, T) { scatter(ctx, ox, oy, 24, '#6a4fb0', rnd, T); };
  MODES.sand = function (ctx, ox, oy, sh, rnd, T) { scatter(ctx, ox, oy, 40, function () { return sh(0.07); }, rnd, T); };
  MODES.snow = function (ctx, ox, oy, sh, rnd, T) { scatter(ctx, ox, oy, 18, '#cfe3f7', rnd, T); };
  G.ATLAS_MODES = MODES;
  G.atlasStamp = stamp;
})(window.GW);
