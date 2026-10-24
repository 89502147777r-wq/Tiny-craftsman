import * as THREE from 'three';
import { TRAY, SOIL_TILE, TERRAIN_CELL, REPOSE_NATIVE, MATERIALS, M_SOIL, CONCRETE, MODEL_SCALE } from '../config.js';

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
const MM_CHIP = 0.0005 / MODEL_SCALE;   // (a crust thinner than 0,5 mm: gone)
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
    // extra stiffness (slope) of concrete that fell off as a lump: it stays a lump
    // (only affects flow inside one action; not kept in the journal)
    this.cY = new Float32Array(N);
    // formwork boards: top height of the board standing on a cell (0 = none);
    // concrete cannot flow into these cells
    this.wall = new Float32Array(N);
    // zones the loose material keeps to: 0 the plot, 1 inside the boards of a blind area (what is
    // poured there does not run out under the boards, nor in from outside)
    this.zone = new Uint8Array(N);
    this.zTop = new Float32Array(N);   // (inside: the top of the board it is held by — over it, it runs over)
    // concrete is simulated tile by tile (16 × 16 cells): only tiles where it moves
    this.TS = 16; this.tnx = Math.ceil(this.nx / 16); this.tnz = Math.ceil(this.nz / 16);
    this._tAct = new Uint8Array(this.tnx * this.tnz); this._tList = [];
    this.meshTiles = new Set();
    this.vib = new Float32Array(N);   // vibrated until (project clock)
    this.cBase = new Float32Array(N);   // set concrete under a fresh layer (that part does not flow)
    // loose material lying ON the concrete (sand or stone poured onto a slab): thickness, material
    this.top = new Float32Array(N);
    this.topM = new Uint8Array(N);
    // bitumen coat on the faces of the concrete (0…1) and how well the loose material
    // on top is compacted (0 = as tipped … 1 = done with the plate compactor)
    this.bit = new Float32Array(N);
    this.comp = new Float32Array(N);
    // taken since the last reset: per material, and soil depth·volume
    this.take = { v: 0, dv: 0, m: new Float64Array(MATERIALS.length), c: 0 };
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
        this.orig[i] = h; this.nat[i] = h; this.loose[i] = 0; this.ldep[i] = 0; this.lN[i] = 0; this.conc[i] = 0; this.cSm[i] = 0; this.top[i] = 0; this.bit[i] = 0; this.comp[i] = 0;
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
  hAt(i) { return this.nat[i] + this.loose[i] + this.conc[i] + this.top[i]; }
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
    if (this.conc[i] > 1e-6) { this._pushTop(i, add, mat); return; }   // onto concrete: it lies on top of it
    if (this.comp[i] > 0) this.comp[i] *= Math.min(1, this.loose[i] / (this.loose[i] + add * 4));   // fresh material on top: loose again
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

  // loose material on concrete: one layer per cell; a different material poured on it
  // mixes in (the cell shows whichever there is more of)
  _pushTop(i, add, mat) {
    const t = this.top[i];
    if (t <= 0 || mat === this.topM[i] || add > t) this.topM[i] = mat;
    this.top[i] = t + add;
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
  resetTake() { this.take.v = 0; this.take.dv = 0; this.take.m.fill(0); this.take.c = 0; }
  takenConcrete() { return this.take.c; }
  takenDepth() { return this.take.m[M_SOIL] > 0 ? this.take.dv / this.take.m[M_SOIL] : 0; }
  takenMaterials() { return Array.from(this.take.m); }

  _addLoose(i, add, depth, mat = M_SOIL) { this._push(i, add, mat, depth); }

  // One shovel bite. The blade (width w, length len, centred at cx,cz, facing
  // dirx,dirz) cuts everything above cutY. Returns removed volume (m³).
  carve(cx, cz, dirx, dirz, blade, cutY, maxVol, wet = false) {   // wet: this stroke already scoops fresh concrete
    if (maxVol <= 0) return 0;
    cutY = Math.max(cutY, this.floorY);
    const { nx: n, cell } = this;
    const hw = blade.width / 2, hl = blade.length / 2;
    const reach = Math.hypot(hw, hl) + cell * 2;
    const ix0 = Math.floor(this.toCellX(cx - reach)), ix1 = Math.ceil(this.toCellX(cx + reach));
    const iz0 = Math.floor(this.toCellZ(cz - reach)), iz1 = Math.ceil(this.toCellZ(cz + reach));
    const px = -dirz, pz = dirx; // blade sideways axis
    let removed = 0;
    let touched = false, conc = false;
    const soil = [];
    const setT = (this.clock || 0) - CONCRETE.stiff * CONCRETE.cure;
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
        if (this.top[i] > 0) {
          // sand / stone lying on concrete: the blade takes it first
          const h = this.hAt(i);
          if (h > allowed) {
            const want = Math.min(h - allowed, this.top[i], (maxVol - removed) / this.cellArea);
            if (want > 0) {
              this.top[i] -= want; if (this.top[i] < 1e-9) this.top[i] = 0;
              this.take.m[this.topM[i]] += want; this.take.v += want; removed += want * this.cellArea; touched = true;
              if (removed >= maxVol) break;
            }
          }
          if (this.top[i] > 0) continue;
        }
        if (this.conc[i] > 1e-5) {
          // fresh concrete: the blade takes it (not the soil under it); set concrete it cannot cut
          const mob = this.conc[i] - this.cBase[i], h = this.nat[i] + this.loose[i] + this.conc[i];
          if (mob <= 1e-6 || this.cTime[i] < setT || h <= allowed) continue;
          const want = Math.min(h - allowed, mob, (maxVol - removed) / this.cellArea);
          if (want <= 0) continue;
          this.conc[i] -= want; this.take.c += want; removed += want * this.cellArea; touched = true; conc = true;
          if (removed >= maxVol) break;
          continue;
        }
        // soil: cut after the concrete, and not at all by a blade scooping a puddle
        if (this.nat[i] + this.loose[i] > allowed) soil.push(i, allowed);
      }
      if (removed >= maxVol) break;
    }
    if (!conc && !wet) {
      for (let k = 0; k < soil.length && removed < maxVol; k += 2) {
        const i = soil[k], want = Math.min(this.nat[i] + this.loose[i] - soil[k + 1], (maxVol - removed) / this.cellArea);
        if (want <= 0) continue;
        removed += this._take(i, want) * this.cellArea;
        touched = true;
      }
    }
    if (touched) this._touch(ix0, iz0, ix1, iz1);
    if (conc) { this._concTouch(Math.max(0, ix0), Math.max(0, iz0), Math.min(this.rx, ix1), Math.min(this.rz, iz1)); }   // the cut fills in a little: fresh concrete flows
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
      const ti = this.index(tx, tz);
      if (this.zone[ti] !== this.zone[i]) continue;   // (it stays inside the boards)
      loose[i] -= ex;
      this._move(i, ti, ex);
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
    const { nx: n, cell, nat, loose, orig, rx, rz, conc, top, topM } = this;
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
          // (into or out of a blind area: only what is over the board's top, at the boards)
          let zCap = Infinity;
          if (this.zone[i] !== this.zone[j]) {
            const zt = Math.min(this.zTop[i] || Infinity, this.zTop[j] || Infinity), hi = Math.max(nat[i] + loose[i], nat[j] + loose[j]);
            if (!(hi > zt)) continue;
            zCap = hi - zt;
          }
          if (conc[i] > 1e-6 || conc[j] > 1e-6) {
            // concrete itself does not slide here, but what lies on it does (sand on a
            // slab, off its edge), and loose material next to a slab slides onto it
            const d = nat[i] + loose[i] + conc[i] + top[i] - nat[j] - loose[j] - conc[j] - top[j];
            const dist = NB[k][2] ? D2 : D1, ad = d < 0 ? -d : d;
            if (ad <= REPOSE_MIN * dist) continue;
            const src = d > 0 ? i : j, dst = d > 0 ? j : i, onC = conc[src] > 1e-6;
            const avail = onC ? top[src] : loose[src];
            if (avail <= 0) continue;
            const lim = REPOSE[onC ? topM[src] : this.topMat(src)] * dist;
            if (ad <= lim) continue;
            const m = Math.min((ad - lim) * 0.5, avail);
            if (onC) { top[src] -= m; this._push(dst, m, topM[src], this.ldep[src]); }
            else this._move(src, dst, m);
            if (m > 1e-7) {
              const ax = ix < jx ? ix : jx, bx = ix < jx ? jx : ix, az = iz < jz ? iz : jz, bz = iz < jz ? jz : iz;
              if (ax < mx0) mx0 = ax; if (bx > mx1) mx1 = bx;
              if (az < mz0) mz0 = az; if (bz > mz1) mz1 = bz;
            }
            continue;
          }
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
            mL = this._move(src, dst, Math.min((ad - lim) * 0.5, loose[src], zCap));
            moved += mL;
          }
          if (zCap < Infinity) { if (mL > 1e-7) { const ax = ix < jx ? ix : jx, bx = ix < jx ? jx : ix, az = iz < jz ? iz : jz, bz = iz < jz ? jz : iz; if (ax < mx0) mx0 = ax; if (bx > mx1) mx1 = bx; if (az < mz0) mz0 = az; if (bz > mz1) mz1 = bz; } continue; }
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

  // is concrete still moving somewhere (null = at rest); setting it to null stops it
  get cActive() { return this._tList && this._tList.length ? this._tList : null; }
  set cActive(v) { if (!v && this._tList) { for (const t of this._tList) this._tAct[t] = 0; this._tList.length = 0; } }

  _tileOn(t) { if (!this._tAct[t]) { this._tAct[t] = 1; this._tList.push(t); } }

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
    for (let i = 0; i < this.nat.length; i++) v += this.nat[i] - this.floorY + this.loose[i] + this.top[i];   // soil and loose materials (not concrete)
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
    // bitumen coat, compaction
    this.aExtra = new THREE.BufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('normal', this.aNor);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSoil', this.aSoil);
    g.setAttribute('aMat', this.aMat);
    g.setAttribute('aConc', this.aConc);
    g.setAttribute('aExtra', this.aExtra);
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
    if (!this.mesh) return false;
    const rects = [];
    if (this.meshDirty) { rects.push(this.meshDirty); this.meshDirty = null; }
    // concrete tiles that moved (each on its own: far apart they would make one huge box)
    for (const t of this.meshTiles) {
      const tx = t % this.tnx, tz = (t / this.tnx) | 0, TS = this.TS;
      rects.push({ x0: tx * TS, z0: tz * TS, x1: Math.min(this.rx, tx * TS + TS - 1), z1: Math.min(this.rz, tz * TS + TS - 1) });
    }
    this.meshTiles.clear();
    if (!rects.length) return false;
    // several updates before an upload add up: one span of cells per row
    const n = this.nx, attrs = [this.aPos, this.aNor, this.aSoil, this.aMat, this.aConc, this.aExtra];
    if (!this._rowLo) { this._rowLo = new Int32Array(this.nz).fill(1e9); this._rowHi = new Int32Array(this.nz).fill(-1); this._rowsUsed = false; }
    const lo = this._rowLo, hi = this._rowHi;
    if (this._rowsUsed && !this.aPos.updateRanges.length) { lo.fill(1e9); hi.fill(-1); }   // uploaded: start over
    this._rowsUsed = true;
    // (the tiles' margins overlap: a sample is computed once per update)
    this._pass = (this._pass + 1) >>> 0 || 1;
    if (!this._done) this._done = new Uint32Array(this.nat.length);
    for (const b of rects) {
      const r = this._updateRect(b);
      for (let z = r.z0; z <= r.z1; z++) { if (r.x0 < lo[z]) lo[z] = r.x0; if (r.x1 > hi[z]) hi[z] = r.x1; }
    }
    for (const a of attrs) { a.clearUpdateRanges(); a.needsUpdate = true; }
    // runs of rows: a full-width block when wide, else a range per row
    for (let z = 0; z < this.nz; z++) {
      if (hi[z] < 0) continue;
      if (hi[z] - lo[z] > n * 0.5) {
        let z1 = z; while (z1 + 1 < this.nz && hi[z1 + 1] >= 0 && hi[z1 + 1] - lo[z1 + 1] > n * 0.5) z1++;
        for (const a of attrs) a.addUpdateRange(z * n * a.itemSize, (z1 - z + 1) * n * a.itemSize);
        z = z1;
      } else for (const a of attrs) a.addUpdateRange((z * n + lo[z]) * a.itemSize, (hi[z] - lo[z] + 1) * a.itemSize);
    }
    return true;
  }

  // recompute the mesh data of a rectangle of cells (with a margin for normals and
  // the cavity term); returns the rectangle that changed
  _updateRect(b) {
    const { nx: n, cell, nat, loose, orig, rx, rz, conc, cTime, cSm, top, topM } = this;
    const pos = this.aPos.array, nor = this.aNor.array, soil = this.aSoil.array, mats = this.aMat.array, cc = this.aConc.array, ex = this.aExtra.array, { lH, lM, lN, bit, comp } = this;
    const occ = this._occ;
    const OR = 4; // occlusion probe radius (cells)
    const ox0 = Math.max(0, b.x0 - OR - 1), ox1 = Math.min(rx, b.x1 + OR + 1);
    const oz0 = Math.max(0, b.z0 - OR - 1), oz1 = Math.min(rz, b.z1 + OR + 1);
    const H = (ix, iz) => {
      ix = ix < 0 ? 0 : ix > rx ? rx : ix;
      iz = iz < 0 ? 0 : iz > rz ? rz : iz;
      const i = iz * n + ix; return nat[i] + loose[i] + conc[i] + top[i];
    };
    const done = this._done, pass = this._pass;
    for (let iz = oz0; iz <= oz1; iz++) for (let ix = ox0; ix <= ox1; ix++) {
      const i = iz * n + ix;
      if (done && done[i] === pass) continue;
      if (done) done[i] = pass;
      const h = nat[i] + loose[i] + conc[i] + top[i];
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
      // loose soil shows as loose soil: on a slab that is soil lying on it (what is under the slab is hidden)
      soil[i * 4 + 1] = conc[i] > 1e-6 ? (topM[i] === 0 ? top[i] : 0) : loose[i];
      soil[i * 4 + 2] = occ[i];
      soil[i * 4 + 3] = this.ldep[i];
      let f1 = 0, f2 = 0, f3 = 0;
      for (let k = lN[i] - 1, rest = 0.002; k >= 0 && rest > 0; k--) {
        const h = Math.min(rest, lH[i * LAYERS + k]), m = lM[i * LAYERS + k];
        if (m === 1) f1 += h; else if (m === 2) f2 += h; else if (m === 3) f3 += h;
        rest -= h;
      }
      if (conc[i] > 1e-6) {
        // the slab covers the layers under it; what lies on it shows instead
        f1 = f2 = f3 = 0;
        const tm = topM[i], th = Math.min(top[i], 0.002);
        if (tm === 1) f1 = th; else if (tm === 2) f2 = th; else if (tm === 3) f3 = th;
      }
      mats[i * 3] = f1 * 500; mats[i * 3 + 1] = f2 * 500; mats[i * 3 + 2] = f3 * 500;
      // under a cover of sand / stone the concrete fades out (gone at ~1.3 mm of the model)
      const cover = top[i] > 0 ? Math.pow(Math.max(0, 1 - top[i] / 0.0013), 3) : 1;
      cc[i * 3] = conc[i] * cover; cc[i * 3 + 1] = cTime[i]; cc[i * 3 + 2] = cSm[i];
      ex[i * 2] = bit[i]; ex[i * 2 + 1] = conc[i] > 1e-6 ? 0 : comp[i];
      // the foot of a concrete face (e.g. after the boards are stripped): the face
      // belongs to the concrete, not to the soil below it
      if (conc[i] <= 1e-6 && ix > 0 && ix < rx && iz > 0 && iz < rz) {
        let j = -1, hj = h + 0.002;
        for (const k of [i - 1, i + 1, i - n, i + n]) { const hk = nat[k] + loose[k] + conc[k] + top[k]; if (conc[k] > 1e-5 && hk > hj) { hj = hk; j = k; } }
        if (j >= 0) { cc[i * 3] = conc[j]; cc[i * 3 + 1] = cTime[j]; cc[i * 3 + 2] = cSm[j]; ex[i * 2] = Math.max(bit[i], bit[j]); }
      }
    }
    return { x0: ox0, z0: oz0, x1: ox1, z1: oz1 };
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

  // the zones: inside(x, z) → 1 over the box [x0, z0, x1, z1] (the rest of the plot 0)
  setZone(inside, box, topAt = null) {
    this.zone.fill(0); this.zTop.fill(0);
    if (!box) return;
    const ix0 = Math.max(0, Math.floor(this.toCellX(box[0]))), ix1 = Math.min(this.rx, Math.ceil(this.toCellX(box[2])));
    const iz0 = Math.max(0, Math.floor(this.toCellZ(box[1]))), iz1 = Math.min(this.rz, Math.ceil(this.toCellZ(box[3])));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = this.toWorldX(ix), z = this.toWorldZ(iz);
      if (!inside(x, z)) continue;
      const i = iz * this.nx + ix; this.zone[i] = 1; this.zTop[i] = topAt ? topAt(x, z) : 0;
    }
  }
  // the ground levelled to y under what is laid on it (the geotextile): the loose cover gone,
  // the native ground cut or filled to it — over the samples where at(x, z) is true
  // set concrete chipped off (a crowbar, a breaker): within r of (x, z), up to `amount` deep this
  // time; only up to maxH thick and where ok(i, x, z) (what ran out of the forms, not a footing or a slab);
  // the chips are carried off, what lay on it falls onto the ground → { got (m³), thick (samples) }
  chipConc(x, z, r, amount, maxH, ok = null) {
    const cx = this.toCellX(x), cz = this.toCellZ(z), n = Math.ceil(r / this.cell);
    const ix0 = Math.max(0, Math.floor(cx - n)), ix1 = Math.min(this.rx, Math.ceil(cx + n)), iz0 = Math.max(0, Math.floor(cz - n)), iz1 = Math.min(this.rz, Math.ceil(cz + n));
    let got = 0, thick = 0, any = false;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * this.nx + ix, c = this.conc[i];
      if (c <= 1e-6) continue;
      const d = Math.hypot(ix - cx, iz - cz) * this.cell / r; if (d > 1) continue;
      if (c > maxH || (ok && !ok(i, this.toWorldX(ix), this.toWorldZ(iz)))) { thick++; continue; }
      const take = Math.min(c, amount * (1 - d * d * 0.6));
      this.conc[i] = c - take; got += take * this.cellArea; any = true;
      if (this.conc[i] < MM_CHIP) {
        got += this.conc[i] * this.cellArea; this.conc[i] = 0; this.cSm[i] = 0;
        const tp = this.top[i]; if (tp > 0) { this.top[i] = 0; this._push(i, tp, this.topM[i]); }
      }
    }
    if (any) this._touch(ix0, iz0, ix1, iz1);
    return { got, thick };
  }
  levelTo(at, y, box, chip = 0) {
    const ix0 = Math.max(0, Math.floor(this.toCellX(box[0]))), ix1 = Math.min(this.rx, Math.ceil(this.toCellX(box[2])));
    const iz0 = Math.max(0, Math.floor(this.toCellZ(box[1]))), iz1 = Math.min(this.rz, Math.ceil(this.toCellZ(box[3])));
    let any = false;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      if (!at(this.toWorldX(ix), this.toWorldZ(iz))) continue;
      const i = iz * this.nx + ix;
      // (a thin crust of concrete that ran out of the forms: broken off and carried away first)
      if (this.conc[i] > 1e-6 && this.conc[i] <= chip) { this.conc[i] = 0; this.cSm[i] = 0; }
      if (this.conc[i] > 1e-6) continue;
      this.nat[i] = y; this.loose[i] = 0; this.lN[i] = 0; this.ldep[i] = 0; this.top[i] = 0;
      for (let k = 0; k < LAYERS; k++) this.lH[i * LAYERS + k] = 0;
      any = true;
    }
    if (any) this._touch(ix0, iz0, ix1, iz1);
  }
  // the native ground set to y under what lies on it (its loose cover stays, moved with it)
  setBase(at, y, box) {
    const ix0 = Math.max(0, Math.floor(this.toCellX(box[0]))), ix1 = Math.min(this.rx, Math.ceil(this.toCellX(box[2])));
    const iz0 = Math.max(0, Math.floor(this.toCellZ(box[1]))), iz1 = Math.min(this.rz, Math.ceil(this.toCellZ(box[3])));
    let any = false;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      if (!at(this.toWorldX(ix), this.toWorldZ(iz))) continue;
      const i = iz * this.nx + ix;
      if (this.conc[i] > 1e-6 || this.nat[i] === y) continue;
      this.nat[i] = y; any = true;
    }
    if (any) this._touch(ix0, iz0, ix1, iz1);
  }
  // how thick each material lies loose at a sample (m): [soil, sand, 5–20, 20–40]
  looseOf(i, out = [0, 0, 0, 0]) {
    out.fill(0);
    for (let k = 0; k < this.lN[i]; k++) out[this.lM[i * LAYERS + k]] += this.lH[i * LAYERS + k];
    return out;
  }

  // after loading: no pour time ahead of the clock, no broken values
  sanitizeConcrete(clock) {
    const { conc, cTime, cSm, cY, cBase } = this;
    for (let i = 0; i < conc.length; i++) {
      if (!Number.isFinite(conc[i]) || conc[i] < 0) conc[i] = 0;
      if (!Number.isFinite(cTime[i]) || cTime[i] > clock) cTime[i] = clock;
      if (!Number.isFinite(cSm[i])) cSm[i] = 0;
      cY[i] = 0; cBase[i] = 0;
    }
  }

  curedAt(i) { return Math.max(0, ((this.clock || 0) - this.cTime[i]) / CONCRETE.cure); }

  _concAdd(i, add, smooth = 0, stiff = 0) {
    const c = this.conc[i], t = c + add, now = this.clock || 0;
    if (c <= 0) this.cBase[i] = 0;
    else if (this.cTime[i] < now - CONCRETE.stiff * CONCRETE.cure) {
      // fresh concrete on set concrete: a new layer on a firm base
      this.cBase[i] = c; this.cY[i] = stiff; this.cTime[i] = now; this.cSm[i] = smooth; this.conc[i] = t;
      return;
    }
    this.cY[i] = c > 0 ? (this.cY[i] * c + stiff * add) / t : stiff;
    this.cTime[i] = c > 0 ? (this.cTime[i] * c + (this.clock || 0) * add) / t : (this.clock || 0);
    this.cSm[i] = c > 0 ? (this.cSm[i] * c + smooth * add) / t : smooth;
    this.conc[i] = t;
  }

  // wake the concrete in a rectangle of cells (and redraw it)
  _concTouch(ix0, iz0, ix1, iz1) {
    const TS = this.TS;
    const tx0 = Math.max(0, Math.floor((ix0 - 1) / TS)), tx1 = Math.min(this.tnx - 1, Math.floor((ix1 + 1) / TS));
    const tz0 = Math.max(0, Math.floor((iz0 - 1) / TS)), tz1 = Math.min(this.tnz - 1, Math.floor((iz1 + 1) / TS));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) { const t = tz * this.tnx + tx; this._tileOn(t); this.meshTiles.add(t); }
    this.version++;
  }

  // pour a volume of fresh concrete as a soft splat (never into a board)
  depositConc(x, z, vol, radius, stiff = 0) {
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
      this._concAdd(i, k * Math.exp(-(dx * dx + dz * dz) * inv), 0, stiff);
    }
    this._concTouch(ix0, iz0, ix1, iz1);
    this.version++;
  }

  // The flow of fresh concrete: a Bingham fluid in the thin-layer (lubrication)
  // approximation. Between two cells the flux is that of a layer of thickness h under
  // the surface slope: no flow while the yield stress holds it (h ≤ h0 = tau / (rho g
  // slope)), above it q = rho g h³/(3 mu) (1 − 3/2 r + 1/2 r³) · slope, r = h0 / h.
  // It is applied pairwise and implicitly (stable for any step, exactly conserving).
  // Units: real ones (MODEL_SCALE). Only the tiles where something moves are
  // computed; a tile wakes its neighbours when concrete crosses into them.
  concStep(dt, substeps = 2) {
    if (!this._tList.length) return false;
    const { nx: n, cell, nat, loose, conc, wall, cTime, cSm, cY, vib, cBase, top, rx, rz, TS, tnx } = this;
    const S = MODEL_SCALE, G = 9.81, C = CONCRETE, clock = this.clock || 0;
    const setT = C.stiff * C.cure, stiffT = clock - setT;
    const h = dt / substeps;
    for (let sub = 0; sub < substeps; sub++) {
      const list = this._tList.slice();
      for (const t of list) this._tAct[t] = 0;
      this._tList.length = 0;
      this._coarseFlow(list, h, clock, setT);
      const fwd = (this._csweep = !this._csweep), NB = fwd ? NB_FWD : NB_BWD;
      for (const t of list) {
        const tx = t % tnx, tz = (t / tnx) | 0;
        const x0 = tx * TS, z0 = tz * TS, x1 = Math.min(rx, x0 + TS - 1), z1 = Math.min(rz, z0 + TS - 1);
        let moved = false;
        for (let zz = z0; zz <= z1; zz++) {
          const iz = fwd ? zz : z1 - (zz - z0);
          for (let xx = x0; xx <= x1; xx++) {
            const ix = fwd ? xx : x1 - (xx - x0);
            const i = iz * n + ix;
            if (wall[i]) continue;
            for (let k = 0; k < 4; k++) {
              const jx = ix + NB[k][0], jz = iz + NB[k][1];
              if (jx < 0 || jx > rx || jz < 0 || jz > rz) continue;
              const j = jz * n + jx;
              if (wall[j]) {
                // over the top of a board (more than ~1 cm real above it): it slops over
                // and falls down the outside in lumps
                const si = nat[i] + loose[i] + conc[i] + top[i];
                if (conc[i] > 0 && si > wall[j] + 0.003 && cTime[i] >= stiffT) {
                  let kx = jx, kz = jz;
                  for (let q = 0; q < 8 && kx >= 0 && kx <= rx && kz >= 0 && kz <= rz && wall[kz * n + kx]; q++) { kx += NB[k][0]; kz += NB[k][1]; }
                  if (kx < 0 || kx > rx || kz < 0 || kz > rz) continue;
                  const m = Math.min((si - wall[j] - 0.002) * 0.3, conc[i] - this.cBase[i]);
                  if (m > 1e-9) { conc[i] -= m; this._overflow(kx, kz, m * this.cellArea, NB[k][0], NB[k][1]); moved = true; }
                }
                continue;
              }
              const ci = conc[i], cj = conc[j];
              if (ci <= 0 && cj <= 0) continue;
              const d = nat[i] + loose[i] + ci + top[i] - nat[j] - loose[j] - cj - top[j];
              const src = d > 0 ? i : j, dst = d > 0 ? j : i;
              const hs = conc[src] - cBase[src];                  // the fresh part flows, not its set base
              if (hs <= 1e-6 || cTime[src] < stiffT) continue;   // nothing to flow, or already set
              const ad = d < 0 ? -d : d, dx = (NB[k][2] ? 1.41421356 : 1) * cell;
              const slope = ad / dx;
              const vibr = vib[src] > clock || vib[dst] > clock;
              // older concrete is stiffer (it starts to set); a fallen lump is stiffer too
              const age = Math.max(0, clock - cTime[src]);   // (never negative: a clock behind would turn the law round)
              const tau = (vibr ? C.tauVib : C.tau) * (1 + 3 * age / setT) * (1 + cY[src]);
              const mu = vibr ? C.muVib : C.mu;
              const hr = hs * S, h0 = tau / (C.rho * G * slope);
              if (hr <= h0) continue;                              // the yield stress holds it
              const r = Math.max(0, h0 / hr), F = hr * hr * hr / 3 * (1 - 1.5 * r + 0.5 * r * r * r);
              const D = C.rho * G * F / mu;                        // m²/s
              const kk = h * D / (dx * S * dx * S);
              let m = ad * kk / (1 + 2 * kk) * (NB[k][2] ? 0.5 : 1);
              if (m > hs) m = hs;
              if (m < 2e-7) continue;   // (under ~2 µm of the real concrete: it has come to rest — the tile may sleep)
              const ts = cTime[src], ss = cSm[src], ys = cY[src];
              conc[src] -= m;
              const c = conc[dst], tt = c + m;
              if (c > 0 && cTime[dst] < stiffT) {
                // onto set concrete: a fresh layer on it
                cBase[dst] = c; cTime[dst] = ts; cSm[dst] = ss * 0.8; cY[dst] = ys;
              } else {
                if (c <= 0) cBase[dst] = 0;
                cTime[dst] = c > 0 ? (cTime[dst] * c + ts * m) / tt : ts;
                cSm[dst] = c > 0 ? (cSm[dst] * c + ss * 0.8 * m) / tt : ss * 0.8;
                cY[dst] = c > 0 ? (cY[dst] * c + ys * m) / tt : ys;
              }
              conc[dst] = tt;
              moved = true;
              const tj = ((jz / TS) | 0) * tnx + ((jx / TS) | 0);
              if (tj !== t) { this._tileOn(tj); this.meshTiles.add(tj); }
            }
          }
        }
        if (moved) { this._tileOn(t); this.meshTiles.add(t); }
      }
      if (!this._tList.length) break;
    }
    this.version++;
    return this._tList.length > 0;
  }

  // The fine grid moves concrete only a cell or two per step, so a heap would spread
  // for minutes. A coarse pass first: blocks of 4 × 4 cells exchange concrete by the
  // same Bingham law on their mean surface (blocks with a board or set concrete in them
  // are left to the fine pass: nothing leaks through formwork, nothing piles on set concrete).
  _coarseFlow(list, h, clock, setT) {
    const B = 4, { nx: n, cell, nat, loose, conc, wall, cTime, cSm, cY, vib, rx, rz, TS, tnx } = this;
    const S = MODEL_SCALE, G = 9.81, C = CONCRETE, per = TS / B;
    const bw = Math.ceil(this.nx / B), info = (this._cInfo ||= new Map());
    info.clear();
    const blk = (bx, bz) => {
      const key = bz * bw + bx;
      let o = info.get(key);
      if (o !== undefined) return o;
      const x0 = bx * B, z0 = bz * B;
      o = null;
      if (x0 + B - 1 <= rx && z0 + B - 1 <= rz) {
        let sh = 0, sc = 0, sy = 0, st = 0, v = false, ok = true;
        for (let z = z0; z < z0 + B && ok; z++) for (let x = x0; x < x0 + B; x++) {
          const i = z * n + x;
          const c = conc[i];
          // a board, or concrete that has set: the fine pass only (it would pile up in it)
          if (wall[i] || (c > 1e-7 && (cTime[i] < clock - setT || this.cBase[i] > 0))) { ok = false; break; }
          sh += nat[i] + loose[i] + c + this.top[i]; sc += c; sy += cY[i] * c; st += cTime[i] * c;
          if (vib[i] > clock) v = true;
        }
        if (ok) o = { x0, z0, s: sh / (B * B), c: sc, y: sc > 0 ? sy / sc : 0, t: sc > 0 ? st / sc : clock, v };
      }
      info.set(key, o);
      return o;
    };
    const dx = B * cell * S, area = B * B, on = new Set(list);
    for (const t of list) {
      const tx = t % tnx, tz = (t / tnx) | 0;
      for (let bz = tz * per; bz < tz * per + per; bz++) for (let bx = tx * per; bx < tx * per + per; bx++) {
        for (let k = 0; k < 4; k++) {
          const ox = k === 0 ? 1 : k === 1 ? -1 : 0, oz = k === 2 ? 1 : k === 3 ? -1 : 0;
          // each pair once: right and down always, left and up only across the tile edge into a sleeping tile
          if (k === 1 && (bx % per !== 0 || tx === 0 || on.has(t - 1))) continue;
          if (k === 3 && (bz % per !== 0 || tz === 0 || on.has(t - tnx))) continue;
          const a = blk(bx, bz), b = blk(bx + ox, bz + oz);
          if (!a || !b || (a.c <= 0 && b.c <= 0)) continue;
          const d = a.s - b.s, src = d > 0 ? a : b, dst = d > 0 ? b : a;
          if (src.c <= 1e-6 * area || src.t < clock - setT) continue;
          const ad = Math.abs(d), slope = ad / dx, hs = src.c / area * S;
          const vibr = src.v || dst.v, age = Math.max(0, clock - src.t);
          const tau = (vibr ? C.tauVib : C.tau) * (1 + 3 * age / setT) * (1 + src.y);
          const h0 = tau / (C.rho * G * slope);
          if (hs <= h0) continue;
          const r = Math.max(0, h0 / hs), F = hs * hs * hs / 3 * (1 - 1.5 * r + 0.5 * r * r * r);
          const kk = h * C.rho * G * F / (vibr ? C.muVib : C.mu) / (dx * dx);
          let m = ad * kk / (1 + 2 * kk) * area;               // volume (cell heights summed)
          if (m > src.c * 0.5) m = src.c * 0.5;
          if (m < 1e-7) continue;
          // out of the source in proportion to the thickness, into the destination evenly
          const f = m / src.c, add = m / area;
          for (let z = src.z0; z < src.z0 + B; z++) for (let x = src.x0; x < src.x0 + B; x++) conc[z * n + x] *= 1 - f;
          const ts = src.t, ys = src.y;
          for (let z = dst.z0; z < dst.z0 + B; z++) for (let x = dst.x0; x < dst.x0 + B; x++) {
            const i = z * n + x, c = conc[i], tt = c + add;
            cTime[i] = c > 0 ? (cTime[i] * c + ts * add) / tt : ts;
            cSm[i] = c > 0 ? (cSm[i] * c) / tt : 0;
            cY[i] = c > 0 ? (cY[i] * c + ys * add) / tt : ys;
            conc[i] = tt;
          }
          src.c -= m; dst.c += m; src.s -= m / area; dst.s += m / area;
          for (const q of [src, dst]) { const tq = ((q.z0 / TS) | 0) * tnx + ((q.x0 / TS) | 0); this._tileOn(tq); this.meshTiles.add(tq); }
        }
      }
    }
  }

  cellBox(x, z, r) {
    return { x0: Math.max(0, Math.floor(this.toCellX(x - r))), z0: Math.max(0, Math.floor(this.toCellZ(z - r))),
      x1: Math.min(this.rx, Math.ceil(this.toCellX(x + r))), z1: Math.min(this.rz, Math.ceil(this.toCellZ(z + r))) };
  }

  // The screed rule pulled over the concrete: everything above the level L (where it
  // rides on the formwork) rolls ahead of it as a bead; at a board the bead spills
  // over and falls outside in lumps (collected per piece of the rule and dropped as a
  // blob once there is enough for one). Swept concrete gets a flat, half-finished surface.
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
      this.cSm[i] = Math.max(this.cSm[i], 0.55);
      const ex = Math.min(this.hAt(i) - s.L, conc[i] - this.cBase[i]) * 0.9;
      if (ex <= 1e-8) continue;
      // ahead of the rule: a soft bead, a few cells wide
      let tx = x + dx * (band + cell * 2), tz = z + dz * (band + cell * 2);
      if (!this.inside(tx, tz)) continue;
      if (!wall[this.index(tx, tz)]) {
        conc[i] -= ex;
        const j0 = this.index(tx, tz), jl = this.index(tx + ax * cell, tz + az * cell), jr = this.index(tx - ax * cell, tz - az * cell);
        const j2 = this.index(tx + dx * cell, tz + dz * cell);
        const parts = [[j0, 0.4], [j2, 0.2], [jl, 0.2], [jr, 0.2]].filter(([j]) => !wall[j]);
        const wsum = parts.reduce((a, p) => a + p[1], 0);
        for (const [j, w] of parts) this._concAdd(j, ex * w / wsum, this.cSm[i] * 0.5);
        moved += ex;
        continue;
      }
      // at a board: over it and down the outside, in lumps
      for (let k = 0; k < 8 && this.inside(tx, tz) && wall[this.index(tx, tz)]; k++) { tx += dx * cell; tz += dz * cell; }
      if (!this.inside(tx, tz) || wall[this.index(tx, tz)]) continue;
      conc[i] -= ex;
      moved += ex;
      const key = Math.round(v / 0.02);   // a lump per ~7 cm (real) of the rule
      const bin = (s.spill ||= new Map()).get(key) || { vol: 0, x: 0, z: 0 };
      bin.vol += ex * this.cellArea; bin.x += tx * ex; bin.z += tz * ex; bin.w = (bin.w || 0) + ex;
      s.spill.set(key, bin);
      if (bin.vol > 1.2e-5) this._dropLump(s, key, dx, dz);   // ~0.5 l (real) per lump
    }
    this._concTouch(b.x0 - 4, b.z0 - 4, b.x1 + 4, b.z1 + 4);
    this.version++;
    return moved * this.cellArea;
  }

  // concrete going over a board, collected in bins along it (key: a 2 cm square)
  _overflow(kx, kz, vol, ox, oz) {
    const key = `${Math.floor(kx / 18)},${Math.floor(kz / 18)}`;   // ~19 cm (real) of board
    const bins = (this._ovf ||= new Map());
    const b = bins.get(key) || { vol: 0, x: 0, z: 0, w: 0, need: 0.8e-5 + Math.random() * 2.2e-5, ox, oz };   // 0.3 … 1.3 l (real)
    const x = this.toWorldX(kx), z = this.toWorldZ(kz);
    b.vol += vol; b.x += x * vol; b.z += z * vol; b.w += vol;
    bins.set(key, b);
    if (b.vol >= b.need) this._dropOverflow(key);
  }

  _dropOverflow(key) {
    const b = this._ovf.get(key);
    if (!b || b.vol <= 0) return;
    const out = 0.003 + Math.random() * 0.008;
    this.depositConc(this.clampX(b.x / b.w + b.ox * out + (Math.random() - 0.5) * 0.012), this.clampZ(b.z / b.w + b.oz * out + (Math.random() - 0.5) * 0.012), b.vol, 0.008 + Math.random() * 0.006, 3);   // a fallen lump: 4× stiffer
    this._ovf.delete(key);
  }

  // end of a concrete action: what is still on its way over the boards falls now
  flushOverflow() {
    if (!this._ovf) return;
    for (const key of [...this._ovf.keys()]) this._dropOverflow(key);
  }

  // a lump of concrete falls off the rule outside the board: a blob that slumps
  _dropLump(s, key, dx, dz) {
    const b = s.spill.get(key);
    if (!b || b.vol <= 0) return;
    const x = b.x / b.w + dx * (0.002 + Math.random() * 0.006) + (Math.random() - 0.5) * 0.006;
    const z = b.z / b.w + dz * (0.002 + Math.random() * 0.006) + (Math.random() - 0.5) * 0.006;
    this.depositConc(this.clampX(x), this.clampZ(z), b.vol, 0.009 + Math.random() * 0.004, 3);
    s.spill.delete(key);
  }

  // end of a screed stroke: what is still on the rule's edge drops too
  flushSpill(s, dx, dz) {
    if (!s.spill) return;
    for (const key of [...s.spill.keys()]) this._dropLump(s, key, dx, dz);
  }

  // immersion vibrator: the concrete around it flows almost flat for a moment, and
  // the cement paste comes up — the surface closes and gets wetter
  vibrate(x, z, r) {
    const b = this.cellBox(x, z, r), { nx: n, conc, cSm } = this;
    for (let iz = b.z0; iz <= b.z1; iz++) for (let ix = b.x0; ix <= b.x1; ix++) {
      const i = iz * n + ix;
      if (conc[i] <= 0) continue;
      const d = Math.hypot(this.toWorldX(ix) - x, this.toWorldZ(iz) - z) / r;
      if (d < 1) cSm[i] = Math.max(cSm[i], Math.min(0.5, cSm[i] + 0.05 * (1 - d)));
    }
    // fluidised for a moment: the flow (concStep) does the rest
    const until = (this.clock || 0) + 0.7;
    for (let iz = b.z0; iz <= b.z1; iz++) for (let ix = b.x0; ix <= b.x1; ix++) {
      const i = iz * n + ix;
      if (conc[i] > 0 && Math.hypot(this.toWorldX(ix) - x, this.toWorldZ(iz) - z) < r) this.vib[i] = until;
    }
    this._concTouch(b.x0, b.z0, b.x1, b.z1);
  }

  // Bitumen mastic brushed on. Returns how much was coated.
  paintBitumen(x, z, r, amount = 0.25) {
    // on concrete anywhere — the faces of a footing and the top of it (horizontal
    // waterproofing under the walls) — and on the foot just below a face
    const b = this.cellBox(x, z, r), { nx: n, conc, bit, rx, rz } = this;
    let any = 0;
    for (let iz = Math.max(1, b.z0); iz <= Math.min(rz - 1, b.z1); iz++) for (let ix = Math.max(1, b.x0); ix <= Math.min(rx - 1, b.x1); ix++) {
      const i = iz * n + ix;
      if (Math.hypot(this.toWorldX(ix) - x, this.toWorldZ(iz) - z) > r) continue;
      let on = conc[i] > 1e-5 && this.top[i] <= 0;
      if (!on) { const h = this.hAt(i); for (const j of [i - 1, i + 1, i - n, i + n]) if (conc[j] > 1e-5 && this.hAt(j) - h > 0.002) on = true; }
      if (!on || bit[i] >= 1) continue;
      const nb = Math.min(1, bit[i] + amount);
      any += nb - bit[i];
      bit[i] = nb;
    }
    if (any) this._markMesh(b.x0 - 1, b.z0 - 1, b.x1 + 1, b.z1 + 1);
    return any;
  }

  // One stamp of a plate compactor (plate w × len, centred at x,z, moving along dx,dz).
  // The loose material under it, to the depth the plate reaches (~0.3 m real), gets
  // denser: each pass brings it closer to fully compacted, and the layer shrinks by
  // what that material loses (soil ~17 %, sand ~12 %, crushed stone ~10 %).
  // Returns the settlement it caused (model m, the deepest cell).
  compactStep(x, z, dx, dz, w, len, gain = 0.06) {
    const { nx: n, conc, loose, comp, lH, lM, lN } = this;
    const ax = -dz, az = dx, b = this.cellBox(x, z, Math.hypot(w, len) / 2);
    const reach = 0.3 / MODEL_SCALE, SHRINK = [0.17, 0.12, 0.1, 0.1];
    let most = 0;
    for (let iz = b.z0; iz <= b.z1; iz++) for (let ix = b.x0; ix <= b.x1; ix++) {
      const i = iz * n + ix;
      if (conc[i] > 1e-6 || comp[i] >= 1) continue;
      const rx = this.toWorldX(ix) - x, rz = this.toWorldZ(iz) - z;
      if (Math.abs(rx * dx + rz * dz) > len / 2 || Math.abs(rx * ax + rz * az) > w / 2) continue;
      const nc = Math.min(1, comp[i] + gain), dc = nc - comp[i];
      comp[i] = nc;
      // (undisturbed ground: already dense — its top only pressed smooth and settling a little, ~3 % of 10 cm)
      if (loose[i] <= 1e-6) { const d = 0.1 / MODEL_SCALE * 0.03 * dc; this.nat[i] -= d; if (d > most) most = d; continue; }
      // shrink the layers from the top down to the plate's reach
      let rest = reach, lost = 0;
      for (let k = lN[i] - 1, base = i * LAYERS; k >= 0 && rest > 0; k--) {
        const h = lH[base + k], part = Math.min(h, rest);
        const d = part * SHRINK[lM[base + k]] * dc;
        lH[base + k] = h - d; lost += d; rest -= part;
      }
      this._sumLoose(i);
      if (lost > most) most = lost;
    }
    if (most > 0) this._touch(b.x0, b.z0, b.x1, b.z1);
    return most;
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
      // the float presses the surface: it settles flat under it
      const until = (this.clock || 0) + 0.15;
      for (let iz = b.z0; iz <= b.z1; iz++) for (let ix = b.x0; ix <= b.x1; ix++) { const i = iz * n + ix; if (conc[i] > 0) this.vib[i] = Math.max(this.vib[i], until); }
      this._concTouch(b.x0, b.z0, b.x1, b.z1);
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
      conc: new Float32Array(this.nat.length), cTime: new Float32Array(this.nat.length), cSm: new Float32Array(this.nat.length),
      top: new Float32Array(this.nat.length), topM: new Uint8Array(this.nat.length), bit: new Float32Array(this.nat.length), comp: new Float32Array(this.nat.length) });
    s.nat.set(this.nat); s.loose.set(this.loose); s.ldep.set(this.ldep); s.lH.set(this.lH); s.lM.set(this.lM); s.lN.set(this.lN);
    s.conc.set(this.conc); s.cTime.set(this.cTime); s.cSm.set(this.cSm); s.top.set(this.top); s.topM.set(this.topM); s.bit.set(this.bit); s.comp.set(this.comp);
    return s;
  }

  restore(s) {
    this.nat.set(s.nat); this.loose.set(s.loose);
    if (s.ldep) this.ldep.set(s.ldep);
    if (s.lH) { this.lH.set(s.lH); this.lM.set(s.lM); this.lN.set(s.lN); } else this.layersFromLoose();
    if (s.conc) { this.conc.set(s.conc); this.cTime.set(s.cTime); this.cSm.set(s.cSm); } else this.conc.fill(0);
    if (s.top) { this.top.set(s.top); this.topM.set(s.topM); } else this.top.fill(0);
    if (s.bit) { this.bit.set(s.bit); this.comp.set(s.comp); } else { this.bit.fill(0); this.comp.fill(0); }
    this.cActive = null;
    this.active = null;
    this.markAll(); this.active = null;
  }

  // Sparse diff between a snapshot and the current state (heights, layers, soil colour).
  diffFrom(s) {
    const idx = [], L = LAYERS;
    const { nat, loose, lN, lH, lM, conc, cTime, cSm, top, topM, bit, comp } = this;
    for (let i = 0; i < nat.length; i++) {
      if (s.nat[i] !== nat[i] || s.loose[i] !== loose[i] || s.lN[i] !== lN[i] || s.conc[i] !== conc[i] || s.cSm[i] !== cSm[i] || s.cTime[i] !== cTime[i] || s.top[i] !== top[i] || s.topM[i] !== topM[i] || s.bit[i] !== bit[i] || s.comp[i] !== comp[i]) { idx.push(i); continue; }
      const b = i * L;
      for (let k = 0; k < lN[i]; k++) if (s.lH[b + k] !== lH[b + k] || s.lM[b + k] !== lM[b + k]) { idx.push(i); break; }
    }
    const m = idx.length;
    const d = {
      idx: new Uint32Array(idx), bn: new Float32Array(m), bl: new Float32Array(m), an: new Float32Array(m), al: new Float32Array(m),
      bd: new Float32Array(m), ad: new Float32Array(m), bN: new Uint8Array(m), aN: new Uint8Array(m),
      bH: new Float32Array(m * L), aH: new Float32Array(m * L), bM: new Uint8Array(m * L), aM: new Uint8Array(m * L),
      bC: new Float32Array(m), aC: new Float32Array(m), bT: new Float32Array(m), aT: new Float32Array(m), bS: new Float32Array(m), aS: new Float32Array(m),
      bP: new Float32Array(m), aP: new Float32Array(m), bPM: new Uint8Array(m), aPM: new Uint8Array(m),
      bB: new Float32Array(m), aB: new Float32Array(m), bK: new Float32Array(m), aK: new Float32Array(m),
    };
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      d.bn[k] = s.nat[i]; d.bl[k] = s.loose[i]; d.an[k] = nat[i]; d.al[k] = loose[i];
      d.bd[k] = s.ldep[i]; d.ad[k] = this.ldep[i]; d.bN[k] = s.lN[i]; d.aN[k] = lN[i];
      d.bC[k] = s.conc[i]; d.aC[k] = conc[i]; d.bT[k] = s.cTime[i]; d.aT[k] = cTime[i]; d.bS[k] = s.cSm[i]; d.aS[k] = cSm[i];
      d.bP[k] = s.top[i]; d.aP[k] = top[i]; d.bPM[k] = s.topM[i]; d.aPM[k] = topM[i];
      d.bB[k] = s.bit[i]; d.aB[k] = bit[i]; d.bK[k] = s.comp[i]; d.aK[k] = comp[i];
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
    const P = forward ? d.aP : d.bP, PM = forward ? d.aPM : d.bPM, Bi = forward ? d.aB : d.bB, Ko = forward ? d.aK : d.bK;
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
      if (P) { this.top[i] = P[k]; this.topM[i] = PM[k]; } else this.top[i] = 0;   // BUILD 28+: material on concrete
      if (Bi) { this.bit[i] = Bi[k]; this.comp[i] = Ko[k]; }   // BUILD 30+: bitumen, compaction
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
    for (let i = 0; i < lN.length; i++) if (this.top[i] > 0) v[this.topM[i]] += this.top[i];
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
