import * as THREE from 'three';
import { Machine } from './machine.js';
import { loadModel, findNode, normalise } from './models.js';
import { BucketPhysics } from './bucket.js';
import { R, machineMaterials, box, cyl, profile, Hydraulic } from './parts.js';

// Wheeled machines on CC-BY models (see CREDITS.md): a tractor with a front
// loader, a truck mixer on a KAMAZ chassis, a towed concrete pump and a site
// drum mixer. Wheeled vehicles steer like cars (bicycle model).
class WheeledMachine extends Machine {
  constructor(app, kind, { wheelbase, vmax = R(2.5), steerMax = 0.55 }) {
    super(app, kind);
    this.wheelbase = wheelbase;
    this.vmax = vmax;
    this.steerMax = steerMax;
    this.steerAngle = 0;
    this.wheelRot = 0;
    this.wheels = [];      // { pivot, radius, steer }
  }

  // footprint contacts + keep-inside radius from the model's bounding box
  fitContacts() {
    const box = new THREE.Box3().setFromObject(this.holder);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    box.applyMatrix4(inv);
    const x0 = box.min.x * 0.8, x1 = box.max.x * 0.8, z = Math.min(Math.abs(box.min.z), box.max.z) * 0.85;
    this.contacts = [[x0, -z], [x0, z], [x1, -z], [x1, z]];
    this.radius = Math.max(Math.abs(box.min.x), box.max.x) * 0.9;
    this.half = [Math.max(Math.abs(box.min.x), box.max.x) * 0.95, Math.max(Math.abs(box.min.z), box.max.z) * 0.95];
    this.size = box;
  }

  // put a wheel (any node) on a pivot at its bounding-box centre so it can roll
  wheel(node, steer = false) {
    if (!node) return;
    const parent = node.parent;
    const bb = new THREE.Box3().setFromObject(node);
    const c = bb.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    parent.worldToLocal(c);
    pivot.position.copy(c);
    parent.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(node);
    // the machine's lateral axis expressed in the wheel's parent space
    const qp = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(qp).normalize();
    this.wheels.push({ pivot, axis, radius: bb.getSize(new THREE.Vector3()).y / 2, steer });
  }

  drive(dt) {
    this.v += (this.throttle * this.vmax - this.v) * Math.min(1, dt * 2.2);
    if (!this.throttle && Math.abs(this.v) < R(0.01)) this.v = 0;
    this.steerAngle += (this.steer * this.steerMax - this.steerAngle) * Math.min(1, dt * 4);
    const ds = this.v * dt;
    this.yaw -= ds / this.wheelbase * Math.tan(this.steerAngle);
    const f = this.forward();
    this.x += f.x * ds; this.z += f.y * ds;
    this.keepInside();
    this.wheelRot += ds;
    this.moved += Math.abs(ds);
    for (const w of this.wheels) w.pivot.quaternion.setFromAxisAngle(w.axis, -this.wheelRot / Math.max(1e-4, w.radius));
  }
}

// ---------------------------------------------------------------------------------------------------
export class Tractor extends WheeledMachine {
  constructor(app) {
    super(app, 'tractor', { wheelbase: R(2.0), vmax: R(2.8) });
    this.mats = machineMaterials(0xb7372a);
    this.j = { lift: 0, tilt: 0 };
    this.t = { ...this.j };
    this.mode = 'carry';
    this.ready = this.build();
  }

  async build() {
    const { scene } = await loadModel('tractor');
    const { holder } = normalise(scene, { forward: '+x', length: R(3.3) });
    this.holder = holder;
    this.body.add(holder);
    this.root.updateMatrixWorld(true);
    this.wheel(findNode(scene, 'frontTire'));
    this.wheel(findNode(scene, 'backTire'));
    this.fitContacts();
    this._loader();
    this.setBucket('carry');
    this.updateJoints(1, true);
    this.followGround(0, true);
    return this;
  }

  _loader() {
    const m = this.mats, b = this.body, sz = this.size;
    const front = sz.max.x, width = sz.max.z - sz.min.z;
    this.tower = [front * 0.28, R(1.2)];
    this.armL = front * 0.72 + R(0.85);
    this.bucketW = width * 0.98;
    for (const s of [-1, 1]) b.add(box(R(0.14), R(0.75), R(0.07), m.paint, this.tower[0], this.tower[1] - R(0.38), s * (width * 0.45), R(0.02)));
    this.arms = new THREE.Group();
    this.arms.position.set(this.tower[0], this.tower[1], 0);
    b.add(this.arms);
    const L = this.armL;
    const armProf = [[0, -R(0.05)], [L * 0.55, -R(0.13)], [L, -R(0.06)], [L, R(0.04)], [L * 0.55, -R(0.03)], [0, R(0.06)]];
    for (const s of [-1, 1]) { const a = profile(armProf, R(0.08), m.paint); a.position.z = s * width * 0.46; this.arms.add(a); }
    this.arms.add(box(R(0.08), R(0.08), width * 0.92, m.paint, L * 0.6, -R(0.08), 0, R(0.02)));
    this.bucketG = new THREE.Group();
    this.bucketG.position.set(L, 0, 0);
    this.arms.add(this.bucketG);
    const W = this.bucketW;
    // bucket side profile (pin at origin), open towards +x, cutting edge forward-down
    const outer = [[0.0, 0.25], [-0.07, 0.1], [-0.05, -0.2], [0.05, -0.36], [0.5, -0.42]].map(([x, y]) => [R(x), R(y)]);
    const inner = outer.map(([x, y]) => [x + R(0.025), y + R(0.025)]).reverse();
    this.bucketG.add(profile([...outer, ...inner], W, m.dark));
    for (const s of [-1, 1]) {
      const side = profile([[0.0, 0.25], [-0.07, 0.1], [-0.05, -0.2], [0.05, -0.36], [0.5, -0.42], [0.32, 0.06]].map(([x, y]) => [R(x), R(y)]), R(0.015), m.dark);
      side.position.z = s * W / 2;
      this.bucketG.add(side);
    }
    this.bucketG.add(box(R(0.07), R(0.016), W, m.steel, R(0.5), R(-0.42), 0));
    const anchor = (parent, x, y, z = 0) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    const edgeL = anchor(this.bucketG, R(0.52), R(-0.42), -W * 0.46), edgeR = anchor(this.bucketG, R(0.52), R(-0.42), W * 0.46);
    const mouth = anchor(this.bucketG, R(0.2), R(-0.15));
    mouth.lookAt(new THREE.Vector3(R(1), R(0.6), 0).add(new THREE.Vector3())); // will be re-aimed in local space below
    mouth.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.75, 0.66, 0).normalize());
    const heap = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.app.shovel.loadMat);
    dome.rotation.x = Math.PI / 2;
    dome.scale.set(W * 0.42, R(0.22), R(0.22));
    heap.add(dome);
    mouth.add(heap);
    heap.visible = false;
    this.bucketPhys = new BucketPhysics(this.app, { edgeL, edgeR, mouth, capacity: Math.pow(R(1), 3) * 0.2, heap });
    this.cyls = [];
    for (const s of [-1, 1]) {
      const c = new Hydraulic(R(0.045), R(0.025), R(0.6), m).attach(anchor(b, this.tower[0] + R(0.05), this.tower[1] - R(0.65), s * width * 0.4), anchor(this.arms, L * 0.45, -R(0.12), s * width * 0.4));
      b.add(c.group); this.cyls.push(c);
      const t = new Hydraulic(R(0.038), R(0.022), R(0.5), m).attach(anchor(this.arms, L * 0.62, R(0.02), s * width * 0.38), anchor(this.bucketG, -R(0.02), R(0.22), s * width * 0.38));
      this.arms.add(t.group); this.cyls.push(t);
    }
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // arm angle putting the cutting edge at height h (machine frame, bucket level)
  liftForEdge(h) {
    const s = (h - R(-0.42) - this.tower[1]) / this.armL;
    return Math.asin(Math.max(-1, Math.min(1, s)));
  }

  setBucket(mode) {
    this.mode = mode;
    if (mode === 'dig') { this.t.lift = this.liftForEdge(-R(0.05)); this.t.tilt = 0.05; }
    if (mode === 'carry') { this.t.lift = this.liftForEdge(R(0.35)); this.t.tilt = 0.75; }
    if (mode === 'raise') { this.t.lift = 0.55; this.t.tilt = 0.75; }
    // dumping: lift clear of the heap first (a loader never tips at ground level)
    if (mode === 'dump') { this.t.lift = Math.max(this.t.lift, this.liftForEdge(R(1.0))); this.t.tilt = -1.05; }
  }

  updateJoints(dt, snap = false) {
    if (!this.arms) return;
    const lim = { lift: 0.5, tilt: 1.2 };
    for (const k of Object.keys(lim)) {
      const d = this.t[k] - this.j[k], mx = lim[k] * dt;
      this.j[k] += snap ? d : Math.sign(d) * Math.min(Math.abs(d), mx);
    }
    this.arms.rotation.z = this.j.lift;
    this.bucketG.rotation.z = -this.j.lift + this.j.tilt; // parallel linkage keeps the bucket angle
    this.root.updateMatrixWorld(true);
    for (const c of this.cyls) c.update();
  }

  update(dt) {
    if (!this.arms) return;
    this.drive(dt);
    this.followGround(dt);
    this.updateJoints(dt);
    this.root.updateMatrixWorld(true);
    this.bucketPhys.update(dt);
    if (this.mode === 'dump' && this.bucketPhys.load <= 0 && Math.abs(this.j.tilt - this.t.tilt) < 0.05) { this.mode = 'raise'; this.t.tilt = 0.75; }
  }

  get load() { return this.bucketPhys ? this.bucketPhys.load : this._load || 0; }
  set load(v) { if (this.bucketPhys) this.bucketPhys.load = v; else this._load = v; }

  record() { return { ...this.baseRecord(), mode: this.mode === 'dump' ? 'carry' : this.mode }; }
  apply(r) {
    this.applyBase(r);
    if (!this.arms) return;
    this.setBucket(r.mode || 'carry');
    this.updateJoints(1, true);
    this.bucketPhys.reset();
  }
}

// ---------------------------------------------------------------------------------------------------
export class MixerTruck extends WheeledMachine {
  constructor(app) {
    super(app, 'mixer', { wheelbase: R(3.8), vmax: R(3.5), steerMax: 0.5 });
    this.drumSpeed = 0.9;     // rad/s, slow mixing
    this.chute = 0;
    this.t = { chute: 0 };
    this.ready = this.build();
  }

  async build() {
    const { scene } = await loadModel('kamaz');
    // the canvas cargo body goes; the drum goes on the bare chassis
    for (const n of ['Kung_1', 'Object_6']) { const o = findNode(scene, n); if (o) o.visible = false; }
    const { holder } = normalise(scene, { forward: '+z', length: R(7.1) });
    this.holder = holder;
    this.body.add(holder);
    this.root.updateMatrixWorld(true);
    this.fitContacts();
    this._drum();
    this.followGround(0, true);
    return this;
  }

  _drum() {
    const box3 = this.size;
    const rear = box3.min.x, top = R(1.25);
    const m = machineMaterials(0xffffff);
    // classic white drum with orange spiral stripes
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#ecebe6'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#e8701c';
    for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 120, 256); g.lineTo(i * 120 + 50, 256); g.lineTo(i * 120 + 170, 0); g.lineTo(i * 120 + 120, 0); g.fill(); }
    g.globalAlpha = 0.15; g.fillStyle = '#5a4a3a';
    for (let i = 0; i < 400; i++) g.fillRect(Math.random() * 512, 200 + Math.random() * 56, 2 + Math.random() * 6, 1 + Math.random() * 3);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
    const drumMat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    // drum profile along its axis (y in lathe space): rear opening → widest → front cap
    const P = [[0.32, 0], [0.42, 0.25], [0.95, 1.7], [1.12, 2.35], [1.1, 3.1], [0.82, 3.85], [0.35, 4.25], [0.0, 4.3]];
    const curve = new THREE.SplineCurve(P.map(([r, y]) => new THREE.Vector2(R(r), R(y))));
    const lathe = new THREE.LatheGeometry(curve.getPoints(40), 48);
    const drum = new THREE.Mesh(lathe, drumMat);
    drum.castShadow = drum.receiveShadow = true;
    // the inner spiral blade seen through the opening
    const helix = [];
    for (let i = 0; i <= 80; i++) { const a = i / 80 * Math.PI * 5, y = 0.05 + i / 80 * 0.9; helix.push(new THREE.Vector3(Math.cos(a) * R(0.28), R(y), Math.sin(a) * R(0.28))); }
    const blade = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 120, R(0.03), 5, false), m.dark);
    this.drumSpin = new THREE.Group();
    this.drumSpin.add(drum, blade);
    // axis: from the rear opening (high) forward-down at ~13°
    this.drumAxis = new THREE.Group();
    this.drumAxis.position.set(rear + R(0.55), top + R(1.75), 0);
    this.drumAxis.rotation.z = -Math.PI / 2 - 0.2;
    this.drumAxis.rotation.y = 0;
    this.drumAxis.add(this.drumSpin);
    this.body.add(this.drumAxis);
    // drum supports, hopper, chute, water tank, ladder, frame
    const dark = machineMaterials(0x2a2c2e).paint;
    this.body.add(box(R(4.4), R(0.12), R(0.9), dark, rear + R(2.6), top + R(0.05), 0));
    this.body.add(box(R(0.25), R(1.0), R(0.9), dark, rear + R(4.4), top + R(0.55), 0));
    this.body.add(box(R(0.25), R(1.65), R(1.2), dark, rear + R(0.75), top + R(0.85), 0));
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(R(0.42), R(0.16), R(0.5), 16, 1, true), m.dark);
    hopper.position.set(rear + R(0.45), top + R(2.05), 0); hopper.rotation.z = -0.35;
    this.body.add(hopper);
    this.chuteG = new THREE.Group();
    this.chuteG.position.set(rear + R(0.25), top + R(1.25), 0);
    const chute = new THREE.Mesh(new THREE.CylinderGeometry(R(0.2), R(0.2), R(1.5), 12, 1, true, 0, Math.PI), m.dark);
    chute.rotation.z = Math.PI / 2 - 0.4; chute.position.x = -R(0.65); chute.position.y = -R(0.25);
    chute.material = chute.material.clone(); chute.material.side = THREE.DoubleSide;
    this.chuteG.add(chute);
    this.body.add(this.chuteG);
    const tank = cyl(R(0.3), R(1.0), new THREE.MeshStandardMaterial({ color: 0x3c6aa8, roughness: 0.35, metalness: 0.4 }), 'z', 18);
    tank.position.set(rear + R(4.85), top + R(0.32), 0);
    this.body.add(tank);
    for (let i = 0; i < 7; i++) this.body.add(box(R(0.04), R(0.04), R(0.45), m.steel, rear + R(0.05), top + R(0.2) + i * R(0.28), R(0.6)));
    for (const s of [-1, 1]) this.body.add(box(R(0.04), R(2.0), R(0.04), m.steel, rear + R(0.05), top + R(1.0), R(0.6) + s * R(0.22)));
    this.body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  update(dt) {
    if (!this.holder) return;
    this.drive(dt);
    this.followGround(dt);
    if (this.drumSpin) this.drumSpin.rotation.y += this.drumSpeed * dt;
    this.chute += (this.t.chute - this.chute) * Math.min(1, dt * 2);
    if (this.chuteG) this.chuteG.rotation.y = this.chute;
  }

  record() { return { ...this.baseRecord(), chute: +this.t.chute.toFixed(3) }; }
  apply(r) { this.applyBase(r); this.t.chute = r.chute || 0; }
}

// ---------------------------------------------------------------------------------------------------
export class ConcretePump extends WheeledMachine {
  constructor(app) {
    super(app, 'pump', { wheelbase: R(2.2), vmax: R(1.5), steerMax: 0.6 });
    this.ready = this.build();
  }

  async build() {
    const { scene } = await loadModel('concrete-pump');
    const { holder } = normalise(scene, { forward: '+x', height: R(1.55) });
    this.holder = holder;
    this.body.add(holder);
    this.root.updateMatrixWorld(true);
    this.fitContacts();
    this.followGround(0, true);
    return this;
  }

  update(dt) { if (!this.holder) return; this.drive(dt); this.followGround(dt); }
  record() { return this.baseRecord(); }
  apply(r) { this.applyBase(r); }
}

// A drum mixer for small pours, standing at the parking (set dressing for now).
export class SiteMixer extends Machine {
  constructor(app) {
    super(app, 'siteMixer');
    this.radius = R(0.9);
    this.ready = (async () => {
      const { scene } = await loadModel('site-mixer');
      const { holder } = normalise(scene, { forward: '+x', height: R(1.45) });
      this.holder = holder;
      this.body.add(holder);
      this.root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(holder);
      const s = b.getSize(new THREE.Vector3());
      this.contacts = [[-s.x * 0.35, -s.z * 0.35], [-s.x * 0.35, s.z * 0.35], [s.x * 0.35, 0]];
      this.followGround(0, true);
      return this;
    })();
  }
  update(dt) { if (this.holder) this.followGround(dt); }
  record() { return this.baseRecord(); }
  apply(r) { this.applyBase(r); }
}
