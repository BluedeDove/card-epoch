# 任务 N5 · 联机战前选牌：协议 v4 + 双人就绪 + 用双方牌库开局

先读：`docs/ROUTER.md` §2（协议与校验）、`docs/NET.md` §9、`src/main.js` 的 net 段（startNet/onNetFrame/netEnter）、`src/app/session.js` 的 buildMatch、`tools/net_host.cjs`。
前提：R1（Router）与 L1（loadout 面板/意图）已落地；`G.HUD.loadoutPicks()/setLoadoutStatus()/markLoadoutReady()` 可用。
只允许修改：新建 `src/net-loadout.js`、`src/net-ws.js`（PROTO_VER）、`tools/net_host.cjs`、`src/main.js`（net 段）、`src/app/session.js`（只加 cfg.decks 分支）、`tools/net_check.cjs`（ver 4）、`tools/net_e2e.cjs`（加 E9）、新建 `tools/loadout_check.cjs`、`docs/NET.md`（§10 协议表）。
不许 git commit；不许碰 `src/ui/*`、`src/hud.js`（除报告需要外）。

## 要做的事

1. 新建 `src/net-loadout.js`（`G.NetLoadout`，零 DOM 零文案）：
   - `validateDeck(deck)` → `{ok:true, terrain}` 或 `{ok:false, reason:'count'|'terrain'|'copies'|'unknown'|'empty'}`（12 张、单卡 ≤2、id ∈ `G.CARDS_BY_ID`、terrain ≥4）；
   - `pickCounts(picks)` 把 `{id:count}` 摊成数组；`sanitize(deck)` 去非法 id、夹到 2 份、截到 12；
   - `SIGNATURE` = 牌库排序后的字符串（房主侧判「双方牌库是否相同」用，只进日志不展示）。
2. 协议 **v4**：`src/net-ws.js` 与 `tools/net_host.cjs` 的 `PROTO_VER` 一起改 4；`tools/net_check.cjs` 的 `ver`/`want` 期望 3→4。
   `tools/net_host.cjs` 路由追加：`loadout` guest→host；`lobby`/`start` host→guest（与 input/snapshot 同一张角色表，未知帧型仍只 log）。
3. `src/app/session.js` 的 `buildMatch`：`cfg.decks`（两个数组）存在时用它建 `cards:`，否则走原来的 `makeDeck`。
4. `src/main.js` 的 net 段改成**两段式**（连接 → 选牌 → 开局）：
   - 房主 hello 的 `config` 带上 `game`（现成的 `{map,rule}` 再加 `game` 一项，取自 cfg.game）；guest 建房时用 `rulesOpts.game`。
   - 房主：`joined` 到 → **不进 match**，`Router.go('loadout', {role:'host', seed})`，`S.net = {role:'host', conn, seed, guestDeck:null, guestReady:false, selfReady:false}`；
     `peer-joined` → `G.HUD.setLoadoutStatus('peerReady')`；收到 guest `loadout` → `G.NetLoadout.validateDeck` 校验，合法则存 `guestDeck`、`guestReady`，回 `lobby`；不合法回 `lobby {reject: reason}`；
     自己点「就绪」→ `selfReady=true`，回 `lobby`；**双方 ready 且两份牌库都合法** → 发 `start {seed, config:{map,rule}, decks:[hostDeck, guestDeck]}` → `netEnter(cfg, seed)`（cfg.decks = [hostDeck, guestDeck]）。
   - guest：`joined` 到 → `Router.go('loadout', {role:'guest'})`；自己就绪 → 发 `{type:'loadout', deck, ready:true}`；
     收到 `lobby` → 更新状态行（对手已就绪/被拒绝原因）；收到 `start` → `cfg.decks = [start.decks[1], start.decks[0]]`（**本地视角 1↔0：side0 是自己**），`cfg.game = start.config.game || cfg.game`，`netEnter(cfg, start.seed)`。
   - `netEnter` 里 `Router.replace('match', …)`（R1 之后 beginLoop 已走 Router，不用重复改）。
   - 离开 loadout（返回按钮）：`netTeardown()` + `Router.go('level')`，返回 `{ok:true}`。
   - `H.TEXT.loadout` 的拒绝原因 key 在这里用（只报 key）。
5. 调试与量具入口（写进注释，生产路径同一条）：`window.__GW_LOADOUT_AUTO(deckIds)`：把给定牌库写进 vm picks 并触发 ready（供 net_e2e 用）；不传则用「前 12 张且地形 ≥4」的自动牌库。
6. 新建 `tools/loadout_check.cjs`（node，零依赖）：
   L1 validateDeck：12 张合法 → ok 且 terrain≥4；11/13 张 → count；terrain 3 张 → terrain；同一张 3 份 → copies；未知 id → unknown；空 → empty。
   L2 sanitize：夹到 2 份、去未知 id、截 12。
   L3 真 `net_host` 两席：guest 发 `loadout` → host 收到；host 发 `lobby`/`start` → guest 收到；**角色路由**：guest 的 `loadout` 不会回到 guest，host 的 `start` 不会回到 host。
   L4 `session` 的 decks 分支：不加载浏览器，直接断言源码含 `cfg.decks` 且 Match opts 用 `cards: cfg.decks`（静态）；或用一个最小 Match 构造验证 12 张牌库长度。
7. `tools/net_e2e.cjs` 加 **E9**：两端进 loadout 后各调 `__GW_LOADOUT_AUTO()`（host 用一组含 fire 的牌、guest 用另一组含冰的牌），3 秒内两端都进 match；断言两端 `players[0].deck.length===12`、**两端自己牌库的第一个元素不同**、自己手牌 ⊆ 自己牌库、世界同 seed。原 E1–E8 照旧（它们走的是 `__GW_START`，会在 N5 后被 loadout 拦下 → **必须同步改成走 `__GW_LOADOUT_AUTO`**：E1–E8 的开局路径改成 level→net 连接→loadout→auto ready；若改动太大，就在 net_e2e 里加一个 `enterMatch()` 辅助函数统一走新路径）。
   **E10（死亡竞赛 + 积分榜同步）**：把一局的 `cfg.game` 换成 `{id:'deathmatch', target:5}` 重开；host 页执行 `GWAPP.match.kill(GWAPP.match.players[1], GWAPP.match.players[0], GWAPP.match.ctx)` 一次；1 秒内 guest 的 `GWAPP.match.director.snapshot().kills[0]===1`、`vm.board` 有击杀行、分数字段 1/0；再杀 4 次后两端 `match.over.winner===0` 且 `winReason==='score'`。
8. **玩法在联机里的同步（M1 之后）**：快照里带 `board: match.director.snapshot()`；guest 收到后调新增的 `G.MatchDirector.apply(match.director, msg.board)` 把记分/击杀/死亡/目标/时间对齐（guest 不跑 kill，自己算不出来）。`displaySpec()` 仍是唯一显示来源。
9. `docs/NET.md`：加 §10「战前选牌（v4）」协议表与状态机（连接 → 选牌 → 就绪 → start → match），并写清 board 同步。

## 验收（自己跑，贴真实输出）

```
node tools/loadout_check.cjs
node tools/net_check.cjs
node tools/net_sync_check.cjs
node tools/net_e2e.cjs
node tools/layer_check.cjs
node tools/play_probe.cjs 490706 1 10800 starter 1
```

判据：loadout_check 全绿；net_check 30（ver 4）；net_sync 71；**net_e2e 全绿（E1–E9）**；layer 退出 0；play_probe 33 绿 0 红。

## 报告
改了哪些文件；每条命令关键输出；E9 的实测数字（两端牌库长度、首个元素、进 match 用时）；不确定处。