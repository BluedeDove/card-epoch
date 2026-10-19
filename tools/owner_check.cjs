#!/usr/bin/env node
/* tools/owner_check.cjs · 直接写权威字段的静态报告（按域白名单）
   每个文件只允许写自己拥有的那几个字段；白名单外一律报行号。
   默认退出 0；--strict 有越界就退出 1。
   注意：它查的是"对象.字段 = / 复合赋值"，不是完整作用域分析；局部临时对象也可能被点名，
   所以白名单按**文件**给，宁可宽在局部、严在跨域。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.indexOf('--strict') >= 0;

const F = ['pos','vel','hp','maxHp','shield','score','kills','lives','hand','deck','discard','mana',
  'manaCap','manaAcc','mats','time','tick','dayT','night','rev','blocks','meta','slots','selected',
  'size','st','stPow','invuln','cooldowns','onGround','dead','alive','meta'];

const ALLOW = {
  'src/battle.js': F,
  'src/systems/': F,
  'src/rules.js': F,
  'src/rules/effects/': F,
  'src/world.js': ['blocks','meta','biomes','rev'],
  'src/chem.js': ['meta'],
  'src/creative.js': ['hp','shield','mats','lives','mana','st'],
  'src/main.js': ['sel','time','tick','alive'],
  'src/camera.js': ['pos','time'],
  'src/hud.js': ['sel','tick','time','seed','hudKey'],
  'src/ui/': F,
  'src/atmos.js': ['night','time'],
  'src/vfx.js': ['size'],
  'src/vfx-render.js': ['pos','time','size'],
  'src/net.js': ['hand','discard'],
  'src/net-ws.js': ['hand','discard'],
  'src/lode-planter.js': ['score'],
  'src/lode-system.js': ['score','rev'],
  'src/save.js': ['blocks','hand','deck','discard','lives','kills']
};

const PAT = /\b([A-Za-z_$][\w$]*)\.(pos|vel|hp|maxHp|shield|score|kills|lives|hand|deck|discard|mana|manaCap|manaAcc|mats|time|tick|dayT|night|rev|blocks|meta|slots|selected|size|st|stPow|invuln|cooldowns|onGround|dead|alive)\b\s*(=[^=]|[-+*/]=)/g;

function allowed(rel, field) {
  for (const key in ALLOW) {
    if (rel.indexOf(key) === 0 || rel.indexOf(key) >= 0) {
      if (ALLOW[key].indexOf(field) >= 0) return true;
    }
  }
  return false;
}
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.js$/.test(name)) out.push(p);
  }
}
const files = [];
walk(path.join(ROOT, 'src'), files);
let hits = 0, bad = 0;
for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  const src = fs.readFileSync(abs, 'utf8').split('\n');
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    if (/^\s*\/\//.test(line)) continue;
    if (/\.prototype\.[\w$]+\s*=/.test(line)) continue;   // 方法定义不是字段写
    PAT.lastIndex = 0;
    let m;
    while ((m = PAT.exec(line))) {
      const field = m[2];
      hits++;
      if (!allowed(rel, field)) {
        bad++;
        if (bad <= 60) console.log(rel + ':' + (i + 1) + '  ' + m[1] + '.' + field + '  ← 不在本文件白名单');
      }
    }
  }
}
console.log('直接写权威字段命中 ' + hits + ' 处；白名单外 ' + bad + ' 处');
if (STRICT && bad) process.exit(1);
