#!/usr/bin/env node
/* tools/atmos_check.cjs · 大气层回归（开发工具，index.html 不引用）

   这一层最容易骗自己的地方是"天看起来本来就该这样"。所以每条判据都落成数得出来的像素或数得出来的状态：

     1  关掉大气层 == 现状：另开一份把 index.html 里本层三行 script 剥掉的页面当基线，比校验和与分档亮度。
        （比的是**没装过大气的这份代码**，不是"上一次的我"）
     2  接管成功、几何在预算内（天穹 / 星 / 云影布 / 降水各自顶点数）
     3  白天看得见太阳：瞄准太阳 → 亮核像素达标；skyK=0 → 亮核必须消失
     4  夜里看得见星星、白天看不见；关掉 stars 后夜里归零
     5  月亮：满月亮面积 > 朔月；满月时月亮在地平线上（这条抓出过"月亮仰角抄太阳、夜里必在地下"）
     6  云：storm 天区比 clear 暗、且有纹理方差——抓出过"阈值写成 cov 本身，storm 一朵云都没有"
     7  云影：同机位开/关，地面区必须变暗，且 spec.sheetVisible 跟着走
     8  降水：storm 有雨、snow 换成雪、关掉开关归零、相机埋到屋顶下也不下
     9  闪电：外部注册的钩子真收到广播 + 天气层 bolts > 0 + 闪的那一帧天区更亮
     10 分区天气：定点 force 后"这头是 rain、那头不是"
     11 交互词表反查：WEATHERS[*].mods ⊆ MODS 且每个预设填满 MODS；flags ⊆ FLAGS；未知旗标 → 0；转移表不指向空穴
     12 确定性：同种子重放 400 tick，天气逐字段相同
     13 预算：单步推进的区数 ≤ budget.perStep
     14 开销：开/关大气的渲染提交时间比（SwiftShader 只当趋势下界，真机另测）
     15 交回老通路：把 G.ATMOS.frame 换成恒返回 false 后，画面与基线校验和一致（main.js 的 dayNight 仍在跑）

   测量口径（三条坑，改判据前先读）：
     · 采帧一律**先冻结主循环**（S.running=false）再用固定 dt 手动驱动 cam + 天空，
       否则两个页面各自跑了几个 tick、chem 点了几格火，像素永远对不齐（AGENTS 里相机测抖动同一条教训）。
     · __camPose 会清空输入源，AI 因此不会在"摆好→截图"之间改地形。
     · 云影/降水的亮度只量**地面档**（18%~55% 高度），天区亮度只量 62%~100%，
       免得 HUD 面板（顶部两块 + 底部牌库）的像素混进判据里。

   用法：node tools/atmos_check.cjs [seed] [--shots 目录]
   退出码：0 全过；1 判据不过；2 环境错误。 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const seed = +(argv.find(a => /^\d+$/.test(a)) || 490706);
const si = argv.indexOf('--shots');
const SHOTS = si >= 0 ? path.resolve(argv[si + 1] || '/tmp/gwat') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const { createRequire } = require('module'); const req = createRequire(__filename);
let PW = null;
for (const c of ['playwright', 'playwright-core', '$(npm root -g)/playwright', '$(npm root -g)/playwright-core']) { try { PW = req(c); break; } catch (e) { } }
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };
function stripAtmos(html) {
  return html.replace(/<!--[^\n]*大气层三层[^\n]*-->\n?/g, '')
    .replace(/<script src="js\/(atmos-data|weather|atmos)\.js"><\/script>\n?/g, '');
}
const srv = http.createServer((q, rsp) => {
  let rel = decodeURIComponent(q.url.split('?')[0]);
  const base = /(^|\/)BASE\//.test(rel);
  if (base) rel = rel.replace(/(^|\/)BASE\//, '/');
  const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
  fs.readFile(fp, (e, b) => {
    if (e) { rsp.writeHead(404).end('nf'); return; }
    let body = b;
    if (base && /index\.html$/.test(fp)) body = Buffer.from(stripAtmos(b.toString('utf8')), 'utf8');
    rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  });
});

/* ==================== 页内函数 ==================== */
const APPLY = async (cfg) => {
  const G = window.GW, S = window.GWAPP, d = window.__dbg;
  if (!S.match || cfg.restart) window.__GW_START({ mode: 'train', seed: cfg.seed, deck: 'starter' });
  /* 必须在开局之后再问"这层活着吗"：WEATHER.ready 是 bind() 之后才 true 的，
     先问会得到 false，于是第一枪跳过了所有参数设置——等于把"关掉"那一枪拍成了开着。 */
  const hasAtmos = !!(G.ATMOS && G.WEATHER && G.WEATHER.ready);
  /* 机位：干地上"有代表性的高点"——不是最高点。
     取最高点会踩到树尖或世界顶上的柱子（96×40×96 那版地图上实测站到 y=39 的一根尖上），
     于是云影布在脚下 20 格以外、月亮与星星的取样全废，一堆判据一起变红，看着像大气的错、其实是量错了地方。
     camGroundY 跳过树叶（树冠不是地板），只留 sea 以上的干地；取 90 分位 = 看得见远处又不挂在尖上。 */
  function vantage() {
    const w = S.world, sea = w.sea === undefined ? 0 : w.sea, EYE = 2.2, R = 46;
    function ground(x, z) {                              // 干地且头顶没有叶子（camGroundY 跳过树冠）
      const g = w.camGroundY(x, z);
      if (g <= sea) return -1;
      return w.surfaceY(x, z) === g ? g : -1;
    }
    /* 周围一片都是干地：影布与雨只画在地面上，站在海岸边时下半屏全是海面
       （水上那部分影布按 waterY 沉进海床）⇒ 开/关只差 0.04% 像素，看着像功能没生效。 */
    function inland(x, z, y) {
      let land = 0, n = 0;
      for (let dz = -4; dz <= 4; dz += 4) for (let dx = -4; dx <= 4; dx += 4) {
        const g = w.camGroundY(Math.min(w.SX - 1, Math.max(0, x + dx)), Math.min(w.SZ - 1, Math.max(0, z + dz)));
        n++; if (g > sea + 2 && g >= y - 4) land++;
      }
      return land >= Math.ceil(n * 0.75);
    }
    /* 天顶 + 四方位 20° 仰角都没有遮挡：站在林子里或山坳里时"天区"根本不是天，
       星星数出来 2 个、日月圆盘"画不出来"、云"没盖上"——九成长虹都出在这种取景上。 */
    function openSky(x, z, y) {
      const o = { x: x + 0.5, y: y + EYE, z: z + 0.5 };
      const dirs = [[0, 1, 0], [1, 0.36, 0], [-1, 0.36, 0], [0, 0.36, 1], [0, 0.36, -1]];
      for (let i = 0; i < dirs.length; i++) {
        const dd = dirs[i], len = Math.sqrt(dd[0] * dd[0] + dd[1] * dd[1] + dd[2] * dd[2]);
        if (w.lineBlocked(o, { x: o.x + dd[0] / len * R, y: o.y + dd[1] / len * R, z: o.z + dd[2] / len * R })) return false;
      }
      return true;
    }
    /* 从最高的干地往下找第一个过关的：不取"最高点"是因为它会站到树尖/世界顶上的柱子上，
       也不取"某个分位数"——那等于赌地图长什么样，而地图尺寸这段时间已经被并行会话改过两次。 */
    const cand = [];
    for (let z = 5; z < w.SZ - 5; z++) for (let x = 5; x < w.SX - 5; x++) {
      const y = ground(x, z);
      if (y > 0) cand.push({ x: x, z: z, y: y });
    }
    if (!cand.length) return { x: Math.floor(w.SX / 2), z: Math.floor(w.SZ / 2), y: sea + 1 };
    cand.sort((a, b) => (b.y - a.y) || (a.z - b.z) || (a.x - b.x));
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      if (inland(c.x, c.z, c.y) && openSky(c.x, c.z, c.y)) return c;
      if (i > 1500) break;
    }
    return cand[0];
  }

  const st = vantage();
  let aimErr = null;
  /* 高度一律交给游戏自己的落位逻辑（__camPose 不给 y 时按 camGroundY + 身高/2 放）：
     自己写 st.y + 2.2 是拿"方块索引"当"面"，实测人只离地 1.2 格 ⇒ 云影布（地面 +1 +lift）反而盖在头顶，
     从它下面往上看时"天区"其实是一片影布——太阳圆盘、星星、月相、影布四条判据一起变红，全是这 1 格的账。 */
  const y = cfg.y;                                       // 只有"埋进屋里"那条判据需要显式给高度
  window.__camPose({ x: st.x + 0.5, z: st.z + 0.5, y: y, yaw: cfg.yaw === undefined ? 0.79 : cfg.yaw, pitch: cfg.pitch === undefined ? 0.3 : cfg.pitch, mode: 'shoulder' });
  if (hasAtmos) {
    G.ATMOS.reset();                      // 参数 + 动画积分量一起归零：同一 cfg 必须得到同一份像素
    for (const k in (cfg.params || {})) G.ATMOS.set(k, cfg.params[k]);
    /* 天气也重新播种：区里的过渡进度与随机流都是累加量，不 bind 一次就没法跨 shot 复现 */
    G.WEATHER.bind(S.world, { seed: cfg.seed });
    G.WEATHER.force(cfg.weather || 'clear', { intensity: cfg.intensity === undefined ? 1 : cfg.intensity });
    for (let i = 0; i < (cfg.ticks || 900); i++) G.WEATHER.step(1 / 20);      // 过渡 8~20s：直接推权威 tick，不在渲染帧里干等
  }
  if (cfg.dayT !== undefined) {
    {
      let frac = cfg.dayT;
      if (cfg.moon !== undefined && G.ATMOS) {
        /* 月龄由 dayCount 推出来（age = dayCount/cycle + phaseStart mod 1），而 night 又要求 phase = frac(dayT/dayLen)
           固定 ⇒ 只能挑"小数部分是 frac、而月龄最接近目标"的那一个游戏日：在 n 里搜最小者。 */
        const cyc = G.ATMOS.data.MOON.cycleDays, ps = G.ATMOS.data.MOON.phaseStart;
        let best = 0, bd = 9;
        for (let n = 0; n <= Math.ceil(cyc * 6); n++) {
          let a = ((n + frac) / cyc + ps) % 1;
          let dd = Math.abs(a - cfg.moon); dd = Math.min(dd, 1 - dd);
          if (dd < bd) { bd = dd; best = n; }
        }
        if (bd > 0.06) throw new Error('找不到月龄 ' + cfg.moon + ' 对应的游戏日（偏差 ' + bd.toFixed(3) + '）：cycleDays/phaseStart 与 dayT 撞不开');
        frac = best + cfg.dayT;
      }
      S.match.dayT = frac * (S.match.dayLen || 120);
    }
  }
  /* 冻结主循环再用固定 dt 手动驱动：两个页面才可能拿到同一份画面。
     用 S.frozen 而不是 S.running=false —— 后者会让菜单的公告牌循环（spin 判 !S.running）接管渲染，
     截出来的是那三块浮岛而不是这一局。 */
  S.frozen = true;
  const DT = 1 / 60;
  const drive = (n) => {
    const pl = S.match.players[0];
    const view = { pos: pl.pos, yaw: pl.yaw, pitch: pl.pitch };
    for (let i = 0; i < n; i++) { if (S.cams[0]) S.cams[0].update(view, S.world, DT, null); d.skyTick(DT); }
  };
  /* 先跑一小段把 sunDir/moonDir 算出来，再把镜头对准天体，最后长距离泵帧：
     相机的 pitch 是平滑跟随量（几十帧只走到一半），瞄准之后不泵够就"没对准却说自己对准了"。 */
  drive(70);
  if (cfg.aim && hasAtmos) {
    const dd = cfg.aim === 'moon' ? G.ATMOS.moonDir({}) : G.ATMOS.sunDir({});
    const tgt = new THREE.Vector3(dd.x, dd.y, dd.z).normalize();
    const cl1 = (v) => Math.max(-1, Math.min(1, v));
    /* 越肩相机的构图走 lookAt："名义 pitch/yaw"与屏幕真实朝向差几度（实测 4°，比太阳圆盘的 1.55° 半径还大）。
       照名义值摆位就得到"准星正对太阳却看不见圆盘"的假红 ⇒ 按相机真实朝向闭环，量的是 getWorldDirection。 */
    let yaw = Math.atan2(dd.x, dd.z), pitch = Math.asin(cl1(dd.y));
    for (let round = 0; round < 5; round++) {
      /* 瞄准天体用第一人称：越肩的构图会把法师自己（袍子/法杖/肩上那张牌）摆进画面中央，
         实测把准星处的太阳压成 lum 97——那不是"圆盘没画"，是量到了自己身上。 */
      window.__camPose({ x: st.x + 0.5, z: st.z + 0.5, y: y, yaw: yaw, pitch: pitch, mode: cfg.aimMode || 'first' });
      drive(round < 4 ? 40 : (cfg.settle === undefined ? 200 : cfg.settle));
      const f = new THREE.Vector3();
      S.cams[0].cam.getWorldDirection(f);
      f.normalize();
      let dAz = Math.atan2(tgt.x, tgt.z) - Math.atan2(f.x, f.z);
      while (dAz > Math.PI) dAz -= Math.PI * 2;
      while (dAz < -Math.PI) dAz += Math.PI * 2;
      yaw += dAz;
      pitch = Math.max(-1.5, Math.min(1.5, pitch + (Math.asin(cl1(tgt.y)) - Math.asin(cl1(f.y)))));
      aimErr = +(Math.acos(cl1(f.dot(tgt))) * 180 / Math.PI).toFixed(2);
    }
  } else drive(cfg.settle === undefined ? 220 : cfg.settle);
  /* 云影那条判据要把"参数没生效"与"这块几何根本没画"分开：把 uAmt 开满、uDark 涂黑，
     地面若还是一片亮，就带着这份状态自检一起报回来（blend/visible/drawRange/贴图就绪/Y 区间）。 */
  let sheetProbe = null;
  if (hasAtmos && (cfg.forceSheet || cfg.probe)) {
    const sh = d.scene.getObjectByName('gw-sheet');
    if (sh) {
      const pa = sh.geometry.attributes.position.array;
      let ymin = 1e9, ymax = -1e9;
      for (let i = 1; i < pa.length; i += 3) { if (pa[i] < ymin) ymin = pa[i]; if (pa[i] > ymax) ymax = pa[i]; }
      sheetProbe = { found: true, ymin: +ymin.toFixed(2), ymax: +ymax.toFixed(2), camY: +(S.cams[0] ? S.cams[0].pos.y : -1).toFixed(2),
                     visible: sh.visible, inScene: !!sh.parent, blending: sh.material.blending,
                     transparent: sh.material.transparent, depthTest: sh.material.depthTest,
                     renderOrder: sh.renderOrder, drawRange: sh.geometry.drawRange.count,
                     matName: sh.material.type, texReady: !!(sh.material.uniforms.uCloudTex.value && sh.material.uniforms.uCloudTex.value.image) };
      const tex = sh.material.uniforms.uCloudTex.value;
      if (tex && tex.image) {
        const c2 = document.createElement('canvas'); c2.width = c2.height = 64;
        const g2 = c2.getContext('2d');
        g2.drawImage(tex.image, 0, 0, 64, 64);
        const dd = g2.getImageData(0, 0, 64, 64).data;
        const acc = [0, 0, 0, 0], mx = [0, 0, 0, 0];
        for (let i = 0; i < dd.length; i += 4) for (let k = 0; k < 4; k++) { acc[k] += dd[i + k]; if (dd[i + k] > mx[k]) mx[k] = dd[i + k]; }
        sheetProbe.texMean = acc.map(v => +(v / (dd.length / 4)).toFixed(1));
        sheetProbe.texMax = mx;
      }
      if (cfg.forceSheet) {
        /* 两个方向一起钉死：uSel 取 (0,0,0,1) = 贴图的 A 通道（写死 255）⇒ 噪声必定满值，
           uDark 涂黑 + uAmt 开满 ⇒ 地面必须塌下去。还不动就是"这块几何根本没画"，
           而不是"噪声贴图没数据"（后者由下面的通道直方图分辨）。 */
        const u = sh.material.uniforms;
        u.uAmt.value = 1; u.uDark.value.setRGB(0, 0, 0); u.uSel.value.set(0, 0, 0, 1);
        if (cfg.brightSheet) u.uDark.value.setRGB(3, 3, 3);   // 反相探针：把画到的地方刷白，好一眼看出"到底画到了哪"
        if (cfg.sheetFlatY !== undefined) {
          const pa2 = sh.geometry.attributes.position.array;
          for (let k = 1; k < pa2.length; k += 3) pa2[k] = cfg.sheetFlatY;
          sh.geometry.attributes.position.needsUpdate = true;
        }
      }
    } else sheetProbe = { found: false };
  }
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  /* headless 下新开的页面偶尔量到 innerWidth=0（canvas 因此 0×0），显式回写一次再采 */
  const vw = window.innerWidth || 1000, vh = window.innerHeight || 600;
  d.renderer.setSize(vw, vh);
  d.renderer.setRenderTarget(null);
  async function grab() {                                 // 同一次求值里可以抓多份：云影开/关要逐像素配对
    let gg = null, gw = 0, gh = 0;
    for (let tries = 0; tries < 14; tries++) {              // headless 里 drawingBuffer 要等合成器分配：重试而不是等 rAF
      G.SHADER.renderScene(d.renderer, d.scene, S.cams[0].cam, 0, 0, vw, vh);
      gg = d.renderer.getContext(); gg.finish();
      gw = gg.drawingBufferWidth; gh = gg.drawingBufferHeight;
      if (gw > 0 && gh > 0) break;
      await nap(60);
    }
    const b = new Uint8Array(gw * gh * 4);
    gg.readPixels(0, 0, gw, gh, gg.RGBA, gg.UNSIGNED_BYTE, b);
    return { buf: b, w: gw, h: gh };
  }
  function stats(fr, y0, y1, x0, x1) {
    const buf = fr.buf, w = fr.w, h = fr.h;
    const a = Math.floor(h * (1 - y1)), b = Math.floor(h * (1 - y0));
    const xa = Math.floor(w * (x0 === undefined ? 0 : x0)), xb = Math.floor(w * (x1 === undefined ? 1 : x1));
    let sr = 0, sg = 0, sb = 0, n = 0, lum = 0, lum2 = 0, bright = 0, core = 0, mx = 0;
    for (let yy = a; yy < b; yy++) for (let xx = xa; xx < xb; xx++) {
      const i = (yy * w + xx) * 4, R = buf[i], Gc = buf[i + 1], B = buf[i + 2];
      const L = 0.299 * R + 0.587 * Gc + 0.114 * B;
      sr += R; sg += Gc; sb += B; lum += L; lum2 += L * L; n++;
      if (L > 186) bright++; if (L > 236) core++; if (L > mx) mx = L;
    }
    const m = lum / n;
    return { mean: [+(sr / n).toFixed(1), +(sg / n).toFixed(1), +(sb / n).toFixed(1)], lum: +m.toFixed(2),
             sd: +Math.sqrt(Math.max(0, lum2 / n - m * m)).toFixed(2), bright: bright, core: core, max: mx };
  }
  const fr = await grab();
  function band(y0, y1, x0, x1) { return stats(fr, y0, y1, x0, x1); }
  /* 云影的"生效"判据（同 vfx_live 的同机位开/关像素差分）：整块地面的平均亮度会被树冠、
     雾、群系盖住，量平均数永远说不清；逐像素配对才分得清"画了但被挡住"与"根本没画"。 */
  const pairOf = async (obj) => {
    const was = obj.visible;
    obj.visible = false; const a = await grab();
    obj.visible = true; const b = await grab();
    obj.visible = was;
    let n = 0, changed = 0, sum = 0;
    const A = b.buf, B = a.buf, w2 = b.w, h2 = b.h;
    for (let yy = 0; yy < h2; yy++) for (let xx = 0; xx < w2; xx++) {
      const i = (yy * w2 + xx) * 4;
      const La = 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2];
      const Lb = 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2];
      n++; if (Math.abs(La - Lb) > 6) changed++; sum += (Lb - La);
    }
    return { pixels: n, changed: changed, changedPct: +(100 * changed / Math.max(1, n)).toFixed(2), meanDelta: +(sum / Math.max(1, n)).toFixed(2) };
  };
  let cloudPair = null;
  if (cfg.cloudPair && hasAtmos) {
    const dome = d.scene.getObjectByName('gw-dome');
    if (dome) {
      const la = dome.material.uniforms.uLA.value;
      const keep = [la[0].w, la[1].w, la[2].w];
      la[0].w = la[1].w = la[2].w = 0;
      const cf = await grab();                                       // 云全清：只留天空自己
      la[0].w = keep[0]; la[1].w = keep[1]; la[2].w = keep[2];
      const cn = await grab();                                       // 云照常
      let n = 0, changed = 0, drop = 0;
      const A = cn.buf, B = cf.buf, w2 = cn.w, h2 = cn.h;
      for (let yy = Math.floor(h2 * 0.62); yy < h2; yy++) for (let xx = 0; xx < w2; xx++) {
        const i = (yy * w2 + xx) * 4;
        const La = 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2];
        const Lb = 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2];
        n++; if (Math.abs(La - Lb) > 6) changed++; drop += (Lb - La);
      }
      cloudPair = { pixels: n, changed: changed, changedPct: +(100 * changed / Math.max(1, n)).toFixed(2),
                    meanDrop: +(drop / Math.max(1, n)).toFixed(2) };
    }
  }
  let precipPair = null;
  if (cfg.precipPair && hasAtmos) {
    const dp = d.scene.getObjectByName('gw-precip');
    if (!dp) fails_precip_missing(dp);
    else precipPair = await pairOf(dp);
  }
  function fails_precip_missing() { precipPair = null; }
  let shadowPair = null;
  if (cfg.shadowPair && hasAtmos) {
    const sh2 = d.scene.getObjectByName('gw-sheet');
    if (sh2) {
      const was = sh2.visible;
      sh2.visible = false; const offFr = await grab();
      sh2.visible = was; const onFr = await grab();
      sh2.visible = was;
      const A = onFr.buf, B = offFr.buf, w2 = onFr.w, h2 = onFr.h;
      const ra = Math.floor(h2 * (1 - 0.52)), rb = Math.floor(h2 * (1 - 0.05));
      let n = 0, changed = 0, darkened = 0, drop = 0;
      for (let yy = ra; yy < rb; yy++) for (let xx = 0; xx < w2; xx++) {
        const i = (yy * w2 + xx) * 4;
        const La = 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2];
        const Lb = 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2];
        n++; if (Math.abs(La - Lb) > 6) changed++; if (Lb - La > 8) darkened++; drop += (Lb - La);
      }
      shadowPair = { pixels: n, changed: changed, darkened: darkened,
                     changedPct: +(100 * changed / Math.max(1, n)).toFixed(2),
                     meanDrop: +(drop / Math.max(1, n)).toFixed(2) };
    }
  }
  let sum = 0;
  for (let i = 0; i < fr.buf.length; i += 4) sum = (sum + fr.buf[i] * 3 + fr.buf[i + 1] * 5 + fr.buf[i + 2] * 7) % 2147483647;
  /* 世界指纹：冻结前跑了若干 tick，用抽样格子的方块校验和确认两个页面是同一张地图 */
  let wh = 0;
  for (let z = 0; z < S.world.SZ; z += 3) for (let x = 0; x < S.world.SX; x += 3) wh = (wh * 31 + S.world.colTop(x, z)) % 2147483647;
  return {
    tag: cfg.tag, sum: sum, worldHash: wh, sky: band(0.62, 1.0), ground: band(0.16, 0.52), all: band(0.0, 1.0),
    center: band(0.44, 0.56, 0.44, 0.56), corner: band(0.44, 0.56, 0.02, 0.14),
    spec: hasAtmos ? G.ATMOS.spec() : null, readout: hasAtmos ? G.ATMOS.readout() : null,
    hasAtmos: hasAtmos, stepErrors: S.stepErrors || 0, lastError: S.lastError || null,
    aim: (function () {
      if (!hasAtmos || !S.cams[0]) return null;
      const cam = S.cams[0].cam, v = new THREE.Vector3();
      cam.getWorldDirection(v);
      const sd = G.ATMOS.sunDir({}), md = G.ATMOS.moonDir({});
      const ang = (a, b) => +(Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI).toFixed(2);
      const scr = (dd) => { const p = new THREE.Vector3(dd.x, dd.y, dd.z).project(cam); return [+(p.x * 0.5 + 0.5).toFixed(3), +(-p.y * 0.5 + 0.5).toFixed(3)]; };
      return { sunErr: ang(v, sd), moonErr: ang(v, md), sunScreen: scr(sd), moonScreen: scr(md), closed: aimErr, vw: vw, vh: vh };
    })(),
    sheetProbe: sheetProbe, shadowPair: shadowPair, precipPair: precipPair, cloudPair: cloudPair,
    diag: { w: fr.w, h: fr.h, inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio,
            cw: d.renderer.domElement.width, ch: d.renderer.domElement.height,
            calls: d.renderer.info.render.calls, tris: d.renderer.info.render.triangles,
            bg: d.scene.background ? 'texture' : 'null', match: !!S.match, post: G.SHADER.enabled(),
            camY: +(S.cams[0] ? S.cams[0].pos.y : -1).toFixed(2), stand: st.x + ',' + st.z + ',' + st.y }
  };
};
const BUDGET = () => {
  const G = window.GW;
  for (let i = 0; i < 200; i++) G.WEATHER.step(1 / 20);
  return G.WEATHER.spec();
};
/* 天球转动：星星、银河、太阳必须一起绕同一根天极同向同率转。
   肉眼看不出 15°/小时的反向，也看不出"星点在银河上滑"——所以量小时角（绕天极的角度），它在刚体转动下线性增长。 */
const SKYTRACK = () => {
  const G = window.GW, S = window.GWAPP, d = window.__dbg;
  const pts = d.scene.getObjectByName('gw-stars'), dome = d.scene.getObjectByName('gw-dome');
  if (!pts || !dome) return { found: false };
  const sk = G.ATMOS.spec().sky;
  const pole = new THREE.Vector3(sk.pole[0], sk.pole[1], sk.pole[2]).normalize();
  let e1 = new THREE.Vector3(0, 1, 0).cross(pole);
  if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
  e1.normalize();
  const e2 = pole.clone().cross(e1).normalize();
  const ha = (v) => Math.atan2(v.dot(e2), v.dot(e1));
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const PICK = [0, 337, 991, 1500];
  const dup = d.scene.children.filter(c => c.name === 'gw-stars').length;
  const specQ = G.ATMOS.spec().sky.quat, objQ = [pts.quaternion.x, pts.quaternion.y, pts.quaternion.z, pts.quaternion.w].map(v => +v.toFixed(4));
  /* 上一枪可能把大气层关着（15 条就是这么用的）：那时 frame() 直接返回 false，
     skyRot 与被画的星图都停在旧值 ⇒ 三个 Δ 全是 0，而"同号"在 0==0 上还是真 ⇒ 假绿。 */
  G.ATMOS.set('on', true);
  G.ATMOS.set('stars', true);
  const at = (ph) => {
    S.match.dayT = ph * (S.match.dayLen || 120);
    for (let i = 0; i < 8; i++) d.skyTick(1 / 60);
    /* 每次都按名字重新拿：质量档变化会重建星点几何，握着旧引用量到的是"不会转的化石" */
    const pts2 = d.scene.getObjectByName('gw-stars') || pts;
    pts2.updateMatrixWorld(true);
    const stars = PICK.map(k => {
      const v = new THREE.Vector3().fromBufferAttribute(pts2.geometry.attributes.position, k);
      pts2.localToWorld(v); return v.normalize();
    });
    const g = (d.scene.getObjectByName('gw-dome') || dome).material.uniforms.uGalAxis.value.clone().normalize();
    const sd = G.ATMOS.sunDir({}), md = G.ATMOS.moonDir({});
    return { stars: stars.map(v => ha(v)), gal: ha(g), sun: ha(new THREE.Vector3(sd.x, sd.y, sd.z)),
             moon: ha(new THREE.Vector3(md.x, md.y, md.z)),
             sep: stars.length > 1 ? Math.acos(Math.max(-1, Math.min(1, stars[0].dot(stars[1])))) : 0,
             rot: G.ATMOS.spec().sky.rot };
  };
  const a = at(0.80), b = at(0.86);
  const dStar = wrap(b.stars[0] - a.stars[0]), dGal = wrap(b.gal - a.gal), dSun = wrap(b.sun - a.sun);
  const want = Math.PI * 2 * 0.06 * (G.ATMOS.data.STARS.rotateK === undefined ? 1 : G.ATMOS.data.STARS.rotateK);
  return {
    found: true, dup: dup, specQ: specQ, objQ: objQ, rotNow: G.ATMOS.spec().sky.rot,
    poleY: +pole.y.toFixed(4), latSin: +Math.sin(G.ATMOS.data.ORBIT.latitudeDeg * Math.PI / 180).toFixed(4),
    dStar: +dStar.toFixed(5), dGal: +dGal.toFixed(5), dSun: +dSun.toFixed(5), want: +want.toFixed(5),
    sameSign: Math.sign(dStar) === Math.sign(dSun), rateOk: Math.abs(Math.abs(dStar) - Math.abs(want)) < Math.abs(want) * 0.06,
    galWithStars: Math.abs(wrap(dGal - dStar)) < 1e-3,
    rigid: Math.abs(b.sep - a.sep) < 1e-4, starSet: b.stars.map(x => +x.toFixed(4))
  };
};
const REPLAY = (sd) => {
  const G = window.GW;
  function run() {
    const w = new G.World({ size: [64, 36, 64], seed: sd, lodes: true }); w.generate();
    G.WEATHER.bind(w, { seed: sd });
    for (let i = 0; i < 400; i++) G.WEATHER.step(1 / 20);
    return JSON.stringify(G.WEATHER.regions().map(r => [r.index, r.id, r.prev, +r.t.toFixed(6), +r.cover.toFixed(6), +r.windX.toFixed(6), +r.windZ.toFixed(6), +r.rate.toFixed(6)]));
  }
  const a = run(), b = run();
  return { same: a === b, len: a.length };
};
const REGIONAL = () => {
  const G = window.GW, w = window.GWAPP.world;
  G.WEATHER.release();
  G.WEATHER.force('clear', { intensity: 1 });
  for (let i = 0; i < 400; i++) G.WEATHER.step(1 / 20);
  const ax = 6, az = 6, bx = w.SX - 7, bz = w.SZ - 7;
  const r = G.WEATHER.force('rain', { x: ax, z: az, radius: G.ATMOS_DATA.REGIONS.cell * 1.2, intensity: 1 });
  for (let i = 0; i < 400; i++) G.WEATHER.step(1 / 20);
  const sa = G.WEATHER.at(ax, az), sb = G.WEATHER.at(bx, bz);
  return { ok: r.ok, here: sa.id, hereCover: +sa.v.cover.toFixed(3), there: sb.id, thereCover: +sb.v.cover.toFixed(3),
           regions: G.WEATHER.spec().regions, cell: G.WEATHER.spec().cell };
};
const VOCAB = () => {
  const D = window.GW.ATMOS_DATA, bad = { modsExtra: [], modsMissing: [], flagsExtra: [], presetless: [] };
  for (const id in D.WEATHERS) {
    const p = D.WEATHERS[id], mk = p.mods || {};
    for (const k in mk) if (D.MODS.indexOf(k) < 0) bad.modsExtra.push(id + '.' + k);
    for (const k of D.MODS) if (!(k in mk)) bad.modsMissing.push(id + '.' + k);
    for (const f of (p.flags || [])) if (D.FLAGS.indexOf(f) < 0) bad.flagsExtra.push(id + '.' + f);
    if (!D.TRANSITIONS[id]) bad.presetless.push('无转移行:' + id);
  }
  for (const from in D.TRANSITIONS) { if (!D.WEATHERS[from]) bad.presetless.push('孤儿行:' + from); for (const to in D.TRANSITIONS[from]) if (!D.WEATHERS[to]) bad.presetless.push(from + '→' + to); }
  bad.unknownFlag = window.GW.WEATHER.FLAG('绝对不存在的旗标');
  bad.modsCount = D.MODS.length; bad.flagCount = D.FLAGS.length; bad.presetCount = Object.keys(D.WEATHERS).length;
  return bad;
};
const HOOKTEST = () => {
  const G = window.GW;
  window.__hk = 0;
  if (!window.__hkOn) { G.WEATHER_HOOKS.onLightning.push(() => { window.__hk++; }); window.__hkOn = 1; }
  G.WEATHER.force('storm', { intensity: 1 });
  for (let i = 0; i < 4000; i++) G.WEATHER.step(1 / 20);
  return { count: window.__hk, bolts: G.WEATHER.spec().bolts };
};
const COST = () => {
  const G = window.GW, S = window.GWAPP, d = window.__dbg;
  const one = () => { G.SHADER.renderScene(d.renderer, d.scene, S.cams[0].cam, 0, 0, window.innerWidth, window.innerHeight); d.renderer.getContext().finish(); };
  G.ATMOS.set('on', false); for (let i = 0; i < 6; i++) one();
  const t0 = performance.now(); for (let i = 0; i < 16; i++) one(); const offMs = (performance.now() - t0) / 16;
  G.ATMOS.set('on', true);
  const step = () => { const p = S.match.players[0]; S.cams[0].update({ pos: p.pos, yaw: p.yaw, pitch: p.pitch }, S.world, 1 / 60, null); G.ATMOS.frame(1 / 60); };
  for (let i = 0; i < 6; i++) { step(); one(); }
  const t1 = performance.now(); for (let i = 0; i < 16; i++) { step(); one(); } const onMs = (performance.now() - t1) / 16;
  /* draw call / 三角形：renderer.info 每 render() 一次就自复位，只留下最后一道 blit（1 次 2 三角形）——
     那样量出来的"多画了多少"永远是 0。关掉 autoReset，自己在一整帧前后复位。 */
  const info = d.renderer.info;
  info.autoReset = false;
  /* 一整帧（场景 + 后处理链）计一次：autoReset 必须在 fn 之前关掉、读完再开回来，
     否则第二次量到的只剩最后那道 blit（1 次 2 三角形），"多画了多少"永远是 0。 */
  const count = (fn) => { info.autoReset = false; info.reset(); fn();
    const r = { calls: info.render.calls, tris: info.render.triangles }; info.autoReset = true; return r; };
  const on = count(() => { G.ATMOS.set('on', true); G.ATMOS.frame(1 / 60); one(); });
  const off = count(() => { G.ATMOS.set('on', false); d.skyTick(1 / 60); one(); });
  info.autoReset = true;
  return { offMs: +offMs.toFixed(2), onMs: +onMs.toFixed(2), ratio: +(onMs / Math.max(0.01, offMs)).toFixed(2),
           callsOn: on.calls, callsOff: off.calls, trisOn: on.tris, trisOff: off.tris };
};

/* ==================== 场景表（--shots 用；同时也是判据的取样条件） ==================== */
const SC = {
  off:        { tag: 'off', weather: 'clear', dayT: 0.25, params: { on: false } },
  baseline:   { tag: 'baseline', weather: 'clear', dayT: 0.25 },
  day:        { tag: 'day', weather: 'clear', dayT: 0.25, pitch: 0.30 },
  sun:        { tag: 'sun', weather: 'clear', dayT: 0.25, pitch: 0.30, aim: 'sun' },
  sundim:     { tag: 'sundim', weather: 'clear', dayT: 0.25, pitch: 0.30, aim: 'sun', params: { skyK: 0.4 } },
  sunbright:  { tag: 'sunbright', weather: 'clear', dayT: 0.25, pitch: 0.30, aim: 'sun', params: { skyK: 1.6 } },
  sunset:     { tag: 'sunset', weather: 'fair', dayT: 0.49, pitch: 0.10 },
  dusk:       { tag: 'dusk', weather: 'clear', dayT: 0.56, pitch: 0.12 },
  night:      { tag: 'night', weather: 'clear', dayT: 0.85, pitch: 0.55 },
  nostars:    { tag: 'nostars', weather: 'clear', dayT: 0.85, pitch: 0.55, params: { stars: false } },
  moonfull:   { tag: 'moonfull', weather: 'clear', dayT: 0.85, pitch: 0.3, moon: 0.5, aim: 'moon' },
  moonnew:    { tag: 'moonnew', weather: 'clear', dayT: 0.85, pitch: 0.3, moon: 0.0, aim: 'moon' },
  clearC:     { tag: 'clearC', weather: 'clear', dayT: 0.25, pitch: 0.5 },
  overcastC:  { tag: 'overcastC', weather: 'overcast', dayT: 0.25, pitch: 0.5 },
  stormC:     { tag: 'stormC', weather: 'storm', dayT: 0.25, pitch: 0.5 },
  fogC:       { tag: 'fogC', weather: 'fog', dayT: 0.25, pitch: 0.5 },
  shadowOn:   { tag: 'shadowOn', weather: 'fair', dayT: 0.25, pitch: -0.45 },
  shadowOff:  { tag: 'shadowOff', weather: 'fair', dayT: 0.25, pitch: -0.45, params: { cloudShadow: false } },
  rain:       { tag: 'rain', weather: 'storm', dayT: 0.25, pitch: -0.06 },
  snow:       { tag: 'snow', weather: 'snow', dayT: 0.3, pitch: -0.06 },
  hail:       { tag: 'hail', weather: 'hail', dayT: 0.3, pitch: -0.06 },
  nopr:       { tag: 'nopr', weather: 'storm', dayT: 0.25, pitch: -0.06, params: { precip: false } },
  nightstorm: { tag: 'nightstorm', weather: 'storm', dayT: 0.85, pitch: 0.3 },
  low:        { tag: 'low', weather: 'storm', dayT: 0.25, pitch: 0.3, params: { quality: 'low' } },
  follow:     { tag: 'follow', weather: 'clear', dayT: 0.42, pitch: 0.2, params: { followSun: true } }
};

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await PW.chromium.launch({});
  const errs = [];
  async function open(url) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errs.push('console: ' + m.text());
      /* 本层"建立失败"只 warn 不抛（对玩家的礼貌），所以要把它捞回来，否则只剩 broken=true 猜不出原因 */
      else if (m.type() === 'warning' && /\[大气\]/.test(m.text())) errs.push('大气层: ' + m.text());
    });
    await page.goto(url);
    await page.waitForFunction(() => window.GWAPP && window.__GW_START && window.__dbg && window.__dbg.skyTick, null, { timeout: 60000 });
    return page;
  }
  const warm = () => new Promise(res => setTimeout(res, 120));
  const pBase = await open('http://127.0.0.1:' + port + '/BASE/index.html?cb=' + Math.random().toString(36).slice(2));
  /* headless 里被遮挡 / 没合成过的页面，canvas 的 drawingBuffer 可能是 0×0：前置 + 落一张图强制合成一次 */
  await pBase.bringToFront();
  await pBase.screenshot({ type: 'png' });
  await pBase.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await warm();
  const base = await pBase.evaluate(APPLY, Object.assign({ seed: seed }, SC.baseline));
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'zz-baseline.png'), await pBase.screenshot({ type: 'png' }));
  const p = await open('http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2));
  await p.bringToFront();
  await p.screenshot({ type: 'png' });
  const shot = async (key, over) => {
    const cfg = Object.assign({ seed: seed }, SC[key], over || {});
    const r = await p.evaluate(APPLY, cfg);
    /* 瞄准已经在 APPLY 里做完（量测与截图必须同一份画面）；这里只为 --shots 重画一次再抓屏 */
    if (SHOTS) {
      await p.evaluate(() => {
        const d = window.__dbg, G = window.GW, S = window.GWAPP;
        d.renderer.setRenderTarget(null);
        G.SHADER.renderScene(d.renderer, d.scene, S.cams[0].cam, 0, 0, window.innerWidth, window.innerHeight);
      });
      fs.writeFileSync(path.join(SHOTS, (cfg.suffix ? key + cfg.suffix : key) + '.png'), await p.screenshot({ type: 'png' }));
    }
    return r;
  };
  const fails = [];
  const out = { pass: false, seed: seed };

  /* 1 关掉 == 现状 */
  const off = await shot('off');
  out.baseDiag = base.diag; out.offDiag = off.diag;
  out['1_off_eq_baseline'] = { sumEq: off.sum === base.sum, offSum: off.sum, baseSum: base.sum,
    worldHashEq: off.worldHash === base.worldHash, offLum: off.all.lum, baseLum: base.all.lum,
    skyLum: off.sky.lum, baseSkyLum: base.sky.lum };
  if (!off.hasAtmos) fails.push('主页面里大气层没加载（hasAtmos=false）⇒ 接线断了');
  if (base.hasAtmos) fails.push('基线页里大气层仍在 ⇒ index.html 的三行 script 没被剥掉');
  if (off.worldHash !== base.worldHash) fails.push('两个页面的地图指纹不同（' + off.worldHash + ' vs ' + base.worldHash + '）：冻结前跑过的 tick 数不一样，像素比对不可信');
  if (!off.sum === base.sum) { /* 下面统一判 */ }
  if (off.sum !== base.sum) fails.push('关掉大气层与"没有大气的这份代码"画面不同（校验和 ' + off.sum + ' vs ' + base.sum + '；整屏亮度 ' + off.all.lum + ' vs ' + base.all.lum + '）');

  /* 2 接管 + 预算 */
  const day = await shot('day');
  const sp = day.spec || {};
  out['2_takeover'] = { ready: sp.ready, broken: sp.broken, domeVerts: sp.domeVerts, starVerts: sp.starVerts, sheetVerts: sp.sheetVerts, quality: sp.quality };
  if (!sp.ready || sp.broken) fails.push('大气层没建立（ready=' + sp.ready + ' broken=' + sp.broken + '）');
  if (!(sp.domeVerts > 200 && sp.domeVerts < 4000)) fails.push('天穹顶点数 ' + sp.domeVerts + ' 不在预算内');
  if (!(sp.starVerts > 300)) fails.push('星点几何缺失（' + sp.starVerts + '）');
  if (!(sp.sheetVerts > 100)) fails.push('云影布没有几何体');

  /* 3 太阳 */
  const sun = await shot('sun'), sundim = await shot('sundim'), sunbig = await shot('sunbright');
  const cAt = (x) => x.center.lum, cAway = (x) => x.corner.lum;
  /* 先钉"准星真的对着天体"，再谈"圆盘画没画"：闭环没收敛时下面所有亮度判据量的都是别处 */
  if (!(sun.aim && sun.aim.closed !== null && sun.aim.closed < 1.2))
    fails.push('闭环瞄准之后准星仍偏离太阳 ' + (sun.aim && sun.aim.closed) + '° → 下面这些亮度判据测的不是准星上那张盘');
  out['3_sun'] = { centerLum: cAt(sun), awayLum: cAway(sun), max: sun.sky.max, el: sun.readout && sun.readout.sunElevation,
                   discK: sun.spec.params && sun.spec.params.skyK,
                   discKDim: sundim.spec.params.skyK, discKBig: sunbig.spec.params.skyK,
                   centerDim: cAt(sundim), centerBig: cAt(sunbig) };
  if (!(cAt(sun) >= cAway(sun) + 6)) fails.push('准星正对太阳（仰角 ' + out['3_sun'].el + '°）却不比画面边角亮（中心 ' + cAt(sun) + ' vs 边角 ' + cAway(sun) + '）→ 圆盘没画出来');
  if (!(sun.center.max >= 250)) fails.push('对准太阳时中心最亮只有 ' + sun.center.max + ' → 圆盘不够亮，bloom 捞不到它');
  if (!(cAt(sundim) <= cAt(sunbig) + 0.5)) fails.push('skyK 调大反而不更亮（dim ' + cAt(sundim) + ' vs big ' + cAt(sunbig) + '）→ 太阳亮度不受参数控制');

  /* 4 星星 */
  const night = await shot('night'), nostars = await shot('nostars');
  out['4_stars'] = { nightBright: night.sky.bright, nightSd: night.sky.sd, offBright: nostars.sky.bright, dayBright: day.sky.bright, visible: night.spec && night.spec.starsVisible };
  if (!(night.sky.bright > 20)) fails.push('晴天夜里天区亮像素只 ' + night.sky.bright + ' → 看不见星空');
  if (!(nostars.sky.bright < Math.max(6, night.sky.bright * 0.4))) fails.push('关掉 stars 后天区仍亮 ' + nostars.sky.bright + '（那些像素不是星星，判据会被它骗）');
  const dayStars = await shot('day');
  const dayNoStars = await shot('nostars', { dayT: 0.25, pitch: 0.30 });
  out['4b_dayStarsHidden'] = { sumOn: dayStars.sum, sumOff: dayNoStars.sum, identical: dayStars.sum === dayNoStars.sum };
  if (dayStars.sum !== dayNoStars.sum) fails.push('白天 toggle stars 开关画面会变（' + dayStars.sum + ' vs ' + dayNoStars.sum + '）→ 星星白天没被 uNight 关掉，白昼天里混着星点');

  /* 5 月亮 */
  const mf = await shot('moonfull'), mn = await shot('moonnew');
  out['5_moon'] = { fullCore: mf.sky.core, fullBright: mf.sky.bright, newCore: mn.sky.core, el: mf.readout && mf.readout.moonElevation, age: mf.readout && mf.readout.moonAge, newAge: mn.readout && mn.readout.moonAge };
  if (!(mf.readout && mf.readout.moonElevation > 5)) fails.push('满月时月亮仰角 ' + (mf.readout && mf.readout.moonElevation) + '° ⇒ 午夜月亮不在天上（轨道模型错）');
  out['5b_moonUniform'] = { moonKFull: mf.spec.params && mf.spec.params.moon, centerFull: mf.center.lum, centerNew: mn.center.lum, awayFull: mf.corner.lum,
                            aimErr: mf.aim && mf.aim.closed };
  if (!(mf.aim && mf.aim.closed !== null && mf.aim.closed < 1.2))
    fails.push('闭环瞄准之后准星仍偏离月亮 ' + (mf.aim && mf.aim.closed) + '° → 月亮那两条判据作数不了');
  if (!(mf.center.lum >= mf.corner.lum + 5)) fails.push('准星正对满月却不比边角亮（中心 ' + mf.center.lum + ' vs 边角 ' + mf.corner.lum + '）→ 月亮没画出来');
  if (!(mn.center.lum <= mf.center.lum - 3)) fails.push('朔月的中心亮度没比满月暗（new ' + mn.center.lum + ' vs full ' + mf.center.lum + '）→ 明暗界线不跟月龄走');

  /* 6 云 */
  const cc = await shot('clearC'), oc = await shot('overcastC'), st = await shot('stormC'), fog = await shot('fogC');
  out['6_clouds'] = { clearLum: cc.sky.lum, clearSd: cc.sky.sd, ocLum: oc.sky.lum, ocSd: oc.sky.sd, stormLum: st.sky.lum, stormSd: st.sky.sd, cov: [cc.readout.cover, oc.readout.cover, st.readout.cover] };
  if (!(st.sky.lum < cc.sky.lum * 0.92)) fails.push('storm 天区亮度 ' + st.sky.lum + ' 没比 clear（' + cc.sky.lum + '）暗 → 云没盖上');
  if (!(oc.sky.sd > 2.5)) fails.push('阴天天区标准差只 ' + oc.sky.sd + ' → 云是纯色、没有纹理');
  if (!(cc.readout.cover < 0.2 && st.readout.cover > 0.8)) fails.push('云量与预设对不上（clear ' + cc.readout.cover + ' / storm ' + st.readout.cover + '）');
  /* 阴天同一机位把云关掉：天空的"结构"必须掉下来。这条是抓"云其实没画、只是整片蒙了一层灰"的——
     平均亮度会跟着 uTint 变，光看亮度与天气对比永远看不出云有没有形状。 */
  /* 云到底有没有"画上"：同一帧里把三层的云量清 0 再抓一张，数天区被改动的像素比例。
     先前十几条判据都是用"标准差必须变大"卡的，结果把真画上去的云判成红——
     云是大块结构，它把天空自己那条亮带盖平了，sd 反而**变小**（31.6 → 30.0）。
     平均数同样会骗人：蒙一层灰也能让平均数动 13。只有逐像素配对说得清。 */
  const ocPair = await shot('overcastC', { cloudPair: true });
  const stPair = await shot('stormC', { cloudPair: true });
  out['6b_cloudPixels'] = { overcast: ocPair.cloudPair, storm: stPair.cloudPair };
  const needPair = (p, min, who) => {
    if (!p) { fails.push(who + '：拿不到云层的开/关配对帧（gw-dome 找不到）→ 无法证明云上天了'); return; }
    if (!(p.changedPct >= min)) fails.push(who + '：开/关云层只改了天区 ' + p.changedPct + '% 的像素（需 ≥' + min + '%）→ 云没画上或淡到看不见');
  };
  needPair(ocPair.cloudPair, 15, '阴天');
  needPair(stPair.cloudPair, 22, '暴风雨');
  if (!(fog.ground.lum > 0)) fails.push('雾场景取不到地面样本');

  /* 7 云影 */
  const sOn = await shot('shadowOn', { shadowPair: true }), sOff = await shot('shadowOff');
  out['7_shadow'] = { on: sOn.ground.lum, off: sOff.ground.lum, sheetOn: sOn.spec.sheetVisible, sheetOff: sOff.spec.sheetVisible,
                      verts: sOn.spec.sheetVerts, pair: sOn.shadowPair };
  if (!sOn.spec.sheetVisible) fails.push('白天 + 有云时云影布不该是隐藏的');
  if (sOff.spec.sheetVisible) fails.push('关掉 cloudShadow 后云影布仍在画');
  const pr = sOn.shadowPair;
  if (!pr) fails.push('拿不到云影开/关的配对帧（场景里没有 gw-sheet）→ 这块几何根本没建进场景');
  else {
    /* 阈值口径：影布是 2 格网格的大片阴影，掠射时会被树冠与雾吃掉一部分，
       但"生效"至少要在下半屏留下 3% 的像素变化，且其中多数是变暗（不是变亮）。 */
    if (!(pr.changedPct >= 3)) fails.push('云影开/关在下半屏只改了 ' + pr.changedPct + '% 的像素（' + pr.changed + '/' + pr.pixels + '）→ 影布基本没画（blending/probe=' + JSON.stringify(sOn.sheetProbe) + '）');
    if (!(pr.darkened >= pr.changed * 0.6)) fails.push('云影改动的像素里多数不是变暗（darkened ' + pr.darkened + ' / changed ' + pr.changed + '）→ 画成了加亮');
    if (!(pr.meanDrop > 0.15)) fails.push('云影的平均压暗只有 ' + pr.meanDrop + '（应 >0.15）→ 幅度小到看不见，查 shadow.contrast / peakCover');
  }
  const sForce = await shot('shadowOn', { forceSheet: true });
  const sBright = await shot('shadowOn', { forceSheet: true, brightSheet: true });
  out['7b_force'] = { forced: sForce.ground.lum, off: sOff.ground.lum, brightCore: sBright.ground.core, probe: sForce.sheetProbe };

  /* 8 降水 */
  const rn = await shot('rain', { precipPair: true }), sn = await shot('snow'), hl = await shot('hail'), npr = await shot('nopr');
  out['8_precip'] = { rain: rn.spec.dropsLive, rainKind: rn.spec.dropKind, snow: sn.spec.dropsLive, snowKind: sn.spec.dropKind, hail: hl.spec.dropsLive, hailKind: hl.spec.dropKind, offLive: npr.spec.dropsLive };
  if (!(rn.spec.dropsLive > 100 && rn.spec.dropKind === 'rain')) fails.push('storm 没下起雨来（live=' + rn.spec.dropsLive + ' kind=' + rn.spec.dropKind + '）');
  if (!(sn.spec.dropsLive > 60 && sn.spec.dropKind === 'snow')) fails.push('snow 不雪（live=' + sn.spec.dropsLive + ' kind=' + sn.spec.dropKind + '）');
  if (!(hl.spec.dropsLive > 40 && hl.spec.dropKind === 'hail')) fails.push('hail 不雹（live=' + hl.spec.dropsLive + ' kind=' + hl.spec.dropKind + '）');
  if (npr.spec.dropsLive !== 0) fails.push('关掉 precip 开关仍在下（' + npr.spec.dropsLive + '）');
  out['8c_rainContrast'] = rn.precipPair;
  /* 920 条雨丝铺满画面也才占 ~3% 像素；低于 0.6% 就说明它们与雾同色、画了等于没画 */
  if (!rn.precipPair) fails.push('拿不到降雨的开/关配对帧 → 无法证明雨看得见（dropsLive 只数了几何）');
  else if (!(rn.precipPair.changedPct >= 0.6)) fails.push('下雨开/关只改了 ' + rn.precipPair.changedPct + '% 的像素（' + rn.precipPair.changed + ' 个）→ 雨丝与雾同色，画了看不见，查 PRECIP.kinds 的 color/alpha');
  const indoor = await p.evaluate(APPLY, Object.assign({ seed: seed, y: 2, tag: 'indoor', weather: 'storm', dayT: 0.25, pitch: 0.2 }));
  out['8b_indoor'] = { live: indoor.spec.dropsLive, y: 2 };
  if (!(indoor.spec.dropsLive === 0)) fails.push('相机埋到地下 2 格仍画 ' + indoor.spec.dropsLive + ' 滴 → 降水没被屋顶/地表挡住');

  /* 9 闪电（页内广播 + 外部钩子两头都要） */
  const hk = await p.evaluate(HOOKTEST);
  const flashShot = await shot('nightstorm');
  out['9_lightning'] = { hookHits: hk.count, bolts: hk.bolts, flashes: flashShot.spec && flashShot.spec.flashes };
  if (!(hk.count > 0 && hk.bolts > 0)) fails.push('暴风雨跑了 200 秒，onLightning 外部计数 ' + hk.count + ' / 天气层计数 ' + hk.bolts + ' ⇒ 广播链断了一头');

  /* 10 分区 */
  out['10_regional'] = await p.evaluate(REGIONAL);
  if (out['10_regional'].here === out['10_regional'].there) fails.push('定点 force 之后两端天气相同（都是 ' + out['10_regional'].here + '）→ 分区天气没起作用');

  /* 11 词表反查 */
  out['11_vocab'] = await p.evaluate(VOCAB);
  const v = out['11_vocab'];
  if (v.modsExtra.length) fails.push('mods 用了词表外的键：' + v.modsExtra.join(', '));
  if (v.modsMissing.length) fails.push('有预设没填满词表（机制层读它会拿 undefined）：' + v.modsMissing.join(', '));
  if (v.flagsExtra.length) fails.push('flags 用了词表外的名字：' + v.flagsExtra.join(', '));
  if (v.presetless.length) fails.push('转移表有孤儿：' + v.presetless.join(', '));
  if (v.unknownFlag !== 0) fails.push('未知旗标 FLAG() 返回了 ' + v.unknownFlag + '（应当 0 ⇒ 永假而不是崩）');

  /* 12 确定性 */
  out['12_replay'] = await p.evaluate(REPLAY, seed);
  if (!out['12_replay'].same) fails.push('同种子重放 400 tick 天气不同 ⇒ 不可复现，存档与回归都站不住');

  /* 13 预算 */
  const bud = await p.evaluate(BUDGET);
  out['13_budget'] = { regions: bud.regions, perStep: bud.perStep, maxUpdates: bud.maxUpdates, maxMs: bud.maxMs, steps: bud.steps };
  if (!(bud.maxUpdates <= Math.max(bud.perStep, bud.regions))) fails.push('单步推进 ' + bud.maxUpdates + ' 个区，超预算 ' + bud.perStep);

  /* 14 开销 */
  out['14_cost'] = await p.evaluate(COST);
  const cc2 = out['14_cost'];
  /* headless 的绝对毫秒不能当真机指标（AGENTS 里就记了这条），所以这里钉的是"多画了多少东西"：
     天穹 + 星 + 云影布 + 降水 = 4 次 draw call、三角形与顶点数由 QUALITY 封顶。 */
  if (!(cc2.callsOn - cc2.callsOff <= 8)) fails.push('开大气层多出 ' + (cc2.callsOn - cc2.callsOff) + ' 次 draw call（预算 8）');
  if (!(cc2.trisOn - cc2.trisOff <= 14000)) fails.push('开大气层多出 ' + (cc2.trisOn - cc2.trisOff) + ' 个三角形（预算 14000）');

  /* 15 交回老通路 */
  /* 15) 跑完一整轮（打过雷、下过雨、换过质量档、开过 followSun）之后，用玩家那个开关把画面交回老通路：
         重开一局但**不换页面**——本层留在场景与灯光里的东西必须全部交还，否则这张图和基线不是一张图。 */
  out['15_legacy'] = await shot('baseline', { restart: true, params: { on: false } });
  if (out['15_legacy'].sum !== base.sum) fails.push('用真开关交回老通路后画面与基线不同（' + out['15_legacy'].sum + ' vs ' + base.sum + '；亮度 ' + out['15_legacy'].all.lum + ' vs ' + base.all.lum + '）→ 本层留下了没清掉的东西（灯光颜色 / 没藏的几何 / 钩子）');
  if (out['15_legacy'].diag.bg !== 'texture') fails.push('老通路接管时 scene.background 不是那张渐变贴图（拿到 ' + out['15_legacy'].diag.bg + '）');
  if (out['15_legacy'].spec.domeVisible || out['15_legacy'].spec.sheetVisible || out['15_legacy'].spec.starsVisible)
    fails.push('关掉之后仍有本层几何在画：dome=' + out['15_legacy'].spec.domeVisible + ' sheet=' + out['15_legacy'].spec.sheetVisible + ' stars=' + out['15_legacy'].spec.starsVisible);

  /* 17 天球转动：星星/银河/太阳同号同率，天极仰角 = 纬度，星点之间不形变 */
  out['17_skyRotation'] = await p.evaluate(SKYTRACK);
  const sk = out['17_skyRotation'];
  if (!sk.found) fails.push('场景里找不到 gw-stars / gw-dome → 天球转动无从量起');
  else {
    if (!sk.sameSign) fails.push('星星的转向与太阳相反（Δstar ' + sk.dStar + ' vs Δsun ' + sk.dSun + '）→ 星空倒转');
    if (!(Math.abs(sk.dStar) > 1e-4)) fails.push('推进 6% 的一天，星图的小时角一点没动（Δ=' + sk.dStar + '）→ 天球不转，或量之前大气层没接管');
    else if (!sk.rateOk) fails.push('星星每小时转 ' + sk.dStar + ' rad，应是 ' + sk.want + '（rotateK 的角速度）→ 转得快慢不对');
    if (!sk.galWithStars) fails.push('银河没跟着星星一起转（Δgal ' + sk.dGal + ' vs Δstar ' + sk.dStar + '）→ 星点在银河上滑动');
    if (Math.abs(sk.poleY - sk.latSin) > 1e-3) fails.push('天极仰角与纬度不符：pole.y=' + sk.poleY + ' 应为 sin(lat)=' + sk.latSin);
    if (!sk.rigid) fails.push('两颗星之间的角距随时间变化 → 星图在被形变而不是刚体转动');
  }

  /* 质量档还能跑 */
  const low = await shot('low'), follow = await shot('follow');
  out['16_toggles'] = { lowQuality: low.spec.quality, lowStars: low.spec.starVerts, followLum: follow.sky.lum, stepErrors: follow.stepErrors, lastError: follow.lastError };
  if (follow.stepErrors) fails.push('开 followSun 后 step 出错：' + follow.lastError);

  out.aimSun = sun.aim; out.aimMoonFull = mf.aim;
  out.dbg = { domeDay: sun.spec && sun.spec.domeDbg, starDay: sun.spec && sun.spec.starDbg, sheet: sOn.spec && sOn.spec.sheetDbg,
                     domeNight: night.spec && night.spec.domeDbg, starNight: night.spec && night.spec.starDbg,
                     moonFull: mf.spec && mf.spec.domeDbg, flashSheet: flashShot.spec && flashShot.spec.sheetDbg };
  out.fails = fails;
  out.pass = fails.length === 0;
  if (errs.length) { out.fails.push('页面异常：' + errs.slice(0, 3).join(' | ')); out.pass = false; }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('ATMOS CHECK ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });