'use strict';
/* ================= GW 音乐合成器（离线渲染侧） =================
   纯代码生成 BGM 与音效：不依赖任何音频文件、不依赖任何第三方库。
   引擎：振荡器/噪声/包络/滤波/混响/WAV 导出（无第三方依赖）
   跑法：node tools/music_compose.cjs [menu|battle|calm|sfx|all] [--seed N]
   产物：audio/demos/*.wav（三段无缝循环 BGM）、audio/sfx/*.wav、audio/demos/sfx-pack.wav
   同一 seed 重跑输出逐位一致（确定性可复现）。
   ================================================= */
const fs = require('fs');
const path = require('path');

const SR = 44100;
const ROOT = path.join(__dirname, '..');
const DEMO_DIR = path.join(ROOT, 'audio', 'demos');
const SFX_DIR = path.join(ROOT, 'audio', 'sfx');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return 3 * t * t - 2 * t * t * t; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* 声道缓冲：写入位置按 N 取模，尾音自动折回开头 => 循环点无缝 */
class Stereo {
  constructor(seconds) {
    this.N = Math.max(1, Math.round(seconds * SR));
    this.L = new Float32Array(this.N);
    this.R = new Float32Array(this.N);
  }
  addMod(i, gl, v, gr) {
    const N = this.N; let n = i % N; if (n < 0) n += N;
    this.L[n] += v * gl; this.R[n] += v * gr;
  }
}
function panGains(pan) { const th = (pan === undefined ? 0.5 : pan) * Math.PI / 2; return [Math.cos(th), Math.sin(th)]; }

/* Biquad（RBJ cookbook，DF2T） */
function coeffsLP(f, q) {
  const w = 2 * Math.PI * clamp(f, 10, SR * 0.48) / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * (q || 0.7071));
  const a0 = 1 + al; return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
}
function coeffsHP(f, q) {
  const w = 2 * Math.PI * clamp(f, 10, SR * 0.48) / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * (q || 0.7071));
  const a0 = 1 + al; return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
}
function coeffsBP(f, q) {
  const w = 2 * Math.PI * clamp(f, 20, SR * 0.48) / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * (q || 1));
  const a0 = 1 + al; return { b0: al / a0, b1: 0, b2: -al / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
}
class BQ {
  constructor(c) { this.set(c); this.z1 = 0; this.z2 = 0; }
  set(c) { this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2; }
  proc(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
function buildCoeff(s, f) { return s.kind === 'lp' ? coeffsLP(f, s.q) : s.kind === 'hp' ? coeffsHP(f, s.q) : coeffsBP(f, s.q); }
function makeFilter(o, lenSamples) {
  const stages = [];
  if (o.bpF) stages.push({ kind: 'bp', f0: o.bpF, f1: o.bpF2 || o.bpF, q: o.bpQ || 1.2, bq: null });
  if (o.hpF) stages.push({ kind: 'hp', f0: o.hpF, f1: o.hpF2 || o.hpF, q: o.hpQ || 0.7071, bq: null });
  if (o.lpF) stages.push({ kind: 'lp', f0: o.lpF, f1: o.lpF2 || o.lpF, q: o.lpQ || 0.7071, bq: null });
  if (!stages.length) return null;
  for (const s of stages) s.bq = new BQ(buildCoeff(s, s.f0));
  let n = 0;
  return {
    proc(x) {
      if (n % 64 === 0) {
        const u = lenSamples > 0 ? n / lenSamples : 0;
        for (const s of stages) if (s.f1 !== s.f0) s.bq.set(buildCoeff(s, s.f0 + (s.f1 - s.f0) * u));
      }
      n++;
      for (const s of stages) x = s.bq.proc(x);
      return x;
    }
  };
}

/* 波形 + smooth-BLEP 抗混叠（a = new-old 跳变幅度，t = 本样本内已走过比例） */
function waveValue(kind, ph, pw) {
  if (kind === 'sine') return Math.sin(2 * Math.PI * ph);
  if (kind === 'tri') return 1 - 4 * Math.abs(ph - 0.5);
  if (kind === 'saw') return 2 * ph - 1;
  const lim = kind === 'pulse' ? (pw === undefined ? 0.5 : pw) : 0.5;
  return ph < lim ? 1 : -1;
}
function transPoints(kind, pw) {
  if (kind === 'saw') return [[1, -2]];
  if (kind === 'square') return [[1, 2], [0.5, -2]];
  if (kind === 'pulse') return [[1, 2], [pw === undefined ? 0.5 : pw, -2]];
  return [];
}
const blep = (a, t) => -a * (1 - smooth01(t));

function makeBus(seconds, seed, fx) {
  const trk = {
    N: Math.max(1, Math.round(seconds * SR)),
    dry: new Stereo(seconds), rev: new Stereo(seconds), dly: new Stereo(seconds),
    rnd: mulberry32((seed ^ 0x5bf03635) >>> 0), fx: fx || {}, noiseTab: null
  };
  const r = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  trk.noiseTab = new Float32Array(SR * 2);
  for (let i = 0; i < trk.noiseTab.length; i++) trk.noiseTab[i] = r() * 2 - 1;
  return trk;
}
function emit(trk, start, k, v, o) {
  if (v === 0 || v !== v) return;
  const g = panGains(o.pan);
  const amp = o.vel === undefined ? 0.3 : o.vel;
  const s = amp * v;
  trk.dry.addMod(start + k, g[0], s, g[1]);
  if (o.rev) trk.rev.addMod(start + k, g[0], s * o.rev, g[1]);
  if (o.dly) trk.dly.addMod(start + k, g[0], s * o.dly, g[1]);
}

/* 包络：只给 len 时自动收尾到 0，绝不硬切（防爆音） */
function envParams(o, total) {
  let tau = o.tau, gate = o.dur, rel = o.rel;
  if (gate === undefined) gate = (tau !== undefined || o.swell) ? total : Math.max(0.0005, total - (rel !== undefined ? rel : Math.min(0.07, total * 0.4)));
  if (rel === undefined && tau === undefined && !o.swell) rel = Math.min(0.07, total * 0.4);
  return { gate: gate, rel: rel, tau: tau };
}
function envAt(o, p, gate, rel, total) {
  if (o.swell) return smooth01(p / total);
  if (o.tau !== undefined) {
    let e = Math.exp(-p / o.tau);
    if (o.att > 0) e *= smooth01(p / o.att);
    return e;
  }
  const a = o.att === undefined ? 0.005 : o.att, d = o.dec === undefined ? 0.05 : o.dec, s = o.sus === undefined ? 0.65 : o.sus;
  if (a > 0 && p < a) return p / a;
  if (p < a + d) return 1 - (1 - s) * ((p - a) / d);
  if (p <= gate) return s;
  if (rel <= 0) return 0;
  const u = (p - gate) / rel; if (u >= 1) return 0;
  return s * (1 - smooth01(u));
}

function tone(trk, o) {
  const total = o.len !== undefined ? o.len : (o.dur === undefined ? 0.2 : o.dur) + (o.rel === undefined ? 0.08 : o.rel);
  const len = Math.round(total * SR);
  const waveList = Array.isArray(o.wave) ? o.wave : [o.wave || 'square'];
  const eo = { swell: o.swell, att: o.att, dec: o.dec, sus: o.sus, tau: o.tau, dur: o.dur, rel: o.rel };
  if (eo.tau === undefined && waveList.indexOf('fm') >= 0 && (o.fmI || 0) > 0) eo.tau = total / 3.5;
  const ep = envParams(eo, total);
  const f0 = o.freq !== undefined ? o.freq : midiHz(o.midi);
  const f1 = o.freqTo !== undefined ? o.freqTo : (o.midiTo !== undefined ? midiHz(o.midiTo) : null);
  const dets = o.detune ? [-o.detune, o.detune] : [0];
  const voices = [];
  for (const w of waveList) for (const d of dets) voices.push({ kind: w, cents: d, phase: trk.rnd(), pts: transPoints(w, o.pw) });
  const filt = makeFilter(o, len);
  const drive = o.drive || 0, ampScale = drive ? 1 / Math.tanh(drive) : 1;
  const vibR = o.vibR || 5.5, vibD = o.vibD || 0, tremR = o.tremR || 6, trem = o.trem || 0;
  const fmR = o.fmR || 2, fmI = o.fmI || 0, fmTau = o.fmTau || 0.12;
  for (const v of voices) if (v.kind === 'fm') v.mph = trk.rnd();
  const start = Math.round(o.t * SR);
  for (let k = 0; k < len; k++) {
    const p = k / SR;
    const e = envAt(eo, p, ep.gate, ep.rel, total);
    if (e <= 1e-5) continue;
    let f = f0;
    if (f1 !== null) f = f0 * Math.pow(f1 / f0, smooth01(p / (o.glideT || 0.1)));
    if (vibD) f *= 1 + vibD * Math.sin(2 * Math.PI * vibR * p + (o.vibPh || 0));
    const inc = f / SR;
    let v = 0;
    for (const vc of voices) {
      const prev = vc.phase;
      vc.phase += inc * Math.pow(2, vc.cents / 1200);
      let wrapped = false;
      if (vc.phase >= 1) { vc.phase -= Math.floor(vc.phase); wrapped = true; }
      let s;
      if (vc.kind === 'fm') {
        vc.mph += inc * fmR; if (vc.mph >= 1) vc.mph -= Math.floor(vc.mph);
        const idx = fmI * Math.exp(-p / fmTau);
        s = Math.sin(2 * Math.PI * vc.phase + idx * Math.sin(2 * Math.PI * vc.mph));
      } else {
        s = waveValue(vc.kind, vc.phase, o.pw);
        for (const pr of vc.pts) {
          let t = -1;
          if (pr[0] === 1) { if (wrapped && inc > 0) t = vc.phase / inc; }
          else if (prev < pr[0] && vc.phase >= pr[0]) t = (vc.phase - pr[0]) / inc;
          if (t >= 0 && t <= 1) s += blep(pr[1], t);
        }
      }
      v += s;
    }
    v /= voices.length;
    if (trem) v *= 1 - trem * (0.5 + 0.5 * Math.sin(2 * Math.PI * tremR * p));
    if (filt) v = filt.proc(v);
    if (drive) v = Math.tanh(drive * v) * ampScale;
    emit(trk, start, k, v * e, o);
  }
}

function noise(trk, o) {
  const total = o.len !== undefined ? o.len : (o.dur === undefined ? 0.2 : o.dur) + (o.rel === undefined ? 0.06 : o.rel);
  const len = Math.round(total * SR);
  const eo = { swell: o.swell, att: o.att, sus: o.sus, tau: o.tau, dur: o.dur, rel: o.rel };
  const ep = envParams(eo, total);
  const filt = makeFilter(o, len);
  const tab = trk.noiseTab, mask = tab.length - 1;
  const off = Math.floor(trk.rnd() * (tab.length - 2));
  const rate = o.rate === undefined ? 1 : o.rate;
  const start = Math.round(o.t * SR);
  for (let k = 0; k < len; k++) {
    const p = k / SR;
    let e = envAt(eo, p, ep.gate, ep.rel, total);
    if (o.trill) e *= (Math.floor(p / (o.trillPeriod || 0.05)) % 2) ? 0.25 : 1;
    if (e <= 1e-5) continue;
    let v = tab[(off + Math.floor(k * rate)) & mask];
    if (filt) v = filt.proc(v);
    emit(trk, start, k, v * e, o);
  }
}

/* 圆周 FX（配合环形写入 = 尾音绕回开头，循环点无爆音） */
function circComb(x, N, Dsec, g, taps) {
  const y = new Float32Array(N);
  const D = Math.max(1, Math.round(Dsec * SR));
  let gg = 1;
  for (let t = 0; t < taps; t++) {
    const off = (t * D) % N;
    for (let n = 0; n < N; n++) { let s = n - off; if (s < 0) s += N; y[n] += gg * x[s]; }
    gg *= g;
  }
  return y;
}
function circLP(x, N, a) {
  const iters = clamp(Math.ceil(Math.log(1e-3) / Math.log(a)), 4, 28);
  let prev = x;
  for (let it = 0; it < iters; it++) {
    const y = new Float32Array(N);
    for (let n = 0; n < N; n++) { let s = n - 1; if (s < 0) s += N; y[n] = (1 - a) * x[n] + a * prev[s]; }
    prev = y;
  }
  return prev;
}
function addPingPong(dst, src, N, Dsec, g, taps, mix) {
  const D = Math.max(1, Math.round(Dsec * SR));
  let gg = g;
  for (let t = 1; t <= taps; t++) {
    const off = (t * D) % N;
    for (let n = 0; n < N; n++) {
      let s = n - off; if (s < 0) s += N;
      dst.L[n] += mix * gg * src.R[s];
      dst.R[n] += mix * gg * src.L[s];
    }
    gg *= g;
  }
}

function finalize(trk, o) {
  o = o || {};
  const N = trk.N, fx = trk.fx;
  const out = { L: new Float32Array(trk.dry.L), R: new Float32Array(trk.dry.R) };
  if (fx.rev) {
    const rl = new Float32Array(N), rr = new Float32Array(N);
    [[0.0891, 0.62, 16, 0.62], [0.1279, 0.58, 14, 0.6], [0.1713, 0.52, 12, 0.55]].forEach(function (c, i) {
      const dL = circLP(circComb(trk.rev.L, N, c[0] * (1 + i * 0.011), c[1], c[2]), N, c[3]);
      const dR = circLP(circComb(trk.rev.R, N, c[0] * (1 - i * 0.013) + 0.001, c[1], c[2]), N, c[3]);
      for (let n = 0; n < N; n++) { rl[n] += dL[n]; rr[n] += dR[n]; }
    });
    for (let n = 0; n < N; n++) { out.L[n] += fx.rev.mix * rl[n]; out.R[n] += fx.rev.mix * rr[n]; }
  }
  if (fx.dly) addPingPong(out, trk.dly, N, fx.dly.D || 0.36, fx.dly.g || 0.4, fx.dly.taps || 5, fx.dly.mix || 0.35);
  for (const ch of [out.L, out.R]) { let m = 0; for (let n = 0; n < N; n++) m += ch[n]; m /= N; for (let n = 0; n < N; n++) ch[n] -= m; }
  const drive = o.drive || 1.0;
  let peak = 0;
  for (let n = 0; n < N; n++) {
    out.L[n] = Math.tanh(drive * out.L[n]) / Math.tanh(drive);
    out.R[n] = Math.tanh(drive * out.R[n]) / Math.tanh(drive);
    peak = Math.max(peak, Math.abs(out.L[n]), Math.abs(out.R[n]));
  }
  const kk = peak > 1e-6 ? (o.peak === undefined ? 0.88 : o.peak) / peak : 1;
  for (let n = 0; n < N; n++) { out.L[n] *= kk; out.R[n] *= kk; }
  if (o.trimHead) {
    let s0 = 0;
    for (let n = 0; n < N; n++) if (Math.abs(out.L[n]) + Math.abs(out.R[n]) > 2e-3) { s0 = Math.max(0, n - Math.round(0.01 * SR)); break; }
    return { L: out.L.slice(s0), R: out.R.slice(s0), N: N - s0 };
  }
  return { L: out.L, R: out.R, N: N };
}

function writeWav(file, buf) {
  const N = buf.N || buf.L.length, bytes = 44 + N * 4;
  const ab = new ArrayBuffer(bytes), dv = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, N * 4, true);
  const r = mulberry32(12345); let off = 44;
  for (let n = 0; n < N; n++) {
    for (const c2 of [buf.L, buf.R]) {
      let v = c2[n] + (r() - 0.5) / 64 + (r() - 0.5) / 64;
      v = clamp(v, -0.999, 0.999);
      dv.setInt16(off, Math.round(v * 32767), true); off += 2;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(ab));
  return bytes;
}

function check(name, buf, loopable) {
  const N = buf.L.length;
  let peak = 0, clipped = 0, sum = 0;
  for (let n = 0; n < N; n++) {
    const a = Math.abs(buf.L[n]), b = Math.abs(buf.R[n]);
    peak = Math.max(peak, a, b); if (a > 0.999 || b > 0.999) clipped++;
    const m = (a + b) / 2; sum += m * m;
  }
  const rep = { name: name, seconds: +(N / SR).toFixed(2), peak: +peak.toFixed(3), rms: +Math.sqrt(sum / N).toFixed(4), clipped: clipped };
  if (loopable) {
    const d = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const p = n === 0 ? N - 1 : n - 1, x = n === N - 1 ? 0 : n + 1;
      d[n] = Math.abs(buf.L[n] * 2 - buf.L[p] - buf.L[x]) + Math.abs(buf.R[n] * 2 - buf.R[p] - buf.R[x]);
    }
    const inner = Array.prototype.slice.call(d, 4, N - 4).sort((a, b) => a - b);
    const p999 = inner[Math.floor(inner.length * 0.999)] || 1e-9;
    rep.seamRatio = +(Math.max(d[0], d[1], d[N - 1], d[N - 2]) / p999).toFixed(2);
  }
  const perSec = [];
  for (let s2 = 0; s2 < Math.min(Math.ceil(N / SR), 10); s2++) {
    let v = 0; const a = Math.floor(s2 * SR), b = Math.min(Math.floor((s2 + 1) * SR), N);
    for (let n = a; n < b; n++) v += buf.L[n] * buf.L[n];
    perSec.push(Math.sqrt(v / Math.max(1, b - a)).toFixed(2));
  }
  rep.rmsHead = perSec.join(' ');
  return rep;
}

module.exports = { SR, midiHz, Stereo, tone, noise, makeBus, finalize, writeWav, check, mulberry32, DEMO_DIR, SFX_DIR, ROOT };
