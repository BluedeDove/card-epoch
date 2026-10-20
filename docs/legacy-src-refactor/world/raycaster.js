window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：src/world/block-info.js, src/world/voxel-store.js
     DDA 体素射线：准星拾格、相机避墙、视线校验都走这一条。
     不变量：命中格必须与相机真实视轴一致——准星压 A 格，命中的就得是 A 格。 */
  class Raycaster {
    constructor(store, blocks) { this.store = store; this.blocks = blocks; }
    raycast(origin, dir, maxDist, opts) { return this.walk(this.step(origin, dir), opts || {}, maxDist); }
    /* 先探当前格；出界且已在世界底下方判空；否则沿最小 t 的轴推进一步 */
    walk(st, opts, maxDist) {
      var guard = 0;
      while (st.t <= maxDist && guard++ < 512) { var hit = this.probe(st, opts); if (hit) return hit; if (this.belowWorld(st)) return { hit: false }; this.advance(st); }
      return { hit: false };
    }
    step(origin, dir) { var s = this.cell(origin); this.axes(s, dir); this.seed(s, origin); return s; }
    cell(o) { return { x: Math.floor(o.x), y: Math.floor(o.y), z: Math.floor(o.z), face: [0, 0, 0], t: 0 }; }
    axes(s, dir) {
      s.sx = Raycaster.sign(dir.x); s.sy = Raycaster.sign(dir.y); s.sz = Raycaster.sign(dir.z);
      s.dx = Raycaster.delta(dir.x); s.dy = Raycaster.delta(dir.y); s.dz = Raycaster.delta(dir.z);
    }
    seed(s, o) {
      s.tx = s.dx * (s.sx > 0 ? s.x + 1 - o.x : o.x - s.x);
      s.ty = s.dy * (s.sy > 0 ? s.y + 1 - o.y : o.y - s.y);
      s.tz = s.dz * (s.sz > 0 ? s.z + 1 - o.z : o.z - s.z);
    }
    probe(st, opts) {
      var id = this.store.inB(st.x, st.y, st.z) ? this.store.get(st.x, st.y, st.z) : 0; if (!id) return null;
      var d = this.blocks.def(id);
      return this.accepts(d, id, opts) ? { hit: true, x: st.x, y: st.y, z: st.z, id: id, def: d, face: st.face, dist: st.t } : null;
    }
    /* 默认口径：固体算命中、液体可穿；opts 允许换判定（相机避墙要"只挡固体但放过水"） */
    accepts(d, id, opts) {
      var hitIt = opts.stopOnSolid === false ? !!d.opaque : !!d.solid;
      if (opts.ignoreLiquid !== false && d.liquid) return false; if (opts.accept && !opts.accept(id)) return false;
      return hitIt;
    }
    belowWorld(st) { return !this.store.inB(st.x, st.y, st.z) && st.y < 0; }
    /* 三轴里 t 最小的那个先推进；face 记"从哪边进入"，用 -step 表示 */
    advance(st) {
      if (st.tx < st.ty && st.tx < st.tz) { st.x += st.sx; st.t = st.tx; st.tx += st.dx; st.face = [-st.sx, 0, 0]; }
      else if (st.ty < st.tz) { st.y += st.sy; st.t = st.ty; st.ty += st.dy; st.face = [0, -st.sy, 0]; }
      else { st.z += st.sz; st.t = st.tz; st.tz += st.dz; st.face = [0, 0, -st.sz]; }
    }
  }
  Raycaster.sign = function (v) { return v > 0 ? 1 : -1; };
  Raycaster.delta = function (v) { return Math.abs(1 / (v || 1e-9)); };
  G.Raycaster = Raycaster;
})(window.GW);
