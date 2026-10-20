#!/usr/bin/env node
/**
 * tools/open_source_pack.cjs —— 开源包导出器（零第三方依赖）
 *
 * 从当前工作树产出「可直接推 GitHub」的脱敏副本，**不改动源目录**：
 *   node tools/open_source_pack.cjs                 # 构建 + 自检（默认 dist/card-epoch-oss）
 *   node tools/open_source_pack.cjs --dir <路径>    # 换输出目录
 *   node tools/open_source_pack.cjs --check-only    # 只重跑自检（配合 --dir）
 *
 * 三条规矩
 *  1) 白名单复制（TOP_LEVEL / DECLARED），漏文件由 C 层抓。
 *  2) 版权隔离：research/ 与 docs/legacy-src-refactor/ 整体不带；Kenney 原始包只留真正用到的
 *     贴片与 License.txt；指向它们的链接改指 docs/RESEARCH_SOURCES.md。
 *  3) 中性化：文档走 DOC（本机路径 / 内网 IP / 机器标识 / 本机端口 / 对话口吻），
 *     代码只走 CODE（第三方依赖的机器绝对路径 → 可移植写法）。代码不走 DOC，免得把脚本改坏。
 *     本文件自身永不改写（SELF），敏感字面量在这里一律拼接写出（见 LIT）——
 *     否则它会命中自己的 A 层规则，上一版就是这么自己把自己判红的。
 *
 * 自检四层：A / C / D-new 命中即非零退出（宁可不出包）
 *   A 泄露硬门禁：凭据 / 本机路径 / 非本机 IP / 联系方式
 *   B 人工过一眼：账号痕迹、对话现场口吻（不阻断，只列出来）
 *   C 覆盖率：源侧文件要么进副本、要么在「有意排除」清单里，否则算意外丢失
 *   D 断链：分「新引入」（副本断、源里同样改写后不断）与「历史死链」（源里本来就断）。
 *      只有新引入的算失败；历史死链照样报数，别把「没有新增断链」读成「一个断链都没有」。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SELF = 'tools/open_source_pack.cjs';
const argv = process.argv.slice(2);
const argVal = function (name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const OUT = path.resolve(ROOT, argVal('--dir', path.join('dist', 'card-epoch-oss')));
const CHECK_ONLY = argv.indexOf('--check-only') >= 0;
const BT = '\u0060';                                    // markdown 行内代码引号

/* ---------- 敏感字面量：拼接写，本文件才不会被自己的门禁判红 ---------- */

const LIT = {
  dataCoding: '/' + 'data/Coding',
  dataClaude: '/' + 'data/claude',
  gameTest: 'game_' + 'test001',
  homeDell: '/' + 'home/' + 'dell',
  usersDir: '/' + 'Users/',
  winUsers: 'C' + ':\\\\Users',
  miniconda: '/' + 'data/miniconda3' + '/miniconda3/lib/node_modules',
  lan: '192.' + '168.',
  port: '8932',
  at: '@',
  ghp: 'ghp' + '_',
  pat: 'github_pat' + '_',
  sshHead: 'BEGIN' + ' ',
  akia: 'AKI' + 'A',
  slack: 'xox' + '[bap]-',
  glpat: 'glpat' + '-',
  blue: 'Blue' + 'deDove',
  shots: '/tmp/' + '卡牌纪元-removed-2026-10-16/_shots/'
};
const esc = (s) => s.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&');

/* ---------- 1. 白名单 ---------- */

const TOP_LEVEL = ['index.html', 'README.md', 'AGENTS.md', 'DEVLOG.md', 'LICENSE', 'LICENSE-THIRD-PARTY.md',
                   'start-net.sh', 'start-net.bat', '.gitattributes', 'src', 'vendor', 'assets', 'audio', 'tools', 'docs'];
const NEVER_DIRS = ['research', 'dist', '.artifacts', '.git', 'node_modules', '.github', '.vscode', '.idea', 'legacy-src-refactor'];
const NEVER_FILE = /^(\.DS_Store|Thumbs\.db|\.env|\.env\..*)$/i;
const NEVER_SUFFIX = /\.(wav|log|tmp|bak|swp|orig|pyc|lnk|url|tgz|zip)$/i;

function skipRel(rel) {
  const parts = rel.split('/');
  if (NEVER_DIRS.indexOf(parts[0]) >= 0) return '顶层排除:' + parts[0];
  for (let i = 0; i < parts.length - 1; i++) if (NEVER_DIRS.indexOf(parts[i]) >= 0) return '排除目录内:' + parts[i];
  const base = parts[parts.length - 1];
  if (NEVER_FILE.test(base)) return '排除文件:' + base;
  if (NEVER_SUFFIX.test(base)) return '排除后缀:' + base;
  if (/^assets\/ui\/kenney/.test(rel) && /^(Preview\.png|Visit .*|Donate\.url|Facebook\.url|Twitter\.url)$/.test(base)) return '素材包冗余';
  if (rel === SELF) return '导出器自己不随包分发';
  if (/\.gitignore$/.test(base)) return '副本自己生成';
  return null;
}

const DECLARED = [
  /^tools\/open_source_pack\.cjs$/,
  /^research\//, /^dist\//, /^\.artifacts\//, /^node_modules\//, /^\.github\//,
  /^docs\/legacy-src-refactor\//,
  /\.wav$/i, /\.zip$/i, /\.gitignore$/,
  /^assets\/ui\/kenney[^/]*\/(Preview\.png|Visit .*|Donate\.url|Facebook\.url|Twitter\.url)$/
];
const declaredWhy = (rel) => DECLARED.some((re) => re.test(rel));

/* ---------- 2. 中性化 ---------- */

const RETARGET = [
  [/\[tools\/open_source_pack\.cjs\]\(tools\/open_source_pack\.cjs\)/g, '`tools/open_source_pack.cjs`（开源包导出脚本本身不随包分发）'],
  [new RegExp('\\[' + BT + '?research/magic-circles/README\\.md' + BT + '?\\]\\(\\.\\./research/magic-circles/README\\.md\\)', 'g'), '[docs/RESEARCH_SOURCES.md](RESEARCH_SOURCES.md)'],
  [/research\/magic-circles\/README\.md/g, 'docs/RESEARCH_SOURCES.md'],
  [new RegExp(BT + 'research/mage-character/' + BT + '（完整套图，含全部 attack/idle 帧）', 'g'), '完整套图见 CC-BY 出处页（LICENSE-THIRD-PARTY.md）'],
  [new RegExp(BT + 'research/(magic-circles|noita-magic|mage-character)/' + BT, 'g'), 'docs/RESEARCH_SOURCES.md'],
  [/research\/magic-circles/g, 'docs/RESEARCH_SOURCES.md'],
  [/research\/noita-magic/g, 'docs/RESEARCH_SOURCES.md'],
  [/research\/mage-character/g, 'CC-BY 出处页'],
  [/（B 站指令法阵 12 张 \+ 铁魔法 5 张 \+ 公版印记 2 张，每张都注明了出处）/g, '（法阵与印记的第三方截图见出处表，不随本仓库分发）']
];

const DOC = [
  [new RegExp(esc(LIT.dataClaude) + '/' + esc(LIT.gameTest) + '(\\\\(baseline\\\\))?', 'g'), '早期废弃的另一份镜像（本机，已不维护）'],
  [new RegExp(esc(LIT.dataClaude), 'g'), '本机早期目录'],
  [new RegExp(esc(LIT.dataCoding) + '/像素3D-noita', 'g'), '本项目仓库'],
  [new RegExp(esc(LIT.dataCoding), 'g'), '本机的 ~/Coding/'],
  [new RegExp(esc(LIT.gameTest) + '(\\(baseline\\))?', 'g'), '早期 baseline 镜像（已废弃）'],
  [/\\\\(?:\d{1,3}\.){3}\d{1,3}\\[^\s)）]*/g, '局域网共享里的同一份工作树'],
  [new RegExp(esc(LIT.lan) + '\\d+\\.\\d+', 'g'), '内网地址'],
  [/ROG\s*台式机/g, '游戏台式机'],
  [/\| *ROG *\|/g, '| 本机 |'],
  [new RegExp(esc(LIT.shots), 'g'), 'git 历史里的已删截图'],
  [new RegExp('历史上另有一份 [^\\n]*' + esc(LIT.gameTest) + '[^\\n]*', 'g'), '历史上另有一份早期镜像（本机，已不维护）'],
  [/（本机 ' + LIT.port + ' 端口曾服务它）/g, '（曾在本机另占一个端口服务它）'],
  [new RegExp('4\\. \\*\\*端口别抢\\*\\*：' + LIT.port + ' 是别的会话起的服务，不要停它也不要复用。', 'g'), '4. **端口别抢**：量具自己随机挑空闲端口，不复用本机已在跑的服务。'],
  [/（别抢 ' + LIT.port + '）/g, '（别复用本机已在跑的端口）'],
  [/别抢 ' + LIT.port + '/g, '别复用本机已在跑的端口'],
  [/；' + LIT.port + ' 端口未碰/g, '；本机已在跑的端口未碰'],
  [/用户台式机/g, '玩家的台式机'],
  [/用户在台式机报/g, '玩家在台式机报'],
  [/按你的截图/g, '按玩家截图'],
  [/你报的/g, '玩家报的'],
  [new RegExp('\\b' + LIT.port + '\\b', 'g'), '本机某端口'],
  [/本机某端口 端口/g, '本机已在跑的端口'],
  [/ 本机某端口/g, ' 本机已在跑的端口'],
  [/在 本机某端口 页面上/g, '在本机页面上'],
];

/* 代码：只把机器专属的依赖绝对路径改成可移植写法，别的一律不碰。 */
const CODE = [
  [new RegExp('NODE_PATH=' + esc(LIT.miniconda), 'g'), 'NODE_PATH=$(npm root -g)'],
  [new RegExp(esc(LIT.miniconda), 'g'), '$(npm root -g)']
];


/* 整行标记替换：某些行被碎片替换改出重复话（例如「本机 本机某端口 端口」），
   整行重写比堆正则可靠。按源文本里的标记命中，换成一句能独立读通的中性话；只在文档上跑。 */
const LINE_FIX = [
  ['唯一真源是本目录', '1. **唯一真源就是仓库根目录**，改动只写这里。'],
  ['历史上另有一份', '   早期在本机另有过一份镜像副本，已确认废弃：不要再往里同步，也不要拿它的表现当项目状态。'],
  ['那份不用管', '   （那份镜像已废弃，别再当项目状态引用。）'],
  ['端口别抢', '4. **端口别抢**：量具自己随机挑空闲端口，不复用本机已在跑的服务。'],
  ['gw_static.cjs', '需要单步调试时，自己起一个禁缓存的静态服务（任选空闲端口），然后在控制台或 Playwright page.evaluate 里：'],
  ['镜像按你说的不再维护', '- 之前那份早期本机镜像按玩家要求不再维护，一切以本仓库为准。'],
];
function fixLines(text) {
  const ls = text.split('\n');
  for (let i = 0; i < ls.length; i++) {
    for (const [marker, to] of LINE_FIX) {
      if (ls[i].includes(marker)) { ls[i] = to; break; }
    }
  }
  return ls.join('\n');
}

const scrub = (s, rules) => rules.reduce((acc, [re, to]) => acc.replace(re, to), s);
const scrubDoc = (s) => scrub(scrub(fixLines(s), RETARGET), DOC);
const scrubCode = (s) => scrub(s, CODE);

const COPY_GITIGNORE = ['node_modules/', '*.log', '.DS_Store', '.tmp-*',
  '', '# 本机研究缓存与导出产物（不入库）', 'research/', 'dist/',
  '', '# 逐位可重建的生成物：node tools/music_compose.cjs all', 'audio/demos/*.wav', 'audio/sfx/*.wav',
  '', '__pycache__/', '*.pyc', ''].join('\n');

/* ---------- 3. 自检 ---------- */

const TEXT_EXT = /\.(md|markdown|js|cjs|mjs|json|txt|html|css|sh|bat|yml|yaml|py|svg|xml)$/i;
const isTextFile = (rel) => TEXT_EXT.test(rel) || /^LICENSE$/.test(rel);
const isCode = (rel) => /\.(cjs|js|mjs)$/.test(rel);
const exempt = (rel) => /^vendor\//.test(rel);            // 压缩后的三方库不算文本

const HARD = [
  ['凭据', new RegExp(esc(LIT.sshHead) + '[A-Z ]*PRIVATE KEY|' + LIT.ghp + '[A-Za-z0-9]{20,}|' + LIT.pat + '[A-Za-z0-9_]{20,}|gh[oprs]_[A-Za-z0-9]{30,}|' + LIT.akia + '[0-9A-Z]{16}|' + LIT.slack + '[A-Za-z0-9-]{10,}|' + LIT.glpat + '[A-Za-z0-9_-]{20}|password\\s*[:=]\\s*[^\\s,;]{6,}', 'i')],
  ['本机路径', new RegExp(esc(LIT.dataCoding) + '|' + esc(LIT.dataClaude) + '|' + esc(LIT.homeDell) + '|' + esc(LIT.usersDir) + '|' + LIT.winUsers + '|' + esc(LIT.gameTest) + '|' + esc(LIT.miniconda) + '|' + esc(LIT.lan))],
  ['联系方式', new RegExp(LIT.at + 'qq\\.' + 'com|' + LIT.at + '163\\.' + 'com|' + LIT.at + '126\\.' + 'com|' + LIT.at + 'foxmail|微信号?[:：]|手机号[:：]|Telegram[:：]\\s*' + LIT.at, 'i')]
];

const SOFT = [
  ['账号痕迹', new RegExp(LIT.blue), '确认它是你要公开的 GitHub 账号、Copyright 行是你认可的署名即可'],
  ['对话现场口吻', /按你说的|你测试过/, '留一两条没事，成段就要改了']
];

const IP_ALLOW = { '127.0.0.1': 1, '0.0.0.0': 1, '255.255.255.255': 1, '1.1.1.1': 1, '8.8.8.8': 1 };
const VER_CTX = /(chrome|chromium|headless|node|three|version|ver=|semver|px)/i;
function badIps(line) {
  const hits = [];
  const re = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;
  let m;
  while ((m = re.exec(line))) {
    const oct = [m[1], m[2], m[3], m[4]].map(Number);
    if (oct.some((o) => o > 255)) continue;                     // 任一段 >255 = 版本号，不是 IP
    const ip = oct.join('.');
    if (IP_ALLOW[ip]) continue;
    if (VER_CTX.test(line.slice(Math.max(0, m.index - 14), m.index))) continue;
    hits.push(ip);
  }
  return hits;
}

function walk(abs, rel, sink) {
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    const a = path.join(abs, ent.name);
    if (ent.isDirectory()) walk(a, r, sink);
    else if (ent.isFile()) sink.push(r);
  }
}
function readText(p) {
  const buf = fs.readFileSync(p);
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

/* 拆串还原：本工具用 '/' + 'data/...' 的形式写敏感字面量（否则它自己会命中自己的门禁）。
   审计时先把这种拼接抹掉再匹配，堵住「拆字符串绕过扫描」这条路。 */
const defuse = (s) => s.replace(/'\s*\+\s*'/g, '');

function audit(outDir) {
  const files = [];
  walk(outDir, '', files);
  const hard = [], soft = [];
  for (const rel of files) {
    if (!isTextFile(rel) || exempt(rel)) continue;
    const text = readText(path.join(outDir, rel));
    if (text === null) continue;
    text.split('\n').forEach(function (line, i) {
      const unsplit = defuse(line);
      for (const [name, re] of HARD) {
        re.lastIndex = 0;
        const hit = re.test(line) || (unsplit !== line && (re.lastIndex = 0, re.test(unsplit)));
        if (hit) hard.push(rel + ':' + (i + 1) + ' [' + name + '] ' + (unsplit === line ? line : unsplit).trim().slice(0, 150));
      }
      const ips = badIps(line);
      if (ips.length) hard.push(rel + ':' + (i + 1) + ' [非本机IP] ' + ips.join(',') + '  ← ' + line.trim().slice(0, 120));
      if (/\.(md|txt|html)$/i.test(rel)) for (const [name, re, why] of SOFT) { re.lastIndex = 0; if (re.test(line)) soft.push(rel + ':' + (i + 1) + ' [' + name + '] ' + line.trim().slice(0, 120) + '  ← ' + why); }
    });
  }
  return { hard: hard, soft: soft, files: files };
}

function coverage(outDir) {
  const srcFiles = [];
  walk(ROOT, '', srcFiles);
  srcFiles.sort();
  const outArr = [];
  walk(outDir, '', outArr);
  const set = new Set(outArr);
  const missing = [], excluded = [];
  let kept = 0;
  for (const rel of srcFiles) {
    if (/^\.git\//.test(rel)) continue;
    if (/^dist\//.test(rel)) continue;                           // 导出目录自己，不算覆盖率
    const why = skipRel(rel);
    if (why) { if (declaredWhy(rel)) excluded.push(rel); else missing.push(rel + '  [排除但没声明: ' + why + ']'); continue; }
    if (TOP_LEVEL.indexOf(rel.split('/')[0]) < 0) { missing.push(rel + '  [顶层不在白名单]'); continue; }
    if (set.has(rel)) { kept++; continue; }
    missing.push(rel + '  [应有而缺失]');
  }
  return { missing: missing, excluded: excluded, kept: kept, total: srcFiles.length, copied: outArr.length };
}

const DOC_LINK = /\.(md|html|js|cjs|mjs|css|json|txt)$/i;
function linksOf(text, dir) {
  const out = new Set();
  const cand = new Set();
  let m;
  const re1 = /\]\((?!https?:|mailto:|#)([^)#?\s]+)/g;
  while ((m = re1.exec(text))) cand.add(m[1]);
  const re2 = /(?:href|src)="(?!https?:|data:|#)([^"]+)"/g;
  while ((m = re2.exec(text))) cand.add(m[1]);
  for (const c of cand) {
    let p = c.replace(/^\.\//, '');
    if (/[*{}<>|$]/.test(p)) continue;                            // 通配 / 模板占位不算链接
    p = p.split(/[?#]/)[0].replace(/\/$/, '');
    if (!p || p === '.' || !DOC_LINK.test(p)) continue;            // 只管文档与脚本级链接
    out.add(path.posix.normalize(path.posix.join(dir, p)));
  }
  return out;
}
let _srcCache = null;
function allSrc() { if (!_srcCache) { _srcCache = []; walk(ROOT, '', _srcCache); } return _srcCache; }
function brokenLinks(outDir, files) {
  const fresh = [], legacy = [];
  for (const rel of files) {
    if (!isTextFile(rel) || exempt(rel)) continue;
    const text = readText(path.join(outDir, rel));
    if (text === null) continue;
    const dir = path.posix.dirname(rel);
    const inCopy = linksOf(text, dir);
    if (!inCopy.size) continue;
    // 源侧同路径优先；改名/搬家的文件按 basename 回找源位置，用源自己的目录算链接
    let srcAbs = path.join(ROOT, rel), srcDir = dir;
    if (!fs.existsSync(srcAbs)) {
      const base = path.posix.basename(rel);
      const hit = allSrc().find((r2) => path.posix.basename(r2) === base);
      if (hit) { srcAbs = path.join(ROOT, hit); srcDir = path.posix.dirname(hit); }
    }
    let inSrc = new Set();
    if (fs.existsSync(srcAbs)) {
      const st = readText(srcAbs);
      if (st !== null) inSrc = linksOf(isCode(rel) ? scrubCode(st) : scrubDoc(st), srcDir);
    }
    for (const l of inCopy) {
      if (fs.existsSync(path.join(outDir, l))) continue;
      if (inSrc.has(l)) legacy.push(rel + ' → ' + l);
      else fresh.push(rel + ' → ' + l);
    }
  }
  return { fresh: fresh, legacy: legacy };
}

/* ---------- 4. 构建 ---------- */

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const lack = TOP_LEVEL.filter((t) => !fs.existsSync(path.join(ROOT, t)));
  if (lack.length) throw new Error('源目录缺关键文件：' + lack.join(', ') + '（README / LICENSE 先落盘再出包）');
  let nFile = 0, nBytes = 0, nScrub = 0;
  const queue = TOP_LEVEL.map((rel) => ({ rel: rel }));
  while (queue.length) {
    const rel = queue.shift().rel;
    if (skipRel(rel)) continue;
    const absSrc = path.join(ROOT, rel);
    const st = fs.statSync(absSrc);
    if (st.isDirectory()) {
      for (const ent of fs.readdirSync(absSrc, { withFileTypes: true })) queue.push({ rel: rel + '/' + ent.name });
      continue;
    }
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    if (isTextFile(rel) && rel !== SELF) {
      const before = fs.readFileSync(absSrc, 'utf8');
      const after = isCode(rel) ? scrubCode(before) : scrubDoc(before);
      if (after !== before) nScrub++;
      fs.writeFileSync(path.join(OUT, rel), after);
    } else {
      fs.copyFileSync(absSrc, path.join(OUT, rel));
    }
    nFile++; nBytes += st.size;
  }
  fs.writeFileSync(path.join(OUT, '.gitignore'), COPY_GITIGNORE);
  const sh = path.join(OUT, 'start-net.sh');
  if (fs.existsSync(sh)) fs.chmodSync(sh, 0o755);
  console.log('复制 ' + nFile + ' 个文件（' + (nBytes / 1048576).toFixed(1) + ' MB），其中 ' + nScrub + ' 个文本被中性化改写。');
}

/* ---------- 5. 主流程 ---------- */

function main() {
  if (!CHECK_ONLY) {
    const dirty = cp.execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
    if (dirty) console.log('[!] 工作树有未提交改动：副本反映工作树，不对应任何一次提交。');
    build();
  } else if (!fs.existsSync(OUT)) {
    console.log('[x] --check-only 但目录不存在：' + OUT);
    process.exit(2);
  }
  console.log('产物目录：' + path.relative(ROOT, OUT));
  const a = audit(OUT);
  const cov = coverage(OUT);
  const bl = brokenLinks(OUT, a.files);
  const show = (arr, n) => arr.slice(0, n).map((s) => '    . ' + s).join('\n') + (arr.length > n ? '\n    . ...还有 ' + (arr.length - n) + ' 条' : '');

  console.log('\n[A] 泄露硬门禁：' + (a.hard.length === 0 ? '0 命中 OK' : a.hard.length + ' 命中 FAIL'));
  if (a.hard.length) console.log(show(a.hard, 30));
  console.log('[B] 人工过一眼：' + a.soft.length + ' 条');
  if (a.soft.length) console.log(show(a.soft, 12));
  console.log('[C] 覆盖率：源 ' + cov.total + ' → 副本 ' + cov.copied + '（带 ' + cov.kept + '，有意排除 ' + cov.excluded.length + '，意外丢失 ' + cov.missing.length + '）');
  if (cov.missing.length) console.log(show(cov.missing, 20));
  console.log('[D] 断链：新引入 ' + bl.fresh.length + (bl.fresh.length ? ' 条 FAIL' : ' 条 OK') + '；历史死链（源里本就断）' + bl.legacy.length + ' 条，不是本次脱敏造成的');
  if (bl.fresh.length) console.log(show(bl.fresh, 20));
  if (bl.legacy.length) console.log('    . 历史死链样例：' + bl.legacy.slice(0, 3).join('  |  ').slice(0, 200));

  const fail = a.hard.length > 0 || cov.missing.length > 0 || bl.fresh.length > 0;
  console.log(fail ? '\n[x] 不合格：修掉再出包。' : '\n[OK] 可以推。副本在 ' + path.relative(ROOT, OUT) + '（' + a.files.length + ' 个文件）');
  if (fail) process.exit(1);
}

main();
