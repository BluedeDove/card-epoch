# 任务书 NET-spike · 先证伪最大风险：file:// 能不能连本机 WebSocket

## 为什么先做这个
项目日常用法是**双击 index.html（file://）**，而联网必须让页面连一个 ws:// 服务。
Chromium 对 file:// 发起的 ws:// 连接是否放行，是这个方案成立与否的第一道闸——
如果它被拦，整套"零依赖联机"的路线都要重画，所以先花小代价证伪，别先把游戏逻辑改了。

## 只做这一件事
零依赖（不许 npm install、不许 import 任何外部包）手写一个 WebSocket 服务端与最小客户端，跑通：
1. 两个 headless Chromium 页面（**用 file:// 加载 index.html**）各自连到 ws://127.0.0.1:<随机空闲端口>；
2. 服务端做：房间码分配 + 双方配对 + 原样转发指令帧 + 心跳（ping/pong）；
3. 客户端做：建连、发 {type:'input', seq, tick, keys}、收对端指令、统计往返延迟；
   **不许碰游戏逻辑**：不改 battle.js/rules.js/world.js/net.js/main.js/index.html 的任何一行，
   新建文件只许 js/net-ws.js 与 tools/net_spike_server.cjs（+ 你自己的 tools/ 测试脚本）。

## 必须回答的问题（这是这个 spike 的全部产出）
- file:// → ws:// 在 headless Chromium 里能不能连上？把 console 的原始报错（若有）贴出来；被拦的话是哪一类拦截
 （混合内容 / CORS / 协议限制 / 用户手势策略）。
- 若被拦，用 http:// 起同源服务能不能连？那条路意味着"双击 file:// 就不能联机"，要明确写出来。
- loopback 下往返延迟实测：p50/p95/max（1000 帧），以及 20Hz（50ms/tick）锁步需要多大缓冲才不卡。
- 断线与半开连接能不能被服务端在 2 秒内发现（kill 客户端进程看服务端日志时间戳）。

## 边界
- 不许 npm install、不许加任何依赖、不许改 vendor/；three.js r128 是仓库里唯一的第三方。
- 不许 git add/commit；不许动 本机已在跑的端口；临时文件放 /tmp。
- 结论写进 docs/NET_SPIKE.md：能/不能、证据（原始日志）、以及"联机该走哪条路"的一句话建议（不要实现它）。