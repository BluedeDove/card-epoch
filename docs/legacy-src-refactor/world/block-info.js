window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：src/world/block-table.js
     只回答"这个 id 是什么性质"；不存坐标、不碰世界数据。 */
  var KEYS = G.BLOCK_KEYS, CN = G.BLOCK_CN, ROWS = G.BLOCK_ROWS;
  function build() {
    return ROWS.map(function (d, i) { return Object.assign({}, d, { id: i, key: KEYS[i], cn: CN[i], tiles: [0, 0, 0] }); });
  }
  class BlockInfo {
    constructor() {
      this.defs = build();
      this.byKey = {}; var self = this; this.defs.forEach(function (d) { self.byKey[d.key] = d; });
    }
    def(id) { return this.defs[id] || this.defs[0]; }
    solid(id) { return id > 0 && !!this.defs[id].solid; }
    opaque(id) { return id > 0 && !!this.defs[id].opaque; }
    liquid(id) { return id > 0 && !!this.defs[id].liquid; }
    solidAtKey(key) { return !!this.byKey[key] && this.byKey[key].solid; }
    idOf(key) { return this.byKey[key] === undefined ? -1 : this.byKey[key].id; }
    cn(id) { return this.def(id).cn; }
    color(id) { return this.def(id).color; }
    dropOf(id) { return this.def(id).drop; }
    burnsBy(id) { return this.def(id).burn; }
    /* tiles 由 render/atlas 在启动时算好后写回来（图集才是像素的专家） */
    assignTiles(id, triple) { this.defs[id].tiles = triple; return this; }
    tilesOf(id) { return this.def(id).tiles; }
  }
  G.BlockInfo = BlockInfo;
  /* 全页共用一个 BlockInfo 实例：图集生成后把 tiles 写回同一份 defs，
     世界层与渲染层读到的必须是同一批对象（旧代码就是靠 G.BLOCK_DEFS 这个共享身份） */
  G.blocks = new BlockInfo();
  G.BLOCK_DEFS = G.blocks.defs;
  /* 旧调用点（rules 的地形取块）用 key→id 的平表，保留同名导出 */
  G.blockKeyToId = (function () { var m = {}, d = G.BLOCK_DEFS; for (var i = 0; i < d.length; i++) m[d[i].key] = i; return m; })();

})(window.GW);
