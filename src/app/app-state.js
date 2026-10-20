/* js/app/app-state.js · 单一状态根（S4/§21）
   一个根，三个子域 + 会话：
     game   权威：match（当前 Match/GameState）· world · rev
     ui     视图：scene · bag{profile,page,sel} · filters · rev
     view   每帧：alpha（渲染插值）
     session 会话：phase · cfg · seed
   Runtime（renderer/scene/camera/textures/DOM）不进这里；S 仍持句柄，APP 只存状态引用。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function create() {
    return {
      v: 1,
      game: { match: null, world: null, rev: 0 },
      ui: {
        rev: 0,
        scene: { id: 'boot', args: null, progress: 0 },
        bag: { profile: 'survival', page: 'deck', side: 0, sel: [0, 0] },
        filters: { tab: 'deck', el: 'all', ty: 'all', q: '' }
      },
      view: { alpha: 0 },
      session: { phase: 'boot', cfg: null, seed: null }
    };
  }
  G.AppState = { v: 1, create: create };
})(window.GW);
