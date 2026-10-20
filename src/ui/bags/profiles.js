/* ================= GW.UI.bags.profiles（背包分版：模式 → 页面/能力/布局 的纯配置） =================
   来源：docs/PLAN_SYSTEMS.md §20.4。
   这一层只有纯数据 + 一个纯函数，零 DOM、零玩家可见文案（labelKey 只是去文案表找词的 key，不是词本身）：

     · BAG_PROFILES  每种模式的背包版：页签顺序（pages）、能力开关（caps）、布局名（layout）。
     · profileFor    按「配置.debug.creative」与「模式态.bagProfile」选出该用哪一份版。

   为什么不能写 vm.creative 分支：背包长什么样是「模式的函数」，不是「面板里的 if」。
   BagPanel 只读 profile；本文件只负责把 (cfg, modeState) 翻译成一份 profile。
   未来新增模式（draft / collection / campaign）只在这里加一条，面板结构一行不动（§20.10 E8）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  var BAG_PROFILES = {
    survival: {
      id: 'survival', labelKey: 'bag.survival',
      pages: ['hand', 'deck', 'discard'],
      caps: { catalog: false, debug: false, tray: false, discardHand: true },   // 扔牌沿用现状：由 GameMode 最终决定
      layout: 'survival'
    },
    creative: {
      id: 'creative', labelKey: 'bag.creative',
      /* 没有 tray 页：取卡货架那一排本来就常驻在中间栏底部（10 格），再给它一页只会
         把"全部 76 张卡"画进同一个网格里（boxOf 认不出 tray 就退回 catalog），那才是真割裂。
         hand 页由手持栏那一排承担（tabKeys 过滤掉它）。 */
      pages: ['catalog', 'blocks', 'hand', 'debug'],
      caps: { catalog: true, debug: true, tray: true, discardHand: true },
      layout: 'creative'
    }
  };

  /* 选择规则（§20.4）：cfg.debug.creative 优先；否则取 modeState.bagProfile，缺省 survival。 */
  function profileKeyFor(cfg, modeState) {
    if (cfg && cfg.debug && cfg.debug.creative) return 'creative';
    return (modeState && modeState.bagProfile) || 'survival';
  }

  function profileFor(cfg, modeState) {
    var key = profileKeyFor(cfg, modeState);
    return BAG_PROFILES[key] || BAG_PROFILES.survival;
  }

  var UI = G.UI || (G.UI = {});
  var bags = UI.bags || (UI.bags = {});
  bags.profiles = BAG_PROFILES;
  bags.profileFor = profileFor;
  bags.profileKeyFor = profileKeyFor;
  /* §20.4 的字面命名，供 app 直接读（vm.bag = { profile, pages, caps }） */
  G.BAG_PROFILES = BAG_PROFILES;
  G.bagProfileFor = profileFor;
  G.bagProfileKeyFor = profileKeyFor;
})(window.GW);
