#!/usr/bin/env node
/* tools/make_card_icons.cjs · 用 Kenney Tiny Dungeon（CC0）烘焙卡面图标
   读 /tmp/ui-assets/tiny/Tiles/tile_XXXX.png（convert 输出 RGBA），生成 src/ui/card-icons.js：
     GW.CARD_ICON_TILES = { "0029": { pal:[...], px:[...] } }
     GW.CARD_ICON_MAP   = { 卡id: "0029" }
   运行前先下载 Tiny Dungeon 到 /tmp/ui-assets/tiny（见 docs/UI_ASSETS.md）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const SRC = '/tmp/ui-assets/tiny/Tiles';

const MAP = {
  strike: '0104', guard: '0119', dig: '0118', place: '0048', dig3: '0118', wall2: '0057', draw1: '0064',
  raise: '0056', fall: '0056', bridge: '0073', spikes: '0107', bulwark: '0119', obsidian_cage: '0059',
  shift: '0056', ramp: '0056', bolt: '0029', bloom: '0029', firewall: '0029', lava: '0029', meteors: '0102',
  ignite: '0029', cinder_dash: '0029', phoenix: '0109', shard: '0030', freeze: '0030', icewall: '0030',
  icefloor: '0032', glacier: '0102', frost_nova: '0030', hail: '0030', ice_step: '0030',
  heal: '0108', overgrow: '0108', golem: '0095', thorns: '0108', dryad: '0098', bloom_field: '0102',
  entangle: '0108', regrow: '0108', phase_dash: '0102', wings: '0102', orb_ward: '0119', blink: '0102',
  void_lance: '0102', erase: '0059', siphon: '0102', curse: '0102', rune_hammer: '0117', swap: '0102',
  nullify: '0102', gift: '0102', harvest: '0030', push: '0106', anchor: '0106', overload: '0106',
  focus: '0064', kick: '0104', totem: '0064', snare_trap: '0119', meteor_rain: '0102', supernova: '0029',
  void_collapse: '0102', earthsplit: '0056', terminus: '0102', grand_ritual: '0102', black_hole: '0102',
  spirit_volley: '0102', firework: '0029', cinder_bloom: '0108', bastion: '0057', fortress: '0057',
  bunker: '0058', raze: '0056', wisp_swarm: '0121', storm_hawk: '0120', swarm_bomb: '0122'
};
const tiles = Array.from(new Set(Object.values(MAP)));
const TILES = {};
for (const t of tiles) {
  const p = path.join(SRC, 'tile_' + t + '.png');
  const raw = execFileSync('convert', [p, '-depth', '8', 'rgba:-'], { maxBuffer: 1 << 20 });
  const pal = [], idx = new Array(256);
  for (let i = 0; i < 256; i++) {
    const a = raw[i * 4 + 3];
    if (a < 128) { idx[i] = 255; continue; }
    const hex = '#' + [0,1,2].map((k) => raw[i * 4 + k].toString(16).padStart(2, '0')).join('');
    let j = pal.indexOf(hex);
    if (j < 0) { j = pal.length; pal.push(hex); }
    idx[i] = j;
  }
  TILES[t] = { pal, px: idx };
}
const out = '/* 由 tools/make_card_icons.cjs 生成，别手改；素材 Kenney Tiny Dungeon（CC0）。 */\n' +
  'window.GW = window.GW || {};\n' +
  'window.GW.CARD_ICON_TILES = ' + JSON.stringify(TILES) + ';\n' +
  'window.GW.CARD_ICON_MAP = ' + JSON.stringify(MAP) + ';\n';
fs.writeFileSync(path.join(ROOT, 'src/ui/card-icons.js'), out);
console.log('card-icons.js:', Object.keys(TILES).length, 'tiles,', Object.keys(MAP).length, 'cards');
