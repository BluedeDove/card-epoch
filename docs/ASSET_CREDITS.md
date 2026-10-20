# 第三方素材署名表

| 素材 | 作者 | 来源 | 许可 | 用在哪 | 生成物 |
|---|---|---|---|---|---|
| Wizard sprite sheet（法师 4 方向走路 / 待机 / 施法） | movicx | https://opengameart.org/content/wizard-sprite-sheet | CC-BY 3.0 | 玩家角色（`src/hero-rig.js` 的公告牌与盒模型两条路径） | `src/hero-sprites.js`（`node tools/hero_bake.cjs`） |

- 原件位置：`assets/mage/`（构建输入，游戏不加载）与 `research/mage-character/`（完整套图，含全部 attack/idle 帧）。
- 游戏内署名行尚未加（HUD 属另一条工作线），登记在此处与 `assets/mage/README.md`。
- 加新素材时同时改这张表，并在 `tools/hero_check.cjs` / 对应回归里留下可机检的口径。

## UI（2026-10-17 新增）

- Kenney · UI Pack - Pixel Adventure（CC0）— assets/ui/kenney-pixel-adventure/
- Kenney · Pixel UI Pack（CC0）— assets/ui/kenney-pixel-ui/
- Fusion Pixel Font 12px（OFL）— assets/fonts/fusion-pixel-12px-proportional-zh_hans.ttf.woff2

- Kenney · Tiny Dungeon（CC0）— 卡面图标烘焙进 src/ui/card-icons.js（tools/make_card_icons.cjs 生成）
