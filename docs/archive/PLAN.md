# 执行计划核对 —— 像素风 3D 卡牌对战（早期 baseline 镜像（已废弃） baseline）

状态：**部分作废（2026-10-17）**。本文是项目最初的执行计划，其中"对战形态"一节已被用户判定为临时脚手架，
不再是待决项；玩法与地图生成的现行讨论见 [GAMEPLAY_BRIEF.md](GAMEPLAY_BRIEF.md) / [GAMEPLAY_PROPOSAL.md](GAMEPLAY_PROPOSAL.md)。
更新时间：2026-10-16（会话内第一版计划）

## 0. 已锁定的需求（用户明确要求）

| 项目 | 决定 |
|---|---|
| 视角 | **3D 越肩视角**（角色右肩后方的跟随相机） |
| 对战 | ~~**PVP**（具体形态见 §5，唯一待决项）~~ 作废：§5 的 A/B/C 三种形态都只是测试手段，最终对战形态未定案 |
| 移动 | **不用卡牌**，方向键/鼠标自由移动 |
| 其余一切操作 | **全部通过卡牌**：地形改造、技能、魔法阵、召唤、采集、攻击 |
| 地形 | **真改格子**（挖空、填平、换材质，永久留在本局世界） |
| 魔法阵 | 选卡后地面浮出法阵与范围预览，确认后延时生效 |
| 规模 | 完整版取向：50+ 张卡、多生物群系、音效、存档导入导出 |
| 美术 | 像素风（16px 纹理，NearestFilter 保持硬边） |

## 1. 调研结论摘要（依据见文末链接）

1. Minecraft 的世界是**数据**：体素数组 + 区块分块加载 + 种子现算远处；变化靠 **tick 驱动的状态机 + 邻居传播**；渲染只烘焙**暴露面**。→ 我们的世界只需一个 `Uint8Array` 加每格状态表，不需要每格一个对象。
2. 杀戮尖塔的深度**不在引擎**：战斗是极小的确定性系统（抽5、3能量、回合末弃牌、敌方意图公开），深度全在构筑端。→ 结算器保持极小，规则数据全放进卡牌表。
3. 尖塔的数值有明确**代价-效果基准**（1费≈6伤害／5格挡／≈2抽牌）与三档强度线（初始→期望→协同）。→ 我们按「1 魔力 = 6 伤害 / 5 格挡 / 1 格地形改造」定基准，协同不越过 1.8× 上限，防无限连。
4. 尖塔 12 个 RNG 共用一个 64 位 seed，事件彼此相关、同 seed 可复现。→ 我们只用**一个**显式 PRNG（mulberry32）驱动地形、掉落、洗牌，seed 显示在 HUD、可分享、可重放。
5. 实时 PVP 需要的是皇室战争式经济（按秒回复的公共资源 + 循环牌库 + 下一张可见），不是尖塔的回合制。→ 尖塔给"构筑与数值骨架"，皇室战争给"实时节奏"。
6. 网络同步两条路线的实测差异：帧同步省带宽、好回放、怕外挂与浮点不确定性；状态同步安全、带宽大、逻辑集中在权威端。→ 单文件 HTML 场景选**服务端权威的定 tick 快照流**（15–20Hz 逻辑 tick，客户端插值），避免浮点漂移用整数坐标。
7. 越肩相机的两个官方陷阱：发射原点与相机不重合会**恒定偏离**准星；相机能看见不等于玩家能打到。→ 目标选取用相机射线，落点合法性用玩家射线校验，被遮挡时按规则重定向或提示。

## 2. 交付形态与文件结构

```
早期 baseline 镜像（已废弃）/
  index.html        入口，HUD 骨架、开始/暂停/胜负界面
  vendor/three.min.js  本地化的 WebGL 库（离线双击即玩，不依赖 CDN）
  js/
    world.js        体素存储、种子生成、暴露面烘焙、脏块重烘焙
    cards.js        纯数据：50+ 张卡的 schema 与取值
    rules.js        结算器：效果指令、条件、tags、状态与冷却
    battle.js       实体、生命/魔力/护甲、伤害管线、随从 AI 状态机
    net.js          PVP：loopback/服务端权威 tick、插值、重连
    camera.js       越肩相机、准星射线、视锥剔除
    hud.js          手牌、牌库、资源条、伤害飘字、日志
    audio.js        WebAudio 程序化音效（无音频文件）
    main.js         主循环、输入映射、状态机
```

约定：数据与逻辑分离（cards.js 只有数据），便于以后只加卡不加代码；纹理用 canvas 程序化生成，不引入外部图片。

## 3. 核心数据结构（写代码前定稿）

```js
World: { size:[96,40,96], seed, blocks:Uint8Array, meta:Map<idx,BlockState>,
         biomes:Uint8Array, lights:Uint8Array }
BlockDef: { id, name, hp, solid, transparent, burnable, floodable, tags[] }
CardDef: { id, name, cost, rarity, type: terrain|spell|sigil|summon|utility,
           targeting:{shape:ray|circle|rect|self|global, radius, height},
           requires:[cond], effects:[Effect], cooldown, tags[] }
Effect:  { op: setBlock|placeSigil|damage|heal|shield|spawn|push|ignite|flood|freeze|grow,
           target, amount, duration, delay }
Entity:  { kind, hp, maxHp, shield, pos, vel, team, cards?, ai?, sigils[], statuses[] }
Sigil:   { cardId, center, shape, radius, owner, born, activeAt, ttl, state }
MatchState: { tick, seed, players:[PState,PState], sigils[], entities[], eventLog[] }
```

**卡牌=指令序列**：出牌 = 校验条件 → 扣魔力 → 生成一条 `setBlock` 之类指令 → 世界执行 + 标脏区块 → 记入 eventLog。地形改造因此与放技能、召唤共用一条通道，不需要单独机制。

## 4. 主循环与回合

1. 逻辑 tick 固定 20Hz（渲染用 rAF 与逻辑分离，逻辑帧率可配）。
2. 每 tick 顺序：输入 → 移动与 AABB 碰撞 → 魔力回复 → 法阵计时（延时触发/每 tick 结算） → 随从 AI → 伤害管线 → 死亡与胜负 → 脏区块重烘焙 → 渲染 + 粒子。
3. 手牌：牌库循环（尖塔式洗切）、手牌上限 5、抽牌时机=进战斗与击杀、法力上限随阶段 1→10（炉石式），保证前期不做后期操作。

## 5. （已作废）唯一待决：PVP 的形态

> 2026-10-17 用户定性：下面 A/B/C 三种形态都**不是产品目标**。A（同屏分屏双人）与训练 AI 只是把引擎与结算跑通的临时脚手架，
> B（联网）只是接口预留；这款游戏最终"几个人、怎么算赢"尚未定案，见 `docs/GAMEPLAY_*.md`。本节保留只为查历史依据。

- **A 同屏双人实时**（一台机器，键盘+鼠标分区，服务端权威 tick 在本地）：零部署、当场可玩，最省时间。
- **B 真联网实时**（另加一个 `server.js` WebSocket 权威端，两人不同设备；含掉线重连与快照恢复）：最接近"PVP"，但交付物不再是纯单文件。
- **C 热座回合制**（轮流出手，尖塔式无实时压力）：实现最稳，但"越肩视角实时移动"的价值被削弱。

默认推荐：**A 起步，接口按 B 预留**（输入=指令流，状态权威端可换），若你要跨设备我再补 `server.js`。

## 6. 里程碑

- **M0** 越肩相机 + 体素地形 + 像素纹理 + 自由移动 + 准星高亮方块
- **M1** 卡牌框架：5 张卡（挖地/填地/火球/冰墙/石肤）+ 魔力与手牌 + HUD
- **M2** 地形改造深度 + 魔法阵（延时与范围结算）+ 粒子与音效
- **M3** PVP（形态见 §5）+ 胜负与开局/重开 + 种子分享
- **M4** 内容量：50+ 张卡、3 个生物群系、随从 AI、存档导入导出
- **M5** 性能与自查（≥50fps、控制台零报错）+ 交付说明

每完成一个里程碑就在浏览器实测一次（截图核对画面与手感），不做"能生成就算完成"。

## 7. 验收标准（可核对）

1. 双击 `index.html` 即可玩，断网也能跑（three.js 已本地化）。
2. 同一 seed 两次开局，地形逐格一致。
3. 地形卡能真挖出坑、真填成平台；改动在下一次加载仍在。
4. 魔法阵先出范围预览、延时后生效，可被提前破坏打断。
5. 移动不消耗任何卡牌；除移动外无一项操作能绕过卡牌完成（含普攻也占手牌或走"基础牌"体系）。
6. PVP 两端状态一致，掉线可恢复或明确判负。
7. 稳定 50fps 以上、控制台无报错。
8. 手牌/牌库/魔力/血量/HUD 与日志可读。

## 8. 风险与对策

- **越肩相机遮挡**：靠墙时相机穿进方块 → 平滑拉近（Bedrock follow_orbit 的 radius 收缩）+ 忽略墙体图层。
- **准星视差**：近战/技能落点与准星不符 → 相机射线定目标，玩家射线验合法性（官方做法）。
- **性能**：全网格 96×40×96 ≈ 37 万格，逐格重建会卡 → 只烘焙暴露面 + 增量脏块。
- **实时平衡**：地形卡是最强干扰 → 用地形专属资源 + 冷却 + 单卡改格数上限（≤9 格）三重约束。
- **魔法阵无深度**：必须能被提前摧毁、能打断、能被位移重置。
- **PVP 浮点漂移**：用整数坐标 + 权威端定 tick 快照，客户端只插值。
- **范围过大失控**：M0–M3 先跑通闭环，M4 只往表里加卡。

## 调研来源

- three.js 官方体素几何教程（Uint8Array、暴露面、纹理图集、NearestFilter）https://threejs.org/manual/pages/voxel-geometry.html
- Minecraft 区块格式资料页 https://fileformats.archiveteam.org/index.php?title=Minecraft_chunk_format
- 杀戮尖塔局内构筑拆解（四端、数值基准、体系与意图机制）https://www.gcores.com/articles/212986
- 杀戮尖塔关联随机数与 seed 实现 https://forgottenarbiter.github.io/Correlated-Randomness/
- 尖塔意图公开的设计价值 https://www.rockpapershotgun.com/why-revealing-all-is-the-secret-of-slay-the-spires-success
- 帧同步与状态同步的取舍（乐观帧锁定、权威端、插值预测、TCP/UDP 选择）https://www.eet-china.com/mp/a502569.html
- Unity Cinemachine 越肩瞄准相机与视差/遮挡处理 https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineThirdPersonAim.html
- Minecraft Bedrock 官方越肩相机参数（follow_orbit / fixed_boom、radius/pitch/yaw/offset）https://raw.githubusercontent.com/MicrosoftDocs/minecraft-creator/refs/heads/main/creator/Documents/CameraSystem/CameraPresetThirdPerson.md
- 卡牌即世界实体的先例（Stacklands）https://www.rockpapershotgun.com/stacklands-is-a-gentle-village-building-game-played-with-cards
