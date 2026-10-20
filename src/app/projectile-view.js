/* src/app/projectile-view.js · 抛射物网格池（表现层）
   池里复用 Box 网格；每帧按 renderPos 插值位置、旋转，实体消失就回收。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  G.ProjectileView = {
    create: function (deps) {
      var group = deps.group, renderPos = deps.renderPos;
      var meshes = [], pool = [];
      function sync(list, dt) {
        for (var k = 0; k < list.length; k++) {
          var pr = list[k];
          if (!pr.mesh) {
            var m = pool.pop();
            if (!m) { m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshBasicMaterial({ color: 0xffffff })); }
            m.material.color.set(pr.color || '#fff'); m.visible = true; pr.mesh = m; group.add(m); meshes.push(pr);
          }
          var vpr = renderPos(pr);
          pr.mesh.position.set(vpr.x, vpr.y, vpr.z);
          pr.mesh.rotation.x += dt * 8; pr.mesh.rotation.y += dt * 6;
        }
        for (var n = meshes.length - 1; n >= 0; n--) {
          var q = meshes[n];
          if (list.indexOf(q) < 0) { group.remove(q.mesh); pool.push(q.mesh); q.mesh = null; meshes.splice(n, 1); }
        }
      }
      return { sync: sync };
    }
  };
})(window.GW);
