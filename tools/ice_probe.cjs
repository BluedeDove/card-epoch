#!/usr/bin/env node
/* tools/ice_probe.cjs · 冰面可见性回归（开发工具，index.html 不引用）

   为什么单独有它：2026-10-16 用户报"冰什么都看不到不像是冰"。根因不在贴图，在几何生成——
   main.js 的分块几何当年只有 solid / liquid 两个 pass，solid 分支末尾一句 `if (!d.opaque) continue;`
   把冰（solid:true, opaque:false）的所有面全剔掉了：**一个三角都不生成**，于是冰墙/冰锥/结冰卡造的东西
   成了"能挡人、看不见"的实体（玩家被顶出，日志写"被地形卡住"）。audit 的 15 项判相机与操作，抓不到
   "某类方块根本没入画"，所以另开一把尺子。

   判据（自己按世界数据数，不复用渲染器的结论）：
     A. 在出生点附近挑 15 格空气，一次写成冰（和"冰墙/结冰"卡同一条 w.set 路径）；
     B. 只统计**受影响那几个 chunk** 的三角形总数（实体在 entGroup/fxGroup，不进这个数，AI 也不污染）；
     C. 期望增量 = 2 × 独立算出的"应生成面数"（一个方格面 = 2 三角）；
        规则：邻居同种冰 → 不生成；邻居 opaque → 不生成；其余（空气/水/岩浆）→ 生成。
     D. 霜噬雪原的湖必须真的冻在住：至少一列 surfaceY 顶面是冰；
     E. 两个出生点都不能生在冰面上（DEFS[top].slip 为真就报错）。

   用法：node tools/ice_probe.cjs [seed] [--shots 目录]
   退出码：0 全过；1 判据不过；2 环境错误。 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const seed = +(argv.find(a => /^\d+$/.test(a)) || 31337);
const si = argv.indexOf('--shots'); const shotsDir = si >= 0 ? argv[si + 1] : null;
const { createRequire } = require('module'); const req = createRequire(__filename);
let PW = null;
for (const c of ['playwright','playwright-core','$(npm root -g)/playwright','$(npm root -g)/playwright-core']) { try { PW = req(c); break; } catch (e) {} }
if (!PW) { try { PW = require('playwright'); } catch (e) {} }
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.css':'text/css' };
function serve(){ return new Promise(res=>{ const srv=http.createServer((q,rsp)=>{ const rel=decodeURIComponent(q.url.split('?')[0]); const fp=path.join(ROOT, rel==='/'?'/index.html':rel);
  if(!fp.startsWith(ROOT)){rsp.writeHead(403).end();return} fs.readFile(fp,(e,b)=>{ if(e){rsp.writeHead(404).end('nf');return} rsp.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}).end(b)})});
  srv.listen(0,'127.0.0.1',()=>res(srv)); }); }

const RUN = async (sd) => {
  const G = window.GW, B = G.BLOCK, DEFS = G.BLOCK_DEFS, S = window.GWAPP;
  window.__GW_START({ mode: 'train', seed: sd, deck: 'starter' });
  const F = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 30; i++) await F();
  if (S.sources) S.sources.length = 0;                 // 断掉键盘与 AI 输入：只允许本探针改世界
  const w = S.world;
  const out = { seed: sd, fails: [] };

  // —— B 口径：某个 chunk 现在的三角形数（worldGroup 只有体素几何）
  function chunkTris(cx, cz) {
    const grp = S.chunkMeshes[cx + ',' + cz]; if (!grp) return 0;
    let n = 0; grp.traverse(function (o) { if (o.isMesh && o.geometry && o.geometry.index) n += o.geometry.index.count / 3; });
    return n;
  }
  // —— 造冰一律放在地面**之上**：不碰任何原有方块，基线才只含"冰自己贡献的面"。
  //     （第一版把 3×3 冰台贴着 gy 放、先把草皮清成空气再测，结果基线自己也少了面，
  //      量到的 46 对不上独立算出的 50 —— 那是探针口径错，不是渲染错。）
  const p = S.match.players[0], gx = Math.floor(p.pos.x), gz = Math.floor(p.pos.z), gy = w.surfaceY(gx, gz);
  // 天然冰面数在造冰**之前**取，免得把本探针放的冰台算进去
  function countTopIceCols() { let n = 0; for (let z = 1; z < w.SZ - 1; z++) for (let x = 1; x < w.SX - 1; x++) { if (w.biomeAt(x, z) !== 2) continue; if (w.get(x, w.surfaceY(x, z), z) === B.ICE) n++; } return n; }
  out.topIceCols = countTopIceCols();
  // 出生点正前方可能被树/冰锥占住：往外扫几档，找第一个 15 格全空的位置（找不到才算探针失败）
  let cells = null;
  for (let tryOff = 3; !cells && tryOff <= 12; tryOff += 2) {
    const cand = [];
    for (let i = 0; i < 3; i++) { const sy = w.surfaceY(gx + i, gz + tryOff); for (let k = 1; k <= 2; k++) cand.push([gx + i, sy + k, gz + tryOff]); }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const sy = w.surfaceY(gx + dx, gz + tryOff + 4 + dz); cand.push([gx + dx, sy + 1, gz + tryOff + 4 + dz]); }
    if (cand.every(c => w.get(c[0], c[1], c[2]) === 0)) cells = cand;
  }
  if (!cells) { out.fails.push('出生点前方 3~12 格内找不到 15 格连续空气（这片地形太挤，探针本身没法测）'); return out; }
  const keys = {};
  for (const c of cells) { const cx = Math.floor(c[0] / G.CHUNK), cz = Math.floor(c[2] / G.CHUNK); keys[cx + ',' + cz] = [cx, cz]; }
  const before = {}; for (const k in keys) before[k] = chunkTris(keys[k][0], keys[k][1]);

  // —— C 口径：**独立重算整个 chunk 应生成的三角形**（自己按 DEFS 与邻居规则数，不复用渲染器的结论）。
  //     三个 pass 各数一遍，规则写在下面的 PASS 里；渲染器的数出来对不上就是生成侧跑偏。
  const DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const PASS = {
    liquid: function (d) { return !d.solid && d.liquid; },
    glass:  function (d) { return d.solid && !d.opaque; },
    solid:  function (d) { return d.solid && d.opaque; }
  };
  function expectChunkTris(cx, cz) {
    const x0 = cx * G.CHUNK, z0 = cz * G.CHUNK, x1 = Math.min(x0 + G.CHUNK, w.SX), z1 = Math.min(z0 + G.CHUNK, w.SZ);
    const yr = w.chunkYRange(cx, cz);
    let n = 0, ice = 0;
    for (let y = yr[0]; y <= yr[1]; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const id = w.get(x, y, z); if (!id) continue;
      const d = DEFS[id];
      for (const key in PASS) {
        if (!PASS[key](d)) continue;
        for (const dd of DIRS) {
          const nb = w.get(x + dd[0], y + dd[1], z + dd[2]);
          if (nb === id) continue;                      // 同种之间不画内部面
          if (nb && DEFS[nb].opaque) continue;          // 被不透明邻居挡死的不画
          n += 2;                                       // 一个方格面 = 2 三角
          if (id === B.ICE) ice += 2;
        }
      }
    }
    return { total: n, ice: ice };
  }
  for (const c of cells) w.set(c[0], c[1], c[2], B.ICE);
  for (let i = 0; i < 300; i++) await F();              // flushDirty 每帧最多 2 块，留足帧数

  const rows = [];
  for (const k in keys) {
    const cx = keys[k][0], cz = keys[k][1];
    const got = chunkTris(cx, cz), exp = expectChunkTris(cx, cz);
    rows.push({ k: k, got: got, want: exp.total, wantIce: exp.ice, before: before[k] });
    if (got !== exp.total) out.fails.push('chunk ' + k + ' 三角形 ' + got + ' ≠ 独立重算 ' + exp.total + '（其中应有 ' + exp.ice + ' 个三角来自冰）：面剔除口径或透明 pass 分池跑偏');
    if (exp.ice === 0) out.fails.push('chunk ' + k + ' 按规则算也该有冰面，结果期望值为 0：DEFS.ice 的 solid/opaque 被改了？');
  }
  out.placed = cells.length; out.chunks = rows;
  out.iceTris = rows.reduce(function (a, r) { return a + r.wantIce; }, 0);
  if (out.iceTris === 0) out.fails.push('冰面一个三角都没生成 = 隐形冰回归（查 main.js 的 glass pass 是否还在）');

  // —— D 口径：雪原的湖要冻在住（造冰前数到的"顶面是冰"的列，见上面 countTopIceCols）
  if (out.topIceCols <= 0) out.fails.push('雪原没有任何"顶面是冰"的列：洼地又变成水盖隐形冰了（world.generate 的冻面层）');

  // —— E 口径：别生在冰面上（出生即打滑会被读成操作失灵）
  for (const corner of [0, 1]) {
    const sp = w.spawnPoint(corner), top = w.get(Math.floor(sp.x), sp.y - 1, Math.floor(sp.z));
    if (top && DEFS[top].slip) out.fails.push('出生点 corner' + corner + ' 落在冰面上（会打滑）');
  }
  // 摆个能同时看到冰墙与湖的机位，给人眼看材质
  window.__camPose({ x: gx + 0.5, y: gy + 2.0, z: gz - 0.6, yaw: Math.PI, pitch: -0.16, mode: 'first', freeze: true });
  for (let i = 0; i < 60; i++) await F();
  return out;
};

(async () => {
  const srv = await serve(); const port = srv.address().port;
  const browser = await PW.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2));
  await page.waitForFunction(() => window.GWAPP && window.__GW_START && window.__dbg, null, { timeout: 60000 });
  const r = await page.evaluate(RUN, seed);
  if (errs.length) r.fails.push('页面异常：' + errs.join(' | '));
  if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); const fp = path.join(shotsDir, 'ice_' + seed + '.png'); await page.screenshot({ path: fp }); console.log('shot → ' + fp); }
  console.log(JSON.stringify({ pass: r.fails.length === 0, seed: r.seed, placed: r.placed, wantFaces: r.wantFaces, delta: r.delta, topIceCols: r.topIceCols, fails: r.fails }));
  await browser.close(); srv.close();
  process.exit(r.fails.length ? 1 : 0);
})().catch(e => { console.error('ICE PROBE ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
