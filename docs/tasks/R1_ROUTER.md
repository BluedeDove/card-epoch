# 任务 R1 · 页面路由（主菜单升级为路由）

先读：`docs/ROUTER.md` §1、`src/app/scenes.js`、`src/main.js` 的 menuScene / start / beginLoop / onMatchOver / toLevelScene / menuActionKey / resultAction。
只允许修改：新建 `src/app/router.js`、`src/app/scenes.js`（只加 loadout 场景）、`index.html`（加 1 个 script）、`src/main.js`（导航改走 Router + 一个路由监听）、新建 `tools/router_check.cjs`。
**不许**碰 `src/ui/*`、`src/hud.js`、`src/net*.js`；不许 git commit；不许改既有断言。

## 要做的事

1. 新建 `src/app/router.js`：按 `docs/ROUTER.md` §1 的 API 实现 `G.Router`（go/replace/back/start/current/on/href）。
   - 路由表：`menu`/`level`/`loadout`/`match`/`result` → `{scene, panel}`；未知名字回 `menu`。
   - `go/replace` 更新 `location.hash = '#/' + name`（`typeof location !== 'undefined'` 守卫；hash 相同不重复写）；
   - `go/replace` 调 `G.Scene.enter(route.scene, params)`（Scene 仍答暂停/指针）；
   - `start()` 读 `location.hash`（`#/xxx` 或空 → menu），首次落位**不压栈**；注册 `hashchange` 监听走上同一条 go；
   - 栈只记 name（不记 params），`back()` 栈空回 menu；被 hashchange 触发的 go 不重复压栈。
   - **零 DOM 拼接、零玩家可见文案**：不写 document.*、不拼 HTML、不出现中文字面量（layer_check 会查）。
2. `src/app/scenes.js`：SCENES 加 `loadout: { id:'loadout', panels:['loadout'], pausing:true, pointer:'free' }`。
3. `index.html`：在 `src/app/scenes.js` 之后、`src/main.js` 之前加 `<script src="src/app/router.js"></script>`。
4. `src/main.js`：把所有**页面级**导航改成走 Router（面板显隐、hud 状态仍留在装配层）：
   - 加一个 `function onRoute(next, prev)`：按 `next.name` 显隐面板（menu: showMenu/hideLevel/hideResult；level: hideMenu/showLevel/hideResult；loadout: 全隐 + 若 `G.HUD.showLoadout` 存在则 `showLoadout(next.params)`；match: 全隐；result: `H.showResult`——`onMatchOver` 里原有的 showResult 流程照旧，别在监听里重复调）。
   - 启动：用 `G.Router.start()` 取代现在那段"首屏进菜单"（`menuScene()` 里 `Scene.enter('menu')` 那段），并 `G.Router.on(onRoute)`；
   - `toLevelScene(on)`：on → `Router.go('level')`；off → `Router.go('menu')`（函数名保留，别把调用点全改一遍）；
   - `beginLoop` 的 `Scene.enter('match', …)` → `Router.replace('match', {mode, seed})`；
   - `onMatchOver` 的 `Scene.enter('result', …)` → `Router.replace('result', …)`；
   - `menuActionKey('level')` 仍是 `toLevelScene(true)`；结算的 'menu' → `Router.go('menu')`；'level' → `Router.go('level')`；
   - 选关按 Esc 的判定从 `Scene.is('level')` 改成 `Router.current().name === 'level'`。
5. 新建 `tools/router_check.cjs`（node）：先铺 `global.window = { location:{hash:''}, history:{back(){}}, addEventListener(){} }` 与一个假的 `G.Scene`（记录 enter 调用），再 require router.js。断言：
   R1 路由表含 5 个名字；R2 默认落位 menu；R3 `#/level` 落位 level 且调了 Scene.enter('level')；R4 未知名字回 menu；
   R5 go 更新 hash 为 `#/level` 并发通知（next/prev 正确）；R6 replace 不压栈、go 压栈；R7 back 从 level 回 menu；栈空 back 仍是 menu；
   R8 href(level) === '#/level'；R9 `hashchange` 触发后 current 跟着变；R10 静态：router.js 里没有 `document.` / `innerHTML` / 中文字面量 / `G.HUD`。

## 验收（自己跑，贴真实输出）

```
node tools/router_check.cjs
node tools/scene_check.cjs
node tools/level_check.cjs
node tools/layer_check.cjs
node tools/ui_check.cjs
node tools/creative_check.cjs
node tools/audit.cjs
```

判据：router_check 全绿；scene_check 11 条不减少；level_check 128；layer 退出 0；ui 140 / creative 53；audit 三种子全绿。

## 报告
改了哪些文件；7 条命令关键输出；不确定处。