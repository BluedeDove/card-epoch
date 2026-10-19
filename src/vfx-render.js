/* ================= GW.VFXR（特效渲染层 · 画的一式）=================
   把 GW.VFX 每帧交出的数字摆成画面：一条配方的每一层 = 一个 THREE 对象（LineSegments 或 Points）。
   三家分界（改任何一家都不该惊动另外两家）：
     js/vfx.js          算：配方 → 每层数字（纯函数，零 THREE）
     js/vfx-recipes.js  数据：配方与绑定表（纯数据，零分支）
     本文件             画：数字 → 顶点缓冲。这里不认识"陨星阵"是什么，只认 prim 与参数。

   四条性能纪律（真机 160FPS 的口径，AGENTS 的手感不变量同类）：
     ① 每帧零分配：槽位（几何 + 属性 + mesh）按 kind 建池复用，容量不够才扩容；
        求值把上一帧的对象用 opts.out 传回去原地改写，避免每秒几万次 new 把 minor GC 扫进手感里。
     ② 材质共享：additive + vertexColors 的线条材质全局共享一份，点的材质按 size 分档缓存；
        颜色与亮度走顶点色，所以"几十层"不会变成几十个 draw state。
     ③ 硬预算：同时在场的槽位 ≤ MAX_SLOTS、单层顶点 ≤ MAX_VERTS、一次性事件 ≤ MAX_EVENTS，
        超了就少画一圈，绝不"这帧补完"——特效是观感，帧率是底线。
     ④ WebGL 的 line 恒为 1 像素，配方里的 w 读成**亮度**：光影层（js/shader.js）的选择性泛光
        会把亮线糊成有厚度的光带，这比塞几何体便宜一个数量级。

   零 DOM、零玩家可见文案（中文只在 js/hud.js）。
   权威状态只读不写：宿主→槽位的对应关系存在本文件的表里，实体上不留任何字段；
   摆位一律用 match.renderPos 的插值值，判定用的 e.pos 不进来（AGENTS 的插值不变量）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var V = G.VFX;
  if (!V) return;
  if (typeof THREE === 'undefined') { G.VFXR = { enabled: false, update: function () { }, attach: function () { }, detach: function () { }, stats: {} }; return; }

  var TAU = Math.PI * 2;
  var clamp = V.clamp, hash01 = V.hash01;

  /* 预算：一条配方最贵的是一圈 96 点 × 3 份平行线 = 576 顶点，1024 够装还留余量；
     槽位 300 是"同时在场的层数"，超出就少画一圈（宁缺不卡）。 */
  var MAX_SLOTS = 300, MAX_VERTS = 1024, MAX_EVENTS = 40;

  var pool = { line: [], point: [] };
  var liveSlots = 0;
  var recMap = [];                                        // 宿主 → 槽位组（不用 WeakMap：回收时要能遍历）
  var curHosts = [], prevHosts = [];
  var evPool = [], evLive = [];
  var colCache = {};
  var matLine = null, matPoint = null, matPointCache = null;
  var matUnder = null, matUnderCache = null;
  var ctx = null;
  var scratch = { uid: 0, born: 0, delay: 0, ttl: 1, radius: 1, preset: { kind: 'neutral' } };

  var R = G.VFXR = {
    enabled: true, attached: false, ownsSigils: true,
    stats: { live: 0, skipped: 0, vertsFrame: 0, frames: 0, events: 0, materials: 1, hosts: 0 }
  };

  /* 顶点色要交给 sRGB→Linear 换算再上传：renderer.outputEncoding = sRGBEncoding，
     three 在输出前会把线性色再编码回 sRGB，而材质顶点色按**线性**解释。
     直接塞 sRGB 数字等于把同一个颜色提亮两次——#ff7a45 的焰色最后画出来是白的，
     截图自查才发现（光影层那边 post_check 防的就是同一件事）。 */
  function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function rgbOf(hex) {
    var c = colCache[hex];
    if (c) return c;
    var s = String(hex || '#ffffff').replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var nv = parseInt(s, 16);
    if (!isFinite(nv)) nv = 0xffffff;
    /* 再加两道"看得清"的修正，都是对着截图调出来的：
       ① 饱和压强 pow(c,1.55)：additive 是"往上加"，草地本身就有 0.7 的绿，
          焰色 #ff7a45 那点绿分量加上去只会把线糊成黄白；先把非主色压干净。
       ② 主色上限 0.82：任何通道 >1 会被裁，三条一起裁就是白。留出加法的余量，
          泛光靠光影层去堆，不在这里预支。 */
    var rs = srgbToLinear(((nv >> 16) & 255) / 255), gs = srgbToLinear(((nv >> 8) & 255) / 255), bs = srgbToLinear((nv & 255) / 255);
    rs = Math.pow(rs, 1.55); gs = Math.pow(gs, 1.55); bs = Math.pow(bs, 1.55);
    var mx = Math.max(rs, gs, bs) || 1, k2 = mx > 0.95 ? 0.95 / mx : 1;
    return (colCache[hex] = [rs * k2, gs * k2, bs * k2]);
  }
  function ensureMaterials() {
    if (matLine) return;
    var common = { vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    matLine = new THREE.LineBasicMaterial(common);
    matLine.depthTest = true;
    matPoint = new THREE.PointsMaterial(common);
    matPoint.size = 0.12; matPoint.sizeAttenuation = true;
    matPointCache = { k0: matPoint };
    /* 暗底材质：additive 只会"往上加"，而这作的地面是亮草皮（绿通道本来就 0.7），
       一条焰色线加上去只会把画面推向黄白，读不成橙。所以在彩线下面先垫一层近黑的
       同形状描边把底色压掉，再让彩线加上来——同一个 BufferGeometry，只多一次绘制。
       （B 站指令法阵与铁魔法的贴图之所以清楚，是因为它们自带一圈暗描边，不是颜色更亮。） */
    matUnder = new THREE.LineBasicMaterial({ color: 0x0a0918, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    matUnderCache = {};
    R.stats.materials = 3;
  }
  function underMat(size) {
    var key = 'u' + Math.round(size * 60);
    if (!matUnderCache[key]) {
      var p = new THREE.PointsMaterial({ color: 0x0a0918, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true });
      p.size = Math.max(0.06, size * 2.3);
      matUnderCache[key] = p; R.stats.materials++;
    }
    return matUnderCache[key];
  }
  function pointMat(size) {
    var key = 's' + Math.round(size * 60);
    var m = matPointCache[key];
    if (!m) {
      m = matPointCache[key] = new THREE.PointsMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
      m.size = Math.max(0.035, size);
      R.stats.materials++;
    }
    return m;
  }
  function kindOf(L) {
    if (L.prim === 'glyphs' || L.prim === 'orbit' || L.prim === 'shards') return 'point';
    if (L.prim === 'ring' && L.style === 'dots') return 'point';
    return 'line';
  }

  /* ---------- 槽位池 ---------- */
  function acquire(kind) {
    if (liveSlots >= MAX_SLOTS) { R.stats.skipped++; return null; }
    var s = pool[kind].length ? pool[kind].pop() : null;
    if (!s) {
      s = { kind: kind, cap: 0, pos: null, col: null };
      s.geo = new THREE.BufferGeometry();
      s.obj = (kind === 'line') ? new THREE.LineSegments(s.geo, matLine) : new THREE.Points(s.geo, matPoint);
      s.under = (kind === 'line') ? new THREE.LineSegments(s.geo, matUnder) : new THREE.Points(s.geo, underMat(0.1));
      s.obj.frustumCulled = false;                              // 顶点每帧重写，别让它去猜包围盒
      s.under.frustumCulled = false;
      s.obj.renderOrder = 7; s.under.renderOrder = 6;           // 暗底先画，彩线后画
    }
    s.obj.visible = true;
    /* released 必须清掉：它是 release 的"别重复入库"闸门。
       不清的话，一个槽位第二次被回收时直接 return —— 既不进池子也不扣 liveSlots，
       实测跑一场大火后 liveSlots 一路涨到 300 上限，后面所有特效全被"预算跳过"吃掉
       （画面表现为：法阵越烧越少，最后什么都不画，而且没有任何报错）。 */
    s.released = false;
    liveSlots++;
    return s;
  }
  function release(s) {
    if (!s || s.released) return;
    s.released = true;
    s.obj.visible = false; s.under.visible = false;
    if (s.obj.parent) s.obj.parent.remove(s.obj);
    if (s.under.parent) s.under.parent.remove(s.under);
    pool[s.kind].push(s);
    liveSlots--;
  }
  function capacity(s, n) {
    if (n > MAX_VERTS) n = MAX_VERTS;
    if (s.cap >= n) return true;
    var cap = 64; while (cap < n && cap < MAX_VERTS) cap *= 2;
    s.pos = new Float32Array(cap * 3);
    s.col = new Float32Array(cap * 3);
    s.cap = cap;
    s.geo.setAttribute('position', new THREE.BufferAttribute(s.pos, 3).setUsage(THREE.DynamicDrawUsage));
    s.geo.setAttribute('color', new THREE.BufferAttribute(s.col, 3).setUsage(THREE.DynamicDrawUsage));
    return true;
  }
  function show(s, n) {
    s.geo.setDrawRange(0, n);
    s.geo.attributes.position.needsUpdate = true;
    s.geo.attributes.color.needsUpdate = true;
  }
  /* 真·线宽。WebGL 的 line 恒为 1 像素，"粗"只能是几何的事：把一条线段沿画面里的法向
     复制成 2~3 条平行线。份数按 w 分档（w 的默认值住在 js/vfx.js 的 CLASSES——
     用户 2026-10-16 报"法阵太小、线条太细、看不清"，那一层整体上抬过一档，这里才轮到执行它）。
     平面类（环 / 多边形 / 放射线 / 扫掠弧）在局部 XY 内偏；柱与旋涡在局部 XZ 内偏，
     因为它们的局部 Y 是高度，跟着偏火苗就歪了。 */
  /* 2026-10-17 用户："这些特效还是非常细的这种线，很不喜欢，希望像素化一点、粗一些"。
     WebGL 的 line 恒为 1 像素，唯一的"粗"是**多画几条平行带**：
     份数整体上调一档（2/3/4 条），间距也从 0.032 抬到 0.055（同屏叠起来才像一根笔触，而不是一层纱）。 */
  function passesOf(w) { return w >= 3.2 ? 4 : (w >= 1.6 ? 3 : (w >= 0.9 ? 2 : 1)); }
  function gapOf(L) { return clamp((L.w || 1) * 0.055, 0.03, 0.3); }
  /* 像素化：顶点按 1/8 格吸附（只在平面原子与球上做，柱/旋涡不吸附以免歪）。
     曲线因此变成一段段折线——这正是像素风"手画圆"的观感，比连续细线更像游戏。 */
  var PIX = 0.125;
  function snapPx(v) { return Math.round(v / PIX) * PIX; }
  function segXY(s, i, ax, ay, bx, by, ca, cb, ua, ub, mul, gap, passes) {
    var dx = bx - ax, dy = by - ay, dl = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / dl, ny = dx / dl, mid = (passes - 1) * 0.5, k = 0;
    for (var p = 0; p < passes; p++) {
      var o = (p - mid) * gap;
      k = put(s, i + k, ax + nx * o, ay + ny * o, 0, ca, cb, ua, mul) - i;
      k = put(s, i + k, bx + nx * o, by + ny * o, 0, ca, cb, ub, mul) - i;
    }
    return i + k;
  }
  function segXZ(s, i, ax, ay, az, bx, by, bz, ca, cb, ua, ub, mul, gap, passes) {
    var dx = bx - ax, dz = bz - az, dl = Math.sqrt(dx * dx + dz * dz);
    var nx = 1, nz = 0;
    if (dl > 1e-5) { nx = -dz / dl; nz = dx / dl; }
    var mid = (passes - 1) * 0.5, k = 0;
    for (var p = 0; p < passes; p++) {
      var o = (p - mid) * gap;
      k = put(s, i + k, ax + nx * o, ay, az + nz * o, ca, cb, ua, mul) - i;
      k = put(s, i + k, bx + nx * o, by, bz + nz * o, ca, cb, ub, mul) - i;
    }
    return i + k;
  }
  function put(s, i, x, y, z, ca, cb, u, mul) {
    var o = i * 3;
    s.pos[o] = x; s.pos[o + 1] = y; s.pos[o + 2] = z;
    s.col[o] = (ca[0] + (cb[0] - ca[0]) * u) * mul;
    s.col[o + 1] = (ca[1] + (cb[1] - ca[1]) * u) * mul;
    s.col[o + 2] = (ca[2] + (cb[2] - ca[2]) * u) * mul;
    return i + 1;
  }

  /* ---------- 摆位 ---------- */
  /* 摆位（2026-10-17 改成认矩阵）：计算层交出的每一叶都带
     · L.m  —— 3x3 旋转（已经含父链的继承：法针环绕、嵌套环都在里面）
     · L.px/py/pz —— 相对锚点的位移（同样来自父链）
     渲染层不再自己判断"平面还是立体""先躺平再自旋"——那些是坐标约定，归计算层。
     anchor==='body' 时把镜头的朝向乘在外面（跟随体要正对镜头）。 */
  var m4tmp = null;
  function place(s, L, x, y, z, anchor, camQ) {
    var o = s.obj;
    o.position.set(x + (L.px || 0), y + (L.py || 0), z + (L.pz || 0));
    var m = L.m;
    if (m) {
      if (!m4tmp) m4tmp = new THREE.Matrix4();
      m4tmp.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
      o.quaternion.setFromRotationMatrix(m4tmp);
    } else o.quaternion.set(0, 0, 0, 1);
    if (anchor === 'body' && camQ) o.quaternion.premultiply(camQ);
    if (!o.parent) ctx.group.add(o);
    /* 线宽：WebGL 的 line 恒为 1 像素，唯一的"变粗"办法是让暗底比彩线**大一点点**——
       同一份几何，暗底按局部平面方向放大 2~4%，视觉上就是一圈有厚度的描边（粗细分档按 w）。
       柱与旋涡的局部 Y 是高度，不参与放大，否则火苗会跟着变胖。 */
    var u = s.under;
    u.position.copy(o.position);
    u.quaternion.copy(o.quaternion);
    u.visible = o.visible;
    var e2 = 0.026 + 0.034 * (L.w || 1);
    if (L.prim === 'pillar' || L.prim === 'vortex') u.scale.set(1 + e2, 1, 1 + e2);
    else if (L.prim === 'glyphs' || L.prim === 'orbit' || (L.prim === 'ring' && L.style === 'dots')) u.scale.set(1, 1, 1);
    else u.scale.set(1 + e2, 1 + e2, 1);
    if (!u.parent) ctx.group.add(u);
  }

  /* ---------- 单层绘制 ---------- */
  function drawLayer(s, L, t, seed) {
    var ca = rgbOf(L.color), cb = rgbOf(L.color2 || L.color);
    /* 亮度上限锁 1.0：additive 混合下超过 1 的分量会被裁掉，
       而"裁"是把三种颜色一起往白推——#ff7a45 的焰色乘到 1.8 就变成淡黄白，
       一整圈阵看着像没上色（截图自查抓到的）。线宽读成亮度只能读"更亮一点点"，
       真正的厚度交给光影层的泛光去糊。 */
    var mul = clamp(L.alpha, 0, 1) * clamp(0.8 + 0.18 * (L.w || 1), 0.3, 1.5);
    if (mul <= 0.012) { s.obj.visible = false; return 0; }
    s.obj.visible = true;
    var verts = L.verts, cnt = L.count | 0, i = 0, k = 0, n = 0;
    switch (L.prim) {
      case 'ring':
        if (L.style === 'dots') {
          n = Math.min(cnt, MAX_VERTS); capacity(s, n);
          for (i = 0; i < n; i++) put(s, i, verts[i * 2] * L.r, verts[i * 2 + 1] * L.r, 0, ca, cb, i / n, mul);
          s.obj.material = pointMat(Math.max(0.1, (L.w || 1) * 0.1 * (L.radius || 1) * 0.26));
          s.under.material = underMat(s.obj.material.size);
          show(s, n);
        } else if (L.style === 'ticks') {
          var pt = passesOf(L.w), gap = gapOf(L);
          n = Math.min(cnt * 2 * pt, MAX_VERTS); capacity(s, n);
          var inner = L.r * (1 - 0.05 * (L.w || 1));
          i = 0;
          for (k = 0; k < cnt; k++) {
            var fl = L.flow ? (0.5 + 0.5 * Math.sin(k / cnt * 20 + t * L.flow)) : 1;
            var ni = segXY(s, i, verts[k * 2] * inner, verts[k * 2 + 1] * inner, verts[k * 2] * L.r, verts[k * 2 + 1] * L.r,
              ca, cb, k / cnt, k / cnt, mul * (0.35 + 0.65 * fl), gap, pt);
            if (ni >= n) { i = ni; break; }
            i = ni;
          }
          show(s, Math.min(i, n));
        } else {
          var ps = passesOf(L.w), gs = gapOf(L);
          n = Math.min(cnt * 2 * ps, MAX_VERTS); capacity(s, n);
          i = 0;
          for (k = 0; k < cnt; k++) {
            var a = k * 2, b = ((k + 1) % cnt) * 2;
            var nj = segXY(s, i, snapPx(verts[a] * L.r), snapPx(verts[a + 1] * L.r),
              snapPx(verts[b] * L.r), snapPx(verts[b + 1] * L.r),
              ca, cb, k / cnt, (k + 1) / cnt, mul, gs, ps);
            if (nj >= n) { i = nj; break; }
            i = nj;
          }
          show(s, Math.min(i, n));
        }
        break;
      case 'poly': {
        var m = verts.length / 2, pp = passesOf(L.w), gp = gapOf(L);
        n = Math.min((m - 1) * 2 * pp, MAX_VERTS); capacity(s, n);
        i = 0;
        for (k = 0; k + 1 < m; k++) {
          var ra = 1 + (L.spike ? L.spike * 0.3 * (k % 2) : 0);
          var rb = 1 + (L.spike ? L.spike * 0.3 * ((k + 1) % 2) : 0);
          var nk = segXY(s, i, verts[k * 2] * L.r * ra, verts[k * 2 + 1] * L.r * ra,
            verts[(k + 1) * 2] * L.r * rb, verts[(k + 1) * 2 + 1] * L.r * rb, ca, cb, k / m, (k + 1) / m, mul, gp, pp);
          if (nk >= n) { i = nk; break; }
          i = nk;
        }
        show(s, Math.min(i, n));
        break;
      }
      case 'spokes': {
        var psp = passesOf(L.w), gsp = gapOf(L);
        n = Math.min(cnt * 2 * psp, MAX_VERTS); capacity(s, n);
        var rIn = L.rIn === undefined ? 0.2 : L.rIn;
        i = 0;
        for (k = 0; k < cnt; k++) {
          var so = k * 4;
          var jx = L.jitter ? (hash01(seed, k * 3) - 0.5) * L.jitter * L.radius : 0;
          var jy = L.jitter ? (hash01(seed, k * 3 + 1) - 0.5) * L.jitter * L.radius : 0;
          var ns = segXY(s, i, verts[so] * rIn + jx, verts[so + 1] * rIn + jy,
            verts[so + 2] * L.rOut + jx, verts[so + 3] * L.rOut + jy, ca, cb, 0, 1, mul, gsp, psp);
          if (ns >= n) { i = ns; break; }
          i = ns;
        }
        show(s, Math.min(i, n));
        break;
      }
      case 'glyphs': {
        n = Math.min(cnt, MAX_VERTS); capacity(s, n);
        for (i = 0; i < n; i++) {
          var ga = i / cnt * TAU;
          var gl = (L.blink && hash01(seed, i * 7 + ((t * 3) | 0)) < L.blink) ? 0.22 : 1;
          put(s, i, Math.cos(ga) * L.r, Math.sin(ga) * L.r, 0, ca, cb, i / cnt, mul * gl);
        }
        s.obj.material = pointMat(Math.max(0.09, (L.size || 1) * 0.15));
        s.under.material = underMat(s.obj.material.size);
        show(s, n);
        break;
      }
      case 'orbit': {
        n = Math.min(cnt, MAX_VERTS); capacity(s, n);
        for (i = 0; i < n; i++) {
          var oa = (L.phase || 0) + i / cnt * TAU;
          put(s, i, Math.cos(oa) * L.r, Math.sin(oa) * L.r, 0, ca, cb, i / cnt, mul);
        }
        s.obj.material = pointMat(Math.max(0.09, (L.size || 0.1) * 1.0));
        s.under.material = underMat(s.obj.material.size);
        show(s, n);
        break;
      }
      case 'pillar': {
        var segs = 3, ppi = passesOf(L.w), gpi = gapOf(L);
        n = Math.min(cnt * segs * 2 * ppi, MAX_VERTS); capacity(s, n);
        var w2 = 0;
        for (k = 0; k < cnt; k++) {
          var pa = k / cnt * TAU;
          var px = Math.cos(pa) * (L.r || 0), pz = Math.sin(pa) * (L.r || 0);
          var crawl = L.rise ? ((t * L.rise * 0.3 + hash01(seed, k)) % 1) : 0;
          for (var sg = 0; sg < segs; sg++) {
            var f0 = (sg / segs + crawl) % 1, f1 = ((sg + 1) / segs + crawl) % 1;
            var shrink0 = 1 - (L.taper || 0) * f0;
            var fade0 = 1 - 0.55 * f0, fade1 = 1 - 0.55 * f1;
            /* 柱也按 w 变粗（在局部 XZ 里偏，Y 是高度不能偏），雷柱 / 火柱从一根线变成一束 */
            w2 = segXZ(s, w2, px * shrink0, f0 * (L.h || 2), pz * shrink0,
              px * (1 - (L.taper || 0) * f1), f1 * (L.h || 2), pz * (1 - (L.taper || 0) * f1),
              ca, cb, f0, f1, mul * Math.min(fade0, fade1), gpi, ppi);
            if (w2 >= n) break;
          }
          if (w2 >= n) break;
        }
        show(s, Math.min(w2, n));
        break;
      }
      case 'vortex': {
        var perRing = Math.min(20, Math.max(6, (L.count || 24) | 0));
        var pvo = passesOf(L.w), gvo = gapOf(L);
        n = Math.min(L.layers * perRing * 2 * pvo, MAX_VERTS); capacity(s, n);
        var v2 = 0;
        for (var lay = 0; lay < L.layers; lay++) {
          var fq = L.layers > 1 ? lay / (L.layers - 1) : 0;
          var rr = L.rTop + ((L.rBot || 0) - L.rTop) * fq;
          var yy = fq * (L.h || 1.2);
          var twist = lay * 0.4 + t * (L.spin || 0) * 0.3;
          for (var q2 = 0; q2 < perRing; q2++) {
            var a1 = q2 / perRing * TAU + twist, a2 = (q2 + 1) / perRing * TAU + twist;
            v2 = segXZ(s, v2, Math.cos(a1) * rr, yy, Math.sin(a1) * rr,
              Math.cos(a2) * rr, yy, Math.sin(a2) * rr, ca, cb, fq, fq, mul * (1 - fq * 0.4), gvo, pvo);
            if (v2 >= n) break;
          }
          if (v2 >= n) break;
        }
        show(s, v2);
        break;
      }
      /* ---------- 2026-10-17 新原子：dome（半球罩）/ helix（螺旋带）/ shards（碎屑云） ----------
         预算口径不变：单层仍守 MAX_VERTS / 1024，超了就地截断，宁缺不卡。 */
      case 'dome': {
        var latN = Math.max(1, L.count | 0), lonN = Math.max(3, L.lon | 0);
        var Rd = L.r, sqd = (L.squash === undefined ? .78 : L.squash);
        var pdd = passesOf(L.w), gdd = gapOf(L), segsD = 14, lonSegD = 7;
        n = Math.min((latN * segsD * 2 + lonN * lonSegD * 2) * pdd, MAX_VERTS); capacity(s, n);
        var wd = 0, kd, sd, jd;
        for (kd = 1; kd <= latN && wd < n; kd++) {
          var fd = kd / (latN + 1), yd = Rd * sqd * fd;
          var rdd = Rd * Math.sqrt(Math.max(0, 1 - fd * fd)), fadeD = 0.35 + 0.65 * fd;
          for (sd = 0; sd < segsD && wd < n; sd++) {
            var a1d = sd / segsD * TAU, a2d = (sd + 1) / segsD * TAU;
            wd = segXZ(s, wd, Math.cos(a1d) * rdd, yd, Math.sin(a1d) * rdd,
              Math.cos(a2d) * rdd, yd, Math.sin(a2d) * rdd, ca, cb, fd, fd, mul * fadeD, gdd, pdd);
          }
        }
        for (var md = 0; md < lonN && wd < n; md++) {
          var ad = md / lonN * TAU, cxd = Math.cos(ad), czd = Math.sin(ad);
          for (jd = 0; jd < lonSegD && wd < n; jd++) {
            var f0d = jd / lonSegD, f1d = (jd + 1) / lonSegD;
            var y0d = Rd * sqd * f0d, r0d = Rd * Math.sqrt(Math.max(0, 1 - f0d * f0d));
            var y1d = Rd * sqd * f1d, r1d = Rd * Math.sqrt(Math.max(0, 1 - f1d * f1d));
            wd = segXZ(s, wd, cxd * r0d, y0d, czd * r0d, cxd * r1d, y1d, czd * r1d,
              ca, cb, f0d, f1d, mul * (0.45 + 0.55 * f1d), gdd, pdd);
          }
        }
        show(s, Math.min(wd, n)); n = wd; break;
      }
      case 'helix': {
        var perH = Math.max(4, L.countPer | 0), strandsH = Math.max(1, Math.round((L.count | 0) / perH));
        var pdh = passesOf(L.w), gdh = gapOf(L), segsH = perH - 1;
        var turnsH = (L.turns === undefined ? 1.4 : L.turns), hH = (L.h || 2), tapH = (L.taper || 0);
        n = Math.min(strandsH * segsH * 2 * pdh, MAX_VERTS); capacity(s, n);
        var wh = 0;
        for (var sh = 0; sh < strandsH && wh < n; sh++) {
          var baseH = sh / strandsH * TAU + (L.phase || 0);
          for (var jh = 0; jh < segsH && wh < n; jh++) {
            var u0h = jh / segsH, u1h = (jh + 1) / segsH;
            var an0 = baseH + u0h * turnsH * TAU, an1 = baseH + u1h * turnsH * TAU;
            var r0h = L.r * (1 - tapH * u0h), r1h = L.r * (1 - tapH * u1h);
            wh = segXZ(s, wh, Math.cos(an0) * r0h, u0h * hH, Math.sin(an0) * r0h,
              Math.cos(an1) * r1h, u1h * hH, Math.sin(an1) * r1h,
              ca, cb, u0h, u1h, mul * (1 - 0.45 * u1h), gdh, pdh);
          }
        }
        show(s, Math.min(wh, n)); n = wh; break;
      }
      /* 球（2026-10-17）：**完整球体**，不是半罩。纬线从 -90° 到 +90° 均匀铺、经线从南极到北极，
         上下对称——用户报的"爆炸怎么只炸下面不炸上面"就是缺这一条（以前只有贴地的 dome）。 */
      case 'sphere': {
        /* 球体减量：纬线/经线各取"配方值的一半、但至少 3 条"。
           几十根经线叠在一起就是一坨线团（用户截图里那个大球），
           球的可读性靠**轮廓**，不靠密度。 */
        var latS = Math.max(3, Math.round((L.count | 0) * 0.6)), lonS = Math.max(4, Math.round((L.lon | 0) * 0.45));
        var Rs = L.r, segS = 10, lonSegS = 5;
        var pss = passesOf(L.w), gss = gapOf(L);
        n = Math.min((latS * segS * 2 + lonS * lonSegS * 2) * pss, MAX_VERTS); capacity(s, n);
        var ws = 0, kS, sS, lS, jS;
        for (kS = 1; kS < latS && ws < n; kS++) {
          var phiS = -Math.PI / 2 + Math.PI * kS / latS;
          var yS = Math.sin(phiS) * Rs, rS = Math.cos(phiS) * Rs;
          var fadeS = 0.45 + 0.55 * Math.abs(Math.sin(phiS));
          for (sS = 0; sS < segS && ws < n; sS++) {
            var b1 = sS / segS * TAU, b2 = (sS + 1) / segS * TAU;
            ws = segXZ(s, ws, Math.cos(b1) * rS, yS, Math.sin(b1) * rS,
              Math.cos(b2) * rS, yS, Math.sin(b2) * rS, ca, cb, kS / latS, kS / latS, mul * fadeS, gss, pss);
          }
        }
        for (lS = 0; lS < lonS && ws < n; lS++) {
          var angS = lS / lonS * TAU;
          for (jS = 0; jS < lonSegS && ws < n; jS++) {
            var ph0 = -Math.PI / 2 + Math.PI * jS / lonSegS, ph1 = -Math.PI / 2 + Math.PI * (jS + 1) / lonSegS;
            ws = segXZ(s, ws,
              Math.cos(angS) * Math.cos(ph0) * Rs, Math.sin(ph0) * Rs, Math.sin(angS) * Math.cos(ph0) * Rs,
              Math.cos(angS) * Math.cos(ph1) * Rs, Math.sin(ph1) * Rs, Math.sin(angS) * Math.cos(ph1) * Rs,
              ca, cb, jS / lonSegS, (jS + 1) / lonSegS, mul, gss, pss);
          }
        }
        show(s, Math.min(ws, n)); n = ws; break;
      }
      case 'shards': {
        n = Math.min(L.count | 0, MAX_VERTS); capacity(s, n);
        var grow = clamp(L.draw === undefined ? 1 : L.draw, 0, 1);
        var coreS = (L.core || 0);
        var rs = L.r * (coreS + (1 - coreS) * grow);
        var sqS = (L.squash === undefined ? .6 : L.squash);
        for (var ks = 0; ks < n; ks++) {
          var phS = hash01(seed, ks * 5 + 1) * TAU, ctS = hash01(seed, ks * 5 + 2) * 2 - 1;
          var rrS = rs * (0.35 + 0.65 * hash01(seed, ks * 5 + 3));
          var stS = Math.sqrt(Math.max(0, 1 - ctS * ctS));
          put(s, ks, Math.cos(phS) * stS * rrS, ctS * rrS * sqS, Math.sin(phS) * stS * rrS,
            ca, cb, hash01(seed, ks * 5 + 4), mul);
        }
        /* 2026-10-17：碎屑点的大小**不许**跟着事件半径线性长——核爆半径 14 格时
           0.8 × 14 × 0.55 = 6.3 世界单位一颗点，屏幕上是几块糊住视野的白方块（截图自查抓到的）。
           按半径开平方给一档温和的放大，再夹在 0.6 以内。 */
        var shSize = (L.size || 0.12) * Math.min(2.2, 0.5 + Math.sqrt(Math.max(0.2, L.radius || 1)) * 0.55);
        s.obj.material = pointMat(Math.max(0.045, Math.min(0.6, shSize)));
        s.under.material = underMat(s.obj.material.size);
        show(s, n); break;
      }
      default: {                                                    // sweep：一段从 a0 长到 a0+span 的弧
        var segs2 = 20, psw = passesOf(L.w), gsw = gapOf(L);
        n = Math.min(segs2 * 2 * psw, MAX_VERTS); capacity(s, n);
        var span = L.span === undefined ? 1.2 : L.span, a0 = L.a0 || 0;
        var growTo = clamp(L.draw === undefined ? 1 : L.draw, 0, 1);
        var wq = 0;
        for (var g2 = 0; g2 < segs2; g2++) {
          var u1 = g2 / segs2, u2 = (g2 + 1) / segs2;
          if (u1 >= growTo) break;
          var an1 = a0 + span * u1, an2 = a0 + span * Math.min(u2, growTo);
          wq = segXY(s, wq, Math.cos(an1) * L.r, Math.sin(an1) * L.r, Math.cos(an2) * L.r, Math.sin(an2) * L.r,
            ca, cb, u1, u2, mul, gsw, psw);
        }
        show(s, wq);
        n = wq;
        break;
      }
    }
    R.stats.vertsFrame += n;
    return n;
  }

  /* ---------- 宿主槽位组（对应关系只存在这张表里，实体上不留字段） ---------- */
  function recOf(host) {
    for (var i = 0; i < recMap.length; i++) if (recMap[i].host === host) return recMap[i];
    var r = { host: host, slots: [], out: null, recipe: null };
    recMap.push(r);
    return r;
  }
  function freeRec(r) {
    if (!r) return;
    for (var i = 0; i < r.slots.length; i++) release(r.slots[i]);
    r.slots.length = 0; r.out = null; r.recipe = null;
  }
  function dropRec(host) {
    for (var i = 0; i < recMap.length; i++) if (recMap[i].host === host) {
      freeRec(recMap[i]); recMap.splice(i, 1); return;
    }
  }

  /* 距离档（信息密度闸门的入口）：近处全细节、远处只留高权重的那几层。
     阈值用"格"量，和相机半径/法阵半径同一把尺子。 */
  function lodAt(x, y, z) {
    var c = ctx && ctx.camPos;
    if (!c) return 1;
    var dx = x - c.x, dy = y - c.y, dz = z - c.z;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return d < 14 ? 1 : (d < 30 ? 0.66 : 0.33);
  }
  function renderHost(host, o) {
    var f = V.frameOf(host, ctx.time, o.dt, o.role, { out: o.rec.out, recipe: o.recipe, radius: o.radius, born: o.born, delay: o.delay, ttl: o.ttl, lod: o.lod });
    o.rec.out = f;
    if (f.recipe !== o.rec.recipe) { freeRec(o.rec); o.rec.recipe = f.recipe; }
    if (!f.layers.length) return 0;
    for (var i = 0; i < f.layers.length; i++) {
      var L = f.layers[i], kind = kindOf(L);
      var s = o.rec.slots[i];
      if (!s || s.kind !== kind) { if (s) release(s); s = o.rec.slots[i] = acquire(kind); if (!s) continue; }
      var nn = drawLayer(s, L, ctx.time, f.seed);
      if (nn > 0) place(s, L, o.x, o.y, o.z, f.anchor, ctx.camQ);
      else s.obj.visible = false;
    }
    return f.layers.length;
  }

  /* ---------- 一次性事件 ---------- */
  function spawn(recipe, pos, ttl, radius, kind) {
    if (!recipe || !ctx || !ctx.group) return;
    var e = null;
    for (var i = 0; i < evPool.length; i++) if (!evPool[i].busy) { e = evPool[i]; break; }
    if (!e) {
      if (evPool.length >= MAX_EVENTS) { R.stats.skipped++; return; }
      e = { busy: true, rec: null, recipe: null, x: 0, y: 0, z: 0, t0: 0, ttl: 0.6, radius: 1, kind: 'neutral', uid: 0 };
      evPool.push(e);
    }
    e.busy = true;
    e.recipe = recipe; e.x = pos.x; e.y = pos.y; e.z = pos.z;
    e.t0 = ctx.time; e.ttl = ttl; e.radius = radius; e.kind = kind || 'neutral';
    e.uid = (e.uid + 1) | 0;
    if (!e.rec) e.rec = { slots: [], out: null, recipe: null };
    evLive.push(e);
    R.stats.events++;
  }
  function killEvent(e) {
    freeRec(e.rec); e.rec.out = null; e.rec.recipe = null;
    e.busy = false; e.recipe = null;
    var i = evLive.indexOf(e); if (i >= 0) evLive.splice(i, 1);
  }

  var subscribed = false;
  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    /* 权威层只报 key（见 battle.js / rules.js / chem.js），配方名一律从绑定表查 */
    V.on('cast', function (d) { spawn(V.defaultFor({ card: d.card, element: d.element }, 'cast'), d.pos, 0.55, 1.3, d.element); });
    V.on('hit', function (d) {
      var card = d.pr ? G.CARDS_BY_ID[d.pr.aiKind] : null;
      spawn(V.defaultFor({ card: card, element: d.pr && d.pr.element }, 'hit') || 'ev_hit', d.pos, 0.4, 0.75, d.kind);
    });
    V.on('impact', function (d) {
      var el = d.pr && d.pr.element, pe = (V.PROJECTILE_FX_EL || {})[el];
      spawn((pe && pe.impact) || 'impact_burst', d.pos, 0.5, 1.1, el);
    });
    /* 爆炸按**半径分档**：2.5 格的小爆用 impact_burst，陨星那一档（2.4+）用带碎屑的
       ev_meteor_impact，超新星（5+）直接把整屏推满。同一个事件通道，不新增事件名。 */
    V.on('explode', function (d) {
      var r = d.radius || 2.5;
      if (r >= 12) spawn('ev_nuke', d.pos, 1.5, r, d.kind);
      else if (r >= 5) spawn('ev_supernova', d.pos, 0.95, r, d.kind);
      else if (r >= 2.4) spawn('ev_meteor_impact', d.pos, 0.7, r, d.kind);
      else spawn('impact_burst', d.pos, 0.62, r, d.kind);
    });
    /* 终末落地：整屏一层核爆罩（独立事件，不借用 explode 的分档）。 */
    V.on('nuke', function (d) { spawn('ev_nuke', d.pos, 1.8, Math.max(6, (d.radius || 26) * 0.55), d.kind); });
    V.on('quake', function (d) { if (d && d.pos) spawn('ev_quake', d.pos, 0.85, 4.5, 'physical'); });
    /* 分节拍：第 0 拍小、第 1 拍中、最后一拍最大——同一个事件通道，不新增事件名。 */
    V.on('beat', function (d) {
      if (!d || !d.pos) return;
      var last = (d.i >= (d.n - 1));
      var rec = last ? 'ev_nuke' : (d.i === 0 ? 'impact_burst' : 'ev_meteor_impact');
      spawn(rec, d.pos, last ? 1.4 : 0.8, (d.radius || 3) * (last ? 0.55 : 1), d.kind);
    });
    V.on('sigilGo', function (d) { spawn('charge_up', d.pos, 0.8, d.radius || 2.5, d.kind); });
    V.on('sigilBreak', function (d) { spawn('ev_break', d.pos, 0.7, d.radius || 2.5, d.kind); });
    V.on('sigilEnd', function (d) { spawn('ev_cast', d.pos, 0.5, (d.radius || 2.5) * 0.8, d.kind); });
    V.on('react', function (d) {
      var r = V.chemFor(d.kind);
      if (!r) return;
      spawn(r, { x: d.x, y: d.y, z: d.z }, d.kind === 'steam' ? 0.9 : 0.6, d.kind === 'obsidian' ? 1.5 : 1.0, d.kind);
    });
  }

  /* ---------- 抛射物光弧（2026-10-17） ----------
     用户："追踪导弹直接直直走过去没意思，要各种特效粒子、很细小、画弧线"。
     拖尾配方只画得出"这一帧的样子"，画不出"它走过哪里"——弧线必须来自**轨迹史**。
     历史存在本文件自己的表里（实体上一个字段都不写，同 recMap 的纪律），
     每帧重画成一条渐隐折线；抛射物没了就回收槽位。 */
  var MAX_TRAILS = 26, TRAIL_PTS = 20;
  var trailPool = [], trailLive = [];
  function trailOf(pr) {
    for (var i = 0; i < trailLive.length; i++) if (trailLive[i].host === pr) return trailLive[i];
    if (trailLive.length >= MAX_TRAILS) return null;
    var t = trailPool.pop();
    if (!t) {
      var geo = new THREE.BufferGeometry();
      t = { host: null, geo: geo, pts: new Float32Array(TRAIL_PTS * 3), n: 0,
            pos: new Float32Array(TRAIL_PTS * 6), col: new Float32Array(TRAIL_PTS * 6) };
      geo.setAttribute('position', new THREE.BufferAttribute(t.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(t.col, 3).setUsage(THREE.DynamicDrawUsage));
      t.obj = new THREE.LineSegments(geo, matLine);
      t.under = new THREE.LineSegments(geo, matUnder);
      t.obj.frustumCulled = false; t.under.frustumCulled = false;
      t.obj.renderOrder = 7; t.under.renderOrder = 6;
    }
    t.host = pr; t.n = 0;
    t.obj.visible = true; t.under.visible = true;
    if (!t.obj.parent) ctx.group.add(t.obj);
    if (!t.under.parent) ctx.group.add(t.under);
    trailLive.push(t);
    return t;
  }
  function dropTrail(t) {
    t.obj.visible = false; t.under.visible = false;
    if (t.obj.parent) t.obj.parent.remove(t.obj);
    if (t.under.parent) t.under.parent.remove(t.under);
    t.host = null;
    var i = trailLive.indexOf(t); if (i >= 0) trailLive.splice(i, 1);
    trailPool.push(t);
  }
  function pushTrail(t, x, y, z) {
    if (t.n < TRAIL_PTS) {
      var o = t.n * 3; t.pts[o] = x; t.pts[o + 1] = y; t.pts[o + 2] = z; t.n++;
    } else {
      t.pts.copyWithin(0, 3);
      var e = (TRAIL_PTS - 1) * 3;
      t.pts[e] = x; t.pts[e + 1] = y; t.pts[e + 2] = z;
    }
  }
  function drawTrail(t, color) {
    var n = t.n;
    if (n < 2) { t.obj.visible = false; t.under.visible = false; return; }
    t.obj.visible = true; t.under.visible = true;
    var ca = rgbOf(color || '#ffffff'), k = 0, i, a, b, u0, u1, f0, f1, o;
    for (i = 0; i + 1 < n; i++) {
      a = i * 3; b = (i + 1) * 3;
      u0 = i / (n - 1); u1 = (i + 1) / (n - 1);
      f0 = Math.pow(u0, 1.6) * 0.95; f1 = Math.pow(u1, 1.6) * 0.95;
      o = k * 3;
      t.pos[o] = t.pts[a]; t.pos[o + 1] = t.pts[a + 1]; t.pos[o + 2] = t.pts[a + 2];
      t.col[o] = ca[0] * f0; t.col[o + 1] = ca[1] * f0; t.col[o + 2] = ca[2] * f0;
      o += 3;
      t.pos[o] = t.pts[b]; t.pos[o + 1] = t.pts[b + 1]; t.pos[o + 2] = t.pts[b + 2];
      t.col[o] = ca[0] * f1; t.col[o + 1] = ca[1] * f1; t.col[o + 2] = ca[2] * f1;
      k += 2;
    }
    t.geo.setDrawRange(0, k);
    t.geo.attributes.position.needsUpdate = true;
    t.geo.attributes.color.needsUpdate = true;
  }

  /* ---------- 每帧 ---------- */
  R.update = function (dt, time, alpha) {
    if (!R.enabled || !ctx || !ctx.group || !ctx.match) return;
    ctx.time = time;
    var cam = ctx.cameras ? ctx.cameras(0) : null;
    ctx.camQ = cam ? cam.quaternion : null;
    ctx.camPos = cam ? cam.position : null;   // lodAt 用；没有相机就退化成全细节
    var m = ctx.match, i, a;
    R.stats.vertsFrame = 0; R.stats.frames++;
    curHosts.length = 0;
    var al = (alpha === undefined || alpha === null) ? 1 : alpha;

    for (i = 0; i < m.sigils.length; i++) {                        // 地面法阵：贴地、半径用阵法自己的
      var sg = m.sigils[i];
      if (!sg.preset || !sg.preset.fx) continue;
      curHosts.push(sg);
      /* 视觉半径比判定半径大 28%：阵是给人看的仪式，判定圈是另一个东西。
         宁可"看起来宽一点、边缘那点也照样挨打"，反过来（圈画得比判定小）会让玩家
         觉得"我明明站在阵外面怎么被冻了"——这类两套数各说各话的坑 AGENTS 里已经记过准星一次。 */
      renderHost(sg, { dt: dt, role: 'loop', recipe: sg.preset.fx, radius: sg.radius * 1.45, born: sg.born, delay: sg.delay, ttl: sg.ttl, lod: lodAt(sg.pos.x, sg.pos.y, sg.pos.z), x: sg.pos.x, y: sg.pos.y + 0.04, z: sg.pos.z, rec: recOf(sg) });
    }
    for (i = 0; i < m.projectiles.length; i++) {                   // 抛射物拖尾：小、跟插值位置
      var pr = m.projectiles[i];
      curHosts.push(pr);
      var rp = m.renderPos(pr, al, ctx.tmp);
      renderHost(pr, { dt: dt, role: 'trail', radius: 0.4, born: pr.born, delay: 0, ttl: 6, lod: lodAt(rp.x, rp.y, rp.z), x: rp.x, y: rp.y, z: rp.z, rec: recOf(pr) });
      /* 光弧：每帧往轨迹史里塞一个点。桥钉（paint）不画，免得把桥面糊住。 */
      if (!pr.paint) {
        var tr = trailOf(pr);
        if (tr) { pushTrail(tr, rp.x, rp.y, rp.z); drawTrail(tr, pr.color); }
      }
    }
    /* 已经落地的抛射物：把它的光弧还池子（不回收会一直挂在最后那个点上） */
    for (i = trailLive.length - 1; i >= 0; i--) {
      if (m.projectiles.indexOf(trailLive[i].host) < 0) dropTrail(trailLive[i]);
    }
    for (i = 0; i < m.summons.length; i++) {                       // 随从光环：贴脚底
      var su = m.summons[i];
      if (!su.alive) continue;
      curHosts.push(su);
      var rp2 = m.renderPos(su, al, ctx.tmp);
      scratch.kind = 'summon';
      /* 地面随从的光环贴脚底；飞行随从（su.fly，权威层给的行为标记）挂**身体中心**——
         贴脚底会落在它脚下 2~3 格的空气里，看着像地上有圈别的什么东西。 */
      renderHost(su, { dt: dt, role: 'aura', radius: su.fly ? 1.15 : 0.8, born: su.born, delay: 0, ttl: 6,
                       lod: lodAt(rp2.x, rp2.y, rp2.z),
                       x: rp2.x, y: su.fly ? rp2.y : rp2.y - su.h / 2 + 0.06, z: rp2.z, rec: recOf(su) });
      /* 召唤物的**运动光弧**（用户："召唤的轨迹不好看"）：飞行的、以及在跑的，都留一条渐隐光带。
         走的是与抛射物同一套轨迹史；颜色取它自己的弹道元素（boltEl 是权威字段，渲染层只读）。 */
      if (su.fly || Math.hypot(su.vel.x, su.vel.z) > 1.2) {
        var st = trailOf(su);
        if (st) {
          pushTrail(st, rp2.x, su.fly ? rp2.y : rp2.y - su.h / 2 + 0.1, rp2.z);
          drawTrail(st, (G.ELEMENTS[su.boltEl] || {}).color || '#c58cff');
        }
      }
    }
    for (i = 0; i < m.players.length; i++) {                       // 玩家脚下的跟随阵
      var p = m.players[i];
      if (!p.alive) continue;
      curHosts.push(p);
      var rp3 = m.renderPos(p, al, ctx.tmp);
      renderHost(p, { dt: dt, role: 'loop', radius: 1.0, born: 0, delay: 0, ttl: 1e6, lod: lodAt(rp3.x, rp3.y, rp3.z), x: rp3.x, y: rp3.y - p.h / 2 + 0.05, z: rp3.z, rec: recOf(p) });
    }
    /* 回收：上一帧在、这一帧不在的宿主（法阵到期 / 抛射物落地 / 随从消散）把槽位还池子。
       对应关系全在本文件的表里，实体上没有任何渲染字段。 */
    for (i = 0; i < prevHosts.length; i++) if (curHosts.indexOf(prevHosts[i]) < 0) dropRec(prevHosts[i]);
    var sw = prevHosts; prevHosts = curHosts; curHosts = sw;

    for (i = evLive.length - 1; i >= 0; i--) {                     // 一次性事件
      var e = evLive[i];
      if (time - e.t0 > e.ttl) { killEvent(e); continue; }
      scratch.uid = e.uid; scratch.born = e.t0; scratch.delay = 0; scratch.ttl = e.ttl;
      scratch.radius = e.radius; scratch.preset.kind = e.kind;
      var f = V.frame(scratch, time, dt, { recipe: e.recipe, out: e.rec.out, lod: lodAt(e.x, e.y, e.z) });
      e.rec.out = f;
      if (f.recipe !== e.rec.recipe) { freeRec(e.rec); e.rec.recipe = f.recipe; }
      for (var q = 0; q < f.layers.length; q++) {
        var L = f.layers[q], kind = kindOf(L);
        var s = e.rec.slots[q];
        if (!s || s.kind !== kind) { if (s) release(s); s = e.rec.slots[q] = acquire(kind); if (!s) continue; }
        var nn = drawLayer(s, L, time, f.seed);
        if (nn > 0) place(s, L, e.x, e.y, e.z, f.anchor, ctx.camQ);
        else s.obj.visible = false;
      }
    }
    R.stats.live = liveSlots;
    R.stats.hosts = recMap.length;
  };

  R.attach = function (c) {
    ensureMaterials();
    subscribe();
    ctx = c;
    ctx.tmp = G.V ? new G.V(0, 0, 0) : { x: 0, y: 0, z: 0 };
    ctx.time = 0;
    R.attached = true;
    return R;
  };
  R.detach = function () {
    for (var ti2 = trailLive.length - 1; ti2 >= 0; ti2--) dropTrail(trailLive[ti2]);
    for (var i = evLive.length - 1; i >= 0; i--) killEvent(evLive[i]);
    for (var k = 0; k < recMap.length; k++) freeRec(recMap[k]);
    recMap.length = 0; prevHosts.length = 0; curHosts.length = 0;
    R.attached = false;
  };
  R.reset = function () { R.detach(); R.attached = true; };
  R.enabled_ = function () { return R.enabled; };
})(window.GW);
