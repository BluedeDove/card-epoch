/* js/core/rng.js · 命名随机流（确定性；S1）
   目的：把今天"所有系统共用 match.rng 一条流"拆成命名流，但**S1 只新增不切换**——
   现有调用点仍走 get('legacy')，种子异或与 G.mulberry32(seed ^ 0x9e3779b9) 完全一致，
   所以同种子行为逐字节不变。切换某个系统到新流要单独提交并在 determinism 里写清单。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var HASH = {
    legacy: 0x9e3779b9,
    deck:   0x85ebca6b,
    ai:     0xc2b2ae35,
    combat: 0x27d4eb2f,
    summon: 0x165667b1,
    vfx:    0x9e3779b1,
    /* auto：自动开火的"同分轮换"抖一抖用的流。**单独一条**是有意的：
       它每次按键都会取数，混进 legacy 就会改变抽牌/陨星的序列（determinism 与 hand_check 的逐字节重放会当场翻车）。 */
    auto:   0x7feb352d
  };
  function RngStreams(seed) { this.seed = seed >>> 0; this.map = {}; this.names = HASH; }
  RngStreams.prototype.get = function (name) {
    var k = name || 'legacy';
    if (!this.map[k]) {
      var salt = HASH[k] === undefined ? HASH.legacy : HASH[k];
      this.map[k] = G.mulberry32((this.seed ^ salt) >>> 0);
    }
    return this.map[k];
  };
  RngStreams.prototype.reset = function (seed) { this.seed = seed >>> 0; this.map = {}; return this; };
  G.RngStreams = RngStreams;
})(window.GW);
