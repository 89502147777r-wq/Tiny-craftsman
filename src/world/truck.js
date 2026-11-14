import * as THREE from 'three';
import { MODEL_SCALE, MATERIALS } from '../config.js';
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
    // what it carries, by material (soil, sand, 5–20, 20–40, black topsoil) — shares of a body; and what has run over a
    // side and is to fall to the ground (`spills`: taken by the machines' tool, which drops it as crumbs)
    this.mix = [1, 0, 0, 0, 0]; this.spills = [];
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
    this.NX = 32; this.NZ = 18;   // (a cell ≈ 9 cm: a first bucketful is a small heap, not a layer)
    this.hx = L * 0.9; this.hz = W * 0.86; this.x0 = L * 0.04; this.floor = H * 0.14; this.hMax = H * 1.05;
    // (the floor where it really is: felt from above down the middle of the body — what lies on it
    // starts on it, its thin edges are not hidden under it)
    {
      this.bed.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(), ys = [], down = new THREE.Vector3(0, -1, 0).transformDirection(this.bed.matrixWorld);
      for (const u of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const v of [-0.25, 0, 0.25]) {
        rc.set(this.bed.localToWorld(new THREE.Vector3(this.x0 + this.hx * u, H * 1.5, v * this.hz)), down);
        const hit = rc.intersectObjects(parts, false)[0];
        if (hit) ys.push(this.bed.worldToLocal(hit.point.clone()).y);
      }
      ys.sort((a, b) => a - b);
      if (ys.length >= 5) this.floor = ys[Math.floor(ys.length / 2)] + H * 0.004;
    }
    // (the tops of the drop sides and the tailgate, and their inner faces: what it carries lies against them — no gap
    // between the load and the sides — and over the top of a side it runs off; the headboard at the front is higher)
    this.rim = this.floor + R(0.28); this.rimFront = this.hMax;
    {
      const v = new THREE.Vector3(), inv = this.bed.matrixWorld.clone().invert(), side = [], inner = [], rear = [], front = [];
      for (const o of parts) { o.updateMatrixWorld(true); const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        const midX = v.x > L * 0.3 && v.x < L * 0.7, low = v.y > this.floor + R(0.05);
        if (midX && Math.abs(v.z) > W * 0.4) side.push(v.y);
        if (v.x > L * 0.88 && Math.abs(v.z) < W * 0.3) front.push(v.y);
        if (midX && low && Math.abs(v.z) > W * 0.3) inner.push(Math.abs(v.z));
        if (low && v.x < L * 0.25 && Math.abs(v.z) < W * 0.25) rear.push(v.x);
      } }
      const q = (a, k) => { a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * k))]; };
      if (side.length > 20) { const r = q(side, 0.98); if (r > this.floor + R(0.1) && r < this.floor + R(1)) this.rim = r; }
      if (front.length > 20) this.rimFront = Math.max(this.rim, q(front, 0.98));
      if (inner.length > 8) { const zi = q(inner, 0); if (zi > W * 0.35 && zi < W * 0.5) this.hz = 2 * (zi - R(0.02)); }
      if (rear.length > 4) { const xr = q(rear, 1); if (xr > 0 && xr < this.x0) { this.hx += this.x0 - (xr + R(0.02)); this.x0 = xr + R(0.02); } }
    }
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
      // each tyre on its own: the model's tyres are an axle's pair in one mesh — cut in two by side (a tyre's own hub with it), each
      // on its own pivot at its centre: the front pair under a steering pivot (the owner: the front wheels did not turn), the outer
      // wheel in a turn rolling farther than the inner one
      const front = Math.max(...this.wheels.map((w) => w.g.position.x)), axles = this.wheels.slice(); this.wheels = [];
      for (const ax of axles) {
        const pv = ax.g; pv.updateMatrixWorld(true);
        for (const sd of [-1, 1]) {
          const half = new THREE.Group(), meshes = [];
          pv.traverse((o) => { if (o.isMesh) meshes.push(o); });
          for (const o of meshes) {
            const g0 = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(), P = g0.attributes.position, m = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(pv.matrixWorld).invert(), o.matrixWorld), v = new THREE.Vector3(), keep = [];
            for (let t = 0; t < P.count; t += 3) { let zc = 0; for (let k = 0; k < 3; k++) zc += v.fromBufferAttribute(P, t + k).applyMatrix4(m).z; if (Math.sign(zc) === sd) keep.push(t); }
            if (!keep.length) continue;
            const g1 = new THREE.BufferGeometry();
            for (const [name, a] of Object.entries(g0.attributes)) { const arr = new a.array.constructor(keep.length * 3 * a.itemSize); keep.forEach((t, j) => { for (let k = 0; k < 3 * a.itemSize; k++) arr[j * 3 * a.itemSize + k] = a.array[t * a.itemSize + k]; }); g1.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized)); }
            g1.applyMatrix4(m);
            const mesh = new THREE.Mesh(g1, o.material); mesh.castShadow = mesh.receiveShadow = true; half.add(mesh);
          }
          if (!half.children.length) continue;
          const hb = new THREE.Box3().setFromObject(half), cz = (hb.min.z + hb.max.z) / 2;   // (pv's frame: its matrix is still identity on the meshes' parent chain)
          const steer = new THREE.Group(), spin = new THREE.Group();
          steer.position.set(pv.position.x, pv.position.y, pv.position.z + cz * pv.scale.z); holder.add(steer); steer.add(spin);
          for (const mesh of half.children.slice()) { mesh.geometry.translate(0, 0, -cz); spin.add(mesh); }
          holder.updateMatrixWorld(true);
          const zw = this.root.worldToLocal(steer.getWorldPosition(new THREE.Vector3())).z;
          this.wheels.push({ g: spin, steer: Math.abs(pv.position.x - front) < 1e-6 ? steer : null, r: ax.r, zw });
        }
        pv.parent.remove(pv);
      }
      this.base = Math.abs(front - Math.min(...axles.map((w) => w.g.position.x))) * holder.scale.x;   // (wheelbase, world units)
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
    let dy = yaw - (this.yaw ?? yaw); dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (Math.abs(d) < R(2) && Math.abs(dy) < 0.5) {
      this.spin = (this.spin || 0) + d;
      for (const w of this.wheels || []) w.spin = (w.spin || 0) + d + dy * (w.zw ?? 0);
      // the steering angle from the way it turns on the way it goes (a bicycle's: tan δ = wheelbase · turn / way), eased; standing, held
      if (Math.abs(d) > R(0.002)) { const want = Math.max(-0.6, Math.min(0.6, Math.atan((this.base || R(2.5)) * dy / d))); this.steer = (this.steer || 0) + (want - (this.steer || 0)) * 0.35; }
    }
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
  // a share `frac` of a full body tipped in from p (world): it is counted in the load at once (the room left, the
  // records), but the heap grows when it has fallen from p to what lies there — √(2h/g), not before it gets there
  // (now: at once — the grid made to match a load)
  // (no limit here: the body holds what lies in it at its angle of repose, the rest runs over its sides — `_slump`)
  pourAt(p, frac, now = false) {
    if (!this.bed || !(frac > 0)) return;
    const q = this.bed.worldToLocal(p.clone());
    this._unsettled = true;
    if (now) { this._heap(q, frac); this.load += frac; this._hfLoad = this.load; return; }
    const h = Math.max(0, p.y - this.surfaceAt(p));
    this.load += frac; this._hfLoad = this.load;
    (this.falling ||= []).push({ q, f: frac, t: Math.min(1.5, Math.sqrt(2 * h / (9.81 / MODEL_SCALE))) }); this.air = (this.air || 0) + frac;
  }
  // what is in it, by material: `w` a material's index or shares of each, `frac` of a body of it came in
  addMix(w, frac) {
    if (!(frac > 0)) return;
    if (this.load < 0.02) this.mix = [0, 0, 0, 0, 0];
    if (typeof w === 'number') this.mix[w] = (this.mix[w] || 0) + frac;
    else { const tot = w.reduce((a, b) => a + b, 0) || 1; for (let k = 0; k < 5; k++) this.mix[k] = (this.mix[k] || 0) + frac * (w[k] || 0) / tot; }
    this._mixDirty = true;
  }
  setMix(w) { if (!w?.length) return; this.mix = [0, 0, 0, 0, 0]; for (let k = 0; k < 5; k++) this.mix[k] = Math.max(0, +w[k] || 0); if (!this.mix.some((v) => v > 0)) this.mix[0] = 1; this._mixDirty = true; }
  // the shares of the materials in it (they add up to 1)
  mixW() { const tot = this.mix.reduce((a, b) => a + b, 0); return tot > 0 ? this.mix.map((v) => v / tot) : [1, 0, 0, 0, 0]; }
  // a crumb (a falling bit of a load: off a shovel, a bucket, a stream) at p (world) with `vol` of `mat` (model volume):
  // inside the body's sides and down to what lies in it — it is in it (a share of a body there); `force`: anywhere over
  // the body (everything is landed at once). → true when it is
  catchCrumb(p, vol, mat = 0, force = false) {
    if (!this.bed || !this.root.visible || !this.root.parent || this.tip > 0.05) return false;
    if (Math.abs(p.x - this.x) > R(3.5) || Math.abs(p.z - this.z) > R(3.5)) return false;   // (far from it: not a matrix inverted for each crumb)
    const q = this.bed.worldToLocal(_c.copy(p));
    if (q.x < this.x0 || q.x > this.x0 + this.hx || Math.abs(q.z) > this.hz / 2) return false;
    if (q.y < this.floor - R(0.25)) return false;   // (a fast crumb may be a little under the floor's top in its frame: not through it)
    if (!force && q.y > this.floor + this._hAt(q.x, q.z) + R(0.03)) return false;
    if (vol > 0) { const f = vol / this.cap; this.addMix(mat > 4 ? 0 : mat, f); this.load += f; this._hfLoad = this.load; this._heap(q, f, 1.2); this._unsettled = true; }
    return true;
  }
  // the height of what lies at (x, z) of the bed's frame over its floor
  _hAt(x, z) {
    const NX = this.NX, NZ = this.NZ, ix = Math.round(Math.max(0, Math.min(NX - 1, (x - this.x0) / this.hx * (NX - 1)))), iz = Math.round(Math.max(0, Math.min(NZ - 1, (z / this.hz + 0.5) * (NZ - 1))));
    return this.hf[iz * NX + ix];
  }
  // still moving: crumbs landed in it and not yet come to rest, what has run over a side not yet fallen
  get settling() { return !!(this._unsettled || this.spills.length || this.falling?.length); }
  // what ran over the sides since the last call: [{ p (world, just outside the side), n (world, outward), v (model volume) }]
  takeSpills() { const s = this.spills; this.spills = []; return s; }
  // a heap of `frac` of a body round q (the bed's own frame)
  _heap(q, frac, r = 3.0) {
    const NX = this.NX, NZ = this.NZ;
    const cx = Math.max(1, Math.min(NX - 2, (q.x - this.x0) / this.hx * (NX - 1))), cz = Math.max(1, Math.min(NZ - 2, (q.z / this.hz + 0.5) * (NZ - 1)));
    const vol = frac * this.cap, w = [];
    let sum = 0;
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) { const d2 = ((ix - cx) ** 2 + (iz - cz) ** 2) / (r * r), k = Math.exp(-d2); w.push(k); sum += k; }
    for (let i = 0; i < w.length; i++) this.hf[i] += vol * w[i] / sum / this.cA;
    this._hfDirty = true;
  }
  // what is still falling into it: landed when its time has come (all of it at once: before it tips, is saved, read)
  _landing(dt, all = false) {
    const F = this.falling; if (!F?.length) { this.air = 0; return; }
    // (emptied or set from a record meanwhile: what was in the air went with it)
    if (this.load < (this.air || 0) - 1e-6) { F.length = 0; this.air = 0; return; }
    let w = 0; for (const it of F) { it.t -= dt; if (all || it.t <= 0) { this._heap(it.q, it.f); this.air -= it.f; } else F[w++] = it; }
    F.length = w; if (!w) this.air = 0;
  }
  // a bucketful falling off a lip `hw` wide along `dir` (world) round p: heaps along it
  pourLine(p, dir, hw, frac) {
    for (let k = 0; k < 5; k++) this.pourAt(p.clone().addScaledVector(dir, hw * (k / 2 - 1) * 0.8), frac / 5);
  }
  // the body tipped: what is in it slides back and runs out under the open tailgate. → the model
  // volume that ran out this frame (it falls behind the truck)
  _flowOut(dt) {
    if (this.tip < 0.12) return 0;
    const NX = this.NX, NZ = this.NZ, h = this.hf, s = Math.sin(this.tip) * this.hx / (NX - 1) * 0.5;
    // (down the slope of the body toward the rear: the steeper, the more of each cell moves on)
    const k = Math.min(0.5, dt * 6 * (this.NX / 16) * Math.max(0, Math.tan(this.tip) - 0.25));   // (cells, finer: the faster across them)
    if (k <= 0) return 0;
    for (let ix = 1; ix < NX; ix++) for (let iz = 0; iz < NZ; iz++) {
      const i = iz * NX + ix, j = i - 1, m = Math.max(0, h[i] + s - h[j] * 0.2) * k;
      const mm = Math.min(h[i], m); h[i] -= mm; h[j] += mm;
    }
    // (out under the tailgate: the gate opens as the body rises)
    let out = 0;
    const open = Math.min(1, Math.max(0, (this.tip - 0.25) / 0.3));
    if (open > 0) for (let iz = 0; iz < NZ; iz++) { const i = iz * NX, m = h[i] * Math.min(1, dt * 3 * open); h[i] -= m; out += m * this.cA; }
    this.load = Math.max(0, this._hfVol() / this.cap + (this.air || 0)); this._hfLoad = this.load; this._hfDirty = true;
    return out;
  }
  // where it falls out (world): under the middle of the tailgate
  tailLip(out = new THREE.Vector3()) { return this.bed.localToWorld(out.set(this.x0 - this.hx * 0.02, this.floor, 0)); }
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
    const want = Math.max(0, this.load - (this.air || 0)) * this.cap, have = this._hfVol();   // (what is still falling is not in the grid yet)
    if (Math.abs(want - have) < this.cap * 0.002) return;
    if (want <= 1e-9) this.hf.fill(0);
    else if (want < have) { const k = want / have; for (let i = 0; i < this.hf.length; i++) this.hf[i] *= k; }
    else { const l = this.load; this.load = have / this.cap; this.pourAt(this.bed.localToWorld(new THREE.Vector3(this.x0 + this.hx * 0.5, 0, 0)), want / this.cap - this.load, true); this.load = l; this._quiet = true; }
    this._hfDirty = true;
  }
  // it slumps: each pair of cells steeper than its repose shares the excess (sweeps till it rests); against the sides
  // it lies no higher than their tops — what comes over a top runs off it (`spills`, to the ground): heaped over the
  // body it keeps only the cone its angle of repose holds, as a real load does
  _slump() {
    const NX = this.NX, NZ = this.NZ, h = this.hf, dx = this.hx / (NX - 1), dz = this.hz / (NZ - 1), w = this.mixW();
    let rep = 0; for (let k = 0; k < 5; k++) rep += w[k] * MATERIALS[k].repose;
    const eps = this.hx * 2e-5, side = this.rim - this.floor, head = this.rimFront - this.floor, tipped = this.tip > 0.05;
    const over = (this._over ||= new Float32Array(NX * NZ));
    let moved = false, any = false;
    for (let it = 0; it < 40; it++) {
      let m0 = false;
      for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
        const i = iz * NX + ix;
        for (const [j, d] of [[ix + 1 < NX ? i + 1 : -1, dx], [iz + 1 < NZ ? i + NX : -1, dz]]) {
          if (j < 0) continue;
          const diff = h[i] - h[j], lim = rep * d;
          if (Math.abs(diff) > lim + eps) { const m = (Math.abs(diff) - lim) / 2 * Math.sign(diff); h[i] -= m; h[j] += m; m0 = true; }
        }
      }
      // (the cells along the sides and the tailgate: at most their tops; along the headboard, its top)
      if (!tipped) for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
        if (iz > 0 && iz < NZ - 1 && ix > 0 && ix < NX - 1) continue;
        const i = iz * NX + ix, top = ix === NX - 1 && iz > 0 && iz < NZ - 1 ? head : side;
        if (h[i] > top + eps) { over[i] += h[i] - top; h[i] = top; any = true; m0 = true; }
      }
      if (!m0) break;
      moved = true;
    }
    if (any) {
      // (over the side: a share of a body less in it; set from a record it was at rest — nothing to drop)
      let v = 0;
      for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
        const i = iz * NX + ix; if (!(over[i] > 0)) continue;
        const vol = over[i] * this.cA; v += vol; over[i] = 0;
        if (this._quiet) continue;
        const sx = ix === 0 ? -1 : ix === NX - 1 && iz > 0 && iz < NZ - 1 ? 1 : 0, sz = sx ? 0 : iz === 0 ? -1 : 1;
        const lx = sx < 0 ? this.x0 - R(0.12) : sx > 0 ? this.x0 + this.hx + R(0.12) : this.x0 + ix / (NX - 1) * this.hx;
        const lz = sz ? sz * (this.hz / 2 + R(0.12)) : (iz / (NZ - 1) - 0.5) * this.hz;
        const p = this.bed.localToWorld(new THREE.Vector3(lx, (sx > 0 ? this.rimFront : this.rim) + R(0.02), lz));
        const n = new THREE.Vector3(sx, 0, sz).transformDirection(this.bed.matrixWorld); n.y = 0; n.normalize();
        this.spills.push({ p, n, v: vol });
      }
      this.load = Math.max(0, this.load - v / this.cap); this._hfLoad = this.load;
    }
    if (!moved) { this._quiet = false; this._unsettled = false; }
    return moved;
  }
  update(dt) {
    if (!this.bed) return;
    this._landing(dt, this.tip >= 0.12);
    this.outflow = (this.outflow || 0) + this._flowOut(dt);
    this._sync();
    if (this._slump() || this._hfDirty) {
      this._hfDirty = false;
      const pos = this.soil.geometry.attributes.position;
      // (where nothing lies the sheet goes under the floor: the floor shows, the heap rises out of it)
      for (let i = 0; i < pos.count; i++) pos.setY(i, this.hf[i] > this.hx * 0.0015 ? this.hf[i] : -this.hx * 0.004);
      pos.needsUpdate = true; this.soil.geometry.computeVertexNormals();
    }
    if (this._mixDirty) { this._mixDirty = false; this.soil.material.setMix?.(this.mixW()); }
    this.tip += (this.tipGoal - this.tip) * (1 - Math.exp(-dt * 1.5));
    this.bed.rotation.z = this.tip;   // (+: the front up, on the rear hinge)
    if (this.gate) this.gate.rotation.z = -this.tip * 0.97;
    for (const w of this.wheels || []) { w.g.rotation.z = -(w.spin ?? this.spin ?? 0) / w.r; if (w.steer) w.steer.rotation.y = this.steer || 0; }
    this.soil.visible = this.load > 0.005;
  }
}
const _c = new THREE.Vector3();
