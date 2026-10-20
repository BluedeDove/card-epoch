#!/usr/bin/env node
/* tools/role_check.cjs · 出牌组（卡牌 role）回归
   用户 2026-10-18："按**放出来干什么**分组，不是按功能类别——放方块一组、破坏方块一组、
   增加移动一组（而且都能用 Shift 触发）、放出远程攻击一组、放出法阵一组、放出超阶法术一组。"

   这份量具钉住四件事：
     1) 76 张卡**每张都有且只有一张 role**，role 只能是 8 个之一（放置/破坏/移动/远程/法阵/超阶/召唤/辅助）；
     2) 分组真的"按放出来干什么"：放置组的每张卡都在放方块，破坏组都在拆地形，
        法阵组都有 sigil，召唤组都有 spawn，超阶组都够"超阶"（费用 ≥5、冷却 ≥16、且是伤害/法阵），
        辅助组不碰地形/召唤/法阵/伤害；
     3) 移动组的**每张卡都带 hot:'shift'**（用户要的"增加移动的都能用 Shift 触发"）；
     4) 文案层与数据层同一套词：H.TEXT.inv 的 classOrder = ['all', ...8 个组]，且每个组都有中文名。
   用法：node tools/role_check.cjs   退出码非 0 就是不达标。 */
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js', 'src/cards.js', 'src/rules.js', 'src/battle.js'].forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
/* hud.js 在加载期就抓着 G.UI（门面）：给一个空壳再加载，只为了读 H.TEXT 那张文案表。
   这不是"在 node 里跑界面"——ui 层一行没加载，读到的只有纯数据。 */
G.UI = G.UI || {};
require(path.join(ROOT, 'src/hud.js'));
const C = G.CARDS;
let n = 0, bad = 0;
function ck(name, ok, detail) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']')); } else console.log('PASS ' + name + (detail === undefined ? '' : '  [' + detail + ']')); }

const ROLES = ['place', 'dig', 'move', 'shot', 'sigil', 'ultra', 'summon', 'aid'];
const CN = { place: '放置', dig: '破坏', move: '移动', shot: '远程', sigil: '法阵', ultra: '超阶', summon: '召唤', aid: '辅助' };
const ops = (c) => (c.effects || []).map((e) => e.op);
const has = (c, op) => ops(c).indexOf(op) >= 0;
const setModes = (c) => (c.effects || []).filter((e) => e.op === 'setBlock').map((e) => e.mode);

/* 0. 基数与覆盖 */
ck('卡池 76 张（与 docs/CARD_ECONOMY 同量级）', C.length === 76, C.length);
const counts = {};
C.forEach((c) => { counts[c.role] = (counts[c.role] || 0) + 1; });
const unknown = C.filter((c) => ROLES.indexOf(c.role) < 0).map((c) => c.id + ':' + c.role);
ck('每张卡的 role 都是 8 个之一', unknown.length === 0, unknown.join(','));
ck('8 个组每组都有牌（不是空承诺）', ROLES.every((r) => (counts[r] | 0) > 0), JSON.stringify(counts));
console.log('  分组：' + ROLES.map((r) => CN[r] + ' ' + (counts[r] | 0)).join(' · '));

/* 1. 放置：每张卡都在"把方块放出去"（fill/wall/column/bridge/ramp/layer/cage/grow/bunker） */
{
  const MODES = ['fill', 'wall', 'column', 'bridge', 'ramp', 'layer', 'cage', 'grow', 'bunker'];
  const off = C.filter((c) => c.role === 'place').filter((c) => !setModes(c).some((m) => MODES.indexOf(m) >= 0));
  ck('放置组：每张卡都在放方块（setBlock 的建造模式）', off.length === 0, off.map((c) => c.id + '[' + setModes(c) + ']').join(','));
}
/* 2. 破坏：每张卡都在拆/改地形（erase/crater/moat/shift） */
{
  const MODES = ['erase', 'crater', 'moat', 'shift'];
  const off = C.filter((c) => c.role === 'dig').filter((c) => !setModes(c).some((m) => MODES.indexOf(m) >= 0));
  ck('破坏组：每张卡都在拆/改地形（erase/crater/moat/shift）', off.length === 0, off.map((c) => c.id + '[' + setModes(c) + ']').join(','));
}
/* 3. 移动：每张卡都真的让人位移/变快，而且都带 Shift 触发 */
{
  const MV = ['blink', 'dash', 'flight', 'speed', 'swap'];
  const off = C.filter((c) => c.role === 'move').filter((c) => !ops(c).some((o) => MV.indexOf(o) >= 0));
  ck('移动组：每张卡都有位移/加速效果（blink/dash/flight/speed/swap）', off.length === 0, off.map((c) => c.id + '[' + ops(c) + ']').join(','));
  const noHot = C.filter((c) => c.role === 'move' && c.hot !== 'shift').map((c) => c.id);
  ck('移动组：每张卡都能用 Shift 触发（hot:shift）', noHot.length === 0, noHot.join(','));
}
/* 4. 远程：每张卡都是"放出去打人"（damage/status/spirit/hail/ignite） */
{
  const ATK = ['damage', 'status', 'spirit', 'hail', 'ignite'];
  const off = C.filter((c) => c.role === 'shot').filter((c) => !ops(c).some((o) => ATK.indexOf(o) >= 0));
  ck('远程组：每张卡都是放出去打人的（damage/status/spirit/hail/ignite）', off.length === 0, off.map((c) => c.id + '[' + ops(c) + ']').join(','));
  const terr = C.filter((c) => c.role === 'shot' && has(c, 'setBlock')).map((c) => c.id);
  ck('远程组里没有地形卡（放方块/拆方块的不会混进来）', terr.length === 0, terr.join(','));
}
/* 5. 法阵：都有 sigil */
{
  const off = C.filter((c) => c.role === 'sigil' && !has(c, 'sigil')).map((c) => c.id);
  ck('法阵组：每张卡都在放法阵（sigil）', off.length === 0, off.join(','));
}
/* 6. 超阶：够"超阶"（费用 ≥5、冷却 ≥16、且是伤害/法阵），而且不该有别的卡够格却没进这组 */
{
  const isUltraish = (c) => (c.cost | 0) >= 5 && (c.cooldown || 0) >= 16 && (has(c, 'damage') || has(c, 'sigil'));
  const wrong = C.filter((c) => c.role === 'ultra' && !isUltraish(c)).map((c) => c.id);
  ck('超阶组：费用 ≥5、冷却 ≥16、且是伤害/法阵', wrong.length === 0, wrong.join(','));
  const missed = C.filter((c) => c.role !== 'ultra' && isUltraish(c)).map((c) => c.id);
  ck('够"超阶"的卡没有漏在外面的组里', missed.length === 0, missed.join(','));
}
/* 7. 召唤：都有 spawn */
{
  const off = C.filter((c) => c.role === 'summon' && !has(c, 'spawn')).map((c) => c.id);
  ck('召唤组：每张卡都在放随从（spawn）', off.length === 0, off.join(','));
}
/* 8. 辅助：不碰地形/召唤/法阵/伤害（它只加护盾/治疗/回蓝/过牌/位移敌人/拆阵） */
{
  const off = C.filter((c) => c.role === 'aid').filter((c) => has(c, 'setBlock') || has(c, 'spawn') || has(c, 'sigil') || has(c, 'damage'));
  ck('辅助组：不碰地形/召唤/法阵/伤害', off.length === 0, off.map((c) => c.id + '[' + ops(c) + ']').join(','));
}

/* 9. 文案层与数据层同一套词（H.TEXT.inv.classOrder / categories） */
{
  const T = (G.HUD && G.HUD.TEXT && G.HUD.TEXT.inv) || {};
  const order = T.classOrder || [];
  ck('文案 classOrder = [all, ...8 个组]', order.length === 9 && order[0] === 'all' && ROLES.every((r) => order.indexOf(r) >= 0), JSON.stringify(order));
  const missing = ROLES.filter((r) => !(T.categories && T.categories[r]));
  ck('8 个组都有中文名（图鉴/手持栏/背包读同一张表）', missing.length === 0, missing.join(','));
  ck('中文名与组名对得上（抽查）', T.categories.place === '放置' && T.categories.ultra === '超阶' && T.categories.move === '移动', JSON.stringify(T.categories || {}).slice(0, 80));
}

console.log('\n共 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
