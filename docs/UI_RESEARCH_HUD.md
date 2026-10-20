# UI_RESEARCH_HUD.md · 像素体素卡牌对战 · HUD/卡牌 UI 设计检索

> 检索用途：为浏览器端像素 3D 体素卡牌对战（three.js 渲染世界 + DOM 覆盖层 HUD，中文界面，1080p/4K，dpr=1.5）做 HUD 与卡牌 UI 的设计参照与反面清单。
> 每条结论写成**一句可执行的话**；末尾给"对本项目的 10 条硬建议"。
> 说明：同类产品的屏幕布局是这些游戏公开画面的稳定事实，本文按可观察到的实际做法逐条落到"放哪、多大、常驻否、怎么让位画面"；通用原则与反面清单按 WCAG / 微软游戏无障碍 / 主流卡牌 UI 教程等来源给出可核对链接。凡是没有第二来源、只来自单一印象的判断，已标注为"惯例/常见"而非绝对数值。

---

## 1. 同类可参照产品的 HUD 与菜单实际做法

判据口径：每条回答四件事——血/资源/手牌/计时器**放在屏幕哪个区**、**多大**、**是否常驻**、**怎么让位给画面（diegetic 场景内 / non-diegetic 纯 HUD 层）**。

- **Noita**（non-diegetic，像素硬边 HUD）：血量用左上角一行像素红心（半心可显示，心数≈血量档位），金币数与其下排一行常驻在左上角；施法条=底部一排最多 4 根法杖横向排列，每根杖里的法术按顺序显示；HUD 全部贴四角/底边、中央大片留给画面。可执行：把"血/资源"做成左上角常驻小图标条、把手牌/施法做成底部一条带、中央只留准星，是像素游戏最稳的布局范式。来源：[Noita 画面与 HUD 讨论](https://steamcommunity.com/app/881100)。
- **Slay the Spire**（non-diegetic + 半物理卡）：能量球（带大数字的发光圆）固定在**左下角**、结束回合按钮固定在**右下角**、抽牌堆/弃牌堆计数贴在右下，遗物沿**左边缘竖排常驻**，手牌在**底部中央**轻微重叠扇形排布；敌人头顶常驻"意图图标"（攻击/防御/增益）作为情境信息。可执行：能量/费用用左下角一个带大数字的圆形元素，结束回合等大动作沉到右下角，让顶部和中央完全让给战场与卡牌。来源：[StS 界面指南](https://www.ludo.guide/guide/slay-the-spire/getting-started/understanding-the-user-interface)、[StS 战斗机制页](https://saschb2b.github.io/game-mechanics/games/slay-the-spire/combat)。
- **Balatro**（diegetic 道具 + 顶部非物理读数）：屏幕顶部一条常驻状态栏（左侧 Round/Ante/Score、右侧盲局目标与倍率），左侧竖排 5 个 Joker 槽、手牌在底部横向重叠；用**厚重复古像素字体 + 高对比色块**（筹码即物理 poker chip 属 diegetic 视觉语言）。可执行：把"计分/资源/目标"集中成顶部一条横栏，手牌沉底、道具竖排在侧，读数以高对比大字块呈现，避免散点漂浮。来源：[Balatro UI 系统（UIBox/DynaText 逆向）](https://deepwiki.com/balatro-src/balatro-src-reverse-engineering/2.3-ui-system-(uibox-and-dynatext))。
- **Minecraft**（non-diegetic，半透明条，像素）：快捷栏 9 格**底部正中常驻**（选中格白色高亮框），血量红心排快捷栏上方左侧、饥饿肉腿排上方右侧、护甲/经验条夹在中间，准星在正中心，物品数量角标在每格右下角。可执行：底部中央一条居中快捷栏 + 血量/状态镜像分布在它上方两侧，是"手牌与生命共存"的经典密度参照。来源：[Minecraft UI/快捷栏说明](https://es.minecraft.wiki/w/Interfaz_de_usuario#Barra_de_objetos)、[SuperHud7（自定义 HUD 布局参考）](https://www.curseforge.com/minecraft/customization/superhud7)。
- **Dead Cells**（non-diegetic，克制型）：左上角一条**分段血条**常驻（无大数字），生命药水滴与金币计数贴左上；受伤反馈主要靠角色闪烁与屏幕边缘暗角（低血红晕），而不是把数字放大。可执行：常态血条做得小而克制，用屏幕边缘反馈（低血红晕/方向性受击）承担"发生了什么"，别用大块数字抢画面。来源：[Dead Cells 玩法与 HUD 讨论](https://forum.quartertothree.com/t/dead-cells-metroidvania-roguelite-in-early-access/129733/448)。
- **Inscryption**（全 diegetic）：整局是一张 3D 桌子，卡牌物理摆在桌面、手牌以实体卡扇形停在屏幕下缘，资源（血/骨/能量）做成**场景内物件与卡面标记**，玩家血量显示在两侧支柱的心形刻痕上；悬停卡会倾斜并投影、拖拽即出牌。可执行：走 Inscryption 路线就得让"血/资源"长在场景物件上（不另起一层 HUD 数字），代价是必须用灯光与描边把可交互物从背景里"抠"出来保证可读。来源：[邪恶冥刻（维基百科）](https://zh.wikipedia.org/wiki/%E9%82%AA%E6%81%B6%E5%86%A5%E5%88%BB)。
- **Hand of Fate 2**（diegetic 桌面 + 边缘非物理读数）：战斗与卡牌都发生在一张桌上（卡牌翻转、扇形展开在桌内），血/体力/金币/装备做成**摆在桌上的实体**（药剂、硬币、武器），技能用径向菜单；HUD 只把必须常驻的量贴到屏幕边缘。可执行：想"让位给画面"就学它——把资源做成桌上的实体、只留最少量的数字 HUD 在边缘。来源：[Hand of Fate 2 UI（Eko Chandra / ArtStation）](https://ekoch.artstation.com/projects/GXDa4Q?album_id=652875)。
- **Loop Hero**（non-diegetic，读数 + 情境面板）：左上角常驻**血条 + 经验/等级条 + 法力条**，资源与地图信息贴角；装备是格状背包，点开才出现，右侧用**详情 tooltip** 解释装备；地图/路径在中央。可执行：把"血/等级/法力"三条常驻读数收进左上角一小块，装备详情做成情境 hover 面板，中央只放地图——这是"资源多但 HUD 小"的标准处理。来源：[Loop Hero 评测（Graphics 页）](https://www.overclockersclub.com/reviews/loop_hero_review/2.htm)、[Loop Hero 攻略（HUD/背包截图）](https://gamemad.com/guide/36479)。

**跨产品共同结论（可执行）**：八款里凡是要"给画面让位"的（Inscryption/Hand of Fate/Balatro 筹码）都把资源做成**场景内物件或物理卡**，而凡是读数多的（Minecraft/Dead Cells/Loop Hero）都把读数**贴到左上+底部一条**；本项目是 3D 世界 + DOM 层，最稳的折中是**读数贴角/贴底成一条窄带常驻、把卡与法阵做成画面内的物理对象**，不要在中央放半透明大面板（中央是体素世界的主视觉热区）。

---

## 2. HUD 设计的通用原则

每条一句可执行的话，附来源。

- **视线热区**：让"必须 1 秒内看到"的量（血、费用、计时器）落在**靠近中央或中央与角落之间的近中央带**，把"看一眼就走"的静态量推到屏幕角落——依据是 F/Z 型扫视（中央与左上先被看，边角最后被看）。来源：[RWTH 眼动扫视研究 PDF（Z-pattern）](https://publications.rwth-aachen.de/record/963850/files/963850.pdf)、[基于玩家凝视区摆放 HUD 元素的专利](https://patentimages.storage.googleapis.com/69/21/52/4a61149843ef90/US20220350138A1.pdf)。
- **信息分层**：把 HUD 分成**常驻层**（血/资源/手牌/计时，永远在）、**情境层**（悬停详情、选中信息、目标血条，按需出现）、**瞬时层**（伤害飘字、获得提示、连击，出现即自动淡出）——三层的显隐规则不同：常驻层不许被别的面板顶掉，情境层跟随指针，瞬时层限时自动消失。
- **glanceability（1 秒可读）**：每个关键读数必须靠**前注意特征**（尺寸、颜色、位置）单独成立——即"不看懂文字也能判断多少"（血条长度、费用圆大小、图标颜色），文案只是补充。
- **对比**：正文 HUD 文本对背景对比度 **≥ 4.5:1**，大号文本（≥18pt/约 24px，或 14pt/约 18.66px 加粗）≥ **3:1**，图标等非文本关键轮廓 ≥ **3:1**。来源：[WCAG SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum)。
- **字号下限**：不要用绝对小字号定 HUD——用 CSS px 设定并在 dpr 下测试；正文建议 ≥ 16px、需"扫一眼"的数字 ≥ 24px，**中文因笔画多应比英文再大一档（正文 ≥ 18px）**，并允许玩家缩放 HUD 文本。来源：[微软游戏无障碍特性标签（游戏内所有前端菜单文本）](https://learn.microsoft.com/zh-cn/gaming/accessibility/accessibility-feature-tags)。
- **屏幕安全边距**：HUD 元素与屏幕外沿留出**约 3.5%~5% 的安全区**（Xbox 的 action-safe/title-safe 惯例：title-safe 约 5%），任何按钮/读数不得贴死边缘，避免不同宽高比裁切与"贴边像没做完"。来源：[Xbox 屏幕区域（content area / safe area）](https://devdocs.xbox.com/build/core-features/graphics/overviews/screen-areas)。
- **双键位/键位提示**：键位提示必须**跟随当前输入设备**显示对应符号（键盘显示键帽字、手柄显示对应图标），不要同时堆键盘+手柄两套，也不要用纯文字"按 X 出牌"而缺图标。来源：[微软无障碍标签（支持输入设备一致性）](https://learn.microsoft.com/zh-cn/gaming/accessibility/accessibility-feature-tags)、[Godot 键位提示系统讨论](https://forum.godotengine.org/t/advise-for-a-controlling-hint-system-keyboard-or-controller-input-how-to-get-controller-input/87960/2)。
- **pause/menu 层级与焦点顺序**：菜单必须**单一焦点顺序**（上→下或左→右单向可达，不用先 Tab 跳进跳出），打开时默认聚焦"继续/确认"项，Esc 逐级返回；焦点项要有 ≥3:1 的高可见焦点环，鼠标点击与手柄/键盘选择行为等价。来源：[微软游戏无障碍特性标签](https://learn.microsoft.com/zh-cn/gaming/accessibility/accessibility-feature-tags)。
- **diegetic vs non-diegetic 选择口径**：读数多、要精确对比的（血/费/时）用 **non-diegetic 贴角条**；氛围与"我在摸桌面上的牌"用 **diegetic 场景内物件**；混合时让 diegetic 物件负责"识别是什么"、non-diegetic 读数负责"是多少"，两者不要互相遮挡。来源：[diegetic 与 non-diegetic 在游戏里对比的方法（ACM 论文）](https://dl.acm.org/doi/pdf/10.1145/3014812.3014881)。

---

## 3. 卡牌 UI 惯例

- **手牌排布**：优先用**底部中央、轻微重叠的直立弧形**（StS 式），扇形角度要小——纯大扇形会让边缘卡难以点击且文字歪斜，重叠+hover 抬升比全展开更适合 5~10 张。来源：[Slay the Spire 式手牌扇形实现教程](https://github.com/stormtoy/card_fan_demo)。
- **选中态**：选中/悬停的卡必须同时给出**抬升（上移）+ 放大 + 亮边描边 + 提到最前层**四件事，缺任一都会被误判为"没选上"；层序用统一图层表管理，别每张卡手写 z-index。来源：[StS 手牌实现](https://github.com/stormtoy/card_fan_demo)、[Balatro UI 层系统（UIBox 排序）](https://deepwiki.com/balatro-src/balatro-src-reverse-engineering/2.3-ui-system-(uibox-and-dynatext))。
- **可用/不可用（费用不足）态**：费用不够时**不要隐藏卡、不要全灰到看不清**——用"费用数字转红 + 卡面轻微压暗 + 点它时抖动并弹出'魔力不足'说明"三重反馈，保留可读性同时明确不可出。来源：[点击禁用按钮时的提示讨论](https://forum.orkframework.com/d/10539-displaying-a-message-when-clicking-a-disabled-button/3)。
- **hover 详情（tooltip）**：悬停**延迟约 0.5~1s 再出**（避免扫过误弹），tooltip 含**全名、费用、伤害/数值、效果正文、关键词解释**；卡面太长时把正文放进**右侧/上方固定面板**而不是压在卡上遮画面。来源：[Tooltip usability（Nokia HCI）](http://developer.nokia.com/community/wiki/index.php?title=Special:WebkitPdfPrint&page=Tooltip_usability)、[tooltip 打开延迟 issue 讨论](https://github.com/thumbtack/thumbprint/issues/158)。
- **拖拽反馈**：拖拽时有一张**跟随光标的幽灵卡**（略透明+倾斜朝拖动方向），落点合法时高亮落点格/目标、非法时落点变红并回弹；卡离开手牌位后原位置留占位框。来源：[StS 式手牌拖拽/布局](https://github.com/stormtoy/card_fan_demo)。
- **稀有度视觉编码**：沿用大众已建立的**颜色阶梯**（普通=白/灰、稀有=蓝、史诗=紫、传说=橙/金，卡框与宝石按此上色），一眼分级。来源：[Hearthstone 稀有度色阶](https://liquipedia.net/hearthstone/Rarity)。
- **元素视觉编码**：元素（火/水/雷/冰…）用**固定色 + 固定图标**双编码——不能只靠颜色，必须叠加图标/文字，保证色盲也能区分（WCAG 1.4.1 用色）。来源：[WCAG SC 1.4.1 Use of Color](https://canadabuys.canada.ca/documents/pub/att/2020-07-06/a48c9bf249ce56d781cd2d7ae8d9d0c2/rfp_r0000059995-english.pdf)。

---

## 4. 反面清单（新手常犯的"丑 HUD"特征）

每条 = 一个要规避的具体现象 + 该怎么改。

- **灰底黑字半透明糊成一片** → 禁用"半透明灰底 + 深色字"叠在画面上；改为**深色实底条 + 亮色字（对比≥4.5:1）**，或给文字加 1px 暗描边/底衬保证任何背景下都读得出。来源：[WCAG SC 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum)。
- **边框粗细不一致** → 全套 HUD 只定**一档或两档描边宽度**（像素风常用统一 1px 或 2px 外框），所有面板/卡/按钮共用，禁止各写各的 border。
- **字号层级太多** → HUD 只保留**不超过 3 档字号**（标题/正文/角标），别出现第 4、5 种字号；层级靠"粗细+位置+颜色"区分，而非不停加字号。
- **图标与文字混排对不齐** → 图标与文字用同一基线、固定间距（图标高≈文字行高），并成组对齐，杜绝"图标浮在半空、文字偏下"。
- **居中一屏按钮像网页表单** → 暂停/设置不要"正中一列按钮"；用焦点顺序的**面板/侧栏**，按钮左对齐或成对排列，避免网页表单观感。
- **阴影糊边** → 像素风里禁用柔和大模糊投影；用**硬投影/1px 暗底/纯外描边**替代，模糊阴影在像素上必糊。
- **圆角与像素风冲突** → 像素/体素风禁用大圆角与抗锯齿圆角，用**直角或 1~2px 阶梯直角**、9-slice 边框纹理，保持硬边；抗锯齿曲线与像素网格打架。来源：[nine-slice 像素安全边框组件](https://www.npmjs.com/package/@nine-slice-frame/svelte)。
- **中央大块半透明面板抢画面** → 3D 世界中央是主视觉热区，常驻面板一律贴角/贴边/沉底，详情用情境面板，别让常驻层遮中央。
- **键位提示写死一套** → 别同时摆键盘+手柄提示或用纯文字"按某键"；跟随输入设备显示对应图标（见 §2）。来源：[微软无障碍标签](https://learn.microsoft.com/zh-cn/gaming/accessibility/accessibility-feature-tags)。
- **可点/不可点分不清** → 不可出牌卡不许只是变灰看不清；用费用转红+压暗+抖动反馈明确区分（见 §3）。

---

## 5. 对本项目的 10 条硬建议

面向本项目实际约束（three.js 体素世界 + \`src/ui/\` DOM 覆盖层、中文、dpr=1.5、1080p/4K、玩法读数=血量/魔力/占矿积分/8 分钟计时，见 [docs/GAMEPLAY.md](GAMEPLAY.md)）：

1. **中央让位**：\`#hud\` 常驻层只占**左上角一块 + 底部一条带**，正中央只保留准星/命中格反馈，任何常驻半透明面板不得进入中央 40% 区域（中央是体素世界主视觉与相机命中判定的对照区）。
2. **读数贴左上成块**：把血、魔力、占矿积分、双方比分、剩余时间**全部收进左上角一个对齐的小读数块**（keyvalue 行、不超过 5 行），按"重要度-边缘"原则放在近中央带内侧，其余静态量才推到角。
3. **手牌沉底部中央**：手牌用 StS 式**底部中央轻微重叠直立弧形**（不是大扇形），选中/hover 卡做"抬升+放大+亮边+提到最上层"四件套，层序走 \`src/ui/core.js\` 的图层顺序表统一管，禁止面板/卡自己写 z-index。
4. **费用不足不隐藏**：费用不够的卡用"费用数字转红 + 卡面压暗至对比仍≥4.5:1 + 点它时抖动并弹'魔力不足'人话说明"，中文进 \`src/hud.js\` 的 \`H.TEXT\`，绝不清一色灰或隐藏。
5. **hover tooltip 走情境层**：悬停卡/装备**延迟约 0.7s 出详情**（全名/费用/数值/效果正文/关键词），正文过长时落在**右侧固定面板**而非压在卡上遮世界；瞬时飘字（伤害、+素材、+积分）走自动淡出的瞬时层，与常驻/情境层分开管显隐。
6. **中文 HUD 字号下限 + dpr 验证**：HUD 正文中文 **≥18px（CSS px）**、需扫一眼的数字（血/费/计时）**≥24px**，并在 **dpr=1.5 的 4K** 与 1080p 各截一图核对，别只用 dpr=1 无头环境当验收口径（对齐 \`tools/audit.cjs\` 的 dpr1.5 回归那条）。
7. **像素风硬边 + 9-slice**：所有卡框/面板按钮用**统一一档 1~2px 硬描边 + 直角 + 9-slice 边框纹理**，全局禁用大圆角、柔和模糊阴影、抗锯齿曲线；像素贴图用 \`image-rendering: pixelated\` 并按整数倍缩放，避免 4K 下发糊。
8. **对比达标可机检**：HUD 文本/非文本对底对比按 **≥4.5:1 / 3:1（WCAG 1.4.3/1.4.11）**取值，且元素与屏幕外沿留 **≈5% 安全边距**（title-safe 惯例）——这两条建议直接进 \`tools/ui_check.cjs\` 或新加一条样式门禁，因为"丑/看不清"必须像分层一样有机检，不能只写在文档里。
9. **键位提示跟随输入**：\`H.TEXT\` 里的键位提示必须**按当前输入设备只显一套符号**（键盘键帽字优先，本项目无手柄则不摆手柄图标），出牌/切卡/暂停等动作提示与 \`src/main.js\` 键位表同源，别在 UI 层硬写第二套。
10. **菜单焦点顺序 + 面板让位**：暂停/结算/背包菜单用**单一方向焦点顺序、默认聚焦"继续"、Esc 逐级返回**，焦点环对比≥3:1；任何面板打开时必须 \`exitPointerLock()\` 交还鼠标并收起"点击锁定"提示、滚轮/悬停全局输入让位（沿用 \`H.uiPanelOpen()\` 这条视图层状态口径），避免"打开列表=换卡/面板抢中央"。

> 待办（本检索阶段不下结论）：稀有度/元素的具体色板需结合本项目现有调色板（\`src/hero-sprites.js\`、图集）再定；"丑 HUD 可机检"落到哪条 tools 门禁、判据取多少，建议作为下一步单独设计，并遵守"新增规则同时想清楚谁来拦"的约定。
