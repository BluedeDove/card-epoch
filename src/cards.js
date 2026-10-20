/* ================= GW.CARDS =================
   纯数据文件：卡牌 schema 与取值。逻辑不在此处。
   数值基准（来自杀戮尖塔的代价-效果换算，换算到本作的魔力）：
     1 魔力 = 6 伤害 = 5 护盾 = 1 格地形改造
   地形卡三重约束：魔力费用 + 冷却 + 单卡最多改 9 格
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var CARDS = G.CARDS = [];
  var BY_ID = G.CARDS_BY_ID = {};

  /* 元素配色（2026-10-17 用户："卡牌配色太保守了，什么元素就什么配色不行——要有烟花感、
     色偏、极端的 RGB 纯色，撕裂的那种特效审美"）。
     color/accent 仍是"这张卡的底色"，UI 与老配方继续读它们（向后兼容）；
     新增的 spectrum 是一组**可以互相撞**的纯色：高饱和、带互补对、留给大配方自己挑。
     举例：虚空的主色是紫，但紫旁边要能直接摆电光青与荧光洋红——同一个形状用两种极端色描边，
     叠在 additive 上就是"色偏/撕裂"的观感，而不是一圈温吞的淡紫。 */
  var EL = G.ELEMENTS = {
    neutral: { cn: '中立', color: '#c9d3e0', accent: '#8a94a6',
               spectrum: ['#ffffff', '#c9d3e0', '#9d95c4', '#ffe066'] },
    fire:    { cn: '焰',   color: '#ff7a45', accent: '#c8341a',
               spectrum: ['#fff2b0', '#ffd23f', '#ff7a45', '#ff2d55'] },
    ice:     { cn: '霜',   color: '#7fd7ff', accent: '#2b7fb8',
               spectrum: ['#ffffff', '#a9f0ff', '#7fd7ff', '#3f6bff'] },
    rock:    { cn: '岩',   color: '#c9a06b', accent: '#7a5a34',
               spectrum: ['#ffe6b8', '#c9a06b', '#8a6a3f', '#b24bc0'] },
    nature:  { cn: '林',   color: '#7fd97f', accent: '#2f7d34',
               spectrum: ['#eaffb0', '#7fd97f', '#2fd0a0', '#00e5ff'] },
    void:    { cn: '虚',   color: '#c58cff', accent: '#6a3fb0',
               spectrum: ['#ffffff', '#a855f7', '#ff2bd6', '#00e5ff'] }
  };

  function C(o) {
    o.cost = o.cost === undefined ? 1 : o.cost;
    o.rarity = o.rarity || 'common';
    o.element = o.element || 'neutral';
    o.type = o.type || 'spell';
    o.cooldown = o.cooldown || 0;
    o.requires = o.requires || [];
    o.effects = o.effects || [];
    o.targeting = o.targeting || { shape: 'self' };
    o.tags = o.tags || [o.type, o.element];
    o.text = o.text || '';
    CARDS.push(o); BY_ID[o.id] = o;
    return o;
  }
  /* 常用 effect 构造简写。
     dmg(伤害, 爆炸半径, 伤害类型, 近失引爆半径)：
       radius  —— 落点半径内的敌人都吃伤害（离爆心越远扣得越少，见 battle.js 的 explode）
       fuse    —— 抛射物的"打偏也算打中"圈：小球中心进入敌人这个距离就起爆
     fuse 不给就用 battle.js 的 ELEMENT_FUSE 分元素默认档（火最爆裂、物理最保守）。
     2026-10-16 用户报"扔出去是个小球，只有那一格砸到才掉血，很难打中、扣得又少"，
     这两个字段就是那次的答复；数值档位在 tools/hit_check.cjs 里有区间断言。 */
  function dmg(a, r, k, fuse) {
    var o = { op: 'damage', amount: a, radius: r || 0, kind: k || 'physical' };
    if (typeof fuse === 'number') o.fuse = fuse;
    return o;
  }
  function shield(a, dur) { return { op: 'shield', amount: a, dur: dur || 8 }; }
  function sb(mode, extra) { return Object.assign({ op: 'setBlock', mode: mode, maxCells: 9 }, extra || {}); }
  function st(kind, dur, radius) { return { op: 'status', kind: kind, dur: dur, radius: radius || 0 }; }
  function sp(kind, count, stats) { return Object.assign({ op: 'spawn', kind: kind, count: count || 1 }, stats || {}); }
  /* 法阵：sigilId 指定用哪份 preset（不写 = 用卡 id 那张），dx/dz 是相对落点的偏移。
     2026-10-17 超阶魔法要一次铺十几座阵，就靠这两个可选参数在数据里摆位置。 */
  function sg(sigilId, delay, ttl, dx, dz) {
    var o = { op: 'sigil', sigilId: sigilId, delay: delay, ttl: ttl };
    if (dx) o.dx = dx;
    if (dz) o.dz = dz;
    return o;
  }

  /* ---------- 基础牌（初始牌库 12 张：保证开局一定有地形操作与基础攻击） ---------- */
  C({ id: 'strike', role: 'shot', name: '打击', cost: 1, type: 'spell', targeting: { shape: 'ray', maxDist: 18 }, effects: [dmg(6, 1.5, 'physical', 1.35)], cooldown: 0.5, text: '掷出打击：命中处 1.5 格内 6 伤害（打偏一点也算中）。', art: 'bolt' });
  C({ id: 'guard', role: 'aid', name: '护身', cost: 1, effects: [shield(5, 8)], text: '获得 5 点护盾，持续 8 秒。', art: 'shield' });
  C({ id: 'dig', role: 'dig', name: '采掘', cost: 1, type: 'terrain', targeting: { shape: 'ray', maxDist: 6 }, effects: [sb('erase', { radius: 0 })], cooldown: 0.6, text: '挖掉瞄准的方块（最多 1 格）。', art: 'pick' });
  C({ id: 'place', role: 'place', name: '置方', cost: 1, type: 'terrain', targeting: { shape: 'ray', maxDist: 6 }, effects: [sb('fill', { radius: 0, block: 'plank' })], cooldown: 0.6, text: '在瞄准面放置 1 格木板。', art: 'cube' });
  C({ id: 'dig3', role: 'dig', name: '掘进', cost: 2, type: 'terrain', targeting: { shape: 'ray', maxDist: 7 }, effects: [sb('erase', { radius: 1, height: 1 })], cooldown: 1.4, text: '横向挖开最多 9 格（3×3 区域）。', art: 'pick' });
  /* 2026-10-17 用户报"墙只生成地面上那一格、挡不住敌人"：
     旧 wall 模式把墙砌在**瞄准到的那一格方块**上（等于先填掉脚下的草地，只剩上面 1 格）；
     现在按瞄准面偏移落位（同 fill 的口径），并且**先砌满高度再往两侧铺**，
     素材只够几格时也是一段真正立起来的墙，而不是一道高 1 的坎。 */
  C({ id: 'wall2', role: 'place', name: '垒墙', cost: 2, type: 'terrain', targeting: { shape: 'ray', maxDist: 10 }, effects: [sb('wall', { length: 3, height: 2, block: 'brick' })], cooldown: 2.2, text: '朝瞄准方向垒出 3×2 砖墙（先砌满高度）。', art: 'fence' });
  C({ id: 'draw1', role: 'aid', name: '沉思', cost: 1, effects: [{ op: 'draw', count: 2 }], text: '抽 2 张牌。', art: 'eye' });

  /* ---------- 岩 rock：地形改造主干 ---------- */
  C({ id: 'raise', role: 'place', name: '升岩', cost: 2, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 9 }, effects: [sb('column', { block: 'stone', up: true })], cooldown: 1.6, text: '使目标处地面隆起石柱（≤9 格）。', art: 'pillar' });
  C({ id: 'fall', role: 'dig', name: '塌落', cost: 2, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 9 }, effects: [sb('erase', { radius: 1, height: 3 }), dmg(8, 2.2, 'physical')], cooldown: 2.0, text: '抽掉目标处最多 9 格地面，跌落者受 8 伤害。', art: 'down' });
  /* 2026-10-17 用户报"桥不该点到哪生成哪，要朝一个方向抛出、沿抛物线铺过去"：
     现在起铺点是**自己脚下**，方向取相机朝向（落点只决定朝向，不决定起点），
     桥钉按抛物线飞出去、沿途铺板——所以在半空跳起来也能铺出一条空中栈桥，不需要精确瞄准。 */
  C({ id: 'bridge', role: 'place', name: '飞桥', cost: 2, element: 'rock', type: 'terrain', targeting: { shape: 'ray', maxDist: 12 }, effects: [sb('bridge', { length: 10, width: 1, block: 'plank', maxCells: 12 })], cooldown: 5, text: '朝相机方向掷出桥钉，沿抛物线铺出 10 格桥面：起点在你脚下，空中也能铺。', art: 'bridge' });
  C({ id: 'spikes', role: 'shot', name: '石刺', cost: 2, element: 'rock', type: 'spell', targeting: { shape: 'circle', radius: 2, maxDist: 14 }, effects: [dmg(14, 2.4, 'physical'), st('root', 1.5, 2.4)], cooldown: 2.6, text: '地面弹出石刺：14 伤害并定身 1.5 秒。', art: 'spike' });
  C({ id: 'bulwark', role: 'aid', name: '岩肤', cost: 2, element: 'rock', effects: [shield(14, 10)], text: '获得 14 点护盾，持续 10 秒。', art: 'shield' });
  C({ id: 'obsidian_cage', role: 'place', name: '黑曜封笼', cost: 4, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 8 }, effects: [sb('cage', { block: 'obsidian', height: 3, maxCells: 12 })], cooldown: 8, text: '在目标周围立起 4 面黑曜石墙（高 3 格，最多 12 格）。', art: 'cube' });
  C({ id: 'shift', role: 'dig', name: '移山', cost: 3, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 9 }, effects: [sb('shift', { dx: 2 })], cooldown: 4, text: '把目标处一块地形整体横移 2 格。', art: 'shift' });
  C({ id: 'ramp', role: 'place', name: '斜坡', cost: 2, element: 'rock', type: 'terrain', targeting: { shape: 'ray', maxDist: 8 }, effects: [sb('ramp', { length: 4, block: 'stone' })], cooldown: 3, text: '造一段 4 格登高斜坡。', art: 'ramp' });

  /* ---------- 火 fire ---------- */
  C({ id: 'bolt', role: 'shot', name: '焰矢', cost: 2, element: 'fire', targeting: { shape: 'ray', maxDist: 20 }, effects: [dmg(11, 2.0, 'fire', 1.8), st('burn', 3, 0)], cooldown: 1.0, text: '射出焰矢：命中处爆燃 2 格 11 伤害并点燃 3 秒。', art: 'flame' });
  C({ id: 'bloom', role: 'shot', name: '焰华', cost: 3, element: 'fire', targeting: { shape: 'circle', radius: 2.5, maxDist: 20 }, effects: [dmg(13, 2.8, 'fire')], cooldown: 2.4, text: '目标处爆燃：范围 13 伤害。', art: 'burst' });
  C({ id: 'firewall', role: 'place', name: '火幕', cost: 3, element: 'fire', type: 'terrain', targeting: { shape: 'ray', maxDist: 12 }, effects: [sb('wall', { length: 4, height: 2, block: 'leaf' }), { op: 'ignite', radius: 2.2, dur: 5 }], cooldown: 5, text: '立起可燃屏障并点燃，形成 5 秒火域。', art: 'wallfire' });
  C({ id: 'lava', role: 'place', name: '岩浆注入', cost: 4, element: 'fire', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 8 }, effects: [sb('fill', { block: 'lava', radius: 1 })], cooldown: 9, text: '在目标处注入岩浆（流动会持续改造地形）。', art: 'lava' });
  C({ id: 'meteors', role: 'sigil', name: '陨星阵', cost: 5, element: 'fire', type: 'sigil', targeting: { shape: 'circle', radius: 3, maxDist: 18 }, effects: [sg('meteors', 1.6, 6)], cooldown: 12, text: '布下陨星魔法阵，1.6 秒后落星连击（可被提前打散）。', art: 'star' });
  C({ id: 'ignite', role: 'shot', name: '燃地', cost: 2, element: 'fire', targeting: { shape: 'circle', radius: 2, maxDist: 14 }, effects: [{ op: 'ignite', radius: 2.2, dur: 4 }], cooldown: 3, text: '点燃地面，可燃方块会被烧成灰烬。', art: 'flame' });
  C({ id: 'cinder_dash', role: 'move', name: '烬闪', cost: 2, element: 'fire', targeting: { shape: 'ray', maxDist: 14 }, effects: [{ op: 'blink', dist: 8 }, dmg(9, 2.2, 'fire', 1.9)], cooldown: 3, hot: 'shift', text: '向瞄准方向瞬移 8 格，落点 2.2 格内灼烧 9 伤害。', art: 'dash' });
  /* 2026-10-17：烬羽本来就是鸟，改成**飞行**召唤（fly）。飞的那一档在 battle.js 的 stepSummons 里，
     不吃重力、绕过地形，粒子光环按 aiKind 查 SUMMON_FX。 */
  C({ id: 'phoenix', role: 'summon', name: '烬羽 Phoenix', cost: 5, element: 'fire', type: 'summon', targeting: { shape: 'self' }, effects: [sp('wisp', 2, { hp: 22, dmg: 6, speed: 5.2, ai: 'flank', fly: true, mode: 'track' })], cooldown: 16, text: '召唤 2 只烬羽（飞行），绕后灼烧敌人。', art: 'bird' });

  /* ---------- 冰 ice ---------- */
  C({ id: 'shard', role: 'shot', name: '霜片', cost: 1, element: 'ice', targeting: { shape: 'ray', maxDist: 20 }, effects: [dmg(7, 1.7, 'ice', 1.6), st('slow', 2, 0)], cooldown: 0.8, text: '7 冰伤并减速 2 秒，落点 1.7 格内同样生效。', art: 'shard' });
  C({ id: 'freeze', role: 'shot', name: '冰封', cost: 3, element: 'ice', targeting: { shape: 'circle', radius: 2, maxDist: 18 }, effects: [st('frozen', 2.6, 2.4), dmg(6, 2.4, 'ice')], cooldown: 7, text: '冻结目标 2.6 秒。', art: 'snow' });
  C({ id: 'icewall', role: 'place', name: '冰墙', cost: 2, element: 'ice', type: 'terrain', targeting: { shape: 'ray', maxDist: 9 }, effects: [sb('wall', { length: 4, height: 2, block: 'ice' })], cooldown: 3.5, text: '升起 4×2 冰墙，可挡路与挡弹。', art: 'fence' });
  C({ id: 'icefloor', role: 'place', name: '结冰', cost: 2, element: 'ice', type: 'terrain', targeting: { shape: 'circle', radius: 2, maxDist: 9 }, effects: [sb('layer', { block: 'ice', depth: 1 })], cooldown: 3, text: '把目标地面冻成冰面（打滑）。', art: 'snow' });
  C({ id: 'glacier', role: 'sigil', name: '冰川阵', cost: 4, element: 'ice', type: 'sigil', targeting: { shape: 'circle', radius: 3, maxDist: 18 }, effects: [sg('glacier', 1.2, 8)], cooldown: 11, text: '寒霜法阵：持续冻结并减速圈内敌人。', art: 'ring' });
  C({ id: 'frost_nova', role: 'shot', name: '霜爆', cost: 3, element: 'ice', targeting: { shape: 'self' }, effects: [dmg(10, 4.5, 'ice'), st('slow', 3, 4.5)], cooldown: 5, text: '以自身为中心爆发霜寒。', art: 'burst' });
  C({ id: 'hail', role: 'shot', name: '冰雹阵', cost: 3, element: 'ice', type: 'summon', targeting: { shape: 'circle', radius: 2.5, maxDist: 18 }, effects: [{ op: 'hail', count: 8, dmg: 5 }], cooldown: 6, text: '在目标区域降下 8 发冰雹。', art: 'down' });
  C({ id: 'ice_step', role: 'move', name: '踏霜', cost: 2, element: 'ice', targeting: { shape: 'ray', maxDist: 16 }, effects: [{ op: 'blink', dist: 7 }, sb('fill', { block: 'ice', radius: 0 })], cooldown: 3, hot: 'shift', text: '向前滑步 7 格并在脚下留一块冰。', art: 'dash' });

  /* ---------- 自然 nature：召唤与治疗 ---------- */
  C({ id: 'heal', role: 'aid', name: '萌发', cost: 2, element: 'nature', effects: [{ op: 'heal', amount: 12 }], text: '回复 12 生命。', art: 'leaf' });
  C({ id: 'overgrow', role: 'place', name: '疯长', cost: 3, element: 'nature', type: 'terrain', targeting: { shape: 'circle', radius: 2, maxDist: 9 }, effects: [sb('grow', { block: 'leaf', height: 3 })], cooldown: 4, text: '在目标处长出灌木地形，遮挡视线。', art: 'tree' });
  C({ id: 'golem', role: 'summon', name: '岩魔', cost: 4, element: 'nature', type: 'summon', targeting: { shape: 'self' }, effects: [sp('golem', 1, { hp: 46, dmg: 9, speed: 2.6, ai: 'melee', taunt: true, mode: 'track' })], cooldown: 14, text: '召唤岩石魔像，替你挡刀并近战。', art: 'golem' });
  C({ id: 'thorns', role: 'shot', name: '荆缚', cost: 2, element: 'nature', targeting: { shape: 'circle', radius: 2, maxDist: 16 }, effects: [st('root', 2.4, 2.4), dmg(6, 2.4, 'nature')], cooldown: 4, text: '荆棘缠身：定身 2.4 秒。', art: 'vine' });
  C({ id: 'dryad', role: 'summon', name: '树精', cost: 3, element: 'nature', type: 'summon', targeting: { shape: 'self' }, effects: [sp('dryad', 1, { hp: 26, dmg: 5, speed: 3.4, ai: 'healer', mode: 'direct', leash: 6 })], cooldown: 12, text: '召来树精（指向性）：守在你瞄准的位置附近，就近治疗。', art: 'leaf' });
  C({ id: 'bloom_field', role: 'sigil', name: '繁花阵', cost: 3, element: 'nature', type: 'sigil', targeting: { shape: 'circle', radius: 2.5, maxDist: 16 }, effects: [sg('bloom', 0.8, 9)], cooldown: 10, text: '花之法阵：圈内友军持续回复。', art: 'ring' });
  C({ id: 'entangle', role: 'shot', name: '缠根', cost: 1, element: 'nature', targeting: { shape: 'ray', maxDist: 22 }, effects: [dmg(4, 1.8, 'nature', 1.5), st('root', 1.2, 1.8)], cooldown: 2.5, text: '荆棘缠住落点 1.8 格内的敌人：4 伤害并定身 1.2 秒。', art: 'vine' });
  C({ id: 'regrow', role: 'aid', name: '再生', cost: 2, element: 'nature', effects: [{ op: 'regen', amount: 2, dur: 10 }], cooldown: 6, text: '10 秒内持续回复。', art: 'plus' });

  /* ---------- 机动系（2026-10-17 用户："万物皆牌，但不一定都要打出去——拿快捷键用"） ----------
     hot:'shift' = 按 Shift 时自动从手牌里挑一张它、朝**移动方向**触发并消耗（battle.useHotkey）。
     费用/冷却/结算与正常出牌完全同一条通道，不存在快捷键特权。 */
  C({ id: 'phase_dash', role: 'move', name: '疾跃', cost: 1, element: 'void', rarity: 'common', hot: 'shift',
      targeting: { shape: 'self' },
      effects: [{ op: 'dash', power: 15, up: 2.6, iframes: 0.3 }], cooldown: 3.5,
      text: '朝移动方向跃出一段（带 0.3 秒无敌帧）。按 Shift 直接触发。', art: 'dash', tint: ['#a855f7', '#00ffff'] });
  C({ id: 'wings', role: 'move', name: '浮空', cost: 2, element: 'void', rarity: 'uncommon', hot: 'shift',
      targeting: { shape: 'self' },
      effects: [{ op: 'flight', dur: 4 }], cooldown: 12,
      text: '4 秒内自由飞行：空格升、Shift 降。按 Shift 直接触发（空手时）。', art: 'bird', tint: ['#a9f0ff', '#00e5ff'] });
  C({ id: 'orb_ward', role: 'aid', name: '环盾', cost: 3, element: 'ice', rarity: 'uncommon',
      targeting: { shape: 'self' },
      effects: [{ op: 'orbShield', count: 4, radius: 1.8, dur: 9, hp: 2 }], cooldown: 10,
      text: '召出 4 颗环绕盾球：漂在你身边，飞来的子弹会被**真的撞掉**（每颗挡 2 发）。', art: 'shield', tint: ['#a9f0ff', '#00ffff'] });

  /* ---------- 虚空 void：位移、抽牌、封印 ---------- */
  C({ id: 'blink', role: 'move', name: '闪烁', cost: 1, element: 'void', targeting: { shape: 'ray', maxDist: 14 }, effects: [{ op: 'blink', dist: 9 }], cooldown: 3, hot: 'shift', text: '向瞄准方向瞬移最多 9 格（按 Shift 自动朝移动方向触发）。', art: 'dash' });
  C({ id: 'void_lance', role: 'shot', name: '虚 lance', cost: 3, element: 'void', targeting: { shape: 'ray', maxDist: 24 }, effects: [dmg(16, 1.6, 'void', 1.5)], cooldown: 3, text: '虚空长枪：16 伤害，落点 1.6 格内通吃。', art: 'bolt' });
  C({ id: 'erase', role: 'dig', name: '湮灭', cost: 3, element: 'void', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 9 }, effects: [sb('erase', { radius: 1, height: 2 })], cooldown: 4, text: '湮灭目标处最多 9 格地形（不掉落素材）。', art: 'spiral' });
  C({ id: 'siphon', role: 'shot', name: '虹吸', cost: 2, element: 'void', targeting: { shape: 'ray', maxDist: 20 }, effects: [dmg(10, 1.5, 'void', 1.4), { op: 'gainMana', amount: 2 }], cooldown: 4, text: '造成 10 伤害并回复 2 魔力。', art: 'eye' });
  C({ id: 'curse', role: 'shot', name: '脆弱咒', cost: 2, element: 'void', targeting: { shape: 'ray', maxDist: 22 }, effects: [st('vuln', 6, 0)], cooldown: 6, text: '目标受到的伤害 +35%，持续 6 秒。', art: 'skull' });
  C({ id: 'rune_hammer', role: 'sigil', name: '符文锤', cost: 3, element: 'void', type: 'sigil', targeting: { shape: 'circle', radius: 2.5, maxDist: 16 }, effects: [sg('rune_hammer', 0.9, 5)], cooldown: 9, text: '符文重锤法阵：延迟后砸下重伤。', art: 'hammer' });
  C({ id: 'swap', role: 'move', hot: 'shift', name: '换身', cost: 4, element: 'void', targeting: { shape: 'ray', maxDist: 18 }, effects: [{ op: 'swap' }], cooldown: 14, text: '与瞄准到的随从交换位置。', art: 'shift' });
  C({ id: 'nullify', role: 'aid', name: '破阵', cost: 1, element: 'void', targeting: { shape: 'ray', maxDist: 22 }, effects: [{ op: 'destroySigil' }], cooldown: 2, text: '摧毁瞄准到的魔法阵。', art: 'shatter' });
  C({ id: 'gift', role: 'aid', name: '虚空馈赠', cost: 1, element: 'void', effects: [{ op: 'draw', count: 3 }, { op: 'loseHp', amount: 4 }], cooldown: 5, text: '抽 3 张牌，扣 4 生命。', art: 'eye' });

  /* ---------- 经济与场面（中立补充） ---------- */
  C({ id: 'harvest', role: 'aid', name: '采晶', cost: 1, type: 'utility', targeting: { shape: 'ray', maxDist: 10 }, effects: [{ op: 'harvest' }], cooldown: 1.2, text: '敲下瞄准的以太晶，立刻 +3 魔力（上限内）。', art: 'crystal' });
  C({ id: 'push', role: 'aid', name: '斥力', cost: 2, targeting: { shape: 'self' }, effects: [{ op: 'push', power: 11, up: 3 }], cooldown: 3.5, text: '把身边敌人弹开。', art: 'burst' });
  C({ id: 'anchor', role: 'aid', name: '锚定', cost: 1, effects: [shield(6, 6), st('sturdy', 3, 0)], cooldown: 4, text: '6 护盾并免疫击退 3 秒。', art: 'anchor' });
  C({ id: 'overload', role: 'aid', name: '超载', cost: 2, effects: [{ op: 'gainMana', amount: 4 }, { op: 'manaCapDown' }], cooldown: 12, text: '立刻 +4 魔力，但本局魔力上限 -1。', art: 'battery' });
  C({ id: 'focus', role: 'aid', name: '凝势', cost: 1, effects: [{ op: 'buffNext', amount: 0.5 }], cooldown: 6, text: '下一张卡效果 +50%。', art: 'star' });
  C({ id: 'kick', role: 'move', hot: 'shift', name: '疾行', cost: 1, effects: [{ op: 'speed', amount: 1.5, dur: 5 }], cooldown: 4, text: '5 秒内移速 +50%。', art: 'dash' });
  C({ id: 'totem', role: 'place', name: '图腾', cost: 3, type: 'terrain', targeting: { shape: 'circle', radius: 0, maxDist: 8 }, effects: [sb('fill', { block: 'crystal', radius: 0 }), { op: 'totem', radius: 3.5, amount: 1, dur: 20 }], cooldown: 16, text: '竖立一枚共鸣图腾：20 秒内为附近友军每 2 秒 +1 魔力。', art: 'totem' });
  C({ id: 'snare_trap', role: 'sigil', name: '捕熊夹', cost: 2, type: 'sigil', targeting: { shape: 'circle', radius: 1.5, maxDist: 12 }, effects: [sg('snare', 0.2, 18)], cooldown: 8, text: '放置隐形陷阱，敌人踏入即被定身。', art: 'trap' });

  /* ================= 2026-10-17 第三批：大招 / 大建造 / 飞行召唤 =================
     用户点名的三件事："毁天灭地的大招爆炸系"、"一键生成一堵（真的挡得住人的）墙"、
     "能飞、粒子打满的召唤物"。这一批只加数据不加逻辑：新的结算分支在 rules.js，
     新的物理/AI 分支在 battle.js，画法在 vfx-recipes.js（配方名一个都不出现在这里）。
     大建造的格子数用 maxCells 逐卡声明（默认仍是 9）；**价格仍是素材按格扣**，
     付不起就部分成交——所以"大墙"的体感是"先立满高度，素材多了再往两边长"。 */

  /* ---------- 爆炸系：三张"整屏"的牌 ---------- */
  /* 2026-10-17 用户："特效很炫酷的法术，威力应该也同步很巨大——流星雨范围弄大一点，
     每一颗都要有破坏效果，才配得上它的特效"。于是这一张从"3.5 格小阵"升成
     **半径 6.5 格、持续 5.5 秒、每颗 30 伤害 + 2.2 格/3 深的地形坑**；价格与冷却同步上调（7 费 / 28 秒）。 */
  C({ id: 'meteor_rain', role: 'ultra', name: '陨星雨', cost: 7, element: 'fire', type: 'sigil', rarity: 'rare',
      targeting: { shape: 'circle', radius: 6.5, maxDist: 22 },
      effects: [sg('meteor_rain', 1.0, 5.5)], cooldown: 28,
      text: '布下灭世天陨阵：1 秒后开始，每 0.45 秒砸下一颗陨星（30 伤害 / 3.4 格 / 自带 2.2 格深坑），持续 5.5 秒。', art: 'star', tint: ['#ff7a45', '#ff2d55'] });
  C({ id: 'supernova', role: 'ultra', name: '超新星', cost: 5, element: 'fire', type: 'spell', rarity: 'rare',
      targeting: { shape: 'circle', radius: 1, maxDist: 16 },
      effects: [dmg(48, 6.2, 'fire'), { op: 'quake', power: 1.15 }, { op: 'ignite', radius: 4, dur: 5 }],
      cooldown: 22, text: '目标处引爆超新星：6 格内 48 伤害、点燃地面、震得整个镜头抖。', art: 'burst', tint: ['#fff2b0', '#ff2d55'] });
  C({ id: 'void_collapse', role: 'ultra', name: '奇点', cost: 5, element: 'void', type: 'spell', rarity: 'rare',
      targeting: { shape: 'circle', radius: 1.5, maxDist: 18 },
      effects: [dmg(34, 5.0, 'void'), { op: 'pull', radius: 5.2, power: 13 }, st('slow', 3, 5)],
      cooldown: 20, text: '坍缩一颗奇点：5 格内 34 伤害，把敌人往中心拽并减速 3 秒。', art: 'spiral' });
  C({ id: 'earthsplit', role: 'dig', name: '裂地', cost: 4, element: 'rock', type: 'terrain', rarity: 'rare',
      requires: [{ mats: 6 }],
      targeting: { shape: 'circle', radius: 3, maxDist: 10 },
      effects: [sb('crater', { radius: 3, depth: 4, maxCells: 30 }), dmg(20, 3.6, 'physical'), st('root', 1.6, 3.6)],
      cooldown: 18, text: '撕开地面：塌出一个碗形坑（最多 30 格），被埋的人吃 20 伤害并定身 1.6 秒。', art: 'down' });

  /* ---------- 终末系：核弹级 / 超阶魔法（2026-10-17 用户："核弹级别的、整幅地图一起玩没了"） ---------- */
  C({ id: 'terminus', role: 'ultra', name: '终末·天罚', cost: 8, element: 'fire', type: 'sigil', rarity: 'rare',
      targeting: { shape: 'circle', radius: 6, maxDist: 24 },
      effects: [sg('terminus', 3.0, 1.4)], cooldown: 75,
      text: '在天上划出终末之阵：3 秒蓄力后连放三拍——外圈冲击波、更狠的第二拍、主爆炸开 34 格（敌我不分）并塌出一口大碗。', art: 'star', tint: ['#ffe066', '#ff2d55'] });
  C({ id: 'grand_ritual', role: 'ultra', name: '超阶·万象归寂', cost: 8, element: 'void', type: 'sigil', rarity: 'rare',
      targeting: { shape: 'circle', radius: 9, maxDist: 26 },
      effects: [
        sg('ritual_a', 0.20, 5.40, 13, 0), sg('ritual_a', 0.34, 5.40, 9.2, 9.2), sg('ritual_a', 0.48, 5.40, 0, 13),
        sg('ritual_a', 0.62, 5.40, -9.2, 9.2), sg('ritual_a', 0.76, 5.40, -13, 0), sg('ritual_a', 0.90, 5.40, -9.2, -9.2),
        sg('ritual_a', 1.04, 5.40, 0, -13), sg('ritual_a', 1.18, 5.40, 9.2, -9.2),
        sg('ritual_b', 0.40, 5.10, 7.5, 0), sg('ritual_b', 0.55, 5.10, 0, 7.5), sg('ritual_b', 0.70, 5.10, -7.5, 0),
        sg('ritual_b', 0.85, 5.10, 0, -7.5), sg('ritual_b', 1.00, 5.10, 5.3, 5.3), sg('ritual_b', 1.15, 5.10, -5.3, -5.3),
        sg('ritual_c', 0.60, 4.80, 3.6, 0), sg('ritual_c', 0.80, 4.80, 0, 3.6),
        sg('ritual_c', 1.00, 4.80, -3.6, 0), sg('ritual_c', 1.20, 4.80, 0, -3.6),
        sg('ritual_core', 5.0, 0.6)
      ], cooldown: 90,
      text: '十八座法阵次第点亮、五秒长咏唱之后收束成一点：26 格内所有单位吃 46 虚空伤害，中心塌成大坑。阵可以被中途打散。', art: 'spiral', tint: ['#ff2bd6', '#00e5ff'] });

  /* 用户点名的例子："要有一个吸附一切的黑洞，它应该是紫色的——紫色之中再用色偏的极端 RGB"。
     吸附是**持续**的（每 0.4 秒拽一次），伤害低而密，读感是"跑不出去"，不是"挨一发大的"。 */
  C({ id: 'black_hole', role: 'ultra', name: '奇点·吞噬', cost: 6, element: 'void', type: 'sigil', rarity: 'rare',
      targeting: { shape: 'circle', radius: 5, maxDist: 22 },
      effects: [sg('black_hole', 0.6, 7)], cooldown: 32,
      text: '张开一颗吞噬一切的奇点：7 秒内持续把 5 格内的敌人拽向阵心，每 0.4 秒磨 6 点。', art: 'spiral',
      tint: ['#a855f7', '#ff2bd6'] });

  /* ---------- 烟花系：会拐弯的细小光点（用户："粒子满天飞、画弧线、不要直直走过去"） ---------- */
  C({ id: 'spirit_volley', role: 'shot', name: '灵光乱舞', cost: 3, element: 'void', type: 'spell', rarity: 'uncommon',
      targeting: { shape: 'ray', maxDist: 22 },
      effects: [{ op: 'spirit', count: 5, amount: 7, speed: 24, life: 2.8, weave: 1.1, turn: 4.2, fuse: 1.0 }],
      cooldown: 5, text: '放出 5 道灵光：扇形散开后各自拐弯追最近的人（7 伤害 / 道），轨迹是弧线。', art: 'eye', tint: ['#00e5ff', '#ff2bd6'] });
  C({ id: 'firework', role: 'shot', name: '星雨', cost: 2, element: 'fire', type: 'spell', rarity: 'common',
      targeting: { shape: 'circle', radius: 5, maxDist: 18 },
      effects: [{ op: 'spirit', count: 9, amount: 5, speed: 19, life: 2.4, weave: 1.7, turn: 2.4, fuse: 0.9 }],
      cooldown: 4, text: '撒出 9 颗会画弧的星火，各自找人（5 伤害）。纯放烟花也很好看。', art: 'star', tint: ['#ffd23f', '#ff2bd6'] });
  C({ id: 'cinder_bloom', role: 'shot', name: '流萤', cost: 3, element: 'nature', type: 'spell', rarity: 'uncommon',
      targeting: { shape: 'circle', radius: 6, maxDist: 20 },
      effects: [{ op: 'spirit', count: 12, amount: 4, speed: 16, life: 3.2, weave: 2.0, turn: 1.8, fuse: 0.9 }],
      cooldown: 7, text: '散出 12 只流萤：慢、飘、绕着敌人画弧，每只 4 伤害。', art: 'leaf', tint: ['#eaffb0', '#00e5ff'] });

  /* ---------- 建造系：一键真的挡得住人的墙 ---------- */
  C({ id: 'bastion', role: 'place', name: '城墙', cost: 3, element: 'rock', type: 'terrain', rarity: 'uncommon',
      targeting: { shape: 'ray', maxDist: 10 },
      effects: [sb('wall', { length: 8, height: 4, thickness: 1, block: 'stone', maxCells: 32 })],
      cooldown: 9, text: '面向相机立起 8 格长、4 格高的石墙（素材按格计，付几格砌几格，先砌满高度）。', art: 'fence' });
  /* 魔法构筑（conjure）：**不消耗素材**、按魔力与冷却计价——用户要的"一键地堡"只有这条路走得通，
     因为素材按格扣的规则下，一座 5×5×3 的地堡要 85 素材，整局都攒不出来。规则层只认 ef.conjure 一个字段
     （定价仍在 R.priceTerrain 一处），平衡交给卡的 maxCells 硬顶 + 长冷却 + 魔力。 */
  C({ id: 'fortress', role: 'place', name: '石堡', cost: 3, element: 'rock', type: 'terrain', rarity: 'uncommon',
      targeting: { shape: 'circle', radius: 2, maxDist: 9 },
      effects: [sb('bunker', { radius: 1, height: 3, block: 'brick', conjure: true, maxCells: 32 })],
      cooldown: 16, text: '一键立起一座 3×3 的砖石地堡（有门洞；魔法构筑，不耗素材）。', art: 'cube' });
  C({ id: 'bunker', role: 'place', name: '地堡', cost: 5, element: 'rock', type: 'terrain', rarity: 'rare',
      targeting: { shape: 'circle', radius: 2, maxDist: 10 },
      effects: [sb('bunker', { radius: 2, height: 3, block: 'stone', conjure: true, maxCells: 96 })],
      cooldown: 30, text: '一键立起 5×5 的石制地堡（四壁 + 屋顶 + 门洞；魔法构筑，不耗素材）。', art: 'cube' });
  C({ id: 'raze', role: 'dig', name: '翻天覆地', cost: 6, element: 'rock', type: 'terrain', rarity: 'rare',
      targeting: { shape: 'circle', radius: 4, maxDist: 11 },
      effects: [
        sb('moat', { radius: 4.5, inner: 2.4, depth: 5, maxCells: 44, conjure: true }),
        sb('bunker', { radius: 2, height: 3, block: 'obsidian', conjure: true, maxCells: 96 })
      ],
      cooldown: 34, text: '把目标外圈整片挖空成壕沟（最多 44 格），再在中间原地立起一座黑曜石地堡（魔法构筑）。', art: 'down' });

  /* ---------- 飞行召唤：悬空跟随 + 隔空开火（粒子光环按 aiKind 分档） ---------- */
  C({ id: 'wisp_swarm', role: 'summon', name: '浮灵群', cost: 3, element: 'void', type: 'summon', rarity: 'uncommon',
      targeting: { shape: 'self' },
      effects: [sp('wisp_void', 3, { hp: 16, dmg: 6, speed: 4.4, ai: 'ranged', fly: true, range: 13, mode: 'track' })],
      cooldown: 14, text: '召来 3 只浮灵（自动跟踪）：悬空追着最近的敌人，隔空吐出虚空弹。', art: 'eye', tint: ['#a855f7', '#00e5ff'] });
  C({ id: 'storm_hawk', role: 'summon', name: '雷隼', cost: 4, element: 'ice', type: 'summon', rarity: 'rare',
      targeting: { shape: 'self' },
      effects: [sp('hawk', 1, { hp: 46, dmg: 11, speed: 6.6, ai: 'ranged', fly: true, range: 17, mode: 'direct', leash: 9 })],
      cooldown: 16, text: '召来一只雷隼（指向性）：落在你瞄准的位置上空巡逻，只在那一带砸雷弹。', art: 'bird', tint: ['#a9f0ff', '#3f6bff'] });
  C({ id: 'swarm_bomb', role: 'summon', name: '爆蜂', cost: 3, element: 'fire', type: 'summon', rarity: 'uncommon',
      targeting: { shape: 'self' },
      effects: [sp('bee', 4, { hp: 8, dmg: 12, speed: 7.4, ai: 'suicide', fly: true, range: 20, mode: 'track' })],
      cooldown: 12, text: '放出 4 只爆蜂：追着最近的敌人撞上去自爆（12 伤害 / 2 格）。', art: 'burst' });

  /* ---------- 魔法阵定义（延时 + 范围 + 可被破坏） ---------- */
  G.SIGILS = {
    meteors: { cn: '陨星阵', color: '#ff7a45', radius: 3, shape: 'poly7', fx: 'sigil_meteors', tickEvery: 0.7, dmg: 13, kind: 'fire', ignites: true },
    glacier: { cn: '冰川阵', color: '#7fd7ff', radius: 3, shape: 'poly6', fx: 'sigil_glacier', tickEvery: 0.5, dmg: 4, kind: 'ice', slow: 3, frozenEvery: 2 },
    bloom:   { cn: '繁花阵', color: '#7fd97f', radius: 2.5, shape: 'flower', fx: 'sigil_bloom', tickEvery: 0.8, heal: 3, allyOnly: true },
    rune_hammer: { cn: '符文锤', color: '#c58cff', radius: 2.5, shape: 'square', fx: 'sigil_rune_hammer', tickEvery: 1.0, dmg: 26, kind: 'void', knock: 6 },
    snare:   { cn: '捕熊夹', color: '#c9d3e0', radius: 1.5, shape: 'triangle', fx: 'sigil_snare', tickEvery: 0.2, root: 2.2, dmg: 4, once: true, hidden: true },
    lava_pool: { cn: '熔池', color: '#ff7519', radius: 2, shape: 'circle', fx: 'sigil_lava_pool', tickEvery: 0.4, dmg: 6, kind: 'fire' },
    /* 2026-10-17：大招阵。meteorEvery 让 battle 的 sigilTick 按节拍往圈里砸陨星——
       与 tickEvery 的"圈内伤害"是两条线：陨星是**真弹**，会被地形挡住、会自己起爆，
       所以"站在墙后面躲陨石"是真的能躲。 */
    meteor_rain: { cn: '灭世天陨', color: '#ff7a45', radius: 6.5, shape: 'poly7', fx: 'sigil_cataclysm',
                 tickEvery: 0.6, dmg: 12, kind: 'fire', ignites: true,
                 meteorEvery: 0.45, meteorDmg: 30, meteorRadius: 3.4, meteorSpread: 5.6,
                 meteorDig: { r: 2.2, depth: 3 } },
    /* 终末（核弹级）：nuke 字段一出现，sigilTick 就在阵起那一刻走 detonateNuke。
       hp 给高：这张卡要给对手一个"能不能在 3 秒内把它拆掉"的博弈窗口（破阵 = destroySigil 卡）。 */
    terminus: { cn: '终末', color: '#ffd86b', radius: 6, shape: 'poly7', fx: 'sigil_terminus', delay: 3.0, ttl: 0.5,
                hp: 90, kind: 'fire',
                /* 三拍节奏（2026-10-17 用户："别总是大前摇 + 嘣一下就完，要有二阶三阶"）：
                   0.0s 一记外圈冲击波 → 0.45s 第二拍更疼 → 1.0s 主爆 + 塌坑。每拍都真的结算。 */
                beats: [
                  { at: 0.0, dmg: 14, radius: 16, knock: 4 },
                  { at: 0.45, dmg: 24, radius: 24, knock: 7 },
                  { at: 1.0, dmg: 62, radius: 34, knock: 14, ff: true, crater: { r: 13, depth: 8, budget: 900 } }
                ] },
    black_hole: { cn: '奇点', color: '#a855f7', radius: 5, shape: 'poly7', fx: 'sigil_black_hole',
                  tickEvery: 0.4, dmg: 6, kind: 'void', slow: 1.0, pull: 14, hp: 70 },
    /* 超阶仪式的三层外阵 + 中心主阵：没有伤害、没有周期效果，纯粹是"唱出来"的过程可视化，
       但 hp 只有 30——对手可以用破阵卡把仪式打断（打断 = 主阵提前消失，nuke 不落地）。 */
    ritual_a: { cn: '外阵', color: '#c58cff', radius: 4.6, shape: 'poly7', fx: 'sigil_ritual_a', hp: 30, kind: 'void' },
    ritual_b: { cn: '中阵', color: '#8fd6ff', radius: 3.2, shape: 'poly6', fx: 'sigil_ritual_b', hp: 30, kind: 'void' },
    ritual_c: { cn: '内阵', color: '#ffd86b', radius: 2.2, shape: 'square', fx: 'sigil_ritual_c', hp: 30, kind: 'void' },
    ritual_core: { cn: '主阵', color: '#ffffff', radius: 5.2, shape: 'poly7', fx: 'sigil_ritual_core', hp: 60, kind: 'void',
                   nuke: { radius: 26, dmg: 46, craterR: 11, craterDepth: 7 } }
  };

  /* ---------- 初始牌库 ---------- */
  /* 定案 §2.3：5 个类型各 ≥1 张，让默认对局覆盖全部结算分支（terrain 4 / spell 5 / sigil 1 / summon 1 / utility 1）。
      取舍：dig3 与 dig 同为 erase 分支、guard 的护盾与 draw1 的过牌在池里另有卡覆盖，让给
      snare_trap（once+hidden 陷阱分支）、golem（近战随从状态机 + 击杀抽牌）、harvest（默认局第一次有素材来源）。 */
  G.STARTER_DECK = ['strike', 'strike', 'dig', 'place', 'wall2', 'raise', 'bolt', 'shard', 'heal', 'snare_trap', 'golem', 'harvest'];
  G.RARITY_WEIGHT = { common: 100, uncommon: 48, rare: 18 };
  G.RARITY_CN = { common: '常见', uncommon: '罕见', rare: '稀有' };
  G.TYPE_CN = { terrain: '地形', spell: '法术', sigil: '魔法阵', summon: '召唤', utility: '实用' };
})(window.GW);
