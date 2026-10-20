/* src/app/match-director.js · 对局编排类（docs/MODES.md §3 的落地：纯逻辑，零 DOM / 零 THREE / 零文案）
   这一层只回答"这一局**怎么走**"：阶段、记分、何时结束、给 UI 的画面规格（displaySpec）。
   与 game-modes.js 的分工（MODES.md §1）：玩法"是什么"在数据表里，本类一条玩法都不认识——
   它只读 mode.score / mode.win / mode.map / mode.display 四张表。加一个玩法不改本文件
   （tools/mode_check.cjs 的 M6 注册一个假玩法 testmode，跑通得分与结束，battle / director / UI 一行没动）。

   与权威层的关系（MODES.md §4 的三个钩子，battle.js 里只有那三行）：
     · Match.kill（玩家击杀玩家）→ director.onKill(killerSide, victimSide)
     · LodeSystem 产分           → director.lodePoints()（0 = 这个玩法矿不给分，素材照给）
     · Match.scoreboardStep      → director.tick(dt)
   入账一律走**既有的唯一入分口** match.addScore（Scoreboard.addScore：写 p.score、touch、MatchStats、
   到线即停），director 不自建第二套分数家——它自己的 snapshot 读的就是权威字段，两处永远同一个数。

   确定性：无 Date.now、无 Math.random、无 setTimeout。同一串事件喂两个 director → snapshot 逐字段相同
   （tools/mode_check.cjs 的 M9 钉这条，联机与回放都靠它）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  function Director(modeCfg, match) {
    this.m = match;
    /* 拿不到玩法表时退回默认玩法（本类不许因为缺配置就把一局判死） */
    this.mode = modeCfg || (G.gameModeFor ? G.gameModeFor(null) : null) || {
      id: 'default', labelKey: 'game.lode',
      score: { kill: 15, lodePointsPerTick: 1 },
      win: { type: 'score', target: 100, timeCap: 480, overtimeCap: 45 },
      map: { lodes: true, beasts: 0, draft: { lode: 0, beast: 0 } },
      holdGrace: 0, respawn: 2.2,
      display: { rows: ['score', 'kills', 'deaths'], target: true, time: true }
    };
    var win = this.mode.win || {};
    this.target = Math.max(0, Math.floor(num(win.target, 0)));         // 0 = 不限分
    this.timeCap = Math.max(0, num(win.timeCap, 0));                   // 0 = 永不自动结束
    this.overtimeCap = Math.max(0, num(win.overtimeCap, 0));
    var rows = (this.mode.display && this.mode.display.rows) || ['score', 'kills', 'deaths'];
    this.displayRows = Array.prototype.slice.call(rows);
    this.showTarget = !!(this.mode.display && this.mode.display.target !== false);
    /* 目标线的量词：表里写就用表里的，没写就按"矿给不给分"推（给分 → 分；只杀人 → 杀）。
       推而不是默认 'kill'：假玩法若靠占矿攒分，chip 说成"杀"就是一句假话（M7 守着字面值）。 */
    this.targetUnit = (this.mode.display && this.mode.display.unit) ||
      (num(this.mode.score && this.mode.score.lodePointsPerTick, 0) > 0 ? 'score' : 'kill');
    this.showTime = !!(this.mode.display && this.mode.display.time !== false);
    this.kills = [0, 0];
    this.deaths = [0, 0];
    this.phase = 'prep';                                               // prep | live | ended
    this.startedAt = 0; this.elapsed = 0;
    this.overtime = false; this.overtimeStart = 0;
    /* lode（lodePointsPerTick >= 1）把时间/加时/逐级判定**整段委托**给现成的 Scoreboard.step：
       100 分 / 480s / 45s 加时 / 占矿秒数 → 血量 → 分数 → 平局，一条都不重写（MODES.md §3 末条）。
       死亡竞赛这类"矿不给分"的玩法走本类下面的通用判据（比分 → 加时 → 击杀 → 死亡少 → 平局）。 */
    this.delegate = num(this.mode.score && this.mode.score.lodePointsPerTick, 0) >= 1
      && !!(G.Systems && G.Systems.Scoreboard && G.Systems.Scoreboard.step);
  }

  Director.prototype.begin = function () {
    if (this.phase !== 'prep') return this.phase;
    this.phase = 'live';
    this.startedAt = (this.m && typeof this.m.time === 'number') ? this.m.time : 0;
    this.elapsed = 0;
    return this.phase;
  };

  /* ---------- 只读读数：分数永远读权威字段，击杀/死亡是 director 的账 ---------- */
  Director.prototype.scoreOf = function (side) {
    var p = this.m && this.m.players ? this.m.players[side] : null;
    return p ? (p.score | 0) : 0;
  };
  Director.prototype.scores = function () { return [this.scoreOf(0), this.scoreOf(1)]; };
  Director.prototype.timeLeft = function () {
    if (!(this.timeCap > 0)) return null;                              // 无时限 → 不给倒计时
    var left = (this.timeCap - this.elapsed);
    return left > 0 ? left : 0;
  };

  /* 阶段对账：权威层也可能从别处结束（对手离开 / 结算面板 / 手动），那时 Match.step 已经不再
     往下走，tick 不会再把 phase 翻成 ended —— 所以每次被读或被问都先对一次账（幂等、零副作用）。 */
  Director.prototype.syncPhase = function () {
    if (this.phase !== 'ended' && this.m && this.m.over) this.phase = 'ended';
    return this.phase;
  };

  /* ---------- 钩子 1：击杀记账（battle.js 的玩家杀玩家处调进来） ----------
     只记账 + 走唯一入分口，**不判 UI、不写文案**；phase 不是 live 时一个字节都不动。 */
  Director.prototype.onKill = function (killerSide, victimSide) {
    if (this.phase !== 'live') return null;
    var m = this.m;
    if (!m || m.over) { if (m && m.over) this.phase = 'ended'; return null; }
    var k = killerSide | 0, v = victimSide | 0;
    if (!(k === 0 || k === 1) || !(v === 0 || v === 1) || k === v) return null;
    this.kills[k] += 1;
    this.deaths[v] += 1;
    var pts = num(this.mode.score && this.mode.score.kill, 0);
    if (pts !== 0 && m.players[k] && typeof m.addScore === 'function') m.addScore(m.players[k], pts);
    else if (pts !== 0 && m.players[k]) m.players[k].score += pts;     // 没有 addScore 的夹具（纯 director 单测）
    this.syncPhase();
    var gained = this.scoreOf(k);
    if (this.target > 0 && gained >= this.target && !m.over) { m.finish(k, 'score'); this.phase = 'ended'; return { side: k, reason: 'score' }; }
    if (this.target === 0 && this.overtime && !m.over) { m.finish(k, 'overtime'); this.phase = 'ended'; return { side: k, reason: 'overtime' }; }
    return { side: k, score: gained };
  };

  /* ---------- 钩子 2：占矿该给几分（LodeSystem 产分处问一句） ---------- */
  Director.prototype.lodePoints = function () {
    return num(this.mode.score && this.mode.score.lodePointsPerTick, 0);
  };

  /* ---------- 钩子 3：每 tick 的钟与终局判定（Match.scoreboardStep 调进来） ---------- */
  Director.prototype.tick = function (dt) {
    if (this.phase === 'ended') return;
    var m = this.m;
    if (!m) return;
    if (m.over) { this.phase = 'ended'; return; }                      // 别人判掉的（对手离开 / 手动结束）
    if (this.phase !== 'live') return;                                 // prep 里不计时，ended 里不再判
    this.elapsed = (typeof m.time === 'number' ? m.time : 0) - this.startedAt;
    if (this.target > 0) {
      if (this.delegate) G.Systems.Scoreboard.step(m, dt);              // lode：逐字沿用今天的结算
      else this.judge();
    } else if (this.timeCap > 0) {
      this.judge();                                                     // 不限分：只按 timeCap 比分数
    }
    if (m.over) this.phase = 'ended';
  };

  /* 通用终局判据（非委托的那条路）：到点比分数 → 平局进加时（下一个得分事件定胜负，见 onKill）
     → 加时到点依次比 击杀数 → 死亡数少 → 平局 overtime-tie。 */
  Director.prototype.judge = function () {
    var m = this.m;
    if (this.elapsed < this.timeCap) return;
    var s = this.scores();
    if (!this.overtime) {
      if (s[0] === s[1]) { this.overtime = true; this.overtimeStart = this.elapsed; m.overtime = true; m.overtimeStart = m.time; return; }
      m.finish(s[0] > s[1] ? 0 : 1, 'time'); return;
    }
    if (this.elapsed - this.overtimeStart < this.overtimeCap) return;
    if (this.kills[0] !== this.kills[1]) { m.finish(this.kills[0] > this.kills[1] ? 0 : 1, 'overtime'); return; }
    if (this.deaths[0] !== this.deaths[1]) { m.finish(this.deaths[0] < this.deaths[1] ? 0 : 1, 'overtime'); return; }
    m.finish(-1, 'overtime-tie');
  };

  /* ---------- 交给回放 / 存档 / 量具的纯数据（同输入必同输出） ---------- */
  Director.prototype.snapshot = function () {
    this.syncPhase();
    return {
      phase: this.phase,
      scores: this.scores(),
      kills: [this.kills[0], this.kills[1]],
      deaths: [this.deaths[0], this.deaths[1]],
      target: this.target,
      timeLeft: this.timeLeft(),
      overtime: !!this.overtime
    };
  };

  /* ---------- 给 UI 的画面规格：行序与行数**完全由 mode.display.rows 决定** ----------
     面板不许写死"有哪几行"（MODES.md §5）：这里给顺序与 key，中文标签由 src/hud.js 的
     H.TEXT.board 按 key 翻；换行序不改 UI（tools/mode_check.cjs 的 M7 换一次行序核对）。 */
  Director.prototype.rowValue = function (key, side) {
    if (key === 'kills') return this.kills[side] | 0;
    if (key === 'deaths') return this.deaths[side] | 0;
    if (key === 'score') return this.scoreOf(side);
    var s = this.snapshot();                                            // 玩法自带的其它字段名
    var arr = s[key];
    return (arr && typeof arr[side] === 'number') ? arr[side] : 0;
  };
  Director.prototype.displaySpec = function () {
    this.syncPhase();
    var rows = [], i;
    for (i = 0; i < this.displayRows.length; i++) {
      var key = this.displayRows[i];
      rows.push({ key: key, labelKey: 'board.' + key, mine: this.rowValue(key, 0), theirs: this.rowValue(key, 1) });
    }
    var chips = [];
    if (this.showTarget) chips.push({ key: 'target', labelKey: 'board.target', value: this.target, unit: this.targetUnit });   // 0 = 不限
    if (this.showTime && this.timeCap > 0) chips.push({ key: 'timeLeft', labelKey: 'board.timeLeft', value: this.timeLeft() });
    return {
      titleKey: this.mode.labelKey || 'game.lode',
      modeId: this.mode.id || '',
      rows: rows, chips: chips,
      target: this.target, timeLeft: this.timeLeft(), overtime: !!this.overtime, phase: this.phase
    };
  };

  /* ---------- 联机（docs/NET.md §10 / 任务书 N5 第 8 条）：把房主的记分板对齐到本地这份 ----------
     为什么需要它：guest 不跑 Match.step，所以 battle 的三个钩子（onKill / tick / lodePoints）
     在它这边一个都不触发 —— kills / deaths / 加时 / 时限这几项**它自己永远算不出来**，
     只能抄房主随快照发来的那份 director.snapshot()。displaySpec 仍是唯一显示来源（本函数只改账，不改显示）。

     mirror（第三参）：房主发来的数组按**房主视角**排（index 0 = 房主），而本页 side 0 恒是自己，
     所以 guest 必须换位（与 net-match.applySnapshot 对 players[] 做的 1↔0 同一条口径，NET.md §9.1）。
     房主自己不调这条；调用方（src/main.js 的 netApplySnapshot）只在 guest 侧传 mirror=true。

     不覆盖的三样，各有各的理由：
       · scores —— 它读的是 players[].score，那条字段已由 applySnapshot 镜像过；在这儿再写一遍就是两份真源；
       · m.overtime / m.over 这些权威字段 —— 归 net-match（快照里的 over 已经换位），本层不碰权威；
       · startedAt —— 保留本地那一刻，只按房主的 timeLeft 反推 elapsed：guest 没有自己的钟在跑，
         时间这件事上"房主说还剩多少"就是事实（phase 也一样，见下面 syncPhase 那条）。
     幂等：同一份 board 连用两次结果相同（没有累加，全是覆盖）。确定性：不读 Date、不用随机。 */
  function applyBoard(d, board, mirror) {
    if (!d || !board || typeof board !== 'object') return { ok: false, reason: 'no-board' };
    var pick = function (arr, i) { return (Array.isArray(arr) && typeof arr[i] === 'number' && isFinite(arr[i])) ? (arr[i] | 0) : null; };
    var k0 = pick(board.kills, 0), k1 = pick(board.kills, 1);
    var d0 = pick(board.deaths, 0), d1 = pick(board.deaths, 1);
    if (k0 !== null && k1 !== null) { d.kills[0] = mirror ? k1 : k0; d.kills[1] = mirror ? k0 : k1; }
    if (d0 !== null && d1 !== null) { d.deaths[0] = mirror ? d1 : d0; d.deaths[1] = mirror ? d0 : d1; }
    if (typeof board.target === 'number' && isFinite(board.target)) d.target = Math.max(0, Math.floor(board.target));
    if (typeof board.overtime === 'boolean') d.overtime = board.overtime;
    if (typeof board.timeLeft === 'number' && isFinite(board.timeLeft) && d.timeCap > 0) {
      d.elapsed = Math.max(0, Math.min(d.timeCap, d.timeCap - board.timeLeft));
    }
    /* 阶段：房主说 ended 就是 ended（这一局真的结束了）；说 live 而本地还停在 prep 才推进，
       反向不推（本地已经 ended 却被一份迟到的 live 拉回 live = 结算面板消失、tick 又跑起来）。
       syncPhase 那条兜底照旧：本地 match.over 一出现，displaySpec 自己会把 phase 收成 ended。 */
    if (board.phase === 'ended') d.phase = 'ended';
    else if (board.phase === 'live' && d.phase === 'prep') d.begin();
    return { ok: true, kills: [d.kills[0], d.kills[1]], deaths: [d.deaths[0], d.deaths[1]], target: d.target };
  }

  G.MatchDirector = {
    create: function (modeCfg, match) { return new Director(modeCfg, match); },
    /* 联机对账入口（guest 侧唯一被调的那条；见上面那段注释） */
    apply: function (director, board, mirror) { return applyBoard(director, board, !!mirror); }
  };
})(window.GW);
