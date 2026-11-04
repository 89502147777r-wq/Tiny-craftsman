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
    this.soil = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5e4630, roughness: 1 }));
    this.soil.position.copy(this.hollow); this.soil.visible = false; this.bucketP.add(this.soil);
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
  static LIM = { boom: [-0.55, 0.5], stick: [-0.95, 0.55], curl: [-1.6, 0.75] };
  _rigCylinders() {
    // (a piece's length along its +Z from its pin, in its own frame — the meshes' boxes brought into it: their
    // positions may be quantized, scaled by their own nodes)
    const lenZ = (o) => { this.root.updateMatrixWorld(true); const inv = o.matrixWorld.clone().invert(), b = new THREE.Box3(); o.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld))); } }); return b.max.z - Math.max(0, b.min.z); };
    this.lim = { boom: [...Excavator.LIM.boom], stick: [...Excavator.LIM.stick], curl: [...Excavator.LIM.curl] };
    for (const c of this.cyl) { c.Lb = lenZ(c.b); c.Lr = lenZ(c.r); }
    const bk = this.cyl.find((c) => c.b.name === 'cyl_bucket_b');
    if (bk) { this.stickP.attach(bk.r); bk.slide = true; bk.r0 = bk.r.position.clone(); bk.dir = new THREE.Vector3(0, 0, 1).applyQuaternion(bk.r.quaternion); bk.q0 = bk.r.quaternion.clone(); bk.b.userData.fixed = bk.b.quaternion.clone(); }
    // (the strokes: each joint swept from its rest; where its cylinder would come apart or bottom out — its end)
    const dist = (c) => { this.root.updateMatrixWorld(true); return c.b.getWorldPosition(new THREE.Vector3()).distanceTo(c.r.getWorldPosition(new THREE.Vector3())) / c.b.getWorldScale(new THREE.Vector3()).x; };   // (in the model's metres)
    for (const [j, names] of [['boom', ['cyl_boomL_b', 'cyl_boomR_b']], ['stick', ['cyl_stick_b']]]) {
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
    this.soil.visible = this.load > 0.03;
    if (this.soil.visible) { const k = 0.45 + 0.55 * Math.cbrt(this.load), r = this.soilR; this.soil.scale.set(r.a * k, r.d * k, r.d * k); }
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
