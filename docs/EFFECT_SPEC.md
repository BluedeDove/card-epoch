# 效果 spec · 怎么加一张新卡而不改执行器

这一页只讲**新卡的数据怎么写**，以及哪些写法已经被 `tools/spec_cast.cjs` / `tools/effect_check.cjs` 证明能跑。
执行器的边界：`src/rules.js` 的出牌循环已经把 `card.effects` 过一遍 `GW.EffectSpec.expand`，
所以卡里可以写旧 op，也可以写 `cells`；两种都走同一条 `Rules.play`。

## 1. 地形：cells

```js
{
  id: 'my_wall', name: '我的墙', cost: 2, element: 'rock', type: 'terrain',
  requires: [], cooldown: 0,
  targeting: { shape: 'ray', maxDist: 9 },
  effects: [{ op: 'cells', mode: 'wall', block: 'brick', length: 3, height: 2, maxCells: 6 }]
}
```

- `mode` 取 13 种之一：erase / fill / column / bridge / wall / cage / bunker / moat / crater / ramp / shift / grow / layer。
- `block` 是方块 key（`blockKeyToId` 认识的那些，如 dirt / plank / brick / glass / ice）。
- `maxCells` 是这张卡的地形预算；不写按 `Rules.cardCellCap` 的缺省（9）。
- 出牌时报价、部分成交、超预算截断、压到玩家身上跳过，全部由 `rules.js` 的旧流水线负责，
  `cells` 只是在入口被归一化成 `setBlock` 的同一个执行分支（迁移期适配，行为与旧卡逐字节一致）。

## 2. 召唤 / 法阵

```js
{ op: 'spawn', kind: 'golem', count: 1, hp: 20, dmg: 5, ai: 'melee' }
{ op: 'sigil', sigilId: 'meteors', delay: 0.1, ttl: 1 }
```

- `spawn` 的 `kind` 决定配方与 AI；飞行体在 battle 的抛射物推进里算。
- `sigil` 的 `sigilId` 对应 `cards.js` / `G.SIGILS` 里已注册的仪式；`delay/ttl` 只覆盖本次布阵。
- 两者都走 `Rules.play` 的同一张卡校验（魔力、素材、冷却、requires、targeting），没有单独的入口。

## 3. 什么时候要动执行器

- **新 op**：先加进 `src/cards/effect-spec.js` 的 `KNOWN_OPS`，再在 `rules.js` 的 switch 里加一个 case；
  加完跑 `effect_check`（会拦未知 op）与 `spec_cast`（会拦“能展开但打不出来”）。
- **新 shape**：在 `effect-spec.js` 的 `CELL_SHAPES` 里登记；真正的格集仍由 `rules.js` 的 `cellsFor` 计算。
- **新地形预算**：卡上写 `maxCells`，别在 rules 里按卡 id 特判——`cards_probe` 会量“单卡地形 ≤ 9 格”的边界。

## 4. 验证

```bash
node tools/effect_check.cjs   # 76 张卡都能展开、无未知 op、确定性、可 JSON
node tools/spec_cast.cjs      # cells 建墙/铺板、召唤、法阵都能从 Rules.play 出
node tools/cards_probe.cjs    # 旧卡机制不回退
node tools/hit_check.cjs      # 命中/伤害不回退
```

## 5. 还没有的

- 执行器仍认旧 op（damage / status / spawn / sigil...），没有全部拆成“只认 AtomicOp”的处理器表；
  `cells` 是第一个走通的新 op。
- `EffectSpec.validate` 只查 op 与 shape 名字，不查数值范围；预算/压人/材料这些仍在 rules 的旧流水线里。
