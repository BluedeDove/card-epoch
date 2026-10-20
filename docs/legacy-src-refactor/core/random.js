window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无
     唯一确定性随机源：同一个 seed 驱动地形、掉落、洗牌，同 seed 逐位可复现（README 的验收项）。
     算法必须与旧版逐位一致，否则所有 seed 的地图都会变。 */
  class Random {
    constructor(seed) { this.state = seed >>> 0; }
    next() { this.state = (this.state + 0x6D2B79F5) >>> 0; return Random.spread(this.state); }
    /* mulberry32 的混合步：拆成两个方法才守得住"函数体 ≤3 行" */
    static spread(a) {
      var t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(lo, hi) { return lo + this.next() * (hi - lo); }
    int(n) { return Math.floor(this.next() * n); }
    pick(list) { return list[this.int(list.length)]; }
    /* Fisher-Yates：只用这条随机流，洗牌才可复现 */
    shuffle(list) {
      for (var i = list.length - 1; i > 0; i--) { var j = this.int(i + 1), t = list[i]; list[i] = list[j]; list[j] = t; }
      return list;
    }
    /* 旧代码到处传的是"可调用的 rnd"，这里给一个绑定好实例的闭包 */
    toFn() { var self = this; return function () { return self.next(); }; }
    static fromSeed(seed) { return new Random(seed); }
    /* FNV-1a：把任意文字（卡组名、非数字 seed）折成 32 位种子 */
    static fnv1a(text) {
      var h = 2166136261;
      for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
  }
  G.Random = Random;
  /* 兼容旧入口：G.mulberry32(seed) 仍返回"可反复调用的随机函数" */
  G.mulberry32 = function (seed) { return new Random(seed).toFn(); };

})(window.GW);
