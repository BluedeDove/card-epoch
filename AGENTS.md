# AGENTS.md · 卡牌纪元

> 本文件是**进入这个项目先读的一页**：真源在哪、怎么跑起来验、改之前必须知道的不变量。
> 详细验收数字在 [DEVLOG.md](DEVLOG.md) 的实测验收表；面向玩家的入口说明在 [README.md](README.md)；计划与结构说明在 `docs/`（当初的计划，不是现状说明）。

## 先说三件容易踩的事

1. **唯一真源是本目录** `/data/Coding/像素3D-noita/`，改动只写这里。
   历史上另有一份 `/data/claude/game_test001(baseline)/`（本机 8932 端口曾服务它）。
   用户 2026-10-16 明确说那份不用管——**不要再往里同步，也不要拿它的表现当项目状态**。
2. **日常使用方式是双击 `index.html`（file://）**，不是 http 预览。
   `file://` 下浏览器禁用 `fetch`，所以 `await fetch('/tools/cam_audit.js')` 注入验收脚本会失败；
   用 Playwright `page.addScriptTag({path})` 注入，或把脚本内容直接求值。
   验收跑法统一走 `node tools/audit.cjs`（2026-10-16 起三种子 × 15 项全绿 + `--file` 通过；
   J 机位连续性与 D 项 88092 的历史遗留都已收口，实测数字见 [DEVLOG.md](DEVLOG.md) 第六轮验收表）。
3. **git 已开**（2026-10-16 用户同意）：动手前先 commit、验证过就 commit，回退靠 git；**无构建、无外链**，three.js r128 本地化在 `vendor/`。
4. **端口别抢**：8932 是别的会话起的服务，不要停它也不要复用。`tools/audit.cjs` 自己随机挑空闲端口，不占用。

## 目录地图

| 文件 | 职责 | 注意 |
|---|---|---|
| [src/app/router.js](src/app/router.js) | **页面路由**（唯一导航真源）：`G.ROUTES` + `G.Router.go/replace/back/start/current/on/href`；每次切页写 hash、`Scene.enter`、通知监听者 | 纯逻辑：零 DOM、零中文字面量、不反向抓 `G.HUD`/`GWAPP`；新页面一律加一条路由，**不要再裸调 `Scene.enter`**。口径见 [docs/ROUTER.md](docs/ROUTER.md) |
| [src/app/game-modes.js](src/app/game-modes.js) | **玩法数据**（唯一真源）：`lode`（占矿争锋）/`deathmatch`（死亡竞赛）的得分表、胜利条件（含「不限分」）、地图元素开关、显示行清单；`gameModeFor(cfg)` 把规则预设并进 lode | 纯数据：零 DOM、零 THREE、零中文；**加一个玩法 = 本表加一条 + `H.TEXT.game` 两句**，不改 battle/director/UI。口径见 [docs/MODES.md](docs/MODES.md) |
| [src/app/match-director.js](src/app/match-director.js) | **对局编排类**：阶段（prep/live/ended）、击杀与死亡记账、终局判定（目标分/时限/加时/不限）、`displaySpec()` 交 UI 的画面规格 | 纯逻辑、无随机；权威层只留三个钩子（`onKill`/`tick` 代 `scoreboardStep`/`lodePoints`）；**显示流程由它编排，面板不许自己判几杀算赢** |
| [tools/router_check.cjs](tools/router_check.cjs) · [tools/mode_check.cjs](tools/mode_check.cjs) | 路由回归（57 条：落位/栈/hash 回声/不写死文案）· 玩法回归（102 条：记账/目标/不限/加时/假玩法扩展性） | 碰路由或玩法必跑；都在 node 里跑，不开页面 |
| [src/world.js](src/world.js) | Uint8Array 体素存储、16×16 像素图集、暴露面烘焙、DDA 射线、种子地形 | `surfaceY` 把树叶算成固体；相机/角色高度判定用 `camGroundY`；`cameraFree` 供相机避墙 |
| [src/cards.js](src/cards.js) | 纯数据：**76 张卡**、6 流派、**12 种法阵/仪式**、初始牌库；逐卡的 `maxCells`（格子预算）、`conjure`（魔法构筑，不耗素材）、`tint`/`spectrum`（配色）、`fly`（飞行召唤） | 只加数据不加逻辑；卡牌重设计的依据见 [docs/archive/CARDS_REDESIGN.md](docs/archive/CARDS_REDESIGN.md)（历史） |
| [src/rules.js](src/rules.js) | 结算器：校验出牌 → 指令 → 写世界/改实体 | 单卡地形改造上限 `MAX_TERRAIN_CELLS = 9` |
| [src/battle.js](src/battle.js) | 实体、体素 AABB 物理、抛射物、随从 AI、法阵、胜负 | 权威 `step()`；状态变更只能在这里 |
| [src/camera.js](src/camera.js) | `OTSCamera`（越肩 / 第一人称 / 越肩不画自己）与 `OrbitCamera` | 见下面"视角不变量" |
| [src/net.js](src/net.js) | 输入源抽象：键盘 / AI / 远端（`RemoteInputSource`），都产出同一种指令流 | AI 与真人走同一通道，别给 AI 开后门 |
| [src/net-ws.js](src/net-ws.js) | 联机**传输层·客户端**：`Connection`（退避重连 + 应用层心跳 250ms 自报 tick/frame）、`SeqChan`（(connId,seq) 恰好交付一次）、`serializeFor`（**白名单**：对方手牌内容与双方牌库顺序不出门） | 零 DOM 零玩家可见中文；`PROTO_VER` 与 `tools/net_host.cjs` 同改，只改一半会被版本闸显式拒在局外 |
| [src/net-match.js](src/net-match.js) | 联机**同步纯逻辑**：`makeSnapshot` / `applySnapshot`（**1↔0 镜像** + uid 对账 + 先 `snapshotPrev` 再覆盖，跳变交给现有渲染插值）/ `applyCells` / `makeWorldTracker` / `extrapolate` / `encodeInput` | 纯函数层：不碰 DOM、不读 `window.GWAPP`；改同步语义先改 [docs/NET.md](docs/NET.md) §9 |
| [tools/net_host.cjs](tools/net_host.cjs) | 联机**服务端**：零依赖手写 RFC6455 + 房间码两席位 + 按角色转发（input/draftPick/draftSkip→host 席，snapshot/event→guest 席）+ 双道心跳（协议 ping + 应用层自报） | 它**不是**权威对局端（`Match` 在房主页面里）；config 与关卡 id 只原样转存不校验。用法 `node tools/net_host.cjs 8787` |
| [tools/net_e2e.cjs](tools/net_e2e.cjs) | 联机**端到端门禁**：两个真页面经真房间码配对 —— E1 身份/尺寸/房间、E2+E3 双向位移 >1 格、E4 世界 diff + 两端 Save 格数、E5 信息隔离（**带正例对照**，不许「因为都空所以绿」）、E6 三选一真鼠标、E7 掉线出结算、E8 卡顿不许判终局、E9 战前选牌（就绪→进局/12 张守恒/两副不同/1↔0 换位）、E10 死亡竞赛积分榜随快照镜像 + 目标分终局 | 碰联机必跑；`--core` 跑 E1–E7 + E9（选牌不需要额外开页，随第一对页面跑），默认 E1–E10（含 E8 卡顿不结算、E10 积分榜镜像与目标分终局）。跑它时**别并行跑别的量具**：SwiftShader 把 CPU 抢满会把 1.5 秒的真判据读成超时 |
| [src/hud.js](src/hud.js) | **UI 门面 + 全项目唯一的玩家可见文案表 `H.TEXT`**：注册物品、装配 ViewModel 与意图通道、保留历史入口（`H.showInventory` / `H.openChoice` 等） | 中文只能出现在 `H.TEXT`；不再自己拼 DOM |
| [src/ui/](src/ui/) | **视图框架（2026-10-17 重写）**：`theme.css` 令牌与 9-slice 样式、`card-icons.js` 烘焙卡面图标、：`dom.js` 声明式 spec、`core.js` 总线 + **图层顺序表** + 帧调度 + Panel 基类、`items.js` 堆叠代数、`channel.js` 意图通道、`drag.js` 全局委托、`widgets.js` 复用件、`viewmodel.js` 唯一读 match 处、`art.js` 卡面绘制、`panels.js` 十个面板 | 玩家可见中文（归 `H.TEXT`）、`innerHTML`、自己写 z-index、反手抓 `G.Rules`/`G.Creative`/`window.GWAPP`；口径见 [docs/UI_KIT.md](docs/UI_KIT.md)；**长什么样**的口径见 [docs/UI_DESIGN.md](docs/UI_DESIGN.md)（令牌表就是 src/ui/theme.css 的 :root） |
| [src/creative.js](src/creative.js) | 创造调试模式的**状态与能力层**（`spec()` 交纯数据） | 零 DOM / 零文案 / 零键盘监听；只往 P1 挂 `p.creative`，结算分支仍在 battle/rules 里读它 |
| [src/audio-engine.js](src/audio-engine.js) | 音频**引擎层**（`GW.AudioEngine`）：懒建 AudioContext、三总线（sfx/music→master）、振荡器与噪声声源、包络·滤波·软削波·混响/延迟 send、复音上限 | 零事件名零配方零 DOM 零文案；构建函数接受任意 BaseAudioContext，回归才能用 OfflineAudioContext 真渲染样本 |
| [src/sfx-table.js](src/sfx-table.js) | 音效**配方层**（`GW.SfxTable`）：30 个事件的纯数据分层表（25 条战斗 / UI + 5 条物质反应 `ignite / steam / ash / obsidian / melt`） | 不许函数、分支、循环、随机、中文；这些 id 就是权威层与 UI 唯一能说的音频词汇 |
| [src/audio.js](src/audio.js) | 音效**门面**（`GW.Audio`）：查表 → 同名节流 → 交引擎；静音与音量存 `localStorage.gw.muted` / `gw.vol` | 保持 `play/toggle/resume/enabled` 老入口（battle/hud 因此一行没改）；这里不许出现音色数字 |
| [src/vfx.js](src/vfx.js) | 特效**计算层**（`GW.VFX`）：**12 个**离子原子类（ring/poly/spokes/glyphs/pillar/vortex/orbit/sweep/dome/helix/shards/**sphere**）、7 个动画通道、时间轴相位；**节点树 → 叶子表**（`expand()`：组节点 / `sat` 环绕复制 / 任意层级）与**密度预算**（lod × budget × 抽稀） | 零 DOM / 零 THREE / 零文案；**旋转必须是角速度的积分**、视觉量一律不写回权威状态；**新技能靠组合长出来，不许为单张卡写特判**；结构口径见 [docs/FX_ATOMS.md](docs/FX_ATOMS.md) 第九节 |
| [src/vfx-recipes.js](src/vfx-recipes.js) | 特效**配方层**：**58 条 recipe**（地面阵 / 跟随体 / 一次性事件 / 元素反应 / 抛射物拖尾 / 大招阵 / 超阶仪式 / 核爆 / 黑洞 / 光弧），外加 `PROJECTILE_FX_CARD`（按卡 id）与 `SUMMON_FX`（按 aiKind）两张新绑定表，纯数据 | 不许出现分支、循环、随机；法阵在 `cards.js` 的 `fx` 字段绑配方；配方名**只在**这张表出现 |
| [src/vfx-render.js](src/vfx-render.js) | 特效**渲染层**（`GW.VFXR`）：把每层数字画成 LineSegments / Points；槽位池 + 共享材质 + 顶点预算 + 暗底描边 | 零 DOM / 零文案；顶点色要先 sRGB→Linear（否则亮场景下整圈变白）；**关 `VFXR.enabled` 必须回到老贴图阵**，与光影层"P 关掉==现状"同一条口径 |
| [src/chem.js](src/chem.js) | **物质交互层**（`GW.CHEM`）：属性驱动的反应表（燃 / 熔 / 冻 / 凝 / 灭）+ 激活格环形队列 + 定时轮 + 硬预算 | 权威层：零 DOM / 零 THREE / 零文案（反应只报 key）；**绝不整图扫描**——常驻激活集只有"自己会变"的格（火、岩浆），其余靠 `WORLD_HOOKS.onSet` 邻居唤醒；每 tick 看 56 格 / 改 8 格，超了排队 |
| [src/save.js](src/save.js) | 存档 = seed + 与基线的差异格 | 不存实体位置与法阵 |
| [src/main.js](src/main.js) | 引导、渲染、粒子、主循环、**装配层**（键位表 + 把 Creative 的 spec/handlers 接到 HUD） | 键位表在 `start()` 与全局 keydown 里；`__GW_START` / `GWAPP` / `__dbg` 是调试入口 |
| [src/shader.js](src/shader.js) | **光影层**：手写后处理（曝光 · 选择性泛光 · 冷暖分级 · 暗角），`GW.SHADER` | 零 DOM/零文案/零键位；`rtScene.texture.encoding=sRGBEncoding` 是为了"关掉==现状"可机检，改成 Linear 就前功尽弃；参数存 `localStorage.gw.post` |
| [src/hero-rig.js](src/hero-rig.js) | **玩家角色·模型层**（`GW.HERO`）：两条渲染路径共用一套动画状态机——公告牌（素材原画的 4 方向帧，面向相机）与盒模型（四视图投影），外加走路/施法/挨打/落地四条时间线 | 零 DOM、零文案、**不许读写实体**（只收 main.js 递来的 {speed,air,pitch} 快照）；部件世界 AABB 有预算，见下"角色模型不变量" |
| [src/hero-sprites.js](src/hero-sprites.js) | 角色贴图**纯数据**（调色板 + 逐像素索引 + 两阵营替换表 + 公告牌帧表） | 生成物，不许手改；不许有函数/分支/循环/随机，layer_check 拦 |
| [assets/mage/](assets/mage/) + [tools/hero_bake.cjs](tools/hero_bake.cjs) | 素材原件（CC-BY，见 [assets/mage/README.md](assets/mage/README.md)）+ 零依赖 PNG 解码/烘焙器 | `node tools/hero_bake.cjs [--print\|--contact 目录\|--assemble 目录]` 重新生成 hero-sprites.js；取框表全在这一个文件里 |
| [tools/hero_check.cjs](tools/hero_check.cjs) | **角色层回归**（31 条：装配/走路成套/朝向选帧/事件时间线/不写回实体/可复现/越肩误隐藏） | 碰角色模型、素材、动画必跑；`--shots 目录` 落图后**自己逐张看**——它是视觉活儿，绿灯不等于好看 |
| [tools/cam_audit.js](tools/cam_audit.js) | **视角与操作回归验收·口径**（不被 index.html 引用） | 口径冻结：改判定阈值/判据必须给用户过目 |
| [tools/creative_check.cjs](tools/creative_check.cjs) | **创造模式/背包/视角/结算面板的功能回归**（53 条断言：指针交还、真鼠标点卡、飞行、俯仰 ±89°、结算文案、分层静态检查） | 碰 UI、输入、调试模式必跑；`node tools/creative_check.cjs [seed]` |
| [tools/ui_shot.cjs](tools/ui_shot.cjs) | **UI 取景器 + 样式门禁**：菜单 / HUD / 背包四页 / 提示 / 三选一 / 结算 / 分屏逐个落图（--shots），--gate 在真页面计算样式上量八条（字号刻度、对比度 ≥4.5/≥3、边框 0/2px、零圆角、零模糊阴影、令牌外颜色、常驻层不进中央 40%、安全边距 + 常驻层两两不相交），并核对 :root 的 --el-* 与 G.ELEMENTS 同值 | 碰任何 `.ui-*` 样式 / 面板布局必跑 `--gate`；`--viewport 1280x720 --dpr 1.5` 是用户台式机那一档，别只跑 dpr=1 |
| [tools/ui_check.cjs](tools/ui_check.cjs) | **UI 框架回归**（141 条 = 堆叠代数在 node 里逐条断言 + 静态分层与意图词汇表反查 + 真页面冒烟：真鼠标拖拽、悬停提示、背包暂停与恢复，**外加"玩家真实动作"段：滚轮选卡、卡页四按钮、拖到格缝、拖到画面上出牌、被拒必须演出来**——判权威状态与真实 DOM，不判容器里有没有东西） | 碰 `src/ui/*`、背包、拖拽、任何面板必跑；`--static` 秒级只跑静态 |
| [tools/bag_flow_check.cjs](tools/bag_flow_check.cjs) | **背包/手牌流转回归**（28 条，真页面 + 真鼠标）：Shift+滚轮连滚 10 圈三堆守恒、回「全部」手牌补满 5、选中格永不越界、生存背包没有取卡货架、拿起的东西落在空白/牌库/画面上都不许消失、卡页四按钮按「鼠标停着的那张」门禁、类别只有一套词表、1280×720 选关主按钮在首屏、Shift+滚轮不顺手打牌 | 碰 `src/systems/deck.js` 的手牌/牌堆、`src/ui/items.js`、`drag.js`、`panels.js`、`viewmodel.js`、背包布局必跑；`--shots 目录` 落图后自己看 |
| [tools/role_check.cjs](tools/role_check.cjs) | **出牌组回归**（17 条）：76 张卡每张一个 `role`、8 组都非空、按"放出来干什么"逐组核效果（放置=放方块的 setBlock 模式 / 破坏=拆改地形 / 法阵=sigil / 召唤=spawn / 超阶=费用≥5 且冷却≥16 且是伤害或法阵 / 辅助不碰地形召唤法阵伤害）、**移动组每张卡都带 `hot:'shift'`**、文案 classOrder 与 8 组中文名同源 | 改 `cards.js` 的 role、改组名/组表必跑；在 node 里跑，不依赖 GL |
| [tools/auto_check.cjs](tools/auto_check.cjs) | **自动开火回归**（23 条）：只自动打攻击类（放置/破坏/移动/辅助一张不碰）、优先级（超阶>远程>法阵>召唤）、付不起不打、连发守恒、同价轮换（刚打过那张往后排）、同种子同序列且不碰 legacy 抽牌流、"手里没有攻击牌就换一张"（空位直接补）、手动作业组不换牌、Shift 多张 hot 牌逐个试 | 碰 `src/systems/auto.js` / `systems/aim.js` 的 useHotkey / `battle.js` 的 autoPick·autoFire 必跑；在 node 里跑 |
| [tools/layer_check.cjs](tools/layer_check.cjs) | **分层责任制机检**：逻辑层碰 DOM / 写死文案 / 骨架里塞文案，全部打行号 | 改完 src/ 任何一层都要跑；退出码非 0 就是越界 |
| [tools/feel_probe.cjs](tools/feel_probe.cjs) | 移动"丝滑度"探针：零位移渲染帧占比 / 单帧最大÷平均 / jerk | audit 的 15 项抓不到"画面位置退回 20Hz 直连"，手感回归跑它 |
| [tools/ice_probe.cjs](tools/ice_probe.cjs) | **冰面可见性回归**：按 DEFS 与邻居规则独立重算受影响 chunk 的三角形，与渲染器实际数出来的比对 + 冰贡献必须 > 0 | 改过 chunk 几何/面剔除/方块定义（`buildChunkGeometry`、`DEFS`）必跑；`node tools/ice_probe.cjs [seed] [--shots 目录]` |
| [tools/audio_check.cjs](tools/audio_check.cjs) | **音频三层回归**（27 条：分层责任、调用点词汇表反查、配方字段白名单、OfflineAudioContext 真渲染出声、复音硬上限、静音持久化、渲染确定性） | 碰 `src/audio*.js` / `src/sfx-table.js` 必跑，`--file` 走双击真路径。它抓出过两个真 bug：`envShape` 参数写倒、节流把毫秒单位写成 0.028（等于没节流） |
| [tools/chem_check.cjs](tools/chem_check.cjs) | **物质交互回归**（34 条：九条反应逐格核最终方块、稳态零成本、单 tick 预算与峰值耗时、山火熔断、同种子逐字节重放） | 碰 `src/chem.js` / DEFS 物质属性 / 点火灭火那条链必跑；node 里跑，不依赖 GL |
| [tools/hand_check.cjs](tools/hand_check.cjs) | **类别手牌回归**（24 条：五类都有牌、未知类被拒且不动牌堆、切类后手持栏全是同类、**hand+deck+discard 三堆之和守恒**（不造牌不吞牌）、非同类回牌库**底**、同类打光宁可空着也不掺别类、未切类与老版 `drawCards` 逐字节等价、同种子 200 次操作可复现） | 碰 `battle.js` 的手牌/抽牌/补位或改类别必跑；在 node 里跑，不依赖 GL |
| [tools/cards_probe.cjs](tools/cards_probe.cjs) | **卡牌机制回归**（49 条：墙站不站得住 / 4 格高立满 / 飞桥沿途铺板 / 飞行体离地且开火且掉血 / 陨星陆续砸下并砸坑 / 超新星+震屏 / 奇点吸引 / 裂地碗坑 / 终末全员掉血 + ≥200 格被抹 / 19 座仪式阵 + 长咏唱落地 / 灵光偏离直线 >0.4 格 / 地堡不扣素材 / 黑洞拽近 / 拆+建组合） | 碰 `cards.js` / `rules.js` 的地形与效果分支 / `battle.js` 的抛射物·随从·法阵必跑；在 node 里跑，不依赖 GL |
| [tools/hit_check.cjs](tools/hit_check.cjs) | **攻击判定回归**（44 条：偏 0.9 / 1.3 格必须掉血、偏 2.6 格必须不掉、状态不许先于命中、单发伤害 ±40% 区间、范围卡不吃衰减、AI 同通道） | 碰抛射物 / `explode` / cards 的 `dmg()` 数值必跑 |
| [tools/vfx_live.cjs](tools/vfx_live.cjs) | **特效渲染层 + 物质层的真页面回归**（27 条：脚本顺序、配方注册、槽位与顶点预算、法阵接管与可关性、**同机位开/关像素差分**证明"亮草地上看得见且上了色"） | 碰 `src/vfx-render.js` / chem 的画面侧必跑；`--shots` 落图后自己看 |
| [tools/vfx_check.cjs](tools/vfx_check.cjs) | **特效计算层回归**（49 条：分层、参数夹紧、确定性可复现、相位与衰减单调、量纲、实体→配方、事件通道、性能） | 碰 `src/vfx*.js` 或 `cards.js` 的 `fx` 字段必跑；在 node 里跑，不依赖 GL 与页面 |
| [tools/post_check.cjs](tools/post_check.cjs) | **光影层回归**：中性参数下与关光影像素一致（色彩空间没编码两次）+ 默认参数画面必须变 + 分屏/三档 renderScale 能跑 + 日照存在性与重建代价 | 碰 shader.js / 色彩空间 / RT / 日照必跑；`node tools/post_check.cjs [seed]` |
| [tools/jump_window.cjs](tools/jump_window.cjs) | **起跳容错与冰面滑行回归**：coyote 0.12s、输入缓冲 0.20s、按住跳键不自跳、冰上位移不被打折成"被粘住" | 碰 battle.js 的移动/跳跃/碰撞必跑；它逐 tick 驱动 `applyInput`，同一条轨迹跑两遍才量得出窗口 |
| [tools/light_probe.cjs](tools/light_probe.cjs) | **块光回归**（岩浆/火/以太晶照亮周围）：阴凉处紧邻 1 格 ≥1.6× 亮度、按半径衰减封边、色温偏火不是加白、水额外吸收、无光源时不许白扫 | 碰 `G.LIGHT` / `lightField` / 顶点色的块光分支必跑。`--checkonly` 打印顶点色校验和，但**只能在同一份加载状态下比**：并行会话未提交的化学层会改地形（岩浆遇水凝黑曜石），跨副本比会得出假结论（2026-10-16 我踩过，同树连跑两次相同才叫确定性） |
| [tools/export_pack.cjs](tools/export_pack.cjs) | **一键导出可玩包**：dist/card-epoch/ + zip（只带运行期文件；zip 走 python3 zipfile） | 交付/给朋友试玩时用；导出后双击包内 index.html |
| [tools/open_source_pack.cjs](tools/open_source_pack.cjs) | **一键导出开源包**：dist/card-epoch-oss/ + 脱敏改写 + 四层自检（泄露硬门禁 / 人工过一眼 / 覆盖率 / 断链），A 或 C 命中就非零退出 | 推公开仓前必跑；**不改动源目录**，本机路径与内网 IP 只在导出件里中性化；`research/` 与其外链图不随包分发（版权），出处留在 docs/RESEARCH_SOURCES.md |
| [src/lode-planter.js](src/lode-planter.js) | L1 生成期：三条以太矿脉的落点/台面/晶体/主路整平；多图按 `scale = SX/64` 缩放距离类常数 | 只在生成期跑一次；**显式 `opts.lodes` 开关**（默认不长，测试世界不传）；64 图 scale=1 必须逐格与旧图一致 |
| [src/reachability-gate.js](src/reachability-gate.js) | L1 生成期：两出生点互通 + 每矿两侧可达 + 三矿两两距 + 排序公平分 | 闸宽随地图缩放（`opts.distMin/distMax`）；**绝不进 tick** |
| [src/lode-system.js](src/lode-system.js) | L4：占矿归属（争抢无主/宽限）、1 分/3s、+1 素材/6s、+0.15 魔力/s、以太晶 12s 原位再生 | 唯一允许写世界格子的路径是晶体再生（只写原位、只写 AIR、队列 ≤9）；不写玩家字段 |
| [src/cards/pick-pools.js](src/cards/pick-pools.js) | 三选一卡池：林海/黄沙/雪原 + 通用，各 8 张（纯数据） | 与 [docs/CARD_ECONOMY.md](docs/CARD_ECONOMY.md) §2.1 的表逐字一致（`draft_check` 核） |
| [src/app/rule-presets.js](src/app/rule-presets.js) | **四条规则**（ranked / arcade / blitz / training）的纯数据；`buildMatch` 展开成 Match opts 的唯一出口。arcade 是唯一带魔力档（`manaCap/manaRegen`）的规则，其余保持 battle.js 的既有常量 | 数值不许在 battle.js / hud 里再写一份 |
| [docs/CARD_ECONOMY.md](docs/CARD_ECONOMY.md) · [docs/LEVELS.md](docs/LEVELS.md) · [docs/MODES.md](docs/MODES.md) · [docs/ROUTER.md](docs/ROUTER.md) | 卡牌来源与资源再生 / 关卡（地图 × 规则 × 模式）/ **玩法编排**（数据+director+displaySpec）/ **路由与战前选牌** | 现行口径；改数字先改文档再改代码 |
| [tools/econ_check.cjs](tools/econ_check.cjs) · [draft_check.cjs](tools/draft_check.cjs) · [beast_check.cjs](tools/beast_check.cjs) · [lode_scale_check.cjs](tools/lode_scale_check.cjs) · [level_check.cjs](tools/level_check.cjs) | 本轮新增量具：经济/再生、三选一、晶甲兽、三图矿脉不退化、选关与规则透传 | 全在 node 里跑，不依赖 GL；判据见各自文件头 |
| [tools/audit.cjs](tools/audit.cjs) | **一键验收执行入口**：自带禁缓存服务（随机空闲端口）+ headless Chromium；`--file` 走双击真路径、`--shots` 落构图截图 | 验证只跑它；改完 camera/battle/main/world 必跑 |
| [src/app/](src/app/) | **引导/装配的拆出部分**：app-state（单根状态）、scenes（场景）、session（buildWorld/buildMatch）、map-presets、particles（粒子/飘字）、sigil-view（法阵网格）、entity-view（随从模型）、hero-view（英雄牌）、projectile-view（抛射物池）、chunk-mesher（体素烘焙）、world-view（世界网格建/脏块/远裁） | 这些是**表现/装配**模块，不写权威状态；main.js 只剩 renderer 引导、键位、主循环与 UI 意图绑定 |
| [src/](src/) | **唯一真源（2026-10-17 起 `js/` 整体迁移到这里）**：world/battle/rules/camera/ui/app/systems/rules-effects 全部在 src/ 下 | `index.html` 直接加载 src/；`docs/legacy-src-refactor/` 是旧实验归档，不加载；无构建、无打包 |

## 分层责任制（硬规则，2026-10-16 用户明确要求）

改动的单位是"一个模块一个模块"，所以**每层只能写自己那层的信息**。硬编码进错的层，用户以后想换 UI 就得跨文件找逻辑。

- **出处与适用期**：本节就是**当前 `src/` 单轨期间的施工规则**（旧的 11 层 PLAN_REFACTOR 已归档到 docs/archive，不再作为依据）。
  面板结构在 `src/ui/*.js` 的 spec、数据供给在 viewmodel/selector；**逻辑层零 DOM、零玩家可见文案**这条永远不变。
- **谁拦着**：`node tools/layer_check.cjs`（见文末门禁）。文档会被忘掉，机检不会。

| 层 | 归属文件 | 允许出现 | 不允许出现 |
|---|---|---|---|
| 结构与样式 | [index.html](index.html) + [src/ui/theme.css](src/ui/theme.css) | DOM 骨架、id、`data-t` 插槽；CSS 规则与令牌 | 任何 JS 逻辑、任何玩家可见文案（文案由 UI 层注入） |
| 视图与文案 | [src/hud.js](src/hud.js) | 取数据 → 填 DOM、`H.TEXT` 文案表、卡面绘制 `H.art` | 规则数值、物理、世界读写 |
| 视图框架 | [src/ui/](src/ui/) | 声明式结构、图层顺序、堆叠代数、意图通道 | 玩家可见中文、`innerHTML`、写权威状态、自己写 z-index、写死颜色（颜色只能是 `src/ui/theme.css` 的 `:root` 令牌名或元素自带的 `--ui-tone`） |
| 状态与能力 | [src/creative.js](src/creative.js) | 调试开关、动作、`spec()` 纯数据 | `document.*` / `innerHTML` / `querySelector` / 中文文案 / 键盘监听 |
| 装配 | [src/main.js](src/main.js) | 键位表、把上面对接起来、主循环顺序 | 具体 UI 结构、卡牌结算 |
| 权威 | [src/battle.js](src/battle.js) / [src/rules.js](src/rules.js) | 状态推进与结算（读 `p.creative` 标记） | 直接写 DOM、写 UI 文案 |
| 声音·配方 | [src/sfx-table.js](src/sfx-table.js) | 事件 id + 每层参数（波形/频率/包络/滤波/pan/湿声） | 函数、分支、循环、随机、中文、DOM |
| 声音·引擎 | [src/audio-engine.js](src/audio-engine.js) | 怎么发声：声源、包络、滤波、总线、上限、离线渲染 | 事件名、配方数字、DOM、THREE、文案 |
| 角色·模型 | [src/hero-rig.js](src/hero-rig.js) | 怎么把角色摆出来与动起来：关节层级、部件外形、朝向选帧、四条动画时间线 | DOM、文案、`THREE` 之外的渲染副作用、读写实体（`p.pos.x` / `players[` 之类）、`window.GWAPP` |
| 角色·贴图 | [src/hero-sprites.js](src/hero-sprites.js) | 纯数据：调色板、逐像素索引、阵营替换表、公告牌帧表 | 函数、分支、循环、随机、DOM、THREE（要改就改 tools/hero_bake.cjs） |
| 声音·门面 | [src/audio.js](src/audio.js) | 查表 + 节流 + 静音/音量/手势解锁 | 音色数字、DOM、文案、反向抓主循环 |

落地口径：
- **背包/面板要换一套**：只动 `src/ui/panels.js` 的 spec + `H.TEXT.inv` + `src/ui/theme.css` 的 `.ui-*` 样式；`src/creative.js`、`rules.js`、主循环一行都不用碰（2026-10-17 重写就是这么做的：逻辑层零改动）。
- **UI 与游戏之间只走意图**：`src/ui/items.js` 的动作只发 `ui.*` 意图，权威容器（手持栏 / 牌库）永不本地改写；游戏没答应之前光标不许变（`Ops.resolve` 才收）。新接口先登记进 `src/ui/channel.js` 的 `INTENTS`，没人接就返回 `no-handler`，**不许假成功**——方块丢到画面上今天就是这条路还没接（文案："这条路还没接上（通道留着，等机制层）"）。
- 面板开没开、hud 遮罩、锁鼠标提示的显隐、指针锁交还，都是**视图层状态**（`H.uiPanelOpen()` / `H.showInventory`），
  `creative.js` 不保存也不查询；主循环的暂停判据问 hud，不问 creative。
- 逻辑层要"告诉玩家发生了什么"只报 key（`on` / `off` / `fly` / `noclip`），中文在 `H.TEXT.creative`。
- 机检查什么：剥掉注释后逐层查 DOM 调用、写死的玩家可见文案、骨架里的文案、反向依赖（`window.GWAPP`/`G.HUD`），以及 hud 是否还提供 `H.TEXT`/`showInventory`/`paintGmBadge`。
  本轮已被它当场抓出并收掉的三处真实越界：`main.js` 拼结算面板 HTML 并写死"你赢了"（→ `H.showMatchResult` + `H.TEXT.result`）、
  `creative.js` 用 innerHTML 拼背包（→ hud 层）、`creative.js` 反手调 `G.HUD.sel/invalidate`（→ 装配层传 slot）。
- `H.TEXT` 只能**合并写**（`Object.assign(H.TEXT || {}, {...})`）：早先背包段直接 `H.TEXT = {...}` 把先注册的 `result` 整段覆盖掉，结算面板读 `H.TEXT.result.seconds` 直接抛异常。
- **只允许向下依赖，状态层不许反手抓视图层**：`creative.js` 曾经直接读 `window.GWAPP`、调 `G.HUD.sel/invalidate()`（等于状态层反向依赖主循环与 UI）。
   现在改成：`match` 由 `main.js` 在 `start()` 里 `attach()` 交进来；`give(id, mode, {slot})` 的选中格由调用方传入，"刷不刷新手牌 DOM"由 `main.js` 的 handler 负责。
   layer_check 对 `window.GWAPP` / `G.HUD` / `document.getElementById` 直接报错。
- **新增一个面板/按钮/提示怎么做（照这五步，别自由发挥；细节见 [docs/UI_KIT.md](docs/UI_KIT.md)）**：
  1. 结构：在 `src/ui/panels.js` 里 `class X extends UI.Panel`，`spec(vm)` 交一张声明式 spec（`h('div.ui-x', {...})`），注册时声明落在 LAYER_TABLE 哪一层与层内 `order`；要新样式就加进 `src/ui/theme.css` 的 `.ui-*` 段，**不写内联 style、不写 z-index**；
  2. 文案进 `src/hud.js` 的 `H.TEXT.<面板名>`（按钮名、提示、单位后缀、格式化函数、每种 `deny` reason 的人话）——面向玩家的中文只能出现在这张表里；
  3. 数据进 `src/ui/viewmodel.js`：面板要的字段平铺进 `vm`（**只有这里可以读 match**）；出牌合法性之类用 `channel.ask('canPlay')` 问装配层，视图不查规则；
  4. 动作走意图：`bag.want('ui.xxx', {...})` / `ch.request(...)`，先登记进 `src/ui/channel.js` 的 `INTENTS`；`src/main.js` 的 `bindUIChannel` 接住它，改完权威状态后回 `{ok, ...}`；
  5. 跑 `node tools/ui_check.cjs` + `node tools/creative_check.cjs` + `node tools/layer_check.cjs` + `node tools/ui_shot.cjs --gate --shots /tmp/ui-后`，再**逐张看图**（绿灯不等于好看）。
  **反例（本轮真实出现过、已被机检堵住的写法）**：在 `creative.js` 里 `d.innerHTML = '<div class=inm>无限魔力</div>'`；
  在 `main.js` 里 `document.getElementById('resKv').innerHTML = kv` 并写死 `'你赢了'`；在 `index.html` 骨架里直接写 `<button>重掷手牌</button>`。
- **UI 与权威状态之间的四条接线（2026-10-17 用户报"UI 修好看了但功能全坏"后立的；六条断点全部由 `ui_check` 拦）**：
  1. **视图状态数组只准就地改，不许整个换掉**：装配层写 `G.HUD.sel = [0,0]` 之后，视图模型仍握着旧数组的引用，
     于是滚轮/Tab 改了状态而界面永远停在第 1 格。重置必须走 `G.HUD.resetSel()`（`viewmodel.js` 的"模型必须就地写"同一条）。
  2. **面板开着（逻辑暂停）也必须喂视图模型**：`main.js` 的 `renderHudOnly` 里要按 60ms 调 `G.HUD.update`。
     少了这一步，在背包里给了卡 → 权威 hand 变了、`vm.hands` 还是旧的 → 玩家看到"放进手持栏完全没反应"。
  3. **悬停计时只按真实 dt 在 frame 里累加**，不许再加"最近动过鼠标"之类的闸：
     旧版那道 140ms 闸让 260ms 的门永远过不去 → 提示与详情栏从来不填 → 卡页四个按钮集体静默。
     离开格子只收提示，**不清详情栏主体**（否则手一移到按钮上，按钮就没对象了）。
  4. **任何被拒绝的动作都必须演出来**：`ui:notify` 要有人订阅（`src/hud.js` 里 `bus.on('ui:notify', …)`），
     `Toast.push` 的单位是**毫秒**（默认值写成 1.1 又整个除 1000，等于所有拒绝只活 1.1 毫秒 = 沉默）。
     "不许假成功"这条只有在玩家真看得见时才成立。
  另外：**权威格的格位不许带 -1 上意图**（`slotPolicy:'selected'` 或按指针算最近一格），否则 `creative.give` 会把它夹成第 0 格，
  玩家拖到第 4 格、改的是第 1 格。回归落在 `tools/ui_check.cjs` 的"玩家真实动作"段：判**权威状态 + 真实 DOM + 通道回执 + toast 文本**，
  不判"容器里有没有东西"（上一版就是这么把四条坏路看成绿的）。
- **手牌守恒与"卡牌是一个个个体"（2026-10-18 用户报"滚一圈卡牌会消失 / 背包里拿不出来"后立的；量具 `tools/bag_flow_check.cjs`）**：
  1. **任何 UI 动作都不许造牌、不许吞牌**。判据只有一个：`hand+deck+discard` 合起来的**多重集**在动作前后完全相等。
     五个真 bug 都是这条被破掉的：① `Deck.reshuffle` 把 `p.deck` 整段换成 `p.discard`（按类挑牌时牌库里压着的别类牌被吞，实测 7→3）；
     ② 切回「全部」只把 `handClass` 置空不补牌（滚一圈后手里剩 3 格、牌库还有 5 张）；
     ③ 拖进"随身格"的本地写入被视图模型每 60ms 用 `vm.tray` 覆盖回去（12→11）；
     ④ 「收进随身格」是复制、再从货架拖回手持栏 = 把复制品塞进权威手牌（12→13，还把原格那张挤进弃牌堆）；
     ⑤ 创造模式 `give` 换掉手牌格时把旧牌直接丢了（现在进弃牌堆）。
  2. **"随身格"不是第二个背包**：它是创造模式的**取卡货架**（`kind:'palette'`，只复制、不持有，生存版按 `caps.tray` 整块不渲染）。
     本地容器只有"真属于 UI 的收藏"才能收东西（`Ops.returnCursor` 只往 `kind==='local'` 里收），palette/infinite 一律拒。
  3. **卡页四个按钮的主体 = 鼠标停着的那张卡**（`vm.detailBox/detailSlot`），不是"当前选中格"：牌库那张「放进手持栏 / 扔掉这张」必须是灰的，
     生存模式下不允许亮着一个只会回"创造模式才能取卡"的按钮。灰按钮带 `title` 说原因。
  4. **拖到画面上 = 朝那个方向打出**（生存模式也成立）：先 `placeBack` 回原格再 `castAt`——旧写法两种模式都走 `ui.give`，
     于是生存模式里这条手势只会回"创造模式才能取卡"。手牌满格放不回去时**拒绝并留在光标上**，不许悄悄丢进弃牌堆再打出别的那张。
  5. **出牌组只有一套词表，而且是"按放出来干什么"分**（2026-10-18 晚用户改口径）：`p.handClass` ∈
     {`all`, `place`, `dig`, `move`, `shot`, `sigil`, `ultra`, `summon`, `aid`}（全部 + 8 组）。
     组 = `cards.js` 每张卡的 `role` 字段（纯数据）；`strike/build` 只为老量具保留、界面不再转。
     细分类型（terrain/spell/sigil/summon/utility）只用于图鉴的类型筛选，不再是"手持栏模式"。
     回「全部」必须补满 5 格（`fillAll`：优先还 `handKept` 那几张，不够再从牌库抽）。
     **判定归 `tools/role_check.cjs`**：每张卡一个 role、8 组都非空、放置组都在放方块、破坏组都在拆地形、
     法阵组都有 sigil、召唤组都有 spawn、超阶组 = 费用≥5 且冷却≥16 且是伤害/法阵、辅助组不碰地形/召唤/法阵/伤害，
     以及**移动组每张卡都带 `hot:'shift'`**（用户："增加移动的都能用 Shift 触发"）。
  6. **选中格永远落在真实手牌里**：`clampSel` 在每帧与每次切类/出牌后夹一次（旧版实测 `sel=3` 而 `hand=3`，按 5 静默）。
  6b. **左右键分工**（2026-10-20 用户改口径："左键使用背包配置好的默认攻击牌组，右键默认当前物品栏选中的牌"）：
     · **左键按住 = 默认攻击牌组自动开火**；当前如果是放置/破坏/移动/辅助，装配层临时切到
       `p.attackClass`（玩家上次在背包里选过的攻击组，默认「全部」），松手再用 `equipClass` 切回原组。
     · **右键 = 打出当前选中那一格**，不再用右键循环选择；选择交给滚轮/Tab/1–5。
     判定只有一处：`src/main.js` 的 mousedown；`leftPlaysSelected()` 已删除。切换走 `equipClass` 的守恒路径，
     不复制手牌；左键临时切组/开火/切回的三堆守恒与右键选中牌由 `tools/left_click_check.cjs`（13 条，真鼠标）验。
     自动开火的规则本身在 `src/systems/auto.js`（权威层），装配层只负责"左键按住/松开 + 90ms 节流"。
     三条不许动：① **只自动打攻击类**（超阶/远程/法阵/召唤）——放置/破坏/移动/辅助自动放等于在脚下砌墙、随机闪现；
     ② **付不起就不打**（`G.Rules.canPlay` 说不行的一张都不选），没有可打的攻击牌时走 `reload`：
     手里一张"打不出去的"换回牌库**底**、从牌库换一张能打的进来（空位就直接补）——这是"不用管卡组"的那一半，
     换牌同样受守恒约束，且**手动切到放置/破坏组时不换**（那是玩家在干活，不是弹药不足）；
     ③ 用**独立的 `auto` 随机流**（`core/rng.js`）做同分组内轮换，不许碰 legacy 抽牌流（碰了 determinism 与 hand_check 的逐字节重放会翻车）。
     判定在 `tools/auto_check.cjs`（23 条：只挑攻击类 / 优先级 / 付不起不打 / 连发守恒 / 同价轮换 / 同种子可复现 / Shift 多张 hot 牌逐个试）。
  7. **Shift 有两个职责**：Shift+滚轮换类、创造模式下降。所以"快捷出牌"**在松手时判**（按住期间出现过 Shift+滚轮 → 不算；>400ms → 不算），
     keydown 就结算会让"只想换类"的虚系玩家白扔一张闪现。
- **面板类交互的三条硬要求**（都踩过）：打开面板必须 `exitPointerLock()` 交还鼠标、并收起"点击画面锁定鼠标"提示；
  面板开着时滚轮/悬停类全局输入要让位（否则滚列表=换卡）；面板状态是**视图层状态**（`H.uiPanelOpen()`），主循环暂停判据问 hud 不问 creative。
- **已知越界清单（诚实的债，别当成合规范例）**：~~`src/hud.js` 直接调 `G.Rules.canPlay`~~（2026-10-17 UI 重写已收：改由 `src/ui/viewmodel.js` 用 `channel.ask('canPlay')` 问装配层，实现仍由 `src/main.js` 提供）；
  `index.html` 只剩 6 个挂载点（`#gl #fade #hud #inv #menu #result`）+ 一个 `<link>`，**样式已抽到 `src/ui/theme.css`**（2026-10-17）。别再往骨架里塞结构与文案。
  `tools/lint_lines.cjs` 的"函数 ≤3 行"是 `src/` 重构门槛，`src/` 从来没绿过（本轮开始 152 → 现在 181，其中 `creative.js` 11、`hud.js` 19：UI 构建函数变长集中在视图层，方向对）。

## 视角不变量（本轮踩过，别再退回去）

- **验证环境必须有一档设备像素比≠1**：用户 4K 屏（Windows 150% → dpr=1.5）实测报"视角放大+裁右上角+头晕"，而 dpr=1 的无头环境永远复现不了。
  画布 CSS 只有 `position:fixed;inset:0` 没定宽高 + `setSize(...,false)` = 浏览器按缓冲区尺寸布局 canvas，dpr≠1 时画布撑出窗口、准星 DOM 中心与画布中心分家。
  现在 `src/ui/theme.css` 的 `#gl` 有 width/height:100%、setSize 交给 three 写样式，`tools/audit.cjs` 每次跑附带 1280×720@dpr1.5 的"dpr回归"检查。别把 setSize 再改回 `false`。
- **准星=命中格**：`cam.dir` 与 `cam.aimOrigin` 是 `lookAt` 之后从相机**真实朝向**反推出来的（`_place`）。
  构图偏移一律通过相机位置/lookAt 表达，不要在别处再算一份 `fwd` 当瞄准方向——两套数一分开，准星压 A 格、命中的就是 B 格。
- **`Vector3.project()` 自带 viewMatrix**：要拿世界坐标去投影。先手动转成相机空间再 `project` 会被乘两遍视图矩阵
  （这个 bug 让"身体压准星"永远判不出来，折腾了三轮）。
- **实体坐标语义**：`pos`/`vel` 是 `GW.V`（只有 `set/copy/clone/len`），**不是** `THREE.Vector3`；
  `pos.y` 是身体中心（脚底 + `h/2`）。复活、顶出、生成点都要按半高放，否则半个身子埋进方块、每个方向都判碰撞。
- **相机地面**：用 `world.camGroundY`（跳过 LEAF），最多抬到头顶上方 1.9 格。相机所在格若是固体，靠**收缩 `curRadius`** 让路（并由 `latSm`/`floorSm` 的跟随速率摊成几帧），
   不要直接把 `cam.pos` 沿"相机→眼睛"搬走——那会造成 pos 与 curRadius 分家、下一帧按 radius 摆回来形成来回跳（旧写法实测单帧跳 1.44 格）。
   沿"相机→眼睛"逐步前移只保留为最后兜底（真埋进固体时），加了上面几条后实测触发 0 次。
   托举也必须是"抬完仍然 `cameraFree` 才抬"：无条件抬会把相机从墙后顶进墙里，与避墙逻辑打架（实测来回拽，单帧垂直跳 1.48 格）。
- **自己不入画是逐相机决定**：`cam.selfHidden`（躯干挡准星→整具不画）与 `cam.propsHidden`（只有手臂/肩上那张牌挡→只画到肩）。
  可见性在 `render()` 里每台相机设完就复原，所以**帧结束后读 `mesh.visible` 恒等于 alive**，要用这两个判定算可见集合。
- **测相机帧间抖动不能在样本之间传送玩家**，否则量到的是传送跳变而不是相机抖动。而且必须**先停掉主循环**
  （`GWAPP.running = false`）再按固定 dt 手动 `cam.update`：游戏自己的 rAF 与你手动的 dt=1/160 会交替驱动同一台相机，
  限流基准被两条时间线污染，量出来全是假数（我在这上面连错三次，其中一次把 3.8 格的样本间传送当成了抖动）。
- **机位约束不能是逐帧二值开关**：地面托举 `if (desired.y < floorSm) desired.y = floorSm`、避墙后把 pos 沿 fwd 搬走、
  换肩直接翻 `sideSign` 符号，这三处都会一帧把机位搬 1~2 格（实测最大 1.9 格），**目标平滑救不了它**——
  开关翻转本身就是要平滑的那个量。改法：托举加"抬完仍然自由才抬"的闸；埋墙判定用**最终**机位且让路时改 `curRadius` 而非搬 pos；
  换肩只改意图、位移交给 `latSm` 扫过去。另外遮挡检测与放相机必须用同一个 eye（曾一个用 `shoulder*0.55`、一个用 `shoulder*(0.84+0.42*collapse)`）。
- **给机位加限流必须把"转身构图运动"排除**：换朝向时 eyeF 自身要移动 1~2 格，把它一起限速会把相机拖在原地、身体重新糊住准星
  （实测 C2/C3 从 12/12 掉到 6/12）。做法：按上一帧的半径/侧移算出"纯转身应有的机位"，那部分位移全额放行，限流只吃超出它的约束变化量。
  按角速度主动收紧半径也一样，必须加 `want < radius - 0.01` 的遮挡威胁门，否则开阔地快速转身会把相机无条件拉到贴脸。
  **已收口（2026-10-16）**：camera.js 全量重写为 target-domain + 单一方程（`Servo.pursue`），约束只写目标、位移只出自伺服。
- **画在哪 ≠ 在哪：渲染位置是插值出来的**。逻辑仍是 20Hz 权威 tick，但 `e.pos` 只管判定，
   网格与相机读的是 `e.ppos → e.pos` 按 `acc/STEP` 的插值（`battle.js` 的 `snapshotPrev`/`renderPos`，
   `main.js` 的 `rp()`/`camViewOf()`）。以前两者都直接读 `p.pos`，真机 160FPS 下 8 帧才挪一次，
   就是用户 2026-10-16 报的"移动一卡一卡"。同窗口前后对照（seed 490706 巡航 245 个移动帧）：
   零位移渲染帧 66.5% → **0.8%**，单帧最大÷平均 3.23 → **1.1**（同一路径三次复测都是 1.10），jerk 2027 → **284~423**（三次：307/423/344）。
   报这类数请写区间或多跑几次：jerk 对个别帧敏感，单次值会骗到下一个会话。
   **读输出别看错块**：探针里 `mesh` 是**不带掩码**的全帧（含开局站着与撞墙的帧，零位移约 17%），
   `渲染_改动后` 才是 4 帧"逻辑在推进"窗口的口径（0.8%）；`sim_改动前口径`/`对照_同窗口未插值` 是 20Hz 直连的对照组。
   我自己在门禁输出里 grep 错过一次，把 `mesh` 的 17.4% 当成回归——数字对不上先确认是哪一块。
   `tools/feel_probe.cjs` 内置"逻辑在推进"的 4 帧采样窗——不带这个窗，"走进死路一直不动"会被读成台阶感。
   三条别退回去：① 判定 / 命中 / 存档一律读 `e.pos`，别把插值写回权威状态；
   ② 相机拿的是只带 `pos/yaw/pitch` 三个字的代理（camera.js 的 `_stepYaw` 只读这三样），
   别图省事把玩家对象传进去又顺手改 `p.pos`；
   ③ 单 tick 位移超过 `INTERP_MAX`（玩家 2.6 / 随从 2.2 / 抛射物 3.4 格）不插值，否则 blink 的 9 格会被拉成一帧滑过，
   相机也进不了"传送"分支（`jump>2`）。相机回归（cam_audit 的 J 项）手动 `cam.update(jp, ...)` 传的是**真实实体**，
   量的是未插值的机位——两边口径本来就分开，别互相"对齐"。
- **实体先落位、再摆相机**（`main.js` 帧尾顺序：`placeEntities → cam.update → updateAims → updateOverlays`）。
   相机判"谁挡准星"用的是网格的世界矩阵，实体晚落位就慢一帧；黄框与地形预览格必须排在 `updateAims()` 之后，
   否则准星高亮差一帧。`heroGroups` 的部件盒按"这台相机"进 `hgPool` 复用：每帧 14 部件 × 两台相机，
   旧写法每帧 new 84 个 Box3/Vector3，160FPS 下足够把一次 minor GC 的几十毫秒扫进手感里。
- **俯仰范围只有一个真源，越肩必须随俯仰收臂**。±89°（不是 ±90°）写在 `battle.js` 的 `G.LOOK_LIMIT`，
   `camera.js` 的 `LIM.pitchUp/pitchDown` 读同一份——旧值 -0.85/+0.72（低头 49°/抬头 41°）是早期拿"不让你往下看"
   掩盖"机位会飞到头顶 3 格"的土办法，用户 2026-10-16 拿 Minecraft 对照报"不能垂直向下看"。
   现在 `_solve` 末尾按 `PITCH_ARM`（flatK 0.85 / steepK 1.35 / minK 0.5）把目标臂长连续压到 `radius×0.5`，
   实测垂直向下时 `curRadius=1.48`、`|cam.y-眼y|=1.47`（审计 D 项口径 2.4 内）、无 NaN。
   **flatK 必须 = 旧上限 0.85**：取 0.5 时审计 C4 三种子全红——pitch=−0.85 的臂长被压到 2.29，躯干最近角点
   进到相机空间 1.45 内触发 nearStraddle，躯干投影在 x7~37%（没压准星）却被整具抹掉。收臂只管新放开的那段角度。
   两条纪律：① 收臂是**目标**，位移仍只出自 `rCh` 伺服，别改成硬钳 `cam.pos`（违反不变量 1）；
   ② 不取整 90° 是因为构图走 `lookAt`，视线与 `up=(0,1,0)` 完全平行时 `up×z` 退化成零向量，
   three r128 靠"给 z 加一点"能救但那一刻横滚会跳。
- **转向符号：θ 增大是往左**。相机 `fwd=(sinθ,0,cosθ)`、屏幕右 `=(-cosθ,0,sinθ)`，所以 `d(fwd)/dθ=-右向`：
  "向右转"（鼠标右移、E 键）必须让 `yaw` **减小**。这里曾写成 `+=`，鼠标和 E 都把画面转向左（用户 2026-10-16 在台式机报"鼠标反轴"）。
  移动侧 `battle.js` 用 `right=(-fz,fx)` 本来就对，**别跟着一起改**；俯仰 `pitch` 方向实测正确（上移=抬头），也没动过。
- **转向输入按渲染帧消费，不能绑在 20Hz tick 上**。键盘出牌/跳跃这类离散输入留在 `poll()`（与 tick 对齐），
  视角增量走 `KeyboardSource.flushLook(dt)` → `Match.applyLook()`，由主循环每帧调一次（`main.js` 的 `consumeLook`）。
  绑 tick 时实测：视角只在 25% 的渲染帧里变化、单帧跳 0.187 rad（10.7°），真机 160FPS 约 8 帧才动一次——这就是"视角拉扯"。
  暂停/结算画面也要 `consumeLook(dt,false)` 清空累加器，否则暂停时移动过的鼠标会在恢复瞬间一次性灌进来。
- **相机侧"身体是否糊准星"必须与审计同口径**：邻近判定用前方角点的**相机空间深度**（审计的 `bb.near` 同款），
  不是相机→盒面欧氏距离——后者一个口径漏判一个口径过判（1.25/1.45 两版实测都翻车）。
  `main.js heroGroups` 要**整子树遍历**（traverse+visible，同审计）；旧版只收直接子节点+一层描边，深层部件
  相机看不见，审计判它糊准星、相机不认（88092 的 C 项 1.31 格残留就是这么来的）。
- **传送帧（jump>2、通道随后 snap）不加"当前通道臂"与前瞻钳制**：snap 是整体落位、不存在推土路径；
  钳了它 snap 只能落到被旧姿态压小的机位，再按 vRelease 慢爬，审计 0.43s 沉降等不到构图恢复（C2 卡 7/12 的直接原因）。
- **"臂被中段遮挡物截断"必须给出路**：`_liftTarget` 只管相机所在列的地面，管不了 1.3 格外的草皮截臂；
  `_solve` 里用固定托举档逐档探臂（托举梯），找到出路后用 `_ladderR` **直接压过**目标臂长——
  否则 `latWant=latOf(rWant)` 形成循环钳制（rWant 塌→侧移更贴边→通道臂更短，实测 wantR 恒 0.55）。
  让路保持量 rFloor 的窗口只在**变得更紧**（0.01 死区）时续期；每帧无条件续期会让窗口永不过期而锁死。

## 角色模型不变量（2026-10-17 用户报"四肢各动各的、不像法师"后立的）

- **优先用素材原画，不要自己画/自己重采样像素**：用户的原话是"我测试过你的能力，你不适合直接画像素画的，尽量上网搜素材来用"。
  盒模型（从四个视图投影出来的方块）就是把专业像素**切碎重排**，合成后像一堆碎片（袖子像翅膀、袍摆悬空）；
  公告牌路径直接用素材自己的帧，四肢由美术带动。两条路径都留着（`G.HERO.setMode('box'|'bill')`），默认公告牌。
- **公告牌的朝向与镜像**：面片只绕 Y 面向相机，`rotation.y = 相机方位角 − 角色朝向`（角色朝向 = 组的 rotation.y − π）；
  贴图 **flipY=true 且水平不翻**——翻一次就把法杖换到另一只手（四方位实测过）。选哪一套帧按"相机在角色的前/后/左/右"，
  边界留 0.10 弧度迟滞，站在交界上不会每帧换图。
- **素材的 idle 与走路系列不是一套**：走路帧里杖在左手，idle/attack 画到了另一侧，混用会让杖"跳边"。
  站桩用 `front_walk[0]` + 骨架的呼吸/落地压缩，不用 mage_idle。
- **部件世界 AABB 有预算**：相机判"谁糊准星"用的是 `geometry.boundingBox × matrixWorld` 的**轴对齐盒**，
  斜 45° 站时会胀到 (宽+厚)/√2；低头/抬头时机位落到头顶上方或脚踝高度，胀出来的盒会把合并盒右缘推进准星窗口（闸 x0.47），
  于是"躯干没压准星却被整具隐藏"（审计 C4 红）。所以每个部件宽+厚控制在 ~1.0 格内，长条件（杖）用反向补偿保持世界竖直，
  摆臂幅度封顶。这条被 `hero_check` 的"越肩 3 航向 × 8 俯仰不许误隐藏"和"杖的世界 AABB 横向不胀"两条守着。
- **顶/底面不许贴整张正面图**：`tools/hero_bake.cjs` 给每个部件算"正面框顶行/底行的均色"做纯色盖子；
  贴整张图等于把 30 行高的袍子压进 2cm 薄片，斜上看像帽顶长角。
- **`tools/cam_audit.js` 的部件分组与隐藏集合必须认得子树**（按最近祖先判定）。它以前只比"直接子节点 + skip 列表"，
  关节一嵌套就永远比不中，把藏掉的部件当成"仍然画着"→C/C4 双双假红。改这份口径要在文件头写清并给用户过目。

## 怎么跑起来验证（不接受"文件已保存"当验收）

```bash
node tools/audit.cjs                       # 默认 490706/88092/31337 三种子 × 15 项，全 pass 退出码 0
node tools/audit.cjs --file 490706         # 走 file://（双击 index.html 的真实路径）
node tools/audit.cjs --shots /tmp/gwshots  # 审计 + 按 __camPose 落构图截图（交付前自己看图）
node tools/layer_check.cjs                 # 分层责任制机检：逻辑层碰 DOM / 写死文案 / 反向依赖，退出码非 0 就是越界
node tools/creative_check.cjs              # 背包/调试模式/UI 行为回归：53 条断言（指针交还、真鼠标点卡、飞行、俯仰、结算文案、分层静态检查）
node tools/ui_check.cjs                     # UI 框架三段：堆叠代数 + 静态分层 + 真页面冒烟 + 玩家真实动作（141 条，含类别手牌与生存背包）；只动样式跑 --static 也够
node tools/hand_check.cjs                   # 类别手牌：同类纯度、三堆守恒、打光不掺别类、未切类零漂移（24 条）
node tools/bag_flow_check.cjs               # 背包/手牌流转（28 条）：类别循环守恒、取卡货架吞牌/复制、拖拽落点、卡页门禁、720p 选关首屏
node tools/role_check.cjs                   # 出牌组（17 条）：每张卡一个 role、8 组都非空、按放出来干什么逐组核、移动组全员 hot:shift
node tools/auto_check.cjs                   # 自动开火（23 条）：只打攻击类、优先级、付不起不打、连发守恒、同价轮换、换牌、Shift 多张
node tools/left_click_check.cjs              # 左右键（13 条，真页面真鼠标）：左键临时切默认攻击组连发、松手切回；右键打选中牌、不循环
node tools/ui_shot.cjs --shots /tmp/gwui --gate   # UI 落图 + 样式门禁（八条）；再补一档 `--viewport 1280x720 --dpr 1.5`（用户台式机那档），然后自己看图
node tools/feel_probe.cjs 490706           # 移动"丝滑度"：零位移渲染帧占比、单帧最大÷平均、jerk
node tools/post_check.cjs 490706          # 光影层：中性参数与关光影像素一致 + 日照存在性 + 分屏/三档分辨率
node tools/jump_window.cjs 490706         # 起跳容错：coyote / 输入缓冲 / 按住不自跳 / 冰面滑行
node tools/chem_check.cjs                 # 物质交互：火烧穿 / 冰化水 / 岩浆凝黑曜石 + 稳态零成本 + 每 tick 预算
node tools/hit_check.cjs                  # 攻击判定：打偏 0.9~1.3 格仍掉血、偏 2.6 格不算中、单发伤害区间
node tools/vfx_live.cjs --shots /tmp/gwf   # 特效"画没画出来"：像素差分 + 预算 + 可关性，然后逐张看图
node tools/net_check.cjs                 # 联机传输层：六帧型往返 + 版本闸 + seq 去重 + 双道心跳（30 条）
node tools/net_sync_check.cjs            # 联机打包与覆盖：makeSnapshot/applySnapshot/1↔0 镜像/uid 对账/外推（node 里跑，不开页面）
node tools/net_e2e.cjs                   # 联机两端真跑一局：两个真页面配真房间码，E1–E8（默认）；--core 只跑 E1–E7。跑它时别并行跑别的量具
node tools/net_rtc_check.cjs             # 浏览器内置 WebRTC：两页邀请码/回应码 → 双端 loadout → 双端 match/tick
```

**改哪层 → 必跑哪条（提交前 `audit` + `layer_check` + `creative_check` 全过，不接受"文件已保存"）**

| 动了什么 | 必跑 |
|---|---|
| `src/` 任何文件（含只改文案） | `node tools/layer_check.cjs` |
| camera / battle / main / world / rules | `node tools/audit.cjs`（三种子）+ `--file` |
| 渲染位置、插值、tick/render 拆分、动画 | 再加 `node tools/feel_probe.cjs`（对照文件头基准） |
| 分块几何、面剔除、方块定义（`buildChunkGeometry` / `DEFS` 的 solid·opaque·liquid） | 再加 `node tools/ice_probe.cjs`（三种子）——audit 抓不到"某类方块一个三角都没生成" |
| 光影、后处理、色彩空间、日照（`src/shader.js` / `G.SHADOW` / `G.SUN_DIR`） | 再加 `node tools/post_check.cjs`（三种子）——"关掉光影必须与现状像素一致"是这层的验收口径，也是把光影与相机/手感基准隔离开的隔离带 |
| 特效拆分、配方、相位、动画量（`src/vfx.js` / `src/vfx-recipes.js` / `cards.js` 的 `fx` 字段） | 再加 `node tools/vfx_check.cjs`——它在 node 里跑，不依赖 GL：渲染侧怎么改都不该把它跑红，跑红就说明特效语义被顺手改坏了 |
| 谁把特效**画出来**（`src/vfx-render.js`：材质 / 槽位池 / 线宽 / 预算） | 再加 `node tools/vfx_live.cjs --shots /tmp/gwf`（含同机位开/关像素差分）并**自己看图**——"槽位 >0"不等于看得见，第一轮就是这么把白色细线当成"画好了" |
| 方块之间的元素反应（`src/chem.js` / DEFS 的 flammable·meltsTo·freezesTo·coolsTo / `world.set` 的 onSet 钩子） | 再加 `node tools/chem_check.cjs`——它同时是性能门禁：稳态必须零格查询、单 tick 必须守住预算与熔断 |
| 抛射物命中与范围伤害（`hitTestSegment` / `explode` / `cards.js` 的 `dmg(a, r, k, fuse)`） | 再加 `node tools/hit_check.cjs`——"能不能打中"是手感问题，只能用量化的偏心距离与伤害区间断言，截图看不出来 |
| 跳跃、移动、冰面（`battle.js` 的 `applyInput` / `collideAABB` / `COYOTE` / `JBUF`） | 再加 `node tools/jump_window.cjs`（三种子）——窗口类容错截图看不出来，`feel_probe` 也量不到"这一下到底跳没跳" |
| 块光、发光方块、光衰减（`G.LIGHT` / `World.lightField` / `emitOf`） | 再加 `node tools/light_probe.cjs`；判据必须在**盖屋顶的阴凉场地**上量 —— 露天顶面早被太阳照满，量出来只是"1.0 能不能再大" |
| 面板、HUD、菜单、拖拽、任何 UI | `node tools/ui_check.cjs` + `node tools/creative_check.cjs`（真鼠标点卡、指针交还、结算面板文案）+ `layer_check` + `audit` + **`node tools/ui_shot.cjs --gate`（常规 1440×860@dpr1 与 1280×720@dpr1.5 各跑一次）** + **自己截图看图**（菜单 / 背包三页 / 拖拽与提示 / 三选一 / 结算 / 分屏，逐张看）——布局类问题只在 dpr≠1 或窄一档时露头，本轮的键位带压血条就是这么抓到的 |
| UI 与游戏之间加一条通道（新意图） | `node tools/ui_check.cjs`——它反查意图词汇表与 `H.TEXT.ui.deny`：说了但没登记的意图、有 reason 没人话的拒绝都会被打回（这类漂移玩家看到的只是"点了没反应"） |
| 矿脉 / 经济 / 三选一 / 晶甲兽 / 关卡（`src/lode-*.js`、`pick-pools.js`、`rule-presets.js`、battle 的 draft/beast、选关 UI） | `node tools/econ_check.cjs` + `draft_check.cjs` + `beast_check.cjs` + `lode_scale_check.cjs` + `level_check.cjs` + `play_probe.cjs`（H/L/T）+ `audit.cjs`（三种子）；改了面板/HUD 再加 UI 那一组 |
| 音频（`src/audio-engine.js` / `src/sfx-table.js` / `src/audio.js`） | `node tools/audio_check.cjs`（再跑 `--file`）——"事件名对不上就静音"这种漂移人耳永远发现不了，只能靠词汇表反查 + 离线渲染断言 |
| 玩家角色模型 / 素材 / 动画（`src/hero-rig.js`、`src/hero-sprites.js`、`tools/hero_bake.cjs`） | `node tools/hero_check.cjs --shots /tmp/ghv`（31 条）+ `audit` 三种子 + **自己看图**：公告牌四视图、越肩两张，以及 `--assemble` 的装配图对源帧。它是视觉活儿，绿灯只保证没写回实体/没转错朝向，不保证好看 |
| 联机（`src/net-ws.js` / `src/net-match.js` / `src/net.js` 的 RemoteInputSource / `tools/net_host.cjs` / 选关里的联网入口 + `H.TEXT.net`） | `node tools/net_check.cjs`（传输·版本闸·去重·双道心跳）+ `node tools/net_sync_check.cjs`（打包与覆盖的纯逻辑）+ `node tools/net_e2e.cjs`（两端真跑一局；`--core` 只跑 E1–E7，默认 E1–E10）+ `node tools/audit.cjs`（三种子）；碰联机的面板/HUD 文案再加 UI 那一组。协议字段动一下就要两端 + `PROTO_VER` 同改，否则被版本闸拒在局外 |
| 输入通道（net.js / 键位） | `audit` 的 G/I 项 + 用真鼠标/合成事件复现一遍用户报的那个动作 |
| 玩法（`src/app/game-modes.js` / `src/app/match-director.js` / 计分行 / 选关玩法轴） | `node tools/mode_check.cjs` + `node tools/level_check.cjs` + `play_probe` + `audit`（三种子）——**加一个假玩法不许改 battle/director/UI** 是 M6 的判据 |
| 路由 / 页面（`src/app/router.js`、scenes、任何新面板页） | `node tools/router_check.cjs` + `scene_check` + `level_check` + `ui_check` + `creative_check` + `audit` |
| 配牌入口 / 手持栏两大模式（打击·建筑）/ 出牌兜底 | `node tools/ui_check.cjs`（类别段按组判）+ `node tools/hand_check.cjs` + `level_check` + `play_probe` + `audit` |
| 背包/手牌流转（`systems/deck.js` 的抽/洗/补/放、`ui/items.js`、`ui/drag.js`、卡页按钮、类别条） | `node tools/bag_flow_check.cjs` + `hand_check` + `ui_check` + `creative_check` + `layer_check` + `ui_shot --gate`（两档）+ `audit`——**守恒判据**（hand+deck+discard 的多重集）只有 bag_flow_check 在真页面上量 |
| 出牌组（`cards.js` 的 role / `deck.js` 的 inClass / 类别条与背包片）· 自动开火 / 左右键分工（`systems/auto.js` / `main.js` 的 mousedown / `H.TEXT.hotbar` 的徽章） | `node tools/role_check.cjs` + `node tools/auto_check.cjs` + `node tools/left_click_check.cjs` + `hand_check` + `bag_flow_check` + `ui_check` + `creative_check` + `layer_check` + `ui_shot --gate`（两档）+ `audit`——组与加特林的手感只在真页面上按得住，node 里量规则、页面上量按键 |
| 战前选牌（loadout 面板 / 意图 / `H.TEXT.loadout` / 联机的 `loadout` 帧） | `node tools/level_check.cjs` + `ui_check` + `creative_check` + `ui_shot --gate`（两档）+ 联机线那一组（`net_check` / `net_sync_check` / `net_e2e`） |

需要单步调试时才手动起服务（`tools/audit.cjs` 自带禁缓存静态服务；或 `python3 -m http.server <端口>`，端口自选、别复用本机已在跑的），在控制台或 Playwright `page.evaluate` 里：

```js
await (0,eval)(await (await fetch('/tools/cam_audit.js')).text());
await __camAudit({ seed: 490706, deck: 'starter', mode: 'train' });   // 15 项量化检查，要 pass:true
__camPose({ x: 7.5, z: 7.5, yaw: 0.79, pitch: 0, mode: 'first' });    // 摆姿态供截图
```

- 判定口径与三个测量坑写在 [tools/cam_audit.js](tools/cam_audit.js) 文件头；它只从 `GW.CAM_CROSS` 取准星区，
  并且**独立按部件投影**，不复用 `main.js` 的隐藏集合——两边各算一份才能对出差错（就是这么抓到"低头误隐藏"的）。
- **谁挡准星就只藏谁**：躯干/头挡→整具不画；只有腿挡→`legsHidden`；只有手臂或肩上那张牌挡→`propsHidden`。
  判据必须是**逐个部件**的投影。曾经用一个"整具身体的包围盒"判，斜着站时盒宽被放大到 0.96 格、竖直跨从头到脚，
  镜头一压低就蹭到准星边界，把根本没挡视线的角色整个抹掉。
- 逻辑冻结类问题看 `GWAPP.stepErrors` / `GWAPP.lastError`；`Match.step` 抛异常已被主循环护栏包住（顶栏会出现 ⚠）。
- 视觉改动交付前自己看一眼渲染结果：`node tools/audit.cjs --shots /tmp/gwshots` 落图后逐张看；仓库不再存截图（历史图在 git 与 `/tmp/卡牌纪元-removed-2026-10-16/_shots/`）。
- 自动化环境是 SwiftShader 软件光栅，那里 50 FPS 上下**不能**当真机指标；用户真机报过 160 FPS。
  反过来说也成立：**真机帧率远高于自动化环境时，绑在 tick 上的东西才会露馅**（视角拉扯就是这么冒出来的），
  自动化环境帧率低反而看不出卡顿感。手感类问题不能只靠我这边的绿灯下结论。
- **鼠标转向这条路径 headless 拿不到真值**：锁指针后 Chromium 不再派发真实 `mousemove`（实测 62 个事件全发生在锁定之前，
  累计 `movementX=-640` 只是光标回中的跳变）。测转向必须像 cam_audit 那样**合成 `mousemove` 注入**并临时置
  `GW.pointerLocked = true`，否则会把"没反应"当成"正常"。判据验**往哪边转**：Δdir·相机世界矩阵右向量 与 原准星格屏幕位移
  两个指标同号才算过（单指标会翻车：转角 257° 时点积判据直接给出错误的"正确"）。
  不能只断言 yaw 变号——上一版 G 项写的是"按 E 后 `yaw > 0.15`"，而当时"E→yaw 增大"这个约定本身就是反的，绿灯把 bug 锁住了。
- **浏览器版本别当挡箭牌**：用户台式机 Chrome 155.0.8059.79，验证环境 HeadlessChrome 145；反轴在 145 上用合成事件照样复现，
  说明与版本无关。"我这边正常"不等于"用户环境有问题"，先在本地用等价输入复现再下结论。

## 键位

- P1：WASD 移动 · 空格跳 · **转向只有鼠标**（点画面锁定）· F/V 俯仰兜底 · **左键：默认攻击牌组按住连发** · **右键：打出物品栏选中那张**（见上文 6b）· 1–5 指定出牌 · 滚轮/Tab 切卡 · **Shift 触发移动牌**（移动组全员 `hot:'shift'`）· **Shift+滚轮 换出牌组**
  - **Q/E 不再转身**（用户 2026-10-17 要 Minecraft 式）。`tools/cam_audit.js` 的 G 项量键盘通道时改用**它自己 new 的 KeyboardSource 声明的** J/K——判据、阈值、双指标同号口径一条没改，只是换了注入的物理键（E 已是背包键，一按就暂停逻辑，量出来必然 0）。**这条属于口径改动，已过目给用户。**
  - **E = 背包，生存模式也能开**（I 同义）：物品栏 / 随身格 / 牌库 / 弃牌堆都可见；只有图鉴取卡与调试页要创造模式（文案表里标 `creativeOnly`，`ui_check` 机检）。
- 视角：**C** 循环 越肩 → 第一人称 → 越肩不画自己（选择记在 `localStorage.gw_camMode`）
- 全局：T 分屏 · H 帮助 · M 静音 · R 重开 · F3 渲染分辨率 · F9 / Ctrl+F9 存档导出 · **P** 光影开关（记在 `localStorage.gw.post`）
- 选关界面：Esc = 返回标题（场景与面板一起退，否则主循环会按"还在 level"冻结）；「开始对局」= 真用户手势（音频在这里解锁）
- P2（分屏）：方向键移动 · 右 Shift 或 Enter 跳 · N M , . / 出牌 · [ ] 微调视角，主转向自动锁向对手
- 调试（创造模式）：**G** 开关 · **I** 背包（打开时逻辑暂停）· **X** 飞行（空格升 / 左 Shift 降）· 菜单可勾"进局开启"；只作用于 P1

## 玩法与临时形态（2026-10-17 用户定性，先读这条再动机制）

- **对战玩法定案已落地（见下面第二条）；分屏 / 训练 AI / 联网仍是脚手架。** 这些形态不是产品特性，也不是需求：
  - 「单人训练（AI 对手）」= 没有真人时跑通链路的测试夹具（`net.js` 的 `AISource`），不是承诺的游戏模式；
  - 「同屏分屏双人 PVP」（按 T）= 验证两端状态一致的同机手段，同机两人不是目标场景；
  - 「联网 PVP」= **局域网房主权威已可玩**（`tools/net_host.cjs` + 两端同一份 `index.html`，见 [README.md](README.md)「联机（局域网，房主权威）」）；它的价值仍是"验真人对局下两端是否一致"，
    公网 / NAT 穿透 / 匹配 / 防作弊都没做，也暂时不是需求 —— 别把它写成平台级正式特性；
  - 「76 张卡 + 12 张初始牌库」= 为铺满测试矩阵堆的量（每种 target shape、每类结算分支都要有卡打到），不是内容规划；
  - 「先赢 2 杀 / 血条 100 / 复活 3 次不到」= 早期随手值，**不是设计结论**。
  别把这些临时形态当需求去"完善"，也不要在任何文档里把它们写成正式特性。
- **玩法定案 v1 已落地（2026-10-18）。现状以代码 + 量具为准，不再有"代码尚未落地"这句话：**
  - **A0 经济**：魔力 起始 3 / 上限 8 / +0.9 每秒（占矿再 +0.15/s，走 `LodeSystem.manaBonusOf`）；
    素材 起始 8、建造按格扣、挖掘不返还、付不起走部分成交；复活 `mana=min(cap,2)`、素材不变。
  - **A1 地图与得分**：三张正方形图（64/96/128）按 `scale = SX/64` 缩放矿脉环带与连通闸；
    占矿 1 分/3s、占矿 +1 素材/6s、击杀 +15、三态终局（score / time / overtime）、8 分钟硬上限。
    **默认图 = duel-64**（三种子相机审计 15 项全过；96/128 仍标实验，96 在 31337、128 在两种子上 C4 红）。
  - **A2 成长与生态**：首占矿脉三选一（每矿每方一次、每方整局 ≤3 次；名义群系由 seed 派生且三矿互异，
    池在 `src/cards/pick-pools.js`）；选中卡 ×2 进牌库并重洗（`Match.grantCard`，MatchOps 第 16 个方法）；
    每矿一只中立晶甲兽（首杀 +3 素材 + 一次通用池三选一，每方 ≤3 次）；以太晶采走后 12 秒原位再生。
  - **还没做的**：法阵 hp 接真实伤害（§7.4 步 4）、删 `requires.night`、终局可达性调参
    （rational_probe 的旧结论仍在：独占一条矿 ~300 秒才够 100 分，而一局限时 480 秒）。
  - **现行口径唯一真源**：[docs/GAMEPLAY.md](docs/GAMEPLAY.md)（胜负/地图）+ [docs/CARD_ECONOMY.md](docs/CARD_ECONOMY.md)（牌与经济）
    + [docs/LEVELS.md](docs/LEVELS.md)（关卡：地图 × 规则 × 模式）。数值只在 `src/app/rule-presets.js`、
    `src/cards.js`、`src/lode-system.js` 里；**不许在装配层或结算器里再写死一份**。
  - 分屏、训练 AI、`p.lives` 记录字段仍是**脚手架**；命数不再参与胜负，别拿它当判据。
  - 历史第 0 步 **A-1（修命中）不许回退**：命中率曾只有 1.2–2.6% 的教训留在 play_probe 的 T1；
    依据链归档在 [docs/archive/](docs/archive/)（BRIEF/BASELINE/PROPOSAL/KIMI/CAMERA_REVIEW）。
- **实现前必读定案 §7「类设计拆解」**：18 条新事物已逐条裁决归属层与类——**只新建 4 个运行时类**
  （LodePlanter / GroundProbe / ReachabilityGate / LodeSystem，全在 L1 world 与 L4 battle），其余全部扩展现有类；
  MatchOps 只申请 1 个新方法（grantCard，第 16 个，已登记）。**按 §7.4 一次一个类提交、不打包**，
  §7.3 预先拒绝的三种写法（矿脉塞进 TerrainBuilder、占矿判定写进 ui、为三选一另写一套列表 DOM）不接。
  本期代码进 src/ 单轨，但文件名与类名按 src/ 目标架构定，迁移时机械搬移。
- **玩法改动必须有量化回归**：现有门禁只管相机/分层/手感，**没有一条断言在管"好不好玩"**；
  机制改动要配 `tools/play_probe.cjs` 一类的量表（地形卡打出率、伤害来源分布、单局时长、出生点公平性），
  否则"改了数值更好玩"这种话无法核对，下一个会话只能重猜。

## 玩法编排（MODES：加一个玩法只动数据）

- **三层分工写死在文件边界上**：玩法"是什么"在 [src/app/game-modes.js](src/app/game-modes.js)（纯数据）；这一局"怎么走"在
  [src/app/match-director.js](src/app/match-director.js)（阶段 / 记分 / 终局 / `displaySpec`）；"画成什么样"在 UI，只按 director 给的
  `rows/chips` 渲染，**面板不许自己判几杀算赢**。权威层 `battle.js` 只留三个钩子：`onKill` / `tick`（代 `scoreboardStep`）/ `lodePoints`。
- **加一个玩法**：`GAME_MODES` 加一条（得分表、`win`、`map`、`display.rows`）+ `H.TEXT.game` 两句文案；选关面板按 key 自动长出一张卡。
  不改 `battle.js`、不改 `match-director.js`、不改面板。`tools/mode_check.cjs` 的 M6 用一个**运行时注册的假玩法** `testmode`
  把这条扩展性钉住——它一旦需要改上面三个文件才能跑，就是写死了。
- **限定 / 不限分**：`win.target > 0` 是限定；`0` 是"不限"（`win.type` 退化成 `never`，只按 `timeCap` 判，`timeCap:0` 则永不自动结束）。
  deathmatch 的胜分三档（5 / 10 / 不限）在数据层的 `DM_TARGETS`，选关那一行只读它，不许在面板里再抄一份。
- **lode（默认玩法）行为不许被这套框架改掉**：`lodePointsPerTick:1` 时 director 把时间/终局**整段委托**给现成的
  `G.Systems.Scoreboard.step`（100 分 / 480s / 45s 加时 / 逐级判定），击杀仍走 `addScore(p,15)`；三条老量具（`play_probe` / `audit` / `draft_check`）
  是这条的守门人，跑红说明默认玩法被动了。
- **显示也是编排的**：`vm.board` 只来自 `director.displaySpec()`，顶栏按 `rows` 顺序渲染、行名只来自 `H.TEXT.board`。
  加一列数据 = 改数据层 + 加一个中文 key，不改面板。

## 其他边界与未完成（如实）

- **联机（局域网 · 房主权威）已可玩**：`node tools/net_host.cjs 8787` 起配对/转发/心跳进程（零依赖，不是权威对局端——`Match` 跑在房主页面里），
  两端双击同一份 `index.html`；入口有两条且都通：**菜单的模式行直接点「联网 PVP」= 选成 net 并跳进选关**，或「开始游戏」→ 选关里选模式。
  房主可用 `start-net.bat` / `start-net.sh` 起服务（内部还是 `node tools/net_host.cjs 8787`）；选关的联机块顶部写着三步说明，
  字段下面是**就地开始按钮**（`#btnLevelStartNet`，与列尾的 `#btnLevelStart` 同一个意图）。**开局前先过 `loadout`**（双方各选 12 张、单卡 ≤2、地形 ≥4，
  双方 ready 才由房主用两副牌库开局；协议 v4 见 [docs/NET.md](docs/NET.md) §10）。验收与差距写在 [DEVLOG.md](DEVLOG.md) 的「联机对局（局域网，房主权威）」
  与 [docs/NET.md](docs/NET.md) §9：guest 没有命中特效（不做事件帧）、guest 出牌要等房主裁决 ≈ 一个 RTT（不做预测与回滚，NET §3 不退）。
  **仍未做**：公网/NAT 穿透、账号与匹配、防作弊与反外挂。
- **「卡顿」不许当「掉线」**（2026-10-18 已修，E8 守着别退回去）：`tools/net_host.cjs` 按应用心跳缺席 1 秒发 `timeout/peer-stalled`，
  那只是「对面画面卡了」——`src/main.js` 收到只 toast 提示（`H.TEXT.net.stalled`），**不结算**；真掉线由 `bye host-gone/guest-gone` 或 TCP 判死负责。
  以前这里直接结算，一次长 GC / 切窗口 / 软件光栅卡顿就能踢掉整局（`tools/net_e2e.cjs` 的 E8 注入 1.5 秒阻塞盯着）。
- 存档是 seed + 差异格，不保存实体与法阵状态。
- 触屏与手柄未支持；分屏假设一台键盘两人。
- 旧计划/任务单/报告已归档到 [docs/archive/](docs/archive/)（PLAN_*、ARCHITECTURE、TASK_*、A*_REPORT、GAMEPLAY_* 报告等），**不再代表现状**，不要按里面的路线图施工。
  物质交互以 `src/chem.js` 的 REACT 表 + DEFS 属性为准。仓库根只有 `index.html` 一个启动入口。

## 协作习惯

- 临时文件放 `/tmp/`；不 `rm`，要移除先 `mv` 到 `/tmp/` 并说明位置（现在 git 里也留得住历史，删除前想清楚）。
- 一次只改一个明确问题，改完就跑对应检查；同类失败两次就停下来读原始报错，不继续猜。
- **文档只写不变量、口径与「谁拦」**，不缓存某一天的红/绿：AGENTS=不变量与口径，[docs/UI_KIT.md](docs/UI_KIT.md)=组件的坑与施工法，[DEVLOG.md](DEVLOG.md)=按轮次的历史，[README.md](README.md)=给外人看的入口（不写当天的红/绿）（当天的数字可以留在自己那一轮里，但**别把别的线的临时状态写成事实**，例如「某种子暂时红」——隔天就骗人）。
  文中出现的「N 条」只是那段断言在管什么的简写，**不是基线**：真实条数与红/绿一律以脚本输出为准。
- 验收通过就 commit（信息写清测了什么）；用户双击的 `index.html` 必须永远是能玩的状态。
  **还有一条：别人会整文件 `git add`，你的半成品会被顺手提交。** 2026-10-17 实测踩过——卡牌线一刀提交把机制线在 `src/battle.js` 里**未验证**的胜分 75 带进了 HEAD，而配套的升温还在 `src/lode-system.js` 工作区里没验没提，仓库当场成了"门槛降了但没有升温"的半套。
  规矩：未验证的改动尽量只落在**自己独占的新文件**里；共享文件（battle / rules / main / cards / ui）只留验收通过的最终态。数值要动共享文件又还没验完，就在那行写上「待 A 刀验证，勿单独提交」，或者干脆不写进工作区、由机制线在固定内容对上统一提交。
- 提交前门禁：`node tools/audit.cjs`（相机/操作口径）+ `node tools/layer_check.cjs`（分层）+ `node tools/creative_check.cjs`（调试模式与 UI 行为）+ `node tools/ui_check.cjs`（UI 框架三段），
  碰了渲染位置/手感再加 `node tools/feel_probe.cjs`；碰了 `.ui-*` 样式或任何面板布局再加 `node tools/ui_shot.cjs --gate`（含 `--dpr 1.5` 那一档）。这些回归脚本**必须留在 tools/ 里**，不要只放 /tmp——
  /tmp 里的测试下一个会话就找不到了，等于没有验收（本轮的背包/结算回归一开始就只写在 /tmp，已固化进 creative_check.cjs）。
  分层这类约定**只写在文档里等于没写**，新增规则时同时想清楚"谁来拦"：能机检的写进 `tools/layer_check.cjs`，别靠下一个会话自觉。
- 与用户怎么说话（简洁、先结论、可视化优先）看全局 `~/.dsh/AGENTS.md`，这里不重复。