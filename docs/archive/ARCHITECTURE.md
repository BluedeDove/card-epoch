# ARCHITECTURE · 卡牌纪元（重构后的唯一关系真源）

> 这一页回答三个问题：**谁可以依赖谁**、**一个类只干什么**、**加新代码该放哪**。
> 与 PLAN_REFACTOR.md 的分工：那里是施工计划与验收，这里是完成后的长期结构说明。
> 加载方式不变：普通 script 标签按层序加载（file:// 下 ES module 会被 CORS 挡），全部挂 window.GW。

## 分层与依赖方向（箭头 = 允许依赖，只许向下）

    L10 app        bootstrap（唯一跨层装配点） · session-runner · frame-loop · hotkeys · pointer-input · app-state
       ↓
    L9  audio · save          听见什么 / 存下什么
    L8  ui                   声明式 spec + bind，只读 viewmodel 与 cards 展示字段
    L7  render               状态→画面：chunk mesh、角色、抛射物、法阵、粒子、瞄准预览
    L6  input                键盘 / AI / 远端 → 同一种指令流（不写状态，只出意图）
    L5  camera               机位 = F(eyeBase, yaw, pitch, 三通道)；遮挡判定与瞄准射线
    L4  battle               权威 tick：MatchOps 是唯一对外接口
    L3  rules                校验 → 地形形态 → 效果派发 → 状态（无 THREE / 无 DOM）
    L2  cards                56 张卡、6 流派、法阵、牌库（纯数据，无逻辑）
    L1  world                体素存储、射线、相机净空、地形生成、暴露面烘焙
    L0  core                 Random(seed) · Noise(fBm) · V(向量) · namespace(GW + require 校验)

**禁止**：rules/battle 里出现 THREE 或 document；ui 改世界数据；下层 new 上层；类之间互相 document.getElementById；除 bootstrap 外的跨层 new。

## 每个类的唯一职责

| 层 | 类 | 只回答这一个问题 | 不许碰 |
|---|---|---|---|
| core | Random / Noise / V | 随机流、噪声、向量 | 任何游戏概念 |
| world | VoxelStore | 格值与 meta 的存取与脏标记 | 判定（固体/透明） |
| world | BlockInfo | 一个 id 是否固体/透明/液体、颜色、tile | 坐标 |
| world | Raycaster | DDA 射线命中哪一格 | 世界写 |
| world | CameraClearance | 相机这个体积能否待在这 | 世界写 |
| world | TerrainBuilder / PropPlanter / SpawnLocator | 造山 / 植树 / 找出生点 | 渲染 |
| world | ChunkMesher | 暴露面 → 顶点数组（含 AO） | THREE 对象 |
| world | **World** | 上面这些的门面（只委托，不加规则） | 战斗与画面 |
| cards | CardCatalog / SigilCatalog / DeckPresets | 有什么卡、什么法阵 | 结算 |
| rules | LegalityChecker | 能不能出（魔力/冷却/条件/上限） | 世界写 |
| rules | TerrainShapes / CellCollector | 这形态涉及哪些格；9 格上限与占位校验 | 战斗状态 |
| rules | StatusEffects / DamageResolver | 状态叠加与速率；护盾/易伤/致死 | 渲染与 DOM |
| rules | effects/* | 一个 op 一件事 | 别的 op |
| rules | **RulesEngine** | 编排：校验 → 扣资源 → 派发 → 记账 | Match 私有字段（只能经 MatchOps） |
| battle | Entity | 实体的字段形状 | 行为 |
| battle | MovementPhysics | AABB 逐轴推进、卡住顶出、坠落与边界 | 出牌 |
| battle | AimResolver | 准星选中谁/哪格、范围目标、可站点 | 相机公式 |
| battle | ProjectileSystem / SummonSystem / SigilSystem / FluidSystem | 四类活体各自的生命周期 | 彼此 |
| battle | Scoreboard | 击杀、复活、胜负 | 世界写 |
| battle | **Match** | 编排 + 权威 step（顺序固定保证确定性） | DOM/THREE |
| camera | FollowChannel / ServoBank | 一条 (x,v) 通道的二阶跟随 | cam.pos |
| camera | ArmPlanner | wantR 该是多少（扫掠+前瞻+换肩） | 通道写入（只出目标值） |
| camera | Clearance | 托举 λ 与两级让路 | 别的通道 |
| camera | PoseCross | 位姿纯函数出口 + 部件是否压准星 | 状态写入 |
| camera | **OTSCamera** | 门面，持有 §8 契约字段 | 具体解算细节 |
| input | KeyboardSource / AISource / RemoteSource | 这一帧想做什么（指令流） | 直接改状态 |
| render | ChunkView / AvatarView / SummonView / ProjectileView / SigilView / ParticleField / AimPreview | 把状态搬成画面与特效 | 游戏规则 |
| ui | ui-kit + 各 view | spec 与绑定表 | 查询规则、写世界 |
| app | bootstrap / session-runner / frame-loop / hotkeys | 装配与按帧驱动 | 业务细节 |

## 跨层接口：MatchOps（唯一被允许的 rules/input → battle 反向调用面）

出牌结算必须回写对局，这 15 个方法构成具名接口，声明在 src/battle/match-ops.js；RulesEngine 只依赖它，不碰 Match 私有字段：
all · defaultAim · drawCards · explode · findStanding · fireProjectile · fluidStep · sigilAt · sigilTick · spawnHail · spawnSummon · targetsInRadius · aimEntity · addSigil · kill
新增第 16 个方法 = 新增跨层依赖，需在 PR/评审里单独说明。

## 加一个东西该放哪（三问）

1. 它是**数据**吗 → src/cards/（卡、法阵、牌库）或 src/world/block-table.js（方块属性）。
2. 它改变**世界或对局状态**吗 → 只能经 RulesEngine 的效果派发或 Match 的 step 协作者；渲染层与 ui 一律不许写。
3. 它只是**看起来不同**了吗 → src/render/（3D）或 src/ui/（DOM 面板），两者都不产生新规则。

## 验证（不接受"文件已保存"）

    node tools/lint_lines.cjs src/            # 函数体 ≤3 行且顶层语句 ≤6，违规必须 0
    node tools/extract_dom.cjs index.html     # 声明式 ui-tree 与 index.html 结构一致（65 id / 25 class）
    node /tmp/gw_static.cjs "$PWD" 8943       # 禁缓存预览，端口自选（别抢别人的）
    # 页面内：__camAudit({seed:490706,deck:'starter',mode:'train'}) 与 .artifacts/baseline.json 逐项比数字
    # 逻辑可复现：同 seed 同输入的 600-tick 指纹必须等于 .artifacts/golden-logic-600ticks-seed490706.json
