# UI 素材与审美方向（2026-10-17）

用户判断：现在的界面是"代码直接生成的粗制滥造"，要换成网上找的好看素材。
这一页定素材来源、许可、审美方向与落地方式；**具体样式实现按页替换，不一次性推倒**。

## 1. 选定素材（已下载到 assets/）

| 素材 | 位置 | 许可 | 用途 |
|---|---|---|---|
| Kenney · UI Pack - Pixel Adventure | assets/ui/kenney-pixel-adventure/ | CC0 | 面板/按钮/滑条/图标/装饰边 |
| Kenney · Pixel UI Pack | assets/ui/kenney-pixel-ui/ | CC0 | 9-slice 框（Ancient 的 tan/grey/brown、inlay、list） |
| Fusion Pixel Font 12px（简体） | assets/fonts/fusion-pixel-12px-proportional-zh_hans.ttf.woff2 | OFL | 中文像素字体（正文/数字/标题） |

许可文件随包保留：assets/ui/*/License.txt、assets/fonts/OFL.txt。
Kenney 是 CC0，不需要署名但会在 ASSET_CREDITS 里记；Fusion Pixel 是 OFL，必须保留许可副本。

## 2. 审美方向

**暗紫秘术 × 黄铜线框 × 羊皮纸卡面**（沿用现有色相，但换成有材质感的像素边框）：

- 底板：深靛紫（近黑），用 9-slice 的 tan/grey 框做"木框 + 铜钉"；不要现在的 2px 实线直边。
- 标题/数字：黄铜金 + 像素字；正文用雾紫白，压暗一级。
- 卡片：羊皮纸底 + 元素色顶部细带 + 9-slice 线框；稀有度用框色区分，不用发光模糊。
- 血/盾/魔力：像素分段条（不是圆角渐变），低血时才闪红。
- 交互：悬停只做 1px 提亮 + 位移 1px，不做缩放动画；按键有"按下"帧。

**不要**：模糊阴影、圆角、渐变玻璃、系统字体、程序画出来的卡面插画（后续卡面换素材或统一占位）。

## 2.5 卡面图标（2026-10-17）

- Kenney Tiny Dungeon（CC0）的 16×16 方块/武器/药水/角色图标，经 `tools/make_card_icons.cjs` 烘焙成 `src/ui/card-icons.js`（调色板 + 索引，零运行时解码）。
- `src/ui/art.js` 优先画烘焙图标（整数倍放大），未映射的卡回退到旧的程序图案；76 张卡全部有 map。

## 3. 落地方式（不引入构建）

1. `index.html` 里 `@font-face` 指向 assets/fonts/*.woff2，:root 的 --font-ui/--font-num 换成 Fusion Pixel。
2. 9-slice 用 CSS `border-image`（像素图必须 `image-rendering: pixelated`），面板/按钮/格子各选一张框；
   切片值写进 :root 令牌，不散落在各条规则里。
3. 颜色全部走 :root 令牌（--bg/--panel/--line/--brass/--txt/--dim/--hp/--shield/--mana/--el-*），
   禁止在 panels/spec 里写死颜色（layer_check 已拦 UI 层写死颜色）。
4. 像素字号刻度：12/14/16/22/32（ui_shot --gate 已经在量），换字体后重跑两档 dpr。
5. HUD 布局保持现有安全边距与图层表；只换皮肤，不改交互与 DOM 归属。

## 4. 顺序

1. 字体 + 令牌 + 9-slice 面板/按钮（菜单、HUD、背包、结算四个面板）；
2. 卡面：先统一"羊皮纸 + 元素带 + 框"的程序绘制（src/ui/art.js），素材插画后续按卡替换；
3. 移除 index.html 里旧 .ui-* 的直边/渐变规则，统一到新主题；
4. 每步跑 ui_check / creative_check / layer_check / ui_shot --gate（两档 dpr）并**逐张看图**。

## 5. 备注

- 角色贴图继续用 assets/mage（CC-BY，已有署名）；本次 UI 素材不涉及角色。
- 素材包里的 preview/sample 图不进运行时；只挑需要的 9-slice 与控件 PNG。
