#!/usr/bin/env node
/* tools/vfx_check.cjs · 特效计算层回归（不参与游戏运行）

   为什么单独一条命令：特效的「算」住在 src/vfx.js（纯计算）+ src/vfx-recipes.js（纯数据），
   「画」住在渲染层（main.js / shader.js，由另一条工作线在写）。
   两端要能各自改而不互相踩坏，就得有一条不依赖 GL、也不依赖页面的回归：
       node tools/vfx_check.cjs
   全过退出码 0；任何一条断言红，退出码 1 并打出用例名。

   覆盖：分层责任制（零 DOM / 零 THREE / 零玩家可见文案）、配方自检、参数夹紧、
   原子类覆盖率、确定性与可复现、时间轴相位与衰减单调、量纲（半径跟随实体、柱高不跟随）、
   anchor 归属、实体→默认配方、事件通道、性能上限、以及与 battle/rules 的接线仍在。
*/
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0, group = '';
function groupOf(n) { group = n; console.log('\n\u2500\u2500 ' + n); }
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2190 ' + extra : '')); }
}
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
/* 剥注释 + 字符串占位（和 layer_check 同口径，注释里的中文不算文案） */
function scrub(src) {
  let out = '', i = 0, st = 'code';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (st === 'code') {
      if (c === '/' && d === '/') { st = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { st = 'block'; out += '  '; i += 2; continue; }
      if (c === "'" || c === '"') { st = c === "'" ? 'sq' : 'dq'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === 'line') { out += (c === '\n' ? '\n' : ' '); if (c === '\n') st = 'code'; i++; continue; }
    if (st === 'block') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '*' && d === '/') { out += ' '; i++; st = 'code'; } continue; }
    const q = st === 'sq' ? "'" : '"';
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === q) { st = 'code'; out += c; i++; continue; }
    if (c === '\n') { st = 'code'; out += '\n'; i++; continue; }
    out += '\u0001'; i++;
  }
  return out;
}

/* ---------- 加载纯计算层（只依赖 window.GW，不需要 DOM/GL） ---------- */
global.window = {};
require(path.join(ROOT, 'src/vfx.js'));
require(path.join(ROOT, 'src/vfx-recipes.js'));
const G = global.window.GW;
const V = G.VFX;

groupOf('1. 分层责任制：特效计算层不许碰渲染与 UI');
['src/vfx.js', 'src/vfx-recipes.js'].forEach(f => {
  const clean = scrub(read(f));
  ok(f + ' 零 DOM', !/\bdocument\.|innerHTML|querySelector|createElement|addEventListener/.test(clean));
  ok(f + ' 零 THREE / 零 GL', !/\bTHREE\b|WebGL|ShaderMaterial|Mesh\(|BufferGeometry/.test(clean));
  ok(f + ' 零玩家可见中文字面量', !/[\u4e00-\u9fa5]/.test(clean));
  ok(f + ' 不读写世界与实体状态', !/world\.(set|get)\b|\.hp\s*=|\.vel\./.test(clean));
});
ok('vfx-recipes.js 只有数据：无分支、无循环、无随机（配方不许自己判断）', (function () {
  const clean = scrub(read('src/vfx-recipes.js'));
  const hits = ['for (', 'while (', 'Math.random', '?.', '&&'].filter(k => clean.indexOf(k) >= 0);
  /* 只准有一条加载守卫：if (!V) return; —— 其余分支都算数据文件在偷着判断 */
  const ifs = clean.split('if (').length - 1;
  if (ifs > 1 || (ifs === 1 && !/if \(!V\) return/.test(clean))) hits.push('if(' + ifs + ')');
  return hits.length === 0 ? true : (console.log('      \u53d1\u73b0: ' + hits.join(' , ')), false);
})());

groupOf('2. 原子类与配方自检');
const CLS = Object.keys(V.CLASSES);
ok('原子类数量 = ' + CLS.length + '（' + CLS.join('/') + '）', CLS.length >= 7);
const ids = Object.keys(V.RECIPES);
ok('配方数量 >= 20（实际 ' + ids.length + '）', ids.length >= 20);
const bad = V.validateAll();
ok('全部配方 validate 通过', bad.length === 0, bad.join(' ;; '));
const used = {};
ids.forEach(id => V.RECIPES[id].layers.forEach(l => { used[l.prim || (l.layers ? 'vortex' : 'ring')] = 1; }));
const unused = CLS.filter(c => !used[c]);
ok('每个原子类都至少被一条配方用到', unused.length === 0, '未被使用: ' + unused.join(','));

groupOf('3. 参数夹紧与坏数据（数据写错不许崩游戏）');
const w1 = [];
const n1 = V.normalize('ring', { r: 999, count: 2, spin: 40 }, w1, 't');
ok('越界被夹进边界', n1.r === 12 && n1.count === 3 && n1.spin === 6);
ok('夹紧留下 warning（可被机检打出）', w1.length === 3, w1.join('|'));
const w2 = [];
ok('未知原子类返回 null 且记错', V.normalize('nope', {}, w2, 't') === null && /unknown prim/.test(w2[0]));
const w3 = [];
const n3 = V.normalize('ring', { style: 'plasma' }, w3, 't');
ok('非法枚举回落到默认值', n3.style === 'dots' && /bad ring\.style/.test(w3[0]));
ok('坏色值不落进颜色字段', V.normalize('ring', { color: 'red' }, [], 't').color === null);
const empty = V.frame({}, 1, 0.016, {});
ok('查不到配方时返回空 layers 而不是抛', empty && empty.layers.length === 0 && empty.recipe === null);

groupOf('4. 确定性与可复现（同实体同时刻必须同答案）');
function snap(f) { return JSON.stringify(f.layers.map(l => [l.prim, +l.rot.toFixed(6), +l.alpha.toFixed(6), +l.radius.toFixed(6), l.color, l.style || null])); }
const ent = { kind: 'summon', uid: 77, born: 0, delay: 0.8, ttl: 6, radius: 3, preset: { kind: 'fire', fx: 'command_stack' } };
ok('同参数两次求值逐字段相同', snap(V.frame(ent, 3.2, 0.016, { recipe: 'command_stack' })) === snap(V.frame(ent, 3.2, 0.016, { recipe: 'command_stack' })));
ok('uid 改变 → 随机相位改变（flicker 不是一片雷同）', (() => {
  const a = V.frame(Object.assign({}, ent, { uid: 1 }), 2.0, 0.016, { recipe: 'dragon_halo' });
  const b = V.frame(Object.assign({}, ent, { uid: 2 }), 2.0, 0.016, { recipe: 'dragon_halo' });
  const fa = a.layers.filter(l => l.prim === 'pillar').map(l => l.alpha).join();
  const fb = b.layers.filter(l => l.prim === 'pillar').map(l => l.alpha).join();
  return fa !== fb || a.seed !== b.seed;
})());
const fr = V.frame(ent, 3.2, 0.016, { recipe: 'thunder_cage' });
ok('无 NaN 泄漏', !/NaN/.test(snap(fr)));

groupOf('5. 时间轴：idle 描线 → ignite → live → decay 淡出');
const sg = { uid: 5, born: 0, delay: 1.0, ttl: 6, radius: 3, preset: { kind: 'ice', fx: 'sigil_glacier' } };
const seq = [0.4, 1.1, 3.0, 6.5, 6.95].map(t => { const f = V.frame(sg, t, 0.016, { recipe: 'sigil_glacier' }); return { p: f.phase.name, a: f.layers[0].alpha }; });
ok('相位顺序正确', seq.map(s => s.p).join('>') === 'idle>ignite>live>decay>decay', seq.map(s => s.p).join('>'));
ok('idle 期 alpha 从 0 长起来（描线生长）', seq[0].a > 0.05 && seq[0].a < 0.6, 'alpha@0.4s=' + seq[0].a);
ok('live 期满不透明', seq[2].a > 0.99, 'alpha@3s=' + seq[2].a);
ok('decay 期 alpha 单调下降', seq[3].a > seq[4].a && seq[4].a < 0.05, seq[3].a + '→' + seq[4].a);
const rotLive = V.frame(sg, 3.0, 0.016, { recipe: 'sigil_glacier' }).layers[0].rot;
const rotLater = V.frame(sg, 3.5, 0.016, { recipe: 'sigil_glacier' }).layers[0].rot;
ok('稳定期在转（rot 随时间变化）', Math.abs(rotLater - rotLive) > 1e-6);
const decaySpin = (() => {
  const a = V.frame(sg, 6.5, 0.016, { recipe: 'sigil_glacier' }).layers[0].rot;
  const b = V.frame(sg, 7.0, 0.016, { recipe: 'sigil_glacier' }).layers[0].rot;
  const c = V.frame(sg, 3.0, 0.016, { recipe: 'sigil_glacier' }).layers[0].rot;
  const d = V.frame(sg, 3.5, 0.016, { recipe: 'sigil_glacier' }).layers[0].rot;
  return Math.abs(b - a) <= Math.abs(d - c) + 1e-9;   // 临期转速不高于稳定期
})();
ok('临期先减速再淡出', decaySpin);
ok('减速是连续积分，角度不倒跳（曾经写成 time×瞬时速度，一减速整圈回跳）', (() => {
  const at = t => V.frame({ uid: 5, born: 0, delay: 1, ttl: 6, radius: 3, preset: { fx: 'sigil_glacier' } }, t, 0.016, { recipe: 'sigil_glacier' }).layers[0].rot;
  const liveStep = Math.abs(at(3.5) - at(3.0));
  let worst = 0;
  for (let t = 6.0; t < 6.9; t += 0.1) worst = Math.max(worst, at(t + 0.1) - at(t));
  return worst <= liveStep * 1.15 && worst >= -1e-9;
})());

groupOf('6. 量纲：半径跟随实体，柱高不跟随');
const small = V.frame({ uid: 3, born: 0, delay: 0, ttl: 8, radius: 1.5, preset: { fx: 'thunder_cage' } }, 3, 0.016, { recipe: 'thunder_cage' });
const big = V.frame({ uid: 3, born: 0, delay: 0, ttl: 8, radius: 4.5, preset: { fx: 'thunder_cage' } }, 3, 0.016, { recipe: 'thunder_cage' });
ok('环半径随实体半径线性放大', Math.abs(big.layers[0].radius / small.layers[0].radius - 3) < 1e-6);
const ph1 = small.layers.find(l => l.prim === 'pillar').h, ph2 = big.layers.find(l => l.prim === 'pillar').h;
ok('竖向柱高用「格」，不随法阵大小长', ph1 === ph2, ph1 + ' vs ' + ph2);
const body = V.frame({ kind: 'summon', uid: 8, born: 0, delay: 0, ttl: 9 }, 1.5, 0.016, { recipe: 'summon_aura' });
ok('跟随体型配方标在 body 锚点', body.anchor === 'body');
ok('地面法阵配方标在 ground 锚点', V.frame(sg, 3, 0.016, { recipe: 'sigil_glacier' }).anchor === 'ground');

groupOf('7. 实体→默认配方（权威层不写死特效名）');
ok('抛射物拖尾查到 comet_trail', V.frameOf({ kind: 'projectile', uid: 1, born: 0, delay: 0, ttl: 1 }, 0.5, 0.016, 'trail').recipe === 'comet_trail');
ok('随从默认光环 → summon_aura', V.frameOf({ kind: 'summon', uid: 2, born: 0, delay: 0, ttl: 9 }, 1, 0.016).recipe === 'summon_aura');
ok('玩家脚下阵 → follow_star', V.frameOf({ kind: 'player', uid: 3, born: 0, delay: 0, ttl: 9 }, 1, 0.016).recipe === 'follow_star');
ok('按卡种查特效（summon 卡的 aura）', V.frameOf({ card: { type: 'summon' }, uid: 4, born: 0, delay: 0, ttl: 9 }, 1, 0.016, 'aura').recipe === 'summon_aura');
ok('法阵实体自带 fx 字段优先', V.frameOf({ preset: { fx: 'sigil_bloom' }, uid: 5, born: 0, delay: 0, ttl: 6, radius: 2.5 }, 1, 0.016).recipe === 'sigil_bloom');
const refs = [];
Object.keys(V.CARD_FX || {}).forEach(k => Object.keys(V.CARD_FX[k]).forEach(r2 => refs.push(V.CARD_FX[k][r2])));
Object.keys(V.PROJECTILE_FX || {}).forEach(k => refs.push(V.PROJECTILE_FX[k]));
Object.keys(V.ENTITY_FX || {}).forEach(k => refs.push(V.ENTITY_FX[k]));
const missing = refs.filter(x => x && !V.RECIPES[x]);
ok('绑定表里引用的配方都存在', missing.length === 0, missing.join(','));

groupOf('8. 事件通道：权威层只报 key');
let got = null;
V.on('cast', d => { got = d.tag; });
ok('有订阅时被投递', V.event('cast', { tag: 'x' }) === true && got === 'x');
ok('无订阅时安静返回 false', V.event('nobody-listens', {}) === false);
V.on('boom', () => { throw new Error('handler 故意炸'); });
let threw = false;
try { V.event('boom', {}); } catch (e) { threw = true; }
ok('订阅方抛错不许打断结算', threw === false);
V.off('boom'); V.off('cast');

groupOf('9. 性能：每帧现算要够便宜（真机 160FPS 的口径）');
const t0 = Date.now();
let sink = 0;
for (let i = 0; i < 6; i++) {
  const e2 = { kind: 'summon', uid: i, born: 0, delay: 0.5, ttl: 8, radius: 3, preset: { kind: 'void', fx: 'super_spell' } };
  for (let f = 0; f < 500; f++) sink += V.frame(e2, f / 60, 1 / 60, { recipe: 'super_spell' }).layers.length;
}
const ms = Date.now() - t0;
ok('3000 次 super_spell 求值 < 900ms（实际 ' + ms + 'ms，产出 ' + sink + ' 层）', ms < 900);

groupOf('10. 与权威层的接线仍在（渲染层归另一条工作线，不许把这里改绿就完事）');
const bt = read('src/battle.js') + '\n' + read('src/systems/sigil.js'), ru = read('src/rules.js'), cd = read('src/cards.js');
ok('battle 给了实体稳定 uid（特效种子的来源）', /function fxUid\(m\)/.test(bt) && /uid: fxUid\(this\)/.test(bt));
ok('battle 只在事件里报 key，不存视觉量', /function fxEv\(/.test(bt) && !/s\.rot\s*=|s\.alpha\s*=|\.spin\s*=/.test(bt));
ok('法阵三条生命周期事件已接（Go / Break / End）', /fxEv\('sigilGo'/.test(bt) && /fxEv\('sigilBreak'/.test(bt) && /fxEv\('sigilEnd'/.test(bt));
ok('出牌报 cast 事件', /G\.VFX\.event\('cast'/.test(ru));
groupOf('9. 编排出来的组合与绑定表（2026-10-16 新增配方的口径）');
require(path.join(ROOT, 'src/cards.js'));
const REC = V.RECIPES;
/* 法阵特效绑定：口径从"条数必须 = 6"改成"每一条都必须绑、且配方真的存在"。
   2026-10-17 加了第 7 条法阵（灭世天陨），数量断言是根会挡路的旧钉子；
   真正要守的是"每张阵都画得出来、名字不许悬空"，后者比前者严格。 */
(function () {
  const SIG = G.SIGILS || {};
  const sigIds = Object.keys(SIG);
  const unbound = sigIds.filter(k => !SIG[k].fx);
  const dangling = sigIds.map(k => SIG[k].fx).filter(f => f && !REC[f]);
  ok('每一条法阵都绑了特效配方（' + sigIds.length + ' 条：' + sigIds.join('/') + '）',
    sigIds.length >= 6 && unbound.length === 0, '没绑的: ' + unbound.join(','));
  ok('法阵绑定的配方全部存在', dangling.length === 0, dangling.join(','));
})();
ok('配方条数 ≥ 39（25 条原有 + 6 组合 + 6 反应 + 2 拖尾）', Object.keys(REC).length >= 39, '实际 ' + Object.keys(REC).length);
ok('六套复杂组合都在', ['archon_seal', 'orrery_wheel', 'chaos_lattice', 'nova_crown', 'pentacle_gate', 'void_maelstrom'].every(k => REC[k]),
  Object.keys(REC).filter(k => !REC[k]).join(','));
/* "复杂"用两个数说清：层数（信息量）与原子类种数（视觉语汇）。
   阈值不是拍的：orrery_wheel 是行星轮，本来就要重复的环 + 轨道点，只有 3 类但 8 层；
   所以要求"每条 ≥6 层"，并"至少 4 条用到 ≥5 类原子"——全部一刀切成 ≥5 类会把好配方改成凑数。 */
ok('六套组合每条都 ≥6 层', ['archon_seal', 'orrery_wheel', 'chaos_lattice', 'nova_crown', 'pentacle_gate', 'void_maelstrom']
  .every(k => REC[k].layers.length >= 6),
  ['archon_seal', 'orrery_wheel', 'chaos_lattice', 'nova_crown', 'pentacle_gate', 'void_maelstrom']
    .map(k => k + ':' + REC[k].layers.length + '层/' + new Set(REC[k].layers.map(l => l.prim)).size + '类').join(' '));
ok('其中至少 4 条用到 ≥5 类原子（不是把同一原子画六遍）', ['archon_seal', 'orrery_wheel', 'chaos_lattice', 'nova_crown', 'pentacle_gate', 'void_maelstrom']
  .filter(k => new Set(REC[k].layers.map(l => l.prim)).size >= 5).length >= 4);
ok('六条反应一次性配方都在（chem 报 key，配方名只出现在这里）',
  ['ev_react_ignite', 'ev_react_steam', 'ev_react_freeze', 'ev_react_melt', 'ev_react_ash', 'ev_react_obsidian'].every(k => REC[k]));
ok('两条抛射物拖尾配方存在（shard_spin / void_spiral）', REC.shard_spin && REC.void_spiral);
ok('绑定表引用的配方一个都不许悬空（名字打错＝那条卡从此安静地没特效）', (function () {
  /* 表值是**角色表**（{cast, hit, impact, trail}）或裸配方名（CHEM_FX），两种都要走到 */
  const miss = [];
  [V.CARD_FX_EL, V.CARD_BY_ID_FX, V.PROJECTILE_FX_EL, V.CHEM_FX].forEach((tbl, ti) => {
    if (!tbl) { miss.push('表' + ti + ' 不存在'); return; }
    Object.keys(tbl).forEach(k => {
      const v = tbl[k];
      const names = typeof v === 'string' ? [v] : (v && typeof v === 'object' ? Object.keys(v).map(r => v[r]) : []);
      names.forEach(r => { if (r && !REC[r]) miss.push(k + '→' + r); });
    });
  });
  return miss.length === 0 ? true : (console.log('      \u53d1\u73b0: ' + miss.join(' , ')), false);
})());
ok('CARD_BY_ID_FX 里的卡 id 全部真实存在（写错的 id 永远不会被查到，等于白绑）', (function () {
  const bad = Object.keys(V.CARD_BY_ID_FX).filter(id => !G.CARDS_BY_ID[id]);
  return bad.length === 0 ? true : (console.log('      \u53d1\u73b0: ' + bad.join(',')), false);
})());
ok('四张绑定表都非空（元素 / 卡 id / 抛射物元素 / 反应）',
  [V.CARD_FX_EL, V.CARD_BY_ID_FX, V.PROJECTILE_FX_EL, V.CHEM_FX].every(t => t && Object.keys(t).length > 0));
/* 层数上限 14 是照着现有最胖的那条（wire_sphere 的 13 圈线框）定的，不是拍脑袋：
   真正的每帧成本由渲染层的全局预算（槽位 ≤300 / 单层顶点 ≤1024）兜，
   这里只挡"某条配方一个人吃掉整屏"这种失控。 */
ok('单条配方守预算：层 ≤14、环点数 ≤96、旋涡层 ≤8、单层顶点表 ≤2048', (function () {
  const over = [];
  Object.keys(REC).forEach(k => {
    REC[k].layers.forEach(l => {
      if (REC[k].layers.length > 14) over.push(k + ' 层数 ' + REC[k].layers.length);
      if (l.count > 96) over.push(k + ' count ' + l.count);
      if (l.layers > 8) over.push(k + ' vortex layers ' + l.layers);
      if (l.verts && l.verts.length > 2048) over.push(k + ' verts ' + l.verts.length);
    });
  });
  return over.length === 0 ? true : (console.log('      \u53d1\u73b0: ' + over.slice(0, 4).join(' , ')), false);
})());
ok('opts.out 复用（每帧零分配那条）与新建结果逐字段相同', (function () {
  const ent = { uid: 77, born: 0, delay: 0.4, ttl: 6, radius: 3, preset: { kind: 'fire' } };
  const a = V.frame(ent, 3.2, 0.016, { recipe: 'archon_seal' });
  const b = V.frame(ent, 3.2, 0.016, { recipe: 'archon_seal', out: a });
  if (b !== a) return (console.log('      \u53d1\u73b0: 复用没返回同一个对象'), false);
  if (b.layers.length !== a.layers.length) return false;
  for (let i = 0; i < b.layers.length; i++) {
    const x = b.layers[i];
    if (x.prim !== a.layers[i].prim || x.alpha !== a.layers[i].alpha || x.count !== a.layers[i].count) {
      return (console.log('      \u53d1\u73b0: 第 ' + i + ' 层 ' + x.prim + ' 数字变了'), false);
    }
  }
  const fresh = V.frame(ent, 3.2, 0.016, { recipe: 'archon_seal' });
  return fresh.layers.length === b.layers.length && fresh.layers[0].alpha === b.layers[0].alpha;
})());
ok('out 层数对不上时自动退回新建（换配方不许读到上一份的层）', (function () {
  const ent = { uid: 78, born: 0, delay: 0, ttl: 4, radius: 2, preset: { kind: 'ice' } };
  const big = V.frame(ent, 1.5, 0.016, { recipe: 'archon_seal' });
  const small = V.frame(ent, 1.5, 0.016, { recipe: 'follow_star', out: big });
  return small.layers.length === REC.follow_star.layers.length;
})());
ok('chemFor(kind) 认得六种反应、乱给 key 也不炸', V.chemFor('steam') && V.chemFor('obsidian') && V.chemFor('没有这个') === null);

groupOf('11. 递归组合（2026-10-17 架构重排：组节点 / 环绕复制 / 立体球 / 密度预算）');
/* 这一组守的是"结构"，不是某张卡好不好看：
   新技能要靠**组合**长出来（法阵外圈的法针、嵌套环、立体爆炸），
   所以断言的是展开结果、继承的变换、以及密度闸门，而不是逐条配方长得像什么。 */
const sup = V.expand('ev_supernova') || [];
const supPrims = {};
sup.forEach(x => { supPrims[x.prim] = (supPrims[x.prim] || 0) + 1; });
ok('超新星展开成 ' + sup.length + ' 片叶子（球 ×' + (supPrims.sphere || 0) + ' + 环绕三角 ×' + (supPrims.poly || 0) + '）',
  sup.length === 13 && supPrims.sphere === 2 && supPrims.poly === 8, JSON.stringify(supPrims));
const cat = V.expand('cataclysm_seal') || [];
const catSat = cat.filter(x => x.depth >= 1);
ok('灭世天陨靠 sat 长出 ' + catSat.length + ' 片"法针"叶子（深度 ≥1 = 真的嵌套）',
  catSat.length === 9 && cat.every(x => x.depth >= 0), '叶子 ' + cat.length + ' / 嵌套 ' + catSat.length);
const fSat = V.frame({ uid: 3, born: 0, delay: 0, ttl: 9, radius: 2 }, 1.0, 0.016, { recipe: 'cataclysm_seal' });
const fSat2 = V.frame({ uid: 3, born: 0, delay: 0, ttl: 9, radius: 2 }, 1.6, 0.016, { recipe: 'cataclysm_seal' });
const satL = fSat.layers.filter(l => l.depth >= 1), satL2 = fSat2.layers.filter(l => l.depth >= 1);
/* 两圈 sat：外圈 6 根法针（半径 1.18、贴地）、内圈 3 枚小环（半径 0.42、抬高 1.6 格）。
   断言分别落在各自的圆上——父链的 off 继承对不对，看的是"同一圈里每个叶子半径一致"。 */
ok('外圈 6 根法针落在半径 1.18 的圆上、内圈 3 枚在 0.42（父链 off/高度被继承）', (function () {
  const outer = satL.filter(l => Math.abs(Math.hypot(l.px, l.pz) - 1.18) < 0.06);
  const inner = satL.filter(l => Math.abs(Math.hypot(l.px, l.pz) - 0.42) < 0.06 && Math.abs(l.py - 1.6) < 0.06);
  return outer.length === 6 && inner.length === 3;
})(), satL.map(l => Math.hypot(l.px, l.pz).toFixed(2) + '@y' + l.py.toFixed(1)).join(','));
ok('整圈在转（0.6s 内转过约 0.30 rad，父母链的 spin 生效）', (function () {
  const a0 = Math.atan2(satL[0].pz, satL[0].px), a1 = Math.atan2(satL2[0].pz, satL2[0].px);
  let d = Math.abs(a1 - a0);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return Math.abs(d - 0.3) < 0.05;
})(), Math.atan2(satL[0].pz, satL[0].px).toFixed(3) + '→' + Math.atan2(satL2[0].pz, satL2[0].px).toFixed(3));
ok('平面阵**真的**躺在 XZ 里（法线竖直；旧实现随自旋翻成斜椭圆，这是这次修掉的真 bug）', (function () {
  let worst = 0;
  [0.2, 1.1, 2.7].forEach(t2 => {
    const f2 = V.frame({ uid: 4, born: 0, delay: 0, ttl: 9, radius: 1 }, t2, 0.016, { recipe: 'sigil_glacier' });
    f2.layers.filter(l => V.isPlanar(l.prim)).forEach(l => { worst = Math.max(worst, Math.abs(l.m[2]) + Math.abs(l.m[8])); });
  });
  return worst < 0.02;
})(), '最大横向法线分量 ' + '见上');
V.registerRecipe('probe_dense', { anchor: 'ground', budget: 5, layers: [
  { prim: 'ring', r: 1, count: 8, weight: 0.2 }, { prim: 'poly', r: 1, n: 5, weight: 0.6 },
  { prim: 'spokes', rIn: 0.1, rOut: 1, n: 6, weight: 0.8 }, { prim: 'orbit', r: 1, n: 3, weight: 1.0 },
  { prim: 'shards', r: 1, n: 8, weight: 1.2 }, { prim: 'sphere', r: 1, lat: 3, lon: 6, weight: 5 }] });
const fdNear = V.frame({ uid: 1, born: 0, delay: 0, ttl: 9, radius: 1 }, 1, 0.016, { recipe: 'probe_dense' });
const fdFar = V.frame({ uid: 1, born: 0, delay: 0, ttl: 9, radius: 1 }, 1, 0.016, { recipe: 'probe_dense', lod: 0.3 });
ok('密度闸门：budget=5 时只留 5 片，且留下的是权重最高的（球必须在）',
  fdNear.layers.length === 5 && fdNear.layers.some(l => l.prim === 'sphere'),
  fdNear.layers.map(l => l.prim).join(','));
ok('远处（lod 0.3）比近处更少（' + fdFar.layers.length + ' < ' + fdNear.layers.length + '）',
  fdFar.layers.length < fdNear.layers.length, fdFar.layers.length + ' / ' + fdNear.layers.length);
const flatOld = V.expand('sigil_glacier') || [];
ok('老配方零迁移成本：平铺配方展开后仍是原样（4 片叶子、深度 0）',
  flatOld.length === 4 && flatOld.every(x => x.depth === 0));
ok('立体球是完整球（上下都画）：frame 交错出的球有两个半球对称的纬度层引用', (function () {
  const fs = V.frame({ uid: 9, born: 0, delay: 0, ttl: 9, radius: 2 }, 1, 0.016, { recipe: 'ev_supernova' });
  const sp = fs.layers.filter(l => l.prim === 'sphere');
  return sp.length === 2 && sp.every(l => l.lat >= 4 && l.lon >= 9);
})());

console.log('\n' + (fail === 0 ? '\u25b6 vfx_check 全绿：' : '\u25b6 vfx_check 失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
