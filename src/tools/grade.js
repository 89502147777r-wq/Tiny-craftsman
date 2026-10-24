import { MODEL_SCALE } from '../config.js';
import { houseOutside, buildings, findHouse } from './pitchedTool.js';

// Grading the plot after the building (планировка), as on site: the design level is the ground
// most of the open plot lies at, falling away from the houses (slope %, out to 8 m from the
// walls); a blade (the loader's bucket) over the ground cuts off what stands over it — the
// heaps and the native ground too — and carries it, and fills the hollows under it from what
// it carries. The houses, the blind areas (their boards hold what is in them) and the concrete
// are not touched.
const MM = (v) => v / 1000 / MODEL_SCALE;

export class Grader {
  constructor(app) { this.app = app; this.carry = new Float64Array(4); this._seg = { m: new Uint8Array(8), h: new Float64Array(8), n: 0 }; this._seen = new Set(); }

  // the design level over the plot (worked out as the work begins)
  design(slopePct = 1.5) {
    const app = this.app, t = app.terrain, out = houseOutside(app), slope = slopePct / 100;
    const wings = [];
    for (const B of buildings(app)) { const H = findHouse(app, { x: B[0].x, z: B[0].z }); if (H) wings.push(...H.wings); }
    const dist = (x, z) => { let m = Infinity; for (const w of wings) { const dx = x - w.cx, dz = z - w.cz, a = Math.abs(dx * w.ux + dz * w.uz) - w.A, d = Math.abs(-dx * w.uz + dz * w.ux) - w.B; m = Math.min(m, Math.hypot(Math.max(0, a), Math.max(0, d))); } return m; };
    const fall = (x, z) => (wings.length ? slope * (Math.min(dist(x, z), MM(8000)) - MM(1500)) : 0);
    this.free = (i, x, z) => t.zone[i] !== 1 && t.conc[i] <= 1e-6 && t.top[i] <= 0 && (!out || out(x, z) === true);
    // (the level most of the open ground lies at, the fall taken out: ±25 mm round the commonest)
    const hs = [], st = MM(200);
    for (let x = t.toWorldX(0); x <= t.toWorldX(t.rx); x += st) for (let z = t.toWorldZ(0); z <= t.toWorldZ(t.rz); z += st) {
      const i = t.index(x, z); if (this.free(i, x, z)) hs.push(t.nat[i] + t.loose[i] + fall(x, z));
    }
    hs.sort((a, b) => a - b);
    let best = 0, b0 = 0;
    for (let i = 0, j = 0; i < hs.length; i++) { while (hs[i] - hs[j] > MM(50)) j++; if (i - j + 1 > best) best = i - j + 1, b0 = j; }
    const base = !hs.length ? t.heightAt(0, 0) : best >= hs.length * 0.3 ? hs.slice(b0, b0 + best).reduce((a, v) => a + v, 0) / best : hs[hs.length >> 1];
    this.target = (x, z) => base - fall(x, z);
    return this;
  }

  get load() { return this.carry[0] + this.carry[1] + this.carry[2] + this.carry[3]; }   // (heights summed over samples; × cellArea = volume)
  // a sample cut down by h (what is cut goes into `into`: the loose layers first, then the ground)
  cut(i, h, into = this.carry) {
    const t = this.app.terrain, seg = this._seg;
    const got = t._pop(i, h, seg);
    for (let k = 0; k < seg.n; k++) into[seg.m[k]] += seg.h[k];
    if (h - got > 1e-9) { t.nat[i] -= h - got; into[0] += h - got; }
  }
  fill(i, need) {
    const t = this.app.terrain, c = this.carry;
    for (const m of [0, 1, 2, 3]) { if (need <= 0) break; const g = Math.min(need, c[m]); if (g > 0) { t._push(i, g, m); c[m] -= g; need -= g; } }
  }
  // the blade at (x, z), across (ux, uz), half width hw: cut down to the level, fill up to it;
  // `cap`: the most it may carry (the bucket full: it cuts no more, it still fills)
  blade(x, z, ux, uz, hw, cap = Infinity) {
    const t = this.app.terrain, seen = this._seen;
    seen.clear();
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (let q = -hw; q <= hw; q += t.cell * 0.7) {
      const px = x - uz * q, pz = z + ux * q;
      if (!t.inside(px, pz)) continue;
      const i = t.index(px, pz);
      if (seen.has(i)) continue; seen.add(i);
      if (!this.free(i, px, pz)) continue;
      const s = t.nat[i] + t.loose[i], tg = this.target(px, pz);
      if (s > tg + 1e-7) { const h = Math.min(s - tg, Math.max(0, cap - this.load)); if (h <= 0) continue; this.cut(i, h); }
      else if (s < tg - 1e-7 && this.load > 0) this.fill(i, tg - s);
      else continue;
      const ix = i % t.nx, iz = (i / t.nx) | 0;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
    if (x1 >= 0) t._touch(x0, z0, x1, z1);
  }
  // what is still carried, let go of at (x, z) going (ux, uz): into the hollows round it (nearest
  // first, 1,5 m), then a low wedge ahead (≤ 40 mm over the level, out to 2 m), the rest a heap
  drop(x, z, ux, uz, hw) {
    const t = this.app.terrain, c = this.carry;
    if (this.load <= 0) return;
    const R = MM(1500), n = Math.ceil(R / t.cell), ci = Math.round(t.toCellX(x)), cj = Math.round(t.toCellZ(z)), list = [];
    for (let iz = Math.max(0, cj - n); iz <= Math.min(t.rz, cj + n); iz++) for (let ix = Math.max(0, ci - n); ix <= Math.min(t.rx, ci + n); ix++) {
      const r2 = (ix - ci) ** 2 + (iz - cj) ** 2; if (r2 > n * n) continue;
      const i = iz * t.nx + ix, px = t.toWorldX(ix), pz = t.toWorldZ(iz);
      if (!this.free(i, px, pz)) continue;
      const need = this.target(px, pz) - (t.nat[i] + t.loose[i]); if (need > 1e-7) list.push([r2, i, need]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [, i, need] of list) { this.fill(i, need); if (this.load <= 0) break; }
    for (let s = 0; s <= MM(2000) && this.load > 0; s += t.cell * 0.7) for (let q = -hw; q <= hw; q += t.cell * 0.7) {
      const px = x + ux * s - uz * q, pz = z + uz * s + ux * q; if (!t.inside(px, pz)) continue;
      const i = t.index(px, pz); if (!this.free(i, px, pz)) continue;
      const room = this.target(px, pz) + MM(40) * (1 - s / MM(2000)) - (t.nat[i] + t.loose[i]); if (room > 0) this.fill(i, room);
    }
    for (const m of [0, 1, 2, 3]) if (c[m] > 0) { t.deposit(x + ux * MM(2100), z + uz * MM(2100), c[m] * t.cellArea, MM(400), 0, m); c[m] = 0; }
    const e = n + Math.ceil(MM(2600) / t.cell);
    t._touch(Math.max(0, ci - e), Math.max(0, cj - e), Math.min(t.rx, ci + e), Math.min(t.rz, cj + e));
  }
  // what stands over the level within r of (x, z), up to `cap` more: scooped into the carry
  scoop(x, z, r, cap) {
    const t = this.app.terrain, n = Math.ceil(r / t.cell), cx = t.toCellX(x), cz = t.toCellZ(z);
    let any = false;
    for (let iz = Math.max(0, Math.floor(cz - n)); iz <= Math.min(t.rz, Math.ceil(cz + n)); iz++) for (let ix = Math.max(0, Math.floor(cx - n)); ix <= Math.min(t.rx, Math.ceil(cx + n)); ix++) {
      if (Math.hypot(ix - cx, iz - cz) > n || this.load >= cap) continue;
      const i = iz * t.nx + ix, px = t.toWorldX(ix), pz = t.toWorldZ(iz);
      if (!this.free(i, px, pz)) continue;
      const over = t.nat[i] + t.loose[i] - this.target(px, pz);
      if (over > 1e-7) { this.cut(i, Math.min(over, cap - this.load)); any = true; }
    }
    if (any) t._touch(Math.max(0, Math.floor(cx - n)), Math.max(0, Math.floor(cz - n)), Math.min(t.rx, Math.ceil(cx + n)), Math.min(t.rz, Math.ceil(cz + n)));
    return any;
  }
  // the volume carried, real m³
  realVolume() { return this.load * this.app.terrain.cellArea * MODEL_SCALE ** 3; }
}
