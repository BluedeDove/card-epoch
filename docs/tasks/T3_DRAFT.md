# 任务 T3 · 三选一：卡池数据 + 名义群系 + Match.grantCard + 触发队列

先读：`docs/CARD_ECONOMY.md` §2（S2/S3/§2.1）、`docs/GAMEPLAY.md` §7.1 条 8/9。
只允许修改：新建 `src/cards/pick-pools.js`、`src/battle.js`、`src/systems/match-ops.js`、
`src/lode-system.js`、`index.html`（只加 1 个 script 标签），并新建 `tools/draft_check.cjs`。
**不许**碰 UI/文案（三选一面板的接线是 T5），不许 git commit。

## 要做的事

1. 新建 `src/cards/pick-pools.js`（纯数据，零函数以外的逻辑，零中文以外的东西）：
   `G.PICK_BIOMES = ['forest','desert','tundra']`；
   `G.PICK_POOLS = { forest: [...8 个卡 id], desert: [...], tundra: [...], neutral: [...] }`，
   具体 id 照 `docs/CARD_ECONOMY.md` §2.1 的表逐字抄（顺序也要一致）。
   `G.PICK_POOL_CN = { forest:'林海', desert:'黄沙', tundra:'雪原' }`（显示名，供 T5 的文案层取用）。
2. `src/battle.js`：
   - 构造函数里算 `this.lodeBiomes`：`var rngB = G.mulberry32((seed ^ 0xB10E) >>> 0)`，
     把 `['forest','desert','tundra']` 做 Fisher-Yates 洗成排列，按 `world.lodes.list` 的下标分配
     （矿少于 3 条就取前几条）。**不许消耗 `this.rng`**。
   - 另建专用随机流 `this.draftRng = G.mulberry32((seed ^ 0xD4A7) >>> 0)`（不与其他系统共用序列）。
   - `this.drafts = []`（待处理的三选一队列）；`this.draftCapLode = opts.draftCapLode ?? 3`、
     `this.draftCapBeast = opts.draftCapBeast ?? 3`；`this.draftUsed = {lode:[0,0], beast:[0,0]}`。
   - `Match.prototype.grantCard = function (p, cardId, times)`：校验卡 id 存在；`p.deck.push` ×(times||1)；
     `this.reshuffle(p)`；`this.touch('players', p.side)`；返回 `{ok, deckSize}`。
   - `Match.prototype.offerDraft = function (side, source, biome)`：
     查 `draftUsed[source][side] < cap`，否则返回 null；从 `G.PICK_POOLS[biome] || G.PICK_POOLS.neutral`
     复制一份、用 `this.draftRng` 做前缀洗牌取 3 张不重复；push `{side, source, biome, options}` 进 `this.drafts`；
     返回该 offer。**同一方同时只能有一个待处理 offer**：已有该方的 offer 时不重复入队（返回 null）。
   - `Match.prototype.pendingDraft = function ()` 返回 `this.drafts[0] || null`。
   - `Match.prototype.takeDraft = function (side, cardId)`：找到该方的 offer，校验 `cardId ∈ options`；
     `grantCard(p, cardId, 2)`；`draftUsed[source][side]++`；从队列移除；返回 `{ok, cardId}`。
   - `Match.prototype.skipDraft = function (side)`：移除该方 offer、`draftUsed[source][side]++`（跳过不返还）、返回 `{ok:true}`。
3. `src/systems/match-ops.js`：把 `grantCard` 登记成第 16 个具名方法（现有列表已冻结在 15 个，按 GAMEPLAY §7.0 条 3 的评审闸登记），
   并在注释里写"第 16 个：三选一选中卡入牌库（GAMEPLAY §7.4 步 7）"。
4. `src/lode-system.js` 的 `step`：在算出 `owner` 之后，若 `owner >= 0` 且该矿 `L.drafted[owner] !== true`，
   把 `L.drafted[owner] = true` 并调 `m.offerDraft(owner, 'lode', (m.lodeBiomes && m.lodeBiomes[li]) || 'neutral')`。
   （`drafted` 在构造时的每条矿上初始化为 `[false, false]`。）
5. `index.html`：在 `src/cards.js` 之前加 `<script src="src/cards/pick-pools.js"></script>`（它只依赖 window.GW）。
6. 新建 `tools/draft_check.cjs`（node，零依赖，风格照 `tools/hand_check.cjs`；构造方式照 `tools/play_probe.cjs`）。
   断言：
   - D1 三个群系池各 8 张、neutral 8 张、全部 id 都在 `G.CARDS_BY_ID` 里、池内无重复；
   - D2 `lodeBiomes` 三条互不相同；同 seed 两次构造相同；换 seed 至少有一次排列不同；
   - D3 玩家站上矿平台跑 0.1s → `pendingDraft()` 出现 `source==='lode'`、`options.length===3` 且互不相同、都来自该矿群系的池；
   - D4 再跑 1s 不会叠加第二个同方 offer（队列长度 ≤1）；
   - D5 `takeDraft` 后牌库 +2 张且包含该 id 两次、手牌不变、队列清空、`draftUsed.lode` +1；
   - D6 三条矿各占一次后第 4 次 offer 被拒（`draftCapLode=3`）；`skipDraft` 也计次数；
   - D7 换 seed 后同一矿的 options 序列不同（专用流确实被 seed 化）；
   - D8 非法输入：不存在的卡 id / 不属于该方的 offer → 返回 `{ok:false}` 且牌库不变。
   每条打印 PASS/FAIL + 汇总 + 退出码。

## 验收（自己跑，贴真实输出）

```
node tools/draft_check.cjs
node tools/hand_check.cjs
node tools/cards_probe.cjs
node tools/play_probe.cjs 490706 1 10800 starter 1
node tools/layer_check.cjs
```

判据：draft_check 全绿；hand_check 24 条全绿（手牌守恒不许被 draft 打破）；cards_probe 67 条全绿；
play_probe 的 H/U 组全绿、L 组与 T 组照实贴（不许改阈值）；layer_check 退出 0。
注意：`Match` 的 opts 现在多了 `draftCapLode/draftCapBeast`，play_probe 不传时应取默认 3。

## 报告

改了哪些文件各做了什么；5 条命令关键输出；不确定处。