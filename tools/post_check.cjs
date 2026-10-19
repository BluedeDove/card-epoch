#!/usr/bin/env node
/* tools/post_check.cjs · 光影层回归（开发工具，index.html 不引用）

   为什么要单独一把尺子：后处理最容易骗自己的地方是"看着差不多"。本文件机检四件事：
     1) 关光影能跑（回到原生直渲，不许报错）；
     2) **开光影但所有旋钮拨到无操作 = 与关光影像素一致**（均差 ≤ 1.0/255）。
        这条过了才说明色彩空间没有编码两次／漏编码，也才说明 audit 与 feel_probe 的历史基准没被光影污染；
     3) 默认参数下画面确实**变了**（证明效果在起作用，不是接了个空管线）；
     4) 分屏 + F3 三档渲染分辨率下都能跑（RT 随尺寸重建）；
     5) 顺手量每次提交的 CPU 时间（gl.finish 同步）——SwiftShader 的绝对值不能当真机指标，
        但"开/关"的相对倍数是真机趋势的下界参考。

   用法：node tools/post_check.cjs [seed]
   退出码：0 全过；1 判据不过；2 环境错误。 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const seed = +(process.argv.find(a => /^\d+$/.test(a)) || 490706);
const { createRequire } = require('module'); const req = createRequire(__filename);
let PW = null;
for (const c of ['playwright','playwright-core','$(npm root -g)/playwright','$(npm root -g)/playwright-core']) { try { PW = req(c); break; } catch (e) {} }
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.css':'text/css' };
const srv = http.createServer((q, rsp) => {
  const rel = decodeURIComponent(q.url.split('?')[0]);
  const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
  fs.readFile(fp, (e, b) => { if (e) { rsp.writeHead(404).end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b); });
});

/* 页内：同一个任务里连续渲染两帧再 readPixels，中间没有 rAF 插队，画面内容才是同一份 */
const RUN = async (sd) => {
  const G = window.GW, S = window.GWAPP, d = window.__dbg;
  /* 并行会话正在改音频引擎：它此刻在开局路径上抛异常（H.hideInventory→G.Audio.play→envShape 里 g.gain 不存在）。
     那与光影无关，探针不该被它绑住：只在"确实会抛"时把 play 旁路掉，并在输出里记 audioBypassed，绝不静默。 */
  window.__audioBypassed = false;
  try { if (window.GW && window.GW.Audio) window.GW.Audio.play('ui'); }
  catch (e) { window.__audioBypassed = true; window.GW.Audio.play = function () { return false; }; }
  window.__GW_START({ mode: 'train', seed: sd, deck: 'starter' });
  const F = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 40; i++) await F();
  window.__camPose({ x: 24.5, z: 24.5, yaw: 0.79, pitch: -0.15, mode: 'shoulder', freeze: true });
  for (let i = 0; i < 30; i++) await F();
  const gl = d.renderer.getContext();
  function grab() {
    // 直接同步渲染一帧（不走 rAF），然后立刻读回缓冲区
    d.renderer.setRenderTarget(null);
    G.SHADER.renderScene(d.renderer, d.scene, S.cams[0].cam, 0, 0, window.innerWidth, window.innerHeight);
    d.renderer.getContext().finish();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sr = 0, sg = 0, sb = 0, n = w * h;
    for (let i = 0; i < n; i++) { sr += buf[i*4]; sg += buf[i*4+1]; sb += buf[i*4+2]; }
    return { n: n, mean: [sr/n, sg/n, sb/n], buf: buf };
  }
  function diff(a, b) {
    if (a.length !== b.length) return { meanAbs: NaN, maxAbs: NaN, sizeChanged: true };   // 渲染分辨率换了，缓冲区尺寸本来就不同
    let s = 0, mx = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 3; c++) { const t = Math.abs(a[i+c] - b[i+c]); s += t; if (t > mx) mx = t; }
    }
    return { meanAbs: s / (a.length / 4) / 3, maxAbs: mx };
  }
  const out = { fails: [], seed: sd };
  out.audioBypassed = !!window.__audioBypassed;
  const snap = JSON.parse(JSON.stringify(G.SHADER.params));

  // —— 1) 关光影
  G.SHADER.set('on', false);
  const t0 = performance.now(); for (let i = 0; i < 12; i++) grab(); const offMs = (performance.now() - t0) / 12;
  const A = grab();
  out.offMean = A.mean.map(v => +v.toFixed(2));

  // —— 2) 开光影但全中性（必须与关光影一致）
  G.SHADER.neutralize();
  const B = grab();
  const pN = diff(A.buf, B.buf);
  out.neutral = { meanAbs: +pN.meanAbs.toFixed(3), maxAbs: pN.maxAbs, mean: B.mean.map(v => +v.toFixed(2)) };
  if (pN.meanAbs > 1.0) out.fails.push('中性光影下与关光影不一致（均差 ' + pN.meanAbs.toFixed(3) + '/255，最大 ' + pN.maxAbs + '）→ 色彩空间编码多做或漏做了一次');

  // —— 3) 默认效果：画面必须变
  for (const k in snap) G.SHADER.set(k, snap[k]);
  G.SHADER.set('on', true); G.SHADER.set('bloom', true); G.SHADER.set('grade', true); G.SHADER.set('vignette', true);
  G.SHADER.set('exposure', 1.12); G.SHADER.set('tone', 'reinhard');
  const C = grab();
  const pFx = diff(A.buf, C.buf);
  out.effects = { meanAbs: +pFx.meanAbs.toFixed(3), maxAbs: pFx.maxAbs, mean: C.mean.map(v => +v.toFixed(2)) };
  if (pFx.meanAbs < 0.5) out.fails.push('开光影后画面几乎没变（均差 ' + pFx.meanAbs.toFixed(3) + '）→ 管线可能没接上');

  // —— 4) 分屏 + 三档渲染分辨率
  try {
    G.SHADER.set('on', true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }));
    for (let i = 0; i < 20; i++) await F();
    d.renderer.setRenderTarget(null);
    const half = window.innerWidth / 2;
    G.SHADER.renderScene(d.renderer, d.scene, S.cams[0].cam, 0, 0, half, window.innerHeight);
    G.SHADER.renderScene(d.renderer, d.scene, S.cams[1] ? S.cams[1].cam : S.cams[0].cam, half, 0, half, window.innerHeight);
    gl.finish();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }));
    for (let i = 0; i < 10; i++) await F();
    out.splitOk = true;
  } catch (e) { out.fails.push('分屏渲染抛异常：' + e.message); out.splitOk = false; }
  const scales = [];
  for (const sc of [0.75, 0.55, 1]) {
    d.renderer.setPixelRatio(sc * Math.min(window.devicePixelRatio || 1, 1.5));
    d.renderer.setSize(window.innerWidth, window.innerHeight);
    G.SHADER.set('on', true);
    try {
      const R = grab(); const dd = diff(A.buf, R.buf);
      scales.push({ scale: sc, ok: true, sizeChanged: !!dd.sizeChanged, meanAbs: dd.sizeChanged ? null : +dd.meanAbs.toFixed(3), mean: R.mean.map(v => +v.toFixed(2)) });
    }
    catch (e) { scales.push({ scale: sc, ok: false, err: e.message }); out.fails.push('renderScale ' + sc + ' 崩：' + e.message); }
  }
  d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  d.renderer.setSize(window.innerWidth, window.innerHeight);
  out.scales = scales;

  // —— 5) 烘进顶点色的日照（G.SHADOW）：存在性 + 关闭后与基线一致 + 重建代价
  const SH = window.GW.SHADOW, SH_DEF = SH.strength;
  /* 抽样口径：拿"地面顶面的角点"当被照面。注意 surfaceY 把树叶算成固体（AGENTS 里就记了这条），
     直接用它会采到树冠顶上、永远阳光充足，所以这里按相机同一口径重找地面（跳过 LEAF）。 */
  const sunTest = (function () {
    const w = S.world, B = G.BLOCK, DEFS2 = G.BLOCK_DEFS;
    function groundTop(x, z) {
      for (let y = w.SY - 1; y >= 1; y--) { const id = w.get(x, y, z); if (id && DEFS2[id].solid && id !== B.LEAF) return y; }
      return -1;
    }
    let under = null, open = null, lit = 0, shaded = 0, tried = 0;
    for (let z = 6; z < w.SZ - 6; z += 2) for (let x = 6; x < w.SX - 6; x += 2) {
      const gy = groundTop(x, z);
      if (gy < 2) continue;
      const v = w.sunVis(x + 0.5, gy + 1 + window.GW.SHADOW.bias, z + 0.5);   // bias 在 G.SHADOW 里，别拿不到就当 0：NaN 坐标会让每条射线都"没挡住"（我第一次就栽在这儿）
      tried++;
      if (v === 0) { shaded++; if (!under) under = [x, gy, z]; }
      else { lit++; if (!open) open = [x, gy, z]; }
    }
    if (!under || !open) return { ok: false, why: '抽到 ' + tried + ' 格：阴凉 ' + shaded + ' / 向阳 ' + lit + '（两者都要有才说明射线口径对）' };
    return { ok: true, tried: tried, shadedPct: +(shaded * 100 / tried).toFixed(1), under: under, open: open };
  })();
  out.sunTest = sunTest;
  if (!sunTest.ok) out.fails.push('日照样本缺失：' + sunTest.why);
  else {
    if (!(sunTest.shadedPct > 0.3 && sunTest.shadedPct < 60)) out.fails.push('被照面里阴凉占比 ' + sunTest.shadedPct + '% 不合理（太低=射线没挡住东西，太高=方向或步长跑偏）');
  }
  // 关掉影子 → 与基线一致；打开 → 必须更暗；同时量一次全量重建的代价
  const rebuildAll = () => window.__dbg.rebuildAll();
  SH.strength = 0; let rOff = rebuildAll(); const A2 = grab();
  SH.strength = SH_DEF; let rOn = rebuildAll(); const C2 = grab();
  const lum = (b) => { let s = 0, n = b.length / 4; for (let i = 0; i < b.length; i += 4) s += 0.299 * b[i] + 0.587 * b[i+1] + 0.114 * b[i+2]; return s / n; };
  const lOff = lum(A2.buf), lOn = lum(C2.buf);
  out.shadow = { strength: SH_DEF, offLum: +lOff.toFixed(2), onLum: +lOn.toFixed(2),
                 darkerPct: +((1 - lOn / lOff) * 100).toFixed(2), rebuildMs: { off: +rOff.ms.toFixed(1), on: +rOn.ms.toFixed(1), chunks: rOn.chunks } };
  if (sunTest.ok && lOn >= lOff) out.fails.push('打开日照后画面没有变暗（on ' + lOn.toFixed(2) + ' ≥ off ' + lOff.toFixed(2) + '）→ 顶点色没吃到 sunVis');
  if (rOn.ms > rOff.ms * 8 + 400) out.fails.push('全量重建代价异常：开影子 ' + rOn.ms.toFixed(1) + 'ms vs 关 ' + rOff.ms.toFixed(1) + 'ms');

  // —— 6) 相对开销（CPU 提交 + gl.finish 同步；SwiftShader 绝对值不当真机指标）
  G.SHADER.set('on', false); for (let i = 0; i < 8; i++) grab();
  const tOff = performance.now(); for (let i = 0; i < 20; i++) grab(); const msOff = (performance.now() - tOff) / 20;
  G.SHADER.set('on', true); for (let i = 0; i < 8; i++) grab();
  const tOn = performance.now(); for (let i = 0; i < 20; i++) grab(); const msOn = (performance.now() - tOn) / 20;
  out.cost = { offMs: +msOff.toFixed(2), onMs: +msOn.toFixed(2), ratio: +(msOn / Math.max(0.001, msOff)).toFixed(2) };
  if (!G.SHADER.isBroken()) out.spec = G.SHADER.spec();

  // —— 7) P 键开关光影；提示文案必须来自 hud 层（装配层写死中文是本项目明令禁止的）
  const wasOn = G.SHADER.enabled();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }));
  await F(); await F();
  const nowOn = G.SHADER.enabled();
  const toastEl = document.getElementById('toast');
  const toastText = toastEl ? String(toastEl.textContent || '').trim() : '';
  const want = nowOn ? G.HUD.TEXT.post.on.text : G.HUD.TEXT.post.off.text;
  out.postKey = { flipped: wasOn !== nowOn, toastText: toastText.slice(0, 26), fromHudText: toastText === want };
  if (wasOn !== nowOn && toastText !== want) out.fails.push('P 键提示与 H.TEXT.post 对不上（"' + toastText + '" vs "' + want + '"）→ 文案可能写死在装配层');
  if (wasOn === nowOn) out.fails.push('按 P 没切换光影开关');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }));   // 复位，别把开关状态留在探针里
  await F();
  for (const k in snap) G.SHADER.set(k, snap[k]);
  return out;
};

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const browser = await PW.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html?cb=' + Math.random().toString(36).slice(2));
  await page.waitForFunction(() => window.GWAPP && window.__GW_START && window.GW && window.GW.SHADER, null, { timeout: 60000 });
  const r = await page.evaluate(RUN, seed);
  if (errs.length) r.fails.push('页面异常：' + errs.slice(0, 3).join(' | '));
  // 整体吐出去，别手写键名清单——上一版漏了 sunTest/shadow，量到了却在输出里看不见
  console.log(JSON.stringify(Object.assign({ pass: r.fails.length === 0 }, r), null, 1));
  await browser.close(); srv.close();
  process.exit(r.fails.length ? 1 : 0);
})().catch(e => { console.error('POST CHECK ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
