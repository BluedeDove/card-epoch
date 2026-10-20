#!/usr/bin/env node
/* tools/left_click_check.cjs · 左右键分工回归（2026-10-20 用户改口径）
   用户原话："左键使用背包配置好的默认攻击牌组，右键默认当前物品栏选中的牌"

   新契约（唯一判定在 src/main.js 的 mousedown）：
     · 左键按住 = 默认攻击牌组自动开火；当前若是放置/破坏/移动/辅助，
       临时切到上次选过的攻击组（默认「全部」），**松手切回原组**；
     · 右键 = 打出当前手持栏选中的那一张，不再用右键循环选择。
   量法：真页面 + 真鼠标（分屏，不需要指针锁）；判权威状态与 P1 的 playCard 调用次数，
   不判"画面看起来动了没有"。用法：node tools/left_click_check.cjs [seed]。 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const seed = (process.argv[2] && !isNaN(+process.argv[2])) ? +process.argv[2] : 490706;
function loadPlaywright() {
  const { createRequire } = require('module'); const req = createRequire(__filename);
  for (const c of ['playwright', 'playwright-core', '/data/miniconda3/miniconda3/lib/node_modules/playwright', '/data/miniconda3/miniconda3/lib/node_modules/playwright-core']) { try { return req(c); } catch (e) { } }
  try { return require('playwright'); } catch (e) { }
  return null;
}
const PW = loadPlaywright();
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve() { return new Promise((res) => { const srv = http.createServer((req, rsp) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
  fs.readFile(fp, (e, buf) => { if (e) { rsp.writeHead(404).end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(buf); });
}); srv.listen(0, '127.0.0.1', () => res(srv)); }); }
let n = 0, bad = 0;
function ck(name, ok, detail) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); } else console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await PW.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const errs = [], page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  await page.evaluate((sd) => window.__GW_START({ mode: 'split', seed: sd, deck: 'starter' }), seed);
  await page.waitForTimeout(1600);
  const st = () => page.evaluate(() => {
    const m = window.GWAPP.match, p = m.players[0];
    return { cls: p.handClass || 'all', hand: p.hand.slice(), deck: p.deck.length, discard: p.discard.slice(),
      mats: p.mats, mana: +p.mana.toFixed(2), auto: !!window.GWAPP.autoFire, running: !!window.GWAPP.running,
      sel: window.GW.HUD.sel[0] | 0, casts: window.__casts | 0, total: p.hand.length + p.deck.length + p.discard.length };
  });
  const setup = (cls, attack) => page.evaluate((arg) => {
    const m = window.GWAPP.match, p = m.players[0];
    if (!window.__castsWrapped) {
      const orig = m.playCard.bind(m);
      m.playCard = function (pl, i) { const ok = orig(pl, i); if (ok && pl === m.players[0]) window.__casts = (window.__casts | 0) + 1; return ok; };
      window.__castsWrapped = true;
    }
    p.mana = 99; p.mats = 99; p.cooldowns = {}; p.attackClass = arg.attack || 'all';
    m.equipClass(p, arg.cls || 'all');
    window.__camPose({ pitch: arg.cls === 'place' ? -1.0 : -0.25, freeze: false });
    return { hand: p.hand.slice(), roles: p.hand.map((id) => (window.GW.CARDS_BY_ID[id] || {}).role || null) };
  }, { cls: cls, attack: attack });
  const hold = async (ms) => { await page.mouse.move(640, 360); await page.mouse.down(); await sleep(ms); const mid = await st(); await page.mouse.up(); await sleep(220); return mid; };
  const right = async () => { await page.mouse.click(640, 360, { button: 'right' }); await sleep(260); };

  ck('分屏局真的跑起来了（左键不需要指针锁）', (await st()).running);

  /* 1) 左键在放置组：临时切默认攻击组、开火、松手切回放置，左右分工成立 */
  {
    const b = await setup('place', 'shot');
    ck('放置组 · 手持栏里全是放置类（切组真的生效）', b.hand.length > 0 && b.roles.every((r) => r === 'place'), 'hand=' + b.hand + ' roles=' + b.roles);
    const s0 = await st();
    const mid = await hold(180);
    const after = await st();
    ck('放置组 · 左键临时切到默认攻击组并自动开火',
      mid.auto === true && mid.cls === 'shot' && mid.casts > s0.casts,
      'mid auto=' + mid.auto + ' cls=' + mid.cls + ' casts=' + s0.casts + '→' + mid.casts);
    ck('放置组 · 松手回到放置组、扳机松开',
      after.auto === false && after.cls === 'place',
      'after auto=' + after.auto + ' cls=' + after.cls);
    ck('放置组 · 三堆守恒（左键切组/开火不吞牌）', after.total === s0.total, s0.total + '→' + after.total);
  }

  /* 2) 右键 = 当前选中的那张，不循环选择 */
  {
    await setup('shot', 'shot');
    await page.evaluate(() => { window.GW.HUD.sel[0] = 1; });
    const s0 = await st();
    const picked = s0.hand[1];
    await right();
    const s1 = await st();
    ck('右键 · 打出的是选中格那张（P1 playCard 多一次）',
      s1.casts === s0.casts + 1 && s1.auto === false,
      'casts=' + s0.casts + '→' + s1.casts + ' auto=' + s1.auto + ' picked=' + picked);
    ck('右键 · 不改变选中格（不再用右键循环）', s1.sel === s0.sel, s0.sel + '→' + s1.sel);
    ck('右键 · 出牌后三堆守恒（补位/弃牌不丢牌）', s1.total === s0.total, s0.total + '→' + s1.total);
  }

  /* 3) 攻击组左键：按住连发、松手停 */
  {
    await setup('shot', 'shot');
    const s0 = await st();
    const mid = await hold(320);
    const after = await st();
    ck('远程组 · 按住左键 = 自动开火（autoFire 亮）', mid.auto === true, 'auto=' + mid.auto);
    ck('远程组 · 按住真的连发（至少结算一次 playCard）', after.casts > s0.casts, 'casts=' + s0.casts + '→' + after.casts);
    ck('远程组 · 松手就停（autoFire 归 false）', after.auto === false, 'auto=' + after.auto);
  }

  /* 4) 「全部」组：左键仍自动开火 */
  {
    await setup(null, 'all');
    const mid = await hold(220);
    ck('全部组 · 按住左键仍然是自动开火', mid.auto === true, 'auto=' + mid.auto);
  }

  ck('零页面级异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log('\n共 ' + n + ' 条，失败 ' + bad);
  await browser.close(); srv.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('left_click_check 跑不起来：', e); process.exit(2); });
