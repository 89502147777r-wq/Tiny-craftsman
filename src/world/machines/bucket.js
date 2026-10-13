import * as THREE from 'three';

// Physical bucket shared by the excavator and the loader. Each frame:
//   • the cutting edge (two anchors at the outer teeth) moves through the
//     ground → everything above the edge along its path is cut; it goes into
//     the bucket until it is full, the rest is pushed ahead of the edge;
//   • when the bucket's mouth turns downwards the load pours out as crumbs
//     (the faster, the more it is tipped).
// Volume is conserved exactly: terrain ↔ bucket ↔ falling crumbs ↔ terrain.
export class BucketPhysics {
  constructor(app, { edgeL, edgeR, mouth, capacity, heap }) {
    this.app = app;
    this.edgeL = edgeL; this.edgeR = edgeR;   // Object3D anchors at the outer teeth
    this.mouth = mouth;                       // Object3D in the cavity; its +Z axis points out of the mouth
    this.capacity = capacity;
    this.load = 0;
    this.heap = heap;                         // optional mesh showing the load
    this.prev = null;
    this.cutting = false;
    this.spilling = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._n = new THREE.Vector3();
  }

  get fill() { return this.load / this.capacity; }

  openDir(out = this._n) {
    return out.set(0, 0, 1).transformDirection(this.mouth.matrixWorld);
  }

  update(dt) {
    const t = this.app.terrain;
    const a = this.edgeL.getWorldPosition(this._a), b = this.edgeR.getWorldPosition(this._b);
    const c = this._c.addVectors(a, b).multiplyScalar(0.5);
    const width = Math.hypot(a.x - b.x, a.z - b.z) + 0.002;
    this.cutting = false;
    if (this.cutEnabled !== false && this.prev && t.inside(c.x, c.z)) {
      const dx = c.x - this.prev.x, dz = c.z - this.prev.z, dist = Math.hypot(dx, dz);
      const ground = t.heightAt(c.x, c.z);
      if (c.y < ground - 0.0003 && dist > 1e-6) {
        const fx = dx / dist, fz = dz / dist;
        const len = Math.max(dist, t.cell * 1.1);
        const spec = { width, length: len, pointed: false };
        const got = t.carve(c.x - fx * len / 2, c.z - fz * len / 2, fx, fz, spec, c.y, 1);
        if (got > 0) {
          this.cutting = true;
          const into = Math.min(got, Math.max(0, this.capacity - this.load));
          this.load += into;
          const pushed = got - into;
          if (pushed > 0) {
            // a full bucket bulldozes: the surplus heaps up in front of the edge
            const n = 3, lx = -fz, lz = fx;
            for (let i = 0; i < n; i++) {
              const o = (i / (n - 1) - 0.5) * width * 0.8;
              t.deposit(c.x + fx * 0.006 + lx * o, c.z + fz * 0.006 + lz * o, pushed / n, Math.max(0.004, width / 4));
            }
          }
        }
      }
    }
    this.prev = (this.prev || new THREE.Vector3()).copy(c);
    // pouring: how far the mouth faces down
    const n = this.openDir();
    const tip = Math.max(0, Math.min(1, (-n.y - 0.15) / 0.6));
    this.spilling = 0;
    if (this.load > 0 && tip > 0) {
      const out = Math.min(this.load, this.capacity * 1.8 * tip * dt + (this.load < this.capacity * 0.02 ? this.load : 0));
      this.load -= out;
      this.spilling = out;
      const parts = Math.max(1, Math.round(out / this.capacity * 260));
      const p = new THREE.Vector3(), v = new THREE.Vector3();
      const m = this.mouth.getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < parts; i++) {
        const k = Math.random();
        p.lerpVectors(a, b, 0.1 + 0.8 * k).lerp(m, 0.35 * Math.random());
        v.copy(n).multiplyScalar(0.04 + Math.random() * 0.05).add(new THREE.Vector3((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04));
        this.app.particles.emit(p, v, out / parts, (0.0012 + Math.pow(Math.random(), 3) * 0.0028), 0.35);
      }
      if (this.load < 1e-12) this.load = 0;
    }
    if (this.heap) {
      this._shown = (this._shown || 0) + (this.fill - (this._shown || 0)) * Math.min(1, dt * 8);
      this.heap.visible = this._shown > 0.02;
      this.heap.scale.setScalar(Math.cbrt(Math.max(0, this._shown)));
    }
  }

  reset() { this.prev = null; }
}
