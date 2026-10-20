window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：src/world/voxel-store.js
     竞技场边界：世界外 get() 返回 0（空气），从岛边一步踏空会一直掉到 y<-6 才触发复活。
     把侧壁与底面当不可见墙——只约束实体，不改世界数据，也不影响出牌改造地形；
     顶部不设限，垒高与被击飞仍然正常。 */
  class ArenaBounds {
    constructor(store) { this.store = store; }
    out(x, y, z, hw, hh) {
      if (y - hh < 0) return true;
      return this.outAxis(x, hw, this.store.SX) || this.outAxis(z, hw, this.store.SZ);
    }
    outAxis(v, hw, limit) { return v - hw < 0 || v + hw > limit; }
  }
  G.ArenaBounds = ArenaBounds;
})(window.GW);
