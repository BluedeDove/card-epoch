# 任务书 A1-b · 占矿归属与得分（LodeSystem + Scoreboard 扩展）

先读 docs/GAMEPLAY.md §2.1（得分与结束）、§2.2（三种资源）、§7.1 条 5 与条 6、§7.3、§7.4 步骤 6；
以及 docs/A1A_REPORT.md：world.lodes 已提供坐标/晶体格/平台 3×3/attempts/degraded。

## 要做的
1. 新建 js/lode-system.js 的 **LodeSystem**（L4 第五类活体，与 Projectile/Summon/Sigil/Fluid 同构，彼此不许互调，只由 Match 编排）：
   - 归属：玩家站在某矿 3×3 平台上且对方不在 → 独占；双方都在 → contested（无主，谁都不产出）；
   - 独占期间每 3 秒该玩家 +1 分；占矿素材被动 +1 素材/6 秒（无矿者拿不到）；
   - 任一方 ≥80 分后矿脉产出 ×2（定案 §2.1 终局加速，目标是 80 分后 ≤60 秒收束）。
2. 扩展 **Scoreboard**（已有类，别新建第二个计分器）：击杀 +15 分、scoreWin 100、480 秒超时判分、平分进加时（下一个得分事件定胜负）。
   胜负判据从此不看 killsToWin；但 **lives 字段、复活流程、2.2s 复活延迟、2.5s 无敌帧全部保留不动**
   （退役 lives 牵动 hud 与 creative 的调试兜底，按派发边界属 UI 收口后的动作，本刀不做）。
3. Match.step 里新阶段的**插入位置必须写死并注释理由**（阶段顺序是确定性命门）：说明排在现有哪一段之后、为什么。
4. 复活点占位检查（把 T8 从侥幸绿变成语义对）：复活前用现成的 G.GroundProbe 检查 spawnPts 落点，
   被埋就沿 camGroundY 顶到可站面，**不许运行时改世界格子**（那是 save 的 diff 与 chem 的 onSet 唤醒事故）。

## 范围与禁止
- 只许改 js/battle.js + 新建 js/lode-system.js。
- **tools/ 一律不许动**（play_probe 由另一条线独占；你要的新断言写进报告，由我加，别自己伸手）。
- 不许碰 index.html、js/main.js（大气线在写）、js/hud.js、js/ui/**、js/creative.js、js/camera.js、js/hero-*.js、
  js/chem.js、js/vfx*.js、js/atmos.js、js/weather.js、js/world.js（A1-a 线在改）、js/rules.js、js/cards.js、src/。
- 结算面板的胜负原因文案要新增 key 属 UI 欠账：**复用现有 reason 取值**（例如 time），不要新增 key 让面板读到 undefined；
  把这个需求写进报告，由我提给 UI 线。
- 不许改任何既有断言阈值；不许 git add/commit。

## 验收（真跑贴原始输出，play_probe 只跑不改）
- play_probe 490706×12：预期 T2 保持绿、T7 中位从 184s 向 270–420 靠拢（分数钟取代先 2 杀后，局时长由分数节奏决定）、
  T9 不劣化、H 组与 U 组 0 红。贴改动前后：中位与 p95 时长、胜负原因分布（分数胜/超时胜/加时胜各几局）、击杀数、
  每条矿平均独占时长与产出量、双方得分。
- 我要额外看一个公平指标：12 局里**独占矿脉总时长最多的一方是否就是胜者**——出现「占矿多却输」就是产出与击杀分失衡，如实报别调数。
- layer_check / hit_check / chem_check / creative_check / ui_check 全 exit 0；audit 只许既有两条异常，不许新增。
- 结果写 docs/A1B_REPORT.md（唯一允许你新建的文件）。