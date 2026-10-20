/* src/app/water-material.js · 水体材质（表现层）
   把水从"半透明蓝色的 Lambert 面"升级成有波纹、菲涅尔、太阳高光的水面。
   口径：
     · 只认数字与贴图：水位/透明度/波纹强度仍由主循环传 uniform，权威状态（world/水位/流体）不在这里；
     · 零 DOM、零文案；不反向抓主循环/实体；
     · 不写深度排序（renderOrder 在 main.js 的 chunk-mesher 侧统一给），这里只管"像素长什么样"。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  if (typeof THREE === 'undefined') { G.WaterMaterial = { create: function () { return null; } }; return; }

  var VS = [
    'attribute vec3 color;',
    'varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv; varying vec3 vColor;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorld = wp.xyz;',
    '  vNormal = normalize(mat3(modelMatrix) * normal);',
    '  vUv = uv; vColor = color;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var FS = [
    'precision highp float;',
    'uniform sampler2D uMap;',
    'uniform float uTime, uOpacity, uSunI, uFogNear, uFogFar;',
    'uniform vec3 uSunDir, uSunCol, uSkyCol, uFogCol;',
    'varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv; varying vec3 vColor;',
    'void main(){',
    /* 水体用**世界坐标**采样贴图：按 vUv（每格一张 16×16 水纹）会把每格都复制一遍，
       俯视整片海就是一条条平行线。世界坐标 + 高频采样把它打碎成细波纹。 */
    '  vec2 wuv = vWorld.xz * 0.85 + vec2(uTime * 0.030, uTime * 0.022);',
    '  vec3 tex = texture2D(uMap, wuv).rgb;',
    /* 两组相反方向的行波：波峰不会被"整体平移"读成一张滑动的贴图。 */
    '  float w1 = sin(vWorld.x * 1.9 + uTime * 1.25 + vWorld.z * 0.7);',
    '  float w2 = sin(vWorld.z * 2.7 - uTime * 1.05 + vWorld.x * 1.1);',
    '  float w3 = sin((vWorld.x + vWorld.z) * 4.1 + uTime * 2.1);',
    '  vec3 n = normalize(vec3(w1 * 0.055 + w2 * 0.035, 1.0, w2 * 0.055 + w3 * 0.028));',
    '  if (!gl_FrontFacing) n = -n;',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  vec3 L = normalize(uSunDir);',
    '  vec3 H = normalize(L + V);',
    '  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);',
    '  float spec = pow(max(dot(n, H), 0.0), 110.0) * uSunI;',
    /* 水体本色用固定的深/浅蓝，贴图只贡献波纹明暗（不再让贴图的条纹变成水面主图案）。
       vColor 里带"越深越暗"与面朝向光照，拿它当深浅插值的权重。 */
    '  vec3 deep = vec3(0.045, 0.22, 0.42), shallow = vec3(0.16, 0.50, 0.70);',
    '  float dk = clamp(vColor.r, 0.0, 1.0);',
    '  vec3 base = mix(deep, shallow, dk) * (0.78 + 0.30 * dot(tex, vec3(0.333)));',
    '  base *= (0.45 + 0.55 * clamp(uSunI, 0.0, 1.2));',
    '  vec3 col = base * (0.9 + 0.1 * (1.0 - fres)) + uSkyCol * fres * 0.22 + uSunCol * spec * 0.9;',
    '  float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorld));',
    '  col = mix(col, uFogCol, fog);',
    '  gl_FragColor = vec4(col, uOpacity);',
    '}'
  ].join('\n');

  function create(opts) {
    opts = opts || {};
    var map = opts.map;
    var U = {
      uMap: { value: map || null },
      uTime: { value: 0 },
      uOpacity: { value: opts.opacity === undefined ? 0.74 : opts.opacity },
      uSunDir: { value: new THREE.Vector3(0.65, 0.95, 0.42).normalize() },
      uSunCol: { value: new THREE.Color(1, 0.95, 0.82) },
      uSunI: { value: 0.75 },
      uSkyCol: { value: new THREE.Color(0.6, 0.8, 1.0) },
      uFogCol: { value: new THREE.Color(0.62, 0.79, 1.0) },
      uFogNear: { value: 40 }, uFogFar: { value: 150 }
    };
    var m = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false
    });
    m.toneMapped = false;
    return m;
  }
  /* 主循环每帧喂一次：太阳/雾/时间都从场景真源来，不在这里另存一套。 */
  function update(mat, dt, sun, hemi, fog, sunDir) {
    if (!mat || !mat.uniforms) return;
    var u = mat.uniforms;
    u.uTime.value += dt || 0;
    if (sunDir) u.uSunDir.value.copy(sunDir);
    if (sun) {
      u.uSunCol.value.copy(sun.color).multiplyScalar(0.75 + (sun.intensity || 0) * 0.55);
      u.uSunI.value = 0.25 + (sun.intensity || 0);
    }
    if (hemi) u.uSkyCol.value.copy(hemi.color).multiplyScalar(0.55);
    if (fog) {
      u.uFogCol.value.copy(fog.color);
      u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
    }
  }

  G.WaterMaterial = { create: create, update: update };
})(window.GW);
