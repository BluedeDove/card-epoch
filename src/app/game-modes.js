/* src/app/game-modes.js · 玩法数据（docs/MODES.md §2 的唯一真源：纯数据 + 两个解析函数）
   这一层只回答"一个玩法**是什么**"：得分表、胜利条件、地图元素开关、给 UI 的显示字段清单。
   与 rule-presets.js / map-presets.js 同一条纪律：**只交数字与 id，零 DOM、零 THREE、零中文文案。**
     · 中文（玩法名 / 一句话 / 胜分选项 / 榜单行标签）归 src/hud.js 的 H.TEXT.game / H.TEXT.board；
     · 流程、记分、终局、displaySpec 归 src/app/match-director.js（编排类）；
     · 权威层 src/battle.js 只留三个钩子（onKill / scoreboardStep / lodePoints），
       它**不认识任何具体玩法**——加一个玩法 = 本表加一条 + H.TEXT.game 两句文案，
       不改 battle / director / UI（tools/mode_check.cjs 的 M6 用一个假玩法 testmode 守着这条）。
   数字口径：lode 的 100 分 / 480s / 加时 45s 就是 docs/GAMEPLAY.md 的定案值；
   规则预设（ranked / blitz / training，真源 src/app/rule-presets.js）在 gameModeFor 里**并进 lode**，
   所以选 blitz 仍然是"胜分 75 / 限时 300s / 占矿宽限 6s"，一份数字不写两处（定案 §7.3 的反对面）。
   覆盖只允许打在已知玩法上，未知 id 一律回退 lode（照 rulePresetFor / mapPresetFor 的同一条口径）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var MODES = {
    /* lode = 以太争锋（现状玩法）：占矿 1 分/3s + 击杀 15 分 + 三矿各一只晶甲兽 + 两条三选一额度。
       lodePointsPerTick = 1 是"沿用今天的每 3 秒 +1"的旗标，同时决定 director 把时间/终局
       判定**整段委托**给 G.Systems.Scoreboard.step（MODES.md §3 末条：默认玩法逐字节不变）。 */
    lode: {
      id: 'lode', labelKey: 'game.lode',
      score: { kill: 15, lodePointsPerTick: 1 },
      win: { type: 'score', target: 100, timeCap: 480, overtimeCap: 45 },
      map: { lodes: true, beasts: 3, draft: { lode: 3, beast: 3 } },
      holdGrace: 0, respawn: 2.2,
      /* display.unit 说的是"目标线按什么计"——lode 的 100 是**分**（占矿 + 击杀两条来源），
         死亡竞赛的 10 是**杀**。这个字只影响 chip 的量词，中文在 H.TEXT.board.units（数据层不许出现中文）。 */
      display: { rows: ['score', 'kills', 'deaths'], target: true, time: true, unit: 'score' }
    },
    /* deathmatch = 死亡竞赛（多人新玩法）：杀人得分，矿**不再给分**（素材/魔力照给，
       由 LodeSystem 的 MATS_EVERY 与 manaBonusOf 那两条走），没有晶甲兽、没有三选一。
       target 由选关的「胜分」覆盖（5 / 10 / 不限）；0 = 不限 → win.type 改 'never'，只按 timeCap 判。 */
    deathmatch: {
      id: 'deathmatch', labelKey: 'game.dm',
      score: { kill: 1, lodePointsPerTick: 0 },
      win: { type: 'score', target: 10, timeCap: 480, overtimeCap: 45 },
      map: { lodes: true, beasts: 0, draft: { lode: 0, beast: 0 } },
      holdGrace: 0, respawn: 2.2,
      display: { rows: ['kills', 'deaths', 'score'], target: true, time: true, unit: 'kill' }
    }
  };
  var DEFAULT = 'lode';
  /* dm 的「胜分」三档（选关面板的那一行读它；0 = 不限）。
     放在数据层而不是 panels.js：视图只画条目，档位与 gameModeFor 的解释权必须同一个主人。 */
  var DM_TARGETS = [5, 10, 0];

  function deep(o) {
    if (Array.isArray(o)) return o.map(deep);
    if (o && typeof o === 'object') { var r = {}; Object.keys(o).forEach(function (k) { r[k] = deep(o[k]); }); return r; }
    return o;
  }
  function num(v, dflt) { var n = Number(v); return isFinite(n) ? n : dflt; }
  /* 不限分（win.target === 0）时给权威层的一个"到不了的分数线"：Scoreboard.addScore 的
     `p.score >= m.scoreWin` 因此永不触发，终局只剩 director 的时限判据（MODES.md §2）。
     用 1e9 而不是 Infinity——存档 / 快照里 Infinity 会被 JSON 收成 null，读回来就成了 0 分胜。 */
  var UNREACHABLE = 1e9;

  /* ---------- 解析：cfg.game → 一份可用的玩法配置（拷贝，调用方改它不污染表） ----------
     cfg.game 可为 id 字符串，也可为 {id, target?, timeCap?, overtimeCap?}；未知 id 回 lode。 */
  function gameModeFor(cfg) {
    var raw = cfg && cfg.game;
    var over = (raw && typeof raw === 'object') ? raw : {};
    var id = over.id || raw || DEFAULT;
    var base = MODES[id] || MODES[DEFAULT];
    var m = deep(base);
    m.id = base.id; m.labelKey = base.labelKey;
    var rp = (G.rulePresetFor) ? G.rulePresetFor(cfg) : null;   // lode 合并规则预设；其它玩法只用它的 aiLevel
    if (m.id === 'lode') {
      /* lode 必须把现有规则预设合并进来（任务书 1）：胜分 / 两只钟 / 晶甲兽 / 两条额度 / 占矿宽限。
         规则仍是"数值"，玩法是"结构"，两份数字不各写一份（docs/LEVELS.md §1.2 同一条纪律）。 */
      if (rp) {
        m.win.target = rp.scoreWin; m.win.timeCap = rp.timeCap; m.win.overtimeCap = rp.overtimeCap;
        m.map.beasts = rp.beasts;
        m.map.draft = { lode: rp.draftCapLode, beast: rp.draftCapBeast };
        m.holdGrace = rp.holdGrace;
        m.ruleId = rp.ruleId; m.aiLevel = rp.aiLevel;
      }
      m.win.type = 'score';                                    // lode 永远有分数线（训练场的 1000 分也走这条）
    } else {
      if (rp) m.aiLevel = rp.aiLevel;                          // AI 等级仍归规则（session 的 AISource 读它）
      if (over.target !== undefined) m.win.target = num(over.target, base.win.target);
    }
    /* 覆盖字段：先查表、再谈覆盖（未知玩法不许凭空造一条出来） */
    if (over.timeCap !== undefined) m.win.timeCap = num(over.timeCap, base.win.timeCap);
    if (over.overtimeCap !== undefined) m.win.overtimeCap = num(over.overtimeCap, base.win.overtimeCap);
    /* 不限（target 0 / 负 / 非数）：没有分数线 → type 'never'，只按 timeCap 判；timeCap 0 = 永不自动结束 */
    m.win.target = Math.max(0, Math.floor(num(m.win.target, 0)));
    if (m.win.target === 0) m.win.type = 'never';
    else if (!m.win.type) m.win.type = 'score';
    m.score.kill = Math.floor(num(m.score.kill, 1));
    m.score.lodePointsPerTick = Math.floor(num(m.score.lodePointsPerTick, 0));
    m.win.timeCap = Math.max(0, num(m.win.timeCap, 0));
    m.win.overtimeCap = Math.max(0, num(m.win.overtimeCap, 0));
    if (!m.display || !Array.isArray(m.display.rows)) m.display = { rows: ['score', 'kills', 'deaths'], target: true, time: true };
    return m;
  }

  /* ---------- 玩法 → Match 构造参数（app 层的展开，battle.js 只认 opts，见定案 §7.3） ----------
     返回的字段名与 rulePresetFor 的输出**逐字同名**，所以 session.buildMatch 的 Match opts 一行不用改形状；
     aiLevel 不在玩法表里（它是 AI 的难度档，归规则），从这里原样透传。 */
  function matchOptsFor(mode, rp) {
    var src = mode || {};
    var win = src.win || {}, map = src.map || {}, draft = map.draft || {};
    return {
      scoreWin: win.target > 0 ? win.target : UNREACHABLE,
      timeCap: win.timeCap, overtimeCap: win.overtimeCap,
      holdGrace: src.holdGrace,
      beasts: map.beasts,
      draftCapLode: draft.lode, draftCapBeast: draft.beast,
      aiLevel: (src.aiLevel != null) ? src.aiLevel : (rp ? rp.aiLevel : 1)
    };
  }

  G.GAME_MODES = MODES;
  G.GAME_DEFAULT = DEFAULT;
  G.DM_TARGETS = DM_TARGETS;
  G.gameModeFor = gameModeFor;
  G.modeMatchOpts = matchOptsFor;
})(window.GW);
