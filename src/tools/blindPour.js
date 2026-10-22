import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { planOf, cellList, runsOf, concCap, concLevels, looseSet, gravTop } from '../world/blind.js';

// The concrete of the blind area (the same interface as BeltChannel, belt.js): from the hose or
// the bucket it lands under the finger and flows over the gravel between the boards and the
// walls; the vibrator, the rule on the boards (it leaves the slope of 3 % away from the walls),
// the float. (The sand and the gravel under it are the ground's loose cover: terrain.js.)
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;

export class BlindChannel {
  constructor(app, rec) {
    this.app = app; this.b = rec; this.P = planOf(rec); this.CL = cellList(this.P);
    this.h = concLevels(rec); this.sm = Float32Array.from({ length: this.CL.n }, (_, n) => rec.sm?.[n] ?? 0.3);
    // (it goes over the gravel only; each cell full at its own height: the slope)
    // (on the gravel: its top under each cell the bottom; full at the cell's own height: the fall)
    const grav = looseSet(rec, 'grav');
    this.ok = this.CL.keys.map((k) => grav.has(k));
    this.base = this.CL.keys.map((k) => { const c = this.P.cells.get(k), [x, z] = this.P.W2(c.a, c.d); return gravTop(rec, x, z); });
    this.caps = this.CL.keys.map((k, n) => concCap(rec, this.P.cells.get(k), this.base[n]));
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
  point(n) { const c = this.P.cells.get(this.CL.keys[n]), [x, z] = this.P.W2(c.a, c.d); return new THREE.Vector3(x, this.base[n] + MM(this.h[n]), z); }
  topY() { return Math.max(...this.base) + MM(this.cap); }
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
