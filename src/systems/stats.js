/* js/systems/stats.js · 对局指标（S1 最小版；S5 扩成 RoundRecord/StatsStore）
   只记账、不判定胜负；字段按 side 分开，供 HUD / 结算 / 探针只读。
   S1 只接 score / kills / deaths / cardsPlayed 四项，其余在 S5 随事件总线补齐。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function blank() {
    return { score: 0, kills: 0, deaths: 0, cardsPlayed: 0, damageDealt: 0, damageTaken: 0,
             blocksPlaced: 0, blocksRemoved: 0, sigilsCast: 0, lodeHoldSec: 0 };
  }
  function create() { return { v: 1, perSide: [blank(), blank()], timeline: [] }; }
  function bump(m, side, key, n) {
    if (!m || !m.stats || !m.stats.perSide) return 0;
    var rec = m.stats.perSide[side | 0];
    if (!rec || typeof rec[key] !== 'number') return 0;
    rec[key] += (n === undefined ? 1 : n);
    return rec[key];
  }
  function event(m, type, side, n) {
    if (!m || !m.stats) return;
    m.stats.timeline.push({ t: +m.time.toFixed(3), type: type, side: side | 0, n: n === undefined ? 1 : n });
    if (m.stats.timeline.length > 400) m.stats.timeline.shift();
  }
  function snapshot(m) {
    if (!m || !m.stats) return null;
    return { v: m.stats.v, perSide: m.stats.perSide.map(function (r) { return Object.assign({}, r); }),
             timeline: m.stats.timeline.slice() };
  }
  G.MatchStats = { create: create, bump: bump, event: event, snapshot: snapshot };
})(window.GW);
