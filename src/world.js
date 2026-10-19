/* ================= GW.World =================
   体素世界：Uint8Array 存储 + 像素纹理图集 + 暴露面烘焙 + DDA 射线
   依据 three.js 官方体素教程的做法：只在没有邻居的方向生成面。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* node（play_probe 等）没有 script 序列：A1-a 的 Lode 两件套在这里挂上。
     浏览器由 index.html 的 script 序列挂载（挂载前 generate() 末尾是守卫调用，退回纯 64 图无矿脉）。
     require 失败 = 文件不在，与"未挂载"同义，静默跳过。 */
  if (typeof require === 'function') {
    try { require('./reachability-gate.js'); } catch (e) {}
    try { require('./lode-planter.js'); } catch (e) {}
  }

  /* ---------- 确定性随机：一个 seed 驱动地形、掉落、洗牌 ---------- */
  G.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  function h2(ix, iz, s) {
    var n = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s, 1274126177)) | 0;
    n = n ^ (n >>> 13); n = Math.imul(n, 1274126177); n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
  }
  function vnoise(x, z, s) {
    var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    var sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    var a = h2(ix, iz, s), b = h2(ix + 1, iz, s), c = h2(ix, iz + 1, s), d = h2(ix + 1, iz + 1, s);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }
  function fbm(x, z, oct, s) {
    var sum = 0, amp = 1, freq = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += vnoise(x * freq, z * freq, s + i * 1013) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  /* ---------- 方块定义 ---------- */
  var B = G.BLOCK = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, SNOW: 5, LOG: 6, LEAF: 7, WATER: 8, PLANK: 9, BRICK: 10, LAVA: 11, ICE: 12, OBSIDIAN: 13, CRYSTAL: 14, BEDROCK: 15 };
  var KEY = ['air', 'grass', 'dirt', 'stone', 'sand', 'snow', 'log', 'leaf', 'water', 'plank', 'brick', 'lava', 'ice', 'obsidian', 'crystal', 'bedrock'];
  var CN = ['空气', '草地', '泥土', '石头', '沙子', '积雪', '原木', '树叶', '水', '木板', '砖石', '岩浆', '冰', '黑曜石', '以太晶', '基岩'];

  /* 每个方块：是否可碰撞、是否遮蔽相邻面、耐久、颜色（粒子/卡面用）、可采集奖励。
     后一半字段是**物质属性表**（GW.CHEM 的唯一数据来源，见 js/chem.js）：
       flammable / burnDur / burnTo / spread   可燃物：点着后烧多久、烧完变成什么、引燃邻居的倍率
       meltsTo                               受热化成的物质（冰/雪 → 水）
       fluid / coolsTo                       液体种类；岩浆被水冷却后变成什么
       freezesTo / quenches / cool           可被冻成什么；能灭火（水）；本身算"寒源"
       stable                                火与寒都拿它没办法（石/砖/黑曜石/晶/基岩）。
                                             写出来是为了让"免疫"有出处，而不是 chem 里 if 一串 id
     口径与 Noita 的物料表一致：**交互规则读属性，不读方块名**。新增方块只要填这几个字段，
     chem 的反应表不用改一行；想加一种新反应也只动 chem 的 REACT 表。
     `burn` 是早期留下的可燃标记（battle/rules 里有判定读它），新代码一律读 flammable。 */
  var DEFS = G.BLOCK_DEFS = [
    { key: 'air', solid: false, opaque: false, hp: 0, color: '#000000' },
    { key: 'grass', solid: true, opaque: true, hp: 1, color: '#5aa832', drop: 'dirt', burn: 'leaf', flammable: true, burnDur: 1.4, burnTo: 'dirt', spread: 0.8 },
    { key: 'dirt', solid: true, opaque: true, hp: 1, color: '#7b5334', drop: 'dirt', stable: true },
    { key: 'stone', solid: true, opaque: true, hp: 3, color: '#8b8b93', drop: 'stone', stable: true },
    { key: 'sand', solid: true, opaque: true, hp: 1, color: '#d9c88d', drop: 'sand', flows: true, stable: true },
    { key: 'snow', solid: true, opaque: true, hp: 1, color: '#eef4fb', drop: 'snow', meltsTo: 'water', cool: true },
    { key: 'log', solid: true, opaque: true, hp: 4, color: '#7a5230', drop: 'log', burn: 'fire', flammable: true, burnDur: 4.6, burnTo: 'air', spread: 0.7 },
    { key: 'leaf', solid: true, opaque: true, hp: 1, color: '#3f7d2c', drop: 'leaf', burn: 'fire', flammable: true, burnDur: 1.7, burnTo: 'air', spread: 1.0 },
    { key: 'water', solid: false, opaque: false, hp: 0, color: '#3b7fd6', liquid: true, fluid: 'water', quenches: true, freezesTo: 'ice', cool: true },
    { key: 'plank', solid: true, opaque: true, hp: 2, color: '#b98a4e', drop: 'plank', burn: 'fire', flammable: true, burnDur: 3.2, burnTo: 'air', spread: 0.85 },
    { key: 'brick', solid: true, opaque: true, hp: 5, color: '#9c5c53', drop: 'stone', stable: true },
    { key: 'lava', solid: false, opaque: false, hp: 0, color: '#ff7519', liquid: true, hot: true, fluid: 'lava', coolsTo: 'obsidian', light: 12 },
    { key: 'ice', solid: true, opaque: false, hp: 2, color: '#a9dcf2', drop: 'ice', slip: true, meltsTo: 'water' },
    { key: 'obsidian', solid: true, opaque: true, hp: 8, color: '#2b2340', drop: 'obsidian', stable: true },
    { key: 'crystal', solid: true, opaque: true, hp: 2, color: '#b26bff', drop: 'crystal', glow: true, stable: true, light: 10 },
    { key: 'bedrock', solid: true, opaque: true, hp: Infinity, color: '#3a3a42', stable: true }
  ];
  DEFS.forEach(function (d, i) { d.id = i; d.cn = CN[i]; d.key = KEY[i]; });
  G.blockKeyToId = {}; DEFS.forEach(function (d) { G.blockKeyToId[d.key] = d.id; });
  /* 世界层的可注册钩子（目前一条）。存"函数数组"而不是让 world.js 去 if (G.CHEM)：
     存储层不该知道有没有物质模拟，就像它不知道该画哪个 chunk。 */
  G.WORLD_HOOKS = { onSet: [] };
  G.isSolidId = function (id) { return id > 0 && DEFS[id].solid; };

  /* ---------- 日照（"光影"里的"影"） ----------
     为什么把太阳遮蔽烘进顶点色，而不是开 renderer.shadowMap：
       · 本作的太阳是固定平行光、地形是静态体素，shadowMap 却要每帧重渲深度图、跟着玩家挪正交相机、
         还得单独处理"水/冰用深度材质会投出实心黑影"；
       · 顶点色只在重建 chunk 时沿太阳方向打几条射线，之后每帧零成本，也没有 shadowmap 锯齿。
     这就是 Minecraft 原版 skylight 的思路（沿轴衰减、取 max(sky, block)）。
     方向只有一个真源 G.SUN_DIR，js/main.js 的 DirectionalLight 读同一份 ——
     否则"灯照的方向"和"影子落的方向"会各说各话（这类两套数一分开就出事的事，AGENTS 里已经记过准星一次）。 */
  /* 太阳仰角从原来的 ~56° 降到 ~51°（/tmp/shadow_final 的同机位对比挑出来的）：
     再高影子的长度就只够贴在树干脚下，看不出"有影"；再低会把朝南那面墙整个点亮，改掉用户已经认过的画面。 */
  var SD = G.SUN_DIR = (function () { var v = [0.65, 0.95, 0.42], l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); return [v[0]/l, v[1]/l, v[2]/l]; })();
  G.SHADOW = { strength: 0.5, steps: 13, step: 0.75, min: 0.5, bias: 0.06 };

  /* ---------- 块光（"火焰照亮周围"的那一半） ----------
     与太阳遮蔽同一套路：洪水填充算出每格的光强，烘进顶点色，每帧零成本。
     为什么不用 THREE.PointLight：① 体素规模下每加一盏灯，所有可见面都多一项光照计算；
     ② 更关键的是它给不出"光在空气里按格衰减、被墙挡住"的方块感（那要 shadowMap，见 PLAN_LIGHTING 第 4/5 档）。
     档位沿用 Minecraft 的 0–15。岩浆/燃烧块/以太晶是光源，**火弹与法阵不是**——它们是实体，
     要照亮周围得走每帧更新的那条路，目前没做，别以为已经做了。 */
  G.LIGHT = {
    on: true, levels: 15, radius: 8,
    decayAir: 1, decayWater: 2, decayIce: 1,
    fireLight: 14,               // 燃烧块比岩浆亮一档：12 档实测看不出"火"，只看出"橙色的墙"
    warm: [1.00, 0.78, 0.52],    // 靠近光源时往这个色温偏（岩浆色），不是简单加白
    maxMix: 0.92,                // 块光最多能把环境光照顶到多少（留一点底，避免贴着火时周围死黑反差过大）
    add: 0.62                    // 加光量（不是乘光）：贴着脸加满 0.62，正好把暗面推到 bloom 阈值之上，光源周围自然出光晕
  };
  /* 发射源小表（idx→强度）+ 每 chunk 计数：绝大多数地图一个光源都没有，
     这条快路径必须便宜到接近零，所以**不在重建时扫全图**。 */
  World.prototype.emitOf = function (id, meta) {
    if (!id) return 0;
    if (meta && meta.kind === 'burning') return G.LIGHT.fireLight;
    return DEFS[id].light || 0;
  };
  World.prototype.ensureEm = function () {
    if (this._emBuilt) return;
    this._em = new Map(); this._emBy = {};
    var total = this.SX * this.SY * this.SZ;
    for (var i = 0; i < total; i++) {
      var id = this.blocks[i]; if (!id) continue;
      var s = this.emitOf(id, this.meta.get(i)); if (!s) continue;
      this._em.set(i, s);
      var x = i % this.SX, t = (i - x) / this.SX, z = t % this.SZ, y = (t - z) / this.SZ;
      var k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
      this._emBy[k] = (this._emBy[k] || 0) + 1;
    }
    this._emBuilt = true;
  };
  World.prototype.emCountIn = function (cx, cz) {
    if (!this._emBuilt || !this._em.size) return 0;
    return this._emBy[cx + ',' + cz] || 0;
  };
  /* 光源变化或被挡光的东西被打通时，要重算的是**周围一圈 chunk**：
     光半径 8 < CHUNK，所以 ±1 个 chunk 就够（与太阳影子那条同一套边界推理）。
     周围没有光源就直接返回，不让"拆一块石头"拖出九宫格重建。 */
  World.prototype.lightDirty = function (cx, cz) {
    this.ensureEm();
    if (!this._em.size) return;
    var near = 0, ox, oz;
    for (ox = -1; ox <= 1; ox++) for (oz = -1; oz <= 1; oz++) near += this.emCountIn(cx + ox, cz + oz);
    if (!near) return;
    for (ox = -1; ox <= 1; ox++) for (oz = -1; oz <= 1; oz++) {
      var k = (cx + ox) + ',' + (cz + oz);
      if (this._lf) delete this._lf[k];
      this.dirty.add(k);
      if (this._yr) delete this._yr[k];
    }
  };
  var lfBuf = null, lfBufLen = 0, lfQ = null;
  /* 一个 chunk 的光场：在 chunk 外扩 radius 的箱子里做 BFS，结果缓存到下次该 chunk 变脏。
     三个 pass 会各调一次，靠缓存只算一遍。 */
  World.prototype.lightField = function (cx, cz) {
    if (!G.LIGHT.on) return null;
    this.ensureEm();
    if (!this._em.size) return null;
    if (!this._lf) this._lf = {};
    var key = cx + ',' + cz;
    if (this._lf[key]) return this._lf[key];
    var L = G.LIGHT, r = L.radius, self = this;
    var bx0 = Math.max(0, cx * CHUNK - r - 1), bx1 = Math.min(this.SX - 1, cx * CHUNK + CHUNK + r);
    var bz0 = Math.max(0, cz * CHUNK - r - 1), bz1 = Math.min(this.SZ - 1, cz * CHUNK + CHUNK + r);
    var yr = this.chunkYRange(cx, cz);
    var by0 = Math.max(0, yr[0] - r - 1), by1 = Math.min(this.SY - 1, yr[1] + r + 1);
    var w = bx1 - bx0 + 1, h = by1 - by0 + 1, d = bz1 - bz0 + 1, vol = w * h * d;
    if (lfBufLen < vol) { lfBuf = new Int8Array(vol); lfBufLen = vol; lfQ = new Int32Array(Math.max(4096, vol * 2)); }
    var arr = lfBuf; arr.fill(0, 0, vol);
    var q = lfQ, head = 0, tail = 0;
    function costAt(x, y, z) {
      var id = self.blocks[(y * self.SZ + z) * self.SX + x];
      if (!id) return L.decayAir;
      var dd = DEFS[id];
      if (dd.opaque) return -1;                      // 挡光：不进格、不传播
      if (dd.liquid && id === B.WATER) return L.decayWater;
      if (!dd.opaque) return L.decayIce;             // 冰这类看穿但不流动的
      return L.decayAir;
    }
    var it = this._em.entries(), e;
    while (!(e = it.next()).done) {
      var i = e.value[0], s = e.value[1];
      var x = i % this.SX, t = (i - x) / this.SX, z = t % this.SZ, y = (t - z) / this.SZ;
      if (x < bx0 || x > bx1 || y < by0 || y > by1 || z < bz0 || z > bz1) continue;
      var bi = ((y - by0) * d + (z - bz0)) * w + (x - bx0);
      if (arr[bi] >= s) continue;
      arr[bi] = s; if (tail >= q.length) continue; q[tail++] = bi;
    }
    var DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];
    while (head < tail) {
      var cur = q[head++];
      var v = arr[cur];
      if (v <= 1) continue;
      var ix = cur % w, iz = ((cur - ix) / w) % d, iy = ((cur - ix) / w - iz) / d;
      for (var dir = 0; dir < 6; dir++) {
        var nx = ix + DX[dir], ny = iy + DY[dir], nz = iz + DZ[dir];
        if (nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= d) continue;
        var cst = costAt(bx0 + nx, by0 + ny, bz0 + nz);
        if (cst < 0) continue;
        var nbi = (ny * d + nz) * w + nx, ns = v - cst;
        if (ns > arr[nbi]) { arr[nbi] = ns; if (tail < q.length) q[tail++] = nbi; }
      }
    }
    var out = {
      arr: arr, bx0: bx0, by0: by0, bz0: bz0, w: w, h: h, d: d, levels: L.levels,
      get: function (x, y, z) {
        var lx = x - bx0, ly = y - by0, lz = z - bz0;
        if (lx < 0 || ly < 0 || lz < 0 || lx >= w || ly >= h || lz >= d) return 0;
        return arr[(ly * d + lz) * w + lx];
      }
    };
    this._lf[key] = out;
    return out;
  };
  /* 一个点的日照可见性：从该点沿太阳方向步进取样，撞到任何 opaque 方块就是全挡。
     注意口径与 cornerAO 一致 —— 用 DEFS[].opaque，所以冰（opaque:false）与水都不挡光，
     不然整个冰湖底下会莫名变黑。steps*step ≈ 9.5 格，是"影子最远能拖多远"，也是 set() 里
     跨 chunk 传播脏标记的半径依据（9.5 < CHUNK，所以补一圈相邻 chunk 就够）。 */
  /* 每列"最高 opaque 方块的高度"，给 sunVis 用；-2=没算过，-1=整列不挡光。
     为什么不用逐次三维采样：一个 chunk 重建要 ~1500 面 × 4 角 × 13 步 ≈ 7.8 万次 get()，
     实测把重建时间从 35ms 拖到 52ms（36 块），卡片改地形时会在 feel_probe 里露成一次长帧。
     换成列高缓存后每列只扫一次（SY≈40），取样变成一次数组读。
     代价要写清：这是"整列取最高 opaque"，所以悬空单块会把它下面整列都算成挡光——
     对本作反而合适（树冠就该在脚下投出一片荫），但别把它当成通用 shadow map。 */
  World.prototype.colTop = function (x, z) {
    if (x < 0 || z < 0 || x >= this.SX || z >= this.SZ) return -1;
    if (!this._ct) { this._ct = new Int16Array(this.SX * this.SZ); this._ct.fill(-2); }
    var ci = z * this.SX + x, c = this._ct;
    if (c[ci] !== -2) return c[ci];
    var top = -1;
    for (var y = this.SY - 1; y >= 0; y--) {
      var id = this.blocks[(y * this.SZ + z) * this.SX + x];
      if (id && DEFS[id].opaque) { top = y; break; }
    }
    c[ci] = top;
    return top;
  };
  World.prototype.sunVis = function (px, py, pz) {
    var sh = G.SHADOW, t0 = sh.min, st = sh.steps, dp = sh.step;
    for (var i = 0; i < st; i++) {
      var t = t0 + i * dp;
      var sx = Math.floor(px + SD[0] * t), sy = Math.floor(py + SD[1] * t), sz = Math.floor(pz + SD[2] * t);
      /* 列高只当**快筛**用，判定仍然逐格问方块：
         colTop < sy = 这一列最高的 opaque 都在取样高度之下 → 射线一定穿过空气，直接跳过（开阔天空的绝大多数取样走这条）；
         colTop ≥ sy 时不能就此认定挡光——那可能只是同一列里更高处的树冠，此时才付一次 get()。
         先前写成"colTop ≥ sy 就是挡"，实测把阴凉占比从 44.6% 推到 62.8%（整片地面被树冠一律抹黑），
         是 post_check 的"阴凉占比"判据把它拦下来的。 */
      if (this.colTop(sx, sz) < sy) continue;
      var id = this.get(sx, sy, sz);
      if (id && DEFS[id].opaque) return 0;
    }
    return 1;
  };
  G.isOpaqueId = function (id) { return id > 0 && DEFS[id].opaque; };

  /* ---------- 像素纹理图集（程序化生成，不依赖外部图片） ---------- */
  var TILE = 16, PER_ROW = 16;
  function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
  function shade(hex, amt, rnd) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var j = amt * (0.6 + rnd() * 0.8);
    r = Math.max(0, Math.min(255, Math.round(r + j * 255)));
    g = Math.max(0, Math.min(255, Math.round(g + j * 255)));
    b = Math.max(0, Math.min(255, Math.round(b + j * 255)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  // 为每种方块画 top/side/bottom 三张 16x16 像素图，返回 tile 索引
  function buildAtlas() {
    var canvas = document.createElement('canvas');
    var rows = 4;
    canvas.width = TILE * PER_ROW; canvas.height = TILE * rows;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var rnd = G.mulberry32(20261016);
    var tiles = [];
    var cursor = 0;
    function paint(fn) {
      var index = cursor++; var tx = (index % PER_ROW) * TILE, ty = Math.floor(index / PER_ROW) * TILE;
      fn(tx, ty);
      return index;
    }
    function fillTile(base, jitter, mode) {
      return paint(function (ox, oy) {
        for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
          var j = (rnd() - 0.5) * jitter;
          px(ctx, ox + x, oy + y, shade(base, j, rnd));
        }
        if (mode === 'grass') {
          for (var i = 0; i < 46; i++) px(ctx, ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), shade(base, -0.16, rnd));
        } else if (mode === 'stone') {
          for (var k = 0; k < 4; k++) {
            var sy = Math.floor(rnd() * TILE), sx = Math.floor(rnd() * 6), len = 4 + Math.floor(rnd() * 6);
            for (var m = 0; m < len; m++) px(ctx, ox + (sx + m) % TILE, oy + (sy + (m % 3 === 0 ? 1 : 0)) % TILE, shade(base, -0.22, rnd));
          }
        } else if (mode === 'logside') {
          for (var x2 = 0; x2 < TILE; x2 += 4) for (var y2 = 0; y2 < TILE; y2++) px(ctx, ox + x2, oy + y2, shade(base, -0.14, rnd));
        } else if (mode === 'logtop') {
          for (var r = 1; r < 8; r += 2) ctx2ring(ctx, ox, oy, r, base, rnd);
        } else if (mode === 'plank') {
          for (var yb = 0; yb < TILE; yb += 4) for (var xb = 0; xb < TILE; xb++) px(ctx, ox + xb, oy + yb, shade(base, -0.2, rnd));
          for (var xv = 0; xv < TILE; xv++) px(ctx, ox + xv, oy + (xv % 8 < 4 ? 8 : 3), shade(base, -0.18, rnd));
        } else if (mode === 'brick') {
          for (var yb2 = 0; yb2 < TILE; yb2 += 5) for (var xb2 = 0; xb2 < TILE; xb2++) px(ctx, ox + xb2, oy + yb2 % TILE, shade(base, -0.25, rnd));
          for (var y3 = 0; y3 < TILE; y3++) { px(ctx, ox + (y3 < 8 ? 7 : 15) % TILE, oy + y3, shade(base, -0.25, rnd)); }
        } else if (mode === 'water') {
          for (var w = 0; w < 5; w++) {
            var wy = Math.floor(rnd() * TILE);
            for (var wx = 0; wx < TILE; wx++) if ((wx + wy) % 3 !== 0) px(ctx, ox + wx, oy + wy, shade(base, 0.12, rnd));
          }
        } else if (mode === 'lava') {
          for (var l = 0; l < 26; l++) px(ctx, ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), rnd() < 0.5 ? '#ffe066' : '#ff3b1f');
        } else if (mode === 'leaf') {
          for (var q = 0; q < 20; q++) px(ctx, ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), '#1d4015');
        } else if (mode === 'icesheen' || mode === 'icecrack') {
          /* 冰分两张图：水面（顶面）用高光带，侧面用裂纹。
             只有一张图时整湖 45° 条纹会跨方块连成"斑马线"（实测俯拍/平视都很明显），
             顶/侧分开后平视看到的是"冰里裂开"，俯视才看到"表面反光"。 */
          function icCrack(sx, sy, len, c) {
            var ix = sx, iy = sy;
            for (var ik = 0; ik < len; ik++) {
              px(ctx, ox + ((ix % TILE) + TILE) % TILE, oy + ((iy % TILE) + TILE) % TILE, c);
              if (rnd() < 0.5) ix += 1; else iy += (rnd() < 0.62 ? 1 : -1);
            }
          }
          if (mode === 'icesheen') {                             // 顶面：一条主反光带 + 一条弱反光，别铺满
            for (var il = 0; il < TILE; il++) {
              px(ctx, ox + il, oy + (il + 2) % TILE, 'rgba(255,255,255,0.9)');
              px(ctx, ox + il, oy + (il + 3) % TILE, 'rgba(224,245,255,0.42)');
            }
            for (var il2 = 4; il2 < 12; il2++) px(ctx, ox + il2, oy + (il2 + 9) % TILE, 'rgba(255,255,255,0.26)');
            icCrack(2, 1, 7, 'rgba(92,146,184,0.85)');
            icCrack(11, 6, 5, 'rgba(92,146,184,0.6)');
          } else {                                               // 侧面：裂纹为主，几段短反光，不带跨格长条
            icCrack(2, 1, 9, 'rgba(74,128,168,0.95)');
            icCrack(9, 3, 8, 'rgba(74,128,168,0.9)');
            icCrack(1, 10, 6, 'rgba(74,128,168,0.8)');
            for (var i3 = 0; i3 < 5; i3++) px(ctx, ox + (3 + i3) % TILE, oy + 3, 'rgba(236,249,255,0.55)');
            for (var i4 = 0; i4 < 4; i4++) px(ctx, ox + (9 + i4) % TILE, oy + 11, 'rgba(236,249,255,0.4)');
          }
          for (var ib = 0; ib < (mode === 'icesheen' ? 9 : 6); ib++) {   // 气泡：白点 + 右下压暗，做出"冻在里面"的厚度
            var ipx = 1 + Math.floor(rnd() * (TILE - 2)), ipy = 1 + Math.floor(rnd() * (TILE - 2));
            px(ctx, ox + ipx, oy + ipy, 'rgba(255,255,255,0.95)');
            px(ctx, ox + (ipx + 1) % TILE, oy + (ipy + 1) % TILE, 'rgba(104,152,188,0.6)');
          }
        } else if (mode === 'crystal') {
          for (var gg = 0; gg < TILE; gg++) { px(ctx, ox + gg, oy + gg, '#f0d8ff'); px(ctx, ox + gg, oy + TILE - 1 - gg, '#7a3fbf'); }
          px(ctx, ox + 7, oy + 7, '#ffffff'); px(ctx, ox + 8, oy + 8, '#ffffff');
        } else if (mode === 'obsidian') {
          for (var o = 0; o < 24; o++) px(ctx, ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), '#6a4fb0');
        } else if (mode === 'sand') {
          for (var s2 = 0; s2 < 40; s2++) px(ctx, ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), shade(base, 0.07, rnd));
        } else if (mode === 'snow') {
          for (var s3 = 0; s3 < 18; s3++) px(ctx, ox + Math.floor(rnd() * TILE), oy + Math.floor(rnd() * TILE), '#cfe3f7');
        }
        // 边缘描暗，强化像素立体感；冰自己画"上亮框 + 下暗边"，边界才读得出是一块固体
        if (mode === 'icesheen' || mode === 'icecrack') {
          for (var e0 = 0; e0 < TILE; e0++) {
            px(ctx, ox + e0, oy, 'rgba(246,253,255,0.95)');
            px(ctx, ox + e0, oy + TILE - 1, 'rgba(58,106,142,0.9)');
          }
        } else {
          for (var e = 0; e < TILE; e++) {
            px(ctx, ox + e, oy, shade(base, 0.06, rnd));
            px(ctx, ox + e, oy + TILE - 1, shade(base, -0.14, rnd));
          }
        }
      });
    }
    function ctx2ring(c2, ox, oy, r, base, rr) {
      for (var i = 0; i < 40; i++) {
        var a = i / 40 * Math.PI * 2;
        var x = Math.round(ox + 8 + Math.cos(a) * r), y = Math.round(oy + 8 + Math.sin(a) * r);
        px(ctx, x, y, shade(base, (i % 4 === 0 ? -0.2 : 0.02), rr));
      }
    }
    function flat(c1, c2) {
      return paint(function (ox, oy) {
        for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) px(ctx, ox + x, oy + y, ((x >> 2) + (y >> 2)) % 2 === 0 ? c1 : c2);
      });
    }
    DEFS.forEach(function (d) {
      if (d.id === 0) { d.tiles = [0, 0, 0]; return; }
      var top, side, bottom;
      switch (d.key) {
        case 'grass': side = fillTile('#7b5334', 0.16, 'dirt'); bottom = side; top = fillTile('#5aa832', 0.2, 'grass'); break;
        case 'log': side = fillTile('#7a5230', 0.12, 'logside'); top = fillTile('#a5794a', 0.1, 'logtop'); bottom = top; break;
        case 'plank': side = top = bottom = fillTile('#b98a4e', 0.12, 'plank'); break;
        case 'brick': side = top = bottom = fillTile('#9c5c53', 0.12, 'brick'); break;
        case 'water': side = top = bottom = fillTile('#3b7fd6', 0.1, 'water'); break;
        case 'lava': side = top = bottom = fillTile('#ff7519', 0.18, 'lava'); break;
        /* 底色按"亮度必须和雾/天空分家"选：雾 0x9ec9ff 亮度约 203，原来的 #a9dcf2 约 191、#8ec9e6 约 190——
           只差 12 级，在白天空 + 浅蓝雾里就是"什么都看不到"。取 #74add6（亮度约 164，落在调研给的 150~165 区间），
           保住青蓝相、不去蹭以太晶的紫。顶面画反光带、侧面画裂纹，两张图是为了避免 45° 条纹跨方块连成斑马线。 */
        case 'ice': top = fillTile('#74add6', 0.05, 'icesheen'); side = bottom = fillTile('#74add6', 0.05, 'icecrack'); break;
        case 'crystal': side = top = bottom = fillTile('#8a3fd8', 0.12, 'crystal'); break;
        case 'obsidian': side = top = bottom = fillTile('#2b2340', 0.14, 'obsidian'); break;
        case 'stone': side = top = bottom = fillTile('#8b8b93', 0.14, 'stone'); break;
        case 'sand': side = top = bottom = fillTile('#d9c88d', 0.12, 'sand'); break;
        case 'snow': side = top = bottom = fillTile('#eef4fb', 0.08, 'snow'); break;
        case 'leaf': side = top = bottom = fillTile('#3f7d2c', 0.22, 'leaf'); break;
        case 'dirt': side = top = bottom = fillTile('#7b5334', 0.16, 'dirt'); break;
        case 'bedrock': side = top = bottom = fillTile('#3a3a42', 0.2, 'stone'); break;
        default: side = top = bottom = flat(d.color, '#000000');
      }
      d.tiles = [top, side, bottom];
    });
    // tile 0 留给空气：画个纯黑（不参与渲染）
    var tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.encoding = THREE.sRGBEncoding;
    return { texture: tex, canvas: canvas, perRow: PER_ROW, rows: rows, size: TILE };
  }
  G.buildAtlas = buildAtlas;

  /* ---------- 世界 ---------- */
  var CHUNK = 16;
  function World(opts) {
    this.SX = opts.size[0]; this.SY = opts.size[1]; this.SZ = opts.size[2];
    this.seed = opts.seed >>> 0;
    this.sea = opts.sea === undefined ? 12 : opts.sea;
    this.blocks = new Uint8Array(this.SX * this.SY * this.SZ);
    this.biomes = new Uint8Array(this.SX * this.SZ);
    this.meta = new Map();          // idx -> {hp, owner, born, kind:'built'|'burning'|'frozen'|'mine'}
    this.dirty = new Set();
    this.objects = [];              // chunk meshes（渲染层填充）
    this.material = null;
    this.group = null;
    this.biomeNames = ['forest', 'desert', 'snow'];
    this.biomeCN = ['翠绿林海', '黄沙遗迹', '霜噬雪原'];
    /* 出生点内缩收进 opts（GAMEPLAY §7.1 条 4）：64 图对角 pad=9（定案 §2.4.1）；
       历史上 96 图是 7，需要旧值时显式传 opts.spawnPad。 */
    this.spawnPad = opts.spawnPad === undefined ? 9 : opts.spawnPad;
    /* opts.lodeSalt：Lode 直通单盐种植（不做 8 盐竞选）——play_probe L4c 用它生成
       "同 seed + 该 salt 一次生成"的对照图，核竞选/回滚零残迹。常规对局不传 = 竞选。 */
    this.lodeSalt = opts.lodeSalt;
    /* opts.lodes：这张图要不要长矿脉（default false）。
       为什么是显式开关而不是"按尺寸猜"：矿脉放置会整平出生点→中矿走廊、改写出生区地形，
       凡是只关心别的机制的量具（cards_probe 的 64×40×64、determinism 的对照图、菜单背景世界）
       一旦被动长上矿脉，地形一变断言就被带崩——2026-10-18 T2 用尺寸守卫时实测 cards_probe 62/67。
       所以"这张世界是关卡图"由调用方声明：session 按地图预设的 lodes>0 传 true，
       play_probe / lode_scale_check / endgame_probe / rational_probe / atmos_check 显式传 true，
       其余一律默认不长。同 seed 逐格一致仍成立（开关只是参数，不进随机流）。 */
    this.lodesOn = opts.lodes === true;
  }
  World.prototype.idx = function (x, y, z) { return (y * this.SZ + z) * this.SX + x; };
  World.prototype.inB = function (x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.SX && y < this.SY && z < this.SZ; };
  World.prototype.get = function (x, y, z) { if (!this.inB(x, y, z)) return 0; return this.blocks[this.idx(x, y, z)]; };
  World.prototype.getDef = function (x, y, z) { return DEFS[this.get(x, y, z)]; };
  World.prototype.solidAt = function (x, y, z) { return this.inB(x, y, z) && this.getDef(x, y, z).solid; };
  World.prototype.set = function (x, y, z, id, extra) {
    if (!this.inB(x, y, z)) return false;
    var i = this.idx(x, y, z);
    if (this.blocks[i] === id && !extra) return false;
    var prev = this.blocks[i];
    var prevMeta = this.meta.get(i);
    this.blocks[i] = id;
    if (this._ct) this._ct[z * this.SZ + x] = -2;   // 列高缓存随本次改动失效（挡光高度变了）
    /* extra === true 是"清掉这格的元数据"（灭火后要摘掉 burning 标记，方块本身还在）。
       原来只有"合并 extra"和"id=0 时删格才删 meta"两条路，灭火那种
       "同一种方块、状态变了"的情形没有出口，只能留着 burning 让顶点色一直是橙色。 */
    if (extra === true) this.meta.delete(i);
    else if (extra) this.meta.set(i, Object.assign(this.meta.get(i) || {}, extra));
    else if (id === 0) this.meta.delete(i);
    var cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    this.dirty.add(cx + ',' + cz);
    /* 块光登记表：只在"这一格的自发光强度真的变了"或"挡光物被打通/堵上"时才动。
       地形生成期（_emBuilt 还没就绪）不登记——那时大量方块是直接写进 blocks 的，
       由 ensureEm 在全图扫一遍兜底，避免两套来源打架。 */
    if (this._emBuilt) {
      var pe = this.emitOf(prev, prevMeta), ne = this.emitOf(id, this.meta.get(i));
      if (pe !== ne) {
        var bk = cx + ',' + cz;
        this._emBy = this._emBy || {};
        if (ne > 0) { this._em.set(i, ne); this._emBy[bk] = (this._emBy[bk] || 0) + (pe > 0 ? 0 : 1); }
        else { this._em.delete(i); this._emBy[bk] = Math.max(0, (this._emBy[bk] || 0) - (pe > 0 ? 1 : 0)); }
        this.lightDirty(cx, cz);
      } else if (prev && DEFS[prev].opaque !== (id ? DEFS[id].opaque : false)) {
        this.lightDirty(cx, cz);   // 拆墙/火烧穿：光路变了，光源另一侧要亮起来
      }
    }
    if (this._yr) { delete this._yr[cx + ',' + cz]; delete this._yr[(cx - 1) + ',' + cz]; delete this._yr[(cx + 1) + ',' + cz]; delete this._yr[cx + ',' + (cz - 1)]; delete this._yr[cx + ',' + (cz + 1)]; }
    if (x % CHUNK === 0) this.dirty.add((cx - 1) + ',' + cz);
    if (x % CHUNK === CHUNK - 1) this.dirty.add((cx + 1) + ',' + cz);
    if (z % CHUNK === 0) this.dirty.add(cx + ',' + (cz - 1));
    if (z % CHUNK === CHUNK - 1) this.dirty.add(cx + ',' + (cz + 1));
    /* 影子也跨 chunk：挡光物变了，被照的面在**背阳一侧**最多 9.5 格外（见 SHADOW.steps*step）。
       只有本次涉及 opaque 方块才补——水/冰/岩浆不挡光，火苗蔓延那种高频小改动不会把周围 chunk 全拖去重建。 */
    /* prev === id = 只换状态不换方块（点燃 / 灭火），挡光高度一点没动 → 不补周围 chunk 的脏标记。
       少了这道闸， chem 每点着一片树叶就要连带重建背阳侧 3 个 chunk（实测一片树冠烧起来
       能把 flushDirty 的 2 格/帧预算整个吃掉，脚下地面跟着卡）。 */
    if (G.SHADOW.strength > 0 && prev !== id && ((id && DEFS[id].opaque) || (prev && DEFS[prev].opaque))) {
      var ox = SD[0] >= 0 ? -1 : 1, oz = SD[2] >= 0 ? -1 : 1, keys = [(cx + ox) + ',' + cz, cx + ',' + (cz + oz), (cx + ox) + ',' + (cz + oz)];
      for (var ki = 0; ki < keys.length; ki++) {
        this.dirty.add(keys[ki]);
        if (this._yr) delete this._yr[keys[ki]];
      }
    }
    /* 物质交互的唤醒通道：谁改了格子，GW.CHEM 就把这格与六个邻居排进激活队列。
       存储层不知道有什么化学反应（只遍历一张注册钩子的空数组），所以 chem 不加载时
       这里零成本，加载时也不必让 world.js 反过来依赖它。 */
    var hk = G.WORLD_HOOKS.onSet;
    for (var hi = 0; hi < hk.length; hi++) hk[hi](x, y, z, id, prev);
    return true;
  };
  /* 每个 chunk 记住有方块的 y 区间，重建时不必扫全高（稳态帧率的关键） */
  World.prototype.chunkYRange = function (cx, cz) {
    if (!this._yr) this._yr = {};
    var key = cx + ',' + cz;
    var r = this._yr[key];
    if (r) return r;
    var lo = this.SY, hi = 0, x0 = cx * G.CHUNK, z0 = cz * G.CHUNK;
    var x1 = Math.min(x0 + G.CHUNK, this.SX), z1 = Math.min(z0 + G.CHUNK, this.SZ);
    for (var z = z0; z < z1; z++) for (var x = x0; x < x1; x++) {
      for (var y = 0; y < this.SY; y++) if (this.blocks[(y * this.SZ + z) * this.SX + x]) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    if (lo > hi) { lo = 0; hi = 0; }
    lo = Math.max(0, lo - 1); hi = Math.min(this.SY - 1, hi + 1);
    this._yr[key] = [lo, hi];
    return this._yr[key];
  };
  World.prototype.biomeAt = function (x, z) {
    x = Math.max(0, Math.min(this.SX - 1, x)); z = Math.max(0, Math.min(this.SZ - 1, z));
    return this.biomes[z * this.SX + x];
  };
  World.prototype.surfaceY = function (x, z) {
    for (var y = this.SY - 1; y >= 0; y--) { var id = this.get(x, y, z); if (id && DEFS[id].solid) return y; }
    return 0;
  };
  /* 相机专用的"脚底高度"：只认结构方块，树叶不算。
     leaf.solid 为真，surfaceY 会把树冠算成地面；越肩相机若拿它做高度约束，
     站在树旁就会被整台相机甩到树冠顶上（实测相机 y 由 15.9 跳到 25.6，画面变成俯视图）。
     没有可站的结构块时返回 -1，由调用方决定不约束，而不是把相机按到 y=1。 */
  World.prototype.camGroundY = function (x, z) {
    for (var y = this.SY - 1; y >= 0; y--) {
      var id = this.get(x, y, z);
      if (!id || !DEFS[id].solid || DEFS[id].liquid) continue;
      if (id === B.LEAF) continue;                      // 树冠不是地板
      return y;
    }
    return -1;
  };
  /* 竞技场边界：实体 AABB 越出世界侧壁或底面就算被挡住。
     世界外 get() 返回 0（空气），原来从岛边踏空会一直掉到 y<-6 才触发复活。
     只约束实体，不改世界数据；顶部不设限，垒高、被击飞仍然正常。 */
  World.prototype.outOfArena = function (x, y, z, hw, hh) {
    if (y - hh < 0) return true;
    if (x - hw < 0 || x + hw > this.SX) return true;
    if (z - hw < 0 || z + hw > this.SZ) return true;
    return false;
  };
  /* 相机专用的球测试：给相机一个真实体积，取代"点测试 + 写死 0.28 余量"。
     点测试会让相机半半边身子埋进方块（画面糊成一片贴图），而固定余量又与实际几何脱离。
     体素世界里球对格 AABB 就是每格常数次比较，比连续碰撞检测便宜得多。 */
  World.prototype.cameraSphereFree = function (x, y, z, r) {
    r = (r === undefined || r === null) ? 0.35 : r;
    if (y < 0) return false;
    var x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    var y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    var z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    var r2 = r * r;
    for (var cx = x0; cx <= x1; cx++) for (var cy = y0; cy <= y1; cy++) for (var cz = z0; cz <= z1; cz++) {
      var id = this.get(cx, cy, cz);
      if (!id) continue;
      var d = DEFS[id];
      if (!d || !d.solid || d.liquid) continue;                        // 水/岩浆不挡视线，与 cameraFree 一致
      var nx = x < cx ? cx : (x > cx + 1 ? cx + 1 : x);
      var ny = y < cy ? cy : (y > cy + 1 ? cy + 1 : y);
      var nz = z < cz ? cz : (z > cz + 1 ? cz + 1 : z);
      var ddx = x - nx, ddy = y - ny, ddz = z - nz;
      if (ddx * ddx + ddy * ddy + ddz * ddz < r2) return false;
    }
    return true;
  };
  /* 这个位置能不能放相机：液体可穿（水/岩浆不挡视线），固体不可穿 */
  World.prototype.cameraFree = function (x, y, z) {
    if (y < 0) return false;
    var id = this.get(Math.floor(x), Math.floor(y), Math.floor(z));
    if (!id) return true;
    var d = DEFS[id];
    if (d.liquid) return true;
    return !d.solid;
  };
  /* ---------- GroundProbe：局部台面探测的共享实现（GAMEPLAY §7.1 条 2，从 spawnPoint 抽出） ----------
     只回答这一个问题：这一块地能不能站 / 能不能放东西。
     候选表 = [原地] + maxRing 圈 × angles 方向，顺序固定——同 seed 同落点才成立；
     出生点用 9 圈 ×16 向（与历史实现逐格一致），矿脉用 6 圈 ×6 向（≤37 格预算，GAMEPLAY §2.4.2）。 */
  G.GroundProbe = {
    ringOffsets: function (maxRing, angles) {
      var ok = [[0, 0]];
      for (var ring = 1; ring <= maxRing; ring++) for (var a = 0; a < angles; a++) ok.push([Math.round(Math.cos(a / angles * 6.283) * ring), Math.round(Math.sin(a / angles * 6.283) * ring)]);
      return ok;
    },
    /* opts: maxRing/angles 候选表规模；margin 边界收敛（出生点历来 clamp 到 [2, SX-3]）；
       rejectTop(id) 顶面否决（水/岩浆/非固体/冰/可燃……各自表述）；flat 要求 3×3 高差 ≤1；
       headSolid 上方 1..k 格必须非固体（站立空间）；headAir 上方 1..k 格必须纯空气（矿脉要放晶体）。 */
    /* opts.ground：'cam' 用 camGroundY（跳过树叶——矿脉台面认证以真地面为准，树冠由放置方自己清）；
       缺省 surfaceY（出生点的历史口径，一个像素都不许漂）。 */
    find: function (world, bx, bz, opts) {
      var offs = G.GroundProbe.ringOffsets(opts.maxRing, opts.angles);
      var m = opts.margin === undefined ? 2 : opts.margin;
      var cam = opts.ground === 'cam';
      function hAt(x, z) { return cam ? world.camGroundY(x, z) : world.surfaceY(x, z); }
      for (var i = 0; i < offs.length; i++) {
        var x = Math.max(m, Math.min(world.SX - 1 - m, bx + offs[i][0])), z = Math.max(m, Math.min(world.SZ - 1 - m, bz + offs[i][1]));
        var y = hAt(x, z);
        if (y < 0) continue;
        var top = world.get(x, y, z);
        if (opts.rejectTop && opts.rejectTop(top)) continue;
        if (opts.headSolid) { var bad = false; for (var k = 1; k <= opts.headSolid; k++) { var id = world.get(x, y + k, z); if (id && DEFS[id].solid) { bad = true; break; } } if (bad) continue; }
        if (opts.headAir) { var badA = false; for (var ka = 1; ka <= opts.headAir; ka++) { if (world.get(x, y + ka, z) !== 0) { badA = true; break; } } if (badA) continue; }
        if (opts.flat) { var flat = true; for (var dx = -1; dx <= 1 && flat; dx++) for (var dz = -1; dz <= 1; dz++) { var ny = hAt(x + dx, z + dz); if (ny < 0 || Math.abs(ny - y) > 1) { flat = false; break; } } if (!flat) continue; }
        if (opts.accept && !opts.accept(x, z)) continue;
        return { x: x, y: y, z: z };
      }
      return null;
    }
  };
  World.prototype.spawnPoint = function (corner) {
    var pad = this.spawnPad;
    var bx = corner === 0 ? pad : this.SX - 1 - pad;
    var bz = corner === 0 ? pad : this.SZ - 1 - pad;
    var at = G.GroundProbe.find(this, bx, bz, {
      maxRing: 9, angles: 16, margin: 2, flat: true, headSolid: 3,
      rejectTop: function (top) {
        if (top === B.WATER || top === B.LAVA || !DEFS[top].solid) return true;
        if (DEFS[top].slip) return true;                     // 别生在冰面上：出生即打滑看起来像操作失灵
        if (DEFS[top].burn) return true;                       // 别生在可燃物（树叶/木）上
        return false;
      }
    });
    if (at) return { x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 };
    return { x: bx + 0.5, y: this.surfaceY(bx, bz) + 1, z: bz + 0.5 };
  };

  /* ---------- 地形生成 ---------- */
  World.prototype.generate = function () {
    var SX = this.SX, SY = this.SY, SZ = this.SZ, seed = this.seed;
    for (var z = 0; z < SZ; z++) {
      for (var x = 0; x < SX; x++) {
        var nx = x / SX - 0.5, nz = z / SZ - 0.5;
        var cont = fbm(x * 0.022, z * 0.022, 4, seed);
        var hills = fbm(x * 0.075, z * 0.075, 3, seed + 77);
        var edge = 1 - Math.min(1, Math.pow(Math.max(Math.abs(nx), Math.abs(nz)) * 2.15, 3)); // 岛屿化，边缘抬升成海
        var h = Math.floor(9 + cont * 16 * edge + hills * 4);
        h = Math.max(1, Math.min(SY - 8, h));
        var temp = fbm(x * 0.011 + 40, z * 0.011 - 20, 3, seed + 313);
        var humid = fbm(x * 0.014 - 60, z * 0.014 + 15, 3, seed + 911);
        var biome = 0;
        if (temp > 0.62 && humid < 0.5) biome = 1; else if (temp < 0.38) biome = 2;
        this.biomes[z * SX + x] = biome;
        // 柱体填充
        for (var y = 0; y <= h; y++) {
          var id;
          if (y === 0) id = B.BEDROCK;
          else if (y < h - 3) id = B.STONE;
          else if (y < h) id = biome === 1 ? B.SAND : B.DIRT;
          else {
            if (h < this.sea + 1) id = biome === 2 ? B.ICE : (biome === 1 ? B.SAND : B.GRASS);
            else id = biome === 2 ? B.SNOW : (biome === 1 ? B.SAND : B.GRASS);
          }
          this.blocks[this.idx(x, y, z)] = id;
        }
        // 水/岩浆填充洼地
        for (var yw = h + 1; yw <= this.sea; yw++) this.blocks[this.idx(x, yw, z)] = B.WATER;
        // 霜噬雪原的洼地冻到水面：原来的生成把冰放在柱顶、水盖在上面，玩家看到的是" open 水面"却踩在隐形冰上
        if (biome === 2 && h < this.sea && this.get(x, this.sea, z) === B.WATER) this.blocks[this.idx(x, this.sea, z)] = B.ICE;
        if (h < this.sea - 3 && h2(x, z, seed + 55) > 0.985) this.blocks[this.idx(x, h + 1, z)] = B.LAVA;
      }
    }
    // 矿脉 / 以太晶
    var rnd = G.mulberry32(seed + 4242);
    var veins = Math.floor(SX * SZ / 260);
    for (var v = 0; v < veins; v++) {
      var vx = 2 + Math.floor(rnd() * (SX - 4)), vz = 2 + Math.floor(rnd() * (SZ - 4));
      var vy = 2 + Math.floor(rnd() * (this.sea - 2));
      var blob = 2 + Math.floor(rnd() * 3);
      for (var b = 0; b < blob; b++) {
        var ox = vx + Math.floor(rnd() * 3) - 1, oy = vy + Math.floor(rnd() * 2), oz = vz + Math.floor(rnd() * 3) - 1;
        if (this.get(ox, oy, oz) === B.STONE) this.set(ox, oy, oz, B.CRYSTAL);
      }
    }
    // 树 / 仙人掌 / 冰锥
    for (var tz = 2; tz < SZ - 2; tz++) {
      for (var tx = 2; tx < SX - 2; tx++) {
        var top = this.surfaceY(tx, tz);
        if (this.get(tx, top, tz) === B.WATER || top <= this.sea) continue;
        var bm = this.biomeAt(tx, tz), r = h2(tx, tz, seed + 9);
        if (bm === 0 && r > 0.965) this.tree(tx, top + 1, tz, rnd);
        else if (bm === 1 && r > 0.992) this.column(tx, top + 1, tz, 2 + Math.floor(r * 60) % 3, B.SAND, rnd);
        else if (bm === 2 && r > 0.988) this.column(tx, top + 1, tz, 3 + Math.floor(r * 90) % 4, B.ICE, rnd);
      }
    }
    /* 地形里的岩浆/以太晶是**直接写进 blocks** 的（绕开 set），所以生成完必须把发射源登记表作废，
       让第一次光场查询用 ensureEm 全图扫一遍兜底；否则天然岩浆湖会"有贴图没光照"。 */
    this._emBuilt = false; this._em = new Map(); this._emBy = {}; this._lf = {};
    var keys = Array.from(this.dirty);
    this.dirty.clear();
    /* A1-a：三条以太矿脉（Lode）**只能追加在最后**——上面既有阶段（柱体→液体→veins 埋晶→植树）
       的顺序与随机流一个号都不许动；矿脉抖动走 mulberry32(seed ^ 0x9A11) 独立派生。
       守卫式调用：js/lode-planter.js 未加载（浏览器 script 序列尚未挂载）时退回纯 64 图，不炸。 */
    if (G.LodePlanter && this.lodesOn) G.LodePlanter.plant(this, this.lodeSalt === undefined ? undefined : { forceSalt: this.lodeSalt });
    return this;
  };
  World.prototype.tree = function (x, y, z, rnd) {
    var hgt = 4 + Math.floor(rnd() * 3);
    for (var i = 0; i < hgt; i++) if (this.get(x, y + i, z) === 0) this.set(x, y + i, z, B.LOG);
    var cy = y + hgt - 1;
    for (var dy = 0; dy <= 2; dy++) {
      var r = dy === 2 ? 1 : 2;
      for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy < 2) continue;
        if (Math.abs(dx) === r && Math.abs(dz) === r && rnd() < 0.6) continue;
        if (this.get(x + dx, cy + dy, z + dz) === 0) this.set(x + dx, cy + dy, z + dz, B.LEAF);
      }
    }
  };
  World.prototype.column = function (x, y, z, hgt, id, rnd) {
    for (var i = 0; i < hgt; i++) if (this.get(x, y + i, z) === 0) this.set(x, y + i, z, id);
  };

  /* ---------- 暴露面烘焙（只在没有不透明邻居的方向生成面） ---------- */
  var FACES = G.FACES = [
    { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], uvRow: 0, light: 0.72, tile: 'side' },
    { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], uvRow: 0, light: 0.72, tile: 'side' },
    { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]], uvRow: 1, light: 0.45, tile: 'bottom' },
    { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], uvRow: 0, light: 1.0, tile: 'top' },
    { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], uvRow: 0, light: 0.62, tile: 'side' },
    { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], uvRow: 0, light: 0.84, tile: 'side' }
  ];
  World.prototype.geometryForChunk = function (cx, cz) {
    var pos = [], nor = [], uvs = [], col = [], ind = [];
    var x0 = cx * CHUNK, z0 = cz * CHUNK;
    var x1 = Math.min(x0 + CHUNK, this.SX), z1 = Math.min(z0 + CHUNK, this.SZ);
    var invTW = 1 / (TILE * PER_ROW), invTH = 1 / (TILE * 4);
    for (var y = 0; y < this.SY; y++) {
      for (var z = z0; z < z1; z++) {
        for (var x = x0; x < x1; x++) {
          var id = this.get(x, y, z); if (!id) continue;
          var d = DEFS[id];
          for (var f = 0; f < 6; f++) {
            var face = FACES[f];
            var nb = this.get(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
            if (nb && DEFS[nb].opaque) continue;
            if (nb === id) continue;                       // 同种透明方块之间不画面
            if (!d.opaque && nb && DEFS[nb].opaque) continue;
            var ndx = pos.length / 3;
            var ti = d.tiles[face.tile === 'top' ? 0 : (face.tile === 'bottom' ? 2 : 1)];
            var tX = (ti % PER_ROW) * TILE, tY = Math.floor(ti / PER_ROW) * TILE;
            for (var c = 0; c < 4; c++) {
              var corner = face.corners[c];
              pos.push(x + corner[0], y + corner[1], z + corner[2]);
              nor.push(face.dir[0], face.dir[1], face.dir[2]);
              var u = (corner === face.corners[0] || corner === face.corners[2]) ? 0 : 1;
              var vv = (corner === face.corners[0] || corner === face.corners[1]) ? 1 : 0;
              uvs.push((tX + u * (TILE - 0.02)) * invTW, 1 - (tY + (1 - vv) * (TILE - 0.02)) * invTH);
              var L = face.light;
              var m = this.meta.get(this.idx(x, y, z));
              if (m && m.kind === 'burning') col.push(1, 0.55, 0.2);
              else if (d.glow) col.push(0.85, 0.6, 1);
              else col.push(L, L, L);
            }
            ind.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
          }
        }
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind);
    return g;
  };

  /* ---------- DDA 体素射线：准星拾取方块 / 相机遮挡检测 ---------- */
  World.prototype.raycast = function (origin, dir, maxDist, opts) {
    opts = opts || {};
    var ignoreLiquid = opts.ignoreLiquid !== false;
    var stopOnSolid = opts.stopOnSolid !== false;
    var x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    var stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    var tDeltaX = Math.abs(1 / (dir.x || 1e-9)), tDeltaY = Math.abs(1 / (dir.y || 1e-9)), tDeltaZ = Math.abs(1 / (dir.z || 1e-9));
    var xDist = stepX > 0 ? (x + 1 - origin.x) : (origin.x - x);
    var yDist = stepY > 0 ? (y + 1 - origin.y) : (origin.y - y);
    var zDist = stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z);
    var tMaxX = tDeltaX * xDist, tMaxY = tDeltaY * yDist, tMaxZ = tDeltaZ * zDist;
    var face = [0, 0, 0], t = 0, guard = 0;
    while (t <= maxDist && guard++ < 512) {
      if (this.inB(x, y, z)) {
        var id = this.get(x, y, z);
        if (id) {
          var d = DEFS[id];
          var hitIt = stopOnSolid ? d.solid : d.opaque;
          if (ignoreLiquid && (d.liquid)) hitIt = false;
          if (opts.accept && !opts.accept(id)) hitIt = false;
          if (hitIt) return { hit: true, x: x, y: y, z: z, id: id, def: d, face: face, dist: t };
        }
      } else if (y < 0) return { hit: false };
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0]; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
    }
    return { hit: false };
  };
  /* 点到点视线是否被遮挡（越肩相机的"玩家能不能打到"校验） */
  World.prototype.lineBlocked = function (a, b, opts) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    var r = this.raycast(a, { x: dx / len, y: dy / len, z: dz / len }, len, opts);
    return r.hit ? r : null;
  };

  World.prototype.snapshotBaseline = function () { this.baseline = this.blocks.slice(0); };
  World.prototype.restoreBaseline = function () {
    if (!this.baseline) return this;
    this.blocks.set(this.baseline); this.meta.clear(); this.dirty.clear();
    for (var i = 0; i < this.blocks.length; i++) if (this.blocks[i]) { var y = Math.floor(i / (this.SZ * this.SX)), rem = i - y * this.SZ * this.SX, z = Math.floor(rem / this.SX), x = rem - z * this.SX; this.dirty.add(Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK)); }
    return this;
  };
  G.World = World;
  G.CHUNK = CHUNK;
})(window.GW);
