# 任务 T1 · 经济与以太晶再生（只动权威层，不碰 UI）

先读：`docs/CARD_ECONOMY.md` 的 §1、§3.1、§3.2、§3.3、§5。
只允许修改这些文件：`src/battle.js`、`src/lode-system.js`、`src/rules/effects/harvest.js`，并新建 `tools/econ_check.cjs`。
**不许**改别的文件、不许 git commit、不许改文案、不许碰 `src/ui/` 与 `index.html`。

## 要做的事

1. `src/battle.js` 顶部加两个常量 `MANA_CAP = 8`、`MANA_REGEN = 0.9`（允许 `opts.manaCap`/`opts.manaRegen` 覆盖）。
   `makePlayer`：`mana: 3, manaCap: MANA_CAP, manaAcc: 0, regen: MANA_REGEN, mats: 8`。
2. `Match.prototype.step` 的玩家循环里，魔力累加改成：
   `var bonus = this.lodeSys ? this.lodeSys.manaBonusOf(p.side) : 0;`
   `p.manaAcc += dt * (p.regen + bonus);`
   `while (p.manaAcc >= 1 && p.mana < p.manaCap) { p.manaAcc -= 1; p.mana++; }`
   `if (p.mana >= p.manaCap) p.manaAcc = 0;`
   （复活 `p.mana = Math.min(p.manaCap, 2)` 已经是对的，别动。）
3. `src/lode-system.js`：
   - 构造时把 `world.lodes.list[i].crystals`（`[[x,y,z],…]`）展开成再生表 `this.crystals`：
     每项 `{x,y,z,t:0,givenUp:false}`，且记录它属于哪条矿（`lode:i`）便于量具读。
   - 新方法 `LodeSystem.prototype.onHarvest(x,y,z)`：命中表里某格就把它的 `t` 置 12（重复采只重置计时）。
   - 新方法 `LodeSystem.prototype.manaBonusOf(side)`：任一矿 `owner === side` 时返回 0.15，否则 0。
   - `step(dt)` 末尾加再生推进：`t > 0` 的格子 `t -= dt`；到 ≤0 时若该格当前是 `G.BLOCK.AIR` 就
     `match.world.set(x, y, z, G.BLOCK.CRYSTAL)` 并把 `t` 归 0；若当前不是 AIR（玩家在那砌了东西）
     就置 `givenUp = true` 且不再重试。**只在原位写、只写 AIR**；这是本类唯一写世界格子的路径，注释里写清边界。
   - 再生表长度恒定 ≤ 9，不许每 tick 扫世界。
4. `src/battle.js` 加 `Match.prototype.onCrystalHarvested = function (x,y,z) {` 转发到 `this.lodeSys`（没挂载时返回 false）。
5. `src/rules/effects/harvest.js`：在 `w.set(..., 0)` 那一行之后调 `ctx.match.onCrystalHarvested(t.x, t.y, t.z)`（守卫式调用）。
6. 新建 `tools/econ_check.cjs`（node，零依赖，风格照 `tools/hand_check.cjs`）：
   用 `require` 加载 src/world.js、src/cards.js、src/vfx.js、src/chem.js、src/rules.js、src/battle.js，
   以 `new G.World({ size:[64,36,64], seed:490706 })` + `generate()` + `new G.Match({...})` 驱动。断言：
   - E1 起始值 `mana===3 && manaCap===8 && mats===8`；
   - E2 空场跑 20 秒（400 tick，1/20）魔力 === 8 且 `manaAcc===0`（封顶）；跑 5 秒恰好 4（3+4=7，超过 8 才封顶，按累加器逐点断言）；
   - E3 手动把某矿 `owner=0` 后 `manaBonusOf(0)` 为 0.15、`manaBonusOf(1)` 为 0，且 `step(1.0)` 后第 0 位比基线多涨约 0.15（允许 ±0.01 的整点误差口径）；
   - E4 晶体：找 `world.lodes.list[0].crystals[0]`，`world.set(...,0)` 后 `onHarvest`，跑 12.1 秒 → 该格回到 `BLOCK.CRYSTAL`；
     在那格放 `BLOCK.BRICK` 再采一次 → 跑 13 秒仍是 BRICK，且该晶体 `givenUp===true`；再生表长度 ≤ 9；
   - E5 素材三源：站平台上独占 6.1 秒 mats +1；`G.RULES_EFFECTS.harvest` 打在晶体上 +1；
   - E6 复活：`p.mana=8; match.respawnPlayer(p)` 后 `mana===2` 且 `mats` 不变；
   - E7 占矿 3 秒 +1 分（独占）。
   输出格式与 `hand_check.cjs` 一致（PASS/FAIL 逐条 + 汇总 + 退出码）。
   注意：`new G.Match` 的 opts 参考 `tools/play_probe.cjs` 里的构造方式（fx 桩、players:2、cards）。

## 验收（必须自己跑，并把真实输出贴回来）

```
node tools/econ_check.cjs
node tools/layer_check.cjs
node tools/owner_check.cjs --strict
node tools/play_probe.cjs 490706 1 10800 starter 1
```

判据：econ_check 全绿；layer_check 退出 0；owner_check 不新增越界行（--strict 若原本就红，贴出前后对比）；
play_probe 的 H/U 组全绿、L5/L6 仍按原样（这两条是已知目标线，不许为了让它们变绿去改断言）。
T 组的变化照实贴，不要改阈值。

## 报告（最后一段）

列出：改了哪些文件各做了什么；上面 4 条命令的关键输出（各取末尾 10–20 行）；
没做到/不确定的地方（有就写，没有写"无"）。