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
    vignette: true, vigStrength: 0.11, vigStart: 0.66, vigEnd: 1.3,
    /* SSAO（屏幕空间环境光遮蔽）：MC 光影最容易被认出来的那一层——方块缝、墙根、
       树下的接触阴影。默认开，neutralize() 会关掉它，"关光影 == 现状"仍然成立。 */
    ssao: true, ssaoStrength: 0.38, ssaoRadius: 0.45,
    /* 太阳光束（god rays）：把已算好的 bloom 亮部沿"像素→太阳"方向做径向累积。
       不额外做体积步进/阴影贴图，是"看起来像 MC 光影"里最便宜的一档。 */
    rays: true, raysStrength: 0.12
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
  var rtScene = null, rtA = null, rtB = null, rtAO = null, rtAO2 = null, sizeKey = '';
  var _sunV = new THREE.Vector3(), _fwdV = new THREE.Vector3();
  var quad = null, blitScene = null, blitCam = null;
  var matBright = null, matBlur = null, matComp = null, matAO = null;
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

  var FS_AO = [
    'uniform sampler2D tDepth; uniform vec2 uRes; uniform mat4 uProjInv;',
    'uniform float uNear, uFar, uRadius, uStrength;',
    'varying vec2 vUv;',
    'float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }',
    'vec3 viewPos(vec2 uv, float d){',
    '  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);',
    '  vec4 v = uProjInv * clip; return v.xyz / v.w;',
    '}',
    'void main(){',
    '  float d = texture2D(tDepth, vUv).x;',
    '  if (d >= 0.99995) { gl_FragColor = vec4(1.0); return; }',
    '  vec3 p = viewPos(vUv, d);',
    '  /* 由相邻像素的视空间位置叉乘出法线：不额外占一张 normal RT，体素世界的面法线本来就硬 */',
    '  vec2 tx = vec2(1.0 / uRes.x, 0.0), ty = vec2(0.0, 1.0 / uRes.y);',
    '  vec3 pr = viewPos(vUv + tx, texture2D(tDepth, vUv + tx).x);',
    '  vec3 pu = viewPos(vUv + ty, texture2D(tDepth, vUv + ty).x);',
    '  vec3 n = normalize(cross(pr - p, pu - p));',
    '  if (dot(n, -p) < 0.0) n = -n;',
    '  float occ = 0.0, rad = uRadius;',
    '  for (int i = 0; i < 8; i++) {',
    '    float a = float(i) * 2.39996323;',
    '    float rr = rad * (0.35 + 0.65 * fract(float(i) * 0.6180339));',
    '    vec2 off = vec2(cos(a), sin(a)) * rr / max(0.35, -p.z) * 0.32;',
    '    vec2 uv2 = clamp(vUv + off, vec2(0.002), vec2(0.998));',
    '    float d2 = texture2D(tDepth, uv2).x;',
    '    if (d2 >= 0.99995) continue;',
    '    vec3 sp = viewPos(uv2, d2);',
    '    float dz = sp.z - p.z;',
    '    if (dz > 0.05 && dz < rad) {',
    '      vec3 v = sp - p; float vv = dot(v, v);',
    '      float nd = max(0.0, dot(n, v) / max(0.0001, sqrt(vv)));',
    '      occ += nd * (1.0 - smoothstep(rad * 0.55, rad, sqrt(vv)));',
    '    }',
    '  }',
    '  float ao = 1.0 - clamp(occ / 8.0 * uStrength * 2.0, 0.0, 0.85);',
    '  gl_FragColor = vec4(vec3(ao), 1.0);',
    '}'
  ].join('\n');

  var FS_COMP = [
    'uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tAO;',
    'uniform vec2 uSunUV; uniform float sunOn, raysOn, raysStrength;',
    'uniform float exposure, tone, bloomOn, strength, gradeOn, gradeAmount, vigOn, vigStrength, vigStart, vigEnd;',
    'uniform float ssaoOn, ssaoStrength, debugAO;',
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
    '  if (debugAO > 0.5) { gl_FragColor = vec4(vec3(texture2D(tAO, vUv).r), 1.0); return; }',
    '  vec3 c = texture2D(tScene, vUv).rgb;',          // 显示空间值（场景 RT 的 encoding=sRGB）
    '  if (ssaoOn > 0.5) c *= mix(1.0, texture2D(tAO, vUv).r, ssaoStrength);',
    '  if (bloomOn > 0.5) c += texture2D(tBloom, vUv).rgb * strength;',
    '  if (raysOn > 0.5 && sunOn > 0.5) {',
    '    vec2 toSun = uSunUV - vUv;',
    '    vec3 rays = vec3(0.0);',
    '    for (int i = 0; i < 8; i++) {',
    '      vec2 uv = vUv + toSun * (float(i) / 8.0);',
    '      rays += texture2D(tBloom, clamp(uv, vec2(0.001), vec2(0.999))).rgb;',
    '    }',
    '    float edge = 1.0 - smoothstep(0.05, 0.95, length(toSun));',
    '    c += rays * (raysStrength * 0.125) * edge;',
    '  }',
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
        /* 深度纹理给 SSAO 用：重建视空间位置，才能量"这块像素旁边有没有挡住它的东西"。
           WebGL2 的 DepthTexture 可用（本项目已在运行时确认 WebGL2）；建失败就 broken -> 直渲。 */
        if (THREE.DepthTexture) {
          rtScene.depthTexture = new THREE.DepthTexture(w, h);
          rtScene.depthTexture.type = THREE.UnsignedIntType;
          rtScene.depthTexture.minFilter = THREE.NearestFilter;
          rtScene.depthTexture.magFilter = THREE.NearestFilter;
        }
        rtA = mkRT(Math.max(4, Math.floor(w / P.down)), Math.max(4, Math.floor(h / P.down)));
        rtB = mkRT(rtA.width, rtA.height);
        var aow = Math.max(4, Math.floor(w / 2)), aoh = Math.max(4, Math.floor(h / 2));
        rtAO = mkRT(aow, aoh); rtAO2 = mkRT(aow, aoh);
        matBright = mkMat(FS_BRIGHT, { tSrc: { value: null }, thr: { value: P.thr } });
        matBlur = mkMat(FS_BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2(0, 0) } });
        matAO = mkMat(FS_AO, {
          tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
          uProjInv: { value: new THREE.Matrix4() }, uNear: { value: 0.08 }, uFar: { value: 260 },
          uRadius: { value: P.ssaoRadius }, uStrength: { value: P.ssaoStrength }
        });
        matComp = mkMat(FS_COMP, {
          tScene: { value: null }, tBloom: { value: null }, tAO: { value: null }, exposure: { value: P.exposure }, tone: { value: 0 },
          uSunUV: { value: new THREE.Vector2(-1, -1) }, sunOn: { value: 0 }, raysOn: { value: 1 }, raysStrength: { value: P.raysStrength },
          bloomOn: { value: 1 }, strength: { value: P.strength }, gradeOn: { value: 1 }, gradeAmount: { value: P.gradeAmount },
          vigOn: { value: 1 }, vigStrength: { value: P.vigStrength }, vigStart: { value: P.vigStart }, vigEnd: { value: P.vigEnd },
          ssaoOn: { value: 1 }, ssaoStrength: { value: P.ssaoStrength }, debugAO: { value: 0 },
          shadowCool: { value: new THREE.Vector3(0.88, 0.95, 1.06) }, hotWarm: { value: new THREE.Vector3(1.06, 1.0, 0.93) }
        });
        var geo = new THREE.PlaneGeometry(2, 2);
        quad = new THREE.Mesh(geo, matComp); quad.frustumCulled = false;
        blitScene = new THREE.Scene(); blitScene.add(quad);
        blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      } else if (rtScene.width !== w || rtScene.height !== h) {
        rtScene.setSize(w, h);
        if (rtScene.depthTexture) rtScene.depthTexture.image = { width: w, height: h };
        var aw = Math.max(4, Math.floor(w / P.down)), ah = Math.max(4, Math.floor(h / P.down));
        rtA.setSize(aw, ah); rtB.setSize(aw, ah);
        var aow2 = Math.max(4, Math.floor(w / 2)), aoh2 = Math.max(4, Math.floor(h / 2));
        rtAO.setSize(aow2, aoh2); rtAO2.setSize(aow2, aoh2);
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
    u.debugAO.value = P.debugAO ? 1 : 0;
    u.ssaoOn.value = P.ssao ? 1 : 0;
    u.raysOn.value = (P.rays && P.bloom) ? 1 : 0;
    u.raysStrength.value = P.raysStrength;
    u.ssaoStrength.value = 1.0;                 // 强度在 AO pass 里乘一次，别在这里乘第二遍
    if (matAO) { matAO.uniforms.uStrength.value = P.ssaoStrength; matAO.uniforms.uRadius.value = P.ssaoRadius; }
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
    G.SHADER._renderer = re;
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
    /* gbuffers_terrain 单输出子集：用包自己的地形 shader 画进 gcolor，再跑 composite/final。 */
    if (G.ShaderPack && G.ShaderPack.gbufferActive && G.ShaderPack.gbufferActive()) {
      if (G.ShaderPack.renderGBuffer(renderer, sc, camera, rtScene, x, y, w, h)) return;
    }
    renderer.render(sc, camera);
    /* 光影包子集（src/shaderpack.js）：只跑一 pass 后处理。
       成功就直接出屏并跳过自研 bloom/合成；失败/不支持则 active=false，继续走原管线。 */
    if (G.ShaderPack && G.ShaderPack.active && G.ShaderPack.active()) {
      if (G.ShaderPack.render(renderer, rtScene, camera, x, y, w, h)) return;
    }
    // 2) 亮度阈值 → rtA，两趟可分离模糊 rtA ↔ rtB（半分辨率，省的是平方级的像素数）
    var aw = rtA.width / pr, ah = rtA.height / pr;
    /* SSAO：半分辨率，先算 AO，再做一次可分离模糊（复用 bloom 的 5-tap 模糊材质，之后会重设它的 uniform） */
    if (P.ssao && rtScene.depthTexture && matAO) {
      var aow = rtAO.width / pr, aoh = rtAO.height / pr;
      var ao = matAO.uniforms;
      ao.tDepth.value = rtScene.depthTexture;
      ao.uRes.value.set(rtAO.width, rtAO.height);
      ao.uProjInv.value.copy(camera.projectionMatrixInverse);
      ao.uNear.value = camera.near; ao.uFar.value = camera.far;
      blit(matAO, rtAO, aow, aoh);
      matBlur.uniforms.tSrc.value = rtAO.texture; matBlur.uniforms.dir.value.set(1 / rtAO.width, 0);
      blit(matBlur, rtAO2, aow, aoh);
      matBlur.uniforms.tSrc.value = rtAO2.texture; matBlur.uniforms.dir.value.set(0, 1 / rtAO.height);
      blit(matBlur, rtAO, aow, aoh);
      matComp.uniforms.tAO.value = rtAO.texture;
    }
    /* bloom 关着就整段跳过：以前只是把 uniform 置 0，三个全屏 pass 照跑不误——
       低画质档把后处理关掉时，省下的正是这三趟（SwiftShader/集显上很实在）。 */
    if (P.bloom) {
      matBright.uniforms.tSrc.value = rtScene.texture;
      blit(matBright, rtA, aw, ah);
      var ux = 1 / rtA.width, uy = 1 / rtA.height, r = Math.max(0.25, P.radius);
      matBlur.uniforms.tSrc.value = rtA.texture; matBlur.uniforms.dir.value.set(ux * r, 0);
      blit(matBlur, rtB, aw, ah);
      matBlur.uniforms.tSrc.value = rtB.texture; matBlur.uniforms.dir.value.set(0, uy * r);
      blit(matBlur, rtA, aw, ah);
    }
    /* 太阳在屏幕上的位置：投影一个"相机前方 80 格、沿 G.SUN_DIR"的点。
       相机背后/太偏就 sunOn=0，避免把画面另一侧的光糊成假光束。 */
    var sunOn = 0, su = matComp.uniforms.uSunUV.value;
    if (P.rays && P.bloom && G.SUN_DIR) {
      _sunV.set(G.SUN_DIR[0], G.SUN_DIR[1], G.SUN_DIR[2]);
      camera.getWorldDirection(_fwdV);
      if (_sunV.dot(_fwdV) > 0.08) {
        _sunV.multiplyScalar(80).add(camera.position).project(camera);
        if (_sunV.z < 1) {
          su.set(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5);
          if (su.x > -0.4 && su.x < 1.4 && su.y > -0.4 && su.y < 1.4) sunOn = 1;
        }
      }
    }
    matComp.uniforms.sunOn.value = sunOn;
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
      ssao: P.ssao, ssaoStrength: P.ssaoStrength, ssaoRadius: P.ssaoRadius,
      rays: P.rays, raysStrength: P.raysStrength,
      rt: rtScene ? (rtScene.width + '×' + rtScene.height) : '未建立'
    };
  }
  // 布尔/字符串/数组要分开处理：以前一律 parseFloat，true 变成 NaN 被静默丢掉，
  // 于是 post_check 里"开了 bloom"的测量其实全程是关着的（数值全对，结论全错）。
  var BOOLS = { on: 1, bloom: 1, grade: 1, vignette: 1, ssao: 1, rays: 1 };
  var NUMRANGE = { exposure: [0.5, 2.5], thr: [0, 1], strength: [0, 2], radius: [0.25, 4], down: [1, 4],
                   gradeAmount: [0, 1], vigStrength: [0, 0.6], vigStart: [0, 1], vigEnd: [0.2, 2],
                   ssaoStrength: [0, 1.5], ssaoRadius: [0.2, 2], raysStrength: [0, 0.6] };
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
  function debugAO(on) { P.debugAO = !!on; return P.debugAO; }
  function toggle() { set('on', !P.on); return P.on; }
  // 验收用：全部旋钮拨到"无操作"，此时末 pass 等于原样搬运，画面应与关光影一致
  function neutralize() {
    P.on = true; P.exposure = 1; P.tone = 'none'; P.bloom = false; P.grade = false; P.vignette = false; P.strength = 0;
    P.ssao = false; P.ssaoStrength = 0; P.rays = false; P.raysStrength = 0;
  }
  G.SHADER = { renderScene: renderScene, enabled: enabled, spec: spec, set: set, reset: reset, toggle: toggle, debugAO: debugAO, _renderer: null,
    neutralize: neutralize, params: P, isBroken: function () { return broken; } };
})();
