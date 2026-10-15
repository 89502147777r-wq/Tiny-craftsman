import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAKE, K } from '../config.js';
import { variant } from './assets.js';

// A scale garden rake. Local frame: the line of tine tips along X centred at
// the origin, tines up to +Y, the handle rising towards +Z (the person) at
// `lift` above the ground. Poses are smoothed like the shovel's.
export class Rake {
  constructor(tex) {
    this.root = new THREE.Group();
    this.root.name = 'rake';
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c3329, metalness: 0.75, roughness: 0.48 });
    const wood = new THREE.MeshStandardMaterial({
      map: variant(tex.table.diff, 0.05, 0.6), normalMap: variant(tex.table.nor, 0.05, 0.6),
      roughness: 0.62, metalness: 0, color: 0xc9a27a,
    });
    const W = RAKE.width, T = RAKE.tineLen, n = RAKE.tines;
    const r = 0.0005 * K;   // tine radius (6 mm real)
    // tines: slightly curved towards the handle, tips sharpened
    const tines = [];
    for (let k = 0; k < n; k++) {
      const x = -W / 2 + (W * k) / (n - 1);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0, 0.18 * T), new THREE.Vector3(x, 0.35 * T, -0.02 * T), new THREE.Vector3(x, T, 0));
      const g = new THREE.TubeGeometry(curve, 6, r, 6, false);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {   // taper towards the tip
        const y = p.getY(i), f = 0.45 + 0.55 * Math.min(1, y / (0.4 * T));
        p.setX(i, x + (p.getX(i) - x) * f);
      }
      tines.push(g.toNonIndexed());
    }
    const bar = new THREE.BoxGeometry(W + 0.002 * K, 0.0016 * K, 0.0011 * K).toNonIndexed();
    bar.translate(0, T + 0.0006 * K, 0);
    // bow from the bar ends up to the socket, the usual rake neck
    const neck = [];
    for (const sx of [-1, 1]) {
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(sx * W * 0.32, T + 0.001 * K, 0), new THREE.Vector3(sx * W * 0.1, T + 0.004 * K, 0.002 * K), new THREE.Vector3(0, T + 0.0045 * K, 0.004 * K));
      neck.push(new THREE.TubeGeometry(c, 8, 0.00035 * K, 6, false).toNonIndexed());
    }
    const head = new THREE.Mesh(mergeGeometries([...tines, bar, ...neck]), steel);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.0013 * K, 0.0016 * K, 0.008 * K, 14), steel);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.00125 * K, 0.00135 * K, RAKE.handle, 14), wood);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0014 * K, 12, 8), wood);
    this.handle = new THREE.Group();
    this.handle.position.set(0, T + 0.0045 * K, 0.004 * K);
    socket.position.y = 0.004 * K;
    handle.position.y = 0.008 * K + RAKE.handle / 2;
    knob.position.y = 0.008 * K + RAKE.handle;
    this.handle.add(socket, handle, knob);
    this.root.add(head, this.handle);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    this.pos = new THREE.Vector3(0, 0.1, 0);
    this.dir = new THREE.Vector2(0, 1);   // where the handle points (horizontal)
    this.lift = 0.6;                      // handle angle above the ground (rad)
    this.target = { pos: this.pos.clone(), dir: this.dir.clone(), lift: this.lift };
  }

  setPose({ pos, dir, lift }, snap = false) {
    if (pos) this.target.pos.copy(pos);
    if (dir && dir.lengthSq() > 1e-8) this.target.dir.copy(dir).normalize();
    if (lift !== undefined) this.target.lift = lift;
    if (snap) { this.pos.copy(this.target.pos); this.dir.copy(this.target.dir); this.lift = this.target.lift; }
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 24), kr = 1 - Math.exp(-dt * 12);
    this.pos.lerp(this.target.pos, k);
    this.dir.lerp(this.target.dir, kr).normalize();
    this.lift += (this.target.lift - this.lift) * kr;
    this.root.position.copy(this.pos);
    // X across the head, Y up, Z along the handle's ground direction
    const h = _z.set(this.dir.x, 0, this.dir.y), a = _x.set(h.z, 0, -h.x);
    _m.makeBasis(a, _y.set(0, 1, 0), h);
    this.root.quaternion.setFromRotationMatrix(_m);
    this.handle.rotation.x = Math.PI / 2 - this.lift;
  }
}

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
