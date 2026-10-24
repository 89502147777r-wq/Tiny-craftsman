import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadModel, normalise, findNode } from './machines/models.js';

// The skid-steer loader (мини-погрузчик, CC BY — CREDITS.md) at the scale of the blocks: 3,5 m
// long with its bucket, 1,8 m wide. The lift arms turn on their hinges at the back of the tower,
// the bucket on the ends of the arms; the wheels roll with the way driven; it sits on the
// ground (pitch and roll from the four wheels). Local +x forward, y up.
const R = (m) => m / MODEL_SCALE;

// the hinge of a part: the middle of its vertices that lie in the given share of its length at
// one end (`end`: −1 the back, +1 the front) and of its height (`up`: 0…1 from the bottom)
function hingeOf(obj, end, upFrom, upTo, frac) {
  obj.updateMatrixWorld(true);
  const pts = [], v = new THREE.Vector3();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 6000));
    for (let i = 0; i < p.count; i += step) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  const b = new THREE.Box3().setFromPoints(pts), L = b.max.x - b.min.x, H = b.max.y - b.min.y;
  const sel = pts.filter((q) => (end < 0 ? q.x < b.min.x + L * frac : q.x > b.max.x - L * frac) && q.y > b.min.y + H * upFrom && q.y < b.min.y + H * upTo);
  const c = new THREE.Vector3(); for (const q of sel) c.add(q); c.divideScalar(Math.max(1, sel.length));
  return { c, box: b };
}

export class Loader {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'loader';
    this.x = 0; this.z = 0; this.yaw = 0; this.y = 0; this.pitch = 0; this.roll = 0;
    this.arm = 0; this.tilt = 0;          // the arms raised (rad), the bucket curled back (rad, + = up)
    this.armGoal = 0; this.tiltGoal = 0;
    this.load = 0;                         // 0…1: how full the bucket is (the soil drawn in it)
    this.spin = 0;
    this.ready = this._build();
  }
  async _build() {
    const { scene } = await loadModel('loader');
    const { holder } = normalise(scene, { forward: '+z', length: R(3.5) });
    this.body = holder; this.root.add(holder);
    holder.updateMatrixWorld(true);
    const arms = findNode(scene, 'lift_arms'), bucket = findNode(scene, 'Bucket');
    const wheels = ['wheel_Ft_L', 'wheel_Ft_R', 'wheel_Bk_L', 'wheel_Bk_R'].map((n) => findNode(scene, n));
    // (pivot groups in the holder's frame, each part attached to its own: it keeps its place)
    const pivot = (obj, at) => { const g = new THREE.Group(); g.position.copy(holder.worldToLocal(at.clone())); holder.add(g); g.updateMatrixWorld(true); g.attach(obj); return g; };
    this.root.updateMatrixWorld(true);
    const ha = hingeOf(arms, -1, 0.55, 1.0, 0.1);
    const hb = hingeOf(bucket, -1, 0.55, 1.0, 0.25);
    this.armP = pivot(arms, this.root.localToWorld(ha.c.clone()));
    this.bucketP = new THREE.Group();
    { const at = holder.worldToLocal(this.root.localToWorld(hb.c.clone())); this.bucketP.position.copy(this.armP.worldToLocal(holder.localToWorld(at.clone()))); this.armP.add(this.bucketP); this.bucketP.updateMatrixWorld(true); this.bucketP.attach(bucket); }
    // its bottom: the points of it that can touch the ground (the edge; the bottom's middle; its back
    // corner, lowest when it is curled back), in the bucket pivot's frame
    { const bb = new THREE.Box3().setFromObject(bucket), zc = (bb.min.z + bb.max.z) / 2, H = bb.max.y - bb.min.y;
      this.bottom = [[bb.max.x, bb.min.y], [(bb.min.x + bb.max.x) / 2, bb.min.y], [bb.min.x, bb.min.y], [bb.min.x, bb.min.y + H * 0.45]].map(([x, y]) => this.bucketP.worldToLocal(new THREE.Vector3(x, y, zc))); }
    // the cutting edge: the front bottom of the bucket, in the bucket pivot's frame
    { const bb = new THREE.Box3().setFromObject(bucket), e = new THREE.Vector3(bb.max.x, bb.min.y, (bb.min.z + bb.max.z) / 2); this.edge = this.bucketP.worldToLocal(e); this.bucketW = bb.max.z - bb.min.z; this.bucketBox = bb.clone(); }
    this.wheels = wheels.map((w) => { const b = new THREE.Box3().setFromObject(w), c = b.getCenter(new THREE.Vector3()); return { g: pivot(w, c), r: (b.max.y - b.min.y) / 2, at: holder.worldToLocal(c.clone()) }; });
    // (it stands on its wheels: the bucket in the model's rest pose may hang lower)
    const low = Math.min(...this.wheels.map((w) => w.at.y - w.r));
    holder.position.y -= low; for (const w of this.wheels) w.at.y -= low;
    // the soil in the bucket: a sheet over its floor whose top rises as it fills — level at the
    // back, heaped in the middle, low at the lip and at the sides (shaped in update)
    const bb = this.bucketBox, inB = this.bucketP.worldToLocal(bb.getCenter(new THREE.Vector3()));
    const BL = bb.max.x - bb.min.x, BW = bb.max.z - bb.min.z, BH = bb.max.y - bb.min.y;
    // (only its top: a sheet inside the walls — nothing of it shows through the bucket — with lumps)
    const g = new THREE.PlaneGeometry(1, 1, 14, 10); g.rotateX(-Math.PI / 2);
    this.soilTop = []; { const pos = g.attributes.position; for (let i = 0; i < pos.count; i++) this.soilTop.push(i); }
    this.soilBump = new Float32Array(g.attributes.position.count).map(() => (Math.random() - 0.5) * 0.05);
    this.soil = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6f5137, roughness: 1 }));
    this.soil.position.set(inB.x - BL * 0.1, inB.y - BH * 0.32, inB.z); this.soil.scale.set(BL * 0.6, BH, BW * 0.82);
    this.soil.castShadow = true; this.soil.visible = false; this._fill = -1;
    this.bucketP.add(this.soil);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return this;
  }
  get loaded() { return !!this.armP; }
  soilColor(c) { this.soil?.material.color.copy(c); }
  // where the cutting edge is (world)
  edgeWorld(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return this.bucketP ? out.copy(this.edge).applyMatrix4(this.bucketP.matrixWorld) : out.set(this.x, this.y, this.z); }
  // the lowest point of the bucket (world)
  lowWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    let best = Infinity; const v = new THREE.Vector3();
    for (const p of this.bottom) { v.copy(p).applyMatrix4(this.bucketP.matrixWorld); if (v.y < best) { best = v.y; out.copy(v); } }
    return out;
  }
  // stand on the ground at (x, z) facing yaw: height and tilt from under the four wheels
  place(terrain, x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz);
    const w = this.wheels;
    if (w) {
      const fx = (w[0].at.x + w[1].at.x) / 2, bx = (w[2].at.x + w[3].at.x) / 2, hz = Math.abs(w[0].at.z - w[1].at.z) / 2;
      const hf = (at(fx, -hz) + at(fx, hz)) / 2, hb = (at(bx, -hz) + at(bx, hz)) / 2, hl = (at(fx, -hz) + at(bx, -hz)) / 2, hr = (at(fx, hz) + at(bx, hz)) / 2;
      this.pitch = Math.atan2(hf - hb, fx - bx); this.roll = Math.atan2(hl - hr, 2 * hz);
      this.y = (hf + hb + hl + hr) / 4;
    } else this.y = terrain.heightAt(x, z);
    this.root.position.set(x, this.y, z);
    this.root.rotation.set(0, 0, 0); this.root.rotateY(yaw); this.root.rotateZ(this.pitch); this.root.rotateX(this.roll);
  }
  update(dt, moved = 0) {
    if (!this.armP) return;
    const k = 1 - Math.exp(-dt * 4);
    this.arm += (this.armGoal - this.arm) * k; this.tilt += (this.tiltGoal - this.tilt) * k;
    this.armP.rotation.z = this.arm; this.bucketP.rotation.z = this.tilt - this.arm * 0.85;   // (self-levelling: the bucket keeps its angle as the arms rise)
    this.spin += moved;
    for (const w of this.wheels) w.g.rotation.z = -this.spin / w.r;
    this.soil.visible = this.load > 0.01;
    if (this.soil.visible && Math.abs(this.load - this._fill) > 0.005) {
      // (the top: as high as full — a little over the rim when heaped — falling to the lip and the sides)
      this._fill = this.load;
      const pos = this.soil.geometry.attributes.position, f = this.load;
      for (const i of this.soilTop) {
        const u = pos.getX(i) + 0.5, w = pos.getZ(i) * 2;   // u: 0 at the back, 1 at the lip; w: −1…1 across
        const h = f * 0.75 * (1 - 0.55 * u * u) + Math.max(0, f - 0.4) * 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - w * w * 0.8);
        pos.setY(i, Math.max(0.02, h + this.soilBump[i] * Math.min(1, f * 2)));
      }
      pos.needsUpdate = true; this.soil.geometry.computeVertexNormals();
    }
  }
}
