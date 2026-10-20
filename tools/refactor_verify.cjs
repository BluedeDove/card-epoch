#!/usr/bin/env node
/* tools/refactor_verify.cjs · 重构分支一条命令复核
   用法：
     node tools/refactor_verify.cjs          // 快速套件（node 探针 + 分层 + owner，约 1–2 分钟）
     node tools/refactor_verify.cjs --full   // 再加 ui_check / creative_check / audit 三种子 + file://
   退出码 0 = 全过；1 = 有红（打印每个脚本的最后一行摘要）。 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FULL = process.argv.indexOf('--full') >= 0;

const FAST = [
  ['tools/layer_check.cjs', []],
  ['tools/owner_check.cjs', ['--strict']],
  ['tools/determinism.cjs', ['--seeds', '490706,88092,31337', '--ticks', '200']],
  ['tools/cards_probe.cjs', []],
  ['tools/hit_check.cjs', []],
  ['tools/hand_check.cjs', []],
  ['tools/chem_check.cjs', []],
  ['tools/vfx_check.cjs', []],
  ['tools/bag_check.cjs', []],
  ['tools/selectors_check.cjs', []],
  ['tools/scene_check.cjs', []],
  ['tools/effect_check.cjs', []],
  ['tools/spec_cast.cjs', []],
  ['tools/stats_check.cjs', []],
  ['tools/map_check.cjs', []]
];
const EXTRA = [
  ['tools/ui_check.cjs', []],
  ['tools/creative_check.cjs', []],
  ['tools/audit.cjs', []],
  ['tools/audit.cjs', ['--file', '490706']]
];
const list = FULL ? FAST.concat(EXTRA) : FAST;

let bad = 0;
const rows = [];
for (const [script, args] of list) {
  const t0 = Date.now();
  let r = spawnSync(process.execPath, [path.join(ROOT, script)].concat(args), {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  let retried = false;
  /* 性能类断言在冷进程/机器抖动时会假红（实测 chem 首跑 10ms、复跑 0.3ms）：失败重跑一次，标 retry */
  if (r.status !== 0) { retried = true; r = spawnSync(process.execPath, [path.join(ROOT, script)].concat(args), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.trim().split('\n').filter(Boolean);
  const last = lines.length ? lines[lines.length - 1].slice(0, 160) : '(no output)';
  const ok = r.status === 0;
  if (!ok) bad++;
  rows.push((ok ? (retried ? 'PASS(retry) ' : 'PASS ') : 'FAIL ') + script + ' ' + args.join(' ') + '  [' + ((Date.now() - t0) / 1000).toFixed(1) + 's]  ' + last);
}
rows.forEach(function (x) { console.log(x); });
console.log('\n共 ' + list.length + ' 个脚本，失败 ' + bad);
process.exit(bad ? 1 : 0);
