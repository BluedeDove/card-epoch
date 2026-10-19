# 魔法特效的元素拆分与对接规范（FX_ATOMS）

> 分工：特效拆成两家——**算**的在 [src/vfx.js](../src/vfx.js)（纯计算）+ [src/vfx-recipes.js](../src/vfx-recipes.js)（纯数据），
> **画**的在渲染层（[src/main.js](../src/main.js) / [src/shader.js](../src/shader.js)，由另一条工作线负责）。
> 本文档是给渲染侧的接口约定：它需要什么形状的数据、能改什么、不能改什么。
> 回归：`node tools/vfx_check.cjs`（49 条断言）+ `node tools/layer_check.cjs`（分层机检已收录 vfx 两层）。

## 一、八个元素原子类

任何魔法特效都由这几类摆出来，不新增种类；要新效果先考虑调参数或组合。

| 类 | 是什么 | 关键字段 | 单位 |
|---|---|---|---|
| `ring` | 同心环：连续 `solid` / 点环 `dots` / 刻度齿 `ticks` | `r` `w` `count` `style` `tilt` `spin` `flow` | r=单位半径 |
| `poly` | 内接多边形与星形 | `n` `step`（1=凸多边形，2/3=星形）`spike`（尖角出头长度） | 同上 |
| `spokes` | 从圆心放射的线 | `rIn` `rOut` `n` `jitter`（手绘抖动） | 同上 |
| `glyphs` | 环上的等距符号槽位 | `n` `size` `blink` | 渲染层决定槽位里画什么 |
| `pillar` | 竖向柱：光柱 / 冰柱 / 落雷 | `r` `count` `h` `taper` `rise` `flicker` | **`h` 是「格」，不随法阵大小长** |
| `vortex` | 漏斗/旋涡：`layers` 圈半径从 `rTop` 收到 `rBot` | `h` `count` `spin` | 同上 |
| `orbit` | 偏心绕转体（小环、剑、萤火） | `n` `size` `spin` `phase` | — |
| `sweep` | 扫掠弧（扫描、蓄力充能） | `a0` `span` `speed` | 角度 |

八个类全部有硬边界（[src/vfx.js](../src/vfx.js) 的 `CLASSES[*].fields`）：数据越界被 clamp 并记进 `validateRecipe` 的 errors，**不抛异常**——配方写错要能在机检里看见，但不能把游戏崩掉。

## 二、七个动画通道（挂在每层上，不是元素）

`draw`（描线生长）、`spinAt`（覆盖该层的自旋速度，缺省 `null` = 不覆盖）、`pulse`/`pulseHz`（呼吸）、`flicker`（确定性亮度抖动）、`flow`（刻度与符号的跑马灯）、`fade`（整层淡入淡出）。

三条已经踩过坑的纪律：

1. **旋转是角速度的积分，不是 `time × 瞬时速度`**。后者一减速整圈会往回跳（实测 −1.3 → −0.35，肉眼是「环倒回去」）。用 `V.angleOf(age, delay, ttl, span, full)`，它是纯函数，不需要往实体上存累加量。
2. **临期先减速再淡出**：`decay` 段角速度线性掉到 25%（`V.spinRate`），透明度同时 ease-in 掉到 0。一直全速淡出会像贴图消失，不像东西散掉。
3. **生长用 smoothstep**（`gp·gp·(3−2gp)`），用 easeOut 会「一下就亮完」，看不出描线。

## 三、时间轴相位（由 `age / delay / ttl` 推出，纯函数）

`idle`（delay 未走完，正在被画出来）→ `ignite`（点燃窗口，渲染层可额外叠一圈冲击环）→ `live`（各层异速自旋）→ `decay`（减速淡出）→ 消失。
问一次：`V.phaseOf(age, delay, ttl, igniteWindow)` → `{ name, t, p, decayAt, decaySpan }`。

## 四、渲染层的唯一入口

```js
var f = GW.VFX.frameOf(entity, time, dt, role);
// f.anchor : 'ground' | 'body'          —— 贴地摆 or 挂实体身上
// f.phase  : 上面那个相位对象
// f.layers : [{ prim, verts, count, radius, r, rOut, rIn, rTop, rBot, h,
//               w, style, size, taper, rot, spin, tilt, flow, alpha, draw,
//               color, color2, span, a0, speed, jitter, blink, rise, flicker }]
```

- `verts` 是**共享只读**的 Float32Array（单位几何，按 形状+份数 缓存），渲染层拿来直接乘 `radius` 摆位；不许就地改它。
- `color` 来自权威层报的 kind（fire/ice/void…）经 `G.ELEMENTS` 换算，`color2` 是渐变副色：沿角度做 `color↔color2` 插值，或近白核心配单层彩环。亮度用 additive 混合堆，别用 alpha 调。
- 每帧现算不查状态：同 entity 同 time 永远同一答案，因此暂停、录像、回滚、将来联网同步都不会出现「特效和判定不一致」。
- 渲染层想知道某实体该挂什么特效，只用 `frameOf`（内部会查 `CARD_FX / PROJECTILE_FX / ENTITY_FX` 绑定表），**不要在渲染层写死配方名**。

## 五、权威层 ↔ 特效层的通道

- 权威层只**报 key**：`GW.VFX.event('cast' | 'hit' | 'impact' | 'explode' | 'sigilGo' | 'sigilBreak' | 'sigilEnd', { pos, kind, color, radius, ... })`，订阅方抛错被吞（不许打断结算）。渲染侧用 `GW.VFX.on('sigilGo', fn)` 订阅。
- 实体带一个稳定 `uid`（[src/battle.js](../src/battle.js) 的 `fxUid`）当确定性随机的种子。存档只存差异格、不存实体，所以恢复后 uid 重排只换种子，不进判定。
- 法阵在 `G.SIGILS[*].fx` 里绑定配方名（纯数据，在 [src/cards.js](../src/cards.js)）。**新增法阵要同时给 fx 字段**，否则 `frameOf` 查不到配方，返回空 layers（渲染层什么都不画，机检也看不出来）。

## 六、25 条现成配方（对着收集的参照图来的）

- 地面阵：`circle_basic`、`command_stack`（多层悬浮环组）、`super_spell`（刻度齿+出头五角星+光柱）、`dragon_halo`（双光环+符号带）、`starburst_ground`、`hexagram`、`triangle_rune`、`fire_tri`、`thunder_cage`、`wire_sphere`（线框球，13 圈）
- 跟随体：`follow_star`（玩家脚下）、`summon_aura`、`sword_ring`、`comet_trail`（抛射物拖尾）
- 一次性：`impact_burst`、`charge_up`、`ev_cast`、`ev_hit`、`ev_break`
- 现有 6 种法阵：`sigil_meteors`、`sigil_glacier`、`sigil_bloom`、`sigil_rune_hammer`、`sigil_snare`、`sigil_lava_pool`

参照图在 [docs/RESEARCH_SOURCES.md](RESEARCH_SOURCES.md)（法阵与印记的第三方截图见出处表，不随本仓库分发）。

## 七、渲染层已接入（2026-10-16 深夜，`src/vfx-render.js` = `GW.VFXR`）
```js
GW.VFXR.attach({ scene, group: fxGroup, match, world, cameras: fn })   // main.js 的 start() 里，每开一局重挂一次
GW.VFXR.update(dt, S.animT, S.alpha)                                    // 帧尾：实体落位 + 相机之后、render() 之前
```
- **画的是宿主 + 事件两类**：宿主 = 法阵（贴地，读 `preset.fx`）、抛射物拖尾（跟随体，按元素查 `PROJECTILE_FX_EL`）、随从光环、玩家脚下阵；
  事件 = `cast / hit / impact / explode / sigilGo / sigilBreak / sigilEnd / react`，一次性、到 ttl 自己回收。宿主→槽位的对应关系**存在渲染层自己的表里**，实体上不留字段。
- **每帧零分配**：槽位（几何 + 属性 + mesh）按 kind 建池复用；求值把上一帧对象用 `frame(..., { out })` 传回去原地改写。
  160FPS × 十几个宿主 = 每秒两万次求值，不这么做就会把 minor GC 扫进手感（`opts.out` 层数对不上会自动退回新建）。
- **线宽是真几何**：WebGL 的 line 恒为 1 像素，所以 `w` 由渲染层翻成 **2~3 条平行线**（`segXY` / `segXZ`）+ 一圈暗底描边。
  默认档在 `src/vfx.js` 的 CLASSES（用户报"线条太细看不清"之后整体上抬：ring/poly/spokes w=1.9、pillar 2.6、sweep 2.2、glyphs/orbit size 1.8）。
  想细就在配方里自己写小 w，不是让渲染层替配方猜。
- **顶点色必须先 sRGB→Linear**：`renderer.outputEncoding = sRGBEncoding` 会把线性色再编码回 sRGB，
  直接塞 sRGB 数字 = 同一个颜色提亮两次，焰色 `#ff7a45` 画出来是白的（截图自查抓到，同光影层 post_check 防的那类）。
- **可关性**：`GW.VFXR.enabled = false` 时法阵回到 `cards.js` 的老贴图阵（`main.js` 里那个 `vfxOwns` 闸），
  与光影层"P 关掉 == 现状"是同一条口径，`tools/vfx_live.cjs` 里钉着。
- **预算**：槽位 ≤300、单层顶点 ≤1024、一次性事件 ≤40；超了**少画一圈**，绝不"这帧补完"。
  实测：两座阵 + 两个玩家脚下阵 + 连发 8 次/秒的出招事件，live=108、skipped=0。
- **配套验收**：`node tools/vfx_live.cjs --shots /tmp/gwf`（27 条，含**同机位开/关像素差分**：
  实测覆盖 15.7% 像素、改动像素平均色的色度差 29 —— 用来回答"亮草地上到底看不看得见"，光看 `stats.live > 0` 会把白色细线误判成"画好了"）。

### 七·五、元素交互的特效词汇（`GW.CHEM` 报 key，`CHEM_FX` 给配方）
火 / 蒸汽 / 灰烬 / 黑曜石 / 融化 / 结冰 六种反应各有**一条一次性配方 + 一条音效 id**：
`ev_react_ignite / _steam / _ash / _obsidian / _melt / _freeze` 配 `ignite / steam / ash / obsidian / melt / freeze`（`src/sfx-table.js`）。
化学层每 0.14s 每种反应只放行一次画面反馈（一场山火会产出上千次格子转换，全放行的话粒子池与事件名额会被同一种橙点占满，
真正该被看见的出招反馈反而画不出来），但**计数照记**：`GW.CHEM.stats` 里 `reacts` / `fxEmitted` / `fxSuppressed` 三个数分开。
火格还有一张 `burnList` 专门按 0.09s 一轮往外冒火星——火星挂在"某一次反应"上就只是闪一下，不是"在烧"。

## 八、还没做（诚实清单）

- `frameOf` 的产物 → three 的几何/材质：每层一个 quad 还是统一 Points，由渲染侧定；建议每层 `LineSegments` 或 `Points`，材质 additive、depthWrite 关，几何体复用（帧尾按 `dead` 回收，参照 `disposeSigilMesh` 那条老坑）。
- `anchor:'body'` 的贴合位置要读实体插值后的 `camViewOf/rp()` 结果，别读 `e.pos`（判定专用，会抖）。
- 顶点预算：6 个法阵在场 × ≤4 层 × 每层 ≤128 点，别一路加到几千点——真机 160FPS 时是渲染侧先暴露问题。
- 接入清单（渲染侧动手时）：[index.html](../index.html) 里在 main.js **之前**加载 `src/vfx.js`、`src/vfx-recipes.js`（ recipes 依赖 VFX 已注册），本文件不碰 index.html，避免和另一条工作线抢同一文件。

---

# 九、2026-10-17 架构重排：从「平铺层」到「节点树 + 密度预算」

## 9.1 病灶（用户的原话："这些问题不是一件一件修能修明白的，感觉是代码组织上有问题"）

旧版 `frame()` 是**平铺循环**：`for (layer of recipe.layers) {...}`，`place()` 只认单层的 `(tilt, rot)`。
由此长出三个结构性症状，全部**不是某条配方写错**：

1. **没有任何嵌套**。所以"法阵外面有一圈旋转的法针""环里再嵌一圈环""外层罩子里套一颗反着转的小球"
   都写不出来——只能为某张卡单独加一条配方。新技能没法"由基础元素组合自发长出来"。
2. **没有立体体积**。平面原子只能躺在地上，唯一的"竖起来"是 `pillar`/`vortex`/`dome`（半球罩）。
   于是**爆炸永远只画得出下半球**——用户报的"爆炸怎么只炸下面不炸上面"就是这个。
3. **没有密度闸门**。配方想加多少层就加多少层，远处/近处一样贵，屏幕上同一时刻堆十几座阵就糊成一片白。

顺带查出一个**真视觉 bug**：`place()` 写的是 three 的 `Euler(-π/2+tilt, rot, 0)`，等价于 `Rx·Ry`，
实测法线 = `(sin rot, cos rot, 0)`——**环不是原地打转，而是随 rot 越来越大翻成斜椭圆**。
（验证：`new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI/2, 0.79, 0)) ` 的第三列 = (0.710, 0.704, 0)。）

## 9.2 新结构

```
recipe.layers: [ node, node, ... ]
node = 叶子原子  { prim: 'ring'|'poly'|...'sphere', ...参数, weight, minLod }
     | 组节点    { group: true, spin, tiltX, tiltZ, off:[x,y,z], children:[node...] }
     | 环绕复制  { sat: { n, radius, y, phase, spin, tiltX }, child: node }
```

- `vfx.js` 的 `expand(id)` 把树编译成**叶子表**（每叶带一条父链），按配方缓存；每帧只重算"随年龄变化"的矩阵。
  展开后仍是**扁平叶子表**——渲染层不需要认识树，draw call 仍是一条几何。
- 变换 = 3×3 旋转 + 平移，纯数字、零 THREE（本层纪律不变）。
  父链：`spin` 绕世界竖轴（`Ry(ageNow*spin)`）、`tiltX/tiltZ`、`off`（在当前父坐标系里平移）。
  叶子：平面原子先 `Rx(-π/2 + tilt)` 躺平、再**左乘** `Ry(rot)` 在平面里自旋；立体原子 `Ry(rot)`。
  `anchor:'body'` 的平面原子改成"正对镜头 + `Rz(rot)` 屏面内自旋"，由渲染层把 `camQ` 乘在最外层。
- `place()` 现在只做一件事：把计算层交出的 `L.m`（3×3）与 `L.px/py/pz` 摆到场景里。它不再判断"平面还是立体"。

## 9.3 密度预算（用户："信息密度也要控制一下"）

三层闸门，全在计算层：

| 闸门 | 怎么算 | 谁在用 |
|---|---|---|
| 距离下标 `lod` | 渲染层按相机到宿主的距离给 1 / 0.66 / 0.33 | `lodAt()`（vfx-render） |
| 叶子上限 `budget` | `max(4, round(base * (0.45 + 0.55*lod)))`，超了按 `weight` 从高到低留，其余丢 | 配方可声明 `budget` |
| 电子抽稀 `dec` | `lod<0.7` 时环/辐条/符号的点数降到 75%，`lod<0.4` 降到 50%（至少留 3 点） | 自动，所有原子 |

丢弃是**稳定排序**（同 weight 保序），所以同帧同参数永远同一结果——存档/网络/复现都不受影响。

## 9.4 三个"组合自发长出来"的例子

- **法针环绕**（用户点名的）：`{ sat: { n: 6, radius: 1.18, spin: 0.5, tiltX: 0.35 }, child: { prim: 'spokes', rIn: .02, rOut: .26, n: 3, spin: -2.2 } }` —— 一行数据。
- **立体爆炸**：`{ prim: 'sphere', r: 1.1, lat: 6, lon: 14 }` + 内层反转小球 + `sat` 挂 8 片碎壳。
  `sphere` 的纬线从 -90° 到 +90° 铺满、经线极到极，**上下对称**。
- **嵌套小阵**：`{ sat: { n: 3, radius: .42, y: 1.6, spin: -.9 }, child: { prim: 'ring', style: 'ticks', ... } }`。

## 9.5 谁拦着

`tools/vfx_check.cjs` 第 11 组（9 条）在 node 里直接断言结构，不依赖 GL：
超新星展开 13 叶（球 ×2 + 环绕三角 ×8）、灭世天陨 9 片法针叶（深度 ≥1）、
法针半径落在 1.18/0.42 两圈上、0.6 秒转 0.30 rad、平面法线竖直（那条真 bug 的回归）、
budget 截断后留下权重最高的、远处比近处少、老配方零迁移（4 叶深度 0）。
