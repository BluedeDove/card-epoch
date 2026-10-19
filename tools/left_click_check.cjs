#!/usr/bin/env node
/* tools/left_click_check.cjs · 左键职责回归（2026-10-18 用户："你不能抢夺左键的读取"）
   用户原话："左键倒是可以自动发牌了，但我的放置等其他功能类的卡牌为什么用不了了？
             组建还是要负责放牌的……现在选择的这个 shift 滚轮的模式不同，有不同的功能，
             不是说他全都得要拿去干攻击的。"

   这一层只有一条契约：**当前出牌组决定左键干什么**（判定在 src/main.js 的 leftPlaysSelected）：
     · 放置 / 破坏 / 移动 / 辅助 → 左键 = 打出**当前选中那一格**（一次按下结算一次；
       不连发、不换牌——按住砌墙会在一秒里把素材烧光，那不是手感）
     · 远程 / 法阵 / 超阶 / 召唤 / 全部 → 按住 = 自动开火（挑牌与换牌归 src/systems/auto.js）

   量法是**真页面 + 真鼠标**（page.mouse.down/up），分屏模式下不需要指针锁；
   判的是权威状态（p.handClass / hand / mats / mana / GWAPP.autoFire）与 P1 的 playCard 调用次数，
   不判"画面看起来动了没有"。用法：node tools/left_click_check.cjs [seed]
   退出码：全过 0；任何一条红 1；环境错误 2。 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const seed = (process.argv[2] && !isNaN(+process.argv[2])) ? +process.argv[2] : 490706;

function loadPlaywright() {
  const { createRequire } = require('module');
  const req = createRequire(__filename);
  for (const c of ['playwright', 'playwright-core', '$(npm root -g)/playwright', '$(npm root -g)/playwright-core']) {
    try { return req(c); } catch (e) { }
  }
  try { return require('playwright'); } catch (e) { }
  return null;
}
const PW = loadPlaywright();
if (!PW) { console.error('找不到 playwright：NODE_PATH=$(npm root -g) node tools/left_click_check.cjs 重试'); process.exit(2); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((res) => {
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

let n = 0, bad = 0;
function ck(name, ok, detail) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); } else console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await PW.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });

  /* 分屏：左键不需要指针锁（headless 拿不到稳定的 lock 状态与真 movement） */
  await page.evaluate((sd) => window.__GW_START({ mode: 'split', seed: sd, deck: 'starter' }), seed);
  await page.waitForTimeout(1600);
  const st = () => page.evaluate(() => {
    const m = window.GWAPP.match, p = m.players[0];
    return { cls: p.handClass || 'all', hand: p.hand.slice(), deck: p.deck.length, discard: p.discard.length,
      mats: p.mats, mana: +p.mana.toFixed(2), auto: !!window.GWAPP.autoFire, running: !!window.GWAPP.running,
      sel: window.GW.HUD.sel[0] | 0, aim: p.aim ? [p.aim.gx, p.aim.gy, p.aim.gz] : null, casts: window.__casts | 0 };
  });
  const total = (s) => s.hand.length + s.deck + s.discard;
  const setup = (cls) => page.evaluate((c) => {
    const m = window.GWAPP.match, p = m.players[0];
    if (!window.__castsWrapped) {
      /* 只数 P1 的 playCard：AI 也在出牌，不过滤会把"对面打了一张"记成"我按了左键"。 */
      /* 只数**真的打出去**的那一次（playCard 返回 true）：调用次数会把"被拒的尝试"也算进来 */
      const orig = m.playCard.bind(m);
      m.playCard = function (pl, i) { const ok = orig(pl, i); if (ok && pl === m.players[0]) window.__casts = (window.__casts | 0) + 1; return ok; };
      window.__castsWrapped = true;
    }
    p.mana = 99; p.mats = 99; p.cooldowns = {};
    m.equipClass(p, c || 'all');
    window.__camPose({ pitch: c === 'place' ? -1.0 : -0.25, freeze: false });
    return { hand: p.hand.slice(), roles: p.hand.map((id) => (window.GW.CARDS_BY_ID[id] || {}).role || null) };
  }, cls);
  const hold = async (ms) => { await page.mouse.move(640, 360); await page.mouse.down(); await sleep(ms); const mid = await st(); await page.mouse.up(); await sleep(180); return mid; };

  ck('分屏局真的跑起来了（左键不需要指针锁）', (await st()).running);

  /* 1) 放置组：一次点击 = 放一次；按住也不许连发 */
  {
    const b = await setup('place');
    ck('放置组 · 手持栏里全是放置类（切组真的生效）', b.hand.length > 0 && b.roles.every((r) => r === 'place'), 'hand=' + b.hand + ' roles=' + b.roles);
    const s0 = await st();
    const a1 = await hold(80);
    ck('放置组 · 单击左键真的放了一格（素材减少、P1 的 playCard 记一次）',
      a1.casts === s0.casts + 1 && a1.mats < s0.mats && a1.auto === false,
      'casts=' + s0.casts + '→' + a1.casts + ' mats=' + s0.mats + '→' + a1.mats + ' auto=' + a1.auto);
    ck('放置组 · 三堆守恒（放牌之后补位，不吞牌）', total(a1) === total(s0), total(s0) + '→' + total(a1));
    const c1 = (await st()).casts;
    const held = await hold(420);
    /* 一次按下 = 一张牌，**跟按多久无关**：420ms 的按住不许变成"每秒砌十格" */
    ck('放置组 · 按住 420ms 也只放一张（一次按下结算一次，不连发、不抢扳机）',
      held.auto === false && held.cls === 'place' && held.casts === c1 + 1,
      'auto=' + held.auto + ' cls=' + held.cls + ' casts=' + c1 + '→' + held.casts);
  }

  /* 2) 破坏组：同样是"点一下打一张"，不许变成自动开火 */
  {
    await setup('dig');
    const s0 = await st();
    const held = await hold(300);
    ck('破坏组 · 左键走"出牌"而不是自动开火', held.auto === false && held.cls === 'dig',
      'auto=' + held.auto + ' cls=' + held.cls + ' hand=' + held.hand);
    ck('破坏组 · 按下结算一次（P1 的 playCard 只多一次、三堆守恒）', held.casts === s0.casts + 1 && total(held) === total(s0),
      'casts=' + s0.casts + '→' + held.casts + ' total=' + total(s0) + '→' + total(held));
  }

  /* 3) 远程组：按住 = 自动开火（真扳机、松手就停） */
  {
    await setup('shot');
    const s0 = await st();
    const held = await hold(320);
    const a = await st();
    ck('远程组 · 按住左键 = 自动开火（autoFire 亮）', held.auto === true, 'auto=' + held.auto);
    ck('远程组 · 按住真的连发（至少结算一次 playCard）', a.casts > s0.casts, 'casts=' + s0.casts + '→' + a.casts);
    ck('远程组 · 松手就停（autoFire 归 false）', a.auto === false, 'auto=' + a.auto);
  }

  /* 4) 「全部」组：按住仍然是连发（这是用户认可的那一半） */
  {
    await setup(null);
    const held = await hold(220);
    ck('全部组 · 按住左键仍然是自动开火', held.auto === true, 'auto=' + held.auto);
    ck('全部组 · 松手停', (await st()).auto === false);
  }

  ck('零页面级异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n共 ' + n + ' 条，失败 ' + bad);
  await browser.close();
  srv.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('left_click_check 跑不起来：', e); process.exit(2); });
