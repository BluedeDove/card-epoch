/* js/app/session.js · 会话阶段（S4）：建世界 / 建对局（从 main.js 搬出）
   app 层唯一跨层装配点的一部分；deps 由 main 显式传入，不反向抓主循环。
   阶段顺序固定：buildWorld → buildMatch → beginLoop（beginLoop 仍在 main，持有 last/acc 帧时钟）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  G.SessionRunner = {
    create: function (deps) {
      var S = deps.S;
      var scene = deps.scene, renderer = deps.renderer, fx = deps.fx, fxGroup = deps.fxGroup;
      var sun = deps.sun, hemi = deps.hemi, ambient = deps.ambient, atmAnchor = deps.atmAnchor;
      var buildWorldMeshes = deps.buildWorldMeshes, patchWorldDirty = deps.patchWorldDirty;
      var ensureCams = deps.ensureCams, makeDeck = deps.makeDeck, hashStr = deps.hashStr, pick = deps.pick;
      var ctxReady = deps.ctxReady;

function buildWorld(cfg, seed) {
    /* 地图由关卡配置决定（docs/LEVELS.md §1.1/§2），不再写死 96×40×96：
       size/sea/spawnPad 一律取 G.mapPresetFor(cfg)。默认 cfg 无 map → island-96 = 96×40×96 / sea 12 /
       spawnPad 9，与旧的写死值（World 默认 sea 12、spawnPad 9）逐字段相同，所以不选图的玩家不受影响。 */
    var preset = G.mapPresetFor(cfg);
    var worldSeed = cfg.load && cfg.load.seed !== undefined ? cfg.load.seed : seed;
    /* lodes：这张地图是关卡图（preset.lodes > 0）才长矿脉。世界本身不认识"关卡"，
       它只认这个开关；量具构造测试世界时不传 = 不长（见 src/world.js 的 opts.lodes 注释）。 */
    S.world = new G.World({ size: preset.size, sea: preset.sea, spawnPad: preset.spawnPad, seed: worldSeed, lodes: preset.lodes > 0 });
    S.world.generate();
    S.world.snapshotBaseline();
    if (cfg.load) {
      var ap = G.Save.applyTo(S.world, cfg.load);
      seed = S.world.seed;
      if (ctxReady()) ctxReady().log(ap.ok ? ('已载入存档：' + ap.cells + ' 格变更（种子 ' + seed + '）') : ('存档导入失败：' + ap.reason), ap.ok ? '#7fd97f' : '#ff9f9f');
    }
    patchWorldDirty();
    buildWorldMeshes();
    return seed;
  }

function buildMatch(cfg, seed) {
    /* 规则 → Match opts 的展开只有一个出口：src/app/rule-presets.js（docs/LEVELS.md §1.2）。
       这些数字不许再散落到 battle.js / 菜单文案里；未知 id 由 rulePresetFor 回退 ranked。
       玩法（docs/MODES.md §2）在规则**之上**：lode 把规则预设整表并进自己的 win / map 两栏，
       deathmatch 自带得分表与地图开关（无兽、无三选一、矿不给分）。下面那七个数字一律从
       modeMatchOpts 展开出的 rp 取——字段名与 rulePresetFor 的输出逐字同名，Match opts 的形状
       因此一行没改（改了形状就等于两份真源，定案 §7.3 的拒绝点）。 */
    var rpBase = (G.rulePresetFor ? G.rulePresetFor(cfg) : null) || {};
    var mode = (G.gameModeFor ? G.gameModeFor(cfg) : null) || null;
    var rp = (mode && G.modeMatchOpts) ? G.modeMatchOpts(mode, rpBase) : rpBase;
    /* 战前选牌（docs/NET.md §10 / docs/ROUTER.md §2）：联机在双方就绪后由**房主**用两份牌库开局——
       cfg.decks = [房主那副, 加入者那副]（协议里的固定顺序，**房主视角**），两个数组都在就用它建局；
       guest 这边 main.js 已按「本地视角恒 side 0」把两份换位（NET.md §9.1），所以本层不认角色、只认下标。
       合法性不在这里判（判据只有一处：src/net-loadout.js 的 validateDeck，由收货方房主调），
       本层只做形状防御：不是「两个非空数组」就整份退回 makeDeck——宁可拿默认牌库开局，
       也不让一个坏帧把 cards 写成 [undefined] 那种"进去就赢不了"的局（宁缺毋滥，与 §9.2 同一条口径）。 */
    var dl = cfg.decks;
    var bothDecks = Array.isArray(dl) && dl.length === 2 &&
      Array.isArray(dl[0]) && dl[0].length > 0 && Array.isArray(dl[1]) && dl[1].length > 0;
    var decks = bothDecks ? [dl[0].slice(), dl[1].slice()]
      : [makeDeck(cfg.deck || 'starter'), makeDeck(cfg.oppDeck || (S.mode === 'train' ? pick('random') : cfg.deck || 'starter'))];
    S.match = new G.Match({
      world: S.world, seed: seed, mode: S.mode, fx: fx, lives: 2,
      /* 名册问 hud（视图层的文案表），本层不写名字。第二个参数把模式带过去：
         联机里对面是真人，叫「AI 对手」读着不对（docs/NET.md §9.5 / 任务书 N3 第 6b 条）。
         单人 / 分屏那条路径的行为逐字不变（playerNames 只在 mode==='net' 时换名册）。 */
      players: 2, cards: decks, names: G.HUD.playerNames(S.split, S.mode),
      /* 关卡的六个规则参数 + AI 等级：全部来自 rp（不传 = battle.js 的既有默认，逐字节旧行为） */
      scoreWin: rp.scoreWin, timeCap: rp.timeCap, overtimeCap: rp.overtimeCap,
      holdGrace: rp.holdGrace,
      /* 晶甲兽归规则（docs/LEVELS.md §1.2 的唯一真源），但 **guest 一律 0**（docs/NET.md §9.1 的 uid 对账）：
         中立实体由房主生成、经快照按 uid 下发；guest 本地再长一批就是另一串 uid，
         net-match 的 reconcile 会把两边各造的那些当成「快照里没有的 uid」反复建删（随从在屏幕上闪）。
         注意 guest 的镜像仍然要"看得见"兽——它是从房主快照里建出来的，不是自己长的。 */
      beasts: (cfg.net && cfg.net.role === 'guest') ? 0 : rp.beasts,
      draftCapLode: rp.draftCapLode, draftCapBeast: rp.draftCapBeast,
      /* 魔力档（只有"街机"那条规则给了）：从**规则预设本体** rpBase 取，不从玩法合并后的 rp 取——
         modeMatchOpts 的字段表只认玩法表那几项，魔力不属于玩法。
         undefined = Match 的既有常量（8 上限 / +0.9 每秒），所以其它档逐字节不变。 */
      manaCap: rpBase.manaCap, manaRegen: rpBase.manaRegen
    });
    /* 编排类（src/app/match-director.js，docs/MODES.md §3 / §4）：建完 Match 再挂——它要读 match 的钟与 players[]。
       终局三个参数以**玩法**为准（规则只出数值）；target 0 = 不限分 → 分数线保留 create 里那个"到不了的数"
       （game-modes 的 UNREACHABLE），所以这一行写成 `mode.win.target || S.match.scoreWin`。
       begin() 立刻进 live：今天的对局是"建完就打"，没有 prep 倒计时（哪天真做倒计时，改这一处就够）。
       modeCfg 留给 HUD 与量具只读（顶栏积分榜的玩法名、结算的击杀/死亡两行都读它）。 */
    if (mode && G.MatchDirector) {
      S.match.modeCfg = mode;
      S.match.director = G.MatchDirector.create(mode, S.match);
      S.match.scoreWin = mode.win.target || S.match.scoreWin;
      S.match.timeCap = mode.win.timeCap;
      S.match.overtimeCap = mode.win.overtimeCap;
      S.match.director.begin();
    }
    ensureCams();
    // 机位三个跟随通道由 snapToTarget 统一落到目标值并清速度；不要在这里直接写 curRadius，
    // 那会绕过通道写状态（cam.pos 必须是 eyeBase/yaw/半径/侧移/抬升 的纯函数）
    for (var i = 0; i < 2; i++) if (S.cams[i] && S.cams[i].snapToTarget) S.cams[i].snapToTarget();
    S.sources = [];
    S.sources.push(new G.Net.KeyboardSource({
      fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ShiftLeft',
      /* 转向只有鼠标（Minecraft 口径，用户 2026-10-17 要求）：Q/E 不再转身，E 让给背包。
         俯仰留 F/V 作可访问性兜底（不锁鼠标时也能看地面/天空）。
         验收里量键盘转向的 cam_audit G 项自己建 KeyboardSource 并显式传 lookL/lookR，不读这张表。 */
      lookU: 'KeyF', lookD: 'KeyV',
      cast: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']
    }, { mouseLook: true }));
    if (S.mode === 'split') {
      S.sources.push(new G.Net.KeyboardSource({
        fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight',
        lookL: 'BracketLeft', lookR: 'BracketRight', lookU: 'BracketLeft', lookD: 'BracketRight', jump2: 'Enter',
        cast: ['KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5']
      }, { mouseLook: false }));
    } else if (S.mode === 'net') {
      /* 联网（docs/NET.md §9.1）：两端都只挂"本机键盘 + 一条远端输入队列"，**不生成 AISource**——
         AI 与真人同通道，给 guest 那位塞个 AI 等于让房主替别人出牌（`inputs[1]` 的席位只能有一个主人）。
         · 房主：poll() 每 tick 从队列取一条 guest 的 input，缺帧 = 空白输入（net.js 的 RemoteInputSource）；
         · guest：这条队列没人往里 push（它不跑 Match.step，见 main.js 的 frame 分支），poll 恒空白——
           留着它是为了让两端的 sources 形状一致（2 个源、side 0 恒本机），视图模型不用认角色。
         本机这一路恒 side 0（§9.1 的本地视角恒为 0），鼠标转向照常由 KeyboardSource 的 mouseLook 出。 */
      S.sources.push(new G.Net.RemoteInputSource());
    } else if (S.mode === 'train') {
      /* AI 等级归规则（docs/LEVELS.md §1.2：ranked/blitz = 1，训练场 = 0 最弱）；cfg.level 仍可点名覆盖 */
      S.sources.push(new G.Net.AISource(S.match, 1, (cfg.level !== undefined ? cfg.level : rp.aiLevel)));
    }
    // 分屏时 P2 视角自动锁向对手（键盘转向不够用）
    if (S.mode === 'split') S.autoFace = true; else S.autoFace = false;
    G.HUD.hideMenu(); G.HUD.hideResult(); if (G.HUD.hideLevel) G.HUD.hideLevel(); G.HUD.setSplit(S.split);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var lh0 = document.getElementById('lockHint'); if (lh0) { lh0.classList.add('on'); clearTimeout(S.hintTimer); S.hintTimer = setTimeout(function () { lh0.classList.remove('on'); }, 7000); }
    G.HUD.resetSel();
    S.alpha = 1; S.animT = 0;
    if (cfg.creative && G.Creative) G.Creative.enable(true, true);
    if (G.Creative) G.Creative.attach(S.match);   // 默认关；按 G 或菜单勾选才给 players[0] 挂标记
    /* 特效渲染层：每开一局重新 attach（宿主表按实体身份存，重开后那些实体都是新的）。
       它只读 match 与相机，不写任何权威状态；配方名一律从 GW.VFX 的绑定表查。 */
    if (G.VFXR && G.VFXR.attach) G.VFXR.attach({ scene: scene, group: fxGroup, match: S.match, world: S.world, cameras: function (s9) { return S.cams[s9] ? S.cams[s9].cam : null; } });
    /* 大气层：天气是权威状态（上面那条 tick 负责推进），大气只是它的读者。
       这层不认识 HUD 也不碰实体，收下的只有场景、渲染器、三盏灯、世界、对局与一个锚点取值函数。 */
    if (G.WEATHER) G.WEATHER.bind(S.world, { seed: seed });
    if (G.ATMOS) G.ATMOS.attach({
      scene: scene, renderer: renderer, world: S.world, match: S.match,
      lights: { sun: sun, hemi: hemi, ambient: ambient },
      anchor: function () {
        var c0 = S.cams && S.cams[0], c1 = S.split ? S.cams && S.cams[1] : null;
        if (!c0) return null;
        if (!c1) return c0.pos;
        atmAnchor.x = (c0.pos.x + c1.pos.x) / 2; atmAnchor.y = (c0.pos.y + c1.pos.y) / 2; atmAnchor.z = (c0.pos.z + c1.pos.z) / 2;
        return atmAnchor;
      }
    });
  }

      return { buildWorld: buildWorld, buildMatch: buildMatch };
    }
  };
})(window.GW);
