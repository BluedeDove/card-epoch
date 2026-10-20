window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（纯数据）
     魔法阵：延时 + 周期 + 范围 + 可被破坏。preset 字段即结算契约，rules/sigil-outcomes 逐字段消费。
     注意：卡的 id 若能命中这里的键，规则层就不必显式传 presetId（"图腾"卡正是缺这个键而从未生效）。 */
  G.SIGILS = {
    meteors: { cn: '陨星阵', color: '#ff7a45', radius: 3, shape: 'poly7', tickEvery: 0.7, dmg: 13, kind: 'fire', ignites: true },
    glacier: { cn: '冰川阵', color: '#7fd7ff', radius: 3, shape: 'poly6', tickEvery: 0.5, dmg: 4, kind: 'ice', slow: 3, frozenEvery: 2 },
    bloom:   { cn: '繁花阵', color: '#7fd97f', radius: 2.5, shape: 'flower', tickEvery: 0.8, heal: 3, allyOnly: true },
    rune_hammer: { cn: '符文锤', color: '#c58cff', radius: 2.5, shape: 'square', tickEvery: 1.0, dmg: 26, kind: 'void', knock: 6 },
    snare:   { cn: '捕熊夹', color: '#c9d3e0', radius: 1.5, shape: 'triangle', tickEvery: 0.2, root: 2.2, dmg: 4, once: true, hidden: true },
    lava_pool: { cn: '熔池', color: '#ff7519', radius: 2, shape: 'circle', tickEvery: 0.4, dmg: 6, kind: 'fire' }
  };
  G.sigilOf = function (presetId) { return G.SIGILS[presetId] || null; };

})(window.GW);
