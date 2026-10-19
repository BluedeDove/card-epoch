# 任务 M1 · 玩法编排框架 + 死亡竞赛 + 可编排积分榜

先读：`docs/MODES.md` 全文（本任务的设计口径）、`src/systems/scoreboard.js`、`src/battle.js` 的 kill/addScore/scoreboardStep、`src/lode-system.js` 的产分、`src/app/session.js` 的 buildMatch、`src/ui/panels.js` 的 Topbar、`src/ui/viewmodel.js` 的 build。
只允许修改：新建 `src/app/game-modes.js`、新建 `src/app/match-director.js`、`src/app/session.js`、`src/battle.js`、`src/lode-system.js`、`src/ui/viewmodel.js`、`src/ui/panels.js`、`src/hud.js`、`src/main.js`、`src/ui/theme.css`（只加分板样式）、`index.html`（加 2 个 script）、`tools/mode_check.cjs`（新建）、`tools/level_check.cjs`（只加断言）。
不许 git commit；不许碰 `src/net*.js`、`src/app/router.js`、`src/app/scenes.js`。

## 要做的事

1. `src/app/game-modes.js`（纯数据 + 解析函数，零 DOM 零文案）：按 `docs/MODES.md` §2 建 `G.GAME_MODES`（`lode` / `deathmatch`）与 `G.gameModeFor(cfg)`：
   - `cfg.game` 可为 `{id, target}` 或 id 字符串；未知 id 回 `lode`；
   - **lode 必须把现有规则预设合并进来**：`win.target = rp.scoreWin`、`timeCap/overtimeCap = rp.timeCap/overtimeCap`、`map.beasts = rp.beasts`、`draft = {lode:rp.draftCapLode, beast:rp.draftCapBeast}`、`holdGrace = rp.holdGrace`；
   - `deathmatch`：`score.kill=1`、`score.lodePointsPerTick=0`、`map.beasts=0`、`draft` 全 0；`win.target = cfg.game.target ?? 10`，`0` 表示不限（`win.type='never'`）；`timeCap=480`。
2. `src/app/match-director.js`（纯逻辑，零 DOM / 零 THREE / 零中文）：`G.MatchDirector.create(modeCfg, match)`，按 `docs/MODES.md` §3 实现 phase / begin / onKill / tick / snapshot / displaySpec。要点：
   - `onKill(killerSide, victimSide)`：`kills[killer]++`、`deaths[victim]++`、`scores[killer] += mode.score.kill`，同步 `players[killer].score`；随后判目标（`target>0 && scores>=target` → `match.finish(killer, 'score')`）；
   - `tick(dt)` 只在 `live` 里：`target>0` 的正常走时间/加时/逐级判定（**lode 直接委托 `G.Systems.Scoreboard.step(match, dt)`**，match.scoreWin/timeCap 由 create 设好）；`target===0` 按 `timeCap` 比分数（平局进加时，下一个得分事件定胜负；加时到点比 击杀数 → 死亡数少 → 平局 `overtime-tie`）；`timeCap===0` 永不自动结束；
   - `displaySpec()`：`{titleKey, rows:[{key,labelKey,mine,theirs}], chips, target, timeLeft, overtime}`，rows 顺序与内容**完全由 mode.display.rows 决定**；
   - `lodePoints()`：返回 `mode.score.lodePointsPerTick`（lode=1，deathmatch=0）。
3. `src/battle.js` 三个最小钩子（别动别的）：
   - 玩家击杀玩家处：`if (this.director) this.director.onKill(src.side, p.side); else this.addScore(src, 15);`（保留原日志与 MatchStats）；
   - `Match.prototype.scoreboardStep`：`if (this.director) { this.director.tick(dt); return; }`；
   - `Match` 构造里 `this.director = null;`（由 session attach）。
4. `src/lode-system.js`：产分处 `var pts = m.director ? m.director.lodePoints() : 1;`，`pts===0` 时不加那 1 分（素材照常）。
5. `src/app/session.js` 的 `buildMatch`：
   - `var mode = G.gameModeFor(cfg);`；`scoreWin/timeCap/overtimeCap/holdGrace/beasts/draftCap*` 都从 `mode` 取；
   - `new Match(...)` 之后 `S.match.director = G.MatchDirector.create(mode, S.match); S.match.scoreWin = mode.win.target || S.match.scoreWin; S.match.timeCap = mode.win.timeCap; S.match.overtimeCap = mode.win.overtimeCap;`
   - 记录 `S.match.modeCfg = mode`（HUD 与量具读）。
6. 显示层（可编排）：
   - `viewmodel.js`：`vm.board = match.director ? match.director.displaySpec() : null;`
   - `panels.js` 的 `Topbar`：`when: vm.board` 时在顶栏第一行加 `.ui-top-board`——按 `vm.board.rows` 顺序渲染 `label  本方 / 对方`，末尾加 `目标 {target} 杀 | 不限` chip；样式加进 `theme.css`（令牌、零圆角、不新颜色，常驻层不进中央 40% 由 ui_shot 量）；
   - `hud.js`：`H.TEXT.board`（`rows` 每个 key 的中文标签：`score/kills/deaths`、`target`、`unlimited`、`timeLeft`）；`H.TEXT.game`（两个玩法的名字与一句描述、`dmTargets` 三个选项文案）；`H.TEXT.level` 加 `hGame`、`games` 数据（从 `G.GAME_MODES` 的 key 取值，文案在 H.TEXT）；`H.config()` 加 `game: { id: L.game || 'lode', target: L.gameTarget }`；
   - `main.js` 的 `ui.levelPick` 已通用（写 vm.level），无需改；`ui.levelStart` 把 cfg 交给 start（无需改）。
7. 选关面板（`LevelSelect`）：加「玩法」栏（`lode`/`deathmatch` 两张卡，走 `ui.levelPick {field:'game'}`）；选中 deathmatch 时显示「胜分」行：`5 杀 / 10 杀 / 不限`（`ui.levelPick {field:'gameTarget', value:5|10|0}`）；选中 lode 时保持现有「规则」卡片（规则只在 lode 下显示）。`vm.level` 初始状态加 `game:'lode', gameTarget:10`。
8. 结算：`hud.js` 的 `H.showMatchResult` 里，若 `match.director` 存在则补两行（击杀/死亡）数据来源 `match.director.snapshot()`；`H.TEXT.result.rows` 加对应行（键名自定，值在函数里填）。
9. 新建 `tools/mode_check.cjs`（node，构造照 `tools/draft_check.cjs`；世界 `{size:[64,36,64],seed,lodes:true}`）：
   M1 击杀记账（score/kills/deaths/players[].score）；M2 目标分结束（target=3，3 杀后 over.reason='score' winner=0）；
   M3 不限只按时间（target=0, timeCap=60：3 杀不结束；tick 到 60 后按比分结束）；M4 平局加时（下一个击杀定胜负）；
   M5 lode 模式与今天一致（kill +15、lodePoints=1、100 分结束、480s 时间判）；
   M6 加一个假玩法 `testmode`（kill 7 分、target 14）注册后 2 杀结束——**battle/director/UI 一行不改**；
   M7 displaySpec 的 rows 跟 mode.display.rows 走（换一行序也对）；M8 gameModeFor（未知回 lode、lode 合并规则预设、deathmatch target 0/10）；
   M9 两个 director 吃同一串事件 → snapshot 逐字段相同（无随机）；M10 静态：两个新文件无 `document.` / `THREE` / 中文字面量。
10. `tools/level_check.cjs` 加静态断言：`game-modes.js` 有两个 key；`H.config` 拼 `game:`；`panels.js` 有 `field:'game'` 与 `gameTarget`；`vm.level` 初始含 `game/gameTarget`。

## 验收（自己跑，贴真实输出）

```
node tools/mode_check.cjs
node tools/level_check.cjs
node tools/layer_check.cjs
node tools/play_probe.cjs 490706 1 10800 starter 1
node tools/draft_check.cjs
node tools/cards_probe.cjs
node tools/ui_check.cjs
node tools/creative_check.cjs
node tools/ui_shot.cjs --shots /tmp/gwmode --gate
node tools/audit.cjs
```

判据：mode_check 全绿；level_check 全绿（含新增）；layer 0；play_probe 33 绿 0 红；draft 36/cards 67；ui 140/creative 53；shot --gate 0 违规；audit 三种子全绿。
落图后看 `/tmp/gwmode/02-hud.png`：积分榜在顶栏、不压准星区、两列数值不清。

## 报告
改了哪些文件；10 条命令关键输出；积分榜截图你看到的问题；不确定处。