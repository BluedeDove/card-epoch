/* js/cards/effect-spec.js · 效果规范化（S3 纯层，不执行）
   1) cards.js 的旧 effect → AtomicOp（带 order）；2) setBlock 13 模式 → shape 描述；
   3) expand(card) / validate(ops) 给探针与 rules 用。零 DOM / 零 THREE / 零文案 / 确定性。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var KNOWN_OPS = ['setBlock','damage','heal','shield','status','spawn','spirit','quake','pull',
    'sigil','push','blink','ignite','hail','gainMana','manaCapDown','draw','loseHp','harvest',
    'destroySigil','swap','speed','regen','buffNext','totem','dash','flight','orbShield'];
  var CELL_SHAPES = {
    erase:  { type: 'erase',  from: 'aim' },
    fill:   { type: 'fill',   from: 'aim' },
    column: { type: 'column', axis: 'y' },
    bridge: { type: 'trace',  path: 'ballistic' },
    wall:   { type: 'line',   axis: 'y' },
    cage:   { type: 'cage' },
    bunker: { type: 'box',    ceiling: true },
    moat:   { type: 'ring',   erode: true },
    crater: { type: 'crater' },
    ramp:   { type: 'ramp' },
    shift:  { type: 'shift' },
    grow:   { type: 'column', up: true },
    layer:  { type: 'disk',   height: 1 }
  };
  function normalize(effect) {
    if (!effect || typeof effect !== 'object') return null;
    var e = {}, k;
    for (k in effect) if (Object.prototype.hasOwnProperty.call(effect, k)) e[k] = effect[k];
    if (e.op !== 'setBlock') return e;
    var mode = e.mode;
    var out = { op: 'cells', mode: mode, shape: CELL_SHAPES[mode] || { type: 'unknown' } };
    for (k in e) if (k !== 'op' && k !== 'mode') out[k] = e[k];
    return out;
  }
  function expand(card) {
    if (!card || !card.effects) return [];
    var out = [];
    for (var i = 0; i < card.effects.length; i++) {
      var op = normalize(card.effects[i]);
      if (!op) continue;
      op.order = out.length;
      out.push(op);
    }
    return out;
  }
  function validate(ops) {
    var unknown = [], badShape = [];
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.op === 'cells') { if (!o.shape || o.shape.type === 'unknown') badShape.push(o.mode); }
      else if (KNOWN_OPS.indexOf(o.op) < 0) unknown.push(o.op);
    }
    return { ok: unknown.length === 0 && badShape.length === 0, unknown: unknown, badShape: badShape };
  }
  G.EffectSpec = { v: 1, KNOWN_OPS: KNOWN_OPS, CELL_SHAPES: CELL_SHAPES, normalize: normalize, expand: expand, validate: validate };
})(window.GW);
