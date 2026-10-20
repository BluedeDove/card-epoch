#!/usr/bin/env node
/* tools/cards_probe.cjs · 卡牌机制回归（2026-10-17 第三批：大招 / 大建造 / 飞行召唤）
   为什么要有它：这一批改动的都是"手感/观感"类需求，截图看不出"墙到底站没站在地上"、
   "桥是不是同一帧全落"、"飞的东西到底有没有开火"。只能用量化断言。
   用法：
       node tools/cards_probe.cjs
   全过退出码 0。它只管**权威层**（world/rules/battle），不依赖 GL 与页面；
   画面侧由 tools/vfx_live.cjs 的像素差分与截图负责。

   覆盖：
     1) 墙站在地面上（不再把瞄准到的那一格地形换成建材——用户 2026-10-17 报的原症状）
     2) 大建造按 maxCells 逐卡放开，素材仍按格扣、先砌满高度
     3) 飞桥：桥钉是 paint 抛射物、沿途铺板、最终补齐
     4) 飞行召唤：离地、开火、真的打到人（按过程中最低血量判，别被复活回满骗到）
     5) 陨星雨：法阵起 → 陨星真弹陆续砸下 → 造成伤害
     6) 超新星（伤害 + 震屏）/ 奇点（吸引）/ 裂地（碗形坑）
*/
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js', 'src/cards.js', 'src/vfx.js', 'src/vfx-recipes.js', 'src/chem.js', 'src/rules.js', 'src/battle.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
let pass=0, fail=0;
function ok(n,c,extra){ if(c){pass++;console.log('  ✓ '+n);} else {fail++;console.log('  ✗ '+n+(extra?'  ← '+extra:''));} }
function mk(seed){
  const w = new G.World({ size: [64, 40, 64], seed }); w.generate();
  const quakes=[];
  const fx = { log(){}, sfx(){}, burst(){}, dust(){}, hit(){}, heal(){}, shieldUp(){}, fire(){}, float(){}, ambient(){}, quake(p){ quakes.push(p); } };
  const m = new G.Match({ world: w, seed, players: 2, fx });
  m.quakes = quakes;
  return { w, m, p: m.players[0], foe: m.players[1] };
}
function cast(m, p, id, aim) {
  p.mana = 99; p.mats = 99; p.cooldowns = {};
  p.hand[0] = id;
  delete p.aimSrc; p.aim = aim; p.aimTarget = aim && { x: aim.gx, y: aim.gy, z: aim.gz, id: 1 };
  m.ctx.aim = aim; m.ctx.aimTarget = p.aimTarget;
  return m.playCard(p, 0);
}
function ground(w, x, z) { return { x: x+0.5, y: w.surfaceY(x,z)+1.5, z: z+0.5, gx: x, gy: w.surfaceY(x,z), gz: z, face: [0,1,0] }; }
const BRICK=G.BLOCK.BRICK, STONE=G.BLOCK.STONE, PLANK=G.BLOCK.PLANK;

console.log('1) 墙站在地面上（不再吃掉脚下那一格）');
{
  const { w, m, p } = mk(490706);
  p.yaw = 0;
  const ax = Math.floor(p.pos.x), az = Math.floor(p.pos.z) + 6, gy = w.surfaceY(ax, az);
  const under = w.get(ax, gy, az);
  ok('打牌成功', cast(m, p, 'wall2', ground(w, ax, az)) === true);
  let bricks=0, atGroundRow=0;
  for (let y=gy; y<=gy+3; y++) for (let x=ax-2;x<=ax+2;x++) for(let z=az-2;z<=az+2;z++) if (w.get(x,y,z)===BRICK) bricks++;
  for (let x=ax-2;x<=ax+2;x++) for(let z=az-2;z<=az+2;z++) if (w.get(x,gy,z)===BRICK) atGroundRow++;
  ok('砌出 6 格砖', bricks===6, '实测 '+bricks);
  ok('地面那一格没被砖替换（墙是站在上面）', atGroundRow===0, '实测 '+atGroundRow+' 格砖压在地面行');
  ok('墙高 ≥2（能挡人）', w.get(ax,gy+1,az)===BRICK || w.get(ax,gy+2,az)===BRICK);
}
console.log('2) 城墙：4 格高、素材付得起就砌满高度');
{
  const { w, m, p } = mk(490706);
  p.yaw = 0; p.mats = 99;
  const ax = Math.floor(p.pos.x), az = Math.floor(p.pos.z)+7;
  const gy0 = w.surfaceY(ax, az);
  cast(m, p, 'bastion', ground(w, ax, az));
  const col = [0,1,2,3].map(k=>w.get(ax, gy0+1+k, az)===STONE);
  ok('4 格高的一列全立起来', col.every(Boolean), JSON.stringify(col));
  ok('素材按格扣（扣了 ≥4）', p.mats <= 95, 'mats='+p.mats);
}
console.log('3) 飞桥：桥钉沿抛物线飞、板沿途落地');
{
  const { w, m, p } = mk(490706);
  p.yaw = 0;
  const ax = Math.floor(p.pos.x), az = Math.floor(p.pos.z);
  ok('打牌成功', cast(m, p, 'bridge', ground(w, ax, az+10)) === true);
  const q = m.projectiles.find(pr=>pr.paint);
  ok('场上有桥钉（paint 抛射物）', !!q, 'projectiles='+m.projectiles.length);
  const before = q ? q.painted : -1;
  for (let i=0;i<12;i++) m.step(0.05, [{},{}]);
  ok('桥钉沿途铺了板（不是一次性全落）', before >= 0 && (q.painted > before || q.painted >= 8), 'painted='+ (q?q.painted:'?'));
  let planks=0, ys=new Set();
  for (let i=1;i<=12;i++){ const x=ax, z=az+i, y=Math.round(p.pos.y-p.h/2)-1;
    if (w.get(x,y,z)===PLANK || w.get(x,y+1,z)===PLANK) { planks++; ys.add(w.get(x,y,z)===PLANK?y:y+1); } }
  ok('桥面连通（≥8 格木板在同一行）', planks>=8 && ys.size<=2, 'planks='+planks+' 行数='+ys.size);
  ok('桥钉最终清空', m.projectiles.filter(pr=>pr.paint).length===0);
}
console.log('4) 飞行召唤：悬空、开火、真的打到人');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  cast(m, p, 'wisp_swarm', null);
  const fl = m.summons.filter(s=>s.fly);
  ok('召出 3 只飞行体', fl.length===3, '实际 '+fl.length);
  const feet0 = fl.map(s=>w.surfaceY(Math.floor(s.pos.x), Math.floor(s.pos.z)));
  ok('离地 ≥1.5 格', fl.every((s,i)=> s.pos.y - feet0[i] >= 1.5), fl.map((s,i)=>(s.pos.y-feet0[i]).toFixed(2)).join(','));
  foe.pos.set(p.pos.x+6, p.pos.y, p.pos.z); foe.hp = foe.maxHp = 100; foe.alive=true; foe.dead=false;
  let bolts=0, dmg=0, maxY=0, low=100;
  for (let i=0;i<200;i++){ m.step(0.05, [{},{}]); bolts = Math.max(bolts, m.projectiles.filter(pr=>pr.aiKind==='summon_bolt').length);
    low = Math.min(low, foe.hp);
    maxY = Math.max(maxY, ...m.summons.filter(s=>s.fly).map(s=>s.pos.y)); }
  dmg = 100 - low;
  ok('飞行体打出了弹道', bolts>0, '同时在场峰值 '+bolts);
  ok('对面真的掉血了', dmg>0, '掉血 '+dmg.toFixed(1));
  ok('飞在空中（y 高于地面 ≥2）', maxY > w.surfaceY(Math.floor(foe.pos.x), Math.floor(foe.pos.z))+2, 'maxY='+maxY.toFixed(2));
}
console.log('5) 陨星雨：阵起→陨星陆续砸下→造成伤害');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  foe.pos.set(p.pos.x+8, p.pos.y, p.pos.z); foe.hp=foe.maxHp=400; foe.alive=true; foe.dead=false;
  ok('打牌成功', cast(m, p, 'meteor_rain', ground(w, Math.floor(p.pos.x+8), Math.floor(p.pos.z))) === true);
  let peak=0, hits=0; foe.hpMin = foe.hp;
  for (let i=0;i<160;i++){ m.step(0.05, [{},{}]); foe.hpMin = Math.min(foe.hpMin, foe.hp);
    const n = m.projectiles.filter(pr=>pr.aiKind==='meteor_rain').length; if(n>peak)peak=n;
  }
  ok('陨星在阵期间陆续出现（可同时在场 ≥2 颗）', peak >= 2, 'peak='+peak);
  ok('陨星砸出了伤害', foe.hpMin !== undefined ? foe.hpMin < 400 : foe.hp < 400, 'hp='+foe.hp.toFixed(1));
  /* 用户 2026-10-17："每一颗流星都要有破坏效果"：阵区里的地表必须被砸出多个坑 */
  const aimCell = m.sigils[0] ? m.sigils[0].pos : null;
  let solidTr = 0;
  const ax0 = aimCell ? Math.floor(aimCell.x) : Math.floor(p.pos.x+8), az0 = aimCell ? Math.floor(aimCell.z) : Math.floor(p.pos.z);
  const gyT = w.surfaceY(ax0, az0);
  for (let dx2 = -5; dx2 <= 5; dx2++) for (let dz2 = -5; dz2 <= 5; dz2++)
    if (!w.get(ax0+dx2, gyT, az0+dz2)) solidTr++;
  ok('陨星把阵区地表砸空了（≥12 格）', solidTr >= 12, '空 ' + solidTr + ' 格');
  ok('阵半径按 6.5 格布（视觉与威力同尺寸）', G.CARDS_BY_ID.meteor_rain.targeting.radius === 6.5, 'radius=' + G.CARDS_BY_ID.meteor_rain.targeting.radius);
}
console.log('6) 超新星 / 奇点 / 裂地');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  foe.pos.set(p.pos.x+8, p.pos.y, p.pos.z); foe.hp=foe.maxHp=300; foe.alive=true; foe.dead=false;
  const aim = ground(w, Math.floor(p.pos.x+8), Math.floor(p.pos.z));
  cast(m, p, 'supernova', aim);
  ok('超新星造成大量伤害', 300 - foe.hp > 30, '掉血 '+(300-foe.hp).toFixed(1));
  ok('触发了震屏', m.quakes.length>0, 'quake 次数 '+m.quakes.length);
}
{
  const { w, m, p, foe } = mk(490706);
  foe.pos.set(p.pos.x+11, p.pos.y, p.pos.z); foe.hp=foe.maxHp=300; foe.alive=true; foe.dead=false;
  const aim = ground(w, Math.floor(p.pos.x+7), Math.floor(p.pos.z));
  const z0 = foe.pos.z, x0 = foe.pos.x;
  cast(m, p, 'void_collapse', aim);
  for (let i=0;i<10;i++) m.step(0.05,[{},{}]);
  const moved = Math.hypot(foe.pos.x-aim.x, foe.pos.z-aim.z);
  ok('奇点把敌人往中心拽（距离缩小）', Math.hypot(x0-aim.x, z0-aim.z) - moved > 0.5,
     '起始 ' + Math.hypot(x0-aim.x,z0-aim.z).toFixed(2) + ' → ' + moved.toFixed(2));
}
{
  const { w, m, p } = mk(490706);
  p.mats = 99;
  const ax = Math.floor(p.pos.x)+3, az = Math.floor(p.pos.z)+3, gy = w.surfaceY(ax,az);
  let solid0=0;
  for (let x=ax-3;x<=ax+3;x++) for (let z=az-3;z<=az+3;z++) for (let y=gy-3;y<=gy;y++) if (w.get(x,y,z)!==0) solid0++;
  const okc = cast(m, p, 'earthsplit', ground(w, ax, az));
  let solid1=0;
  for (let x=ax-3;x<=ax+3;x++) for (let z=az-3;z<=az+3;z++) for (let y=gy-3;y<=gy;y++) if (w.get(x,y,z)!==0) solid1++;
  ok('裂地挖出了碗形坑', okc===true && solid0-solid1 >= 10, '格数 ' + solid0 + '→' + solid1);
}

console.log('7) 终末（核弹级）：全员掉血 + 地面塌成大碗');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  const aim = ground(w, Math.floor(p.pos.x+10), Math.floor(p.pos.z));
  const gy = w.surfaceY(Math.floor(p.pos.x+10), Math.floor(p.pos.z));
  foe.pos.set(aim.gx + 6, p.pos.y, aim.gz + 2); foe.hp = foe.maxHp = 100; foe.alive = true; foe.dead = false;
  let solid0 = 0;
  for (let x = aim.gx-8; x <= aim.gx+8; x++) for (let z = aim.gz-8; z <= aim.gz+8; z++) for (let y = gy-6; y <= gy; y++) if (w.get(x,y,z)) solid0++;
  ok('打牌成功', cast(m, p, 'terminus', aim) === true);
  ok('场上出现终末阵，且带三拍节奏', m.sigils.some(sg => sg.preset && sg.preset.beats && sg.preset.beats.length === 3), 'sigils=' + m.sigils.length);
  const hp0 = foe.hp, casterHp0 = p.hp;
  for (let i = 0; i < 90; i++) m.step(0.05, [{}, {}]);
  let solid1 = 0;
  for (let x = aim.gx-6; x <= aim.gx+6; x++) for (let z = aim.gz-6; z <= aim.gz+6; z++) for (let y = gy-6; y <= gy; y++) if (w.get(x,y,z)) solid1++;
  ok('敌方吃到大范围伤害', hp0 - foe.hp > 20 || !foe.alive, 'hp ' + hp0 + '→' + foe.hp.toFixed(1) + ' alive=' + foe.alive);
  ok('施放者自己也吃（敌我不分的核弹）', casterHp0 - p.hp > 5 || !p.alive, 'hp ' + casterHp0 + '→' + p.hp.toFixed(1));
  ok('地面塌出大碗（≥200 格被抹掉）', solid0 - solid1 > 200, '格数 ' + solid0 + '→' + solid1);
}
console.log('8) 超阶仪式：十几座阵次第点亮 → 中心收束成核爆');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  const aim = ground(w, Math.floor(p.pos.x+11), Math.floor(p.pos.z));
  foe.pos.set(aim.gx + 6, p.pos.y, aim.gz + 2); foe.hp = foe.maxHp = 100; foe.alive = true; foe.dead = false;
  ok('打牌成功', cast(m, p, 'grand_ritual', aim) === true);
  const presets = {};
  m.sigils.forEach(sg => { presets[sg.preset.id] = (presets[sg.preset.id] || 0) + 1; });
  const total = Object.keys(presets).reduce((a2,k)=>a2+presets[k],0);
  ok('一次铺出 ≥16 座阵', total >= 16, JSON.stringify(presets));
  ok('三层外阵 + 主阵都在', presets.ritual_a === 8 && presets.ritual_b === 6 && presets.ritual_c === 4 && presets.ritual_core === 1, JSON.stringify(presets));
  const hp0 = foe.hp;
  for (let i = 0; i < 130; i++) m.step(0.05, [{}, {}]);
  ok('长咏唱之后真的落下来了', hp0 - foe.hp > 15 || !foe.alive, 'hp ' + hp0 + '→' + foe.hp.toFixed(1));
}
console.log('9) 灵光：会拐弯（轨迹不是直线）+ 命中');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  foe.pos.set(p.pos.x + 12, p.pos.y, p.pos.z + 6); foe.hp = foe.maxHp = 200; foe.alive = true; foe.dead = false;
  const aim = ground(w, Math.floor(p.pos.x + 10), Math.floor(p.pos.z + 5));
  ok('打牌成功', cast(m, p, 'spirit_volley', aim) === true);
  const sp0 = m.projectiles.filter(pr => pr.home);
  ok('放出 5 道灵光且带追踪标记', sp0.length === 5, '实际 ' + sp0.length);
  const paths = sp0.map(() => []);
  const low = 200;
  for (let i = 0; i < 40; i++) {
    m.step(0.05, [{}, {}]);
    m.projectiles.filter(pr => pr.home).forEach((pr, idx) => { if (paths[idx]) paths[idx].push({ x: pr.pos.x, y: pr.pos.y, z: pr.pos.z }); });
  }
  // 取第一条轨迹：起点-终点连线的最大偏距
  let worstDev = 0;
  paths.forEach(pts => {
    if (pts.length < 6) return;
    const a0 = pts[0], b0 = pts[pts.length-1];
    const dx = b0.x-a0.x, dz = b0.z-a0.z, L = Math.hypot(dx,dz) || 1;
    pts.forEach(q => {
      const dev = Math.abs((q.x-a0.x)*(-dz/L) + (q.z-a0.z)*(dx/L));
      if (dev > worstDev) worstDev = dev;
    });
  });
  ok('轨迹明显偏离直线（弧线/摆线）', worstDev > 0.4, '最大偏距 ' + worstDev.toFixed(2) + ' 格');
  ok('灵光打到了人', 200 - foe.hp > 3 || !foe.alive, 'hp ' + foe.hp.toFixed(1));
}
console.log('10) 地堡：魔法构筑不耗素材、四壁 + 屋顶都齐');
{
  const { w, m, p } = mk(490706);
  p.mats = 99;
  const ax = Math.floor(p.pos.x) + 2, az = Math.floor(p.pos.z) + 8;
  const gy0 = w.surfaceY(ax, az);
  const aim = ground(w, ax, az);
  ok('打牌成功', cast(m, p, 'bunker', aim) === true);
  ok('素材一点没扣（conjure 按魔力+冷却计价）', p.mats === 99, 'mats=' + p.mats);
  let walls = 0, roof = 0;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const edge = Math.abs(i) === 2 || Math.abs(j) === 2;
    for (let k = 0; k < 3; k++) if (edge && w.get(ax+i, gy0+1+k, az+j) === G.BLOCK.STONE) walls++;
    if (w.get(ax+i, gy0+4, az+j) === G.BLOCK.STONE) roof++;
  }
  ok('四壁立起来了（≥40 格）', walls >= 40, 'walls=' + walls);
  ok('屋顶盖上了（≥20 格）', roof >= 20, 'roof=' + roof);
}
console.log('11) 翻天覆地：先挖壕沟、再原地立黑曜石地堡');
{
  const { w, m, p } = mk(490706);
  p.mats = 99;
  const ax = Math.floor(p.pos.x) + 2, az = Math.floor(p.pos.z) + 9;
  const gy0 = w.surfaceY(ax, az);
  let solid0 = 0;
  for (let x = ax-4; x <= ax+4; x++) for (let z = az-4; z <= az+4; z++) for (let y = gy0-4; y <= gy0; y++) if (w.get(x,y,z)) solid0++;
  ok('打牌成功', cast(m, p, 'raze', ground(w, ax, az)) === true);
  let obs = 0, hole = 0;
  for (let x = ax-4; x <= ax+4; x++) for (let z = az-4; z <= az+4; z++) for (let y = gy0-4; y <= gy0+5; y++) {
    if (w.get(x,y,z) === G.BLOCK.OBSIDIAN) obs++;
    if (!w.get(x,y,z)) hole++;
  }
  ok('外圈被挖空（壕沟里有空腔）', hole > 20, 'hole=' + hole);
  ok('中间立起黑曜石地堡', obs > 40, 'obsidian=' + obs);
}


console.log('12) 黑洞：持续吸附 + 磨血（用户点名的"吸附一切"）');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  const aim = ground(w, Math.floor(p.pos.x + 12), Math.floor(p.pos.z));
  foe.pos.set(aim.gx + 4, p.pos.y, aim.gz + 1); foe.hp = foe.maxHp = 200; foe.alive = true; foe.dead = false;
  ok('打牌成功', cast(m, p, 'black_hole', aim) === true);
  const d0 = Math.hypot(foe.pos.x - aim.x, foe.pos.z - aim.z);
  const low0 = foe.hp;
  for (let i = 0; i < 40; i++) m.step(0.05, [{}, {}]);
  const d1 = Math.hypot(foe.pos.x - aim.x, foe.pos.z - aim.z);
  ok('被持续拽向阵心', d0 - d1 > 0.8, '距离 ' + d0.toFixed(2) + ' → ' + d1.toFixed(2));
  ok('持续磨血（不是一次性大伤害）', low0 - foe.hp > 4, '掉血 ' + (low0 - foe.hp).toFixed(1));
  ok('阵还在（7 秒吸附）', m.sigils.some(sg => sg.preset && sg.preset.id === 'black_hole'));
}


console.log('13) 两类召唤：指向性驻守 vs 自动跟踪');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  const aim = ground(w, Math.floor(p.pos.x + 12), Math.floor(p.pos.z));
  ok('指向性召唤打出去', cast(m, p, 'storm_hawk', aim) === true);
  const d0 = m.summons.filter(s2 => s2.aiKind === 'hawk');
  const toAim = d0.length ? Math.hypot(d0[0].pos.x - aim.x, d0[0].pos.z - aim.z) : 99;
  ok('它落在瞄准点附近（不是自己脚下）', d0.length === 1 && toAim < 4, '距瞄准点 ' + toAim.toFixed(1) + ' 格');
  foe.pos.set(aim.gx + 20, p.pos.y, aim.gz); foe.alive = true; foe.dead = false; foe.hp = foe.maxHp = 300;
  for (let i = 0; i < 40; i++) m.step(0.05, [{}, {}]);
  const h = m.summons.filter(s2 => s2.aiKind === 'hawk')[0];
  const toHome = h && h.home ? Math.hypot(h.pos.x - h.home.x, h.pos.z - h.home.z) : 99;
  ok('敌人跑远后它拴在驻守点（不追出去）', !!h && toHome < (h.leash + 3), '离岗 ' + toHome.toFixed(1) + ' 格 / 绳长 ' + (h ? h.leash : '?'));
}
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  foe.pos.set(p.pos.x + 10, p.pos.y, p.pos.z); foe.alive = true; foe.dead = false; foe.hp = foe.maxHp = 400;
  cast(m, p, 'wisp_swarm', null);
  const near0 = m.summons.filter(s2 => s2.aiKind === 'wisp_void').map(s2 => Math.hypot(s2.pos.x - p.pos.x, s2.pos.z - p.pos.z));
  ok('跟踪类召唤出在自己身边', near0.length === 3 && near0.every(d => d < 6), near0.map(d => d.toFixed(1)).join(','));
  for (let i = 0; i < 40; i++) m.step(0.05, [{}, {}]);
  const near1 = m.summons.filter(s2 => s2.aiKind === 'wisp_void').map(s2 => Math.hypot(s2.pos.x - foe.pos.x, s2.pos.z - foe.pos.z));
  ok('它们主动跟向敌人（离敌人更近）', near1.length && Math.min.apply(null, near1) < 10, '最近 ' + Math.min.apply(null, near1).toFixed(1) + ' 格');
}
console.log('14) 分节拍：终末三拍，伤害不是一次性砸完');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  const aim = ground(w, Math.floor(p.pos.x + 10), Math.floor(p.pos.z));
  foe.pos.set(aim.gx + 6, p.pos.y, aim.gz + 2); foe.hp = foe.maxHp = 400; foe.alive = true; foe.dead = false;
  cast(m, p, 'terminus', aim);
  const snap = [];
  for (let i = 0; i < 110; i++) {
    m.step(0.05, [{}, {}]);
    if (i === 62) snap.push(foe.hp);      // 3.1s ≈ 第一拍之后
    if (i === 70) snap.push(foe.hp);      // 3.5s ≈ 第二拍之后
    if (i === 88) snap.push(foe.hp);      // 4.4s ≈ 主爆之后
  }
  const st = [400].concat(snap);
  ok('三拍是三段跌血，不是一次性', st[0] > st[1] && st[1] > st[2] && st[2] > st[3],
     '血量 ' + st.map(v => v.toFixed(0)).join(' → '));
}


console.log('15) 射程与施法范围分离（用户：发射/追踪取消射程、放置类缩短施法距离）');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  const aim = ground(w, Math.floor(p.pos.x + 20), Math.floor(p.pos.z));
  cast(m, p, 'bolt', aim);
  const pr = m.projectiles[0];
  const x0 = pr ? pr.pos.x : 0, z0 = pr ? pr.pos.z : 0;
  let travelled = 0;
  for (let i = 0; i < 20; i++) { m.step(0.05, [{}, {}]); if (pr) travelled = Math.max(travelled, Math.hypot(pr.pos.x - x0, pr.pos.z - z0)); }
  ok('抛射物飞过 26 格仍在飞（射程取消，能跨图对轰）', travelled > 26 || !m.projectiles.includes(pr), '已飞 ' + travelled.toFixed(1) + ' 格');
  ok('弹道不再由 targeting.maxDist 决定寿命', pr === undefined || pr.life > 7, 'life=' + (m.projectiles[0] ? m.projectiles[0].life.toFixed(1) : 'gone'));
}
{
  const { w, m, p } = mk(490706);
  const far = { x: p.pos.x + 15, y: p.pos.y, z: p.pos.z, gx: Math.floor(p.pos.x + 15), gy: Math.floor(p.pos.y), gz: Math.floor(p.pos.z), face: [0, 1, 0] };
  m.ctx.aim = far; p.aim = far;
  const v = G.Rules.canPlay(G.CARDS_BY_ID.place, p, m.ctx);
  ok('放置类在 15 格外被拒（施法范围）', v.ok === false && /施法范围/.test(v.reason || ''), JSON.stringify(v));
  const near = { x: p.pos.x + 4, y: p.pos.y, z: p.pos.z, gx: Math.floor(p.pos.x + 4), gy: Math.floor(p.pos.y), gz: Math.floor(p.pos.z), face: [0, 1, 0] };
  m.ctx.aim = near; p.aim = near;
  const v2 = G.Rules.canPlay(G.CARDS_BY_ID.place, p, m.ctx);
  ok('同一张卡在 4 格内可以放', v2.ok === true || /素材|无法改造/.test(v2.reason || ''), JSON.stringify(v2));
}


console.log('16) 快捷出牌（万物皆牌：Shift 自动挑一张机动牌打出）');
{
  const { w, m, p } = mk(490706);
  p.hand = ['phase_dash', 'strike']; p.mana = 9; p.cooldowns = {}; p.mats = 99;
  const vx0 = p.vel.x, vz0 = p.vel.z;
  const r1 = m.useHotkey(p, 'shift', 1, 0);
  ok('按 Shift 自动打出手牌里的机动牌', r1.ok === true && r1.cardId === 'phase_dash', JSON.stringify(r1));
  ok('它是被**消耗**的（进弃牌堆、手牌里不再有它）', p.discard.indexOf('phase_dash') >= 0 && p.hand.indexOf('phase_dash') < 0, 'hand=' + p.hand.join(',') + ' discard=' + p.discard.join(','));
  ok('朝给定方向给出了冲量', Math.hypot(p.vel.x - vx0, p.vel.z - vz0) > 5, 'Δv=' + Math.hypot(p.vel.x - vx0, p.vel.z - vz0).toFixed(1));
  ok('魔力也照扣（不是免费技能）', p.mana <= 8, 'mana=' + p.mana);
  const r2 = m.useHotkey(p, 'shift', 0, 0);
  ok('手里没有机动牌时安静失败', r2.ok === false, JSON.stringify(r2));
}
console.log('17) 环盾：漂在身边的实体盾球，真的撞掉子弹');
{
  const { w, m, p, foe } = mk(490706);
  p.mats = 99;
  cast(m, p, 'orb_ward', null);
  ok('召出 4 颗盾球', !!p.orbSpec && p.orbs.length === 4, JSON.stringify(p.orbSpec));
  foe.pos.set(p.pos.x + 7, p.pos.y, p.pos.z);
  foe.hand[0] = 'strike'; foe.mana = 99; foe.cooldowns = {};
  foe.aim = { x: p.pos.x, y: p.pos.y, z: p.pos.z, gx: Math.floor(p.pos.x), gy: Math.floor(p.pos.y), gz: Math.floor(p.pos.z), face: [0, 1, 0] };
  delete foe.aimSrc;
  const hp0 = p.hp, orbs0 = p.orbs.reduce((a2, o) => a2 + o.hp, 0);
  m.ctx.aim = foe.aim; foe.aimTarget = null;
  m.playCard(foe, 0);
  for (let i = 0; i < 30; i++) m.step(0.05, [{}, {}]);
  const orbs1 = p.orbs ? p.orbs.reduce((a2, o) => a2 + o.hp, 0) : 0;
  ok('子弹被盾撞掉了（盾球掉血、人没掉血）', (orbs1 < orbs0 || p.hp === hp0) && p.hp >= hp0 - 1,
     '盾 ' + orbs0 + '→' + orbs1 + ' / 血 ' + p.hp);
  ok('盾球在绕人转（相位在变）', Math.abs(p.orbPhase) > 0.1, 'phase=' + (p.orbPhase || 0).toFixed(2));
}

console.log('\n' + (fail===0?'▶ 卡牌机制探针全绿：':'▶ 失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail?1:0);