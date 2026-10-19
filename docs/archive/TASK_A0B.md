# 任务书 A0-b · 卡牌数值收尾与 starter 补齐类型（派给子代理）

先读 docs/GAMEPLAY.md §2.2 表格、§2.3 第一条、§4 的 A0 行；口径以定案为准，不要自己发明数值。
范围：js/cards.js、js/battle.js（只允许动复活补魔那一行）、tools/play_probe.cjs（只许新增断言）。
红线不变：index.html、js/hud.js、js/ui/**、js/main.js、js/creative.js、js/camera.js、js/hero-*.js、
js/chem.js、js/vfx*.js、js/net.js、src/ 不许动；不许改任何既有断言阈值；不许 git add/commit。

## 四件事（都是定案 §4 的 A0 行，逐条照做）
1. **直伤降档**（压对轰天花板）：strike 7→6、bolt 14→11、void_lance 21→16、bloom 18→13、shard 8→7。
   其余伤害卡本轮不动；hit_check 的单发伤害区间断言是按卡面定义算的，降档后应自然通过——
   若它红，先怀疑自己改错了数，不要去动断言。
2. **0 费过牌改 1 费**：draw1（沉思）与 gift（虚空馈赠）的 cost 0→1，防"零成本滚牌库"击穿魔力经济。
   gift 的 -4 自伤代价保留（且必须仍穿透护盾与无敌帧，R1 的成果不许回退）。
3. **starter 补齐 5 个类型**：默认牌库里 sigil / summon / utility 目前一次都没出现过（探针 T5b 长期红），
   把这 5 类各至少塞进 1 张，让默认对局真正覆盖全部结算分支（这是"56 张卡是测试矩阵填充物"那条定性的兑现）。
   选卡优先选能测到独立分支的：一张 sigil（如 spike_field 一类地面阵）、一张 summon、一张 utility（优先 harvest，
   让默认局第一次有素材来源）。改完贴出 STARTER_DECK 的最终 12 张。
4. **复活不再补魔**：battle.js 的 respawnPlayer 里 p.mana = min(cap, 4) 改为 min(cap, 2)。
   理由写进注释：死亡奖励 4 点魔力约等于 4 秒回复量，把"送人头"变成了可接受策略。

## 不许做
- 不许动 lives / 胜负规则 / 法阵 hp（那是 A1、以及 §7.4 步骤 4 SigilSystem 的事）；
- 不许为了让 T5b 绿就往 starter 里塞同类卡充数（必须真的让 sigil/summon/utility 各 ≥1 张在实战中出现过）；
- 不许改 T1/T3/T4/T5b/T9 任何阈值。

## 验收（真跑贴原始输出）
- play_probe 490706 1 9600 starter 12 改动前后各一遍：
  **T5b 应转绿**（terrain/spell/sigil/summon/utility 五类打出次数全部 >0）；
  T1 命中率、T3 掉血频率、T4 素材、T9 流转**不得劣化**（劣化就贴数字说明原因，别调阈值）；
  硬回归与 U 组必须 0 红；连跑两遍逐字一致。
- hit_check / layer_check / creative_check / ui_check 全 exit 0；audit 只允许 31337 C4 那条既有红。
- 新增至少一条断言：复活后 p.mana === 2（守住第 4 件事）。
结果追加进 docs/A0A_REPORT.md 的 §10（别新建报告文件）。