# 页面路由与「战前选牌」阶段（2026-10-18 定）

> 用户要求：主菜单升级为**路由**，后续玩法通过「选关页面的那个类」追加；联机模式先做一个
> **CS:GO 式开局选牌**的简单 demo（双方各自选牌 → 开局 → 占矿/对打），更多玩法以后再加。
> 地图按之前那版改动（默认 duel-64、三矿 120°/60° 布置、96/128 按 SX/64 缩放并标实验）保持不变。

## 1. 路由（唯一新增的导航真源）

`src/app/router.js` → `window.GW.Router`。**路由是页面级的唯一真源**：
谁在前台、场景是谁、面板显隐、地址栏 hash，全从它派生；`Scene` 仍只回答"暂停/指针"这两件事。

| 路由 | scene | 面板 | 说明 |
|---|---|---|---|
| `menu` | menu | menu | 标题 |
| `level` | level | level | 选关（地图 × 规则 × 模式）——**新玩法的扩展点** |
| `loadout` | loadout | loadout | 联机战前选牌（仅 net 模式经过） |
| `match` | match | — | 对局 |
| `result` | result | result | 结算 |

API（`src/app/router.js`，纯逻辑，不写 DOM、不拼文案）：

```
G.Router.go(name, params)      // 切换路由：更新 hash、压栈、Scene.enter、通知监听者
G.Router.replace(name, params) // 同上但不压栈（开局/结算这类向前不可回）
G.Router.back()                // 回上一页（栈空回 menu）
G.Router.start()               // 读 location.hash 完成首次落位（缺省 menu）
G.Router.current()             // {name, params, route}
G.Router.on(fn)                // 订阅 (next, prev)
G.Router.href(name)            // '#/name'
```

约定：

- hash 形如 `#/level`；`hashchange`（用户按浏览器后退/手改地址）也走 `go`，栈不重复压。
- 装配层（main.js）订阅路由：显示/隐藏对应面板、交还指针、决定主循环暂停——**这些仍归 hud/scene**。
- 地址栏 hash 只是可观测的副作用（方便调试与以后分享链接），不作为唯一状态：`file://` 下同样可用。

## 2. 战前选牌（loadout）

**只在联机模式经过**：`level` 里点「开始对局」→ 连接 → `joined` → `loadout` → 双方就绪 → `match`。
单人训练 / 分屏不经过这一页（保持今天的一步开局）。

规则（demo 版，先简单）：

- 卡池 = 全部 `G.CARDS`；每张**最多 2 张**；每人**正好 12 张**组成这一局的牌库（替换 starter）。
- **地形卡 ≥ 4 张**（Kimi 方案 B 的既有约束：这是挖掘游戏，不带挖掘卡是非法构筑）。
- 双方各自选，互不可见对方选了哪些；就绪后**房主**用双方牌库建局（种子与关卡不变）。
- 未就绪/人数不足时显示等待文案；返回 = 断开连接、回选关。

协议（v4，追加在 NET.md §5 的表后）：

| 帧 | 方向 | 内容 |
|---|---|---|
| `loadout` | guest→host | `{deck:[cardId…], ready:bool}`（重复发送取最新；未就绪时 deck 可为空） |
| `lobby` | host→guest | `{hostReady, guestReady, waiting:bool}` |
| `start` | host→guest | `{seed, config:{map,rule}, decks:[hostDeck, guestDeck]}` |

房主侧校验（服务端口，不是 UI）：12 张、≤2 份、id 合法、terrain ≥4；不合法 → 不进入 `start`，回 `lobby` 带 `reject`。

## 3. 扩展点（以后加玩法只动这两处）

- **规则/玩法**：`src/app/rule-presets.js` 加一条 + `H.TEXT.level.ruleNames/ruleNotes` 加两句 → 选关页面自动多一张规则卡。
- **页面**：`src/app/router.js` 的 ROUTES 加一行 + `src/ui/panels.js` 加一个 Panel + `H.TEXT` 文案；装配层只加一个 `showX`。
  不新建第二套导航，不再用 `Scene.enter` 裸跳（新代码一律走 Router）。
