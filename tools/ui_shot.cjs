#!/usr/bin/env node
/* tools/ui_shot.cjs · UI 取景器 + 样式门禁（2026-10-17 重做 UI 时立）

   为什么需要它：界面是"好不好看 / 看不看得清"的活儿，tools/audit.cjs 那 15 项管不到，
   ui_check 管的是框架语义（堆叠代数 / 分层 / 意图词汇表）也不是像素。以前每次改完只能口头说
   "美化了"，既没有可比对的图，也没有可比对的数字。这里补齐两件事：

     ① --shots 目录：菜单 / 战斗 HUD / 手持栏 / 背包四页 / 悬停提示 / 三选一 / 结算 / 分屏
        逐个落图（同 seed 同视口），改前改后各存一份，人眼可对比；
     ② --gate：在**真页面的计算样式**上量八条，任何一条红就退出码 1：
        A 字号只准令牌表那几档（12/14/16/22/32）——"9 种字号"就是丑的可机检定义
        B 对比度：正文 ≥4.5:1、大字（≥22px 或 ≥18.66px 粗体）≥3:1；底取"最近的实底祖先"，
          压在透明层上的（准星那行、键位带…）按三种世界底色各量一遍取最坏值：亮天空 / 亮草皮 / 暗岩层
        C 边框：四边只准 0 或 2px；1px 只准当单边分隔线
        D 圆角必须为 0（像素风里圆角 = 抗锯齿插值，与像素网格打架）
        E 阴影 blur 必须为 0（唯一例外：选中格与准星命中态的那一层辉光）
        F 颜色必须来自令牌表（src/ui/theme.css 的 :root ∪ src/cards.js 的 G.ELEMENTS ∪ world.js 的 DEFS 色）
        G HUD 常驻层不许进屏幕中央 40%（顶栏 / 血条 / 日志 / 手持栏 / 键位带）
        H 贴边元素与屏幕外沿的安全边距（≥3% 该轴，且不小于 20px）
        外加一条一致性：:root 里的 --el-* 必须与 G.ELEMENTS[*].color 同值（元素色只有一个真源）

   用法：
     node tools/ui_shot.cjs --shots /tmp/ui-before
     node tools/ui_shot.cjs --gate --shots /tmp/ui-after
     node tools/ui_shot.cjs --gate --audit-only --viewport 1280x720 --dpr 1.5
   退出码：门禁全过 0；任何一条违规 1；跑不起来 2。
*/
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = (name) => argv.indexOf('--' + name) >= 0;
const OUT = argOf('shots', null);
const SEED = argOf('seed', '490706');
const VIEWPORT = argOf('viewport', '1440x860');
const DPR = Number(argOf('dpr', '1'));
const STATES = (argOf('states', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const AUDIT_ONLY = has('audit-only');
const GATE = has('gate');
const want = (s) => !STATES.length || STATES.some((x) => s.indexOf(x) === 0);

/* ---------- 令牌表：样式里允许出现的颜色 ---------- */
function hexToRgb(h) {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 8) s = s.slice(0, 6);
  if (s.length !== 6) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
const key = (rgb) => 'rgb(' + rgb.join(', ') + ')';
function tokens() {
  const set = new Set();
  const html = read('index.html');
  const cssPath = path.join(ROOT, 'src/ui/theme.css');
  const css = require('fs').existsSync(cssPath) ? require('fs').readFileSync(cssPath, 'utf8') : html;
  const rootM = /:root\s*\{([\s\S]*?)\}/.exec(css);
  const src = rootM ? rootM[1] : css;
  (src.match(/#[0-9a-fA-F]{3,8}/g) || []).forEach((hx) => { const c = hexToRgb(hx); if (c) set.add(key(c)); });
  const rgbRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/g;
  let m;
  while ((m = rgbRe.exec(src))) set.add(key([+m[1], +m[2], +m[3]]));
  /* 元素色 / 方块色的真源在数据层：G.ELEMENTS（cards.js）与 BLOCK_DEFS（world.js） */
  const elBlock = /G\.ELEMENTS\s*=\s*\{([\s\S]*?)\n  \};/.exec(read('src/cards.js'));
  const elHexes = elBlock ? (elBlock[1].match(/#[0-9a-fA-F]{6}/g) || []) : [];
  elHexes.forEach((hx) => { const c = hexToRgb(hx); if (c) set.add(key(c)); });
  const defs = read('src/world.js');
  (defs.match(/color:\s*\s?'#[0-9a-fA-F]{6}'/g) || []).forEach((s) => {
    const hx = /'#[0-9a-fA-F]{6}'/.exec(s)[0].replace(/'/g, '');
    const c = hexToRgb(hx); if (c) set.add(key(c));
  });
  /* :root 的 --el-* 别名必须与 G.ELEMENTS 同值（元素色只有一个真源） */
  const drift = [];
  const elMap = {};
  if (elBlock) {
    const re = /(\w+):\s*\{[^}]*?color:\s*'(#[0-9a-fA-F]{6})'/g;
    let mm;
    while ((mm = re.exec(elBlock[1]))) elMap[mm[1]] = mm[2];
  }
  Object.keys(elMap).forEach((k) => {
    const alias = new RegExp('--el-' + k + ':\s*(#[0-9a-fA-F]{6})').exec(css);
    if (!alias) drift.push('--el-' + k + ' 缺失（真源 ' + elMap[k] + '）');
    else if (alias[1].toLowerCase() !== elMap[k].toLowerCase()) drift.push('--el-' + k + ' = ' + alias[1] + ' 与 G.ELEMENTS.' + k + '.color ' + elMap[k] + ' 不一致');
  });
  const scale = ((/--fs-1:([^;]+);[^@]*?--fs-5:([^;]+);/.exec(src) || []).slice(1));
  const sizes = [12, 14, 16, 22, 32];
  const declared = (css.match(/--fs-\d:(\d+)px/g) || []).map((s) => +/(\d+)px/.exec(s)[1]);
  return { set, drift, sizes: declared.length ? declared : sizes };
}
/* WCAG 相对亮度与对比 */
const lum = (rgb) => {
  const a = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const ratio = (f, b) => { const l1 = lum(f), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const parseColor = (s) => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(s || '');
  if (!m) return null;
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
};
const over = (fg, bg) => fg.rgb.map((v, i) => Math.round(v * fg.a + bg.rgb[i] * (1 - fg.a)));

function loadPW() {
  const { createRequire } = require('module');
  const c = ['playwright', 'playwright-core',
    '$(npm root -g)/playwright',
    '$(npm root -g)/playwright-core'];
  for (const x of c) { try { return createRequire(__filename)(x); } catch (e) { } }
  return null;
}

(async () => {
  const PW = loadPW();
  if (!PW) { console.error('找不到 playwright'); process.exit(2); }
  const TOK = tokens();
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
  const srv = http.createServer((q, s) => {
    const rel = decodeURIComponent(q.url.split('?')[0]);
    const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
    fs.readFile(fp, (e, b) => {
      if (e) { s.writeHead(404).end('nf'); return; }
      s.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html?cb=' + Math.random().toString(36).slice(2);
  const [vw, vh] = VIEWPORT.split('x').map(Number);
  const browser = await PW.chromium.launch({});
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.GWAPP && window.__GW_START, null, { timeout: 60000 });
  if (OUT && !AUDIT_ONLY) fs.mkdirSync(OUT, { recursive: true });

  const shot = async (name, sel) => {
    if (!OUT || AUDIT_ONLY) return;
    const file = path.join(OUT, name + '.png');
    if (sel) {
      const el = await page.$(sel);
      if (el) { await el.screenshot({ path: file }); console.log('SHOT ' + name + ' <- ' + sel); return; }
    }
    await page.screenshot({ path: file });
    console.log('SHOT ' + name + (sel ? '（选择器没命中，落成整页）' : ''));
  };
  const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
  const keydown = (code) => page.evaluate((c) => { window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true })); }, code);
  const pickTab = async (tab) => {
    await page.evaluate((t) => {
      const ui = window.GW.UI;
      ui.app.model.filters.tab = t;
      ui.channel.bus.emit('ui:filter', { tab: t });
    }, tab);
    await frames(8); await page.waitForTimeout(120);
  };

  if (want('menu')) {
    await page.evaluate(() => window.GW.HUD.showMenu());
    await page.waitForTimeout(150);
    await shot('01-menu', '.ui-menu-box');
  }
  /* ---------- 选关（docs/LEVELS.md §5「选关界面能看」）：走真实点击路径 ----------
     不许用 __dbg / evaluate 摆状态：点菜单的「开始游戏」→ 等 #level 真可见 → 落图；
     再按 Esc 回标题并确认 #level 收起 —— 13-level-back 就是"返回可用"的证据。 */
  if (want('level')) {
    const realClick = async (sel) => {
      const el = await page.$(sel);
      if (!el) { console.log('CLICK ' + sel + ' ← 找不到元素'); return false; }
      const b = await el.boundingBox();
      if (!b) { console.log('CLICK ' + sel + ' ← 没有尺寸（被盖住或没画）'); return false; }
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      console.log('CLICK ' + sel + ' @' + Math.round(b.x + b.width / 2) + ',' + Math.round(b.y + b.height / 2));
      return true;
    };
    await realClick('#btnStart');
    await page.waitForFunction(() => {
      const el = document.getElementById('level');
      return !!el && !el.classList.contains('hidden') && el.getBoundingClientRect().width > 0;
    }, null, { timeout: 8000 }).catch(() => console.log('WARN #level 没在 8s 内可见'));
    await frames(10); await page.waitForTimeout(180);
    await shot('12-level', '.ui-level-box');
    /* ---------- 14-level-net（docs/NET.md §9.5 / 任务书 N3 第 7 条） ----------
       还是真鼠标：点模式栏的「联网 PVP」→ 等 .ui-level-net 真画出来（when 闸加 ui-hide，
       量的是矩形，不看"容器里有没有东西"）→ 落图 → 再点「创建房主」把选中态也量出来。
       落图后自己看：三个字段不许重叠、说明文字不许溢出，窄的那一档（--viewport 1280x720 --dpr 1.5）不许挤爆。 */
    await realClick('#level [data-field=mode][data-key=net]');
    await page.waitForFunction(() => {
      const el = document.querySelector('#level .ui-level-net');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
    }, null, { timeout: 6000 }).catch(() => console.log('WARN .ui-level-net 没在 6s 内画出来'));
    await frames(10); await page.waitForTimeout(180);
    await shot('14-level-net', '.ui-level-box');
    await realClick('#level [data-field=netRole][data-key=host]');
    await frames(10); await page.waitForTimeout(120);
    const netSel = await page.evaluate(() => {
      const G = window.GW, L = G.UI.app.model.level || {};
      const btn = (k) => document.querySelector('#level [data-field=netRole][data-key=' + k + ']');
      const h = document.getElementById('levelNetUrl'), rm = document.getElementById('levelNetRoom');
      return { mode: L.mode, role: L.netRole, url: L.netUrl, room: L.netRoom,
        hostOn: !!(btn('host') && btn('host').classList.contains('on')),
        guestOn: !!(btn('guest') && btn('guest').classList.contains('on')),
        domUrl: h ? h.value : null, domRoom: rm ? rm.value : null };
    });
    console.log('NET 选关 mode=' + netSel.mode + ' 服务器=' + netSel.url + '（DOM ' + netSel.domUrl + '） 房间码=' + netSel.room
      + ' 角色=' + netSel.role + ' 创建房主.on=' + netSel.hostOn + ' 加入对局.on=' + netSel.guestOn);
    if (netSel.mode !== 'net' || !netSel.hostOn || netSel.guestOn || netSel.domUrl !== netSel.url)
      console.log('WARN 联机入口没走通（选 net 后字段 / 角色选中态不符，见上一行）');
    await keydown('Escape');                       // 选关的 Esc = 返回标题
    await frames(10); await page.waitForTimeout(180);
    const back = await page.evaluate(() => ({
      menu: !!document.getElementById('menu') && !document.getElementById('menu').classList.contains('hidden'),
      level: !!document.getElementById('level').classList.contains('hidden')
    }));
    console.log('BACK menu可见=' + back.menu + ' / #level 已收起=' + back.level);
    await shot('13-level-back', '.ui-menu-box');
    if (!back.menu || !back.level) console.log('WARN 返回标题没走通（Esc 或面板显隐有问题）');
  }
  /* ---------- 15 / 16：战前选牌（docs/ROUTER.md §2；任务书 L1 第 8 条）----------
     这一页的真路径要一台服务器（选关「联网 PVP」→ joined → loadout），取景器没有服务器可连，
     所以走 main.js 里那个**只给截图与回归用**的 __GW_LOADOUT_PREVIEW(n)：它只改视图状态的 picks
     并点名 loadout 路由，权威层与 net 一个字节都不动。
     两张图的分工与五步真鼠标量法（判的是 model.loadout.picks + 真实 DOM，不看「容器里有没有东西」）：
       15-loadout         填好 12 张的样子（计数、两颗按钮都要在框内）；
       A 满了再加 → 'deck-full' 拒绝，且状态行必须说人话（这一页盖在 #hud 之上，通道的 toast 玩家看不见）；
       B 真点 × 去掉一张 → 11 张，就绪判据必须跟着变灰；
       C 真点同一张卡 → 该张 0→1、总数 11→12、尾列 ×1、牌库长出这一行 —— 这就是「点击真的加了一张」；
       D 再去掉一张后把某张点到 2 份 → 证明「同一张最多 2 份」是允许而不是死限；
       E 第三次点同一张 → 停在 2 份且状态行说「同一张卡最多带 2 份」，两条上限各自演出来；
       16-loadout-picked  收在 12 张、其中一张 ×2 的样子（与 15 明显不同，看得见点击的痕迹）。 */
  if (want('loadout')) {
    const prev = await page.evaluate(() => (typeof window.__GW_LOADOUT_PREVIEW === 'function' ? window.__GW_LOADOUT_PREVIEW(12) : null));
    if (!prev) console.log('WARN __GW_LOADOUT_PREVIEW 不在位（面板没做？15/16 这两张落不了）');
    else {
      await page.waitForFunction(() => {
        const el = document.querySelector('#loadout .ui-loadout-box');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
      }, null, { timeout: 8000 }).catch(() => console.log('WARN .ui-loadout-box 没在 8s 内可见'));
      await frames(12); await page.waitForTimeout(220);
      const txt = (id) => { const e = document.getElementById(id); return e ? String(e.textContent || '').trim() : ''; };
      const snap = (id) => page.evaluate((cid) => {
        const m = window.GW.UI.app.model;
        const row = document.querySelector('#loadoutPool .ui-list-item[data-value="' + cid + '"]');
        const tail = row ? (function () { const t = row.querySelector('.ui-list-tail'); return t ? String(t.textContent || '').trim() : ''; })() : '(无此行)';
        const st = document.getElementById('loadoutStatus');
        return {
          n: ((m.loadout.picks || {})[cid] | 0), total: m.loadoutCount, terrain: m.loadoutTerrain,
          eligible: !!m.loadoutEligible, readyOff: !!(document.getElementById('btnLoadoutReady') || {}).disabled,
          tail: tail, rows: document.querySelectorAll('#loadout .ui-loadout-pick').length,
          hasRow: !!document.querySelector('#loadout .ui-loadout-pick[data-id="' + cid + '"]'),
          status: st ? String(st.textContent || '').trim() : '',
          count: txt2('loadoutCount'), miss: txt2('loadoutMissing')
        };
        function txt2(k) { const e = document.getElementById(k); return e ? String(e.textContent || '').trim() : ''; }
      }, id);
      const clickPool = async (id) => {
        const pt = await page.evaluate((cid) => {
          const r = document.querySelector('#loadoutPool .ui-list-item[data-value="' + cid + '"]');
          if (!r) return null;
          const b = r.getBoundingClientRect();
          return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + Math.min(b.height / 2, 18)) };
        }, id);
        if (!pt) { console.log('CLICK 卡池 ' + id + ' ← 找不到那一行'); return false; }
        await page.mouse.click(pt.x, pt.y);
        await frames(10); await page.waitForTimeout(150);
        return true;
      };
      const clickX = async (id) => {
        const pt = await page.evaluate((cid) => {
          const b = document.querySelector('#loadout .ui-loadout-pick[data-id="' + cid + '"] button');
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, id);
        if (!pt) { console.log('CLICK × ' + id + ' ← 找不到牌库行尾那颗按钮'); return false; }
        await page.mouse.click(pt.x, pt.y);
        await frames(10); await page.waitForTimeout(150);
        return true;
      };
      const head = await snap('dig');
      const poolRows = await page.evaluate(() => document.querySelectorAll('#loadoutPool .ui-list-item').length);
      console.log('LOADOUT 预览→ 卡池 ' + poolRows + ' 行 / 牌库 ' + head.rows + ' 行 · 总 ' + head.total + ' 张 · 地形 ' + head.terrain +
        ' · 可就绪=' + head.eligible + ' · 就绪 disabled=' + head.readyOff);
      console.log('LOADOUT 计数行「' + head.count + '」 状态行「' + head.status + '」');
      if (!poolRows || head.rows !== 12 || head.total !== 12 || !head.eligible || head.readyOff)
        console.log('WARN 15 这张图不对（卡池 / 牌库 / 12 张 / 可就绪 有一条不成立）');
      await shot('15-loadout', '.ui-loadout-box');

      /* A 整副已经 12 张，再点一次：必须被拒且状态行说话 */
      await clickPool('dig');
      const a = await snap('dig');
      console.log('A 满了再点 dig → 该张 ' + a.n + ' / 总 ' + a.total + ' · 状态行「' + a.status + '」');
      if (a.n !== 1 || a.total !== 12 || a.status.indexOf('12 张') < 0)
        console.log('WARN 整副 12 张的上限没判住，或被拒后状态行没说人话');

      /* B 真点 × 去掉 dig */
      await clickX('dig');
      const b = await snap('dig');
      console.log('B 点 × 去掉 dig → 该张 ' + b.n + ' / 总 ' + b.total + ' · 可就绪=' + b.eligible + ' · 就绪 disabled=' + b.readyOff +
        ' · 缺什么「' + b.miss + '」');
      /* 「缺什么」那一行必须非空（就绪灰着的时候说不出缺什么 = 玩家只能自己猜）；
         它写的是「还差 N 张」，不是总数，所以这里只判有没有内容 + 有没有提到张。 */
      if (b.n !== 0 || b.total !== 11 || b.eligible || !b.readyOff || b.miss.length < 4 || b.miss.indexOf('张') < 0)
        console.log('WARN 去掉一张后计数 / 就绪判据 / 「缺什么」那一行没有跟着变');

      /* C 真点卡池里的 dig：这就是「点击真的加了一张」 */
      await clickPool('dig');
      const c = await snap('dig');
      console.log('C 真点卡池 dig → 该张 ' + b.n + '→' + c.n + '（尾列「' + c.tail + '」）/ 总 ' + b.total + '→' + c.total +
        ' · 可就绪=' + c.eligible + ' · 牌库 ' + c.rows + ' 行 · 牌库里有这一行=' + c.hasRow);
      if (c.n !== 1 || c.total !== 12 || c.tail !== '×1' || !c.hasRow || !c.eligible || c.readyOff)
        console.log('WARN 点击没真的加上那张（判：该张 1 / 总 12 / 尾列 ×1 / 牌库有行 / 可就绪）');

      /* D 去掉**另一张**腾出一格，再把 dig 点到第 2 份（同一张允许带 2 份，不是只能 1 份） */
      const other = await page.evaluate(() => {
        const pk = ((window.GW.UI.app.model.loadout || {}).picks) || {};
        for (const k in pk) if (k !== 'dig' && (pk[k] | 0) > 0) return k;
        return null;
      });
      if (!other) console.log('WARN 牌库里找不到第二张卡（D / E 两步测不了）');
      else {
        await clickX(other);
        const d0 = await snap('dig');
        await clickPool('dig');
        const d = await snap('dig');
        console.log('D 去掉 ' + other + ' 腾一格（总 ' + d0.total + ' 张）→ 再点 dig → 该张 ' + d0.n + '→' + d.n +
          '（尾列「' + d.tail + '」）/ 总 ' + d.total + ' 张');
        if (d.n !== 2 || d.tail !== '×2' || d.total !== 12) console.log('WARN 同一张点到 2 份这条路不对');

        /* E 第三次点同一张：停在 2 份 + 状态行说「同一张卡最多带 2 份」 */
        await clickPool('dig');
        const e2 = await snap('dig');
        console.log('E 第三次点 dig → 仍是 ' + e2.n + ' 张 / 总 ' + e2.total + ' 张 · 状态行「' + e2.status + '」');
        if (e2.n !== 2 || e2.status.indexOf('2 份') < 0)
          console.log('WARN 单卡 2 份的上限没判住，或被拒后状态行没说人话');
      }
      /* F 真点「就绪」：这一页的主行动。就绪之后状态行必须换成「我已就绪，等待对手」——
         联机没接上之前不许有任何东西假装开局（main.js 的 loadoutReady 只说等对手）。 */
      const rb = await page.evaluate(() => {
        const b = document.getElementById('btnLoadoutReady');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), off: !!b.disabled };
      });
      if (!rb) console.log('WARN 找不到 #btnLoadoutReady（就绪按钮没做出来？）');
      else if (rb.off) console.log('WARN 满 12 张时就绪还是 disabled（判据不对）');
      else {
        await page.mouse.click(rb.x, rb.y);
        await frames(12); await page.waitForTimeout(200);
        const f = await page.evaluate(() => {
          const m = window.GW.UI.app.model;
          const e = document.getElementById('loadoutStatus');
          const t = document.getElementById('toast');
          return { declared: !!(m.loadout && m.loadout.ready), shown: !!m.loadoutReady, status: e ? String(e.textContent || '').trim() : '',
            toast: (t && t.classList.contains('on')) ? String(t.textContent || '').trim() : '',
            match: !!(window.GWAPP && window.GWAPP.running) };
        });
        console.log('F 真点就绪 → 已声明就绪=' + f.declared + ' · 面板显示就绪=' + f.shown + ' · 状态行「' + f.status + '」');
        if (f.toast) console.log('F toast「' + f.toast + '」');
        if (!f.declared || !f.shown || f.status.indexOf('我已就绪') < 0)
          console.log('WARN 就绪这条路没走通（判：状态里 declared 与 shown 都真 + 状态行出现「我已就绪」）');
        if (f.match) console.log('WARN 点了就绪就擅自开局了 —— net 未接时不许假装开局');
      }
      await shot('16-loadout-picked', '.ui-loadout-box');

      /* 收页：回菜单并确认 #loadout 真收起（别把这一页带进后面的对局截图与 --gate） */
      await page.evaluate(() => { window.GW.HUD.hideLoadout(); if (window.GW.Router) window.GW.Router.go('menu'); });
      await frames(10);
      const closed = await page.evaluate(() => ({
        hidden: !!document.getElementById('loadout').classList.contains('hidden'),
        open: !!(window.GW.UI.panels.loadout || {}).open
      }));
      console.log('LOADOUT 收页 #loadout 已 hidden=' + closed.hidden + ' · 面板 open=' + closed.open);
      if (!closed.hidden || closed.open) console.log('WARN 返回后 #loadout 没收干净（会压在后面的画面上）');
    }
  }

  await page.evaluate((seed) => window.__GW_START({ mode: 'train', seed: String(seed), deck: 'starter' }), SEED);
  await frames(30);
  if (want('hud')) { await page.waitForTimeout(300); await shot('02-hud'); }
  if (want('hotbar')) await shot('03-hotbar', '.ui-hotbar');

  const needInv = want('inv-cards') || want('inv-blocks') || want('inv-tray') || want('inv-debug') || want('tooltip');
  if (needInv) { await keydown('KeyG'); await frames(6); await keydown('KeyI'); await frames(12); await page.waitForTimeout(200); }
  if (want('inv-cards')) { await pickTab('cards'); await shot('04-inv-cards', '.ui-bag-box'); }
  if (want('inv-blocks')) { await pickTab('blocks'); await shot('05-inv-blocks', '.ui-bag-box'); }
  if (want('inv-tray')) {
    await pickTab('tray');
    await page.evaluate(() => {
      const ui = window.GW.UI, cat = ui.bag.get('catalog');
      for (let i = 0; i < 4; i++) { const it = cat.get(i); if (it) ui.channel.bus.emit('ui:tray-add', { item: it }); }
    });
    await frames(6);
    await shot('06-inv-tray', '.ui-bag-box');
  }
  if (want('inv-debug')) { await pickTab('debug'); await shot('07-inv-debug', '.ui-bag-box'); }
  if (want('tooltip')) {
    await pickTab('cards');
    const box = await page.evaluate(() => {
      const t = document.querySelectorAll('#inv .icard')[4];
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (box) { await page.mouse.move(box.x, box.y); await page.waitForTimeout(900); }
    await shot('08-tooltip');
  }
  await page.evaluate(() => window.GW.HUD.hideInventory());
  await frames(8);
  if (want('choice')) {
    await page.evaluate(() => {
      const G = window.GW;
      G.HUD.openChoice({ title: '群系三选一', hint: '首次占矿触发的选择（取景用）', items: G.CARDS.slice(0, 3).map((c) => ({ id: c.id, card: c })) });
    });
    await page.waitForTimeout(240);
    await shot('09-choice', '.ui-choice-box');
    await page.evaluate(() => window.GW.HUD.closeChoice());
  }
  if (want('result')) {
    await page.evaluate(() => {
      const G = window.GW;
      G.HUD.showMatchResult({ over: { name: 'P1 红方', winner: 0, time: 143.2, ticks: 2864 }, players: [{ kills: 4, lives: 2 }, { kills: 1, lives: 0 }], seed: 490706 }, 'split');
    });
    await page.waitForTimeout(520);
    await shot('10-result', '.ui-result-box');
    await page.evaluate(() => window.GW.HUD.hideResult());
    await frames(6);
  }
  if (want('split')) { await keydown('KeyT'); await frames(24); await page.waitForTimeout(320); await shot('11-split'); }

  /* ---------- 真页面计算样式体检 ---------- */
  await page.evaluate(async (seed) => {
    if (!window.GWAPP.running) window.__GW_START({ mode: 'train', seed: String(seed), deck: 'starter' });
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
  }, SEED);
  await page.waitForTimeout(240);
  const data = await page.evaluate(() => {
    const px = (v) => (v && v.indexOf('px') > 0 ? parseFloat(v) : 0);
    const all = Array.from(document.querySelectorAll('[class^="ui-"],[class*=" ui-"],#ui-topbar,#log,#v1,#v2,#hand1,#hand2,#toast,#keybar,#help,#lockHint,#aiminfo'));
    const chrome = [], text = [], center = [];
    const CENTRAL = { x0: window.innerWidth * 0.30, x1: window.innerWidth * 0.70, y0: window.innerHeight * 0.30, y1: window.innerHeight * 0.70 };
    const PERSISTENT = ['.ui-topbar', '.ui-vitals', '.ui-log', '.ui-hotbar', '.ui-keybar'];
    all.forEach((el) => {
      const cs = getComputedStyle(el);
      const all = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean);
      /* 名字取第一个 ui-* 类，但判定要用**全部**状态类（sel / deny / on / low 不带 ui- 前缀，
         上一版把它们滤掉了，于是"选中格允许的那层辉光"被算成 .ui-slot 的违规模糊） */
      const cls = all.filter((c) => c.indexOf('ui-') === 0);
      if (!cls.length) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return;
      const name = '.' + cls[0];
      const bt = px(cs.borderTopWidth), br = px(cs.borderRightWidth), bb = px(cs.borderBottomWidth), bl = px(cs.borderLeftWidth);
      chrome.push({
        el: name, cls: all.join(' '), bg: cs.backgroundColor, fg: cs.color, bc: cs.borderTopColor,
        bw: [bt, br, bb, bl], radius: px(cs.borderTopLeftRadius) + '/' + px(cs.borderTopRightRadius),
        shadow: cs.boxShadow || 'none'
      });
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length);
      if (hasText) text.push({ el: name, fg: cs.color, font: px(cs.fontSize), weight: cs.fontWeight, opacity: cs.opacity });
      if (PERSISTENT.some((s) => el.matches(s))) {
        const hit = !(r.right < CENTRAL.x0 || r.left > CENTRAL.x1 || r.bottom < CENTRAL.y0 || r.top > CENTRAL.y1);
        if (hit) center.push({ el: name, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
      }
    });
    /* 贴边元素的安全边距：只看四角那一圈（中央的准星 / toast 不算） */
    /* 常驻层两两相交检查（同一屏里两块面板叠在一起 = 有一块白做） */
    const boxes = {};
    ['.ui-topbar', '.ui-vitals', '.ui-log', '.ui-hotbar', '.ui-hotbar.p2', '.ui-keybar'].forEach((s) => {
      const el = document.querySelector(s);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) boxes[s] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
    });
    const overlaps = [];
    const keys = Object.keys(boxes);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = boxes[keys[i]], b = boxes[keys[j]];
      if (a[2] > b[0] && b[2] > a[0] && a[3] > b[1] && b[3] > a[1]) overlaps.push({ a: keys[i], b: keys[j], ra: a, rb: b });
    }
    const margins = [];
    ['.ui-topbar', '.ui-vitals', '.ui-log', '.ui-hotbar', '.ui-keybar', '.ui-chipsrow'].forEach((s) => {
      const el = document.querySelector(s);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      margins.push({
        el: s,
        top: Math.round(r.top), left: Math.round(r.left),
        right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom)
      });
    });
    return { chrome, text, center, margins, overlaps, vw: window.innerWidth, vh: window.innerHeight };
  });

  /* ---- 判据 ---- */
  const V = [];
  const bad = (code, msg) => V.push(code + ' · ' + msg);
  const tokHas = (c) => { const p = parseColor(c); return p ? TOK.set.has(key(p.rgb)) : true; };
  const seen = new Set();
  const once = (s) => { if (seen.has(s)) return false; seen.add(s); return true; };

  data.chrome.forEach((c) => {
    if (c.radius && c.radius !== '0/0') { if (once('radius' + c.el)) bad('D', c.el + ' 有圆角 ' + c.radius + '（像素风只准直角）'); }
    const bw = c.bw, nz = bw.filter((v) => v > 0);
    if (nz.length) {
      const odd = nz.filter((v) => v !== 2);
      const oneSided = nz.length === 1 && bw.filter((v) => v === 1).length === 1;
      if (odd.length && !oneSided) { if (once('bw' + c.el)) bad('C', c.el + ' 边框 ' + bw.join('/') + 'px（只准 0 或 2；1px 只准当单边分隔线）'); }
    }
    ['bg', 'bc'].forEach((k) => {
      const v = c[k];
      if (!v || v === 'none' || /rgba\(0, 0, 0, 0\)/.test(v)) return;
      if (!tokHas(v)) { if (once('tok' + c.el + k)) bad('F', c.el + ' 的 ' + k + ' = ' + v + ' 不在令牌表里'); }
    });
    if (c.shadow !== 'none' && !/(^|\s)sel(\s|$)/.test(c.cls)) {
      /* box-shadow 每段的三个长度位是 offX offY blur：blur 必须为 0。
         唯一例外是选中格那一层辉光（--glow-brass），那是设计的一部分不是"顺手加个模糊"。
         逗号要按括号深度切：rgba(...) 里也有逗号（上一版用正则切，把每条阴影都当成一段，全打成模糊）。 */
      const segs = [];
      let depth = 0, cur = '';
      for (let i = 0; i < c.shadow.length; i++) {
        const ch = c.shadow.charAt(i);
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { segs.push(cur); cur = ''; continue; }
        cur += ch;
      }
      if (cur) segs.push(cur);
      const soft = segs.some((seg) => {
        const nums = (seg.match(/-?[\d.]+px/g) || []).map(parseFloat);
        return nums.length >= 3 && nums[2] > 0;
      });
      if (soft && once('blur' + c.el)) bad('E', c.el + ' 的阴影带模糊：' + c.shadow.slice(0, 72));
    }
    if (parseFloat(c.opacity) < 1 && once('op' + c.el)) { /* 容器透明度会同时削边框与文字对比，先记录不判死 */ }
  });
  const SCALE = TOK.sizes.map((n) => n);
  data.text.forEach((t) => {
    if (SCALE.indexOf(t.font) < 0 && once('fs' + t.el + t.font)) bad('A', t.el + ' 字号 ' + t.font + 'px 不在刻度 ' + SCALE.join('/') + ' 上');
  });
  /* 对比度：底 = 最近的实底祖先；透明的一律按三种世界底色取最坏 */
  const WORST = [[207, 233, 255], [111, 191, 74], [18, 14, 28]];
  const bgChain = await page.evaluate(() => {
    const out = [];
    Array.from(document.querySelectorAll('[class^="ui-"],[class*=" ui-"]')).forEach((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!r.width || cs.display === 'none') return;
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length);
      if (!hasText) return;
      let bg = 'rgba(0, 0, 0, 0)', p = el, inPanel = false;
      while (p && p.nodeType === 1) {
        const c = getComputedStyle(p);
        if (/rgba\(\d+, \d+, \d+, [^0]/.test(c.backgroundColor) || (/rgb/.test(c.backgroundColor) && !/rgba\(0, 0, 0, 0\)/.test(c.backgroundColor))) { bg = c.backgroundColor; break; }
        if (/^ui-(bag-box|choice-box|menu-box|result-box|topbar|vitals|log|hotbar|toast|lockhint|help|tooltip)$/.test((c.className || '').split(/\s+/)[0] || '')) { inPanel = true; }
        p = p.parentElement;
      }
      out.push({ el: '.' + ((typeof el.className === 'string' ? el.className : '').split(/\s+/)[0] || el.tagName), fg: cs.color, bg, alpha: cs.opacity, inPanel, font: parseFloat(cs.fontSize), weight: cs.fontWeight });
    });
    return out;
  });
  bgChain.forEach((row) => {
    if (parseFloat(row.alpha) < 0.99) return;                       // 整块透明的（关着的 toast）不比
    const fg = parseColor(row.fg);
    if (!fg) return;
    const bgc = parseColor(row.bg);
    const bases = (bgc && bgc.a > 0.99) ? [bgc.rgb] : (bgc && bgc.a > 0 ? [over(bgc, { rgb: [16, 13, 31], a: 1 }).rgb] : WORST);
    const worst = (bgc && bgc.a > 0.99) ? bgc.rgb : WORST.map((w) => (bgc ? over(bgc, { rgb: w, a: 1 }).rgb : w));
    let min = 99, minBase = null;
    (Array.isArray(worst[0]) ? worst : [worst]).forEach((b) => {
      const rr = ratio(fg.rgb, b);
      if (rr < min) { min = rr; minBase = b; }
    });
    const large = row.font >= 22 || (row.font >= 18.66 && +row.weight >= 700);
    const need = large ? 3 : 4.5;
    if (min < need && once('ct' + row.el + row.fg)) {
      bad('B', row.el + ' 文字 ' + row.fg + ' @' + row.font + 'px 对底最坏只有 ' + min.toFixed(2) + ':1（要 ≥' + need + '）');
    }
  });
  if (data.center.length) data.center.forEach((c) => bad('G', c.el + ' 伸进了屏幕中央 40% 区（rect ' + c.rect.join(',') + '）—— 常驻层只准贴角贴边'));
  /* 常驻层两两不许重叠：1280@1.5 那一档就是键位带横排压住血条数值被这条抓出来的 */
  if (data.overlaps && data.overlaps.length) data.overlaps.forEach((o) => bad('G', '常驻层重叠：' + o.a + ' × ' + o.b + ' [' + o.ra.join(',') + '] × [' + o.rb.join(',') + ']'));
  /* 安全边距按"两轴里较小的那条"算：CSS 侧用的是 3.5vmin（一圈等宽的安全带），
     拿 3% 宽度去量 1440 宽的横向边距会得出 43px 的假要求（上一条版本就是这么误报的） */
  const minAxis = Math.min(data.vw, data.vh);
  data.margins.forEach((m) => {
    const needY = Math.max(20, minAxis * 0.03), needX = needY;
    if (m.top >= 0 && m.top < needY && once('mg' + m.el + 't')) bad('H', m.el + ' 距上沿 ' + m.top + 'px（< 3% 高 = ' + Math.round(needY) + '）');
    if (m.bottom >= 0 && m.bottom < needY && once('mg' + m.el + 'b')) bad('H', m.el + ' 距下沿 ' + m.bottom + 'px（< 3% 高）');
    if (m.left >= 0 && m.left < needX && once('mg' + m.el + 'l')) bad('H', m.el + ' 距左沿 ' + m.left + 'px（< 3% 宽）');
    if (m.right >= 0 && m.right < needX && once('mg' + m.el + 'r')) bad('H', m.el + ' 距右沿 ' + m.right + 'px（< 3% 宽）');
  });
  TOK.drift.forEach((d) => bad('F', '元素色漂移：' + d));
  if (errs.length) errs.slice(0, 5).forEach((e) => bad('X', '页面异常：' + e.split('\n')[0]));

  const hudEl = await page.evaluate(() => (document.getElementById('hud') || {}).className || '');
  console.log('\n===== UI 体检（' + data.chrome.length + ' 个元素 / 视口 ' + data.vw + 'x' + data.vh + ' @dpr' + DPR + ' / ' + (/split/.test(hudEl) ? '分屏' : '常规') + '）=====');
  console.log('字号刻度  ' + SCALE.join(' / ') + 'px');
  console.log('安全边距  ' + data.margins.map((m) => m.el + ' ↑' + m.top + ' ↓' + m.bottom + ' ←' + m.left + ' →' + m.right).join('  |  '));
  console.log('违规      ' + V.length + ' 条');
  V.slice(0, 40).forEach((v) => console.log('  ✗ ' + v));
  if (OUT && !AUDIT_ONLY) fs.writeFileSync(path.join(OUT, 'ui-audit.json'), JSON.stringify({ violations: V, data, viewport: VIEWPORT, dpr: DPR, seed: SEED }, null, 1));
  await browser.close(); srv.close();
  process.exit(GATE && V.length ? 1 : 0);
})().catch((e) => { console.error('RUN ERROR ' + ((e && e.stack) || e)); process.exit(2); });
