# 光影落地方案 · 调研结论与实施顺序（2026-10-16）

> 状态：**第 0–4 档已落地**（后处理管线 + 曝光/选择性 bloom/冷暖分级/暗角 + 顶点色日照），第 5–7 档未做。
> 落地实况与实测数字在第 11 节；下面第 2–8 节保留调研原文，因为里面记的是"为什么会翻车"，实现时照着核对过。
> 分工：本文 = 网上调研 + 对 `vendor/three.min.js` 逐字核对的事实；冰材质修复已另做（见文末"已完成"）。
> 每条"实测"都可复现：API 名/默认值来自本仓库 `vendor/three.min.js` 反查，或来自文末 URL。
> 标注**未核实**的条目 = 通用经验值，落地时必须在真机现场调，不许当结论抄。

## 0. 约束（先确认方案没违反）

- 唯一入口 `index.html`，**file:// 双击**运行：不能用 ES modules、`fetch`、npm、构建步骤。
- three.js **r128**（`vendor/three.min.js`，全局 `THREE`）。不升版本——升版才能用的 API 一律视为不可用。
  - 实测本仓库这份构建**没有** `outputColorSpace`/`SRGBColorSpace`（那是 r152+ 的色彩管理），只有 `outputEncoding`/`sRGBEncoding`。
- 现状渲染：`WebGLRenderer({antialias:false})` + `outputEncoding=sRGBEncoding` + `shadowMap.enabled=false`、
  三灯（Hemi 0.85 / Sun 0.75 / Ambient 0.18）、`MeshLambertMaterial` + 顶点色烘焙角落 AO、
  16×16 分块体素几何、`THREE.Fog(0x9ec9ff,46,150)`、程序化 16×16 图集（`NearestFilter`，无 mipmap）、`renderScale` 有 1/0.75/0.55 三档（F3）。
- 验收只认 `node tools/audit.cjs`（三种子 × 15 项 + dpr1.5 回归）+ `--shots` 看图 + `tools/feel_probe.cjs`。
  自动化环境是 SwiftShader 软件光栅（~60FPS），**FPS 数字不能当真机指标**；真机 160FPS 才会暴露"绑在 tick 上"的问题。

## 1. 结论先行

1. **走"手写 composer"这条线，不要第一步就引入官方后处理 UMD。** 手写只需要 `renderer.setRenderTarget` + `WebGLRenderTarget` + 一个 `ShaderMaterial` 全屏 quad，全部 API 在本仓库构建里实测存在；官方 `EffectComposer` 要拉 ≥5 个 UMD 文件且**加载顺序错就崩**（下面第 3 节写清了为什么）。
2. **最大的坑是色彩空间，不是效果。** 本仓库现状是"直接渲到屏幕 + `outputEncoding=sRGBEncoding`"= 只编码一次，正确。一旦改成"先渲进 RenderTarget"，编码就不再自动了。三条硬规矩见第 2 节。
3. **阴影分两半做**：静态地形把太阳遮蔽**烘进顶点色**（Minecraft 的 skylight 做法，零每帧开销、无 shadowmap 锯齿）；玩家/随从等动态物再上 `shadowMap`（r128 支持，但默认参数对我们太粗，见第 4 节）。
4. **像素风的"光影感"来自 4 件小事**，性价比从高到低：曝光+色调映射 → 选择性 bloom（只让发光格/法阵发光）→ 冷暖分级/暗角 → 高度雾。SSAO 最后做，收益最低、坑最多（顶点 AO 已经在了）。
5. 每一档都要能**单独关掉**并且**回到现状画面像素一致**，否则 `cam_audit` 的构图判据和 `feel_probe` 的手感判据会互相污染，出了问题分不清是谁干的。

## 2. 色彩空间三条硬规矩（先做这个，再谈效果）

逐字核对自 `vendor/three.min.js`：

- 编码门：`const encoding = (currentRenderTarget === null) ? renderer.outputEncoding : currentRenderTarget.texture.encoding;`
  → **渲进 RenderTarget 时用的是那张 RT 的 `texture.encoding`（默认 `LinearEncoding`），不会自动转 sRGB。**
- 色调映射门：`toneMapping: material.toneMapped ? renderer.toneMapping : NoToneMapping`，而 `Material.toneMapped` 默认 **true**、`ShaderMaterial` 不覆盖它。

由此得出：

1. **链上所有后处理材质一律 `toneMapped:false`。** 否则 `renderer.toneMapping` 一开，每个中间 pass 都把色调映射再套一遍（画面越叠越灰）。
2. **编码只做一次，二选一：**
   - (A) 中间 RT 保持默认 `LinearEncoding`，**最后一个 pass 渲到 null（屏幕）**，让 `renderer.outputEncoding=sRGBEncoding` 收尾；或
   - (B) 链尾挂一个自己的 `LinearTosRGB` pass，此时**必须** `renderer.outputEncoding = LinearEncoding`。
   两者混用 = 编码两次 = 整屏发灰发白。这是这套东西最常见的翻车点。
3. **色调映射曲线：先试 `ReinhardToneMapping`。** 本作的天蓝 `#4d8fe0`+`0x9ec9ff` 雾是浅色调、不含 HDR 亮度，ACES 会把饱和色压灰、高光拉青（把 `atlas` 里 `#5aa832` 的草和 `#8a3fd8` 的晶压成"灰绿/灰紫"）。想追"电影感"再单独开 `ACESFilmicToneMapping` 对比着看。
   - 本仓库构建实测存在：`NoToneMapping`/`LinearToneMapping`/`ReinhardToneMapping`/`CineonToneMapping`/`ACESFilmicToneMapping`/`CustomToneMapping` + `toneMappingExposure`。
   - 注意：官方 UnrealBloomPass 文档明说"用此 pass 要在 renderer 开 tone mapping"——用 (B) 方案（renderer 关 tonemap）时若要 bloom，得自己保证阈值是在线性空间算的。

## 3. 两条后处理路线的实测对比

### 3a. 手写（推荐先做）

本仓库构建里逐个反查确认存在，可直接用：
`setRenderTarget`、`getRenderTarget`、`WebGLRenderTarget`、`WebGLMultisampleRenderTarget`、`DepthTexture`、`DepthFormat`、
`MeshDepthMaterial`、`RGBADepthPacking`、`PCFSoftShadowMap`、`VSMShadowMap`、`onBeforeCompile`、`HalfFloatType`、
`copyFramebufferToTexture`、`readRenderTargetPixels`、`PMREMGenerator`、`ShaderMaterial`、`UniformsLib`。

要点（r128 真值，别信当前 threejs.org 的默认值描述——那是 r15x/16x）：

- `renderer.setRenderTarget(rt, activeCubeFace=0, activeMipmapLevel=0)`，传 `null` = 渲屏幕。
- `new THREE.WebGLRenderTarget(w, h, { minFilter, magFilter, format, type, encoding, depthBuffer:true, stencilBuffer:false, depthTexture:null })`，
  成员 `.texture` / `.depthTexture` / `.setSize()` / `.clone()` / `.dispose()`。
- **尺寸必须自己乘 `renderer.getPixelRatio()`**（`getSize(vec2)` 给 CSS 尺寸，`getDrawingBufferSize(vec2)` 给缓冲区尺寸）。
  本项目的 dpr 不变量在这里最容易被破坏：`F3` 的 `renderScale`（1/0.75/0.55）改分辨率时，RT 必须跟着重建，否则后处理链按旧分辨率采样 → 画面糊/偏移。**改完必须跑 `audit.cjs` 的 dpr1.5 回归。**
- 全屏 quad 自建：`PlaneGeometry(2,2)` + `OrthographicCamera(-1,1,1,-1,0,1)`，或抄 `FullScreenQuad` 的那个大三角形（顶点 [-1,3],[-1,-1],[3,-1]，少一条对角线）。
- 手写版的***代价***：bloom 的"多级模糊"要自己写（5 级 mip + 加权合成）。第一档先只做"单层 9-tap 高斯 + 阈值"，够用且便宜；不满意再升级成 UnrealBloom 风格。
  `FullScreenQuad`/`GammaCorrectionShader` **不在**核心构建里（实测 `src.includes` 为 false），得自己写这两小段（各 ~20 行）。

### 3b. 官方 examples/js UMD（备用；bloom 想省事时下载进 `vendor/`）

实测 r128 的 `examples/js` 仍然存在（unpkg 全部 HTTP 200）：

- `postprocessing/EffectComposer.js` → 实测**自己就定义** `THREE.EffectComposer` / `THREE.Pass` / `THREE.FullScreenQuad`
- `postprocessing/{RenderPass,ShaderPass,UnrealBloomPass,MaskPass,Pass}.js`
- `shaders/{CopyShader,LuminosityHighPassShader,GammaCorrectionShader}.js`
- 构造签名：`new EffectComposer(renderer, renderTarget?)`；`new RenderPass(scene,camera,overrideMaterial,clearColor,clearAlpha)`；
  `new ShaderPass(shader, textureID='tDiffuse')`；`new UnrealBloomPass(Vector2, strength, radius, threshold)`。
- **加载顺序（实测引用关系，不是猜）**：各 `*Pass.js` 都 `extends THREE.Pass`（**定义期**就要有 Pass），而 `Pass` 与 `FullScreenQuad` 就在 `EffectComposer.js` 里；`EffectComposer` 构造期又用 `THREE.CopyShader` 与 `THREE.ShaderPass`。所以必须：

  ```
  three.min.js → CopyShader.js → LuminosityHighPassShader.js → EffectComposer.js（先出 Pass）
      → ShaderPass.js → RenderPass.js → UnrealBloomPass.js →（可选 MaskPass.js）
  ```

  顺序错 → 构造期 `console.error('THREE.EffectComposer relies on THREE.CopyShader')` 或直接崩。
- 取文件用 **unpkg**（`https://unpkg.com/three@0.128.0/examples/js/...`）；jsdelivr 同源文件实测被 web_fetch 的 content-type 拒绝，落地成文件本身没影响，但核对内容时 unpkg 更顺。
- `UnrealBloomPass` 的 RT 是 `RGBAFormat + LinearFilter`，**没有**用 `HalfFloatType` → 亮度信息被夹到 [0,1]，阈值以上的信息已经丢了。**想要好看的 bloom 就得烘一张亮度图**（用 `onBeforeCompile` 把发光材质按 `uniforms` 输出亮度）或用 `WebGLRenderTarget(..., {type: HalfFloatType})`（本仓库构建有 `HalfFloatType`；WebGL1 需 `OES_texture_half_float` + 滤波扩展，SwiftShader 支持情况**未核实**）。

## 4. 阴影：先烘顶点色，再上 shadowMap

- **静态地形** → 把太阳遮蔽烘进顶点色（已有角落 AO 的同一份 `col`，加个 `skyBlock` 项即可），Minecraft 管这叫 **skylight**：从天空沿轴 flood-fill，每深入一格亮度减 1，0–15 档，取 `max(skyLight, blockLight)`（<https://minecraft.wiki/w/Light>）。
  好处：零每帧开销、没有 shadowmap 锯齿、和现在的 `cornerAO` 是同一套脏块重建路径。
  重建代价：只有改动格所属 chunk +（贴边界时）相邻 chunk 要重烘；本仓库单卡地形上限 `MAX_TERRAIN_CELLS=9`，所以每张地形卡最多触发 1~4 个 chunk——**这条是基于项目现状的推断，不是外部实测**。
  坑：**别把 `opaque:false` 的冰/水算成挡光**（`cornerAO` 里就是 `DEFS[id].opaque`，保持这个口径，否则整个冰湖下面全变黑）。
- **动态物（玩家/随从/抛射物）** → `renderer.shadowMap.enabled=true` + `shadowMap.type=THREE.PCFSoftShadowMap`（本仓库构建有 `PCFSoftShadowMap=2`/`VSMShadowMap=3`/`BasicShadowMap=0`/`PCFShadowMap=1`）。
  r128 实测默认值（都太"糙"，要改）：`shadow.mapSize=(512,512)`、`shadow.bias=0`、`shadow.normalBias=0`、`DirectionalLightShadow` 的正交相机 = `OrthographicCamera(-5,5,5,-5,0.5,500)`、`shadowMap.autoUpdate=true`。
  落地参数起点（SwiftShader 与真机都要看）：`mapSize=1024`（**别 2048**，软件光栅上很吃力）、正交范围按"跟着玩家的 ±14 格"、`near=1 / far=48`、
  `bias` 从 `-0.0005` 起、`normalBias` 从 `0.15` 起（体素是大轴对齐平面，浅角度痤疮主要靠 normalBias）。**这几个数都是通用量级，必须现场调，未核实。**
- **静态世界别每帧重渲深度**：`renderer.shadowMap.autoUpdate=false`，在世界脏块或实体移动后 `light.shadow.needsUpdate=true`。
  但注意玩家一直在动 → 实际上只有"纯站桩"能省。真正的省法是**只让实体投影**（地形 `castShadow=false`、只 `receiveShadow=true`）。
- **透明方块投实心影**：shadow 用 `MeshDepthMaterial`，不看 alpha → 水/冰必须 `castShadow=false`，否则冰墙投出一整块实心黑影。要"半透投影"就给它 `customDepthMaterial`。
  顺带：本项目角色已经有一张 `shadowTex` 圆斑假影（`main.js` 里 `MeshBasicMaterial({map:shadowTex,opacity:0.6})`），上真阴影时记得把它关掉或降强度，否则双重影。

## 5. 深度类效果（SSAO/景深/边缘光）的前置条件

- `new THREE.DepthTexture(w,h,type,mapping,wrapS,wrapT,magFilter,minFilter,anisotropy,format)`：**`format` 不是 `DepthFormat`/`DepthStencilFormat` 会在构造函数直接 throw**（实测构建里有这句 `throw new Error("DepthTexture format must be either ...")`）。默认 type：`DepthFormat→UnsignedShortType`、`DepthStencilFormat→UnsignedInt248Type`。
- MDN 原文：**`WEBGL_depth_texture` 只存在于 WebGL1**，WebGL2 默认可用；**float 深度（DEPTH_COMPONENT32F）只在 WebGL2**。→ 16 位深度两边都能取；**SwiftShader 对该扩展/float 深度的支持未实测，别拿它跑通/跑不通下结论。**
- **推荐绕开：** `new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking})` 渲一张 RGBA 编码深度图当普通纹理用（`RGBADepthPacking`/`BasicDepthPacking` 实测在构建里）。跨 WebGL 版本行为一致，SwiftShader 下更可预期。
- 本项目已经有**解析式几何**（体素 `Uint8Array` + DDA 射线）：SSAO 的"谁挡着这片地面"完全可以在 CPU 上按射线/flood-fill 烘进顶点色，**比屏幕空间 SSAO 便宜且没有噪声**。→ SSAO 列为最后一档，很可能不需要。

## 6. 像素风配方（经验值，全部标注"未核实，现场调"）

| 项 | 起点 | 备注 |
|---|---|---|
| bloom threshold | 0.70~0.90 | 像素风宁弱勿糊；只让 `d.glow`（以太晶）、岩浆、法阵光柱发光，别整屏糊 |
| bloom strength / radius | 0.4 / 0.2~0.4 | 官方示例值 1.5/0.4/0.85 是给 PBR 场景的，我们偏亮要更低 |
| tonemap | Reinhard + `toneMappingExposure` 1.0 起 | 见第 2 节；ACES 会破坏 `cards.js` 那套元素配色 |
| 冷暖分级 | 阴影偏青蓝 `×(0.86,0.94,1.10)`、高光偏暖 `×(1.06,1.00,0.92)` | 与现有 `HemisphereLight(0xcfe6ff,0x4a4360)` 同向，别做出第三套色调 |
| 暗角 | `smoothstep(0.72,1.35,dist(uv,0.5))`，强度 ≤0.25 | 越肩视角中心是准星，暗角太重会加重"头晕"投诉 |
| 高度雾 | 在现有 `Fog(46,150)` 之外按世界 y 加 `smoothstep` 高度带 | **与 `THREE.Fog` 二选一**，两套雾叠一起远处会发灰 |
| Fresnel 边缘光 | `pow(1-dot(N,V), 2~5)` | 主要给冰/水/卡牌描边用（见线 B） |

## 7. 实施顺序（每档一个可验证增量）

> 每档做完都要跑：`node tools/audit.cjs`（三种子全绿）→ `node tools/audit.cjs --file 490706` → `node tools/audit.cjs --shots /tmp/gwshots` 自己看图 → `node tools/feel_probe.cjs`。
> 每档单独 commit，并且都要能用一个开关退回上一档（画面类改动必须可关）。
> 光影代码请新建 `js/shader.js`（渲染层），**不要塞进 `main.js`**——`main.js` 是装配层；`GW.SHADER` 暴露开关与 `install(renderer,scene,cams)`。

0. **基准与开关**：`__GW_SH({on:false, ...})` 调试入口 + 把 FPS/分辨率显示接进顶栏；先量出"关掉光影"的基准帧时间与构图，之后每一档都跟它对比。**这档不动画面。**
1. **手写最小 composer + 曝光/色调映射**（单 pass，线性 RT → 末 pass 渲屏幕）：验收 = `--shots` 与基准逐张对比，天空/雪地不过曝、`#eef4fb` 积雪不糊白；dpr1.5 回归 pass。
2. **选择性 bloom**：只发光源（`d.glow`、岩浆、法阵、抛射物轨迹）。验收 = 白天看雪地不比基准糊，夜间发光物有光晕；`feel_probe` 的 jerk 不恶化（bloom 是渲染层，本不该影响手感，恶化说明你把耗时压进了 tick）。
3. **色彩分级 + 暗角**（一个 pass 里做完）。验收 = 截图与 `cards.js` 的元素色卡对比不偏色；准星区（`GW.CAM_CROSS`）不被暗角压暗。
4. **太阳遮蔽烘顶点色**（静态地形）+ 冰/水不挡光口径。验收 = `--shots` 的 `treehug_*` 两张里树荫可见，且 `cam_audit` 的 C 项（身体挡准星判定）**不因亮度变化而改变隐藏集合**——这条专门用来抓"你顺手改了顶点色判据"。
5. **shadowMap 只管动态物**：`mapSize=1024`、相机跟玩家、`autoUpdate=false`+`needsUpdate`。验收 = 站桩时帧时间不涨、走动时影子不拉丝不闪；关掉 `shadowTex` 假影。
6. **高度雾**（与 `THREE.Fog` 二选一）：验收 = 远处轮廓与 `cullFarChunks` 的雾距（`fog.far*1.08`）仍然吻合，别出现"chunk 在雾还没浓时就消失"的硬边。
7. **（可选）SSAO**：先证伪——第 4 档的顶点色遮蔽如果已经够看，就不做屏幕空间 SSAO。

## 8. 明确不要做

- 不升 three 版本、不用 `outputColorSpace`（r128 没有）。
- 不在 `index.html` 加 `<script type="module">` 或 CDN 外链（file:// 下直接废）。
- 第一步不引 `npm/postprocessing` 库（非全局脚本形态，要打包）。
- 不做屏幕空间反射/体积光/级联阴影：这游戏是 46~150 格雾距的越肩卡牌对战，这些效果的收益远低于它们在软件光栅与核显上的代价。
- 不要"顺手"改 `cam_audit.js` 的判据来让画面改动过关（口径冻结，改动要给用户过目）。
- 不要把 `antialias:false` 打开当作"上光影"的一部分——真机 160FPS 的代价先量再说，FXAA 属于可选项而不是默认。

## 9. 已完成（本次另一件事）：冰材质修复

- 根因：`main.js` 的 `buildChunkGeometry` 非液体分支里有 `if (!d.opaque) continue;`，而冰是 `solid:true, opaque:false`
  → **冰的所有面被剔除，一个三角都不生成**，于是冰墙/冰锥/冰面成了"能挡人、看不见"的实体（实测被顶出时日志写"被地形卡住"）。
  `结冰`/`冰墙`/`冰川阵` 三张卡造出来的冰同样隐形。贴图、alpha、雾全是次要的——面根本没生成，调什么都没反应。
- 改法：几何分三个 pass（`solid` / `liquid` / 新增 `glass` = solid 但 opaque:false），冰走 `glass` + 独立 `matGlass`；
  `renderOrder` 水 1 / 冰 2，保证俯视冰湖是"冰压着水"。顶点色给一条接近白、偏冷的分支压住"埋进雾里"。
- 最终参数（数值依据见附录 B）：`opacity:0.78`（原版 ice.png 实测 alpha≈0.745，本项目冰同时是能踩能滑的地板所以略高）、
  `depthWrite:true` + `FrontSide`（three 不排同一 mesh 内的三角，成排体素用 `depthWrite:false` 会远近颠倒；
  水那套 `false + DoubleSide` 只适合单层连续水面，**别照搬给冰**）。
- 底色：`#a9dcf2` → `#74add6`。雾 `0x9ec9ff` 亮度约 203，旧底色亮度约 191，只差 12 级——在白天空加浅蓝雾里就是"什么都看不到"。
  顶面画反光带、侧面画裂纹（两张图）：只有一张图时 45° 条纹会跨方块连成整湖斑马线（平视/俯拍实测都很明显）。
- 顺手修的两个真问题：霜噬雪原以前把冰生成在柱顶、水盖在上面（玩家看到"明面上是水，踩到的却是隐形冰"）→ 改成冻到水面那一层；
  `spawnPoint` 不再把出生点放在冰面（`DEFS[top].slip`），否则出生即打滑会被读成操作失灵。
- 门禁：新增 **`node tools/ice_probe.cjs [seed] [--shots 目录]`**。它按 `DEFS` 与邻居规则**独立重算**受影响 chunk 应生成的三角形
  （三个 pass 各自数），与渲染器实际数出来的比对，并要求冰贡献的三角数 > 0；三种子（490706/88092/31337）全 pass，强制失败路径退出码 1。
  第一版我用"放冰前后的三角增量 vs 增量期望"判，量到 82 对不上独立算出的 86——查下来是**探针自己口径错**
  （贴地那排把草皮清成空气，基线也跟着少了面），不是渲染问题；改成整 chunk 重算才对上。这种坑值得记下来。
- 视觉实测：`node tools/audit.cjs` 三种子 × 15 项全绿 + dpr1.5 回归 pass；`--file 490706` pass；`layer_check` 全过；
  `feel_probe` 无 error、emergencySnaps 0；SwiftShader 下 FPS 与改前同级（57~60）。
  截图对照在 `/tmp/ice_before/*`（隐形）与 `/tmp/ice_after2/*`（可见），卡造冰墙透光见 `/tmp/ice_wall/ice_wall_card.png`。

## 附录 B · 半透明体素材质（线 B 调研，已用于上面的修复）

- **原版 Minecraft 的冰是 alpha 混合**，走 translucent 组（与水、染色玻璃同组），不是"不透明 + 高光"。
  逐像素量过原始纹理：`ice.png` 1.20.4 全图统一 alpha = 190/255 ≈ **0.745**；1.13.2 是 159/255 ≈ 0.624（那时光纹是纯白、对比更强）；
  `water_still` ≈ 0.706；`packed_ice`/`blue_ice` = 255（完全不透明）→ "厚冰感"来自**不透明变体**，不是把 alpha 调得更低。
  原版冰的裂纹 + 高光像素只占约 **3%**（8/256），且没有圆形气泡 → 本项目画了 6~9 个气泡，是**有意偏离**（16px 半透明块需要额外图案对比才好认），
  下一个人别把它当原版依据。来源：`InventivetalentDev/minecraft-assets` 镜像里的原始 PNG + minecraft.wiki 的 Ice / Translucency 页。
- **"看得出是冰"的可行手段**（本项目用的是前三条）：底色亮度与雾/天空拉开 ≥30 级；顶面反光带 + 侧面裂纹分两张图；
  上边亮框 / 下边暗边给出色块边界。可继续加的：Fresnel 边缘光（抄 `examples/js/objects/Water.js` 的
  `rf0=0.3; reflectance=rf0+(1-rf0)*pow(1-dot(E,N),5)`，像素风建议 rf0 取 0.10~0.30）、内缩 0.06~0.8 格的**独立内壳**（学 MC 的 noOcclusion，越厚越实）。
- **r128 的两个免费午餐**（本仓库构建里实测存在）：
  1) `vertexColors:true` 且 color 属性 **itemSize=4** → 走 `USE_COLOR_ALPHA`（门在 `WebGLPrograms`：
     `vertexColors===true && geometry.attributes.color && 4===color.itemSize`），纯 `MeshLambertMaterial` 就能做"贴地更实、顶面更透"的逐面 alpha，零 shader 成本；
  2) `UniformsLib.fog` + `#include <fog_pars_vertex> <fog_vertex> <fog_pars_fragment> <fog_fragment>` 四件套接雾。
     注意 **`ShaderMaterial.fog` 默认 false**（本仓库构建里 `Material.fog=!0` 而 ShaderMaterial 覆盖成 `!1`），自定义材质必须显式 `fog:true`，否则冰不受雾、远处像"贴在天空上"。
     `vertexColors` 在 r128 只接受布尔（`THREE.VertexColors` 已成 undefined，写了静默失效）；`map` 纹理要 `encoding=sRGBEncoding`，
     自定义片元要不 include `<map_fragment>` 要么自己 `pow(rgb,2.2)`；内置顺序是 tonemapping → encodings → **fog 在 encode 之后** mix。
- **冰下一步（如果要做 B 档）**：`js/shader.js`（新文件，见第 7 节）里给冰做一个 Fresnel + 表面高光的 ShaderMaterial，
  水也可以共用；但要把上面那三条（fog / vertexColors / 色彩空间）按源码顺序接对，否则软件光栅看着差不多、真机偏色。
  不推荐：逐三角排序或 OIT（three 官方不做，体素规模下每帧成本不可接受）；把整个 `Water.js` 搬来（带 mirror renderTarget 与 lights:true，本项目只要那 6 行公式）。
- **已知会被误报成 bug 的两件事**：Minecraft 自己就有"半透明方块某些角度出现条纹"的老问题（wiki 冰页放了 chunk 边界条纹截图并引 MC-38022）；
  `NearestFilter` + 无 mipmap 的半透明贴图在斜视角会有像素闪烁。这两个都不是本轮该修的。

## 10. 来源

- 本仓库实测：`vendor/three.min.js`（反查 `toneMapped` 默认 `!0`、编码门、`mapSize=(512,512)`、`OrthographicCamera(-5,5,5,-5,.5,500)`、`autoUpdate=!0`、`DepthTexture` format throw、`RGBADepthPacking`、无 `FullScreenQuad`/`GammaCorrectionShader`/`outputColorSpace`）；`js/world.js`（`cornerAO` 的 opaque 口径、`chunkYRange`、`spawnPoint`）；`js/main.js`（材质与三 pass 几何）。
- 官方 UMD（实测 HTTP 200）：`https://unpkg.com/three@0.128.0/examples/js/postprocessing/{EffectComposer,RenderPass,ShaderPass,UnrealBloomPass,MaskPass,Pass}.js`、`.../examples/js/shaders/{CopyShader,LuminosityHighPassShader,GammaCorrectionShader,SSAOShader}.js`、`.../examples/js/objects/{Sky,Water}.js`、`.../examples/js/math/SimplexNoise.js`
- r128 源码：`https://raw.githubusercontent.com/mrdoob/three.js/r128/src/` 下 `constants.js`、`renderers/WebGLRenderer.js`、`renderers/WebGLRenderTarget.js`、`textures/DepthTexture.js`、`renderers/webgl/WebGLPrograms.js`、`renderers/webgl/WebGLShadowMap.js`、`lights/LightShadow.js`、`lights/DirectionalLightShadow.js`
- 色彩空间：`https://discourse.threejs.org/t/how-to-get-the-correct-color-value-using-unrealbloom/39413`（Mugen87：链尾加 GammaCorrectionShader）、`https://discourse.threejs.org/t/solved-how-to-get-correct-gamma-for-effects/12685`
- 阴影 acne：`https://github.com/mrdoob/three.js/issues/13108`
- 深度纹理：`https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_depth_texture`
- 体素光照/阴影烘焙：`https://minecraft.wiki/w/Light`（skylight flood-fill、0–15 档、`max(sky,block)`）
- shader 包模块骨架：`https://shaders.properties/current/reference/programs/overview/`、`.../programs/gbuffers/`（`setup/begin/shadow/shadowcomp/prepare/gbuffers/deferred/composite/final`）
- bloom 参数与"必须开 tone mapping"：`https://threejs.org/docs/pages/UnrealBloomPass.html`、`https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/webgl_postprocessing_unreal_bloom.html`
- 半透明材质（线 B）：`https://minecraft.wiki/w/Ice`、`/w/Translucency`、`/w/Water`（冰走 translucent；wiki 也放了 chunk 边界条纹的截图并引 MC-38022）
- 原版纹理像素实测：`https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/block/ice.png`（同仓库另有 1.13.2 的 ice.png，以及 water_still / packed_ice / blue_ice）
- 同一 mesh 内不排三角：`https://discourse.threejs.org/t/transparency-issue-within-the-same-mesh/41344` + `src/renderers/webgl/WebGLRenderLists.js`
- Fresnel 与雾/编码写法：`https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/js/objects/Water.js`、`src/renderers/shaders/ShaderChunk/` 下 fog/map/encodings 四件套、`src/materials/ShaderMaterial.js`（fog 默认 false）
- 调研任务书（含项目硬约束原文）：`docs/RESEARCH_BRIEF_SHADERS.md`
- **未核实（别当依据抄）**：Faithful/Patrix 的 `ice.png`（官方仓库 git 树里没有纹理文件）、Terraria 冰的透明度（wiki 只说低摩擦未提半透明）、冰/水折射率原始出处（维基两次抓取失败，所以菲涅耳用的是 `Water.js` 的 `rf0=0.3` 而不是物理值）、0fps.net 的角落 AO 亮度常数（站点本次连不上）。

> 诚实边界：本文里所有**具体数值**（bloom 阈值、bias、normalBias、Fresnel 指数、暗角半径）都是通用经验量级，
> 没有一条是在本项目真机（RTX + dpr1.5）上实测过的；实现时必须逐项现场调，并把最终选定的数值回填进本表。
> 0fps.net 那篇角落 AO 经典文章本次抓取失败，其 4 档亮度常数**未核实**。

## 11. 落地实况（2026-10-16 深夜，实现方记录）

### 做了什么

| 档 | 内容 | 落点 | 状态 |
|---|---|---|---|
| 0 | 手写后处理管线（不引官方后处理 UMD） | `js/shader.js`（新文件，index.html 第 14 个 script） | ✅ |
| 1 | 曝光 + 可选色调映射 | 同上，`GW.SHADER.params` | ✅（色调映射默认关，理由见下） |
| 2 | 选择性 bloom（亮度阈值 + 半分辨率两趟可分离模糊） | 同上 | ✅ |
| 3 | 冷暖分级 + 暗角 + 有序四格抖动 | 同上，合成 pass 一个 shader 内做完 | ✅ |
| 4 | **静态地形太阳遮蔽烘进顶点色**（真正的"影"） | `js/world.js` `G.SUN_DIR`/`G.SHADOW`/`sunVis`；`js/main.js` 的 `buildChunkGeometry` | ✅ |
| 5 | 动态实体 shadowMap | — | ❌ 未做（第 4 节参数是备好的，没实测过） |
| 6 | 高度雾 / 大气 | — | ❌ |
| 7 | SSAO | — | ❌（本就有顶点 AO，判断是收益最低） |

开关：**P 键**切光影，选择记在 `localStorage.gw.post`（含各旋钮）；关光影时走原生 `renderer.render`，与改造前同源。

### 实测数字（SwiftShader 自动化环境；三种子 490706/88092/31337）

- **色彩空间没编码两次**：所有旋钮拨到无操作时与关光影**逐像素均差 0.004~0.012 / 255**（`tools/post_check.cjs` 判据 ≤1.0）。
  这条是我自己定的最硬的验收口径，因为它把"光影"和"相机/手感"两套基准隔离开了。
- 默认参数下画面确实变了：均差 13.8/255（证明管线不是空接的）。
- 日照：地面角点阴凉占比 43~56%；打开日照整屏亮度下降 **4.0%~8.8%**；
  chunk 重建代价 36 块 34.8→38.0ms（约 +0.1~0.4ms/块，`flushDirty` 每帧 2 块的预算吃得住）。
- 后处理开销：`gl.finish()` 同步下 12.6→14.4ms，约 **1.1~1.4×**（软件光栅的绝对值不能当真机指标，相对倍数只是下界参考）。
- 门禁：`audit` 三种子 × 15 项 + dpr1.5 回归 + `--file` 全过；`layer_check` 全过；`creative_check` 53/53；
  `ice_probe` 三种子 pass。

### 与调研原文不一致的两处（改了要认账）

1. **后处理在显示空间算，不是线性空间。** 第 2 节原本推荐"RT 用 Linear + 末 pass 自己编码"。实现时把
   `rtScene.texture.encoding` 设成 `sRGBEncoding`：内置材质写进 RT 的值与今天写进屏幕的值相同，
   于是"全关 = 现状"变成可机检的口径；代价是 bloom/分级/暗角不在物理正确的线性空间里算。
   对这个 46~150 格雾距的像素风对战，我认为可验证的等价性比教科书正确性值钱——但要写清楚，别下一个人以为这是通用做法。
2. **色调映射默认关。** Reinhard 在霜噬雪原那种大面积高亮场景把中间调整体压灰（同机位对比可见），
   ACES 会把 `cards.js` 定的元素色洗淡。两条曲线留在 `params.tone` 里可切，但不是默认。
   曝光只给到 1.04：再多积雪的层次就糊掉。

### 太阳角度

`G.SUN_DIR` 从 (0.55,1,0.35)（仰角 ~56°）改成 (0.65,0.95,0.42)（~51°）：再高，影子的长度只够贴在树干脚下，
截图上看不出"有影"；再低，朝南那面墙整个点亮，改掉用户已经认过的画面。影子方向与 `DirectionalLight` 读同一份真源。

### 未做 / 已知限制

- 动态实体（玩家、随从、抛射物）**不吃**这套日照，它们只在灯下；第 5 档的 shadowMap 参数没实测。
- `G.SHADOW.strength` 改了要重建 chunk 才生效（影子烘在顶点色里）；回归脚本用 `__dbg.rebuildAll()`，日常调参请走 P 关光影对比。
- 冰面、水面按 `DEFS[].opaque` 口径**不挡光**（与 `cornerAO` 同一口径），所以冰湖底下不会莫名变黑；
  代价是"厚冰该更暗"没做，那是材质层的活（见附录 B 的 Fresnel 路线）。
- 分屏两路相机各自过一遍管线（RT 按半屏尺寸建），实测能跑；两人同屏时 bloom 是各自独立的。
- 参数面板没做（旋钮在 `GW.SHADER.params` + `localStorage`），要给用户可调 UI 时按 AGENTS 的五步流程接进 creative/hud，别在 shader.js 里写 DOM。

## 12. 同日顺手做的手感项（同一批改动，不属于光影）

用户原话是"光影是必要的，然后就是一些操作手感上的优化"。手感这边我只做**能量出来、能回归**的四件，
没碰相机（AGENTS 的视角不变量那一大段是雷区，而且真机 160FPS 才是它的裁判）。

| 项 | 原来 | 现在 | 数值依据 |
|---|---|---|---|
| coyote time | 离地那一 tick 之后按跳全吞 | 离地 **0.12s** 内按跳仍然起跳 | `tools/jump_window.cjs`：at2(0.10s) 必须真、at4(0.20s)/at9(0.45s) 必须假 |
| 输入缓冲 | 落地前按的跳被吞 | 落地前 **0.20s**（4 tick）内的按键在落地时自动补跳 | 同上：at2 真、at8(0.40s) 假（窗口不许无限大） |
| 按住跳键走崖边 | 会在空中自跳（旧代码用 `inp.jump && onGround`，而 onGround 有一 tick 的滞后） | 只有**新鲜按下**才触发 coyote；按住不放仍在真落地时连跳 | 同上：holdNoAutoJump |
| 跳键电平→边沿 | 按下+抬起落在同一个 20Hz tick 内 → 这一下被整个吞掉（改动前的副本上跑同一条用例得到 `seenNextTick:false`，即那个 tick 完全没看到这次按键；机制上必然——读的是电平） | `net.js` 闩锁 `jumpEdge`，poll 取走才清 | 同上：tapEdge（对照组在改动前副本上 `seenNextTick:false`） |
| 冰面 | `collideAABB` 里 `acc=e.onIce?0.06:1` 直接抹位移 → 冰上 1 秒只走 **0.31 格**（地面 5.17），是"被粘住"不是打滑 | 位移不打折；滑改由 `applyInput` 的转向加速度承担（冰上 16 / 地面 44） | 冰/地面位移比 **0.06 → 0.77**（要求 ≥0.5 且 <1.02：既不能粘住，也不能让结冰卡失去价值） |
| 空中转向 | 空中加速度 12（掉头约 0.75s，越肩视角下像被水拖住） | 17 | `feel_probe` 同窗口未劣化 |

**权威层归属**：coyote/缓冲/冰面都在 `battle.js`（`applyInput` / `collideAABB`），边沿闩锁在 `net.js`（输入源），
没往装配层或视图层塞东西。

**探针写法上的两个坑**（后来人会再踩，记下来）：
1. 窗口类判据必须**同一条轨迹跑两遍**：第一遍不按键量出"关键 tick"（离地/落地），第二遍在那个 tick 按键。
   写成"运行中现算 landTick 再提前按键"的话，按键条件永远不成立——我第一次就测出"缓冲失效"的假红。
2. 建样本场地要**整箱清空**，包括头顶：生成的树会站在测试道上，"落在树干上"会被读成提前落地，
   "一路撞进林子"会被读成走不出悬崖。另外 `pos.y` 是身体中心，判"离地"要用 `onGround` 而不是比高度，
   否则晚 3 个 tick 才认出离地，coyote 窗口整个被推歪。

**手感数字的诚实说明**：AGENTS 里"同一路径三次复测都是 1.10"这句话，今天复现不出稳定性 ——
我在**改动前的原始副本**（`git checkout 5a985b8 -- js index.html`）上跑 `feel_probe` 三次，得到 ratio **1.64 / 1.09 / 1.10**、jerk **618 / 311 / 329**。
也就是说这把尺子本身有 1.6 量级的偶发离群值，报单次数会骗人（正是 AGENTS 自己警告过的那类事）。
本次三组对照：

| 组 | 内容 | ratio（三次） | jerk |
|---|---|---|---|
| H | 5a985b8 原始（无光影无手感改动） | 1.64 / 1.09 / 1.10 | 618 / 311 / 329 |
| P | 光影+日照+手感，但**后处理关**（走原生直渲） | 1.10 / 1.10 / 1.10 | 343 / 337 / 291 |
| N | 最终状态（后处理开） | 2.13 / 2.15 / 2.15 | 296 / 354 / 311 |

结论分开说：**日照烘顶点色与移动改动没有劣化手感**（P 组与 H 组的均值/零位移占比/jerk 同档，ratio 反而更稳）；
**开后处理的 N 组 `max` 从 0.0941 涨到 0.187**，即偶发一帧的位移翻倍 = 软件光栅里出现约 30FPS 的长帧，
但 `mean`（0.087）与 jerk（同档）没变，说明是偶发帧时抖动而不是系统性变慢。
按项目规矩（SwiftShader 的帧率不能当真机指标），这条**必须**由用户在真机上判：
如果他觉得开后处理有偶尔一顿，用 `GW.SHADER.set('down',4)`（模糊 RT 再降一档）或 `set('bloom',false)` 试，P 键可整层关掉。
我没有替他下"真机也卡"或"真机不卡"的结论。

未做（留在待办里）：`G.SHADOW.strength`/曝光/bloom 的**参数面板**（按 AGENTS 五步流程接 creative+hud，
但 creative.js/hud.js 现在有并行会话在改，不和他抢同一批文件）；动态实体 shadowMap（第 5 档）；高度雾（第 6 档）。

## 13. 块光：元素会不会照亮周围（用户 2026-10-16 追问的那件事）

**先分清两件事**（这是我一开始回答里最容易糊过去的地方）：

- **"发光"** —— 第 11 节的选择性 bloom 已经在做，但它是**屏幕空间**的：只要画面某个像素够亮（>0.84）就糊一圈光晕。
  岩浆、燃烧块、以太晶、法阵光柱、火弹都会亮，**但它不知道"这是个光源"**，也不会照亮旁边的石头。
- **"照亮周围"** —— 之前**没有**。场景里只有半球光 + 太阳平行光 + 环境光三盏，没有任何点光源；
  岩浆旁边的石壁、火堆脚下、以太晶四周全是原色。这一节补的就是这块。

### 做法

`js/world.js` 新增 `G.LIGHT` + 发射源登记表 + `lightField(cx,cz)`：MC 那套 0–15 档的**洪水填充**，
从发光格向六邻传播、每格衰减（空气 1、水 2、冰 1，opaque 不进格），算出的光强在 `buildChunkGeometry` 里
**烘进顶点色**（与太阳遮蔽同一条通路，所以每帧零成本）。光源：岩浆 12 档、燃烧块 14 档、以太晶 10 档。
光源自己那几格不吃块光（上面已有固定亮色），否则火会白成一团、反而看不出是火。

发射源单独存 `_em`（idx→强度）+ 每 chunk 计数，**不在重建时扫全图**：绝大多数地图一个光源都没有，
`lightField` 直接返回 null，那条通路整个跳过。地形生成期的岩浆/以太晶是直接写进 `blocks` 的（绕开 `set()`），
所以 `generate()` 末尾把登记表作废，由 `ensureEm` 全图扫一次兜底 —— 少这一步就是"有贴图没光照"。

### 两个必须写下来的判断

1. **加光，不是乘光。** 第一版写成乘光（往暖色温混），实测紧邻岩浆的地面亮度从 1.00 **掉到 0.938** ——
   太阳已经照满的顶面被"照亮"之后反而变暗，看着像火把地皮烤黑了。改成按通道加（暖色优先补足 R，G/B 次之），
   日光下几乎没变化（**本来就该没变化**：MC 中午烧火把也不亮，物理上是对的），阴凉处/夜里才显出决定性差别。
   `tools/light_probe.cjs` 的判据因此规定在**盖了不透光屋顶**的场地上量 —— 在露天顶面量，量到的只是"1.0 能不能再大"。
2. **光要能被挡住、要按介质衰减。** 水 2/格、冰 1/格、opaque 不进格；半径 8 之外必须回到基线。

### 实测（`tools/light_probe.cjs`，屋顶下的阴凉场地）

| 判据 | 数值 |
|---|---|
| 紧邻岩浆的地面顶面亮度 | 基线 0.5000 → **0.8485**（**1.70×**，判据 ≥1.6） |
| 5 格外 | 0.5000 → 0.7305（1.46×），且必须比 1 格处暗 |
| 12 格（超出半径 8） | 0.4025 vs 基线 0.3955 → 判据内一致（**半径确实封住了**） |
| 色温 | 照亮处 R/B = 1.278 vs 基线 1.0 → 是偏火色，不是加白 |
| 水挡光 | 同一路径：空气 0.8036 → 灌满水 0.5068（衰减 37%） |
| 无光源时 | `lightField()` 必须返回 null（不许每次建 chunk 白扫 BFS） |
| 关掉块光 | 这条通路整个不参与：`lightField()` 返回 null，且半径外那一格开/关顶点色相同（0.4025 vs 基线 0.3955）。**别拿跨副本顶点色校验和证这个**：并行会话未提交的化学层会改地形（岩浆遇水凝黑曜石），而 `G.CHEM` 的调用只在工作区的 battle.js 里，上个提交那份根本没有 → 两份副本的地形本来就不同。同树连跑两次校验和相同（1412007817）只说明确定性，不说明跨版本等价 |

### 还没做的（别当成已经做了）

- **实体不带光**：火弹、法阵光柱、随从火把都不会照亮周围。它们是实体不是方块，走的是每帧更新那条路，
  要么给附近实体挂少量 `THREE.PointLight`（r128 支持，但要设灯数上限并注意与 `MeshLambertMaterial` 的着色程序数），
  要么把它们的临时光源也塞进 BFS 源表再重建受影响 chunk（贵）。两条都没实测。
- **光源不投影**：块光目前不判断"中间有没有墙挡在光源与面之间"以外的东西……准确说：BFS 被 opaque 挡住，
  所以墙后有阴影；但**半透明的冰/水不挡光**，所以冰屋里面会透亮，这个先记着。
- **昼夜与块光的联动**：`dayNight()` 改的是那三盏灯，块光是烘在顶点色里的，夜里不会自动更亮；
  真要做"夜里火光更醒目"，需要按 `dayNight` 的系数把 `G.LIGHT.add` 调一下并触发重建（现在没有）。
- 参数面板仍然没有：`GW.LIGHT` 的 `add`/`maxMix`/`radius`/`decayWater` 只能控制台改，
  改了要 `__dbg.rebuildAll()` 才生效（烘在顶点色里）。
