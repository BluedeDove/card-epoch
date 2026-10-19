#!/usr/bin/env node
/* tools/net_spike_check.cjs · NET-spike 驱动（Playwright，零新增依赖）
   回答任务书四件事：
   ① file:// → ws:// 能不能连（两页面 file:// 加载 index.html，各连本机 ws，console 原始报错全留）；
   ② 若被拦，http:// 同源起服务能不能绕开；
   ③ loopback 往返延迟 p50/p95/max（应用层 aping + 端到端 echo，各 ~1000 帧）与 20Hz 锁步缓冲；
   ④ 断线（SIGKILL → TCP FIN）与半开（SIGSTOP 整组 → 心跳超时）服务端能不能 2 秒内发现。
   用法：node tools/net_spike_check.cjs [--samples=1000] [--scheme=file|http|both] */
'use strict';
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const SAMPLES = parseInt((process.argv.find(a => a.startsWith('--samples=')) || '--samples=1000').split('=')[1], 10);
const SCHEME = (process.argv.find(a => a.startsWith('--scheme=')) || '--scheme=both').split('=')[1];
function loadPW() {
  try { return require('playwright'); } catch (e) {}
  const { createRequire } = require('module');
  const rq = createRequire('$(npm root -g)/playwright/package.json');
  return rq('playwright-core');
}
const { chromium } = loadPW();
function chromePids() {
  try {
    return execSync("ps -eo pid=,ppid=,comm= | awk '$3 ~ /chrome|chromium/ {print $1}'").toString().trim().split(String.fromCharCode(10)).map(s => parseInt(s, 10)).filter(n => n > 0);
  } catch (e) { return []; }
}
function directChromeKidsOfDriver() {
  return chromePids().filter(pid => {
    try { return execSync('ps -o ppid= -p ' + pid).toString().trim() === String(process.pid); } catch (e) { return false; }
  });
}
function treeOf(roots) {
  const all = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    const rows = execSync("ps -eo pid=,ppid=,comm= | awk '$3 ~ /chrome|chromium/ {print $1, $2}'").toString().trim().split(String.fromCharCode(10));
    for (const r of rows) {
      const [pid, ppid] = r.trim().split(/\s+/).map(Number);
      if (all.has(ppid) && !all.has(pid)) { all.add(pid); grew = true; }
    }
  }
  return [...all];
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.md': 'text/plain' };
function serveStatic() {
  const srv = http.createServer((req, rsp) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const fp = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
    rsp.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(fp).pipe(rsp);
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port })));
}
function startWsServer() {
  const p = spawn('node', [path.join(ROOT, 'tools/net_spike_server.cjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
  p.logs = [];
  p.stdout.on('data', d => {
    d.toString().split(String.fromCharCode(10)).filter(Boolean).forEach(l => p.logs.push({ t: Date.now(), l }));
  });
  return new Promise(res => {
    const iv = setInterval(() => {
      const hit = p.logs.find(x => x.l.startsWith('PORT '));
      if (hit) { clearInterval(iv); res({ p, port: parseInt(hit.l.slice(5), 10) }); }
    }, 50);
  });
}
async function runScheme(scheme, httpPort, wsPort, samples) {
  const url = scheme === 'file'
    ? 'file://' + path.join(ROOT, 'index.html')
    : 'http://127.0.0.1:' + httpPort + '/index.html';
  const out = { scheme, url, consoles: { A: [], B: [] }, ok: false, paired: false };
  /* 归属按"驱动进程的直接 chrome 子进程 = 该实例的主进程"定，子树在 kill 时刻才展开——
     network/gpu 是懒加载进程，启动时点差集会把 A 的晚生进程错记给 B（file 组曾因此误杀 A）。 */
  const mainsBefore = directChromeKidsOfDriver();
  const brA = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const mainsA = directChromeKidsOfDriver().filter(p => !mainsBefore.includes(p));
  const brB = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const mainsB = directChromeKidsOfDriver().filter(p => !mainsBefore.includes(p) && !mainsA.includes(p));
  out.mainsB = mainsB;
  const pgA = await brA.newPage(), pgB = await brB.newPage();
  for (const [tag, pg] of [['A', pgA], ['B', pgB]]) {
    pg.on('console', m => out.consoles[tag].push(m.type() + ': ' + m.text()));
    pg.on('pageerror', e => out.consoles[tag].push('pageerror: ' + e.message));
  }
  await pgA.goto(url); await pgB.goto(url);
  await pgA.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  await pgB.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  await pgA.addScriptTag({ path: path.join(ROOT, 'src/net-ws.js') });
  await pgB.addScriptTag({ path: path.join(ROOT, 'src/net-ws.js') });
  const ws = 'ws://127.0.0.1:' + wsPort;
  await pgA.evaluate(arg => window.GW.NetWs.connect({ url: arg.u, room: 'ABC1', name: 'A', maxSamples: arg.n }), { u: ws, n: samples });
  await pgB.evaluate(arg => window.GW.NetWs.connect({ url: arg.u, room: 'ABC1', name: 'B', maxSamples: arg.n }), { u: ws, n: samples });
  const tPair = Date.now();
  while (Date.now() - tPair < 15000) {
    const a = await pgA.evaluate(() => window.__netspike && window.__netspike.paired);
    const b = await pgB.evaluate(() => window.__netspike && window.__netspike.paired);
    if (a && b) { out.paired = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  if (out.paired) {
    const t0 = Date.now();
    while (Date.now() - t0 < samples * 50 + 25000) {
      const done = await pgA.evaluate(() => window.__netspike && window.__netspike.done);
      if (done) break;
      await new Promise(r => setTimeout(r, 500));
    }
    out.statsA = await pgA.evaluate(() => window.__netspike.stats());
    out.statsB = await pgB.evaluate(() => window.__netspike.stats());
    out.ok = true;
    out.killTest = { mainsB: out.mainsB, pidsB: treeOf(out.mainsB) };
    /* 阶段一 FIN 路径：SIGKILL B 整组（内核立即关 socket），量服务端 dead 时刻；
       A 继续心跳——顺便证明幸存者不被误伤。 */
    const tKill = Date.now();
    out.killTest.tKill = tKill;
    for (const pid of out.killTest.pidsB) { try { process.kill(pid, 'SIGKILL'); } catch (e) {} }
    const tW1 = Date.now();
    while (Date.now() - tW1 < 4000 && !out.serverTcpClose) await new Promise(r => setTimeout(r, 50));
    out.killTest.aAliveAfterBKill = await pgA.evaluate(() => window.__netspike && window.__netspike.state).catch(() => 'page-dead?');
    try { await brA.close(); } catch (e) {}
    /* 阶段二 半开路径：新起一对轻量客户端（只配对不采样），SIGSTOP B2 整组，量心跳超时 */
    out.killTest.phase2 = {};
    const mains2Before = directChromeKidsOfDriver();
    const brA2 = await chromium.launch({ args: ['--allow-file-access-from-files'] });
    const mains2A = directChromeKidsOfDriver().filter(p => !mains2Before.includes(p));
    const brB2 = await chromium.launch({ args: ['--allow-file-access-from-files'] });
    const mains2B = directChromeKidsOfDriver().filter(p => !mains2Before.includes(p) && !mains2A.includes(p));
    const pidsB2 = treeOf(mains2B);
    out.killTest.phase2.pidsB2 = pidsB2;
    const qa = await brA2.newPage(), qb = await brB2.newPage();
    await qa.goto(url); await qb.goto(url);
    await qa.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
    await qb.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
    await qa.addScriptTag({ path: path.join(ROOT, 'src/net-ws.js') });
    await qb.addScriptTag({ path: path.join(ROOT, 'src/net-ws.js') });
    await qa.evaluate(arg => window.GW.NetWs.connect({ url: arg.u, room: 'STOP1', name: 'A2', maxSamples: arg.n }), { u: ws, n: 60 });
    await qb.evaluate(arg => window.GW.NetWs.connect({ url: arg.u, room: 'STOP1', name: 'B2', maxSamples: arg.n }), { u: ws, n: 60 });
    const tp = Date.now();
    while (Date.now() - tp < 10000) {
      const okA = await qa.evaluate(() => window.__netspike && window.__netspike.paired);
      const okB = await qb.evaluate(() => window.__netspike && window.__netspike.paired);
      if (okA && okB) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const tStop = Date.now();
    out.killTest.tStop = tStop;
    for (const pid of pidsB2) { try { process.kill(pid, 'SIGSTOP'); } catch (e) {} }
    const tW2 = Date.now();
    while (Date.now() - tW2 < 6000 && !out.serverHalfOpen) await new Promise(r => setTimeout(r, 100));
    for (const pid of pidsB2) { try { process.kill(pid, 'SIGKILL'); } catch (e) {} }
    try { await brA2.close(); } catch (e) {}
    try { await brB2.close(); } catch (e) {}
  }
  try { await brA.close(); } catch (e) {}
  try { await brB.close(); } catch (e) {}
  return out;
}
(async () => {
  const { p: srvProc, port: wsPort } = await startWsServer();
  console.log('ws server port=' + wsPort);
  let httpPort = null, httpSrv = null;
  if (SCHEME === 'http' || SCHEME === 'both') { const h = await serveStatic(); httpPort = h.port; httpSrv = h.srv; console.log('http static port=' + httpPort); }
  const results = [];
  if (SCHEME === 'file' || SCHEME === 'both') results.push(await runScheme('file', httpPort, wsPort, SAMPLES));
  const fileBlocked = results.length && !results[0].paired;
  if (SCHEME === 'http' || SCHEME === 'both') results.push(await runScheme('http', httpPort, wsPort, fileBlocked ? SAMPLES : Math.min(200, SAMPLES)));
  /* 服务端日志对表：half-open-timeout 与 tcp-close 首次出现的时间 */
  const srvLog = srvProc.logs;
  results.forEach(r => {
    if (!r.killTest) return;
    const half = r.killTest.tStop ? srvLog.find(x => x.l.indexOf('half-open-timeout') >= 0 && x.t >= r.killTest.tStop - 5) : null;
    const close = srvLog.find(x => (x.l.indexOf('reason=tcp-close') >= 0 || x.l.indexOf('reason=tcp-error') >= 0) && x.t >= r.killTest.tKill - 5);
    r.killTest.halfOpenDetectedMs = half ? half.t - r.killTest.tStop : null;
    r.killTest.tcpCloseMs = close ? close.t - r.killTest.tKill : null;
  });
  console.log(String.fromCharCode(10) + '===== RESULT =====');
  console.log(JSON.stringify(results, null, 1));
  console.log(String.fromCharCode(10) + '===== SERVER LOG（全量） =====');
  srvLog.forEach(x => console.log(x.l));
  srvProc.kill();
  if (httpSrv) httpSrv.close();
  process.exit(0);
})().catch(e => { console.error('DRIVER-FAIL', e); process.exit(1); });
