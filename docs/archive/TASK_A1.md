# 任务书 A-1 · 修命中（派给子代理执行）

执行者是子代理，机制线会话负责复核与提交。**先读三份文件再动手**：
[GAMEPLAY.md](GAMEPLAY.md)（定案，尤其 §3.1、§3.2、§4、§7.1 条 12/13/14/15）、
[GAMEPLAY_BASELINE.md](GAMEPLAY_BASELINE.md)（实测基线）、
[ARCHITECTURE.md](ARCHITECTURE.md)（分层与 MatchOps 规矩）。

## 1. 要解决的问题（实测证据，不是猜测）

抛射物命中率实测 **1.2%–2.6%**（12 局 3780 发命中 46 发；starter 对局 8 分钟零击杀）。根因可算：
弹速 42 格/s（battle.js 的 var sp = 42）配射程 26–34（cards.js 的 maxDist），飞行 0.6–0.8 秒；
对手满速横移 SPEED = 5.6 会挪走 3.5–4.5 格，而命中判定半径 ELEMENT_FUSE 只有 1.15–1.9，且没有任何提前量。
→ 打移动靶在几何上必不中。所以这一步不做，后面所有数值调参都是在噪声里摸。

## 2. 只允许修改这些文件

- js/cards.js：伤害 ray 类卡的 maxDist 收进 18–22 带（strike→18、bolt→20、shard→20 等）。
  **例外：void_lance 保 24**（定案 §3.2，全池唯一的远程压制位，压短了掩体与高差就白做）。
  地形卡、位移卡、法阵卡、工具卡的射程**一律不动**。
- js/battle.js：ELEMENT_FUSE 各档 +0.3 左右；ProjectileSystem 的初速方向在"准星选中目标是实体"时按
  距离/42 做速度补偿（用 e.pos + e.vel × t 的纯几何解，零随机、不吃 rng，玩家与 AI 同一条 fireProjectile）。
- tools/hit_check.cjs：**只允许新增断言**，不许删、不许放宽任何现有阈值（它是并行会话的验收口径）。

## 3. 明确禁止（越界即返工）

- 不许碰 index.html、js/hud.js、js/main.js、js/creative.js —— **UI 线会话正在写这些文件**。
  所以本步**不做**预测命中点的画面显示，也不做开关的 localStorage 读取；
  提前量的可用性走 Match 构造参数 opts.leadEnabled，**默认 true**，读设置那一步留给后续在 app 层做（写进你的报告，别自己做）。
- 不许碰 js/camera.js：cam.dir / aimOrigin 从 lookAt 反推，是"准星=命中格"的硬不变量（AGENTS 视角不变量一节）。
  提前量只在 ProjectileSystem 内部算初速，**绝不在别处再算一份 fwd**。
- 不许碰 js/chem.js、js/vfx*.js、js/hero-*.js、src/（其他会话地盘）。
- 不许改 docs/GAMEPLAY*.md 与 AGENTS.md（真源由机制线维护）。
- 不许 git commit、不许 git add。交回工作区状态即可，复核与提交由机制线做。
- 不许为了让门禁变绿而修改断言阈值、删测试、或者把判定半径调大来"凑命中率"——那是自欺，会被驳回。

## 4. 验收（必须真跑，贴出输出，不接受"应该可以"）

1. node tools/hit_check.cjs —— 原有断言全绿，且新增三条成立：
   静止靶 18 格命中 ≥95%；满速横移靶 15 格**带提前量** ≥35%；同场景**关掉提前量的对照组 <10%**
   （这条是对照组，缺了它就无法证明提升来自提前量而不是半径注水）。
2. node tools/play_probe.cjs 490706 1 9600 starter 12 —— 目标线 T1 命中率从 1.2% 抬到 ≥30%，
   T2（局必须分出胜负）应开始出现分出胜负的局；把改动前后的两组数字都贴进报告。
3. node tools/audit.cjs（三种子）+ node tools/layer_check.cjs + node tools/creative_check.cjs 全过。
4. 同 seed 重放一致：play_probe 的 H1 绿；提前量不许引入未播种随机（它只用 pos/vel/距离）。

## 5. 交回什么

写一份 docs/A1_REPORT.md（**只有这个文件允许你新建**），内容：改了哪些常量与函数（带行号）、
命中前后的实测数字对照表（静止靶 / 横移靶 / 对照组 / 12 局 T1、T2）、跑过的门禁与退出码、
没做完或不敢做的部分（例如预测点显示与开关的 app 层接线）、以及你认为本步暴露出的新问题。
不要顺手做 §7.4 里的其他步骤。
