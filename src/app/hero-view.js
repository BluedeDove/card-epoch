/* src/app/hero-view.js · 英雄命名牌与网格装配（表现层）
   只负责"把 G.HERO.build 出来的组挂到 entGroup，并给每个玩家一张血牌"；不读权威状态。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function makeTag(group, side) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 34;
    var tex = new THREE.CanvasTexture(cv);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(1.55, 0.42, 1);
    sp.userData = { cv: cv, tex: tex, side: side, lastHp: -1 };
    group.add(sp);
    return sp;
  }
  function updateTag(sp, e) {
    if (!sp) return;
    var hp = Math.max(0, Math.round(e.hp)), sh = Math.round(e.shield || 0);
    if (sp.userData.lastHp === hp + sh * 1000 + (e.alive ? 0 : 100000)) return;
    sp.userData.lastHp = hp + sh * 1000 + (e.alive ? 0 : 100000);
    var c = sp.userData.cv.getContext('2d');
    c.clearRect(0, 0, 128, 34);
    c.fillStyle = 'rgba(13,11,22,.78)'; c.fillRect(0, 0, 128, 34);
    c.strokeStyle = sp.userData.side === 0 ? '#35d0ff' : '#ff8a3d'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, 125, 31);
    c.font = 'bold 13px monospace'; c.textAlign = 'center'; c.fillStyle = '#ffd86b';
    c.fillText((e.name || '') + (sh > 0 ? ' 盾' + sh : ''), 64, 13);
    c.fillStyle = '#0a0813'; c.fillRect(8, 19, 112, 9);
    c.fillStyle = '#ff5f7a'; c.fillRect(8, 19, 112 * Math.max(0, Math.min(1, hp / e.maxHp)), 9);
    if (sh > 0) { c.fillStyle = '#7fd7ff'; c.fillRect(8, 19, 112 * Math.min(1, sh / 30), 3); }
    sp.userData.tex.needsUpdate = true;
  }
  function ensure(heroes, entGroup, fxGroup) {
    for (var i = 0; i < 2; i++) {
      if (!heroes[i]) { heroes[i] = G.HERO.build(i); entGroup.add(heroes[i]); heroes[i].userData.tag = makeTag(fxGroup, i); }
    }
  }
  G.HeroView = { makeTag: makeTag, updateTag: updateTag, ensure: ensure };
})(window.GW);
