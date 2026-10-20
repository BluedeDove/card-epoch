# REFACTOR_WORK · 并行施工单（refactor/systems 分支）

> 真源：docs/PLAN_SYSTEMS.md v1.4。本文件只写"这一轮谁做什么、边界在哪"，不重复计划。
> 基线：分支 refactor/systems，HEAD = 基线快照。所有改动只在本分支。

## 全局纪律

1. 只写自己清单里的文件；不许改 battle.js / rules.js / main.js / index.html / cards.js / hud.js / ui/panels.js / ui/viewmodel.js（集成由 Lead 做）。
2. 新文件一律 IIFE + window.GW 挂载，零 ES module、零构建；逻辑层零 DOM、零玩家可见中文。
3. 代码从现有文件搬，不顺手改行为/数值/顺序；搬完在文件头写"来源：js/xxx.js 的 yyy 方法"。
4. 交付时给出：文件清单、搬了哪些方法、已知未接线点、怎么自测。
5. 不做 git commit；Lead 统一验收后提交。

## A · S0 量具（新文件，三个）

- tools/determinism.cjs
  - node 里建 World + Match（照抄 tools/cards_probe.cjs 的 headless 装载方式），固定输入序列跑 N tick。
  - 输出 world 哈希（所有 blocks）+ 实体字段（players/summons/projectiles/sigils 的关键字段）+ 分数 + 事件序列。
  - CLI: --seeds 490706,88092,31337 --ticks 600 --trace；同树跑两次必须逐字节一致。
  - 事件序列格式：每行 t|type|side|n（damage/kill/cast/score/respawn/block）。
- tools/owner_check.cjs
  - 静态扫描 js/：文件 → 允许写的字段前缀白名单（先给一份初始表，写进脚本顶部）。
  - 报 p.hp =、e.pos.x =、match.time =、G.HUD.sel = 这类直接写；默认 --warn 退出 0，--strict 退出 1。
- tools/state_probe.cjs
  - 建一局，打印 game/player/match 三域快照（当前 Match 字段即可）；--ticks N --seed S --json。
  - 给后续 AppState 迁移当对照。

验收：三个脚本 node tools/xxx 能跑；determinism 同树两次输出相同。

## B · 背包纯层（新文件，三个）

- js/ui/bags/profiles.js：BAG_PROFILES（survival/creative）+ profileFor(cfg, modeState) 纯函数。
- js/ui/bags/sources.js：CardSources.hand/deck/discard/tray/catalog，接口 snapshot(appLike, side) -> {items,total}；只读、聚合、无 DOM。
  - appLike 先用 {match, ui, cards} 最小形状；不依赖 ViewModel。
- tools/bag_check.cjs：node 断言——生存页 deck 聚合 ×N 与 p.deck 一致；discard 最近在前；catalog 只在 creative；hand 5 格；没有 creative 分支漏出。
- 不接线到 panels/viewmodel（Lead 做）；不要改 hud 文案。

验收：node tools/bag_check.cjs 全绿。

## C · 效果 spec 纯层（新文件，两个）

- js/cards/effect-spec.js：EffectSpec 归一化 + expand(spec, ctx) -> AtomicOp[]（本轮到"能展开旧数据"为止，不执行）。
  - 形状纯函数：point/disk/line/box/column/crater/bowl/cage/bridge/shift；cells 按 (y,z,x) 排序。
  - legacy adapter：把 cards.js 现有 op（damage/setBlock/status/spawn/sigil/...）编译成 spec。
- tools/effect_check.cjs：加载 cards.js，把 73 张卡的 effects 全部过 adapter+expand；断言：无未知 op、无函数、顺序确定（同输入两次输出相同）、地形 cap 有单点截断。

验收：node tools/effect_check.cjs 全绿；不允许改 cards.js。

## 集成顺序（Lead）

A 的 determinism 先落地 → Lead 做 S1（Match.rev/touch/clock/rng + Scoreboard/Stats）→ B 接 selectors/BagPanel → C 接 rules → 每步跑 determinism + 对应探针。
