# 任务书 A0-a · 素材经济按格计价 + 血量归一（派给子代理）

先读：docs/GAMEPLAY.md（定案 §2.2、§7.1 条 7 与条 18 相关、§7.4 步骤 1/2、新增的 T8）、
docs/GAMEPLAY_BRIEF.md（现状事实）、docs/A1_REPORT.md（A-1 已完成的边界与遗留）。

## 要做的两件事（就这两件，别扩范围）

### 1) 素材按格计价，掐掉两个漏洞（js/rules.js 为主）
- 建造类地形卡现在**按卡扣 1 素材**（rules.js:156 附近 need = ef.mode === 'erase' ? 0 : 1），
  改成**按格扣**：一面 6 格墙就该扣 6 素材。定案理由：现在垒 9 格与放 1 格同价，价格信号失灵。
- 挖除的 give:true 返还（rules.js:164 附近）**删掉**，"1 魔力无限农素材"必须断掉。
- **纪律**：格子数只能问 CellCollector 那条已有路径（9 格上限就是它数的）。
  不许在 effect 分支里再数一遍格子、再算一份价格——那会造出第二个价格真源（定案 §7.3 明确拒绝的写法）。
  素材不足时的行为保持不变（结算器已有"素材不足，改造失败"的拒绝路径，别新造一套）。

### 2) 血量归一到结算器唯一出口（js/rules.js）
- 全项目只有一处 hp 归零检查（rules.js 的 R.damage 里），而 loseHp（虚空馈赠的代价）直接 p.hp -= 绕过了它，
  实测能把血扣到 -28 还不结算死亡。改成走 R.damage(t, amount, 'self', ctx, null) 或补同样检查。
- 目标是"以后新增任何扣血分支都不会漏判"，不是只把这一条堵上：请把它写成结算器内的统一入口，别留散落判定点。

## 顺带补一条机检（这是定案承诺过的 T8）
在 tools/play_probe.cjs 加一条目标线：**玩家复活后 1 秒内不得处于"自身被埋"状态**。
背景：A-1 把出生点改成开局缓存（match.spawnPts），复活点不再随地形变化漂移；对手把出生区改掉之后，
复活可能落在方块里，现在只靠 unstick 在 8 tick 内硬顶出兜底（玩家会看到"被地形卡住，已顶出"）。
这条是目标线，允许现在是红的，但必须如实报出实测值。

## 禁止
- 不许碰 index.html、js/hud.js、js/ui/**、js/main.js、js/creative.js（UI 线地盘）；
  不许碰 js/camera.js、js/hero-*.js、js/chem.js、js/vfx*.js、js/net.js、src/。
- 不许改 tools/play_probe.cjs 里已有断言的阈值来让它变绿；不许动任何 tools 的判定口径。
- 不许碰 docs/GAMEPLAY*.md、AGENTS.md（真源由机制线维护）。
- 不许 git add / git commit。
- **已知红项不用修也不要绕**：node tools/audit.cjs 的 seed 31337 C4（pitch=0.55 躯干没压准星却被整具隐藏，入画 7/8）
  是模型线在 HEAD 里就有的未收口项（公告牌部件世界 AABB），A-1 已用固定内容对证明与机制层无关。
  你若想"顺手修好它"就是越界，写进报告即可。

## 验收（真跑并贴输出）
1. node tools/play_probe.cjs 490706 1 9600 starter 12：
   **T4 终局素材 ≤24 应转绿**（A-1 后基线是 79/84）；T5b/T7 仍按设计红着（属后续步骤）；H 组必须全绿；
   新增的 T8 如实报实测。贴改动前后两版数字。
2. node tools/hit_check.cjs、node tools/layer_check.cjs、node tools/creative_check.cjs、node tools/ui_check.cjs 全 exit 0。
3. node tools/audit.cjs：只允许 31337 那一条既有 C4 红，其余不得新增（请贴出与前一轮的一致性证据）。
4. 素材曲线自检：报出典型对局里"垒一面墙要等多少秒收入"，与定案 §2.2 的对账表（6 格墙 ≈14 秒）比是否一致；
   不一致就报数，别改定案。

## 交回
写进 docs/A0A_REPORT.md（唯一允许你新建的文件）：改了哪些行、素材从 79/84 降到多少、
每格计价对现有卡的单价影响表（wall2/bridge/icewall/obsidian_cage 等每张卡现在实际扣几素材）、
以及你发现的问题。不要顺手做 A0 的其它条目（卡牌数值、starter 补类型、复活不补魔都在下一刀）。