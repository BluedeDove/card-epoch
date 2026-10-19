#!/usr/bin/env node
/* tools/hero_bake.cjs · 玩家模型素材烘焙（不参与游戏运行）

   干什么：把 assets/mage/ 那套专业像素法师素材（OpenGameArt: movicx 的
   "Wizard sprite sheet"，CC-BY 3.0）按"盒子 + 正交投影"烘成运行时数据
   src/hero-sprites.js：每个部件一个 3D 盒，盒子的每个面贴源图哪一段像素，全在这里定死。

   为什么不运行时读 PNG：日常入口是 file:// 双击 index.html，浏览器把 file:// 的图当跨域源，
   画进 canvas 再上传 WebGL 纹理会被 taint（SecurityError）。素材只在构建期读，
   产物是纯数字（调色板 + 每像素 1 字节索引的 base64），运行时用 canvas 现画纹理，
   与 src/world.js 的 buildAtlas 同一条路子。

   投影口径（一个人形 = 四个正交视图，素材正好给了四个方向走路帧，白捡的标定图）：
     front = walk down.png    背 = walk up.png     左身 = walk right.png    右手身 = walk left.png
   部件的盒：宽/高由 front 框定，厚由 side（左身视图）框定；四个侧面各自的取像素框
   **不手填**，由盒子按各视图自己量出的"身体中线列 + 脚底行"投影算出来——
   四张图的中线列并不相同（正 28.5 / 背 34.5 / 侧 34.5），共用一套框会整体错位 6 像素。

   用法：
     node tools/hero_bake.cjs                    # 重新生成 src/hero-sprites.js
     node tools/hero_bake.cjs --print            # 只打印四个视图的标定与盒子清单
     node tools/hero_bake.cjs --contact DIR      # 追加输出：全部面贴图铺一页（QA 用眼睛看）
     node tools/hero_bake.cjs --assemble DIR     # 追加输出：按盒子位置把正/背/侧拼成三张装配图

   三条纪律：
     1) 确定性：同一份输入必须产出逐字节相同的文件（打印 sha256，跑两遍比对）；
     2) 素材不许改像素：只做裁剪 / 索引化 / 阵营配色替换，不重绘；
     3) 部件框一改就必须看 --contact 与 --assemble 的图，别只信数字。
*/
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'mage');
const OUT = path.join(ROOT, 'js', 'hero-sprites.js');

/* ---------------- PNG 解码（非隔行 8bit，另支持 1/2/4/8bit 调色板与 Adam7 隔行） ---------------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let p = 8, ihdr = null, idat = [], plte = null, trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], inter: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('no ihdr');
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[ihdr.color];
  if (!ch) throw new Error('unsupported color type ' + ihdr.color);
  const pal = ihdr.color === 3;
  if (!pal && ihdr.depth !== 8) throw new Error('unsupported bit depth ' + ihdr.depth);
  if (pal && [1, 2, 4, 8].indexOf(ihdr.depth) < 0) throw new Error('unsupported palette depth ' + ihdr.depth);
  const bpp = pal ? 1 : ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const PASSES = ihdr.inter ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const px = Buffer.alloc(ihdr.w * ihdr.h * 4);
  let q = 0;
  for (let ps = 0; ps < PASSES.length; ps++) {
    const sx0 = PASSES[ps][0], sy0 = PASSES[ps][1], xs = PASSES[ps][2], ys = PASSES[ps][3];
    const pw = Math.ceil((ihdr.w - sx0) / xs), ph = Math.ceil((ihdr.h - sy0) / ys);
    if (pw <= 0 || ph <= 0) continue;
    const stride = pal ? Math.ceil(pw * ihdr.depth / 8) : pw * bpp;
    const out = Buffer.alloc(ph * stride), prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[q++], line = raw.slice(q, q + stride); q += stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
        let v = line[x];
        if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
        else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
        out[y * stride + x] = v;
      }
      out.copy(prev, 0, y * stride, y * stride + stride);
    }
    const per = pal ? 8 / ihdr.depth : 1, msk = (1 << ihdr.depth) - 1;
    for (let py = 0; py < ph; py++) for (let pxx = 0; pxx < pw; pxx++) {
      let r, g, b, a = 255;
      if (pal) {
        const idx = (out[py * stride + ((pxx / per) | 0)] >> (8 - ihdr.depth * ((pxx % per) + 1))) & msk;
        r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
        if (trns && trns[idx] !== undefined) a = trns[idx];
      } else {
        const o = (py * pw + pxx) * bpp;
        if (ihdr.color === 6) { r = out[o]; g = out[o + 1]; b = out[o + 2]; a = out[o + 3]; }
        else if (ihdr.color === 2) { r = out[o]; g = out[o + 1]; b = out[o + 2]; }
        else if (ihdr.color === 0) { r = g = b = out[o]; }
        else { r = g = b = out[o]; a = out[o + 1]; }
      }
      const X = sx0 + pxx * xs, Y = sy0 + py * ys, i4 = (Y * ihdr.w + X) * 4;
      px[i4] = r; px[i4 + 1] = g; px[i4 + 2] = b; px[i4 + 3] = a;
    }
  }
  return { w: ihdr.w, h: ihdr.h, data: px };
}
const imgCache = {};
function img(file) {
  if (!imgCache[file]) imgCache[file] = decodePng(fs.readFileSync(path.join(SRC, file)));
  return imgCache[file];
}
function pix(im, x, y) { const i = (y * im.w + x) * 4; return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]]; }

/* ---------------- 阵营配色替换：素材的红点缀 → P1 冷青 / P2 暖橙 ----------------
   判据：偏红且饱和够高（素材的帽带、围巾、袖口共用这一组红）。按明度映射到目标色坡，
   保住原画的受光/背光层次。水晶不参与（它运行时吃元素色，见 crystalize）。 */
const SIDE_TINT = { p1: [0x35, 0xd0, 0xff], p2: [0xff, 0x8a, 0x3d] };
/* 只认素材那组"绛红"（帽带/围巾/袖口/水晶共用）：绿通道必须很低。
   早先按 r>130 且 r−max(g,b)>45 判，把皮带的棕 #85560b（133,86,11）也算成红点缀，
   于是 P1 一换色，法师的腰带和裤子跟着变青——配色替换只能动点缀，不许动主体。 */
function isAccentRed(r, g, b) { return r > 150 && g < 60 && b < 110 && (r - g) > 110 && (r - b) > 90; }
function rampOf(rgb, t) {
  const k = 0.45 + 0.75 * t;
  return [Math.min(255, Math.round(rgb[0] * k)), Math.min(255, Math.round(rgb[1] * k)), Math.min(255, Math.round(rgb[2] * k))];
}
/* 水晶近白化：贴图不带颜色，运行时 material.color 乘元素色才既亮又能换色 */
function crystalize(r, g, b) {
  const t = Math.max(0, Math.min(255, Math.round(0.30 * r + 0.62 * g + 0.30 * b)));
  return [Math.min(255, 150 + Math.round(t * 0.41)), Math.min(255, 120 + Math.round(t * 0.5)), Math.min(255, 110 + Math.round(t * 0.55))];
}

/* ---------------- 部件表 ----------------
   front = 正视图里的像素框 [x0,y0,x1,y1]（定宽和高，也定正/背面贴哪一段）
   side  = 左身视图里的像素框（定厚度）；背面与右身面由盒子投影自动算
   thin  = 细件（杖、水晶）：侧面直接用正视图那段，免得侧视图里本来就空的框把杖贴没 */
const TARGET_H = 1.86;                                  // 帽顶到脚底总高（格）
const PARTS = [
  /* 行列是按 /tmp/rowtag2.py 打出来的每行色性定的：帽尖 6~10、帽檐 11~19（红带在 14 行）、
     脸与兜帽 19~26、红色领口 V 与肩 26~34、袍身与斜挎 32~44、裙摆与靴 42~58、腿 44~61、
     杖头火焰 18~30 / 杖杆 30~61。第一版把这些行框画错（领口的红 V 被算进头部、袖子从 22 行起），
     渲出来就是"头两侧长了一对青色翅膀"。 */
  { name: 'hatCone', front: [22, 5, 35, 11], side: [26, 5, 41, 11], group: 'hat' },
  { name: 'hatBrim', front: [13, 11, 44, 19], side: [19, 11, 47, 19], group: 'hat' },
  { name: 'head', front: [19, 19, 36, 26], side: [27, 18, 40, 26], group: 'head' },
  { name: 'collar', front: [16, 26, 42, 34], side: [24, 26, 42, 34], group: 'torso' },
  { name: 'torso', front: [14, 32, 42, 44], side: [24, 32, 42, 44], group: 'torso' },
  { name: 'armR', front: [8, 29, 21, 46], side: [21, 29, 33, 46], group: 'armR' },
  { name: 'armL', front: [32, 29, 45, 46], side: [29, 29, 42, 46], group: 'armL' },
  { name: 'robe', front: [7, 42, 44, 58], side: [15, 42, 41, 58], group: 'hips' },
  { name: 'legR', front: [19, 44, 30, 61], side: [24, 44, 34, 61], group: 'hips' },
  { name: 'legL', front: [28, 44, 39, 61], side: [26, 44, 37, 61], group: 'hips' },
  { name: 'staffShaft', front: [46, 30, 52, 61], side: [44, 32, 50, 44], group: 'staff', thin: true },
  { name: 'staffGem', front: [45, 18, 53, 30], side: [44, 20, 50, 32], group: 'staff', thin: true, gem: true }
];
const VIEWS = {
  front: { file: 'walk down.png', frame: 0, col0: 8, col1: 43 },
  back: { file: 'walk up.png', frame: 0, col0: 18, col1: 49 },
  L: { file: 'walk right.png', frame: 0, col0: 17, col1: 43 },
  R: { file: 'walk left.png', frame: 0, col0: 21, col1: 47 }
};
const CAL_OPTS = { front: { col0: 8, col1: 43 }, back: { col0: 18, col1: 49 }, L: { col0: 17, col1: 43 }, R: { col0: 21, col1: 47 } };

/* 标定：中线列取"帽檐行"的像素重心（帽檐左右对称，脚和杖都会把重心带偏，帽檐不会）；
   脚底/帽顶只在给定的身体列窗口里找，免得被手里的杖拉高。 */
function calibrate(view) {
  const V = VIEWS[view], o = CAL_OPTS[view] || {}, im = img(V.file), ox = V.frame * 64;
  let sum = 0, wsum = 0;
  for (let y = 11; y <= 13; y++) for (let x = 0; x < 64; x++) if (pix(im, ox + x, y)[3] > 24) { sum += x; wsum++; }
  const cx = sum / Math.max(1, wsum);
  let feet = 0, top = 63;
  for (let y = 0; y < 64; y++) {
    let any = false;
    for (let x = o.col0; x <= o.col1; x++) if (pix(im, ox + x, y)[3] > 24) { any = true; break; }
    if (any) { if (y > feet) feet = y; if (y < top) top = y; }
  }
  return { view: view, im: im, ox: ox, cx: cx, feet: feet, top: top, hpx: feet - top + 1 };
}

function bake() {
  const cal = { front: calibrate('front'), back: calibrate('back'), L: calibrate('L'), R: calibrate('R') };
  const scale = TARGET_H / cal.front.hpx;
  const palette = ['#00000000'];                        // 0 = 透明
  const palIndex = Object.create(null);
  function palIdx(r, g, b, a) {
    if (a < 32) return 0;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (palIndex[key] !== undefined) return palIndex[key];
    palette.push('#' + [r, g, b].map(v => (v < 16 ? '0' : '') + v.toString(16)).join(''));
    palIndex[key] = palette.length - 1;
    return palIndex[key];
  }
  /* 从某个视图的像素框取一张面贴图；gem 走近白化 */
  function grab(c, rect, gem) {
    const x0 = Math.max(0, rect[0]), y0 = Math.max(0, rect[1]);
    const x1 = Math.min(63, rect[2]), y1 = Math.min(63, rect[3]);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 1 || h < 1) return null;
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const col = pix(c.im, c.ox + x0 + x, y0 + y);
      let r = col[0], g = col[1], b = col[2];
      if (gem && col[3] > 24) { const w2 = crystalize(r, g, b); r = w2[0]; g = w2[1]; b = w2[2]; }
      idx[y * w + x] = palIdx(r, g, b, col[3]);
    }
    return { w: w, h: h, idx: idx };
  }
  /* 把模型盒投影到某视图的像素框：sgn 表示该视图"屏幕右"对应模型轴的正方向还是负方向
     （front/back 投影 x，L/R 投影 z；背视图与左身视图的屏幕右正好反着）。
     法线朝向决定水平镜像：贴在 +Z 面（背面）的图要左右翻一次，才不会被盒子自带的面朝向再翻一遍。 */
  function rectOf(c, center, half, sgn, mirror) {
    const p0 = c.cx + sgn * (center.x / scale - half.x / scale), p1 = c.cx + sgn * (center.x / scale + half.x / scale);
    const y0 = c.feet - (center.y + half.y) / scale, y1 = c.feet - (center.y - half.y) / scale;
    const ax = Math.round(Math.min(p0, p1)), bx = Math.round(Math.max(p0, p1));
    return [ax, Math.round(y0), bx, Math.round(y1)];
  }
  /* 顶/底面不许贴整张正面图：那等于把 30 行高的袍子压进 2cm 厚的薄片，渲染出来像帽顶长了一根角
     （第一轮 --shots 就是这么露出来的）。改成取正面框顶两行 / 底两行的不透明像素均色做纯色盖子。 */
  function capColors(c, rect) {
    if (!c || !c.im) return [null, null];
    const im = c.im, ox = c.ox, out = [];
    const bands = [[rect[1], Math.min(rect[1] + 1, rect[3])], [Math.max(rect[3] - 1, rect[1]), rect[3]]];
    for (const band of bands) {
      let n = 0, r = 0, g = 0, bl = 0;
      for (let y = band[0]; y <= band[1]; y++) for (let x = rect[0]; x <= rect[2]; x++) {
        const o = (y * im.w + ox + x) * 4;
        if (im.data[o + 3] <= 24) continue;
        r += im.data[o]; g += im.data[o + 1]; bl += im.data[o + 2]; n++;
      }
      out.push(n ? '#' + [r, g, bl].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('') : null);
    }
    return out;
  }
  const tex = {}, parts = {}, dbgFaces = {};
  for (let i = 0; i < PARTS.length; i++) {
    const P = PARTS[i];
    if (P.front[2] - P.front[0] < 1 || P.front[3] - P.front[1] < 1) throw new Error('部件 ' + P.name + ' 的 front 框太小');
    const cf = cal.front, cs = cal.L;
    const w = (P.front[2] - P.front[0] + 1) * scale, h = (P.front[3] - P.front[1] + 1) * scale;
    const d = (P.side[2] - P.side[0] + 1) * scale;
    const mx = ((P.front[0] + P.front[2]) / 2 - cf.cx) * scale;
    const my = (cf.feet - (P.front[1] + P.front[3]) / 2) * scale;
    const mz = (cs.cx - (P.side[0] + P.side[2]) / 2) * scale;
    const C = { x: mx, y: my }, H = { x: w / 2, y: h / 2 };
    const Cz = { x: mz, y: my }, Hz = { x: d / 2, y: h / 2 };
    const K = '.p' + i;
    const rF = [P.front[0], P.front[1], P.front[2], P.front[3]];
    const rB = rectOf(cal.back, { x: mx, y: my }, { x: w / 2, y: h / 2 }, -1);
    const rL = rectOf(cal.L, { x: mz, y: my }, { x: d / 2, y: h / 2 }, -1);
    const rR = rectOf(cal.R, { x: mz, y: my }, { x: d / 2, y: h / 2 }, 1);
    P._dbg = { f: rF, k: rB, l: rL, r: rR };
    const fF = grab(cf, [P.front[0], P.front[1], P.front[2], P.front[3]], P.gem);
    const fB = P.thin ? fF : grab(cal.back, rB, P.gem);
    const fL = P.thin ? fF : grab(cal.L, rL, P.gem);
    const fR = P.thin ? fF : grab(cal.R, rR, P.gem);
    tex[P.name + K] = fF; tex[P.name + K + 'b'] = fB; tex[P.name + K + 'l'] = fL; tex[P.name + K + 'r'] = fR;
    if (!dbgFaces[P.name]) dbgFaces[P.name] = {};
    dbgFaces[P.name].f = { rect: rF, tex: fF, n: fF ? nz(fF) : 0 };
    dbgFaces[P.name].k = { rect: rB, tex: fB, n: fB ? nz(fB) : 0 };
    dbgFaces[P.name].l = { rect: rL, tex: fL, n: fL ? nz(fL) : 0 };
    dbgFaces[P.name].r = { rect: rR, tex: fR, n: fR ? nz(fR) : 0 };
    parts[P.name] = {
      box: [+w.toFixed(4), +h.toFixed(4), +d.toFixed(4)],
      pos: [+mx.toFixed(4), +my.toFixed(4), +mz.toFixed(4)],
      group: P.group, gem: !!P.gem,
      caps: capColors(cf, rF),                       // [顶盖, 底盖] 纯色
      faces: { f: P.name + K, k: P.name + K + 'b', l: P.name + K + 'l', r: P.name + K + 'r' }
    };
  }
  /* ---------- 第二条路径：公告牌，直接用素材原画的帧 ----------
     盒模型是"从 4 个视图投影出来的再采样"，专业像素被矩形框切碎（袖子像翅膀、袍摆悬空）。
     公告牌不做任何再采样：每个朝向一整套帧，贴图就是原画，四肢由美术自己动。
     锚点取"脚底接触行的中心"（只在最下 7 行里找重心，飘出去的法杖与帽尖不会把角色带偏），
     于是每一帧的落点都对齐碰撞盒的脚底，帧与帧之间的上下起伏也白送。 */
  const BILL = [
    { key: 'front_walk', file: 'walk down.png', frames: 4 },
    { key: 'back_walk', file: 'walk up.png', frames: 4 },
    { key: 'left_walk', file: 'walk left.png', frames: 5 },
    { key: 'right_walk', file: 'walk right.png', frames: 5 },
    { key: 'idle', file: 'mage_idle.png', frames: 7 },
    { key: 'atk_front', file: 'attack front.png', frames: 7 },
    { key: 'atk_back', file: 'attack behind.png', frames: 6 }
  ];
  const sigSeen = Object.create(null), billSets = {};
  function addTex(key, t) {
    if (!t) return null;
    let sig = t.w + 'x' + t.h + '|';
    for (let i = 0; i < t.idx.length; i++) sig += String(t.idx[i]) + ',';
    if (sigSeen[sig]) return sigSeen[sig];
    sigSeen[sig] = key; tex[key] = t; return key;
  }
  BILL.forEach(function (B2) {
    const im = img(B2.file), list = [];
    for (let f = 0; f < B2.frames; f++) {
      const ox = f * 64;
      let x0 = 999, x1 = -1, y0 = 999, y1 = -1;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        if (im.data[((y * im.w) + ox + x) * 4 + 3] <= 24) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) continue;
      let fx0 = 999, fx1 = -1;
      for (let y = Math.max(y0, y1 - 6); y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (im.data[((y * im.w) + ox + x) * 4 + 3] <= 24) continue;
        if (x < fx0) fx0 = x; if (x > fx1) fx1 = x;
      }
      if (fx1 < 0) { fx0 = x0; fx1 = x1; }
      const footX = (fx0 + fx1) / 2;
      const w = (x1 - x0 + 1) * scale, h = (y1 - y0 + 1) * scale;
      const key = addTex(B2.key + '.' + f, grab({ im: im, ox: ox }, [x0, y0, x1, y1], false));
      list.push({ tex: key, x: +(((x0 + x1) / 2 - footX) * scale).toFixed(4),
        y: +(h / 2).toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) });
    }
    billSets[B2.key] = { frames: list.length, list: list };
  });

  const lum = [0];
  for (let i = 1; i < palette.length; i++) {
    const h = palette[i];
    lum.push((0.3 * parseInt(h.slice(1, 3), 16) + 0.6 * parseInt(h.slice(3, 5), 16) + 0.1 * parseInt(h.slice(5, 7), 16)) / 255);
  }
  function sideTable(rgb) {
    const tbl = [0];
    for (let i = 1; i < palette.length; i++) {
      const h = palette[i], r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      if (!isAccentRed(r, g, b)) { tbl.push(i); continue; }
      const t = Math.max(0, Math.min(1, (lum[i] - 0.12) / 0.62));
      const c = rampOf(rgb, t), key = '#' + c.map(v => (v < 16 ? '0' : '') + v.toString(16)).join('');
      let at = palette.indexOf(key);
      if (at < 0) { palette.push(key); at = palette.length - 1; }
      tbl.push(at);
    }
    return tbl;
  }
  return { scale: scale, cal: cal, palette: palette, parts: parts, tex: tex, _dbgFaces: dbgFaces,
    billboards: billSets,
    tables: { p1: sideTable(SIDE_TINT.p1), p2: sideTable(SIDE_TINT.p2) } };
}

function nz(t) { let n = 0; for (let i = 0; i < t.idx.length; i++) if (t.idx[i]) n++; return n; }
function b64(u8) { return Buffer.from(u8).toString('base64'); }
function emit(R) {
  const tex = {};
  for (const k in R.tex) { const t = R.tex[k]; tex[k] = t ? { w: t.w, h: t.h, px: b64(t.idx) } : null; }
  const meta = { source: 'OpenGameArt "Wizard sprite sheet" by movicx',
    url: 'https://opengameart.org/content/wizard-sprite-sheet', license: 'CC-BY 3.0',
    generated: 'node tools/hero_bake.cjs' };
  return '/* GENERATED by tools/hero_bake.cjs - DO NOT EDIT BY HAND. */\n'
    + '(function (G) {\n'
    + '  G.HERO_SPRITES = ' + JSON.stringify({ meta: meta, scale: +R.scale.toFixed(5), palette: R.palette, sides: R.tables, parts: R.parts, tex: tex, billboards: R.billboards }) + ';\n'
    + '})(window.GW = window.GW || {});\n';
}

/* ---------------- 自带 PNG 编码器（不引第三方依赖） ---------------- */
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) { CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c; } }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return ~c;
}
function writePng(file, W, H, px) {
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
  const chunk = function (type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
function blank(W, H, bg) {
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; }
  return px;
}
function blit(px, W, H, t, cx, cy, sx, pal) {
  const x0 = Math.round(cx - t.w * sx / 2), y0 = Math.round(cy - t.h * sx / 2);
  for (let y = 0; y < t.h * sx; y++) for (let x = 0; x < t.w * sx; x++) {
    const idx = t.idx[((y / sx) | 0) * t.w + ((x / sx) | 0)];
    if (!idx) continue;
    const XX = x0 + x, YY = y0 + y; if (XX < 0 || YY < 0 || XX >= W || YY >= H) continue;
    const o = (YY * W + XX) * 4, c = col0(pal, idx);
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
}

function col0(pal, idx) { const h = pal[idx]; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

function contact(R, dir) {
  const keys = Object.keys(R.tex), cell = 110, cols = 6, rows = Math.ceil(keys.length / cols);
  const W = cols * (cell + 8) + 8, H = rows * (cell + 8) + 8, px = blank(W, H, [26, 24, 40]);
  keys.forEach(function (k, n) {
    const t = R.tex[k]; if (!t) return;
    const cx = (n % cols) * (cell + 8) + 8 + cell / 2, cy = ((n / cols) | 0) * (cell + 8) + 8 + cell / 2;
    blit(px, W, H, t, cx, cy, Math.max(1, Math.floor(cell / Math.max(t.w, t.h))), R.palette);
  });
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'hero_contact.png'); writePng(f, W, H, px); return f;
}
/* 装配图：把每个部件的对应面贴图按**模型盒位置**摆回去（每格 44 px）。
   摆出来的轮廓应当与原像素图对得上——对不上就是盒子或投影算错了，这一步比游戏内截图便宜得多。 */
function assemble(R, dir) {
  const per = 44, W = Math.round(2.2 * per), H = Math.round((TARGET_H + 0.2) * per);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  [['f', 'front'], ['k', 'back'], ['l', 'left'], ['r', 'right']].forEach(function (v) {
    const px = blank(W, H, [30, 28, 44]);
    Object.keys(R.parts).forEach(function (nm) {
      const p = R.parts[nm], t = R.tex[p.faces[v[0]]];
      if (!t) return;
      /* 正/背沿模型 x 摆，左/右身沿模型 z 摆（左身视图的屏幕右是 -z，右手身相反） */
      const hx = (v[0] === 'l') ? -p.pos[2] : (v[0] === 'r') ? p.pos[2] : p.pos[0];
      blit(px, W, H, t, W / 2 + hx * per, H - 4 - p.pos[1] * per, Math.max(1, Math.round(per * R.scale)), R.palette);
    });
    const f = path.join(dir, 'hero_assemble_' + v[1] + '.png');
    writePng(f, W, H, px); out.push(f);
  });
  return out;
}

function main() {
const argv = process.argv.slice(2);
const R = bake();
if (argv.indexOf('--print') >= 0) {
  for (const k in R.cal) console.log(k, 'cx=' + R.cal[k].cx.toFixed(2), 'feet=' + R.cal[k].feet, 'top=' + R.cal[k].top);
  console.log('scale', R.scale.toFixed(5), '格/像素');
  Object.keys(R.parts).forEach(function (n) {
    const p = R.parts[n], g = R._dbgFaces[n];
    console.log('  ' + n + ' box=' + p.box.map(v => v.toFixed(2)).join('x') + ' pos=' + p.pos.map(v => v.toFixed(2)).join(','));
    ['f', 'k', 'l', 'r'].forEach(function (fk) {
      const q = g && g[fk];
      console.log('      ' + fk + ' rect=' + JSON.stringify(q ? q.rect : null) + ' 实心像素=' + (q ? q.n : 0));
    });
  });
  process.exit(0);
}
const text = emit(R);
fs.writeFileSync(OUT, text);
console.log('✓ 写出 src/hero-sprites.js ' + (text.length / 1024).toFixed(1) + ' KB  sha256:' +
  crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) +
  '  部件 ' + Object.keys(R.parts).length + ' / 面 ' + Object.keys(R.tex).length + ' / 调色板 ' + (R.palette.length - 1) + ' 色');
const ci = argv.indexOf('--contact');
if (ci >= 0) console.log('✓ QA →', contact(R, argv[ci + 1] || '/tmp/gwhero'));
const ai = argv.indexOf('--assemble');
if (ai >= 0) console.log('✓ 装配图 →', assemble(R, argv[ai + 1] || '/tmp/gwhero').join(' '));
}
/* 只有直接跑才写文件；被 require（tools/hero_check.cjs 复用解码器）时不许动产物 */
if (require.main === module) main();
/* 别的回归脚本（tools/hero_check.cjs）复用同一个解码器与标定，不复制第二份 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodePng: decodePng, SRC: SRC, bake: bake, PARTS_TABLE: PARTS, TARGET_H: TARGET_H };
}