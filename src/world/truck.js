import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadModel, normalise } from './machines/models.js';

// The small tipper (FUSO Canter T200, CC BY — CREDITS.md) at the scale of the blocks: 4,7 m long,
// a dropside body 3 × 1,6 m that tips back on a hinge at its rear (the soil runs out over the
// tailgate). The soil it carries is drawn in the body, as high as how full it is. Local +x
// forward, y up.
const R = (m) => m / MODEL_SCALE;
export const TRUCK_LOAD = 2.0;    // m³ the body takes (≈ 3 t of soil)

export class Truck {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'truck';
    this.x = 0; this.z = 0; this.yaw = 0; this.y = 0;
    this.tip = 0; this.tipGoal = 0; this.load = 0;
    this.ready = this._build();
  }
  async _build() {
    const { scene } = await loadModel('canter');
    const { holder } = normalise(scene, { forward: '+z', length: R(4.7) });
    this.root.add(holder); holder.updateMatrixWorld(true);
    // the body: the parts in its materials
    const parts = [];
    scene.traverse((o) => { if (o.isMesh && /carry|caarrt/i.test(o.material?.name || '')) parts.push(o); });
    const bb = new THREE.Box3(); for (const p of parts) bb.expandByObject(p);
    this.bodyBox = bb.clone();
    this.bed = new THREE.Group();
    this.bed.position.copy(holder.worldToLocal(new THREE.Vector3(bb.min.x, bb.min.y, (bb.min.z + bb.max.z) / 2)));
    holder.add(this.bed); this.bed.updateMatrixWorld(true);
    for (const p of parts) this.bed.attach(p);
    // the soil in it: a mound over its floor, the floor ~12 % up the body's sides
    const L = bb.max.x - bb.min.x, W = bb.max.z - bb.min.z, H = bb.max.y - bb.min.y;
    const g = new THREE.BoxGeometry(1, 1, 1, 8, 1, 4); g.translate(0.5, 0.5, 0);
    { const pos = g.attributes.position; for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.5) { const u = pos.getX(i), w = pos.getZ(i); pos.setY(i, 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * (1 - 4 * w * w)); } g.computeVertexNormals(); }
    this.soil = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x75553a, roughness: 1 }));
    this.soil.position.set(L * 0.04, H * 0.14, 0); this.soil.scale.set(L * 0.9, 1e-4, W * 0.86); this.soil.visible = false;
    this.bed.add(this.soil); this.soilH = H * 0.75;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.len = R(4.7); this.width = W * this.root.scale.x;
    return this;
  }
  get loaded() { return !!this.bed; }
  // the middle of the body (world): where the loader tips its bucket
  bedCentre(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); const b = this.bodyBox; return out.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).applyMatrix4(this.root.matrixWorld); }
  place(terrain, x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz);
    const hf = at(R(1.6), 0), hb = at(-R(1.4), 0), hl = at(0, -R(0.8)), hr = at(0, R(0.8));
    this.y = (hf + hb + hl + hr) / 4;
    this.root.position.set(x, this.y, z);
    this.root.rotation.set(0, 0, 0); this.root.rotateY(yaw); this.root.rotateZ(Math.atan2(hf - hb, R(3))); this.root.rotateX(Math.atan2(hl - hr, R(1.6)));
  }
  update(dt) {
    if (!this.bed) return;
    this.tip += (this.tipGoal - this.tip) * (1 - Math.exp(-dt * 1.5));
    this.bed.rotation.z = this.tip;   // (+: the front up, on the rear hinge)
    this.soil.visible = this.load > 0.01;
    if (this.soil.visible) this.soil.scale.y = this.soilH * Math.min(1, this.load);
  }
}
