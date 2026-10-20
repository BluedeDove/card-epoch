# UI 框架（src/ui/）· 施工说明

> 2026-10-17 重写。定位：**卡牌纪元的 UI 底座**——声明式书写、渲染顺序由一张表决定、与游戏世界之间只走意图通道。
> 改 UI 之前先读这一页；分层硬规则仍以 [AGENTS.md](../AGENTS.md) 为准。
>
> 验收口径：`node tools/ui_check.cjs`（96 条：堆叠代数 + 静态分层 + 真页面冒烟）、
> `node tools/creative_check.cjs`（53 条：含用户报过的真鼠标点卡、指针交还、背包暂停、结算文案）、
> `node tools/layer_check.cjs`（分层责任制）。三段全绿 + **自己截图看图**，才算改完。

## 为什么要这么分

重写前的三个毛病，每一个都会让玩家骂娘、让下一个人改不动：

1. **帧循环里散落 DOM 写入**：每帧无条件改文本与 class，160FPS 下白写几百次，也没人说得清这一帧到底动了哪几个节点。
2. **z-index 各写各的**：面板自己在 CSS 里写 9999，谁后写谁压住谁——提示能盖住拖拽、拖拽能盖住背包（重构前确实是这样）。
3. **UI 反手抓逻辑层**：视图直接调 `G.Rules.canPlay`、改 `p.hand`、读 `window.GWAPP`。逻辑层因此没法单测，UI 换皮肤就得跨六个文件找逻辑。

底座就是对着这三条建的：**声明式 spec + 脏检查**、**图层顺序表**、**意图通道**。

## 模块地图（加载顺序 = 依赖顺序，见 index.html 的 script 段）

| 文件 | 职责 | 这一层不许有 |
|---|---|---|
| [src/ui/dom.js](../src/ui/dom.js) | 声明式 VNode：`h('div.ui-slot.sel#id', {...})`、Widget/Tree、keyed diff、写前比对的 write* | 业务、中文 |
| [src/ui/core.js](../src/ui/core.js) | Bus / **LAYER_TABLE 渲染顺序表** / UIApp 帧调度 / Panel 基类 | 具体面板、中文 |
| [src/ui/items.js](../src/ui/items.js) | 堆叠代数：容器四类、光标那一摞、`Ops.*`（拿起 / 对半 / 分堆拖 / 归拢 / 甩 / 丢弃） | DOM、THREE、中文、逻辑层 |
| [src/ui/channel.js](../src/ui/channel.js) | 意图词汇表 INTENTS + `bind/request/provide/ask/flush`（UI ↔ 游戏的唯一通道） | 直接改权威状态 |
| [src/ui/art.js](../src/ui/art.js) | 卡面 / 方块 / 牌背绘制（确定性随机、画法表） | 逻辑数值、中文 |
| [src/ui/widgets.js](../src/ui/widgets.js) | 复用件：Slot / SlotList / **List（三选一复用它）** / Feed / Chips / Tabs / Meter… | 中文 |
| [src/ui/viewmodel.js](../src/ui/viewmodel.js) | **唯一**读 match 的地方：把对局翻成平铺的 vm 字段，顺手把格位写进容器 | 出牌合法性判定（问 `channel.ask('canPlay')`）、DOM |
| [src/ui/drag.js](../src/ui/drag.js) | 全局委托：按下→阈值→拿起、拖过分堆、右键对半、双击归拢、ghost 与悬停提示 | 写权威状态 |
| [src/ui/panels.js](../src/ui/panels.js) | 十个面板的 spec（Topbar/Vitals/Aim/Log/Toast/Hotbar/Inventory/Choice/Menu/Result） | 自己写 z-index、中文 |
| [src/hud.js](../src/hud.js) | **门面 + 全项目唯一的玩家可见文案表 `H.TEXT`**；注册物品、装配 ViewModel 与通道 | 布局计算、规则判定 |

## 声明式怎么写一个面板

```js
class ScoreBoard extends UI.Panel {
  constructor() { super({ name: 'score', layer: 'panel', order: 30, pausing: false }); }
  spec(vm) {
    const C = this.copy;                       // this.copy = H.TEXT.score（文案只从这来）
    return h('div.ui-score', { children: [
      h('h2', { text: C.title }),
      h('div.ui-score-list', {
        list: (ctx) => ctx.vm.scoreRows,       // 数据变了才 diff，没变一个节点都不碰
        keyOf: (r) => r.id,
        cell: (r) => h('div.ui-score-row', { children: [h('span', { text: r.name }), h('b', { text: r.n })] })
      })
    ] });
  }
}
// 注册：UI.build 里 app.add(new ScoreBoard())；数据由 viewmodel 写进 vm.scoreRows；
// 动作只走 bag.want('ui.xxx', {...}) / ch.request('ui.xxx', {...})，不碰权威状态。
```

要点（都是踩出来的）：

- **`list` 容器由列表接管全部子节点**：静态标签要放在它外面另起一层，否则被 diff 掉（背包的弃牌堆标签就是这么消失的）。
- **动态类名走 `class:`(ctx)=>…**，别塞进 `c`（函数会被 join 成源码糊在 className 上）。
- **`title` 之类的属性放进 `attrs`**（写在顶层会被忽略）；回归脚本按 `title` 找卡面。
- **面板闭包里的 `vm` 就是 `app.model`**：ViewModel 就地写同一个对象，别在中途 `useModel` 换引用（换过一次，搜索框把字写进了废对象）。
- 需要被外部脚本认的锚点用 `id`（`W.Btn` 支持 `{id:'btnAgain'}`），历史回归靠这些 id 点按钮。

## 渲染顺序：只有那张表说了算

`core.js` 的 `LAYER_TABLE`，下标即层序：

```
backdrop < hud < hotbar(在 hud 里) < notice < menu < result < panel(背包) < choice < tooltip < drag
```

- `mount`：用 index.html 给的挂载点（#fade/#hud/#inv/#menu/#result），z 与样式归 CSS 管；
- `in`：在某个挂载点里建框架自己的子层（手持栏、toast 要跟 #hud 一起淡出）；
- `mount:null`：在 body 上建一层（提示、光标那一摞、**三选一**——它弹出时背包通常是关着的）；
- **框架自建的层一律 `pointer-events:none`**：图层只是排队的盒子，不是遮罩。哪个面板能点由它自己的根元素在 CSS 里声明（`.ui-hotbar` / `.ui-bag-box` / `.ui-choice`）。违反这条的现场事故：choice 层全屏吃鼠标 → 整个背包点不动。
- 面板**不许自己写 z-index**（ui_check 直接拦）。

## 两条流：数据往下、动作往上

```
match/creative --(H.update 每 60ms)--> ViewModel --写同一个 model 对象--> 脏面板 reconcile（只写真正变了的属性）
                                      ^                                          |
                                      |                                          v
                        main.js 的 handler <-- intents <-- Ops.*（点击/拖拽/双击）<-- drag.js 委托
```

- **权威容器（手持栏 / 牌库）永不本地改写**：`Ops` 只发意图，`Ops.resolve` 在游戏回 `{ok:true}` 之后才动光标。
  游戏说 `{ok:false}` → 手上必须还是空的（不许凭空多一张牌）。
- **意图必须先登记**：`channel.js` 的 `INTENTS` 是唯一词汇表。没人接的意图返回 `{ok:false,reason:'no-handler'}`，
  文案表里写的是“这条路还没接上（通道留着，等机制层）”——**不许假成功**。
  `ui_check` 反查两条：全项目说的每条 `ui.*` 都必须登记过；每个 `reason` 都必须在 `H.TEXT.ui.deny` 里有人话。
- **选中格现问现答**：点图鉴卡“放进选中格”用 `slotPolicy:'selected'`，由装配层读活的 `HUD.sel`；
  容器里的 `selected` 只是渲染快照，会慢一拍（拿它当目标就发生过“牌全塞进 0 格”）。

## 物品 ←→ 世界的通道（有意留着的口子）

`items.js` 里的 item 只有 `kind / id / count / meta`；`Art.paint` 按 kind 分发画什么。UI 不认识卡牌规则，世界也不认识 UI，
两边只通过 `ui.give / ui.takeFromHand / ui.spill / ui.dropOnWorld / ui.useSlot …` 说话。

现在 `main.js` 只接了卡牌相关的部分；**方块丢到画面上**（`ui.dropOnWorld` 且 kind==='block'）返回 `no-handler`——
以后接地形 / 放置机制时只需在 `bindUIChannel` 里加一个 handler，UI 一行不用改。

## 三选一 / 任何“选一个东西”的面板

**必须** `G.HUD.openChoice({ title, items, onPick, onSkip })`。它复用 `W.List` 与背包同一套指针归还 / 暂停逻辑；
[GAMEPLAY.md](GAMEPLAY.md) §7.3 明确拒绝为三选一另写一套列表 DOM。

## 组件的坑（真实踩过；写面板前先读，每条都对应一次「点了没反应」）

1. **列表类组件（`W.Chips` / `W.Tabs`）的 `items` 要传函数，不要传数组。** 数组被冻在第一次渲染时的模型上，
   表现是「页签永远只剩一页」「筛选片那一组空白」——模型后来灌满了也不重画。（旧实现只吃数组，现两种都收。）
2. **面板只看自己的 `copy` 段。** `Vitals` 读不到 `H.TEXT.inv`。中文的唯一正路：
   `channel.provide(...)`（hud 交文案）→ `viewmodel` 算成字段 → 面板只显示字段。
   抄近路的结果是玩家看见裸 key（`类别 all` 而不是 `类别 全部`）。
3. **权威格的 `slot` 不许带 -1 上意图**：用 `slotPolicy: selected` 或按指针算最近一格。装配层会把负数夹成 0，
   于是玩家拖到第 4 格、改的是第 1 格。
4. **被拒绝必须演出来**：`ui:notify` 要有人订阅、`Toast.push` 单位是**毫秒**。
   缺任一条，「不许假成功」就退化成「玩家看到的是一片沉默」。
5. **面板开着（逻辑暂停）也要喂视图模型**：`main.js` 的 `renderHudOnly` 按 60ms 调 `G.HUD.update`；
   少这一步就是「在背包里给了卡，画面不动」。
6. **视图状态数组只准就地改**：`G.HUD.sel = [0,0]` 会让视图模型继续读旧引用（滚轮换卡、环不动）。走 `G.HUD.resetSel()`。
7. **能随模型变的量一律写成函数**（`text` / `style` / `class` / `when` / `list`）；在 spec 里读一次值＝赌它以后不变。
8. **手牌三堆（hand / deck / discard）的改动**：`p.handClass = null` 是老行为（AI 与量表零漂移）；
   改这三堆必跑 `node tools/hand_check.cjs`——只有「三堆之和守恒」能机检「牌有没有被弄丢/无中生有」。

## 门禁

断言与违规的**条数以脚本输出为准**：本文与 AGENTS 都不缓存某一天的红/绿快照。

| 命令 | 管什么 | 它抓出来过的真 bug |
|---|---|---|
| `node tools/ui_check.cjs` | ① 堆叠代数（node 里直接跑 Ops）② 静态分层（src/ui/* 零中文 / 零 innerHTML / 不反向依赖 / 图层表冻结 / 意图词汇表反查）③ 真页面冒烟（真鼠标拖拽、悬停提示、背包暂停与恢复） | choice 层全屏吞鼠标；空角标留框；`list` 吞掉静态标签；点图鉴顺手改掉玩家选中格 |
| `node tools/creative_check.cjs` | 用户报过的行为回归：真鼠标点卡→放进选中格、面板开合的指针锁交还、背包暂停、结算面板文案与字段 | 模型对象被换→搜索失效；结算按钮点了没反应（意图没登记） |
| `node tools/layer_check.cjs` | 逻辑层碰 DOM / 写死中文 / 骨架塞文案 / 反向依赖 | 见 AGENTS 的“已被它当场抓出”清单 |
| `node tools/hand_check.cjs` | 类别手牌不变式：同类纯度、**hand+deck+discard 三堆之和守恒**（不造牌不吞牌）、同类打光不掺别类、未切类与老版逐字节等价、同种子可复现 | 我自己写错的 equipClass 把整个牌库覆盖了（丢牌），被「三堆之和守恒」当场打死 |
| `node tools/ui_shot.cjs --gate` | 八条样式量测 + 常驻层两两不相交；**两档视口都要跑**（1440×860@dpr1 与 1280×720@dpr1.5） | 键位带压住血条；分屏 P2 手持栏被 CSS 优先级拽到与 P1 重叠 |

改 UI 的提交口径：三条门禁全绿 + `node tools/audit.cjs`（没碰相机也要跑，它顺带验 file:// 起得来）+ **自己看图**
（菜单 / HUD / 背包三页 / 拖拽 / 悬停提示 / 三选一 / 结算 / 分屏各一张）。
“文件生成成功”不等于“看得清”——本仓库的规矩是交付前自己把图看一遍。