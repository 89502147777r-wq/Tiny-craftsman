import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// Fitting a piece as it is done on site, played out before it is put in the records: the
// piece (a stand-in drawn like the real one) comes to its place, the hand tools do their
// work (drilling, dowels, screws, taps, glue …), then the record goes in as one journal
// entry and the stand-in is gone — the real one is drawn just there. A job in a row / over
// an area is the same quicker (fewer, shorter steps). It runs as app.physJob: the next
// action finishes it at once, undo drops it (nothing was recorded yet).
const M = (v) => v / 1000 / MODEL_SCALE;
export const ease = (u) => u * u * (3 - 2 * u);

export class FitJob {
  // steps: [[seconds, (u 0…1, job) => {}], …]; commit: () => {} (puts the records in);
  // parts: objects shown while it runs (added to the scene, removed at the end)
  constructor(app, { steps, commit, parts = [], cleanup = null, onAbort = null }) {
    this.app = app; this.steps = steps; this.commitFn = commit; this.parts = parts; this.cleanup = cleanup; this.onAbort = onAbort;
    this.k = 0; this.t = 0; this.done = false; this.fit = true;
    if (app.physJob && app.physJob !== this) app.physJob.fit ? app.physJob.finish() : app.physJob.finish?.();
    for (const p of parts) app.scene.add(p);
    app.physJob = this;
    this.update(0);
  }
  get busy() { return !this.done; }
  update(dt) {
    if (this.done) return;
    this.t += dt;
    while (this.k < this.steps.length) {
      const [dur, f] = this.steps[this.k], u = dur > 0 ? Math.min(1, this.t / dur) : 1;
      f(u, this);
      if (u < 1) return;
      this.t -= dur; this.k++;
    }
    this._end();
  }
  _clear() {
    this.done = true;
    for (const p of this.parts) { this.app.scene.remove(p); p.traverse?.((o) => { if (o.isMesh && !o.userData.keepGeo) o.geometry?.dispose(); }); }
    this.app.handTools?.hide();
    for (const id of ['fit-drill', 'fit-driver']) this.app.sfx?.engine?.(id, 0);
    if (this.app.physJob === this) this.app.physJob = null;
    this.cleanup?.();
  }
  _end() { this._clear(); this.commitFn?.(); this.app.ui?.refresh(); }
  finish() {
    if (this.done) return;
    // (the rest at once: each step to its end state)
    for (; this.k < this.steps.length; this.k++) this.steps[this.k][1](1, this);
    this._end();
  }
  abort() { if (this.done) return false; this._clear(); this.onAbort?.(); this.app.ui?.refresh(); return true; }
}

// ---- the steps ------------------------------------------------------------------------------
// the stand-in from `off` (a world offset) to its place
export const bring = (obj, off, dur = 0.5) => [dur, (u) => { obj.position.copy(off).multiplyScalar(1 - ease(u)); obj.visible = true; }];
export const wait = (dur) => [dur, () => {}];
export const call = (f) => [0, (u) => { if (u >= 1) f(); }];
// drill a hole at p (world) into the surface with the normal n: the bit comes in, turns, a
// puff of dust; depth mm
export function drill(app, p, n, dur = 0.45, depth = 60, up = null, tool = 'drill') {
  let puff = 0;
  return [dur, (u) => {
    const H = app.handTools, k = u < 0.15 ? 0 : u > 0.85 ? 1 - (u - 0.85) / 0.15 : (u - 0.15) / 0.7;
    const at = p.clone().addScaledVector(n, M(25) * (1 - Math.min(1, u / 0.15)) - M(depth) * Math.max(0, k));
    H.set(tool, at, n, up, u * 90);
    app.sfx?.engine?.(tool === 'drill' ? 'fit-drill' : 'fit-driver', u < 0.95 ? (tool === 'drill' ? 0.18 : 0.12) : 0, tool === 'drill' ? 11 : 6);
    if (tool === 'drill' && u > 0.2 && u < 0.85 && (puff += 1) % 3 === 0) {
      const r = Math.random;
      app.particles?.emit(p.clone().addScaledVector(n, M(10)), n.clone().multiplyScalar(0.05 + r() * 0.05).add(new THREE.Vector3((r() - 0.5) * 0.04, -0.02, (r() - 0.5) * 0.04)), 0, M(4 + r() * 4), 0, 0, 9);
    }
  }];
}
// drive a screw / an anchor: the screwdriver at p turning, the head (obj) going in to flush
export function drive(app, p, n, obj = null, dur = 0.35, up = null) {
  return [dur, (u) => {
    app.handTools.set('driver', p.clone().addScaledVector(n, M(12) * (1 - u)), n, up, u * 60);
    app.sfx?.engine?.('fit-driver', u < 0.95 ? 0.12 : 0, 6);
    if (obj) { obj.visible = true; obj.position.set(0, 0, M(12) * (1 - u)); obj.rotation.z = u * 20; }
  }];
}
// taps of the hammer on p (each `per` s): lifted slowly, brought down fast; onTap(k) at each
export function hammer(app, p, n, taps = 2, per = 0.2, onTap = null, up = null, tool = 'hammer') {
  let done = 0;
  return [taps * per, (u) => {
    const t = u * taps, f = t - Math.floor(t), sw = f < 0.7 ? Math.sin(f / 0.7 * Math.PI / 2) : Math.cos((f - 0.7) / 0.3 * Math.PI / 2);
    app.handTools.set(tool, p, n, up, u >= 1 ? 0 : sw * 0.6);
    const k = Math.min(taps, Math.floor(t + 0.3));
    while (done < k) { done++; app.sfx?.stab?.(); onTap?.(done); }
  }];
}

// ---- small parts -----------------------------------------------------------------------------
const _mats = {};
const pm = (k, c, r = 0.55, m = 0) => _mats[k] || (_mats[k] = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));
// a part standing out of a surface along local +z (its back at 0): placed with at()
export function part(kind) {
  const g = new THREE.Group(), add = (geo, m, z) => { const o = new THREE.Mesh(geo, m); o.rotation.x = Math.PI / 2; o.position.z = z; o.castShadow = true; g.add(o); return o; };
  if (kind === 'dowel') {   // a facade dowel (грибок): a head Ø 60, its sleeve going in
    add(new THREE.CylinderGeometry(M(30), M(32), M(4), 16), pm('dw', 0xd8d8d2), M(2));
    add(new THREE.CylinderGeometry(M(5), M(5), M(120), 8), pm('dw', 0xd8d8d2), M(-60));
  } else if (kind === 'plate') {   // a plate dowel for the wool: Ø 90
    add(new THREE.CylinderGeometry(M(45), M(45), M(3), 18), pm('pd', 0xd9d9d4), M(1.5));
    add(new THREE.CylinderGeometry(M(5), M(5), M(140), 8), pm('pd', 0xd9d9d4), M(-70));
  } else if (kind === 'screw') {   // a self-tapping screw: a hex head with a washer
    add(new THREE.CylinderGeometry(M(7), M(7), M(2), 12), pm('sw', 0x2a2b2d, 0.5, 0.3), M(1));
    add(new THREE.CylinderGeometry(M(4.5), M(4.5), M(6), 6), pm('sc', 0xb7bcc0, 0.35, 0.8), M(5));
  } else if (kind === 'nail') {   // a nail's head
    add(new THREE.CylinderGeometry(M(4), M(4), M(1.5), 10), pm('nl', 0x8d9196, 0.4, 0.8), M(0.75));
    add(new THREE.CylinderGeometry(M(1.6), M(1.6), M(90), 6), pm('nl', 0x8d9196, 0.4, 0.8), M(-45));
  } else if (kind === 'anchor') {   // an anchor bolt's head
    add(new THREE.CylinderGeometry(M(9), M(9), M(6), 6), pm('an', 0x9ea3a8, 0.35, 0.85), M(3));
  } else if (kind === 'blob') {   // a dab of glue (scaled to size)
    const o = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), pm('gl', 0xb9b6ac, 0.9)); o.scale.set(M(50), M(50), M(10)); o.position.z = M(5); g.add(o);
  }
  return g;
}
// a part (made with part()) set at p on a surface with the normal n
export function at(obj, p, n) {
  const inner = new THREE.Group();
  inner.add(obj);
  const holder = new THREE.Group();
  holder.add(inner);
  holder.position.copy(p);
  holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
  obj.visible = false;
  holder.userData.obj = obj;
  return holder;
}
export { M };
