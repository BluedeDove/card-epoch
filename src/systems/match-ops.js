/* js/systems/match-ops.js · rules / input 反向调用 battle 的具名接口（S1 声明，S3 后由系统实现）
   这 19 个方法与 1 个只读字段是 2026-10-17 对 js/rules.js、js/net.js 的实测面（18 个），
   加上 2026-10-18 按 GAMEPLAY §7.0 条 3 评审后登记的第 1 个新依赖（grantCard，见下面它的注释）；
   清单是"实际被调什么"，不是"设计上希望它调什么"。再新增一个方法 = 又多一条跨层依赖，必须先评审。
   本文件只声明与自检，不含逻辑。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var METHODS = [
    'all', 'defaultAim', 'drawCards', 'explode', 'findStanding',
    'fireProjectile', 'fireSpirit', 'fluidStep', 'sigilAt', 'sigilTick',
    'spawnBridgeQuill', 'spawnHail', 'spawnSummon', 'targetsInRadius',
    'aimEntity', 'addSigil', 'kill', 'entitiesAt',
    /* 第 16 个：三选一选中卡入牌库（GAMEPLAY §7.4 步 7）——ARCHITECTURE 冻结在 15 个之后
       唯一新申请的跨层方法（GAMEPLAY §7.0 条 3 的评审闸，定案 §2 S2「MatchOps 第 16 个方法，已登记」）。
       为什么要它：ui / app 侧要"把选中的这张卡给这个玩家"只能调 MatchOps.grantCard，
       不许自己 p.deck.push——绕过权威层写状态就是 GAMEPLAY §7.1 条 9 的冲突点。
       编号说明：清单实测早已是 18 个（并行线接进 fireSpirit / spawnBridgeQuill / entitiesAt 之后，
       见 docs/archive/PLAN_SYSTEMS.md §8.2），所以本条在**数组里**是第 19 个、在**评审台账上**是第 16 个。 */
    'grantCard'
  ];
  var READONLY = ['night'];
  G.MatchOps = {
    v: 1,
    methods: METHODS.slice(),
    readonly: READONLY.slice(),
    has: function (name) { return METHODS.indexOf(name) >= 0; },
    check: function (m) {
      var missing = [];
      for (var i = 0; i < METHODS.length; i++) if (!m || typeof m[METHODS[i]] !== 'function') missing.push(METHODS[i]);
      for (var j = 0; j < READONLY.length; j++) if (!m || m[READONLY[j]] === undefined) missing.push(READONLY[j] + '(field)');
      return { ok: missing.length === 0, missing: missing };
    }
  };
})(window.GW);
