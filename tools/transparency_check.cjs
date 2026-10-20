#!/usr/bin/env node
/* tools/transparency_check.cjs · 半透明闪烁与"透明/特效"画序回归
   两件事分开量，各自有独立判据：
     A. 生成侧：冰贴着水时，交界面上**只能有一张面片**（两张共面片 = 相机一动就闪）。
        自己按世界数据数三角形，不复用渲染器的结论。
     B. 画序/深度：水写深度、水前特效不被水盖、水后特效被水压暗。
        用真水材质 + 与 VFX 同构的"暗底写深度 / 彩层加法"两个盒子，离屏渲染后读像素。
   用法：node tools/transparency_check.cjs
   退出码：0 全过，1 判据不过，2 环境错误。 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createRequire } = require('module'); const req = createRequire(__filename);
let PW = null;
for (const c of ['playwright', 'playwright-core', '/data/miniconda3/miniconda3/lib/node_modules/playwright', '/data/miniconda3/miniconda3/lib/node_modules/playwright-core']) { try { PW = req(c); break; } catch (e) {} }
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };
function serve() { return new Promise((res) => { const srv = http.createServer((q, rsp) => {
  const rel = decodeURIComponent(q.url.split('?')[0]); const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
  fs.readFile(fp, (e, b) => { if (e) { rsp.writeHead(404).end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b); });
}); srv.listen(0, '127.0.0.1', () => res(srv)); }); }

const RUN = async () => {
  const G = window.GW, S = window.GWAPP, B = G.BLOCK;
  const out = { checks: [], fails: [] };
  const ck = (name, ok, detail) => { out.checks.push({ name, ok: !!ok, detail: detail || '' }); if (!ok) out.fails.push(name + ' | ' + detail); };
  window.__GW_START({ mode: 'train', seed: 490706, deck: 'starter' });
  const F = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 30; i++) await F();
  if (S.sources) S.sources.length = 0;
  const w = S.world, p = S.match.players[0];
  const gx = Math.floor(p.pos.x), gz = Math.floor(p.pos.z);
  const gy = w.surfaceY(gx, gz) + 5;
  const ix = gx + 2, iz = gz + 2;
  /* 先清出 3×3×3 空气：只让"冰+水"这一对贡献交界面，别把树/草的面混进来。 */
  for (let dy = 0; dy < 3; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w.set(ix + dx, gy + dy, iz + dz, 0);
  w.set(ix, gy, iz, B.ICE);
  w.set(ix + 1, gy, iz, B.WATER);
  for (let i = 0; i < 240; i++) await F();
  await F(); await F();

  function meshes() {
    const list = [];
    S.chunkMeshes && Object.keys(S.chunkMeshes).forEach((k) => {
      S.chunkMeshes[k].traverse((o) => { if (o.isMesh && o.geometry && o.geometry.index) list.push(o); });
    });
    return list;
  }
  /* 交界平面 x = ix+1，格子 y/z 范围 [gy,gy+1]×[iz,iz+1] */
  function planeTris(mesh) {
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    let n = 0, glass = 0, liquid = 0;
    for (let i = 0; i < idx.count; i += 3) {
      let on = true;
      for (let j = 0; j < 3; j++) {
        const vi = idx.getX(i + j), x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        if (Math.abs(x - (ix + 1)) > 0.001 || y < gy - 0.001 || y > gy + 1.001 || z < iz - 0.001 || z > iz + 1.001) { on = false; break; }
      }
      if (!on) continue;
      n++;
      if (mesh.renderOrder === 21) glass++; else if (mesh.renderOrder === 22) liquid++;
    }
    return { n, glass, liquid };
  }
  let total = 0, glass = 0, liquid = 0;
  const ms = meshes();
  for (const m of ms) { const r = planeTris(m); total += r.n; glass += r.glass; liquid += r.liquid; }
  ck('A1 冰/水交界只生成一张面片', total === 2, '期望 2 三角（一张方格面），实际 ' + total + '（glass ' + glass + ' / liquid ' + liquid + '）');
  ck('A2 交界面由 solid-side（冰/glass pass）画', glass === 2 && liquid === 0, 'glass=' + glass + ' liquid=' + liquid);

  /* 静态画序：水/冰写深度，且 renderOrder 是 main/chunk-mesher 的统一口径 */
  const waterMesh = ms.find((m) => m.renderOrder === 22), glassMesh = ms.find((m) => m.renderOrder === 21);
  ck('B1 水层 renderOrder=22 且写深度', !!waterMesh && waterMesh.material.depthWrite === true, waterMesh ? 'depthWrite=' + waterMesh.material.depthWrite : '找不到水层');
  ck('B2 冰层 renderOrder=21 且写深度', !!glassMesh && glassMesh.material.depthWrite === true, glassMesh ? 'depthWrite=' + glassMesh.material.depthWrite : '找不到冰层');

  /* 离屏像素：真水材质 + VFX 同构的暗底/彩层盒子 */
  const cv = document.createElement('canvas'); cv.width = 480; cv.height = 300;
  const re = new THREE.WebGLRenderer({ canvas: cv, antialias: false, preserveDrawingBuffer: true });
  re.setPixelRatio(1); re.setSize(480, 300);
  re.outputEncoding = THREE.sRGBEncoding;
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x05060a);
  const cam = new THREE.PerspectiveCamera(60, 480 / 300, 0.05, 50);
  cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const dark = new THREE.MeshBasicMaterial({ color: 0x0b0c12 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), dark); back.position.z = -4; sc.add(back);
  const wm = waterMesh ? waterMesh.material : (G.WaterMaterial && G.WaterMaterial.create({ map: null }));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), wm);
  water.renderOrder = 22; sc.add(water);
  function glow(color, z) {
    const under = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.02), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true }));
    under.position.set(0, 0, z); under.renderOrder = 10; sc.add(under);
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.02), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true }));
    col.position.set(0, 0, z); col.renderOrder = 11; sc.add(col);
    return [under, col];
  }
  function sample() {
    re.render(sc, cam);
    const gl = re.getContext(); const px = new Uint8Array(4);
    gl.readPixels(240, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  }
  const near = glow(0xff3020, 1.4);   // 水前
  const ln = sample();
  near.forEach((o) => { sc.remove(o); });
  const far = glow(0x30ff70, -1.4);   // 水后
  const lw = sample();
  water.visible = false;
  const lf = sample();
  water.visible = true;
  far.forEach((o) => { sc.remove(o); });
  ck('B3 水前特效不被水盖（红色通道够亮）', ln[0] >= 120, 'near=' + ln.join(','));
  ck('B4 水后特效被水压暗（绿色明显低于无水对照）', lw[1] < lf[1] * 0.88 && lf[1] > 40, 'water=' + lw.join(',') + ' noWater=' + lf.join(','));
  ck('B5 水前比水后更亮（画序不是反的）', (ln[0] + ln[1] + ln[2]) > (lw[0] + lw[1] + lw[2]), 'near=' + ln.join(',') + ' far=' + lw.join(','));
  re.dispose();
  return out;
};

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await PW.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2));
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  const r = await page.evaluate(RUN);
  if (errs.length) r.fails.push('页面异常：' + errs.join(' | '));
  console.log(JSON.stringify({ pass: r.fails.length === 0, checks: r.checks, fails: r.fails }, null, 2));
  await browser.close(); srv.close();
  process.exit(r.fails.length ? 1 : 0);
})().catch((e) => { console.error('TRANSPARENCY PROBE ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
