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
