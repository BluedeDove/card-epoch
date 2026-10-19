#!/usr/bin/env node
/* tools/creative_check.cjs · 创造调试模式 / 背包 / 视角 / 结算面板 的功能回归（不参与游戏运行）

   为什么单独有它：tools/audit.cjs 判的是相机与操作口径，管不到"背包能不能用鼠标点"
   "打开背包有没有把指针锁交还""俯仰能不能推到垂直""结算面板的文案是不是还在 main.js"。
   这些都是用户 2026-10-16 直接提过的东西，必须有一条命令能复跑。

   用法：
     node tools/creative_check.cjs            # 默认 seed 490706
     node tools/creative_check.cjs 88092      # 换种子
   退出码：全过 0；任何一条 FAIL 1；跑不起来 2。

   口径注意（都是踩过的坑）：
     · 飞行必须用真实 keydown（KeyboardSource 把跳跃键映射到内部 __jump，直接写 keys.Space 不生效）；
     · 点卡必须用真鼠标事件（page.mouse.down/up 打在卡面包围盒上），element.click() 会绕过指针锁这条路径，
       正好把"打开背包没交还鼠标"这类问题藏起来；
     · 俯仰走合成 mousemove + 临时置 GW.pointerLocked，headless 拿不到真鼠标；
     · 分层静态检查（creative.js 不许有 DOM/文案）在 Node 侧读源码做，剥注释用简单的逐行判断。
*/
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SEED = +(process.argv.find(a => /^[0-9]+$/.test(a)) || 490706);

function loadPW() {
  const { createRequire } = require('module');
  const c = ['playwright', 'playwright-core',
    '$(npm root -g)/playwright',
    '$(npm root -g)/playwright-core'];
  for (const x of c) { try { return createRequire(__filename)(x); } catch (e) { } }
  return null;
}
const PW = loadPW();
if (!PW) { console.error('找不到 playwright（试 NODE_PATH=$(npm root -g) node tools/creative_check.cjs）'); process.exit(2); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };

/* ---- 分层静态检查：状态层不许碰 DOM、不许写玩家可见文案 ----
   必须逐字符剥注释（字符串内容单独收走），否则注释里写一句反例就会被当成代码越界——
   上一版按"行首是不是 * 或 //"过滤就栽在这里（多行注释的续行不以 * 开头）。 */
function scrubJs(src) {
  const NL = String.fromCharCode(10), BS = String.fromCharCode(92), QT = String.fromCharCode(39), DQ = String.fromCharCode(34);
  let i = 0, st = 'code';
  const code = [], strs = [];
  while (i < src.length) {
    const c = src.charAt(i), d = src.charAt(i + 1), cc = src.charCodeAt(i);
    if (st === 'code') {
      if (c === '/' && d === '/') { st = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { st = 'block'; i += 2; continue; }
      if (c === QT) { st = 'sq'; i++; continue; }
      if (c === DQ) { st = 'dq'; i++; continue; }
      code.push(c); i++; continue;
    }
    if (st === 'line') { if (cc === 10) { st = 'code'; code.push(NL); } i++; continue; }
    if (st === 'block') { if (cc === 10) code.push(NL); if (c === '*' && d === '/') { st = 'code'; i += 2; continue; } i++; continue; }
    const q = (st === 'sq') ? QT : DQ;
    if (c === BS) { strs.push('?'); i += 2; continue; }
    if (c === q) { st = 'code'; strs.push(NL); i++; continue; }
    if (cc === 10) { st = 'code'; code.push(NL); strs.push(NL); i++; continue; }
    strs.push(c); i++; continue;
  }
  return { code: code.join(NL), strings: strs.join(NL) };
}
function firstLineOf(src, idx) { return src.slice(0, idx).split(String.fromCharCode(10)).length; }
function staticLayerChecks(A, ck) {
  const src = fs.readFileSync(path.join(ROOT, 'src/creative.js'), 'utf8');
  const sc = scrubJs(src);
  ['document.', 'innerHTML', 'querySelector', 'createElement', 'addEventListener', 'window.GWAPP', 'G.HUD'].forEach(p => {
    const at = sc.code.indexOf(p);
    ck('creative.js 代码里不含 ' + p, at < 0, at < 0 ? '' : '命中在第 ' + firstLineOf(src, at) + ' 行');
  });
  const cn = sc.strings.split('').filter(ch => ch.charCodeAt(0) >= 0x4e00 && ch.charCodeAt(0) <= 0x9fa5);
  ck('creative.js 字符串里没有中文文案（文案属 H.TEXT）', cn.length === 0, cn.slice(0, 10).join(''));
  const hud = fs.readFileSync(path.join(ROOT, 'src/hud.js'), 'utf8');
  ['H.TEXT', 'H.showInventory', 'H.hideInventory', 'H.uiPanelOpen', 'H.paintGmBadge', 'H.showMatchResult', 'H.art'].forEach(p => {
    ck('hud.js 提供 ' + p, hud.indexOf(p) >= 0);
  });
  const mainSc = scrubJs(fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8'));
  ck('main.js 不直接写 innerHTML', mainSc.code.indexOf('innerHTML') < 0);
  ck('main.js 不把背包/结算按钮名写死', ['重掷手牌', '回满状态', '放训练假人', '清空场面', '你赢了', '你输了'].every(w => mainSc.strings.indexOf(w) < 0));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('<div class="inv" id="inv">'), b = html.indexOf('<div class="menu" id="menu">');
  const skel = a >= 0 && b > a ? html.slice(a, b).replace(/<!--[\s\S]*?-->/g, '') : '';
  ck('index.html 的 #inv 骨架里没有硬编码文案', a >= 0 && b > a && !/[一-龥]/.test(skel), a < 0 ? '找不到 #inv 骨架' : '');
  ck('index.html 引入了 creative.js', html.indexOf('src/creative.js') >= 0);
}

(async () => {
  const srv = http.createServer((q, s) => {
    const rel = decodeURIComponent(q.url.split('?')[0]);
    const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
    fs.readFile(fp, (e, b) => { if (e) { s.writeHead(404).end('nf'); return; }
      s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html?cb=' + Math.random().toString(36).slice(2);
  const browser = await PW.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });

  const A = [];
  const ck = (name, ok, detail) => A.push({ name: name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  staticLayerChecks(A, ck);

  /* ---------- 阶段一：创造模式 + 背包 + 指针 + 俯仰 ---------- */
  const phase1 = await page.evaluate(async (SEED) => {
    const A = []; const ck = (n, ok, d) => A.push({ name: n, ok: !!ok, detail: d === undefined ? '' : String(d) });
    const st = window.GWAPP, G = window.GW, CR = G.Creative, HUD = G.HUD;
    const F = () => new Promise(r => requestAnimationFrame(r));
    const key = c => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
    const up = c => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
    window.__GW_START({ mode: 'train', seed: SEED, deck: 'starter' });
    for (let i = 0; i < 25; i++) await F();
    const p = st.match.players[0];

    ck('默认关：普通局不挂创造标记', p.creative === null);
    key('KeyG'); for (let i = 0; i < 6; i++) await F();
    ck('G 开启创造（只给 P1）', CR.on === true && p.creative === CR.opt && st.match.players[1].creative === null);
    for (let i = 0; i < 30; i++) await F();
    ck('无限魔力：蓝条补满', p.mana === p.manaCap, p.mana + '/' + p.manaCap);

    p.hand[0] = 'meteors'; HUD.sel[0] = 0; HUD.invalidate();
    const played = st.match.playCard(p, 0);
    ck('卡牌不消耗（打出仍在手上）', played === true && p.hand[0] === 'meteors', p.hand.join(','));
    ck('无冷却', (p.cooldowns.meteors || 0) === 0, p.cooldowns.meteors);
    const hp0 = p.hp; G.Rules.damage(p, 999, 'fire', st.match.ctx);
    ck('无敌：伤害不落地', p.hp === hp0, 'hp=' + p.hp);
    G.Rules.addStatus(p, 'frozen', 3); G.Rules.addStatus(p, 'haste', 3, 0.5);
    ck('免控但增益照常', !p.st.frozen && !!p.st.haste, JSON.stringify(Object.keys(p.st)));

    key('KeyI'); for (let i = 0; i < 8; i++) await F();
    const root = document.getElementById('inv');
    ck('I 打开背包（骨架在 index.html）', !!root && root.classList.contains('on') && HUD.uiPanelOpen() === true);
    ck('列出全部卡', root && root.querySelectorAll('.icard').length === G.CARDS.length,
      root ? root.querySelectorAll('.icard').length + '/' + G.CARDS.length : 'no #inv');
    ck('文案由 UI 层注入', !!root && root.querySelector('[data-t="options"]').textContent.length > 0 && root.querySelector('#invQ').placeholder.length > 0,
      root ? root.querySelector('[data-t="options"]').textContent : '');
    const tickA = st.match.tick; for (let i = 0; i < 20; i++) await F();
    ck('打开背包时逻辑暂停', st.match.tick === tickA, tickA + '→' + st.match.tick);
    ck('打开背包时指针锁已交还', document.pointerLockElement === null, 'pointerLockElement=' + document.pointerLockElement);
    const q = root.querySelector('#invQ'); q.value = '岩浆'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await F(); await F();
    ck('搜索能过滤', root.querySelectorAll('.icard').length === 1, root.querySelectorAll('.icard').length);
    q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); await F();
    HUD.sel[0] = 2; p.hand[2] = 'strike';
    let tile = null; root.querySelectorAll('.icard').forEach(d => { if (!tile && (d.title || '').indexOf('lava') === 0) tile = d; });
    const bb = tile ? tile.getBoundingClientRect() : null;
    if (bb) ck('背包滚动区不吞点击（卡面在视口内）', bb.top >= 0 && bb.bottom <= window.innerHeight, JSON.stringify([Math.round(bb.top), Math.round(bb.bottom)]));
    return { A: A, box: bb ? { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 } : null };
  }, SEED);
  phase1.A.forEach(a => A.push(a));
  if (phase1.box) {
    await page.mouse.move(phase1.box.x, phase1.box.y);
    await page.mouse.down(); await page.mouse.up();
    const hand = await page.evaluate(() => ({ hand: window.GWAPP.match.players[0].hand.slice(), sel: window.GW.HUD.sel[0] }));
    ck('真鼠标点卡 → 放进选中格（指针自由可用）', hand.hand[2] === 'lava', hand.hand.join(','));
  } else ck('找到 lava 卡面可点', false, 'tile 不可见');

  /* ---------- 阶段二：飞行 / 场面动作 / 俯仰 ---------- */
  const phase2 = await page.evaluate(async () => {
    const A = []; const ck = (n, ok, d) => A.push({ name: n, ok: !!ok, detail: d === undefined ? '' : String(d) });
    const st = window.GWAPP, G = window.GW, CR = G.Creative, HUD = G.HUD;
    const F = () => new Promise(r => requestAnimationFrame(r));
    const key = c => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
    const up = c => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
    const p = st.match.players[0], cam = st.cams[0];

    key('KeyI'); for (let i = 0; i < 15; i++) await F();
    ck('再按 I 关闭背包并恢复推进', !HUD.uiPanelOpen() && !document.getElementById('inv').classList.contains('on'));
    ck('关背包后 HUD 恢复可见', document.getElementById('hud').style.opacity === '1', document.getElementById('hud').style.opacity);
    ck('关背包后焦点离开搜索框', document.activeElement !== document.getElementById('invQ'), document.activeElement && document.activeElement.id);

    CR.spawnDummy(); await F();
    const d = st.match.summons[st.match.summons.length - 1];
    ck('训练假人放得出来', !!d && d.dummy === true, d ? d.name : 'none');
    const hpd = d && d.hp; if (d) G.Rules.damage(d, 25, 'fire', st.match.ctx);
    ck('假人正常吃伤害', !!d && d.hp === hpd - 25, d ? hpd + '→' + d.hp : '');
    CR.clearField(); await F();
    ck('清场清空随从/法阵/抛射物', st.match.summons.length === 0 && st.match.sigils.length === 0 && st.match.projectiles.length === 0);

    key('KeyX'); for (let i = 0; i < 3; i++) await F();
    const y0 = p.pos.y; key('Space'); for (let i = 0; i < 30; i++) await F(); const yTop = p.pos.y; up('Space');
    for (let i = 0; i < 30; i++) await F(); const yS = p.pos.y;
    for (let i = 0; i < 12; i++) await F(); const yH = p.pos.y;
    ck('飞行：空格能升', yTop > y0 + 1.0, y0.toFixed(2) + '→' + yTop.toFixed(2));
    ck('飞行：松手悬停不飘', Math.abs(yH - yS) < 0.06, 'Δy=' + (yH - yS).toFixed(3));
    key('ShiftLeft'); for (let i = 0; i < 20; i++) await F(); const yD = p.pos.y; up('ShiftLeft');
    ck('飞行：左Shift 能降', yD < yH - 0.8, yH.toFixed(2) + '→' + yD.toFixed(2));
    key('KeyX'); await F();

    cam.setMode('shoulder');
    st.sources = [new G.Net.KeyboardSource({ fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ShiftLeft', lookL: 'KeyQ', lookR: 'KeyE', lookU: 'KeyF', lookD: 'KeyV', cast: ['Digit1'] }, { mouseLook: true })];
    const plWas = G.pointerLocked; G.pointerLocked = true;
    p.pitch = 0;
    for (let i = 0; i < 60; i++) { window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -80, bubbles: true })); await F(); }
    const upMax = p.pitch;
    for (let i = 0; i < 140; i++) { window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 80, bubbles: true })); await F(); }
    const dnMax = p.pitch;
    const LIM = G.LOOK_LIMIT || { up: 1.5533, down: -1.5533 };
    const yOff = Math.abs(cam.pos.y - (p.pos.y + cam.eyeH));
    const finite = [cam.pos.x, cam.pos.y, cam.pos.z, cam.dir.x, cam.dir.y, cam.dir.z].every(Number.isFinite);
    ck('抬头能到接近垂直（≥80°）', upMax >= 1.4, (upMax * 180 / Math.PI).toFixed(1) + '°');
    ck('低头能到接近垂直（≥80°）', dnMax <= -1.4, (dnMax * 180 / Math.PI).toFixed(1) + '°');
    ck('俯仰不超过 G.LOOK_LIMIT', dnMax >= LIM.down - 1e-6 && upMax <= LIM.up + 1e-6, dnMax.toFixed(4) + '/' + upMax.toFixed(4));
    ck('垂直向下时机位不飞天（|cam.y-眼y| ≤ 2.4）', yOff <= 2.4, 'yOff=' + yOff.toFixed(2) + ' radius=' + cam.curRadius.toFixed(2));
    ck('垂直向下时相机不出 NaN', finite);
    G.pointerLocked = plWas; p.pitch = 0;
    return A;
  });
  phase2.forEach(a => A.push(a));

  /* ---------- 阶段三：结算面板归 hud 层 ---------- */
  const phase3 = await page.evaluate(async () => {
    const A = []; const ck = (n, ok, d) => A.push({ name: n, ok: !!ok, detail: d === undefined ? '' : String(d) });
    const st = window.GWAPP, G = window.GW; const F = () => new Promise(r => requestAnimationFrame(r));
    window.__GW_START({ mode: 'train', seed: st.seed || 490706, deck: 'starter' }); for (let i = 0; i < 20; i++) await F();
    st.match.finish(0);
    for (let i = 0; i < 12; i++) await F();
    await new Promise(r => setTimeout(r, 420));
    const kv = document.getElementById('resKv'), ti = document.getElementById('resTitle'), res = document.getElementById('result');
    ck('结算面板可见', res.classList.contains('hidden') === false);
    ck('标题文案来自 H.TEXT.result', ti.textContent === G.HUD.TEXT.result.win, ti.textContent);
    ck('面板字段与文案表一致', kv.querySelectorAll('span').length === G.HUD.TEXT.result.rows.length, kv.querySelectorAll('span').length + '/' + G.HUD.TEXT.result.rows.length);
    ck('值渲染出秒与格/卡', kv.textContent.indexOf('秒') >= 0 && kv.textContent.indexOf('格/卡') >= 0, kv.textContent.slice(0, 50));
    document.getElementById('btnAgain').click(); for (let i = 0; i < 20; i++) await F();
    ck('从结算面板再开一局能跑', st.running === true && st.overPause === false && st.match.tick > 5, 'tick=' + st.match.tick);
    return A;
  });
  phase3.forEach(a => A.push(a));

  let fail = 0;
  A.forEach(a => { if (!a.ok) fail++; console.log((a.ok ? 'PASS ' : 'FAIL ') + a.name + (a.detail ? '  [' + a.detail + ']' : '')); });
  console.log('\n共 ' + A.length + ' 条，失败 ' + fail + (errs.length ? '；pageErrors=' + JSON.stringify(errs.slice(0, 4)) : '；无页面异常'));
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CHECK ERROR ' + (e && e.stack || e)); process.exit(2); });
