'use strict';
/* ================= GW 编曲与音效库（结构与配方，全部代码生成） =================
   三段可无缝循环的 BGM（主菜单 / 战斗 / 村庄安全区）+ 一套游戏特殊音效。
   音符、和弦、鼓点写在这里；音色由 tools/music_synth.cjs 现场合成。
   跑法：node tools/music_compose.cjs [menu|battle|calm|sfx|all] [--seed N]
   ================================================= */
const path = require('path');
const fs = require('fs');
const S = require('./music_synth.cjs');
const SR = S.SR, tone = S.tone, noise = S.noise, makeBus = S.makeBus, finalize = S.finalize, writeWav = S.writeWav, check = S.check, DEMO_DIR = S.DEMO_DIR, SFX_DIR = S.SFX_DIR;

/* 和弦表 */
const TYPE = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], sus4: [0, 5, 7], dim: [0, 3, 6] };
const ch = (root, type) => TYPE[type].map((i) => root + i);

/* 鼓组（振荡器 + 噪声搭的，不用采样） */
function kick(b, t, v, tight) { tone(b, { t: t, len: tight ? 0.2 : 0.3, tau: tight ? 0.062 : 0.105, wave: 'sine', freq: 138, freqTo: tight ? 56 : 44, glideT: 0.06, vel: 0.95 * v, drive: 1.5, pan: 0.5 }); tone(b, { t: t, len: 0.02, tau: 0.006, wave: 'square', freq: 430, vel: 0.3 * v, pan: 0.5 }); }
function snare(b, t, v) { noise(b, { t: t, len: 0.2, tau: 0.048, bpF: 1900, bpQ: 1.1, vel: 0.5 * v, rev: 0.3, pan: 0.5 }); tone(b, { t: t, len: 0.09, tau: 0.028, wave: 'tri', freq: 196, vel: 0.2 * v, pan: 0.5 }); }
function hat(b, t, v, open) { noise(b, { t: t, len: open ? 0.3 : 0.05, tau: open ? 0.09 : 0.014, hpF: 7600, vel: 0.2 * v, rev: open ? 0.3 : 0.12, pan: 0.62 }); }
function crash(b, t, v) { noise(b, { t: t, len: 1.5, tau: 0.4, hpF: 3600, hpF2: 1600, vel: 0.2 * v, rev: 0.7, pan: 0.42 }); }
function shaker(b, t, v, pan) { noise(b, { t: t, len: 0.1, tau: 0.03, bpF: 5200, bpQ: 0.8, vel: 0.16 * v, pan: pan, rev: 0.2 }); }
function tom(b, t, f, v) { tone(b, { t: t, len: 0.26, tau: 0.09, wave: 'tri', freq: f, freqTo: f * 0.72, glideT: 0.2, vel: 0.4 * v, pan: 0.4, rev: 0.25 }); }
function riser(b, t, dur) { noise(b, { t: t, len: dur, swell: true, bpF: 300, bpF2: 3600, bpQ: 1.4, vel: 0.24, rev: 0.5, dly: 0.2 }); }
function drumFill(b, t0, spb) { for (let i = 0; i < 8; i++) snare(b, t0 + i * spb * 0.25, 0.3 + i * 0.04); tom(b, t0 + 8 * spb * 0.25, 170, 0.7); }

/* ---------- 曲 1：主菜单 · 像素冒险 ---------- */
function compMenu(seed) {
  const bpm = 116, bars = 16, spb = 60 / bpm, B = (bb) => bb * spb;
  const bus = makeBus(bars * 4 * spb, seed, { rev: { mix: 0.3 }, dly: { D: spb * 0.75, g: 0.36, taps: 5, mix: 0.2 } });
  const prog = [[45, ch(57, 'min')], [41, ch(53, 'maj')], [48, ch(60, 'maj')], [43, ch(55, 'maj')]]; /* Am F C G */
  const seq = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 1, 3, 0, 0];
  for (let bar = 0; bar < bars; bar++) {
    const notes = prog[seq[bar]][1];
    for (let s = 0; s < 16; s++) {
      const m = notes[s % notes.length] + (s % 8 >= 4 ? 12 : 0);
      tone(bus, { t: B(bar * 4 + s * 0.25), dur: 0.05, rel: 0.05, wave: 'pulse', pw: 0.25, midi: m, vel: s % 4 === 0 ? 0.11 : 0.075, lpF: 6000, pan: s % 2 ? 0.7 : 0.3, rev: 0.12, dly: 0.16 });
    }
  }
  for (let bar = 1; bar < bars; bar++) {
    const r = prog[seq[bar]][0], pat = [0, 12, 0, 0, 7, 0, 12, 7];
    for (let e = 0; e < 8; e++) {
      if ((e === 2 || e === 6) && bar % 2 === 1) continue;
      tone(bus, { t: B(bar * 4 + e * 0.5), dur: 0.17, rel: 0.1, wave: 'tri', midi: r + pat[e], vel: 0.3, lpF: 950, pan: 0.5, att: 0.004 });
    }
  }
  for (let bar = 2; bar < bars; bar++) {
    const t0 = B(bar * 4);
    kick(bus, t0, 0.9); kick(bus, t0 + 2.5 * spb, 0.8); if (bar > 3) kick(bus, t0 + 0.75 * spb, 0.5);
    snare(bus, t0 + spb, 0.85); snare(bus, t0 + 3 * spb, 0.85);
    for (let e = 0; e < 8; e++) hat(bus, t0 + e * 0.5 * spb, e % 2 ? 0.5 : 0.85, false);
    hat(bus, t0 + 3.5 * spb, 0.55, true);
    if (bar === bars - 1) drumFill(bus, t0 + 3 * spb, spb);
    if (bar % 4 === 0) crash(bus, t0, 0.9);
  }
  const P = [
    [[0.5, 72, 0.4], [0.9, 76, 0.5], [1.4, 79, 0.6], [2.2, 76, 0.35], [2.6, 72, 0.4], [3.1, 74, 0.6]],
    [[0.4, 74, 0.4], [0.9, 71, 0.4], [1.4, 67, 0.7], [2.3, 71, 0.35], [2.7, 74, 0.35], [3.2, 76, 0.6]],
    [[0.5, 69, 0.4], [0.9, 72, 0.4], [1.4, 76, 0.7], [2.3, 74, 0.4], [2.8, 72, 0.45]],
    [[0.3, 77, 0.4], [0.8, 74, 0.4], [1.3, 72, 0.85], [2.4, 76, 0.4], [3.0, 77, 0.7]],
    [[0.4, 76, 0.4], [0.9, 79, 0.4], [1.4, 81, 0.7], [2.4, 79, 0.4], [3.0, 76, 0.8]],
    [[0.4, 74, 0.4], [0.9, 71, 0.45], [1.5, 67, 1.1], [3.0, 64, 0.45]]
  ];
  const lead = (bar, line, oct, vel, pan) => line.forEach((n) => {
    tone(bus, { t: B(bar * 4 + n[0]), dur: n[2], rel: 0.18, wave: 'square', midi: n[1] + oct, vel: vel, att: 0.014, dec: 0.07, sus: 0.8, lpF: 6800, vibR: 5.2, vibD: 0.006, pan: pan, rev: 0.28, dly: 0.2 });
  });
  P.forEach((line, i) => lead(2 + i, line, 0, 0.26, 0.46));
  P.forEach((line, i) => lead(10 + i, line, 12, 0.25, 0.54));
  P.forEach((line, i) => lead(10 + i, line, 0, 0.1, 0.4));
  lead(15, [[0.4, 81, 1.2], [1.9, 79, 0.4], [2.4, 76, 0.4], [3.0, 72, 0.35], [3.55, 69, 0.3]], 0, 0.26, 0.5);
  for (let bar = 8; bar < bars; bar++) {
    const notes = prog[seq[bar]][1];
    notes.forEach((m, i) => tone(bus, { t: B(bar * 4), dur: 4 * spb * 0.86, rel: 0.9, wave: 'saw', midi: m, detune: 9, vel: 0.06, att: 0.35, dec: 0.5, sus: 0.9, lpF: 900, lpF2: 2500, pan: 0.18 + i * 0.21, rev: 0.5 }));
  }
  [0, 4, 8, 12].forEach((bar, i) => {
    const notes = prog[seq[bar]][1];
    tone(bus, { t: B(bar * 4), len: 1.4, wave: 'fm', midi: notes[notes.length - 1] + 24, fmR: 2.76, fmI: 2.2, fmTau: 0.28, vel: 0.13, pan: i % 2 ? 0.68 : 0.32, rev: 0.55, dly: 0.25 });
  });
  return { bus: bus, seconds: bars * 4 * spb };
}

/* ---------- 曲 2：战斗 ---------- */
function compBattle(seed) {
  const bpm = 140, bars = 16, spb = 60 / bpm, B = (bb) => bb * spb;
  const bus = makeBus(bars * 4 * spb, seed + 1, { rev: { mix: 0.26 }, dly: { D: spb * 0.75, g: 0.34, taps: 4, mix: 0.18 } });
  const prog = [
    [38, ch(50, 'min'), 3], [41, ch(53, 'maj'), 4], [36, ch(48, 'maj'), 4], [38, ch(50, 'maj'), 4],
    [38, ch(50, 'min'), 3], [41, ch(53, 'maj'), 4], [43, ch(55, 'maj'), 4], [45, ch(57, 'maj'), 4]
  ];
  const at = (bar) => prog[bar % prog.length];
  function stabBar(bar, beats, vel, oct) {
    const a = at(bar), notes = a[1];
    beats.forEach((bb) => notes.forEach((m, i) => tone(bus, {
      t: B(bar * 4 + bb), dur: 0.1, rel: 0.1, wave: ['saw', 'square'], midi: m + (oct || 12), detune: 11,
      vel: vel * (i === 0 ? 1 : 0.85), att: 0.004, dec: 0.05, sus: 0.35, lpF: 3100, lpF2: 1900, pan: 0.3 + i * 0.2, rev: 0.3, dly: 0.15
    })));
  }
  const RIFF = [0, 0, -1, 12, 0, 7, -1, 0, 3, -1, 7, -1, 12, 0, -1, 11];
  const LR = [0, -1, 3, -1, 5, 7, -1, 3, 0, -1, 7, 5, 3, -1, 2, -1];
  const LG = [7, -1, 5, 3, -1, 0, 3, 5, 7, 8, -1, 5, 3, 0, -1, -1];
  for (let bar = 0; bar < bars; bar++) {
    const a = at(bar), root = a[0], third = a[2];
    for (let s = 0; s < 16; s++) {
      const off = RIFF[s]; if (off < 0) continue;
      const useThird = off === 3 || off === 11;
      tone(bus, { t: B(bar * 4 + s * 0.25), dur: 0.11, rel: 0.06, wave: 'saw', midi: root + (useThird ? third : off), vel: s % 4 === 0 ? 0.31 : 0.24, lpF: 380, lpF2: 1550, drive: 1.15, pan: 0.5, att: 0.003 });
    }
    if (bar >= 8) {
      const notes = a[1], top = notes[notes.length - 1] + 12;
      [3.5, 3.75].forEach((bb) => tone(bus, { t: B(bar * 4 + bb), dur: 0.1, rel: 0.07, wave: 'tri', midi: top, vel: 0.15, lpF: 2600, pan: 0.35, rev: 0.3 }));
    }
  }
  for (let bar = 0; bar < bars; bar++) {
    const t0 = B(bar * 4);
    kick(bus, t0, 0.72, 1); kick(bus, t0 + 1.5 * spb, 0.42, 1); kick(bus, t0 + 2 * spb, 0.68, 1); kick(bus, t0 + 3.5 * spb, 0.42, 1);
    if (bar >= 2) kick(bus, t0 + 2.75 * spb, 0.5);
    if (bar >= 1) { snare(bus, t0 + spb, 0.9); snare(bus, t0 + 3 * spb, 0.95); }
    if (bar >= 8) snare(bus, t0 + 2.5 * spb, 0.32);
    for (let s = 0; s < 16; s++) hat(bus, t0 + s * 0.25 * spb, s % 4 === 2 ? 1.15 : 0.5, s === 14 && bar % 2 === 1);
    if (bar >= 4) for (let s = 1; s < 16; s += 2) noise(bus, { t: t0 + s * 0.25 * spb, len: 0.04, tau: 0.011, hpF: 8800, vel: s % 4 === 1 ? 0.075 : 0.05, rev: 0.3, pan: s % 4 === 1 ? 0.3 : 0.7 });
    if (bar >= 8) snare(bus, t0 + 3.75 * spb, 0.28);
    if (bar % 4 === 0) crash(bus, t0, 0.95);
    if (bar === 7 || bar === 15) drumFill(bus, t0 + 3 * spb, spb);
  }
  for (let bar = 2; bar < 8; bar++) stabBar(bar, [1.75, 2.5], 0.25);
  for (let bar = 8; bar < bars; bar++) stabBar(bar, [0.5, 1.75, 2.5, 3.25], 0.24, 24);
  for (let bar = 8; bar < bars; bar++) {
    const a = at(bar), root = a[0], third = a[2], pat = bar % 2 ? LG : LR;
    for (let s = 0; s < 16; s++) {
      const off = pat[s]; if (off < 0) continue;
      tone(bus, {
        t: B(bar * 4 + s * 0.25), dur: 0.1, rel: 0.09, wave: ['saw', 'square'], midi: root + (bar % 2 ? 36 : 24) + (off === 3 ? third : off),
        detune: 13, vel: 0.27, lpF: 1800, lpF2: 5600, vibR: 6.2, vibD: 0.009, pan: 0.44, att: 0.006, dec: 0.05, sus: 0.5, rev: 0.24, dly: 0.28
      });
    }
  }
  for (let bar = 8; bar < bars; bar++) [0, 1.5, 2, 3].forEach((bb, i) => {
    const notes = at(bar)[1];
    tone(bus, { t: B(bar * 4 + bb), len: 0.55, wave: 'fm', midi: notes[i % notes.length] + 36, fmR: 2.41, fmI: 1.9, fmTau: 0.16, vel: 0.075, pan: i % 2 ? 0.7 : 0.3, rev: 0.45, dly: 0.2 });
  });
  for (let bar = 4; bar < bars; bar++) {
    const notes = at(bar)[1];
    for (let s = 0; s < 8; s++) {
      const m = notes[s % notes.length] + 12;
      tone(bus, { t: B(bar * 4 + s * 0.5), dur: 0.07, rel: 0.06, wave: 'pulse', pw: 0.3, midi: m, vel: s % 2 ? 0.075 : 0.11, lpF: 3600, pan: s % 2 ? 0.68 : 0.32, rev: 0.2, dly: 0.12 });
    }
  }
  riser(bus, B(6.5), 1.5 * 4 * spb); riser(bus, B(14.5), 1.5 * 4 * spb);
  return { bus: bus, seconds: bars * 4 * spb };
}

/* ---------- 曲 3：村庄 / 安全区 ---------- */
function compCalm(seed) {
  const bpm = 62, bars = 8, spb = 60 / bpm, B = (bb) => bb * spb;
  const bus = makeBus(bars * 4 * spb, seed + 2, { rev: { mix: 0.4 }, dly: { D: spb * 0.75, g: 0.4, taps: 5, mix: 0.26 } });
  const rnd = S.mulberry32(seed + 77);
  const prog = [
    [41, ch(53, 'maj7')], [45, ch(57, 'min7')], [50, ch(50, 'min7')], [48, ch(60, 'maj7')],
    [41, ch(53, 'maj7')], [45, ch(57, 'min7')], [50, ch(50, 'min7')], [48, ch(60, 'maj7')]
  ];
  for (let bar = 0; bar < bars; bar++) {
    const notes = prog[bar][1];
    notes.forEach((m, i) => tone(bus, {
      t: B(bar * 4), dur: 4 * spb * 0.85, rel: 1.5, wave: 'saw', midi: m + 12, detune: 8,
      vel: 0.07, att: 1.1, dec: 0.6, sus: 0.9, lpF: 1150, pan: 0.16 + i * 0.23, rev: 0.7
    }));
    const root = prog[bar][0];
    tone(bus, { t: B(bar * 4), dur: 2.2, rel: 0.8, wave: 'sine', midi: root - 12, vel: 0.24, lpF: 400, pan: 0.5 });
    if (bar % 2 === 1) tone(bus, { t: B(bar * 4 + 2.5), dur: 1.1, rel: 0.6, wave: 'sine', midi: root - 5, vel: 0.15, lpF: 400, pan: 0.5 });
    for (let s = 0; s < 8; s++) {
      if (bar < 2 && s % 2 === 1) continue;
      shaker(bus, B(bar * 4 + s * 0.5), s % 2 ? 0.6 : 1, s % 2 ? 0.7 : 0.32);
    }
    if (bar % 4 === 3) noise(bus, { t: B(bar * 4 + 1), len: 3.2, swell: true, bpF: 420, bpF2: 900, bpQ: 1.1, vel: 0.05, rev: 0.6, pan: 0.4 });
    const bellPat = bar % 2 === 0 ? [0, 1, 2, 2.5, 3.5] : [0.5, 1.5, 2, 3];
    bellPat.forEach((bb, i) => {
      const m = notes[(i + bar) % notes.length] + 24 + (rnd() < 0.25 ? 12 : 0);
      tone(bus, {
        t: B(bar * 4 + bb) + (rnd() - 0.5) * 0.012, len: 1.8, wave: 'fm', midi: m,
        fmR: i % 2 ? 3.02 : 2.41, fmI: 2.6, fmTau: 0.35, vel: 0.11 + rnd() * 0.05, pan: 0.2 + rnd() * 0.6, rev: 0.6, dly: 0.35
      });
    });
    if (bar >= 4) {
      [[0.75, 69], [1.75, 72], [3.25, 76]].forEach((n) => tone(bus, { t: B(bar * 4 + n[0]), dur: 0.18, rel: 0.28, wave: 'tri', midi: n[1], vel: 0.1, lpF: 3000, pan: 0.62, rev: 0.5, dly: 0.4 }));
    }
  }
  return { bus: bus, seconds: bars * 4 * spb };
}

/* ---------- 特殊音效（id 与 src/audio.js 的事件名对齐，方便接进游戏） ---------- */
const BANK = [
  { id: 'ui', label: 'UI 点击', sec: 0.4, make: (b, t) => { tone(b, { t: t, len: 0.09, tau: 0.03, wave: 'square', freq: 880, vel: 0.32, lpF: 6000 }); noise(b, { t: t, len: 0.03, tau: 0.008, hpF: 4500, vel: 0.07 }); } },
  { id: 'deny', label: '不可出牌 / 拒绝', sec: 0.5, make: (b, t) => { tone(b, { t: t, len: 0.1, tau: 0.04, wave: 'square', freq: 320, vel: 0.26, lpF: 2200 }); tone(b, { t: t + 0.09, len: 0.16, tau: 0.06, wave: 'square', freq: 240, vel: 0.26, lpF: 2200 }); tone(b, { t: t + 0.09, len: 0.16, tau: 0.06, wave: 'sine', freq: 120, vel: 0.16 }); } },
  { id: 'card', label: '抽牌 / 翻牌', sec: 0.6, make: (b, t) => { [0, 0.07].forEach((d, i) => { noise(b, { t: t + d, len: 0.09, tau: 0.03, bpF: 1300, bpF2: 3400, bpQ: 0.9, vel: 0.4 + i * 0.1, pan: i ? 0.62 : 0.38 }); tone(b, { t: t + d, len: 0.05, tau: 0.015, wave: 'tri', freq: 420, vel: 0.14 }); }); } },
  { id: 'cast', label: '施法充能', sec: 1.1, make: (b, t) => { tone(b, { t: t, len: 0.62, swell: true, wave: 'sine', freq: 240, freqTo: 1000, glideT: 0.55, vel: 0.3, trem: 0.25, tremR: 9, rev: 0.4, dly: 0.3 }); noise(b, { t: t, len: 0.62, swell: true, hpF: 2600, hpF2: 8200, vel: 0.12, rev: 0.6 }); tone(b, { t: t + 0.56, len: 0.5, wave: 'fm', freq: 1568, fmR: 2.76, fmI: 2.2, fmTau: 0.2, vel: 0.2, rev: 0.6 }); } },
  { id: 'shoot', label: '法术发射', sec: 0.5, make: (b, t) => { tone(b, { t: t, len: 0.16, tau: 0.06, wave: 'saw', freq: 780, freqTo: 170, glideT: 0.12, vel: 0.34, drive: 1.4, lpF: 3600 }); noise(b, { t: t, len: 0.18, tau: 0.06, lpF: 2600, lpF2: 500, vel: 0.2 }); } },
  { id: 'hit', label: '命中', sec: 0.4, make: (b, t) => { noise(b, { t: t, len: 0.1, tau: 0.03, bpF: 950, bpQ: 1, vel: 0.5 }); tone(b, { t: t, len: 0.14, tau: 0.05, wave: 'sine', freq: 190, freqTo: 80, glideT: 0.1, vel: 0.4, drive: 1.3 }); } },
  { id: 'boom', label: '爆炸', sec: 1.2, make: (b, t) => { tone(b, { t: t, len: 0.7, tau: 0.22, wave: 'sine', freq: 82, freqTo: 32, glideT: 0.4, vel: 0.65, drive: 1.7 }); noise(b, { t: t, len: 0.8, tau: 0.2, lpF: 1500, lpF2: 120, vel: 0.5, rev: 0.5 }); noise(b, { t: t, len: 0.05, tau: 0.01, hpF: 4200, vel: 0.4 }); } },
  { id: 'terrain', label: '地形改造', sec: 0.6, make: (b, t) => { noise(b, { t: t, len: 0.36, tau: 0.1, lpF: 780, lpF2: 200, vel: 0.45, rev: 0.2 }); tone(b, { t: t, len: 0.18, tau: 0.06, wave: 'square', freq: 125, freqTo: 88, glideT: 0.14, vel: 0.22, lpF: 900 }); } },
  { id: 'sigil', label: '法阵展开', sec: 1.0, make: (b, t) => { noise(b, { t: t, len: 0.6, swell: true, bpF: 500, bpF2: 4200, bpQ: 1.6, vel: 0.2, rev: 0.6 }); tone(b, { t: t, len: 0.6, swell: true, wave: 'sine', freq: 300, freqTo: 1200, glideT: 0.55, vel: 0.2, rev: 0.4 }); tone(b, { t: t + 0.5, len: 0.6, wave: 'fm', freq: 2093, fmR: 2.02, fmI: 1.8, fmTau: 0.25, vel: 0.16, rev: 0.7 }); } },
  { id: 'sigilGo', label: '法阵引爆', sec: 1.0, make: (b, t) => { tone(b, { t: t, len: 0.4, tau: 0.12, wave: 'saw', freq: 900, freqTo: 220, glideT: 0.3, vel: 0.3, drive: 1.6, lpF: 3200 }); noise(b, { t: t, len: 0.5, tau: 0.14, lpF: 2200, lpF2: 260, vel: 0.35, rev: 0.5 }); tone(b, { t: t + 0.02, len: 0.5, tau: 0.16, wave: 'sine', freq: 120, freqTo: 45, glideT: 0.35, vel: 0.4, drive: 1.4 }); } },
  { id: 'shield', label: '护盾', sec: 0.8, make: (b, t) => { tone(b, { t: t, len: 0.28, att: 0.03, tau: 0.1, wave: 'tri', freq: 600, freqTo: 1150, glideT: 0.2, vel: 0.26, rev: 0.4 }); noise(b, { t: t, len: 0.3, swell: true, bpF: 700, bpF2: 2400, bpQ: 2.2, vel: 0.22, rev: 0.5 }); tone(b, { t: t + 0.24, len: 0.5, tau: 0.16, wave: 'sine', freq: 330, vel: 0.18, rev: 0.6 }); } },
  { id: 'heal', label: '治疗', sec: 0.9, make: (b, t) => { [[0, 660, 990], [0.09, 880, 1320]].forEach((n) => tone(b, { t: t + n[0], len: 0.4, att: 0.06, tau: 0.16, wave: 'sine', freq: n[1], freqTo: n[2], glideT: 0.22, vel: 0.22, rev: 0.5 })); tone(b, { t: t + 0.3, len: 0.6, wave: 'fm', freq: 2093, fmR: 2.41, fmI: 2, fmTau: 0.22, vel: 0.14, pan: 0.66, rev: 0.6 }); } },
  { id: 'crystal', label: '拾取水晶', sec: 0.7, make: (b, t) => { [[0, 1046], [0.06, 1568]].forEach((n) => tone(b, { t: t + n[0], len: 0.4, wave: 'fm', freq: n[1], fmR: 2.41, fmI: 2.4, fmTau: 0.14, vel: 0.24, rev: 0.5, pan: n[0] ? 0.62 : 0.38 })); [0.12, 0.17, 0.23].forEach((d) => noise(b, { t: t + d, len: 0.05, tau: 0.012, hpF: 6500, vel: 0.1, pan: 0.6 })); } },
  { id: 'levelup', label: '升级 / 稀有卡', sec: 1.5, make: (b, t) => { [69, 72, 76, 81, 88].forEach((m, i) => tone(b, { t: t + i * 0.09, len: 0.22, wave: 'square', midi: m, vel: 0.22, lpF: 5200, pan: 0.5, rev: 0.4, dly: 0.25 })); [57, 61, 64, 69].forEach((m, i) => tone(b, { t: t + 0.5 + i * 0.004, len: 0.7, att: 0.02, tau: 0.22, wave: ['saw', 'square'], midi: m, detune: 11, vel: 0.12, lpF: 3000, rev: 0.6 })); noise(b, { t: t + 0.48, len: 0.8, tau: 0.25, hpF: 5200, vel: 0.1, rev: 0.7 }); } },
  { id: 'freeze', label: '冰封', sec: 1.1, make: (b, t) => { [[0, 2093], [0.05, 2637], [0.11, 1760]].forEach((n) => tone(b, { t: t + n[0], len: 0.7, wave: 'fm', freq: n[1], fmR: 3.6, fmI: 3, fmTau: 0.16, vel: 0.16, rev: 0.6, pan: 0.4 + n[0] })); noise(b, { t: t, len: 0.45, swell: true, hpF: 3000, hpF2: 9000, vel: 0.14, rev: 0.6 }); tone(b, { t: t, len: 0.5, att: 0.05, tau: 0.18, wave: 'sine', freq: 440, freqTo: 210, glideT: 0.4, vel: 0.2, lpF: 1200 }); } },
  { id: 'thunder', label: '雷击', sec: 1.8, make: (b, t) => { noise(b, { t: t, len: 0.09, tau: 0.02, bpF: 2800, bpQ: 0.8, trill: true, trillPeriod: 0.006, vel: 0.6, rev: 0.4 }); noise(b, { t: t + 0.03, len: 1.2, tau: 0.3, lpF: 1000, lpF2: 130, vel: 0.45, rev: 0.7 }); tone(b, { t: t + 0.03, len: 1.0, tau: 0.3, wave: 'sine', freq: 66, freqTo: 30, glideT: 0.6, vel: 0.45, drive: 1.4 }); } },
  { id: 'teleport', label: '闪现 / 传送', sec: 1.0, make: (b, t) => { noise(b, { t: t, len: 0.3, swell: true, bpF: 300, bpF2: 4200, bpQ: 1.4, vel: 0.3, rev: 0.4 }); tone(b, { t: t + 0.26, len: 0.28, tau: 0.09, wave: 'sine', freq: 1700, freqTo: 180, glideT: 0.2, vel: 0.26, rev: 0.4, dly: 0.3 }); for (let i = 0; i < 6; i++) tone(b, { t: t + 0.26 + i * 0.03, len: 0.2, wave: 'fm', freq: 1200 + i * 260, fmR: 2.4, fmI: 2, fmTau: 0.06, vel: 0.09, pan: 0.2 + i * 0.12, rev: 0.5 }); } },
  { id: 'summon', label: '召唤随从', sec: 1.4, make: (b, t) => { [45, 49, 52].forEach((m, i) => tone(b, { t: t, len: 0.65, swell: true, wave: ['saw', 'square'], midi: m, detune: 9, vel: 0.14, lpF: 320, lpF2: 2100, pan: 0.3 + i * 0.2, rev: 0.45 })); noise(b, { t: t + 0.5, len: 0.6, tau: 0.16, lpF: 1400, lpF2: 200, vel: 0.35, rev: 0.5 }); tone(b, { t: t + 0.5, len: 0.6, tau: 0.2, wave: 'sine', freq: 96, freqTo: 40, glideT: 0.4, vel: 0.4, drive: 1.4 }); } },
  { id: 'win', label: '胜利号角', sec: 2.2, make: (b, t) => { [[0, 69], [0.12, 73], [0.24, 76], [0.4, 81], [0.62, 76], [0.74, 81]].forEach((n) => tone(b, { t: t + n[0], len: 0.3, att: 0.015, tau: 0.14, wave: ['square', 'saw'], midi: n[1], detune: 8, vel: 0.24, lpF: 4200, rev: 0.4, dly: 0.2 })); kick(b, t, 0.8); kick(b, t + 0.4, 0.8); snare(b, t + 0.2, 0.6); snare(b, t + 0.62, 0.7); [57, 61, 64, 69, 73, 76].forEach((m, i) => tone(b, { t: t + 0.9 + i * 0.003, len: 1.1, att: 0.02, tau: 0.3, wave: ['saw', 'square'], midi: m, detune: 12, vel: 0.13, lpF: 3400, rev: 0.6 })); crash(b, t + 0.88, 0.9); } },
  { id: 'lose', label: '战败', sec: 2.0, make: (b, t) => { [[0, 55], [0.28, 52], [0.62, 48]].forEach((n) => tone(b, { t: t + n[0], len: 0.55, att: 0.02, tau: 0.24, wave: ['saw', 'square'], midi: n[1], detune: 16, vel: 0.2, lpF: 1500, lpF2: 600, rev: 0.45 })); tone(b, { t: t, len: 1.7, att: 0.05, tau: 0.6, wave: 'sine', midi: 33, vel: 0.3, lpF: 300 }); tone(b, { t: t + 1.0, len: 0.8, tau: 0.26, wave: 'sine', freq: 82, freqTo: 34, glideT: 0.5, vel: 0.45, drive: 1.5, rev: 0.4 }); } },
  { id: 'jump', label: '跳跃', sec: 0.3, make: (b, t) => { tone(b, { t: t, len: 0.11, tau: 0.04, wave: 'square', freq: 300, freqTo: 470, glideT: 0.09, vel: 0.14, lpF: 3000 }); } },
  { id: 'melee', label: '近战挥击', sec: 0.4, make: (b, t) => { noise(b, { t: t, len: 0.14, tau: 0.04, bpF: 1500, bpF2: 700, bpQ: 1.1, vel: 0.4, pan: 0.4 }); tone(b, { t: t + 0.02, len: 0.1, tau: 0.03, wave: 'tri', freq: 240, freqTo: 150, glideT: 0.08, vel: 0.12 }); } }
];

/* ---------- 渲染 ---------- */
function renderSfx(def, seed) {
  const bus = makeBus(def.sec, seed + 555, { rev: { mix: 0.34 }, dly: { D: 0.22, g: 0.3, taps: 3, mix: 0.15 } });
  def.make(bus, 0);
  return finalize(bus, { peak: 0.9, trimHead: true, drive: 1.05 });
}
const TRACKS = { menu: { fn: compMenu, file: 'menu-theme.wav', drive: 1.12 }, battle: { fn: compBattle, file: 'battle-theme.wav', drive: 1.12 }, calm: { fn: compCalm, file: 'calm-theme.wav', drive: 1.08 } };
function renderAll(which, seed) {
  const reports = [];
  fs.mkdirSync(DEMO_DIR, { recursive: true }); fs.mkdirSync(SFX_DIR, { recursive: true });
  Object.keys(TRACKS).forEach((key) => {
    if (which !== 'all' && which !== key) return;
    const T = TRACKS[key], t = T.fn(seed), buf = finalize(t.bus, { drive: T.drive });
    writeWav(path.join(DEMO_DIR, T.file), buf);
    reports.push(check(T.file, buf, true));
  });
  if (which === 'all' || which === 'sfx') {
    const parts = BANK.map((d) => { const buf = renderSfx(d, seed); writeWav(path.join(SFX_DIR, d.id + '.wav'), buf); return { d: d, buf: buf }; });
    const gap = Math.round(0.45 * SR), pad = Math.round(0.06 * SR);
    let total = pad * 2; for (const p of parts) total += p.buf.N + gap;
    const pack = { L: new Float32Array(total), R: new Float32Array(total), N: total };
    let cur = pad;
    for (const p of parts) { for (let n = 0; n < p.buf.N; n++) { pack.L[cur + n] = p.buf.L[n]; pack.R[cur + n] = p.buf.R[n]; } cur += p.buf.N + gap; }
    writeWav(path.join(DEMO_DIR, 'sfx-pack.wav'), pack);
    reports.push(check('sfx-pack', pack, false));
    fs.writeFileSync(path.join(DEMO_DIR, 'listen.html'), listenPage(parts.map((p) => p.d)));
  }
  return reports;
}
function listenPage(defs) {
  const rows = defs.map((d, i) => '<li><button data-src="../sfx/' + d.id + '.wav"><b>' + (i + 1) + '. ' + d.label + '</b><span>' + d.id + '</span></button></li>').join('\n');
  const css = 'body{background:#12100f;color:#e8e2d4;font:15px/1.6 system-ui,"Noto Sans SC",sans-serif;margin:0;padding:26px 32px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px;color:#f0b357}.sub{color:#8c8577;margin-bottom:18px}.track{background:#1b1815;border:1px solid #2c2723;border-radius:10px;padding:13px 16px;margin:10px 0}.track b{display:block}audio{width:100%;height:34px;margin-top:6px}ul{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}button{width:100%;text-align:left;background:#241f1a;color:#e8e2d4;border:1px solid #3a332b;border-radius:8px;padding:9px 12px;cursor:pointer;font:inherit}button:hover{background:#31281f;border-color:#f0b357}button span{float:right;color:#8c8577;font-size:12px}.tip{color:#8c8577;font-size:13px}';
  const bg = [
    ['主菜单 · 像素冒险', 'menu-theme.wav', '116 BPM · Am–F–C–G 共 16 小节 · 方波主旋律 + 三角波贝斯 + 16 分脉冲琶音 + 芯片鼓组 + 弦垫'],
    ['战斗 · 法阵', 'battle-theme.wav', '140 BPM · D 多利亚 16 小节 · 失真低音 riff + 和弦刺 + 锯齿领奏 + 噪声上升过门'],
    ['村庄 · 安全区', 'calm-theme.wav', '62 BPM · F 大调七和弦 8 小节 · 慢起弦垫 + FM 钢片琴 + 沙锤 + 风声']
  ].map((t, i) => '<div class="track"><b>' + '①②③'[i] + ' ' + t[0] + '</b><div class="tip">' + t[2] + '</div><audio controls loop src="' + t[1] + '"></audio></div>').join('\n');
  return ['<!doctype html>', '<html lang="zh"><head><meta charset="utf-8"><title>卡牌纪元 · 音乐小样试听</title>',
    '<style>' + css + '</style></head><body>',
    '<h1>卡牌纪元 · 纯代码音乐小样</h1>',
    '<div class="sub">所有声音由 tools/music_synth.cjs 现场合成，项目里不放任何音频文件。三段 BGM 按整小节环形写入渲染，循环点无缝（尾音绕回开头）。</div>',
    '<h2>背景音乐（无缝循环）</h2>', bg,
    '<h2>特殊音效（点按钮试听，共 ' + defs.length + ' 个）</h2>', '<ul>' + rows + '</ul>',
    '<div class="tip" style="margin-top:16px">整套连播：<audio controls src="sfx-pack.wav" style="max-width:520px"></audio></div>',
    '<script>var cur=null;document.querySelectorAll("button[data-src]").forEach(function(btn){btn.onclick=function(){if(cur)cur.pause();cur=new Audio(btn.getAttribute("data-src"));cur.play();};});</script>',
    '</body></html>'].join('\n');
}
module.exports = { renderAll, BANK, TRACKS };
if (require.main === module) {
  const args = process.argv.slice(2);
  const which = args.find((a) => ['menu', 'battle', 'calm', 'sfx', 'all'].indexOf(a) >= 0) || 'all';
  const si = args.indexOf('--seed');
  const seed = si >= 0 ? +args[si + 1] : 20261016;
  const t0 = Date.now();
  const reports = renderAll(which, seed);
  console.log('seed=' + seed + '  用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  for (const r of reports) console.log(JSON.stringify(r));
  console.log('产物：audio/demos/（3 段 BGM + sfx-pack + listen.html）、audio/sfx/（单条 ' + BANK.length + ' 个）');
}
