window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：core/random.js, render/atlas/atlas-painters.js
     程序化像素图集：16×16 一格，每种方块 top/side/bottom 三张，全画在同一张 canvas 上。
     固定 SEED 绘制 → 每次启动像素一致；tile 的**分配顺序**也是契约（旧版 grass 先 side 后 top、
     log 先 side 后 top，bottom 多为复用），顺序一变，mesher 取到的贴图就换了一张。 */
  var TILE = 16, PER_ROW = 16, ROWS = 4, SEED = 20261016;
  class PixelAtlas {
    constructor(document, THREE, blocks) {
      this.document = document; this.THREE = THREE; this.blocks = blocks || G.blocks;
      this.perRow = PER_ROW; this.size = TILE; this.rows = ROWS; this.cursor = 0;
    }
    build() {
      this.rnd = new G.Random(SEED).toFn(); this.canvas = this.surface(); this.ctx = this.canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false; this.assign();
      return { texture: this.texture(), canvas: this.canvas, perRow: PER_ROW, rows: ROWS, size: TILE };
    }
    surface() {
      var cv = this.document.createElement('canvas');
      cv.width = TILE * PER_ROW; cv.height = TILE * ROWS;
      return cv;
    }
    texture() {
      var T = this.THREE, tex = new T.CanvasTexture(this.canvas);
      this.filter(tex, T); return tex;
    }
    /* NearestFilter + 不生成 mipmap：像素边必须硬 */
    filter(tex, T) {
      tex.magFilter = T.NearestFilter; tex.minFilter = T.NearestFilter;
      tex.generateMipmaps = false; tex.encoding = T.sRGBEncoding;
    }
    assign() {
      var defs = this.blocks.defs;
      for (var id = 1; id < defs.length; id++) this.assignOne(defs[id]);
    }
    assignOne(d) { this.slots = {}; this.plan(d).forEach(this.step, this); this.commit(d); }
    plan(d) { return (PixelAtlas.recipes[d.key] || PixelAtlas.recipes.flat)(d, this); }
    step(s) { this.slots[s.slot] = s.copy ? this.slots[s.copy] : (s.flat ? this.flat(s) : this.paint(s)); }
    commit(d) { this.blocks.assignTiles(d.id, [this.slots.top, this.slots.side, this.slots.bottom]); }
    paint(step) {
      var index = this.cursor++;
      this.fill(step, (index % PER_ROW) * TILE, Math.floor(index / PER_ROW) * TILE);
      return index;
    }
    /* 底色铺满 → 方块的装饰画法 → 上下沿描暗（立体感来源） */
    fill(step, ox, oy) {
      var sh = this.shade.bind(this, step.base), rnd = this.rnd;
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) this.dot(ox + x, oy + y, sh((rnd() - 0.5) * step.jitter));
      G.ATLAS_MODES[step.mode](this.ctx, ox, oy, sh, rnd, TILE); this.edge(ox, oy, sh);
    }
    edge(ox, oy, sh) {
      for (var e = 0; e < TILE; e++) { this.dot(ox + e, oy, sh(0.06)); this.dot(ox + e, oy + TILE - 1, sh(-0.14)); }
    }
    flat(step) {
      var index = this.cursor++, ox = (index % PER_ROW) * TILE, oy = Math.floor(index / PER_ROW) * TILE;
      this.checker(ox, oy, step.base, '#000000');
      return index;
    }
    checker(ox, oy, c1, c2) {
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) this.dot(ox + x, oy + y, ((x >> 2) + (y >> 2)) % 2 === 0 ? c1 : c2);
    }
    dot(x, y, c) { this.ctx.fillStyle = c; this.ctx.fillRect(x, y, 1, 1); }
    shade(hex, amt) {
      var n = parseInt(hex.slice(1), 16), j = amt * (0.6 + this.rnd() * 0.8);
      return 'rgb(' + PixelAtlas.channel(n >> 16 & 255, j) + ',' + PixelAtlas.channel(n >> 8 & 255, j) + ',' + PixelAtlas.channel(n & 255, j) + ')';
    }
    static channel(v, j) { return Math.max(0, Math.min(255, Math.round(v + j * 255))); }
  }
  function slot(base, jitter, mode) { return { base: base, jitter: jitter, mode: mode }; }
  function same(slotName, from) { return { slot: slotName, copy: from }; }
  function triple(base, jitter, mode) {
    var names = ['side', 'top', 'bottom'];
    return names.map(function (s, i) { return i === 0 ? Object.assign({ slot: s }, slot(base, jitter, mode)) : same(s, 'side'); });
  }
  PixelAtlas.recipes = {
    grass: function () { return [Object.assign({ slot: 'side' }, slot('#7b5334', 0.16, 'dirt')), same('bottom', 'side'), Object.assign({ slot: 'top' }, slot('#5aa832', 0.2, 'grass'))]; },
    log: function () { return [Object.assign({ slot: 'side' }, slot('#7a5230', 0.12, 'logside')), Object.assign({ slot: 'top' }, slot('#a5794a', 0.1, 'logtop')), same('bottom', 'top')]; },
    plank: function () { return triple('#b98a4e', 0.12, 'plank'); },
    brick: function () { return triple('#9c5c53', 0.12, 'brick'); },
    water: function () { return triple('#3b7fd6', 0.1, 'water'); },
    lava: function () { return triple('#ff7519', 0.18, 'lava'); },
    ice: function () { return triple('#a9dcf2', 0.1, 'ice'); },
    crystal: function () { return triple('#8a3fd8', 0.12, 'crystal'); },
    obsidian: function () { return triple('#2b2340', 0.14, 'obsidian'); },
    stone: function () { return triple('#8b8b93', 0.14, 'stone'); },
    sand: function () { return triple('#d9c88d', 0.12, 'sand'); },
    snow: function () { return triple('#eef4fb', 0.08, 'snow'); },
    leaf: function () { return triple('#3f7d2c', 0.22, 'leaf'); },
    dirt: function () { return triple('#7b5334', 0.16, 'dirt'); },
    bedrock: function () { return triple('#3a3a42', 0.2, 'stone'); },
    flat: function (d) { return [Object.assign({ slot: 'side', flat: true }, { base: d.color }), same('top', 'side'), same('bottom', 'side')]; }
  };
  G.PixelAtlas = PixelAtlas;
  /* 参数可省：旧调用点写的是无参 G.buildAtlas()，页面里 document/THREE 是全局 */
  G.buildAtlas = function (doc, three, blocks) {
    var d = doc || (typeof document !== 'undefined' ? document : window.document);
    return new PixelAtlas(d, three || (typeof THREE !== 'undefined' ? THREE : window.THREE), blocks).build();
  };
})(window.GW);
