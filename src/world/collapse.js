import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { LIFT } from './lift.js';
import { isSlab } from '../tools/slab.js';
import { plan, toWorld } from '../tools/belt.js';

// «Обрушение опоры» (a catastrophe of its own kind, `shaft`): a house standing on a glass lift shaft comes
// down, as the realist describes such a failure (his lessons of build 274):
//   1. the posts go first, not the glass: each bows out between its ends in a half sine, the bow growing over
//      a second or two — the shaft shortens by it, the house sinks a little and leans 1–3° to its heavy side;
//   2. the frame racks and presses the panes at their corners: a crack runs in from a lower corner on the
//      diagonal and branches into a web; a pane whitens all at once (a frame) — laminated glass does not fly
//      apart: the PVB holds it, it sags and hangs folded in its plates; only crumbs fall (shards, 5–10 mm);
//   3. the posts fold (kinks, the walls of the tubes crumpling), the house goes as one body: it tips over the
//      edge it lies on, its fall the fall of a body (6,5 m in ≈ 1,15 s — real time, the physics' g);
//   4. it strikes: the cantilever first, the slabs break in pieces, the masonry flies in chunks, the fascias
//      crumple off, grey dust hangs 5–10 s and drifts; the camera shakes; the bounce is centimetres.
// The house is carried as one compound rigid body (its chunks' and panels' boxes) till it strikes; then each
// chunk and panel goes on as its own body with the speed it had there (v + ω × r). Nothing in the records
// changes (a show, as every catastrophe): «Вернуть как было» puts it all back.
const S = MODEL_SCALE, M = (v) => v / S, MM = (v) => v / 1000 / S;
const rnd = (() => { let s = 97531; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
// the timeline (s): the creak, the posts bowing (with the cracks), the panes whitening, the failure
export const SHAFT_T = { creak: 0.4, bow: 0.8, white: 2.5, fail: 3.1 };

// a crack web in a pane from its lower corner (u 0 or 1): the alpha the order a line appears in (an alphaTest
// going down from 1 shows it growing)
const _tex = [];
function crackTex(k) {
  if (_tex[k]) return _tex[k];
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n); g.lineCap = 'round';
  let x0 = 0x2f1d + k * 7919; const r = () => ((x0 = (x0 * 16807) % 2147483647) / 2147483647);
  const ox = k % 2 ? n - 4 : 4, oy = n - 4, rays = [];
  for (let q = 0; q < 11; q++) {
    // (from the corner, fanning over the pane; the main one on the diagonal, bright — first)
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

// the slabs as pieces (a catastrophe must not lose them: the view's cast concrete is one mesh): each cast slab
// cut into tiles ~2,5 m, each tile its cells merged row by row (the openings left out) — world placed meshes
export function slabPieces(objects) {
  const out = [], mat = new THREE.MeshStandardMaterial({ color: 0x9d9b95, roughness: 0.92 });
  for (const b of objects.all('belt')) {
    if (!isSlab(b) || !(b.fill > 0.5)) continue;
    const P = plan(b), on = (i, j) => i >= 0 && j >= 0 && i < b.ni && j < b.nj && P.index[j * b.ni + i] >= 0, c = b.c, T = Math.round(MM(2500) / c);
    const [ux, uz] = b.u, yaw = -Math.atan2(uz, ux), y0 = b.top, H = b.H;
    for (let tj = 0; tj < b.nj; tj += T) for (let ti = 0; ti < b.ni; ti += T) {
      const list = [];
      for (let j = tj; j < Math.min(b.nj, tj + T); j++) {
        let i0 = -1;
        for (let i = ti; i <= Math.min(b.ni, ti + T); i++) {
          const o = i < Math.min(b.ni, ti + T) && on(i, j);
          if (o && i0 < 0) i0 = i;
          if (!o && i0 >= 0) { const [x, z] = toWorld(b, (i0 + i) / 2 * c, (j + 0.5) * c); const g = new THREE.BoxGeometry((i - i0) * c, H, c); g.rotateY(yaw); g.translate(x, y0 + H / 2, z); list.push(g); i0 = -1; }
        }
      }
      if (!list.length) continue;
      const g = list.length > 1 ? mergeAll(list) : list[0], m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      out.push(m);
    }
  }
  return out;
}
function mergeAll(list) {
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

// the shards: tiny glass bits falling and lying (an instanced mesh, our own simple flight: g, a bounce, rest)
class Shards {
  constructor(root, n = 400) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0.3, 0.4, 0, 1], 3)); g.computeVertexNormals();
    this.m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xcfe6df, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), n);
    this.m.count = 0; this.m.frustumCulled = false; root.add(this.m);
    this.p = []; this.n = n;
  }
  burst(at, k, out) {
    for (let q = 0; q < k && this.p.length < this.n; q++) {
      const v = new THREE.Vector3(out.x * (0.5 + rnd()) + (rnd() - 0.5) * 0.8, rnd() * 0.6, out.z * (0.5 + rnd()) + (rnd() - 0.5) * 0.8).multiplyScalar(M(1.2));
      this.p.push({ x: at.x + (rnd() - 0.5) * M(0.6), y: at.y + (rnd() - 0.5) * M(1.5), z: at.z + (rnd() - 0.5) * M(0.6), v, s: MM(5 + rnd() * 10), r: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), w: (rnd() - 0.5) * 20, rest: false });
    }
  }
  update(dt, floor) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    this.p.forEach((s, i) => {
      if (!s.rest) {
        s.v.y -= M(9.81) * dt; s.x += s.v.x * dt; s.y += s.v.y * dt; s.z += s.v.z * dt; s.r.x += s.w * dt; s.r.z += s.w * 0.7 * dt;
        const f = floor(s.x, s.z);
        if (s.y < f) { s.y = f; if (Math.abs(s.v.y) < M(0.6)) { s.rest = true; s.r.x = Math.PI / 2 * Math.round(s.r.x / (Math.PI / 2)); } else { s.v.y *= -0.25; s.v.x *= 0.4; s.v.z *= 0.4; } }
      }
      q.setFromEuler(s.r); sc.setScalar(s.s); m4.compose(new THREE.Vector3(s.x, s.y + MM(1), s.z), q, sc); this.m.setMatrixAt(i, m4);
    });
    this.m.count = this.p.length; this.m.instanceMatrix.needsUpdate = true;
  }
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
    // what the shaft carries: every chunk and panel over its top (by its middle — the fascias hang 150 under the
    // slab's soffit; one left behind would hold the house up)
    const over = (b) => (b.min.y + b.max.y) / 2 > top - M(0.05) && b.max.y > top + M(0.1);
    this.chunks = D.chunks.filter((c) => over(c.box));
    this.panels = D.panels.filter((p) => over(p.box));
    const box = new THREE.Box3(); for (const c of this.chunks) box.union(c.box); for (const p of this.panels) box.union(p.box);
    if (box.isEmpty()) { this.ok = false; return; }
    // the house as one body: its boxes, its centre of mass; held (kinematic) till it fails
    let mx = 0, my = 0, mz = 0, mt = 0;
    const parts = [...this.chunks.map((c) => ({ b: c.box, m: c.mass, it: c })), ...this.panels.map((p) => ({ b: p.box, m: (p.sort === 'slab' ? 2400 : p.sort === 'roof' ? 120 : 300) * Math.max(1e-3, p.box.getSize(new THREE.Vector3()).toArray().reduce((a, v) => a * v * S, 1)), it: p }))];
    for (const q of parts) { const c = q.b.getCenter(new THREE.Vector3()); mx += c.x * q.m; my += c.y * q.m; mz += c.z * q.m; mt += q.m; }
    this.com = new THREE.Vector3(mx / mt, my / mt, mz / mt);
    this.p0 = this.com.clone();
    const body = (this.body = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.p0.x * S, this.p0.y * S, this.p0.z * S).setLinearDamping(0.02).setAngularDamping(0.1)));
    for (const q of parts) {
      const c = q.b.getCenter(new THREE.Vector3()), sz = q.b.getSize(new THREE.Vector3());
      const hx = Math.max(0.02, sz.x * S / 2), hy = Math.max(0.02, sz.y * S / 2), hz = Math.max(0.02, sz.z * S / 2), vol = 8 * hx * hy * hz;
      W.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation((c.x - this.p0.x) * S, (c.y - this.p0.y) * S, (c.z - this.p0.z) * S).setDensity(q.m / vol).setFriction(0.8).setRestitution(0.03), body);
      // (its own body asleep in the meantime: its colliders off — it rides in the house)
      const own = q.it.body; for (let k = 0; k < own.numColliders(); k++) own.collider(k).setEnabled(false);
      q.it.carry = true; q.it.rel = new THREE.Matrix4().makeTranslation((q.it.c?.x ?? c.x) - this.p0.x, (q.it.c?.y ?? c.y) - this.p0.y, (q.it.c?.z ?? c.z) - this.p0.z);
    }
    // the shaft's head as what the house lies on: a box the posts hold up, lowered as they bow and fold
    const [ux, uz] = r.u;
    this.head = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(r.x * S, top * S - 0.15, r.z * S));
    W.createCollider(R.ColliderDesc.cuboid(MM(r.w / 2 + 300) * S, 0.15, MM(r.d / 2 + 300) * S).setFriction(0.9), this.head);
    // (the heavy side: where the house's mass lies off the shaft — it leans and tips that way)
    let dx = this.com.x - r.x, dz = this.com.z - r.z; const dl = Math.hypot(dx, dz);
    if (dl < M(0.3)) { dx = ux; dz = uz; } else { dx /= dl; dz /= dl; }
    this.lean = new THREE.Vector3(dx, 0, dz); this.axis = new THREE.Vector3(dz, 0, -dx);   // (the tilt's axis: across the lean)
    this.top = top; this.y0 = r.y0; this.Hpost = (top - r.y0) * S * 1000;   // (mm)
    // the shaft's own parts as they fail: the posts (bending), the panes (cracking, whitening, sagging)
    this._failParts();
    this.shards = new Shards(D.root);
    this.drop = 0; this.tilt = 0; this.free = false; this.struck = false; this.said = {};
  }
  _failParts() {
    const g = this.L.g, ud = g.userData, P = LIFT.post, W = this.L.r.w / 2, D = this.L.r.d / 2, yH = this.Hpost;
    for (const ch of g.children) if (ch.name === 'frame' || ch.name === 'glass' || ch.name === 'edge' || ch.name === 'epdm') ch.visible = false;
    const fm = new THREE.MeshStandardMaterial({ color: 0x383d42, roughness: 0.5 });
    this.posts = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const geo = new THREE.BoxGeometry(P, yH - 50, P, 1, 40, 1); geo.translate(sx * (W - P / 2), 50 + (yH - 50) / 2, sz * (D - P / 2));
      const m = new THREE.Mesh(geo, fm); m.castShadow = true; g.add(m);
      this.posts.push({ m, base: geo.attributes.position.array.slice(), sx, sz });
    }
    // the panes: each its own glass and its crack web
    this.panes = [];
    (ud.panes || []).filter((q) => q[4] <= yH + 5).forEach((q, k) => {
      const [side, x0, x1, y0, y1, z0, z1] = q;
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xd6ebe6, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
      const pg = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), glass); pg.position.set((x0 + x1) / 2, y1, (z0 + z1) / 2); pg.geometry.translate(0, -(y1 - y0) / 2, 0); pg.renderOrder = 2;
      const cr = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(x1 - x0, z1 - z0), y1 - y0), new THREE.MeshBasicMaterial({ color: 0xeef3f1, alphaMap: crackTex(k % 4), alphaTest: 1, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      cr.geometry.translate(0, -(y1 - y0) / 2, 0);
      if (side === 'left' || side === 'right') cr.rotation.y = Math.PI / 2;
      cr.position.copy(pg.position).add(new THREE.Vector3(side === 'left' ? -12 : side === 'right' ? 12 : 0, 0, side === 'back' ? -12 : side === 'front' ? 12 : 0)); cr.renderOrder = 3;
      g.add(pg, cr);
      // (the lower panes first: the order they crack in)
      this.panes.push({ pg, cr, side, y0, y1, out: side === 'left' ? [-1, 0] : side === 'right' ? [1, 0] : side === 'back' ? [0, -1] : [0, 1], at: SHAFT_T.bow + 0.2 + (y0 / yH) * 1.2 + rnd() * 0.4, white: SHAFT_T.white + (y0 / yH) * 0.4 + rnd() * 0.25 });
    });
    this.headMesh = g.children.find((c) => c.name === 'head');
    this._own = new Set([...this.posts.map((q) => q.m), ...this.panes.flatMap((p) => [p.pg, p.cr])]);
  }
  // the posts' bow (mm at the middle) at time t; the kink once they fold
  _bow(t) { const T = SHAFT_T; return t < T.bow ? 0 : t < T.fail ? 70 * ((t - T.bow) / (T.fail - T.bow)) ** 2 + 180 * Math.max(0, (t - T.white) / (T.fail - T.white)) ** 3 : 250 + 650 * Math.min(1, (t - T.fail) / 0.9) ** 1.6; }
  _shape(t) {
    const A = this._bow(t), yH = this.Hpost, fold = Math.min(1, Math.max(0, (t - SHAFT_T.fail) / 0.55)) ** 1.4;
    // (shortening: the arc's length kept — a bow A over H takes ≈ π²A²/(4H) off its height; folded, the posts lie down)
    const short = Math.min(yH - 400, (Math.PI ** 2 * A * A) / (4 * yH) + fold * (yH - 600));
    for (const q of this.posts) {
      const pos = q.m.geometry.attributes.position, b = q.base;
      for (let i = 0; i < pos.count; i++) {
        const y = b[i * 3 + 1], u = Math.max(0, Math.min(1, (y - 50) / (yH - 50)));
        // (a half sine, sharpening into a kink below the middle as it folds — the tube crumpling there)
        const s = Math.sin(Math.PI * u) * (1 - fold) + fold * (1 - Math.abs(u - 0.45) / 0.55) ** 0.6;
        pos.setXYZ(i, b[i * 3] + q.sx * A * s * 0.7, 50 + (y - 50) * (1 - short / yH), b[i * 3 + 2] + q.sz * A * s * 0.7);
      }
      pos.needsUpdate = true; q.m.geometry.computeVertexNormals();
    }
    // (all the rest of the shaft — its rails, the cylinder, the cabin, its head — crushed down with the posts)
    const k = Math.max(0.06, 1 - short / yH);
    for (const ch of this.L.g.children) if (ch.visible && !this._own.has(ch) && ch.name !== 'cabinet' && ch.name !== 'conc') ch.scale.y = k;
    return short;
  }
  // each step of the physics (h s)
  load(h) {
    const D = this.D, t = D.t, T = SHAFT_T, sfx = D.app.sfx, R = D.R;
    if (!this.ok) return;
    const short = this._shape(t);
    // the sounds: the creak of steel, the ticks and the cracks of glass, the failure
    if (t > T.creak && !this.said.creak) { this.said.creak = true; sfx?.play?.('creak', { vol: 0.8, at: this.com }); }
    if (t > T.bow + 0.9 && !this.said.creak2) { this.said.creak2 = true; sfx?.play?.('creak', { vol: 1, at: this.com, rate: 0.8 }); }
    for (const p of this.panes) {
      const u = Math.max(0, Math.min(1, (t - p.at) / 0.9));
      p.cr.material.alphaTest = 1 - 0.75 * u;
      if (u > 0 && !p.ticked) { p.ticked = true; sfx?.play?.('glass', { vol: 0.35, rate: 1.4, gap: 0.08 }); }
      if (t > p.white && !p.whited) {
        // (it whitens at once — the web all over — and sags on its film)
        p.whited = true; p.cr.material.alphaTest = 0.02; p.pg.material.color.setHex(0xeaf0ee); p.pg.material.opacity = 0.62; p.cr.material.opacity = 0.95;
        sfx?.play?.('glass_break', { vol: 0.55, gap: 0.05 });
        const wp = new THREE.Vector3(((p.out[0] || 0)), 0, ((p.out[1] || 0)));
        this.shards.burst(p.pg.getWorldPosition(new THREE.Vector3()), 10, wp);
      }
      if (p.whited) {
        // (hanging folded in its plates: its height shrinking with the shaft, bellied out a little)
        const k = Math.max(0.15, 1 - short / this.Hpost), sag = Math.min(1, (t - p.white) / 1.2);
        p.pg.scale.y = p.cr.scale.y = k; p.pg.position.y = p.cr.position.y = p.y1 * (1 - short / this.Hpost);
        p.pg.rotation.x = p.cr.rotation.x = (p.out[1] || 0) * 0.25 * sag; p.pg.rotation.z = p.cr.rotation.z = -(p.out[0] || 0) * 0.25 * sag;
      }
    }
    // the house: held on the shaft — sinking with its shortening, leaning a little to its heavy side; then free
    const sinkM = short / 1000;   // (m)
    if (!this.free) {
      // (the lean grows with the bow: ≈ 2° by the failure — the realist's 1–3°)
      this.tilt = t < T.bow ? 0 : 0.035 * Math.min(1, (t - T.bow) / (T.fail - T.bow)) ** 2;
      const q = new THREE.Quaternion().setFromAxisAngle(this.axis, this.tilt);
      this.body.setNextKinematicTranslation({ x: this.p0.x * S, y: this.p0.y * S - sinkM, z: this.p0.z * S });
      this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      this.head.setNextKinematicTranslation({ x: this.L.r.x * S, y: this.top * S - 0.15 - sinkM - 0.02, z: this.L.r.z * S });
      if (t >= T.fail) {
        this.free = true;
        this.body.setBodyType(R.RigidBodyType.Dynamic, true);
        sfx?.play?.('collapse', { vol: 1, at: this.com }); sfx?.play?.('creak', { vol: 1, rate: 0.6 });
      }
    } else if (!this.struck) {
      // (the posts folding under it: the head going down and racking back from the heavy side — the house's
      // weight past its edge, it tips over it by itself; a kinematic box tilted would lift the house — it only moves)
      const u = Math.min(1, (t - T.fail) / 0.55), back = M(0.7) * S * u * u;
      this.head.setNextKinematicTranslation({ x: this.L.r.x * S - this.lean.x * back, y: Math.max(this.y0 * S - 0.4, this.top * S - 0.15 - sinkM - 0.02), z: this.L.r.z * S - this.lean.z * back });
      // the strike: its lowest point at the ground
      if (this._low() < D.groundY * S + 0.25 || t > T.fail + 3) this._strike();
    }
  }
  _pose() { const t = this.body.translation(), r = this.body.rotation(); return new THREE.Matrix4().compose(new THREE.Vector3(t.x / S, t.y / S, t.z / S), new THREE.Quaternion(r.x, r.y, r.z, r.w), new THREE.Vector3(1, 1, 1)); }
  _low() {
    const P = this._pose(); let lo = Infinity; const v = new THREE.Vector3();
    for (const c of this.chunks.length ? this.chunks : []) { v.copy(c.c).sub(this.p0).setY(c.box.min.y - this.p0.y).applyMatrix4(P); lo = Math.min(lo, v.y); }
    for (const p of this.panels) { v.copy(p.c).sub(this.p0).setY(p.box.min.y - this.p0.y).applyMatrix4(P); lo = Math.min(lo, v.y); }
    return lo * S;
  }
  // every piece on its own, with the speed it had there
  _strike() {
    const D = this.D, R = D.R, P = this._pose(), lv = this.body.linvel(), av = this.body.angvel(), ct = this.body.translation(), sfx = D.app.sfx;
    this.struck = true;
    const go = (it) => {
      const m = new THREE.Matrix4().multiplyMatrices(P, it.rel), pos = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(pos, q, new THREE.Vector3());
      it.body.setTranslation({ x: pos.x * S, y: pos.y * S, z: pos.z * S }, true); it.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      // (the thin skins — the fascias, the railings — wrap the slabs: their boxes overlap the slabs' and would throw
      // them apart; they fall onto the ground only. The rest collide with each other and the ground)
      const skin = it.sort === 'skin';
      for (let k = 0; k < it.body.numColliders(); k++) { const cl = it.body.collider(k); cl.setEnabled(true); cl.setCollisionGroups(skin ? (0x0002 << 16) | 0x0001 : (0x0004 << 16) | 0xfffd); }
      it.body.setBodyType(R.RigidBodyType.Dynamic, true);
      const rx = pos.x * S - ct.x, ry = pos.y * S - ct.y, rz = pos.z * S - ct.z;
      // (v + ω × r, a little scatter: what hits first stops, what is high goes on)
      it.body.setLinvel({ x: lv.x + av.y * rz - av.z * ry + (rnd() - 0.5) * 0.6, y: lv.y + av.z * rx - av.x * rz, z: lv.z + av.x * ry - av.y * rx + (rnd() - 0.5) * 0.6 }, true);
      it.body.setAngvel({ x: av.x + (rnd() - 0.5), y: av.y, z: av.z + (rnd() - 0.5) }, true);
      it.carry = false; it.free = true;
    };
    for (const c of this.chunks) { go(c); D.broken++; }
    for (const p of this.panels) go(p);
    D.world.removeRigidBody(this.body); this.body = null;
    // (a heap of many bodies struck at 9 m/s: more solver passes, CCD on the slabs — nothing pops through or up)
    try { D.world.integrationParameters.numSolverIterations = 8; } catch { /* older API */ }
    for (const p of this.panels) if (p.sort === 'slab') p.body.enableCcd?.(true);
    sfx?.play?.('explosion', { vol: 0.7 }); sfx?.play?.('debris', { vol: 1 }); sfx?.play?.('glass_break', { vol: 0.9 });
    if (D.app.rig) D.app.rig.shakeAmp = 0.8;
    this.strikeT = D.t;
    // the dust: a grey cloud from the whole footprint, hanging and drifting
    const box = new THREE.Box3(); for (const c of this.chunks) box.union(c.box); for (const p of this.panels) box.union(p.box);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, rx = (box.max.x - box.min.x) / 2, rz = (box.max.z - box.min.z) / 2;
    for (let i = 0; i < 60; i++) D.puffs?.emit('rubble', new THREE.Vector3(cx + (rnd() - 0.5) * 2 * rx + this.lean.x * M(3), D.groundY + rnd() * M(1.5), cz + (rnd() - 0.5) * 2 * rz + this.lean.z * M(3)), new THREE.Vector3(D.wdir.x * M(0.4), 0, D.wdir.z * M(0.4)), 1);
    this.shards.burst(new THREE.Vector3(cx, D.groundY + M(1), cz), 160, new THREE.Vector3(this.lean.x, 0, this.lean.z));
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
    const D = this.D;
    // (masonry does not bounce: the first 4 s after the strike nothing goes up faster than 0,6 m/s (≈ 2 cm) —
    // a stacked heap's solver kicks are not a bounce; the realist: «the bounce — centimetres»)
    if (this.struck && D.t - this.strikeT < 4) for (const it of [...this.chunks, ...this.panels]) { const v = it.body.linvel(); if (v.y > 0.6) it.body.setLinvel({ x: v.x * 0.9, y: 0.6, z: v.z * 0.9 }, true); }
    this.shards.update(dt, (x, z) => D.app.terrain.heightAt(x, z));
    // (the dust keeps coming off the heap a while, less and less, drifting with the wind)
    if (this.struck && D.t - this.strikeT < 6 && rnd() < 0.5 * (1 - (D.t - this.strikeT) / 6)) {
      const c = this.com; D.puffs?.emit('rubble', new THREE.Vector3(c.x + this.lean.x * M(3) + (rnd() - 0.5) * M(9), D.groundY + rnd() * M(0.8), c.z + this.lean.z * M(3) + (rnd() - 0.5) * M(9)), new THREE.Vector3(D.wdir.x * M(0.5), 0, D.wdir.z * M(0.5)), 0.8);
    }
    if (this.struck && D.app.rig) D.app.rig.shakeAmp = Math.max(0, 0.8 - (D.t - this.strikeT) * 1.2);
  }
  stop() {
    if (!this.ok) return;
    const g = this.L.g;
    for (const q of this.posts || []) { g.remove(q.m); q.m.geometry.dispose(); }
    for (const p of this.panes || []) { g.remove(p.pg); g.remove(p.cr); p.pg.geometry.dispose(); p.cr.geometry.dispose(); }
    for (const ch of g.children) ch.visible = true;
    for (const ch of g.children) ch.scale.y = 1;
  }
}
