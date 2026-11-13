import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// The end hose of a boom concrete pump, as on a site (checked by the realist, .claude/agents/realist.md):
//   the hose — rubber DN125 (Ø 140 outside), 4 m, hanging from a 90° steel elbow at the boom's tip, drawn
//     at 1,35 × true size (so it reads on a phone beside the house — no more: at 2,5 × it was a pipe, not a
//     hose); a rope of Verlet points (lengths, gravity, a bending stiffness — no kink tighter than ~0,8 m);
//   the hand — a worker holds the end ~0,5 m over the concrete and walks it: it follows the finger no faster
//     than ~1,2 m/s, with ~4 m/s² to get going or to stop (150 kg of hose full of concrete); the boom's tip
//     is moved by the operator only when the hand has gone > 1,2 m from under it, slowly;
//   the pump — two pistons, a stroke every ~3 s: at the switch the flow nearly stops for a quarter second,
//     then comes out in a surge, and the hose jerks;
//   the stream — a column of concrete out of the spout (~1 m/s), in pieces that keep the spout's own speed
//     as they fall: swept, it lags and bends; stopped short, its foot goes on a little and comes back; it lands
//     where it falls — that place (not the finger) is where the concrete goes (`landing`).
const G = 1.35 / MODEL_SCALE, M = 1 / MODEL_SCALE;
const N = 24;                 // rope points
const LEN = 4.0 * G;          // hose length (model units)
const R = 0.07 * G;           // outer radius
const SEG = LEN / (N - 1);
// (the owner: the real walking pace (1,2 m/s, 4 m/s²) is too slow to work with — halfway to following the finger)
const VMAX = 2.6 * M, AMAX = 12 * M, GRAV = 9.81 * M, OUT = 1.0 * M;   // the hand's speed / acceleration; g; the concrete's exit speed
const STROKE = 3.0;           // s between the pistons' switches

export class PumpHose {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'pump-hose';
    this.p = Array.from({ length: N }, () => new THREE.Vector3());
    this.o = Array.from({ length: N }, () => new THREE.Vector3());
    this.ready = false;
    this.anchor = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.hand = new THREE.Vector3(); this.hv = new THREE.Vector3();
    this.t = 0; this.drops = []; this.landing = null;
    const rubber = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.5 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), rubber);
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.38, metalness: 0.85 });
    const paint = new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.55, metalness: 0.5 });
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
    // the boom's tip: the last steel pipe of the boom, a 90° elbow down, the clamp the hose hangs from
    this.tip = new THREE.Group();
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 1.6 * G, 18), paint);
    pipe.rotation.z = Math.PI / 2; pipe.position.set(-0.8 * G - R * 2, R * 2, 0);
    const elbow = new THREE.Mesh(new THREE.TorusGeometry(R * 2, R * 0.95, 12, 18, Math.PI / 2), paint);
    elbow.rotation.set(0, 0, Math.PI); elbow.position.set(0, R * 2, 0);
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.2, R * 1.2, 0.08 * G, 20), steel);
    this.tip.add(pipe, elbow, clamp);
    // the concrete coming out: a tube along the falling pieces, remade every frame
    this.wet = new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.25, metalness: 0 });   // wet, fresh: dark and shining
    this.stream = new THREE.Mesh(new THREE.BufferGeometry(), this.wet);
    this.stream.visible = false; this.stream.frustumCulled = false;
    this.group.add(this.mesh, this.end, this.tip, this.stream);
    this.group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }

  // where the spout should be (a little above the concrete) and from where the camera looks
  aim(tip, camPos, snap = false) {
    this.target.copy(tip);
    if (snap || !this.ready) {
      // (the boom's tip high over the hand, a little away from the camera: the hose comes into view from above)
      const away = new THREE.Vector3(tip.x - camPos.x, 0, tip.z - camPos.z).normalize();
      this.anchor.set(tip.x + away.x * 0.3 * M, tip.y + LEN * 0.9, tip.z + away.z * 0.3 * M);
      this.anchorGoal = this.anchor.clone();
      this.hand.copy(tip); this.hv.set(0, 0, 0);
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1);
        this.p[i].lerpVectors(this.anchor, tip, f);
        this.p[i].y -= Math.sin(f * Math.PI) * 0.06;
        this.o[i].copy(this.p[i]);
      }
      this.drops.length = 0;
      this.ready = true;
    }
  }
  // the flow just now (×, 1 on the average): nearly nothing at a stroke's switch, a surge after it
  pulse() { const u = (this.t % STROKE) / STROKE; return u < 0.08 ? 0.6 : u < 0.2 ? 1.25 : 1 - 0.06 * Math.sin(u * Math.PI); }   // (the stroke softened: a dip and a swell, not a spit — the owner: real, but awkward)

  update(dt) {
    if (!this.ready || !this.group.visible) return;
    dt = Math.min(dt, 1 / 20);
    const t0 = this.t; this.t += dt;
    // the hand: toward the finger no faster than a man walks a full hose, getting going and stopping as he can
    {
      const want = this.target.clone().sub(this.hand), d = want.length();
      const vGoal = d > 1e-9 ? want.multiplyScalar(Math.min(VMAX, d * 5) / d) : want.set(0, 0, 0);
      const dv = vGoal.sub(this.hv), a = dv.length(), amax = AMAX * dt;
      if (a > amax) dv.multiplyScalar(amax / a);
      this.hv.add(dv); this.hand.addScaledVector(this.hv, dt);
    }
    // the boom's tip: moved only when the hand is far from under it, slowly
    {
      const dx = this.hand.x - this.anchor.x, dz = this.hand.z - this.anchor.z, off = Math.hypot(dx, dz);
      if (off > 1.2 * M) { this.anchorGoal = new THREE.Vector3(this.hand.x - dx / off * 0.6 * M, this.anchor.y, this.hand.z - dz / off * 0.6 * M); }
      this.anchorGoal.y = this.hand.y + LEN * 0.9;
      const step = this.anchorGoal.clone().sub(this.anchor), l = step.length(), vmax = 1.0 * M * dt;
      if (l > vmax) step.multiplyScalar(vmax / l);
      this.anchor.add(step);
    }
    // a piston's stroke: the hose jerks (its lower part kicked along and aside)
    if (Math.floor(t0 / STROKE) !== Math.floor(this.t / STROKE) && this.stream.visible) {
      const side = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(0.08 * M);
      for (let i = N - 8; i < N - 1; i++) { const k = (i - (N - 8)) / 7; this.o[i].addScaledVector(side, -k).y -= 0.04 * M * k; }
    }
    const steps = 3, h = dt / steps, g = -9.81 * h * h;
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < N; i++) {
        const p = this.p[i], o = this.o[i];
        // (a hose full of concrete — ~35 kg a metre: it does not flutter, it swings slowly and stops)
        const vx = (p.x - o.x) * 0.955, vy = (p.y - o.y) * 0.97, vz = (p.z - o.z) * 0.955;
        o.copy(p);
        p.x += vx; p.y += vy + g; p.z += vz;
      }
      // the end is in the worker's hands
      this.p[N - 1].lerp(this.hand, 0.5);
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
        // (stiff to bend: each point drawn a little toward the line between its neighbours — no kinks)
        // (the owner: it dangled right under the head like an empty rag — a full rubber hose DN125 is stiff: bent every pass, harder)
        for (let i = 1; i < N - 1; i++) { const a = this.p[i - 1], b = this.p[i + 1], q = this.p[i]; q.x += ((a.x + b.x) / 2 - q.x) * 0.2; q.y += ((a.y + b.y) / 2 - q.y) * 0.2; q.z += ((a.z + b.z) / 2 - q.z) * 0.2; }
        this.p[0].copy(this.anchor);
        this._root();
        this._hold();
      }
    }
    let moved = 0;
    for (let i = 0; i < N; i += 5) moved = Math.max(moved, this.p[i].distanceToSquared(this._last?.[i] || _far));
    if (moved > 1e-8) { this._last = this.p.map((v) => v.clone()); this._build(); }
    this.tip.position.copy(this.anchor);
    this.tip.rotation.set(0, Math.atan2(this.anchor.x - this.hand.x, this.anchor.z - this.hand.z) - Math.PI / 2, 0);
  }

  // out of the clamp at the elbow the hose goes straight down: its first half metre stands in the coupling, it bends
  // only below that — in a wide curve, not at the clamp
  _root() {
    const a = this.anchor, w = [0.92, 0.7, 0.4, 0.18];
    for (let k = 1; k <= 4; k++) { const q = this.p[k]; q.x += (a.x - q.x) * w[k - 1]; q.z += (a.z - q.z) * w[k - 1]; q.y += (a.y - SEG * k - q.y) * w[k - 1] * 0.6; }
  }
  // the worker holds the last ~0,5 m of the hose: it hangs down from the hands, leaning with the walk (≤ ~25°)
  _hold() {
    const e = this.p[N - 1];
    for (let k = 1; k <= 2; k++) {
      const q = this.p[N - 1 - k];
      q.x += (e.x - this.hv.x * 0.12 - q.x) * 0.35; q.z += (e.z - this.hv.z * 0.12 - q.z) * 0.35;
      q.y = Math.max(q.y, e.y + SEG * k * 0.85);
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
      const dirt = Math.max(0, (along - 2.9) / 1.1);
      for (let k = 0; k < radial; k++) {
        const v = j * radial + k;
        pos.setXYZ(v, pos.getX(v) + nor.getX(v) * R * (rib - 1), pos.getY(v) + nor.getY(v) * R * (rib - 1), pos.getZ(v) + nor.getZ(v) * R * (rib - 1));
        if (same) continue;
        const n = hash(j * 31 + k * 7);
        const splash = dirt * dirt * (0.3 + 0.7 * n) * (nor.getY(v) > -0.2 ? 1 : 0.5) * 0.6;
        const base = 0.022 + 0.01 * n;   // black rubber
        col[v * 3] = base + splash * 0.2; col[v * 3 + 1] = base + splash * 0.195; col[v * 3 + 2] = base + splash * 0.185;
      }
    }
    if (same) {
      old.attributes.position.array.set(pos.array); old.attributes.normal.array.set(nor.array);
      old.attributes.position.needsUpdate = old.attributes.normal.needsUpdate = true;
      old.computeBoundingSphere(); geo.dispose();
    } else {
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      old.dispose();
      this.mesh.geometry = geo;
    }
    const e = this.p[N - 1], d = new THREE.Vector3().subVectors(this.p[N - 1], this.p[N - 2]).normalize();
    this.end.position.copy(e);
    this.end.quaternion.setFromUnitVectors(_down, d.lerp(_down, 0.6).normalize());
  }

  // the stream: on while pumping; groundAt(x, z) → the height it lands on there. Returns where it lands (the
  // first piece to reach the surface this frame — or under the spout before any has), or null when off
  // (still: into a narrow thing — a column's formwork, a post's hole: the spout is held over it, the stream goes straight down)
  setStream(on, groundAt = null, time = 0, dt = 1 / 60, still = false) {
    if (!on) { this.stream.visible = false; this.drops.length = 0; this.landing = null; this._sp0 = null; return null; }
    // (the owner: the stream was a flat ribbon, zigzag, or gone between the pump's strokes. Now it is what a stream of pumped
    // concrete is: one round rope, ~70 % of the hose's diameter, never broken. Each piece in it left the spout with the
    // spout's velocity — so, the spout moving steadily, the rope hangs under it (a piece let go earlier from further back
    // has come as far as the spout since); it lags only by what the air and the hose's sway take: a fifth of the spout's speed)
    const sp = this.spout(), fl = still ? _down.clone() : this.flow().lerp(_down, 0.7).normalize(), gAt = groundAt || (() => sp.y - 0.5 * M);
    dt = Math.min(dt, 1 / 20);
    const sv = new THREE.Vector3();
    if (this._sp0 && !still) { sv.copy(sp).sub(this._sp0); if (sv.length() > 0.5 * M) sv.set(0, 0, 0); else { sv.divideScalar(Math.max(1e-4, dt)); if (sv.length() > VMAX) sv.setLength(VMAX); } }
    this._sp0 = sp.clone();
    // (the spout's speed smoothed over a fifth of a second: a stroke's kick does not whip the rope)
    this._sv = (this._sv || new THREE.Vector3()).lerp(sv, Math.min(1, dt * 5));
    const pu = this.pulse(), v0 = fl.clone().multiplyScalar(OUT * (0.85 + 0.15 * pu)), lagV = this._sv.clone().multiplyScalar(-0.2);
    lagV.y = 0;
    // the rope: positions of the pieces of every age τ, till one meets the surface
    const pts = [sp.clone()], drops = [];
    let land = null;
    for (let k = 1, tau = 0; k <= 60 && !land; k++) {
      tau += 0.02;
      const q = new THREE.Vector3(sp.x + (v0.x + lagV.x) * tau, sp.y + v0.y * tau - 0.5 * GRAV * tau * tau, sp.z + (v0.z + lagV.z) * tau);
      const gy = gAt(q.x, q.z);
      if (q.y <= gy) { q.y = gy; land = q.clone(); }
      pts.push(q); drops.push({ p: q, age: tau });
    }
    if (!land) land = pts.at(-1).clone();
    this.drops = drops; this.landing = land.clone();
    // (thinner below as it speeds up — as much concrete passes every height: 70 % of the hose's bore at the spout, ~58 % below)
    const r0 = 0.8 * R * (0.94 + 0.06 * pu), r1 = r0 * 0.8;   // (80 % of the hose: between the owner's 70 and the realist's plug of 90–100; a pumped mix hardly thins)
    const P = [], I = [], segs = Math.max(2, Math.min(24, pts.length - 1)), rad = 10;
    const curve = new THREE.CatmullRomCurve3(pts.length > 2 ? pts : [pts[0], pts[0].clone().lerp(pts[1], 0.5), pts[1]]);
    // (rings along the rope by parallel transport: the frame turns with the rope, never flips — it was flipping where the
    // rope passed «mostly along x», and the rings twisted the tube into a flat ribbon)
    let n = null;
    for (let j = 0; j <= segs; j++) {
      const u = j / segs, c = curve.getPointAt(u), tg = curve.getTangentAt(u);
      if (!n) { n = Math.abs(tg.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); }
      n.addScaledVector(tg, -n.dot(tg)).normalize();
      const b = new THREE.Vector3().crossVectors(tg, n).normalize();
      const r = r0 + (r1 - r0) * u;
      for (let k = 0; k <= rad; k++) {
        const a = k / rad * Math.PI * 2, am = 0.05 + 0.07 * u, run = time * 9 * Math.sqrt(1 + 6 * u), lump = 1 + am * Math.sin(a * 3 + u * 11 - run) + am * 0.8 * Math.sin(u * 23 + a * 2 - run * 1.4);   // (lumps and folds, more of them below, running down faster as it falls)
        const ca = Math.cos(a) * r * lump, sa = Math.sin(a) * r * lump;
        P.push(c.x + n.x * ca + b.x * sa, c.y + n.y * ca + b.y * sa, c.z + n.z * ca + b.z * sa);
      }
    }
    for (let j = 0; j < segs; j++) for (let k = 0; k < rad; k++) { const a = j * (rad + 1) + k; I.push(a, a + rad + 1, a + 1, a + 1, a + rad + 1, a + rad + 2); }
    const g = this.stream.geometry;
    if (!g.attributes.position || g.attributes.position.count !== P.length / 3) { g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); }
    else { g.attributes.position.array.set(P); g.attributes.position.needsUpdate = true; }
    g.computeVertexNormals(); g.computeBoundingSphere();
    this.stream.visible = true;
    this.stream.userData.bottomR = r1; this.stream.userData.topR = r0;
    return this.landing;
  }

  // where the concrete comes out, and in which direction
  spout(out = new THREE.Vector3()) { return out.set(0, -0.15 * G, 0).applyQuaternion(this.end.quaternion).add(this.end.position); }
  flow(out = new THREE.Vector3()) { return out.set(0, -1, 0).applyQuaternion(this.end.quaternion); }
}

const _down = new THREE.Vector3(0, -1, 0), _far = new THREE.Vector3(1e3, 1e3, 1e3);
function hash(i) { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); }
