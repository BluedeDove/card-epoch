window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：src/world/block-info.js, src/world/voxel-store.js
     只回答"相机能不能待在这"。相机有真实体积（球），不再用"点测试 + 写死 0.28 余量"：
     点测试会让相机半边身子埋进方块糊成贴图，固定余量又与实际几何脱离。 */
  var LEAF = G.BLOCK.LEAF;
  class CameraClearance {
    constructor(store, blocks) { this.store = store; this.blocks = blocks; }
    /* 相机专用"脚底高度"：只认结构方块。没有可站的结构块时返回 -1，
       由调用方决定"不约束"，而不是把相机按到 y=1。 */
    camGroundY(x, z) {
      for (var y = this.store.SY - 1; y >= 0; y--) if (this.standable(y, x, z)) return y;
      return -1;
    }
    standable(y, x, z) {
      var id = this.store.get(x, y, z), d = this.blocks.def(id);
      return !!id && !!d.solid && !d.liquid && id !== LEAF;
    }
    /* 点口径：液体可穿（水/岩浆不挡视线），固体不可穿 */
    isFree(x, y, z) {
      if (y < 0) return false;
      var d = this.blocks.def(this.store.get(Math.floor(x), Math.floor(y), Math.floor(z)));
      return !d.solid || !!d.liquid;
    }
    /* 球口径：体素世界里"球对格 AABB"就是每格常数次比较，比连续碰撞检测便宜得多 */
    sphereFree(x, y, z, r) {
      r = (r === undefined || r === null) ? 0.35 : r;
      if (y < -r) return false;
      return this.scanBox(x, y, z, r) === 0;
    }
    scanBox(x, y, z, r) {
      var hits = 0, b = { x0: Math.floor(x - r), x1: Math.floor(x + r), y0: Math.floor(y - r), y1: Math.floor(y + r), z0: Math.floor(z - r), z1: Math.floor(z + r) };
      for (var cx = b.x0; cx <= b.x1; cx++) for (var cy = b.y0; cy <= b.y1; cy++) for (var cz = b.z0; cz <= b.z1; cz++) if (this.overlaps(x, y, z, r, cx, cy, cz)) hits++;
      return hits;
    }
    overlaps(x, y, z, r, cx, cy, cz) {
      var id = this.store.get(cx, cy, cz); if (!this.blocks.solid(id) || this.blocks.liquid(id)) return false;   // 液体不挡视线，与 isFree 同口径
      var o = this.offsets(x, y, z, cx, cy, cz);
      return o.x * o.x + o.y * o.y + o.z * o.z < r * r;
    }
    offsets(x, y, z, cx, cy, cz) {
      var C = CameraClearance.clamp;
      return { x: x - C(x, cx, cx + 1), y: y - C(y, cy, cy + 1), z: z - C(z, cz, cz + 1) };
    }
    static clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  }
  G.CameraClearance = CameraClearance;

})(window.GW);
