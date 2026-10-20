/* src/shaderpack.js · MC 光影包「后处理子集」兼容层（实验）
   目标不是假装兼容全部 OptiFine/Iris：本层只做**能安全落地的一小段**——
     读取 .zip 里的 shaders/final.fsh 或 shaders/composite.fsh（单 pass），
     把本局已经渲染好的场景色/深度以 colortex0 / depthtex0 喂进去，
     用全屏 quad 跑这一趟，输出到屏幕。
   不支持：gbuffers_*（地形/实体 shader）、shadow/shadowcomp、deferred、多 RT 输出、
   GLSL 330 的 in/out（会明确报错并回落自研管线）。这就是“子集”的边界，状态行会写清楚。
   分层：本文件零 DOM / 零玩家可见文案；UI 只显示 status() 的 key/数字。
   安全：单文件与整包大小上限、编译失败/运行失败都回退原管线，不会把游戏搞黑。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  if (typeof THREE === 'undefined') { G.ShaderPack = { status: function () { return { active: false, error: 'no-three' }; }, loadFile: function () { return Promise.reject(new Error('no-three')); }, unload: function () { }, active: function () { return false; } }; return; }

  var MAX_ZIP = 24 * 1024 * 1024, MAX_FILE = 8 * 1024 * 1024;
  var st = { active: false, name: '', pass: '', error: '', detail: '', notes: [] };
  var passes = [], rtA = null, rtB = null, rtW = 0, rtH = 0, glRef = null, quad = null, tex = {}, unitSeq = 0;
  var gbufMat = null, gbufActive = false;
  var sceneTexRef = null, depthTexRef = null, atlasRef = null;
  var frameNo = 0;

  function status() { return { active: st.active, name: st.name, pass: st.pass, error: st.error, detail: st.detail, notes: st.notes.slice(0, 6), gbuffer: gbufActive }; }
  function fail(code, detail) { st.error = String(code || 'unknown'); st.detail = String(detail || ''); st.active = false; gbufActive = false; if (window.console) console.warn('[shaderpack] ' + st.error + (detail ? ' · ' + detail : '')); }

  /* ---------- zip：只认 store/deflate，中央目录为准 ---------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('decompress-unsupported');
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    if (buf && buf.buffer && !(buf instanceof ArrayBuffer)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    if (!(buf instanceof ArrayBuffer)) throw new Error('not-binary');
    if (buf.byteLength > MAX_ZIP) throw new Error('too-big');
    var dv = new DataView(buf), eocd = -1;
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('bad-zip');
    var count = dv.getUint16(eocd + 10, true), cd = dv.getUint32(eocd + 16, true);
    var p = cd, files = {}, dec = new TextDecoder();
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad-zip');
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true), name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      p += 46 + nameLen + extraLen + commLen;
      if (!name || name.charAt(name.length - 1) === '/' || name.indexOf('__MACOSX/') === 0) continue;
      if (usize > MAX_FILE) throw new Error('file-too-big');
      var ln = dv.getUint16(lho + 26, true), le = dv.getUint16(lho + 28, true), start = lho + 30 + ln + le;
      var raw = new Uint8Array(buf, start, csize);
      files[name] = method === 0 ? raw.slice() : await inflateRaw(raw);
    }
    return files;
  }
  function textOf(files, name) { var b = files[name]; return b ? new TextDecoder().decode(b) : null; }

  /* ---------- GLSL：去掉 desktop #version，补 include，拒多 RT/330 ---------- */
  function resolveIncludes(src, files, depth) {
    depth = depth || 0;
    if (depth > 8) return src;
    return src.replace(/#include\s+"([^"]+)"/g, function (m, inc) {
      var norm = inc.replace(/^\//, '');
      var cands = ['shaders/' + norm, 'shaders/lib/' + norm, norm, inc];
      for (var i = 0; i < cands.length; i++) {
        var t = textOf(files, cands[i]); if (t) return resolveIncludes(t, files, depth + 1);
      }
      return '/* missing include ' + inc + ' */';
    });
  }
  function relaxConsts(src) {
    /* GLSL ES 1.00 比 desktop GLSL 严：float / const int 会报错。教程包用
       SHADOW_BIAS / shadowMapResolution，这里把常见的 shadowMapResolution 改成 float。 */
    return String(src || '').replace(/const\s+int\s+shadowMapResolution\s*=\s*(\d+)\s*;/g, 'const float shadowMapResolution = $1.0;');
  }
  function prepFragment(src, files) {
    src = relaxConsts(resolveIncludes(String(src || ''), files));
    src = src.replace(/#version[^\n]*\n/g, '');
    if (/gl_FragData\s*\[\s*[1-9]/.test(src)) throw new Error('multi-rt');
    src = src.replace(/gl_FragData\s*\[\s*0\s*\]/g, 'gl_FragColor');
    /* 部分 330 包写成 layout(location=0) out vec4 fragColor；单输出可以改名成 gl_FragColor。 */
    var outName = null;
    src = src.replace(/layout\s*\([^)]*\)\s*out\s+vec4\s+([A-Za-z_]\w*)\s*;/g, function (m, n) { outName = n; return ''; });
    src = src.replace(/\bout\s+vec4\s+([A-Za-z_]\w*)\s*;/g, function (m, n) { outName = n; return ''; });
    if (/\bout\s+/.test(src)) throw new Error('multi-out');
    if (outName) src = src.replace(new RegExp('\\b' + outName + '\\b', 'g'), 'gl_FragColor');
    src = src.replace(/\btexture\s*\(/g, 'texture2D(');
    src = src.replace(/\bin\s+(?=(?:vec[234]|float|int|mat[234]|sampler2D)\b)/g, 'varying ');
    if (!/precision\s+(lowp|mediump|highp)\s+float/.test(src)) src = 'precision highp float;\n' + src;
    return src;
  }

  var VS_SRC = [
    'attribute vec2 aPos;',
    'varying vec2 texcoord;',
    'void main(){ texcoord = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s) || 'compile failed';
      if (window.console) console.warn('[shaderpack] compile: ' + log);
      gl.deleteShader(s); throw new Error('compile');
    }
    return s;
  }
  function makeTex(gl, w, h, rgba) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function ensureTex(gl) {
    if (tex.white) return;
    tex.white = makeTex(gl, 1, 1, [255, 255, 255, 255]);
    tex.black = makeTex(gl, 1, 1, [0, 0, 0, 0]);
    tex.depth = makeTex(gl, 1, 1, [0, 0, 0, 255]);
    var n = 64, arr = new Uint8Array(n * n * 4), r = 1234567;
    for (var i = 0; i < n * n; i++) { r = (r * 1664525 + 1013904223) >>> 0; arr[i * 4] = r & 255; arr[i * 4 + 1] = (r >>> 8) & 255; arr[i * 4 + 2] = (r >>> 16) & 255; arr[i * 4 + 3] = 255; }
    tex.noise = makeTex(gl, n, n, arr);
    var lm = 16, la = new Uint8Array(lm * lm * 4);
    for (var y = 0; y < lm; y++) { var v = Math.round(y / (lm - 1) * 255); for (var x = 0; x < lm; x++) { var o = (y * lm + x) * 4; la[o] = la[o + 1] = la[o + 2] = v; la[o + 3] = 255; } }
    tex.lightmap = makeTex(gl, lm, lm, la);
  }
  function texGL(renderer, t) {
    if (!t || !renderer.properties) return null;
    var p = renderer.properties.get(t);
    return p && p.__webglTexture ? p.__webglTexture : null;
  }
  function getQuad(gl) {
    if (quad) return quad;
    var vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    quad = { vao: vao, buf: buf }; return quad;
  }

  function build(renderer, files, passNames) {
    var gl = renderer.getContext();
    var vs = compile(gl, gl.VERTEX_SHADER, VS_SRC);
    var old = passes; passes = [];
    try {
      for (var pi = 0; pi < passNames.length; pi++) {
        var rawSrc = textOf(files, passNames[pi]);
        var fsSrc = prepFragment(rawSrc, files);
        var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
        var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
        gl.deleteShader(fs);
        var uni = [], n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) {
          var u = gl.getActiveUniform(p, i); if (!u) continue;
          uni.push({ name: String(u.name).replace(/\[0\]$/, ''), type: u.type, loc: gl.getUniformLocation(p, u.name), size: u.size });
        }
        passes.push({ name: passNames[pi], program: p, uniforms: uni });
      }
    } catch (e) {
      for (var k = 0; k < passes.length; k++) gl.deleteProgram(passes[k].program);
      passes = old; throw e;
    }
    gl.deleteShader(vs);
    for (var j = 0; j < old.length; j++) gl.deleteProgram(old[j].program);
    glRef = gl; ensureTex(gl); getQuad(gl);
    st.pass = passNames.map(function (n) { return n.replace(/^shaders\//, ''); }).join(' \u2192 ');
    st.notes = [];
    if (window.console) console.info('[shaderpack] subset chain: ' + st.pass);
  }

  function setUniforms(pass, renderer, camera, w, h, colorTex) {
    var gl = glRef; if (!gl) return;
    var sun = G.SUN_DIR || [0.65, 0.95, 0.42];
    var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    var unit = 1;
    gl.useProgram(pass.program);
    for (var i = 0; i < pass.uniforms.length; i++) {
      var u = pass.uniforms[i], loc = u.loc, nm = u.name;
      if (u.type === gl.SAMPLER_2D) {
        var tgl = tex.white;
        if (nm === 'colortex0' || nm === 'gcolor') tgl = colorTex || sceneTexRef || tex.white;
        else if (nm === 'depthtex0' || nm === 'depthtex1' || nm === 'gdepth') tgl = depthTexRef || tex.depth;
        else if (nm.indexOf('shadow') >= 0) tgl = depthTexRef || tex.depth;
        else if (nm.indexOf('noise') >= 0) tgl = tex.noise;
        else if (nm === 'texture') tgl = atlasRef || tex.white;
        else tgl = tex.white;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tgl);
        gl.uniform1i(loc, unit); unit++;
        if (unit > 15) unit = 1;
        continue;
      }
      switch (nm) {
        case 'viewWidth': gl.uniform1f(loc, w); break;
        case 'viewHeight': gl.uniform1f(loc, h); break;
        case 'frameTimeCounter': gl.uniform1f(loc, t); break;
        case 'frameCounter': gl.uniform1i(loc, frameNo); break;
        case 'rainStrength': case 'wetness': case 'isEyeInWater': gl.uniform1f(loc, 0); break;
        case 'sunAngle': gl.uniform1f(loc, Math.asin(Math.max(-1, Math.min(1, sun[1])))); break;
        case 'sunPosition': gl.uniform3f(loc, sun[0] * 100, sun[1] * 100, sun[2] * 100); break;
        case 'moonPosition': gl.uniform3f(loc, -sun[0] * 100, -sun[1] * 100, -sun[2] * 100); break;
        case 'cameraPosition': gl.uniform3f(loc, camera.position.x, camera.position.y, camera.position.z); break;
        case 'gbufferProjection': gl.uniformMatrix4fv(loc, false, camera.projectionMatrix.elements); break;
        case 'gbufferProjectionInverse': gl.uniformMatrix4fv(loc, false, camera.projectionMatrixInverse.elements); break;
        case 'gbufferModelView': gl.uniformMatrix4fv(loc, false, camera.matrixWorldInverse.elements); break;
        case 'gbufferModelViewInverse': gl.uniformMatrix4fv(loc, false, camera.matrixWorld.elements); break;
        default: break;
      }
    }
  }
  /* ---------- gbuffer_terrain（单输出子集） ----------
     只认 gbuffers_terrain 且 FS 只有一个 gl_FragData[0] 的包；把本作体素网格
     用该包的 VS/FS 画进 gcolor，再跑 composite/final 链。阴影贴图/材质图仍是 1x1 占位，
     所以颜色/贴图/雾是包的，阴影与 PBR 不完整；多 RT（DRAWBUFFERS:01）会拒绝。 */
  function gbufBuild(renderer, files) {
    var gl = renderer.getContext();
    if (gbufMat) { gbufMat.dispose(); gbufMat = null; }
    var vsRaw = relaxConsts(resolveIncludes(textOf(files, 'shaders/gbuffers_terrain.vsh') || '', files));
    var fsRaw = relaxConsts(textOf(files, 'shaders/gbuffers_terrain.fsh') || '');
    var fsPre = prepFragment(fsRaw, files);
    if (/gl_FragData\s*\[\s*[1-9]/.test(fsRaw)) throw new Error('needs-mrt');
    vsRaw = vsRaw.replace(/#version[^\n]*\n/g, '').replace(/#extension[^\n]*\n/g, '');
    vsRaw = vsRaw.replace(/^\s*attribute\s+vec4\s+mc_Entity\s*;\s*$/mg, '');
    vsRaw = vsRaw.replace(/\bmc_Entity\b/g, 'vec4(-1.0)');
    vsRaw = vsRaw.replace(/gl_TextureMatrix\s*\[\s*[01]\s*\]/g, 'mat4(1.0)');
    vsRaw = vsRaw.replace(/#define\s+SHADOW_DISTORT_ENABLED/g, '// shadow distortion disabled for linear depth map');
    fsPre = fsPre.replace(/#define\s+SHADOW_DISTORT_ENABLED/g, '// shadow distortion disabled for linear depth map');
    var pre = [
      'precision highp float;',
      'attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute vec3 color;',
      'uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; uniform mat3 normalMatrix;',
      '#define gl_Vertex vec4(position,1.0)',
      '#define gl_Normal normal',
      '#define gl_Color vec4(color,1.0)',
      '#define gl_MultiTexCoord0 vec4(uv,0.0,1.0)',
      '#define gl_MultiTexCoord1 vec4(0.5,1.0,0.0,1.0)',
      '#define gl_ModelViewMatrix modelViewMatrix',
      '#define gl_ProjectionMatrix projectionMatrix',
      '#define gl_NormalMatrix normalMatrix'
    ].join('\n') + '\n';
    var vsSrc = pre + vsRaw;
    // 先手动编译一次，错误在 load 阶段就报，而不是等到渲染时三三才在控制台里喊
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsPre);
    var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'position'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (window.console) console.warn('[shaderpack] gbuffer link: ' + (gl.getProgramInfoLog(p) || ''));
      throw new Error('compile');
    }
    gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(p);
    gbufMat = new THREE.RawShaderMaterial({
      vertexShader: vsSrc,
      fragmentShader: fsPre,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      uniforms: {
        texture: { value: null },
        lightmap: { value: tex.lightmap },
        shadowtex0: { value: tex.white },
        shadowtex1: { value: tex.white },
        shadowcolor0: { value: tex.white },
        gbufferModelView: { value: new THREE.Matrix4() },
        gbufferModelViewInverse: { value: new THREE.Matrix4() },
        shadowModelView: { value: new THREE.Matrix4() },
        shadowProjection: { value: new THREE.Matrix4() },
        shadowLightPosition: { value: new THREE.Vector3() }
      }
    });
  }

  function renderGBuffer(renderer, scene, camera, rt, x, y, w, h) {
    if (!gbufActive || !gbufMat || !rt) return false;
    var group = scene.userData && scene.userData.worldGroup;
    if (!group) {
      var best = null, bestN = 0;
      scene.children.forEach(function (c) {
        var n = 0; c.traverse && c.traverse(function (o) { if (o.isMesh) n++; });
        if (n > bestN) { bestN = n; best = c; }
      });
      group = best;
    }
    if (!group) return false;
    var vis = [], mats = [], meshes = [], atlas = null;
    group.traverse(function (o) {
      if (o.isMesh) {
        meshes.push(o); mats.push(o.material);
        if (!atlas && o.material && o.material.map) atlas = o.material.map;
        o.material = gbufMat;
      }
    });
    if (!meshes.length) return false;
    scene.children.forEach(function (c) { vis.push([c, c.visible]); c.visible = (c === group); });
    var oldTarget = renderer.getRenderTarget();
    var oldClear = renderer.getClearColor(new THREE.Color()).clone();
    var oldAlpha = renderer.getClearAlpha();
    var oldAuto = renderer.autoClear;
    var u = gbufMat.uniforms, sd = G.SUN_DIR || [0.65, 0.95, 0.42];
    try {
      u.texture.value = atlas || tex.white;
      u.lightmap.value = tex.lightmap;
      u.shadowcolor0.value = tex.white;
      u.gbufferModelView.value.copy(camera.matrixWorldInverse);
      u.gbufferModelViewInverse.value.copy(camera.matrixWorld);
      u.shadowLightPosition.value.set(sd[0], sd[1], sd[2]);
      /* 阴影贴图先不接：当前真实包只跑 gbuffer_terrain + composite 的字面路径。 */
      /* gcolor → rt */
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x87ceeb, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      /* 地形已经进 gcolor；再把天空/云/实体/特效按本作材质画到同一张 RT 上，
         共享地形的深度缓冲。这样启用真实包时不会只剩一块地形。 */
      scene.children.forEach(function (c) { c.visible = (c !== group); });
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = oldAuto;
    } finally {
      for (var i = 0; i < meshes.length; i++) meshes[i].material = mats[i];
      for (var j = 0; j < vis.length; j++) vis[j][0].visible = vis[j][1];
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(oldClear, oldAlpha);
      renderer.autoClear = oldAuto;
    }
    /* gcolor 已经在该 rt 里，接着跑 composite/final 链到屏幕 */
    return render(renderer, rt, camera, x, y, w, h);
  }

  function render(renderer, sceneRT, camera, x, y, w, h) {
    if (!st.active || !passes.length || !glRef) return false;
    var gl = glRef;
    try {
      if (!sceneRT || !sceneRT.texture) { fail('no-scene-rt'); return false; }
      sceneTexRef = texGL(renderer, sceneRT.texture);
      depthTexRef = sceneRT.depthTexture ? texGL(renderer, sceneRT.depthTexture) : null;
      var pr = renderer.getPixelRatio() || 1;
      var vw = Math.max(1, Math.floor(w * pr)), vh = Math.max(1, Math.floor(h * pr));
      var vx = Math.floor(x * pr), vy = Math.floor(y * pr);
      if (!rtA) {
        var opt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false };
        rtA = new THREE.WebGLRenderTarget(vw, vh, opt); rtB = new THREE.WebGLRenderTarget(vw, vh, opt);
        rtW = vw; rtH = vh;
      } else if (rtW !== vw || rtH !== vh) {
        rtA.setSize(vw, vh); rtB.setSize(vw, vh); rtW = vw; rtH = vh;
      }
      var oldProg = gl.getParameter(gl.CURRENT_PROGRAM);
      var oldView = gl.getParameter(gl.VIEWPORT);
      var oldScissor = gl.getParameter(gl.SCISSOR_TEST);
      var oldBox = gl.getParameter(gl.SCISSOR_BOX);
      renderer.setScissorTest(false);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      var prevTex = sceneTexRef;
      var q = getQuad(gl);
      for (var i = 0; i < passes.length; i++) {
        var last = i === passes.length - 1;
        var target = last ? null : (i % 2 === 0 ? rtA : rtB);
        renderer.setRenderTarget(target);
        if (last) {
          gl.viewport(vx, vy, vw, vh);
          if (oldScissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(vx, vy, vw, vh); }
          else gl.disable(gl.SCISSOR_TEST);
        } else {
          gl.viewport(0, 0, vw, vh);
          gl.disable(gl.SCISSOR_TEST);
          gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        }
        setUniforms(passes[i], renderer, camera, vw, vh, prevTex);
        gl.bindVertexArray(q.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
        if (!last) prevTex = texGL(renderer, target.texture);
      }
      renderer.setRenderTarget(null);
      gl.useProgram(oldProg);
      gl.viewport(oldView[0], oldView[1], oldView[2], oldView[3]);
      renderer.setScissorTest(!!oldScissor);
      gl.scissor(oldBox[0], oldBox[1], oldBox[2], oldBox[3]);
      gl.activeTexture(gl.TEXTURE0);
      frameNo++;
      st.error = '';
      return true;
    } catch (e) { fail((e && e.message) || e); return false; }
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function loadBuffer(buf, name, retry) {
    st.name = name || 'shaderpack.zip'; st.active = false; st.error = ''; st.detail = ''; st.notes = [];
    try {
      var files = await unzip(buf);
      /* 有 gbuffers/shadow/deferred 的包不是"后处理子集"能装下的：
         它们需要地形/实体的法线、材质、阴影图；硬跑 final 会得到灰白/错色的画面。
         与其给玩家一个"看起来坏了"的成功，不如明确拒绝并保留自研管线。 */
      var hasTerrain = !!(files['shaders/gbuffers_terrain.vsh'] && files['shaders/gbuffers_terrain.fsh']);
      var needsG = Object.keys(files).some(function (k) { return /shaders\/(gbuffers_|shadow|deferred)/.test(k); });
      if (needsG && !hasTerrain) throw new Error('needs-gbuffers');
      /* 后处理链：composite → composite1..15 → final；中间结果用两张 RT ping-pong。
         真实包还可能有多 RT 输出，那不在子集内（prepFragment 会报 multi-rt）。 */
      var names = [];
      if (files['shaders/composite.fsh']) names.push('shaders/composite.fsh');
      for (var ci = 1; ci <= 15; ci++) { var f = 'shaders/composite' + ci + '.fsh'; if (files[f]) names.push(f); }
      if (files['shaders/final.fsh']) names.push('shaders/final.fsh');
      if (!names.length) throw new Error('no-final');
      /* 先让渲染器建一次 WebGL 上下文/纹理属性：load 可能发生在菜单，renderer 由 G.SHADER 持有 */
      var re = G.SHADER && G.SHADER._renderer ? G.SHADER._renderer : null;
      if (!re) throw new Error('no-renderer');
      build(re, files, names);
      if (hasTerrain) { gbufBuild(re, files); gbufActive = true; }
      else gbufActive = false;
      st.active = true; st.error = '';
      return status();
    } catch (e) {
      /* 菜单里加载时 SwiftShader 可能还没编译完内置材质：空 infoLog 的 compile failed 重试一次，
         不是把真正的语法错误无限重试。 */
      if (!retry && /^compile$/.test((e && e.message) || '')) {
        await sleep(900);
        return loadBuffer(buf, name, true);
      }
      fail((e && e.message) || e); return status();
    }
  }
  async function loadFile(file) {
    if (!file) return fail('no-file'), status();
    st.name = file.name || 'shaderpack.zip';
    try { return await loadBuffer(await file.arrayBuffer(), st.name); }
    catch (e) { fail((e && e.message) || e); return status(); }
  }
  function unload() {
    st.active = false; st.error = ''; st.detail = ''; st.pass = ''; st.notes = [];
    if (glRef) for (var i = 0; i < passes.length; i++) glRef.deleteProgram(passes[i].program);
    passes = [];
    if (rtA) { rtA.dispose(); rtA = null; rtB.dispose(); rtB = null; rtW = rtH = 0; }
    if (gbufMat) { gbufMat.dispose(); gbufMat = null; } gbufActive = false;

  }

  G.ShaderPack = { status: status, loadFile: loadFile, loadBuffer: loadBuffer, unload: unload, active: function () { return st.active; }, render: render, _setRenderer: function (r) { } };
})(window.GW);
