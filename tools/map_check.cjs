#!/usr/bin/env node
'use strict';
global.window = {};
const path = require('path');
require(path.join(path.resolve(__dirname, '..'), 'src/app/map-presets.js'));
const G = window.GW;
let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ← ' + extra : '')); } }
ok('默认 duel-64（定案尺寸，docs/LEVELS.md §1.1）', G.MAP_DEFAULT === 'duel-64');
ok('默认尺寸与发布一致 64×36×64', G.mapPresetFor({}).size.join('x') === '64x36x64');
ok('duel-64 不是实验图（默认关卡，相机三种子全过）', G.mapPresetFor({ map: { id: 'duel-64' } }).experimental === false);
ok('atoll-128 仍标 experimental（C4 在两种子上红）', G.mapPresetFor({ map: { id: 'atoll-128' } }).experimental === true);
ok('duel-64 尺寸 64×36×64', G.mapPresetFor({ map: 'duel-64' }).size.join('x') === '64x36x64');
ok('未知 id 回退默认', G.mapPresetFor({ map: { id: 'nope' } }).id === 'duel-64');
ok('cfg.map 覆盖 sea', G.mapPresetFor({ map: { id: 'island-96', sea: 9 } }).sea === 9);
ok('atoll-128 存在', G.mapPresetGet('atoll-128').size[0] === 128);
console.log('\n共 ' + (pass + fail) + ' 条，失败 ' + fail);
process.exit(fail ? 1 : 0);
