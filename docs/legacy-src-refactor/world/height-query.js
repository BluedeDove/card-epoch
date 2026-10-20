window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：src/world/voxel-store.js, src/world/block-info.js
     竖直方向的高度问题：柱顶在哪、这个 chunk 的实心 y 区间在哪。 */
  class HeightQuery {
    constructor(store, blocks) { this.store = store; this.blocks = blocks; }
    /* 树叶 solid=true，surfaceY 会把树冠算成地面——角色站立与物理用它是**对的**；
       相机高度必须改用 CameraClearance.camGroundY，否则站树旁相机会被甩到树冠顶。 */
    surfaceY(x, z) {
      for (var y = this.store.SY - 1; y >= 0; y--) if (this.blocks.solid(this.store.get(x, y, z))) return y;
      return 0;
    }
    topId(x, z) { return this.store.get(x, this.surfaceY(x, z), z); }
    /* 每 chunk 记住实心 y 区间，重建时不扫全高（稳态帧率的关键）；写格时由 store 失效 */
    chunkYRange(cx, cz) {
      var key = cx + ',' + cz;
      return this.store.yRange[key] || (this.store.yRange[key] = this.compute(cx, cz));
    }
    compute(cx, cz) { var found = { lo: this.store.SY, hi: 0 }; this.sweep(this.bounds(cx, cz), found); return this.pad(found); }
    bounds(cx, cz) {
      var s = this.store, x0 = cx * G.CHUNK, z0 = cz * G.CHUNK;
      return { x0: x0, x1: Math.min(x0 + G.CHUNK, s.SX), z0: z0, z1: Math.min(z0 + G.CHUNK, s.SZ) };
    }
    sweep(b, found) { for (var z = b.z0; z < b.z1; z++) for (var x = b.x0; x < b.x1; x++) this.absorb(x, z, found); }
    absorb(x, z, found) {
      var s = this.store;
      for (var y = 0; y < s.SY; y++) if (s.blocks[(y * s.SZ + z) * s.SX + x]) { if (y < found.lo) found.lo = y; if (y > found.hi) found.hi = y; }
    }
    pad(found) {
      var empty = found.lo > found.hi;
      return [empty ? 0 : Math.max(0, found.lo - 1), empty ? 0 : Math.min(this.store.SY - 1, found.hi + 1)];
    }
  }
  G.HeightQuery = HeightQuery;

})(window.GW);
