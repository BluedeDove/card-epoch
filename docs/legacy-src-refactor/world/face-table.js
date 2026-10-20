window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（纯数据）
     六面的顶点顺序、uv 行、亮度与取哪张 tile。亮度差是体素立体感的来源：
     顶 1.0、底 0.45、四个侧面各异（左/右 0.72、前 0.62、后 0.84）。 */
  G.FACES = [
    { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], uvRow: 0, light: 0.72, tile: "side" },
    { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], uvRow: 0, light: 0.72, tile: "side" },
    { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]], uvRow: 1, light: 0.45, tile: "bottom" },
    { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], uvRow: 0, light: 1.0, tile: "top" },
    { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], uvRow: 0, light: 0.62, tile: "side" },
    { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], uvRow: 0, light: 0.84, tile: "side" }
  ];
  G.TILE_INDEX = { top: 0, bottom: 2, side: 1 };
})(window.GW);
