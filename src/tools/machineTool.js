import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { Loader } from '../world/loader.js';
import { Truck, TRUCK_LOAD } from '../world/truck.js';
import { Grader } from './grade.js';
import { houseOutside } from './pitchedTool.js';

// The site machines, driven by the finger (no joysticks):
//   grade – draw a line over the plot: the skid-steer loader drives to its start, lowers its bucket
//           and goes along it; the bucket's edge is held at the design level — what stands over it
//           is cut off, the hollows are filled from what it carries (grade.js); a full bucket pushes
//           the rest on ahead; at the end what is left is a heap there.
//   haul  – touch a heap: the tipper comes in and stands at the edge of the plot nearest to it; the
//           loader drives into the heap, fills its bucket, takes it to the truck, lifts and tips it
//           into the body — again and again till the heap is down to the level; a full truck drives
//           off and comes back empty (what it took away is counted).
// Each grading pass and each bucket tipped into the truck is one journal action; the machines'
// places and the truck's load are records (`vehicle`), so undo puts them back.
const R = (m) => m / MODEL_SCALE;
const SPEED = R(2.2), TURN = 1.4;                 // m/s, rad/s (a skid steer turns on the spot)
const BUCKET = 0.45;                               // m³ the bucket holds

export class MachineTool {
  constructor(app) {
    this.app = app;
    this.grader = new Grader(app);
    this.loader = null; this.truck = null;
    this.state = 'idle';     // idle | work (grading) | haul
    this.path = [];
    this.finger = false;
    app.objects.on((id, rec) => {
      if (rec?.type !== 'vehicle' || this.state !== 'idle') return;
      if (rec.kind === 'loader' && this.loader?.loaded) this.loader.place(app.terrain, rec.x, rec.z, rec.yaw);
      if (rec.kind === 'truck' && this.truck?.loaded) { this.truck.place(app.terrain, rec.x, rec.z, rec.yaw); this.truck.load = rec.load || 0; this.truck.root.visible = !rec.away; }
    });
  }
  get machine() { return this.loader; }
  get mode() { return this.app.settings.machineMode === 'haul' ? 'haul' : 'grade'; }
  busy() { return this.state !== 'idle'; }
  recOf(kind) { return this.app.objects.all('vehicle').find((r) => r.kind === kind) || null; }
  get rec() { return this.recOf('loader'); }
  get cap() { return R(1) ** 3 * BUCKET / this.app.terrain.cellArea; }

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
  ensureTruck() {
    if (this.truck) return this.truck.ready;
    const app = this.app, T = (this.truck = new Truck());
    return T.ready.then(() => {
      app.scene.add(T.root);
      const r = this.recOf('truck');
      if (r) { T.place(app.terrain, r.x, r.z, r.yaw); T.load = r.load || 0; T.root.visible = !r.away; } else T.root.visible = false;
    });
  }
  show(on) { if (on) this.ensure(); }

  down(p) {
    const app = this.app;
    if (!this.loader?.loaded) { this.ensure(); app.ui?.toast('Погрузчик заезжает на участок…'); return true; }
    if (!app.terrain.inside(p.x, p.z)) return false;
    if (this.mode === 'haul') { this._haulAt(p); return true; }
    if (this.state === 'haul') return true;
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
  // one frame of driving towards (tx, tz): turns on the spot, then on; a house in the way stops it
  // → { step (model m), d (left to go), blocked }
  _drive(dt, tx, tz, slow = 1) {
    const app = this.app, t = app.terrain, L = this.loader;
    const dx = tx - L.x, dz = tz - L.z, d = Math.hypot(dx, dz);
    if (d < R(0.12)) return { step: 0, d, blocked: false };
    let err = Math.atan2(-dz, dx) - L.yaw;
    while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
    const yaw = L.yaw + Math.sign(err) * Math.min(Math.abs(err), TURN * dt);
    let step = Math.abs(err) < 0.6 ? Math.min(d, SPEED * slow * dt * (1 - Math.abs(err) / 0.6 * 0.7)) : 0;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), nx = L.x + fx * step, nz = L.z + fz * step;
    const clear = (x, z) => !this.out || this.out(x, z) === true, at = (a, b) => clear(nx + fx * R(a) - fz * R(b), nz + fz * R(a) + fx * R(b));
    let blocked = false;
    if (step > 0 && !(at(0, 0) && at(2.0, 0) && at(2.0, 0.95) && at(2.0, -0.95) && at(0, 1) && at(0, -1) && at(-1.5, 0.9) && at(-1.5, -0.9))) { blocked = true; step = 0; }
    L.place(t, L.x + fx * step, L.z + fz * step, yaw);
    return { step, d: d - step, blocked, fx, fz };
  }
  // turn on the spot to face (tx, tz) → true when it does
  _face(dt, tx, tz) {
    const L = this.loader;
    let err = Math.atan2(-(tz - L.z), tx - L.x) - L.yaw;
    while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
    L.place(this.app.terrain, L.x, L.z, L.yaw + Math.sign(err) * Math.min(Math.abs(err), TURN * dt));
    return Math.abs(err) < 0.03;
  }

  update(dt) {
    if (!this.loader && this.rec) this.ensure();   // (a project with the loader on its plot)
    if (!this.truck && this.recOf('truck')) this.ensureTruck();
    const L = this.loader;
    if (!L?.loaded) return;
    let moved = 0;
    if (this.state === 'work') moved = this._gradeStep(dt);
    else if (this.state === 'haul') moved = this._haulStep(dt);
    L.update(dt, moved);
    this.truck?.update(dt);
  }

  // ---- grading -------------------------------------------------------------------------------------
  _gradeStep(dt) {
    const app = this.app, t = app.terrain, g = this.grader, L = this.loader;
    let moved = 0;
    const tg = this.path[0];
    if (tg) {
      const r = this._drive(dt, tg.x, tg.z);
      if (r.blocked) { this.path.shift(); if (!this._said) { this._said = true; app.ui?.toast('Дом на пути — погрузчик туда не едет, ведите в обход'); } }
      else if (r.d < R(0.15)) { this.path.shift(); this.cutting = true; }
      moved = r.step;
      if (this.cutting && r.step > 0) {
        // (the edge along the way it moved: the cut and the fill under it, in short steps; a full
        // bucket goes on cutting — what does not go in is pushed on ahead of it, a windrow)
        const e = L.edgeWorld(new THREE.Vector3()), n = Math.max(1, Math.ceil(r.step / (t.cell * 0.7)));
        for (let k = n - 1; k >= 0; k--) g.blade(e.x - r.fx * r.step * k / n, e.z - r.fz * r.step * k / n, r.fx, r.fz, L.bucketW / 2);
        this.moved += r.step;
      }
    } else if (!this.finger) { this.finish(); return 0; }
    const e = L.edgeWorld(new THREE.Vector3());
    L.armGoal = this.cutting ? this._armFor(g.target(e.x, e.z)) : 0.25;
    L.tiltGoal = this.cutting ? 0 : 0.35;
    L.load = Math.min(1, g.load / this.cap);
    app.sfx.scrapeLevel(0.25 + 0.4 * L.load);
    return moved;
  }

  // the pass is over: what is left in the bucket a heap there, the loader's place recorded, committed
  finish() {
    const app = this.app, L = this.loader, t = app.terrain;
    if (this.state === 'haul') { this._haulEnd(); return; }
    if (this.state !== 'work') return;
    this.state = 'idle'; this.path = []; this.finger = false;
    app.sfx.scrapeStop();
    const e = L.edgeWorld(new THREE.Vector3()), fx = Math.cos(L.yaw), fz = -Math.sin(L.yaw);
    this.grader.drop(e.x, e.z, fx, fz, L.bucketW / 2);
    for (let i = 0; i < 40000 && t.active; i++) t.relax(1);
    L.load = 0; L.armGoal = 0.25; L.tiltGoal = 0.35;
    this._savePose();
    app.journal.commit(app.clock);
    app.ui?.toast(this.moved > R(0.5) ? 'Погрузчик выровнял полосу по проектной отметке — бугры срезаны, ямы засыпаны, уклон от дома' : 'Погрузчик на месте — ведите пальцем по участку, где ровнять');
    app.ui?.refresh();
  }
  _savePose() {
    const app = this.app, L = this.loader, pose = { x: +L.x.toFixed(5), z: +L.z.toFixed(5), yaw: +L.yaw.toFixed(4) }, r = this.rec;
    if (r) app.objects.update(r.id, pose); else app.objects.add({ type: 'vehicle', kind: 'loader', ...pose });
  }
  _saveTruck(patch) {
    const app = this.app, T = this.truck, r = this.recOf('truck');
    const rec = { x: +T.x.toFixed(5), z: +T.z.toFixed(5), yaw: +T.yaw.toFixed(4), load: +T.load.toFixed(4), ...patch };
    if (r) app.objects.update(r.id, rec); else app.objects.add({ type: 'vehicle', kind: 'truck', hauled: 0, ...rec });
  }

  // ---- loading the truck -----------------------------------------------------------------------
  // what stands over the level round a point, real m³
  _over(x, z, r) {
    const t = this.app.terrain, g = this.grader, n = Math.ceil(r / t.cell), cx = t.toCellX(x), cz = t.toCellZ(z);
    let v = 0;
    for (let iz = Math.max(0, Math.floor(cz - n)); iz <= Math.min(t.rz, Math.ceil(cz + n)); iz += 2) for (let ix = Math.max(0, Math.floor(cx - n)); ix <= Math.min(t.rx, Math.ceil(cx + n)); ix += 2) {
      if (Math.hypot(ix - cx, iz - cz) > n) continue;
      const i = iz * t.nx + ix, px = t.toWorldX(ix), pz = t.toWorldZ(iz);
      if (!g.free(i, px, pz)) continue;
      const o = t.nat[i] + t.loose[i] - g.target(px, pz); if (o > 0) v += o * 4;
    }
    return v * t.cellArea * MODEL_SCALE ** 3;
  }
  // where the truck stands for a heap: along the edge of the plot nearest to it, clear of houses
  _parkFor(p) {
    const t = this.app.terrain, hx = t.toWorldX(t.rx), hz = t.toWorldZ(t.rz), m = R(1.5), e = R(3);
    const clear = (x, z) => !this.out || this.out(x, z) === true;
    const cands = [
      { x: Math.max(-hx + e, Math.min(hx - e, p.x)), z: -hz + m, yaw: 0, n: [0, 1] },
      { x: Math.max(-hx + e, Math.min(hx - e, p.x)), z: hz - m, yaw: Math.PI, n: [0, -1] },
      { x: -hx + m, z: Math.max(-hz + e, Math.min(hz - e, p.z)), yaw: -Math.PI / 2, n: [1, 0] },
      { x: hx - m, z: Math.max(-hz + e, Math.min(hz - e, p.z)), yaw: Math.PI / 2, n: [-1, 0] },
    ].filter((c) => clear(c.x, c.z) && clear(c.x + Math.cos(c.yaw) * R(2.4), c.z - Math.sin(c.yaw) * R(2.4)) && clear(c.x - Math.cos(c.yaw) * R(2.4), c.z + Math.sin(c.yaw) * R(2.4)));
    cands.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    return cands[0] || null;
  }
  _haulAt(p) {
    const app = this.app;
    if (this.state === 'work') return;
    this.grader.design(app.settings.gradeSlope ?? 1.5);
    this.out = houseOutside(app);
    if (this._over(p.x, p.z, R(1.4)) < 0.05) { app.ui?.toast('Здесь нечего вывозить: земля не выше проектной отметки — коснитесь кучи'); return; }
    this.heap = { x: p.x, z: p.z };
    if (this.state === 'haul') { app.ui?.toast('Следующая куча — погрузчик возьмётся за неё'); return; }
    this.state = 'haul'; this.phase = 'truck'; this.wait = 0;
    app.ui?.refresh();
    this.ensureTruck().then(() => {
      const T = this.truck, r = this.recOf('truck');
      if (r && !r.away && T.root.visible && this.state === 'haul') { this.park = { x: T.x, z: T.z, yaw: T.yaw }; this._sideOf(); this.phase = 'toHeap'; return; }
      const pk = this._parkFor(p);
      if (!pk) { app.ui?.toast('Самосвалу негде встать у края участка'); this.state = 'idle'; return; }
      this.park = pk; this._arrive();
    });
  }
  // the side of the truck the loader comes to: towards the middle of the plot
  _sideOf() {
    const T = this.truck, c = Math.cos(T.yaw), s = Math.sin(T.yaw), a = [s, c], b = [-s, -c];   // (the two sides: the truck's local ±z)
    this.side = Math.hypot(T.x + a[0], T.z + a[1]) < Math.hypot(T.x + b[0], T.z + b[1]) ? a : b;
  }
  _arrive() {
    const T = this.truck, pk = this.park;
    T.load = 0; T.root.visible = true;
    const fx = Math.cos(pk.yaw), fz = -Math.sin(pk.yaw);
    this.drive = { from: [pk.x - fx * R(14), pk.z - fz * R(14)], to: [pk.x, pk.z], yaw: pk.yaw, t: 0, dur: 4 };
    this.phase = 'arrive';
    this.app.ui?.toast('Самосвал заезжает на участок');
  }
  _haulStep(dt) {
    const app = this.app, t = app.terrain, g = this.grader, L = this.loader, T = this.truck;
    const ph = this.phase;
    let moved = 0;
    const bucket = (arm, tilt) => { L.armGoal = arm; L.tiltGoal = tilt; };
    if (ph === 'truck') { bucket(0.25, 0.35); return 0; }
    if (ph === 'arrive' || ph === 'leave') {
      const D = this.drive; D.t = Math.min(D.dur, D.t + dt); const k = D.t / D.dur, e = k * k * (3 - 2 * k);
      T.place(t, D.from[0] + (D.to[0] - D.from[0]) * e, D.from[1] + (D.to[1] - D.from[1]) * e, D.yaw);
      if (D.t >= D.dur) {
        if (ph === 'arrive') { this._sideOf(); if (!app.journal.pending) app.journal.act('truck-in', {}, app.clock, () => this._saveTruck({ away: false })); this.phase = this.heap ? 'toHeap' : 'idle'; }
        else {
          // (off the plot it tips its body out, goes, and comes back empty a little later)
          const r = this.recOf('truck'), got = T.load * TRUCK_LOAD, total = (r?.hauled || 0) + got;
          app.journal.act('truck-out', {}, app.clock, () => this._saveTruck({ load: 0, hauled: +total.toFixed(3), away: true }));
          this.got = T.load;
          app.ui?.toast(`Самосвал вывез ${got.toFixed(1).replace('.', ',')} м³ — всего вывезено ${total.toFixed(1).replace('.', ',')} м³`);
          this.wait = 6; this.phase = 'away';
        }
      }
      bucket(0.25, 0.35);
      return 0;
    }
    if (ph === 'away') {
      this.wait -= dt;
      if (this.wait > 3.5) { T.tipGoal = 0.75; if (T.tip > 0.3) T.load = Math.max(0, T.load - dt * 0.7); }
      else { T.tipGoal = 0; T.load = 0; if (this.wait < 2.5) T.root.visible = false; }
      if (this.wait <= 0) { T.tip = 0; this._arrive(); }
      bucket(0.25, 0.35); return 0;
    }
    if (ph === 'idle' || !this.heap) { this._haulEnd(); return 0; }
    const H = this.heap;
    if (ph === 'toHeap') {
      // (it comes at the heap from the side away from nothing in particular: straight from where it is)
      const dx = H.x - L.x, dz = H.z - L.z, d = Math.hypot(dx, dz) || 1;
      this.into = [dx / d, dz / d];
      const ax = H.x - this.into[0] * R(2.6), az = H.z - this.into[1] * R(2.6);
      const r = this._drive(dt, ax, az); moved = r.step;
      if (r.blocked) { app.ui?.toast('К этой куче погрузчику не подъехать — дом на пути'); this._haulEnd(); return 0; }
      if (r.d < R(0.2)) { this.phase = 'push'; app.journal.begin('haul', { machine: 'loader' }, app.clock); app.sfx.scrapeStart(); }
      bucket(0.25, 0.35);
    } else if (ph === 'push') {
      // the bucket on the level, into the heap till it is full
      const e = L.edgeWorld(new THREE.Vector3());
      bucket(this._armFor(g.target(e.x, e.z)), 0);
      const r = this._drive(dt, H.x + this.into[0] * R(0.8), H.z + this.into[1] * R(0.8), 0.5); moved = r.step;
      if (r.step > 0) { const n = Math.max(1, Math.ceil(r.step / (t.cell * 0.7))); for (let k = n - 1; k >= 0; k--) g.blade(e.x - r.fx * r.step * k / n, e.z - r.fz * r.step * k / n, r.fx, r.fz, L.bucketW / 2, this.cap); }
      L.load = Math.min(1, g.load / this.cap);
      app.sfx.scrapeLevel(0.3 + 0.4 * L.load);
      if (g.load >= this.cap * 0.97 || r.d < R(0.2) || r.blocked) { this.phase = 'curl'; this.wait = 0.7; app.sfx.scrapeStop(); }
    } else if (ph === 'curl') {
      bucket(0.3, 0.55); this.wait -= dt;
      if (this.wait <= 0) this.phase = T?.root.visible && this.truck.loaded ? 'toTruck' : 'hold';
    } else if (ph === 'hold') {
      // (the truck is away: the loader waits with its bucket full)
      bucket(0.3, 0.55); if (T?.root.visible && this.phase !== 'arrive' && this.drive?.t >= this.drive?.dur) this.phase = 'toTruck';
    } else if (ph === 'toTruck') {
      const c = T.bedCentre(new THREE.Vector3()), off = T.width / 2 + R(2.1), ax = c.x + this.side[0] * off, az = c.z + this.side[1] * off;
      const r = this._drive(dt, ax, az); moved = r.step;
      if (r.d < R(0.2) || r.blocked) this.phase = 'faceTruck';
      bucket(0.3, 0.55);
    } else if (ph === 'faceTruck') {
      const c = T.bedCentre(new THREE.Vector3());
      if (this._face(dt, c.x, c.z)) { this.phase = 'lift'; this.wait = 1.4; }
      bucket(0.3, 0.55);
    } else if (ph === 'lift') {
      bucket(0.95, 0.5); this.wait -= dt;
      if (this.wait <= 0) { this.phase = 'dump'; this.wait = 1.0; }
    } else if (ph === 'dump') {
      bucket(0.95, -0.9); this.wait -= dt;
      L.load = Math.max(0, L.load - dt * 1.4);
      if (this.wait <= 0) {
        // the bucketful is in the body: one action — the heap lower, the truck fuller
        const v = g.realVolume(); g.carry.fill(0); L.load = 0;
        T.load = Math.min(1, T.load + v / TRUCK_LOAD);
        this._savePose(); this._saveTruck({ away: false });
        app.journal.commit(app.clock);
        this.phase = 'lower'; this.wait = 1.0;
      }
    } else if (ph === 'lower') {
      bucket(0.25, 0.35); this.wait -= dt;
      if (this.wait <= 0) {
        if (T.load >= 0.9) {
          const fx = Math.cos(T.yaw), fz = -Math.sin(T.yaw);
          this.drive = { from: [T.x, T.z], to: [T.x + fx * R(14), T.z + fz * R(14)], yaw: T.yaw, t: 0, dur: 4 };
          this.phase = 'leave';
          app.ui?.toast('Самосвал полный — уезжает, вернётся пустым');
        }
        if (this._over(H.x, H.z, R(1.4)) < 0.03) { app.ui?.toast('Куча вывезена до проектной отметки'); this.heap = null; if (this.phase !== 'leave') this._haulEnd(); }
        else if (this.phase !== 'leave') this.phase = 'toHeap';
      }
    }
    return moved;
  }
  _haulEnd() {
    const app = this.app;
    if (app.journal.pending?.type === 'haul') app.journal.cancel();
    this.grader.carry.fill(0); if (this.loader) { this.loader.load = 0; this.loader.armGoal = 0.25; this.loader.tiltGoal = 0.35; }
    if (this.phase === 'leave' || this.phase === 'away' || this.phase === 'arrive') { this.heap = null; return; }   // (the truck finishes its trip)
    this.state = 'idle'; this.phase = null; this.heap = null;
    app.sfx.scrapeStop();
    app.ui?.refresh();
  }

  // undo while it works: what it did since the last commit is taken back
  abort() {
    const app = this.app, L = this.loader;
    if (this.state === 'work') {
      this.state = 'idle'; this.path = []; this.finger = false;
      app.sfx.scrapeStop();
      this.grader.carry.fill(0); L.load = 0;
      app.journal.cancel();
      L.place(app.terrain, this.start.x, this.start.z, this.start.yaw);
      app.ui?.refresh();
      return true;
    }
    if (this.state === 'haul') {
      if (app.journal.pending?.type === 'haul') app.journal.cancel();
      this.grader.carry.fill(0); L.load = 0; this.heap = null;
      const T = this.truck, r = this.recOf('truck');
      if (T && r) { T.place(app.terrain, r.x, r.z, r.yaw); T.load = r.load || 0; T.root.visible = !r.away; }
      this.state = 'idle'; this.phase = null;
      app.sfx.scrapeStop();
      app.ui?.refresh();
      return true;
    }
    return false;
  }
  sync() {}
  // where the camera's focus goes while it works
  focus(out) { const L = this.loader; return L?.loaded ? out.set(L.x, L.y + R(1), L.z) : null; }
}
