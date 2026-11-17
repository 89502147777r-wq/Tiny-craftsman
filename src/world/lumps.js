import * as THREE from 'three';
import { MODEL_SCALE, CONCRETE } from '../config.js';
import { mortarPhoto } from './terrainMaterial.js';

// A lump of set concrete (the owner, 2026-11-16: «a drop of concrete on the ground is a dab — not a pillar down to the bottom when
// the ground round it is dug; a bucket picks it up whole and carries it, into the truck too»; the realist, 2026-11-17).
// Concrete spilt off the formwork onto the open ground (marked when poured — terrain._spillAt), once firm, ≥ 25 mm and ≤ 0,25 m
// thick, leaves the ground's concrete and becomes ONE thing per spill — a record { type: 'lump', x, z, y, yaw, cells: [[dx, dz, h,
// b] mm…] (b: its underside over its lowest point — the imprint of the ground it set on), at: 'ground' | 'truck', tx, ty, tz }.
// It lies in its imprint and along the slope (≤ 35°); dug under, it goes down; over a pit's edge it tips and slides in; what is
// heaped by it covers it, never lifts it; shoved, it rides on the surface; a bucket's teeth that hit a big one break it into uneven
// pieces 0,2–0,7 m (`breakLump`) — what fits, the bucket takes; tipped out, it falls; the truck's body tipping lets them slide out
// with the load one after another and fly 0,5–1,5 m off the tailgate; to the tip — gone with the load.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S, G = 9.81 / MODEL_SCALE;
export const LUMP = { thick: 0.25, minT: 0.025, minA: 0.01, whole: 0.3, slope: 35 };
const TAN = Math.tan(LUMP.slope * Math.PI / 180), UP = new THREE.Vector3(0, 1, 0);

// the ground's firm spills → lumps, one per spill (called now and then: main.js)
export function scanLumps(app) {
  const t = app.terrain, { nx, conc } = t, N = conc.length, firm = CONCRETE.stiff * 1.05, thin = MM(LUMP.thick * 1000), minT = MM(LUMP.minT * 1000);
  const spill = (i) => conc[i] >= minT && t.cSpill[i] === 1 && conc[i] <= thin && t.curedAt(i) >= firm && t.zone?.[i] !== 1;
  const seen = new Uint8Array(N), made = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || conc[s] < minT || !spill(s)) continue;
    const list = [s], st = [s]; seen[s] = 1;
    while (st.length) {
      const i = st.pop(), ix = i % nx, iz = (i / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = ix + dx, jz = iz + dz; if ((!dx && !dz) || jx < 0 || jz < 0 || jx > t.rx || jz > t.rz) continue;
        const j = jz * nx + jx; if (seen[j] || !spill(j)) continue; seen[j] = 1; st.push(j); list.push(j);
      }
    }
    if (list.length * t.cellArea * MODEL_SCALE * MODEL_SCALE < LUMP.minA) continue;   // (a speck: a stain, crumbled with the soil)
    let cx = 0, cz = 0, bot = Infinity;
    for (const i of list) { cx += t.toWorldX(i % nx); cz += t.toWorldZ((i / nx) | 0); bot = Math.min(bot, t.nat[i] + t.loose[i]); }
    cx /= list.length; cz /= list.length;
    const cells = list.map((i) => [Math.round((t.toWorldX(i % nx) - cx) / S), Math.round((t.toWorldZ((i / nx) | 0) - cz) / S), Math.round(conc[i] / S), Math.round((t.nat[i] + t.loose[i] - bot) / S)]);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const i of list) { const ix = i % nx, iz = (i / nx) | 0; x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); z0 = Math.min(z0, iz); z1 = Math.max(z1, iz); conc[i] = 0; t.cBase[i] = 0; t.cSm[i] = 0; t.cSpill[i] = 0; }
    t._concTouch(x0, z0, x1, z1); t._touch(x0, z0, x1, z1);
    made.push(app.objects.add({ type: 'lump', x: +cx.toFixed(6), z: +cz.toFixed(6), y: +bot.toFixed(6), yaw: 0, cells, cell: Math.round(t.cell / S), at: 'ground' }).id);
  }
  return made;
}

// its size: r — the farthest of it from its middle (model units), h — its thickest, vol (m³), area (m²)
export function lumpSize(r) {
  const c = MM(r.cell || 30) / 2, a = Math.pow((r.cell || 30) / 1000, 2); let r2 = 0, h = 0, v = 0;
  for (const [dx, dz, hh] of r.cells) { r2 = Math.max(r2, Math.hypot(MM(dx), MM(dz)) + c); h = Math.max(h, MM(hh)); v += hh / 1000 * a; }
  return { r: r2, h, vol: v, area: r.cells.length * a };
}

// the bucket's teeth hit a big one: it breaks into uneven pieces (a Voronoi of random seeds over its cells, the cut wavering), none
// wider than maxR from its middle → the new ids (the old one gone)
export function breakLump(app, id, maxR, rnd = Math.random) {
  const O = app.objects, r = O.get(id); if (!r) return [];
  const A = Math.pow((r.cell || 30) / 1000, 2), pieces = [];
  const split = (cells, depth = 0) => {
    const k = Math.max(2, Math.min(15, Math.round(cells.length * A / 0.12)));
    const seeds = []; for (let n = 0; n < k; n++) seeds.push(cells[Math.floor(rnd() * cells.length)]);
    const w = seeds.map(() => rnd() * 60), groups = seeds.map(() => []);   // (an added weight, not a factor: each piece one connected piece)
    for (const c of cells) {
      let best = 0, bd = Infinity;
      for (let n = 0; n < k; n++) { const d = Math.hypot(c[0] - seeds[n][0], c[1] - seeds[n][1]) + w[n] + Math.sin(c[0] * 0.021 + c[1] * 0.013 + n * 1.7) * 25; if (d < bd) bd = d, best = n; }
      groups[best].push(c);
    }
    for (const g of groups) {
      if (!g.length) continue;
      const mx = g.reduce((a, c) => a + c[0], 0) / g.length, mz = g.reduce((a, c) => a + c[1], 0) / g.length;
      const rr = Math.max(...g.map((c) => Math.hypot(c[0] - mx, c[1] - mz))) + (r.cell || 30) / 2;
      if (MM(rr) > maxR && g.length > 8 && depth < 6) split(g, depth + 1); else pieces.push({ g, mx, mz });
    }
  };
  split(r.cells);
  const cs = Math.cos(r.yaw || 0), sn = Math.sin(r.yaw || 0), ids = [];
  O.remove(id);
  for (const { g, mx, mz } of pieces) {
    if (g.length * A < LUMP.minA) continue;   // (crumbs: gone into the soil)
    const bmin = Math.min(...g.map((c) => c[3] || 0));
    ids.push(O.add({ type: 'lump', x: +(r.x + MM(mx) * cs + MM(mz) * sn).toFixed(6), z: +(r.z - MM(mx) * sn + MM(mz) * cs).toFixed(6), y: +((r.y ?? 0) + MM(bmin)).toFixed(6), yaw: r.yaw || 0,
      cells: g.map((c) => [Math.round(c[0] - mx), Math.round(c[1] - mz), c[2], (c[3] || 0) - bmin]), cell: r.cell, at: 'ground' }).id);
  }
  app.sfx?.play?.('stone', { vol: 0.6 }); app.sfx?.play?.('debris', { vol: 0.35 });
  return ids;
}

let _mat = null;
const mat = () => _mat || (_mat = mortarPhoto(new THREE.MeshStandardMaterial({ color: CONCRETE.color, roughness: 0.93, vertexColors: true }), { tile: 1.23, k: 1.0, tint: 0.3 }));

// the view: each lump a smooth dab — its top the cells' heights over its underside (the imprint), smoothed, its rim thinning out to
// 5–10 mm, its underside and rim soiled; lying in its imprint along the slope, falling, sliding; in a bucket (machineTool's `holds`);
// in the truck's body, sliding out as it tips
export class LumpView {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'lumps'; app.scene.add(this.group);
    this.meshes = new Map(); this.fall = new Map(); this.slide = new Map(); this.shoved = new Set(); this.holds = []; this.dirty = true;
    app.objects.on((id, rec) => { if (!rec || rec.type === 'lump' || this.meshes.has(id)) this.dirty = true; });
  }
  get held() { return this.holds[0] || null; }
  isHeld(id) { return this.holds.some((h) => h.id === id); }
  _geo(r) {
    const C = r.cell || 30, cs = MM(C), key = (a, b) => a + ',' + b, cells = new Map();
    for (const [dx, dz, h, b] of r.cells) cells.set(key(Math.round(dx / C), Math.round(dz / C)), [h, b || 0]);
    // (corner vertices: the mean of the cells about them; on the rim, thin)
    const V = new Map();
    for (const k of cells.keys()) { const [a, b] = k.split(',').map(Number); for (const [u, w] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!V.has(key(a + u, b + w))) V.set(key(a + u, b + w), null); }
    for (const k of V.keys()) {
      const [a, b] = k.split(',').map(Number); let hs = 0, bs = 0, n = 0;
      for (const [u, w] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const c = cells.get(key(a + u, b + w)); if (c) { hs += c[0]; bs += c[1]; n++; } }
      V.set(k, { h: n === 4 ? hs / n : Math.max(6, hs / n * 0.18), b: bs / n, rim: n < 4 });
    }
    for (let p = 0; p < 2; p++) {   // (the top smoothed: a poured skin, not steps)
      const nh = new Map();
      for (const [k, v] of V) { if (v.rim) { nh.set(k, v.h); continue; } const [a, b] = k.split(',').map(Number); let s = v.h * 2, n = 2; for (const [u, w] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = V.get(key(a + u, b + w)); if (q && !q.rim) { s += q.h; n++; } } nh.set(k, s / n); }
      for (const [k, h] of nh) V.get(k).h = h;
    }
    const pos = [], col = [], idx = [], ti = new Map(), bi = new Map();
    const Pt = (k, top) => { const m = top ? ti : bi; if (m.has(k)) return m.get(k); const [a, b] = k.split(',').map(Number), v = V.get(k), y = MM(v.b) + (top ? MM(v.h) : 0);
      pos.push((a - 0.5) * cs, y, (b - 0.5) * cs); const dirt = top ? (v.rim ? 0.72 : 1) : 0.55; col.push(dirt, dirt * 0.97, dirt * 0.93); m.set(k, pos.length / 3 - 1); return pos.length / 3 - 1; };
    for (const k of cells.keys()) {
      const [a, b] = k.split(',').map(Number), c = [key(a, b), key(a + 1, b), key(a + 1, b + 1), key(a, b + 1)];
      const t = c.map((q) => Pt(q, true)), u = c.map((q) => Pt(q, false));
      idx.push(t[0], t[2], t[1], t[0], t[3], t[2], u[0], u[1], u[2], u[0], u[2], u[3]);
      for (const [e, [da, db]] of [[0, [0, -1]], [1, [1, 0]], [2, [0, 1]], [3, [-1, 0]]]) if (!cells.has(key(a + da, b + db))) { const i0 = e, i1 = (e + 1) % 4; idx.push(t[i0], t[i1], u[i1], t[i0], u[i1], u[i0]); }   // (its rim: the top down to the underside)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // where it rests: its imprint along the plane of the ground under it (≤ 35°), as low as it goes with all of it over the ground
  // → { y (its origin's height), q (its turn), steep (the slope it would need) }
  pose(r, x = r.x, z = r.z) {
    const t = this.app.terrain, cs = Math.cos(r.yaw || 0), sn = Math.sin(r.yaw || 0), step = Math.max(1, Math.floor(r.cells.length / 48)), P = [];
    for (let k = 0; k < r.cells.length; k += step) { const [dx, dz, , b] = r.cells[k], X = MM(dx) * cs + MM(dz) * sn, Z = -MM(dx) * sn + MM(dz) * cs; if (t.inside(x + X, z + Z)) P.push([X, Z, t.heightAt(x + X, z + Z) - MM(b || 0)]); }
    if (!P.length) return { y: r.y ?? 0, q: new THREE.Quaternion().setFromAxisAngle(UP, r.yaw || 0), steep: 0 };
    // (the plane by least squares, its slope held to 35°)
    let sx = 0, sz = 0, sv = 0, sxx = 0, szz = 0, sxz = 0, sxv = 0, szv = 0; const n = P.length;
    for (const [X, Z, v] of P) { sx += X; sz += Z; sv += v; sxx += X * X; szz += Z * Z; sxz += X * Z; sxv += X * v; szv += Z * v; }
    const mx = sx / n, mz = sz / n, mv = sv / n, cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxv = sxv / n - mx * mv, czv = szv / n - mz * mv, det = cxx * czz - cxz * cxz;
    let a = det > 1e-12 ? (cxv * czz - czv * cxz) / det : 0, c = det > 1e-12 ? (czv * cxx - cxv * cxz) / det : 0;
    const gr = Math.hypot(a, c), steep = Math.atan(gr); if (gr > TAN) { a *= TAN / gr; c *= TAN / gr; }
    let y = -Infinity; for (const [X, Z, v] of P) y = Math.max(y, v - a * X - c * Z);
    const nrm = new THREE.Vector3(-a, 1, -c).normalize(), q = new THREE.Quaternion().setFromUnitVectors(UP, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(UP, r.yaw || 0));
    return { y, q, steep };
  }
  update(dt = 1 / 60) {
    const O = this.app.objects, seen = new Set(), T = this.app.machineTool?.truck, t = this.app.terrain;
    for (const r of O.all('lump')) {
      seen.add(r.id);
      let m = this.meshes.get(r.id);
      if (!m) { m = new THREE.Mesh(this._geo(r), mat()); m.castShadow = m.receiveShadow = true; m.userData.lumpId = r.id; this.group.add(m); this.meshes.set(r.id, m); }
      if (this.isHeld(r.id)) continue;   // (in a bucket: machineTool moves it)
      if (r.at === 'truck' && T?.bed && T.root.visible) {
        // (in the body; tipped, it slides with the load to the tailgate — the one nearest it first — and off it, flying 0,5–1,5 m)
        if (T.tip > 0.35) {
          const v = MM(800) * Math.min(1, (T.tip - 0.35) / 0.3) * (0.8 + ((r.id * 7919) % 100) / 250);
          r.tx = +(r.tx - v * dt).toFixed(6);
          if (r.tx < T.x0 + MM(150)) {
            const p = T.bed.localToWorld(new THREE.Vector3(r.tx, r.ty, r.tz)), fx = Math.cos(T.yaw), fz = -Math.sin(T.yaw), sp = MM(1000 + ((r.id * 104729) % 1000));
            O.update(r.id, { at: 'ground', x: +p.x.toFixed(6), z: +p.z.toFixed(6) }); this.fall.set(r.id, { y: p.y, v: 0, vx: -fx * sp, vz: -fz * sp });
            if (T.load > 0) T.load = Math.max(0, T.load - lumpSize(r).vol / MODEL_SCALE ** 3 / (T.cap || 1));
            m.position.copy(p); m.userData.placed = true; continue;
          }
        }
        const p = T.bed.localToWorld(new THREE.Vector3(r.tx, r.ty, r.tz)); m.position.copy(p); m.quaternion.copy(T.root.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(UP, r.yaw || 0)); continue;
      }
      // (on the ground: in its imprint along the slope — at g down to it when it is higher. Never up of itself: what is heaped by or
      // over it buries it — the owner: covered, it is not seen; its height kept in its record so a saved game keeps it so)
      const sz = lumpSize(r);
      let P = this.pose(r), F = this.fall.get(r.id);
      let y = F ? F.y : m.userData.placed ? m.position.y : Math.min(r.y ?? P.y, P.y);
      if (!F && !m.userData.placed && r.y != null && r.y > P.y + MM(5)) { this.fall.set(r.id, { y: r.y, v: 0 }); y = r.y; F = this.fall.get(r.id); }
      const onTop = !F && y >= P.y - MM(10);
      if (onTop && m.userData.placed) {
        if (P.y > y && this.shoved.has(r.id)) y = P.y;   // (shoved onto higher ground: on it)
        // (steeper under it than it holds on — over a pit's edge, a heap's side past ~35°: it slides down, faster and faster; below its
        // friction angle it slows down and stops, at 30° at the latest)
        const e = Math.max(sz.r, MM(150)), gx = (t.heightAt(r.x + e, r.z) - t.heightAt(r.x - e, r.z)) / (2 * e), gz = (t.heightAt(r.x, r.z + e) - t.heightAt(r.x, r.z - e)) / (2 * e);
        const sl = Math.hypot(gx, gz), ang = Math.max(Math.atan(sl), P.steep > 0.61 ? Math.min(P.steep, 1.2) : 0), S0 = this.slide.get(r.id);
        const a0 = G * (Math.sin(ang) - 0.62 * Math.cos(ang)), v0 = S0 ? Math.max(0, S0.v + a0 * dt) : 0;
        if (sl > 1e-6 && (S0 ? v0 > 0 && ang > 0.52 : ang > 0.61)) {
          const v = S0 ? v0 : Math.max(0, a0 * dt), dx = -gx / sl, dz = -gz / sl, nx = r.x + dx * v * dt * Math.cos(ang), nz = r.z + dz * v * dt * Math.cos(ang);
          if (t.inside(nx, nz)) { r.x = +nx.toFixed(6); r.z = +nz.toFixed(6); P = this.pose(r); if (y - P.y < MM(30)) y = P.y; }
          this.slide.set(r.id, { v });
        } else if (S0) { this.slide.delete(r.id); this.app.sfx?.play?.('stone', { at: m.position, vol: 0.3 }); }
      } else this.slide.delete(r.id);
      if (y > P.y + MM(5)) {
        const F1 = this.fall.get(r.id) || { v: 0 }, v = F1.v + G * dt; y = Math.max(P.y, y - v * dt);
        if (F1.vx) { r.x = +(r.x + F1.vx * dt).toFixed(6); r.z = +(r.z + F1.vz * dt).toFixed(6); P = this.pose(r); }
        if (y > P.y) this.fall.set(r.id, { ...F1, y, v }); else { this.fall.delete(r.id); if (v > G * 0.15) this.app.sfx?.play?.('stone', { at: m.position, vol: 0.4 }); }
      } else this.fall.delete(r.id);
      if (!this.fall.has(r.id) && Math.abs((r.y ?? -1e9) - y) > MM(5)) r.y = +y.toFixed(6);   // (kept quietly: not a change of its own)
      m.position.set(r.x, y, r.z);
      if (y >= P.y - MM(10)) m.quaternion.slerp(P.q, m.userData.placed ? Math.min(1, dt * 8) : 1);   // (lying: along what is under it; buried: as it was)
      m.userData.placed = true;
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); m.geometry.dispose(); this.meshes.delete(id); this.fall.delete(id); }
    this.holds = this.holds.filter((h) => O.get(h.id));
    this.shoved.clear();
  }
  // let go at the mesh's present place (world): it falls from there
  drop(id, vx = 0, vz = 0) { const m = this.meshes.get(id); if (m) this.fall.set(id, { y: m.position.y, v: 0, vx, vz }); }
}
