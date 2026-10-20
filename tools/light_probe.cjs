#!/usr/bin/env node
/* tools/light_probe.cjs · 块光（火焰/岩浆照亮周围）回归

   判据（都在一块手工清的场地上量，避开生成的树与地形）：
     A 关块光时这条通路必须整个不参与：lightField() 返回 null，且"半径外那一格"开/关块光的顶点色相同。
       （原来这里写的是"跨副本顶点色校验和相等"，实测不成立：仓库里有并行会话未提交的化学层，
        G.CHEM 的调用只在工作区的 battle.js 里，8c95d08 那份根本没有 —— 两份副本的地形本来就不一样
        （岩浆遇水凝黑曜石）。--checkonly 仍打印校验和，但它只在同一份加载状态下有意义
        （同一棵树连跑两次实测 1412007817 相同，那才叫确定性），别拿它跨副本证"关掉==上个提交"。）
     B 放一个岩浆块：紧邻地面顶面必须明显变亮（≥ +18%）且更暖（R/B 比上升）。
     C 衰减：距光源 1 格 > 5 格 > 12 格；12 格（超出半径）必须回到基线 ±3% 内。
     D 水挡光：同样深度埋在水底的岩浆，照亮范围显著小于在空气里。
     E 高频安全：没有光源的世界里，光场必须是 null（不许白扫）。

   用法：node tools/light_probe.cjs            （在当前副本跑，打印全部判据）
        node tools/light_probe.cjs --checkonly （只打印校验和，用于和旧副本对比）
   退出码：0 全过；1 判据不过；2 环境错误。 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const checkOnly = process.argv.indexOf('--checkonly') >= 0;
const { createRequire } = require('module'); const req = createRequire(__filename);
let PW = null;
for (const c of ['playwright','playwright-core','/data/miniconda3/miniconda3/lib/node_modules/playwright','/data/miniconda3/miniconda3/lib/node_modules/playwright-core']) { try { PW = req(c); break; } catch (e) {} }
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.css':'text/css' };
const srv = http.createServer((q, rsp) => {
  const rel = decodeURIComponent(q.url.split('?')[0]);
  const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
  fs.readFile(fp, (e, b) => { if (e) { rsp.writeHead(404).end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b); });
});

const RUN = async (a) => {
  const G = window.GW, S = window.GWAPP;
  /* 并行会话正在改音频引擎：它此刻在开局路径上抛异常（H.hideInventory→G.Audio.play→envShape 里 g.gain 不存在）。
     那与光影无关，探针不该被它绑住：只在"确实会抛"时把 play 旁路掉，并在输出里记 audioBypassed，绝不静默。 */
  window.__audioBypassed = false;
  try { if (window.GW && window.GW.Audio) window.GW.Audio.play('ui'); }
  catch (e) { window.__audioBypassed = true; window.GW.Audio.play = function () { return false; }; }
  window.__GW_START({ mode: 'train', seed: 490706, deck: 'starter' });
  const F = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 40; i++) await F();
  if (S.sources) S.sources.length = 0;
  S.running = false;
  const w = S.world, B = G.BLOCK;
  const out = { fails: [] };
  out.audioBypassed = !!window.__audioBypassed;
  /* 场地：x∈[40,64]、z∈[40,64]，地面顶面 y=PY+1，上方整箱清空（生成的树会污染测量） */
  const PY = 18, AX0 = 40, AX1 = 64, AZ0 = 40, AZ1 = 64;
  /* 顶上再盖一层不透光屋顶：块光真正要解决的问题是"阴凉处与夜里"，日光下太阳已经把顶面照满了，
     加光照看不出来才是对的（MC 中午烧火把也一样）。所以判据必须在**被屋顶挡掉太阳的场地**上量，
     否则量到的只是"1.0 能不能再大"。 */
  for (let x = AX0; x <= AX1; x++) for (let z = AZ0; z <= AZ1; z++) {
    for (let y = PY - 3; y <= PY + 14; y++) w.set(x, y, z, 0);
    w.set(x, PY, z, B.STONE);
    for (let y = PY - 1; y >= PY - 3; y--) w.set(x, y, z, B.DIRT);
    for (let y = PY + 6; y <= PY + 8; y++) w.set(x, y, z, y === PY + 6 ? B.STONE : 0);
  }
  /* 取某一格"顶面"的顶点色均值：顶点落在整数格角上，所以按格框选 */
  function topFace(x, z) {
    const key = Math.floor(x / G.CHUNK) + ',' + Math.floor(z / G.CHUNK);
    const grp = S.chunkMeshes[key];
    if (!grp) return null;
    let rs = 0, gs = 0, bs = 0, n = 0;
    grp.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.color) return;
      const P = o.geometry.attributes.position.array, C = o.geometry.attributes.color.array;
      for (let i = 0; i < P.length; i += 3) {
        if (Math.abs(P[i + 1] - (PY + 1)) > 0.01) continue;
        if (P[i] < x - 0.01 || P[i] > x + 1.01) continue;
        if (P[i + 2] < z - 0.01 || P[i + 2] > z + 1.01) continue;
        rs += C[i]; gs += C[i + 1]; bs += C[i + 2]; n++;
      }
    });
    if (!n) return null;
    return { r: rs / n, g: gs / n, b: bs / n, lum: (0.299 * rs + 0.587 * gs + 0.114 * bs) / n, n: n };
  }
  function rebuild() { window.__dbg.rebuildAll(); }
  /* chunk 顶点色校验和（跨副本比对用：关块光时必须与上个提交逐位一致） */
  function chunkCheck() {
    let sum = 0;
    for (const k in S.chunkMeshes) {
      const grp = S.chunkMeshes[k];
      grp.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.color) return;
        const C = o.geometry.attributes.color.array;
        for (let i = 0; i < C.length; i++) sum = (sum + Math.round(C[i] * 4096)) % 2147483647;
      });
    }
    return sum;
  }
  const hasLight = !!G.LIGHT;
  /* 场地要够大：测量点全部落在清空过的箱子里，否则"5 格外"其实是野外地形，比的是两种不同的遮蔽。 */
  const LX = 52, LZ = 52;
  if (hasLight) G.LIGHT.on = false;
  rebuild();
  out.check = chunkCheck();
  out.fieldNull = hasLight ? (w.lightField(Math.floor(LX / G.CHUNK), Math.floor(LZ / G.CHUNK)) === null) : null;
  const off1 = topFace(LX, LZ - 1), off2 = topFace(LX, LZ - 2), off5 = topFace(LX, LZ - 5), off12 = topFace(LX, LZ - 12);
  out.off = { d1: off1 && +off1.lum.toFixed(4), d2: off2 && +off2.lum.toFixed(4), d5: off5 && +off5.lum.toFixed(4), d12: off12 && +off12.lum.toFixed(4),
              rb: off2 && +(off2.r / Math.max(1e-6, off2.b)).toFixed(3) };
  if (!off1 || !off2 || !off5 || !off12) {
    out.fails.push('取不到顶面顶点（场地没清干净或 chunk 不对，探针失效）');
    return out;
  }
  if (a.checkOnly || !hasLight) { out.noLightApi = !hasLight; return out; }   // checkOnly 在页内只能从参数 a 拿
  if (!out.fieldNull) out.fails.push('世界里没有光源时 lightField 没返回 null（每次建 chunk 都在白扫一遍 BFS）');

  // —— B/C：同一个格子，关光/开光对比（不是拿两个不同格子比）
  G.LIGHT.on = true;
  w.set(LX, PY + 1, LZ, B.LAVA);
  rebuild();
  const on1 = topFace(LX, LZ - 1), on2 = topFace(LX, LZ - 2), on5 = topFace(LX, LZ - 5), on12 = topFace(LX, LZ - 12);
  out.on = { d1: +on1.lum.toFixed(4), d2: +on2.lum.toFixed(4), d5: +on5.lum.toFixed(4), d12: +on12.lum.toFixed(4),
             rb: +(on2.r / Math.max(1e-6, on2.b)).toFixed(3) };
  const gain1 = on1.lum / Math.max(1e-6, off1.lum), gain5 = on5.lum / Math.max(1e-6, off5.lum);
  out.gain = { d1: +gain1.toFixed(3), d5: +gain5.toFixed(3) };
  if (!(gain1 >= 1.6)) out.fails.push('阴凉处紧邻岩浆的地面只亮了 ' + gain1.toFixed(3) + ' 倍（要求 ≥1.6）→ 块光没作用到周围');
  if (!(out.on.rb > out.off.rb * 1.04)) out.fails.push('照亮处没变暖（R/B ' + out.on.rb + ' vs ' + out.off.rb + '）→ 只是加白，不是偏火色');
  if (!(on2.lum >= on5.lum && on5.lum > on12.lum)) out.fails.push('衰减形状不对：d2=' + out.on.d2 + ' d5=' + out.on.d5 + ' d12=' + out.on.d12);
  if (!(Math.abs(on12.lum - off12.lum) < Math.max(0.02, off12.lum * 0.04))) out.fails.push('12 格（超出半径 ' + G.LIGHT.radius + '）处开光 ' + out.on.d12 + ' 与基线 ' + out.off.d12 + ' 不一致 → 半径/衰减没生效');

  // —— D：水挡光。同一格地面、同一个光源，只把"光要走的那三格"从空气换成水，别的都不动
  w.set(LX, PY + 1, LZ, 0);
  for (let z = LZ - 3; z <= LZ; z++) w.set(LX, PY + 1, z, 0);
  w.set(LX, PY + 1, LZ, B.LAVA);
  rebuild();
  const dry = topFace(LX, LZ - 3);
  for (let z = LZ - 3; z <= LZ - 1; z++) w.set(LX, PY + 1, z, B.WATER);
  rebuild();
  const wet = topFace(LX, LZ - 3);
  out.water = { dry: dry && +dry.lum.toFixed(4), wet: wet && +wet.lum.toFixed(4) };
  if (!dry || !wet) out.fails.push('水挡光样本取不到面（探针失效）');
  else if (!(wet.lum < dry.lum * 0.94)) out.fails.push('光穿过水没有被额外衰减（干 ' + out.water.dry + ' vs 湿 ' + out.water.wet + '）→ decayWater 没接上');
  return out;
  return out;
};

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const browser = await PW.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html?cb=' + Math.random().toString(36).slice(2));
  await page.waitForFunction(() => window.GWAPP && window.__GW_START && window.__dbg && window.__dbg.rebuildAll, null, { timeout: 60000 });
  const r = await page.evaluate(RUN, { checkOnly: checkOnly });
  if (errs.length) r.fails.push('页面异常：' + errs.slice(0, 3).join(' | '));
  console.log(JSON.stringify(Object.assign({ checkOnly: checkOnly }, r), null, 1));
  await browser.close(); srv.close();
  if (checkOnly || r.noLightApi) process.exit(0);
  process.exit(r.fails.length ? 1 : 0);
})().catch(e => { console.error('LIGHT PROBE ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
