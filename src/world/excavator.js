import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadModel, normalise, findNode } from './machines/models.js';

// The mini excavator (CC BY — CREDITS.md) at the scale of the blocks: 4,75 m long with its arm out,
// 1,6 m wide, 2,5 m to the top of the cab. The undercarriage (tracks and the dozer blade) stays on the
// ground; the house turns on it (the swing); the boom turns on its foot at the front of the house, the
// stick (dipper) at the boom's tip, the bucket at the stick's end. Local +x forward, y up.
//   swing, boom, stick, curl (rad) and their goals; load 0…1 (the soil in the bucket).
const R = (m) => m / MODEL_SCALE;

// the points of a part (world), every few vertices
function pointsOf(obj) {
  obj.updateMatrixWorld(true);
  const pts = [], v = new THREE.Vector3();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 4000));
    for (let i = 0; i < p.count; i += step) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  return pts;
}
const mid = (pts) => { const c = new THREE.Vector3(); for (const q of pts) c.add(q); return c.divideScalar(Math.max(1, pts.length)); };

// a mesh cut in two by the height of each triangle's middle (world): [below, above] (either may be null)
function splitByHeight(mesh, y) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry, pos = g.attributes.position, M = mesh.matrixWorld, v = new THREE.Vector3();
  const lo = [], hi = [];
  for (let t = 0; t < pos.count; t += 3) {
    let cy = 0; for (let k = 0; k < 3; k++) cy += v.fromBufferAttribute(pos, t + k).applyMatrix4(M).y;
    (cy / 3 < y ? lo : hi).push(t);
  }
  const make = (list) => {
    if (!list.length) return null;
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name], s = a.itemSize, arr = new Float32Array(list.length * 3 * s);
      list.forEach((t, j) => { for (let k = 0; k < 3; k++) for (let c = 0; c < s; c++) arr[(j * 3 + k) * s + c] = a.getComponent(t + k, c); });
      out.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized));
    }
    const m = new THREE.Mesh(out, mesh.material); m.name = mesh.name; return m;
  };
  return [make(lo), make(hi)];
}

export class Excavator {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'excavator';
    this.x = 0; this.z = 0; this.yaw = 0; this.y = 0; this.pitch = 0; this.roll = 0;
    this.swing = 0; this.boom = 0; this.stick = 0; this.curl = 0;
    this.swingGoal = 0; this.boomGoal = 0; this.stickGoal = 0; this.curlGoal = 0;
    this.load = 0; this.spin = 0;
    this.ready = this._build();
  }
  async _build() {
    const { scene } = await loadModel('excavator');
    const { holder } = normalise(scene, { forward: '+z', height: R(2.48) });
    this.body = holder; this.root.add(holder);
    this.root.updateMatrixWorld(true);
    const front = findNode(scene, 'Front_3'), boomN = findNode(scene, 'Middle_11'), bucketN = findNode(scene, 'Geom3D_4');
    const all = new THREE.Box3().setFromObject(holder), H = all.max.y - all.min.y;
    // (the undercarriage: what of the house's meshes lies under the top of the tracks — cut off them)
    const trackTop = all.min.y + H * 0.2;
    this.under = new THREE.Group(); holder.add(this.under);
    const frontMeshes = new Set(); front.traverse((o) => { if (o.isMesh) frontMeshes.add(o); }); boomN.traverse((o) => { if (o.isMesh) frontMeshes.add(o); });
    const others = []; scene.traverse((o) => { if (o.isMesh && !frontMeshes.has(o)) others.push(o); });
    const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
    for (const o of others) {
      const [lo, hi] = splitByHeight(o, trackTop);
      if (!lo) continue;
      new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).decompose(lo.position, lo.quaternion, lo.scale); this.under.add(lo);
      if (hi) o.geometry = hi.geometry; else o.visible = false;
    }
    // pivots (each part attached to its own group: it keeps its place)
    const pivot = (parent, at) => { const g = new THREE.Group(); parent.updateMatrixWorld(true); g.position.copy(parent.worldToLocal(at.clone())); parent.add(g); g.updateMatrixWorld(true); return g; };
    const ub = new THREE.Box3(); this.under.traverse((o) => { if (o.isMesh) ub.expandByObject(o); }); if (ub.isEmpty()) ub.copy(all);
    this.track = { x0: ub.min.x, x1: ub.max.x, w: ub.max.z - ub.min.z };
    const swingAt = new THREE.Vector3((ub.min.x + ub.max.x) / 2, ub.max.y, (ub.min.z + ub.max.z) / 2);
    this.house = pivot(holder, swingAt);
    // the boom's foot: the back tenth of it, its lower half; the stick's pin: the top of the stick;
    // the bucket's pin: the top of the bucket next to the stick
    const bp = pointsOf(boomN), bb = new THREE.Box3().setFromPoints(bp), bL = bb.max.x - bb.min.x, bH = bb.max.y - bb.min.y;
    const foot = mid(bp.filter((q) => q.x < bb.min.x + bL * 0.08 && q.y < bb.min.y + bH * 0.35));
    const sp = pointsOf(front).filter((q) => !bucketN || q.y > new THREE.Box3().setFromObject(bucketN).max.y), sb = new THREE.Box3().setFromPoints(sp);
    const pin = mid(sp.filter((q) => q.y > sb.max.y - (sb.max.y - sb.min.y) * 0.07));
    const kp = bucketN ? pointsOf(bucketN) : [], kb = new THREE.Box3().setFromPoints(kp);
    const bpin = mid(kp.filter((q) => q.y > kb.max.y - (kb.max.y - kb.min.y) * 0.12));
    this.house.updateMatrixWorld(true);
    for (const o of others) this.house.attach(o);
    this.boomP = pivot(this.house, foot); this.boomP.attach(boomN);
    this.stickP = pivot(this.boomP, pin); this.stickP.attach(front);
    this.bucketP = pivot(this.stickP, bpin); if (bucketN) this.bucketP.attach(bucketN);
    // the teeth: the point of the bucket farthest from its pin, at rest the lowest front; its width
    { let best = -1; const p0 = bpin; for (const q of kp) { const d = q.distanceTo(p0) + (q.x - p0.x) * 0.2; if (d > best) { best = d; this.teeth = q.clone(); } } }
    this.teeth = this.bucketP.worldToLocal(this.teeth || bpin.clone());
    this.bucketW = kb.isEmpty() ? R(0.5) : kb.max.z - kb.min.z;
    this.mouth = this.bucketP.worldToLocal(kb.isEmpty() ? bpin.clone() : kb.getCenter(new THREE.Vector3()));
    this.reach = foot.distanceTo(pin) + pin.distanceTo(bpin) + bpin.distanceTo(this.bucketP.localToWorld(this.teeth.clone()));
    // the soil in the bucket: a heaped lump at its middle, as big as it is full
    this.soil = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6f5137, roughness: 1 }));
    this.soil.position.copy(this.mouth); this.soil.visible = false; this.bucketP.add(this.soil);
    this.soilR = (kb.isEmpty() ? R(0.25) : Math.min(kb.max.x - kb.min.x, kb.max.z - kb.min.z)) * 0.42;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // (it stands on its tracks)
    holder.position.y -= ub.min.y;
    return this;
  }
  get loaded() { return !!this.bucketP; }
  soilColor(c) { this.soil?.material.color.copy(c); }
  teethWorld(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.copy(this.teeth).applyMatrix4(this.bucketP.matrixWorld); }
  mouthWorld(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.copy(this.mouth).applyMatrix4(this.bucketP.matrixWorld); }
  // the bucket's opening faces down (the soil falls out) — its curl opened past the stick's line
  get open() { return this.curl < -0.55; }
  // stand on the ground at (x, z) facing yaw: height and tilt from under the tracks' four ends
  place(terrain, x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz);
    const T = this.track;
    if (T) {
      const fx = T.x1 * 0.8, bx = T.x0 * 0.8, hz = T.w * 0.4;
      const hf = (at(fx, -hz) + at(fx, hz)) / 2, hb = (at(bx, -hz) + at(bx, hz)) / 2, hl = (at(fx, -hz) + at(bx, -hz)) / 2, hr = (at(fx, hz) + at(bx, hz)) / 2;
      this.pitch = Math.atan2(hf - hb, fx - bx); this.roll = Math.atan2(hl - hr, 2 * hz);
      this.y = Math.max(hf, hb, hl, hr) - Math.abs(hf - hb) * 0.25;
    } else this.y = terrain.heightAt(x, z);
    this.root.position.set(x, this.y, z);
    this.root.rotation.set(0, 0, 0); this.root.rotateY(yaw); this.root.rotateZ(this.pitch); this.root.rotateX(this.roll);
  }
  // the joints' limits (rad from the model's pose)
  static LIM = { boom: [-0.55, 0.75], stick: [-0.9, 0.9], curl: [-1.6, 0.9] };
  update(dt) {
    if (!this.bucketP) return;
    const k = 1 - Math.exp(-dt * 6), L = Excavator.LIM, cl = (v, [a, b]) => Math.max(a, Math.min(b, v));
    this.boomGoal = cl(this.boomGoal, L.boom); this.stickGoal = cl(this.stickGoal, L.stick); this.curlGoal = cl(this.curlGoal, L.curl);
    this.swing += (this.swingGoal - this.swing) * k; this.boom += (this.boomGoal - this.boom) * k; this.stick += (this.stickGoal - this.stick) * k; this.curl += (this.curlGoal - this.curl) * k;
    this.house.rotation.y = this.swing; this.boomP.rotation.z = this.boom; this.stickP.rotation.z = -this.stick; this.bucketP.rotation.z = -this.curl;
    this.soil.visible = this.load > 0.03;
    if (this.soil.visible) { const r = this.soilR * (0.45 + 0.55 * Math.cbrt(this.load)); this.soil.scale.set(r * 1.2, r * 0.75, r); }
  }
}
