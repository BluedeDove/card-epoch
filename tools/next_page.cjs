'use strict';
/* tools/next_page.cjs - 由 src/MANIFEST.json 生成 src/preview.next.html。
   加载顺序是"数据"（MANIFEST），不藏在脚本里；index.html 仍指向旧 src/，P7 才一次性切换。
   做法：把原 HTML 里从第一个 script 到最后一个 script 的整段换掉，绝不留旧 src/ 引用。 */
var fs = require('fs');
var man = JSON.parse(fs.readFileSync('src/MANIFEST.json', 'utf8'));
var html = fs.readFileSync('index.html', 'utf8');
var first = html.indexOf('<script src=');
var last = html.lastIndexOf('</script>') + '</script>'.length;
if (first < 0 || last < 0) { console.error('index.html 里找不到 script 段'); process.exit(2); }
var missing = man.files.filter(function (f) { return !fs.existsSync(f); });
if (missing.length) { console.error('缺文件：' + missing.join(', ')); process.exit(1); }
var tags = man.files.map(function (f) { return '<script src="' + f + '"></script>'; }).join('\n');
var out = html.slice(0, first) + tags + html.slice(last);
out = out.replace('<title>卡牌纪元 · 像素 3D 卡牌对战</title>',
  '<title>卡牌纪元 · 重构验证页（src/）</title>\n<!-- 由 tools/next_page.cjs 生成；真源是 src/MANIFEST.json，别手改 -->');
fs.writeFileSync('src/preview.next.html', out);
var left = (out.match(/js\/[a-z]+\.src/g) || []);
console.log('src/preview.next.html：' + man.files.length + ' 个脚本；残留旧 src/ 引用 ' + left.length + ' 个');
if (left.length) process.exit(1);
