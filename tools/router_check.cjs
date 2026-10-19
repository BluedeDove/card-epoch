#!/usr/bin/env node
/* tools/router_check.cjs · 页面路由回归（docs/ROUTER.md §1；任务书 docs/tasks/R1_ROUTER.md 第 5 条）

   管住什么：「路由是页面级导航的唯一真源」这句话必须是可机检的，否则下一个会话又会写回裸跳。
   判据（R1–R10 是任务书点名的十条，W 组是接线，X 组是没有 location 的那条路）：
     R1  路由表五条路由齐全（menu/level/loadout/match/result），每条都有 scene
     R2  默认落位 menu（地址栏为空）
     R3  #/level 落位 level，并真的调了 Scene.enter('level')
     R4  未知名字回 menu（go / 地址栏 / href 三条口径一致）
     R5  go 更新 hash 为 #/level 并发通知（next / prev / params 都对得上）；hash 相同不重复写
     R6  replace 不压栈、go 压栈（用 back 能回多远来判，不去偷看内部字段）
     R7  back 从 level 回 menu；栈空再 back 仍是 menu
     R8  href('level') === '#/level'
     R9  hashchange 触发后 current 跟着变；自己写出去的那次 hash 不重复导航、不重复压栈
     R10 静态：router.js 里没有 document. / innerHTML / 中文字面量 / G.HUD
     W1–W3 接线：index.html 的 script 顺序、scenes.js 的 loadout、main.js 不再裸调 Scene.enter
     X1  没有 location 时路由照旧工作（hash 只是可观测的副作用，不是状态）

   环境是假的：global.window 只有 location / history / addEventListener 三样，G.Scene 只记录调用。
   这正是这层该有的样子——它不该需要真页面。用法：node tools/router_check.cjs
*/
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const ROUTER = path.join(ROOT, 'src/app/router.js');

let n = 0, bad = 0;
function ck(name, okv, detail) {
  n++;
  if (okv) console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
  else { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
}

/* ---------- 假环境 ---------- */
/* location.hash 做成读写桩并计数：「hash 相同不重复写」只能数写了几次（每写一次都进一条浏览器历史） */
function makeLocation(initial) {
  const loc = { _h: initial || '', writes: 0 };
  Object.defineProperty(loc, 'hash', {
    enumerable: true, configurable: true,
    get: function () { return this._h; },
    set: function (v) { this.writes++; this._h = v; }
  });
  return loc;
}
let enters = [];          // Scene.enter 的调用记录（id + args）
let winListeners = {};    // window 级监听（hashchange）

/* 每次 boot 都重灌模块：路由的内部状态（current / stack / listeners）必须是干净的一份 */
function boot(opts) {
  opts = opts || {};
  enters = []; winListeners = {};
  global.window = {
    GW: {},
    location: (opts.noLocation === true) ? undefined : makeLocation(opts.hash),
    history: { back: function () { } },
    addEventListener: function (type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); }
  };
  /* 假的 G.Scene：只记录不画东西——Scene 自己的暂停/指针语义由 tools/scene_check.cjs 管 */
  global.window.GW.Scene = {
    v: 1,
    enter: function (id, args) { enters.push({ id: id, args: args === undefined ? null : args }); return { id: id }; }
  };
  delete require.cache[require.resolve(ROUTER)];
  require(ROUTER);
  return global.window.GW;
}
function fire(type) {
  const list = winListeners[type] || [];
  for (let i = 0; i < list.length; i++) list[i]({ type: type });
  return list.length;
}
const lastEnter = () => enters[enters.length - 1] || {};
const entered = () => enters.map(e => e.id).join('>');

/* ---------- R1 路由表 ---------- */
{
  const G = boot({ hash: '' });
  const want = ['menu', 'level', 'loadout', 'match', 'result'];
  const got = Object.keys(G.ROUTES || {});
  ck('R1 路由表含 5 个名字', want.every(k => got.indexOf(k) >= 0) && got.length === 5, got.join(','));
  ck('R1b 每条路由都指向一个 scene，并备着 panel 字段', want.every(k => {
    const r = (G.ROUTES || {})[k] || {};
    return typeof r.scene === 'string' && Object.prototype.hasOwnProperty.call(r, 'panel');
  }), want.map(k => k + '→' + ((G.ROUTES || {})[k] || {}).scene).join(' '));
}

/* ---------- R2 默认落位 menu ---------- */
{
  const G = boot({ hash: '' });
  const cur = G.Router.start();
  ck('R2 地址栏为空 → 落位 menu', cur.name === 'menu' && G.Router.current().name === 'menu', cur.name);
  ck('R2b 落位时调了 Scene.enter(menu)', lastEnter().id === 'menu', entered());
  ck('R2c 首次落位不压栈（紧接着 back 仍是 menu）', G.Router.back().name === 'menu');
  ck('R2d 落位把 hash 写成 #/menu', global.window.location.hash === '#/menu', global.window.location.hash);
}

/* ---------- R3 #/level ---------- */
{
  const G = boot({ hash: '#/level' });
  const cur = G.Router.start();
  ck('R3 #/level → 落位 level', cur.name === 'level', cur.name);
  ck('R3b 落位调了 Scene.enter(level)', lastEnter().id === 'level', entered());
  ck('R3d 同值 hash 不重写（落位不该再进一条浏览器历史）', global.window.location.writes === 0, 'writes=' + global.window.location.writes);
  ck('R3c 首次落位不压栈', G.Router.back().name === 'menu', 'back→' + G.Router.current().name);
}

/* ---------- R4 未知名字回 menu ---------- */
{
  const G = boot({ hash: '#/nowhere' });
  ck('R4 地址栏未知名字 → menu', G.Router.start().name === 'menu');
  ck('R4b go 未知名字 → menu', G.Router.go('nowhere').name === 'menu');
  ck('R4c href 未知名字 → #/menu', G.Router.href('nowhere') === '#/menu', G.Router.href('nowhere'));
  const H = boot({ hash: '#/match' });
  ck('R4d 冷启动落在 #/match 也不算页面（回 menu，场上没有对局）', H.Router.start().name === 'menu');
}

/* ---------- R5 go ---------- */
{
  const G = boot({ hash: '' });
  G.Router.start();
  const seen = [];
  G.Router.on((next, prev) => seen.push({ next: next && next.name, prev: prev && prev.name, params: next && next.params }));
  const cur = G.Router.go('level', { from: 'menu' });
  ck('R5 go 把 hash 写成 #/level', global.window.location.hash === '#/level', global.window.location.hash);
  ck('R5b go 通知 (next, prev)', seen.length === 1 && seen[0].next === 'level' && seen[0].prev === 'menu', JSON.stringify(seen));
  ck('R5c 通知带 params', !!cur.params && cur.params.from === 'menu', JSON.stringify(cur.params));
  ck('R5d go 调了 Scene.enter(level)', lastEnter().id === 'level', entered());
  const w = global.window.location.writes;
  G.Router.go('level');
  ck('R5e 同页重进不重复写 hash', global.window.location.writes === w, 'writes+=' + (global.window.location.writes - w));
}

/* ---------- R6 replace 不压栈 / go 压栈 ---------- */
{
  const G = boot({ hash: '' });
  G.Router.start(); G.Router.go('level');
  ck('R6 go 压栈：back 回 menu', G.Router.back().name === 'menu');
  const H = boot({ hash: '' });
  H.Router.start(); H.Router.go('level'); H.Router.replace('match', { seed: 1 });
  ck('R6b replace 不压栈：back 回 menu 而不是 level', H.Router.back().name === 'menu');
  const T = boot({ hash: '' });
  T.Router.start(); T.Router.go('level'); T.Router.go('loadout');
  ck('R6c 连两次 go：back 先回 level 再回 menu', T.Router.back().name === 'level' && T.Router.back().name === 'menu');
}

/* ---------- R7 back 与空栈 ---------- */
{
  const G = boot({ hash: '' });
  G.Router.start(); G.Router.go('level');
  ck('R7 back 从 level 回 menu', G.Router.back().name === 'menu');
  G.Router.back(); G.Router.back();
  ck('R7b 栈空再 back 仍是 menu', G.Router.current().name === 'menu', G.Router.current().name);
  const H = boot({ hash: '' });
  H.Router.start(); H.Router.replace('match', { seed: 2 });
  ck('R7c 开局后 back 回 menu，不留在对局面', H.Router.back().name === 'menu');
}

/* ---------- R8 href ---------- */
{
  const G = boot({ hash: '' });
  ck('R8 href(level) === #/level', G.Router.href('level') === '#/level', G.Router.href('level'));
  const five = ['menu', 'level', 'loadout', 'match', 'result'];
  ck('R8b 每条路由的 href 都带 #/ 前缀', five.every(k => G.Router.href(k) === '#/' + k), five.map(k => G.Router.href(k)).join(' '));
}

/* ---------- R9 hashchange ---------- */
{
  const G = boot({ hash: '' });
  G.Router.start();
  ck('R9 start() 注册了 hashchange 监听（只一次）', (winListeners.hashchange || []).length === 1, '监听数=' + (winListeners.hashchange || []).length);
  G.Router.start();
  ck('R9b 重复 start 不重复挂监听', (winListeners.hashchange || []).length === 1, '监听数=' + (winListeners.hashchange || []).length);
  global.window.location.hash = '#/loadout';                       // 用户手改地址 / 浏览器后退
  fire('hashchange');
  ck('R9c hashchange 后 current 跟着变', G.Router.current().name === 'loadout', G.Router.current().name);
  ck('R9d hashchange 走上同一条 go（调了 Scene.enter）', lastEnter().id === 'loadout', entered());
  let hits = 0;
  const off = G.Router.on(() => { hits++; });
  fire('hashchange');
  ck('R9e 同值 hash 再触发不重复通知', hits === 0, '通知 ' + hits + ' 次');
  off();
  const w = global.window.location.writes;
  G.Router.go('menu');                                             // loadout → menu（压栈）
  ck('R9g go 只写一次 hash', global.window.location.writes === w + 1, 'writes+=' + (global.window.location.writes - w));
  fire('hashchange');                                              // 浏览器异步回声
  ck('R9f go 之后回声的 hashchange 不重复压栈（back 仍回 go 之前那一页）', G.Router.back().name === 'loadout', 'back→' + G.Router.current().name);
  global.window.location.hash = '#/result';                        // 浏览器回退到一个向前不可回的页
  fire('hashchange');
  ck('R9h hashchange 到 match / result 这类页收在 menu（没有对局就没有对局页）', G.Router.current().name === 'menu', G.Router.current().name);
  /* 开局那一跳的回声：go/replace 写出去的 #/match 不能让 onHashChange 按"落位口径"收走，
     否则自己写的 hash 把自己拽回菜单，主循环冻在没有对局的场面上（2026-10-18 ui_check 的 AppState 红过这条） */
  const G4 = boot({ hash: '' });
  G4.Router.start();
  G4.Router.replace('match', { mode: 'train', seed: 7 });
  fire('hashchange');
  ck("R9i replace('match') 之后回声的 hashchange 不许把页面收回 menu", G4.Router.current().name === 'match', G4.Router.current().name);
  ck('R9j 真外部改地址（浏览器回退到 match 这类向前不可回的页）仍按落位口径收', (function () {
    global.window.location.hash = '#/menu'; fire('hashchange'); return G4.Router.current().name === 'menu';
  })());
}

/* ---------- R10 静态分层 ---------- */
{
  const raw = fs.readFileSync(ROUTER, 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')                                  // 块注释
    .split('\n').map(l => l.replace(/\/\/[^\n]*$/, '')).join('\n');   // 行注释
  ck('R10 router.js 不碰 document.', code.indexOf('document.') < 0);
  ck('R10b router.js 不拼 HTML', code.indexOf('innerHTML') < 0 && code.indexOf('querySelector') < 0 && code.indexOf('createElement') < 0);
  ck('R10c router.js 零面向玩家的中文字面量', !/[\u4e00-\u9fa5]/.test(code), '注释外的中文：' + ((code.match(/[\u4e00-\u9fa5]+/g) || []).slice(0, 4).join('/') || '无'));
  ck('R10d router.js 不反向抓 hud / 主循环', !/\bG\.HUD\b|\bGW\.HUD\b|window\.GWAPP/.test(code));
  ck('R10e router.js 没有画面与网络副作用（THREE / WebGL / fetch / 存储）', !/\bTHREE\b|WebGL|fetch\(|localStorage/.test(code));
}

/* ---------- W 接线 ---------- */
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const atScenes = html.indexOf('<script src="src/app/scenes.js"></script>');
  const atRouter = html.indexOf('<script src="src/app/router.js"></script>');
  const atMain = html.indexOf('<script src="src/main.js"></script>');
  ck('W1 index.html 引了 router.js', atRouter >= 0);
  ck('W1b router.js 排在 scenes.js 之后、main.js 之前', atScenes >= 0 && atScenes < atRouter && atRouter < atMain,
    'scenes@' + atScenes + ' router@' + atRouter + ' main@' + atMain);
  const scenes = fs.readFileSync(path.join(ROOT, 'src/app/scenes.js'), 'utf8');
  ck('W2 scenes.js 有 loadout 场景', /loadout:\s*\{[^}]*id:\s*'loadout'/.test(scenes));
  ck('W2b loadout 场景暂停逻辑、指针 free、只挂 loadout 面板',
    /loadout:\s*\{[^}]*pausing:\s*true/.test(scenes) && /loadout:\s*\{[^}]*pointer:\s*'free'/.test(scenes) && /loadout:\s*\{[^}]*panels:\s*\['loadout'\]/.test(scenes));
  ck('W2c 既有场景没被动过（boot / menu / match / result 仍在原位）',
    /boot:\s*\{/.test(scenes) && /menu:\s*\{[^}]*panels:\s*\['menu'\]/.test(scenes) &&
    /match:\s*\{[^}]*pausing:\s*false/.test(scenes) && /result:\s*\{[^}]*panels:\s*\['result'/.test(scenes));
  const main = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  ck('W3 main.js 不再对页面级场景裸调 Scene.enter', !/Scene\.enter\('(match|result|level|menu|loadout)'/.test(main),
    (main.match(/Scene\.enter\([^)]*\)/g) || []).join(' '));
  ck('W3b main.js 的开局 / 结算 / 选关都走路由', /nav\('match'/.test(main) && /nav\('result'/.test(main) && /nav\(on \? 'level' : 'menu'/.test(main));
  ck('W3c main.js 先订阅路由再落位（顺序反了首屏没面板）',
    main.indexOf('G.Router.on(onRoute)') >= 0 && main.indexOf('G.Router.on(onRoute)') < main.indexOf('G.Router.start()'));
  ck('W3d 选关的 Esc 判据改问路由', /routeIs\('level'\)/.test(main));
  ck('W3e 装配层里 onRoute 认五条路由', ['menu', 'level', 'loadout', 'match', 'result'].every(k => new RegExp("name === '" + k + "'").test(main)));
  ck('W3f loadout 的面板入口按存在与否才调（不许假装有面板）', /typeof G\.HUD\.showLoadout === 'function'/.test(main));
  {
    const onRouteBody = (main.split('function onRoute')[1] || '').split('function toLevelScene')[0] || '';
    const overBody = (main.split('function onMatchOver')[1] || '').split('function typingNow')[0] || '';
    ck('W3g 结算的 reveal 仍只在 onMatchOver 那条流程里（监听不许自己调 showMatchResult）',
      !/showMatchResult\s*\(/.test(onRouteBody) && /G\.HUD\.showMatchResult\s*\(/.test(overBody),
      'onRoute 里 showMatchResult 调用数=' + (onRouteBody.match(/showMatchResult\s*\(/g) || []).length + '，onMatchOver 里=' + (overBody.match(/G\.HUD\.showMatchResult\s*\(/g) || []).length);
  }
}

/* ---------- X1 没有 location ---------- */
{
  const G = boot({ noLocation: true });
  let err = null;
  try { G.Router.start(); G.Router.go('level', { a: 1 }); G.Router.replace('match', { seed: 3 }); G.Router.back(); }
  catch (e) { err = e; }
  ck('X1 没有 location 也不炸', !err, err && err.message);
  ck('X1b 没有 location 时路由照旧工作', G.Router.current().name === 'menu', G.Router.current().name);
  const H = boot({ noLocation: true });
  H.Router.start();
  let got = null;
  H.Router.on((nxt) => { got = nxt.name; });
  H.Router.go('level');
  ck('X1c 没有 location 时仍照常通知订阅者', got === 'level', String(got));
}

console.log('\n共 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
