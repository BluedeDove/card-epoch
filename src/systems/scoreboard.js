/* js/systems/scoreboard.js · 分数与终局（从 battle.js 搬出，行为逐字不变）
   来源：js/battle.js 的 Match.prototype.addScore / scoreboardStep / finish。
   调用约定：所有函数第一个参数是状态容器 m（当前还是 Match 实例，S1 之后叫 GameState）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var S = G.Systems || (G.Systems = {});

  function addScore(m, p, n) {
    if (m.over) return;
    p.score += n;
    m.touch && m.touch('match');
    if (G.MatchStats) G.MatchStats.bump(m, p.side, 'score', n);
    if (p.score >= m.scoreWin) { S.Scoreboard.finish(m, p.side, 'score'); return; }
    if (m.overtime) S.Scoreboard.finish(m, p.side, 'overtime');
  }

  /* 每 tick 的钟：480s 硬上限。到点平分 → 加时（加时中任一得分事件仍立刻定胜负）；
     加时硬上限 45s；到上限仍未分则逐级判：
     ① 占矿累计秒数 → ② 血量百分比 → ③ 分数 → ④ 平局（overtime-tie）。 */
  function step(m, dt) {
    if (m.over) return;
    if (m.time < m.timeCap) return;
    var p0 = m.players[0], p1 = m.players[1];
    if (!m.overtime) {
      if (p0.score === p1.score) { m.overtime = true; m.overtimeStart = m.time; return; }
      S.Scoreboard.finish(m, p0.score > p1.score ? 0 : 1, 'time'); return;
    }
    if (m.time - m.overtimeStart < m.overtimeCap) return;
    var hold = m.lodeSys ? m.lodeSys.totalHold() : [0, 0];
    if (hold[0] !== hold[1]) { S.Scoreboard.finish(m, hold[0] > hold[1] ? 0 : 1, 'overtime'); return; }
    var h0 = p0.hp / p0.maxHp, h1 = p1.hp / p1.maxHp;
    if (h0 !== h1) { S.Scoreboard.finish(m, h0 > h1 ? 0 : 1, 'overtime'); return; }
    if (p0.score !== p1.score) { S.Scoreboard.finish(m, p0.score > p1.score ? 0 : 1, 'overtime'); return; }
    S.Scoreboard.finish(m, -1, 'overtime-tie');
  }

  /* over 形状保持五键：winner / name / ticks / time / winReason。 */
  function finish(m, winnerSide, reason) {
    if (m.over) return;
    var tied = winnerSide < 0;
    m.over = { winner: winnerSide, name: tied ? '' : m.players[winnerSide].name, ticks: m.tick, time: m.time,
               winReason: reason || 'manual' };
    m.touch && m.touch('match');
    m.fx.sfx('win');
    if (!tied) m.fx.log('★ ' + m.players[winnerSide].name + ' 获胜（' + m.time.toFixed(1) + ' 秒 / ' + m.tick + ' tick）', '#ffd86b');
    if (G.MatchStats) G.MatchStats.event(m, 'roundEnd', tied ? -1 : winnerSide, 1);
  }

  S.Scoreboard = { addScore: addScore, step: step, finish: finish };
})(window.GW);
