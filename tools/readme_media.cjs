#!/usr/bin/env node
/**
 * tools/readme_media.cjs —— README 展示图 / 动图采集器（不参与游戏运行，也不是门禁）
 *
 *   node tools/readme_media.cjs                    # 全套（静图 + 动图）
 *   node tools/readme_media.cjs hud meteor         # 只跑指定场景
 *   node tools/readme_media.cjs --frames 40 --seed 490706 --dir docs/media
 *
 * 三条口径（决定这些图能不能拿去给人看）：
 *  1) 画面必须是真跑出来的：开局走 window.__GW_START，对局推进走主循环自己的 20Hz tick，
 *     出牌走权威层 Match.playCard，三选一走 Match.offerDraft —— 与玩家点出来的同一条路。
 *     唯一动用调试入口的是：把 P1 的输入源换成 AISource（net.js 里 AI 与真人同一条指令通道，
 *     没有后门），以及创造模式解锁法力（为了让一张超阶卡在几秒内演完）。
 *  2) 动图的帧间隔按**实测墙钟节拍**换算 fps：自动化环境是 SwiftShader，page.screenshot 本身要几百毫秒，
 *     写死 fps 会把 GIF 变成快进或慢放。输出里打印实测平均帧距与最终 fps，别只看图好看。
 *  3) 静图/动图落进 docs/media/，同一种子同一地图（默认 490706 / duel-64）：视觉回归可比、重跑可复现。
 *     换种子等于换构图，重画之前先想清楚要不要一起换 README 里的图。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const hasBin = (b) => { try { cp.execSync('command -v ' + b + ' >/dev/null 2>&1 && echo ok', { shell: '/bin/bash' }); return true; } catch (e) { return false; } };

const OUT = path.resolve(ROOT, argVal('--dir', path.join('docs', 'media')));
const FRAMES = parseInt(argVal('--frames', '30'), 10);
const SEED = parseInt(argVal('--seed', '490706'), 10) >>> 0;
const MAP = argVal('--map', 'duel-64');
const NOFFMPEG = argv.includes('--no-ffmpeg');
const only = argv.filter((a) => !a.startsWith('--') && !['--dir', '--frames', '--seed', '--map'].includes(a));

/* playwright 的落点在各机器上都不一样（本机全局装在 conda 的 node_modules 里，公开读者多半是 npm i -D）：
   把能想到的根都试一遍，而不是写死一条绝对路径。 */
function globalRoots() {
  const roots = [];
  try { const o = cp.execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (o) roots.push(o); } catch (e) {}
  String(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean).forEach((r) => roots.push(r));
  ['/usr/lib/node_modules', '/usr/local/lib/node_modules', '/data/miniconda3/miniconda3/lib/node_modules'].forEach((r) => roots.push(r));
  return roots.filter((r) => { try { return fs.statSync(r).isDirectory(); } catch (e) { return false; } });
}
function loadPW() {
  const { createRequire } = require('module');
  const cands = ['playwright', 'playwright-core'];
  globalRoots().forEach((r) => { cands.push(path.join(r, 'playwright'), path.join(r, 'playwright-core')); });
  for (const c of cands) { try { return createRequire(__filename)(c); } catch (e) {} }
  try { return require('playwright'); } catch (e) {}
  return null;
}
const PW = loadPW();
if (!PW) { console.log('[x] 找不到 playwright（试试 NODE_PATH=$(npm root -g) node tools/readme_media.cjs）'); process.exit(2); }
const { chromium } = PW;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store, must-revalidate' });
    fs.createReadStream(abs).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function frames(page, n) { for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r))); }

async function boot(page, port, cfg) {
  await page.goto('http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2), { waitUntil: 'load' });
  await page.waitForFunction('!!window.__GW_START && !!window.GWAPP', null, { timeout: 30000 });
  await page.evaluate((c) => { window.__GW_START(c); }, Object.assign({ mode: 'train', seed: SEED, deck: 'starter', map: { id: MAP } }, cfg || {}));
  await frames(page, 30);
  /* 玩家真正上手时会锁指针，锁上之后「点击画面」提示自己收起；截图要的是操作态，不是提示态。 */
  if (argv.indexOf('--no-lock') < 0) {
    try { await page.evaluate(() => document.body.requestPointerLock()); } catch (e) {}
    await sleep(200);
    const lk = await page.evaluate(() => !!window.GW.pointerLocked);
    if (!lk) console.log('  [!] 指针没锁上，画面里会留「点击画面」提示');
  }
  await frames(page, 20);
}

/* 让 P1 也交给 AI 驱动：换掉装配层挂在 sources[0] 的 KeyboardSource。
   net.js 的 AISource 与 KeyboardSource 产出同一种指令流，Match 不认角色（AGENTS「别给 AI 开后门」同一条）。 */
const bothAI = (page, lv) => page.evaluate((level) => {
  const S = window.GWAPP;
  if (!S || !S.match) return false;
  S.sources[0] = new window.GW.Net.AISource(S.match, 0, level);
  if (!S.sources[1]) S.sources[1] = new window.GW.Net.AISource(S.match, 1, level);
  return true;
}, lv);

const creativeOn = (page) => page.evaluate(() => {
  const G = window.GW;
  if (G && G.Creative) { G.Creative.enable(true); G.Creative.enable(true, true); }
  const p = window.GWAPP.match.players[0];
  return { on: !!(G.Creative && G.Creative.on), fly: !!(p.creative && p.creative.fly), noclip: !!(p.creative && p.creative.noclip) };
});

const pose = (page, p) => page.evaluate((o) => { window.__camPose(o); }, p).then(() => frames(page, 25));

/* 出牌：走权威层，与玩家按 1–5 / 左键连发最后落到的同一个函数。
   每张牌回一个 ok —— 上一版把返回值丢了，结果动图里其实什么都没发生也照样产出 GIF。 */
const cast = (page, cardIds, pitch, gapMs) => page.evaluate(async (a) => {
  const M = window.GWAPP.match, p = M.players[0];
  const log = [];
  for (let i = 0; i < a.ids.length; i++) {
    const id = a.ids[i];
    if (!p.hand.includes(id)) {
      if (window.GW.Creative) window.GW.Creative.give(id, 'hand', { slot: i % 5 });
      else p.hand[i % 5] = id;
    }
    const idx = p.hand.indexOf(id);
    if (idx < 0) { log.push({ id: id, ok: false, why: '不在手牌' }); continue; }
    p.pitch = a.pitch;
    const ok = M.playCard(p, idx);
    log.push({ id: id, ok: !!ok });
    await new Promise((r) => setTimeout(r, a.gapMs));
  }
  return { log: log, mana: p.mana, entities: (M.entities || []).length, sigils: (M.sigils || []).length };
}, { ids: cardIds, pitch: pitch === undefined ? -0.15 : pitch, gapMs: gapMs === undefined ? 260 : gapMs });

/* 前后数一遍脚下这片格子的非空格：出牌后没有增量 = 地形根本没被改，图就不该出。 */
async function blockDelta(page, x, z, act) {
  const n = await page.evaluate((c) => {
    const w = window.GWAPP.world; let k = 0;
    for (let x = c.x - 6; x <= c.x + 6; x++) for (let z = c.z - 6; z <= c.z + 6; z++) for (let y = 1; y <= 24; y++) if (w.get(x, y, z)) k++;
    return k;
  }, { x: Math.round(x), z: Math.round(z) });
  return n;
}

/* 动图里的动作必须真在画面里发生：一张都没结算成功就当场失败，别产出看起来正常的空 GIF。 */
async function castOrFail(page, ids, pitch, name, gapMs) {
  const r = await cast(page, ids, pitch, gapMs);
  const marks = r.log.map((x) => x.id + (x.ok ? '√' : '×')).join(' ');
  console.log('  cast → ' + marks + ' · 实体 ' + r.entities + ' 法阵 ' + r.sigils + ' 魔力 ' + r.mana);
  if (!r.log.some((x) => x.ok)) throw new Error(name + ': 一张牌都没结算成功 ' + JSON.stringify(r.log) + ' —— 画面不会有动作，不出图');
  if (!r.entities && !r.sigils) console.log('  [!] 牌打了，但场上没有实体与法阵（画面可能仍然很静）');
  return r;
}

async function shoot(page, file) { await page.screenshot({ path: file }); console.log('  shot → ' + path.relative(ROOT, file)); }

/** 抓一段动画帧并编码成 gif；返回实测帧距（毫秒） */
/**
 * 动图为什么不能直接按墙钟截帧：SwiftShader 下一次 page.screenshot 要几百毫秒，
 * 30 帧就覆盖了十几秒的对局，按 3fps 播出来是幻灯片、按 10fps 播出来是快进。
 * 做法：先用 addInitScript 把页面的 performance.now 缩放到 SLOW 倍（对局进入慢放），
 * 于是「每帧墙钟 550ms」只对应「游戏时间 ~60ms ≈ 1.2 个 tick」，
 * 编码 fps 由实测帧距与缩放系数一起算出来 —— 播出来仍是真实时序，但每帧之间只隔一个 tick。
 * SLOW=1 即不慢放（退回旧的按墙钟编码）。
 */
const SLOW = parseFloat(argVal('--slow', '0.12'));

async function clip(browser, port, name, setup, opts) {
  const o = opts || {};
  const page = await browser.newPage({ viewport: { width: o.w || 960, height: o.h || 540 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  const k = o.slow === undefined ? SLOW : o.slow;
  if (k < 1) await page.addInitScript((s) => { const T = performance.now(); const real = performance.now.bind(performance); performance.now = () => T + (real() - T) * s; }, k);
  await boot(page, port, Object.assign({ seed: o.seed === undefined ? SEED : o.seed }, o.cfg));
  if (o.ai) await bothAI(page, o.ai);
  if (o.creative) { const st = await creativeOn(page); if (st.fly || st.noclip) console.log('  [!] 创造模式带上了 fly/noclip=' + JSON.stringify(st) + '（画面会不像正常对局）'); }
  if (o.pose) await pose(page, o.pose);
  /* concurrent：出牌发生在录帧过程中 —— 否则改造在快门打开之前就完事了，动图看着像静图 */
  let setupTask = null;
  if (setup) setupTask = o.concurrent ? Promise.resolve().then(() => setup(page)) : setup(page).then(() => null);
  if (setup && !o.concurrent) await setupTask;
  const dir = path.join('/tmp', 'gw-media', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const stamps = [];
  const n = o.frames || Math.max(FRAMES, 36);
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    await page.screenshot({ path: path.join(dir, 'f-' + String(i).padStart(3, '0') + '.jpg'), type: 'jpeg', quality: 90 });
    stamps.push(Date.now() - t0);
  }
  const avg = stamps.reduce((a, b) => a + b, 0) / stamps.length;
  const gameMs = avg * k;                                  // 相邻两帧之间真实推进了多少游戏时间
  const fps = Math.max(4, Math.min(24, Math.round(1000 / Math.max(30, gameMs))));
  console.log('  ' + name + '：' + n + ' 帧 · 实测帧距 ' + avg.toFixed(0) + 'ms × 慢放 ' + k + ' = 游戏时间 ' + gameMs.toFixed(0) + 'ms/帧 → fps=' + fps + '（时长 ' + (n / fps).toFixed(1) + 's）' + (errs.length ? ' ⚠ 页面异常 ' + errs.length + ' 条：' + errs[0].slice(0, 90) : ''));
  if (setupTask && o.concurrent) { await setupTask; }   // 断言不过就抛在这里，GIF 不落盘
  const out = path.join(OUT, name + '.gif');
  if (!NOFFMPEG && hasBin('ffmpeg')) {
    const vf = 'scale=' + (o.gifW || 640) + ':-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=' + (o.colors || 128) + '[p];[s1][p]paletteuse=dither=none';
    cp.execSync('ffmpeg -y -loglevel error -framerate ' + fps + ' -i ' + path.join(dir, 'f-%03d.jpg') + ' -vf "' + vf + '" -loop 0 ' + out);
    console.log('  gif → ' + path.relative(ROOT, out) + ' (' + (fs.statSync(out).size / 1024).toFixed(0) + ' KB)，帧留在 ' + dir);
  } else {
    console.log('  [!] 没跑 ffmpeg，帧留在 ' + dir);
  }
  await page.close();
  return { avg, fps };
}

/** 爆发类场面：连拍一串帧，挑信息量最大的一张当静图（帧距按墙钟即可，不编码 gif） */
async function burst(browser, port, name, setup, opts) {
  const o = opts || {};
  const page = await browser.newPage({ viewport: { width: o.w || 1280, height: o.h || 720 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await boot(page, port, Object.assign({ seed: o.seed === undefined ? SEED : o.seed }, o.cfg));
  if (o.creative) await creativeOn(page);
  if (o.pose) await pose(page, o.pose);
  const dir = path.join('/tmp', 'gw-media', name + '-frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const meanOf = (f) => { try { return parseFloat(cp.execSync("identify -format '%[fx:mean]' " + f, { encoding: 'utf8' }).trim()) || 0; } catch (e) { return 0; } };
  const shots = [];
  let stop = false;
  for (let i = 0; i < 14 && !stop; i++) {
    if (i === 2) await setup(page);                        // 出牌在录制中段，让爆发落在序列里
    const f = path.join(dir, 'b-' + String(i).padStart(2, '0') + '.png');
    await page.screenshot({ path: f });
    const nonBlack = meanOf(f);
    shots.push({ f, nonBlack });
    stop = i >= 8;
    await sleep(260);
  }
  const pick = shots.slice(3).sort((a, b2) => b2.nonBlack - a.nonBlack)[0] || shots[shots.length - 1];
  fs.copyFileSync(pick.f, path.join(OUT, name + '.png'));
  if (hasBin('convert')) cp.execSync('convert ' + path.join(OUT, name + '.png') + ' -colors 200 -strip -define png:compression-level=9 ' + path.join(OUT, name + '.png'));
  console.log('  ' + name + '：取 ' + path.basename(pick.f) + '（均值 ' + pick.nonBlack.toFixed(3) + '，' + (fs.statSync(path.join(OUT, name + '.png')).size / 1024).toFixed(0) + ' KB）' + (errs.length ? ' ⚠ ' + errs[0].slice(0, 100) : ''));
  await page.close();
}

async function still(browser, port, name, setup, opts) {
  const o = opts || {};
  const page = await browser.newPage({ viewport: { width: o.w || 1280, height: o.h || 720 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  if (name === 'menu') {
    await page.goto('http://127.0.0.1:' + port + '/index.html?cb=' + Math.random().toString(36).slice(2), { waitUntil: 'load' });
    await page.waitForFunction('!!window.__GW_START', null, { timeout: 30000 });
    await frames(page, 40);
  } else {
    await boot(page, port, o.cfg);
    if (o.ai) await bothAI(page, o.ai);
    if (o.creative) await creativeOn(page);
    if (o.pose) await pose(page, o.pose);
    if (setup) await setup(page);
  }
  const file = path.join(OUT, name + '.png');
  await shoot(page, file);
  if (!NOFFMPEG && hasBin('convert')) {
    cp.execSync('convert ' + file + ' -colors ' + (o.colors || 200) + ' -strip -define png:compression-level=9 ' + file);
  }
  console.log('  ' + name + '：' + (fs.statSync(file).size / 1024).toFixed(0) + ' KB' + (errs.length ? ' ⚠ 页面异常：' + errs[0].slice(0, 120) : ''));
  await page.close();
}

/* 机位是从 tools/readme_media.cjs scout 模式扫出来、人工挑的（同一地图、不同种子与俯仰）：
   画面里要同时看得见 角色公告牌 / 以太矿脉 / 地形轮廓 / HUD，别把镜头埋进树叶里。 */
const CAM = {
  combat:  { seed: 490706, x: 24.5, z: 24.5, yaw: 0.79, pitch: 0.06, mode: 'shoulder' },
  unit:    { seed: 88092,  x: 20.5, z: 33.5, yaw: 4.6,  pitch: 0.02, mode: 'shoulder' },
  world:   { seed: 31337,  x: 40.5, z: 22.5, yaw: 1.9,  pitch: -0.05, mode: 'shoulder' },
  dig:     { seed: 490706, x: 24.5, z: 24.5, yaw: 0.79, pitch: -0.72, mode: 'shoulder' },
  sky:     { seed: 490706, x: 24.5, z: 24.5, yaw: 0.79, pitch: -0.28, mode: 'shoulder' },
};
const bootCfg = (c) => ({ seed: c.seed, mode: 'train', deck: 'starter', map: { id: MAP }, rule: 'ranked' });

const SCENES = {
  menu:   (b, p) => still(b, p, 'menu', null, { h: 800 }),
  hero:   (b, p) => clip(b, p, 'hero-cast', async (pg) => { await castOrFail(pg, ['meteor_rain', 'meteors', 'black_hole'], -0.18, 'hero-cast'); }, { creative: true, seed: CAM.sky.seed, cfg: bootCfg(CAM.sky), pose: { x: 24.5, z: 24.5, yaw: 0.79, pitch: -0.12, mode: 'shoulder' }, frames: 52, gifW: 520, colors: 80, slow: 0.3, concurrent: true }),
  unit:   (b, p) => still(b, p, 'hero-unit', null, { ai: 3, seed: CAM.unit.seed, cfg: bootCfg(CAM.unit), pose: CAM.unit }),
  world:  (b, p) => still(b, p, 'world', null, { ai: 3, seed: CAM.world.seed, cfg: bootCfg(CAM.world), pose: CAM.world }),
  terrain:(b, p) => clip(b, p, 'terrain-cards', async (pg) => {
    const before = await blockDelta(pg, CAM.dig.x, CAM.dig.z);
    await sleep(600);
    await castOrFail(pg, ['wall2', 'icewall', 'firewall', 'ramp', 'raise', 'bridge', 'shift', 'wall2'], -0.92, 'terrain-cards', 420);
    const after = await blockDelta(pg, CAM.dig.x, CAM.dig.z);
    console.log('  地形改动：出牌前 ' + before + ' 格 → 出牌后 ' + after + ' 格（Δ' + (after - before) + '）');
    if (after - before < 24) throw new Error('terrain-cards: 地形只变了 ' + (after - before) + ' 格（要 ≥24 才在画面里看得出来），不出图');
  }, { creative: true, seed: CAM.dig.seed, cfg: bootCfg(CAM.dig), pose: { x: 24.5, z: 24.5, yaw: 0.79, pitch: -0.9, mode: 'shoulder' }, frames: 48, gifW: 520, colors: 80, slow: 0.3, concurrent: true }),
  meteor: (b, p) => burst(b, p, 'meteor', async (pg) => { await castOrFail(pg, ['meteor_rain', 'meteors', 'black_hole'], -0.3, 'meteor'); }, { seed: CAM.sky.seed, cfg: bootCfg(CAM.sky), creative: true, pose: CAM.sky }),
  draft:  (b, p) => still(b, p, 'draft', async (pg) => { await pg.evaluate(() => { const o = window.GWAPP.match.offerDraft(0, 'lode', 'forest'); if (!o) throw new Error('offerDraft 返回 null：额度/来源/池子不合规，面板不会弹'); }); await sleep(1800); }, { ai: 0 }),
  inv:    (b, p) => still(b, p, 'inventory', async (pg) => {
                      await pg.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true })));
                      await sleep(350);
                      await pg.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true })));
                      await sleep(900);
                    }, { creative: true }),
  result: (b, p) => still(b, p, 'result', async (pg) => { await pg.evaluate(() => { const M = window.GWAPP.match; M.addScore(M.players[0], 400); }); await sleep(2000); }, { ai: 3 }),
  hud:    (b, p) => still(b, p, 'hud', null, { ai: 3 }),
  scout:  async (b, p) => {
    const keys = Object.keys(CAM);
    for (let i = 0; i < keys.length; i++) await still(b, p, 'scout-' + keys[i], null, { ai: 3, seed: CAM[keys[i]].seed, cfg: bootCfg(CAM[keys[i]]), pose: CAM[keys[i]] });
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { srv, port } = await serve();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-lcd-text'] });
  const names = only.length ? only : Object.keys(SCENES);
  const bad = names.filter((n) => !SCENES[n]);
  if (bad.length) { console.log('[x] 不认识的场景：' + bad.join(', ') + '（可选：' + Object.keys(SCENES).join(', ') + '）'); await browser.close(); srv.close(); process.exit(2); }
  console.log('采集 ' + names.length + ' 个场景 · seed=' + SEED + ' 地图=' + MAP + ' 输出 ' + path.relative(ROOT, OUT));
  const fails = [];
  for (const n of names) {
    console.log('— ' + n);
    try { await SCENES[n](browser, port); } catch (e) { fails.push(n + ': ' + String(e.message).slice(0, 160)); console.log('  [x] ' + fails[fails.length - 1]); }
  }
  await browser.close();
  srv.close();
  console.log(fails.length ? '\n[x] 失败场景：' + fails.join(' | ') : '\n[OK] 全部落地 ' + path.relative(ROOT, OUT));
  if (fails.length) process.exit(1);
})();
