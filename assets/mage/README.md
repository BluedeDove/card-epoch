# assets/mage · 玩家角色素材（构建输入）

这里的 PNG 是**第三方素材原件**，一个字节都没改过；游戏不直接加载它们。
运行时读的是 `src/hero-sprites.js`（由 `node tools/hero_bake.cjs` 从这些 PNG 生成的纯数据表）。
换素材 → 改 tools/hero_bake.cjs 的取框表 → 重新生成，不要手改生成物。

## 出处与许可（CC-BY 3.0，必须署名）

- 作品：**Wizard sprite sheet**
- 作者：**movicx**
- 页面：https://opengameart.org/content/wizard-sprite-sheet
- 许可：CC-BY 3.0（可商用、可修改，但必须署名）
- 完整素材集（含 attack / idle 全套）另存一份在 docs/RESEARCH_SOURCES.md 供对照取框。

署名同时登记在 `docs/ASSET_CREDITS.md`。**游戏内的署名行还没加**：HUD 与 `H.TEXT` 属另一条工作线的文件，
等那边的会话提交后，在 `H.TEXT` 的"关于/帮助"里补一行 `像素素材：Wizard sprite sheet · movicx (CC-BY 3.0)`。

## 文件与用法

| 文件 | 内容 | 烘焙里用来做什么 |
|---|---|---|
| walk down.png | 4 帧，面向观众（正面） | 公告牌 front_walk + 盒模型正面贴图 |
| walk up.png | 4 帧，背向观众 | back_walk + 盒模型背面 |
| walk left.png | 5 帧，从角色左侧看 | left_walk |
| walk right.png | 5 帧，从角色右侧看 | right_walk |
| mage_idle.png | 7 帧待机 | 暂存不用：素材把杖画在另一只手，与走路系列混用会"跳边"，站桩改用 front_walk[0] |
| attack front.png / attack behind.png | 7 / 6 帧施法 | atk_front / atk_back（左右侧的施法暂时复用正面的那套） |

## 已知素材自身的不一致（下次换素材时注意）

1. 走路系列的法杖在角色的**左手**，idle 与 attack 系列画到了另一侧 → 站桩不能用 idle 套（已在 hero-rig 里注释说明）。
2. 素材没有跳跃帧 → 腾空时借走路系列第 2 帧 + 骨架的 squash。
3. walk up/left/right 三张是 **Adam7 交错 PNG**，解码器在 tools/hero_bake.cjs 里自带（无第三方依赖）。
4. 阵营配色只替换素材的绛红点缀（帽带/围巾/袖口/法杖火焰），皮带的棕、袍子的灰、肤色一个都不动
   ——`node tools/hero_check.cjs` 里有断言守着这条。
