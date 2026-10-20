# PLAN_SYSTEMS · 系统化拆分计划（v1.4 · 评审稿）

> 状态：**实施中**（分支 refactor/systems）。S0 量具、S1 状态契约、S2 系统抽取（11 个）、S3 效果 spec、S3.5 背包分版、S4 场景/AppState、S5 战绩已落地；剩余 SessionRunner 收口与 S6 清理/搬 src。施工记录见 §19。
> 目标读者：实现者、评审（Kimi）、下一个接手会话。
> 与 [PLAN_REFACTOR.md](PLAN_REFACTOR.md) 的分工：那份是"11 层 / 104 文件"的**目录级**目标；本计划是"状态所有权 + 系统 + 效果原子 + 场景/会话 + 统计"的**行为级**拆分，能在 js/ 单轨内逐阶段落地，不依赖那份计划先完成。
> 一句话：不追求文件多，追求三个可机检的性质——**每个状态只有一个写入者；新能力 = 数据的组合，不是新分支；场景/会话是一等概念**。
>
> **v1.1（2026-10-17）**：按一轮代审意见修订——新增 GameMode 插件钩子（§7.2/§16）、S2 退出标准与 ≤15 门槛解耦（§14）、实体别名改可写访问器（§5.3）、形状/展开的确定性顺序（§9.2/§9.4）、E1 材料语义与 E4 文件数（§16）。评审记录见 §19。
>
> **v1.4（2026-10-17）**：用户提出更上层的原则——类/函数尽量无状态、状态集中维护、一次状态变更下游全部跟着变。新增 §21（AppState 三根 + 无状态系统 + selector 派生 + rev 传播），并把 §7.3 / §8.1 改成无状态契约。
>
> **v1.3（2026-10-17）**：Kimi 评审 §20 后修订——S3.5 的改动范围（HUD/ui_check 同步点）、旧意图映射表、A9 六域 + RenderState 字段清单、牌库顶 3 张、snapshot v 校验。
>
> **v1.2（2026-10-17）**：用户点名游戏逻辑的两个缺口——**背包没有按模式分版**（生存/创造混在一个面板里，牌库与背包不联动）、**状态域没有按玩家/场景/模式分开且不可读**。新增 §20：CardSource / BagProfile / BagPanel 三层、七域状态表与 snapshot 契约、A8/A9 与 E8/E9。

---

## 0. 评审怎么读

1. 先看 §1 的验收标准（用户给的合格线），再看 §16 的六个扩展用例——**这两节是判据，不是愿景**。
2. §5/§7 是状态与系统的所有权表：请重点找"同一个字段两个写者"的反例。
3. §9 是组合能力的核心：请用 73 张卡里最怪的几张（终末 / 灭世天陨 / 飞桥 / 超阶仪式 / 奇点 / 图腾）检验 DSL 表达力，而不是只看示例。
4. §14 是迁移顺序：请判断每一步是否**独立可回滚**、门禁是否真的能拦住回归。
5. §18 是逐条打勾的清单。

---

## 1. 目标与验收标准

### 1.1 目标

| # | 目标 | 现状 |
|---|---|---|
| G1 | Match 从"上帝对象"降为门面：自有方法 ≤15，其余 69 个方法按系统归位 | 1392 行 / 69 个原型方法（2026-10-17 实测，还在长） |
| G2 | 新卡/新法阵/新召唤默认只改数据文件；不得为单张卡新增 Match 方法 | spawnHail / spawnBridgeQuill / stepQuill / paintBridge / digCrater / detonateNuke / spawnMeteor 7 个按卡方法 |
| G3 | 每个状态字段只有一个 owner；跨系统只走命令/事件 | 10 组字段多处写（§5） |
| G4 | UI 有场景层：Boot → Menu → Lobby → Loading → Match → Result；可选模式/地图/规则 | 菜单是 Panel，start() 同步做 8 件事，地图尺寸写死 96×40×96 |
| G5 | 指标独立：MatchStats / RoundRecord 可单独读取、按局汇总 | 分数在 Match，kills/lives 在实体，占矿在 LodeSystem，伤害/出牌无记录 |
| G6 | 兼容：老卡数据、老 API、存档、探针入口在迁移期全部可用 | — |

### 1.2 合格线（可测，评审按这张表判）

- **A1 组合扩展**：§16 的 6 个用例，实际文件改动数 ≤ 表中声明值；其中"新卡（组合已有原子）"必须 **1 个数据文件、0 个引擎文件**。
- **A2 确定性不回退**：node tools/determinism.cjs --seeds 490706,88092,31337 --ticks 600 在 S1/S2 前后**哈希逐字节一致**；S3 起允许按批次重新基线，但每批必须给出"预期变化清单"。
- **A3 门禁全绿**：audit（三种子 + --file）、layer_check、creative_check、ui_check、cards_probe、hit_check、hand_check、chem_check、vfx_check、audio_check、hero_check、post_check、ice_probe、light_probe、jump_window、feel_probe。
- **A4 体积**：Match 自有逻辑方法 ≤15、文件 ≤300 行（迁移期为外部调用保留的**一行转发壳**不计入；**该门槛在 S3 效果原子迁完后验收**，S2 只要求系统就位）；任一系统文件 ≤350 行、公开 API ≤15 个。
- **A5 双写**：node tools/owner_check.cjs 零违规（owner 白名单见 §5）。
- **A6 场景往返**：菜单→大厅（改地图/种子/规则）→加载→对局→结算→菜单，可往返 3 次；MatchConfig 可 JSON 往返后复现同一局；无重复定时器、无指针锁残留。
- **A7 兼容**：老 cards.js（旧 op / sb 模式）在 S3 结束前仍能打出同样结果；GW.Match 的 69 个方法名在 S6 前全部可调用；存档 v1 可读。

> 评审结论只需要回答：**按 §14 做完，A1–A7 能不能成立？** 不能，就指出哪一条会先破。

---

## 2. 非目标与硬约束

**非目标**（明确不做，避免评审把范围拉大）：

- 不做全量 ECS / 组件框架：实体只有 player / summon / projectile / sigil 四种，单局 <200 个；全量组件化会把 e.pos 这种热路径变成 getter，收益不抵风险。
- 不引入构建、ES module、框架、TypeScript：file:// 双击 + 普通 script 顺序加载是产品约束。
- 不改玩法数值、不改相机公式、不改 UI 视觉；拆分只搬行为，不顺手调平衡。
- 不做联网同步；MatchConfig 为将来留字段，但本期不实现。
- 不在本计划里搬 src/：S6 只做机械搬移，src/ 的 11 层目录与 MANIFEST 由那一侧维护。

**硬约束**：

1. 20Hz 权威 tick 的阶段顺序是确定性的一部分（§7.2），拆分不得改变顺序。
2. match.rng 的调用序列是现有种子/探针基线的一部分（§5 R1），S1/S2 必须逐字节保持。
3. 逻辑层零 DOM、零玩家可见文案；layer_check 是硬门禁。
4. 共享文件（battle / rules / main / cards / ui）只留验收通过的最终态（AGENTS 协作习惯）。
5. 无构建 ⇒ 新文件必须进 index.html 的 script 序列，且顺序 = 依赖顺序。

---

## 3. 现状证据（为什么必须拆）

- Match：1392 行；69 个原型方法；持有 world / players / summons / projectiles / sigils / rng / ctx / scoreWin / timeCap / overtime / lodeSys / night / dayT / fluidQueue。改一处伤害要读 3 个文件。
- 按卡专用方法 7 个（见 G2）；rules.applyEffect 25 个 op + setBlock 13 种形状模式；新增一种墙要同时改 rules 的 case、battle 的方法、VFX 配方、探针断言。
- 共享 RNG：洗牌、召唤落点、陨星散布、AI 决策、环境粒子都吃同一条 match.rng()。**改视觉粒子会改变 AI 走位**——这不是理论，step() 末尾 fx.ambient(..., this.rng) 就把权威随机流交给了视图回调。
- UI：start() 同步完成 建世界→存档→网格→牌组→Match→相机→输入源→HUD/VFXR/Weather/Atmos/Shader attach→主循环；菜单是 Panel；Result 是 Panel；没有"选图/选规则/加载"的位置。
- 指标：scoreWin/timeCap/overtime 在 Match，score/kills/lives 在 player，占矿时长在 LodeSystem，伤害/出牌/命中没有事件表；按局统计无法做。

---

## 4. 目标架构总览

~~~
L10 app      session-runner · scene-stack · hotkeys · bootstrap(main)
L9  audio/save
L8  ui       scenes/* · panels/* · hud(文案) · channel
L7  render   chunk-view · entity-view · vfx* · hero* · atmos* · shader
L6  input    keyboard-source · ai-source · remote-source
L5  camera   ots-camera · servo · orbit
L4  battle   match(facade) · match-state · systems/*
L3  rules    rules-engine · legality · pricing · shapes · targeting · effects/*
L2  cards    card-catalog · sigil-catalog · effect-grammar · legacy-adapter
L1  world    world · voxel-store · block-info · terrain · ground-probe · lode-*
L0  core     clock · rng · bus · vec
~~~

依赖只允许向下；**systems 之间不互相 import**，只通过 MatchOps（命令）与 MatchEvents（事实）说话。app 是唯一跨层装配点。

与现状的映射：js/*.js 逐步长成上表；battle.js 最终只剩 Match 门面 + 系统装配；src/ 在 S6 接收机械搬移。

---

## 5. 状态所有权（本计划的地基）

> 状态的**域级分类**（世界 / 玩家 / 对局 / 会话 / 场景 / UI / 渲染）与可读快照契约见 **§20.8**；本节是字段级 owner，§20.8 是域级 owner，两边必须对得上。

### 5.1 所有权表

| 字段 | 现在谁写 | 拆分后 owner | 写入 API | 主要读者 |
|---|---|---|---|---|
| world.blocks | rules / battle / chem / fluid | VoxelStore | set / setCells / setMeta（唯一入口，带 by） | 所有人只读 |
| world.meta | rules(built) / chem(burning) / battle(built) | VoxelStore | setMeta(x,y,z,{by,kind,born,dur})，分槽不覆盖 | chem / 光照 / 存档 |
| e.pos / e.vel | movement / summon AI / projectile / respawn | MovementSystem | Body.move(e,dt) / Body.teleport(e,x,y,z) | 判定、相机、渲染 |
| e.hp / shield / st / invuln | rules.damage / battle.kill / creative | DamageSystem（Vitals） | damage(e,amt,kind,src) / heal / addStatus | HUD、AI、scoreboard |
| p.hand/deck/discard/mana/cd | battle 11 个方法 / creative | DeckSystem | draw / play / discard / equipClass / refill | HUD、AI |
| e.target/aim | aim / AI | AimSystem | updateAim(p)（只写 p.aim） | rules、projectile |
| projectiles[] | Match | ProjectileSystem | fire / step / remove | 渲染、命中 |
| summons[] | Match | SummonSystem | spawn / step / remove | 渲染、AI |
| sigils[] | Match | SigilSystem | add / tick / destroy | 渲染、rules |
| fluidQueue | Match | FluidSystem | queue / step | — |
| e.orbSpec/orbs/orbTtl | Match | OrbSystem | grant / step / block | 命中 |
| time / tick / dayT / night | Match / creative / main | Clock | step(dt) / setPhase() | 全体只读 |
| rng 流 | Match 一条 | RngStreams | get('deck' / 'ai' / 'combat' / 'summon' / 'vfx' / 'legacy') | 各系统 |
| score / overtime / over | Match + player | Scoreboard | addScore(side,n,reason) / finish() | HUD、stats |
| kills / lives | player 字段 | Scoreboard（stats 镜像） | 同上 | HUD、stats |
| p.creative | Creative.attach | MatchConfig.flags（每 tick 只读快照） | DebugSystem | rules、damage |
| HUD.sel / vm.state | main / hud | UIState | select(side,i) 就地写 | panels |
| S.match / S.world | start() 重赋值 | Session | session:changed 广播 | hud/vfx/atmos/cam |

### 5.2 三条硬规则

1. **一个字段一个写者**。读随便，写只能经 owner 的 API；owner_check 按"文件 → 允许写的字段前缀"白名单机检。
2. **跨系统只发命令/事件**：ops.fireProjectile(...)（命令，有返回值）与 bus.emit('damage', ...)（事实，无返回值）。禁止 systems.deck.hand.push(...)。
3. **不共享可变数组**：系统对外给 snapshot()（只读副本或冻结视图），内部数组不裸奔。渲染与探针读 snapshot。

### 5.3 兼容性说明（重要）

- 实体在 S1–S5 **保持扁平记录**（e.pos 不动），只在 vitals / deck / ai 三个真正冲突的地方引入子对象，并用 Object.defineProperty 做一期**可写访问器**：get 读 vitals.hp，set 转发到 DamageSystem.applyHp（不是只读别名）。
  理由：rules.js 现在直接写 e.hp（R.tick 的 regen、R.damage、heal），只读别名会让它在 strict mode 抛错或静默失效。S1 的迁移清单必须列出 rules.js 全部 hp 写入点，S1 退出用 --trace 覆盖 damage / regen / heal 事件。S6 删别名。
- p.score / p.kills / p.lives 在 S1 起变成 Scoreboard 的**只读镜像**（每 tick 同步一次），HUD/探针不改也能跑；S5 改成读 stats.snapshot()。

---

## 6. 核心数据结构

### 6.1 MatchConfig（可序列化，进菜单/存档/战绩）

~~~js
MatchConfig = {
  v: 1,
  mode: 'train' | 'split' | 'net',
  map:  { preset: 'island-96', seed: 490706, size: [96,40,96], sea: 12, lodes: 3 },
  decks: ['starter', 'random'],
  rules: { winScore: 75, timeCap: 480, overtimeCap: 45, lives: 2, dayLen: 120 },
  players: [{ name:'P1', side:0 }, { name:'P2', side:1 }],
  debug: { creative:false, leadEnabled:true, unlimitedCells:false }
}
~~~
默认值必须逐项复现今天的行为（75/480/45/2/120、96×40×96、leadEnabled true）。

### 6.2 MatchState（纯容器，无方法）

~~~js
MatchState = {
  cfg, clock, rng, world,
  entities: { players:[], summons:[], projectiles:[], sigils:[] },
  flags: { over:false, winner:null, reason:null },
  fx, ctx
}
~~~

### 6.3 Clock

~~~js
class Clock {
  constructor(cfg) { this.tick=0; this.time=0; this.dayT=0; this.dayLen=cfg.dayLen; this.locked=null; }
  step(dt) { this.time+=dt; this.tick++; if (this.locked) this.dayT = this.locked==='night'?0.7*this.dayLen:0.15*this.dayLen; this.dayT+=dt; }
  get night() { return (this.dayT % this.dayLen) > this.dayLen*0.6; }
  setPhase(mode) { this.locked = mode; }   // 只给 DebugSystem 调
}
~~~

### 6.4 RngStreams（确定性关键）

~~~js
class RngStreams {
  constructor(seed) { this.seed = seed>>>0; this.map = new Map(); }
  get(name) {
    if (!this.map.has(name)) this.map.set(name, G.mulberry32(this.seed ^ HASH[name]));
    return this.map.get(name);
  }
}
~~~
HASH.legacy = 0x9e3779b9（与今天 seed ^ 0x9e3779b9 完全一致）。
**S1/S2 所有现有调用点都取 get('legacy')**，序列不变；S3 起按系统逐个切到新流，每切一个都要在 determinism 的"预期变化清单"里写明影响。

### 6.5 EffectSpec / AtomicOp（§9 详述）

### 6.6 BlockMeta（分槽，解决互相覆盖）

~~~js
{ by:'rules'|'chem'|'fluid', kind:'built'|'burning'|'frozen'|'mine',
  owner: 0|1|-1, born: 12.3, dur: 4.6, light: 0 }
~~~
setMeta 只合并**自己槽位**的字段：chem 只写 burning/born/dur，rules 只写 built/owner/born；kind 是互斥枚举，换 kind 必须显式 replaceMeta，owner_check 拦直接写。

---

## 7. 系统清单

### 7.1 总表

| 系统 | 自有状态 | 公开 API（≤15） | 依赖 | 文件（目标） | 估算 |
|---|---|---|---|---|---|
| Clock | tick/time/dayT | step / night / setPhase | — | js/core/clock.js | 60 |
| RngStreams | seed/流表 | get / reset | — | js/core/rng.js | 80 |
| Bus | 监听表 | on/off/emit | — | js/core/bus.js | 60 |
| VoxelStore | blocks/meta | get/set/setCells/setMeta/snapshot | block-info | js/world/*（S6 搬） | 现有 |
| DeckSystem | hand/deck/discard/mana/cooldowns | draw/play/discard/swap/equipClass/refill/tick（冷却） | cards | js/systems/deck.js | 220 |
| MovementSystem | pos/vel/onGround/jumpBuf | applyInput/step/teleport/unstick | world | js/systems/movement.js | 260 |
| AimSystem | p.aim | update/rayEntity/aimEntity/targetsInRadius/findStanding | world, entities | js/systems/aim.js | 160 |
| DamageSystem | hp/shield/st/invuln | damage/heal/addStatus/tick | bus | js/systems/damage.js | 140 |
| EffectRunner | 待执行 op 队列 | expand/run | rules shapes, ops | js/systems/effect-runner.js | 200 |
| ProjectileSystem | projectiles[] | fire/step/remove/hitTest/explode | damage, world | js/systems/projectile.js | 260 |
| SummonSystem | summons[] | spawn/step/remove | movement, aim, damage | js/systems/summon.js | 300 |
| SigilSystem | sigils[] | add/tick/destroy/at | effect-runner | js/systems/sigil.js | 200 |
| FluidSystem | fluidQueue | queue/step | world | js/systems/fluid.js | 80 |
| OrbSystem | orbSpec/orbs | grant/step/block | — | js/systems/orb.js | 60 |
| LodeSystem | lodes 归属/热度 | step/totalHold | world | js/systems/lode.js（搬） | 现有 |
| Scoreboard | score/overtime/over | addScore/step/finish | lode, stats | js/systems/scoreboard.js | 150 |
| MatchStats | 计数器 | on/event/snapshot/record | bus | js/systems/stats.js | 180 |
| DebugSystem | 调试旗标 | set/upkeep/flags | config | js/systems/debug.js | 80 |
| ChemBridge | —（适配） | bind/step/stats | GW.CHEM | js/systems/chem-bridge.js | 50 |
| GameMode | 模式状态（默认无） | step/onEvent/checkWin | state | js/rules/modes/*.js | 每模式 ≤150 |

> 表里的「自有状态」= 该系统**拥有写权限的 slice**，实际存放在 AppState.game 里，不在系统实例上（系统是无状态函数，见 §21.3）。

### 7.2 固定 step 顺序（确定性，不可改）

~~~
1  state.snapshotPrev()                  // 渲染插值前提
2  clock.step(dt)
3  debug.upkeep(players)
4  for p: deck.regenMana(p); movement.applyInput(p, input); if cast → deck.play(p, i)
4.5 mode.step(dt)       // 玩法规则插件（默认 no-op；夺旗/占点等在这里）
5  summon.step(dt)
6  orb.step(dt)
7  projectile.step(dt)
8  deck.tick(dt)          // 冷却递减（现 R.tick 里 e.cooldowns 那一段）
9  damage.tick(dt)        // 状态/燃烧/再生/护盾/无敌/水岩浆/冰面（现 R.tick 的其余实体段）
10 chem.step(dt)          // 现 R.tick 内部调 G.CHEM.step
11 fluid.step(dt)         // 现 R.tick 内部调 m.fluidStep
12 sigil.step(dt)         // 现 R.tick 内部调 m.sigilTick
13 lode.step(dt)
14 scoreboard.step(dt)    // 到线即停
15 fx.ambient(..., rng.get('vfx'))       // 纯表现，最后
~~~

**8–12 现在都藏在 G.Rules.tick 里**（R.tick 依次做 实体状态 → G.CHEM.step → m.fluidStep → m.sigilTick）。拆分时必须按这个内部顺序搬家：先抽 sigil/fluid 时，R.tick 保留调用点但转给系统；否则化学/流动/法阵的相对顺序一变，地形重放立刻对不上。

**注意**：第 15 步现在是 this.rng（权威流）。S1 必须仍用 legacy 流，否则 determinism 立刻变；S3 再切 vfx 流并接受基线变化。

**4.5 是玩法插件位**：它固定存在，但内容是模式（默认 no-op）。mode 属 rules 层，由 app 注入 Match，零 DOM/零 THREE；它只读 state、只发 ops。Match 不认识夺旗/占点，只调 mode.step(dt)；胜负判定由 Scoreboard 调 mode.checkWin(state)，夺旗不需要改 §7.2 的顺序。

### 7.3 系统契约（无状态函数，见 §21）

~~~js
// 系统 = 一组无状态函数（模块），唯一输入是 AppState；没有 this，没有实例字段
GW.Systems.Deck = {
  step(g, dt) {},
  draw(g, side, n) {},
  play(g, side, slot) {}
};
~~~
- 只读 g 的公共字段；写只经本系统拥有的 slice API；每次写完调 touch(g, 'players', i) 递增 rev。
- 发事实：bus.emit('damage', {...})；发命令：直接调另一个系统的函数（g 显式传参），不 import 实例。
- 不持有跨 tick 的局部变量；确实需要的缓存放进 g 或 view，不放进模块闭包。
- 跨系统需求一律加到 MatchOps（第 17 个方法要评审）。

---

## 8. Match 门面与 MatchOps

### 8.1 门面职责（≤15 个函数；不是带字段的对象）

~~~js
GW.Match = {
  create(cfg, deps) -> GameState,   // 只造状态，不挂方法；world 由 Session 给
  step(g, dt, inputs),              // 固定顺序调用无状态系统
  playCard(g, side, slot),          // rules → effect-runner
  applyInput(g, side, inp),         // movement
  applyLook(g, side, dYaw, dPitch), // movement/aim
  snapshot(g),                      // 只读快照给 UI/探针
  dispose(g)
};
~~~
兼容：G.Match 构造器保留为**只持 g 引用的门面**（new G.Match(opts) 返回 { g, step, ... }），S6 只保留高频入口；它不再拥有 players/summons/score 等字段。

### 8.2 MatchOps（现状实测 18 个方法 + 1 个只读字段）

rules / net 现在真正碰 Match 的面（2026-10-17 grep 实测）：

- 方法 18：all · defaultAim · drawCards · explode · findStanding · fireProjectile · fireSpirit · fluidStep · sigilAt · sigilTick · spawnBridgeQuill · spawnHail · spawnSummon · targetsInRadius · aimEntity · addSigil · kill · entitiesAt
- 只读字段 1：night（requires.night 判定）
- 另外 grantCard 是定案新申请的（第 19 个，已登记）

> **PLAN_REFACTOR §5.1 记的 15 个已经过时**：并行线把 fireSpirit 与 spawnBridgeQuill 接进了 rules，entitiesAt 也早就在。MatchOps 必须以这份实测为准，否则拆完 rules 立刻调不到方法。

- 声明在 js/systems/match-ops.js，带一句话契约 + 参数校验（dev 模式 assert）。
- rules 只依赖这张表，不碰 Match 私有字段；第 17 个方法出现 = 新依赖，必须评审。
- 迁移期 MatchOps 由 Match 实现（转发），S3 后由各系统实现、Match 只做组装。

---

## 9. 效果原子层（组合能力的核心）

### 9.1 语法

~~~js
EffectSpec = {
  delivery: 'instant' | 'projectile' | 'beam' | 'sigil' | 'summon' | 'trace' | 'aura',
  at: 'aim' | 'self' | 'feet' | 'hit' | 'path',
  shape: { type:'point'|'disk'|'ring'|'line'|'box'|'column'|'crater'|'bowl'|'cage'|'bridge', ...params },
  payload: [ AtomOp, ... ],
  mods: { delay, ttl, every, fuse, capCells, maxTargets, count, spread, chain, shake, once }
}
~~~
AtomOp 只允许 §9.3 表里的 op，参数是纯数据；**不允许携带函数**（数据文件必须可 JSON 化）。

**多段法术不需要额外的 sequence 节点**：一张卡的 effects[] 本身就是序列，每个 EffectSpec 各带 mods.delay / ttl。超阶仪式（20 个 sigil spec，外阵 8 座 + 中阵 6 座 + 内阵 4 座 + 主阵 1 座）今天就是这么写的；EffectRunner 按数组顺序展开，同一 tick 内顺序固定。

### 9.2 展开算法（expand(spec, ctx) → AtomicOp[]）

1. 解析锚点 at → 世界点/格（aim 用 p.aim，feet 用脚下，path 用弹道/桥钉轨迹）。
2. 形状 → cells[]（地形）与 targets[]（实体），纯函数，无副作用。
3. payload 按书写顺序展开到每个目标/格；capCells 在 setCells 单点截断，价格由 pricing 用同一个 cellsFor 算——**看到的格数与改到的格数永远同源**。
   **确定性顺序**：shape 返回的 cells 按 (y, z, x) 字典序排序，targets 按实体 id 升序；禁止用 Set/Map 的迭代顺序驱动写世界。op 的执行顺序 = payload 数组顺序 + 上述排序。
4. delivery 包一层：
   - projectile → 建弹，onHit 展开 payload；count/spread 生成齐射。
   - sigil → 建阵，every 周期展开 payload；once 只展开一次；sub 嵌套一个子 spec（陨星雨用它）。
   - summon → 建随从，aiKind 从行为表选状态机。
   - trace → 沿轨迹逐格展开（飞桥）。
   - instant → 立即展开。
5. mods 只作用于包装层（延迟、存活、近失、上限），不进 payload。

### 9.3 op 表（25 → 12 个原子 + 4 个游戏动词）

| 旧 op | 新原子 | 说明 |
|---|---|---|
| damage / loseHp | damage | 带 kind/src/范围衰减 |
| heal / shield / regen / speed / buffNext | vitals | 子字段区分 |
| status | status | 状态表驱动 |
| spawn / spirit / hail | spawn | hail = projectile{count}；spirit = spawn{aiKind} |
| sigil / totem | sigil | preset id |
| setBlock（13 模式） | cells | 形状 + 材料 |
| pull / push / blink | impulse | 位移类（力度/方向/上限） |
| quake | shake + damage | 组合，不单列 |
| ignite | ignite | 点燃格 |
| draw / gainMana / manaCapDown | deck | 子字段区分 |
| harvest / swap / destroySigil | verb | 保留 4 个游戏动词（有专属语义，但只有一个 handler） |
| score | score | 事件 |

这 16 个 handler 就是"基本元素"。新卡 99% 由它们组合；加第 17 个 handler 必须说明"为什么现有元素组合不出来"。

### 9.4 形状表（纯函数，返回格集）

point / disk(r,h) / ring(r0,r1) / line(len,w,h) / box(w,h,d) / column(up,down) / crater(r,depth) / bowl(r,depth) / cage(h,thickness) / bridge(len,ballistic) / ramp(len,rise) / shift(dx,dz)

每种形状只回答"涉及哪些格、落位到哪、哪些格可站/可放"，不写方块、不扣素材。返回数组必须按 (y,z,x) 字典序排序——同一份数据在 S3 前后必须得到同一顺序的地形写入，否则重放哈希会破。

### 9.5 三个实例（证明表达力）

~~~js
// 焰矢
{ delivery:'projectile', at:'aim', shape:{type:'point'},
  payload:[{op:'damage', amount:11, kind:'fire'}], mods:{fuse:1.8} }

// 灭世天陨：阵 + 周期圈伤 + 子节拍落陨星（旧 meteorEvery 分支）
{ delivery:'sigil', at:'aim', shape:{type:'disk', r:6.5}, mods:{ttl:9, every:0.6},
  payload:[{op:'damage', amount:12, kind:'fire'}],
  sub:{ delivery:'projectile', every:0.45, at:'inside', count:1,
        shape:{type:'disk', r:3.4}, payload:[{op:'damage', amount:30, kind:'fire'},
        {op:'cells', shape:{type:'crater', r:2.2, depth:3}}], mods:{spread:5.6, ballistic:true} } }

// 飞桥：沿抛物线逐格铺板
{ delivery:'trace', at:'feet', path:{type:'ballistic', angle:'camera', speed:26},
  shape:{type:'line', len:10, w:1}, payload:[{op:'cells', mode:'fill', block:'plank'}],
  mods:{capCells:12} }
~~~

### 9.6 兼容层

- legacy-adapter.js 把旧 op / sb 模式**编译**成新 spec；cards.js 在 S3 前半段一行不改。
- 每迁一批卡，cards_probe 的 49 条 + hit_check 的 44 条逐条对；同一批内不允许"顺手改数值"。
- 迁移完成的判定：legacy-adapter 在 dev 模式下打印"0 次调用"一整轮探针；S6 删除。
- **op schema 机检**：owner_check 同时扫 cards.js / sigil-catalog.js 的数据，未知 op、未知 shape、未知参数都按行号报错；新增 op 必须先在 handler 表登记，否则 E1–E7 的"不允许新 op"只能靠人肉。

---

## 10. Rules 拆分

| 新文件 | 职责 | 只回答 |
|---|---|---|
| rules-engine.js | 编排：校验 → 报价 → 展开 → 执行 → 记账 | 这张牌能不能出、出下去发生什么 |
| legality.js | 魔力/冷却/requires/上限/目标合法 | 为什么不能出（reason key） |
| pricing.js | 素材按格计价、部分成交、截断 | 付得起几格、实际扣多少 |
| terrain-shapes.js | §9.4 形状 → 格集 | 涉及哪些格 |
| targeting.js | 射线/圆/锥/实体选择 | 选中谁/哪格 |
| damage-resolver.js | 护盾/易伤/致死/减伤 | 这一下掉多少 |
| status-effects.js | 状态表、叠层、速率、tick | 状态怎么算 |
| effects/*.js | §9.3 的 16 个 handler | 一个 op 一件事 |

Rules.play 不再直接调 Match：它返回 {ok, plan, quote}，由 EffectRunner 执行；执行结果回给 Rules 记账（素材/冷却），账本仍在 DeckSystem/Scoreboard。

---

## 11. UI 场景与会话

### 11.1 Scene 接口

~~~js
class Scene {
  constructor(app) {}
  enter(args) {}      // 幂等；不在这里生成世界
  exit() {}
  frame(dt) {}        // 只有栈顶 scene 收到
  key(ev) { return false; }
  panels() { return []; }   // 本场景激活的面板（其余 hide）
}
~~~

### 11.2 SceneStack + SessionRunner

> v1.4 起场景不再是有字段的实例：ui.scene 存 {id,args,progress}，SCENES 是描述表，enterScene/exitScene/frameScene 是函数（见 §21.6）。下文的类图按旧口径保留，实施以 §21.6 为准。

~~~js
class SceneStack { push(s) / pop() / replace(s) / frame(dt) / top() }
class SessionRunner {
  start(cfg)      // 校验 cfg → replace(LoadingScene)
  steps(cfg)      // generator：world → baseline → meshes → match → cams → sources → bind → done
  finish(match)   // 生成 RoundRecord → replace(ResultScene)
  quit()          // dispose runtime → replace(MenuScene)
}
~~~
LoadingScene 按 generator 每帧推进一步（同步生成分片），进度条读 steps.done/total；**不引入 async/await**（无构建、要兼容 file://）。

### 11.3 场景清单

| 场景 | 内容 | 面板 |
|---|---|---|
| Boot | 图集/音频/缩略图准备、错误页 | — |
| Menu | 标题、模式卡（训练/分屏/联机禁用/创造）、继续、设置、退出 | menu |
| Lobby | 地图预设（缩略图 + seed）、牌组、规则（胜分/时限/命数）、开始 | lobby（新） |
| Loading | 进度、提示、取消 | loading（新） |
| Match | 现有 HUD + 手持栏 + 背包（按 BagProfile 渲染，见 §20） | topbar/vitals/aim/log/toast/hotbar/bag/choice |
| Pause | 继续/设置/回主菜单 | pause（新，可并入 Match） |
| Result | 胜负、reason、stats 表、再来/换图/回菜单 | result（改造） |

### 11.4 MatchConfig → 地图

- MapPreset 数据表（js/app/map-presets.js）：{id, labelKey, size, sea, spawnPad, lodes, experimental, noteKey}。
- World 构造只读 config；main.start 不再写死 [96,40,96]。
- 64 图在相机线收口前标 experimental:true，Lobby 上显示原因（读 H.TEXT.lobby.cam64）。

### 11.5 指针/暂停/输入

- Scene 声明 pausing、pointer:'lock'|'free'；进入场景统一处理 exitPointerLock 与提示。
- 面板开着暂停判据从 H.uiPanelOpen() 改为 scene.pausing || panel.pausing（兼容旧入口）。
- 键位表仍归 main.js（app 层），场景只消费意图。

---

## 12. 统计与战绩

### 12.1 事件（只发事实，不带文案）

spawn / despawn / damage / heal / kill / respawn / cardPlayed / cardDrawn / sigilCast / sigilDestroyed / lodeCaptured / score / blockChanged / roundEnd

### 12.2 MatchStats

~~~js
stats = {
  perSide: [{ score, kills, deaths, damageDealt, damageTaken, cardsPlayed, manaSpent, matsSpent,
              blocksPlaced, blocksRemoved, sigilsCast, lodeHoldSec, firstBloodT }],
  timeline: [{ t, type, side, n }]   // 可选，默认只留关键事件
}
~~~
snapshot() 返回冻结副本；HUD/结算/探针只读它。

### 12.3 RoundRecord + StatsStore

~~~js
RoundRecord = { id, cfg, seed, startedAt, endedAt, winner, reason, stats, v:1 }
StatsStore = { add(r) / list() / clear() / aggregate() }   // localStorage 'gw.history'，上限 100 局
~~~
- 结算页显示本局 + 历史（胜率/平均时长/平均分）。
- tools/stats_check.cjs：造 3 局，断言 record 字段、聚合、损坏数据的容错。

---

## 13. 目标文件与加载顺序

~~~
js/core/{clock,rng,bus,vec}.js
js/systems/{match-ops,deck,movement,aim,damage,effect-runner,projectile,summon,sigil,fluid,orb,lode,scoreboard,stats,debug,chem-bridge}.js
js/rules/{rules-engine,legality,pricing,terrain-shapes,targeting,damage-resolver,status-effects}.js
js/rules/effects/{damage,vitals,status,spawn,sigil,cells,impulse,ignite,deck,verb,score,shake}.js
js/cards/{effect-grammar,legacy-adapter,sigil-catalog}.js        # cards.js 保留数据
js/ui/scenes/{menu,lobby,loading,match,result,pause}.js
js/app/{session,session-runner,map-presets}.js
js/battle.js                                                     # Match 门面（S6 搬 src/battle/match.js）
~~~
index.html 顺序：core → world → cards → rules/effects → systems → battle → camera → input → render → ui → hud → scenes → app → main。
新增文件必须进序列；tools/layer_check.cjs 增加"未加载文件"检查（避免死代码）。

---

## 14. 迁移阶段（每一步独立可回滚）

### S0 · 基线（0.5 天）

- git switch -c refactor/systems（从干净 HEAD；并行会话的未提交改动不带上）。
- 新增 tools/determinism.cjs：node 里建 Match、固定输入序列跑 N tick，输出 world+entity+score 哈希；--seeds 多跑；--trace 默认逐 tick 记录事件序列（damage / kill / cast / score / respawn / 地块变更），只比最终哈希会漏掉中间时序回归。
- 新增 tools/owner_check.cjs：文件 → 允许写的字段前缀白名单，正则扫 .(pos|vel|hp|score|hand|...) =；先警告，S1 起阻塞。
- 记录三种子基线哈希（/tmp 不入库，或 tools/baseline/*.json 随阶段更新）。
- **退出**：audit 三种子 + --file 绿；determinism 可复现（同树跑两次相同）。

### S1 · 契约与状态（1–2 天，无行为变化）

- 搬 V → core/vec.js；加 Clock / RngStreams / MatchConfig / MatchState / MatchEvents。
- Match 用 clock 与 rng.get('legacy')；scoreWin/timeCap/overtime 读 cfg（值不变）。
- 抽 Scoreboard、MatchStats（先镜像 p.score/kills/lives），MatchOps 声明并转发。
- **退出**：determinism 哈希与逐 tick 事件序列与 S0 **完全一致**；rules.js 的 hp 写入点已改经 DamageSystem.applyHp（访问器双写）；trace 覆盖 damage / regen / heal；play_probe / hand_check / cards_probe / hit_check 绿；Match 行数下降但方法数不变。

### S2 · 系统抽取（3–5 天，一次一个系统）

顺序（按调用图从少到多，且先处理"藏在 R.tick 里"的三件）：sigil → fluid → orb → projectile → summon → movement → deck → aim → damage。
注意：sigil/fluid 现在由 R.tick 调 Match，抽取时 R.tick 的同名调用改成 ops 转发，**不许顺手把 R.tick 的顺序重排**。
每个系统一个 commit：

1. 新文件实现系统；Match 同名方法改转发（外部调用零改动）。
2. determinism 哈希不变；相关探针绿；owner_check 对旧文件放行方式：删掉白名单条目。
3. 失败即 git revert 单 commit。

**"无行为变化"不能只看最终哈希**：两个实现可能最终世界相同但中间时序不同（伤害先于位移、命中先于状态）。S2 每步还要跑 tools/determinism.cjs --trace：固定输入跑 600 tick，逐 tick 记录事件序列（kill / damage / cast / score / respawn）并比对。最终哈希 + 事件序列都一致，才允许合并。

**退出**：9 个系统文件就位、转发壳可调用；哈希与逐 tick 事件序列仍一致。**≤15 门槛不在这一步验收**——按卡效果方法要到 S3 才迁走（见 A4），否则会逼着 S2 提前做 S3 的活。

### S3 · 效果原子 + Rules 拆分（3–5 天，风险最高）

- 9.2–9.5 落地 effect-grammar v2 + effect-runner + legacy-adapter。
- 先迁 7 个按卡 Match 方法（陨星/飞桥/核爆/陨石/冰雹…）为数据，再迁 rules.applyEffect 的 25 个 op，最后迁 13 种 setBlock 模式。
- 每批：cards_probe 49 + hit_check 44 + vfx_check 49 + determinism（基线变更要写清单）。
- **退出**：legacy-adapter 零调用；cards.js 只剩新 spec；rules.js 拆完；Match 无按卡方法，**自有逻辑方法 ≤15（A4 至此验收）**；地形变更事件序列与基线一致（shape 排序固定）。

### S4 · 场景/会话（3–5 天）

- SceneStack / SessionRunner / MatchConfig / MapPresets / Lobby / Loading。
- main.start 拆四段；菜单/结算从 Panel 变场景；H.TEXT 增 lobby/loading 段。
- **退出**：A6 场景往返 3 次；ui_check / creative_check / ui_shot --gate（两档 dpr）+ 人工看图；audit 绿。

### S5 · 统计与战绩（2 天）

- StatsStore / RoundRecord / 结算页统计块 / 菜单历史。
- **退出**：stats_check 绿；按局数/胜率聚合正确；HUD 不再直读 p.score。

### S6 · 收尾与机械搬移（1–2 天）

- 删兼容别名、旧 op、legacy-adapter、_placeholder-*；按 MANIFEST 搬 src/；更新 index.html 与 tools/layer_check。
- **退出**：全套门禁 + audit --file；双击可玩。

---

## 15. 兼容策略

| 对象 | 兼容方式 | 移除时机 |
|---|---|---|
| GW.Match 69 个方法名 | S2 起全部转发；S6 保留高频入口 | 永不移除（外部探针/控制台） |
| 旧卡 op / sb 模式 | legacy-adapter 编译成新 spec | S6 |
| p.score/kills/lives | Scoreboard 每 tick 写只读镜像 | S5 改读 stats |
| p.creative | DebugSystem 每 tick 把 cfg.debug 快照挂上 | S6 改读 flags（保留别名） |
| 存档 v1（seed+diff） | 读写都不变；MatchConfig 另存 | 永久 |
| 探针入口 __GW_START/__camPose/__dbg/GWAPP | 不改签名；新增字段只增不减 | 永久 |
| H.TEXT 旧 key | 只增不改；新场景另起段 | 永久 |
| MatchOps 16 个 | 名字与语义冻结；第 17 个要评审 | — |

---

## 16. 扩展性验收用例（用户给的合格线）

| # | 新功能 | 要改的文件 | 数量 | 不允许出现 |
|---|---|---|---|---|
| E1 | 新地形卡「黑曜石墙」（组合已有 cells/line，固体材料） | cards/card-catalog.js | **1** | 新 op、新 Match 方法 |
| E2 | 新法阵「雷暴」（周期落雷，已有 sigil+projectile） | cards/sigil-catalog.js | **1** | sigilTick 新分支 |
| E3 | 新召唤「炮台」（指向性，已有 spawn+aiKind） | card-catalog.js + summon.js 行为表一行 | **2** | 新类、新 step |
| E4 | 新模式「夺旗」（得分条件不同） | rules/modes/ctf.js + modes/index.js 注册一行 | **2** | 改 Match 流程 / 改 §7.2 顺序 |
| E5 | 新地图「群岛 96」（尺寸/海平面/矿数不同） | app/map-presets.js | **1** | 改 World/main |
| E6 | 新指标「首杀时间 / 每分钟伤害」 | stats.js 字段 + 发事件的 owner 一行 | **≤2** | 改 HUD 逻辑（通用表格渲染） |
| E7 | 新元素「雷」 | cards/elements.js + vfx-recipes 调色 + sfx 表 | **3** | 改 damage/status 分支 |
| E8 | 新背包页（如「合成」页） | js/ui/bags/profiles.js 一条 + CardSource 适配器一件 | **2** | 改 BagPanel 结构、加 creative 分支 |
| E9 | 新状态字段（如「连杀数」） | 域 owner 一行 + snapshot 一行 + 事件一行 | **≤2** | 在 UI 里另存一份 |

E1 的「墙」必须是**固体**：拿 lava 当墙会继承液体语义（流动/燃烧/照明），那是另一条机制，不算 E1 的组合能力。
玩法模式（E4）走 §7.2 的 4.5 插件位与 mode.checkWin，**Scoreboard 的钩子是一次性基础设施，不计入每个新模式的成本**。

评审请重点验 E1–E4：它们决定"组合"是不是真的。

---

## 17. 风险与未决问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| RNG 分流改变序列 | 现有种子基线/探针红 | S1/S2 全部走 legacy 流；分流逐系统做，每步写"预期变化清单"并重基线 |
| 系统抽取改变 tick 顺序 | 物理/命中手感变化 | 固定 §7.2 顺序；每步 determinism + hit_check/jump_window |
| 效果 DSL 变成"更难查的解释器" | 调试成本上升 | expand() 必须能打印 spec → op 列表 → 格集；探针按 op 断言；每批卡 A/B |
| 实体组件化碰热路径 | GC/帧率 | 不组件化 pos/vel；只对 vitals/deck/ai 用别名 |
| 场景层与现有 UI 框架冲突 | 面板/指针/暂停回归 | Scene 只做编排，面板仍是 Panel；ui_check 加场景段 |
| 并行会话改同一批文件 | 冲突/半套提交 | 分支隔离；共享文件只落最终态；S0 先等并行线 commit |
| 形状/展开遍历顺序不确定 | S3 后地形重放哈希破 | shape 返回按 (y,z,x) 排序；trace 记录地块变更 |
| 玩法模式与固定 step 冲突 | 每个新玩法都要改 Match | 4.5 mode.step 固定插件位；mode 只读 state、只发 ops |
| 文件数上升 | 可读性下降 | 每层一个 index 注释；文件 ≤350 行；layer_check 查未加载文件 |
| 阶段工期被低估 | 半途停 | 每阶段可独立交付；S1/S2 不改变行为，随时可停 |

**未决问题（请评审给意见）**：

1. pos/vel 不组件化是否可接受？会不会被"彻底拆分"判为不彻底？
2. 多段法术的 mods.delay 是"相对上一段"还是"相对施法瞬间"？现状 sg() 的 delay 是相对施法瞬间（3 个阵同时起、各自延迟），如果改成相对上一段，超阶仪式的手感会变——这条请评审给意见。
3. 场景层用 generator 分帧加载，是否比 setTimeout 分片更可测？
4. Stats 的 timeline 默认开还是关（内存 vs 回放价值）？
5. S6 搬 src/ 是否应该拆成独立计划（避免本计划被目录迁移拖住）？

---

## 18. Kimi 评审清单（逐条打勾）

1. §5 的所有权表：有没有"两个 owner 都能写"的字段？给出反例与小节号。
2. §7.2 的 step 顺序与现状是否等价？有没有被拆丢的阶段（stepOrbs / G.Rules.tick / ambient）？
3. §6.4 / §15：RNG 迁移方案能否真的保持 S1/S2 哈希不变？legacy 流够不够？
4. §9：用终末 / 灭世天陨 / 飞桥 / 超阶仪式 / 奇点 / 图腾 / 冰雹 逐张验 DSL；不能表达的，指出缺哪个原语。
5. §9.3：16 个 handler 是否覆盖 25 个旧 op + 13 种形状？有没有"必须新增 handler"的旧卡？
6. §16：E1–E4 的"文件数"声明是否可信？有没有隐藏的引擎改动？
7. §11：场景层在"无构建 + file:// + 20Hz 主循环 + 指针锁"下是否可行？有没有更简单的做法？
8. §14：S1/S2 的"无行为变化"能否被 determinism 真正证明？哈希该包含哪些字段？
9. 兼容性：老卡、存档、探针、69 个方法名，哪一条会先破？
10. 结论：**按此计划做完，是否满足"组合扩展 + 兼容 + 可维护"？** 合格 / 需修改（列 blocking ≤6 条）。

---

## 附录 A · 69 个方法 → 系统

| 系统 | 方法 |
|---|---|
| DeckSystem | makePlayer(牌部分) reshuffle drawCards handCard cardTypeSet cardType siftType equipClass takeFromHand swapHand discardSlot refillHand useHotkey |
| MovementSystem | collideAABB unstick applyInput applyLook |
| AimSystem | defaultAim updateAim rayEntity aimEntity targetsInRadius entitiesAt findStanding |
| ProjectileSystem | fireProjectile explode fxColor spawnHail stepProjectiles steerProjectile acquireTarget hitTestEntity hitTestSegment |
| OrbSystem | orbPos stepOrbs orbBlock |
| SummonSystem | spawnSummon removeSummon stepSummons aiAggro stepFlyer summonBolt fireSpirit spawnDummy |
| SigilSystem | addSigil sigilAt sigilTick |
| EffectRunner | spawnBridgeQuill stepQuill paintBridge digCrater detonateNuke spawnMeteor（→ 数据） |
| FluidSystem | fluidStep |
| Scoreboard | addScore scoreboardStep finish kill spawnStandY respawnPlayer placePlayers |
| Match 门面 | step snapshotPrev renderPos playCard all livingPlayers fxEvent creativeUpkeep |

## 附录 B · 旧 op → 新原子（逐条）

见 §9.3；补两条例外：totem → sigil{preset:'totem', ttl}；spirit → spawn{aiKind:'spirit'}。
形状模式：erase→cells{mode:'erase',shape}、fill→cells{mode:'fill'}、column→shape:column、bridge→trace、wall→line×height、cage→cage、bunker→box+ceiling、moat→ring erode、crater→crater、ramp→ramp、shift→shift、grow→column up、layer→disk h1。

---

## 19. 评审记录

- **2026-10-17 · Kimi k3（kimi-coding）**：连续 5 次调用（50KB 单文件包 / 23KB 压缩包 / low 推理 / 短问答）均在运行中被中断，没有返回结论。从子会话日志读到真实原因：HTTP 403 permission_error，"You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends."（账号 5 小时额度用尽）。**Kimi 评审未完成**；额度恢复后需用本文件复评。
- **2026-10-17 · DeepSeek V4 Pro 代审**（非 Kimi，只作过渡）：结论「需修改」，4 条 blocking + 3 条建议。v1.1 已逐条落进：
  1. E4 与固定 step 冲突 → 4.5 mode.step 插件位（§7.2 / §11 / §16）；
  2. S2 退出与 ≤15 矛盾 → 门槛移到 S3 后（§1.2 A4 / §14）；
  3. 只读别名与 hp 写入冲突 → 可写访问器 + S1 迁移清单 + trace（§5.3 / §14 S1）；
  4. 展开顺序未冻结 → shape 按 (y,z,x) 排序、payload 顺序入 spec（§9.2 / §9.4）；
  建议 1（op schema 机检）落在 §17 风险缓解；建议 2（E1 改固体材料）已改；建议 3（trace 默认开）已进 S0。
- **2026-10-17 · 用户评审（口头）**：背包没有按模式分版（生存/创造混在一个面板），生存背包与牌库不联动、存在两套定义；状态应再按玩家/场景/游戏模式拆开且可读。→ v1.2 §20 增补（CardSource / BagProfile / BagPanel 三层；七域状态表 + snapshot 契约 + A8/A9/E8/E9）。
- **2026-10-17 · Kimi k3（额度恢复后）**：评审 §20 增量，结论「需修改」；3 条 blocking（S3.5 不是零权威改动 / 旧意图到新路由缺映射 / RenderState 不可序列化与七域快照矛盾）+ 2 条建议（牌库顶 3 张可见、snapshot 版本要校验）。v1.3 已逐条落进 §20.3、§20.5、§20.8、§20.9、A9。
- **2026-10-17 · 用户评审（第二轮）**：背包只是例子；要求类/函数尽量无状态、状态集中维护、一次状态变更下游全部跟着变。→ v1.4 §21（AppState 三根 + 无状态系统 + selector/rev 传播 + A10–A12/E10），并把 §7.3/§8.1 改成无状态契约。
- **2026-10-17 · 实施记录（refactor/systems 分支）**：
  - S0：`tools/determinism.cjs`（种子哈希 + 逐 tick trace）、`state_probe`、`owner_check`（按域白名单，`--strict` 0 越界）。
  - S1：`RngStreams`（legacy 保序）、`rev/touch`、`MatchOps` 18 方法、`Scoreboard/Stats` 抽出。
  - S2：Fluid/Orb/Deck/Aim/Projectile/Summon/Movement/Sigil/Damage 九个系统搬成无状态函数；每步 400 tick 哈希与基线逐字节一致；`Match` 原型方法从 69 降到约 30（多为转发）。
  - S3：`effect-spec` 规范化 76 张卡（无未知 op、确定性、可 JSON）。
  - S3.5：`BagProfile/CardSource` + 生存背包牌库/弃牌堆只读页；页签完全由 profile 驱动。
  - S4：`ui.scene` + `SCENES`、start 拆 buildWorld/buildMatch/beginLoop、`AppState` 单根（game/ui/view/session）；Scene 订阅写 `ui.scene`。
  - S5：`StatsStore`（RoundRecord + 历史 + 聚合），结算自动入账。
  - 探针：ui_check 132、creative_check 53、cards 67、hit、chem、bag 23、selectors 16、scene 11、effect 10、stats 9；audit 490706/88092 通过，31337 的 C4/H 与基线一致（既有红）。


---

## 20. 游戏逻辑再拆：状态域与背包分版（v1.2）

### 20.1 背包现状：不是"面板不好看"，是没有抽象

实测（2026-10-17）：

- 一个 Inventory 面板靠 creativeOnly 标志切页签；生存模式只剩「随身」一页（hud.js 的 tabs）。
- p.deck 是权威牌库（12–20 张），但背包里只有一个数字 deckN；deck 容器 size=1、**没有任何槽位被填过**（UI.build + viewmodel 只写了 dk.selected = -1）。
- catalog 是"全部 73 张卡"，只在创造模式可用；生存玩家没有任何地方能看自己的牌库。
- tray 是 localStorage 本地收藏，与牌库无关，却和手持栏、图鉴混在同一页。
- hand 与 hotbar 是两个容器 id，镜像同一份 p.hand（双份定义），P2 还有 hotbar2。
- ui.give 直接要求 G.Creative.on（main.js），所以"往背包里放牌"在生存里根本不存在。

结论：缺的是三层——**权威源投影（CardSource）→ 模式配置（BagProfile）→ 渲染器（BagPanel）**。不是再给面板加一个 if。

### 20.2 三层

~~~text
CardSource（权威源适配器，只读投影 + 能力）
      ↓ snapshot(vm, side)
BagProfile（模式配置：页面、能力、布局、文案 key）
      ↓ vm.bag
BagPanel（渲染器：只读 profile + vm，无 creative 分支）
~~~

- **CardSource** 不知道 DOM，也不知道文案；它只回答"这一页现在有哪些条目、能不能拿/放/换位/使用"。
- **BagProfile** 是纯数据，按模式选（生存 / 创造 / 未来的 draft、collection）。
- **BagPanel** 是唯一的背包面板；页签、按钮、可编辑性全由 profile 决定。

### 20.3 CardSource 契约

~~~js
CardSource = {
  id: 'hand' | 'deck' | 'discard' | 'tray' | 'catalog' | 'blocks',
  authority: 'authoritative' | 'local' | 'infinite' | 'readonly',
  page: { key, labelKey, cols, layout: 'slots' | 'stacks' | 'grid' },
  snapshot(app, side) -> { items: [{kind,id,count,meta}], total, extra },   // app = AppState，见 §21
  caps: { take, put, reorder, use, discard, examine },
  intent(action, args) -> { type, payload } | null   // 只产意图，不写状态
}
~~~

**旧意图不删名，只重路由**（ui_check 的 INTENTS 反查与 deny 人话表继续认这些词）：

| 旧意图 | 新路由 | 备注 |
|---|---|---|
| ui.reorderHand | hand.reorder | 词汇不变 |
| ui.useSlot / ui.castCard | hand.use | 词汇不变 |
| ui.discard | hand.discard | 由 profile.caps.discardHand 决定 |
| ui.takeFromHand | hand.take | 词汇不变 |
| ui.give | catalog.take | 仍要求创造模式 |
| ui.selectSlot | UIState.select | 只改视图选中态 |
| ui.selectClass | deck.setClass | 词汇不变 |
| ui.examine / ui.readOnlyUse | source.examine | 只读镜像 |
| ui.dropOnWorld | hand.use + castAt | 沿用现有两段式 |

各源的行为：

| 源 | authority | 投影 | 能力 |
|---|---|---|---|
| hand | authoritative | 5 格，一格一张 | 换位（ui.reorderHand）、使用（ui.useSlot）、扔（ui.discard，按模式） |
| deck | authoritative + readonly | 按卡 id 聚合，显示 ×N；抽牌顺序 = 顶部在前 | 只看（ui.examine）；不能拖出 |
| discard | authoritative + readonly | 按 id 聚合，最近在前 | 只看 |
| tray | local | 10 格本地收藏 | 本地拿放，存 localStorage；**不进牌库** |
| catalog | infinite | 全部卡，网格 | 复制到手持栏（ui.give，创造限定） |
| blocks | infinite | 全部方块，网格 | ui.give 方块 → no-handler（通道留着） |

投影规则：

1. 每帧从 p.hand / p.deck / p.discard 现算，**不缓存权威副本**；Bag 里的容器只是投影缓存，任何操作成功后 invalidate。
2. 聚合：同一 id 合并 count，顺序按首次出现；meta.card 从 CARDS_BY_ID 查。
3. 只投影 side=0（分屏 P2 的背包暂不开放；P2 的手持栏照常显示）。
4. 类别筛选（全部/挖掘/法术/法阵/召唤/实用）对 hand/deck/discard 三源同时生效；计数复用现有 vm.classes。

### 20.4 BagProfile（模式配置）

~~~js
G.BAG_PROFILES = {
  survival: {
    id: 'survival', labelKey: 'bag.survival',
    pages: ['hand', 'deck', 'discard'],
    caps: { catalog: false, debug: false, tray: false, discardHand: true },  // 扔牌沿用现状：由 GameMode 最终决定
    layout: 'survival'
  },
  creative: {
    id: 'creative', labelKey: 'bag.creative',
    pages: ['catalog', 'blocks', 'hand', 'tray', 'debug'],
    caps: { catalog: true, debug: true, tray: true, discardHand: true },
    layout: 'creative'
  }
  // 未来：draft / collection / campaign 各一份，互不改代码
};
~~~

选择规则：

~~~js
profileFor(cfg, modeState) =
  cfg.debug.creative ? 'creative'
  : (modeState.bagProfile || 'survival');
~~~

- 由 app 写进 vm.bag = { profile, pages, caps }；BagPanel 只读。
- 新增模式默认继承 survival；要特殊背包就在模式里写 bagProfile（E8 验证）。
- **BagPanel 里不许出现 vm.creative 分支**；owner_check 扫 panels.js 的 creative 引用。

### 20.5 生存页（用户要的"能拿到什么牌"）

- 顶部：类别片 + 计数（现有 vm.classes）。
- 手持栏：5 格，可拖、换位、打出（这是唯一"现在能用"的牌）。
- 牌库：聚合卡格（×N），只读；点开详情；底部「共 N 张」；**详情栏固定显示牌库顶 3 张**（聚合会掩盖顺序，玩家要能猜下一张）。这条单设一条断言，不并入 E8。
- 弃牌堆：聚合卡格，最近在前；点开详情。
- 不显示图鉴、不显示调试、不显示随身格。
- 文案（H.TEXT.bag.survival）："牌库 = 这一局你拥有的牌，抽牌从顶部来；弃牌堆 = 已经用掉的牌。"
- 交互语义与 MC 一致：**手里的能拖，库里的只能看**；想改牌库只有抽/洗牌这些规则途径，UI 没有"从牌库拿一张"的按钮。

### 20.6 创造页

- 图鉴（全部卡）+ 方块页 + 手持栏 + 随身格 + 调试页。
- 无限取（ui.give 仍要求创造）；不显示牌库/弃牌堆——创造模式没有"拥有"概念。
- 页签顺序、能力全由 profile 的 pages/caps 决定。

### 20.7 收口"两个定义"

1. **p.deck 是唯一"我拥有的牌"**；catalog 只是创造模式的生成器；tray 是本地收藏，不是牌库。
2. **容器合并**：hand 与 hotbar 合并为一个 id hand（P2 用 hand2）；HUD 手持栏与背包编辑行绑定同一个投影，不再两套。
3. **视图不再判断模式**：页签/按钮/可编辑性读 vm.bag；H.TEXT.inv.tabs 的 creativeOnly 标志删除。
4. **任何"牌从哪来"只有一个答案**：生存 = 牌库/弃牌堆/手持栏；创造 = 图鉴（+ 随身格）。
5. 文案必须写清三者的区别（H.TEXT.bag.*），避免玩家把"随身格"误当牌库。

### 20.8 状态域（用户要的"按玩家/场景/模式拆开且可读"）

| 域 | 内容 | owner | 生命周期 | 持久化 | 快照 |
|---|---|---|---|---|---|
| WorldState | blocks / meta / biome / lodes / weather | World · Chem · Lode · Weather | 一局 | seed + diff | world.snapshot() |
| PlayerState | Body / Vitals / Deck / Control / Aim | 四个系统 | 一局 | 关键字段进存档 | player.snapshot(side) |
| MatchState | clock / scoreboard / mode / stats / over | Match · Scoreboard · Stats · GameMode | 一局 | RoundRecord | match.snapshot() |
| SessionState | config / phase / handles / history | SessionRunner | 一次启动 | config + 战绩 | session.snapshot() |
| SceneState | 当前场景 / 加载进度 / 暂停 / 指针锁 | SceneStack | 一次会话 | 不持久化 | scene.snapshot() |
| UIState | bag profile / sel / filters / toast / drag | UIState | 一次会话 | 仅偏好（tray/cam/post） | ui.snapshot() |
| RenderState | alpha / 粒子 / 相机平滑 / VFX / 角色动画 | 渲染层 | 一帧 | 不持久化 | 字段清单（无值） |

约束：

1. 只有 World / Player / Match / Session 参与权威 tick；Scene / UI / Render 只读快照。
2. 每个域提供 snapshot()：扁平、可 JSON、带 v（版本）与字段注释表；新增字段必须同时加注释与探针断言。**v 变化时 state_probe 必须报 breaking 字段差异**（新增/删除/类型变更），否则版本号不算数。
3. 跨域写只经 owner API；owner_check 的白名单按域组织（不是按文件散着写）。
4. 持久化边界：World/Player/Match → 存档；Session → config + RoundRecord；UI → 只存偏好；Scene/Render → 不存。
5. 可读性验收：tools/state_probe.cjs 能打印七域快照；每个字段有 owner / 类型 / 单位 / 缺省 四列的表（放在 docs/STATE.md，从 snapshot 自动生成，禁止手写第二套）。

### 20.9 迁移与门禁（插在 S3 与 S4 之间）

- **S3.5 背包分版（ui 层为主，但会碰 HUD 绑定与 ui_check 断言，不是「零权威」改动）**：新增 js/ui/bags/{sources,profiles,panel}.js；selectors 增加 bag 与 deck/discard 聚合投影（取代 ViewModel.build）；合并 hand/hotbar 双容器与删除 creativeOnly。
  必须同步的改点：Hotbar 面板的 data-box（hotbar→hand、hotbar2→hand2）、HUD.sel/resetSel 的引用、main.js bindUIChannel 里 hotbar 相关入口、ui_check 的「滚轮选卡 / 拖到格缝 / 拖到画面出牌」三条断言。
  门禁：ui_check + creative_check + ui_shot --gate（两档 dpr）+ 人工看图 + **新增静态检查「双容器引用残留」**（data-box 里 hand/hotbar 只能单源）；audit 不回归。
- **S3.6 状态域快照**：给四域加 snapshot()，HUD 逐步改读快照；新增 tools/state_probe.cjs。
  门禁：state_probe 六域 JSON + Render 字段清单齐全；owner_check 按域白名单；ui_check 不回归。
- 放在 S4 前：背包依赖 DeckSystem 的权威投影（S2 已抽），而场景层（S4）要按 profile 组织面板。

### 20.10 验收（v1.2 新增）

- **A8 背包分版**：生存页显示牌库/弃牌堆聚合且与 p.deck/p.discard 一致；创造页不显示牌库；panels.js 零 creative 分支；hand/hotbar 单容器。
- **A9 状态域**：**六域**（World/Player/Match/Session/Scene/UI）snapshot 可 JSON、字段表齐全；RenderState 只输出**字段清单（不给值）**，因为它每帧变且不可序列化；Scene/UI 不写权威域（owner_check）。
- **E8**：新背包页 = profile 一条 + CardSource 一件（≤2 文件），不改 BagPanel 结构。
- **E9**：新状态字段 = 域 owner 一行 + snapshot 一行 + 事件一行（≤2 文件），不在 UI 里另存。

> 这两条把用户的判断标准写死：**背包是模式的函数，不是面板里的 if；状态是分域的只读快照，不是随手挂在 match 上的一堆字段。**


---

## 21. 无状态化与单一状态源（v1.4）

> 这一节回答用户的两个要求：**类/函数尽量无状态**；**状态集中维护，一次变更下游全部跟着变**。
> 结论先说：能做到，但不能做成"一个扁平大对象"。业内成熟做法是 **functional core / imperative shell**：
> 权威状态集中成一个根（game），视图状态与每帧状态各自一个根；系统是无状态函数；UI 是状态的纯派生。
> 三个根 + 资源对象，是"尽量集中"与"实时性能"之间的平衡点。

### 21.1 三条原则

1. **状态只有一个家**：所有权威数据在 AppState.game 里；UI 只读派生结果，不另存一份。
2. **行为无状态**：系统是 (g, dt) → 改 g 的函数；没有 this、没有实例字段、没有跨 tick 闭包缓存。
3. **派生是纯函数**：selector(app) → vm；同一份状态永远得到同一份视图模型；改状态不需要通知 UI，UI 按 rev 自己发现。

**所有权 ≠ 存放位置**：DeckSystem 拥有 hand/deck 的写权限，但数据放在 AppState.game.players[i].deck 里，不放在 DeckSystem 实例上。这样"一个状态变更"才能被所有派生同时看见。

### 21.2 AppState（唯一根）

~~~js
AppState = {
  v: 1,
  game: {                    // 权威，20Hz；一局一个
    rev: 0,                  // 每次权威写递增（粗粒度；域内另有 rev）
    cfg, clock, rng,
    world: { blocks, meta, biomes, lodes, weather, rev },
    players: [PlayerState, PlayerState],
    entities: { summons, projectiles, sigils },
    match: { score, overtime, over, winner, modeState, stats, rev }
  },
  ui: {                      // 视图状态，UI 帧；一次会话
    rev: 0, scene: { id, args, progress }, bag: { profile, page, side, sel },
    filters, detailKey, toast, drag, panels: { open: {} }
  },
  view: {                    // 每帧，非权威
    alpha, camera: { mode, yawSm, servos }, particles, hero, vfx
  },
  session: {                 // 启动级
    phase, config, record, history
  }
}
~~~

- **Runtime（不是状态）**：renderer、scene、camera、textures、audioCtx、DOM 节点、chunk meshes。它们有身份、不可序列化，放进一个 Runtime 句柄，AppState 只存 id/引用。
- **PlayerState**：body / vitals / deck / control / aim（见 §20.8）。
- 存档只序列化 game 的可存字段 + session.config；ui 只存偏好；view 不存。

### 21.3 系统 = 无状态函数

~~~js
GW.Systems.Deck = {
  step(g, dt) { for (const p of g.players) { /* 冷却 */ } touch(g, 'players', 0); },
  draw(g, side, n) { /* 改 p.deck/p.hand */ touch(g, 'players', side); },
  play(g, side, slot) { /* 规则/扣费/结算 */ touch(g, 'players', side); }
};
~~~

- 没有 new、没有 this；所有输入显式传 g。
- 每次写自己的 slice 后调 touch(g, domain, i)：递增 g.game.rev、domain.rev（玩家还递增 players[i].rev）。
- 系统之间只调函数、不 import 实例；第 17 个跨系统方法（MatchOps）要评审。
- 测试：构造一个 GameState，直接调函数断言，不需要 DOM/GL/定时器。

~~~js
// 装配层只有这一条固定管线
const ORDER = [Debug.upkeep, Deck.regen, Movement.applyInput, Mode.step,
               Summon.step, Orb.step, Projectile.step, Deck.tick, Damage.tick,
               Chem.step, Fluid.step, Sigil.step, Lode.step, Scoreboard.step];
function stepGame(g, dt, inputs) {
  g.rev++; g.clock.tick++;
  for (const fn of ORDER) fn(g, dt, inputs);
}
~~~

### 21.4 派生与传播：selector + rev

~~~js
GW.Selectors = {
  hud: {
    key: (app) => [app.game.rev, app.game.players[0].rev, app.ui.rev].join('|'),
    get: (app) => ({ /* 血条/手持栏/顶栏字段，纯函数 */ })
  },
  bag: {
    key: (app) => [app.game.players[0].rev, app.ui.bag.profile, app.ui.bag.page,
                   app.ui.filters.tab, app.ui.filters.el, app.ui.filters.ty, app.ui.filters.q].join('|'),
    get: (app) => ({ profile, pages: [{ key, items, total }], caps })
  }
};
~~~

UI 帧变成：

~~~js
for (const panel of panels) {
  const k = panel.select.key(app);
  if (k !== panel._key) { panel.sync(panel.select.get(app)); panel._key = k; }
}
~~~

- **不再有手写 invalidate 清单**：谁变了由 rev 决定，面板自己发现。
- 每个面板声明 select（一个 selector），_key 是上一帧的 key；key 不变就不重算 DOM。
- 事件总线只发**事实**（damage / kill / cardPlayed）给 stats、音频、VFX、日志；**不用事件驱动 UI 状态更新**。
- 这一条直接消灭 AGENTS 记录过的 bug 类："权威 hand 变了、vm 还是旧的"。

### 21.5 背包只是 selector（示例）

~~~js
GW.Selectors.bag.get(app) = {
  profile: BAG_PROFILES[profileFor(app.session.config, app.game.match.modeState)],
  pages: profile.pages.map((key) => CardSources[key].snapshot(app, 0)),
  caps: profile.caps
};
~~~

- CardSources.deck.snapshot(app, side) 现读 app.game.players[side].deck 并聚合，**不缓存权威副本**。
- 抽一张牌 → touch(g,'players',0) → hud / bag / vitals / hotbar 的 key 同一帧全变 → 全部刷新。
- 这就是用户说的"一个游戏状态更改之后，后面全部都要改"：不是靠人记得调 invalidate，而是**同一个 rev 被所有派生看见**。

### 21.6 场景也是状态，不是对象

~~~js
ui.scene = { id: 'lobby', args: { map: 'island-96' }, progress: 0 };

GW.SCENES = {
  menu:   { panels: ['menu'], pausing: false, pointer: 'free' },
  lobby:  { panels: ['lobby'], pausing: true, pointer: 'free' },
  match:  { panels: ['topbar','vitals','aim','log','toast','hotbar','bag'], pausing: false, pointer: 'lock' }
};
enterScene(ui, id, args) { ui.scene = { id, args, progress: 0 }; ui.rev++; }
~~~

- 没有带字段的 Scene 实例；SceneStack 变成 enterScene/exitScene/frameScene 三个函数。
- 场景切换是 ui.rev++，所有面板重算 key；不需要手动 show/hide 一串。

### 21.7 允许保留状态的清单（其余一律无状态）

| 对象 | 允许保留 | 理由 |
|---|---|---|
| World（blocks/meta/biomes/lodes） | 数据本身 | 36.8 万格，必须原地改 |
| Player/Entity 记录 | 数据本身 | 每 tick 大量写，不能复制 |
| RngStreams | PRNG 内部状态 | 随机流的定义就是有状态 |
| OTSCamera / Servo | view 积分量 | 每帧平滑，属 ViewState |
| UIApp | 调度缓存（lastKey/clock） | 不是游戏数据 |
| Panel | DOM node/tree/refs | 只允许生命周期资源，不允许游戏字段 |
| Channel / Bus | 绑定表/监听表 | 协议对象 |
| Audio/THREE/DOM | 资源句柄 | 不可序列化 |

规则：**除上表外，类里不许出现可变 this.x =**（构造期接依赖不算）。owner_check 增加一条静态扫描：白名单外的 this.* 赋值报行号。

### 21.8 性能边界（为什么不是"每帧克隆一份状态"）

- 不深拷贝：世界是 36.8 万格 Uint8Array，实体是热对象；每 tick 克隆会直接把帧率打穿。
- 用 **rev + 原地改**：selector 只在 key 变时重算；UI 仍按 60ms 节流。
- selector 只产出小数组（≤100 项），不产出世界副本；需要世界的渲染层继续读 world.blocks 和 dirty chunk 集。
- 背包页的聚合是 O(牌数)，只在 players[0].rev 或筛选变化时算一次。
- 每个域一个 rev，避免"改一格地形让背包重算"。

### 21.9 迁移映射（接到 S1–S4）

| 现状 | 目标 | 阶段 |
|---|---|---|
| Match 实例字段（players/summons/score/...） | GameState.game | S1 |
| Match.prototype.* 65+ 方法 | Systems 模块函数 | S2 |
| ViewModel 实例（this.state/build） | Selectors（纯函数） | S3（与 S3.5 一起） |
| H.update / H.invalidate 清单 | H.frame(app) + selector key | S3 |
| Inventory 的 this.state / creative 分支 | ui.bag + BagPanel（§20） | S3.5 |
| Scene 类（enter/exit 字段） | ui.scene + SCENES 描述表 | S4 |
| GameMode 实例 | 纯函数表 step/checkWin | S2/S4 |
| creative.js 的 ST 单例 | game.cfg.debug + ui 派生 | S3 |

兼容：H.update/H.invalidate 保留为薄壳（invalidate 只 ui.rev++），S6 删除；new G.Match 保留为只持 g 的门面。

### 21.10 验收（v1.4 新增）

- **A10 无状态**：白名单外的类没有可变实例字段（owner_check 静态扫描）；Match 不再持有 players/score 等字段；系统没有 this。
- **A11 一次变更、下游全变**：改 p.hand 后**不调用任何 invalidate**，同一 UI 帧内 hud / bag / hotbar / vitals 的 selector key 全部变化并重算；ui_check 增加这条断言。
- **A12 单一根**：state_probe 只从 AppState 打印七域（六域 JSON + Render 字段清单）；除白名单外没有第二份游戏状态。
- **E10**：新 UI 面 = 1 个 selector + 1 个 panel spec（≤2 文件），不改调度器。

### 21.11 代价与风险（如实）

| 风险 | 说明 | 缓解 |
|---|---|---|
| "集中"被做成"一个扁平大对象" | 世界数组、实体、资源不能塞进同一层 | 三个根 + Runtime 句柄；允许保留状态的清单（§21.7） |
| selector 失效漏算 | key 少写一个 rev 就永远不刷新 | key 由 selector 自报 + state_probe 打印 key；ui_check 断言"改权威不调 invalidate 也刷新" |
| 调试变难 | 不知道谁改了状态 | touch 记录 {domain, i, by} 环形日志（dev 模式）；state_probe --trace |
| 性能 | 每帧全量派生 | key diff + 60ms 节流 + 域级 rev；背包只在玩家 rev 变时算 |
| 迁移期双轨 | 旧 invalidate 与新 key 混用 | S3 只换 HUD/背包，保留 H.invalidate 薄壳；S5 清掉 |

> 一句话：**状态集中是为了"改一处、处处看见"；无状态是为了"同一输入永远同一输出"。两者合起来才是可组合、可测试、可回放的游戏逻辑。**


---

## 22. 实施状态（2026-10-17，refactor/systems 分支）

| 条目 | 状态 | 证据 / 差距 |
|---|---|---|
| A1 组合扩展 | **是** | effect-spec 规范化 76 张卡；**27 个效果原子**在 js/rules/effects/ 逐个注册，rules 的 effect switch 只剩 setBlock/cells；cells 端到端可建墙/铺板（spec_cast 9 条）；卡数据保持旧 op 兼容 |
| A2 确定性 | **是** | 同一 400 tick 脚本与基线逐字节一致（S2 全程）；三种子哈希可复跑 |
| A3 门禁 | **是（有既有红）** | cards 67 / hit 44 / hand 24 / chem 34 / vfx 71 / bag 23 / selectors 16 / scene 11 / effect 10 / stats 9 / owner --strict / layer；ui 132 / creative 53；audit 490706、88092 通过，31337 C4/H 与基线一致 |
| A4 体积 | **部分** | Match 从 69 个原型方法降到约 30（多为一行转发）；≤15 自有方法未达，效果类方法仍在 |
| A5 双写 | **是** | owner_check 按域白名单，--strict 0 越界（116 处直接写全部有主） |
| A6 场景 | **部分** | ui.scene + SCENES + start 三段 + SessionRunner；Lobby/选图/loading 分帧未做 |
| A7 兼容 | **是** | 老 API / 卡数据 / 存档 v1 / 探针入口保持；ui_check 132 覆盖真页面 |
| A8 背包分版 | **是** | CardSource/BagProfile；生存牌库/弃牌堆只读页；页签由 profile 驱动 |
| A9 状态域 | **基本** | AppState 单根 + state_probe；HUD 顶栏/players/hands/discard 已由 Selectors.hud 翻译，ViewModel 只做装配 |
| A10 无状态 | **部分** | 9 个系统是无状态函数；Match 门面仍持字段（S 仍是运行时句柄） |
| A11 传播 | **基本** | selector key 在测试中证明“改一次手牌 → hud/bag 同帧变”；HUD 已实接，背包面板仍用 vm.bag 结果 |
| A12 单根 | **是** | AppState {game, ui, view, session}；Scene 订阅写 ui.scene |
| S6 目录搬移 | **未做** | src/ 是并行重构线的落地区，搬移会与它冲突；登记为后续单独立项 |

**结论**：行为级拆分（系统、状态根、背包、场景、统计、量具）已落地并每步验证；剩余是“rules 消费 AtomicOp”“HUD 全量改读 selector”“Lobby/选图”和“src 机械搬移”，都不影响当前双击可玩与既有门禁。
