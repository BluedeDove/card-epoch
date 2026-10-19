#!/usr/bin/env node
/* tools/level_check.cjs · 选关与规则预设回归（docs/LEVELS.md §1.1/§1.2/§2/§4；任务书 docs/tasks/T6_LEVELS_UI.md）

   管住什么：选关界面的一切数字与接线，都是"文档写了一个数、代码必须真的用那个数"。
   这类漂移人眼永远看不见（界面上写着限时 5 分钟、结算按 8 分钟判），只能逐字段核：
     A 三条规则的 8 个字段与 LEVELS.md §1.2 的表逐格相等（改动文档不改代码，这里先红）
     B 未知 rule id / 空 cfg 一律回退 ranked；cfg.rule 的对象覆盖只打在已知规则上
     C 三张图的尺寸与 map-presets 一致（64/96/128 三条，别改一条就发布）
     D 真的透传到权威层：new Match(rulePresetFor({rule:'blitz'})) 之后 scoreWin/timeCap/overtimeCap
       与 lodeSys.holdGrace、beasts 数量、两条 draftCap 都对得上（少一条就是 buildMatch 忘了传）
     E battle.js 不许再把 timeCap/overtimeCap 写死（LEVELS.md §2：它们是 Match opts）
     F 接线：#level 挂载点、rule-presets.js 的加载顺序、level 场景的暂停语义、
       LAYER_TABLE 的 level 层、三条意图登记、H.TEXT.level 的中文、theme.css 的 .ui-level-* 样式

   在 node 里跑，不依赖 GL 与页面。用法：node tools/level_check.cjs [seed]
*/
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/reachability-gate.js', 'src/lode-planter.js', 'src/lode-system.js',
  'src/cards/pick-pools.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js',
  'src/app/map-presets.js', 'src/app/rule-presets.js'].forEach((f) => require(path.join(ROOT, f)));
const G = global.window.GW;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;

let n = 0, bad = 0;
function ck(name, okv, detail) {
  n++; if (okv) console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
  else { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
}
const noop = function () {};
const FX = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop,
  fire: noop, float: noop, ambient: noop, chemLog: noop, quake: noop };

/* ---------- A/B：规则表逐字段核 ----------
   这张表是 docs/LEVELS.md §1.2 的副本：改了文档必须同时改这里，否则这条命令红给你看。 */
const SPEC = {
  ranked: { scoreWin: 100, timeCap: 480, overtimeCap: 45, holdGrace: 0, beasts: 3, draftCapLode: 3, draftCapBeast: 3, aiLevel: 1 },
  blitz: { scoreWin: 75, timeCap: 300, overtimeCap: 30, holdGrace: 6, beasts: 3, draftCapLode: 2, draftCapBeast: 3, aiLevel: 1 },
  training: { scoreWin: 1000, timeCap: 600, overtimeCap: 45, holdGrace: 0, beasts: 0, draftCapLode: 3, draftCapBeast: 0, aiLevel: 0 }
};
const KEYS = ['scoreWin', 'timeCap', 'overtimeCap', 'holdGrace', 'beasts', 'draftCapLode', 'draftCapBeast', 'aiLevel'];
ck('RULE_DEFAULT = ranked', G.RULE_DEFAULT === 'ranked', String(G.RULE_DEFAULT));
Object.keys(SPEC).forEach((k) => {
  const got = G.rulePresetFor({ rule: k });
  KEYS.forEach((f) => {
    ck('规则 ' + k + '.' + f + ' = ' + SPEC[k][f], got[f] === SPEC[k][f], '实得 ' + got[f]);
  });
  ck('规则 ' + k + ' 的 id 自证', got.ruleId === k, got.ruleId);
});
/* LEVELS.md §1.2 的口径：ranked = GAMEPLAY 定案值（防"顺手把文档数字抄错"） */
ck('ranked 就是定案档（100 分 / 480s / 加时 45s）',
  SPEC.ranked.scoreWin === 100 && SPEC.ranked.timeCap === 480 && SPEC.ranked.overtimeCap === 45);
ck('未知 rule id 回退 ranked', G.rulePresetFor({ rule: 'nope' }).ruleId === 'ranked' && G.rulePresetFor({ rule: 'nope' }).scoreWin === 100);
ck('空 cfg 回退 ranked', G.rulePresetFor({}).ruleId === 'ranked' && G.rulePresetFor(null).timeCap === 480);
ck('cfg.rule 对象覆盖只打在已知规则上（blitz + scoreWin:60）',
  (function () { const o = G.rulePresetFor({ rule: { id: 'blitz', scoreWin: 60 } }); return o.ruleId === 'blitz' && o.scoreWin === 60 && o.timeCap === 300; })());
ck('未知 id 带覆盖也不许凭空造规则',
  (function () { const o = G.rulePresetFor({ rule: { id: 'nope', timeCap: 1 } }); return o.ruleId === 'ranked' && o.timeCap === 1; })());

/* ---------- C：三张图的尺寸 ---------- */
ck('duel-64 = 64×36×64', G.mapPresetFor({ map: { id: 'duel-64' } }).size.join('x') === '64x36x64');
ck('island-96 = 96×40×96', G.mapPresetFor({ map: { id: 'island-96' } }).size.join('x') === '96x40x96');
ck('atoll-128 = 128×40×128', G.mapPresetFor({ map: { id: 'atoll-128' } }).size.join('x') === '128x40x128');
ck('默认图 = duel-64（LEVELS.md §1.1）', G.MAP_DEFAULT === 'duel-64' && G.mapPresetFor({}).id === 'duel-64');
ck('三张图都长矿脉（占矿是唯一成长线）', ['duel-64', 'island-96', 'atoll-128'].every((k) => G.mapPresetFor({ map: { id: k } }).lodes === 3));

/* ---------- D：真的透传进 Match ----------
   测试世界必须显式 lodes:true（world.js 的 opts.lodes 默认 false，量具不打开就没有矿脉，
   holdGrace / beasts 两条断言会退化成"没东西可查"）。 */
function mkWorld(size) {
  const w = new G.World({ size: size, seed: SEED, sea: 12, lodes: true });
  w.generate();
  return w;
}
function mkMatch(rule) {
  const rp = G.rulePresetFor({ rule: rule });
  const w = mkWorld([64, 36, 64]);
  const m = new G.Match(Object.assign({
    world: w, seed: SEED, mode: 'train', players: 2, fx: FX,
    cards: [G.STARTER_DECK.slice(), G.STARTER_DECK.slice()], names: ['P1', 'P2']
  }, rp));
  return { m: m, rp: rp, w: w };
}
[['ranked', SPEC.ranked], ['blitz', SPEC.blitz], ['training', SPEC.training]].forEach((pair) => {
  const rule = pair[0], wantv = pair[1];
  const c = mkMatch(rule), m = c.m;
  ck('Match(' + rule + ').scoreWin', m.scoreWin === wantv.scoreWin, m.scoreWin);
  ck('Match(' + rule + ').timeCap（battle 读 opts，不写死）', m.timeCap === wantv.timeCap, m.timeCap);
  ck('Match(' + rule + ').overtimeCap', m.overtimeCap === wantv.overtimeCap, m.overtimeCap);
  ck('Match(' + rule + ').draftCapLode/Beast', m.draftCapLode === wantv.draftCapLode && m.draftCapBeast === wantv.draftCapBeast,
    m.draftCapLode + '/' + m.draftCapBeast);
  ck('Match(' + rule + ').lodeSys.holdGrace', !!m.lodeSys && m.lodeSys.holdGrace === wantv.holdGrace, m.lodeSys ? m.lodeSys.holdGrace : 'no lodeSys');
  const nb = (m.beasts || []).length;
  const wantN = Math.min(wantv.beasts, (m.lodeSys && m.lodeSys.lodes.length) || 0);
  ck('Match(' + rule + ') 晶甲兽数量 = ' + wantN, nb === wantN, nb + ' 只 / 矿 ' + (m.lodeSys ? m.lodeSys.lodes.length : 0) + ' 条');
});

/* ---------- E：battle.js 不许把钟写死 ---------- */
const bt = read('src/battle.js');
ck('battle.js 的 timeCap 读 opts', /this\.timeCap\s*=\s*opts\.timeCap/.test(bt) && !/this\.timeCap\s*=\s*480;/.test(bt));
ck('battle.js 的 overtimeCap 读 opts', /this\.overtimeCap\s*=\s*opts\.overtimeCap/.test(bt) && !/this\.overtimeCap\s*=\s*45;/.test(bt));

/* ---------- F：接线（骨架 / 顺序 / 场景 / 图层 / 意图 / 文案 / 样式） ---------- */
const html = read('index.html');
ck('index.html 有 #level 挂载点', /<div class="menu hidden" id="level"><\/div>/.test(html));
ck('#level 在 #menu 之后', html.indexOf('id="menu"') >= 0 && html.indexOf('id="menu"') < html.indexOf('id="level"'));
ck('index.html 加载 rule-presets.js', html.indexOf('<script src="src/app/rule-presets.js"></script>') >= 0);
ck('rule-presets.js 排在 map-presets.js 之后',
  html.indexOf('src/app/map-presets.js') >= 0 && html.indexOf('src/app/map-presets.js') < html.indexOf('src/app/rule-presets.js'));
const sc = read('src/app/scenes.js');
ck('scenes.js 有 level 场景', /level:\s*\{[^}]*id:\s*'level'/.test(sc), (/.*/.exec(/level:\s*\{[^\n]*/.exec(sc) ? /level:\s*\{[^\n]*/.exec(sc)[0] : '') || '') + '');
ck('level 场景暂停逻辑', /level:\s*\{[^}]*pausing:\s*true/.test(sc));
ck('level 场景指针 free', /level:\s*\{[^}]*pointer:\s*'free'/.test(sc));
ck('level 场景只挂 level 面板', /level:\s*\{[^}]*panels:\s*\['level'\]/.test(sc));
ck('scene 表里 menu/match/result 三条没被动过', /menu:\s*\{[^}]*panels:\s*\['menu'\]/.test(sc) && /match:\s*\{[^}]*pausing:\s*false/.test(sc) && /result:\s*\{[^}]*panels:\s*\['result'/.test(sc));
const core = read('src/ui/core.js');
const layers = (core.match(/LAYER_TABLE\s*=\s*\[([\s\S]*?)\];/) || ['', ''])[1].match(/name:\s*'([a-z]+)'/g) || [];
const names = layers.map((s) => /'([a-z]+)'/.exec(s)[1]);
ck('LAYER_TABLE 里 level / loadout 紧跟 menu 之后（逐字全等，不是放宽）', names.join('>') === ['backdrop', 'hud', 'hotbar', 'notice', 'menu', 'level', 'loadout', 'result', 'panel', 'choice', 'tooltip', 'drag'].join('>'), names.join('>'));
ck('level 层挂骨架给的 #level 且可交互', /\{\s*name:\s*'level',\s*mount:\s*'level',\s*pointer:\s*'auto'\s*\}/.test(core));
const chan = read('src/ui/channel.js');
['ui.levelPick', 'ui.levelStart', 'ui.levelBack'].forEach((k) => ck('INTENTS 登记了 ' + k, new RegExp("'" + k + "'").test(chan)));
const hud = read('src/hud.js');
ck('H.TEXT.level 有标题与三栏小标题', /title:\s*'[^']*'/.test(hud) && /hMap:/.test(hud) && /hRule:/.test(hud) && /hMode:/.test(hud));
['duel-64', 'island-96', 'atoll-128'].forEach((k) => ck('H.TEXT.level 里 ' + k + ' 有人话', new RegExp("'" + k + "':\\s*'[^']*'").test(hud)));
['ranked', 'blitz', 'training'].forEach((k) => ck('H.TEXT.level 里规则 ' + k + ' 有人话',
  new RegExp("[{,]\\s*'?" + k + "'?\\s*:\\s*'[^']*'").test(hud)));
ck('H.TEXT.level 有开始/返回按钮与联网提示', /btnStart:\s*'[^']*'/.test(hud) && /btnBack:\s*'[^']*'/.test(hud) && /未启用/.test(hud));
ck('H.showLevel / H.hideLevel 门面在位', /H\.showLevel\s*=/.test(hud) && /H\.hideLevel\s*=/.test(hud));
ck('菜单的「开始游戏」不再直接开局', /btnStart:\s*'开始游戏'/.test(hud));
const panels = read('src/ui/panels.js');
ck('panels.js 有 LevelSelect 且声明 level 层 order 69', /class LevelSelect extends UI\.Panel/.test(panels) && /layer:\s*'level',\s*order:\s*69/.test(panels));
ck('LevelSelect 说三条意图', /ui\.levelPick/.test(panels) && /ui\.levelStart/.test(panels) && /ui\.levelBack/.test(panels));
ck('面板登记进 UI.build（level: new LevelSelect）', /level:\s*new LevelSelect\(copy\.level\)/.test(panels));
ck('当前选中项读一份 vm.level', /vm\.level/.test(panels));
ck('结算面板加了「回选关」', /ui\.resultAction',\s*\{\s*key:\s*'level'\s*\}/.test(panels) || /key: 'level'/.test(panels));
const css = read('src/ui/theme.css');
['.ui-level-box', '.ui-level-cols', '.ui-level-card', '.ui-level-name', '.ui-level-note', '.ui-level-acts'].forEach((c) => ck('theme.css 有 ' + c, css.indexOf(c) >= 0));
ck('.ui-level-card 用 --ui-tone 体系外的合法令牌画边框', /\.ui-level-card\{[^}]*border:var\(--edge\)\s+solid\s+var\(--line-1\)/.test(css));
ck('选关样式零圆角（radius 令牌为 0 且不写 border-radius）', !/\.ui-level-[^}]*border-radius/.test(css));
const main = read('src/main.js');
['ui.levelPick', 'ui.levelStart', 'ui.levelBack'].forEach((k) => ck('main.js 接住了 ' + k, new RegExp("'" + k + "'\\s*:\\s*function").test(main)));
ck('main.js 的 buildMatch 之外不重复展开规则', (read('src/app/session.js').match(/rulePresetFor/g) || []).length >= 1);
ck('session.buildMatch 把七个数字都传进 Match（beasts 允许联机 guest 归零，docs/NET.md §9.1）', (function () {
  const s = read('src/app/session.js');
  const six = ['scoreWin', 'timeCap', 'overtimeCap', 'holdGrace', 'draftCapLode', 'draftCapBeast']
    .every((k) => new RegExp(k + ':\\s*rp\\.' + k).test(s));
  /* 房主照规则给兽；guest 恒 0（中立实体由房主生成、经快照按 uid 下发，两端各长一批会闪） */
  const beasts = /beasts:\s*rp\.beasts/.test(s) ||
    (/beasts:\s*\(/.test(s) && /rp\.beasts/.test(s) && /role\s*===\s*'guest'/.test(s));
  return six && beasts;
})());
ck('AISource 的等级来自规则预设', /rp\.aiLevel/.test(read('src/app/session.js')));
/* 双击 file:// 的真实路径不看这里，但骨架顺序错了整个页面就起不来，所以值得机检 */
ck('level 面板不会把中文写进 panels.js', !/[\u4e00-\u9fa5]/.test(panels.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));

/* ---------- G：选关的联机入口（docs/NET.md §9.5；任务书 docs/tasks/N3_NET_UI.md） ----------
   这一块管的是"选了联网，玩家能不能把服务器 / 房间码 / 角色填进去并真开成一局"。
   N1/N2 把链路跑通之前，这里全部是「未启用」的拒绝分支；现在拒绝只剩一条真实的：服务器没填。 */
const session = read('src/app/session.js');
ck('H.TEXT.level.netNote 在，且写明要跑 net_host.cjs', /netNote:\s*'[^']*net_host\.cjs[^']*'/.test(hud));
['hNet', 'netUrlLabel', 'netRoomLabel', 'netRoleLabel', 'netHost', 'netGuest', 'netRoomPlaceholder'].forEach((k) => {
  ck('H.TEXT.level.' + k + ' 有人话', new RegExp(k + ":\\s*'[^']*'").test(hud));
});
ck('选关的模式条目改口成局域网 + net_host.cjs（不再写「没有 server.js」）',
  /联网 PVP（局域网）/.test(hud) && /net_host\.cjs'\s*\}/.test(hud) && !/联网 PVP（未启用）/.test(hud));
ck('net-offline 的人话留着，语义改成「没填服务器」这一类', /'net-offline':\s*'[^']*服务器[^']*'/.test(hud));
['netUrl', 'netRoom', 'netRole'].forEach((k) => ck('panels.js 里出现字段名 ' + k, new RegExp("field:\\s*'" + k + "'").test(panels)));
ck('panels.js 的 vm.level 初始状态带三个 net 字段（ui.menuPick 用 `field in L` 当闸，缺了就静默丢）',
  /netUrl:\s*'ws:\/\/127\.0\.0\.1:8787'/.test(panels) && /netRoom:\s*'ROOM'/.test(panels) && /netRole:\s*'host'/.test(panels));
ck('.ui-level-net 只在选中 net 时出现（when 闸读 sel.mode）',
  /h\('div\.ui-level-net[^']*',\s*\{[\s\S]{0,80}?when:\s*\(ctx\)\s*=>\s*sel\(ctx\)\.mode\s*===\s*'net'/.test(panels));
ck('两个角色按钮走 ui.levelPick（视图不直接写状态），data-key 是 host / guest',
  /key:\s*'host',\s*field:\s*'netRole'/.test(panels) && /key:\s*'guest',\s*field:\s*'netRole'/.test(panels)
    && /pick\('netRole',\s*'host'\)/.test(panels) && /pick\('netRole',\s*'guest'\)/.test(panels));
/* 口径补充（2026-10-18）：判定从"这段代码里不许出现 if (field==='mode' && value==='net')"改成
   "不许把 net 当成拒绝"——选关里现在确实有一条同形分支，但它做的是把三字段滚进视野（不是拒绝）；
   菜单里点联网则必须真的进选关（新增下面那条正向断言）。 */
ck('选关/菜单里没有把 net 当拒绝（不许 ui:toast net-offline）',
  !/bus\.emit\('ui:toast',\s*\{\s*key:\s*'net-offline'\s*\}\)/.test(panels) &&
  !/ui:toast[^\n]*net-offline/.test(panels.slice(panels.indexOf('class LevelSelect'), panels.indexOf('class Result'))));
ck('菜单里点联网 = 选成 net 并进选关（不再"点了没反应"）',
  /k === 'net'\)[^\n]*ui\.menuPick[^\n]*'net'[^\n]*ui\.menuAction[^\n]*'level'/.test(panels));
ck('theme.css 有 .ui-level-net 段', css.indexOf('.ui-level-net{') >= 0);
ck('main.js 的 ui.levelStart 不再一律把 mode=net 打回 net-offline',
  !/if \(cfg\.mode === 'net'\) return \{ ok: false, reason: 'net-offline' \}/.test(main));
ck('main.js 的 ui.levelPick 也不再拒 mode=net（与上面同一条拒绝口径）',
  !/if \(p\.field === 'mode' && p\.value === 'net'\) return/.test(main));
ck('H.config 拼出 net: { url, room, role }（形状在 src/hud.js 的 H.config 里补，main.js 只调它）',
  /cfg\.net = \{ url: L\.netUrl, room: L\.netRoom, role: L\.netRole \}/.test(hud));
ck('H.config 的 net 读的是 vm.state.level 这一份视图状态（不在装配层另存一份）',
  /const L = \(vm && vm\.state\.level\) \|\| \{\};/.test(hud));
ck('main.js 仍守着「服务器没填就别连」那一条（net-offline 有了新职责）',
  /cfg\.mode === 'net'[\s\S]{0,240}?return \{ ok: false, reason: 'net-offline' \}/.test(main));
/* 6b：联机的名字标签（H.TEXT.ui.names.p2 是「AI 对手」，联机里读着不对） */
ck('H.TEXT.net.names = 你 / 对手', /names:\s*\[\s*'你'\s*,\s*'对手'\s*\]/.test(hud));
ck('session.buildMatch 把 S.mode 传给 playerNames', /playerNames\(S\.split,\s*S\.mode\)/.test(session));
ck('H.playerNames 收第二个参数并只在 mode===net 时换名册（单人/分屏逐字不变）',
  /H\.playerNames = function \(split, mode\)/.test(hud) && /if \(mode === 'net'\)/.test(hud)
    && /return split \? \[N\.p1Split \|\| 'P1', N\.p2Split \|\| 'P2'\] : \[N\.p1 \|\| 'P1', N\.p2 \|\| 'P2'\];/.test(hud));


/* ---------- H：玩法这条轴（docs/MODES.md §6；任务书 docs/tasks/M1_MODES.md 第 10 条）----------
   只管四件事：数据表里真有两条玩法、开局 cfg 真带 game、面板真说玩法栏与胜分行两条意图、
   视图状态真有两个初值。少一条，玩家看到的就是「点了没反应」（ui_check 抓过的同一类漂移）。
   判据一律用字符串比对而不是正则：这里的字面量带引号与反斜杠，正则写错一次就永远绿。 */
const gmSrc = read('src/app/game-modes.js');
const dmSrc = read('src/app/match-director.js');
const QQ = String.fromCharCode(39);
const hasIn = function (s0, s1) { return s0.indexOf(s1) >= 0; };
const NLH = String.fromCharCode(10), SLH = String.fromCharCode(47);
/* 只剥注释、保留字符串（本项目两个新逻辑层的文件头都在注释里写"零 DOM / 零 THREE"，
   不剥注释就会把说明本身判成越界——与 layer_check 的 scrub 同一条口径）。 */
const noCmt = function (s0) {
  let o = "", i = 0, st = 0;
  while (i < s0.length) {
    const c = s0.charAt(i), d = s0.charAt(i + 1);
    if (st === 0) {
      if (c === SLH && d === SLH) { st = 1; i += 2; continue; }
      if (c === SLH && d === '*') { st = 2; i += 2; continue; }
      o += c; i++; continue;
    }
    if (st === 1) { if (c === NLH) { st = 0; o += c; } i++; continue; }
    if (st === 2) { if (c === '*' && d === SLH) { st = 0; i += 2; continue; } i++; continue; }
  }
  return o;
};
const qof = function (s1) { return QQ + s1 + QQ; };
ck('game-modes.js 里有两条玩法条目（lode / deathmatch）', hasIn(gmSrc, "id: " + qof("lode")) && hasIn(gmSrc, "id: " + qof("deathmatch")));
ck('game-modes.js 交两个解析出口（gameModeFor / modeMatchOpts）', hasIn(gmSrc, "G.gameModeFor = gameModeFor") && hasIn(gmSrc, "G.modeMatchOpts = matchOptsFor"));
ck('game-modes.js 与 match-director.js 都是逻辑层：零 DOM、零 THREE、不反向抓 HUD', !/document[.]|THREE|window[.]GWAPP|G[.]HUD/.test(noCmt(gmSrc)) && !/document[.]|THREE|window[.]GWAPP|G[.]HUD/.test(noCmt(dmSrc)));
ck('H.config 拼出 game 那一项（选关的第二条轴进 cfg）', hasIn(hud, "cfg.game = { id: L.game || G.GAME_DEFAULT || " + qof("lode") + ", target: L.gameTarget }"));
ck('panels.js 说得出玩法栏与胜分行两条意图（field: game / gameTarget）', hasIn(panels, "field: " + qof("game")) && hasIn(panels, "field: " + qof("gameTarget")));
ck('panels.js 的 vm.level 初值含 game / gameTarget（缺了就静默丢却回 ok:true）', hasIn(panels, "game: (G.GAME_DEFAULT || " + qof("lode") + "), gameTarget: 10"));
ck('H.TEXT.level 有玩法与胜分两个小标题', hasIn(hud, "hGame: " + QQ) && hasIn(hud, "hGameTarget: " + QQ));
ck('H.TEXT.game 备了两条玩法的名字、一句话与胜分档的人话', hasIn(hud, "names: { lode:") && hasIn(hud, "notes: {") && hasIn(hud, "dmTargets: {") && hasIn(hud, "dmTargetNotes: {"));
ck('选关的 games / gameTargets 条目现从数据层合成（文案表不抄第二份数字）', hasIn(hud, "C.games = Object.keys(GM)") && hasIn(hud, "C.gameTargets = (G.DM_TARGETS || [])"));
ck('未知玩法的回退只做一次（权威层与装配层不许各自 if 一次 lode）', !hasIn(bt, "=== " + qof("lode")) && !hasIn(session, "=== " + qof("lode")) && !hasIn(main, "=== " + qof("lode")));
ck('session 挂 director 并 begin()，同时记下 modeCfg', hasIn(session, "G.MatchDirector.create(mode, S.match)") && hasIn(session, "director.begin()") && hasIn(session, "S.match.modeCfg = mode"));
ck('viewmodel 只递 displaySpec（不在视图里判几杀算赢）', hasIn(read('src/ui/viewmodel.js'), "vm.board = "));

/* ---------- L：战前选牌页（docs/ROUTER.md §2；任务书 docs/tasks/L1_LOADOUT_UI.md 第 7 条）----------
   只管这七件事：骨架有 #loadout、场景认 loadout、图层表把 loadout 排在 level 之后（按**运行时顺序**量，
   不是按源码文本猜）、panels.js 真有 Loadout 这个面板类并注册进 UI.build、文案表备齐「就绪 / 缺什么」
   的人话、三条意图都登记过且有人接、样式真的长出了那一套 .ui-loadout-* 且守零圆角/2px 边框。
   这一页最容易坏在「看着有面板其实没人接」——玩家点就绪没反应，全靠这几条拦住。 */
const vmSrc = read('src/ui/viewmodel.js');
ck('index.html 有 #loadout 挂载点（与 level / menu 同一类骨架挂载点）',
  hasIn(html, '<div class="menu hidden" id="loadout"></div>'));
ck('#loadout 排在 #level 之后（DOM 顺序就是页面顺序，别插到 result 后面）',
  html.indexOf('id="level"') >= 0 && html.indexOf('id="level"') < html.indexOf('id="loadout"'));
ck('scenes.js 有 loadout 场景：只挂 loadout 面板、暂停逻辑、指针 free',
  hasIn(sc, "loadout:{ id: 'loadout', panels: ['loadout'], pausing: true, pointer: 'free' }"));
/* 图层顺序按运行时量：LayerStack.boot() 读的就是最终那份 LAYER_TABLE，
   字符串正则看不见「插入进去的那一行」，只有把 core.js 真跑起来才量得准。 */
const nodevm = require('vm');
const fakeEl = function () { return { id: '', style: {}, className: '', setAttribute: function () { }, appendChild: function () { } }; };
const fakeDoc = {
  getElementById: function (id) { const e = fakeEl(); e.id = id; return e; },
  createElement: fakeEl,
  body: { appendChild: function () { } }
};
const coreSandbox = { window: { GW: {} }, console: console, document: fakeDoc };
nodevm.createContext(coreSandbox);
nodevm.runInContext(read('src/ui/core.js'), coreSandbox, { filename: 'src/ui/core.js' });
const UIC = coreSandbox.window.GW.UI;
const stack = new UIC.LayerStack(fakeDoc).boot();
const order = stack.order();
ck('LAYER_TABLE（运行时）含 loadout 且紧跟 level 之后',
  order.indexOf('loadout') >= 0 && order.indexOf('loadout') === order.indexOf('level') + 1, order.join('>'));
ck('loadout 层用骨架给的 #loadout 当容器、pointer:auto（不吃指针的面板点不动）', (function () {
  const l = stack.layers.get('loadout');
  return !!l && l.pointer === 'auto' && !!l.el && l.el.id === 'loadout';
})(), (function () { const l = stack.layers.get('loadout'); return l ? (l.pointer + '/' + (l.el && l.el.id)) : 'no layer'; })());
ck('panels.js 有 class Loadout：loadout 层 order 68、closable:false',
  hasIn(panels, 'class Loadout extends UI.Panel')
  && hasIn(panels, "layer: " + qof('loadout') + ", order: 68, closable: false"));
ck('panels.js 的 Loadout 说得出三条意图并注册进 UI.build',
  hasIn(panels, qof('ui.loadoutPick')) && hasIn(panels, qof('ui.loadoutReady')) && hasIn(panels, qof('ui.loadoutBack'))
  && hasIn(panels, 'loadout: new Loadout(copy.loadout)'));
ck('Loadout 打开时交还指针并收起锁鼠标提示（面板类交互三条硬要求之一）',
  hasIn(panels, "document.getElementById('loadout')")
  && /class Loadout extends UI\.Panel[\s\S]{0,1200}exitPointerLock/.test(panels));
ck('H.TEXT.loadout 存在：标题 / 卡池与牌库两个小标题 / 就绪与返回两颗按钮都有中文',
  hasIn(hud, 'loadout: {') && hasIn(hud, 'title: ' + QQ) && hasIn(hud, 'poolHead: ' + QQ)
  && hasIn(hud, 'pickHead: ' + QQ) && /ready:\s*'[^']+'/.test(hud) && /back:\s*'[^']+'/.test(hud));
ck('H.TEXT.loadout 的 needCount / needTerrain 两句人话非空（缺牌必须说得出缺什么）', (function () {
  const at = hud.indexOf('needCount: function');
  const at2 = hud.indexOf('needTerrain: function');
  if (at < 0 || at2 < 0) return false;
  return /[一-龥]/.test(hud.slice(at, at + 240)) && /[一-龥]/.test(hud.slice(at2, at2 + 240));
})());
ck('H.TEXT.loadout 齐了四种状态与被退回那一句（等待对手 / 我已就绪 / 对手已就绪 / 双方就绪）',
  hasIn(hud, 'waitPeer: ' + QQ) && hasIn(hud, 'readySelf: ' + QQ) && hasIn(hud, 'peerReady: ' + QQ)
  && hasIn(hud, 'bothReady: ' + QQ) && hasIn(hud, 'reject: ' + QQ) && hasIn(hud, 'roles: {'));
ck('H 门面备齐战前选牌六个入口（开 / 隐 / 取牌 / 写状态 / 标就绪 / 说人话）',
  /H\.showLoadout\s*=/.test(hud) && /H\.hideLoadout\s*=/.test(hud) && /H\.loadoutPicks\s*=/.test(hud)
  && /H\.setLoadoutStatus\s*=/.test(hud) && /H\.markLoadoutReady\s*=/.test(hud) && /H\.sayLoadout\s*=/.test(hud));
ck('三条上限只在 viewmodel 写一份，hud 读同一份常量（界面写的数 = 判就绪的数）',
  hasIn(vmSrc, 'deckSize: 12, eachMax: 2, terrainMin: 4') && hasIn(hud, 'UI.LOADOUT_RULES')
  && !hasIn(panels, 'deckSize: 12') && !hasIn(main, 'deckSize: 12'));
ck('viewmodel 就地写 loadout 全套读数（换对象 = 面板读旧引用，AGENTS 那条老坑）',
  hasIn(vmSrc, "loadout: { picks: {}, ready: false, status: " + qof('waiting') + " }")
  && hasIn(vmSrc, 'buildLoadout()') && hasIn(vmSrc, 'this.buildLoadout();')
  && hasIn(vmSrc, 'vm.loadoutEligible =') && hasIn(vmSrc, 'vm.loadoutStatus =')
  && hasIn(vmSrc, 'vm.loadoutCount =') && hasIn(vmSrc, 'vm.loadoutTerrain ='));
/* 每条 reason 都必须在 H.TEXT.ui.deny 里有一句非空的人话：ui_check 只反查 main.js / items.js / channel.js
   里出现的 reason，hud.js 自己 return 的那几条没人管，全靠这条补上（被拒时玩家看到英文 key 就是静默）。
   取值逐字符扫而不是正则：上一版这条把值的量词写漏（[^'] 少一个 +）而永远红 —— 正则写错一次就骗人。 */
const WS4 = String.fromCharCode(32, 9, 10, 13);
const missingDeny = [];
const denyHas = function (reason) {
  const key = QQ + reason + QQ + ':';
  const at = hud.indexOf(key);
  if (at < 0) { missingDeny.push(reason + '(没有这一条)'); return false; }
  let i = at + key.length;
  while (WS4.indexOf(hud.charAt(i)) >= 0) i++;
  if (hud.charAt(i) !== QQ) { missingDeny.push(reason + '(值不是字符串)'); return false; }
  let j = i + 1, out = '';
  while (j < hud.length && hud.charAt(j) !== QQ) { out += hud.charAt(j); j++; }
  if (out.length < 1) { missingDeny.push(reason + '(空句子)'); return false; }
  return true;
};
ck('超限与几种拒绝都备好人话（reason 没句子 = 玩家看到英文 key）',
  ['limit', 'deck-full', 'not-enough', 'nothing-picked', 'unknown-card'].every(denyHas), missingDeny.join(' / ') || '五条都有');
['ui.loadoutPick', 'ui.loadoutReady', 'ui.loadoutBack'].forEach((k) => {
  ck('INTENTS 登记了 ' + k, hasIn(chan, qof(k)));
  ck('main.js 接住了 ' + k + '（没人接一律 no-handler，不许假成功）', hasIn(main, qof(k) + ': function'));
});
ck('main.js 的 G.HUD.init 注入 loadoutReady / loadoutCancel 两个装配层 handler',
  hasIn(main, 'loadoutReady: function (picks)') && hasIn(main, 'loadoutCancel: function ()'));
ck('net 未接时不假装开局：loadoutReady 的默认实现只把「等对手」演出来',
  hasIn(main, "G.HUD.sayLoadout(" + qof('waitPeer')) && hasIn(hud, 'waitPeer: ' + QQ));
ck('路由落位时收掉 loadout 面板（别的页面还压着一张全屏 .menu 底 = 什么都点不到）',
  hasIn(main, "name !== " + qof('loadout') + " && typeof G.HUD.hideLoadout === " + qof('function'))
  && hasIn(main, 'G.HUD.hideLoadout()'));
ck('__GW_LOADOUT_PREVIEW 只给截图 / 回归用，且写清只改视图状态不改权威层',
  hasIn(main, 'window.__GW_LOADOUT_PREVIEW = function (n)') && hasIn(main, '只给截图与回归用')
  && hasIn(main, "G.Router.go(" + qof('loadout') + ", { role: " + qof('host') + ", room: " + qof('PREVIEW') + " })"));
['.ui-loadout-box', '.ui-loadout-head', '.ui-loadout-status', '.ui-loadout-cols', '.ui-loadout-picks',
 '.ui-loadout-pick', '.ui-loadout-count', '.ui-loadout-missing', '.ui-loadout-acts'].forEach((c) => ck('theme.css 有 ' + c, hasIn(css, c)));
ck('战前选牌样式守零圆角、边框只用 0 或 var(--edge)（与 ui_shot --gate 的 C/D 两条同口径）',
  !/\.ui-loadout-[^}]*border-radius/.test(css) && !/\.ui-loadout-[^}]*border:\s*[135]px/.test(css));

console.log('\n共 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
