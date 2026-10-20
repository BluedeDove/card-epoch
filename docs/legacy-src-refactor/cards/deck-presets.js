window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（纯数据） */
  G.STARTER_DECK = ['strike', 'strike', 'guard', 'dig', 'place', 'dig3', 'wall2', 'draw1', 'bolt', 'raise', 'shard', 'heal'];
  G.RARITY_WEIGHT = { common: 100, uncommon: 48, rare: 18 };
  G.RARITY_CN = { common: '常见', uncommon: '罕见', rare: '稀有' };
  G.TYPE_CN = { terrain: '地形', spell: '法术', sigil: '魔法阵', summon: '召唤', utility: '实用' };
  G.SUMMON_CN = { golem: '岩石魔像', dryad: '树精', wisp: '烬羽' };

})(window.GW);
