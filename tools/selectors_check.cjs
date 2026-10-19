#!/usr/bin/env node
/* tools/selectors_check.cjs · selector 纯函数回归（S3 前置） */
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
['src/world.js','src/cards.js','src/vfx.js','src/vfx-recipes.js','src/chem.js','src/rules.js','src/battle.js','src/app/app-state.js','src/ui/bags/profiles.js','src/ui/bags/sources.js','src/ui/selectors.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ← ' + extra : '')); } }
const w = new G.World({ size: [32, 24, 32], seed: 7 }); w.generate();
const noop = function () {};
const fx = { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop, heal: noop, shieldUp: noop, fire: noop, float: noop, ambient: noop, quake: noop };
const m = new G.Match({ world: w, seed: 7, players: 2, fx: fx });
const app = { match: m, ui: { rev: 1, bag: { profile: 'survival', page: 'deck', side: 0, sel: [0, 0] }, filters: { tab: 'deck' } }, cards: { list: G.CARDS, byId: G.CARDS_BY_ID } };

console.log('1) HUD 派生');
const h = G.Selectors.hud.get(app);
ok('两台玩家', h.players.length === 2);
ok('手持栏 5 格', h.hands[0].length === 5);
ok('hp 与权威一致', h.players[0].hp === m.players[0].hp);
ok('deckN 与权威一致', h.players[0].deckN === m.players[0].deck.length);

console.log('2) 背包分版');
const sb = G.Selectors.bag.get(app);
ok('生存页 hand/deck/discard', sb.pages.map(function (p) { return p.key; }).join(',') === 'hand,deck,discard', sb.pages.map(function (p) { return p.key; }).join(','));
ok('deck 页有聚合条目', sb.pages[1].items.length > 0);
ok('deck 页 total 与 p.deck 一致', sb.pages[1].total === m.players[0].deck.length);
const app2 = JSON.parse(JSON.stringify({}));
const appC = { match: m, ui: { rev: 2, bag: { profile: 'creative' } }, cards: app.cards };
const cb = G.Selectors.bag.get(appC);
ok('创造页含 catalog', cb.pages.map(function (p) { return p.key; }).indexOf('catalog') >= 0);

console.log('3) key 与传播');
const k1 = G.Selectors.hud.key(app), kb1 = G.Selectors.bag.key(app);
m.drawCards(m.players[0], 1, true);
app.ui.rev++;
const k2 = G.Selectors.hud.key(app), kb2 = G.Selectors.bag.key(app);
ok('改手牌后 hud key 变', k1 !== k2, k1 + ' → ' + k2);
ok('改手牌后 bag key 变（不需要 invalidate）', kb1 !== kb2, kb1 + ' → ' + kb2);
ok('同状态重复取 key 稳定', G.Selectors.hud.key(app) === k2);

console.log('4) 结算');
ok('未结束时 result=null', G.Selectors.result.get(app) === null);
m.over = { winner: 0, name: 'P1', ticks: 1, time: 1, winReason: 'score' };
ok('结束后有 over', G.Selectors.result.get(app).over.winner === 0);

console.log('5) AppState 单根');
{
  const root = G.AppState.create();
  root.game.match = m; root.game.world = w;
  root.ui.bag.profile = 'survival';
  const hh = G.Selectors.hud.get(root);
  const bb = G.Selectors.bag.get(root);
  ok('AppState.game.match 被 selector 读到', hh.players.length === 2 && hh.players[0].hp === m.players[0].hp);
  ok('AppState.ui.bag 决定 profile', bb.pages[0].key === 'hand', bb.pages.map(function (p) { return p.key; }).join(','));
  ok('root 形状 game/ui/view/session', !!root.game && !!root.ui && !!root.view && !!root.session && root.v === 1);
}

console.log('\n共 ' + (pass + fail) + ' 条，失败 ' + fail);
process.exit(fail ? 1 : 0);
