#!/usr/bin/env node
/* tools/audit.mjs · 一键验收入口（测试验证的唯一负责人）
   用法：
     node tools/audit.mjs                    # 默认三个种子 490706 88092 31337，http 注入
     node tools/audit.mjs 490706             # 指定种子
     node tools/audit.mjs --file 490706      # 用 file:// 打开（模拟双击 index.html 的真实路径）
     node tools/audit.mjs --shots /tmp/gwshots 490706   # 跑完审计再按 __camPose 落一组构图截图
   判定标准全部在 tools/cam_audit.js（口径冻结，改它必须给出理由并让用户过目）。
   退出码：全部 pass → 0；任何 fail → 1；环境错误 → 2。 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
let fileMode = false, shotsDir = null;
const seeds = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--file') fileMode = true;
  else if (argv[i] === '--shots') shotsDir = argv[++i];
  else if (argv[i].trim() !== '') seeds.push(+argv[i]);
}
if (!seeds.length) seeds.push(490706, 88092, 31337);

function loadPlaywright() {
  const cands = ['playwright', 'playwright-core',
    '/data/miniconda3/miniconda3/lib/node_modules/playwright',
    '/data/miniconda3/miniconda3/lib/node_modules/playwright-core'];
  const { createRequire } = require('module');
  for (const c of cands) { try { return createRequire(__filename)(c); } catch (e) {} }
  try { return require('playwright'); } catch (e) {}
  return null;
}
const PW = loadPlaywright();
if (!PW) { console.error('找不到 playwright：用 NODE_PATH=/data/miniconda3/miniconda3/lib/node_modules node tools/audit.mjs … 重试'); process.exit(2); }
const { chromium } = PW;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
  '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml' };
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

(async () => {
  const srv = fileMode ? null : await serve();
  const port = srv ? srv.address().port : 0;
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  // DPR 回归（2026-10-16 用户 4K 实机报"放大+裁右上"后加）：设备像素比≠1 时画布布局尺寸必须等于窗口
  {
    const dpg = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    const dprOk = await dpg.goto(pageUrl()).then(() => dpg.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 }))
      .then(() => dpg.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
        const c = document.getElementById('gl'), r = c.getBoundingClientRect();
        res({ dpr: devicePixelRatio, fit: Math.abs(r.width - innerWidth) <= 1 && Math.abs(r.height - innerHeight) <= 1,
          bufScale: +(c.width / innerWidth).toFixed(2), css: [Math.round(r.width), Math.round(r.height)], inner: [innerWidth, innerHeight] });
      })))))
      .catch(e => ({ err: e.message }));
    await dpg.close();
    if (!dprOk || dprOk.err || !dprOk.fit) { console.log('FAIL dpr回归: ' + JSON.stringify(dprOk)); allOk = false; results.push({ seed: 'dpr1.5', pass: false, fails: [JSON.stringify(dprOk)] }); }
    else console.log('PASS dpr回归 (4K 等效 150%): ' + JSON.stringify(dprOk));
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  function pageUrl() { return fileMode ? 'file://' + path.join(ROOT, 'index.html')
    : 'http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2); }
  page.on('pageerror', e => console.log('[pageerror] ' + e.message));
  let allOk = true;
  const results = [];
  const srcFile = fs.readFileSync(path.join(ROOT, 'tools', 'cam_audit.js'), 'utf8');
  for (const seed of seeds) {
    await page.goto(pageUrl());
    await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
    let r;
    try {
      r = await page.evaluate(async ([s, sd]) => { (0, eval)(s);
        const res = await window.__camAudit({ seed: sd, deck: 'starter', mode: 'train' });
        return { pass: res.pass, fails: res.checks.filter(c => !c.ok).map(c => c.name + ' | ' + c.detail),
          J: (res.checks.find(c => c.name.indexOf('J') === 0) || {}).detail }; }, [srcFile, seed]);
    } catch (e) {
      console.log('seed=' + seed + ' 运行异常: ' + e.message);
      r = { pass: false, fails: ['env | ' + e.message] };
    }
    results.push({ seed, ...r });
    console.log((r.pass ? 'PASS' : 'FAIL') + ' seed=' + seed + (r.pass ? '' : '\n  ' + r.fails.join('\n  ')));
    if (r.J) console.log('  J: ' + r.J);
    if (!r.pass) allOk = false;
  }
  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    const poses = [
      { name: 'open_shoulder', seed: 490706, x: 24.5, z: 24.5, yaw: 0.79, pitch: 0, mode: 'shoulder' },
      { name: 'open_lookdown', seed: 490706, x: 24.5, z: 24.5, yaw: 0.79, pitch: -0.8, mode: 'shoulder' },
      { name: 'first_person', seed: 490706, x: 24.5, z: 24.5, yaw: 0.79, pitch: 0, mode: 'first' },
      // 88092 的"仰头+身后 1.35 格有草皮截臂"场景：托举梯必须越过去，机位不该贴着身体
      { name: 'treehug_lookup', seed: 88092, x: 8.5, z: 20.5, yaw: 3.34, pitch: 0.42, mode: 'shoulder' },
      { name: 'treehug_wallbehind', seed: 88092, x: 8.5, z: 20.5, yaw: 0.2, pitch: 0, mode: 'shoulder' },
    ];
    for (const pz of poses) {
      try {
        await window_reset(page);
        await page.evaluate(async (p) => { window.__GW_START({ mode: 'train', seed: p.seed, deck: 'starter' });
          for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
          window.__camPose(p);
          for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));
        }, pz);
        await page.screenshot({ path: path.join(shotsDir, pz.name + '.png') });
        console.log('shot → ' + path.join(shotsDir, pz.name + '.png'));
      } catch (e) { console.log('[shot skip] ' + pz.name + ': ' + e.message); }
    }
  }
  async function window_reset(pg) {
    const url = fileMode ? 'file://' + path.join(ROOT, 'index.html')
      : 'http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2);
    await pg.goto(url);
    await pg.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  }
  await browser.close();
  if (srv) srv.close();
  console.log(JSON.stringify({ ok: allOk, seeds, results: results.map(x => ({ seed: x.seed, pass: x.pass, fails: x.fails })) }));
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('AUDIT ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
