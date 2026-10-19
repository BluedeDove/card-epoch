/* ================= GW.ATMOS_DATA（大气层·配方层） =================
   大气与天气的**全部可调数据**只在这一个文件里：日行轨道、天空色阶、太阳/月亮外形、
   星表分布、云层与云影、降水粒子、天气预设、天气之间的转移权重、质量档与预算。

   口径（与 js/sfx-table.js、js/vfx-recipes.js 同一条路子）：
     · 本文件**只许是数据**——不许函数、不许分支、不许循环、不许随机、不许中文文案、不许 DOM/THREE。
       机检：node tools/layer_check.cjs（"大气·配方层"三条）。
     · 角度一律写**度**、距离写**格**、亮度写 0..1，换算发生在 js/atmos.js 的求值侧。
     · 颜色一律"显示空间 sRGB 十六进制"，与 js/world.js 的图集同一口径（渲染层直接当 uniform 用，
       不再乘一遍色彩空间）。
     · 想加一种天气 = 在 WEATHERS 里加一条 + 在 TRANSITIONS 里补它的进出权重，atmos.js / weather.js
       一行都不用改。想加一层云 = CLOUD.layers 加一条。想让某种天气影响元素魔法 = 给它填 mods。

   ⚠ 唯一"不许顺手改"的一块：MOON.nightFog / LIGHT_KEYS 的夜里档位，是从 2026-10-17 之前
     main.js 的 dayNight() 抄来的量级（夜里 sun 0.25 / hemi 0.32 / amb 0.18、雾色 0x141228）。
     "关掉大气层必须等于现状"这条机检（tools/atmos_check.cjs 第 1 项）比的是 main.js 里**保留下来的
     那条老通路**，所以老数值留在 main.js，本文件改了不会让门禁变红——但白天/正午那档一改，
     用户已经认过的画面就变了，改前先截图对比。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  G.ATMOS_DATA = {

    /* ---------- 天体轨道（真实天文公式，参数只有这三个 + 正午相位） ----------
       sin(仰角) = sin(纬度)sin(赤纬) + cos(纬度)cos(赤纬)cos(时角)
       纬度 0 + 赤纬 0 时昼/夜正好各半；这里纬度 22°、赤纬 ±7°，日落点在 0.50–0.53 之间摆动，
       与 battle.js 的 match.night（dayT/dayLen > 0.6）保持"天先暗、后算夜"的既有口径。 */
    ORBIT: {
      latitudeDeg: 39,           // 观测纬度：正午仰角 = 90 − 纬度 ⇒ 39 让太阳在正午落在 51° 上下，与 G.SUN_DIR 烘进顶点色的影子同向
      declinationDeg: 7,         // 季节赤纬幅度（0 = 昼夜恒定各半）
      seasonDays: 9,             // 走完一个回归年要多少个游戏日
      noonPhase: 0.25,           // dayT/dayLen 的哪一点是正午（对齐 main.js 老通路里的 sin(2πd)）
      azimuthOffsetDeg: -57.3      // 把地理方位旋到世界方位：让正午的太阳落在 G.SUN_DIR 那一侧。
                                   // 烘进顶点色的老影子用的就是 G.SUN_DIR，正午对不上就会太阳在西、影子朝东
    },

    /* ---------- 天空：按太阳仰角取样的色阶（相邻两档线性插值，插值逻辑在 atmos.js） ----------
       zenith = 天顶色，horizon = 地平线色（同时喂给雾，地形远处才融得进天），ground = 地平线以下，
       fogNearK/fogFarK = 该档对雾距的乘子（黄昏雾更黏一点）。 */
    SKY: {
      stops: [
        { el: 90, zenith: '#4d8fe0', horizon: '#bcdcf6', ground: '#6f86a8', fog: '#9ec9ff', fogNearK: 1.0, fogFarK: 1.0 },
        { el: 55, zenith: '#4d8fe0', horizon: '#c2ddf7', ground: '#6c81a2', fog: '#a3cdf5', fogNearK: 1.0, fogFarK: 1.0 },
        { el: 22, zenith: '#4a88d8', horizon: '#cfe0f2', ground: '#647a9a', fog: '#aecbe8', fogNearK: 1.0, fogFarK: 0.98 },
        { el: 8, zenith: '#4478c0', horizon: '#ecd7c4', ground: '#5d6c88', fog: '#bfd0e2', fogNearK: 0.92, fogFarK: 0.92 },
        { el: 2.5, zenith: '#3a63a8', horizon: '#ffab6a', ground: '#54607c', fog: '#d0a9a0', fogNearK: 0.84, fogFarK: 0.82 },
        { el: -1.5, zenith: '#2c4a86', horizon: '#ff8a4a', ground: '#47516c', fog: '#c08a86', fogNearK: 0.78, fogFarK: 0.74 },
        { el: -5, zenith: '#1e3468', horizon: '#a85a72', ground: '#37405a', fog: '#6e5f7e', fogNearK: 0.72, fogFarK: 0.66 },
        { el: -9, zenith: '#122148', horizon: '#4a3f66', ground: '#232a42', fog: '#3b3c5c', fogNearK: 0.7, fogFarK: 0.62 },
        { el: -14, zenith: '#0c1638', horizon: '#2c3157', ground: '#171c30', fog: '#22284a', fogNearK: 0.72, fogFarK: 0.66 },
        { el: -22, zenith: '#0b1030', horizon: '#26305a', ground: '#12152a', fog: '#141228', fogNearK: 0.8, fogFarK: 0.78 },
        { el: -60, zenith: '#090d26', horizon: '#1b2342', ground: '#101223', fog: '#100e20', fogNearK: 0.8, fogFarK: 0.78 }
      ],
      horizonPow: 0.55,          // 地平线带集中度：1.55 那版把 62% 的可见天空都糊成地平线的白（天区均亮 234，老画面 176），
                                   // 0.55 让天顶蓝铺开得快一些，地平线只剩窄窄一条
      groundFade: 0.16,          // 地平线以下多快过渡到 ground
      band: { color: '#ff8a4a', k: 0.62, elWidth: 13, azWidth: 34, minEl: -7, maxEl: 12 },
      /* 黄昏那条"围着太阳的暖带"：elWidth = 只在仰角接近地平线时出现，azWidth = 方位上的集中度 */
      starlight: { color: '#8fa8d8', k: 0.05 },
      /* 无月晴夜的极弱天光底（不让夜空纯黑，星星才有衬底） */
      scattering: { k: 0.5, offset: 0.24 }   // 太阳方向上的整体前向散射强度
    },

    /* ---------- 太阳 ---------- */
    SUN: {
      radiusDeg: 1.55,           // 视半径（真实太阳 0.27°，这里放大到能看清是一张"圆盘"）
      disc: { color: '#fff6dc', edge: 0.06, bloomK: 1 },
      /* 圆盘本体：edge = 边缘柔和度（度），颜色要够亮才会被 js/shader.js 的 bloom 捞到 */
      glow: { color: '#ffd7a0', pow: 1150, k: 0.5, ringPow: 26, ringK: 0.22 },
      aboveHorizon: -2.2         // 圆盘中心还在地平线下这么多度时就已经"露头"（大气折射的手感值）
    },

    /* ---------- 月亮：位置由"与太阳的黄经差"推出，所以月相自动跟着盈亏 ---------- */
    MOON: {
      radiusDeg: 1.42,
      cycleDays: 8,              // 多少游戏日一个朔望周期（太长则一局里看不到盈亏变化）
      phaseStart: 0.18,          // 初始月相（0 = 朔，0.5 = 望）
      orbitInclDeg: 5.1,         // 相对太阳轨道面的倾角：让满月不必正好在太阳反方向上
      disc: { color: '#f6f2e4', edge: 0.05, mareColor: '#b9b8ad', mareK: 0.32, craterK: 0.16, mareScale: 3.4 },
      /* 月海/环形坑用方向噪声做，不引贴图：噪声频率与两种反照率都在这里 */
      glow: { color: '#c8d8ff', pow: 380, k: 0.16 },
      earthshineK: 0.12,         // 地照：暗面留一点可见度，新月才不像"消失"
      light: { color: '#a9c0ee', intK: 0.34, hemiK: 0.9, followMoon: true }
      /* 夜间的平行光真的对准月亮（弱光下与烘进顶点色的老影子不冲突） */
    },

    /* ---------- 星空 ---------- */
    STARS: {
      count: 1900,               // 质量档 high 的颗数（mid/low 见 QUALITY）
      magBias: 2.1,              // 星等分布：越大暗星越多（真实天空约 3 倍暗星/亮星）
      sizeRange: [1.5, 4.6],     // gl_PointSize 两端（设备像素，不随距离衰减）
      sizeCurve: 0.75,           // size 对星等的响应指数：1 = 线性；取 0.75 让中等星也看得见
      dimRange: [0.55, 1.0],     // 暗星/亮星的颜色下限（原来写死 0.35+0.65m，软件光栅下整片星空点不亮）
      colors: [
        { color: '#ffffff', weight: 0.30 },
        { color: '#c9d8ff', weight: 0.22 },
        { color: '#ffe9c9', weight: 0.18 },
        { color: '#ffd0b0', weight: 0.10 },
        { color: '#dbe6ff', weight: 0.20 }
      ],
      /* O/B 型偏蓝、M 型偏红：权重之和不必为 1，取按时归一 */
      twinkle: { k: 0.42, rateMin: 0.55, rateMax: 2.6, horizonFade: 0.22, brightTwinkleK: 1.4 },
      sizeK: 1.15,               // 点尺寸基准倍率（设备像素换算，见 js/atmos.js 的 pixelK）
      extinction: 0.36,          // 近地平线被大气吃掉多少（按 dir.y 衰减）
      poleFromOrbit: true,       // 星空绕天极转（真实周日运动），false = 钉死在世界坐标
      rotateK: 1.0,
      milky: {
        on: true, tiltDeg: 58, bandHalfDeg: 7.5, coreDeg: 26,
        k: 0.17, coreK: 0.9, color: '#a8bce8', warmColor: '#e8c8a8',
        dustK: 0.62, octaves: 4, lattice: 11, warp: 0.4, clump: 1.9
      }
      /* k 从 0.5 压到 0.17、密度再取 clump 次幂：0.5 那一版在 1100×640 上看着不是银河，是"夜里两团云" */
      /* 银河：沿一个倾斜大圆铺密度噪声 + 暗尘埃带；coreK 让一侧更亮（银心） */
    },

    /* ---------- 云：一张平铺噪声纹理同时喂天穹与地面云影，天上那朵和地上那片影必须同源 ---------- */
    CLOUD: {
      noise: { size: 256, seed: 20261017, lattice: [5, 11, 23], octaves: [4, 3, 2], gain: 0.52, bias: [0.5, 0.42, 0.62] },
      /* 三层噪声打进一张 RGBA 的 r/g/b；bias 用来把各层分布拉偏，免得三层云长得一样 */
      layers: [
        { name: 'cumulus', fadeK: 0.1, sel: [1, 0, 0, 0], altitude: 30, scale: 0.0135, driftK: 1.0, coverK: 1.0,
          edge: 0.20, lit: '#ffffff', dark: '#8a92ad', rimK: 0.62, opacityK: 1.0, minEl: 0.015, shadowK: 1.0 },
        { name: 'altostratus', fadeK: 0.16, sel: [0, 1, 0, 0], altitude: 54, scale: 0.026, driftK: 2.1, coverK: 0.74,
          edge: 0.30, lit: '#e9f0ff', dark: '#949fbc', rimK: 0.22, opacityK: 0.72, minEl: 0.05, shadowK: 0.30 },
        { name: 'cirrus', fadeK: 0.24, sel: [0, 0, 1, 0], altitude: 82, scale: 0.049, driftK: 3.4, coverK: 0.46,
          edge: 0.14, lit: '#f3f7ff', dark: '#aab5d0', rimK: 0.1, opacityK: 0.34, minEl: 0.13, shadowK: 0.05 }
      ],
      maxLayers: 3,              // 着色器里的固定容量（GLSL ES 1.0 循环必须常量边界），层数≤这条
      lighting: { sunLiftK: 0.9, counterSunK: 0.5, counterWidth: 0.35, nightK: 0.14, moonLitK: 0.5, flashK: 1.0,
        /* coreShadeK：云心比边缘暗多少（厚的云不透光，底面发灰）。写死在渲染层就没人改得动。 */
        coreShadeK: 0.62 },
      /* nightK：夜里云顶压到多暗（0.22 那一版夜空里云白得像刚晒过太阳）；moonLitK：月亮那侧给多少反光 */
      /* 云底压暗、云顶提亮；counterSun = 逆光时靠太阳一侧更亮（透光边缘）；flashK = 闪电把云内部点亮 */
      shadow: {
        cell: 2, lift: 0.35,      // 影布浮在"本地最高点"之上这么多：必须远低于眼睛高度（越肩相机眼高 ~1.3），
                                 // 否则它盖住的是天空而不是地面；埋进地形的风险由上面 sheetRaw 的 own 兜住
        layer: 0, contrast: 0.7,
        /* dark 是**影子本身的颜色**（显示空间 sRGB 三分量），不是乘法系数：
           影布用普通 alpha 叠合画（dst = mix(dst, dark, a)）。曾写成 [0.50,0.55,0.70] 当"压暗一半"用，
           结果在暗草地上开影反倒把地面**提亮**（回归 7 的 meanDrop 是负的），一眼看就是错的。 */
        dark: [0.09, 0.11, 0.19], minCover: 0.14, maxCover: 0.97, peakCover: 0.55,
        waterY: -2,                // 水面以下的影布停在这一格：埋进海床，不在空气里挂帆
        heightPasses: 1, heightSpan: 2,   // 影布高度场先模糊几次、每次往两侧看几格：影子只跟大尺度地形走，不跟台阶与树冠走
        parallaxK: 1.0, softSteps: 3, softRadius: 0.02, followAnchor: 40, updateEvery: 0.25
      }
      /* 地面那层"云影布"：cell = 每几格一个顶点，peakCover = 反差不等于云量而是在半阴半晴时最大
         （满天阴云只有均匀压暗，没有可辨认的影子），softSteps = 几次邻域取样把边界糊开 */
    },

    /* ---------- 降水：跟随相机的盒子，按区域天气强度逐个藏 ---------- */
    PRECIP: {
      kinds: {
        /* 雨丝比雾底暗：暴雨时天与雾都是灰白的，雨丝再写近白色就一条也看不见
           （回归里 dropsLive=920 却截图找不出一条，就是这么骗过眼睛的）。 */
        rain: { mode: 'streak', count: 920, len: 1.25, speed: 27, sway: 0.85, color: '#63809c', alpha: 0.66, jitter: 0.18 },
        hail: { mode: 'streak', count: 640, len: 0.55, speed: 40, sway: 0.42, color: '#b8c9dd', alpha: 0.8, jitter: 0.1, spin: 0.6 },
        /* 雪片也不能写纯白：下雪山地整片天与雾都是白的，纯白雪花等于没画（写成偏灰蓝才有轮廓） */
        snow: { mode: 'flakes', count: 760, size: 0.14, speed: 2.4, sway: 1.7, swayRate: 1.1, color: '#b9c8de', alpha: 0.95, drift: 0.9 }
      },
      box: { radius: 21, height: 20, below: 7, spawnAbove: 3 },
      /* below：相机下方还留几格（站在坑里也该看见雨）；spawnAbove：顶部再高一截，避免"雨从头顶凭空出现" */
      occlude: true,             // 头顶有屋顶就不下（用 world.colTop，一格都不多扫）
      windPushK: 1.0,            // 风向把雨丝推斜多少
      budget: { maxVerts: 3600, buildBudget: 900 }
    },

    /* ---------- 雾与能见度：群系基准 × 天气乘子 ---------- */
    FOG: {
      biomeFar: [150, 130, 112], // 与 main.js 老通路同一张表（三种群系），群系数变了就补几档
      nearK: 0.3,                // near = far × nearK（与老写法一致）
      skyBlend: 0.72,            // 雾色与地平线色混多少（0 = 用 fog 档原色，1 = 完全用地平线色）
      wetFarK: 0.62,             // 满强度降水时的雾距乘子
      fogFarK: 0.34,             // 浓雾满强度时的雾距乘子
      dustK: 0.5
    },

    /* ---------- 光照取样：按太阳仰角取一盏平行光 + 半球光 + 环境光 ---------- */
    LIGHT_KEYS: [
      { el: -60, sun: '#42557f', sunInt: 0.10, hemiSky: '#243254', hemiGround: '#171426', hemiInt: 0.30, amb: '#2a3350', ambInt: 0.17 },
      { el: -18, sun: '#3f5480', sunInt: 0.12, hemiSky: '#2a3a5e', hemiGround: '#191627', hemiInt: 0.31, amb: '#2b3552', ambInt: 0.17 },
      { el: -6, sun: '#6a6b92', sunInt: 0.20, hemiSky: '#3d4670', hemiGround: '#221d31', hemiInt: 0.42, amb: '#384060', ambInt: 0.18 },
      { el: -1.5, sun: '#ffab72', sunInt: 0.42, hemiSky: '#7d7a9c', hemiGround: '#3a2f3f', hemiInt: 0.56, amb: '#5a4a54', ambInt: 0.19 },
      { el: 3, sun: '#ffca9a', sunInt: 0.58, hemiSky: '#a8b8cc', hemiGround: '#43384a', hemiInt: 0.66, amb: '#6a6672', ambInt: 0.19 },
      { el: 12, sun: '#ffe4bd', sunInt: 0.72, hemiSky: '#c2dcee', hemiGround: '#48415e', hemiInt: 0.76, amb: '#8b8a95', ambInt: 0.18 },
      { el: 35, sun: '#fff2d0', sunInt: 0.82, hemiSky: '#cfe6ff', hemiGround: '#4a4360', hemiInt: 0.84, amb: '#ffffff', ambInt: 0.18 },
      { el: 90, sun: '#fff6e2', sunInt: 0.86, hemiSky: '#d8ecff', hemiGround: '#4a4360', hemiInt: 0.86, amb: '#ffffff', ambInt: 0.18 }
    ],
    LIGHT: {
      followSun: false,          // 白天的平行光是否真的跟着太阳走。false = 沿用 G.SUN_DIR（与烘进顶点色的影子同源）
      followMinEl: 6,            // 打开跟随时，仰角低于它就交回 G.SUN_DIR（贴地斜射会把南墙整个点亮）
      moonIntK: 1.0,
      nightAmbK: 1.0
    },

    /* ---------- 天气预设：一条 = 一种天气"长什么样 + 让世界变成什么样" ----------
       字段口径：
         cover      云量基准（0..1），乘到 CLOUD.layers[*].coverK 上；同时决定云影反差
         starsK / sunDiscK / moonDiscK   被云挡掉多少（0 = 完全看不见）
         precip     null 或 {kind, rate}；kind 必须是 PRECIP.kinds 里的一个
         wind       {speed, gust, turnDeg}：速度、阵风幅度、每次改向的最大转角
         light      {sunK, hemiK, ambK, tint:[r,g,b]} 乘/染在 LIGHT_KEYS 取到的值上
         颜色两种写法：hex = 单一固定色（渲染层解析）；[r,g,b] 三分量 = 需要跨气象区插值的色
         fog        {nearK, farK, skyK} 乘在 FOG 上；skyK = 雾色往天气色偏多少
         mods       **给未来机制层读的交互系数**（含义由读的一方定，本层与渲染层都不解释）
         flags      语义旗标，查 WEATHER.FLAG(name) 拿位
         rate       进场后强度的随机取值区间
         hold       在这种天气上停留多久（秒）
         biome      三种群系里的相对出现权重（顺序 = world.js 的 biomeNames） */
    WEATHERS: {
      clear: {
        cover: 0.06, starsK: 1, sunDiscK: 1, moonDiscK: 1, precip: null,
        wind: { speed: 1.1, gust: 0.35, turnDeg: 24 },
        light: { sunK: 1.0, hemiK: 1.0, ambK: 1.0, tint: [1, 1, 1] },
        fog: { nearK: 1.06, farK: 1.08, skyK: 0.1 },
        mods: { wetness: 0.0, chill: 0.0, windK: 0.08, conduct: 0.15, evapK: 1.18, burnK: 1.16, freezeK: 0.6, sparkK: 1.0, visibility: 1.08 },
        flags: ['bright', 'dry'], rate: [0.85, 1], hold: [42, 96], biome: [1, 1.4, 0.9]
      },
      fair: {
        cover: 0.34, starsK: 0.82, sunDiscK: 0.95, moonDiscK: 0.8, precip: null,
        wind: { speed: 2.4, gust: 0.7, turnDeg: 34 },
        light: { sunK: 0.96, hemiK: 1.02, ambK: 1.0, tint: [0.965, 0.980, 1.0] },
        fog: { nearK: 1.0, farK: 1.0, skyK: 0.18 },
        mods: { wetness: 0.04, chill: 0.0, windK: 0.28, conduct: 0.2, evapK: 1.02, burnK: 1.0, freezeK: 0.7, sparkK: 1.0, visibility: 1.0 },
        flags: ['dry'], rate: [0.7, 1], hold: [34, 78], biome: [1.3, 1, 1]
      },
      overcast: {
        cover: 0.72, starsK: 0.18, sunDiscK: 0.3, moonDiscK: 0.22, precip: null,
        wind: { speed: 2.0, gust: 0.8, turnDeg: 40 },
        light: { sunK: 0.56, hemiK: 1.06, ambK: 1.1, tint: [0.804, 0.839, 0.902] },
        fog: { nearK: 0.9, farK: 0.84, skyK: 0.5 },
        mods: { wetness: 0.16, chill: 0.08, windK: 0.24, conduct: 0.3, evapK: 0.72, burnK: 0.8, freezeK: 0.9, sparkK: 0.9, visibility: 0.86 },
        flags: ['dim', 'dry'], rate: [0.7, 1], hold: [30, 70], biome: [1, 0.7, 1.3]
      },
      fog: {
        cover: 0.9, layerK: [0.2, 1.0, 0.3], starsK: 0.05, sunDiscK: 0.08, moonDiscK: 0.06, precip: null,
        wind: { speed: 0.6, gust: 0.2, turnDeg: 16 },
        light: { sunK: 0.42, hemiK: 1.12, ambK: 1.2, tint: [0.784, 0.824, 0.878] },
        fog: { nearK: 0.34, farK: 0.34, skyK: 0.82 },
        mods: { wetness: 0.32, chill: 0.14, windK: 0.06, conduct: 0.34, evapK: 0.5, burnK: 0.6, freezeK: 1.1, sparkK: 0.8, visibility: 0.34 },
        flags: ['obscured', 'damp', 'dim'], rate: [0.75, 1], hold: [26, 62], biome: [1.2, 0.4, 1.6]
      },
      rain: {
        cover: 0.86, starsK: 0.06, sunDiscK: 0.16, moonDiscK: 0.12,
        precip: { kind: 'rain', rate: 0.62 },
        wind: { speed: 3.1, gust: 1.1, turnDeg: 46 },
        light: { sunK: 0.4, hemiK: 1.0, ambK: 1.14, tint: [0.663, 0.741, 0.831] },
        fog: { nearK: 0.7, farK: 0.62, skyK: 0.66 },
        mods: { wetness: 0.74, chill: 0.2, windK: 0.4, conduct: 0.6, evapK: 0.42, burnK: 0.34, freezeK: 0.5, sparkK: 0.7, visibility: 0.62 },
        flags: ['wet', 'dim'], rate: [0.6, 1], hold: [28, 64], biome: [1.3, 0.35, 1.1]
      },
      storm: {
        cover: 0.96, starsK: 0.0, sunDiscK: 0.05, moonDiscK: 0.04,
        precip: { kind: 'rain', rate: 1.0 },
        wind: { speed: 6.4, gust: 2.6, turnDeg: 70 },
        light: { sunK: 0.26, hemiK: 0.9, ambK: 1.16, tint: [0.561, 0.624, 0.745] },
        fog: { nearK: 0.56, farK: 0.46, skyK: 0.78 },
        mods: { wetness: 1.0, chill: 0.3, windK: 1.0, conduct: 1.0, evapK: 0.3, burnK: 0.16, freezeK: 0.44, sparkK: 1.5, visibility: 0.44 },
        flags: ['wet', 'windy', 'electric', 'dark'], rate: [0.78, 1], hold: [22, 54], biome: [1.1, 0.5, 0.9]
      },
      snow: {
        cover: 0.82, starsK: 0.1, sunDiscK: 0.2, moonDiscK: 0.16,
        precip: { kind: 'snow', rate: 0.66 },
        wind: { speed: 2.6, gust: 1.0, turnDeg: 42 },
        light: { sunK: 0.46, hemiK: 1.1, ambK: 1.2, tint: [0.788, 0.863, 0.941] },
        fog: { nearK: 0.66, farK: 0.56, skyK: 0.7 },
        mods: { wetness: 0.42, chill: 0.82, windK: 0.36, conduct: 0.24, evapK: 0.24, burnK: 0.42, freezeK: 1.5, sparkK: 0.7, visibility: 0.58 },
        flags: ['cold', 'snowing', 'dim'], rate: [0.6, 1], hold: [30, 66], biome: [0.7, 0.2, 2.2]
      },
      hail: {
        cover: 0.88, starsK: 0.04, sunDiscK: 0.12, moonDiscK: 0.1,
        precip: { kind: 'hail', rate: 0.7 },
        wind: { speed: 5.2, gust: 2.0, turnDeg: 62 },
        light: { sunK: 0.36, hemiK: 1.04, ambK: 1.12, tint: [0.718, 0.776, 0.863] },
        fog: { nearK: 0.62, farK: 0.52, skyK: 0.72 },
        mods: { wetness: 0.66, chill: 0.58, windK: 0.8, conduct: 0.6, evapK: 0.32, burnK: 0.26, freezeK: 1.2, sparkK: 1.2, visibility: 0.5 },
        flags: ['hailing', 'windy', 'cold', 'dim'], rate: [0.6, 1], hold: [16, 38], biome: [0.8, 0.5, 1.2]
      }
    },

    /* 元素交互词表：未来的"天气×元素魔法"只从这些名字里取数（读谁、读多少由机制层自己定）。
       tools/atmos_check.cjs 会反查：WEATHERS[*].mods 出现过的键必须全在这里，这里出现的键必须有人在表里给过值。 */
    MODS: ['wetness', 'chill', 'windK', 'conduct', 'evapK', 'burnK', 'freezeK', 'sparkK', 'visibility'],
    FLAGS: ['bright', 'dry', 'dim', 'obscured', 'damp', 'wet', 'windy', 'electric', 'dark', 'cold', 'snowing', 'hailing'],

    /* 转移权重：from → {to: 权重}。0 = 不去。留空的目标按 0 处理（不用写全 8×8）。 */
    TRANSITIONS: {
      clear: { clear: 5.5, fair: 3.2, overcast: 1.1, fog: 0.35, rain: 0.5, storm: 0.06, snow: 0.12, hail: 0.05 },
      fair: { fair: 4.6, clear: 3.0, overcast: 2.4, rain: 1.5, fog: 0.8, storm: 0.35, snow: 0.5, hail: 0.18 },
      overcast: { overcast: 4.2, fair: 2.6, clear: 1.0, rain: 2.0, fog: 1.2, storm: 0.7, snow: 0.9, hail: 0.3 },
      fog: { fog: 4.0, overcast: 2.4, fair: 1.0, clear: 0.5, rain: 0.9, storm: 0.2, snow: 0.7, hail: 0.1 },
      rain: { rain: 4.0, overcast: 2.4, fair: 1.0, storm: 1.4, clear: 0.35, fog: 0.7, hail: 0.5, snow: 0.5 },
      storm: { storm: 3.2, rain: 3.0, overcast: 1.6, hail: 0.9, fair: 0.6, clear: 0.15, fog: 0.25, snow: 0.2 },
      snow: { snow: 4.0, overcast: 2.2, fog: 1.2, rain: 0.9, hail: 0.6, fair: 0.7, clear: 0.3, storm: 0.2 },
      hail: { hail: 2.6, storm: 2.4, rain: 1.8, overcast: 1.4, fair: 0.5, clear: 0.15, snow: 0.5, fog: 0.2 }
    },
    START_WEIGHTS: { clear: 4, fair: 4, overcast: 2.4, fog: 1.2, rain: 1.6, storm: 0.5, snow: 1.2, hail: 0.4 },

    /* ---------- 天气分区（"在哪块地方是什么天气"的那个"块"） ---------- */
    REGIONS: {
      cell: 16,                  // 一格区 = 16×16 世界格（与 chunk 同宽，一条区界线不多不少）
      easeSec: [8, 20],          // 两种天气之间过渡多久（云慢慢厚起来、雨慢慢大起来）
      windEase: 0.28,            // 风速/风向每秒钟的跟随比例
      coverEase: 0.22,
      sample: { interpolate: 'bilinear', edgeClamp: true },
      budget: { perStep: 12, wheel: 4 },
      /* perStep：每次 step(dt) 最多推进多少个区（区数超过这条就靠 wheel 分帧轮转，不存在"某帧全图刷一遍"） */
      lightning: { every: [1.6, 6.5], minIntensity: 0.55, minCover: 0.7, boltY: 26, jitter: 6, flashDecay: 0.14, doubleK: 0.4 }
    },

    /* ---------- 质量档与硬预算（自动化环境是软件光栅，绝对帧率不当真机指标，但预算必须钉住） ---------- */
    QUALITY: {
      high: { stars: 1900, rainK: 1, cloudLayers: 3, shadowCells: 2, milky: true, twinkle: true },
      mid: { stars: 1100, rainK: 0.65, cloudLayers: 2, shadowCells: 3, milky: true, twinkle: true },
      low: { stars: 520, rainK: 0.38, cloudLayers: 1, shadowCells: 4, milky: false, twinkle: false }
    },
    MESH: { domeSegments: [40, 20], domeRadius: 168, starRadius: 150 },
    /* domeRadius / starRadius 必须 < camera far（OTSCamera 260），否则天穹被远平面裁掉 */

    /* ---------- 默认渲染参数（存 localStorage.gw.atmos；null = 跟随 match 的昼夜） ---------- */
    DEFAULTS: {
      on: true, stars: true, moon: true, clouds: true, cloudShadow: true,
      precip: true, lightning: true, quality: 'high',
      skyK: 1, cloudK: 1, shadowK: 1, precipK: 1, phase: null, anchorK: 0.75
    },
    BOOLS: ['on', 'stars', 'moon', 'clouds', 'cloudShadow', 'precip', 'lightning'],
    RANGES: { skyK: [0.4, 1.6], cloudK: [0, 1.6], shadowK: [0, 1.6], precipK: [0, 1.6], anchorK: [0, 1] },
    PHASES: ['high', 'mid', 'low']
  };
})(window.GW);
