/* ================= GW.ATMOS（大气层·渲染层） =================
   把"天"画出来：太阳与月亮（含盈亏）、星空与银河、三层云、地面云影、雨雪雹、闪电，
   外加跟着太阳走的雾色/雾距与三盏灯的色温。全部数字来自 js/atmos-data.js；
   天气状态来自 js/weather.js（本层只读不写，也不解释 mods 的含义）。

   分层（照 js/vfx-render.js / js/shader.js 同一条口径，机检在 tools/layer_check.cjs）：
     · 零 DOM：只有两张贴图用 document.createElement('canvas') 画，那是这层的本职
     · 零玩家可见文案：给 UI 的一律 key + 数字（spec() / readout()），中文只能进 js/hud.js 的 H.TEXT
     · 零反向依赖：不认识 HUD / Creative / 实体；scene、lights、world、match、锚点由 main.js 递进来
     · 动画量一律是**速度的积分**（云漂移、雨落下）或**权威相位的纯函数**（星空周日运动），
       不拿 match.time 乘系数——20Hz 的 tick 会把连续运动量化成一顿一顿

   两条硬口径：
     ① "关掉大气层 == 现状"必须可机检：tools/atmos_check.cjs 第 1 项把 index.html 里本层的三行
        script 剥掉当基线，与 G.ATMOS.set('on',false) 的画面逐像素比。所以关掉时本层一律不动，
        主循环走 js/main.js 里**原封保留**的 dayNight() 老通路，本层也不许改老通路的任何一个数。
     ② 建立失败（着色器编译不过、Canvas 拿不到）→ broken=true，永久不接管，游戏照常能玩
        （与 js/shader.js 的 broken 同路：宁可没有大气，不能没有游戏）。

   与烘进顶点色的老影子（js/world.js 的 sunVis）：那条固定用 G.SUN_DIR，本层不改它，也不每帧挪它
   （挪一次就要重建全部 chunk）。所以白天的平行光默认仍钉在 G.SUN_DIR（ATMOS_DATA.LIGHT.followSun
   = false），免得"灯从东打、顶点色影子按西算"；夜里那盏交给月亮（弱光下与老影子不冲突）。
   想让白天的灯真的跟太阳走：ATMOS.set('followSun', true)，atmos_check 两种模式都量。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var D = G.ATMOS_DATA;
  if (!D) { if (window.console) console.warn('[大气] 缺 js/atmos-data.js，大气层不启动'); return; }
  var RAD = Math.PI / 180, KEY = 'gw.atmos';

  /* ---------- 参数（存 localStorage.gw.atmos；默认值来自配方层 DEFAULTS） ---------- */
  var P = {};
  for (var k0 in D.DEFAULTS) P[k0] = D.DEFAULTS[k0];
  try {
    if (window.localStorage) {
      var saved = localStorage.getItem(KEY);
      if (saved) { var o = JSON.parse(saved); for (var k1 in D.DEFAULTS) if (o[k1] !== undefined) P[k1] = o[k1]; }
    }
  } catch (e) { }
  function persist() { try { if (window.localStorage) localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { } }

  var ctx = null, attached = false, broken = false, hooked = false;
  var A = { dome: null, stars: null, sheet: null, drop: null, cloudTex: null, flakeTex: null };
  var sample = null, clock = 0, flash = 0, sheetT = 99, lastQuality = '';
  var anchorPt = { x: 48, y: 20, z: 48 };
  var cloudScroll = [[0, 0], [0, 0], [0, 0]];
  var state = { phase: 0, dayCount: 0, sunEl: 0, moonEl: 0, moonAge: 0, night: 0, cover: 0, starsK: 1 };
  var stats = { frames: 0, taken: 0, drops: 0, flashes: 0, skyCalls: 0 };

  /* ---------- 小工具 ---------- */
  var colCache = {};
  function C(hex) { if (!colCache[hex]) colCache[hex] = new THREE.Color(hex); return colCache[hex]; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / ((b - a) || 1e-6), 0, 1); return t * t * (3 - 2 * t); }
  function vn(v, key, dflt) { var x = v && v[key]; return typeof x === 'number' ? x : dflt; }
  /* 取样表的两个相邻档：表按 el 升序（attach 时排一次），端点外就停住不 extrapolate */
  var _bk = { lo: null, hi: null, t: 0 };
  function bracket(keys, el) {
    var i = 1;
    while (i < keys.length - 1 && keys[i].el < el) i++;
    var lo = keys[Math.max(0, i - 1)], hi = keys[i];
    _bk.lo = lo; _bk.hi = hi;
    _bk.t = hi === lo ? 0 : clamp((el - lo.el) / ((hi.el - lo.el) || 1), 0, 1);
    return _bk;
  }
  function pickColor(target, keys, el, field) {
    var b = bracket(keys, el);
    target.copy(C(b.lo[field]));
    if (b.t > 0) target.lerp(C(b.hi[field]), b.t);
    return target;
  }
  function pickNum(keys, el, field) {
    var b = bracket(keys, el);
    return lerp(b.lo[field] === undefined ? 0 : b.lo[field], b.hi[field] === undefined ? 0 : b.hi[field], b.t);
  }
  function scaleColor(target, c, r, g, b) {
    target.setRGB(c.r * r, c.g * g, c.b * b);
    return target;
  }

  /* ---------- 天体位置：真实天文公式，参数只有 ORBIT 那五个 ---------- */
  var _sun = new THREE.Vector3(0, 1, 0), _moon = new THREE.Vector3(0, 1, 0);
  /* 同一条轨道公式，只换时角与赤纬：太阳用 H，月亮用 H − 2π·月龄。
     满月（月龄 0.5）时角差 π ⇒ "午夜时月亮在正南最高"自动成立。
     原来我把月亮的仰角直接抄太阳的，于是夜里月亮也一定在地下（月光那盏灯白挂）。
     明暗界线在片元里由 dot(视线, 太阳方向) 算 ⇒ 月相是几何量，不是挑三张贴图。 */
  function orbitDir(H, dec, lat, out) {
    var sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    var el = Math.asin(clamp(sinEl, -1, 1));
    var cosAz = (Math.sin(dec) - sinEl * Math.sin(lat)) / Math.max(1e-4, Math.cos(el) * Math.cos(lat));
    var az = Math.acos(clamp(cosAz, -1, 1));
    if (Math.sin(H) > 0) az = Math.PI * 2 - az;                       // 过正午后转向"西"
    az += D.ORBIT.azimuthOffsetDeg * RAD;
    var ce = Math.cos(el);
    out.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);
    return el;
  }
  function bodyDirs(phase, dayCount) {
    var O = D.ORBIT;
    var dec = O.declinationDeg * RAD * Math.sin(Math.PI * 2 * dayCount / Math.max(1, O.seasonDays));
    var lat = O.latitudeDeg * RAD;
    var H = Math.PI * 2 * (phase - O.noonPhase);
    orbitDir(H, dec, lat, _sun);
    var age = (dayCount / Math.max(1, D.MOON.cycleDays) + D.MOON.phaseStart) % 1;
    orbitDir(H - Math.PI * 2 * age, dec + D.MOON.orbitInclDeg * RAD * Math.sin(Math.PI * 2 * age), lat, _moon);
    state.moonAge = age;
  }
  function poleAxis(out) {
    var O = D.ORBIT, alt = O.latitudeDeg * RAD, az = O.azimuthOffsetDeg * RAD, ca = Math.cos(alt);
    return out.set(Math.sin(az) * ca, Math.sin(alt), Math.cos(az) * ca).normalize();
  }
  /* 银道面法线：由天极倾 tiltDeg 得到。**星星聚集与天穹那条银河必须用同一个轴**——
     原先星星按天极聚集、银河按倾过的轴画，两条带子各在各方，夜空看着就是"星与河对不上、转起来也不一起"。 */
  function galaxyAxis(out) {
    var MK = D.STARS.milky, gt = Math.sin(MK.tiltDeg * RAD), p = poleAxis(_pole);
    return out.set(p.x + gt * 0.6, p.y * (1 - gt * 0.35), p.z + gt * 0.4).normalize();
  }
  var _pole = new THREE.Vector3(), _gal = new THREE.Vector3(), _galBase = new THREE.Vector3();

  /* ---------- 程序化贴图：一张平铺噪声同时喂天穹的云与地面云影（同源才不会"天上一朵、地上一片"对不上） ---------- */
  function makeCloudNoise() {
    var N = D.CLOUD.noise, n = N.size, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    var g = cv.getContext('2d'), img = g.createImageData(n, n), px = img.data, ch, x, y, i4;
    function hash(ix, iy, cell) {
      var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(cell, 2246822519)) | 0;
      h = h ^ (h >>> 13); h = Math.imul(h, 1274126177); h = h ^ (h >>> 16);
      return (h >>> 0) / 4294967296;
    }
    function vn2(x, y, per, cell) {                        // 周期 = per ⇒ 边缘无缝，可以 RepeatWrapping 平铺
      var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      var w = function (v) { return ((v % per) + per) % per; };
      return lerp(lerp(hash(w(ix), w(iy), cell), hash(w(ix + 1), w(iy), cell), sx),
                  lerp(hash(w(ix), w(iy + 1), cell), hash(w(ix + 1), w(iy + 1), cell), sx), sy);
    }
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
      i4 = (y * n + x) * 4;
      for (ch = 0; ch < 3; ch++) {
        var sum = 0, amp = 1, freq = N.lattice[ch], norm = 0, oc = Math.max(1, N.octaves[ch] || 1);
        for (var t = 0; t < oc; t++) {
          sum += vn2(x / n * freq, y / n * freq, freq, ch * 7 + t) * amp;
          norm += amp; amp *= N.gain; freq *= 2;
        }
        var v0 = sum / norm;
        px[i4 + ch] = Math.round(clamp(Math.pow(clamp((v0 - 0.5) * 2 * (N.bias[ch] || 0.5) + 0.5, 0, 1), 1), 0, 1) * 255);
      }
      /* A 通道 = 高频细节噪声：云在体积步进里同一次取样就能多拿到一个"细节"自由度，
         不会因为只有一个通道而在高云量（storm 0.96）时糊成一整片纯色。
         步进时读一次 texture2D 就把 shape(R/G/B 之一) 与 detail(A) 一起拿到。 */
      var det = 0, da = 1, df0 = Math.max(2, Math.round(N.detail.lattice)), dn = 0;
      for (var od = 0; od < Math.max(1, N.detail.octaves || 1); od++) {
        det += vn2(x / n * df0, y / n * df0, df0, 11 + od) * da; dn += da; da *= N.detail.gain; df0 *= 2;
      }
      px[i4 + 3] = Math.round(clamp(det / dn, 0, 1) * 255);
    }
    g.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }
  function makeFlake() {
    var s = 32, cv = document.createElement('canvas'); cv.width = cv.height = s;
    var g = cv.getContext('2d');
    var rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    return tex;
  }

  /* ---------- 着色器 ----------
     天穹一层几何一次绘制算完"渐变 + 日落暖带 + 日/月圆盘与光晕 + 银河 + 三层云"。
     云用平面平行投影 uv = d.xz · altitude / d.y：贴地的云自然被压到地平线附近、天顶那团被拉大，
     这就是真实天空里"远处密、头顶疏"的来源，不需要真体积，也不需要第二层几何。 */
  var SKY_VS = [
    'varying vec3 vDir;',
    'void main(){',
    '  vDir = normalize(position);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');
  var SKY_FS = [
    'precision highp float;',
    'varying vec3 vDir;',
    'uniform vec3 uZenith, uHorizon, uGround, uTint, uSunsetCol, uStarlightCol;',
    'uniform vec3 uMilkyCol, uMilkyWarmCol, uSunCol, uSunGlowCol, uMoonCol, uMoonMareCol, uMoonGlowCol;',
    'uniform vec3 uGalAxis, uSunDir, uMoonDir;',
    'uniform float uHorizonPow, uGroundFade, uSunsetK, uSunsetElW, uSunsetAzPow, uSunsetGate;',
    'uniform float uSunRad, uSunEdge, uSunDiscK, uSunGlowK, uSunGlowPow, uSunHaloK, uSunHaloPow;',
    'uniform float uMoonRad, uMoonEdge, uMoonK, uMoonMareK, uMoonMareScale, uMoonGlowK, uMoonGlowPow, uEarthshineK, uMoonUp;',
    'uniform float uNight, uMilkyK, uMilkyBand, uMilkyDust, uMilkyWarp, uMilkyScale, uMilkyClump, uStarlightK, uCoverAll;',
    'uniform float uCloudNightK, uMoonLitK;',
    'uniform float uFlash, uFlashScale;',
    'uniform sampler2D uCloudTex;',
    'uniform vec4 uLSel[3], uLA[3], uLB[3], uLC[3];',
    'uniform vec3 uLit[3], uDark[3];',
    'uniform vec2 uScroll[3];',
    'uniform vec2 uCamXZ;',
    'uniform float uCamY;',
    'uniform vec4 uCloudCfg;    // x=抖动 y=空列预检的云量门限 z=最远步进距离 w=云底软边（源自 CLOUD.render）',
    'uniform vec4 uCloudTune;   // x=粉状自阴影 y=逆光银边 z=云底环境亮度 w=不透明度乘子（源自 CLOUD.lighting）',
    'uniform float uCloudDetailK;  // 贴图 A 通道的高频细节在密度里占多少（CLOUD.lighting.detailK）',
    'uniform float uCloudCoverDim;  // 云量越大、云底越暗多少（整层阴云挡掉天光，CLOUD.lighting.coverDimK）',
    'float hash31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
    'float vn3(vec3 p){',
    '  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y);',
    '  float b = mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y);',
    '  return mix(a, b, f.z);',
    '}',
    'void main(){',
    /* 方向直接用插值后的 vDir：球面顶点已是单位向量，插值只短 ~1%，再 normalize 一次
       （sqrt+3 次除法）在软件光栅上就是每像素几纳秒，600k 像素 = 好几毫秒 */
    '  vec3 d = vDir;',
    '  float up = d.y;',
    '  vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), uHorizonPow));',
    '  col = mix(col, uGround, clamp(-up / max(0.02, uGroundFade), 0.0, 1.0));',
    '  float ds = dot(d, uSunDir);',
    /* 日落暖带：只在太阳贴地那几分钟出现，方位上围着太阳收。
       用 exp+pow 而不是 Rayleigh/Mie 积分——像素风不值那个钱，观感上足够"傍晚是傍晚"。 */
    '  float band = exp(-abs(up) / max(0.02, uSunsetElW)) * pow(max(ds, 0.0), uSunsetAzPow) * uSunsetGate;',
    '  col = mix(col, col + uSunsetCol, clamp(band * uSunsetK, 0.0, 1.0));',
    '  col += uSunGlowCol * pow(max(ds, 0.0), uSunGlowPow) * uSunGlowK;',
    '  col += uSunGlowCol * pow(max(ds, 0.0), uSunHaloPow) * uSunHaloK;',
    '  col += uStarlightCol * uStarlightK * uNight * clamp(up + 0.15, 0.0, 1.0);',
    /* 银河：绕天极倾斜的大圆带 + 密度噪声 + 暗尘埃带，一侧更亮（银心） */
    '  if (uMilkyK > 0.001 && up > -0.02) {',
    '    float gp = abs(dot(d, uGalAxis));',
    '    float bandm = 1.0 - smoothstep(uMilkyBand * 0.35, uMilkyBand, gp);',
    '    float warp = (vn3(d * uMilkyScale) - 0.5) * uMilkyWarp;',
    '    float dens = vn3(d * (uMilkyScale * 2.7) + vec3(warp)) * 0.65 + vn3(d * (uMilkyScale * 6.3)) * 0.35;',
    '    dens = pow(clamp(dens, 0.0, 1.0), uMilkyClump);',
    '    float core = pow(max(dot(d, vec3(uGalAxis.z, -uGalAxis.x, uGalAxis.y)), 0.0), 2.0);',
    '    float dust = 1.0 - uMilkyDust * smoothstep(0.35, 0.75, vn3(d * (uMilkyScale * 4.1)));',
    '    col += mix(uMilkyCol, uMilkyWarmCol, core) * bandm * dens * dust * uMilkyK * uNight;',
    '  }',
    /* ---------- 三层云：体积步进（低层积云 / 高层卷云 / 中层高层云） ----------
       uLA[i] = (采样密度, 阈值软边, 不透明度乘子, 该层有效云量)；云端有效云量为 0 ⇒ 整层跳过。
       "体积感"来自三处，都不额外取样：
         ① 每层是一块平板 [云底, 云顶]，沿视线按 QUALITY.cloudSteps 分档步进 ⇒ Beer-Lambert 逐样本累乘，
            云心自己变暗、云边薄而亮（这才是"有厚度的云"而不是贴图色块）
         ② 密度噪声在 (世界 xz) 上取样，再按层内高度 h 沿噪声自身的两个轴偏移（uLC[i].z）
            ⇒ 同一条视线上的样本互不相关，等于在 2D 噪声里"切出"第三维，纹理是现成的、取一次就够
         ③ 光照：云底暗云顶亮 + 厚处自阴影（粉状散射）+ 逆光银边 + 夜里压暗 + 月光侧微亮 + 闪电从云内点亮
       云底/云顶/厚度/步数/消光/风 全来自 ATMOS_DATA.CLOUD（本层只做插值与打包）。 */
    /* 闪电：云内已经被逐样本点亮；这里再给整片天空一点闪光（打雷时"天地一亮"） */
    '  if (uFlash > 0.001) col += vec3(0.82, 0.88, 1.0) * uFlash * uFlashScale * 0.22 * smoothstep(0.0, 0.2, up);',
    '  col = mix(col, mix(col, uTint, 0.66), clamp(uCoverAll, 0.0, 1.0) * 0.30);',
    /* 日/月圆盘：角度距离 + 软边；圆盘本体顶到 bloom 阈值之上，光晕交给 js/shader.js 捞 */
    '  float angS = acos(clamp(ds, -1.0, 1.0));',
    '  col += uSunCol * (1.0 - smoothstep(uSunRad * (1.0 - uSunEdge), uSunRad * (1.0 + uSunEdge), angS)) * uSunDiscK;',
    '  float dm = dot(d, uMoonDir);',
    '  float angM = acos(clamp(dm, -1.0, 1.0));',
    '  float mdisc = 1.0 - smoothstep(uMoonRad * (1.0 - uMoonEdge), uMoonRad * (1.0 + uMoonEdge), angM);',
    '  if (mdisc > 0.001) {',
    /* 明暗界线：把视线投到"垂直于月心连线"的切平面上，被照的一侧由 dot(视线, 太阳) 决定 ⇒ 月相是几何量 */
    '    vec3 m = normalize(uMoonDir);',
    '    vec3 s = normalize(uSunDir);',
    '    float mu = dot(s, m);',
    '    vec3 perp = s - m * mu;',
    '    float pl = length(perp);',
    '    vec3 sh = pl > 1e-4 ? perp / pl : vec3(0.0, 1.0, 0.0);',
    '    float u = clamp(dot(d - m * dm, sh) / max(1e-4, uMoonRad), -1.6, 1.6);',
    /* 近侧面的法线是 -m（朝向观测者），所以被照的一侧是 u > +mu，不是 u > -mu：
       写成 u + mu 时满月整面全黑、朔月反倒发亮（两条判据同时红，是最直白的反向信号）。 */
    '    float lit = smoothstep(-0.08, 0.08, u - mu);',
    '    float mare = smoothstep(0.44, 0.62, vn3(m * uMoonMareScale)) * uMoonMareK;',
    '    float crater = (vn3(m * (uMoonMareScale * 5.3)) - 0.5) * 0.16;',
    '    vec3 mc = (mix(uMoonCol, uMoonMareCol, mare) * (1.0 + crater)) * mix(0.10, 1.0, lit) + uMoonCol * uEarthshineK * (1.0 - lit);',
    '    col += mc * mdisc * uMoonK;',
    '  }',
    '  col += uMoonGlowCol * pow(max(dm, 0.0), uMoonGlowPow) * uMoonGlowK * uMoonUp;',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');


  /* 云单独一层几何（不是天穹那一趟）：天穹先画（无深度测试，画在最里面），
     这层云**带深度测试**、排在所有不透明几何之后、其它透明物之前 ⇒
     被地形/树冠挡住的像素一个片段都不跑（实测正午越肩那一档，天空只占屏面 ~35%）。
     好处不止性能：太阳/月亮现在会被云真的挡住，而不是反过来盖在云上。 */
  var CLOUD_VS = [
    'varying vec3 vDir;',
    'void main(){',
    '  vDir = normalize(position);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');
  var CLOUD_FS = [
    'precision highp float;',
    'varying vec3 vDir;',
    'uniform vec3 uHorizon, uTint, uSunDir, uMoonDir, uSunGlowCol, uMoonGlowCol;',
    'uniform float uNight, uCloudNightK, uMoonLitK, uFlash, uFlashScale;',
    'uniform sampler2D uCloudTex;',
    'uniform vec4 uLSel[3], uLA[3], uLB[3], uLC[3];',
    'uniform vec3 uLit[3], uDark[3];',
    'uniform vec2 uScroll[3];',
    'uniform vec2 uCamXZ;',
    'uniform float uCamY;',
    'uniform vec4 uCloudCfg;',
    'uniform vec4 uCloudTune;',
    'uniform float uCloudDetailK;',
    'uniform float uCloudCoverDim;',
    'uniform float uCloudHorizonK;',
    'float hash31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
    'void main(){',
    '  vec3 d = normalize(vDir);',
    '  float up = d.y;',
    /* 地平线以下不画。**必须用 discard**：去掉它之后软件光栅不再提前做深度测试，
       被地形挡住的像素全部白跑（实测 pitch0.5 那档 41→44ms、"低头看地"那档 24→38ms）。 */
    '  if (up <= 0.004) discard;',
    '  float ds = dot(d, uSunDir);',
'  vec3 cloudCol = vec3(0.0);',
'  float skyT = 1.0;',
/* 每像素只算一次的量（原先写在取样循环里：8~10 次 pow / exp 白烧）。
   phase = 视线朝太阳的前向散射；jit = 廉价抖动（不用 sin，那是软件光栅上最贵的一条） */
/* 整数次幂一律用自乘（pow 在软件光栅上是几十个周期，这一条就值好几毫秒）：
   ss^8 = ((ss^2)^2)^2，ss^14 = ss^8 · ss^4 · ss^2 */
'  float ss = max(ds, 0.0);',
'  float ss2 = ss * ss, ss4 = ss2 * ss2, ss8 = ss4 * ss4;',
'  float phaseS = ss8 * uCloudTune.y;',
'  float sunUp = clamp(uSunDir.y, 0.0, 1.0);',
'  float moonUp = clamp(uMoonDir.y, 0.0, 1.0);',
'  float jitPx = fract(gl_FragCoord.x * 0.7548776662 + gl_FragCoord.y * 0.56984029);',
'  float nightK = mix(1.0, uCloudNightK, uNight);',
'  vec3 tintMix = mix(vec3(1.0), uTint, 0.28);',
'  float sunSheen = ss8 * ss4 * ss2;',
'  for (int i = 0; i < 3; i++) {',
'    float cov = uLA[i].w;',
'    if (cov <= 0.002 || up <= 0.004 || skyT < 0.02) continue;',
'    float cbase = uLB[i].y, ctop = uLB[i].z, cthick = max(0.6, ctop - cbase);',
/* 平板相交：相机在云下/云中/云上都要对（云高是世界绝对高度，飞上去会真的穿进云里） */
'    float t0 = 0.0, t1 = -1.0;',
'    if (abs(d.y) > 1e-4) {',
'      float ta = (cbase - uCamY) / d.y, tb = (ctop - uCamY) / d.y;',
'      t0 = max(0.0, min(ta, tb)); t1 = min(uCloudCfg.z, max(ta, tb));',
'    }',
'    if (t1 <= t0 + 0.02) continue;',
'    float steps = clamp(uLC[i].x, 1.0, 12.0);',
'    float stepLen = (t1 - t0) / steps;',
/* cov = "盖住多少百分比的天" ⇒ 阈值是 1−cov。写成 cov 自己时 storm(0.96) 一朵云都不出，
   而 clear(0.06) 反而满天都是——这个反向错误肉眼看起来只是"今天没云"，最难发现。 */
'    float thr = 1.0 - clamp(cov, 0.0, 1.0);',
'    float edge = max(0.004, uLA[i].y);',
/* 各向异性：卷云沿一个方向拉成丝（stretch<1），积云是各向同性的团 */
'    vec2 uvScale = vec2(uLA[i].x * max(0.02, uLC[i].w), uLA[i].x);',
'    float fade = smoothstep(0.0, max(0.02, uLB[i].x), up);',
/* 抖动起点：固定步长会在云上留下同心"年轮"，按像素错半格就散成噪声 */
/* 空列预检：云量不大时先在 slab 中段取一刀，这一列根本没云就整层跳过
   （fair 那种天 ~2/3 的天空像素在这里省掉全部步进；阴天人人有云，预检纯亏，所以按云量开关） */
'    if (cov < uCloudCfg.y) {',
'      vec2 uvPre = (uCamXZ + d.xz * ((t0 + t1) * 0.5) + uScroll[i] + vec2(uLC[i].z * 0.5, uLC[i].z * 0.31)) * uvScale;',
'      if (dot(texture2D(uCloudTex, uvPre), uLSel[i]) < thr - edge * 1.6) continue;',
'    }',
'    float jit = fract(jitPx + float(i) * 0.37) * uCloudCfg.x;',
'    for (int s = 0; s < 12; s++) {',
'      if (float(s) >= steps || skyT < 0.02) break;',
'      float t = t0 + stepLen * (float(s) + jit);',
'      float h = clamp((uCamY + d.y * t - cbase) / cthick, 0.0, 1.0);',
/* 竖直剖面：平坦的云底（积云压着凝结高度）+ 蓬松的顶（uCloudCfg.w = 云底软边） */
'      float prof = smoothstep(0.0, uCloudCfg.w, h) * (1.0 - smoothstep(0.72, 1.0, h));',
/* 高度剪切：像素坐标先按**世界格**偏移，再统一乘采样密度（写成纹理单位时 1.6 相当于把云
   沿对角线拉出去 100 多格 ⇒ 云会糊成一条条长丝，实测第一版就是这么"没有一块云"的） */
'      vec2 wp = uCamXZ + d.xz * t + uScroll[i] + vec2(uLC[i].z * h, uLC[i].z * h * 0.62);',
'      vec2 uv = wp * uvScale;',
'      vec4 texel = texture2D(uCloudTex, uv);',
'      float n = dot(texel, uLSel[i]);',
/* shape = 轮廓（软边，cov 决定阈值）；core = "比阈值厚多少"，给云心真正的厚度差；
   det = 贴图 A 通道的高频细节 ⇒ storm(0.96) 那种满天云仍有纹理而不是一块纯灰。 */
'      float shape = smoothstep(thr - edge, thr + edge, n);',
'      float core = clamp((n - thr) / max(0.05, 1.0 - thr), 0.0, 1.0);',
'      float dens = shape * prof * mix(0.55, 1.0, core) * mix(1.0, texel.a * 1.35, uCloudDetailK);',
'      if (dens <= 0.003) continue;',
'      float a = (1.0 - exp(-dens * uLC[i].y * stepLen)) * uCloudTune.w;',
/* 云内光照（不额外取样，全靠这一趟步进已经拿到的东西）：
   ① 垂直光程：从云顶到当前样本的厚度用**本地密度**近似 ⇒ 云心与云底自然变暗、云顶边缘亮；
      太阳越低这个光程越长（sunUp），日落时云会整体压暗
   ② 粉状散射（powderK）：厚核再压一层，薄边更透
   ③ 逆光银边（phaseK）：视线朝太阳时，靠太阳那侧的薄边透出暖白 */
/* 每样本只留一次 exp：垂直光程（从云顶到当前样本）用本地密度近似 ⇒ 云心与云底自然变暗、
   云顶边缘亮；powder（粉状散射）直接乘进光程，省掉一次 exp。 */
'      float tau = dens * max(0.0, ctop - (uCamY + d.y * t)) * uLC[i].y',
'                * (0.35 + 1.1 * sunUp) * (1.0 + uCloudTune.x * dens);',
'      float sunT = exp(-tau);',
/* 环境项（uDark = 被天光照亮的云体本身，云底也有一层，只是比云顶暗）+ 直射项（太阳透过多少云）。
   写成相加而不是 mix(dark, lit, ...)：mix 会把云底压到"几乎全黑"，而真实的阴天云底是**灰白**的天花板。 */
'      float ambK = uCloudTune.z + (1.0 - uCloudTune.z) * h;',
'      float coverDim = 1.0 - uCloudCoverDim * smoothstep(0.55, 0.98, cov);',
'      vec3 cc = (uDark[i] * ambK + uLit[i] * min(1.0, sunT * (0.55 + 0.45 * sunUp) * (1.0 + 0.35 * phaseS))) * coverDim;',
'      cc += uSunGlowCol * sunSheen * uLB[i].w * nightK;',
'      cc += uMoonGlowCol * uMoonLitK * uNight * moonUp * (0.35 + 0.65 * h);',
'      cc += vec3(0.82, 0.88, 1.0) * uFlash * uFlashScale * dens * 1.8;',
'      cc *= tintMix * nightK;',
/* 地平线淡出：远处的云融进那条地平线色里（不然云板会像一张挂到天边的桌布） */
'      float farF = clamp(t / uCloudCfg.z, 0.0, 1.0);',
'      cc = mix(cc, uHorizon, farF * farF * uCloudHorizonK);',
'      float srcA = clamp(a * fade * uLA[i].z, 0.0, 1.0);',
'      cloudCol += skyT * srcA * cc;',
'      skyT *= 1.0 - srcA;',
'    }',
'  }',
    '  float a = 1.0 - skyT;',
    '  if (a <= 0.004) discard;',
    '  gl_FragColor = vec4(cloudCol / max(a, 1e-4), a);',
    '}'
  ].join('\n');

  var STAR_VS = [
    'attribute float aSize, aMag, aPhase, aRate;',
    'attribute vec3 aColor;',
    'uniform float uTime, uNight, uCoverK, uTwinkleK, uHorizFade, uPixelK;',
    'varying vec3 vCol; varying float vA;',
    'void main(){',
    '  vec3 dn = normalize(position);',
    '  float tw = 1.0 + uTwinkleK * sin(uTime * aRate + aPhase) * (0.35 + 0.65 * aMag);',
    '  vA = uNight * uCoverK * smoothstep(0.0, uHorizFade, dn.y) * clamp(tw, 0.15, 2.0);',
    '  vCol = aColor;',
    '  gl_PointSize = max(0.6, aSize * clamp(tw, 0.2, 1.9) * uPixelK);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');
  var STAR_FS = [
    'precision highp float;',
    'varying vec3 vCol; varying float vA;',
    'void main(){',
    '  vec2 q = gl_PointCoord - 0.5;',
    '  float a = smoothstep(0.5, 0.08, length(q));',
    '  float spike = max(0.0, 1.0 - abs(q.x) * 9.0) * max(0.0, 1.0 - abs(q.y) * 2.2)',
    '              + max(0.0, 1.0 - abs(q.y) * 9.0) * max(0.0, 1.0 - abs(q.x) * 2.2);',
    '  gl_FragColor = vec4(vCol, clamp(a + spike * 0.25, 0.0, 1.0) * vA);',
    '}'
  ].join('\n');

  var SHEET_VS = [
    'varying vec2 vW;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vW = wp.xz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');
  var SHEET_FS = [
    'precision highp float;',
    'varying vec2 vW;',
    'uniform sampler2D uCloudTex;',
    'uniform vec4 uSel;',
    'uniform float uScale, uContrast, uAmt, uSoftR;',
    'uniform vec2 uScroll;',
    'uniform vec3 uDark;',
    'void main(){',
    '  vec2 uv = vW * uScale + uScroll;',
    '  float n = dot(texture2D(uCloudTex, uv), uSel);',
    '  n += dot(texture2D(uCloudTex, uv + vec2(uSoftR, 0.0)), uSel);',
    '  n += dot(texture2D(uCloudTex, uv - vec2(uSoftR, 0.0)), uSel);',
    '  n += dot(texture2D(uCloudTex, uv + vec2(0.0, uSoftR)), uSel);',
    '  n += dot(texture2D(uCloudTex, uv - vec2(0.0, uSoftR)), uSel);',
    '  n /= 5.0;',
    '  float sh = smoothstep(0.20, 0.80, n);',
    /* 普通 alpha 叠合：dst = mix(dst, uDark, a)。乘法混合在软件光栅 + 后处理 RT 这条链上
       量不出任何变暗（三条判据同时红），换成等价的 alpha 之后才测得动。 */
    '  gl_FragColor = vec4(uDark, clamp(uAmt * uContrast * sh, 0.0, 1.0));',
    '}'
  ].join('\n');

  var LINE_VS = [
    'attribute vec3 aCol; attribute float aA;',
    'uniform float uFogNear, uFogFar;',
    'varying vec3 vCol; varying float vA;',
    'void main(){',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  vCol = aCol; vA = aA * smoothstep(uFogFar, uFogNear * 0.6 + uFogFar * 0.4, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var FLAKE_VS = [
    'attribute vec3 aCol; attribute float aA, aSize, aPhase;',
    'uniform float uFogNear, uFogFar, uTime, uPixelK, uSway;',
    'varying vec3 vCol; varying float vA;',
    'void main(){',
    '  vec3 p = position;',
    '  p.x += sin(uTime * 1.1 + aPhase) * uSway;',
    '  p.z += cos(uTime * 0.83 + aPhase * 1.7) * uSway;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vCol = aCol; vA = aA * smoothstep(uFogFar, uFogNear * 0.6 + uFogFar * 0.4, -mv.z);',
    '  gl_PointSize = max(0.8, aSize * uPixelK * (14.0 / max(2.0, -mv.z)));',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var DROP_FS = [
    'precision highp float;',
    'uniform sampler2D uTex;',
    'varying vec3 vCol; varying float vA;',
    'void main(){ gl_FragColor = vec4(vCol, texture2D(uTex, gl_PointCoord).a * vA); }'
  ].join('\n');
  var LINE_FS = [
    'precision highp float;',
    'varying vec3 vCol; varying float vA;',
    'void main(){ gl_FragColor = vec4(vCol, vA); }'
  ].join('\n');

  /* ---------- 建立物件 ---------- */
  function makeDome() {
    var seg = D.MESH.domeSegments, u = {};
    function col3(v) { return { value: new THREE.Color(v, v, v) }; }
    function f(v) { return { value: v }; }
    u.uZenith = col3(1); u.uHorizon = col3(1); u.uGround = col3(0.42); u.uTint = col3(1);
    u.uSunsetCol = col3(1); u.uStarlightCol = col3(1); u.uMilkyCol = col3(1); u.uMilkyWarmCol = col3(1);
    u.uSunCol = col3(1); u.uSunGlowCol = col3(1); u.uMoonCol = col3(1); u.uMoonMareCol = col3(0.7);
    u.uMoonGlowCol = col3(1); u.uGalAxis = { value: new THREE.Vector3(0, 1, 0) };
    u.uSunDir = { value: new THREE.Vector3(0, 1, 0) }; u.uMoonDir = { value: new THREE.Vector3(0, 1, 0) };
    u.uLSel = { value: [new THREE.Vector4(1, 0, 0, 0), new THREE.Vector4(0, 1, 0, 0), new THREE.Vector4(0, 0, 1, 0)] };
    u.uLA = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
    u.uLB = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
    /* uLB = (地平线淡出宽度, 云底世界 y, 云顶世界 y, 迎光亮边)；uLC = (步数, 消光, 高度剪切, 各向异性) */
    u.uLC = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
    u.uCamY = f(0);
    u.uCloudCfg = { value: new THREE.Vector4(0.9, 0.5, 230, 0.08) };
    u.uCloudTune = { value: new THREE.Vector4(0.55, 0.55, 0.24, 1) };
    u.uCloudDetailK = f(0.5);
    u.uCloudCoverDim = f(0.45);
    u.uCloudHorizonK = f(0.5);
    u.uLit = { value: [new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1)] };
    u.uDark = { value: [new THREE.Color(0.5, 0.5, 0.6), new THREE.Color(0.5, 0.5, 0.6), new THREE.Color(0.5, 0.5, 0.6)] };
    u.uScroll = { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] };
    u.uCamXZ = { value: new THREE.Vector2() };
    u.uCloudTex = { value: null };
    u.uHorizonPow = f(D.SKY.horizonPow); u.uGroundFade = f(D.SKY.groundFade);
    u.uSunsetK = f(0); u.uSunsetElW = f(0.2); u.uSunsetAzPow = f(6); u.uSunsetGate = f(0);
    u.uSunRad = f(D.SUN.radiusDeg * RAD); u.uSunEdge = f(D.SUN.disc.edge); u.uSunDiscK = f(1);
    u.uSunGlowK = f(0); u.uSunGlowPow = f(D.SUN.glow.pow); u.uSunHaloK = f(0); u.uSunHaloPow = f(D.SUN.glow.ringPow);
    u.uMoonRad = f(D.MOON.radiusDeg * RAD); u.uMoonEdge = f(D.MOON.disc.edge); u.uMoonK = f(0);
    u.uMoonMareK = f(D.MOON.disc.mareK); u.uMoonMareScale = f(D.MOON.disc.mareScale);
    u.uMoonGlowK = f(0); u.uMoonGlowPow = f(D.MOON.glow.pow); u.uEarthshineK = f(D.MOON.earthshineK); u.uMoonUp = f(0);
    u.uNight = f(0); u.uMilkyK = f(0); u.uMilkyBand = f(0.2); u.uMilkyDust = f(D.STARS.milky.dustK);
    u.uMilkyWarp = f(D.STARS.milky.warp); u.uMilkyScale = f(Math.max(1, D.STARS.milky.lattice));
    u.uStarlightK = f(0); u.uCoverAll = f(0); u.uFlash = f(0); u.uFlashScale = f(D.CLOUD.lighting.flashK);
    u.uCloudNightK = f(D.CLOUD.lighting.nightK);
    u.uMoonLitK = f(D.CLOUD.lighting.moonLitK); u.uMilkyClump = f(D.STARS.milky.clump || 1.6);
    var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    mat.toneMapped = false;                                    // 光影层纪律①：ShaderMaterial 默认是 true
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(D.MESH.domeRadius, seg[0], seg[1]), mat);
    mesh.name = 'gw-dome';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;                                  // 最先画且不写深度 ⇒ 之后所有几何都盖在它上面
    mesh.onBeforeRender = function (re, sc, cam) {             // 分屏：每台相机各归一次心
      mesh.position.set(cam.position.x, cam.position.y, cam.position.z);
      mesh.updateMatrixWorld(true);
      /* 云的世界锚点跟着"正在渲染的这台相机"走，分屏两台各算各的 */
      mesh.material.uniforms.uCamXZ.value.set(cam.position.x, cam.position.z);
      mesh.material.uniforms.uCamY.value = cam.position.y;      // 云层是**世界绝对高度**：飞上去会真的穿进云里
    };
    return mesh;
  }
  /* 云层几何：与天穹**共享同一批 uniform 对象**（不是拷贝）——
     tools/atmos_check.cjs 的云开/关配对帧清的是 gw-dome 的 uLA[i].w，共享之后同一份值同时关掉这层。
     深度测试打开 ⇒ 被地形挡住的像素不跑片段；透明队列里 renderOrder -500
     ⇒ 在不透明世界之后、水(22)/冰(21)/粒子(30)/特效(10) 之前。 */
  function makeClouds(shared) {
    var u = {}, k;
    for (k in shared) if (Object.prototype.hasOwnProperty.call(shared, k)) u[k] = shared[k];
    var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS,
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, fog: false });
    mat.toneMapped = false;
    var seg = D.MESH.cloudSegments || [18, 9];
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(D.MESH.cloudRadius || 158, seg[0], seg[1]), mat);
    mesh.name = 'gw-cloud';
    mesh.frustumCulled = false;
    mesh.renderOrder = -500;
    mesh.onBeforeRender = function (re, sc, cam) {          // 分屏：每台相机各归一次心
      mesh.position.set(cam.position.x, cam.position.y, cam.position.z);
      mesh.updateMatrixWorld(true);
      shared.uCamXZ.value.set(cam.position.x, cam.position.z);
      shared.uCamY.value = cam.position.y;
    };
    return mesh;
  }
  function makeStars(count) {
    var S = D.STARS, r = D.MESH.starRadius;
    var pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    var size = new Float32Array(count), mag = new Float32Array(count), ph = new Float32Array(count), ra = new Float32Array(count);
    var rnd = G.mulberry32((D.CLOUD.noise.seed ^ 0x57415453) >>> 0), i, tot = 0, cw = [];
    for (i = 0; i < S.colors.length; i++) { tot += S.colors[i].weight; cw.push(tot); }
    var gax = galaxyAxis(_gal);
    for (i = 0; i < count; i++) {
      var z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rx = Math.sqrt(Math.max(0, 1 - z * z));
      var dx = Math.cos(a) * rx, dy = z, dz = Math.sin(a) * rx;
      /* 往**银道面**（法线 gax）集中：垂直于法线的方向才是那条带子 */
      var gp = dx * gax.x + dy * gax.y + dz * gax.z, pull = 0.28 * (1 - Math.abs(gp));
      dx -= gp * pull * gax.x; dy -= gp * pull * gax.y; dz -= gp * pull * gax.z;
      var l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      pos[i * 3] = dx / l * r; pos[i * 3 + 1] = dy / l * r; pos[i * 3 + 2] = dz / l * r;
      var m = Math.pow(rnd(), S.magBias);
      mag[i] = m; size[i] = lerp(S.sizeRange[0], S.sizeRange[1], Math.pow(m, S.sizeCurve === undefined ? 0.75 : S.sizeCurve));
      ph[i] = rnd() * 6.2831853; ra[i] = lerp(S.twinkle.rateMin, S.twinkle.rateMax, rnd());
      var pv = rnd() * tot, ci = 0;
      while (ci < cw.length - 1 && pv > cw[ci]) ci++;
      var c = C(S.colors[ci].color), dim = lerp(S.dimRange[0], S.dimRange[1], m);
      col[i * 3] = c.r * dim; col[i * 3 + 1] = c.g * dim; col[i * 3 + 2] = c.b * dim;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    geo.setAttribute('aRate', new THREE.BufferAttribute(ra, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uCoverK: { value: 1 },
                  uTwinkleK: { value: 1 }, uHorizFade: { value: D.STARS.extinction }, uPixelK: { value: 1 } },
      vertexShader: STAR_VS, fragmentShader: STAR_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    mat.toneMapped = false;
    var pts = new THREE.Points(geo, mat);
    pts.name = 'gw-stars';
    pts.frustumCulled = false;
    pts.renderOrder = -900;
    return pts;
  }
  function makeSheet(cell) {
    var w = ctx.world;
    var nx = Math.floor(w.SX / cell) + 1, nz = Math.floor(w.SZ / cell) + 1;
    var pos = new Float32Array(nx * nz * 3), idx = [];
    for (var j = 0; j < nz; j++) for (var i = 0; i < nx; i++) {
      pos[(j * nx + i) * 3] = i * cell; pos[(j * nx + i) * 3 + 2] = j * cell;
      if (i < nx - 1 && j < nz - 1) {
        var a = j * nx + i;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    var mat = new THREE.ShaderMaterial({
      uniforms: { uCloudTex: { value: A.cloudTex }, uSel: { value: new THREE.Vector4(1, 0, 0, 0) },
                  uScale: { value: (D.CLOUD.layers[D.CLOUD.shadow.layer] || D.CLOUD.layers[0]).scale },
                  uContrast: { value: 0.6 }, uAmt: { value: 0 },
                  uSoftR: { value: D.CLOUD.shadow.softRadius }, uScroll: { value: new THREE.Vector2() },
                  uDark: { value: new THREE.Color(0.5, 0.55, 0.7) } },
      vertexShader: SHEET_VS, fragmentShader: SHEET_FS,
      transparent: true, depthWrite: false, premultipliedAlpha: false, side: THREE.DoubleSide, fog: false });
    mat.toneMapped = false;
    var mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'gw-sheet';
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.userData.grid = { nx: nx, nz: nz, cell: cell };
    return mesh;
  }
  var sheetRaw = null, sheetTmp = null;
  function sheetHeights() {
    var w = ctx.world, g = A.sheet.userData.grid, arr = A.sheet.geometry.attributes.position.array;
    var nx = g.nx, nz = g.nz, sh = D.CLOUD.shadow, i, j;
    if (!sheetRaw || sheetRaw.length !== nx * nz) { sheetRaw = new Float32Array(nx * nz); sheetTmp = new Float32Array(nx * nz); }
    /* 相邻四格的最高点（colTop 自带缓存、随 world.set 失效 ⇒ 仍是一格都不多扫的数组读）：
       只取自己那一格时，格子里的台阶会把 2 格宽的影布压到地面以下，影布基本白画
       （实测开/关只改 0.24% 的像素，把 uAmt 开满也只改 4%）。 */
    for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
      var gx = Math.min(w.SX - 1, Math.floor(i * g.cell)), gz = Math.min(w.SZ - 1, Math.floor(j * g.cell));
      var top = -1;
      for (var dz = 0; dz <= 1; dz++) for (var dx = 0; dx <= 1; dx++) {
        var t2 = w.colTop(Math.min(w.SX - 1, gx + dx), Math.min(w.SZ - 1, gz + dz));
        if (t2 > top) top = t2;
      }
      sheetRaw[j * nx + i] = top;
    }
    /* 影布的高度只该跟"大尺度地形"走：影子是从几十格高的云上投下来的，一格一格的台阶与树冠
       （colTop 把叶子当实心）在这儿只会造出挂在空气里的灰色帆——截图里每棵树旁边那道斜楔就是这么来的。
       所以先把高度场做 sh.heightPasses 次 1-2-1 分离模糊，再用 lift 把模糊丢掉的局部起伏顶回来。 */
    var passes = Math.max(0, sh.heightPasses === undefined ? 1 : sh.heightPasses);
    var fld = sheetRaw, other = sheetTmp, sw = sh.heightSpan === undefined ? 1 : sh.heightSpan;
    for (var p = 0; p < passes; p++) {
      for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
        var i0 = Math.max(0, i - sw), i1 = Math.min(nx - 1, i + sw);
        other[j * nx + i] = (fld[j * nx + i0] + 2 * fld[j * nx + i] + fld[j * nx + i1]) / (2 + (i1 - i0));
      }
      var t = fld; fld = other; other = t;
      for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
        var j0 = Math.max(0, j - sw), j1 = Math.min(nz - 1, j + sw);
        other[j * nx + i] = (fld[j0 * nx + i] + 2 * fld[j * nx + i] + fld[j1 * nx + i]) / (2 + (j1 - j0));
      }
      t = fld; fld = other; other = t;
    }
    for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
      var v = fld[j * nx + i], own = sheetRaw[j * nx + i];
      /* 模糊把远处的高台摊平了，就地取"自己这一格的最高点"兜住 ⇒ 不会被脚下的地形挡掉；
         但绝不能整体抬太多：影布抬到眼睛之上时，它盖住的是**天空**而不是地面
         （实测 lift 1.7 时相机眼高只有 ~1.3：太阳圆盘、星星、月相、影布四条判据一起红，
         全因这张 DoubleSide 的布从头顶罩下来）。 */
      if (own > v) v = own;
      arr[(j * nx + i) * 3 + 1] = v < w.sea ? sh.waterY : v + 1 + sh.lift;
    }
    A.sheet.geometry.attributes.position.needsUpdate = true;
    A.sheet.geometry.computeBoundingSphere();
  }

  function makeDrops(kind, cap) {
    var K = D.PRECIP.kinds[kind];
    if (!K || cap <= 0) return null;
    cap = Math.min(cap, Math.floor(D.PRECIP.budget.maxVerts / (K.mode === 'streak' ? 2 : 1)));
    var geo = new THREE.BufferGeometry(), ud = { kind: kind, cap: cap, mode: K.mode, live: 0,
      x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap) };
    if (K.mode === 'streak') {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 6), 3));
      geo.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(cap * 6), 3));
      geo.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(cap * 2), 1));
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      geo.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      geo.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(cap), 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(cap), 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(cap), 1));
    }
    var u = { uFogNear: { value: 40 }, uFogFar: { value: 150 }, uTime: { value: 0 },
              uPixelK: { value: pixelK() }, uSway: { value: 1 }, uTex: { value: A.flakeTex } };
    var mat = new THREE.ShaderMaterial({ uniforms: u,
      vertexShader: K.mode === 'streak' ? LINE_VS : FLAKE_VS,
      fragmentShader: K.mode === 'streak' ? LINE_FS : DROP_FS,
      transparent: true, depthWrite: false, fog: false });
    mat.toneMapped = false;
    var obj = K.mode === 'streak' ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
    obj.name = 'gw-precip';
    obj.frustumCulled = false;
    obj.renderOrder = 8;
    obj.userData = ud;
    scatterDrops(obj);
    return obj;
  }
  /* 点的大小单位是设备像素：dpr=1.5（用户 4K 屏）与 dpr=1（自动化环境）必须自动补偿，
     否则同一份数据在两边看起来一个是"星空"一个是"没画"。base 那一项是给软件光栅留的可见度下限。 */
  function pixelK() {
    var pr = (ctx && ctx.renderer && ctx.renderer.getPixelRatio) ? clamp(ctx.renderer.getPixelRatio(), 0.75, 2) : 1;
    return pr * (D.STARS.sizeK === undefined ? 1.15 : D.STARS.sizeK);
  }
  function scatterDrops(obj) {
    var ud = obj.userData, K = D.PRECIP.kinds[ud.kind], box = D.PRECIP.box, at = obj.geometry.attributes;
    var r = G.mulberry32((D.CLOUD.noise.seed ^ 0x50524F50) >>> 0);
    for (var i = 0; i < ud.cap; i++) {
      ud.x[i] = anchorPt.x + (r() * 2 - 1) * box.radius;
      ud.z[i] = anchorPt.z + (r() * 2 - 1) * box.radius;
      ud.y[i] = anchorPt.y - box.below + r() * (box.height + box.below + box.spawnAbove);
      if (at.aSize) { at.aSize.array[i] = (K.size || 0.12) * (0.6 + r() * 0.8); at.aSize.needsUpdate = true; }
      if (at.aPhase) { at.aPhase.array[i] = r() * 6.2831853; at.aPhase.needsUpdate = true; }
    }
  }
  function killDrops() {
    if (!A.drop) return;
    ctx.scene.remove(A.drop);
    A.drop.geometry.dispose(); A.drop.material.dispose(); A.drop = null;
  }
  function ensureMeshes() {
    var q = D.QUALITY[P.quality] || D.QUALITY.high;
    if (!A.cloudTex) A.cloudTex = makeCloudNoise();
    if (!A.flakeTex) A.flakeTex = makeFlake();
    if (!A.dome) { A.dome = makeDome(); A.dome.material.uniforms.uCloudTex.value = A.cloudTex; ctx.scene.add(A.dome); }
    if (!A.cloud) { A.cloud = makeClouds(A.dome.material.uniforms); ctx.scene.add(A.cloud); }
    /* 只有质量档**真的变了**才重建星点几何：以前拿一个模块级 lastQuality 当标记，
       reset() 把它清空 ⇒ 每次采帧都白重建一遍 1900 颗星（还把外部持有的旧引用变陈旧，
       回归里就出现"星图不会转"的假象）。 */
    if (!A.stars || A.stars.userData.quality !== P.quality || A.stars.userData.count !== q.stars) {
      if (A.stars) { ctx.scene.remove(A.stars); A.stars.geometry.dispose(); A.stars.material.dispose(); }
      A.stars = makeStars(q.stars);
      A.stars.userData.quality = P.quality; A.stars.userData.count = q.stars;
      ctx.scene.add(A.stars);
    }
    if (!A.sheet) { A.sheet = makeSheet(q.shadowCells); ctx.scene.add(A.sheet); sheetT = 99; }
    else if (A.sheet.userData.grid.cell !== q.shadowCells) {
      ctx.scene.remove(A.sheet); A.sheet.geometry.dispose(); A.sheet.material.dispose();
      A.sheet = makeSheet(q.shadowCells); ctx.scene.add(A.sheet); sheetT = 99;
    }
    return q;
  }

  /* ---------- 降水：滴数吃局部降水率与质量档；头顶有屋顶就不下 ---------- */
  function stepDrops(dt, q) {
    var kind = (P.precip && sample && sample.precipKind && sample.precipRate > 0.02) ? sample.precipKind : null;
    if (A.drop && A.drop.userData.kind !== kind) { killDrops(); }
    if (kind && !A.drop) {
      A.drop = makeDrops(kind, Math.round((D.PRECIP.kinds[kind].count || 400) * q.rainK));
      /* 建了就得进场景：漏掉这一步时 dropsLive 照样数得出 920 条，屏幕上一条都没有
         （回归第 8 条原来只数几何，就是这么把"从没画过的雨"看成绿的）。 */
      if (A.drop) ctx.scene.add(A.drop);
    }
    if (!A.drop) { stats.drops = 0; return; }
    var obj = A.drop, ud = obj.userData, K = D.PRECIP.kinds[ud.kind], box = D.PRECIP.box, at = obj.geometry.attributes;
    /* 先问"我站在屋里还是屋外"：colTop 是 world.js 的列高缓存（随 world.set 失效），一格都不多扫 */
    var camTop = D.PRECIP.occlude ? ctx.world.colTop(Math.floor(anchorPt.x), Math.floor(anchorPt.z)) : -1;
    var indoors = D.PRECIP.occlude && camTop >= 0 && anchorPt.y < camTop + 1;
    var want = Math.max(0, Math.min(ud.cap, Math.round(ud.cap * clamp(sample.precipRate, 0, 1) * P.precipK)));
    if (indoors) want = 0;                                  // 室内一滴都不画：站在坑里/屋里不该看见雨
    ud.live = want; stats.drops = want;
    var streak = ud.mode === 'streak', n2 = streak ? 2 : 1;
    var pos = at.position.array, ca = at.aCol.array, aa = at.aA.array;
    var c = C(K.color), alpha = K.alpha === undefined ? 0.6 : K.alpha;
    var wx = sample.windX * dt * D.PRECIP.windPushK * (K.drift === undefined ? 0.3 : K.drift);
    var wz = sample.windZ * dt * D.PRECIP.windPushK * (K.drift === undefined ? 0.3 : K.drift);
    var spd = K.speed || 20, len = K.len || 0;
    for (var i = 0; i < ud.cap; i++) {
      var on = i < want;
      if (!on) {
        if (streak) { pos[i * 6 + 1] = -999; pos[i * 6 + 4] = -999; aa[i * 2] = 0; aa[i * 2 + 1] = 0; }
        else { pos[i * 3 + 1] = -999; aa[i] = 0; }
        continue;
      }
      ud.x[i] += wx; ud.z[i] += wz; ud.y[i] -= spd * dt;
      var rx = ud.x[i] - anchorPt.x, rz = ud.z[i] - anchorPt.z;
      if (rx > box.radius) ud.x[i] -= box.radius * 2; else if (rx < -box.radius) ud.x[i] += box.radius * 2;
      if (rz > box.radius) ud.z[i] -= box.radius * 2; else if (rz < -box.radius) ud.z[i] += box.radius * 2;
      var top = D.PRECIP.occlude ? ctx.world.colTop(Math.floor(ud.x[i]), Math.floor(ud.z[i])) : -1;   // 落在屋顶上就收，雨不会穿过屋顶
      var floorY = top < 0 ? anchorPt.y - box.below : top + 1;
      var ceilY = anchorPt.y + box.height + box.spawnAbove;
      if (ud.y[i] < floorY) ud.y[i] = ceilY - (i % 7) * 0.4;             // 落地回收：按序号错开，不聚成一片"雨头"
      if (ud.y[i] > ceilY) ud.y[i] = ceilY;
      var vx = sample.windX * (len / spd) * D.PRECIP.windPushK, vz = sample.windZ * (len / spd) * D.PRECIP.windPushK;
      if (streak) {
        pos[i * 6] = ud.x[i]; pos[i * 6 + 1] = ud.y[i]; pos[i * 6 + 2] = ud.z[i];
        pos[i * 6 + 3] = ud.x[i] - vx; pos[i * 6 + 4] = ud.y[i] - len; pos[i * 6 + 5] = ud.z[i] - vz;
        ca[i * 6] = ca[i * 6 + 3] = c.r; ca[i * 6 + 1] = ca[i * 6 + 4] = c.g; ca[i * 6 + 2] = ca[i * 6 + 5] = c.b;
        aa[i * 2] = alpha; aa[i * 2 + 1] = alpha * 0.4;
      } else {
        pos[i * 3] = ud.x[i]; pos[i * 3 + 1] = ud.y[i]; pos[i * 3 + 2] = ud.z[i];
        ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b;
        aa[i] = alpha;
      }
    }
    at.position.needsUpdate = true; at.aCol.needsUpdate = true; at.aA.needsUpdate = true;
    var u = obj.material.uniforms;
    u.uFogNear.value = ctx.scene.fog ? ctx.scene.fog.near : 40;
    u.uFogFar.value = ctx.scene.fog ? ctx.scene.fog.far : 150;
    u.uTime.value = clock; u.uPixelK.value = pixelK();
    u.uSway.value = (K.sway || 1) * 0.55;
    obj.visible = want > 0;
    obj.geometry.setDrawRange(0, want * n2 * (streak ? 2 : 1));
  }

  /* ---------- 闪电：订阅天气层的广播（渲染层向下依赖 ✓，天气层永远不认识本层） ---------- */
  function hookWeather() {
    if (hooked || !G.WEATHER_HOOKS || !G.WEATHER_HOOKS.onLightning) return;
    hooked = true;
    G.WEATHER_HOOKS.onLightning.push(function (b) {
      if (!attached || broken || !P.on || !P.lightning) return;
      var d = Math.hypot(b.x - anchorPt.x, b.z - anchorPt.z);
      flash = Math.max(flash, clamp(b.strength, 0, 1) * clamp(1 - d / 90, 0.15, 1));
      stats.flashes++;
    });
  }

  /* ================= 每帧 ================= */
  var _c1 = null, _c2 = null;
  /* 本层会写灯光的颜色与强度，而 main.js 的老通路（dayNight）只写强度与雾——
     所以"接管过再关掉"必须把第一次接手之前的那份原状交还回去，否则颜色留在大气层那一档上，
     "关掉 == 现状"就是一句假话（回归第 1/15 条就是专门打这个的）。 */
  var saved = null, handedBack = false;
  function snapshotLights() {
    var L = ctx.lights, f = ctx.scene.fog;
    saved = {
      sunC: L.sun.color.clone(), sunI: L.sun.intensity,
      hemiC: L.hemi.color.clone(), hemiG: L.hemi.groundColor.clone(), hemiI: L.hemi.intensity,
      ambC: L.ambient.color.clone(), ambI: L.ambient.intensity,
      fogC: f ? f.color.clone() : null, near: f ? f.near : 0, far: f ? f.far : 0
    };
  }
  /* 没接管的那一帧必须把自家的几何全藏掉、灯光交还：否则"关掉大气层"只是不再更新它们，
     上一帧的天穹/星/云影布/降水还留在场景里继续画。 */
  function handBack() {
    if (!ctx || !ctx.scene) return;
    ['dome', 'stars', 'cloud', 'sheet', 'drop'].forEach(function (k) { if (A[k]) A[k].visible = false; });
    stats.drops = 0;
    if (saved && !handedBack) {
      var L = ctx.lights, f = ctx.scene.fog;
      L.sun.color.copy(saved.sunC); L.sun.intensity = saved.sunI;
      L.hemi.color.copy(saved.hemiC); L.hemi.groundColor.copy(saved.hemiG); L.hemi.intensity = saved.hemiI;
      L.ambient.color.copy(saved.ambC); L.ambient.intensity = saved.ambI;
      if (f && saved.fogC) { f.color.copy(saved.fogC); f.near = saved.near; f.far = saved.far; }
      handedBack = true;
    }
  }
  function frame(dt) {
    if (!attached || broken || !P.on || !ctx || !ctx.match || !ctx.scene) { handBack(); return false; }   // false = 没接管，main 走老通路
    handedBack = false;
    if (!saved) snapshotLights();
    if (!_c1) { _c1 = new THREE.Color(); _c2 = new THREE.Color(); }
    var q = ensureMeshes(), m = ctx.match, w = ctx.world;
    clock += dt;
    var dayLen = m.dayLen || 120;
    var phase = (P.phase === null || P.phase === undefined)
      ? (((m.dayT || 0) % dayLen) + dayLen) % dayLen / dayLen : clamp(P.phase, 0, 0.999);
    state.phase = phase; state.dayCount = (m.dayT || 0) / dayLen;
    bodyDirs(phase, state.dayCount);
    state.sunEl = Math.asin(clamp(_sun.y, -1, 1)) / RAD;
    state.moonEl = Math.asin(clamp(_moon.y, -1, 1)) / RAD;
    state.night = smooth(3, -6, state.sunEl);
    /* 天球绕天极的转角：权威相位的纯函数（不是 dt 累加）⇒ 任何帧率、任何暂停后回到同一相位都是同一张天空 */
    state.skyRot = Math.PI * 2 * (phase - D.ORBIT.noonPhase) * vn(D.STARS, 'rotateK', 1);

    var an = ctx.anchor ? ctx.anchor() : null;
    if (an) { anchorPt.x = an.x; anchorPt.y = an.y; anchorPt.z = an.z; }
    if (G.WEATHER && G.WEATHER.ready) sample = G.WEATHER.sample(anchorPt.x, anchorPt.z, sample || G.WEATHER.at(0, 0));
    var v = sample ? sample.v : null;
    var cover = clamp(vn(v, 'cover', 0.2), 0, 1);
    var starsK = clamp(vn(v, 'starsK', 1), 0, 1);
    state.cover = cover; state.starsK = starsK;

    /* 天穹 */
    var u = A.dome.material.uniforms, keys = D.SKY.stops;
    pickColor(u.uZenith.value, keys, state.sunEl, 'zenith');
    pickColor(u.uHorizon.value, keys, state.sunEl, 'horizon');
    pickColor(u.uGround.value, keys, state.sunEl, 'ground');
    u.uTint.value.setRGB(vn(v, 'light_tint#0', 1), vn(v, 'light_tint#1', 1), vn(v, 'light_tint#2', 1));
    u.uSunDir.value.copy(_sun); u.uMoonDir.value.copy(_moon);
    u.uNight.value = state.night;
    u.uHorizonPow.value = D.SKY.horizonPow; u.uGroundFade.value = D.SKY.groundFade;
    var B = D.SKY.band;
    u.uSunsetCol.value.copy(C(B.color));
    u.uSunsetK.value = B.k * smooth(12, -2, state.sunEl) * (1 - cover * 0.6);
    u.uSunsetElW.value = Math.max(0.02, Math.sin(B.elWidth * RAD));
    u.uSunsetAzPow.value = Math.max(1, 1728 / Math.max(1, B.azWidth * B.azWidth));
    u.uSunsetGate.value = smooth(B.maxEl, B.minEl, Math.abs(state.sunEl));
    u.uSunCol.value.copy(C(D.SUN.disc.color));
    u.uSunGlowCol.value.copy(C(D.SUN.glow.color));
    var above = smooth(D.SUN.aboveHorizon, D.SUN.aboveHorizon + 4, state.sunEl);
    u.uSunGlowK.value = D.SUN.glow.k * above * P.skyK * (1 - cover * 0.5);
    u.uSunHaloK.value = D.SUN.glow.ringK * above * P.skyK * (1 - cover * 0.4);
    u.uSunDiscK.value = P.skyK * clamp(vn(v, 'sunDiscK', 1), 0, 1) * smooth(D.SUN.aboveHorizon - 1, D.SUN.aboveHorizon + 2, state.sunEl);
    u.uMoonCol.value.copy(C(D.MOON.disc.color));
    u.uMoonMareCol.value.copy(C(D.MOON.disc.mareColor));
    u.uMoonGlowCol.value.copy(C(D.MOON.glow.color));
    u.uMoonRad.value = D.MOON.radiusDeg * RAD; u.uMoonEdge.value = D.MOON.disc.edge;
    u.uMoonMareK.value = D.MOON.disc.mareK; u.uMoonMareScale.value = D.MOON.disc.mareScale;
    u.uEarthshineK.value = D.MOON.earthshineK;
    var moonUp = P.moon ? smooth(-1, 4, state.moonEl) : 0;
    u.uMoonK.value = moonUp * P.skyK * clamp(starsK, 0, 1);
    u.uMoonGlowK.value = moonUp * D.MOON.glow.k * clamp(starsK, 0, 1);
    u.uMoonUp.value = moonUp;
    var MK = D.STARS.milky;
    u.uMilkyK.value = (P.stars && q.milky && MK.on) ? MK.k * clamp(starsK, 0, 1) * (1 - cover * 0.8) : 0;
    u.uMilkyBand.value = Math.max(0.02, MK.bandHalfDeg * RAD);
    u.uMilkyCol.value.copy(C(MK.color)); u.uMilkyWarmCol.value.copy(C(MK.warmColor));
    /* 银河必须与星星一起转：整片天球是一起绕天极转的，只让星点转、河不动，
       肉眼看到的是"星在河上滑"——回归第 17 条钉的就是这个（量的两者绕天极的小时角之差）。 */
    u.uGalAxis.value.copy(galaxyAxis(_galBase)).applyAxisAngle(poleAxis(_pole), state.skyRot);
    u.uStarlightCol.value.copy(C(D.SKY.starlight.color));
    u.uStarlightK.value = D.SKY.starlight.k * state.night * (1 - cover * 0.7);
    u.uCoverAll.value = cover;
    var CL = D.CLOUD, L = CL.layers, nL = Math.min(CL.maxLayers, q.cloudLayers, L.length);
    var stepScale = q.cloudSteps === undefined ? 10 : q.cloudSteps;
    for (var li = 0; li < CL.maxLayers; li++) {
      /* 关云 / 超出质量档的层：云量 0 ⇒ 着色器整层跳过（云量是"这层画不画"的唯一开关，
         atmos_check 的开/关配对帧也是把它清 0 再抓一张） */
      if (li >= nL || !P.clouds) { u.uLA.value[li].set(0, 1, 0, 0); u.uLC.value[li].set(0, 0, 0, 1); continue; }
      var lay = L[li], lk = vn(v, 'layerK#' + li, 1);
      /* minCover：这层"从多大云量才开始出现"（中层高层云只在天阴时铺开，晴天不白烧两刀步进） */
      var cov = cover < (lay.minCover || 0) ? 0 : clamp(cover * (lay.coverK || 1) * lk * P.cloudK, 0, 1.3);
      var thick = Math.max(1, lay.thick === undefined ? 14 : lay.thick);
      var alt = lay.altitude === undefined ? 48 : lay.altitude;
      u.uLSel.value[li].fromArray(lay.sel);
      u.uLA.value[li].set(lay.scale, lay.edge * (0.55 + 0.9 * (1 - Math.min(1, cov))), lay.opacityK, cov);
      u.uLB.value[li].set(lay.fadeK === undefined ? 0.12 : lay.fadeK, alt - thick * 0.5, alt + thick * 0.5, lay.rimK);
      u.uLC.value[li].set(Math.max(1, Math.round((lay.stepsK === undefined ? 1 : lay.stepsK) * stepScale)),
                          lay.sigma === undefined ? 0.2 : lay.sigma,
                          lay.shear === undefined ? 1.4 : lay.shear,
                          lay.stretch === undefined ? 1 : lay.stretch);
      u.uLit.value[li].copy(C(lay.lit)); u.uDark.value[li].copy(C(lay.dark));
      u.uScroll.value[li].set(cloudScroll[li][0], cloudScroll[li][1]);
    }
    var CR = CL.render || {}, CG = CL.lighting;
    u.uCloudCfg.value.set(CR.jitterK === undefined ? 0.5 : CR.jitterK,
                          CR.preTestCover === undefined ? 0.75 : CR.preTestCover,
                          CR.farCap === undefined ? 230 : CR.farCap,
                          CR.profileSoft === undefined ? 0.06 : CR.profileSoft);
    u.uCloudHorizonK.value = CR.horizonBlendK === undefined ? 0.5 : CR.horizonBlendK;
    u.uCloudTune.value.set(CG.powderK === undefined ? 0.55 : CG.powderK,
                           CG.phaseK === undefined ? 0.55 : CG.phaseK,
                           CG.bottomK === undefined ? 0.42 : CG.bottomK,
                           CG.alphaK === undefined ? 1 : CG.alphaK);
    u.uCloudDetailK.value = CG.detailK === undefined ? 0.5 : CG.detailK;
    u.uCloudCoverDim.value = CG.coverDimK === undefined ? 0.45 : CG.coverDimK;
    u.uFlash.value = flash;
    /* 关云 / 三层云量全为 0 ⇒ 这层几何直接藏掉（省一次 draw call，也让"关云"一眼看得出） */
    if (A.cloud) {
      var anyCov = false;
      for (var ci2 = 0; ci2 < CL.maxLayers; ci2++) if (u.uLA.value[ci2].w > 0.002) anyCov = true;
      A.cloud.visible = !!(P.clouds && anyCov);
    }

    /* 星空：角度是权威相位的纯函数 ⇒ 永不漂移；闪烁相位是时间积分 ⇒ 160FPS 下也连续 */
    var su = A.stars.material.uniforms;
    su.uTime.value = clock;
    su.uNight.value = state.night;
    su.uCoverK.value = starsK;
    su.uTwinkleK.value = q.twinkle ? D.STARS.twinkle.k : 0;
    su.uHorizFade.value = D.STARS.extinction;
    su.uPixelK.value = pixelK();
    A.stars.visible = P.stars && state.night > 0.02 && starsK > 0.01;
    if (D.STARS.poleFromOrbit) {
      A.stars.quaternion.setFromAxisAngle(poleAxis(_pole), state.skyRot);
    } else A.stars.quaternion.identity();

    /* 地面云影 */
    var sh = D.CLOUD.shadow, SL = L[sh.layer] || L[0];
    A.sheet.visible = false;
    if (P.cloudShadow && P.clouds && SL) {
      var shu = A.sheet.material.uniforms, pk = Math.max(0.05, sh.peakCover);
      var shape = cover <= pk ? cover / pk : Math.max(0, 1 - (cover - pk) / Math.max(0.05, 1 - pk));
      var lightAmt = (smooth(-2, 8, state.sunEl) + (P.moon ? smooth(2, 12, state.moonEl) * 0.25 * starsK : 0)) * sh.contrast * P.shadowK;
      if (cover >= sh.minCover && shape * lightAmt > 0.012) {
        sheetT += dt;
        if (sheetT > sh.updateEvery) { sheetT = 0; sheetHeights(); }
        /* 采样周期与 scroll 直接取那一层云的 scale（同一份真源）：另写一个 shadow.scale
           迟早会和天上那层对不上，"这朵云投的那片影"就变成两件无关的事。 */
        shu.uScale.value = SL.scale; shu.uSoftR.value = sh.softRadius;
        shu.uDark.value.setRGB(sh.dark[0], sh.dark[1], sh.dark[2]);
        shu.uSel.value.fromArray(SL.sel);
        shu.uAmt.value = shape * lightAmt;
        var par = sh.parallaxK * Math.min(6, SL.altitude / Math.max(0.12, _sun.y * 12));
        shu.uScroll.value.set(cloudScroll[sh.layer][0] + _sun.x * par * SL.scale,
                              cloudScroll[sh.layer][1] + _sun.z * par * SL.scale);
        A.sheet.visible = true;
      }
    }

    /* 雾：色跟地平线走，距离 = 群系基准 × 天气乘子（main.js 的 cullFarChunks 读的就是这两个数） */
    if (ctx.scene.fog) {
      var fg = ctx.scene.fog, bf = D.FOG.biomeFar[w.biomeAt ? w.biomeAt(Math.floor(anchorPt.x), Math.floor(anchorPt.z)) : 0];
      var far = (bf === undefined ? D.FOG.biomeFar[0] : bf) * clamp(vn(v, 'fog_farK', 1), 0.12, 1.6);
      fg.far = far;
      fg.near = far * D.FOG.nearK * clamp(vn(v, 'fog_nearK', 1), 0.12, 1.6);
      pickColor(_c1, keys, state.sunEl, 'fog');
      fg.color.copy(_c1).lerp(u.uHorizon.value, D.FOG.skyBlend);
      _c2.copy(fg.color).lerp(u.uTint.value, clamp(cover, 0, 1) * 0.45);
      fg.color.copy(_c2);
    }

    /* 三盏灯 */
    var lg = ctx.lights, LK = D.LIGHT_KEYS;
    if (lg && lg.sun && lg.hemi && lg.ambient) {
      pickColor(lg.sun.color, LK, state.sunEl, 'sun');
      lg.sun.intensity = pickNum(LK, state.sunEl, 'sunInt') * clamp(vn(v, 'light_sunK', 1), 0, 2);
      pickColor(lg.hemi.color, LK, state.sunEl, 'hemiSky');
      if (lg.hemi.groundColor) pickColor(lg.hemi.groundColor, LK, state.sunEl, 'hemiGround');
      lg.hemi.intensity = pickNum(LK, state.sunEl, 'hemiInt') * clamp(vn(v, 'light_hemiK', 1), 0, 2);
      pickColor(lg.ambient.color, LK, state.sunEl, 'amb');
      lg.ambient.intensity = pickNum(LK, state.sunEl, 'ambInt') * clamp(vn(v, 'light_ambK', 1), 0, 2);
      var moonNight = state.night > 0.3;
      if (moonNight && P.moon) {                                            // 夜里换成月光，方向真的对准月亮
        scaleColor(lg.sun.color, C(D.MOON.light.color), u.uTint.value.r, u.uTint.value.g, u.uTint.value.b);
        lg.sun.intensity = Math.max(0.04, pickNum(LK, state.sunEl, 'sunInt') +
          D.MOON.light.intK * clamp(starsK, 0.25, 1) * smooth(2, 12, state.moonEl)) * D.MOON.light.hemiK;
      }
      var follow = D.LIGHT.followSun && (moonNight ? D.MOON.light.followMoon : state.sunEl > D.LIGHT.followMinEl);
      if (follow) lg.sun.position.set(moonNight ? _moon.x : _sun.x, (moonNight ? _moon.y : _sun.y) + 0.02, moonNight ? _moon.z : _sun.z);
      else lg.sun.position.set(G.SUN_DIR[0], G.SUN_DIR[1], G.SUN_DIR[2]);
      if (flash > 0.001) {                                                 // 闪电把那一下补到场景灯上（云内部亮 + 地面闪白）
        lg.hemi.intensity += flash * 1.5;
        lg.ambient.intensity += flash * 0.45;
      }
    }

    if (flash > 0) flash = Math.max(0, flash - dt / Math.max(0.02, D.REGIONS.lightning.flashDecay));

    /* 降水与云漂移 */
    stepDrops(dt, q);
    var gust = 1 + Math.sin(clock * 0.7) * 0.3 * (sample ? sample.gust : 0);
    for (var ci = 0; ci < cloudScroll.length; ci++) {
      var cl = L[ci];
      if (!cl) continue;
      cloudScroll[ci][0] += (sample ? sample.windX : 0) * cl.driftK * cl.scale * gust * dt * 0.9;
      cloudScroll[ci][1] += (sample ? sample.windZ : 0) * cl.driftK * cl.scale * gust * dt * 0.9;
    }
    A.dome.visible = true;
    ctx.scene.background = null;                                  // 老那张渐变贴图交还给天穹
    stats.taken++;
    return true;
  }

  /* ================= 对外 ================= */
  var ATMOS = G.ATMOS = {
    ready: false, stats: stats, state: state, params: P,
    attach: function (o) {
      if (!window.THREE || !G.ATMOS_DATA) return false;
      ctx = o; attached = true;
      D.SKY.stops.sort(function (a, b) { return a.el - b.el; });            // 取样表按仰角升序（数据表写的是从亮到暗）
      D.LIGHT_KEYS.sort(function (a, b) { return a.el - b.el; });
      try {
        hookWeather();
        if (!A.cloudTex) A.cloudTex = makeCloudNoise();
        if (!A.flakeTex) A.flakeTex = makeFlake();
        ensureMeshes();
        broken = false; ATMOS.ready = true;
      } catch (e) {
        broken = true; ATMOS.ready = false;
        /* 把原因留下：这一层"建立失败就静静退回老通路"是对玩家的礼貌，
           但对排查是灾难——上一轮就是被它挡了一个 ReferenceError，只看到 broken=true 不知其所以然。 */
        state.brokenMsg = ((e && e.message) || String(e)) + '';
        if (window.console) console.warn('[大气] 建立失败，交回主循环老通路：' + state.brokenMsg);
      }
      return !broken;
    },
    detach: function () {
      if (!attached) return false;
      ['dome', 'stars', 'cloud', 'sheet', 'drop'].forEach(function (k) {
        if (A[k]) { ctx.scene.remove(A[k]); if (A[k].geometry) A[k].geometry.dispose(); if (A[k].material) A[k].material.dispose(); A[k] = null; }
      });
      attached = false; ATMOS.ready = false;
      return true;
    },
    frame: frame,
    enabled: function () { return attached && !broken && !!P.on; },
    toggle: function () { ATMOS.set('on', !P.on); return P.on; },
    /* 只认配方层给的名单：BOOLS / RANGES / quality / phase / followSun。不认的键返回 false，不静默接受。 */
    set: function (k, val) {
      if (D.BOOLS.indexOf(k) >= 0) { P[k] = (val === true || val === 1 || val === 'true' || val === '1'); persist(); return P[k]; }
      if (k === 'quality') { P.quality = D.PHASES.indexOf(val) >= 0 ? val : 'high'; lastQuality = ''; persist(); return P.quality; }
      if (k === 'phase') {
        if (val === null || val === '' || val === 'auto') P.phase = null;
        else { var p = parseFloat(val); if (!isFinite(p)) return false; P.phase = clamp(p, 0, 0.999); }
        persist(); return P.phase;
      }
      if (k === 'followSun') { D.LIGHT.followSun = (val === true || val === 1 || val === 'true' || val === '1'); return D.LIGHT.followSun; }
      if (D.RANGES[k]) { var n = parseFloat(val); if (!isFinite(n)) return false; P[k] = clamp(n, D.RANGES[k][0], D.RANGES[k][1]); persist(); return P[k]; }
      return false;
    },
    /* 回到默认参数。**同时**把动画积分量清零：云偏移 / 时钟 / 闪电衰减都是累加量，
       不归零的话"同一个场景截两次"不会得到同一份像素，回归脚本就没法用校验和比对。 */
    reset: function () {
      for (var k in D.DEFAULTS) P[k] = D.DEFAULTS[k];
      lastQuality = ''; clock = 0; flash = 0; sheetT = 99;
      for (var i = 0; i < cloudScroll.length; i++) { cloudScroll[i][0] = 0; cloudScroll[i][1] = 0; }
      killDrops();
      stats.drops = 0;
      persist(); return true;
    },
    /* 给机制层与 UI 的读数：全是数字与 key，中文由 ui 层出（本层零文案）。 */
    sunDir: function (out) { out = out || { x: 0, y: 0, z: 0 }; return out.x = _sun.x, out.y = _sun.y, out.z = _sun.z, out; },
    moonDir: function (out) { out = out || { x: 0, y: 0, z: 0 }; return out.x = _moon.x, out.y = _moon.y, out.z = _moon.z, out; },
    readout: function () {
      return { phase: +state.phase.toFixed(4), sunElevation: +state.sunEl.toFixed(2), moonElevation: +state.moonEl.toFixed(2),
               moonAge: +state.moonAge.toFixed(3), night: +state.night.toFixed(3),
               weather: sample ? sample.id : null, cover: +state.cover.toFixed(3), starsK: +state.starsK.toFixed(3),
               intensity: sample ? +sample.intensity.toFixed(3) : 0, precip: sample ? sample.precipKind : null,
               rate: sample ? +sample.precipRate.toFixed(3) : 0, region: sample ? sample.region : -1,
               wind: sample ? { x: +sample.windX.toFixed(2), z: +sample.windZ.toFixed(2) } : null,
               mods: sample ? sample.mods : {} };
    },
    spec: function () {
      var g = function (m) { return m && m.geometry && m.geometry.attributes.position ? m.geometry.attributes.position.count : 0; };
      return {
        ready: ATMOS.ready, broken: broken, brokenMsg: state.brokenMsg || null, on: P.on, quality: P.quality, params: P,
        domeVerts: g(A.dome), starVerts: g(A.stars), sheetVerts: g(A.sheet), dropVerts: A.drop ? g(A.drop) : 0,
        dropsLive: A.drop ? A.drop.userData.live : 0, dropKind: A.drop ? A.drop.userData.kind : null,
        sheetVisible: !!(A.sheet && A.sheet.visible), starsVisible: !!(A.stars && A.stars.visible),
        domeVisible: !!(A.dome && A.dome.visible), dropVisible: !!(A.drop && A.drop.visible),
        cloudVisible: !!(A.cloud && A.cloud.visible), cloudVerts: g(A.cloud),
        camXZ: A.dome ? [+A.dome.material.uniforms.uCamXZ.value.x.toFixed(1), +A.dome.material.uniforms.uCamXZ.value.y.toFixed(1)] : null,
        sheetDbg: A.sheet ? { amt: +A.sheet.material.uniforms.uAmt.value.toFixed(3),
                              contrast: +A.sheet.material.uniforms.uContrast.value.toFixed(3),
                              scale: +A.sheet.material.uniforms.uScale.value.toFixed(4),
                              scroll: [+A.sheet.material.uniforms.uScroll.value.x.toFixed(3), +A.sheet.material.uniforms.uScroll.value.y.toFixed(3)] } : null,
        domeDbg: A.dome ? { sunDiscK: +A.dome.material.uniforms.uSunDiscK.value.toFixed(3),
                            moonK: +A.dome.material.uniforms.uMoonK.value.toFixed(3),
                            night: +A.dome.material.uniforms.uNight.value.toFixed(3),
                            milkyK: +A.dome.material.uniforms.uMilkyK.value.toFixed(3),
                            coverAll: +A.dome.material.uniforms.uCoverAll.value.toFixed(3),
                            layerCov: [0, 1, 2].map(i => +A.dome.material.uniforms.uLA.value[i].w.toFixed(3)) } : null,
        starDbg: A.stars ? { night: +A.stars.material.uniforms.uNight.value.toFixed(3), coverK: +A.stars.material.uniforms.uCoverK.value.toFixed(3),
                             sizeK: +pixelK().toFixed(2) } : null,
        /* 天球姿态：回归第 17 条量的是"星星与银河是否一起绕同一根天极转、转角与太阳同号同率"，
           这些量不交出去，那条判据就只能靠肉眼看夜空（而肉眼看不出 15°/小时的错向） */
        sky: { rot: +(state.skyRot || 0).toFixed(5),
               pole: (function () { var p = poleAxis(new THREE.Vector3()); return [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]; })(),
               gal: (function () { var g = new THREE.Vector3(); return A.dome ? (g.copy(A.dome.material.uniforms.uGalAxis.value).normalize(), [+g.x.toFixed(4), +g.y.toFixed(4), +g.z.toFixed(4)]) : null; })(),
               quat: A.stars ? [+A.stars.quaternion.x.toFixed(4), +A.stars.quaternion.y.toFixed(4),
                                +A.stars.quaternion.z.toFixed(4), +A.stars.quaternion.w.toFixed(4)] : null },
        flash: +flash.toFixed(3), flashes: stats.flashes, frames: stats.taken,
        fog: ctx && ctx.scene.fog ? { near: +ctx.scene.fog.near.toFixed(1), far: +ctx.scene.fog.far.toFixed(1) } : null,
        lights: ctx && ctx.lights ? { sun: +ctx.lights.sun.intensity.toFixed(3), hemi: +ctx.lights.hemi.intensity.toFixed(3),
                                       amb: +ctx.lights.ambient.intensity.toFixed(3) } : null,
        state: state, weather: G.WEATHER ? G.WEATHER.spec() : null
      };
    },
    data: D
  };
})(window.GW);
