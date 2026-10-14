import * as THREE from 'three';
import { innerCorner } from '../plotShape.js';

// Common machine behaviour: pose on the plot (x, z, yaw), following the
// ground (pitch/roll from the contact points), staying inside the tray,
// driving input, and blade/bucket bulldozing that conserves soil volume.
export class Machine {
  constructor(app, kind) {
    this.app = app;
    this.kind = kind;
    this.root = new THREE.Group();        // world pose
    this.root.name = kind;
    this.body = new THREE.Group();        // pitch / roll inside
    this.root.add(this.body);
    this.x = 0; this.z = 0; this.yaw = 0;
    this.y = 0; this.pitch = 0; this.roll = 0;
    this.v = 0; this.yawRate = 0;
    this.throttle = 0; this.steer = 0;
    this.contacts = [];                    // local [x, z] ground contact points
    this.radius = 0.1;                     // keep-inside radius
    this.load = 0;                         // soil carried (m³)
    this.moved = 0;
    this.id = null;                        // object-store id
  }

  // Models are measured and assembled with the machine at the origin, unturned
  // (a turned model gives inflated world bounding boxes). _zero() → build → _unzero().
  _zero() {
    const saved = { q: this.root.quaternion.clone(), p: this.root.position.clone(), b: this.body.quaternion.clone() };
    this.root.quaternion.identity(); this.root.position.set(0, 0, 0); this.body.quaternion.identity();
    this.root.updateMatrixWorld(true);
    return saved;
  }

  _unzero(s) {
    this.root.quaternion.copy(s.q); this.root.position.copy(s.p); this.body.quaternion.copy(s.b);
    this.root.updateMatrixWorld(true);
  }

  forward(out = new THREE.Vector2()) { return out.set(Math.cos(this.yaw), -Math.sin(this.yaw)); }
  local(lx, lz, out = new THREE.Vector3()) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.x + lx * c + lz * s, 0, this.z - lx * s + lz * c);
  }

  groundAt(x, z) {
    const t = this.app.terrain;
    return t.inside(x, z) ? t.heightAt(x, z) : t.heightAt(t.clampX(x), t.clampZ(z));
  }

  followGround(dt, snap = false) {
    if (!this.contacts.length) {
      // model not built yet: just stand on the ground
      this.y = this.groundAt(this.x, this.z);
      this.root.position.set(this.x, this.y, this.z);
      this.root.rotation.set(0, this.yaw, 0);
      return;
    }
    const pts = this.contacts.map(([lx, lz]) => { const p = this.local(lx, lz); return [lx, lz, this.groundAt(p.x, p.z)]; });
    // fit a plane through the contacts (least squares on local x / z)
    let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxy = 0, szy = 0;
    for (const [lx, lz, h] of pts) { sx += lx; sz += lz; sy += h; sxx += lx * lx; szz += lz * lz; sxy += lx * h; szy += lz * h; }
    const n = pts.length;
    const my = sy / n, mx = sx / n, mz = sz / n;
    const kx = (sxy - n * mx * my) / Math.max(1e-9, sxx - n * mx * mx);
    const kz = (szy - n * mz * my) / Math.max(1e-9, szz - n * mz * mz);
    // the machine rests on the highest contacts rather than sinking into bumps
    let top = -1e9;
    for (const [lx, lz, h] of pts) top = Math.max(top, h - (my + kx * (lx - mx) + kz * (lz - mz)));
    const y = my + top * 0.6, pitch = Math.atan(kx), roll = -Math.atan(kz);
    const k = snap ? 1 : 1 - Math.exp(-dt * 10);
    this.y += (y - this.y) * k; this.pitch += (pitch - this.pitch) * k; this.roll += (roll - this.roll) * k;
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.body.rotation.set(this.roll, 0, this.pitch, 'XZY');
  }

  keepInside() {
    const t = this.app.terrain;
    let rx = this.radius, rz = this.radius;
    if (this.half) {
      // long vehicles: the footprint box turned by the heading
      const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw)), [hx, hz] = this.half;
      rx = c * hx + s * hz; rz = s * hx + c * hz;
    }
    this.x = Math.max(-t.halfX + rx, Math.min(t.halfX - rx, this.x));
    this.z = Math.max(-t.halfZ + rz, Math.min(t.halfZ - rz, this.z));
    // the rounded corner of the tray
    const c = innerCorner();
    const dx = (this.x - c.cx) * c.sx, dz = (this.z - c.cz) * c.sz;
    if (dx > 0 && dz > 0) {
      const lim = Math.max(0, c.r - Math.min(rx, rz)), d = Math.hypot(dx, dz);
      if (d > lim) { const k = lim / d; this.x = c.cx + c.sx * dx * k; this.z = c.cz + c.sz * dz * k; }
    }
  }

  // Cut everything above cutY under a blade edge (centre, lateral width) that
  // moved `dist` forward; fill the bucket up to `room`, push the rest ahead.
  bulldoze(center, width, cutY, dist, room) {
    const t = this.app.terrain;
    const f = this.forward();
    const spec = { width, length: Math.max(dist, t.cell * 1.2), pointed: false };
    const cx = center.x - f.x * spec.length / 2, cz = center.z - f.y * spec.length / 2;
    const got = t.carve(cx, cz, f.x, f.y, spec, cutY, 1);
    if (got <= 0) return 0;
    const toBucket = Math.min(got, Math.max(0, room));
    const pushed = got - toBucket;
    if (pushed > 0) {
      const n = 5, lat = new THREE.Vector2(-f.y, f.x);
      for (let i = 0; i < n; i++) {
        const o = (i / (n - 1) - 0.5) * width * 0.9;
        t.deposit(center.x + f.x * 0.004 + lat.x * o, center.z + f.y * 0.004 + lat.y * o, pushed / n, 0.004);
      }
    }
    return toBucket;
  }

  // ---- persistence ------------------------------------------------------------------------
  baseRecord() {
    return { type: 'machine', kind: this.kind, x: +this.x.toFixed(6), z: +this.z.toFixed(6), yaw: +this.yaw.toFixed(5), load: this.load };
  }

  applyBase(r) {
    this.x = r.x; this.z = r.z; this.yaw = r.yaw; this.load = r.load || 0;
    this.v = 0; this.yawRate = 0;
    this.followGround(0, true);
  }
}
