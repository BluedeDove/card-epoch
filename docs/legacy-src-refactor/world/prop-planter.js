window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：core/noise.js, world/block-table.js, world/voxel-store.js, world/height-query.js
     地表附着物：树（林海常见）、沙柱（沙漠）、冰锥（雪原）。
     位置由 h2 哈希决定、树冠镂空与柱高由传入的 rnd 决定——
     rnd 与矿脉共用同一条随机流且顺序固定（先矿脉后植树），换了顺序同 seed 就不是同一张图。 */
  var B = G.BLOCK;
  /* 三个群系的种植规则：出现阈值 + 造法（数据表，不是逻辑；加一种地貌只动这里） */
  function treeRule(self, x, y, z, r, rnd) { self.tree(x, y, z, rnd); }
  function sandRule(self, x, y, z, r) { self.column(x, y, z, 2 + Math.floor(r * 60) % 3, B.SAND); }
  function iceRule(self, x, y, z, r) { self.column(x, y, z, 3 + Math.floor(r * 90) % 4, B.ICE); }
  var SEED_RULES = { 0: { min: 0.965, make: treeRule }, 1: { min: 0.992, make: sandRule }, 2: { min: 0.988, make: iceRule } };
  class PropPlanter {
    constructor(store, blocks, heights, seed, sea) {
      this.store = store; this.blocks = blocks; this.heights = heights; this.seed = seed >>> 0; this.sea = sea;
      this.noise = new G.Noise(this.seed);
    }
    plant(rnd) {
      var s = this.store;
      for (var z = 2; z < s.SZ - 2; z++) for (var x = 2; x < s.SX - 2; x++) this.at(x, z, rnd);
    }
    at(x, z, rnd) {
      var top = this.heights.surfaceY(x, z);
      if (this.standable(x, top, z)) this.grow(x, top + 1, z, rnd);
    }
    /* 水面与海平面以下不植树（旧版口径：顶层是水或 top<=sea 就跳过） */
    standable(x, top, z) {
      var id = this.store.get(x, top, z);
      return id !== B.WATER && top > this.sea;
    }
    grow(x, y, z, rnd) {
      var bm = this.biome(x, z), r = this.roll(x, z), rule = SEED_RULES[bm]; if (!rule || r <= rule.min) return;
      rule.make(this, x, y, z, r, rnd);
    }
    biome(x, z) { return this.store.biomes[z * this.store.SX + x]; }
    roll(x, z) { return this.noise.cell(x, z, this.seed + 9); }
    tree(x, y, z, rnd) {
      var hgt = 4 + rnd.int(3);
      this.trunk(x, y, z, hgt);
      this.crown(x, y + hgt - 1, z, rnd);
    }
    trunk(x, y, z, hgt) {
      for (var i = 0; i < hgt; i++) if (this.store.get(x, y + i, z) === 0) this.store.set(x, y + i, z, B.LOG);
    }
    /* 树冠两层：下层 5×5、上层 3×3。四角 60% 镂空，正中心只在顶层填（否则树干上顶一坨） */
    crown(x, cy, z, rnd) {
      for (var dy = 0; dy <= 2; dy++) this.crownLayer(x, cy + dy, z, dy === 2 ? 1 : 2, dy, rnd);
    }
    crownLayer(x, cy, z, r, dy, rnd) {
      for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) this.leaf(x + dx, cy, z + dz, dx, dz, r, dy, rnd);
    }
    leaf(x, cy, z, dx, dz, r, dy, rnd) {
      if (this.hollow(dx, dz, r, dy, rnd)) return;
      if (this.store.get(x, cy, z) === 0) this.store.set(x, cy, z, B.LEAF);
    }
    hollow(dx, dz, r, dy, rnd) {
      var center = dx === 0 && dz === 0 && dy < 2;
      var corner = Math.abs(dx) === r && Math.abs(dz) === r && rnd.next() < 0.6;
      return center || corner;
    }
    column(x, y, z, hgt, id) {
      for (var i = 0; i < hgt; i++) if (this.store.get(x, y + i, z) === 0) this.store.set(x, y + i, z, id);
    }
  }
  G.PropPlanter = PropPlanter;
})(window.GW);
