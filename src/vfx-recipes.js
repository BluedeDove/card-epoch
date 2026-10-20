/* ================= GW.VFX.RECIPES =================
   纯数据：把民间魔法特效里反复出现的画法拆成「原子类 + 每层动画」的组合配方。
   逻辑不在此处（算的一式 js/vfx.js，画的一式渲染层），这里只有数字与形状。
   显示用的中文名字归 UI 层（H.TEXT.vfx），本文件不出现玩家可见文案。

   半径约定：所有 r / rOut / h 都是「单位半径 × 实体半径」的相对量，
   写 1 就等于贴着法阵外沿，渲染层不需要知道米数就能摆位。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var V = G.VFX;
  if (!V) return;

  /* ---------- 通用零件（同一种环在多份配方里复用，避免各写各的） ---------- */
  var OUTER_TICKS = { prim: 'ring', r: 1, style: 'ticks', count: 64, w: 1, spin: 0.35, flow: 0.9, draw: 1 };
  var OUTER_SOLID = { prim: 'ring', r: 1, style: 'solid', count: 96, w: 0.6, spin: -0.18, draw: 1 };
  var DOTS_MID    = { prim: 'ring', r: 0.78, style: 'dots', count: 28, w: 1, spin: 0.6, draw: 1 };
  var GLYPH_RING  = { prim: 'glyphs', r: 0.9, n: 12, size: 0.11, spin: -0.22, blink: 0.25 };
  var INNER_RING  = { prim: 'ring', r: 0.44, style: 'solid', count: 64, w: 0.8, spin: 1.1, draw: 1 };
  var SPIKES_OUT  = { prim: 'spokes', rIn: 0.3, rOut: 1.28, n: 9, w: 0.9, jitter: 0.04, spin: 0.12 };

  function R(id, anchor, layers, extra) {
    var spec = Object.assign({ anchor: anchor, seed: 0, igniteWindow: 0.35 }, extra || {}, { layers: layers });
    V.registerRecipe(id, spec);
    return id;
  }

  /* ---------- 1. 基础环：最保守的一档，给新卡当默认 ---------- */
  R('circle_basic', 'ground', [OUTER_SOLID, DOTS_MID], { seed: 11 });

  /* ---------- 2. 多层悬浮环组（B 站指令法阵最抢眼的那种） ----------
     四圈不同倾角、正反交替转的环 + 两个内接星形：层数不多，但每层各转各的。 */
  R('command_stack', 'ground', [
    OUTER_TICKS,
    { prim: 'ring', r: 0.94, style: 'dots', count: 40, spin: -0.5, tilt: 0.18, draw: 1 },
    { prim: 'ring', r: 0.7,  style: 'solid', count: 80, spin: 0.8, tilt: -0.34, w: 0.7, draw: 1 },
    { prim: 'ring', r: 0.56, style: 'ticks', count: 32, spin: -1.2, tilt: 0.42, draw: 1 },
    { prim: 'poly', r: 0.5, n: 5, step: 2, spin: 0.42, w: 1, spike: 0.24 },
    { prim: 'poly', r: 0.34, n: 3, step: 1, spin: -0.9, w: 0.8 },
    { prim: 'vortex', rTop: 0.4, rBot: 0.06, layers: 5, h: 1.1, count: 36, spin: 1.6, alpha: 0.85 }
  ], { seed: 101 });

  /* ---------- 3. 超位法阵：刻度齿环 + 出头五角星 + 偏心小圆 + 中心光柱 ---------- */
  R('super_spell', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 96, w: 1.2, spin: 0.22, draw: 1 },
    OUTER_SOLID,
    { prim: 'poly', r: 0.86, n: 5, step: 2, spike: 0.5, spin: -0.28, w: 1.1 },
    { prim: 'orbit', r: 0.66, n: 3, size: 0.14, spin: 1.3, tilt: 0.2 },
    { prim: 'ring', r: 0.3, style: 'solid', count: 48, spin: 2.2, w: 0.6 },
    { prim: 'pillar', r: 0, count: 1, h: 3.2, w: 1.6, taper: 0.15, flicker: 0.18 },
    { prim: 'vortex', rTop: 0.5, rBot: 0.1, layers: 6, h: 1.3, count: 48, spin: -2.2, alpha: 0.8 }
  ], { seed: 202 });

  /* ---------- 4. 双光环 + 符号带（高饱和单色 + 近白核心的路子） ---------- */
  R('dragon_halo', 'ground', [
    { prim: 'ring', r: 1, style: 'dots', count: 56, spin: 0.4, tilt: 0.1, draw: 1 },
    { prim: 'ring', r: 0.82, style: 'solid', count: 90, spin: -0.6, tilt: -0.22, w: 0.8, color2: '#ffffff' },
    GLYPH_RING,
    { prim: 'pillar', r: 0.62, count: 5, h: 2.6, w: 0.5, taper: 0.5, flicker: 0.35, rise: 1.2 },
    { prim: 'spokes', rIn: 0.2, rOut: 1.05, n: 18, w: 0.4, jitter: 0.08, spin: 0.2 }
  ], { seed: 303 });

  /* ---------- 5. 放射尖角 + 细环（九角星那一类） ---------- */
  R('starburst_ground', 'ground', [
    OUTER_SOLID, SPIKES_OUT, GLYPH_RING,
    { prim: 'poly', r: 0.36, n: 4, step: 1, spin: 1.4, w: 0.9 }
  ], { seed: 404 });

  /* ---------- 6. 六芒星 / 圆角三角（4 个命令方块就能做的那种极简阵） ---------- */
  R('hexagram', 'ground', [
    { prim: 'ring', r: 1, style: 'solid', count: 96, w: 1.1, spin: 0.16, draw: 1 },
    { prim: 'poly', r: 0.92, n: 6, step: 2, spike: 0.34, spin: -0.3, w: 1.2 },
    { prim: 'ring', r: 0.36, style: 'solid', count: 48, spin: 0.9, w: 0.9 }
  ], { seed: 505 });
  R('triangle_rune', 'ground', [
    { prim: 'ring', r: 1, style: 'solid', count: 96, w: 1, spin: -0.2, draw: 1 },
    { prim: 'poly', r: 0.8, n: 3, step: 1, spin: 0.55, w: 1.3 },
    { prim: 'ring', r: 0.24, style: 'dots', count: 12, spin: -1.6 }
  ], { seed: 506 });

  /* ---------- 7. 跟随体（挂在实体脚下 / 身上） ---------- */
  R('follow_star', 'body', [
    { prim: 'ring', r: 1, style: 'dots', count: 24, spin: 1.2, w: 1, draw: 1 },
    { prim: 'poly', r: 0.8, n: 5, step: 2, spin: -0.8, w: 1.1 }
  ], { seed: 606 });
  R('summon_aura', 'body', [
    { prim: 'ring', r: 1, style: 'solid', count: 64, spin: 0.5, w: 0.7 },
    { prim: 'ring', r: 0.72, style: 'ticks', count: 24, spin: -1.1, w: 0.6, flow: 1.4 },
    { prim: 'orbit', r: 1.15, n: 4, size: 0.08, spin: 1.8 }
  ], { seed: 607 });

  /* ---------- 8. 剑阵 / 环绕体（把抛射物本身当图案元素排布） ---------- */
  R('sword_ring', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 72, spin: 0.3, w: 1 },
    { prim: 'orbit', r: 0.9, n: 12, size: 0.16, spin: 1.5, tilt: 0.12 },
    { prim: 'ring', r: 0.55, style: 'dots', count: 32, spin: -1.9, tilt: -0.5 },
    { prim: 'poly', r: 0.4, n: 8, step: 3, spin: 0.7, w: 0.8 }
  ], { seed: 707 });

  /* ---------- 9. 线框球（只用点也能读出线：多圈不同倾角） ---------- */
  R('wire_sphere', 'ground', [
    { prim: 'ring', r: 1, style: 'dots', count: 40, w: 0.5, tilt: -0.5500, spin: 0.22, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 40, w: 0.5, tilt: -0.3929, spin: 0.25, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 40, w: 0.5, tilt: -0.2357, spin: 0.28, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 40, w: 0.5, tilt: -0.0786, spin: 0.31, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 40, w: 0.5, tilt: 0.0786, spin: 0.34, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 40, w: 0.5, tilt: 0.2357, spin: 0.37, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 40, w: 0.5, tilt: 0.3929, spin: 0.40, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 36, w: 0.5, tilt: 0, spin: 0.18, alpha: 0.9 },
    { prim: 'ring', r: 1, style: 'dots', count: 36, w: 0.5, tilt: 0, spin: 0.18, alpha: 0.9 },
    { prim: 'ring', r: 1, style: 'dots', count: 36, w: 0.5, tilt: 0, spin: 0.18, alpha: 0.9 },
    { prim: 'ring', r: 1, style: 'dots', count: 36, w: 0.5, tilt: 0, spin: 0.18, alpha: 0.9 },
    { prim: 'ring', r: 1, style: 'dots', count: 36, w: 0.5, tilt: 0, spin: 0.18, alpha: 0.9 },
    { prim: 'orbit', r: 1.35, n: 2, size: 0.12, spin: 0.7, tilt: 0.25 }
  ], { seed: 808 });

  /* ---------- 10. 三段火焰弧 / 法阵开启的瞬时反馈 ---------- */
  R('fire_tri', 'ground', [
    { prim: 'sweep', r: 1, a0: 0, span: 1.5, speed: 1.4, w: 1.6, draw: 1 },
    { prim: 'sweep', r: 1, a0: 2.094, span: 1.5, speed: 1.4, w: 1.6, draw: 1 },
    { prim: 'sweep', r: 1, a0: 4.188, span: 1.5, speed: 1.4, w: 1.6, draw: 1 },
    { prim: 'ring', r: 0.86, style: 'dots', count: 20, spin: -0.9 }
  ], { seed: 909 });

  /* ---------- 11. 落雷笼（竖向元素撑起体量） ---------- */
  R('thunder_cage', 'ground', [
    OUTER_TICKS, INNER_RING,
    { prim: 'pillar', r: 0.92, count: 8, h: 3.4, w: 0.8, taper: 0.25, flicker: 0.6, rise: 2.5 },
    { prim: 'ring', r: 0.92, style: 'dots', count: 24, spin: 0.9, tilt: 0.1 }
  ], { seed: 1010 });

  /* ---------- 12. 抛射物拖尾与命中冲击（实体侧） ---------- */
  R('comet_trail', 'body', [
    { prim: 'ring', r: 1, style: 'dots', count: 16, spin: 2.4, w: 0.8 },
    { prim: 'sweep', r: 0.7, span: 0.9, speed: 6, w: 1.2, alpha: 0.7 }
  ], { seed: 1111 });
  R('impact_burst', 'ground', [
    { prim: 'ring', r: 1, style: 'solid', count: 64, w: 1.4, spin: 0, pulse: 0.35, pulseHz: 5, fade: 1 },
    { prim: 'spokes', rIn: 0.1, rOut: 1.2, n: 14, w: 0.7, jitter: 0.18 }
  ], { seed: 1212, igniteWindow: 0.18 });
  R('charge_up', 'ground', [
    { prim: 'vortex', rTop: 1.1, rBot: 0.05, layers: 6, h: 1.5, count: 44, spin: 2.6 },
    { prim: 'sweep', r: 1.1, span: 0.7, speed: 4, w: 1.1 },
    { prim: 'ring', r: 0.5, style: 'ticks', count: 20, spin: -2.2, w: 0.7 }
  ], { seed: 1313 });

  /* ---------- 13. 现有 6 种法阵的特效绑定（语义：烧 / 冻 / 治愈 / 虚空 / 陷阱 / 熔池） ---------- */
  R('sigil_meteors', 'ground', [
    OUTER_TICKS, DOTS_MID,
    { prim: 'poly', r: 0.62, n: 7, step: 3, spin: 0.5, w: 1.2, spike: 0.3 },
    { prim: 'pillar', r: 0.7, count: 4, h: 2.2, w: 0.6, taper: 0.4, flicker: 0.4, rise: 1.8 },
    { prim: 'sweep', r: 0.9, span: 1.1, speed: 2.2, w: 1.4 }
  ], { seed: 2101 });
  R('sigil_glacier', 'ground', [
    { prim: 'ring', r: 1, style: 'solid', count: 96, w: 0.9, spin: -0.2, color2: '#ffffff' },
    { prim: 'poly', r: 0.82, n: 6, step: 1, spin: 0.35, w: 1.1 },
    { prim: 'poly', r: 0.82, n: 6, step: 2, spin: -0.35, w: 0.9, spike: 0.26 },
    { prim: 'pillar', r: 0.88, count: 6, h: 1.7, w: 0.55, taper: 0.2, flicker: 0.18 }
  ], { seed: 2102 });
  R('sigil_bloom', 'ground', [
    { prim: 'ring', r: 1, style: 'dots', count: 36, spin: 0.28, w: 1.1, draw: 1 },
    { prim: 'poly', r: 0.6, n: 8, step: 3, spin: -0.4, w: 0.9 },
    { prim: 'orbit', r: 0.85, n: 5, size: 0.1, spin: 0.6 },
    { prim: 'ring', r: 0.32, style: 'solid', count: 40, spin: 0.8, w: 0.7, pulse: 0.1, pulseHz: 0.8 }
  ], { seed: 2103 });
  R('sigil_rune_hammer', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 48, spin: 0.4, w: 1.2 },
    { prim: 'poly', r: 0.74, n: 4, step: 1, spin: 0.9, w: 1.4, spike: 0.18 },
    { prim: 'glyphs', r: 0.9, n: 8, size: 0.13, spin: -0.5, blink: 0.5 },
    { prim: 'pillar', r: 0.5, count: 2, h: 2.8, w: 1.1, taper: 0.3, flicker: 0.5 }
  ], { seed: 2104 });
  R('sigil_snare', 'ground', [
    { prim: 'ring', r: 1, style: 'solid', count: 48, w: 0.8, spin: 0.6 },
    { prim: 'poly', r: 0.7, n: 3, step: 1, spin: -1.2, w: 1.2 },
    { prim: 'spokes', rIn: 0.05, rOut: 0.95, n: 6, w: 0.5, jitter: 0.08 }
  ], { seed: 2105 });
  R('sigil_lava_pool', 'ground', [
    { prim: 'ring', r: 1, style: 'dots', count: 32, spin: 0.22, w: 1.2 },
    { prim: 'vortex', rTop: 0.9, rBot: 0.2, layers: 4, h: 0.5, count: 40, spin: 0.7, alpha: 0.8 },
    { prim: 'sweep', r: 0.95, span: 0.6, speed: 1.2, w: 1.3, alpha: 0.9 }
  ], { seed: 2106 });

  /* ==========================================================
     ↓ 2026-10-16 第二批编排：把上面那些原子类真正"组合"成有名字的阵式。
     参照 research/magic-circles/ 的指令法阵与铁魔法，每张都注明它想还原的观感。
     预算纪律（真机 160FPS 的口径，渲染层按点数花钱）：一条配方 ≤10 层、
     单环 count ≤96、旋涡 layers ≤8；tools/vfx_check.cjs 第 11 组会逐条卡这条上限。
     ========================================================== */

  /* ---------- 14. 执政官大阵：十层里每层各转各的（指令法阵里"大阵"那一档） ----------
     外圈刻度齿走得慢、内圈反着快转，中间出头七芒星 + 一根不随风的高柱压住重心。 */
  R('archon_seal', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 96, w: 1.2, spin: 0.18, flow: 1.2, draw: 1 },
    { prim: 'ring', r: 0.95, style: 'dots', count: 48, spin: -0.42, tilt: 0.14, draw: 1 },
    { prim: 'ring', r: 0.78, style: 'solid', count: 80, w: 0.7, spin: 0.7, tilt: -0.26, draw: 1 },
    { prim: 'ring', r: 0.62, style: 'ticks', count: 28, spin: -1.15, tilt: 0.4 },
    { prim: 'poly', r: 0.55, n: 7, step: 2, spike: 0.42, spin: 0.3, w: 1.1 },
    { prim: 'poly', r: 0.34, n: 3, step: 1, spin: -0.85, w: 0.9 },
    { prim: 'glyphs', r: 0.88, n: 16, size: 0.1, spin: -0.26, blink: 0.35 },
    { prim: 'orbit', r: 0.46, n: 5, size: 0.11, spin: 1.35, tilt: 0.22 },
    { prim: 'pillar', r: 0, count: 1, h: 3.6, w: 1.8, taper: 0.12, flicker: 0.22 },
    { prim: 'vortex', rTop: 0.45, rBot: 0.08, layers: 6, h: 1.4, count: 44, spin: -2.1, alpha: 0.85 }
  ], { seed: 1414 });

  /* ---------- 15. 浑天轮：同一半径画两圈镜像倾角 = 一只机械陀螺 ----------
     观感来自"环互相穿过去"，比多画几圈同心环值钱得多，代价是零额外层数概念。 */
  R('orrery_wheel', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 64, w: 1, spin: 0.25, flow: 0.8, draw: 1 },
    { prim: 'ring', r: 0.9, style: 'solid', count: 72, w: 0.8, spin: -0.5, tilt: 0.55, draw: 1 },
    { prim: 'ring', r: 0.88, style: 'solid', count: 72, w: 0.8, spin: 0.5, tilt: -0.55, draw: 1 },
    { prim: 'ring', r: 0.7, style: 'dots', count: 32, spin: 0.9, tilt: 1.0 },
    { prim: 'ring', r: 0.68, style: 'dots', count: 32, spin: -0.9, tilt: -1.0 },
    { prim: 'ring', r: 0.42, style: 'solid', count: 48, w: 0.9, spin: 1.4, tilt: 0.2 },
    { prim: 'orbit', r: 0.42, n: 3, size: 0.13, spin: 1.9 },
    { prim: 'poly', r: 0.24, n: 4, step: 1, spin: -1.2, w: 0.8 }
  ], { seed: 1515 });

  /* ---------- 16. 混沌晶格：九芒星 + 抖动放射线 + 两把反向扫掠弧 ----------
     不给它任何"整齐"的东西：jitter 0.22、flicker 0.35、两条速度不同的弧，
     看一眼就知道这不是同一位神写的阵。 */
  R('chaos_lattice', 'ground', [
    { prim: 'spokes', rIn: 0.15, rOut: 1.15, n: 22, w: 0.5, jitter: 0.22, spin: 0.35, draw: 1 },
    { prim: 'poly', r: 0.9, n: 9, step: 4, spike: 0.55, spin: -0.55, w: 1, draw: 1 },
    { prim: 'ring', r: 1, style: 'dots', count: 36, w: 0.8, spin: 0.8, flicker: 0.35 },
    { prim: 'sweep', r: 0.72, a0: 0, span: 0.8, speed: 3.2, w: 1.1 },
    { prim: 'sweep', r: 0.52, a0: 2.2, span: 0.55, speed: -4.4, w: 0.8 },
    { prim: 'glyphs', r: 0.3, n: 6, size: 0.14, spin: 1.6, blink: 0.6 },
    { prim: 'pillar', r: 0.85, count: 3, h: 2.4, w: 0.5, taper: 0.35, flicker: 0.6, rise: 1.6 }
  ], { seed: 1616 });

  /* ---------- 17. 新星冠冕：呼吸幅度递增的一圈火冠 ----------
     pulse 从外到内 0.06 / 0.12，两圈不同步地胀缩；八根柱同时往上冒（rise）。 */
  R('nova_crown', 'ground', [
    { prim: 'ring', r: 1, style: 'solid', count: 96, w: 1.1, spin: 0.14, pulse: 0.06, pulseHz: 2.2, draw: 1 },
    { prim: 'ring', r: 0.84, style: 'dots', count: 44, spin: -0.75, pulse: 0.12, pulseHz: 3.4, draw: 1 },
    { prim: 'spokes', rIn: 0.5, rOut: 1, n: 16, w: 0.45, jitter: 0.12, spin: 0.5 },
    { prim: 'pillar', r: 0.8, count: 8, h: 2.9, w: 0.55, taper: 0.42, flicker: 0.45, rise: 2.2 },
    { prim: 'poly', r: 0.44, n: 5, step: 2, spin: 1.05, spike: 0.3, w: 1.2 },
    { prim: 'glyphs', r: 0.62, n: 10, size: 0.1, spin: -0.4, blink: 0.4 },
    { prim: 'vortex', rTop: 0.2, rBot: 0.62, layers: 5, h: 1.9, count: 32, spin: 1.7, alpha: 0.8 }
  ], { seed: 1717 });

  /* ---------- 18. 五芒门：两根门柱 + 一道慢慢扫过的楣 ---------- */
  R('pentacle_gate', 'ground', [
    { prim: 'poly', r: 0.88, n: 5, step: 2, spike: 0.5, spin: 0.2, w: 1.3, draw: 1 },
    { prim: 'ring', r: 1, style: 'ticks', count: 72, w: 1, spin: -0.28, flow: 1.1, draw: 1 },
    { prim: 'ring', r: 0.3, style: 'dots', count: 18, w: 0.9, spin: 1.6 },
    { prim: 'glyphs', r: 0.72, n: 8, size: 0.12, spin: 0.3, blink: 0.3 },
    { prim: 'pillar', r: 0.86, count: 2, h: 3, w: 0.9, taper: 0.2, flicker: 0.3 },
    { prim: 'sweep', r: 0.95, a0: 0, span: 0.55, speed: 1.6, w: 1.4 }
  ], { seed: 1818 });

  /* ---------- 19. 虚空漩涡：漏斗倒扣下来，八层、每层自己收口 ---------- */
  R('void_maelstrom', 'ground', [
    { prim: 'vortex', rTop: 1.05, rBot: 0.03, layers: 8, h: 2.2, count: 48, spin: 2.4, draw: 1 },
    { prim: 'ring', r: 0.9, style: 'ticks', count: 40, w: 0.9, spin: -1.3, flow: 2.2, draw: 1 },
    { prim: 'ring', r: 0.6, style: 'dots', count: 24, spin: 2, tilt: 0.35 },
    { prim: 'spokes', rIn: 0.05, rOut: 0.95, n: 7, w: 0.7, jitter: 0.3, spin: -0.8 },
    { prim: 'poly', r: 0.5, n: 3, step: 1, spin: 1.5, w: 1, spike: 0.2 },
    { prim: 'orbit', r: 1.15, n: 2, size: 0.14, spin: 0.55, tilt: 0.25 }
  ], { seed: 1919 });

  /* ---------- 20. 元素反应的一次性反馈（GW.CHEM 只报 key，画什么在这张表里） ----------
     为什么值得单独画：玩家把火扔到树上是"主动做了什么"，0.4 秒内必须看到东西回应他。
     这些配方 ttl 都很短（渲染层按 0.5~0.9s 播完就回收），层数少、点数小。 */
  R('ev_react_ignite', 'ground', [
    { prim: 'pillar', r: 0.42, count: 3, h: 1.5, w: 0.7, taper: 0.5, flicker: 0.7, rise: 2.2 },
    { prim: 'ring', r: 0.8, style: 'dots', count: 14, w: 0.9, spin: 2.8 },
    { prim: 'sweep', r: 0.95, a0: 0, span: 1.2, speed: 5, w: 1, alpha: 0.85 }
  ], { seed: 2001, igniteWindow: 0.1 });
  R('ev_react_steam', 'body', [
    { prim: 'vortex', rTop: 0.55, rBot: 0.16, layers: 4, h: 1.2, count: 22, spin: 1.4, alpha: 0.7 },
    { prim: 'ring', r: 0.62, style: 'dots', count: 12, w: 0.6, spin: 0.9, tilt: 0.5, alpha: 0.8 }
  ], { seed: 2002, igniteWindow: 0.14 });
  R('ev_react_freeze', 'ground', [
    { prim: 'poly', r: 0.7, n: 6, step: 1, spin: 0.8, w: 1.2, draw: 1 },
    { prim: 'pillar', r: 0.55, count: 4, h: 0.9, w: 0.4, taper: 0.15, flicker: 0.2 },
    { prim: 'ring', r: 0.9, style: 'ticks', count: 18, w: 0.8, spin: -1.4 }
  ], { seed: 2003, igniteWindow: 0.12 });
  R('ev_react_melt', 'ground', [
    { prim: 'ring', r: 0.75, style: 'solid', count: 32, w: 0.9, spin: 0.4, pulse: 0.3, pulseHz: 4, draw: 1 },
    { prim: 'spokes', rIn: 0.1, rOut: 0.7, n: 9, w: 0.5, jitter: 0.2 }
  ], { seed: 2004, igniteWindow: 0.16 });
  R('ev_react_ash', 'ground', [
    { prim: 'spokes', rIn: 0.1, rOut: 1, n: 12, w: 0.5, jitter: 0.35, spin: 0.4 },
    { prim: 'ring', r: 0.68, style: 'dots', count: 18, w: 0.7, spin: 1.2, alpha: 0.85 }
  ], { seed: 2005, igniteWindow: 0.14 });
  R('ev_react_obsidian', 'ground', [
    { prim: 'poly', r: 0.75, n: 4, step: 1, spin: 0.9, w: 1.4, draw: 1 },
    { prim: 'ring', r: 0.95, style: 'solid', count: 40, w: 1, spin: -0.6, draw: 1 },
    { prim: 'spokes', rIn: 0.2, rOut: 0.9, n: 6, w: 0.6, jitter: 0.12 }
  ], { seed: 2006, igniteWindow: 0.1 });

  /* ---------- 21. 分元素的抛射物拖尾（小球本身也要有"这是什么系"的读感） ---------- */
  R('shard_spin', 'body', [
    { prim: 'ring', r: 0.9, style: 'dots', count: 14, w: 0.7, spin: 3 },
    { prim: 'sweep', r: 0.6, a0: 0, span: 0.8, speed: 7, w: 1, alpha: 0.7 },
    { prim: 'poly', r: 0.5, n: 3, step: 1, spin: -2.2, w: 0.6 }
  ], { seed: 2121 });
  R('void_spiral', 'body', [
    { prim: 'vortex', rTop: 0.5, rBot: 0.08, layers: 3, h: 0.8, count: 18, spin: 3.4, alpha: 0.8 },
    { prim: 'ring', r: 0.72, style: 'ticks', count: 12, w: 0.7, spin: -2.6 }
  ], { seed: 2122 });

  /* ==========================================================
     ↓ 2026-10-17 第三批：大招 / 大建造 / 飞行召唤。
     用户的原话是"缺一些比较爽的元素、毁天灭地的大招爆炸系"，那三个字落到画面上是
     **体积 + 数量 + 层次**：罩子（dome）给体量，螺旋（helix）给运动，碎屑（shards）给"炸开了"。
     单条仍守 ≤14 层 / 单层 ≤96 点的预算（vfx_check 第 9 组）。
     ========================================================== */

  /* ---------- 22. 灭世天陨：大招阵本体（11 层 / 7 类原子） ----------
     罩子压住半张地图、三根螺旋往里吸、十二根火柱从阵里长出来。
     这一档故意不"整齐"：外圈反着走、内圈快转，看一秒就知道这不是普通法阵。 */
  R('cataclysm_seal', 'ground', [
    { prim: 'dome', r: 1.05, lat: 5, lon: 16, w: 1.2, spin: 0.34, squash: 0.62, draw: 1 },
    { prim: 'ring', r: 1, style: 'ticks', count: 96, w: 1.3, spin: -0.22, flow: 1.6, draw: 1 },
    { prim: 'ring', r: 0.92, style: 'dots', count: 52, spin: 0.55, tilt: 0.22, draw: 1 },
    { prim: 'poly', r: 0.78, n: 7, step: 3, spike: 0.52, spin: -0.4, w: 1.2 },
    { prim: 'poly', r: 0.5, n: 3, step: 1, spin: 0.9, w: 0.9 },
    { prim: 'helix', r: 0.86, n: 3, turns: 1.6, count: 26, h: 3.4, taper: 0.82, w: 0.9, spin: 2.2, rise: 1.4 },
    { prim: 'pillar', r: 0.9, count: 12, h: 4.6, w: 0.9, taper: 0.55, flicker: 0.6, rise: 2.6 },
    { prim: 'spokes', rIn: 0.1, rOut: 1.2, n: 24, w: 0.5, jitter: 0.18, spin: 0.3 },
    { prim: 'glyphs', r: 0.86, n: 18, size: 0.1, spin: -0.3, blink: 0.4 },
    { prim: 'vortex', rTop: 0.9, rBot: 0.06, layers: 8, h: 2.4, count: 48, spin: -2.4, alpha: 0.9 },
    { prim: 'orbit', r: 0.62, n: 6, size: 0.12, spin: 1.8, tilt: 0.3 },
    /* 法阵外圈的法针（2026-10-17）：sat 把 child 复制 6 份摆在半径 1.18 的圆上，
       整圈再以 0.5 rad/s 绕竖轴转——一行数据，不需要为它写任何代码。 */
    { sat: { n: 6, radius: 1.18, spin: 0.5, tiltX: 0.35 }, child: { prim: 'spokes', rIn: 0.02, rOut: 0.26, n: 3, w: 0.9, spin: -2.2, weight: 0.7 } },
    { sat: { n: 3, radius: 0.42, y: 1.6, spin: -0.9 }, child: { prim: 'ring', r: 0.1, style: 'ticks', count: 12, w: 0.8, spin: 3, weight: 0.5 } }
  ], { seed: 2201, budget: 44 });

  /* ---------- 23. 陨星砸地：一次性冲击（dome 起爆 + 碎屑 + 四根火舌） ---------- */
  R('ev_meteor_impact', 'ground', [
    { prim: 'dome', r: 1.15, lat: 4, lon: 14, w: 1.4, spin: 0.6, squash: 0.55, draw: 1 },
    { prim: 'ring', r: 1, style: 'solid', count: 80, w: 1.6, spin: 0, pulse: 0.4, pulseHz: 5 },
    { prim: 'shards', r: 1.6, n: 28, core: 0.15, size: 0.62, squash: 0.7, spin: 1.2 },
    { prim: 'spokes', rIn: 0.12, rOut: 1.25, n: 18, w: 0.7, jitter: 0.24 },
    { prim: 'pillar', r: 0.5, count: 4, h: 2.2, w: 0.7, taper: 0.6, flicker: 0.7, rise: 3.2 },
    { prim: 'helix', r: 0.7, n: 2, turns: 1.1, count: 18, h: 1.6, taper: 0.9, w: 0.7, spin: 3 }
  ], { seed: 2202, igniteWindow: 0.1 });

  /* ---------- 24. 超新星：整屏一层白浪 ----------
     两层竖起来的冲击环（tilt = ±π/2，2026-10-17 才允许平面层立直）+ 碎屑壳，
     这层的用意是"把画面推满"——60 帧内它要盖过屏幕边缘。 */
  /* 2026-10-17 架构重排后的第一张"组合出来"的大招：
     外层是**完整球体**（上下对称，不是贴地的半罩），里面套一颗反着转的小球，
     球面上再用 sat 挂 8 片小三角当碎壳——全是原子 + 组节点的组合，
     没有一行代码是为"超新星"特判的。 */
  R('ev_supernova', 'ground', [
    { prim: 'sphere', r: 1.1, lat: 6, lon: 14, w: 1.6, spin: 0.6, draw: 1, weight: 4, color: '#ffffff', color2: '#ff0050' },
    { prim: 'sphere', r: 0.66, lat: 4, lon: 9, w: 1.2, spin: -1.4, weight: 2, color: '#00ffff', color2: '#ff00a8' },
    { prim: 'ring', r: 1, style: 'solid', count: 96, w: 1.8, spin: 1.1, pulse: 0.5, pulseHz: 6, weight: 3, color: '#fff2b0', color2: '#ff0050' },
    { sat: { n: 8, radius: 1.15, spin: 1.6 }, child: { prim: 'poly', r: 0.12, n: 3, step: 1, w: 0.9, spin: -3, weight: 0.6, color: '#ffe600', color2: '#ff0050' } },
    { prim: 'shards', r: 2.1, n: 30, core: 0.1, size: 0.6, squash: 0.75, spin: 2.2, weight: 1, color: '#ffffff', color2: '#ff0050' },
    { prim: 'spokes', rIn: 0.08, rOut: 1.35, n: 18, w: 0.8, jitter: 0.3, spin: 0.8, weight: 1, color: '#ffe600', color2: '#ff0050' }
  ], { seed: 2203, igniteWindow: 0.12, budget: 40 });

  /* ---------- 25. 裂地：竖起来的地环 + 碎屑（地震卡） ---------- */
  R('ev_quake', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 56, w: 1.4, tilt: 1.5708, spin: 3.6 },
    { prim: 'ring', r: 0.92, style: 'solid', count: 72, w: 1.2, spin: 0, pulse: 0.35, pulseHz: 4 },
    { prim: 'shards', r: 1.8, n: 24, core: 0.2, size: 0.55, squash: 0.35, spin: 0.9 },
    { prim: 'spokes', rIn: 0.1, rOut: 1.15, n: 16, w: 0.6, jitter: 0.32 },
    { prim: 'poly', r: 0.7, n: 4, step: 1, spike: 0.6, spin: 0.5, w: 1 }
  ], { seed: 2204, igniteWindow: 0.1 });

  /* ---------- 26. 墙体升起 / 桥面抛出：建造的两档即时反馈 ---------- */
  R('ev_raise_wall', 'ground', [
    { prim: 'pillar', r: 1, count: 9, h: 3.2, w: 0.8, taper: 0.25, flicker: 0.35, rise: 4.5 },
    { prim: 'ring', r: 1, style: 'ticks', count: 40, w: 1, spin: 0.8, flow: 2 },
    { prim: 'spokes', rIn: 0.15, rOut: 1, n: 10, w: 0.5, jitter: 0.1 },
    { prim: 'shards', r: 1.3, n: 16, core: 0.3, size: 0.4, squash: 0.5, spin: 0.6 }
  ], { seed: 2205, igniteWindow: 0.12 });
  R('ev_bridge', 'ground', [
    { prim: 'sweep', r: 1, a0: 0, span: 1.6, speed: 4, w: 1.2 },
    { prim: 'sweep', r: 0.72, a0: 2.4, span: 1.2, speed: -5, w: 0.9 },
    { prim: 'ring', r: 0.9, style: 'dots', count: 22, w: 0.9, spin: 1.2 },
    { prim: 'helix', r: 0.5, n: 2, turns: 0.8, count: 12, h: 1.2, taper: 0.8, w: 0.6, spin: 4 }
  ], { seed: 2206, igniteWindow: 0.1 });

  /* ---------- 27. 飞行随从的光环（body 锚点，挂身体中心） ----------
     地面随从是"脚下有圈"，飞行体必须是"整个人裹在光里"，否则看着像飘在别的什么东西上面。 */
  R('aura_void_wisp', 'body', [
    { prim: 'dome', r: 0.62, lat: 3, lon: 10, w: 0.9, spin: 1.6, squash: 0.85, color: '#ff00a8', color2: '#a020ff' },
    { prim: 'helix', r: 0.52, n: 2, turns: 1.2, count: 16, h: 1.1, taper: 0.9, w: 0.7, spin: 3.4, rise: 1.6, color: '#00ffff', color2: '#a020ff' },
    { prim: 'orbit', r: 0.7, n: 5, size: 0.14, spin: 2.6, tilt: 0.4, color: '#a020ff', color2: '#ffffff' },
    { prim: 'ring', r: 0.44, style: 'dots', count: 12, w: 0.8, spin: -2.2, tilt: 1.1, color: '#00ffff', color2: '#ff00a8' }
  ], { seed: 2301 });
  R('aura_hawk', 'body', [
    { prim: 'sweep', r: 0.85, a0: 0.6, span: 1.1, speed: 3.2, w: 1.2 },
    { prim: 'sweep', r: 0.85, a0: 3.3, span: 1.1, speed: -3.2, w: 1.2 },
    { prim: 'ring', r: 0.9, style: 'ticks', count: 18, w: 0.7, spin: 2.4, tilt: 1.3 },
    { prim: 'helix', r: 0.42, n: 2, turns: 1.4, count: 14, h: 1.4, taper: 0.7, w: 0.6, spin: -3.8 },
    { prim: 'shards', r: 0.7, n: 10, core: 0.4, size: 0.3, squash: 0.8, spin: 1.4 }
  ], { seed: 2302 });
  R('aura_bee', 'body', [
    { prim: 'ring', r: 0.38, style: 'dots', count: 14, w: 0.9, spin: 4.2, tilt: 0.6 },
    { prim: 'orbit', r: 0.46, n: 3, size: 0.1, spin: -5 },
    { prim: 'shards', r: 0.5, n: 8, core: 0.5, size: 0.22, squash: 0.9, spin: 3 }
  ], { seed: 2303 });

  /* ---------- 28. 陨星本体的拖尾（比普通火弹粗一档，带一圈碎屑） ---------- */
  R('meteor_trail', 'body', [
    { prim: 'dome', r: 0.55, lat: 2, lon: 8, w: 1.2, spin: 3, squash: 0.9 },
    { prim: 'helix', r: 0.42, n: 2, turns: 1.6, count: 14, h: 1.2, taper: 0.4, w: 1, spin: 6, rise: 3 },
    { prim: 'shards', r: 0.6, n: 12, core: 0.2, size: 0.3, squash: 0.8, spin: 4 },
    { prim: 'ring', r: 0.7, style: 'dots', count: 14, w: 0.8, spin: 4.5 }
  ], { seed: 2304 });

  /* ---------- 29. 大招法阵（陨星雨）：每秒都在往外吐火的阵 ---------- */
  R('sigil_cataclysm', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 88, w: 1.2, spin: 0.3, flow: 1.8, draw: 1 },
    { prim: 'poly', r: 0.86, n: 7, step: 3, spike: 0.58, spin: -0.5, w: 1.3, draw: 1 },
    { prim: 'dome', r: 0.92, lat: 4, lon: 14, w: 1, spin: -0.9, squash: 0.5 },
    { prim: 'helix', r: 0.8, n: 3, turns: 1.3, count: 22, h: 3, taper: 0.85, w: 0.8, spin: 2.6, rise: 2 },
    { prim: 'pillar', r: 0.88, count: 8, h: 3.4, w: 0.8, taper: 0.5, flicker: 0.55, rise: 2.4 },
    { prim: 'glyphs', r: 0.72, n: 14, size: 0.1, spin: 0.4, blink: 0.45 },
    { prim: 'orbit', r: 0.55, n: 4, size: 0.11, spin: 2.1, tilt: 0.25 }
  ], { seed: 2305 });

  /* ==========================================================
     ↓ 2026-10-17 第四批：核弹级 / 超阶仪式 / 烟花灵光。
     "超阶魔法"那种观感的拆法是：**先铺满足够多的阵，再给一个收束的瞬间**——
     所以这里有一整套 ritual_a/b/c/core（三种不同语汇的外阵 + 一个中心主阵），
     时间轴交给 cards.js 的 delay 错开，画面自然就是"次第点亮"。
     ========================================================== */

  /* ---------- 30. 终末：金白色的审判环（核弹级那张） ---------- */
  R('sigil_terminus', 'ground', [
    { prim: 'dome', r: 1.12, lat: 6, lon: 20, w: 1.6, spin: 0.22, squash: 0.72, draw: 1, color: '#ffe600', color2: '#ff0050' },
    { prim: 'ring', r: 1, style: 'ticks', count: 96, w: 1.6, spin: -0.3, flow: 2.4, draw: 1, color: '#ffffff', color2: '#ffe600' },
    { prim: 'ring', r: 0.9, style: 'solid', count: 96, w: 1.2, spin: 0.45, tilt: 1.5708, color: '#ff0050', color2: '#ffe600' },
    { prim: 'poly', r: 0.8, n: 7, step: 3, spike: 0.62, spin: 0.35, w: 1.4, color: '#ffe600', color2: '#ff0050' },
    { prim: 'helix', r: 0.95, n: 4, turns: 1.2, count: 26, h: 6.5, taper: 0.92, w: 1, spin: 1.6, rise: 3, color: '#ff0050', color2: '#ffffff' },
    { prim: 'pillar', r: 0.94, count: 16, h: 7.5, w: 0.9, taper: 0.7, flicker: 0.5, rise: 3.2, color: '#ffffff', color2: '#ffe600' },
    { prim: 'glyphs', r: 0.86, n: 24, size: 0.1, spin: -0.5, blink: 0.5, color: '#ffe600', color2: '#ff0050' },
    { prim: 'vortex', rTop: 1.05, rBot: 0.05, layers: 8, h: 3.2, count: 48, spin: -2.8, alpha: 0.9, color: '#ff0050', color2: '#ffe600' },
    { prim: 'shards', r: 1.4, n: 26, core: 0.9, size: 0.5, squash: 0.5, spin: 1.4, color: '#ffffff', color2: '#ffe600' }
  ], { seed: 2401 });

  /* ---------- 31. 超阶仪式的三层外阵：三种完全不同的语汇 ---------- */
  /* 十几座阵会**互相叠加**：additive 下每座各烧一点，叠起来就是一片白（截图自查抓到的）。
     所以外阵只留 3 层、透明度压到 0.72——数量本身已经在说"这是大仪式"，
     不需要每一座都自带全套细节。 */
  R('sigil_ritual_a', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 64, w: 1.1, spin: 0.24, flow: 1.4, draw: 1, alpha: 0.72 },
    { prim: 'poly', r: 0.86, n: 7, step: 2, spike: 0.4, spin: -0.3, w: 1, draw: 1, alpha: 0.72 },
    { prim: 'glyphs', r: 0.7, n: 10, size: 0.1, spin: 0.6, blink: 0.45, alpha: 0.7 }
  ], { seed: 2402 });
  R('sigil_ritual_b', 'ground', [
    { prim: 'ring', r: 1, style: 'dots', count: 36, w: 1, spin: -0.5, draw: 1, alpha: 0.72 },
    { prim: 'poly', r: 0.78, n: 6, step: 2, spike: 0.34, spin: 0.5, w: 1.1, draw: 1, alpha: 0.72 },
    { prim: 'orbit', r: 0.9, n: 4, size: 0.12, spin: 1.9, tilt: 0.25, alpha: 0.72 }
  ], { seed: 2403 });
  R('sigil_ritual_c', 'ground', [
    { prim: 'poly', r: 0.92, n: 4, step: 1, spin: 0.9, w: 1.2, draw: 1, alpha: 0.75 },
    { prim: 'ring', r: 0.62, style: 'ticks', count: 20, w: 0.9, spin: -1.6, flow: 3, alpha: 0.75 },
    { prim: 'glyphs', r: 0.4, n: 6, size: 0.12, spin: 2.2, blink: 0.6, alpha: 0.75 }
  ], { seed: 2404 });
  /* 主阵：整条仪式收束的地方——两层罩子 + 反向旋涡 + 十二根光柱互相对撞 */
  R('sigil_ritual_core', 'ground', [
    { prim: 'dome', r: 1, lat: 5, lon: 18, w: 1.5, spin: -0.4, squash: 0.8, draw: 1 },
    { prim: 'ring', r: 1, style: 'solid', count: 96, w: 1.7, spin: 1.1, pulse: 0.3, pulseHz: 3.4 },
    { prim: 'ring', r: 0.82, style: 'ticks', count: 72, w: 1.3, spin: -2.2, tilt: 1.5708 },
    { prim: 'poly', r: 0.7, n: 7, step: 3, spike: 0.6, spin: 0.6, w: 1.4 },
    { prim: 'vortex', rTop: 0.2, rBot: 1.15, layers: 8, h: 4.2, count: 48, spin: 3.6 },
    { prim: 'vortex', rTop: 1.15, rBot: 0.15, layers: 6, h: 3.4, count: 40, spin: -3.2, alpha: 0.85 },
    { prim: 'pillar', r: 0.86, count: 12, h: 5.6, w: 0.9, taper: 0.45, flicker: 0.55, rise: 2.8 },
    { prim: 'shards', r: 1.2, n: 24, core: 0.5, size: 0.4, squash: 0.8, spin: 2.6 }
  ], { seed: 2405 });

  /* ---------- 31b. 黑洞：紫 / 洋红 / 电光青三层对撞 + 纯白奇点 ----------
     用户的原话："吸附一切的黑洞应该是紫色的，但紫色之中可以用色偏的极端 RGB 纯色"。
     做法不是把整条配方染紫，而是**每层各给一个极端色**：外箍洋红、内环电光青、中心纯白。
     additive 叠加时相邻两条边会互相"咬"，看起来就是色偏/撕裂，而不是一圈温吞的淡紫。 */
  R('sigil_black_hole', 'ground', [
    { prim: 'dome', r: 1, lat: 5, lon: 14, w: 1.5, spin: -0.5, squash: 0.9, color: '#ff00a8', color2: '#a020ff', draw: 1 },
    { prim: 'vortex', rTop: 1.05, rBot: 0.04, layers: 8, h: 3.4, count: 48, spin: -3.4, color: '#a020ff', color2: '#00ffff' },
    { prim: 'ring', r: 1, style: 'ticks', count: 72, w: 1.2, spin: 0.5, flow: 3.2, color: '#ff00a8', color2: '#ffffff' },
    { prim: 'ring', r: 0.62, style: 'solid', count: 64, w: 1.1, spin: -1.8, tilt: 0.5, color: '#00ffff', color2: '#a020ff' },
    { prim: 'poly', r: 0.42, n: 3, step: 1, spin: 2.4, w: 1.3, color: '#ffffff', color2: '#ff00a8' },
    { prim: 'orbit', r: 0.86, n: 6, size: 0.12, spin: -2.6, tilt: 0.3, color: '#00ffff', color2: '#ffffff' },
    { prim: 'shards', r: 1.25, n: 24, core: 0.6, size: 0.3, squash: 0.8, spin: 1.6, color: '#ff00a8', color2: '#a020ff' }
  ], { seed: 2410 });

  /* ---------- 32. 爆点与灵光（烟花的两端） ---------- */
  /* 核爆那一帧（第一版 lon 24 的罩子在 14 格半径下变成罩住半个屏幕的线笼子，截图看得很清楚）：
     收成"贴地的一团"——罩子只到 0.8、经线 10 条，主体换成向上的火柱与碎屑，
     读感是"从地面炸起来"，不是"天上扣了个球"。 */
  R('ev_nuke', 'ground', [
    { prim: 'sphere', r: 0.95, lat: 6, lon: 12, w: 1.8, spin: 0.5, draw: 1, weight: 4, color: '#ffffff', color2: '#ffe600' },
    { prim: 'ring', r: 1, style: 'solid', count: 96, w: 2, spin: 0.9, pulse: 0.5, pulseHz: 5 },
    { prim: 'ring', r: 0.62, style: 'ticks', count: 48, w: 1.4, tilt: 1.5708, spin: -3.2 },
    { prim: 'shards', r: 1.6, n: 34, core: 0.05, size: 0.5, squash: 0.9, spin: 2.4 },
    { prim: 'vortex', rTop: 1.1, rBot: 0.08, layers: 6, h: 3.6, count: 40, spin: 4.2 },
    { prim: 'pillar', r: 0.55, count: 10, h: 4.6, w: 1.1, taper: 0.7, flicker: 0.7, rise: 4 },
    { prim: 'helix', r: 0.9, n: 3, turns: 1.2, count: 18, h: 4.2, taper: 0.9, w: 1, spin: 3.4 },
    { prim: 'spokes', rIn: 0.1, rOut: 1.15, n: 18, w: 0.6, jitter: 0.35, spin: 0.6 }
  ], { seed: 2406, igniteWindow: 0.12 });
  R('ev_firework', 'ground', [
    { prim: 'shards', r: 1.5, n: 30, core: 0.05, size: 0.34, squash: 0.95, spin: 3 },
    { prim: 'ring', r: 0.7, style: 'dots', count: 18, w: 0.8, spin: 4.2 },
    { prim: 'spokes', rIn: 0.05, rOut: 0.9, n: 10, w: 0.4, jitter: 0.4 },
    { prim: 'helix', r: 0.6, n: 2, turns: 0.8, count: 12, h: 0.9, taper: 0.3, w: 0.6, spin: 6 }
  ], { seed: 2407, igniteWindow: 0.08 });
  /* 灵光本体的拖尾：细、亮、旋转的小点（"很细小、满天飞"的那一档） */
  R('spirit_trail', 'body', [
    { prim: 'shards', r: 0.4, n: 10, core: 0.25, size: 0.22, squash: 0.9, spin: 5, color: '#ffffff', color2: '#00ffff' },
    { prim: 'ring', r: 0.3, style: 'dots', count: 8, w: 0.7, spin: 6, tilt: 0.8, color: '#ff00a8', color2: '#00ffff' },
    { prim: 'orbit', r: 0.34, n: 2, size: 0.08, spin: -6, color: '#a020ff', color2: '#00ffff' }
  ], { seed: 2408 });

  /* 出招 / 命中 / 死亡的一次性事件（渲染层订阅；权威层只报 key） */
  R('ev_cast', 'ground', [
    { prim: 'ring', r: 1, style: 'solid', count: 64, w: 1, spin: 1.4, pulse: 0.25, pulseHz: 6 },
    { prim: 'spokes', rIn: 0.15, rOut: 0.9, n: 10, w: 0.6, jitter: 0.1 }
  ], { seed: 3101, igniteWindow: 0.12 });
  R('ev_hit', 'ground', [
    { prim: 'ring', r: 1, style: 'ticks', count: 24, spin: 3, w: 1.2 },
    { prim: 'orbit', r: 0.8, n: 6, size: 0.09, spin: 3.2 }
  ], { seed: 3102, igniteWindow: 0.1 });
  R('ev_break', 'ground', [
    { prim: 'poly', r: 0.9, n: 6, step: 2, spike: 0.6, spin: 1.8, w: 1.1 },
    { prim: 'ring', r: 1, style: 'dots', count: 20, spin: -2.4 }
  ], { seed: 3103, igniteWindow: 0.14 });

  /* ---------- 绑定表：三档颗粒度，从"具体某张卡"到"整个卡种" ----------
     渲染层只调 G.VFX.frameOf(entity, time, dt, role)，查表顺序在 vfx.js 的 defaultFor 里：
       卡 id（CBI，最具体）→ 元素（CBE，流派手感）→ 卡种（CF，兜底）。
     权威层从头到尾不出现配方名：它只在数据里带 card / kind / element。 */
  V.CARD_FX = {
    sigil: { cast: 'ev_cast', loop: null },
    spell: { cast: 'ev_cast', hit: 'ev_hit' },
    terrain: { cast: 'ev_cast', impact: 'impact_burst' },
    summon: { cast: 'ev_cast', aura: 'summon_aura' },
    utility: { cast: 'ev_cast' }
  };
  /* 元素手感：出招那一瞬间脚下亮什么阵。同一张卡打在不同元素上，读感就该不一样。 */
  V.CARD_FX_EL = {
    fire: { cast: 'fire_tri', hit: 'impact_burst', impact: 'ev_react_ignite' },
    ice: { cast: 'triangle_rune', hit: 'ev_react_freeze', impact: 'ev_react_freeze' },
    rock: { cast: 'hexagram', hit: 'impact_burst', impact: 'ev_break' },
    nature: { cast: 'starburst_ground', hit: 'ev_hit', impact: 'ev_react_melt' },
    void: { cast: 'chaos_lattice', hit: 'ev_hit', impact: 'ev_break' },
    neutral: { cast: 'circle_basic', hit: 'ev_hit' }
  };
  /* 具体卡：只有"值得有一套自己的阵"的招牌卡进这张表，别把 56 张卡都排一遍——
     那会让每张卡都在抢画面，也会让配方库变成没人敢删的坟场。 */
  V.CARD_BY_ID_FX = {
    meteors: { cast: 'archon_seal' },
    glacier: { cast: 'orrery_wheel' },
    rune_hammer: { cast: 'chaos_lattice' },
    phoenix: { cast: 'nova_crown' },
    golem: { cast: 'pentacle_gate' },
    frost_nova: { cast: 'orrery_wheel' },
    hail: { cast: 'triangle_rune' },
    blink: { cast: 'void_maelstrom' },
    cinder_dash: { cast: 'fire_tri' },
    overgrow: { cast: 'starburst_ground' },
    lava: { cast: 'nova_crown' },
    obsidian_cage: { cast: 'hexagram' },
    bloom_field: { cast: 'sigil_bloom' },
    /* 2026-10-17 第三批：大招 / 大建造 / 飞行召唤的招牌阵 */
    meteor_rain: { cast: 'cataclysm_seal' },
    black_hole: { cast: 'sigil_black_hole' },
    supernova: { cast: 'cataclysm_seal' },
    void_collapse: { cast: 'void_maelstrom' },
    earthsplit: { cast: 'chaos_lattice' },
    bastion: { cast: 'pentacle_gate' },
    fortress: { cast: 'archon_seal' },
    bridge: { cast: 'ev_bridge' },
    wisp_swarm: { cast: 'void_maelstrom' },
    storm_hawk: { cast: 'starburst_ground' },
    swarm_bomb: { cast: 'fire_tri' },
    phoenix: { cast: 'nova_crown' }
  };
  /* 卡 id → 抛射物拖尾/命中（比元素档更具体）。陨星雨那类"弹道本身就是招牌"的卡走这里：
     同一发火弹，焰矢与陨星不该长得一样。 */
  V.PROJECTILE_FX_CARD = {
    meteor_rain: { trail: 'meteor_trail', impact: 'ev_meteor_impact' },
    summon_bolt: { trail: 'comet_trail', impact: 'ev_hit' },
    spirit_volley: { trail: 'spirit_trail', impact: 'ev_firework' },
    firework: { trail: 'spirit_trail', impact: 'ev_firework' },
    cinder_bloom: { trail: 'spirit_trail', impact: 'ev_firework' },
    bridge_quill: { trail: 'comet_trail', impact: 'ev_bridge' }
  };
  /* 飞行随从的光环（按 aiKind 分档，权威层只说 aiKind）。
     地面随从（golem / dryad）不在这张表里 → 退回 summon_aura，行为与旧版一致。 */
  V.SUMMON_FX = {
    wisp_void: 'aura_void_wisp',
    hawk: 'aura_hawk',
    bee: 'aura_bee',
    wisp: 'aura_void_wisp'
  };
  V.PROJECTILE_FX = { trail: 'comet_trail', impact: 'impact_burst' };
  V.PROJECTILE_FX_EL = {
    fire: { trail: 'comet_trail', impact: 'ev_react_ignite' },
    ice: { trail: 'shard_spin', impact: 'ev_react_freeze' },
    void: { trail: 'void_spiral', impact: 'ev_break' },
    nature: { trail: 'comet_trail', impact: 'ev_react_melt' },
    rock: { trail: 'comet_trail', impact: 'ev_break' }
  };
  V.ENTITY_FX = { summon: 'summon_aura', player: 'follow_star' };
  /* 元素反应 key → 一次性配方（GW.CHEM 报的就是这些 key，见 js/chem.js 的 react()）。
     查不到就什么都不画：化学层从来不该因为特效缺失而出错。 */
  V.CHEM_FX = {
    ignite: 'ev_react_ignite',
    steam: 'ev_react_steam',
    ash: 'ev_react_ash',
    obsidian: 'ev_react_obsidian',
    melt: 'ev_react_melt',
    freeze: 'ev_react_freeze',
    caught: 'ev_react_ignite'
  };
})(window.GW);