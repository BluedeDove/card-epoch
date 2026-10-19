/* js/app/map-presets.js · 地图预设（S4，纯数据）
   用户要的「选地图」先落数据层：cfg.map 给 id，SessionRunner.buildWorld 读 size/sea/spawnPad。
   默认图见下面 DEFAULT 的注释（duel-64 = 定案尺寸，docs/LEVELS.md §1.1）；
   experimental 的图在选关界面上要提示原因（src/hud.js 的 H.TEXT.level 按 id 查一句话）。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var PRESETS = {
    /* island-96 三种子相机审计 15 项里 31337 的 C4 红（低头时躯干没压准星却被整具隐藏）——与默认 64 图
       同一类旧缺陷，在这张图上仍未收；如实标实验（不把"大部分种子绿"写成合格）。 */
    'island-96': { id: 'island-96', labelKey: 'map.island96', size: [96, 40, 96], sea: 12, spawnPad: 9, lodes: 3, experimental: true },
    /* duel-64 的 sea/spawnPad 必须与 tools/play_probe.cjs 的 makeWorld 完全一致
       （size:[64,36,64], sea:12；spawnPad 用 World 默认 9）——否则"量表验证过的那张图"
       与"玩家选 duel-64 玩到的那张图"不是同一张，H/L 组的绿就只是量表的绿。 */
    /* duel-64 不是实验图：三种子相机审计 15 项全过（2026-10-18 用 cam_audit 的 opts.map 实测），它现在是默认关卡。 */
    'duel-64':   { id: 'duel-64',   labelKey: 'map.duel64',   size: [64, 36, 64], sea: 12, spawnPad: 9, lodes: 3, experimental: false, noteKey: 'map.duel64note' },
    'atoll-128': { id: 'atoll-128', labelKey: 'map.atoll128', size: [128, 40, 128], sea: 14, spawnPad: 11, lodes: 3, experimental: true, noteKey: 'map.atoll128note' }
  };
  /* 默认图 = duel-64（docs/LEVELS.md §1.1，2026-10-18 定）：
     旧记录说"88092 在 64 图上稳定红 C2/C3"是**铺矿之前**量的——A1 的矿脉放置把出生点→中矿走廊整平了，
     出生区变平之后越肩构图不再糊准星；cam_audit 的 15 项在 490706 / 88092 / 31337 三张 64 图上各自跑过。
     island-96 三种子同样 15 项全过（非实验）；atoll-128 在 490706/88092 上 C4 红（低头时躯干没压准星
     却被整具隐藏——相机线的已知缺陷，与图大小无关），所以它仍标实验、选关卡上如实写。 */
  var DEFAULT = 'duel-64';
  function get(id) { return PRESETS[id] || PRESETS[DEFAULT]; }
  function forCfg(cfg) {
    var id = (cfg && cfg.map && cfg.map.id) || (cfg && cfg.map) || DEFAULT;
    var p = get(id);
    var over = (cfg && cfg.map) || {};
    return {
      id: p.id, size: over.size || p.size, sea: over.sea === undefined ? p.sea : over.sea,
      spawnPad: over.spawnPad === undefined ? p.spawnPad : over.spawnPad,
      lodes: over.lodes === undefined ? p.lodes : over.lodes,
      experimental: !!p.experimental, labelKey: p.labelKey, noteKey: p.noteKey || null
    };
  }
  G.MAP_PRESETS = PRESETS;
  G.MAP_DEFAULT = DEFAULT;
  G.mapPresetGet = get;
  G.mapPresetFor = forCfg;
})(window.GW);
