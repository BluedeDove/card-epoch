# 任务 N2 · 联机接线：房主权威循环 + guest 镜像循环 + 协议 v3

先读：`docs/NET.md` §9（尤其 §9.1/§9.2/§9.3/§9.5/§9.6）、`src/main.js` 的 `start()`/`frame()`/`onMatchOver()`/`pollDraft()`、`src/app/session.js`。
前提：N1 已交付 `src/net-match.js`（`G.NetMatch.makeSnapshot/applySnapshot/makeWorldTracker/applyCells/extrapolate/encodeInput/decodeInput`）与 `G.Net.RemoteInputSource`。
只允许修改：`src/main.js`、`src/app/session.js`、`src/net-ws.js`、`src/net.js`、`src/hud.js`（只加文案 key）、`index.html`（只加 2 个 script）、
`tools/net_host.cjs`、`tools/net_check.cjs`。**不许**改 `src/net-match.js` 的对外 API（要改先报告）、不许碰 `src/ui/*`、不许 git commit。

## 要做的事

1. **协议 v3**：`src/net-ws.js` 与 `tools/net_host.cjs` 的 `PROTO_VER` 改成 3（两端同改）；`tools/net_check.cjs` 里 hello 的 `ver: 2`、版本闸期望的 `want: 2` 跟着改成 3。
2. `tools/net_host.cjs`：
   - host 的 hello 可带 `config`（`{map:{id}, rule}`）与 `seed`；存进 room，并在 guest 的 `joined` 里回 `{side, seed, rulesOpts: room.config || {}, room}`；host 自己的 `joined` 也回同一份 config；
   - 新增路由：`draftPick` / `draftSkip` **只允许 guest→host**（与 `input` 同一条件），未知帧型仍只 log 不透传。
3. `index.html`：在 `src/net.js` 之后加 `<script src="src/net-ws.js"></script>` 与 `<script src="src/net-match.js"></script>`（顺序：net.js → net-ws.js → net-match.js）。
4. `src/app/session.js` 的 `buildMatch`：`mode === 'net'` 时 `S.sources = [KeyboardSource(mouseLook:true), new G.Net.RemoteInputSource()]`；**不生成** AISource；`G.Match` 的 opts 用 `G.rulePresetFor(cfg)`（已有），另外传 `mode:'net'`、`beasts` 由规则给——**guest 一律传 0**（`cfg.net && cfg.net.role === 'guest' ? 0 : rp.beasts`）：晶甲兽由房主生成、经快照以 uid 对账下发；guest 本地再长一批会被当成陌生 uid 反复建删。
   `S.split = false`；`G.HUD.setSplit(false)` 不变。
5. `src/main.js` 的 `start(cfg)`：`cfg.mode === 'net'` 时改走 `startNet(cfg)`（新函数，放在 `start` 旁边）：
   - 建 `new G.NetWs.Connection({ url, room, side: 房主? 'host':'guest', name, seed, config })`；
   - 注册 `onFrame`：`joined` / `peer-joined` / `snapshot` / `bye` / `timeout`；
   - **房主**：收到 `joined` 后用本地 seed 走原有 `buildWorld/buildMatch/beginLoop`，然后 `S.net = {role:'host', conn, tracker: G.NetMatch.makeWorldTracker(S.world), guestInput:null, lastSnapTick:0}`；
   - **guest**：收到 `joined` 用 `msg.seed` 与 `msg.rulesOpts` 组 `cfg2 = Object.assign({}, cfg, { map: rulesOpts.map || cfg.map, rule: rulesOpts.rule || cfg.rule })` 再 `buildWorld/buildMatch/beginLoop`，然后 `S.net = {role:'guest', conn, draftOffer:null, draftOpenFor:null, extrapLeft:0.15}`；
   - 连接在 5 秒内没有 `joined` → `G.HUD.toast` 明说「连不上/没有这个房间」并留在选关（不进对局）；`bye reason=version-mismatch` → 明说版本不符与 want/got。
6. `frame()` 分支（**不要动 tick/render 拆分与相机顺序**）：
   - 顶部暂停判据保持；
   - `S.net && S.net.role === 'guest'`：不调 `S.match.step`、不调 `G.WEATHER.step`；每个 tick：`var o = S.sources[0].poll(STEP)` → `conn.send({type:'input', tick:S.match.tick+1, ...G.NetMatch.encodeInput(o, S.match.players[0])})`；然后 `G.NetMatch.extrapolate(S.match, STEP, 0, 0.15)`；`acc` 照常消费；
   - 房主：照常 step，`inputs[1]` 由 `S.sources[1]`（RemoteInputSource）给；step 之后若 `S.match.tick % 2 === 0`：`conn.send({type:'snapshot', ...G.NetMatch.makeSnapshot(S.match, 1, S.net.tracker)})`；每次发送前若 `tracker.size() > 4000` 就改用全量 diff（`G.Save.exportFrom(S.world).cells`）并 `tracker.drain()` 丢掉增量；
   - 收到 guest `input`：`G.Net.RemoteInputSource.applyTo(S.match.players[1], msg)` + `S.sources[1].push(msg)`；
     并**每 tick 给房主侧的 guest 玩家重算瞄准**（它没有相机）：`S.match.updateAim(p1, p1.eye(), {x:Math.sin(yaw)*Math.cos(pitch), y:Math.sin(pitch), z:Math.cos(yaw)*Math.cos(pitch)}, true)`；
   - 收到 guest `draftPick`：`S.match.takeDraft(1, msg.cardId)`；`draftSkip`：`S.match.skipDraft(1)`；
   - 收到 `snapshot`（guest）：`G.NetMatch.applyCells(S.world, msg.cells || [])`、`G.NetMatch.applySnapshot(S.match, msg)`、`S.net.extrap = 0`；若 `msg.draft` 与 `S.net.draftOffer` 不同则记下并（面板没开时）弹三选一；若 `msg.over` 且尚未结算 → `onMatchOver()`；
   - guest 的三选一面板：`G.HUD.openChoice({items})`，`onPick` → `conn.send({type:'draftPick', cardId})`、`onSkip` → `conn.send({type:'draftSkip'})`；**不要**调 `match.takeDraft`（guest 不是权威）。
6b. **guest 的出牌不许本地结算**（NET §3：一律等房主裁决）：`castCard(side, i)` 在 `S.net.role==='guest'` 时**不调** `S.match.playCard`，而是把下标记到 `S.net.pendingCast`，下一 tick 编码进 input 的 `cast` 后清空；按 Shift 的快捷出牌（`useHotkey`）在 guest 上直接 `G.HUD.toast(H.TEXT.net.hotkeyOff)` 并返回。房主侧行为不变。
7. 掉线：guest 收到 `bye reason=host-gone`（或 `timeout peer-stalled`）→ 设 `S.match.over = {winner:0, name:'你', ticks:S.match.tick, time:S.match.time, winReason:'opponent-left'}` 并 `onMatchOver()`；host 收到 `guest-gone` → 同样（winner 0，reason `opponent-left`）。房主自己掉线时 guest 已经由服务端通知，不需要客户端互相探测。
8. `src/hud.js` 的 `H.TEXT`：`result.reason` 加 `'opponent-left': '对手已离开'`；新段 `net: { connecting:'正在连接…', noHost:'没有这个房间（房主还没开）', version:'协议版本不符，请两端用同一份本目录', hostGone:'房主已离开', guestGone:'对手已离开', roomTaken:'这个房间已经有人了', joined:'已连上，对手来了', hotkeyOff:'联机时快捷出牌不可用（出牌要等房主裁决）' }`；`ui.modeNames` 不需要改。
9. 调试面：`window.__GW_NET = function () { return S.net ? {role:S.net.role, state:S.net.conn.state, room:S.net.conn.room, tick:S.match.tick, seed:S.world.seed} : null; }`（给 N4 的 E2E 用）。

## 验收（自己跑，贴真实输出）

```
node tools/net_check.cjs
node tools/net_sync_check.cjs
node tools/layer_check.cjs
node tools/play_probe.cjs 490706 1 10800 starter 1
node tools/ui_check.cjs
node tools/creative_check.cjs
node tools/audit.cjs
```

判据：net_check **30 绿**（版本改 3 后仍全绿）；net_sync_check 全绿；layer_check 退出 0；play_probe 硬回归 33 绿 / 0 红；
ui_check 140 / creative 53 全绿；audit 三种子全绿（默认图 64）。任何一条红都照实贴，不要改断言。

## 报告
改了哪些文件；每条命令的关键输出；没做到的地方（尤其「房主/guest 谁在什么条件下进主循环」的实际行为）。