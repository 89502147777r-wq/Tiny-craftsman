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
    this.h = [];
    for (const b of this.blocks) { const l = levels(b.u); this.h.push(...(b.rev ? l.reverse() : l)); }
    this.spilt = 0;
  }

  has(u) { return !!u && this.ids.has(u.id); }

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

  // let it come to rest
  settle() { for (let k = 0; k < 600 && this.step(0.05) > 0.05; k++); }

  get full() { return this.h.every((v) => v >= UDEPTH - 3); }

  // the levels by U-block id (for the view while pouring)
  byId() {
    const m = new Map();
    this.blocks.forEach((b, k) => { const l = this.h.slice(k * UN, k * UN + UN); m.set(b.u.id, b.rev ? l.reverse() : l); });
    return m;
  }

  // into the records (in the open journal entry)
  write(app) {
    for (const [id, l] of this.byId()) {
      const u = app.objects.get(id);
      if (!u) continue;
      const lv = l.map((v) => Math.round(Math.max(0, Math.min(UDEPTH, v)) * 2) / 2);
      const fill = +(lv.reduce((a, v) => a + v, 0) / UN / UDEPTH).toFixed(4);
      if (u.lv && u.lv.every((v, k) => v === lv[k])) continue;
      app.objects.update(id, { lv, fill, ...(fill >= 0.95 && u.pourT == null ? { pourT: +app.clock.toFixed(2) } : {}) });
    }
  }
}
