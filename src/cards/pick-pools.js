/* ================= GW.PICK_POOLS =================
   src/cards/pick-pools.js · L2 cards（纯数据，定案 docs/CARD_ECONOMY.md §2.1）
   只回答这一个问题：每个名义群系的三选一池里放哪 8 张卡（外加兽首杀用的通用池 8 张）。

   为什么是"名义群系"：三个基准 seed（490706 / 88092 / 31337）的三矿落点实测全落在翠绿林海
   （GAMEPLAY §6），按实际地形取池会把局内成长压成一条路线。定案采用候选解 ①：群系由 seed 派生
   （排列在 battle.js 的 Match 构造期用 mulberry32(seed ^ 0xB10E) 洗出来），与地形无关，也不动地形
   生成——H1（同 seed 逐格一致）照旧成立。

   纪律：这张表里只有 id。零 DOM、零分支、零循环、零随机——取样在 Match.offerDraft 里做，
   并且必须走专用随机流 mulberry32(seed ^ 0xD4A7)（不与其他系统共用序列，同 seed 同操作顺序可复现）。
   cost ≤ 5 是 §2.1 的选卡口径，往池里加卡时自己核对。
   PICK_POOL_CN 只是群系显示名，给 T5 的三选一面板取用；玩家可见句子的真源仍是 src/hud.js 的 H.TEXT。
   id 与顺序照 docs/CARD_ECONOMY.md §2.1 的表逐字抄——tools/draft_check.cjs 的 D1 把文档表与本表
   逐元素比对：改了文档没同步过来这里先红，文档与数据分叉不许靠"看起来差不多"混过去。
   ================================================ */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  G.PICK_BIOMES = ['forest', 'desert', 'tundra'];
  G.PICK_POOLS = {
    /* 林海 · nature + rock */
    forest: ['raise', 'ramp', 'spikes', 'golem', 'dryad', 'bloom_field', 'entangle', 'bulwark'],
    /* 黄沙 · fire + rock */
    desert: ['bolt', 'bloom', 'firewall', 'ignite', 'supernova', 'obsidian_cage', 'fortress', 'shift'],
    /* 雪原 · ice + void */
    tundra: ['shard', 'freeze', 'icewall', 'glacier', 'frost_nova', 'storm_hawk', 'void_lance', 'blink'],
    /* 通用（晶甲兽首杀用）· neutral */
    neutral: ['draw1', 'overload', 'focus', 'anchor', 'push', 'kick', 'totem', 'snare_trap']
  };
  G.PICK_POOL_CN = { forest: '林海', desert: '黄沙', tundra: '雪原' };
})(window.GW);
