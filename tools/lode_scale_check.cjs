#!/usr/bin/env node
/* tools/lode_scale_check.cjs · 矿脉多图尺度回归（不参与游戏运行）
   为什么必须有它：docs/LEVELS.md §3 把"选关要多图"落成 scale = w.SX/64 的距离缩放，
   但 play_probe 的 H/L 组只在 64×36×64 上量——**大图的三矿到底种没种下来，没有任何一条断言在管**。
   本脚本按 G.MAP_PRESETS 的三张图 × 项目基准三种子各生成一次，判两件事：
     ① 大图不退化：lodes.degraded === false 且 list.length === 3（§3 的目标线：退化就是红，不许静默降级）；
     ② 距离闸随尺度缩放：两两水平距落在 [18*scale, 40*scale] 内，且闸门自报的 range 与之相等。
   64 图额外钉一条：scale === 1 时闸必须**恰好**是 [18,40]，缩放不许污染基准档
   （基准档逐格不变另有 play_probe 的 H1/L1–L4c 守着，这条只管闸宽）。
   128 图生成 + 8 盐竞选要几秒到十几秒，接受。
   用法：node tools/lode_scale_check.cjs [seed1,seed2,...] [--only id] */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
require(path.join(ROOT, 'src/world.js'));              // 内部 require 进 reachability-gate / lode-planter
require(path.join(ROOT, 'src/app/map-presets.js'));
const G = global.window.GW;

const SEEDS = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2].split(',') : ['490706', '88092', '31337'])
  .map(s => parseInt(s, 10)).filter(n => !isNaN(n));
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (extra ? '  \u2190 ' + extra : '')); } }
const EPS = 1e-9;
function fmt(l) { return '(' + l.x + ',' + l.y + ',' + l.z + ')'; }

for (const id of Object.keys(G.MAP_PRESETS)) {
  if (ONLY && id !== ONLY) continue;
  const preset = G.mapPresetFor({ map: { id } });
  const scale = preset.size[0] / 64;
  const lo = 18 * scale, hi = 40 * scale;
  console.log('\n\u2500\u2500 ' + id + '  ' + preset.size.join('\u00d7') + '  sea=' + preset.sea + ' spawnPad=' + preset.spawnPad +
              '  scale=' + scale + '  闸 [' + lo + ',' + hi + ']');
  for (const seed of SEEDS) {
    const t0 = Date.now();
    const w = new G.World({ size: preset.size, sea: preset.sea, spawnPad: preset.spawnPad, seed: seed >>> 0, lodes: true });
    w.generate();
    const L = w.lodes, ms = Date.now() - t0;
    const tag = id + '/seed ' + seed;
    const dstr = (L && L.dists.length) ? L.dists.map(d => d.toFixed(1)).join(' / ') : '\u2014';
    console.log('  \u00b7 ' + tag + ' 矿 ' + (L ? L.list.map(fmt).join(' ') : '无') +
                ' 距 ' + dstr + ' fair=' + (L && L.fairScore !== undefined ? L.fairScore : '\u2014') + '  ' + ms + 'ms');
    if (!L) { ok(tag + ' 生成了矿脉明细（world.lodes 非空）', false, 'generate() 没写 world.lodes'); continue; }
    ok(tag + ' 三矿齐（degraded === false 且 list.length === 3）',
      L.degraded === false && L.list.length === 3,
      'degraded=' + L.degraded + ' list=' + L.list.length + ' reason=' + L.reason +
      ' attempts=' + JSON.stringify((L.attempts || []).map(a => a.salt + ':' + a.reason)));
    ok(tag + ' 两两水平距 \u2208 [' + lo + ',' + hi + ']（scale=' + scale + '）',
      L.dists.length === 3 && L.dists.every(d => d >= lo - EPS && d <= hi + EPS),
      '\u5b9e\u6d4b [' + dstr + ']');
    ok(tag + ' 闸门自报 range = [' + lo + ',' + hi + ']',
      !!L.gate && !!L.gate.range && L.gate.range[0] === lo && L.gate.range[1] === hi,
      L.gate && L.gate.range ? '[' + L.gate.range.join(',') + ']' : 'gate.range \u7f3a\u5931');
    if (scale === 1) {   /* 基准档：闸宽必须恰好是 [18,40]，缩放不许漏进 64 图 */
      ok(tag + ' 64 图闸宽未被缩放污染（range 恰为 [18,40]）',
        !!L.gate && !!L.gate.range && L.gate.range[0] === 18 && L.gate.range[1] === 40,
        L.gate && L.gate.range ? '[' + L.gate.range.join(',') + ']' : 'gate.range \u7f3a\u5931');
    }
  }
}
console.log('\n\u5171 ' + (pass + fail) + ' \u6761\uff0c\u5931\u8d25 ' + fail + '\uff08\u4e09\u56fe \u00d7 \u79cd\u5b50 ' + SEEDS.join(',') + '\uff09');
process.exit(fail ? 1 : 0);
