# 玩法编排（Game Mode）与积分榜（2026-10-18 定）

> 用户要求：在**模块化**前提下给多人游戏加一套全新规则；先做一个最小可用的——双方选卡进局、互相打、
> 记死亡榜，杀得多的人分高；胜分可**限定**也可**不限**。但系统不能只有这一种模式，流程与显示都必须**可编排**，
> 由一个专门的类负责，不能写死。后续更复杂的玩法经「选关页面那个类」追加。

## 1. 三条分工（谁写什么）

| 层 | 文件 | 只回答 |
|---|---|---|
| 数据 | `src/app/game-modes.js` | 一个玩法**是什么**：得分表、胜利条件、地图元素开关、显示字段清单 |
| 编排 | `src/app/match-director.js` | 这一局**怎么走**：阶段、得分记账、何时结束、给 UI 的画面规格（displaySpec） |
| 表现 | `src/ui/viewmodel.js` + `panels.js` + `hud.js` | 只把 director 的 displaySpec 画出来；不判断几杀算赢 |

权威层（`battle.js`）只保留两个钩子：击杀时把事件交给 director；占矿产出时问 director 该给几分。
**结算器不认识任何具体玩法**。

## 2. 玩法数据（`src/app/game-modes.js`，纯数据 + 一个解析函数）

```
G.GAME_MODES = {
  lode: { id:'lode', labelKey:'game.lode',
    score: { kill: 15, lodePointsPerTick: 1 },        // lodePointsPerTick=1 表示沿用「每 3 秒 +1」
    win:   { type:'score', target:100, timeCap:480, overtimeCap:45 },
    map:   { lodes:true, beasts:3, draft:{lode:3,beast:3} },
    respawn: 2.2,
    display: { rows:['score','kills','deaths'], target:true, time:true } },
  deathmatch: { id:'deathmatch', labelKey:'game.dm',
    score: { kill: 1, lodePointsPerTick: 0 },         // 死亡竞赛：杀人得分，矿不再给分（素材照给）
    win:   { type:'score', target:10, timeCap:480, overtimeCap:45 },  // target 由用户选项覆盖；0 = 不限
    map:   { lodes:true, beasts:0, draft:{lode:0,beast:0} },
    respawn: 2.2,
    display: { rows:['kills','deaths','score'], target:true, time:true } }
};
G.gameModeFor(cfg)   // cfg.game = {id, target?}; 未知 id → lode；返回拷贝后的模式配置
```

- **限定/不限**：`win.target > 0` = 限定分数；`win.target === 0` = 不限（此时 `win.type:'never'`，
  按 `timeCap` 到点比分数；`timeCap:0` 则永不结束，只能手动退出）。
- 加一个玩法 = 在这张表里加一条（+ `H.TEXT.game` 两句文案）。**不改 battle / director / UI**。

## 3. 编排类（`src/app/match-director.js`，纯逻辑：零 DOM / 零 THREE / 零文案）

```
G.MatchDirector.create(modeCfg, match) -> director
director.phase                 // 'prep' | 'live' | 'ended'
director.begin()               // → live，记开始时刻
director.onKill(killerSide, victimSide)   // 记账：击杀者 +score.kill、击杀数 +1、被击杀者死亡数 +1
director.tick(dt)              // 时间与终局判定（目标分 / 时限 / 加时）；只在 live 里做事
director.snapshot()            // {phase, scores:[...], kills:[...], deaths:[...], target, timeLeft, overtime}
director.displaySpec()         // 交给 UI 的纯数据：{titleKey, rows:[{key,labelKey,value}], chips, target, timeLeft}
```

规则（最小集）：

- 击杀：`killer.score += mode.score.kill`，同时把权威字段 `players[].score` 同步（HUD/存档读它）。
- 终局：`target>0 && score>=target` → 结束（reason `score`）；`timeCap>0 && time>=timeCap` → 比分数（`time`，
  平局进加时 `overtimeCap`：下一个得分事件定胜负，到点仍平则依次比 击杀数 → 死亡数少 → 平局 `overtime-tie`）。
- `target===0`：没有分数线，只有时限；`timeCap===0`：永不自动结束（`director` 不判）。
- **lode 玩法必须逐字节沿用今天的结算**：`lodePointsPerTick:1` 时 director 的时间/终局判定直接委托
  `G.Systems.Scoreboard.step`（现成的 100 分 / 480s / 45s 加时 / 逐级判定），击杀仍走 `match.addScore(p,15)`。
  这样默认玩法的行为不变（play_probe/audit 不受影响）。

## 4. 权威层的两个钩子（改得越少越好）

1. `battle.js` 的 `kill`：玩家击杀玩家时，`if (this.director) this.director.onKill(src.side, p.side); else this.addScore(src, 15)`。
2. `lode-system.js` 产分：`var pts = m.director ? m.director.lodePoints() : 1;`，为 0 时不加分（素材照常，由 `MATS_EVERY` 那条走）。
3. `Match.scoreboardStep`：`if (this.director) { this.director.tick(dt); return; }` 否则走老逻辑。
4. `session.buildMatch`：按 `cfg.game` 取模式 → `match.director = G.MatchDirector.create(mode, match)`；
   `lodes/beasts/draftCap` 以模式配置为准（规则预设只覆盖数值）。

## 5. 显示也是编排的

- `viewmodel.build()` 里 `vm.board = match.director ? match.director.displaySpec() : null`；
- `H.TEXT.board` 提供每个 `key` 的中文标签；面板只按 `rows/chips` 顺序渲染（**不写死哪几行**）；
- 顶栏右侧新增「积分榜」块：两列（我方/对方）× director 给的 rows；目标是 `10 杀` 或 `不限`；时间由 director 给。
- 结算面板：`winReason` 仍由权威层给 key（score/time/overtime/overtime-tie/manual/opponent-left），中文在 `H.TEXT.result.reason`。

## 6. 选关页面的两个轴（玩法 × 规则）

- **玩法**：`lode`（占矿争锋，默认）/ `deathmatch`（死亡竞赛）。
- 选 `deathmatch` 时多一行「胜分」：`5 杀 / 10 杀 / 不限`（写进 `cfg.game.target`；`不限`=0）。
- 选 `lode` 时仍显示现有三条规则（ranked/blitz/training）。
- 追加玩法只改 `game-modes.js` + `H.TEXT.game/gameNotes` + （如需要）规则表；选关面板本身不用改。

## 7. 验收（谁拦）

| 断言 | 工具 | 判据 |
|---|---|---|
| 击杀记账 / 死亡榜 / 目标分结束 / 不限分只按时间 / 加时 | `tools/mode_check.cjs`（新） | 逐事件断言，node 里跑 |
| 加一个假玩法（不改 battle/director/UI）也能驱动得分与结束 | 同上 | 注册 `testmode`，跑出同样结果 |
| lode 玩法行为不变 | `play_probe` + `audit` + `mode_check` 的对照 | 与今天的 100 分/480s 一致 |
| displaySpec 行可编排 | `mode_check` + `ui_check` 静态 | 面板按 rows 渲染、H.TEXT.board 有每个 key |
| 选关两个轴 | `level_check` | game/limit 进 cfg，未知 game 回 lode |
