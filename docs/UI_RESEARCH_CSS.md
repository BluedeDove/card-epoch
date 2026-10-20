# UI_RESEARCH_CSS.md · 像素风 DOM 覆盖层 CSS 工艺检索

> 范围：浏览器端像素风游戏 UI（three.js 画布**之上**的 DOM 覆盖层，中文）。
> 写法：每条先给"怎么做"，紧接一段可整块粘贴的 CSS；来源随条给出，末尾有来源清单与本项目令牌表。
> 与项目口径对齐：样式只写在 [index.html](../index.html) 的 `<style>` 的 `.ui-*` 段，**不写内联 style、不写 z-index**（层级由 `src/ui/core.js` 的 LAYER_TABLE 决定，`zIndex = 10 + index*5`）；结构在 `src/ui/panels.js`，中文只在 `src/hud.js` 的 `H.TEXT`。本文件只是检索结果，不改任何代码。
>
> **本文数字的出处与限制（先读这段再引用数字）**
> - WCAG 相关阈值来自 W3C 规范条文；**对比度数值是本文按 WCAG 相对亮度公式自己算的**（`(L1+0.05)/(L2+0.05)`，半透明底按 sRGB 通道线性插值合成近似），不是真人可读性实验。
> - 色盲部分**没有**做模型模拟（第一版实现有数学错误已作废，见 §3.3），只给可核对的亮度阶梯与"必须有第二通道"的规范依据。
> - 字体那条 §2.4 的 `file://` 结论是**本机 HeadlessChrome 145 / Linux 实测**（Playwright 起真实页面量的），用户台式机是 Chrome 155 / Windows 150% → dpr 1.5，**必须在那台机器上复测**。
> - 自动化环境是 SwiftShader 软件光栅，帧率不能当真机指标（项目 AGENTS 同一条口径）→ 性能类结论只给"怎么量"，不给"多少毫秒一定行"。

---

## 1. 像素描边：硬边从哪来

### 1.1 硬边的物理条件（为什么圆角和 blur 阴影显脏）

**怎么做**：像素风的一切"边"必须满足三条：① 颜色来自有限调色板（不做 alpha 混色）；② 厚度是 CSS px 整数且**不小于 2**（1px 在 dpr 非整数时会变成两条一半亮度）；③ 不出现抗锯齿过渡带 —— 即 `border-radius: 0`、`box-shadow` 的 blur 半径为 `0`。

为什么圆角 / blur 显脏（两条依据 + 一条推论，分开标注）：

- 抗锯齿本身：`border-radius` 与任何带 blur 的 `box-shadow` 都会生成中间灰阶像素，这是浏览器强制的 AA 结果，**CSS 层无法关掉**（W3C 在 1.4.11 的说明里甚至反过来提醒：抗锯齿会让细线比作者写的颜色更淡，评估时要按 UA 实际给出的颜色看 —— [Understanding SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)）。像素风的视觉契约是"一个色块 = 一个像素"，出现中间灰阶就等于把网格打散了。
- 非整数设备像素比：MDN 明确指出 `image-rendering: pixelated` 在 CSS 像素与设备像素不对齐（dpr 不是整数）时，某些像素会比其他像素大一点，边缘看起来不均匀，且"这不是能解决的问题，因为 CSS 像素映射不到设备像素时根本填不满"（[Crisp pixel art look](https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look)）。用户 4K 屏 150% → dpr=1.5，所以**1px 的边/阴影在这个项目里一定不均匀**，这是本项目特有的硬约束。
- 与 3D 场景混色（本文推论，非引用）：半透明阴影叠在体素场景上，等于把场景色拉进 UI 调色板 —— 同一块面板压在草地和压在岩浆上会显出两种"脏"。所以描边必须**不透明**。

```css
/* 基线：所有 .ui-* 先声明这三条，避免局部忘 */
.ui-panel, .ui-btn, .ui-slot, .ui-tab, .ui-list-item, .ui-meter {
  border-radius: 0;              /* 圆角一律 0（含 50%，见 §5 反面清单第 1 条） */
  image-rendering: pixelated;    /* 只给像素图层加，别给整棵 DOM 加（见 §2.1） */
}
/* 需要"圆角感"时用整数切角，不要用 border-radius */
.ui-panel.notch { clip-path: polygon(4px 0,calc(100% - 4px) 0,100% 4px,100% calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,0 calc(100% - 4px),0 4px); }
```

### 1.2 多层 `box-shadow` 做 1px/2px 硬边（不用 border、不用 border-image）

**怎么做**：`box-shadow` 的 blur 写 `0` 时就是"盒子的硬复制"（spec 与 MDN 的 `box-shadow` 语义：offset-x / offset-y / blur / spread，blur=0 即硬边，[MDN box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow)）。用它画边的好处是**不吃布局**（不像 `border` 会把内容往里推、也不影响 `width:54px` 这种整数格），而且能叠多层 —— 这正是像素面板要的"外框/内衬/高光"三层。

```css
/* 通用硬边工具：2 段（外框 + 内衬），可整块粘贴后改颜色 */
.ui-hb {
  border: 0;                                   /* 边全交给 box-shadow，不占内容盒 */
  box-shadow:
    0 0 0 2px var(--ui-ring-outer, #050309),   /* 外框：第 1 层，最暗（spread 撑出 2px） */
    inset 0 0 0 2px var(--ui-ring-inset, #0d0a17); /* 内衬：第 2 层，压在内容边缘内侧 */
}
/* 需要"四向十字"而非整圈时（像素风留角，看起来像圆角）：只写 NESW 四条 */
.ui-hb.cross {
  box-shadow:
    0 -2px 0 0 #050309,   /* N */
    0  2px 0 0 #050309,   /* S */
    -2px 0 0 0 #050309,   /* W */
     2px 0 0 0 #050309;   /* E —— 四角留空，是像素 UI 的"伪圆角" */
}
/* 投影也一律硬边：只用 offset，不给 blur */
.ui-hb.lift { box-shadow: 0 0 0 2px #050309, 4px 4px 0 0 rgba(0,0,0,1); } /* 最后一个参数必须是 1，见 §5 第 3 条 */
```

### 1.3 三层边：暗外框 + 亮高光（上/左）+ 暗内衬（下/右），像 Minecraft / NFS 面板

**怎么做**：把"面板"想成一个 2px 的斜角（bevel）：**光从左上来** → 上边和左边是高光，下边和右边是暗部；再在外侧贴一圈最暗的外框收边。三条硬规则：① 三层都用不透明色；② 每层厚度相同（2px）；③ 高光只比面板亮 1~2 个色阶，别用白色（白高光会把面板变成"贴纸"）。

```css
/* 三层边面板：外框(暗) / 高光(N,W 亮) / 内暗(S,E 暗) —— 可整块粘贴 */
.ui-bevel {
  position: relative;
  background: var(--ui-panel, #181228);
  box-shadow:
    /* 外框：一整圈最暗，收住面板与场景的交界 */
    0 0 0 2px var(--ui-frame, #050309),
    /* 上/左高光：从外侧往内压 2px（写成两条 2px 硬带） */
    inset 2px 2px 0 0 var(--ui-hi, #4a3d7a),
    /* 下/右内暗：形成"厚度"，与高光成对出现 */
    inset -2px -2px 0 0 var(--ui-lo, #0a0813);
}
/* 内衬（面板内再套一圈更暗的槽），用伪元素而不是 border，避免吃布局 */
.ui-bevel::before {
  content: ""; position: absolute; inset: 4px; pointer-events: none;
  box-shadow: inset 0 0 0 2px var(--ui-inset, #0e0a1a);
}
/* 2px 厚的"像素斜角"版本（大面板：背包/结算），层级更明确 */
.ui-bevel.lg {
  box-shadow:
    0 0 0 2px var(--ui-frame, #050309),
    0 0 0 4px var(--ui-hi, #4a3d7a),
    inset 2px 2px 0 0 var(--ui-hi2, #6c5bd6),
    inset -2px -2px 0 0 var(--ui-lo, #0a0813);
}
```

### 1.4 9-slice：什么时候才值得用

**怎么做**：9-slice（Scale 9）的意义是"用一张小图铺任意尺寸的面板，四角不变形"（概念与在引擎里的 UV 拆分做法见 [9 Sliced Image](https://utkaka.github.io/posts/9-sliced-image/)；游戏 DOM UI 的 9-slice 用 `border-image` 实现、并有专门的 9-slice 弹窗教程：[Coherent Labs — Advanced UI Shapes](https://guide.coherent-labs.com/layout-assets-and-styling/graphics--shapes/advanced-ui-shapes/)、[Nine slice modal](https://coherent-labs.com/blog/uitutorials/nine-slice-modal/)；切片单位与 `fill` 关键字见 [MDN border-image-slice](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Reference/Properties/border-image-slice)）。

但**纯像素描边不要用 `border-image`**：被拉伸的四条边带会被非整数倍缩放，等于亲手把像素网格拉糊，而 `image-rendering: pixelated` 对 `border-image` 的覆盖在不同 UA 上表现不一致。判据很简单 —— **边带如果是纯色/等距平铺，9-slice 安全；如果边带本身画了图案，就用 §1.2/§1.3 的多层 box-shadow**。9-slice 留给"贴图面板/木纹/皮革质感底板"这类真有美术资源的场合。

```css
/* 9-slice 面板（只在边带是纯色或有平铺纹理时用）：像素安全的写法 */
.ui-sliced {
  border-style: solid;              /* border-image 需要 border-width 提供切片盒 */
  border-width: 8px;                /* = 源图的不可伸缩角/边厚度，必须整数 */
  border-image: url(../assets/panel9.png) 8 / 8px;   /* slice 单位=源图像素，slash 后=CSS 显示厚度 */
  border-image-repeat: round;       /* 平铺并缩放以整除：像素图配 round 常出现缩放 → 若源图边带是图案，改用 space 或 stretch+整数尺寸 */
  image-rendering: pixelated;       /* 覆盖 border-image 图源（UA 支持不一，务必自己目视验，见 §2.1） */
  background: #181228;
  /* 兜底：图片缺失时至少还有一条硬边框（file:// 下漏图很常见） */
  box-shadow: inset 0 0 0 2px #050309;
}
/* 无资源版的"平铺内衬"：用 background-repeat 代替 9-slice 的中心带 */
.ui-tile {
  background:
    url(../assets/edge.png) top / 100% 8px no-repeat,
    url(../assets/edge.png) bottom / 100% 8px no-repeat,
    #181228;
  image-rendering: pixelated;
}
```

---

## 2. 图像与字体

### 2.1 `image-rendering`：适用面与三个坑

**怎么做**：像素图（图标、卡面、公告牌、canvas）在放大时加 `image-rendering: pixelated`；`auto` 默认是双线性插值，直接把像素糊掉（原理与 canvas 做法见 [MDN Crisp pixel art look](https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look)，取值语义见 [MDN image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering)：`pixelated` = 先最近邻到整数倍、剩余部分平滑；`crisp-edges` = 全程最近邻，无平滑）。

三个坑（都是文档里明确写的，不是猜测）：

1. **属性会继承**：`image-rendering` 是可继承属性且作用于"元素自身 + 其他属性里设的图片 + 后代"（MDN 同页）→ 别写在 `html`/`body` 上，否则菜单里那张渐变按钮图、抗锯齿的中文都跟着遭殃。
2. **canvas 有两层映射**：图像→canvas、canvas→CSS 像素。第二层交给 CSS 缩放没问题，但**第一层如果用 `drawImage(img,...)` 传了非整数目标尺寸**（例：128 画进 100 = 0.78x），在第一层就糊了，CSS 救不回来。
3. **`transform: scale()` 缩放 canvas 时 pixelated 可能失效**：WebKit Bug 185683（仍为 NEW，依赖 Bug 27684）记录 canvas 用 CSS transform 放大（自身或父级）会丢失锐度（[Bug 185683](https://bugs.webkit.org/show_bug.cgi?id=185683)）→ 缩放画布请用 `width/height` 或 `--ui-scale` 参与布局尺寸，不要 `scale()` 一个 canvas。

```css
/* 只给像素图层开（图标 / 卡面 / 画布），且用整数倍尺寸 */
.ui-icon, .ui-slot-icon, .ui-detail-icon, .ui-list-icon, .ui-cursor-stack canvas { image-rendering: pixelated; }
/* three.js 画布：本项目的 #gl 是 3D 渲染，不是像素图 → 不要加 pixelated，否则抗锯齿全丢 */
/* 图标按 4 的倍数定尺寸，避免 34px 这种非整数倍（现有 .ui-slot-icon 就是 34px） */
.ui-slot-icon { width: 32px; height: 32px; }
.ui-hotbar .ui-slot-icon { width: 40px; height: 40px; }
/* canvas 版兜底：backing store 与 CSS 尺寸保持整数比 */
.ui-cardart { width: 96px; height: 96px; image-rendering: pixelated; } /* 配 backing 24/48 的整数倍 */
```

### 2.2 位图字体：拉丁/数字能用，正文不能用

**怎么做**：像素位图字体（[Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P/license)、[Silkscreen](https://fonts.google.com/specimen/Silkscreen)、m5x7 / Daniel Linssen）的共同点：**字形是为固定像素网格画的，字号必须是设计网格的整数倍**，否则等于把它重新采样 —— 和把像素图按 1.5x 放大是同一个错误。Press Start 2P 网格 8px → 只用 8/16/24px；Zpix 的 README 明确写"12px（11px + 1px 间距），请使用整数倍字号 12/24/36 以获得最清晰的效果"（[Zpix](https://github.com/SolidZORO/zpix-pixel-font)）。

另外三条实际限制：Press Start 2P 字宽极大 + x-height 高，**长句会撑破容器**、中文缺字（见 §2.3）；它只适合标签/数字/标题；`letter-spacing` 需要正值才有呼吸感（像素字挤在一起比无衬线更累）。

```css
/* 数字/拉丁专用：整数倍字号 + 等宽数字，绝不用于中文正文 */
.ui-num, .ui-cost, .ui-cd, .ui-pile-num {
  font-family: "Press Start 2P", "Silkscreen", ui-monospace, monospace;
  font-size: 8px;                 /* 网格 8px 的整数倍；要更大用 16px */
  line-height: 1;                 /* 像素字的行高不要用 1.4 之类的小数倍 */
  letter-spacing: 1px;
  font-variant-numeric: tabular-nums;   /* 见 §4.4：数字不再抖 */
  font-feature-settings: "tnum" 1, "lnum" 1;
}
/* 中文一律不走像素位图字体：见 §2.3 */
```

### 2.3 中文没有位图字体时的做法

**怎么做**：中文位图字体每个字都是手工点阵，字库量级是数千~数万字形 —— 现实里**只有两种可接受路线**：

- **路线 A（默认）：中文用系统中文字体 + 数字/拉丁用等宽像素字**，靠"像素边、硬阴影、整数网格"提供风格，而不是靠字面。中文栈按平台给全（PingFang / Microsoft YaHei / Noto Sans CJK），并且**关掉抗锯齿只在 macOS 生效**（`-webkit-font-smoothing: none` 是 UA 私有属性，Windows Chrome 不理它）→ 所以别把它当风格保证，只当锦上添花。
- **路线 B：本地化一款开源中文像素字**（OFL 可自由再分发）：[Ark Pixel Font](https://github.com/TakWolf/ark-pixel-font)（泛中日韩、黑体风格、有 10px/12px 与等宽/比例两种规格、16px 尺寸已废弃、仍在补字）或[缝合像素字体 Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)（Ark 官方给 10/12px 缺字时的过渡方案）。**注意授权差异**：Zpix 个人/教育免费，**单个商业产品 RMB 7000**，还禁止反向工程与转换 —— 商用前先问（[Zpix README](https://cdn.jsdelivr.net/gh/SolidZORO/zpix-pixel-font@master/README.md)）。

中文排版上的三条硬要求（都不依赖下载）：

```css
/* 1) 双栈：中文系统字 + 数字/拉丁等宽像素字（浏览器按缺字自动落到第二栈） */
:root { --font-cjk: "PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif;
        --font-num: ui-monospace,"Cascadia Mono","Courier New",monospace; }
.ui-panel, .ui-btn, .hud { font-family: var(--font-cjk); }
.ui-num, .ui-slot-num, .ui-pile-num, .ui-slot-cost { font-family: var(--font-num); font-variant-numeric: tabular-nums; }

/* 2) 中文要"呼吸"：字号整偶数 + letter-spacing 只给中文加正值，并抵消尾行 */
.ui-text { font-size: 16px; line-height: 24px; letter-spacing: 1px; text-indent: -1px; }
/* 中文正文最小 16px；10/11/12px 是"数字尺寸"，不要拿来排中文 */

/* 3) 1px 硬描边：四向（N/E/S/W），不用 8 向（8 向让中文笔画糊成一团），不用 filter */
.ui-on-scene { color: #e7e3ff; text-shadow:
    -1px -1px 0 #050309, 1px -1px 0 #050309,
    -1px  1px 0 #050309, 1px  1px 0 #050309,
     0 2px 0 #050309; }          /* 最后一行是"下坠"，给像素标题用；正文可去掉 */
/* 标题用 2px 硬描边：把上面 4 条换成 ±2px 即可，绝不写 blur 半径 */
```

补充两条实测/规范注意：`-webkit-text-stroke` 的描边压在字形边缘上、且是抗锯齿的（不是硬边），中文在 16px 下会被吃掉笔画 → 用上面的 4 向 `text-shadow`。`text-shadow` 的 blur 必须为 `0`（MDN：第三值 = blur radius）。

### 2.4 项目无构建、无外链：字体怎么办

**不下载的可行方案（推荐先走这条）**：

1. 只用系统栈（§2.3 的 `--font-cjk` + `--font-num`），风格由**描边、硬阴影、8px 网格**承担；
2. `@font-face` 一个也不写，避免"双击 file:// 时字体静默失败 → 视觉和验收时不一样"；
3. 想让中文有"点阵感"又不下载：把 HUD 的中文标签**改成 2px 描边 + 整偶数字号 + 去斜体**，实测能拿到八成的"像素气质"（本文判断，不是来源结论），代价是仍非真点阵。

要真点阵就必须本地化字体文件（这仍然**不是外链**：文件进 `vendor/fonts/`，和 three.js 一样本地引用）。落地检查有两条：

- **`file://` 能不能加载**：本机 HeadlessChrome 145 实测 —— 同目录 `@font-face` 在 `file://` 与 `http://` 下都成功（`document.fonts` 状态 `loaded`，canvas `measureText` 宽度 361 → 663 说明真的用上了）。但 Chromium 对 `file://` 字体的 CORS 处理历史上改过（见 [codereview 1281783002 "Do not do CORS request for local web fonts"](https://codereview.chromium.org/1281783002/)），Chrome 155 / Windows 上必须按下面的判据自己复测。
- **不要用 `document.fonts.check()` 当判据**：实测它对**根本不存在的字体名**也返回 `true`（`check('40px Nope-Missing','火')` → true，因为 UA 会按 fallback 链回答"能不能渲染"）。可靠判据是**量宽度差**：同一串字分别用 `font-family:<新字体>` 与 `font-family:"Nope-Missing"` 渲染，宽度相同就是没生效。

```css
/* 本地化像素字体的可粘贴 @font-face（文件在 vendor/fonts/，无外链；中文按子集用） */
@font-face {
  font-family: "Pixel CN";
  src: url("../vendor/fonts/ark-pixel-12px-proportional-zh_hans.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: block;  /* 像素字宁可等一下，也不要跳字（FOUT） */
  /* 没有构建就用 unicode-range 手挑：CJK 一整块 + 拉丁数字 */
  unicode-range: U+0020-007E, U+4E00-9FFF, U+3000-303F, U+FF00-FFEF;
}
/* 关键：像素字体必须显式给"字身→行盒"的对齐，否则 1px 硬阴影会偏 */
.ui-cn-pixel { font-family: "Pixel CN", var(--font-cjk); font-size: 12px; line-height: 16px; letter-spacing: 0; }
/* 兜底判据用的隐藏探针（回归脚本量它的 offsetWidth，与探针比宽度即可判定字体是否生效） */
.ui-font-probe { position: fixed; left: -9999px; top: 0; font-size: 40px; white-space: nowrap; }
```

`font-display: block` + `optional` 的取舍：`block` 避免"字体到了以后文字跳一下"（像素布局一跳，1px 描边会歪），代价是首屏有最长 3s 的空白期；本项目 HUD 是小文件（子集 woff2 通常几十 KB），用 `block`。

---

## 3. 调色板与对比

### 3.1 四层灰阶面板（背景 / 面板 / 边框 / 高光）

**怎么做**：像素 UI 的面板不是一个颜色，是**四个**：① 场景外的最深底（`ink`）；② 面板体（`panel`）；③ 收边外框（`frame`，最深，不用纯 `#000`）；④ 高光（`hi`，只比 panel 亮 1~2 阶）。**关键：边框必须"一亮一暗成对"**，因为暗底上的暗色外框自身只有 1.2:1，靠单条边在场景上根本认不出来；成对之后，"亮/暗交界"本身就是边界信号（WCAG 1.4.11 对"识别组件所需的信息"要求 3:1，[条文](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)）。

```css
:root {
  --ui-ink:   #0b0913;  /* 1 层：最外底 */
  --ui-panel: #181228;  /* 2 层：面板体 */
  --ui-frame: #050309;  /* 3 层：外框（比 ink 更深，但不用 #000，见 §5 第 1 条） */
  --ui-hi:    #4a3d7a;  /* 4 层：高光（panel 亮 2 阶，不是白） */
  --ui-inset: #0e0a1a;  /* 槽位内衬 */
  --ui-hi2:   #6c5bd6;  /* 大面板内侧强高光（选中态用） */
}
/* 实测（本文计算）：#e7e3ff 在 --ui-panel 上 = 14.56:1，在 --ui-inset 上 = 15.01:1 */
/* 实测：现有 --line:#3a2f5c 相对 panel 只有 1.51:1 —— 它不能单独当边界，必须配 --ui-frame 或高光 */
```

### 3.2 按元素属性配色（火/冰/岩/林/虚）与色盲安全

**怎么做**：项目已经有一份元素色表（`src/cards.js` 的 `G.ELEMENTS`：neutral/fire/ice/rock/nature/void，各带 `color`+`accent`），UI 复用同一份，别在 CSS 里再写一套 —— 卡面、HUD、描边三处颜色一分叉，玩家看到的"焰"就是两个颜色。

**实测（本文按 WCAG 公式算，非模拟）**：

| 元素 | 主色 | vs panel | 描边 accent | accent vs panel |
|---|---|---|---|---|
| neutral 中立 | `#c9d3e0` | 12.00:1 | `#8a94a6` | 5.94:1 |
| fire 焰 | `#ff7a45` | 7.03:1 | `#c8341a` | 3.43:1 |
| ice 霜 | `#7fd7ff` | 11.30:1 | `#2b7fb8` | 4.18:1 |
| rock 岩 | `#c9a06b` | 7.55:1 | `#7a5a34` | **2.89:1 ⚠** |
| nature 林 | `#7fd97f` | 10.50:1 | `#2f7d34` | 3.55:1 |
| void 虚 | `#c58cff` | 7.41:1 | `#6a3fb0` | **2.55:1 ⚠** |

两个结论：

1. **6 个主色两两之间的相对亮度比全部 ≤ 1.59:1**（火↔林 1.49、火↔虚 1.06、岩↔虚 1.02…），即"颜色"这件事完全靠色相。WCAG 1.4.1 明确：只有当两个颜色在**相对亮度**上差到 3:1 时，亮度差才算"色相之外的额外区分"，否则仍然算"仅靠颜色传达信息"（[条文与 Note](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)）。→ 元素语义**必须有第二通道**：字形/图标形状（本项目卡面已有 `art` 键）、文字标签、或点阵图案。
2. 白字压在元素色条上全部不合格：`#fff` on `#7fd7ff`=1.61、on `#7fd97f`=1.73、on `#ff7a45`=2.59 —— 条内数字改用**深字** `#0a0813`（对应 12.36 / 11.48 / 7.68）。

```css
/* 元素色进 CSS：一份真源，语义 = 卡面同色；描边自动压暗一档 */
.ui-slot[data-el="fire"]   { --el: #ff7a45; --el-lo: #c8341a; }
.ui-slot[data-el="ice"]    { --el: #7fd7ff; --el-lo: #2b7fb8; }
.ui-slot[data-el="rock"]   { --el: #c9a06b; --el-lo: #96733f; } /* 原 #7a5a34 只有 2.89:1 → 新值 vs panel 4.17:1 */
.ui-slot[data-el="nature"] { --el: #7fd97f; --el-lo: #2f7d34; }
.ui-slot[data-el="void"]   { --el: #c58cff; --el-lo: #8a5ad6; } /* 原 #6a3fb0 只有 2.55:1 → 新值 vs panel 3.90:1 */
.ui-slot[data-el] { box-shadow: 0 0 0 2px var(--ui-frame,#050309), inset 0 0 0 2px var(--el-lo); }
/* 第二通道：左上角 2px 元素标记（形状与颜色同时存在，色盲下仍可读） */
.ui-slot[data-el]::after {
  content: attr(data-el-mark);              /* 由面板填 "焰/霜/岩/林/虚"（文案仍来自 H.TEXT） */
  position: absolute; left: 0; top: 0; min-width: 12px; padding: 0 2px;
  font-size: 10px; line-height: 12px; text-align: center;
  color: var(--ui-inset, #0e0a1a); background: var(--el); /* 元素色底 + 深字，实测 ≥7.6:1 */
}
```

### 3.3 WCAG 阈值在深色 HUD 上的"实测"口径

**怎么做**：把三条阈值当成机检门禁，而不是设计师的记忆负担：

- 正文文字 ≥ **4.5:1**；大号文字（≥24px 普通 / ≥18.5px 粗体，规范按 18pt/14pt 换算）≥ **3:1**（[1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)）。
- 组件与其状态所需的可视信息 ≥ **3:1**，且 3:1 是**阈值不四舍五入**（2.999 不算过）（[1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)）。
- 自定义 hover/focus 指示：**厚度 ≥ 2 CSS px**、对背景 ≥3:1、且**同一像素在聚焦/未聚焦两态之间也 ≥3:1**（[wpaccessibility 汇总 + WCAG 2.4.13](https://wpaccessibility.org/docs/topics/design/focus-hover/)）。

**本项目的实测体检**（半透明底按 sRGB 线性插值叠在 5 种代表场景色上：暗地形 `#0b0f14`、草皮 `#86c232`、天空 `#bfe3ff`、岩浆 `#ff7a2f`、石板 `#6c7386`；这是近似，真人复测仍是唯一裁判）：

| 现有规则 | 场景最坏值 | 判定 |
|---|---|---|
| `.ui-keybar`（rgba(13,11,22,.5) + `#7f7a99`，[index.html:109](../index.html#L109)） | **1.13:1**（压在天空上） | 基本读不到，必须提不透明度或加硬底 |
| `.ui-help`（rgba(24,18,40,.6) + `#8d86ab`，[:106](../index.html#L106)） | **1.69:1** | 同上 |
| `.ui-topbar` 的 dim 文字（rgba(24,18,40,.82) + `#9d95c4`，[:57](../index.html#L57)） | **4.12:1** | 差一点到 4.5（它是 13px 正文级） |
| `.ui-aiminfo`（rgba(13,11,22,.55) + `#e7e3ff`，[:95](../index.html#L95)） | **4.29:1** | 同上，α 提到 .82 即可 |
| `.ui-topbar`/`.ui-log` 主文字（.82 底 + `#e7e3ff`） | 9.21:1 | 达标 |
| 血条内白字（`#fff` on 渐变 `#ff8fa2`→`#ff3d63`，[:76-80](../index.html#L76-L80)） | **2.16:1** | 改深字（见 §3.2） |
| `.ui-btn:disabled{opacity:.45}`（[:43](../index.html#L43)） | 3.75:1 | opacity 连边框一起淡 → 用"换色"而不是"降透明" |
| `.ui-meter{border:2px solid #000}`（[:74](../index.html#L74)） | 边框相对 panel 1.16:1 | 见 §5 第 1 条 |

```css
/* 深色 HUD 的三条通用兜底（可粘贴） */
/* A. 压在 3D 场景上的文字：不透明底条，比高 α 更安全 */
.ui-on-scene { background: #0b0913; border: 0; box-shadow: 0 0 0 2px #050309, inset 0 0 0 2px #4a3d7a; }
/* B. 禁用态：换色不换 alpha（WCAG 1.4.3 对非活动组件豁免，但元素仍在读信息时不行） */
.ui-btn:disabled { color: #6b6482; background: #120e20; border: 0; box-shadow: 0 0 0 2px #050309; cursor: not-allowed; }
/* C. 焦点/悬停指示：2px 起，且与未聚焦态本身也差 ≥3:1 */
.ui-btn:focus-visible { outline: 0; box-shadow: 0 0 0 2px #050309, 0 0 0 4px #ffd86b; }
```

### 3.4 半透明面板 + `backdrop-filter`：可读性与性能的权衡

**怎么做**：`backdrop-filter: blur()` 是"把元素背后那片像素重新滤波"，代价是**为它开一层合成层、并且每帧重算**（它的取值语义与 `backdrop root` 规则见 [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter) —— 注意 `filter`/`opacity<1`/`mask`/`will-change` 等都会形成 backdrop root，套在 HUD 容器上会让 `backdrop-filter` 抓不到游戏画面，只能抓自己那层 → 这是"blur 加了没反应"的常见原因）。

在"three.js 每帧都在变 + 软件光栅 + 低端机"这三个条件下，结论很清楚：

- **能用不透明底解决的，不要用 blur。** 本项目 HUD 叠在一个 3D canvas 上：每帧背景都在动，blur 就每帧重算一遍卷积 —— 这比静态网页的场景更贵。§3.3 的实测已经说明"α=.82 的不透明底 + 硬描边"就够读，而"α=.5 + 无描边"读不到。
- 真要玻璃感就**限定面积**（只给大面板，不给常驻 HUD），并用 `@supports` + 一个手动降级开关，且把降级判定交给已有的分档机制（项目有 `F3` 渲染分辨率档、`localStorage.gw.post`）而不是猜设备。

```css
/* 默认：像素风的"实底 + 三层边"（零 blur、零 filter） */
.ui-glass-lite { background: #181228; box-shadow: 0 0 0 2px #050309, inset 2px 2px 0 0 #4a3d7a, inset -2px -2px 0 0 #0a0813; }
/* 可选：大面积面板才允许 blur，且 UA 不支持/用户要轻量时自动回实底 */
.ui-glass { background: rgba(24,18,40,.86); }                 /* 兜底：先给够不透明度，保证无 blur 也能读 */
@supports ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .ui-glass:not(.lite) { background: rgba(24,18,40,.72); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
}
/* 2px 而不是 8~12px：blur 半径越小越省，且像素风本来不该有柔边 */
/* 别把 blur 加在会被每帧重绘的东西上（toast / 拖拽跟随 / 血条） */
.ui-toast, .ui-cursor-stack, .ui-meter > i { backdrop-filter: none !important; }
/* HUD 面板限制重排/重绘范围（不含 blur 的容器才可用 paint）：[MDN contain](https://developer.mozilla.org/en-US/docs/Web/CSS/contain) */
.ui-panel, .ui-log, .ui-topbar { contain: layout paint; }
```

---

## 4. 布局与动效

### 4.1 8px 网格与间距刻度

**怎么做**：像素 UI 的所有尺寸 = 基础单位的整数倍，基础单位取 4px（半格）与 8px（一格）。**现有样式里 `11px / 13px / 14px / 34px / 54px / 62px / 7px / 10px` 这些都落在网格外**（见 [index.html](../index.html) 的 `.ui-btn`、`.ui-slot`、`.ui-slot-icon` 等），后果是"面板之间的空隙看起来都不齐"—— 因为 1px 的偏差在硬边设计上毫无遮盖手段。

```css
:root {
  --u: 4px;             /* 半格 */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s6: 24px; --s8: 32px; --s12: 48px;
  --bw: 2px;            /* 描边厚度：只用 2/4 */
  --cell: 56px;         /* 物品格外尺寸 = 48 内容 + 2*4 边（按 8 的倍数取） */
}
.ui-row, .ui-btns, .ui-chips, .ui-filters { gap: var(--s2); }
.ui-panel, .ui-rail, .ui-detail { padding: var(--s3); }
.ui-slot { width: var(--cell); height: var(--cell); }
.ui-handrow { gap: var(--s2); }
/* 手牌 74×56 这种非倍数尺寸一律归到 8 的倍数；图标只用 16/24/32/40/48 */
```

### 4.2 flex 排手牌 / grid 排背包

**怎么做**：手牌是一维序列 → flex（要 `justify-content: center` + `flex: 0 0 auto` 防挤压，卡片宽度是固定像素才对齐得上网格）；背包是二维 + 需要自适应列数 → grid 的 `repeat(auto-fill, minmax(56px, 1fr))`，但 `gap` 必须是 8 的倍数、`minmax` 下界必须是 8 的倍数，否则最后一列会"多出 3px"。

```css
/* 手牌：等距、居中、超出可缩不回（保持 8px 网格） */
.ui-hand { display: flex; justify-content: center; align-items: flex-end; gap: var(--s2); flex-wrap: nowrap; }
.ui-hand > .ui-slot { flex: 0 0 auto; width: 56px; height: 72px; }
/* 背包网格：列数自适应，格子永远落在 8 的倍数上 */
.ui-bag-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: var(--s2); align-content: start; }
/* 网格容器不要给 padding 加奇数（现有 .ui-grid 是 padding:8px 8px 12px 4px → 左边 4px 会把整列推离网格） */
/* 三栏面板：固定侧栏用 px（8 的倍数），中间 1fr + min-width:0 防内容撑破 */
.ui-bag-box { display: flex; gap: 0; }
.ui-rail { width: 240px; flex: none; }
.ui-main { flex: 1 1 auto; min-width: 0; }
```

### 4.3 hover / press：`transform` 与时长区间

**怎么做**：像素 UI 的反馈靠**位移**（1~2px）和**边框层变化**（外框颜色/内衬明暗互换），不靠发光、不靠缩放。理由：`scale()` 会重新采样（文字与像素图都会糊，Chromium 对 `transform: scale` 下的 canvas 甚至可能丢掉 `pixelated`，[WebKit 185683](https://bugs.webkit.org/show_bug.cgi?id=185683)）；`opacity` 变化把边框一起淡化（§3.3 的 disabled 就是这么掉到 3.75:1 的）。

时长：任务给的 80–160ms 区间是行业习惯值，**没有针对像素 UI 的规范条文**；能引用到的量化锚点是 Material 的"移动端过渡约 300ms，入场 225ms / 退场 195ms，并保持过渡尽量短因为会被反复看到"（[Material: Duration & easing](https://m1.material.io/motion/duration-easing.html)）。游戏 HUD 的手感要求比表单更高：玩家把"按下去没反应"归因成游戏卡（本项目真机 160FPS，160ms 已经等于 26 帧），所以**按下必须 ≤80ms 或干脆 0ms，抬起 80–120ms，悬停 100–160ms**。

```css
:root { --t-press: 0ms; --t-hover: 120ms; --t-state: 140ms; --t-pop: 160ms; }
.ui-btn, .ui-slot, .ui-tab, .ui-list-item {
  transition: box-shadow var(--t-hover) steps(2, end), transform var(--t-press) steps(1, end), background-color var(--t-hover) linear;
}
/* steps() 是像素风的隐藏武器：过渡本身也走"跳格"，不会出现中间态的柔和滑移 */
.ui-btn:hover, .ui-slot:hover { transform: translate(-1px,-1px);
  box-shadow: 0 0 0 2px #050309, inset 2px 2px 0 0 #6c5bd6, inset -2px -2px 0 0 #0a0813; }
.ui-btn:active, .ui-slot:active { transform: translate(1px,1px); transition-duration: var(--t-press);
  box-shadow: 0 0 0 2px #050309, inset -2px -2px 0 0 #4a3d7a, inset 2px 2px 0 0 #0a0813; } /* 明暗互换 = 按下 */
/* 位移只用 ±1~2px 整数，绝不写 0.5px（dpr 1.5 下就是半像素糊边） */
```

### 4.4 数字滚动与血条补间

**怎么做**：三件事，各自的正解不一样 ——

1. **防抖**：会变宽的字（伤害数字、计数、倒计时）一律 `font-variant-numeric: tabular-nums` + `font-feature-settings:"tnum" 1`（等宽数字，见 [MDN font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)），并给容器 `min-width` 或 `ch` 单位。不做这条，"9→10→100"会把面板推来推去。
2. **血条补间**：主条快速跟随 + **一条延迟跟随的"残影条"**（玩家要看清"掉了多少"），过渡用 `linear` 或 `steps()`（像素风不要 `ease-in-out` 的软尾）。
3. **数字滚动**：优先用 JS 改文本（权威状态只在结算器），CSS 负责"不抖"。真要纯 CSS 滚动，用 `@property` 注册 `<integer>` 才能对自定义属性做动画（[MDN @property](https://developer.mozilla.org/en-US/docs/Web/CSS/@property)），配 `counter-reset` + `::after` 显示。

```css
/* 1) 所有动态数字 */
.ui-num, .ui-slot-num, .ui-pile-num, .ui-slot-cost, .ui-who {
  font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1;
  min-width: 3ch; text-align: right;
}
/* 2) 血条：主条 + 残影条（HTML 里 .ghost 在前、.fill 在后，同绝对定位） */
.ui-meter { position: relative; height: 16px; background: #0a0813;
  box-shadow: 0 0 0 2px #050309, inset 0 0 0 2px #0e0a1a; }
.ui-meter > i { position: absolute; left: 0; top: 0; bottom: 0; display: block; width: 100%; }
.ui-meter > .ghost { background: #6b1428; transition: width 320ms linear 140ms; }  /* 延迟 140ms 追 */
.ui-meter > .fill  { background: #ff5f7a; transition: width 90ms steps(8, end); }  /* 跳格更像像素，且立即 */
/* 条内文字：深字压亮条（实测 ≥7.7:1），不要白字（白字只有 2.2:1） */
.ui-meter > span { position: absolute; inset: 0; color: #0a0813; font-size: 12px; line-height: 16px; text-align: center; }
/* 3) 纯 CSS 数字滚动（可选，需 @property 支持；不支持就退回直接换文本） */
@supports (background: paint(id)) or (-webkit-app-region: drag) {
  @property --dmg { syntax: "<integer>"; initial-value: 0; inherits: false; }
  .ui-roll { counter-reset: dmg var(--dmg); transition: --dmg 260ms steps(12, end); }
  .ui-roll::after { content: counter(dmg); font-variant-numeric: tabular-nums; }
}
```

### 4.5 `prefers-reduced-motion` 与高对比兜底

**怎么做**：`reduce` 时去掉**位移与缩放**（MDN 明确点名 scaling / panning 大物体是前庭刺激源，[prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)），保留颜色/边框变化与"信息性"变化（残影条可以变成瞬间跳格）；不要用 `* { animation: none !important }` 一刀切 —— 那会把"掉血了"这件事本身也抹掉。

```css
@media (prefers-reduced-motion: reduce) {
  .ui-btn, .ui-slot, .ui-tab, .ui-list-item, .ui-toast, .fade { transition-duration: 1ms !important; }
  .ui-btn:hover, .ui-slot:hover, .ui-btn:active { transform: none !important; }  /* 位移全部取消，边框变化保留 */
  .ui-meter > .fill { transition: none !important; }        /* 立即到位 */
  .ui-meter > .ghost { transition-duration: 1ms !important; transition-delay: 0ms !important; }
  .ui-pulse, .ui-glow { animation: none !important; }       /* 循环闪动一律取消 */
}
/* 系统强制配色（高对比模式）下保住边界：[MDN forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors) */
@media (forced-colors: active) {
  .ui-panel, .ui-slot, .ui-btn { border: 2px solid CanvasText; box-shadow: none; forced-color-adjust: none; }
  .ui-btn:focus-visible { outline: 3px solid Highlight; }
}
```

---

## 5. 反面清单：让 UI 显廉价的具体写法

（括号里是本项目 [index.html](../index.html) 里现在正在犯的行的位置，改的时候一并处理）

1. **1px 边框用 `#000`（或任何纯黑）** —— 纯黑在深色底上只有 1.16:1，看不见；同时它和菜单遮罩的纯黑混成一片，边界消失；而 `1px` 在 dpr 1.5 上还会糊成两条半亮线。改：外框 `#050309` 起步 + **2px**，并配一条高光（§1.3）。（[`#74 .ui-meter{border:2px solid #000}`](../index.html#L74)、[`#131 .ui-slot-cost{border:2px solid #000}`](../index.html#L131)、[`#135 .ui-slot-cd{border-top:1px solid #000}`](../index.html#L135)）
2. **`box-shadow` 带 blur 半径** —— 硬边设计里出现柔化光晕，等于在最显眼处宣布"这是抗锯齿插值出来的"，并且每帧给合成器加活。（[`#125 .ui-slot.sel{box-shadow:…,0 0 14px rgba(255,216,107,.45)}`](../index.html#L125)、[`#91 .ui-cross.hit{filter:drop-shadow(0 0 4px …)}`](../index.html#L91)、[`#154/#217/#234 …0 18px 60px rgba(0,0,0,.7)`](../index.html#L154)、[`#207 drop-shadow(0 2px 3px …)`](../index.html#L207)）改：全部 blur→0，用 spread 与多层做"投影"。
3. **`rgba(0,0,0,.5)` 糊底当"高级感"** —— 半透明黑叠在 3D 场景上会把场景的中间色吸进 UI（§3.3 实测：α=.5 时最坏 1.13:1，文字等于不存在）。改：要么 α ≥ .8 的实底 + 硬描边，要么不透明底条 + `backdrop-filter` 只在大面积面板上（§3.4）。（[`#101 .ui-lockhint`](../index.html#L101)、[`#110 .ui-keybar`](../index.html#L110)、[`#107 .ui-help`](../index.html#L107)、[`#97 .ui-aiminfo`](../index.html#L97)）
4. **Material 味道的系统阴影 / 圆角 / 渐变球** —— `border-radius:50%` + `radial-gradient` 做费贝尔圆点，是"网页控件"的脸，不是像素 UI。（[`#129-131 .ui-slot-cost{border-radius:50%;background:radial-gradient(…)}`](../index.html#L129-L131)、[`#42 .ui-btn.pri{linear-gradient(180deg,…)}`](../index.html#L42)）改：方形 + 2px 硬边内衬；渐变只允许"上亮下暗"的两档硬分层（用两层 box-shadow，别用 linear-gradient 做柔边）。
5. **字号 13/15 混用（无刻度的字号）** —— 同一屏出现 9/10/11/12/13/14/16/20/30/40，行高与基线全不齐，硬边设计会把这个缺点放大。（[`#38 .ui-btn:13px`](../index.html#L38)、[`#44 .ui-input:14px`](../index.html#L44)、[`#46 .ui-textarea:11px`](../index.html#L46)、[`#134 .ui-slot-cd:9px`](../index.html#L134)）改：只用 12 / 16 / 20 / 24（§6 令牌表），中文正文 16。
6. **按钮 hover 只换颜色、没有边界变化** —— 色弱用户与高亮屏下"到底 hover 没 hover"看不出来；也违反 §3.3 的"同像素两态之间 ≥3:1"。改：hover 同时换外框颜色 + 1px 位移 + 内衬明暗互换。（[`#40 .ui-btn:hover{border-color:gold}`](../index.html#L40)、[`#124 .ui-slot:hover{border-color:gold}`](../index.html#L124)、[`#164 .ui-tab:hover`](../index.html#L164)）
7. **`opacity` 表示禁用** —— 把边框与文字一起淡化，掉到 3.75:1。（[`#43`](../index.html#L43)）改：换色 + 去高光。
8. **`filter: grayscale()/brightness()` 表示"不能出"** —— filter 会新建合成层（每帧成本），并且灰化后元素色与灰底对比继续下降；本项目 `automation` 环境还是软件光栅。（[`#126 .ui-slot.deny{filter:grayscale(.6) brightness(.72)}`](../index.html#L126)）改：换 `--ui-inset` 底色 + 加一条 2px 斜纹（`repeating-linear-gradient` 只允许 45°/整数硬条纹，不要模糊）。
9. **虚线边框（`dashed`）在小尺寸元素上做分隔** —— 1px 虚线的"实段"比像素还细，缩到 96vw 面板里就成灰雾。（[`#114 .ui-log-row{border-bottom:1px dashed}`](../index.html#L114)、[`#178/#180/#185 2px dashed`](../index.html#L178)）改：2px 实线 + 颜色差一档。
10. **给整棵 DOM 开 `image-rendering: pixelated` 或给 `#gl` 开** —— 前者把中文与渐变一起糊掉（它是可继承属性），后者让 3D 画面丢掉抗锯齿。（§2.1）
11. **`transition: all`** —— 会把 `transform`/`box-shadow`/`color` 之外想不到的属性一起补间，产生"抖一下"的廉价感。改：列出属性表（§4.3）。
12. **半像素与奇数尺寸**（34/54/62/7px、`translateX(-50%)` 配奇数宽高）—— dpr 1.5 下必然出现单边加粗。改：只用 4 的倍数（§4.1），居中改用 flex + 整数 padding。
13. **白字压在亮色元素条上**（§3.2 实测 1.29–2.59:1）。（[`#79-80 .ui-meter>span{color:#fff}`](../index.html#L79-L80)）
14. **未设 `font-display` 的 `@font-face`** —— 字体到位瞬间重排，1px 描边跟着错位。用 `block`（§2.4）。

---

## 6. 本项目样式令牌建议表

（值都是本文挑定的具体值；`实测` 列是本文按 WCAG 公式计算的结果。落地位置：`[index.html](../index.html)` 的 `<style>` 内 `:root` 与 `.ui-*` 段 —— 不改 `src/ui/*`，中文仍归 `H.TEXT`。）

**颜色**

| 令牌 | 值 | 用途 | 实测 |
|---|---|---|---|
| `--ui-ink` | `#0b0913` | 最外底 / 遮罩基色 | — |
| `--ui-panel` | `#181228` | 面板体 | 主文字 14.56:1 ✅ |
| `--ui-panel2` | `#241b3c` | 抬起态 / 选中底 | 主文字 12.0:1 ✅ |
| `--ui-inset` | `#0e0a1a` | 槽位内衬 / 输入底 | 主文字 15.01:1 ✅ |
| `--ui-frame` | `#050309` | 外框（非纯黑） | vs panel 1.3:1（靠成对高光成立） |
| `--ui-hi` | `#4a3d7a` | 高光内衬 N/W | vs panel 1.94:1（只做装饰性立体，不承载信息） |
| `--ui-hi2` | `#6c5bd6` | hover 强高光 / 选中边 | vs panel 3.55:1 ✅（达 1.4.11 的 3:1，可当状态边） |
| `--ui-txt` | `#e7e3ff` | 正文 | 14.56:1 ✅ |
| `--ui-dim` | `#b3aacd` | 次级（≥16px 用） | 8.26:1 ✅；在 rgba(panel,.82) 半透明底上最坏也有 5.22:1（现用 `#9d95c4` 同条件只有 4.12 ⚠） |
| `--ui-accent` | `#ffd86b` | 主强调 / 边框选中 | 13.22:1 ✅；作边框 vs panel 13:1 ✅ |
| `--ui-err` | `#ff9f9f` | 错误 / 警告行 | 9.27:1 ✅ |
| 元素色 | 复用 `G.ELEMENTS` | 卡面/HUD 同源 | 见 §3.2 表；`rock/void` 的 accent 提亮后为 4.17 / 3.90 ✅ |
| 条内文字 | `#0a0813` | 压在元素色条上 | 7.68–13.13:1 ✅（白字只有 1.29–2.59 ⚠） |

**边框**

| 令牌 | 值 | 说明 |
|---|---|---|
| `--bw` | `2px` | 唯一默认厚度（1px 只在 dpr≥2 的"内衬"上用） |
| `--bw-lg` | `4px` | 大面板（背包/结算/三选一）外框 |
| 三层边 | `0 0 0 2px frame, inset 2px 2px 0 hi, inset -2px -2px 0 inset` | §1.3 |
| blur | `0` | 任何 box-shadow 都不许有 blur |

**间距（8px 网格）**：`--s1 4px / --s2 8px / --s3 12px / --s4 16px / --s6 24px / --s8 32px / --s12 48px`；物品格 `--cell 56px`（手持栏 `72px`、手牌 `56×72`）；图标 16/24/32/40/48；网格 `gap: var(--s2)`。

**字号（整数倍；中文 ≥16，数字/拉丁可用 8 的倍数）**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--f-xs` | `12px / 16` | 数字、角标、计数（配 tabular-nums） |
| `--f-sm` | `16px / 24` | 中文正文与按钮标签（现 11/12/13/14 全部并到这里） |
| `--f-md` | `20px / 28` | 面板小标题 |
| `--f-lg` | `24px / 32` | 结算/菜单标题（现 30/40 并到这里，避免非整数倍） |
| `--f-pixel` | `8px / 16px`（Press Start 2P 网格 8） | 只用拉丁与数字 |
| `--ls-cn` | `1px`（数字 `0`） | 中文加呼吸，数字不拆 |

**层级（不许在 CSS 里手写 z-index）**：顺序真源是 `src/ui/core.js` 的 `LAYER_TABLE`（backdrop → hud → hotbar → notice → menu → result → panel → choice → tooltip → drag），`core.js:105` 用 `10 + index*5` 上屏。样式里只提供"该层的底"：`#fade/#hud/#inv/#menu/#result` 的 `position:fixed;inset:0` 与 `pointer-events`。半透明遮罩统一 `--ui-scrim: rgba(11,9,19,.86)`（低于 .8 会掉出可读区间，见 §3.3）。

**动效时长**

| 令牌 | 值 | 说明 |
|---|---|---|
| `--t-press` | `0ms` | 按下立即反馈（真机 160FPS 下 80ms 已≈13 帧） |
| `--t-hover` | `120ms` | 悬停边框/底色（任务区间 80–160 内） |
| `--t-state` | `140ms` | 选中/禁用切换 |
| `--t-fill` | `90ms steps(8,end)` | 血条主条跟随 |
| `--t-ghost` | `320ms linear + 140ms delay` | 掉血残影 |
| `--t-screen` | `250ms` | 菜单/背包出现（沿用现有 `.fade` 的 .25s；量级参照 Material 225ms 入场） |
| `--t-toast` | `160ms` | toast 淡入淡出（只动 opacity） |
| 缓动 | `steps()` / `linear` | 不用 `ease-in-out` 软尾；参考 [Material easing](https://m1.material.io/motion/duration-easing.html) |

---

## 7. 来源清单

规范与文档
- W3C WCAG 2.2 Understanding — [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)、[1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- [wpaccessibility — Styling focus and hover states](https://wpaccessibility.org/docs/topics/design/focus-hover/)（自定义 hover/focus ≥2px、同像素两态 ≥3:1）
- MDN — [Crisp pixel art look](https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look)、[image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering)、[box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow)、[backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)、[@media/prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)、[@media/forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors)、[font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)、[@property](https://developer.mozilla.org/en-US/docs/Web/CSS/@property)、[contain](https://developer.mozilla.org/en-US/docs/Web/CSS/contain)、[border-image-slice](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Reference/Properties/border-image-slice)
- Material Design — [Duration & easing](https://m1.material.io/motion/duration-easing.html)（移动端过渡 300ms / 入场 225ms / 退场 195ms、"过渡要短因为会被反复看到"）

游戏 DOM UI 与 9-slice
- Coherent Labs — [Advanced UI Shapes: 9-Slice, Clipping, Masking](https://guide.coherent-labs.com/layout-assets-and-styling/graphics--shapes/advanced-ui-shapes/)、[Nine slice modal](https://coherent-labs.com/blog/uitutorials/nine-slice-modal/)
- [9 Sliced Image（Scale 9 原理、贴图裁剪与 overdraw）](https://utkaka.github.io/posts/9-sliced-image/)
- [8bitcn-ui — 8-bit-pixel-art-patterns SKILL.md](https://github.com/TheOrcDev/8bitcn-ui/blob/main/.claude/skills/8-bit-pixel-art-patterns/SKILL.md)（`rounded-none` + 分块硬边描边的组件级做法）

字体
- [Ark Pixel Font（OFL-1.1，泛中日韩像素字，10/12px，等宽/比例）](https://github.com/TakWolf/ark-pixel-font)
- [Fusion Pixel Font（缝合像素字体，Ark 缺字时的过渡方案）](https://github.com/TakWolf/fusion-pixel-font)
- [Zpix README（12px 整数倍；商用收费；禁止转换/反编译）](https://cdn.jsdelivr.net/gh/SolidZORO/zpix-pixel-font@master/README.md)
- [Press Start 2P — Google Fonts license](https://fonts.google.com/specimen/Press+Start+2P/license)

已知缺陷 / 历史
- [WebKit Bug 185683 — `image-rendering: pixelated` fails on scaled canvases](https://bugs.webkit.org/show_bug.cgi?id=185683)
- [Chromium codereview 1281783002 — Do not do CORS request for local web fonts](https://codereview.chromium.org/1281783002/)

本文自测（可复现）
- 对比度：按 WCAG 相对亮度公式对 `index.html` 现有配色与半透明底逐条计算（脚本在会话内，5 种代表场景色：`#0b0f14/#86c232/#bfe3ff/#ff7a2f/#6c7386`）。
- `file://` 字体：Playwright 起真实页面，同目录 `@font-face` 在 `file://` 与 `http://` 下状态均为 `loaded`，canvas `measureText` 宽度 361 → 663；同页 `document.fonts.check('40px Nope-Missing','火')` 亦返回 `true`（⇒ 该 API 不能当"字体生效"判据）。环境：HeadlessChrome 145 / Linux。**Chrome 155 / Windows(dpr1.5) 未测。**

## 8. 还没解决 / 需要人看的

1. `--ui-hi2`、`--ui-dim` 的挑值是本文按对比度反推的，需要视觉确认（像素风的高光"亮到什么程度"没有客观阈值）。
2. dpr 1.5 的实测截图核对（1px/2px 边、`translate(-50%)` 居中、图标 34px 是否单边变亮）只能在用户台式机上做。
3. 真要用中文像素位图字体（路线 B）需要先定授权：Ark/Fusion（OFL）可直接本地化；Zpix 若项目将来商用需购买。
4. `backdrop-filter` 在本项目的实际代价只给了"怎么量"（同机位开关对比、软件光栅不算数），没给数字 —— 需要真机跑一次。
