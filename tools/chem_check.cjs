#!/usr/bin/env node
/* tools/chem_check.cjs · 方块间元素交互（GW.CHEM）的回归（不参与游戏运行）

   为什么必须有它：用户 2026-10-16 的要求是"火扔到树上就该烧掉、冰就该化掉"，
   并且**要性能友好**。这两条都属于"截图看不出来、手玩又不稳定"的那类：
     - 反应对不对：要逐格看方块最后变成了什么，不能靠"看起来有火"；
     - 性能好不好：要证明"没有火的时候一格都不查"（整图扫描的回归会伪装成正常帧率），
       以及"着一整片林子的时候每 tick 有硬预算"（否则就是偶尔一次 20ms 长帧）。
   所以这里在 node 里直接开世界、摆方块、跑权威 tick，量的是最终格子状态与统计数字，不碰 GL。

       node tools/chem_check.cjs [seed]
   全过退出码 0；任何一条红，退出码 1 并打出用例名。
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0, group = '';
function groupOf(n) { group = n; console.log('\n\u2500\u2500 ' + n); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2190 ' + extra : '')); }
}

global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js'].forEach(f => require(path.join(ROOT, f)));
const G = global.window.GW, B = G.BLOCK, C = G.CHEM;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const SIZE = [40, 26, 40];                                   // 比正式世界小一个量级：跑得快，但激活队列逻辑一模一样
const STEP = 1 / 20;

/* ---------- 干净的一场对局：石头地坪，两个玩家各自站在角落 ---------- */
/* 每次 new Match 都会 C.bind → stats 归零，所以"哪些反应跑过"必须自己累计下来。
   不然最后一条"反应表全覆盖"读到的只有最后一个场景。 */
const SEEN = {};
function harvest() { const b = C.stats.byId; for (const k in b) SEEN[k] = (SEEN[k] || 0) + b[k]; }
function makeMatch(seed) {
  harvest();
  const w = new G.World({ size: SIZE, seed: seed >>> 0, sea: 6 });
  for (let z = 0; z < SIZE[2]; z++) for (let x = 0; x < SIZE[0]; x++) {
    for (let y = 0; y <= 2; y++) w.blocks[w.idx(x, y, z)] = y === 0 ? B.BEDROCK : B.STONE;
  }
  const events = [];
  if (G.VFX) G.VFX.on('react', d => events.push(d.kind));
  const fxCall = function () {};
  const fx = { log: fxCall, sfx: fxCall, burst: fxCall, dust: fxCall, hit: fxCall, heal: fxCall,
               shieldUp: fxCall, fire: fxCall, float: fxCall, ambient: fxCall, chemLog: (k) => events.push('log:' + k) };
  const m = new G.Match({ world: w, seed: seed >>> 0, mode: 'train', players: 2, fx: fx });
  // 把两个人挪到地坪上（spawnPoint 在这张平地上会挑到草台之外），别让他们站在实验区里
  m.players.forEach((p, i) => { p.pos.set(i === 0 ? 4.5 : SIZE[0] - 4.5, 3.9, 4.5); p.vel.set(0, 0, 0); });
  return { w, m, events };
}
function run(m, ticks) { for (let i = 0; i < ticks; i++) m.step(STEP, [{}, {}]); }
/* 中间态观察：冰被烤化先成水，而水紧挨着岩浆/火又会被抽干——"最后不见了"确实是对的，
   但断言必须看"有没有真的成过水"，不然测试会把"根本没化"读成通过。 */
function became(m, w, x, y, z, want, maxTicks) {
  for (let i = 0; i < maxTicks; i++) { if (w.get(x, y, z) === want) return i; m.step(STEP, [{}, {}]); }
  return -1;
}

/* ---------- 1. 接线与责任 ---------- */
groupOf('1. 接线：反应只在 GW.CHEM 里算，别处不许自己写 burning 标记');
ok('world.js 暴露 WORLD_HOOKS.onSet，chem 注册了唤醒钩子',
  Array.isArray(G.WORLD_HOOKS.onSet) && G.WORLD_HOOKS.onSet.length >= 1);
const FS = require('fs');
const FX_DIR = path.join(ROOT, 'src/rules/effects');
const rulesSrc = FS.readFileSync(path.join(ROOT, 'src/rules.js'), 'utf8') +
  '\n' + FS.readdirSync(FX_DIR).map(function (f) { return FS.readFileSync(path.join(FX_DIR, f), 'utf8'); }).join('\n');
const battleSrc = ['src/battle.js', 'src/systems/projectile.js', 'src/systems/sigil.js']
  .map(function (f) { return require('fs').readFileSync(path.join(ROOT, f), 'utf8'); }).join('\n');
ok('rules.js 的 ignite 走 CHEM 催化剂', /G\.CHEM\.catalyst\('heat'/.test(rulesSrc));
ok('rules.js 里没有第二套燃烧蔓延（整张 meta 扫描已删）', !/val\.kind !== 'burning'/.test(rulesSrc));
ok('战斗层抛射物与法阵都通过 chemCatalyst 报元素', /chemCatalyst\(pr\.kind/.test(battleSrc) && /G\.chemCatalyst\(s\.preset\.kind/.test(battleSrc));
ok('战斗层里不再残留"抛射物自己写 burning 标记"的旧写法', !/kind: 'burning', born: this\.time, dur: 3/.test(battleSrc));
/* 中文文案这件事交给 tools/layer_check.cjs（它会先剥注释再查，注释里的中文不算）。
   这里只查更硬的一条：物质层不许反过来抓 UI —— 它只许调 fx.chemLog 报 key。 */
/* 剥掉头注释再查（文件头的说明里本来就写着"H.TEXT.chem"这个词，那不是越界） */
const chemBody = require('fs').readFileSync(path.join(ROOT, 'src/chem.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
ok('CHEM 不碰 UI（正文里不出现 H.TEXT / H.log / H.toast / GWAPP）',
  !/H\.TEXT|H\.log\(|H\.toast|window\.GWAPP/.test(chemBody));
// 场景里数格子用的辅助：以 (X,Z) 为中心 5×5 范围数某种方块
function countOf(w, X, Z, id) {
  let n2 = 0;
  for (let a = -3; a <= 3; a++) for (let c2 = -3; c2 <= 3; c2++) for (let y = 3; y < 12; y++) {
    if (w.get(X + a, y, Z + c2) === id) n2++;
  }
  return n2;
}

/* ---------- 2. 一条条反应 ---------- */
groupOf('2. 元素反应（逐格核最终方块，不看特效）');

// ① 火扔到树上：叶与木整棵烧穿，最后烧完的那格变空气
{
  const { w, m } = makeMatch(SEED);
  const X = 20, Z = 20, base = 3;
  for (let i = 0; i < 4; i++) w.set(X, base + i, Z, B.LOG);
  for (let dy = 3; dy <= 5; dy++) for (let a = -1; a <= 1; a++) for (let c2 = -1; c2 <= 1; c2++) w.set(X + a, base + dy, Z + c2, B.LEAF);
  const before = countOf(w, X, Z, B.LEAF) + countOf(w, X, Z, B.LOG);
  G.CHEM.catalyst('heat', X, base + 4, Z, 2);
  ok('点火后确实有格进入燃烧状态', G.CHEM.countBurning() > 0, 'burning=' + G.CHEM.countBurning());
  run(m, 400);                                              // 20s：叶子 1.7s、原木 4.6s，够烧完
  const after = countOf(w, X, Z, B.LEAF) + countOf(w, X, Z, B.LOG);
  ok('整棵树烧穿（' + before + ' → ' + after + ' 格可燃物）', after === 0);
  ok('火烧完不再留下 burning 标记', G.CHEM.countBurning() === 0);
  ok('蔓延与成灰两条都跑过', (C.stats.byId.spread || 0) > 0 && (C.stats.byId.burnout || 0) > 0, JSON.stringify(C.stats.byId));
}

// ② 水浇在火上：火灭、那格水被抽干（一桶水浇不灭山火）
{
  const { w, m, events } = makeMatch(SEED + 1);
  const X = 20, Y = 3, Z = 20;
  for (let a = 0; a < 3; a++) w.set(X + a, Y, Z, B.PLANK);                 // 一排木板
  G.CHEM.ignite(X, Y, Z);
  w.set(X, Y, Z + 1, B.WATER);                              // 正相邻的一格水（对角够不着，物理上就不该灭）
  /* 逐 tick 抓"被扑灭过"：旁边还有燃料时火会重新烧回来（那是蔓延该有的样子），
     所以只能断言"确实灭过一次、并且方块还在"，不能断言"第 40 tick 仍然是黑的"。 */
  let dousedAt = -1;
  for (let i = 0; i < 40; i++) {
    if (!G.CHEM.isBurning(X, Y, Z) && w.get(X, Y, Z) === B.PLANK) { dousedAt = i; break; }
    m.step(STEP, [{}, {}]);
  }
  ok('被水正对着的那格火熄灭过（第 ' + dousedAt + ' tick，木头本身保住了）', dousedAt >= 0);
  ok('用水灭火要消耗那一格水（不是无限灭火）', w.get(X, Y, Z + 1) === B.AIR, 'water=' + w.get(X, Y, Z + 1));
  ok('报了 steam 事件给渲染层', events.indexOf('steam') >= 0, events.slice(0, 6).join(','));
  let still = 0;
  for (let a = 0; a < 3; a++) if (G.CHEM.isBurning(X + a, Y, Z)) still++;
  ok('离水两格的火还在烧（灭火不是把整片区域一键清空）', still > 0, 'still=' + still);
}

// ③ 岩浆遇水：凝成黑曜石 + 水被抽干
{
  const { w, m } = makeMatch(SEED + 2);
  const X = 20, Y = 3, Z = 20;
  w.set(X, Y, Z, B.LAVA); w.set(X + 1, Y, Z, B.WATER);
  run(m, 40);
  ok('岩浆被水凝成黑曜石', w.get(X, Y, Z) === B.OBSIDIAN, 'got=' + w.get(X, Y, Z));
  ok('水那一格没了（蒸汽）', w.get(X + 1, Y, Z) === B.AIR, 'got=' + w.get(X + 1, Y, Z));
}

// ④ 冰被烤化：岩浆边的冰 → 水；雪同理
{
  const { w, m } = makeMatch(SEED + 3);
  const X = 20, Y = 3, Z = 20;
  w.set(X, Y, Z, B.ICE); w.set(X + 1, Y, Z, B.LAVA);
  G.CHEM.ignite(X, Y, Z + 5);
  /* 冰化出来的水紧挨岩浆会被立刻凝走、紧挨火会被浇灭——所以要逐 tick 抓"成过水"这一刻，
     再看最后水把火浇灭 / 被岩浆凝走的两条后续（都是理所当然的连锁）。 */
  const tIce = became(m, w, X, Y, Z, B.WATER, 200);
  ok('岩浆旁的冰化成过水（第 ' + tIce + ' tick）', tIce >= 0, 't=' + tIce + ' last=' + w.get(X, Y, Z));
  run(m, 60);                                                // 化出来的水要再等一拍才被岩浆收走
  ok('那格水随后被岩浆凝走，岩浆同时成黑曜石',
    w.get(X + 1, Y, Z) === B.OBSIDIAN && w.get(X, Y, Z) === B.AIR, 'lava=' + w.get(X + 1, Y, Z) + ' water=' + w.get(X, Y, Z));
  ok('熔这条反应被跑到（heat_melt / self_melt 任一）',
    (C.stats.byId.heat_melt || 0) + (C.stats.byId.self_melt || 0) > 0, JSON.stringify(C.stats.byId));
}
// ④b 雪被火烤化（单独一场：化出来的水会被旁边的火浇灭并抽干，混在一起就抓不到中间态）
{
  const { w, m } = makeMatch(SEED + 23);
  const X = 20, Y = 3, Z = 24;
  w.set(X, Y, Z, B.SNOW); w.set(X, Y, Z + 1, B.PLANK);
  G.CHEM.ignite(X, Y, Z + 1);
  const tSnow = became(m, w, X, Y, Z, B.WATER, 200);
  ok('火旁的雪化成过水（第 ' + tSnow + ' tick）', tSnow >= 0, 't=' + tSnow + ' last=' + w.get(X, Y, Z));
}

// ⑤ 水遇寒冻结：冰卡那一路（catalyst cold）把水面冻住
{
  const { w, m } = makeMatch(SEED + 4);
  const X = 20, Y = 3, Z = 20;
  for (let a = -1; a <= 1; a++) for (let c2 = -1; c2 <= 1; c2++) w.set(X + a, Y, Z + c2, B.WATER);
  const made = G.CHEM.catalyst('cold', X, Y, Z, 1);
  ok('寒霜催化剂一次冻住 5 格水面（曼哈顿球）', made >= 4, 'made=' + made);
  ok('冻出来的确实是 ICE 方块', w.get(X, Y, Z) === B.ICE, 'got=' + w.get(X, Y, Z));
}

// ⑤b 环境热源 / 环境寒源：岩浆把旁边的木头慢慢烤着、冰墙把旁边的水面慢慢冻住
{
  const { w, m } = makeMatch(SEED + 21);
  const X = 20, Y = 3, Z = 20;
  w.set(X, Y, Z, B.LAVA);
  for (let a = 1; a <= 2; a++) w.set(X + a, Y, Z, B.PLANK);
  G.CHEM.warm(X, Y, Z, 1);                                   // 只"报一处热源"，不直接点火
  ok('报了环境热源之后、跑 tick 之前不会瞬间着火（环境效应要慢慢来）',
    !G.CHEM.isBurning(X + 1, Y, Z) && !G.CHEM.isBurning(X + 2, Y, Z));
  /* 岩浆的引燃概率是平衡参数（默认 0.22/轮），回归要验的是"这条链通不通"，
     所以这里把概率钉死成 1；默认概率下的手感留给实战与 hit_check 的 DPS 区间去管。 */
  const p0 = C.CFG.lavaIgnite; C.CFG.lavaIgnite = 1;
  let litAt = -1;
  for (let i = 0; i < 40; i++) { if (G.CHEM.isBurning(X + 1, Y, Z)) { litAt = i; break; } m.step(STEP, [{}, {}]); }
  C.CFG.lavaIgnite = p0;
  ok('岩浆旁边的木头最终被烤着（概率钉成 1 后第 ' + litAt + ' tick 起燃）', litAt >= 0, 'litAt=' + litAt);
  ok('默认引燃概率仍是平衡档 ' + p0 + '（回归不许偷改手感参数）', C.CFG.lavaIgnite === p0);
  const { w: w2, m: m2 } = makeMatch(SEED + 22);
  for (let a = 0; a < 3; a++) for (let c2 = 0; c2 < 3; c2++) w2.set(20 + a, 3, 20 + c2, B.WATER);
  w2.set(20, 3, 20, B.ICE);                                  // 一堵冰墙立在水边（冰墙卡就是这个形状）
  G.CHEM.chill(20, 3, 20, 1);
  let frozeAt = -1;
  for (let i = 0; i < 80; i++) { if (w2.get(21, 3, 20) === B.ICE) { frozeAt = i; break; } m2.step(STEP, [{}, {}]); }
  ok('冰墙旁边的水面自己冻住（第 ' + frozeAt + ' tick，走的是排队的 cat_freeze 而不是瞬发）', frozeAt >= 1, 'frozeAt=' + frozeAt);
}

// ⑥ 稳定方块免疫：石头/基岩旁边点火也不烧
{
  const { w, m } = makeMatch(SEED + 5);
  const X = 20, Y = 3, Z = 20;
  for (let a = -2; a <= 2; a++) for (let c2 = -2; c2 <= 2; c2++) w.set(X + a, Y, Z + c2, B.STONE);
  w.set(X, Y, Z, B.BEDROCK);
  G.CHEM.catalyst('heat', X, Y, Z, 2);
  run(m, 60);
  ok('石头与基岩点不着（DEFS.stable 起作用，不靠方块名硬判）', G.CHEM.countBurning() === 0);
}

// ⑦ 反应表覆盖：每条 REACT 都得被上面某条跑到
{
  harvest();
  const ids = C.REACT.map(r => r.id);
  const missing = ids.filter(id => !SEEN[id]);
  ok('反应表 ' + ids.length + ' 条全部被场景跑到', missing.length === 0, '未触发: ' + missing.join(','));
}

/* ---------- 3. 性能口径 ---------- */
groupOf('3. 性能：稳态零成本 + 火场硬预算');

// ⑧ 场上没有任何反应时，一 tick 都不该查格子
{
  const { m } = makeMatch(SEED + 6);
  C.stats.cells = 0;
  run(m, 200);
  ok('200 tick 稳态：激活队列一格都没查过（没有整图扫描）', C.stats.cells === 0, 'cells=' + C.stats.cells);
  ok('稳态没有任何改写', C.stats.edits === 0, 'edits=' + C.stats.edits);
}

// ⑨ 一大片木头同时点着：预算与熔断都必须在
{
  const { w, m } = makeMatch(SEED + 7);
  const N = Math.ceil((C.CFG.maxBurning + 60) / 3);
  for (let a = 0; a < 16; a++) for (let c2 = 0; c2 < 16; c2++) for (let y = 3; y < 3 + N / 85; y++) w.set(6 + a, y, 6 + c2, B.PLANK);
  /* 峰值只量这一场：maxMs 是全脚本累计的，进程启动/JIT 的首 tick 会污染它（实测首跑 10ms、复跑 0.3ms） */
  C.stats.maxMs = 0; C.stats.maxCells = 0; C.stats.maxEdits = 0;
  const t0 = performance.now();
  G.CHEM.catalyst('heat', 12, 4, 12, 5);
  run(m, 300);
  const ms = performance.now() - t0;
  ok('同时燃烧格数不超过熔断线 ' + C.CFG.maxBurning, C.countBurning() <= C.CFG.maxBurning, 'burning=' + C.countBurning());
  ok('单 tick 检查格数 ≤ cellsPerTick（' + C.CFG.cellsPerTick + '）', C.stats.maxCells <= C.CFG.cellsPerTick, 'max=' + C.stats.maxCells);
  ok('单 tick 改写格数 ≤ editsPerTick（' + C.CFG.editsPerTick + '）', C.stats.maxEdits <= C.CFG.editsPerTick, 'max=' + C.stats.maxEdits);
  ok('300 tick 大火场总耗时 ' + ms.toFixed(1) + 'ms（<120ms）', ms < 120, 'ms=' + ms.toFixed(1));
  ok('单 tick 峰值 ' + C.stats.maxMs.toFixed(2) + 'ms（<3ms，不制造长帧）', C.stats.maxMs < 3, 'maxMs=' + C.stats.maxMs);
  ok('求值过程零异常', C.stats.errors === 0, C.stats.lastError || '');
  // chunk 重建预算：main.js 每帧只 flush 2 块，脏标记爆表就说明模拟在拖着网格跑
  let maxDirty = 0;
  const { w: w2, m: m2 } = makeMatch(SEED + 8);
  for (let a = 0; a < 12; a++) for (let c2 = 0; c2 < 12; c2++) for (let y = 3; y < 6; y++) w2.set(6 + a, y, 6 + c2, B.LOG);
  G.CHEM.catalyst('heat', 11, 4, 11, 4);
  for (let i = 0; i < 200; i++) { m2.step(STEP, [{}, {}]); if (w2.dirty.size > maxDirty) maxDirty = w2.dirty.size; }
  /* 木场跨 4 个 chunk，水/冰改动又各带一格 → 个位数是 footprint 本身，
     真正要防的是"整图着火 → 脏表上千格"那种把 flushDirty 拖爆的情况。 */
  ok('一片木场着火时脏 chunk 峰值 ' + maxDirty + '（≤12，交给 flushDirty 2/帧消化）', maxDirty <= 12, 'maxDirty=' + maxDirty);
}

/* ---------- 4. 确定性 ---------- */
groupOf('4. 同种子重放逐格一致（将来联网同步的前提）');
function fingerprint(seed) {
  const { w, m } = makeMatch(seed);
  for (let i = 0; i < 4; i++) w.set(20, 3 + i, 20, B.LOG);
  for (let a = -1; a <= 1; a++) for (let c2 = -1; c2 <= 1; c2++) w.set(20 + a, 6, 20 + c2, B.LEAF);
  w.set(18, 3, 20, B.ICE); w.set(17, 3, 20, B.LAVA);
  G.CHEM.catalyst('heat', 20, 6, 20, 2);
  run(m, 240);
  return Buffer.from(w.blocks).toString('base64') + '|' + JSON.stringify(C.stats.byId);
}
{
  const a = fingerprint(SEED + 9), b = fingerprint(SEED + 9);
  ok('同一颗种子跑两遍，最终格子与反应计数逐字节一致', a === b);
  const c3 = fingerprint(SEED + 10);
  ok('换种子结果真的会变（不是写死剧本）', c3 !== a);
}

console.log(fail ? ('\n\u5316\u5b66\u5c42\u8fdd\u89c4 ' + fail + ' 条') : '\n\u7269\u8d28\u4ea4\u4e92\u56de\u5f52\u5168\u7eff');
console.log('  \u53c2\u8003\uff1aburning \u5cf0\u503c=' + C.stats.maxCells + '格/tick\uff0cedits=' + C.stats.maxEdits + '\u683c/tick\uff0c\u961f\u5217\u5cf0\u503c=' + C.stats.maxQueue);
process.exit(fail ? 1 : 0);
