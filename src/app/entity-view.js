/* src/app/entity-view.js · 随从像素模型（表现层，纯几何）
   只按 aiKind 拼盒子；不读权威、不写回实体。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function pixelMat(hex) { return new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }); }
  function box(w2, h2, d2, hex, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, d2), pixelMat(hex));
    m.position.set(x, y, z); return m;
  }
  function summonMesh(e) {
    var g = new THREE.Group();
    if (e.aiKind === 'golem') {
      g.add(box(0.9, 1.1, 0.7, '#8b8b93', 0, 0.9, 0), box(0.6, 0.5, 0.5, '#7a7a82', 0, 1.6, 0), box(0.28, 0.9, 0.28, '#6f6f77', -0.62, 0.9, 0), box(0.28, 0.9, 0.28, '#6f6f77', 0.62, 0.9, 0));
      g.add(box(0.14, 0.14, 0.06, '#ff7a45', -0.14, 1.62, 0.26), box(0.14, 0.14, 0.06, '#ff7a45', 0.14, 1.62, 0.26));
    } else if (e.aiKind === 'dryad') {
      g.add(box(0.36, 1.3, 0.36, '#7a5230', 0, 0.65, 0), box(1.0, 0.7, 1.0, '#3f7d2c', 0, 1.6, 0), box(0.5, 0.4, 0.5, '#5aa832', 0, 2.05, 0));
    } else if (e.aiKind === 'hawk') {
      g.add(box(0.44, 0.3, 0.5, '#a9dcf2', 0, 0.5, 0));
      g.add(box(1.0, 0.1, 0.34, '#7fd7ff', -0.5, 0.56, -0.06));
      g.add(box(1.0, 0.1, 0.34, '#7fd7ff', 0.5, 0.56, -0.06));
      g.add(box(0.16, 0.14, 0.18, '#ffffff', 0, 0.5, 0.28));
      g.add(box(0.1, 0.1, 0.1, '#ffe066', -0.12, 0.62, 0.2), box(0.1, 0.1, 0.1, '#ffe066', 0.12, 0.62, 0.2));
    } else if (e.aiKind === 'bee') {
      g.add(box(0.34, 0.28, 0.34, '#ffd23f', 0, 0.5, 0));
      g.add(box(0.36, 0.08, 0.36, '#2a1e12', 0, 0.5, 0), box(0.36, 0.08, 0.36, '#2a1e12', 0, 0.64, 0));
      g.add(box(0.5, 0.04, 0.2, '#ffffff', 0, 0.7, -0.16));
    } else if (e.aiKind === 'wisp_void') {
      g.add(box(0.38, 0.38, 0.38, '#c58cff', 0, 0.5, 0));
      g.add(box(0.18, 0.18, 0.18, '#f0e0ff', 0, 0.5, 0));
      g.add(box(0.3, 0.06, 0.06, '#8a5ad0', -0.28, 0.62, 0), box(0.3, 0.06, 0.06, '#8a5ad0', 0.28, 0.62, 0));
    } else if (e.aiKind === 'wisp') {
      g.add(box(0.34, 0.3, 0.46, '#ff7a45', 0, 0.55, 0));
      g.add(box(0.72, 0.08, 0.28, '#ffd23f', -0.38, 0.6, -0.04), box(0.72, 0.08, 0.28, '#ffd23f', 0.38, 0.6, -0.04));
      g.add(box(0.14, 0.14, 0.18, '#fff2b0', 0, 0.55, 0.26));
      g.add(box(0.16, 0.3, 0.16, '#ff0050', 0, 0.55, -0.34));
    } else if (e.aiKind === 'crystal_beast') {
      /* 晶甲兽（中立生态，GAMEPLAY §2.5；任务书 T4 只加这一个分支）：深紫蓝石壳 + 背上一根以太晶 + 两眼。
         块数与 golem/hawk 同量级（5 块），h 1.7 → 身体顶到 ~1.2、晶尖 ~1.8，站在矿台上读得出「护矿的东西」。
         这几个颜色是这只单位的本体色，不是 UI 令牌——本文件本来就是表现层的纯几何：零 DOM、零文案。 */
      g.add(box(0.92, 0.8, 0.72, '#5a4a8a', 0, 0.6, 0));
      g.add(box(0.6, 0.46, 0.56, '#7a63b8', 0, 1.16, 0.06));
      g.add(box(0.24, 0.5, 0.24, '#b26bff', 0, 1.55, -0.04));
      g.add(box(0.13, 0.13, 0.08, '#e0d0ff', -0.13, 1.18, 0.34), box(0.13, 0.13, 0.08, '#e0d0ff', 0.13, 1.18, 0.34));
    } else {
      var m = box(0.5, 0.5, 0.5, '#ff7a45', 0, 0.9, 0); g.add(m);
      g.add(box(0.24, 0.24, 0.24, '#ffe066', 0, 1.25, 0));
    }
    g.userData.born = true;
    return g;
  }
  G.EntityView = { summonMesh: summonMesh };
})(window.GW);
