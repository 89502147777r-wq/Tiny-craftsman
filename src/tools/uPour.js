import * as THREE from 'three';
import { uRun } from './lintels.js';

// Concrete in the channel of a run of U-blocks: the level along the channel, sampled
// every 50 mm (UN samples per block). Poured in at one spot it heaps up, then flows
// along the channel until the slope is what fresh concrete holds (a yield stress), so the
// channel fills from the spout outwards with a smooth, gently sloping surface. Above the
// rim it runs over (lost). The levels (mm above the channel floor) are stored on the
// U-blocks as `lv`; `fill` (0 … 1) is their mean.
export const UN = 12;
export const UDEPTH = 190;           // the channel: 190 mm deep (its floor 60 mm), 150 mm wide
const MM_PER_L = 1 / (0.05 * 0.15);   // 1 l over one 50 × 150 mm cell: 133 mm
const YIELD = 1.2;                    // mm of level difference between cells it holds
const K = 7;                          // how fast it flows (1/s)

// how much the surface has been worked (0 as poured … 1 vibrated and trowelled): the
// stones sink, the paste closes over them, it is flatter and glossier
export const SM0 = 0.3;
export function worked(u) {
  if (Array.isArray(u.sm) && u.sm.length === UN) return u.sm.slice();
  return new Array(UN).fill(SM0);
}

export function levels(u) {
  if (Array.isArray(u.lv) && u.lv.length === UN) return u.lv.slice();
  return new Array(UN).fill(Math.min(1, u.fill || 0) * UDEPTH);
}

export class Channel {
  // the run of U-blocks `u` is in, its samples in order along the run
  constructor(app, u) {
    const R = uRun(app, new THREE.Vector3(u.p[0], 0, u.p[2]), null, null);
    const pick = R ? R.pick : null, run = R ? R.run : null;
    this.blocks = [];
    if (run) {
      const s = (b) => (b.x - pick.x) * pick.ux + (b.z - pick.z) * pick.uz;
      for (const b of [...run].sort((a, c) => s(a) - s(c))) this.blocks.push({ u: b.u, rev: b.ux * pick.ux + b.uz * pick.uz < 0 });
      this.ax = { x: pick.x, z: pick.z, ux: pick.ux, uz: pick.uz };
    } else {
      const yaw = 2 * Math.atan2(u.q[1], u.q[3]);
      this.blocks.push({ u, rev: false });
      this.ax = { x: u.p[0], z: u.p[2], ux: Math.cos(yaw), uz: -Math.sin(yaw) };
    }
    this.ids = new Set(this.blocks.map((b) => b.u.id));
    this.top = u.p[1] + u.s[1] / 2;   // (the rims)
    this.h = [];
    this.sm = [];
    for (const b of this.blocks) {
      const l = levels(b.u), w = worked(b.u);
      this.h.push(...(b.rev ? l.reverse() : l)); this.sm.push(...(b.rev ? w.reverse() : w));
    }
    this.spilt = 0;
  }

  has(u) { return !!u && this.ids.has(u.id); }
  get cap() { return UDEPTH; }
  topY() { return this.top; }
  // the direction along the run from sample a to sample b
  dir(a, b) { const sg = b >= a ? 1 : -1; return [this.ax.ux * sg, this.ax.uz * sg]; }
  // the rule drawn from sample a to b (riding on the rims), the float over them
  rule(a, b) { const sg = b >= a ? 1 : -1; for (let j = a; j !== b + sg; j += sg) this.screed(j, sg); }
  float(a, b) { this.trowel(Math.min(a, b) - 4, Math.max(a, b) + 4); }

  // the sample under a world point
  at(x, z) {
    const s = (x - this.ax.x) * this.ax.ux + (z - this.ax.z) * this.ax.uz;
    let best = 0, bd = Infinity;
    this.blocks.forEach((b, k) => {
      const u = b.u, half = u.s[0] / 2, c = (u.p[0] - this.ax.x) * this.ax.ux + (u.p[2] - this.ax.z) * this.ax.uz;
      const f = Math.max(0, Math.min(UN - 1, Math.floor((s - (c - half)) / (2 * half) * UN)));
      const d = Math.abs(s - c);
      if (d < bd) bd = d, best = k * UN + f;
    });
    return best;
  }

  // world position of a sample, on the concrete (or the floor of the channel)
  point(i) {
    const b = this.blocks[Math.floor(i / UN)], u = b.u, f = i % UN, half = u.s[0] / 2;
    const c = (u.p[0] - this.ax.x) * this.ax.ux + (u.p[2] - this.ax.z) * this.ax.uz;
    const s = c - half + (f + 0.5) / UN * 2 * half;
    const floor = u.p[1] - u.s[1] / 2 + u.s[1] * 60 / 250;
    return new THREE.Vector3(this.ax.x + this.ax.ux * s, floor + this.h[i] / 250 * u.s[1], this.ax.z + this.ax.uz * s);
  }

  // `l` litres land at sample i (a splat over a few cells)
  pour(i, l) {
    const w = [0.15, 0.7, 0.15];
    for (let k = -1; k <= 1; k++) {
      const j = Math.max(0, Math.min(this.h.length - 1, i + k));
      this.h[j] += l * w[k + 1] * MM_PER_L;
    }
  }

  // the flow along the channel (a Bingham fluid: it moves only where the slope is more
  // than it holds); returns how much moved
  step(dt) {
    const h = this.h, n = h.length;
    let moved = 0;
    const subs = Math.max(1, Math.ceil(dt * K / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) {
      for (let i = 0; i + 1 < n; i++) {
        const dh = h[i] - h[i + 1], e = Math.abs(dh) - YIELD;
        if (e <= 0) continue;
        const q = Math.sign(dh) * e * K * d * 0.5;
        h[i] -= q; h[i + 1] += q; moved += Math.abs(q);
      }
      // over the rim: it runs down the outside (gone)
      for (let i = 0; i < n; i++) if (h[i] > UDEPTH + 6) { const o = (h[i] - UDEPTH - 6) * Math.min(1, 8 * d); h[i] -= o; this.spilt += o / MM_PER_L; }
    }
    return moved;
  }

  // the vibrator: within r samples of i the concrete loses its stiffness and runs level
  // (no yield), the worked share rises
  vibrate(i, r, dt) {
    const h = this.h, n = h.length, i0 = Math.max(0, i - r), i1 = Math.min(n - 1, i + r);
    const subs = Math.max(1, Math.ceil(dt * K * 2 / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) for (let j = i0; j < i1; j++) { const q = (h[j] - h[j + 1]) * K * 2 * d * 0.5; h[j] -= q; h[j + 1] += q; }
    for (let j = i0; j <= i1; j++) this.sm[j] = Math.min(1, this.sm[j] + dt * 1.2 * (1 - Math.abs(j - i) / (r + 1)));
  }

  // the rule drawn over sample i in direction sg (±1), riding on the rims: what stands above
  // the rim is pushed on ahead (off the end of the run it falls off)
  screed(i, sg) {
    const h = this.h, ex = h[i] - UDEPTH;
    if (ex > 0) { h[i] = UDEPTH; const j = i + sg; if (j >= 0 && j < h.length) h[j] += ex; else this.spilt += ex / MM_PER_L; }
    this.sm[i] = Math.min(1, Math.max(this.sm[i], 0.55));
  }

  // the float over samples i0 … i1: a closed, smooth surface (and a little more level)
  trowel(i0, i1, dt) {
    const h = this.h, a = Math.max(0, Math.min(i0, i1)), b = Math.min(h.length - 1, Math.max(i0, i1));
    for (let j = a; j < b; j++) { const q = (h[j] - h[j + 1]) * 0.25; h[j] -= q; h[j + 1] += q; }
    for (let j = a; j <= b; j++) this.sm[j] = Math.min(1, this.sm[j] + 0.35);
    void dt;
  }

  // let it come to rest
  settle() { for (let k = 0; k < 600 && this.step(0.05) > 0.05; k++); }

  get full() { return this.h.every((v) => v >= UDEPTH - 3); }

  // the levels by U-block id (for the view while pouring)
  byId() {
    const m = new Map();
    this.blocks.forEach((b, k) => { const l = this.h.slice(k * UN, k * UN + UN); m.set(b.u.id, b.rev ? l.reverse() : l); });
    return m;
  }
  smById() {
    const m = new Map();
    this.blocks.forEach((b, k) => { const l = this.sm.slice(k * UN, k * UN + UN); m.set(b.u.id, b.rev ? l.reverse() : l); });
    return m;
  }
  // (the view, while it is being worked)
  show(v) { v.fillLive = this.byId(); v.fillLiveSm = this.smById(); v.fillDirty = true; }

  // into the records (in the open journal entry)
  write(app) {
    const sms = this.smById();
    for (const [id, l] of this.byId()) {
      const u = app.objects.get(id);
      if (!u) continue;
      const lv = l.map((v) => Math.round(Math.max(0, Math.min(UDEPTH, v)) * 2) / 2);
      const fill = +(lv.reduce((a, v) => a + v, 0) / UN / UDEPTH).toFixed(4);
      const sm = sms.get(id).map((v) => Math.round(v * 100) / 100);
      if (u.lv && u.lv.every((v, k) => v === lv[k]) && Array.isArray(u.sm) && u.sm.every((v, k) => v === sm[k])) continue;
      app.objects.update(id, { lv, fill, sm, ...(u.castT == null && fill > 0 ? { castT: +app.clock.toFixed(2) } : {}), ...(fill >= 0.95 && u.pourT == null ? { pourT: +app.clock.toFixed(2) } : {}) });
    }
  }
}
