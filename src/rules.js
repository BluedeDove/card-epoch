/* ================= GW.Rules =================
   极小的确定性结算器：校验 → 扣资源 → 生成指令 → 写世界/改实体 → 记录。
   所有规则数据来自 cards.js，这里只有解释器（学杀戮尖塔：引擎小、数据厚）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  if (typeof require === 'function') { try { require('./systems/damage.js'); } catch (e) {} }
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  var MAX_TERRAIN_CELLS = 9;   // 单卡地形改造上限的**默认档**（防实时对战里地形变成无解干扰）
  /* 2026-10-17：大建造/大招需要超过 9 格（用户报"墙只生成地面上那一格，挡不住人"）。
     口径仍然是"一张卡一个预算"，只是预算可以从 cards.js 的 sb(..., {maxCells}) 逐卡声明；
     写错成 9999 也不会捅穿地板：这里还有一道 64 格的硬顶。价格照旧**素材按格扣**，
     所以真正的平衡闸门是素材，不是这个数——付不起就部分成交（R.truncateQuote 唯一截断点）。 */
  var CARD_CELL_CEIL = 96;

  var R = G.Rules = {};
  R.MAX_TERRAIN_CELLS = MAX_TERRAIN_CELLS;
  /* 创造模式可临时解除（调试地形卡要试大半径）：默认关，那是平衡规则不是调试必需。
     预览框与结算都走这个口，保证"看到的格数"与"改到的格数"永远是同一份判定。 */
  R.terrainCap = function (p) { return (p && p.creative && p.creative.unlimitedCells) ? 4096 : MAX_TERRAIN_CELLS; };
  /* 一张卡自己的格子预算（HUD 显示与 cellsFor 的截断用同一个数，别再两处各算一份）。 */
  R.effectCap = function (ef, p) {
    if (p && p.creative && p.creative.unlimitedCells) return 4096;
    var n = (ef && typeof ef.maxCells === 'number' && isFinite(ef.maxCells)) ? ef.maxCells : MAX_TERRAIN_CELLS;
    return Math.min(CARD_CELL_CEIL, Math.max(1, n | 0));
  };
  R.cardCellCap = function (card, p) {
    var cap = 0;
    if (!card || !card.effects) return R.terrainCap(p);
    for (var i = 0; i < card.effects.length; i++) if (card.effects[i].op === 'setBlock' || card.effects[i].op === 'cells') cap = Math.max(cap, R.effectCap(card.effects[i], p));
    return cap || R.terrainCap(p);
  };

  /* ---------- 出牌合法性校验 ---------- */
  R.canPlay = function (card, p, ctx) {
    if (!p.alive) return { ok: false, reason: '你已倒下' };
    if (!p.hand.length) return { ok: false, reason: '手牌为空' };
    var cr = p.creative;
    if ((!cr || !cr.infiniteMana) && card.cost > p.mana) return { ok: false, reason: '魔力不足（需 ' + card.cost + '）' };
    var cd = p.cooldowns[card.id] || 0;
    if ((!cr || !cr.noCooldown) && cd > 0) return { ok: false, reason: '冷却中 ' + cd.toFixed(1) + 's' };
    for (var i = 0; i < card.requires.length; i++) {
      var rq = card.requires[i];
      if (rq.mats && p.mats < rq.mats) return { ok: false, reason: '素材不足' };
      if (rq.hpBelow && p.hp > p.maxHp * rq.hpBelow) return { ok: false, reason: '生命条件不足' };
      if (rq.night && !ctx.match.night) return { ok: false, reason: '需要夜晚' };
    }
    /* 施法范围（2026-10-17 用户："放方块之类的不该指到哪就放到哪，距离太远；施法范围近一点"）：
       只有**放置类（terrain）**受 targeting.maxDist 约束——它表示"你能把魔法放到多远"。
       发射类（ray/追踪）不受影响，那类牌现在射程是全图（battle.fireProjectile 的 life 改成撞上为止）。 */
    if (card.type === 'terrain' && card.targeting && card.targeting.maxDist && ctx && ctx.aim) {
      var ddx0 = ctx.aim.x - p.pos.x, ddz0 = ctx.aim.z - p.pos.z;
      if (Math.sqrt(ddx0 * ddx0 + ddz0 * ddz0) > card.targeting.maxDist + 0.75)
        return { ok: false, reason: '超出施法范围（走近些）' };
    }
    if (card.type === 'terrain') {
      /* 预算门（定案 §2.2 部分成交）：能付几格就建几格，所以只拦"一格也建不了"——
         有建造内容且素材为 0 才拒付；目标全不可改造仍按 n===0 拦。价格只问 R.priceTerrain 这一份。
         只对 type==='terrain' 设门：ice_step 这类混合卡的位移主效果不该被顺手的 1 格建造卡死。 */
      var tCost = 0;
      for (var k = 0; k < card.effects.length; k++) if (card.effects[k].op === 'setBlock' || card.effects[k].op === 'cells') {
        var pr = R.priceTerrain(card.effects[k], card, p, ctx);
        if (pr.cells.length === 0) return { ok: false, reason: '瞄准处无法改造（换目标或走近些）' };
        tCost += pr.cost;
      }
      if (tCost > 0 && !(cr && cr.freeMats) && p.mats < 1) return { ok: false, reason: '素材不足' };
    }
    return { ok: true, reason: '' };
  };

  /* ---------- 地形改造：目标格集合 ---------- */
  function dirXZ(p) {
    var a = p.yaw; return { x: Math.sin(a), z: Math.cos(a) };
  }
  R.cellsFor = function (ef, card, p, ctx) {
    var w = ctx.world, t = ctx.aim, out = [];
    if (!t) return out;
    var cap = R.effectCap(ef, p);
    var ax = t.gx, ay = t.gy, az = t.gz;
    /* 建造类的落位口径：瞄准到方块时按**面**偏移一格（fill 一直这么做，wall / cage 没做，
       于是墙与笼子把瞄准到的那一格地形直接换成建材、只剩上面一格——用户 2026-10-17 报的
       "墙只生成地面上那一格"就是这么来的）。onHitBlock 留给"就要替换这一格"的卡。 */
    var fy0 = ay, fx0b = ax, fz0b = az;
    if (t.face && ef.onHitBlock !== true) { fx0b += t.face[0]; fy0 += t.face[1]; fz0b += t.face[2]; }
    var blockKey = ef.block || 'dirt';
    var blockId = G.blockKeyToId[blockKey] === undefined ? B.DIRT : G.blockKeyToId[blockKey];
    function push(x, y, z, id, src) {
      if (!w.inB(x, y, z)) return;
      if (out.length >= cap) return;
      for (var i = 0; i < out.length; i++) if (out[i].x === x && out[i].y === y && out[i].z === z) return;
      // 不许把方块塞进玩家身体（会把人卡住）
      var occupant = ctx.match.entitiesAt(x, y, z);
      if (id !== 0 && occupant.some(function (e) { return e.kind === 'player' || e.kind === 'summon'; })) return;
      var cur = w.get(x, y, z);
      if (ef.mode === 'erase' && (cur === B.BEDROCK || cur === 0)) return;
      if (ef.mode !== 'erase' && cur === id) return;
      out.push({ x: x, y: y, z: z, id: id, prev: cur, owner: p.side, kind: 'built', src: src });
    }
    var d, i, j, k;
    switch (ef.mode) {
      case 'erase':
        var r = ef.radius || 0, hh = ef.height || 1;
        for (i = -r; i <= r; i++) for (j = -r; j <= r; j++) for (k = 0; k < hh; k++) push(ax + i, ay + k, az + j, 0);
        break;
      case 'fill':
        // 按瞄准面偏移：看着地面放方块 = 放在地面上，而不是替换地面（建造手感）
        var fx0 = ax, fy0 = ay, fz0 = az;
        if (t.face && ef.onHitBlock !== true) { fx0 += t.face[0]; fy0 += t.face[1]; fz0 += t.face[2]; }
        var rr = ef.radius || 0;
        for (i = -rr; i <= rr; i++) for (j = -rr; j <= rr; j++) for (k = 0; k <= (ef.height || 0); k++) push(fx0 + i, fy0 + k, fz0 + j, blockId);
        break;
      case 'column':
        for (k = 1; k <= 3; k++) push(ax, ay + k, az, blockId);
        break;
      case 'bridge':
        /* 2026-10-17 重做（用户："桥应该朝一个方向扔出去、抛物线生成过去，不该点到哪生成哪"）：
           起铺点在自己脚下，方向取相机朝向，桥面高度 = 脚下那一格的下一层（能直接走上去）。
           遇到实心地面就抬到地面之上——所以站着铺是接地面，跳起来铺就是一条空中栈桥，
           对瞄准精度的要求为零：落点只决定朝向。 */
        d = dirXZ(p);
        var BL = ef.length || 6, BW = ef.width || 1;
        var deckY = Math.round(p.pos.y - p.h / 2) - 1;
        var sx0 = Math.floor(p.pos.x), sz0 = Math.floor(p.pos.z);
        for (i = 1; i <= BL; i++) {
          for (j = 0; j < BW; j++) {
            var off = (BW > 1) ? (j - (BW - 1) / 2) : 0;
            var cx2 = sx0 + Math.round(d.x * i - d.z * off);
            var cz2 = sz0 + Math.round(d.z * i + d.x * off);
            var dy2 = deckY, cur2 = w.get(cx2, dy2, cz2);
            if (cur2 && DEFS[cur2] && DEFS[cur2].solid) dy2 += 1;
            push(cx2, dy2, cz2, blockId);
          }
        }
        break;
      case 'wall':
        d = dirXZ(p);
        var side = { x: d.z, z: -d.x };
        var L = ef.length || 3, H = ef.height || 2, TH = ef.thickness || 1;
        /* 起点 = 瞄准面（墙**站在**地面上），不是瞄准到的那一格地形。 */
        var bx = Math.round(fx0b), bz = Math.round(fz0b), by = fy0;
        /* 铺法顺序就是"部分成交"的形状：先砌满一列高度、再往旁边长。
           素材只够 5 格时拿到的是 4 格高的墙（挡得住人），而不是一道高 1 的长坎。 */
        for (i = 0; i < L; i++) for (k = 0; k < H; k++) for (j = 0; j < TH; j++)
          push(bx + Math.round(side.x * i) + Math.round(d.x * j), by + k,
               bz + Math.round(side.z * i) + Math.round(d.z * j), blockId);
        break;
      case 'cage':
        var H2 = ef.height || 3, b2 = blockId, cr2 = Math.max(1, ef.radius || 1);
        /* 只砌周长（radius 1 → 3×3 的框，radius 2 → 5×5 的框）；照样先砌满高度。 */
        for (i = -cr2; i <= cr2; i++) for (j = -cr2; j <= cr2; j++) {
          if (Math.abs(i) !== cr2 && Math.abs(j) !== cr2) continue;
          for (k = 0; k < H2; k++) push(ax + i, fy0 + k, az + j, b2);
        }
        break;
      case 'bunker':
        /* 地堡（2026-10-17 用户点名"一键生成堡垒/地堡"）：四壁 + 屋顶 + 一个门洞，只砌外壳。
           铺法顺序就是资金顺序：先四壁（从地面往上、一圈一圈），再屋顶——
           所以素材/预算不够时拿到的是**一个没有顶的掩体**，而不是一堆散落的砖。 */
        var br2 = Math.max(1, ef.radius || 2), bh2 = ef.height || 3, b3 = blockId;
        var door = ef.door === false ? -1 : Math.floor(-br2 + 1);   // 默认在南面开一格门（相对阵心的 x 偏移）
        for (k = 0; k < bh2; k++) {
          for (i = -br2; i <= br2; i++) for (j = -br2; j <= br2; j++) {
            if (Math.abs(i) !== br2 && Math.abs(j) !== br2) continue;      // 只砌周长
            if (k < 2 && j === br2 && i === door) continue;                 // 门洞：两格高
            push(ax + i, fy0 + k, az + j, b3);
          }
        }
        if (ef.roof !== false) {
          for (i = -br2; i <= br2; i++) for (j = -br2; j <= br2; j++) push(ax + i, fy0 + bh2, az + j, b3);
        }
        break;
      case 'moat':
        /* 壕沟：碗形坑的"环"版本（inner 以内不挖），给"翻天覆地"这种拆+建的组合卡用——
           中心留一块台地立地堡，外圈整片挖空。 */
        var mr2 = ef.radius || 3, mi2 = ef.inner || 1.6, mdep = ef.depth || 4;
        for (i = -Math.ceil(mr2); i <= Math.ceil(mr2); i++) for (j = -Math.ceil(mr2); j <= Math.ceil(mr2); j++) {
          var md = Math.sqrt(i * i + j * j);
          if (md > mr2 || md < mi2) continue;
          var mh = Math.max(1, Math.round(mdep * (1 - (md / mr2) * (md / mr2))));
          for (k = 0; k < mh; k++) push(ax + i, ay - k, az + j, 0);
        }
        break;
      case 'crater':
        /* 碗形塌陷：中心挖到底、边缘只挖一格（"裂地"那种）。erase 不计费，
           所以这张卡的闸门是 requires.mats 与冷却，不是格数。 */
        var cr3 = ef.radius || 2, dep = ef.depth || 3;
        for (i = -cr3; i <= cr3; i++) for (j = -cr3; j <= cr3; j++) {
          var dd2 = Math.sqrt(i * i + j * j) / cr3;
          if (dd2 > 1) continue;
          var hh3 = Math.max(1, Math.round(dep * (1 - dd2 * dd2)));
          for (k = 0; k < hh3; k++) push(ax + i, ay - k, az + j, 0);
        }
        break;
      case 'ramp':
        d = dirXZ(p);
        for (i = 1; i <= (ef.length || 4); i++)
          for (k = 0; k < i; k++) push(Math.round(p.pos.x + d.x * i), ay + k, Math.round(p.pos.z + d.z * i), blockId);
        break;
      case 'shift':
        var dx = ef.dx || 2, box = [];
        for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) for (k = 0; k < 4; k++) {
          var cur = w.get(ax + i, ay + k, az + j);
          if (cur && cur !== B.BEDROCK) box.push({ x: ax + i, y: ay + k, z: az + j, id: cur });
        }
        for (i = 0; i < box.length; i++) { push(box[i].x + dx, box[i].y, box[i].z, box[i].id); out[out.length - 1] && (out[out.length - 1].eraseAt = box[i]); }
        break;
      case 'grow':
        for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) {
          if (Math.abs(i) + Math.abs(j) === 2 && ctx.rng() < 0.5) continue;
          for (k = 0; k < (ef.height || 3); k++) push(ax + i, ay + k, az + j, blockId);
        }
        break;
      case 'layer':
        for (i = -(ef.radius || 1); i <= (ef.radius || 1); i++) for (j = -(ef.radius || 1); j <= (ef.radius || 1); j++) {
          var sy = w.surfaceY(ax + i, az + j);
          push(ax + i, sy, az + j, blockId);
        }
        break;
    }
    return out;
  };
  R.countCells = function (ef, card, p, ctx) { return R.cellsFor(ef, card, p, ctx).length; };
  /* 数格 + 计价的唯一真源（定案 §2.2 / §7.1 条 7 / §7.3）：合法性校验（canPlay）与结算（applyEffect）
     都从这里拿"几格、多少钱"；任何地方再自己数一遍格子 = 第二个价格真源，禁止。
     价 = 实际格数（erase 免费）；creative.freeMats 的豁免由调用方判，这里只报事实。 */
  R.priceTerrain = function (ef, card, p, ctx) {
    var cells = R.cellsFor(ef, card, p, ctx);
    /* 两种不计素材的建造：erase（挖掉，零成本，定案 §2.2）与 ef.conjure（**魔法构筑**）。
       conjure 是 2026-10-17 为用户"一键生成堡垒/地堡"加的一档：建筑不是自己砌的、是魔法捏出来的，
       所以价格从素材挪到**魔力 + 冷却**上。定价闸门没有消失，只是换了个口袋——
       真正要防的"无限免费改地形"由卡的 maxCells 硬顶 + 冷却 + 素材经济一起兜。 */
    return { cells: cells, cost: (ef.mode === 'erase' || ef.conjure) ? 0 : cells.length };
  };
  /* 部分成交截断（定案 §2.2 补条款）：在一份报价 {cells, cost} 上按预算取前 N 格——
     能付几格就建几格。这是唯一的截断点：R.play 锁单与 applyEffect 旁路都走它。
     纯切片：零 rng、零 world.get，不引入第二次随机消耗（H1 的命）。 */
  R.truncateQuote = function (pr, budget) {
    if (pr.cost === 0 || budget >= pr.cost) return pr;
    var n = Math.max(0, Math.floor(Math.min(budget, pr.cells.length)));
    return { cells: pr.cells.slice(0, n), cost: n };
  };

  /* ---------- 出牌 ---------- */
  R.play = function (card, p, ctx) {
    var v = R.canPlay(card, p, ctx);
    if (!v.ok) { if (ctx.fx) ctx.fx.log(p.name + '：' + v.reason, '#ff9f9f'); return false; }
    var cr = p.creative;
    /* 报价单：地形格数/价在出牌这一刻锁定（R.priceTerrain 唯一真源），并按预算部分成交截断
       （R.truncateQuote 唯一截断点：能付几格建几格，多效果按顺序共享预算），结算按单执行——
       grow 这类带 rng 的形状不会"校验数一遍、结算又数一遍"数出两个价。
       复核（grow 的 rng 抖动边）：某效果一格没有、或建造内容一格也建不起，才整牌拒付——
       不烧牌、不扣魔、不动世界（文案沿用 canPlay 已有的两句，不新增）。 */
    var quoted = null;
    var budget = (cr && cr.freeMats) ? 1e9 : p.mats;
    for (var qi = 0; qi < card.effects.length; qi++) {
      var qef = card.effects[qi];
      if (qef.op !== 'setBlock' && qef.op !== 'cells') continue;
      var qpr = R.truncateQuote(R.priceTerrain(qef, card, p, ctx), budget);
      budget -= qpr.cost;
      (quoted = quoted || []).push({ ef: qef, cells: qpr.cells, cost: qpr.cost });
    }
    if (quoted && card.type === 'terrain') {
      var hasBuild = false, buildable = 0, empty = false;
      for (var ri = 0; ri < quoted.length; ri++) {
        if (quoted[ri].cells.length === 0) empty = true;
        if (quoted[ri].ef.mode !== 'erase') { hasBuild = true; buildable += quoted[ri].cells.length; }
      }
      if (empty || (hasBuild && buildable === 0)) {
        if (ctx.fx) ctx.fx.log(p.name + '：' + (empty ? '瞄准处无法改造（换目标或走近些）' : '素材不足'), '#ff9f9f');
        return false;
      }
    }
    ctx.quoted = quoted;
    if (!cr || !cr.infiniteMana) p.mana -= card.cost;
    if (!cr || !cr.noCooldown) p.cooldowns[card.id] = card.cooldown;
    if (p.buffNext) { p.buffNextActive = true; }
    var mult = p.buffNextActive ? (1 + p.buffNextValue) : 1;
    var used = false;
    /* 效果走 EffectSpec 规范化（setBlock → cells）；没有 effect-spec 时退回原数组，行为不变 */
    var effects = (G.EffectSpec && G.EffectSpec.expand) ? G.EffectSpec.expand(card) : card.effects;
    for (var i = 0; i < effects.length; i++) {
      var ef = effects[i];
      R.applyEffect(ef, card, p, ctx, mult);
      if (ef.op === 'setBlock' || ef.op === 'cells') used = true;
    }
    ctx.quoted = null;   // 报价单只活到这张牌结算完（ctx 是全局共享的，别漏给下一张牌）
    p.buffNextActive = false;
    /* 特效事件：只报 key + 位置，渲染侧订阅 GW.VFX 决定怎么画（不参与结算，失败也不影响出牌） */
    if (G.VFX && G.VFX.event) G.VFX.event('cast', { card: card, owner: p, side: p.side, pos: ctx.aim || { x: p.pos.x, y: p.pos.y, z: p.pos.z }, element: card.element });
    if (ctx.fx) { ctx.fx.sfx(card.type === 'terrain' ? 'terrain' : (card.type === 'sigil' ? 'sigil' : 'cast')); ctx.fx.log(p.name + ' 打出 ' + card.name, G.ELEMENTS[card.element].color); }
    return true;
  };

  R.applyEffect = function (ef, card, p, ctx, mult) {
    var w = ctx.world, m = ctx.match;
    mult = mult || 1;
    /* 原子处理器表（js/rules/effects/*）：新 op 先在这里登记，switch 只留还没迁的 */
    var fxh = G.RULES_EFFECTS && G.RULES_EFFECTS[ef.op];
    if (fxh) { fxh(ef, card, p, ctx, mult); return; }
    switch (ef.op) {
      /* EffectSpec 的 cells：把 shape 归一化回 setBlock 的旧执行分支（一次迁移期适配，行为不变） */
      case 'cells': {
        ef = Object.assign({}, ef, { op: 'setBlock' });
        /* fallthrough */
      }
      case 'setBlock': {
        /* 结算只执行报价单：R.play 锁单时已完成部分成交截断（能付几格建几格），
           这里不数格、不算价、不截断。旁路直调 applyEffect 没人报价时，现场走同一条
           priceTerrain + truncateQuote 流水线兜底——真源与截断点仍然各只有一份。 */
        var pr = null;
        if (ctx.quoted) for (var qi2 = 0; qi2 < ctx.quoted.length; qi2++) if (ctx.quoted[qi2].ef === ef) { pr = ctx.quoted[qi2]; break; }
        if (!pr) pr = R.truncateQuote(R.priceTerrain(ef, card, p, ctx), (p.creative && p.creative.freeMats) ? 1e9 : p.mats);
        var cells = pr.cells;
        if (!cells.length) return;
        if (!(p.creative && p.creative.freeMats)) {
          if (p.mats < pr.cost) { if (ctx.fx) ctx.fx.log('素材不足，改造失败', '#ff9f9f'); return; }
          p.mats -= pr.cost;
        }
        /* 飞桥（mode 'bridge'）：格子已经报价、扣过素材，但**不在这里落**——
           交给桥钉那发抛射物沿途铺。这样"沿抛物线生成过去"是真的，而不是先建好再补一段特效。 */
        if (ef.mode === 'bridge' && m.spawnBridgeQuill) { m.spawnBridgeQuill(p, cells, ef); return; }
        /* 破坏的"手感"全在这里报：每敲掉一格就给一次**按方块材质上色**的碎块，
           挖掉一大片时再补一记镜头震动。层与层之间只报事实（格子坐标 + 方块 id），
           碎块长什么样、响什么声由 main.js 的 fx 桥决定（表现层的东西不在这里写）。 */
        var broke = 0;
        for (var i = 0; i < cells.length; i++) {
          var c = cells[i];
          w.set(c.x, c.y, c.z, c.id, c.id === 0 ? null : { owner: p.side, kind: 'built', born: m.time });
          if (ef.mode === 'shift' && c.eraseAt) {
            w.set(c.eraseAt.x, c.eraseAt.y, c.eraseAt.z, 0);
            if (ctx.fx && ctx.fx.breakBlock) { ctx.fx.breakBlock(c.eraseAt.x, c.eraseAt.y, c.eraseAt.z, c.eraseAt.id); broke++; }
          }
          if (ctx.fx) {
            if (c.id === 0) {
              broke++;
              /* breakBlock：碎块 + 碎屑音（老桥没有这个方法时退回原来的小尘点，不算回归） */
              if (ctx.fx.breakBlock) ctx.fx.breakBlock(c.x, c.y, c.z, c.prev);
              else ctx.fx.dust(c.x + 0.5, c.y + 0.5, c.z + 0.5, DEFS[c.prev] ? DEFS[c.prev].color : '#999');
            } else if (ctx.fx.placeBlock) {
              ctx.fx.placeBlock(c.x, c.y, c.z, c.id);
            } else {
              ctx.fx.dust(c.x + 0.5, c.y + 1, c.z + 0.5, DEFS[c.id] ? DEFS[c.id].color : '#999');
            }
          }
        }
        /* 大片挖掘的震屏：4 格以上才抖（挖一格不抖，否则每一张地形卡都在摇镜头）。
           强度随格数涨、封顶；quake 自己会再乘一个系数并夹住。 */
        if (broke >= 4 && ctx.fx && ctx.fx.quake) ctx.fx.quake(Math.min(1.6, 0.22 + broke * 0.09));
        /* 挖除返还原地删除（定案 §2.2）：give 每格返素材让"1 魔力无限农素材"成立，不许加回来。 */
        if (ef.mode === 'fill' && ef.block === 'lava') m.addSigil(ef.block, p, ctx.aim, 0.2, 12, 'lava_pool');
        /* 放下岩浆 = 一处热源，放下冰 = 一处寒源：让物质层去接管后面的连锁
           （岩浆点着旁边的木头、把冰烤化；冰把旁边的水冻住）。
           这里只报"发生了什么"，不自己写反应结果——否则又是一个口径分散的坑。 */
        if (G.CHEM && G.CHEM.ready && ctx.aim) {
          var el = ef.block;
          /* 放下岩浆 = 一处热源，放下冰 = 一处寒源：都走"慢半拍"的那条路（warm / chill），
             让木头被烤一会儿才着、水面冻一小会儿才成冰——直接命中才要即时反馈，见 js/chem.js。 */
          if (el === 'lava') G.CHEM.warm(Math.floor(ctx.aim.x), Math.floor(ctx.aim.y), Math.floor(ctx.aim.z), (ef.radius || 1));
          else if (el === 'ice' || el === 'snow') G.CHEM.chill(Math.floor(ctx.aim.x), Math.floor(ctx.aim.y), Math.floor(ctx.aim.z), (ef.radius || 1));
        }
        break;
      }
      /* 灵光追踪：一群会拐弯的细小光点（2026-10-17 用户："现在的追踪导弹直直走过去没意思，
         要细小粒子、画弧线的烟花"）。飞行的 3D 弧线与抖动在 battle 的抛射物推进里算，
         这里只负责"放几只、打多少、什么颜色"。 */
      /* 环绕护盾：n 颗盾球绕着你转，每颗能吃 hp 发子弹（碰撞在 battle.orbBlock 里）。
         duration 到期自动消散；重复施放 = 刷新而不是叠加（避免无限叠盾）。 */
      /* 飞行：给了多少秒就飞多少秒（吃重力开关在 applyInput 里读 st.fly） */
      /* 冲刺：朝朝向给一次冲量（不是瞬移）——保留碰撞与被墙挡住的可能，手感更像"跃"而不是"闪" */
      /* 震屏：纯表现，权威层只报强度；没人接（fx 里没有 quake）时什么都不发生。 */
      /* 吸引：把敌人往爆心拽（位移是速度增量，不是瞬移——击退与吸的同一条物理通道）。 */
      /* 扣血统一走 R.damage：全项目唯一的 hp 归零检查在那一处，散落的 p.hp -= 会绕过死亡结算
         （虚空馈赠曾把血扣到负数仍不判死）。selfHarm 通道：代价穿透护盾与无敌帧，见 R.damage。 */
    }
  };

  /* ---------- 状态 ---------- */
  var NO_WHEN_INVULN = { frozen: 1, root: 1, slow: 1, burn: 1, vuln: 1 };   // 只挡负面：增益（haste/regen/sturdy）照常，否则测不了加速卡
  R.addStatus = function (t, kind, dur, power) { return G.Systems.Damage.addStatus(t, kind, dur, power); };
  R.statusSpeed = function (t) { return G.Systems.Damage.statusSpeed(t); };
  /* 伤害唯一出口：hp 的写权限在 DamageSystem；这里保留 R.damage 老入口给 rules/探针。 */
  R.damage = function (t, amount, kind, ctx, src, opts) { return G.Systems.Damage.damage(ctx && ctx.match, t, amount, kind, ctx, src, opts); };

  /* ---------- 每 tick：冷却、状态、燃烧、岩浆流动、护盾计时 ---------- */
  R.tick = function (dt, ctx) {
    var w = ctx.world, m = ctx.match;
    G.Systems.Damage.tick(m, dt, ctx);
    /* 燃烧的蔓延 / 到期成灰 / 水浇灭 / 岩浆凝黑曜石 —— 全部搬到 GW.CHEM（js/chem.js）。
       原来这段每 tick 遍历**整张 meta 表**（MetaMap 里还有 built / mine 两类），
       并且自己写一套 3×3 蔓延，跟 battle.js 抛射物点火、rules 的 ignite 是三份口径。
       现在物质交互只有一个激活队列，这里只留"谁站在火里"这种实体侧的账。 */
    if (G.CHEM && G.CHEM.step) G.CHEM.step(dt, ctx);
    // 岩浆/水流动（邻居传播，学 MC 的流体扩散，限量防失控）
    m.fluidStep(dt, ctx);
    // 法阵
    m.sigilTick(dt, ctx);
  };

  /* node 探针：把原子处理器一起装上（浏览器由 index.html 的 script 顺序装） */
  if (typeof module !== 'undefined' && module.exports) {
    ['spawn','sigil','spirit','orbShield','push','pull','blink','flight','dash','heal','shield','gainMana','manaCapDown','draw','loseHp','harvest','swap','speed','regen','buffNext','totem','damage','status','quake','ignite','destroySigil','hail'].forEach(function (n) {
      try { require('./rules/effects/' + n + '.js'); } catch (e) {}
    });
  }
})(window.GW);
