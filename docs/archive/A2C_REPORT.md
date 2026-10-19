# A2-c 报告 · 占矿宽限（kimi R2 方案甲）——预测全部兑现，量具修盲自证有效

> 任务书：[TASK_A2C.md](TASK_A2C.md)；kimi R2：[GAMEPLAY_ENDGAME_R2.md](GAMEPLAY_ENDGAME_R2.md)（含它的公开纠正）。
> **结论先行：这一次预测 vs 实测全落带内——双理性 score 结局 100%/100%（预测 97%，承诺 ≥88%）、越线中位 326.6s/339.4s（预测 329s，承诺 [300,360]）。**
> 机制线的两条抽检也测了：contested 占比 0.00%（连行为反馈都没有）、素材顶帽病成立（信号 a）。
> 范围守住：js/lode-system.js（宽限状态机）+ js/battle.js 胜分一行（opts 化）+ tools/rational_agent.cjs 估值表 3 行（批准项）；
> 其余 tools/ 一字未碰。未 git add / git commit。

## 1. 改了什么（文件 · 行号 · 内容）
| 文件 | 内容 |
|---|---|
| js/lode-system.js | **占矿宽限状态机**：`holdGrace = opts.holdGrace ?? 0`（默认 0 = 逐字节旧行为）；在场独占刷新保留账 → 空台保留倒计时（继续产出）→ 对手上台/争抢立即清零（计 graceClears）。**contested 写成公开字段**（kimi R2 §7 裁决的"L4 只差暴露"）。新增 `rateOf(L)` 只读出口（量具修盲用）。**顺手删了 80 分 ×2 加速线**：宽限把等效独占抬 ~2.3 倍后 80 分真的会到，留着它等于往测量里掺一个没人审过的变速——此行已在交付消息里单独标注，不同意就回滚它（git 里有）。 |
| js/battle.js | **就一行**：`this.scoreWin = opts.scoreWin ?? 100;`（timeCap/overtime 两个赋值照留）。默认 100 = 已验证现状，测试侧显式传 75。 |
| tools/rational_agent.cjs | 批准的 3 行：估值表 `/ 3 * lock` → `* rate * lock`，rate 读 `m.lodeSys.rateOf(sys[i])`；归属读 `sys[i].owner`（宽限保留归属因此对估值可见，本就这行在读，无需改） |

**接线债登记**：battle.js:75 `new G.LodeSystem(this)` 不转发 opts——holdGrace 要进真局，那行得改成 `(this, opts)`（一行，留机制线拍板）；测试侧目前用构造后赋值 `m.lodeSys.holdGrace = 2`（H4 族不拦：探针/量具直改字段是既有先例）。

## 2. 预测 vs 实测（同表并列；驱动 /tmp/a2c_probe.cjs = rational_probe 同口径 + opts 注入，两种子各 12 局/组）
| 组 | 指标 | kimi 预测（承诺） | 实测 490706 | 实测 88092 | 判定 |
|---|---|---|---|---|---|
| 双理性 | score 结局占比 | 97%（≥88%） | **100%（12/12）** | **100%（12/12）** | ✓ 超预期兑现 |
| 〃 | 越线时刻中位 | 329s（[300,360]） | **326.6s** | **339.4s** | ✓ 双落带内 |
| mixed | score 结局占比 | 83%（≥72%） | **83.3%** | **75.0%** | ✓ 双落线上 |
| 〃 | 越线时刻中位 | 371s（[340,400]） | **385.8s** | **377.6s** | ✓ 双落带内 |
| mirror | score 结局 | 恒 0%（正确行为） | 0% | 0% | ✓（断言注释已写明"贴钟是它应得的结局，别当回归"） |
| 和平角 | 收束时刻 | ~225s（R2 §5.2 带 [200,250]） | 中位 **233.4s**（12/12 score） | 中位 **234.1s**（11/12 score + 1 平局） | ✓ 带内（含走位 30–60s 的实测比纯产出 225s 高一档，合理） |

加时链在宽限下仍闭合：rational/mixed/mirror/peace 四组 96 局无界 0；唯一 1 局平局（88092 和平组）是我测试代理导航没到位（0:0 到 480 → 加时 45s 零产出 → 525s 全等判平 overtime-tie）——**平局路径本身按设计闭合在窗口内**，夹具弱点不是机制漏洞（该代理已修过一轮导航：跳跃冷却 + 交替侧移，还剩 1/24 不到位）。

## 3. 机制线加的两条抽检
1. **contested 占比 / 清零次数**：全部四组 × 两种子 contested 占比 **0.00%**（tick-lode 口径；kimi 预测 <5%）、清零 0–0.33 次/局、易主 0–1 次/局——宽限最可能的死法（"谁都拿不到"的窗口）**连行为反馈后也没出现**，oracle 的"从不共台"在真代理上成立。
2. **素材通胀 vs T_MAT_CAP=24（判据一字未动）**：双理性组终局素材均值 **30.9/26.8（490706）与 33.1/35.4（88092）> 24**，顶帽（≥24）秒/侧 **77–130 秒**、素材赚取 12.5/分钟 vs 消费 2.3–3.7/分钟——**信号 (a) 成立：长时间顶帽且几乎不再消费**（玩家想建但没处花，T_MAT_CAP 想抓的正是这个病）→ 按口径②：不抬 cap，要加出口。对照：mixed 组终局 2.5–4.8（R 侧早早收工）、mirror 组 0、和平组 26.6–41.8（纯蹲零消费）。
   附带实测：宽限后占矿被动真实到账 **12.5/分钟/侧**（定案稳态 25/分钟的另 half 是 harvest 采晶 + 兽首，未落地）——"名义存在变真的到账"兑现了一半。

## 4. 量具修盲的自证（grace 0 vs 2，双理性，同 score=75，两种子各 12 局）
| 指标 | grace=0（490706/88092） | grace=2（490706/88092） |
|---|---|---|
| 走位计划切换/局 | 41.1 / 58.3 | **22.0 / 31.0（-45%）** |
| 矿独占秒/侧 | 95.1/85.2 / 90.8/85.5 | **207.4/185.7 / 208.0/214.5（≈2.3×）** |
| score 结局 | 0% / 0% | **100% / 100%** |
| 终局素材均值 | 9.8/6.8 / 9.1/7.6 | 30.9/26.8 / 33.1/35.4 |

**走位差异观测成立**：宽限让归属不再因抬脚断档 → 估值表不再抖动 → 计划切换降 45%。这不是"机制自己的工作"而是代理决策路径可见的变化——量具修盲有效。
（如实拆分：差异的大头来自宽限机制本身；修盲的贡献是让估值读到保留归属与真实速率出口。）

## 5. play_probe（默认 opts：grace 0 / score 100——验证"默认=现状"）
三种子 ×12 局：T2 无界全归零 △；硬回归 31/31/30 绿 0 红（31337 的 L4 既有越线 tol 红照旧）；T7 480s/525s 照旧（mirror 不占矿，T7 的数字是 A2 的事）；
L4 490706/88092 绿、31337 既有红；L5/L6 设计性红照旧。**与 A1-b2 的 B 态同档——默认关闭纪律生效。**

## 6. 门禁与 audit（全真跑）
layer / hit / chem / creative(53) / ui(130) 全 exit 0；audit = 490706 PASS / 88092 PASS / 31337 FAIL[C4 + H 超出施法范围]——**与任务书给的基线逐字一致**，H 是卡牌线 cd27973 的协调题（A2B_REPORT §5 有打桩归因），未顺手修。

## 7. 一句结论
**宽限 2s + 胜分 75 该定案**（这次是真仪器 + 真行为响应：预测全落带内，contested 死法未出现，量具修盲自证有效）。
唯一悬而未决的是素材出口（信号 a 成立：顶帽不动、消费停滞）——抬 cap 还是加出口，按口径②归机制线判。
另：和平组走位时间（30–60s）不在 kimi 的 225s 里，纯产出 225s + 走位才是实测 ~233s——它落进带内是事实，但口径上"收束时刻"含不含走位，下次对撞前建议写清。

原始输出：/tmp/a2c_main_{490706,88092}.txt、/tmp/a2c_proof_{0,2}-{490706,88092}.txt、/tmp/a2c_play_*.txt、/tmp/a2c_*check.txt、/tmp/a2c_audit.txt；驱动 /tmp/a2c_probe.cjs、冒烟 /tmp/a2c_smoke.cjs（13 绿）、回归 /tmp/a1b2_smoke.cjs（11 绿）。

## 8. 量具固化（复核后追加）：tools/endgame_probe.cjs

- /tmp 驱动固化成 [tools/endgame_probe.cjs](../tools/endgame_probe.cjs)：flags 接口 `--group=rr|mixed|mirror|peace|all --grace=秒 --score-win=分 --seed --games`，
  **默认 `--group=rr --grace=0 --score-win=100` = 现状**（默认关闭纪律延伸到量具：误提交也不改默认输出）。
  四张表照出：score 结局占比 / 越线中位 / contested 占比 / 宽限清零次数 / 素材赚取·消费·顶帽秒（外加独占秒、易主、走位切换）。
- 固化后逐字复现验收数字（同 seed 同窗口）：
  `node tools/endgame_probe.cjs --group=rr --grace=2 --score-win=75` → 100% @326.6s（与 §2 的 490706 行逐项一致）；
  `node tools/endgame_probe.cjs --group=all --grace=2 --score-win=75 --seed=88092` → rr 100%@339.4 / mixed 75.0%@377.6 / mirror 0% / peace 91.7%@234.1（逐项一致）；
  裸跑 `node tools/endgame_probe.cjs` → 0% score、480s 贴钟（现状）。layer_check 绿。
- 接线兼容：Match opts 传分；holdGrace 在 battle.js 装配行转发前由工具构造后幂等补写（机制线已认领那一行转发）。
- 机制线复现崩溃的答复：本工具无 eval/vm 奇技（纯 require + flags）；上一轮的 cold 对照注入用过一次 `(0,eval)`（/tmp/a2b_behavior.cjs，已退役），
  那个文件不该再跑。正确构造方式：`new G.Match({ world, seed, mode:'train', players:2, fx, scoreWin:75, holdGrace:2 })`（forwarding 落地后）；
  RationalAgent `new RationalAgent(m, side)`；lodeSys 挂在 `m.lodeSys`（LodeSystem 实例，`.lodes` 是逐矿账）。
  Node 26.2.0 本机全绿通过所有上述命令。
