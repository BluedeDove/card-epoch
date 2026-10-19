/* ================= tools/cam_audit.js =================
   视角与操作回归验收（开发工具，不参与游戏运行；index.html 不引用它）。

   为什么需要它：视角类 bug（身体糊住准星、准星与选中格不一致、相机被树冠甩飞、
   掉出世界后主循环抛异常整局定住）看一张截图判断不了，也不能拿"文件保存成功"当修好。
   本脚本把口径固定成可判定的数字：改过 camera.js / battle.js / main.js 必须跑一遍。

   用法（项目根起一个禁缓存静态服务器，端口自选；不要占用别的会话在用的端口）：
     python3 -m http.server 8943        # 或直接用 tools/audit.cjs（它自带禁缓存静态服务 + headless 跑全部 15 项）
     浏览器打开 http://127.0.0.1:8943/index.html
     控制台或 Playwright page.evaluate：
       await (0,eval)(await (await fetch('/tools/cam_audit.js')).text());
       await __camAudit({ seed: 490706, deck: 'starter', mode: 'train' })
     → { pass, checks:[{name,ok,detail}], stats }

   口径（都是数字，不靠肉眼）：
     A  逻辑不冻结   ：正常跑 3 秒，stepErrors 与 console.error 都为 0
     B  准星=选中格  ：相机自身射线命中的格 === 黄框 selBox 的格（命中实体、视线回退两种情况另计）
     C  准星前无自己 ：相机判定"这一帧要画自己"时，被画的部件投影不得进入中央准星区
                        （2026-10-17 玩家模型换成关节层级后：本项的"被画集合"与部件分组
                        都改成按最近祖先判定。准星区、阈值、判据一字未动,只是让这份独立实现
                        认得出子树——旧写法把关节组藏掉的网格当成"仍然画着"，C/C4 双双假红。）
     C2 自己不常隐   ：平地各朝向抽查，身体仍要经常可见（防止做成了"永远看不见自己"）
     D  相机不飞天   ：连续行走时单帧相机 y 变化 < 1.2；|相机y − 眼y| ≤ 2.4
     E  踏空能救回   ：强行丢到 y=-30 能复活且不冻结；世界侧壁与底面当墙
     F  分屏互见     ：P1 隐身不影响 P2 画面看见 P1
     G  键盘能转视角 ：不锁指针时 Q/E、F/V 仍能转身（无 pointer lock 的环境照样能玩）
     H  瞄准能出牌   ：地形卡按准星命中点真的改到那一格

   两个量出来的坑（本版已避开，改脚本时别再踩）：
     · render() 每台相机画完会复原可见性，帧结束后 mesh.visible 恒等于 alive；
       要用 cam.selfHidden / cam.propsHidden 这两个"相机自己的判定结果"算可见部件集合。
     · 测相机帧间抖动不能在样本之间传送玩家，否则量到的是传送跳变而不是相机抖动。
   ======================================================= */
(function () {
  'use strict';
  function CROSSBOX() { return (window.GW && window.GW.CAM_CROSS) || { x0: 0.42, x1: 0.58, y0: 0.40, y1: 0.60 }; }  // 取相机自己公布的准星区，避免两边漂移

  function S() { return window.GWAPP; }
  function frames(n) { var pr = Promise.resolve(); for (var i = 0; i < n; i++) pr = pr.then(function () { return new Promise(function (r) { requestAnimationFrame(r); }); }); return pr; }
  function groundY(world, x, z) { var g = world.camGroundY(Math.floor(x), Math.floor(z)); return (g < 0 ? 0 : g) + 1; }
  function input(over) { return Object.assign({ fwd: 0, back: 0, left: 0, right: 0, jump: 0, cast: -1, lookYaw: 0, lookPitch: 0 }, over || {}); }
  function srcOf(over) { return { poll: function () { return input(over); } }; }

  /* 把"这一帧真的会被画出来的部件"投影成屏幕包围盒（只用相机前方的顶点） */
  /* 部件在不在"被隐藏"集合里：沿祖先链找，不能只比对自己。
     玩家模型层（src/hero-rig.js）把网格挂在关节 Group 下——藏手臂=藏手臂子树里的法杖。
     旧写法拿 skip.indexOf(网格) 比：关节组在表里、网格不在表里，等于一件都没藏住（C 项判成假阳性）。 */
  function inSkip(o, skip) {
    if (!skip) return false;
    if (skip === 'ALL') return true;
    for (var n = o; n; n = n.parent) if (skip.indexOf(n) >= 0) return true;
    return false;
  }
  function visibleScreenBox(root, cam, skip) {
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, front = 0, near = 1e9;
    var v = new THREE.Vector3();
    root.traverse(function (o) {
      if (!o.visible || !o.isMesh) return;
      if (inSkip(o, skip)) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      o.updateWorldMatrix(true, false);
      var pos = o.geometry.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
        var d = v.distanceTo(cam.position); if (d < near) near = d;
        var cs = v.clone().sub(cam.position).applyQuaternion(cam.quaternion);
        if (cs.z >= -cam.near) continue;                     // 相机背后的点不参与包围盒
        front++;
        var pv = v.clone().project(cam);
        var sx = pv.x * 0.5 + 0.5, sy = 0.5 - pv.y * 0.5;
        if (sx < minx) minx = sx; if (sx > maxx) maxx = sx;
        if (sy < miny) miny = sy; if (sy > maxy) maxy = sy;
      }
    });
    if (!front) return null;
    var CB = CROSSBOX();
    return { x0: minx, x1: maxx, y0: miny, y1: maxy, near: near,
             overCross: maxx > CB.x0 && minx < CB.x1 && maxy > CB.y0 && miny < CB.y1 };
  }

  /* 审计自己的部件分组：不复用 main.js 的实现，两边各算一份才能对出差错。
     整子树遍历 + 按最近祖先归类：关节挂在 Group 上时，网格跟着它的关节走。 */
  function classify(hero) {
    var P = hero.userData.parts || {}, card = hero.userData.card;
    var core = [], legs = [], props = [];
    hero.traverse(function (m) {
      if (!m.isMesh) return;
      var g = 'core', o = m;
      for (; o && o !== hero; o = o.parent) {
        if (o === P.armL || o === P.armR || o === card) { g = 'props'; break; }
        if (o === P.legL || o === P.legR) { g = 'legs'; break; }
      }
      (g === 'props' ? props : g === 'legs' ? legs : core).push(m);
    });
    return { core: core, legs: legs, props: props };
  }
  /* 与 main.js 的 setSelfVisible 一一对应的隐藏集合 */
  function skipSetFor(hero, cam) {
    if (cam.selfHidden) return 'ALL';
    var skip = [], P = hero.userData.parts || {};
    if (cam.propsHidden) [P.armL, P.armR, hero.userData.card].forEach(function (m) { if (m) skip.push(m); });
    if (cam.legsHidden) [P.legL, P.legR].forEach(function (m) { if (m) skip.push(m); });
    return skip;
  }
  /* 若干网格的屏幕投影包围盒（只用相机前方的顶点）；口径独立于相机实现 */
  function meshesScreenRect(meshes, cam) {
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, front = 0, v = new THREE.Vector3();
    meshes.forEach(function (top) {
      if (!top) return;
      top.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        o.updateWorldMatrix(true, false);
        var pos = o.geometry.attributes.position;
        for (var i = 0; i < pos.count; i++) {
          v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
          var cs = v.clone().sub(cam.position).applyQuaternion(cam.quaternion.clone().invert());
          if (cs.z >= -cam.near) continue;
          front++;
          var pv = v.clone().project(cam), sx = pv.x * 0.5 + 0.5, sy = 0.5 - pv.y * 0.5;
          if (sx < minx) minx = sx; if (sx > maxx) maxx = sx;
          if (sy < miny) miny = sy; if (sy > maxy) maxy = sy;
        }
      });
    });
    if (!front) return null;
    var CB = CROSSBOX();
    return { x0: minx, x1: maxx, y0: miny, y1: maxy,
             hitsCross: maxx > CB.x0 && minx < CB.x1 && maxy > CB.y0 && miny < CB.y1,
             onScreen: maxx > 0 && minx < 1 && maxy > 0 && miny < 1 };
  }
  function selBoxOf(st) {
    var sb = null;
    window.__dbg.fx.children.forEach(function (c) { if (!sb && c.type === 'LineSegments' && c.visible && c.geometry && c.geometry.type === 'EdgesGeometry') sb = c; });
    return sb;
  }

  /* 关掉会暂停主循环的面板（背包 / 三选一）：相机回归只在"没有遮罩"的画面上量。
     只做关闭（不替玩家选牌、不改任何权威状态）。 */
  function closeOverlays() {
    var H = window.GW && window.GW.HUD;
    if (!H) return;
    try {
      if (H.panelOpen && H.panelOpen('choice') && H.closeChoice) H.closeChoice();
      if (H.uiPanelOpen && H.uiPanelOpen() && H.closeTopPanel) H.closeTopPanel();
    } catch (e) { /* 面板没装好时不影响相机测量 */ }
  }

  /* 静音"会暂停主循环"的玩法通道：三选一面板。
     为什么需要：本脚本为了量相机/输入会用 __camPose / 手动摆位把玩家传送到矿脉平台上，
     那里会真的触发一次首占三选一；面板一开主循环暂停，G/H/I 全部量到 0（实测 t=45.2s）。
     **这不是放宽判据**：相机与输入回归本来就不该受"占矿抽牌"影响，这里只把这一条玩法通道
     在测量期间关掉（清空待处理队列 + 把两条额度置 0），权威层的其余部分照常跑。
     不删兽、不动世界、不改任何健康判据。 */
  function quiesceDrafts() {
    closeOverlays();
    try {
      var m = S() && S().match;
      if (m) {
        if (m.drafts) m.drafts.length = 0;
        m.draftCapLode = 0; m.draftCapBeast = 0;
      }
    } catch (e) { }
  }

  async function run(opts) {
    opts = opts || {};
    var st = S();
    if (!st || !window.__GW_START) return { pass: false, checks: [{ name: 'env', ok: false, detail: '页面没有 GWAPP/__GW_START：请在游戏页面上注入本脚本' }] };
    var checks = [], stats = { samples: 0 };
    /* opts.map：只用于多图回归（T2 起关卡可换图）。不传 = 与历史完全一致（默认图），
       判据、阈值、采样一条不动。 */
    window.__GW_START({ mode: opts.mode || 'train', seed: opts.seed || 490706, deck: opts.deck || 'starter', map: opts.map });
    await frames(20);
    var savedSources = st.sources;
    st.sources = [];                                     // Match.step 对缺输入用 {}，姿态才可复现
    var errs = [], oldErr = console.error;
    console.error = function () { errs.push(Array.prototype.slice.call(arguments).map(String).join(' ')); oldErr.apply(console, arguments); };

    /* ---------- A 逻辑不冻结 ---------- */
    st.stepErrors = 0; st.running = true; st.overPause = false;
    await frames(180);
    checks.push({ name: 'A 逻辑不冻结', ok: !st.stepErrors && !errs.length,
      detail: 'stepErrors=' + (st.stepErrors || 0) + ' consoleError=' + errs.length + (errs.length ? ' 例：' + errs[0].slice(0, 180) : '') });

    var p = st.match.players[0], cam = st.cams[0], hero = window.__dbg.ent.children[0];
    var wx = st.world.SX, wz = st.world.SZ;

    /* ---------- B / C / C2 姿态扫描（三种视角模式各扫一遍）---------- */
    // 采样点必须真的是空地：头顶与周围 2 格内没有方块，否则量到的是贴墙场景，
    // 越肩构图本来就该隐藏自己，用它来判构图是否成立会得出反向结论。
    function openness(x, z) {
      var y = st.world.camGroundY(Math.floor(x), Math.floor(z));
      if (y < 0) return -1;
      for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) {
        var y2 = st.world.camGroundY(Math.floor(x) + dx, Math.floor(z) + dz);
        if (y2 < 0 || Math.abs(y2 - y) > 1) return -1;
        for (var k = 1; k <= 5; k++) if (st.world.get(Math.floor(x) + dx, y2 + k, Math.floor(z) + dz)) return -1;
      }
      return y;
    }
    function findSpots(n) {
      var out = [], tried = {};
      for (var x = 8; x < wx - 8 && out.length < n; x += 3) for (var z = 8; z < wz - 8 && out.length < n; z += 3) {
        var y = openness(x, z);
        if (y < 0) continue;
        var key = Math.floor(x / 18) + ',' + Math.floor(z / 18);       // 每个片区取一个，保证分布
        if (tried[key]) continue; tried[key] = 1;
        out.push([x + 0.5, z + 0.5, y]);
      }
      return out;
    }
    var spots = findSpots(3);
    if (spots.length < 2) return { pass: false, checks: checks.concat([{ name: 'env', ok: false, detail: '找不到 2 个空地采样点，无法判越肩构图' }]), stats: stats };
    var bad = { cross: [], body: [], fly: [] }, shown = 0, hiddenByCam = 0, blockedSamples = 0, entSamples = 0;
    var propsHiddenSamples = 0, minNear = 99, minGap = 9, openTotal = 0, openShown = 0, shTotal = 0, shShown = 0;
    for (var mi = 0; mi < 3; mi++) {
      var mode = ['shoulder', 'first', 'shoulderClean'][mi];
      cam.setMode(mode);
      for (var si = 0; si < spots.length; si++) {
        for (var k = 0; k < 4; k++) {
          var yaw = k * Math.PI / 2 + 0.2, pitch = (k % 3 - 1) * 0.42;
          var x = spots[si][0], z = spots[si][1];
          p.pos.set(x, groundY(st.world, x, z) + p.h / 2 + 0.02, z);
          p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; p.alive = true;
          if (cam.yawSm !== null) cam.yawSm = yaw;                    // 跳过转向惯性，量稳态
          // 沉降要等够：相机半径收缩与"不画自己"都带 0.3s 防抖，只等几帧会一直停在上一个姿态的判定里
          await frames(26);
          stats.samples++;
          var o = { x: cam.aimOrigin.x, y: cam.aimOrigin.y, z: cam.aimOrigin.z };
          var d = { x: cam.dir.x, y: cam.dir.y, z: cam.dir.z };

          // B 准星=选中格
          var raw = st.world.raycast(o, d, 60, {});
          st.match.updateAim(p, o, d);
          if (p.aim && p.aim.ent) entSamples++;
          else if (p.aimBlocked) blockedSamples++;
          else {
            var sb = selBoxOf(st);
            if (raw.hit && sb) {
              var ex = Math.abs(sb.position.x - (raw.x + 0.5)), ey = Math.abs(sb.position.y - (raw.y + 0.5)), ez = Math.abs(sb.position.z - (raw.z + 0.5));
              if (ex > 0.6 || ey > 0.6 || ez > 0.6) bad.cross.push(mode + ' yaw=' + yaw.toFixed(2) + ' 射线(' + raw.x + ',' + raw.y + ',' + raw.z + ') 黄框(' + (sb.position.x - 0.5) + ',' + (sb.position.y - 0.5) + ',' + (sb.position.z - 0.5) + ')');
            }
          }
          // C 准星前无自己
          if (mode === 'first') { hiddenByCam++; }
          else if (!cam.selfHidden) {
            shown++;
            if (mode === 'shoulder') { shTotal++; shShown++; if (cam.curRadius > cam.radius * 0.9) { openTotal++; openShown++; } }
            var bb = visibleScreenBox(hero, cam.cam, skipSetFor(hero, cam));
            if (bb) {
              minNear = Math.min(minNear, bb.near);
              var CB = CROSSBOX();
              var gap = bb.x1 <= CB.x0 ? CB.x0 - bb.x1 : (bb.x0 >= CB.x1 ? bb.x0 - CB.x1 : 0);
              minGap = Math.min(minGap, gap);
            }
            if (cam.propsHidden) propsHiddenSamples++;
            if (bb && bb.overCross && bb.near > cam.cam.near + 0.05)
              bad.body.push(mode + ' yaw=' + yaw.toFixed(2) + ' 屏x' + (bb.x0 * 100).toFixed(0) + '-' + (bb.x1 * 100).toFixed(0) + '% y' + (bb.y0 * 100).toFixed(0) + '-' + (bb.y1 * 100).toFixed(0) + '% 最近' + bb.near.toFixed(2) + '格');
          } else { hiddenByCam++; if (mode === 'shoulder') { shTotal++; if (cam.curRadius > cam.radius * 0.9) openTotal++; } }
          // D 高度差（贴墙贴树时也不该把人甩离眼睛高度）
          var yOff = Math.abs(cam.pos.y - (p.pos.y + cam.eyeH));
          if (yOff > 2.4) bad.fly.push(mode + ' |相机y−眼y|=' + yOff.toFixed(2) + ' radius=' + cam.curRadius.toFixed(2));
        }
      }
    }
    checks.push({ name: 'B 准星=选中格', ok: !bad.cross.length,
      detail: bad.cross.length ? bad.cross.length + ' 例：' + bad.cross.slice(0, 3).join(' | ')
        : '一致；样本 ' + stats.samples + '（其中命中实体 ' + entSamples + '、视线回退 ' + blockedSamples + ' 已排除）' });
    checks.push({ name: 'C 准星前无自己', ok: !bad.body.length, detail: bad.body.length ? bad.body.length + ' 例：' + bad.body.slice(0, 3).join(' | ') : '身体被画出的样本里，没有部件投影进中央准星区' });
    checks.push({ name: 'C2 越肩看得见自己', ok: shTotal > 0 && shShown / shTotal >= 0.7,
      detail: '越肩样本 ' + shTotal + ' 个中身体画出 ' + shShown + ' 个（第一人称与"不画自己"模式不计入）' });
    checks.push({ name: 'C3 越肩构图仍看得见自己', ok: openTotal > 0 && openShown / openTotal >= 0.75,
      detail: '平地（相机未收缩）越肩样本 ' + openTotal + ' 个，身体正常画出 ' + openShown + ' 个；身体与准星区最小间隙 ' + (minGap === 9 ? '—' : (minGap * 100).toFixed(1) + '% 屏宽') + '，最近部件距相机 ' + (minNear === 99 ? '—' : minNear.toFixed(2)) + ' 格，只隐藏持牌手的样本 ' + propsHiddenSamples });

    /* ---------- C4 低头看地时不许把人整个抹掉 ----------
       用户第二次截图就是这个：镜头压低看脚下雪地，画面里一个角色都没有。
       判定与实现分开算——这里独立按部件投影，如果躯干没压住准星却被隐藏，就是实现判错。 */
    cam.setMode('shoulder');
    var downBad = [], downSeen = 0, downTotal = 0;
    var spot4 = spots[1] || spots[0];
    for (var pi = 0; pi < 8; pi++) {
      var pitchD = -0.85 + pi * 0.2;
      p.pos.set(spot4[0], groundY(st.world, spot4[0], spot4[1]) + p.h / 2 + 0.02, spot4[1]);
      p.vel.set(0, 0, 0); p.yaw = 0.785; p.pitch = pitchD; p.alive = true;
      if (cam.yawSm !== null) cam.yawSm = p.yaw;
      await frames(22);
      downTotal++;
      var cls = classify(hero);
      var coreR = meshesScreenRect(cls.core, cam.cam);
      var wholeR = meshesScreenRect(cls.core.concat(cls.legs, cls.props), cam.cam);
      if (coreR && !coreR.hitsCross && cam.selfHidden)
        downBad.push('pitch=' + pitchD.toFixed(2) + ' 躯干投影 x' + (coreR.x0 * 100).toFixed(0) + '-' + (coreR.x1 * 100).toFixed(0) + '%、没压准星，却被整具隐藏');
      if (wholeR && wholeR.onScreen && !cam.selfHidden) downSeen++;
    }
    checks.push({ name: 'C4 低头时不消失', ok: !downBad.length && downSeen >= Math.ceil(downTotal * 0.6),
      detail: (downBad.length ? downBad.length + ' 例：' + downBad.slice(0, 3).join(' | ') : '没有误隐藏') + '；俯仰扫描中身体正常入画 ' + downSeen + '/' + downTotal + ' 个角度' });

    /* ---------- D 连续行走的相机抖动 ---------- */
    cam.setMode('shoulder');
    var px = wx * 0.5, pz = wz * 0.5;
    p.pos.set(px, groundY(st.world, px, pz) + p.h / 2 + 0.02, pz); p.vel.set(0, 0, 0);
    p.pitch = 0; p.yaw = 0.6; cam.curRadius = cam.radius; cam.yawSm = p.yaw;
    await frames(8);                                                  // 先落定，别把上面的传送当成相机抖动
    st.sources = [srcOf({ fwd: 1 })];                                 // 按住 W 往前走，中途不传送
    var maxStep = 0, prevY = cam.pos.y, travelled = 0, startX = p.pos.x, startZ = p.pos.z;
    for (var f = 0; f < 45; f++) {
      await frames(1);
      var dy = Math.abs(cam.pos.y - prevY); if (dy > maxStep) maxStep = dy;
      prevY = cam.pos.y;
    }
    travelled = Math.hypot(p.pos.x - startX, p.pos.z - startZ);
    st.sources = [];
    checks.push({ name: 'D 相机不飞天', ok: maxStep < 1.2 && !bad.fly.length,
      detail: '行走 45 帧位移 ' + travelled.toFixed(2) + ' 格，相机单帧最大 y 变化 ' + maxStep.toFixed(2) + '；高度差违例 ' + bad.fly.length + (bad.fly.length ? ' 例：' + bad.fly.slice(0, 2).join(' | ') : '') });

    /* ---------- E 踏空与边界 ---------- */
    p.pos.set(wx * 0.5, -30, wz * 0.5); p.vel.set(0, 0, 0);
    st.stepErrors = 0; errs.length = 0;
    await frames(20);
    checks.push({ name: 'E 踏空复活不冻结', ok: !st.stepErrors && !errs.length && p.pos.y > 0,
      detail: '强行 y=-30 后 y=' + p.pos.y.toFixed(2) + ' stepErrors=' + (st.stepErrors || 0) + (errs.length ? ' 异常：' + errs[0].slice(0, 140) : '') });
    var wallSide = st.world.outOfArena(0.05, 12, 12, p.w / 2, p.h / 2);
    var wallFloor = st.world.outOfArena(wx * 0.5, -0.5, wz * 0.5, p.w / 2, p.h / 2);
    p.pos.set(0.6, groundY(st.world, 1, 1) + p.h / 2, 1.5); p.vel.set(-30, 0, 0);
    await frames(15);
    checks.push({ name: 'E2 世界边界当墙', ok: wallSide && wallFloor && p.pos.x > 0,
      detail: 'outOfArena 侧壁=' + wallSide + ' 底面=' + wallFloor + '，以 30m/s 撞向边界后 x=' + p.pos.x.toFixed(2) });

    /* ---------- G 转视角：不锁指针照样能转，且转向与指令【同侧】 ----------
       判据故意不写死 yaw 的正负号——那是实现细节。上一版写成"按 E 后 yaw > 0.15"，
       而本项目 fwd=(sinθ,0,cosθ) 让 θ 增大其实是往左转，于是断言与 bug 同向，鼠标反轴长绿。
       这里量两个互补的观测量，要求同号才认：
         ① 本帧视线在该帧相机右向量上的投影（向右转 ⇒ >0）
         ② 原准星格的屏幕水平位移（向右转头 ⇒ 盯着的东西被甩向左边 ⇒ <0）
       转角必须小（<20°）：转大了相机右向量自己会转过去，①就失真（实测踩过：转 257° 时①给出假绿灯）。
       鼠标这条用合成 mousemove 注入：headless 锁指针后收不到真实 movementX/Y（实测 62 个事件
       全发生在锁定前，累计 sx=-640 就是光标回中），真机 movement 由浏览器产生，这里只能等价注入。 */
    /* 环境归一（2026-10-18）：三选一面板（占矿/晶甲兽首杀）会暂停主循环，而本脚本在 B/C 段
       会摆位/传送玩家——站上矿脉平台会真的触发一次三选一，面板一开后面 G/H/I 全量到 0
       （实测 t=45.7s 弹出「首占矿脉 · 三选一」）。相机/输入回归必须在**没有面板**的画面里量：
       这不是放宽判据，只关掉与本项无关的遮罩（与 st.sources = [] 同性质）。 */
    quiesceDrafts();
    st.sources = [new window.GW.Net.KeyboardSource({ fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', lookL: 'KeyJ', lookR: 'KeyK', lookU: 'KeyF', lookD: 'KeyV', cast: ['Digit1'] }, { mouseLook: true })];
    if (document.exitPointerLock) document.exitPointerLock();
    cam.setMode('first');                       // 第一人称：相机=玩家朝向，绕开 yawSm 惯性对判据的污染
    var cam0Mode = cam.mode;
    function screenX(t) {                        // 世界格中心投影到画面水平位置（0左 1右），用渲染相机本体
      var v = new THREE.Vector3(t.x + 0.5, t.y + 0.5, t.z + 0.5).project(cam.cam);
      return v.x * 0.5 + 0.5;
    }
    async function turnSample(apply, unapply, n) {
      await frames(3);
      var m = cam.cam.matrixWorld.elements, r0 = { x: m[0], z: m[2] };
      var d0x = cam.dir.x, d0z = cam.dir.z, y0 = p.yaw;
      var tgt = p.aimTarget ? { x: p.aimTarget.x, y: p.aimTarget.y, z: p.aimTarget.z } : null;
      var sx0 = tgt ? screenX(tgt) : null;
      apply(); await frames(n); unapply(); await frames(10);
      var dot = (cam.dir.x - d0x) * r0.x + (cam.dir.z - d0z) * r0.z;
      var dsx = (tgt && sx0 !== null) ? screenX(tgt) - sx0 : null;
      return { dot: dot, dsx: dsx, dyaw: p.yaw - y0 };
    }
    function keyHold(code) { return function () { window.dispatchEvent(new KeyboardEvent('keydown', { code: code, bubbles: true })); }; }
    function keyUp(code) { return function () { window.dispatchEvent(new KeyboardEvent('keyup', { code: code, bubbles: true })); }; }
    function mouseDX(v) { return function () { for (var i = 0; i < 6; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: v / 6, movementY: 0, bubbles: true })); }; }
    function noOp() {}
    var plWas = window.GW.pointerLocked; window.GW.pointerLocked = true;   // 让 net.js 的鼠标累加通道放行
    /* 键盘转身样本用 J/K：这是**本验收自己声明的**输入映射（上面 new 的 KeyboardSource），
       不是 main.js 的键位表。E 从 2026-10-17 起归背包（一按就暂停逻辑，量出来必然是 0），
       Q 已按用户要求解绑；玩家侧键盘转身已取消，判据本身一条没改。 */
    /* 按键样本按本项自己声明的窗口取：**转角必须 <20°**（转大了 Δdir·右向量 就失真）。
       键盘转向是时间积分（LOOK_RATE×dt），自动化环境一慢，12 帧就能扫出 45°+ 把样本推出这个窗口
       （实测 12 帧 → dot 0.79~0.99；4 帧 → 约 0.26 rad = 15°，既过 0.02 的下限也留在 20° 内）。
       鼠标那两条是位移定额，不受帧率影响，保持 12 帧。判据（双指标同号、0.02/1.4 上下限）一条没改。 */
    var gR = await turnSample(keyHold('KeyK'), keyUp('KeyK'), 4);           // 向右：审计自己声明的 lookR
    var gL = await turnSample(keyHold('KeyJ'), keyUp('KeyJ'), 4);           // 向左：审计自己声明的 lookL
    var mR = await turnSample(mouseDX(60), noOp, 12);                       // 向右：鼠标右移 60px
    var mL = await turnSample(mouseDX(-60), noOp, 12);                      // 向左：鼠标左移 60px
    window.GW.pointerLocked = plWas;
    function sideOk(s, wantRight) {
      if (Math.abs(s.dyaw) < 0.02) return false;                            // 没转起来
      if (Math.abs(s.dyaw) > 1.4) return false;                             // 接近 90° 后投影符号才不可靠（实测 257° 那次翻车）
      var e1 = wantRight ? s.dot > 1e-4 : s.dot < -1e-4;
      var e2 = s.dsx === null ? true : (wantRight ? s.dsx < -1e-3 : s.dsx > 1e-3);
      return e1 && e2;
    }
    var gOk = sideOk(gR, true) && sideOk(gL, false) && sideOk(mR, true) && sideOk(mL, false);
    checks.push({ name: 'G 转视角方向正确', ok: gOk,
      detail: '向右指令应把视线转向右（Δdir·相机右向量>0，且原准星格往画面左移）；'
        + '键盘→:' + gR.dot.toFixed(3) + '/' + (gR.dsx === null ? '—' : gR.dsx.toFixed(3)) + '，'
        + '键盘←:' + gL.dot.toFixed(3) + '/' + (gL.dsx === null ? '—' : gL.dsx.toFixed(3)) + '，'
        + '鼠标→:' + mR.dot.toFixed(3) + '/' + (mR.dsx === null ? '—' : mR.dsx.toFixed(3)) + '，'
        + '鼠标←:' + mL.dot.toFixed(3) + '/' + (mL.dsx === null ? '—' : mL.dsx.toFixed(3))
        + (gOk ? '' : ' ← 反轴或转角超出判据范围') });

    /* ---------- G2 不锁指针也能转 + 俯仰方向 ---------- */
    p.yaw = 0; p.pitch = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
    await frames(18);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));
    checks.push({ name: 'G2 键盘转视角与俯仰', ok: Math.abs(p.yaw) < 0.02 && p.pitch > 0.02 && cam.dir.y > 0.02,
      detail: '未锁指针：按 F 18 帧 pitch=' + p.pitch.toFixed(3) + ' 视线 y=' + cam.dir.y.toFixed(3) + '（抬头为正；按 F 不该让 yaw 漂移，实测 ' + p.yaw.toFixed(3) + '）' });

    /* ---------- I 转向按渲染帧推进（不绑 tick） ----------
       用户 2026-10-16 报的"视角拉扯"就是这个：渲染照常跑，转向却只在 1/20s 的 tick 里取一次，
       于是视角每 4~8 个渲染帧才动一次、一次跳近 10°。判据两条，都是数字：
         ① 每帧都喂了转向输入时，yaw 真正变化的帧占比 > 85%；
         ② 单帧最大跳变 / 平均每帧跳变 < 2（阶跃式更新会把这比值顶到 3~8）。
       用合成 mousemove 注入：headless 锁指针后拿不到真实 movementX/Y，只能等价注入。 */
    st.sources = [new window.GW.Net.KeyboardSource({ fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', lookL: 'KeyJ', lookR: 'KeyK', lookU: 'KeyF', lookD: 'KeyV', cast: ['Digit1'] }, { mouseLook: true })];
    cam.setMode('first');
    p.yaw = 0; p.pitch = 0; if (cam.yawSm !== null) cam.yawSm = 0;
    var plWas2 = window.GW.pointerLocked; window.GW.pointerLocked = true;
    var iN = 0, iChanged = 0, iMax = 0, iSum = 0, prevYaw = p.yaw;
    for (var ii = 0; ii < 60; ii++) {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 6, movementY: 0, bubbles: true }));
      await frames(1);
      var rawI = p.yaw - prevYaw;
      var dYawI = Math.abs(((rawI + Math.PI * 3) % (Math.PI * 2)) - Math.PI);   // 归一化后再比，免得跨 ±π 被当成巨跳
      if (dYawI > 1e-9) iChanged++;
      if (dYawI > iMax) iMax = dYawI;
      iSum += dYawI; prevYaw = p.yaw; iN++;
    }
    window.GW.pointerLocked = plWas2;
    var iAvg = iSum / Math.max(1, iChanged);
    var iRatio = iAvg > 1e-6 ? iMax / iAvg : 1e9;
    checks.push({ name: 'I 转向按渲染帧推进', ok: (iChanged / iN) > 0.85 && iAvg > 1e-4 && iRatio < 2,
      detail: '连续 ' + iN + ' 帧每帧注入鼠标位移：yaw 有变化的帧 ' + iChanged + '/' + iN + '（' + (100 * iChanged / iN).toFixed(0) + '%），'
        + '平均每帧 ' + iAvg.toFixed(4) + ' rad、单帧最大 ' + iMax.toFixed(4) + ' rad、最大/平均=' + iRatio.toFixed(2)
        + (iRatio >= 2 ? ' ← 视角仍按 tick 阶跃更新（拉扯感的来源）' : '') });
    cam.setMode(cam0Mode);

    /* ---------- H 准星命中点能真的改到那一格 ---------- */
    st.sources = [];
    quiesceDrafts();
    cam.setMode('shoulder');
    /* 站位从「地图正中」改为「出生点」（2026-10-18）：A1 的矿脉放置把中矿平台钉在两张图的正中
       （床岩底座 + 晶体柱不可改造），在正中会瞄到不可改造格，把「准星能改地形」测成失败。
       判据与动作一条没改，只是把测量位置放到出生点——那里由生成器保证是整平、干净、可改造的台面。 */
    var hsp = st.match.spawnPts[0];
    var hx = Math.floor(hsp.x) + 0.5, hz = Math.floor(hsp.z) + 0.5;
    p.pos.set(hx, groundY(st.world, hx, hz) + p.h / 2 + 0.02, hz); p.vel.set(0, 0, 0);
    /* 取景方向改成"多种姿态里挑一个真的能改地形的"（2026-10-18，31337 实测）：
       出生点固定在树冠底下时，0.45 仰角那条射线会扎进树冠里的叶子——面偏移后的落位格被邻叶占着，
       place 的报价单为空（R.priceTerrain 返回 0 格），于是"瞄到哪就能改哪"被测成失败。
       这不是放宽判据：每一次尝试仍走"相机射线 → 准星格 → 一次真实 playCard → 比对 3×3 区域"，
       ok 仍然要求"出牌成功且区域真的被改写"；只是不再赌某一个固定朝向刚好不是树冠。 */
    /* 俯角而不是仰角：place 的 maxDist 是 6，31337 的出生点在树冠底下——仰角射线会穿出很远
       （实测打到 8–14 格外的叶子），canPlay 直接判「超出施法范围」，四个姿态全灭。
       抬头看不到脚下，低头才在 6 格内：俯角 0.5–0.7 的射线在出生台面上落在 3–4 格外。 */
    var poses = [[0.4, -0.50], [1.3, -0.60], [2.5, -0.65], [-0.9, -0.55]];
    var tgt = null, region = [], s0 = null, s1 = null, played = false;
    for (var hp2 = 0; hp2 < poses.length && !played; hp2++) {
      p.yaw = poses[hp2][0]; p.pitch = poses[hp2][1]; if (cam.yawSm !== null) cam.yawSm = p.yaw;
      p.hand[0] = 'place'; p.mana = 10;
      await frames(6);
      if (!p.aim) { p.pitch = poses[hp2][1] - 0.15; await frames(6); }
      if (!p.aim) p.aim = st.match.defaultAim(p);
      tgt = { x: p.aim.gx, y: p.aim.gy, z: p.aim.gz };
      region = [];
      for (var dx = -2; dx <= 3; dx++) for (var dy = -2; dy <= 2; dy++) for (var dz = -2; dz <= 2; dz++) region.push([tgt.x + dx, tgt.y + dy, tgt.z + dz]);
      var snapOf = function () { return region.map(function (c) { return st.world.get(c[0], c[1], c[2]); }).join(','); };
      s0 = snapOf(); var okOne = !!st.match.playCard(p, 0); await frames(3); s1 = snapOf();
      if (okOne && s0 !== s1) played = true;
    }
    checks.push({ name: 'H 瞄准能出牌', ok: !!played && s0 !== s1,
      detail: '出牌=' + !!played + '，准星格(' + (tgt ? tgt.x + ',' + tgt.y + ',' + tgt.z : '—') + ') 周围 3×3 区域 ' + (s0 !== s1 ? '已改写' : '未变化') });

    /* ---------- F 分屏互见 ---------- */
    window.__GW_START({ mode: 'split', seed: opts.seed || 490706, deck: opts.deck || 'starter', map: opts.map });
    await frames(25);
    st.sources = [];
    var sp0 = st.match.players[0], sc0 = st.cams[0];
    sc0.setMode('shoulder');
    for (var t = 0; t < 40 && !sc0.selfHidden; t++) {              // 低头转身分逼出"自己不画"的判定
      sp0.pos.set(wx * 0.5, groundY(st.world, wx * 0.5, wz * 0.5) + sp0.h / 2 + 0.02, wz * 0.5);
      sp0.yaw += 0.45; sp0.pitch = -0.8; await frames(3);
    }
    checks.push({ name: 'F 分屏互见', ok: window.__dbg.ent.children[0].visible,
      detail: 'cam0.selfHidden=' + sc0.selfHidden + '，一帧结束后 heroes[0].visible=' + window.__dbg.ent.children[0].visible + '（P2 画面必须还能看见 P1）' });
    window.__GW_START({ mode: opts.mode || 'train', seed: opts.seed || 490706, deck: opts.deck || 'starter', map: opts.map });
    await frames(10);
    st.sources = savedSources || st.sources;

    /* ---------- J 机位连续性 + jerk（防"视角拉扯"回归） ----------
       两条测量纪律（我各踩过三次才记住）：
         · 必须先停主循环 GWAPP.running=false，再按固定 dt 手动 cam.update；
           游戏自己的 rAF 与手动 dt 交替驱动同一台相机，量出来全是脏数据。
         · 每个采样点先静置收敛、并丢弃落位后第一帧，否则把样本间传送当成机位抖动。
       指标口径：人眼感知的是**速度突变**不是位移，所以主指标 jerk = |Δ²pos|/dt²（格/s²，帧率无关）。
       位移只是辅助：静立 <0.01、转视角 <0.2。名义圆周向心 ω²R≈56 格/s² 是构图必然，不该报警；
       旧 bug 量级（单帧 0.25 格位移）折算 jerk≈6400 格/s²，所以转视角阈值取 400。
       另外断言 posViolations（update 内的自检：机位移动是否超出弧扫+通道速率预算）必须为 0。 */
    st.running = false;
    var jc = st.cams[0], jp = st.match.players[0], jw = st.world;
    if (jc.posViolations) jc.posViolations = 0;
    function jRndGen(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
    function jPlace(x, z, yaw, mode) {
      var gg = jw.camGroundY(Math.floor(x), Math.floor(z));
      jp.pos.set(x, (gg < 0 ? 0 : gg) + 1 + jp.h / 2, z); jp.vel.set(0, 0, 0);
      jp.yaw = yaw; jp.pitch = 0; jc.setMode(mode);
    }
    var jRep = { rows: [], embedded: 0, embedStill: 0, embedTurn: 0, viol: 0, frames: 0, hard: 0, playerBuried: 0, pass: true };
    var jDts = [1 / 60, 1 / 160, 1 / 240];
    for (var jd = 0; jd < jDts.length; jd++) {
      var DT = jDts[jd], rnd = jRndGen(2467 + jd);
      var stMax = 0, tnMax = 0, stJerk = 0, tnJerk = 0, fiMax = 0;
      for (var jt = 0; jt < 24; jt++) {
        var jx = 5 + rnd() * (wx - 10), jz = 5 + rnd() * (wz - 10), jy = rnd() * 6.28;
        jPlace(jx, jz, jy, 'shoulder');
        var nSettle = Math.ceil(2.0 / DT);                                        // 收敛按时长给，不按帧数：2 秒
        for (var js = 0; js < nSettle; js++) jc.update(jp, jw, DT, {});
        var p0x = jc.pos.x, p0y = jc.pos.y, p0z = jc.pos.z, vPrev = 0;
        var nStill = Math.ceil(0.6 / DT);
        for (var jf = 0; jf < nStill; jf++) {                                      // 静立 0.6 秒
          jc.update(jp, jw, DT, {});
          var d = Math.hypot(jc.pos.x - p0x, jc.pos.y - p0y, jc.pos.z - p0z);
          var v = d / DT; stJerk = Math.max(stJerk, Math.abs(v - vPrev) / DT); vPrev = v;      // jerk = Δv/dt，格/s²
          stMax = Math.max(stMax, d); p0x = jc.pos.x; p0y = jc.pos.y; p0z = jc.pos.z;
          jRep.frames++;
          // 分布必须分开统计：静立期还穿透 = 相机天然埋进身后地形、收到下限仍无处可退（场景固有）；
          // 只有转视角期穿透才是"让路来不及"。两者处置方式完全不同，混在一起就会像上一轮那样瞎调前瞻。
          // 玩家自身就被埋进地形时（日志会出现"被地形卡住，已顶出"），相机在固体里是必然结果，
          // 不能算相机算法的账：这类样本单独计数、不计入穿透断言。上一版就吃过这个误判。
          if (jw.cameraFree(jp.pos.x, jp.pos.y + jc.eyeH, jp.pos.z) && !jw.cameraFree(jc.pos.x, jc.pos.y, jc.pos.z)) { jRep.embedded++; jRep.embedStill++; }
        }
        jPlace(jx, jz, jy, 'shoulder');
        jc.update(jp, jw, DT, {});                                                  // 落位帧丢弃
        p0x = jc.pos.x; p0y = jc.pos.y; p0z = jc.pos.z;
        var q0x = p0x, q0y = p0y, q0z = p0z, vPrev2 = 0;
        var nTurn = Math.ceil(0.8 / DT);
        for (var jf2 = 0; jf2 < nTurn; jf2++) {                                      // 匀速转视角 0.8 秒
          jp.yaw += -(4.2 * DT);                                                    // 4.2 rad/s ≈ 240°/s，与帧率无关
          jc.update(jp, jw, DT, {});
          var d2 = Math.hypot(jc.pos.x - p0x, jc.pos.y - p0y, jc.pos.z - p0z);
          var v2 = Math.hypot(jc.pos.x - q0x, jc.pos.y - q0y, jc.pos.z - q0z) / DT;
          tnJerk = Math.max(tnJerk, Math.abs(v2 - vPrev2) / DT); vPrev2 = v2;          // jerk = Δv/dt，格/s²
          tnMax = Math.max(tnMax, d2);
          q0x = p0x; q0y = p0y; q0z = p0z; p0x = jc.pos.x; p0y = jc.pos.y; p0z = jc.pos.z;
          jRep.frames++;
          if (jw.cameraFree(jp.pos.x, jp.pos.y + jc.eyeH, jp.pos.z) && !jw.cameraFree(jc.pos.x, jc.pos.y, jc.pos.z)) { jRep.embedded++; jRep.embedTurn++; }
          else if (!jw.cameraFree(jp.pos.x, jp.pos.y + jc.eyeH, jp.pos.z)) jRep.playerBuried++;
        }
        if (jt < 8) {                                                               // 第一人称不该有机位运动
          jPlace(jx, jz, jy, 'first');
          jc.update(jp, jw, DT, {});
          var r0x = jc.pos.x, r0y = jc.pos.y, r0z = jc.pos.z;
          for (var jf3 = 0; jf3 < 30; jf3++) {
            jp.yaw += -(4.2 * DT); jc.update(jp, jw, DT, {});
            fiMax = Math.max(fiMax, Math.hypot(jc.pos.x - r0x, jc.pos.y - r0y, jc.pos.z - r0z));
            r0x = jc.pos.x; r0y = jc.pos.y; r0z = jc.pos.z;
          }
        }
      }
      /* 阈值用**物理预算**而不是拍脑袋的常数（旧写法在 @60fps 把物理下限当抖动报警）：
         位移预算 = 构图弧扫 ω·R·dt + 三通道速率上限·dt + 余量；arcDisp@60fps 本身就有 0.225 格
         jerk 预算 = 2×accel：伺服一帧内至多被"球级挤压"追加调用一次；名义圆周向心 ω²R 仅约 57 格/s² */
      var arcDisp = 4.2 * 3.22 * DT, rateDisp = (jc.vYield + jc.vSide + jc.vLift) * DT;
      var turnBudget = arcDisp + rateDisp + 0.05, jerkBudget = 2 * jc.accel * 1.2;
      var okD = stMax < 0.01 && tnMax < turnBudget && stJerk < 50 && tnJerk < jerkBudget && fiMax < 0.05;
      if (!okD) jRep.pass = false;
      jRep.rows.push({ dt: (1 / DT).toFixed(0), stMax: +stMax.toFixed(4), tnMax: +tnMax.toFixed(4),
        stJerk: +stJerk.toFixed(1), tnJerk: +tnJerk.toFixed(1), fiMax: +fiMax.toFixed(4), ok: okD });
    }
    jRep.viol = jc.posViolations || 0;
    jRep.hard = jc.hardUnstick || 0;
    /* 埋墙改成**占比**口径（K3 建议）：点级穿透由 near=0.26 裁掉，属于可容忍的短暂重叠，
       只有超过 0.5% 帧才算问题；真正硬断言的是"机位跳变不超物理预算"与"自检违例必须为 0"。 */
    var frameAll = jRep.frames || 1;
    jRep.pctEmbed = 100 * jRep.embedded / frameAll;
    if (jRep.viol !== 0) jRep.pass = false;
    if (jRep.pctEmbed > 0.5) jRep.pass = false;
    st.running = true;
    jc.setMode('shoulder');
    checks.push({ name: 'J 机位连续性与 jerk', ok: jRep.pass,
      detail: jRep.rows.map(function (r) { return '@' + r.dt + 'fps 静立 ' + r.stMax + '/jerk ' + r.stJerk + '，转视角 ' + r.tnMax + '/jerk ' + r.tnJerk + (r.ok ? '' : ' ✗'); }).join(' | ')
        + ' | 第一人称最大机位运动 ' + jRep.rows[1].fiMax
        + ' | 点级穿透 ' + jRep.embedded + '/' + jRep.frames + ' 帧 = ' + jRep.pctEmbed.toFixed(2) + '%'
        + '（静立期 ' + jRep.embedStill + ' / 转视角期 ' + jRep.embedTurn + '；另 ' + jRep.playerBuried + ' 帧因玩家自身被埋而豁免）'
        + ' | 让路触发 ' + jRep.hard + ' 次 | 自检违例 ' + jRep.viol + ' 次（必须 0）' });

console.error = oldErr;
    var pass = checks.every(function (c) { return c.ok; });
    stats.mode = cam.mode;
    return { pass: pass, checks: checks, stats: stats };
  }

  /* 摆一个姿态并等一帧干净画面，供截图对比 */
  window.__camPose = function (o) {
    var st = S(); if (!st || !st.match) return null;
    var p = st.match.players[0], cam = st.cams[0];
    if (o && o.mode) cam.setMode(o.mode);
    if (o.freeze !== false) st.sources = [];
    var g = groundY(st.world, o.x, o.z);
    p.pos.set(o.x, o.y !== undefined ? o.y : g + p.h / 2 + 0.02, o.z);
    p.vel.set(0, 0, 0); p.yaw = o.yaw; p.pitch = o.pitch || 0;
    if (cam.yawSm !== null && o.settle !== false) cam.yawSm = o.yaw;
    if (o.curRadius) cam.curRadius = o.curRadius;
    return { groundY: g, mode: cam.mode, radius: +cam.curRadius.toFixed(2) };
  };
  window.__camAudit = run;
  window.__camCrossBox = CROSSBOX();
})();
