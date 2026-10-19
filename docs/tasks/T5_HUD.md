# 任务 T5 · HUD：分数 / 矿脉归属 / 三选一面板 / 结算原因

先读：`docs/CARD_ECONOMY.md` §2、`docs/LEVELS.md` §4、`docs/UI_KIT.md` 的"五步"与"面板类交互三条硬要求"。
只允许修改：`src/ui/viewmodel.js`、`src/ui/panels.js`、`src/ui/theme.css`、`src/hud.js`、`src/main.js`。
**不许**改权威层（battle/rules/lode-system/summon）的结算逻辑，不许 git commit。

## 要做的事

1. `src/ui/viewmodel.js`（唯一读 match 的地方）在 `build()` 里补字段：
   - `score: [p0.score|0, p1.score|0]`；
   - `timeLeft: 'm:ss'`（`Math.max(0, match.timeCap - match.time)`，找不到 timeCap 就空串）；
   - `lodes: [{owner, contested}]`（来自 `match.lodeSys && match.lodeSys.lodes`，无矿脉时 `[]`）；
   - `ruleText` / `mapText`（读 `env.app && env.app.session && env.app.session.cfg` 的 rule/map id，**只读 id**，中文由 hud 的文案表翻）。
2. `src/ui/panels.js` 的 `Topbar`：
   - 第一行加两块：`P1 分 / P2 分`（id `ui-score`）与「三矿」三个小方块（id `ui-lodes`，按 `vm.lodes` 的 owner 上色：
     0 = `var(--el-fire)` 一档、1 = `var(--el-ice)`、-1 = `var(--txt-3)`，contested 时加虚线框；颜色只能是 theme.css 令牌）；
   - 第二行 meta 里加倒计时（`C.timeLeft` + `vm.timeLeft`）。
   - 常驻层不许进中央 40%（`ui_shot --gate` 会量），窄屏要能换行不重叠。
3. `src/ui/theme.css`：新增 `.ui-top-score` / `.ui-lode-chip` 等类，只用 `:root` 令牌，零圆角、零模糊阴影、边框 0/2px。
4. `src/hud.js` 的 `H.TEXT`：
   - `topbar` 加 `scoreLabel: '比分'`、`timeLeftLabel: '剩余'`、`lodeLabel: '矿脉'`；
   - 新段 `draft: { lodeTitle: '首占矿脉 · 三选一', beastTitle: '晶甲兽首杀 · 三选一', hint: '选一张，×2 进本局牌库；Esc 先跳过（次数不返还）' }`；
   - `result.reason` 映射表：`score/time/overtime/overtime-tie/manual` 各一句人话；
   - `result.rows` 去掉 `p1lives/p2lives`，加 `['胜负原因','reason']`、`['关卡','level']`。
5. `src/main.js`：
   - 每帧（在 step 之后、渲染之前）查 `S.match.pendingDraft && S.match.pendingDraft()`；有且 `!G.HUD.panelOpen('choice')`
     且 `!S.overPause` 时调 `G.HUD.openChoice({ title, hint, items: offer.options.map(id => ({ id })), onPick, onSkip })`，
     `onPick`: `var id = it && it.meta && it.meta.id; if (id) S.match.takeDraft(offer.side, id);`，
     `onSkip`: `S.match.skipDraft(offer.side);`。用一个 `S.draftOpenFor` 记住已弹过的 offer 引用，避免同一次弹两遍；
     `takeDraft/skipDraft` 返回 false 时要 `G.HUD.toast` 一句人话（不许静默）。
   - `onMatchOver` / 结算字段：把 `winReason`、关卡（`S.cfg.map.id` + `S.cfg.rule`）传给 `G.HUD.showMatchResult`，
     中文在 hud 的 `H.TEXT.result` 里翻。
6. 文案纪律：所有面向玩家的中文进 `H.TEXT`；`panels.js` 里不许出现中文字面量（`layer_check` 与 `ui_check` 静态段拦）。

## 验收（自己跑，贴真实输出）

       node tools/ui_check.cjs
       node tools/creative_check.cjs
       node tools/ui_shot.cjs --shots /tmp/gwt5 --gate
       node tools/ui_shot.cjs --shots /tmp/gwt5-15 --gate --viewport 1280x720 --dpr 1.5
       node tools/layer_check.cjs
       node tools/audit.cjs

判据：ui_check 全绿（它含意图词汇表反查与静态分层）；creative_check 53 条全绿；
两条 ui_shot 的 --gate 全绿；layer_check 退出 0；audit 三种子与基线一致（seed 31337 的 C4/H 是**已知基线红**，
若红必须确认与本任务前是同样的两条，不许新增红项）。落图后自己打开 /tmp/gwt5 里的对局/结算截图看一眼（不许只看绿灯）。

## 报告
改了哪些文件；6 条命令关键输出；31337 的红项是否是基线那两条；不确定处。