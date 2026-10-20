#!/usr/bin/env node
/* tools/layer_check.cjs · 分层责任制机检（不参与游戏运行）

   为什么要有它：用户要求「各司其职，改 UI 就只改一个模块，逻辑层不许硬编码 UI 信息」。
   这种约定只写在 AGENTS.md 里会被下一个会话忘掉，所以做成一条命令：
       node tools/layer_check.cjs
   全过退出码 0；有任何越界，退出码 1 并打出行号。

   规则（按层，改规则请连同 AGENTS.md 的分层表一起改）：
     src/creative.js           状态与能力层：不许碰 DOM；不许出现面向玩家的中文字面量（注释里的中文不算）
     src/battle|rules|world.js 权威层：不许碰 DOM
     src/main.js               装配层：不许 innerHTML；不许把玩家可见文案写死在代码里
     src/hud.js                视图层：必须有 H.TEXT 文案表 + 背包渲染入口 + 徽章入口
     index.html               骨架：#inv 里不许写玩家可见文案（由 H.TEXT 注入）
   注：net.js 是输入层，监听 keydown/mousemove 是它的本职，不算越界。
*/
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BT = String.fromCharCode(96);                       // 反引号：项目源码里没有，遇到就按普通字符处理

/* 逐字符剥掉注释、并把字符串内容替换成占位符：保留行号，注释里的中文不会被误判成文案 */
function scrub(src) {
  let out = '', i = 0, n = src.length, st = 'code';       // code | sq | dq | line | block
  while (i < n) {
    const c = src.charAt(i), d = src.charAt(i + 1);
    if (st === 'code') {
      if (c === '/' && d === '/') { st = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { st = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { st = 'sq'; out += c; i++; continue; }
      if (c === '"') { st = 'dq'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === 'line') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '\n') st = 'code'; continue; }
    if (st === 'block') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '*' && d === '/') { out += ' '; i++; st = 'code'; } continue; }
    const q = (st === 'sq') ? "'" : '"';
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === q) { st = 'code'; out += c; i++; continue; }
    if (c === '\n') { st = 'code'; out += '\n'; i++; continue; }
    out += '\u0001'; i++; continue;                        // 字符串内容占位（中文检测就看这里）
  }
  return out;
}
const CN = /[\u4e00-\u9fa5]/;
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }
function show(src, line) { return (src.split('\n')[line - 1] || '').trim().slice(0, 100); }

let bad = 0;
function checkNoDom(file, why) {
  const src = read(file), clean = scrub(src), hits = [];
  const re = /\bdocument\.|innerHTML|querySelector|createElement|addEventListener/g;
  let m; while ((m = re.exec(clean))) hits.push({ line: lineOf(src, m.index), t: m[0] });
  if (hits.length) {
    bad += hits.length;
    console.log('✗ ' + file + '：' + why);
    hits.forEach(h => console.log('    :' + h.line + '  ' + h.t + '  →  ' + show(src, h.line)));
  } else console.log('✓ ' + file + ' 通过（' + why + '）');
}
function checkMain() {
  const file = 'src/main.js', src = read(file), clean = scrub(src);
  const own = ['innerHTML',
    /'(?:重掷手牌|回满状态|放训练假人|清空场面|无限魔力|卡牌不消耗|无冷却|无敌 \/ 免控|胜者|用时|tick 数|改造上限|进入世界|查看规则)/,
  ];
  let hit = false;
  own.forEach((p, k) => {
    const re = (p instanceof RegExp) ? new RegExp(p.source, 'g') : new RegExp(p, 'g');
    let m; while ((m = re.exec(clean))) { hit = true; bad++; const ln = lineOf(src, m.index);
      console.log('✗ ' + file + '：' + (k === 0 ? '直接写 HTML' : '把玩家可见文案写死在装配层') + '（属 src/hud.js）');
      console.log('    :' + ln + '  ' + show(src, ln)); }
  });
  if (!hit) console.log('✓ ' + file + ' 通过（不写 HTML、不写文案）');
}
function checkCreativeCopy() {
  const file = 'src/creative.js', src = read(file), clean = scrub(src), hits = [];
  const re = /['"]([^'"]*)['"]/g; let m;
  while ((m = re.exec(clean))) if (CN.test(m[1])) hits.push({ line: lineOf(src, m.index), text: show(src, lineOf(src, m.index)) });
  if (hits.length) {
    bad += hits.length;
    console.log('✗ ' + file + '：状态层出现面向玩家的中文（文案应在 src/hud.js 的 H.TEXT）');
    hits.forEach(h => console.log('    :' + h.line + '  ' + h.text));
  } else console.log('✓ ' + file + ' 通过（无面向玩家的中文文案）');
}
function checkHud() {
  const file = 'src/hud.js', src = read(file);
  [['H.TEXT 文案表', /H\.TEXT\s*=/], ['背包渲染入口', /H\.showInventory/], ['顶栏徽章入口', /H\.paintGmBadge/]].forEach(function (p) {
    if (p[1].test(src)) console.log('✓ ' + file + ' 通过（含 ' + p[0] + '）');
    else { bad++; console.log('✗ ' + file + '：缺 ' + p[0]); }
  });
}
function checkSkeleton() {
  const html = read('index.html');
  const a = html.indexOf('<div class="inv" id="inv">'), b = html.indexOf('<div class="menu" id="menu">');
  if (a < 0 || b < a) { bad++; console.log('✗ index.html：找不到 #inv 骨架'); return; }
  const skel = html.slice(a, b).replace(/<!--[\s\S]*?-->/g, '');
  if (CN.test(skel)) { bad++; console.log('✗ index.html：#inv 骨架里写了玩家可见文案（应由 src/hud.js 的 H.TEXT 注入）'); }
  else console.log('✓ index.html 通过（#inv 只有结构与 data-t 插槽）');
  if (/<script>/.test(html)) { bad++; console.log('✗ index.html：出现内联 script 体（逻辑应在 src/ 模块里）'); }
}
checkNoDom('src/creative.js', '状态层不许碰 DOM；UI 属 index.html + src/hud.js');
/* 状态/能力层也不许反向调用视图层或主循环（PLAN_REFACTOR §5.1：只允许向下依赖） */
(function () {
  const file = 'src/creative.js', src = read(file), clean = scrub(src), hits = [];
  const re = /window\.GWAPP|\bG\.HUD\b|\bGW\.HUD\b|\bG\.Rules\.(?!terrainCap)[A-Za-z]+|document\.getElementById/g;
  let m; while ((m = re.exec(clean))) {
    const ln = lineOf(src, m.index);
    hits.push({ line: ln, t: (show(src, ln) || '').slice(0, 90), m: m[0] });
  }
  if (hits.length) { bad += hits.length; console.log('\u2717 ' + file + '：状态层反向依赖了视图层/主循环（应由 main.js 装配层传进来）'); hits.forEach(h => console.log('    :' + h.line + '  ' + h.m + '  \u2192  ' + h.t)); }
  else console.log('\u2713 ' + file + ' 通过（不反向依赖 HUD/GWAPP）');
})();
/* 特效计算层（GW.VFX）：与权威层同级——只算数字，不许碰 DOM、不许碰 THREE、不许写死文案。
   渲染层（main.js / shader.js，另一条工作线）是唯一的消费方，它改画法不该惊动这里。 */
(function () {
  ['src/vfx.js', 'src/vfx-recipes.js'].forEach(function (file) {
    if (!fs.existsSync(path.join(ROOT, file))) { console.log('\u26a0 ' + file + ' 缺失（特效计算层被删了？）'); bad++; return; }
    const src = read(file), clean = scrub(src), hits = [];
    const re = /\bdocument\.|innerHTML|querySelector|createElement|addEventListener|\bTHREE\b|WebGL|BufferGeometry|ShaderMaterial/g;
    let m; while ((m = re.exec(clean))) hits.push({ line: lineOf(src, m.index), t: m[0] });
    const cn = clean.match(/[\u4e00-\u9fa5]/g);
    if (cn) hits.push({ line: 0, t: '玩家可见中文字面量 ×' + cn.length });
    if (hits.length) { bad += hits.length; console.log('\u2717 ' + file + '：特效计算层越界（该由渲染层做的写进了算法层）'); hits.forEach(h => console.log('    :' + h.line + '  ' + h.t)); }
    else console.log('\u2713 ' + file + ' 通过（特效计算层：零 DOM / 零 THREE / 零文案）');
  });
})();
checkNoDom('src/battle.js', '权威层不许碰 DOM');
checkNoDom('src/rules.js', '权威层不许碰 DOM');
/* 特效渲染层（GW.VFXR）：它**就是**画的那一层，所以 THREE 允许，但另外三条照查——
   零 DOM、零玩家可见中文、零反向依赖（不许读 window.GWAPP / G.HUD）。
   再钉一条它自己那层的纪律：**不许往实体上写字段**（宿主→槽位的对应表存在它自己家里）。
   一旦哪天写成 s.vfxAlpha = ...，视觉量就漏进权威状态，"关掉特效必须回到现状"立刻不可机检。 */
(function () {
  const file = 'src/vfx-render.js';
  if (!fs.existsSync(path.join(ROOT, file))) { console.log('\u26a0 ' + file + ' 缺失（特效渲染层被删了？）'); bad++; return; }
  const src = read(file), clean = scrub(src), hits = [];
  const re = /\bdocument\.|innerHTML|querySelector|createElement|\bwindow\.GWAPP\b|G\.HUD\b/g;
  let m; while ((m = re.exec(clean))) hits.push({ line: lineOf(src, m.index), t: m[0] });
  const cn = clean.match(/[\u4e00-\u9fa5]/g);
  if (cn) hits.push({ line: 0, t: '玩家可见中文字面量 ×' + cn.length });
  const leak = clean.match(/\b(?:sigil|summon|pr|ent|e)\.(?:vfx|fxSlot|fxAlpha|fxRot|fxColor)\s*=/g);
  if (leak) hits.push({ line: lineOf(src, clean.indexOf(leak[0])), t: '往实体上写视觉字段：' + leak[0] });
  if (hits.length) { bad += hits.length; console.log('\u2717 ' + file + '：特效渲染层越界'); hits.forEach(h => console.log('    :' + h.line + '  ' + h.t)); }
  else console.log('\u2713 ' + file + ' 通过（特效渲染层：零 DOM / 零文案 / 不反手抓主循环 / 不污染实体）');
})();
/* 物质交互层（GW.CHEM）与特效计算层同规：只算状态与反应，不碰画面也不写字面文案。
   它读世界、写世界，所以 DOM/THREE/中文三条都要查——反应名字只许报 key，中文归 H.TEXT.chem。 */
(function () {
  const file = 'src/chem.js';
  if (!fs.existsSync(path.join(ROOT, file))) { console.log('\u26a0 ' + file + ' 缺失（物质交互层被删了？）'); bad++; return; }
  const src = read(file), clean = scrub(src), hits = [];
  let m;
  const re = /\bdocument\.|innerHTML|querySelector|createElement|addEventListener|\bTHREE\b|WebGL|BufferGeometry|window\.GWAPP|\bG\.HUD\b|\bG\.Rules\.(?!addStatus|damage|terrainCap)[A-Za-z]+/g;
  while ((m = re.exec(clean))) hits.push({ line: lineOf(src, m.index), t: m[0] });
  const cn = clean.match(/[\u4e00-\u9fa5]/g);
  if (cn) hits.push({ line: 0, t: '玩家可见中文字面量 ×' + cn.length + '（反应只报 key，中文在 H.TEXT.chem）' });
  if (hits.length) { bad += hits.length; console.log('\u2717 ' + file + '：物质层越界（画面/文案/反向依赖写进了逻辑层）'); hits.forEach(h => console.log('    :' + h.line + '  ' + h.t + '  →  ' + show(src, h.line))); }
  else console.log('\u2713 ' + file + ' 通过（物质层：零 DOM / 零 THREE / 零文案，只报 key）');
})();
/* 音频三层（引擎 / 配方 / 门面）：与特效计算层同规——不碰 DOM、不碰 THREE、不反向抓主循环。
   配方层额外要求"是纯数据"：出现函数、分支、循环、随机就说明有人把逻辑写进了音色表。
   门面必须继续提供 play/toggle/resume/enabled：battle.js 与 hud.js 只认这几个名字。 */
(function () {
  const AUD = [['src/audio-engine.js', '音频引擎层'], ['src/sfx-table.js', '音频配方层'], ['src/audio.js', '音频门面层']];
  AUD.forEach(function (p) {
    if (!fs.existsSync(path.join(ROOT, p[0]))) { bad++; console.log('\u26a0 ' + p[0] + ' 缺失（音频' + p[1] + '被删了？）'); return; }
    const src = read(p[0]), clean = scrub(src), hits = [];
    const re = /\bdocument\.|innerHTML|querySelector|\bTHREE\b|WebGL|window\.GWAPP|\bG\.HUD\b|GW\.HUD|\bG\.Creative\b/g;
    let m; while ((m = re.exec(clean))) hits.push({ line: lineOf(src, m.index), t: m[0] });
    const cn = clean.match(/[\u4e00-\u9fa5]/g);
    if (cn) hits.push({ line: 0, t: '面向玩家的中文字面量 \u00d7' + cn.length + '（提示语在 src/hud.js 的 H.TEXT）' });
    if (hits.length) { bad += hits.length; console.log('\u2717 ' + p[0] + '：' + p[1] + '越界'); hits.forEach(function (h) { console.log('    :' + h.line + '  ' + h.t + '  \u2192  ' + show(src, h.line)); }); }
    else console.log('\u2713 ' + p[0] + ' 通过（' + p[1] + '：零 DOM / 零 THREE / 零文案 / 不反向依赖）');
  });
  const src = read('src/sfx-table.js'), clean = scrub(src);
  /* 只豁免模块自身的 IIFE 包装（全项目统一写法）；数据体里再出现逻辑词才算越界 */
  let body = clean;
  const OPEN = '(function (G) {', CLOSE = '})(window.GW);';
  const i0 = body.indexOf(OPEN), i1 = body.lastIndexOf(CLOSE);
  if (i0 >= 0 && i1 > i0) body = body.slice(0, i0) + body.slice(i1 + CLOSE.length);
  const logic = ['function', 'if (', 'for (', 'while (', 'Math.random', 'Date.now'].filter(function (w) { return body.indexOf(w) >= 0; });
  if (logic.length) { bad += logic.length; console.log('\u2717 src/sfx-table.js：配方层出现了逻辑（' + logic.join(', ') + '）——音色表只许是数据'); }
  else console.log('\u2713 src/sfx-table.js 通过（纯数据：无函数 / 无分支 / 无循环 / 无随机）');
  const facade = read('src/audio.js');
  const need = [['事件入口 G.Audio.play', /G\.Audio\s*=\s*\{[\s\S]*play\s*:/], ['总开关 toggle', /toggle\s*:/], ['手势解锁 resume', /resume\s*:/], ['状态 enabled', /enabled/]];
  const miss = need.filter(function (n) { return !n[1].test(facade); }).map(function (n) { return n[0]; });
  if (miss.length) { bad += miss.length; console.log('\u2717 src/audio.js：门面少了 ' + miss.join(' / ') + '（battle.js 与 hud.js 只认这几个入口）'); }
  else console.log('\u2713 src/audio.js 通过（门面入口齐全：play / toggle / resume / enabled）');
})();

/* world.js 的像素图集是拿 canvas 2D 画出来的纹理（buildAtlas），那是它的本职不是 UI；
   所以这里只禁 document.* / innerHTML / querySelector，允许 createElement('canvas')。 */
(function () {
  const src = read('src/world.js'), clean = scrub(src), hits = [];
  const re = /\bdocument\.|innerHTML|querySelector/g;
  // 豁免判定看原始行（scrub 之后字符串内容已变占位符，不能再拿它比文字）
  let m; while ((m = re.exec(clean))) {
    const ln = lineOf(src, m.index), raw = show(src, ln);
    if (/document\.createElement\(\s*['"`]canvas['"`]\s*\)/.test(raw)) continue;
    hits.push({ line: ln, t: m[0] });
  }
  if (hits.length) { bad += hits.length; console.log('✗ src/world.js：权威层不许碰 DOM'); hits.forEach(h => console.log('    :' + h.line + '  ' + h.t + '  →  ' + show(src, h.line))); }
  else console.log('✓ src/world.js 通过（权威层不碰 DOM；像素图集用 canvas 纹理已豁免）');
})();
/* 玩家角色层（GW.HERO / GW.HERO_SPRITES，2026-10-17 新增）：
   hero-rig.js = 模型层：可以碰 THREE，但零 DOM、零文案、零反向依赖，也不许读写实体；
   hero-sprites.js = 生成数据：连函数与分支都不许有（它必须是纯数据，要改只能改 tools/hero_bake.cjs 重新生成）。
   素材出处见 assets/mage/README.md 与 docs/ASSET_CREDITS.md（CC-BY 3.0）。 */
(function () {
  var file = 'src/hero-rig.js';
  if (!fs.existsSync(path.join(ROOT, file))) { bad++; console.log('✗ ' + file + ' 缺失（玩家角色层被删了？）'); return; }
  var src = read(file), clean = scrub(src), hits = [], m;
  var reDom = /innerHTML|querySelector|addEventListener|\bwindow\.GWAPP\b|\bG\.HUD\b|\bGW\.HUD\b|localStorage|fetch\(/g;
  while ((m = reDom.exec(clean))) hits.push({ line: lineOf(src, m.index), t: m[0], why: '模型层不许碰 DOM / 反向依赖 / 存储' });
  /* 只认"实体字段访问"的形状：p.pos.x / p.pos.set(...) / players[……
     部件数据记录里的 p.pos[0] 是烘焙出来的盒心坐标，不是玩家实体，别误判成越层。 */
  var reEnt = /\bmatch\.|\bplayers\s*\[|\be\.pos\.[xyz]\b|\bp\.pos\.[xyz]\b|\bp\.pos\.set\(|\bp\.vel\.[xyz]\b|snapshotPrev|renderPos/g;
  while ((m = reEnt.exec(clean))) hits.push({ line: lineOf(src, m.index), t: m[0], why: '模型层不许读写实体（动画量只留在部件上，判定读 e.pos）' });
  var reCopy = /['"]([^'"]*)['"]/g;
  while ((m = reCopy.exec(clean))) if (CN.test(m[1])) hits.push({ line: lineOf(src, m.index), t: '中文文案', why: '玩家可见文案只能写在 src/hud.js 的 H.TEXT' });
  var reDoc = /\bdocument\./g;
  while ((m = reDoc.exec(clean))) {
    var ln0 = lineOf(src, m.index), raw0 = show(src, ln0);
    if (raw0.indexOf('createElement') >= 0 && raw0.indexOf('canvas') >= 0) continue;   // canvas 纹理豁免
    hits.push({ line: ln0, t: 'document.*', why: '模型层只许造 canvas 纹理' });
  }
  if (hits.length) {
    bad += hits.length;
    console.log('✗ ' + file + '：玩家角色层越界');
    hits.forEach(function (h) { console.log('    :' + h.line + '  ' + h.t + '  →  ' + show(src, h.line) + '   【' + h.why + '】'); });
  } else console.log('✓ ' + file + ' 通过（模型层：零 DOM、零文案、不碰实体；canvas 纹理已豁免）');
})();
(function () {
  var file = 'src/hero-sprites.js';
  if (!fs.existsSync(path.join(ROOT, file))) { bad++; console.log('✗ ' + file + ' 缺失（角色贴图数据没了）'); return; }
  var src = read(file), clean = scrub(src), hits = [], m;
  var re = /\bfunction\b|\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|Math\.random|Date\.now|\bdocument\b|\bTHREE\b|\brequire\b|=>/g;
  while ((m = re.exec(clean))) {
    var lnn = lineOf(src, m.index), rawl = (show(src, lnn) || '').trim();
    /* 允许最外面那一层 IIFE：它只负责把数据挂到 GW 上、不往全局漏变量，本身不含逻辑 */
    if (m[0] === 'function' && /^\(?\s*function\s*\(\s*\w*\s*\)\s*\{\s*$/.test(rawl)) continue;
    hits.push({ line: lnn, t: m[0] });
  }
  if (!/(GW|G)\.HERO_SPRITES\s*=/.test(src)) { bad++; console.log('✗ ' + file + '：找不到 GW.HERO_SPRITES 数据表'); }
  if (/[^\x00-\x7F]/.test(src.replace(/\/\*[\s\S]*?\*\//g, ''))) { bad++; console.log('✗ ' + file + '：生成数据里出现非 ASCII（贴图数据必须纯 base64，注释留在 tools/hero_bake.cjs）'); }
  if (hits.length) {
    bad += hits.length;
    console.log('✗ ' + file + '：角色贴图数据层不许有逻辑（要改就改 tools/hero_bake.cjs 再重新生成）');
    hits.forEach(function (h) { console.log('    :' + h.line + '  ' + h.t + '  →  ' + show(src, h.line)); });
  } else console.log('✓ ' + file + ' 通过（纯数据：无函数、无分支、无随机）');
})();

checkMain();
checkCreativeCopy();
checkHud();
checkSkeleton();
console.log(bad ? ('\n分层违规 ' + bad + ' 处（改完再跑 node tools/layer_check.cjs）') : '\n分层责任检查全过');
process.exit(bad ? 1 : 0);
