# 任务 T7 · 量具与文档收口（选关 + 多图 + 经济）

先读：`docs/CARD_ECONOMY.md` §5、`docs/LEVELS.md` §5、`AGENTS.md` 的『目录地图』与『改哪层必跑哪条』。
只允许修改：`tools/play_probe.cjs`（只改 L6 一条与它的注释）、`README.md`、`AGENTS.md`、`docs/REFACTOR_STATUS.md`。不许 git commit。

## 要做的事

1. `tools/play_probe.cjs` 的 L6：旧判据是『main.js 里写死的 size 必须等于 64×36×64』，
   它现在既读不到（尺寸已搬到 `src/app/session.js` + `src/app/map-presets.js`）也不再正确（关卡可选三张图）。
   改成新判据并改注释：
   - 读 `index.html` 静态文本，断言 `src/app/map-presets.js`、`src/app/rule-presets.js`、
     `src/reachability-gate.js`、`src/lode-planter.js`、`src/lode-system.js` 都被加载；
   - 读 `src/app/session.js`，断言它出现 `mapPresetFor` 且**不出现** `size: [96, 40, 96]` 这类写死尺寸；
   - 断言 `G.MAP_DEFAULT` 的尺寸恰为 `64×36×64`（默认图 == 量表图，这条就是旧 L6 的本意）；
   - 断言名改成『L6 默认图 == 量表尺寸（64×36×64）且尺寸来自 map-presets』。
   理由写进注释：多图之后『量表 64 == 发布 64』这个判据失去意义，替代它的是『每张发布图都被 lode_scale_check 量过』。
2. `README.md`：
   - 顶部『怎么运行』之后加一段『怎么开一局』：标题 → 选关（地图 × 规则 × 模式）→ 对局；列出三张图、三条规则的一句话；
   - 把『玩法一句话』里『代码尚未落地』改成当前事实（占矿计分、三选一、晶甲兽、素材按格扣、以太晶 12 秒再生已落），
     并链接 `docs/CARD_ECONOMY.md` 与 `docs/LEVELS.md`；
   - 文件结构表补：`src/cards/pick-pools.js`、`src/app/rule-presets.js`、`src/lode-planter.js`、`src/lode-system.js`、`src/reachability-gate.js`；
   - 追加一节『第十一轮：卡牌经济与选关』，只写**实测数字**（从 T1–T6 的报告里抄：起始 3/8/8、0.9/s、1/3s 分、+1/6s 素材、12s 晶体重生）。
3. `AGENTS.md`：
   - 『目录地图』表补上面 5 个文件与 `docs/CARD_ECONOMY.md` / `docs/LEVELS.md`；
   - 『玩法与临时形态』一节：把『玩法定案 v1 已出，落地进度…』更新成当前事实（A0 数值、A2 三选一/晶甲兽/再生已落；
     分屏与训练 AI 仍是脚手架）；删掉已经过期的『main.js 发布尺寸暂退回 96』说法，改成『地图由选关决定』；
   - 『改哪层 → 必跑哪条』表补一行：动了 `src/lode-*.js` / `pick-pools.js` / `rule-presets.js` → 必跑 `tools/econ_check.cjs` + `tools/draft_check.cjs` + `tools/beast_check.cjs` + `tools/lode_scale_check.cjs` + `tools/level_check.cjs`；
   - 键位/操作一节补：选关界面 Esc 返回标题。
4. `docs/REFACTOR_STATUS.md`：结构清单补新文件与新场景（`level`）、菜单已拆成 menu → level。

## 验收（自己跑，贴真实输出）

       node tools/play_probe.cjs 490706 1 10800 starter 1
       node tools/lode_scale_check.cjs
       node tools/level_check.cjs
       node tools/econ_check.cjs
       node tools/draft_check.cjs
       node tools/beast_check.cjs

判据：play_probe 的 H/U 组全绿、L1–L5 全绿、L6 按新判据转绿；其余五个量具全绿。
文档只写不变量、口径与实测数字，不写计划口吻；不许把没验证的东西写成事实。

## 报告
改了哪些文件；6 条命令关键输出；文档里新增/删掉的断言分别是什么。