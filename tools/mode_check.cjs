#!/usr/bin/env node
/* tools/mode_check.cjs · 玩法编排框架回归（docs/MODES.md §7 的第一条；任务书 docs/tasks/M1_MODES.md 第 9 条）

   管住什么——"流程与显示都可编排"这句话只能这样核对：
     M1 击杀记账：kills / deaths / 分数 / players[].score 四本账同时对得上；死亡竞赛里**矿不给分但给素材**
        （产物 producedScore / producedMats 的节拍不许因为不计分就停——那是"这个玩法不计分"，不是"没产出"）
     M2 目标分结束：target=3 → 第 3 杀当场 over.winner=0 / winReason='score'（第 2 杀不许提前结束）
     M3 不限分只按时间：target=0 + timeCap=60 → 3 杀不结束；到点按比分判；timeCap=0 → 永不自动结束
     M4 平局加时：到点平分 → 下一个得分事件定胜负（'overtime'）；加时到点依次比 击杀数 → 死亡数少 → 'overtime-tie'
     M5 lode 玩法与今天一致：kill +15、lodePoints=1、100 分结束、480s 时间判，
        并且与**没挂 director 的同一份 Match** 吃同一串事件后逐字段相同（默认玩法不许漂移）
     M6 加一个假玩法 testmode（kill 7 / target 14）：注册完 2 杀就结束——battle / director / UI 一行不改
        （连 game-modes.js 的源码一起核对：里面不许出现 testmode 这个串，否则"只加数据"就是假的）
     M7 displaySpec 的行序**完全由 mode.display.rows 决定**（换行序也对）；chip 给目标与倒计时；
        并且反查 src/hud.js 的 H.TEXT.board.rows：每个 key 有人话（没补的 key 玩家会看到英文原样）
     M8 gameModeFor：未知 id 回 lode、lode 合并规则预设、deathmatch 的 target 0/10 与 type never、
        返回的是拷贝（改一次不污染表）、modeMatchOpts 七个字段与 aiLevel 的映射
     M9 同输入 → 同输出：两个 director 吃同一串事件，snapshot 逐字段相同（无随机、无时钟）
     M10 静态：两个新文件零 document. / 零 THREE / 零中文字面量 / 不反向抓 HUD；index.html 挂了这两个脚本；
        显示层的接线（viewmodel 的 vm.board、panels 的 .ui-top-board、session 的 director 挂载）都还在

   构造口径照 tools/draft_check.cjs（64×36×64 关卡图，**lodes:true 才长矿脉**）；断言与打印风格同 hand_check。
   在 node 里跑，不依赖 GL 与页面。用法：node tools/mode_check.cjs [seed]；退出码非 0 就是不达标。
*/
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/reachability-gate.js', 'src/lode-planter.js', 'src/lode-system.js',
  'src/cards/pick-pools.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js',
  'src/systems/match-ops.js', 'src/systems/stats.js', 'src/systems/scoreboard.js',
  'src/app/map-presets.js', 'src/app/rule-presets.js', 'src/app/game-modes.js', 'src/app/match-director.js'
].forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const STEP = 1 / 20;
const NL = String.fromCharCode(10);
const read = function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); };
/* 出厂玩法表的快照：必须在任何夹具往 G.GAME_MODES 注册假玩法之前取（M6 的"只加数据"就靠它核对）。 */
const SHIPPED = Object.keys(G.GAME_MODES).join(',');
const Q39 = String.fromCharCode(39), COLON = String.fromCharCode(58);

let n = 0, bad = 0;
function ck(name, ok, detail) {
  n++; if (ok) console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
  else { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }
}
const noop = function () {};
const FX = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop,
  fire: noop, float: noop, ambient: noop, chemLog: noop, quake: noop };

/* 测试世界：关卡图，矿脉显式打开（同 draft_check / level_check 的口径） */
function mkWorld(seed) {
  const w = new G.World({ size: [64, 36, 64], seed: seed >>> 0, sea: 12, lodes: true });
  w.generate(); return w;
}
/* 夹具 = session.buildMatch 的那几步（玩法 → Match opts → 挂 director → 三个终局参数 → begin）。
   写成一处是有原因的：量具与装配层必须走同一条展开路，否则这里绿、玩家那边是另一套数。 */
function mkMatch(cfg, over, withDirector) {
  const o = over || {};
  const seed = (o.seed === undefined ? SEED : o.seed) >>> 0;
  const w = mkWorld(seed);
  const mode = G.gameModeFor(cfg);
  const rpBase = G.rulePresetFor(cfg) || {};
  const rp = G.modeMatchOpts(mode, rpBase);
  const m = new G.Match(Object.assign({
    world: w, seed: seed, mode: 'train', players: 2, fx: FX,
    cards: [G.STARTER_DECK.slice(), G.STARTER_DECK.slice()], names: ['P1', 'P2']
  }, rp, o.opts || {}));
  if (withDirector !== false) {
    m.modeCfg = mode;
    m.director = G.MatchDirector.create(mode, m);
    m.scoreWin = mode.win.target || m.scoreWin;
    m.timeCap = mode.win.timeCap;
    m.overtimeCap = mode.win.overtimeCap;
    m.director.begin();
  }
  return m;
}
function killOnce(m, k, v) {
  const victim = m.players[v], killer = m.players[k];
  victim.dead = false; victim.alive = true; victim.hp = victim.maxHp; victim.respawn = 0;
  m.kill(victim, killer, {});
}
function run(m, secs) { const t = Math.round(secs / STEP); for (let i = 0; i < t; i++) { if (m.over) break; m.step(STEP, [{}, {}]); } return t; }
/* 把人放到矿台上（同 draft_check 口径：脚底落在台面顶块之上，占矿窗口 [L.y, L.y+3.5] 内） */
function standOnLode(m, side, li) {
  const L = m.lodeSys && m.lodeSys.lodes[li], p = m.players[side];
  if (!L) return null;
  m.world.set(L.x, L.y + 1, L.z, 0);
  p.pos.set(L.x + 0.5, L.y + 1 + p.h / 2 + 0.001, L.z + 0.5);
  p.vel.set(0, 0, 0); p.onGround = true; p.airHigh = null;
  return p;
}
const J = function (v) { return JSON.stringify(v); };

/* ---------- M1 击杀记账 ---------- */
{
  const m = mkMatch({ game: { id: 'deathmatch', target: 10 } });
  ck('M1 死亡竞赛开局：账本全 0、phase=live', m.director.phase === 'live' && J(m.director.snapshot().kills) === '[0,0]', J(m.director.snapshot()));
  killOnce(m, 0, 1);
  const s = m.director.snapshot();
  ck('M1 一杀：kills[0]=1、deaths[1]=1（死亡榜与击杀榜分开记）', J(s.kills) === '[1,0]' && J(s.deaths) === '[0,1]', J(s.kills) + ' / ' + J(s.deaths));
  ck('M1 一杀：score 进 mode.score.kill 那一个数（=1，不是 lode 的 15）', s.scores[0] === 1 && m.players[0].score === 1, 'snap=' + s.scores[0] + ' 权威=' + m.players[0].score);
  ck('M1 权威字段 players[].score 与 snapshot.scores 同步（HUD/存档读的是它）', m.players[0].score === s.scores[0] && m.players[1].score === s.scores[1], J([m.players[0].score, m.players[1].score]));
  ck('M1 被杀者不涨分、也不倒扣', m.players[1].score === 0, String(m.players[1].score));
  ck('M1 MatchStats 的 score/kills/deaths 三本账一起动（结算面板读它）',
    m.stats.perSide[0].score === 1 && m.stats.perSide[0].kills === 1 && m.stats.perSide[1].deaths === 1,
    J([m.stats.perSide[0].score, m.stats.perSide[0].kills, m.stats.perSide[1].deaths]));
  /* 钩子 2：矿不给分，但素材与占矿秒数照给（那是两条收益，不是三条捆在一起） */
  const p0 = m.players[0], mats0 = p0.mats, holdBefore = m.lodeSys.lodes[0].holdSec[0];
  const okStand = !!standOnLode(m, 0, 0);
  run(m, 6.6);
  ck('M1 站矿 6.6s：这个玩法占矿不给分（score 仍是 1）', okStand && m.players[0].score === 1, 'score=' + m.players[0].score);
  ck('M1 站矿 6.6s：素材照给（+1/6s 那条不看玩法）', okStand && m.players[0].mats >= mats0 + 1, mats0 + '→' + m.players[0].mats);
  ck('M1 站矿 6.6s：归属与产分节拍仍在记（producedScore 是账，不是分数）',
    okStand && m.lodeSys.lodes[0].producedScore[0] >= 2 && m.lodeSys.lodes[0].holdSec[0] > holdBefore,
    'producedScore=' + m.lodeSys.lodes[0].producedScore[0]);
}

/* ---------- M2 目标分结束 ---------- */
{
  const m = mkMatch({ game: { id: 'deathmatch', target: 3 } });
  killOnce(m, 0, 1); killOnce(m, 0, 1);
  ck('M2 两杀（2/3）还活着', !m.over, J(m.director.snapshot().scores));
  killOnce(m, 0, 1);
  ck('M2 第三杀当场结束：winner=0 / winReason=score', !!m.over && m.over.winner === 0 && m.over.winReason === 'score', J(m.over));
  ck('M2 结束时编排类自己也知道结束了（phase=ended，不用再问 match）', m.director.phase === 'ended', m.director.phase);
  /* 反向：对手先到位 → winner=1（不是永远判 side 0） */
  const m2 = mkMatch({ game: { id: 'deathmatch', target: 2 } });
  killOnce(m2, 1, 0); killOnce(m2, 1, 0);
  ck('M2 另一方到线就判另一方胜', !!m2.over && m2.over.winner === 1 && m2.over.winReason === 'score', J(m2.over));
  /* 同一串事件再喂一个已结束的对局：不许继续加分（step 已停，但直接调钩子也不许脏） */
  const before = J(m2.director.snapshot());
  m2.director.onKill(0, 1);
  ck('M2 已结束之后的击杀事件不改账（phase 闸）', J(m2.director.snapshot()) === before, J(m2.director.snapshot()));
}

/* ---------- M3 不限分只按时间 ---------- */
{
  const m = mkMatch({ game: { id: 'deathmatch', target: 0, timeCap: 60 } });
  ck('M3 target=0 → win.type=never（没有分数线）', m.modeCfg.win.type === 'never' && m.director.target === 0, J(m.modeCfg.win));
  killOnce(m, 0, 1); killOnce(m, 0, 1); killOnce(m, 0, 1);
  ck('M3 不限分时 3 杀不结束（今天的 target=10 那条不许漏进来）', !m.over, J(m.director.snapshot().scores));
  run(m, 61);
  ck('M3 到 timeCap 按比分结束：winner=0 / winReason=time', !!m.over && m.over.winner === 0 && m.over.winReason === 'time', J(m.over));
  const m2 = mkMatch({ game: { id: 'deathmatch', target: 0, timeCap: 0 } });
  killOnce(m2, 0, 1); run(m2, 90);
  ck('M3 timeCap=0 → 永不自动结束（只能手动退出）', !m2.over && m2.tick > 1500, 'tick=' + m2.tick);
}

/* ---------- M4 平局加时 ---------- */
{
  const m = mkMatch({ game: { id: 'deathmatch', target: 0, timeCap: 60 } });
  killOnce(m, 0, 1); killOnce(m, 1, 0);
  run(m, 61);
  ck('M4 到点平分 → 进加时（不立刻判）', !m.over && m.director.overtime === true, J(m.director.snapshot()));
  ck('M4 加时也写回权威字段 match.overtime（Scoreboard.addScore 的加时速判靠它）', m.overtime === true, String(m.overtime));
  killOnce(m, 0, 1);
  ck('M4 加时里下一个得分事件定胜负：winner=0 / winReason=overtime', !!m.over && m.over.winner === 0 && m.over.winReason === 'overtime', J(m.over));
  /* 加时到点逐级判：全平 → overtime-tie */
  const m2 = mkMatch({ game: { id: 'deathmatch', target: 0, timeCap: 60, overtimeCap: 20 } });
  run(m2, 61);
  ck('M4 无人得分到点 → 先进加时而不是直接平局', !m2.over && m2.director.overtime === true, J(m2.director.snapshot()));
  run(m2, 25);
  ck('M4 加时到点仍全平 → 判平局 overtime-tie', !!m2.over && m2.over.winner === -1 && m2.over.winReason === 'overtime-tie', J(m2.over));
  /* 加时到点比分仍平，但击杀数分高下（用一个 kill 不加分的假玩法把"比分平 / 击杀不平"造出来） */
  G.GAME_MODES.scoreless = { id: 'scoreless', labelKey: 'game.scoreless', score: { kill: 0, lodePointsPerTick: 0 },
    win: { type: 'never', target: 0, timeCap: 60, overtimeCap: 20 },
    map: { lodes: true, beasts: 0, draft: { lode: 0, beast: 0 } }, holdGrace: 0, respawn: 2.2,
    display: { rows: ['kills', 'deaths'], target: true, time: true } };
  const m3 = mkMatch({ game: 'scoreless' });
  killOnce(m3, 0, 1); killOnce(m3, 0, 1);
  run(m3, 86);
  ck('M4 加时到点：比分平时比击杀数（第①级），winReason=overtime',
    !!m3.over && m3.over.winner === 0 && m3.over.winReason === 'overtime', J(m3.over) + ' 比分=' + J(m3.director.snapshot().scores));
}

/* ---------- M5 lode 玩法与今天一致 ---------- */
{
  const m = mkMatch({});   // 不选玩法 = 默认 lode + 默认规则 ranked
  ck('M5 默认玩法 = lode，且把 ranked 规则并进终局参数（100 分 / 480s / 加时 45s）',
    m.modeCfg.id === 'lode' && m.scoreWin === 100 && m.timeCap === 480 && m.overtimeCap === 45,
    'scoreWin=' + m.scoreWin + ' timeCap=' + m.timeCap + ' overtimeCap=' + m.overtimeCap);
  ck('M5 lodePoints()=1（沿用每 3 秒 +1）', m.director.lodePoints() === 1, String(m.director.lodePoints()));
  ck('M5 lode 把时间/终局判定委托给 Scoreboard.step（不重写一遍）', m.director.delegate === true, String(m.director.delegate));
  killOnce(m, 0, 1);
  ck('M5 击杀 +15（定案 §2.1 那个数，玩法表写的就是它）', m.players[0].score === 15, String(m.players[0].score));
  const m2 = mkMatch({});
  for (let i = 0; i < 7; i++) killOnce(m2, 0, 1);
  ck('M5 攒到 100 分当场结束（15×7=105 ≥ 100）：winReason=score', !!m2.over && m2.over.winner === 0 && m2.over.winReason === 'score', J(m2.over));
  /* 480s 时间判：无兽（夹具关掉生成，免得随从先把人咬死），两边分数不等 */
  const m3 = mkMatch({}, { opts: { beasts: 0 } });
  m3.addScore(m3.players[0], 50);
  run(m3, 481);
  ck('M5 480s 到点按分数判：winner=0 / winReason=time', !!m3.over && m3.over.winner === 0 && m3.over.winReason === 'time', J(m3.over));
  /* 与"没挂 director 的同一份 Match"吃同一串事件 → 权威账逐字段相同（默认玩法不许漂移） */
  const withD = mkMatch({}, { opts: { beasts: 0 } }), noD = mkMatch({}, { opts: { beasts: 0 } }, false);
  for (const mm of [withD, noD]) { standOnLode(mm, 0, 0); run(mm, 3.3); killOnce(mm, 0, 1); standOnLode(mm, 1, 1); run(mm, 6.7); killOnce(mm, 1, 0); run(mm, 1.2); }
  const acc = function (mm) { return J([mm.time, mm.tick, mm.players[0].score, mm.players[1].score, mm.players[0].kills, mm.players[1].kills, mm.players[0].mats, mm.players[1].mats, mm.stats.perSide, mm.over]); };
  ck('M5 同一串事件：挂 director 与不挂的权威账逐字段相同（lode 行为不变）', acc(withD) === acc(noD), acc(withD).slice(0, 120));
  ck('M5 对照组的矿确实在产分（不然上一条是"两边都没产"的假绿）', withD.lodeSys.lodes[0].producedScore[0] >= 1 && withD.players[0].score > 15,
    'producedScore=' + withD.lodeSys.lodes[0].producedScore[0] + ' score=' + withD.players[0].score);
}

/* ---------- M6 加一个假玩法：不改 battle / director / UI ---------- */
{
  const beforeFiles = { battle: read('src/battle.js'), director: read('src/app/match-director.js'), panel: read('src/ui/panels.js') };
  G.GAME_MODES.testmode = {
    id: 'testmode', labelKey: 'game.test',
    score: { kill: 7, lodePointsPerTick: 0 },
    win: { type: 'score', target: 14, timeCap: 480, overtimeCap: 45 },
    map: { lodes: true, beasts: 0, draft: { lode: 0, beast: 0 } },
    holdGrace: 0, respawn: 2.2,
    display: { rows: ['kills', 'deaths', 'score'], target: true, time: true }
  };
  const m = mkMatch({ game: 'testmode' });
  ck('M6 假玩法的分数表被真的用（杀一下 = 7 分，不是 1 也不是 15）', m.players[0].score === 0 && m.director.mode.score.kill === 7, JSON.stringify(m.director.mode.score));
  killOnce(m, 0, 1);
  ck('M6 target=14：一杀（7 分）不结束', !m.over && m.players[0].score === 7, J(m.director.snapshot().scores));
  killOnce(m, 0, 1);
  ck('M6 两杀（14 分）当场结束：winner=0 / winReason=score', !!m.over && m.over.winner === 0 && m.over.winReason === 'score', J(m.over));
  ck('M6 假玩法是运行时注册的：game-modes.js 里没有 testmode 条目（注释里提一句不算）', !/testmode\s*:/.test(read('src/app/game-modes.js')));
  ck('M6 出厂表只有两条玩法（lode,deathmatch）', SHIPPED === 'lode,deathmatch', SHIPPED);
  ck('M6 注册期间 battle / director / panels 三份文件一字未动（核对读取时字节长度）',
    J(Object.keys(beforeFiles).map(function (k) { return beforeFiles[k].length; })) === J(Object.keys(beforeFiles).map(function (k) { return read('src/' + (k === 'battle' ? 'battle.js' : k === 'director' ? 'app/match-director.js' : 'ui/panels.js')).length; })),
    Object.keys(beforeFiles).map(function (k) { return k + '=' + beforeFiles[k].length; }).join(' '));
  ck('M6 假玩法的矿也不给分（lodePointsPerTick=0 被 director 说过一次就够了）', m.director.lodePoints() === 0, String(m.director.lodePoints()));
}

/* ---------- M7 displaySpec 的行可编排 ---------- */
{
  const dm = mkMatch({ game: { id: 'deathmatch', target: 10 } });
  const a = dm.director.displaySpec();
  ck('M7 deathmatch 的行序 = mode.display.rows（kills,deaths,score）', J(a.rows.map(function (r) { return r.key; })) === J(['kills', 'deaths', 'score']), J(a.rows.map(function (r) { return r.key; })));
  ck('M7 lode 的行序 = 它自己那条（score,kills,deaths）—— 同一份面板代码画出两种顺序',
    J(mkMatch({}).director.displaySpec().rows.map(function (r) { return r.key; })) === J(['score', 'kills', 'deaths']),
    J(mkMatch({}).director.displaySpec().rows.map(function (r) { return r.key; })));
  /* 换一行序（把表里那条改掉）→ 只影响 rows，代码一行没动 */
  /* 换行序的那个夹具：顺手把击杀分改成 3，好让下一断言能分辨"击杀那行读的是击杀账"
     —— kill=1 时 kills 与 score 两行的数一样，断言就退化成"两边都绿"的假绿（AGENTS 里那条坑）。 */
  G.GAME_MODES.flipmode = Object.assign({}, G.GAME_MODES.deathmatch, {
    id: 'flipmode', labelKey: 'game.flip', score: { kill: 3, lodePointsPerTick: 0 },
    display: { rows: ['deaths', 'score', 'kills'], target: true, time: true }
  });
  const f = mkMatch({ game: 'flipmode' });
  ck('M7 换 rows 顺序 → displaySpec.rows 跟着换（面板按它渲染就是可编排）',
    J(f.director.displaySpec().rows.map(function (r) { return r.key; })) === J(['deaths', 'score', 'kills']),
    J(f.director.displaySpec().rows.map(function (r) { return r.key; })));
  killOnce(f, 0, 1);
  const b = f.director.displaySpec();
  ck('M7 每行都带 key / labelKey / mine / theirs 四个字（UI 不许自己拼字段名）',
    b.rows.every(function (r) { return typeof r.key === 'string' && r.labelKey === 'board.' + r.key && typeof r.mine === 'number' && typeof r.theirs === 'number'; }),
    J(b.rows[0]));
  ck('M7 击杀那行读击杀账、分数那行读分数账（kill=3 时两个数必须分家）',
    b.rows.filter(function (r) { return r.key === 'kills'; })[0].mine === 1 &&
    b.rows.filter(function (r) { return r.key === 'score'; })[0].mine === 3 &&
    b.rows.filter(function (r) { return r.key === 'deaths'; })[0].theirs === 1,
    J(b.rows));
  ck('M7 chip：限定分时给目标、有时间时给倒计时', b.chips.map(function (c) { return c.key; }).join(',') === 'target,timeLeft', J(b.chips));
  const u = mkMatch({ game: { id: 'deathmatch', target: 0, timeCap: 0 } }).director.displaySpec();
  ck('M7 chip：不限分时 target=0（由文案表翻成「不限」）、无时限时不出现倒计时 chip',
    u.target === 0 && u.timeLeft === null && u.chips.map(function (c) { return c.key; }).join(',') === 'target', J(u.chips));

  /* 词汇表反查：display.rows 里每个 key 在 H.TEXT.board.rows 都有人话（漏一条玩家就看到英文原样） */
  const hudSrc = read('src/hud.js');
  /* 不用正则：这段要的是 H.TEXT.board 那一段的正文，indexOf + slice 就够（正则里的反斜杠
     在这个夹具文件里已经被转义层吃掉过一次，判据本身不该依赖它）。 */
  const bStart = hudSrc.indexOf('board: {');
  const bEnd = bStart >= 0 ? hudSrc.indexOf(NL + '    }', bStart) : -1;
  const rowsBlock = (bStart >= 0 && bEnd > bStart) ? hudSrc.slice(bStart, bEnd) : '';
  const keys = [];
  Object.keys(G.GAME_MODES).forEach(function (k) {
    const rw = (G.GAME_MODES[k].display || {}).rows || [];
    rw.forEach(function (x) { if (keys.indexOf(x) < 0) keys.push(x); });
  });
  const has = (s) => rowsBlock.indexOf(s) >= 0;
  /* key 带不带引号都认：H.TEXT 里 rows 的 key 是不带引号那种（score: '比分'），只认带引号会把写对的判成缺。 */
  function hasKey(kk) { return rowsBlock.indexOf(kk + COLON) >= 0 || rowsBlock.indexOf(Q39 + kk + Q39 + COLON) >= 0; }
  const missing = keys.filter(function (kk) { return !hasKey(kk); });
  ck('M7 H.TEXT.board.rows 认得玩法表里的每一个行 key（词汇表反查，同 audio_check 那条路）',
    bStart >= 0 && keys.length >= 3 && missing.length === 0, 'keys=' + J(keys) + ' 缺=' + J(missing));
  ['target', 'unlimited', 'timeLeft'].forEach(function (k) {
    ck('M7 H.TEXT.board.' + k + ' 有人话', has(k + ": '") || has(k + ":'") , rowsBlock.slice(0, 0));
  });
  /* 目标 chip 的量词：lode 的 100 是分、死亡竞赛的 10 是杀 —— 单位由玩法表给（display.unit），
     中文在 H.TEXT.board.units。截图里露出过一处真 bug：chip 对所有玩法都写「杀」，
     lode 那局显示成「目标 100 杀」，与 GAMEPLAY 定案的 100 分不是同一件事。 */
  const unitOf = function (spec) {
    const t = spec.chips.filter(function (c) { return c.key === 'target'; })[0];
    return t ? t.unit : '(无 target chip)';
  };
  ck('M7 目标 chip 带量词：lode=score、deathmatch=kill（chip.unit 由玩法表 display.unit 给）',
    unitOf(mkMatch({}).director.displaySpec()) === 'score' &&
    unitOf(mkMatch({ game: 'deathmatch' }).director.displaySpec()) === 'kill',
    unitOf(mkMatch({}).director.displaySpec()) + ' / ' + unitOf(mkMatch({ game: 'deathmatch' }).director.displaySpec()));
  /* 反查文案表：玩法表用过的每个量词都得有人话（漏一条 chip 只剩一个光秃秃的数字） */
  const unitKeys = [];
  Object.keys(G.GAME_MODES).forEach(function (kk) {
    const dv = (G.GAME_MODES[kk].display || {}).unit;
    if (dv && unitKeys.indexOf(dv) < 0) unitKeys.push(dv);
  });
  ck('M7 H.TEXT.board.units 认得玩法表用过的每个量词（score / kill 两条）',
    unitKeys.length >= 2 && unitKeys.every(function (u) { return hasKey(u); }),
    'units=' + JSON.stringify(unitKeys));
}

/* ---------- M8 gameModeFor / modeMatchOpts ---------- */
{
  ck('M8 未知 id 回 lode', G.gameModeFor({ game: 'nope' }).id === 'lode' && G.gameModeFor({ game: { id: 'nope', target: 3 } }).id === 'lode');
  ck('M8 不传 game 也是 lode（老存档 / 量具 / 双击开局的默认路径）', G.gameModeFor({}).id === 'lode' && G.gameModeFor(null).id === 'lode');
  ck('M8 cfg.game 可以是 id 字符串', G.gameModeFor({ game: 'deathmatch' }).id === 'deathmatch');
  const lb = G.gameModeFor({ rule: 'blitz', game: 'lode' });
  ck('M8 lode 合并规则预设：胜分=rp.scoreWin、两只钟=rp 的、beasts/draft/holdGrace 全跟',
    lb.win.target === 75 && lb.win.timeCap === 300 && lb.win.overtimeCap === 30 && lb.map.beasts === 3 &&
    lb.map.draft.lode === 2 && lb.map.draft.beast === 3 && lb.holdGrace === 6,
    J({ win: lb.win, beasts: lb.map.beasts, draft: lb.map.draft, holdGrace: lb.holdGrace }));
  const lt = G.gameModeFor({ rule: 'training', game: 'lode' });
  ck('M8 lode + training：1000 分 / 600s / 无兽 / 兽不给三选一 / AI 最弱',
    lt.win.target === 1000 && lt.win.timeCap === 600 && lt.map.beasts === 0 && lt.map.draft.beast === 0 && lt.aiLevel === 0, J(lt.map) + ' ai=' + lt.aiLevel);
  ck('M8 lode 未知规则回 ranked（合并的是 ranked 那份数）', G.gameModeFor({ rule: 'nope', game: 'lode' }).win.target === 100);
  const d = G.gameModeFor({ game: 'deathmatch' });
  ck('M8 deathmatch 默认 target=10 / kill=1 / 矿不给分 / 无兽 / 无三选一 / timeCap=480',
    d.win.target === 10 && d.win.type === 'score' && d.score.kill === 1 && d.score.lodePointsPerTick === 0 &&
    d.map.beasts === 0 && d.map.draft.lode === 0 && d.map.draft.beast === 0 && d.win.timeCap === 480, J(d.win) + ' ' + J(d.score));
  const d0 = G.gameModeFor({ game: { id: 'deathmatch', target: 0 } });
  ck('M8 target=0 → win.type=never（不限分）', d0.win.target === 0 && d0.win.type === 'never', J(d0.win));
  const d5 = G.gameModeFor({ game: { id: 'deathmatch', target: 5 } });
  ck('M8 target=5 覆盖只打在 deathmatch 上（不污染表）', d5.win.target === 5 && G.gameModeFor({ game: 'deathmatch' }).win.target === 10, '覆盖后=' + d5.win.target);
  const opts = G.modeMatchOpts(d0, G.rulePresetFor({ rule: 'ranked' }));
  ck('M8 modeMatchOpts：不限分时给一个到不了的分数线（1e9）而 rules 的 100 不许漏进来',
    opts.scoreWin === 1e9, 'scoreWin=' + opts.scoreWin);
  const opts2 = G.modeMatchOpts(G.gameModeFor({ game: { id: 'deathmatch', target: 5 } }), G.rulePresetFor({ rule: 'ranked' }));
  ck('M8 modeMatchOpts 七个字段齐（beasts/draft 取玩法，aiLevel 仍取规则）',
    opts2.scoreWin === 5 && opts2.beasts === 0 && opts2.draftCapLode === 0 && opts2.draftCapBeast === 0 && opts2.aiLevel === 1 && opts2.timeCap === 480 && opts2.overtimeCap === 45, J(opts2));
  ck('M8 表本身没被任何一次解析改过（返回的是拷贝）',
    G.GAME_MODES.deathmatch.win.target === 10 && G.GAME_MODES.deathmatch.display.rows.join(',') === 'kills,deaths,score',
    G.GAME_MODES.deathmatch.display.rows.join(','));
}

/* ---------- M9 同输入 → 同输出 ---------- */
{
  function scripted(seed) {
    const m = mkMatch({ game: { id: 'deathmatch', target: 0, timeCap: 120 } }, { seed: seed });
    killOnce(m, 0, 1); run(m, 4); killOnce(m, 1, 0); run(m, 7); killOnce(m, 0, 1); run(m, 20);
    return { snap: m.director.snapshot(), spec: m.director.displaySpec() };
  }
  const a1 = scripted(4242), a2 = scripted(4242), b1 = scripted(9999);
  ck('M9 同一串事件喂两个 director → snapshot 逐字段相同（无随机）', J(a1.snap) === J(a2.snap), J(a1.snap));
  ck('M9 同一串事件 → displaySpec 也逐字段相同（时间读数不吃墙上时钟）', J(a1.spec) === J(a2.spec), J(a1.spec.rows));
  ck('M9 换 seed 也还确定（两个夹具各自内部一致）', J(b1.snap) === J(scripted(9999).snap), J(b1.snap.kills));
}

/* ---------- M10 静态：分层与接线 ---------- */
{
  /* 剥注释：项目惯例是注释里写中文，字面量里不许有（同 layer_check 的 scrub 口径） */
  function strip(src) {
    let out = '', i = 0, st = 'code';
    while (i < src.length) {
      const c = src.charAt(i), d = src.charAt(i + 1);
      if (st === 'code') {
        if (c === '/' && d === '/') { st = 'line'; out += '  '; i += 2; continue; }
        if (c === '/' && d === '*') { st = 'block'; out += '  '; i += 2; continue; }
        if (c === "'" || c === '"') { st = c === "'" ? 'sq' : 'dq'; out += c; i++; continue; }
        out += c; i++; continue;
      }
      if (st === 'line') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '\n') st = 'code'; continue; }
      if (st === 'block') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '*' && d === '/') { out += ' '; i++; st = 'code'; } continue; }
      const q = (st === 'sq') ? "'" : '"';
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === q) { st = 'code'; out += c; i++; continue; }
      if (c === '\n') { st = 'code'; out += '\n'; i++; continue; }
      out += '\u0001'; i++; continue;
    }
    return out;
  }
  /* 只剥注释、保留字符串：M10 的"零中文字面量"要用这一份（上面那份把字符串内容
     换成占位符，中文藏在里面就查不出来了——两种口径各管各的，别互相替）。
     模板串（反引号）本项目源码里没有，按普通字符处理即可。 */
  function stripComments(src) {
    let out = '', i = 0, st = 'code';
    while (i < src.length) {
      const c = src.charAt(i), d = src.charAt(i + 1);
      if (st === 'code') {
        if (c === '/' && d === '/') { st = 'line'; out += '  '; i += 2; continue; }
        if (c === '/' && d === '*') { st = 'block'; out += '  '; i += 2; continue; }
        if (c === "'" || c === '"') { st = c === "'" ? 'sq' : 'dq'; }
        out += c; i++; continue;
      }
      if (st === 'line') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '\n') st = 'code'; continue; }
      if (st === 'block') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '*' && d === '/') { out += ' '; i++; st = 'code'; } continue; }
      const q = (st === 'sq') ? "'" : '"';
      if (c === '\\') { out += c + src.charAt(i + 1); i += 2; continue; }
      out += c; i++;
      if (c === q) st = 'code';
    }
    return out;
  }
  const FILES = ['src/app/game-modes.js', 'src/app/match-director.js'];
  FILES.forEach(function (f) {
    const src = read(f), clean = strip(src), noComment = stripComments(src);
    ck(f + '：零 document. / 零 THREE', !/\bdocument\.|\bTHREE\b|innerHTML|querySelector|createElement/.test(clean));
    ck(f + '：零中文字面量（注释里的中文不算）', !/[\u4e00-\u9fa5]/.test(noComment), (noComment.match(/[\u4e00-\u9fa5]+/) || [''])[0]);
    ck(f + '：不反向抓 HUD / 主循环', !/window\.GWAPP|G\.HUD|GW\.HUD|G\.Creative\./.test(clean));
  });
  const html = read('index.html');
  ck('index.html 挂了 game-modes.js 与 match-director.js（双击那条路也要有玩法表）',
    /<script src="src\/app\/game-modes\.js"><\/script>/.test(html) && /<script src="src\/app\/match-director\.js"><\/script>/.test(html));
  ck('game-modes 排在 rule-presets 之后（lode 要读它）、两个脚本都排在 session 之前',
    html.indexOf('src/app/rule-presets.js') < html.indexOf('src/app/game-modes.js') &&
    html.indexOf('src/app/match-director.js') < html.indexOf('src/app/session.js') &&
    html.indexOf('src/systems/scoreboard.js') < html.indexOf('src/app/match-director.js'), '顺序见 index.html');
  const sess = read('src/app/session.js');
  ck('session.buildMatch 走同一条展开路（gameModeFor + modeMatchOpts + MatchDirector.create + begin）',
    /gameModeFor\(cfg\)/.test(sess) && /modeMatchOpts\(mode,\s*rpBase\)/.test(sess) &&
    /G\.MatchDirector\.create\(mode,\s*S\.match\)/.test(sess) && /director\.begin\(\)/.test(sess) &&
    /S\.match\.modeCfg = mode/.test(sess), '缺一条就是装配层忘了接线');
  const bt = read('src/battle.js');
  ck('battle 只留三个钩子（onKill / director.tick / lodePoints 不在 battle 里）',
    /if \(this\.director\) this\.director\.onKill\(src\.side, p\.side\); else this\.addScore\(src, 15\);/.test(bt) &&
    /if \(this\.director\) \{ this\.director\.tick\(dt\); return; \}/.test(bt) &&
    /this\.director = null;/.test(bt) && !/lodePoints/.test(bt), '三个钩子齐');
  ck('lode-system 产分问 director（pts=0 就不加分，素材那条不动）',
    /m\.director \? m\.director\.lodePoints\(\) : 1/.test(read('src/lode-system.js')) &&
    /if \(pts !== 0\) m\.addScore\(ps\[owner\], pts\)/.test(read('src/lode-system.js')));
  const vm = read('src/ui/viewmodel.js');
  ck('viewmodel 递出 vm.board（只读 displaySpec，不判几杀算赢）',
    /vm\.board = .*displaySpec\(\)/.test(vm) && !/scoreWin|win\.target/.test(vm));
  const panels = read('src/ui/panels.js');
  ck('panels 的 Topbar 有 .ui-top-board 且按 vm.board.rows 渲染（不写死行）',
    /ui-top-board/.test(panels) && /vm\.board && ctx\.vm\.board\.rows|ctx\.vm\.board\.rows/.test(panels));
  ck('panels 里没有硬编码的比分行名（行名只能来自 H.TEXT.board）', !/'比分'/.test(panels) && !/'击杀'/.test(panels));
  const css = read('src/ui/theme.css');
  ['.ui-top-board', '.ui-board-rows', '.ui-board-chips', '.ui-board-row', '.ui-board-chip', '.ui-board-k', '.ui-board-v'].forEach(function (c) {
    ck('theme.css 有 ' + c, css.indexOf(c) >= 0);
  });
}



/* ---------- M11 真页面：显示也按编排类走（这一段抓出过两处只有截图才看得见的问题）----------
   ① chip 对所有玩法都写「杀」→ lode 那局显示成「目标 100 杀」，与 GAMEPLAY 定案的 100 分不是一件事；
   ② 积分榜与老的比分块并排 → 同一个「比分 0/0」在顶栏出现两遍（倒计时也曾出现两遍，同一条病）。
   playwright 不可用时打 SKIP 不判死（与 ui_check 同一条口径），但 node 段照跑。 */
function loadPW() {
  const { createRequire } = require("module");
  const cands = ["playwright", "playwright-core",
    "$(npm root -g)/playwright",
    "$(npm root -g)/playwright-core"];
  for (const x of cands) { try { return createRequire(__filename)(x); } catch (e) { } }
  return null;
}
async function browserChecks() {
  const PW = loadPW();
  if (!PW) { console.log("SKIP M11 真页面：找不到 playwright（静态与 node 段已跑）"); return; }
  const http = require("http");
  const MIME = { ".html": "text/html", ".js": "text/javascript",
    ".css": "text/css", ".png": "image/png",
    ".ttf": "font/ttf", ".woff2": "font/woff2", ".json": "application/json" };
  const srv = http.createServer(function (req, res) {
    let p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (p.slice(-1) === "/") p += "index.html";
    fs.readFile(p, function (e, buf) { if (e) { res.writeHead(404); res.end("x"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream",
        "Cache-Control": "no-store" }); res.end(buf); });
  });
  await new Promise(function (r) { srv.listen(0, r); });
  const port = srv.address().port;
  const browser = await PW.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = []; page.on("pageerror", function (e) { errs.push(String(e)); });
  await page.goto("http://127.0.0.1:" + port + "/index.html");
  await page.waitForTimeout(1200);
  await page.evaluate(function () { window.GW.HUD.showLevel(); });
  await page.waitForTimeout(300);
  const games = await page.evaluate(function () { return Array.from(document.querySelectorAll("#level [data-field=game]")).map(function (e) { return e.getAttribute("data-key"); }); });
  ck('M11 选关长出玩法栏两张卡（来自 G.GAME_MODES 的 key）', games.length === 2, games.join(','));
  const rulesBefore = await page.evaluate(function () { const e = document.querySelector("#levelRules"); const r = e && e.getBoundingClientRect(); return !!(r && r.width > 0 && r.height > 0); });
  await page.click('#level [data-field=game][data-key="deathmatch"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(function () {
    const L2 = window.GW.UI.app.model.level;
    const box = function (sel) { const e = document.querySelector(sel); const r = e && e.getBoundingClientRect(); return !!(r && r.width > 0 && r.height > 0); };
    return { game: L2.game, targetVal: L2.gameTarget, rules: box("#levelRules"), tgt: box("#levelGameTarget"),
      keys: Array.from(document.querySelectorAll("#level [data-field=gameTarget]")).map(function (e) { return e.getAttribute("data-key"); }) };
  });
  ck('M11 选 deathmatch：规则栏收起、胜分行长出（两个轴互斥出现）', rulesBefore === true && after.rules === false && after.tgt === true && after.game === 'deathmatch', after.game + '/' + after.rules + '/' + after.tgt);
  ck('M11 胜分三档 = 5 / 10 / 不限（0 = 不限那条也在）', after.keys.join(',') === '5,10,0', after.keys.join(','));
  await page.click('#level [data-field=gameTarget][data-key="5"]');
  await page.waitForTimeout(200);
  await page.click("#btnLevelStart");
  await page.waitForTimeout(900);
  const st = await page.evaluate(function () { const m = window.GWAPP.match; return {
    id: m.modeCfg && m.modeCfg.id, target: m.scoreWin, kill: m.director && m.director.mode.score.kill,
    phase: m.director && m.director.phase, delegates: m.director && m.director.delegate,
    gameTarget: window.GW.UI.app.model.level.gameTarget }; });
  ck('M11 开局按选中的玩法建局（scoreWin=5、kill=1、phase=live、不委托 Scoreboard）', st.id === 'deathmatch' && st.target === 5 && st.kill === 1 && st.phase === 'live' && st.delegates === false && st.gameTarget === 5, JSON.stringify(st));
  const board = await page.evaluate(function () { const el = document.querySelector("#ui-board"); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { vis: r.width > 0 && r.height > 0, rows: Array.from(el.querySelectorAll(".ui-board-row")).map(function (x) { return x.textContent; }),
      chips: Array.from(el.querySelectorAll(".ui-board-chip")).map(function (x) { return x.textContent; }) }; });
  ck('M11 顶栏长出积分榜（.ui-top-board 可见）', !!board && board.vis, JSON.stringify(board));
  ck('M11 行序与行名跟着 displaySpec（击杀 / 死亡 / 比分，中文来自 H.TEXT.board）', !!board && board.rows.length === 3 && board.rows[0].indexOf('击杀') === 0 && board.rows[1].indexOf('死亡') === 0 && board.rows[2].indexOf('比分') === 0, JSON.stringify(board && board.rows));
  ck('M11 chip 说「目标 5 杀」（量词由玩法给，不再对所有玩法写「杀」）', !!board && board.chips.join('|').indexOf('目标') >= 0 && board.chips.join('|').indexOf('5 杀') >= 0, JSON.stringify(board && board.chips));
  await page.evaluate(function () { const m = window.GWAPP.match; m.over = null; m.director.phase = "live";
    const v = m.players[1], k = m.players[0]; v.dead = false; v.alive = true; v.hp = v.maxHp; m.kill(v, k, {}); });
  await page.waitForTimeout(220);
  const board2 = await page.evaluate(function () { const el = document.querySelector("#ui-board");
    return Array.from(el.querySelectorAll(".ui-board-row")).map(function (x) { return x.textContent.replace(/[^0-9\/]/g, ""); }); });
  ck('M11 一次击杀后三个数一起动（击杀 1/0、死亡 0/1、比分 1/0）', board2.join(',') === '1/0,0/1,1/0', board2.join(' | '));
  await page.evaluate(function () { const m = window.GWAPP.match; for (let i = 0; i < 4; i++) { const v = m.players[1], k = m.players[0]; v.dead = false; v.alive = true; v.hp = v.maxHp; m.kill(v, k, {}); } });
  await page.waitForTimeout(1300);
  const fin = await page.evaluate(function () { const m = window.GWAPP.match; const kv = document.getElementById("resKv");
    return { over: m.over && { w: m.over.winner, r: m.over.winReason }, phase: m.director.phase,
      rows: kv ? Array.from(kv.querySelectorAll(".ui-kv-row")).map(function (r) { return r.textContent; }) : [] }; });
  ck('M11 第 5 杀触发终局（winner=0 / reason=score / director.phase=ended）', !!fin.over && fin.over.w === 0 && fin.over.r === 'score' && fin.phase === 'ended', JSON.stringify(fin.over) + ' phase=' + fin.phase);
  ck('M11 结算补出击杀/死亡两行（数据来自 director.snapshot）', fin.rows.some(function (r) { return r.indexOf('P1 击杀/死亡') === 0 && r.indexOf('5 / 0') > 0; }) && fin.rows.some(function (r) { return r.indexOf('P2 击杀/死亡') === 0 && r.indexOf('0 / 5') > 0; }), fin.rows.filter(function (r) { return r.indexOf('击杀') >= 0; }).join(' | '));
  ck('M11 终局原因与关卡行都按玩法说话（先到击杀数 / 死亡竞赛，不是 lode 的那两句）', fin.rows.some(function (r) { return r.indexOf('胜负原因') === 0 && r.indexOf('先到击杀数') > 0; }) && fin.rows.some(function (r) { return r.indexOf('关卡') === 0 && r.indexOf('死亡竞赛') > 0 && r.indexOf('以太争锋') < 0; }), fin.rows.filter(function (r) { return r.indexOf('胜负原因') === 0 || r.indexOf('关卡') === 0; }).join(' | '));
  /* ---- 换玩法验编排：同一份面板代码再开一局 lode ---- */
  /* 再开一局 lode：同一份面板代码，chip 的量词必须换成「分」——这是"显示可编排"的另一半证据 */
  await page.evaluate(function () { window.__GW_START({ mode: "train", seed: "490706", deck: "starter", game: { id: "lode" } }); });
  await page.waitForTimeout(900);
  const lodeChip = await page.evaluate(function () { const el = document.querySelector("#ui-board .ui-board-chip"); return el ? el.textContent : ""; });
  const lodeRowKeys = await page.evaluate(function () { return Array.from(document.querySelectorAll("#ui-board .ui-board-row .ui-board-k")).map(function (x) { return x.textContent.trim(); }); });
  ck('M11 lode 那局 chip 说「目标 100 分」（量词随玩法变，不许对所有玩法写「杀」）',
    lodeChip.indexOf('目标') >= 0 && lodeChip.indexOf('100 分') >= 0 && lodeChip.indexOf('杀') < 0, lodeChip);
  ck('M11 换玩法就换行序：lode 是 比分/击杀/死亡（deathmatch 那局是击杀/死亡/比分）',
    lodeRowKeys.join(',') === '比分,击杀,死亡', lodeRowKeys.join('/'));
  ck('M11 真页面零异常', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close(); srv.close();
}


browserChecks().then(function () {
  console.log('\n共 ' + n + ' 条，失败 ' + bad);
  process.exit(bad ? 1 : 0);
}).catch(function (err) {
  bad++;
  console.log('FAIL M11 真页面段起不来（浏览器或静态服务没起来）：' + ((err && err.stack) || String(err)));
  console.log('\n共 ' + n + ' 条，失败 ' + bad + '（含 M11 一条崩掉）');
  process.exit(1);
});
