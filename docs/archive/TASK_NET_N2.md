# 任务书 NET-N2 · 传输层（这一刀没有真人对局，别提前接线）

先读 docs/NET.md（设计，§5 是冻结的协议）与 docs/NET_SPIKE.md（你上轮的实测）。

## 要交付什么
- **tools/net_host.cjs**：从 spike 的服务端演化成正式版——零依赖手写 RFC6455、房间码配对、双道心跳（协议层 ping/pong +
  **应用层心跳**：页面每 250ms 自报 `{tick, frame}`，超时即判"画面卡死"而不只是"连接活着"）、指令转发、房间表。
- **js/net-ws.js 补全**：连接/断开/重连、帧编解码、seq 与去重、应用层心跳发送。仍然零 DOM、零玩家可见中文（layer_check 会拦）。
- **tools/net_check.cjs**：这条刀的回归（下面验收逐条对上）。

## 硬边界（越界即返工）
- **不许改共享文件**：js/battle.js、js/rules.js、js/main.js、js/net.js、js/cards.js、index.html 一律只读。
  并行会话正在这些文件里写（卡牌线、UI 线、大气线），你今天碰一次就会重演"整文件提交带走半成品"那起事故。
- 协议里那两个要读 match 的部分——`serializeFor(match, viewerSide)` 与快照覆盖——**这一刀只写成纯函数 + 单元测试，不接线**：
  `serializeFor` 接受一个普通对象返回过滤后的对象，测试里喂构造数据即可；真正读 match 的接线是 N3 的事。
- 不许 npm install、不许动 vendor/、不许加外部服务；不许 git add/commit；临时文件放 /tmp；别抢 本机已在跑的端口。

## 验收（逐条对上，贴原始输出）
1. 协议六个帧型都能往返（hello/joined/input/snapshot/event/bye-timeout），**版本不符必须被明确拒绝并给出原因**，不许静默错配。
2. viewer 过滤不泄漏手牌：递归扫 guest 收到的每一帧，出现对方 `p.hand` 里的卡 id 即失败；
   **并且用一对已知不同的手牌做正例**（两边都空也会"通过"，那是假绿）。允许发的是实体 hp/坐标/存活/分数/矿归属/抛射物/随从/弃牌堆/手牌**张数**。
3. 断线检测：SIGKILL 后 2 秒内判死（实测上轮是 5–80ms）；SIGSTOP 冻结 renderer 时，**协议 pong 照样回**这条要能被应用层心跳抓到。
4. seq 乱序 / 重复帧 / 迟到帧都要有确定行为（丢弃或重排，不许重复消费一次出牌）。
5. `node tools/audit.cjs` 三种子不得比现在更红（当前基线：490706 PASS、88092 PASS、31337 FAIL[C4 既有债 + H 超出施法范围]，
   那条 H 是卡牌线 cd27973 留下的，**不要去"修"它**，那是他们的判据协调题）；`node tools/layer_check.cjs` exit 0。

结果写 docs/NET_N2_REPORT.md。一句话提醒：**这一刀交付完，玩家还是打不了真人对局**——那是 N3 的活，别为了"看起来能用"去偷改 battle.js。