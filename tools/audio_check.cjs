'use strict';
/* tools/audio_check.cjs · 音频三层（引擎 / 配方 / 门面）的回归门禁
   跑法：node tools/audio_check.cjs [--file]     --file 走双击 index.html 的真路径（file://）
   查四件事：
     1) 分层责任：引擎与配方层不许碰 DOM / THREE / 主循环；面向玩家的中文只能活在 hud 层
     2) 词汇表：源码里每一个 sfx('x') / Audio.play('x') 都必须能在 GW.SfxTable 里查到
        （名字对不上就是"点了没声"，这种漂移肉眼看不出来）
     3) 配方合法性：字段白名单、数值夹紧、每个事件都有可听的时长与能量
     4) 真发声：用 OfflineAudioContext 把每个事件渲染成样本，断言非静音、无 NaN、不削波、
        结尾不硬切，并且同一份配方两次渲染逐样本相同（确定性可复现）
   退出码：全过 0；任何一条失败 1；环境缺失 2。 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0, lines = [];
function ok(name, cond, detail) {
  if (cond) { pass++; lines.push('  \u2713 ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; lines.push('  \u2717 ' + name + (detail ? '  \u2192 ' + detail : '')); }
  return !!cond;
}
function section(t) { lines.push('\n' + t); }
function scrub(src) {
  let out = '', i = 0, st = 'code';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (st === 'code') {
      if (c === '/' && d === '/') { st = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { st = 'block'; i += 2; continue; }
      if (c === "'" || c === '"') { out += c; i++; const q = c; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
      out += c; i++; continue;
    }
    if (st === 'line') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '\n') st = 'code'; continue; }
    out += (c === '\n' ? '\n' : ' '); i++;
    if (st === 'block' && c === '*' && d === '/') { out += ' '; i += 2; st = 'code'; }
  }
  return out;
}
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function hitsOf(src, re) { const clean = scrub(src), out = []; let m; while ((m = re.exec(clean))) out.push(m[0]); return out; }

section('1) 分层责任');
[['src/audio-engine.js', '引擎层'], ['src/sfx-table.js', '配方层'], ['src/audio.js', '门面层']].forEach(function (p) {
  if (!fs.existsSync(path.join(ROOT, p[0]))) { ok(p[0] + ' 存在', false, '文件缺失'); return; }
  ok(p[0] + ' 存在', true);
  const src = read(p[0]);
  const re = /\bdocument\.|innerHTML|querySelector|createElementNS|\bTHREE\b|WebGLRenderingContext|window\.GWAPP|\bG\.HUD\b|GW\.HUD|\bG\.Creative\b/g;
  const hits = hitsOf(src, re);
  ok(p[1] + ' 不越层（无 DOM / 无 THREE / 不反向抓主循环）', hits.length === 0, hits.join(', ').slice(0, 80));
  const cnCode = (scrub(src).match(/[\u4e00-\u9fa5]/g) || []).length;
  ok(p[1] + ' 无面向玩家的中文（中文只在注释里）', cnCode === 0, cnCode ? cnCode + ' 处' : '');
});
(function () {
  const clean = scrub(read('src/sfx-table.js'));
  let body = clean;
  const OPEN = '(function (G) {', CLOSE = '})(window.GW);';
  const i0 = body.indexOf(OPEN), i1 = body.lastIndexOf(CLOSE);
  if (i0 >= 0 && i1 > i0) body = body.slice(0, i0) + body.slice(i1 + CLOSE.length);
  const bad = ['function', 'if (', 'for (', 'while (', 'Math.random', 'Date.now', 'new Date'].filter(function (w) { return body.indexOf(w) >= 0; });
  ok('配方层是纯数据（无函数 / 无分支 / 无循环 / 无随机）', bad.length === 0, bad.join(',').slice(0, 60));
})();

section('2) 调用点 \u2194 配方表 词汇表');
global.window = {};
require(path.join(ROOT, 'src/sfx-table.js'));
const T = global.window.GW.SfxTable.events;
const ids = Object.keys(T);
ok('配方表非空', ids.length >= 20, ids.length + ' 个事件');
const KEY_OK = { k: 1, w: 1, pw: 1, f: 1, f1: 1, gt: 1, d: 1, a: 1, dec: 1, s: 1, r: 1, v: 1, pan: 1, lp: 1, lp1: 1, hp: 1, hp1: 1, bp: 1, bp1: 1, q: 1, bpQ: 1, drive: 1, rev: 1, dly: 1, at: 1, rate: 1, vib: 1, vibR: 1 };
const WAVE_OK = { sine: 1, tri: 1, saw: 1, square: 1, pulse: 1, bell: 1, glass: 1 };
let schemaBad = [];
ids.forEach(function (id) {
  const ev = T[id];
  if (!ev.layers || !ev.layers.length) { schemaBad.push(id + ' 无层'); return; }
  if (!(ev.len > 0.02 && ev.len < 2.6)) schemaBad.push(id + ' len=' + ev.len);
  ev.layers.forEach(function (L, i) {
    Object.keys(L).forEach(function (kk) { if (!KEY_OK[kk]) schemaBad.push(id + '#' + i + ' 未知字段 ' + kk); });
    if (L.k !== 't' && L.k !== 'n') schemaBad.push(id + '#' + i + ' k=' + L.k);
    if (L.k === 't' && L.w && !WAVE_OK[L.w]) schemaBad.push(id + '#' + i + ' 波形 ' + L.w);
    if (!(L.v > 0.005 && L.v <= 0.9)) schemaBad.push(id + '#' + i + ' v=' + L.v);
    if (L.f !== undefined && !(L.f > 18 && L.f < 18000)) schemaBad.push(id + '#' + i + ' f=' + L.f);
    if (L.pan !== undefined && !(L.pan >= 0 && L.pan <= 1)) schemaBad.push(id + '#' + i + ' pan=' + L.pan);
    [['lp', L.lp], ['hp', L.hp], ['bp', L.bp]].forEach(function (q) { if (q[1] !== undefined && !(q[1] > 20 && q[1] < 20000)) schemaBad.push(id + '#' + i + ' ' + q[0] + '=' + q[1]); });
  });
});
ok('每条配方都在字段白名单内且数值夹紧', schemaBad.length === 0, schemaBad.slice(0, 6).join(' | '));
(function () {
  const skip = { 'audio-engine.js': 1, 'audio.js': 1, 'sfx-table.js': 1 };
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter(function (f) { return f.endsWith('.js') && !skip[f]; });
  const wanted = {};
  files.forEach(function (f) {
    const src = read('src/' + f);
    let m, re = /(?:\.sfx|Audio\.play)\s*\(([^()]{0,140})\)/g;
    while ((m = re.exec(src))) {
      const seg = m[1];
      const direct = seg.match(/^\s*'([a-zA-Z][a-zA-Z0-9]*)'\s*(,\s*[\w.]+\s*)?$/);
      if (direct) { wanted[direct[1]] = f; continue; }
      const a = seg.match(/\?\s*'([a-zA-Z][a-zA-Z0-9]*)'\s*:/), b = seg.match(/:\s*'([a-zA-Z][a-zA-Z0-9]*)'\s*[,)]?\s*$/);
      if (a) wanted[a[1]] = f;
      if (b) wanted[b[1]] = f;
    }
  });
  const missing = Object.keys(wanted).filter(function (n) { return !T[n]; });
  ok('源码里每个音效名都能在配方表查到（' + Object.keys(wanted).length + ' 个）', missing.length === 0, missing.map(function (n) { return n + '@' + wanted[n]; }).join(' '));
  const unused = ids.filter(function (n) { return !wanted[n]; });
  lines.push('  \u00b7 表里已备好、当前无调用点：' + (unused.join(', ') || '无'));
})();

function loadPlaywright() {
  const cands = ['playwright', 'playwright-core', '/data/miniconda3/miniconda3/lib/node_modules/playwright', '/data/miniconda3/miniconda3/lib/node_modules/playwright-core'];
  const { createRequire } = require('module');
  for (const c of cands) { try { return createRequire(__filename)(c); } catch (e) {} }
  try { return require('playwright'); } catch (e) {}
  return null;
}
const fileMode = process.argv.indexOf('--file') >= 0;
const PW = loadPlaywright();
if (!PW) { console.log(lines.join('\n') + '\n\n\u26a0 找不到 playwright，运行时断言未跑'); process.exit(2); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
function serve() {
  return new Promise(function (res) {
    const srv = http.createServer(function (req, rsp) {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
      if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
      fs.readFile(fp, function (e, buf) { if (e) { rsp.writeHead(404).end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(buf); });
    });
    srv.listen(0, '127.0.0.1', function () { res(srv); });
  });
}
(async function () {
  const srv = fileMode ? null : await serve();
  const url = fileMode ? 'file://' + path.join(ROOT, 'index.html') : 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await PW.chromium.launch({ args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', function (e) { errs.push(String(e.message || e)); });
  page.on('console', function (m) { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('!!(window.GW && GW.Audio && GW.AudioEngine && GW.SfxTable)', null, { timeout: 25000 }).catch(function () {});
  section('3) 运行时（headless Chromium）');
  ok('三层都挂上 GW（Audio / AudioEngine / SfxTable）', await page.evaluate('!!(window.GW && GW.Audio && GW.AudioEngine && GW.SfxTable)'));
  const api = await page.evaluate('(function(){var a=GW.Audio;return ["play","toggle","resume","names","stats","render","has"].map(function(k){return typeof a[k];});})()');
  ok('门面 API 完整（play/toggle/resume/names/stats/render/has）', api.every(function (t) { return t === 'function'; }), api.join(','));
  await page.evaluate('(function(){GW.Audio.resume();return 1;})()');
  const playAll = { thrown: [], played: 0, refused: [] };
  for (let i = 0; i < ids.length; i++) {
    await page.waitForFunction('GW.AudioEngine.voices() < 10', null, { timeout: 5000 }).catch(function () {});
    const r = await page.evaluate('(function(n){try{return {ok:GW.Audio.play(n),why:GW.AudioEngine.skipReason()};}catch(e){return {err:String(e)};}})(' + JSON.stringify(ids[i]) + ')');
    if (r.err) playAll.thrown.push(ids[i] + ': ' + r.err);
    else if (r.ok) playAll.played++; else playAll.refused.push(ids[i] + '=' + r.why);
  }
  ok('逐个 play 不抛异常（' + ids.length + ' 个事件）', playAll.thrown.length === 0, playAll.thrown.slice(0, 3).join(' | '));
  ok('每个事件都真被排出去（先等复音排空，played 必须等于表大小）', playAll.played === ids.length, 'played=' + playAll.played + ' refused=' + playAll.refused.slice(0, 4).join(' '));
  await page.waitForFunction('GW.AudioEngine.voices() < 10', null, { timeout: 5000 }).catch(function () {});
  const thr = await page.evaluate('(function(){GW.Audio.resume();var a=GW.Audio.play("crystal"),b=GW.Audio.play("crystal");return {first:a,second:b,stats:GW.Audio.stats()};})()');
  ok('同名事件 28ms 内不重放（节流挡重复叠加）', thr.first === true && thr.second === false && thr.stats.skipThrottle > 0, JSON.stringify({ first: thr.first, second: thr.second, skipThrottle: thr.stats.skipThrottle }));
  const budget = await page.evaluate('(function(){var out={refused:0,peakVoices:0,max:GW.AudioEngine.maxVoices};for(var i=0;i<60;i++){if(!GW.AudioEngine.playLayers(GW.SfxTable.events.win.layers,0,"sfx"))out.refused++;if(GW.AudioEngine.voices()>out.peakVoices)out.peakVoices=GW.AudioEngine.voices();}return out;})()');
  ok('复音硬上限：引擎边建层边查，节点数不穿上限（60 次轰炸胜利号角）', budget.peakVoices <= budget.max && budget.refused > 0, 'peakVoices=' + budget.peakVoices + '/' + budget.max + ' refused=' + budget.refused);
  const mute = await page.evaluate('(function(){var t=GW.Audio.toggle();var s=(function(){try{return localStorage.getItem("gw.muted");}catch(e){return null;}})();GW.Audio.toggle();return {toggled:t,stored:s,after:GW.Audio.enabled};})()');
  ok('静音翻转并写进 localStorage（M 键持久化）', mute.toggled === false && mute.stored === '1' && mute.after === true, JSON.stringify(mute));
  section('4) 离线渲染真样本（OfflineAudioContext）');
  const rendered = await page.evaluate('Promise.all(Object.keys(GW.SfxTable.events).map(function(n){return GW.Audio.render(n).then(function(b){if(!b)return {n:n,err:1,rms:0,nan:0,peak:0,head:1,tail:1};var peak=0,nan=0,sum=0,first=0,last=0,i,v;for(i=0;i<b.N;i++){v=Math.max(Math.abs(b.L[i]),Math.abs(b.R[i]));if(v!==v)nan++;else{if(v>peak)peak=v;sum+=v*v;}}for(i=0;i<200;i++)first+=Math.abs(b.L[i]);for(i=b.N-200;i<b.N;i++)last+=Math.abs(b.L[i]);return {n:n,peak:peak,rms:Math.sqrt(sum/b.N),nan:nan,N:b.N,head:first/200,tail:last/200};});})).then(function(a){return a;})');
  const R = rendered || [];
  ok('每个事件都真出声（rms \u2265 0.004）', R.filter(function (r) { return r.err || r.rms < 0.004; }).length === 0 && R.length === ids.length, R.filter(function (r) { return r.err || r.rms < 0.004; }).map(function (r) { return r.n + '=' + (r.rms || 0).toFixed(4); }).join(' '));
  ok('无 NaN / Infinity', R.filter(function (r) { return r.nan > 0; }).length === 0, R.filter(function (r) { return r.nan > 0; }).map(function (r) { return r.n; }).join(' '));
  ok('无削波（peak < 0.999）', R.filter(function (r) { return r.peak >= 0.999; }).length === 0, R.filter(function (r) { return r.peak >= 0.999; }).map(function (r) { return r.n + '=' + r.peak.toFixed(3); }).join(' '));
  ok('每条音效收尾自然（末尾 200 样本不是硬切）', R.filter(function (r) { return r.tail > Math.max(r.head * 0.9, 0.02); }).length === 0, R.filter(function (r) { return r.tail > Math.max(r.head * 0.9, 0.02); }).map(function (r) { return r.n; }).join(' '));
  const det = await page.evaluate('Promise.all([GW.Audio.render("thunder"),GW.Audio.render("thunder")]).then(function(p){var a=p[0],b=p[1];if(!a||!b||a.N!==b.N)return {diff:-1};var d=0,i,x;for(i=0;i<a.N;i++){x=Math.abs(a.L[i]-b.L[i]);if(x>d)d=x;}return {diff:d,N:a.N};})');
  ok('确定性：同一事件渲染两次逐样本一致（容差 1e-6，只许浮点末位差）', !!det && det.diff >= 0 && det.diff < 1e-6, 'maxDiff=' + (det ? det.diff : 'n/a'));
  const lv = await page.evaluate('GW.Audio.render("win",2.4).then(function(b){var zc=0,prev=0,i,v;for(i=0;i<b.N;i++){v=b.L[i];if((v>=0)!==(prev>=0))zc++;prev=v;}return {zc:zc/(b.N/b.sampleRate)};})');
  ok('有实际音频内容（平均过零率 > 500/s）', !!lv && lv.zc > 500, 'zc=' + (lv ? Math.round(lv.zc) : 'n/a'));
  section('5) 页面健康');
  ok('页面加载与音频层无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  if (srv) srv.close();
  console.log(lines.join('\n'));
  console.log('\n音频检查：' + pass + ' 过 / ' + fail + ' 败');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log(lines.join('\n') + '\n\n\u2717 运行异常：' + (e && e.stack || e)); process.exit(2); });
