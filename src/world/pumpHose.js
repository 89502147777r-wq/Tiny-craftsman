import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// drawn 2.5 × larger than true scale, so it reads on the screen beside the house
const G = 2.5 / MODEL_SCALE;

// The end hose of a boom concrete pump: a heavy rubber hose (DN125, ~140 mm outside,
// 3.5 m long real) hanging from the boom tip. Simulated as a rope
// (Verlet points with length constraints and gravity): the end is pulled towards
// the finger, so the hose swings and lags when it is moved; the boom tip follows
// slowly. Ribbed rubber, dirty with concrete towards the end; a steel end coupling
// with a handle bar to hold it by.
const N = 26;                 // rope points
const LEN = 3.5 * G;        // hose length (model m)
const R = 0.07 * G;         // outer radius
const SEG = LEN / (N - 1);

export class PumpHose {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'pump-hose';
    this.p = Array.from({ length: N }, () => new THREE.Vector3());
    this.o = Array.from({ length: N }, () => new THREE.Vector3());
    this.ready = false;
    this.anchor = new THREE.Vector3();
    this.target = new THREE.Vector3();
    const rubber = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.5 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), rubber);
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.38, metalness: 0.85 });
    const grip = new THREE.MeshStandardMaterial({ color: 0xd8641e, roughness: 0.65 });
    // end: coupling ring + short steel spout, and a bent handle bar on one side
    this.end = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.12, R * 1.12, 0.06 * G, 24), steel);
    ring.position.y = -0.03 * G;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.95, 0.1 * G, 24, 1, true), steel);
    spout.position.y = -0.1 * G;
    const bar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(R * 1.1, -0.01 * G, 0), new THREE.Vector3(R * 1.1 + 0.12 * G, 0.02 * G, 0),
      new THREE.Vector3(R * 1.1 + 0.14 * G, 0.18 * G, 0), new THREE.Vector3(R * 1.05, 0.22 * G, 0),
    ]), 20, 0.012 * G, 10, false), steel);
    const gripM = new THREE.Mesh(new THREE.CylinderGeometry(0.017 * G, 0.017 * G, 0.11 * G, 12), grip);
    gripM.position.set(R * 1.1 + 0.14 * G, 0.1 * G, 0);
    this.end.add(ring, spout, bar, gripM);
    // the concrete coming out: a heavy, slightly wobbling stream down to the surface
    const wet = new THREE.MeshStandardMaterial({ color: 0x65635e, roughness: 0.22, metalness: 0 });   // wet cement paste
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.9, 1, 18, 10, true), wet);
    this.stream.geometry.translate(0, -0.5, 0);   // hangs down from its top
    this._sBase = this.stream.geometry.attributes.position.array.slice();
    this.stream.visible = false;
    this.group.add(this.mesh, this.end, this.stream);
    this.group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this._q = new THREE.Quaternion();
  }

  // where the spout should be (a little above the concrete) and from where the camera looks
  aim(tip, camPos, snap = false) {
    this.target.copy(tip);
    // the boom tip: high above, away from the camera so the hose comes into view from above
    const away = new THREE.Vector3(tip.x - camPos.x, 0, tip.z - camPos.z).normalize();
    const goal = new THREE.Vector3(tip.x + away.x * 0.25, tip.y + LEN * 0.92, tip.z + away.z * 0.25);
    if (snap || !this.ready) {
      this.anchor.copy(goal);
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1);
        this.p[i].lerpVectors(this.anchor, tip, f);
        this.p[i].y -= Math.sin(f * Math.PI) * 0.06;
        this.o[i].copy(this.p[i]);
      }
      this.ready = true;
    } else this.anchorGoal = goal;
  }

  update(dt) {
    if (!this.ready || !this.group.visible) return;
    dt = Math.min(dt, 1 / 20);
    if (this.anchorGoal) this.anchor.lerp(this.anchorGoal, 1 - Math.exp(-dt * 1.5));   // the boom moves slowly
    const steps = 3, h = dt / steps, g = -9.81 * h * h;
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < N; i++) {
        const p = this.p[i], o = this.o[i];
        const vx = (p.x - o.x) * 0.985, vy = (p.y - o.y) * 0.985, vz = (p.z - o.z) * 0.985;
        o.copy(p);
        p.x += vx; p.y += vy + g; p.z += vz;
      }
      // the end is held (pulled firmly towards the finger, but not rigidly)
      const e = this.p[N - 1];
      e.lerp(this.target, 0.35);
      this.p[0].copy(this.anchor);
      for (let it = 0; it < 14; it++) {
        for (let i = 0; i < N - 1; i++) {
          const a = this.p[i], b = this.p[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 1e-9;
          const k = (d - SEG) / d;
          const wa = i === 0 ? 0 : 0.5, wb = i + 1 === N - 1 ? 0.15 : 0.5;
          const sum = wa + wb || 1;
          a.x += dx * k * wa / sum; a.y += dy * k * wa / sum; a.z += dz * k * wa / sum;
          b.x -= dx * k * wb / sum; b.y -= dy * k * wb / sum; b.z -= dz * k * wb / sum;
        }
        this.p[0].copy(this.anchor);
        this._hold();
      }
    }
    // rebuild the mesh only when the hose has moved
    let moved = 0;
    for (let i = 0; i < N; i += 5) moved = Math.max(moved, this.p[i].distanceToSquared(this._last?.[i] || _far));
    if (moved > 1e-8) { this._last = this.p.map((v) => v.clone()); this._build(); }
  }

  // the worker holds the last ~40 cm (real) of the hose upright: the spout points down
  _hold() {
    const e = this.p[N - 1];
    for (let k = 1; k <= 2; k++) {
      const q = this.p[N - 1 - k];
      q.x += (e.x - q.x) * 0.7; q.z += (e.z - q.z) * 0.7;
      q.y = Math.max(q.y, e.y + SEG * k * 0.95);
    }
  }

  _build() {
    const curve = new THREE.CatmullRomCurve3(this.p);
    const geo = new THREE.TubeGeometry(curve, 60, R, 12, false), old = this.mesh.geometry, same = old.attributes.position?.count === geo.attributes.position.count;
    // ribs every ~5 cm (real) and concrete splashed over the last metre
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const col = same ? null : new Float32Array(pos.count * 3);
    const rings = 61, radial = 13;
    for (let j = 0; j < rings; j++) {
      const u = j / (rings - 1), along = u * LEN / G;   // real metres from the boom
      const rib = 1 + 0.035 * Math.pow(Math.max(0, Math.cos(along / 0.05 * Math.PI * 2)), 6);
      const dirt = Math.max(0, (along - 2.4) / 1.1);
      for (let k = 0; k < radial; k++) {
        const v = j * radial + k;
        pos.setXYZ(v, pos.getX(v) + nor.getX(v) * R * (rib - 1), pos.getY(v) + nor.getY(v) * R * (rib - 1), pos.getZ(v) + nor.getZ(v) * R * (rib - 1));
        if (same) continue;   // (the colours stay: they go with the rings, not the shape)
        const n = hash(j * 31 + k * 7);
        const splash = dirt * dirt * (0.3 + 0.7 * n) * (nor.getY(v) > -0.2 ? 1 : 0.5) * 0.6;
        const base = 0.022 + 0.01 * n;   // black rubber
        col[v * 3] = base + splash * 0.2; col[v * 3 + 1] = base + splash * 0.195; col[v * 3 + 2] = base + splash * 0.185;
      }
    }
    if (same) {
      // (the buffers on the GPU stay: only the positions and normals are sent)
      old.attributes.position.array.set(pos.array); old.attributes.normal.array.set(nor.array);
      old.attributes.position.needsUpdate = old.attributes.normal.needsUpdate = true;
      old.computeBoundingSphere(); geo.dispose();
    } else {
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      old.dispose();
      this.mesh.geometry = geo;
    }
    // the end coupling follows the last piece of hose
    const e = this.p[N - 1], d = new THREE.Vector3().subVectors(this.p[N - 1], this.p[N - 2]).normalize();
    this.end.position.copy(e);
    // spout straight down, leaning a little with the hose
    this.end.quaternion.setFromUnitVectors(_down, d.lerp(_down, 0.75).normalize());
  }

  // the stream: on while pumping, down to the surface at groundY
  setStream(on, groundY, time) {
    this.stream.visible = on;
    if (!on) return;
    const top = this.spout();
    const h = Math.max(0.005, top.y - groundY);
    this.stream.position.copy(top);
    this.stream.scale.set(1, h, 1);
    // a little wobble and bulge travelling down
    const p = this.stream.geometry.attributes.position, b = this._sBase;
    for (let i = 0; i < p.count; i++) {
      const y = b[i * 3 + 1], a = Math.atan2(b[i * 3 + 2], b[i * 3]);
      const k = 1 + 0.05 * Math.sin(y * 9 + time * 14 + a * 2) + 0.04 * Math.sin(a * 3 - time * 5);   // lumpy, not ribbed
      p.setX(i, b[i * 3] * k + Math.sin(time * 7 + y * 6) * 0.0008);
      p.setZ(i, b[i * 3 + 2] * k);
    }
    p.needsUpdate = true;
    this.stream.geometry.computeVertexNormals();
  }

  // where the concrete comes out, and in which direction
  spout(out = new THREE.Vector3()) { return out.set(0, -0.15 * G, 0).applyQuaternion(this.end.quaternion).add(this.end.position); }
  flow(out = new THREE.Vector3()) { return out.set(0, -1, 0).applyQuaternion(this.end.quaternion); }
}

const _down = new THREE.Vector3(0, -1, 0), _far = new THREE.Vector3(1e3, 1e3, 1e3);
function hash(i) { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); }
