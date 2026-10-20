# 任务 N1 · 权威同步的纯逻辑层（net-match）+ 序列化扩字段 + 单测

先读：`docs/NET.md` §9（本任务只做 §9.1/§9.2/§9.3 的纯逻辑部分）、`src/net-ws.js`、`src/net.js`、`src/battle.js` 的 `renderPos`/`snapshotPrev`。
只允许修改：`src/net-ws.js`、`src/net.js`，并新建 `src/net-match.js`、`tools/net_sync_check.cjs`。
**不许**碰 DOM / 文案 / main.js / session.js / index.html；不许 git commit；不许改任何既有断言。

## 要做的事

1. `src/net-ws.js` 的 `serializeFor` **只增字段**（既有字段不改名不改义）：
   - 随从：补 `uid/aiKind/name/h/yaw/ttl/st`（`st` 只挑 truthy 的键，别把函数带出去）；
   - 抛射物：补 `uid/color/entKind`；
   - 新增 `sigils` 数组：`{uid, kind, presetId, pos, radius, born, delay, ttl, active, dead, triggered, side, hidden}`；
   - 玩家：补 `respawn`、`status`（`p.st` 的浅拷贝）、`cd`（不给，跳过）；手牌/牌库/弃牌的规则不变（自己手牌内容、双方张数、对方手牌不出现）。
2. `src/net.js` 新增 `RemoteInputSource`（与 `KeyboardSource`/`AISource` 同一种产出）：
   `new RemoteInputSource()`；`source.push(msg)` 把一条 `{keys,yaw,pitch}` 入队；`poll(dt)` 每 tick 取一条（没有 = `G.blankInput()`）并带上 `lookYaw/lookPitch = 0`。
   另给 `RemoteInputSource.applyTo(p, msg)`：把 `msg.yaw/pitch` clamp 到 `G.LOOK_LIMIT.yaw/pitch` 后写到玩家身上（朝向是绝对角）。
3. 新建 `src/net-match.js`（`window.GW.NetMatch`，零 DOM、零文案、零 THREE）：
   - `makeWorldTracker(world)` → `{ drain(), size(), detach() }`：往 `G.WORLD_HOOKS.onSet` 推一个记录器，按 `x,y,z` 覆盖写最新 id；`drain()` 交出 `[[x,y,z,id],…]` 并清空；`size()` 给上限判断；`detach()` 摘钩子。
   - `applyCells(world, cells)`：逐格 `world.set`；非法坐标跳过。
   - `makeSnapshot(match, viewerSide, tracker)` → `{tick, time, view, cells, draft, over}`：
     `view = G.NetWs.serializeFor(match, viewerSide)`；`cells = tracker ? tracker.drain() : []`；`over = match.over`；
     `draft` = `match.pendingDraft()` 里 `side === viewerSide` 的那条（没有就 null，只带 `{side,source,biome,options}`）。
   - `applySnapshot(mirror, snap)`：**先 `mirror.snapshotPrev()`**，再按 §9.1 的 1↔0 互换写回：
     玩家（pos/vel/hp/maxHp/shield/alive/score/mana/mats/kills/respawn/st；`hand` 只有自己那侧有，写到 mirror 的 side0；
     `deck` 用 `new Array(deckCount)` 占位——牌库顺序连自己都不许看；`discard` 原样）、
     矿归属 `owner < 0 ? -1 : 1-owner`、`over.winner` 互换、`time/tick`、法阵/随从/抛射物按 uid 对账（见下）。
     写完后 `mirror.touch('players', 0)` + `mirror.touch('players', 1)`，返回 `{ok:true, tick}`。
   - **uid 对账（不许每份快照重建整个数组，否则网格池每 100ms 重建一次）**：
     按 `uid` 建 Map；已有对象就地改 `pos/vel/hp/alive/…`；新 uid 用 `G.baseEntity` 造最小实体（随从要有 `h/aiKind/yaw/st/ttl/name`；抛射物要有 `entKind='projectile'/color`；法阵要有 `preset`（由 `G.SIGILS[presetId]` 取，取不到就丢弃该条）/born/delay/ttl/active/dead/triggered/radius`）；快照里没有的 uid 从数组移除。
     新实体的 `ppos` 设为与 `pos` 相同（`renderPos` 需要）。
   - `extrapolate(mirror, dt, localSide, budget)`：只外推 `localSide` 那位玩家的 `pos += vel*dt`（不做碰撞），连续外推超过 `budget` 秒（缺省 0.15）就定住（`budget` 由调用方每收到快照重置）。
   - `encodeInput(polled, player)` → `{keys:{fwd,back,left,right,jump,crouch,cast}, yaw, pitch}`；`decodeInput(msg, match, side)` → 喂给 `RemoteInputSource.push` 并 `applyTo`。
4. 新建 `tools/net_sync_check.cjs`（node，零依赖，构造照 `tools/draft_check.cjs`：世界 `{size:[64,36,64],seed,lodes:true}`）。断言：
   - S1 序列化：viewer=1 看不到房主手牌与牌库顺序（递归扫）；看得到自己手牌；`handCount/deckCount` 双方都有；
   - S2 快照往返：apply 后镜像 `players[0]` == 房主 `players[1]`（pos/hp/mana/mats/score/score 逐一比），镜像 `players[1]` == 房主 `players[0]`；
   - S3 矿归属与 `over.winner` 互换正确（含 owner=-1 不变）；
   - S4 世界 diff：房主改 12 格（含一次 `world.set` 到岩浆旁边触发 chem 的唤醒）→ drain 后 guest `applyCells` → 两边逐格相同、`Save` 的 diff 数相同；`drain` 后 tracker 为空；
   - S5 input 编解码：`encodeInput` → `decodeInput` 往返 keys/cast 不丢、`yaw/pitch` 被 clamp 到 `G.LOOK_LIMIT`；缺帧时 `poll` 返回空输入；
   - S6 三选一：房主给 side1 排一次 offer → `makeSnapshot(match,1)` 的 `draft` 三个候选、`makeSnapshot(match,0)` 的 `draft === null`；`takeDraft(1,id)` 后房主 side1 牌库 +2；
   - S7 uid 对账：同一份快照 apply 两次，随从/抛射物/法阵对象引用不变（`arr[0] === arr[0]`）；快照少一条后对应对象被移除；
   - S8 外推：`extrapolate(0.05)` 让 pos 沿 vel 前进，连续 4 次后（>0.15s）第五次不再前进。

## 验收（自己跑，贴真实输出）

```
node tools/net_sync_check.cjs
node tools/net_check.cjs
node tools/layer_check.cjs
node tools/play_probe.cjs 490706 1 10800 starter 1
```

判据：net_sync_check 全绿；net_check 仍 30 绿（你只加字段没动帧型）；layer_check 退出 0；play_probe 硬回归 33 绿 / 0 红。

## 报告
改了哪些文件各做了什么；4 条命令关键输出；不确定处。