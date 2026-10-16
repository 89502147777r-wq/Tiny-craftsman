import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// Rigid-body physics (Rapier, loaded only when first needed). Everything is
// simulated in real units — metres, kilograms, seconds, g = 9.81 — so a board
// falls and bounces like a real one; positions are converted from / to the model
// (1:3.5) at the edges.
//
// An Episode is one short simulation: the ground of a patch of the plot (soil and
// concrete, as a triangle mesh) plus the bodies thrown onto it, until they lie still.
const S = MODEL_SCALE;
let R = null, loading = null;

export function loadPhysics() {
  if (!loading) {
    loading = import('@dimforge/rapier3d-compat').then(async (m) => {
      const r = m.default || m;
      await r.init();
      R = r;
      return r;
    });
  }
  return loading;
}
export const physicsReady = () => !!R;

export const DENSITY = { wood: 500, steel: 7850 };
const _Y = new THREE.Vector3(0, 1, 0);   // kg/m³ (pine boards and stakes, rebar)

export class Episode {
  // the ground: cells of the terrain inside the box x0…x1, z0…z1 (model units), every `st` cells
  constructor(terrain, x0, z0, x1, z1, st = 3, hz = 60) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.hz = hz;
    this.world.timestep = 1 / hz;
    const t = terrain;
    const ix0 = Math.max(0, Math.floor(t.toCellX(x0))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(x1)));
    const iz0 = Math.max(0, Math.floor(t.toCellZ(z0))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(z1)));
    // a height field (much faster than a triangle mesh): rows along z, columns along x,
    // column-major heights, centred on the collider
    const nx = Math.max(2, Math.ceil((ix1 - ix0) / st)), nz = Math.max(2, Math.ceil((iz1 - iz0) / st));
    const h = new Float32Array((nx + 1) * (nz + 1));
    for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) {
      // the lowest point around each sample: a step in the ground (the edge of a slab)
      // must not creep out under something standing next to it
      const ix = Math.min(t.rx, ix0 + a * st), iz = Math.min(t.rz, iz0 + b * st);
      let m = Infinity;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = Math.max(0, Math.min(t.rx, ix + dx * st / 2 | 0)), jz = Math.max(0, Math.min(t.rz, iz + dz * st / 2 | 0));
        m = Math.min(m, t.hAt(jz * t.nx + jx));
      }
      h[b + a * (nz + 1)] = m * S;
    }
    const sx = nx * st * t.cell * S, sz = nz * st * t.cell * S;
    const cx = (t.toWorldX(ix0) * S) + sx / 2, cz = (t.toWorldZ(iz0) * S) + sz / 2;
    this.world.createCollider(R.ColliderDesc.heightfield(nz, nx, h, { x: sx, y: 1, z: sz }).setTranslation(cx, 0, cz).setFriction(0.8).setRestitution(0.05));
    this.bodies = [];
    this.acc = 0;
    this.time = 0;
    this.maxV = 3; this.maxW = 8;   // m/s, rad/s
  }

  // a box (half sizes in model units) of wood or steel at a model position / rotation
  box(hx, hy, hz, p, q, { density = DENSITY.wood, friction = 0.6, kinematic = false } = {}) {
    const d = (kinematic ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
      .setTranslation(p.x * S, p.y * S, p.z * S).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.05).setAngularDamping(0.3);
    const body = this.world.createRigidBody(d);
    this.world.createCollider(R.ColliderDesc.cuboid(hx * S, hy * S, hz * S).setDensity(density).setFriction(friction).setRestitution(0.12), body);
    this.bodies.push(body);
    return body;
  }

  // ---- shapes for rebar (model units in, real units inside) ---------------------------
  // a fixed bar / chair / support the moving pieces can lie on
  staticCapsule(A, B, r) {
    const d = new THREE.Vector3().subVectors(B, A), L = d.length();
    if (L < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(_Y, d.divideScalar(L)), c = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
    this.world.createCollider(R.ColliderDesc.capsule(L / 2 * S, r * S).setTranslation(c.x * S, c.y * S, c.z * S).setRotation(q).setFriction(0.7));
  }
  staticCylinder(p, r, h) {   // p: centre of the base
    this.world.createCollider(R.ColliderDesc.cylinder(h / 2 * S, r * S).setTranslation(p.x * S, (p.y + h / 2) * S, p.z * S).setFriction(0.8));
  }
  staticBox(p, q, hx, hy, hz) {
    this.world.createCollider(R.ColliderDesc.cuboid(hx * S, hy * S, hz * S).setTranslation(p.x * S, p.y * S, p.z * S).setRotation(q).setFriction(0.7));
  }
  // a rigid body made of bars (one bar, or a welded / tied mesh): rods given in the
  // body's own frame as [ax,ay,az, bx,by,bz, d] (model), body at p / q
  rods(list, p, q, { kinematic = false, extend = 0 } = {}) {
    const d = (kinematic ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
      .setTranslation(p.x * S, p.y * S, p.z * S).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.1).setAngularDamping(0.5).setCcdEnabled(true);   // thin and fast: no tunnelling
    const body = this.world.createRigidBody(d);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), c = new THREE.Vector3(), qq = new THREE.Quaternion();
    for (const r of list) {
      A.set(r[0], r[1], r[2]); B.set(r[3], r[4], r[5]);
      const L = A.distanceTo(B);
      if (L < 1e-6) continue;
      qq.setFromUnitVectors(_Y, B.clone().sub(A).divideScalar(L)); c.addVectors(A, B).multiplyScalar(0.5);
      this.world.createCollider(R.ColliderDesc.capsule((L / 2 + extend * r[6]) * S, Math.max(r[6] / 2 * S, 0.008)).setTranslation(c.x * S, c.y * S, c.z * S).setRotation(qq)   // ≥ 8 mm: a thinner solid slips through
        .setDensity(DENSITY.steel).setFriction(0.7).setRestitution(0.05), body);
    }
    this.bodies.push(body);
    return body;
  }

  dynamic(body) { body.setBodyType(R.RigidBodyType.Dynamic, true); }
  kinematic(body) { body.setBodyType(R.RigidBodyType.KinematicPositionBased, true); }
  moveTo(body, p, q) {
    body.setNextKinematicTranslation({ x: p.x * S, y: p.y * S, z: p.z * S });
    body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
  // velocities in real m/s and rad/s
  push(body, vel, ang) {
    if (vel) body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    if (ang) body.setAngvel({ x: ang.x, y: ang.y, z: ang.z }, true);
  }

  // fixed steps (60 Hz, 120 for thin bars) for the time that passed (at most 0.1 s per frame)
  step(dt, before) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    const h = 1 / this.hz, max = Math.ceil(0.1 * this.hz);
    while (this.acc >= h && n < max) {
      before?.(this.time);
      this.world.step();
      // a piece knocked by a carried one (carried pieces push with no limit) only
      // gets a nudge: nothing on a building site flies off faster than this
      for (const b of this.bodies) {
        if (!b.isDynamic()) continue;
        const v = b.linvel(), w = b.angvel(), lv = Math.hypot(v.x, v.y, v.z), lw = Math.hypot(w.x, w.y, w.z);
        if (lv > this.maxV) { const k = this.maxV / lv; b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true); }
        if (lw > this.maxW) { const k = this.maxW / lw; b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true); }
      }
      this.acc -= h; this.time += h; n++;
    }
    return n;
  }

  pose(body, p, q) {
    const t = body.translation(), r = body.rotation();
    p.set(t.x / S, t.y / S, t.z / S); q.set(r.x, r.y, r.z, r.w);
  }

  still(list = this.bodies) {
    return list.every((b) => b.isSleeping() || (b.isDynamic() && Math.hypot(...Object.values(b.linvel())) < 0.05 && Math.hypot(...Object.values(b.angvel())) < 0.25));   // m/s, rad/s
  }

  dispose() { this.world.free(); this.world = null; }
}

