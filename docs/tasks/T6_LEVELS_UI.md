# 任务 T6 · 选关界面（地图 × 规则 × 模式）与配置透传

先读：`docs/LEVELS.md` 全文、`docs/UI_KIT.md` 的"新增一个面板照这五步"、`docs/UI_DESIGN.md` 的令牌口径。
只允许修改：`src/ui/panels.js`、`src/ui/theme.css`、`src/ui/core.js`、`src/ui/channel.js`、`src/app/scenes.js`、
`src/app/session.js`、`src/app/map-presets.js`（把默认图改成 duel-64，见下）、`src/hud.js`、`src/main.js`、`index.html`（只加 1 个挂载点与 1 个 script）、`tools/map_check.cjs`（默认图断言跟着改），
并新建 `src/app/rule-presets.js`、`tools/level_check.cjs`。不许 git commit。

## 要做的事

0. **默认图 = duel-64**（`docs/LEVELS.md` §1.1）：`G.MAP_DEFAULT = 'duel-64'`，注释写明理由
   （三种子相机审计 15 项全过，含 88092；铺矿整平改了出生区，旧记录已失效）；
   `tools/map_check.cjs` 里 `默认 island-96` 与 `默认尺寸 96×40×96` 两条断言改成 duel-64 / 64×36×64，
   未知 id 回退断言也跟着改。选关面板的默认选中项 = `duel-64`。

1. 新建 `src/app/rule-presets.js`（纯数据，零 DOM、零文案）：三条规则照 `docs/LEVELS.md` §1.2 的表，
   `G.RULE_PRESETS[key] = { id, labelKey, scoreWin, timeCap, overtimeCap, holdGrace, beasts, draftCapLode, draftCapBeast, aiLevel }`；
   `G.RULE_DEFAULT = 'ranked'`；`G.rulePresetFor(cfg)` 返回展开后的 opts（未知 id 回退默认）。
   `index.html` 在 `src/app/map-presets.js` 之后加载它。
2. `src/app/session.js` 的 `buildMatch`：opts 加 `scoreWin/timeCap/overtimeCap/holdGrace/beasts/draftCapLode/draftCapBeast`（来自 `G.rulePresetFor(cfg)`）；
   `AISource` 的等级用 `opts.aiLevel`；`S.world` 的尺寸已由 T2 改成按地图预设。
3. `src/battle.js` 不在本任务改；如果 `timeCap/overtimeCap` 仍写死，就在这里**只改这两行为读 opts**（允许的最小改动，注释写明）。
4. 场景：`src/app/scenes.js` 加 `level: { id:'level', panels:['level'], pausing:true, pointer:'free' }`；
   `src/ui/core.js` 的 LAYER_TABLE 在 `menu` 之后加 `{ name:'level', mount:'level', pointer:'auto' }`；
   `index.html` 加挂载点 `<div class="menu hidden" id="level"></div>`（放在 `#menu` 之后）。
5. `src/ui/panels.js` 新建 `class LevelSelect extends UI.Panel`（layer `level`，order 69，可关闭）：
   左栏 = 三张地图卡（名称/尺寸/一句话/实验标记）、中栏 = 三张规则卡（胜分/时长/是否晶甲兽/一句话）、
   右栏 = 模式三个按钮（单人/分屏/联网）、种子输入 + 随机、卡组选择、[开始对局]（pri）与 [返回标题]。
   当前选中项用 `vm.level.map/rule/mode/deck/seedText`（视图状态，就地写，不许换对象）。
   面板自身 `onShow/onHide` 负责 `#level` 的显隐，不改 `#menu` 的显隐。
6. `src/ui/channel.js` 的 INTENTS 登记 `ui.levelPick`、`ui.levelStart`、`ui.levelBack`；
   `src/main.js` 的 `bindUIChannel` 接住：pick 写 vm 状态并回 `{ok:true}`；start 用当前选项组 cfg 调 `start(cfg)`；
   back 回 `Scene.enter('menu')`。**没人接就返回 no-handler，不许假成功。**
   `Menu` 的「进入世界」按钮改成发 `ui.menuAction {key:'level'}`（main.js 接住后 `Scene.enter('level')`），不再直接 start。
   `Result` 加「回选关」（`ui.resultAction {key:'level'}`）。
7. `tools/ui_shot.cjs`：shot 列表里加一张 `12-level`——真实路径：点菜单的「开始游戏」（真鼠标 click），
   等 `#level` 可见后落图；再按 Esc 回菜单落一张 `13-level-back`（证明返回可用）。不许只靠 `__dbg` 摆状态。
8. `src/hud.js`：新增 `H.TEXT.level` 段（标题、三栏小标题、每张地图/规则的一句话、实验提示、模式文案、
   按钮、联网未启用提示、种子占位符、卡组名）；`H.showLevel/hideLevel` 两个门面函数；
   `H.TEXT.menu.btnStart` 文案改成"开始游戏"。`src/ui/panels.js` 里不许出现中文。
9. 新建 `tools/level_check.cjs`（node）：断言三条规则的每个数值与 LEVELS.md 一致；未知 id 回退 ranked；
   `G.mapPresetFor` 三张图尺寸正确；`new G.Match({...rulePresetFor({rule:'blitz'})})` 后 `scoreWin===75 && timeCap===300`；
   用 `require('fs')` 查 `index.html` 含 `#level` 挂载点与 `src/app/rule-presets.js`；查 `src/app/scenes.js` 里 `level` 场景与暂停语义。

## 验收（自己跑，贴真实输出）

       node tools/level_check.cjs
       node tools/scene_check.cjs
       node tools/ui_check.cjs
       node tools/ui_shot.cjs --shots /tmp/gwt6 --gate
       node tools/ui_shot.cjs --shots /tmp/gwt6-15 --gate --viewport 1280x720 --dpr 1.5
       node tools/layer_check.cjs
       node tools/audit.cjs

判据：level_check 全绿；scene_check 全绿（11 条不许减少）；ui_check 全绿；两条 ui_shot --gate 全绿；
layer_check 退出 0；audit 三种子与基线一致（31337 的 C4/H 是已知基线红，不许新增红项）。
落图后自己打开 /tmp/gwt6 里的**选关界面**截图逐张看（三栏不重叠、文字不溢出、窄屏不挤爆）。

## 报告
改了哪些文件；7 条命令关键输出；选关界面截图你看到的问题与处理；不确定处。