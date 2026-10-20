window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（纯数据）
     方块身份与物理属性的一张表；像素图集把 tiles 挂到 BlockInfo 上，不在这里。 */
  var BLOCK = G.BLOCK = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, SNOW: 5, LOG: 6, LEAF: 7, WATER: 8, PLANK: 9, BRICK: 10, LAVA: 11, ICE: 12, OBSIDIAN: 13, CRYSTAL: 14, BEDROCK: 15 };
  var KEYS = ['air', 'grass', 'dirt', 'stone', 'sand', 'snow', 'log', 'leaf', 'water', 'plank', 'brick', 'lava', 'ice', 'obsidian', 'crystal', 'bedrock'];
  var CN = ['空气', '草地', '泥土', '石头', '沙子', '积雪', '原木', '树叶', '水', '木板', '砖石', '岩浆', '冰', '黑曜石', '以太晶', '基岩'];
  /* solid=能否碰撞，opaque=能否遮相邻面，liquid=可穿且不算地面，burn=会被什么点燃 */
  var ROWS = [
    { solid: false, opaque: false, hp: 0, color: '#000000' },
    { solid: true, opaque: true, hp: 1, color: '#5aa832', drop: 'dirt', burn: 'leaf' },
    { solid: true, opaque: true, hp: 1, color: '#7b5334', drop: 'dirt' },
    { solid: true, opaque: true, hp: 3, color: '#8b8b93', drop: 'stone' },
    { solid: true, opaque: true, hp: 1, color: '#d9c88d', drop: 'sand', flows: true },
    { solid: true, opaque: true, hp: 1, color: '#eef4fb', drop: 'snow' },
    { solid: true, opaque: true, hp: 4, color: '#7a5230', drop: 'log', burn: 'fire' },
    { solid: true, opaque: true, hp: 1, color: '#3f7d2c', drop: 'leaf', burn: 'fire' },
    { solid: false, opaque: false, hp: 0, color: '#3b7fd6', liquid: true },
    { solid: true, opaque: true, hp: 2, color: '#b98a4e', drop: 'plank', burn: 'fire' },
    { solid: true, opaque: true, hp: 5, color: '#9c5c53', drop: 'stone' },
    { solid: false, opaque: false, hp: 0, color: '#ff7519', liquid: true, hot: true },
    { solid: true, opaque: false, hp: 2, color: '#a9dcf2', drop: 'ice', slip: true },
    { solid: true, opaque: true, hp: 8, color: '#2b2340', drop: 'obsidian' },
    { solid: true, opaque: true, hp: 2, color: '#b26bff', drop: 'crystal', glow: true },
    { solid: true, opaque: true, hp: Infinity, color: '#3a3a42' }
  ];
  G.BLOCK_KEYS = KEYS;
  G.BLOCK_CN = CN;
  G.BLOCK_ROWS = ROWS;
  G.BIOME_NAMES = ['forest', 'desert', 'snow'];
  G.BIOME_CN = ['翠绿林海', '黄沙遗迹', '霜噬雪原'];

})(window.GW);
