window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：world/block-info, world/voxel-store, world/height-query, world/face-table（+ render/atlas 给的图集尺寸）
     暴露面烘焙：只在"邻居不会挡住"的方向生成面；顶点级 AO 让角落比平面暗。
     语义真源是旧 main.js 的 buildChunkGeometry（AO、水按海平面调色、燃烧闪色、液体面压到 0.86 高、
     chunk y 区间裁剪）；js/world.js 里那份 geometryForChunk 没有这些细节且全项目无人调用，按 §4.4 废弃。
     这里只产出顶点数组，THREE 对象由 render/chunk-view 负责（世界层不碰 THREE）。 */
  var B = G.BLOCK;
  class ChunkMesher {
    constructor(store, blocks, heights, atlas, sea) {
      this.store = store; this.blocks = blocks; this.heights = heights;
      this.atlas = atlas; this.sea = sea;
      this.faces = G.FACES; this.tileIndex = G.TILE_INDEX;
    }
    build(cx, cz, liquid) {
      var ctx = { pos: [], nor: [], uv: [], col: [], ind: [], liquid: !!liquid };
      this.sweep(ctx, cx, cz);
      return ctx.pos.length ? ctx : null;
    }
    sweep(ctx, cx, cz) {
      var b = this.bounds(cx, cz), yr = this.heights.chunkYRange(cx, cz);
      for (var y = yr[0]; y <= yr[1]; y++) for (var z = b.z0; z < b.z1; z++) for (var x = b.x0; x < b.x1; x++) this.cell(ctx, x, y, z);
    }
    bounds(cx, cz) {
      var s = this.store, x0 = cx * G.CHUNK, z0 = cz * G.CHUNK;
      return { x0: x0, x1: Math.min(x0 + G.CHUNK, s.SX), z0: z0, z1: Math.min(z0 + G.CHUNK, s.SZ) };
    }
    cell(ctx, x, y, z) {
      var id = this.store.get(x, y, z); if (!id) return;
      var d = this.blocks.def(id); if (!!d.liquid !== ctx.liquid) return;
      this.cellFaces(ctx, x, y, z, id, d);
    }
    cellFaces(ctx, x, y, z, id, d) {
      for (var f = 0; f < 6; f++) { var face = this.faces[f]; if (this.visible(ctx, d, id, x, y, z, face)) this.quad(ctx, x, y, z, d, face); }
    }
    /* 液体：同种相邻不画面、被不透明挡住就不画；固体：被不透明挡住不画、同种不画、且自身必须不透明 */
    visible(ctx, d, id, x, y, z, face) {
      var nb = this.store.get(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
      if (ctx.liquid) return nb !== id && !(nb && this.blocks.opaque(nb));
      return !(nb && this.blocks.opaque(nb)) && nb !== id && !!d.opaque;
    }
    quad(ctx, x, y, z, d, face) {
      var base = ctx.pos.length / 3, tile = this.tileOf(d, face);
      for (var c = 0; c < 4; c++) this.vertex(ctx, x, y, z, d, face, c, tile);
      ctx.ind.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    tileOf(d, face) { return d.tiles[this.tileIndex[face.tile]]; }
    vertex(ctx, x, y, z, d, face, c, tile) {
      var cr = face.corners[c];
      ctx.pos.push(x + cr[0], y + cr[1] * (ctx.liquid ? 0.86 : 1), z + cr[2]); ctx.nor.push(face.dir[0], face.dir[1], face.dir[2]);
      this.uv(ctx, c, tile); ctx.col.push.apply(ctx.col, this.color(ctx, d, face, x, y, z, cr));
    }
    /* uv 内缩 0.05 像素：图集是一整张共享图，边界不内缩会被邻格染色。
       顶点顺序约定（与 face.corners 对应）：0/2 取左、0/1 取上 */
    uv(ctx, c, tile) {
      var hu = (c === 0 || c === 2) ? 0 : 1, hv = (c === 0 || c === 1) ? 1 : 0;
      ctx.uv.push(this.uvX(hu, tile), this.uvY(hv, tile));
    }
    uvX(u, tile) { var T = this.atlas.size; return ((tile % this.perRow()) * T + u * (T - 0.05)) / this.atlasWidth(); }
    uvY(v, tile) { var T = this.atlas.size; return 1 - (Math.floor(tile / this.perRow()) * T + (1 - v) * (T - 0.05)) / this.atlasHeight(); }
    perRow() { return this.atlas.perRow; }
    atlasWidth() { return this.atlas.size * this.atlas.perRow; }
    atlasHeight() { return this.atlas.size * 4; }
    color(ctx, d, face, x, y, z, cr) {
      var m = this.store.meta.get(this.store.idx(x, y, z));
      if (m && m.kind === 'burning') return [1, 0.5 + Math.random() * 0.3, 0.25];
      return this.body(d, face, x, y, z, cr, m);
    }
    body(d, face, x, y, z, cr, m) {
      var id = this.store.get(x, y, z), L = face.light * this.ao(x, y, z, face.dir, cr);
      if (id === B.LAVA) return [1, 0.72, 0.32]; if (id === B.WATER) return this.water(L, y);
      return d.glow ? [0.92, 0.64, 1] : [L, L, L];
    }
    /* 水越深越暗（按与海平面的距离压亮度）——旧版主视觉调校，不是装饰 */
    water(L, y) {
      var dep = Math.max(0, Math.min(1, (this.sea - y) / 8));
      return [(0.5 * L + 0.3) * (1 - dep * 0.35), (0.66 * L + 0.26) * (1 - dep * 0.3), (0.98 * L + 0.24) * (1 - dep * 0.12)];
    }
    /* 顶点级 AO：沿面法线偏移后，三个斜邻格每多一个不透明就暗 0.155 */
    ao(x, y, z, dir, cr) {
      var t = this.tangents(dir);
      if (t.length < 2) return 1;
      return 1 - 0.155 * this.cornerHits(x, y, z, dir, cr, t);
    }
    tangents(dir) {
      var out = [];
      for (var a = 0; a < 3; a++) if (dir[a] === 0) out.push(a);
      return out;
    }
    cornerHits(x, y, z, dir, cr, t) {
      var a = this.bump(t[0], cr[t[0]] === 1 ? 1 : -1, 0), b = this.bump(t[1], 0, cr[t[1]] === 1 ? 1 : -1);
      return this.solidNear(x, y, z, dir, a) + this.solidNear(x, y, z, dir, b) + this.solidNear(x, y, z, dir, this.sum(a, b));
    }
    bump(axis, v1, v2) { var o = [0, 0, 0]; o[axis] = v1 || v2; return o; }
    sum(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
    solidNear(x, y, z, dir, off) {
      var p = [x + dir[0] + off[0], y + dir[1] + off[1], z + dir[2] + off[2]];
      if (!this.inside(p)) return 0;
      return this.blocks.opaque(this.store.blocks[(p[1] * this.store.SZ + p[2]) * this.store.SX + p[0]]) ? 1 : 0;
    }
    inside(p) {
      var s = this.store;
      return p[0] >= 0 && p[1] >= 0 && p[2] >= 0 && p[0] < s.SX && p[1] < s.SY && p[2] < s.SZ;
    }
  }
  G.ChunkMesher = ChunkMesher;
})(window.GW);
