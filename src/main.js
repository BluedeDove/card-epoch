/* ================= main =================
   引导 + 渲染 + 粒子 + 主循环 + 输入绑定。
   逻辑固定 20Hz 权威 tick，渲染与逻辑分离（学 Minecraft 的 tick/render 拆分）。
   ================================================= */
(function () {
  'use strict';
  var G = window.GW, B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  var STEP = 1 / 20;

  var canvas = document.getElementById('gl');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = false;

  var scene = new THREE.Scene();
  function skyTexture(topHex, botHex) {
    var cv = document.createElement('canvas'); cv.width = 4; cv.height = 128;
    var cg = cv.getContext('2d');
    var g = cg.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, topHex); g.addColorStop(0.62, botHex); g.addColorStop(1, botHex);
    cg.fillStyle = g; cg.fillRect(0, 0, 4, 128);
    var tx = new THREE.CanvasTexture(cv);
    tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearFilter;
    return tx;
  }
  var SKY = { day: skyTexture('#4d8fe0', '#bcdcf6'), night: skyTexture('#0b1030', '#26305a') };
  scene.background = SKY.day;
  scene.fog = new THREE.Fog(0x9ec9ff, 46, 150);

  var hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a4360, 0.85); scene.add(hemi);
  // 太阳方向读 G.SUN_DIR 同一份真源（js/world.js）：顶点色里的影子与这盏灯必须同向
  var sun = new THREE.DirectionalLight(0xfff2d0, 0.75); sun.position.set(G.SUN_DIR[0], G.SUN_DIR[1], G.SUN_DIR[2]); scene.add(sun);
  var ambient = new THREE.AmbientLight(0xffffff, 0.18); scene.add(ambient);

  var atlas = G.buildAtlas();
  var matSolid = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, side: THREE.FrontSide });
  var matLiquid = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.74, side: THREE.DoubleSide, depthWrite: false });
  /* 冰这类 solid 但 opaque:false 的方块：单独一份几何 + 单独材质（三个 pass 见 buildChunkGeometry）。
     alpha 的依据（2026-10-16 网络调研，逐像素量过原版纹理）：Minecraft 的 ice.png 全图统一 alpha=190/255≈0.745，
     water_still≈0.706 —— 冰"像不像冰"不靠更透，靠图案对比 + 下面那层透出来一点。这里取 0.78：
     本项目的冰同时是**能踩能滑的地板**（rules 的 onIce、battle 的 acc×0.06），再透就没人看得出那是一层地面。
     depthWrite:true 是必须的：three.js 不对同一 mesh 内的三角形做排序（WebGLRenderLists 只按物件排），
     成排体素用 depthWrite:false 会"后面的冰画到前面冰之上"；水那套 false+DoubleSide 只适合单层连续水面，别照搬给冰。 */
  var matGlass = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.78, side: THREE.FrontSide, depthWrite: true });

  var worldGroup = new THREE.Group(); scene.add(worldGroup);
  var entGroup = new THREE.Group(); scene.add(entGroup);
  var fxGroup = new THREE.Group(); scene.add(fxGroup);

  var S = { world: null, match: null, cams: [], sources: [], split: false, running: false, mode: 'train', cfg: null, helpOn: false, fps: 0,
            alpha: 1, animT: 0, camView: [], draftOpenFor: null };
  window.GWAPP = S;
  var APP = (G.AppState && G.AppState.create) ? G.AppState.create() : null;
  if (APP) S.app = APP;

  /* ---------- 体素网格：分块烘焙，只重建脏块 ---------- */
  // 顶点级环境光遮蔽：角落比平面暗，体素立体感的关键
  /* ---------- 体素网格：烘焙在 src/app/chunk-mesher.js ---------- */
  var CM = G.ChunkMesher.create({ atlas: atlas, materials: { solid: matSolid, liquid: matLiquid, glass: matGlass }, group: worldGroup });
  function makeChunk(cx, cz) { return CM.makeChunk(S.world, cx, cz); }

  /* ---------- 世界网格管理：build/flush/cull 抽到 src/app/world-view.js ---------- */
  var WV = G.WorldView.create({ group: worldGroup, makeChunk: makeChunk });
  S.chunkMeshes = WV.chunks;
  function buildWorldMeshes() { WV.build(S.world); }
  function flushDirty(budget) { WV.flush(S.world, budget); }
  function cullFarChunks() { WV.cull(S.world, S.match, scene.fog ? scene.fog.far : 150); }

  // world.set() 把脏块写进 world.dirty（Set），这里补上接口
  function patchWorldDirty() {
    var w = S.world;
    if (w._patched) return;
    w._patched = true;
    var orig = w.set.bind(w);
    w.set = function (x, y, z, id, extra) {
      var r = orig(x, y, z, id, extra);
      return r;
    };
  }

  /* ---------- 角色/随从/抛射物的像素模型：随从抽到 src/app/entity-view.js ---------- */
  var summonMeshes = [], heroMeshDirty = true;
  var heroes = [];
  var makeNameTag = function (side) { return G.HeroView.makeTag(fxGroup, side); };
  var updateNameTag = G.HeroView.updateTag;
  function ensureHeroMeshes() { G.HeroView.ensure(heroes, entGroup, fxGroup); }
  var makeSummonMesh = G.EntityView.summonMesh;
  var PV = G.ProjectileView.create({ group: entGroup, renderPos: function (e) { return rp(e); } });

  /* ---------- 法阵网格：抽到 src/app/sigil-view.js ---------- */
  var SV = G.SigilView.create();
  var sigilTexture = SV.texture, buildSigilMesh = SV.build, disposeSigilMesh = SV.dispose, setSigilOpacity = SV.setOpacity;

  var sigilMeshList = [];   // 建过网格的法阵实体，用来回收（旧版这张表从来没被写过，等于没有清理）

  /* ---------- 粒子/飘字：抽到 src/app/particles.js（纯表现，不写权威） ---------- */
  var P = G.Particles.create({ group: fxGroup });
  var emit = P.emit, stepParticles = P.step, floatText = P.floatText, stepFloats = P.stepFloats;
  /* 2026-10-18 起粒子有"碎块"与"浮尘"两条更专门的入口；老浏览器缓存里没有时退回 emit（不抛）。 */
  var debris = P.debris || null, puff = P.puff || null;

  /* ---------- fx 桥接（给 Match / Rules 用） ---------- */
  var fx = {
    log: function (m, c) { G.HUD.log(m, c); },
    sfx: function (n) { G.Audio.play(n); },
    burst: function (p, color, n) { emit(p.x, p.y, p.z, color, Math.min(n || 12, 34), 5.5); },
    dust: function (x, y, z, color) { emit(x, y, z, color || '#c9d3e0', 8, 3); },
    /* 方块被敲碎：rules.js 每挖掉一格报一次（坐标 + 方块 id）。
       颜色用**那一格自己的方块色**——挖石头出灰渣、挖草皮出绿土，这一条比数量更决定"爽不爽"。
       碎块落到方块底面会弹一下；同帧只响一次 dig（门面 28ms 节流），连挖就是碎石雨。 */
    breakBlock: function (x, y, z, id) {
      var d = G.BLOCK_DEFS && G.BLOCK_DEFS[id];
      var col = (d && d.color) || '#9aa4b2';
      var cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
      if (debris) debris(cx, cy, cz, col, 10, { floor: y + 0.05, spread: 2.6 });
      else emit(cx, cy, cz, col, 10, 4);
      if (G.Audio) G.Audio.play('dig');
    },
    /* 方块放下：一小团浮尘 + 几粒碎屑（颜色仍是这块自己的颜色）。
       与 breakBlock 同一套色板，于是"挖开—补上"看起来是同一块材料在动。 */
    placeBlock: function (x, y, z, id) {
      var d = G.BLOCK_DEFS && G.BLOCK_DEFS[id];
      var col = (d && d.color) || '#9aa4b2';
      if (puff) puff(x + 0.5, y + 0.5, z + 0.5, col, 4);
      else emit(x + 0.5, y + 1, z + 0.5, col, 5, 2.2);
    },
    /* 击杀：出手的那一位镜头重顿一下（只在真人席给，AI 杀人不摇你的镜头）。
       粒子与音效仍在 battle 的 kill() 里（白色爆闪 + die），这里只补"手上的重量"。 */
    kill: function (t, src) {
      if (!src || src.kind !== 'player' || !(src.side === 0 || S.split)) return;
      var c = S.cams[src.side]; if (c && c.kick) c.kick(0.45);
    },
    /* 命中：飘字按伤害分级放大（26/30/34px），火星数量跟着伤害走；
       出手的真人玩家也会吃一记轻冲击——"打中了"这件事不该只靠数字知道。 */
    hit: function (t, amount, kind, src) {
      var col = kind === 'fire' ? '#ff9a5a' : kind === 'ice' ? '#a8e6ff' : kind === 'void' ? '#d3a8ff' : '#fff';
      floatText(t.pos, String(Math.round(amount)), col, amount >= 20 ? 34 : (amount >= 10 ? 30 : 26));
      emit(t.pos.x, t.pos.y + 1.1, t.pos.z, kind === 'fire' ? '#ff7a45' : '#ffffff', Math.min(26, 8 + Math.round(amount / 2)), 4);
      if (t.kind === 'player') { var cam = S.cams[t.side]; if (cam) cam.kick(Math.min(0.5, amount / 40)); }
      if (src && src !== t && src.kind === 'player' && (src.side === 0 || S.split)) {
        var atk = S.cams[src.side]; if (atk) atk.kick(Math.min(0.3, 0.05 + amount / 90));
      }
    },
    heal: function (t) { floatText(t.pos, '+' + 4, '#7fd97f'); emit(t.pos.x, t.pos.y + 1, t.pos.z, '#7fd97f', 10, 3); },
    shieldUp: function (t) { floatText(t.pos, '盾', '#7fd7ff'); emit(t.pos.x, t.pos.y + 1, t.pos.z, '#7fd7ff', 12, 3); },
    fire: function (p) { emit(p.x, p.y + 1, p.z, '#ff7a45', 6, 3.2, 4); },
    /* 震屏：大招的"爽"有一半在镜头上。权威层只给强度（rules.js 的 quake 效果），
       这里把它交给两台相机自己的 kick（越肩/第一人称共用同一个入口）。 */
    quake: function (power) {
      var k = Math.min(0.85, (power || 1) * 0.55);
      for (var qi = 0; qi < S.cams.length; qi++) if (S.cams[qi] && S.cams[qi].kick) S.cams[qi].kick(k);
    },
    /* 物质层（GW.CHEM）只报 key（steam / obsidian / ash / ignite / melt / freeze / caught），
       中文在 js/hud.js 的 H.TEXT.chem 里——逻辑层不写文案这条由 layer_check 拦着。 */
    chemLog: function (key, pos) { if (G.HUD && G.HUD.chemLog) G.HUD.chemLog(key, pos); },
    ambient: function (biome, pos, rng) {
      var col = ['#c9d3e0', '#d9c88d', '#ffffff'][biome] || '#ffffff';
      var x = pos.x + (rng() - .5) * 26, z = pos.z + (rng() - .5) * 26, y = pos.y + 6 + rng() * 8;
      emit(x, y, z, col, 1, 0.6, -1.2);
    },
    requestCast: function (side, i) { castCard(side, i); }
  };
  /* 出牌与命中的"身体反应"：从特效事件总线听（rules.js 发），不碰结算也不碰特效本身。
     两条线各干各的：特效层画元素特效，角色层改这具身体的姿态。 */
  if (G.VFX && G.VFX.on) {
    G.VFX.on('cast', function (d) {
      var sd = d && d.side;
      if (!heroes[sd]) return;
      var el = d && d.card && G.ELEMENTS[d.card.element];
      G.HERO.cast(heroes[sd], { color: el ? el.color : null });
    });
    G.VFX.on('hit', function (d) {
      var t = d && d.target;
      if (t && t.kind === 'player' && heroes[t.side]) G.HERO.hurt(heroes[t.side]);
    });
  }

  /* ---------- 准星目标框 + 改造范围预览 ---------- */
  var selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)), new THREE.LineBasicMaterial({ color: 0xffd86b }));
  selBox.visible = false; fxGroup.add(selBox);
  var ghostGroup = new THREE.Group(); fxGroup.add(ghostGroup);
  var ghostMeshes = [];
  function ghost(n, hex) {
    while (ghostMeshes.length < n) {
      var ls = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
        new THREE.LineBasicMaterial({ color: 0xffd86b, transparent: true, opacity: 0.62, depthTest: false }));
      var fill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd86b, transparent: true, opacity: 0.07, depthWrite: false }));
      var grp = new THREE.Group(); grp.add(ls); grp.add(fill); grp.userData.ls = ls; grp.userData.fill = fill;
      ghostGroup.add(grp); ghostMeshes.push(grp);
    }
    for (var i = 0; i < ghostMeshes.length; i++) {
      ghostMeshes[i].visible = i < n;
      if (i < n && hex) { ghostMeshes[i].userData.ls.material.color.set(hex); ghostMeshes[i].userData.fill.material.color.set(hex); }
    }
  }

  /* ---------- 相机 ---------- */
  function aspectFor(side) {
    var W2 = window.innerWidth, H2 = window.innerHeight;
    return (S.split ? W2 / 2 : W2) / H2;
  }
  function camModePref() {
    try { var v = window.localStorage && localStorage.getItem('gw.camMode'); return G.CAM_MODES.indexOf(v) >= 0 ? v : 'shoulder'; } catch (err) { return 'shoulder'; }
  }
  function saveCamModePref(m) { try { if (window.localStorage) localStorage.setItem('gw.camMode', m); } catch (err) { } }
  function ensureCams() {
    var m = camModePref();
    for (var i = 0; i < 2; i++) {
      if (!S.cams[i]) S.cams[i] = new G.OTSCamera(aspectFor(i), { fov: 70, mode: i === 0 ? m : 'shoulder' });
      else if (i === 0) S.cams[i].setMode(m);
    }
  }
  /* C 键循环视角模式：只切本地视角（分屏下是 P1 的相机），P2 相机保持越肩 */
  function cycleCamMode() {
    if (!S.cams[0]) return;
    var m = S.cams[0].nextMode();
    saveCamModePref(m);
    G.HUD.say('cam', 'gold', S.cams[0].modeName());
    G.HUD.log(G.HUD.TEXT.ui.msg.camLog(S.cams[0].modeName()), '#9d95c4');
    G.HUD.invalidate('topbar');
  }

  /* ---------- 出牌 ---------- */
  /* 选中格必须永远落在真实手牌范围内：切类、出牌、弃牌、被拖走都会让手牌变短。
     夹这一次是"玩家的高亮/数字键永远指着一张真牌"的唯一保证——少了它，
     高亮会停在已不存在的第 4 格，按 5 静默（2026-10-18 实测 sel=3 而 hand 只有 3 张）。 */
  function clampSel(side) {
    var p = S.match && S.match.players[side];
    if (!p) return;
    var n = p.hand ? p.hand.length : 0;
    var cur = G.HUD.sel[side] | 0;
    var next = n <= 0 ? 0 : Math.max(0, Math.min(n - 1, cur));
    if (next !== cur) { G.HUD.sel[side] = next; G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv'); }
  }
  function castCard(side, i) {
    if (!S.match) return;
    var idx = i === undefined ? G.HUD.sel[side] : i;
    var p = S.match.players[side];
    if (!p) return;
    /* 联机的 guest 出牌：只记下标，交给下一个 tick 的 input 帧（NET.md §3「出牌一律等房主裁决」）。
       不在这里 playCard，也不需要「猜错了怎么改回来」：付不起/被拒绝时房主那侧什么都不动，
       下一份快照把张数与原 hand 覆盖回来，玩家看到的是「这张牌没打出去」，不是「打出去又缩回」。 */
    if (netIsGuest() && side === 0) {
      if (idx >= 0 && p.hand && idx < p.hand.length) S.net.pendingCast = idx;   // 下标不在手里：不发也不演，等快照对账
      return;
    }
    S.ctx0 = S.ctx0 || S.match.ctx;
    S.match.ctx.aim = p.aim; S.match.ctx.aimTarget = p.aimTarget;
    var castOk = S.match.playCard(p, idx);
    if (!castOk && p.hand && p.hand.length > 1) {
      /* 「无脑出牌」兜底（2026-10-18 用户）：选中的这张打不出（CD 没转好 / 魔力或素材不够 / 没目标），
         就立刻试手上其它格——第一张真能打出去的就打出去，不让玩家「明明有牌能放却卡住」。
         顺序：从选中格的下一格开始绕一圈（自己最后再试一次，保持直觉上的「先按我选的」）。
         每次尝试都仍走 playCard（canPlay → 扣费 → 落地），拒绝的那次不改任何状态。 */
      for (var k = 1; k <= p.hand.length && !castOk; k++) {
        var j = (idx + k) % p.hand.length;
        if (j === idx) continue;
        castOk = S.match.playCard(p, j);
        if (castOk) G.HUD.sel[side] = j;      // 光标跟到真打出去的那格，下一张从它后面继续
      }
    }
    if (!castOk) {
      G.Audio.play('deny');
      /* 玩家按了没反应，是最难报的 bug：把权威层给的人话原因演出来（魔力不足/冷却中/素材不足…）。
         问一次 canPlay 不算查规则——判定仍在 rules.js，这里只是把结果送到门面上。 */
      try {
        var cid = (p.hand && p.hand[idx]) || null;
        var card = cid && G.CARDS_BY_ID ? G.CARDS_BY_ID[cid] : null;
        var why = card && G.Rules && G.Rules.canPlay ? (G.Rules.canPlay(card, p, S.match.ctx).reason || 'denied') : 'denied';
        G.HUD.sayDeny(why);
      } catch (e0) { }
    }
    G.HUD.sel[side] = Math.min(G.HUD.sel[side], Math.max(0, p.hand.length - 1));
  }

  /* ---------- 目标瞄准（相机真实视轴定目标 → 玩家眼睛射线校验遮挡） ----------
     起点与方向都取自相机本帧的实际渲染结果（cam.aimOrigin / cam.dir），
     所以准星压在哪个格子，命中的就是那个格子；第一人称下两者天然重合。 */
  function updateAims() {
    for (var s = 0; s < 2; s++) {
      var p = S.match.players[s], cam = S.cams[s];
      if (!p || !cam) continue;
      var o = { x: cam.aimOrigin.x, y: cam.aimOrigin.y, z: cam.aimOrigin.z };
      var d = { x: cam.dir.x, y: cam.dir.y, z: cam.dir.z };
      S.match.updateAim(p, o, d);
      p.aimBlocked = false;
      if (p.aim && !p.aim.ent && !cam.isFirst()) {
        var eye = { x: p.pos.x, y: p.pos.y + 0.62, z: p.pos.z };   // 与相机 eyeH 同一个高度，两套校验不打架
        var tgt = { x: p.aim.x, y: p.aim.y, z: p.aim.z };
        var sdx = tgt.x - eye.x, sdy = tgt.y - eye.y, sdz = tgt.z - eye.z;
        var sLen = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) || 1;
        var step = { x: sdx / sLen, y: sdy / sLen, z: sdz / sLen };
        var st0 = { x: eye.x + step.x * 0.35, y: eye.y + step.y * 0.35, z: eye.z + step.z * 0.35 };
        var blk = S.world.raycast(st0, step, Math.max(0.1, sLen - 0.5), {});
        // 回退到挡视线的格子，但不回退到自己身体所在的那一格——否则准星信息会变成脚下的草地
        if (blk.hit && !(blk.x === p.aim.gx && blk.y === p.aim.gy && blk.z === p.aim.gz) &&
            !(blk.x === Math.floor(p.pos.x) && blk.z === Math.floor(p.pos.z) && Math.abs(blk.y - Math.floor(p.pos.y)) <= 1)) {
          p.aimBlocked = true;
          p.aim.x = blk.x + 0.5 + blk.face[0] * 0.5; p.aim.y = blk.y + 0.5 + blk.face[1] * 0.5; p.aim.z = blk.z + 0.5 + blk.face[2] * 0.5;
          p.aim.gx = blk.x; p.aim.gy = blk.y; p.aim.gz = blk.z;
          p.aimTarget = { x: blk.x, y: blk.y, z: blk.z, id: blk.id };
        }
      }
    }
    S.ctx0 = S.ctx0 || S.match.ctx;
    var p0 = S.match.players[0];
    if (p0) { S.match.ctx.aim = p0.aim; S.match.ctx.aimTarget = p0.aimTarget; }
  }

  /* ---------- 每帧视觉更新 ---------- */
  var shadowTex = (function () {
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var cg = cv.getContext('2d');
    var g = cg.createRadialGradient(32, 32, 3, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    cg.fillStyle = g; cg.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(cv); return t;
  })();
  function makeShadow() {
    var sp = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.6, depthWrite: false }));
    sp.rotation.x = -Math.PI / 2;
 fxGroup.add(sp); return sp;
  }
  /* 本帧"画在哪"：权威 pos 与上一 tick 位置之间按 alpha 插值（判定仍用 e.pos）。
     复用实体身上的 rpos 对象，160FPS 下不在每帧 new，避免 GC 打进手感里。 */
  function rp(e) { return S.match.renderPos(e, S.alpha, e.rpos || (e.rpos = new G.V(0, 0, 0))); }
  function placeEntities(dt) {
    ensureHeroMeshes();
    for (var s = 0; s < 2; s++) {
      var p = S.match.players[s], h = heroes[s];
      if (!p || !h) continue;
      // 自己是否入画由 render 里按"这台相机"的 selfHidden 决定（分屏时对手仍然要看到我）
      h.visible = !!p.alive;
      if (h.userData.baseY === undefined) {
        var py0 = h.position.y; h.position.y = 0; h.updateMatrixWorld(true);
        var bb = new THREE.Box3().setFromObject(h); h.userData.baseY = bb.min.y;
        h.position.y = py0;
      }
      var vp = rp(p);
      h.position.set(vp.x, vp.y - p.h / 2 - h.userData.baseY, vp.z);
      if (h.userData.tag) {
        var tg = h.userData.tag;
        tg.position.set(vp.x, vp.y + p.h / 2 + 0.6, vp.z);
        var camHere = S.cams[s];
        var dcam = camHere ? Math.hypot(tg.position.x - camHere.pos.x, tg.position.y - camHere.pos.y, tg.position.z - camHere.pos.z) : 99;
        tg.visible = !!p.alive && dcam > 3.4;          // 自己头上不挂名牌，贴脸也不闪
        if (tg.visible) updateNameTag(tg, p);
      }
      h.rotation.y = p.yaw + Math.PI;
      /* 姿态由角色层（js/hero-rig.js）算：这层只把"看得见的状态"递过去——速度、腾空、俯仰。
         相位在它自己家里按渲染帧累加（拿 20Hz 的 match.time 乘系数会让腿一顿一顿）；
         动画量也只留在部件上，一个字段都不写回实体（判定/命中/存档仍读 e.pos）。 */
      var hsp = Math.hypot(p.vel.x, p.vel.z), vy = p.vel.y, pv = h.userData.prevVy;
      if (pv !== undefined && pv < -3 && p.onGround) G.HERO.land(h, -pv);
      h.userData.prevVy = vy;
      /* camAz：这台相机相对角色插值位置的方位角。公告牌靠它摆正——相机的"谁糊准星"分类
         在本函数之后、渲染之前发生，那时 onBeforeRender 还没跑，不给它一个当帧朝向，
         分类量到的是上一帧的斜姿态（轴对齐盒一胀就把合并盒右缘推进准星窗口，整具被误隐藏）。
         分屏时对手那半屏仍由 onBeforeRender 按真正渲染的相机再校正一次。 */
      var camAzHere = S.cams[s] ? Math.atan2(S.cams[s].pos.x - vp.x, S.cams[s].pos.z - vp.z) : undefined;
      G.HERO.animate(h, {
        speed: hsp,
        air: p.onGround ? 0 : (vy > 0.5 ? 1 : (vy < -0.5 ? -1 : 0)),
        pitch: p.pitch || 0,
        camAz: camAzHere
      }, dt);
      var selCard = G.CARDS_BY_ID[p.hand[G.HUD.sel[s]]];
      G.HERO.setGemColor(h, selCard ? G.ELEMENTS[selCard.element].color : '#ffd400');
      if (!h.userData.shadow) h.userData.shadow = makeShadow();
      var gy = S.world.surfaceY(Math.floor(vp.x), Math.floor(vp.z)) + 0.03;
      h.userData.shadow.visible = !!p.alive;
      h.userData.shadow.position.set(vp.x, gy, vp.z);
    }
    // 随从
    for (var i = 0; i < S.match.summons.length; i++) {
      var e = S.match.summons[i];
      if (!e.mesh) { e.mesh = makeSummonMesh(e); entGroup.add(e.mesh); summonMeshes.push(e); }
      e.mesh.visible = !!e.alive;
      if (e.mesh.userData.baseY === undefined) {
        var py1 = e.mesh.position.y; e.mesh.position.y = 0; e.mesh.updateMatrixWorld(true);
        var bb2 = new THREE.Box3().setFromObject(e.mesh); e.mesh.userData.baseY = bb2.min.y;
        e.mesh.position.y = py1;
      }
      var vs = rp(e);
      e.mesh.position.set(vs.x, vs.y - e.h / 2 - e.mesh.userData.baseY, vs.z);
      e.mesh.rotation.y = e.yaw + Math.PI;
      if (e.st.frozen > 0) e.mesh.material && (e.mesh.material.opacity = 1);
    }
    for (var j = summonMeshes.length - 1; j >= 0; j--) {
      var sm = summonMeshes[j];
      if (!sm.alive || S.match.summons.indexOf(sm) < 0) { entGroup.remove(sm.mesh); summonMeshes.splice(j, 1); }
    }
    // 抛射物（网格池在 src/app/projectile-view.js）
    PV.sync(S.match.projectiles, dt);
    /* 法阵。老的"贴一张画出来的阵"保留可用，但特效渲染层接管时不再画它：
       两套同心圆叠在一起（一套贴图、一套线）会糊出摩尔纹，谁也看不清是阵。
       关掉 GW.VFXR.enabled 就回到老画法——和光影层"P 关掉 == 现状"同一个路子。 */
    var vfxOwns = !!(G.VFXR && G.VFXR.enabled && G.VFXR.ownsSigils);
    for (var g2 = 0; g2 < S.match.sigils.length; g2++) {
      var sg = S.match.sigils[g2];
      if (vfxOwns) {
        if (sg.mesh) {
          disposeSigilMesh(sg.mesh); fxGroup.remove(sg.mesh); sg.mesh = null;
          var sx = sigilMeshList.indexOf(sg); if (sx >= 0) sigilMeshList.splice(sx, 1);
        }
        continue;
      }
      if (!sg.mesh) { sg.mesh = buildSigilMesh(sg); sg.mesh.userData.id = g2; fxGroup.add(sg.mesh); sigilMeshList.push(sg); }
      var age = S.match.time - sg.born;
      sg.mesh.position.set(sg.pos.x, sg.pos.y + 0.04, sg.pos.z);
      sg.mesh.rotation.y += dt * (sg.active ? 1.4 : 0.45);
      var hidden = sg.preset.hidden && !sg.triggered;
      sg.mesh.visible = !hidden;
      var pulse = sg.active ? (0.62 + Math.sin(S.animT * 9) * 0.3) : (0.16 + 0.35 * (age / Math.max(0.001, sg.delay)));
      setSigilOpacity(sg.mesh, pulse);
      if (sg.preset.once && sg.active && !sg.triggered) { sg.triggered = true; sg.mesh.visible = true; }
    }
    /* 上一版这里遍历一张从未写入的 sigilMeshes 表，等于什么也没清：法阵到期或被破阵后，
       地上的阵和两道光柱会永远留在场景里（停在最后一次脉冲的透明度上）。
       调试法阵时表现成"明明已经触发完了，地上还亮着一片"，所以必须按实体回收。 */
    for (var kz = sigilMeshList.length - 1; kz >= 0; kz--) {
      var sg2 = sigilMeshList[kz];
      if (sg2.dead || !sg2.mesh || S.match.sigils.indexOf(sg2) < 0) {
        disposeSigilMesh(sg2.mesh); fxGroup.remove(sg2.mesh); sg2.mesh = null; sigilMeshList.splice(kz, 1);
      }
    }
  }

  /* 黄框、地形卡预览格、准星下方那行信息：读的是本帧相机算出来的 p0.aim，
     所以必须排在 cam.update + updateAims 之后（这正是把画面落位拆成两段的原因）。 */
  function updateOverlays(dt) {
    var p0 = S.match.players[0];
    if (p0 && p0.aimTarget) {
      selBox.visible = true;
      selBox.position.set(p0.aimTarget.x + 0.5, p0.aimTarget.y + 0.5, p0.aimTarget.z + 0.5);
    } else selBox.visible = false;
    var card = p0 && G.CARDS_BY_ID[p0.hand[G.HUD.sel[0]]];
    if (card && card.type === 'terrain' && p0.aim) {
      S.match.ctx.aim = p0.aim; S.match.ctx.aimTarget = p0.aimTarget;
      var cells = [];
      for (var e2 = 0; e2 < card.effects.length; e2++) if (card.effects[e2].op === 'setBlock') cells = G.Rules.cellsFor(card.effects[e2], card, p0, S.match.ctx);
      var eraseMode = false, fillMode = false;
      for (var ez = 0; ez < card.effects.length; ez++) { var efx = card.effects[ez]; if (efx.op !== 'setBlock') continue; if (efx.mode === 'erase') eraseMode = true; else fillMode = true; }
      ghost(cells.length, eraseMode && !fillMode ? '#ff5f7a' : (fillMode && !eraseMode ? '#7fd97f' : '#ffd86b'));
      for (var c3 = 0; c3 < cells.length; c3++) ghostMeshes[c3].position.set(cells[c3].x + 0.5, cells[c3].y + 0.5, cells[c3].z + 0.5);
      G.HUD.aimInfo({ key: 'terrain', name: card.name, cells: cells.length, cap: G.Rules.cardCellCap(card, p0), blocked: p0.aimBlocked }, true);
    } else if (card && card.type === 'sigil') {
      ghost(0);
      var pr2 = G.SIGILS[card.id];
      G.HUD.aimInfo({ key: 'sigil', name: card.name, radius: (pr2 ? pr2.radius : 2.5), delay: (card.effects[0] ? card.effects[0].delay : 1) }, true);
    } else {
      ghost(0);
      if (p0 && p0.aim) {
        var bn = p0.aimTarget ? (DEFS[p0.aimTarget.id] ? DEFS[p0.aimTarget.id].cn : '?') : '空地';
        G.HUD.aimInfo({ key: 'block', name: bn, at: (p0.aim.gx !== undefined ? (p0.aim.gx + ',' + p0.aim.gy + ',' + p0.aim.gz) : '—'), blocked: p0.aimBlocked }, !!p0.aimTarget);
      } else G.HUD.aimInfo('', false);
    }
  }

  /* ---------- 昼夜 / 天空 ----------
     默认交给大气层（js/atmos.js）：太阳、月亮、星空、云、云影、降水与闪电都在那一层。
     它没接管（被关掉、建立失败、这一局还没开）就回到下面这条**原封保留**的老通路——
     「关掉 == 现状」是 tools/atmos_check.cjs 机检的口径，所以老通路里的数字一个都不许顺手改。 */
  var atmAnchor = { x: 0, y: 0, z: 0 };
  function skyTick(dt) { if (!(G.ATMOS && G.ATMOS.frame(dt))) dayNight(); }
  function dayNight() {
    var d = (S.match.dayT % S.match.dayLen) / S.match.dayLen;
    var sunA = Math.max(0, Math.sin(d * Math.PI * 2));
    var night = d > 0.6;
    var sky = new THREE.Color(0x9ec9ff).lerp(new THREE.Color(0x141228), night ? 0.86 : (d > 0.5 ? (d - 0.5) / 0.1 : 0));
    scene.background = night ? SKY.night : SKY.day;
    scene.fog.color = sky;
    sun.intensity = 0.25 + sunA * 0.6; hemi.intensity = night ? 0.32 : 0.85;
    var bm = S.world.biomeAt(Math.floor(S.match.players[0].pos.x), Math.floor(S.match.players[0].pos.z));
    var fogFar = [150, 130, 112][bm] || 150;
    scene.fog.near = fogFar * 0.3; scene.fog.far = fogFar;
  }

  /* ---------- 渲染 ----------
     "自己不入画"必须逐相机决定：越肩时 P1 自己的身体挡住自己的准星要隐藏，
     但这具身体在 P2 的画面里是对手，不能跟着消失。 */
  /* 谁挡准星就只藏谁：躯干/头 → 整具不画；只有腿 → 只藏腿；只有手臂或肩上那张牌 → 只画到肩。
     分屏时逐相机调用（每台相机自己的 selfHidden/legsHidden/propsHidden），画完再复原，
     这样 P1 藏起来的身体在 P2 的画面里仍然是对手，不会跟着消失。 */
  function setSelfVisible(side, on, propsOn, legsOn) {
    var h = heroes[side], p = S.match && S.match.players[side];
    if (!h || !p) return;
    h.visible = !!p.alive && on;
    if (h.userData.shadow) h.userData.shadow.visible = !!p.alive && on;
    if (on) {
      var P = h.userData.parts || {};
      var props = propsOn !== false, legs = legsOn !== false;
      /* 手臂关节整组开关：杖是左臂的子节点，跟着手臂一起藏，不用单独点名 */
      if (P.armL) P.armL.visible = props;
      if (P.armR) P.armR.visible = props;
      if (P.legL) P.legL.visible = legs;
      if (P.legR) P.legR.visible = legs;
    }
  }
  /* 把"自己"按部件给出世界 AABB，交给相机判断谁压住准星。
     core：头、躯干、后脑、发、围巾、五官；legs：两条腿；props：两条手臂 + 肩上那张牌。
     分组的意义：只藏真正挡视线的那部分，而不是整具身体一蹭到边界就全抹掉
     （上一版用整具包围盒判，斜着站时盒宽被放大、竖直跨从头到脚，镜头一压低角色就凭空消失）。
     每帧用部件自己的 matrixWorld 量，走路摆臂、描边子网格都算进去。 */
  /* 相机只需要实体的三样东西：pos / yaw / pitch（见 camera.js 的 _stepYaw）。
     给它一个插值后的代理，而不是改 p.pos——p.pos 必须保持"权威值"，
     出牌命中、碰撞、存档全都读它。 */
  function camViewOf(side) {
    var p = S.match.players[side]; if (!p) return null;
    var v = S.camView[side];
    if (!v) v = S.camView[side] = { pos: new G.V(0, 0, 0), yaw: 0, pitch: 0 };
    var vp = rp(p);
    v.pos.set(vp.x, vp.y, vp.z); v.yaw = p.yaw; v.pitch = p.pitch;
    return v;
  }
  var _bb = new THREE.Box3(), hgPool = [null, null];
  function heroGroups(side) {
    var h = heroes[side]; if (!h) return null;
    var P = h.userData.parts || {};
    var out = { core: [], legs: [], props: [] };
    var pool = hgPool[side] || (hgPool[side] = []);
    var used = 0;
    h.updateMatrixWorld(true);
    /* 遍历整棵子树（与 tools/cam_audit.js 的部件采集口径一致，审计是 traverse+visible）。
       上一版只收"直接子节点 + 一层描边"，深层部件相机看不见：审计按顶点判它糊住准星、
       相机却以为净空，两边对不上（seed 88092 的 C 项 1.31 格残留就是这么来的）。
       分组按最近祖先归类：手臂/肩牌→props，腿→legs，其余（头、躯干、发、围巾、五官）→core。 */
    h.traverse(function (m) {
      if (!m.isMesh || !m.visible || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      _bb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);   // 含自身旋转
      if (_bb.isEmpty()) return;
      var g = 'core', o = m;
      while (o && o !== h) {
        if (o === P.armL || o === P.armR) { g = 'props'; break; }   // 杖在左臂组里，一起算 props
        if (o === P.legL || o === P.legR) { g = 'legs'; break; }
        o = o.parent;
      }
      /* 盒对象按"这台相机"复用一个池：每帧 14 个部件 × 两台相机，旧写法每帧 new 84 个
         Box3/Vector3，在 160FPS 下足够把 GC 扫进手感里（一次 minor GC 就是几十毫秒的顿）。 */
      var rec = pool[used] || (pool[used] = { min: new THREE.Vector3(), max: new THREE.Vector3() });
      used++;
      rec.min.copy(_bb.min); rec.max.copy(_bb.max);
      out[g].push(rec);
    });
    return out;
  }
  function render() {
    var W2 = window.innerWidth, H2 = window.innerHeight;
    if (S.split) {
      renderer.setScissorTest(true);
      for (var s = 0; s < 2; s++) {
        var x0 = s * (W2 / 2);
        renderer.setViewport(x0, 0, W2 / 2, H2);
        renderer.setScissor(x0, 0, W2 / 2, H2);
        var cs = S.cams[s];
        setSelfVisible(s, !cs || !cs.selfHidden,
          !cs || !(cs.selfHidden || cs.propsHidden), !cs || !(cs.selfHidden || cs.legsHidden));
        // 光影层自己判断开/关：关着就是原来的 renderer.render，"关光影 == 现状"是可机检的口径
        G.SHADER.renderScene(renderer, scene, S.cams[s].cam, x0, 0, W2 / 2, H2);
      }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W2, H2);
      for (var r2 = 0; r2 < 2; r2++) setSelfVisible(r2, true, true, true);
    } else {
      renderer.setViewport(0, 0, W2, H2);
      var c0v = S.cams[0];
      setSelfVisible(0, !c0v || !c0v.selfHidden,
        !c0v || !(c0v.selfHidden || c0v.propsHidden), !c0v || !(c0v.selfHidden || c0v.legsHidden));
      G.SHADER.renderScene(renderer, scene, S.cams[0].cam, 0, 0, W2, H2);
      setSelfVisible(0, true, true, true);
    }
  }

  /* ---------- 主循环 ---------- */
  var acc = 0, last = 0, hudT = 0, fpsT = 0, fpsN = 0, cullT = 0;
  /* 每渲染帧取走一次转向输入。apply=false 用于暂停/结算画面：仍然清空累加器，
     否则暂停时移动过的鼠标会在恢复瞬间一次性灌进来，视角猛地一甩。 */
  function consumeLook(dt, apply) {
    if (!S.match || !S.sources) return;
    for (var s3 = 0; s3 < S.sources.length; s3++) {
      var srcL = S.sources[s3], pL = S.match.players[s3];
      if (!srcL || !pL || typeof srcL.flushLook !== 'function') continue;   // AI 源没有 flushLook，它的 lookYaw 走 tick
      var lk = srcL.flushLook(dt);
      if (apply && (lk.lookYaw || lk.lookPitch)) S.match.applyLook(pL, lk.lookYaw, lk.lookPitch);
    }
  }
  /* ---------- 三选一装配（定案 docs/CARD_ECONOMY.md §2 S2/S3） ----------
     权威层（battle.js 的 draft 队列）只管"排上队"；取队首、标题怎么翻、面板长什么样都不归它管。
     装配层每帧问一次 pendingDraft()，弹**唯一的** G.HUD.openChoice（GAMEPLAY §7.3 禁止第二套列表 DOM）。
     S.draftOpenFor 记住"这一份 offer 已经弹过了"：面板开着时主循环走暂停分支不再走到这里，
     取走/跳过之后队首换成新的才再弹；被权威层拒绝就清空引用、下一帧重弹——绝不静默吞掉玩家的选择权。 */
  /* 这一方的输入源是不是这台键盘上的真人：P1 永远是 KeyboardSource；P2 只有分屏才是（训练模式是 AISource）。
     判据用 KeyboardSource 独有的键位表 b/keys，比 constructor.name 稳。 */
  function isLocalSide(side) {
    if (side !== 0 && side !== 1) return false;
    if (side === 1 && !S.split) return false;
    var src = S.sources && S.sources[side];
    return !!(src && src.b && src.keys);
  }
  function pollDraft() {
    var m = S.match;
    if (!m || S.overPause || typeof m.pendingDraft !== 'function') return;
    var offer = m.pendingDraft();
    if (!offer) { S.draftOpenFor = null; return; }
    /* 只给"这台机器上的真人"弹面板：训练模式的 P2 是 AI，给它弹三选一 = 抢走真人的屏幕并把逻辑冻住
       （实测 seed 490706：AI 在 tick 228 占住中矿 → 面板挂着、tick 从此不动，creative_check 的俯仰与
       结算两段整段被这条拖红）。AI 那份**留在队列里不动它**：替 AI 挑哪张牌是机制层的选牌策略，
       不由装配层代答，也不假装处理过。 */
    if (!isLocalSide(offer.side | 0)) return;
    if (S.draftOpenFor === offer) return;                                  // 同一次不弹两遍
    if (G.HUD.panelOpen && G.HUD.panelOpen('choice')) return;              // 已经有选择面板挂着
    var T = (G.HUD.TEXT && G.HUD.TEXT.draft) || {};
    var opened = G.HUD.openChoice({
      title: (offer.source === 'beast' ? T.beastTitle : T.lodeTitle) || '',
      hint: T.hint || '',
      items: (offer.options || []).map(function (id) { return { id: id }; }),
      onPick: function (it) {
        var id = it && it.meta && it.meta.id;
        if (!id) { S.draftOpenFor = null; G.HUD.draftToast('take'); return; }
        var r = m.takeDraft(offer.side, id);
        if (!r || !r.ok) { S.draftOpenFor = null; G.HUD.draftToast('take'); }
      },
      onSkip: function () {
        var r = m.skipDraft(offer.side);
        if (!r || !r.ok) { S.draftOpenFor = null; G.HUD.draftToast('skip'); }
      }
    });
    S.draftOpenFor = opened ? offer : null;      // 门面没接住就不算弹过，下一帧再试
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!S.running || !S.match || S.frozen) return;   // S.frozen：回归脚本用固定 dt 手动驱动时的闸门（见 tools/atmos_check.cjs）
    var dt = Math.min(0.12, (now - last) / 1000 || 0); last = now;
    // 背包打开 = 逻辑暂停（相机与画面照常刷新），与结算画面同一套渲染分支。
    // "面板开没开"是 UI 状态，问 hud；调试能力本身才问 Creative。
    if (S.overPause || (G.Scene && G.Scene.pausing()) || (G.HUD && G.HUD.uiPanelOpen && G.HUD.uiPanelOpen())) { consumeLook(dt, false); renderHudOnly(dt); return; }
    // 慢动作（创造模式）只拉长 tick 之间的间隔；渲染与相机仍按真实帧时走，手感不受影响
    // 联机（S.net）：慢动作为房主专属——guest 的时间由快照推进，本地缩放时间只会让自己的预测漂
    acc += dt * ((G.Creative && !S.net) ? G.Creative.timeScale() : 1);
    var netGuest = netIsGuest(), netHost = netIsHost();
    var guard = 0, stepFailed = false;
    while (acc >= STEP && guard++ < 6) {
      /* ---------- guest 的一格 tick：只发指令 + 外推自己（§9.3） ----------
         不 step Match、不 step WEATHER/CHEM——权威归房主，两端跑偏靠每 10Hz 的快照整表覆盖纠回来。
         出牌（含鼠标点卡 / 拖卡，见 castCard）都汇进 input 帧的 keys.cast，本地一律不结算（§3）。
         外推不做碰撞：下一份快照会纠。宁可让校正跳变被 ppos→pos 摊成几帧，也不在 guest 侧
         复制一份物理——一份物理两个主人 = 必然 desync。 */
      if (netGuest) {
        var og = S.sources[0] ? S.sources[0].poll(STEP) : G.blankInput();
        if (S.net.pendingCast >= 0) { og.cast = S.net.pendingCast; S.net.pendingCast = -1; }   // 点击/拖拽那类出牌：下一 tick 带上
        var enc = G.NetMatch.encodeInput(og, S.match.players[0]);
        enc.type = 'input';
        enc.tick = S.match.tick + 1;
        S.net.conn.send(enc);
        G.NetMatch.extrapolate(S.match, STEP, 0, NET_EXTRAP_BUDGET);
        acc -= STEP;
        continue;
      }
      var inputs = [];
      for (var i = 0; i < S.sources.length; i++) inputs.push(S.sources[i] ? S.sources[i].poll(STEP) : G.blankInput());
      if (netHost) netFaceGuest();     // guest 的玩家在房主这边没有相机喂瞄准，出牌前按 yaw/pitch 现算
      try {
        S.match.step(STEP, inputs);
      } catch (err) {
        // 一个坏 tick 不能带走整个游戏：以前这里抛出去，渲染/瞄准/输入全停，画面永久定在出错那一帧
        stepFailed = true;
        S.stepErrors = (S.stepErrors || 0) + 1;
        S.lastError = String((err && err.stack) || err);
        if (S.stepErrors === 1 || S.stepErrors % 60 === 0) {
          console.error('[GW] Match.step 异常（已拦截，本帧跳过）', err);
          try { G.HUD.log(G.HUD.TEXT.ui.msg.errStep(String((err && err.message) || err)), '#ff9f9f'); } catch (e2) { }
        }
        acc = 0;
        break;
      }
      if (S.match.over && !S.overPause) onMatchOver();
      /* 天气是权威状态：跟着 tick 走（暂停/结算画面自然停），慢动作也跟着慢。
         它自带独立随机流，不动 match.rng、也不写任何格子，所以 play_probe 的 get/tick 计数不受影响。
         联机的 guest 排除在外（上面那条 continue 已经挡住）：它不跑 step，天气跟着本地 tick 走
         就会比房主多算出另一套随机（NET.md §9.3 步 3）。 */
      if (G.WEATHER && !netGuest) G.WEATHER.step(STEP);
      /* 房主：每 NET_SNAP_EVERY 个 tick 广播一份（§9.2 默认 10Hz）。
         终局那份额外用「当前 tick ≠ 上次发出去的那一格」兜住：Match.step 在 over 时直接返回、
         tick 不再前进，只按 tick%2 判会让终局那一份永远发不出去（guest 就卡在打着的画面上）。 */
      /* paired 闸门：没配对成功之前一份都不发。tracker 是「自上次快照以来改过的格」，
         提前发会把它排空——等 guest 几秒后进房，它的世界里就缺了这几秒被挖掉/点着的格，
         两端 worldHash 从第一秒就对不上（NET.md §9.4 的整图比对必然红）。
         配对成功时下面立刻补发一份，攒着的 diff 整包跟第一份快照一起过去。 */
      if (netHost && S.net.paired && ((S.match.tick % NET_SNAP_EVERY) === 0 || (S.match.over && S.match.tick !== S.net.lastSnapTick))) netPushSnapshot();
      acc -= STEP;
    }
    S.stepHealthy = !stepFailed;
    pollDraft();                      // step 之后、渲染之前：这一 tick 排上的三选一本帧就弹
    // 转向按渲染帧消费：鼠标是连续输入，只在 1/20s 的 tick 里取会让视角每几个渲染帧
    // 才跳一次（真机 160FPS 约 8 帧一跳、单跳近 10°），手感就是"画面不动、猛地一拽"。
    consumeLook(dt, true);
    /* 画面落在两个权威 tick 之间的哪一刻：acc 是 tick 循环剩下的时间，acc/STEP 就是
       "已走完这一步的比例"。代价是画面比权威状态最多慢一个 tick（≤50ms），
       换来的是每一帧都在动（改动前 72.6% 的渲染帧角色位移恰好为 0）。 */
    S.alpha = Math.max(0, Math.min(1, acc / STEP));
    S.animT += dt;
    // 先按插值位置落位，再摆相机：相机的"谁挡准星"判的是本帧真正的部件盒，不再慢一帧
    placeEntities(dt);
    for (var s2 = 0; s2 < 2; s2++) {
      var cam = S.cams[s2], p = S.match.players[s2];
      if (!cam || !p) continue;
      cam.update(camViewOf(s2), S.world, dt, heroGroups(s2));
    }
    updateAims();
    /* 自动开火排在 updateAims 之后：这一发用的就是本帧刚算出来的准星
       （排在前面就会晚一帧——快速转身时子弹朝旧方向飞，玩家看到的是"打偏了"）。 */
    if (S.autoFire && ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - (S.autoT || 0) >= AUTO_MS)) autoFireStep();
    updateOverlays(dt);
    /* 特效渲染层排在实体落位与相机之后：它读的是本帧的插值位置与相机朝向（跟随体要正对镜头）。
       预算与回收都在 GW.VFXR 内部，这里只负责"每帧问一次"。 */
    if (G.VFXR && G.VFXR.update) G.VFXR.update(dt, S.animT, S.alpha);
    stepParticles(dt); stepFloats(dt); flushDirty(2); skyTick(dt);
    cullT += dt; if (cullT > 0.3) { cullT = 0; cullFarChunks(); }
    render();
    hudT += dt;
    if (hudT > 0.06) {
      hudT = 0;
      /* 视图模型的唯一入口：装配层把"这帧该显示什么"灌进 GW.UI，面板自己不查 match */
      clampSel(0); clampSel(1);
      var cam0 = S.cams[0];
      G.HUD.update(S.match, S.split, {
        fps: S.fps, running: S.running, err: !!S.stepErrors, app: S.app, auto: S.autoFire,
        camName: cam0 ? (cam0.modeName ? cam0.modeName() : cam0.mode) : ''
      });
      G.HUD.fps(S.fps);
    }
    G.HUD.tickTimers(dt);
    fpsN++; fpsT += dt; if (fpsT >= 1) { S.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  }

  function renderHudOnly(dt) {
    G.HUD.tickTimers(dt); stepParticles(dt); stepFloats(dt); render();
    /* 面板开着（背包/结算）时也必须喂视图模型：逻辑本来就冻着，重灌一次只读不写。
       以前这条只走 tickTimers，于是"在背包里给了卡"之后权威 hand 变了、vm.hands 还是旧的，
       背包那一排与底部手持栏都不动 —— 玩家看到的就是"放进手持栏没反应"（2026-10-17 用户报）。 */
    hudT += dt;
    if (hudT > 0.06 && S.match) {
      hudT = 0;
      clampSel(0); clampSel(1);          // 面板里切类/拖牌也会让手牌变短，暂停时同样要夹
      var cz = S.cams[0];
      G.HUD.update(S.match, S.split, {
        fps: S.fps, running: S.running, err: !!S.stepErrors, app: S.app, auto: S.autoFire,
        camName: cz ? (cz.modeName ? cz.modeName() : cz.mode) : '', paused: true
      });
    }
  }

  /* ---------- 开始 / 结束 ---------- */
  function beginLoop(seed) {
    if (APP) {
      APP.game.match = S.match; APP.game.world = S.world; APP.game.rev++;
      APP.session.phase = 'match'; APP.session.cfg = S.cfg; APP.session.seed = seed;
    }
    /* 开局 = 向前不可回的一页：走 Router.replace（不压栈，back 不会把玩家塞回上一局的对局面板） */
    nav('match', { mode: S.mode, seed: seed }, true);
    S.overPause = false; S.recorded = false; S.running = true; last = performance.now(); acc = 0;
    S.autoFire = false; S.autoT = 0;            // 新一局：扳机归位（上一局按住左键重开不该继续连发）
    S.draftOpenFor = null;            // 换局：上一局的 offer 引用不再算"已弹过"
    G.HUD.log(G.HUD.TEXT.ui.msg.worldReady({ seed: seed, dims: S.world.SX + '×' + S.world.SY + '×' + S.world.SZ, mode: G.HUD.modeText(S.mode) }), '#ffd86b');
    G.HUD.log(G.HUD.TEXT.ui.msg.howto, '#9d95c4');
  }

  var session = G.SessionRunner.create({
    S: S, scene: scene, renderer: renderer, fx: fx, fxGroup: fxGroup,
    sun: sun, hemi: hemi, ambient: ambient, atmAnchor: atmAnchor,
    buildWorldMeshes: buildWorldMeshes, patchWorldDirty: patchWorldDirty,
    ensureCams: ensureCams, makeDeck: makeDeck, hashStr: hashStr, pick: pick, ctxReady: ctxReady
  });

  /* ================= 联机（N2 房主权威循环 + N5 战前选牌；docs/NET.md §9 与 §10） =================
     分层（一次改动只碰一条线，别的层不该被顺手牵走）：
       · src/net.js        输入源抽象（KeyboardSource / RemoteInputSource）——这里不改；
       · src/net-ws.js     连接 / seq 去重 / 应用心跳 / serializeFor——不改；
       · src/net-match.js  makeSnapshot / applySnapshot / applyCells / extrapolate / encodeInput——不改；
       · src/net-loadout.js 双方牌库的合法性判据（validateDeck / pickCounts / sanitize / SIGNATURE）——
                            房主是收货方，判据只有这一处：本文件不调它就不许说"这份牌库合法"；
       · tools/net_host.cjs 配对 + 按角色转发 + 心跳闸（v4：config 透传含 game；guest→host 追加 loadout，
                            host→guest 追加 lobby / start）；
       · 本文件（装配层）  谁连、连上之后谁进主循环、每 tick 发什么收什么、掉线怎么交代。
     **两段式开局（N5 加的这一刀；ROUTER.md §2 / NET.md §10）**：连接 → 战前选牌 → 双方就绪 → match。
     「房主 / guest 谁在什么条件下进主循环」（§9.5 那条被这一刀改成「就绪之后才进」，两条路径仍互斥）：
       host  ：joined 到 → 只进 loadout（**不建世界、不建对局**：牌库没齐就没有这一局）；peer-joined 报「对手进房」；
               收到 guest 的 loadout → G.NetLoadout.validateDeck：合法才收下并记 guestReady，非法一份都不留、
               回 lobby 带 reject（reason 只报 key，人话在 H.TEXT.loadout 那张表里）；自己点就绪 → selfReady；
               **双方 ready 且两份牌库都合法** → 发 start{seed, config:{map,rule,game}, decks:[我这份, 对手那份]}
               → netEnter（房主视角顺序恒 [房主, 加入者]，guest 那边再按本地视角换位）；
       guest ：joined 到 → 只进 loadout；点就绪 → 发 loadout{deck, ready:true}；收到 lobby → 更新状态行
               （对手已就绪 / 被退回的原因）；收到 start → decks 按**本地视角 1↔0 换位**（side 0 是自己，§9.1）
               → netEnter；没收到 start 就永远停在这一页，**不自己开局**；
       5 秒内没有 joined / 版本不符 / 房间被占 → 明说人话并留在选关，**绝不进对局**（不许假开局）。
     就绪状态的**家**在视图层（vm.state.loadout，唯一写入口是 src/hud.js 的 4b 段），本层只存
     「交出去的那一份」：S.net.{phase, selfReady, selfDeck, guestDeck, guestReady, hostReady}。
     改了牌 hud 那条「动过牌就绪作废」会把界面就绪收回，这里跟着把 selfDeck 清掉——
     于是「界面说已就绪」与「线上已交了这份牌库」永远同一件事，不会各记一本账。 */
  var NET_SNAP_EVERY = 2;        // 每 2 tick = 10Hz 一份快照（§9.2 定值）
  var NET_CELL_BUDGET = 4000;    // 单份 diff 的格数上限（§9.4：超了不发增量，下一份改发全量）
  var NET_EXTRAP_BUDGET = 0.15;  // guest 外推预算 = 3 tick（§8：1 秒毛刺期间宁可定住）
  var NET_JOIN_TIMEOUT = 5000;   // 这段时间内没有 joined 就判「连不上 / 没有这个房间」

  /* 联机提示的唯一取词口：中文在 src/hud.js 的 H.TEXT.net，装配层只报 key（layer_check 拦写死文案） */
  function netText(key) {
    var T = (G.HUD.TEXT && G.HUD.TEXT.net) || {};
    return T[key] != null ? String(T[key]) : String(key);
  }
  function netIsGuest() { return !!(S.net && S.net.role === 'guest'); }
  function netIsHost() { return !!(S.net && S.net.role === 'host'); }
  /* 换局 / 重开 / 放弃连接时把上一副联机家当摘干净：连接、世界 diff 钩子（挂在 G.WORLD_HOOKS.onSet
     这张全局表上，不摘会让上一局的格子混进新一局的 diff）、5 秒判定定时器 */
  function netTeardown() {
    if (S.netTimer) { clearTimeout(S.netTimer); S.netTimer = 0; }
    if (S.net) {
      if (S.net.tracker && S.net.tracker.detach) S.net.tracker.detach();
      if (S.net.conn && S.net.conn.close) { try { S.net.conn.close(); } catch (e) { } }
    }
    if (S.netPendingConn && S.netPendingConn.close && (!S.net || S.net.conn !== S.netPendingConn)) {
      try { S.netPendingConn.close(); } catch (e2) { }     // 还没 joined 就被换掉的那条：关掉它，别让它后台重连
    }
    S.net = null;
    S.netPendingRole = null;
    S.netPendingConn = null;
  }

  /* ---------- 进局：两条路径共用同一段建局代码（区别只在 seed 与关卡是谁的） ----------
     N5 之后它**不再由 joined 调**，而是由「双方就绪」那一步调（房主 netMaybeStart / guest 收到 start）；
     beginLoop 之前的顺序与 start() 一致：buildWorld → buildMatch → beginLoop（session.js 文件头立的阶段顺序，别拆散）。
     世界 diff 记录器也搬到这里建：选牌阶段还没有世界，提前 makeWorldTracker 会挂到菜单那个背景世界上，
     于是菜单里飞的粒子/落下的碎屑被记进房主的 diff，开局那一刻 guest 收到一屏无关格子。 */
  function netEnter(cfg, seed) {
    S.mode = 'net';
    S.split = false;              // 联机不分屏（§9.1）：两端各看各的 side 0，T 键的 setSplit 在这里不参与
    S.cfg = cfg;
    seed = session.buildWorld(cfg, seed);
    if (S.net && S.net.role === 'host' && !S.net.tracker) {
      S.net.tracker = G.NetMatch.makeWorldTracker(S.world);
      /* 进局后的前 20 份快照（≈1 秒，10Hz）**整包发全量差异格**而不是增量：
         两段式开局让两端在同一刻建世界，guest 那边 buildWorld 要几百毫秒，这期间它收到又丢弃的
         增量快照会把 chem / 天气写过的格子永久丢掉（增量记录器一交出去就排空）。
         全量走 Save 的「seed + 与基线差异格」表示：开局那一刻它几乎为空，涨到几十格也在预算内，
         而"晚到的那一份也能补齐"这件事就成立了两端一致（NET.md §9.4 的预算闸照管 big 那条路）。 */
      S.net.snapWarm = 20;
    }
    session.buildMatch(cfg, seed);   // 认 cfg.net.role 与 cfg.decks（战前选牌的两份牌库，session.js）
    beginLoop(seed);
  }

  /* ---------- 战前选牌（N5；NET.md §10）：本层只记账与发帧，界面状态归 hud 的 4b 段 ----------
     四个动作：进这一页（netGotoLoadout）、guest 交牌（netSendLoadout）、房主广播 lobby（netSendLobby）、
     房主判「可以开局了」（netMaybeStart）。开局条件写死在这一处：
     双方 selfReady/guestReady 都为真，**且两份牌库此刻重新过一遍 validateDeck**——
     就绪是几分钟前按的，牌库是当时那份；中间连接断过、对方改过牌，这里都不认旧账。 */
  function netLevelConfig(cfg) {
    cfg = cfg || {};
    return { map: cfg.map, rule: cfg.rule, game: cfg.game };     // 只带 id 与数值，中文归 H.TEXT.level / H.TEXT.game
  }
  function netGotoLoadout() {
    var N = S.net;
    if (!N) return;
    S.mode = 'net';
    S.split = false;
    /* 交给路由点名这一页（ROUTER.md §1：新代码一律走 Router，面板显隐由 main.js 的 onRoute 派生） */
    nav('loadout', { role: N.role, room: (N.conn && N.conn.room) || '', seed: N.seed }, false);
  }
  /* NetLoadout 的 reason key → H.TEXT.ui.deny 的 key：判据在逻辑层，人话只有一张表（H.TEXT 那条规矩）。
     count/empty/terrain 都是「没凑够」的三种成因，视图层本来就只用一句 needCount/needTerrain 说它们。 */
  function netDenyOf(reason) {
    if (reason === 'copies') return 'limit';
    if (reason === 'unknown') return 'unknown-card';
    return 'not-enough';
  }
  function netSendLoadout(ready) {
    var N = S.net;
    if (!N || N.role !== 'guest' || !N.conn) return false;
    return N.conn.send({ type: 'loadout', deck: (N.selfDeck || []).slice(), ready: !!ready });
  }
  /* 改了牌 → 本机那次「就绪」作废（与视图层 H.loadoutPick 里清 ready 同一件事的两半）：
     房主清自己的账并广播 lobby；guest 额外发一份 ready:false 的 loadout，
     让房主把 guestReady 收回（协议里"重复发送取最新"就是给这条用的）。 */
  function netInvalidateSelf() {
    var N = S.net;
    if (!N || N.phase !== 'loadout') return;
    var was = N.selfReady || !!N.selfDeck;
    N.selfReady = false; N.selfDeck = null;
    if (!was) return;                                   // 本来就没就绪过：不刷帧，也不动别人的状态行
    if (N.role === 'host') netSendLobby();
    else if (N.conn) N.conn.send({ type: 'loadout', deck: [], ready: false });
  }
  function netSendLobby(extra) {
    var N = S.net;
    if (!N || N.role !== 'host' || !N.conn) return false;
    var msg = { type: 'lobby', hostReady: !!N.selfReady, guestReady: !!N.guestReady,
                waiting: !(N.selfReady && N.guestReady) };
    if (extra) for (var k in extra) msg[k] = extra[k];
    return N.conn.send(msg);
  }
  /* 房主：把界面交来的 {卡 id: 张数} 摊成牌库并校验（这是"我方牌库"唯一进入线上的口） */
  function netTakeOwnPicks(picks) {
    var N = S.net;
    /* reason 只用 H.TEXT.ui.deny 里备好句子的 key（tools/ui_check 反查这条）：校验模块缺席 =
       「这条路还没接上」，与 no-handler 同一句话，不为它另造一个没人话的 key。 */
    if (!N || !G.NetLoadout) return { ok: false, reason: 'no-handler' };
    var deck = G.NetLoadout.pickCounts(picks);
    var v = G.NetLoadout.validateDeck(deck);
    if (!v.ok) { N.selfDeck = null; N.selfReady = false; return { ok: false, reason: v.reason }; }
    N.selfDeck = deck; N.selfReady = true;
    return { ok: true, deck: deck, terrain: v.terrain };
  }
  function netMaybeStart() {
    var N = S.net;
    if (!N || N.role !== 'host' || N.phase !== 'loadout') return false;
    if (!N.selfReady || !N.guestReady || !N.selfDeck || !N.guestDeck) return false;
    var a = G.NetLoadout.validateDeck(N.selfDeck), b = G.NetLoadout.validateDeck(N.guestDeck);
    if (!a.ok || !b.ok) {                       // 事后发现非法：这份不算就绪，退回成因，等对方改完重按
      if (!b.ok) { N.guestDeck = null; N.guestReady = false; }
      netSendLobby({ reject: (!b.ok ? b.reason : a.reason) });
      return false;
    }
    var cfg = N.cfg || S.cfg || {};
    var seed = (N.seed >>> 0);
    /* 同构筑只进日志（SIGNATURE 不进界面）：两端牌库一样时"两边的第一张相同"是正常现象，
       这条日志是玩家报"看起来一模一样"时唯一的查案线索。 */
    if (G.NetLoadout.SIGNATURE(N.selfDeck) === G.NetLoadout.SIGNATURE(N.guestDeck)) {
      console.log('[GW] net loadout: 双方牌库同构筑 ' + G.NetLoadout.SIGNATURE(N.selfDeck));
    }
    var decks = [N.selfDeck.slice(), N.guestDeck.slice()];      // 协议顺序恒 [房主, 加入者]
    if (!N.conn.send({ type: 'start', seed: seed, config: netLevelConfig(cfg), decks: decks })) return false;
    N.phase = 'match';
    netEnter(Object.assign({}, cfg, { decks: decks }), seed);
    return true;
  }
  /* 房主收 guest 的 loadout：合法 + ready 才收下；不合法一份都不留（留半份非法牌库 = 用权威层去建一个坏局） */
  function netTakeLoadout(msg) {
    var N = S.net;
    if (!N || N.role !== 'host' || N.phase !== 'loadout') return;
    var deck = Array.isArray(msg.deck) ? msg.deck : [];
    var v = G.NetLoadout.validateDeck(deck);
    if (msg.ready === true && v.ok) { N.guestDeck = deck.slice(); N.guestReady = true; }
    else { N.guestDeck = null; N.guestReady = false; }
    netSendLobby(v.ok ? null : { reject: v.reason });
    if (G.HUD.setLoadoutStatus) {
      G.HUD.setLoadoutStatus(!v.ok ? 'waiting'
        : (N.guestReady ? (N.selfReady ? 'bothReady' : 'peerReady') : 'waiting'));
    }
    if (N.guestReady) netMaybeStart();
  }
  /* guest 收 lobby：只更新状态行；被退回时把"已就绪"这个承诺收回（改完牌要重按一次） */
  function netTakeLobby(msg) {
    var N = S.net;
    if (!N || N.role !== 'guest' || N.phase !== 'loadout') return;
    N.hostReady = !!(msg && msg.hostReady);
    N.guestReady = !!(msg && msg.guestReady);
    var rej = (msg && msg.reject) ? String(msg.reject) : '';
    if (rej) { N.selfReady = false; }
    if (G.HUD.setLoadoutStatus) {
      G.HUD.setLoadoutStatus(rej ? ('reject:' + rej)
        : (N.hostReady && N.guestReady ? 'bothReady'
          : (N.hostReady ? 'peerReady' : (N.selfReady ? 'readySelf' : 'waiting'))));
    }
  }
  /* guest 收 start：decks 按本地视角 1↔0 换位（协议给的是房主视角 [房主, 加入者]，本页 side 0 必须是自己），
     缺字段的 start 一律忽略并继续等——不许拿一份残缺的开局信息自建一个局（NET.md §9.5「不许假开局」）。 */
  function netTakeStart(msg) {
    var N = S.net;
    if (!N || N.role !== 'guest' || N.phase !== 'loadout') return;
    var decks = Array.isArray(msg.decks) ? msg.decks : null;
    if (!decks || decks.length !== 2 || !Array.isArray(decks[0]) || !Array.isArray(decks[1]) ||
      !decks[0].length || !decks[1].length) {
      console.warn('[GW] net: start 帧缺 decks，忽略（等房主重发或 bye 交代）');
      return;
    }
    var conf = msg.config || {};
    var cfg = Object.assign({}, N.cfg || S.cfg || {}, {
      map: conf.map || (N.cfg && N.cfg.map) || (S.cfg && S.cfg.map),
      rule: conf.rule || (N.cfg && N.cfg.rule) || (S.cfg && S.cfg.rule),
      game: conf.game || (N.cfg && N.cfg.game) || (S.cfg && S.cfg.game),
      decks: [decks[1].slice(), decks[0].slice()]
    });
    N.seed = (typeof msg.seed === 'number' && isFinite(msg.seed)) ? (msg.seed >>> 0) : N.seed;
    N.hostReady = true; N.guestReady = true;
    N.phase = 'match';
    netEnter(cfg, N.seed);
  }

  /* ---------- 收帧：五种帧型各一个分支（NET.md §5 / §9.2） ----------
     joined / peer-joined / snapshot / bye / timeout；guest→host 方向的 input / draftPick / draftSkip
     也走同一个入口（服务端已按角色把帧只送到对席，这里再按本机角色判一次，不信任传输）。 */
  function onNetFrame(msg, conn) {
    if (!msg || !msg.type) return;
    /* 迟到帧的闸门：Connection 断了会自动重连，上一条连接（上一局那条）在 close 之前
       可能还有帧在路上。只认当前这条连接送来的帧——否则上一局的 snapshot 会把新一局的镜像覆盖回旧状态。 */
    var cur = S.net ? S.net.conn : S.netPendingConn;
    if (cur && conn && cur !== conn) return;
    var role = S.net ? S.net.role : (S.netPendingRole || 'host');
    switch (msg.type) {
      case 'joined': {
        if (S.net) return;                              // 已在局内：重复的 joined（重连回来）不重建世界
        /* joined 没带数字 seed 就是没法建图：宁可不进对局，也不拿一个随手猜的 seed 建一张
           与房主不同的图（两端 worldHash 对不上时，查起来比开局失败难得多） */
        if (typeof msg.seed !== 'number' || !isFinite(msg.seed)) {
          G.HUD.toast(netText('noHost'), '#ff9f9f');
          try { conn.close(); } catch (e0) { }
          return;
        }
        var seed = msg.seed >>> 0;
        var cfg = S.cfg || {};
        if (role === 'guest') {
          /* §9.5：guest 用房主下发的 seed 与 config 建世界——这是「两端同一张图」的唯一依据，
             自己点的地图在这里不作数（rulesOpts 缺字段才回退本机的 cfg）。
             v4 起 config 带 game（玩法 + 胜分）：guest 的 director 必须与房主同一个玩法，否则两端
             积分榜的行序、目标线各画各的（NET.md §10「board 同步」）。 */
          var ro = msg.rulesOpts || {};
          cfg = Object.assign({}, cfg, { map: ro.map || cfg.map, rule: ro.rule || cfg.rule, game: ro.game || cfg.game, seed: seed });
        }
        S.netSeed = seed;
        /* 两段式第一段（N5）：**这里不建世界、不建对局**——joined 只代表「连上了、拿到 seed 与关卡」，
           把页面交给路由去战前选牌；netEnter 由 netMaybeStart（房主）/ start 帧（guest）触发。
           世界 diff 记录器也不在这里建（见 netEnter 上面那段注释）。 */
        S.net = (role === 'guest')
          ? { role: 'guest', phase: 'loadout', conn: conn, seed: seed, cfg: cfg,
              selfReady: false, selfDeck: null, hostReady: false, guestReady: false,
              draftOffer: null, draftOpenFor: null, draftSig: '', draftAskedAt: 0,
              extrap: 0, extrapLeft: NET_EXTRAP_BUDGET, pendingCast: -1 }
          : { role: 'host', phase: 'loadout', conn: conn, seed: seed, cfg: cfg,
              selfReady: false, selfDeck: null, guestDeck: null, guestReady: false,
              tracker: null, guestInput: null, lastSnapTick: 0, paired: false };
        /* joined 到了就撤掉 5 秒判定：S.netTimer=0 只是记账，真不触发要靠 clearTimeout */
        if (S.netTimer) { clearTimeout(S.netTimer); S.netTimer = 0; }
        netGotoLoadout();
        /* 房主侧不再多说一句：beginLoop 里的 worldReady 到开局时才报（报在选牌页上就是"世界已就绪"的假话）；
           guest 侧这一句是它唯一的「我连上了而且拿到图了」的交代（对手到位另走 peer-joined） */
        if (role === 'guest') G.HUD.log(netText('joined'), '#ffd86b');
        return;
      }
      case 'peer-joined':
        /* 对席到位。房主侧这一条不只是提示：它是「开始发快照」的闸门（见下面 paired），
           并且立刻补发一份——guest 的世界是按同一个 seed 现建的，攒着的 diff 必须整包送到它手里。 */
        if (S.net && S.net.role === 'host') {
          S.net.paired = true;
          if (S.match) netPushSnapshot();
          /* 战前选牌（任务书 N5 第 4 条）：这一条只说「对手进房了」，**不说他已就绪**——
             就绪由下面的 loadout 帧到齐时才写（界面不许说没发生的事：peerReady 那句人话是
             "对手已就绪 —— 等你这边"，在 peer-joined 那一刻说它就是假话）。
             waiting 在文案表里翻成「等待对手选牌…」，正好是此刻的事实；对方就绪后 netTakeLoadout
             会把这一行换成 peerReady / bothReady。 */
          if (S.net.phase === 'loadout' && G.HUD.setLoadoutStatus) G.HUD.setLoadoutStatus('waiting');
        }
        G.HUD.toast(netText('joined'), '#7fd97f');
        return;
      /* ---------- 战前选牌三条新帧型（v4；NET.md §10）：按本机角色再判一次，不信任传输 ----------
         服务端只把它们送到对席，但"谁该收哪种帧"必须在这边也判一遍——
         否则一个改坏了的转发（或有人手改线上字段）会让 guest 自顾自建局。 */
      case 'loadout':
        if (S.net && S.net.role === 'host' && S.net.phase === 'loadout') netTakeLoadout(msg);
        return;
      case 'lobby':
        if (S.net && S.net.role === 'guest' && S.net.phase === 'loadout') netTakeLobby(msg);
        return;
      case 'start':
        if (S.net && S.net.role === 'guest' && S.net.phase === 'loadout') netTakeStart(msg);
        return;
      case 'snapshot':
        if (role === 'guest' && S.match && S.net && S.net.phase === 'match') netApplySnapshot(msg);
        return;
      case 'input':
        if (role === 'host' && S.match && S.net && S.net.phase === 'match') netTakeInput(msg);
        return;
      case 'draftPick':
        /* guest 的选择不落地在 guest 身上：房主用自己的 Match 裁决，回执走下一份快照（§9.2） */
        if (role === 'host' && S.match && typeof S.match.takeDraft === 'function') S.match.takeDraft(1, msg.cardId);
        return;
      case 'draftSkip':
        if (role === 'host' && S.match && typeof S.match.skipDraft === 'function') S.match.skipDraft(1);
        return;
      case 'bye':
        netBye(msg, conn);
        return;
      case 'timeout':
        /* 「对面画面卡住」不等于「人走了」（2026-10-18 修，tools/net_e2e.cjs 的 E8 管这条）：
           服务端按应用心跳缺席 1 秒发 timeout/peer-stalled，而一次长 GC / 切窗口 / 软件光栅卡顿
           就能触发它；以前这里直接走 netOpponentLeft()（判自己赢 + 结算），卡一下就把整局踢掉
           （SwiftShader 下两页 WebGL 首帧阻塞 930ms 实测中招）。现在只提示、只记状态：
           真正的「人走了」由传输层的 bye host-gone/guest-gone 或 TCP 判死负责。 */
        if (msg.reason === 'peer-stalled') {
          if (S.net) S.net.peerStalled = true;
          G.HUD.toast(netText('stalled'), '#ffd86b');
        }
        return;
      case 'peer-unstall':
        if (S.net) S.net.peerStalled = false;
        G.HUD.toast(netText('unstall'), '#7fd97f');
        return;
    }
  }

  /* 服务端 bye 的三种交代：版本不符（带 want/got）、进不去房间、对席离开。
     开局前的bye = 留在选关（netTeardown 把连接关掉，S.running 从没被置起）；
     开局后的 bye reason=host-gone/guest-gone = 走结算（§9.5「不许卡在暂停或黑屏」）。 */
  function netBye(msg, conn) {
    var r = msg.reason;
    if (r === 'version-mismatch') {
      G.HUD.toast(netText('version') + ' want ' + msg.want + ' / got ' + msg.got, '#ff9f9f');
      netTeardown();
      return;
    }
    if (r === 'no-host' || r === 'host-taken' || r === 'guest-taken') {
      G.HUD.toast(netText(r === 'no-host' ? 'noHost' : 'roomTaken'), '#ff9f9f');
      netTeardown();
      return;
    }
    if (r === 'host-gone' || r === 'guest-gone') { netOpponentLeft(); return; }
    if (!S.net && conn) { try { conn.close(); } catch (e) { } }   // 其它原因的 bye 且还没开局：干净退出
  }

  /* 对席离开：本地补一个终局（winner 0 = 自己这边，reason 交给 H.TEXT.result 翻成人话），
     然后照常走结算面板。房主自己掉线时 guest 由服务端通知，客户端之间不做互相探测（任务书 7）。 */
  function netOpponentLeft() {
    /* 选牌阶段对手走了（N5）：这一局还没开始，没有可结算的东西 —— 明说一句、断开、回选关。
       不许把人留在选牌页上"等待对手"：那是对一个已经不存在的人的等待（NET.md §9.5 那条
       「不许卡在暂停或黑屏」在开局之前同样成立）。 */
    if (S.net && S.net.phase === 'loadout') {
      G.HUD.toast(netText(S.net.role === 'host' ? 'guestGone' : 'hostGone'), '#ff9f9f');
      netTeardown();
      nav('level', null, false);
      return;
    }
    if (!S.match || S.overPause) return;
    S.match.over = { winner: 0, name: '你', ticks: S.match.tick, time: S.match.time, winReason: 'opponent-left' };
    G.HUD.toast(netText(S.net && S.net.role === 'host' ? 'guestGone' : 'hostGone'), '#ff9f9f');
    onMatchOver();
  }

  /* ---------- 房主侧：收 guest 的 input 帧（§9.1/§9.2） ----------
     朝向走 RemoteInputSource.applyTo（绝对角，夹取用它自己的 G.LOOK_LIMIT 口径）；
     移动/出牌只 push 进队列，**由 Match.step 在下一个 tick 消费**——权威层只认 poll 出来的指令流，
     这里绝不代替结算去碰 hp/mana/世界（缺帧 = 空白输入，见 net.js 的 RemoteInputSource.poll）。 */
  function netTakeInput(msg) {
    var p1 = S.match.players[1];
    if (!p1) return;
    G.Net.RemoteInputSource.applyTo(p1, msg);
    var src = S.sources && S.sources[1];
    if (src && src.push) src.push(msg);
    S.net.guestInput = msg;
  }

  /* ---------- 房主侧：每 tick 替 guest 把瞄准算出来（它没有相机） ----------
     guest 只送上来的绝对 yaw/pitch；players[1] 在房主这边没有 OTSCamera 喂 p.aim，
     出牌时 playCard / Rules 读的就是 p.aim 与 ctx.aim。方向式子与 battle.js 的 'auto' 兜底
     同源（fwd=(sinθ,0,cosθ) 配 pitch 的 cos 因子），internal=true 让 aimSrc='auto'：
     这一枪的落点不许粘到下一枪（AGENTS「瞄准新鲜度」那条）。
     放在 poll 之后、step 之前：出牌正是在 step 里发生的，先算好它才用得对。 */
  function netFaceGuest() {
    var p1 = S.match.players[1];
    if (!p1 || !p1.alive) return;
    var yaw = p1.yaw || 0, pitch = p1.pitch || 0, cp = Math.cos(pitch);
    S.match.updateAim(p1, p1.eye(), { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp }, true);
  }

  /* ---------- 房主侧：广播一份快照（§9.2 帧形 {tick,time,view,cells,draft,over}） ----------
     viewerSide 恒 1：serializeFor 是白名单纯函数，guest 只拿到自己的手牌内容 + 对方张数（NET.md §4）。 */
  function netPushSnapshot() {
    var tr = S.net.tracker;
    /* 单份 diff 超预算（§9.4）：这一轮整条不发增量，改用全量 diff（Save 的 seed+差异格表示），
       并把 tracker 排空丢掉增量——一帧塞几千格的 JSON 会把连接与对端的 set 都拖出一秒以上的顿。 */
    var big = !!(tr && tr.size() > NET_CELL_BUDGET);
    var warm = !!(S.net.snapWarm > 0);
    var msg = G.NetMatch.makeSnapshot(S.match, 1, big ? null : tr);
    if (big) {
      msg.cells = (G.Save.exportFrom(S.world).cells) || [];
      if (tr) tr.drain();
    } else if (warm) {
      /* 见 netEnter 那段：这一份不排空记录器 —— 下一份增量会把这些格再发一遍，
         guest 那边 world.set 同一格同一值是幂等的（重复应用不产生第二次 onSet） */
      msg.cells = (G.Save.exportFrom(S.world).cells) || [];
      S.net.snapWarm--;
    }
    msg.type = 'snapshot';
    /* 积分榜随快照下来（N5 第 8 条 / NET.md §10）：guest 不跑 kill 也不跑 director.tick，
       击杀数 / 死亡数 / 目标线 / 时限这几项它自己**永远算不出来**，只能抄房主的账。
       带的是 director.snapshot() 那份纯数据（phase/scores/kills/deaths/target/timeLeft/overtime）——
       里面只有数字与阶段名，一个卡 id 都没有，所以 NET.md §4 的信息隔离判据（E5）不受影响。
       没挂 director 的老路径（所有量具与不选玩法的局）压根不带这个字段，对端也就不会去应用。 */
    if (S.match.director && typeof S.match.director.snapshot === 'function') msg.board = S.match.director.snapshot();
    if (!S.net.conn.send(msg)) return false;   // 连接没开：什么都不发，下一 tick 再试（不算丢帧）
    S.net.lastSnapTick = S.match.tick;
    return true;
  }

  /* ---------- guest 侧：整表覆盖（不做回滚重放，NET.md §3） ----------
     顺序照 §9.3 步 4：先写世界（world.set 会叫醒本地 chem，但 guest 不 step CHEM → 只入队零成本），
     再覆盖权威字段（applySnapshot 内部先 snapshotPrev，跳变由现有 ppos→pos 插值摊成几帧），
     最后把外推预算清零——否则下一次预测会在旧速度上继续加，快照越新角色越飘。 */
  function netApplySnapshot(msg) {
    G.NetMatch.applyCells(S.world, msg.cells || []);
    G.NetMatch.applySnapshot(S.match, msg);
    /* 编排类的账整表覆盖（N5 第 8 条）：必须排在 applySnapshot **之后**——director 的分数读的是 players[]，
       顺序反了就会拿覆盖前的血量/分数比一次终局。第三个参数 mirror=true：房主发来的 board 按房主视角排
       （index 0 = 房主），本页 side 0 是自己 → 数组换位，与 players[] 的镜像同一条口径（§9.1）。
       房主那一侧永远不调这条（它有自己的 director）。 */
    if (msg.board && S.match.director && G.MatchDirector && typeof G.MatchDirector.apply === 'function') {
      G.MatchDirector.apply(S.match.director, msg.board, true);
    }
    S.net.extrap = 0;
    /* over.winner 的 1↔0 互换在 applySnapshot 里做过了，但 over.name 不能跟着搬：
       那是房主那一侧的玩家标签（房主眼里 side 0 叫「你」）。本页必须按【互换后】的胜者
       重新取本地名字，否则 guest 的结算面板会写出「你 获胜」而实际上是房主赢了。 */
    if (S.match.over) {
      var wi = S.match.over.winner;
      S.match.over.name = (typeof wi === 'number' && wi >= 0 && S.match.players[wi]) ? S.match.players[wi].name : '';
    }
    netGuestDraft(msg.draft);
    if (msg.over && !S.overPause) onMatchOver();   // §9.2：guest 收到 over 进结算（面板读的是上面换好的镜像）
  }

  /* guest 的三选一：房主只发该弹给 guest 看的那一条（makeSnapshot 按 side 扫队列）。
     draftAskedAt 是 400ms 去抖：出牌指令在路上的那几百毫秒不重弹；房主真没接受
     （NET.md §9.2「拒绝不回包」）时过后再弹回来——玩家不会静默丢掉选择权。 */
  function netGuestDraft(draft) {
    if (!draft) { S.net.draftOffer = null; S.net.draftOpenFor = null; S.net.draftSig = ''; return; }
    S.net.draftOffer = draft;
    if (G.HUD.panelOpen && G.HUD.panelOpen('choice')) return;            // 面板挂着，不抢玩家的选择
    var sig = [draft.side, draft.source, draft.biome, (draft.options || []).join(',')].join('|');
    var tMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (S.net.draftSig === sig && tMs - (S.net.draftAskedAt || 0) < 400) return;   // 同一次 offer，刚问过了
    S.net.draftSig = sig;
    S.net.draftAskedAt = tMs;
    netOpenGuestDraft(draft);
  }

  /* guest 的三选一面板：复用唯一的 G.HUD.openChoice（GAMEPLAY §7.3 禁止第二套列表 DOM），
     两条出口只发帧——**不调** match.takeDraft/skipDraft，guest 不是权威（NET.md §3）。 */
  function netOpenGuestDraft(offer) {
    var T = (G.HUD.TEXT && G.HUD.TEXT.draft) || {};
    var opened = G.HUD.openChoice({
      title: (offer.source === 'beast' ? T.beastTitle : T.lodeTitle) || '',
      hint: T.hint || '',
      items: (offer.options || []).map(function (id) { return { id: id }; }),
      onPick: function (it) {
        var id = it && it.meta && it.meta.id;
        if (!id) { G.HUD.draftToast('take'); return; }
        if (S.net && S.net.conn) S.net.conn.send({ type: 'draftPick', cardId: id });
      },
      onSkip: function () {
        if (S.net && S.net.conn) S.net.conn.send({ type: 'draftSkip' });
      }
    });
    S.net.draftOpenFor = opened ? offer : null;   // 门面没接住就不算弹过，下一份快照再试
  }

  /* ---------- 开一局联机（start 的 net 分支）----------
     cfg.net = {role:'host'|'guest', url, room, name?}；seed 只有房主说了算（guest 传的不算，等 joined）。 */
  function startNet(cfg) {
    netTeardown();                                   // 上一局的连接与 diff 钩子先摘掉
    var net = cfg.net || {};
    var role = (net.role === 'guest') ? 'guest' : 'host';
    var seed = (cfg.seed === undefined || cfg.seed === '') ? Math.floor(Math.random() * 999999) : (parseInt(cfg.seed, 10) >>> 0);
    if (isNaN(seed)) seed = hashStr(String(cfg.seed));
    if (!G.NetWs || !G.NetWs.Connection || !G.NetMatch || !G.NetLoadout) {
      /* index.html 少了 net-ws.js / net-match.js / net-loadout.js 就是这条路根本走不通。
         这不是玩家能理解的事，也不该编一句假文案盖过去：留一条技术性的 console 线索，
         然后按单人局继续（顶栏的模式标签会如实变成「训练 vs AI」，玩家看得见的是那个，
         不是一个假的「联网」标签）。net-loadout 缺席也必须走这条：没有它就没法校验双方牌库，
         而"没校验过的牌库照样开局"正是 NET.md §10 明令禁止的那类假成功。 */
      console.warn('[GW] net modules missing: src/net-ws.js / src/net-match.js / src/net-loadout.js (index.html script order?)');
      return false;
    }
    S.mode = 'net';
    S.split = false;
    S.cfg = cfg;
    S.netSeed = seed;                    // hello 里报出去的那一份；joined 到手后被权威值覆盖
    S.netPendingRole = role;
    G.HUD.toast(netText('connecting'), '#9d95c4');
    var conn = new G.NetWs.Connection({
      url: net.url || 'ws://127.0.0.1:8787',
      room: net.room || 'ROOM',
      side: (role === 'host') ? 'host' : 'guest',
      name: net.name || (role === 'host' ? '房主' : '挑战者'),
      seed: seed,
      /* v4：config 多带一项 game（{id, target}，H.config 拼好的玩法 + 胜分，docs/MODES.md §6）。
         服务端只原样转存（它不认识玩法），joined 把它回给 guest —— guest 的 director 必须与房主
         同一个玩法，否则两端积分榜的行序与目标线各画各的（NET.md §10）。 */
      config: (role === 'host') ? { map: cfg.map, rule: cfg.rule, game: cfg.game } : undefined,
      getTick: function () { return S.match ? S.match.tick : 0; },
      onFrame: onNetFrame
    });
    /* 这条连接现在是「唯一有效的那条」：onNetFrame 用它挡掉上一局残留的迟到帧
       （Connection 的构造里 connect() 只同步 new WebSocket，onopen/onmessage 都还轮不到跑，
       所以这一行赋值一定先于任何帧到达） */
    S.netPendingConn = conn;
    /* 没有家当可摘的那条路（连接失败）也要有交代：5 秒判一次，joined 到了就取消 */
    S.netTimer = setTimeout(function () {
      S.netTimer = 0;
      if (S.net) return;                              // 已经开局了，不管
      try { conn.close(); } catch (e) { }
      S.netPendingRole = null;
      G.HUD.toast(netText('noHost'), '#ff9f9f');       // 「连不上 / 没有这个房间」——留在选关
    }, NET_JOIN_TIMEOUT);
    return true;
  }

  function start(cfg) {
    cfg = cfg || {};
    if (cfg.mode === 'net') { if (startNet(cfg)) return; cfg = Object.assign({}, cfg, { mode: 'train' }); }
    /* 配牌（选关里「先配一副牌」存的）：单人/分屏都用这一副；联机走 loadout 的两副（cfg.decks 已由 net 侧给） */
    if (!cfg.decks && S.localDeck && S.localDeck.length) cfg.decks = [S.localDeck.slice(), S.localDeck.slice()];
    S.mode = cfg.mode || 'train';
    S.split = S.mode === 'split';
    S.cfg = cfg;
    netTeardown();                                    // 非联机局：把上一局的联机连接与 diff 钩子摘干净
    var seed = (cfg.seed === undefined || cfg.seed === '') ? Math.floor(Math.random() * 999999) : (parseInt(cfg.seed, 10) >>> 0);
    if (isNaN(seed)) seed = hashStr(String(cfg.seed));
    seed = session.buildWorld(cfg, seed);
    session.buildMatch(cfg, seed);
    beginLoop(seed);
  }
  function pick(a) { return a === 'random' ? 'random' : a; }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function makeDeck(kind) {
    if (kind === 'starter' || !kind) return G.STARTER_DECK.slice();
    var pool = G.CARDS.filter(function (c) { return kind === 'random' ? true : c.element === kind; });
    if (!pool.length) return G.STARTER_DECK.slice();
    var rnd = G.mulberry32(hashStr(kind) ^ (S.cfg && S.cfg.seed ? parseInt(S.cfg.seed, 10) : 12345));
    var out = [];
    for (var i = 0; i < 20; i++) out.push(pool[Math.floor(rnd() * pool.length)].id);
    if (kind !== 'random') { out.push('strike', 'dig', 'place', 'draw1'); }
    return out;
  }
  /* 装配层只宣布"对局结束"并冻结主循环；面板字段、文案、淡入都由 hud 层负责 */
  function onMatchOver() {
    S.overPause = true;
    autoFireStop();
    /* 结算同样是 replace：back 应该回选关/标题，而不是回到结算画面 */
    nav('result', { winner: S.match && S.match.over ? S.match.over.winner : null }, true);
    if (!S.recorded) {
      S.recorded = true;
      try {
        var rec = G.StatsStore && G.StatsStore.record ? G.StatsStore.record(S.match, S.cfg) : null;
        if (rec) G.StatsStore.add(rec);
      } catch (e) { /* 战绩是旁路，不能挡住结算画面 */ }
    }
    /* 结算要说的都是 id：终局原因 + 关卡（地图 / 规则），中文由 H.TEXT.result 翻 */
    var cfg = S.cfg || {};
    G.HUD.showMatchResult(S.match, S.mode, {
      winReason: (S.match.over && S.match.over.winReason) || '',
      mapId: (cfg.map && cfg.map.id) || cfg.map || '',
      ruleId: cfg.rule || ''
    });
  }

  /* ---------- 输入：全局键 ---------- */
  function typingNow(t) {
    var n = (t && t.tagName) || '';
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || !!(t && t.isContentEditable);
  }
  window.addEventListener('keydown', function (ev) {
    if (typingNow(ev.target)) return;   // 在种子框/背包搜索框里打字不该触发 R 重开、T 分屏
    if (ev.code === 'Tab') {
      ev.preventDefault();
      var qp = S.match && S.match.players[0];
      if (qp && qp.hand.length) { G.HUD.sel[0] = (G.HUD.sel[0] + 1) % qp.hand.length; G.HUD.invalidate(); }
    }
    else if (ev.code === 'KeyT') { setSplit(!S.split); }
    // 调试三键：状态与动作在 GW.Creative，面板在 GW.HUD，这里只做装配（键位表的家）
    else if (ev.code === 'KeyG') { if (S.running && G.Creative) G.Creative.enable(!G.Creative.on); }
    else if (ev.code === 'KeyE') { if (S.running && G.HUD) toggleInventory(); }        // 背包：生存模式也有（Minecraft 的 E）
    else if (ev.code === 'KeyI') { if (S.running && G.HUD) toggleInventory(); }        // 同一个背包，历史键位（回归与老手感都指它）
    else if (ev.code === 'KeyX') { if (S.running && G.Creative && G.Creative.on) G.Creative.toggleFly(); }
    /* Shift = 机动快捷出牌（2026-10-17 用户："万物皆牌，但不是每张都要打出去——Shift 自动用一张"）：
       从手牌里挑第一张 hot:'shift' 的牌，朝 **WASD 的组合方向**（没按方向就用朝向）触发并消耗。
       键位在这里（装配层），结算全在 battle.useHotkey，不复制第二套规则。

       **不在 keydown 立即结算**：Shift 同时还挂着两件事——"Shift+滚轮 换手持栏类别"的修饰键、
       创造模式的下降键。按下就算一次快捷出牌的话，玩家只是想换类（或想往下飞）就会白扔一张
       闪现/踏霜（虚系卡组里这张牌正好在手上）。现在按下只记时间，松手时判：
       ① 这一次按住的期间出现过 Shift+滚轮 → 不算；
       ② 按得太久（>400ms，下降/连动）→ 不算；
       ③ 否则才算一次轻点。 */
    else if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') {
      if (!S.running || !S.match || S.overPause) return;
      if (netIsGuest()) { G.HUD.toast(netText('hotkeyOff'), '#ff9f9f'); return; }
      S.shiftAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      S.shiftWheel = false; S.shiftArm = true;
    }
    else if (ev.code === 'KeyC') { cycleCamMode(); }
    else if (ev.code === 'KeyP') { if (G.SHADER) { var postOn = G.SHADER.toggle(); G.HUD.postToast(postOn); } }
    else if (ev.code === 'KeyH') { S.helpOn = !S.helpOn; G.HUD.showHelp(S.helpOn); }
    else if (ev.code === 'KeyM') { var on = G.Audio.toggle(); G.HUD.say(on ? 'audioOn' : 'audioOff'); }
    else if (ev.code === 'KeyR') { start(S.cfg || { mode: S.mode }); }
    else if (ev.code === 'F3') { ev.preventDefault(); var lv = [1, 0.75, 0.55], i = lv.indexOf(S.renderScale || 1); S.renderScale = lv[(i + 1) % lv.length]; renderer.setPixelRatio(S.renderScale * Math.min(window.devicePixelRatio || 1, 1.5)); renderer.setSize(window.innerWidth, window.innerHeight); G.HUD.toast('渲染分辨率 ' + Math.round(S.renderScale * 100) + '%（F3 再按切换）', '#9d95c4'); }
    else if (ev.code === 'F9') {
      ev.preventDefault();
      if (!S.match) return;
      if (ev.ctrlKey) { G.HUD.setSaveText(G.Save.toText(G.Save.exportFrom(S.world, S.match))); G.HUD.say('saveToBox', 'gold'); }
      else { var ok = G.Save.localSave(G.Save.exportFrom(S.world, S.match)); G.HUD.say(ok ? 'saveLocalOk' : 'saveLocalFail', ok ? 'ok' : 'bad'); }
    }
    else if (ev.code === 'Escape') {
      /* 选关场景的 Esc = 返回标题（docs/LEVELS.md §0）：先于面板栈判，否则"退不出去" */
      if (routeIs('level') && !(G.HUD.panelOpen && G.HUD.panelOpen('choice'))) { toLevelScene(false); }
      /* 关面板按栈来：先关最上面的（选择面板 → 背包 → 交还指针锁） */
      else if (G.HUD && G.HUD.panelOpen && G.HUD.panelOpen('choice')) {
        /* 挂着的是三选一：Esc 走「先跳过」那一条出口（H.TEXT.draft.hint 承诺的就是这条），
           与面板里那颗按钮同一条权威通道、同样烧次数，不多写第二套语义。
           联机的 guest 例外：它不是权威，skipDraft 打在镜像上是本地裁决（房主根本没听见），
           所以这里发一条 draftSkip 帧，让房主去烧那一次次数——清掉 draftSig 才允许下一份
           快照把同一次 offer 再弹回来（NET.md §9.2「拒绝不回包，面板仍挂着」）。 */
        if (netIsGuest() && S.net.draftOpenFor) {
          if (S.net.conn) S.net.conn.send({ type: 'draftSkip' });
          S.net.draftOpenFor = null; S.net.draftOffer = null; S.net.draftSig = '';
        }
        else if (S.draftOpenFor && S.match && typeof S.match.skipDraft === 'function') {
          var sk = S.match.skipDraft(S.draftOpenFor.side);
          if (!sk || !sk.ok) G.HUD.draftToast('skip');
          S.draftOpenFor = null;
        }
        G.HUD.closeChoice();
      }
      else if (G.HUD && G.HUD.uiPanelOpen()) G.HUD.hideInventory();
      else if (document.pointerLockElement) document.exitPointerLock();
    }
    else if (ev.code === 'Space' && !S.running) ev.preventDefault();
  });
  /* Shift+滚轮 = 切手持栏类别（用户 2026-10-17：整场实时性要求高，切到"挖掘"就不能甩出技能）。
     类别顺序由视图层回答（channel.ask('classOrder')），真正的校验与洗牌仍在权威层。 */
  function shiftHandClass(dir) {
    if (!S.match) return null;
    var p = S.match.players[0]; if (!p) return null;
    var order = (G.UI && G.UI.channel && G.UI.channel.ask('classOrder')) || [];
    if (!order.length) return null;
    var cur = p.handClass || 'all', i = order.indexOf(cur); if (i < 0) i = 0;
    var next = order[(((i + dir) % order.length) + order.length) % order.length];
    /* 反馈在通道处理里统一说（类别条与滚轮同一个入口），这里只负责算下一档。 */
    return G.UI.channel.request('ui.selectClass', { type: next, side: 0 });
  }
  window.addEventListener('wheel', function (ev) {
    if (!S.running) return;
    if (ev.shiftKey) {
      /* 这一次 Shift 按住是"换类"，不是"快捷出牌"：松手时不许再补一张（见 keydown 的说明） */
      S.shiftWheel = true;
      shiftHandClass(ev.deltaY > 0 ? 1 : -1); return;   // 背包开着也要能换类，所以放在暂停判断之前
    }
    // 背包里要滚列表：面板开着时滚轮不再切换手牌
    if (G.HUD && G.HUD.uiPanelOpen && G.HUD.uiPanelOpen()) return;
    var p = S.match.players[0]; if (!p || !p.hand.length) return;
    var n = p.hand.length;
    G.HUD.sel[0] = ((G.HUD.sel[0] + (ev.deltaY > 0 ? 1 : -1)) % n + n) % n;
    G.HUD.invalidate();
  }, { passive: true });
  /* Shift 松手：这一次算不算"快捷出牌"（口径见 keydown 里那三条） */
  window.addEventListener('keyup', function (ev) {
    if (ev.code !== 'ShiftLeft' && ev.code !== 'ShiftRight') return;
    if (!S.shiftArm) return;
    S.shiftArm = false;
    if (!S.running || !S.match || S.overPause) return;
    var nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (S.shiftWheel) return;                              // 这一次是"换类"
    if (!(nowMs - S.shiftAt < 400)) return;                // 长按 = 下降/连动，不当轻点
    if (S.lastHot && nowMs - S.lastHot < 220) return;      // 连按去抖：一次按键只触发一次
    S.lastHot = nowMs;
    var hp1 = S.match.players[0], srcK = S.sources && S.sources[0];
    if (!hp1 || !srcK || !srcK.keys) return;
    var kb = srcK.b, kk = srcK.keys;
    var mvx2 = (kk[kb.right] ? 1 : 0) - (kk[kb.left] ? 1 : 0);
    var mvz2 = (kk[kb.fwd] ? 1 : 0) - (kk[kb.back] ? 1 : 0);
    var fy = hp1.yaw, ffx = Math.sin(fy), ffz = Math.cos(fy);
    var res = S.match.useHotkey(hp1, 'shift', ffx * mvz2 - ffz * mvx2, ffz * mvz2 + ffx * mvx2);
    if (res && !res.ok && res.reason) G.HUD.log(res.reason, '#8a94a6');
  });
  /* ---------- 自动开火：按住左键连发（2026-10-18 用户："选定模式之后一直按左键，系统自动挑最好最合适的"） ----------
     "挑哪张、能不能放"全在权威层（src/systems/auto.js + battle 的 autoFire），这里只做三件事：
     记"左键还按着"、按 90ms 的节奏问一次、把光标跟到真打出去的那一格。
     松手 / 开背包 / 指针锁丢失 / 终局都会停（见 mouseup 与 toggleInventory / onMatchOver）。 */
  var AUTO_MS = 90;
  /* ---------- 左键有两种职责，由**当前出牌组**决定（2026-10-18 用户：
     "左键不能全抢去打架——放置/破坏/移动/辅助组要正常放牌"）：
       · 攻击组（远程/法阵/超阶/召唤）与「全部」：按住 = 连发（auto.js 只挑攻击牌）；
       · 放置/破坏/移动/辅助：左键 = 打出**当前选中那一格**（单击一次，不连发、不换牌）。
     判定只读权威状态 p.handClass，不猜界面；组切换后按住也不许继续连发（见 autoFireStep 的闸）。 */
  var AUTO_GROUPS = { shot: 1, sigil: 1, ultra: 1, summon: 1 };
  function leftPlaysSelected() {
    var p = S.match && S.match.players[0];
    var cls = p && p.handClass;
    return !!cls && !AUTO_GROUPS[cls];
  }
  function autoFireStep() {
    if (!S.match || !S.running || S.overPause) return;
    if (leftPlaysSelected()) { autoFireStop(); return; }          // 切到功能组：扳机松开，左键归"出牌"
    if (netIsGuest()) return;                                     // guest 的出牌一律等房主裁决（NET.md §3）
    if (G.HUD && G.HUD.uiPanelOpen && G.HUD.uiPanelOpen()) return;   // 背包开着：左键是点界面的
    var p = S.match.players[0];
    if (!p || !p.alive) return;
    S.autoT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    S.ctx0 = S.ctx0 || S.match.ctx;
    S.match.ctx.aim = p.aim; S.match.ctx.aimTarget = p.aimTarget;
    var r = S.match.autoFire ? S.match.autoFire(p) : null;
    if (r && r.ok && r.index != null) {
      G.HUD.sel[0] = Math.max(0, Math.min(r.index, Math.max(0, p.hand.length - 1)));
      G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
    }
  }
  function autoFireStop() { if (S.autoFire) { S.autoFire = false; G.HUD.invalidate('hotbar'); } }
  canvas.addEventListener('mousedown', function (ev) {
    if (!S.running) return;
    G.Audio.resume();
    if (!document.pointerLockElement && !S.split) { canvas.requestPointerLock(); return; }   // 第一次点击只锁鼠标，不误出牌
    /* 左键：功能组（放置/破坏/移动/辅助）= 打出选中那一格；攻击组与「全部」= 按住连发。
       功能组不设自动连发：按住砌墙会在一秒里把素材全烧光，那不是手感。 */
    if (ev.button === 0) {
      if (leftPlaysSelected()) { castCard(0, G.HUD.sel[0]); return; }
      S.autoFire = true; S.autoT = 0; autoFireStep(); G.HUD.invalidate('hotbar');
    }
    else if (ev.button === 2) { var p = S.match.players[0]; if (p) { var n = p.hand.length; G.HUD.sel[0] = (G.HUD.sel[0] + 1) % Math.max(1, n); G.HUD.invalidate(); } }
  });
  window.addEventListener('mouseup', function (ev) { if (ev.button === 0) autoFireStop(); });
  window.addEventListener('blur', autoFireStop);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('pointerlockchange', function () {
    G.pointerLocked = !!document.pointerLockElement;
    if (!G.pointerLocked) autoFireStop();                    // 松开指针锁 = 松开扳机
    var lh = document.getElementById('lockHint');
    if (lh && G.pointerLocked) lh.classList.remove('on');
    // 背包要用鼠标点，这时候催"点击画面锁定鼠标"是干扰
    else if (lh && S.running && !S.split && !S.overPause && !(G.HUD && G.HUD.uiPanelOpen && G.HUD.uiPanelOpen())) lh.classList.add('on');
  });
  window.addEventListener('resize', function () {
    renderer.setSize(window.innerWidth, window.innerHeight);
    for (var i = 0; i < 2; i++) if (S.cams[i]) S.cams[i].resize(aspectFor(i));
  });

  function setSplit(on) {
    if (!S.match) return;
    /* 联机不许切分屏（按 T）：这函数会重建 S.sources 并挂上 AISource——
       等于把 guest 那一席交给 AI 代打，而且 match.mode 被写歪，快照对不上账。
       分屏是同机验证两端一致性的手段，不是联机的一部分（docs/NET.md §7）。 */
    if (S.net) { G.HUD.toast(netText('splitOff'), '#ff9f9f'); return; }
    S.split = on;
    S.mode = on ? 'split' : 'train';
    S.autoFace = on;                     // 分屏下 P2 只用 , . 微调，主转向自动锁向对手
    if (S.match) S.match.mode = S.mode;
    S.sources = [S.sources[0]];
    if (on) S.sources.push(new G.Net.KeyboardSource({
      fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight',
      lookL: 'BracketLeft', lookR: 'BracketRight', lookU: 'BracketLeft', lookD: 'BracketRight', jump2: 'Enter',
      cast: ['KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5']
    }, { mouseLook: false }));
    else S.sources.push(new G.Net.AISource(S.match, 1, 1));
    G.HUD.setSplit(on);
    if (window.__layoutSplit) window.__layoutSplit(on);
    G.HUD.log(G.HUD.TEXT.ui.msg[on ? 'splitOn' : 'splitOff'], '#ffd86b');
  }
  // 分屏下 P2 自动朝向对手（键盘转向太重，保留微调）
  var _step = null;
  function autoFacePatch() {
    if (!S.autoFace || !S.match) return;
    var p2 = S.match.players[1], p1 = S.match.players[0];
    if (!p2 || !p1 || !p2.alive) return;
    if (window.__p2Manual) return;
    var want = Math.atan2(p1.pos.x - p2.pos.x, p1.pos.z - p2.pos.z);
    var d = ((want - p2.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    p2.yaw += Math.max(-0.12, Math.min(0.12, d * 0.25));
  }
  setInterval(autoFacePatch, 33);

  /* ---------- 引导 ---------- */
  /* 分屏布局交给样式：装配层只翻一个 .split 类，位置全在 index.html 的 .hud.split .ui-* 规则里 */
  window.__layoutSplit = function (on) {
    var h = document.getElementById('hud');
    if (h) h.classList.toggle('split', !!on);
  };
  var __helpEl = document.getElementById('help'); if (__helpEl) __helpEl.style.display = 'none';

  /* ---------- UI → 权威：视图说的每一句话都走 GW.UI.channel 的意图词汇表 ----------
     规则（AGENTS 的分层责任制）：面板不许读 match / Rules，也不许写权威状态；
     想干什么就发一个意图，这里决定"能不能、怎么做"，返回 {ok, reason}。 */
  var _ray = null;
  function aimAtScreen(side, sx, sy) {
    var cam = S.cams[side]; if (!cam || !S.match || !THREE) return null;
    var W = window.innerWidth, H = window.innerHeight;
    var vw = (S.split ? W / 2 : W), vx = side * vw;
    var nx = ((sx - vx) / vw) * 2 - 1, ny = -((sy / H) * 2 - 1);
    if (!_ray) _ray = new THREE.Raycaster();
    _ray.setFromCamera({ x: nx, y: ny }, cam.cam);
    var o = _ray.ray.origin, d = _ray.ray.direction;
    return { o: { x: o.x, y: o.y, z: o.z }, d: { x: d.x, y: d.y, z: d.z } };
  }
  /* 把"光标上那张牌"放回权威手牌：优先回它原来那一格，其次第一个空格；
     手牌满格时进弃牌堆（洗牌后还会再抽到）——任何时候都不许让一张牌凭空消失。
     返回 {ok, slot}：出牌路径要拿 slot 去打，不能凭空假设它是 0。 */
  function placeBack(pl, id, preferSlot) {
    if (!pl || !pl.hand) return { ok: false, reason: 'no-player' };
    var slot = -1, i;
    if (preferSlot >= 0 && preferSlot < 5 && !pl.hand[preferSlot]) slot = preferSlot;
    if (slot < 0) for (i = 0; i < 5; i++) if (!pl.hand[i]) { slot = i; break; }
    if (slot < 0) return { ok: false, reason: 'slot-full' };
    var r = S.match.placeHand(pl, slot, id, {});
    return (r && r.ok) ? { ok: true, slot: slot, via: 'return-hand' } : (r || { ok: false, reason: 'no-room' });
  }
  /* 同样的事，但手牌满格时不许失败：进弃牌堆（洗牌后还会再抽到）。spill 用它当兜底。 */
  function stowCard(pl, id, preferSlot) {
    var r = placeBack(pl, id, preferSlot);
    if (r.ok) return r;
    var d = S.match && S.match.stowDiscard ? S.match.stowDiscard(pl, id) : null;
    if (d && d.ok) { G.HUD.say('spillToDiscard'); return { ok: true, slot: -1, via: 'discard' }; }
    return r;
  }
  function bindUIChannel(CH) {
    /* 视图不许自己判"这张牌能不能出"：探针由装配层给（PLAN §7 的 D5 取舍） */
    CH.provide('canPlay', function (card, p) {
      if (!card || !p || !S.match) return null;
      return { ok: !!(G.Rules.canPlay(card, p, S.match.ctx).ok) };
    });
    CH.provide('running', function () { return !!S.running; });
    CH.bind('app', {
      'ui.selectSlot': function (p) {
        var side = p.side | 0;
        var pl = S.match && S.match.players[side];
        var n = pl && pl.hand && pl.hand.length ? pl.hand.length : 1;
        G.HUD.sel[side] = Math.max(0, Math.min(n - 1, p.slot | 0));
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return { ok: true };
      },
      'ui.selectClass': function (p) {
        if (!S.match || !S.running) return { ok: false, reason: 'not-running' };
        var pl = S.match.players[p.side | 0];
        if (!pl) return { ok: false, reason: 'no-player' };
        var r = S.match.equipClass(pl, p.type);
        /* 反馈只有这一处：手持栏类别条点它、Shift+滚轮也走这条通道，两边不会一个有提示一个没有。 */
        if (r && r.ok) G.HUD.sayClass(r.handClass || 'all', r.equipped);
        /* 切类会把手牌换成这一类的牌，格数可能变少：选中格必须跟着夹回范围内，
           否则滚轮/数字键落在空格上，玩家看到的就是"按了没反应"（2026-10-18 实测 sel=3 而 hand 只有 3 张）。 */
        clampSel(0);
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('hotbar2'); G.HUD.invalidate('inv'); G.HUD.invalidate('vitals0');
        return r;
      },
      'ui.useSlot': function (p) {
        if (!S.running || S.overPause) return { ok: false, reason: 'not-running' };
        castCard(p.side | 0, p.slot);
        return { ok: true };
      },
      'ui.castCard': function (p) {
        if (!S.running) return { ok: false, reason: 'not-running' };
        castCard(p.side | 0, p.slot);
        return { ok: true };
      },
      /* 拖到画面上 = 往那个点出牌：把屏幕点变成相机射线，再走正式出牌通道 */
      'ui.castAt': function (p) {
        if (!S.running || S.overPause) return { ok: false, reason: 'not-running' };
        var side = p.side | 0, pt = aimAtScreen(side, p.screen.x, p.screen.y);
        var pl = S.match && S.match.players[side];
        if (!pt || !pl) return { ok: false, reason: 'not-running' };
        S.match.updateAim(pl, pt.o, pt.d);
        S.match.ctx.aim = pl.aim; S.match.ctx.aimTarget = pl.aimTarget;
        castCard(side, p.slot);
        return { ok: true };
      },
      'ui.give': function (p) {
        var it = p.item;
        if (!it) return { ok: false, reason: 'empty' };
        if (it.kind !== 'card') return { ok: false, reason: 'no-handler' };   // 方块进出世界：通道留好，等机制层
        if (!G.Creative || !G.Creative.on) return { ok: false, reason: 'creative-only' };
        var side = p.side | 0;
        var slot = (p.slotPolicy || p.slot == null) ? G.HUD.sel[side] : p.slot;   // 选中格现问现答，别用容器里的快照
        /* mode：set = 指哪一格放哪一格（含分堆拖）；cast = 放下就打出；auto/one = Shift 甩进牌堆（能追加就追加） */
        var gm = p.mode === 'cast' ? 'cast' : (p.slotPolicy === 'auto' ? 'append' : 'set');
        var r = G.Creative.give(it.id, gm, { slot: slot });
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return r;
      },
      'ui.placeHand': function (p) {
        var pl = S.match && S.match.players[p.side | 0];
        if (!pl) return { ok: false, reason: 'no-player' };
        if (!p.item || p.item.kind !== 'card') return { ok: false, reason: 'no-handler' };
        var slot = p.slotPolicy === 'selected' ? G.HUD.sel[p.side | 0] : (p.slot | 0);
        var r = S.match.placeHand(pl, slot, p.item.id, { toDiscard: p.mode === 'replace' });
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return r;
      },
      /* 手持栏内部换位：卡已经被 takeFromHand 拿走（数组短了一格），所以是"插入到第 slot 格"。
         旧路走 ui.placeHand 会把目标格那张换进光标，松手后玩家手里/光标上各一张，看着像吞了牌。 */
      'ui.moveHand': function (p) {
        var pl0 = S.match && S.match.players[p.side | 0];
        if (!pl0) return { ok: false, reason: 'no-player' };
        if (!p.item || p.item.kind !== 'card') return { ok: false, reason: 'empty' };
        var took = S.match.moveHand(pl0, p.slot | 0, p.item.id);
        clampSel(p.side | 0);
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return took;
      },
      /* 从牌库换一张进手持栏（生存模式的整理手牌）：只换不造，被顶下来的那张原位回牌库。
         组筛选开着时只收同一组的牌——拿着的牌与被换下的牌都在权威层处理，UI 只报意图。 */
      'ui.dealFromDeck': function (p) {
        var plD = S.match && S.match.players[p.side | 0];
        if (!plD) return { ok: false, reason: 'no-player' };
        if (!p.id) return { ok: false, reason: 'empty' };
        var slot = p.slotPolicy === 'selected' ? G.HUD.sel[p.side | 0] : (p.slot | 0);
        var rd = S.match.dealFromDeck(plD, slot, p.id);
        if (rd && rd.ok) clampSel(p.side | 0);
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return rd;
      },
      'ui.takeFromHand': function (p) {
        /* 拿起来（拖拽的来源动作）同理：生存模式也能把自己手里的牌拖到背包里放好 */
        var pl1 = S.match && S.match.players[p.side | 0];
        if (!pl1) return { ok: false, reason: 'no-player' };
        var r = S.match.takeFromHand(pl1, p.slot | 0);
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return r;
      },
      'ui.discard': function (p) {
        var pl2 = S.match && S.match.players[p.side | 0];
        if (!pl2) return { ok: false, reason: 'no-player' };
        var r = S.match.discardSlot(pl2, p.slot | 0);
        G.HUD.invalidate('hotbar');
        return r;
      },
      'ui.spill': function (p) {
        /* 松手落在面板里、却没落在任何容器上（或者关面板时无处安放）。
           生存模式：这张牌是从手持栏拿起来的，**放回原格**——玩家丢错了地方不该丢牌。
           创造模式：光标上的多半是图鉴复制品，丢掉无所谓。 */
        if (G.Creative && G.Creative.on) return { ok: true, via: 'spill' };
        var pl = S.match && S.match.players[(p && p.side) | 0];
        if (pl && p && p.item && p.item.kind === 'card') {
          var back = stowCard(pl, p.item.id, p.slot != null ? (p.slot | 0) : -1);
          G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
          return back;
        }
        return { ok: false, reason: 'no-handler' };
      },
      'ui.reorderHand': function (p) {
        /* 整理自己的手牌不是调试特权：生存模式也得能拖（用户 2026-10-17 要求物品栏回归 MC 式） */
        var pl0 = S.match && S.match.players[p.side | 0];
        if (!pl0) return { ok: false, reason: 'no-player' };
        var r = S.match.swapHand(pl0, p.from | 0, p.to | 0);
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return r;
      },
      'ui.dropOnWorld': function (p) {
        var it = p.item; if (!it) return { ok: false, reason: 'empty' };
        /* 方块 → 世界：这是留给未来的物品↔世界通道，机制层没注册之前一律"没人接" */
        if (it.kind !== 'card') return { ok: false, reason: 'no-handler' };
        var sd = p.side | 0, sl = (p.slot != null) ? (p.slot | 0) : null;
        /* 创造模式：图鉴/货架上那张 = 取下来再打出（复制品，不必已在手里）。
           生存模式：这张牌是刚从手持栏拿起来的，**先放回原格再按屏幕方向打出**——
           旧写法两种模式都走 ui.give，于是"拖到画面上 = 往那点出牌"在生存模式里只会回
           "创造模式才能取卡"（用户报的"背包内外的动作对不上"就是这个）。 */
        if (G.Creative && G.Creative.on) {
          var cs = sl == null ? 0 : sl;
          var r = CH.request('ui.give', { item: it, slot: cs, side: sd, mode: 'cast' });
          if (r && r.ok && p.screen) CH.request('ui.castAt', { slot: cs, side: sd, screen: p.screen });
          return r;
        }
        var pl = S.match && S.match.players[sd];
        if (!pl) return { ok: false, reason: 'no-player' };
        /* 要打出它就必须先回到手里：手牌满格时**不许**悄悄丢进弃牌堆再"打出别的那张"。
           放不回去就拒绝并把牌留在光标上（玩家自己腾一格/扔一张），这才是"不静默、不乱动状态"。 */
        var back = placeBack(pl, it.id, sl == null ? -1 : sl);
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        if (!back.ok) return back;
        if (p.screen) CH.request('ui.castAt', { slot: back.slot, side: sd, screen: p.screen });
        return back;
      },
      'ui.examine': function () { return { ok: true }; },
      'ui.readOnlyUse': function () { return { ok: true }; },
      'ui.debugToggle': function (p) {
        if (!G.Creative) return { ok: false, reason: 'no-handler' };
        if (p.key === 'noclip') { G.Creative.toggleNoclip(); return { ok: true }; }
        G.Creative.set(p.key, p.value); return { ok: true };
      },
      'ui.debugSegment': function (p) { if (!G.Creative) return { ok: false, reason: 'no-handler' }; G.Creative.set(p.key, p.value); return { ok: true }; },
      'ui.debugAction': function (p) {
        if (!G.Creative) return { ok: false, reason: 'no-handler' };
        var r = G.Creative.doAction(p.key);
        if (r && r.resetHand) G.HUD.sel[0] = 0;
        G.HUD.invalidate('hotbar'); G.HUD.invalidate('inv');
        return r;
      },
      'ui.menuAction': function (p) { return menuActionKey(p && p.key); },
      /* ---------- 选关（docs/LEVELS.md §4）：视图说意图，这里写状态 / 开局 / 切场景 ----------
         每条都要有诚实回执：没接住的一律 {ok:false,reason:'no-handler'}，不许假成功。 */
      'ui.levelPick': function (p) {
        if (!p || !p.field) return { ok: false, reason: 'unknown-intent' };
        /* 表单状态的家在视图层（与菜单那一排同一份 vm.level），这里只中转并回写回执。
           联网（docs/NET.md §9.5）：mode==='net' 与 netUrl/netRoom/netRole 照常写进状态——
           旧版这里拒 net 是因为根本没有服务端；N1/N2 交付后 net_host.cjs 就是那条路，
           拒了反而让选关的三字段长不出来（点了没反应 = 玩家看到的还是"未启用"）。
           真不合规的那一条（服务器没填）留在下面的 ui.levelStart 里说人话。 */
        var r = CH.request('ui.menuPick', { field: p.field, value: p.value });
        return (r && r.ok) ? { ok: true, field: p.field, value: p.value } : (r || { ok: false, reason: 'no-handler' });
      },
      'ui.levelStart': function () {
        var cfg = G.HUD.config ? G.HUD.config() : null;
        if (!cfg) return { ok: false, reason: 'no-handler' };
        /* 联网开局：cfg.net = {url,room,role} 由 H.config 拼好（src/hud.js），交给 start 的 net 分支；
           连接失败 / 没有这个房间 / 版本不符由 startNet 那边的 5 秒判定明说人话（H.TEXT.net），
           留在这里判不了，也不许假装开局。装配层只补一条本地就能判的：连服务器都没填。 */
        if (cfg.mode === 'net') {
          var url = String((cfg.net && cfg.net.url) || '').trim();
          if (!/^wss?:\/\//i.test(url)) return { ok: false, reason: 'net-offline' };
        }
        start(cfg);
        return { ok: true, seed: cfg.seed, map: cfg.map && cfg.map.id, rule: cfg.rule, mode: cfg.mode };
      },
      'ui.levelBack': function () { toLevelScene(false); return { ok: true }; },
      /* ---------- 战前选牌（docs/ROUTER.md §2；任务书 L1 第 4/6 条）：三条意图都要有人接 ----------
         picks 的三条上限与「就绪」的合法性判据只有一份实现：src/hud.js 的 H.loadoutPick /
         H.loadoutReady / H.loadoutBack（视图状态的家在视图层，装配层不另存第二份）。
         这里只做接线与诚实回执：门面不在位就 no-handler，绝不假成功。 */
      'ui.loadoutPick': function (p) {
        if (!G.HUD || typeof G.HUD.loadoutPick !== 'function') return { ok: false, reason: 'no-handler' };
        if (!p || !p.id) return { ok: false, reason: 'unknown-card' };
        var rr = G.HUD.loadoutPick(p.id, p.delta);
        /* 动过牌 = 刚才那次「就绪」作废。视图层那边 H.loadoutPick 会清自己的 ready，这边必须跟着清，
           并且 guest 还要把"不再就绪"告诉房主 —— 否则房主会拿一份**旧的**牌库开局
           （玩家看到的界面已经改了，这是最难查的那种不一致）。 */
        if (rr && rr.ok) netInvalidateSelf();
        return rr;
      },
      'ui.loadoutReady': function () {
        if (!G.HUD || typeof G.HUD.loadoutReady !== 'function') return { ok: false, reason: 'no-handler' };
        return G.HUD.loadoutReady();
      },
      /* 选关 → 配牌页（本机、不需要联机）：证明这条意图真的有人接，不是没反应的死按钮 */
      'ui.levelDeck': function () {
        nav('loadout', { local: true }, false);
        return { ok: true };
      },
      'ui.loadoutBack': function () {
        if (!G.HUD || typeof G.HUD.loadoutBack !== 'function') return { ok: false, reason: 'no-handler' };
        return G.HUD.loadoutBack();
      }
    });
  }
  G.HUD.init({
    start: function (cfg) { start(cfg); },
    cast: function (side, i) { castCard(side, i); },
    /* 结算面板的「回选关」：与菜单的「开始游戏」同一条路——都是切页，交给路由（docs/ROUTER.md §1） */
    level: function () { nav('level', null, false); return { ok: true }; },
    /* ---------- 战前选牌交回装配层的两条（docs/ROUTER.md §2）----------
       协议 v4 的 loadout / lobby / start 三帧由联机那一刀接（NET.md §5 表后 + ROUTER.md §2 末）。
       在那之前这里只有一条诚实的默认实现：**没连上就只说「等对手」，不假装开局、不假装有对手**。
       就绪这条特别写清了返回形状，N5 换实现时不必再猜。 */
    /* N5 接上的那一条：按「就绪」= 把这份牌库交给线上。
       · 房主：收下自己这份 + 广播 lobby，然后判「双方是否都齐了」，齐了就发 start 并自己进局；
       · guest：把牌库发给房主，**等 lobby 回执**——自己绝不进局（谁进局由房主的 start 说了算）；
       · 没连上（取景 / 回归 / 手滑走到这一页）：只把「等对手」演出来，不假装开局。
       判据不在这里重写一遍：摊数组与合法性都在 src/net-loadout.js（netTakeOwnPicks 是唯一入口）。 */
    loadoutReady: function (picks) {
      var N = S.net;
      var n = 0;
      if (picks) for (var k in picks) n += picks[k] | 0;
      if (!N || N.phase !== 'loadout' || !N.conn) {
        G.HUD.sayLoadout('waitPeer', 'dim');
        return { ok: true, waiting: true, cards: n };
      }
      if (!G.NetLoadout) return { ok: false, reason: 'no-handler' };
      var t = netTakeOwnPicks(picks);
      if (!t.ok) return { ok: false, reason: netDenyOf(t.reason) };      // 三份上限的人话都在 H.TEXT.ui.deny 里备着
      if (N.role === 'host') {
        netSendLobby();
        netMaybeStart();
        return { ok: true, cards: t.deck.length, terrain: t.terrain, status: N.guestReady ? 'bothReady' : 'readySelf' };
      }
      if (!netSendLoadout(true)) {
        N.selfReady = false; N.selfDeck = null;                          // 发不出去就不算就绪（不许假就绪）
        return { ok: false, reason: 'net-offline' };
      }
      return { ok: true, cards: t.deck.length, terrain: t.terrain, status: 'readySelf' };
    },
    /* 返回 = 断开连接、回选关（docs/ROUTER.md §2）：连接、diff 钩子、5 秒判定一起摘掉（netTeardown），
       页面交给路由。留着一条半开的连接回选关，下一次「开始对局」会认错旧连接 —— 那是更难查的一种坏。 */
    loadoutCancel: function () {
      if (S.net) netTeardown();
      nav('level', null, false);
      return { ok: true };
    },
    /* 配牌模式（不进联机）：把这一副存进装配层，下一次 start 用它建局。
       合法性已经在 H.loadoutReady 里按 UI.LOADOUT_RULES 判过（同一份常量），这里只摊数组。 */
    loadoutLocal: function (picks) {
      var arr = [];
      if (picks) {
        Object.keys(picks).sort().forEach(function (id) {
          var n = picks[id] | 0;
          for (var k = 0; k < n; k++) arr.push(id);
        });
      }
      if (!arr.length) return { ok: false, reason: 'not-enough' };
      S.localDeck = arr;
      if (G.HUD && G.HUD.toast) G.HUD.toast(G.HUD.TEXT.loadout.localSaved, '#7fd97f');
      nav('level', null, false);
      return { ok: true, cards: arr.length };
    }
  });
  /* UI 框架装好之后再把意图处理函数挂上：视图 → 通道 → 这里 → 权威层 */
  if (G.UI && G.UI.channel) bindUIChannel(G.UI.channel);
  /* 创造调试模式：状态与动作在 js/creative.js，面板在 js/ui/panels.js，文案在 js/hud.js 的 H.TEXT。
     这里只接线：按 I 开背包，面板说什么、长什么样都不归装配层管。 */
  /* 背包的调试开关 / 快捷动作不再要装配层中转：视图说意图，下面的 CH.bind('creative') 执行。 */
  function toggleInventory() {
    autoFireStop();                                          // 开面板 = 左键归界面，扳机松开
    if (G.HUD.panelOpen && G.HUD.panelOpen('choice')) { G.HUD.closeChoice(); return; }
    if (G.HUD.uiPanelOpen()) { G.HUD.hideInventory(); return; }
    /* 这里以前写 `if (!G.Creative.on) G.Creative.enable(true, true)`（注释：要能翻背包，先得是创造模式）——
       等于玩家按 E 只想看一眼物品栏，就被塞了无限魔力 / 无敌 / 卡牌不消耗。
       生存模式也该有物品栏与背包（用户 2026-10-17），调试能力改为**按动作**要创造（ui.give 仍是 creative-only）。 */
    G.HUD.showInventory(G.Creative.spec, {});
  }
  if (G.Creative) {
    G.Creative.onNotify = function (what) { G.HUD.creativeToast(what); };
    G.Creative.onCloseInv = function () { G.HUD.hideInventory(); };
    G.Creative.install({ cast: function (side, i) { castCard(side, i); } });
    G.Creative.onChange = function () {
      G.HUD.paintGmBadge(G.Creative.spec());
      if (G.HUD.uiPanelOpen()) G.HUD.refreshInventory();
    };
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  // 菜单背景：先造一个小世界当菜单画面
  (function menuScene() {
    S.world = new G.World({ size: [64, 24, 64], seed: 20261016 });
    S.world.generate(); patchWorldDirty(); buildWorldMeshes();
    ensureCams(); S.cams[0].cam.position.set(32, 30, 90); S.cams[0].cam.lookAt(32, 8, 32);
    (function spin() {
      requestAnimationFrame(spin);
      /* 菜单与选关场景没有主循环（下面 S.running 一真就 return），但 UI 的帧调度必须照跑：
         不跑就是"在选关里点联网 PVP 被拒 → 一个字都不出"——AGENTS 那条「任何被拒绝的动作都必须演出来」
         在对局里由 renderHudOnly 喂，在这两个场景里以前是断的（菜单的 net 提示同样一直没声音）。
         只在主循环不跑时喂，且用固定帧时：同一帧绝不把 app.frame 驱两遍。 */
      if (!S.running && !S.frozen && G.HUD && G.HUD.tickTimers) G.HUD.tickTimers(1 / 60);
      if (S.running || S.frozen) return;   // 冻结时公告牌也不许转：否则脚本刚画完，菜单又盖一帧上去
      S.menuAz = (S.menuAz || 0) + 0.0016;
      var r = 74; S.cams[0].cam.position.set(32 + Math.cos(S.menuAz) * r, 34, 32 + Math.sin(S.menuAz) * r);
      S.cams[0].cam.lookAt(32, 8, 32);
      G.SHADER.renderScene(renderer, scene, S.cams[0].cam, 0, 0, window.innerWidth, window.innerHeight);
    })();
  })();
  requestAnimationFrame(frame);
  if (G.Scene) {
    G.Scene.on(function (n) {
      if (!APP) return;
      APP.ui.scene = { id: n.id, args: n.args, progress: n.progress };
      APP.session.phase = n.id;
      APP.ui.rev++;
    });
  }
  /* 首屏落位改走路由（docs/ROUTER.md §1）：**先订阅再 start**，第一次落位才有人把面板摆出来；
     Router 内部代 Scene.enter 一次，AppState 那份 scene 快照仍是 Scene.on 在写（只有一条路）。 */
  if (G.Router && typeof G.Router.start === 'function') {
    G.Router.on(onRoute);
    G.Router.start();
  } else {
    /* 少了路由层（index.html 的 script 顺序错）也不能停在 boot 场景：nav 会点名并兜底切页 */
    nav('menu', null, false);
  }
  window.__GW_START = start;
  /* __GW_LOADOUT_PREVIEW([n]) —— **只给截图与回归用**（tools/ui_shot.cjs 的 15/16 两张）：
     把视图状态里的 picks 填成 n 张（缺省 12），再点名 loadout 页。这不是玩家路径 ——
     真路径是选关选「联网 PVP」→ joined → 装配层 go('loadout', {role, room})（docs/ROUTER.md §2，N5 接）。
     两条纪律：① 只改视图状态（写 picks 走 H.loadoutPick 那唯一一处，三条上限照样判），
     权威层与 net 一个字节都不动；② 保证地形 ≥ 4 且每张 ≤ 2，否则这张截图看着就是「就绪」灰着的。
     返回实际填进去的张数，让取景脚本能判断这一页到底画出来了没有。 */
  window.__GW_LOADOUT_PREVIEW = function (n) {
    /* 上限的数只在 src/ui/viewmodel.js 写一份（UI.LOADOUT_RULES）；读不到就什么都不填，
       也不在这里抄一套第二份数字 —— 抄了就会和判就绪的那份漂。 */
    var R = G.UI && G.UI.LOADOUT_RULES;
    if (!R) return { ok: false, filled: 0, reason: 'no-handler' };
    var want = (n == null) ? R.deckSize : Math.max(0, Math.min(R.deckSize, n | 0));
    if (!G.HUD || typeof G.HUD.loadoutPick !== 'function') return { ok: false, filled: 0 };
    /* 先清干净：上一张截图留下的牌不该跟着这一张走（走同一条 remove 通道，不直接删对象字段） */
    var cur = G.HUD.loadoutPicks ? G.HUD.loadoutPicks() : {};
    for (var old in cur) for (var z = 0; z < (cur[old] | 0); z++) G.HUD.loadoutPick(old, -1);
    /* 前 4 张强制地形卡（docs/ROUTER.md §2：这是挖掘游戏），其余按卡表原顺序补满 */
    var order = [], i, c, terrList = [], restList = [];
    for (i = 0; i < (G.CARDS || []).length; i++) {
      c = G.CARDS[i];
      if (c && c.type === 'terrain') terrList.push(c); else restList.push(c);
    }
    for (i = 0; i < Math.min(R.terrainMin, want, terrList.length); i++) order.push(terrList[i]);
    for (i = 0; order.length < want && i < restList.length; i++) order.push(restList[i]);
    for (i = 0; order.length < want && i < terrList.length; i++) order.push(terrList[i]);
    var filled = 0;
    for (i = 0; i < order.length; i++) {
      var r = G.HUD.loadoutPick(order[i].id, 1);
      if (r && r.ok) filled++;
    }
    if (G.Router && typeof G.Router.go === 'function') G.Router.go('loadout', { role: 'host', room: 'PREVIEW' });
    else if (typeof nav === 'function') nav('loadout', { role: 'host', room: 'PREVIEW' }, false);
    return { ok: true, filled: filled, want: want };
  };
  /* 取景脚本用它把这一页收掉（别把 loadout 带进后面的对局截图） */
  window.__GW_LOADOUT_HIDE = function () { if (G.HUD && typeof G.HUD.hideLoadout === 'function') G.HUD.hideLoadout(); };
  /* __GW_LOADOUT_AUTO(deckIds[, opts]) —— 战前选牌的**量具与调试入口**（tools/net_e2e.cjs 的 E1–E9 走它）。
     生产路径同一条，不是第二条：写 picks 走 H.loadoutPick 那唯一入口（三条上限照样判、动过牌照样作废就绪），
     交牌与就绪走 H.loadoutReady → 上面的 loadoutReady handler → netSendLoadout / netMaybeStart。
     也就是说：它等价于「把 12 张点完，再点一次就绪按钮」，只是不用真鼠标。
     deckIds 缺省时用 G.NetLoadout.autoDeck(opts)（前 12 张且地形 ≥4 的自动牌库，判据与收货方同一份）。
     返回 {ok, filled, deck, phase, reason}：牌库原样带回去，让脚本能判「两端自己牌库的第一个元素不同」；
     失败必须报得出为什么（reason 是 NetLoadout 的 key），不静默"已经就绪"。 */
  window.__GW_LOADOUT_AUTO = function (deckIds, opts) {
    var NL = G.NetLoadout;
    if (!NL || !G.HUD || typeof G.HUD.loadoutPick !== 'function' || typeof G.HUD.loadoutReady !== 'function') {
      return { ok: false, filled: 0, reason: 'no-handler' };
    }
    var N = S.net;
    /* 不在选牌这一页（没连上 / 已经开局）→ 用现成的「这条路没在跑」那句人话，同样不自造 key */
    if (!N || N.phase !== 'loadout' || !N.conn) return { ok: false, filled: 0, reason: 'not-running' };
    var ids = (Array.isArray(deckIds) && deckIds.length) ? NL.sanitize(deckIds) : NL.autoDeck(opts);
    var v = NL.validateDeck(ids);
    if (!v.ok) return { ok: false, filled: 0, deck: ids, reason: v.reason };
    /* 重新交一份 = 上一次那次「就绪」作废。面板点牌走 ui.loadoutPick 时由那边做同一件事；
       这个入口是绕过通道直接写 picks 的，必须自己补上 —— 否则脚本改完牌，房主还拿旧的那份开局。 */
    netInvalidateSelf();
    /* 先清干净（同一条 remove 通道）：上一份没交出去的脏牌不该混进这一份 */
    var cur = G.HUD.loadoutPicks ? G.HUD.loadoutPicks() : {};
    for (var old in cur) for (var z = 0; z < (cur[old] | 0); z++) G.HUD.loadoutPick(old, -1);
    var filled = 0, i, rr;
    for (i = 0; i < ids.length; i++) { rr = G.HUD.loadoutPick(ids[i], 1); if (rr && rr.ok) filled++; }
    if (filled !== ids.length) return { ok: false, filled: filled, deck: ids, reason: 'limit' };
    rr = G.HUD.loadoutReady();                             // 与玩家点「就绪」按钮同一条路（含上限复核与发帧）
    return { ok: !!(rr && rr.ok !== false), filled: filled, deck: ids.slice(), phase: N.phase,
      role: N.role, reason: (rr && rr.reason) || '' };
  };
  /* __GW_NET()：联机调试与 E2E 的唯一取数口（N4 的 tools/net_e2e.cjs 读它）。
     没连接就返回 null（而不是 {role:undefined}），让调用方分得清「没开联机」与「连了一半」。 */
  window.__GW_NET = function () {
    return S.net ? {
      role: S.net.role,
      /* phase：'loadout'（连上了、还没开局）| 'match'（已在对局里）。两段式开局唯一的可观测区分，
         net_e2e 的 openPair 按它等两端就位，再各调一次 __GW_LOADOUT_AUTO（N5）。 */
      phase: S.net.phase || 'match',
      state: S.net.conn ? S.net.conn.state : 'no-conn',
      room: S.net.conn ? S.net.conn.room : '',
      tick: (S.net.phase === 'match' && S.match) ? S.match.tick : 0,
      seed: (S.net.phase === 'match' && S.world) ? S.world.seed : S.net.seed,
      /* 就绪账目 + **本机自己那份**牌库（side 0 的，不是对方的）：
         guest 的镜像里 players[0].deck 只是长度占位（§4 白名单：牌库顺序不出门），
         所以"自己牌库的第一个元素"只能从这份交出去的账上读 —— E9 判的就是它。 */
      selfReady: !!S.net.selfReady,
      peerReady: !!(S.net.role === 'host' ? S.net.guestReady : S.net.hostReady),
      deck: Array.isArray(S.net.selfDeck) ? S.net.selfDeck.slice() : null,
      peerDeckKnown: !!(S.net.role === 'host' && Array.isArray(S.net.guestDeck)),
      peerDeck: (S.net.role === 'host' && Array.isArray(S.net.guestDeck)) ? S.net.guestDeck.slice() : null
    } : null;
  };
  /* __dbg：调试与回归脚本的窗口。flushDirty/rebuildAll 是给 tools/post_check.cjs 量"开一次日照后
     chunk 重建要多久"用的——那个数只能在这儿拿到，别在页面上靠 sleep 猜。
     skyTick 暴露出来是给 tools/atmos_check.cjs 的：它把主循环冻住后用固定 dt 手动驱动天空与相机，
     这样"关掉大气层"才能与"没装大气的同一份代码"逐像素比（跑着 rAF 比必然对不齐）。 */
  window.__dbg = { scene: scene, renderer: renderer, fx: fxGroup, ent: entGroup, worldGroup: worldGroup, state: S,
    skyTick: skyTick,
    flushDirty: flushDirty,
    rebuildAll: function () {
      var w = S.world, keys = S.chunkMeshes ? Object.keys(S.chunkMeshes) : [];
      for (var i = 0; i < keys.length; i++) w.dirty.add(keys[i]);
      var t0 = performance.now(); flushDirty(99999); return { ms: performance.now() - t0, chunks: keys.length };
    },
    chunkCount: function () { return S.chunkMeshes ? Object.keys(S.chunkMeshes).length : 0; } };
  window.__GW_SNAPSHOT = function () { return G.Save.exportFrom(S.world, S.match); };
  function ctxReady() { return S.match ? S.match.fx : null; }
  window.__GW_LOAD = function (obj) { var cfg = S.cfg || { mode: S.mode }; cfg.load = obj; cfg.seed = obj.seed; start(cfg); };
  /* __camPose({x,z,yaw,pitch,mode[,y,freeze]}) —— 摆姿态供截图（README/AGENTS 承诺过的调试入口，
     之前只有文档没有实现，视觉回路第一次跑就抓到了）。默认冻结输入源，
     否则 AI 会在"摆好→截图"的几十帧里继续出牌改地形，量到的不是摆的那一帧。 */
  window.__camPose = function (o) {
    o = o || {};
    var p = S.match && S.match.players[0], cam = S.cams && S.cams[0];
    if (!p || !cam) return false;
    if (o.freeze !== false && S.sources) S.sources.length = 0;
    var x = o.x === undefined ? p.pos.x : o.x, z = o.z === undefined ? p.pos.z : o.z;
    if (o.y !== undefined) p.pos.set(x, o.y, z);
    else {
      var gy = S.world.camGroundY(Math.floor(x), Math.floor(z));
      p.pos.set(x, (gy < 0 ? 10 : gy + 1) + p.h / 2 + 0.02, z);
    }
    p.vel.set(0, 0, 0); p.alive = true;
    if (o.yaw !== undefined) { p.yaw = o.yaw; if (cam.yawSm !== null) cam.yawSm = o.yaw; }
    if (o.pitch !== undefined) p.pitch = o.pitch;
    if (o.mode) cam.setMode(o.mode);
    return true;
  };
  /* 存档三件事：按钮在 ui 层（菜单面板的 spec），文本框内容也归视图；这里只做"要存什么、存完说什么"。
     提示语全部走 H.TEXT.ui.msg 的 key，装配层不留中文。 */
  function menuActionKey(key) {
    /* 「开始游戏」→ 选关：Scene 的家在装配层，面板只说意图 */
    if (key === 'level') { toLevelScene(true); return { ok: true }; }
    if (key === 'export') {
      if (!S.match) { G.HUD.say('saveNeedMatch', 'bad'); return { ok: false, reason: 'not-running' }; }
      var txt = G.Save.toText(G.Save.exportFrom(S.world, S.match));
      G.HUD.setSaveText(txt);
      G.HUD.say('saveExported', 'gold', S.world.baseline ? JSON.parse(txt).cells.length : 0);
      G.HUD.log(G.HUD.TEXT.ui.msg.saveCopied, '#9d95c4');
      return { ok: true };
    }
    if (key === 'import' || key === 'local') {
      var p = key === 'local' ? G.Save.localLoadSafe() : (function () {
        var v = String(G.HUD.readSaveBox() || '').trim();
        if (!v) { G.HUD.say('saveEmpty', 'bad'); return { ok: false, reason: 'empty' }; }
        return G.Save.fromText(v);
      })();
      if (!p || !p.ok) { if (p && p.reason) G.HUD.toast(p.reason, '#ff9f9f'); return { ok: false, reason: 'bad-save' }; }
      /* 存档导入保留这一关的 map / rule / mode，只换种子与地形（docs/LEVELS.md §2） */
      var cfg = { mode: S.mode, deck: (S.cfg && S.cfg.deck) || 'starter', rule: (S.cfg && S.cfg.rule) || undefined,
        map: (S.cfg && S.cfg.map) || undefined, load: p.obj, seed: p.obj.seed };
      H_hideMenu(); start(cfg);
      return { ok: true };
    }
    return { ok: false, reason: 'no-handler' };
  }
  function H_hideMenu() { G.HUD.hideMenu(); G.HUD.hideResult(); }

  /* ================= 页面路由（docs/ROUTER.md §1）=================
     路由是页面级导航的唯一真源：谁在前台、Scene 是谁、地址栏 hash 全从 G.Router 派生。
     装配层只做两件事：把"要去哪一页"交给 Router，并把 Router 的落位翻成 hud 的面板显隐。
     暂停与指针仍归 Scene（Router 内部代它 enter 一次），面板开合仍是视图层状态（问 hud）——
     这一层不拼 DOM、不写文案，也不留第二份"当前在哪个页面"。 */

  /* 现在这一页叫什么：唯一问法。路由模块缺席时退问 Scene（那是唯一还能给出答案的地方） */
  function routeIs(name) {
    if (G.Router && G.Router.current) return G.Router.current().name === name;
    return !!(G.Scene && G.Scene.is && G.Scene.is(name));
  }
  /* 切页的唯一出口：go 压栈（可 back），replace 不压栈（开局 / 结算这类向前不可回） */
  function nav(name, params, replace) {
    if (!G.Router || typeof G.Router.go !== 'function') {
      /* index.html 少了 src/app/router.js：宁可在控制台点名，也不许静默停在旧页面 */
      if (console && console.error) console.error('[GW] router.js missing: src/app/router.js (index.html script order?)');
      if (G.Scene && G.Scene.enter) G.Scene.enter(name, params || null);
      onRoute({ name: name, params: params || null }, currentRoute());
      return;
    }
    if (replace) G.Router.replace(name, params || null);
    else G.Router.go(name, params || null);
  }
  function currentRoute() { return (G.Router && G.Router.current) ? G.Router.current() : { name: '', params: null, route: null }; }
  /* 路由 → 面板显隐。每个分支把"不该在前台的那两块"也收掉：以前这条链散在 toLevelScene / onMatchOver /
     resultAction 三处，漏一个就是"面板关了但场景还当自己在 level"（主循环的暂停判据读的就是它）。 */
  function onRoute(next, prev) {
    var name = next && next.name;
    if (!name || !G.HUD) return;
    /* 战前选牌面板不属于任何别的页面：只要落的不是 loadout，就顺手收掉它。
       R1 那四条分支各自只收 menu / level / result 三块，面板挂上后少收一块就是
       「hash 已经走了、.ui-loadout-box 还压在画面上」（#loadout 是全屏 .menu 底，玩家什么都点不到）。 */
    if (name !== 'loadout' && typeof G.HUD.hideLoadout === 'function') G.HUD.hideLoadout();
    if (name === 'menu') { G.HUD.hideLevel(); G.HUD.hideResult(); G.HUD.showMenu(); return; }
    if (name === 'level') { G.HUD.hideMenu(); G.HUD.hideResult(); G.HUD.showLevel(); return; }
    if (name === 'loadout') {
      G.HUD.hideMenu(); G.HUD.hideLevel(); G.HUD.hideResult();
      /* 战前选牌面板（docs/ROUTER.md §2）由下一刀挂进 hud；门面不在位就一个字都不演，也不假装有面板 */
      if (typeof G.HUD.showLoadout === 'function') G.HUD.showLoadout(next.params);
      return;
    }
    if (name === 'match') { G.HUD.hideMenu(); G.HUD.hideLevel(); G.HUD.hideResult(); return; }
    if (name === 'result') {
      G.HUD.hideMenu(); G.HUD.hideLevel();
      /* 「淡入 → showResult」这条流程在 onMatchOver 的 showMatchResult 里（260ms 淡幕之后才reveal）；
         这条监听不许抢在它前面把面板抠出来，所以只在**不是**从 onMatchOver 落进来时补一次 reveal。 */
      if (!S.overPause && typeof G.HUD.showResult === 'function') G.HUD.showResult();
    }
  }

  /* 进 / 退选关：只说"去哪一页"——面板显隐由上面的 onRoute 从路由派生（函数名保留，调用点不动） */
  function toLevelScene(on) {
    nav(on ? 'level' : 'menu', null, false);
  }
  G.Save.localLoadSafe = G.Save.localLoad;
})();
