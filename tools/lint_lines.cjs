'use strict';
/* tools/lint_lines.cjs - 机检『功能函数不超过 3 行』（重构验收门槛，不参与游戏运行）
   规则：函数体 = 签名之后的非空非注释行，最多 3 行；同时数顶层语句（默认 6），
   防止把 28 条赋值用逗号挤成一行绕过行数。构造函数若全是单条 this.x = 赋值则豁免。
   先整份剥掉注释与字符串，否则 net.js:161 协议注释里的 {t:'i',...} 会污染括号配平。
   用法：node tools/lint_lines.cjs [路径=js] [--max-lines 3] [--max-stats 6] [--list] */
var fs = require('fs'), path = require('path');
var SKIP = { if: 1, for: 1, while: 1, switch: 1, catch: 1, return: 1, else: 1, do: 1, try: 1 };
var PATTERNS = [
  /^\s*(?:[A-Za-z_$][\w$.]*\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/,
  /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:[A-Za-z_$][\w$.]*\.)?([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\s*\(/,
  /^\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/,
  /^\s*(?:static\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{\s*$/
];
function blankComments(text) {
  var out = '', i = 0, n = text.length, q;
  while (i < n) {
    var c = text.charAt(i), nx = text.charAt(i + 1);
    if (c === '"' || c === "'" || c === '`') {
      q = c; i++;
      while (i < n) {
        if (text.charAt(i) === '\\') { out += '  '; i += 2; continue; }
        if (text.charAt(i) === q) { i++; break; }
        out += (text.charAt(i) === '\n' ? '\n' : ' '); i++;
      }
      continue;
    }
    if (c === '/' && nx === '/') { while (i < n && text.charAt(i) !== '\n') i++; continue; }
    if (c === '/' && nx === '*') {
      out += '  '; i += 2;
      while (i < n && !(text.charAt(i) === '*' && text.charAt(i + 1) === '/')) { out += (text.charAt(i) === '\n' ? '\n' : ' '); i++; }
      i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}
function walk(dir, out) {
  var names = fs.readdirSync(dir);
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    if (n === 'node_modules' || n.charAt(0) === '.') continue;
    var p = path.join(dir, n), st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out); else if (n.slice(-3) === '.js') out.push(p);
  }
  return out;
}
function scanTop(body) {
  var stmts = [], cur = '', depth = 0, assigns = 0, commas = 0;
  for (var i = 0; i < body.length; i++) {
    var l = body[i];
    for (var k = 0; k < l.length; k++) {
      var c = l.charAt(k);
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      if (depth === 0 && c === ';') { if (cur.trim()) stmts.push(cur); cur = ''; continue; }
      if (depth === 0 && c === ',') commas++;
      if (depth === 0 && c === '=' && l.charAt(k + 1) !== '=' && l.charAt(k - 1) !== '!' && l.charAt(k - 1) !== '<' && l.charAt(k - 1) !== '>') assigns++;
      cur += c;
    }
    cur += ' ';
  }
  if (cur.trim()) stmts.push(cur);
  return { stmts: stmts, assigns: assigns, commas: commas };
}
function topStatements(body) { var s = scanTop(body); return Math.max(s.stmts.length, s.assigns + s.commas); }
function onlyAssignments(body) {
  var s = scanTop(body);
  if (!s.stmts.length || s.commas) return false;
  for (var i = 0; i < s.stmts.length; i++) {
    var t = s.stmts[i].trim();
    if (!/^this\.[\w$]+\s*=[^=]/.test(t)) return false;
  }
  return true;
}
function checkFile(file, maxLines, maxStats) {
  var code = blankComments(fs.readFileSync(file, 'utf8'));
  var lines = code.split('\n'), bad = [];
  for (var i = 0; i < lines.length; i++) {
    var name = null;
    for (var k = 0; k < PATTERNS.length; k++) { var m = lines[i].match(PATTERNS[k]); if (m) { name = m[1]; break; } }
    if (!name || SKIP[name]) continue;
    var depth = 0, end = i, started = false;
    for (var j = i; j < lines.length; j++) {
      var l = lines[j];
      for (var c = 0; c < l.length; c++) {
        var ch = l.charAt(c);
        if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--;
      }
      end = j;
      if (started && depth <= 0) break;
    }
    var full = lines.slice(i, end + 1).join('\n');
    var open = full.indexOf('{'), close = full.lastIndexOf('}');
    if (open < 0 || close <= open) continue;
    var body = full.slice(open + 1, close).split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (!body.length || onlyAssignments(body)) continue;
    var ex = lines[i].match(/lint:lines\((\d+)\)/);
    var limit = ex ? +ex[1] : maxLines;
    var stats = topStatements(body);
    if (body.length > limit || stats > maxStats) bad.push({ f: file, at: i + 1, name: name, lines: body.length, stats: stats, limit: limit });
  }
  return bad;
}
var argv = process.argv.slice(2), dir = 'src';
for (var a = 0; a < argv.length; a++) if (argv[a].charAt(0) !== '-' && isNaN(+argv[a])) dir = argv[a];
function opt(flag, dflt) { var i = argv.indexOf(flag); return i >= 0 ? +argv[i + 1] : dflt; }
var maxLines = opt('--max-lines', 3), maxStats = opt('--max-stats', 6);
var files = fs.statSync(dir).isDirectory() ? walk(dir, []) : [dir], bad = [];
for (var f = 0; f < files.length; f++) bad = bad.concat(checkFile(files[f], maxLines, maxStats));
console.log('检查 ' + files.length + ' 个文件：违规函数 ' + bad.length + ' 个（限：函数体 ' + maxLines + ' 行 / 顶层语句 ' + maxStats + ' 条）');
if (argv.indexOf('--list') >= 0) for (var b = 0; b < bad.length; b++) console.log('  ' + bad[b].f + ':' + bad[b].at + ' ' + bad[b].name + '() ' + bad[b].lines + '行/' + bad[b].stats + '句（限 ' + bad[b].limit + '/' + maxStats + '）');
process.exit(bad.length ? 1 : 0);