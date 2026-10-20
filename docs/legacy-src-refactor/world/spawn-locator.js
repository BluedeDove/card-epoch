window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：world/block-table.js, world/voxel-store.js, world/height-query.js
     出生点：从角落出发按环形候选表找一块"能站、头顶空、3×3 平坦、不生在可燃物上"的地。
     候选顺序固定（同 seed 同落点），开局位置才可复现。 */
  var B = G.BLOCK;
  class SpawnLocator {
    constructor(store, blocks, heights) { this.store = store; this.blocks = blocks; this.heights = heights; }
    pick(corner) {
      var home = this.home(corner), cands = this.rings();
      for (var i = 0; i < cands.length; i++) { var at = this.tryAt(home, cands[i]); if (at) return at; }
      return this.fallback(home);
    }
    home(corner) {
      var pad = 7, s = this.store;
      return { x: corner === 0 ? pad : s.SX - 1 - pad, z: corner === 0 ? pad : s.SZ - 1 - pad };
    }
    /* 候选偏移：先原地，再 9 圈 × 16 方向。角度常量与旧实现一致，否则落点会漂 */
    rings() {
      var out = [[0, 0]];
      for (var ring = 1; ring <= 9; ring++) for (var a = 0; a < 16; a++) out.push([this.rx(a, ring), this.rz(a, ring)]);
      return out;
    }
    rx(a, ring) { return Math.round(Math.cos(a / 16 * 6.283) * ring); }
    rz(a, ring) { return Math.round(Math.sin(a / 16 * 6.283) * ring); }
    tryAt(home, off) {
      var s = this.store, x = this.clamp(home.x + off[0], 2, s.SX - 3), z = this.clamp(home.z + off[1], 2, s.SZ - 3);
      var y = this.heights.surfaceY(x, z);
      return this.standable(x, y, z) ? { x: x + 0.5, y: y + 1, z: z + 0.5 } : null;
    }
    clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    standable(x, y, z) {
      if (!this.ground(this.store.get(x, y, z))) return false;
      return this.headClear(x, y, z) && this.flat(x, y, z);
    }
    /* 不能生在液体上，也不能生在树叶/原木这类可燃物上（开局被余烬点着很难看） */
    ground(top) {
      var d = this.blocks.def(top);
      return top !== B.WATER && top !== B.LAVA && !!d.solid && !d.burn;
    }
    headClear(x, y, z) {
      for (var k = 1; k <= 3; k++) if (this.blocks.solid(this.store.get(x, y + k, z))) return false;
      return true;
    }
    flat(x, y, z) {
      var ok = true;
      for (var dx = -1; dx <= 1 && ok; dx++) for (var dz = -1; dz <= 1; dz++) if (Math.abs(this.heights.surfaceY(x + dx, z + dz) - y) > 1) { ok = false; break; }
      return ok;
    }
    /* 一圈都没命中也要落得出去：退回角落地表，别把人塞进 (0,0,0) 的基岩里 */
    fallback(home) {
      return { x: home.x + 0.5, y: this.heights.surfaceY(home.x, home.z) + 1, z: home.z + 0.5 };
    }
  }
  G.SpawnLocator = SpawnLocator;
})(window.GW);
