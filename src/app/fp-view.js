/* src/app/fp-view.js · 第一人称手持视图模型（表现层）
   第一人称下把"握着法杖的手"画在镜头前：袖口、手掌、指节、杖身、杖头晶体。
   这不是角色实体的一部分——它不读权威状态、不参与碰撞/命中/存档，只跟着相机走。
   渲染口径：
     · 挂在主场景里、矩阵每帧复制当前相机；材质 renderOrder=1000，排在所有世界几何之后；
     · depthTest=false、depthWrite=false：贴墙时法杖不会插进方块（第一人称视图模型的通行做法）；
     · 用顶点色烘出体素式明暗，不依赖场景灯光——洞里/夜里法杖也不会变成一根黑棍。
   动画：走路用真实速度积分相位（不是 match.time 乘系数），施法有一记短促前刺，疾跑压低杖身。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  if (typeof THREE === 'undefined') { G.FPView = { create: function () { return null; } }; return; }

  var SHADE = {
    right: 0.82, left: 0.68, top: 1.0, bottom: 0.52, front: 0.9, back: 0.74
  };
  /* BoxGeometry 的面序：+X,-X,+Y,-Y,+Z,-Z；每面 4 个顶点。给每面烘一个明暗倍率。 */
  function shadeBox(w, h, d, hex) {
    var g = new THREE.BoxGeometry(w, h, d);
    /* 顶点色走线性空间：r128 的 outputEncoding=sRGB 会在片元后做一次编码，
       直接把 sRGB 十六进制塞进顶点色会整体发白（木杖变米色、紫袍变粉）。 */
    var c = new THREE.Color(hex).convertSRGBToLinear();
    var arr = new Float32Array(24 * 3);
    var k = 0;
    var order = ['right', 'left', 'top', 'bottom', 'front', 'back'];
    for (var f = 0; f < 6; f++) {
      var s = SHADE[order[f]];
      for (var v = 0; v < 4; v++) { arr[k++] = c.r * s; arr[k++] = c.g * s; arr[k++] = c.b * s; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }
  function mesh(w, h, d, hex, mat) {
    var m = new THREE.Mesh(shadeBox(w, h, d, hex), mat);
    m.frustumCulled = false;
    m.renderOrder = 1000;              // 透明队列里排在 水22 / 冰21 / 粒子30 / 飘字40 之后
    return m;
  }

  function create(opts) {
    opts = opts || {};
    var scene = opts.scene;
    if (!scene) return null;
    var mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false });
    mat.toneMapped = false;
    /* 晶体本体用**逐面顶点色**（普通混合）：每个面按法线给一档冷色明暗，八面体才有晶体切面；
       纯色 + 加法 + bloom 会把整颗烧成一个白方块（第一版就是这样）。
       外圈光晕才用加法，压到 0.1 左右——亮在光晕，不是亮成一个色块。 */
    var matGem = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    matGem.toneMapped = false;
    var matGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2e9fd6).convertSRGBToLinear(), transparent: true, opacity: 0.10, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    matGlow.toneMapped = false;
    function gemGeometry(r) {
      var g = new THREE.OctahedronGeometry(r, 0).toNonIndexed();
      var p = g.attributes.position, col = new Float32Array(p.count * 3);
      var base = new THREE.Color(0x59d6ff), dark = new THREE.Color(0x1c6f9e);
      var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      for (var i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
        e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2).normalize();
        var k = 0.62 + Math.max(0, n.y) * 0.40 + Math.max(0, n.z) * 0.18;
        var colr = dark.clone().lerp(base, Math.min(1, k));
        for (var j = 0; j < 3; j++) { col[(i + j) * 3] = colr.r; col[(i + j) * 3 + 1] = colr.g; col[(i + j) * 3 + 2] = colr.b; }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    }

    var root = new THREE.Group();
    root.name = 'gw-fp-view';
    root.matrixAutoUpdate = false;
    root.visible = false;
    root.renderOrder = 1000;
    scene.add(root);

    /* 杖：局部原点 = 握把中心；+Y 朝杖头。整体在镜头右下，向画面中心斜举。 */
    var staff = new THREE.Group();
    /* 构图：杖头落在画面右上象限、手在右下角，整根杖都进画（旧版 x0.42/rotY-0.28 把晶体顶出屏幕，
       第一人称只看得到一小截木棍）。 */
    staff.position.set(0.34, -0.34, -0.66);
    staff.rotation.set(-0.08, -0.10, 0.35);
    staff.scale.setScalar(0.92);
    root.add(staff);

    var shaft = mesh(0.055, 1.02, 0.055, 0x6b4326, mat); shaft.position.set(0, 0.22, 0); staff.add(shaft);
    var grip = mesh(0.072, 0.20, 0.072, 0x2c2030, mat); grip.position.set(0, -0.08, 0); staff.add(grip);
    /* 缠绳与箍：两圈暗铜，让一根直棍有"手工杖"的层次 */
    var band1 = mesh(0.078, 0.035, 0.078, 0x9a7f3a, mat); band1.position.set(0, 0.13, 0); staff.add(band1);
    var band2 = mesh(0.076, 0.03, 0.076, 0x9a7f3a, mat); band2.position.set(0, 0.52, 0); staff.add(band2);
    var ferrule = mesh(0.09, 0.06, 0.09, 0x3b2a1c, mat); ferrule.position.set(0, 0.70, 0); staff.add(ferrule);

    /* 杖头晶体：一个八面体 + 外圈加法光晕。晶体颜色由当前元素色驱动（setGemColor）。 */
    var gem = new THREE.Mesh(gemGeometry(0.055), matGem);
    gem.position.set(0, 0.82, 0); gem.frustumCulled = false; gem.renderOrder = 1001; staff.add(gem);
    var glow = new THREE.Mesh(gemGeometry(0.092), matGlow);
    glow.position.copy(gem.position); glow.frustumCulled = false; glow.renderOrder = 1001; staff.add(glow);
    /* 三根金色爪：从杖头托住晶体，手杖才不像"木棍插着一个方块" */
    for (var pi = 0; pi < 3; pi++) {
      var prong = mesh(0.025, 0.09, 0.025, 0xc9a35b, mat);
      var ang = pi * Math.PI * 2 / 3;
      prong.position.set(Math.cos(ang) * 0.055, 0.75 + Math.sin(ang) * 0.02, Math.sin(ang) * 0.055);
      prong.rotation.z = -Math.cos(ang) * 0.35; prong.rotation.x = Math.sin(ang) * 0.35;
      staff.add(prong);
    }

    /* 手：手掌 + 三节指节 + 袖口。掌心包在握把前侧，拇指从另一侧扣回来。 */
    var hand = mesh(0.125, 0.14, 0.145, 0xd8a06a, mat); hand.position.set(0.015, -0.08, 0.055); staff.add(hand);
    var thumb = mesh(0.05, 0.075, 0.06, 0xcf9460, mat); thumb.position.set(-0.055, -0.045, 0.105); thumb.rotation.z = 0.35; staff.add(thumb);
    for (var i = 0; i < 3; i++) {
      var f = mesh(0.035, 0.075, 0.045, 0xd8a06a, mat);
      f.position.set(0.055, -0.115 - i * 0.032, 0.085 - i * 0.012);
      f.rotation.x = 0.28 + i * 0.12;
      staff.add(f);
    }
    var cuff = mesh(0.19, 0.20, 0.23, 0x4a3a86, mat); cuff.position.set(0.10, -0.28, 0.10); cuff.rotation.set(0.18, -0.15, 0.35); staff.add(cuff);
    var cuff2 = mesh(0.155, 0.16, 0.19, 0x6b5cc0, mat); cuff2.position.set(0.075, -0.36, 0.07); cuff2.rotation.set(0.18, -0.15, 0.35); staff.add(cuff2);

    var S = { root: root, staff: staff, gem: gem, glow: glow, mat: mat, matGem: matGem, matGlow: matGlow,
      phase: 0, castT: -1, castDur: 0.34, castK: 0, sway: 0, visible: false, basePos: staff.position.clone(),
      baseRot: staff.rotation.clone(), gemColor: '#8fe8ff', gemPulse: 0.5 };

    /* 施法：前刺 + 晶体闪一下。颜色由装配层从卡牌元素传进来，这里只收十六进制。 */
    function cast(hex) {
      S.castT = 0;
      if (hex) S.gemColor = hex;
    }
    function setGemColor(hex) { if (hex) S.gemColor = hex; }

    /* state: {cam, player, visible, speed, sprint, onGround, dt} */
    function update(dt, state) {
      state = state || {};
      var cam = state.cam, p = state.player;
      var vis = !!(state.visible && cam && p && p.alive);
      if (!vis) { if (root.visible) root.visible = false; return; }
      root.visible = true;
      /* 相机世界矩阵直接复制：视图模型永远贴在镜头上，不参与世界坐标 */
      root.matrix.copy(cam.cam.matrixWorld);
      root.matrixWorld.copy(root.matrix);
      root.matrixWorldNeedsUpdate = false;

      dt = Math.min(0.05, Math.max(0, dt || 0));
      var spd = state.speed || 0, air = state.onGround === false;
      var sprint = !!state.sprint && spd > 0.4;
      S.phase += dt * (2.2 + spd * 1.35);
      S.sway += dt;
      var moveK = Math.min(1, spd / 5.6);
      var bob = Math.sin(S.phase * 2) * 0.012 * moveK;
      var swayX = Math.sin(S.phase) * 0.010 * moveK + Math.sin(S.sway * 0.9) * 0.004;
      var swayY = Math.cos(S.phase * 2) * 0.006 * moveK + Math.sin(S.sway * 1.3) * 0.003;
      var kick = sprint ? 1 : 0;

      /* 施法包络：前 0.10s 快速前刺，后 0.24s 回位 */
      if (S.castT >= 0) {
        S.castT += dt;
        var t = S.castT / S.castDur;
        if (t >= 1) { S.castT = -1; S.castK = 0; }
        else S.castK = t < 0.3 ? (t / 0.3) : (1 - (t - 0.3) / 0.7);
      }
      var ck = S.castK || 0;
      var stretch = ck * 0.10;
      staff.position.set(S.basePos.x + swayX - kick * 0.03, S.basePos.y + bob + swayY - kick * 0.035 - ck * 0.02, S.basePos.z - stretch);
      staff.rotation.set(S.baseRot.x - ck * 0.55 + swingK(spd) * 0.02, S.baseRot.y + swayX * 0.8, S.baseRot.z + swayX * 0.5 - kick * 0.10);
      if (air) staff.rotation.x = S.baseRot.x + 0.06;

      /* 晶体：呼吸亮度 + 施法闪光；颜色跟随当前元素 */
      S.gemPulse = 0.55 + Math.sin(S.sway * 2.4) * 0.12 + ck * 0.9;
      S._col = S._col || new THREE.Color();
      S._col.set(S.gemColor).convertSRGBToLinear();
      /* 晶体自己的顶点色保留切面，材质色只做元素染色的乘子（白 = 不染） */
      S.matGem.color.copy(S._col).multiplyScalar(0.62 + S.gemPulse * 0.16);
      S.matGlow.color.copy(S._col).multiplyScalar(0.28 + ck * 0.7);
      S.matGlow.opacity = 0.07 + S.gemPulse * 0.05 + ck * 0.16;
      var gs = 1 + ck * 0.35 + Math.sin(S.sway * 2.4) * 0.04;
      gem.scale.setScalar(gs); glow.scale.setScalar(1 + ck * 0.8);
      S.visible = true;
    }
    function swingK(spd) { return Math.min(1, spd / 5.6); }

    return { update: update, cast: cast, setGemColor: setGemColor, group: root, state: S };
  }

  G.FPView = { create: create };
})(window.GW);
