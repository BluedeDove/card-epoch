/* src/app/sigil-view.js · 法阵贴图与网格（表现层）
   贴图按 shape+color 共享；dispose 只释放网格自己的几何/材质，不动共享贴图。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  G.SigilView = {
    create: function () {
      var cache = {};
      function texture(shape, color) {
        var key = shape + color;
        if (cache[key]) return cache[key];
        var S2 = 128, cv = document.createElement('canvas'); cv.width = cv.height = S2;
        var c = cv.getContext('2d');
        c.clearRect(0, 0, S2, S2);
        var grd = c.createRadialGradient(64, 64, 3, 64, 64, 60);
        grd.addColorStop(0, color); grd.addColorStop(0.45, color + 'aa'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.globalAlpha = 0.55; c.fillStyle = grd; c.beginPath(); c.arc(64, 64, 60, 0, 6.283); c.fill(); c.globalAlpha = 1;
        c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 6;
        c.beginPath(); c.arc(64, 64, 58, 0, 6.283); c.stroke();
        c.lineWidth = 2; c.beginPath(); c.arc(64, 64, 46, 0, 6.283); c.stroke();
        c.beginPath(); c.arc(64, 64, 22, 0, 6.283); c.stroke();
        var n = shape === 'poly7' ? 7 : shape === 'poly6' ? 6 : shape === 'square' ? 4 : shape === 'triangle' ? 3 : shape === 'flower' ? 8 : 5;
        c.lineWidth = 2.4; c.beginPath();
        for (var i = 0; i <= n; i++) { var a = i / n * 6.283 - 1.57, r = 46; var x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
        c.closePath(); c.stroke();
        for (var k = 0; k < n * 2; k++) { var a2 = k / (n * 2) * 6.283; c.globalAlpha = 0.55 + 0.45 * Math.sin(k * 2.1); c.beginPath(); c.arc(64 + Math.cos(a2) * 34, 64 + Math.sin(a2) * 34, 3.4, 0, 6.283); c.fill(); }
        c.globalAlpha = 1;
        for (var t2 = 0; t2 < 26; t2++) { var a3 = t2 / 26 * 6.283; c.fillRect(64 + Math.cos(a3) * 52 - 1, 64 + Math.sin(a3) * 52 - 1, 3, 3); }
        var tex = new THREE.CanvasTexture(cv);
        cache[key] = tex; return tex;
      }
      function build(s) {
        var tex = texture(s.preset.shape, s.preset.color);
        var g = new THREE.Group();
        var ground = new THREE.Mesh(new THREE.PlaneGeometry(s.radius * 2.3, s.radius * 2.3),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        ground.rotation.x = -Math.PI / 2;
        g.add(ground);
        var beams = [];
        for (var i = 0; i < 2; i++) {
          var bm = new THREE.Mesh(new THREE.PlaneGeometry(s.radius * 1.9, 5.4),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
          bm.position.y = 2.7; bm.rotation.y = i * Math.PI / 2;
          g.add(bm); beams.push(bm);
        }
        g.userData.ground = ground; g.userData.beams = beams;
        return g;
      }
      function dispose(mesh) {
        if (!mesh) return;
        mesh.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
      function setOpacity(mesh, v) {
        if (!mesh) return;
        if (mesh.userData.ground) {
          mesh.userData.ground.material.opacity = Math.min(1, v + 0.25);
          for (var i = 0; i < mesh.userData.beams.length; i++) mesh.userData.beams[i].material.opacity = v * 0.34;
        } else mesh.material.opacity = v;
      }
      return { texture: texture, build: build, dispose: dispose, setOpacity: setOpacity };
    }
  };
})(window.GW);
