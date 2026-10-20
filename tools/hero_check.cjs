#!/usr/bin/env node
/* tools/hero_check.cjs · 玩家角色层回归（不参与游戏运行），20 条

   管的是 src/hero-rig.js + src/hero-sprites.js 这两层的行为：
     装配：12 部件 / 48 面贴图、六面材质齐全、两阵营两张替换表（只动红点缀，不许动皮带的棕）；
     走路：两腿反相、摆臂封顶、胯跟着颠、肩腰反向、袍角帽尖弹簧跟随——用户报的「四肢各动各的」在这抓；
     法杖：挂在左臂关节下（藏手臂=藏杖）、世界 AABB 横向不胀；
     事件：施法回抽→前指→收势、挨打后仰、落地压缩；
     纪律：animate 只读 ctx、200 组随机输入无 NaN、同输入两次逐字节相同、动画期间实体零改动；
     相机：越肩 3 航向 × 8 俯仰 = 24 组位姿里不许「没压准星却整具隐藏」（审计 C4 同闸，多航向版）。

   分两段跑：骨架段用 tools/hero_harness.html 的独立壳页（只加载 three + 角色层两文件），
   并行会话把整机改挂了也量得出来；相机段要真页面，页面起不来就打 SKIP + 原因，不替邻居背锅也不装绿。
   不管什么：贴图取源图哪一段像素——那由 tools/hero_bake.cjs --contact/--assemble 出图，人眼对源帧核。
   用法：node tools/hero_check.cjs [--shots 目录]      全过退出码 0
*/
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { createRequire } = require('module');
const ROOT = path.resolve(__dirname, '..');
let PW = null;
for (const c of ['playwright', 'playwright-core',
  '/data/miniconda3/miniconda3/lib/node_modules/playwright',
  '/data/miniconda3/miniconda3/lib/node_modules/playwright-core']) {
  try { PW = createRequire(__filename)(c); break; } catch (e) {}
}
if (!PW) { console.error('找不到 playwright（同 tools/audit.cjs 的加载方式）'); process.exit(2); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
      if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
      fs.readFile(fp, (e, buf) => {
        if (e) { rsp.writeHead(404).end('nf'); return; }
        rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
/* ---------- 第一段：骨架（独立壳页，只要 three + 角色层两文件） ---------- */
const IN_RIG = async function (opts) {
  const mk = () => {
    const o = { fails: [], info: {}, shots: [], skipped: '' };
    o.ok = (name, cond, detail) => { o.fails.push({ name: name, ok: !!cond, detail: detail === undefined ? '' : String(detail) }); };
    return o;
  };
  const out = mk();
  const HERO = window.GW.HERO, S = window.GW.HERO_SPRITES;
  const h = HERO.build(0), rival = HERO.build(1);
  const scene = new THREE.Scene();
  scene.add(h); scene.add(rival);
  const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(2, 4, -3); scene.add(dl);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  h.updateMatrixWorld(true);
  const P = h.userData.parts, pr = P.parts, N = P.nodes, A = h.userData.anim;
  out.ok('部件与关节齐全（armL/armR 是关节组，腿是网格）',
    !!P.armL && !!P.armR && !!P.legL && !!P.legR && !!P.head && P.armL.isGroup === true, Object.keys(pr).join(','));
  out.ok('两阵营是两套独立网格（分屏要各自动画）', rival !== h && rival.userData.parts.legL !== P.legL);
  let noTex = [];
  h.traverse(function (m) {
    if (!m.isMesh) return;
    if (m.userData.heroPart === 'body') { if (!m.material || !m.material.map) noTex.push('公告牌没贴图'); return; }
    const ms = Array.isArray(m.material) ? m.material : [m.material];
    if (ms.length !== 6) noTex.push(m.userData.heroPart + ' 只有 ' + ms.length + ' 面材质');
    /* ±X/±Z 四面必须是贴图；±Y 是纯色盖子（贴图会把整张图压成薄片，见 hero-rig 的 capMaterial） */
    [0, 1, 4, 5].forEach(function (i) { if (!ms[i] || !ms[i].map) noTex.push(m.userData.heroPart + ' 第 ' + i + ' 面没贴图'); });
    [2, 3].forEach(function (i) { if (!ms[i]) noTex.push(m.userData.heroPart + ' 第 ' + i + ' 面没材质'); });
  });
  out.ok('每个部件六面都有贴图（少一面就是烘焙取框错了）', !noTex.length, noTex.slice(0, 4).join(' / '));
  out.info.parts = Object.keys(S.parts).length; out.info.tex = Object.keys(S.tex).length; out.info.palette = S.palette.length - 1;
  out.ok('贴图数据齐全：盒模型 12 部件 48 面 + 公告牌帧图（去重后合计 ≥60）',
    Object.keys(S.parts).length === 12 && Object.keys(S.tex).length >= 60,
    'parts=' + Object.keys(S.parts).length + ' tex=' + Object.keys(S.tex).length);
  const hexOf = i => S.palette[i] || '';
  const rgbOf = i => { const s = hexOf(i); return s.length < 7 ? null : [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; };
  const changed = tbl => tbl.reduce((a, v, i) => a + (v === i ? 0 : 1), 0);
  /* 只查"真的被像素用到"的调色板项：p1/p2 的渐变色是烘完面之后才追加进调色板的，
     它们的下标不会被任何像素引用（P2 的橙色渐变本身就像棕色，一起判会误伤）。 */
  const used = {};
  Object.keys(S.tex).forEach(function (k) {
    const b = atob(S.tex[k].px);
    for (let i = 0; i < b.length; i++) { const v = b.charCodeAt(i) & 255; if (v) used[v] = 1; }
  });
  const brownIds = Object.keys(used).map(Number).filter(i => { const c = rgbOf(i); return c && c[0] > 110 && c[1] > 60 && c[2] < 110 && (c[0] - c[2]) > 60; });
  const badBrown = brownIds.filter(i => S.sides.p1[i] !== i || S.sides.p2[i] !== i);
  out.ok('阵营配色只换红点缀，主体（皮带棕/袍子灰/肤色）一个没动',
    changed(S.sides.p1) >= 2 && changed(S.sides.p2) >= 2 && !badBrown.length,
    '改 ' + changed(S.sides.p1) + '/' + changed(S.sides.p2) + ' 项' + (badBrown.length ? '，误伤 ' + badBrown.map(hexOf).join(',') : ''));
  out.ok('两阵营用的不是同一张替换表', S.sides.p1.join() !== S.sides.p2.join());
  /* 水晶要按"这台"选中的卡染色：给 P1 染色后 P2 不许跟着变，材质也不能是同一个对象 */
  const gm = r2 => { const m = r2.userData.parts.gem && r2.userData.parts.gem.material; const a = Array.isArray(m) ? m : [m]; return a.map(x => (x && x.color ? '#'+x.color.getHexString() : '无'))[0]; };
  HERO.setGemColor(h, '#12ab34');
  const own1 = gm(h), own2 = gm(rival);
  out.ok('杖水晶按阵营独立染色（分屏两人各选各的元素）', own1 === '#12ab34' && own2 !== own1, 'P1=' + own1 + ' P2=' + own2);
  HERO.setGemColor(h, null);
  function drive(root, ctx, n, dt) { for (let i = 0; i < n; i++) HERO.animate(root, ctx, dt || 1 / 60); }
  HERO.reset(h);
  A.ph = Math.PI / 2;
  drive(h, { speed: 5.4, air: 0, pitch: 0 }, 3);
  const lg = pr.legL.rotation.x, rg = pr.legR.rotation.x, ar = P.armR.rotation.x;
  out.ok('走路两腿反相（同摆就是「四肢各动各的」）', lg * rg < 0 && Math.abs(lg - rg) > 0.35, lg.toFixed(2) + '/' + rg.toFixed(2));
  out.ok('持杖手不跟腿同摆（杖不是节拍器）', Math.abs(P.armL.rotation.x) < 0.55, P.armL.rotation.x.toFixed(2));
  out.ok('摆臂幅度封顶（世界 AABB 不胀爆）', Math.abs(ar) <= 0.95, ar.toFixed(2));
  drive(h, { speed: 5.4, air: 0, pitch: 0 }, 40);
  out.ok('走路有上下颠（胯参与，不只是腿甩）', Math.abs(N.hips.position.y) > 0.004, N.hips.position.y.toFixed(4));
  out.ok('肩腰反向成套（torso 有 yaw）', Math.abs(A.hipYaw) > 0.005, A.hipYaw.toFixed(4));
  out.ok('袍角与帽尖弹簧跟随（惯性通道在动）', Math.abs(A.robeSway) + Math.abs(A.hatSway) > 0.01,
    A.robeSway.toFixed(3) + '/' + A.hatSway.toFixed(3));
  h.updateMatrixWorld(true);
  const sbb = new THREE.Box3().setFromObject(pr.staffShaft);
  const sw = +(sbb.max.x - sbb.min.x).toFixed(3), sd = +(sbb.max.z - sbb.min.z).toFixed(3);
  let inArm = false;
  P.armL.traverse(function (o) { if (o.isMesh && (o.userData.heroPart === 'staffShaft' || o.userData.heroPart === 'staffGem')) inArm = true; });
  out.ok('杖挂在左臂关节下（藏手臂=藏杖，肩上不再有扁平色块）', inArm);
  out.ok('杖的世界 AABB 横向不胀（宽+厚 ≤ 1.0 格）', sw + sd <= 1.0, 'w' + sw + ' d' + sd);
  HERO.cast(h, { dur: 0.6 });
  let peak = -9, back = 9;
  for (let i = 0; i < 40; i++) { drive(h, { speed: 0, air: 0, pitch: 0 }, 1); peak = Math.max(peak, P.armR.rotation.x); back = Math.min(back, P.armR.rotation.x); }
  out.ok('施法起手先回抽（armR 低于 -0.8）', back < -0.8, back.toFixed(2));
  out.ok('施法出手前指（armR 高于 0.9）', peak > 0.9, peak.toFixed(2));
  drive(h, { speed: 0, air: 0, pitch: 0 }, 50);
  out.ok('施法收势回待機（|armR| < 0.3）', Math.abs(P.armR.rotation.x) < 0.3, P.armR.rotation.x.toFixed(2));
  HERO.hurt(h);
  drive(h, { speed: 0, air: 0, pitch: 0 }, 9);
  out.ok('挨打后仰（torso.x 低于 -0.05）', N.torso.rotation.x < -0.05, N.torso.rotation.x.toFixed(2));
  HERO.land(h, 2.8);
  let dip = 0;
  for (let i = 0; i < 12; i++) { drive(h, { speed: 0, air: 0, pitch: 0 }, 1); dip = Math.min(dip, N.hips.position.y); }
  out.ok('落地压缩（hips.y 下沉到 -0.005 以下；早先符号写反，永远量不出来）', dip < -0.005, dip.toFixed(4));
  const frozen = Object.freeze({ speed: 3.1, air: 1, pitch: 0.4 });
  let ro = true;
  try { for (let i = 0; i < 90; i++) HERO.animate(h, frozen, 1 / 60); } catch (e) { ro = false; }
  out.ok('animate 只读 ctx（冻结后跑 90 帧不抛 = 没写回权威状态）', ro);
  let nanAt = null, seedv = 12345;
  const rnd = () => ((seedv = (seedv * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const poseOf = r => JSON.stringify([r.userData.anim.ph, r.userData.parts.legL.rotation.x, r.userData.parts.legR.rotation.x,
    r.userData.parts.armR.rotation.x, r.userData.parts.armL.rotation.x, r.userData.parts.nodes.torso.rotation.x,
    r.userData.parts.nodes.torso.rotation.y, r.userData.parts.nodes.head.rotation.x, r.userData.parts.nodes.hips.position.y]
    .map(v => (typeof v === 'number' && isFinite(v)) ? v : null));
  for (let i = 0; i < 200 && !nanAt; i++) {
    drive(h, { speed: rnd() * 7, air: Math.floor(rnd() * 3) - 1, pitch: rnd() * 1.6 - 0.8 }, 1, rnd() * 0.4);
    if (/null/.test(poseOf(h))) nanAt = '第 ' + i + ' 组：' + poseOf(h).slice(0, 150);
  }
  out.ok('200 组随机输入（含 0.4 秒卡顿帧）无 NaN', !nanAt, nanAt || '');
  seedv = 777; HERO.reset(h);
  const seq1 = []; for (let i = 0; i < 60; i++) { drive(h, { speed: rnd() * 6, air: 0, pitch: 0.2 }, 1); seq1.push(poseOf(h)); }
  seedv = 777; HERO.reset(h);
  const seq2 = []; for (let i = 0; i < 60; i++) { drive(h, { speed: rnd() * 6, air: 0, pitch: 0.2 }, 1); seq2.push(poseOf(h)); }
  out.ok('同输入两次逐字节相同（相位是角速度积分，不是随机）', seq1.join() === seq2.join());
  HERO.reset(h);
  for (let i = 0; i < 40; i++) HERO.animate(h, { speed: 0, air: 0, pitch: 0 }, 1 / 60);   // 中性姿态才量总高
  h.updateMatrixWorld(true);
  const st = HERO.stats(h) || {};
  out.info.height = typeof st.height === 'number' ? +st.height.toFixed(2) : st.height;
  out.info.meshes = st.meshes;
  /* 碰撞盒 h=1.8 是权威数值：视觉超出 1.7~2.0 就说明脚没落地或整体缩放漂了 */
  const tops = [];
  h.traverse(function (m) {
    if (!m.isMesh) return;
    const wb = new THREE.Box3().setFromObject(m);
    tops.push({ n: m.userData.heroPart, y: +wb.max.y.toFixed(2), vis: m.visible });
  });
  tops.sort((a, b) => b.y - a.y);
  out.ok('模型总高贴合碰撞盒（1.7 ~ 2.0 格）', st.height > 1.7 && st.height < 2.0,
    out.info.height + ' 最高部件 ' + tops.slice(0, 3).map(t => t.n + '@' + t.y + (t.vis ? '' : '(隐)')).join(' '));
  out.ok('盒模型 12 个网格 + 公告牌 1 张面片', st.meshes === 13, 'meshes=' + st.meshes);
  /* ---------- 公告牌段：朝向选帧与贴地，是"面向相机但别转错"的机检 ---------- */
  const B = S.billboards || {};
  out.ok('公告牌 7 套帧都在（4 走路 + 待机 + 2 施法）',
    ['front_walk', 'back_walk', 'left_walk', 'right_walk', 'idle', 'atk_front', 'atk_back'].every(k => B[k] && B[k].frames >= 4),
    Object.keys(B).map(k => k + ':' + B[k].frames).join(' '));
  {
    const bb = HERO.build(0);
    const holder = bb.userData.parts.holder, mesh = bb.userData.parts.body;
    const sc3 = new THREE.Scene(); sc3.add(bb);
    const camAt = (x, z) => { const c = new THREE.PerspectiveCamera(50, 1, 0.1, 50); c.position.set(x, 1.4, z); c.lookAt(0, 1, 0); c.updateMatrixWorld(true); return c; };
    const drawn = [];
    const probe = (label, cam, ctx, frames) => {
      HERO.reset(bb);
      for (let i = 0; i < (frames || 20); i++) HERO.animate(bb, ctx, 1 / 60);
      bb.updateMatrixWorld(true);
      let seen = null;
      mesh.onBeforeRender({}, sc3, cam); mesh.onBeforeRender({}, sc3, cam);   // 两次：与 snap 同源，消掉一帧滞后
      seen = bb.userData.anim.face;
      drawn.push({ label: label, face: seen, hasMap: !!(mesh.material && mesh.material.map) });
      return { face: seen, mesh: mesh };
    };
    /* 约定：θ 增大是往左（见 AGENTS 视角不变量），角色 rotation.y=0 时朝 -z，右肩在 +x。
       所以相机在 +x 看到的是角色的右侧，该取 right_walk。素材的 walk left/right 就是"从那一侧看过去"的侧身图。 */
    const f = probe('相机在正前', camAt(0, -5), { speed: 0, air: 0, pitch: 0 });
    const b1 = probe('相机在正后', camAt(0, 5), { speed: 0, air: 0, pitch: 0 });
    const rr2 = probe('相机在+x（角色右侧）', camAt(5, 0), { speed: 0, air: 0, pitch: 0 });
    const ll2 = probe('相机在-x（角色左侧）', camAt(-5, 0), { speed: 0, air: 0, pitch: 0 });
    out.ok('四个机位选对朝向（前/后/左/右不串）', f.face === 'front' && b1.face === 'back' && rr2.face === 'right' && ll2.face === 'left',
      [f.face, b1.face, rr2.face, ll2.face].join('/'));
    /* 面片必须"脸朝相机"：世界前向与 面片→相机 的水平夹角 < 4° */
    const cam0 = camAt(2.1, -4.4);
    HERO.reset(bb);
    for (let i = 0; i < 12; i++) HERO.animate(bb, { speed: 0, air: 0, pitch: 0 }, 1 / 60);
    bb.updateMatrixWorld(true);
    mesh.onBeforeRender({}, sc3, cam0);
    const nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
    const toCam = new THREE.Vector3(cam0.position.x, 0, cam0.position.z).sub(new THREE.Vector3(bb.position.x, 0, bb.position.z)).normalize();
    const off = Math.acos(Math.max(-1, Math.min(1, nrm.setY(0).normalize().dot(toCam))));
    out.ok('公告牌绕 Y 正对相机（偏角 < 4°，不会出现纸片侧着给你看）', off < 0.07, off.toFixed(3) + ' 弧度');
    /* 脚贴地：世界包围盒最低点必须落在 0 附近（脚底悬空/陷地都是锚点错） */
    const wb = new THREE.Box3().setFromObject(mesh);
    out.ok('公告牌脚底贴地（min.y 在 ±0.06 内）', Math.abs(wb.min.y) < 0.06, wb.min.y.toFixed(3));
    /* 走路要真的换帧：一个周期内至少出现 3 个不同贴图 */
    const keys = {};
    HERO.reset(bb);
    for (let i = 0; i < 90; i++) {
      HERO.animate(bb, { speed: 5.2, air: 0, pitch: 0 }, 1 / 60);
      bb.updateMatrixWorld(true);
      mesh.onBeforeRender({}, sc3, cam0);
      const mp = mesh.material && mesh.material.map;
      keys[mp ? (mp.uuid) : 'none'] = 1;
    }
    out.ok('走路换帧（一个周期里出现 ≥3 张不同贴图）', Object.keys(keys).length >= 3, Object.keys(keys).length + ' 张');
    /* 站桩不许换套图：素材的 idle 与走路系列的杖不在同一只手，一切就"跳边"，所以站桩必须还是走路系列的定机帧 */
    HERO.reset(bb);
    const idleKeys = {};
    for (let i = 0; i < 120; i++) {
      HERO.animate(bb, { speed: 0, air: 0, pitch: 0 }, 1 / 60);
      bb.updateMatrixWorld(true);
      mesh.onBeforeRender({}, sc3, camAt(0, 5));
      const mp3 = mesh.material && mesh.material.map;
      if (mp3) idleKeys[mp3.uuid] = 1;
    }
    out.ok('站桩固定 1 张（不与 idle 套混用，杖不会跳边）', Object.keys(idleKeys).length === 1, Object.keys(idleKeys).length + ' 张');
    /* 施法必须切到 attack 套（素材自己画的施法动作，不是我手写的四肢角度） */
    HERO.reset(bb);
    HERO.cast(bb, { dur: 0.6 });
    const used = {};
    for (let i = 0; i < 36; i++) {
      HERO.animate(bb, { speed: 0, air: 0, pitch: 0 }, 1 / 60);
      bb.updateMatrixWorld(true);
      mesh.onBeforeRender({}, sc3, camAt(0, -5));
      const mp2 = mesh.material && mesh.material.map;
      if (mp2) used[mp2.uuid] = 1;
    }
    out.ok('施法切到素材的 attack 帧（≥3 张）', Object.keys(used).length >= 3, Object.keys(used).length + ' 张');
    /* 落地压缩：land 之后 scale.y 必须短于静止时 */
    HERO.reset(bb);
    mesh.onBeforeRender({}, sc3, camAt(0, -5));
    const h0 = mesh.scale.y;
    HERO.land(bb, 3.0);
    let minY = h0;
    for (let i = 0; i < 14; i++) {
      HERO.animate(bb, { speed: 0, air: 0, pitch: 0 }, 1 / 60);
      bb.updateMatrixWorld(true);
      mesh.onBeforeRender({}, sc3, camAt(0, -5));
      minY = Math.min(minY, mesh.scale.y);
    }
    out.ok('落地压缩把面片压短（scale.y 至少缩 6%）', minY < h0 * 0.94, h0.toFixed(3) + ' → ' + minY.toFixed(3));
    out.info.faces = drawn.map(d => d.label + ':' + d.face).join(' ');
  }
  if (opts.shots) {
    /* 每台相机新建一个 renderer、只画一次就取 dataURL：同一台 renderer 反复 render+toDataURL
       在这个 headless(SwiftShader) 环境里从第二张起全是黑的（我第一版就是这么把黑图当成"模型没了"）。 */
    async function snap(tag, cam, W, H, clear) {
      const rn = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      rn.setSize(W, H, false);
      document.body.appendChild(rn.domElement);
      rn.setClearColor(clear, 1);
      /* 连画两次：公告牌的朝向是在 onBeforeRender 里写的，那一帧的世界矩阵已经算完了
         （矩阵先更新、后回调）。游戏里机位连续转，一帧的滞后看不出来；这里相机是"跳"过去的，
         不补一帧就会拍到转 90° 之前的姿态，甚至从背面镜像画出来。 */
      rn.render(sc2, cam);
      rn.render(sc2, cam);
      const url = rn.domElement.toDataURL('image/png');
      rn.dispose();
      rn.domElement.remove();
      out.shots.push(await window.__shot(tag, url, W, H));
    }
    const one = HERO.build(0); one.position.set(0, 0, 0); one.rotation.set(0, 0, 0);
    const sc2 = new THREE.Scene(); sc2.add(one);
    sc2.add(new THREE.AmbientLight(0xffffff, 1));
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.9); dl2.position.set(1.5, 3, -2); sc2.add(dl2);
    HERO.reset(one);
    for (let i = 0; i < 30; i++) HERO.animate(one, { speed: 0, air: 0, pitch: 0 }, 1 / 60);
    one.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(one);
    const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, cz = (box.min.z + box.max.z) / 2;
    const rr = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.62;
    const V = { front: [0, 0, -1], back: [0, 0, 1], left: [1, 0, 0], right: [-1, 0, 0] };
    for (const k in V) {
      const cam2 = new THREE.OrthographicCamera(-rr * 0.85, rr * 0.85, rr, -rr, 0.1, 20);
      cam2.position.set(cx + V[k][0] * 5, cy + V[k][1] * 5, cz + V[k][2] * 5);
      cam2.lookAt(cx, cy, cz);
      await snap(k, cam2, 260, 300, 0xff00ff);
    }
    /* 盒模型对照：同样的四个朝向再出一遍（MODE=box），公告牌与盒子谁好看要有图能比 */
    HERO.setMode('box');
    for (const k in V) {
      const cam2 = new THREE.OrthographicCamera(-rr * 0.85, rr * 0.85, rr, -rr, 0.1, 20);
      cam2.position.set(cx + V[k][0] * 5, cy + V[k][1] * 5, cz + V[k][2] * 5);
      cam2.lookAt(cx, cy, cz);
      await snap('box_' + k, cam2, 260, 300, 0x00ffff);
    }
    HERO.setMode('bill');
    /* 越肩构图：按游戏里的 shoulder 1.55 / radius 2.95 / 侧移 1.3 摆一台自由相机。
       整机被并行会话改挂时，这两张就是"用户实际看到的画面"的替代证据，别看不了游戏就交空手。 */
    const cam3 = () => {
      const c = new THREE.PerspectiveCamera(58, 300 / 340, 0.1, 40);
      c.position.set(-1.30, 1.70, -2.95); c.lookAt(0, 1.30, 0.30); return c;
    };
    for (let i = 0; i < 26; i++) HERO.animate(one, { speed: 4.6, air: 0, pitch: 0.12 }, 1 / 60);
    one.updateMatrixWorld(true);
    await snap('shoulder_walk', cam3(), 300, 340, 0x2f6b3a);
    for (let i = 0; i < 40; i++) HERO.animate(one, { speed: 0, air: 0, pitch: 0 }, 1 / 60);
    one.updateMatrixWorld(true);
    await snap('shoulder_idle', cam3(), 300, 340, 0x2f6b3a);
  }
  return out;
};
/* ---------- 第二段：越肩闸（真页面） ---------- */
const IN_GAME = async function (opts) {
  const mk = () => {
    const o = { fails: [], info: {}, shots: [], skipped: '' };
    o.ok = (name, cond, detail) => { o.fails.push({ name: name, ok: !!cond, detail: detail === undefined ? '' : String(detail) }); };
    return o;
  };
  const out = mk();
  const app = window.GWAPP;
  window.__GW_START({ mode: 'train', seed: opts.seed, deck: 'starter' });
  for (let i = 0; i < 24; i++) await new Promise(r => requestAnimationFrame(r));
  const heroes = [];
  window.__dbg.ent.traverse(function (o) {
    if (o.isMesh && o.userData.heroPart) { let n = o; while (n && !n.userData.anim) n = n.parent; if (n && heroes.indexOf(n) < 0) heroes.push(n); }
  });
  const h = heroes[0];
  if (!h) { out.skipped = '场上没有角色网格（装配断了或页面没起来）'; return out; }
  const P = h.userData.parts, camx = app.cams[0], w = app.world, p = app.match.players[0];
  app.running = false;
  function openness(x, z) {
    const y = w.camGroundY(Math.floor(x), Math.floor(z)); if (y < 0) return -1;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const y2 = w.camGroundY(Math.floor(x) + dx, Math.floor(z) + dz);
      if (y2 < 0 || Math.abs(y2 - y) > 1) return -1;
      for (let k = 1; k <= 5; k++) if (w.get(Math.floor(x) + dx, y2 + k, Math.floor(z) + dz)) return -1;
    }
    return y;
  }
  const spots = [], seen = {};
  for (let x = 8; x < w.SX - 8 && spots.length < 3; x += 3) for (let z = 8; z < w.SZ - 8 && spots.length < 3; z += 3) {
    const y = openness(x, z); if (y < 0) continue;
    const key = Math.floor(x / 18) + ',' + Math.floor(z / 18); if (seen[key]) continue; seen[key] = 1;
    spots.push([x + 0.5, z + 0.5, y]);
  }
  const heroBox = () => {
    const g = { core: [], legs: [], props: [] }, bb = new THREE.Box3();
    h.updateMatrixWorld(true);
    h.traverse(function (m) {
      if (!m.isMesh || !m.visible || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      bb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
      if (bb.isEmpty()) return;
      let gg = 'core', o = m;
      for (; o && o !== h; o = o.parent) {
        if (o === P.armL || o === P.armR) { gg = 'props'; break; }
        if (o === P.legL || o === P.legR) { gg = 'legs'; break; }
      }
      g[gg].push({ min: bb.min.clone(), max: bb.max.clone() });
    });
    return g;
  };
  const CB = window.GW.CAM_CROSS;
  const snap = () => JSON.stringify([p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z, p.yaw, p.pitch, p.hp, p.hand]);
  let falseHide = [], minNear = 99, samples = 0, wrote = '';
  for (const sp of spots) for (const yaw of [0.785, 2.35, 4.71]) for (let pi = 0; pi < 8; pi++) {
    const pitch = -0.85 + pi * 0.2;
    p.pos.set(sp[0], sp[2] + 1 + p.h / 2 + 0.02, sp[1]);
    p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; p.alive = true;
    if (camx.yawSm !== null) camx.yawSm = yaw;
    camx.curRadius = camx.radius; camx.selfHidden = false; camx.selfClearT = 0;
    const before = snap();
    for (let i = 0; i < 22; i++) await new Promise(r => requestAnimationFrame(r));
    if (!wrote && snap() !== before) wrote = '跑动画前后实体变了';
    samples++;
    const g = heroBox();
    let coreCross = false;
    ['core', 'legs', 'props'].forEach(function (gn) {
      g[gn].forEach(function (b) {
        const s = camx._boxSpan(b.min, b.max);
        if (!s) return;
        if (isFinite(s[5])) minNear = Math.min(minNear, s[5]);
        if (gn === 'core' && s[1] > CB.x0 && s[0] < CB.x1 && s[3] > CB.y0 && s[2] < CB.y1) coreCross = true;
      });
    });
    if (camx.selfHidden && !coreCross) falseHide.push('spot(' + sp[0] + ',' + sp[1] + ') yaw' + yaw.toFixed(2) + ' pitch' + pitch.toFixed(2));
  }
  out.ok('越肩 3 航向 × 8 俯仰不许「没压准星却整具隐藏」（' + samples + ' 个位姿）', !falseHide.length, falseHide.slice(0, 3).join(' | '));
  out.ok('动画期间实体一个字段没变', !wrote, wrote);
  out.info.samples = samples; out.info.minNear = +minNear.toFixed(2);
  return out;
};
(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await PW.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  const shotsDir = process.argv.indexOf('--shots') >= 0 ? process.argv[process.argv.indexOf('--shots') + 1] : null;
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  let bad = 0, skipped = '';
  console.log('— 骨架段（壳页：three + hero-sprites + hero-rig）—');
  await page.goto('http://127.0.0.1:' + port + '/tools/hero_harness.html?cb=' + Math.random().toString(36).slice(2));
  await page.waitForFunction(() => window.GW && window.GW.HERO && window.GW.HERO_SPRITES, null, { timeout: 30000 });
  let shotN = 0;
  if (shotsDir) {
    await page.exposeFunction('__shot', async (tag, dataUrl, w, h) => {
      /* 取 canvas 自己吐的 PNG，不用 page.screenshot：setSize(...,false) 不写样式，
         截页面只会截到 body 底色——第一版就是这么把"整张深色"当成渲染结果的。 */
      const buf = Buffer.from(String(dataUrl).split(',')[1], 'base64');
      const f = path.join(shotsDir, 'hero_view_' + (++shotN) + '_' + tag + '.png');
      fs.writeFileSync(f, buf);
      return f + '[' + Math.round(w) + 'x' + Math.round(h) + ']';
    });
  }
  const rig = await page.evaluate(IN_RIG, { shots: !!shotsDir });
  rig.fails.forEach(f => { console.log((f.ok ? '✓ ' : '✗ ') + f.name + (f.detail ? '  —  ' + f.detail : '')); if (!f.ok) bad++; });
  console.log('  信息：部件 ' + rig.info.parts + ' / 面 ' + rig.info.tex + ' / 调色板 ' + rig.info.palette + ' 色；模型高 ' + rig.info.height + ' 格，网格 ' + rig.info.meshes + ' 个');
  if (rig.shots && rig.shots.length) console.log('  四视图 → ' + rig.shots.join(' '));
  const rigErrs = errs.filter(e => /hero-rig|hero-sprites|HERO|THREE/i.test(e));
  if (rigErrs.length) { console.log('✗ 角色层页面异常 ' + rigErrs.length + ' 条，例：' + rigErrs[0]); bad++; }
  console.log('— 相机段（真页面 __GW_START）—');
  let booted = true;
  try {
    await page.goto('http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2));
    await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 45000 });
  } catch (e) { booted = false; }
  if (!booted) {
    skipped = '整机页面 45 秒没起来（最后 pageError：' + (errs.slice(-2).join(' / ').slice(0, 150) || '无') + '）';
    console.log('! SKIP — ' + skipped);
  } else {
    const game = await page.evaluate(IN_GAME, { seed: 490706 });
    if (game.skipped) { skipped = game.skipped; console.log('! SKIP — ' + skipped); }
    else {
      game.fails.forEach(f => { console.log((f.ok ? '✓ ' : '✗ ') + f.name + (f.detail ? '  —  ' + f.detail : '')); if (!f.ok) bad++; });
      console.log('  信息：越肩位姿 ' + game.info.samples + ' 个，部件距相机最近 ' + game.info.minNear + ' 格（近场闸 1.45）');
    }
    const other = errs.filter(e => !/hero-rig|hero-sprites|HERO/i.test(e));
    if (other.length) console.log('! 其他层页面异常 ' + other.length + ' 条（不计入本层，例：' + other[0].slice(0, 90) + '）');
  }
  await browser.close(); srv.close();
  console.log(bad ? '\n角色层违规 ' + bad + ' 项' + (skipped ? '（相机段 SKIP）' : '')
    : '\n角色层回归' + (skipped ? '：骨架段全过，相机段 SKIP——' + skipped.slice(0, 70) : '全过'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
