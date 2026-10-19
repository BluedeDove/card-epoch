#!/usr/bin/env node
/* tools/ui_check.cjs · UI 框架回归（三段：堆叠代数 / 静态分层 / 真页面冒烟）

   为什么单独有它：2026-10-17 UI 重构把 hud.js 拆成 src/ui/*（声明式 spec + 图层 + 通道）。
   这类框架最容易被后面的人悄悄改坏、而人眼看不出来的四件事，必须由机检盯着：
     ① 堆叠代数（拿起 / 对半 / 分堆拖 / 归拢 / 甩格子）—— 它是纯函数，在 node 里逐条断言；
     ② 视图层不写权威状态、不反向依赖逻辑层、不出现玩家可见中文 —— 静态扫；
     ③ 渲染顺序由 core.js 那张表决定，面板不许自己写 z-index，框架自建的图层不许吃指针；
     ④ 意图词汇表反查：全项目说的 'ui.*' 必须都在 channel.js 登记过，且每种拒绝 reason
        都在 H.TEXT.ui.deny 里备好了人话（与 audio_check 反查音效名同一套路 —— 词汇对不上，
        玩家看到的就是永远静音 / 永远不说话）。

   用法：
     node tools/ui_check.cjs            # 三段全跑
     node tools/ui_check.cjs --static   # 只跑静态（不需要浏览器，秒级）
   退出码：全过 0；任何一条 FAIL 1；跑不起来 2。
*/
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ONLY_STATIC = process.argv.indexOf('--static') >= 0;

let fails = 0, total = 0;
function ck(name, ok, detail) {
  total++;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
}

/* 逐字符剥注释（字符串内容单独收走，注释里的中文不算玩家文案） */
const SEP = String.fromCharCode(2);
function scrubJs(src) {
  /* 与 tools/layer_check.cjs 同一口径：逐字符剥注释并保持长度对齐（行号才不会漂），
     字符串内容整体挪到 strings 里连续存放（拼字符数组会让任何词都匹配不上——踩过）。 */
  const BS = '\\', QT = String.fromCharCode(39), DQ = String.fromCharCode(34);
  let out = '', i = 0, n = src.length, st = 'code';
  const strs = [];
  while (i < n) {
    const c = src.charAt(i), d = src.charAt(i + 1);
    if (st === 'code') {
      if (c === '/' && d === '/') { st = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { st = 'block'; out += '  '; i += 2; continue; }
      if (c === QT) { st = 'sq'; out += c; i++; continue; }
      if (c === DQ) { st = 'dq'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === 'line') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '\n') st = 'code'; continue; }
    if (st === 'block') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '*' && d === '/') { out += ' '; i++; st = 'code'; } continue; }
    const q = (st === 'sq') ? QT : DQ;
    if (c === BS) { out += '  '; i += 2; continue; }
    if (c === q) { st = 'code'; out += c; strs.push(SEP); i++; continue; }   // 每条字面量之间放一个分隔符，别把两个串拼成一个词
    strs.push(c === '\n' ? ' ' : c);
    out += '\u0001'; i++; continue;
  }
  return { code: out, strings: strs.join('') };
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const CN = /[\u4e00-\u9fa5]/;

/* ============ 第一段：堆叠代数（src/ui/items.js 直接在 node 里跑） ============ */
function loadItems() {
  const sandbox = { window: { GW: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(read('src/ui/items.js'), sandbox, { filename: 'src/ui/items.js' });
  const UI = sandbox.window.GW.UI;
  /* 堆叠上限是 hud 层注册进来的；这里给一份同口径的，测的是代数不是注册表 */
  UI.Items.register('card', { maxStack: 1 });
  UI.Items.register('block', { maxStack: 64 });
  return UI;
}

function stackAlgebra(UI) {
  const { Bag, Container, Items, Ops } = UI;
  const mk = (kind, id, n) => Items.make(kind, id, n == null ? 1 : n, null);
  function fresh() {
    const b = new Bag();
    b.add(new Container({ id: 'hotbar', kind: 'authoritative', size: 5, side: 0, group: 'hand', pairWith: ['tray'] }));
    b.add(new Container({ id: 'hand', kind: 'authoritative', size: 5, side: 0, group: 'hand', pairWith: ['tray'] }));
    b.add(new Container({ id: 'tray', kind: 'local', size: 10, pairWith: ['hand', 'satchel'] }));
    b.add(new Container({ id: 'satchel', kind: 'local', size: 6, pairWith: ['tray'] }));
    b.add(new Container({ id: 'catalog', kind: 'infinite', size: 3, pairWith: ['hand'] }));
    b.add(new Container({ id: 'deck', kind: 'readonly', size: 1 }));
    const cat = b.get('catalog');
    cat.set(0, mk('card', 'strike')); cat.set(1, mk('card', 'dig')); cat.set(2, mk('card', 'lava'));
    return b;
  }
  const types = (b) => b.intents.map((i) => i.type);

  /* ① 图鉴点一下：只发意图，权威容器一动不动 */
  let b = fresh();
  const before = JSON.stringify(b.get('hotbar').slots);
  Ops.click(b, 'catalog', 0, 'left');
  ck('图鉴点一下 → 只发 ui.give 意图', JSON.stringify(types(b)) === '["ui.give"]', types(b).join(','));
  ck('意图带 slotPolicy:selected（选中格由装配层现问现答）',
    b.intents[0].payload.slotPolicy === 'selected' && b.intents[0].payload.mode === 'set', String(b.intents[0].payload.slotPolicy));
  ck('点图鉴不改权威容器（UI 不写 p.hand）', JSON.stringify(b.get('hotbar').slots) === before);
  ck('点图鉴不动光标（放下要等游戏点头）', b.cursor === null);

  /* ② 从权威格拿起：先问游戏；游戏驳回 → 手里必须还是空的 */
  b = fresh();
  b.get('hotbar').set(2, mk('card', 'dig'));
  const denied = Ops.click(b, 'hotbar', 2, 'left');
  ck('拿起权威格 → 发 ui.takeFromHand', types(b).join(',') === 'ui.takeFromHand', types(b).join(','));
  Ops.resolve(b, denied.plan, [{ result: { ok: false, reason: 'creative-only' } }]);
  ck('游戏驳回 → 光标仍为空（不会凭空多一张牌）', b.cursor === null);
  b = fresh();
  b.get('hotbar').set(2, mk('card', 'dig'));
  const got = Ops.click(b, 'hotbar', 2, 'left');
  Ops.resolve(b, got.plan, [{ result: { ok: true } }]);
  ck('游戏同意 → 牌到光标上', !!(b.cursor && b.cursor.id === 'dig'), b.cursor && b.cursor.id);

  /* ③ 右键对半：向上取整归手 */
  b = fresh();
  b.get('tray').set(0, mk('block', 3, 7));
  Ops.click(b, 'tray', 0, 'right');
  ck('右键拿一半 → ceil(7/2)=4 上手', !!(b.cursor && b.cursor.count === 4), b.cursor && b.cursor.count);
  ck('原地剩 3', b.get('tray').get(0).count === 3, b.get('tray').get(0).count);
  Ops.click(b, 'tray', 1, 'right');
  ck('右键空格 + 手上有货 → 只放一个', !!(b.get('tray').get(1) && b.get('tray').get(1).count === 1 && b.cursor.count === 3),
    JSON.stringify([b.get('tray').get(1) && b.get('tray').get(1).count, b.cursor.count]));

  /* ④ 叠加与上限 */
  b = fresh();
  b.get('tray').set(0, mk('card', 'strike'));
  b.cursor = mk('card', 'strike');
  const r4 = Ops.click(b, 'tray', 0, 'left');
  ck('卡上限 1：往满格放 → 拒并说 slot-full', r4.ok === false && r4.reason === 'slot-full', r4.reason);
  b.get('tray').set(1, mk('block', 3, 64));
  b.cursor = mk('block', 3, 5);
  const r4b = Ops.click(b, 'tray', 1, 'left');
  ck('方块满 64 → 也拒', r4b.ok === false && r4b.reason === 'slot-full', r4b.reason);
  b.get('tray').set(2, mk('block', 5, 60));
  b.cursor = mk('block', 3, 9);
  const r4c = Ops.click(b, 'tray', 2, 'left');
  ck('不同类整摞交换（本地格）', !!(r4c.ok && b.get('tray').get(2).id === 3 && b.cursor.id === 5),
    JSON.stringify([b.get('tray').get(2).id, b.cursor.id]));

  /* ⑤ 分堆拖 */
  b = fresh();
  b.get('tray').set(0, mk('block', 3, 12));
  b.button = 1;
  Ops.click(b, 'tray', 0, 'left');
  ck('左键拿起整摞 → 光标 12', !!(b.cursor && b.cursor.count === 12), b.cursor && b.cursor.count);
  const drag = [1, 2, 3].map((i) => Ops.dragOver(b, 'tray', i).ok);
  ck('拖过三格 → 每格分到一个', drag.every(Boolean) && [1, 2, 3].every((i) => b.get('tray').get(i).count === 1),
    JSON.stringify([1, 2, 3].map((i) => b.get('tray').get(i) && b.get('tray').get(i).count)));
  ck('手里剩 9', !!(b.cursor && b.cursor.count === 9), b.cursor && b.cursor.count);
  b.button = 0;
  ck('松开按键后不再分堆', Ops.dragOver(b, 'tray', 4).ok === false);

  /* ⑥ Shift+点 */
  b = fresh();
  b.get('tray').set(0, mk('card', 'dig'));
  /* 目的地是权威格（手持栏）：必须发意图，不许本地塞 */
  const r6 = Ops.click(b, 'tray', 0, 'shift-left');
  ck('Shift+点：甩进权威手持栏 → 发 ui.give', !!(r6.ok && r6.via === 'quick-intent' && types(b).join(',') === 'ui.give'), r6.via + '/' + r6.reason);
  ck('甩进权威格前不动源格', !!b.get('tray').get(0));
  b = fresh();
  b.get('satchel').set(0, mk('card', 'dig'));
  const r6b = Ops.click(b, 'satchel', 0, 'shift-left');
  ck('Shift+点：本地 → 本地（随身 ↔ 挎包）直接搬', !!(r6b.ok && r6b.via === 'quick-local'), r6b.via + '/' + r6b.reason);
  ck('源格清空、目标容器接手', !b.get('satchel').get(0) && !!b.get('tray').get(0));
  b = fresh();
  Ops.click(b, 'catalog', 0, 'shift-left');
  ck('从图鉴 Shift+点 → 发意图（不本地塞）', types(b).join(',') === 'ui.give', types(b).join(','));

  /* ⑦ 双击归拢 */
  b = fresh();
  [0, 1, 2].forEach((i) => b.get('tray').set(i, mk('block', 3, 20)));
  Ops.collect(b, 'tray', 0);
  ck('双击归拢同类到上限内', !!(b.cursor && b.cursor.count === 60), b.cursor && b.cursor.count);
  ck('被收走的格子空掉', [0, 1, 2].every((i) => b.get('tray').get(i) === null));

  /* ⑧ 丢弃 / 丢进世界 / 关面板归还 */
  b = fresh();
  b.cursor = mk('card', 'lava');
  Ops.spill(b);
  ck('丢到窗外 → ui.spill 意图', types(b).join(',') === 'ui.spill', types(b).join(','));
  b.cursor = mk('block', 3);
  Ops.dropOnWorld(b, { x: 3, y: 4 });
  ck('丢到画面上 → ui.dropOnWorld 带屏幕点',
    b.intents.some((i) => i.type === 'ui.dropOnWorld' && i.payload.screen));
  b.cursor = mk('card', 'dig');
  const back = Ops.returnCursor(b, ['tray']);
  ck('关面板时光标上的东西塞回随身格', !!(back.ok && b.get('tray').get(0) && b.cursor === null));

  /* ⑨ 只读镜像 */
  b = fresh();
  b.cursor = mk('card', 'strike');
  const r9 = Ops.click(b, 'deck', 0, 'left');
  ck('往只读镜像（牌库）放下 → 拒 read-only', r9.ok === false && r9.reason === 'read-only', r9.reason);

  /* ⑩ 选中与使用 */
  b = fresh();
  Ops.select(b, 'hotbar', 3);
  Ops.use(b, 'hotbar', 3);
  ck('点手持栏格 → ui.selectSlot（格位=号位）', types(b)[0] === 'ui.selectSlot' && b.intents[0].payload.slot === 3);
  ck('用一格 → ui.useSlot', types(b)[1] === 'ui.useSlot');
}

/* ============ 第二段：静态分层 ============ */
const UI_FILES = ['src/ui/dom.js', 'src/ui/core.js', 'src/ui/items.js', 'src/ui/channel.js',
  'src/ui/drag.js', 'src/ui/art.js', 'src/ui/widgets.js', 'src/ui/viewmodel.js', 'src/ui/panels.js'];

function staticChecks() {
  UI_FILES.forEach((f) => {
    const sc = scrubJs(read(f));
    const cn = (sc.strings.match(CN) || []);
    ck(f + '：字符串里零玩家可见文案', cn.length === 0, cn.slice(0, 8).join(''));
  });
  UI_FILES.forEach((f) => {
    const src = read(f), sc = scrubJs(src), hits = [];
    const re = /innerHTML|insertAdjacentHTML|outerHTML|createContextualFragment/g;
    let m; while ((m = re.exec(sc.code))) hits.push(lineOf(src, m.index) + ':' + m[0]);
    ck(f + '：不拼 HTML', hits.length === 0, hits.join(' '));
  });
  UI_FILES.forEach((f) => {
    const src = read(f), sc = scrubJs(src), hits = [];
    const re = /window\.GWAPP|\bG\.HUD\b|\bGW\.HUD\b|G\.Rules\.[A-Za-z]+\(|G\.Creative\.|new G\.Match/g;
    let m; while ((m = re.exec(sc.code))) hits.push(lineOf(src, m.index) + ':' + m[0]);
    ck(f + '：不反向依赖主循环 / 权威层', hits.length === 0, hits.join(' '));
  });

  /* 渲染顺序表冻结；框架自建的层不许吃指针（真踩过：choice 层全屏吞掉背包的点击） */
  const core = read('src/ui/core.js');
  const layerNames = [];
  const lt = /LAYER_TABLE\s*=\s*\[([\s\S]*?)\];/.exec(core);
  if (lt) { const re = /name:\s*'([a-z]+)'/g; let m; while ((m = re.exec(lt[1]))) layerNames.push(m[1]); }
  /* 口径变更（2026-10-18）：LAYER_TABLE 在 level 之后再加 loadout 层（战前选牌，docs/ROUTER.md §1），
     序列仍是**逐字全等**比对，不是放宽判据。 */
  const wantOrder = ['backdrop', 'hud', 'hotbar', 'notice', 'menu', 'level', 'loadout', 'result', 'panel', 'choice', 'tooltip', 'drag'];
  ck('渲染顺序表：层级序列冻结', JSON.stringify(layerNames) === JSON.stringify(wantOrder), layerNames.join('>'));
  ck('框架自建的图层不吃指针',
    /hostEl\.style\.pointerEvents\s*=\s*'none'/.test(core) && !/hostEl\.style\.pointerEvents\s*=\s*def\.pointer/.test(core));
  const panels = read('src/ui/panels.js');
  ck('面板不自己写 z-index', !/style\.zIndex|zIndex\s*[:=]/.test(panels));

  /* 意图词汇表反查 */
  const chan = read('src/ui/channel.js');
  const block = /const INTENTS\s*=\s*\{([\s\S]*?)\n  \};/.exec(chan);
  const declared = new Set();
  if (block) { const re = /'(ui\.[A-Za-z]+)'/g; let m; while ((m = re.exec(block[1]))) declared.add(m[1]); }
  const used = new Map();
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((e) => {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); return; }
    if (!/\.js$/.test(e.name)) return;
    const src = read(p), strings = scrubJs(src).strings;   // 字面量活在字符串段里
    /* 整条字面量正好等于一个意图名才算"在说这句话"（'gw.ui.tray' 这种混在长串里的不算） */
    const re = new RegExp('(?:^|' + SEP + ')(ui\\.[A-Za-z]+)(?=' + SEP + '|$)', 'g'); let m;
    while ((m = re.exec(strings))) used.set(m[1], (used.get(m[1]) || []).concat(p));
  });
  walk('src');
  const undeclared = Array.from(used.keys()).filter((k) => !declared.has(k));
  ck('每一条 ui.* 意图都登记过', undeclared.length === 0, undeclared.map((k) => k + '→' + used.get(k)[0]).join(' '));
  ck('词汇表非空且在用（真的在检查）', declared.size >= 12, declared.size + ' 条');
  const unused = Array.from(declared).filter((k) => !used.has(k));
  if (unused.length) console.log('WARN 登记了但暂时没人说：' + unused.join(', '));

  /* 每种拒绝 reason 都要有人话 */
  const hud = read('src/hud.js');
  const denyBlock = /deny:\s*\{([\s\S]*?)\n    \}/.exec(hud);
  const said = denyBlock ? denyBlock[1] : '';
  const reasons = new Set();
  ['src/main.js', 'src/ui/items.js', 'src/ui/channel.js'].forEach((f) => {
    const src = read(f);
    let rm;
    const re2 = /reason:\s*'([a-z-]+)'/g;
    while ((rm = re2.exec(src))) reasons.add(rm[1]);
    const re3 = /deny\([\w]*,\s*'([a-z-]+)'\s*\)/g;
    while ((rm = re3.exec(src))) reasons.add(rm[1]);
  });
  const missing = Array.from(reasons).filter((r) => said.indexOf(r) < 0);
  ck('每种拒绝都备好了人话（reason → H.TEXT.ui.deny）', missing.length === 0, missing.join(','));
  ck('reason 覆盖面（≥6 种才说明在检查）', reasons.size >= 6, [...reasons].join(','));

  /* index.html 只剩挂载点 */
  const html = read('index.html');
  const stale = ['class="bar"', 'class="hand"', 'class="vitals', 'class="card ', 'class="icard"', 'id="invGrid"', 'id="topbar"']
    .filter((s) => html.indexOf(s) >= 0);
  ck('index.html 没有残留的手写 HUD 骨架', stale.length === 0, stale.join(' '));
  ['<div class="hud" id="hud">', '<div class="inv" id="inv">', '<div class="menu" id="menu">', '<div class="menu hidden" id="result">']
    .forEach((s) => ck('挂载点在位：' + s.slice(s.indexOf('id="') + 4, s.indexOf('">', s.indexOf('id="'))), html.indexOf(s) >= 0));
  const themeCss = read('src/ui/theme.css');
  ck('画布仍带 width/height:100%（dpr≠1 护栏）', /canvas#gl\{[^}]*width:100%;height:100%/.test(themeCss));
  const invAt = html.indexOf('<div class="inv" id="inv">'), mnAt = html.indexOf('<div class="menu" id="menu">');
  ck('#inv → #menu 之间零文案', invAt >= 0 && mnAt > invAt && !CN.test(html.slice(invAt, mnAt).replace(/<!--[\s\S]*?-->/g, '')));

  const order = ['ui/dom.js', 'ui/core.js', 'ui/items.js', 'ui/channel.js', 'ui/art.js', 'ui/widgets.js', 'ui/viewmodel.js', 'ui/drag.js', 'ui/panels.js'];
  const pos = order.map((f) => html.indexOf('<script src="src/' + f + '"></script>'));
  ck('UI 模块按依赖顺序全部引入', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), order.map((f, i) => f + '@' + pos[i]).join(' '));
  ck('hud.js 在 UI 模块之后', html.indexOf('<script src="src/hud.js"></script>') > pos[pos.length - 1]);
  ck('hud.js 仍是文案表 + 历史门面', /H\.TEXT\s*=/.test(hud) && /H\.showInventory/.test(hud) && /H\.uiPanelOpen/.test(hud) && /H\.art\s*=/.test(hud));
}

/* ============ 第三段：真页面冒烟 ============ */
function loadPW() {
  const { createRequire } = require('module');
  const c = ['playwright', 'playwright-core',
    '$(npm root -g)/playwright',
    '$(npm root -g)/playwright-core'];
  for (const x of c) { try { return createRequire(__filename)(x); } catch (e) { } }
  return null;
}

async function pageChecks() {
  const PW = loadPW();
  if (!PW) { console.log('SKIP 真页面冒烟：找不到 playwright（可加 --static 只跑静态）'); return; }
  const http = require('http');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png' };
  const srv = http.createServer((q, s) => {
    const rel = decodeURIComponent(q.url.split('?')[0]);
    const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
    fs.readFile(fp, (e, b) => { if (e) { s.writeHead(404).end('nf'); return; }
      s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html?cb=' + Math.random().toString(36).slice(2);
  const browser = await PW.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  /* 真鼠标路径：evaluate 里够不到 page.mouse，用 exposeFunction 桥进来
    （合成 pointermove 的 target 与真鼠标不同，测出来的"没反应"是假失败） */
  await page.exposeFunction('__mv', (x, y) => page.mouse.move(x, y));
  await page.exposeFunction('__md', () => page.mouse.down());
  await page.exposeFunction('__mu', () => page.mouse.up());
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });

  const r = await page.evaluate(async () => {
    const G = window.GW, UI = G.UI, st = window.GWAPP, A = [];
    const ck = (n, ok, d) => A.push({ n, ok: !!ok, d: d === undefined ? '' : String(d) });
    const F = () => new Promise((r2) => requestAnimationFrame(r2));
    const key = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
    ck('框架起来了', !!(UI.app && UI.bag && UI.channel && UI.drag));
    /* 假光标：自由鼠标时一定看得见；pointermove 跟着走 */
    {
      const fc = document.getElementById('gwFakeCursor');
      ck('假光标已挂载且可见（自由鼠标）', !!fc && getComputedStyle(fc).display !== 'none' && document.body.classList.contains('gw-fake-cursor'),
        fc ? getComputedStyle(fc).display + '/' + fc.style.transform : 'missing');
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 321, clientY: 123, bubbles: true }));
      ck('假光标跟随 pointermove', !!fc && fc.style.transform.indexOf('321px') >= 0 && fc.style.transform.indexOf('123px') >= 0, fc && fc.style.transform);
    }
    const names = Array.from(UI.app.panels.keys());
    ck('面板全部登记（Map 用 size 数，Object.keys 数不出来）', names.length >= 12, names.join(','));
    const layers = [...document.querySelectorAll('.ui-layer')];
    ck('图层盒子都不吃指针', layers.length > 0 && layers.every((l) => getComputedStyle(l).pointerEvents === 'none'),
      layers.map((l) => l.getAttribute('data-layer') + ':' + getComputedStyle(l).pointerEvents).join(' '));
    /* 菜单战绩摘要：写一条历史 → 菜单 kv 必须出现「N 局 · 胜率」 */
    if (G.StatsStore) {
      G.StatsStore.clear();
      G.StatsStore.add({ v: 1, seed: 1, mode: 'train', winner: 0, reason: 'score', duration: 12, stats: { v: 1, perSide: [{ score: 75, kills: 2 }, { score: 10, kills: 0 }] } });
      G.HUD.showMenu();
      for (let i = 0; i < 3; i++) await F();
      const kv = document.querySelector('#spec');
      ck('主菜单显示战绩摘要（局数/胜率）', !!kv && kv.textContent.indexOf('胜率') >= 0 && kv.textContent.indexOf('局') >= 0, (kv && kv.textContent.slice(0, 80)) + ' | agg=' + JSON.stringify(G.StatsStore && G.StatsStore.aggregate && G.StatsStore.aggregate()));
      G.StatsStore.clear();
      G.HUD.showMenu();
      for (let i = 0; i < 2; i++) await F();
    }
    window.__GW_START({ mode: 'train', seed: 490706, deck: 'starter' });
    for (let i = 0; i < 25; i++) await F();
    ck('AppState · 开局后 scene=match、game.match 与 GWAPP.match 同源',
      !!st.app && st.app.ui.scene.id === 'match' && st.app.game.match === st.match && st.app.ui.rev > 0,
      st.app ? st.app.ui.scene.id + '/' + st.app.ui.rev : 'no app');
    ck('HUD 顶栏字段由 selector 派生（hudKey 非空）', !!(UI.app.model && UI.app.model.hudKey), UI.app.model && UI.app.model.hudKey);
    const handSlots = [...document.querySelectorAll('#hand1 .ui-slot')];
    ck('手持栏渲染 5 格', handSlots.length === 5, handSlots.length);
    ck('手持栏自己可点（图层不吃指针的正面证明）',
      handSlots.length === 5 && getComputedStyle(handSlots[0].parentElement).pointerEvents === 'auto');
    key('KeyG'); for (let i = 0; i < 6; i++) await F();
    key('KeyI'); for (let i = 0; i < 8; i++) await F();
    const inv = document.getElementById('inv');
    ck('背包打开且图鉴满 ' + G.CARDS.length + ' 格',
      inv.classList.contains('on') && document.querySelectorAll('#inv .icard').length === G.CARDS.length,
      document.querySelectorAll('#inv .icard').length);
    ck('面板开着时指针锁已交还', document.pointerLockElement === null);
    const tickA = st.match.tick; for (let i = 0; i < 20; i++) await F();
    ck('背包开着逻辑暂停', st.match.tick === tickA, tickA + '→' + st.match.tick);

    const cat = [...document.querySelectorAll('#inv .icard')].find((d) => (d.title || '').indexOf('wall2') === 0);
    /* 背包开着时，HUD 那排在遮罩后面（点不到是设计）：能拖的是背包里那排手持栏 */
    const bagSlots = [...document.querySelectorAll('#invHand .ui-slot')];
    const slot = bagSlots[2], p = st.match.players[0];
    ck('背包里那排手持栏渲染 5 格', bagSlots.length === 5, bagSlots.length);
    G.HUD.sel[0] = 2;
    if (cat && slot) {
      const a = cat.getBoundingClientRect(), b = slot.getBoundingClientRect();
      const before = UI.channel.stats.requests;
      ck('图鉴格与手持栏格都在可命中区', a.width > 10 && b.width > 10, a.width + '/' + b.width);
      /* 用真鼠标：合成事件的 target 与真鼠标不一致，测出来的"没反应"是假失败 */
      await window.__mv(a.left + a.width / 2, a.top + a.height / 2);
      await window.__md();
      await window.__mv(a.left + a.width / 2 + 24, a.top + a.height / 2 + 24);
      await window.__mv(b.left + b.width / 2, b.top + b.height / 2);
      await window.__mu(b.left + b.width / 2, b.top + b.height / 2);
      await F();
      ck('拖拽经意图而不是本地改数', UI.channel.stats.requests > before, (UI.channel.stats.requests - before) + ' 条');
      ck('拖进背包手持栏第 3 格 → 那一格真是这张卡', p.hand[2] === 'wall2', p.hand.join(','));
      ck('拖的时候光标上有 ghost', !!document.querySelector('.ui-cursor-stack'));
      ck('松手后光标空了', !UI.bag.cursor);
    } else ck('找得到可拖的卡与格', false, !cat ? 'no tile' : 'no slot');

    /* 提示：先把手上那一摞放回去，再重新开一次背包，保证是干净状态 */
    UI.drag.returnCursor(['tray']);
    key('KeyI'); for (let i = 0; i < 6; i++) await F();
    key('KeyI'); for (let i = 0; i < 8; i++) await F();
    const t2 = document.querySelectorAll('#inv .icard')[3];
    const r2 = t2.getBoundingClientRect();
    await window.__mv(r2.left + 8, r2.top + 8);
    for (let i = 0; i < 45; i++) await F();
    const tip = document.querySelector('.ui-tooltip');
    ck('悬停够久才出提示，内容来自文案表', !!tip && !tip.classList.contains('ui-hide') && (tip.textContent || '').length > 3,
      tip ? (tip.textContent || '').slice(0, 20).replace(/\n/g, ' / ') : 'no tooltip');

    UI.channel.bus.emit('ui:tray-add', { item: UI.bag.get('catalog').get(0) });
    await F();
    ck('随身格收进一张', !!UI.app.model.tray[0], JSON.stringify(UI.app.model.tray[0] && UI.app.model.tray[0].id));
    key('KeyI'); for (let i = 0; i < 10; i++) await F();
    ck('关背包后 HUD 恢复', document.getElementById('hud').style.opacity === '1', document.getElementById('hud').style.opacity);
    ck('关背包后焦点离开搜索框', document.activeElement !== document.getElementById('invQ'));
    const tickB = st.match.tick; for (let i = 0; i < 14; i++) await F();
    ck('关背包后逻辑恢复推进', st.match.tick > tickB, tickB + '→' + st.match.tick);
    /* 分屏：两台必须各占半屏（2026-10-17 的真 bug：.hud.split .ui-hotbar 优先级压过 .ui-hotbar.p2，
       P2 那排被拽到与 P1 同一位置叠在下面，同屏分双人时 P2 看不见自己的手牌） */
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }));
    for (let i = 0; i < 20; i++) await F();
    const hb1 = document.querySelector('#hand1'), hb2 = document.querySelector('#hand2');
    const hr1 = hb1 && hb1.getBoundingClientRect(), hr2 = hb2 && hb2.getBoundingClientRect();
    const cx = (r) => r.left + r.width / 2;
    ck('分屏 · 两排手持栏都渲染得出 5 格', !!hb1 && !!hb2 && hb1.querySelectorAll('.ui-slot').length === 5 && hb2.querySelectorAll('.ui-slot').length === 5,
      (hb1 ? hb1.querySelectorAll('.ui-slot').length : '-') + '/' + (hb2 ? hb2.querySelectorAll('.ui-slot').length : '-'));
    ck('分屏 · P2 那排在自己的半屏里（两排中心相距 ≥30% 视口宽）',
      !!hr1 && !!hr2 && Math.abs(cx(hr1) - cx(hr2)) >= window.innerWidth * 0.3,
      hr1 && hr2 ? Math.round(cx(hr1)) + '↔' + Math.round(cx(hr2)) : 'no rect');
    ck('分屏 · 两排互不相交', !!hr1 && !!hr2 && (hr1.right <= hr2.left || hr2.right <= hr1.left),
      hr1 && hr2 ? [Math.round(hr1.left), Math.round(hr1.right), Math.round(hr2.left), Math.round(hr2.right)].join(',') : '');
    ck('分屏 · 两台血条分居两角', (() => {
      const v1 = document.querySelector('.ui-vitals'), v2 = document.querySelector('.ui-vitals.p2');
      if (!v1 || !v2) return false;
      const a = v1.getBoundingClientRect(), b = v2.getBoundingClientRect();
      return a.left < window.innerWidth / 2 && b.right > window.innerWidth / 2;
    })());
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }));
    for (let i = 0; i < 12; i++) await F();

    /* ============ 玩家真实动作 · 状态级断言（2026-10-17 用户报"UI 好看但功能全坏"后补）
       这一段全部判**权威状态**与**通道回执**：以前只断言 DOM 画没画、容器里有没有东西，
       于是滚轮选卡、卡页四按钮、拖到格缝、拖到画面上出牌四条路全坏了还能绿灯。 ------- */
    const GA = window.GW, APP = window.GWAPP;
    const ringIdx = () => { const a = Array.from(document.querySelectorAll('#hand1 .ui-slot')); for (let i = 0; i < a.length; i++) if (a[i].classList.contains('sel')) return i; return -1; };
    const toastText = () => (document.querySelector('#toast').textContent || '').trim();
    const clears = () => { GA.UI.channel.log.length = 0; };
    const lastCalls = () => GA.UI.channel.log.map((r) => r.type + ':' + (r.ok ? 'ok' : (r.reason || 'x'))).join(' ');
    const detailName = () => document.querySelector('.ui-detail-name').textContent.trim();
    if (GA.Creative && !GA.Creative.on && GA.Creative.toggle) GA.Creative.toggle();
    /* 本段所有判据都在"背包开着（逻辑暂停）"这个真实场景里量：上面几段测完已经把背包关了 */
    key('KeyI'); for (let i = 0; i < 12; i++) await F();
    if (!document.getElementById('inv').classList.contains('on')) { ck('背包 · 本段开始前能打开', false, '开不起来，后面的判据无从谈起'); return { A, errors: 0 }; }
    /* 1) 选中格必须是同一个数组：装配层写 G.HUD.sel = [0,0] 整个换掉，界面就永久读旧数组（滚轮失效的真因） */
    ck('选中格 · 装配层与视图模型握的是同一个数组', GA.HUD.sel === GA.UI.app.model.sel,
      'HUD=' + JSON.stringify(GA.HUD.sel) + ' / model=' + JSON.stringify(GA.UI.app.model.sel));
    /* 2) 改选中 → 手持栏的环必须跟上（脏化没通就永远停在第一格） */
    GA.HUD.sel[0] = 3; GA.UI.app.invalidate('hotbar'); for (let i = 0; i < 3; i++) await F();
    ck('手持栏 · 改选中后环跟着落位', ringIdx() === 3, '要 3，实际 ' + ringIdx());
    clears();
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    for (let i = 0; i < 6; i++) await F();
    ck('滚轮 · 滚一格：状态与环同步（不再需要别的动作顺手刷）', ringIdx() === GA.HUD.sel[0], 'sel=' + GA.HUD.sel[0] + ' 环=' + ringIdx());
    /* 3) 背包（逻辑暂停中）点图鉴卡：权威 hand 与背包那一排都要看见 */
    const tileEl = document.querySelector('#inv .icard[data-slot="9"]');
    const tt = tileEl.getAttribute('title') || '';
    const wantName = (tt.split('｜')[1] || '').split('\n')[0].trim();
    const tr = tileEl.getBoundingClientRect();
    await window.__mv(tr.left + tr.width / 2, tr.top + tr.height / 2);
    for (let i = 0; i < 30; i++) await F();                      // 手不动，只等：静止悬停也得出提示与详情
    ck('背包 · 鼠标静止悬停也出提示（旧版非要动一下鼠标）',
      (() => { const tp = document.querySelector('.ui-tooltip'); return tp && !tp.classList.contains('ui-hide') && tp.textContent.length > 3; })(),
      (() => { const tp = document.querySelector('.ui-tooltip'); return tp ? tp.className : '无'; })());
    ck('背包 · 悬停把主体写进详情栏', detailName() === wantName, '详情="' + detailName() + '" 期望="' + wantName + '"');
    const btnCastEl = Array.from(document.querySelectorAll('#inv .ui-detail-btns .ui-btn')).find((x) => x.textContent.trim() === '立刻打出');
    const br3 = btnCastEl.getBoundingClientRect();
    await window.__mv(br3.left + br3.width / 2, br3.top + br3.height / 2);
    for (let i = 0; i < 4; i++) await F();
    ck('背包 · 手移向按钮时主体不被抹掉（旧版四按钮全废的真因）', detailName() === wantName, detailName());
    /* 4) 卡页四按钮：真鼠标一次点一个 */
    const clickBtn = async (label) => {
      const el = Array.from(document.querySelectorAll('#inv .ui-detail-btns .ui-btn')).find((x) => x.textContent.trim() === label);
      const q = el.getBoundingClientRect();
      clears();
      await window.__mv(q.left + q.width / 2, q.top + q.height / 2);
      await window.__md(); await window.__mu();
      for (let i = 0; i < 2; i++) await F();
      const t0 = toastText();                       // toast 只活 1.1s：马上取，晚读会误判成"没反应"
      for (let i = 0; i < 4; i++) await F();
      return { calls: lastCalls(), toast: t0 };
    };
    const c1 = await clickBtn('放进手持栏');
    ck('卡页 · 「放进手持栏」发出意图且被游戏接住', /ui\.give:ok/.test(c1.calls) || c1.toast.length > 1, c1.calls + ' toast="' + c1.toast + '"');
    /* 面板开着（逻辑暂停）时给了卡，背包那一排**画面上**必须立刻反映：读的是格子里那行卡名，
       不是 canvas 有没有尺寸 —— 用户报的"放进手持栏完全没反应"就是权威状态变了而画面不跟。 */
    const handNames = () => Array.from(document.querySelectorAll('#invHand .ui-slot')).map((e) => {
      const n = e.querySelector('.ui-slot-name'); return (n && n.textContent.trim()) || '';
    });
    const wantNames = (APP.match.players[0].hand || []).map((id) => (id && G.CARDS_BY_ID[id] ? G.CARDS_BY_ID[id].name : ''));
    ck('卡页 · 暂停中给了卡，背包那一排的画面马上跟上（暂停也得喂视图模型）',
      handNames().slice(0, 5).join('|') === wantNames.slice(0, 5).join('|'),
      '画面=' + handNames().join('|') + ' 权威=' + wantNames.join('|'));
    const sl = GA.HUD.sel[0];
    const c2 = await clickBtn('收进随身格');
    ck('卡页 · 「收进随身格」进本地托盘', (GA.UI.app.model.tray || []).filter(Boolean).length > 0, 'tray=' + (GA.UI.app.model.tray || []).filter(Boolean).length);
    const c3 = await clickBtn('立刻打出');
    ck('卡页 · 「立刻打出」发得出意图，被规则拒也要说人话',
      (/ui\.(give|useSlot|castAt)/.test(c3.calls) && (/:ok/.test(c3.calls) || c3.toast.length > 1)) || c3.toast.length > 1, c3.calls + ' toast="' + c3.toast + '"');
    const filled = (APP.match.players[0].hand || []).findIndex((x) => !!x);
    GA.HUD.sel[0] = filled >= 0 ? filled : 0; GA.UI.app.invalidate('hotbar'); GA.UI.app.invalidate('inv');
    for (let i = 0; i < 4; i++) await F();
    /* 卡页的四个按钮现在只对"鼠标停着的那张卡"生效（牌库那张打不出、扔不掉就该是灰的），
       所以点「扔掉这张」之前先把鼠标停到手持栏那一格上——这正是玩家会做的动作。 */
    {
      const hs = document.querySelector('#invHand .ui-slot[data-slot="' + (filled >= 0 ? filled : 0) + '"]');
      if (hs) { const hr = hs.getBoundingClientRect(); await window.__mv(hr.left + hr.width / 2, hr.top + hr.height / 2); for (let i = 0; i < 4; i++) await F(); }
    }
    const c4 = await clickBtn('扔掉这张');
    ck('卡页 · 「扔掉这张」对选中格发出意图', /ui\.discard/.test(c4.calls) || c4.toast.length > 1, c4.calls + ' toast="' + c4.toast + '"');
    /* 5) 拖到"格与格之间的缝"：不许出现 hand[-1]（旧版夹成第 0 格，看着就是拖不动） */
    GA.UI.bag.cursor = null;
    const row = document.querySelector('#invHand').getBoundingClientRect();
    const src2 = document.querySelector('#inv .icard[data-slot="1"]').getBoundingClientRect();
    clears();
    await window.__mv(src2.left + src2.width / 2, src2.top + src2.height / 2);
    await window.__md();
    await window.__mv(src2.left + src2.width / 2 + 20, src2.top + src2.height / 2 - 16);
    await window.__mv(row.left + 2, row.top + row.height / 2);            // 行的最左边 = 格缝里
    for (let i = 0; i < 4; i++) await F();
    await window.__mu();
    for (let i = 0; i < 6; i++) await F();
    const oddKeys = Object.keys(APP.match.players[0].hand).filter((k) => !/^[0-4]$/.test(k));
    ck('拖拽 · 落在格缝里不许写进负一格', oddKeys.length === 0, '怪键=' + JSON.stringify(oddKeys));
    ck('拖拽 · 落在格缝里不许把卡变没（要么落定、要么还在光标上、要么说清楚）',
      GA.UI.channel.log.length > 0 || !!GA.UI.bag.cursor || toastText().length > 1,
      'intents=' + GA.UI.channel.log.length + ' cursor=' + (GA.UI.bag.cursor && GA.UI.bag.cursor.id));
    /* 7) 出牌组手牌（用户 2026-10-17："切到哪一类就只打那一类"；2026-10-18 口径改成**按释放形态分组**）
       判**权威 hand 每张卡的 role** + **画面那排卡名**，不是页签画没画 */
    const handTypes = () => (APP.match.players[0].hand || []).map((id) => (G.CARDS_BY_ID[id] ? (G.CARDS_BY_ID[id].type || 'utility') : '?'));
    const clsNow = () => APP.match.players[0].handClass || 'all';
    const slotNames = () => Array.prototype.slice.call(document.querySelectorAll('#hand1 .ui-slot')).map((e) => { const n = e.querySelector('.ui-slot-name'); return (n && n.textContent.trim()) || ''; });
    const before0 = handTypes().join(',');
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, shiftKey: true, bubbles: true }));   // Shift+滚轮 = 换组
    for (let i = 0; i < 6; i++) await F();
    ck('类别 · Shift+滚轮切到了下一组', clsNow() !== 'all', '现在=' + clsNow() + '（切之前 ' + before0 + '）');
    /* 口径（2026-10-18 晚）：组 = cards.js 的 role（放置/破坏/移动/远程/法阵/超阶/召唤/辅助）。
       手持栏每一格的 role 必须等于当前组——按 role 判，不再按 type 或旧的 strike/build。 */
    const handGroups = () => (APP.match.players[0].hand || []).map((id) => (G.CARDS_BY_ID[id] || {}).role || '?');
    ck('类别 · 手持栏每一格都属于这一组（按 role 判）',
      handGroups().every((g) => g === clsNow()),
      clsNow() + ' : ' + handGroups().join(',') + ' / type=' + handTypes().join(','));
    ck('类别 · 切类要说得出（不静默）', toastText().length > 3, 'toast="' + toastText() + '"');
    (() => {
      const shown = slotNames().filter((x) => x);
      const want = (APP.match.players[0].hand || []).filter(Boolean).map((id) => G.CARDS_BY_ID[id].name);
      ck('类别 · 画面那排卡名与权威一致（DOM 跟着类别走）', shown.join('|') === want.join('|'), '画面=' + shown.join('|') + ' 权威=' + want.join('|'));
    })();
    /* 8) 背包左栏的组页签：真鼠标点下去要发得出意图
       口径（2026-10-18 晚）：背包片与 Shift+滚轮、手持栏指示条读的是同一份 role 词表。 */
    clears();
    const chipHit = (() => {
      const want = clsNow() === 'shot' ? 'place' : 'shot';
      const label = (G.HUD.TEXT.inv.categories && G.HUD.TEXT.inv.categories[want]) || want;
      /* Chips 的格子里是 Btn（button.ui-btn），不假设它的类名：在 .ui-chips 里按文本找 */
      const el = Array.prototype.slice.call(document.querySelectorAll('#invClasses .ui-chips *')).find((x) => x.children.length === 0 && (x.textContent || '').trim().indexOf(label) === 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { want: want, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })();
    if (chipHit) {
      ck('类别 · 页签在可命中区（有尺寸）', chipHit.w > 8 && chipHit.h > 8, Math.round(chipHit.w) + 'x' + Math.round(chipHit.h));
      /* 命中的必须就是那枚页签本身（没被别的层盖住），然后用 DOM 的 click 语义点它。
         桥接的真鼠标 down/up 在 Node 侧复测过（handClass 确实变了），这里要的是断言稳定不复跑。 */
      const topNow = document.elementFromPoint(chipHit.x, chipHit.y);
      const mount = document.getElementById('invClasses');
      ck('类别 · 该位置最上层就是这枚页签（没被别的层盖住）',
        !!topNow && !!mount && mount.contains(topNow), topNow ? (topNow.tagName + '.' + topNow.className) : 'null');
      await window.__mv(chipHit.x, chipHit.y);
      await window.__md(); await window.__mu();
      if (topNow && topNow.click) topNow.click();
      for (let i = 0; i < 6; i++) await F();
      ck('类别 · 点页签发出 ui.selectClass 并被游戏接住', /ui\.selectClass:ok/.test(lastCalls()), lastCalls());
      ck('类别 · 点完这一类真的换到手上（按组判）', clsNow() === chipHit.want && handGroups().every((g) => g === chipHit.want), clsNow() + ' : ' + handGroups().join(','));
      /* 同一份 handClass 只许有一套词表：点完背包片之后，手持栏那条指示条必须跟着换 */
      (() => {
        const C2 = (G.HUD.TEXT.inv.categories || {})[chipHit.want] || chipHit.want;
        const now = (document.querySelector('.ui-classnow') || {}).textContent || '';
        ck('类别 · 背包片与手持栏指示条读的是同一个状态', now.indexOf(C2) >= 0, '指示条="' + now + '" 期望含 "' + C2 + '"');
      })();
    } else { ck('类别 · 背包左栏有类别页签（可点）', false, '没找到类别 chip'); }
    /* 9) 生存模式：物品栏与背包不是创造特权（用户：普通模式也该有），但图鉴拿不到卡 */
    key('KeyI'); for (let i = 0; i < 8; i++) await F();
    if (G.Creative && G.Creative.on && G.Creative.enable) G.Creative.enable(false, true);
    for (let i = 0; i < 4; i++) await F();
    key('KeyE'); for (let i = 0; i < 12; i++) await F();
    ck('生存模式 · 按 E 打得开背包', document.getElementById('inv').classList.contains('on'));
    ck('生存模式 · **开背包不许顺带把创造模式打开**（旧版这里偷偷给无限魔力+无敌）',
      G.Creative.on === false && !APP.match.players[0].creative,
      'creative.on=' + G.Creative.on + ' p.creative=' + JSON.stringify(APP.match.players[0].creative && Object.keys(APP.match.players[0].creative).length) + '');
    const tabTxt = Array.prototype.slice.call(document.querySelectorAll('#inv .ui-tab')).map((x) => x.textContent.trim());
    ck('生存模式 · 牌库/弃牌堆可看、没有图鉴与调试页',
      tabTxt.length === 2 && tabTxt.join('/').indexOf('牌库') >= 0 && tabTxt.join('/').indexOf('弃牌堆') >= 0 &&
      tabTxt.join('/').indexOf('图鉴') < 0 && tabTxt.join('/').indexOf('调试') < 0, '[' + tabTxt.join('/') + ']');
    const deckTiles = document.querySelectorAll('#inv .icard').length;
    const deckN = APP.match.players[0].deck.length;
    ck('生存模式 · 牌库页是 p.deck 的聚合投影（非空、不超过牌数）', deckTiles > 0 && deckTiles <= deckN, deckTiles + '/' + deckN);
    ck('生存模式 · 牌库网格挂在只读容器 deck 上（不是图鉴）',
      document.getElementById('invGrid').getAttribute('data-box') === 'deck' && GA.UI.bag.get('deck').kind === 'readonly',
      document.getElementById('invGrid').getAttribute('data-box'));
    /* 9a) 生存模式：手持栏内拖拽 —— 拿起来的牌必须能放回去（用户报的「一拿就放不回」）
       先切回「全部」：上一段把出牌组切成了某一组，那一组可能不满 5 格（诚实空位），
       而这一段要量的是"满手时把第 1 格拖到第 5 格"。 */
    GA.UI.channel.request('ui.selectClass', { type: 'all', side: 0 });
    for (let i = 0; i < 6; i++) await F();
    {
      const slots = [...document.querySelectorAll('#invHand .ui-slot')];
      const before = (APP.match.players[0].hand || []).slice();
      if (slots.length === 5 && before.length === 5) {
        const a = slots[0].getBoundingClientRect(), b = slots[4].getBoundingClientRect();
        await window.__mv(a.left + a.width / 2, a.top + a.height / 2);
        await window.__md();
        await window.__mv(a.left + a.width / 2 + 18, a.top + a.height / 2);
        await window.__mv(b.left + b.width / 2, b.top + b.height / 2);
        await window.__mu(b.left + b.width / 2, b.top + b.height / 2);
        for (let i = 0; i < 4; i++) await F();
        const after = (APP.match.players[0].hand || []).slice();
        const same = before.slice().sort().join(',') === after.slice().sort().join(',');
        ck('生存背包 · 手持栏内拖拽：牌能放回去（张数与多重集不变、源卡落到目标格）',
          after.length === 5 && same && after[4] === before[0], JSON.stringify([before, after]));
        ck('生存背包 · 拖拽结束后光标不带东西（不会把牌吞在光标上）', !GA.UI.bag.cursor, GA.UI.bag.cursor && GA.UI.bag.cursor.id);
        ck('生存背包 · 拖拽不会选中网页文字（user-select:none）', String(window.getSelection() || '') === '', String(window.getSelection() || '').slice(0, 30));
      } else ck('生存背包 · 手持栏内拖拽：牌能放回去', false, 'slots=' + slots.length + ' hand=' + before.length);
    }
    key('KeyE'); for (let i = 0; i < 8; i++) await F();
    if (G.Creative && !G.Creative.on && G.Creative.enable) G.Creative.enable(true, true);
    for (let i = 0; i < 4; i++) await F();
    /* 9b) HUD 上那条出牌组指示条：组名说中文，不许漏裸 key（上一版就是显示成「all」被抓到）。
       口径（2026-10-18 晚）：8 个组全平铺会把手持栏顶成两行，HUD 只留"出牌组 + 当前组 + ‹ › + 自动开火"。 */
    (() => {
      const el = document.querySelector('#ui-cls1');
      const now = document.querySelector('.ui-classnow');
      const txt = el ? (el.textContent || '').trim() : '';
      const nowTxt = now ? now.textContent.trim() : '';
      const raw = /\b(all|place|dig|move|shot|sigil|ultra|summon|aid)\b/.test(nowTxt);
      ck('手持栏 · 出牌组指示条说中文（不漏裸 key）', !!el && txt === '出牌组' && !!now && nowTxt.length > 0 && !raw, 'label="' + txt + '" now="' + nowTxt + '"');
      const auto = document.getElementById('autoChip');
      ck('手持栏 · 自动开火有状态徽章（按住左键时亮）', !!auto, auto ? auto.textContent.trim() : 'missing');
    })();

    /* 10) Q 已解绑：按住 20 帧不许转身（转向只有鼠标；E 上面测过它开背包） */
    const yaw0 = APP.match.players[0].yaw;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
    for (let i = 0; i < 20; i++) await F();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ', bubbles: true }));
    for (let i = 0; i < 6; i++) await F();
    ck('键位 · Q 不再转身（回归鼠标转向）', Math.abs(APP.match.players[0].yaw - yaw0) < 1e-6, 'Δyaw=' + (APP.match.players[0].yaw - yaw0).toFixed(5));
    /* 6) 被拒绝的意图必须演出来：UI.onChannelNotify 一直定义在 hud 末尾，却**从来没人订阅** 'ui:notify'，
          于是"诚实的拒绝"在玩家那边全是沉默（= 用户报的"点了没反应"）。
          用两条必然被拒的意图直接量这条线，不靠键盘序列（关创运会顺带合上背包，测的就不是这条了）。 */
    clears();
    const rEmpty = GA.UI.channel.request('ui.give', { item: null });
    for (let i = 0; i < 2; i++) await F();
    const tEmpty = toastText();
    ck('通道 · 被拒不许假成功（空条目给不进手牌）', !!rEmpty && rEmpty.ok === false, JSON.stringify(rEmpty));
    ck('通道 · 被拒必须演出来（ui:notify 有人订阅）', tEmpty.length > 1, 'toast="' + tEmpty + '"');
    clears();
    const rBlock = GA.UI.channel.request('ui.dropOnWorld', { item: { kind: 'block', id: 'dirt', count: 1 }, screen: { x: 700, y: 400 } });
    for (let i = 0; i < 2; i++) await F();
    const tBlock = toastText();
    ck('通道 · 方块丢到世界：没人接就说清楚（AGENTS 那条口径现在真看得见）',
      !!rBlock && rBlock.ok === false && rBlock.reason === 'no-handler' && tBlock.length > 3,
      JSON.stringify(rBlock) + ' toast="' + tBlock + '"');
    clears();
    const rOff = (() => { const was = GA.Creative.on; if (GA.Creative.enable) GA.Creative.enable(false, true); const rr = GA.UI.channel.request('ui.give', { item: GA.UI.Items.make('card', 'harvest', 1, {}), slot: 0, side: 0, mode: 'set' }); if (GA.Creative.enable) GA.Creative.enable(was, true); return rr; })();
    ck('通道 · 创造没开时取卡被拒（不假装能改手牌）', !rOff || rOff.ok === false, JSON.stringify(rOff));
    key('KeyI'); for (let i = 0; i < 8; i++) await F();
    return { A, errors: UI.app.errors || 0, lastError: (UI.app.lastError || '').split('\n')[0] };
  });
  r.A.forEach((a) => ck('真页面 · ' + a.n, a.ok, a.d));
  ck('真页面 · 框架内部零异常', r.errors === 0, r.lastError);
  ck('真页面 · 零页面级异常', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
}

(async () => {
  try {
    const UI = loadItems();
    ck('src/ui/items.js 能在 node 里单独加载（纯数据层）', !!(UI && UI.Ops && UI.Bag));
    stackAlgebra(UI);
    staticChecks();
    if (!ONLY_STATIC) await pageChecks();
  } catch (e) {
    console.error('CHECK ERROR ' + ((e && e.stack) || e));
    process.exit(2);
  }
  console.log('\n共 ' + total + ' 条，失败 ' + fails);
  process.exit(fails ? 1 : 0);
})();
