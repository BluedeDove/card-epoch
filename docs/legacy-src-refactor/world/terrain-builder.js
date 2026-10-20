window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：core/noise.js, core/random.js, world/block-table.js, world/voxel-store.js
     造山：高度图 → 岛缘抬升 → 群系 → 柱体填色 → 水/岩浆洼地 → 矿脉。
     顺序与随机流消耗次序必须与旧实现一致，否则同 seed 的地图会变（README 的第一条验收）。 */
  var B = G.BLOCK;
  class TerrainBuilder {
    constructor(store, blocks, seed, sea) {
      this.store = store; this.blocks = blocks; this.seed = seed >>> 0; this.sea = sea;
      this.noise = new G.Noise(this.seed); this.rand = new G.Random(this.seed);
    }
    /* 逐柱：先定高度与群系，再填柱体与水面 */
    build() {
      var s = this.store;
      for (var z = 0; z < s.SZ; z++) for (var x = 0; x < s.SX; x++) this.column(x, z);
    }
    column(x, z) {
      var s = this.store, f = this.field(x, z), h = this.height(f);
      s.biomes[z * s.SX + x] = f.biome;
      this.fill(h, f.biome, x, z); this.liquids(h, x, z);
    }
    /* 一张柱的"环境场"：大陆度、丘陵、岛缘、温度、湿度、群系 */
    field(x, z) {
      var f = this.waves(x, z);
      this.edge(f, x, z);
      return this.climate(f, x, z);
    }
    /* 岛缘抬升：离中心越远 edge 越小，边缘整片沉成海 */
    edge(f, x, z) {
      var s = this.store, d = Math.max(Math.abs(x / s.SX - 0.5), Math.abs(z / s.SZ - 0.5));
      f.edge = 1 - Math.min(1, Math.pow(d * 2.15, 3));
    }
    waves(x, z) { return { cont: this.noise.fbm(x * 0.022, z * 0.022, 4, this.seed), hills: this.noise.fbm(x * 0.075, z * 0.075, 3, this.seed + 77) }; }
    climate(f, x, z) { f.temp = this.noise.fbm(x * 0.011 + 40, z * 0.011 - 20, 3, this.seed + 313); return this.humid(f, x, z); }
    humid(f, x, z) {
      f.humid = this.noise.fbm(x * 0.014 - 60, z * 0.014 + 15, 3, this.seed + 911);
      f.biome = f.temp > 0.62 && f.humid < 0.5 ? 1 : (f.temp < 0.38 ? 2 : 0);
      return f;
    }
    height(f) { return Math.max(1, Math.min(this.store.SY - 8, Math.floor(9 + f.cont * 16 * f.edge + f.hills * 4))); }
    fill(h, biome, x, z) {
      var s = this.store;
      for (var y = 0; y <= h; y++) s.raw(s.idx(x, y, z), this.strata(y, h, biome, x, z));
    }
    strata(y, h, biome, x, z) {
      if (y === 0) return B.BEDROCK;
      if (y < h - 3) return B.STONE; if (y < h) return biome === 1 ? B.SAND : B.DIRT;
      return this.crust(h, biome, x, z);
    }
    /* 表层看群系也看海平面：雪原出冰/雪，沙漠出沙，其余草地 */
    crust(h, biome, x, z) {
      var under = h < this.sea + 1;
      if (biome === 2) return under ? B.ICE : B.SNOW; if (biome === 1) return B.SAND;
      return B.GRASS;
    }
    liquids(h, x, z) {
      var s = this.store;
      for (var y = h + 1; y <= this.sea; y++) s.raw(s.idx(x, y, z), B.WATER);
      if (h < this.sea - 3 && this.noise.cell(x, z, this.seed + 55) > 0.985) s.raw(s.idx(x, h + 1, z), B.LAVA);
    }
    /* 矿脉：石头上随机长出以太晶。
       rnd 由 World.generate 创建一次、按"先矿脉后植树"的顺序消耗——每个随机数的取用次序
       都进入地图指纹，顺序换了同 seed 就不是同一张图（README 的逐格一致验收）。 */
    veins(rnd) {
      var count = Math.floor(this.store.SX * this.store.SZ / 260);
      for (var v = 0; v < count; v++) this.blob(rnd);
    }
    blob(rnd) {
      var p = this.blobSpot(rnd), size = 2 + rnd.int(3);                    // 取数顺序：x, z, y, 再 blob 尺寸
      for (var b = 0; b < size; b++) this.crystalSpot(rnd, p);
    }
    blobSpot(rnd) {
      var s = this.store;
      return { x: 2 + rnd.int(s.SX - 4), z: 2 + rnd.int(s.SZ - 4), y: 2 + rnd.int(this.sea - 2) };
    }
    crystalSpot(rnd, p) { this.crystal(p.x + rnd.int(3) - 1, p.y + rnd.int(2), p.z + rnd.int(3) - 1); }
    crystal(x, y, z) { if (this.store.get(x, y, z) === B.STONE) this.store.set(x, y, z, B.CRYSTAL); }
  }
  G.TerrainBuilder = TerrainBuilder;
  /* 旧入口用的独立函数也留在这里：mining 侧（rules）与存档侧都拿得到同一口径 */
  G.terrainSeedFor = function (seed) { return new G.Random(seed >>> 0); };
})(window.GW);
