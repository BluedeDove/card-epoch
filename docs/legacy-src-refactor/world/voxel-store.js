window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（纯存储）
     体素存储：一维 Uint8Array + meta（谁造的/在烧/出生时刻）+ dirty（要重建的 chunk 键）。
     判定与渲染都不许进来——这里只回答"这格存着什么"。 */
  var CHUNK = G.CHUNK = 16;
  var NEIGHBOURS = [
    function (c, r) { return c + ',' + r; }, function (c, r) { return (c - 1) + ',' + r; }, function (c, r) { return (c + 1) + ',' + r; },
    function (c, r) { return c + ',' + (r - 1); }, function (c, r) { return c + ',' + (r + 1); }
  ];
  class VoxelStore {
    constructor(sx, sy, sz) {
      this.SX = sx; this.SY = sy; this.SZ = sz;
      this.blocks = new Uint8Array(sx * sy * sz);
      this.biomes = new Uint8Array(sx * sz);
      this.meta = new Map(); this.dirty = new Set(); this.yRange = {};
    }
    idx(x, y, z) { return (y * this.SZ + z) * this.SX + x; }
    inB(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.SX && y < this.SY && z < this.SZ; }
    get(x, y, z) { return this.inB(x, y, z) ? this.blocks[this.idx(x, y, z)] : 0; }
    raw(i, id) { if (id === undefined) return this.blocks[i]; this.blocks[i] = id; return id; }
    /* 唯一的写入口：值真变了才标脏，省掉一半重建（dirty 是烘焙的节拍器） */
    set(x, y, z, id, extra) {
      if (!this.inB(x, y, z)) return false;
      var i = this.idx(x, y, z); if (this.blocks[i] === id && !extra) return false;
      return this.write(i, id, extra);
    }
    write(i, id, extra) {
      this.blocks[i] = id; this.applyMeta(i, id, extra);
      this.markDirty(this.xOf(i), this.yOf(i), this.zOf(i));
      return true;
    }
    applyMeta(i, id, extra) {
      if (extra) this.meta.set(i, Object.assign(this.meta.get(i) || {}, extra));
      else if (id === 0) this.meta.delete(i);
    }
    xOf(i) { return i % this.SX; }
    zOf(i) { return Math.floor(i / this.SX) % this.SZ; }
    yOf(i) { return Math.floor(i / (this.SX * this.SZ)); }
    /* 边界格要连带邻居 chunk 一起重建，否则接缝处留旧面（老代码踩过） */
    markDirty(x, y, z) {
      var cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
      this.dirty.add(cx + ',' + cz); this.invalidateRange(cx, cz);
      this.markBorder(cx, cz, x % CHUNK, z % CHUNK);
    }
    markBorder(cx, cz, mx, mz) {
      if (mx === 0) this.dirty.add((cx - 1) + ',' + cz); if (mx === CHUNK - 1) this.dirty.add((cx + 1) + ',' + cz);
      if (mz === 0) this.dirty.add(cx + ',' + (cz - 1)); if (mz === CHUNK - 1) this.dirty.add(cx + ',' + (cz + 1));
    }
    invalidateRange(cx, cz) {
      for (var i = 0; i < NEIGHBOURS.length; i++) delete this.yRange[NEIGHBOURS[i](cx, cz)];
    }
    snapshotBaseline() { this.baseline = this.blocks.slice(0); return this; }
    /* 存档只存与基线的差异格（学 Minecraft 的"只存改动过的区块"） */
    diffCells(limit) {
      var out = []; if (!this.baseline) return out;
      for (var i = 0; i < this.blocks.length; i++) if (this.blocks[i] !== this.baseline[i]) out.push([this.xOf(i), this.yOf(i), this.zOf(i), this.blocks[i]]);
      return out.slice(0, limit || 120000);
    }
    forEachMeta(fn) { this.meta.forEach(fn); }
    indexOfMeta(i) { return { x: this.xOf(i), y: this.yOf(i), z: this.zOf(i) }; }
  }
  G.VoxelStore = VoxelStore;
  G.CHUNK = CHUNK;

})(window.GW);
