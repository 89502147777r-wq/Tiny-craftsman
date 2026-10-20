import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf } from './freeBrick.js';
const S = 1 / 1000 / MODEL_SCALE;

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

// The U-blocks laid together at one level: in line (end to end) or at a corner (the end of
// one against the inner side of another near its end — that one is the corner U-block: its
// side wall is cut there, the channels join). -> { boxes, links: [[ia, fa, ib, fb]], cuts:
// Map(id -> [{ side (±1 across it), at (along it, model) }]) }
export function uLinks(units) {
  const bs = units.filter((u) => u.kind === 'ublock' && u.p && u.s && u.q).map(boxOf);
  const links = [], cuts = new Map(), M = (v) => v * S;
  for (let i = 0; i < bs.length; i++) for (let j = 0; j < bs.length; j++) {
    if (i === j) continue;
    const A = bs[i], B = bs[j];
    if (Math.abs(A.bot - B.bot) > M(15)) continue;
    const par = Math.abs(Math.sin(A.yaw - B.yaw)) < 0.05, perp = Math.abs(Math.cos(A.yaw - B.yaw)) < 0.05;
    const dx = B.x - A.x, dz = B.z - A.z, al = dx * A.ux + dz * A.uz, ac = -dx * A.uz + dz * A.ux;
    if (par && i < j && Math.abs(ac) < M(10) && Math.abs(Math.abs(al) - A.hl - B.hl) < M(15)) {
      // end to end: A's end sample to B's nearest end sample
      const fa = al > 0 ? UN - 1 : 0, ex = A.x + A.ux * Math.sign(al) * A.hl, ez = A.z + A.uz * Math.sign(al) * A.hl;
      const fb = ((ex - B.x) * B.ux + (ez - B.z) * B.uz) > 0 ? UN - 1 : 0;
      links.push([i, fa, j, fb]);
    } else if (perp) {
      // B's end (the one towards A) against A's side, B outside A
      for (const sg of [-1, 1]) {
        const ex = B.x + B.ux * sg * B.hl, ez = B.z + B.uz * sg * B.hl;
        const eal = (ex - A.x) * A.ux + (ez - A.z) * A.uz, eac = -(ex - A.x) * A.uz + (ez - A.z) * A.ux;
        if (Math.abs(Math.abs(eac) - A.hw) > M(20) || Math.abs(eal) > A.hl - M(40) || Math.abs(ac) < A.hw) continue;
        const fa = Math.max(0, Math.min(UN - 1, Math.floor((eal + A.hl) / (2 * A.hl) * UN)));
        links.push([i, fa, j, sg > 0 ? UN - 1 : 0]);
        (cuts.get(A.u.id) || cuts.set(A.u.id, []).get(A.u.id)).push({ side: Math.sign(eac), at: eal });
      }
    }
  }
  return { boxes: bs, links, cuts };
}

// The concrete in the channels of a set of U-blocks joined in line and at corners: the
// samples of every block (UN along it) joined into a graph — along each block, end to end,
// and into the side of a corner block.
export class Channel {
  constructor(app, u) {
    const all = uLinks(app.objects.all('unit')), bs = all.boxes;
    const start = bs.findIndex((b) => b.u.id === u.id);
    // the U-blocks joined to this one
    const adj = new Map();
    for (const [i, , j] of all.links) { (adj.get(i) || adj.set(i, []).get(i)).push(j); (adj.get(j) || adj.set(j, []).get(j)).push(i); }
    const seen = new Set([start]), st = [start];
    while (st.length) { const k = st.pop(); for (const q of adj.get(k) || []) if (!seen.has(q)) { seen.add(q); st.push(q); } }
    const order = [...seen].sort((a, b) => a - b), slot = new Map(order.map((k, n) => [k, n]));
    this.blocks = order.map((k) => bs[k]);
    this.ids = new Set(this.blocks.map((b) => b.u.id));
    this.top = u.p[1] + u.s[1] / 2;   // (the rims)
    this.h = []; this.sm = [];
    for (const b of this.blocks) { this.h.push(...levels(b.u)); this.sm.push(...worked(b.u)); }
    // the edges: along each block, and the joints
    this.edges = [];
    this.blocks.forEach((b, n) => { for (let f = 0; f + 1 < UN; f++) this.edges.push([n * UN + f, n * UN + f + 1]); });
    for (const [i, fa, j, fb] of all.links) if (slot.has(i) && slot.has(j)) this.edges.push([slot.get(i) * UN + fa, slot.get(j) * UN + fb]);
    this.nb = this.h.map(() => []);
    for (const [a, b] of this.edges) { this.nb[a].push(b); this.nb[b].push(a); }
    this.spilt = 0;
  }

  has(u) { return !!u && this.ids.has(u.id); }
  get cap() { return UDEPTH; }
  topY() { return this.top; }

  // world position of a sample, on the concrete (or the floor of the channel)
  point(i) {
    const b = this.blocks[Math.floor(i / UN)], f = i % UN, s = -b.hl + (f + 0.5) / UN * 2 * b.hl;
    const floor = b.bot + (b.top - b.bot) * 60 / 250;
    return new THREE.Vector3(b.x + b.ux * s, floor + this.h[i] / 250 * (b.top - b.bot), b.z + b.uz * s);
  }
  // the sample under a world point
  at(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.h.length; i++) { const p = this.point(i), d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) bd = d, best = i; }
    return best;
  }
  dir(a, b) { const pa = this.point(a), pb = this.point(b), dx = pb.x - pa.x, dz = pb.z - pa.z, l = Math.hypot(dx, dz); if (l > 1e-6) return [dx / l, dz / l]; const B = this.blocks[Math.floor(a / UN)]; return [B.ux, B.uz]; }

  // `l` litres land at sample i (a splat over it and its neighbours)
  pour(i, l) {
    const ks = [i, ...this.nb[i]], w0 = 0.7, w1 = ks.length > 1 ? 0.3 / (ks.length - 1) : 0;
    this.h[i] += l * (ks.length > 1 ? w0 : 1) * MM_PER_L;
    for (const q of ks.slice(1)) this.h[q] += l * w1 * MM_PER_L;
  }

  _flow(d, yieldMm, k, only) {
    const h = this.h;
    let moved = 0;
    for (const [a, b] of this.edges) {
      if (only && (!only.has(a) || !only.has(b))) continue;
      const dh = h[a] - h[b], e = Math.abs(dh) - yieldMm;
      if (e <= 0) continue;
      const q = Math.sign(dh) * e * k * d * 0.5;
      h[a] -= q; h[b] += q; moved += Math.abs(q);
    }
    return moved;
  }
  // the flow along the channels (a Bingham fluid: it moves only where the slope is more
  // than it holds); returns how much moved
  step(dt) {
    let moved = 0;
    const subs = Math.max(1, Math.ceil(dt * K / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) {
      moved += this._flow(d, YIELD, K);
      // over the rim: it runs down the outside (gone)
      for (let i = 0; i < this.h.length; i++) if (this.h[i] > UDEPTH + 6) { const o = (this.h[i] - UDEPTH - 6) * Math.min(1, 8 * d); this.h[i] -= o; this.spilt += o / MM_PER_L; }
    }
    return moved;
  }
  _near(i, r) {
    const p = this.point(i), R = (r + 0.5) * 50 * S, set = new Set();
    for (let k = 0; k < this.h.length; k++) { const q = this.point(k); if (Math.hypot(q.x - p.x, q.z - p.z) <= R) set.add(k); }
    return set;
  }
  // the vibrator: within r samples (50 mm) of i the concrete runs level, the paste comes up
  vibrate(i, r, dt) {
    const near = this._near(i, r), subs = Math.max(1, Math.ceil(dt * K * 2 / 0.2)), d = dt / subs, p = this.point(i);
    for (let s = 0; s < subs; s++) this._flow(d, 0, K * 2, near);
    for (const k of near) { const q = this.point(k); this.sm[k] = Math.min(1, this.sm[k] + dt * 1.2 * (1 - Math.hypot(q.x - p.x, q.z - p.z) / ((r + 1) * 50 * S))); }
  }
  // the rule drawn from sample a to b, riding on the rims: what stands above them is pushed
  // on ahead (off the end of a run it falls off)
  rule(a, b) {
    const pa = this.point(a), pb = this.point(b), [dx, dz] = this.dir(a, b), L = Math.hypot(pb.x - pa.x, pb.z - pa.z), n = Math.max(1, Math.ceil(L / (40 * S)));
    for (let m = 0; m <= n; m++) {
      const x = pa.x + (pb.x - pa.x) * m / n, z = pa.z + (pb.z - pa.z) * m / n;
      for (let k = 0; k < this.h.length; k++) {
        const q = this.point(k), ex = q.x - x, ez = q.z - z;
        if (Math.abs(ex * dx + ez * dz) > 30 * S || Math.abs(-ex * dz + ez * dx) > 200 * S) continue;
        this.sm[k] = Math.min(1, Math.max(this.sm[k], 0.55));
        const over = this.h[k] - UDEPTH;
        if (over <= 0) continue;
        this.h[k] = UDEPTH;
        // on to the neighbour the rule goes towards
        let to = -1, best = 0.3;
        for (const j of this.nb[k]) { const r = this.point(j), ax = r.x - q.x, az = r.z - q.z, l = Math.hypot(ax, az) || 1, c = (ax * dx + az * dz) / l; if (c > best) best = c, to = j; }
        if (to >= 0) this.h[to] += over; else this.spilt += over / MM_PER_L;
      }
    }
  }
  // the float from a to b (450 mm long): a closed, smooth surface, a little more level
  float(a, b) {
    const near = new Set([...this._near(a, 4), ...this._near(b, 4)]), pa = this.point(a), pb = this.point(b), n = Math.ceil(Math.hypot(pb.x - pa.x, pb.z - pa.z) / (50 * S));
    for (let m = 1; m < n; m++) for (const k of this._near(this.at(pa.x + (pb.x - pa.x) * m / n, pa.z + (pb.z - pa.z) * m / n), 4)) near.add(k);
    for (let it = 0; it < 2; it++) this._flow(0.05, 0, 5, near);
    for (const k of near) this.sm[k] = Math.min(1, this.sm[k] + 0.35);
  }

  // let it come to rest
  settle() { for (let k = 0; k < 600 && this.step(0.05) > 0.05; k++); }

  get full() { return this.h.every((v) => v >= UDEPTH - 3); }

  // the levels by U-block id (in each block's own order)
  byId() { const m = new Map(); this.blocks.forEach((b, k) => m.set(b.u.id, this.h.slice(k * UN, k * UN + UN))); return m; }
  smById() { const m = new Map(); this.blocks.forEach((b, k) => m.set(b.u.id, this.sm.slice(k * UN, k * UN + UN))); return m; }
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
      app.objects.update(id, { lv, fill, sm, ...(fill > (u.fill || 0) + 1e-4 ? { wetT: +app.clock.toFixed(2) } : {}), ...(u.castT == null && fill > 0 ? { castT: +app.clock.toFixed(2) } : {}), ...(fill >= 0.95 && u.pourT == null ? { pourT: +app.clock.toFixed(2) } : {}) });
    }
  }
}
