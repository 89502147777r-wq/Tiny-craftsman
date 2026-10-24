import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { Loader } from '../world/loader.js';
import { Grader } from './grade.js';
import { houseOutside } from './pitchedTool.js';

// The site machines, driven by the finger (no joysticks):
//   loader, grade – draw a line over the plot: the skid-steer loader drives to its start, lowers
//                   its bucket and goes along it; the bucket's edge is held at the design level —
//                   what stands over it is cut off into the bucket, the hollows are filled from it
//                   (grade.js); at the end what is left in the bucket is spread there. Another line
//                   while it works: it goes on along that one too.
// Each pass (down to the loader standing still) is one journal action; the loader's place is a
// record (`vehicle`), so undo puts it back where it was.
const R = (m) => m / MODEL_SCALE;
const SPEED = R(2.2), TURN = 1.4;                 // m/s, rad/s (a skid steer turns on the spot)
const BUCKET = 0.45;                               // m³ the bucket holds

export class MachineTool {
  constructor(app) {
    this.app = app;
    this.grader = new Grader(app);
    this.loader = null;
    this.state = 'idle';     // idle | work
    this.path = [];
    this.finger = false;
    app.objects.on((id, rec) => { if (rec?.type === 'vehicle' && rec.kind === 'loader' && this.loader?.loaded && this.state === 'idle') this.loader.place(app.terrain, rec.x, rec.z, rec.yaw); });
  }
  get machine() { return this.loader; }
  busy() { return this.state !== 'idle'; }
  get rec() { return this.app.objects.all('vehicle').find((r) => r.kind === 'loader') || null; }

  // the loader on the plot: where it was left, else parked at the near left corner
  ensure() {
    if (this.loader) return this.loader.ready;
    const app = this.app, t = app.terrain, L = (this.loader = new Loader());
    return L.ready.then(() => {
      app.scene.add(L.root);
      const r = this.rec, x0 = t.toWorldX(0) + R(2.5), z0 = t.toWorldZ(t.rz) - R(2.5);
      L.place(t, r?.x ?? x0, r?.z ?? z0, r?.yaw ?? 0);
      app.ui?.refresh();
    });
  }
  // the tool chosen / put away: the loader is shown while the machines are in use, and stays parked
  show(on) { if (on) this.ensure(); }

  down(p) {
    const app = this.app;
    if (!this.loader?.loaded) { this.ensure(); app.ui?.toast('Погрузчик заезжает на участок…'); return true; }
    if (!app.terrain.inside(p.x, p.z)) return false;
    if (this.state === 'idle') {
      app.journal.begin('grade', { machine: 'loader' }, app.clock);
      this.grader.design(app.settings.gradeSlope ?? 1.5);
      this.out = houseOutside(app);
      this.start = { x: this.loader.x, z: this.loader.z, yaw: this.loader.yaw };
      this.state = 'work'; this.cutting = false; this.moved = 0; this._said = false;
      this.path = [];
      app.sfx.scrapeStart(); app.sfx.scrapeLevel(0.3);
    }
    this.finger = true;
    this._add(p);
    return true;
  }
  _add(p) {
    const q = this.path.at(-1);
    if (q && Math.hypot(p.x - q.x, p.z - q.z) < R(0.25)) return;
    if (this.out && this.out(p.x, p.z) !== true) return;   // (not into a house)
    this.path.push({ x: p.x, z: p.z });
  }
  move(p) { if (this.state === 'work' && this.finger) this._add(p); }
  up() { this.finger = false; }
  interrupt() { this.finger = false; }

  // the bucket's arm set so its edge is at height y (bisection over the lift)
  _armFor(y) {
    const L = this.loader, e = new THREE.Vector3();
    let lo = -0.35, hi = 1.0;
    const keep = L.arm;
    for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; L.arm = m; L.update(0); L.edgeWorld(e); if (e.y > y) hi = m; else lo = m; }
    L.arm = keep; L.update(0);
    return (lo + hi) / 2;
  }

  update(dt) {
    if (!this.loader && this.rec) this.ensure();   // (a project with the loader on its plot)
    const L = this.loader;
    if (!L?.loaded) return;
    let moved = 0;
    if (this.state === 'work') {
      const app = this.app, t = app.terrain, g = this.grader, cap = R(1) ** 3 * BUCKET / t.cellArea;
      const tg = this.path[0];
      if (tg) {
        const dx = tg.x - L.x, dz = tg.z - L.z, d = Math.hypot(dx, dz);
        if (d < R(0.15)) { this.path.shift(); this.cutting = true; }
        else {
          let want = Math.atan2(-dz, dx), err = want - L.yaw;
          while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
          const turn = Math.sign(err) * Math.min(Math.abs(err), TURN * dt);
          let yaw = L.yaw + turn, step = 0;
          if (Math.abs(err) < 0.6) step = Math.min(d, SPEED * dt * (1 - Math.abs(err) / 0.6 * 0.7));
          const fx = Math.cos(yaw), fz = -Math.sin(yaw);
          // (a house in the way — under the bucket or the machine: that point is given up)
          const nx = L.x + fx * step, nz = L.z + fz * step, clear = (x, z) => !this.out || this.out(x, z) === true;
          const at = (a, b) => clear(nx + fx * R(a) - fz * R(b), nz + fz * R(a) + fx * R(b));   // (a: ahead, b: to the side)
          if (step > 0 && !(at(0, 0) && at(2.0, 0) && at(2.0, 0.95) && at(2.0, -0.95) && at(0, 1) && at(0, -1) && at(-1.5, 0.9) && at(-1.5, -0.9))) {
            this.path.shift(); if (!this._said) { this._said = true; app.ui?.toast('Дом на пути — погрузчик туда не едет, ведите в обход'); }
            step = 0;
          }
          L.place(t, L.x + fx * step, L.z + fz * step, yaw);
          moved = step;
          if (this.cutting && step > 0) {
            // (the edge along the way it moved: the cut and the fill under it, in short steps)
            const e = L.edgeWorld(new THREE.Vector3()), n = Math.max(1, Math.ceil(step / (t.cell * 0.7)));
            // (a full bucket goes on cutting: what does not go in is pushed on ahead of it, a windrow)
            for (let k = n - 1; k >= 0; k--) g.blade(e.x - fx * step * k / n, e.z - fz * step * k / n, fx, fz, L.bucketW / 2);
            this.moved += step;
          }
        }
      } else if (!this.finger) this.finish();
      // the bucket: down on the level while it cuts, carried up off the ground on the way there
      const e = L.edgeWorld(new THREE.Vector3());
      L.armGoal = this.cutting ? this._armFor(g.target(e.x, e.z)) : 0.25;
      L.tiltGoal = this.cutting ? 0 : 0.35;
      L.load = Math.min(1, g.load / cap);
      app.sfx.scrapeLevel(0.25 + 0.4 * L.load);
    }
    L.update(dt, moved);
  }

  // the pass is over: what is left in the bucket spread, the loader's place recorded, committed
  finish() {
    const app = this.app, L = this.loader, t = app.terrain;
    if (this.state !== 'work') return;
    this.state = 'idle'; this.path = []; this.finger = false;
    app.sfx.scrapeStop();
    const e = L.edgeWorld(new THREE.Vector3()), fx = Math.cos(L.yaw), fz = -Math.sin(L.yaw);
    this.grader.drop(e.x, e.z, fx, fz, L.bucketW / 2);
    for (let i = 0; i < 40000 && t.active; i++) t.relax(1);
    L.load = 0; L.armGoal = 0.25; L.tiltGoal = 0.35;
    const pose = { x: +L.x.toFixed(5), z: +L.z.toFixed(5), yaw: +L.yaw.toFixed(4) }, r = this.rec;
    if (r) app.objects.update(r.id, pose); else app.objects.add({ type: 'vehicle', kind: 'loader', ...pose });
    app.journal.commit(app.clock);
    app.ui?.toast(this.moved > R(0.5) ? 'Погрузчик выровнял полосу по проектной отметке — бугры срезаны, ямы засыпаны, уклон от дома' : 'Погрузчик на месте — ведите пальцем по участку, где ровнять');
    app.ui?.refresh();
  }
  // undo while it works: everything it did is taken back, it goes back where it stood
  abort() {
    if (this.state !== 'work') return false;
    const app = this.app, L = this.loader;
    this.state = 'idle'; this.path = []; this.finger = false;
    app.sfx.scrapeStop();
    this.grader.carry.fill(0); L.load = 0;
    app.journal.cancel();
    L.place(app.terrain, this.start.x, this.start.z, this.start.yaw);
    app.ui?.refresh();
    return true;
  }
  sync() {}
  // where the camera's focus goes while it works
  focus(out) { const L = this.loader; return L?.loaded ? out.set(L.x, L.y + R(1), L.z) : null; }
}
