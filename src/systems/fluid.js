/* js/systems/fluid.js · 流体/沙子下落（从 battle.js 的 Match.prototype.fluidStep 搬出，行为逐字不变） */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var B = G.BLOCK, DEFS = G.BLOCK_DEFS;
  function step(m, dt, ctx) {
    m.fluidT += dt;
    if (m.fluidT < 0.42) return;
    m.fluidT = 0;
    var w = m.world, moves = [], self = this;
    /* self 而不是 this：这个回调是普通 function，严格模式下 this === undefined，
       原来写 m.time 只有"存在过期的人造流体格"时才会踩到，于是潜伏至今
       （GW.CHEM 会让灭火 / 结冰后的格子带上 built 标记，第一次把它撞出来：
       Match.step 每 tick 抛 TypeError，被主循环护栏吞掉，整局逻辑从此不推进）。 */
    w.meta.forEach(function (val, idx) {
      if (!val || val.kind !== 'built') return;
      var y = Math.floor(idx / (w.SZ * w.SX)), rem = idx - y * w.SZ * w.SX, z = Math.floor(rem / w.SX), x = rem - z * w.SX;
      var id = w.get(x, y, z); if (!id) return;
      var def = DEFS[id];
      if (val.kind === 'built' && val.owner === -1 && val.born !== undefined && self.time - val.born > (id === B.LAVA ? 7 : 3)) { w.set(x, y, z, 0); return; }
      if (def.flows) { /* 沙子下落 */ }
      else if (id === B.LAVA) { /* 岩浆缓慢扩散 */ }
      else return;
      var below = w.get(x, y - 1, z);
      if (below === 0 && y > 1) moves.push({ x: x, y: y - 1, z: z, id: id, from: { x: x, y: y, z: z }, spread: true });
    });
    if (moves.length > 24) moves.length = 24;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (DEFS[m.id].liquid) { w.set(m.x, m.y, m.z, m.id, { kind: 'built', owner: -1, born: m.time }); }
      else { w.set(m.x, m.y, m.z, m.id, { kind: 'built', owner: -1, born: m.time }); w.set(m.from.x, m.from.y, m.from.z, 0); }
      if (ctx.fx) ctx.fx.dust(m.x + .5, m.y + .5, m.z + .5, DEFS[m.id].color);
    }
  };

  G.Systems = G.Systems || {};
  G.Systems.Fluid = { step: step };
})(window.GW);
