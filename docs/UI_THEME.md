# UI_THEME · 换皮手册（2026-10-17）

这一页写"像素 UI 是怎么拼出来的、改哪里、谁拦着"。样式唯一真源是 `src/ui/theme.css`，
素材在 `assets/ui/`，卡面图标是烘焙数据 `src/ui/card-icons.js`。

## 1. 令牌（theme.css 的 :root）

- 色板：`--ink-0..4`（底）、`--line-1/2`（线）、`--brass/--brass-hi/--brass-dim`（黄铜）、
  `--txt-1..3`、`--hp/--sh/--mn/--mat/--ok/--bad`、`--el-*`（元素色别名，必须与 `G.ELEMENTS` 同值）。
- 尺度：4px 网格 `--s1..s6`；字号 `--fs-1..5`（12/14/16/22/32，`ui_shot --gate` 会量）。
- 字族：`--font-ui/--font-num` 都是 **Fusion Pixel 12px**（`assets/fonts/…woff2`，OFL）。
- 边框：元素本身 `border:0`；像素框由 `::after` 伪元素画 `border-image`（`ui_shot` 只量元素边框，伪元素不破坏“0/2px”规则）。

## 2. 9-slice 框（自绘）

```bash
node tools/make_ui_frames.cjs   # 生成 assets/ui/theme/*.png（48/32px，零依赖 PNG）
```

| 文件 | 切片/宽度 | 用途 |
|---|---|---|
| panel.png | 12 / 12px | 菜单、结算、背包外框 |
| panel-inner.png | 6 / 6px | HUD 小面板、区块、快捷栏 |
| button.png / button-hover / button-pressed | 8 / 8px | 普通 / 悬停 / 按下 |
| button-pri.png | 8 / 8px | 主按钮（黄铜） |
| slot.png / slot-sel / slot-deny | 6 / 6px | 格子 / 选中金框 / 拒绝红框 |

改配色：改 `tools/make_ui_frames.cjs` 顶部的调色板常量（BASE/INNER/BTN/SLOT…），重跑生成；不要在 CSS 里画死颜色。

## 3. 卡面图标（烘焙）

```bash
# 需要先把 Kenney Tiny Dungeon 解压到 /tmp/ui-assets/tiny
node tools/make_card_icons.cjs   # 生成 src/ui/card-icons.js（调色板 + 索引，76 卡映射）
```

- 源：Kenney Tiny Dungeon（CC0）的 16×16 像素块；映射表在生成器顶部 `MAP`。
- `src/ui/art.js`：先铺元素暗底 → 元素色 1px 内框 → 图标（整数倍放大 + 1px 暗影）→ 受光/压暗边 → 稀有度角标。
- 加卡：在 `MAP` 里补一行 `cardId: 'tile_xxxx'`；没映射的卡回退到旧程序图案。

## 4. 菜单主视觉

`assets/ui/theme/hero.png` 是用 Tiny Dungeon 的墙/地板/门/火把/法师/宝箱拼的 640×192 场景，
在 `src/ui/panels.js` 的 Menu 里以 `.ui-menu-hero` 显示；要换构图就重拼这张图（保持 10:3 左右）。

## 5. 规则与门禁

- 颜色只能来自 `:root` 令牌（`ui_shot --gate` 的 F 项）；不写圆角、模糊阴影、渐变（E/其它项）。
- 玩家可见中文只在 `src/hud.js` 的 `H.TEXT`；UI 层零中文（`layer_check`）。
- 面板结构在 `src/ui/panels.js` 的 spec，不写内联 style/z-index。
- 改完跑：`ui_check` + `creative_check` + `layer_check` + `ui_shot --gate`（1440×860@dpr1 与 1280×720@dpr1.5），再逐张看图。
