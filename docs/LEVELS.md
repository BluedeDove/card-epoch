# 卡牌纪元 · 关卡选择（地图 × 规则 × 模式）（定案 v1 · 2026-10-18）

> 本文回答"打开游戏之后先看到什么、选什么、选完发生什么"。
> 数值来源：`docs/GAMEPLAY.md`（胜负与地图）与 `docs/CARD_ECONOMY.md`（牌与经济）。
> 现状：菜单已经能选"模式/种子/卡组/地图"，但**地图选择是死的**（`session.buildWorld` 写死 96×40×96），
> 点"进入世界"就直接开局。本文把它改成"标题 → 选关 → 对局"。

## 0. 场景流

```
boot ──▶ menu（标题：开始游戏 / 帮助 / 存档）
          │ 开始游戏
          ▼
        level（选关：地图 × 规则 × 模式 + 种子 + 卡组）──▶ match ──▶ result
          ▲  返回标题                                            │
          └──────────────────────────────────────────────────────┘ 回选关
```

- `menu` 只留"招牌 + 开始 + 帮助 + 存档"；所有"这局怎么玩"的选择搬到 `level`。
- `level` 与 `menu` 都是暂停场景（`pausing: true`、pointer `free`）。
- `match` / `result` 不变。
- Esc 在 `level` = 返回 `menu`；在 `match` = 现有的面板栈逻辑（不动）。

## 1. 三个轴

### 1.1 地图（map）

| id | 名称 | 尺寸 | 海平面 | 出生 pad | 矿脉 | 定位（玩家看到的一句话） |
|---|---|---|---|---|---|---|
| `duel-64` | 决斗岛 | 64×36×64 | 12 | 9 | 3 | **默认 / 推荐**。定案尺寸：三矿一步之遥，前中期就抢起来 |
| `island-96` | 翠屿 | 96×40×96 | 12 | 9 | 3 | 大图：视野开阔、跑图成本高，允许远射程卡发挥 |
| `atoll-128` | 环礁 | 128×40×128 | 14 | 11 | 3 | 实验：超大图，交火距离远；**相机在 490706/88092 会误隐藏自己（C4）** |

> **默认图 = duel-64**（2026-10-18 实测：三种子相机审计 15 项全过，含历史上有名的 88092）。
> 旧记录说 88092 在 64 图上稳定红 C2/C3，那是在**铺矿前**的地形上量的；A2 的矿脉放置会整平
> 出生点→中矿走廊，出生区变平之后越肩构图不再糊准星。这条不是猜的：`tools/cam_audit.js` 的
> 15 项在 490706 / 88092 / 31337 三张 64 图上各自跑过（opts.map 注入，判据一条没改）。
> 96 / 128 两图同样过了这 15 项（见 T7 报告）；它们仍然标实验，因为节奏与射程没实测过。

- 值来自 `src/app/map-presets.js`（已有，不动它的默认值 `MAP_DEFAULT`）。
- `atoll-128` 与 `island-96` 在 UI 上标"实验"（沿用 `experimental` 字段）。

### 1.2 规则（rule）

| id | 名称 | scoreWin | timeCap(s) | overtimeCap(s) | holdGrace(s) | 晶甲兽 | 三选一上限（占矿+兽） | AI 等级 | 魔力（上限 / 每秒） |
|---|---|---|---|---|---|---|---|---|---|
| `ranked` | 以太争锋 | 100 | 480 | 45 | 0 | 3 只 | 3 + 3 | 1 | （默认 8 / +0.9） |
| `arcade` | 街机 · 爽玩 | 100 | 480 | 45 | 0 | 3 只 | 3 + 3 | 1 | **12 / +2.6** |
| `blitz` | 速攻 | 75 | 300 | 30 | 6 | 3 只 | 2 + 3 | 1 | （默认 8 / +0.9） |
| `training` | 训练场 | 1000 | 600 | 45 | 0 | 无 | 3 + 0 | 0 | （默认 8 / +0.9） |

- `ranked` = GAMEPLAY.md 的定案值，**默认**。
- `arcade`（2026-10-18 晚加）= 爽玩档：与 ranked 只差**魔力档**（`manaCap: 12` / `manaRegen: 2.6`）——按住左键连发（自动开火，
  规则在 `src/systems/auto.js`）才连得起来。这两个字段是**可选档**：没声明的规则不传，Match 用 `battle.js` 的既有常量 8 / +0.9，
  所以其它三档逐字节不变。判定：`tools/level_check.cjs` 逐条核规则表；`tools/auto_check.cjs` 核连发与守恒。
- `blitz` 用 A2-c 已验证但未定案的调速参数（胜分 75 + 占矿宽限 6s）：默认关闭 → 只有选这一关才开。
- `training` 不设胜分（1000 分到不了），600 秒到点按分数/占矿判；没有晶甲兽，AI 最弱。
- 所有值都是 **Match opts**，不允许写死在 battle.js 里（`scoreWin`/`timeCap`/`overtimeCap` 现在已是 opts，`holdGrace` 也是）。

### 1.3 模式（mode）

| id | 名称 | 说明 |
|---|---|---|
| `train` | 单人（AI 对手） | 默认；AI 走同一条输入通道（H4 守着）。2026-10-20 用户要求移除分屏与本地双人联网入口，菜单/选关不再提供 `split`/`net`。 |

## 2. 配置 schema（唯一真源）

```
cfg = {
  map:   { id: 'duel-64'|'island-96'|'atoll-128' },
  rule:  'ranked'|'arcade'|'blitz'|'training',
  mode:  'train',
  deck:  'starter'|'fire'|'ice'|'rock'|'nature'|'void'|'random',
  seed:  '490706' | '',
  creative: false
}
```

- `SessionRunner.buildWorld(cfg, seed)`：`G.mapPresetFor(cfg)` 取 `size/sea/spawnPad` 建 `G.World`。
  **不许**再写死 `[96,40,96]`。
- `SessionRunner.buildMatch(cfg, seed)`：把 `rule` 展开成 Match opts：
  `{ scoreWin, timeCap, overtimeCap, holdGrace, beasts, aiLevel, draftCapLode, draftCapBeast }`。
- `cfg` 存进 `S.cfg`（按 R 重开、再来一局都读它）；`APP.session.cfg` 同步。
- 存档导入（`menuActionKey('import'/'local')`）保留当前 cfg 的 map/rule/mode，只换 seed 与 load。

## 3. 矿脉尺度（多图支持）

`src/lode-planter.js` 目前硬性只在 `64×36×64` 工作（`if (w.SX !== 64 ...) return null`），
`reachability-gate.js` 的两两距闸写死 `[18,40]`。选关要多图，定案：

- `scale = w.SX / 64`
- 翼矿半径 `r ∈ [18,23] × scale`；连通闸两两水平距 `[18,40] × scale`。
- 其余（3×3 台面探测、出生 pad、走廊整平、叉积不共线）保持原样。
- **64 上 scale = 1**：结果必须与今天逐格一致（play_probe 的 H1/L1–L4c + 三种子守着）。
- 96 / 128 上若 8 次换盐后仍退化（单中矿图），如实保留 `lodes.degraded=true` 并在关卡里照常能玩；
  目标线要求三种子 × 两张大图 **都不退化**，退化就是红，不许静默降级。

## 4. UI 归属（照 docs/UI_KIT.md 的五步）

- **场景**：`src/app/scenes.js` 的 SCENES 加 `level: { panels: ['level'], pausing: true, pointer: 'free' }`。
- **面板**：`src/ui/panels.js` 新增 `class LevelSelect extends UI.Panel`（layer `level`、order 69）。
- **图层与挂载**：`src/ui/core.js` 的 LAYER_TABLE 在 `menu` 之后加 `{ name: 'level', mount: 'level', pointer: 'auto' }`；
  `index.html` 只加一个挂载点 `<div class="menu hidden" id="level"></div>`（骨架不写文案）。
- **文案**：全部进 `src/hud.js` 的 `H.TEXT.level`（标题、三栏小标题、每张地图/规则的一句话、实验提示、
  模式文案、按钮、`net` 未启用提示、种子占位符）。骨架与 panels.js 里不许有中文。
- **样式**：`src/ui/theme.css` 的 `.ui-level-*` 段；只用令牌，零圆角、零模糊阴影（ui_shot --gate 守着）。
- **动作**：走意图通道 `ui.levelPick`（选地图/规则/模式/卡组）与 `ui.levelStart`（开始）、`ui.levelBack`（返回）；
  先登记进 `src/ui/channel.js` 的 INTENTS，`src/main.js` 的 bindUIChannel 接住。
- **进入**：menu 的「开始游戏」→ `Scene.enter('level')`；`level` 的「开始对局」→ `start(cfg)`。
- **结算**：`result` 加「回选关」按钮（`ui.resultAction {key:'level'}`）。
- **分栏**：左 = 地图（3 张竖排卡），中 = 规则（4 张），右 = 模式（3 个）+ 种子 + 卡组 + [开始对局] + [返回标题]。

## 5. 验收（谁拦）

| 断言 | 工具 | 判据 |
|---|---|---|
| cfg → opts 映射正确 | `tools/level_check.cjs`（新） | 三个规则的 scoreWin/timeCap/overtimeCap/holdGrace/beasts 逐一相等；未知 id 回退默认 |
| 地图尺寸真的生效 | 同上 | `buildWorld` 用 duel-64/island-96/atoll-128 建出来的 `world.SX/SY/SZ` 逐一相等；三图同 seed 地形 checksum 不同 |
| 64 图零回归 | `node tools/play_probe.cjs 490706` | H1 + L1–L4c 全绿（逐格与今天一致） |
| 大图也有三矿 | `node tools/lode_scale_check.cjs`（新） | 96/128 × 三种子：`degraded === false` 且 `list.length === 3` |
| 场景流 | `node tools/scene_check.cjs` | `level` 场景存在、暂停、pointer free；menu→level→match→result 可达 |
| 选关界面能看 | `node tools/ui_shot.cjs --shots /tmp/gwlevel --gate`（1280×720@dpr1.5 再跑一次） | 落图后**逐张看**：三栏不重叠、文字不溢出、实验提示可见 |
| UI 行为 | `node tools/ui_check.cjs` + `node tools/creative_check.cjs` | 意图词汇表登记、无假成功、面板打开交还指针 |
| 分层 | `node tools/layer_check.cjs` | 文案只在 H.TEXT、骨架无中文 |

## 6. 不做

- 不做关卡解锁/进度（全开）、不做存档槽、不做自定义规则编辑器、不做联网。
- 不把"模式"做成排行榜/赛季之类没实现的东西；训练场也不做无限资源（那是创造模式）。
