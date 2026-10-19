# 任务书 A1-a2 · 把排序公平折进换盐目标（不放宽尺子）

先读 docs/A1A_REPORT.md（你上一刀的交付）与 docs/GAMEPLAY.md §5 新增的「排序公平由生成器负责」那条（我已拍板）。

## 要做的（只此一件）
ReachabilityGate 现在只做三件验证 + 8 次换盐；改成**在 8 次尝试里选排序公平差最小的那张图**：
- 每次尝试算 d0=[side0 到三矿的 BFS 步数] 与 d1=[side1 到三矿]，排序后取逐元素相对差的最大值作为该图的 score；
- 取 score 最小的一张（并列时取 attempts 序号最小，保证确定）；
- 评估函数只能读 seed 派生的量，**是 seed 的确定函数**，不许引入新随机源（H1 同 seed 逐格一致是命门）；
- BFS 成本：现在一张图 8–54ms，8 次尝试内别让它超过 400ms（超了就报实测，不许偷偷减尝试次数）。

## 尺子不动，另加一条硬线
- 目标线（tol）：排序差 ≤10%，可红，如实报 12 个 seed 的实测最大值与分布；
- **新增硬断言（hard）：折进换盐之后排序差仍 >20% 判红**——那是结构性偏袒，不许发布这种图。
- 中矿争夺性 ≤10% 与「家门矿存在性」两条照旧。
- 不许把 10% 改成 15% 或 20% 来交差；要动口径必须先在报告里写清为什么。

## 范围与禁止
- 只许改 js/reachability-gate.js、js/world.js 里与闸门直接相关的几行、tools/play_probe.cjs（这条线独占 play_probe，A1-b 那条线不许碰）。
- 不许碰 index.html、js/main.js（大气线在写）、js/hud.js、js/ui/**、js/creative.js、js/camera.js、js/hero-*.js、
  js/chem.js、js/vfx*.js、js/atmos.js、js/weather.js、js/battle.js、js/rules.js、js/cards.js、src/。
- 不许改任何既有断言阈值；不许 git add/commit。

## 验收（真跑贴原始输出）
- play_probe 490706/88092/31337 各 12 局：L4 三条（排序/争夺/家门矿）逐项前后对比，H 组与 U 组必须 0 红；
  12 个 seed 的排序差分布贴两份（折进换盐前后各一份），让我看得出是真改善而不是松了尺子；生成耗时 max 报出来。
- layer_check / hit_check / chem_check / creative_check / ui_check 全 exit 0；audit 已知异常只有两条：
  31337 C4 因 64 图裁剪暂时绿、G 转视角那条是相机线在办——不许新增。
- 结果追加进 docs/A1A_REPORT.md 新节，别新建文件。