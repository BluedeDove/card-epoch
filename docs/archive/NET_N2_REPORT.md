# NET-N2 报告 · 传输层（任务书 [TASK_NET_N2.md](TASK_NET_N2.md)；这一刀没有真人对局，别提前接线）

> 结论先行：**net_check 30 绿 / 0 红**；audit 与基线逐项一致（490706 PASS、88092 PASS、31337 FAIL[C4+H]，
> 无新增红；H 是卡牌线 cd27973 的协调题，未碰）；layer_check exit 0。
> 共享文件（battle/rules/main/net/cards/index.html）一行未碰——serializeFor 与快照覆盖是**纯函数 + 单元测试**，没接进 match。
> 未 commit、未 npm install。

## 1. 交付物
| 文件 | 职责 |
|---|---|
| [tools/net_host.cjs](../tools/net_host.cjs)（~190 行，可 `node tools/net_host.cjs [port]` 独立起服） | 正式服务端：零依赖 RFC6455、hello **版本闸**（ver≠2 显式 bye want/got 并断开）、房间码配对（host/guest 两席）、按角色转发（input→host 席、snapshot/event→guest 席、bye 双向中继）、双道心跳（协议 ping 500ms + **应用层 {tick,frame} 250ms**，stall 1s / 协议静默 2s 分开判） |
| [js/net-ws.js](../js/net-ws.js)（134 行，浏览器与 node 双载） | 传输客户端：**SeqChan**（每个 (connId,seq) 恰好交付一次：重复丢弃、乱序/迟到各接受一次、重连换纪元集合清零、2 万条淘汰最旧一半）、**Connection**（断开/重连退避 0.5s→8s、应用心跳 250ms）、**serializeFor**（§4 白名单纯函数） |
| [tools/net_check.cjs](../tools/net_check.cjs)（~230 行） | N2 回归（G1 帧型/版本闸、G2 泄漏扫、G3 seq、G3b 重连退避、G4 断线） |

## 2. 验收逐条（原始输出见本节末）
1. **六帧型往返 + 版本闸**：hello/joined（双席同 seed）/peer-joined/input(guest→host 原样）/snapshot/event(host→guest 原样）/bye（中继 + guest-gone）全通；
   ver=999 → `{type:'bye', reason:'version-mismatch', want:2, got:999}` + 断开 + 不占席位（后续 hello 正常配对）。**没有静默错配。**
2. **viewer 过滤不泄漏手牌**（递归全帧扫，正例已知不同手牌）：viewer=1 看不到 wall2/heal（对方手牌）与 bloom（对方 pendingPick），
   **看得到自己的 icewall/golem**（证明不是"全空假绿"）；viewer=0 对称成立。手牌张数双方可见、牌库只给张数（顺序零泄漏）、
   允许字段（hp/坐标/存活/分数/矿归属/抛射物/随从/弃牌堆）齐。
   测试设计自纠一处：禁用 id 撞了允许字段（projectile.kind='bolt' 是公开抛射物）——改用 wall2/heal 作禁用 id，碰撞免疫。
3. **断线检测**：socket 强杀 → 服务端 0–480ms 判死（FIN/RST，远小于 2s）；
   **"协议 pong 照样回"的等价态**（node 客户端自动回协议 ping、但停发应用心跳）→ 932–1035ms 判 stalled、对端收到
   `{type:'timeout', reason:'peer-stalled', lastTick, lastFrame}`、心跳恢复 → unstall。正常发 hb 不误判。
4. **seq 确定行为（exactly-once）**：重复帧全部丢弃；乱序（4后3）与迟到（5后1）各接受一次；重连换纪元旧 seq 不误判；
   同一 input(seq=10) 投递三次出牌只消费一次（hand 3 张不重复扣）。
5. **门禁**：audit 490706 PASS / 88092 PASS / 31337 FAIL[C4+H]（与基线逐项一致，无新增）；layer_check exit 0。

## 3. 过程记录（两条环境事实，下一个会话别再踩）
- **node ≥21 自带全局 WebSocket**：net_check 桩重连退避时，往 `window.WebSocket` 上挂 stub 是无效的——
  js/net-ws.js 里的自由变量 `WebSocket` 在 node 里解析到 `global.WebSocket`（undici），stub 必须盖全局。
- **递归泄漏扫描的禁用 id 不能撞允许字段**：第一版用 'bolt' 当"对方手牌 id"，被 projectile.kind 误报成泄漏；
  禁用 id 选"只在手牌里出现"的卡（wall2/heal），正例成立。

## 4. 交接（N3 要用的形状都在）
- 服务端：`require('./net_host.cjs').serve()` → http server（rooms: Map code→{host,guest}；心跳常量 HB 250ms / stall 1s / dead 2s）。
- 客户端：`GW.NetWs.Connection({url, room, side, name, seed, onFrame, onState, getTick})`；send 自动带 seq+connId；onFrame 已过 exactly-once 去重。
- serializeFor(view, viewerSide)：吃普通对象吐白名单对象——**N3 把 match 的形状喂给它即可，本刀未接线**（硬边界遵守）。
- 协议常量：PROTO_VER = 2（NET.md §5 冻结）。
- 原始输出：/tmp/a2a/n2_layer.txt、/tmp/a2a/n2_audit.txt；net_check 全量输出即本报告 §2 的逐条证据。
