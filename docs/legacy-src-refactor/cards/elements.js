window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（纯数据）
     六系配色是卡面与特效的唯一取色源；cn 用于 HUD 文案。 */
  var ELEMENTS = G.ELEMENTS = {
    neutral: { cn: '中立', color: '#c9d3e0', accent: '#8a94a6' },
    fire:    { cn: '焰',   color: '#ff7a45', accent: '#c8341a' },
    ice:     { cn: '霜',   color: '#7fd7ff', accent: '#2b7fb8' },
    rock:    { cn: '岩',   color: '#c9a06b', accent: '#7a5a34' },
    nature:  { cn: '林',   color: '#7fd97f', accent: '#2f7d34' },
    void:    { cn: '虚',   color: '#c58cff', accent: '#6a3fb0' }
  };
  G.elementColor = function (key) { return (ELEMENTS[key] || ELEMENTS.neutral).color; };
  G.elementAccent = function (key) { return (ELEMENTS[key] || ELEMENTS.neutral).accent; };
  G.elementCN = function (key) { return (ELEMENTS[key] || ELEMENTS.neutral).cn; };

})(window.GW);
