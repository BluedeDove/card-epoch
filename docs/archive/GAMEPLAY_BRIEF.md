# 玩法现状简报（讨论底稿 · 事实页）

> 用途：本文件只记录**当前代码里真实存在的机制与参数**，以及**已经定性的临时脚手架**，不含设计主张。
> 玩法设计的主张与候选方案在 [GAMEPLAY_PROPOSAL.md](GAMEPLAY_PROPOSAL.md)。
> 更新：2026-10-17（由机制线会话整理，数字全部取自 js/ 当前工作区，不是文档抄录）。

## 0. 一句话现状

一张 96×40×96 的种子体素岛上，两个血条 100 的对手互相打到先拿 2 杀为止；移动用键盘，
其余一切（挖地、垒墙、放技能、布法阵、召唤、位移）都必须从手牌里打出来。

## 1. 权威参数（改任何一条都要回写这里）

| 项 | 真值 | 出处（js/ 下） |
|---|---|---|
| 世界尺寸 | 96 × 40 × 96（36.8 万格） | world.js World ctor 的 opts.size |
| 海平面 | sea = 12 | world.js |
| 地形生成 | fbm 噪声高度 + 温度/湿度两张 fbm 切群系 | world.js generate |
| 群系 | 3 个：翠绿林海 / 黄沙遗迹 / 霜噬雪原（冰、沙、雪表） | biomeNames / biomeCN |
| 出生点 | 两个对角（pad = 7 向内找平坦实心格，避开冰/水/岩浆/可燃） | World.prototype.spawnPoint |
| 玩家血量 | hp 100 / maxHp 100，护盾另计 | battle.js makePlayer |
| 胜负 | **先赢 2 杀**：lives = 2，lives<=0 直接 finish(1-side) | battle.js this.lives / finish |
| 复活 | 延迟 2.2s、无敌 2.5s、回满血、魔力重置到 4、回出生点 | respawnPlayer |
| 魔力 | 起始 3，上限 10，回复 1.0/秒；卡按 cost 扣 | makePlayer / step |
| 素材 mats | 起始 5。**A0-a 复核后的真相：旧代码从未真扣过素材**——全项目没有一处 p.mats -=，只有 p.mats < need 的"拒付门槛"（need 曾固定为 1，连 9 格的墙也只查 1）与挖除 give 的每格 +1 返还，所以素材只涨不跌、探针里 8 分钟涨到 79/84。我此前写"建造按卡扣 1 素材"是把"检查需求"误读成"扣费"，特此更正。
  A0-a 起：建造按格扣（need = CellCollector 数出的 cells.length，付得起才真扣），give 返还已删 | rules.js setBlock 分支、cards.js dig/dig3 |
| 坠落伤害 | **存在**：battle.js:170–173，fallDist > 3.4 起每格 5 伤、上限 30、**只对 player**（随从不吃） | collideAABB 落位分支 |
| 法阵 hp（死字段） | addSigil 写入 hp≈40，但**全项目没有任何伤害结算打到 sigil**（targetsInRadius 只收 player/summon，抛射物不撞法阵）；唯一拆法是 1 费 nullify → rules.js:268 destroySigil | rules.js:266–268 |
| requires.night（死字段） | schema 里有，56 张卡**零使用**；night 判定每 tick 白跑 | cards.js / battle.js step |
| 出生点直线距 | 96 图对角 pad=7 ⇒ ≈115 格；移速 5.6、卡射程 26–34 ⇒ 开局约 20 秒双方物理上无法交互 | world.js spawnPoint / cards.js |
| 复活补魔 | respawnPlayer 直接 p.mana = min(cap, 4) ⇒ 死亡等于补魔；cooldowns 复活时不清零 | battle.js respawnPlayer |
| 手牌 | 上限 5，开局抽 5，出牌后自动补 1；牌库空了把弃牌堆重洗 | drawCards / playCard |
| 初始牌库 | 12 张：打击×2、护身、采掘、置方、掘进、垒墙、沉思、焰矢、升岩、霜片、萌发 | cards.js G.STARTER_DECK |
| 卡池 | 73 张（2026-10-17 卡牌线重设计后；我这边旧数字未同步，核对时间 14:1x），6 元素（rock/fire/ice/nature/void + 通用）× 5 类型（terrain/spell/sigil/summon/utility） | cards.js |
| 数值基准 | 1 魔力 ≈ 6 伤害 ≈ 1 格地形改造；协同不越过 1.8× | 立项目的（docs/PLAN.md §1） |
| 弹道命中 | **扫掠线段 + 元素近失圈**（`hitTestSegment`，半径 = `pr.fuse`）：焰矢 1.8 / 霜片 1.6 / 虚 Lance 1.5 / 打击 1.35…；旧的"球心 0.8 格碰到才算"已废 | battle.js `ELEMENT_FUSE` + `fireProjectile`；cards.js 的 `dmg(a, r, k, fuse)` 第四参数 |
| 直伤卡数值（本轮抬过） | 打击 7 / 焰矢 14 / 霜片 8 / 虚空枪 21 / 汲取 10 / 缠绕 4 / 焰冲 9；**范围卡（花葬·冰瀑·地刺·落岩）仍满伤，只有抛射物引爆按距离衰减到 ≥45%** | cards.js（2026-10-16 用户报"小球砸不到、扣得又少"）；衰减条件见 battle.js `explode` 的 `opts.falloff` |
| 打击卡冷却 | `strike` 加了 cooldown 0.5s（原来连点无冷却，抬伤害后必须封住） | cards.js strike |
| 地形改造上限 | 单卡 ≤ 9 格（MAX_TERRAIN_CELLS） | rules.js |
| 方块物质交互 | 属性驱动反应表：燃 / 熔 / 冻 / 凝 / 灭；激活格队列 + 定时轮，每 tick 看 56 格改 8 格，同时燃烧封顶 420 格 | js/chem.js（`GW.CHEM`），验收 `tools/chem_check.cjs` |
| 音效词汇 | 30 条（原 25 + 物质反应 5：ignite / steam / ash / obsidian / melt） | js/sfx-table.js；反查 `tools/audio_check.cjs` |
| 法阵 | 有 delay（延时触发）、ttl、tickEvery 周期结算；**hp≈40 是死字段**（见下一行）——"法阵可被提前打断"目前只由 delay 窗口与 nullify 一张卡实现 | addSigil / sigilTick |
| 召唤物 | 有 ttl、dmg、atkCd，AI 状态机 melee/ranged/healer/flee，可被击杀 | spawnSummon / stepSummons |
| 逻辑 tick | 20Hz 权威 Match.step()，渲染按 acc/STEP 插值（ppos→pos） | battle.js 文件尾、AGENTS「视角不变量」 |
| 昼夜 | dayLen = 120s，周期后 40% 记为夜 | step 的 dayT / night |
| 确定性 | 单一 mulberry32 seed 驱动地形、洗牌、掉落；同 seed 可复现 | G.mulberry32 |

## 2. 已定性为**临时脚手架**的东西（用户 2026-10-17 明确）

下面这些**不是最终玩法**，只是为了方便测试才存在。任何文档若把它们写成产品的正式特性，都算写错，应改成本节口径：

1. **单人训练（AI 对手）**：net.js 的 AISource 只产出指令流，用来在没有真人对手时把整条链路跑通。它是测试工具，不是承诺的游戏模式。
2. **同屏分屏双人 PVP**（按 T 切换、左右两路相机、P2 用方向键 + N M , . /）：一人一键盘区的临时同机对战，为验证"两端状态一致"而存在。
3. **联网 PVP**：只有 RemoteSource 输入抽象与协议注释，没有权威端 server.js；菜单点了提示未启用。
4. **创造调试模式**（G / I / X）：给卡牌与特效调试用的能力层，按项目约定"不是游戏内容"。
5. **当前的 12 张初始牌库与 56 张卡池**：为铺满测试矩阵（每种目标形状、每类结算分支都要有卡能打到）而堆的量，不代表最终内容规划。

仍然**不变**的产品内核（用户从第一天锁定、玩法设计必须围绕它）：

- 3D 越肩视角（C 循环三档），移动不耗卡，**除移动外一切操作必须出牌**；
- 地形**真改格子**，改动留在本局世界里；
- 法阵有延时窗口、可被提前打断；
- 单文件 file:// 双击可玩、无外部依赖、无构建。

## 3. 尚未定案的问题（**已于 2026-10-17 由 [GAMEPLAY.md](GAMEPLAY.md) 定案**，本节留作问题清单核对用）

1. 一局的**胜负目标**是什么？现在"先 2 杀"是早期为跑通流程随手定的，不是设计结论。
2. **地图怎么生成**才好玩？现在是单张噪声岛 + 对角出生，缺少"目标物 / 资源分布 / 路线取舍"这些能被玩法利用的结构。
3. 局内**成长**：卡从哪来、能不能中途换卡、构筑发生在局内还是局外？
4. **玩家规模**：1v1 起步还是支持多人？多人时哪部分是临时、哪部分是承诺？
5. **单局时长**与节奏曲线（前期该有什么、后期该有什么）。
6. 三种资源（HP / 魔力 / 素材）是否都必要，素材目前存在感很低。
7. 昼夜、物质化学层（js/chem.js，另一会话在做）对胜负应有实际影响，还是纯表现。

## 6. 生成期事实（A1-a 复核补记，2026-10-17）

- **平台认证只排水/冰/岩浆**：这是 §2.4.2 的原文口径。别把 burn='leaf' 之类"火蔓延属性"当成立足性否决——
  子代理一度自加叶子否决，结果 3/12 seed 的翼矿方向整片密林找不到平台。树冠该由**放置方自己清成林中空地**，不是否决整块地。
- **高度尺一律用 camGroundY，不用 surfaceY**：surfaceY 把树叶算成固体（本文件表格第一行早就写着这条），
  生成期用它量地面会在树冠高度上钳台阶——88092 实测真地面 14、树冠 19–34，走廊被钳成悬空阶梯，BFS 只摸到 5/4096 根柱。
- **世界尺寸真源在 js/main.js 的 new G.World({size:[...]})**（不是 world.js 的默认值）；要改场地大小只有这一处。
- **同 seed 在 node 与浏览器可能不是同一张图**：js/lode-planter.js 与 js/reachability-gate.js 尚未挂进 index.html 的 script 序列，
  node 侧（play_probe）由 world.js 条件 require 能看到矿脉，浏览器看不到。跨环境比校验和之前先看这条（欠账见 §7.5）。

## 4. 设计必须尊重的硬约束

- **性能**：36.8 万格体素，逐 tick 全图扫描直接排除；物质模拟走"激活格 + 每 tick 硬预算"（js/chem.js 文件头：每 tick 看 56 格 / 改 8 格）。玩法不要引入"全场每格都要算"的需求。
- **确定性**：同 seed 必须逐格、逐 tick 可复现，否则回放与联机都失效。玩法新增的任何随机（掉落、地图要素、AI 决策）都必须吃同一个 rng。
- **输入通道**：AI 与真人走同一条指令流，不给 AI 开后门。
- **分层责任制**：玩法数值只能落在 rules.js / battle.js / cards.js 的数据与结算里；玩家可见文案只能在 hud.js 的 H.TEXT。机检 tools/layer_check.cjs 会拦。
- **验证口径**：机制改动必须过 node tools/audit.cjs（三种子 × 15 项）+ layer_check + creative_check；碰手感再加 feel_probe，碰跳跃/移动再加 jump_window。
