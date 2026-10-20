# 调研任务简报 · 光影与半透明材质（2026-10-16）

> 给调研代理的完整约定。两条独立调研线（线 A 后处理管线，线 B 冰/水材质）。
> 只做网络调研，**不要修改仓库任何文件**。产出以 markdown 回复，不写盘。

## 项目硬约束（决定方案可行性，别拿通用建议覆盖）

- 唯一入口 `index.html`，用户 **file:// 双击**运行：不能依赖 `fetch`、ES modules、npm、任何构建步骤。
- three.js **r128** 已本地化在 `vendor/three.min.js`（全局 `THREE`，非 module）。不打算升级版本。
- 零外链：需要第三方脚本必须能下载成 `vendor/` 下的普通 js 文件（UMD/全局脚本形态）。
- 现状渲染：`WebGLRenderer({antialias:false})`、`outputEncoding = sRGBEncoding`、
  `HemisphereLight + DirectionalLight + AmbientLight`、`MeshLambertMaterial`（顶点色里烘焙了角落 AO）、
  16×16 分块 `BufferGeometry` 体素网格、`THREE.Fog(0x9ec9ff, 46, 150)`、程序化 16×16 像素图集（`NearestFilter`，无 mipmap）。
- 世界规模约 128×48×128，chunk 16×16；真机 RTX 级显卡报 160FPS；自动化验收环境是 **SwiftShader 软件光栅**（那里 50FPS 上下，不能当真机指标）。
- 交付方式：另一位工程师会按你的调研结论手写实现，所以你要给**可抄的具体 API 名、文件路径、数值区间**，不要泛泛而谈。

## 线 A · 后处理与阴影管线

1. **两条后处理路线**：
   - (a) 官方 `examples/js/postprocessing` 的 UMD 全局脚本：`EffectComposer / RenderPass / ShaderPass / UnrealBloomPass`
     依赖 `CopyShader / LuminosityHighPassShader / Pass / MaskPass` 中的哪些、加载顺序如何；
     这些 UMD 文件在 `three@0.128.0` 的 unpkg/jsdelivr 路径下是否还能取到（给出确切 URL 形态）。
   - (b) 完全手写 composer：`renderer.setRenderTarget` + `WebGLRenderTarget` + 全屏 quad/triangle `ShaderMaterial`。
     列出 r128 中这些 API 的确切签名与语义（`setRenderTarget` 参数、构造选项、`renderTarget.texture`、
     `depthTexture`、`setSize(updateStyle)`、`getPixelRatio`）。
2. **色调映射与色彩空间**：r128 `renderer.toneMapping` 支持哪些枚举（是否含 `ACESFilmicToneMapping` /
   `ReinhardToneMapping` / `CineonToneMapping`）、`toneMappingExposure`；配合 `outputEncoding = sRGBEncoding`
   时后处理链上"线性/sRGB 往返"的经典错误与正确做法（tonemap 在哪一步、encode 在哪一步、
   中间 renderTarget 的 `encoding` 怎么设）。要官方 wiki / issue / 论坛原帖。
3. **体素 + DirectionalLight + shadowMap 实战**：`shadow.mapSize` 合理区间、正交 shadow camera 如何跟着玩家走、
   `shadow.bias` / `shadow.normalBias` 典型值、transparent 材质不投影怎么补、以及体素业界常用的
   「把太阳阴影烘焙进顶点色/AO」做法（叫什么、怎么算、重建代价、脏块更新频率）。
4. **深度类效果（SSAO/景深/边缘光）前置条件**：r128 `WebGLRenderTarget.depthTexture` 在 WebGL1/WebGL2 下的支持差异、
   `DepthTexture` 类型选择、把深度编码进颜色 pass 的替代方案、SwiftShader 下验证要注意什么。
5. **像素/体素光影配方经验值**：bloom 阈值与强度、tonemap 曲线选择、冷暖色彩分级、Fresnel 边缘光、
   高度雾、暗角；Minecraft 类 shader 包（Complementary / BSL / Silds）公开文档里的**模块构成清单**。
6. **结论**：在上述约束下可行 / 不可行分别是什么，给推荐落地顺序（每步一个可截图验证的增量）。

## 线 B · 冰与水这类半透明体素材质

背景事实（当前代码行为，已核对）：冰方块 `solid:true, opaque:false`，纹理只有几条白裂纹；
分块几何的**非液体分支**里有 `if (!d.opaque) continue;`，把冰的所有面剔除 → 冰在游戏里完全看不见。
水走单独的 liquid 通道：`MeshLambertMaterial({transparent:true, opacity:0.74, DoubleSide, depthWrite:false})`，顶点 y 压到 0.86。
雾色 `0x9ec9ff`、天空是浅蓝渐变，所以"浅蓝 + 高透明 + 无对比"的冰在白背景下等于隐形。

1. Minecraft / 主流体素游戏的**冰到底怎么渲染才像冰**：alpha 混合还是不透明+高光？透明度大概多少、
   纹理做了什么（裂纹、气泡、内部结构、亮边）？参考官方 wiki 的冰/浮冰条目、Faithful/Patrix 等纹理包里
   `ice.png` 的实际做法、Terraria / Noita 的表现。
2. 低分辨率像素体素里让半透明方块「看得出是冰」的手段清单与**可操作数值**：alpha 区间、纯色描边/亮边、
   Fresnel 边缘光、双层壳、内部气泡层、下方地面可见度、与雾/天空色的明度分离。
3. three.js 半透明体素排序的已知坑与解法（论坛/文档原帖）：同一 mesh 内三角排序、`depthWrite` true/false 取舍、
   `DoubleSide` vs `FrontSide`、`renderOrder`、`alphaTest` 与 `transparent` 混用、`polygonOffset`。
4. r128 + 无构建下把水/冰做成「自定义 ShaderMaterial 带 Fresnel + 流动高光」的最小实现要点：
   `fog: true` 与 `THREE.UniformsLib.fog` 合并、`vertexColors` 在 r128 的合法取值（`true` 还是 `THREE.VertexColors`）、
   `map` + `alpha` 与 `sRGBEncoding` 的配合。
5. 给这个项目三条候选方案并对比（视觉收益 / 复杂度 / 回归风险）：
   - A 只调 alpha + 纹理 + 描边（改动最小）
   - B 给冰单独透明通道 + Fresnel ShaderMaterial
   - C 仿 Minecraft：不透明但带高光/裂纹纹理

## 汇报格式

「结论先行」→「可抄清单（API 名 / 文件路径 / 数值区间）」→「坑清单」→「不推荐或不可行」→「来源列表（URL）」。
