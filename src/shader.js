/* ================= shader（光影层） =================
   手写后处理管线。为什么不引官方后处理 UMD：EffectComposer 要 ≥5 个文件、
   各 *Pass.js 在 class 定义期就要 extends THREE.Pass、EffectComposer 构造期又要 CopyShader+ShaderPass，
   加载顺序错就崩；本项目只需要"曝光/色调映射 + 选择性 bloom + 冷暖分级 + 暗角"，手写 4 个 pass 更省更可控。
   分层：本文件零 DOM / 零玩家可见文案 / 零键盘监听（键位在 js/main.js，文案在 js/hud.js 的 H.TEXT）。

   色彩空间的取舍（本项目专用，别当通用做法抄）：
   现状是"直接渲到屏幕 + outputEncoding=sRGBEncoding"，编码在内置材质片元里做**一次**。
   r128 的编码门（vendor 里逐字核对）：渲进 RT 时取 rt.texture.encoding，渲到屏幕时才取 renderer.outputEncoding。
   → 场景 RT 的 texture.encoding 显式设成 sRGBEncoding，内置材质写进 RT 的值就和今天写进屏幕的值相同；
     末 pass 若所有效果都关就是"原样搬运"，画面应与关光影逐位一致（tools/post_check.cjs 量这个）。
   代价要说清：bloom/分级/暗角于是在**显示空间**（非线性）里算，不是物理正确做法；
   换来的收益是"关掉后与现状像素一致"这条可机检的口径，像素风视觉可接受。
   三条纪律：
     ① 后处理材质一律 toneMapped:false —— Material.toneMapped 默认 true 且 ShaderMaterial 不覆盖，
        否则 renderer.toneMapping 一开，每个中间 pass 会把色调映射再套一遍（画面越叠越灰）；
     ② renderer.toneMapping 保持 NoToneMapping，色调映射只在末 pass 算一次；
     ③ 末 pass 自己算 sRGB → 显示值的映射链路只走一遍，不要再挂 GammaCorrectionShader 或把 RT 设成 Linear。
*/
(function () {
  'use strict';
  var G = window.GW;

  /* ---------- 参数（默认值 = 关光影时的"无操作"值，见 neutralize） ---------- */
  /* 默认值是看图调出来的（/tmp/post_shots 的四组对比），不是拍的：
     - 色调映射默认关。Reinhard 在霜噬雪原那种大面积高亮场景把中间调整体压灰（对比 base_snow 与 off_snow 就看得出），
       ACES 会把 cards.js 定的元素色洗淡；两条都留着，creative 面板可选，但不是默认。
     - 曝光只给 1.04：再多就糊掉积雪的层次。
     - bloom 阈值 0.84 起：这游戏的"发光物"就是接近白的块（以太晶、岩浆、法阵光柱），阈值低一点整屏就糊。 */
  var DEF = {
    on: true,                  // 用户明确要求"光影是必要的"→ 默认开；但关掉必须与现状像素一致（tools/post_check.cjs 机检）
    exposure: 1.04,            // 曝光，1 = 不动
    tone: 'none',              // none | reinhard | aces
    bloom: true, thr: 0.84, strength: 0.26, radius: 1.1, down: 2,  // down=模糊 RT 的分频
    grade: true, gradeAmount: 0.22,
    shadowCool: [0.88, 0.95, 1.06], hotWarm: [1.06, 1.00, 0.93],
    vignette: true, vigStrength: 0.11, vigStart: 0.66, vigEnd: 1.3
  };
  var P = {};
  for (var k0 in DEF) P[k0] = DEF[k0];
  var KEY = 'gw.post';
  try {
    if (window.localStorage) {
      var s = localStorage.getItem(KEY);
      if (s) { var o = JSON.parse(s); for (var k1 in DEF) if (o[k1] !== undefined) P[k1] = o[k1]; }
    }
  } catch (e) {}
  function persist() { try { if (window.localStorage) localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }

  var renderer = null, scene = null, cam = null;
  var rtScene = null, rtA = null, rtB = null, sizeKey = '';
  var quad = null, blitScene = null, blitCam = null;
  var matBright = null, matBlur = null, matComp = null;
  var broken = false;    // 建立失败就永久走直渲，别让光影把游戏搞崩

  var VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  var FS_BRIGHT = [
    'uniform sampler2D tSrc; uniform float thr; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv).rgb;',
    // 显示空间算亮度：像素风的"发光"就是接近白的块，阈值取高一点避免整屏糊
    '  float l = max(c.r, max(c.g, c.b));',
    '  float k = smoothstep(thr, thr + 0.16, l);',
    '  gl_FragColor = vec4(c * k, 1.0);',
    '}'
  ].join('\n');

  var FS_BLUR = [
    'uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;',
    'void main(){',
    '  vec3 s = texture2D(tSrc, vUv).rgb * 0.2270270270;',
    '  s += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;',
    '  s += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;',
    '  s += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;',
    '  s += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;',
    '  gl_FragColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var FS_COMP = [
    'uniform sampler2D tScene; uniform sampler2D tBloom;',
    'uniform float exposure, tone, bloomOn, strength, gradeOn, gradeAmount, vigOn, vigStrength, vigStart, vigEnd;',
    'uniform vec3 shadowCool, hotWarm;',
    'varying vec2 vUv;',
    'vec3 tonemapReinhard(vec3 c){ return c / (1.0 + c); }',
    'vec3 tonemapACES(vec3 c){',
    '  c = c * vec3(1.0359365339);',
    '  vec3 v = (c * (c + 0.0245759)) - 0.000090537;',
    '  vec3 u = c * ((c * 0.983729 + 0.4329510) + 0.238081);',
    '  return clamp(v / (u + 0.0384416), 0.0, 1.0);',
    '}',
    'void main(){',
    '  vec3 c = texture2D(tScene, vUv).rgb;',          // 显示空间值（场景 RT 的 encoding=sRGB）
    '  if (bloomOn > 0.5) c += texture2D(tBloom, vUv).rgb * strength;',
    '  c *= exposure;',
    '  if (tone > 0.5 && tone < 1.5) c = tonemapReinhard(max(vec3(0.0), c));',
    '  else if (tone > 1.5) c = tonemapACES(max(vec3(0.0), c));',
    '  c = clamp(c, 0.0, 1.0);',
    '  if (gradeOn > 0.5) {',
    '    float l = dot(c, vec3(0.299, 0.587, 0.114));',
    // 暗部偏冷、亮部偏暖：只在两端插值，中间保持原色，别把美术定的元素色洗掉
    '    float wDark = 1.0 - smoothstep(0.0, 0.55, l);',
    '    float wHot = smoothstep(0.58, 1.0, l);',
    '    c = mix(c, c * shadowCool, wDark * gradeAmount);',
    '    c = mix(c, c * hotWarm, wHot * gradeAmount);',
    '  }',
    '  if (vigOn > 0.5) {',
    '    float d = distance(vUv, vec2(0.5)) * 1.41421356;',
    '    c *= 1.0 - vigStrength * smoothstep(vigStart, vigEnd, d);',
    '  }',
    // 8bit 显示空间做暗角/分级会有带状，抖动用像素风常见的有序四格（比 hash 更像本作风格）
    '  vec2 q = floor(mod(gl_FragCoord.xy, 2.0));',
    '  float dith = (q.x + q.y * 2.0) / 4.0 - 0.375;',
    '  c += dith / 255.0;',
    '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  function mkMat(fs, uniforms) {
    var m = new THREE.ShaderMaterial({ uniforms: uniforms, vertexShader: VS, fragmentShader: fs,
      depthTest: false, depthWrite: false });
    m.toneMapped = false;   // 纪律 ①：否则中间 pass 又套一次色调映射
    m.fog = false;
    return m;
  }
  function mkRT(w, h) {
    var rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
      depthBuffer: false, stencilBuffer: false
    });
    rt.texture.generateMipmaps = false;
    return rt;
  }

  function build(w, h) {
    if (broken) return false;
    try {
      if (!rtScene) {
        rtScene = mkRT(w, h);
        rtScene.texture.encoding = THREE.sRGBEncoding;   // 关键：让内置材质把值编码进 RT，与今天渲到屏幕一致
        rtScene.depthBuffer = true;
        rtA = mkRT(Math.max(4, Math.floor(w / P.down)), Math.max(4, Math.floor(h / P.down)));
        rtB = mkRT(rtA.width, rtA.height);
        matBright = mkMat(FS_BRIGHT, { tSrc: { value: null }, thr: { value: P.thr } });
        matBlur = mkMat(FS_BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2(0, 0) } });
        matComp = mkMat(FS_COMP, {
          tScene: { value: null }, tBloom: { value: null }, exposure: { value: P.exposure }, tone: { value: 0 },
          bloomOn: { value: 1 }, strength: { value: P.strength }, gradeOn: { value: 1 }, gradeAmount: { value: P.gradeAmount },
          vigOn: { value: 1 }, vigStrength: { value: P.vigStrength }, vigStart: { value: P.vigStart }, vigEnd: { value: P.vigEnd },
          shadowCool: { value: new THREE.Vector3(0.88, 0.95, 1.06) }, hotWarm: { value: new THREE.Vector3(1.06, 1.0, 0.93) }
        });
        var geo = new THREE.PlaneGeometry(2, 2);
        quad = new THREE.Mesh(geo, matComp); quad.frustumCulled = false;
        blitScene = new THREE.Scene(); blitScene.add(quad);
        blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      } else if (rtScene.width !== w || rtScene.height !== h) {
        rtScene.setSize(w, h);
        var aw = Math.max(4, Math.floor(w / P.down)), ah = Math.max(4, Math.floor(h / P.down));
        rtA.setSize(aw, ah); rtB.setSize(aw, ah);
      }
      return true;
    } catch (e) { broken = true; if (window.console) console.warn('[光影] 建立失败，回退直渲：' + e.message); return false; }
  }

  function toneVal() { return P.tone === 'reinhard' ? 1 : (P.tone === 'aces' ? 2 : 0); }
  function syncUniforms() {
    matBright.uniforms.thr.value = P.thr;
    var u = matComp.uniforms;
    u.exposure.value = P.exposure; u.tone.value = toneVal();
    u.bloomOn.value = P.bloom ? 1 : 0; u.strength.value = P.strength;
    u.gradeOn.value = P.grade ? 1 : 0; u.gradeAmount.value = P.gradeAmount;
    u.vigOn.value = P.vignette ? 1 : 0; u.vigStrength.value = P.vigStrength;
    u.vigStart.value = P.vigStart; u.vigEnd.value = P.vigEnd;
    u.shadowCool.value.set(P.shadowCool[0], P.shadowCool[1], P.shadowCool[2]);
    u.hotWarm.value.set(P.hotWarm[0], P.hotWarm[1], P.hotWarm[2]);
  }
  /* 单位口径（r128 源码核对过）：setViewport/setScissor 的入参是 **CSS 像素**，three 内部再乘 pixelRatio。
     所以本文件全程用 CSS 像素传给 three；RT 的宽高才是设备像素。混用就会画面只画半屏或糊边。 */
  function blit(mat, target, cw, ch) {
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, cw, ch);
    quad.material = mat;
    renderer.render(blitScene, blitCam);
  }
  /* 主入口：替掉 main.js 里的 renderer.render(scene, cam)。
     x/y/w/h 是 **CSS 像素** 的屏幕区域（分屏时每人一半，与 main.js 现有 setViewport 同一口径）；
     光影关着或建立失败就走原生直渲——"关光影 == 现状"是验收口径，不能只测开的一边。 */
  function renderScene(re, sc, camera, x, y, w, h) {
    if (!re) return;
    renderer = re; scene = sc; cam = camera;
    if (!P.on || broken) { renderer.setRenderTarget(null); renderer.setViewport(x, y, w, h); renderer.render(sc, camera); return; }
    if (w <= 0 || h <= 0) return;
    var pr = renderer.getPixelRatio() || 1;
    if (!build(Math.max(4, Math.floor(w * pr)), Math.max(4, Math.floor(h * pr)))) {
      renderer.setRenderTarget(null); renderer.setViewport(x, y, w, h); renderer.render(sc, camera); return;
    }
    syncUniforms();
    var oldScissor = renderer.getScissorTest();
    renderer.setScissorTest(false);
    // 1) 场景 → rtScene
    renderer.setRenderTarget(rtScene);
    renderer.setViewport(0, 0, w, h);
    renderer.render(sc, camera);
    // 2) 亮度阈值 → rtA，两趟可分离模糊 rtA ↔ rtB（半分辨率，省的是平方级的像素数）
    var aw = rtA.width / pr, ah = rtA.height / pr;
    matBright.uniforms.tSrc.value = rtScene.texture;
    blit(matBright, rtA, aw, ah);
    var ux = 1 / rtA.width, uy = 1 / rtA.height, r = Math.max(0.25, P.radius);
    matBlur.uniforms.tSrc.value = rtA.texture; matBlur.uniforms.dir.value.set(ux * r, 0);
    blit(matBlur, rtB, aw, ah);
    matBlur.uniforms.tSrc.value = rtB.texture; matBlur.uniforms.dir.value.set(0, uy * r);
    blit(matBlur, rtA, aw, ah);
    // 3) 合成 → 屏幕的这块区域
    matComp.uniforms.tScene.value = rtScene.texture;
    matComp.uniforms.tBloom.value = rtA.texture;
    renderer.setRenderTarget(null);
    renderer.setScissorTest(oldScissor);
    if (oldScissor) renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    quad.material = matComp;
    renderer.render(blitScene, blitCam);
  }

  function enabled() { return P.on && !broken; }
  function spec() {
    return {
      on: P.on, broken: broken, exposure: P.exposure, tone: P.tone,
      bloom: P.bloom, thr: P.thr, strength: P.strength, radius: P.radius,
      grade: P.grade, gradeAmount: P.gradeAmount, vignette: P.vignette, vigStrength: P.vigStrength,
      rt: rtScene ? (rtScene.width + '×' + rtScene.height) : '未建立'
    };
  }
  // 布尔/字符串/数组要分开处理：以前一律 parseFloat，true 变成 NaN 被静默丢掉，
  // 于是 post_check 里"开了 bloom"的测量其实全程是关着的（数值全对，结论全错）。
  var BOOLS = { on: 1, bloom: 1, grade: 1, vignette: 1 };
  var NUMRANGE = { exposure: [0.5, 2.5], thr: [0, 1], strength: [0, 2], radius: [0.25, 4], down: [1, 4],
                   gradeAmount: [0, 1], vigStrength: [0, 0.6], vigStart: [0, 1], vigEnd: [0.2, 2] };
  function toBool(v) { return v === true || v === 1 || v === 'true' || v === '1'; }
  function set(k, v) {
    if (!(k in DEF)) return false;
    if (BOOLS[k]) { P[k] = toBool(v); }
    else if (k === 'tone') { P.tone = (v === 'reinhard' || v === 'aces') ? v : 'none'; }
    else if (k === 'shadowCool' || k === 'hotWarm') {
      if (typeof v === 'string') { var parts = v.split(','); v = parts.map(parseFloat); }
      if (!Array.isArray(v) || v.length !== 3 || v.some(function (x) { return !isFinite(x); })) return false;
      P[k] = [v[0], v[1], v[2]];
    } else if (NUMRANGE[k]) {
      var n = parseFloat(v); if (!isFinite(n)) return false;
      P[k] = Math.max(NUMRANGE[k][0], Math.min(NUMRANGE[k][1], n));
    } else return false;
    if (k === 'down' && rtScene) {
      var d = P.down;
      rtA.setSize(Math.max(4, Math.floor(rtScene.width / d)), Math.max(4, Math.floor(rtScene.height / d)));
      rtB.setSize(rtA.width, rtA.height);
    }
    persist(); return true;
  }
  function reset() { for (var k in DEF) P[k] = DEF[k]; persist(); }
  function toggle() { set('on', !P.on); return P.on; }
  // 验收用：全部旋钮拨到"无操作"，此时末 pass 等于原样搬运，画面应与关光影一致
  function neutralize() {
    P.on = true; P.exposure = 1; P.tone = 'none'; P.bloom = false; P.grade = false; P.vignette = false; P.strength = 0;
  }
  G.SHADER = { renderScene: renderScene, enabled: enabled, spec: spec, set: set, reset: reset, toggle: toggle,
    neutralize: neutralize, params: P, isBroken: function () { return broken; } };
})();
