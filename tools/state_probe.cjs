#!/usr/bin/env node
/* tools/state_probe.cjs · 三域状态快照（S0 对照用；S3 后改读 AppState）
   用法：node tools/state_probe.cjs --seed 490706 --ticks 20 --json
*/
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js','src/cards.js','src/vfx.js','src/vfx-recipes.js','src/chem.js','src/rules.js','src/battle.js','src/app/app-state.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; }
const seed = (parseInt(arg('seed', '490706'), 10) || 490706) >>> 0;
const ticks = parseInt(arg('ticks', '20'), 10) || 20;
const json = process.argv.indexOf('--json') >= 0;
const w = new G.World({ size: [64, 40, 64], seed: seed }); w.generate();
const noop = function () {};
const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop, fire: noop, float: noop, ambient: noop, quake: noop };
const m = new G.Match({ world: w, seed: seed, players: 2, fx: fx });
for (let t = 0; t < ticks; t++) m.step(1 / 20, [{}, {}]);
const app = (G.AppState && G.AppState.create) ? G.AppState.create() : null;
if (app) { app.game.match = m; app.game.world = w; app.game.rev = m.rev; }
const out = {
  app: app ? { phase: app.session.phase, scene: app.ui.scene.id, uiRev: app.ui.rev, gameRev: app.game.rev } : null,
  game: { v: 1, rev: m.rev, tick: m.tick, time: +m.time.toFixed(3), over: m.over },
  players: m.players.map(function (p) {
    return { side: p.side, name: p.name, hp: p.hp, maxHp: p.maxHp, shield: p.shield || 0,
             mana: p.mana, manaCap: p.manaCap, mats: p.mats, score: p.score, kills: p.kills, lives: p.lives,
             pos: [+p.pos.x.toFixed(3), +p.pos.y.toFixed(3), +p.pos.z.toFixed(3)],
             hand: p.hand.slice(), deckN: p.deck.length, discardN: p.discard.length, handClass: p.handClass || null };
  }),
  match: { projectiles: m.projectiles.length, summons: m.summons.length, sigils: m.sigils.length,
           overtime: m.overtime, stats: m.stats ? { v: m.stats.v, perSide: m.stats.perSide } : null }
};
if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log('tick=' + out.game.tick + ' time=' + out.game.time + ' rev=' + out.game.rev);
  out.players.forEach(function (p) { console.log('P' + (p.side + 1) + ' hp=' + p.hp + ' mana=' + p.mana + '/' + p.manaCap + ' mats=' + p.mats + ' score=' + p.score + ' hand=' + p.hand.join(',') + ' deck=' + p.deckN + ' discard=' + p.discardN); });
  console.log('ents proj=' + out.match.projectiles + ' sum=' + out.match.summons + ' sig=' + out.match.sigils);
}
