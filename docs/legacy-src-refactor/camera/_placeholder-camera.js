/* ================= GW.OTSCamera =================
   视角系统。三种模式（进局后按 C 循环，选择记在 localStorage）：

     shoulder       越肩（默认）：相机挂在肩后上方，身体挡住准星时自动不画自己
     first          第一人称：相机就是玩家眼睛，不画身体，准星与瞄准射线完全重合
     shoulderClean  越肩但永不画自己（想看清场面、或机器弱时用）

   本轮重构解决的三类"视角问题"（实测数据见 README 验收表）：
   1) 准星与选中的格子对不上：旧版先用数学算 fwd，再把相机 lookAt 到一个
      额外右移 0.45、下压 0.16 的 pivot 上——画面中心实际偏右约 2°，
      而瞄准射线用的还是 fwd，于是准星压在 A 格、命中的是 B 格。
      现在统一：相机构图完成后，dir 从相机真实朝向（quaternion）反推，
      "渲染出的画面正中央"与"射线选中的格子"是同一个数。
   2) 身体顶进准星：贴墙时半径一路缩到 0.55，而只有 <0.95 才不画自己，
      于是 0.95~2 这段整个身体糊在画面中央。现在收缩下限提到 tightRadius，
      一侧肩被挡得难受就先换另一侧肩（GTA 式，带滞后不来回跳），
      两侧都被挡才贴脸；只要身体投影压到中央准星区就不画自己。
   3) 相机被甩上天：旧版用 surfaceY 约束相机高度，而树叶在方块表里
      solid=true，站在树旁相机被抬到树冠顶（实测 y 15.9 → 25.6）。
      现在用 camGroundY（只认结构方块）+ 相机不得埋进固体。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  var MODES = ['shoulder', 'first', 'shoulderClean'];
  var MODE_CN = { shoulder: '越肩', first: '第一人称', shoulderClean: '越肩·不画自己' };
  /* 中央准星禁飞区（屏幕比例，y 从上往下计）：身体部件投影落进这块才不画。
     要贴着准星取：准星本身只有 26px（约中心 2%），黄框一格在 5 格外约占屏宽 7%。
     留得太宽会把整个越肩构图判成挡视线——曾经取 ±7%/±10%，结果镜头一压低
     （看脚下雪地）就误判"身体挡准星"，把整具角色抹掉，画面只剩一片地形。 */
  var CROSS = { x0: 0.45, x1: 0.55, y0: 0.42, y1: 0.58 };
  G.CAM_CROSS = CROSS;

  function OTSCamera(aspect, opts) {
    opts = opts || {};
    /* near 保持 0.08。曾试着提到 0.26 想把"相机探进方块"的穿帮用近裁剪盖掉，
       截图证明盖不住：它只裁掉相机后方 0.26 内的面，而固体在相机**四周**，
       结果是相机钻进树冠里、画面上半部整片是方块内部面、角色直接消失。 */
    this.cam = new THREE.PerspectiveCamera(opts.fov || 74, aspect, opts.near || 0.08, opts.far || 260);
    this.fovShoulder = opts.fov || 74;
    this.fovFirst = opts.fovFirst || 80;              // 第一人称稍宽，贴墙时不至于憋
    this.mode = MODES.indexOf(opts.mode) >= 0 ? opts.mode : 'shoulder';

    this.radius = opts.radius || 2.95;                // 越肩：相机在肩后同一高度，背部与持牌手入画
    this.tightRadius = opts.tightRadius || 1.25;      // 两侧都被挡时的最近距离（旧版 0.55 会把身体顶进准星）
    this.curRadius = this.radius;
    this.shoulder = opts.shoulder === undefined ? 1.55 : opts.shoulder;
    // eyeH 相对实体中心（身体中点）：0.62 ≈ 眼睛位置，再高就变俯视图
    this.eyeH = opts.eyeH === undefined ? 0.62 : opts.eyeH;

    this.yawSm = null; this.smoothYaw = opts.smoothYaw || 26;
    this.smooth = opts.smooth || 12;
    this.sideSign = 1; this.sideBlockedT = 0; this.sideCool = 0;   // 挂哪一侧肩，换边带滞后
    this.floorSm = null; this.hardUnstick = 0;                     // 托举高度与兜底触发计数
    this.maxCamSpeed = opts.maxCamSpeed || 26;                      // 机位最大位移速度（格/s）：把任何二值约束的硬跳摊成几帧
    this._prevPos = null; this._prevEye = null;                     // 上一帧最终机位 / 上一帧眼睛位（后者用于识别传送）
    this._prevR = 0; this._prevLat = 0;                             // 上一帧半径与侧移：用来把"转身构图运动"从限流里排除
    this.dbg = { tag: 'camdbg-v1', jump: 0, mx: 0, snap: 0, embed: 0, preX: 0, preY: 0, preZ: 0 };   // 限流决策留痕，排查机位跳变用
    this.ballR = opts.ballR || 0.35;                                 // 相机球体积：避墙用它，不再用点测试+固定余量
    /* 三个跟随通道：半径 / 侧移 / 地面抬升。cam.pos 由它们算出，约束只写目标值。 */
    this.rCh = { x: this.radius, v: 0 };
    this.lCh = { x: 0, v: 0 };
    this.fCh = { x: 0, v: 0 };
    this.vRelease = opts.vRelease || 4;                              // 半径离墙速度（慢，回弹）
    this.vYield = opts.vYield || 60;                                 // 半径让路速度（快，避墙）
    this.accel = opts.accel || 1200;                                 // 加速度上限：决定机位单帧位移上限
    this.vSide = opts.vSide || 20; this.accelSide = opts.accelSide || 300;
    this.vLift = opts.vLift || 20; this.vDrop = opts.vDrop || 6;
    this.smoothSide = opts.smoothSide || 14;                       // 横向偏移跟随速率：换肩/收拢都扫过去，不许瞬移
    this.latSm = null;

    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.aimOrigin = new THREE.Vector3();             // 瞄准射线起点（与相机同点，保证准星一致）
    this.shake = 0;
    this.selfHidden = false; this.selfClearT = 0;     // 躯干/头挡住准星 → 整具不画（带 0.3s 复现滞后，防抖）
    this.legsHidden = false;                           // 只有腿挡 → 只藏腿
    this.propsHidden = false;                          // 只有手臂或肩上那张牌挡 → 只画到肩
    this.tooClose = false; this.blockedFace = false;
    this.eyePoint = new THREE.Vector3();
    this.eyeHeight = 0.62;

    this._v = new THREE.Vector3(); this._look = new THREE.Vector3();
    this._right = new THREE.Vector3(); this._back = new THREE.Vector3();
    this._tmp = new THREE.Vector3(); this._cs = new THREE.Vector3();
    this._invQ = new THREE.Quaternion();
  }

  OTSCamera.prototype.resize = function (aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); };
  /* 把三个通道直接落到目标值并清掉速度：开局、换模式、玩家被传送/复活时用，
     避免"从旧状态滑行过去"被当成抖动，也避免复活时机位滞后在原地。 */
  OTSCamera.prototype.snapToTarget = function () {
    var collapse = 1 - Math.min(1, Math.max(0, (this.radius - this.tightRadius) / Math.max(0.001, this.radius - this.tightRadius)));
    this.rCh = { x: this.radius, v: 0 };
    this.lCh = { x: this.shoulder * (0.84 + 0.42 * collapse) * (this.sideSign >= 0 ? 1 : -1), v: 0 };
    this.fCh = { x: 0, v: 0 };
    this.curRadius = this.rCh.x; this.curLat = this.lCh.x; this.floorSm = 0;
    this._prevEye = null;
  };
  OTSCamera.prototype.isFirst = function () { return this.mode === 'first'; };
  OTSCamera.prototype.modeName = function () { return MODE_CN[this.mode] || this.mode; };
  OTSCamera.prototype.setMode = function (m) {
    if (MODES.indexOf(m) < 0) return false;
    this.mode = m; this.yawSm = null; this.sideBlockedT = 0; this.selfClearT = 0; this.sideSign = 1;
    this.snapToTarget();                       // 三通道直接落到目标值并清速度（机位是状态量的纯函数）
    this.propsHidden = false; this.legsHidden = false;
    this.cam.fov = this.mode === 'first' ? this.fovFirst : this.fovShoulder;
    this.cam.updateProjectionMatrix();
    return true;
  };
  OTSCamera.prototype.nextMode = function () {
    var i = MODES.indexOf(this.mode);
    this.setMode(MODES[(i + 1) % MODES.length]);
    return this.mode;
  };
  OTSCamera.prototype.kick = function (n) { this.shake = Math.max(this.shake, n); };

  /* 遮挡射线的接受条件：水/岩浆可穿，树叶仍然挡——否则相机会钻进树里糊成一片色块 */
  function camAccept(id) { return id !== G.BLOCK.WATER && id !== G.BLOCK.LAVA; }

  /* 带速度与加速度双有界的二阶跟随（梯形速度曲线）：target 变大用 vUp、变小用 vDown（不对称，
     因为"离墙放回"要慢、"让路收缩"要快）。机位二阶差分上限 = accel·dt²，
     于是"防抖"与"快速让路"各管各的通道，不再像旧写法那样挤在同一条位置域限流里互相抢。 */
  function servo(ch, target, dt, vUp, vDown, accel) {
    var err = target - ch.x;
    if (!isFinite(err)) { ch.v = 0; return ch; }
    var vmax = err > 0 ? vUp : vDown;
    var wantV = Math.max(-vmax, Math.min(vmax, err * 12));
    var amax = accel * dt, dv = wantV - ch.v;
    ch.v += Math.max(-amax, Math.min(amax, dv));
    var dx = ch.v * dt;
    if ((err > 0 && dx >= err) || (err < 0 && dx <= err)) { ch.x = target; ch.v = 0; }
    else ch.x += dx;
    return ch;
  }

  /* 沿 back 做球扫掠，返回相机能待的最远臂长：从近往外按 0.25 步进，
     第一个球被固体挤压处停下并回退一档作安全余量（K3 方案，代替点射线 + 写死 0.28）。 */
  function sweepArm(world, eye, back, rMax, ballR) {
    var step = 0.25, d = step;
    for (; d <= rMax; d += step) {
      if (!world.cameraSphereFree(eye.x + back.x * d, eye.y + back.y * d, eye.z + back.z * d, ballR))
        return Math.max(0.55, d - step - 0.02);
    }
    return rMax;
  }

  /* 一个世界 AABB 的投影是否压住中央准星区；8 个角全在相机背后就算不挡。
     注意：Vector3.project() 内部自带 matrixWorldInverse，所以要拿世界坐标去投影；
     这里只为"在不在相机前方"另算一份相机空间坐标，不能把两次变换叠在一起
     （曾经就是这么写的，判定坐标被乘了两遍视图矩阵，身体明明压住准星却报不挡）。 */
  OTSCamera.prototype.boxHitsCross = function (min, max) {
    var cam = this.cam, front = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, i;
    this._invQ.copy(cam.quaternion).invert();
    for (i = 0; i < 8; i++) {
      this._tmp.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
      this._cs.copy(this._tmp).sub(cam.position).applyQuaternion(this._invQ);   // 相机空间，-Z 朝前
      if (this._cs.z >= -cam.near) continue;                                     // 在近裁剪面之后，不参与判定
      front++;
      this._tmp.project(cam);                                                    // 世界坐标直接投影
      var sx = this._tmp.x * 0.5 + 0.5, sy = 0.5 - this._tmp.y * 0.5;            // sy：从上往下的屏幕比例
      if (sx < minx) minx = sx; if (sx > maxx) maxx = sx;
      if (sy < miny) miny = sy; if (sy > maxy) maxy = sy;
    }
    if (!front) return false;
    return maxx > CROSS.x0 && minx < CROSS.x1 && maxy > CROSS.y0 && miny < CROSS.y1;
  };

  /* 一组部件（每组若干世界 AABB）里是否有任一件压住准星禁飞区 */
  OTSCamera.prototype.groupHitsCross = function (list) {
    if (!list || !list.length) return false;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b && b.min && b.max && this.boxHitsCross(b.min, b.max)) return true;
    }
    return false;
  };

  OTSCamera.prototype.update = function (e, world, dt, groups) {
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > 0.12) dt = 0.12;                                        // 切标签页回来不一次性甩飞
    var first = this.isFirst();
    var pitch = Math.max(-0.85, Math.min(0.72, e.pitch || 0));

    // 相机 yaw 指数跟随：转身有惯性。第一人称必须与身体同步，否则转起来晕、瞄准滞后
    if (first || this.yawSm === null || Math.abs(this.yawSm - e.yaw) > Math.PI) this.yawSm = e.yaw;
    var dyaw = ((e.yaw - this.yawSm + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    var prevYawSm = this.yawSm;
    this.yawSm += dyaw * Math.min(1, this.smoothYaw * dt);
    var yaw = first ? e.yaw : this.yawSm;
    this._dYawSm = first ? 0 : (this.yawSm - prevYawSm);   // 本帧角速度，给下面的遮挡前瞻用

    var cp = Math.cos(pitch);
    var fwd = this._v.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
    // 屏幕右方向（three.js 右手系）：面向 (sin,cos) 时右 = (-cos, sin)
    var right = this._right.set(-Math.cos(yaw), 0, Math.sin(yaw));
    var eyeBase = new THREE.Vector3(e.pos.x, e.pos.y + this.eyeH, e.pos.z);
    // 越肩的最终侧移由下面的 latOf(curRadius) 定，这里只给第一人称用（lat=0，相机即眼睛）。
    // 不要再在这里另算一份侧移给遮挡检测用——那正是"视角拉扯"里的半径误判来源。
    var eye = first ? eyeBase.clone() : eyeBase.clone();
    this.eyePoint.copy(eye);
    this.eyeHeight = this.eyeH;

    if (first) {
      // 第一人称：相机就是眼睛，没有遮挡收缩，也不画身体
      this.curRadius = 0;
      this.sideBlockedT = 0; this.tooClose = false; this.blockedFace = false;
      this.selfHidden = true; this.propsHidden = true; this.legsHidden = true;
      this._place(eye, fwd, dt);
      return;
    }

    /* ---- 越肩机位：状态域二阶伺服（K3 方案）----
       架构三条不变量：
         1) cam.pos = F(eyeBase, yawSm, pitch, rCh.x, lCh.x, fCh.x) 的**纯函数**；
         2) 全代码只允许三种状态写入：伺服积分（v 受 accel 限）、传送 snap、埋墙硬钳半径；
         3) 其余一律只写通道**目标值**，不许写状态、更不许搬 cam.pos。
       为什么必须放弃位置域限流（三条候选都被证伪）：pos 是多父派生量（eye/yaw/半径/侧移/托举），
       拿"上一帧落位"限就出现我实测到的"玩家静止、机位每帧顶格漂 0.1625 格"（=26/160 恒速爬行）；
       拿"上一帧期望"限则追上那一下不限流、且转身时目标合法移动又要特判；
       拿"名义构型"限等价于把状态域限流写进位置域。旧写法三条病全中。
       防抖的执行者改成**断言**（下面 movedVsBudget），它只报警不粉饰。 */
    var self = this;
    var ballR = this.ballR;
    var sphere = function (x, y, z) { return world.cameraSphereFree(x, y, z, ballR); };
    var collapseOf = function (r) { return 1 - Math.min(1, Math.max(0, (r - self.tightRadius) / Math.max(0.001, self.radius - self.tightRadius))); };
    var latOf = function (r, sign) { return self.shoulder * (0.84 + 0.42 * collapseOf(r)) * ((sign === undefined ? self.sideSign : sign) >= 0 ? 1 : -1); };
    /* 侧移量按投影几何定标（FOV 74、16:9 水平半视角 tan≈1.245）：躯干连描边半宽 0.34、相机身后 2.95 格，
       要让身体右缘落在屏宽 40% 以内、不侵入准星区（中心左右各 7%），lateral 约 1.30 = shoulder*0.84。
       之前试过 0.55 与 0.72，右缘都正好压在准星区边界上，平地都看不见自己。 */
    var back = this._back.copy(fwd).negate();

    /* 遮挡射线起点用**目标构型**（按目标半径定侧移），不用上一帧的跟随值。
       这一刀是斩断反馈环的关键：旧写法 want(射线)→curRadius→latOf→latSm→eyeF(射线原点)→want，
       在凹角里是二变量不动点迭代、不收敛地等幅振荡，每步都超限流上限，于是"静止时机位恒速爬行"。
       改成目标构型后 want 只是 (eyeBase, yaw, sideSign) 的纯函数，环从根上没了。
       这不违背"遮挡检测与放相机必须同一个 eye"那条教训：那是两套**不同公式**（0.55 vs 0.84+0.42c），
       此处是同一公式在目标半径处的取值，收敛态逐格相同，过渡段的差异由 ballR=0.35 的球余量吸收，
       点级埋墙由下面的硬钳半径兜底。 */
    var eyeRay = eyeBase.clone().addScaledVector(right, latOf(this.radius));
    var wantR = sweepArm(world, eyeRay, back, this.radius + 0.6, ballR);
    this.blockedFace = wantR < 1.2;
    this.sideCool = Math.max(0, this.sideCool - dt);

    if (wantR < this.radius - 0.45) {
      this.sideBlockedT += dt;
      // 被挡超过 0.22s、另一侧明显更空（>0.5 格）才换肩；换完 0.6s 内不换回。只翻意图，位移交给 lCh 扫过去
      if (this.sideBlockedT > 0.22 && this.sideCool <= 0) {
        var altRay = eyeBase.clone().addScaledVector(right, -latOf(this.radius));
        var altWant = sweepArm(world, altRay, back, this.radius + 0.6, ballR);
        if (altWant > wantR + 0.5) { this.sideSign = -this.sideSign; this.sideCool = 0.6; wantR = Math.min(this.radius, altWant); }
        this.sideBlockedT = 0;
      }
    } else if (this.sideBlockedT > 0) {
      this.sideBlockedT = Math.max(0, this.sideBlockedT - dt * 2);
    }

    /* 前瞻：臂长 sqrt(lat²+radius²)≈3.2 格，240°/s 转身即约 13 格/s 的圆弧横扫，等埋进固体再救只能瞬移。
       外推量 = 角速度 ω(rad/s) × 80ms，不写"每帧多少弧度"——那种常量在 60/160/240 FPS 下含义不同。
       业界对这道弧扫是**接受**的（160FPS 下 0.084 格/帧远在感知阈下），不靠降半径回避，
       所以旧写法里"按角速度主动收紧半径"整块删掉：它是 C2/C3 从 12/12 掉到 6/12 的风险源。 */
    var omega = dt > 0 ? (this._dYawSm || 0) / dt : 0;
    /* 前瞻要探的是**未来的机位点**，不是"未来朝向的正后方射线"。
       相机绕肩点在半径 R≈3.2 的圆弧上走，将来第 k 步的位置是 eyeBase − fwd(yaw+k·ω·Δt)·R。
       上一版拿预测朝向再扫一条正后方射线，测的完全是另一串空间点——所以把外推时长从 80ms
       加到 250ms 时，点级穿透 178→180 帧纹丝不动：那段代码实际上什么都没预见。
       另外分布统计证明这不是场景固有：静立期 0 帧、转视角期 178 帧。 */
    if (Math.abs(omega) > 0.05) {
      var LEAD = 0.22, STEPS = 6;                                   // 预看 220ms：够伺服按 accel=1200 建立起速度让开
      for (var kl = 1; kl <= STEPS; kl++) {
        var yL = yaw + Math.max(-1.2, Math.min(1.2, omega * LEAD * kl / STEPS));
        var fL = new THREE.Vector3(Math.sin(yL) * cp, Math.sin(pitch), Math.cos(yL) * cp).normalize();
        var rL = new THREE.Vector3(-Math.cos(yL), 0, Math.sin(yL));
        var eyeL = eyeBase.clone().addScaledVector(rL, this.lCh.x);
        var dL = this.rCh.x;
        // 下限必须与①②让路的 0.55 一致。上一版这里是 0.3，前瞻把 wantR 一路压到 0.29，
        // 等于允许相机收进玩家身体里（自查截图：角色整个消失），而 near=0.08 又会把身体渲出来。
        while (dL > 0.55) {
          var cL = eyeL.clone().addScaledVector(fL, -dL);
          if (sphere(cL.x, cL.y, cL.z)) break;
          dL -= 0.12;
        }
        wantR = Math.min(wantR, Math.max(0.55, dL));
      }
    }

    /* 还要按**当前跟随中的机位**再扫一次取 min。目标构型（latOf(radius)）只描述收敛后的那条臂，
       转身过渡段 lat 还在路上、真实机位偏离该射线，于是①级"球挤压"发现得太晚，
       一路放任到点级穿墙才被②瞬钳（实测点级埋墙 149 帧、jerk 冲到 2063 格/s²，就是这么来的）。
       这一步让 want 依赖 lCh，但只是取 min（只会更保守）且伺服本身有 accel 上限，
       不会重现旧写法那种等幅振荡——静立实测三档位移 0 / 0.013 / 0 已证明稳态收敛。 */
    wantR = Math.min(wantR, sweepArm(world, eyeBase.clone().addScaledVector(right, this.lCh.x), back, this.radius + 0.6, ballR));

    var eyeJump = this._prevEye ? Math.hypot(eyeBase.x - this._prevEye.x, eyeBase.y - this._prevEye.y, eyeBase.z - this._prevEye.z) : 99;
    var teleporting = eyeJump > 2;                     // 传送/复活/被顶出：直接落位并清速度，不排队滑行
    if (teleporting) {
      this.rCh.x = wantR; this.rCh.v = 0;
      this.lCh.x = latOf(wantR); this.lCh.v = 0;
      this.fCh.x = 0; this.fCh.v = 0;
    } else {
      /* 不对称速率：离墙放回 vRelease=4（慢，回弹有阻尼），让路 vYield=60（快，26ms 球余量预算内必须让开）。
         两者都受 accel 约束，机位二阶差分上限 = accel·dt² ≈ 0.047 格/帧（旧写法实测 0.956）。 */
      servo(this.rCh, wantR, dt, this.vRelease, this.vYield, this.accel);
      servo(this.lCh, latOf(this.rCh.x), dt, this.vSide, this.vSide, this.accelSide);
    }
    this.dbg.wantR = wantR; this.dbg.wantLat = latOf(this.rCh.x);      // 归因用：跳变帧上"目标是什么"必须可见
    this.curRadius = this.rCh.x;
    this.tooClose = (this.radius - this.curRadius) > (this.radius - this.tightRadius + 0.15);
    this.curLat = this.lCh.x;

    var eyeF = eyeBase.clone().addScaledVector(right, this.lCh.x);
    this.eyePoint.copy(eyeF);
    eye = eyeF;
    var desired = eyeF.clone().addScaledVector(fwd, -this.rCh.x);

    /* 地面托举改成"能抬多少抬多少"的连续二分，取代 if (desired.y < floorSm) desired.y = floorSm 那种二值钳制。
       二值钳制给目标加平滑是无效的（我试过）：开关本身每帧在跳，钳制值与自由值之差（实测 1.48 格）就是单帧位移。
       抬升量 λ 走伺服，跨到台阶/柱那一格时是几帧抬到位，而且二分保证不会把相机从墙后顶进墙体。 */
    var g = world.camGroundY(Math.floor(desired.x), Math.floor(desired.z));
    var wantLift = 0;
    if (g >= 0) {
      var floorY = Math.min(g + 1 + 0.35, eyeF.y + 1.9);          // 最多抬到头顶上方 1.9，避免被树冠甩上天
      if (desired.y < floorY) {
        var lo = 0, hi = floorY - desired.y;
        for (var kb = 0; kb < 4; kb++) {
          var mid = (lo + hi) / 2;
          if (sphere(desired.x, desired.y + mid, desired.z)) lo = mid; else hi = mid;
        }
        wantLift = lo;
      }
    }
    if (teleporting) { this.fCh.x = wantLift; this.fCh.v = 0; }
    else servo(this.fCh, wantLift, dt, this.vLift, this.vDrop, this.accel);
    this.floorSm = this.fCh.x;
    if (this.fCh.x > 0) desired.y += this.fCh.x;

    /* 让路分两级。上一版不分级别，一律瞬时钳半径，实测转视角跳变全部来自这条无速率硬钳
       （归因数据：rV=0、lCh/fCh 未变，rCh 却单帧从 2.768 掉到 2.009，与 hardUnstick 计数同步增长）。
       K3 原本假设这条触发恒 0，实测转视角时几百次——因为它按球口径触发，而球比点保守得多，
       转身过渡段（lat 还在路上、机位偏离目标构型射线）会频繁误触发。 */
    /* 沿臂往回找最近的可待距离。floor 分两级：
       球级用 0.55（再近身体就糊住准星，宁可容忍球级重叠走伺服）；
       点级用 0.15——上一版两级都用 0.55，玩家贴着地面/身后是实心山体时，0.55 深处仍在岩石内部，
       相机无路可退，实测留下 162 帧点级埋墙（J 项就卡这一条）。贴脸总比看见一整屏岩石好。 */
    var yieldTo = function (tester, floor) {
      var stepDown = this.rCh.x;
      for (var kf = 1; kf <= 12; kf++) {
        var dF = this.rCh.x * (1 - kf / 12);
        if (dF < floor) return floor;
        var cF = eyeF.clone().addScaledVector(fwd, -dF);
        if (tester(cF.x, cF.y, cF.z)) return dF;
        stepDown = dF;
      }
      return stepDown;
    }.bind(this);
    // ① 球级挤压：只写目标，由伺服以 vYield 快收。容忍两三帧球级重叠，换掉"整帧被拽走"
    if (!sphere(desired.x, desired.y, desired.z)) {
      servo(this.rCh, Math.min(this.rCh.x, yieldTo(sphere, 0.55)), dt, this.vRelease, this.vYield, this.accel);
      this.curRadius = this.rCh.x;
      this.tooClose = (this.radius - this.curRadius) > (this.radius - this.tightRadius + 0.15);
      desired = eyeF.clone().addScaledVector(fwd, -this.rCh.x);
      if (this.fCh.x > 0) desired.y += this.fCh.x;
    }
    /* ② 点级真穿墙：唯一允许的瞬时钳制（宁可跳一下，也不能把墙内渲染出来）。
       走到这里说明伺服已尽力仍来不及，实测概率应当极低；若它频繁触发，该修的是①的判据而不是这条。 */
    /* ② 点级真穿墙：保留瞬时钳制，宁可机位跳一下，也不能把方块内部渲染出来。
       上一版这里改成走伺服（"反正 near=0.26 能裁掉"），实测后果是相机钻进树冠、
       画面整片是方块内部面、角色消失（见 _shots 自查）——穿墙比跳变严重得多，A 优先于 B。
       下限 0.55 不许再往下放：曾放开到 0.3，伺服会把相机一路收进玩家身体里。 */
    if (!world.cameraFree(desired.x, desired.y, desired.z)) {
      var dPoint = yieldTo(function (x, y, z) { return world.cameraFree(x, y, z); }, 0.55);
      if (dPoint < this.rCh.x) {
        this.rCh.x = dPoint; this.rCh.v = 0;
        this.curRadius = dPoint;
        this.tooClose = (this.radius - this.curRadius) > (this.radius - this.tightRadius + 0.15);
        desired = eyeF.clone().addScaledVector(fwd, -this.rCh.x);
        if (this.fCh.x > 0) desired.y += this.fCh.x;
        this.hardUnstick++;
      }
    }

    /* 取代位置域限流的是**自检断言**：机位这一帧移动量必须落在
       「构图弧扫 + 传送 + 三通道速率上限·dt」预算之内；超了就记违例数，由 J 项断言它必须为 0。
       执行者换成伺服（加速度有界），这里只负责把违约暴露出来，不粉饰。 */
    if (this._lastPos && !teleporting) {
      var moved = Math.hypot(desired.x - this._lastPos.x, desired.y - this._lastPos.y, desired.z - this._lastPos.z);
      var budget = Math.abs(this._dYawSm || 0) * 3.22 + (this.vYield + this.vSide + this.vLift) * dt + 0.02;
      if (moved > budget) { this.posViolations = (this.posViolations || 0) + 1; this.dbg.violMoved = +moved.toFixed(3); this.dbg.violBudget = +budget.toFixed(3); }
      this.dbg.moved = +moved.toFixed(4);
    } else this.dbg.moved = 0;
    if (this._lastPos) this._lastPos.copy(desired); else this._lastPos = desired.clone();
    if (this._prevEye) this._prevEye.copy(eyeBase); else this._prevEye = eyeBase.clone();
    this._place(desired, fwd, dt);

    // ---- 谁压住准星就暂不画谁（0.3s 复现滞后，避免转身时一闪一闪）----
    // 按部件分三组各自判：头/躯干挡 → 整具不画；只有腿挡 → 只藏腿；只有手臂或肩上那张牌挡 → 只画到肩。
    // 不能用一个"整具身体的包围盒"判：斜着站时那个盒横向被放大到 0.96 格、竖向从头拉到脚，
    // 镜头一压低就蹭到准星边界，把根本没挡视线的角色整个抹掉（用户第二次截图就是这个）。
    var bodyIn = this.groupHitsCross(groups && groups.core);
    var legsIn = this.groupHitsCross(groups && groups.legs);
    var propIn = this.groupHitsCross(groups && groups.props);
    if (bodyIn) { this.selfHidden = true; this.selfClearT = 0; }
    else {
      this.selfClearT += dt;
      if (this.selfClearT > 0.3) this.selfHidden = false;
    }
    this.legsHidden = legsIn && !this.selfHidden;
    this.propsHidden = propIn && !this.selfHidden;
    if (this.mode === 'shoulderClean') { this.selfHidden = true; this.propsHidden = true; this.legsHidden = true; }
  };

  /* 摆相机：位置 + lookAt，再从真实朝向反推瞄准射线，保证"准星=选中格" */
  OTSCamera.prototype._place = function (desired, fwd, dt) {
    if (this.shake > 0) {
      this.shake -= dt;
      desired.x += (Math.random() - .5) * this.shake * 0.5;
      desired.y += (Math.random() - .5) * this.shake * 0.5;
    }
    this.pos.copy(desired);
    this.cam.position.copy(desired);
    this.cam.up.set(0, 1, 0);
    this._look.copy(desired).add(fwd);
    this.cam.lookAt(this._look);
    this.cam.updateMatrixWorld();
    // 关键不变量：瞄准方向 = 相机渲染出来的真实朝向，不再另算一份
    this.dir.set(0, 0, -1).applyQuaternion(this.cam.quaternion).normalize();
    this.aimOrigin.copy(this.cam.position);
  };

  G.OTSCamera = OTSCamera;
  G.CAM_MODES = MODES;
  G.CAM_MODE_CN = MODE_CN;

  /* 自由观战相机（菜单/胜利时用） */
  function Orbit(aspect) {
    this.cam = new THREE.PerspectiveCamera(60, aspect, 0.1, 600);
    this.target = new THREE.Vector3();
    this.dist = 70; this.az = 0.7; this.el = 0.8;
  }
  Orbit.prototype.update = function (t) {
    this.cam.position.set(this.target.x + Math.cos(this.az) * this.dist * Math.cos(this.el), this.target.y + this.dist * Math.sin(this.el), this.target.z + Math.sin(this.az) * this.dist * Math.cos(this.el));
    this.cam.lookAt(this.target);
  };
  G.OrbitCamera = Orbit;
})(window.GW);
