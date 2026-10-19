#!/usr/bin/env node
/* tools/make_ui_frames.cjs · 生成像素 9-slice 框（零依赖，RGBA PNG）
   用法：node tools/make_ui_frames.cjs
   输出：assets/ui/theme/{panel,panel-inner,button,button-pressed,button-pri,slot}.png
   设计：深靛底 + 黄铜双色边 + 外描边 + 四角铆钉；中心透明（底由 CSS 给）。 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function hex(s) { return [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)]; }
function make(size, border, pal) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, c, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = c[0]; px[i+1] = c[1]; px[i+2] = c[2]; px[i+3] = a === undefined ? 255 : a;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    if (d >= border) continue;
    let c = pal.inner;
    if (d === 0) c = pal.outline;
    else if (d <= 2) c = pal.dark;
    else if (d <= border - 5) c = pal.brass;
    else if (d <= border - 3) c = (x === d || y === d) ? pal.hi : pal.shadow;
    else if (d <= border - 1) c = pal.outline;
    else c = pal.inner;
    set(x, y, c);
  }
  // 四角铆钉：2x2 亮金 + 1px 暗芯，放在边框内圈
  const r = border - 6;
  for (const [cx, cy] of [[r, r], [size - r - 2, r], [r, size - r - 2], [size - r - 2, size - r - 2]]) {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) set(cx + i, cy + j, pal.rivet);
    set(cx, cy, pal.outline);
  }
  return png(size, size, px);
}
const BASE = {
  outline: hex('#0d0b16'), dark: hex('#6b5410'), brass: hex('#9a7f3a'),
  hi: hex('#ffe9a6'), shadow: hex('#4a3a08'), inner: hex('#17132e'), rivet: hex('#ffd86b')
};
const INNER = {
  outline: hex('#0d0b16'), dark: hex('#3d3470'), brass: hex('#6b5cc0'),
  hi: hex('#8b7bff'), shadow: hex('#221b40'), inner: hex('#100d1f'), rivet: hex('#b6aedd')
};
const BTN = {
  outline: hex('#0d0b16'), dark: hex('#3d3470'), brass: hex('#6b5cc0'),
  hi: hex('#b6aedd'), shadow: hex('#221b40'), inner: hex('#221b40'), rivet: hex('#ffe9a6')
};
const BTN_PRI = {
  outline: hex('#6b5410'), dark: hex('#9a7f3a'), brass: hex('#ffd86b'),
  hi: hex('#ffe9a6'), shadow: hex('#c9a06b'), inner: hex('#ffd86b'), rivet: hex('#6b5410')
};
const BTN_HOVER = {
  outline: hex('#0d0b16'), dark: hex('#4a3a08'), brass: hex('#c9a06b'),
  hi: hex('#ffe9a6'), shadow: hex('#6b5410'), inner: hex('#2d2455'), rivet: hex('#ffd86b')
};
const BTN_OFF = {
  outline: hex('#0d0b16'), dark: hex('#3d3470'), brass: hex('#4a4070'),
  hi: hex('#8b83b8'), shadow: hex('#221b40'), inner: hex('#17132e'), rivet: hex('#6b5cc0')
};
const SLOT_SEL = {
  outline: hex('#6b5410'), dark: hex('#ffd86b'), brass: hex('#ffe9a6'),
  hi: hex('#fff6cf'), shadow: hex('#9a7f3a'), inner: hex('#100d1f'), rivet: hex('#ffd86b')
};
const SLOT_DENY = {
  outline: hex('#2a0a12'), dark: hex('#8a2438'), brass: hex('#ff5f7a'),
  hi: hex('#ffb3c0'), shadow: hex('#4a0d1a'), inner: hex('#14070c'), rivet: hex('#ff5f7a')
};
const SLOT = {
  outline: hex('#06050e'), dark: hex('#2d2455'), brass: hex('#3d3470'),
  hi: hex('#6b5cc0'), shadow: hex('#100d1f'), inner: hex('#100d1f'), rivet: hex('#6b5cc0')
};
const out = path.join(ROOT, 'assets/ui/theme');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'panel.png'), make(48, 12, BASE));
fs.writeFileSync(path.join(out, 'panel-inner.png'), make(32, 6, INNER));
fs.writeFileSync(path.join(out, 'button.png'), make(32, 8, BTN));
fs.writeFileSync(path.join(out, 'button-pressed.png'), make(32, 8, BTN_OFF));
fs.writeFileSync(path.join(out, 'button-hover.png'), make(32, 8, BTN_HOVER));
fs.writeFileSync(path.join(out, 'button-pri.png'), make(32, 8, BTN_PRI));
fs.writeFileSync(path.join(out, 'slot.png'), make(32, 6, SLOT));
fs.writeFileSync(path.join(out, 'slot-sel.png'), make(32, 6, SLOT_SEL));
fs.writeFileSync(path.join(out, 'slot-deny.png'), make(32, 6, SLOT_DENY));
console.log('frames written');
