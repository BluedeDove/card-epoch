#!/usr/bin/env node
/* tools/shaderpack_check.cjs · 光影包「后处理子集」回归
   判据：
     1. 合法的最小包（shaders/final.fsh 反色）能加载、status.active=true；
     2. 加载失败（多 RT/gl_FragData[1]）必须 active=false 且 error 非空，页面/自研管线不崩；
     3. unload 后 active=false；
     4. 全流程零页面异常。
   这里不追求跑真实 OptiFine 包（那需要 gbuffers/shadow/多 pass）；只证明"子集边界"是真的可加载、
   失败会回落，而不是一个只会报 ok 的假入口。 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path'), zlib = require('zlib');
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
/* 极简 zip writer（deflate + CRC）：只为回归造两个包，不引第三方依赖 */
function zip(files) {
  const chunks = [], central = []; let off = 0;
  for (const name in files) {
    const n = Buffer.from(name), data = Buffer.from(files[name]);
    const comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 10); lh.writeUInt32LE(comp.length, 14); lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, n, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    central.push(ch, n); off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), out = Buffer.concat([Buffer.concat(chunks), cd]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([out, end]);
}
const valid = zip({ 'shaders/final.fsh': '\nuniform sampler2D colortex0;\nvarying vec2 texcoord;\nvoid main(){\n  vec4 c = texture2D(colortex0, texcoord);\n  gl_FragColor = vec4(1.0 - c.r, c.g, c.b, 1.0);\n}\n' });
const bad = zip({ 'shaders/final.fsh': 'void main(){ gl_FragData[1] = vec4(1.0); }\n' });
const gbuf = zip({
  'shaders/gbuffers_terrain.fsh': 'void main(){ gl_FragColor = vec4(1.0); }\n',
  'shaders/final.fsh': 'uniform sampler2D colortex0; void main(){ gl_FragColor = texture2D(colortex0, vec2(0.5)); }\n'
});
const chain = zip({
  'shaders/composite.fsh': 'uniform sampler2D colortex0; varying vec2 texcoord; void main(){ vec4 c = texture2D(colortex0, texcoord); gl_FragColor = vec4(1.0 - c.r, c.g, c.b, 1.0); }\n',
  'shaders/final.fsh': 'uniform sampler2D colortex0; varying vec2 texcoord; void main(){ vec4 c = texture2D(colortex0, texcoord); gl_FragColor = vec4(c.r, 1.0 - c.g, c.b, 1.0); }\n'
});
const terrain = zip({
  'shaders/gbuffers_terrain.vsh': '#version 120\nvarying vec2 vUv; void main(){ vUv = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy; gl_Position = gl_ProjectionMatrix * gl_ModelViewMatrix * gl_Vertex; }\n',
  'shaders/gbuffers_terrain.fsh': '#version 120\nuniform sampler2D texture; varying vec2 vUv; void main(){ gl_FragData[0] = texture2D(texture, vUv); }\n',
  'shaders/composite.fsh': 'uniform sampler2D gcolor; varying vec2 texcoord; void main(){ gl_FragColor = texture2D(gcolor, texcoord); }\n'
});
(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await PW.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2));
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  const r = await page.evaluate(async (arg) => {
    const v = arg.v, b = arg.b;
    const S = window.GWAPP;
    window.__GW_START({ mode: 'train', seed: 490706, deck: 'starter' });
    /* 首帧 SwiftShader 还在编译内置材质；等 1.5s + 30 帧再编译外部 shader，
       否则会拿到一个还没准备好的上下文（实测表现为 compile failed 且 infoLog 为空）。 */
    await new Promise((res) => setTimeout(res, 1500));
    for (let i = 0; i < 30; i++) await new Promise((res) => requestAnimationFrame(res));
    const dec = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const a = await window.GW.ShaderPack.loadBuffer(dec(v), 'valid.zip');
    await new Promise((res) => setTimeout(res, 300));
    const bad = await window.GW.ShaderPack.loadBuffer(dec(b), 'bad.zip');
    await new Promise((res) => setTimeout(res, 200));
    window.GW.ShaderPack.unload();
    const gb = await window.GW.ShaderPack.loadBuffer(dec(arg.g), 'gbuffer.zip');
    await new Promise((res) => setTimeout(res, 200));
    window.GW.ShaderPack.unload();
    const ch = await window.GW.ShaderPack.loadBuffer(dec(arg.c), 'chain.zip');
    await new Promise((res) => setTimeout(res, 200));
    window.GW.ShaderPack.unload();
    const tr = await window.GW.ShaderPack.loadBuffer(dec(arg.t), 'terrain.zip');
    await new Promise((res) => setTimeout(res, 200));
    window.GW.ShaderPack.unload();
    return { a, bad, gb, ch, tr, after: window.GW.ShaderPack.status(), broken: window.GW.SHADER.isBroken() };
  }, { v: valid.toString('base64'), b: bad.toString('base64'), g: gbuf.toString('base64'), c: chain.toString('base64'), t: terrain.toString('base64') });
  r.errs = errs;
  const pass = !!(r.a && r.a.active === true) && !!(r.bad && r.bad.active === false && r.bad.error) &&
    !!(r.gb && r.gb.active === false && r.gb.error === 'needs-gbuffers') &&
    !!(r.ch && r.ch.active === true && /composite\.fsh/.test(r.ch.pass) && /final\.fsh/.test(r.ch.pass)) &&
    !!(r.tr && r.tr.active === true && r.tr.gbuffer === true) &&
    !!(r.after && r.after.active === false) && r.broken === false && errs.length === 0;
  console.log(JSON.stringify({ pass, ...r }, null, 2));
  await browser.close(); srv.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('SHADERPACK PROBE ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
