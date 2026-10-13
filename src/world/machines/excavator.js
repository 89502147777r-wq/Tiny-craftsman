import * as THREE from 'three';
import { Machine } from './machine.js';
import { loadModel, findNode, normalise } from './models.js';
import { BucketPhysics } from './bucket.js';
import { R } from './parts.js';

// Mini excavator on the CC-BY "Excavator" model by tori1243 (see CREDITS).
// Its parts form the real kinematic chain:
//   undercarriage → slewing upper → boom → stick → bucket (+ thumb)
// Joint axes and lengths are measured from the model at load time, so the
// inverse kinematics matches the geometry exactly. The bucket teeth cut the
// ground wherever they actually travel (BucketPhysics).
//
// Work cycle in "auto" mode (one finger on the ground):
//   swing to the stroke → reach out with the bucket open → teeth into the
//   ground → drag towards the cab while curling → lift the full bucket →
//   (tap) swing over the dump spot → open the bucket → back to travel pose.
// "Manual" mode: two ISO joysticks like in a real cab
//   left:  ← → swing, ↑ ↓ stick out / in      right: ← → bucket curl / dump, ↑ ↓ boom down / up
export class Excavator extends Machine {
  constructor(app) {
    super(app, 'excavator');
    this.radius = R(1.2);
    this.contacts = [];
    this.j = { slew: 0, boom: 0, stick: 0, bucket: 0, claw: 0 };   // joint offsets from the model's rest pose (rad)
    this.t = { ...this.j };
    this.speed = { slew: 0.7, boom: 0.45, stick: 0.6, bucket: 1.1, claw: 0.6 }; // rad/s, like a real mini excavator
    this.mode = 'auto';
    this.cycle = null;       // current auto work cycle
    this.manual = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this.trackPhase = [0, 0];
    this.ready = this.build();
  }

  async build() {
    const { scene } = await loadModel('excavator');
    const n = (name) => findNode(scene, name);
    this.nodes = { under: n('Tread_GEO'), upper: n('Body_GEO'), boom: n('arm_01_GEO1'), stick: n('Arm_2_GEO'), bucket: n('shovel_GEO'), claw: n('claw_GEO') };
    // undo the clip's baked offsets: the model's own animation also moved the tracks
    const { holder } = normalise(scene, { forward: '-z', length: null, height: R(2.5), pivot: this.nodes.upper });
    this.body.add(holder);
    this.holder = holder;
    for (const k of Object.keys(this.nodes)) this.nodes[k].userData.rest = this.nodes[k].quaternion.clone();
    this.root.updateMatrixWorld(true);
    this._measure();
    this._buildBucket();
    // ground contacts: corners of the track footprint
    const tb = new THREE.Box3().setFromObject(this.nodes.under);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    tb.applyMatrix4(inv);
    for (const x of [tb.min.x * 0.8, 0, tb.max.x * 0.8]) for (const z of [tb.min.z * 0.85, tb.max.z * 0.85]) this.contacts.push([x, z]);
    this.trackLen = tb.max.x - tb.min.x;
    this.travelPose();
    this.applyJoints(1, true);
    this.followGround(0, true);
    return this;
  }

  // ---- geometry measured from the model ----------------------------------------------------
  _measure() {
    const w = (o) => o.getWorldPosition(new THREE.Vector3());
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const N = this.nodes;
    // "arm frame": the machine frame turned so the arm of the rest pose points
    // along +x (in this model the upper rests turned to the back)
    const raw = (o) => w(o).applyMatrix4(inv);
    this.armDir = raw(N.stick).x < raw(N.boom).x ? -1 : 1;
    this.slew0 = this.armDir < 0 ? Math.PI : 0;
    const toArm = (p) => { p.x *= this.armDir; p.z *= this.armDir; return p; };
    this.toArm = toArm;
    const L = (o) => toArm(raw(o)); // arm frame (x out along the arm, y up)
    // joint axis of each arm node: the local axis whose rotation moves the child mostly within the arm plane
    const pick = (node, child) => {
      let best = null;
      for (const ax of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
        const p0 = L(child);
        node.quaternion.copy(node.userData.rest).multiply(new THREE.Quaternion().setFromAxisAngle(ax, 0.1));
        this.root.updateMatrixWorld(true);
        const p1 = L(child);
        node.quaternion.copy(node.userData.rest);
        this.root.updateMatrixWorld(true);
        const d = p1.sub(p0);
        const inPlane = Math.hypot(d.x, d.y), lateral = Math.abs(d.z);
        const score = inPlane - 3 * lateral;
        if (!best || score > best.score) best = { ax, score };
      }
      return best.ax;
    };
    this.axis = { boom: pick(N.boom, N.stick), stick: pick(N.stick, N.bucket), claw: new THREE.Vector3(1, 0, 0) };
    // bucket: farthest vertex from its pivot = the teeth; also its width and cavity side
    const bk = N.bucket;
    const pts = [];
    bk.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 1500));
      for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i); o.localToWorld(v); pts.push(toArm(v.clone().applyMatrix4(inv))); }
    });
    const piv = L(bk);
    let tip = piv, far = 0;
    for (const p of pts) { const d = Math.hypot(p.x - piv.x, p.y - piv.y); if (d > far) { far = d; tip = p; } }
    let zmin = 1e9, zmax = -1e9, cx = 0, cy = 0;
    for (const p of pts) { zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    tip = tip.clone().setZ((zmin + zmax) / 2); // middle of the cutting edge, not a corner tooth
    this.bucketAxis = this.axis.stick.clone();
    // plane geometry (rest): boom pivot B, stick pivot S, bucket pivot K, tip T
    const B = L(N.boom), S = L(N.stick), K = piv, T = tip;
    this.geo = {
      B, armZ: (B.z + S.z + K.z) / 3,
      L1: Math.hypot(S.x - B.x, S.y - B.y), a1: Math.atan2(S.y - B.y, S.x - B.x),
      L2: Math.hypot(K.x - S.x, K.y - S.y), a2: Math.atan2(K.y - S.y, K.x - S.x),
      L3: Math.hypot(T.x - K.x, T.y - K.y), a3: Math.atan2(T.y - K.y, T.x - K.x),
      width: zmax - zmin, tipLocal: bk.worldToLocal(toArm(tip.clone()).applyMatrix4(this.root.matrixWorld)),
    };
    // which side of the pivot→teeth line the cavity opens to (opposite the shell)
    const side = (cx - K.x) * -(T.y - K.y) + (cy - K.y) * (T.x - K.x);
    this.geo.cav = side > 0 ? -Math.PI / 2 : Math.PI / 2; // cavity normal angle relative to the teeth vector
    // signs: does +rotation about the joint axis turn the arm counter-clockwise in the plane?
    const sgn = (node, ax, child, ref) => {
      const p0 = L(child), r0 = L(ref);
      node.quaternion.copy(node.userData.rest).multiply(new THREE.Quaternion().setFromAxisAngle(ax, 0.05));
      this.root.updateMatrixWorld(true);
      const p1 = L(child);
      node.quaternion.copy(node.userData.rest);
      this.root.updateMatrixWorld(true);
      const a0 = Math.atan2(p0.y - r0.y, p0.x - r0.x), a1 = Math.atan2(p1.y - r0.y, p1.x - r0.x);
      return Math.sign(a1 - a0) || 1;
    };
    const tipAnchor = new THREE.Object3D(); tipAnchor.position.copy(this.geo.tipLocal); bk.add(tipAnchor);
    this.root.updateMatrixWorld(true);
    this.sign = { boom: sgn(N.boom, this.axis.boom, N.stick, N.boom), stick: sgn(N.stick, this.axis.stick, N.bucket, N.stick), bucket: sgn(bk, this.bucketAxis, tipAnchor, bk) };
    this.tipAnchor = tipAnchor;
    // slew: rotation of the upper about its local Y; sign so that +slew turns the arm left (CCW from above)
    this.slewAxis = new THREE.Vector3(0, 1, 0);
    const p0 = L(N.bucket);
    N.upper.quaternion.copy(N.upper.userData.rest).multiply(new THREE.Quaternion().setFromAxisAngle(this.slewAxis, 0.1));
    this.root.updateMatrixWorld(true);
    const p1 = L(N.bucket);
    N.upper.quaternion.copy(N.upper.userData.rest);
    this.root.updateMatrixWorld(true);
    this.sign.slew = Math.sign(Math.atan2(-p1.z, p1.x) - Math.atan2(-p0.z, p0.x)) || 1;
  }

  _buildBucket() {
    const bk = this.nodes.bucket, g = this.geo;
    // anchors at the outer teeth and in the cavity (in bucket-local space)
    const inv = new THREE.Matrix4().copy(bk.matrixWorld).invert();
    const toLocal = (p) => p.clone().applyMatrix4(this.root.matrixWorld).applyMatrix4(inv);
    const K = this.toArm(new THREE.Vector3().setFromMatrixPosition(bk.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(this.root.matrixWorld).invert()));
    const ang = g.a3, cav = g.a3 + g.cav;
    const tip = new THREE.Vector3(K.x + Math.cos(ang) * g.L3, K.y + Math.sin(ang) * g.L3, g.armZ);
    const half = g.width * 0.42;
    const mk = (p) => { const o = new THREE.Object3D(); o.position.copy(toLocal(this.toArm(p))); bk.add(o); return o; };
    const edgeL = mk(tip.clone().setZ(g.armZ - half)), edgeR = mk(tip.clone().setZ(g.armZ + half));
    const inside = new THREE.Vector3(K.x + Math.cos(ang) * g.L3 * 0.55 + Math.cos(cav) * g.L3 * 0.25, K.y + Math.sin(ang) * g.L3 * 0.55 + Math.sin(cav) * g.L3 * 0.25, g.armZ);
    const mouth = mk(inside);
    // mouth +Z must point out of the cavity: look along the cavity normal
    const outW = this.toArm(new THREE.Vector3(Math.cos(cav), Math.sin(cav), 0)).transformDirection(this.root.matrixWorld);
    const mw = mouth.getWorldPosition(new THREE.Vector3());
    mouth.lookAt(mw.clone().add(outW));
    // the load: a heaped dome of soil sitting in the cavity
    const heapG = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.app.shovel.loadMat);
    dome.rotation.x = Math.PI / 2;
    dome.scale.set(g.width * 0.42, g.L3 * 0.3, g.L3 * 0.3);
    heapG.add(dome);
    mouth.add(heapG);
    heapG.visible = false;
    this.bucketPhys = new BucketPhysics(this.app, { edgeL, edgeR, mouth, capacity: Math.pow(R(1), 3) * 0.16, heap: heapG });
  }

  // ---- joints ---------------------------------------------------------------------------------
  applyJoints(dt, snap = false) {
    if (!this.nodes) return;
    for (const k of ['slew', 'boom', 'stick', 'bucket', 'claw']) {
      const d = this.t[k] - this.j[k], mx = this.speed[k] * dt;
      // hydraulics: ease in/out near the target, otherwise move at full speed
      this.j[k] += snap ? d : Math.sign(d) * Math.min(Math.abs(d), mx, Math.abs(d) * Math.min(1, dt * 6) + mx * 0.15);
    }
    this._pose();
  }

  // set the model's parts from the joint values j
  _pose() {
    const N = this.nodes, q = new THREE.Quaternion();
    N.upper.quaternion.copy(N.upper.userData.rest).multiply(q.setFromAxisAngle(this.slewAxis, this.j.slew * this.sign.slew));
    N.boom.quaternion.copy(N.boom.userData.rest).multiply(q.setFromAxisAngle(this.axis.boom, this.j.boom * this.sign.boom));
    N.stick.quaternion.copy(N.stick.userData.rest).multiply(q.setFromAxisAngle(this.axis.stick, this.j.stick * this.sign.stick));
    N.bucket.quaternion.copy(N.bucket.userData.rest).multiply(q.setFromAxisAngle(this.bucketAxis, this.j.bucket * this.sign.bucket));
    N.claw.quaternion.copy(N.claw.userData.rest).multiply(q.setFromAxisAngle(this.axis.claw, this.j.claw));
    this.root.updateMatrixWorld(true);
  }

  jointsReached(tol = 0.02) { return ['slew', 'boom', 'stick', 'bucket'].every((k) => Math.abs(this.t[k] - this.j[k]) < tol); }

  // Inverse kinematics: teeth at world point p with the teeth vector at plane angle phi.
  // The analytic plane solution is refined against the real model (forward
  // kinematics) so the teeth land where they are told to.
  reach(p, phi) {
    if (!this.geo) return false;
    let ok = this._solve(p, phi);
    const goal = p.clone(), aim = p.clone(), save = { ...this.j }, tip = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      Object.assign(this.j, this.t);
      this._pose();
      this.tipWorld(tip);
      const ex = goal.x - tip.x, ey = goal.y - tip.y, ez = goal.z - tip.z;
      if (Math.abs(ex) + Math.abs(ey) + Math.abs(ez) < 2e-4) break;
      aim.x += ex; aim.y += ey; aim.z += ez;
      ok = this._solve(aim, phi);
    }
    Object.assign(this.j, save);
    this._pose();
    return ok;
  }

  _solve(p, phi) {
    const g = this.geo;
    const v = p.clone().applyMatrix4(new THREE.Matrix4().copy(this.root.matrixWorld).invert());
    // swing so that the (laterally offset) arm plane passes through the point
    const rho = Math.hypot(v.x, v.z), theta = Math.atan2(-v.z, v.x);
    const off = Math.asin(Math.max(-0.99, Math.min(0.99, -g.armZ / Math.max(rho, 1e-4))));
    const slew = theta - off;
    const f = Math.sqrt(Math.max(1e-8, rho * rho - g.armZ * g.armZ));
    // in-plane target relative to the boom pivot
    const X = f - g.B.x, Y = v.y - g.B.y;
    const wx = X - Math.cos(phi) * g.L3, wy = Y - Math.sin(phi) * g.L3;
    let D = Math.hypot(wx, wy);
    const reachable = D <= g.L1 + g.L2 - 1e-4 && D >= Math.abs(g.L1 - g.L2) + 1e-4;
    D = Math.min(Math.max(D, Math.abs(g.L1 - g.L2) + 1e-4), g.L1 + g.L2 - 1e-4);
    const th = Math.atan2(wy, wx);
    const k = Math.acos(Math.min(1, Math.max(-1, (g.L1 * g.L1 + D * D - g.L2 * g.L2) / (2 * g.L1 * D))));
    const A1 = th + k;                                   // elbow up: boom high, stick down
    const ex = Math.cos(A1) * g.L1, ey = Math.sin(A1) * g.L1;
    const A2 = Math.atan2(Math.sin(th) * D - ey, Math.cos(th) * D - ex);
    // joint values are plane-angle changes; applyJoints() maps them onto each node's own axis/sign
    const dBoom = A1 - g.a1;
    const dStick = A2 - g.a2 - (A1 - g.a1);
    const dBucket = phi - g.a3 - (A2 - g.a2);
    this.t.slew = unwrap(slew - this.slew0, this.j.slew);
    // shortest way from where the joints are now (no swinging over the top)
    this.t.boom = unwrap(dBoom, this.j.boom); this.t.stick = unwrap(dStick, this.j.stick); this.t.bucket = unwrap(dBucket, this.j.bucket);
    return reachable;
  }

  // teeth angle for a cavity orientation (radians in the arm plane: 0 = forward, π/2 = up)
  phiFor(cavityAngle) { return cavityAngle - this.geo.cav; }

  travelPose() { if (!this.geo) return; const c = this.slewCenter(); this.reach(new THREE.Vector3(c.x + Math.cos(this.yaw) * R(2.0), this.y + R(0.6), c.z - Math.sin(this.yaw) * R(2.0)), this.phiFor(Math.PI * 0.42)); }

  slewCenter() { return this.local(0, 0); }
  tipWorld(out = new THREE.Vector3()) { return this.tipAnchor ? this.tipAnchor.getWorldPosition(out) : out.copy(this.root.position); }
  bucketWorld(out = new THREE.Vector3()) { return this.nodes ? this.nodes.bucket.getWorldPosition(out) : out.copy(this.root.position); }

  // ---- auto work cycle ---------------------------------------------------------------------------
  maxReach() { return this.geo ? this.geo.B.x + this.geo.L1 + this.geo.L2 * 0.95 : R(3); }
  minReach() { return this.geo ? this.geo.B.x + R(0.9) : R(1.2); }

  clampReach(p) {
    const c = this.slewCenter();
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz) || 1e-6;
    const r = Math.max(this.minReach(), Math.min(this.maxReach(), d));
    return new THREE.Vector3(c.x + dx / d * r, p.y, c.z + dz / d * r);
  }

  // dig a stroke from a (far) towards b (near the cab)
  startDig(a, b, bite) {
    const t = this.app.terrain;
    a = this.clampReach(a); b = this.clampReach(b);
    if (Math.hypot(a.x - b.x, a.z - b.z) < R(0.6)) {
      // a tap: pull about a metre towards the cab
      const c = this.slewCenter(), d = Math.hypot(a.x - c.x, a.z - c.z) || 1;
      b = this.clampReach(new THREE.Vector3(a.x - (a.x - c.x) / d * R(1.2), 0, a.z - (a.z - c.z) / d * R(1.2)));
    }
    const ga = t.heightAt(a.x, a.z);
    this.cycle = { phase: 'swing', a, b, bite, depth: ga - bite, s: 0, time: 0 };
    this.bucketPhys.reset();
  }

  dumpAt(p) {
    if (!this.cycle || this.cycle.phase !== 'hold') return false;
    p = this.clampReach(p);
    this.cycle.phase = 'toDump';
    this.cycle.d = p;
    return true;
  }

  get busy() { return !!this.cycle; }

  _cycleStep(dt) {
    const c = this.cycle, t = this.app.terrain, g = this.geo;
    if (!c) return;
    c.time += dt;
    const ground = (p) => (t.inside(p.x, p.z) ? t.heightAt(p.x, p.z) : t.heightAt(t.clampX(p.x), t.clampZ(p.z)));
    const open = this.phiFor(Math.PI * 0.92);      // cavity faces the cab: teeth point down/forward
    const curled = this.phiFor(Math.PI * 0.5);     // cavity faces up
    const carry = this.phiFor(Math.PI * 0.42);
    if (c.phase === 'swing') {
      this.reach(new THREE.Vector3(c.a.x, ground(c.a) + R(0.9), c.a.z), open);
      if (this.jointsReached(0.05) || c.time > 6) { c.phase = 'lower'; c.time = 0; }
    } else if (c.phase === 'lower') {
      this.reach(new THREE.Vector3(c.a.x, c.depth, c.a.z), open);
      if (this.jointsReached(0.03) || c.time > 4) { c.phase = 'drag'; c.time = 0; }
    } else if (c.phase === 'drag') {
      const L = Math.hypot(c.b.x - c.a.x, c.b.z - c.a.z);
      c.s = Math.min(1, c.s + dt * R(0.45) / Math.max(L, 1e-4)); // ≈0.45 m/s at the teeth
      const p = new THREE.Vector3().lerpVectors(c.a, c.b, c.s);
      const lvl = Math.max(this.app.gradeAt(p.x, p.z) ?? -1, Math.min(c.depth, ground(p) - c.bite * 0.3));
      const phi = open + (curled - open) * Math.pow(c.s, 1.6) * 0.75;
      this.reach(new THREE.Vector3(p.x, Math.max(lvl, t.floorY + 0.002), p.z), phi);
      if (c.s >= 1 || this.bucketPhys.fill >= 0.98) { c.phase = 'curl'; c.time = 0; }
    } else if (c.phase === 'curl') {
      const tip = this.tipWorld();
      this.reach(new THREE.Vector3(tip.x, ground(tip) + R(0.25), tip.z), curled);
      if (this.jointsReached(0.05) || c.time > 2.5) { c.phase = 'lift'; c.time = 0; }
    } else if (c.phase === 'lift') {
      const tip = this.tipWorld();
      this.reach(new THREE.Vector3(tip.x, ground(tip) + R(1.3), tip.z), carry);
      if (this.jointsReached(0.05) || c.time > 3) { c.phase = this.bucketPhys.load > 0 ? 'hold' : 'home'; c.time = 0; this.app.onShovelState?.(); }
    } else if (c.phase === 'toDump') {
      this.reach(new THREE.Vector3(c.d.x, ground(c.d) + R(1.2), c.d.z), carry);
      if (this.jointsReached(0.05) || c.time > 7) { c.phase = 'dump'; c.time = 0; }
    } else if (c.phase === 'dump') {
      // open the bucket slowly: the mouth turns down and the soil pours out
      this.t.bucket = this.j.bucket + wrapPi(this.phiFor(-Math.PI * 0.55) - this.currentPhi());
      if ((this.bucketPhys.load <= 0 && c.time > 1.2) || c.time > 6) { c.phase = 'home'; c.time = 0; }
    } else if (c.phase === 'home') {
      this.travelPose();
      if (this.jointsReached(0.06) || c.time > 4) { this.cycle = null; this.app.onShovelState?.(); }
    }
  }

  currentPhi() {
    const g = this.geo;
    return g.a3 + this.j.boom + this.j.stick + this.j.bucket;
  }

  // ---- per frame ---------------------------------------------------------------------------------
  update(dt) {
    if (!this.nodes) return;
    // driving (tracks: counter-rotate to turn on the spot)
    const vmax = R(0.8), wmax = 0.45;
    const drive = this.mode === 'manual' && this.manualTravel ? { th: -this.manual.ly, st: this.manual.lx } : { th: this.throttle, st: this.steer };
    this.v += (drive.th * vmax - this.v) * Math.min(1, dt * 3);
    this.yawRate += (-drive.st * wmax - this.yawRate) * Math.min(1, dt * 3);
    if (!drive.th && Math.abs(this.v) < R(0.01)) this.v = 0;
    if (!drive.st && Math.abs(this.yawRate) < 0.005) this.yawRate = 0;
    if (!this.cycle) {
      const f = this.forward();
      this.x += f.x * this.v * dt; this.z += f.y * this.v * dt; this.yaw += this.yawRate * dt;
      this.keepInside();
      const half = R(0.55);
      this.trackPhase[0] += (this.v - this.yawRate * half) * dt; this.trackPhase[1] += (this.v + this.yawRate * half) * dt;
    }
    if (this.mode === 'manual' && !this.cycle) {
      const m = this.manual;
      const rate = (v, s) => v * this.speed[s] * dt * 1.1;
      // ISO pattern: left ← → swing, ↑ stick out / ↓ stick in; right ↑ boom down / ↓ boom up, ← curl / → dump
      if (!this.manualTravel) { this.t.slew = this.j.slew - rate(m.lx, 'slew'); this.t.stick = this.j.stick - rate(m.ly, 'stick'); }
      this.t.boom = this.j.boom + rate(m.ry, 'boom');
      this.t.bucket = this.j.bucket + rate(m.rx, 'bucket') * (this.geo.cav < 0 ? 1 : -1); // curl turns the cavity up
    }
    this._cycleStep(dt);
    this.applyJoints(dt);
    this.followGround(dt);
    this.root.updateMatrixWorld(true);
    this.bucketPhys.update(dt);
    this.moved += Math.abs(this.v * dt);
  }

  // ---- persistence ---------------------------------------------------------------------------------
  record() {
    return { ...this.baseRecord(), slew: +this.t.slew.toFixed(4), boom: +this.t.boom.toFixed(4), stick: +this.t.stick.toFixed(4), bucket: +this.t.bucket.toFixed(4), load: this.bucketPhys ? this.bucketPhys.load : 0 };
  }
  apply(r) {
    this.applyBase(r);
    this.cycle = null;
    if (r.boom !== undefined) { this.t.slew = r.slew; this.t.boom = r.boom; this.t.stick = r.stick; this.t.bucket = r.bucket; }
    if (this.bucketPhys) { this.bucketPhys.load = r.load || 0; this.bucketPhys.reset(); }
    this.applyJoints(1, true);
  }
}

function unwrap(a, ref) { while (a - ref > Math.PI) a -= Math.PI * 2; while (a - ref < -Math.PI) a += Math.PI * 2; return a; }
function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
