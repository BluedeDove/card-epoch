# 任务 T2 · 矿脉支持多图 + 浏览器挂载 + 地图尺寸透传

先读：`docs/LEVELS.md` §1.1 与 §3、`docs/CARD_ECONOMY.md` §7 最后一行。
只允许修改：`src/lode-planter.js`、`src/reachability-gate.js`、`src/app/session.js`、`src/app/map-presets.js`、
`index.html`（只加 3 个 script 标签）、`tools/play_probe.cjs`（**只修 L5 正则那一处笔误**），
并新建 `tools/lode_scale_check.cjs`。不许 git commit、不许碰 UI/文案/相机。

## 要做的事

1. `src/reachability-gate.js` 的 `check(w, spawnCells, lodes, opts)` 增加第 4 个参数：
   `opts.distMin` / `opts.distMax`（缺省 18 / 40，**64 图行为逐字节不变**）；
   返回值里带上 `range:[distMin,distMax]` 供量具汇报。原因注释写一句。
2. `src/lode-planter.js`：
   - 去掉 `if (w.SX !== 64 || w.SY !== 36 || w.SZ !== 64) return null`；
     改为 `if (w.SX !== w.SZ || w.SX < 64) return null`，并令 `var scale = w.SX / 64;`。
   - 所有与"距离"有关的常数乘 scale：`R_MIN = 18*scale`、`R_SPAN = 6*scale`、
     翼矿到中矿的环带 `[18,23]*scale`、两翼之间 `[18,40]*scale`；调用
     `G.ReachabilityGate.check(..., { distMin: 18*scale, distMax: 40*scale })`。
   - 与距离无关的（3×3 台面、候选环 6 格、步进 2 格、走廊 3 格宽、高差 ≤1）**一律不缩放**。
   - 注释写清：scale=1 时与今天逐格一致（play_probe H1/L1–L4c 是这条的守卫）。
3. `src/app/map-presets.js`：`duel-64` 的 `sea` 改成 `12`、`spawnPad` 改成 `9`
   （必须与 `tools/play_probe.cjs` 的 `makeWorld` 完全一致：`size:[64,36,64], sea:12`、World 默认 spawnPad=9；
   否则"量表验证过的图"和"玩家玩到的图"不是同一张）。`island-96` 保持 `12/9`，`atoll-128` 保持 `14/11`。
4. `src/app/session.js` 的 `buildWorld`：`S.world = new G.World({ size, sea, spawnPad, seed })`，
   其中 `size/sea/spawnPad` 来自 `G.mapPresetFor(cfg)`；`cfg.load` 时 seed 覆盖逻辑保持原样。
   注释写清"地图由关卡配置决定，不再写死 96×40×96"。
5. `index.html`：在 `src/world.js` 之后按序加
   `<script src="src/reachability-gate.js"></script>`、`<script src="src/lode-planter.js"></script>`、
   `<script src="src/lode-system.js"></script>`（三条都要，顺序：gate → planter → lode-system；
   位置放 world.js 之后、cards.js 之前即可）。**不要把这三个文件再加到别处**。
6. `tools/play_probe.cjs` 的 L5 断言现在写的是 `/js\\/lode-planter\\.src/`（迁移时替换坏的笔误，永远匹配不上）。
   只把它改成正确的 `/src\\/lode-planter\\.js/` 与 `/src\\/reachability-gate\\.js/`，断言文字不变。
7. 新建 `tools/lode_scale_check.cjs`（node，零依赖，风格照 `tools/map_check.cjs`）：
   - 遍历 `G.MAP_PRESETS` 的三张图 × 种子 `[490706, 88092, 31337]`：
     用 `G.mapPresetFor({map:{id}})` 的 size/sea/spawnPad 建 `G.World`、`generate()`；
     断言 `w.lodes && w.lodes.degraded === false && w.lodes.list.length === 3`；
     断言 `w.lodes.dists` 每一项都在 `[18*scale, 40*scale]` 内（scale = size[0]/64）。
   - 64 图额外断言：`w.lodes.dists` 的 range 就是 `[18,40]`（scale=1 不许被缩放污染）。
   - 每张图打印一行汇总（图 id / 种子 / 三矿坐标 / 距离 / fairScore），失败逐条列出是哪张图的哪条。
   跑 128 图会慢（几秒到十几秒），接受。

## 验收（自己跑，贴真实输出）

```
node tools/lode_scale_check.cjs
node tools/map_check.cjs
node tools/play_probe.cjs 490706 1 10800 starter 1
node tools/layer_check.cjs
```

判据：lode_scale_check 全绿（若某张图某 seed 退化，**如实贴出**，不许改判据、不许改种子）；
map_check 全绿；play_probe 的 H/U/L1–L4c/L5 全绿（L6 仍是原样目标线，不许动）；layer_check 退出 0。

## 报告

改了哪些文件各做了什么；4 条命令的关键输出（末尾 10–20 行，尤其 L5 是否转绿、三图 9 组的退化情况）；
没做到或不确定的地方。