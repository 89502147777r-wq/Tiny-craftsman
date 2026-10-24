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
const BUCKET_COL = [0x6f5137, 0xc9a46a, 0xa3a29e, 0x86847f].map((c) => new THREE.Color(c));   // soil, sand, gravels

export class MachineTool {
  constructor(app) {
    this.app = app;
    this.grader = new Grader(app);
    this.loader = null; this.truck = null;
    this.state = 'idle';     // idle | work (grading) | haul
    this.path = [];
    this.finger = false;
    app.objects.on((id, rec) => {
      if (rec?.type !== 'vehicle' || this.state === 'work' || this.state === 'haul') return;
      if (rec.kind === 'loader' && this.loader?.loaded) this.loader.place(app.terrain, rec.x, rec.z, rec.yaw);
      if (rec.kind === 'truck' && this.truck?.loaded) { this.truck.place(app.terrain, rec.x, rec.z, rec.yaw); this.truck.load = rec.load || 0; this.truck.root.visible = !rec.away; }
    });
  }
  get machine() { return this.loader; }
  get mode() { return this.app.settings.machineMode === 'haul' ? 'haul' : 'grade'; }
  busy() { return this.state !== 'idle' && this.state !== 'drive'; }
  get driving() { return this.state === 'drive'; }
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
    if (this.state === 'drive') return false;   // (the finger turns the camera round the machine)
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
  _armFor(y, low = false) {   // (low: the bucket's lowest point, not its edge)
    const L = this.loader, e = new THREE.Vector3();
    let lo = -0.35, hi = 1.0;
    const keep = L.arm;
    for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; L.arm = m; L.update(0); if (low) L.lowWorld(e); else L.edgeWorld(e); if (e.y > y) hi = m; else lo = m; }
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
    if (this.state === 'drive') { this._driveStep(dt); this.truck?.update(dt); return; }
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
    if (this.state === 'drive') { this.exit(); return; }
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
    const app = this.app, L = this.loader, pose = { x: +L.x.toFixed(5), z: +L.z.toFixed(5), yaw: +Math.atan2(Math.sin(L.yaw), Math.cos(L.yaw)).toFixed(4) }, r = this.rec;
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
  // the top of what stands over the level round a point (the next bucketful is taken there)
  _peak(x, z, r) {
    const t = this.app.terrain, g = this.grader, n = Math.ceil(r / t.cell), cx = t.toCellX(x), cz = t.toCellZ(z);
    let best = 0, bx = x, bz = z;
    for (let iz = Math.max(0, Math.floor(cz - n)); iz <= Math.min(t.rz, Math.ceil(cz + n)); iz += 2) for (let ix = Math.max(0, Math.floor(cx - n)); ix <= Math.min(t.rx, Math.ceil(cx + n)); ix += 2) {
      if (Math.hypot(ix - cx, iz - cz) > n) continue;
      const i = iz * t.nx + ix, px = t.toWorldX(ix), pz = t.toWorldZ(iz);
      if (!g.free(i, px, pz)) continue;
      const o = t.nat[i] + t.loose[i] - g.target(px, pz); if (o > best) best = o, bx = px, bz = pz;
    }
    return { x: bx, z: bz };
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
    this.heap = { x: p.x, z: p.z }; this.empty = 0;
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
      if (!this.aim) this.aim = this._peak(H.x, H.z, R(1.6));
      const A = this.aim, dx = A.x - L.x, dz = A.z - L.z, d = Math.hypot(dx, dz) || 1;
      this.into = [dx / d, dz / d];
      const ax = A.x - this.into[0] * R(2.6), az = A.z - this.into[1] * R(2.6);
      const r = this._drive(dt, ax, az); moved = r.step;
      if (r.blocked) { app.ui?.toast('К этой куче погрузчику не подъехать — дом на пути'); this._haulEnd(); return 0; }
      if (r.d < R(0.2)) { this.phase = 'push'; app.journal.begin('haul', { machine: 'loader' }, app.clock); app.sfx.scrapeStart(); }
      bucket(0.25, 0.35);
    } else if (ph === 'push') {
      // the bucket on the level, into the heap till it is full
      const e = L.edgeWorld(new THREE.Vector3());
      bucket(this._armFor(g.target(e.x, e.z)), 0);
      const r = this._drive(dt, this.aim.x + this.into[0] * R(0.8), this.aim.z + this.into[1] * R(0.8), 0.5); moved = r.step;
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
      const c = T.bedCentre(new THREE.Vector3()), off = T.width / 2 + R(1.4), ax = c.x + this.side[0] * off, az = c.z + this.side[1] * off;
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
      if (L.load > 0 && L.tilt < -0.3) {
        // (the stream into the body: only to be seen — the volume goes in as the bucket is emptied)
        const e = L.edgeWorld(new THREE.Vector3()), fx = Math.cos(L.yaw), fz = -Math.sin(L.yaw), r = Math.random, hw = L.bucketW / 2;
        for (let j = 0; j < 8; j++) { const w = (r() * 2 - 1) * hw * 0.9; app.particles.emit(new THREE.Vector3(e.x + fz * w, e.y, e.z - fx * w), new THREE.Vector3(fx * R(0.4) * r(), -R(0.3) * r(), fz * R(0.4) * r()), 0, R(0.03 + r() * 0.05), 0, 0, 0); }
      }
      if (this.wait <= 0) {
        // the bucketful is in the body: one action — the heap lower, the truck fuller
        const v = g.realVolume(); g.carry.fill(0); L.load = 0; this.aim = null; this.empty = v < 0.03 ? this.empty + 1 : 0;
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
        if (this._over(H.x, H.z, R(1.4)) < 0.03 || this.empty >= 3) { app.ui?.toast('Куча вывезена до проектной отметки'); this.heap = null; if (this.phase !== 'leave') this._haulEnd(); }
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

  // ---- driving by hand ------------------------------------------------------------------------------
  // the left stick drives, the right one works the bucket (the loader) or the body (the truck); the
  // camera rides behind. What it does is one action from the sticks touched till they are let go.
  enter(kind) {
    const app = this.app;
    if (this.state !== 'idle') return;
    Promise.all([this.ensure(), kind === 'truck' ? this.ensureTruck() : null]).then(() => {
      if (this.state !== 'idle') return;
      this.out = houseOutside(app);
      this.grader.design(app.settings.gradeSlope ?? 1.5);
      if (kind === 'truck') {
        const T = this.truck, r = this.recOf('truck');
        if (!r || r.away || !T.root.visible) {
          const L = this.loader, pk = this._parkFor({ x: L.x, z: L.z });
          if (!pk) { app.ui?.toast('Самосвалу негде встать у края участка'); return; }
          T.tip = T.tipGoal = 0; T.load = r?.away ? 0 : T.load; T.place(app.terrain, pk.x, pk.z, pk.yaw); T.root.visible = true;
          app.journal.act('truck-in', {}, app.clock, () => this._saveTruck({ away: false }));
        }
      }
      this.state = 'drive'; this.drv = kind; this.stick = { l: [0, 0], r: [0, 0] };
      this.v = 0; this.camOff = 0; this._camYaw = null; this.idleT = 0; this.view ??= 'cab';   // (from the cab's front: the bucket and the arms below, the way ahead)
      if (kind === 'loader') { this.loader.armGoal = 0; this.loader.tiltGoal = 0; }
      app.rig.goal.dist = R(kind === 'truck' ? 14 : 10); app.rig.goal.pitch = 0.5;
      app.sfx.scrapeStart(); app.sfx.scrapeLevel(0.15);
      app.ui?.toast(kind === 'truck' ? 'Вы в самосвале: левый джойстик — газ и руль, правый вверх/вниз — кузов' : 'Вы в погрузчике: левый джойстик — езда, правый: вверх/вниз — стрела, влево/вправо — ковш');
      app.ui?.refresh();
    });
  }
  exit() {
    const app = this.app;
    if (this.state !== 'drive') return;
    this._commitDrive();
    this.state = 'idle'; this.stick = { l: [0, 0], r: [0, 0] };
    app.sfx.scrapeStop();
    if (app.rig.shakeKeep != null) { app.rig.shake = app.rig.shakeKeep; app.rig.shakeKeep = null; }
    this._fov(null); this._mirrors(null);
    app.rig.goal.dist = R(16); app.rig.goal.pitch = 0.6;
    app.ui?.refresh();
  }
  // the rear-view mirrors, in the cab: the truck's two by its doors, the loader's one over the
  // windscreen (looking back over the cab) — M the machine, f its forward; null: none
  _mirrors(M, f) {
    const mr = this.app.mirrors;
    if (!mr) return;
    const kind = M && this.view === 'cab' ? this.drv : null;
    if (this._mrKind !== kind) {
      this._mrKind = kind;
      mr.set(kind === 'truck' ? [{ rect: [0.02, 0.4, 0.15, 0.17] }, { rect: [0.83, 0.4, 0.15, 0.17] }] : kind === 'loader' ? [{ rect: [0.37, 0.025, 0.26, 0.11] }] : null);
    }
    if (!kind) return;
    M.root.updateMatrixWorld(true);
    const side = new THREE.Vector3(Math.sin(M.yaw), 0, Math.cos(M.yaw)), back = f.clone().negate();
    if (kind === 'truck') {
      const hw = this.truck.width / 2 + R(0.2);
      // (the left one shows the left side behind, the right one the right — each turned out a little)
      for (const [k, s] of [[0, -1], [1, 1]]) {
        const pos = new THREE.Vector3(M.x, M.y + R(1.75), M.z).addScaledVector(f, R(1.9)).addScaledVector(side, s * hw);
        mr.aim(k, pos, back.clone().addScaledVector(side, s * 0.12).add(new THREE.Vector3(0, -0.06, 0)));
      }
    } else {
      const pos = new THREE.Vector3(M.x, M.y + R(2.3), M.z).addScaledVector(f, -R(1.3));
      mr.aim(0, pos, back.clone().add(new THREE.Vector3(0, -0.18, 0)));
    }
  }
  _fov(f) {
    const c = this.app.camera;
    if (f == null) { if (this.fov0 == null) return; f = this.fov0; this.fov0 = null; } else this.fov0 ??= c.fov;
    if (c.fov !== f) { c.fov = f; c.updateProjectionMatrix(); }
  }
  setView(v) {
    const app = this.app;
    this.view = v; this._camYaw = null; this.camOff = 0;
    if (v !== 'cab') { app.rig.goal.dist = R(this.drv === 'truck' ? 14 : 10); app.rig.goal.pitch = 0.5; }
    app.ui?.refresh();
  }
  joystick(side, x, y) { if (this.state === 'drive') this.stick[side] = [x, y]; }
  _commitDrive() {
    const app = this.app;
    if (app.journal.pending?.type !== 'drive') return;
    this._savePose(); if (this.truck?.root.visible && this.recOf('truck')) this._saveTruck({});
    app.journal.commit(app.clock);
  }
  // the machine's outline there clear of houses, of the other machine and of the plot's edge
  _fits(kind, x, z, yaw) {
    const t = this.app.terrain, fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const pts = kind === 'truck' ? [[2.3, 0.85], [2.3, -0.85], [0, 0.85], [0, -0.85], [-2.3, 0.85], [-2.3, -0.85]] : [[2.0, 0.95], [2.0, -0.95], [2.0, 0], [0, 1], [0, -1], [-1.5, 0.9], [-1.5, -0.9]];
    const other = kind === 'truck' ? this.loader : this.truck?.root.visible ? this.truck : null, oh = kind === 'truck' ? [1.6, 1.0] : [2.4, 1.0];
    for (const [a, b] of pts) {
      const px = x + fx * R(a) - fz * R(b), pz = z + fz * R(a) + fx * R(b);
      if (kind === 'truck' ? Math.abs(px) > t.halfX + R(6) || Math.abs(pz) > t.halfZ + R(6) : !t.inside(px, pz)) return false;
      if (this.out && this.out(px, pz) !== true) return false;
      if (other?.loaded) {
        const dx = px - other.x, dz = pz - other.z, ox = Math.cos(other.yaw), oz = -Math.sin(other.yaw);
        if (Math.abs(dx * ox + dz * oz) < R(oh[0]) && Math.abs(-dx * oz + dz * ox) < R(oh[1])) return false;
      }
    }
    return true;
  }
  _driveStep(dt) {
    const app = this.app, t = app.terrain, g = this.grader, L = this.loader, T = this.truck;
    const [lx, ly] = this.stick.l, [rx, ry] = this.stick.r, on = lx || ly || rx || ry;
    if (on) { this.idleT = 0; if (!app.journal.pending) app.journal.begin('drive', { machine: this.drv }, app.clock); }
    else if (app.journal.pending?.type === 'drive' && (this.idleT += dt) > 0.4) this._commitDrive();
    let moved = 0;
    if (this.drv === 'truck') {
      // a truck: speeds up and slows down, steers its front wheels (it turns as it goes)
      this.v += (-ly * R(4) - this.v) * (1 - Math.exp(-dt * 1.8));
      if (Math.abs(this.v) < R(0.02) && !ly) this.v = 0;
      const yaw = T.yaw - lx * 0.55 * this.v / R(2.5) * dt, f = [Math.cos(yaw), -Math.sin(yaw)];
      const nx = T.x + f[0] * this.v * dt, nz = T.z + f[1] * this.v * dt;
      if (this.v && this._fits('truck', nx, nz, yaw)) T.place(t, nx, nz, yaw); else this.v = 0;
      T.tipGoal = Math.max(0, Math.min(0.8, T.tipGoal - ry * 0.5 * dt));
      // the body up: the soil runs out over the tailgate, a heap behind it
      if (T.tip > 0.3 && T.load > 0) {
        const dl = Math.min(T.load, dt * 0.35 * (T.tip - 0.3) / 0.5);
        T.load -= dl;
        const b = T.bodyBox, p = new THREE.Vector3(b.min.x, 0, (b.min.z + b.max.z) / 2).applyMatrix4(T.root.matrixWorld), fx = Math.cos(T.yaw), fz = -Math.sin(T.yaw);
        const px = p.x - fx * R(0.5), pz = p.z - fz * R(0.5);
        if (t.inside(px, pz)) t.deposit(px, pz, dl * TRUCK_LOAD / MODEL_SCALE ** 3, R(0.8), 0, 0);
      }
      app.sfx.scrapeLevel(0.1 + Math.min(0.4, Math.abs(this.v) / R(4) * 0.4));
    } else {
      // the skid steer: on the spot or on, the left stick forward / round; the right one the arms (up /
      // down) and the bucket (left curls it back, right tips it)
      this.v += (-ly * SPEED - this.v) * (1 - Math.exp(-dt * 4));
      if (Math.abs(this.v) < R(0.02) && !ly) this.v = 0;
      const yaw = L.yaw - lx * TURN * dt, f = [Math.cos(yaw), -Math.sin(yaw)];
      const nx = L.x + f[0] * this.v * dt, nz = L.z + f[1] * this.v * dt;
      if (this._fits('loader', nx, nz, yaw)) { moved = this.v * dt; L.place(t, nx, nz, yaw); } else { this.v = 0; if (lx && this._fits('loader', L.x, L.z, yaw)) L.place(t, L.x, L.z, yaw); }
      L.armGoal = Math.max(-0.35, Math.min(1.0, L.armGoal - ry * 0.7 * dt));
      L.tiltGoal = Math.max(-1.0, Math.min(0.6, L.tiltGoal - rx * 1.4 * dt));
      // the bucket rests on the ground: lowered on, it stops there
      const e = L.edgeWorld(new THREE.Vector3());
      // (the ground: the plot as it was, or lower where it is dug — a heap tipped on it is gone into;
      // a level bucket skims it, its nose tipped down cuts in up to ≈12 cm)
      { const b = L.lowWorld(new THREE.Vector3()), i = t.index(b.x, b.z), floor = Math.min(t.heightAt(b.x, b.z), t.orig[i]) - R(0.12) * Math.min(1, Math.max(0, -L.tilt / 0.3)), lo = this._armFor(floor, true);
        // (float: lowered onto the ground it stays on it — whatever the machine does under it — till lifted)
        if (L.armGoal <= lo + 0.01 && ry >= 0) this.float = true; else if (ry < 0) this.float = false;
        if (this.float) L.armGoal = L.arm = lo;
        if (L.armGoal < lo) L.armGoal = lo; if (L.arm < lo) L.arm = lo; }
      L.update(0); L.edgeWorld(e);
      const hw = Math.max(L.bucketW / 2, R(0.95));   // (a bucket is as wide as the wheels' track, or wider: they go where it has cut)
      // going on with the edge in the ground: it cuts at the edge's height into the bucket; a full bucket
      // pushes what stands over its edge on ahead of it (it runs off to the sides as a windrow)
      if (moved > 0 && L.tilt >= 0.15) {
        // (curled back it is shut: nothing goes in — its bottom pushes what stands over it on ahead)
        const b = L.lowWorld(new THREE.Vector3());
        if (b.y < t.heightAt(b.x, b.z)) this._bulldoze(b.x, b.z, f, hw, b.y);
      }
      if (moved > 0 && L.tilt > -0.45 && L.tilt < 0.15) {
        const keep = g.target; g.target = () => e.y;
        const n = Math.max(1, Math.ceil(moved / (t.cell * 0.7)));
        for (let k = n - 1; k >= 0; k--) {
          const bx = e.x - f[0] * moved * k / n, bz = e.z - f[1] * moved * k / n;
          g.blade(bx, bz, f[0], f[1], hw, this.cap, true);
          if (g.load >= this.cap * 0.98) this._bulldoze(bx, bz, f, hw, e.y);
        }
        // (and the bucket is a wall: what has run back over the edge into its mouth since — the pile
        // ahead slumping — is taken again, so the wheels behind go on the cut ground)
        for (let d = t.cell * 0.7; d < R(0.7); d += t.cell * 0.7) {
          const bx = e.x - f[0] * d, bz = e.z - f[1] * d;
          g.blade(bx, bz, f[0], f[1], hw, this.cap, true);
          if (g.load >= this.cap * 0.98) this._bulldoze(bx, bz, f, hw, e.y, d);
        }
        g.target = keep;
      }
      // curled back with the edge in the soil: what lies over it in the bucket's mouth goes in
      if (rx < 0 && L.tilt < 0.35 && g.load < this.cap && e.y < t.heightAt(e.x, e.z)) {
        const keep = g.target; g.target = () => e.y;
        g.scoop(e.x - f[0] * R(0.35), e.z - f[1] * R(0.35), hw * 0.9, this.cap);
        g.target = keep;
      }
      // tipped: it runs out over the lip as it tips — the more, the faster; into the body when it is
      // over it, else it falls and lands where it falls
      if (L.tilt < -0.45 && g.load > 1e-9) this._pour(dt, e, f, hw);
      else if (this._intoTruck && g.load <= 1e-9) { this._intoTruck = false; app.ui?.toast(`В кузове ${(T.load * TRUCK_LOAD).toFixed(1).replace('.', ',')} из ${TRUCK_LOAD} м³`); }
      L.soilColor(this._mix());
      L.load = Math.min(1, g.load / this.cap);
      app.sfx.scrapeLevel(0.15 + Math.min(0.5, Math.abs(this.v) / SPEED * 0.3 + L.load * 0.2));
      L.update(dt, moved);
    }
    const M = this.drv === 'truck' ? T : L, rig = app.rig;
    if (this.view === 'free') return;   // (the camera left where it is)
    if (this.view === 'cab' || this.view === 'roof') {
      // from the driver's seat: looking ahead and down at where the bucket works (held still, no lag)
      const f = new THREE.Vector3(Math.cos(M.yaw), 0, -Math.sin(M.yaw)), roof = this.view === 'roof', seat = this.seatAt || (roof ? (this.drv === 'truck' ? [1.3, 2.75] : [0.85, 2.55]) : this.drv === 'truck' ? [1.45, 1.6] : [0.62, 1.75]);
      const e = new THREE.Vector3(seat[0] * R(1), seat[1] * R(1), 0).applyMatrix4(M.root.matrixWorld);
      const [la, ld] = this.lookAt || (roof ? (this.drv === 'truck' ? [5.5, 2.3] : [1.35, 2.4]) : this.drv === 'truck' ? [8, 1.2] : [1.25, 1.7]), ahead = R(la), drop = R(ld);   // (the loader: steep down — the bucket in the middle of the picture)
      rig.setState({ target: [e.x + f.x * ahead, e.y - drop, e.z + f.z * ahead], yaw: M.yaw - Math.PI / 2, pitch: Math.atan2(drop, ahead), dist: Math.hypot(ahead, drop) }, true);
      this._camYaw = null; rig.shakeKeep ??= rig.shake; rig.shake = false;
      this._fov(this.drv === 'truck' ? 62 : 75);   // (wide, as a camera in a cab: the bucket below and the way ahead both in sight)
      this._mirrors(M, f);
      return;
    }
    if (rig.shakeKeep != null) { rig.shake = rig.shakeKeep; rig.shakeKeep = null; }
    this._fov(null); this._mirrors(null);
    // the camera behind it (a finger turning it round keeps its turn)
    if (this._camYaw != null) this.camOff += rig.goal.yaw - this._camYaw;
    rig.goal.yaw = this._camYaw = M.yaw - Math.PI / 2 + this.camOff;
    const ahead = R(this.drv === 'truck' ? 1.5 : 2);   // (a little ahead of it: what it goes into is in sight)
    rig.goal.target.set(M.x + Math.cos(M.yaw) * ahead, M.y + R(0.8), M.z - Math.sin(M.yaw) * ahead); rig.clampTarget();
  }

  // what stands over the edge across the bucket, moved on ahead of it
  _bulldoze(x, z, f, hw, y, back = 0) {
    const t = this.app.terrain, g = this.grader, push = (this._pushC ||= new Float64Array(4));
    let any = false;
    for (let q = -hw; q <= hw; q += t.cell * 0.7) {
      const px = x - f[1] * q, pz = z + f[0] * q;
      if (!t.inside(px, pz)) continue;
      const i = t.index(px, pz);
      if (!g.free(i, px, pz)) continue;
      const over = t.nat[i] + t.loose[i] - y;
      if (over > 1e-7) { g.cut(i, over, push); any = true; }
    }
    if (!any) return;
    const ix = Math.round(t.toCellX(x)), iz = Math.round(t.toCellZ(z)), n = Math.ceil(hw / t.cell) + 1;
    t._touch(Math.max(0, ix - n), Math.max(0, iz - n), Math.min(t.rx, ix + n), Math.min(t.rz, iz + n));
    const ax = x + f[0] * (R(0.75) + back), az = z + f[1] * (R(0.75) + back);   // (ahead, so it does not run back under the wheels)
    for (const m of [0, 1, 2, 3]) if (push[m] > 0) { if (t.inside(ax, az)) t.deposit(ax, az, push[m] * t.cellArea, hw * 0.8, 0, m); push[m] = 0; }
  }
  // a frame of pouring: a share of each material out over the lip, as falling crumbs (they land
  // where they fall: the volume goes down there), or into the truck's body under it
  _pour(dt, e, f, hw) {
    const app = this.app, t = app.terrain, g = this.grader, T = this.truck, L = this.loader;
    const rate = Math.min(1, (-L.tilt - 0.45) / 0.45) * this.cap * 1.3 * dt, k = Math.min(1, rate / g.load);
    const q = T?.root.visible && T.loaded ? T.root.worldToLocal(e.clone()) : null, b = T?.bodyBox;
    const truck = q && q.x > b.min.x - R(0.1) && q.x < b.max.x + R(0.1) && q.z > b.min.z - R(0.25) && q.z < b.max.z + R(0.25);
    const r = Math.random, N = 10;
    for (const m of [0, 1, 2, 3]) {
      const a = g.carry[m] * k; if (a <= 0) continue;
      g.carry[m] -= a;
      const vol = a * t.cellArea;
      if (truck) { T.load = Math.min(1, T.load + vol * MODEL_SCALE ** 3 / TRUCK_LOAD); this._intoTruck = true; }
      for (let j = 0; j < N; j++) {
        const w = (r() * 2 - 1) * hw * 0.9, pos = new THREE.Vector3(e.x - f[1] * w + f[0] * R(0.05), e.y + R(0.05), e.z + f[0] * w + f[1] * R(0.05));
        const vel = new THREE.Vector3(f[0] * R(0.4) * (0.5 + r()), -R(0.3) * r(), f[1] * R(0.4) * (0.5 + r()));
        app.particles.emit(pos, vel, truck ? 0 : vol / N, R(0.03 + r() * 0.05), m === 1 ? 0 : 0.05, 0, m);   // (a lump here and there; it rolls down)
      }
    }
    if (g.load < 1e-7) g.carry.fill(0);
  }
  // the colour of what is in the bucket (the materials mixed as they are in it)
  _mix() {
    const c = this.grader.carry, tot = c[0] + c[1] + c[2] + c[3], out = (this._mixC ||= new THREE.Color());
    out.setRGB(0, 0, 0);
    if (tot <= 0) return out.set(BUCKET_COL[0]);
    for (const m of [0, 1, 2, 3]) if (c[m] > 0) { const k = c[m] / tot, col = BUCKET_COL[m]; out.r += col.r * k; out.g += col.g * k; out.b += col.b * k; }
    return out;
  }

  // undo while it works: what it did since the last commit is taken back
  abort() {
    const app = this.app, L = this.loader;
    if (this.state === 'drive') {
      if (app.journal.pending?.type !== 'drive') return false;
      app.journal.cancel(); this.grader.carry.fill(0); L.load = 0; this.v = 0;
      const r = this.rec; if (r) L.place(app.terrain, r.x, r.z, r.yaw);
      const T = this.truck, q = this.recOf('truck'); if (T && q) { T.place(app.terrain, q.x, q.z, q.yaw); T.load = q.load || 0; }
      return true;
    }
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
  focus(out) { const L = this.state === 'drive' && this.drv === 'truck' ? this.truck : this.loader; return L?.loaded ? out.set(L.x, L.y + R(1), L.z) : null; }
}
