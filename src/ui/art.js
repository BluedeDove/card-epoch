/* ================= GW.UI.art（像素图章·卡面与方块图标·零中文） =================
   卡面图案与方块图标都在这一层，**表驱动**：ART.cardPainters 是一张 名称 → 画法 的表，
   新增一种图案只加一个条目，不改分支链（旧版是 24 个 else if，改一处要读完整屏）。
   方块图标不是贴图复制：按等轴测画一颗立方体（顶面 + 两个侧面 + 明暗），
   纹理取自世界层同一张像素图集（GW.buildAtlas 的 canvas），所以背包里的方块和地上那块必然同款。

   禁则：零玩家可见中文、零 innerHTML；document 只允许 createElement('canvas')。
   循环与随机：这里只允许**确定性**伪随机（按 id 哈希），否则同一张卡每次打开背包图案都在抖。
   ================================================= */
(function (G) {
  'use strict';
  const UI = G.UI || (G.UI = {});

  /* 确定性小随机：同一个种子每次给同一串数（旧版卡面用 Math.random，重绘一次图案就变一次） */
  function rng(seedStr) {
    let h = 2166136261;
    const s = String(seedStr);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = (h >>> 0) || 1;
    return function () {
      a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0;
      return a / 4294967296;
    };
  }

  /* ---------- 画笔小工具（16×16 像素格） ---------- */
  function ctxOf(canvas, size) {
    canvas.width = size; canvas.height = size;
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, size, size);
    return c;
  }
  function pens(c, S) {
    const px = (x, y, cc) => { c.fillStyle = cc; c.fillRect(x, y, 1, 1); };
    const rect = (x, y, w, h, cc) => { c.fillStyle = cc; c.fillRect(x, y, w, h); };
    const diamond = (cx, cy, r, cc) => {
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
        if (Math.abs(x) + Math.abs(y) <= r) px(cx + x, cy + y, cc);
    };
    const ringOf = (cx, cy, r, cc) => {
      c.strokeStyle = cc; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r, 0, 6.283); c.stroke();
    };
    const star = (n, r0, r1, cc) => {   // 多角星，用于技能/法阵类图案
      c.fillStyle = cc; c.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = i / (n * 2) * 6.283 - 1.57, r = (i % 2) ? r1 : r0;
        const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath(); c.fill();
    };
    return { px, rect, diamond, ringOf, star };
  }

  /* ---------- 卡面画法表：名称 → 怎么画 ---------- */
  const CARD_PAINTERS = {
    flame(c, k) { const { px, diamond } = pens(c, 16); diamond(8, 9, 4, k.col); diamond(8, 9, 2, '#fff3c4'); for (let i = 0; i < 6; i++) px(4 + i * 2, 3 + (i % 2), k.col); },
    burst(c, k) { const { px, diamond } = pens(c, 16); diamond(8, 8, 5, k.col); diamond(8, 8, 2, '#fff3c4'); for (let i = 0; i < 8; i++) px(2 + i * 2, 2 + (i % 3) * 2, k.ac); },
    bolt(c, k) { const { rect } = pens(c, 16); rect(7, 2, 2, 12, k.col); rect(5, 4, 6, 2, k.col); rect(4, 3, 2, 2, '#fff'); },
    shard(c, k) { const { rect } = pens(c, 16); rect(7, 2, 2, 12, k.col); rect(5, 4, 6, 2, k.col); rect(4, 3, 2, 2, '#fff'); },
    pillar(c, k) { const { px, rect } = pens(c, 16); rect(4, 6, 8, 8, k.col); rect(4, 6, 8, 2, '#fff2'); rect(3, 5, 10, 1, k.ac); for (let q = 0; q < 8; q++) px(5 + (q % 4) * 2, 9 + (q >> 2), k.ac); },
    cube(c, k) { const { px, rect } = pens(c, 16); rect(4, 6, 8, 8, k.col); rect(4, 6, 8, 2, '#fff2'); rect(3, 5, 10, 1, k.ac); for (let q = 0; q < 8; q++) px(5 + (q % 4) * 2, 9 + (q >> 2), k.ac); },
    fence(c, k) { const { rect } = pens(c, 16); for (let b = 0; b < 3; b++) { rect(3 + b * 4, 5, 3, 9, k.col); rect(2 + b * 4, 4, 5, 2, k.ac); } },
    wallfire(c, k) { const { rect, diamond } = pens(c, 16); for (let b = 0; b < 3; b++) { rect(3 + b * 4, 5, 3, 9, k.col); rect(2 + b * 4, 4, 5, 2, k.ac); } diamond(8, 3, 2, '#ff7a45'); },
    ring(c, k) { const { px, ringOf } = pens(c, 16); ringOf(8, 8, 5.2, k.col); ringOf(8, 8, 2.6, k.col); px(8, 8, '#fff'); },
    hammer(c, k) { const { px, rect, ringOf } = pens(c, 16); ringOf(8, 8, 5.2, k.col); ringOf(8, 8, 2.6, k.col); px(8, 8, '#fff'); rect(6, 2, 4, 3, k.col); },
    leaf(c, k) { const { rect, diamond } = pens(c, 16); rect(7, 9, 2, 5, '#7a5230'); diamond(8, 6, 4, k.col); diamond(6, 7, 2, k.ac); },
    tree(c, k) { const { rect, diamond } = pens(c, 16); rect(7, 9, 2, 5, '#7a5230'); diamond(8, 6, 4, k.col); diamond(6, 7, 2, k.ac); },
    golem(c, k) { const { rect } = pens(c, 16); rect(4, 4, 8, 9, k.col); rect(5, 6, 2, 2, '#0a0813'); rect(9, 6, 2, 2, '#0a0813'); rect(3, 13, 4, 2, k.ac); rect(9, 13, 4, 2, k.ac); },
    snow(c, k) { const { px } = pens(c, 16); for (let a = 0; a < 6; a++) { const an = a / 6 * 6.283; for (let r = 1; r < 6; r++) px(Math.round(8 + Math.cos(an) * r), Math.round(8 + Math.sin(an) * r), k.col); } px(8, 8, '#fff'); },
    skull(c, k) { const { rect } = pens(c, 16); rect(5, 4, 6, 6, k.col); rect(6, 10, 4, 2, k.ac); rect(6, 6, 2, 2, '#0a0813'); rect(9, 6, 2, 2, '#0a0813'); },
    eye(c, k) { const { px, diamond } = pens(c, 16); diamond(8, 8, 5, k.col); diamond(8, 8, 2, '#0a0813'); px(8, 8, '#fff'); },
    spiral(c, k) { const { px } = pens(c, 16); for (let t = 0; t < 34; t++) { const th = t * 0.45, rr = 1 + t * 0.13; px(Math.round(8 + Math.cos(th) * rr), Math.round(8 + Math.sin(th) * rr), k.col); } },
    pick(c, k) { const { rect } = pens(c, 16); rect(4, 11, 8, 2, '#8b8b93'); rect(7, 4, 2, 8, '#7a5230'); rect(3, 3, 6, 2, k.col); },
    shield(c, k) { const { px, diamond } = pens(c, 16); diamond(8, 8, 5, k.col); diamond(8, 8, 3, k.ac); px(8, 8, '#fff'); },
    anchor(c, k) { const { px, diamond } = pens(c, 16); diamond(8, 8, 5, k.col); diamond(8, 8, 3, k.ac); px(8, 8, '#fff'); },
    down(c, k) { const { rect } = pens(c, 16); for (let i = 0; i < 5; i++) rect(3 + i * 2, 11 - i * 2, 2, 2 + i * 2, k.col); },
    ramp(c, k) { const { rect } = pens(c, 16); for (let i = 0; i < 5; i++) rect(3 + i * 2, 11 - i * 2, 2, 2 + i * 2, k.col); },
    bridge(c, k) { const { rect } = pens(c, 16); for (let x = 2; x < 14; x += 3) rect(x, 8, 2, 3, k.col); rect(2, 11, 12, 1, k.ac); },
    shift(c, k) { const { rect } = pens(c, 16); for (let x = 2; x < 14; x += 3) rect(x, 8, 2, 3, k.col); rect(2, 11, 12, 1, k.ac); },
    spike(c, k) { const { px } = pens(c, 16); for (let p = 0; p < 4; p++) { const bx = 3 + p * 3; for (let h = 0; h < 3 + (p % 2) * 2; h++) px(bx, 12 - h, k.col); } },
    lava(c, k) {
      const { px, rect } = pens(c, 16); const rnd = rng('lava');
      rect(2, 9, 12, 5, '#c8341a');
      for (let l = 0; l < 10; l++) px(2 + Math.floor(rnd() * 12), 9 + Math.floor(rnd() * 5), rnd() < .5 ? '#ffe066' : '#ff7519');
    },
    crystal(c, k) { const { px, diamond } = pens(c, 16); diamond(8, 8, 4, k.col); for (let y = 4; y < 12; y++) px(8, y, '#fff'); },
    plus(c, k) { const { rect } = pens(c, 16); rect(7, 4, 2, 9, k.col); rect(4, 8, 9, 2, k.col); },
    bird(c, k) { const { px, rect } = pens(c, 16); rect(6, 7, 5, 4, k.col); rect(3, 5, 4, 2, k.ac); rect(10, 6, 3, 2, k.ac); px(11, 7, '#fff'); },
    vine(c, k) { const { px } = pens(c, 16); for (let t = 0; t < 12; t++) px(Math.round(8 + Math.sin(t * .8) * 4), 2 + t, k.col); },
    battery(c, k) { const { rect } = pens(c, 16); rect(5, 3, 6, 11, k.col); rect(6, 2, 4, 1, k.ac); rect(6, 6, 4, 2, '#fff2'); rect(7, 9, 2, 3, k.ac); },
    totem(c, k) { const { rect } = pens(c, 16); rect(5, 3, 6, 11, k.col); rect(6, 2, 4, 1, k.ac); rect(6, 6, 4, 2, '#fff2'); rect(7, 9, 2, 3, k.ac); },
    trap(c, k) { const { px, rect } = pens(c, 16); rect(3, 10, 10, 2, k.col); for (let t = 0; t < 5; t++) px(4 + t * 2, 7, k.ac); },
    shatter(c, k) { const { rect } = pens(c, 16); rect(4, 4, 8, 8, k.col); c.strokeStyle = '#0a0813'; c.beginPath(); c.moveTo(4, 12); c.lineTo(12, 4); c.stroke(); },
    star(c, k) { const { rect, diamond } = pens(c, 16); diamond(8, 8, 5, k.col); rect(7, 1, 2, 14, k.ac); rect(1, 7, 14, 2, k.ac); },
    orb(c, k) { const { ringOf, diamond } = pens(c, 16); diamond(8, 8, 4, k.col); ringOf(8, 8, 6, k.ac); },
    wave(c, k) { const { px } = pens(c, 16); for (let x = 1; x < 15; x++) px(x, Math.round(8 + Math.sin(x * .9) * 3), k.col); }
  };
  UI.CARD_PAINTERS = CARD_PAINTERS;

  /* ---------- 卡面入口 ----------
     2026-10-17 重画。旧版三处显廉价：整卡铺横向条纹（缩到 32px 就是一片灰雾）、
     外面再叠一圈 strokeRect（与 CSS 的格子描边重一遍，两个粗细打架）、
     底色不分元素（焰卡与霜卡的图章底完全同色，只剩图案中心一小块有色）。
     新版：井底按元素压两档 → 图案 → 左上受光 / 右下压暗（各 1 档纯色，不用渐变）→
     稀有度宝石（色 + 形状双编码，色盲也能分级）。 */
  const PLATE = { ink: '#07060f', well: '#141126', lip: '#241d44', dark: '#030209' };
  const RARITY_GEM = { common: ['#7f78a2', 3], uncommon: ['#7fd7ff', 4], rare: ['#ffd86b', 5] };
  function shade(hex, t) {           // t<0 压暗、t>0 提亮：整数 alpha 混合，不产生新色阶
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).replace('#', ''));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const to = t > 0 ? 255 : 0, a = Math.abs(t);
    const ch = (v) => Math.round(v + (to - v) * a);
    const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function card(canvas, cardDef, opts) {
    const S = (opts && opts.size) || 16;
    const c = ctxOf(canvas, S);
    const el = (G.ELEMENTS && cardDef && G.ELEMENTS[cardDef.element]) || { color: '#c9d3e0', accent: '#8a94a6' };
    /* 卡面配色（2026-10-17 用户："什么元素就什么配色太保守，要有烟花感、色偏、极端的纯色"）：
       优先用卡自己的 tint（两张色，可以是一对撞色），否则用元素的 spectrum 第 2/3 档
       （比 color/accent 更饱和），再否则才是老口径。G.ELEMENTS 的 color/accent 一律不动，
       HUD 其它地方仍读它们。 */
    const sp = el.spectrum || null;
    const k = {
      col: (cardDef && cardDef.tint && cardDef.tint[0]) || (sp ? sp[1] : el.color),
      ac: (cardDef && cardDef.tint && cardDef.tint[1]) || (sp ? sp[2] : el.accent)
    };
    c.fillStyle = (opts && opts.bg) || PLATE.ink; c.fillRect(0, 0, S, S);
    /* 井底：元素色压到 82% 暗，保证图案（用原色画）与底至少拉开一档 */
    /* 整片井底按元素压暗（旧版中间又盖一层不透明死黑，焰卡与霜卡的底是同一个颜色，
       只有图案中心一小块有色，56 张卡摆一起就分不出阵营） */
    c.fillStyle = shade(k.col, -0.70); c.fillRect(1, 1, S - 2, S - 2);
    c.fillStyle = shade(k.col, -0.86); c.fillRect(2, 2, S - 4, 1); c.fillRect(2, 2, 1, S - 4);
    /* 有烘焙好的 Tiny Dungeon 图标就画图标（整数倍放大，不糊）；没有才回退到程序图案 */
    const iconId = G.CARD_ICON_MAP && cardDef && G.CARD_ICON_MAP[cardDef.id];
    const icon = iconId && G.CARD_ICON_TILES ? G.CARD_ICON_TILES[iconId] : null;
    if (icon) {
      const scale = Math.max(1, Math.floor((S - 2) / 16));
      const ox = Math.floor((S - 16 * scale) / 2), oy = ox;
      /* 先铺 1px 暗影再画本体：亮底/暗底上图标都能立起来 */
      c.fillStyle = '#07060f';
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const ci = icon.px[y * 16 + x];
        if (ci !== 255) c.fillRect(ox + x * scale + scale, oy + y * scale + scale, scale, scale);
      }
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const ci = icon.px[y * 16 + x];
        if (ci === 255) continue;
        c.fillStyle = icon.pal[ci];
        c.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    } else {
      const painter = CARD_PAINTERS[cardDef && cardDef.art] || CARD_PAINTERS.orb;
      c.save();
      if (S !== 16) c.scale(S / 16, S / 16);
      painter(c, k);
      c.restore();
    }
    /* 元素色内框：1px，压住井底与图标的分界（整卡不描边框，边框仍归 CSS 的格子） */
    c.fillStyle = k.ac; c.fillRect(2, 2, S - 4, 1); c.fillRect(2, S - 3, S - 4, 1); c.fillRect(2, 2, 1, S - 4); c.fillRect(S - 3, 2, 1, S - 4);
    /* 受光边与压暗边：各 1 档纯色（不是渐变——渐变在像素风里等于宣布"这是插值出来的"） */
    c.fillStyle = shade(k.ac, 0.18); c.fillRect(1, 1, S - 2, 1); c.fillRect(1, 1, 1, S - 2);
    c.fillStyle = PLATE.dark; c.fillRect(1, S - 2, S - 2, 1); c.fillRect(S - 2, 1, 1, S - 2);
    /* 稀有度宝石：颜色 + 尺寸两档，缩到 32px 也分得出常见 / 罕见 / 稀有 */
    const gem = RARITY_GEM[(cardDef && cardDef.rarity) || 'common'] || RARITY_GEM.common;
    const g = gem[1], gx = S - 2 - g, gy = S - 2 - g;
    c.fillStyle = gem[0]; c.fillRect(gx, gy, g, g);
    c.fillStyle = '#ffffff'; c.fillRect(gx, gy, 1, 1);
    return canvas;
  }

  /* ---------- 方块图标：等轴测立方体（纹理取自世界图集，跟地上那块同源） ---------- */
  let atlasCanvas = null, atlasMeta = null;
  function atlas() {
    if (atlasCanvas) return { canvas: atlasCanvas, perRow: atlasMeta.perRow, size: atlasMeta.size };
    if (!G.buildAtlas || !window.THREE) return null;
    const a = G.buildAtlas();
    atlasCanvas = a.canvas; atlasMeta = { perRow: a.perRow, size: a.size };
    return { canvas: atlasCanvas, perRow: a.perRow, size: a.size };
  }
  function tileOf(a, index) {
    const S = a.size, tx = (index % a.perRow) * S, ty = Math.floor(index / a.perRow) * S;
    return [tx, ty, S];
  }
  /* 把一张 16×16 纹理按平行四边形贴上去（等轴测三面各一次） */
  function face(c, a, tile, p0, u, v, shade) {
    const [tx, ty, S] = tileOf(a, tile);
    c.save();
    c.setTransform(u[0] / S, u[1] / S, v[0] / S, v[1] / S, p0[0], p0[1]);
    c.drawImage(a.canvas, tx, ty, S, S, 0, 0, S, S);
    c.restore();
    if (shade) {
      c.save();
      c.beginPath();
      c.moveTo(p0[0], p0[1]);
      c.lineTo(p0[0] + u[0], p0[1] + u[1]);
      c.lineTo(p0[0] + u[0] + v[0], p0[1] + u[1] + v[1]);
      c.lineTo(p0[0] + v[0], p0[1] + v[1]);
      c.closePath();
      c.fillStyle = 'rgba(0,0,0,' + shade + ')'; c.fill();
      c.restore();
    }
  }
  function block(canvas, blockId, opts) {
    const S = (opts && opts.size) || 32;
    const c = ctxOf(canvas, S);
    const defs = G.BLOCK_DEFS, d = defs && defs[blockId];
    if (!d) return canvas;
    const a = atlas();
    if (!a || !d.tiles) {                       // 没图集（node 里跑回归）时退成色块，不算失败
      c.fillStyle = d.color || '#888'; c.fillRect(S * 0.12, S * 0.12, S * 0.76, S * 0.76);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeRect(S * 0.12 + 0.5, S * 0.12 + 0.5, S * 0.76 - 1, S * 0.76 - 1);
      return canvas;
    }
    const pad = S * 0.06, w = S * 0.46 - pad, h = S * 0.26;
    const topY = S * 0.14;
    const o = [S * 0.5, topY];                                     // 顶面菱形上顶点
    const ux = [w, h], vz = [-w, h];                               // 顶面两条边
    face(c, a, d.tiles[0], [o[0], o[1]], ux, [-(w), (h)], 0);      // 顶
    face(c, a, d.tiles[1], [o[0] - w, o[1] + h], [w, -h], [0, S * 0.42], 0.28);   // 左面（暗）
    face(c, a, d.tiles[1], [o[0], o[1] + h * 2 - h], [w, h], [0, S * 0.42], 0.06); // 右面（略暗）
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(o[0], o[1]); c.lineTo(o[0] + w, o[1] + h); c.lineTo(o[0] + w, o[1] + h + S * 0.42);
    c.lineTo(o[0], o[1] + h * 2 + S * 0.42); c.lineTo(o[0] - w, o[1] + h + S * 0.42);
    c.lineTo(o[0] - w, o[1] + h); c.closePath(); c.stroke();
    return canvas;
  }
  /* 液体 / 无碰撞的方块不画成立方体（水与岩浆画成一滩） */
  function fluid(canvas, blockId, opts) {
    const S = (opts && opts.size) || 32, d = G.BLOCK_DEFS && G.BLOCK_DEFS[blockId];
    const c = ctxOf(canvas, S);
    c.fillStyle = (d && d.color) || '#3b7fd6';
    c.beginPath(); c.ellipse(S / 2, S * 0.6, S * 0.36, S * 0.22, 0, 0, 6.283); c.fill();
    c.fillStyle = 'rgba(255,255,255,.22)';
    c.beginPath(); c.ellipse(S * 0.42, S * 0.55, S * 0.14, S * 0.06, 0, 0, 6.283); c.fill();
    return canvas;
  }

  /* 卡背：牌库 / 弃牌堆这种"只给数量"的堆用，免得画布空着像坏了 */
  function back(canvas, opts) {
    const S = (opts && opts.size) || 32, c = ctxOf(canvas, S);
    c.fillStyle = PLATE.ink; c.fillRect(0, 0, S, S);
    c.fillStyle = PLATE.lip; c.fillRect(2, 2, S - 4, S - 4);
    c.fillStyle = PLATE.well;
    for (let y = 4; y < S - 4; y += 4) for (let x = 4; x < S - 4; x += 4) c.fillRect(x, y, 2, 2);
    c.fillStyle = PLATE.dark; c.fillRect(0, 0, S, 1); c.fillRect(0, S - 1, S, 1); c.fillRect(0, 0, 1, S); c.fillRect(S - 1, 0, 1, S);
    return canvas;
  }

  UI.Art = {
    card, block, fluid, back,
    /* 给物品注册表用：按 item 引用画一格图标 */
    paint(canvas, item, opts) {
      if (!item) return canvas;
      if (item.kind === 'card') return card(canvas, G.CARDS_BY_ID[item.id], opts);
      if (item.kind === 'block') {
        const d = G.BLOCK_DEFS && G.BLOCK_DEFS[item.id];
        return (d && d.solid) ? block(canvas, item.id, opts) : fluid(canvas, item.id, opts);
      }
      return canvas;
    },
    setAtlasSource(a) { atlasCanvas = a.canvas; atlasMeta = { perRow: a.perRow, size: a.size }; },
    resetAtlasSource() { atlasCanvas = null; atlasMeta = null; }
  };
})(window.GW);
