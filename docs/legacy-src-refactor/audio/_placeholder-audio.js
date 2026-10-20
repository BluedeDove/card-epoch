/* ================= GW.Audio =================
   WebAudio 程序化音效：不依赖任何音频文件，离线双击即可发声。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  var ctx = null, master = null, enabled = true;
  function ensure() {
    if (ctx) return ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; return null; }
    master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination);
    return ctx;
  }
  function tone(f0, f1, dur, type, vol, when) {
    var c = ensure(); if (!c || !enabled) return;
    var t = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol === undefined ? 0.5 : vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, filterFreq, sweep) {
    var c = ensure(); if (!c || !enabled) return;
    var len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var s = c.createBufferSource(); s.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(filterFreq || 1200, c.currentTime);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, sweep), c.currentTime + dur);
    var g = c.createGain(); g.gain.value = vol === undefined ? 0.35 : vol;
    s.connect(f); f.connect(g); g.connect(master); s.start();
  }
  var SFX = {
    cast: function () { tone(520, 900, 0.16, 'triangle', 0.35); },
    shoot: function () { tone(760, 260, 0.12, 'square', 0.24); },
    hit: function () { noise(0.12, 0.3, 2600, 400); tone(180, 90, 0.1, 'square', 0.2); },
    boom: function () { noise(0.5, 0.6, 900, 60); tone(90, 40, 0.4, 'sine', 0.35); },
    terrain: function () { noise(0.22, 0.4, 1400, 300); tone(140, 200, 0.14, 'square', 0.16); },
    sigil: function () { tone(300, 1200, 0.5, 'sine', 0.22); tone(450, 1500, 0.5, 'triangle', 0.14, 0.05); },
    sigilGo: function () { tone(900, 300, 0.3, 'sawtooth', 0.2); noise(0.25, 0.3, 1800, 200); },
    shield: function () { tone(600, 1100, 0.18, 'sine', 0.25); },
    heal: function () { tone(680, 1020, 0.22, 'sine', 0.22); tone(880, 1320, 0.22, 'sine', 0.14, 0.08); },
    crystal: function () { tone(1200, 1800, 0.18, 'triangle', 0.3); tone(1600, 2400, 0.14, 'sine', 0.18, 0.05); },
    jump: function () { tone(300, 480, 0.1, 'square', 0.12); },
    melee: function () { noise(0.1, 0.28, 1800, 500); },
    push: function () { tone(220, 90, 0.2, 'sine', 0.3); noise(0.18, 0.2, 800, 120); },
    die: function () { tone(300, 60, 0.7, 'sawtooth', 0.3); },
    summonDie: function () { tone(420, 140, 0.3, 'triangle', 0.2); },
    win: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, f, 0.24, 'square', 0.25, i * 0.13); }); },
    ui: function () { tone(880, 880, 0.05, 'square', 0.14); },
    deny: function () { tone(180, 120, 0.14, 'square', 0.2); }
  };
  G.Audio = {
    play: function (name) { var f = SFX[name]; if (f) { try { f(); } catch (e) { } } },
    toggle: function () { enabled = !enabled; return enabled; },
    resume: function () { var c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    get enabled() { return enabled; }
  };
})(window.GW);
