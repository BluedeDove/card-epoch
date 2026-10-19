'use strict';
/* tools/extract_dom.cjs - 从 index.html 机械抽取 HUD/菜单的节点结构，生成 src/ui/ui-tree.js 初版。
   动机：index.html 里 65 个 id、25 个 class。手写转抄到声明式 spec 本身就是出错源
   （分屏那个重复 id="cross" 就是这么来的）。规矩：抽取 → 生成 → 人只复核，不许手打。
   用法：node tools/extract_dom.cjs [index.html] [--emit src/ui/ui-tree.js] */
var fs = require('fs');
var VOID = { br: 1, img: 1, input: 1, meta: 1, link: 1, hr: 1, source: 1, canvas: 0 };
function attrsOf(tag) {
  var id = /\bid="([^"]+)"/.exec(tag), cls = /\bclass="([^"]+)"/.exec(tag);
  return { id: id ? id[1] : null, cls: cls ? cls[1].trim().split(/\s+/).filter(Boolean) : [] };
}
function nameOf(chunk) {
  var m = /^<\/?([A-Za-z][\w-]*)/.exec(chunk);
  return m ? m[1].toLowerCase() : null;
}
function parse(html) {
  var re = /<\/?[A-Za-z][\w-]*(?:\s[^>]*)?\/?>/g, m, root = { children: [] }, stack = [root];
  while ((m = re.exec(html))) {
    var chunk = m[0], closing = chunk.charAt(1) === '/', tag = nameOf(chunk);
    if (!tag) continue;
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    var node = { tag: tag, id: null, cls: [], children: [] };
    var a = attrsOf(chunk); node.id = a.id; node.cls = a.cls;
    stack[stack.length - 1].children.push(node);
    if (!VOID[tag] && !/\/$/.test(chunk)) stack.push(node);
  }
  return root.children;
}
function prune(nodes) {
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i], kids = prune(n.children);
    if (n.id || n.cls.length || kids.length) out.push({ tag: n.tag, id: n.id, cls: n.cls, children: kids });
  }
  return out;
}
function countTags(nodes, acc) {
  for (var i = 0; i < nodes.length; i++) { acc[nodes[i].tag] = (acc[nodes[i].tag] || 0) + 1; countTags(nodes[i].children, acc); }
  return acc;
}
var entry = process.argv[2] || 'index.html';
if (!fs.existsSync(entry)) { console.error('找不到 ' + entry); process.exit(2); }
var html = fs.readFileSync(entry, 'utf8');
var ids = (html.match(/\bid="[^"]+"/g) || []).map(function (s) { return s.slice(4, -1); });
var classes = {};
(html.match(/\bclass="[^"]+"/g) || []).forEach(function (s) { s.slice(7, -1).trim().split(/\s+/).forEach(function (c) { if (c) classes[c] = (classes[c] || 0) + 1; }); });
var dup = ids.filter(function (v, i) { return ids.indexOf(v) !== i; });
var bodyRaw = (/<body[^>]*>([\s\S]*)<\/body>/.exec(html) || ['', ''])[1];
var tree = prune(parse(bodyRaw));
var report = { 文件: entry, id总数: ids.length, 唯一id: new Set(ids).size, 重复id: dup, class数: Object.keys(classes).length, 顶层节点: tree.length, 标签统计: countTags(tree, {}) };
console.log(JSON.stringify(report, null, 1));
var e = process.argv.indexOf('--emit');
if (e >= 0) {
  var target = process.argv[e + 1];
  var head = '/* 由 tools/extract_dom.cjs 从 index.html 机械生成，勿手改；要改结构就改抽取脚本后重新生成。 */\n';
  head += 'window.GW = window.GW || {};\nwindow.GW.UI_TREE = ' + JSON.stringify(tree, null, 1) + ';\n';
  fs.mkdirSync(require('path').dirname(target), { recursive: true });
  fs.writeFileSync(target, head);
  console.log('已写出 ' + target + '（' + tree.length + ' 个顶层节点）');
}