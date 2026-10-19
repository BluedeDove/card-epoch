(function (G) {
  'use strict';
  /* js/hero-rig.js · 玩家角色层（GW.HERO）：法师模型 + 骨骼化动画
     ------------------------------------------------------------------
     职责：把 tools/hero_bake.cjs 烘出来的"部件盒 + 像素贴图"装成一具会动的身体，
           并把权威层的可见状态（速度、在不在地上、出牌、挨打）翻成姿态。
     规矩（与特效计算层同一条口径，layer_check 拦着）：
       · 只读实体，绝不往实体上写视觉字段（动画量存在部件自己的 userData 里）；
       · 相位一律自己按渲染帧 dt 累加，不乘 match.time——那是 20Hz 的量子，会一顿一顿；
       · 零文案：这层不许出现任何面向玩家的中文。
     为什么旧模型"四肢各动各的"：手臂/腿的网格绕自己的几何中心转（盒子的中点），
     等于手肘当肩膀用；而且躯干、头、袍子完全不参与。这里改成：**每个关节一个 Group**，
     网格挂在关节下面，旋转只发生在关节上，腿动→胯摆→肩反向→头补偿，全走同一个相位。 */

  var T = window.THREE;
  var SP = null;                                   // 懒取：hero-sprites.js 在本文件之前加载
  function sprites() { if (!SP) SP = G.HERO_SPRITES; return SP; }

  /* 收边：源图的正视图有摆动的袍角和宽帽檐，直接照搬会让越肩相机老判"身体糊住准星"。
     这里只缩外形，不动贴图（贴图仍是那 64×64 的专业像素）。 */
  var FIT = {
    // 上限：每个部件"宽 + 厚 ≤ 1.0 格"。越肩相机判"部件是否糊准星"用的是世界 AABB，
    // 斜 45° 站时盒会胀到 (宽+厚)/√2；老模型身体 0.6×0.34 正好 0.94，照这个上限做才不会
    // 在低头/抬头时机位落到头顶或脚踝高度时被盒吞掉（实测：袍子 1.09 盒 → 最近深度 1.40 < 闸 1.45，整具被隐藏，审计 C4 红）。
    robe: [0.88, 1, 0.66],
    hatBrim: [0.92, 1, 0.58],
    hatCone: [0.98, 1, 0.80],
    collar: [0.90, 1, 0.66],
    torso: [0.88, 1, 0.74],
    armL: [0.88, 1, 0.80], armR: [0.88, 1, 0.80],
    legL: [0.94, 1, 0.90], legR: [0.94, 1, 0.90],
    staffShaft: [0.62, 0.82, 0.62], staffGem: [0.8, 0.8, 0.8]
  };
  /* 关节（模型空间，y=0 是脚底）。部件挂在哪个关节、挂上去后离关节多远，全在这一张表里 */
  var NODE = {
    hips: [0, 0.60, 0],
    torso: [0, 0.62, 0],
    head: [0, 1.04, 0],
    shoulderR: [-0.27, 1.00, 0],
    shoulderL: [0.27, 1.00, 0],
    handL: [0.34, 0.50, -0.34],                  // 杖柄：左手抓的位置
    staff: [-0.31, 0.02, 0.14]                      // 杖整体摆位：贴左身侧、略微靠前（源图里杖是竖直的）
  };
  var ATTACH = {
    legR: 'hips', legL: 'hips', robe: 'hips',
    torso: 'torso',
    head: 'head', hatBrim: 'head', hatCone: 'head',
    collar: 'torso', armR: 'armR', armL: 'armL',
    staffShaft: 'handL', staffGem: 'handL'
  };
  /* 面的左右翻转：盒子的 UV 沿 u 增长方向对 ±Z / ±X 各不相同，源图却是统一"屏幕右"取的，
     不翻就会镜像（法杖跑到另一只手）。这四档在 tools/hero_check.cjs 的轮廓比对里定死。 */
  var FLIP = { f: 1, k: 0, l: 0, r: 0 };
  /* 两条渲染路径同时在场上，用 setMode 切：
       bill —— 公告牌，直接用素材原画的 4 朝向帧（默认，看起来就是那位法师）
       box  —— 四视图投影出来的盒子骨架（保留：以后换装/部件级特效要用，也留着当对照） */
  var MODE = 'bill';
  var billMats = {};
  function billMaterial(texKey, ck) {
    var k = texKey + '|' + ck, m = billMats[k];
    if (m) return m;
    m = new T.MeshLambertMaterial({ color: 0xffffff, alphaTest: 0.5, transparent: false, side: T.DoubleSide });
    var t = faceTexture(texKey, ck);
    if (t) {
      /* 公告牌的朝向约定和盒子的 +Z 面是同一套：
         · 像素是我自己一行行填进 canvas 的（faceTexture 里 flipY=false），盒面的 UV 正好对上，
           但 PlaneGeometry 的 v 从下往上 → 不翻就成了上下颠倒（第一轮自查图就是倒立的法师）；
         · 水平不翻：面片的 UV 本来就是 u 随 +x 增长，翻一次就把法师画反手了
           （四方位实测：正面图里杖在画面右，翻了就跑到左，等于杖换了一只手）。
         这些 texture 只有公告牌在用（键名带 .帧号），改它们不影响盒模型。 */
      if (t.flipY !== true) { t.flipY = true; t.needsUpdate = true; }
      if (t.repeat.x !== 1) { t.repeat.x = 1; t.offset.x = 0; }
      m.map = t;
    }
    billMats[k] = m;
    return m;
  }
  function norm(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  var texCache = null;
  function faceTexture(key, side) {
    var S = sprites(), t = S.tex[key];
    if (!t) return null;
    var ck = key + '|' + side;
    if (!texCache) texCache = {};
    if (texCache[ck]) return texCache[ck];
    var cv = document.createElement('canvas'); cv.width = t.w; cv.height = t.h;
    var cx2 = cv.getContext('2d'), img = cx2.createImageData(t.w, t.h), d = img.data;
    var idx = (side === 'p1') ? S.sides.p1 : S.sides.p2;
    var px = atob(t.px);
    for (var i = 0; i < t.w * t.h; i++) {
      var raw = px.charCodeAt(i) & 255;
      if (!raw) continue;                                   // 0 = 透明
      var pal = idx[raw]; if (pal === undefined) pal = raw;   // 缺项退回原色，不许画成透明
      if (!pal) continue;
      var h = S.palette[pal], o = i * 4;
      d[o] = parseInt(h.slice(1, 3), 16); d[o + 1] = parseInt(h.slice(3, 5), 16);
      d[o + 2] = parseInt(h.slice(5, 7), 16); d[o + 3] = 255;
    }
    cx2.putImageData(img, 0, 0);
    var tex = new T.CanvasTexture(cv);
    tex.magFilter = T.NearestFilter; tex.minFilter = T.NearestFilter;
    tex.generateMipmaps = false; tex.flipY = false;
    texCache[ck] = tex;
    return tex;
  }
  function faceMaterial(key, side, opts) {
    var tex = faceTexture(key, side);
    var o = { color: 0xffffff, alphaTest: 0.5, transparent: false };
    if (opts && opts.basic) o.color = new T.Color(opts.basic);
    var m = new (opts && opts.basic ? T.MeshBasicMaterial : T.MeshLambertMaterial)(o);
    if (tex) {
      m.map = tex;
      /* 同一张 texture 只有一份 repeat/offset，翻转必须逐面独立——所以翻的那一面复制一份 */
      var fv = key.charAt(key.length - 1);
      if (FLIP[fv]) {
        var t2 = tex.clone(); t2.needsUpdate = true;
        t2.wrapS = T.RepeatWrapping; t2.repeat.x = -1; t2.offset.x = 1;
        m.map = t2;
      }
    }
    return m;
  }
  /* 顶/底盖用烘焙算好的"该部件正面框顶行 / 底行均色"纯色。贴图会出事：把 30 行高的袍子压进
     2cm 的薄片里，斜眼看过去像帽顶长了一根角（第一轮自查图就是这么露馅的）。算不出盖子才退回正面图。 */
  function capMaterial(hex, basic) {
    if (!hex) return null;
    var c = new T.Color(hex);
    if (basic) c.multiplyScalar(0.88);
    return new (basic ? T.MeshBasicMaterial : T.MeshLambertMaterial)({ color: c, transparent: false });
  }
  /* 一个部件 = 一个盒 + 六面材质（±X 用左右身视图，±Z 用正/背视图，±Y 用纯色盖子） */
  function partMesh(name, side) {
    var S = sprites(), p = S.parts[name];
    if (!p) return null;
    var fit = FIT[name] || [1, 1, 1];
    var g = new T.BoxGeometry(p.box[0], p.box[1], p.box[2]);
    var basic = p.gem ? 0xffffff : null;
    var mats = [
      faceMaterial(p.faces.l, side, { basic: basic }),     // +X：角色的左侧
      faceMaterial(p.faces.r, side, { basic: basic }),     // -X：角色的右侧
      capMaterial(p.caps && p.caps[0], basic),             // +Y 顶盖：纯色
      capMaterial(p.caps && p.caps[1], basic),              // -Y 底盖：纯色
      faceMaterial(p.faces.k, side, { basic: basic }),     // +Z 背
      faceMaterial(p.faces.f, side, { basic: basic })      // -Z 脸
    ];
    for (var mi = 0; mi < 6; mi++) { if (!mats[mi]) mats[mi] = faceMaterial(p.faces.f, side, { basic: basic }); }
    var mesh = new T.Mesh(g, mats);
    mesh.scale.set(fit[0], fit[1], fit[2]);
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.userData.heroPart = name;
    return mesh;
  }
  function node(x, y, z) { var n = new T.Group(); n.position.set(x, y, z); return n; }

  /* ---------- 装配 ---------- */
  function build(side) {
    var S = sprites();
    var sk = 'p' + (side === 0 ? 1 : 2);
    var g = new T.Group();
    var nodes = { hips: node(0, 0, 0), torso: node(0, NODE.torso[1], NODE.torso[2]),
      head: node(0, NODE.head[1] - NODE.torso[1], NODE.head[2]),
      armR: node(NODE.shoulderR[0], NODE.shoulderR[1] - NODE.torso[1], NODE.shoulderR[2]),
      armL: node(NODE.shoulderL[0], NODE.shoulderL[1] - NODE.torso[1], NODE.shoulderL[2]),
      handL: node(NODE.handL[0] - NODE.shoulderL[0], NODE.handL[1] - NODE.shoulderL[1], NODE.handL[2] - NODE.shoulderL[2]) };
    nodes.staff = node(0, 0, 0);
    nodes.handL.add(nodes.staff);
    g.add(nodes.hips);
    nodes.hips.add(nodes.torso);
    nodes.torso.add(nodes.head, nodes.armR, nodes.armL);
    nodes.armL.add(nodes.handL);
    var parts = {};
    Object.keys(ATTACH).forEach(function (name) {
      var mesh = partMesh(name, sk);
      if (!mesh) return;
      var host = nodes[ATTACH[name]] || nodes.hips;
      if (name === 'staffShaft' || name === 'staffGem') host = nodes.staff;
      /* 烘出来的位置是"脚底为原点"的模型空间；挂到关节下就换成相对关节的偏移 */
      var base = NODE[ATTACH[name]] || [0, 0, 0];
      if (ATTACH[name] === 'hips') base = [0, 0, 0];
      if (ATTACH[name] === 'torso') base = [0, NODE.torso[1], NODE.torso[2]];
      if (ATTACH[name] === 'head') base = [0, NODE.head[1], NODE.head[2]];
      if (ATTACH[name] === 'armR') base = NODE.shoulderR;
      if (ATTACH[name] === 'armL') base = NODE.shoulderL;
      if (ATTACH[name] === 'handL') base = NODE.handL;
      mesh.position.set(mesh.position.x - base[0], mesh.position.y - base[1], mesh.position.z - base[2]);
      host.add(mesh);
      parts[name] = mesh;
    });
    /* 公告牌：主体一张面片，绕 Y 面向"当前这台相机"（分屏两台相机各算各的，所以挂在 onBeforeRender） */
    var bill = (S && S.billboards) || null;
    var holder = new T.Group(), body = null;
    if (bill) {
      var first = (bill.idle && bill.idle.list[0]) || (bill.front_walk && bill.front_walk.list[0]);
      body = new T.Mesh(new T.PlaneGeometry(1, 1), billMaterial(first ? first.tex : 'idle.0', sk));
      /* 建好就按第 0 帧摆一次：不然面片停在 1×1 的原点位置，脚底往下 0.5 格，
         baseY（脚底偏移）会被它算成 -0.5，整个人浮空半米——第一次绘制之前也得是个正确姿态。 */
      if (first) { body.scale.set(first.w, first.h, 1); body.position.set(first.x, first.y, 0); }
      body.userData.heroPart = 'body';
      body.onBeforeRender = function (renderer, scene, camera) { drawBill(body, g, camera); };
      holder.add(body);
      g.add(holder);
      nodes.body = holder;
    }
    /* main.js 的可见性/遮挡判定认这几个名字（躯干挡准星→整具不画；只手臂/杖挡→画到肩；只腿挡→只藏腿） */
    g.userData.parts = {
      head: parts.head, armL: nodes.armL, armR: nodes.armR, legL: parts.legL, legR: parts.legR,
      nodes: nodes, parts: parts, gem: parts.staffGem, hat: parts.hatCone, robe: parts.robe, staff: nodes.staff, torso: parts.torso,
      body: body, holder: holder, sideKey: sk, boxRoot: nodes.hips
    };
    g.userData.anim = newAnim();
    /* 模式切换必须等 parts 挂好之后再算一遍：早先放在前面，applyMode 看到 parts 是 undefined
       直接返回，盒模型和公告牌同时可见——回归图里那两坨"碎片"就是这么叠出来的。 */
    applyMode(g);
    LIVE.push(g);
    /* 脚底偏移在静止姿态上一次算清，省掉主循环里的 Box3（main.js 见 baseY 已存在就不再自己量） */
    g.updateMatrixWorld(true);
    var bb = new T.Box3().setFromObject(g);
    g.userData.baseY = bb.min.y;
    return g;
  }
  function pickFace(A, rel) {
    /* rel = 相机方位角 − 角色朝向：0 = 相机在角色正前方（我们看到它的脸）。
       边界留 0.10 弧度迟滞，站在两个朝向交界时不会每帧换图。 */
    var want = Math.abs(rel) < Math.PI / 4 ? 'front'
      : Math.abs(rel) > 3 * Math.PI / 4 ? 'back'
      : (rel > 0 ? 'left' : 'right');
    if (A.face && A.face !== want) {
      var m = Math.abs(rel) < Math.PI / 2 ? Math.abs(rel) : Math.PI - Math.abs(rel);
      var edge = (want === 'left' || want === 'right') ? Math.PI / 4 : 3 * Math.PI / 4;
      if (Math.abs(m - edge) < 0.10) return A.face;
    }
    return want;
  }
  function drawBill(mesh, g, camera) {
    if (MODE !== 'bill' || !mesh.visible || !camera) return;
    faceBill(g, Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z));
  }
  /* 朝向 + 选帧：animate 与渲染回调共用同一份算法，避免两处各算一个答案 */
  function faceBill(g, camAz) {
    var A = g.userData.anim, P = g.userData.parts, S = sprites();
    var B = S && S.billboards;
    var mesh = P && P.body;
    if (!B || !mesh || MODE !== 'bill' || !mesh.visible) return;
    var rel = norm(camAz - norm(g.rotation.y - Math.PI));
    A.face = pickFace(A, rel);
    var WK = { front: 'front_walk', back: 'back_walk', left: 'left_walk', right: 'right_walk' };
    var setKey, fi, run = Math.min(1, A.speed / 5.4);
    if (A.castT >= 0) {
      setKey = A.face === 'back' ? 'atk_back' : 'atk_front';
      var fr0 = (B[setKey] || { frames: 1 }).frames;
      fi = Math.floor(Math.max(0, Math.min(1, A.castT / A.castDur)) * (fr0 - 1) + 0.001);
    } else if (A.air) {
      setKey = WK[A.face]; fi = 2;
    } else if (A.speed > 0.35) {
      setKey = WK[A.face];
      var fr = (B[setKey] || { frames: 1 }).frames;
      fi = Math.floor(Math.abs(A.ph) * 1.15 / (Math.PI * 2) * fr) % fr;
    } else {
      /* 站桩也用走路系列的第 0 帧，不用素材那套 mage_idle：
         这套包的走路帧里杖在角色的左手（正面看是画面右），而 idle/attack 两帧画到了另一侧，
         两套之间一切换杖就"跳边"。定机帧 + 骨架的呼吸/落地压缩比换一套贴图值钱。
         （idle 数据仍在 hero-sprites 里，以后美术补一致的待机帧就切回去。） */
      setKey = WK[A.face];
      var fr2 = (B[setKey] || { frames: 1 }).frames;
      fi = 0;
    }
    var set = B[setKey];
    if (!set || !set.frames) return;
    if (fi < 0) fi = 0; if (fi > set.frames - 1) fi = set.frames - 1;
    var f = set.list[fi];
    if (!f) return;
    var mat = billMaterial(f.tex, P.sideKey);
    if (mesh.material !== mat) mesh.material = mat;
    /* 施法的元素色：不加色块、不贴图，用自发光把整套帧点亮成元素的色调（美术的像素一个不改） */
    var glow = A.castT >= 0 ? (0.18 + A.gemPulse * 0.5) : (A.hurtT >= 0 && A.hurtT < 0.12 ? 0.3 : 0);
    if (glow > 0.001 && mat.emissive) {
      if (!mat.userData.glow) mat.userData.glow = new T.Color();
      mat.userData.glow.set(A.gemColor || '#ffd400');
      mat.emissive.copy(mat.userData.glow).multiplyScalar(glow);
    } else if (mat.emissive && (mat.emissive.r || mat.emissive.g || mat.emissive.b)) mat.emissive.setRGB(0, 0, 0);
    var sq = Math.max(0.72, 1 - A.land * 0.5);                        // 落地压一下
    mesh.scale.set(f.w * (1 + (1 - sq) * 0.42), f.h * sq, 1);
    mesh.position.set(f.x, f.y * sq, 0);
    A.camAz = camAz;
    mesh.rotation.set(0, norm(camAz - norm(g.rotation.y)), A.speed > 0.35 ? A.hipYaw * 0.35 : 0);
  }
  var LIVE = [];                     // 建过的角色都记一下，setMode 才能把场上全部切过去
  function applyMode(g) {
    var P = g && g.userData.parts;
    if (!P) return;
    var bill = MODE === 'bill';
    if (P.holder) P.holder.visible = bill;
    if (P.body) P.body.visible = bill;
    if (P.boxRoot) P.boxRoot.visible = !bill;
    /* 可见性必须落到每个网格自己头上：相机与审计都按"网格 visible"筛部件盒，
       只藏根节点的话那些盒子还是会被算进合并盒——抬头两档 pitch 的 C4 假隐藏就是这么来的。 */
    for (var k in P.parts) { if (P.parts[k]) P.parts[k].visible = !bill; }
  }
  function setMode(m) {
    MODE = m === 'box' ? 'box' : 'bill';
    for (var i = 0; i < LIVE.length; i++) applyMode(LIVE[i]);
    return MODE;
  }
  function newAnim() {
    return { ph: 0, breath: 0, speed: 0, air: 0, lean: 0, hipYaw: 0,
      castT: -1, castDur: 0.62, hurtT: -1, hurtSide: 0,
      hatSway: 0, hatSwayV: 0, robeSway: 0, robeSwayV: 0, gemPulse: 0,
      land: 0, landV: 0, bobY: 0, face: 'front', gemColor: '#ffd400' };
  }

  /* ---------- 小工具 ---------- */
  function ap(o, k, want, rate, dt) {                       // 一阶跟随：目标突变会被摊成几帧
    var x = o[k], d = want - x, r = Math.min(1, rate * dt);
    o[k] = x + d * r;
    return o[k];
  }
  function spring(o, k, v, target, kS, dS, dt) {            // 帽子/袍子的"跟一下"：靠阻尼弹簧甩
    var a = (target - o[k]) * kS - o[v] * dS;
    o[v] += a * dt; o[k] += o[v] * dt;
    return o[k];
  }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  /* ---------- 摆姿态 ----------
     ctx：{ speed: 水平速度(格/秒), air: -1 下落 / 0 落地 / 1 上升, pitch: 俯仰(弧度), guard: 是否架起 }
     所有量都是"视觉量"，只写进部件的 rotation/position，一个字段都不回写实体。 */
  function animate(group, ctx, dt) {
    if (!group || !group.userData.anim) return;
    var A = group.userData.anim, P = group.userData.parts, N = P.nodes, pr = P.parts, nodes = P.nodes;
    if (!N) return;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;                                  // 切标签页回来那一帧不许把动画拽飞
    var sp = Math.max(0, (ctx && ctx.speed) || 0);
    var airNow = (ctx && ctx.air) || 0;
    var run = Math.min(1, sp / 5.2);                          // 走→跑的过渡权重（5.2 格/秒≈满速）
    var moving = sp > 0.7;
    /* 相位：走路 9 弧度/秒起步、随速度加到 ~13；站着 1.6（呼吸与袍子还在动） */
    A.ph += dt * (moving ? 9 + 4 * run : 1.6);
    if (A.ph > 1e6) A.ph = 0;
    ap(A, 'speed', run, 7, dt);
    ap(A, 'air', airNow, 9, dt);
    var run2 = A.speed, ph = A.ph;
    var sw = Math.sin(ph), cw = Math.cos(ph * 2);
    var cast = A.castT < 0 ? 0 : Math.min(1, A.castT / A.castDur);
    var hurt = A.hurtT < 0 ? 0 : Math.min(1, A.hurtT / 0.28);

    /* —— 腿：同侧手脚反相，落地腿往后、摆动腿往前；腾空时前腿收起后腿拖下 ——
       胯在 NODE.hips，绕 X 摆；幅度走→跑线性加，脚离地高度由 sin 的正半周抬 */
    var legA = (0.42 + 0.42 * run2) * (moving ? 1 : 0.12);
    var lk = moving ? sw : 0, rk = -sw;
    if (A.air > 0.35) {                                      // 上升：前腿收、后腿绷直
      pr.legL.rotation.x = apN(pr.legL.rotation.x, -1.15, 12, dt);
      pr.legR.rotation.x = apN(pr.legR.rotation.x, -0.25, 12, dt);
    } else if (A.air < -0.35) {                              // 下落：两腿张开找落点
      pr.legL.rotation.x = apN(pr.legL.rotation.x, -0.42 + 0.16 * lk, 10, dt);
      pr.legR.rotation.x = apN(pr.legR.rotation.x, 0.34 + 0.16 * lk, 10, dt);
    } else {
      pr.legL.rotation.x = apN(pr.legL.rotation.x, legA * lk, 14, dt);
      pr.legR.rotation.x = apN(pr.legR.rotation.x, legA * rk, 14, dt);
      pr.legL.rotation.z = apN(pr.legL.rotation.z, -0.05 * run2, 8, dt);
      pr.legR.rotation.z = apN(pr.legR.rotation.z, 0.05 * run2, 8, dt);
    }
    /* —— 胯：上下颠（走路 2 倍频）+ 承重侧微倾 + 与肩反向的腰转 —— */
    A.bobY = Math.abs(Math.sin(ph)) * 0.035 * run2 * (A.air ? 0 : 1);
    N.hips.position.y = A.bobY - A.land * 0.10;
    N.hips.rotation.z = apN(N.hips.rotation.z, 0.055 * run2 * sw * (moving ? 1 : 0), 9, dt);
    /* —— 躯干：前倾随速度、腰转与腿反相（这是"成套动"的关键，不是各动各的） —— */
    var leanWant = 0.05 + 0.17 * run2 + (cast ? 0.16 * Math.sin(Math.PI * Math.min(1, cast * 1.6)) : 0) - (hurt ? 0.30 * Math.sin(Math.PI * hurt) : 0);
    N.torso.rotation.x = apN(N.torso.rotation.x, leanWant + (A.air > 0.35 ? -0.08 : 0), 9, dt);
    A.hipYaw = apN(A.hipYaw, moving ? -0.10 * run2 * sw : 0.02 * Math.sin(A.breath * 0.5), 8, dt);
    N.torso.rotation.y = A.hipYaw;
    A.breath += dt * (moving ? 2.6 : 1.5);
    /* 落地压缩：竖直速度转成一次 squash，靠阻尼弹回去 */
    /* 落地压缩是"往下沉再弹回"：负半周就是压缩本身，早先写成 land<0 归零，
       squash 永远量不出来（回归里 hips.y 最深只有 −0.003）。现在双向夹紧让它弹。 */
    /* land 约定"正=压缩量"：弹簧往 0 回，允许一点点过冲（负半周=落地后的微弹） */
    A.landV += (-A.land * 120 - A.landV * 12) * dt;
    A.land += A.landV * dt;
    if (A.land > 0.3) { A.land = 0.3; if (A.landV > 0) A.landV = 0; }
    if (A.land < -0.06) { A.land = -0.06; if (A.landV < 0) A.landV = 0; }
    /* —— 头：补偿躯干回转 + 跟着俯仰点一下（看地面时头低一点，看天上时抬） —— */
    var pitch = (ctx && ctx.pitch) || 0;
    N.head.rotation.y = apN(N.head.rotation.y, -A.hipYaw * 0.75, 10, dt);
    N.head.rotation.x = apN(N.head.rotation.x, 0.55 * pitch + (hurt ? 0.35 * Math.sin(Math.PI * hurt) : 0), 9, dt);
    /* —— 帽尖与袍角：阻尼弹簧跟半拍（走路甩、转身甩、停下还在晃） —— */
    spring(A, 'hatSway', 'hatSwayV', -0.16 * (moving ? sw * run2 : 0) - N.torso.rotation.x * 0.5, 55, 7.5, dt);
    spring(A, 'robeSway', 'robeSwayV', -0.22 * (moving ? sw * run2 : 0) + A.air * 0.12, 38, 6.2, dt);
    if (pr.hatCone) pr.hatCone.rotation.x = A.hatSway;
    if (pr.hatBrim) pr.hatBrim.rotation.x = A.hatSway * 0.55;
    if (pr.robe) pr.robe.rotation.x = A.robeSway * 0.5;
    /* —— 右臂（施法手）：走路前后摆，施法时先回抽再前指 —— */
    var armRWant, armRRot = 0;
    if (cast > 0 && cast < 1) {
      var w = cast < 0.30 ? -1.35 * ease(cast / 0.30)                       // 起手：往后上方抽
        : cast < 0.52 ? -1.35 + 2.75 * ease((cast - 0.30) / 0.22)          // 出手：甩向前方
          : 1.40 - 1.40 * ease((cast - 0.52) / 0.48);                      // 收势：抬着缓落回
      armRWant = w; armRRot = cast < 0.52 ? -0.35 : -0.1;
    } else if (hurt > 0 && hurt < 1) {
      armRWant = -0.9 * Math.sin(Math.PI * hurt); armRRot = 0.5 * Math.sin(Math.PI * hurt);
    } else {
      /* 摆幅别贪：手臂盒 0.66 长，绕肩摆 ±0.62 弧度时世界 AABB 会横向胀 ~0.38 格，
         低头机位升到头顶上方时正好把合并盒右缘推进准星窗口（审计 C4 就是这么红的）。 */
      armRWant = moving ? -0.40 * run2 * sw * (A.air ? 0.35 : 1) : -0.05 * Math.sin(A.breath);
      if (A.air > 0.35) armRWant = -0.85;                                   // 跳起来时手张开
    }
    N.armR.rotation.x = apN(N.armR.rotation.x, armRWant, cast > 0 ? 22 : 11, dt);
    if (!cast && A.hurtT < 0 && N.armR.rotation.x > 0.30) N.armR.rotation.x = 0.30;   // 后摆封顶，AABB 不胀到肩后
    N.armR.rotation.z = apN(N.armR.rotation.z, armRRot + (moving ? 0.05 * run2 : 0), 12, dt);
    /* —— 左臂（持杖手）：只管托住杖，摆幅压到很小，杖才不会被走成节拍器 —— */
    var staffHold = A.castT >= 0 && cast < 0.62 ? 0.30 : 0.0;
    N.armL.rotation.x = apN(N.armL.rotation.x, 0.22 + (moving ? -0.12 * run2 * sw : 0) - staffHold * run2, 8, dt);
    N.armL.rotation.z = apN(N.armL.rotation.z, 0.12 + staffHold * 0.5, 8, dt);
    /* 杖保持"世界竖直"：源图里那根杖就是立在地上的，手臂抬起来时杖身也跟着斜的话，
       1.13 长的盒子一转，世界 AABB 横向胀到 0.6 格，低头时机位在头顶上方，合并盒右缘就推进准星窗口了
       （审计 C4 的 8 个俯仰全灭就是这么来的）。所以用反向补偿抵消手臂的转动，只留一点跟随。 */
    if (nodes.staff) {
      nodes.staff.rotation.x = apN(nodes.staff.rotation.x, -N.armL.rotation.x * 0.85 + 0.03 * Math.sin(A.breath * 0.8), 9, dt);
      nodes.staff.rotation.z = apN(nodes.staff.rotation.z, -N.armL.rotation.z * 0.7, 9, dt);
    }
    /* —— 水晶：呼吸微亮 + 施法爆一下 —— */
    A.gemPulse = ap(A, 'gemPulse', (cast > 0.18 && cast < 0.75) ? 1 : 0.16 + 0.10 * Math.sin(A.breath * 1.6), cast > 0 ? 26 : 6, dt);
    if (P.gem) {
      var s = 1 + A.gemPulse * 0.35;
      P.gem.scale.set(s, s, s);
      P.gem.visible = MODE !== 'bill';                 // 公告牌模式下盒模型的部件整组藏起来，别在这里又打开
    }
    /* 朝向提前到这儿算一次：相机的"谁糊准星"分类发生在 placeEntities 之后、渲染之前，
       那时 onBeforeRender 还没跑，量到的还是上一帧的 rotation.y——斜着的时候面片的轴对齐盒
       会往旁边胀，合并盒右缘推进准星窗口（闸 0.47），躯干明明没压准星却被整具隐藏
       （审计 31337 的 pitch=+0.55 那一例）。装配层把相机方位角递进来就摆正，没递则仍等渲染回调。 */
    if (MODE === 'bill' && ctx && typeof ctx.camAz === 'number') faceBill(group, ctx.camAz);
    /* 计时往下走 */
    if (A.castT >= 0) { A.castT += dt; if (A.castT > A.castDur) A.castT = -1; }
    if (A.hurtT >= 0) { A.hurtT += dt; if (A.hurtT > 0.28) A.hurtT = -1; }
  }
  function apN(cur, want, rate, dt) { var r = Math.min(1, rate * dt); return cur + (want - cur) * r; }

  /* ---------- 事件入口（由 main.js 的 fx 桥调用；这层不认识规则也不认识 DOM） ---------- */
  function cast(group, opt) {
    if (!group || !group.userData.anim) return;
    var A = group.userData.anim;
    A.castT = 0; A.castDur = (opt && opt.dur) || 0.62;
    if (opt && opt.color) setGemColor(group, opt.color);   // 早先写成 G.HERO._gemMat（不存在），染色一直是空转
  }
  function hurt(group) { if (group && group.userData.anim) group.userData.anim.hurtT = 0; }
  function land(group, impact) {
    if (!group || !group.userData.anim) return;
    var A = group.userData.anim;
    A.landV = Math.max(0.6, Math.min(3.2, impact)) * 2.6;   // 正=往下压（见 animate 里的 land 约定）
  }
  /* 水晶跟随当前选中的元素：贴图是近白的，直接乘 material.color 就能既亮又换色 */
  function setGemColor(group, hex) {
    if (!group) return;
    if (group.userData.anim) group.userData.anim.gemColor = hex || '#ffd400';
    var m = group.userData.parts && group.userData.parts.gem && group.userData.parts.gem.material;
    if (!m) return;
    var arr = Array.isArray(m) ? m : [m];
    for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].color) arr[i].color.set(hex || '#ffd400'); }
  }
  /* 调试与回归用：把姿态钉死（相位、施法进度），跑截图比对时不留随机 */
  function pose(group, o) {
    if (!group || !group.userData.anim) return;
    var A = group.userData.anim;
    if (o.ph !== undefined) A.ph = o.ph;
    if (o.speed !== undefined) A.speed = o.speed;
    if (o.air !== undefined) A.air = o.air;
    if (o.cast !== undefined) { A.castT = o.cast < 0 ? -1 : o.cast * A.castDur; }
  }
  function stats(group) {
    if (!group) return null;
    var N = group.userData.parts.nodes, A = group.userData.anim;
    return { ph: A.ph, speed: A.speed, air: A.air, castT: A.castT,
      legL: N && group.userData.parts.parts.legL ? group.userData.parts.parts.legL.rotation.x : 0,
      legR: N && group.userData.parts.parts.legR ? group.userData.parts.parts.legR.rotation.x : 0,
      armR: N ? N.armR.rotation.x : 0, armL: N ? N.armL.rotation.x : 0,
      torsoX: N ? N.torso.rotation.x : 0, torsoY: N ? N.torso.rotation.y : 0, bobY: A.bobY,
      height: (function () { try { var b = new T.Box3().setFromObject(group); return b.max.y - b.min.y; } catch (e) { return -1; } })(),
      meshes: (function () { var n = 0; group.traverse(function (o) { if (o.isMesh) n++; }); return n; })(),
      nan: !(isFinite(N.torso.rotation.x) && isFinite(N.armR.rotation.x)) };
  }
  /* 实时改形（回归脚本扫参用，也留给以后换素材）：只改部件外形，不动贴图与关节 */
  function refit(group, table) {
    if (!group || !group.userData.parts) return null;
    var pr = group.userData.parts.parts;
    Object.keys(table || {}).forEach(function (k) {
      var m = pr[k], f = table[k];
      if (!m || !f || f.length !== 3) return;
      FIT[k] = [f[0], f[1], f[2]];
      m.scale.set(f[0], f[1], f[2]);
    });
    return FIT;
  }
  /* 归零所有视觉状态：换局/复活/回归脚本都要用，别留上一次的相位 */
  function reset(group) {
    if (!group || !group.userData.parts) return null;
    var A = group.userData.anim, N = group.userData.parts.nodes, pr = group.userData.parts.parts;
    A.ph = 0; A.breath = 0; A.speed = 0; A.air = 0; A.hurtT = -1; A.castT = -1;
    A.land = 0; A.landV = 0; A.bobY = 0; A.hipYaw = 0; A.gemPulse = 0;
    A.hatSway = 0; A.hatSwayV = 0; A.robeSway = 0; A.robeSwayV = 0;
    for (var k in N) { N[k].rotation.set(0, 0, 0); }
    for (var n in pr) { if (pr[n] !== N[n]) pr[n].rotation.set(0, 0, 0); }
    N.hips.position.set(NODE.hips[0], NODE.hips[1], NODE.hips[2]);
    if (N.staff) { N.staff.position.set(NODE.staff[0], NODE.staff[1], NODE.staff[2]); N.staff.rotation.set(0, 0, 0); }
    return A;
  }
  function flipTable(o) { if (o) for (var k in o) FLIP[k] = o[k]; texCache = null; return FLIP; }
  /* 摆位微调（回归脚本 / 控制台用）：把杖作为一个整体挪，不动贴图也不动别的部件 */
  function tune(group, o) {
    if (!group || !group.userData.parts || !group.userData.parts.staff) return null;
    var n = group.userData.parts.staff;
    if (o && o.staff) n.position.set(o.staff[0], o.staff[1], o.staff[2]);
    if (o && o.staffRot) n.rotation.set(o.staffRot[0], o.staffRot[1], o.staffRot[2]);
    return { pos: [n.position.x, n.position.y, n.position.z], rot: [n.rotation.x, n.rotation.y, n.rotation.z] };
  }

  G.HERO = { build: build, animate: animate, cast: cast, hurt: hurt, land: land,
    setGemColor: setGemColor, pose: pose, stats: stats, flip: flipTable, tune: tune, refit: refit, reset: reset, setMode: setMode, mode: function () { return MODE; },
    NODE: NODE, ATTACH: ATTACH, FIT: FIT };
})(window.GW = window.GW || {});
