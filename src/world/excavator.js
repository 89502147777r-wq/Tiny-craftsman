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
    this._logo(scene);
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
    this.soil = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x5e4630, roughness: 1, vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
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
    this.chord = L; this._c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
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
  // the soil's top as it lies turned as it is: not level like water — it keeps its place in the bucket (its top along
  // the opening) till the tilt passes its angle of repose (~38°, dug soil), then lies at that angle; it runs out over the
  // teeth only (the back of the opening, at the pin, is closed by the stick and the linkage: curled in, a full heap
  // leans on them); tipped toward the teeth the heap over the opening keeps what the repose lets it; facing down —
  // what is under the lower lip. f(p) ≤ 0: under the top through the teeth; heap: the share of the heap it keeps
  _surface(up) {
    const H = (p) => p[0] * up[0] + p[1] * up[1], [t0, b0] = this.lips, L = this.chord, phi = 38 * Math.PI / 180;
    let h = [up[1], -up[0]]; if (h[0] * (b0[0] - t0[0]) + h[1] * (b0[1] - t0[1]) < 0) h = [-h[0], -h[1]];
    const D = (p) => p[0] * h[0] + p[1] * h[1], c = this._c, mid = [(t0[0] + b0[0]) / 2, (t0[1] + b0[1]) / 2];
    const th = Math.atan2(H(b0) - H(t0), Math.max(1e-9, D(b0) - D(t0)));   // (+: the back higher than the teeth)
    if (H(mid) <= H(c)) { const lo = Math.min(H(t0), H(b0)); return { H, k: 0, at: lo, heap: 0, lip: (p) => H(p) - lo }; }
    const k = Math.tan(Math.max(-phi, Math.min(phi, th))), g = (p) => H(p) - k * D(p), at = g(t0);
    let heap = 1; if (th > 0) { const A = phi - th, B = phi + th; heap = A <= 0 ? 0 : (Math.sin(A) * Math.sin(B) / (2 * Math.sin(A + B))) / (Math.tan(phi) / 4); }
    return { H, k, D, g, at, heap, lip: (p) => g(p) - at };
  }
  // the section's part where fn ≤ 0
  _belowF(fn) {
    const out = [], P = this.sec;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], fa = fn(a), fb = fn(b); if (fa <= 0) out.push(a); if ((fa <= 0) !== (fb <= 0)) { const u = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); } }
    return out;
  }
  // how much it holds turned as it is now, as a share of what it holds upright and heaped (0 … 1)
  holdShare() {
    if (!this.sec) return 1;
    const S = this._surface(this._upLocal());
    return Math.min(1, (this._area(this._belowF(S.lip)) + this.heapMax * S.heap) / this.secRef);
  }
  // which way what runs out leaves the lip (world, unit): along the bottom, from the hollow out over the teeth
  spillDir(out = new THREE.Vector3()) {
    const a = new THREE.Vector3(this.secX, this._c[0], this._c[1]).applyMatrix4(this.bucketP.matrixWorld), b = new THREE.Vector3(this.secX, this.lips[0][0], this.lips[0][1]).applyMatrix4(this.bucketP.matrixWorld);
    return out.subVectors(b, a).normalize();
  }
  // the lip it runs out over (world): the lower end of its opening
  // (u −1 … 1: across its width — what runs out comes off all along the lip, a curtain)
  lipWorld(out = new THREE.Vector3(), u = 0) {
    // (over the teeth — the back is closed by the stick; facing down, the lower of the two)
    const up = this._upLocal(), S = this._surface(up), l = S.g ? this.lips[0] : (S.H(this.lips[0]) < S.H(this.lips[1]) ? this.lips[0] : this.lips[1]);
    return out.set(this.secX + u * this.secW / 2 * 0.9, l[0], l[1]).applyMatrix4(this.bucketP.matrixWorld);
  }
  // the soil in it (share of a heaped bucket): up to where it would run out, a heap on top — as dug soil lies in a
  // bucket: crowned in the middle, lower at the side plates, lumpy (clods), never a level plane
  _fill(share) {
    if (!this.sec) return;
    const up = this._upLocal(), want = share * this.secRef, L = this.chord, S = this._surface(up), H = S.H, g = S.g || H, tol = L * 1e-4, mound = new Set();
    const Alip = this._area(this._belowF(S.lip)), gs = this.sec.map(g);
    let poly, level;
    if (want <= Alip) {
      let a = Math.min(...gs), b = S.at; for (let k = 0; k < 24; k++) { const m = (a + b) / 2; if (this._area(this._belowF((p) => g(p) - m)) < want) a = m; else b = m; }
      level = (a + b) / 2; poly = this._belowF((p) => g(p) - level);
    } else {
      // (to the teeth, then a heap over the opening: a parabola across it, its height for the rest)
      level = S.at; poly = this._belowF(S.lip);
      const extra = want - Alip, [e0, e1] = this.lips, Hh = Math.min(L * 0.45, 1.5 * extra / L), n = 9, md = [];
      for (let k = 1; k < n; k++) { const u = k / n, bump = 4 * u * (1 - u) * Hh, q = [e0[0] + (e1[0] - e0[0]) * u + up[0] * bump, e0[1] + (e1[1] - e0[1]) * u + up[1] * bump]; mound.add(q); md.push(q); }
      const i0 = poly.findIndex((p) => Math.hypot(p[0] - e0[0], p[1] - e0[1]) < 1e-6), i1 = poly.findIndex((p) => Math.hypot(p[0] - e1[0], p[1] - e1[1]) < 1e-6);
      if (i0 >= 0 && i1 >= 0) { if ((i0 + 1) % poly.length === i1) poly.splice(i1, 0, ...md); else if ((i1 + 1) % poly.length === i0) poly.splice(i0, 0, ...md.reverse()); }
    }
    if (poly.length < 3) { this.soil.visible = false; return; }
    // (its top: the points on the level or the heap — between two of them more points, for the lumps to show)
    const isTop = (p) => mound.has(p) || Math.abs(g(p) - level) < tol || (level >= S.at - tol && this.lips.some((l) => Math.hypot(p[0] - l[0], p[1] - l[1]) < 1e-6));
    const P = [], top = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ta = isTop(a), tb = isTop(b); P.push(a); top.push(ta);
      if (ta && tb) { const m = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (L / 9)); for (let k = 1; k < m; k++) { P.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m]); top.push(true); } }
    }
    // (each run of top points: 0 … 1 along it — the lumps and the crown die out at the walls)
    const n = P.length, tt = new Float32Array(n);
    for (let s = 0; s < n; s++) {
      if (!top[s] || top[(s - 1 + n) % n]) continue;
      const run = []; for (let i = s; top[i] && run.length < n; i = (i + 1) % n) run.push(i);
      const len = [0]; for (let k = 1; k < run.length; k++) len.push(len[k - 1] + Math.hypot(P[run[k]][0] - P[run[k - 1]][0], P[run[k]][1] - P[run[k - 1]][1]));
      const T = len[len.length - 1] || 1; run.forEach((i, k) => { tt[i] = len[k] / T; });
    }
    const ph = this._lumpPh ||= [0, 1, 2, 3].map(() => Math.random() * 6.28), NX = 10, w = this.secW / 2;
    const heapAt = (p) => Math.max(0, g(p) - S.at), domeA = L * 0.05, lumpA = L * 0.05;
    const slices = [];
    for (let j = 0; j <= NX; j++) {
      const u = j / NX * 2 - 1, cr = 1 - u * u, S = [];
      for (let i = 0; i < n; i++) {
        const p = P[i]; if (!top[i]) { S.push(p); continue; }
        const t = tt[i], end = Math.sin(Math.PI * t), lump = 0.5 * Math.sin(7.3 * u + 9.1 * t + ph[0]) + 0.3 * Math.sin(13.7 * t - 5.2 * u + ph[1]) + 0.25 * Math.sin(23 * u + 19 * t + ph[2]) * Math.sin(31 * t - 17 * u + ph[3]);
        // (the heap down to the plates' edge at the sides (1 : 1 off them), what it loses there in the middle; a crown over the level part; clods)
        const d = heapAt(p) * (1.5 * cr - 1) + domeA * (end * cr - 0.42) + lumpA * lump * Math.sqrt(end) * (0.4 + 0.6 * cr);
        S.push([p[0] + up[0] * d, p[1] + up[1] * d]);
      }
      slices.push(S);
    }
    const pos = [], col = [], X = (j) => this.secX - w + (2 * w) * j / NX, shade = (x, p) => 0.82 + 0.3 * (0.5 + 0.5 * Math.sin(x * 211 + p[0] * 173 + ph[0]) * Math.sin(p[1] * 197 + ph[1]));
    const v = (x, p) => { pos.push(x, p[0], p[1]); const c = shade(x, p); col.push(c, c, c); };
    for (let j = 0; j < NX; j++) for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n, a = slices[j][i], b = slices[j][i2], c = slices[j + 1][i2], d = slices[j + 1][i], xa = X(j), xb = X(j + 1);
      v(xa, a); v(xb, c); v(xa, b); v(xa, a); v(xb, d); v(xb, c);
    }
    for (const [j, x] of [[0, X(0)], [NX, X(NX)]]) {
      const S = slices[j], cy = S.reduce((a, p) => a + p[0], 0) / n, cz = S.reduce((a, p) => a + p[1], 0) / n;
      for (let i = 0; i < n; i++) { v(x, [cy, cz]); v(x, S[i]); v(x, S[(i + 1) % n]); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    this.soil.geometry.dispose(); this.soil.geometry = geo; this.soil.position.set(0, 0, 0); this.soil.scale.set(1, 1, 1); this.soil.visible = true;
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
  // our logo on both sides of the boom, where the maker's was (the owner: «put ours in place of CAT»): a decal on the side plate,
  // found from the boom's own vertices — its thin axis is the sides' normal, the flat plate's points the place, along its length
  _logo() {
    const B = this.boomP, stop = new Set([this.stickP, this.bucketP]), pts = [], v = new THREE.Vector3(), inv = new THREE.Matrix4();
    B.updateMatrixWorld(true); inv.copy(B.matrixWorld).invert();
    const walk = (o) => { if (stop.has(o) || o.name.startsWith('cyl_')) return; if (o.isMesh) { const p = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); for (let i = 0; i < p.count; i += 3) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(m).clone()); } for (const c of o.children) walk(c); };
    for (const c of B.children) walk(c);
    if (pts.length < 50) return;
    const box = new THREE.Box3().setFromPoints(pts), size = box.getSize(new THREE.Vector3()), ax = ['x', 'y', 'z'];
    const thin = ax.reduce((a, k) => (size[k] < size[a] ? k : a), 'x'), long = ax.filter((k) => k !== thin).reduce((a, k) => (size[k] > size[a] ? k : a));
    const other = ax.find((k) => k !== thin && k !== long);
    // (the owner's logo for it: two lines, the red initials) — painted on, not a sticker over it (the owner: «not like a word put on
    // in Word»): the colours of paint, not pure; worn — chipped at its edges, rubbed thin here and there; grime run down over it; lit and
    // shadowed as the boom's own paint, opaque (cut out, depth written)
    const mat = new THREE.MeshStandardMaterial({ transparent: false, alphaTest: 0.5, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const img = new Image(); img.onload = () => { mat.map = paintedLogo(img); mat.needsUpdate = true; }; img.src = 'assets/brand/logo-stack-boom.png';
    for (const side of [1, -1]) {
      // (on the upper straight stretch, toward the nose — where the stick hangs: clear of the boom's cylinder by the knee); the side
      // plate there: its own face (the boom is narrower toward the nose than at its foot)
      const nose = this.stickP.position[long] > box.min[long] + size[long] / 2 ? 1 : -1, fc = nose > 0 ? 0.68 : 0.32, at = box.min[long] + size[long] * fc;
      const win = pts.filter((q) => Math.abs(q[long] - at) < size[long] * 0.14); if (win.length < 12) continue;
      const face = side > 0 ? Math.max(...win.map((q) => q[thin])) : Math.min(...win.map((q) => q[thin]));
      const near = pts.filter((q) => Math.abs(q[thin] - face) < size[thin] * 0.06);
      // (the straightest stretch of the plate: the window whose points lie best on a line — a decal on the knee stood off it)
      const fit = (ps) => { let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const q of ps) { sx += q[long]; sy += q[other]; sxx += q[long] * q[long]; sxy += q[long] * q[other]; } const n0 = ps.length, k0 = (n0 * sxy - sx * sy) / Math.max(1e-12, n0 * sxx - sx * sx), b0 = (sy - k0 * sx) / n0; let e = 0; for (const q of ps) e = Math.max(e, Math.abs(q[other] - (k0 * q[long] + b0))); return e; };
      const mid = near.filter((q) => Math.abs(q[long] - at) < size[long] * 0.12);
      if (mid.length < 8) continue;
      const c = new THREE.Vector3(); for (const q of mid) c.add(q); c.divideScalar(mid.length); c[thin] = face + side * size[thin] * 0.004;
      // the plate's way along the boom: the main axis of its points there (the stretch may be steep — no line of `other` on `long`)
      // (from the middle of the plate a little before to a little after: two slices' centres)
      const cen = (f0, f1) => { const ps = near.filter((q) => q[long] > at + size[long] * f0 && q[long] < at + size[long] * f1); const o = new THREE.Vector3(); for (const q of ps) o.add(q); return ps.length ? o.divideScalar(ps.length) : null; };
      const c1 = cen(-0.2, -0.08), c2 = cen(0.08, 0.2), dir = new THREE.Vector3(); dir[long] = 1;
      if (c1 && c2) { dir.subVectors(c2, c1); dir[thin] = 0; dir.normalize(); }
      const n = new THREE.Vector3(); n[thin] = side;
      const up = new THREE.Vector3().crossVectors(n, dir).normalize();
      if (up.clone().transformDirection(B.matrixWorld).y < 0) up.negate();   // (up as the world's up at the boom's rest pose)
      const right = new THREE.Vector3().crossVectors(up, n).normalize();   // (reads left to right from that side)
      // (turned 9° counterclockwise as seen from outside: both lines parallel to the boom's bottom edge, which tapers up to the nose — the owner)
      { const tilt = 9 * Math.PI / 180; right.applyAxisAngle(n, tilt); up.applyAxisAngle(n, tilt); }
      // the plate's height across the boom there, the decal centred in it and 70 % of it
      const slice = near.filter((q) => Math.abs(q.clone().sub(c).dot(dir)) < size[long] * 0.05), ups = slice.map((q) => q.clone().sub(c).dot(up));
      const uLo = Math.min(...ups), uHi = Math.max(...ups), hp = Number.isFinite(uLo) && uHi > uLo ? uHi - uLo : size[other] * 0.3;
      if (Number.isFinite(uLo) && uHi > uLo) c.addScaledVector(up, (uLo + uHi) / 2);
      const H = Math.min(hp * 0.7, size[long] * 0.28 * 317 / 838), L = H * 838 / 317;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat);
      m.matrix.makeBasis(right, up, n).setPosition(c); m.matrixAutoUpdate = false; m.name = 'logo'; m.castShadow = false; m.receiveShadow = true;
      B.add(m);
    }
  }
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

// the logo as paint on steel: its colours toned to paint, its alpha worn by chips (more at the edges of the letters), rubbed patches,
// and grime streaks running down — a canvas texture
function paintedLogo(img) {
  const W = img.width, H = img.height, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H), p = d.data;
  const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v; };
  const fbm = (x, y) => 0.5 * vn(x, y) + 0.25 * vn(x * 2.1, y * 2.1) + 0.125 * vn(x * 4.3, y * 4.3) + 0.0625 * vn(x * 8.7, y * 8.7);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (p[i + 3] < 8) continue;
    // (an edge of a letter: some neighbour clear)
    const edge = (x > 2 && p[i - 12 + 3] < 8) || (x < W - 3 && p[i + 12 + 3] < 8) || (y > 2 && p[i - W * 12 + 3] < 8) || (y < H - 3 && p[i + W * 12 + 3] < 8);
    const chip = fbm(x / 6, y / 6), rub = fbm(x / 40 + 7, y / 40 + 3), streak = fbm(x / 3 + 13, y / 60);
    let a = p[i + 3];
    if (chip > (edge ? 0.66 : 0.79)) a = 0;   // chipped off (a little: a machine of a season, not a wreck)
    else if (rub > 0.68) a *= 0.7;           // rubbed thin (cut out below the half: holes where it is worn through)
    p[i + 3] = a;
    // (paint colours: the black a warm charcoal, the red an oxide red; dirt darkening down the streaks)
    const r = p[i], gg = p[i + 1], b = p[i + 2], red = r > 120 && gg < 90;
    const dirt = 0.82 + 0.18 * (1 - Math.max(0, streak - 0.45) * 2);
    p[i] = (red ? 168 : 46) * dirt; p[i + 1] = (red ? 32 : 42) * dirt; p[i + 2] = (red ? 28 : 38) * dirt;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
