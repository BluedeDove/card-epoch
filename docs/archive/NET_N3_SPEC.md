# N3 权威同步 · 接线规格（先把改动面钉死，避免派单时临场决定改哪几行）

> 目的：让 guest 能跟真人房主打一局。**这是联机里唯一必须碰共享文件的一刀**，所以改动面写死在这里，超出即返工。
> 前缀约定：所有新增行为都住进**新文件 `js/net-sync.js`**；共享文件只允许下面列出的那几行。

## 1. 允许碰的共享文件与行数上限（超出即返工）

| 文件 | 只许做什么 | 上限 |
|---|---|---|
| `js/main.js` | 帧循环里加一个分支：guest 角色时不跑 `Match.step`，改调 `G.NetSync.guestFrame(dt)`；房主跑原路径 | ≤ 4 行 |
| `js/main.js` | 启动时把 net 句柄交给 `G.NetSync.attach({match, role, chan})` | ≤ 2 行 |
| `js/net.js` | 补 `RemoteSource.poll()`：产出与 `KeyboardSource` 完全同形的指令 | ≤ 25 行 |
| `js/battle.js` | **不改**。快照覆盖、预测、重同步全在 net-sync.js 里用公开字段做 | 0 行 |
| `index.html` | 加 `js/net-ws.js` 与 `js/net-sync.js` 两个 script 标签 | 2 行 |

**不许做的事**：为同步改 `Match.step` 的内部顺序；把视觉量写回权威状态（既有不变量）；给 guest 开任何"本地改判"的后门；
动 `cam_audit` 与 `play_probe` 的任何判据；顺手去"修"31337 那条 H（卡牌线的协调题）。

## 2. 数据流（房主权威，与 NET.md §3 一致：快照覆盖，不做回滚重放）

```
guest: KeyboardSource → SeqChan(input,seq) → host
host : RemoteSource.poll() ⊕ 本地 KeyboardSource → Match.step(dt, inputs)   ← 唯一权威推进
host : 每 snapshotTicks（默认 10 tick=0.5s）发 serializeFor(match, guestSide) + 世界 diff
guest: 收 snapshot → 覆盖权威字段 → 立刻 snapshotPrev() 让现有 ppos→pos 插值摊平跳变
guest: 超过 3 tick 没收到快照 → 停止外推、按最后已知速度定住等重同步（不许继续预测成穿墙）
```

## 3. 隐藏信息（N2 已交付纯函数，这一刀负责验"接上之后仍然不泄漏"）

- guest 的手牌由房主发（房主要跑权威结算，本来就知道），但**只向 guest 本人回发 `mine=true` 的那份**；
- N2 的 `net_check` 是在构造数据上验白名单，N3 必须补一条**在真对局里**扫 guest 收到的每一帧：
  出现对方 `p.hand` 里的卡 id 即失败，并且用一对已知不同的真实手牌做正例（防"两边都空所以通过"的假绿）；
- 出牌指令只带手牌下标 + 瞄准，卡 id 由房主解析——这条不能退化成 guest 直接发卡 id（那等于绕过 `Rules.canPlay` 的语义）。

## 4. 验收（N3 才算"真人可玩"，所以量化口径不许松）

1. 两端 `worldHash` 对齐：每 5 秒抽一次，房主与 guest 必须一致；漂移即红（这是 H1 的跨进程版）；
2. 校正量报数：**校正次数/局、最大校正距离、stall 次数**——不许只报"能玩"；
3. 断线两种：拔 guest（房主继续可玩、进单人结算不卡住）与拔房主（guest 收 `host-gone`，停在结算画面，不许黑屏或卡在暂停）；
4. guest 侧延迟注入：把 RTT 人为加到 150ms/300ms，验 3 tick 外推上限真的生效（角色不许瞬移穿墙）；
5. `play_probe` 与五门禁不回退、audit 不比基线更红、`net_check` 30 条仍 0 红（新增用例后条数会增加，以脚本输出为准）。

## 5. 与其它线的排期冲突（派单前必读）

- `main.js` 同时是**大气线**（天气/日照装配）与**重构线**在写的文件，`index.html` 是 **UI 线**在写；
  N3 开工前确认这两个文件当下没有他线未提交改动，否则先让他们提交、我再动，绝不并发改同一文件。
- 与 `docs/UI_DEBT.md` §1 的合架挂载**合并做**：反正都要往 index.html 加 script，一次加齐（lode 三个 + net 两个），L5 那条红也在那一刀一起还。