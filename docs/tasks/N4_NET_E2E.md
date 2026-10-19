# 任务 N4 · 两端真跑一局的 E2E（net_e2e.cjs）+ 文档收口

先读：`docs/NET.md` §9.7、`tools/audit.cjs` 的服务+Playwright 写法、`tools/net_check.cjs` 的 wsClient。
前提：N1/N2/N3 已交付。只允许修改：新建 `tools/net_e2e.cjs`，以及 `README.md`、`AGENTS.md`、`docs/NET.md`（只把「已落地/未落地」写准）。不许 git commit；不许改 src/ 里任何逻辑。

## 要做的事

1. 新建 `tools/net_e2e.cjs`。**起点是 N2 代理留在 `/tmp/n2_smoke.cjs` 的双页冒烟（19 条，18 绿，唯一红是它自己的夹具写错）**：读它、把它的夹具改成正式门禁，不要从零写。它已经把下面这些跑通过：房主移动 guest 看到 7.25 格、guest 移动进房主 7.38 格、房主改 6 格两端逐格相同、两端 `Save` diff 6=6、`offerDraft(1)`→guest 面板→真点击→房主 deck 6→8、两端掉线都进结算、无房主只 toast。
   已知口径（N2 报告）：**guest 侧 `players[1].hand` 是 `new Array(handCount)`**（长度=张数、内容全 undefined），所以 E5 要判「槽位全空且 guest 页面里不出现房主手牌 id」；`__GW_NET().state` 连上后是 `'hello'` 不是 `'open'`；房主在 `peer-joined` 之前**不发快照**，E2E 要等两端都 paired 再开始量。
   自己起静态服务 + `require('./net_host.cjs').serve()`，随机端口，不抢 本机已在跑的端口：
   - 两个 page（1440×900）：host 页与 guest 页，都打开 `http://127.0.0.1:<静态端口>/index.html`；
   - host 页：`__GW_START({mode:'net', seed:490706, deck:'starter', map:{id:'duel-64'}, rule:'ranked', net:{role:'host', url:'ws://127.0.0.1:<ws端口>', room:'E2E'}})`；
   - guest 页：同调用但 `net:{role:'guest', ...}`、不带 seed；
   - 等到两端 `window.__GW_NET()` 都有值且 `tick > 20`（超时 20s 判红）；
   - 断言：
     E1 两端 role / seed（490706）/ 世界尺寸（64×36×64）一致，`room=E2E`；
     E2 host 按住 W 1.2 秒 → guest 镜像里**房主那位**（`players[1]`）水平位移 > 1.0 格；
     E3 guest 按住 W 1.2 秒 → host 的 `players[1]` 水平位移 > 1.0 格；
     E4 host 用 `match.world.set` 改 6 格（选三个坐标 + 邻格）→ 1.5 秒内 guest 的世界逐格相同；再比 `Save.exportFrom(world).cells.length` 两边相等；
     E5 信息隔离：guest 页 `match.players[1].hand` 的**每个槽位都是 undefined**（长度=张数是对的），且 guest 页全文（含 `document.body.innerText` 与序列化后的 `GWAPP.match`）不含房主手牌里的卡 id（先在 host 页读 `players[0].hand` 再在 guest 页搜）；
     E6 三选一：host 页 `match.offerDraft(1,'lode','forest')` → 1.5 秒内 guest 弹出 `.ui-choice-box`；真鼠标点第一张 → 2 秒内 host 页 `players[1].deck.length` +2 且 `draftUsed.lode[1] === 1`；
     E7 掉线：`guestPage.close()` → 3 秒内 host 页 `#result` 可见且文案含 `H.TEXT.result.reason['opponent-left']`；
   - 每条 PASS/FAIL + 汇总 + 退出码；失败时打印两端 `__GW_NET()` 与最后 5 条 console error。
2. 文档：
   - `docs/NET.md` §9 末尾补一行状态：N1–N4 已落地、验收命令是 `node tools/net_e2e.cjs`；把 §9.6 的「不做事件帧」保留为已知差距；
   - `README.md`：新增一节『联机对局（局域网）』——两端怎么起（房主 `node tools/net_host.cjs 8787`、两端双击同一份 index.html、选关里选联网 + 房主/加入 + 房间码），以及**已知差距**（guest 没有命中特效；出牌要等房主裁决 ≈ RTT；不做公网）；
   - `AGENTS.md`：目录地图补 `src/net-match.js` / `src/net-ws.js` / `tools/net_e2e.cjs`；「改哪层必跑」表加一行（动 net* / net_host / 联机 UI → `net_check` + `net_sync_check` + `net_e2e` + `audit`）；
   - `AGENTS.md` 的「其他边界」里把「联网 PVP 只有输入抽象、没有 server.js」改成事实：**局域网房主权威已可玩**，公网/穿透/匹配/防作弊仍未做。
3. 顺序要求：先在**当前代码**上把 E2E 跑绿；跑不绿就把失败原因如实写进报告（不许为了让 E2E 变绿去改 src/）。

## 验收（自己跑，贴真实输出）

```
node tools/net_e2e.cjs
node tools/net_check.cjs
node tools/net_sync_check.cjs
node tools/layer_check.cjs
node tools/play_probe.cjs 490706 1 10800 starter 1
```

判据：net_e2e 七条全绿；net_check 30 / net_sync_check 全绿；layer_check 退出 0；play_probe 33 绿 0 红。

## 报告
七条 E2E 各自的实测数字（位移格数、格数相等、deck 增量、掉线耗时）；没做到的与原因。