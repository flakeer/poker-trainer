
/*!
 * Sound effects, synthesized live with the Web Audio API (no audio files, works offline).
 * Browsers only allow sound after a click or key press; the first one unlocks it automatically.
 * Sounds: deal, flip, chip, check, fold, turn, win, lose, allin.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerSFX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KEY = 'poker.sfx.v1';
  let ctx = null, master = null, noiseBuf = null, rev = null, muted = false, vol = 0.6;
  const last = {}, MIN_GAP = { deal: 0.03, flip: 0.03 };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) { muted = !!s.muted; if (typeof s.vol === 'number') vol = s.vol; } } catch (e) { /* defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ muted: muted, vol: vol })); } catch (e) { /* ignore */ } };
  const rnd = () => Math.random();

  function ac() {
    if (ctx) return ctx;
    const C = (typeof AudioContext !== 'undefined' && AudioContext) || (typeof webkitAudioContext !== 'undefined' && webkitAudioContext);
    if (!C) return null;
    try {
      ctx = new C(); master = ctx.createGain(); master.gain.value = muted ? 0 : vol;
      // gentle compressor so stacked sounds never clip, plus a small room reverb
      let out = master;
      if (ctx.createDynamicsCompressor) { const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; master.connect(comp); comp.connect(ctx.destination); out = comp; }
      else master.connect(ctx.destination);
      if (ctx.createConvolver) {
        const len = Math.floor(ctx.sampleRate * 1.1), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        rev = ctx.createConvolver(); rev.buffer = ir;
        const rg = ctx.createGain(); rg.gain.value = 0.45; rev.connect(rg); rg.connect(master);
      }
    } catch (e) { ctx = null; }
    return ctx;
  }
  function unlock() { const c = ac(); if (c && c.state === 'suspended' && c.resume) c.resume(); }
  if (typeof document !== 'undefined' && document.addEventListener) {
    ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));
  }

  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const n = ctx.sampleRate | 0 || 44100;
    noiseBuf = ctx.createBuffer(1, n, n);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    return noiseBuf;
  }
  function env(g, t, dur, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function noise(t, dur, o) {
    o = o || {};
    const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer();
    fl.type = o.type || 'highpass';
    fl.frequency.setValueAtTime(o.f || 3000, t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    fl.Q.value = o.q || 1;
    env(g, t, dur, o.g || 0.3);
    src.connect(fl); fl.connect(g); g.connect(master);
    if (o.rv && rev) { const s = ctx.createGain(); s.gain.value = o.rv; g.connect(s); s.connect(rev); }
    src.start(t); src.stop(t + dur + 0.02);
  }
  function tone(t, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f || 440, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    env(g, t, dur, o.g || 0.15);
    osc.connect(g); g.connect(master);
    if (o.rv && rev) { const s = ctx.createGain(); s.gain.value = o.rv; g.connect(s); s.connect(rev); }
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  function chips(t, n) {
    let tt = t;
    for (let i = 0; i < n; i++) {
      tone(tt, 0.05, { type: 'triangle', f: 1900 + rnd() * 700, f2: 1300, g: 0.12 });
      noise(tt, 0.04, { type: 'bandpass', f: 4200, q: 2, g: 0.3 });
      tt += 0.045 + rnd() * 0.03;
    }
  }

  const SOUNDS = {
    deal: (t) => { noise(t, 0.05, { type: 'highpass', f: 2500, g: 0.35 }); tone(t, 0.03, { type: 'triangle', f: 1200, f2: 700, g: 0.05 }); },
    flip: (t) => noise(t, 0.08, { type: 'bandpass', f: 1800, q: 0.8, g: 0.3 }),
    chip: (t, o) => chips(t, o.n || 2),
    check: (t) => { for (let k = 0; k < 2; k++) { const tt = t + k * 0.09; tone(tt, 0.07, { f: 170, f2: 110, g: 0.35 }); noise(tt, 0.05, { type: 'lowpass', f: 700, g: 0.25 }); } },
    fold: (t) => noise(t, 0.2, { type: 'bandpass', f: 3200, f2: 700, q: 0.7, g: 0.3 }),
    turn: (t) => { tone(t, 0.14, { f: 880, f2: 1180, g: 0.14 }); tone(t + 0.09, 0.16, { f: 1320, g: 0.09 }); },
    win: (t, o) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.09, 0.28, { type: 'triangle', f: f, g: 0.16 }));
      if (o.big) for (let i = 0; i < 7; i++) tone(t + 0.3 + i * 0.07, 0.18, { f: 2000 + rnd() * 2200, g: 0.05 });
    },
    lose: (t) => tone(t, 0.4, { f: 240, f2: 130, g: 0.2 }),
    allin: (t) => { chips(t, 8); tone(t, 0.5, { type: 'sawtooth', f: 70, f2: 45, g: 0.1 }); }
  };

  // ---- upgraded sound set (overrides the basic versions above, adds new names) ----
  function clacks(t, n, rise) {
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = (1900 + rnd() * 900) * (1 + (rise ? i * 0.045 : 0));
      tone(tt, 0.07, { f: f, f2: f * 0.62, g: 0.11, rv: 0.12 });
      tone(tt, 0.045, { f: f * 1.52, f2: f, g: 0.05 });
      noise(tt, 0.035, { type: 'bandpass', f: 4800, q: 3, g: 0.24 });
      tt += 0.04 + rnd() * 0.035;
    }
    return tt;
  }
  function swish(t, dur, f1, f2, g) { noise(t, dur, { type: 'bandpass', f: f1, f2: f2, q: 0.9, g: g || 0.25 }); }
  function ping(t, f, dur, g, rv) { tone(t, dur, { f: f, g: g || 0.12, rv: rv === undefined ? 0.35 : rv }); tone(t, dur * 0.6, { f: f * 2.01, g: (g || 0.12) * 0.25, rv: 0.2 }); }
  Object.assign(SOUNDS, {
    chip: (t, o) => clacks(t, o.n || 2, false),
    raise: (t) => { const e = clacks(t, 5, true); ping(e + 0.02, 880, 0.3, 0.06, 0.3); },
    deal: (t) => { swish(t, 0.07, 2000, 5200, 0.26); tone(t + 0.045, 0.025, { type: 'triangle', f: 900, f2: 600, g: 0.05 }); },
    flip: (t) => { swish(t, 0.1, 1300, 3400, 0.24); tone(t + 0.07, 0.03, { type: 'triangle', f: 1400, f2: 900, g: 0.05 }); },
    check: (t) => { for (let k = 0; k < 2; k++) { const tt = t + k * 0.085; tone(tt, 0.08, { f: 200, f2: 85, g: 0.38 }); noise(tt, 0.05, { type: 'lowpass', f: 900, g: 0.28 }); } },
    fold: (t) => { swish(t, 0.24, 3800, 800, 0.26); tone(t + 0.16, 0.07, { f: 130, f2: 80, g: 0.12 }); },
    turn: (t) => { ping(t, 988, 0.22, 0.1, 0.4); ping(t + 0.11, 1319, 0.3, 0.08, 0.4); },
    allin: (t) => {
      clacks(t, 12, true);
      swish(t, 0.6, 300, 4200, 0.12);
      tone(t, 0.8, { f: 95, f2: 38, g: 0.22 });
      tone(t + 0.5, 0.5, { type: 'sawtooth', f: 62, f2: 40, g: 0.1, rv: 0.2 });
      noise(t + 0.52, 0.3, { type: 'lowpass', f: 500, f2: 120, g: 0.3 });
    },
    sweep: (t) => { swish(t, 0.5, 1400, 5200, 0.1); clacks(t + 0.02, 7, false); },
    win: (t, o) => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(t + i * 0.085, 0.45, { type: 'triangle', f: f, g: 0.15, rv: 0.35 }));
      ping(t + 0.45, 2093, 0.9, 0.06, 0.5);
      if (o.big) for (let i = 0; i < 14; i++) ping(t + 0.35 + i * 0.06 + rnd() * 0.03, 1800 + rnd() * 2600, 0.14, 0.05, 0.25);
    },
    lose: (t) => { tone(t, 0.55, { type: 'triangle', f: 330, f2: 160, g: 0.16, rv: 0.3 }); tone(t + 0.16, 0.7, { type: 'triangle', f: 247, f2: 105, g: 0.13, rv: 0.3 }); },
    click: (t) => { tone(t, 0.03, { f: 1250, f2: 760, g: 0.07 }); noise(t, 0.018, { type: 'highpass', f: 6000, g: 0.1 }); },
    tick: (t) => tone(t, 0.02, { f: 1900, g: 0.025 }),
    shuffle: (t) => { for (let i = 0; i < 12; i++) swish(t + i * 0.035 + rnd() * 0.015, 0.06, 1800 + rnd() * 1800, 3500 + rnd() * 2500, 0.14); noise(t + 0.46, 0.12, { type: 'bandpass', f: 2600, q: 0.6, g: 0.2 }); },
    levelup: (t) => { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => ping(t + i * 0.09, f, 0.5, 0.11, 0.4)); for (let i = 0; i < 8; i++) ping(t + 0.45 + i * 0.05, 2200 + rnd() * 2000, 0.16, 0.04, 0.3); },
    badge: (t) => { ping(t, 1568, 0.9, 0.12, 0.5); ping(t + 0.1, 2093, 1.0, 0.1, 0.5); ping(t + 0.2, 3136, 0.8, 0.05, 0.5); },
    error: (t) => { for (let k = 0; k < 2; k++) tone(t + k * 0.11, 0.09, { type: 'square', f: 150, f2: 120, g: 0.05 }); },
    beep: (t) => tone(t, 0.09, { type: 'square', f: 880, g: 0.05 }),
    timeup: (t) => { tone(t, 0.35, { type: 'sawtooth', f: 300, f2: 110, g: 0.12, rv: 0.2 }); noise(t, 0.12, { type: 'lowpass', f: 600, g: 0.2 }); }
  });
  MIN_GAP.click = 0.02; MIN_GAP.tick = 0.05; MIN_GAP.sweep = 0.4;

  function play(name, opts) {
    opts = opts || {};
    if (muted || !SOUNDS[name]) return false;
    const c = ac();
    if (!c) return false;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      const t = c.currentTime + (opts.delay || 0);
      if (MIN_GAP[name] && t - (last[name] === undefined ? -1 : last[name]) < MIN_GAP[name]) return false;
      last[name] = t;
      SOUNDS[name](t, opts);
      return true;
    } catch (e) { return false; }
  }
  function applyGain() { if (master) { try { master.gain.setTargetAtTime(muted ? 0 : vol, ctx.currentTime, 0.02); } catch (e) { master.gain.value = muted ? 0 : vol; } } }

  return {
    play: play, unlock: unlock, names: Object.keys(SOUNDS),
    isMuted: () => muted, getVolume: () => vol,
    setMuted(b) { muted = !!b; applyGain(); save(); },
    toggle() { muted = !muted; applyGain(); save(); return muted; },
    setVolume(x) { vol = Math.max(0, Math.min(1, +x || 0)); applyGain(); save(); }
  };
});

