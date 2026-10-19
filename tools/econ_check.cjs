#!/usr/bin/env node
/* tools/econ_check.cjs · 经济与以太晶再生回归（定案 docs/CARD_ECONOMY.md §1/§3/§5；任务书 docs/tasks/T1_ECONOMY.md）

   管住什么（"改了数值更好玩"这种话只能靠这些断言核对）：
     E1 起始值 3 蓝 / 上限 8 / 素材 8（旧口径 cap 10 / +1.0 整点 / 素材 5 已被定案推翻）
     E2 魔力走**累加器**：空场 5 秒恰好 +4（3+4=7），20 秒封顶 8 且零头清零——按秒逐点核对
     E3 占矿给回蓝：独占方 manaBonusOf = 0.15、对手 0；端到端 step(1.0) 的增量比基线多 0.15
     E4 以太晶 12 秒**原位**再生；玩家在那格砌了方块就 givenUp 放弃（不覆盖玩家地形、不重试）；
        再生表 ≤9；表里没有的坐标不认领；矿脉系统未挂载时转发口返回 false（不许假成功）
     E5 素材两条收入各只发一次：占矿被动 +1/6s、采晶 +1/格（并把那格送进再生表）
     E6 复活 mana = min(cap, 2)、**素材不返还**（死亡不许白拿钱）
     E7 占矿每 3 秒 +1 分；双方同台（争抢）谁都不产

   与 play_probe 的分工：那边量"整局发生了什么"（AI 出牌、命中、时长分布），
   这边只钉经济数值与再生语义——不依赖 AI 行为，秒级、确定性。

   用法：node tools/econ_check.cjs [seed]   退出码非 0 就是不达标（默认 seed 490706）
*/
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.performance = require('perf_hooks').performance;
['src/world.js', 'src/cards.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;
const STEP = 1 / 20;
const B = G.BLOCK;

let n = 0, bad = 0;
function ck(name, ok, detail) {
  n++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  [' + detail + ']'));
  if (!ok) bad++;
}
function noop() {}
const FX = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop,
             fire: noop, float: noop, ambient: noop, chemLog: noop };
/* 一场干净的 1v1：构造口径照 tools/play_probe.cjs（fx 桩、players:2、starter 牌库）。
   量具换档只走 opts（battle.js 的 opts.manaCap / opts.manaRegen 注入位），不改默认值。 */
function mkMatch(over) {
  const o = Object.assign({ seed: SEED }, over || {});
  const seed = o.seed >>> 0;
  const w = new G.World({ size: [64, 36, 64], seed: seed, lodes: true });   // 关卡图：长矿脉（world.js 的 opts.lodes）
  w.generate();
  return new G.Match(Object.assign({ world: w, seed: seed, mode: 'train', players: 2, fx: FX }, o));
}
/* 空输入 = 没人按键：只有物理与系统在跑，经济数值必须自己走对 */
function run(m, secs) {
  const ticks = Math.round(secs / STEP);
  for (let i = 0; i < ticks; i++) m.step(STEP, [{}, {}]);
  return ticks;
}
/* 把人放到某条矿的台面上：脚底落在台面顶块之上（占矿窗口 [L.y, L.y+3.5] 内）。
   台面中央那格的晶体先清掉——人站在自己占的格上不该被自己的资源顶穿。 */
function standOnLode(m, side, li) {
  const L = m.lodeSys.lodes[li], p = m.players[side];
  m.world.set(L.x, L.y + 1, L.z, 0);
  p.pos.set(L.x + 0.5, L.y + 1 + p.h / 2 + 0.001, L.z + 0.5);
  p.vel.set(0, 0, 0); p.onGround = true; p.airHigh = null;
  return p;
}
function cellOf(m, c) { return m.world.get(c[0], c[1], c[2]); }
function entryAt(m, c) {
  return m.lodeSys.crystals.filter(function (e) { return e.x === c[0] && e.y === c[1] && e.z === c[2]; })[0] || null;
}

/* ---------- E1 起始值（定案 §1 的那一行） ---------- */
{
  const m = mkMatch(), p = m.players[0], q = m.players[1];
  ck('E1 P1 起始 3 蓝 / 上限 8 / 素材 8', p.mana === 3 && p.manaCap === 8 && p.mats === 8,
     'mana=' + p.mana + '/' + p.manaCap + ' mats=' + p.mats);
  ck('E1 P2 同档（经济不许偏袒一侧）', q.mana === 3 && q.manaCap === 8 && q.mats === 8,
     'mana=' + q.mana + '/' + q.manaCap + ' mats=' + q.mats);
  ck('E1 回蓝基速 0.9/s、累加器从 0 起', p.regen === 0.9 && p.manaAcc === 0,
     'regen=' + p.regen + ' manaAcc=' + p.manaAcc);
  const mv = mkMatch({ manaCap: 10, manaRegen: 1.0 });
  ck('E1 opts.manaCap / opts.manaRegen 覆盖生效（量具注入位）',
     mv.players[0].manaCap === 10 && mv.players[0].regen === 1.0,
     'cap=' + mv.players[0].manaCap + ' regen=' + mv.players[0].regen);
}

/* ---------- E2 空场：累加器逐点核对 + 封顶 ---------- */
{
  const m = mkMatch(), p = m.players[0];
  let drift = 0, accBad = 0;
  for (let s = 1; s <= 5; s++) {
    run(m, 1);
    const exp = Math.min(8, 3 + Math.floor(s * 0.9 + 1e-9));   // 独立口径：0.9/秒、攒满 1 点入账
    if (p.mana !== exp) drift = drift || s;
    if (!(p.manaAcc >= 0 && p.manaAcc < 1)) accBad++;
  }
  ck('E2 空场 5 秒恰好 +4（3+4=7，逐秒核对累加器口径）', drift === 0 && p.mana === 7 && accBad === 0,
     'mana=' + p.mana + ' acc=' + p.manaAcc + (drift ? ' 第 ' + drift + ' 秒偏离期望值' : ''));
  run(m, 15);
  ck('E2 20 秒封顶：mana===8 且零头清零（不许攒着放开上限猛冲）', p.mana === 8 && p.manaAcc === 0,
     'mana=' + p.mana + '/' + p.manaCap + ' acc=' + p.manaAcc);
  run(m, 30);
  ck('E2 封顶后 50 秒不掉蓝、不超上限、人不死（空场无干扰）',
     p.mana === 8 && p.mana <= p.manaCap && p.alive === true, 'mana=' + p.mana + ' hp=' + p.hp);
}

/* ---------- E3 占矿回蓝：manaBonusOf + 端到端增量 ---------- */
{
  const m = mkMatch(), p = m.players[0];
  m.lodeSys.lodes.forEach(function (L) { L.owner = -1; });
  ck('E3 无主时 manaBonusOf 两方都是 0', m.lodeSys.manaBonusOf(0) === 0 && m.lodeSys.manaBonusOf(1) === 0);
  // 量"连续量"：mana + manaAcc 在没有触顶时恰好等于 dt×regen，整点入账不会吞掉零头
  function oneSecondWith(ownerSide) {
    m.lodeSys.lodes.forEach(function (L) { L.owner = -1; });
    if (ownerSide >= 0) m.lodeSys.lodes[0].owner = ownerSide;    // 本 tick 顶部读到它，tick 末尾才按位置重算
    const b0 = m.lodeSys.manaBonusOf(0), b1 = m.lodeSys.manaBonusOf(1);
    p.mana = 1; p.manaAcc = 0.2; p.invuln = 99; p.vel.set(0, 0, 0);   // 无敌帧：只量经济这一路，坠落/伤害不许掺进来
    const before = p.mana + p.manaAcc;
    m.step(1.0, [{}, {}]);
    return { gain: (p.mana + p.manaAcc) - before, bonus: b0, bonusFoe: b1, alive: p.alive, mana: p.mana };
  }
  const base = oneSecondWith(-1);
  const bon = oneSecondWith(0);
  ck('E3 独占矿：manaBonusOf(0)=0.15 而对手仍是 0',
     base.bonus === 0 && base.bonusFoe === 0 && bon.bonus === 0.15 && bon.bonusFoe === 0,
     '无主 ' + base.bonus + '/' + base.bonusFoe + ' / 独占 ' + bon.bonus + '/' + bon.bonusFoe);
  ck('E3 step(1.0) 独占方的增量比基线多 0.15（±0.01）',
     Math.abs((bon.gain - base.gain) - 0.15) <= 0.01 && bon.alive,
     '基线 +' + base.gain.toFixed(4) + ' / 独占 +' + bon.gain.toFixed(4));
  ck('E3 人离台后归属立即收回（争抢/空台不给加成）', m.lodeSys.manaBonusOf(0) === 0,
     'owner=' + m.lodeSys.lodes[0].owner);
}

/* ---------- E4 以太晶 12 秒原位再生 ---------- */
{
  const m = mkMatch();
  const list = (m.world.lodes && m.world.lodes.list) || [];
  const total = list.reduce(function (a, l) { return a + (l.crystals || []).length; }, 0);
  ck('E4 生成期就记了晶体位置（每矿 1–3 格）',
     list.length > 0 && list.every(function (l) { return (l.crystals || []).length >= 1 && l.crystals.length <= 3; }),
     '矿数=' + list.length + ' 各矿晶体 ' + list.map(function (l) { return l.crystals.length; }).join('/'));
  ck('E4 再生表与晶体一一对应且长度 ≤9（不许每 tick 扫世界）',
     m.lodeSys.crystals.length === total && m.lodeSys.crystals.length <= 9,
     'len=' + m.lodeSys.crystals.length + ' 应有 ' + total);
  const c0 = list[0].crystals[0];
  const ent = entryAt(m, c0);
  ck('E4 再生表按矿登记（lode 指回 0 号矿）', !!ent && ent.lode === 0, ent ? 'lode=' + ent.lode : '表里找不到 ' + JSON.stringify(c0));
  m.world.set(c0[0], c0[1], c0[2], 0);
  const armed = m.onCrystalHarvested(c0[0], c0[1], c0[2]);
  ck('E4 采掘回执进表：t=12、givenUp 复位', armed === true && !!ent && ent.t === 12 && ent.givenUp === false,
     '返回=' + armed + ' t=' + (ent && ent.t));
  ck('E4 表里没有的坐标不认领（别人砌的晶体不归本类）', m.onCrystalHarvested(3, 3, 3) === false);
  run(m, 12.1);
  ck('E4 12.1 秒后原位长回 CRYSTAL', cellOf(m, c0) === B.CRYSTAL && ent.t === 0,
     'id=' + cellOf(m, c0) + '（' + B.CRYSTAL + '=晶体）t=' + ent.t);
  // 玩家在这格砌了砖：再采一次 → 到点不许覆盖玩家地形，直接放弃这一格
  m.world.set(c0[0], c0[1], c0[2], B.BRICK);
  m.onCrystalHarvested(c0[0], c0[1], c0[2]);
  run(m, 13);
  ck('E4 被砌方块的那格放弃再生（不覆盖玩家地形）', cellOf(m, c0) === B.BRICK && ent.givenUp === true,
     'id=' + cellOf(m, c0) + '（' + B.BRICK + '=砖）givenUp=' + ent.givenUp);
  run(m, 13);
  ck('E4 放弃后不重试：再跑 13 秒仍是砖、t 归 0', cellOf(m, c0) === B.BRICK && ent.t === 0,
     'id=' + cellOf(m, c0) + ' t=' + ent.t);
  const m2 = mkMatch(); m2.lodeSys = null;
  ck('E4 矿脉系统未挂载时转发口返回 false（不许假成功）', m2.onCrystalHarvested(1, 1, 1) === false);
}

/* ---------- E5 素材三源（本刀两条：占矿被动 + 采晶） ---------- */
{
  const m = mkMatch();
  const p = standOnLode(m, 0, 0);
  run(m, 0.1);
  const mats0 = p.mats, foe0 = m.players[1].mats;
  ck('E5 上台即独占（LodeSystem 认这台）', m.lodeSys.lodes[0].owner === 0,
     'owner=' + m.lodeSys.lodes[0].owner + ' contested=' + m.lodeSys.lodes[0].contested);
  run(m, 6.1);
  ck('E5 占矿被动：独占 6.1 秒 +1 素材（对手一分不得）',
     p.mats === mats0 + 1 && m.players[1].mats === foe0, 'mats ' + mats0 + '→' + p.mats + ' / P2=' + m.players[1].mats);
  run(m, 0.4);
  ck('E5 被动不重复发钱（6.5 秒仍只 +1）', p.mats === mats0 + 1, 'mats=' + p.mats);
}
{
  const m = mkMatch(), p = m.players[0];
  const c = m.world.lodes.list[1].crystals[0];
  m.ctx.aimTarget = { x: c[0], y: c[1], z: c[2], id: B.CRYSTAL };
  const mats0 = p.mats, mana0 = p.mana;
  G.RULES_EFFECTS.harvest({ op: 'harvest' }, G.CARDS_BY_ID.harvest, p, m.ctx, 1);
  ck('E5 采晶 +1 素材（harvest 是唯一出口，别处不再发）', p.mats === mats0 + 1, 'mats ' + mats0 + '→' + p.mats);
  ck('E5 采晶同次 +3 魔力且夹在上限内', p.mana === Math.min(8, mana0 + 3) && p.mana <= p.manaCap,
     'mana ' + mana0 + '→' + p.mana);
  const ent = entryAt(m, c);
  ck('E5 采晶写空那格并排进再生表（t=12、lode=1）',
     cellOf(m, c) === 0 && !!ent && ent.t === 12 && ent.lode === 1,
     'id=' + cellOf(m, c) + ' t=' + (ent && ent.t) + ' lode=' + (ent && ent.lode));
  // 非晶体格：一格都不该动，也不该排进再生表
  const before = m.lodeSys.crystals.map(function (e) { return e.t; }).join(',');
  m.ctx.aimTarget = { x: c[0], y: c[1] + 3, z: c[2], id: B.STONE };
  G.RULES_EFFECTS.harvest({ op: 'harvest' }, G.CARDS_BY_ID.harvest, p, m.ctx, 1);
  ck('E5 打在非晶体格上什么都不发', p.mats === mats0 + 1 && m.lodeSys.crystals.map(function (e) { return e.t; }).join(',') === before,
     'mats=' + p.mats);
}

/* ---------- E6 复活：mana 归 2、素材不变 ---------- */
{
  const m = mkMatch(), p = m.players[0];
  p.mana = p.manaCap; p.manaAcc = 0.7; p.mats = 12;
  m.respawnPlayer(p);
  ck('E6 复活 mana=min(cap,2)=2（旧值 4 = 死亡白送一笔）', p.mana === 2, 'mana=' + p.mana);
  ck('E6 复活素材不返还（死亡不许白拿钱）', p.mats === 12, 'mats=' + p.mats);
  ck('E6 复活满血、可操作', p.hp === p.maxHp && p.alive === true, 'hp=' + p.hp + '/' + p.maxHp);
}

/* ---------- E7 占矿得分：每 3 秒 +1，争抢不产 ---------- */
{
  const m = mkMatch();
  const p = standOnLode(m, 0, 0), q = m.players[1];
  const s0 = p.score;
  run(m, 3.1);
  ck('E7 独占 3 秒 +1 分（对手 0 分）', p.score === s0 + 1 && q.score === 0, 'P1=' + p.score + ' P2=' + q.score);
  standOnLode(m, 1, 0);                       // 对手上台 → 争抢
  const s1 = p.score, s2 = q.score;
  run(m, 3.1);
  ck('E7 双方同台（争抢）谁都不产分', p.score === s1 && q.score === s2 && m.lodeSys.lodes[0].owner === -1,
     'P1=' + p.score + ' P2=' + q.score + ' owner=' + m.lodeSys.lodes[0].owner);
}

console.log('\n共 ' + n + ' 条，失败 ' + bad + '（seed=' + SEED + '）');
process.exit(bad ? 1 : 0);
