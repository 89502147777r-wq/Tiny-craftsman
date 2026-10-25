import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { Loader } from '../world/loader.js';
import { Truck, TRUCK_LOAD } from '../world/truck.js';
import { Grader } from './grade.js';
import { houseOutside } from './pitchedTool.js';
import { boxOf } from './freeBrick.js';
import { makeLoadMaterial } from '../world/terrainMaterial.js';
import { Puffs } from '../world/smoke.js';
import { Streams } from '../world/stream.js';

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
      L.soil.material = makeLoadMaterial(app.terrainMat); L.soil.material.objScale.copy(L.soil.scale);
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
      T.soil.material = makeLoadMaterial(app.terrainMat); T.soil.material.objScale.set(T.soil.scale.x, 1, T.soil.scale.z); T.mix = [1, 0, 0, 0];
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
    let blocked = false;
    if (step > 0 && !this._fits('loader', nx, nz, yaw)) { blocked = true; step = 0; }
    L.place(t, L.x + fx * step, L.z + fz * step, yaw);
    if (step) this._tracks('loader', step);
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
    if (this.state === 'drive') this._driveStep(dt);
    else {
      if (this.state === 'work') moved = this._gradeStep(dt);
      else if (this.state === 'haul') moved = this._haulStep(dt);
      L.soil.material.setMix?.(this._mixW());
      L.update(dt, moved);
    }
    this.truck?.update(dt);
    this._life(dt);
  }
  // the engines (their sound), the exhaust and the dust off the wheels — while the machines work
  _life(dt) {
    const app = this.app, L = this.loader, T = this.truck, cam = app.camera.position;
    const P = (this.puffs ||= new Puffs(app.scene));
    const wet = (app.terrainMat?.userData?.uniforms?.uWet?.value ?? 0) > 0.3;
    const one = (id, M, on, kind) => {
      const st = (this._mv ||= {})[id] ||= { x: M.x, z: M.z, sp: 0, ex: 0, du: 0 };
      const sp = Math.hypot(M.x - st.x, M.z - st.z) / Math.max(dt, 1e-3); st.x = M.x; st.z = M.z;
      st.sp += (sp - st.sp) * Math.min(1, dt * 5);
      const top = kind === 'loader' ? SPEED : R(4), [rx, ry] = this.stick?.r ?? [0, 0];
      const work = kind === 'loader' ? (rx || ry ? 0.35 : 0) + (this._drag || 0) * 0.3 + L.load * 0.1 : (T.tipGoal > T.tip + 0.01 ? 0.4 : 0);
      const rpm = on ? Math.min(1, 0.08 + 0.6 * Math.min(1, st.sp / top) + work) : 0;
      const loud = on && M.root.visible ? 1 / (1 + cam.distanceTo(M.root.position) / R(14)) : 0;
      app.sfx.engine(id, loud * 0.6, rpm);
      if (!on || !M.root.visible) return;
      // (the exhaust: a puff now and then idling, thick and dark pulling)
      st.ex += dt * (1.2 + 9 * rpm);
      while (st.ex >= 1) { st.ex -= 1; const p = M.root.localToWorld(kind === 'loader' ? new THREE.Vector3(R(-1.25), R(2.05), R(0.42)) : new THREE.Vector3(R(-0.3), R(0.35), R(-0.85))); P.emit('smoke', p, new THREE.Vector3(0, 0, 0), 0.5 + rpm); }
      // (the dust: off dry loose ground under the wheels, as fast as it goes)
      if (wet || st.sp < R(0.2)) return;
      st.du += dt * 6 * Math.min(1, st.sp / top);
      while (st.du >= 1) {
        st.du -= 1;
        const w = kind === 'loader' ? L.body.localToWorld(L.wheels[(Math.random() * 4) | 0].at.clone()) : T.root.localToWorld(new THREE.Vector3(T.wheels.length ? T.wheels[(Math.random() * T.wheels.length) | 0].g.position.x : 0, 0, (Math.random() < 0.5 ? -1 : 1) * R(0.75)));
        const t = app.terrain; if (!t.inside(w.x, w.z) || t.loose[t.index(w.x, w.z)] < R(0.005)) continue;
        w.y = t.heightAt(w.x, w.z) + R(0.1); P.emit('dust', w, new THREE.Vector3(0, 0, 0), 0.6 + 0.6 * Math.min(1, st.sp / top));
      }
    };
    if (L?.loaded) one('loader', L, this.state !== 'idle', 'loader');
    if (T?.loaded) one('truck', T, this.state === 'haul' || (this.state === 'drive' && this.drv === 'truck'), 'truck');
    this._flushPush();
    P.update(dt);
    (this.streams ||= new Streams(app.scene)).update(dt);
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
    const cl = (v, h) => Math.max(-h + e, Math.min(h - e, v));
    const edges = [
      { at: (s) => ({ x: s, z: -hz + m }), s0: cl(p.x, hx), h: hx, yaw: 0 },
      { at: (s) => ({ x: s, z: hz - m }), s0: cl(p.x, hx), h: hx, yaw: Math.PI },
      { at: (s) => ({ x: -hx + m, z: s }), s0: cl(p.z, hz), h: hz, yaw: -Math.PI / 2 },
      { at: (s) => ({ x: hx - m, z: s }), s0: cl(p.z, hz), h: hz, yaw: Math.PI / 2 },
    ];
    // (each edge: the place nearest the heap, else along the edge either way, half a metre a step,
    // till the truck's whole outline is clear of the houses and the walls)
    const cands = [];
    for (const E of edges) for (let k = 0; k < 80; k++) {
      const sv = E.s0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * R(0.5);
      if (Math.abs(sv) > E.h - e) continue;
      const c = E.at(sv);
      if (this._fits('truck', c.x, c.z, E.yaw)) { cands.push({ ...c, yaw: E.yaw }); break; }
    }
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
    this.drive = this._route(pk, true);
    this.phase = 'arrive';
    this.app.ui?.toast('Самосвал заезжает на участок');
  }
  // the truck's way in to its place (or out of it): a curve from off the plot, beside it, turning in
  // along the edge — and out the same way on ahead, off the plot
  _route(pk, come) {
    const fx = Math.cos(pk.yaw), fz = -Math.sin(pk.yaw), sx = Math.sin(pk.yaw), sz = Math.cos(pk.yaw);
    const o = Math.sign(pk.x * sx + pk.z * sz) || 1, nx = sx * o, nz = sz * o;   // (out of the plot)
    const P = (a, b) => [pk.x + fx * R(a) + nx * R(b), pk.z + fz * R(a) + nz * R(b)];
    const pts = come ? [P(-16, 14), P(-9, 6), P(-5, 0), P(0, 0)] : [P(0, 0), P(5, 0), P(9, 6), P(18, 16)];
    return { pts, t: 0, dur: 6, in: come };
  }
  _along(D, e) {
    const [a, b, c, d] = D.pts, u = 1 - e;
    const B = (i) => u * u * u * a[i] + 3 * u * u * e * b[i] + 3 * u * e * e * c[i] + e * e * e * d[i];
    const dB = (i) => 3 * u * u * (b[i] - a[i]) + 6 * u * e * (c[i] - b[i]) + 3 * e * e * (d[i] - c[i]);
    return [B(0), B(1), Math.atan2(-dB(1), dB(0))];
  }
  _haulStep(dt) {
    const app = this.app, t = app.terrain, g = this.grader, L = this.loader, T = this.truck;
    const ph = this.phase;
    let moved = 0;
    const bucket = (arm, tilt) => { L.armGoal = arm; L.tiltGoal = tilt; };
    if (ph === 'truck') { bucket(0.25, 0.35); return 0; }
    if (ph === 'arrive' || ph === 'leave') {
      const D = this.drive; D.t = Math.min(D.dur, D.t + dt); const k = D.t / D.dur, e = D.in ? 1 - (1 - k) ** 2 : k * k;   // (slowing as it comes in, gathering speed going)
      const [x, z, yaw] = this._along(D, e); T.place(t, x, z, yaw);
      if (D.t >= D.dur) {
        if (ph === 'arrive') { this._sideOf(); if (!app.journal.pending) app.journal.act('truck-in', {}, app.clock, () => this._saveTruck({ away: false })); this.phase = this.heap ? 'toHeap' : 'idle'; }
        else {
          // (away on the road: it tips at the tip, out of sight, and comes back empty a little later)
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
      T.root.visible = false; T.load = 0; T.tip = T.tipGoal = 0;
      if (this.wait <= 0) this._arrive();
      bucket(0.25, 0.35); return 0;
    }
    if (ph === 'idle' || !this.heap) { this._haulEnd(); return 0; }
    const H = this.heap;
    if (ph === 'toHeap') {
      // (it comes at the heap from the side away from nothing in particular: straight from where it is)
      // (the way in: straight from where it is when it picks the spot — or, when that way was found
      // shut, from another side; kept till the next bucketful)
      if (!this.aim) {
        this.aim = this._peak(H.x, H.z, R(1.6));
        let dx = this.aim.x - L.x, dz = this.aim.z - L.z, d = Math.hypot(dx, dz);
        if (d < R(0.5)) { dx = Math.cos(L.yaw); dz = -Math.sin(L.yaw); d = 1; }
        const rot = this.side2 || 0;
        this.into = [(dx * Math.cos(rot) - dz * Math.sin(rot)) / d, (dx * Math.sin(rot) + dz * Math.cos(rot)) / d];
      }
      const A = this.aim;
      const ax = A.x - this.into[0] * R(2.6), az = A.z - this.into[1] * R(2.6);
      const r = this._drive(dt, ax, az); moved = r.step;
      if (r.blocked) {
        if ((this.tries = (this.tries || 0) + 1) <= 5) { this.side2 = (this.side2 || 0) + 1.1; this.aim = null; return 0; }
        app.ui?.toast(this._over(H.x, H.z, R(1.4)) < 0.3 ? 'Куча вывезена — остатки разровняйте ковшом' : 'К куче погрузчику не подъехать — мешает самосвал, дом или стена'); this._haulEnd(); return 0;
      }
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
      if (r.blocked && g.load < this.cap * 0.1 && (this.tries = (this.tries || 0) + 1) <= 5) {
        // (shut in at once — the truck, a wall: back out and come at it from another side)
        app.journal.cancel(); app.sfx.scrapeStop(); this.side2 = (this.side2 || 0) + 1.1; this.aim = null; this.phase = 'backoff'; this.backD = R(1.2);
      } else if (g.load >= this.cap * 0.97 || r.d < R(0.2) || r.blocked) { this.phase = 'curl'; this.wait = 0.7; app.sfx.scrapeStop(); if (g.load >= this.cap * 0.3) this.tries = 0; }
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
      this._dumpV = null;
      bucket(0.95, 0.5); this.wait -= dt;
      // (raised: it creeps on until the bucket's lip is over the middle of the body — the load lands
      // in the middle, not against the near side)
      if (L.lowWorld(new THREE.Vector3()).y > T.y + T.bodyBox.max.y + R(0.1)) {
        const c = T.bedCentre(new THREE.Vector3()), e = L.edgeWorld(new THREE.Vector3()), q = T.root.worldToLocal(e.clone()), bb = T.bodyBox;
        const off = q.z - (bb.min.z + bb.max.z) / 2, far = Math.abs(off) > R(0.12) && Math.sign(off) === Math.sign(T.root.worldToLocal(new THREE.Vector3(L.x, c.y, L.z)).z - (bb.min.z + bb.max.z) / 2);
        if (far && (this.creep = (this.creep || 0) + dt) < 5) { const r = this._drive(dt, c.x, c.z, 0.45); moved = r.step; if (r.blocked) this.creep = 9; this.wait = Math.max(this.wait, 0.05); }
      }
      if (this.wait <= 0) { this.phase = 'dump'; this.wait = 1.0; this.creep = 0; }
    } else if (ph === 'dump') {
      bucket(0.95, -0.9); this.wait -= dt;
      // (where it lands: the operator shakes the bucket over the body as it empties, the load leaves it
      // sliding on forward — along the body's middle, not against its near side)
      const landAt = () => { const q = T.root.worldToLocal(L.edgeWorld(new THREE.Vector3()).add(new THREE.Vector3(Math.cos(L.yaw) * R(0.35), 0, -Math.sin(L.yaw) * R(0.35)))), bb = T.bodyBox, mz = (bb.min.z + bb.max.z) / 2; q.z = mz + (q.z - mz) * 0.2; return T.root.localToWorld(q); };
      if (!this._dumpV) {
        // (as much as the body takes; the rest runs over its side)
        const v = g.realVolume(), into = Math.min(v, Math.max(0, (1 - T.load) * TRUCK_LOAD));
        const mw = this._mixW(); if (T.load < 0.02) T.mix = [0, 0, 0, 0]; for (let m = 0; m < 4; m++) T.mix[m] += mw[m] * into; T.soil.material.setMix?.(T.mix);
        this._dumpV = { v, into, done: 0, col: this._mix().clone() };
      }
      const D = this._dumpV;
      L.load = Math.max(0, L.load - dt * 1.4);
      if (L.tilt < -0.3 && D.done < D.into) {
        // (it runs into the body as the bucket tips: a stream off the lip, the heap growing under it)
        const e = L.edgeWorld(new THREE.Vector3()), fx = Math.cos(L.yaw), fz = -Math.sin(L.yaw), r = Math.random, hw = L.bucketW / 2, land = landAt();
        const dv = Math.min(D.into - D.done, D.into * dt * 1.6); D.done += dv;
        T.pourLine(land, new THREE.Vector3(Math.sin(L.yaw), 0, Math.cos(L.yaw)), hw, dv / TRUCK_LOAD);
        const ly = land.clone(); ly.y = Math.max(T.surfaceAt(land), e.y - R(2));
        (this.streams ||= new Streams(app.scene)).set(1, e, ly, hw * 1.7, D.col, 1, new THREE.Vector3(-fz, 0, fx));
        const mw = this._mixW(); for (let j = 0; j < 6; j++) { const w = (r() * 2 - 1) * hw * 0.9; let m = 0, u = r(); for (let q = 0; q < 4; q++) { u -= mw[q]; if (u <= 0) { m = q; break; } } app.particles.emit(new THREE.Vector3(e.x + fz * w, e.y, e.z - fx * w), new THREE.Vector3(fx * R(0.4) * r(), -R(0.3) * r(), fz * R(0.4) * r()), 0, R(0.03 + r() * 0.05), 0, 0, m); }
      }
      if (this.wait <= 0) {
        // the bucketful is in the body: one action — the heap lower, the truck fuller
        const { v, into } = D; this.aim = null; this.empty = v < 0.03 ? this.empty + 1 : 0;
        if (D.done < into) T.pourLine(landAt(), new THREE.Vector3(Math.sin(L.yaw), 0, Math.cos(L.yaw)), L.bucketW / 2, (into - D.done) / TRUCK_LOAD);
        const k = v > 0 ? 1 - into / v : 0;
        if (k > 0) { const sp = this._overSide(L.edgeWorld(new THREE.Vector3())); for (const m of [0, 1, 2, 3]) if (g.carry[m] > 0) t.deposit(sp.x, sp.z, g.carry[m] * k * t.cellArea, R(0.5), 0, m); }
        g.carry.fill(0); L.load = 0; this._dumpV = null;
        this._savePose(); this._saveTruck({ away: false });
        app.journal.commit(app.clock);
        this.phase = 'lower'; this.wait = 1.0;
      }
    } else if (ph === 'lower') {
      bucket(0.25, 0.35); this.wait -= dt;
      if (this.wait <= 0) {
        if (T.load >= 0.9) {
          this.drive = this._route({ x: T.x, z: T.z, yaw: T.yaw }, false);
          this.phase = 'leave';
          app.ui?.toast('Самосвал полный — уезжает, вернётся пустым');
        }
        if (this._over(H.x, H.z, R(1.4)) < 0.03 || this.empty >= 3) { app.ui?.toast('Куча вывезена до проектной отметки'); this.heap = null; if (this.phase !== 'leave') this._haulEnd(); }
        else if (this.phase !== 'leave') { this.phase = 'backoff'; this.backD = R(1.6); }
      }
    } else if (ph === 'backoff') {
      // (back off from the truck's side before turning to the heap — its bucket clear of the body)
      bucket(0.25, 0.35);
      const st = Math.min(SPEED * 0.7 * dt, this.backD), fx = Math.cos(L.yaw), fz = -Math.sin(L.yaw), nx = L.x - fx * st, nz = L.z - fz * st;
      if (st > 0 && this._fits('loader', nx, nz, L.yaw, true)) { L.place(t, nx, nz, L.yaw); moved = -st; this.backD -= st; } else this.backD = 0;
      if (this.backD <= 1e-6) this.phase = this.heap ? 'toHeap' : 'idle';
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
      // (a machine left in a wall — a project from before the walls were looked at — is moved out to
      // the nearest clear place first, else it could not move at all)
      const M = kind === 'truck' ? this.truck : this.loader;
      if (!this._fits(kind, M.x, M.z, M.yaw)) {
        const q = kind === 'truck' ? this._parkFor({ x: M.x, z: M.z }) : this._clearNear(M.x, M.z, M.yaw);
        if (q) app.journal.act('move-out', {}, app.clock, () => { M.place(app.terrain, q.x, q.z, q.yaw); if (kind === 'truck') this._saveTruck({}); else this._savePose(); });
      }
      this.state = 'drive'; this.drv = kind; this.stick = { l: [0, 0], r: [0, 0] };
      this.v = 0; this.camOff = 0; this._camYaw = null; this.idleT = 0; this.holdY = null; this.holdRel = null; this.armSet = null; this.view ??= 'cab';   // (from the cab's front: the bucket and the arms below, the way ahead)
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
      mr.set(kind === 'truck' ? [{ rect: [0.02, 0.4, 0.15, 0.17] }, { rect: [0.83, 0.4, 0.15, 0.17] }] : kind === 'loader' ? [{ rect: [0.41, 0.012, 0.18, 0.075] }] : null);
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
  joystick(side, x, y) {
    if (this.state !== 'drive') return;
    // (the right stick works one thing at a time — the arms or the bucket, whichever it is pushed more
    // to: a thumb pulling it down always strays a little sideways, and the bucket would tip with it)
    if (side === 'r') { if (Math.abs(x) < Math.abs(y) * 0.7) x = 0; else if (Math.abs(y) < Math.abs(x) * 0.7) y = 0; }
    this.stick[side] = [x, y];
  }
  _commitDrive() {
    const app = this.app;
    if (app.journal.pending?.type !== 'drive') return;
    this._savePose(); if (this.truck?.root.visible && this.recOf('truck')) this._saveTruck({});
    app.journal.commit(app.clock);
  }
  // the machine's outline there clear of houses, of the other machine and of the plot's edge
  _fits(kind, x, z, yaw, noOther = false) {
    // (its outline every 20 cm — a 30 cm wall, a gate's post, cannot slip between two points — and
    // its middle line. The loader's bucket and the arms' ends, its front 1 m, are stopped by what stands higher than its
    // bottom — lifted over the truck's side or a low wall it goes over it)
    const t = this.app.terrain, fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const [a0, a1, hb] = kind === 'truck' ? [-2.35, 2.35, 0.9] : [-1.5, 2.0, 1.0], st = 0.2, pts = [];
    for (let a = a0; a <= a1 + 1e-6; a += st) pts.push([a, hb], [a, -hb], [a, 0]);
    for (let b = -hb + st; b < hb - 1e-6; b += st) pts.push([a0, b], [a1, b]);
    const other = noOther ? null : kind === 'truck' ? this.loader : this.truck?.root.visible ? this.truck : null, oh = kind === 'truck' ? [1.6, 1.0] : [2.4, (other?.width ? other.width * MODEL_SCALE / 2 : 0.85) + 0.05];   // (the loader comes right up to the body's side: its front tyres end 0,8 m ahead of it, what is further on is the arms and the bucket)
    const bucketY = kind === 'loader' && this.loader?.loaded ? this.loader.lowWorld(new THREE.Vector3()).y : null;
    const otherTop = other?.loaded && kind === 'loader' ? other.y + other.bodyBox.max.y : Infinity;
    for (const [a, b] of pts) {
      const px = x + fx * R(a) - fz * R(b), pz = z + fz * R(a) + fx * R(b), bucket = bucketY != null && a > 0.95;
      if (kind === 'truck' ? Math.abs(px) > t.halfX + R(6) || Math.abs(pz) > t.halfZ + R(6) : !t.inside(px, pz)) return false;
      if (!bucket && this.out && this.out(px, pz) !== true) return false;
      const top = this._obstTop(px, pz);
      if (bucket ? top > bucketY : top > -Infinity) return false;
      if (other?.loaded) {
        const dx = px - other.x, dz = pz - other.z, ox = Math.cos(other.yaw), oz = -Math.sin(other.yaw);
        if (Math.abs(dx * ox + dz * oz) < R(oh[0]) && Math.abs(-dx * oz + dz * ox) < R(oh[1]) && (!bucket || bucketY < otherTop)) return false;
      }
    }
    return true;
  }
  // the nearest place the loader fits (rings round, 25 cm apart)
  _clearNear(x, z, yaw) {
    for (let r = R(0.25); r < R(12); r += R(0.25)) for (let k = 0, n = Math.ceil(r / R(0.25)) * 6; k < n; k++) {
      const a = k / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this._fits('loader', px, pz, yaw)) return { x: px, z: pz, yaw };
    }
    return null;
  }
  // the top of what stands there that a machine cannot go through — a block of masonry (a house's, a
  // lone wall's, a gate's post), a pallet of blocks by a wall — 5 cm round it; −∞: nothing. In a grid
  // of 2 m cells, made again when the blocks or the walls change.
  _obstTop(x, z) {
    const us = this.app.objects.all('unit'), ws = this.app.objects.all('wall'), C = R(2), t = this.app.terrain;
    const key = us.length + ':' + (us.at(-1)?.id ?? 0) + ':' + ws.length + ':' + (ws.at(-1)?.id ?? 0) + ':' + ws.map((w) => w.pallet?.join() ?? '').join('|');
    if (this._wk !== key) {
      this._wk = key; const grid = (this._wg = new Map());
      const add = (b) => {
        const r = Math.hypot(b.hl, b.hw) + R(0.05);
        for (let i = Math.floor((b.x - r) / C); i <= Math.floor((b.x + r) / C); i++) for (let j = Math.floor((b.z - r) / C); j <= Math.floor((b.z + r) / C); j++) {
          const k = i * 65536 + j; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(b);
        }
      };
      for (const u of us) if (u.p && u.s && u.q && u.kind !== 'prop') add(boxOf(u));
      // (a pallet: 1200 × 800 mm, its stack of blocks ≈1,3 m high)
      for (const w of ws) if (w.pallet) { const [px, pz, py] = w.pallet, g = t.heightAt(px, pz); add({ x: px, z: pz, ux: Math.cos(py), uz: -Math.sin(py), hl: R(0.6), hw: R(0.4), bot: g, top: g + R(1.3) }); }
    }
    const l = this._wg.get(Math.floor(x / C) * 65536 + Math.floor(z / C));
    if (!l) return -Infinity;
    const m = R(0.05), g = t.heightAt(x, z);
    let top = -Infinity;
    for (const b of l) { const dx = x - b.x, dz = z - b.z; if (Math.abs(dx * b.ux + dz * b.uz) < b.hl + m && Math.abs(-dx * b.uz + dz * b.ux) < b.hw + m && b.bot < g + R(2.5) && b.top > top) top = b.top; }
    return top;
  }
  _driveStep(dt) {
    const app = this.app, t = app.terrain, g = this.grader, L = this.loader, T = this.truck;
    this._wallPass = null;
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
      if (this.v && this._fits('truck', nx, nz, yaw)) {
        const keep = [T.x, T.z, T.yaw];
        T.place(t, nx, nz, yaw);
        if (this._tooSteep('truck', T, keep)) { T.place(t, ...keep); this.v = 0; }
        else this._tracks('truck', this.v * dt);
      } else this.v = 0;
      T.tipGoal = Math.max(0, Math.min(0.8, T.tipGoal - ry * 0.5 * dt));
      // the body up: the soil runs out over the tailgate, a heap behind it
      this._tipOut(dt);
      app.sfx.scrapeLevel(0.1 + Math.min(0.4, Math.abs(this.v) / R(4) * 0.4));
    } else {
      // the skid steer: on the spot or on, the left stick forward / round; the right one the arms (up /
      // down) and the bucket (left curls it back, right tips it)
      // (heavy going: cutting and pushing with a full bucket it goes slower — down to half its speed)
      // (and too much in front of it — a big windrow, a full bucket, firm ground — its wheels lose their
      // grip: it goes slower and slower, stops, its wheels spinning on the spot, digging in)
      const drag = this._drag ?? 0, slip = ly < 0 ? (this._slip ?? 0) : 0;
      this.v += (-ly * SPEED * (1 - 0.5 * drag) * (1 - slip) - this.v) * (1 - Math.exp(-dt * 4));
      if (Math.abs(this.v) < R(0.02) && !ly) this.v = 0;
      const yaw = L.yaw - lx * TURN * dt, f = [Math.cos(yaw), -Math.sin(yaw)];
      const nx = L.x + f[0] * this.v * dt, nz = L.z + f[1] * this.v * dt;
      if (this._fits('loader', nx, nz, yaw)) {
        const keep = [L.x, L.z, L.yaw];
        L.place(t, nx, nz, yaw); moved = this.v * dt;
        if (this._tooSteep('loader', L, keep)) { L.place(t, ...keep); moved = 0; this.v = 0; }
      } else { this.v = 0; if (lx && this._fits('loader', L.x, L.z, yaw)) L.place(t, L.x, L.z, yaw); }
      if (moved || lx) this._tracks('loader', moved);
      // (armSet: where the stick has put the arms — what the ground does to the bucket for a while, lifting
      // it where it bears on it, does not move that)
      this._was = [L.arm, L.tilt];   // (where the bucket was: it goes back there if it would go into the ground)
      this.armSet = Math.max(-0.35, Math.min(1.0, (this.armSet ?? L.armGoal) - ry * 0.7 * dt));
      L.armGoal = this.armSet;
      L.tiltGoal = Math.max(-1.0, Math.min(0.6, L.tiltGoal - rx * 1.4 * dt));
      // what the bucket holds as it is tipped: curled back all of it (heaped); level ≈ 80 % (the heap on
      // top runs off); nose down less and less — and a jerk of the arms or a bump shakes some more off
      {
        const tl = L.tilt, hold = tl >= 0.4 ? 1 : tl >= 0 ? 0.8 + 0.2 * tl / 0.4 : Math.max(0.15, 0.8 + tl / 0.45 * 0.65);
        const pv = this._prevPose || [L.arm, L.pitch, L.roll], jerk = Math.abs(L.arm - pv[0]) / Math.max(dt, 1e-3) > 0.5 ? 0.05 : 0, bump = (Math.abs(L.pitch - pv[1]) + Math.abs(L.roll - pv[2])) / Math.max(dt, 1e-3) > 0.35 ? 0.06 : 0;
        this._prevPose = [L.arm, L.pitch, L.roll];
        this.capNow = this.cap * Math.max(0.1, hold - jerk - bump);
      }
      // the arms hold where they are set: going on, the edge goes at that height and takes all over it
      // — no deeper unless lowered. Lowered, the bucket lies on what is under it — the ground, or a
      // heap's top: it sinks a little into loose material (up to ≈8 cm), its nose tipped down cuts a
      // little into firm ground (≈5 cm). To take a heap it is put down on the ground before it and
      // driven in.
      const e = L.edgeWorld(new THREE.Vector3());
      if (ry > 0) {
        // (where it would rest with the machine on all four wheels)
        if (L.lift) { L.lift = 0; L.place(t, L.x, L.z, L.yaw); L.update(0); }
        const b = L.lowWorld(new THREE.Vector3()), floor = this._bed(b), lo = this._armFor(floor, true);
        // (pressed on further, slowly, a little: it lifts the front — see below)
        if (this.armSet < lo) { this.armSet = Math.max(this.armSet + ry * 0.7 * dt * 0.75, lo - 0.06); L.armGoal = this.armSet; }
      }
      L.update(0); L.edgeWorld(e);
      // (the level it cuts at: where the edge was when the bucket was last set; lowered again, it goes deeper)
      // (only lowering the arms or tipping the nose down takes it lower; lifting or curling only higher —
      // the machine pitching meanwhile does not move it)
      // (held as a height over the ground the wheels stand on — the bucket goes with the machine, up a
      // slope and down it, but its pitching as the front wheels drop into the cut does not take it down)
      // (and taken a moment after the stick is let go too: the arms come to where they were put a little
      // after it)
      const ref = this._firmUnder(), rel = e.y - ref;
      if (ry || rx) this.setT = 0.6; else this.setT = Math.max(0, (this.setT || 0) - dt);
      if (this.holdRel == null || ry > 0 || rx > 0 || (this.setT > 0 && !ry && !rx)) this.holdRel = Math.max(rel, -R(0.15) * Math.min(1, Math.max(0, -L.tilt / 0.3)));   // (pressed down level it slides on the ground, no deeper; its nose tipped down, it bites — ≤ 15 cm)
      else if (ry < 0 || rx < 0) this.holdRel = Math.max(this.holdRel, rel);
      this.holdY = ref + this.holdRel;
      // (going on, the sticks let go, the level the edge holds is steadied: the machine rocking over the
      // bumps under its wheels does not rock the cut — an operator's hands, the float — only the
      // lie of the ground over a metre or so takes it up or down)
      const steady = moved !== 0 && !ry && !rx && this.setT <= 0;
      this._cutF = steady && this._cutF != null && Math.sign(moved) === this._cutDir ? this._cutF + (this.holdY - this._cutF) * Math.min(1, dt / 0.35) : this.holdY;
      this._cutDir = Math.sign(moved);
      const cutY = this._cutF;
      // (going on, the stick let go, the arms keep the edge at that level as the machine rides up on what
      // it leaves or dips — like a grade control: what it cuts is where the edge is)
      // (not while its front is up on the bucket: that is the ground holding it, not the level)
      if (moved && !ry && !rx && L.tilt > -0.45 && L.tilt < 0.15 && Math.abs(e.y - cutY) > R(0.01) && !((L.lift || 0) > 0.01 && cutY < e.y)) {
        const a = this._armFor(cutY); L.arm = L.armGoal = this.armSet = a; L.update(0); L.edgeWorld(e);
      }
      const hw = Math.max(L.bucketW / 2, R(0.95));   // (a bucket is as wide as the wheels' track, or wider: they go where it has cut)
      // going on with the edge in the ground: it cuts at the edge's height into the bucket; a full bucket
      // pushes what stands over its edge on ahead of it (it runs off to the sides as a windrow)
      if (moved > 0 && (L.tilt >= 0.15 || L.tilt <= -0.45)) {
        // (curled back it is shut: nothing goes in — its bottom pushes what stands over it on ahead)
        // (all of its bottom, from the edge back, at the height of its lowest point — what stands over it
        // goes on ahead at once, not through it)
        // (curled, its edge is up and back: what leads is the round of its bottom; tipped right down, the
        // edge pointing at the ground and its bottom facing ahead — either way, the frontmost of its bottom
        // points leads; the push from there back to the hindmost, at the height of its lowest point)
        const by = L.lowWorld(new THREE.Vector3()).y, v = new THREE.Vector3();
        let fr = -Infinity, bk = Infinity, fp = null;
        for (const p of L.bottom) { v.copy(p).applyMatrix4(L.bucketP.matrixWorld); const a = v.x * f[0] + v.z * f[1]; if (a > fr) { fr = a; fp = v.clone(); } if (a < bk) bk = a; }
        const clear = () => { for (let d = 0; d <= fr - bk + t.cell; d += t.cell * 0.7) this._bulldoze(fp.x - f[0] * d, fp.z - f[1] * d, f, hw, by, d, true); };   // (its round bottom slides over firm ground: only what is loose)
        clear(); this._wallPass = clear;
      }
      const nat0 = g.natCut || 0;
      // (a pass: going on with the edge set — the firm ground it meets is bitten ≤ 5 cm under where it
      // was when the pass began, however slowly it goes or long it stalls there: no pits where it slows)
      const cutting = moved > 0 && L.tilt > -0.45 && L.tilt < 0.15, dragging = moved < 0 && L.tilt > -0.45 && L.tilt < 0.3, dir = cutting ? 1 : dragging ? -1 : 0;
      if (!dir || ry || rx || dir !== this._passDir) this._passNat = dir ? new Map() : null; else if (!this._passNat) this._passNat = new Map();
      this._passDir = dir;
      // (the level the 5 cm are counted from: the firm ground round the point as the bucket meets it —
      // over ±25 cm, most of it: a narrow ridge or a lump is not a level of its own, it goes)
      const PN = this._passNat, n0 = (px, pz) => {
        const i = t.index(px, pz); let v = PN.get(i);
        if (v === undefined) {
          const hs = [];
          for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) { const qx = px + a * R(0.12), qz = pz + c * R(0.12); if (t.inside(qx, qz)) hs.push(t.nat[t.index(qx, qz)]); }
          hs.sort((p2, q2) => p2 - q2); v = Math.min(t.nat[i], hs[Math.floor(hs.length * 0.6)]); PN.set(i, v);
        }
        return v;
      };
      if (cutting) {
        // (firm ground gives ≤ 5 cm a pass, however the nose is tipped: deeper takes more passes; what is
        // loose over it all goes)
        const keep = g.target; g.target = (px, pz) => Math.max(cutY, n0(px, pz) - R(0.05));
        const n = Math.max(1, Math.ceil(moved / (t.cell * 0.7)));
        for (let k = n - 1; k >= 0; k--) {
          const bx = e.x - f[0] * moved * k / n, bz = e.z - f[1] * moved * k / n;
            g.blade(bx, bz, f[0], f[1], hw, this.capNow, true);
          if (g.load >= this.capNow * 0.98) this._bulldoze(bx, bz, f, hw, cutY);
        }
        // (and the bucket is a wall: what has run back over the edge into its mouth since — the pile
        // ahead slumping — is taken again, so the wheels behind go on the cut ground; once more after
        // the ground has slumped this frame)
        if (g.load >= this.cap * 0.98) { const ex = e.x, ez = e.z, cy = cutY; this._wallPass = () => { for (let d = 0; d < R(0.7); d += t.cell * 0.7) this._bulldoze(ex - f[0] * d, ez - f[1] * d, f, hw, cy, d, true); }; }
        // (behind the edge only what is loose: the firm ground was bitten once, at the edge)
        g.target = (px, pz) => Math.max(cutY, t.nat[t.index(px, pz)]);
        for (let d = t.cell * 0.7; d < R(1.8); d += t.cell * 0.7) {   // (under the bucket and on to the front wheels)
          const bx = e.x - f[0] * d, bz = e.z - f[1] * d;
          g.blade(bx, bz, f[0], f[1], hw, this.capNow, true);
          if (g.load >= this.capNow * 0.98) this._bulldoze(bx, bz, f, hw, cutY, d, true);
        }
        g.target = keep;
      }
      // going back with the bucket down on the ground: its flat bottom drags behind it — the bumps it
      // passes over are taken to its level and what it carries (and drags) fills the hollows; a full
      // load is dragged on back. Forward and back once or twice and the ground is level.
      if (dragging) {
        // (its bottom's level steadied as the edge's: the wheels going first over the bumps rock the
        // machine, not the drag; the firm ground ≤ 5 cm a pass, as going on)
        const b = L.lowWorld(new THREE.Vector3()), by = cutY - (e.y - b.y);
        if (by < Math.min(t.heightAt(b.x, b.z), t.orig[t.index(b.x, b.z)]) + R(0.2)) {
          // (what its back scrapes off is a roll of soil before it — not in the bucket: it fills the
          // hollows the bucket passes over and goes on with it; what is in the bucket stays in it)
          const keep = g.target, inB = g.carry; g.target = (px, pz) => Math.max(by, n0(px, pz) - R(0.05));
          g.carry = this._dragC || (this._dragC = new Float64Array(4));
          const back = [-f[0], -f[1]], m = -moved, n = Math.max(1, Math.ceil(m / (t.cell * 0.7)));
          for (let k = n - 1; k >= 0; k--) for (const d of [R(0.6), R(0.35), R(0.1)]) {
            const bx = e.x - f[0] * (d - m * k / n), bz = e.z - f[1] * (d - m * k / n);
            g.blade(bx, bz, back[0], back[1], hw, this.cap * 1.5, false);
          }
          g.carry = inB; g.target = keep;
          this._dragAt = { x: e.x - f[0] * R(0.7), z: e.z - f[1] * R(0.7), back, by, hw };
        }
      }
      // (the drag over: the roll before the bucket's back stays there, spread into the hollows round it)
      if (!dragging && this._dragC && this._dragC.some((v) => v > 0)) {
        const D = this._dragAt, inB = g.carry, keep = g.target;
        g.carry = this._dragC; g.target = () => D.by;
        g.drop(D.x, D.z, D.back[0], D.back[1], D.hw);
        g.carry = inB; g.target = keep; this._dragC.fill(0);
      }
      // curled back with the edge in the soil: what lies over it in the bucket's mouth goes in
      if (rx < 0 && L.tilt < 0.35 && g.load < this.cap && e.y < t.heightAt(e.x, e.z)) this._scoopStrip(e, f, L.bucketW / 2);
      if (rx >= 0) this._scooped?.clear();   // (a new curl: a new sliver)
      // (it lies on what is under it — the ground it has cut, a heap: the machine dipping into the cut
      // does not sink it through)
      // (standing, the bucket pressed into loose soil: what is under its bottom is pushed out to its sides)
      if (!moved && L.tilt > -0.45) this._displace(e, f);
      // the bucket bearing on the ground (lowered on it, its nose tipped down on it, the machine dipping
      // into its cut): it does not go in — the machine's front comes up on the rear wheels instead (up to
      // ≈20°; further the stick does nothing). After the cut and the push: what it goes through is gone.
      this._liftFor(t); L.edgeWorld(e);
      // (pressed down standing — on the ground, more when it lifts the front: the ground under its bottom
      // is pressed denser)
      if (ry > 0 && !moved && L.tilt > -0.45) {
        const b = L.lowWorld(new THREE.Vector3());
        if (b.y < this._bed(b) + R(0.03)) t.compactStep(e.x - f[0] * R(0.3), e.z - f[1] * R(0.3), f[0], f[1], L.bucketW, R(0.55), dt * (L.lift > 0.005 ? 1.2 : 0.4));
      }
      // tipped: it runs out over the lip as it tips — the more, the faster; into the body when it is
      // over it, else it falls and lands where it falls
      // (what it does not hold runs off its lip and its sides)
      if (L.tilt >= -0.45 && g.load > this.capNow * 1.02) this._spill(dt, e, f, g.load - this.capNow);
      if (L.tilt < -0.45 && g.load > 1e-9) this._pour(dt, e, f, hw);
      else if (this._intoTruck && g.load <= 1e-9) { this._intoTruck = false; app.ui?.toast(`В кузове ${(T.load * TRUCK_LOAD).toFixed(1).replace('.', ',')} из ${TRUCK_LOAD} м³`); }
      this._drag = moved > 0 && L.tilt > -0.45 && L.tilt < 0.15 && cutY < t.heightAt(e.x + f[0] * R(0.3), e.z + f[1] * R(0.3)) ? Math.min(1, g.load / this.cap) : 0;
      // (firm ground is heavy going: cutting it at ~0,1 m³/s it goes at half its speed)
      { const natV = ((g.natCut || 0) - nat0) * t.cellArea * MODEL_SCALE ** 3; if (natV > 0) this._drag = Math.min(1, Math.max(this._drag, natV / Math.max(dt, 1e-3) / 0.1)); }
      L.soil.material.setMix?.(this._mixW());
      L.load = Math.min(1, g.load / this.cap);
      app.sfx.scrapeLevel(0.15 + Math.min(0.5, Math.abs(this.v) / SPEED * 0.3 + L.load * 0.2));
      // (the grip: what is in front of the bucket, how full it is, how firm the ground it cuts)
      {
        let slip = 0;
        if (ly < 0) {
          const st = t.cell * 3, lw = L.lowWorld(new THREE.Vector3()), cy = Math.min(this.holdY ?? e.y, lw.y); let v = 0;
          for (let d = 0; d < R(0.7); d += st) for (let q = -hw; q <= hw; q += st) { const px = e.x + f[0] * d - f[1] * q, pz = e.z + f[1] * d + f[0] * q; if (!t.inside(px, pz)) continue; const o = t.heightAt(px, pz) - cy; if (o > 0) v += o; }
          // (an empty bucket goes into a loose heap easily, filling; a full one pushes what is in front of it — the windrow — and that is what stops it)
          const pileV = v * st * st * MODEL_SCALE ** 3, full = g.load >= this.capNow * 0.95 || L.tilt >= 0.15 || L.tilt <= -0.45,   // (shut or tipped right down it takes nothing in: all it meets is pushed)
           resist = pileV / (full ? 0.55 : 1.6) + (g.load / this.cap) * 0.2 + (this._drag || 0) * 0.4;
          slip = Math.max(0, Math.min(1, (resist - 1) / 0.6));
        }
        this._slip = (this._slip || 0) + (slip - (this._slip || 0)) * Math.min(1, dt * 3);
        if (this._slip > 0.6 && ly < 0) {
          // (spinning on the spot: the wheels turn, dig into the ground under them, throw it back)
          const spinD = -ly * SPEED * dt * this._slip;
          L.update(dt, moved + spinD * 0.8);
          if (app.journal.pending) for (const w of L.wheels.slice(2)) {
            const p = L.body.localToWorld(w.at.clone()), i = t.index(p.x, p.z);
            if (!g.free(i, p.x, p.z)) continue;
            // (≈2 cm a second, loose or firm; a hole no deeper than ~25 cm under the plot as it was)
            const tmp = (this._rutC ||= new Float64Array(4)), dig = Math.max(0, Math.min(R(0.0007) * this._slip, t.nat[i] + t.loose[i] - (t.orig[i] - R(0.25))));
            if (dig > 0) for (let a = -R(0.12); a <= R(0.12); a += t.cell) { const px = p.x - f[1] * a, pz = p.z + f[0] * a; if (t.inside(px, pz)) g.cut(t.index(px, pz), dig, tmp); }
            const bx = p.x - f[0] * R(0.6), bz = p.z - f[1] * R(0.6);
            for (const m of [0, 1, 2, 3]) if (tmp[m] > 0) { if (t.inside(bx, bz)) t.deposit(bx, bz, tmp[m] * t.cellArea, R(0.3), 0, m); tmp[m] = 0; }
            t._touch(Math.max(0, Math.floor(t.toCellX(p.x)) - 12), Math.max(0, Math.floor(t.toCellZ(p.z)) - 12), Math.min(t.rx, Math.ceil(t.toCellX(p.x)) + 12), Math.min(t.rz, Math.ceil(t.toCellZ(p.z)) + 12));
          }
          if (!this._slipSaid) { this._slipSaid = true; app.ui?.toast('Колёса буксуют — слишком много перед ковшом. Отъедьте и возьмите меньше'); setTimeout(() => (this._slipSaid = false), 6000); }
        } else L.update(dt, moved);
      }
    }
    const M = this.drv === 'truck' ? T : L, rig = app.rig;
    if (this.view === 'free') { this._mirrors(null); return; }   // (the camera left where it is)
    if (this.view === 'cab' || this.view === 'roof') {
      // from the driver's seat: looking ahead and down at where the bucket works (held still, no lag)
      const f = new THREE.Vector3(Math.cos(M.yaw), 0, -Math.sin(M.yaw)), roof = this.view === 'roof', seat = this.seatAt || (roof ? (this.drv === 'truck' ? [1.3, 2.75] : [0.85, 2.55]) : this.drv === 'truck' ? [1.45, 1.6] : [0.62, 1.75]);
      const e = new THREE.Vector3(seat[0] * R(1), seat[1] * R(1), 0).applyMatrix4(M.root.matrixWorld);
      const [la, ld] = this.lookAt || (roof ? (this.drv === 'truck' ? [5.5, 2.3] : [1.35, 2.4]) : this.drv === 'truck' ? [8, 1.2] : [2.6, 1.8]), ahead = R(la), drop = R(ld);   // (the loader: steep down — the bucket in the middle of the picture)
      rig.setState({ target: [e.x + f.x * ahead, e.y - drop, e.z + f.z * ahead], yaw: M.yaw - Math.PI / 2, pitch: Math.atan2(drop, ahead), dist: Math.hypot(ahead, drop) }, true);
      this._camYaw = null; rig.shakeKeep ??= rig.shake; rig.shake = false;
      this._fov(this.drv === 'truck' ? 70 : 92);   // (wide, as a camera in a cab: the bucket below and the way ahead both in sight)
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

  // too steep for it: up or down a slope over its limit, or across one (a loaded bucket held high
  // makes it tip sooner) — it stays where it was (keep: its pose before), with a word once
  _tooSteep(kind, M, keep) {
    const L = this.loader, high = kind === 'loader' ? Math.min(1, L.load) * Math.max(0, L.arm) : 0;
    const [pm, rm] = kind === 'truck' ? [0.35, 0.3 - 0.06 * (this.truck.load || 0)] : [0.45, 0.4 - 0.15 * high];
    const was = keep && this._slope?.[kind];
    const bad = Math.abs(M.pitch ?? 0) > pm || Math.abs(M.roll ?? 0) > rm;
    // (only a move that makes it steeper is stopped: from too steep it may go back)
    const worse = bad && (!was || Math.abs(M.pitch ?? 0) + Math.abs(M.roll ?? 0) > was + 1e-4);
    if (!worse) { (this._slope ||= {})[kind] = Math.abs(M.pitch ?? 0) + Math.abs(M.roll ?? 0); return false; }
    if (!this._steepSaid) { this._steepSaid = true; this.app.ui?.toast(Math.abs(M.roll ?? 0) > rm ? 'Слишком крутой склон поперёк — машина может опрокинуться' + (high > 0.2 ? ': опустите ковш' : '') : 'Слишком круто — машина туда не заедет'); setTimeout(() => (this._steepSaid = false), 4000); }
    return true;
  }
  // the wheels over loose material press it down: each pass a little more compact, a rut (the same
  // settling as under the plate compactor; the heavier machine, the more) — only within an action
  _tracks(kind, moved) {
    const app = this.app, t = app.terrain;
    if (!app.journal.pending) return;
    const pts = [], d = Math.max(Math.abs(moved), R(0.05));
    if (kind === 'loader') { const L = this.loader; for (const w of L.wheels) pts.push(L.body.localToWorld(w.at.clone())); }
    else { const T = this.truck; for (const w of T.wheels) for (const sz of [-1, 1]) pts.push(T.root.localToWorld(new THREE.Vector3(w.g.position.x, 0, sz * R(0.72)).add(new THREE.Vector3(0, 0, 0)))); }
    const M = kind === 'loader' ? this.loader : this.truck, fx = Math.cos(M.yaw), fz = -Math.sin(M.yaw);
    const gain = kind === 'loader' ? 0.3 : 0.3 + 0.25 * (this.truck.load || 0);   // (a pass of a wheel ≈ several of the plate)
    for (const p of pts) t.compactStep(p.x, p.z, fx, fz, R(0.28), d, gain);
  }
  // what the bucket does not hold any more (amount: carry units) — off its lip and its sides, as
  // crumbs falling: to the ground, or into the truck's body when it is over it
  _spill(dt, e, f, amount) {
    const app = this.app, t = app.terrain, g = this.grader, L = this.loader, T = this.truck, r = Math.random;
    const a = Math.min(amount, this.cap * 1.2 * dt), k = a / g.load, hw = L.bucketW / 2;
    for (const m of [0, 1, 2, 3]) {
      const q = g.carry[m] * k; if (q <= 0) continue;
      g.carry[m] -= q;
      const vol = q * t.cellArea, N = 6;
      for (let j = 0; j < N; j++) {
        // (mostly over the lip, some off the sides)
        const side = r() < 0.3, w = side ? (r() < 0.5 ? -1 : 1) * hw * 1.02 : (r() * 2 - 1) * hw * 0.9, back = side ? r() * R(0.5) : -R(0.03);
        const pos = new THREE.Vector3(e.x - f[1] * w - f[0] * back, e.y + R(0.25), e.z + f[0] * w - f[1] * back);
        const over = T?.root.visible && T.loaded ? T.root.worldToLocal(pos.clone()) : null, bb = T?.bodyBox;
        const inTruck = over && over.x > bb.min.x && over.x < bb.max.x && over.z > bb.min.z && over.z < bb.max.z;
        if (inTruck) { T.pourAt(pos, vol / N * MODEL_SCALE ** 3 / TRUCK_LOAD); app.particles.emit(pos, new THREE.Vector3(0, -R(0.2), 0), 0, R(0.03 + r() * 0.04), 0, 0, m); }
        else app.particles.emit(pos, new THREE.Vector3((r() - 0.5) * R(0.2), -R(0.1), (r() - 0.5) * R(0.2)), vol / N, R(0.03 + r() * 0.04), m === 1 ? 0 : 0.05, 0, m);
      }
    }
  }
  // what is under the bucket's bottom, above it, where it has been pressed into loose soil: out to its
  // sides (half each way), just past them
  _displace(e, f) {
    const t = this.app.terrain, g = this.grader, L = this.loader, by = L.lowWorld(new THREE.Vector3()).y, hw = L.bucketW / 2, st = t.cell * 0.7;
    if (by > Math.max(t.heightAt(e.x, e.z), t.heightAt(e.x - f[0] * R(0.3), e.z - f[1] * R(0.3)), t.heightAt(e.x - f[0] * R(0.6), e.z - f[1] * R(0.6))) + R(0.03)) return;   // (in the air)
    const side = (this._sideC ||= [new Float64Array(4), new Float64Array(4)]);
    let any = false, k = 0;
    for (let d = 0; d <= R(0.6); d += st) for (let q = -hw; q <= hw; q += st) {
      const px = e.x - f[0] * d - f[1] * q, pz = e.z - f[1] * d + f[0] * q;
      if (!t.inside(px, pz)) continue;
      const i = t.index(px, pz); if (!g.free(i, px, pz) || t.loose[i] <= 0) continue;
      const over = Math.min(t.nat[i] + t.loose[i] - by, t.loose[i]);
      if (over > 1e-6) { g.cut(i, over, side[q < 0 ? 0 : 1]); any = true; }
      k++;
    }
    if (!any) return;
    t._touch(Math.max(0, Math.floor(t.toCellX(e.x) - 30)), Math.max(0, Math.floor(t.toCellZ(e.z) - 30)), Math.min(t.rx, Math.ceil(t.toCellX(e.x) + 30)), Math.min(t.rz, Math.ceil(t.toCellZ(e.z) + 30)));
    for (const [s, c] of [[-1, side[0]], [1, side[1]]]) {
      const px = e.x - f[0] * R(0.3) - f[1] * s * (hw + R(0.15)), pz = e.z - f[1] * R(0.3) + f[0] * s * (hw + R(0.15));
      for (const m of [0, 1, 2, 3]) if (c[m] > 0) { if (t.inside(px, pz)) t.deposit(px, pz, c[m] * t.cellArea, R(0.25), 0, m); c[m] = 0; }
    }
  }
  // the firm ground under the loader's wheels (the plot, or what has been dug of it — not loose stuff
  // they run on, a layer being spread): what the bucket's height is held from
  _firmUnder() {
    const L = this.loader, t = this.app.terrain; let s = 0, n = 0;
    for (const w of L.wheels) { const p = L.body.localToWorld(w.at.clone()); if (!t.inside(p.x, p.z)) continue; const i = t.index(p.x, p.z); s += Math.min(t.heightAt(p.x, p.z), t.nat[i] + t.conc[i] + Math.max(0, t.top[i])); n++; }
    return n ? s / n : L.y;
  }
  // the lift of the loader's front that keeps its bucket on (not in) the ground
  _liftFor(t) {
    const L = this.loader, b = new THREE.Vector3();
    const ok = (lift) => { L.lift = lift; L.place(t, L.x, L.z, L.yaw); L.update(0); L.lowWorld(b); return b.y >= this._bed(b) - R(0.005); };
    if (ok(0)) return;
    let lo = 0, hi = 0.35;
    if (!ok(hi)) {
      // (the front as high as it goes: the arms and the bucket stay where they were — the stick does nothing more)
      const [a0, t0] = this._was || [L.arm, L.tilt];
      L.arm = Math.max(L.arm, a0); L.tilt = Math.max(L.tilt, t0); L.tiltGoal = Math.max(L.tiltGoal, L.tilt); this.armSet = L.armGoal = Math.max(L.armGoal, L.arm);
      ok(hi); return;
    }
    for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
    ok(hi);
  }
  // how low the bucket's lowest point can go at b: the top there, less what it sinks into loose
  // material (≤ 8 cm) or its nose cuts into firm ground (≤ 5 cm, tipped down)
  _bed(b) {
    const t = this.app.terrain, L = this.loader, T = this.truck;
    const i = t.index(b.x, b.z);
    let bed = t.heightAt(b.x, b.z) - Math.min(t.loose[i], R(0.08));
    // (on bare firm ground the bottom bears over its width and depth, not on one point: it rests where
    // most of the ground under it is — a narrow ridge of it, a lump, does not hold it up: it gets cut)
    if (t.loose[i] < R(0.01) && t.conc[i] <= 1e-6) {
      const fx = Math.cos(L.yaw), fz = -Math.sin(L.yaw), hw = L.bucketW / 2, hs = [];
      for (const u of [-0.25, 0, 0.25]) for (const v of [-0.8, -0.4, 0, 0.4, 0.8]) {
        const x = b.x + fx * R(u) - fz * hw * v, z = b.z + fz * R(u) + fx * hw * v;
        if (t.inside(x, z)) { const k = t.index(x, z); hs.push(t.nat[k] + t.conc[k] + Math.max(0, t.top[k])); }
      }
      hs.sort((p, q) => p - q);
      if (hs.length) bed = Math.min(bed, hs[Math.floor(hs.length * 0.6)]);
    }
    bed -= R(0.05) * Math.min(1, Math.max(0, -L.tilt / 0.3));
    // (on a wall, a post, a pallet's stack: on its top)
    bed = Math.max(bed, this._obstTop(b.x, b.z));
    // (over the truck: on its side's top, or inside the body on its floor — on the load in it)
    if (T?.loaded && T.root.visible) {
      const q = T.root.worldToLocal(b.clone()), bb = T.bodyBox, w = R(0.12);
      if (q.x > bb.min.x && q.x < bb.max.x && q.z > bb.min.z && q.z < bb.max.z) {
        const inner = q.x > bb.min.x + w && q.x < bb.max.x - w && q.z > bb.min.z + w && q.z < bb.max.z - w;
        bed = Math.max(bed, inner ? T.surfaceAt(b) : T.root.localToWorld(new THREE.Vector3(q.x, bb.max.y, q.z)).y);
      }
    }
    return bed;
  }
  // curling back with the edge in the soil: the strip just ahead of the edge, as wide as the bucket,
  // goes in down to the edge's height (a straight bite — not a round pit)
  _scoopStrip(e, f, hw) {
    const t = this.app.terrain, g = this.grader, st = t.cell * 0.7;
    this._scooped ||= new Set();
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (let d = -R(0.05); d <= R(0.3) && g.load < this.cap; d += st) for (let q = -hw; q <= hw; q += st) {
      const px = e.x + f[0] * d - f[1] * q, pz = e.z + f[1] * d + f[0] * q;
      if (!t.inside(px, pz)) continue;
      const i = t.index(px, pz); if (!g.free(i, px, pz)) continue;
      // (what is loose in front of it goes in; of firm ground only a sliver, ≤ 2 cm — curling in place
      // does not dig: the bucket is filled by driving into the heap)
      const sl = this._scooped.has(i) ? 0 : R(0.02); this._scooped.add(i);
      const over = Math.min(t.nat[i] + t.loose[i] - e.y, t.loose[i] + sl);
      if (over > 1e-7) { g.cut(i, Math.min(over, this.cap - g.load)); const ix = i % t.nx, iz = (i / t.nx) | 0; x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); z0 = Math.min(z0, iz); z1 = Math.max(z1, iz); }
    }
    if (x1 >= 0) t._touch(x0, z0, x1, z1);
  }
  // after the ground has slumped this frame: the pushing bucket's footprint cleared again
  afterRelax() {
    if (this.state !== 'drive') return;
    // (round the bucket the soil it piles up slumps to its angle of repose every frame, whatever the
    // phone's time for the rest of the ground: no walls of soil standing up in front of it)
    if (this._slumpAt) {
      const t = this.app.terrain, [x, z] = this._slumpAt, n = Math.ceil(R(1.8) / t.cell), cx = Math.round(t.toCellX(x)), cz = Math.round(t.toCellZ(z));
      const box = { x0: Math.max(0, cx - n), z0: Math.max(0, cz - n), x1: Math.min(t.rx, cx + n), z1: Math.min(t.rz, cz + n) }, keep = t.active;
      t.active = { ...box };
      // (on a time budget: what is not settled now goes on settling in the next frames — two or three
      // of them, unseen — instead of holding this one up)
      const t0 = performance.now();
      for (let k = 0; k < 24 && t.active && (k < 2 || performance.now() - t0 < 3.5); k++) t.relax(1);
      // (a heap tipped out of the body: its ridges, where the grid's slump leaves them, roll off a
      // little — loose grains run from each cell to a lower neighbour — so it stands round, as a cone)
      if (this._roundHeap) {
        const { nx: N, nat, loose } = t;
        for (let it = 0; it < 3; it++) for (let iz = box.z0 + 1; iz < box.z1; iz++) for (let ix = box.x0 + 1; ix < box.x1; ix++) {
          const i = iz * N + ix;
          if (loose[i] <= 0) continue;
          for (const j of [i + 1, i + N]) {
            const d = nat[i] + loose[i] - nat[j] - loose[j], src = d > 0 ? i : j, m = Math.min(Math.abs(d) * 0.12, loose[src]);
            if (m > 1e-8) t._move(src, d > 0 ? j : i, m);
          }
        }
        t._touch?.(box.x0, box.z0, box.x1, box.z1);
        this._roundHeap = false;
      }
      t.active = keep ? { x0: Math.min(keep.x0, box.x0), z0: Math.min(keep.z0, box.z0), x1: Math.max(keep.x1, box.x1), z1: Math.max(keep.z1, box.z1) } : t.active;
      this._slumpAt = null;
    }
    if (this._wallPass) { this._wallPass(); this._wallPass = null; }
    this._flushPush();
  }
  // what stands over the edge across the bucket, moved on ahead of it
  _bulldoze(x, z, f, hw, y, back = 0, looseOnly = false) {
    this._slumpAt = [x + f[0] * (R(0.35) + back), z + f[1] * (R(0.35) + back)];
    const t = this.app.terrain, g = this.grader, push = (this._pushC ||= new Float64Array(4));
    let any = false;
    for (let q = -hw; q <= hw; q += t.cell * 0.7) {
      const px = x - f[1] * q, pz = z + f[0] * q;
      if (!t.inside(px, pz)) continue;
      const i = t.index(px, pz);
      if (!g.free(i, px, pz)) continue;
      const over = Math.min(t.nat[i] + t.loose[i] - y, looseOnly ? t.loose[i] : Infinity);
      if (over > 1e-7) { g.cut(i, over, push); any = true; }
    }
    if (!any) return;
    const ix = Math.round(t.toCellX(x)), iz = Math.round(t.toCellZ(z)), n = Math.ceil(hw / t.cell) + 1;
    t._touch(Math.max(0, ix - n), Math.max(0, iz - n), Math.min(t.rx, ix + n), Math.min(t.rz, iz + n));
    // (right against the bucket's face, the width of it: a windrow growing there — it slumps out ahead and to the sides from there, not appearing far off)
    // (gathered: the passes of a frame push it to the same place — it is laid there once)
    const ax = x + f[0] * (R(0.35) + back), az = z + f[1] * (R(0.35) + back), P = this._pend;
    if (P && (Math.hypot(P.x - ax, P.z - az) > R(0.06) || P.hw !== hw)) this._flushPush();
    const Q = (this._pend ||= { x: ax, z: az, f: [f[0], f[1]], hw, v: new Float64Array(4) });
    for (const m of [0, 1, 2, 3]) { Q.v[m] += push[m]; push[m] = 0; }
  }
  // the windrow gathered this frame, laid against the bucket's face across its width
  _flushPush() {
    const P = this._pend; if (!P) return;
    this._pend = null;
    const t = this.app.terrain, { x, z, f, hw } = P;
    for (const m of [0, 1, 2, 3]) if (P.v[m] > 0) for (const q of [-0.6, -0.2, 0.2, 0.6]) { const ax = x - f[1] * hw * q, az = z + f[0] * hw * q; if (t.inside(ax, az)) t.deposit(ax, az, P.v[m] * t.cellArea / 4, R(0.18), 0, m); }
  }
  // what ran out of the tipped body this frame: a stream of it off the tailgate's lip down to the
  // ground, and there a heap — each material as it is mixed in the body — that grows up to the
  // tail and slumps to its angle (a cone, not a smear: it lands in one place)
  _tipOut(dt) {
    const app = this.app, t = app.terrain, T = this.truck, v = T.outflow || 0;
    T.outflow = 0;
    if (!(v > 0)) return;
    const lip = T.tailLip(new THREE.Vector3()), fx = Math.cos(T.yaw), fz = -Math.sin(T.yaw), r = Math.random;
    const gx = lip.x - fx * R(0.25), gz = lip.z - fz * R(0.25);
    // (the stream off the tailgate's lip, as wide as the gate opens, down onto the heap)
    { const col = new THREE.Color(0, 0, 0), mx = T.mix || [1, 0, 0, 0], tot = mx.reduce((a, v) => a + v, 0) || 1; for (let m = 0; m < 4; m++) { const c = BUCKET_COL[m]; col.r += c.r * mx[m] / tot; col.g += c.g * mx[m] / tot; col.b += c.b * mx[m] / tot; }
      (this.streams ||= new Streams(this.app.scene)).set(2, lip, new THREE.Vector3(gx, t.heightAt(gx, gz), gz), T.hz * 0.8, col, Math.min(1, v / (R(0.02) ** 3)), new THREE.Vector3(-fz, 0, fx)); }
    const mix = T.mix || [1, 0, 0, 0], tot = mix[0] + mix[1] + mix[2] + mix[3] || 1;
    for (const m of [0, 1, 2, 3]) {
      const a = v * mix[m] / tot; if (!(a > 0)) continue;
      // (the stream wanders across the gate's width as it runs: the heap grows round, not cut by the grid)
      const w = (r() * 2 - 1) * R(0.45), u = (r() - 0.3) * R(0.3), dx = gx - fz * w - fx * u, dz = gz + fx * w - fz * u;
      if (t.inside(dx, dz)) t.deposit(dx, dz, a, R(0.3), 0, m);
      // (the stream: crumbs off the lip, across the tailgate's width, falling)
      const n = Math.min(10, 2 + Math.round(a / (R(0.01) ** 3)));
      for (let j = 0; j < n; j++) {
        const w = (r() * 2 - 1) * T.hz * 0.45, pos = new THREE.Vector3(lip.x - fz * w, lip.y, lip.z + fx * w);
        app.particles.emit(pos, new THREE.Vector3(-fx * R(0.5) * (0.4 + r()), -R(0.4) * r(), -fz * R(0.5) * (0.4 + r())), 0, R(0.03 + r() * 0.05), m === 1 ? 0 : 0.05, 0, m);
      }
    }
    this._slumpAt = [gx, gz]; this._roundHeap = true;
    if (T.load < 0.003) { T.load = 0; T.hf.fill(0); }
  }
  // a frame of pouring: a share of each material out over the lip, as falling crumbs (they land
  // where they fall: the volume goes down there), or into the truck's body under it
  _pour(dt, e, f, hw) {
    const app = this.app, t = app.terrain, g = this.grader, T = this.truck, L = this.loader;
    const rate = Math.min(1, (-L.tilt - 0.45) / 0.45) * this.cap * 1.3 * dt, k = Math.min(1, rate / g.load);
    const q = T?.root.visible && T.loaded ? T.root.worldToLocal(e.clone()) : null, b = T?.bodyBox;
    const truck = q && q.x > b.min.x - R(0.1) && q.x < b.max.x + R(0.1) && q.z > b.min.z - R(0.25) && q.z < b.max.z + R(0.25);
    const r = Math.random, N = 10;
    // (the stream off the lip, down to where it lands — the load in the body, the ground)
    {
      const land = e.clone().add(new THREE.Vector3(f[0] * R(0.3), 0, f[1] * R(0.3)));
      land.y = truck ? Math.max(T.surfaceAt(land), T.root.localToWorld(new THREE.Vector3(0, b.min.y, 0)).y) : app.terrain.heightAt(land.x, land.z);
      if (g.load > 1e-9) (this.streams ||= new Streams(app.scene)).set(0, e.clone().add(new THREE.Vector3(f[0] * R(0.04), 0, f[1] * R(0.04))), land, hw * 1.7, this._mix(), Math.min(1, (-L.tilt - 0.45) / 0.45), new THREE.Vector3(-f[1], 0, f[0]));
    }
    for (const m of [0, 1, 2, 3]) {
      const a = g.carry[m] * k; if (a <= 0) continue;
      g.carry[m] -= a;
      const vol = a * t.cellArea;
      // (into the body as much as it takes; what it does not, runs over its side onto the ground)
      if (truck) {
        const room = Math.max(0, (1 - T.load) * TRUCK_LOAD / MODEL_SCALE ** 3), into = Math.min(vol, room), spill = vol - into;
        if (into > 0) { if (T.load < 0.02) T.mix = [0, 0, 0, 0]; T.mix[m] += into; T.soil.material.setMix?.(T.mix); T.pourAt(e.clone().add(new THREE.Vector3(f[0] * R(0.3), 0, f[1] * R(0.3))), into * MODEL_SCALE ** 3 / TRUCK_LOAD); this._intoTruck = true; }   // (a heap where it lands)
        if (spill > 0) { const sp = this._overSide(e); for (let j = 0; j < 4; j++) app.particles.emit(sp.clone().add(new THREE.Vector3((r() - 0.5) * R(0.6), 0, (r() - 0.5) * R(0.6))), new THREE.Vector3(0, -R(0.2), 0), spill / 4, R(0.03 + r() * 0.05), 0.05, 0, m); }
      }
      for (let j = 0; j < N; j++) {
        const w = (r() * 2 - 1) * hw * 0.9, pos = new THREE.Vector3(e.x - f[1] * w + f[0] * R(0.05), e.y + R(0.05), e.z + f[0] * w + f[1] * R(0.05));
        const vel = new THREE.Vector3(f[0] * R(0.4) * (0.5 + r()), -R(0.3) * r(), f[1] * R(0.4) * (0.5 + r()));
        app.particles.emit(pos, vel, truck ? 0 : vol / N, R(0.03 + r() * 0.05), m === 1 ? 0 : 0.05, 0, m);   // (a lump here and there; it rolls down)
      }
    }
    if (g.load < 1e-7) g.carry.fill(0);
  }
  // the shares of the materials in the bucket (soil, sand, g5, g20)
  _mixW() {
    const c = this.grader.carry, tot = c[0] + c[1] + c[2] + c[3], w = (this._mw ||= [1, 0, 0, 0]);
    if (tot > 0) for (let k = 0; k < 4; k++) w[k] = c[k] / tot;
    return w;
  }
  // where what runs over the truck's side lands: just outside the side nearest to p, level with it
  _overSide(p) {
    const T = this.truck, q = T.root.worldToLocal(p.clone()), bb = T.bodyBox;
    const out = q.z > (bb.min.z + bb.max.z) / 2 ? bb.max.z + R(0.35) : bb.min.z - R(0.35);
    return T.root.localToWorld(new THREE.Vector3(Math.max(bb.min.x, Math.min(bb.max.x, q.x)), bb.max.y, out));
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
