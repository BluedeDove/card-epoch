window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无
     效果的构造语法：卡表只写"要发生什么"，怎么写由这里统一定义。
     加一种效果 = 在这里加一个构造器 + 在 rules/effects 加一个 handler，两处对称。 */
  var E = G.EffectGrammar = {};
  E.damage = function (amount, radius, kind) { return { op: 'damage', amount: amount, radius: radius || 0, kind: kind || 'physical' }; };
  E.shield = function (amount, dur) { return { op: 'shield', amount: amount, dur: dur || 8 }; };
  E.status = function (kind, dur, radius) { return { op: 'status', kind: kind, dur: dur, radius: radius || 0 }; };
  E.spawn = function (kind, count, stats) { return Object.assign({ op: 'spawn', kind: kind, count: count || 1 }, stats || {}); };
  E.sigil = function (sigilId, delay, ttl) { return { op: 'sigil', sigilId: sigilId, delay: delay, ttl: ttl }; };
  /* 地形改造统一带上限：maxCells 由 Rules 侧强制，卡表里写死只是给读者看 */
  E.setBlock = function (mode, extra) { return Object.assign({ op: 'setBlock', mode: mode, maxCells: 9 }, extra || {}); };
  E.simple = function (op, props) { return Object.assign({ op: op }, props || {}); };

})(window.GW);
