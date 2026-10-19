/* ================= GW.AudioEngine =================
   音频的**运行时引擎**：只回答"一层声音怎么发出来"。
     - 懒建 AudioContext（浏览器要用户手势后才准发声，第一次点菜单才建）
     - 三条总线 sfx / music → master：静音与音量只写在总线上，一个开关管全部
     - 两种声源：振荡器（含占空比可调的芯片方波、程序化铃音波形）与噪声（确定性噪声表，
       同一次加载永远同一条，不会每次播放音色都在漂）
     - 每层自己的包络、滤波扫频、软削波、声像、颤音门，以及送给混响 / 乒乓延迟的量
     - 复音上限 + 同名重触发节流：十几个爆炸同一帧响时，不把 CPU 和响度顶爆
   零事件名、零配方、零 DOM、零玩家可见文案——那两件事分别归 js/sfx-table.js（纯数据）
   与 js/audio.js（门面）。权威层与渲染层只认 GW.Audio.play(name)，不直接碰这里。
   不依赖 THREE，不依赖任何音频文件。构建函数接受任意 BaseAudioContext，
   所以回归脚本（tools/audio_check.cjs）能用 OfflineAudioContext 真渲染出样本做断言。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  var VOL_KEY = 'gw.vol', MUTE_KEY = 'gw.muted';
  var MAX_VOICES = 40;
  var ctx = null, master = null, bus = null, sn = null, voices = 0;
  var noiseBuf = null, waveCache = {}, driveCache = {};
  var volume = 0.22, muted = false, lastSkip = '';
  var seed = 0x2f6e2b1 >>> 0;

  function rnd() {                                   // mulberry32：确定性噪声表与冲激响应的来源
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function reseed(v) { seed = (v >>> 0) || 1; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ctor() { return window.AudioContext || window.webkitAudioContext || null; }
  function supported() { return !!ctor(); }

  function store(key, val) { try { localStorage.setItem(key, String(val)); } catch (e) { } }
  function load(key, dflt) {
    try { var v = localStorage.getItem(key); return v === null ? dflt : +v; } catch (e) { return dflt; }
  }

  /* ---------- 程序化素材：噪声表 / 混响冲激响应 / 波形 ---------- */
  function makeNoise(c, seconds) {
    var n = Math.max(1, Math.floor(c.sampleRate * seconds)), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0), s = seed;
    reseed(0x9e3779b9);
    for (var i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    seed = s;
    return b;
  }
  function makeIR(c, seconds, decay) {                // 噪声 × 指数衰减 + 早期反射，立体声去相关
    var n = Math.max(1, Math.floor(c.sampleRate * seconds)), b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), s = seed; reseed(0x1b873593 + ch * 7919);
      for (var i = 0; i < n; i++) {
        var t = i / n, a = Math.pow(1 - t, decay) * (i < c.sampleRate * 0.01 ? i / (c.sampleRate * 0.01) : 1);
        d[i] = (rnd() * 2 - 1) * a;
      }
      seed = s;
    }
    return b;
  }
  function wave(c, key, build) {
    if (!waveCache[key]) waveCache[key] = build();
    return waveCache[key];
  }
  function pulseWave(c, pw) {                          // 芯片味：占空比可调方波（傅里叶系数直接给 PeriodicWave）
    var h = 40, re = new Float32Array(h + 1), im = new Float32Array(h + 1), n;
    for (n = 1; n <= h; n++) im[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * pw);
    return c.createPeriodicWave(re, im, { disableNormalization: false });
  }
  function bellWave(c, mode) {                         // 钢片琴 / 钟：谐波列 + 非整数衰减，纯系数不采样
    var h = 14, re = new Float32Array(h + 1), im = new Float32Array(h + 1), n;
    for (n = 1; n <= h; n++) {
      var a = Math.exp(-n * (mode === 'glass' ? 0.55 : 0.42));
      im[n] = a * (1 + 0.32 * Math.sin(n * 2.1 + (mode === 'glass' ? 1.3 : 0)));
      re[n] = a * 0.28 * Math.cos(n * 1.7);
    }
    return c.createPeriodicWave(re, im, { disableNormalization: false });
  }
  function driveCurve(c, k) {
    if (!driveCache[k]) {
      var n = 512, cur = new Float32Array(n), i;
      for (i = 0; i < n; i++) cur[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / Math.tanh(k);
      driveCache[k] = cur;
    }
    return driveCache[k];
  }

  /* ---------- 总线 ---------- */
  function wires(c) {
    master = c.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(c.destination);
    bus = { sfx: c.createGain(), music: c.createGain() };
    bus.sfx.gain.value = 1; bus.music.gain.value = 1;
    bus.sfx.connect(master); bus.music.connect(master);
    var rev = c.createConvolver(); rev.buffer = makeIR(c, 1.5, 2.4);
    var revOut = c.createGain(); revOut.gain.value = 0.9;
    var revTrim = c.createGain(); revTrim.gain.value = 0.75;
    rev.connect(revTrim); revTrim.connect(revOut); revOut.connect(master);
    var dl = [c.createDelay(1), c.createDelay(1)], dg = [c.createGain(), c.createGain()];
    var dlp = [c.createBiquadFilter(), c.createBiquadFilter()], dOut = c.createGain();
    dl[0].delayTime.value = 0.19; dl[1].delayTime.value = 0.26;
    for (var i = 0; i < 2; i++) {
      dlp[i].type = 'lowpass'; dlp[i].frequency.value = 3200; dg[i].gain.value = 0.36;
      dl[i].connect(dlp[i]); dlp[i].connect(dg[i]);
    }
    dg[0].connect(dl[1]); dg[1].connect(dl[0]);
    dg[0].connect(dOut); dg[1].connect(dOut); dOut.connect(master);
    sn = { rev: c.createGain(), dly: c.createGain() };
    sn.rev.connect(rev); sn.dly.connect(dl[0]); sn.dly.connect(dl[1]);
    noiseBuf = makeNoise(c, 2);
  }
  function ensure() {
    if (ctx) return ctx;
    var C = ctor(); if (!C) return null;
    try { ctx = new C(); } catch (e) { ctx = null; return null; }
    volume = clamp(load(VOL_KEY, 0.22), 0, 0.6);
    muted = load(MUTE_KEY, 0) === 1;
    wires(ctx);
    return ctx;
  }

  /* ---------- 一层声音 ---------- */
  function envShape(g, t0, L) {
    var d = num(L.d, 0.15), a = num(L.a, 0.004), dec = num(L.dec, Math.min(0.06, d * 0.5));
    var s = clamp(num(L.s, 0.62), 1e-4, 1), r = num(L.r, Math.min(0.08, Math.max(0.012, d * 0.45)));
    var hold = Math.max(a + dec, d);
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(1e-4, t0);
    g.gain.linearRampToValueAtTime(1, t0 + Math.max(0.0004, a));
    if (s < 0.999) g.gain.exponentialRampToValueAtTime(Math.max(1e-4, s), t0 + a + dec);
    g.gain.setValueAtTime(Math.max(1e-4, s), t0 + hold);
    g.gain.exponentialRampToValueAtTime(1e-4, t0 + hold + r);
    return hold + r;
  }
  function biquad(c, type, f, q, f1, t0, span) {
    var b = c.createBiquadFilter();
    b.type = type; b.Q.value = num(q, 0.7071);
    b.frequency.setValueAtTime(clamp(f, 20, c.sampleRate * 0.45), t0);
    if (f1 && f1 !== f) b.frequency.exponentialRampToValueAtTime(clamp(f1, 20, c.sampleRate * 0.45), t0 + Math.max(0.01, span));
    return b;
  }
  /* L：一层配方（见 js/sfx-table.js 的字段说明）。返回这层占用的时长（秒）。 */
  function buildLayer(c, dest, L, t0) {
    var node, env = c.createGain();
    var tail = envShape(env, t0, L);
    var amp = c.createGain(); amp.gain.value = num(L.v, 0.3);
    var src;
    if (L.k === 'n') {
      src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      src.playbackRate.value = num(L.rate, 1);
      src.start(t0, rnd() * 1.5);
      src.stop(t0 + tail + 0.03);
    } else {
      src = c.createOscillator();
      var w = L.w || 'square', f = Math.max(12, num(L.f, 440));
      if (w === 'pulse') src.setPeriodicWave(wave(c, 'pulse' + num(L.pw, 0.25), function () { return pulseWave(c, num(L.pw, 0.25)); }));
      else if (w === 'bell' || w === 'glass') src.setPeriodicWave(wave(c, w, function () { return bellWave(c, w); }));
      else src.type = (w === 'tri' ? 'triangle' : w === 'saw' ? 'sawtooth' : w === 'square' ? 'square' : 'sine');
      src.frequency.setValueAtTime(f, t0);
      if (L.f1 && L.f1 !== f) src.frequency.exponentialRampToValueAtTime(Math.max(12, L.f1), t0 + Math.max(0.008, num(L.gt, 0.1)));
      if (L.vib) {
        var lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = num(L.vibR, 6); lg.gain.value = f * num(L.vib, 0.01);
        lfo.connect(lg); lg.connect(src.frequency); lfo.start(t0); lfo.stop(t0 + tail + 0.03);
      }
      src.start(t0); src.stop(t0 + tail + 0.03);
    }
    voices++;
    src.onended = function () { voices = Math.max(0, voices - 1); };
    node = src;
    if (L.bp) { var bp = biquad(c, 'bandpass', L.bp, L.bpQ, L.bp1, t0, tail); node.connect(bp); node = bp; }
    if (L.hp) { var hp = biquad(c, 'highpass', L.hp, L.q, L.hp1, t0, tail); node.connect(hp); node = hp; }
    if (L.lp) { var lp = biquad(c, 'lowpass', L.lp, L.q, L.lp1, t0, tail); node.connect(lp); node = lp; }
    node.connect(env); env.connect(amp);
    if (L.drive && L.drive > 1) {
      var ws = c.createWaveShaper(); ws.curve = driveCurve(c, num(L.drive, 1.5)); ws.oversample = '2x';
      amp.connect(ws); node = ws;
    } else node = amp;
    var pan = num(L.pan, 0.5);
    if (c.createStereoPanner) { var p = c.createStereoPanner(); p.pan.value = clamp((pan - 0.5) * 2, -1, 1); node.connect(p); node = p; }
    node.connect(dest);
    if (L.rev) { var rg = c.createGain(); rg.gain.value = num(L.rev, 0.2); node.connect(rg); rg.connect(sn.rev); }
    if (L.dly) { var dg2 = c.createGain(); dg2.gain.value = num(L.dly, 0.2); node.connect(dg2); dg2.connect(sn.dly); }
    return tail + num(L.at, 0);
  }
  /* 复音上限逐层判定：一条配方可能有多达 14 层，只在入口处判一次会顶穿上限，
     所以边建边查，建到上限就停——宁可少几层也不让节点数在爆炸场面里失控。 */
  function playLayers(layers, when, busName) {
    var c = ensure(); if (!c || muted) return false;
    if (!layers || !layers.length) return false;
    var t0 = c.currentTime + num(when, 0) + 0.002, dest = bus[busName] || bus.sfx, i, built = 0;
    for (i = 0; i < layers.length; i++) {
      if (voices >= MAX_VOICES) break;
      buildLayer(c, dest, layers[i], t0 + num(layers[i].at, 0));
      built++;
    }
    lastSkip = built === 0 ? 'budget' : (built < layers.length ? 'budget-part' : '');
    return built > 0;
  }
  /* 离线渲染同一份配方，返回 Float32 采样——回归脚本拿它断言"真的响了、没爆"。 */
  function renderLayers(layers, seconds) {
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return null;
    var sr = 44100, len = Math.max(1, Math.ceil(sr * seconds)), c;
    /* dither:'never' —— Chrome 的离线渲染默认加 TPDF 抖动（约 2^-24），那是给导出文件用的；
       回归要的是「同一份配方给出同一批样本」，所以必须关掉，否则确定性断言永远差个末位。 */
    try { c = new OC({ numberOfChannels: 2, length: len, sampleRate: sr, dither: 'never' }); }
    catch (err) { c = new OC(2, len, sr); }
    var m = c.createGain(); m.gain.value = 1; m.connect(c.destination);
    var b = c.createGain(); b.connect(m);
    var savedCtx = ctx, savedMaster = master, savedBus = bus, savedSn = sn, savedNoise = noiseBuf, savedWaves = waveCache, savedDrive = driveCache;
    ctx = null; master = m; bus = { sfx: b, music: b };
    var rev = c.createConvolver(); rev.buffer = makeIR(c, 1.2, 2.4);
    var revOut = c.createGain(); revOut.gain.value = 0.9; rev.connect(revOut); revOut.connect(m);
    var dl = [c.createDelay(1), c.createDelay(1)], dg = [c.createGain(), c.createGain()];
    dl[0].delayTime.value = 0.19; dl[1].delayTime.value = 0.26; dg[0].gain.value = 0.36; dg[1].gain.value = 0.36;
    dl[0].connect(dg[0]); dl[1].connect(dg[1]); dg[0].connect(dl[1]); dg[1].connect(dl[0]); dg[0].connect(m); dg[1].connect(m);
    sn = { rev: c.createGain(), dly: c.createGain() }; sn.rev.connect(rev); sn.dly.connect(dl[0]); sn.dly.connect(dl[1]);
    noiseBuf = makeNoise(c, 2); waveCache = {}; driveCache = {};
    reseed(0x5eed0000);                       /* 离线渲染走固定种子：同一份配方两次必须给出同一批样本 */
    var i, t0 = 0;
    for (i = 0; i < layers.length; i++) buildLayer(c, b, layers[i], num(layers[i].at, 0));
    var pr = c.startRendering();
    return pr.then(function (buf) {
      ctx = savedCtx; master = savedMaster; bus = savedBus; sn = savedSn; noiseBuf = savedNoise; waveCache = savedWaves; driveCache = savedDrive;
      return { L: buf.getChannelData(0), R: buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0), N: buf.length, sampleRate: buf.sampleRate };
    });
  }

  G.AudioEngine = {
    supported: supported,
    ctx: ensure,
    resume: function () { var c = ensure(); if (c && c.state === 'suspended' && c.resume) c.resume(); return !!c; },
    state: function () { return ctx ? ctx.state : 'none'; },
    playLayers: playLayers,
    renderLayers: renderLayers,
    setVolume: function (v) { volume = clamp(num(v, 0.22), 0, 0.6); store(VOL_KEY, volume); if (master) master.gain.value = muted ? 0 : volume; return volume; },
    volume: function () { return volume; },
    setMuted: function (b) { muted = !!b; store(MUTE_KEY, muted ? 1 : 0); if (master) master.gain.value = muted ? 0 : volume; return muted; },
    muted: function () { return muted; },
    busGain: function (which, v) { var c = ensure(); if (!c || !bus[which]) return null; bus[which].gain.value = clamp(num(v, bus[which].gain.value), 0, 2); return bus[which].gain.value; },
    voices: function () { return voices; },
    skipReason: function () { return lastSkip; },
    maxVoices: MAX_VOICES,
    reseed: reseed
  };
})(window.GW);
