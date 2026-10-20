/* ================= GW.Save =================
   存档 = seed + 与基线的差异格（学 Minecraft 只存"改动过的区块"）
   同一种子 → 地形逐格一致；再套上 diff 就能完整复现一局世界。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var KEY = 'gw_baseline_save_v1';

  function diffCells(world) {
    if (!world.baseline) return [];
    var out = [];
    for (var i = 0; i < world.blocks.length; i++) {
      if (world.blocks[i] !== world.baseline[i]) {
        var y = Math.floor(i / (world.SZ * world.SX)), rem = i - y * world.SZ * world.SX;
        var z = Math.floor(rem / world.SX), x = rem - z * world.SX;
        out.push([x, y, z, world.blocks[i]]);
        if (out.length > 120000) break;
      }
    }
    return out;
  }
  function exportFrom(world, match) {
    return {
      v: 1, seed: world.seed, size: [world.SX, world.SY, world.SZ],
      cells: diffCells(world),
      players: match ? match.players.map(function (p) {
        return { side: p.side, deck: p.deck, hand: p.hand, discard: p.discard, hp: p.hp, maxHp: p.maxHp, mana: p.mana, manaCap: p.manaCap, mats: p.mats, lives: p.lives, kills: p.kills };
      }) : null,
      time: match ? +match.time.toFixed(2) : 0
    };
  }
  function applyTo(world, obj) {
    if (!obj || !obj.cells) return { ok: false, reason: '存档里没有地形变更' };
    for (var i = 0; i < obj.cells.length; i++) {
      var c = obj.cells[i];
      if (c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < world.SX && c[1] < world.SY && c[2] < world.SZ)
        world.set(c[0], c[1], c[2], c[3] | 0);
    }
    return { ok: true, cells: obj.cells.length };
  }
  function toText(o) { return JSON.stringify(o); }
  function fromText(t) {
    try {
      var o = JSON.parse(t);
      if (!o || typeof o.seed !== 'number' || !Array.isArray(o.cells)) return { ok: false, reason: '不是本游戏的存档 JSON（应包含 seed 与 cells）' };
      return { ok: true, obj: o };
    } catch (e) { return { ok: false, reason: 'JSON 解析失败：' + e.message }; }
  }
  G.Save = {
    exportFrom: exportFrom, applyTo: applyTo, toText: toText, fromText: fromText,
    localSave: function (obj) { try { localStorage.setItem(KEY, toText(obj)); return true; } catch (e) { return false; } },
    localLoad: function () { try { var s = localStorage.getItem(KEY); return s ? fromText(s) : { ok: false, reason: '本地还没有存档（先在局内按 F9 保存）' }; } catch (e) { return { ok: false, reason: 'localStorage 不可用：' + e.message }; } },
    hasLocal: function () { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },
    clear: function () { try { localStorage.removeItem(KEY); return true; } catch (e) { return false; } }
  };
})(window.GW);
