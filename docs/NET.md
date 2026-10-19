# 联机对局设计（房主权威 · 局域网先跑通）2026-10-17

> 用户 2026-10-17 决定：跟 AI 打没意思，要真人对局才能真正验出这套占矿玩法好不好玩。
> 两个选择由用户拍板：**先做两台电脑同一局域网**；权威模型选**房主权威（host 说了算）**。
> 我（机制线）保留两条硬性设计要求，写在下面 §3 与 §4——它们不是偏好，是漏掉就会出事的洞。

## 1. 复用现有资产（这套引擎本来就为联机留了口子）

| 已有 | 对连线的意义 |
|---|---|
| `Match.step(dt, inputs)` 是唯一权威推进，AI 与真人共用同一条指令流（`src/net.js`） | guest 只要能把"指令"送进同一个通道，游戏逻辑一行不用改 |
| 同 seed 逐格可复现（`play_probe` 的 H1 每轮都验，地形/洗牌/掉落共用一条 mulberry32） | guest 拿到 seed 就能本地重建同一张世界，不必传体素 |
| `save.js` 已是「seed + 与基线的差异格」 | 世界状态的线上表示直接复用这个 diff，体积从 36 万格降到几十格 |
| 渲染位置走 `ppos → pos` 插值（`snapshotPrev`/`renderPos`） | **校正时的跳变可以摊成几帧**，不需要引入回滚机制（见 §3） |
| `worldHash` 与 `play_probe` 的确定性断言 | 两端是否跑偏有现成的机检手段 |

## 2. 形态与进程拓扑

- **房主起一个零依赖 node 进程**：`node tools/net_host.cjs`（手写 RFC6455 握手，不许 npm install，仓库唯一第三方仍是 `vendor/three.min.js`）。
  它同时是①WebSocket 服务端②配对大厅（房间码）③房主页面的上游。房主页面连 `ws://127.0.0.1:<port>`，挑战者页面连 `ws://<房主 IP>:<port>`。
- **房主页面是唯一权威**：只有它跑 `Match.step` 并广播快照；挑战者页面只发指令、收快照、做本地预测与校正。
- 双击 `index.html`（file://）能不能直接联机，取决于 `file:// → ws://` 是否被 Chromium 放行——**这是 NET-spike 正在验的第一道闸**，
  结论没回来之前，本设计假定需要 `node tools/net_host.cjs` 顺带同源服务一份页面（spike 会给出实测答案，不猜）。

## 3. 校正方式：快照覆盖，不做回滚重放（我这条不退）

- 房主权威最常见的实现是"客户端预测 + 收到权威状态后回滚重放"。本项目**不走**：回滚要改历史输入序列、还会与 20Hz 权威 tick 抢时间线，
  属于最容易把确定性搞坏的那类改动，而且我们已经把"视觉量不许写回权威状态"立成规矩，再叠一套回滚只会更难查。
- 改成：guest 本地照常预测（按最后已知速度插值移动实体），每收到一份快照就**整表覆盖权威字段**（hp/mana/shield/mats/score/实体 pos/vel/存活/矿归属/抛射物），
  然后立刻 `snapshotPrev()` 把覆盖前的位置记成 `ppos`，让**现有的渲染插值把跳变摊成几帧**。视觉上等价于回滚，实现上没有历史重放。
- 指令不做预测性消费的例外：出牌、挖建、伤害一律等房主裁决（沿用现在的 `Rules.canPlay` 拒付路径与 `ui:notify` 演出），
  所以不需要"猜中了怎么改回来"这类分支。代价是操作延迟 = 往返 + 下一 tick，实测多少由 N2 的量化验收给，不拍脑袋。

## 4. 信息隔离：guest 不许看到对方手牌（漏了就是功能缺陷）

- 房主权威下若直接 `JSON.stringify(match)` 广播，**对方手牌、牌库顺序、法阵候选池会全裸**——现在 Match 里这些就是普通字段。
- 因此序列化必须是**按观看者过滤的函数**：`serializeFor(match, viewerSide)`，白名单制，不是黑名单制：
  允许实体 hp/坐标/速度/存活/护盾/分数/矿归属/抛射物/随从/弃牌堆/双方**手牌张数**；
  禁止 `p.hand` 内容、`p.deck` 顺序、`p.pendingPick` 候选卡。默认字段不存在即不发送。
- 出牌指令只带**手牌下标 + 瞄准**，不带卡 id；卡 id 由房主解析（本来就如此，`p.hand[i]` 是 id，见事实页）。
- 这条要有机检：`tools/net_check.cjs` 里做"把 guest 收到的每一帧快照递归扫一遍，出现对方手牌里的卡 id 即失败"，
  并且用一对已知不同的手牌做正例（不能出现"因为都是空所以通过"的假绿）。

## 5. 协议（草案，N2 冻结后不许随意加字段）
   （v4 在 N5 追加的三条帧型 —— loadout / lobby / start —— 见 §10.3；这张老表一字未动。）

| 帧 | 方向 | 内容 |
|---|---|---|
| `hello` | guest→host | `{ver, name, side}`；版本不符直接拒绝并说明，不许静默错配 |
| `joined` | host→guest | `{seed, rulesOpts, side}`；guest 用同一 seed 本地重建世界（H1 保证逐格一致） |
| `input` | guest→host | `{tick, keys, play?, aim?}`；与 `KeyboardSource` 产出的形状完全一致 |
| `snapshot` | host→guest | `{tick, world:diff, view:serializeFor(...)}`，默认 10 tick（0.5 秒）一份，拥塞时降到 2Hz |
| `event` | host→guest | 只播"该被看见的"：命中、爆炸、法阵、矿易主、得分变化（走 VFX 配方名，不带数值细节） |
| `bye`/`timeout` | 双向 | 明确原因；房主掉线则 guest 收到 `host-gone` 并停在结算画面，不许卡在暂停或黑屏 |

## 6. 分刀与验收口径（不打包，一次一刀）

- **N1 spike**（已在跑，`docs/TASK_NET_SPIKE.md`）：只验 `file:// → ws://` 是否放行 + loopback 往返延迟 p50/p95/max + 断线检测时限。结论没回来不写实现。
- **N2 传输层**：`tools/net_host.cjs`（零依赖 WebSocket + 配对 + 心跳）与 `src/net-ws.js`（连接/重连/帧编解码）。
  验收：1000 帧往返延迟表、断线 2 秒内被发现、协议版本错配被明确拒绝。
- **N3 权威同步**：`serializeFor` + guest 侧覆盖与 `snapshotPrev` 吸收跳变 + seed 下发。**这一刀才有真人对局**。
  验收：两端 `worldHash` 与房主一致（每 5 秒抽一次，漂移即红）；guest 侧"校正次数/最大校正距离"报数，不许只报"能玩"。
- **N4 大厅与入口**：菜单加"创建对局 / 加入对局（填 IP+房间码）"，并把 `index.html` 里缺的三个 `script` 一并挂上
  （`src/lode-planter.js`、`src/reachability-gate.js`、`src/lode-system.js`——这是机制线欠账，一直挂着 L5 红条）。
  **菜单文案属 UI 线**：意图先登记进 `src/ui/channel.js` 的 `INTENTS`，人话进 `H.TEXT`，我不替他们写中文。
- **N5 真机两人**：两台机器实打 10 局的量化记录（延迟、校正、掉线行为、以及**这次终于能测的**：真人会不会主动去抢第二条矿）。
  这一刀同时回填 `docs/GAMEPLAY.md` §6 那条"终局可达性"——AI 组测不出来的东西，真人对局才有答案。

## 7. 明确不做（避免范围滑走）

- 不做公网穿透/NAT Traversal、不做账号与匹配、不做防作弊加密与反外挂（房主权威 + 明文协议，先让朋友能玩）。
- 不做服务器权威回滚重放（理由见 §3）。若将来要抗房主作弊，那是另一个设计题，别在这条路上顺手改。
- 分屏（按 T）保留：它是同机验证两端一致性的手段，不是联机的一部分。
## 8. NET-spike 实测回填（2026-10-17，机制线独立复跑过）

- **`file:// → ws://` 能连**：两个 file:// 页面直连本机 ws、房间码配对、互转 1000 指令帧，console 零拦截
 （混合内容 / CORS / 协议限制 / 用户手势四类都没触发，服务端日志 `origin=file://` 为证）。
 → §2 那句"取决于 spike"可以定案了：**双击 index.html + 本机 `node tools/net_host.cjs` 这条零依赖路线成立**，
   不需要为了联机改成 http 起服务（http 同源也实测能连，只作未来某版 Chromium 改口时的兜底）。
- 延迟（headless + SwiftShader，**系统性偏高，真机必复测**）：client↔server RTT p50 20–34ms / p95 39–90ms；
  端到端 A→B→A p50 41–70ms / p95 65–147ms，另有约 1 秒的偶发毛刺。
- 断线：SIGKILL → 服务端 5–80ms 判死（ECONNRESET/EPIPE）；SIGSTOP 整组冻结 → 1.9–2.2 秒心跳超时判死；幸存者不受牵连。
- **一条必须记住的坑**：Chromium 的协议层 pong 由 network 进程应答，renderer 冻结时协议 pong 照样回——
  所以**抓"画面卡死"必须靠应用层心跳**（页面定时自报 tick/帧号，超时即判僵）。spike 实测里 freeze renderer 时协议心跳测不到，这是证据。

### 对 spike 那句"锁步 3 tick 起步"的更正（与用户拍板的权威模型冲突，以本节为准）

spike 的报告写的是"20Hz 锁步缓冲 3 tick（150ms）覆盖全部 p95"。**数字可用，措辞要改**：
锁步（等双方指令齐才推进 tick）与房主权威是两条互斥路线，用户已经拍板房主权威，所以 3 tick 在本文里不是"锁步缓冲"，
而是**guest 本地预测的外推上限**：超过 3 tick 没收到房主快照，guest 就停止外推、按最后已知速度定住并等重同步（而不是无限预测下去）。
这条恰好接住那个 1 秒毛刺——毛刺期间不许 guest 继续预测成"穿墙"，宁可定住。
缓冲终值等真机两人复测再定（N5），headless 的 150ms 只是起点。
## 9. N3 / N4 落地口径（2026-10-18 定，实现以此节为准）

N1/N2 已交付并全绿（`tools/net_host.cjs` 零依赖 WebSocket、`src/net-ws.js` 的 Connection/SeqChan/serializeFor、`tools/net_check.cjs` 30 条）。
本节把剩下的 N3（权威同步）与 N4（大厅入口）按现有代码落到可实现的粒度。

### 9.1 拓扑与身份

- 房主页面 = 唯一权威：照常用 `Match.step(STEP, inputs)` 推进；`inputs[0]` 来自本机键盘，`inputs[1]` 来自 guest 的 input 帧（经 `RemoteInputSource` 排队，一 tick 消费一次，缺帧 = 空输入）。
- guest 页面 = 薄客户端：**不跑 `Match.step`**。它用同一个 seed 本地重建世界（`opts.lodes` 按关卡配置），建一个镜像 `Match`（只为 HUD/相机/渲染有对象可读），每收到快照就把权威字段整表覆盖。
- **本地视角恒为 side 0（关键约定）**：guest 在协议上是 side 1，但它的镜像里 `players[0] = 自己`、`players[1] = 房主`；`applyToGuest` 负责 1↔0 互换（玩家、随从、抛射物、法阵、矿归属、`over.winner`）。这样相机/HUD/手持栏/输入全都不用改。
- 房主发快照按 `viewerSide = 1` 过滤（`serializeFor`），guest 只拿到自己的手牌内容、对方手牌张数。

### 9.2 同步内容（每 2 tick = 10Hz 一份）

`{type:'snapshot', tick, time, view, cells, draft, over}`

- `view`：`NetWs.serializeFor(match, 1)`，本轮扩字段（**只增不改**）：玩家 `status`(st)/`respawn`/`invuln`/`handClass`/`cooldown` 不需要，先不发；随从补 `aiKind/name/h/yaw/ttl/st`；抛射物补 `color`；法阵补 `presetId/born/delay/active/dead/triggered/radius/preset.hidden`。
- `cells`：房主自上次快照以来改过的格子 `[[x,y,z,id],…]`，由 `world.set` 的 `G.WORLD_HOOKS.onSet` 记录（**只在房主**挂），每次快照后清空。guest 直接 `world.set` 写入。
- `draft`：当房主队列里有 `side === viewerSide` 的三选一时发 `{side, source, biome, options}`；没有则 null。
- `over`：`match.over`（原样），guest 收到后进结算。

`{type:'input', tick, keys:{fwd,back,left,right,jump,crouch,cast}, yaw, pitch}`（guest→host，每 tick 一条）

- 朝向发**绝对角**：guest 的鼠标/键盘转向已经作用在本地镜像的 `players[0]` 上，房主收到后直接 `p.yaw/pitch = …`（clamp 到 `G.LOOK_LIMIT`）。出牌 `cast` 是手牌下标（不带卡 id）。

`{type:'draftPick', cardId}` / `{type:'draftSkip'}`（guest→host）

- 房主用 `match.takeDraft(1, cardId)` / `skipDraft(1)` 处理；回执走下一份快照（手牌与次数变化可见）。拒绝不回包，guest 的面板在下一次快照里仍挂着。

### 9.3 guest 的每 tick 做什么（main.js 的分支）

1. 轮询本机 `KeyboardSource` → 发 input；`cast` 只发不本地执行（出牌一律等房主裁决，NET §3）。
2. **外推自己**：`players[0].pos += vel * dt`（最多连续 3 tick = 0.15s，超过就定住等重同步），不做碰撞（下一份快照会纠）。
3. 不 step `Match`、不 step `WEATHER`/`CHEM`；`match.time/tick` 由快照推进。
4. 收到快照：`snapshotPrev()` → 覆盖 → `touch('players', side)` 让 HUD 失效；`p.vel` 保留给外推。

### 9.4 世界 diff 与 chem

- 房主挂一个 onSet 记录器（`NetMatch.makeWorldTracker(world)`），每快照 drain 一次；超过 4000 格/份就整轮不发（防止一次性卡死），并在下一次快照补发全量 diff（`Save.exportFrom(world).cells`）。
- guest 应用 diff 时 `world.set` 会触发它自己的 chem 钩子——guest 不跑 `CHEM.step`，所以只唤醒不入队，稳态零成本。
- guest 的 `world.baseline` 与房主同 seed 生成，逐格一致（H1 保证）；diff 应用后两边 `worldHash` 应一致，由 E2E 每 2 秒抽一次。

### 9.5 入口（N4）

- 选关界面的「联网 PVP」不再 toast：选中后出现三个字段——**服务器**（`ws://127.0.0.1:8787`）、**房间码**、**角色**（创建房主 / 加入对局）。
- 房主先在本机跑 `node tools/net_host.cjs 8787`（打印 `PORT …`）；房主页面连 `ws://127.0.0.1:8787`，挑战者连 `ws://<房主 IP>:8787`。
- 两个页面都用**本目录的 index.html**（file:// 双击即可，NET §8 已实测 file://→ws:// 放行）。
- `start(cfg)` 在 `mode==='net'` 时先建 `Connection`：房主收到 `joined` 后用本地 seed 开局并开始发快照；guest 收到 `joined` 的 `seed/config` 后建世界与镜像再进主循环。连接失败 / 房子不存在 / 版本不符都**明说**（`H.TEXT`），不假装开局。
- 掉线：guest 收到 `bye reason=host-gone` → 停主循环、弹提示、结算面板显示「对手已离开（房主掉线）」；host 收到 `guest-gone` → 同样结算（对手离开）。

### 9.6 明确不做（v1）

- 不做 guest 侧的出牌预测、不做回滚重放（NET §3 不变）。
- 不做事件帧（命中/爆炸特效）——guest 只看到快照带来的状态变化，特效比房主少；这是 v1 的已知差距，写在 [../DEVLOG.md](../DEVLOG.md) 第十三轮。
- 不做 NAT 穿透/公网、不做账号匹配、不做房主作弊防护。

### 9.7 验收（谁拦）

| 断言 | 工具 | 判据 |
|---|---|---|
| 快照往返：apply 后玩家/矿/随从/抛射物/法阵与房主一致 | `tools/net_sync_check.cjs`（新） | 逐字段比；对方手牌与牌库顺序不出现 |
| 世界 diff：房主改格 + chem 反应，guest 应用后 `worldHash` 相同 | 同上 | 逐格比 |
| input 编解码：keys/cast/yaw/pitch 往返不丢字段、clamp 生效 | 同上 | 形状与边界 |
| 三选一：只有自己的 offer 出现在快照里；pick 在房主侧落到 side 1 | 同上 | 队列/牌库/次数 |
| 两端真跑一局：互相看得见移动、guest 出牌生效、地形一致、掉线有交代 | `tools/net_e2e.cjs`（playwright，两个真页面） | E1 身份/尺寸/房间码；E2/E3 双向位移 >1 格；E4 六格 diff + 两端 Save 格数；E5 空槽 + 手牌 id 双通道不外泄（带正例对照）；E6 三选一真鼠标点得动；E7 掉线出结算 |
| 传输层不回归 | `node tools/net_check.cjs` | 30 条（版本闸跟着 `PROTO_VER` 走：v3=N2/N4，v4=§10 战前选牌） |
| 画面卡顿不许当对手离开 | `node tools/net_e2e.cjs` 的 E8 | 阻塞一页主线程 1.5 秒后两端 `match.over` 仍为 null、不进结算面板 |
| 战前选牌（牌库判据 / 三条新帧型 / 两端各拿自己那副 / 记分板一致） | `tools/loadout_check.cjs` + `net_e2e.cjs` 的 E9/E10 | 判据与量具见 §10.6 |

### 9.8 落地状态（2026-10-18）

- **N1–N4 已落地**：`src/net-ws.js`（Connection/SeqChan/serializeFor）、`src/net-match.js`（makeSnapshot/applySnapshot/applyCells/外推/encodeInput）、
  `tools/net_host.cjs`（零依赖 RFC6455 + 房间码配对 + 按角色转发 + 双道心跳，`PROTO_VER` 现为 4，v4 见 §10）、选关里的联网入口（服务器/房间码/角色三字段）。
  两条循环（房主权威 step + 广播；guest 只发指令 + 外推自己 + 整表覆盖）在页面上真跑通。
- **验收命令**：`node tools/net_e2e.cjs`（默认 E1–E10；`--core` 跑 E1–E7 与 E9，不起 E8/E10 那两对页面）。配套量具：`node tools/net_check.cjs`（传输 30 条）、
  `node tools/net_sync_check.cjs`（打包与覆盖的纯逻辑 71 条）、`node tools/loadout_check.cjs`（战前选牌 52 条，§10.6）。
  各管一段、不互相替代：传输 → 打包/覆盖 → 牌库判据与选牌路由 → 两端真跑。
- **N1–N4 的验收状态**：E1–E8 在 seed 490706 / duel-64 / ranked 上串行全绿，net_check / net_sync_check / layer_check / play_probe 同时全过。
  按本文件的规矩这里不缓存某一天的红/绿 —— 具体数字（位移格数、diff 到位毫秒、弹出与落地毫秒）看 [../DEVLOG.md](../DEVLOG.md) 的
  「联机对局（局域网，房主权威）」一节，红/绿一律以脚本输出为准。
- **「卡顿」与「掉线」分开（2026-10-18 已修，E8 守着别退回去）**：`timeout reason=peer-stalled` 只意味着对端画面卡了
  （`tools/net_host.cjs` 的应用层心跳判死线 1 秒；SwiftShader 下一页主线程被拖 1.5 秒就会中招，真机切窗口/长 GC 同理）。
  装配层现在只 toast（`H.TEXT.net.stalled`）并记 `S.net.peerStalled`，**不结算**；`peer-unstall` 再提示恢复。
  真掉线由 `bye host-gone/guest-gone`（服务端判 TCP 死/close 帧后发）负责，那条仍然进结算。
  **不许为了让 E8 变绿而放松判据**；§9.6 的「不做事件帧」仍是 v1 的已知差距（guest 无命中特效），不是缺陷。

## 10. 战前选牌（协议 v4 · N5；2026-10-18）

一刀只加三样：三条帧型、一段状态机、一份随快照下来的记分板。§9 的连接 / 快照 / 镜像三条线一行语义没动
（`src/net-match.js` 与 `src/net.js` 因此一行没改；快照里多出的 `board` 字段由装配层挂上，不在打包层）。

### 10.1 为什么要有这一页

房主权威模型里牌库是**玩家自己的构筑**。v3 之前两端各自 `makeDeck(cfg.deck)`，于是"联机"实际是
"两个人各拿系统发的同一副牌"——构筑这件玩法核心从来没进过链路。战前选牌补的就是这一段：
双方各选 12 张，房主这个收货方校验通过才开局。

### 10.2 状态机（谁在什么条件下才准进 match）

```
连接 ──joined──▶ loadout（选牌）──双方 ready──▶ start ──▶ match
                     ▲   │
                     └───┴── lobby（谁就绪了 / 为什么被退回）
```

- **host**：`joined` 到 → `phase='loadout'`，**不建世界、不建对局**（牌库没齐就没有这一局）；
  `peer-joined` → 状态行只报"等待对手选牌"（就绪不在这条上说）；
  `loadout` 帧 → `G.NetLoadout.validateDeck` 合法且 `ready===true` 才收下 `guestDeck/guestReady`，非法一份都不留；
  自己点就绪 → `selfReady` + 广播 `lobby`；
  两条都 ready，且**两份牌库当场重新过一遍 `validateDeck`** → 发 `start` → `netEnter`。
- **guest**：`joined` 到 → `phase='loadout'`；点就绪 → 发 `loadout{deck, ready:true}`；
  `lobby` → 更新状态行，带 `reject` 就把"已就绪"这个承诺收回（改完牌要重按一次）；
  `start` → 把 decks 按**本地视角 1↔0 换位**（side 0 恒是自己，§9.1）→ `netEnter`。
- 三条硬规矩：
  1. 双方没都就绪，谁都不进对局 —— 房主不提前建局，guest 没收到 `start` 不自己开（§9.5「不许假开局」）；
  2. 判据只有一处：`src/net-loadout.js` 的 `validateDeck`（整副 12 张 / 同一张 ≤2 份 / id 必须存在于卡表 / 地形卡 ≥4，
     这是挖掘游戏，不带挖掘卡是非法构筑 —— [ROUTER.md](ROUTER.md) §2 原话）。界面判的是同一份常量；
  3. 三条上限的真源在 `src/ui/viewmodel.js`（`UI.LOADOUT_RULES`），`net-loadout.js` 里那份同名默认值只是
     node 量具的兜底；两边漂了由 `tools/loadout_check.cjs` 的 L0 当场打回（"界面写一套、房主判另一套"是最难查的那种）。

### 10.3 三条帧型（接在 §5 那张表之后）

| 帧 | 方向 | 内容 | 谁校验 |
|---|---|---|---|
| `loadout` | guest→host | `{deck:[cardId…], ready:bool}`；重复发送取最新，未就绪时 `deck` 可为空 | 房主（收货方）`validateDeck`；非法回 `lobby` 带 `reject` |
| `lobby` | host→guest | `{hostReady, guestReady, waiting, reject?}` | guest 只更新状态行，不改任何权威状态 |
| `start` | host→guest | `{seed, config:{map, rule, game}, decks:[hostDeck, guestDeck]}` | 缺 `decks` 的 start guest 直接忽略（宁可不进局，不拿残缺信息自建一个局） |

- `hello` 的 `config` 从 v4 起多带一项 `game`（`{id, target}`，[MODES.md](MODES.md) §6）：两端玩法与胜分必须同源，
  否则积分榜的行序与目标线各画各的。服务端只原样转存，不认识关卡也不认识玩法。
- `decks` 是**房主视角**的固定顺序 `[房主, 加入者]`；guest 侧换位成 `[自己, 对方]` 才交给 `session.buildMatch`
  （`cfg.decks` → `Match opts.cards`）。这条换位是 E9d 的判据：写反了 guest 的手牌会从房主那副里发出来。
- 角色路由服务端与客户端各判一次（不信任传输）：`loadout` 只 guest→host，`lobby`/`start` 只 host→guest；
  未知帧型仍只 log 不透传。
- 拒绝只报 key（`count / terrain / copies / unknown / empty`），中文一律在 `src/hud.js` 的 `H.TEXT.loadout`；
  `NetLoadout.SIGNATURE`（排序后的牌库指纹）只进 console，用于"双方同构筑"这条查案线索，不进界面。

### 10.4 信息隔离在这里的延伸（§4 那条最容易踩的地方）

- 双方牌库的**内容**只存在于三处：自己的视图状态、交给房主的那一帧、房主的权威 `Match`。
  `serializeFor` 没动，所以线上依然不会出现对方的牌库顺序（E5 继续守着）。
- guest 本地 `players[0].deck` 是 `new Array(deckCount)`（长度占位、内容不外泄），所以"自己牌库的第一个元素"
  只能从**本机交出去那份**读 —— `window.__GW_NET().deck` 就是这个取数口（E9c/E9d 用它）。
  别把它误当成泄漏：那是本页自己写的牌库，不是对方的。
- 改牌 → 就绪作废：视图层 `H.loadoutPick` 收界面那份 ready，装配层 `netInvalidateSelf` 收线上那份
  （guest 还补发一条 `ready:false`，房主据此收回 `guestReady`）。少做任何一半，房主都会拿一份旧牌库开局。

### 10.5 记分板（board）随快照下来

guest 不跑 `Match.step`，因而也不跑 `kill` / `director.tick` / `lodePoints` 三个钩子 ——
kills / deaths / 目标线 / 时限 / 加时这几项**它自己永远算不出来**，只能抄房主的账：

- 房主每份快照带一份 `msg.board = match.director.snapshot()`（装配层挂上，纯数字与阶段名，一个卡 id 都没有，
  所以 §4 的隔离判据不受影响；没挂 director 的老路径压根不带这个字段）。
- guest 侧 `G.MatchDirector.apply(director, msg.board, true)` 按 side 0 = 自己**换位覆盖**，
  `displaySpec()` 仍是唯一显示来源（§9.2 那条不退，本函数只改账、不改显示）。
- 三条边界：分数仍读 `players[].score`（`applySnapshot` 覆盖过，`board.scores` 只作核对，不在这里写第二遍）；
  phase 只单向前推（房主 `ended` 即 `ended`，一份迟到的 `live` 不许把本地拉回 `live`）；
  `timeLeft` 反推 `elapsed`，`startedAt` 保留本地那一刻（guest 没有自己的钟在跑，时间这件事上房主说剩多少就是多少）。

### 10.6 谁拦（新增/改这一页时必须跑的）

| 断言 | 工具 | 判据 |
|---|---|---|
| 新逻辑层的分层纪律与载入（layer_check 的文件清单不含它） | `tools/loadout_check.cjs` L0 | 零 DOM / 注释外零中文 / 不反手抓视图层；script 顺序 cards→loadout→main；兜底数字 == `UI.LOADOUT_RULES` |
| 牌库六条判据与判序 | 同上 L1 | 12 张→ok 且 terrain≥4；11/13→count；地形 3→terrain；同一张 3 份→copies；未知 id→unknown；空→empty（先张数后未知、逐卡扫时陌生卡与第三份按出现顺序报） |
| 脏牌库夹回合法形状 | 同上 L2 | 去未知 → 夹到 2 份 → 截到 12；同输入两次逐字相同（无随机无时钟） |
| 三条新帧型的角色路由 | 同上 L3 | 真 `net_host` 两席：正例三条 + 三条负例（自己的帧不许回自己），外加未知帧型不透传 |
| `session` 的 `cfg.decks` 分支 | 同上 L4 | 静态含 `cfg.decks` 且 `cards: decks`；真 `G.Match` 用两份 12 张开局 → hand+deck+discard=12、牌库第一位原样、手牌 ⊆ 自己那副；不传 cards 时退回 `STARTER_DECK` |
| 两端各拿自己那副牌开局 | `tools/net_e2e.cjs` 的 E9 | 双方就绪 → 两端 ≤3 秒进局；两端 `hand+deck+discard=12`；两份牌库第一个元素不同（火组 vs 冰组）；手牌 ⊆ 自己那副；**房主权威侧**的加入者 `deck[0]` == 加入者自己交出去那份；两端同 seed |
| 积分榜两端一致 | 同上 E10 | 房主 `kill()` 一次 → guest 的 director 百毫秒级镜像成 `kills[1]=1`；`displaySpec` 的 rows 顺序与 target 两端相同、数值互为镜像；累计 5 杀 → 两端都出结算、`winReason='score'`、`over.winner` 互为镜像 |
| 就绪之后改牌不许拿旧牌库开局 | 人工回归（`__GW_LOADOUT_AUTO` 走的是同一条 `H.loadoutPick`/`H.loadoutReady`） | 点就绪 → 改一张 → 房主状态行回到"等待对手选牌"、`start` 不许发出 |

- **落地状态（2026-10-18）**：`src/net-loadout.js`（新，纯逻辑）、`src/main.js` 的 net 段（两段式开局 + board 收发）、
  `src/app/session.js`（`cfg.decks`）、`src/app/match-director.js`（只加一条静态 `apply`）、
  `src/net-ws.js` / `tools/net_host.cjs`（`PROTO_VER` 3→4 + 三条帧型路由）、`index.html`（多一条 script）、
  `tools/net_check.cjs`（期望版本 4）、`tools/net_e2e.cjs`（E1–E10 + `openPair` 走选牌）、`tools/loadout_check.cjs`（新）。
- **已知差距（诚实）**：guest 的结算面板里"P1/P2 得分"两格读的是本地 `MatchStats.perSide`，而 guest 不跑
  `addScore`，那两格在 guest 侧恒为 0/0 —— 击杀/死亡两行走的是 §10.5 的 board，是对的。
  这条属于结算面板的数据来源（`src/hud.js` + `src/net-match.js` 的统计字段），不在 N5 的范围里，未修。
  §9.6 的「不做事件帧」（guest 无命中特效）与「不做预测/回滚」（guest 出牌等一个 RTT）也照旧。

