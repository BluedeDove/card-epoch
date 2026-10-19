#!/usr/bin/env node
/* tools/vfx_live.cjs · 特效渲染层与物质层的"真页面"回归（要 GL，与 tools/vfx_check.cjs 互补）

   为什么两个都要：vfx_check 在 node 里跑，只保证「算」这一式没错；
   「画」（src/vfx-render.js）与「烧」（src/chem.js）只有真的开页面才验得到：
     · script 标签顺序错了 → GW.VFX 没注册，画面安静地什么都没有（最容易被当成"正常"的哑失败）；
     · 槽位池 / 共享材质 / 顶点预算没生效 → 自动化环境帧率本来就低，必须数出来；
     · 特效接管法阵后，老那张贴图阵必须真的不画（两套同心圆叠起来会糊出摩尔纹）；
     · 火扔到树上、寒砸到水面上，最后逐格看世界状态是否真的烧穿 / 结冰。
   所有等待都用**轮询条件**（waitForFunction），不用 sleep：SwiftShader 下一张截图就要一两秒，
   按墙上时间断言会把"其实跑到了"读成"没跑到"（第一版就是这么误报三条）。

       node tools/vfx_live.cjs [seed] [--shots /tmp/目录]
   全过退出码 0；任何一条红，退出码 1。
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
let shotsDir = null; const seeds = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--shots') shotsDir = argv[++i];
  else if (String(argv[i]).trim() !== '') seeds.push(+argv[i]);
}
if (!seeds.length) seeds.push(490706);
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2190 ' + extra : '')); }
}
function loadPlaywright() {
  const cands = ['playwright', 'playwright-core',
    '$(npm root -g)/playwright',
    '$(npm root -g)/playwright-core'];
  const { createRequire } = require('module');
  for (const c of cands) { try { return createRequire(__filename)(c); } catch (e) { } }
  try { return require('playwright'); } catch (e) { }
  return null;
}
const PW = loadPlaywright();
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const { chromium } = PW;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
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
  const srv = await serve();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  const poll = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 12000, polling: 60 }).then(() => true).catch(() => false);
  const shot = async (tag) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, tag + '.png') }); };

  console.log('\u2500\u2500 1. 页面装配（脚本顺序错了就是安静地什么都没有）');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = ['src/world.js', 'src/chem.js', 'src/cards.js', 'src/rules.js', 'src/battle.js', 'src/vfx.js', 'src/vfx-recipes.js', 'src/vfx-render.js', 'src/main.js'];
  let last = -1, seqOk = true;
  order.forEach(f => { const i = html.indexOf('<script src="' + f + '"></script>'); if (i < 0 || i < last) seqOk = false; if (i >= 0) last = i; });
  ok('index.html 按 world → chem → cards/rules/battle → vfx → recipes → render → main 加载', seqOk);

  await page.goto(url);
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  /* 音效词汇探针。tools/audio_check.cjs 只做**静态**反查（源码里出现的 id 在配方表里查得到），
     它证明不了"这条反应在真运行时被说出来"。这里包住门面的 play，记下每个被报出的 id：
     化学层 / 弹道层与音效层之间的词汇哪天漂了（改了 key 忘了改表，或反过来），
     人耳永远发现不了，只有"到底说没说"这种断言能抓到。 */
  await page.evaluate(() => {
    window.__sfx = [];
    const A = window.GW && window.GW.Audio;
    if (A && typeof A.play === 'function') { const orig = A.play.bind(A); A.play = function (n, w) { window.__sfx.push(String(n)); return orig(n, w); }; }
  });
  const sfxSaid = async (id) => (await page.evaluate(() => window.__sfx || [])).indexOf(id) >= 0;
  const sfxList = async () => await page.evaluate(() => Array.from(new Set(window.__sfx || [])));
  const boot = await page.evaluate(() => ({
    vfx: !!(window.GW && window.GW.VFX), vfxr: !!(window.GW && window.GW.VFXR && window.GW.VFXR.enabled),
    chem: !!(window.GW && window.GW.CHEM),
    recipes: window.GW.VFX ? Object.keys(window.GW.VFX.RECIPES).length : 0,
    chemHooks: window.GW.WORLD_HOOKS ? window.GW.WORLD_HOOKS.onSet.length : 0,
    bad: window.GW.VFX ? window.GW.VFX.validateAll() : ['?'],
    binds: [Object.keys(window.GW.VFX.CARD_FX_EL || {}).length, Object.keys(window.GW.VFX.CARD_BY_ID_FX || {}).length,
            Object.keys(window.GW.VFX.PROJECTILE_FX_EL || {}).length, Object.keys(window.GW.VFX.CHEM_FX || {}).length]
  }));
  ok('GW.VFX / GW.VFXR / GW.CHEM 三家常都在', boot.vfx && boot.vfxr && boot.chem, JSON.stringify(boot).slice(0, 160));
  ok('配方 ≥34 条（25 + 六套组合 + 六条反应 + 两条拖尾）', boot.recipes >= 34, '实际 ' + boot.recipes);
  ok('配方自检无告警', boot.bad.length === 0, boot.bad.join(' ;; '));
  ok('世界钩子挂上了唤醒回调', boot.chemHooks >= 1, 'hooks=' + boot.chemHooks);
  ok('四张绑定表都在（元素/卡 id/抛射物元素/反应）', boot.binds.every(n => n > 0), JSON.stringify(boot.binds));

  console.log('\n\u2500\u2500 2. 火扔上树：真页面里逐格烧穿 + 特效画出来没有');
  await page.evaluate(([sd]) => { window.__GW_START({ seed: sd, deck: 'fire', mode: 'train', oppDeck: 'nature' }); }, [seeds[0]]);
  await page.waitForFunction(() => window.GWAPP && window.GWAPP.match && window.GWAPP.running, null, { timeout: 60000 });
  const scene = await page.evaluate(() => {
    const G = window.GW, S = window.GWAPP, m = S.match, w = S.world;
    const X = 20, Z = 20;
    for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) for (let y = w.sea + 6; y < w.SY; y++) w.set(X + a, y, Z + c, 0);
    const base = w.surfaceY(X, Z) + 1;
    for (let i = 0; i < 4; i++) w.set(X, base + i, Z, G.BLOCK.LOG);
    for (let dy = 3; dy <= 5; dy++) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) w.set(X + a, base + dy, Z + c, G.BLOCK.LEAF);
    m.players[0].pos.set(X + 0.5, base + m.players[0].h / 2 + 0.02, Z - 6.5);
    window.__camPose({ x: X + 0.5, z: Z - 6.5, yaw: 0, pitch: 0.1, mode: 'first' });
    window.__sceneBase = base;
    return { base: base, fuel: 4 + 27, surface: w.surfaceY(X, Z) };
  });
  ok('场地备好：4 原木 + 27 树叶', scene.fuel === 31, JSON.stringify(scene));
  await shot('01-场地与树');
  const fired = await page.evaluate(() => {
    const G = window.GW, m = window.GWAPP.match, p = m.players[0], y = window.__sceneBase + 4;
    p.hand = ['bolt']; p.mana = 10; p.cooldowns = {};
    p.aim = { x: 20.5, y: y + 0.5, z: 20.5, gx: 20, gy: y, gz: 20, face: [0, -1, 0], dist: 7 };
    const played = m.playCard(p, 0);
    return { played: played, projectiles: m.projectiles.length, fuse: m.projectiles[0] ? +m.projectiles[0].fuse.toFixed(2) : 0 };
  });
  ok('焰矢出手（近失圈 ' + fired.fuse + ' 格）', fired.played && fired.projectiles === 1, JSON.stringify(fired));
  const litUp = await poll(() => window.GW.CHEM.countBurning() > 0 && window.GW.VFXR.stats.events > 0);
  const atFire = await page.evaluate(() => ({ burning: window.GW.CHEM.countBurning(), live: window.GW.VFXR.stats.live, events: window.GW.VFXR.stats.events }));
  ok('火真的烧起来了（' + atFire.burning + ' 格在烧）', litUp && atFire.burning > 0, JSON.stringify(atFire));
  ok('反应报到了渲染层（一次性事件 ' + atFire.events + ' 个）', atFire.events > 0, JSON.stringify(atFire));
  ok('火着起来时音效词汇真的被说出（ignite）', await sfxSaid('ignite'), JSON.stringify(await sfxList()));
  ok('焰矢落地起爆按**元素**出声（fire→boom，不再一律 hit）', await sfxSaid('boom'), JSON.stringify(await sfxList()));
  await page.evaluate(() => {                                   // 取景：蹲下来平视树干，火才在画面里
    window.__camPose({ x: 20.5, z: 16.0, yaw: 0, pitch: -0.02, mode: 'first' });
  });
  await shot('02-起火与反应特效');
  const spread = await poll(() => window.GW.CHEM.stats.byId.spread > 5);
  ok('火自己在蔓延（spread 计数跑起来）', spread, JSON.stringify(await page.evaluate(() => window.GW.CHEM.stats.byId)));
  /* 轮询"剩下的可燃物"而不是 burnout 计数：蔓延与成灰是两条独立节拍，
     计数够多了也可能还剩一大截没烧完（第一版就卡在这，读到 30/31）。 */
  const burntOut = await poll(() => {
    const G = window.GW, w = window.GWAPP.match.world, base = window.__sceneBase;
    let left = 0;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (let y = base; y < base + 6; y++) { const id = w.get(20 + a, y, 20 + c); if (id === G.BLOCK.LEAF || id === G.BLOCK.LOG) left++; }
    return left < 8;
  }, null, 30000);
  const burnt = await page.evaluate(() => {
    const G = window.GW, w = window.GWAPP.match.world, base = window.__sceneBase;
    let left = 0;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (let y = base; y < base + 6; y++) { const id = w.get(20 + a, y, 20 + c); if (id === G.BLOCK.LEAF || id === G.BLOCK.LOG) left++; }
    return { left: left, byId: JSON.parse(JSON.stringify(window.GW.CHEM.stats.byId)) };
  });
  ok('树被烧穿（31 格可燃物只剩 ' + burnt.left + ' 格）', burntOut && burnt.left < 8, JSON.stringify(burnt));
  await shot('03-烧穿之后');

  console.log('\n\u2500\u2500 3. 复杂组合与法阵接管');
  const sig = await page.evaluate(() => {
    const G = window.GW, m = window.GWAPP.match, p = m.players[0];
    const y = m.world.surfaceY(20, 26);
    p.hand = ['meteors']; p.mana = 12; p.cooldowns = {};
    p.aim = { x: 20.5, y: y + 1.2, z: 26.5, gx: 20, gy: y, gz: 26, face: [0, 1, 0], dist: 6 };
    m.playCard(p, 0);
    p.hand = ['glacier']; p.mana = 12; p.cooldowns = {};
    p.aim = { x: 20.5, y: y + 1.2, z: 31.5, gx: 20, gy: y, gz: 31, face: [0, 1, 0], dist: 9 };
    m.playCard(p, 0);
    const layers = G.VFX.RECIPES.archon_seal.layers.length + G.VFX.RECIPES.orrery_wheel.layers.length;
    window.__camPose({ x: 20.5, z: 21.5, yaw: 0, pitch: -0.52, mode: 'first' });
    return { sigils: m.sigils.length, meshes: m.sigils.filter(s => !!s.mesh).length, fx: m.sigils.map(s => s.preset.fx).join(','), layers: layers };
  });
  ok('布下陨星 + 冰川两座阵', sig.sigils === 2, JSON.stringify(sig));
  ok('特效渲染层接管后不再建老贴图阵（mesh=0）', sig.meshes === 0, JSON.stringify(sig));
  const drew = await poll(() => window.GW.VFXR.stats.hosts >= 4 && window.GW.VFXR.stats.live >= 12);
  const ds = await page.evaluate(() => JSON.parse(JSON.stringify(window.GW.VFXR.stats)));
  ok('层真的画出来了（槽位 ' + ds.live + '、宿主 ' + ds.hosts + '、单帧顶点 ' + ds.vertsFrame + '）', drew && ds.live >= 12 && ds.hosts >= 4, JSON.stringify(ds).slice(0, 200));
  ok('顶点预算内（单帧 ≤60000）', ds.vertsFrame <= 60000, JSON.stringify(ds).slice(0, 200));
  ok('反应画面反馈有闸门（发生 ' + (await page.evaluate(() => window.GW.CHEM.stats.reacts)) +
     ' 次，只放行 ' + (await page.evaluate(() => window.GW.CHEM.stats.fxEmitted)) + ' 次给画面）',
     (await page.evaluate(() => window.GW.CHEM.stats.fxEmitted)) > 0);
  ok('没把预算挤爆（skipped ' + ds.skipped + ' < 8）', ds.skipped < 8, JSON.stringify(ds).slice(0, 160));
  const archon = await page.evaluate(() => {
    const G = window.GW;
    const f = G.VFX.frame({ uid: 9, born: 0, delay: 0.4, ttl: 6, radius: 3, preset: { kind: 'fire' } }, 3.1, 0.016, { recipe: 'archon_seal' });
    const o = {}; f.layers.forEach(l => { o[l.prim] = (o[l.prim] || 0) + 1; });
    return { layers: f.layers.length, prims: o, phase: f.phase.name };
  });
  ok('超位阵 archon_seal 一次求值交出 ' + archon.layers + ' 层、覆盖 ' + Object.keys(archon.prims).length + ' 类原子',
    archon.layers >= 9 && Object.keys(archon.prims).length >= 5, JSON.stringify(archon));
  await page.evaluate(() => {                                   // 取景：站到阵边上低头看，别对着树冠
    window.__camPose({ x: 20.5, z: 19.0, yaw: 0, pitch: -0.44, mode: "first" });
  });
  await shot('04-双法阵亮阵');
  await page.evaluate(() => { window.__camPose({ x: 20.5, z: 36.0, yaw: 3.14159, pitch: -0.42, mode: "first" }); });
  await shot('04b-冰川阵近景');
  /* 出招那一下只亮 0.55 秒，SwiftShader 截图却要一两秒 —— 抓拍不到就先按节拍重放同一个事件，
     看的是同一段代码同一条配方，只是让它一直在屏上（不是给自己造好看的照片）。 */
  await page.evaluate(() => {
    const G = window.GW, m = window.GWAPP.match;
    window.__spam = setInterval(() => {
      G.VFX.event('cast', { card: G.CARDS_BY_ID.meteors, owner: m.players[0], side: 0, element: 'fire', pos: { x: 20.5, y: m.world.surfaceY(20, 26) + 1.05, z: 26.5 } });
      G.VFX.event('cast', { card: G.CARDS_BY_ID.glacier, owner: m.players[0], side: 0, element: 'ice', pos: { x: 20.5, y: m.world.surfaceY(20, 31) + 1.05, z: 31.5 } });
      G.VFX.event('react', { kind: 'ignite', x: 20.5, y: m.world.surfaceY(20, 26) + 1.2, z: 26.5, color: '#ff7a45' });
    }, 130);
  });
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => { window.__camPose({ x: 20.5, z: 22.0, yaw: 0, pitch: -0.62, mode: 'first' }); });
  await shot('04c-出招瞬间的超位阵');
  const spam = await page.evaluate(() => JSON.parse(JSON.stringify(window.GW.VFXR.stats)));
  ok('连发 8 次/秒的出招事件也没击穿预算（skipped ' + spam.skipped + ' ≤ 60、槽位 ' + spam.live + ' ≤300）', spam.live <= 300 && spam.skipped <= 60, JSON.stringify(spam).slice(0, 200));
  await page.evaluate(() => { clearInterval(window.__spam); });

  console.log('\n\u2500\u2500 3b. 亮场景下到底看不看得见（像素差分，不靠肉眼）');
  /* 用户报的是"看不清"。这种判断不能靠我看一眼截图点头：草地本身太亮，additive 的细线
     很容易被读成"什么都没画"。所以同一机位连拍两张（特效开 / 关），在浏览器里解码 PNG
     逐像素比：改动像素的数量与它们的平均色，就是"画上了"与"上了色"两份证据。 */
  await page.evaluate(() => {
    const G = window.GW;
    window.__camPose({ x: 20.5, z: 22.0, yaw: 0, pitch: -0.62, mode: 'first' });
    G.VFXR.enabled = true;
  });
  await new Promise(r => setTimeout(r, 300));
  const clip = { x: 330, y: 190, width: 420, height: 300 };
  const shotOn = await page.screenshot({ clip: clip });
  await page.evaluate(() => { window.GW.VFXR.enabled = false; });
  await new Promise(r => setTimeout(r, 300));
  const shotOff = await page.screenshot({ clip: clip });
  await page.evaluate(() => { window.GW.VFXR.enabled = true; });
  const px = await page.evaluate(async (pair) => {
    const load = (b64) => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b64; });
    const A = await load(pair[0]), B = await load(pair[1]);
    const c = document.createElement('canvas'); c.width = A.width; c.height = A.height;
    const g = c.getContext('2d');
    g.drawImage(B, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(A, 0, 0);
    const da = g.getImageData(0, 0, c.width, c.height).data;
    let diff = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (d > 30) { diff++; sr += da[i]; sg += da[i + 1]; sb += da[i + 2]; }
    }
    let sat = 0;
    if (diff) { const mr = sr / diff, mg = sg / diff, mb = sb / diff; sat = Math.max(mr, mg, mb) - Math.min(mr, mg, mb); }
    return { diff: diff, total: da.length / 4, avg: diff ? [Math.round(sr / diff), Math.round(sg / diff), Math.round(sb / diff)] : null, sat: Math.round(sat) };
  }, [shotOn.toString('base64'), shotOff.toString('base64')]);
  ok('特效确实在画（同机位差分 ' + px.diff + ' 个像素 > 900，占 ' + (100 * px.diff / px.total).toFixed(1) + '%）', px.diff > 900, JSON.stringify(px));
  ok('画出来是**带色**的（改动像素平均色 ' + (px.avg || []).join(',') + '，色度差 ' + px.sat + ' > 22）', px.sat > 22, JSON.stringify(px));

  console.log('\n\u2500\u2500 4. 可关性：关掉特效层回到老画法（与光影层同一条口径）');
  await page.evaluate(() => { window.GW.VFXR.enabled = false; window.GW.VFXR.detach(); });
  const oldBack = await poll(() => window.GWAPP.match.sigils.filter(s => !!s.mesh).length >= 1, null, 9000);
  ok('关掉后老贴图阵回来（贴图 mesh ≥1）', oldBack, JSON.stringify(await page.evaluate(() => window.GWAPP.match.sigils.map(s => !!s.mesh))));
  await shot('05-关掉特效层');
  await page.evaluate(() => { window.GW.VFXR.enabled = true; });

  console.log('\n\u2500\u2500 5. 水浇火 / 寒冻水面（真页面里的另外两条反应）');
  const wet = await page.evaluate(() => {
    const G = window.GW, m = window.GWAPP.match, w = m.world;
    const X = 30, Z = 12, y = w.surfaceY(X, Z) + 1;
    const X2 = 38, y2 = w.surfaceY(X2, Z);
    window.__wet = { X: X, Z: Z, y: y, X2: X2, y2: y2 };              // 计数的那份坐标必须存在这里，不能只在本地变量里
    // owner 用 0（真人造的），不是 -1：fluidStep 里 -1 表示"无人造的流体"，3 秒就回收，
    // 那样测的就不是灭火而是"木板自己消失了"（这条曾经把 doused 计数读到 0，看着像反应没跑）。
    for (let a = 0; a < 3; a++) w.set(X + a, y, Z, G.BLOCK.PLANK, { owner: 0, kind: 'built', born: m.time });
    G.CHEM.ignite(X, y, Z);
    w.set(X, y, Z + 1, G.BLOCK.WATER);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) w.set(X2 + a, y2, Z + c, G.BLOCK.WATER);
    G.CHEM.catalyst('cold', X2, y2, Z, 1);
    return { y: y, y2: y2 };
  });
  const quenched = await poll(() => window.GW.CHEM.stats.byId.doused > 0);
  const frozen = await poll(() => {
    const G = window.GW, w = window.GWAPP.match.world, t = window.__wet;
    let ice = 0;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (w.get(t.X2 + a, t.y2, t.Z + c) === G.BLOCK.ICE) ice++;
    return ice >= 4;
  });
  const fr = await page.evaluate(() => {
    const G = window.GW, w = window.GWAPP.match.world, t = window.__wet;
    let ice = 0, water = 0;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const id = w.get(t.X2 + a, t.y2, t.Z + c);
      if (id === G.BLOCK.ICE) ice++; else if (id === G.BLOCK.WATER) water++;
    }
    return { ice: ice, water: water, byId: JSON.parse(JSON.stringify(window.GW.CHEM.stats.byId)), live: window.GW.VFXR.stats.live,
             fx: { reacts: window.GW.CHEM.stats.reacts, emitted: window.GW.CHEM.stats.fxEmitted, suppressed: window.GW.CHEM.stats.fxSuppressed } };
  });
  ok('水浇灭火这条链跑通（doused 计数 ' + (fr.byId.doused || 0) + '）', quenched && (fr.byId.doused || 0) > 0, JSON.stringify(fr.byId));
  ok('寒霜把 3×3 水面冻成冰（' + fr.ice + ' 格）', frozen && fr.ice >= 4, JSON.stringify(fr));
  ok('结冰与蒸汽各自说出自己的词汇（freeze / steam）', await sfxSaid('freeze') && await sfxSaid('steam'), JSON.stringify(await sfxList()));
  await page.evaluate(() => {
    const t = window.__wet;
    window.__camPose({ x: t.X2 + 0.5, z: t.Z - 4.5, yaw: 0, pitch: -0.3, mode: 'first' });
  });
  await shot('06-结冰与蒸汽');

  const finalErrs = errs.filter(e => !/favicon|WebGL|GPU stall|Automatic fallback|Shader Error|fallback i915/i.test(e));
  ok('整个过程零页面错误', finalErrs.length === 0, finalErrs.slice(0, 3).join(' ;; '));
  const st = await page.evaluate(() => ({ stepErrors: window.GWAPP.stepErrors || 0, lastError: window.GWAPP.lastError || null, chemErrors: window.GW.CHEM.stats.errors }));
  ok('逻辑与化学层都零异常', !st.stepErrors && !st.lastError && st.chemErrors === 0, JSON.stringify(st));

  console.log('\n' + (fail === 0 ? '\u25b6 vfx_live 全绿：' : '\u25b6 vfx_live 失败：') + pass + ' 通过 / ' + fail + ' 失败' + (shotsDir ? '（截图在 ' + shotsDir + '）' : ''));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('执行失败：', e); process.exit(2); });
