/* js/app/rule-presets.js · 规则预设（docs/LEVELS.md §1.2 的唯一真源，纯数据）
   定位与 map-presets.js 同一条：**这一层只交数字与 id，零 DOM、零文案、零分支策略。**
     · 中文（规则名 / 一句话）归 src/hud.js 的 H.TEXT.level，按 id 查；
     · 消费方只有两处：src/app/session.js 的 buildMatch（展开成 Match opts）
       与 tools/level_check.cjs（逐字段核对本文档的表）；
     · 这些数字**不许**再写进 src/battle.js（定案 §7.3：规则是 Match opts，不是结算器常量）。
   beasts 的量纲照 battle.js 的 opts.beasts：0 = 一只都不生成，3 = 至多三只（每矿一只的上限由 lode 数量决定）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var PRESETS = {
    /* ranked = docs/GAMEPLAY.md 的定案值：100 分胜 / 480s 硬上限 / 加时 45s / 无占矿宽限 / 三矿各一只晶甲兽 */
    ranked: {
      id: 'ranked', labelKey: 'rule.ranked',
      scoreWin: 100, timeCap: 480, overtimeCap: 45, holdGrace: 0,
      beasts: 3, draftCapLode: 3, draftCapBeast: 3, aiLevel: 1
    },
    /* blitz = A2-c 量过但未定案的调速档：胜分 75 + 占矿宽限 6s（默认关闭，只有选这一关才开） */
    blitz: {
      id: 'blitz', labelKey: 'rule.blitz',
      scoreWin: 75, timeCap: 300, overtimeCap: 30, holdGrace: 6,
      beasts: 3, draftCapLode: 2, draftCapBeast: 3, aiLevel: 1
    },
    /* training = 训练场：1000 分到不了（等于不设胜分），600s 到点按分数/占矿判；没有晶甲兽、AI 最弱、兽不给三选一 */
    training: {
      id: 'training', labelKey: 'rule.training',
      scoreWin: 1000, timeCap: 600, overtimeCap: 45, holdGrace: 0,
      beasts: 0, draftCapLode: 3, draftCapBeast: 0, aiLevel: 0
    },
    /* arcade = 街机爽玩档（2026-10-18 用户："我就一直按左键，子弹随时在变，爽就完了"）：
       与其它档的**唯一差别是魔力**——上限与回复都调高，按住左键才连得起来。
       这两个字段是可选档：没写的规则走 battle.js 的既有常量（8 上限 / +0.9 每秒），老档逐字节不变。 */
    arcade: {
      id: 'arcade', labelKey: 'rule.arcade',
      scoreWin: 100, timeCap: 480, overtimeCap: 45, holdGrace: 0,
      beasts: 3, draftCapLode: 3, draftCapBeast: 3, aiLevel: 1,
      manaCap: 12, manaRegen: 2.6
    }
  };
  var DEFAULT = 'ranked';
  function get(id) { return PRESETS[id] || PRESETS[DEFAULT]; }
  /* cfg.rule 可以是 id 字符串，也可以带覆盖字段（量具与存档要用）；未知 id 一律回退 ranked。
     覆盖只允许打在已知规则上（照 mapPresetFor 的同一条口径：先查表、再谈覆盖）。 */
  function forCfg(cfg) {
    var raw = cfg && cfg.rule;
    var id = (raw && raw.id) || raw || DEFAULT;
    var p = get(id);
    var over = (raw && typeof raw === 'object') ? raw : {};
    var out = { ruleId: p.id, labelKey: p.labelKey };
    /* manaCap / manaRegen 是可选档：只有声明了它们的规则才会出现在 out 里（其余保持 undefined →
       session.buildMatch 不传 → Match 用 battle.js 的既有常量）。 */
    var keys = ['scoreWin', 'timeCap', 'overtimeCap', 'holdGrace', 'beasts', 'draftCapLode', 'draftCapBeast', 'aiLevel', 'manaCap', 'manaRegen'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      out[k] = (over[k] === undefined) ? p[k] : over[k];
    }
    return out;
  }
  G.RULE_PRESETS = PRESETS;
  G.RULE_DEFAULT = DEFAULT;
  G.rulePresetGet = get;
  G.rulePresetFor = forCfg;
})(window.GW);
