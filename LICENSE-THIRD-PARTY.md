# 第三方素材与许可

本仓库的代码部分是 MIT（见 [LICENSE](LICENSE)）。**下面这些不是本项目写的**，各自按自己的许可分发；
再分发（含打包 zip、截图、视频）时请连本文件一起带走。

| 素材 | 作者 / 来源 | 许可 | 位置 | 用在哪 |
|---|---|---|---|---|
| three.js r128（minified UMD） | Three.js Authors · https://threejs.org/ | MIT | vendor/three.min.js（文件头自带 SPDX 声明） | 全部渲染 |
| Wizard sprite sheet（法师 4 方向走路 / 待机 / 施法） | movicx · https://opengameart.org/content/wizard-sprite-sheet | **CC-BY 3.0（须署名）** | assets/mage/（构建输入，游戏不直接加载） | 玩家角色：src/hero-rig.js 的公告牌与盒模型两条路径；生成物 src/hero-sprites.js（node tools/hero_bake.cjs） |
| UI Pack - Pixel Adventure | Kenney · https://kenney.nl/ | CC0 1.0 | assets/ui/kenney-pixel-adventure/（含 License.txt） | HUD / 面板 / 背包的 9-slice 贴片与图标（src/ui/theme.css） |
| Pixel UI Pack | Kenney · https://kenney.nl/ | CC0 1.0 | assets/ui/kenney-pixel-ui/（含 License.txt） | 按钮 / 槽位 9-slice 贴片 |
| Tiny Dungeon | Kenney · https://kenney.nl/ | CC0 1.0 | 已烘焙进生成物 | 卡面图标 src/ui/card-icons.js（node tools/make_card_icons.cjs） |
| Fusion Pixel Font 12px proportional（zh_hans） | TakWolf · https://github.com/TakWolf/fusion-pixel-font | SIL OFL 1.1 | assets/fonts/（含 OFL.txt 全文） | 全部玩家可见中文字形 |

## 署名要求（CC-BY 3.0 那一条）

任何再分发请保留下面这行：

> 像素素材：Wizard sprite sheet · movicx（CC-BY 3.0）

游戏内的署名行还没接进 HUD —— 登记在 docs/ASSET_CREDITS.md，接好之前以本文件与 assets/mage/README.md 为准。

Kenney 的素材是 CC0，无需署名（但欢迎）。字体是 OFL 1.1：可以随本仓库一起分发，
不许把字体文件改名后宣称是自己做的，assets/fonts/OFL.txt 必须跟着走。

## 不在本仓库里的东西

- 美术参考图（Minecraft / Noita 模组截图、法阵与印记图版，共约 18 MB）版权归原站与原作者，
  **不随本仓库分发**，只留出处链接：[docs/RESEARCH_SOURCES.md](docs/RESEARCH_SOURCES.md)。
- 音乐与音效没有任何第三方音频素材：全部由 tools/music_synth.cjs + tools/music_compose.cjs 用代码合成，
  wav 是不入库的生成物（audio/README.md 写了怎么逐位重建）。
- 浏览器自动化用的 Playwright 只是开发依赖，运行时不加载。
