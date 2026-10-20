# 把 Noita 融进这款卡牌对战：调研与实施方案

状态：**S1 只做掉了"格粒度"那一半**，其余仍待用户核对。更新时间 2026-10-17 凌晨。

> 已落地（2026-10-17，用户要求"火扔到树上就该烧掉、冰就该化掉，而且要性能友好"）：
> [js/chem.js](../js/chem.js) = `GW.CHEM` —— 方块自带物质属性（DEFS）+ 一张九条规则的反应表 +
> 激活格队列与定时轮 + 每 tick 预算（看 56 格 / 改 8 格）+ 同时燃烧 420 格熔断；验收 `tools/chem_check.cjs`（34 条）。
> 这就是本文**"颗粒度决定成败"一节里说的 A 档（按格模拟）**，不是 Noita 那种逐像素颗粒。
> 本文其余部分（**S1 的 B 档次网格流体/颗粒、S2 法杖化、S3 触发器连锁**）**一行代码都还没写**，
> 仍然是计划。别把 chem 的存在当成"S1 已完成"。

## 结论先行

Noita 值得融进来的不是画面，是三件底层机制：

1. **物质模拟**：世界不是"方块类型"，而是"物质 + 属性"，沙子会流、火会爬、岩浆会推、酸会溶、TNT 会连锁。
2. **法杖即卡组**：Noita 的法杖字段 `deck_capacity / actions_per_round / fire_rate_wait / spread_degrees / shuffle_deck_when_empty / mana_charge_speed / mana_max` 与卡组系统完全同构——把"一张卡"升级成"一根杖 + 一串槽位"，深度立刻来自排列组合而不是卡牌数量。
3. **触发器链**：法术可以挂 `on hit / on timer / proximity / on break`，形成"命中后分裂""埋地延时""靠近引爆"的组合，这正好是我们魔法阵系统的自然升级。

三件都能接进现有架构，不需要重写；但**逐像素 2D 那种颗粒度不适合 3D 体素**，见"颗粒度决定成败"。

## 调研到的 Noita 底层事实

- 官方 GDC 演讲《Exploring the Tech and Design of Noita》（Petri Purho, Nolla Games）：Noita 用的是**很简单的 falling sand 算法**，液体和气体用类似方式实现；刚体用 marching squares；为了模拟大世界用**多线程**，世界切成 **64×64 的 chunk**，**每个 chunk 维护一个 dirty rectangle，只模拟需要模拟的格子**。 依据：https://www.gdcvault.com/play/1025695/Exploring-the-Tech-and-Design （笔记镜像 https://github.com/jethrokuan/braindump/blob/c5fe26faa736b6617a8f8164a7210064593aa0ae/org/gdc_vault_exploring_the_tech_and_design_of_noita.org ）
- 材质是一张属性表（可燃、导电、溶于水、致毒、密度、冻结/熔解、爆炸性等），交互靠属性驱动，不是每种组合写死代码。参考站：https://dood.gg/en/noita/materials/
- 法杖的数据结构本身就是牌堆：`deck_capacity`（杖内牌数）、`actions_per_round`（一次施放连发几个法术）、`reload_time`、`fire_rate_wait`（槽位间隔）、`spread_degrees`、`speed_multiplier`、`mana_charge_speed / mana_max`、`shuffle_deck_when_empty`，外加永久词条（如 `RECOIL_DAMPER`、`BLOODLUST`）。依据：https://github.com/DarrenRM/Noita-Context7-Docs/blob/master/entities/experimental_wand_4_configuration.md 与 https://raw.githubusercontent.com/DarrenRM/Noita-Context7-Docs/refs/heads/master/scripts/wand_generation_parameters.md
- 社区普遍把法杖读成"嵌套求值的表达式"（caster 包 spell，spell 上挂 trigger/timer），这就是组合深度的来源。参考：https://dontoisme.github.io/projects/spell-bracket-visualizer/2026-06-15/your-noita-wand-is-a-lisp-program.html
- Noita 的灵感直接来自 falling-sand 游戏谱系（同作者早期的《The Fall of Noit》等）。参考：https://www.rockpapershotgun.com/from-falling-sand-to-falling-everything-the-simulation-games-that-inspired-noita

## 与现有代码的接合点（不用重写的部分）

| 现有位置 | 现状 | Noita 化改造 |
|---|---|---|
| `js/world.js` DEFS / blocks(Uint8Array) | 15 种方块，属性只有 solid/opaque/hp/burn | 扩成**材质表**：density、flows、flammable、conducts、dissolves、toxic、explodes、freezes；同一种几何外观可以对应不同物质 |
| `js/world.js` dirty Set | 只用于"网格要不要重建" | 再加一套 **active chunk / active cells 脏集合**（学 dirty rectangle），模拟只遍历激活格 |
| `js/battle.js` `fluidStep()` | 只有沙子下落 + 岩浆扩散，0.42s 一次、每轮 ≤24 格 | 升级为通用物质 tick：按密度沉降、液体横向铺开、多层传染（火→可燃→灰）、导电与溶解 |
| `js/rules.js` effects | `setBlock / damage / status / spawn / sigil` 等指令 | 每条指令可挂 `trigger`：on_hit、on_timer、proximity、on_break、on_liquid_touch |
| `js/cards.js` CardDef | 一张卡=一组同时生效的 effects | 卡变成**杖**：`slots[]`（有序子法术）、`actions_per_round`、`cast_delay`、`spread`、`recharge`、`shuffle_on_empty` |
| `js/battle.js` sigils | 圆形范围周期结算 | 法阵=**触发器载体**：可埋（隐形）、可串联（A 炸开触发 B）、可绑物质（火阵遇到水阵互相湮灭） |

## 颗粒度决定成败（必须先定这一条）

Noita 是 2D 逐像素；我们是 3D 体素，若按"1 格=1 物质单元"，96×40×96=37 万格，最坏情况每 tick 遍历成本不可接受。三条路：

- **A. 一格一物质（粗粒）**：实现最省，沙子/水/火的手感像"放大版泰拉瑞亚"，不像 Noita 的细流。
- **B. 子格细分（推荐）**：外观仍是体素网格，但流体与火焰在**每格内部 4×4×4 子格**上模拟（只有激活格才分配子格数据）。视觉密度足够、内存可控（只为激活格分配），代价是要写"子格→顶点色/粒子"的可视化。
- **C. 局部 2D 切片**：只在竖直剖面做逐像素模拟，其他方向保持体素。实现快但视角是 3D 越肩，玩家会看出穿帮。

我的建议：**B**，并且给模拟加硬预算（每 tick ≤6000 个激活单元、单 chunk ≤300、超预算就排队到下 tick），配合已有的 `dirty` 网格与 F3 渲染缩放。

## 三阶段实施

### S1 物质层（最能改变观感，约 1 个实现批次）
- 材质表 + 属性驱动交互：沙塌方、水灭火并稀释岩浆、岩浆点燃可燃物并凝成黑曜石、酸溶墙与石、油铺面易燃、TNT 受火/受击引爆并连锁。
- 激活格集合 + 预算；火/液/沙全部走这条通道；燃烧与灰烬复用现有 burning meta。
- 可视化：激活液体用粒子 + 顶点色渐变（已有基础），火焰加闪烁与热浪扰动。
- 验收（可跑）：挖开水域一侧的堤坝 → 水按重力与连通铺开并熄灭火；岩浆接触水凝成黑曜石并停止流动；一条 TNT 链引爆 5+ 格；酸墙在 3 秒内被溶出通道；同种子重放结果逐格一致（模拟必须确定性）。

### S2 法杖化卡牌（最能改变玩法深度，约 1–2 个批次）
- `CardDef` 扩成杖：`slots[]`（每槽一个子法术）、`actions_per_round`（连发数）、`cast_delay`（槽间隔）、`spread`、`recharge`（杖冷却）、`mana_max/recharge rate`。
- 局外组杖界面：从已解锁的子法术里排序装配（Noita 的"拾取杖+编辑杖"快乐来源）；保留现有 56 张卡作为"杖的模板"，避免内容量崩塌。
- HUD：杖的槽位条 + 已用槽位高亮 + 装填进度（比现在的纯手牌更接近 Noita 观感）。
- 平衡锚点仍走已验证的基准（1 魔力=6 伤害=1 格地形），杖的总威力受槽位数与魔力上限双重约束，防止"一张卡打穿全场"。
- 验收：同一根杖改槽位顺序会明显改变手感；actions_per_round=1 的杖一次只发一个法术；杖空了按 `shuffle_on_empty` 重洗；组杖界面导出的 JSON 能被对手导入复现。

### S3 触发器与连锁（最有直播效果，约 1 个批次）
- 子法术可挂 trigger：`on_hit`（命中后分裂/点燃）、`on_timer`（延时二次伤害）、`proximity`（敌人靠近才激活，隐形地雷）、`on_break`（方块被破坏时触发，做陷阱房）、`on_liquid`（遇水膨胀/凝固）。
- 魔法阵改为承载 trigger 的实体：可被提前摧毁、可互相串联（阵 A 破 → 激活阵 B）。
- 验收：埋一个 proximity 阵 → 对手走过即触发；串三个阵，破第一个会连锁；触发链在同 seed 下可复现。

## 明确不做

- 不做真·逐像素 2D 世界与 Noita 式 roguelite 地牢流程（我们的目标是卡牌对战竞技场，不是地牢闯关）。
- 不搬 Noita 的神系/编辑杖全量数据（几千种物品），只做能撑起对战深度的子集。
- 不做全图实时全局光照与逐帧流体网格重建（帧率不允许；用粒子与顶点色近似）。

## 需要你拍板的两件事

1. **顺序**：先 S1（物质手感，画面立刻"活"）还是先 S2（法杖深度，玩法立刻变）？我的建议是先 S1，因为地形改造是这游戏的核心卖点，而物质模拟能直接把它做扎实；S2 在有了物质交互后收益更大。
2. **颗粒度**：走 B（子格 4×4×4）还是 A（一格一物质，实现快但粗）？
