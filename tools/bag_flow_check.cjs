#!/usr/bin/env node
/* tools/bag_flow_check.cjs · 背包 / 手牌流转回归（用户 2026-10-18 报的那串问题的量具）
   用法：node tools/bag_flow_check.cjs [seed] [--shots 目录]
   退出码：全过 0；任何一条红 1；环境错误 2。

   这份量具只判**权威状态 + 真实鼠标动作**，不判"容器里有没有东西"。要钉住的六件事：

   1) 类别循环不许吞牌：Shift+滚轮 全部→打击→建筑→全部 连滚 10 圈，
      hand+deck+discard 的张数与多重集每次都得一样；回"全部"手牌必须补满 5 格。
      （旧写法两处丢牌：reshuffle 把牌库整段换成弃牌堆；切回"全部"只置空 handClass 不补牌。）
   2) 选中格永远落在真实手牌里：切类/出牌/拖走之后 sel < hand.length（旧版会停在已不存在的格）。
   3) 生存背包没有"取卡货架"（那格是创造模式的调试图鉴货架）；牌库/弃牌堆只读，
      但牌库那张**可以换进手持栏**（2026-10-18 用户：从背包里的卡牌往物品栏上面切换）：
      拖到手持栏 / 卡页「放进手持栏」都可以，被顶下来的那张原位回牌库，三堆守恒。
   4) 从手持栏拿起来的东西，落在空白处 / 牌库格 / 画面上，一张都不许消失：
      要么回到手里，要么按方向打出（deck/discard 变化），要么还在光标上等你换地方。
   5) 卡页四个按钮按"鼠标停着的那张卡"门禁：牌库那张「放进手持栏」是亮的（换一张进手持栏）、
      「扔掉这张」是灰的；手持栏那张「扔掉这张」是亮的——按钮不许亮着却只能回一句"创造模式才能取卡"。
   6) 类别只有一套词表：背包左栏的类别片、手持栏的类别条、Shift+滚轮读的是同一份 handClass；
      1280×720 下选关的「开始对局」在首屏（面板虽可滚，主行动不许藏在视口外）。
*/
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
let seed = 490706, shots = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--shots') shots = argv[++i];
  else if (argv[i].trim() !== '' && !isNaN(+argv[i])) seed = +argv[i];
}

function loadPlaywright() {
  const { createRequire } = require('module');
  const req = createRequire(__filename);
  const cands = ['playwright', 'playwright-core',
    '$(npm root -g)/playwright',
    '$(npm root -g)/playwright-core'];
  for (const c of cands) { try { return req(c); } catch (e) { } }
  try { return require('playwright'); } catch (e) { }
  return null;
}
const PW = loadPlaywright();
if (!PW) { console.error('找不到 playwright：NODE_PATH=$(npm root -g) node tools/bag_flow_check.cjs 重试'); process.exit(2); }
const { chromium } = PW;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
function ck(name, ok, detail) {
  n++;
  if (!ok) { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
  else console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const url = 'http://127.0.0.1:' + port + '/index.html';
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });

  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

  /* ---------- 0. 从零走一遍菜单 → 选关 → 开局（真鼠标点按钮） ---------- */
  await page.waitForTimeout(500);
  await page.click('#btnStart'); await page.waitForTimeout(500);
  /* 固定种子：这条量具要的是"同一条轨迹能不能复现"，不是随机图上的运气 */
  await page.fill('#levelSeedInput', String(seed)); await page.waitForTimeout(200);
  ck('菜单 → 选关（真按钮点得动）', (await page.evaluate(() => location.hash)) === '#/level', await page.evaluate(() => location.hash));
  await page.click('#btnLevelStart'); await page.waitForTimeout(2200);
  ck('选关 → 开局（真按钮点得动）', await page.evaluate(() => !!(window.GWAPP.running && window.GWAPP.match)), 'running=' + await page.evaluate(() => window.GWAPP.running));

  const st = () => page.evaluate(() => {
    const m = window.GWAPP.match, p = m.players[0];
    const bag = window.GW.UI.bag;
    return {
      cls: p.handClass || 'all', hand: p.hand.slice(), deck: p.deck.length, deckIds: p.deck.slice(), discard: p.discard.slice(),
      total: p.hand.length + p.deck.length + p.discard.length,
      sel: window.GW.HUD.sel[0] | 0, cursor: bag.cursor ? bag.cursor.id : null,
      panel: !!(window.GW.HUD.uiPanelOpen && window.GW.HUD.uiPanelOpen()),
      trayKind: bag.get('tray') && bag.get('tray').kind,
      /* 手持栏指示条（2026-10-18 晚：8 个组不再平铺，HUD 只留"出牌组 + 当前组 + 张数 + 自动开火"） */
      classNow: (document.querySelector('.ui-classnow') || {}).textContent || '',
      classLabel: (document.querySelector('#ui-cls1') || {}).textContent || '',
      autoOn: !!(document.querySelector('#autoChip') && document.querySelector('#autoChip').classList.contains('on')),
      marks: Array.from(document.querySelectorAll('#invClasses .ui-btn')).map((b) => b.textContent.trim()),
      detail: (document.querySelector('.ui-detail-name') || {}).textContent || '',
      loc: (document.querySelector('#invLoc') || {}).textContent || '',
      btns: Array.from(document.querySelectorAll('#inv .ui-detail-btns .ui-btn')).map((b) => ({ t: b.textContent.trim(), dis: !!b.disabled }))
    };
  });
  /* 守恒的唯一正确比法：三堆**合起来**的多重集（切类一定重分布，比单堆分布是错的断言）。 */
  const sig = (s) => JSON.stringify(s.hand.concat(s.deckIds, s.discard).sort());

  /* ---------- 1. 类别循环：连滚 10 圈，张数与多重集不许变 ---------- */
  {
    const wheelShift = async () => {
      await page.mouse.move(700, 420);
      await page.keyboard.down('Shift');
      await page.mouse.wheel(0, 120);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(260);
    };
    const before = await st();
    let cycleBad = null, maxSel = -1, allFull = true, seen = [];
    /* 2026-10-18 晚：组从 3 档变成 9 档（全部 + 8 个出牌组），所以"滚一圈回到全部"是 9 步，不是 3 步。 */
    for (let c = 0; c < 10; c++) {
      for (let k = 0; k < 9; k++) {
        await wheelShift();
        const s = await st();
        seen.push(s.cls + ':' + s.hand.length + '/' + s.deck + '/' + s.total);
        if (s.total !== before.total) { cycleBad = cycleBad || ('第 ' + (c + 1) + ' 圈第 ' + (k + 1) + ' 次：总数 ' + s.total + ' ≠ ' + before.total); }
        if (s.sel >= Math.max(1, s.hand.length)) { cycleBad = cycleBad || ('第 ' + (c + 1) + ' 圈第 ' + (k + 1) + ' 步 sel=' + s.sel + ' 而 hand=' + s.hand.length); }
        maxSel = Math.max(maxSel, s.sel);
      }
      const s2 = await st();
      if (s2.cls === 'all' && s2.hand.length !== 5) { allFull = false; cycleBad = cycleBad || ('回到"全部"手牌只有 ' + s2.hand.length + ' 张'); }
    }
    const after = await st();
    ck('类别 · 滚 10 圈（8 组一步不跳）：hand+deck+discard 张数不变', after.total === before.total && cycleBad === null, cycleBad || (before.total + '→' + after.total));
    ck('类别 · 每次切换后选中格都落在真实手牌里', maxSel < 5, '最大 sel=' + maxSel);
    ck('类别 · 回到"全部"手牌补满 5 格（不再留下空洞）', allFull, seen.slice(-3).join(' '));
    ck('类别 · 三堆多重集守恒（不造牌不吞牌）', sig(after) === sig(before), sig(before).slice(0, 70) + ' → ' + sig(after).slice(0, 70));
    await shot('01-class-cycle');
  }

  /* ---------- 2. 打两张 → 弃牌堆非空，再切类（走"牌库抽干要洗牌"那条路） ---------- */
  {
    /* 打哪张由 canPlay 现问（地形卡要视线、技能要魔力）：盲按 Digit1 遇到"这一格放不下"就白测一步。 */
    const castOne = async () => {
      const idx = await page.evaluate(() => {
        const p = window.GWAPP.match.players[0];
        for (let i = 0; i < p.hand.length; i++) {
          const c = window.GW.CARDS_BY_ID[p.hand[i]];
          if (c && window.GW.Rules.canPlay(c, p, window.GWAPP.match.ctx).ok) return i;
        }
        return -1;
      });
      if (idx < 0) return false;
      await page.keyboard.press('Digit' + (idx + 1));
      await page.waitForTimeout(420);
      return true;
    };
    const t0 = await st();
    let casted = 0;
    for (let i = 0; i < 6 && casted < 2; i++) if (await castOne()) casted++;
    const t1 = await st();
    ck('出牌 · 手牌补位、弃牌堆涨、三堆总数不变', casted > 0 && t1.total === t0.total && t1.discard.length > t0.discard.length, 'casted=' + casted + ' ' + t0.total + '→' + t1.total + ' discard=' + t1.discard.length);
    /* 把牌库压到"这一类没有、弃牌堆有"的局面：连续切类 + 打牌 */
    let lost = null;
    for (let r = 0; r < 12; r++) {
      await page.mouse.move(700, 420);
      await page.keyboard.down('Shift'); await page.mouse.wheel(0, 120); await page.keyboard.up('Shift');
      await page.waitForTimeout(200);
      await castOne();
      const s = await st();
      if (s.total !== t0.total) { lost = '第 ' + r + ' 次切类/出牌后总数 ' + s.total + ' ≠ ' + t0.total; break; }
    }
    ck('类别+出牌混合 12 轮：总数一次都没变（洗牌那条路不吞牌）', !lost, lost || ('total=' + (await st()).total));
  }

  /* ---------- 3. 生存背包：没有取卡货架、牌库只读 ---------- */
  /* 先切回「全部」：上一段的 12 轮换组可能停在"移动/超阶"这类**起始牌库里一张都没有**的组
     （诚实空位：手牌 0 张、提示"这一组没有可用的牌了"），后面的拖拽就无从下手。 */
  await page.evaluate(() => window.GW.UI.channel.request('ui.selectClass', { type: 'all', side: 0 }));
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE'); await page.waitForTimeout(700);
  {
    const s = await st();
    ck('生存背包 · 打开了', s.panel);
    ck('生存背包 · 取卡货架不渲染（它是创造模式的调试货架）',
      await page.evaluate(() => { const t = document.querySelector('[data-box=tray]'); return !t || !t.offsetParent; }), 'trayKind=' + s.trayKind);
    /* 组 = 放出来干什么（放置/破坏/移动/远程/法阵/超阶/召唤/辅助）：全部 + 8 组 = 9 片 */
    ck('生存背包 · 组页签是 9 片（全部 + 8 个出牌组）',
      s.marks.length === 9 && s.marks.every((x) => /全部|放置|破坏|移动|远程|法阵|超阶|召唤|辅助/.test(x)), JSON.stringify(s.marks));
    ck('生存背包 · 牌库是只读容器', s.trayKind === 'palette' && await page.evaluate(() => window.GW.UI.bag.get('deck').kind === 'readonly'));
    await shot('02-bag-survival');
  }

  /* ---------- 4. 拿起来 → 落在牌库格 / 空白 / 画面上：一张都不许没 ---------- */
  const rect = async (sel) => page.evaluate((q) => {
    const e = document.querySelector(q); if (!e) return null;
    const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  const drag = async (a, b) => {
    const p1 = typeof a === 'string' ? await rect(a) : a;
    const p2 = typeof b === 'string' ? await rect(b) : b;
    if (!p1 || !p2) return false;
    await page.mouse.move(p1.x, p1.y);
    await page.mouse.down();
    await page.mouse.move(p1.x + 14, p1.y + 10, { steps: 4 });
    await page.mouse.move(p2.x, p2.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(220);
    return true;
  };
  {
    const base = await st();
    /* 4a 落在牌库格上：被拒，牌留在光标（拿在手上），关面板必须回手里 */
    const okDrag = await drag('#invHand [data-slot="1"]', '[data-role=catalog] [data-slot="0"]');
    const s1 = await st();
    ck('拖到牌库格 · 被拒且牌不会没（还在光标上或已回手）', okDrag && (s1.cursor !== null || s1.hand.length === base.hand.length), 'cursor=' + s1.cursor + ' hand=' + s1.hand.length);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    const s2 = await st();
    ck('关面板 · 光标上那张回到手里（总数复原）', s2.total === base.total && s2.cursor === null, base.total + '→' + s2.total);

    /* 4b 落在面板空白处：留在光标；关面板回手 */
    await page.keyboard.press('KeyE'); await page.waitForTimeout(600);
    const b3 = await st();
    const box = await page.evaluate(() => { const b = document.querySelector('.ui-bag-box').getBoundingClientRect(); return { x: b.left + b.width - 40, y: b.top + b.height - 40 }; });
    await drag('#invHand [data-slot="2"]', box);
    const s3 = await st();
    ck('拖到面板空白 · 不丢牌（光标上或原格）', s3.total === b3.total - 1 ? !!s3.cursor : s3.total === b3.total, 'total=' + s3.total + ' cursor=' + s3.cursor);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    ck('关面板 · 空白处松手的牌也回到手里', (await st()).total === b3.total, 'total=' + (await st()).total);

    /* 4c 拖到画面外（面板之外）：生存模式=朝那个方向打出，不是"创造模式才能取卡" */
    await page.keyboard.press('KeyE'); await page.waitForTimeout(600);
    const b4 = await st();
    await drag('#invHand [data-slot="0"]', { x: 12, y: 12 });
    await page.waitForTimeout(500);
    const s4 = await st();
    const casted = s4.deck !== b4.deck || s4.discard.length !== b4.discard.length || s4.hand.join() !== b4.hand.join();
    ck('拖到画面上 · 生存模式真的把这打出（不是"创造模式才能取卡"）', s4.total === b4.total && (casted || !!s4.cursor), 'total=' + s4.total + ' deck=' + b4.deck + '→' + s4.deck);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }

  /* ---------- 5. 卡页四个按钮按"鼠标停着的那张"门禁 ---------- */
  {
    await page.keyboard.press('KeyE'); await page.waitForTimeout(600);
    const hover = async (sel2) => {
      const p = await rect(sel2); if (!p) return false;
      await page.mouse.move(p.x, p.y); await page.waitForTimeout(420); return true;
    };
    /* 先切回「全部」：牌库那张可能不在当前组里，而组筛选只收同类（这是有意的，不是 bug）。
       这一步走的是同一个类别通道（点背包左栏「全部」片），不是测试私开的后门。 */
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#invClasses .ui-btn')).filter((x) => x.textContent.trim().indexOf('全部') === 0)[0];
      if (b) b.click();
    });
    await page.waitForTimeout(400);
    await hover('[data-role=catalog] [data-slot="0"]');
    const deckBtns = (await st()).btns;
    const byName = (arr, t) => arr.filter((x) => x.t === t)[0] || { dis: null };
    /* 2026-10-18：牌库那张的「放进手持栏」现在真的能换（用户要的"从背包换到物品栏"）。
       判据不只是"按钮亮着"：点下去之后手牌要变、三堆多重集要守恒（换了位置，不是造了一张）。 */
    const beforeSwap = await st();
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#inv .ui-detail-btns .ui-btn')).filter((x) => x.textContent.trim() === '放进手持栏')[0];
      if (b) b.click();
    });
    await page.waitForTimeout(450);
    const afterSwap = await st();
    ck('卡页 · 牌库那张：「放进手持栏」是亮的，点它 = 换一张进手持栏（三堆守恒）',
      byName(deckBtns, '放进手持栏').dis === false && afterSwap.total === beforeSwap.total && sig(afterSwap) === sig(beforeSwap) && afterSwap.hand.join() !== beforeSwap.hand.join(),
      JSON.stringify({ dis: byName(deckBtns, '放进手持栏').dis, h0: beforeSwap.hand, h1: afterSwap.hand, total: beforeSwap.total + '→' + afterSwap.total }));
    ck('卡页 · 牌库那张：「扔掉这张」是灰的（它不在手持栏里）', byName(deckBtns, '扔掉这张').dis === true, JSON.stringify(deckBtns));
    ck('卡页 · 牌库那张：位置行说清"在牌库"', (await st()).loc.indexOf('牌库') >= 0, (await st()).loc);
    await hover('#invHand [data-slot="0"]');
    const handBtns = (await st()).btns;
    ck('卡页 · 手持栏那张：「扔掉这张」是亮的', byName(handBtns, '扔掉这张').dis === false, JSON.stringify(handBtns));
    ck('卡页 · 手持栏那张：位置行说清"在手持栏"', (await st()).loc.indexOf('手持栏') >= 0, (await st()).loc);
    await shot('03-bag-hover-hand');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }

  /* ---------- 6. 同一份类别状态：滚轮 → 背包片 / 手持栏类别条 ---------- */
  {
    await page.mouse.move(700, 420);
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 120); await page.keyboard.up('Shift');
    await page.waitForTimeout(350);
    const a = await st();
    const nameOf = await page.evaluate(() => {
      const C = window.GW.HUD.TEXT.inv.categories || {};
      return Object.keys(C).reduce((o, k) => (o[k] = C[k], o), {});
    });
    ck('类别 · 手持栏指示条的当前组 = handClass', a.classNow.indexOf(nameOf[a.cls] || a.cls) >= 0, a.cls + ' / 指示条="' + a.classNow + '"');
    await page.keyboard.press('KeyE'); await page.waitForTimeout(500);
    const marks = (await st()).marks;
    const label = await page.evaluate((cls) => {
      const C = window.GW.HUD.TEXT.inv.categories || {};
      return C[cls] || cls;
    }, a.cls);
    ck('类别 · 背包片的选中项也跟着同一份状态（一套词表）',
      marks.some((m) => m.indexOf(label) === 0), a.cls + ' 期望含 "' + label + '" / ' + JSON.stringify(marks));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }

  /* ---------- 6b. Shift+滚轮换类不许顺带"快捷出牌"（虚系卡组里有 hot:'shift' 的闪现/踏霜） ---------- */
  {
    const p3 = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    p3.on('pageerror', (e2) => errs.push(e2.message));
    await p3.goto(url);
    await p3.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
    await p3.waitForTimeout(400);
    await p3.evaluate((sd) => window.__GW_START({ mode: 'train', seed: sd, deck: 'void' }), seed);
    await p3.waitForTimeout(1600);
    const vs = () => p3.evaluate(() => {
      const m = window.GWAPP.match, q = m.players[0];
      return {
        cls: q.handClass || 'all', hand: q.hand.slice(), discard: q.discard.slice(),
        total: q.hand.length + q.deck.length + q.discard.length,
        hotInHand: q.hand.filter((id) => (window.GW.CARDS_BY_ID[id] || {}).hot === 'shift').length
      };
    });
    /* 先做正例对照：手上有 hot:shift 的牌时，**轻点** Shift 必须真打出去（不然下面那条"没打出去"
       会因为"这个功能本来就没通"而假绿）。 */
    const armBlink = async () => {
      await p3.evaluate(() => {
        const q = window.GWAPP.match.players[0];
        q.hand[0] = 'blink'; q.mana = 8; q.mats = 8;
      });
      await p3.waitForTimeout(120);
    };
    await armBlink();
    const t0 = await vs();
    await p3.mouse.move(700, 420);
    await p3.keyboard.down('Shift'); await p3.waitForTimeout(60); await p3.keyboard.up('Shift');
    await p3.waitForTimeout(500);
    const t1 = await vs();
    ck('Shift 轻点 · hot:shift 的牌真的打出去（正例对照）', t1.discard.length > t0.discard.length || t1.hand.join() !== t0.hand.join(),
      'discard ' + t0.discard.length + '→' + t1.discard.length + ' hand=' + t1.hand.join(','));

    await armBlink();
    /* 判"有没有顺手打出去"直接数 playCard：弃牌堆会被洗回牌库（合法的守恒重分布），
       只看 discard 会把它错判成"打了 / 没打"。 */
    await p3.evaluate(() => {
      const m = window.GWAPP.match;
      /* 只数**自己**（players[0]）的出牌：训练模式里 AI 对手也在打牌，数全表会把它的动作算进来 */
      if (!m._pcWrapped) { m._pc = 0; const o = m.playCard.bind(m); m.playCard = function (q, i) { const r = o(q, i); if (r && q && q.side === 0) m._pc++; return r; }; m._pcWrapped = 1; }
      m._pc = 0;
    });
    const v0 = await vs();
    for (let i = 0; i < 2; i++) {
      await p3.mouse.move(700, 420);
      await p3.keyboard.down('Shift');
      await p3.mouse.wheel(0, 120);
      /* 等 wheel 事件真的派发到页面再松手：Playwright 的 wheel 是异步投递的，
         抢在 keyup 之前松手会让"这次 Shift 是换组"这个标记来不及置位（真实硬件不会这样）。 */
      await p3.waitForTimeout(40);
      await p3.keyboard.up('Shift');
      await p3.waitForTimeout(320);
    }
    const v1 = await vs();
    const casts = await p3.evaluate(() => window.GWAPP.match._pc | 0);
    ck('Shift+滚轮 · 只换类，不顺手把 hot:shift 那张打出去（一次都没 playCard）',
      v1.cls !== v0.cls && v1.total === v0.total && casts === 0,
      'cls ' + v0.cls + '→' + v1.cls + ' total ' + v0.total + '→' + v1.total + ' playCard 次数=' + casts + ' hotInHand=' + v0.hotInHand);
    await p3.close();
  }

  /* ---------- 7. 1280×720：选关的主按钮在首屏 ---------- */
  {
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(url);
    await p2.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
    await p2.waitForTimeout(500);
    await p2.click('#btnStart'); await p2.waitForTimeout(500);
    const geo = await p2.evaluate(() => {
      const b = document.getElementById('btnLevelStart').getBoundingClientRect();
      const box = document.querySelector('.ui-level-box').getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, inner: innerHeight, boxBottom: box.bottom };
    });
    ck('1280×720 · 「开始对局」在首屏（不许藏在视口外）', geo.bottom <= geo.inner && geo.top >= 0, JSON.stringify(geo));
    await p2.screenshot({ path: shots ? path.join(shots, '04-level-720.png') : '/tmp/bag_flow_level_720.png' });
    await p2.close();
  }

  ck('零页面级异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  srv.close();
  console.log('\n共 ' + n + ' 条，失败 ' + bad);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
