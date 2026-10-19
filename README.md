# 卡牌纪元 · Card Epoch

像素 3D 体素卡牌对战：**卡牌真的会改地形** —— 挖坑、砌墙、点火、结冰、召飞、砸陨星，
越肩视角（over-the-shoulder）而不是贴眼 FPS。零构建、零运行时依赖（three.js 已本地化进 vendor/），
**双击 index.html 就能玩** —— 不用 npm install，不用打包，不用起服务。

> English: a zero-build, dependency-free voxel card battler in the browser. Double-click
> **index.html** and play. 76 cards actually rewrite the voxel world (dig, build, ignite,
> freeze, summon, meteor-rain), with an over-the-shoulder camera and LAN 2-player via a
> hand-written WebSocket host. MIT for the code; every third-party asset is CC0 / OFL /
> CC-BY and credited in [LICENSE-THIRD-PARTY.md](LICENSE-THIRD-PARTY.md).

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![no build step](https://img.shields.io/badge/build-none-brightgreen.svg)](#30-秒跑起来)

---

## 30 秒跑起来

1. 双击 **index.html**（**file://** 就行；Chrome / Edge / Firefox 桌面版，需要 WebGL2 与 Pointer Lock）。
2. 或者起个静态服务：**python3 -m http.server 8000** 然后开 http://localhost:8000/index.html
3. 主菜单 → 选关（地图 × 规则 × 玩法）→ 战前选牌 → 开局。

跑回归量具（**tools/**）需要 Node 18+；其中会开无头浏览器的几条还需要 Playwright：

```bash
npm i -D playwright && npx playwright install chromium   # 只跑 node 类量具可以跳过这步
node tools/audit.cjs            # 视角与操作验收：三种子 × 15 项
node tools/layer_check.cjs      # 分层责任制机检
```

## 能玩到什么（数字都是量出来的，不是计划）

| | |
|---|---|
| 卡牌 | **76 张**：法术 37 / 地形 22 / 法阵 9 / 召唤 7 / 实用 1；稀有度 常见 58 · 罕见 8 · 稀有 10 |
| 元素 | 6 种：中立 · 焰 · 霜 · 岩 · 林 · 虚（每张卡带一组可互相撞的高饱和纯色，特效配色与元素底色分开） |
| 出牌组 | 8 组，按「放出来干什么」分：放置 15 · 破坏 7 · 移动 7 · 远程 17 · 法阵 5 · 超阶 6 · 召唤 6 · 辅助 13 |
| 法阵 / 仪式 | 13 座（9 座战斗阵 + 超阶仪式的外中内三层阵与主阵；主阵可被打断） |
| 玩法 | 占矿争锋（三条以太矿脉，100 分 / 8 分钟 / 加时 45 秒）· 死亡竞赛（10 杀，胜分可改成 5 / 10 / 不限） |
| 规则预设 | 4 条：ranked · arcade（带魔力档）· blitz · training |
| 地图 | duel-64（主用）· island-96 · atoll-128（后两张标着实验性） |
| 联机 | 局域网两人，房主权威；零依赖手写 RFC6455 服务端 + 房间码配对 + 协议版本闸（v4） |
| 音频 | **零音频素材**：31 条运行时音效事件由振荡器现场合成；3 段可无缝循环 BGM + 22 条 wav 由 tools/music_compose.cjs 离线渲染（wav 不入库，逐位可重建） |
| 规模 | src/ 21,689 行 JS（102 个文件，无打包、无构建）· tools/ 14,121 行 / 60+ 个 .cjs 脚本（回归门禁 + 素材烘焙 + 打包导出） |

## 操作

单人默认（P1）：

- **WASD** 移动 · **空格** 跳 · **鼠标** 转向（点画面锁定指针）· **F / V** 俯仰兜底
- **左键**：攻击组（远程 / 法阵 / 超阶 / 召唤）按住 = 自动开火；放置 / 破坏 / 移动 / 辅助组 = 打出选中那张
- **1–5** 直接出指定格 · **滚轮 / Tab** 切卡 · **Shift** 触发移动牌 · **Shift+滚轮** 换出牌组 · **E** 背包
- **G** 创造调试模式（给卡 / 飞行 / 穿墙）——它是调试脚手架，不是产品特性

## 联机（局域网，房主权威）

```bash
bash start-net.sh          # 房主机器跑这一个窗口（或 node tools/net_host.cjs 8787）
```

- 两端都双击同一份 **index.html**；选关里模式选「联网 PVP」，填三个字段：
  **服务器**（房主填 ws://127.0.0.1:8787，挑战者填 ws://<房主局域网IP>:8787）· **房间码** · **角色**。
- 战前各自选 12 张牌，双方就绪后由房主用两副牌库开局；guest 端是 1↔0 镜像 + 快照外推。
- 一台机器也能双开测试：两个标签页都填 127.0.0.1 与同一房间码。
- 口径与已知差距见 [docs/NET.md](docs/NET.md)；门禁是 **tools/net_e2e.cjs**（两端真跑一局，E1–E10）。

## 仓库结构

| 位置 | 是什么 |
|---|---|
| **index.html** | 唯一入口：只有挂载点与一个样式表链接，不含逻辑与文案 |
| **src/** | 全部源码（无构建，按脚本顺序加载） |
| **src/world.js · src/battle.js · src/rules.js** | 权威层：体素存储、实体与物理、出牌结算（状态只在这里变） |
| **src/cards.js** · **src/rules.js + src/rules/effects/** | 纯数据（76 张卡 / 13 座阵 / 初始牌库）与结算指令（一条卡 = 一串指令） |
| **src/camera.js · src/hero-rig.js** | 越肩与第一人称相机（单一方程伺服）、角色模型与动画状态机 |
| **src/ui/** · **src/hud.js** | 视图框架（声明式 spec + 图层顺序 + 意图通道）与全项目唯一文案表 **H.TEXT** |
| **src/chem.js · src/vfx*.js · src/audio*.js · src/shader.js** | 方块物质反应 / 特效（原子→配方→渲染三层）/ 音频（引擎→配方→门面）/ 后处理光影 |
| **src/net*.js · tools/net_host.cjs** | 联机：传输层、同步纯逻辑、零依赖服务端 |
| **src/app/** | 路由、场景、玩法编排、规则预设、地图预设、装配层 |
| **vendor/** | three.js r128（MIT，文件头带 SPDX），没有 CDN 外链 |
| **assets/** | 素材原件与许可（构建输入） |
| **tools/** | 60+ 个 .cjs 脚本：验收量具、素材烘焙、打包导出（**这是本项目最值钱的部分之一**） |
| **docs/** | 现行口径（NET / UI_DESIGN / FX_ATOMS / LEVELS / MODES / ROUTER…）、archive/ 历史归档、RESEARCH_SOURCES.md 素材出处 |
| **DEVLOG.md** | 十五轮开发日志：每轮的量化验收与踩坑（口径与不变量在 AGENTS.md，这里只是历史） |
| **dist/** | 由 **tools/export_pack.cjs** 生成（不入库） |

## 改完怎么验

每条不变量都有一个量具守着，文档会被忘掉、机检不会。常用几条：

```bash
node tools/audit.cjs                    # 相机 / 战斗 / 世界：三种子 × 15 项；--file 走双击真路径；--shots 落图
node tools/layer_check.cjs              # 分层责任制：逻辑层碰 DOM / 写死文案 / 反向依赖，非零退出就是越界
node tools/ui_check.cjs                 # UI 框架：堆叠代数 + 静态分层 + 真页面冒烟 + 玩家真实动作
node tools/ui_shot.cjs --gate --shots /tmp/gwui   # 样式门禁八条（对比度、字号档、零圆角…），然后自己看图
node tools/bag_flow_check.cjs           # 背包 / 手牌流转：hand+deck+discard 多重集守恒
node tools/cards_probe.cjs              # 卡牌机制：墙站得住、飞桥铺板、陨星砸坑、仪式可打断
node tools/net_e2e.cjs                  # 联机两端真跑一局（跑它时别并行跑别的量具）
node tools/audit.cjs --file 490706      # 双击 file:// 的真实路径
```

**改哪层 → 必跑哪条**的完整表与全部不变量在 [AGENTS.md](AGENTS.md)（一页纸：真源在哪、怎么验、改之前必须知道什么）。

## 第三方素材与许可

代码是 MIT；下面这些**不是**本项目写的，按各自许可分发（明细见 [LICENSE-THIRD-PARTY.md](LICENSE-THIRD-PARTY.md)）：

- three.js r128（MIT）— vendor/three.min.js
- Wizard sprite sheet · movicx（**CC-BY 3.0，须署名**）— assets/mage/，玩家角色
- Kenney UI Pack - Pixel Adventure / Pixel UI Pack / Tiny Dungeon（CC0）— assets/ui/
- Fusion Pixel Font 12px（SIL OFL 1.1，含 OFL.txt 全文）— assets/fonts/

再分发时请保留署名行：**像素素材：Wizard sprite sheet · movicx（CC-BY 3.0）**
另有一份美术参考图（法阵 / Noita 模组截图）版权归原站，**不随本仓库分发**，只留出处：
[docs/RESEARCH_SOURCES.md](docs/RESEARCH_SOURCES.md)。

## 已知限制（如实）

- **联机只到局域网**：房主权威、不做公网中转、不做 NAT 穿透；掉线与卡顿已处理，公网要自己架服务端。
- **存档 = seed + 与基线的差异格**，不存实体位置与法阵，重开一局就没了。
- 自动化验收环境是 SwiftShader 软件光栅（约 50 FPS），**这里的帧率数字不能当真机指标**；手感类结论需要真机复核。
- 渲染验证只在 1440×860@dpr1 与 1280×720@dpr1.5 两档跑过，移动端与触屏没做。
- island-96 / atoll-128 两张图标着实验性：矿脉可达性闸放宽了，公平分只作参考。
- UI 与卡面是像素素材 + 程序烘焙，不是美术团队产物；配色口径见 docs/UI_DESIGN.md。
- **AI 生成物**：代码与文档由人机协作产出，注释里保留了判断依据与踩过的坑；提交历史是从零开始的一次快照。

## License

- 代码：[MIT](LICENSE)
- 第三方素材与署名要求：[LICENSE-THIRD-PARTY.md](LICENSE-THIRD-PARTY.md)

> Noita 是 Nolla Games 的商标。本项目是同类型（体素 + 卡牌施法）的独立实现，不含 Noita 的任何代码或资产。
