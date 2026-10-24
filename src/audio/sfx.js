// Procedural foley (no samples needed): blade scraping through soil, crumbs
// pattering onto the pile. Unlocked on the first touch (iOS requirement).
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; this.scrape = null; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // crunchy noise: white noise with sparse clicks (grains of sand / small stones)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5 + (Math.random() < 0.004 ? (Math.random() * 2 - 1) * 2.5 : 0);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  _src(rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.playbackRate.value = rate;
    s.loopStart = Math.random(); s.loopEnd = s.loopStart + 0.8;
    return s;
  }

  // continuous scrape whose loudness follows blade speed
  scrapeStart() {
    if (!this.enabled || !this.ctx || this.scrape) return;
    const s = this._src(0.9), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8;
    g.gain.value = 0;
    s.connect(f).connect(g).connect(this.master);
    s.start(0, Math.random());
    this.scrape = { s, f, g };
  }

  scrapeLevel(v) {
    if (!this.scrape) return;
    const t = this.ctx.currentTime;
    this.scrape.g.gain.setTargetAtTime(Math.min(0.9, v), t, 0.03);
    this.scrape.f.frequency.setTargetAtTime(900 + v * 1600, t, 0.05);
  }

  scrapeStop() {
    if (!this.scrape) return;
    const { s, g } = this.scrape;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    s.stop(this.ctx.currentTime + 0.3);
    this.scrape = null;
  }

  // the rain: a soft wide hiss and the patter of drops, as loud as it rains
  rain(v) {
    if (!this.ctx) return;
    v = this.enabled ? v : 0;
    if (!this._rain && v > 0.01) {
      const s = this._src(0.6), lo = this.ctx.createBiquadFilter(), hi = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      lo.type = 'lowpass'; lo.frequency.value = 5200; hi.type = 'highpass'; hi.frequency.value = 400; g.gain.value = 0;
      s.connect(hi).connect(lo).connect(g).connect(this.master); s.start();
      this._rain = { s, g };
    }
    if (!this._rain) return;
    this._rain.g.gain.setTargetAtTime(0.16 * v, this.ctx.currentTime, 0.5);
    if (v > 0.2 && Math.random() < 0.15 * v) this._burst(0.03, 3000 + Math.random() * 3000, 3, 0.05 * v);
    if (v <= 0.01 && this._rain.g.gain.value < 0.002) { this._rain.s.stop(); this._rain = null; }
  }

  // a diesel engine (one voice per machine, by id): on while `vol` > 0; `rpm` 0 (idling) … 1 (full)
  // sets its pitch and how bright and rough it sounds — a low saw and square through a low-pass,
  // beating (the cylinders firing) at the firing rate
  engine(id, vol, rpm = 0) {
    if (!this.ctx) return;
    const e = (this._eng ||= {}), t = this.ctx.currentTime;
    vol = this.enabled ? vol : 0;
    let v = e[id];
    if (!v && vol > 0.005) {
      const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain(), am = this.ctx.createGain(), lfo = this.ctx.createOscillator(), dep = this.ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.Q.value = 2; g.gain.value = 0;
      lfo.type = 'triangle'; dep.gain.value = 0.35; am.gain.value = 0.65;
      lfo.connect(dep).connect(am.gain);
      const mix2 = this.ctx.createGain(); mix2.gain.value = 0.35;
      o1.connect(am); o2.connect(mix2).connect(am); am.connect(lp).connect(g).connect(this.master);
      o1.start(); o2.start(); lfo.start();
      v = e[id] = { o1, o2, lfo, lp, g };
    }
    if (!v) return;
    const f = 34 + rpm * 46;   // (≈ 1000 … 2400 rpm of a 4-cylinder: the firing rate)
    v.o1.frequency.setTargetAtTime(f, t, 0.12); v.o2.frequency.setTargetAtTime(f * 2.01, t, 0.12); v.lfo.frequency.setTargetAtTime(f / 2, t, 0.12);
    v.lp.frequency.setTargetAtTime(220 + rpm * 900, t, 0.15);
    v.g.gain.setTargetAtTime(Math.min(0.5, vol) * (0.55 + 0.45 * rpm), t, 0.15);
    if (vol <= 0.005 && v.g.gain.value < 0.003) { for (const o of [v.o1, v.o2, v.lfo]) o.stop(); delete e[id]; }
  }

  stab() { this._burst(0.09, 2200, 1.6, 0.6); }

  pour(amount = 1) {
    if (!this.enabled || !this.ctx) return;
    // a stream of tiny ticks + a soft hiss
    this._burst(0.45 + 0.2 * amount, 700, 0.7, 0.35 * amount);
    for (let i = 0; i < 14; i++) setTimeout(() => this._burst(0.02, 2500 + Math.random() * 2500, 4, 0.25 * Math.random()), 60 + Math.random() * 420);
  }

  _burst(dur, freq, q, vol) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this._src(1), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
}
