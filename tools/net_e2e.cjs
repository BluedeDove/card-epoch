#!/usr/bin/env node
/* tools/net_e2e.cjs · 联机两端真跑一局的正式门禁（docs/NET.md §9.7 末行；由 N2 留在 /tmp/n2_smoke.cjs 的双页冒烟长成）
   跑的是**两个真页面**（headless Chromium）经 tools/net_host.cjs 用房间码配对：
   先走完「连接 → 战前选牌 → 双方就绪 → match」（N5，见下面的 openPair），再量
   互相看得见移动 / 世界 diff 到位 / 信息隔离（带正例对照）/ 三选一真鼠标点得动 / 掉线有交代 /
   各拿自己那副牌库开局（E9）/ 积分榜与房主一致 + 目标分终局（E10）。
   纯逻辑层由 net_check.cjs（传输）与 net_sync_check.cjs（打包与覆盖）管，三条各管一段，不互相替代。

   取数与环境的四条口径（改这个文件前先读，全是踩过的坑）：
     1 服务：自己起禁缓存静态服务 + require('./net_host.cjs').serve()，都用随机空闲端口，不抢 8932。
     2 一整对页面放同一个 context，并且**每次跨页取数前 bringToFront 一次**：
       实测 sep-context 让两页互相抢前置位，应用心跳（页面每 250ms 自报 tick/frame）缺席被拖到 1.3 秒，
       超过 net_host 的 1 秒判死线 → 服务端发 timeout/peer-stalled → 两端一起进结算，E2 往后全红。
       deviceScaleFactor=0.5 也只是把 SwiftShader 的最坏帧从 ~930ms 压到 ~570ms（软件光栅，两台机器同屏）。
       这两条都是**测量环境口径**，不改 src/ 的任何行为。
     3 guest 侧 players[1].hand 是 new Array(handCount)（长度=张数、内容全 undefined），
       所以 E5 判"槽位全空 + 页面与线上都搜不到房主手牌的卡 id"，并且带正例对照（不许"因为都空所以绿"）。
     4 连上后 __GW_NET().state 是 'hello'（握手完就是这个状态，没有 'open' 这一档）；
       房主在 peer-joined 之前**不发快照**，所以所有测量都从"两端 paired 且 tick > 20"之后开始。
       N5 起 __GW_NET() 多一个 phase：'loadout'（连上了、还没开局）| 'match'（已在局内）。
       **tick 从进局那一刻才开始涨**（两段式开局），所以 openPair 里等的是"两端都 phase==='match' 且 tick>20"，
       而不是旧的"房主先 tick>15 再放 guest 进来"——现在两页都是同一刻进局、同一刻烘首屏，
       心跳尖峰靠后面那条 1.6 秒预热摊开（peer-stalled 自 2026-10-18 起只 toast、不结算，E8 守着）。
     5 跑这条门禁时别并行跑别的量具（Playwright + SwiftShader 是 CPU 大户）：E6 的 1.5 秒弹出窗与
       E4 的 1.5 秒追平窗都是真判据，机器被抢满时会偶发读成超时（实测并行跑五个脚本时弹出被读成 false；
       串行跑同一份代码每次都是 130~170ms）。每次跨页取数前 bringToFront 一次也是同一条道理。
     5 跑这条门禁时**别并行跑别的量具**（Playwright + SwiftShader 是 CPU 大户）：
       E6 的 1.5 秒弹出窗与 E4 的 1.5 秒追平窗都是真判据，机器被抢满时会偶发读成超时（实测并行跑五个脚本时
       弹出被读成 false；串行跑同一份代码两次都是 130~170ms）。取数前把目标页 bringToFront 一次也是同一条道理。

   E8（画面卡顿不许判终局）默认跑，而且是 src 的真问题不是夹具问题：main.js 的 netBye/timeout 把
   timeout/peer-stalled 直接当"对手已离开"走结算，真机卡顿或切窗也会被误杀。所以默认口径（E1–E8）
   在 src 修好之前**预期一条红**；要看"今天该绿的七条"用 --core。src 修好后 E8 不必改这个文件就该转绿。

   E9/E10（N5 加的两条）的口径写在各段注释里，一句先说在前面：它们判的是**不变量**
   （三堆之和 = 12、两端 kills/deaths 互为镜像、winner 互为镜像），不是"deck.length===12 /
   guest.kills[0]===1"那种字面数字 —— 前者是"抽 5 张进手"与"本地视角恒 side 0"两件事的必然结果，
   照字面写会把一条正确的实现读成红。
   用法：node tools/net_e2e.cjs [--core] [--seed 490706]
        退出码 0 = 本次跑的这些条全绿；非 0 = 有红（末尾打印两端 __GW_NET 与最后 5 条 console error）。
*/
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const HOST = require('./net_host.cjs');

const argv = process.argv.slice(2);
const CORE = argv.indexOf('--core') >= 0;
const si = argv.indexOf('--seed');
const SEED = si >= 0 && argv[si + 1] ? (parseInt(argv[si + 1], 10) >>> 0) : 490706;
const ROOM = 'E2E';
const VIEWPORT = { width: 1440, height: 900 }, DPR = 0.5;

function loadPW() {
  const cands = ['playwright', 'playwright-core',
    '$(npm root -g)/playwright',
    '$(npm root -g)/playwright-core'];
  const { createRequire } = require('module');
  for (const c of cands) { try { return createRequire(path.join(ROOT, 'tools/x.cjs'))(c); } catch (e) { } }
  return null;
}
const PW = loadPW();
if (!PW) { console.error('no playwright'); process.exit(2); }
const { chromium } = PW;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json'
};
function serveStatic() {
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

let n = 0, bad = 0;
const fails = [];
function ck(id, name, cond, detail) {
  n++;
  console.log((cond ? 'PASS ' : 'FAIL ') + id + ' ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
  if (!cond) { bad++; fails.push(id + ' ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
  return !!cond;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await serveStatic();
  const port = srv.address().port;
  const ws = HOST.serve();
  await new Promise(r => ws.listen(0, '127.0.0.1', r));
  const wsPort = ws.address().port;
  const url = 'http://127.0.0.1:' + port + '/index.html';
  const wsUrl = 'ws://127.0.0.1:' + wsPort;
  console.log('静态 :' + port + '   ws :' + wsPort + '   PROTO_VER=' + HOST.PROTO_VER + '   seed=' + SEED +
    '   房间=' + ROOM + (CORE ? '   [--core: 跑 E1–E7 与 E9]' : ''));

  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
  });
  const wait = (p, fn, ms) => p.waitForFunction(fn, null, { timeout: ms || 20000, polling: 80 }).then(() => true).catch(() => false);

  /* 前置位轮询（口径 2）：headless 里不在前台的那一页 setTimeout 容易被拖过 1 秒，
     于是应用心跳缺席 → 服务端判画面卡死。每次要动某一页之前先把它带到前面。 */
  let front = null;
  async function focus(p) { if (p && front !== p) { try { await p.bringToFront(); front = p; } catch (e) { } } return p; }
  async function ev(p, fn, arg) { await focus(p); return p.evaluate(fn, arg); }

  let pairCtx = null;
  async function newPage(tag) {
    if (!pairCtx) pairCtx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
    const page = await pairCtx.newPage();
    page.__errs = [];
    page.on('pageerror', e => page.__errs.push('pageerror: ' + String(e && e.message || e).slice(0, 150)));
    page.on('console', m => { if (m.type() === 'error') page.__errs.push('console: ' + String(m.text()).slice(0, 150)); });
    await page.goto(url);
    if (!await wait(page, () => window.GWAPP && window.__GW_START, 60000))
      throw new Error(tag + '：60 秒内 GWAPP/__GW_START 没出现（' + (page.__errs[0] || 'console 无报错') + '）');
    await focus(page);
    return page;
  }
  /* 埋点：房主记自己发出的快照（tick + cells 条数），guest 记收到的快照原文（E5b 拿它当线上语料） */
  async function instrument(page, role) {
    await ev(page, r => {
      window.__rxSnap = []; window.__sentSnap = [];
      /* 逐字段序列化成一段可搜的文本。不能用 JSON.stringify(match)：Match 里有 world/lodeSys/ctx 的
         回环（lodeSys.m ↔ match），直接 stringify 抛 Converting circular structure to JSON（第一轮就是这么红的）。
         这里按【当前路径】判环（退出就撤掉标记），所以只有真环被打成 [cyc]，重复引用不会被误剪；
         深度上限 8 挡住 fx/THREE 那一大坨——E5b 最硬的证据是 __rxSnap（guest 收到的原始快照），
         这份序列化只是第三道网。 */
      window.__str = function (o) {
        const onPath = new Set();
        function ser(v, d) {
          if (v === null || v === undefined) return 'null';
          const t = typeof v;
          if (t === 'number' || t === 'boolean') return String(v);
          if (t === 'string') return JSON.stringify(v);
          if (t === 'function') return '"[fn]"';
          if (t !== 'object' || d > 8) return '"[deep]"';
          if (onPath.has(v)) return '"[cyc]"';
          onPath.add(v);
          var out;
          if (Array.isArray(v)) out = '[' + v.map(function (x) { return ser(x, d + 1); }).join(',') + ']';
          else {
            var ks = Object.keys(v), parts = [];
            for (var i = 0; i < ks.length; i++) parts.push(JSON.stringify(ks[i]) + ':' + ser(v[ks[i]], d + 1));
            out = '{' + parts.join(',') + '}';
          }
          onPath.delete(v);
          return out;
        }
        try { return ser(o, 0); } catch (e) { return '"[str-fail:' + String(e && e.message).slice(0, 60) + ']"'; }
      };
      const NM = window.GW.NetMatch, oa = NM.applySnapshot;
      window.GW.NetMatch.applySnapshot = function (m, s) {
        if (r === 'guest' && window.__rxSnap.length < 800) { try { window.__rxSnap.push(JSON.stringify(s)); } catch (e) { } }
        return oa.apply(this, arguments);
      };
      const C = window.GW.NetWs.Connection, os = C.prototype.send;
      C.prototype.send = function (msg) {
        if (msg && msg.type === 'snapshot' && window.__sentSnap.length < 800)
          window.__sentSnap.push({ tick: msg.tick, cells: (msg.cells || []).length });
        return os.call(this, msg);
      };
    }, role);
  }

  const netOf = p => ev(p, () => (window.__GW_NET ? window.__GW_NET() : null)).catch(() => null);
  const overOf = p => ev(p, () => {
    const o = window.GWAPP.match && window.GWAPP.match.over;
    return o ? { w: o.winner, r: o.winReason } : null;
  }).catch(() => 'err');
  const resultVisible = p => ev(p, () => {
    const el = document.getElementById('result');
    return !!(el && !el.classList.contains('hidden') && String(el.innerText || '').trim().length > 0);
  }).catch(() => false);
  const choiceOpen = p => ev(p, () => !!document.querySelector('.ui-choice-box .ui-list-item')).catch(() => false);

  /* 起一对页面，并把「连接 → 战前选牌 → 双方就绪 → match」整段走完（NET.md §10；N5）。
     E1–E9 都从这一条拿 pair —— 就绪这条路不通，E1 就直接红，不会有"悄悄绕过选牌开成局"的绿。
     opts：{ hostDeck, guestDeck, hostElement, guestElement, game }
       · hostDeck / guestDeck：各端交出去的那副牌（卡 id 数组）；不传 → 用页面里的 NetLoadout.autoDeck
         （判据与收货方同一份，量具不另抄一套"什么叫合法牌库"）；
       · hostElement / guestElement：让两端各拿一系元素（E9 要「两端自己牌库的第一个元素不同」）；
       · game：透传给 __GW_START 的 cfg.game（E10 用它换成 deathmatch + 目标分）。
     返回 { HP, GP, ha, ga, inMs }：ha/ga 是两端就绪回执（含交出去的 deck 原文），
     inMs = 「两端各按一次就绪」到「两端都进了对局」的实测毫秒数（E9a 判它 ≤3000ms）。
     口径 4 更新：连上之后 state 仍是 'hello'；**tick 从现在起要等进了对局才涨**（两段式开局），
     所以旧那条"房主先站稳 tick>15"换成"房主先进选牌页"，两页各自站稳之后再一起按就绪。 */
  async function openPair(tag, opts) {
    opts = opts || {};
    pairCtx = null; front = null;
    const HP = await newPage(tag + '/host');
    await instrument(HP, 'host');
    await ev(HP, o => window.__GW_START({
      mode: 'net', seed: o.s, deck: 'starter', map: { id: 'duel-64' }, rule: 'ranked', game: o.g,
      net: { role: 'host', url: o.u, room: o.r }
    }), { u: wsUrl, r: ROOM, s: SEED, g: opts.game || null });
    if (!await wait(HP, () => { const x = window.__GW_NET(); return !!(x && x.role === 'host' && x.phase === 'loadout'); }, 20000))
      throw new Error(tag + '：房主没进战前选牌页（__GW_NET().phase 没到过 loadout；' + (HP.__errs[0] || 'console 无报错') + '）');
    await sleep(1200);                                      // 房主先在选牌页站稳（这一页没有 tick，尖峰留给首屏渲染）
    const GP = await newPage(tag + '/guest');
    await instrument(GP, 'guest');
    await ev(GP, o => window.__GW_START({ mode: 'net', deck: 'starter', net: { role: 'guest', url: o.u, room: o.r } }), { u: wsUrl, r: ROOM });
    if (!await wait(GP, () => { const x = window.__GW_NET(); return !!(x && x.role === 'guest' && x.phase === 'loadout'); }, 20000))
      throw new Error(tag + '：加入者没进战前选牌页（joined 没到？房间码 ' + ROOM + '；' + (GP.__errs[0] || 'console 无报错') + '）');
    /* 双方就绪：两端各调一次 __GW_LOADOUT_AUTO（生产同一条路 —— H.loadoutPick 写牌 + H.loadoutReady 发帧，
       房主收帧校验、两边都 ready 才发 start；量具不在这里自己拼协议帧） */
    const tReady = Date.now();
    const ha = await ev(HP, d => window.__GW_LOADOUT_AUTO(d.d, d.e), { d: opts.hostDeck || null, e: opts.hostElement ? { element: opts.hostElement } : null });
    const ga = await ev(GP, d => window.__GW_LOADOUT_AUTO(d.d, d.e), { d: opts.guestDeck || null, e: opts.guestElement ? { element: opts.guestElement } : null });
    if (!(ha && ha.ok) || !(ga && ga.ok))
      throw new Error(tag + '：两端就绪没走通（host=' + JSON.stringify(ha) + ' guest=' + JSON.stringify(ga) +
        '）—— 房主没收到 loadout / 牌库被判非法 / start 没送达，看 host 页 console');
    const hIn = await wait(HP, () => { const x = window.__GW_NET(); return !!(x && x.phase === 'match' && x.tick > 20); }, 25000);
    const gIn = await wait(GP, () => { const x = window.__GW_NET(); return !!(x && x.phase === 'match' && x.tick > 20); }, 25000);
    const inMs = Date.now() - tReady;
    if (!(hIn && gIn)) throw new Error(tag + '：双方就绪后没都进主循环（host 进局=' + hIn + ' guest 进局=' + gIn + '，已等 ' + inMs + 'ms）');
    if (!await wait(HP, () => !!(window.__dbg && window.__dbg.state && window.__dbg.state.net && window.__dbg.state.net.paired), 15000))
      throw new Error(tag + '：房主侧 net.paired 始终 false（peer-joined 没到 → 房主根本不发快照）');
    await sleep(1600);                                      // 预热：两页是同一刻进局的，把首屏烘焙尖峰留在测量之前
    const oH = await overOf(HP), oG = await overOf(GP);
    if ((oH && oH !== 'err') || (oG && oG !== 'err'))
      throw new Error(tag + '：还没量就终局了（host=' + JSON.stringify(oH) + ' guest=' + JSON.stringify(oG) + '）——被服务端判画面卡死');
    return { HP, GP, ha, ga, inMs };
  }

  /* 第一对（E1–E9 共用）：房主拿一系火、加入者拿一系冰 —— 两端牌库必须不同，
     E9 才量得出「guest 拿到的是自己那副」而不是房主那副（1↔0 换位反了就会两边同构筑）。 */
  let pair;
  const DECK9 = { hostElement: 'fire', guestElement: 'ice' };
  try { pair = await openPair('E2E', DECK9); }
  catch (e) {
    console.log('  ! 第一对起局失败：' + e.message);
    console.log('  ! 等 30 秒重开一对（只给并行中的页面改动一次落定的机会，不改判据）');
    await sleep(30000);
    pair = await openPair('E2E-retry', DECK9);
  }
  const HP = pair.HP, GP = pair.GP;

  /* ================= E1 两端身份一致 ================= */
  const nh = await netOf(HP), ng = await netOf(GP);
  const dimOf = p => ev(p, () => [window.GWAPP.world.SX, window.GWAPP.world.SY, window.GWAPP.world.SZ].join('x')).catch(() => '?');
  const dims = [await dimOf(HP), await dimOf(GP)];
  ck('E1', '两端 role / seed / 世界尺寸 / 房间码一致',
    !!nh && !!ng && nh.role === 'host' && ng.role === 'guest' && nh.seed === SEED && ng.seed === SEED &&
    dims[0] === '64x36x64' && dims[0] === dims[1] && nh.room === ROOM && ng.room === ROOM,
    'host=' + JSON.stringify(nh) + ' guest=' + JSON.stringify(ng) + ' 尺寸 ' + dims[0] + '/' + dims[1]);

  /* ================= E2 房主移动 → guest 镜像看得见 ================= */
  const b1 = await ev(GP, () => { const p = window.GWAPP.match.players[1]; return { x: p.pos.x, z: p.pos.z }; });
  await ev(HP, () => { const s = window.GWAPP.sources[0]; s.keys.KeyW = 1; setTimeout(() => { s.keys.KeyW = 0; }, 1200); });
  await sleep(2000);
  const a1 = await ev(GP, () => { const p = window.GWAPP.match.players[1]; return { x: p.pos.x, z: p.pos.z }; });
  const d1 = Math.hypot(a1.x - b1.x, a1.z - b1.z);
  ck('E2', '房主按住 W 1.2 秒 → guest 镜像里房主那位（players[1]）水平位移 > 1 格', d1 > 1.0,
    d1.toFixed(2) + ' 格（' + b1.x.toFixed(2) + ',' + b1.z.toFixed(2) + ' → ' + a1.x.toFixed(2) + ',' + a1.z.toFixed(2) + '）');

  /* ================= E3 guest 移动 → 进房主权威 ================= */
  const b2 = await ev(HP, () => { const p = window.GWAPP.match.players[1]; return { x: p.pos.x, z: p.pos.z }; });
  await ev(GP, () => { const s = window.GWAPP.sources[0]; s.keys.KeyW = 1; setTimeout(() => { s.keys.KeyW = 0; }, 1200); });
  await sleep(2000);
  const a2 = await ev(HP, () => { const p = window.GWAPP.match.players[1]; return { x: p.pos.x, z: p.pos.z }; });
  const d2 = Math.hypot(a2.x - b2.x, a2.z - b2.z);
  ck('E3', 'guest 按住 W 1.2 秒 → 房主权威里 players[1] 水平位移 > 1 格', d2 > 1.0,
    d2.toFixed(2) + ' 格（' + b2.x.toFixed(2) + ',' + b2.z.toFixed(2) + ' → ' + a2.x.toFixed(2) + ',' + a2.z.toFixed(2) + '）');

  /* ================= E4 世界 diff ================= */
  const edits = await ev(HP, () => {
    const w = window.GWAPP.match.world, base = [[12, 14], [18, 16], [26, 20]], out = [];
    for (let i = 0; i < base.length; i++) {
      const pts = [base[i], [base[i][0] + 1, base[i][1]]];
      for (let k = 0; k < pts.length; k++) {
        const x = pts[k][0], z = pts[k][1], y = Math.min(w.SY - 2, Math.max(2, w.surfaceY(x, z) + 2));
        const id = w.get(x, y, z) === 0 ? 3 : 0;             // 空格立石头 / 有格挖空
        if (w.set(x, y, z, id)) out.push([x, y, z, id]);
      }
    }
    return out;
  });
  let sameCells = false, t4 = 0; const t4a = Date.now();
  while (Date.now() - t4a < 1500 && !sameCells) {
    await sleep(120);
    sameCells = await ev(GP, c => c.length > 0 && c.every(q => window.GWAPP.world.get(q[0], q[1], q[2]) === q[3]), edits);
    if (sameCells) t4 = Date.now() - t4a;
  }
  ck('E4a', '房主改 ' + edits.length + ' 格 → 1.5 秒内 guest 的世界逐格相同', edits.length === 6 && sameCells,
    'edits=' + edits.length + ' 到位用时 ' + t4 + 'ms' + (sameCells ? '' : '（差异未到位）'));
  const diffOf = p => ev(p, () => window.GW.Save.exportFrom(window.GWAPP.world, null).cells.length).catch(() => -1);
  let dh = 0, dg = 0, t4c = 0; const t4b = Date.now();
  for (;;) {
    dh = await diffOf(HP); dg = await diffOf(GP);
    if (dh === dg || Date.now() - t4b > 2500) { t4c = Date.now() - t4b; break; }
    await sleep(150);
  }
  ck('E4b', '两端 Save 差异格数相等（seed + 差异格这条线上表示两端对得上）', dh === dg && dg >= 6,
    'host=' + dh + ' guest=' + dg + '（追平窗口 ' + t4c + 'ms）');

  /* ================= E9 战前选牌：两端各拿自己那副牌开局（N5 第 9 条） =================
     位置夹在 E4b 与 E5 之间，不是随手插的：E5b 会把房主手牌换成 5 张探针卡（换了 hand 就量不出
     「手牌 ⊆ 自己那副牌库」），E7 又直接关页 —— 再往后就没有干净的牌堆可量了。
     判据按**不变量**写、不按字面数字写（与父代理 2026-10-18 过目的口径一致），两处必须写清：
       · 「players[0].deck.length === 12」在这里永远不成立 —— Match 建局就抽 5 张进手，牌库里只剩 7 张，
         所以判的是**三堆之和 = 12**（不造牌不吞牌，与 tools/hand_check.cjs 同一条口径）；
       · guest 那边的 players[0].deck 是 new Array(张数) 的占位（NET.md §4：牌库顺序不出门），
         所以「自己那副牌库」的内容只能从本机交出去那份读（__GW_LOADOUT_AUTO 的返回 / __GW_NET().deck），
         而「加入者那副到底是什么」由**房主权威侧**的 players[1] 作证 —— 两端一比才看得出 1↔0 换位对不对：
         换位写反的话，guest 的手牌会从房主那副里发出来，下面 E9d 当场就红。 */
  {
    const hostDeck = (pair.ha && pair.ha.deck) || (nh && nh.deck) || null;
    const guestDeck = (pair.ga && pair.ga.deck) || (ng && ng.deck) || null;
    const piles = p => ev(p, () => {
      const q = window.GWAPP.match.players[0];
      const len = a => { let k = 0; for (let i = 0; i < (a || []).length; i++) k++; return k; };   // 稀疏数组按下标数（filter 会跳过洞）
      const N = window.__GW_NET();
      return { hand: len(q.hand), deck: len(q.deck), discard: len(q.discard),
        handIds: (q.hand || []).filter(x => typeof x === 'string'),
        seed: window.GWAPP.world.seed, phase: N ? N.phase : '?', deckSent: N && N.deck ? N.deck.slice() : null };
    }).catch(() => null);
    const ph = await piles(HP), pg = await piles(GP);
    const auth = await ev(HP, () => {                    // 房主权威侧读"加入者那副"（guest 页读不到自己的牌库内容）
      const q = window.GWAPP.match.players[1];
      const len = a => { let k = 0; for (let i = 0; i < (a || []).length; i++) k++; return k; };
      return { hand: len(q.hand), deck: len(q.deck), discard: len(q.discard),
        deck0: (q.deck && q.deck.length) ? q.deck[0] : null,
        handIds: (q.hand || []).filter(x => typeof x === 'string') };
    }).catch(() => null);
    const elems = (p, deck) => ev(p, d => (d || []).map(id => { const c = window.GW.CARDS_BY_ID[id]; return c && c.element ? c.element : '?'; }), deck).catch(() => []);
    const eh = await elems(HP, hostDeck), eg = await elems(GP, guestDeck);
    const subset = (hand, deck) => {
      if (!Array.isArray(hand) || !Array.isArray(deck)) return false;
      const c = {}; for (const id of deck) c[id] = (c[id] | 0) + 1;
      for (const id of hand) { if (!c[id]) return false; c[id]--; }
      return true;
    };
    ck('E9a', '双方各按一次就绪 → 两端都进对局，从就绪到进局实测 ' + pair.inMs + 'ms（判据 ≤3000ms）',
      !!ph && !!pg && ph.phase === 'match' && pg.phase === 'match' && pair.inMs > 0 && pair.inMs <= 3000 &&
      !!hostDeck && !!guestDeck && hostDeck.length === 12 && guestDeck.length === 12,
      'inMs=' + pair.inMs + ' 房主牌库 ' + (hostDeck || []).length + ' 张 加入者 ' + (guestDeck || []).length + ' 张' +
      '（ha=' + JSON.stringify(pair.ha && pair.ha.ok) + ' ga=' + JSON.stringify(pair.ga && pair.ga.ok) + '）');
    ck('E9b', '两端各自 hand+deck+discard = 12（开局抽 5 张不造牌不吞牌；不是"牌库里正好 12 张"那种错口径）',
      !!ph && !!pg && ph.hand + ph.deck + ph.discard === 12 && pg.hand + pg.deck + pg.discard === 12,
      'host ' + ph.hand + '+' + ph.deck + '+' + ph.discard + ' guest ' + pg.hand + '+' + pg.deck + '+' + pg.discard);
    ck('E9c', '两端自己牌库的第一个元素不同，且房主那一副含火、加入者那一副含冰（两套构筑真不是同一份）',
      !!hostDeck && !!guestDeck && hostDeck[0] !== guestDeck[0] && eh.indexOf('fire') >= 0 && eg.indexOf('ice') >= 0,
      'host[0]=' + (hostDeck || [])[0] + '(' + eh[0] + ') guest[0]=' + (guestDeck || [])[0] + '(' + eg[0] + ')');
    ck('E9d', '手牌 ⊆ 自己那副（两端）+ 房主权威侧的加入者牌库第一位 = 加入者自己交出去那份（1↔0 换位没搞反）',
      !!auth && subset(ph && ph.handIds, hostDeck) && subset(pg && pg.handIds, guestDeck) &&
      auth.deck0 === (guestDeck || [])[0] && auth.hand + auth.deck + auth.discard === 12,
      '房主手牌=' + JSON.stringify(ph && ph.handIds) + ' 加入者手牌=' + JSON.stringify(pg && pg.handIds) +
      ' 权威侧 players[1].deck[0]=' + (auth && auth.deck0) + ' 应等于 ' + (guestDeck || [])[0] +
      '（换位写反就会看成 ' + (hostDeck || [])[0] + '）');
    ck('E9e', '选牌之后两端仍是同一张图：world.seed 相同且等于房主那份',
      !!ph && !!pg && ph.seed === pg.seed && ph.seed === SEED, 'host=' + (ph && ph.seed) + ' guest=' + (pg && pg.seed) + ' 期望=' + SEED);
  }

  /* ================= E5 信息隔离（带正例对照，不许"因为都空所以绿"） ================= */
  const struct = await ev(GP, () => {
    const o = window.GWAPP.match.players[1], arr = o.hand || [];
    let holes = 0; for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) holes++;
    const d = o.deck || []; let dh2 = 0; for (let i = 0; i < d.length; i++) if (d[i] === undefined) dh2++;
    return { handLen: arr.length, holes, deckLen: d.length, deckHoles: dh2 };
  });
  ck('E5a', 'guest 镜像里房主那位 hand/deck 全是空槽占位（长度=张数，内容不外泄）',
    struct.holes === struct.handLen && struct.handLen > 0 && struct.deckHoles === struct.deckLen,
    JSON.stringify(struct));

  /* 正例对照：挑 5 张"guest 页面本来就看不见"的真卡塞进房主手牌（权威在房主，改的就是权威），
     再在 guest 页面（body.innerText + 序列化 GWAPP.match）与 guest 收到的快照原文里搜这些 id。
     同一次搜索在房主页面必须命中——命中不了说明搜索本身没生效，那条绿是假的。 */
  const probe = await ev(GP, () => {
    const m = window.GWAPP.match;
    const blob = window.__str(m) + '|' + document.body.innerText;
    const own = (m.players[0].hand || []).concat(m.players[0].discard || []);
    return window.GW.CARDS.map(c => c.id).filter(id => own.indexOf(id) < 0 && blob.indexOf(id) < 0);
  });
  const ids = (Array.isArray(probe) ? probe : []).slice(0, 5);
  const hostSet = await ev(HP, list => {
    const p = window.GWAPP.match.players[0];
    p.hand = list.slice();
    return { hand: p.hand.slice(), count: p.hand.length };
  }, ids);
  await sleep(800);                                            // 两份快照的功夫（10Hz）
  const leak = await ev(GP, list => {
    const m = window.GWAPP.match;
    const page = window.__str(m) + '|' + document.body.innerText;
    const wire = (window.__rxSnap || []).join('|');
    const mirror = m.players[1].hand || [];
    /* 数空槽必须按下标遍历：guest 侧这份是 new Array(n)（稀疏数组），filter/forEach 会跳过洞，
       拿 filter 数空槽永远得 0 —— 第一轮那条红是量具的错，不是同步的错。 */
    let holes = 0; for (let i = 0; i < mirror.length; i++) if (mirror[i] === undefined) holes++;
    return {
      hitPage: list.filter(id => page.indexOf(id) >= 0),
      hitWire: list.filter(id => wire.indexOf(id) >= 0),
      mirrorLen: mirror.length,
      mirrorHoles: holes,
      rxLen: (window.__rxSnap || []).length
    };
  }, ids);
  const control = await ev(HP, list => {
    const m = window.GWAPP.match;
    const page = window.__str(m) + '|' + document.body.innerText;
    return list.filter(id => page.indexOf(id) >= 0);
  }, ids);
  ck('E5b', '房主手牌里的卡 id 不出现在 guest 页面 / guest 收到的原始快照里（' + ids.length + ' 张探针）',
    ids.length >= 3 && control.length === ids.length && leak.hitPage.length === 0 && leak.hitWire.length === 0 && leak.rxLen > 0 &&
    leak.mirrorLen === hostSet.count && leak.mirrorHoles === hostSet.count,
    '探针=' + ids.join(',') + ' guest 页面命中=' + JSON.stringify(leak.hitPage) + ' 线上命中=' + JSON.stringify(leak.hitWire) +
    ' 镜像槽位 ' + leak.mirrorHoles + '/' + leak.mirrorLen + ' 空（房主实际 ' + hostSet.count + ' 张）· guest 语料 ' + leak.rxLen + ' 份快照（=0 说明埋点没收到帧，那条绿是假的）' +
    ' 对照：同批 id 在房主页面命中 ' + control.length + '/' + ids.length + '（不足 ' + ids.length + ' 张＝搜索没生效，判据不算绿）');

  /* ================= E6 三选一：房主发起 → guest 真鼠标点 → 房主侧落地 ================= */
  const preChoice = await choiceOpen(GP);
  const dPre = await ev(HP, () => ({ deck: window.GWAPP.match.players[1].deck.length, used: window.GWAPP.match.draftUsed.lode[1] }));
  const t6a = Date.now();                                    // 弹出延迟从「房主真的排上 offer」那一刻算，不把取数耗时算进去
  const opts = await ev(HP, () => {
    const o = window.GWAPP.match.offerDraft(1, 'lode', 'forest');
    return o ? o.options : null;
  });
  // 面板列表项由 guest 页的帧调度器填（src/ui/core.js），所以等它之前必须把 guest 带到前台：
  // 后台页的 rAF 被拖慢，上一轮 --core 就是把弹出读成了 false（判据不变，只是让该跑的那页真跑）。
  await focus(GP);
  const popped = await wait(GP, () => !!document.querySelector('.ui-choice-box .ui-list-item'), 3000);
  const popMs = popped ? (Date.now() - t6a) : 99999;         // 判据仍是 1.5 秒内弹出；3 秒只是搜索上限，超时/超标都算红
  let clicked = false;
  if (popped) {
    await focus(GP);
    const box = await GP.locator('.ui-choice-box .ui-list-item').first().boundingBox().catch(() => null);
    if (box) { await GP.mouse.click(box.x + box.width / 2, box.y + box.height / 2); clicked = true; }
  }
  const t6 = Date.now();
  let dPost = dPre;
  for (let i = 0; i < 20; i++) {
    dPost = await ev(HP, () => ({ deck: window.GWAPP.match.players[1].deck.length, used: window.GWAPP.match.draftUsed.lode[1] }));
    if (dPost.deck === dPre.deck + 2 && dPost.used === dPre.used + 1) break;
    await sleep(100);
  }
  const clickMs = Date.now() - t6;
  const mirrorDrafts = await ev(GP, () => (window.GWAPP.match.drafts || []).length);
  ck('E6', 'offerDraft(1) → guest 1.5 秒内弹 .ui-choice-box → 真鼠标点第一张 → 2 秒内房主 players[1] 牌库 +2 且 draftUsed.lode[1] 计一次',
    !!opts && popped && popMs <= 1500 && clicked && !preChoice && dPost.deck === dPre.deck + 2 && dPost.used === dPre.used + 1 && mirrorDrafts === 0,
    'opts=' + JSON.stringify(opts) + ' 弹出=' + popped + '(' + popMs + 'ms) 真鼠标=' + clicked + ' 牌库 ' + dPre.deck + '→' + dPost.deck +
    ' draftUsed.lode[1] ' + dPre.used + '→' + dPost.used + ' 点击后落地 ' + clickMs + 'ms' +
    (preChoice ? '【开局前就挂着三选一面板：夹具不干净】' : '') + (mirrorDrafts ? '【guest 镜像 drafts 非空：本地裁决了】' : ''));

  /* ================= E7 guest 掉线 → 房主进结算 ================= */
  const reasonText = await ev(HP, () => (window.GW.HUD.TEXT.result.reason && window.GW.HUD.TEXT.result.reason['opponent-left']) || '');
  // 关页之前把汇总要用的数取走：页面一关，__GW_NET / __sentSnap / __errs 就读不到了（上一轮末尾打印出的 null/-1 就是这么来的）
  const hostErrs = (HP.__errs || []).slice();
  const guestErrs = (GP.__errs || []).slice();
  const liveNet = { host: await netOf(HP), guest: await netOf(GP) };
  const liveSnap = await ev(HP, () => ({ n: window.__sentSnap.length, last: window.__sentSnap.slice(-3) })).catch(() => ({ n: -1, last: [] }));
  const liveRx = await ev(GP, () => (window.__rxSnap || []).length).catch(() => -1);
  const t7 = Date.now();
  await GP.close();
  let shown = false, e7ms = 0;
  for (let i = 0; i < 30 && !shown; i++) {
    await sleep(100);
    shown = await ev(HP, t => {
      const el = document.getElementById('result');
      return !!(el && !el.classList.contains('hidden') && el.innerText.indexOf(t) >= 0);
    }, reasonText);
    if (shown) e7ms = Date.now() - t7;
  }
  const overHost = await overOf(HP);
  ck('E7', 'guest 关掉页面 → 房主 3 秒内 #result 可见且文案含「' + reasonText + '」', shown && !!reasonText,
    '用时 ' + e7ms + 'ms，房主 over=' + JSON.stringify(overHost) + (reasonText ? '' : '（取不到 H.TEXT.result.reason 的 opponent-left 文案）'));
  try { await HP.close(); } catch (e) { }

  /* ================= E8 画面卡顿不许判终局（默认跑；src 未修前预期红） ================= */
  if (!CORE) {
    let pairB = null;
    try { pairB = await openPair('E8'); }
    catch (e) { console.log('  ! E8 的第二对起局失败：' + e.message + '（E8 记红）'); }
    if (pairB) {
      const HPb = pairB.HP, GPb = pairB.GP;
      await ev(HPb, () => {
        const c = window.__dbg.state.net.conn, o = c.onFrame;
        window.__frames = []; window.__frameCount = 0;
        c.onFrame = function (m) {
          if (m && m.type) { window.__frameCount++; if (m.type !== 'input') window.__frames.push(m.type + (m.reason ? ':' + m.reason : '')); }
          return o.apply(this, arguments);
        };
      });
      const blk = await GPb.evaluate(() => { const t = Date.now(); while (Date.now() - t < 1500) { } return Date.now() - t; }).catch(e => 'err:' + String(e.message).slice(0, 60));
      await sleep(2600);
      const frames = await ev(HPb, () => (window.__frames || []).slice(-6)).catch(() => []);
      const frameCount = await ev(HPb, () => window.__frameCount || 0).catch(() => 0);
      const oHb = await overOf(HPb), oGb = await overOf(GPb);
      const rvH = await resultVisible(HPb), rvG = await resultVisible(GPb);
      const noOver = oHb === null && oGb === null;
      ck('E8', '某一页主线程阻塞 1.5 秒（应用心跳缺席）之后，两端 match.over 仍为 null 且都没进结算面板',
        noOver && !rvH && !rvG,
        '阻塞 ' + JSON.stringify(blk) + 'ms；房主收到 ' + frameCount + ' 帧，其中非 input 帧=' + JSON.stringify(frames) +
        ' host.over=' + JSON.stringify(oHb) + ' guest.over=' + JSON.stringify(oGb) +
        ' #result 可见 host/guest=' + rvH + '/' + rvG +
        '（口径：peer-stalled 只提示、真掉线才结算——2026-10-18 修，这条守着它别退回去）');
      try { await HPb.close(); } catch (e) { }
      try { await GPb.close(); } catch (e) { }
    }
  }

  /* ================= E10 积分榜随快照同步 + deathmatch 目标分终局（N5 第 8/9 条） =================
     另起一对（第三对），玩法换成 deathmatch + 胜分 5：这条要量的是「guest 的积分榜与房主一致」，
     而 guest 不跑 kill 也不跑 director.tick —— 击杀数只能从房主快照里的 board 抄过来（src/net-loadout.js
     不管这块，board 由 main.js 的 netPushSnapshot 带上、G.MatchDirector.apply 在 guest 侧覆盖）。
     击杀由房主权威层自己执行（口径与 tools/mode_check.cjs 一致）：
        m.players[1].dead = false; m.players[1].alive = true; m.players[1].hp = m.players[1].maxHp;
        m.kill(m.players[1], m.players[0], m.ctx);            // 房主(side0)杀加入者(side1) 一次
     判据同样按不变量写（父代理过目）：两端 kills / deaths 互为镜像、over.winner 互为镜像，
     不在 guest 那边硬写 kills[0]===1（guest 的 side 0 是自己，房主那次击杀在它这边是 kills[1]）。 */
  if (!CORE) {
    let pairC = null;
    try { pairC = await openPair('E10', { game: { id: 'deathmatch', target: 5 }, hostElement: 'fire', guestElement: 'ice' }); }
    catch (e) { console.log('  ! E10 的第三对起局失败：' + e.message + '（E10 记红）'); }
    if (pairC) {
      const HPc = pairC.HP, GPc = pairC.GP;
      const boardOf = p => ev(p, () => {
        const m = window.GWAPP.match, d = m.director;
        const spec = (d && d.displaySpec) ? d.displaySpec() : null;
        return {
          snap: d ? d.snapshot() : null,
          rows: spec ? spec.rows.map(x => ({ key: x.key, mine: x.mine, theirs: x.theirs })) : null,
          target: spec ? spec.target : null, phase: spec ? spec.phase : null,
          over: m.over ? { w: m.over.winner, r: m.over.winReason } : null,
          mode: m.modeCfg ? m.modeCfg.id : ''
        };
      }).catch(() => null);
      const killOnce = () => ev(HPc, () => {
        const m = window.GWAPP.match, t = m.players[1], s = m.players[0];
        if (!m.ctx) return null;
        t.dead = false; t.alive = true; t.hp = t.maxHp; t.respawn = 0;   // kill 对已死目标直接 return，每次先扶起来
        m.kill(t, s, m.ctx);
        return m.director ? m.director.kills.slice() : null;
      }).catch(() => null);
      const k1 = await killOnce();
      let mirror = null, tM = 0; const t10 = Date.now();
      while (Date.now() - t10 < 3000) {
        const bg = await boardOf(GPc);
        if (bg && bg.snap && bg.snap.kills[1] === 1) { mirror = bg; tM = Date.now() - t10; break; }
        await sleep(100);
      }
      const bh = await boardOf(HPc);
      ck('E10a', '房主 kill() 一次 → guest 的 director 在 ' + tM + 'ms 内把这次击杀镜像成 kills[1]=1（board 跟着快照下来）',
        !!k1 && k1[0] === 1 && !!bh && !!mirror && bh.snap.kills[0] === 1 &&
        mirror.snap.kills[0] === bh.snap.kills[1] && mirror.snap.kills[1] === bh.snap.kills[0] &&
        mirror.snap.deaths[0] === bh.snap.deaths[1] && mirror.snap.deaths[1] === bh.snap.deaths[0],
        '房主 kills=' + JSON.stringify(bh && bh.snap && bh.snap.kills) + ' deaths=' + JSON.stringify(bh && bh.snap && bh.snap.deaths) +
        ' / guest kills=' + JSON.stringify(mirror && mirror.snap && mirror.snap.kills) + ' deaths=' + JSON.stringify(mirror && mirror.snap && mirror.snap.deaths) +
        '（房主那次击杀在 guest 视角是 side 1 —— 不镜像就会显示成"我自己杀了自己"）');
      ck('E10b', '两端积分榜显示一致：行序与 target 相同、数值按 1↔0 镜像，guest 的"我方"就是房主的"对方"',
        !!bh && !!mirror && bh.mode === 'deathmatch' && mirror.mode === 'deathmatch' &&
        JSON.stringify(bh.rows.map(x => x.key)) === JSON.stringify(mirror.rows.map(x => x.key)) &&
        bh.target === mirror.target && bh.target === 5 &&
        mirror.rows.every((x, i) => x.mine === bh.rows[i].theirs && x.theirs === bh.rows[i].mine),
        'host rows=' + JSON.stringify(bh && bh.rows) + ' guest rows=' + JSON.stringify(mirror && mirror.rows) +
        ' target ' + (bh && bh.target) + '/' + (mirror && mirror.target));
      for (let i = 0; i < 4; i++) await killOnce();          // 累计 5 杀 = 胜分 5
      /* guest 的结算由装配层的 onMatchOver 演出来（netApplySnapshot 里那条 msg.over 且 !S.overPause）：
         match.over 有值只说明快照到位，#result 可见才说明 guest 侧那条结算路径真走了。
         所以三条一起等，任何一条没到位都不提前 break（上一版就是 break 太早，把"面板晚一帧"读成了红）。 */
      let oH = null, oG = null, rvG = false, dbgG = null; const t10b = Date.now();
      while (Date.now() - t10b < 6000) {
        oH = await overOf(HPc); oG = await overOf(GPc);
        rvG = await resultVisible(GPc);
        if (oH && oG && oH.r === 'score' && oG.r === 'score' && rvG) break;
        await sleep(120);
      }
      dbgG = await ev(GPc, () => {
        const st = (window.__dbg && window.__dbg.state) ? window.__dbg.state : {};
        const el = document.getElementById('result');
        return { overPause: !!st.overPause, running: !!st.running, cls: el ? String(el.className) : '(no #result)',
          txt: el ? String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50) : '',
          netPhase: window.__GW_NET() ? window.__GW_NET().phase : '?' };
      }).catch(e => ({ err: String(e && e.message).slice(0, 60) }));
      const bh2 = await boardOf(HPc), bg2 = await boardOf(GPc);
      ck('E10c', '累计 5 杀 → 两端都出结算且 winReason=score，winner 两端互为镜像（房主 0 ↔ guest 1）',
        !!oH && !!oG && oH.w === 0 && oG.w === 1 && oH.r === 'score' && oG.r === 'score' && rvG &&
        !!bh2 && !!bg2 && bg2.snap.kills[1] === 5 && bh2.snap.kills[0] === 5 && bg2.phase === 'ended',
        'host over=' + JSON.stringify(oH) + ' guest over=' + JSON.stringify(oG) + ' #result 可见(guest)=' + rvG +
        ' host kills=' + JSON.stringify(bh2 && bh2.snap.kills) + ' guest kills=' + JSON.stringify(bg2 && bg2.snap.kills) +
        ' phase ' + (bh2 && bh2.phase) + '/' + (bg2 && bg2.phase) +
        ' guest 侧现场=' + JSON.stringify(dbgG) + '（overPause=false 说明装配层的 onMatchOver 没被叫到；cls 里带 hidden 说明面板没被展开）');
      try { await HPc.close(); } catch (e) { }
      try { await GPc.close(); } catch (e) { }
    }
  }

  /* ---------- 汇总（数据都在关页之前取好了：页面一关就读不到 __GW_NET/__sentSnap，别到这儿再取） ---------- */
  // guest 页在 E7 已被关掉；rxSnap 的条数在关页之前取（liveRx）
  console.log('');
  console.log('  host 页面异常: ' + (hostErrs.length ? hostErrs.slice(0, 5).join(' || ') : '(none)'));
  console.log('  guest 页面异常: ' + (guestErrs.length ? guestErrs.slice(0, 5).join(' || ') : '(none)'));
  console.log('  快照埋点：房主发出 ' + liveSnap.n + ' 份，最后 3 份 = ' + JSON.stringify(liveSnap.last) + '；guest 收到 ' + liveRx + ' 份（E5b 的线上语料就是这份）'); 
  if (bad) {
    console.log('');
    console.log('  ---- 失败详情 ----');
    console.log('  __GW_NET（关页前取的）host=' + JSON.stringify(liveNet.host) + ' guest=' + JSON.stringify(liveNet.guest));
    console.log('  host console 最后 5 条: ' + (hostErrs.slice(-5).join(' || ') || '(none)'));
    console.log('  guest console 最后 5 条: ' + (guestErrs.slice(-5).join(' || ') || '(none)'));
    console.log('  掉线（E7）：关 guest 页后房主出结算面板用了 ' + e7ms + 'ms，房主 over=' + JSON.stringify(overHost));
    for (const f of fails) console.log('  ✗ ' + f);
  }
  try { await browser.close(); } catch (e) { }
  srv.close(); ws.close();
  console.log('');
  console.log((bad ? '✗' : '✓') + ' net_e2e ' + n + ' 条，' + bad + ' 红' +
    (CORE ? '（--core：跑 E1–E7 与 E9，不起 E8/E10 那两对页面）'
      : '（默认含 E8：peer-stalled 不许判终局；E10：积分榜随快照同步 + 目标分终局）'));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('E2E-FAIL', e); process.exit(1); });
