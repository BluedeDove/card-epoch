/* ignite · 原子处理器（registry 分发；rules.js 的 switch 已不再有这一支） */
window.GW = window.GW || {};
(function (G) {
  G.RULES_EFFECTS = G.RULES_EFFECTS || {};
  G.RULES_EFFECTS.ignite = function (ef, card, p, ctx, mult) {
    var m = ctx.match;
    var w = ctx.world;
    if (!ctx.aim) { ctx.aim = m.defaultAim(p); }
            var ix = Math.floor(ctx.aim.x), iy = Math.floor(ctx.aim.y), iz = Math.floor(ctx.aim.z);
            /* 点火这件事整个交给 GW.CHEM：以前这里自己遍历 3×3×3 写 burning 标记，
               蔓延与烧尽却在 rules.tick 里另写一套，两处口径不一样（水浇不灭、草皮烧完不露土
               就是这么来的）。现在只有一个入口。 */
            if (G.CHEM && G.CHEM.ready) {
              G.CHEM.catalyst('heat', ix, iy, iz, Math.round((ef.radius || 2.2) * 0.8));
            } else {
              for (var b2 = -1; b2 <= 1; b2++) for (var c2 = -1; c2 <= 1; c2++) {
                var id2 = w.get(ix + b2, iy, iz + c2), def2 = G.BLOCK_DEFS[id2];
                if (def2 && def2.burn === 'fire') w.set(ix + b2, iy, iz + c2, id2, { kind: 'burning', born: m.time, dur: ef.dur });
              }
            }
            m.addSigil(card, p, ctx.aim, 0.1, ef.dur, 'lava_pool');
  };
})(window.GW);
