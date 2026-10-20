window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：src/cards/effect-grammar.js（效果短名）
     56 张卡，纯数据。数值基准：1 魔力 = 6 伤害 = 5 护盾 = 1 格地形改造。
     本文件由 tools/extract_cards.cjs 从 js/cards.js 机械生成，勿手抄改动。
     等价性由 /tmp/gw_cards_check.cjs 与 .artifacts/cards-golden.json 把守。 */
  var EG = G.EffectGrammar;
  var dmg = EG.damage, shield = EG.shield, sb = EG.setBlock, st = EG.status, sp = EG.spawn, sg = EG.sigil;
  var CARDS = G.CARDS = [];
  var BY_ID = G.CARDS_BY_ID = {};

  function register(o) {
    scalarDefaults(o); structuralDefaults(o);
    CARDS.push(o); BY_ID[o.id] = o; return o;
  }
  /* 默认值口径与旧版逐字段一致：cost 用 undefined 判、其余用 || */
  function scalarDefaults(o) {
    if (o.cost === undefined) o.cost = 1;
    if (!o.rarity) o.rarity = 'common'; if (!o.element) o.element = 'neutral';
    if (!o.type) o.type = 'spell'; if (!o.cooldown) o.cooldown = 0;
  }
  function structuralDefaults(o) {
    if (!o.requires) o.requires = []; if (!o.effects) o.effects = [];
    if (!o.targeting) o.targeting = { shape: 'self' };
    if (!o.tags) o.tags = [o.type, o.element]; if (o.text === undefined) o.text = '';
  }
  G.registerCard = register;

  var CATALOG = [
    { id: 'strike', name: '打击', cost: 1, type: 'spell', targeting: { shape: 'ray', maxDist: 26 }, effects: [dmg(6)], text: '对瞄准目标造成 6 伤害。', art: 'bolt' },
    { id: 'guard', name: '护身', cost: 1, effects: [shield(5, 8)], text: '获得 5 点护盾，持续 8 秒。', art: 'shield' },
    { id: 'dig', name: '采掘', cost: 1, type: 'terrain', targeting: { shape: 'ray', maxDist: 9 }, effects: [sb('erase', { radius: 0, give: true })], cooldown: 0.6, text: '挖掉瞄准的方块（最多 1 格），带回可作素材。', art: 'pick' },
    { id: 'place', name: '置方', cost: 1, type: 'terrain', targeting: { shape: 'ray', maxDist: 9 }, effects: [sb('fill', { radius: 0, block: 'plank' })], cooldown: 0.6, text: '在瞄准面放置 1 格木板。', art: 'cube' },
    { id: 'dig3', name: '掘进', cost: 2, type: 'terrain', targeting: { shape: 'ray', maxDist: 10 }, effects: [sb('erase', { radius: 1, height: 1, give: true })], cooldown: 1.4, text: '横向挖开最多 3 格。', art: 'pick' },
    { id: 'wall2', name: '垒墙', cost: 2, type: 'terrain', targeting: { shape: 'ray', maxDist: 10 }, effects: [sb('wall', { length: 3, height: 2, block: 'brick' })], cooldown: 2.2, text: '朝瞄准方向垒出 3×2 砖墙。', art: 'fence' },
    { id: 'draw1', name: '沉思', cost: 0, effects: [{ op: 'draw', count: 2 }], text: '抽 2 张牌。', art: 'eye' },
    { id: 'raise', name: '升岩', cost: 2, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 14 }, effects: [sb('column', { block: 'stone', up: true })], cooldown: 1.6, text: '使目标处地面隆起石柱（≤9 格）。', art: 'pillar' },
    { id: 'fall', name: '塌落', cost: 2, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 14 }, effects: [sb('erase', { radius: 1, height: 3 }), dmg(8, 2.2, 'physical')], cooldown: 2.0, text: '抽掉目标处最多 9 格地面，跌落者受 8 伤害。', art: 'down' },
    { id: 'bridge', name: '架桥', cost: 3, element: 'rock', type: 'terrain', targeting: { shape: 'ray', maxDist: 16 }, effects: [sb('bridge', { length: 6, block: 'plank' })], cooldown: 3.5, text: '向前铺出最多 6 格桥面。', art: 'bridge' },
    { id: 'spikes', name: '石刺', cost: 2, element: 'rock', type: 'spell', targeting: { shape: 'circle', radius: 2, maxDist: 14 }, effects: [dmg(14, 2.4, 'physical'), st('root', 1.5, 2.4)], cooldown: 2.6, text: '地面弹出石刺：14 伤害并定身 1.5 秒。', art: 'spike' },
    { id: 'bulwark', name: '岩肤', cost: 2, element: 'rock', effects: [shield(14, 10)], text: '获得 14 点护盾，持续 10 秒。', art: 'shield' },
    { id: 'obsidian_cage', name: '黑曜封笼', cost: 4, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 12 }, effects: [sb('cage', { block: 'obsidian', height: 3 })], cooldown: 8, text: '在目标周围立起 4 面黑曜石墙。', art: 'cube' },
    { id: 'shift', name: '移山', cost: 3, element: 'rock', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 14 }, effects: [sb('shift', { dx: 2 })], cooldown: 4, text: '把目标处一块地形整体横移 2 格。', art: 'shift' },
    { id: 'ramp', name: '斜坡', cost: 2, element: 'rock', type: 'terrain', targeting: { shape: 'ray', maxDist: 12 }, effects: [sb('ramp', { length: 4, block: 'stone' })], cooldown: 3, text: '造一段 4 格登高斜坡。', art: 'ramp' },
    { id: 'bolt', name: '焰矢', cost: 2, element: 'fire', targeting: { shape: 'ray', maxDist: 30 }, effects: [dmg(12, 0, 'fire'), st('burn', 3, 0)], cooldown: 1.0, text: '射出焰矢：12 伤害并点燃 3 秒。', art: 'flame' },
    { id: 'bloom', name: '焰华', cost: 3, element: 'fire', targeting: { shape: 'circle', radius: 2.5, maxDist: 20 }, effects: [dmg(18, 2.8, 'fire')], cooldown: 2.4, text: '目标处爆燃：范围 18 伤害。', art: 'burst' },
    { id: 'firewall', name: '火幕', cost: 3, element: 'fire', type: 'terrain', targeting: { shape: 'ray', maxDist: 16 }, effects: [sb('wall', { length: 4, height: 2, block: 'leaf' }), { op: 'ignite', radius: 2.2, dur: 5 }], cooldown: 5, text: '立起可燃屏障并点燃，形成 5 秒火域。', art: 'wallfire' },
    { id: 'lava', name: '岩浆注入', cost: 4, element: 'fire', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 12 }, effects: [sb('fill', { block: 'lava', radius: 1 })], cooldown: 9, text: '在目标处注入岩浆（流动会持续改造地形）。', art: 'lava' },
    { id: 'meteors', name: '陨星阵', cost: 5, element: 'fire', type: 'sigil', targeting: { shape: 'circle', radius: 3, maxDist: 18 }, effects: [sg('meteors', 1.6, 6)], cooldown: 12, text: '布下陨星魔法阵，1.6 秒后落星连击（可被提前打散）。', art: 'star' },
    { id: 'ignite', name: '燃地', cost: 2, element: 'fire', targeting: { shape: 'circle', radius: 2, maxDist: 14 }, effects: [{ op: 'ignite', radius: 2.2, dur: 4 }], cooldown: 3, text: '点燃地面，可燃方块会被烧成灰烬。', art: 'flame' },
    { id: 'cinder_dash', name: '烬闪', cost: 2, element: 'fire', targeting: { shape: 'ray', maxDist: 14 }, effects: [{ op: 'blink', dist: 8 }, dmg(8, 1.6, 'fire')], cooldown: 3, text: '向瞄准方向瞬移 8 格并灼烧路径。', art: 'dash' },
    { id: 'phoenix', name: '烬羽 Phoenix', cost: 5, element: 'fire', type: 'summon', targeting: { shape: 'self' }, effects: [sp('wisp', 2, { hp: 22, dmg: 6, speed: 5.2, ai: 'flank' })], cooldown: 16, text: '召唤 2 只烬羽，绕后灼烧敌人。', art: 'bird' },
    { id: 'shard', name: '霜片', cost: 1, element: 'ice', targeting: { shape: 'ray', maxDist: 28 }, effects: [dmg(7, 0, 'ice'), st('slow', 2, 0)], cooldown: 0.8, text: '7 冰伤并减速 2 秒。', art: 'shard' },
    { id: 'freeze', name: '冰封', cost: 3, element: 'ice', targeting: { shape: 'circle', radius: 2, maxDist: 18 }, effects: [st('frozen', 2.6, 2.4), dmg(6, 2.4, 'ice')], cooldown: 7, text: '冻结目标 2.6 秒。', art: 'snow' },
    { id: 'icewall', name: '冰墙', cost: 2, element: 'ice', type: 'terrain', targeting: { shape: 'ray', maxDist: 14 }, effects: [sb('wall', { length: 4, height: 2, block: 'ice' })], cooldown: 3.5, text: '升起 4×2 冰墙，可挡路与挡弹。', art: 'fence' },
    { id: 'icefloor', name: '结冰', cost: 2, element: 'ice', type: 'terrain', targeting: { shape: 'circle', radius: 2, maxDist: 14 }, effects: [sb('layer', { block: 'ice', depth: 1 })], cooldown: 3, text: '把目标地面冻成冰面（打滑）。', art: 'snow' },
    { id: 'glacier', name: '冰川阵', cost: 4, element: 'ice', type: 'sigil', targeting: { shape: 'circle', radius: 3, maxDist: 18 }, effects: [sg('glacier', 1.2, 8)], cooldown: 11, text: '寒霜法阵：持续冻结并减速圈内敌人。', art: 'ring' },
    { id: 'frost_nova', name: '霜爆', cost: 3, element: 'ice', targeting: { shape: 'self' }, effects: [dmg(10, 4.5, 'ice'), st('slow', 3, 4.5)], cooldown: 5, text: '以自身为中心爆发霜寒。', art: 'burst' },
    { id: 'hail', name: '冰雹阵', cost: 3, element: 'ice', type: 'summon', targeting: { shape: 'circle', radius: 2.5, maxDist: 18 }, effects: [{ op: 'hail', count: 8, dmg: 5 }], cooldown: 6, text: '在目标区域降下 8 发冰雹。', art: 'down' },
    { id: 'ice_step', name: '踏霜', cost: 2, element: 'ice', targeting: { shape: 'ray', maxDist: 16 }, effects: [{ op: 'blink', dist: 7 }, sb('fill', { block: 'ice', radius: 0 })], cooldown: 3, text: '向前滑步 7 格并在脚下留一块冰。', art: 'dash' },
    { id: 'heal', name: '萌发', cost: 2, element: 'nature', effects: [{ op: 'heal', amount: 12 }], text: '回复 12 生命。', art: 'leaf' },
    { id: 'overgrow', name: '疯长', cost: 3, element: 'nature', type: 'terrain', targeting: { shape: 'circle', radius: 2, maxDist: 14 }, effects: [sb('grow', { block: 'leaf', height: 3 })], cooldown: 4, text: '在目标处长出灌木地形，遮挡视线。', art: 'tree' },
    { id: 'golem', name: '岩魔', cost: 4, element: 'nature', type: 'summon', targeting: { shape: 'self' }, effects: [sp('golem', 1, { hp: 46, dmg: 9, speed: 2.6, ai: 'melee', taunt: true })], cooldown: 14, text: '召唤岩石魔像，替你挡刀并近战。', art: 'golem' },
    { id: 'thorns', name: '荆缚', cost: 2, element: 'nature', targeting: { shape: 'circle', radius: 2, maxDist: 16 }, effects: [st('root', 2.4, 2.4), dmg(6, 2.4, 'nature')], cooldown: 4, text: '荆棘缠身：定身 2.4 秒。', art: 'vine' },
    { id: 'dryad', name: '树精', cost: 3, element: 'nature', type: 'summon', targeting: { shape: 'self' }, effects: [sp('dryad', 1, { hp: 26, dmg: 5, speed: 3.4, ai: 'healer' })], cooldown: 12, text: '召唤树精，持续为你治疗。', art: 'leaf' },
    { id: 'bloom_field', name: '繁花阵', cost: 3, element: 'nature', type: 'sigil', targeting: { shape: 'circle', radius: 2.5, maxDist: 16 }, effects: [sg('bloom', 0.8, 9)], cooldown: 10, text: '花之法阵：圈内友军持续回复。', art: 'ring' },
    { id: 'entangle', name: '缠根', cost: 1, element: 'nature', targeting: { shape: 'ray', maxDist: 22 }, effects: [st('root', 1.2, 1.6), dmg(3, 1.6, 'nature')], cooldown: 2.5, text: '短定身 1.2 秒。', art: 'vine' },
    { id: 'regrow', name: '再生', cost: 2, element: 'nature', effects: [{ op: 'regen', amount: 2, dur: 10 }], cooldown: 6, text: '10 秒内持续回复。', art: 'plus' },
    { id: 'blink', name: '闪烁', cost: 1, element: 'void', targeting: { shape: 'ray', maxDist: 14 }, effects: [{ op: 'blink', dist: 9 }], cooldown: 3, text: '向瞄准方向瞬移最多 9 格。', art: 'dash' },
    { id: 'void_lance', name: '虚 lance', cost: 3, element: 'void', targeting: { shape: 'ray', maxDist: 34 }, effects: [dmg(20, 0, 'void')], cooldown: 3, text: '贯穿光束：20 虚空伤害。', art: 'bolt' },
    { id: 'erase', name: '湮灭', cost: 3, element: 'void', type: 'terrain', targeting: { shape: 'circle', radius: 1, maxDist: 14 }, effects: [sb('erase', { radius: 1, height: 2 })], cooldown: 4, text: '湮灭目标处最多 9 格地形（不掉落素材）。', art: 'spiral' },
    { id: 'siphon', name: '虹吸', cost: 2, element: 'void', targeting: { shape: 'ray', maxDist: 20 }, effects: [dmg(9, 0, 'void'), { op: 'gainMana', amount: 2 }], cooldown: 4, text: '造成 9 伤害并回复 2 魔力。', art: 'eye' },
    { id: 'curse', name: '脆弱咒', cost: 2, element: 'void', targeting: { shape: 'ray', maxDist: 22 }, effects: [st('vuln', 6, 0)], cooldown: 6, text: '目标受到的伤害 +35%，持续 6 秒。', art: 'skull' },
    { id: 'rune_hammer', name: '符文锤', cost: 3, element: 'void', type: 'sigil', targeting: { shape: 'circle', radius: 2.5, maxDist: 16 }, effects: [sg('rune_hammer', 0.9, 5)], cooldown: 9, text: '符文重锤法阵：延迟后砸下重伤。', art: 'hammer' },
    { id: 'swap', name: '换身', cost: 4, element: 'void', targeting: { shape: 'ray', maxDist: 18 }, effects: [{ op: 'swap' }], cooldown: 14, text: '与瞄准到的随从交换位置。', art: 'shift' },
    { id: 'nullify', name: '破阵', cost: 1, element: 'void', targeting: { shape: 'ray', maxDist: 22 }, effects: [{ op: 'destroySigil' }], cooldown: 2, text: '摧毁瞄准到的魔法阵。', art: 'shatter' },
    { id: 'gift', name: '虚空馈赠', cost: 0, element: 'void', effects: [{ op: 'draw', count: 3 }, { op: 'loseHp', amount: 4 }], cooldown: 5, text: '抽 3 张牌，扣 4 生命。', art: 'eye' },
    { id: 'harvest', name: '采晶', cost: 1, type: 'utility', targeting: { shape: 'ray', maxDist: 10 }, effects: [{ op: 'harvest' }], cooldown: 1.2, text: '敲下瞄准的以太晶，立刻 +3 魔力（上限内）。', art: 'crystal' },
    { id: 'push', name: '斥力', cost: 2, targeting: { shape: 'self' }, effects: [{ op: 'push', power: 11, up: 3 }], cooldown: 3.5, text: '把身边敌人弹开。', art: 'burst' },
    { id: 'anchor', name: '锚定', cost: 1, effects: [shield(6, 6), st('sturdy', 3, 0)], cooldown: 4, text: '6 护盾并免疫击退 3 秒。', art: 'anchor' },
    { id: 'overload', name: '超载', cost: 2, effects: [{ op: 'gainMana', amount: 4 }, { op: 'manaCapDown' }], cooldown: 12, text: '立刻 +4 魔力，但本局魔力上限 -1。', art: 'battery' },
    { id: 'focus', name: '凝势', cost: 1, effects: [{ op: 'buffNext', amount: 0.5 }], cooldown: 6, text: '下一张卡效果 +50%。', art: 'star' },
    { id: 'kick', name: '疾行', cost: 1, effects: [{ op: 'speed', amount: 1.5, dur: 5 }], cooldown: 4, text: '5 秒内移速 +50%。', art: 'dash' },
    { id: 'totem', name: '图腾', cost: 3, type: 'terrain', targeting: { shape: 'circle', radius: 0, maxDist: 12 }, effects: [sb('fill', { block: 'crystal', radius: 0 }), { op: 'totem', radius: 3.5, amount: 1, dur: 20 }], cooldown: 16, text: '竖立一枚共鸣图腾：20 秒内为附近友军每 2 秒 +1 魔力。', art: 'totem' },
    { id: 'snare_trap', name: '捕熊夹', cost: 2, type: 'sigil', targeting: { shape: 'circle', radius: 1.5, maxDist: 12 }, effects: [sg('snare', 0.2, 18)], cooldown: 8, text: '放置隐形陷阱，敌人踏入即被定身。', art: 'trap' }
  ];
  CATALOG.forEach(register);
})(window.GW);
