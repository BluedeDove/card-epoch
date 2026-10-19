# 任务 N3 · 选关界面的联机入口（服务器 / 房间码 / 角色）

先读：`docs/NET.md` §9.5、`docs/LEVELS.md` §1.3 与 §4、`docs/UI_KIT.md` 的五步。
前提：N2 已让 `start(cfg)` 认识 `cfg.mode === 'net'` 与 `cfg.net = {role,url,room}`。
只允许修改：`src/ui/panels.js`、`src/ui/theme.css`、`src/hud.js`、`src/main.js`（只改 `bindUIChannel` 里的 `ui.levelStart` 与 `H.config` 的字段拼装），
`tools/level_check.cjs`（只加断言）、`tools/ui_shot.cjs`（加一张 14-level-net 图）。不许 git commit；不许改 N1/N2 的逻辑层。

## 要做的事

1. `src/ui/viewmodel.js` 或 `panels.js` 里 `vm.level` 的初始状态加三个字段：`netUrl: 'ws://127.0.0.1:8787'`、`netRoom: 'ROOM'`、`netRole: 'host'`。**就地改，不换对象。**
2. `src/ui/panels.js` 的 `LevelSelect`：
   - 模式那一栏选中 `net` 时**不再 toast**，而是多出一块 `.ui-level-net`（只在 `sel.mode === 'net'` 时显示）：
     服务器输入（id `levelNetUrl`）、房间码输入（id `levelNetRoom`，placeholder 见文案）、角色两个按钮（创建房主 / 加入对局，`data-field` = `netRole`，真值 `host`/`guest`）；
     再加一行说明文字（房主要先在房主机器上运行 `node tools/net_host.cjs 8787`，挑战者填房主的局域网 IP）。
   - 三个字段的修改一律走 `ui.levelPick`（`field` 分别是 `netUrl`/`netRoom`/`netRole`），**不要在视图里直接改状态**。
3. `src/hud.js` 的 `H.TEXT.level` 加：`hNet:'联机'`、`netUrlLabel:'服务器'`、`netRoomLabel:'房间码'`、`netRoleLabel:'角色'`、`netHost:'创建房主'`、`netGuest:'加入对局'`、`netNote:'房主先在本机跑 node tools/net_host.cjs 8787；挑战者填房主的局域网 IP 与同一房间码。两端用同一份本目录（双击 index.html 即可）'`、`netRoomPlaceholder:'例如 ROOM'`；并把 `modes` 里 net 的 `label/tip` 改成「联网 PVP（局域网）」/「需要本机先跑 net_host.cjs」。
4. `src/main.js`：
   - `H.config()` 的返回值加 `net: { url: L.netUrl, room: L.netRoom, role: L.netRole }`（`L = vm.state.level`）；
   - `ui.levelStart` 去掉 `if (cfg.mode === 'net') return {ok:false, reason:'net-offline'}` 这条拒绝；`mode==='net'` 时把 cfg 交给 `start(cfg)`（N2 的 startNet 会处理连接与失败提示）；
   - 失败要留人话：`net-offline` 文案保留给「没填服务器」这一类，**别删 H.TEXT**。
5. `src/ui/theme.css`：新增 `.ui-level-net` 段（沿用 `.ui-row/.ui-input` 的令牌，零圆角、零模糊阴影、边框 0/2px；不许新颜色）。
6. `tools/level_check.cjs` 加断言（静态）：`H.TEXT.level.netNote` 存在且含 `net_host.cjs`；`panels.js` 里 `netUrl`/`netRoom`/`netRole` 三个字段名都出现；`main.js` 的 `H.config` 拼出 `net:`；`main.js` 不再对 `mode==='net'` 直接返回 `net-offline`。
6b. 联机的名字标签：`H.TEXT.ui.names` 里 `p2` 仍是「AI 对手」，联机里读着不对。在 `H.TEXT.net` 加 `names: ['你', '对手']`；`src/app/session.js` 调 `G.HUD.playerNames(S.split)` 的地方改成 `G.HUD.playerNames(S.split, S.mode)`；`src/hud.js` 的 `playerNames(split, mode)` 在 `mode === 'net'` 时返回 `H.TEXT.net.names`（只加这一条分支；单人/分屏不传 mode 时行为逐字不变）。
7. `tools/ui_shot.cjs`：在选关截图后追加一张 `14-level-net`——先真鼠标点模式栏的「联网 PVP」按钮（`[data-field=mode][data-key=net]`），等 `.ui-level-net` 可见再落图；再点「创建房主」确认选中态。

## 验收（自己跑，贴真实输出）

```
node tools/level_check.cjs
node tools/ui_check.cjs
node tools/creative_check.cjs
node tools/layer_check.cjs
node tools/ui_shot.cjs --shots /tmp/gwn3 --gate
node tools/ui_shot.cjs --shots /tmp/gwn3-15 --gate --viewport 1280x720 --dpr 1.5
node tools/audit.cjs
```

判据：level_check 全绿（含新增断言）；ui_check 140 / creative 53；layer_check 退出 0；两档 ui_shot --gate 违规 0；audit 三种子全绿。
落图后**自己打开 /tmp/gwn3/14-level-net.png 看一眼**：三个字段不重叠、说明不溢出、窄屏（dpr1.5 那档）不挤爆。

## 报告
改了哪些文件；7 条命令关键输出；14-level-net 你看到的问题与处理；不确定处。