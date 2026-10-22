import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { planOf, cellList, setOf, runsOf, heights, LOOSE, CONC, concCap, concLevels } from '../world/blind.js';

// The loose layers and the concrete of the blind area, worked as on site (blind.js keeps a
// value per cell of the plan, 100 mm):
//   Pile    – sand or gravel tipped off the shovel: it heaps up under the finger and runs down
//             till its slopes are what it holds (the angle of repose); the rake drawn over it
//             pushes the heap on and fills the hollows — a layer of its thickness;
//   BlindChannel – the concrete (the same interface as BeltChannel, belt.js): from the hose or
//             the bucket it lands under the finger and flows over the gravel between the
//             boards and the walls; the vibrator, the rule on the boards (it leaves the slope of
//             3 % away from the walls), the float.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;

export class Pile {
  constructor(rec, L) {
    this.rec = rec; this.L = L; this.P = planOf(rec); this.CL = cellList(this.P);
    this.h = heights(rec, L); this.t = LOOSE[L].t; this.rep = LOOSE[L].rep;
  }
  // the cell under a point of the plan (or −1)
  at(a, d) { const k = this.P.cellAt(a, d); return k < 0 ? -1 : this.CL.index.get(k) ?? -1; }
  // l litres onto cell n: 1 l over a 100 × 100 cell is 100 mm; the shovel's load lands ~200 mm round
  pour(n, l) {
    const ks = [n, ...this.CL.nb[n].filter((q) => q >= 0)], w = [0.4, ...ks.slice(1).map(() => 0.6 / (ks.length - 1))];
    ks.forEach((q, i) => { this.h[q] += l * w[i] * 100; });
  }
  // it runs down where the slope is steeper than it holds
  step(iter = 6) {
    const h = this.h, nb = this.CL.nb, rep = this.rep;
    let moved = 0;
    for (let it = 0; it < iter; it++) for (let n = 0; n < h.length; n++) {
      for (const q of [nb[n][0], nb[n][2]]) {
        if (q < 0) continue;
        const dh = h[n] - h[q], e = Math.abs(dh) - rep;
        if (e <= 0) continue;
        const f = Math.sign(dh) * e * 0.24;
        h[n] -= f; h[q] += f; moved += Math.abs(f);
      }
    }
    return moved;
  }
  // the rake at cell n, drawn along (da, dd): across the area (it is worked stroke by stroke) what is above the
  // thickness goes on ahead of it, the hollows under it are filled from the heap it pushes
  rake(n, da, dd) {
    if (n < 0) return;
    const P = this.P, c = P.cells.get(this.CL.keys[n]), near = [], R = this.rec.W + P.C;   // (stroke by stroke across: the whole width)
    const len = Math.hypot(da, dd) || 1, ua = da / len, ud = dd / len;
    for (const [q, k] of this.CL.keys.entries()) {
      const e = P.cells.get(k), ea = e.a - c.a, ed = e.d - c.d;
      if (Math.abs(ea) > R + P.C || Math.abs(ed) > R + P.C) continue;
      const al = ea * ua + ed * ud, ac = -ea * ud + ed * ua;
      if (Math.abs(ac) <= R && al > -P.C && al <= P.C * 0.6) near.push(q);
    }
    let surplus = 0;
    for (const q of near) { const over = this.h[q] - this.t; if (over > 0) { surplus += over; this.h[q] -= over; } }
    // (the hollows under the rake first, the rest pushed ahead of it)
    for (const q of near) { const need = this.t - this.h[q]; if (need > 0 && surplus > 0) { const g = Math.min(need, surplus); this.h[q] += g; surplus -= g; } }
    if (surplus > 0) {
      const ahead = [];
      for (const q of near) { const e = P.cells.get(this.CL.keys[q]), [a, d] = [e.a + ua * P.C * 2, e.d + ud * P.C * 2], m = this.at(a, d); if (m >= 0) ahead.push(m); }
      if (ahead.length) for (const m of ahead) this.h[m] += surplus / ahead.length;
      else for (const q of near) this.h[q] += surplus / near.length;   // (against the boards: it stays)
    }
    for (const q of near) this.h[q] += (Math.random() - 0.5) * 1.2;   // (the tines leave it a little rough)
  }
  get done() { const s = new Set(); this.CL.keys.forEach((k, n) => { if (this.h[n] >= this.t * 0.85) s.add(k); }); return s; }
  patch() { return { [this.L]: runsOf(this.done), [this.L + 'H']: Array.from(this.h, (v) => Math.round(Math.max(0, v))) }; }
}

export class BlindChannel {
  constructor(app, rec) {
    this.app = app; this.b = rec; this.P = planOf(rec); this.CL = cellList(this.P);
    this.h = concLevels(rec); this.sm = Float32Array.from({ length: this.CL.n }, (_, n) => rec.sm?.[n] ?? 0.3);
    // (it goes over the gravel only; each cell full at its own height: the slope)
    const grav = setOf(rec.grav);
    this.ok = this.CL.keys.map((k) => grav.has(k));
    this.caps = this.CL.keys.map((k) => concCap(rec, this.P.cells.get(k)));
    this.cap = Math.max(...this.caps);
    this.spilt = 0;
  }
  has(t) { return !!t && t.id === this.b.id; }
  // (from the hose it heaps up 40 mm over the mark under it: it runs out from there)
  brim(n) { return this.caps[n] + 40; }
  get full() { return this.h.every((v, n) => !this.ok[n] || v >= this.caps[n] - 3); }
  at(x, z) {
    const [a, d] = this.P.frame(x, z), k = this.P.cellAt(a, d), n = k < 0 ? undefined : this.CL.index.get(k);
    if (n !== undefined && this.ok[n]) return n;
    let best = 0, bd = Infinity;
    this.CL.keys.forEach((kk, q) => { if (!this.ok[q]) return; const c = this.P.cells.get(kk), e = Math.hypot(c.a - a, c.d - d); if (e < bd) bd = e, best = q; });
    return best;
  }
  point(n) { const c = this.P.cells.get(this.CL.keys[n]), [x, z] = this.P.W2(c.a, c.d); return new THREE.Vector3(x, this.b.g + MM(CONC.base + this.h[n]), z); }
  topY() { return this.b.g + MM(CONC.base + this.cap); }
  _near(n, r) {
    const c = this.P.cells.get(this.CL.keys[n]), out = new Set();
    for (let j = c.j - r; j <= c.j + r; j++) for (let i = c.i - r; i <= c.i + r; i++) {
      if (i < 0 || j < 0 || i >= this.P.ni || j >= this.P.nj || Math.hypot(i - c.i, j - c.j) > r) continue;
      const q = this.CL.index.get(j * this.P.ni + i); if (q !== undefined && this.ok[q]) out.add(q);
    }
    return out;
  }
  pour(n, l) {
    const ks = [...this._near(n, 2)], w = 1 / Math.max(1, ks.length);
    for (const q of ks) this.h[q] += l * w * 100;
  }
  _flow(d, yieldMm, kk, only) {
    const h = this.h, nb = this.CL.nb;
    let moved = 0;
    for (let n = 0; n < h.length; n++) {
      if (!this.ok[n] || (only && !only.has(n))) continue;
      for (const q of [nb[n][0], nb[n][2]]) {
        if (q < 0 || !this.ok[q] || (only && !only.has(q))) continue;
        const dh = h[n] - h[q], e = Math.abs(dh) - yieldMm;
        if (e <= 0) continue;
        const f = Math.sign(dh) * e * Math.min(0.24, kk * d * 0.4);
        h[n] -= f; h[q] += f; moved += Math.abs(f);
      }
    }
    return moved;
  }
  step(dt) {
    let moved = 0;
    // (from the pump it runs: the mound under the hose spreads out over the gravel)
    const subs = Math.min(40, Math.max(1, Math.ceil(dt * 60 / 0.2))), d = dt / subs;
    for (let s = 0; s < subs; s++) {
      moved += this._flow(d, 2.5, 60);
    }
    return moved;
  }
  settle() { for (let k = 0; k < 200 && this.step(0.05) > 0.05; k++); }
  vibrate(n, r, dt) {
    const near = this._near(n, Math.min(r, 5)), subs = Math.max(1, Math.ceil(dt * 40 / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) this._flow(d, 0, 40, near);
    for (const q of near) this.sm[q] = Math.max(this.sm[q], Math.min(0.5, this.sm[q] + dt * 1.2));
  }
  dir(a, b) { const pa = this.point(a), pb = this.point(b), dx = pb.x - pa.x, dz = pb.z - pa.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; }
  // the rule on the boards and the wall's mark (200 mm at the wall, 3 % down to the boards):
  // across the whole width it takes what is above and pushes it on ahead
  rule(a, bk) {
    const pa = this.point(a), pb = this.point(bk), [dx, dz] = this.dir(a, bk), L = Math.hypot(pb.x - pa.x, pb.z - pa.z), C = this.P.C;
    const n = Math.max(1, Math.ceil(L / (C * 0.7)));
    for (let m = 0; m <= n; m++) {
      const x = pa.x + (pb.x - pa.x) * m / n, z = pa.z + (pb.z - pa.z) * m / n;
      this.CL.keys.forEach((k, q) => {
        if (!this.ok[q]) return;
        const c = this.P.cells.get(k), [cx, cz] = this.P.W2(c.a, c.d), ex = cx - x, ez = cz - z, al = ex * dx + ez * dz, ac = -ex * dz + ez * dx;
        if (Math.abs(al) > C * 0.6 || Math.abs(ac) > MM(1300)) return;
        this.sm[q] = Math.max(this.sm[q], 0.55);
        const over = this.h[q] - this.caps[q];
        if (over <= 0) return;
        this.h[q] = this.caps[q];
        const t = this.at(cx + dx * C, cz + dz * C);
        if (t !== q) this.h[t] += over; else this.spilt += over;
      });
    }
  }
  float(a, bk) {
    const pa = this.point(a), pb = this.point(bk), near = new Set();
    for (const k of [a, bk]) for (const q of this._near(k, 3)) near.add(q);
    const L = Math.hypot(pb.x - pa.x, pb.z - pa.z), n = Math.ceil(L / this.P.C);
    for (let m = 1; m < n; m++) for (const q of this._near(this.at(pa.x + (pb.x - pa.x) * m / n, pa.z + (pb.z - pa.z) * m / n), 3)) near.add(q);
    // (it closes the surface; the slope stays: it smooths towards the cell's own mark)
    for (const q of near) { this.h[q] += (Math.min(this.h[q], this.caps[q]) - this.h[q]) * 0.3; this.sm[q] = Math.min(1, this.sm[q] + 0.35); }
  }
  show(v) { v.blindLive = v.blindLive || new Map(); v.blindLive.set(this.b.id, { lv: this.h, sm: this.sm }); v.fillDirty = true; }
  write(app) {
    const b = app.objects.get(this.b.id);
    if (!b) return;
    const lv = Array.from(this.h, (v, n) => Math.round(Math.max(0, v) * 2) / 2), sm = Array.from(this.sm, (v) => Math.round(v * 100) / 100);
    let sum = 0, cnt = 0; const fin = new Set();
    this.CL.keys.forEach((k, n) => { if (!this.ok[n]) return; cnt++; sum += Math.min(1, lv[n] / this.caps[n]); if (lv[n] >= this.caps[n] * 0.9) fin.add(k); });
    const fill = +(sum / Math.max(1, cnt)).toFixed(4), more = fill > (b.fill || 0) + 1e-4;
    app.objects.update(b.id, { lv, sm, fill, fin: runsOf(fin), ...(fin.size ? { finKind: 'conc' } : {}), ...(more ? { wetT: +app.clock.toFixed(2) } : {}), ...(b.castT == null && fill > 0 ? { castT: +app.clock.toFixed(2) } : {}), ...(fill >= 0.95 && b.pourT == null ? { pourT: +app.clock.toFixed(2) } : {}) });
    if (app.wallView.blindLive) app.wallView.blindLive.delete(b.id);
  }
}
