# 任务书 A0-a R2 · 部分成交（按可负担格数建造）

先读 docs/GAMEPLAY.md §2.2 的"部分成交"新条款（我刚写进去的，是本轮唯一口径）+ docs/A0A_REPORT.md §6。
范围仍限 js/rules.js、tools/play_probe.cjs（cards.js 如无必要不动）；
红线不变：index.html、js/hud.js、js/ui/**、js/main.js、js/creative.js、js/camera.js、js/hero-*.js、
js/chem.js、js/vfx*.js、js/net.js、src/ 不许动；不许改任何断言阈值；不许 git add/commit。

## 要做的
1. **建造类（非 erase）地形卡按可负担格数建造**：mats=3 打 6 格墙 → 真建 3 格、扣 3 素材、牌消耗、魔力扣；
   建不了哪怕 1 格（素材 0，或目标处全不可改造）才拒付，且拒付不烧牌不扣魔力（R1 的预算门保持）。
2. 截断必须在**同一份报价单**上做：从 R.priceTerrain 返回的 cells 里按可付数量取前 N 格，
   由结算按这份截断后的单执行。禁止在别处再数一遍格子或再算一次价（定案 §7.3 的第二个价格真源）。
   注意 grow/raise 这类有 rng 的形状：截断不能引入第二次 rng 消耗，否则同 seed 图就变了（H1 会红）。
3. 反馈只许报 key（例如 fx.log 走既有'素材不足'系 key 或新 key），**不许在 rules.js 里写新的中文句子**；
   若需要新文案，写进报告交回我给 UI 线，别自己塞进文案表或逻辑层。
   （顺带记一笔既有债给我：rules.js:161 一带有直接写中文的 fx.log，是历史遗留越界，本轮不清理，只在报告里点名行号。）

## 新增/固化断言（play_probe，只许新增）
- U5：mats=3 打 wall2（6 格）→ 建成 3 格、mats 归 0、牌进弃牌堆、魔力按价扣（一条"部分成交"的正面断言）。
- U6：mats=0 打 wall2 → 拒付，且 hand / discard / mana / 世界四者均不变（守住 R1 成果）。
- T9（新目标线）：12 局镜像 AI 出牌总次数 ≥ 240，专门盯死手牌导致的手牌流转停滞。
  这条现在应该是红的（本轮实测出牌只有 2001/12 局），做完部分成交后请报它是否转绿。

## 验收（真跑贴原始输出）
- play_probe 490706 1 9600 starter 12 改动前后各一遍，重点看这四项的恢复：出牌总次数、T1 命中率、T2 无界局数、击杀数；
  T4 必须保持绿、H 组与 U 组不得出现红、T9 如实报。
- hit_check / layer_check / creative_check / ui_check 全 exit 0；audit 只允许 31337 C4 既有红。
- 我要你说清一件事：**T1 的 30% 阈值我一字未动**。如果部分成交之后 T1 仍 <30%，不要调阈值，
  把每枪命中率与发射数的分布贴出来，我来判断是不是该由 A2 的 RationalAgent 与 AI 瞄准滞后（net.js 里那个 0.93 格稳态滞后）解释。
  结果追加进 docs/A0A_REPORT.md §9，别新建报告文件。