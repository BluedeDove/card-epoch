# 任务书 A1-b2 · 让加时必须闭合（一个不依赖 AI 质量的逻辑漏洞）

先读 docs/A1B_REPORT.md（你上一刀）与 docs/GAMEPLAY.md §2.1。

## 问题（我实测出来的，不是你报告的延伸）
你用真默认窗口重测后：490706 有 1/12 局跑到 540s 被窗口截断、88092 有 2/12 无界。
根因是加时的结束条件只有"下一个得分事件"，而**双方龟缩不得分时加时永不结束**——这在真人对局里同样成立
（两人都不敢出来打、也不去踩矿点），所以它不是 AI 质量问题，是终止性（termination）漏洞。

## 要做的两件事
1. **加时给硬上限并逐级判定**：加时上限取 90 秒（1800 tick）。加时中任一得分事件仍立刻结束对局（保持定案设计）；
   到上限仍未分则按这个顺序判，**第一项分出即停**：
   ① 本场占矿累计秒数多者胜 → ② 血量百分比高者胜 → ③ 分数高者胜 → ④ 全部相等记平局。
   winReason 取值沿用你已定的 score/time/overtime/manual，平局新增 overtime-tie；
   **over 的对象形状不许变**，面板现在不读 winReason，所以不许出现 undefined 字段。
2. **复活占位检查与坠落兜底共用同一个助手**：你在报告里点名"坠落兜底分支仍留着同一条埋人路径"。
   把它与 respawnPlayer 的占位逻辑抽成一个函数（沿用 G.GroundProbe，只升不降、零世界写、零 rng），两处共用。

## 范围与禁止
- 只许改 js/battle.js 与 js/lode-system.js。**tools/ 不许动**（play_probe 归我/另一条线），要新断言写进报告由我加。
- 不许碰 index.html、js/main.js、js/world.js、js/hud.js、js/ui/**、js/creative.js、js/camera.js、js/hero-*.js、
  js/chem.js、js/vfx*.js、js/atmos.js、js/weather.js、js/rules.js、js/cards.js、src/。
- 不许改任何断言阈值；T2 的判据必须仍是 undecided === 0。不许 git add/commit。

## 验收（真跑贴原始输出）
- play_probe 三种子各 12 局，**用真默认窗口**（第 4 个参数传空串或不传，别再传 9600，那会覆盖窗口默认）：
  T2 的"无界局数"必须归零（跑到 540s 还在算是失败）；贴出加时触发次数、加时最终靠哪一级判掉的分布、平局几局。
- T7 中位与 p95 报出来；**不要为了让 T7 好看去动时间帽或矿脉产出**，它现在贴 480s 是因为 AI 不占矿，那是 A2 的事。
- 硬回归与 U 组必须 0 红；layer/hit/chem/creative/ui 全 exit 0；audit 只许 31337 C4 那一条既有红。
- 结果追加进 docs/A1B_REPORT.md 的新节。