/* js/systems/stats-store.js · 按局战绩（RoundRecord + 本地历史）
   只做三件事：把一局结算成可序列化记录、追加到历史、聚合（局数/胜率/平均时长）。
   存储：有 localStorage 就存 'gw.history'（上限 100 局），没有（node 探针）就落内存。
   零 DOM / 零文案；展示由 UI 读 list()/aggregate()。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var KEY = 'gw.history';
  var mem = null;

  function backend() {
    try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (e) {}
    return null;
  }
  function readAll() {
    var be = backend();
    if (be) {
      try { var raw = be.getItem(KEY); if (raw) return JSON.parse(raw) || []; } catch (e) {}
      return [];
    }
    return mem || (mem = []);
  }
  function writeAll(list) {
    var be = backend();
    if (be) { try { be.setItem(KEY, JSON.stringify(list)); } catch (e) {} return; }
    mem = list;
  }

  function record(match, cfg) {
    if (!match) return null;
    var over = match.over || null;
    return {
      v: 1,
      seed: match.seed >>> 0,
      mode: (cfg && cfg.mode) || match.mode || 'train',
      winner: over ? over.winner : null,
      reason: over ? (over.winReason || 'manual') : null,
      ticks: match.tick | 0,
      duration: +(match.time || 0).toFixed(2),
      endedAt: Date.now(),
      stats: G.MatchStats && G.MatchStats.snapshot ? G.MatchStats.snapshot(match) : null
    };
  }

  function add(rec) {
    if (!rec) return { ok: false, reason: 'empty' };
    var list = readAll();
    list.push(rec);
    if (list.length > 100) list = list.slice(list.length - 100);
    writeAll(list);
    return { ok: true, count: list.length };
  }

  function list() { return readAll().slice(); }
  function clear() { writeAll([]); return { ok: true }; }

  function aggregate() {
    var list = readAll();
    var out = { games: list.length, p1Wins: 0, p2Wins: 0, draws: 0, avgDuration: 0, avgScore: [0, 0], kills: [0, 0] };
    var dur = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.winner === 0) out.p1Wins++; else if (r.winner === 1) out.p2Wins++; else out.draws++;
      dur += r.duration || 0;
      if (r.stats && r.stats.perSide) {
        for (var s = 0; s < 2; s++) {
          out.avgScore[s] += (r.stats.perSide[s] && r.stats.perSide[s].score) || 0;
          out.kills[s] += (r.stats.perSide[s] && r.stats.perSide[s].kills) || 0;
        }
      }
    }
    if (list.length) { out.avgDuration = +(dur / list.length).toFixed(1); out.avgScore[0] = +(out.avgScore[0] / list.length).toFixed(1); out.avgScore[1] = +(out.avgScore[1] / list.length).toFixed(1); }
    out.winRate = list.length ? +(out.p1Wins / list.length).toFixed(3) : 0;
    return out;
  }

  G.StatsStore = { record: record, add: add, list: list, clear: clear, aggregate: aggregate, KEY: KEY };
})(window.GW);
