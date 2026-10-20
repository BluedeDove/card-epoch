/* ================= GW.Battle =================
   实体、体素碰撞物理、抛射物、随从 AI、法阵、胜负。
   权威 tick：所有状态变更集中在 Match.step()，输入只是指令流（便于日后换联网）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  /* node（play_probe 等）没有 script 序列：A1-b 的 LodeSystem 在这里挂上（同 world.js 的 A1-a 先例）。
     浏览器由 index.html 的 script 序列挂载（挂载前 Match 构造是守卫式 null，对局照常、矿脉不产分）。 */
  if (typeof require === 'function') {
    try { require('./lode-system.js'); } catch (e) {}
    /* 三选一卡池（纯数据，定案 CARD_ECONOMY §2.1）：浏览器由 index.html 挂载，node 这边同样挂上——
       否则 G.PICK_POOLS 不存在，offerDraft 会静默返回 null、占矿三选一在量具里等于没做（同 LodeSystem 那条先例）。 */
    try { require('./cards/pick-pools.js'); } catch (e) {}
    try { require('./core/rng.js'); } catch (e) {}
    try { require('./systems/match-ops.js'); } catch (e) {}
    try { require('./systems/stats.js'); } catch (e) {}
    try { require('./systems/scoreboard.js'); } catch (e) {}
    try { require('./systems/fluid.js'); } catch (e) {}
    try { require('./systems/orb.js'); } catch (e) {}
    try { require('./systems/deck.js'); } catch (e) {}
    try { require('./systems/aim.js'); } catch (e) {}
    try { require('./systems/projectile.js'); } catch (e) {}
    try { require('./systems/summon.js'); } catch (e) {}
    try { require('./systems/movement.js'); } catch (e) {}
    try { require('./systems/sigil.js'); } catch (e) {}
  }
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS, W = G.World;
  var GRAV = 24, JUMP = 9.2, SPEED = 5.6, REACH = 9;
  /* 起跳容错（秒）。逻辑 tick 是 20Hz（一帧 0.05s），不给窗口就等于把"跳"掐在 tick 缝上：
     早按半帧、或者刚走出草台边缘那一步，按键直接被吞——真机 160FPS 下这种吞键最容易被读成"操作失灵"。
     COYOTE=离地后还算踩得住的时间；JBUF=按下后把这次起跳记下来的时间。
     窗口必须按 tick 数定：落地是**本 tick 末尾**的 collideAABB 才写进 onGround 的，
     下一轮判断时缓冲已经白烧掉一 tick，所以 JBUF 给到 4 个 tick（0.20s）。
     实测：提前 0.10s 按键仍能在落地时补跳，提前 0.40s 不补（tools/jump_window.cjs 量）。 */
  var COYOTE = 0.12, JBUF = 0.20;
  /* 魔力经济（定案 docs/CARD_ECONOMY.md §1/§3.1）：起始 3、上限 8、+0.9/秒，攒满 1 点才入账（累加器）。
     旧值 cap 10 / +1.0 整点等于"挂机一会儿就白拿满蓝"，出牌节奏没有稀缺点；定案把上限压到 8、速率 0.9。
     占矿那 +0.15/秒 由 LodeSystem.manaBonusOf 回答"给不给"，**写 p.mana 仍然只在 battle.js**
     （定案 §3.1：一个字段一个家，不许让矿脉系统反写玩家字段）。
     opts.manaCap / opts.manaRegen 是量具与测试的注入位（同 leadEnabled 口径：读设置是 app 层的活）。 */
  var MANA_CAP = 8, MANA_REGEN = 0.9;
  /* 俯仰范围唯一真源（camera.js 的 LIM 读同一份，别再各写各的）。
     取 ±89° 而不是 ±90°：越肩相机构图用 lookAt，视线与 up=(0,1,0) 完全平行时 up×z 退化成零向量，
     three r128 靠"给 z 加一点"救回来，但那一刻横滚会跳。差 1° 肉眼看不出，稳得多。
     旧值 -0.85/+0.72（≈低头 49°/抬头 41°）是早期防"相机翻过头顶"的土办法，
     大俯仰真正该管的是机位别沿臂飞到头顶——见 camera.js _solve 的 pitch 收臂。 */
  var LOOK_LIMIT = G.LOOK_LIMIT = { up: 89 * Math.PI / 180, down: -89 * Math.PI / 180 };

  function V(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  V.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  /* 掉出世界要回出生点，历史上这里调 pos.copy() 而 V 没有 copy，
     于是每个 tick 都在 Match.step 里抛 TypeError，主循环连渲染都跑不到——画面永久定住。 */
  V.prototype.copy = function (o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; };
  V.prototype.clone = function () { return new V(this.x, this.y, this.z); };
  V.prototype.len = function () { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); };
  G.V = V;

  function baseEntity(o) {
    return Object.assign({
      kind: 'summon', side: 0, pos: new V(0, 0, 0), vel: new V(0, 0, 0),
      hp: 20, maxHp: 20, shield: 0, shieldT: 0, st: {}, stPow: {}, cooldowns: {},
      alive: true, dead: false, yaw: 0, onGround: false, invuln: 0, w: 0.6, h: 1.7,
      // 起跳容错的三个状态位（见 COYOTE/JBUF）：必须显式初始化，undefined + dt 会变 NaN 而且永远判不出窗口
      groundT: 99, jumpBuf: 0, prevJump: false
    }, o);
  }
  G.baseEntity = baseEntity;

  /* 生态单位的落点（T4 晶甲兽）：矿点「旁边一格」的可站面。
     候选顺序写死（东→南→西→北→四个斜角），取第一根脚下踩得实、头顶两格净空的柱子——
     不用 spawnPoint/GroundProbe 的环形搜索（一次 ~4100 次 world.get，会把开局顶过 play_probe 的
     H6 安全带），也不用 findStanding（那是玩家召唤入口的落点解析，带 owner/瞄准语义）。
     返回的是**脚底面**（topY）；实在找不到就退回矿点台面顶块之上，物理与 unstick 负责顶上空气，
     绝不把单位埋进方块。全程零 rng、零写入。 */
  function beastStandCell(w, lode) {
    var OFF = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    var solid = function (x, y, z) { var id = w.get(x, y, z); return !!id && !!DEFS[id] && !!DEFS[id].solid; };
    for (var k = 0; k < OFF.length; k++) {
      var cx = lode.x + OFF[k][0], cz = lode.z + OFF[k][1];
      if (!w.inB(cx, 1, cz) || !w.inB(cx, w.SY - 2, cz)) continue;
      var gy = w.camGroundY(cx, cz);
      if (gy < 1 || !solid(cx, gy, cz)) continue;
      if (solid(cx, gy + 1, cz) || solid(cx, gy + 2, cz)) continue;      // 身体 h 1.7 → 要两格净空
      return { x: cx, y: gy + 1, z: cz };
    }
    return { x: lode.x, y: lode.y + 1, z: lode.z };
  }

  /* ================= Match ================= */
  function Match(opts) {
    this.world = opts.world;
    this.seed = opts.seed >>> 0;
    this.rngs = G.RngStreams ? new G.RngStreams(this.seed) : null;
    this.rng = this.rngs ? this.rngs.get('legacy') : G.mulberry32(this.seed ^ 0x9e3779b9);
    this.mode = opts.mode || 'train';         // train | hotseat | split | net
    /* 弹道提前量总开关（A-1）：权威层只认构造参数，不自己读 localStorage——
       读设置是 app 层的活，由它 new Match 时注入（GAMEPLAY §7.1 条 14）。缺省开。 */
    this.leadEnabled = opts.leadEnabled !== false;
    this.time = 0; this.tick = 0;
    this.rev = 0; this.stats = G.MatchStats ? G.MatchStats.create() : null;
    this.players = [];
    this.summons = [];
    this.projectiles = [];
    this.sigils = [];
    this.fx = opts.fx || { log: function () {}, sfx: function () {}, burst: function () {}, dust: function () {}, hit: function () {}, heal: function () {}, shieldUp: function () {}, fire: function () {}, float: function () {}, ambient: function () {}, quake: function () {} };
    /* 魔力档位（定案 §3.1）：默认可机检的两个常量，量具要换档就从 opts 注入，别在结算里再写一份数字 */
    this.manaCapOf = (opts.manaCap != null) ? opts.manaCap : MANA_CAP;
    this.manaRegenOf = (opts.manaRegen != null) ? opts.manaRegen : MANA_REGEN;
    this.lives = opts.lives || 2;               // 命数保留为记录字段（复活流程照旧）；胜负已改看分数（定案 §2.1）
    this.kills = [0, 0];
    /* Scoreboard（ARCHITECTURE 词汇表里的既有类，实现在此）：100 分胜、480s 硬上限、平分进加时。
       lives 字段保留（HUD/结算面板与 creative 兜底仍在读），但不再充当胜负判据。 */
    this.scoreWin = opts.scoreWin ?? 100;   // 胜分默认 100 = 已验证现状；测试侧显式传 75（A2-c 纪律：新行为默认关闭，误提交不改变玩家行为）
    /* timeCap / overtimeCap 改为读 opts（docs/LEVELS.md §1.2：三条规则各有自己的钟，
       数字的真源在 src/app/rule-presets.js，不许在结算器里再写死一份）。
       缺省值仍是 480 / 45 = 改动前的常量，所以不传 opts 的既有量具与双击开局都不漂移。 */
    this.timeCap = opts.timeCap ?? 480; this.overtime = false;
    this.overtimeStart = 0; this.overtimeCap = opts.overtimeCap ?? 45;   // 加时硬上限 45s（A1-b2 机制线拍板：加时是异常分支越短越好——
    // 定案 §2.1 的加时本意是"给一个决断机会"而不是"再打一段"；且闭合点 480+45=525s 必须留余量落在探针 540s 安全网之前，
    // 贴边（如 60s）会让一次 tick 抖动把逐级判变成窗口截断）
    this.over = null;
    /* 编排类（src/app/match-director.js）由装配层挂：session.buildMatch 里
       `match.director = G.MatchDirector.create(mode, match)`（docs/MODES.md §4 钩子 4）。
       这里只给 null：battle 不认识任何玩法，判据全在 director + 玩法表里；
       null 就是今天的结算（Scoreboard 直接判 100 分 / 480s / 45s 加时）。 */
    this.director = null;
    /* LodeSystem（L4 第五类活体，js/lode-system.js）：未挂载时守卫为 null（浏览器待 UI 线接线），
       击杀分与超时判分不受影响——矿脉只是没产出。 */
    this.lodeSys = G.LodeSystem ? new G.LodeSystem(this, opts) : null;
    /* 三选一（定案 CARD_ECONOMY §2 S2 + §2.1，任务书 T3）：名义群系排列 + 待处理队列 + 两条额度。
       群系由 seed 派生（三矿必定互不相同：林海 / 黄沙 / 雪原），取样走另一条独立流——
       两条都用 G.mulberry32 现造，**都不许消耗 this.rng**：legacy 序列被地形/陨星/环境粒子共用，
       也别改成 this.rngs.get('draft')——core/rng.js 的 HASH 表里没有这个名字，未知名字会退回 legacy 盐，
       那等于又与地形/陨星共用一条序列（同一条纪律，别绕回去）：
       构造期多抽一次号就把 play_probe 的 H1 / T 组基线整体平移了（lode-planter 文件头同一条纪律）。
       队列只存 {side,source,biome,options}；弹不弹、怎么弹归视图层（T5 复用背包通路），这里只管账。 */
    var biomeOrder = ['forest', 'desert', 'tundra'];
    var rngB = G.mulberry32((this.seed ^ 0xB10E) >>> 0);
    for (var bI = biomeOrder.length - 1; bI > 0; bI--) {
      var bJ = Math.floor(rngB() * (bI + 1));
      var bT = biomeOrder[bI]; biomeOrder[bI] = biomeOrder[bJ]; biomeOrder[bJ] = bT;
    }
    var lodeList = (this.world.lodes && this.world.lodes.list) || [];
    this.lodeBiomes = [];
    for (var lI = 0; lI < lodeList.length && lI < biomeOrder.length; lI++) this.lodeBiomes.push(biomeOrder[lI]);
    this.draftRng = G.mulberry32((this.seed ^ 0xD4A7) >>> 0);
    this.drafts = [];                                  // 同一条队列装下所有三选一（占矿 + 兽首杀），一次只弹一个
    this.draftCapLode = opts.draftCapLode ?? 3;        // 每人整局 3 次（§2 S2）
    this.draftCapBeast = opts.draftCapBeast ?? 3;      // 兽首杀另开额度，与占矿合计最多 6 次（§7 表「三选一上限」）
    this.draftUsed = { lode: [0, 0], beast: [0, 0] };
    /* 晶甲兽（定案 GAMEPLAY §2.5 / CARD_ECONOMY §2 S3，任务书 T4）：每矿一只中立生态。
       **默认关闭**——opts.beasts 不传或为 0 时一只都不生成：现有对局（play_probe、双击 index.html
       的默认图、所有既有回归）逐字节不变，误提交不改变玩家实际玩到的东西（A2-b 那条规矩）。
       只有关卡配置显式传数才上线；数字是只数上限（与矿数取小），生成顺序按 world.lodes.list 下标。
       不走 spawnSummon：那是「玩家打牌召唤」的入口（施法特效 + 随机落点 + owner 归属 + 45s ttl），
       生态单位不是谁召唤出来的——直接进 m.summons，数值全给死值、零 rng。 */
    var beastCap = opts.beasts === true ? 1e9 : (opts.beasts | 0);
    this.beasts = [];
    if (beastCap > 0) {
      var beastLodes = (this.world.lodes && this.world.lodes.list) || [];
      for (var beI = 0; beI < beastLodes.length && this.beasts.length < beastCap; beI++) {
        var bHome = beastLodes[beI];
        var beast = baseEntity({
          kind: 'summon', side: -1, name: (G.SUMMON_CN && G.SUMMON_CN.crystal_beast) || '晶甲兽',
          aiKind: 'crystal_beast', hp: 40, maxHp: 40, dmg: 6, speed: 2.8, ai: 'melee',
          mode: 'direct', leash: 10, home: { x: bHome.x + 0.5, z: bHome.z + 0.5 },
          ttl: 1e9, atkCd: 0, state: 'guard', alive: true,
          fly: false, range: 9, suicide: false, boltEl: 'void', projSpeed: 24
        });
        var bSpot = beastStandCell(this.world, bHome);
        beast.pos.set(bSpot.x + 0.5, bSpot.y + beast.h / 2 + 0.02, bSpot.z + 0.5);
        beast.uid = fxUid(this); beast.born = this.time;
        this.summons.push(beast);
        this.beasts.push(beast);
      }
      if (this.beasts.length) this.touch('summons');
    }
    this.night = false; this.dayT = 0; this.dayLen = opts.dayLen || 120;
    this.fluidQueue = []; this.fluidT = 0;
    this.ctx = { world: this.world, match: this, fx: this.fx, rng: this.rng };
    /* 出生点只算一次（A-1）：spawnPoint 的平地螺旋每次要 ~4100 次 world.get（实测），
       复活时重算会把单 tick 顶过 play_probe H6 的 4000 安全带（修命中后击杀真的发生了才暴露）。
       点在开局 pristine 世界上就是确定的，缓存语义也正是定案 §2.1 的"回出生点"。 */
    this.spawnPts = [];
    for (var spI = 0; spI < (opts.players || 2); spI++) this.spawnPts.push(this.world.spawnPoint(spI));
    for (var i = 0; i < (opts.players || 2); i++) this.players.push(this.makePlayer(i, opts.cards ? opts.cards[i] : null, opts.names ? opts.names[i] : null));
    this.placePlayers();
    /* 物质层（GW.CHEM）绑定到这场对局：激活队列按世界格数分配一次，随机流与对局分开。
       按 R 重开 / 读档都会重新 new 一个 Match，所以每次重新 bind，队列不会带着上一局的火。 */
    if (G.CHEM) G.CHEM.bind(this.world, this);
  }
  /* 状态版本号：凡是权威写都递增；selector 用它判断要不要重算（S3）。 */
  Match.prototype.touch = function (domain, i) {
    this.rev = (this.rev || 0) + 1;
    if (domain === 'players' && this.players && this.players[i]) this.players[i].rev = (this.players[i].rev || 0) + 1;
    return this.rev;
  };
  Match.prototype.makePlayer = function (side, deckIds, name) {
    var sp = this.spawnPts[side];
    var deck = (deckIds && deckIds.length ? deckIds : G.STARTER_DECK).slice();
    var p = baseEntity({
      kind: 'player', side: side, name: name || ('P' + (side + 1)),
      pos: new V(sp.x, sp.y + 0.92, sp.z), hp: 100, maxHp: 100, w: 0.62, h: 1.8,
      /* 起始 3 蓝 / 上限 8 / +0.9 每秒、起始素材 8（定案 §1）：素材 5 那档让开局第一张墙都砌不满，
         8 = 至少买得起一次 6 格墙 + 还有余量，按格计价（R.priceTerrain）才是真源 */
      /* handKept：切到某一类之前那副手牌（切回「全部」时优先还原它，见 systems/deck.js 的 fillAll）。
         不参与任何结算，只是玩家整理手牌的记忆。 */
      deck: deck, hand: [], discard: [], handClass: null, handKept: null, autoLast: null, attackClass: 'all', mana: 3, manaCap: this.manaCapOf, manaAcc: 0, regen: this.manaRegenOf,
      mats: 8, kills: 0, yaw: side === 0 ? Math.PI * 0.25 : -Math.PI * 0.75, pitch: 0,
      lives: this.lives, respawn: 0, score: 0, aim: null, aimTarget: null
    });
    for (var i = 0; i < 5; i++) this.drawCards(p, 1, true);
    p.eye = function () { var cp = Math.cos(p.pitch); return { x: p.pos.x, y: p.pos.y + 1.55, z: p.pos.z }; };
    return p;
  };
  Match.prototype.placePlayers = function () {
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i], s = this.spawnPts[i];
      p.pos.set(s.x, s.y + p.h / 2 + 0.02, s.z); p.vel.set(0, 0, 0); p.onGround = false;
    }
  };
  Match.prototype.all = function () { return this.players.concat(this.summons); };
  Match.prototype.livingPlayers = function () { return this.players.filter(function (p) { return p.alive; }); };

  /* ---------- 牌库：抽 / 弃 / 洗（全部走 match.rng，可复现） ---------- */
  Match.prototype.reshuffle = function (p) { return G.Systems.Deck.reshuffle(this, p); };
  Match.prototype.drawCards = function (p, n, silent) { return G.Systems.Deck.drawCards(this, p, n, silent); };
  Match.prototype.handCard = function (p, i) { return G.Systems.Deck.handCard(this, p, i); };
  Match.prototype.cardTypeSet = function () { return G.Systems.Deck.cardTypeSet(this); };
  Match.prototype.cardType = function (id) { return G.Systems.Deck.cardType(this, id); };
  /* cardGroup = 这张卡的**出牌组**（cards.js 的 role：放置/破坏/移动/远程/法阵/超阶/召唤/辅助）。
     deck.js 的 inClass 走 m.cardGroup（"状态容器配方法"与 cardType 同一条口径）。 */
  Match.prototype.cardGroup = function (id) { return G.Systems.Deck.cardGroup(this, id); };
  Match.prototype.siftType = function (arr, type) { return G.Systems.Deck.siftType(this, arr, type); };
  Match.prototype.equipClass = function (p, type) { return G.Systems.Deck.equipClass(this, p, type); };
  Match.prototype.takeFromHand = function (p, i) { return G.Systems.Deck.takeFromHand(this, p, i); };
  Match.prototype.placeHand = function (p, slot, id, opts) { return G.Systems.Deck.placeHand(this, p, slot, id, opts); };
  Match.prototype.swapHand = function (p, a, b2) { return G.Systems.Deck.swapHand(this, p, a, b2); };
  /* 2026-10-18：拖拽的两种"换位置"各走一条唯一通道（都不造牌）——
     moveHand 手持栏内部换位（卡已在光标上、数组已短一格，语义是插入），
     dealFromDeck 从牌库换一张进手持栏（被顶下来的那张原位回牌库）。 */
  Match.prototype.moveHand = function (p, slot, id) { return G.Systems.Deck.moveHand(this, p, slot, id); };
  Match.prototype.dealFromDeck = function (p, slot, id) { return G.Systems.Deck.dealFromDeck(this, p, slot, id); };
  Match.prototype.discardSlot = function (p, i) { return G.Systems.Deck.discardSlot(this, p, i); };
  Match.prototype.stowDiscard = function (p, id) { return G.Systems.Deck.stowDiscard(this, p, id); };
  Match.prototype.refillHand = function (p) { return G.Systems.Deck.refillHand(this, p); };
  /* ---------- 三选一：入牌库与待处理队列（定案 CARD_ECONOMY §2 S2/S3、GAMEPLAY §7.1 条 9） ----------
     入本局牌库只有一个出口：选中卡 ×2 进牌库并立即重洗。UI / app 侧不许自己 p.deck.push
     （那是绕过权威层写状态），要走 MatchOps.grantCard → 这里。取样只吃 this.draftRng 这一条专用流，
     所以"同 seed 同操作顺序可复现"不依赖别的系统有没有抽过号。 */
  Match.prototype.grantCard = function (p, cardId, times) {
    if (!p || !p.deck) return { ok: false, reason: 'no-player' };
    if (!G.CARDS_BY_ID[cardId]) return { ok: false, reason: 'no-card', deckSize: p.deck.length };
    var n = Math.max(1, (times || 1) | 0), i;
    for (i = 0; i < n; i++) p.deck.push(cardId);
    /* 「立即重洗」＝洗**整副牌库**（不然两张新卡永远压在牌库顶，白送一次确定手感）。
       这里**不能**调 this.reshuffle：deck.js 那份 reshuffle 的语义是"牌库抽干了把弃牌堆倒回来"
       （p.deck = p.discard.slice()），拿它当"洗牌"会把没抽的牌库连刚发的牌一起吞掉。
       所以就地做同一条 Fisher-Yates、同一条 this.rng 序列（与抽牌同源，确定性命门不变）。 */
    for (var k = p.deck.length - 1; k > 0; k--) {
      var j = Math.floor(this.rng() * (k + 1));
      var t = p.deck[k]; p.deck[k] = p.deck[j]; p.deck[j] = t;
    }
    this.touch('players', p.side);
    return { ok: true, deckSize: p.deck.length };
  };
  /* 排一次三选一：先问额度（占矿 3 / 兽 3，分开计），再问"这一方手上是不是已经挂着一次没处理"——
     同一方同时只有一个待处理 offer（§2 S2「一次只弹一个」），重复触发直接返回 null，不排队不覆盖。
     biome 传进来是本矿的名义群系；认不出来（或池子没挂）就退回通用池，但**不许**发一个凑不满 3 张的 offer。 */
  Match.prototype.offerDraft = function (side, source, biome) {
    var caps = { lode: this.draftCapLode, beast: this.draftCapBeast };
    var used = this.draftUsed[source];
    if (!used || !(caps[source] > 0)) return null;                 // 未知来源 / 额度关成 0：不发，也不猜
    if (used[side] >= caps[source]) return null;                    // 这一方这一类的整局次数用尽
    for (var i = 0; i < this.drafts.length; i++) if (this.drafts[i].side === side) return null;
    var pools = G.PICK_POOLS || {};
    var key = pools[biome] ? biome : 'neutral';
    var bag = (pools[key] || []).slice();
    if (bag.length < 3) return null;                                // 池子里货不够：宁可不发
    for (var k = 0; k < 3; k++) {                                  // 前缀洗牌：只洗出前 3 个位置，天然不重复
      var j = k + Math.floor(this.draftRng() * (bag.length - k));
      var t = bag[k]; bag[k] = bag[j]; bag[j] = t;
    }
    var offer = { side: side, source: source, biome: key, options: bag.slice(0, 3) };
    this.drafts.push(offer);
    this.touch('drafts');
    return offer;
  };
  /* 视图层只问这一个：现在该弹谁的三选一（没有就 null）。队列顺序 = 触发顺序。 */
  Match.prototype.pendingDraft = function () { return this.drafts[0] || null; };
  /* 选中：×2 入牌库 → 计一次次数 → 出队。卡不在 options 里、或这一方根本没有待处理 offer，
     一律 ok:false 且**什么都不动**（offer 留着、次数不烧、牌库不变）——"不许假成功"这条。 */
  Match.prototype.takeDraft = function (side, cardId) {
    var idx = -1;
    for (var i = 0; i < this.drafts.length; i++) if (this.drafts[i].side === side) { idx = i; break; }
    if (idx < 0) return { ok: false, reason: 'no-offer' };
    var offer = this.drafts[idx];
    if (!cardId || offer.options.indexOf(cardId) < 0) return { ok: false, reason: 'not-in-options' };
    var got = this.grantCard(this.players[side], cardId, 2);
    if (!got.ok) return { ok: false, reason: got.reason };          // 卡表里没这张：次数与 offer 都原样留着
    this.draftUsed[offer.source][side]++;
    this.drafts.splice(idx, 1);
    this.touch('drafts');
    return { ok: true, cardId: cardId, deckSize: got.deckSize };
  };
  /* 跳过：同样出队并计一次次数——定案 §2 S2「跳过不返还」，否则"先看一眼再跳过"是免费的额外抽卡。 */
  Match.prototype.skipDraft = function (side) {
    var idx = -1;
    for (var i = 0; i < this.drafts.length; i++) if (this.drafts[i].side === side) { idx = i; break; }
    if (idx < 0) return { ok: false, reason: 'no-offer' };
    var offer = this.drafts[idx];
    this.draftUsed[offer.source][side]++;
    this.drafts.splice(idx, 1);
    this.touch('drafts');
    return { ok: true };
  };
  Match.prototype.defaultAim = function (p) { return G.Systems.Aim.defaultAim(this, p); };
  /* ---------- 快捷键出牌（2026-10-17 用户："万物皆牌，但不是每张牌都要打出去才能用"） ----------
     按 Shift → 在手牌里找第一张 hot==='shift' 且能出的牌 → 朝**移动方向**出牌并消耗。
     方向优先用按键方向（WASD 组合），没有方向就用朝向。走的是同一条 playCard 通道，
     所以费用/冷却/结算/日志完全一致，不存在"快捷键特权"。 */
  Match.prototype.useHotkey = function (p, hot, dirX, dirZ) { return G.Systems.Aim.useHotkey(this, p, hot, dirX, dirZ); };
  /* ---------- 自动开火（按住左键连发，src/systems/auto.js） ----------
     pick 只挑不结算；fire 走 playCard 那条唯一通道。两个方法都在权威层，
     装配层（main.js）只负责"左键按住/松开"和节流，不在这里复刻任何选择规则。 */
  Match.prototype.autoPick = function (p) { return G.Systems.Auto ? G.Systems.Auto.pick(this, p) : null; };
  Match.prototype.autoFire = function (p) { return G.Systems.Auto ? G.Systems.Auto.fire(this, p) : { ok: false, reason: 'no-auto' }; };
  Match.prototype.playCard = function (p, index) {
    if (!p.alive || index < 0 || index >= p.hand.length) return false;
    var card = G.CARDS_BY_ID[p.hand[index]];
    if (!card) return false;
    /* 瞄准新鲜度（A-1 修命中的一环）：'auto' 出处（上一枪由权威层兜底解析）的 aim 不能留到下一枪——
       旧逻辑里 defaultAim 的落点会粘住整场对局，AI 之后所有牌都射向第一张牌时的位置，
       这是 play_probe 命中率 1.2% 的几何根因之一（train 模式的真人对手也踩同一个坑）。
       这类射手每次出牌前用同一套 updateAim、从眼睛与 yaw/pitch 重新解析；
       'ext'（相机视轴，真机每帧刷新）与外部手写的 aim（aimSrc 未设）一律原样信任，
       准星=命中格 的不变量不受影响。 */
    if (p.aimSrc === 'auto') {
      var cph = Math.cos(p.pitch || 0);
      this.updateAim(p, p.eye ? p.eye() : { x: p.pos.x, y: p.pos.y + 1.55, z: p.pos.z },
        { x: Math.sin(p.yaw) * cph, y: Math.sin(p.pitch || 0), z: Math.cos(p.yaw) * cph }, true);
    }
    if (!p.aim) {
      p.aim = this.defaultAim(p);                                 // 永远有落点，避免空引用
      if (p.aimSrc !== 'ext') p.aimSrc = 'auto';                  // 兜底落点不许粘到下一枪
    }
    this.ctx.aim = p.aim; this.ctx.aimTarget = p.aimTarget;
    var ok = G.Rules.play(card, p, this.ctx);
    /* 创造模式"卡牌不消耗"：留在手上可以连发同一张，看法阵/弹道的重复表现。
       走的是同一条 playCard 通道，所以结算、日志、fx 与正式模式完全一致。 */
    if (ok && !(p.creative && p.creative.noConsume)) { p.hand.splice(index, 1); p.discard.push(card.id); this.refillHand(p); }
    return ok;
  };

  /* ---------- 体素 AABB 物理：逐轴推进 + 滑墙 ---------- */
  Match.prototype.collideAABB = function (e, dt) { return G.Systems.Movement.collideAABB(this, e, dt); };
  /* ---------- 输入应用（指令流 → 状态） ---------- */
  /* 卡住检测：整个身体都在实心格内时，把自己顶到最近的地面之上 */
  Match.prototype.unstick = function (e) { return G.Systems.Movement.unstick(this, e); };
  Match.prototype.applyInput = function (p, inp, dt) { return G.Systems.Movement.applyInput(this, p, inp, dt); };
  Match.prototype.applyLook = function (p, lookYaw, lookPitch) { return G.Systems.Movement.applyLook(this, p, lookYaw, lookPitch); };
  /* ---------- 瞄准：相机射线选目标 + 玩家射线校验遮挡 ---------- */
  /* aimSrc 记录这一枪瞄准的出处：'ext' = 外部解析器给的（真机 main.js 每渲染帧用相机视轴调），
     'auto' = 权威层自己解析的（没人给瞄准的射手：headless 探针、train 模式的 AI）。
     playCard 只信 'ext' 与"外部手写进来的 aim"（aimSrc 未设，hit_check 就是这么摆的）。 */
  Match.prototype.updateAim = function (p, origin, dir, internal) { return G.Systems.Aim.updateAim(this, p, origin, dir, internal); };
  Match.prototype.rayEntity = function (from, origin, dir, maxD) { return G.Systems.Aim.rayEntity(this, from, origin, dir, maxD); };
  Match.prototype.aimEntity = function (p, aim) { return G.Systems.Aim.aimEntity(this, p, aim); };
  Match.prototype.targetsInRadius = function (p, aim, r) { return G.Systems.Aim.targetsInRadius(this, p, aim, r); };
  Match.prototype.entitiesAt = function (x, y, z) { return G.Systems.Aim.entitiesAt(this, x, y, z); };
  Match.prototype.findStanding = function (p, dest) { return G.Systems.Aim.findStanding(this, p, dest); };
  /* ---------- 特效接线（GW.VFX）：只报 key 与位置，不存视觉累加量 ----------
     旋转/抖动/生长进度一律由渲染侧每帧现算：GW.VFX.frameOf(entity, time, dt, role)。
     这里只给实体一个稳定 uid 当确定性随机的种子——存档只存差异格、不存实体，
     所以恢复后 uid 重排只换种子，判定与结算看不见这些量。 */
  function fxUid(m) { return (m._fxUid = (m._fxUid || 0) + 1); }
  function fxEv(name, data) { if (G.VFX && G.VFX.event) G.VFX.event(name, data); }
  Match.prototype.fxEvent = fxEv;

  /* ---------- 抛射物 ---------- */
  Match.prototype.fireProjectile = function (p, card, ef, ctx, mult) { return G.Systems.Projectile.fireProjectile(this, p, card, ef, ctx, mult); };
  Match.prototype.explode = function (src, aim, amount, kind, radius, ctx, opts) { return G.Systems.Projectile.explode(this, src, aim, amount, kind, radius, ctx, opts); };
  Match.prototype.fxColor = function (kind) { return G.Systems.Projectile.fxColor(this, kind); };
  Match.prototype.spawnHail = function (p, aim, dmg, i) { return G.Systems.Projectile.spawnHail(this, p, aim, dmg, i); };
  Match.prototype.stepProjectiles = function (dt) { return G.Systems.Projectile.stepProjectiles(this, dt); };
  /* ---------- 飞桥的桥钉（2026-10-17）----------
     用户的原话："桥应该朝一个方向扔出去、抛物线生成过去，不该点到哪生成哪"。
     做法：报价与扣素材仍在 rules.js（唯一真源、唯一截断点），这里只负责**把已经付过账的格子
     沿途铺下去**——抛物线是桥钉的轨迹，格子跟随它落地，于是"桥是扔出去长出来的"是真的。 */
  Match.prototype.spawnBridgeQuill = function (p, cells, ef) {
    if (!cells || !cells.length) return null;
    var o = p.eye ? p.eye() : { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z };
    var last = cells[cells.length - 1];
    var tx = last.x + 0.5, tz = last.z + 0.5;
    var L = Math.hypot(tx - o.x, tz - o.z) || 1;
    var sp = 17, span = Math.max(0.36, L / sp);
    var pr = {
      uid: fxUid(this), entKind: 'projectile', born: this.time,
      pos: new V(o.x, o.y, o.z), vel: new V(0, 0, 0),
      life: span, owner: p, side: p.side, dmg: 0, kind: 'physical',
      element: 'rock', radius: 0, fuse: 0, status: null, aiKind: 'bridge_quill',
      color: (G.ELEMENTS.rock && G.ELEMENTS.rock.color) || '#c9a06b',
      paint: cells, painted: 0, paintR: 1.05,
      x0: o.x, y0: o.y, z0: o.z, tx: tx, tz: tz,
      ty: last.y + 0.5, span: span,
      lift: Math.min(2.4, 0.6 + L * 0.16)
    };
    this.projectiles.push(pr);
    if (this.fx.sfx) this.fx.sfx('sigil');
    return pr;
  };
  /* 抛物线：x/z 线性走完，y 叠一条 4·lift·u(1−u) 的拱。u 由剩余寿命反推，纯函数、可重放。 */
  Match.prototype.stepQuill = function (pr, dt) {
    var u = Math.max(0, Math.min(1, 1 - pr.life / pr.span));
    pr.pos.set(pr.x0 + (pr.tx - pr.x0) * u,
               pr.y0 + (pr.ty - pr.y0) * u + 4 * pr.lift * (u - u * u),
               pr.z0 + (pr.tz - pr.z0) * u);
    this.paintBridge(pr, pr.life <= 0);
  };
  /* 把"离桥钉足够近"的格子落地；桥钉到点时（all）把剩下的一次补齐——
     飞进山体里提前收工也不会留下半座桥。 */
  Match.prototype.paintBridge = function (pr, all) {
    var cells = pr.paint;
    if (!cells) return 0;
    var w = this.world, n = 0, r2 = pr.paintR * pr.paintR;
    for (var i = pr.painted; i < cells.length; i++) {
      var c = cells[i];
      var dx = (c.x + 0.5) - pr.pos.x, dy = (c.y + 0.5) - pr.pos.y, dz = (c.z + 0.5) - pr.pos.z;
      if (!all && (dx * dx + dy * dy + dz * dz) > r2) break;
      w.set(c.x, c.y, c.z, c.id, c.id === 0 ? null : { owner: pr.side, kind: 'built', born: this.time });
      if (this.fx.dust) this.fx.dust(c.x + 0.5, c.y + 0.5, c.z + 0.5, '#d8c39a');
      pr.painted = i + 1; n++;
    }
    if (all && pr.painted < cells.length) return this.paintBridge(pr, true) + n;
    return n;
  };

  /* ---------- 追踪体转向与索敌（2026-10-17） ----------
     turn = 每秒最大转角；weave/weaveHz = 横摆幅度与频率；两者都是卡的数值。
     零随机：相位只来自序号，同 seed 同 tick 轨迹可重放。 */
  Match.prototype.steerProjectile = function (pr, dt) { return G.Systems.Projectile.steerProjectile(this, pr, dt); };
  Match.prototype.acquireTarget = function (pr) { return G.Systems.Projectile.acquireTarget(this, pr); };
  Match.prototype.fireSpirit = function (p, card, ef, ctx, mult, idx) {
    var o = p.eye ? p.eye() : { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z };
    var a = (ctx && ctx.aim) || p.aim || { x: o.x, y: o.y, z: o.z + 8 };
    var dx = a.x - o.x, dy = a.y - o.y, dz = a.z - o.z;
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var n = Math.max(1, ef.count || 3);
    var spread = (idx - (n - 1) / 2) * 0.24;
    var ca = Math.cos(spread), sa = Math.sin(spread);
    var vx = (dx / L) * ca - (dz / L) * sa, vz = (dx / L) * sa + (dz / L) * ca;
    var sp = ef.speed || 26;
    var el = (card && card.element) || 'void';
    var pr = {
      uid: fxUid(this), entKind: 'projectile', born: this.time,
      pos: new V(o.x, o.y, o.z),
      vel: new V(vx * sp, (dy / L) * sp + 2.5, vz * sp),
      life: ef.life || 2.8, owner: p, side: p.side, dmg: ef.amount * (mult || 1),
      kind: ef.kind || (el === 'phys' ? 'physical' : el), element: el,
      radius: ef.radius || 0, fuse: ef.fuse || 1.05, status: null,
      aiKind: (card && card.id) || 'spirit', color: (G.ELEMENTS[el] || {}).color || '#c58cff',
      home: true, turn: ef.turn || 3.6, weave: ef.weave === undefined ? 0.9 : ef.weave,
      weaveHz: ef.weaveHz || 2.6, weavePhase: idx * 1.7, target: null
    };
    this.projectiles.push(pr);
    if (this.fx.sfx) this.fx.sfx('shoot');
    return pr;
  };

  /* ---------- 环绕护盾（2026-10-17 用户："盾不该只是加个数，要漂在你身边、实时碰撞帮你挡子弹"） ----------
     每个盾球是一个**有位置的实体**（角度 + 半径 + 生命），每 tick 绕人转；
     抛射物的那一小段轨迹只要撞进盾球的判定球，子弹就没了——这是真碰撞，不是数值减免。
     状态挂在玩家身上（p.orbs / p.orbSpec），同一套判定对双方生效。 */
  Match.prototype.orbPos = function (p, i) { return G.Systems.Orb.pos(this, p, i); };
  Match.prototype.stepOrbs = function (dt) { return G.Systems.Orb.step(this, dt); };
  Match.prototype.orbBlock = function (pr, ax, ay, az, bx, by, bz) { return G.Systems.Orb.block(this, pr, ax, ay, az, bx, by, bz); };

  Match.prototype.hitTestEntity = function (pr) { return G.Systems.Projectile.hitTestEntity(this, pr); };
  Match.prototype.hitTestSegment = function (pr, ax, ay, az, bx, by, bz) { return G.Systems.Projectile.hitTestSegment(this, pr, ax, ay, az, bx, by, bz); };
  /* ---------- 随从 AI（简单状态机：待机→索敌→攻击→撤退） ---------- */
  Match.prototype.spawnSummon = function (owner, ef, card, aim) { return G.Systems.Summon.spawnSummon(this, owner, ef, card, aim); };
  Match.prototype.removeSummon = function (s) { return G.Systems.Summon.removeSummon(this, s); };
  Match.prototype.stepSummons = function (dt) { return G.Systems.Summon.stepSummons(this, dt); };
  Match.prototype.aiAggro = function (s) { return G.Systems.Summon.aiAggro(this, s); };
  Match.prototype.stepFlyer = function (s, target, dist, dt) { return G.Systems.Summon.stepFlyer(this, s, target, dist, dt); };
  Match.prototype.summonBolt = function (s, target) { return G.Systems.Summon.summonBolt(this, s, target); };

  Match.prototype.addSigil = function (card, owner, aim, delay, ttl, presetId) { return G.Systems.Sigil.addSigil(this, card, owner, aim, delay, ttl, presetId); };
  Match.prototype.sigilAt = function (aim) { return G.Systems.Sigil.sigilAt(this, aim); };
  Match.prototype.sigilTick = function (dt, ctx) { return G.Systems.Sigil.sigilTick(this, dt, ctx); };
  Match.prototype.digCrater = function (x, y, z, r, depth, budget) {
    var w = this.world, cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    var rr = Math.max(1, Math.round(r || 2)), dep = Math.max(1, Math.round(depth || 2));
    var left = budget || 60, edits = 0;
    for (var ix = -rr; ix <= rr; ix++) for (var iz = -rr; iz <= rr; iz++) {
      var dd = Math.sqrt(ix * ix + iz * iz) / rr;
      if (dd > 1) continue;
      var h = Math.max(1, Math.round(dep * (1 - dd * dd)));
      for (var k = 0; k < h && left > 0; k++) {
        var wx = cx + ix, wy = cy - k, wz = cz + iz;
        if (!w.inB(wx, wy, wz)) continue;
        var id = w.get(wx, wy, wz);
        if (!id || id === B.BEDROCK) continue;
        w.set(wx, wy, wz, 0); left--; edits++;
      }
    }
    return edits;
  };

  /* ---------- 终末（核弹级，2026-10-17） ----------
     用户的原话："最好有一种核弹级别的、毁天灭地的、整幅地图一起大家玩没了的"。
     所以这张卡**不区分敌我**：半径内的所有实体（含施放者）一起吃伤害，地形直接塌出一口大碗。
     结算口径与其它伤害完全一致（G.Rules.damage 是唯一出口），所以护盾/无敌/复活照常生效。 */
  Match.prototype.detonateNuke = function (s) {
    var ps = s.preset, nk = ps.nuke || {};
    var center = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    var radius = nk.radius || 30, dmg = nk.dmg || 58;
    var all = this.all(), i;
    for (i = 0; i < all.length; i++) {
      var e = all[i];
      if (!e.alive) continue;
      var dx = e.pos.x - center.x, dz = e.pos.z - center.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > radius) continue;
      var f = Math.max(0.35, 1 - 0.65 * Math.min(1, d / radius));
      G.Rules.damage(e, dmg * f, ps.kind || 'fire', this.ctx, s.owner || null);
      if (e.vel && e.alive) {
        var l = d || 1;
        e.vel.y += 7 * f;
        e.vel.x += dx / l * 15 * f; e.vel.z += dz / l * 15 * f;
      }
    }
    /* 地形：一口碗（与陨星落点同一个挖坑器）。预算封顶 900 格——一次性大招，
       别让某一帧的 remesh 把帧率拖进手感里。 */
    var edits = this.digCrater(center.x, center.y, center.z, nk.craterR || 13, nk.craterDepth || 8, 900);
    this.fx.burst(center, '#ffd86b', 34);
    if (this.fx.quake) this.fx.quake(1.8);
    if (this.fx.sfx) this.fx.sfx('boom');
    fxEv('nuke', { pos: center, radius: radius, kind: ps.kind || 'fire', color: ps.color });
    G.chemCatalyst(ps.kind || 'fire', center, Math.max(3, Math.round(radius * 0.35)));
    return edits;
  };

  /* 陨星：从高空斜着砸进阵里，落点带随机偏移（同种子同序列）。
     走的是**玩家那条抛射物通道**（子步推进 / 近失圈 / 命中起爆 / 物质层催化全复用），
     所以它砸在树上会着火、砸在水面会起汽，不需要另写一套。 */
  Match.prototype.spawnMeteor = function (s) {
    var ps = s.preset, w = this.world;
    var spread = ps.meteorSpread || 3;
    var x = s.pos.x + (this.rng() - .5) * spread * 2;
    var z = s.pos.z + (this.rng() - .5) * spread * 2;
    x = Math.min(w.SX - 2, Math.max(2, x)); z = Math.min(w.SZ - 2, Math.max(2, z));
    var gy = w.surfaceY(Math.floor(x), Math.floor(z)) + 1.2;
    var startX = x + 5.5, startZ = z + 5.5;
    var startY = Math.max(s.pos.y + 22, gy + 22);
    var dx = x - startX, dy = gy - startY, dz = z - startZ;
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, sp = 38;
    var el = ps.kind || 'fire';
    var pr = {
      uid: fxUid(this), entKind: 'projectile', born: this.time,
      pos: new V(startX, startY, startZ),
      vel: new V(dx / L * sp, dy / L * sp, dz / L * sp),
      life: L / sp + 0.25, owner: s.owner || this.players[s.side], side: s.side,
      dmg: ps.meteorDmg || 20, kind: el, element: el,
      radius: ps.meteorRadius || 2.6, fuse: 1.4, status: null,
      aiKind: 'meteor_rain', color: (G.ELEMENTS[el] || {}).color || '#ff7a45',
      /* 每个陨星落地都砸出一口碗（用户："每一颗都要有破坏效果"）。 */
      dig: ps.meteorDig || null
    };
    this.projectiles.push(pr);
    this.fx.sfx('shoot');
    return pr;
  };

  /* ---------- 流体逐格传播（限量，防失控） ---------- */
  Match.prototype.fluidStep = function (dt, ctx) { return G.Systems.Fluid.step(this, dt, ctx); };

  /* ---------- 死亡与胜负 ---------- */
  Match.prototype.kill = function (t, src, ctx) {
    if (t.dead) return;
    /* 创造模式不判负：无敌时伤害本来就不落地，这里再兜一道，
       免得某个结算把血直接写成 0 就把调试中的对局判掉。 */
    if (t.kind === 'player' && t.creative && t.creative.invuln) { t.hp = t.maxHp; t.shield = t.shield || 0; return; }
    t.dead = true; t.alive = false;
    this.touch('players', t.side);
    if (G.MatchStats) G.MatchStats.bump(this, t.side, 'deaths', 1);
    this.fx.burst({ x: t.pos.x, y: t.pos.y + 1, z: t.pos.z }, '#ffffff', 26);
    this.fx.sfx(t.kind === 'player' ? 'die' : 'summonDie');
    /* 击杀的"手感"由表现层决定（谁在镜头上、要不要重顿一下），权威层只报"是谁杀的谁"。 */
    if (this.fx.kill) this.fx.kill(t, src);
    if (t.kind === 'summon') {
      this.removeSummon(t); this.fx.log(t.name + ' 被击杀', '#c9d3e0');
      if (src && src.kind === 'player') {
        src.kills++;
        if (G.MatchStats) G.MatchStats.bump(this, src.side, 'kills', 1);
        if (t.side < 0) {
          /* 中立生态首杀（定案 CARD_ECONOMY §2 S3 / GAMEPLAY §2.5）：+3 素材 + 一次三选一（通用池），
             并**不走**原来那条「击杀随从抽 1 张」——设计给野怪的就是这两样，多发一张牌等于
             把「清野」变成第二条成长口（§6 明确不许给同一件事发两份钱）。
             不重生、不重复发奖：rewarded 记在**这只**身上（不记在矿上，矿上那条是 LodeSystem.drafted），
             加上 kill() 开头的 dead 守卫，同一只第二次进来一张素材都不给。 */
          if (!t.rewarded) {
            t.rewarded = true;
            src.mats += 3;
            this.offerDraft(src.side, 'beast', 'neutral');
            this.fx.log(src.name + ' 击杀 ' + t.name + '：+3 素材，排一次三选一', '#ffd86b');
          }
        } else {
          // side >= 0 的玩家随从：逐字保持原行为（击杀补 1 张是卡牌线的既有口径）
          this.drawCards(src, 1, true); this.fx.log(src.name + ' 击杀随从，抽 1 张', '#7fd97f');
        }
      }
      return;
    }
    var p = t;
    /* 命数退役为纯记录字段（定案 §2.1）：保留并照常扣减（HUD 与结算面板还在读），
       夹 0 不出负数；胜负不再看它——击杀 +15 分进 Scoreboard，分数/时间才判终局。 */
    p.lives = Math.max(0, p.lives - 1);
    if (src && src.kind === 'player' && src !== p) {
      src.kills++;
      if (G.MatchStats) G.MatchStats.bump(this, src.side, 'kills', 1);
      this.fx.log(src.name + ' 击杀了 ' + p.name, '#ffd86b');
      /* 击杀分交给编排类（docs/MODES.md §4 钩子 1）：director 在位就只报事件，
         几分、几杀算赢、要不要结束这一局都由它按玩法表判（它入账仍走 addScore 这个唯一入分口）；
         没挂 director（所有既有量具与不选玩法的老路径）逐字走老分支——击杀 +15（定案 §2.1）。
         日志与 MatchStats 那两条在本行之上，两个分支共用，不改。 */
      if (this.director) this.director.onKill(src.side, p.side); else this.addScore(src, 15);
    }
    this.fx.log(p.name + ' 倒下（剩余生命 ' + Math.max(0, p.lives) + '）', '#ff9f9f');
    p.respawn = 2.2;
  };
  /* 出生点可站面（T8 语义收口，A1-b；A1-b2 抽成共用助手）：缓存点可能被对手改造埋掉——
     用 GroundProbe 复查该柱的可站面（camGroundY 口径跳树叶；maxRing 0 = 只查原柱、不挪窝），
     可站面被垫到缓存落点之上 = 被埋，沿柱顶到可站面；地面被挖低不动（那一小段摔落由重力物理兜）。
     全程只读世界、一格不写、零 rng（save 的 diff 与 chem 的 onSet 纪律，§7.1 条 18）。
     respawnPlayer 与坠落兜底（pos.y<-6）共用——后者曾是同一条埋人路径的漏网分支。 */
  Match.prototype.spawnStandY = function (side) {
    var s = this.spawnPts[side];
    var at = G.GroundProbe.find(this.world, Math.floor(s.x), Math.floor(s.z), { maxRing: 0, angles: 1, margin: 0, ground: 'cam' });
    return Math.max(s.y, at ? at.y + 1 : s.y);
  };
  Match.prototype.respawnPlayer = function (p) {
    var s = this.spawnPts[p.side];
    p.pos.set(s.x, this.spawnStandY(p.side) + p.h / 2 + 0.02, s.z); p.vel.set(0, 0, 0);
    p.hp = p.maxHp; p.shield = 0; p.shieldT = 0; p.st = {}; p.invuln = 2.5;
    p.alive = true; p.dead = false; p.respawn = 0;
    /* 复活不补魔（定案 §2.1）：旧值 4 ≈ 4 秒回复量，等于死亡白送一笔魔力，"送人头"成了可接受策略 */
    p.mana = Math.min(p.manaCap, 2);
    this.fx.log(p.name + ' 复活', '#7fd97f');
  };
  /* ---------- 以太晶采掘回执（定案 §3.3）----------
     harvest 命中晶体后只报三个坐标：排队、12 秒原位再生都归 LodeSystem 管（§3.3 的唯一写格路径），
     这里只是转发口。矿脉系统未挂载（浏览器 script 序列还没接）时返回 false——采掉就是采掉，不假装会再生。 */
  Match.prototype.onCrystalHarvested = function (x, y, z) {
    return this.lodeSys ? this.lodeSys.onHarvest(x, y, z) : false;
  };
  /* ---------- Scoreboard：得分与终局（定案 §2.1；ARCHITECTURE 词汇 battle/Scoreboard 的落地） ---------- */
  /* 唯一入分口：击杀（kill）与占矿产出（LodeSystem）都走这里。
     到线即停：100 分立即胜；加时态下任何入账立即胜（平分加时 = 下一个得分事件定胜负）。 */
  Match.prototype.addScore = function (p, n) { return G.Systems.Scoreboard.addScore(this, p, n); };
  /* 编排类在位时这一格整个交给它（docs/MODES.md §4 钩子 3）：阶段、时限、加时与逐级判定
     都按玩法表走；不在位 = 老逻辑逐字不变（G.Systems.Scoreboard.step）。 */
  Match.prototype.scoreboardStep = function (dt) {
    if (this.director) { this.director.tick(dt); return; }
    return G.Systems.Scoreboard.step(this, dt);
  };
  Match.prototype.finish = function (winnerSide, reason) { return G.Systems.Scoreboard.finish(this, winnerSide, reason); };
  /* over 字段保持原形状（winner/name/ticks/time，结算面板逐字在读）；
     winReason 是新增的可选字段（score/time/overtime/manual），面板现在不读它——
     读 undefined 的事故不许发生；面板显示胜负原因是 UI 欠账（见 A1B_REPORT）。 */
  /* ---------- 主 tick：顺序固定，保证确定性 ---------- */
  Match.prototype.step = function (dt, inputs) {
    if (this.over) return;
    this.snapshotPrev();          // ← 渲染插值的前提：先记住"本 tick 之前"在哪（见文件末尾 renderPos）
    this.time += dt; this.tick++;
    if (this.dayLock) this.dayT = (this.dayLock === 'night' ? this.dayLen * 0.7 : this.dayLen * 0.15);
    this.dayT += dt; this.night = (this.dayT % this.dayLen) > this.dayLen * 0.6;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive) { if (p.respawn > 0) { p.respawn -= dt; if (p.respawn <= 0) this.respawnPlayer(p); } continue; }
      /* 魔力回复（定案 §3.1）：基础 regen + 占矿加成一起进累加器，攒满 1 点才入账（不整点白送）。
         到顶清零头——否则攒着的进度会在放开上限那一刻整段倒进蓝条。加成只问 LodeSystem 要一个数，
         写 p.mana / p.manaAcc 的仍然只有这一处。 */
      var bonus = this.lodeSys ? this.lodeSys.manaBonusOf(p.side) : 0;
      p.manaAcc += dt * (p.regen + bonus);
      while (p.manaAcc >= 1 && p.mana < p.manaCap) { p.manaAcc -= 1; p.mana++; }
      if (p.mana >= p.manaCap) p.manaAcc = 0;
      if (p.creative) this.creativeUpkeep(p);   // 创造调试模式（GW.Creative）；标记为 null 时零开销
      var inp = inputs[i] || {};
      this.applyInput(p, inp, dt);
      if (inp.cast !== undefined && inp.cast >= 0) this.playCard(p, inp.cast);
    }
    // 旁观模式相机（无玩家时）
    this.stepSummons(dt);
    this.stepOrbs(dt);
    this.stepProjectiles(dt);
    G.Rules.tick(dt, this.ctx);
    /* ---- L4 阶段：矿脉归属与得分（LodeSystem + Scoreboard，定案 §7.4 步 6）----
       插入位置写死在这里的理由（阶段顺序是确定性命门，别挪）：
       ① 归属判定读"本 tick 的最终位置与存活态"——必须在 applyInput（移动）与 Rules.tick
         （伤害/死亡结算）之后，否则本 tick 被打死的尸体还多占一秒矿、多产一分；
       ② 产出与胜负判定紧随同一 tick 的位置结算：分数到线即停，不多结一秒；
       ③ 在 ambient 环境粒子之前——纯表现永远排最后。 */
    if (this.lodeSys) this.lodeSys.step(dt);
    this.scoreboardStep(dt);
    // 环境粒子：飘落的花/雪
    if ((this.tick % 14) === 0) {
      var p0 = this.players[0];
      var bm = this.world.biomeAt(Math.floor(p0.pos.x), Math.floor(p0.pos.z));
      this.fx.ambient(bm, p0.pos, this.rng);
    }
  };

  /* ---------- 渲染插值（移动丝滑的关键）----------
     权威 tick 是 20Hz，真机渲染 160FPS：角色位置每 8 帧才变一次，画面就是"一顿一顿"。
     改动前实测（/tmp/feel_probe.cjs，seed 490706，按住 W 巡航）：
       72.6% 的渲染帧角色位移恰好为 0，单帧最大/平均位移比 3.95，相机 6.13。
     修法不改物理：每个 tick 开头把位置存进 e.ppos，主循环按 acc/STEP 在 ppos→pos 之间
     插值，只决定"画在哪"。判定、命中、存档仍然读 e.pos（权威值），所以验收口径不变。
     超过阈值的位移不插值（瞬移/复活/被顶出/高速抛射物起点）：否则 blink 的 9 格会被拉成
     一帧滑过，相机也进不了"传送"分支（camera.js 按 eye 跳变 jump>2 判定，见 AGENTS 视角不变量）。 */
  var INTERP_MAX = { player: 2.6, summon: 2.2, projectile: 3.4 };   // 单 tick 内还算是"连续运动"的位移上限
  Match.prototype.snapshotPrev = function () {
    var lists = [this.players, this.summons, this.projectiles];
    for (var i = 0; i < lists.length; i++) {
      var L = lists[i];
      for (var j = 0; j < L.length; j++) {
        var e = L[j]; if (!e || !e.pos) continue;
        if (!e.ppos) e.ppos = e.pos.clone(); else e.ppos.copy(e.pos);
      }
    }
  };
  /* out 由调用方给（每帧复用同一批 V），这里不 new，免得 160FPS 下把 GC 拖进手感里。 */
  Match.prototype.renderPos = function (e, alpha, out) {
    var p1 = e.pos, p0 = e.ppos;
    if (!out) out = e.rpos || (e.rpos = new V(0, 0, 0));
    if (!p0 || !(alpha >= 0 && alpha <= 1)) { out.set(p1.x, p1.y, p1.z); return out; }
    var dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    var cap = INTERP_MAX[e.entKind || e.kind] || 2.0;
    if (dx * dx + dy * dy + dz * dz > cap * cap) { out.set(p1.x, p1.y, p1.z); return out; }
    out.set(p0.x + dx * alpha, p0.y + dy * alpha, p0.z + dz * alpha);
    return out;
  };

  /* ---------- 创造调试模式（标记对象由 GW.Creative 挂到 players[0].creative）----------
     这里只是"权威侧的维护"：补蓝、清冷却、锁昼夜由 Match 自己按 tick 做，
     结算分支（费用/冷却/素材/伤害/状态）在 rules.js 里读同一个标记。 */
  Match.prototype.creativeUpkeep = function (p) {
    var o = p.creative;
    if (o.infiniteMana) { p.mana = p.manaCap; p.manaAcc = 0; }
    if (o.noCooldown) { for (var k in p.cooldowns) p.cooldowns[k] = 0; }
    if (o.invuln && p.hp < p.maxHp) p.hp = p.maxHp;
  };
  /* 训练假人：放在指定侧（默认 1，让 P1 的卡牌能打中它），不会还手、不会消失。 */
  Match.prototype.spawnDummy = function (side, hp) {
    var owner = this.players[1 - (side === undefined ? 1 : side)];
    if (!owner) return null;
    var d = baseEntity({
      kind: 'summon', side: side === undefined ? 1 : side, name: '训练假人', aiKind: 'golem', dummy: true,
      hp: hp || 9999, maxHp: hp || 9999, dmg: 0, speed: 0, ai: 'none', taunt: false,
      ttl: 1e9, atkCd: 1e9, state: 'idle'
    });
    var f = { x: Math.sin(owner.yaw), z: Math.cos(owner.yaw) };
    var st = this.findStanding(owner, { x: owner.pos.x + f.x * 3.2, y: owner.pos.y, z: owner.pos.z + f.z * 3.2 });
    d.pos.set(st.x, st.y + d.h / 2 + 0.02, st.z);
    d.uid = fxUid(this); d.born = this.time;
    this.summons.push(d);
    this.fx.burst({ x: d.pos.x, y: d.pos.y + 1, z: d.pos.z }, '#ffd86b', 18);
    return d;
  };

  G.Match = Match;
  /* crystal_beast 是**中立生态**（side -1，GAMEPLAY §2.5），不是任何玩家召唤出来的：
     名字仍放这张表（任务书 T4：不许碰 UI/文案，SUMMON_CN 就是权威层的名字表）。 */
  G.SUMMON_CN = { golem: '岩石魔像', dryad: '树精', wisp: '烬羽', wisp_void: '浮灵', hawk: '雷隼', bee: '爆蜂', crystal_beast: '晶甲兽' };
  G.PHYS = { GRAV: GRAV, SPEED: SPEED, REACH: REACH };
})(window.GW);
