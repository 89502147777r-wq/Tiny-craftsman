import * as THREE from 'three';
import { Machine } from './machine.js';
import { R, machineMaterials, box, cyl, profile, roundedBox, Hydraulic, makeTrack, ik2 } from './parts.js';

// 1:12 mini excavator (≈1.7 t class, rubber tracks, canopy).
// Real dimensions in metres, converted with R(). Local frame: +X forward.
const D = {
  trackL: 1.58, trackH: 0.36, trackW: 0.23, gauge: 0.76,
  slewH: 0.40,                       // top of the slew ring above ground
  pivot: [0.42, 0.22],               // boom foot in the upper frame (x, y)
  L1: 1.62, L2: 0.92, Lk: 0.46,      // boom chord, stick, bucket pin → tip
  bucketW: 0.36,
};

export class Excavator extends Machine {
  constructor(app) {
    super(app, 'excavator');
    this.mats = machineMaterials(0xf0b40c);
    this.contacts = [];
    for (const s of [-1, 1]) for (const x of [-0.6, 0, 0.6]) this.contacts.push([R(x), R(s * D.gauge / 2)]);
    this.radius = R(1.0);
    // joint state (current and target)
    this.j = { slew: 0, boom: 0.55, stick: -1.9, bucket: -1.2, blade: 1 };
    this.t = { ...this.j };
    this.trackPhase = [0, 0];
    this._fill = 0;
    this.build();
    this.rest();
    this.updateJoints(1, true);
  }

  // ---- model --------------------------------------------------------------------------------
  build() {
    const m = this.mats;
    const under = (this.under = new THREE.Group());
    this.body.add(under);
    // tracks
    this.tracks = [];
    for (const s of [-1, 1]) {
      const tr = makeTrack(R(D.trackL), R(D.trackH - 0.07), R(D.trackW), R(0.035), m);
      tr.position.set(0, R(0.0), R(s * D.gauge / 2));
      under.add(tr);
      this.tracks.push(tr);
      // sprocket (rear), idler (front), rollers and the track frame
      const z = R(s * D.gauge / 2);
      const sp = cyl(R(0.13), R(D.trackW * 0.7), m.dark, 'z', 14); sp.position.set(R(-D.trackL / 2 + 0.17), R(0.18), z);
      const id = cyl(R(0.12), R(D.trackW * 0.6), m.steel, 'z', 14); id.position.set(R(D.trackL / 2 - 0.17), R(0.17), z);
      const fr = box(R(D.trackL - 0.36), R(0.15), R(D.trackW * 0.55), m.paint, 0, R(0.17), z, R(0.02));
      under.add(sp, id, fr);
      for (const x of [-0.32, 0, 0.32]) { const r = cyl(R(0.05), R(D.trackW * 0.5), m.dark, 'z', 10); r.position.set(R(x), R(0.07), z); under.add(r); }
      const motor = cyl(R(0.09), R(0.12), m.dark, 'z', 12); motor.position.set(R(-D.trackL / 2 + 0.17), R(0.18), z + R(s * -0.13)); under.add(motor);
    }
    under.add(box(R(0.62), R(0.2), R(D.gauge - D.trackW * 0.4), m.paint, 0, R(0.28), 0, R(0.03)));
    const ring = cyl(R(0.33), R(0.05), m.dark, 'y', 28); ring.position.y = R(D.slewH - 0.025); under.add(ring);
    // dozer blade on two arms
    this.bladeG = new THREE.Group();
    this.bladeG.position.set(R(0.32), R(0.28), 0);
    under.add(this.bladeG);
    for (const s of [-1, 1]) this.bladeG.add(box(R(0.55), R(0.07), R(0.07), m.paint, R(0.27), 0, R(s * 0.3), R(0.01)));
    const bladeProf = [[0, 0], [0.04, 0], [0.06, 0.06], [0.05, 0.18], [0.02, 0.27], [-0.03, 0.28], [-0.01, 0.17], [0.0, 0.06]].map(([x, y]) => [R(x), R(y)]);
    const blade = profile(bladeProf, R(1.0), m.paint);
    blade.position.set(R(0.55), R(-0.26), 0);
    this.bladeG.add(blade);
    const edge = box(R(0.02), R(0.03), R(1.0), m.steel, R(0.57), R(-0.255), 0);
    this.bladeG.add(edge);

    // ---- upper structure -------------------------------------------------------------------
    const up = (this.upper = new THREE.Group());
    up.position.y = R(D.slewH);
    this.body.add(up);
    const arc = [];
    const rr = 0.52, a0 = Math.asin(0.47 / rr);
    for (let i = 0; i <= 20; i++) { const a = a0 + (Math.PI * 2 - 2 * a0) * i / 20; arc.push([rr * Math.cos(a), rr * Math.sin(a)]); }
    const deck = [[0.44, -0.47], [0.44, 0.47], ...arc.reverse()];
    up.add(topExtrude(deck, 0.0, 0.08, m.dark));
    // engine hood + counterweight (rear half)
    const hood = arc.filter(([x]) => x < 0.05);
    const hoodPoly = [[0.05, 0.47], [0.05, -0.47], ...hood.filter(([x, z]) => z < 0).reverse(), ...hood.filter(([x, z]) => z >= 0).reverse()];
    up.add(topExtrude(sortLoop(hoodPoly), 0.08, 0.36, m.paint, R(0.03)));
    up.add(topExtrude(sortLoop(hoodPoly).map(([x, z]) => [x * 0.96, z * 0.96]), 0.44, 0.06, m.paint, R(0.025)));
    const cw = topExtrude(arc.filter(([x]) => x < -0.25).map(([x, z]) => [x * 1.02, z * 1.02]).concat(arc.filter(([x]) => x < -0.25).map(([x, z]) => [x * 0.8, z * 0.8]).reverse()), 0.06, 0.2, m.dark);
    up.add(cw);
    // grille, exhaust, step
    up.add(box(R(0.02), R(0.18), R(0.5), m.dark, R(-0.5), R(0.3), 0));
    const ex = cyl(R(0.03), R(0.28), m.dark, 'y', 10); ex.position.set(R(-0.25), R(0.62), R(-0.32)); up.add(ex);
    // operator station: floor, seat, consoles, levers
    up.add(box(R(0.36), R(0.04), R(0.8), m.dark, R(0.25), R(0.1), 0));
    const seat = new THREE.Group(); seat.position.set(R(-0.05), R(0.5), R(0.06)); up.add(seat);
    seat.add(box(R(0.42), R(0.08), R(0.44), m.seat, 0, 0, 0, R(0.03)));
    const back = box(R(0.08), R(0.5), R(0.44), m.seat, R(-0.2), R(0.27), 0, R(0.03)); back.rotation.z = -0.15; seat.add(back);
    for (const s of [-1, 1]) {
      up.add(box(R(0.3), R(0.22), R(0.1), m.dark, R(0.05), R(0.6), R(0.06 + s * 0.3), R(0.02)));
      const lever = cyl(R(0.012), R(0.14), m.dark, 'y', 6); lever.position.set(R(0.12), R(0.78), R(0.06 + s * 0.3)); up.add(lever);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(R(0.025), 8, 6), m.seat); knob.position.set(R(0.12), R(0.85), R(0.06 + s * 0.3)); up.add(knob);
      const tl = cyl(R(0.012), R(0.3), m.dark, 'y', 6); tl.position.set(R(0.36), R(0.25), R(s * 0.08)); tl.rotation.z = 0.3; up.add(tl);
    }
    // canopy (ROPS/FOPS)
    for (const [x, z, y0] of [[0.38, 0.42, 0.08], [0.38, -0.42, 0.08], [-0.3, 0.4, 0.5], [-0.3, -0.4, 0.5]]) {
      const post = box(R(0.06), R(1.92 - y0), R(0.06), m.dark, R(x), R((1.92 + y0) / 2), R(z), R(0.01));
      up.add(post);
    }
    up.add(box(R(0.9), R(0.06), R(1.0), m.paint, R(0.04), R(1.93), 0, R(0.03)));
    up.add(box(R(0.86), R(0.02), R(0.92), m.dark, R(0.04), R(1.9), 0));
    const lamp = box(R(0.08), R(0.06), R(0.05), m.lamp, R(0.46), R(1.86), R(0.3)); up.add(lamp);
    // boom swing bracket
    up.add(box(R(0.18), R(0.32), R(0.26), m.paint, R(0.42), R(0.22), 0, R(0.02)));
    const bp = cyl(R(0.05), R(0.3), m.steel, 'z', 12); bp.position.set(R(D.pivot[0]), R(D.pivot[1]), 0); up.add(bp);

    // ---- arm ------------------------------------------------------------------------------
    const L1 = R(D.L1), L2 = R(D.L2), Lk = R(D.Lk);
    this.boom = new THREE.Group(); this.boom.position.set(R(D.pivot[0]), R(D.pivot[1]), 0); up.add(this.boom);
    const boomProf = [[0, -0.06], [0.5, 0.06], [0.95, 0.12], [1.32, 0.04], [1.62, -0.05], [1.62, 0.06], [1.32, 0.17], [0.95, 0.27], [0.5, 0.21], [0, 0.07]].map(([x, y]) => [R(x), R(y)]);
    this.boom.add(profile(boomProf, R(0.17), m.paint));
    const bpin = cyl(R(0.045), R(0.22), m.steel, 'z', 10); bpin.position.set(L1, 0, 0); this.boom.add(bpin);
    this.stick = new THREE.Group(); this.stick.position.set(L1, 0, 0); this.boom.add(this.stick);
    const stickProf = [[-0.2, 0.04], [-0.05, 0.1], [0.3, 0.07], [0.92, 0.035], [0.92, -0.035], [0.3, -0.07], [-0.05, -0.08], [-0.2, -0.02]].map(([x, y]) => [R(x), R(y)]);
    this.stick.add(profile(stickProf, R(0.13), m.paint));
    this.bucketG = new THREE.Group(); this.bucketG.position.set(L2, 0, 0); this.stick.add(this.bucketG);
    this.buildBucket(Lk);
    // cylinder anchors
    const anchor = (parent, x, y) => { const o = new THREE.Object3D(); o.position.set(R(x), R(y), 0); parent.add(o); return o; };
    this.cyl = [
      new Hydraulic(R(0.05), R(0.03), R(0.7), m).attach(anchor(up, D.pivot[0] + 0.12, D.pivot[1] - 0.14), anchor(this.boom, 0.62, -0.02)),
      new Hydraulic(R(0.045), R(0.026), R(0.62), m).attach(anchor(this.boom, 0.42, 0.24), anchor(this.stick, -0.2, 0.07)),
      new Hydraulic(R(0.038), R(0.022), R(0.5), m).attach(anchor(this.stick, 0.12, 0.1), anchor(this.bucketG, -0.04, 0.12)),
    ];
    for (const c of this.cyl) up.add(c.group);
    // blade cylinder
    this.bladeCyl = new Hydraulic(R(0.035), R(0.02), R(0.22), m).attach(anchor(under, 0.28, 0.33), anchor(this.bladeG, 0.42, 0.12));
    under.add(this.bladeCyl.group);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  buildBucket(Lk) {
    const m = this.mats, W = R(D.bucketW);
    // side profile: pin at origin, cutting edge at (Lk, 0); mouth faces −y
    const outer = [[0.0, 0.07], [0.08, 0.19], [0.2, 0.26], [0.33, 0.24], [0.42, 0.14], [0.47, 0.0]];
    const t = 0.02;
    const inner = outer.map(([x, y]) => [x * 0.96 + 0.01, y - t]).reverse();
    const shell = profile([...outer, ...inner].map(([x, y]) => [R(x), R(y)]), W, m.dark);
    this.bucketG.add(shell);
    for (const s of [-1, 1]) {
      const side = profile([...outer, [0.06, -0.03]].map(([x, y]) => [R(x), R(y)]), R(0.012), m.dark);
      side.position.z = s * (W / 2);
      this.bucketG.add(side);
      this.bucketG.add(box(R(0.12), R(0.12), R(0.02), m.paint, R(-0.02), R(0.08), s * R(0.07)));
    }
    for (let i = 0; i < 4; i++) {
      const tooth = profile([[0, -0.012], [0.07, -0.004], [0.07, 0.004], [0, 0.016]].map(([x, y]) => [R(x), R(y)]), R(0.035), m.steel);
      tooth.position.set(R(0.45), R(0.0), (i - 1.5) * W / 4);
      tooth.rotation.z = -0.25;
      this.bucketG.add(tooth);
    }
    const pin = cyl(R(0.04), R(0.2), m.steel, 'z', 10); this.bucketG.add(pin);
    // soil load inside the bucket
    const heap = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    this.heap = new THREE.Mesh(heap, this.app.shovel.loadMat);
    this.heap.rotation.z = Math.PI; // dome bulges out of the mouth (−y)
    this.heap.position.set(R(0.24), R(0.1), 0);
    this.heap.visible = false;
    this.bucketG.add(this.heap);
    // where soil leaves the bucket
    this.mouth = new THREE.Object3D(); this.mouth.position.set(R(0.3), R(0.0), 0); this.bucketG.add(this.mouth);
  }

  // ---- joints & IK ---------------------------------------------------------------------------
  // Aim the bucket tip at a world point with the bucket at absolute angle phi.
  reach(p, phi) {
    this.root.updateMatrixWorld(true);
    const v = this.body.worldToLocal(p.clone());
    v.y -= R(D.slewH);
    const slew = Math.atan2(-v.z, v.x);
    const rh = Math.hypot(v.x, v.z) - R(D.pivot[0]);
    const y = v.y - R(D.pivot[1]);
    const Lk = R(D.Lk);
    const wx = rh - Math.cos(phi) * Lk, wy = y - Math.sin(phi) * Lk;
    const [a1, a2] = ik2(wx, wy, R(D.L1), R(D.L2));
    this.t.slew = unwrap(slew, this.j.slew);
    this.t.boom = a1; this.t.stick = a2 - a1; this.t.bucket = phi - a2;
  }

  rest() { this.t.boom = 0.65; this.t.stick = -2.0; this.t.bucket = -1.6; }

  updateJoints(dt, snap = false) {
    const lim = { slew: 1.3, boom: 1.0, stick: 1.4, bucket: 2.6, blade: 1.5 };
    for (const k of Object.keys(lim)) {
      const d = this.t[k] - this.j[k], mx = lim[k] * dt;
      this.j[k] += snap ? d : Math.max(-mx, Math.min(mx, d * Math.min(1, dt * 9)));
    }
    this.upper.rotation.y = this.j.slew;
    this.boom.rotation.z = this.j.boom;
    this.stick.rotation.z = this.j.stick;
    this.bucketG.rotation.z = this.j.bucket;
    this.bladeG.position.y = R(0.28) + this.j.blade * R(0.12);
    this.bladeG.rotation.z = -this.j.blade * 0.12;
    this.root.updateMatrixWorld(true);
    for (const c of this.cyl) c.update();
    this.bladeCyl.update();
  }

  // ---- driving --------------------------------------------------------------------------------
  update(dt) {
    const vmax = R(0.7), wmax = 0.55;
    const tv = this.throttle * vmax, tw = -this.steer * wmax;
    this.v += (tv - this.v) * Math.min(1, dt * 4);
    this.yawRate += (tw - this.yawRate) * Math.min(1, dt * 4);
    const f = this.forward();
    const dx = f.x * this.v * dt, dz = f.y * this.v * dt;
    this.x += dx; this.z += dz; this.yaw += this.yawRate * dt;
    this.keepInside();
    const dist = Math.hypot(dx, dz);
    this.moved += dist;
    // track belts: left/right speeds differ when turning
    const half = R(D.gauge / 2);
    const vl = this.v - this.yawRate * half, vr = this.v + this.yawRate * half;
    this.trackPhase[0] += vl * dt; this.trackPhase[1] += vr * dt;
    this.tracks.forEach((tr, i) => { tr.material.map.offset.x = -this.trackPhase[i] / tr.userData.perimeter; tr.material.normalMap.offset.x = tr.material.map.offset.x; });
    // dozer blade lowered → it pushes soil when driving forward
    if (this.t.blade < 0.5 && this.v > 0 && dist > 0) {
      const c = this.local(R(0.88), 0);
      const g = this.groundAt(this.x, this.z);
      this.bulldoze(c, R(1.0), g - R(0.02), dist, 0);
    }
    this.followGround(dt);
    this.updateJoints(dt);
    this.updateHeap();
  }

  updateHeap() {
    this._shown = (this._shown || 0) + (this._fill - (this._shown || 0)) * 0.2;
    const f = this._shown;
    this.heap.visible = f > 0.02;
    if (this.heap.visible) { const s = Math.cbrt(f); this.heap.scale.set(R(0.17) * s, R(0.13) * s, R(D.bucketW * 0.42) * s); }
  }

  // ---- implement interface for ScoopTool -----------------------------------------------------
  get name() { return 'excavator'; }
  get spec() { return { width: R(D.bucketW), length: R(0.3), capacity: Math.pow(R(1), 3) * 0.045, pointed: false }; }
  get bite() { return R(0.12); }
  get fill() { return this._fill; }
  set fill(v) { this._fill = v; }
  get dumpDelay() { return 0.45; }
  get dumpTime() { return 0.7; }
  get crumbScale() { return 1.7; }

  slewCenter() { return this.local(0, 0); }
  clampReach(p) {
    const c = this.slewCenter();
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz) || 1e-6;
    const r = Math.max(R(1.25), Math.min(R(2.9), d));
    p.x = c.x + dx / d * r; p.z = c.z + dz / d * r;
    return p;
  }
  // the bucket always drags towards the cab
  initialDir(p) { const c = this.slewCenter(); return new THREE.Vector2(c.x - p.x, c.z - p.z).normalize(); }
  digDir(p) { return this.initialDir(p); }
  poseDig(p, dir, cutY) { this.reach(new THREE.Vector3(p.x, cutY, p.z), -1.75); }
  poseAim(p, dir, groundY) { this.reach(new THREE.Vector3(p.x, groundY + R(0.9), p.z), -2.85); } // curled: mouth up
  poseDump() { this.t.bucket += 2.4; } // open the bucket
  poseRest() { this.rest(); }
  bladePoint(u, v, out = new THREE.Vector3()) {
    out.set(R(0.12 + v * 0.25), R(0.02), u * R(D.bucketW) * 0.42);
    return this.bucketG.localToWorld(out);
  }
  bladeNormal(out = new THREE.Vector3()) {
    out.set(0.3, -1, 0).normalize();
    return out.transformDirection(this.bucketG.matrixWorld);
  }

  // ---- persistence -------------------------------------------------------------------------------
  record() { return { ...this.baseRecord(), slew: +this.t.slew.toFixed(4), blade: this.t.blade }; }
  apply(r) {
    this.applyBase(r);
    this.t.slew = r.slew || 0; this.t.blade = r.blade ?? 1;
    this.rest();
    this.updateJoints(1, true);
  }
}

function unwrap(a, ref) { while (a - ref > Math.PI) a -= Math.PI * 2; while (a - ref < -Math.PI) a += Math.PI * 2; return a; }

// Extrude a top-view polygon [x, z] (real metres) upwards from y0 by h.
function topExtrude(poly, y0, h, mat, bevel = 0) {
  const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(R(x), -R(z))));
  const g = new THREE.ExtrudeGeometry(s, { depth: R(h) - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, bevel);
  g.rotateX(-Math.PI / 2);
  g.translate(0, R(y0), 0);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// order points around their centroid (robust for the hood outline)
function sortLoop(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.slice().sort((a, b) => Math.atan2(a[1] - cz, a[0] - cx) - Math.atan2(b[1] - cz, b[0] - cx));
}

export { roundedBox };
