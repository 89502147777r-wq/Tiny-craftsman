import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf } from './freeBrick.js';

// The ring beam (армопояс) cast in a timber formwork on the top course of the walls, as on
// site: boards on edge along both faces of the top course (100 mm down over the masonry,
// 250 mm above it) with studs every 600 mm; a cage of 4 bars Ø12 in stirrups Ø6 along
// every wall, the bars run through the corners; concrete from the bucket or the hose runs
// along the whole ring (round the corners too); the vibrator, the rule on the boards, the
// trowel; once it has set the boards come off.
//
// The ring's plan is a grid of 50 mm cells in the frame of the walls (the top course of a
// house is square to itself): the cells over the top course, joined into one piece.
//   belt { o:[x,z], u:[ux,uz], c, ni, nj, mask (run lengths, from "outside"), top, H,
//          lv[] (mm of concrete per inside cell), sm[], fill, castT, pourT, set, stripped,
//          segs: [[s0,t0,s1,t1,w]…] (the walls, for the cage) }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const BELT = { cell: 50, H: 250, over: 100, board: 25, cover: 40 };
const YIELD = 1.2, K = 30;   // (it runs along the beam quicker than in a narrow channel)

// ---- the plan ------------------------------------------------------------------------------
export function rle(mask) {
  const out = [];
  let v = 0, n = 0;
  for (const m of mask) { if (m === v) n++; else { out.push(n); v = m; n = 1; } }
  out.push(n);
  return out;
}
export function unrle(runs, size) {
  const m = new Uint8Array(size);
  let k = 0, v = 0;
  for (const n of runs) { if (v) m.fill(1, k, k + n); k += n; v ^= 1; }
  return m;
}

// the cells of a belt record, its inside cells (row-major) and their neighbours
const _cache = new Map();
export function plan(b) {
  const key = b.id + ':' + b.mask.length + ':' + b.ni + 'x' + b.nj;
  const c = _cache.get(key);
  if (c && c.rec === b.mask) return c;
  const mask = unrle(b.mask, b.ni * b.nj), cells = [], index = new Int32Array(b.ni * b.nj).fill(-1);
  for (let j = 0; j < b.nj; j++) for (let i = 0; i < b.ni; i++) if (mask[j * b.ni + i]) { index[j * b.ni + i] = cells.length; cells.push([i, j]); }
  const nb = cells.map(([i, j]) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].map(([a, d]) => (a >= 0 && d >= 0 && a < b.ni && d < b.nj ? index[d * b.ni + a] : -1)));
  const out = { rec: b.mask, mask, cells, index, nb };
  _cache.set(key, out);
  return out;
}
// frame ⇄ plot
export const toWorld = (b, s, t) => [b.o[0] + b.u[0] * s - b.u[1] * t, b.o[1] + b.u[1] * s + b.u[0] * t];
export const toFrame = (b, x, z) => { const dx = x - b.o[0], dz = z - b.o[1]; return [dx * b.u[0] + dz * b.u[1], -dx * b.u[1] + dz * b.u[0]]; };
export function cellAt(b, x, z) {
  const [s, t] = toFrame(b, x, z), i = Math.floor(s / b.c), j = Math.floor(t / b.c);
  return i >= 0 && j >= 0 && i < b.ni && j < b.nj ? j * b.ni + i : -1;
}
export function beltContains(b, x, z) { const k = cellAt(b, x, z); return k >= 0 && plan(b).index[k] >= 0; }
// two plans share ground (a few of the cells of one in the other)
export function beltsOverlap(a, b) {
  const P = plan(b), step = Math.max(1, Math.floor(P.cells.length / 200));
  for (let k = 0; k < P.cells.length; k += step) { const [i, j] = P.cells[k], [x, z] = toWorld(b, (i + 0.5) * b.c, (j + 0.5) * b.c); if (beltContains(a, x, z)) return true; }
  return false;
}

// The ring on the top course under the finger: { rec (a belt without id), n cells } or null
export function findBelt(app, p, screen, finger) {
  const boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf);
  // the top under the finger
  let pick = null, bd = Infinity;
  for (const b of boxes) {
    let d;
    if (finger) { const sp = screen(new THREE.Vector3(b.x, b.top, b.z)); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 140) continue; }
    else { const dx = p.x - b.x, dz = p.z - b.z; if (Math.abs(dx * b.ux + dz * b.uz) > b.hl + 0.01 || Math.abs(-dx * b.uz + dz * b.ux) > b.hw + 0.01) continue; d = Math.abs(p.y - b.top); }
    d -= b.top * 1e-3;   // (the top one)
    if (d < bd) bd = d, pick = b;
  }
  if (!pick) return null;
  // nothing on it
  if (boxes.some((o) => o.bot > pick.top - MM(5) && o.bot < pick.top + MM(30) && Math.hypot(o.x - pick.x, o.z - pick.z) < o.hl + pick.hl)) return null;
  const T = pick.top, ux = pick.ux, uz = pick.uz;
  const tops = boxes.filter((b) => Math.abs(b.top - T) < MM(15) && Math.abs(Math.sin(2 * (b.yaw - pick.yaw))) < 0.05);
  // the frame: the walls' directions; its origin at the lowest corner of them all
  const fr = (b) => { const s = b.x * ux + b.z * uz, t = -b.x * uz + b.z * ux, par = Math.abs(Math.cos(b.yaw - pick.yaw)) > 0.7; return { s, t, hs: par ? b.hl : b.hw, ht: par ? b.hw : b.hl }; };
  const F = tops.map(fr);
  const c = MM(BELT.cell), pad = c;
  const s0 = Math.min(...F.map((f) => f.s - f.hs)) - pad, t0 = Math.min(...F.map((f) => f.t - f.ht)) - pad;
  const s1 = Math.max(...F.map((f) => f.s + f.hs)) + pad, t1 = Math.max(...F.map((f) => f.t + f.ht)) + pad;
  const ni = Math.ceil((s1 - s0) / c), nj = Math.ceil((t1 - t0) / c);
  if (ni * nj > 400000) return null;
  const m = new Uint8Array(ni * nj), e = MM(4);   // (the joints between the units are bridged)
  for (const f of F) {
    const i0 = Math.ceil((f.s - f.hs - e - s0) / c - 0.5), i1 = Math.floor((f.s + f.hs + e - s0) / c - 0.5);
    const j0 = Math.ceil((f.t - f.ht - e - t0) / c - 0.5), j1 = Math.floor((f.t + f.ht + e - t0) / c - 0.5);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m[j * ni + i] = 1;
  }
  // the piece under the finger
  const pf = fr(pick), si = Math.floor((pf.s - s0) / c), sj = Math.floor((pf.t - t0) / c);
  if (!m[sj * ni + si]) return null;
  const keep = new Uint8Array(ni * nj), st = [sj * ni + si];
  keep[st[0]] = 1;
  while (st.length) {
    const k = st.pop(), i = k % ni, j = (k / ni) | 0;
    for (const [a, d] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || d < 0 || a >= ni || d >= nj) continue; const q = d * ni + a; if (m[q] && !keep[q]) { keep[q] = 1; st.push(q); } }
  }
  let n = 0; for (const v of keep) n += v;
  // the walls (for the cage): units in line merged into runs, in the frame
  const segs = [];
  for (const par of [true, false]) {
    const groups = new Map();
    tops.forEach((b, k) => {
      const f = F[k], along = Math.abs(Math.cos(b.yaw - pick.yaw)) > 0.7 === par;
      if (!along) return;
      const ci = Math.floor(((par ? f.s : f.s) - s0) / c), cj = Math.floor(((par ? f.t : f.t) - t0) / c);
      if (!keep[cj * ni + ci]) return;
      const key = `${Math.round((par ? f.t : f.s) / MM(20))}:${Math.round((par ? f.ht : f.hs) / MM(10))}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(f);
    });
    for (const g of groups.values()) {
      const iv = g.map((f) => (par ? [f.s - f.hs, f.s + f.hs, f.t, f.ht] : [f.t - f.ht, f.t + f.ht, f.s, f.hs])).sort((a, b) => a[0] - b[0]);
      let cur = null;
      for (const v of iv) {
        if (cur && v[0] <= cur[1] + MM(30)) cur[1] = Math.max(cur[1], v[1]);
        else { if (cur) segs.push(cur); cur = [...v, par]; }
      }
      if (cur) segs.push(cur);
    }
  }
  const rec = {
    type: 'belt', o: [+(ux * s0 - uz * t0).toFixed(6), +(uz * s0 + ux * t0).toFixed(6)], u: [+ux.toFixed(6), +uz.toFixed(6)], c: +c.toFixed(7), ni, nj,
    mask: rle(keep), top: +T.toFixed(6), H: +MM(BELT.H).toFixed(6), lv: new Array(n).fill(0), sm: new Array(n).fill(0.3), fill: 0,
    // (the walls in the frame relative to the origin: from, to along; the line across; half width; along s?)
    segs: segs.map(([a, b, l, h, par]) => [+(a - (par ? s0 : t0)).toFixed(6), +(b - (par ? s0 : t0)).toFixed(6), +(l - (par ? t0 : s0)).toFixed(6), +h.toFixed(6), par ? 1 : 0]),
  };
  return { rec, n, lenM: segs.reduce((a, v) => a + (v[1] - v[0]), 0) / S / 1000 };
}

// the boards: the edges of the plan, merged into straight runs — [s0,t0,s1,t1, ns,nt]
export function boardsOf(b) {
  const P = plan(b), out = [], { ni, nj, c } = b, inside = (i, j) => i >= 0 && j >= 0 && i < ni && j < nj && P.mask[j * ni + i];
  // edges along s (between rows), then along t (between columns)
  for (let j = 0; j <= nj; j++) for (const sg of [-1, 1]) {
    let start = -1;
    for (let i = 0; i <= ni; i++) {
      const e = i < ni && (sg < 0 ? inside(i, j) && !inside(i, j - 1) : inside(i, j - 1) && !inside(i, j));
      if (e && start < 0) start = i;
      if (!e && start >= 0) { out.push([start * c, j * c, i * c, j * c, 0, sg]); start = -1; }
    }
  }
  for (let i = 0; i <= ni; i++) for (const sg of [-1, 1]) {
    let start = -1;
    for (let j = 0; j <= nj; j++) {
      const e = j < nj && (sg < 0 ? inside(i, j) && !inside(i - 1, j) : inside(i - 1, j) && !inside(i, j));
      if (e && start < 0) start = j;
      if (!e && start >= 0) { out.push([i * c, start * c, i * c, j * c, sg, 0]); start = -1; }
    }
  }
  return out;
}

// the cage: 4 bars Ø12 along every wall, on through the corners (to the far face, less the
// cover), stirrups Ø6 every ≤ 350 mm, wire at their corners, wheel spacers
export function beltCage(b) {
  const P = plan(b), bars = [], ties = [], stars = [], d = MM(12), ds = MM(6), cov = MM(BELT.cover), H = b.H, y0 = b.top;
  const W = (s, t, y) => { const [x, z] = toWorld(b, s, t); return [+x.toFixed(5), +y.toFixed(5), +z.toFixed(5)]; };
  const inside = (s, t) => { const i = Math.floor(s / b.c), j = Math.floor(t / b.c); return i >= 0 && j >= 0 && i < b.ni && j < b.nj && P.mask[j * b.ni + i]; };
  for (const [a0, a1, l, h, par] of b.segs) {
    const pt = (al, ac) => (par ? [al, l + ac] : [l + ac, al]);
    // the ends: on through a corner as far as the ring goes (≤ 600 mm), less the cover
    const ext = (a, sg) => { let e = 0; while (e < MM(600) && inside(...pt(a + sg * (e + b.c * 0.5), 0))) e += b.c * 0.5; return Math.max(0, e - cov); };
    const e0 = ext(a0, -1), e1 = ext(a1, 1);
    const bx = h - cov - ds - d / 2, yb = y0 + cov + ds + d / 2, yt = y0 + H - cov - ds - d / 2, lift = par ? 0 : d;   // (the crossing bars ride on the others)
    for (const y of [yb, yt]) for (const o of [-bx, bx]) bars.push([...W(...pt(a0 - e0, o), y + lift), ...W(...pt(a1 + e1, o), y + lift), +d.toFixed(6)]);
    const sx = h - cov - ds / 2, sb = y0 + cov + ds / 2, st = y0 + H - cov - ds / 2;
    const n = Math.max(1, Math.ceil((a1 - a0 - MM(100)) / MM(350)));
    for (let k = 0; k <= n; k++) {
      const a = a0 + MM(50) + (a1 - a0 - MM(100)) * k / n;
      const q = [W(...pt(a, -sx), sb + lift), W(...pt(a, sx), sb + lift), W(...pt(a, sx), st + lift), W(...pt(a, -sx), st + lift)];
      for (let i = 0; i < 4; i++) bars.push([...q[i], ...q[(i + 1) % 4], +ds.toFixed(6)]);
      for (const [o, y] of [[-bx, yb], [bx, yb], [bx, yt], [-bx, yt]]) ties.push([...W(...pt(a + MM(8), o), y + lift), +(d * 0.9).toFixed(6), 0.785]);
      if (k % 2 === 0) {
        const yaw = Math.atan2(-(par ? b.u[1] : b.u[0]), par ? b.u[0] : -b.u[1]);
        for (const [o, y] of [[-bx, yb], [bx, yb]]) stars.push([...W(...pt(a + MM(70), o), y + lift), +yaw.toFixed(4), +MM(38).toFixed(6)]);
      }
    }
  }
  return { type: 'cage', outlineId: null, beltId: b.id, bars, chairs: [], frogs: [], ties, tied: true, stars, d };
}

// ---- the concrete in it (the same interface as Channel in uPour.js) ------------------------
export class BeltChannel {
  constructor(app, b) {
    this.app = app; this.b = b; this.P = plan(b);
    this.h = b.lv.slice(); this.sm = (b.sm || []).slice();
    while (this.sm.length < this.h.length) this.sm.push(0.3);
    this.cap = b.H / S;   // mm
    this.spilt = 0;
  }
  has(t) { return !!t && t.id === this.b.id; }
  get full() { return this.h.every((v) => v >= this.cap - 3); }
  at(x, z) {
    const b = this.b, [s, t] = toFrame(b, x, z), i0 = Math.floor(s / b.c), j0 = Math.floor(t / b.c);
    let best = 0, bd = Infinity;
    for (let r = 0; r <= 6 && bd === Infinity; r++) for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= b.ni || j >= b.nj) continue;
      const k = this.P.index[j * b.ni + i];
      if (k < 0) continue;
      const d = Math.hypot(i + 0.5 - s / b.c, j + 0.5 - t / b.c);
      if (d < bd) bd = d, best = k;
    }
    return best;
  }
  point(k) {
    const b = this.b, [i, j] = this.P.cells[k], [x, z] = toWorld(b, (i + 0.5) * b.c, (j + 0.5) * b.c);
    return new THREE.Vector3(x, b.top + MM(this.h[k]), z);
  }
  topY() { return this.b.top + this.b.H; }
  pour(k, l) {
    const cm = this.b.c / S / 1000, per = 1e-3 / (cm * cm) * 1000;   // mm per litre on one cell (400 on 50 mm, 100 on a slab's 100 mm)
    // (it lands across the whole width of the beam at once: a splat ~550 mm round; on a slab ~600)
    const ks = [...this._near(k, Math.max(2, Math.round(MM(250) / this.b.c)))], w = 1 / ks.length;
    for (const q of ks) this.h[q] += l * w * per;
  }
  _flow(d, yieldMm, kk, only) {
    const h = this.h, nb = this.P.nb;
    let moved = 0;
    for (let k = 0; k < h.length; k++) {
      if (only && !only.has(k)) continue;
      for (const q of [nb[k][0], nb[k][2]]) {   // (each pair once: +s, +t)
        if (q < 0 || (only && !only.has(q))) continue;
        const dh = h[k] - h[q], e = Math.abs(dh) - yieldMm;
        if (e <= 0) continue;
        const f = Math.sign(dh) * e * kk * d * 0.4;
        h[k] -= f; h[q] += f; moved += Math.abs(f);
      }
    }
    return moved;
  }
  step(dt) {
    let moved = 0;
    const subs = Math.max(1, Math.ceil(dt * K / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) {
      moved += this._flow(d, YIELD, K);
      for (let k = 0; k < this.h.length; k++) if (this.h[k] > this.cap + 40) { const o = (this.h[k] - this.cap - 40) * Math.min(1, 8 * d); this.h[k] -= o; this.spilt += o; }   // (a heap up to 40 mm over the boards stands; more falls over)
    }
    return moved;
  }
  settle() { for (let k = 0; k < 400 && this.step(0.05) > 0.05; k++); }
  _near(k, r) {
    const [i0, j0] = this.P.cells[k], set = new Set(), b = this.b;
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= b.ni || j >= b.nj || Math.hypot(i - i0, j - j0) > r) continue;
      const q = this.P.index[j * b.ni + i]; if (q >= 0) set.add(q);
    }
    return set;
  }
  vibrate(k, r, dt) {
    const near = this._near(k, r), subs = Math.max(1, Math.ceil(dt * K * 2 / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) this._flow(d, 0, K * 2, near);
    const [i0, j0] = this.P.cells[k];
    for (const q of near) { const [i, j] = this.P.cells[q]; this.sm[q] = Math.max(this.sm[q], Math.min(0.5, this.sm[q] + dt * 1.2 * (1 - Math.hypot(i - i0, j - j0) / (r + 1)))); }   // (the vibrator settles it, it does not smooth it: ≤ 0.5, as the foundation)
  }
  dir(a, b) {
    const pa = this.point(a), pb = this.point(b), dx = pb.x - pa.x, dz = pb.z - pa.z, l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }
  // the rule on the boards, drawn from cell a to cell b: across the ring it takes everything
  // above the boards and pushes it on ahead
  rule(a, bk) {
    const pa = this.point(a), pb = this.point(bk), L = Math.hypot(pb.x - pa.x, pb.z - pa.z), [dx, dz] = this.dir(a, bk);
    const n = Math.max(1, Math.ceil(L / (this.b.c * 0.7)));
    for (let m = 0; m <= n; m++) {
      const x = pa.x + (pb.x - pa.x) * m / n, z = pa.z + (pb.z - pa.z) * m / n;
      for (let k = 0; k < this.h.length; k++) {
        const p = this.point(k), ex = p.x - x, ez = p.z - z, al = ex * dx + ez * dz, ac = -ex * dz + ez * dx;
        if (Math.abs(al) > this.b.c * 0.6 || Math.abs(ac) > MM(1000)) continue;
        this.sm[k] = Math.max(this.sm[k], 0.55);
        const over = this.h[k] - this.cap;
        if (over <= 0) continue;
        this.h[k] = this.cap;
        const q = this.at(p.x + dx * this.b.c, p.z + dz * this.b.c);
        if (q !== k) this.h[q] += over; else this.spilt += over;
      }
    }
  }
  // the float from a to b: closes and smooths a strip 450 mm long along it
  float(a, bk) {
    const pa = this.point(a), pb = this.point(bk), near = new Set();
    for (const k of [a, bk]) for (const q of this._near(k, 4)) near.add(q);
    const L = Math.hypot(pb.x - pa.x, pb.z - pa.z), n = Math.ceil(L / this.b.c);
    for (let m = 1; m < n; m++) for (const q of this._near(this.at(pa.x + (pb.x - pa.x) * m / n, pa.z + (pb.z - pa.z) * m / n), 4)) near.add(q);
    this._flow(0.05, 0, 4, near);
    for (const q of near) this.sm[q] = Math.min(1, this.sm[q] + 0.35);
  }
  show(v) { v.beltLive = v.beltLive || new Map(); v.beltLive.set(this.b.id, { lv: this.h, sm: this.sm }); v.fillDirty = true; }
  write(app) {
    const b = app.objects.get(this.b.id);
    if (!b) return;
    const lv = this.h.map((v) => Math.round(Math.max(0, Math.min(this.cap, v)) * 2) / 2), sm = this.sm.map((v) => Math.round(v * 100) / 100);
    const fill = +(lv.reduce((a, v) => a + v, 0) / lv.length / this.cap).toFixed(4);
    // wetT: when fresh concrete was last added (it stays workable from then on)
    const more = fill > (b.fill || 0) + 1e-4;
    app.objects.update(b.id, { lv, sm, fill, ...(more ? { wetT: +app.clock.toFixed(2) } : {}), ...(b.castT == null && fill > 0 ? { castT: +app.clock.toFixed(2) } : {}), ...(fill >= 0.95 && b.pourT == null ? { pourT: +app.clock.toFixed(2) } : {}) });
    if (app.wallView.beltLive) app.wallView.beltLive.delete(b.id);
  }
}
