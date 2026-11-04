import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadModel, normalise, findNode } from './machines/models.js';

// The excavator (a modelled crawler excavator, CC BY — CREDITS.md), at 0,8 of its size (a ≈13 t machine:
// tracks 3,6 m, the cab's roof 2,5 m up). Rigged offline (rig2.mjs, scratchpad) on the model's own parts
// and their real pins: under (the tracks), house (turns on them: the swing), boom (on its foot at the
// front of the house), stick (on the boom's nose), bucket (on the stick's end). Each hydraulic cylinder is
// two pieces — the barrel on one part, the rod on the other, each on its pin with its axis along +Z — aimed
// at each other every frame: as a joint turns the rod slides in or out of its barrel, as on the machine.
// Local +x forward, y up.   swing, boom, stick, curl (rad from the model's pose) and their goals; load 0…1.
const R = (m) => m / MODEL_SCALE, SIZE = 0.8;
const CYLS = ['boomL', 'boomR', 'stick', 'bucket'];
// a part's own points (world): not those of the parts hung on it (skip), nor the cylinders
function pointsOf(obj, n = 4000, skip = null) {
  obj.updateMatrixWorld(true);
  const pts = [], v = new THREE.Vector3();
  const walk = (o) => {
    if (o !== obj && (skip?.has(o) || o.name.startsWith('cyl_'))) return;
    if (o.isMesh) { const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / n)); for (let i = 0; i < p.count; i += step) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone()); }
    for (const c of o.children) walk(c);
  };
  walk(obj);
  return pts;
}

// points over a part's surfaces, by their area (a plate's vertices are only at its edges; its middle is where the
// soil lies against it) — world; at most n
function surfacePoints(obj, n = 4000) {
  obj.updateMatrixWorld(true);
  const tris = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let tot = 0;
  obj.traverse((o) => {
    if (!o.isMesh || o.name.startsWith('cyl_')) return;
    for (let p = o.parent; p && p !== obj; p = p.parent) if (p.name.startsWith('cyl_')) return;
    const g = o.geometry, P = g.attributes.position; if (!P) return; const I = g.index, k = I ? I.count : P.count;
    for (let i = 0; i < k; i += 3) {
      a.fromBufferAttribute(P, I ? I.getX(i) : i).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(P, I ? I.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(P, I ? I.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2; if (ar <= 0) continue;
      tris.push([a.clone(), b.clone(), c.clone(), ar]); tot += ar;
    }
  });
  const out = [];
  let x = 0x1234567; const r = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  for (const [A, B, C, ar] of tris) {
    let m = ar / tot * n; while (m > 0) { if (m < 1 && r() > m) break; let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; } out.push(A.clone().add(B.clone().sub(A).multiplyScalar(u)).add(C.clone().sub(A).multiplyScalar(v))); m -= 1; }
  }
  return out;
}

export class Excavator {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'excavator';
    this.x = 0; this.z = 0; this.yaw = 0; this.y = 0; this.pitch = 0; this.roll = 0; this.heave = 0;
    // (parked as a driver leaves it: the boom a little up, the bucket clear of the ground)
    this.swing = 0; this.boom = 0.3; this.stick = 0; this.curl = 0;
    this.swingGoal = 0; this.boomGoal = 0.3; this.stickGoal = 0; this.curlGoal = 0;
    this.load = 0; this.spin = 0;
    this.ready = this._build();
  }
  async _build() {
    const { scene } = await loadModel('excavator');
    // (the model is in metres: scaled to the plot's units, at 0,8)
    const h = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).y;
    const { holder } = normalise(scene, { forward: '+z', height: R(h * SIZE), pivot: findNode(scene, 'under') });
    this.body = holder; this.root.add(holder);
    this.root.updateMatrixWorld(true);
    this.under = findNode(scene, 'under'); this.house = findNode(scene, 'house'); this.boomP = findNode(scene, 'boom'); this.stickP = findNode(scene, 'stick'); this.bucketP = findNode(scene, 'bucket');
    this.cyl = CYLS.map((n) => ({ b: findNode(scene, `cyl_${n}_b`), r: findNode(scene, `cyl_${n}_r`) })).filter((c) => c.b && c.r);
    // (a part's own meshes: not those of the parts hung on it)
    const parts = new Set([this.under, this.house, this.boomP, this.stickP, this.bucketP]);
    const only = (n) => { const g = new THREE.Box3(), walk = (o) => { if (o.isMesh) g.expandByObject(o); for (const c of o.children) if (!parts.has(c) && !c.name.startsWith('cyl_')) walk(c); }; n.updateMatrixWorld(true); walk(n); return g; };
    const ub = only(this.under);
    holder.position.y -= ub.min.y; this.root.updateMatrixWorld(true); ub.translate(new THREE.Vector3(0, -ub.min.y, 0));
    this.track = { x0: ub.min.x, x1: ub.max.x, w: ub.max.z - ub.min.z };
    // the bucket: its cutting edge (the teeth' tips — the lowest front points at rest), its width; the
    // points of its shell (what may not go through the ground) and of the stick's lower end
    const kp = pointsOf(this.bucketP), kb = new THREE.Box3().setFromPoints(kp), toB = (q) => this.bucketP.worldToLocal(q.clone());
    // (built facing +x: the bucket's width along z — the edge's middle taken across it)
    // (the teeth' tips: the points of the bucket farthest from its pin)
    const pin = this.bucketP.getWorldPosition(new THREE.Vector3());
    let best = -Infinity, tip = null; for (const q of kp) { const v = Math.hypot(q.x - pin.x, q.y - pin.y); if (v > best) { best = v; tip = q.clone(); } }
    // (not simply the point farthest from the pin — that may be the heel: the teeth are the far end of its opening, the
    // long side of its outline with no plate along it)
    this._kpL = surfacePoints(this.bucketP).map(toB);
    { const m = this._mouth(); if (m) tip = this.bucketP.localToWorld(new THREE.Vector3(0, m[0][0], m[0][1])); }
    tip.z = (kb.min.z + kb.max.z) / 2;
    this.teeth = toB(tip);
    this.bucketW = (kb.max.z - kb.min.z) * 0.9;
    // (the shell: points spread over it, the cutting edge — the teeth along all the bucket's width — left out:
    // the teeth may cut)
    const shell = [];
    for (let i = 0; i < kp.length; i += Math.max(1, Math.floor(kp.length / 200))) if (Math.hypot(kp[i].x - tip.x, kp[i].y - tip.y) > R(0.22)) shell.push(toB(kp[i]));
    this.shell = shell;
    const sp = pointsOf(this.stickP, 800, parts), sMin = Math.min(...sp.map((q) => q.y));
    this.stickLow = sp.filter((q) => q.y < sMin + R(0.15)).map((q) => this.stickP.worldToLocal(q.clone()));
    // the hollow: between the pin and the teeth, toward the bottom of the C (the shell's point farthest
    // from that line) — not the middle of all its points: the links on its back pulled that out to the pin
    { const Pn = new THREE.Vector3(), T = this.teeth.clone(), d = T.clone().sub(Pn), dl = d.length() || 1, mid = d.clone().multiplyScalar(0.5);
      let far = null, fd = -1; for (const q of this.shell) { const r = q.clone(), t = r.dot(d) / (dl * dl); if (t < 0.15 || t > 0.95) continue; const off = r.clone().sub(d.clone().multiplyScalar(t)); off.x = 0; const l = off.length(); if (l > fd) { fd = l; far = off; } }
      this.hollow = mid.clone(); if (far) this.hollow.addScaledVector(far, 0.3);
      this.hollow.x = T.x;
      this.cupR = dl; }
    this.mouth = this.hollow.clone().lerp(this.teeth, 0.25);
    // the soil in it: a lumpy heap of clods filling the hollow, its top bulging out of the opening as a full
    // bucket's does (smaller than the bucket's width: its sides stay inside the side plates)
    // (welded first: an icosahedron's faces have their own vertices — its normals would be flat, faceted)
    let geo = new THREE.IcosahedronGeometry(1, 4); geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo);
    const pa = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); const n = 1 + 0.16 * Math.sin(v.x * 9.1 + v.y * 4.3) * Math.cos(v.z * 7.7 - v.y * 3.1) + 0.08 * Math.sin(v.x * 23 + v.z * 19); pa.setXYZ(i, v.x * n, v.y * n, v.z * n); }
    geo.computeVertexNormals();
    this.soil = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x5e4630, roughness: 1 }));
    this.soil.visible = false; this.bucketP.add(this.soil); void geo;
    this._section();
    const ws = this.bucketP.getWorldScale(new THREE.Vector3()).x, bs = kb.getSize(new THREE.Vector3()), across = bs.z / ws;   // (its frame: x across, y up, z along the arm)
    this.soilR = { a: across * 0.36, d: this.cupR * 0.3 };
    // the bucket's cylinder: it lies along the stick (its rod works the linkage, not the bucket itself) — the
    // rod on the stick, sliding out of its barrel as the bucket is curled in; the boom's and the stick's
    // cylinders join two parts and are aimed at each other's pins. The joints go only as far as the
    // cylinders' stroke lets them (the rod never out of its barrel, never through its end)
    this._rigCylinders();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this._aim();
    return this;
  }
  // The bucket's inside as a section (its own y, z; x is across it): the outline of its shell, a little in from
  // it, and its opening — the edge of the outline from the teeth with nothing along it (the cut side). What it
  // holds as it is turned: the soil lies level in it (the free surface of a loose fill, a heap on top when the
  // opening faces up) — up to its lower lip; more runs out over the lip.
  // the bucket's opening from its surfaces (its own y, z): [the teeth (the far end from the pin), the lip], the outline
  _mouth() {
    const src = this._kpL; if (!src?.length) return null;
    const dmax = Math.max(...src.map((q) => Math.hypot(q.y, q.z))), body = src.filter((q) => Math.hypot(q.y, q.z) > dmax * 0.3);
    const xs = body.map((q) => q.x), xm = (Math.min(...xs) + Math.max(...xs)) / 2, xw = Math.max(...xs) - Math.min(...xs);
    const pts = body.map((q) => [q.y, q.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = []; for (const p of pts) { while (lo.length > 1 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); } for (const p of [...pts].reverse()) { while (hi.length > 1 && cr(hi.at(-2), hi.at(-1), p) <= 0) hi.pop(); hi.push(p); }
    const hull = [...lo.slice(0, -1), ...hi.slice(0, -1)], n = hull.length;
    // (the wrapper plate: the middle band of its width; an edge is open if nothing of it lies along it)
    const band = body.filter((q) => Math.abs(q.x - xm) < xw * 0.3).map((q) => [q.y, q.z]);
    // (covered: the share of its length with plate along it, in 20 bins — an edge is open if less than 30 % is)
    const open = hull.map((a, i) => { const b = hull[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, bins = new Set(); for (const q of band) { const u = ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / (L * L); if (u < 0 || u > 1) continue; if (Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) / L < dmax * 0.05) bins.add(Math.min(19, Math.floor(u * 20))); } return { k: L > dmax * 0.05 && bins.size >= 6 ? 1 : 0, L, i }; });
    // (the longest run of open edges)
    let bestRun = null;
    for (let s0 = 0; s0 < n; s0++) { if (open[s0].k > 0 || open[(s0 - 1 + n) % n].k === 0) continue; let L = 0, e = s0; while (open[e % n].k === 0 && e - s0 < n) { L += open[e % n].L; e++; } if (!bestRun || L > bestRun.L) bestRun = { s: s0, e: e % n, L }; }
    if (!bestRun) return null;
    const A = hull[bestRun.s], B = hull[bestRun.e], far = Math.hypot(...A) > Math.hypot(...B) ? A : B, near = far === A ? B : A;
    this._mouthRun = { hull, s: bestRun.s, e: bestRun.e };
    return [far, near];
  }
  _section() {
    const M = this._mouthRun || (this._mouth(), this._mouthRun);
    if (!M) { this.sec = null; return; }
    // (the outline without the open run's vertices — the opening is the chord between the teeth and the lip — a little
    // in from the plates)
    const { hull, s, e } = M, n = hull.length, keep = [];
    for (let k = 0, i = e; k < n; k++, i = (i + 1) % n) { keep.push(hull[i]); if (i === s) break; }
    const c = keep.reduce((a, p) => [a[0] + p[0] / keep.length, a[1] + p[1] / keep.length], [0, 0]), sh = (p) => [c[0] + (p[0] - c[0]) * 0.9, c[1] + (p[1] - c[1]) * 0.9];
    const poly = keep.map(sh), A = sh(hull[s]), B = sh(hull[e]), teethFirst = Math.hypot(...hull[s]) > Math.hypot(...hull[e]);
    this.sec = poly; this.lips = teethFirst ? [A, B] : [B, A];
    const area = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
    this._area = area;
    const L = Math.hypot(this.lips[1][0] - this.lips[0][0], this.lips[1][1] - this.lips[0][1]);
    this.heapMax = L * L / 4 * Math.tan(25 * Math.PI / 180);   // (a heap at its angle of repose over the opening)
    this.secRef = area(poly) + this.heapMax;
    this.chord = L;
    const ws = this.bucketP.getWorldScale(new THREE.Vector3()).x, kb = new THREE.Box3().setFromPoints(this.shell);
    this.secW = (kb.max.x - kb.min.x) * 0.86; this.secX = (kb.max.x + kb.min.x) / 2; void ws;
  }
  // which way is up in the bucket's section (its own y, z): the world's up brought into it
  _upLocal() { this.root.updateMatrixWorld(true); const q = this.bucketP.getWorldQuaternion(new THREE.Quaternion()).invert(), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q); const l = Math.hypot(u.y, u.z) || 1; return [u.y / l, u.z / l]; }
  // the section's part under a level h (heights along up)
  _below(up, h) {
    const f = (p) => p[0] * up[0] + p[1] * up[1] - h, out = [], P = this.sec;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], fa = f(a), fb = f(b); if (fa <= 0) out.push(a); if ((fa <= 0) !== (fb <= 0)) { const u = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); } }
    return out;
  }
  // how much it holds turned as it is now, as a share of what it holds upright and heaped (0 … 1)
  holdShare() {
    if (!this.sec) return 1;
    const up = this._upLocal(), H = (p) => p[0] * up[0] + p[1] * up[1], lip = Math.min(H(this.lips[0]), H(this.lips[1]));
    const A = this._area(this._below(up, lip));
    // (the heap: only when the opening faces up — its chord level, more or less)
    const d = [this.lips[1][0] - this.lips[0][0], this.lips[1][1] - this.lips[0][1]], L = Math.hypot(...d), tilt = Math.abs(H(d)) / L, mid = [(this.lips[0][0] + this.lips[1][0]) / 2, (this.lips[0][1] + this.lips[1][1]) / 2];
    const c = this.sec.reduce((a, p) => [a[0] + p[0] / this.sec.length, a[1] + p[1] / this.sec.length], [0, 0]), opensUp = H(mid) > H(c);
    const heap = opensUp ? this.heapMax * Math.max(0, 1 - tilt * 2.2) : 0;
    return Math.min(1, (A + heap) / this.secRef);
  }
  // the lip it runs out over (world): the lower end of its opening
  // (u −1 … 1: across its width — what runs out comes off all along the lip, a curtain)
  lipWorld(out = new THREE.Vector3(), u = 0) {
    const up = this._upLocal(), H = (p) => p[0] * up[0] + p[1] * up[1], l = H(this.lips[0]) < H(this.lips[1]) ? this.lips[0] : this.lips[1];
    return out.set(this.secX + u * this.secW / 2 * 0.9, l[0], l[1]).applyMatrix4(this.bucketP.matrixWorld);
  }
  // the soil in it (share of a heaped bucket): level in it, a heap on top — extruded across its width
  _fill(share) {
    if (!this.sec) return;
    const up = this._upLocal(), H = (p) => p[0] * up[0] + p[1] * up[1], hs = this.sec.map(H), want = share * this.secRef;
    const lip = Math.min(H(this.lips[0]), H(this.lips[1])), Alip = this._area(this._below(up, lip));
    let poly;
    if (want <= Alip) {
      let a = Math.min(...hs), b = lip; for (let k = 0; k < 24; k++) { const m = (a + b) / 2; if (this._area(this._below(up, m)) < want) a = m; else b = m; }
      poly = this._below(up, (a + b) / 2);
    } else {
      // (level to the lip, then a heap over it: a parabola across the opening, its height for the rest)
      poly = this._below(up, lip);
      const extra = want - Alip, [e0, e1] = this.lips, L = this.chord, Hh = Math.min(L * 0.45, 1.5 * extra / L), n = 9, mound = [];
      for (let k = 1; k < n; k++) { const u = k / n, bump = 4 * u * (1 - u) * Hh; mound.push([e0[0] + (e1[0] - e0[0]) * u + up[0] * bump, e0[1] + (e1[1] - e0[1]) * u + up[1] * bump]); }
      // (inserted between the two lips where the outline runs from one to the other)
      const i0 = poly.findIndex((p) => Math.hypot(p[0] - e0[0], p[1] - e0[1]) < 1e-6), i1 = poly.findIndex((p) => Math.hypot(p[0] - e1[0], p[1] - e1[1]) < 1e-6);
      if (i0 >= 0 && i1 >= 0) { if ((i0 + 1) % poly.length === i1) poly.splice(i1, 0, ...mound); else if ((i1 + 1) % poly.length === i0) poly.splice(i0, 0, ...mound.reverse()); }
    }
    if (poly.length < 3) { this.soil.visible = false; return; }
    // (an extruded section; its top a little lumpy)
    const w = this.secW / 2, x0 = this.secX - w, x1 = this.secX + w, pos = [], cy = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const lump = (p, x) => { const h = H(p) - Math.min(...hs); return 1 + 0.035 * Math.sin(x * 40 + p[0] * 31) * Math.cos(p[1] * 27) * Math.min(1, h * 30); };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      for (const [xa, xb] of [[x0, x1]]) { pos.push(xa, a[0], a[1], xb, b[0], b[1], xb, a[0], a[1], xa, a[0], a[1], xa, b[0], b[1], xb, b[0], b[1]); }
      pos.push(x0, cy, cz, x0, b[0], b[1], x0, a[0], a[1], x1, cy, cz, x1, a[0], a[1], x1, b[0], b[1]);
    }
    for (let i = 0; i < pos.length; i += 3) { const k = lump([pos[i + 1], pos[i + 2]], pos[i]); pos[i + 1] = cy + (pos[i + 1] - cy) * k; pos[i + 2] = cz + (pos[i + 2] - cz) * k; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    this.soil.geometry.dispose(); this.soil.geometry = g; this.soil.position.set(0, 0, 0); this.soil.scale.set(1, 1, 1); this.soil.visible = true;
  }
  get loaded() { return !!this.bucketP; }
  soilColor(c) { this.soil?.material.color.copy(c); }
  teethWorld(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.copy(this.teeth).applyMatrix4(this.bucketP.matrixWorld); }
  mouthWorld(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.copy(this.mouth).applyMatrix4(this.bucketP.matrixWorld); }
  // the points that may not go into the ground: the bucket's shell (not its teeth) and the stick's end
  hardPoints() {
    this.root.updateMatrixWorld(true);
    const out = [];
    for (const q of this.shell) out.push(q.clone().applyMatrix4(this.bucketP.matrixWorld));
    for (const q of this.stickLow) out.push(q.clone().applyMatrix4(this.stickP.matrixWorld));
    return out;
  }
  // the stick's end alone (world)
  stickPoints() { this.root.updateMatrixWorld(true); return this.stickLow.map((q) => q.clone().applyMatrix4(this.stickP.matrixWorld)); }
  // the bucket's shell alone (world)
  shellPoints() { this.root.updateMatrixWorld(true); return this.shell.map((q) => q.clone().applyMatrix4(this.bucketP.matrixWorld)); }
  // the way the teeth go as the bucket is curled in (world) — the way they point, the way a bucket cuts
  cutDir(out = new THREE.Vector3()) {
    const t0 = this.teethWorld(new THREE.Vector3()), c = this.curl; this.bucketP.rotation.x = c + 0.02; const t1 = this.teethWorld(new THREE.Vector3()); this.bucketP.rotation.x = c; this.root.updateMatrixWorld(true);
    return out.copy(t1).sub(t0).normalize();
  }
  // the way the cutting edge faces (world): from the bucket's hollow out through its teeth
  edgeDir(out = new THREE.Vector3()) { const t = this.teethWorld(), m = this.mouthWorld(); return out.copy(t).sub(m).normalize(); }
  // the bucket's opening faces down (the soil falls out) — its curl opened past the stick's line
  get open() { return this.curl < -0.6; }
  // the joints as they are now / set back (a move the ground did not let happen)
  pose() { return [this.swing, this.boom, this.stick, this.curl, this.heave]; }
  setPose(p) { [this.swing, this.boom, this.stick, this.curl, this.heave] = p; this._apply(); }
  // stand on the ground at (x, z) facing yaw: height and tilt from under the tracks' four ends
  place(terrain, x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this._terrain = terrain;
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz);
    const T = this.track;
    if (T) {
      const fx = T.x1 * 0.8, bx = T.x0 * 0.8, hz = T.w * 0.4;
      const hf = (at(fx, -hz) + at(fx, hz)) / 2, hb = (at(bx, -hz) + at(bx, hz)) / 2, hl = (at(fx, -hz) + at(bx, -hz)) / 2, hr = (at(fx, hz) + at(bx, hz)) / 2;
      this.pitch = Math.atan2(hf - hb, fx - bx); this.roll = Math.atan2(hl - hr, 2 * hz);
      this.y = Math.max(hf, hb, hl, hr) - Math.abs(hf - hb) * 0.25;
    } else this.y = terrain.heightAt(x, z);
    this._seat();
  }
  // (the body on the ground: its tilt, and the heave — the front lifted off the ground on the rear of the
  // tracks when the boom presses the bucket down on it)
  _seat() {
    const T = this.track, rx = T ? T.x0 * 0.85 : 0, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(0, 0, 0); this.root.rotateY(this.yaw); this.root.rotateZ(this.pitch); this.root.rotateX(this.roll);
    if (this.heave > 1e-4) {
      // (turned up about the rear end of the tracks)
      const p = new THREE.Vector3(this.x + c * rx, this.y, this.z - s * rx), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-s, 0, -c), -this.heave);
      this.root.position.sub(p).applyQuaternion(q).add(p); this.root.quaternion.premultiply(q);
    }
  }
  // the joints' limits (rad from the model's pose: the boom up, the stick hanging, the bucket curled)
  static LIM = { boom: [-0.55, 0.5], stick: [-0.95, 0.55], curl: [-1.7, 1.25] };   // (the curl's own end: its cylinder's stroke — _rigCylinders)
  _rigCylinders() {
    // (a piece's length along its +Z from its pin, in its own frame — the meshes' boxes brought into it: their
    // positions may be quantized, scaled by their own nodes)
    const lenZ = (o) => { this.root.updateMatrixWorld(true); const inv = o.matrixWorld.clone().invert(), b = new THREE.Box3(); o.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld))); } }); return b.max.z - Math.max(0, b.min.z); };
    this.lim = { boom: [...Excavator.LIM.boom], stick: [...Excavator.LIM.stick], curl: [...Excavator.LIM.curl] };
    for (const c of this.cyl) { c.Lb = lenZ(c.b); c.Lr = lenZ(c.r); }
    // (the bucket's cylinder: its barrel on the stick, its rod's pin on the bucket — both aimed at each other, as the boom's)
    // (the strokes: each joint swept from its rest; where its cylinder would come apart or bottom out — its end)
    const dist = (c) => { this.root.updateMatrixWorld(true); return c.b.getWorldPosition(new THREE.Vector3()).distanceTo(c.r.getWorldPosition(new THREE.Vector3())) / c.b.getWorldScale(new THREE.Vector3()).x; };   // (in the model's metres)
    for (const [j, names] of [['boom', ['cyl_boomL_b', 'cyl_boomR_b']], ['stick', ['cyl_stick_b']], ['curl', ['cyl_bucket_b']]]) {
      const cs = this.cyl.filter((c) => names.includes(c.b.name)); if (!cs.length) continue;
      const keep = this[j], d0 = cs.map(dist);
      const ok = () => cs.every((c, k) => { const d = dist(c), lo = Math.min(d0[k], Math.max(c.Lb, c.Lr)) * 0.98, hi = Math.max(d0[k], c.Lb + c.Lr - 0.12 * c.Lb); return d >= lo && d <= hi; });
      for (const sd of [-1, 1]) { let a = 0; while (Math.abs(a) < 1.6) { const n = a + sd * 0.02; this[j] = n; this._applyJoints(); if (!ok()) break; a = n; } this.lim[j][sd < 0 ? 0 : 1] = sd < 0 ? Math.max(this.lim[j][0], a) : Math.min(this.lim[j][1], a); }
      this[j] = keep; this._applyJoints();
    }
  }
  _applyJoints() { this.house.rotation.y = this.swing; this.boomP.rotation.x = -this.boom; this.stickP.rotation.x = this.stick; this.bucketP.rotation.x = this.curl; }
  update(dt) {
    if (!this.bucketP) return;
    const k = 1 - Math.exp(-dt * 6), L = this.lim || Excavator.LIM, cl = (v, [a, b]) => Math.max(a, Math.min(b, v));
    this.boomGoal = cl(this.boomGoal, L.boom); this.stickGoal = cl(this.stickGoal, L.stick); this.curlGoal = cl(this.curlGoal, L.curl);
    this.swing += (this.swingGoal - this.swing) * k; this.boom += (this.boomGoal - this.boom) * k; this.stick += (this.stickGoal - this.stick) * k; this.curl += (this.curlGoal - this.curl) * k;
    this._apply();
    if (this.load > 0.02) this._fill(this.load); else this.soil.visible = false;
  }
  _apply() {
    this._applyJoints();
    if (this._terrain) this._seat();
    this._aim();
  }
  // each cylinder's barrel and rod pointed at each other's pin
  _aim() {
    if (!this.cyl?.length) return;
    this.root.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const c of this.cyl) {
      if (c.slide) { c.r.position.copy(c.r0).addScaledVector(c.dir, -0.26 * this.curl); continue; }   // (≈ 0,6 m of stroke over the curl's range)
      c.b.getWorldPosition(a); c.r.getWorldPosition(b); c.b.lookAt(b); c.r.lookAt(a);
    }
  }
}
