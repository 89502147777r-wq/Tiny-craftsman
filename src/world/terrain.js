import * as THREE from 'three';
import { TRAY, SOIL_TILE, TERRAIN_CELL, REPOSE_LOOSE, REPOSE_NATIVE } from '../config.js';
import { makeNoise2 } from '../core/rand.js';

// Two-layer soil heightfield inside the tray:
//   nat   – top of undisturbed (cohesive) ground, absolute Y
//   loose – thickness of loose, dug-over soil lying on top of it
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
        this.orig[i] = h; this.nat[i] = h; this.loose[i] = 0;
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
  hAt(i) { return this.nat[i] + this.loose[i]; }

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

  // Remove soil from one cell, loose layer first. Returns removed thickness.
  _take(i, amount) {
    let got = 0;
    const l = this.loose[i];
    if (l > 0) { const t = Math.min(l, amount); this.loose[i] = l - t; got += t; amount -= t; }
    if (amount > 0) {
      const room = this.nat[i] - this.floorY;
      if (room > 0) { const t = Math.min(room, amount); this.nat[i] -= t; got += t; }
    }
    return got;
  }

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

  // Drop a volume of loose soil as a soft gaussian splat.
  deposit(x, z, vol, radius) {
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
      this.loose[iz * n + ix] += vol / this.cellArea;
      this._touch(ix, iz, ix, iz);
      return;
    }
    const k = vol / (wsum * this.cellArea);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const dx = this.toWorldX(ix) - x, dz = this.toWorldZ(iz) - z;
      this.loose[iz * n + ix] += k * Math.exp(-(dx * dx + dz * dz) * inv);
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
    const { nx: n, cell, nat, loose, rx, rz } = this;
    const tL = REPOSE_LOOSE, tN = REPOSE_NATIVE;
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
          const d = nat[i] + loose[i] - nat[j] - loose[j];
          const dist = NB[k][2] ? D2 : D1;
          const lim = tL * dist;
          const ad = d < 0 ? -d : d;
          if (ad <= lim) continue;
          const src = d > 0 ? i : j, dst = d > 0 ? j : i;
          let moved = 0;
          // loose soil slides until the pair is at the angle of repose
          const mL = Math.min((ad - lim) * 0.5, loose[src]);
          if (mL > 0) { loose[src] -= mL; loose[dst] += mL; moved += mL; }
          // an over-steep wall of native ground crumbles into loose soil
          const limN = tN * dist, adN = ad - 2 * mL;
          if (adN > limN) {
            const mN = Math.min((adN - limN) * 0.5, nat[src] - this.floorY);
            if (mN > 0) { nat[src] -= mN; loose[dst] += mN; moved += mN; }
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
    for (let i = 0; i < this.nat.length; i++) v += this.nat[i] - this.floorY + this.loose[i];
    return v * this.cellArea;
  }

  // ---- mesh ------------------------------------------------------------------
  buildMesh(material) {
    const { nx: n, nz } = this;
    const N = n * nz;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uv = new Float32Array(N * 2), soil = new Float32Array(N * 3);
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
    this.aSoil = new THREE.BufferAttribute(soil, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('normal', this.aNor);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSoil', this.aSoil);
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
    const { nx: n, cell, nat, loose, orig, rx, rz } = this;
    const pos = this.aPos.array, nor = this.aNor.array, soil = this.aSoil.array;
    const occ = this._occ;
    const OR = 4; // occlusion probe radius (cells)
    const ox0 = Math.max(0, b.x0 - OR - 1), ox1 = Math.min(rx, b.x1 + OR + 1);
    const oz0 = Math.max(0, b.z0 - OR - 1), oz1 = Math.min(rz, b.z1 + OR + 1);
    const H = (ix, iz) => {
      ix = ix < 0 ? 0 : ix > rx ? rx : ix;
      iz = iz < 0 ? 0 : iz > rz ? rz : iz;
      const i = iz * n + ix; return nat[i] + loose[i];
    };
    for (let iz = oz0; iz <= oz1; iz++) for (let ix = ox0; ix <= ox1; ix++) {
      const i = iz * n + ix;
      const h = nat[i] + loose[i];
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
      soil[i * 3] = Math.max(0, orig[i] - nat[i]);
      soil[i * 3 + 1] = loose[i];
      soil[i * 3 + 2] = occ[i];
    }
    const start = oz0 * n, count = (oz1 - oz0 + 1) * n;
    // ranges pile up until three uploads them (several updates between two frames
    // must all reach the GPU): keep one range covering all of them
    for (const a of [this.aPos, this.aNor, this.aSoil]) {
      let s0 = start * a.itemSize, s1 = (start + count) * a.itemSize;
      for (const r of a.updateRanges) { s0 = Math.min(s0, r.start); s1 = Math.max(s1, r.start + r.count); }
      a.clearUpdateRanges();
      a.addUpdateRange(s0, s1 - s0);
      a.needsUpdate = true;
    }
    return true;
  }

  // ---- snapshots (undo, save, Blender export) -------------------------------
  snapshot() { return { nat: this.nat.slice(), loose: this.loose.slice() }; }

  restore(s) {
    this.nat.set(s.nat); this.loose.set(s.loose);
    this.active = null;
    this.markAll(); this.active = null;
  }

  // Sparse diff between a snapshot and the current state.
  diffFrom(s) {
    const idx = [];
    for (let i = 0; i < this.nat.length; i++) {
      if (s.nat[i] !== this.nat[i] || s.loose[i] !== this.loose[i]) idx.push(i);
    }
    const m = idx.length;
    const d = { idx: new Uint32Array(idx), bn: new Float32Array(m), bl: new Float32Array(m), an: new Float32Array(m), al: new Float32Array(m) };
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      d.bn[k] = s.nat[i]; d.bl[k] = s.loose[i]; d.an[k] = this.nat[i]; d.al[k] = this.loose[i];
    }
    return d;
  }

  applyDiff(d, forward) {
    const N = forward ? d.an : d.bn, L = forward ? d.al : d.bl;
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (let k = 0; k < d.idx.length; k++) {
      const i = d.idx[k];
      this.nat[i] = N[k]; this.loose[i] = L[k];
      const ix = i % this.nx, iz = (i / this.nx) | 0;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
    if (x1 >= 0) { this._markMesh(x0 - 1, z0 - 1, x1 + 1, z1 + 1); }
    this.active = null; // journal states are already at rest
  }
}

const NB_FWD = [[1, 0, 0], [0, 1, 0], [1, 1, 1], [-1, 1, 1]];
const NB_BWD = [[-1, 0, 0], [0, -1, 0], [-1, -1, 1], [1, -1, 1]];

function grow(b, x0, z0, x1, z1, rx, rz) {
  x0 = Math.max(0, x0); z0 = Math.max(0, z0); x1 = Math.min(rx, x1); z1 = Math.min(rz, z1);
  if (!b) return { x0, z0, x1, z1 };
  return { x0: Math.min(b.x0, x0), z0: Math.min(b.z0, z0), x1: Math.max(b.x1, x1), z1: Math.max(b.z1, z1) };
}
