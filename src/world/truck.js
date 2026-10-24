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
    // the tailgate: the thin panel across the body's back, hung on a hinge along its top — as the body
    // tips it hangs on plumb and opens at the bottom (what is in the body runs out under it)
    {
      this.bed.updateMatrixWorld(true);
      const W0 = bb.max.z - bb.min.z, L0 = bb.max.x - bb.min.x;
      const cand = parts.map((o) => ({ o, b: new THREE.Box3().setFromObject(o) }))
        .filter(({ b }) => b.max.x - b.min.x < L0 * 0.12 && (b.min.x + b.max.x) / 2 < bb.min.x + L0 * 0.15 && b.max.z - b.min.z > W0 * 0.7)
        .sort((p, q) => (p.b.min.x + p.b.max.x) - (q.b.min.x + q.b.max.x));
      if (cand.length) {
        const gate = cand.filter((c) => c.b.min.x < cand[0].b.max.x + L0 * 0.03), gb = new THREE.Box3();
        for (const c of gate) gb.union(c.b);
        this.gate = new THREE.Group();
        this.gate.position.copy(this.bed.worldToLocal(new THREE.Vector3((gb.min.x + gb.max.x) / 2, gb.max.y, (gb.min.z + gb.max.z) / 2)));
        this.bed.add(this.gate); this.gate.updateMatrixWorld(true);
        for (const c of gate) this.gate.attach(c.o);
      }
    }
    // what it carries: a little ground of its own over the body's floor (~14 % up its sides) — a grid
    // of heights: a bucketful lands as a heap where it is tipped and slumps to its angle of repose
    const L = bb.max.x - bb.min.x, W = bb.max.z - bb.min.z, H = bb.max.y - bb.min.y;
    this.NX = 16; this.NZ = 9;
    this.hx = L * 0.9; this.hz = W * 0.86; this.x0 = L * 0.04; this.floor = H * 0.14; this.hMax = H * 1.05;
    this.cA = (this.hx / (this.NX - 1)) * (this.hz / (this.NZ - 1));
    this.cap = R(1) ** 3 * TRUCK_LOAD;   // (the body's load, model volume)
    this.hf = new Float32Array(this.NX * this.NZ);
    const g = new THREE.PlaneGeometry(1, 1, this.NX - 1, this.NZ - 1); g.rotateX(-Math.PI / 2); g.translate(0.5, 0, 0);
    this.soil = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x75553a, roughness: 1 }));
    this.soil.position.set(this.x0, this.floor, 0); this.soil.scale.set(this.hx, 1, this.hz); this.soil.visible = false;
    this.soil.castShadow = true;
    this.bed.add(this.soil); this.soilH = H * 0.75; this._hfDirty = true;
    // the wheels: the tyres (their rubber), each with what sits inside it (the rim, the hub), turned
    // on a pivot at its middle about the axle (the truck's local z)
    {
      this.root.updateMatrixWorld(true);
      const tyres = [], rest = [];
      scene.traverse((o) => { if (!o.isMesh) return; (/fire/i.test(o.material?.name || '') ? tyres : rest).push(o); });
      const groups = [];
      for (const o of tyres) {
        const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
        let gr = groups.find((g) => g.c.distanceTo(c) < R(0.45));
        if (!gr) groups.push((gr = { c, box: b.clone(), parts: [] })); else gr.box.union(b);
        gr.parts.push(o);
      }
      this.wheels = [];
      const ground = Math.min(...groups.map((g) => g.box.min.y));
      for (const gr of groups) {
        const c = gr.box.getCenter(new THREE.Vector3()), r = (gr.box.max.y - gr.box.min.y) / 2;
        if (r < R(0.2) || gr.box.min.y > ground + R(0.1)) continue;   // (not a wheel on the road: a small rubber part, the spare one under the body)
        const inner = gr.box.clone().expandByScalar(R(0.02));
        // (a tyre mesh may be a whole axle's pair: of what is inside, only what sits out at the wheels turns — not the springs and the beam between them)
        const hz = (gr.box.max.z - gr.box.min.z) / 2;
        for (const o of rest) { const b = new THREE.Box3().setFromObject(o), bc = b.getCenter(new THREE.Vector3()); if (inner.containsBox(b) && Math.abs(bc.z - c.z) > hz * 0.55) gr.parts.push(o); }
        const pv = new THREE.Group(); pv.userData.wheel = true;
        pv.position.copy(holder.worldToLocal(c.clone())); holder.add(pv); pv.updateMatrixWorld(true);
        for (const o of gr.parts) pv.attach(o);
        this.wheels.push({ g: pv, r });
      }
    }
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.len = R(4.7); this.width = W * this.root.scale.x;
    return this;
  }
  get loaded() { return !!this.bed; }
  // the middle of the body (world): where the loader tips its bucket
  bedCentre(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); const b = this.bodyBox; return out.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).applyMatrix4(this.root.matrixWorld); }
  place(terrain, x, z, yaw) {
    // (the way gone along its forward since the last place — not a jump — turns the wheels)
    const d = (x - this.x) * Math.cos(yaw) - (z - this.z) * Math.sin(yaw);
    if (Math.abs(d) < R(2)) this.spin = (this.spin || 0) + d;
    this.x = x; this.z = z; this.yaw = yaw;
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz);
    const hf = at(R(1.6), 0), hb = at(-R(1.4), 0), hl = at(0, -R(0.8)), hr = at(0, R(0.8));
    this.y = (hf + hb + hl + hr) / 4;
    this.root.position.set(x, this.y, z);
    this.pitch = Math.atan2(hf - hb, R(3)); this.roll = Math.atan2(hl - hr, R(1.6));
    this.root.rotation.set(0, 0, 0); this.root.rotateY(yaw); this.root.rotateZ(this.pitch); this.root.rotateX(this.roll);
  }
  // the volume in the body's grid (model)
  _hfVol() { let v = 0; for (const h of this.hf) v += h; return v * this.cA; }
  // a share `frac` of a full body tipped in at p (world): a heap there
  pourAt(p, frac) {
    if (!this.bed || !(frac > 0)) return;
    const q = this.bed.worldToLocal(p.clone()), NX = this.NX, NZ = this.NZ;
    const cx = Math.max(1, Math.min(NX - 2, (q.x - this.x0) / this.hx * (NX - 1))), cz = Math.max(1, Math.min(NZ - 2, (q.z / this.hz + 0.5) * (NZ - 1)));
    const vol = frac * this.cap, w = [], r = 1.6;
    let sum = 0;
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) { const d2 = ((ix - cx) ** 2 + (iz - cz) ** 2) / (r * r), k = Math.exp(-d2); w.push(k); sum += k; }
    for (let i = 0; i < w.length; i++) this.hf[i] += vol * w[i] / sum / this.cA;
    this.load = Math.min(1, this.load + frac); this._hfLoad = this.load; this._hfDirty = true;
  }
  // the top of what is in the body at p (world), or of its floor: world height
  surfaceAt(p) {
    if (!this.bed) return -Infinity;
    const q = this.bed.worldToLocal(p.clone()), NX = this.NX, NZ = this.NZ;
    const ix = Math.round(Math.max(0, Math.min(NX - 1, (q.x - this.x0) / this.hx * (NX - 1)))), iz = Math.round(Math.max(0, Math.min(NZ - 1, (q.z / this.hz + 0.5) * (NZ - 1))));
    return this.bed.localToWorld(new THREE.Vector3(q.x, this.floor + this.hf[iz * NX + ix], q.z)).y;
  }
  // the grid made to hold `load` of a body: what came in by itself (a record, a whole bucketful at
  // once) a heap in the middle; what went out (tipped, emptied) taken off evenly
  _sync() {
    const want = this.load * this.cap, have = this._hfVol();
    if (Math.abs(want - have) < this.cap * 0.002) return;
    if (want <= 1e-9) this.hf.fill(0);
    else if (want < have) { const k = want / have; for (let i = 0; i < this.hf.length; i++) this.hf[i] *= k; }
    else { const l = this.load; this.load = have / this.cap; this.pourAt(this.bed.localToWorld(new THREE.Vector3(this.x0 + this.hx * 0.5, 0, 0)), l - this.load); this.load = l; }
    this._hfDirty = true;
  }
  // it slumps: each pair of cells steeper than its repose shares the excess (a few sweeps a frame)
  _slump() {
    const NX = this.NX, NZ = this.NZ, h = this.hf, dx = this.hx / (NX - 1), dz = this.hz / (NZ - 1), rep = 0.72;
    let moved = false;
    for (let it = 0; it < 4; it++) for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      const i = iz * NX + ix;
      for (const [j, d] of [[ix + 1 < NX ? i + 1 : -1, dx], [iz + 1 < NZ ? i + NX : -1, dz]]) {
        if (j < 0) continue;
        const diff = h[i] - h[j], lim = rep * d;
        if (Math.abs(diff) > lim) { const m = (Math.abs(diff) - lim) / 2 * Math.sign(diff); h[i] -= m; h[j] += m; moved = true; }
      }
    }
    // (heaped no higher than a little over the sides)
    for (let i = 0; i < h.length; i++) if (h[i] > this.hMax - this.floor) h[i] = this.hMax - this.floor;
    return moved;
  }
  update(dt) {
    if (!this.bed) return;
    this._sync();
    if (this._slump() || this._hfDirty) {
      this._hfDirty = false;
      const pos = this.soil.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(0.0005, this.hf[i]) / 1);
      pos.needsUpdate = true; this.soil.geometry.computeVertexNormals();
    }
    this.tip += (this.tipGoal - this.tip) * (1 - Math.exp(-dt * 1.5));
    this.bed.rotation.z = this.tip;   // (+: the front up, on the rear hinge)
    if (this.gate) this.gate.rotation.z = -this.tip * 0.97;
    for (const w of this.wheels || []) w.g.rotation.z = -(this.spin || 0) / w.r;
    this.soil.visible = this.load > 0.005;
  }
}
