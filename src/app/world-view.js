/* src/app/world-view.js · 世界网格的建/脏块重建/远裁（表现层）
   chunks 对象由本模块持有并原地清空（外部持有同一个引用，比如 __dbg 的计数）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  G.WorldView = {
    create: function (deps) {
      var group = deps.group, makeChunk = deps.makeChunk;
      var chunks = {};
      function clearAll() {
        while (group.children.length) {
          var c = group.children.pop();
          if (c.traverse) c.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
        }
        for (var k in chunks) delete chunks[k];
      }
      function build(w) {
        clearAll();
        for (var cz = 0; cz * G.CHUNK < w.SZ; cz++) for (var cx = 0; cx * G.CHUNK < w.SX; cx++) chunks[cx + ',' + cz] = makeChunk(cx, cz);
      }
      function cull(w, match, fogFar) {
        if (!w || !match) return;
        var p = match.players[0], far = (fogFar || 150) * 1.08;
        for (var k in chunks) {
          var pr = k.split(','), cx = pr[0] * G.CHUNK + G.CHUNK / 2, cz = pr[1] * G.CHUNK + G.CHUNK / 2;
          chunks[k].visible = Math.hypot(cx - p.pos.x, cz - p.pos.z) < far;
        }
      }
      function flush(w, budget) {
        if (!w.dirty || !w.dirty.size) return;
        var keys = Array.from(w.dirty).slice(0, budget || 2);
        for (var i = 0; i < keys.length; i++) {
          w.dirty.delete(keys[i]);
          var p = keys[i].split(','), cx = +p[0], cz = +p[1];
          if (cx < 0 || cz < 0) continue;
          var old = chunks[keys[i]];
          if (old) { group.remove(old); old.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
          if (cx * G.CHUNK >= w.SX || cz * G.CHUNK >= w.SZ) continue;
          chunks[keys[i]] = makeChunk(cx, cz);
        }
      }
      return { chunks: chunks, build: build, cull: cull, flush: flush };
    }
  };
})(window.GW);
