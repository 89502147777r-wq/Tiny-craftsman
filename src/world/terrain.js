import * as THREE from 'three';
import { TRAY, SOIL_TILE, TERRAIN_CELL, REPOSE_NATIVE, MATERIALS, M_SOIL, CONCRETE } from '../config.js';

// loose layers per cell (bottom → top), each of one material (config MATERIALS)
export const LAYERS = 3;
const REPOSE = MATERIALS.map((m) => m.repose);
const REPOSE_MIN = Math.min(...REPOSE);
import { makeNoise2 } from '../core/rand.js';

// Soil heightfield inside the tray:
//   nat   – top of undisturbed (cohesive) ground, absolute Y
//   loose – thickness of loose material lying on top of it: up to LAYERS layers
//           (lH heights, lM materials, lN count; bottom first) — dug-over soil,
//           sand, crushed stone. Shovel and rake take from the top; every material
//           slides at its own angle of repose.
// Loose soil slides at its angle of repose; native ground only collapses
// when a wall is cut steeper than ~78°. Volume is conserved exactly.
export class Terrain {
  constructor() {
    // rectangular plot: rx × rz cells, (rx+1) × (rz+1) samples, row stride nx
    this.sizeX = TRAY.innerX; this.sizeZ = TRAY.innerZ;
    this.rx = Math.round(this.sizeX / TERRAIN_CELL); this.rz = Math.round(this.sizeZ / TERRAIN_CELL);
    this.cell = this.sizeX / this.rx;
    this.nx = this.rx + 1; this.nz = this.rz + 1;
    this.halfX = this.sizeX / 2; this.halfZ = this.sizeZ / 2;
    this.cellArea = this.cell * this.cell;
    this.floorY = TRAY.floor;
    const N = this.nx * this.nz;
    this.nat = new Float32Array(N);
    this.loose = new Float32Array(N);
    this.orig = new Float32Array(N);
    // for loose soil: the mean depth (m below the original surface) it was dug
    // from — the spoil heap shows the colour of the layer it came out of
    this.ldep = new Float32Array(N);
    this.lH = new Float32Array(N * LAYERS);
    this.lM = new Uint8Array(N * LAYERS);
    this.lN = new Uint8Array(N);
    // concrete on top of everything: thickness, pour time (project clock, s) and
    // how smooth its surface was finished (0 as poured … 1 trowelled)
    this.conc = new Float32Array(N);
    this.cTime = new Float32Array(N);
    this.cSm = new Float32Array(N);
    // formwork boards: top height of the board standing on a cell (0 = none);
    // concrete cannot flow into these cells
    this.wall = new Float32Array(N);
    this.cActive = null;       // bbox where concrete is still flowing
    // taken since the last reset: per material, and soil depth·volume
    this.take = { v: 0, dv: 0, m: new Float64Array(MATERIALS.length) };
    this._seg = { m: new Uint8Array(LAYERS + 1), h: new Float64Array(LAYERS + 1) };
    this._occ = new Float32Array(N);
    this.active = null;        // bbox that still needs relaxation
    this.meshDirty = null;     // bbox whose mesh needs refreshing
    this.version = 0;          // bumps on every change (grass/clods listen)
    this.seed = 7;
    this.generate(this.seed);
  }

  generate(seed) {
    this.seed = seed;
    const noise = makeNoise2(seed);
    const { nx, nz } = this;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = ix * this.cell, z = iz * this.cell;
        let h = TRAY.soil
          + 0.0016 * noise.fbm(x / 0.07, z / 0.07, 4)
          + 0.0004 * noise.fbm(x / 0.011 + 31, z / 0.011 - 7, 3);
        // soil pressed up slightly against the tray walls, like a real filled box
        const ex = Math.min(ix, nx - 1 - ix), ez = Math.min(iz, nz - 1 - iz);
        const e = Math.min(ex, ez);
        h += 0.0012 * Math.exp(-e / 3);
        const i = iz * nx + ix;
        this.orig[i] = h; this.nat[i] = h; this.loose[i] = 0; this.ldep[i] = 0; this.lN[i] = 0; this.conc[i] = 0; this.cSm[i] = 0;
      }
    }
    this.markAll();
  }

  markAll() {
    this.meshDirty = { x0: 0, z0: 0, x1: this.rx, z1: this.rz };
    this.active = { x0: 0, z0: 0, x1: this.rx, z1: this.rz };
    this.version++;
  }

  // ---- coordinates ---------------------------------------------------------
  toCellX(v) { return (v + this.halfX) / this.cell; }
  toCellZ(v) { return (v + this.halfZ) / this.cell; }
  toWorldX(c) { return c * this.cell - this.halfX; }
  toWorldZ(c) { return c * this.cell - this.halfZ; }
  inside(x, z) { return Math.abs(x) <= this.halfX && Math.abs(z) <= this.halfZ; }
  clampX(x) { return Math.max(-this.halfX, Math.min(this.halfX, x)); }
  clampZ(z) { return Math.max(-this.halfZ, Math.min(this.halfZ, z)); }
  index(x, z) {
    const ix = Math.min(this.rx, Math.max(0, Math.round(this.toCellX(x))));
    const iz = Math.min(this.rz, Math.max(0, Math.round(this.toCellZ(z))));
    return iz * this.nx + ix;
  }
  hAt(i) { return this.nat[i] + this.loose[i] + this.conc[i]; }
  base(i) { return this.nat[i] + this.loose[i]; }

  heightAt(x, z) {
    const n = this.nx;
    let cx = this.toCellX(x), cz = this.toCellZ(z);
    cx = Math.min(Math.max(cx, 0), this.rx - 1e-4);
    cz = Math.min(Math.max(cz, 0), this.rz - 1e-4);
    const ix = Math.floor(cx), iz = Math.floor(cz), fx = cx - ix, fz = cz - iz;
    const i = iz * n + ix;
    const a = this.hAt(i), b = this.hAt(i + 1), c = this.hAt(i + n), d = this.hAt(i + n + 1);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cell;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // Ray / heightfield intersection (cheap march, then bisection).
  raycast(ray) {
    const o = ray.origin, d = ray.direction;
    // clip ray to the tray volume
    let t0 = 0, t1 = 10;
    const bmin = [-this.halfX, this.floorY - 0.001, -this.halfZ], bmax = [this.halfX, 0.3, this.halfZ];
    const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < bmin[k] || oo[k] > bmax[k]) return null; continue; }
      let a = (bmin[k] - oo[k]) / dd[k], b = (bmax[k] - oo[k]) / dd[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    const step = this.cell * 0.5;
    let prevT = t0;
    const p = new THREE.Vector3();
    const above = (t) => { p.copy(d).multiplyScalar(t).add(o); return p.y - this.heightAt(p.x, p.z); };
    let prevV = above(t0);
    if (prevV < 0) return null;
    for (let t = t0 + step; t <= t1 + step; t += step) {
      const tt = Math.min(t, t1);
      const v = above(tt);
      if (v <= 0) {
        let lo = prevT, hi = tt;
        for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (above(m) > 0) lo = m; else hi = m; }
        p.copy(d).multiplyScalar(hi).add(o);
        return { point: p.clone(), distance: hi };
      }
      prevT = tt; prevV = v;
      if (tt >= t1) break;
    }
    return null;
  }

  // ---- editing ---------------------------------------------------------------
  _touch(ix0, iz0, ix1, iz1) {
    this.active = grow(this.active, ix0 - 1, iz0 - 1, ix1 + 1, iz1 + 1, this.rx, this.rz);
    this.meshDirty = grow(this.meshDirty, ix0 - 1, iz0 - 1, ix1 + 1, iz1 + 1, this.rx, this.rz);
    this.version++;
  }

  // ---- loose layers ---------------------------------------------------------------------
  topMat(i) { const n = this.lN[i]; return n ? this.lM[i * LAYERS + n - 1] : M_SOIL; }

  _sumLoose(i) {
    const b = i * LAYERS, n = this.lN[i];
    let h = 0;
    for (let k = 0; k < n; k++) h += this.lH[b + k];
    this.loose[i] = h;
  }

  // put a layer of material on top (merges with a top layer of the same material;
  // when all layers are used, the two lowest merge into the thicker one's material)
  _push(i, add, mat = M_SOIL, depth = 0) {
    if (!(add > 0)) return;
    const b = i * LAYERS, lH = this.lH, lM = this.lM;
    let n = this.lN[i];
    if (mat === M_SOIL) {
      let soil = 0;
      for (let k = 0; k < n; k++) if (lM[b + k] === M_SOIL) soil += lH[b + k];
      this.ldep[i] = (this.ldep[i] * soil + depth * add) / (soil + add);
    }
    if (n && lM[b + n - 1] === mat) lH[b + n - 1] += add;
    else {
      if (n === LAYERS) {
        // full: first join neighbours of the same material, else the two lowest
        let j = 0;
        for (let k = 0; k < n - 1; k++) if (lM[b + k] === lM[b + k + 1]) { j = k; break; }
        if (lM[b + j] !== lM[b + j + 1] && lH[b + j + 1] > lH[b + j]) lM[b + j] = lM[b + j + 1];
        lH[b + j] += lH[b + j + 1];
        for (let k = j + 1; k < LAYERS - 1; k++) { lH[b + k] = lH[b + k + 1]; lM[b + k] = lM[b + k + 1]; }
        n--;
      }
      lM[b + n] = mat; lH[b + n] = add; n++;
      this.lN[i] = n;
    }
    this._sumLoose(i);
  }

  // take from the top layers; the pieces go to seg (top first) when given
  _pop(i, amount, seg = null) {
    const b = i * LAYERS, lH = this.lH, lM = this.lM;
    let n = this.lN[i], got = 0, s = 0;
    while (amount > 0 && n > 0) {
      const h = lH[b + n - 1], t = h < amount ? h : amount;
      if (seg) { seg.m[s] = lM[b + n - 1]; seg.h[s] = t; s++; }
      got += t; amount -= t;
      if (t >= h) { lH[b + n - 1] = 0; n--; } else lH[b + n - 1] = h - t;
    }
    if (seg) seg.n = s;
    this.lN[i] = n;
    this._sumLoose(i);
    return got;
  }

  // move loose material from the top of src onto dst (layer order is kept)
  _move(src, dst, amount) {
    const seg = this._seg, dep = this.ldep[src];
    const got = this._pop(src, amount, seg);
    for (let k = seg.n - 1; k >= 0; k--) this._push(dst, seg.h[k], seg.m[k], dep);
    return got;
  }

  // the loose cover of a cell is plain soil of the given thickness (old projects, migration)
  setLooseSoil(i, h) {
    this.lN[i] = h > 0 ? 1 : 0;
    this.lH[i * LAYERS] = h > 0 ? h : 0; this.lM[i * LAYERS] = M_SOIL;
    this.loose[i] = h > 0 ? h : 0;
  }
  layersFromLoose() { for (let i = 0; i < this.loose.length; i++) this.setLooseSoil(i, this.loose[i]); }

  // Remove material from one cell, loose layers first. Returns removed thickness.
  _take(i, amount) {
    let got = 0;
    if (this.loose[i] > 0) {
      const seg = this._seg, dep = this.ldep[i];
      got = this._pop(i, amount, seg);
      for (let k = 0; k < seg.n; k++) {
        this.take.m[seg.m[k]] += seg.h[k];
        if (seg.m[k] === M_SOIL) this.take.dv += seg.h[k] * dep;
      }
      this.take.v += got; amount -= got;
    }
    if (amount > 0) {
      const room = this.nat[i] - this.floorY;
      if (room > 0) {
        const t = Math.min(room, amount);
        this.take.v += t; this.take.m[M_SOIL] += t; this.take.dv += t * Math.max(0, this.orig[i] - this.nat[i] + t / 2);
        this.nat[i] -= t; got += t;
      }
    }
    return got;
  }

  // what was taken since resetTake(): mean source depth of the soil, share of each material
  resetTake() { this.take.v = 0; this.take.dv = 0; this.take.m.fill(0); }
  takenDepth() { return this.take.m[M_SOIL] > 0 ? this.take.dv / this.take.m[M_SOIL] : 0; }
  takenMaterials() { return Array.from(this.take.m); }

  _addLoose(i, add, depth, mat = M_SOIL) { this._push(i, add, mat, depth); }

  // One shovel bite. The blade (width w, length len, centred at cx,cz, facing
  // dirx,dirz) cuts everything above cutY. Returns removed volume (m³).
  carve(cx, cz, dirx, dirz, blade, cutY, maxVol) {
    if (maxVol <= 0) return 0;
    cutY = Math.max(cutY, this.floorY);
    const { nx: n, cell } = this;
    const hw = blade.width / 2, hl = blade.length / 2;
    const reach = Math.hypot(hw, hl) + cell * 2;
    const ix0 = Math.floor(this.toCellX(cx - reach)), ix1 = Math.ceil(this.toCellX(cx + reach));
    const iz0 = Math.floor(this.toCellZ(cz - reach)), iz1 = Math.ceil(this.toCellZ(cz + reach));
    const px = -dirz, pz = dirx; // blade sideways axis
    let removed = 0;
    let touched = false;
    // cut the cells nearest the blade tip first, so a full blade stops cleanly
    for (let iz = Math.max(0, iz0); iz <= Math.min(this.rz, iz1); iz++) {
      for (let ix = Math.max(0, ix0); ix <= Math.min(this.rx, ix1); ix++) {
        const x = this.toWorldX(ix) - cx, z = this.toWorldZ(iz) - cz;
        const u = x * dirx + z * dirz;           // along the blade
        const v = Math.abs(x * px + z * pz);     // across
        // a spade narrows towards its point
        let w = hw;
        if (blade.pointed && u > 0) w = hw * (1 - 0.5 * Math.pow(u / hl, 2));
        const outU = Math.max(0, Math.abs(u) - hl), outV = Math.max(0, v - w);
        const out = Math.hypot(outU, outV);
        if (out > cell * 1.6) continue;
        const allowed = cutY + out * 3.2; // steep but not perfectly vertical cut
        const i = iz * n + ix;
        if (this.conc[i] > 1e-5) continue;   // the blade does not cut concrete
        const h = this.nat[i] + this.loose[i];
        if (h <= allowed) continue;
        const want = Math.min(h - allowed, (maxVol - removed) / this.cellArea);
        if (want <= 0) continue;
        removed += this._take(i, want) * this.cellArea;
        touched = true;
        if (removed >= maxVol) break;
      }
      if (removed >= maxVol) break;
    }
    if (touched) this._touch(ix0, iz0, ix1, iz1);
    return removed;
  }

  // One step of the rake: head centred at cx,cz, pulled along the unit vector
  // dx,dz, the head lying across it. The rigid head rests on the ground — a
  // straight line fitted through the heights under it — but, held by the
  // hands, it cannot climb faster than s.climb per metre: it bites into a heap
  // instead of riding over it. A share of the loose soil above the line (less
  // the tine depth) goes ahead of the head into the windrow, which rolls along
  // and drops into hollows. Native ground is only scratched, never dug.
  // s carries the stroke: { width, band, bite, reach, climb, push, L, S, swept[], vAt }.
  // Returns the moved volume (m³). Volume is conserved exactly.
  rakeStep(s, cx, cz, dx, dz, dist) {
    const { nx: n, cell, nat, loose } = this;
    const ax = -dz, az = dx, hw = s.width / 2, band = s.band, ahead = band + cell * 2;
    const reach = hw + band + cell * 2;
    const ix0 = Math.max(0, Math.floor(this.toCellX(cx - reach))), ix1 = Math.min(this.rx, Math.ceil(this.toCellX(cx + reach)));
    const iz0 = Math.max(0, Math.floor(this.toCellZ(cz - reach))), iz1 = Math.min(this.rz, Math.ceil(this.toCellZ(cz + reach)));
    const cells = (this._rk ||= { i: new Int32Array(4096), v: new Float32Array(4096), x: new Float32Array(4096), z: new Float32Array(4096) });
    let m = 0, sw = 0, sv = 0, svv = 0, sh = 0, svh = 0, top = -1;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = this.toWorldX(ix), z = this.toWorldZ(iz), rx = x - cx, rz = z - cz;
      const u = rx * dx + rz * dz, v = rx * ax + rz * az;
      if (u < -band || u > 0 || v < -hw || v > hw || m >= 4096) continue;
      const i = iz * n + ix, h = nat[i] + loose[i];
      if (this.conc[i] > 1e-5) continue;   // the rake does not work concrete
      cells.i[m] = i; cells.v[m] = v; cells.x[m] = x; cells.z[m] = z; m++;
      sw++; sv += v; svv += v * v; sh += h; svh += v * h;
      if (h > top) top = h;
    }
    if (!m) return 0;
    const det = sw * svv - sv * sv;
    const b = det > 1e-12 ? (sw * svh - sv * sh) / det : 0, a = (sh - b * sv) / sw;
    s.L = s.L === null ? a : Math.min(a, s.L + s.climb * dist);
    // the tines are only so long: the head bar rides on top of a heap, the
    // soil above it is left behind (and the windrow cannot grow without end)
    s.L = Math.max(s.L, top - s.reach - Math.abs(b) * hw);
    s.S = b;
    let moved = 0;
    for (let k = 0; k < m; k++) {
      const i = cells.i[k], v = cells.v[k];
      if (Number.isNaN(s.vAt[i])) s.swept.push(i);
      s.vAt[i] = v;
      const lim = s.L + s.S * v - s.bite;
      const ex = Math.min(nat[i] + loose[i] - lim, loose[i]) * s.push;
      if (ex <= 1e-8) continue;
      const tx = cells.x[k] + dx * ahead, tz = cells.z[k] + dz * ahead;
      if (!this.inside(tx, tz)) continue;
      loose[i] -= ex;
      this._move(i, this.index(tx, tz), ex);
      moved += ex;
    }
    const e = Math.ceil(ahead / cell) + 1;
    this._touch(ix0 - e, iz0 - e, ix1 + e, iz1 + e);
    return moved * this.cellArea;
  }

  // the tines leave fine furrows along the stroke: loose soil moves from the
  // tine lines to between them (exactly as much as is taken)
  rakeGrooves(s, spacing, depth) {
    const { loose, vAt } = { loose: this.loose, vAt: s.vAt };
    const want = new Float32Array(s.swept.length);
    let take = 0, give = 0;
    for (let k = 0; k < s.swept.length; k++) {
      const i = s.swept[k];
      const c = Math.cos(2 * Math.PI * (vAt[i] + s.width / 2) / spacing);
      const d = -depth * c;
      want[k] = d < 0 ? -Math.min(-d, loose[i]) : d;
      if (want[k] < 0) take -= want[k]; else give += want[k];
    }
    if (take <= 0 || give <= 0) return;
    const kt = Math.min(1, give / take), kg = Math.min(1, take / give);
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (let k = 0; k < s.swept.length; k++) {
      const i = s.swept[k], d = want[k] * (want[k] < 0 ? kt : kg);
      if (d < 0) this._pop(i, -d); else this._push(i, d, this.topMat(i), this.ldep[i]);
      const ix = i % this.nx, iz = (i / this.nx) | 0;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
    this._touch(x0, z0, x1, z1);
  }

  // Drop a volume of loose material as a soft gaussian splat.
  deposit(x, z, vol, radius, depth = 0, mat = M_SOIL) {
    if (vol <= 0) return;
    const { nx: n, cell } = this;
    const r = Math.max(radius, cell * 0.8);
    const reach = r * 2.2;
    const ix0 = Math.max(0, Math.floor(this.toCellX(x - reach))), ix1 = Math.min(this.rx, Math.ceil(this.toCellX(x + reach)));
    const iz0 = Math.max(0, Math.floor(this.toCellZ(z - reach))), iz1 = Math.min(this.rz, Math.ceil(this.toCellZ(z + reach)));
    let wsum = 0;
    const inv = 1 / (2 * r * r);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const dx = this.toWorldX(ix) - x, dz = this.toWorldZ(iz) - z;
      wsum += Math.exp(-(dx * dx + dz * dz) * inv);
    }
    if (wsum <= 0) {
      // landed outside the grid: clamp to nearest cell
      const ix = Math.min(this.rx, Math.max(0, Math.round(this.toCellX(x))));
      const iz = Math.min(this.rz, Math.max(0, Math.round(this.toCellZ(z))));
      this._push(iz * n + ix, vol / this.cellArea, mat, depth);
      this._touch(ix, iz, ix, iz);
      return;
    }
    const k = vol / (wsum * this.cellArea);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const dx = this.toWorldX(ix) - x, dz = this.toWorldZ(iz) - z;
      this._push(iz * n + ix, k * Math.exp(-(dx * dx + dz * dz) * inv), mat, depth);
    }
    this._touch(ix0, iz0, ix1, iz1);
  }

  // Granular relaxation (angle of repose). Returns true while still moving.
  relax(iterations = 4) {
    for (let it = 0; it < iterations && this.active; it++) this._relaxOnce();
    return !!this.active;
  }

  // In-place (Gauss–Seidel) pass: each over-steep pair is relaxed straight to
  // its limit angle, alternating the sweep direction to avoid a bias.
  // Unconditionally stable, exactly volume-conserving.
  _relaxOnce() {
    const a = this.active;
    const { nx: n, cell, nat, loose, orig, rx, rz, conc } = this;
    const tN = REPOSE_NATIVE;
    const fwd = (this._sweep = !this._sweep);
    const D1 = cell, D2 = cell * Math.SQRT2;
    const x0 = a.x0, z0 = a.z0, x1 = a.x1, z1 = a.z1;
    let mx0 = 1e9, mz0 = 1e9, mx1 = -1, mz1 = -1;
    const NB = fwd ? NB_FWD : NB_BWD;
    for (let zz = z0; zz <= z1; zz++) {
      const iz = fwd ? zz : z1 - (zz - z0);
      for (let xx = x0; xx <= x1; xx++) {
        const ix = fwd ? xx : x1 - (xx - x0);
        const i = iz * n + ix;
        for (let k = 0; k < 4; k++) {
          const jx = ix + NB[k][0], jz = iz + NB[k][1];
          if (jx < 0 || jx > rx || jz < 0 || jz > rz) continue;
          const j = jz * n + jx;
          if (conc[i] > 1e-6 || conc[j] > 1e-6) continue;   // under / onto concrete nothing slides
          const d = nat[i] + loose[i] - nat[j] - loose[j];
          const dist = NB[k][2] ? D2 : D1;
          const ad = d < 0 ? -d : d;
          if (ad <= REPOSE_MIN * dist) continue;
          const src = d > 0 ? i : j, dst = d > 0 ? j : i;
          // loose material slides until the pair is at the angle of repose of the
          // material on top (sand flatter than crushed stone)
          const lim = REPOSE[this.topMat(src)] * dist;
          let moved = 0, mL = 0;
          if (ad > lim && loose[src] > 0) {
            mL = this._move(src, dst, Math.min((ad - lim) * 0.5, loose[src]));
            moved += mL;
          }
          // an over-steep wall of native ground crumbles into loose soil
          const limN = tN * dist, adN = ad - 2 * mL;
          if (adN > limN) {
            const mN = Math.min((adN - limN) * 0.5, nat[src] - this.floorY);
            if (mN > 0) {
              const dN = orig[src] - nat[src] + mN / 2;
              nat[src] -= mN; this._push(dst, mN, M_SOIL, dN); moved += mN;
            }
          }
          if (moved > 1e-7) {
            const ax = ix < jx ? ix : jx, bx = ix < jx ? jx : ix, az = iz < jz ? iz : jz, bz = iz < jz ? jz : iz;
            if (ax < mx0) mx0 = ax; if (bx > mx1) mx1 = bx;
            if (az < mz0) mz0 = az; if (bz > mz1) mz1 = bz;
          }
        }
      }
    }
    if (mx1 < 0) { this.active = null; return; }
    this.active = { x0: Math.max(0, mx0 - 2), z0: Math.max(0, mz0 - 2), x1: Math.min(rx, mx1 + 2), z1: Math.min(rz, mz1 + 2) };
    this._markMesh(mx0 - 1, mz0 - 1, mx1 + 1, mz1 + 1);
  }

  _markMesh(x0, z0, x1, z1) {
    this.meshDirty = grow(this.meshDirty, x0, z0, x1, z1, this.rx, this.rz);
    this.version++;
  }

  // Mean depth below natural ground over the cells for which inside(x, z) holds,
  // scanning only the given bounding box.
  regionDepth(bb, inside) {
    const n = this.nx;
    const ix0 = Math.max(0, Math.ceil(this.toCellX(bb.x0))), ix1 = Math.min(this.rx, Math.floor(this.toCellX(bb.x1)));
    const iz0 = Math.max(0, Math.ceil(this.toCellZ(bb.z0))), iz1 = Math.min(this.rz, Math.floor(this.toCellZ(bb.z1)));
    let depthSum = 0, cnt = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = this.toWorldX(ix), z = this.toWorldZ(iz);
      if (inside && !inside(x, z)) continue;
      depthSum += Math.max(0, TRAY.soil - this.hAt(iz * n + ix));
      cnt++;
    }
    return { meanDepth: cnt ? depthSum / cnt : 0, cells: cnt };
  }

  // minimum ground height along a segment (formwork boards stand on the lowest point)
  minAlong(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.ceil(len / this.cell));
    let m = 1e9;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      m = Math.min(m, this.heightAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t));
    }
    return m;
  }

  excavatedVolume() {
    // everything taken out of the native ground anywhere in the tray
    let v = 0;
    for (let i = 0; i < this.nat.length; i++) v += Math.max(0, this.orig[i] - this.nat[i]);
    return v * this.cellArea;
  }

  totalVolume() {
    let v = 0;
    for (let i = 0; i < this.nat.length; i++) v += this.nat[i] - this.floorY + this.loose[i];   // soil and loose materials (not concrete)
    return v * this.cellArea;
  }

  // ---- mesh ------------------------------------------------------------------
  buildMesh(material) {
    const { nx: n, nz } = this;
    const N = n * nz;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uv = new Float32Array(N * 2), soil = new Float32Array(N * 4), mats = new Float32Array(N * 3), cc = new Float32Array(N * 3);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      pos[i * 3] = this.toWorldX(ix); pos[i * 3 + 2] = this.toWorldZ(iz);
      uv[i * 2] = pos[i * 3] / SOIL_TILE; uv[i * 2 + 1] = -pos[i * 3 + 2] / SOIL_TILE;
      nor[i * 3 + 1] = 1;
    }
    const idx = new Uint32Array(this.rx * this.rz * 6);
    let k = 0;
    for (let iz = 0; iz < this.rz; iz++) for (let ix = 0; ix < this.rx; ix++) {
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      // alternate the diagonal to avoid directional artefacts
      if ((ix + iz) & 1) { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      else { idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNor = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSoil = new THREE.BufferAttribute(soil, 4).setUsage(THREE.DynamicDrawUsage);
    // share of sand / crushed stone 5–20 / 20–40 in the top 2 mm (the rest is soil)
    this.aMat = new THREE.BufferAttribute(mats, 3).setUsage(THREE.DynamicDrawUsage);
    // concrete: thickness, pour time, smoothness (the shader cures it with the clock)
    this.aConc = new THREE.BufferAttribute(cc, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('normal', this.aNor);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSoil', this.aSoil);
    g.setAttribute('aMat', this.aMat);
    g.setAttribute('aConc', this.aConc);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, TRAY.soil, 0), Math.hypot(this.halfX, this.halfZ) + 0.05);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-this.halfX, 0, -this.halfZ), new THREE.Vector3(this.halfX, 0.3, this.halfZ));
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.markAll();
    this.updateMesh();
    return this.mesh;
  }

  updateMesh() {
    const b = this.meshDirty;
    if (!b || !this.mesh) return false;
    this.meshDirty = null;
    const { nx: n, cell, nat, loose, orig, rx, rz, conc, cTime, cSm } = this;
    const pos = this.aPos.array, nor = this.aNor.array, soil = this.aSoil.array, mats = this.aMat.array, cc = this.aConc.array, { lH, lM, lN } = this;
    const occ = this._occ;
    const OR = 4; // occlusion probe radius (cells)
    const ox0 = Math.max(0, b.x0 - OR - 1), ox1 = Math.min(rx, b.x1 + OR + 1);
    const oz0 = Math.max(0, b.z0 - OR - 1), oz1 = Math.min(rz, b.z1 + OR + 1);
    const H = (ix, iz) => {
      ix = ix < 0 ? 0 : ix > rx ? rx : ix;
      iz = iz < 0 ? 0 : iz > rz ? rz : iz;
      const i = iz * n + ix; return nat[i] + loose[i] + conc[i];
    };
    for (let iz = oz0; iz <= oz1; iz++) for (let ix = ox0; ix <= ox1; ix++) {
      const i = iz * n + ix;
      const h = nat[i] + loose[i] + conc[i];
      pos[i * 3 + 1] = h;
      const hx = H(ix + 1, iz) - H(ix - 1, iz), hz = H(ix, iz + 1) - H(ix, iz - 1);
      const inv = 1 / Math.hypot(hx, 2 * cell, hz);
      nor[i * 3] = -hx * inv; nor[i * 3 + 1] = 2 * cell * inv; nor[i * 3 + 2] = -hz * inv;
      // cheap cavity term: how far this point sits below its surroundings
      let m = 0;
      m += H(ix + OR, iz) + H(ix - OR, iz) + H(ix, iz + OR) + H(ix, iz - OR);
      m += H(ix + 2, iz + 2) + H(ix - 2, iz - 2) + H(ix - 2, iz + 2) + H(ix + 2, iz - 2);
      const cav = (m / 8 - h) / 0.006;
      occ[i] = cav < 0 ? 0 : cav > 1 ? 1 : cav;
      soil[i * 4] = Math.max(0, orig[i] - nat[i]);
      soil[i * 4 + 1] = loose[i];
      soil[i * 4 + 2] = occ[i];
      soil[i * 4 + 3] = this.ldep[i];
      let f1 = 0, f2 = 0, f3 = 0;
      for (let k = lN[i] - 1, rest = 0.002; k >= 0 && rest > 0; k--) {
        const h = Math.min(rest, lH[i * LAYERS + k]), m = lM[i * LAYERS + k];
        if (m === 1) f1 += h; else if (m === 2) f2 += h; else if (m === 3) f3 += h;
        rest -= h;
      }
      mats[i * 3] = f1 * 500; mats[i * 3 + 1] = f2 * 500; mats[i * 3 + 2] = f3 * 500;
      cc[i * 3] = conc[i]; cc[i * 3 + 1] = cTime[i]; cc[i * 3 + 2] = cSm[i];
    }
    const start = oz0 * n, count = (oz1 - oz0 + 1) * n;
    // ranges pile up until three uploads them (several updates between two frames
    // must all reach the GPU): keep one range covering all of them
    for (const a of [this.aPos, this.aNor, this.aSoil, this.aMat, this.aConc]) {
      let s0 = start * a.itemSize, s1 = (start + count) * a.itemSize;
      for (const r of a.updateRanges) { s0 = Math.min(s0, r.start); s1 = Math.max(s1, r.start + r.count); }
      a.clearUpdateRanges();
      a.addUpdateRange(s0, s1 - s0);
      a.needsUpdate = true;
    }
    return true;
  }

  // ---- concrete --------------------------------------------------------------------------
  // Formwork boards become walls the concrete cannot flow into. Each entry: a, b (the
  // line), n (direction from the line into the board), t (board thickness), top.
  setWalls(list) {
    const { wall, nx: n, cell } = this;
    wall.fill(0);
    const pad = cell * 0.55;
    for (const w of list) {
      const [ax, az] = w.a, [bx, bz] = w.b, [nx, nz] = w.n;
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      const ux = dx / L, uz = dz / L, over = w.t + pad;
      const xs = [ax - ux * over, bx + ux * over, ax - ux * over + nx * w.t, bx + ux * over + nx * w.t];
      const zs = [az - uz * over, bz + uz * over, az - uz * over + nz * w.t, bz + uz * over + nz * w.t];
      const ix0 = Math.max(0, Math.floor(this.toCellX(Math.min(...xs) - pad))), ix1 = Math.min(this.rx, Math.ceil(this.toCellX(Math.max(...xs) + pad)));
      const iz0 = Math.max(0, Math.floor(this.toCellZ(Math.min(...zs) - pad))), iz1 = Math.min(this.rz, Math.ceil(this.toCellZ(Math.max(...zs) + pad)));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const rx = this.toWorldX(ix) - ax, rz = this.toWorldZ(iz) - az;
        const u = rx * ux + rz * uz, v = rx * nx + rz * nz;
        if (u >= -over && u <= L + over && v >= -pad && v <= w.t + pad) { const i = iz * n + ix; wall[i] = Math.max(wall[i], w.top); }
      }
    }
  }

  curedAt(i) { return Math.max(0, ((this.clock || 0) - this.cTime[i]) / CONCRETE.cure); }

  _concAdd(i, add, smooth = 0) {
    const c = this.conc[i], t = c + add;
    this.cTime[i] = c > 0 ? (this.cTime[i] * c + (this.clock || 0) * add) / t : (this.clock || 0);
    this.cSm[i] = c > 0 ? (this.cSm[i] * c + smooth * add) / t : smooth;
    this.conc[i] = t;
  }

  _concTouch(ix0, iz0, ix1, iz1) {
    this.cActive = grow(this.cActive, ix0 - 1, iz0 - 1, ix1 + 1, iz1 + 1, this.rx, this.rz);
    this._markMesh(ix0 - 1, iz0 - 1, ix1 + 1, iz1 + 1);
  }

  // pour a volume of fresh concrete as a soft splat (never into a board)
  depositConc(x, z, vol, radius) {
    if (vol <= 0) return;
    const { nx: n, cell, wall } = this;
    const r = Math.max(radius, cell), reach = r * 2.2, inv = 1 / (2 * r * r);
    const ix0 = Math.max(0, Math.floor(this.toCellX(x - reach))), ix1 = Math.min(this.rx, Math.ceil(this.toCellX(x + reach)));
    const iz0 = Math.max(0, Math.floor(this.toCellZ(z - reach))), iz1 = Math.min(this.rz, Math.ceil(this.toCellZ(z + reach)));
    let wsum = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      if (wall[iz * n + ix]) continue;
      const dx = this.toWorldX(ix) - x, dz = this.toWorldZ(iz) - z;
      wsum += Math.exp(-(dx * dx + dz * dz) * inv);
    }
    if (wsum <= 0) return;
    const k = vol / (wsum * this.cellArea);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * n + ix;
      if (wall[i]) continue;
      const dx = this.toWorldX(ix) - x, dz = this.toWorldZ(iz) - z;
      this._concAdd(i, k * Math.exp(-(dx * dx + dz * dz) * inv));
    }
    this._concTouch(ix0, iz0, ix1, iz1);
    this.version++;
  }

  // Pumped concrete spreads at once into a puddle: a very flat cone around the hose
  // (slope = the yield), filling the lowest places it can reach — held by boards and
  // by ground higher than the concrete. The level of the cone is found so that
  // exactly `vol` is added. maxR limits how far one frame's concrete gets.
  pourConc(x, z, vol, maxR = 0.3) {
    if (vol <= 0) return;
    const { nx: n, cell, wall, rx, rz } = this;
    const c0x = Math.round(this.toCellX(x)), c0z = Math.round(this.toCellZ(z));
    if (c0x < 0 || c0x > rx || c0z < 0 || c0z > rz) return;
    const R = Math.ceil(maxR / cell), Y = CONCRETE.yield * cell;
    const buf = (this._pour ||= { i: new Int32Array(200000), d: new Float32Array(200000), s: new Float32Array(200000), seen: new Uint32Array(this.nat.length), stamp: 0 });
    // cells connected to the hose (not through boards), wet under a level L0
    const collect = (L0) => {
      const stamp = ++buf.stamp;
      let head = 0, m = 0;
      const i0 = c0z * n + c0x;
      if (wall[i0]) return 0;
      buf.i[m] = i0; buf.seen[i0] = stamp; m++;
      while (head < m && m < buf.i.length - 8) {
        const i = buf.i[head++], ix = i % n, iz = (i / n) | 0;
        for (let k = 0; k < 4; k++) {
          const jx = ix + (k === 0 ? 1 : k === 1 ? -1 : 0), jz = iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (jx < 0 || jx > rx || jz < 0 || jz > rz || Math.abs(jx - c0x) > R || Math.abs(jz - c0z) > R) continue;
          const j = jz * n + jx;
          if (buf.seen[j] === stamp || wall[j]) continue;
          buf.seen[j] = stamp;
          const d = Math.hypot(jx - c0x, jz - c0z);
          if (d > R) continue;
          if (L0 !== null && L0 - Y * d <= this.hAt(j)) continue;   // concrete does not climb over it
          buf.i[m++] = j;
        }
      }
      for (let k = 0; k < m; k++) { const i = buf.i[k]; buf.d[k] = Math.hypot(i % n - c0x, ((i / n) | 0) - c0z); buf.s[k] = this.hAt(i); }
      return m;
    };
    const solve = (m) => {
      let lo = 1e9, hi = -1e9;
      for (let k = 0; k < m; k++) { lo = Math.min(lo, buf.s[k] + Y * buf.d[k]); hi = Math.max(hi, buf.s[k] + Y * buf.d[k]); }
      const need = vol / this.cellArea;
      hi += need;
      for (let it = 0; it < 26; it++) {   // 26 halvings: far below a micron
        const L = (lo + hi) / 2;
        let v = 0;
        for (let k = 0; k < m; k++) { const a = L - Y * buf.d[k] - buf.s[k]; if (a > 0) v += a; }
        if (v > need) hi = L; else lo = L;
      }
      return (lo + hi) / 2;
    };
    let m = collect(null), L0 = solve(m);
    for (let pass = 0; pass < 2; pass++) { m = collect(L0); if (!m) return; L0 = solve(m); }
    let sum = 0;
    for (let k = 0; k < m; k++) { const a = L0 - Y * buf.d[k] - buf.s[k]; if (a > 0) sum += a; }
    if (sum <= 0) return;
    const scale = vol / this.cellArea / sum;   // exact volume
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (let k = 0; k < m; k++) {
      const a = (L0 - Y * buf.d[k] - buf.s[k]) * scale;
      if (a <= 0) continue;
      const i = buf.i[k], ix = i % n, iz = (i / n) | 0;
      this._concAdd(i, a);
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
    if (x1 >= 0) this._concTouch(x0, z0, x1, z1);
  }

  // Viscous spreading of fresh concrete (Gauss–Seidel like the soil, but with a
  // small yield slope and only a share of the excess per pass, so it creeps).
  // Exactly volume-conserving. region (cell bbox) limits it, e.g. the vibrator.
  concRelax(iterations = 1, yieldTan = CONCRETE.yield, rate = CONCRETE.rate, region = null) {
    for (let it = 0; it < iterations; it++) {
      const a = region || this.cActive;
      if (!a) return false;
      const { nx: n, cell, nat, loose, conc, wall, cTime, cSm, rx, rz } = this;
      const D1 = cell, D2 = cell * Math.SQRT2, stiffT = (this.clock || 0) - CONCRETE.stiff * CONCRETE.cure;
      const fwd = (this._csweep = !this._csweep), NB = fwd ? NB_FWD : NB_BWD;
      let mx0 = 1e9, mz0 = 1e9, mx1 = -1, mz1 = -1;
      for (let zz = a.z0; zz <= a.z1; zz++) {
        const iz = fwd ? zz : a.z1 - (zz - a.z0);
        for (let xx = a.x0; xx <= a.x1; xx++) {
          const ix = fwd ? xx : a.x1 - (xx - a.x0);
          const i = iz * n + ix;
          if (wall[i]) continue;
          for (let k = 0; k < 4; k++) {
            const jx = ix + NB[k][0], jz = iz + NB[k][1];
            if (jx < 0 || jx > rx || jz < 0 || jz > rz) continue;
            const j = jz * n + jx;
            if (wall[j] || (conc[i] <= 0 && conc[j] <= 0)) continue;
            const d = nat[i] + loose[i] + conc[i] - nat[j] - loose[j] - conc[j];
            const src = d > 0 ? i : j, dst = d > 0 ? j : i;
            if (conc[src] <= 0 || cTime[src] < stiffT) continue;   // nothing to flow, or already set
            const ad = d < 0 ? -d : d, lim = yieldTan * (NB[k][2] ? D2 : D1);
            // below 0.02 mm of excess it stays: the flow comes to a real stop (and a
            // journal entry, taken once it has stopped, is the final state)
            if (ad <= lim + 2e-5) continue;
            const m = Math.min((ad - lim) * 0.5 * rate, conc[src]);
            if (m < 1e-9) continue;
            const ts = cTime[src], ss = cSm[src];
            conc[src] -= m;
            const c = conc[dst], t = c + m;
            cTime[dst] = c > 0 ? (cTime[dst] * c + ts * m) / t : ts;
            cSm[dst] = c > 0 ? (cSm[dst] * c + ss * 0.6 * m) / t : ss * 0.6;
            conc[dst] = t;
            const ax = ix < jx ? ix : jx, bx = ix < jx ? jx : ix, az = iz < jz ? iz : jz, bz = iz < jz ? jz : iz;
            if (ax < mx0) mx0 = ax; if (bx > mx1) mx1 = bx; if (az < mz0) mz0 = az; if (bz > mz1) mz1 = bz;
          }
        }
      }
      if (mx1 < 0) { if (!region) this.cActive = null; return false; }
      if (!region) this.cActive = { x0: Math.max(0, mx0 - 2), z0: Math.max(0, mz0 - 2), x1: Math.min(rx, mx1 + 2), z1: Math.min(rz, mz1 + 2) };
      else this.cActive = grow(this.cActive, mx0 - 2, mz0 - 2, mx1 + 2, mz1 + 2, rx, rz);
      this._markMesh(mx0 - 1, mz0 - 1, mx1 + 1, mz1 + 1);
    }
    return true;
  }

  cellBox(x, z, r) {
    return { x0: Math.max(0, Math.floor(this.toCellX(x - r))), z0: Math.max(0, Math.floor(this.toCellZ(z - r))),
      x1: Math.min(this.rx, Math.ceil(this.toCellX(x + r))), z1: Math.min(this.rz, Math.ceil(this.toCellZ(z + r))) };
  }

  // The screed rule pulled over the concrete: everything above the level L (where it
  // rides on the formwork) goes ahead of it; over a board the excess drops outside.
  // Swept concrete gets a flat, half-finished surface.
  screedStep(s, cx, cz, dx, dz) {
    const { nx: n, cell, conc, wall } = this;
    const ax = -dz, az = dx, hw = s.width / 2, band = s.band;
    const b = this.cellBox(cx, cz, hw + band + cell * 3);
    let moved = 0;
    for (let iz = b.z0; iz <= b.z1; iz++) for (let ix = b.x0; ix <= b.x1; ix++) {
      const i = iz * n + ix;
      if (conc[i] <= 0 || wall[i]) continue;
      const x = this.toWorldX(ix), z = this.toWorldZ(iz), rx = x - cx, rz = z - cz;
      const u = rx * dx + rz * dz, v = rx * ax + rz * az;
      if (u < -band || u > 0 || v < -hw || v > hw) continue;
      if (this.cTime[i] < (this.clock || 0) - CONCRETE.stiff * CONCRETE.cure) continue;
      this.cSm[i] = Math.max(this.cSm[i], 0.45);
      const ex = Math.min(this.hAt(i) - s.L, conc[i]) * 0.9;
      if (ex <= 1e-8) continue;
      // ahead of the rule; past a board if there is one
      let tx = x + dx * (band + cell * 2), tz = z + dz * (band + cell * 2);
      for (let k = 0; k < 6 && this.inside(tx, tz) && wall[this.index(tx, tz)]; k++) { tx += dx * cell * 1.5; tz += dz * cell * 1.5; }
      if (!this.inside(tx, tz)) continue;
      const j = this.index(tx, tz);
      if (wall[j]) continue;
      conc[i] -= ex;
      this._concAdd(j, ex, this.cSm[i] * 0.5);
      moved += ex;
    }
    this._concTouch(b.x0 - 4, b.z0 - 4, b.x1 + 4, b.z1 + 4);
    this.version++;
    return moved * this.cellArea;
  }

  // immersion vibrator: the concrete around it flows almost flat for a moment
  vibrate(x, z, r) {
    const b = this.cellBox(x, z, r);
    this.concRelax(3, CONCRETE.yield * 0.12, 0.5, b);
  }

  // steel trowel / float: closes the surface (smooth) and evens small lumps
  trowelStep(x, z, dx, dz, w, len) {
    const { nx: n, conc, cSm } = this;
    const ax = -dz, az = dx, b = this.cellBox(x, z, Math.max(w, len));
    const stiffT = (this.clock || 0) - 0.75 * CONCRETE.cure;
    let any = false;
    for (let iz = b.z0; iz <= b.z1; iz++) for (let ix = b.x0; ix <= b.x1; ix++) {
      const i = iz * n + ix;
      if (conc[i] <= 0 || this.cTime[i] < stiffT) continue;
      const rx = this.toWorldX(ix) - x, rz = this.toWorldZ(iz) - z;
      if (Math.abs(rx * dx + rz * dz) > len / 2 || Math.abs(rx * ax + rz * az) > w / 2) continue;
      cSm[i] = Math.min(1, cSm[i] + 0.3);
      any = true;
    }
    if (any) {
      this.concRelax(2, 0.002, 0.5, b);
      this._markMesh(b.x0, b.z0, b.x1, b.z1);
      this.version++;
    }
    return any;
  }

  concVolume() {
    let v = 0;
    for (let i = 0; i < this.conc.length; i++) v += this.conc[i];
    return v * this.cellArea;
  }

  // ---- snapshots (undo, save, Blender export) -------------------------------
  // One snapshot buffer is reused (only one action is pending at a time).
  snapshot() {
    const s = (this._snap ||= { nat: new Float32Array(this.nat.length), loose: new Float32Array(this.nat.length), ldep: new Float32Array(this.nat.length),
      lH: new Float32Array(this.lH.length), lM: new Uint8Array(this.lM.length), lN: new Uint8Array(this.lN.length),
      conc: new Float32Array(this.nat.length), cTime: new Float32Array(this.nat.length), cSm: new Float32Array(this.nat.length) });
    s.nat.set(this.nat); s.loose.set(this.loose); s.ldep.set(this.ldep); s.lH.set(this.lH); s.lM.set(this.lM); s.lN.set(this.lN);
    s.conc.set(this.conc); s.cTime.set(this.cTime); s.cSm.set(this.cSm);
    return s;
  }

  restore(s) {
    this.nat.set(s.nat); this.loose.set(s.loose);
    if (s.ldep) this.ldep.set(s.ldep);
    if (s.lH) { this.lH.set(s.lH); this.lM.set(s.lM); this.lN.set(s.lN); } else this.layersFromLoose();
    if (s.conc) { this.conc.set(s.conc); this.cTime.set(s.cTime); this.cSm.set(s.cSm); } else this.conc.fill(0);
    this.cActive = null;
    this.active = null;
    this.markAll(); this.active = null;
  }

  // Sparse diff between a snapshot and the current state (heights, layers, soil colour).
  diffFrom(s) {
    const idx = [], L = LAYERS;
    const { nat, loose, lN, lH, lM, conc, cTime, cSm } = this;
    for (let i = 0; i < nat.length; i++) {
      if (s.nat[i] !== nat[i] || s.loose[i] !== loose[i] || s.lN[i] !== lN[i] || s.conc[i] !== conc[i] || s.cSm[i] !== cSm[i] || s.cTime[i] !== cTime[i]) { idx.push(i); continue; }
      const b = i * L;
      for (let k = 0; k < lN[i]; k++) if (s.lH[b + k] !== lH[b + k] || s.lM[b + k] !== lM[b + k]) { idx.push(i); break; }
    }
    const m = idx.length;
    const d = {
      idx: new Uint32Array(idx), bn: new Float32Array(m), bl: new Float32Array(m), an: new Float32Array(m), al: new Float32Array(m),
      bd: new Float32Array(m), ad: new Float32Array(m), bN: new Uint8Array(m), aN: new Uint8Array(m),
      bH: new Float32Array(m * L), aH: new Float32Array(m * L), bM: new Uint8Array(m * L), aM: new Uint8Array(m * L),
      bC: new Float32Array(m), aC: new Float32Array(m), bT: new Float32Array(m), aT: new Float32Array(m), bS: new Float32Array(m), aS: new Float32Array(m),
    };
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      d.bn[k] = s.nat[i]; d.bl[k] = s.loose[i]; d.an[k] = nat[i]; d.al[k] = loose[i];
      d.bd[k] = s.ldep[i]; d.ad[k] = this.ldep[i]; d.bN[k] = s.lN[i]; d.aN[k] = lN[i];
      d.bC[k] = s.conc[i]; d.aC[k] = conc[i]; d.bT[k] = s.cTime[i]; d.aT[k] = cTime[i]; d.bS[k] = s.cSm[i]; d.aS[k] = cSm[i];
      for (let q = 0; q < L; q++) {
        d.bH[k * L + q] = s.lH[i * L + q]; d.aH[k * L + q] = lH[i * L + q];
        d.bM[k * L + q] = s.lM[i * L + q]; d.aM[k * L + q] = lM[i * L + q];
      }
    }
    return d;
  }

  applyDiff(d, forward) {
    const N = forward ? d.an : d.bn, Lo = forward ? d.al : d.bl, L = LAYERS;
    const H = forward ? d.aH : d.bH, M = forward ? d.aM : d.bM, C = forward ? d.aN : d.bN, D = forward ? d.ad : d.bd;
    const CC = forward ? d.aC : d.bC, CT = forward ? d.aT : d.bT, CS = forward ? d.aS : d.bS;
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (let k = 0; k < d.idx.length; k++) {
      const i = d.idx[k];
      this.nat[i] = N[k];
      if (H) {   // BUILD 17+: the layers themselves
        this.lN[i] = C[k];
        for (let q = 0; q < L; q++) { this.lH[i * L + q] = H[k * L + q]; this.lM[i * L + q] = M[k * L + q]; }
        this.loose[i] = Lo[k];
        if (D) this.ldep[i] = D[k];
      } else this.setLooseSoil(i, Lo[k]);   // older journals: all loose material was soil
      if (CC) { this.conc[i] = CC[k]; this.cTime[i] = CT[k]; this.cSm[i] = CS[k]; }   // BUILD 19+: concrete
      const ix = i % this.nx, iz = (i / this.nx) | 0;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
    if (x1 >= 0) { this._markMesh(x0 - 1, z0 - 1, x1 + 1, z1 + 1); }
    this.active = null; // journal states are already at rest
    this.cActive = null;
  }

  // volume of each material lying loose on the plot (m³ of the model)
  materialVolumes() {
    const v = new Array(MATERIALS.length).fill(0), { lN, lH, lM } = this;
    for (let i = 0; i < lN.length; i++) for (let k = 0, b = i * LAYERS; k < lN[i]; k++) v[lM[b + k]] += lH[b + k];
    return v.map((x) => x * this.cellArea);
  }
}

const NB_FWD = [[1, 0, 0], [0, 1, 0], [1, 1, 1], [-1, 1, 1]];
const NB_BWD = [[-1, 0, 0], [0, -1, 0], [-1, -1, 1], [1, -1, 1]];

function grow(b, x0, z0, x1, z1, rx, rz) {
  x0 = Math.max(0, x0); z0 = Math.max(0, z0); x1 = Math.min(rx, x1); z1 = Math.min(rz, z1);
  if (!b) return { x0, z0, x1, z1 };
  return { x0: Math.min(b.x0, x0), z0: Math.min(b.z0, z0), x1: Math.max(b.x1, x1), z1: Math.max(b.z1, z1) };
}
