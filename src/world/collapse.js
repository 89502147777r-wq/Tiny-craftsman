import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { LIFT } from './lift.js';
import { isSlab } from '../tools/slab.js';
import { toWorld } from '../tools/belt.js';

// «Обрушение опоры» (a catastrophe of its own kind, `shaft`): a house standing on a glass lift shaft comes
// down, as the realist describes such a failure (his lessons of builds 274 and 276; the owner: «not a Lego
// set — many different pieces, as in life»):
//   1. the posts go first: tied by the head they all bow the same way (to the lean), a half sine growing over a
//      second or two, then each kinks at its own height (0,35–0,55); the shaft shortens by it, the house sinks
//      a little and leans ~2° to its heavy side;
//   2. the panes crack from a lower corner on the diagonal into a web, whiten at once, and — laminated glass —
//      do not fly apart: they fold out at their middle in their plates, crumbs falling; the cabin is crushed;
//   3. the house goes as one body, tipping over the edge it lies on (10–20° by the strike: a corner first);
//   4. it strikes: the slabs break along ragged lines (Voronoi cells, their edges jagged, rebar stubs bent out
//      of the breaks) into pieces of all sizes, those far from the first blow still held together by their
//      bars; the walls into chunks of every size (one block, a few, a slab of wall) — never a grid — broken
//      blocks and crumbs; the fascias crumple off onto the ground; the dust first runs out along the ground in
//      a ring (4–6 m/s, a second) and then rises and drifts; nothing bounces (a few cm), nothing flies.
// Nothing in the records changes (a show, as every catastrophe): «Вернуть как было» puts it all back.
const S = MODEL_SCALE, M = (v) => v / S, MM = (v) => v / 1000 / S;
const rnd = (() => { let s = 97531; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
export const SHAFT_T = { creak: 0.4, bow: 0.8, white: 2.5, fail: 3.1 };

// a crack web in a pane from its lower corner: the alpha the order a line appears in (an alphaTest going down shows it grow)
const _tex = [];
function crackTex(k) {
  if (_tex[k]) return _tex[k];
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n); g.lineCap = 'round';
  let x0 = 0x2f1d + k * 7919; const r = () => ((x0 = (x0 * 16807) % 2147483647) / 2147483647);
  const ox = k % 2 ? n - 4 : 4, oy = n - 4, rays = [];
  for (let q = 0; q < 11; q++) {
    const a0 = (k % 2 ? Math.PI : 0) + (k % 2 ? 1 : -1) * (Math.PI / 4 + (q - 5) * 0.12 + (r() - 0.5) * 0.08), len = n * (0.5 + r() * 0.9), pts = [[ox, oy]];
    let x = ox, y = oy; for (let s = 0; s < 16; s++) { const a = a0 + (r() - 0.5) * 0.35; x += Math.cos(a) * len / 16; y += Math.sin(a) * len / 16; pts.push([x, y]); }
    rays.push(pts);
    const v = 255 - Math.floor(Math.abs(q - 5) / 6 * 150);
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = q === 5 ? 2.4 : 1.4; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.stroke();
  }
  for (let ring = 1; ring < 8; ring++) for (let q = 0; q < rays.length - 1; q++) {
    if (r() < 0.3) continue;
    const a = rays[q][Math.min(16, ring * 2)], b = rays[q + 1][Math.min(16, ring * 2)], v = 150 - ring * 15;
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1; g.beginPath(); g.moveTo(...a); g.lineTo((a[0] + b[0]) / 2 + (r() - 0.5) * 8, (a[1] + b[1]) / 2 + (r() - 0.5) * 8); g.lineTo(...b); g.stroke();
  }
  return (_tex[k] = new THREE.CanvasTexture(c));
}

// ---- the slabs' pieces --------------------------------------------------------------------------------------
// Each cast slab cut along the lines it will break on: a Voronoi of random seeds (pieces of all sizes), the cells'
// shared edges made ragged the same for both sides (by a hash of the edge's ends), the rebar of both mats sticking
// out of the breaks bent down. A piece: a group (its concrete, its bars), world placed; userData.hull — its corners
// (world, model units) for a convex collider; userData.slab — which slab.
const clipHalf = (poly, m, d) => {
  const out = [], f = (p) => (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) { const u = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
  }
  return out;
};
const key = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10007) / 10007; };
const MATS = {};
const concMat = () => (MATS.c ||= new THREE.MeshStandardMaterial({ color: 0x9d9b95, roughness: 0.95, vertexColors: true }));
const barMat = () => (MATS.b ||= new THREE.MeshStandardMaterial({ color: 0x5b4b3f, roughness: 0.6, metalness: 0.4 }));
export function slabPieces(objects) {
  const out = [];
  for (const b of objects.all('belt')) {
    if (!isSlab(b) || !(b.fill > 0.5)) continue;
    const cl = b.clip || [0, 0, b.ni * b.c, b.nj * b.c], [s0, t0, s1, t1] = cl, A = ((s1 - s0) * (t1 - t0)) * S * S;
    const N = Math.max(18, Math.min(90, Math.round(A / 1.1))), seeds = [];
    for (let k = 0; k < N; k++) seeds.push([s0 + (s1 - s0) * rnd(), t0 + (t1 - t0) * rnd()]);
    const onRim = (p) => Math.abs(p[0] - s0) < 1e-6 || Math.abs(p[0] - s1) < 1e-6 || Math.abs(p[1] - t0) < 1e-6 || Math.abs(p[1] - t1) < 1e-6;
    const amp = MM(45), H = b.H, y0 = b.top, holes = b.holes || [], c = b.c;
    for (let i = 0; i < N; i++) {
      let poly = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];
      for (let j = 0; j < N && poly.length; j++) if (j !== i) { const si = seeds[i], sj = seeds[j]; poly = clipHalf(poly, [(si[0] + sj[0]) / 2, (si[1] + sj[1]) / 2], [sj[0] - si[0], sj[1] - si[1]]); }
      if (poly.length < 3) continue;
      const cs = poly.reduce((a, p) => a + p[0], 0) / poly.length, ct = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      if (holes.some(([a0, b0, a1, b1]) => cs > a0 * c && cs < a1 * c && ct > b0 * c && ct < b1 * c)) continue;   // (over an opening: no concrete)
      // ragged edges: each shared one subdivided, the points pushed across it by the same amounts on both sides
      const rag = [], inner = [];
      for (let e = 0; e < poly.length; e++) {
        const a = poly[e], bq = poly[(e + 1) % poly.length];
        rag.push(a);
        if (onRim(a) && onRim(bq) && (Math.abs(a[0] - bq[0]) < 1e-6 || Math.abs(a[1] - bq[1]) < 1e-6)) continue;
        const ka = key(a), kb = key(bq), flip = ka > kb, P0 = flip ? bq : a, P1 = flip ? a : bq, L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
        if (L < MM(150)) continue;
        const nx = -(P1[1] - P0[1]) / L, nz = (P1[0] - P0[0]) / L, n = Math.max(2, Math.round(L / MM(220))), pts = [];
        for (let q = 1; q < n; q++) { const u = q / n, h = (hash(ka < kb ? ka + kb + q : kb + ka + q) - 0.5) * 2 * amp; pts.push([P0[0] + (P1[0] - P0[0]) * u + nx * h, P0[1] + (P1[1] - P0[1]) * u + nz * h]); }
        if (flip) pts.reverse();
        rag.push(...pts); inner.push([a, bq]);
      }
      // the concrete: top and bottom (fans from the middle), the sides; the breaks a little lighter and rougher
      const W = rag.map(([s, t]) => toWorld(b, s, t)), [cx, cz] = toWorld(b, cs, ct), pos = [], col = [];
      const tri = (p, q, r, k) => { pos.push(...p, ...q, ...r); for (let z = 0; z < 3; z++) col.push(k, k, k); };
      for (let e = 0; e < W.length; e++) {
        const [ax, az] = W[e], [bx, bz] = W[(e + 1) % W.length];
        tri([cx, y0 + H, cz], [bx, y0 + H, bz], [ax, y0 + H, az], 1); tri([cx, y0, cz], [ax, y0, az], [bx, y0, bz], 0.85);
        const k = 0.92 + 0.08 * hash(String(e) + cs);
        tri([ax, y0, az], [ax, y0 + H, az], [bx, y0 + H, bz], k); tri([ax, y0, az], [bx, y0 + H, bz], [bx, y0, bz], k);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
      const grp = new THREE.Group(), m = new THREE.Mesh(g, concMat()); m.castShadow = m.receiveShadow = true; grp.add(m);
      // the bars out of the breaks: Ø12 of the top and the bottom mats every ~300, bent down 15–60°, 100–260 long
      const bars = [];
      for (const [a, bq] of inner) {
        const L = Math.hypot(bq[0] - a[0], bq[1] - a[1]), n = Math.floor(L / MM(300));
        let nx = (bq[1] - a[1]) / L, nz = -(bq[0] - a[0]) / L; if ((a[0] - cs) * nx + (a[1] - ct) * nz < 0) { nx = -nx; nz = -nz; }   // (out of this piece)
        for (let q = 0; q < n; q++) {
          if (rnd() < 0.45) continue;
          const u = (q + 0.5) / n, ps = a[0] + (bq[0] - a[0]) * u, pt = a[1] + (bq[1] - a[1]) * u, yb = y0 + (rnd() < 0.5 ? MM(40) : H - MM(40)), len = MM(100 + rnd() * 160), dip = (15 + rnd() * 45) * Math.PI / 180;
          const [x0, z0] = toWorld(b, ps - nx * MM(60), pt - nz * MM(60)), [x1, z1] = toWorld(b, ps + nx * len * Math.cos(dip), pt + nz * len * Math.cos(dip));
          const A0 = new THREE.Vector3(x0, yb, z0), B0 = new THREE.Vector3(x1, yb - len * Math.sin(dip), z1), d = B0.clone().sub(A0), cy = new THREE.CylinderGeometry(MM(6), MM(6), d.length(), 5, 1, true);
          cy.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); cy.translate((A0.x + B0.x) / 2, (A0.y + B0.y) / 2, (A0.z + B0.z) / 2); cy.deleteAttribute('uv'); bars.push(cy);
        }
      }
      if (bars.length) { const bm = new THREE.Mesh(mergeIndexed(bars), barMat()); grp.add(bm); }
      grp.userData.hull = W.flatMap(([x, z]) => [[x, y0, z], [x, y0 + H, z]]); grp.userData.slab = b.id;
      out.push(grp);
    }
  }
  return out;
}
function mergeIndexed(list) {
  const pos = [], nor = [], idx = []; let o = 0;
  for (const g of list) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
    for (let k = 0; k < p.length; k++) { pos.push(p[k]); nor.push(n[k]); }
    for (const q of ix) idx.push(q + o);
    o += p.length / 3;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}
// a convex collider from points (model units) about a centre c (model), shrunk `in` metres toward their middle
export function hullDesc(R, pts, c, shrink = 0.008) {
  const m = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]), arr = [];
  for (const p of pts) { const v = [(p[0] - m[0]) * S, (p[1] - m[1]) * S, (p[2] - m[2]) * S], l = Math.hypot(...v) || 1, k = Math.max(0, l - shrink) / l; arr.push((m[0] - c.x) * S + v[0] * k, (m[1] - c.y) * S + v[1] * k, (m[2] - c.z) * S + v[2] * k); }
  return R.ColliderDesc.convexHull(new Float32Array(arr));
}

// ---- the bits: glass shards and crumbs of concrete and block — our own simple flight (g, a bounce, rest) ----
class Bits {
  constructor(root, n, geo, mat, colour = false) {
    this.m = new THREE.InstancedMesh(geo, mat, n); this.m.count = 0; this.m.frustumCulled = false; this.m.castShadow = !colour; root.add(this.m);
    this.p = []; this.n = n; this.colour = colour;
  }
  add(at, v, size, col = null, spread = M(0.4)) {
    if (this.p.length >= this.n) return;
    const s = { x: at.x + (rnd() - 0.5) * spread, y: at.y + (rnd() - 0.5) * spread * 0.5, z: at.z + (rnd() - 0.5) * spread, v: v.clone(), s: size, r: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), w: (rnd() - 0.5) * 14, rest: false, k: [0.7 + rnd() * 0.6, 0.6 + rnd() * 0.5, 0.7 + rnd() * 0.6] };
    if (col && this.colour) this.m.setColorAt(this.p.length, col);
    this.p.push(s);
    if (this.m.instanceColor) this.m.instanceColor.needsUpdate = true;
  }
  update(dt, floor) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    this.p.forEach((s, i) => {
      if (!s.rest) {
        s.v.y -= M(9.81) * dt; s.x += s.v.x * dt; s.y += s.v.y * dt; s.z += s.v.z * dt; s.r.x += s.w * dt; s.r.z += s.w * 0.7 * dt;
        const f = floor(s.x, s.z) + s.s * 0.4;
        if (s.y < f) { s.y = f; if (Math.abs(s.v.y) < M(0.7)) s.rest = true; else { s.v.y *= -0.18; s.v.x *= 0.35; s.v.z *= 0.35; s.w *= 0.4; } }
      }
      q.setFromEuler(s.r); sc.set(s.s * s.k[0], s.s * s.k[1], s.s * s.k[2]); m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, sc); this.m.setMatrixAt(i, m4);
    });
    this.m.count = this.p.length; this.m.instanceMatrix.needsUpdate = true;
  }
}
function rockGeo() {
  const g = new THREE.DodecahedronGeometry(0.5, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.7 + 0.6 * hash(String(Math.round(p.getX(i) * 100)) + Math.round(p.getY(i) * 100) + Math.round(p.getZ(i) * 100)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  g.computeVertexNormals(); return g;
}

export class ShaftCollapse {
  // D: the Disaster (its world, chunks, panels); the lift records and their groups in the wall view
  constructor(D) {
    this.D = D; const app = D.app, wv = app.wallView, R = D.R, W = D.world;
    this.lifts = app.objects.all('lift').map((r) => ({ r, g: wv._liftG?.get(r.id) })).filter((q) => q.g);
    this.ok = this.lifts.length > 0;
    if (!this.ok) return;
    const L = this.lifts[0], r = L.r, top = r.top;
    this.L = L;
    // what the shaft carries: every chunk and panel over its top (by its middle — the fascias hang under the soffit;
    // one left behind would hold the house up)
    const over = (b) => (b.min.y + b.max.y) / 2 > top - M(0.05) && b.max.y > top + M(0.1);
    this.chunks = D.chunks.filter((c) => over(c.box));
    this.panels = D.panels.filter((p) => over(p.box));
    const box = new THREE.Box3(); for (const c of this.chunks) box.union(c.box); for (const p of this.panels) box.union(p.box);
    if (box.isEmpty()) { this.ok = false; return; }
    this.top0 = box.max.y;
    // the house as one body: its parts' boxes (the slabs' pieces: their hulls), its centre of mass; held (kinematic) till it fails
    let mx = 0, my = 0, mz = 0, mt = 0;
    const vol = (b) => Math.max(1e-3, b.getSize(new THREE.Vector3()).toArray().reduce((a, v) => a * v * S, 1));
    const parts = [...this.chunks.map((c) => ({ b: c.box, m: c.mass, it: c })), ...this.panels.map((p) => ({ b: p.box, m: (p.sort === 'slab' ? 2400 * 0.8 : p.sort === 'roof' ? 120 : 300) * vol(p.box), it: p }))];
    for (const q of parts) { const c = q.b.getCenter(new THREE.Vector3()); mx += c.x * q.m; my += c.y * q.m; mz += c.z * q.m; mt += q.m; }
    this.com = new THREE.Vector3(mx / mt, my / mt, mz / mt);
    this.p0 = this.com.clone();
    const body = (this.body = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.p0.x * S, this.p0.y * S, this.p0.z * S).setLinearDamping(0.02).setAngularDamping(0.05)));
    for (const q of parts) {
      const c = q.b.getCenter(new THREE.Vector3()), sz = q.b.getSize(new THREE.Vector3()), hull = q.it.o?.userData?.hull;
      const hx = Math.max(0.02, sz.x * S / 2), hy = Math.max(0.02, sz.y * S / 2), hz = Math.max(0.02, sz.z * S / 2), v = 8 * hx * hy * hz;
      const desc = (hull && hullDesc(R, hull, this.p0)) || R.ColliderDesc.cuboid(hx, hy, hz).setTranslation((c.x - this.p0.x) * S, (c.y - this.p0.y) * S, (c.z - this.p0.z) * S);
      W.createCollider(desc.setDensity(q.m / v).setFriction(0.8).setRestitution(0.02), body);
      const own = q.it.body; for (let k = 0; k < own.numColliders(); k++) own.collider(k).setEnabled(false);
      q.it.carry = true; q.it.rel = new THREE.Matrix4().makeTranslation((q.it.c?.x ?? c.x) - this.p0.x, (q.it.c?.y ?? c.y) - this.p0.y, (q.it.c?.z ?? c.z) - this.p0.z);
    }
    // the shaft's head as what the house lies on: a box the posts hold up, lowered as they bow and fold
    const [ux, uz] = r.u;
    this.head = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(r.x * S, top * S - 0.15, r.z * S));
    W.createCollider(R.ColliderDesc.cuboid(MM(r.w / 2 + 300) * S, 0.15, MM(r.d / 2 + 300) * S).setFriction(0.9), this.head);
    // (the pump cabinet by the door: something the falling house does not pass through)
    { const g = L.g; g.updateMatrixWorld(true); const c = new THREE.Vector3(r.w / 2 + 420, 900, r.d / 2 - 300).applyMatrix4(g.matrix), yaw = Math.atan2(-uz, ux) + Math.PI / 2, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const cb = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(c.x * S, c.y * S, c.z * S).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })); W.createCollider(R.ColliderDesc.cuboid(0.3, 0.9, 0.3), cb); }
    // (the heavy side: where the house's mass lies off the shaft — it leans and tips that way)
    let dx = this.com.x - r.x, dz = this.com.z - r.z; const dl = Math.hypot(dx, dz);
    if (dl < M(0.3)) { dx = ux; dz = uz; } else { dx /= dl; dz /= dl; }
    this.lean = new THREE.Vector3(dx, 0, dz); this.axis = new THREE.Vector3(dz, 0, -dx);   // (the tilt's axis: across the lean; + lowers the lean side)
    this.leanL = [dx * -uz + dz * ux, dx * ux + dz * uz];   // (the lean in the lift's own axes: x across its door, z out of it)
    this.top = top; this.y0 = r.y0; this.Hpost = (top - r.y0) * S * 1000;   // (mm)
    this._failParts();
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0.3, 0.4, 0, 1], 3)); sg.computeVertexNormals();
    this.shards = new Bits(D.root, 500, sg, new THREE.MeshStandardMaterial({ color: 0xcfe6df, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    this.crumbs = new Bits(D.root, 700, rockGeo(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), true);
    this.tilt = 0; this.free = false; this.struck = false; this.said = {};
  }
  _failParts() {
    const g = this.L.g, ud = g.userData, P = LIFT.post, W = this.L.r.w / 2, D = this.L.r.d / 2, yH = this.Hpost;
    for (const ch of g.children) if (ch.name === 'frame' || ch.name === 'glass' || ch.name === 'edge' || ch.name === 'epdm') ch.visible = false;
    const fm = new THREE.MeshStandardMaterial({ color: 0x383d42, roughness: 0.5 });
    this.posts = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const geo = new THREE.BoxGeometry(P, yH - 50, P, 1, 48, 1); geo.translate(sx * (W - P / 2), 50 + (yH - 50) / 2, sz * (D - P / 2));
      const m = new THREE.Mesh(geo, fm); m.castShadow = true; g.add(m);
      this.posts.push({ m, base: geo.attributes.position.array.slice(), kink: 0.35 + 0.2 * rnd(), k2: 0.75 + 0.15 * rnd() });
    }
    // the panes: each in two halves (it folds out at its middle), its glass and its crack web
    this.panes = [];
    const half = (w, h, v0, v1, mat) => { const pg = new THREE.PlaneGeometry(w, h); const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + (v1 - v0) * uv.getY(i)); return new THREE.Mesh(pg, mat); };
    (ud.panes || []).filter((q) => q[4] <= yH + 5).forEach((q, k) => {
      const [side, x0, x1, y0, y1, z0, z1] = q, w = Math.max(x1 - x0, z1 - z0), h = (y1 - y0) / 2;
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xd6ebe6, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
      const crack = new THREE.MeshBasicMaterial({ color: 0xeef3f1, alphaMap: crackTex(k % 4), alphaTest: 1, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const root = new THREE.Group(); root.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); if (side === 'left' || side === 'right') root.rotation.y = Math.PI / 2;
      const lo = new THREE.Group(), hi = new THREE.Group();
      for (const [grp, v0, v1, dy] of [[lo, 0, 0.5, h / 2], [hi, 0.5, 1, -h / 2]]) {
        const gm = half(w, h, v0, v1, glass), cm = half(w, h, v0, v1, crack); gm.position.y = cm.position.y = dy; cm.position.z = 6; gm.renderOrder = 2; cm.renderOrder = 3; grp.add(gm, cm);
      }
      lo.position.y = y0; hi.position.y = y1; root.add(lo, hi); g.add(root);
      // (out: which way is out of the shaft in the pane's own z: back −, front +, left − (turned +90°: −x), right +)
      const out = side === 'back' || side === 'left' ? -1 : 1;
      this.panes.push({ root, lo, hi, glass, crack, side, y0, y1, out, h, at: SHAFT_T.bow + 0.2 + (y0 / yH) * 1.2 + rnd() * 0.4, white: SHAFT_T.white + (y0 / yH) * 0.4 + rnd() * 0.25, n: [side === 'left' ? -1 : side === 'right' ? 1 : 0, side === 'back' ? -1 : side === 'front' ? 1 : 0] });
    });
    this.cab = g.userData.cab; this.cabY0 = this.cab?.position.y ?? 0;
    this._own = new Set([...this.posts.map((q) => q.m), ...this.panes.map((p) => p.root)]);
  }
  // the posts' bow (mm at the kink) at time t
  _bow(t) { const T = SHAFT_T; return t < T.bow ? 0 : t < T.fail ? 70 * ((t - T.bow) / (T.fail - T.bow)) ** 2 + 180 * Math.max(0, (t - T.white) / (T.fail - T.white)) ** 3 : 250 + 900 * Math.min(1, (t - T.fail) / 0.6) ** 1.5; }
  _shape(t) {
    const A = this._bow(t), yH = this.Hpost, fold = Math.min(1, Math.max(0, (t - SHAFT_T.fail) / 0.55)) ** 1.4, [lx, lz] = this.leanL;
    // (shortening: the arc's length kept — a bow A over H takes ≈ π²A²/(4H) off its height; folded, the posts lie down)
    const short = Math.min(yH - 350, (Math.PI ** 2 * A * A) / (4 * yH) + fold * (yH - 550));
    for (const q of this.posts) {
      const pos = q.m.geometry.attributes.position, b = q.base;
      for (let i = 0; i < pos.count; i++) {
        const y = b[i * 3 + 1], u = Math.max(0, Math.min(1, (y - 50) / (yH - 50)));
        // (all one way — the lean; a half sine sharpening into a kink at this post's own height, a second one over it)
        const k1 = Math.max(0, 1 - Math.abs(u - q.kink) / Math.max(q.kink, 1 - q.kink)), k2 = Math.max(0, 1 - Math.abs(u - q.k2) / 0.25) * 0.35;
        const s = Math.sin(Math.PI * u) * (1 - fold) + fold * (k1 ** 0.5 - k2);
        pos.setXYZ(i, b[i * 3] + lx * A * s, 50 + (y - 50) * (1 - short / yH), b[i * 3 + 2] + lz * A * s);
      }
      pos.needsUpdate = true; q.m.geometry.computeVertexNormals();
    }
    const k = Math.max(0.06, 1 - short / yH);
    // (the rails, the cylinder, the doors, the head — down with the posts)
    for (const ch of this.L.g.children) if (ch.visible && !this._own.has(ch) && ch !== this.cab && ch.name !== 'cabinet' && ch.name !== 'conc') ch.scale.y = k;
    // (the cabin crushed, not squashed: down to half its height at most, racked over to the lean)
    if (this.cab) { this.cab.scale.y = Math.max(0.42, Math.min(1, k * 1.6)); this.cab.rotation.set(lz * (1 - k) * 0.5, 0, -lx * (1 - k) * 0.5); this.cab.position.y = this.cabY0 * Math.min(1, k * 1.2); }
    // (the panes: each half the same length — they fold out at the middle as the height closes)
    for (const p of this.panes) {
      const Hn = (p.y1 - p.y0) * k, c = Math.min(1, Hn / (2 * p.h)), th = p.whited ? Math.acos(c) : 0;
      p.lo.position.y = p.y0 * k; p.hi.position.y = p.y1 * k;
      p.lo.rotation.x = -p.out * th; p.hi.rotation.x = p.out * th;
    }
    return short;
  }
  // each step of the physics (h s)
  load(h) {
    const D = this.D, t = D.t, T = SHAFT_T, sfx = D.app.sfx, R = D.R;
    if (!this.ok) return;
    const short = this._shape(t);
    if (t > T.creak && !this.said.creak) { this.said.creak = true; sfx?.play?.('creak', { vol: 0.8, at: this.com }); }
    if (t > T.bow + 0.9 && !this.said.creak2) { this.said.creak2 = true; sfx?.play?.('creak', { vol: 1, at: this.com, rate: 0.8 }); }
    for (const p of this.panes) {
      const u = Math.max(0, Math.min(1, (t - p.at) / 0.9));
      if (!p.whited) p.crack.alphaTest = 1 - 0.75 * u;
      if (u > 0 && !p.ticked) { p.ticked = true; sfx?.play?.('glass', { vol: 0.35, rate: 1.4, gap: 0.08 }); }
      if (t > p.white && !p.whited) {
        // (it whitens at once — the web all over — and folds on its film; crumbs off it)
        p.whited = true; p.crack.alphaTest = 0.02; p.glass.color.setHex(0xeaf0ee); p.glass.opacity = 0.62;
        sfx?.play?.('glass_break', { vol: 0.55, gap: 0.05 });
        const at = p.root.getWorldPosition(new THREE.Vector3()); at.y = this.L.r.y0 + MM((p.y0 + p.y1) / 2);
        const dir = new THREE.Vector3(p.n[0], 0, p.n[1]).transformDirection(this.L.g.matrix).setY(0).normalize();
        for (let q = 0; q < 12; q++) this.shards.add(at, new THREE.Vector3(dir.x * M(0.6 + rnd()), M(rnd() * 0.5), dir.z * M(0.6 + rnd())), MM(6 + rnd() * 9), null, M(0.8));
      }
    }
    const sinkM = short / 1000;
    if (!this.free) {
      this.tilt = t < T.bow ? 0 : 0.035 * Math.min(1, (t - T.bow) / (T.fail - T.bow)) ** 2;
      const q = new THREE.Quaternion().setFromAxisAngle(this.axis, this.tilt);
      this.body.setNextKinematicTranslation({ x: this.p0.x * S, y: this.p0.y * S - sinkM, z: this.p0.z * S });
      this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      this.head.setNextKinematicTranslation({ x: this.L.r.x * S, y: this.top * S - 0.15 - sinkM - 0.02, z: this.L.r.z * S });
      if (t >= T.fail) {
        this.free = true;
        this.body.setBodyType(R.RigidBodyType.Dynamic, true);
        // (it goes off the side it leans to: turning over that edge — ≈ 15° by the strike, a corner first)
        this.body.setAngvel({ x: this.axis.x * 0.28, y: 0, z: this.axis.z * 0.28 }, true);
        sfx?.play?.('collapse', { vol: 1, at: this.com }); sfx?.play?.('creak', { vol: 1, rate: 0.6 });
      }
    } else if (!this.struck) {
      const u = Math.min(1, (t - T.fail) / 0.55), back = M(0.7) * S * u * u;
      this.head.setNextKinematicTranslation({ x: this.L.r.x * S - this.lean.x * back, y: Math.max(this.y0 * S - 0.4, this.top * S - 0.15 - sinkM - 0.02), z: this.L.r.z * S - this.lean.z * back });
      // the strike: its lowest corner at the ground
      if (this._low() < D.groundY * S + 0.05 || t > T.fail + 3) this._strike();
    } else {
      // (after it: no piece goes up faster than 0,6 m/s or sideways faster than 3 — the heap's solver kicks are no
      // bounce; nothing over the walls' first top)
      for (const it of this.bodies) {
        const v = it.linvel(), hz = Math.hypot(v.x, v.z), kh = hz > 3 ? 3 / hz : 1, p = it.translation();
        if (v.y > 0.6 || kh < 1 || (p.y > this.top0 * S && v.y > 0)) it.setLinvel({ x: v.x * kh, y: Math.min(v.y, p.y > this.top0 * S ? 0 : 0.6), z: v.z * kh }, true);
      }
    }
  }
  _pose() { const t = this.body.translation(), r = this.body.rotation(); return new THREE.Matrix4().compose(new THREE.Vector3(t.x / S, t.y / S, t.z / S), new THREE.Quaternion(r.x, r.y, r.z, r.w), new THREE.Vector3(1, 1, 1)); }
  _low() {
    const P = this._pose(); let lo = Infinity; const v = new THREE.Vector3();
    for (const p of this.panels) for (const q of p.o.userData.hull || [[p.box.min.x, p.box.min.y, p.box.min.z], [p.box.max.x, p.box.min.y, p.box.max.z]]) { v.set(q[0] - this.p0.x, q[1] - this.p0.y, q[2] - this.p0.z).applyMatrix4(P); lo = Math.min(lo, v.y); }
    for (const c of this.chunks) { v.set(c.c.x - this.p0.x, c.box.min.y - this.p0.y, c.c.z - this.p0.z).applyMatrix4(P); lo = Math.min(lo, v.y); }
    return lo * S;
  }
  get angle() { if (!this.body) return this.strikeAngle || 0; const r = this.body.rotation(); return 2 * Math.acos(Math.min(1, Math.abs(r.w))) * 180 / Math.PI; }
  // the strike: the house breaks into pieces of all sizes, each with the speed it had there (v + ω × r)
  _strike() {
    const D = this.D, R = D.R, W = D.world, P = this._pose(), lv = this.body.linvel(), av = this.body.angvel(), ct = this.body.translation(), sfx = D.app.sfx;
    this.struck = true; this.strikeAngle = this.angle; this.strikeT = D.t; this.bodies = [];
    const vel = (x, y, z) => { const rx = x * S - ct.x, ry = y * S - ct.y, rz = z * S - ct.z; return { x: lv.x + av.y * rz - av.z * ry, y: lv.y + av.z * rx - av.x * rz, z: lv.z + av.x * ry - av.y * rx }; };
    const T0 = new THREE.Matrix4().makeTranslation(-this.p0.x, -this.p0.y, -this.p0.z), PT = new THREE.Matrix4().multiplyMatrices(P, T0);
    // where it struck: its lowest point
    let hit = null, lo = Infinity; for (const p of this.panels) for (const q of p.o.userData.hull || []) { const v = new THREE.Vector3(...q).applyMatrix4(PT); if (v.y < lo) { lo = v.y; hit = v; } }
    hit = hit || new THREE.Vector3(ct.x / S, ct.y / S, ct.z / S);
    const groups = (n, size, near) => {   // (clusters of up to size(i) members, grown over the near ones)
      const left = new Set(Array.from({ length: n }, (_, i) => i)), out = [];
      while (left.size) {
        const seed = [...left][Math.floor(rnd() * left.size)], g = [seed]; left.delete(seed);
        const want = size(seed);
        for (let k = 0; k < g.length && g.length < want; k++) for (const j of near(g[k])) { if (g.length >= want) break; if (left.has(j)) { left.delete(j); g.push(j); } }
        out.push(g);
      }
      return out;
    };
    // the walls: every unit where it is, then in chunks of every size — one block, a few, a slab of wall
    const pcs = [];
    for (const c of this.chunks) {
      const B = new THREE.Matrix4().multiplyMatrices(P, c.rel);
      for (const pc of c.pieces) { const m = new THREE.Matrix4().multiplyMatrices(B, pc.local), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); pcs.push({ pc, m, p, q, s, dens: pc.dens }); }
      W.removeRigidBody(c.body);
    }
    const near = (i) => pcs.map((_, j) => j).filter((j) => j !== i && pcs[j].p.distanceTo(pcs[i].p) < M(0.75));
    const size = (i) => { const d = pcs[i].p.distanceTo(hit) * S, u = rnd(); return d < 2.5 ? (u < 0.7 ? 1 : 2) : u < 0.4 ? 1 + Math.floor(rnd() * 2) : u < 0.8 ? 3 + Math.floor(rnd() * 6) : 9 + Math.floor(rnd() * 22); };
    const newChunks = [];
    for (const g of groups(pcs.length, size, near)) {
      const cen = g.reduce((a, i) => a.add(pcs[i].p), new THREE.Vector3()).multiplyScalar(1 / g.length), inv = new THREE.Matrix4().makeTranslation(-cen.x, -cen.y, -cen.z);
      const bd = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(cen.x * S, cen.y * S, cen.z * S).setLinearDamping(0.15).setAngularDamping(0.4).setCcdEnabled(g.length > 8));
      let mass = 0; const box = new THREE.Box3(), pieces = [];
      for (const i of g) {
        const q = pcs[i], hx = Math.max(0.01, q.s.x * S / 2 - 0.006), hy = Math.max(0.01, q.s.y * S / 2 - 0.006), hz = Math.max(0.01, q.s.z * S / 2 - 0.006);
        W.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation((q.p.x - cen.x) * S, (q.p.y - cen.y) * S, (q.p.z - cen.z) * S).setRotation(q.q).setDensity(q.dens).setFriction(0.8).setRestitution(0.02).setCollisionGroups((0x0004 << 16) | 0xfffd), bd);
        mass += q.dens * 8 * hx * hy * hz; box.expandByPoint(q.p);
        const local = new THREE.Matrix4().multiplyMatrices(inv, q.m);
        // (a single block near the blow: broken — its bits instead of it)
        if (g.length === 1 && q.p.distanceTo(hit) * S < 3.5 && rnd() < 0.45) { local.scale(new THREE.Vector3(0, 0, 0)); this._breakUnit(q, vel(q.p.x, q.p.y, q.p.z)); }
        pieces.push({ ...q.pc, local });
      }
      bd.setLinvel(vel(cen.x, cen.y, cen.z), true); bd.setAngvel({ x: av.x + (rnd() - 0.5) * 1.5, y: av.y + (rnd() - 0.5) * 0.6, z: av.z + (rnd() - 0.5) * 1.5 }, true);
      newChunks.push({ pieces, body: bd, c: cen, box, mass, free: true, under: [], over: [], str: 1, area: 0 }); this.bodies.push(bd); D.broken++;
    }
    D.chunks = [...D.chunks.filter((c) => !this.chunks.includes(c)), ...newChunks]; this.chunks = newChunks;
    // the slabs: their pieces in clusters held by the bars — small by the blow, larger off it
    const sl = this.panels.filter((p) => p.sort === 'slab'), cur = sl.map((p) => { const b = new THREE.Box3().setFromPoints((p.o.userData.hull || []).map((q) => new THREE.Vector3(...q).applyMatrix4(PT))); return b.getCenter(new THREE.Vector3()); });
    const nearS = (i) => sl.map((_, j) => j).filter((j) => j !== i && sl[j].o.userData.slab === sl[i].o.userData.slab && cur[j].distanceTo(cur[i]) < M(2.2));
    const sizeS = (i) => { const d = cur[i].distanceTo(hit) * S; return d < 2.5 ? 1 : d < 5 ? 1 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 5); };
    for (const g of groups(sl.length, sizeS, nearS)) {
      const cen = g.reduce((a, i) => a.add(cur[i]), new THREE.Vector3()).multiplyScalar(1 / g.length);
      const bd = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(cen.x * S, cen.y * S, cen.z * S).setLinearDamping(0.15).setAngularDamping(0.6).setCcdEnabled(true));
      for (const i of g) {
        const p = sl[i], pts = (p.o.userData.hull || []).map((q) => new THREE.Vector3(...q).applyMatrix4(PT).toArray());
        const desc = hullDesc(R, pts, cen); if (desc) W.createCollider(desc.setDensity(2400).setFriction(0.85).setRestitution(0.02).setCollisionGroups((0x0004 << 16) | 0xfffd), bd);
        W.removeRigidBody(p.body); p.body = bd; p.carry = false; p.free = true;
        p.off = new THREE.Matrix4().makeTranslation(-cen.x, -cen.y, -cen.z).multiply(PT);
      }
      bd.setLinvel(vel(cen.x, cen.y, cen.z), true); bd.setAngvel({ x: av.x * 0.6, y: av.y * 0.6, z: av.z * 0.6 }, true);
      this.bodies.push(bd);
    }
    // the rest (the fascias, the railings, the windows, the roof): each on its own; the thin skins onto the ground only
    for (const p of this.panels.filter((q) => q.sort !== 'slab')) {
      const m = new THREE.Matrix4().multiplyMatrices(P, p.rel), pos = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(pos, q, new THREE.Vector3());
      p.body.setTranslation({ x: pos.x * S, y: pos.y * S, z: pos.z * S }, true); p.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      const skin = p.sort === 'skin';
      for (let k = 0; k < p.body.numColliders(); k++) { const c = p.body.collider(k); c.setEnabled(true); c.setCollisionGroups(skin ? (0x0002 << 16) | 0x0001 : (0x0004 << 16) | 0xfffd); }
      p.body.setBodyType(R.RigidBodyType.Dynamic, true); p.body.setLinvel(vel(pos.x, pos.y, pos.z), true);
      p.carry = false; p.free = true; this.bodies.push(p.body);
    }
    W.removeRigidBody(this.body); this.body = null;
    // (the heap of the crushed shaft: something low the pieces lie on, not the invisible head)
    W.removeRigidBody(this.head); this.head = null;
    const hp = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(this.L.r.x * S, this.y0 * S + 0.25, this.L.r.z * S)); W.createCollider(R.ColliderDesc.cuboid(0.8, 0.25, 0.85).setFriction(0.9), hp);
    try { W.integrationParameters.numSolverIterations = 8; } catch { /* older API */ }
    sfx?.play?.('explosion', { vol: 0.7 }); sfx?.play?.('debris', { vol: 1 }); sfx?.play?.('glass_break', { vol: 0.9 });
    if (D.app.rig) D.app.rig.shakeAmp = 0.8;
    // the dust: first a ring out along the ground from the footprint (the air pushed out from under the slab), then rising, drifting
    const box = new THREE.Box3(); for (const c of newChunks) box.expandByPoint(c.c); for (const c of cur) box.expandByPoint(c);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, rx = (box.max.x - box.min.x) / 2 + M(0.5), rz = (box.max.z - box.min.z) / 2 + M(0.5);
    for (let i = 0; i < 56; i++) { const a = i / 56 * Math.PI * 2 + rnd() * 0.1, ex = Math.cos(a), ez = Math.sin(a), v = M(4 + rnd() * 2); D.puffs?.emit('ring', new THREE.Vector3(cx + ex * rx, D.groundY + M(0.2), cz + ez * rz), new THREE.Vector3(ex * v, 0, ez * v), 1); }
    for (let i = 0; i < 22; i++) D.puffs?.emit('rubble', new THREE.Vector3(cx + (rnd() - 0.5) * 2 * rx, D.groundY + rnd() * M(1), cz + (rnd() - 0.5) * 2 * rz), new THREE.Vector3(D.wdir.x * M(0.5), 0, D.wdir.z * M(0.5)), 0.9);
    // crumbs of concrete and block all along the line it struck
    const grey = new THREE.Color(0x9a9890), white = new THREE.Color(0xd8d6d0);
    for (let i = 0; i < 260; i++) { const a = rnd() * Math.PI * 2, r0 = rnd(); this.crumbs.add(new THREE.Vector3(cx + Math.cos(a) * rx * r0, D.groundY + M(0.3), cz + Math.sin(a) * rz * r0), new THREE.Vector3(Math.cos(a) * M(1 + rnd() * 2.5), M(0.5 + rnd() * 1.5), Math.sin(a) * M(1 + rnd() * 2.5)), MM(15 + rnd() * rnd() * 110), rnd() < 0.5 ? grey : white, M(0.3)); }
    for (const p of this.panes) { const at = p.root.getWorldPosition(new THREE.Vector3()); for (let q = 0; q < 6; q++) this.shards.add(at, new THREE.Vector3((rnd() - 0.5) * M(2), M(rnd()), (rnd() - 0.5) * M(2)), MM(5 + rnd() * 10), null, M(1)); }
  }
  // a block broken in the blow: its bits flying on with it
  _breakUnit(q, v) {
    const col = q.dens > 1000 ? new THREE.Color(0xa04c34) : new THREE.Color(0xe4e2dc), n = 3 + Math.floor(rnd() * 4), sz = Math.min(q.s.x, q.s.y, q.s.z);
    for (let k = 0; k < n; k++) this.crumbs.add(q.p, new THREE.Vector3(v.x / S * 0.3 + (rnd() - 0.5) * M(2), M(rnd() * 1.2), v.z / S * 0.3 + (rnd() - 0.5) * M(2)), sz * (0.45 + rnd() * 0.5), col, Math.max(q.s.x, q.s.z) * 0.6);
  }
  // drawing what rides in the house: its pose × each one's place in it
  drawCarried() {
    if (!this.ok || !this.body) return;
    const P = this._pose(), m = new THREE.Matrix4(), B = new THREE.Matrix4(), dirty = new Set();
    for (const c of this.chunks) { if (!c.carry) continue; B.multiplyMatrices(P, c.rel); for (const pc of c.pieces) { m.multiplyMatrices(B, pc.local); pc.cl.setMatrixAt(pc.i, m); dirty.add(pc.cl); } }
    for (const cl of dirty) cl.instanceMatrix.needsUpdate = true;
    for (const p of this.panels) { if (!p.carry) continue; B.multiplyMatrices(P, p.rel); p.o.matrix.multiplyMatrices(B, p.off); p.o.matrixWorldNeedsUpdate = true; if (p.sort === 'skin') p.o.visible = true; }
  }
  fx(dt) {
    if (!this.ok) return;
    const D = this.D, floor = (x, z) => D.app.terrain.heightAt(x, z);
    this.shards.update(dt, floor); this.crumbs.update(dt, floor);
    if (this.struck && D.t - this.strikeT < 5 && rnd() < 0.35 * (1 - (D.t - this.strikeT) / 5)) {
      const c = this.chunks[Math.floor(rnd() * this.chunks.length)]?.body.translation();
      if (c) D.puffs?.emit('rubble', new THREE.Vector3(c.x / S, D.groundY + rnd() * M(0.6), c.z / S), new THREE.Vector3(D.wdir.x * M(0.5), 0, D.wdir.z * M(0.5)), 0.7);
    }
    if (this.struck && D.app.rig) D.app.rig.shakeAmp = Math.max(0, 0.8 - (D.t - this.strikeT) * 1.2);
  }
  stop() {
    if (!this.ok) return;
    const g = this.L.g;
    for (const q of this.posts || []) { g.remove(q.m); q.m.geometry.dispose(); }
    for (const p of this.panes || []) { g.remove(p.root); p.root.traverse((o) => o.geometry?.dispose()); }
    for (const ch of g.children) { ch.visible = true; ch.scale.y = 1; }
    if (this.cab) { this.cab.rotation.set(0, 0, 0); this.cab.scale.y = 1; this.cab.position.y = this.cabY0; }
  }
}
