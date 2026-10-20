# 任务 L1 · 战前选牌页（loadout 面板 + 文案 + 意图）

先读：`docs/ROUTER.md` §2、`docs/UI_KIT.md` 的五步、`src/ui/panels.js` 的 `LevelSelect`（照它的写法）、`src/hud.js` 的 `H.TEXT.level`/`H.config`、`src/ui/channel.js` 的 INTENTS。
前提：R1 已把 Router 落地（`G.Router.go('loadout', params)`、scenes 有 loadout、main 的路由监听会调 `G.HUD.showLoadout(params)`）。
只允许修改：`src/ui/panels.js`、`src/ui/theme.css`、`src/ui/viewmodel.js`、`src/ui/channel.js`、`src/hud.js`、`index.html`（只加 1 个挂载点）、`src/main.js`（只加 loadout 的意图处理与 `__GW_LOADOUT_PREVIEW`）、`tools/level_check.cjs`、`tools/ui_shot.cjs`。
不许 git commit；不许碰 `src/net*.js`、`src/app/router.js`、`src/app/scenes.js`。

## 要做的事

1. `index.html`：加挂载点 `<div class="menu hidden" id="loadout"></div>`；`src/ui/core.js` 的 LAYER_TABLE 在 `level` 之后加 `{ name:'loadout', mount:'loadout', pointer:'auto' }`（这条也在允许改名单位之内）。
2. `src/ui/viewmodel.js`：`build()` 里补 loadout 字段（全部只读、就地更新）：
   - `loadoutPool`：全部卡的条目（用注入的 `makeItem('card', id, 1, {card})` 生成，按 type/cost 排序），每项带 `count`；
   - `loadoutPicks`：已选条目（含 `n` 张数与总量）；
   - `loadoutCount` / `loadoutTerrain` / `loadoutReady` / `loadoutStatus`（状态 key，中文在 H.TEXT）。
   初始 `state.loadout = { picks: {}, ready: false, status: 'waiting' }`（**对象就地改**）。
3. `src/ui/panels.js` 新建 `class Loadout extends UI.Panel`（layer `loadout`，order 68，closable:false）：
   - 左栏：卡池（`W.List`，点击 = `ui.loadoutPick {id, delta:1}`；tail 显示已选张数）；
   - 右栏：已选列表（每行一个 × 按钮发 `ui.loadoutPick {id, delta:-1}`）、计数行（`总 12 / 地形 n/4`）、
     `就绪`（pri；未满 12 张或地形 <4 时 `disabled` 并显示缺什么）、`返回`（`ui.loadoutBack`）；
   - 顶部状态行读 `vm.loadoutStatus`（等待对手/已就绪/对手已就绪/被拒绝原因）。
   - 所有中文进 `H.TEXT.loadout`；panels.js 一个中文字都不许有。
4. `src/ui/channel.js` 的 INTENTS 登记 `ui.loadoutPick` / `ui.loadoutReady` / `ui.loadoutBack`。
5. `src/hud.js`：
   - `H.TEXT.loadout`：`title/sub/hint/poolHead/pickHead/ready/back/waitPeer/readySelf/peerReady/bothReady/needCount/needTerrain/reject/roles`（按需，全部中文只在这里）；
   - `H.showLoadout(params)` / `H.hideLoadout()`；`H.loadoutPicks()`（返回 `vm.state.loadout.picks` 的浅拷贝）、`H.setLoadoutStatus(key)`、`H.markLoadoutReady(bool)`；
   - 绑定 `ui.loadoutPick`：改 picks（上限 2/张、总数 12），超限返回 `{ok:false, reason:'limit'}` 并 toast 人话；`ui.loadoutReady` 交回装配层（见 6）；`ui.loadoutBack` 交回装配层。
6. `src/main.js`：
   - `hud.handlers` 已由 `G.HUD.init({...})` 注入；新增 `loadoutReady(picks)` 与 `loadoutCancel()` 两个 handler（默认实现：net 未接时 toast `H.TEXT.loadout.waitPeer`，N5 会接真逻辑）；
   - 路由监听里 loadout 分支调 `H.showLoadout(next.params)`（R1 已留口，若没有就补）；
   - `window.__GW_LOADOUT_PREVIEW = function (n) { … }`：把 vm 的 picks 填成前 n 张（n 缺省 12，含 ≥4 张 terrain），`G.Router.go('loadout', {role:'host', room:'PREVIEW'})`，**只给截图/回归用**，注释写明。
7. `tools/level_check.cjs` 加静态断言：index 有 `#loadout`；scenes 有 loadout 且 pausing；core 的 LAYER_TABLE 含 loadout 且顺序在 level 后；panels.js 有 `class Loadout`；H.TEXT.loadout 存在且 ready/needTerrain 文案非空；main 里三个意图都有人接。
8. `tools/ui_shot.cjs`：加一张 `15-loadout`——调 `window.__GW_LOADOUT_PREVIEW(12)`，等 `.ui-loadout-box` 可见落图；再点一次某张卡（真鼠标）落 `16-loadout-picked`，证明点击真的加了一张。

## 验收（自己跑，贴真实输出）

```
node tools/level_check.cjs
node tools/ui_check.cjs
node tools/creative_check.cjs
node tools/layer_check.cjs
node tools/ui_shot.cjs --shots /tmp/gwlo --gate
node tools/ui_shot.cjs --shots /tmp/gwlo-15 --gate --viewport 1280x720 --dpr 1.5
node tools/audit.cjs
```

判据：level_check 全绿（含新增）；ui 140 / creative 53；layer 退出 0；两档 shot --gate 违规 0；audit 三种子全绿。
落图后**自己看 15/16 两张**：卡池两列不重叠、计数与按钮在视口内、窄屏不挤爆。

## 报告
改了哪些文件；7 条命令关键输出；两张图你看到的问题；不确定处。