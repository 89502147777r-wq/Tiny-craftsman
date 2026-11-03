// The sounds of the site: recorded foley (Freesound, CC0 / CC BY — CREDITS.md), cut and made light for
// phones (assets/sounds/*.mp3). Each sound has a few takes; every play picks one, a little higher or lower,
// a little louder or softer, so nothing repeats exactly. A sound at a place is as loud as it is near the
// camera. The machines and the power tools are loops whose pitch follows their revs; the day has its
// birds, the night its crickets, the rain and the wind are loops as loud as they are. Unlocked on the
// first touch (iOS). The old calls (stab, pour, scrape…, engine, rain, cash) all still work.
import { SOUNDS } from './sounds.js';

const KT = 10.4651;   // (the model's scale: 1 unit = KT m)
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; this.scrape = null; this.buf = new Map(); this.loops = new Map(); this.ear = null; this._last = {}; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.8;
    // (a gentle limiter: many sounds at once do not clip)
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(this.ctx.destination);
    // (the sounds most heard come first; the rest after them, quietly in the background)
    const first = ['shovel_dig', 'soil_dump', 'brick', 'block', 'tap', 'click', 'mallet', 'birds'];
    for (const n of first) this._load(n);
    setTimeout(() => { for (const n of Object.keys(SOUNDS)) this._load(n); }, 2500);
  }
  // the camera: what is near it is loud (set every frame)
  listen(pos) {
    this.ear = pos;
    // (a loop no one keeps going — a tool put down, a job done — fades out by itself)
    if (this.ctx) { const t = this.ctx.currentTime; for (const [id, L] of this.loops) if (L.auto && t - L.seen > 0.35 && L.g.gain.value > 0.003) this.loop(id, L.name, 0); }
  }

  _load(name) {
    const S = SOUNDS[name];
    if (!S || this.buf.has(name) || !this.ctx) return this.buf.get(name);
    const p = Promise.all(S.f.map((f) => fetch(`assets/sounds/${f}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(f)))).then((a) => new Promise((res, rej) => this.ctx.decodeAudioData(a, res, rej))).catch(() => null)))
      .then((list) => { const ok = list.filter(Boolean); this.buf.set(name, ok); return ok; });
    this.buf.set(name, p);
    return p;
  }
  _ready(name) { const b = this.buf.get(name); return Array.isArray(b) && b.length ? b : null; }
  _gainAt(at, range = 1) {
    if (!at || !this.ear) return 1;
    const d = Math.hypot(at.x - this.ear.x, at.y - this.ear.y, at.z - this.ear.z) * KT;   // (m)
    return 1 / (1 + Math.max(0, d - 3) / (12 * range));
  }

  // one sound once: opt { vol, rate, at (a place: as loud as it is near), gap (s: not again sooner) }
  play(name, opt = {}) {
    if (!this.enabled || !this.ctx) return;
    const S = SOUNDS[name]; if (!S) return;
    const now = this.ctx.currentTime, gap = opt.gap ?? S.gap ?? 0.05;
    if (now - (this._last[name] ?? -9) < gap) return;
    const list = this._ready(name);
    if (!list) { this._load(name); return; }
    this._last[name] = now;
    const b = list[Math.floor(Math.random() * list.length)];
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = b; src.playbackRate.value = (opt.rate ?? 1) * (S.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (S.jit ?? 0.06));
    g.gain.value = (opt.vol ?? 1) * (S.vol ?? 0.8) * (0.85 + Math.random() * 0.3) * this._gainAt(opt.at, S.range);
    src.connect(g).connect(this.master); src.start(now);
    return src;
  }
  // a sound going on while vol > 0 (by id): its loudness and its pitch follow (rate); vol 0 — it fades out
  loop(id, name, vol, rate = 1, at = null, auto = false) {
    if (!this.ctx) return;
    vol = this.enabled ? vol : 0;
    const t = this.ctx.currentTime, S = SOUNDS[name];
    let L = this.loops.get(id);
    if (L && L.name !== name) { this._stopLoop(id, L); L = null; }
    if (!L && vol > 0.004 && S) {
      const list = this._ready(name);
      if (!list) { this._load(name); return; }
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), b = list[Math.floor(Math.random() * list.length)];
      src.buffer = b; src.loop = true; g.gain.value = 0;
      src.connect(g).connect(this.master); src.start(t, Math.random() * Math.max(0, b.duration - 0.5));
      L = { src, g, name }; this.loops.set(id, L);
    }
    if (!L) return;
    if (vol > 0.004) { L.auto = auto; L.seen = t; }
    L.g.gain.setTargetAtTime(Math.min(1.2, vol * (S?.vol ?? 0.8) * this._gainAt(at, S?.range)), t, 0.08);
    L.src.playbackRate.setTargetAtTime(rate * (S?.rate ?? 1), t, 0.1);
    if (vol <= 0.004) { clearTimeout(L.end); L.end = setTimeout(() => { if (this.loops.get(id) === L && L.g.gain.value < 0.01) this._stopLoop(id, L); }, 700); }
  }
  _stopLoop(id, L) { try { L.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); L.src.stop(this.ctx.currentTime + 0.3); } catch { /* stopped */ } if (this.loops.get(id) === L) this.loops.delete(id); }

  // ---- the old calls ----------------------------------------------------------------------------
  // the scrape of a tool going along (its loudness follows how fast it goes): which tool — `name`
  scrapeStart(name = 'scrape') { this._scr = name; this._scrV = 0; this.loop('scrape', name, 0.001); }
  scrapeLevel(v) { if (this._scr) { this._scrV = v; this.loop('scrape', this._scr, Math.min(1, v * 1.2), 0.9 + v * 0.25); } }
  scrapeStop() { if (this._scr) this.loop('scrape', this._scr, 0); this._scr = null; }
  // the rain as loud as it rains; now and then thunder far off when it pours
  rain(v) {
    if (!this.ctx) return;
    this.loop('rain', 'rain', v * 0.9);
    if (v > 0.6 && Math.random() < 0.0006) this.play('thunder', { vol: 0.6 * v, gap: 12 });
  }
  // the day's birds, the night's crickets, the wind (0…1 each)
  ambience(day, night, wind = 0.15) {
    if (!this.ctx) return;
    this.loop('amb-day', 'birds', 0.32 * day);
    this.loop('amb-night', 'crickets', 0.3 * night);
    this.loop('amb-wind', 'wind', 0.25 * wind);
  }
  // an engine or a power tool (by id) at its revs (rpm 0 idling … 1 full)
  engine(id, vol, rpm = 0) {
    const name = ENGINES[id] || (id.startsWith('fit-drill') ? 'drill' : id.startsWith('fit-driver') ? 'screwdriver' : 'engine');
    const tool = !['loader', 'truck', 'excavator', 'engine'].includes(name);
    this.loop('eng-' + id, name, vol * (tool ? 1.6 : 1.4), tool ? 1 : 0.82 + rpm * 0.5, null, true);
  }
  stab() { this.play('tap'); }
  thud() { this.play('block'); return true; }
  cash() { this.play('cash'); }
  pour(amount = 1, kind = 'soil_pour') { this.play(kind, { vol: 0.5 + 0.5 * Math.min(1, amount), gap: 0.35 }); }
}
// the machines' engines and the tools: their loops
const ENGINES = { loader: 'loader', truck: 'truck', excavator: 'excavator', hydraulic: 'hydraulic', backup: 'backup', tip: 'truck_tip', breaker: 'jackhammer', 'col-auger': 'auger', 'col-bore': 'auger_dig', 'fence-auger': 'auger', grinder: 'grinder', welder: 'welding', pump: 'pump', mixer: 'mixer', compactor: 'compactor', vibrator: 'vibrator' };
