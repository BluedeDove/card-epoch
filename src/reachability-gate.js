/* js/reachability-gate.js · L1 world（生成期一次性使用，不进 tick）
   依赖：js/world.js（G.BLOCK / G.BLOCK_DEFS / World.prototype.surfaceY）
   只回答这一个问题：这张地图是否公平可玩（两出生点互通、每条矿从两侧都可达、三矿两两水平距在闸内）。

   BFS 在 64²=4096 的柱面网格上开局跑一次，与 tick 无关——谁把它改成"每 tick 复检"，
   谁就是在违反"绝不整图扫描"（play_probe H5/H6 插桩盯着，现峰值 1488 get/tick）。
   行走口径与主路整平共用同一把尺：站高 = surfaceY，4 邻、高差 ≤1 可通行；
   顶上压岩浆的柱不可走（主路必须安全），水可涉（侧路"快而险"的那部分不拦）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 一柱能不能站进行走图。站高用 camGroundY（跳过树叶——surfaceY 把树冠当地面，
     整片森林会被读成悬空的冠顶阶梯，人和走廊都走不了；这是 world.js 给相机层写好的现成答案）。
     岩浆盖顶的柱不可走；水柱放行——淹着走慢但能走。整列无地面（-1）不可走。 */
  function groundY(w, x, z) { return w.camGroundY(x, z); }
  function walkable(w, x, z) {
    if (x < 0 || z < 0 || x >= w.SX || z >= w.SZ) return false;
    var B = G.BLOCK, y = groundY(w, x, z);
    if (y < 0) return false;
    if (w.get(x, y + 1, z) === B.LAVA) return false;
    return true;
  }

  /* 从一柱出发的 4 邻 BFS（高差 ≤1）。返回 Int32Array(SX*SZ)，-1 = 不可达。
     4096 柱 × 常数邻居，开局一次，毫秒级。 */
  function bfs(w, sx, sz) {
    var SX = w.SX, SZ = w.SZ, dist = new Int32Array(SX * SZ);
    dist.fill(-1);
    if (!walkable(w, sx, sz)) return dist;
    var qx = new Int32Array(SX * SZ), qz = new Int32Array(SX * SZ), head = 0, tail = 0;
    var ys = new Int16Array(SX * SZ), yc = new Int8Array(SX * SZ);
    function yAt(x, z) { var i = z * SX + x; if (!yc[i]) { var g = groundY(w, x, z); ys[i] = g < 0 ? 0 : g; yc[i] = 1; } return ys[i]; }
    dist[sz * SX + sx] = 0; qx[tail] = sx; qz[tail] = sz; tail++;
    var DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];
    while (head < tail) {
      var x = qx[head], z = qz[head]; head++;
      var d0 = dist[z * SX + x], y0 = yAt(x, z);
      for (var k = 0; k < 4; k++) {
        var nx = x + DX[k], nz = z + DZ[k];
        if (!walkable(w, nx, nz)) continue;
        var ni = nz * SX + nx;
        if (dist[ni] >= 0) continue;
        if (Math.abs(yAt(nx, nz) - y0) > 1) continue;
        dist[ni] = d0 + 1; qx[tail] = nx; qz[tail] = nz; tail++;
      }
    }
    return dist;
  }

  G.ReachabilityGate = {
    walkable: walkable,
    bfs: bfs,
    /* 闸：① 两出生点互通 ② 每矿平台（3×3 认证区）从两侧都可达 ③ 三矿两两水平距 ∈ [distMin,distMax]。
       spawnCells: [{x,z},{x,z}]（整数格）；lodes: [{x,z,cells:[[x,z]…]}]（cells = 平台柱集合）。
       opts.distMin / opts.distMax（缺省 18 / 40）：闸宽是**随地图尺度**的量（docs/LEVELS.md §3 定案
       scale = SX/64），由调用方 LodePlanter 乘好 scale 再传进来，本层不认识尺寸；缺省值就是 64 图
       的老口径，不传第 4 个参数与今天逐字节一致（play_probe L2 走的正是这条缺省路）。
       返回可汇报的全量明细——退化是否发生、差几步、闸有多宽（range），都从这里读，不许另算一份。 */
    check: function (w, spawnCells, lodes, opts) {
      var distMin = (opts && opts.distMin !== undefined) ? opts.distMin : 18;
      var distMax = (opts && opts.distMax !== undefined) ? opts.distMax : 40;
      var d0 = bfs(w, spawnCells[0].x, spawnCells[0].z);
      var d1 = bfs(w, spawnCells[1].x, spawnCells[1].z);
      var at = function (dist, x, z) { return dist[z * w.SX + x]; };
      var spawnLinked = at(d0, spawnCells[1].x, spawnCells[1].z) >= 0;
      var reach = [], steps0 = [], steps1 = [];
      for (var i = 0; i < lodes.length; i++) {
        var best0 = -1, best1 = -1, cells = lodes[i].cells;
        for (var c = 0; c < cells.length; c++) {
          var s0 = at(d0, cells[c][0], cells[c][1]), s1 = at(d1, cells[c][0], cells[c][1]);
          if (s0 >= 0 && (best0 < 0 || s0 < best0)) best0 = s0;
          if (s1 >= 0 && (best1 < 0 || s1 < best1)) best1 = s1;
        }
        steps0.push(best0); steps1.push(best1);
        reach.push([best0 >= 0, best1 >= 0]);
      }
      var dists = [];
      for (var a = 0; a < lodes.length; a++) for (var b = a + 1; b < lodes.length; b++) {
        var dx = lodes[a].x - lodes[b].x, dz = lodes[a].z - lodes[b].z;
        dists.push(Math.sqrt(dx * dx + dz * dz));
      }
      var distOk = true;
      for (var k2 = 0; k2 < dists.length; k2++) if (dists[k2] < distMin || dists[k2] > distMax) distOk = false;
      var reachOk = true;
      for (var r = 0; r < reach.length; r++) if (!reach[r][0] || !reach[r][1]) reachOk = false;
      var reasons = [];
      if (!spawnLinked) reasons.push('spawn-unlinked');
      if (!reachOk) reasons.push('lode-unreachable');
      if (!distOk) reasons.push('lode-distance');
      return { ok: spawnLinked && reachOk && distOk, spawnLinked: spawnLinked, reach: reach,
               steps0: steps0, steps1: steps1, dists: dists, reasons: reasons, range: [distMin, distMax] };
    },

    /* 排序公平分（GAMEPLAY §5「排序公平由生成器负责，不靠放宽带宽」2026-10-17 拍板）：
       双方到三矿的 BFS 步数各自排序后，逐元素相对差的最大值，越小越公平。
       只读 check() 的产物——seed 的确定函数，零新随机源（play_probe H1 的命门）。
       没过闸的图不参与竞选；这里返回 Infinity 只是兜底，不作任何判决。 */
    fairScore: function (g) {
      var s0 = g.steps0.slice().sort(function (a, b) { return a - b; });
      var s1 = g.steps1.slice().sort(function (a, b) { return a - b; });
      var m = 0;
      for (var i = 0; i < s0.length; i++) {
        if (s0[i] < 0 || s1[i] < 0) return Infinity;
        var r = Math.abs(s0[i] - s1[i]) / Math.max(s0[i], s1[i], 1);
        if (r > m) m = r;
      }
      return m;
    },
    /* 在过闸的候选里选 fairScore 最小的一张；并列取 attempts 序号最小（比较用严格 <，
       后来的同分不替换先到者）——选择是 attempts 序列的确定函数，确定性链完整。 */
    pickBest: function (cands) {
      var best = null;
      for (var i = 0; i < cands.length; i++) if (!best || cands[i].score < best.score) best = cands[i];
      return best;
    }
  };
})(window.GW);
