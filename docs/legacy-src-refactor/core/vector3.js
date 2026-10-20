window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无
     实体坐标专用极简向量：**不是** THREE.Vector3。pos.y 是身体中心（脚底 + h/2），
     复活/顶出/生成点都必须按半高放，否则半个身子埋进方块、每个方向都判碰撞。
     历史上这里缺 copy() 曾让"掉出世界回出生点"每 tick 抛 TypeError、整局画面永久定住。 */
  class V {
    constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
    clone() { return new V(this.x, this.y, this.z); }
    len() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
    zero() { return this.set(0, 0, 0); }
    static dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
    /* 水平距离：AI 索敌与随从判定都用它（忽略 y） */
    static distXZ(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  }
  G.V = V;

})(window.GW);
