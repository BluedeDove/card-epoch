#!/usr/bin/env node
/* tools/export_pack.cjs · 一键导出可玩包（文件夹 + zip）
   用法：node tools/export_pack.cjs [--out dist] [--no-zip] [--name card-epoch]
   只拷运行期需要的东西：index.html / src / vendor/three.min.js / 字体 / 主题像素图。
   工具、文档、素材原包、旧归档都不进包。zip 用 python3 的 zipfile（本机没有 zip 命令）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const has = (name) => args.indexOf(name) >= 0;
const OUT = path.resolve(ROOT, arg('--out', 'dist'));
const NAME = arg('--name', 'card-epoch');
const DEST = path.join(OUT, NAME);

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copy(rel, to) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) throw new Error('missing: ' + rel);
  const dst = path.join(DEST, to || rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}
let rev = 'nogit';
try { rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch (e) {}
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

rmrf(DEST);
copy('index.html');
copy('src');
copy('vendor/three.min.js');
copy('assets/fonts/fusion-pixel-12px-proportional-zh_hans.ttf.woff2');
copy('assets/fonts/OFL.txt');
for (const f of fs.readdirSync(path.join(ROOT, 'assets/ui/theme'))) {
  if (f.endsWith('.png')) copy('assets/ui/theme/' + f);
}
const readme = [
  '卡牌纪元 · 可玩包',
  '=================',
  '',
  '双击 index.html 即可开始（file:// 直接玩，不需要服务器、不需要联网、不需要构建）。',
  '当前版本是早期构建：单人训练（AI）/ 创造调试；玩法仍在迭代。',
  '',
  '玩法速览',
  '- 出牌改造地形 + 打架。牌按"放出来干什么"分成 8 组：放置 / 破坏 / 移动 / 远程 / 法阵 / 超阶 / 召唤 / 辅助。',
  '- 手持栏只装当前这一组（同类打光宁可空着，也不掺别的组）；Shift+滚轮在组之间切换。',
  '- 改造地形、技能、法阵、召唤一律靠出牌；挖掘不返素材，建造按格扣素材。',
  '',
  '操作（P1）',
  '- WASD 移动 · 空格跳 · 点画面锁定鼠标转向（键盘不转身，F/V 只兜底俯仰）',
  '- 左键：按住用默认攻击牌组连发（系统自动挑能打的攻击牌）',
  '- 右键：打出当前物品栏选中那一格（放置/破坏/移动/辅助也走右键）',
  '- 1–5 指定出牌 · 滚轮/Tab 切卡 · Shift+滚轮 换出牌组 · Shift 触发移动牌',
  '- E/I 背包（生存模式也能开：手持栏内拖拽换位；把牌库那张拖进手持栏就是换一张进来）',
  '- C 视角 · H 全部键位 · P 光影 · M 静音 · R 重开',
  '- G 创造模式（图鉴任意取卡 / 无消耗）· X 飞行（空格升 / 左Shift 降）',
  '',
  '胜负（默认玩法）',
  '- 三张正方形地图按矿脉与出生点公平生成；占矿每 3 秒 +1 分、击杀 +15 分。',
  '- 先到目标分，或时间到按分数判；占矿还给素材与魔力。',
  '',
  '素材与许可',
  '- Fusion Pixel Font 12px（OFL）— assets/fonts/',
  '- Kenney Tiny Dungeon / Pixel UI / Pixel Adventure（CC0）— 卡面图标与 9-slice 已烘焙成数据/贴图',
  '- three.js r128（MIT）— vendor/',
  '- 角色素材 assets/mage（CC-BY，署名见仓库 docs/ASSET_CREDITS.md）',
  '',
  '由 tools/export_pack.cjs 生成（仓库提交 ' + rev + '）。',
  ''
].join('\n');
fs.writeFileSync(path.join(DEST, 'README.txt'), readme);

let count = 0, bytes = 0;
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f), st = fs.statSync(p);
    if (st.isDirectory()) walk(p); else { count++; bytes += st.size; }
  }
})(DEST);
fs.writeFileSync(path.join(DEST, 'PACK_INFO.txt'), 'commit=' + rev + '\ndate=' + new Date().toISOString() + '\nfiles=' + count + '\nbytes=' + bytes + '\n');

let zipPath = null;
if (!has('--no-zip')) {
  zipPath = path.join(OUT, NAME + '-' + stamp + '-' + rev + '.zip');
  rmrf(zipPath);
  execFileSync('python3', ['-m', 'zipfile', '-c', path.basename(zipPath), NAME], { cwd: OUT, stdio: 'inherit' });
}
console.log('PACK ' + DEST);
console.log('FILES ' + count + '  BYTES ' + bytes + '  (' + (bytes / 1048576).toFixed(2) + ' MB)');
if (zipPath) {
  const zs = fs.statSync(zipPath).size;
  console.log('ZIP ' + zipPath + '  (' + (zs / 1048576).toFixed(2) + ' MB)');
}
