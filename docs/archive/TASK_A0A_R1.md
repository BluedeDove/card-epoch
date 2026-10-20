# 任务书 A0-a 返工（三条，仍属同一刀）

先读 docs/A0A_REPORT.md（你上一轮的交付与遗留）与 docs/GAMEPLAY.md §2.2、§7.1 条 7、§7.3。
范围仍限 js/rules.js、js/cards.js、tools/play_probe.cjs；红线不变：index.html、js/hud.js、js/ui/**、
js/main.js、js/creative.js、js/camera.js、js/hero-*.js、js/chem.js、js/vfx*.js、js/net.js、src/ 一个字符不许动，
不许改任何断言阈值，不许 git add/commit。

我（机制线）已拍板的三条：

1. **付不起素材就不许烧牌、不许扣魔力。** 现状：p.mats < need 时在 applyEffect 里 return，
   但牌已从手牌移进弃牌堆、魔力已扣（A-1 前是"按卡扣 1"所以很少发生；按格计价后 9 格墙要 9 素材，
   付不起是常态，这个旧路径从罕见变成日常吞牌）。要求：预算检查前移到合法性校验（canPlay 一侧），
   **与结算共用同一个"数格 + 计价"函数**，绝不在两处各数一遍格子（那是第二个价格真源，定案 §7.3 明令禁止）。
   拒付时保持现有提示 key，不改文案表。
2. **自伤必须穿透护盾与无敌帧。** 你把 loseHp 归一进 R.damage 后，虚空馈赠 gift 的 -4 血现在会被护盾吸收、
   也会被复活无敌帧免掉——这等于"开盾或刚复活时 gift 免费抽 3 张"，代价设计失效。
   口径：给 R.damage 加一个显式的自伤通道（如 opts.selfHarm），走 hp 扣减与 hp<=0 → kill 的统一出口，
   但跳过护盾抵扣与无敌/invuln 免伤。别用"把 amount 加大"或"先清护盾"这类副作用手段。
3. **dig3 文案与实得格数不符**（文案写"最多 3 格"，实为 erase r1 → 最多 9 格）：改文案对齐实际，
   **不许为了对文案去动 radius 或上限**（单卡 9 格上限是既有护栏，定案保留）。

## 验收（真跑，贴原始输出）
- 新增冒烟断言并跑绿：① 素材不足时 hand 长度、discard 长度、mana 三者都不变，世界一格未改；
  ② 护盾满值时 gift 仍按 -4 扣血；③ 复活无敌期 gift 仍扣血；④ gift 把血打到 0 时正常走 kill（lives--、hp 夹 0）。
- play_probe 490706 1 9600 starter 12：T4 必须保持绿、H 组 14 绿 0 红、T1/T3/T5/T6 不得劣化；
  T2/T5b/T7/T8 允许仍红（属后续刀），但要如实贴数。
- hit_check / layer_check / creative_check / ui_check 全 exit 0；audit 只允许 31337 C4 那条既有红。

结果追加进 docs/A0A_REPORT.md 的新节 §6 返工（别新建第三个报告文件），报出"素材不足吞牌"修复前后的对比数据
（可用一次性冒烟脚本量：出一次付不起的墙，前后牌数与魔力的变化）。