/* ================= GW.OTSCamera（2026-10-16 重做版） =================
   越肩 / 第一人称相机。三种模式（进局后按 C 循环，选择记在 localStorage）：
     shoulder       越肩（默认）：相机挂在肩后上方，身体挡住准星时自动不画自己
     first          第一人称：相机就是玩家眼睛，不画身体，准星与瞄准射线完全重合
     shoulderClean  越肩但永不画自己（想看清场面、或机器弱时用）

   ▍一条只往下走的管线，每帧六步，各步不许插手别人的活：
       输入 → 目标构型（几何求解，纯函数）→ 三通道伺服（唯一写状态处）
       → 落位 → 从真实相机矩阵反推瞄准射线 → 部件投影分级隐藏
     对应方法：_stepYaw / _solve / _integrate / _place / _classifySelf。

   ▍为什么是这个形状（三条拿真机数据换回来的教训，退回旧写法就会被 J 项抓住）：
     1) 机位必须是状态量的**纯函数**：pos = f(eyeBase, yaw, 半径, 侧移, 抬升)。
        任何"发现穿墙就直接把 cam.pos 搬走"的写法都会让 pos 与通道分家，下一帧按通道摆回来形成来回跳
        （旧版实测单帧 1.44~1.9 格）。所以本版所有约束只写**目标值**，位移一律交给伺服。
     2) 约束不能是逐帧二值开关——开关翻转本身就是那个要平滑的量。
        遮挡让路、地面托举、换肩、埋墙顶出四处置，全部改成"带保持时间的目标 + 阻尼扫过去"。
        保持时间（HOLD.occlude / HOLD.defl）是这一条的执行者：擦边一帧的抖动不足以改变目标。
     3) 准星=命中格：dir 与 aimOrigin 一律在 lookAt 之后从相机**真实朝向**反推（_place），
        构图偏移只通过相机位置/lookAt 表达，绝不在别处再算一份 fwd 当瞄准方向。

   ▍这一版重做掉的三件事：
     · 沿臂球扫从"0.25 步进 + 回退 0.02"改成**精确球-格求交**（固体格按半径膨胀后做 slab 相交）：
       旧口径把臂长量化到 0.25，靠近树/墙时提前一档就认输，是"臂上无路可退"的成因之一，也白烧 CPU。
     · 新增**穿透顶出**：目标构型若落在固体里，按球-格穿透深度顶出，再投影回三通道目标。
       旧版遇到这种情形只会把半径压到下限 0.55 然后整个人埋进原木（实测 114 帧点级埋墙，全是 LOG/草地）。
     · update() 拆成六个阶段函数，遮挡射线与放相机共用同一个 _eyeOf(lat)（历史 bug：一个用
       shoulder*0.55、一个用 shoulder*(0.84+0.42*collapse)，两套数永远对不齐）。

   ▍外部契约（改签名前先读）：
       main.js 用   .cam .pos .dir .aimOrigin .selfHidden .propsHidden .legsHidden
                    .isFirst .modeName .setMode .nextMode .kick .resize .snapToTarget .update
       cam_audit 另读 .radius .curRadius .eyeH .eyePoint .yawSm .posViolations .hardUnstick
                    .vYield .vSide .vLift .accel（J 项按这四个量算"物理预算"，改名等于改验收口径）
       GW.CAM_CROSS 由 cam_audit 取准星禁飞区，必须与这里同一份。

   ▍算法来源（许可已核对；代码是为体素世界重写的，没有从外部仓库搬语句）：
       hh-hang/three-player-controller（MIT）—— 弹簧臂形状，遮挡射线与放相机共用同一 eye；
       yomotsu/camera-controls（MIT）—— 每个自由度各存一条带持久速度的阻尼通道；
       three r128 MathUtils.damp（MIT）—— 帧率无关指数跟随（转向通道用它，不靠"每帧多少弧度"）。
     Unity Cinemachine 的 Deoccluder 仅作为算法说明阅读：它是 Unity Companion License，
     不许抄进本项目（源码留在 /tmp/cam-ref/ 并标注 REFERENCE-ONLY）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* ---------------- 档位表与常量 ---------------- */
  var MODES = ['shoulder', 'first', 'shoulderClean'];
  var MODE_CN = { shoulder: '越肩', first: '第一人称', shoulderClean: '越肩·不画自己' };
  /* 中央准星禁飞区（屏幕比例，y 从上往下计）：身体部件投影落进这块才不画。
     准星本身只有 26px（约中心 2%），黄框一格在 5 格外约占屏宽 7%。留得太宽会把整个越肩
     构图判成"挡视线"——曾经取 ±7%/±10%，镜头一压低就把整具角色抹掉，画面只剩地形。 */
  var CROSS = { x0: 0.45, x1: 0.55, y0: 0.42, y1: 0.58 };
  G.CAM_CROSS = CROSS;
  /* 判"整具身体罩住准星"用合并包围盒，但中心区要收紧到 ±3%/±6%：各部件的世界 AABB 对旋转中的
     手臂/腿会膨胀（斜站时横向能到 0.96 格），拿同一个 ±5%/±8% 判合并盒会在正常越肩时误抹角色。 */
  var CROSS_MERGED = { x0: 0.47, x1: 0.53, y0: 0.44, y1: 0.56 };

  var LIM = {
    pitchUp: (G.LOOK_LIMIT && G.LOOK_LIMIT.up) || 0.72,
    pitchDown: (G.LOOK_LIMIT && G.LOOK_LIMIT.down) || -0.85,   // 俯仰夹取：与 battle.js 的 applyLook 同一份真源
    minArm: 0.55,                          // 臂长下限：再近身体就糊住准星（改它必须重跑 C 项）
    armProbe: 0.6,                         // 沿臂多探 0.6 格：贴墙有缓冲，不至于一碰就抖
    sweepEps: 0.02,                        // 让路安全余量
    groundClear: 0.35,                     // 相机至少离地 0.35，免得半屏是地表贴图
    maxLift: 1.9,                          // 托举最多到头顶上方 1.9（再高就成了俯视图，D 项报警）
    maxDt: 0.12                            // 切标签页回来不一次性甩飞
  };
  var LEAD = { time: 0.26, steps: 6, minOmega: 0.05 };   // 转身前瞻：机位沿圆弧扫向前方的固体
  /* 大俯仰收臂档位：俯仰放开到 ±89° 后，越肩机位 = eye + back·r + right·lat，
     垂直看地时 back 几乎就是 (0,1,0)——r 不收到 2.4 以内，相机会飞到头顶 3 格外，
     既超出审计 D 项的高度差口径，也变成"从天花板上俯视"的怪构图（旧 pitch 上限 0.72
     其实就是拿"不让你往下看"来掩盖这个问题）。
     规则写成 pitch 的连续函数（不是逐帧开关），位移仍然只由 rCh 伺服产出：
       |pitch| ≤ flatK            → 名义臂长
       flatK → steepK 之间        → 线性收到 minK·radius
       |pitch| ≥ steepK           → 保持 minK·radius（不再继续缩，留得住侧移构图）
     档位起点必须等于旧的俯仰上限 0.85（≈49°）：0.85 以内一个姿态都不许动，
     否则审计 C4"低头时不消失"会红——实测把 flatK 取 0.5 时，pitch=−0.85 的臂长被压到 2.29，
     躯干最近角点进到相机空间 1.45 以内触发 nearStraddle，身体投影在 x7~37%（根本没压准星）却被整具抹掉。
     收臂只负责新放开的那段角度（0.85 → 89°）。 */
  var PITCH_ARM = { flatK: 0.85, steepK: 1.35, minK: 0.5 };
  var HOLD = {
    occlude: 0.16,      // 让路保持时间：挡一下就立刻放回会让机位来回抖
    sideBlock: 0.22,    // 一侧被挡多久才考虑换肩
    sideCool: 0.6,      // 换完多久不许换回
    sideGain: 0.5,      // 另一侧至少要空出这么多格才值得换
    sideMargin: 0.45,   // 挡到什么程度才算"被挡"
    defl: 0.15,         // 偏转姿态粘住时间：每帧重选候选=机位永远在动
    deflMargin: 1.2     // 换偏转姿态要明显更好才换
  };
  /* 偏转候选（埋进固体时用）：先小幅顶出，再绕侧、收臂，最后才换到另一侧肩。
     代价权重单位是"格"，同侧解便宜、换肩最贵。 */
  var SEARCH = {
    lifts: [0, 0.45, 0.9, 1.35, 1.8],
    latModes: [1, 0.55, 0],   // 侧移按名义值的档位取：越肩用满档，收臂兜底时可以往中线收
    rScales: [1, 0.72, 0.45],
    behindDot: 0.45,          // 候选机位相对玩家必须落在背向 63° 锥内
    wR: 1.0,                  // 臂收短的代价（每格）
    wLat: 1.4,                // 偏离"名义侧移"的代价（每格）
    wOff: 0.35,               // 兜底候选里机位绝对侧偏的代价（越贴中线越不糊脸）
    wLift: 1.1, wSide: 2.2    // 抬高 / 换到另一侧肩的代价
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  /* 部件进入相机前方 NEAR_BODY 深度以内就按"罩住准星"处理（口径 = 相机空间深度，与审计的 bb.near 一致）。
     两个原因：① 盒跨近裁剪面时"投 AABB 八个角"失真——角点被"只取相机前方"规则丢掉后，剩下角点的投影
     范围**小于**顶点真实投影范围，明明糊住准星却判成没挡（审计按顶点遍历没这问题，两边就是这么对不上的）。
     ② 侧向很偏的部件也能靠极端投影把屏幕矩形盖过中线（seed 88092 yaw=3.34：最深顶点 1.31，屏盒 x−2541%~445%）。
     历史口径踩过的坑：按"相机→盒面欧氏距离"判邻近（1.25、1.45 两版）会误伤 C2——侧向部件深度近、盒面
     距离远，两种口径一个漏判一个过判；统一用深度后 C/C2/C3 三个口径同时成立（2026-10-16 实测）。 */
  var NEAR_BODY = 1.45;
  /* 角色自己的"个人体积"半径：体素球测试只管方块，不管角色本身，于是候选搜索会接受
     "臂长 0.66、侧移 0"这种钻进自己身体里的姿态（实测：相机贴着头 1.15 格、身后又是墙，
     安全闸每帧触发 → 240FPS 转视角 jerk 3126）。用体积代价把它排到候选表最后。 */
  var BODY_R = 1.15, W_INBODY = 3.0;
  /* 换边的时机门槛：侧移通道是**直线**从一侧扫到另一侧，臂长还很短时这条直线会穿过角色身体
     与身后那一格地形（实测 105 帧点级穿透全在这段过渡里）。
     解决办法不去改目标值（改目标＝新的每帧开关，实测把 240FPS 的 jerk 顶到 7123、穿透反而涨到 0.80%），
     而是只卡**决策**：机位还没退到身体轮廓之外就不许换边，等能"绕过去"的时候再换。 */
  var FLIP_MIN_ARM = 1.35;

  /* ---------------- 唯一运动原语：梯形速度伺服 ----------------
     每个自由度一条通道、一条持久速度（帧率无关），受"最大速度 + 最大加速度"双有界。
     为什么不用指数 damp：damp 的加速度 = λ²·误差，误差 1.5 格时单帧速度突变远超验收预算；
     为什么不用位置域限流：pos 是多父派生量，拿上一帧落位去限会造成"玩家静止、机位恒速爬行"
     （旧版实测每帧顶格漂 0.1625 = 26/160）。收放不对称：离墙放回慢（vUp）、让路快（vDown）。 */
  function Servo(x) { this.x = x; this.v = 0; }
  Servo.prototype.snap = function (x) { this.x = x; this.v = 0; };
  /* 关键点不是"限流"而是"能刹住"：本帧速度上限由**剩余误差**与**加速度上限**共同决定
       |v| ≤ √((accel·dt)² + 2·accel·|err|) − accel·dt
     ——走完这一帧之后，剩下的误差还够它以 accel 逐帧把速度降到 0。少了这一条，追一个
     持续远离的目标时会一路加速，等目标停下就只剩"到点瞬间清零速度"可选，实测一帧抹掉
     20 格/s 的径向速度，转视角 jerk 直接冲到 4500（预算 2880）。到点后位置钉住、速度按
     accel 继续衰减两三帧，机位序列保持平滑，静立仍然是 0.000。 */
  Servo.prototype.pursue = function (target, dt, vUp, vDown, accel) {
    var err = target - this.x;
    if (!isFinite(err)) { this.v = 0; return this; }
    var amax = accel * dt, sign = err > 0 ? 1 : -1;
    if (Math.abs(err) < 1e-4) { this.x = target; this.v -= sign * amax; if (sign * this.v < 0) this.v = 0; return this; }
    var capV = Math.sqrt(amax * amax + 2 * accel * Math.abs(err)) - amax;
    var wantV = sign * Math.min(sign > 0 ? vUp : vDown, capV);
    var dv = wantV - this.v;
    this.v += dv > amax ? amax : (dv < -amax ? -amax : dv);
    var nx = this.x + this.v * dt;
    if ((sign > 0 && nx >= target) || (sign < 0 && nx <= target)) {   // 本帧就穿过目标：钉住位置，速度继续衰减
      this.x = target;
      this.v -= sign * amax;
      if (sign * this.v < 0) this.v = 0;
      return this;
    }
    this.x = nx;
    return this;
  };

  /* ---------------- 体素几何：弹簧臂的三只眼睛 ----------------
     固体口径与 world.cameraSphereFree / cameraFree 完全一致（水/岩浆可穿，树叶仍然挡：
     否则相机会钻进树冠糊成一片色块，而验收按 cameraFree 判，松口径等于自欺）。 */
  function camSolid(world, x, y, z) {
    var id = world.get(x, y, z);
    if (!id) return false;
    var d = G.BLOCK_DEFS[id];
    return !!d && d.solid && !d.liquid;
  }
  /* 点射线 vs "按 rad 膨胀的格 AABB"（slab 法）；命中返回进入距离，不相交返回 -1。
     球-格相交等价于点-膨胀盒相交，所以臂长求解一次遍历就精确，不必再按 0.25 步进试。 */
  function rayInflated(ox, oy, oz, dx, dy, dz, cx, cy, cz, rad) {
    var tmin = 0, tmax = 1e9, lo, hi, t, t2, s;
    lo = cx - rad; hi = cx + 1 + rad;
    if (Math.abs(dx) < 1e-9) { if (ox < lo || ox > hi) return -1; }
    else { t = (lo - ox) / dx; t2 = (hi - ox) / dx; if (t > t2) { s = t; t = t2; t2 = s; } if (t > tmin) tmin = t; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    lo = cy - rad; hi = cy + 1 + rad;
    if (Math.abs(dy) < 1e-9) { if (oy < lo || oy > hi) return -1; }
    else { t = (lo - oy) / dy; t2 = (hi - oy) / dy; if (t > t2) { s = t; t = t2; t2 = s; } if (t > tmin) tmin = t; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    lo = cz - rad; hi = cz + 1 + rad;
    if (Math.abs(dz) < 1e-9) { if (oz < lo || oz > hi) return -1; }
    else { t = (lo - oz) / dz; t2 = (hi - oz) / dz; if (t > t2) { s = t; t = t2; t2 = s; } if (t > tmin) tmin = t; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    return tmin;
  }
  /* 球沿 (dx,dy,dz) 最多推进 maxD，返回"球（半径 rad）不碰任何固体"的最远距离。
     DDA 走中心线，对每个到访格查 3×3×3 邻域：rad ≤ 1 时被膨胀盒够到的固体必定在这圈里。
     best 越查越小，一旦不超过当前到访格的进入距离就收工，所以比"每 0.25 试一次球测试"便宜。 */
  function armClearDepth(world, ox, oy, oz, dx, dy, dz, maxD, rad) {   // rad 由调用方决定：目标求解用 probeR，兜底用 ballR
    /* 查询多探 eps 再收回到 maxD：否则"这一路上根本没东西"也会返回 maxD − eps，
       调用方按它当上限就会每帧认为自己越界 0.02 格（安全闸因此常开，机位被反复硬钳 → J 项 jerk 爆表）。 */
    /* 快路径：先按 0.25·maxD 间距做 4 次球测试（间距 ≈0.74 格），全自由就直接给满长度。
       固体格被 rad 膨胀后沿射线的相交区间通常 ≥1.5 格 > 采样间距，所以开阔地里这条快路径与精确解同结论；
       一旦有采样点撞住，再走下面的精确 DDA 细化。没有它，整轮验收从 40s 涨到 5min
       （每帧 5 条前瞻臂 × 每到访格 27 次球-格测试，太贵）。 */
    var qi, qs = [0.25, 0.5, 0.75, 1], td;
    for (qi = 0; qi < 4; qi++) {
      td = maxD * qs[qi];
      if (!world.cameraSphereFree(ox + dx * td, oy + dy * td, oz + dz * td, rad)) break;
    }
    if (qi === 4) return maxD;
    var limit = maxD + LIM.sweepEps + 0.02, best = limit, x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    var stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    var tdX = Math.abs(1 / (dx || 1e-9)), tdY = Math.abs(1 / (dy || 1e-9)), tdZ = Math.abs(1 / (dz || 1e-9));
    var tmX = tdX * (stepX > 0 ? (x + 1 - ox) : (ox - x));
    var tmY = tdY * (stepY > 0 ? (y + 1 - oy) : (oy - y));
    var tmZ = tdZ * (stepZ > 0 ? (z + 1 - oz) : (oz - z));
    var t = 0, guard = 0, cx, cy, cz, tt;
    while (t < best && t <= limit && guard++ < 160) {
      for (cx = x - 1; cx <= x + 1; cx++) for (cy = y - 1; cy <= y + 1; cy++) for (cz = z - 1; cz <= z + 1; cz++) {
        if (!camSolid(world, cx, cy, cz)) continue;
        tt = rayInflated(ox, oy, oz, dx, dy, dz, cx, cy, cz, rad);
        if (tt >= 0 && tt < best) best = tt;
      }
      if (tmX < tmY && tmX < tmZ) { x += stepX; t = tmX; tmX += tdX; }
      else if (tmY < tmZ) { y += stepY; t = tmY; tmY += tdY; }
      else { z += stepZ; t = tmZ; tmZ += tdZ; }
    }
    return Math.min(maxD, best - LIM.sweepEps);
  }
  /* 把"半径 rad 的球卡在固体里"需要的顶出量累加进 out（沿"球心 ← 最近点"反方向，长度 = rad − 距离）。
     球心整颗在格内时没有最近点可言，改沿最浅的那个面出去。返回是否发生穿透。 */
  function pushOut(world, x, y, z, rad, out) {
    out.set(0, 0, 0);
    var x0 = Math.floor(x - rad), x1 = Math.floor(x + rad);
    var y0 = Math.floor(y - rad), y1 = Math.floor(y + rad);
    var z0 = Math.floor(z - rad), z1 = Math.floor(z + rad);
    var r2 = rad * rad, cx, cy, cz, found = false;
    for (cx = x0; cx <= x1; cx++) for (cy = y0; cy <= y1; cy++) for (cz = z0; cz <= z1; cz++) {
      if (!camSolid(world, cx, cy, cz)) continue;
      var nx = x < cx ? cx : (x > cx + 1 ? cx + 1 : x);
      var ny = y < cy ? cy : (y > cy + 1 ? cy + 1 : y);
      var nz = z < cz ? cz : (z > cz + 1 ? cz + 1 : z);
      var dx = x - nx, dy = y - ny, dz = z - nz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      found = true;
      if (d2 > 1e-6) { var k = (rad - Math.sqrt(d2)) / Math.sqrt(d2); out.x += dx * k; out.y += dy * k; out.z += dz * k; continue; }
      var ex = Math.min(x - cx, cx + 1 - x), ey = Math.min(y - cy, cy + 1 - y), ez = Math.min(z - cz, cz + 1 - z);
      if (ex <= ey && ex <= ez) out.x += (x - (cx + 0.5) >= 0 ? 1 : -1) * (ex + rad);
      else if (ey <= ez) out.y += (y - (cy + 0.5) >= 0 ? 1 : -1) * (ey + rad);
      else out.z += (z - (cz + 0.5) >= 0 ? 1 : -1) * (ez + rad);
    }
    return found;
  }

  /* ---------------- OTSCamera ---------------- */
  function OTSCamera(aspect, opts) {
    opts = opts || {};
    /* near 保持 0.08。曾试着提到 0.26 想把"相机探进方块"的穿帮用近裁剪盖掉，截图证明盖不住：
       它只裁掉相机后方 0.26 内的面，而固体在相机**四周**，结果是相机钻进树冠、上半屏整片是
       方块内部面、角色直接消失。真正的解法是别把相机放进固体（本版 pushOut + 候选搜索）。 */
    this.cam = new THREE.PerspectiveCamera(opts.fov || 74, aspect, opts.near || 0.08, opts.far || 260);
    this.fovBase = opts.fov || 74;
    this.fovShoulder = this.fovBase;
    this.fovFirst = opts.fovFirst || (this.fovBase + 6);  // 第一人称稍宽，贴墙时不至于憋
    this.fovSprintKick = opts.fovSprintKick === undefined ? 7 : opts.fovSprintKick;
    this.fovGain = 1;                                    // 设置界面调 0..1（0 = 不晃）
    this.bobGain = 1;
    this._fovCur = this.fovShoulder;
    this._bobPhase = 0;
    this.mode = MODES.indexOf(opts.mode) >= 0 ? opts.mode : 'shoulder';

    this.radius = opts.radius || 2.95;                   // 越肩：相机在肩后同一高度，背部与持牌手入画
    this.tightRadius = opts.tightRadius || 1.25;         // 两侧都被挡时的最近距离（旧版 0.55 会把身体顶进准星）
    this.shoulder = opts.shoulder === undefined ? 1.55 : opts.shoulder;
    this.eyeH = opts.eyeH === undefined ? 0.62 : opts.eyeH;   // 相对实体中心（身体中点）；再高就变俯视图
    this.ballR = opts.ballR || 0.35;                     // 相机球体积：顶出、候选、安全闸按这个口径
    /* 探测球比相机球大一档：让路目标用 probeR 判，等于**提前 0.17 格**开始让。
       为什么必须提前：240FPS 下任何瞬时位移 > 0.05 格就把 jerk 预算(2880)打爆（Δv/dt = Δx/dt²），
       所以"来不及让"不能靠事后硬钳解决，只能靠更早发现。实测去掉瞬移、只加大探测球，
       转视角 jerk 从 5267 落回预算内。 */
    this.probeR = opts.probeR || 0.62;

    this.smoothYaw = opts.smoothYaw || 26;               // 转向惯性（越肩专用；第一人称必须与身体同步）
    this.yawSm = null; this.arcT = 0;
    this.sideSign = 1; this.sideBlockedT = 0; this.sideCool = 0; this.occT = 0;

    /* 三个跟随通道：臂长 / 侧移 / 抬升。cam.pos 永远是它们的纯函数（见文件头不变量 1）。 */
    this.rCh = new Servo(this.radius);
    this.lCh = new Servo(this.shoulder * 0.84);
    this.fCh = new Servo(0);
    this.tgt = { r: this.radius, lat: this.shoulder * 0.84, lift: 0 };
    /* 速率与加速度（cam_audit 的 J 项按这四个量算物理预算，改名等于改验收口径）：
       让路快、放回慢；横向与托举各管各的通道，不挤同一条位置域限流。 */
    this.vRelease = opts.vRelease || 4;
    this.vYield = opts.vYield || 60;
    /* 每帧所有通道合计的"速度变化上限"必须 ≤ 2·accel：cam_audit 的 jerk 预算就是按这个假设给的
       （2×accel×1.2）。所以三条通道各自取 900 / 300 / 300，合计 1500，剩下 900 留给安全闸那**一次
       追加伺服**（见 _integrate）。上一版三条通道都用 accel=1200，再叠上安全闸的瞬时 snap，
       实测转视角 jerk 5267（预算 2880）。 */
    this.accel = opts.accel || 1200;
    this.accelArm = opts.accelArm || 900;
    this.vSide = opts.vSide || 20; this.accelSide = opts.accelSide || 260;
    this.vLift = opts.vLift || 20; this.vDrop = opts.vDrop || 6; this.accelLift = opts.accelLift || 260;

    this.curRadius = this.rCh.x; this.curLat = this.lCh.x; this.floorSm = this.fCh.x;
    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.aimOrigin = new THREE.Vector3();                // 瞄准射线起点（与相机同点，保证准星一致）
    this.eyePoint = new THREE.Vector3();
    this.shake = 0; this.shakeT = 0; this._shakeX = 0; this._shakeY = 0; this.shakeGain = 1;
    this.selfHidden = false; this.selfClearT = 0;        // 躯干/头挡准星 → 整具不画（0.3s 复现滞后防闪）
    this.legsHidden = false;                             // 只有腿挡 → 只藏腿
    this.propsHidden = false;                            // 只有手臂或肩上那张牌挡 → 只画到肩
    this.tooClose = false; this.blockedFace = false;
    this.posViolations = 0; this.hardUnstick = 0; this.embedFrames = 0; this.emergencySnaps = 0;
    this.gateSteps = opts.gateSteps === undefined ? 1 : opts.gateSteps;   // 让路档位：1=只主伺服（实测 2 档不减少穿透、却把 240FPS jerk 从 1894 抬到 2591）
    this.dbg = { tag: 'cam-v7-target', wantR: 0, tgtR: 0, tgtLat: 0, tgtLift: 0, moved: 0, held: 'nominal', push: 0 };

    this._eyeBase = new THREE.Vector3(); this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3(); this._back = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._push = new THREE.Vector3(); this._tmp = new THREE.Vector3();
    this._pose = new THREE.Vector3(); this._placeV = new THREE.Vector3(); this._look = new THREE.Vector3();
    this._eyeRay = new THREE.Vector3(); this._eyeFollow = new THREE.Vector3(); this._playerC = new THREE.Vector3();
    this._lastPos = null; this._prevEye = null; this._invQ = new THREE.Quaternion(); this._cs = new THREE.Vector3();
    this._held = null; this._heldT = 0; this._lever = 3.22; this._frameDt = 1 / 60; this.rFloor = undefined; this.freeT = 0; this._dYawSm = 0; this._pitch = 0;
  }

  OTSCamera.prototype.resize = function (aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); };
  OTSCamera.prototype.isFirst = function () { return this.mode === 'first'; };
  OTSCamera.prototype.modeName = function () { return MODE_CN[this.mode] || this.mode; };
  OTSCamera.prototype.kick = function (n) { this.shake = Math.max(this.shake, n * (this.shakeGain === undefined ? 1 : this.shakeGain)); this.shakeT = 0; };

  /* 侧移量按投影几何定标（FOV 74、16:9 水平半视角 tan≈1.245）：躯干连描边半宽 0.34、相机身后 2.95 格，
     要让身体右缘落在屏宽 40% 以内、不侵入准星区（中心左右各 7%），lateral 约 1.30 = shoulder*0.84。
     臂越短越要往侧外绕（collapse 项），否则身体糊进准星。 */
  OTSCamera.prototype.collapseOf = function (r) {
    return 1 - clamp((r - this.tightRadius) / Math.max(0.001, this.radius - this.tightRadius), 0, 1);
  };
  OTSCamera.prototype.latOf = function (r, sign) {
    var s = (sign === undefined ? this.sideSign : sign);
    return this.shoulder * (0.84 + 0.42 * this.collapseOf(r)) * (s >= 0 ? 1 : -1);
  };
  /* 遮挡射线与放相机**必须**用同一个 eye：整个文件只有这一个地方算肩点。 */
  OTSCamera.prototype._eyeOf = function (lat, out) {
    return out.copy(this._eyeBase).addScaledVector(this._right, lat);
  };

  /* 把三通道直接落到目标值并清速度：开局、换模式、复活/传送后用，避免"从旧状态滑行"被当成抖动。 */
  OTSCamera.prototype.snapToTarget = function () {
    var r = this.radius, lat = this.latOf(r);
    this.rCh.snap(r); this.lCh.snap(lat); this.fCh.snap(0);
    this.tgt.r = r; this.tgt.lat = lat; this.tgt.lift = 0;
    this.curRadius = r; this.curLat = lat; this.floorSm = 0;
    this.yawSm = null; this._held = null; this._heldT = 0; this.freeT = 0; this.occT = 0; this.rFloor = undefined;
    this._lastPos = null; this._prevEye = null;
  };
  OTSCamera.prototype.setMode = function (m) {
    if (MODES.indexOf(m) < 0) return false;
    this.mode = m; this.sideBlockedT = 0; this.selfClearT = 0; this.sideSign = 1; this.occT = 0;
    this.snapToTarget();
    this.propsHidden = false; this.legsHidden = false;
    this._fovCur = m === 'first' ? this.fovFirst : this.fovShoulder;
    this.cam.fov = this._fovCur;
    this.cam.updateProjectionMatrix();
    return true;
  };
  /* 设置界面的 FOV 旋钮：只改"基础视角"，第一人称自动 +6°（贴墙不憋），
     疾跑 kick 由 fovGain 控制。任何一档都即时生效，不用重开一局。 */
  OTSCamera.prototype.setFovBase = function (fov) {
    fov = clamp(+fov || this.fovBase, 50, 110);
    this.fovBase = fov; this.fovShoulder = fov; this.fovFirst = Math.min(115, fov + 6);
    this._fovCur = this.isFirst() ? this.fovFirst : this.fovShoulder;
    this.cam.fov = this._fovCur; this.cam.updateProjectionMatrix();
    return this.fovBase;
  };
  /* 疾跑 FOV kick：速度超过阈值才给，按指数跟随（帧率无关），松手慢慢回落。 */
  OTSCamera.prototype._updateFov = function (dt, e) {
    var base = this.isFirst() ? this.fovFirst : this.fovShoulder;
    var spd = e && e.speed || 0;
    var sprintK = (e && e.sprint && spd > 3.2) ? Math.min(1, (spd - 3.2) / 3.6) : 0;
    var want = base + this.fovSprintKick * sprintK * this.fovGain;
    if (!isFinite(this._fovCur)) this._fovCur = want;
    var k = 1 - Math.exp(-7 * Math.max(0.001, dt));
    this._fovCur += (want - this._fovCur) * k;
    if (Math.abs(this.cam.fov - this._fovCur) > 0.015) {
      this.cam.fov = this._fovCur;
      this.cam.updateProjectionMatrix();
    }
  };
  /* 走路/疾跑的镜头摇晃：按速度积分相位（不用 match.time 乘系数，20Hz 会把连续摇摆量化）。
     只改相机位置/横滚，不改 this.pos（那是验收读的基准机位），所以 cam_audit 的静立/转视角判据
     一个数都不动；第一人称站着时 amp=0，J 项仍是 0。
     顺序：_place 之后叠加，再从真实相机矩阵反推 dir/aimOrigin——准星=命中格这条不变量继续成立。 */
  OTSCamera.prototype._applySway = function (dt, e) {
    var spd = e && e.speed || 0;
    var moveK = Math.min(1, spd / 5.6);
    var sprint = !!(e && e.sprint && spd > 3.2);
    /* 疾跑才是主要摇晃来源；普通走路只留三成，别把"丝滑"做成"晕船"（feel_probe 的
       零位移帧与单帧比会直接读到多余的相机运动）。 */
    var amp = this.bobGain * moveK * (sprint ? 1.45 : 0.35);
    this._bobPhase += dt * (4.8 + spd * 1.7);
    var bx = 0, by = 0, roll = 0;
    if (amp > 0.001 && e && e.onGround !== false) {
      bx = Math.sin(this._bobPhase) * 0.018 * amp;
      by = Math.abs(Math.cos(this._bobPhase)) * 0.027 * amp;
      roll = Math.sin(this._bobPhase) * 0.005 * amp;
    }
    /* 受击/施法 shake 仍在 _place 里；这里只叠走路。横滚只给一点点，多了会晕。 */
    if (bx || by) { this.cam.position.addScaledVector(this._right, bx); this.cam.position.y += by; }
    if (roll) this.cam.rotateZ(roll);
    if (bx || by || roll) {
      this.cam.updateMatrixWorld();
      this.dir.set(0, 0, -1).applyQuaternion(this.cam.quaternion).normalize();
      this.aimOrigin.copy(this.cam.position);
    }
  };
  OTSCamera.prototype.nextMode = function () {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
    return this.mode;
  };

  /* ---------- 阶段 1：转向 ----------
     越肩有惯性（指数跟随，用 1-exp(-λ·dt) 而不是"每帧多少弧度"，后者在 60/160/240 下含义不同），
     第一人称必须与身体同步，否则转起来晕、瞄准滞后。_dYawSm 是本帧角位移，给前瞻与自检用。 */
  OTSCamera.prototype._stepYaw = function (e, dt, first) {
    if (first || this.yawSm === null || Math.abs(this.yawSm - e.yaw) > Math.PI) this.yawSm = e.yaw;
    var dyaw = ((e.yaw - this.yawSm + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    var prev = this.yawSm;
    this.yawSm += dyaw * (1 - Math.exp(-this.smoothYaw * dt));
    this._dYawSm = first ? 0 : (this.yawSm - prev);
    var yaw = first ? e.yaw : this.yawSm;
    this._pitch = clamp(e.pitch || 0, LIM.pitchDown, LIM.pitchUp);
    var cp = Math.cos(this._pitch);
    this._fwd.set(Math.sin(yaw) * cp, Math.sin(this._pitch), Math.cos(yaw) * cp).normalize();
    // 屏幕右方向（three.js 右手系）：面向 (sin,cos) 时右 = (-cos, sin)
    this._right.set(-Math.cos(yaw), 0, Math.sin(yaw));
    this._back.copy(this._fwd).negate();
    this._eyeBase.set(e.pos.x, e.pos.y + this.eyeH, e.pos.z);
    this._playerC.set(e.pos.x, e.pos.y, e.pos.z);
    this.eyePoint.copy(this._eyeBase);
  };

  /* 沿臂球扫（从肩点沿"相机方向"推进，精确到球-格相切） */
  OTSCamera.prototype._armFrom = function (world, lat, lift, maxD) {
    this._eyeOf(lat, this._eyeRay);
    this._eyeRay.y += lift || 0;
    return armClearDepth(world, this._eyeRay.x, this._eyeRay.y, this._eyeRay.z,
      this._back.x, this._back.y, this._back.z, maxD === undefined ? this.radius + LIM.armProbe : maxD, this.probeR);
  };
  /* 按"未来朝向"扫臂：机位绕肩点在半径 ≈√(lat²+r²) 的圆弧上走，240°/s 转身即约 13 格/s 的横扫，
     等埋进固体再救只能瞬移。预看 180ms，够伺服按 accel 建立起速度让开。 */
  OTSCamera.prototype._leadDepth = function (world, dt) {
    var omega = dt > 0 ? (this._dYawSm || 0) / dt : 0;
    if (Math.abs(omega) < LEAD.minOmega) return this.radius + LIM.armProbe;
    var d = this.radius + LIM.armProbe, cp = Math.cos(this._pitch), sp = Math.sin(this._pitch), y0 = this.yawSm || 0;
    for (var k = 1; k <= LEAD.steps; k++) {
      var yL = y0 + clamp(omega * LEAD.time * k / LEAD.steps, -1.2, 1.2);
      this._eyeOf(this.lCh.x, this._eyeRay);
      this._eyeRay.y += this.fCh.x;
      var tt = armClearDepth(world, this._eyeRay.x, this._eyeRay.y, this._eyeRay.z,
        -Math.sin(yL) * cp, -sp, -Math.cos(yL) * cp, this.rCh.x, this.probeR);
      if (tt < d) d = tt;
    }
    return d;
  };
  /* 换肩：只翻**意图**（sideSign），位移交给 lCh 扫过去。判据比较两侧沿臂可待深度，带滞后与冷却；
     旧版直接每帧翻符号，实测单帧把机位搬 1~2 格。 */
  OTSCamera.prototype._sideIntent = function (world, wantR, dt) {
    this.sideCool = Math.max(0, this.sideCool - dt);
    if (wantR < this.radius - HOLD.sideMargin) {
      this.sideBlockedT += dt;
      if (this.sideBlockedT > HOLD.sideBlock && this.sideCool <= 0 && this.rCh.x >= FLIP_MIN_ARM) {
        var alt = this._armFrom(world, -this.latOf(this.radius), 0);
        if (alt > wantR + HOLD.sideGain) { this.sideSign = -this.sideSign; this.sideCool = HOLD.sideCool; }
        this.sideBlockedT = 0;
      }
    } else if (this.sideBlockedT > 0) this.sideBlockedT = Math.max(0, this.sideBlockedT - dt * 2);
  };
  /* 地面托举：按相机所在列的 camGroundY（跳过 LEAF——树叶在方块表里 solid=true，拿 surfaceY 判
     会被树冠把相机甩上天，实测 y 15.9 → 25.6）。抬多少由二分给，且"抬完仍然自由才抬"：
     无条件抬会把相机从墙后顶进墙里，与避墙逻辑打架（实测来回拽，单帧垂直跳 1.48 格）。 */
  OTSCamera.prototype._liftTarget = function (world, r, lat) {
    this._poseOf(r, lat, 0, this._pose);
    var g = world.camGroundY(Math.floor(this._pose.x), Math.floor(this._pose.z));
    if (g < 0) return 0;
    var top = Math.min(g + 1 + LIM.groundClear, this._eyeBase.y + LIM.maxLift);
    if (this._pose.y >= top) return 0;
    var lo = 0, hi = top - this._pose.y, mid;
    for (var i = 0; i < 5; i++) {
      mid = (lo + hi) * 0.5;
      if (world.cameraSphereFree(this._pose.x, this._pose.y + mid, this._pose.z, this.ballR)) lo = mid; else hi = mid;
    }
    return Math.max(0, lo - LIM.sweepEps);
  };

  /* pos = eyeBase + right·lat − fwd·r + up·lift：机位是状态量的纯函数，别的代码不许越过它写 cam.pos。
     判定与落位都走这两支笔（同一公式），避免"检查的是一套、摆的是另一套"。 */
  OTSCamera.prototype._poseOf = function (r, lat, lift, out) {
    return out.copy(this._eyeBase).addScaledVector(this._right, lat)
      .addScaledVector(this._fwd, -r).addScaledVector(this._up, lift);
  };
  /* 当前跟随中的机位（通道值），验收与硬钳都以它为准 */
  OTSCamera.prototype._poseChannels = function (out) {
    return this._poseOf(this.rCh.x, this.lCh.x, this.fCh.x, out);
  };
  /* 沿臂往回找最近一个"点级可站"的距离（与 cam_audit 判埋墙同一口径），下限 dFloor */
  OTSCamera.prototype._nearestFreeAlongArm = function (world, dFloor) {
    this._eyeOf(this.lCh.x, this._eyeFollow);
    this._eyeFollow.y += this.fCh.x;
    var d = this.rCh.x, stepD = 0.1;
    while (d > dFloor) {
      d = Math.max(dFloor, d - stepD);
      this._poseOf(d, this.lCh.x, this.fCh.x, this._tmp);
      if (world.cameraFree(this._tmp.x, this._tmp.y, this._tmp.z)) return d;
    }
    return dFloor;
  };

  /* ---------- 阶段 2：几何求解（只写目标，绝不写状态）----------
     两层求解，全部按"目标构型"判，不看跟随中的通道值——一看就要看下一帧，就成了反馈环：
       ① 名义解：沿臂精确球扫（目标肩点、跟随肩点、转身前瞻三条臂）取 min
       ② 落地修正：名义解卡在固体里，先按穿透深度顶出，再不行绕侧 / 收臂 / 换肩
     修正结论存成"持久姿态"(_held) 并粘住 HOLD.defl 秒——这一条是"把开关变成状态"的执行者。
     名义解必须**连续自由满窗口**且代价确实更低才收回机位；否则擦边一帧的自由/阻挡会让目标每帧
     翻转，伺服追着它顶格爬（vSide=20 → 160FPS 下每帧 0.125 格，静立项必炸，实测踩过）。 */
  OTSCamera.prototype._solve = function (world, dt) {
    /* 跟随构型那条臂也要按**全臂长**探测：上一版这里传 maxD = 当前臂长，于是"这条臂最多能走这么远"
       的答案永远 ≤ 当前值，臂长收下去就再也放不回来（自锁：空地样本里相机钉死在 0.55）。
       真正该按当前臂长封顶的只有 _integrate 里的点级安全闸。 */
    var rNom = this._armFrom(world, this.latOf(this.radius), 0);                 // 收敛后那条臂
    /* 距离保持（Cinemachine distance-hold 思路）：塌臂之前先试"从遮挡物上方越过"。
       仰头（pitch +0.42）时背向斜向下，腰前 1.35 格的草皮就把臂截断；同一方向抬高
       0.9~1.35 就能走满（88092 审计样点实测：r 卡 0.55，而 (lift=1.35, r≈2.9) 明明自由）。
       _liftTarget 只管"相机所在列的地面"，管不了臂中段的遮挡，所以这里用固定托举档
       逐档探臂，代价=(欠的臂长×wR + 抬升×wLift)最优者胜，且必须明显优于塌臂才改用。
       选中后**连同 lift 一起记进 _holdLift**：nom.lift 后面还会被 _liftTarget 重算，
       不记的话下一帧托举清零、臂又被中段挡住，永远回到塌腰姿态。 */
    this._holdLift = 0; this._ladderR = 0;
    if (rNom < this.radius - 0.05) {
      var bestLift = 0, bestR = rNom, bestCost = (this.radius - rNom) * SEARCH.wR, lifts = SEARCH.lifts;
      for (var li = 0; li < lifts.length; li++) {
        var lTry = Math.min(lifts[li], LIM.maxLift);
        if (lTry <= 0.2) continue;
        var rTry = this._armFrom(world, this.latOf(this.radius), lTry);
        if (rTry <= rNom + 0.5) continue;                       // 抬了没多走半格以上不算出路
        var cTry = (this.radius - rTry) * SEARCH.wR + lTry * SEARCH.wLift;
        if (cTry < bestCost) { bestCost = cTry; bestLift = lTry; bestR = rTry; }
      }
      if (bestLift > 0) { rNom = bestR; this._holdLift = bestLift; this._ladderR = Math.min(this.radius, bestR); }
    }
    /* 传送帧（复活/审计摆点，jump>2，update 里会 snap 通道）不加"当前通道臂"与前瞻钳制：
       那两条防的是"从当前姿态硬推向目标"的推土效应，而 snap 是整体落位、不存在推土路径。
       不跳过的话 snap 只能落到被旧姿态钳住的 0.55，之后按 vRelease=4 爬回，0.43s 的审计
       沉降窗口等不到构图恢复（C2 卡 7/12 的直接原因）。 */
    var rWant = this._teleJump ? rNom
      : Math.min(rNom, this._armFrom(world, this.lCh.x, this.fCh.x), this._leadDepth(world, dt));
    rWant = clamp(rWant, LIM.minArm, this.radius);
    /* 越顶出路（托举梯）找到后必须直接压过目标臂长。"当前通道臂"这一 min 项按当前侧移评估，
       而侧移目标=latOf(rWant)：rWant 越塌、侧移越贴 1.95 的全边值、通道臂绕远更被草截 →
       循环钳制永远解不开（实测 wantR 恒 0.55、tgtLift 1.35 有效但臂不动）。
       防推土由 _integrate 的点级安全闸继续负责。 */
    if (this._holdLift > 0) rWant = Math.max(rWant, this._ladderR);
    this._sideIntent(world, rNom, dt);                                          // 换肩只看名义深度，不被过渡值牵动
    var latWant = this.latOf(rWant);
    /* 让路保持时间：让开路后立刻放回会让机位贴着墙抖。窗口内把目标臂长按"窗口里最紧的一档"钳住
       （Cinemachine Deoccluder 的 distance hold 思路，这里自己实现），窗口过了再按 vRelease 慢慢回弹。 */
    this._leadCap = rWant >= this.radius - 0.05 ? this.radius : Math.max(rWant, LIM.minArm);
    if (rWant < this.radius - 0.05) {
      /* rFloor 是"窗口内最紧一档"的保持量；续期只在**变得更紧**时发生。
         上一版每帧无条件续期，而 rWant=min(名义臂, 当前通道臂) 里的通道臂在机位
         追赶目标期间天然偏小 → 窗口永不过期 → rFloor 被最紧瞬间锁死，姿态明明能
         放开也回不去（88092 三个样点卡 r=0.55、C2 掉到 6/12 的完整链条：lift 只按
         相机所在列地面算、中段草皮截臂 → rNom 塌 → 通道臂续期 → 死锁）。
         0.01 死区防微抖反复续期；真正的新遮挡仍会立刻续期。 */
      if (this.rFloor === undefined || rWant < this.rFloor - 0.01) {
        this.occT = HOLD.occlude; this.rFloor = rWant;
      }
      rWant = clamp(this.rFloor, LIM.minArm, this.radius);
    } else if (this.occT > 0) {
      this.occT -= dt;
      rWant = clamp(Math.min(rWant, this.rFloor === undefined ? rWant : this.rFloor), LIM.minArm, this.radius);
    } else this.rFloor = undefined;
    /* 大俯仰收臂：放在让路保持窗口**之后**，这样它是最后一道钳——rFloor 是"窗口里最紧一档"，
       只可能因为遮挡变紧，不该把垂直看地时的臂长又放回 2.95。
       下限取 LIM.minArm 之上一点，保证身体不会糊进准星中心（C 项口径）。 */
    var pk = Math.abs(this._pitch || 0);
    if (pk > PITCH_ARM.flatK) {
      var kBlend = Math.min(1, (pk - PITCH_ARM.flatK) / Math.max(0.001, PITCH_ARM.steepK - PITCH_ARM.flatK));
      rWant = Math.min(rWant, Math.max(LIM.minArm, this.radius * (1 - kBlend * (1 - PITCH_ARM.minK))));
    }

    /* 越过中段遮挡的托举直接进 lift 通道，不随臂长缩：塌臂恰恰是"还没抬起来"造成的，
       按臂长缩放会形成死锁（臂短→lift 缩→通道臂更短→臂更短，实测卡死 r=0.55）。
       抬升速率交给 vLift 伺服，视觉上就是 0.07s 的缓慢起重机，不会瞬移。 */
    var nom = { r: rWant, lat: latWant, lift: Math.max(this._liftTarget(world, rWant, latWant), this._holdLift) };
    this.freeT = this._poseFree(world, nom) ? this.freeT + dt : 0;
    var t = this._stickPose(world, nom);
    this.tgt = t;
    this.tooClose = (this.radius - t.r) > (this.radius - this.tightRadius + 0.15);
    this.blockedFace = t.r < 1.2;
    this.dbg.wantR = +rWant.toFixed(3); this.dbg.tgtR = +t.r.toFixed(3);
    this.dbg.tgtLat = +t.lat.toFixed(3); this.dbg.tgtLift = +t.lift.toFixed(3);
  };

  /* 姿态是否落在净空球里：判定与落位共用同一支笔 _poseOf，杜绝"检查一套、摆另一套" */
  /* 只判净空球。**不要**把"必须在身后"塞进这里：紧臂构图 (r=0.55) 的名义侧移就是 1.95，
     那是故意把人挤到画面边上的设计，套上背向锥会把主路径的每一档紧臂都判死，
     目标来回翻转 → 转视角 jerk 从 2200 顶到 2900（实测）。这条约束只用于偏转候选。 */
  OTSCamera.prototype._poseFree = function (world, p) {
    this._poseOf(p.r, p.lat, p.lift, this._tmp);
    return world.cameraSphereFree(this._tmp.x, this._tmp.y, this._tmp.z, this.ballR);
  };
  /* 偏转候选的准入：净空球 + 仍在玩家身后 */
  OTSCamera.prototype._candOk = function (world, r, lat, lift, out) {
    this._poseOf(r, lat, lift, out);
    return world.cameraSphereFree(out.x, out.y, out.z, this.ballR) && this._staysBehind(out);
  };
  /* 候选是否钻进角色自己的体积（按到实体中心的距离判） */
  OTSCamera.prototype._inBody = function (pose) {
    return Math.hypot(pose.x - this._playerC.x, pose.y - this._playerC.y, pose.z - this._playerC.z) < BODY_R;
  };
  /* 机位必须仍在玩家**身后**：绕侧避墙不能把相机甩到人身侧，否则四肢从画面两侧张开、
     整具身体罩住准星（seed 88092 / 31337 的 C 项就是这么红的）。 */
  OTSCamera.prototype._staysBehind = function (pose) {
    var dx = pose.x - this._playerC.x, dy = pose.y - this._playerC.y, dz = pose.z - this._playerC.z;
    var len = Math.hypot(dx, dy, dz) || 1e-6;
    return (dx * this._back.x + dy * this._back.y + dz * this._back.z) / len >= SEARCH.behindDot;
  };
  /* 偏离"理想越肩构图"的代价（单位：格）：臂收多短、侧移绕多少、抬多高；换肩最贵 */
  OTSCamera.prototype._cost = function (p) {
    return (this.radius - p.r) * SEARCH.wR +
      Math.abs(p.lat - this.latOf(p.r, p.lat >= 0 ? 1 : -1)) * SEARCH.wLat +
      p.lift * SEARCH.wLift;
  };
  /* 持久姿态仲裁：有 _held 就沿用（它自己失效才立刻重选），收回名义解要"连续自由满窗口 + 代价更低"。
     没有 _held 且名义解不干净 → 顶出 → 还脏就候选搜索，结果存成 _held。 */
  OTSCamera.prototype._stickPose = function (world, nom) {
    if (this._held && this._heldT > 0) {
      this._heldT -= this._frameDt;
      if (!this._poseFree(world, this._held)) { this._held = null; this.dbg.held = 'reselect'; }
      else if (this._poseFree(world, nom) && this.freeT >= HOLD.defl && this._cost(nom) < this._cost(this._held)) {
        this._held = null; this._heldT = 0; this.dbg.held = 'back'; return nom;
      } else { this.dbg.held = 'hold'; return this._held; }
    }
    if (this._poseFree(world, nom)) { this.dbg.held = 'nominal'; return nom; }
    this._depenetrate(world, nom);
    if (!this._poseFree(world, nom)) this._searchPose(world, nom);
    this._held = { r: nom.r, lat: nom.lat, lift: nom.lift };
    this._heldT = HOLD.defl;
    return nom;
  };
  /* 顶出：目标构型卡在固体里时，把需要的位移沿"球心←最近点"累加，再投影回臂坐标系
     （∂pos/∂r = back、∂pos/∂lat = right、∂pos/∂lift = up）。跑两遍补偿俯仰造成的 back/up 不正交。
     这条取代旧版"沿臂压到下限然后整个人埋进原木"的走投无路分支。 */
  OTSCamera.prototype._depenetrate = function (world, t) {
    var pushed = 0, it, p = this._tmp;
    for (it = 0; it < 2; it++) {
      this._poseOf(t.r, t.lat, t.lift, p);
      if (!pushOut(world, p.x, p.y, p.z, this.ballR, this._push)) break;
      var dr = this._push.dot(this._back), dlat = this._push.dot(this._right), dlift = this._push.dot(this._up);
      t.r = clamp(t.r + dr, LIM.minArm, this.radius);
      t.lat += dlat;
      t.lift = clamp(t.lift + Math.max(0, dlift), 0, LIM.maxLift);
      pushed += Math.abs(dr) + Math.abs(dlat) + Math.abs(dlift);
    }
    this.dbg.push = +pushed.toFixed(3);
    return pushed;
  };

  /* 候选搜索：同侧先绕侧、收臂，都不行才换到另一侧肩；全都不行则贴脸（由分级隐藏兜住画面）。
     结果粘住 HOLD.defl 秒，且必须明显更好才换——否则候选之间来回跳等于把机位做成永动机。 */
  OTSCamera.prototype._searchPose = function (world, t) {
    var best = null, bestCost = 1e9, i, j, k, lift, lat, r, cost;
    var farCap = Math.min(this.radius, this._leadCap === undefined ? this.radius : this._leadCap);
    for (var s = 0; s < 2; s++) {
      if (s === 1 && this.rCh.x < FLIP_MIN_ARM) break;   // 机位太短时不换边：lCh 横扫穿身（与 _sideIntent 同闸）
      var sign = s === 0 ? this.sideSign : -this.sideSign;
      for (i = 0; i < SEARCH.lifts.length; i++) {
        lift = Math.min(SEARCH.lifts[i], LIM.maxLift);
        for (j = 0; j < SEARCH.latModes.length; j++) {
          /* ① 顺这个姿态方向探"远臂"：沿臂球扫能走多远就用多长。上一版搜索只会收臂
             （rScales≤1），于是名义方向被 0.55 外的灌木挡住时，候选里没有出路，相机只能
             贴死身体（seed 88092 审计样点：审计只保证样点周围 2 格净空，树在 3 格处）。
             远臂受 _leadCap 封顶：快速转身时不许逆着前瞻把臂放长，避免与让路闸门打架。 */
          if (SEARCH.latModes[j] > 0) {
            lat = this.latOf(this.radius, sign) * SEARCH.latModes[j];
            r = clamp(this._armFrom(world, lat, lift, farCap), LIM.minArm, farCap);
            if (this._candOk(world, r, lat, lift, this._tmp)) {
              cost = (this.radius - r) * SEARCH.wR + Math.abs(lat) * SEARCH.wOff +
                lift * SEARCH.wLift + (s === 1 ? SEARCH.wSide : 0) +
                (this._inBody(this._tmp) ? W_INBODY : 0);
              if (cost < bestCost) { bestCost = cost; best = { r: r, lat: lat, lift: lift }; }
            }
          }
          /* ② 收臂候选（原路径）：远臂全堵时贴墙蜷缩仍然可用 */
          for (k = 0; k < SEARCH.rScales.length; k++) {
            r = clamp(t.r * SEARCH.rScales[k], LIM.minArm, this.radius);
            lat = this.latOf(r, sign) * SEARCH.latModes[j];
            if (!this._candOk(world, r, lat, lift, this._tmp)) continue;
            cost = (this.radius - r) * SEARCH.wR + Math.abs(lat) * SEARCH.wOff +
              lift * SEARCH.wLift + (s === 1 ? SEARCH.wSide : 0) +
              (this._inBody(this._tmp) ? W_INBODY : 0);      // 宁可绕侧/抬高，也不钻进自己身体
            if (cost < bestCost) { bestCost = cost; best = { r: r, lat: lat, lift: lift }; }
          }
        }
      }
      if (best && bestCost < SEARCH.wSide) break;           // 同侧已有够好的解，不换肩
    }
    if (!best) {                                  // 真的无处可去：退回"贴脸"=几乎第一人称
      /* 上一版这里只把臂长压到 0.55、侧移却留着紧臂名义值 1.95，等于把相机甩到人身侧 1.5 格外，
         四肢从画面两侧张开、整具身体罩住准星（seed 88092 / 31337 的 C 项）。贴脸姿态才是正确兜底：
         相机回到眼睛附近，身体由 _boxSpan 的"含相机盒"判据整体隐藏，画面等价于短暂第一人称。 */
      t.r = 0.2; t.lat = 0; t.lift = 0; this.embedFrames++; this.dbg.held = 'buried'; return; }
    t.r = best.r; t.lat = best.lat; t.lift = best.lift;
    this.dbg.held = 'search';
  };

  /* ---------- 阶段 3：伺服积分（整个 update 里唯一写机位状态的地方）---------- */
  OTSCamera.prototype._integrate = function (world, dt) {
    this.rCh.pursue(this.tgt.r, dt, this.vRelease, this.vYield, this.accelArm);
    this.lCh.pursue(this.tgt.lat, dt, this.vSide, this.vSide, this.accelSide);
    this.fCh.pursue(this.tgt.lift, dt, this.vLift, this.vDrop, this.accelLift);
    /* 安全闸：真实机位不得越过"跟随肩点沿臂的最远可站深度"。越过就是点级埋墙，宁可这一帧硬钳
       （穿墙比跳变更严重：近裁剪盖不住四周的固体，见构造函数注释）。正常应几乎不触发；
       频繁触发说明前面的求解太保守，该修判据而不是加重这条。计数由 J 项报出。 */
    /* 安全闸：真实机位真的落进固体（点级，与 cam_audit 判埋墙同一口径）才硬钳到最近的可站距离。
       上一版这里用球口径（半径 0.35）判点级埋墙，比验收保守一整颗球 → 每帧误触发、机位被反复硬钳，
       转视角 jerk 冲到 5500（预算 2880）。球口径留给"目标"求解做保守余量，硬钳必须按点口径。 */
    var q = this._poseChannels(this._eyeFollow);
    if (!world.cameraFree(q.x, q.y, q.z) && this.gateSteps > 0) {
      /* 让路：再跑一次**有界**伺服把臂长收向最近可站点（这就是验收预算里预留的第二次调用），
         而不是 snap 到目标——snap 就是瞬时位移，实测一帧抹掉 20+ 格/s，jerk 直接 5267（预算 2880）。
         只有收完仍然埋着（例如身后整块是实心、0.55 处仍在岩石里）才允许最后那一下瞬移。 */
      var dFloor = LIM.minArm, d = this._nearestFreeAlongArm(world, dFloor);
      this.rCh.pursue(Math.min(this.rCh.x, d), dt, this.vRelease, this.vYield, this.accelArm);
      this.hardUnstick++;
      var q2 = this._poseChannels(this._eyeFollow);
      if (this.gateSteps > 1 && !world.cameraFree(q2.x, q2.y, q2.z)) {
        /* 到这里说明"提前让路"没起作用：再收一次有界伺服，但**不做瞬时钳制**。
           240FPS 下 0.05 格以上的瞬时位移必然打爆 jerk 预算，而短暂重叠只是穿帮一帧，
           代价小得多（审计按 0.5% 帧数预算判穿透，不是判零）。这类帧单独计数，用来盯判据是否退化。 */
        this.rCh.pursue(Math.min(this.rCh.x, this._nearestFreeAlongArm(world, dFloor)), dt, this.vRelease, this.vYield, this.accelArm);
        this.emergencySnaps++;
      }
    }
    this.curRadius = this.rCh.x; this.curLat = this.lCh.x; this.floorSm = this.fCh.x;
  };

  /* 抖屏用连续相位（sin 波），不用每帧 Math.random：随机数就是每帧位移跳变，会被 J 项当抖动抓。 */
  OTSCamera.prototype._stepShake = function (dt) {
    this._shakeX = 0; this._shakeY = 0;
    if (this.shake <= 0) { this.shake = 0; return; }
    this.shakeT += dt;
    this.shake = Math.max(0, this.shake - dt);
    var a = this.shake * 0.25;
    this._shakeX = Math.sin(this.shakeT * 37) * a;
    this._shakeY = Math.sin(this.shakeT * 29 + 1.3) * a * 0.8;
  };

  /* ---------- 阶段 4/5：落位 + 从真实朝向反推瞄准 ---------- */
  OTSCamera.prototype._place = function (r, lat, lift) {
    var p = this._poseOf(r, lat, lift, this._placeV);
    p.x += this._shakeX; p.y += this._shakeY;
    this.pos.copy(p);
    this.cam.position.copy(p);
    this.cam.up.set(0, 1, 0);
    this._look.copy(p).add(this._fwd);
    this.cam.lookAt(this._look);
    this.cam.updateMatrixWorld();
    // 关键不变量：瞄准方向 = 相机渲染出来的真实朝向，不另算一份
    this.dir.set(0, 0, -1).applyQuaternion(this.cam.quaternion).normalize();
    this.aimOrigin.copy(this.cam.position);
    this._lever = Math.max(3.22, Math.hypot(lat, r, lift));
  };

  /* 自检断言（取代旧版的位置域限流）：机位本帧位移必须落在"构图弧扫 + 通道速率·dt"预算内。
     它只报警不粉饰，超预算由 J 项判失败；执行者是伺服，这里负责把违约暴露出来。 */
  OTSCamera.prototype._selfCheck = function (teleporting) {
    if (!this._lastPos || teleporting) this.dbg.moved = 0;
    else {
      var moved = Math.hypot(this.pos.x - this._lastPos.x, this.pos.y - this._lastPos.y, this.pos.z - this._lastPos.z);
      var budget = Math.abs(this._dYawSm || 0) * this._lever + (this.vYield + this.vSide + this.vLift) * this._frameDt + 0.02;
      if (moved > budget) { this.posViolations++; this.dbg.violMoved = +moved.toFixed(3); this.dbg.violBudget = +budget.toFixed(3); }
      this.dbg.moved = +moved.toFixed(4);
    }
    if (this._lastPos) this._lastPos.copy(this.pos); else this._lastPos = this.pos.clone();
    if (this._prevEye) this._prevEye.copy(this._eyeBase); else this._prevEye = this._eyeBase.clone();
  };

  /* 一个世界 AABB 的投影是否压住中央准星区；8 个角全在相机背后就算不挡。
     注意：Vector3.project() 自带 viewMatrix，要拿世界坐标去投影。为"在不在相机前方"另算相机空间
     坐标时不能把两次变换叠在一起（曾经叠了两遍视图矩阵，身体明明压住准星却报不挡）。 */
  OTSCamera.prototype._containsCam = function (min, max) {
    var c = this.cam.position, m = 0.06;               // 0.06 容差：部件边缘正好贴到相机也算埋入
    return c.x > min.x - m && c.x < max.x + m && c.y > min.y - m && c.y < max.y + m && c.z > min.z - m && c.z < max.z + m;
  };
  /* 谁压住准星就只藏谁：躯干/头挡 → 整具不画；只有腿挡 → 只藏腿；只有手臂或肩上那张牌挡 → 只画到肩。
     判据必须逐个部件投影：用一个"整具身体的包围盒"判，斜着站时盒宽被放大到 0.96 格、竖直从头拉到脚，
     镜头一压低就蹭到准星边界，把根本没挡视线的角色整个抹掉。 */
  /* 一个世界 AABB 在屏幕上的 x0,x1,y0,y1（只取相机前方的角）；全在背后返回 null */
  OTSCamera.prototype._boxSpan = function (min, max) {
    /* 盒子把相机自己包住 → 它必然糊满画面，直接判"覆盖全屏"。
       只看 8 个角会漏这一类：相机在盒内时多半数角落在近裁剪面之后被跳过，剩下的角可能全在画面一侧，
       于是"身体其实整个罩住准星"被判成没挡（审计脚本按顶点遍历就没这问题，两边就是这么对不上的）。 */
    if (this._containsCam(min, max)) return [0, 1, 0, 1, 8, 0];
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, front = 0, minDepth = 1e9;
    this._invQ.copy(this.cam.quaternion).invert();
    for (var i = 0; i < 8; i++) {
      this._tmp.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
      this._cs.copy(this._tmp).sub(this.cam.position).applyQuaternion(this._invQ);
      if (this._cs.z >= -this.cam.near) continue;
      front++;
      if (-this._cs.z < minDepth) minDepth = -this._cs.z;
      this._tmp.project(this.cam);
      var sx = this._tmp.x * 0.5 + 0.5, sy = 0.5 - this._tmp.y * 0.5;
      if (sx < minx) minx = sx; if (sx > maxx) maxx = sx;
      if (sy < miny) miny = sy; if (sy > maxy) maxy = sy;
    }
    return front ? [minx, maxx, miny, maxy, front, minDepth] : null;
  };
  /* 每帧只遍历部件一次：逐组算投影跨度，同一批跨度既供"这组压住准星"也供合并包围盒判据
     （分两趟各算一遍时，越肩每帧要把 14 个盒 × 8 角投影两次，是渲染循环里最贵的一段）。 */
  OTSCamera.prototype._classifySelf2 = function (groups, dt, forceHidden) {
    if (forceHidden) { this.selfHidden = this.propsHidden = this.legsHidden = true; return; }
    var names = ['core', 'legs', 'props'], hit = [false, false, false];
    var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, any = false, gi, j, nearStraddle = false;
    for (gi = 0; gi < 3; gi++) {
      var list = groups && groups[names[gi]]; if (!list) continue;
      for (j = 0; j < list.length; j++) {
        var b = list[j]; if (!b || !b.min || !b.max) continue;
        var s = this._boxSpan(b.min, b.max); if (!s) continue;
        /* 邻近判据与审计的 bb.near 同口径：任一前方角点在**相机空间深度**上小于 NEAR_BODY 即隐藏。
           seed 88092 yaw=3.34 就是这么漏的：侧向很偏的部件（屏幕盒 −2541%~445%）最深顶点只在前方
           1.31，审计按顶点投影把覆盖算进去了；我先按"相机→盒面欧氏距离"判邻近，口径不同漏掉了它。
           跨度判据在这里救不了场：盒跨近裁剪面时，剩下角点的投影范围小于顶点真实投影范围。 */
        if (s[5] < NEAR_BODY) nearStraddle = true;               // 换边过渡/贴身时机位会穿过身体，靠深度兜住
        any = true;
        if (s[0] < mnx) mnx = s[0]; if (s[1] > mxx) mxx = s[1];
        if (s[2] < mny) mny = s[2]; if (s[3] > mxy) mxy = s[3];
        if (!hit[gi] && s[1] > CROSS.x0 && s[0] < CROSS.x1 && s[3] > CROSS.y0 && s[2] < CROSS.y1) hit[gi] = true;
      }
    }
    this.dbg.mergedBox = any ? [+mnx.toFixed(2), +mxx.toFixed(2), +mny.toFixed(2), +mxy.toFixed(2)] : null;
    var bodyIn = nearStraddle ||
      (any && (hit[0] || (mxx > CROSS_MERGED.x0 && mnx < CROSS_MERGED.x1 && mxy > CROSS_MERGED.y0 && mny < CROSS_MERGED.y1)));
    if (bodyIn) { this.selfHidden = true; this.selfClearT = 0; }
    else {
      this.selfClearT += dt;
      if (this.selfClearT > 0.3) this.selfHidden = false;
    }
    this.legsHidden = hit[1] && !this.selfHidden;
    this.propsHidden = hit[2] && !this.selfHidden;
  };

  /* ---------- 每帧入口 ---------- */
  OTSCamera.prototype.update = function (e, world, dt, groups) {
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > LIM.maxDt) dt = LIM.maxDt;
    this._frameDt = dt;
    var first = this.isFirst();
    this._stepYaw(e, dt, first);
    this._stepShake(dt);
    this._updateFov(dt, e);

    if (first) {                       // 第一人称：相机就是眼睛，没有遮挡收缩，也不画身体
      this.curRadius = 0; this.curLat = 0; this.floorSm = 0;
      this.sideBlockedT = 0; this.tooClose = false; this.blockedFace = false;
      this._place(0, 0, 0);                       // 第一人称：相机就是眼睛，通道不参与
      this._applySway(dt, e);
      this._classifySelf2(groups, dt, true);
      return;
    }

    var jump = this._prevEye ? Math.hypot(this._eyeBase.x - this._prevEye.x, this._eyeBase.y - this._prevEye.y, this._eyeBase.z - this._prevEye.z) : 99;
    var teleporting = jump > 2;        // 传送/复活/被顶出：直接落位并清速度，不排队滑行
    this._teleJump = teleporting;
    this._solve(world, dt);
    if (teleporting) {
      this.rCh.snap(this.tgt.r); this.lCh.snap(this.tgt.lat); this.fCh.snap(this.tgt.lift);
      this._held = null; this._heldT = 0;
      this.rFloor = undefined; this.occT = 0;    // 旧位置的让路保持量对新位置无意义
    }
    this._integrate(world, dt);
    this._place(this.curRadius, this.curLat, this.floorSm);
    this._applySway(dt, e);
    this._selfCheck(teleporting);
    this._classifySelf2(groups, dt, this.mode === 'shoulderClean');
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
  Orbit.prototype.update = function () {
    this.cam.position.set(this.target.x + Math.cos(this.az) * this.dist * Math.cos(this.el),
      this.target.y + this.dist * Math.sin(this.el),
      this.target.z + Math.sin(this.az) * this.dist * Math.cos(this.el));
    this.cam.lookAt(this.target);
  };
  G.OrbitCamera = Orbit;
})(window.GW);
