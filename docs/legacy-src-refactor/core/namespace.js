window.GW = window.GW || {};
(function (G) {
  'use strict';

  /* 依赖：无（全局命名空间与装配期校验）
     全项目所有类都挂在 window.GW 下；加载顺序 = index.html 的 script 顺序 = ARCHITECTURE.md 的层序。
     require 的作用是：装配期就暴露"脚本漏了或顺序错了"，别让 undefined 悄悄跑进主循环。 */
  G.VERSION = 3;
  G.layers = ['core', 'world', 'cards', 'rules', 'battle', 'camera', 'input', 'render', 'ui', 'audio', 'save', 'app'];

  G.require = function (name) {
    var made = G[name];
    if (!made) throw new Error('GW.' + name + ' 未定义：检查 index.html 的 script 顺序或文件名');
    return made;
  };
  /* 给"必须在别的脚本之后跑"的装配步骤用：装配期一次性校验，失败即抛。 */
  G.requireAll = function (names) { return names.map(G.require); };

})(window.GW);
