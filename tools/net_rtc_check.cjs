#!/usr/bin/env node
/* tools/net_rtc_check.cjs · 浏览器内置联机（WebRTC 邀请码/回应码）真页面回归
   两页同源 file://，一页房主、一页加入者：
     host 生成 offer → guest 粘 offer 生成 answer → host 粘 answer 完成连接
     → 两端进 loadout → 12 张牌就绪 → 两端进 match 且 tick 推进。
   不依赖 node tools/net_host.cjs，也不需要外部信令服务器。
   退出码：全过 0；有红 1；环境错误 2。 */
'use strict';
const { createRequire } = require('module');
const req = createRequire(__filename);
let PW = null;
for (const c of ['playwright', 'playwright-core', '/data/miniconda3/miniconda3/lib/node_modules/playwright', '/data/miniconda3/miniconda3/lib/node_modules/playwright-core']) {
  try { PW = req(c); break; } catch (e) { }
}
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const URL = 'file:///data/Coding/像素3D-noita/index.html';
let n = 0, bad = 0;
function ck(name, ok, detail) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); } else console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, ms) {
  const end = Date.now() + (ms || 12000);
  while (Date.now() < end) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    await sleep(120);
  }
  return null;
}
(async () => {
  const browser = await PW.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const host = await browser.newPage(), guest = await browser.newPage();
  const errs = [];
  for (const p of [host, guest]) {
    p.on('pageerror', (e) => errs.push(String(e.message)));
    await p.goto(URL);
    await p.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  }
  const base = { mode: 'net', seed: '490706', deck: 'starter', map: { id: 'duel-64' }, rule: 'ranked', game: { id: 'lode', target: 100 }, net: { room: 'RTC', role: 'host' } };
  await host.evaluate((c) => window.__GW_START(c), base);
  const offer = await waitFor(host, () => { const v = window.GW.UI.app.model.level.netOffer || ''; return v.length > 100 ? v : null; }, 12000);
  ck('房主生成了 WebRTC 邀请码', !!offer && offer.length > 100, offer ? offer.length + 'B' : 'empty');
  const guestCfg = Object.assign({}, base, { net: { room: 'RTC', role: 'guest', offer: offer } });
  await guest.evaluate((c) => window.__GW_START(c), guestCfg);
  const answer = await waitFor(guest, () => { const v = window.GW.UI.app.model.level.netAnswer || ''; return v.length > 100 ? v : null; }, 12000);
  ck('加入者用邀请码生成了回应码', !!answer && answer.length > 100, answer ? answer.length + 'B' : 'empty');
  await host.evaluate((a) => window.GW.UI.channel.request('ui.netAcceptAnswer', { answer: a }), answer);
  const hLoad = await waitFor(host, () => window.GW.Router.current().name === 'loadout', 12000);
  const gLoad = await waitFor(guest, () => window.GW.Router.current().name === 'loadout', 12000);
  ck('房主进入战前选牌', !!hLoad, await host.evaluate(() => window.GW.Router.current().name));
  ck('加入者进入战前选牌', !!gLoad, await guest.evaluate(() => window.GW.Router.current().name));
  const picks = {};
  const deck = await host.evaluate(() => window.GW.STARTER_DECK.slice(0, 12));
  deck.forEach((id) => { picks[id] = (picks[id] || 0) + 1; });
  for (const p of [host, guest]) await p.evaluate((pp) => { window.GW.UI.app.model.loadout.picks = pp; }, picks);
  const hr = await host.evaluate(() => window.GW.UI.channel.request('ui.loadoutReady', {}));
  const gr = await guest.evaluate(() => window.GW.UI.channel.request('ui.loadoutReady', {}));
  ck('房主就绪回执 ok', !!(hr && hr.ok), JSON.stringify(hr));
  ck('加入者就绪回执 ok', !!(gr && gr.ok), JSON.stringify(gr));
  const hMatch = await waitFor(host, () => window.GWAPP.running && window.GWAPP.match && window.GWAPP.match.players.length === 2, 15000);
  const gMatch = await waitFor(guest, () => window.GWAPP.running && window.GWAPP.match && window.GWAPP.match.players.length === 2, 15000);
  ck('房主进入联机对局（2 名玩家）', !!hMatch, await host.evaluate(() => (window.GWAPP.match ? window.GWAPP.match.players.length : -1)));
  ck('加入者进入联机对局（2 名玩家）', !!gMatch, await guest.evaluate(() => (window.GWAPP.match ? window.GWAPP.match.players.length : -1)));
  await sleep(700);
  const hTick = await host.evaluate(() => window.GWAPP.match ? window.GWAPP.match.tick : -1);
  const gTick = await guest.evaluate(() => window.GWAPP.match ? window.GWAPP.match.tick : -1);
  ck('两端 tick 都在推进且接近', hTick > 0 && gTick > 0 && Math.abs(hTick - gTick) <= 8, hTick + '/' + gTick);

  /* 房主开暂停菜单/设置时，联机不能停：房主一停，guest 的世界就钉住。 */
  const tick0 = await host.evaluate(() => window.GWAPP.match.tick);
  await host.keyboard.press('Escape');
  await sleep(700);
  const pauseState = await host.evaluate(() => !!window.GW.HUD.pauseOpen());
  const tick1 = await host.evaluate(() => window.GWAPP.match ? window.GWAPP.match.tick : -1);
  const gtick1 = await guest.evaluate(() => window.GWAPP.match ? window.GWAPP.match.tick : -1);
  ck('房主暂停菜单开着时逻辑不暂停（房主 tick 继续）', pauseState && tick1 > tick0, 'pause=' + pauseState + ' ' + tick0 + '→' + tick1);
  ck('房主暂停菜单开着时 guest 的 tick 也继续', gtick1 > 0, 'guest=' + gtick1);
  await host.evaluate(() => window.GW.HUD.hidePause());
  await sleep(250);

  /* 背包/设置同样不能停联机（与暂停菜单共用同一条 net 豁免）。 */
  await host.keyboard.press('KeyE');
  await sleep(500);
  const invOpen = await host.evaluate(() => !!(window.GW.HUD.panelOpen && window.GW.HUD.panelOpen('inv')));
  const tickInv = await host.evaluate(() => window.GWAPP.match ? window.GWAPP.match.tick : -1);
  ck('房主背包开着时逻辑不暂停', invOpen && tickInv > tick1, 'inv=' + invOpen + ' tick=' + tickInv);
  await host.keyboard.press('KeyE');
  await sleep(200);
  await host.keyboard.press('KeyO');
  await sleep(500);
  const setOpen = await host.evaluate(() => !!(window.GW.HUD.settingsOpen && window.GW.HUD.settingsOpen()));
  const tickSet = await host.evaluate(() => window.GWAPP.match ? window.GWAPP.match.tick : -1);
  ck('房主设置开着时逻辑不暂停', setOpen && tickSet > tickInv, 'settings=' + setOpen + ' tick=' + tickSet);
  await host.keyboard.press('Escape');
  await sleep(200);

  /* 加入者操作：键盘移动必须真的传到房主权威那边（不是只动本地镜像）。 */
  const beforeMove = await host.evaluate(() => { const p = window.GWAPP.match.players[1]; return p && p.pos ? { x: p.pos.x, z: p.pos.z } : null; });
  await guest.keyboard.down('KeyW');
  await sleep(800);
  await guest.keyboard.up('KeyW');
  await sleep(500);
  const afterMove = await host.evaluate(() => { const p = window.GWAPP.match.players[1]; return p && p.pos ? { x: p.pos.x, z: p.pos.z } : null; });
  const moved = beforeMove && afterMove ? Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z) : -1;
  ck('加入者的移动能传到房主权威（房主侧 guest 位置变化）', moved > 0.1, (moved >= 0 ? moved.toFixed(2) : 'no-pos') + '格');

  /* 加入者出牌：右侧/点牌走同一条 pendingCast → input 帧，由房主 playCard 裁决。 */
  await host.evaluate(() => { const p = window.GWAPP.match.players[1]; p.hand = ['draw1']; p.mana = 99; p.mats = 99; p.cooldowns = {}; p.handClass = null; });
  await guest.evaluate(() => { const p = window.GWAPP.match.players[0]; p.hand = ['draw1']; p.mana = 99; p.mats = 99; p.cooldowns = {}; p.handClass = null; window.GW.HUD.sel[0] = 0; });
  const beforeCast = await host.evaluate(() => { const p = window.GWAPP.match.players[1]; return { hand: p.hand.slice(), discard: p.discard.length }; });
  const castRes = await guest.evaluate(() => window.GW.UI.channel.request('ui.castCard', { side: 0, slot: 0 }));
  await sleep(600);
  const afterCast = await host.evaluate(() => { const p = window.GWAPP.match.players[1]; return { hand: p.hand.slice(), discard: p.discard.length }; });
  ck('加入者出牌请求被接受', !!(castRes && castRes.ok), JSON.stringify(castRes));
  ck('加入者出牌由房主权威结算（房主侧 guest 手牌/弃牌变化）',
    afterCast.discard > beforeCast.discard || JSON.stringify(afterCast.hand) !== JSON.stringify(beforeCast.hand),
    JSON.stringify(beforeCast) + '→' + JSON.stringify(afterCast));

  ck('零页面级异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log('\n共 ' + n + ' 条，失败 ' + bad);
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('net_rtc_check 跑不起来：', e); process.exit(2); });
