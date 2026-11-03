import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadModel, normalise, findNode } from './machines/models.js';

// The excavator (Hitachi, photographed model, CC BY — CREDITS.md), at 0,8 of its size (a ≈13 t machine:
// the cab's roof 2,8 m up): rigged offline from the model's parts — under (the tracks), house (turns
// on them: the swing), boom (on its foot at the front of the house), stick (the dipper, at the boom's
// nose), bucket (at the stick's end, with its linkage); each part's node sits on its pin. Local +x
// forward, y up.   swing, boom, stick, curl (rad) and their goals; load 0…1 (the soil in the bucket).
const R = (m) => m / MODEL_SCALE, SIZE = 0.8;
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
    const { holder } = normalise(scene, { forward: '+z', height: R(5.886 * SIZE) });
    this.body = holder; this.root.add(holder);
    this.root.updateMatrixWorld(true);
    this.under = findNode(scene, 'under'); this.house = findNode(scene, 'house'); this.boomP = findNode(scene, 'boom'); this.stickP = findNode(scene, 'stick'); this.bucketP = findNode(scene, 'bucket');
    // (a part's own meshes: not those of the parts hung on it)
    const parts = new Set([this.under, this.house, this.boomP, this.stickP, this.bucketP]);
    const only = (n) => { const g = new THREE.Box3(), walk = (o) => { if (o.isMesh) g.expandByObject(o); for (const c of o.children) if (!parts.has(c)) walk(c); }; n.updateMatrixWorld(true); walk(n); return g; };
    const ub = only(this.under);
    // (it stands on its tracks)
    holder.position.y -= ub.min.y; this.root.updateMatrixWorld(true); ub.translate(new THREE.Vector3(0, -ub.min.y, 0));
    this.track = { x0: ub.min.x, x1: ub.max.x, w: ub.max.z - ub.min.z };
    // the teeth: the bucket's lowest front point at rest; its width; its middle
    const kp = pointsOf(this.bucketP), kb = new THREE.Box3().setFromPoints(kp);
    let best = -Infinity; for (const q of kp) { const v = q.x * 0.6 - q.y; if (v > best) { best = v; this.teeth = q.clone(); } }
    this.teeth = this.bucketP.worldToLocal(this.teeth.clone());
    this.bucketW = (kb.max.z - kb.min.z) * 0.8;
    this.mouth = this.bucketP.worldToLocal(kb.getCenter(new THREE.Vector3()));
    // the soil in the bucket: a heaped lump at its middle, as big as it is full
    this.soil = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6f5137, roughness: 1 }));
    this.soil.position.copy(this.mouth); this.soil.visible = false; this.bucketP.add(this.soil);
    this.soilR = Math.min(kb.max.x - kb.min.x, kb.max.z - kb.min.z) * 0.38 / this.bucketP.getWorldScale(new THREE.Vector3()).x;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return this;
  }
  get loaded() { return !!this.bucketP; }
  soilColor(c) { this.soil?.material.color.copy(c); }
  teethWorld(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.copy(this.teeth).applyMatrix4(this.bucketP.matrixWorld); }
  mouthWorld(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.copy(this.mouth).applyMatrix4(this.bucketP.matrixWorld); }
  // the bucket's opening faces down (the soil falls out) — its curl opened past the stick's line
  get open() { return this.curl < -0.6; }
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
  static LIM = { boom: [-0.3, 0.85], stick: [-0.6, 1.0], curl: [-1.3, 1.1] };
  update(dt) {
    if (!this.bucketP) return;
    const k = 1 - Math.exp(-dt * 6), L = Excavator.LIM, cl = (v, [a, b]) => Math.max(a, Math.min(b, v));
    this.boomGoal = cl(this.boomGoal, L.boom); this.stickGoal = cl(this.stickGoal, L.stick); this.curlGoal = cl(this.curlGoal, L.curl);
    this.swing += (this.swingGoal - this.swing) * k; this.boom += (this.boomGoal - this.boom) * k; this.stick += (this.stickGoal - this.stick) * k; this.curl += (this.curlGoal - this.curl) * k;
    this.house.rotation.y = this.swing; this.boomP.rotation.x = -this.boom; this.stickP.rotation.x = this.stick; this.bucketP.rotation.x = this.curl;
    this.soil.visible = this.load > 0.03;
    if (this.soil.visible) { const r = this.soilR * (0.45 + 0.55 * Math.cbrt(this.load)); this.soil.scale.set(r * 1.2, r * 0.75, r); }
  }
}
