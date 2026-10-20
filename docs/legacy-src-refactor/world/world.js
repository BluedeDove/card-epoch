window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：core/*, world/block-info, world/voxel-store, world/height-query, world/camera-clearance,
            world/arena-bounds, world/raycaster, world/terrain-builder, world/prop-planter, world/spawn-locator
     World 只做两件事：把协作者接起来、把上层调用转出去。判定逻辑一律不许留在这。 */
  class World {
    constructor(opts) {
      this.seed = opts.seed >>> 0;
      this.sea = opts.sea === undefined ? 12 : opts.sea;
      this.compose(opts.size);
    }
    compose(size) {
      this.store = new G.VoxelStore(size[0], size[1], size[2]);
      this.mirror(this.store); this.wire();
    }
    /* 存储的四个视图引用同一个对象：存档与烘焙按同一身份读，不复制 */
    mirror(s) {
      this.blocks = s.blocks; this.meta = s.meta;
      this.dirty = s.dirty; this.biomes = s.biomes;
      this.baseline = null;
    }
    wire() { var s = this.store; this.dims(s); this.info = G.blocks; this.heights = new G.HeightQuery(s, this.info); this.query(); }
    dims(s) { this.SX = s.SX; this.SY = s.SY; this.SZ = s.SZ; }
    /* 四个查询器都是"只读世界"的专家，World 只负责挂上去 */
    query() {
      this.clearance = new G.CameraClearance(this.store, this.info); this.bounds = new G.ArenaBounds(this.store);
      this.ray = new G.Raycaster(this.store, this.info);
      this.spawns = new G.SpawnLocator(this.store, this.info, this.heights);
    }
    idx(x, y, z) { return this.store.idx(x, y, z); }
    inB(x, y, z) { return this.store.inB(x, y, z); }
    get(x, y, z) { return this.store.get(x, y, z); }
    getDef(x, y, z) { return this.info.def(this.store.get(x, y, z)); }
    solidAt(x, y, z) { return this.store.inB(x, y, z) && this.info.solid(this.store.get(x, y, z)); }
    set(x, y, z, id, extra) { return this.store.set(x, y, z, id, extra); }
    chunkYRange(cx, cz) { return this.heights.chunkYRange(cx, cz); }
    surfaceY(x, z) { return this.heights.surfaceY(x, z); }
    /* 相机专用高度：只认结构方块。树叶不算地面（站树旁相机被甩上树冠的老 bug 就归这里管） */
    camGroundY(x, z) { return this.clearance.camGroundY(x, z); }
    cameraFree(x, y, z) { return this.clearance.isFree(x, y, z); }
    cameraSphereFree(x, y, z, r) { return this.clearance.sphereFree(x, y, z, r); }
    outOfArena(x, y, z, hw, hh) { return this.bounds.out(x, y, z, hw, hh); }
    spawnPoint(corner) { return this.spawns.pick(corner); }
    raycast(origin, dir, maxDist, opts) { return this.ray.raycast(origin, dir, maxDist, opts); }
    biomeAt(x, z) {
      var s = this.store, cx = Math.max(0, Math.min(s.SX - 1, x)), cz = Math.max(0, Math.min(s.SZ - 1, z));
      return this.biomes[cz * s.SX + cx];
    }
    biomeCNAt(x, z) { return G.BIOME_CN[this.biomeAt(x, z)] || '—'; }
    snapshotBaseline() { this.store.snapshotBaseline(); this.baseline = this.store.baseline; return this; }
    diffCells(limit) { return this.store.diffCells(limit); }
    /* 生成顺序 = 随机流顺序：柱体 → 矿脉 → 植树，全程同一个 rnd，不换源不重排 */
    generate() {
      var tb = new G.TerrainBuilder(this.store, this.info, this.seed, this.sea), rnd = new G.Random(this.seed + 4242);
      tb.build(); tb.veins(rnd); this.plant(rnd);
      return this.finish();
    }
    plant(rnd) { new G.PropPlanter(this.store, this.info, this.heights, this.seed, this.sea).plant(rnd); }
    finish() { this.dirty.clear(); return this; }
  }
  G.World = World;
})(window.GW);
