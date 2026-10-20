window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：core/random.js（同一套整数混合口径）
     地形只用这三样：格值哈希、双线性值噪声、fBm 叠加。 */
  class Noise {
    constructor(seed) { this.seed = seed >>> 0; }
    /* 单个格点的哈希：三个互质常数混合，返回 [0,1) */
    cell(ix, iz, salt) {
      var n = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 1274126177)) | 0;
      return Noise.unfold(Noise.mix(n));
    }
    static mix(n) { n = n ^ (n >>> 13); n = Math.imul(n, 1274126177); return n ^ (n >>> 16); }
    static unfold(n) { return (n >>> 0) / 4294967296; }
    smooth(t) { return t * t * (3 - 2 * t); }
    value(x, z, salt) {
      var ix = Math.floor(x), iz = Math.floor(z);
      return Noise.blend(this, x - ix, z - iz, this.cell(ix, iz, salt), this.cell(ix + 1, iz, salt), this.cell(ix, iz + 1, salt), this.cell(ix + 1, iz + 1, salt));
    }
    /* 双线性插值单独成函数（smootherstep 权重） */
    static blend(n, fx, fz, a, b, c, d) {
      var sx = n.smooth(fx), sz = n.smooth(fz);
      return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
    }
    fbm(x, z, octaves, salt) {
      var acc = { sum: 0, norm: 0, amp: 1, freq: 1 };
      for (var i = 0; i < octaves; i++) this.octave(acc, x, z, salt + i * 1013);
      return acc.sum / acc.norm;
    }
    /* 单独一个倍频程：累加后把振幅减半、频率翻倍（顺序与旧实现一致，才可复现） */
    octave(acc, x, z, salt) {
      acc.sum += this.value(x * acc.freq, z * acc.freq, salt) * acc.amp;
      acc.norm += acc.amp;
      acc.amp *= 0.5; acc.freq *= 2;
    }
  }
  G.Noise = Noise;

})(window.GW);
