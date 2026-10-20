# NET-spike 报告 · file:// 能不能连本机 WebSocket（任务书 [TASK_NET_SPIKE.md](TASK_NET_SPIKE.md)）

> 结论先行：**能连。** file:// 页面直连 ws://127.0.0.1 全程零拦截报错（两轮 1000 帧 × 双客户端实测），
> 零依赖手写服务端/客户端即可跑通房间码配对 + 转发 + 心跳。**联机该走"双击 file:// + 本机 node ws 服务"这条路**，
> 不需要 http 同源改造、不需要装任何依赖。未 commit；battle/rules/world/net/main/index.html 一行未改。

## 0. 交付物（全部新建，零依赖零游戏逻辑）
| 文件 | 职责 |
|---|---|
| [tools/net_spike_server.cjs](../tools/net_spike_server.cjs)（116 行） | 手写 RFC6455 服务端（只有 node 内置模块）：握手/帧编解码、房间码配对、原样转发、协议 ping 心跳（500ms）+ 2s 静默扫表、应用层 aping/apong |
| [js/net-ws.js](../js/net-ws.js)（~85 行） | 最小客户端：原生 WebSocket 建连/join、20Hz 指令帧、端到端 echo、RTT 统计（采样满后继续心跳，防静默污染断线测量） |
| [tools/net_spike_check.cjs](../tools/net_spike_check.cjs)（~150 行） | Playwright 驱动：两实例两页面配对、console 全量抓取、两阶段断线测量（SIGKILL=FIN 路径 / SIGSTOP 整组=半开路径） |

## 1. 四问四答（证据原文在 /tmp/a2a/netspike_run{,2,3,4}.txt）

### ① file:// → ws:// 能不能连：**能，四类拦截一个都没触发**
服务端日志（run4）：
```
[+1158ms] connect id=1 127.0.0.1 origin=file://
[+1159ms] join id=1 room=ABC1 side=0
[+1170ms] connect id=2 127.0.0.1 origin=file://
[+1209ms] paired room=ABC1
```
两个 file:// 页面（HeadlessChrome 145）完成配对并互转 1000 条指令帧；页面 console 里**没有任何**
混合内容 / CORS / 协议限制 / 用户手势类报错（全量 console 在结果 JSON 里，唯一的杂音是 headless 的
WebGL context-lost 与 ReadPixels 性能提示，与 ws 无关）。http:// 起同源服务同样能连
（`origin=http://127.0.0.1:36141`），但那是备而不用：file:// 本身就是可直连的。
（机制注记：file:// 属 potentially trustworthy origin，ws:// 不算混合内容——实测与规范一致；
用户机 Chrome 155 未实测，但同源策略在这件事上两个版本没有分叉记录。）

### ② 若被拦，http:// 能不能绕开：能（已实测连通）——但**不需要**
http 同源组同样配对成功并互转指令帧。它的含义只在"万一未来某版 Chromium 改口"时才成立：
那时"双击 file:// 就能联机"会退化为"双击 + 还要起一个静态服务"，这一点要写进联机菜单的提示口径。

### ③ loopback 往返延迟与 20Hz 锁步缓冲
实测环境：HeadlessChrome 145 + SwiftShader 软件光栅（渲染与页面抢同一颗 CPU——**数字系统性偏高，
真机 160fps 硬件会显著更低，必须真机复测**，与 AGENTS 的 SwiftShader 口径一致）。
| 指标（20Hz × 1000 帧，三轮合并区间） | p50 | p95 | max（毛刺） |
|---|---|---|---|
| 应用层 client↔server RTT（aping） | 20–34ms | 39–90ms | ~0.4–0.8s |
| 端到端 A→服务端→B→A（input echo） | 41–70ms | 65–147ms | ~0.6–1.05s |
| 推算单向输入延迟（e2e/2） | ≈20–35ms | ≈32–73ms | — |

**锁步缓冲**：单向 p95 ≈ 32–73ms ≈ 0.6–1.5 tick（50ms/tick），叠加 jitter（p95−p50 ≈ 15–70ms）后
**3 tick（150ms）的固定输入延迟可覆盖全部三轮的 p95**；毛刺（~0.1% 概率 0.5–1s）不该靠加大静态缓冲
消化——锁步需要"等输入但带超时、超时重同步/追帧"的规则，而不是更大的缓冲。

### ④ 断线与半开能不能 2 秒内被发现：**能**
| 路径 | 手法 | 服务端发现耗时（实测） |
|---|---|---|
| 正常关闭 | br.close() | close-frame 即时到达并转发 peer-gone（对端立刻知情） |
| FIN/RST（SIGKILL 整组） | 进程组强杀 | **5ms**（ECONNRESET，读路径）/ **80ms**（EPIPE，写路径=下一次 500ms 心跳写） |
| 半开（SIGSTOP 整组：browser+network+renderer） | 进程组冻结 | **1.9–2.2s**（500ms 心跳 ping + 2s 静默扫表 + 250ms 扫描间隔） |

两个附带事实（都有日志）：① 杀掉 B 后 A 的连接**不被误伤**（aAliveAfterBKill=paired，后继续心跳）；
② Chromium 的协议 pong 由 network 进程应答——只冻结 renderer 是测不出半开的，
意味着真联机层若要抓"渲染卡死但网络活着"，得在应用层再加一道心跳（本 spike 的服务端已带 aping 先例）。

## 2. "联机该走哪条路"（一句话建议，不实现）
**走"双击 file:// + 本机 node ws 服务（房间码配对 + 原样转发输入帧 + 心跳）"**：第一道闸已过，
不需要 http 同源、不需要依赖；落地时把 spike 服务端搬进 tools/ 常驻脚本即可，锁步输入延迟按 **3 tick** 起步
并配超时重同步，断线发现用"协议心跳（2s）+ 应用层心跳（抓渲染卡死）"双道。真机延迟分布需复测后再定缓冲终值。

## 3. 边界与原始输出
- 未 commit、未 npm install、未改 vendor 与任何游戏逻辑文件；8932 端口未碰（服务端一律 127.0.0.1:0 随机空闲端口）。
- 测量副产品（已修）：① 客户端采样满后静默会污染半开测量 → 采样满继续心跳；② 进程归属按时点差集会错记
  懒加载的 network 进程 → 按"驱动进程的直接子进程定主进程、kill 时刻展树"修正（file 组曾误杀 A，已复测干净）。
- 原始输出：/tmp/a2a/netspike_run.txt（run1）、netspike_run2.txt（run2）、netspike_run3.txt（1000 帧双方案 + 两阶段断线）、netspike_run4.txt（file 组干净复测）。
