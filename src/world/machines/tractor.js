import * as THREE from 'three';
import { Machine } from './machine.js';
import { R, machineMaterials, box, cyl, profile, Hydraulic, makeWheel } from './parts.js';

// 1:12 compact tractor (≈25 hp) with a front loader. Local frame: +X forward,
// rear axle at x = 0.
const D = {
  wheelbase: 1.45, track: 1.0,
  rearR: 0.43, rearW: 0.28, frontR: 0.28, frontW: 0.18,
  tower: [0.55, 1.05],               // loader arm pivot (x, y) above ground
  armL: 1.62,                        // arm pivot → bucket pin
  bucketW: 1.25,
};

export class Tractor extends Machine {
  constructor(app) {
    super(app, 'tractor');
    this.mats = machineMaterials(0xe2661a);
    this.contacts = [[0, R(-D.track / 2)], [0, R(D.track / 2)], [R(D.wheelbase), R(-D.track / 2)], [R(D.wheelbase), R(D.track / 2)]];
    this.radius = R(1.2);
    this.j = { lift: 0.0, tilt: 0.0, steer: 0 };
    this.t = { ...this.j };
    this.wheelRot = 0;
    this.capacity = Math.pow(R(1), 3) * 0.16;   // 0.16 m³ bucket
    this.dumping = 0;
    this.build();
    this.mode = 'carry';
    this.setBucket('carry');
    this.updateJoints(1, true);
  }

  build() {
    const m = this.mats;
    const b = this.body;
    // wheels
    this.wheels = [];
    for (const s of [-1, 1]) {
      const rw = makeWheel(R(D.rearR), R(D.rearW), m, 0xf2f0e8, 20);
      rw.position.set(0, R(D.rearR), R(s * D.track / 2));
      if (s < 0) rw.rotation.y = Math.PI;
      b.add(rw);
      const steerG = new THREE.Group();
      steerG.position.set(R(D.wheelbase), R(D.frontR), R(s * (D.track - 0.12) / 2));
      const fw = makeWheel(R(D.frontR), R(D.frontW), m, 0xf2f0e8, 16);
      if (s < 0) fw.rotation.y = Math.PI;
      steerG.add(fw);
      b.add(steerG);
      this.wheels.push({ rear: rw, front: fw, steer: steerG, side: s });
    }
    // chassis, engine hood, grille, axles
    b.add(box(R(1.75), R(0.22), R(0.36), m.dark, R(0.85), R(0.42), 0, R(0.03)));
    const hood = box(R(1.05), R(0.42), R(0.56), m.paint, R(1.25), R(0.82), 0, R(0.08));
    b.add(hood);
    b.add(box(R(0.06), R(0.38), R(0.5), m.dark, R(1.79), R(0.8), 0, R(0.02)));
    for (const s of [-1, 1]) {
      b.add(box(R(0.04), R(0.06), R(0.1), m.lamp, R(1.8), R(0.92), R(s * 0.17)));
      b.add(box(R(0.5), R(0.05), R(0.02), m.dark, R(1.3), R(0.72), R(s * 0.285)));
    }
    b.add(cyl(R(0.05), R(D.track - 0.2), m.dark, 'z', 10).translateX(R(D.wheelbase)).translateY(R(D.frontR)));
    b.add(cyl(R(0.07), R(D.track - 0.3), m.dark, 'z', 12).translateY(R(D.rearR)));
    // transmission / platform, fenders, seat, steering, ROPS
    b.add(box(R(0.7), R(0.35), R(0.5), m.dark, R(0.1), R(0.62), 0, R(0.04)));
    b.add(box(R(0.75), R(0.04), R(0.95), m.dark, R(0.25), R(0.74), 0, R(0.01)));
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI * (0.05 + 0.85 * i / 12); pts.push([Math.cos(a) * (D.rearR + 0.08), Math.sin(a) * (D.rearR + 0.08)]); }
      for (let i = 12; i >= 0; i--) { const a = Math.PI * (0.05 + 0.85 * i / 12); pts.push([Math.cos(a) * (D.rearR + 0.04), Math.sin(a) * (D.rearR + 0.04)]); }
      const fender = profile(pts.map(([x, y]) => [R(x), R(y)]), R(D.rearW + 0.08), m.paint);
      fender.position.set(0, R(D.rearR), R(s * D.track / 2));
      b.add(fender);
    }
    const seat = new THREE.Group(); seat.position.set(R(-0.05), R(0.95), 0); b.add(seat);
    seat.add(box(R(0.42), R(0.1), R(0.45), m.seat, 0, 0, 0, R(0.04)));
    const back = box(R(0.08), R(0.42), R(0.45), m.seat, R(-0.2), R(0.22), 0, R(0.03)); back.rotation.z = -0.2; seat.add(back);
    const col = cyl(R(0.03), R(0.5), m.dark, 'y', 8); col.position.set(R(0.55), R(1.05), 0); col.rotation.z = 0.55; b.add(col);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(R(0.17), R(0.018), 6, 24), m.seat);
    wheel.position.set(R(0.42), R(1.28), 0); wheel.rotation.y = Math.PI / 2; wheel.rotation.x = 0.55; b.add(wheel);
    for (const s of [-1, 1]) b.add(box(R(0.06), R(1.25), R(0.06), m.dark, R(-0.35), R(1.3), R(s * 0.48), R(0.01)));
    b.add(box(R(0.06), R(0.06), R(1.02), m.dark, R(-0.35), R(1.93), 0, R(0.01)));
    // three-point hitch
    for (const s of [-1, 1]) { const arm = box(R(0.55), R(0.05), R(0.04), m.dark, R(-0.42), R(0.4), R(s * 0.25)); arm.rotation.z = 0.25; b.add(arm); }

    // ---- front loader ---------------------------------------------------------------------
    for (const s of [-1, 1]) b.add(box(R(0.16), R(0.62), R(0.08), m.paint, R(D.tower[0]), R(D.tower[1] - 0.3), R(s * 0.47), R(0.02)));
    this.arms = new THREE.Group();
    this.arms.position.set(R(D.tower[0]), R(D.tower[1]), 0);
    b.add(this.arms);
    const armProf = [[0, -0.05], [0.9, -0.12], [1.62, -0.06], [1.62, 0.04], [0.9, -0.02], [0, 0.06]].map(([x, y]) => [R(x), R(y)]);
    for (const s of [-1, 1]) { const a = profile(armProf, R(0.08), m.paint); a.position.z = R(s * 0.5); this.arms.add(a); }
    this.arms.add(box(R(0.08), R(0.08), R(1.0), m.paint, R(0.95), R(-0.08), 0, R(0.02)));
    this.bucketG = new THREE.Group();
    this.bucketG.position.set(R(D.armL), 0, 0);
    this.arms.add(this.bucketG);
    // bucket: pin at origin, cutting edge forward-down; open towards +x
    const W = R(D.bucketW);
    const outer = [[0.0, 0.25], [-0.06, 0.1], [-0.04, -0.18], [0.05, -0.32], [0.45, -0.38]].map(([x, y]) => [R(x), R(y)]);
    const inner = outer.map(([x, y]) => [x + R(0.02), y + R(0.02)]).reverse();
    const shell = profile([...outer, ...inner], W, m.paint);
    this.bucketG.add(shell);
    for (const s of [-1, 1]) {
      const side = profile([[0.0, 0.25], [-0.06, 0.1], [-0.04, -0.18], [0.05, -0.32], [0.45, -0.38], [0.3, 0.05]].map(([x, y]) => [R(x), R(y)]), R(0.015), m.paint);
      side.position.z = s * W / 2;
      this.bucketG.add(side);
    }
    this.bucketG.add(box(R(0.06), R(0.015), W, m.steel, R(0.45), R(-0.38), 0));
    this.heap = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.app.shovel.loadMat);
    this.heap.position.set(R(0.12), R(-0.2), 0);
    this.heap.visible = false;
    this.bucketG.add(this.heap);
    const anchor = (parent, x, y) => { const o = new THREE.Object3D(); o.position.set(R(x), R(y), 0); parent.add(o); return o; };
    this.cyls = [];
    for (const s of [-1, 1]) {
      const a1 = anchor(b, D.tower[0] + 0.05, D.tower[1] - 0.55); a1.position.z = R(s * 0.4);
      const a2 = anchor(this.arms, 0.65, -0.12); a2.position.z = R(s * 0.4);
      const c = new Hydraulic(R(0.04), R(0.022), R(0.55), m).attach(a1, a2);
      b.add(c.group);
      this.cyls.push(c);
      const t1 = anchor(this.arms, 0.95, 0.02); t1.position.z = R(s * 0.4);
      const t2 = anchor(this.bucketG, -0.02, 0.22); t2.position.z = R(s * 0.4);
      const ct = new Hydraulic(R(0.035), R(0.02), R(0.45), m).attach(t1, t2);
      this.arms.add(ct.group);
      this.cyls.push(ct);
    }
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // loader positions: dig (edge on the ground), carry (low, curled), raise (high), dump
  setBucket(mode) {
    this.mode = mode;
    if (mode === 'dig') { this.t.lift = this.liftForEdge(-R(0.02)); this.t.tilt = 0.0; }
    if (mode === 'carry') { this.t.lift = this.liftForEdge(R(0.3)); this.t.tilt = 0.6; }
    if (mode === 'raise') { this.t.lift = 0.5; this.t.tilt = 0.6; }
    if (mode === 'dump') { this.t.tilt = -0.9; this.dumping = 1.2; }
  }

  // arm angle that puts the bucket's cutting edge at height h (machine frame, level bucket)
  liftForEdge(h) {
    const py = R(D.tower[1]), edge = R(-0.38);
    const s = (h - edge - py) / R(D.armL);
    return Math.asin(Math.max(-1, Math.min(1, s)));
  }

  updateJoints(dt, snap = false) {
    const lim = { lift: 0.6, tilt: 1.5 };
    for (const k of Object.keys(lim)) {
      const d = this.t[k] - this.j[k], mx = lim[k] * dt;
      this.j[k] += snap ? d : Math.max(-mx, Math.min(mx, d * Math.min(1, dt * 8)));
    }
    this.arms.rotation.z = this.j.lift;
    // keep the bucket orientation independent of the arm angle (parallel linkage)
    this.bucketG.rotation.z = -this.j.lift + this.j.tilt;
    this.root.updateMatrixWorld(true);
    for (const c of this.cyls) c.update();
  }

  update(dt) {
    const vmax = R(2.2), dmax = 0.6;
    this.v += (this.throttle * vmax - this.v) * Math.min(1, dt * 2.5);
    this.j.steer += (this.steer * dmax - this.j.steer) * Math.min(1, dt * 5);
    const f = this.forward();
    const ds = this.v * dt;
    // bicycle model around the rear axle
    this.yaw -= ds / R(D.wheelbase) * Math.tan(this.j.steer);
    this.x += f.x * ds; this.z += f.y * ds;
    this.keepInside();
    const dist = Math.abs(ds);
    this.moved += dist;
    this.wheelRot += ds;
    for (const w of this.wheels) {
      w.rear.rotation.z = -this.wheelRot / R(D.rearR) * (w.side < 0 ? -1 : 1);
      w.front.rotation.z = -this.wheelRot / R(D.frontR) * (w.side < 0 ? -1 : 1);
      w.steer.rotation.y = -this.j.steer;
    }
    this.followGround(dt);
    this.updateJoints(dt);
    // bucket on the ground while driving forward: fill it, then push the rest
    if (this.mode === 'dig' && ds > 0) {
      const edge = this.local(R(D.tower[0] + D.armL * Math.cos(this.j.lift) + 0.45), 0);
      const g = this.groundAt(this.x + f.x * R(0.8), this.z + f.y * R(0.8));
      const got = this.bulldoze(edge, R(D.bucketW), Math.min(g, this.groundAt(edge.x, edge.z)) - R(0.025), dist, this.capacity - this.load);
      this.load += got;
    }
    if (this.mode === 'dump') this._dump(dt);
    this._shown = (this._shown || 0) + (this.load / this.capacity - (this._shown || 0)) * 0.2;
    this.heap.visible = this._shown > 0.02;
    if (this.heap.visible) { const s = Math.cbrt(this._shown); this.heap.scale.set(R(0.22) * s, R(0.2) * s, R(D.bucketW * 0.45) * s); }
  }

  // tip the bucket: soil streams out of its mouth as crumbs that land on the
  // ground; the bucket stays tipped until it is empty
  _dump(dt) {
    this.dumping -= dt;
    if (this.j.tilt > -0.3) { if (this.dumping < -2) this.setBucket('carry'); return; } // still tipping
    if (this.load > 0) {
      const out = Math.min(this.load, this.capacity * 1.4 * dt);
      this.load -= out;
      const n = Math.max(1, Math.round(out / this.capacity * 220));
      const p = new THREE.Vector3(), v = new THREE.Vector3(), f = this.forward();
      for (let i = 0; i < n; i++) {
        p.set(R(0.3 + Math.random() * 0.15), R(-0.3), (Math.random() - 0.5) * R(D.bucketW) * 0.85);
        this.bucketG.localToWorld(p);
        v.set(f.x * 0.05 + (Math.random() - 0.5) * 0.04, -0.02, f.y * 0.05 + (Math.random() - 0.5) * 0.04);
        this.app.particles.emit(p, v, out / n, 0.0012 + Math.pow(Math.random(), 3) * 0.002, 0.35);
      }
    }
    if (this.load <= 1e-12) { this.load = 0; if (this.dumping <= 0) this.setBucket('carry'); }
  }

  record() { return { ...this.baseRecord(), mode: this.mode === 'dump' ? 'carry' : this.mode }; }
  apply(r) {
    this.applyBase(r);
    this.setBucket(r.mode || 'carry');
    this.updateJoints(1, true);
  }
}
