# REFACTOR_STATUS · 行为级重构交接（2026-10-17）

分支 refactor/systems（基线 cdb53d6）。目标是 docs/archive/PLAN_SYSTEMS.md（已归档） 的 S0–S6：
无状态系统、AppState 单一状态源、selector 派生、背包分版、场景/会话、统计。
本文件只写"现在长什么样、怎么验、还差什么"。

## 1. 结构

- src/systems/（9 个无状态模块，第一参是状态容器 m）
  deck / movement / aim / damage / projectile / summon / sigil / fluid / orb
  另有 scoreboard / stats / stats-store / match-ops / chem 适配面。
- src/core/rng.js：命名随机流；S1/S2 全部走 legacy 流，序列与重构前逐字节一致。
- src/app/：app-state（game/ui/view/session）、scenes（ui.scene + SCENES）、session（buildWorld/buildMatch）、map-presets。
- src/cards/effect-spec.js：旧 effect → AtomicOp（setBlock 13 模式 → shape），76 张卡可展开。
- src/rules/effects/：27 个效果原子（spawn/sigil/…/damage/status/ignite），registry 分发；rules 的 effect switch 只剩 setBlock/cells。
- src/ui/bags/：profiles（生存/创造分版）、sources（hand/deck/discard/tray/catalog 只读投影）。
- src/ui/selectors.js：hud / bag / result 纯函数 + rev key。
- 背包：生存页签 = 牌库/弃牌堆（只读聚合），创造页 = 图鉴/方块/随身/调试；页签由 BagProfile.pages 决定。
- 主菜单：模式/种子/卡组/地图（翠屿 96、决斗 64 实验、环礁 128 实验）/创造/存档。
- UI：Fusion Pixel 字体 + 自绘 9-slice 框 + Tiny Dungeon 卡面图标 + 菜单像素主视觉；换皮手册见 [UI_THEME.md](UI_THEME.md)。

## 2. 状态与传播

- AppState = { game, ui, view, session }；GWAPP.app 可读。
- 每次权威写递增 rev（Match.touch）；selector key 由 rev + ui 字段拼成。
- Scene 变更订阅写 ui.scene 并 ui.rev++；HUD 顶栏字段已改读 Selectors.hud（vm.state.hudKey）。
- 事件总线只发事实（damage/kill/cast）给 stats/音频/VFX，不用事件驱动 UI 状态。

## 3. 怎么验

一条命令：node tools/refactor_verify.cjs（快速 14 个脚本）；加 --full 再跑 ui_check/creative_check/audit 三种子 + file://。

分项：

node tools/determinism.cjs --seeds 490706,88092,31337 --ticks 400
node tools/cards_probe.cjs / hit_check / hand_check / chem_check / vfx_check
node tools/bag_check.cjs / selectors_check.cjs / scene_check.cjs / effect_check.cjs / stats_check.cjs / map_check.cjs
node tools/owner_check.cjs --strict
node tools/layer_check.cjs
node tools/ui_check.cjs / creative_check.cjs
node tools/audit.cjs（三种子）/ --file 490706
node tools/ui_shot.cjs --gate --shots /tmp/ui

## 4. 当前结果

- determinism：三种子 400 tick 与基线逐字节一致（S2 全程）。
- node 套件：cards 67、hit 44、hand 24、chem 34、vfx 71、bag 23、selectors 16、scene 11、effect 10、stats 9、map 7、owner strict 0、layer 全过。
- 真页面：ui_check 135、creative_check 53、ui_shot 门禁 0 违规（1440×860@dpr1 与 1280×720@dpr1.5 两档）。
- 结算页读 MatchStats/StatsStore（得分、历史局数/胜率/均时）；菜单显示战绩摘要。
- 一键复核：node tools/refactor_verify.cjs → 14/14；--full 覆盖真页面与 audit。
- audit：490706/88092 通过；31337 的 C4/H 与基线 worktree 完全相同（既有红，不是本次引入）。

## 5. 已知缺口（如实）

- 新卡写法见 [EFFECT_SPEC.md](EFFECT_SPEC.md)（cells/召唤/法阵的最小例子与验证命令）。
- rules 已消费 effect-spec：出牌循环走 expand(card)，27 个 op 全在 src/rules/effects/ 用注册表分发；cells 可建墙/铺板，召唤/法阵走同一通道。卡数据仍写旧 op（兼容），但执行器已是“原子处理器 + 地形流水线”。
- HUD 的 players/hands 已改由 `Selectors.hud` 翻译（格式化在 selector，vm 只取结果）；结算/菜单已读 StatsStore（局数/胜率/均时），A9/A11 基本补齐。
- Match 还有约 30 个原型方法（多为一行转发）；A4 的 ≤15 自有方法未达。
- S6 的 src/ 机械搬移未做：src/ 是并行重构线的落地区，搬移会与它冲突，应单独立项。
- tools/feel_probe.cjs 在当前环境三种子都报 zeroPct=100（基线同样），是探针/环境问题，没拿来当通过。

## 6. 兼容

- 老入口保留：GW.Match 构造器、Match 的 69 个方法名（转发）、GW.Rules.damage/addStatus、存档 v1、__GW_START/__camPose/__dbg/GWAPP。
- 卡数据未改：cards.js 一行未动；effect-spec 只读展开。
- UI 文案仍只在 H.TEXT；逻辑层零 DOM/零中文由 layer_check 守着。
