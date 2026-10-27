import * as THREE from 'three';
import { KT as K } from '../config.js';
import { materialTint } from '../world/soilColor.js';

// crumb size and how many stay visible on top, per material (soil, sand, 5–20, 20–40)
const CRUMB = [1, 0.55, 0.8, 1.45], KEEP = [0.32, 0, 0, 0];   // only soil leaves clods on top
const CONC = 9;              // fresh concrete on the blade (material id of the tint)
CRUMB[CONC] = 1.3; KEEP[CONC] = 0;

// Scoop workflow, shared by the hand shovel and the excavator bucket:
//   swipe on the ground  → the blade cuts a layer (bite) along the swipe until
//                          it is full, then lifts with the soil on it
//   touch somewhere      → the loaded implement follows the finger
//   release              → it tips and the soil pours onto the ground
// One swipe + its dump = one "scoop" in the journal (undoable as a whole).
// The implement (shovel / excavator) supplies sizes, reach and poses:
//   spec, bite, name, clampReach(p), initialDir(p, camDir), digDir(p, dragDir),
//   poseDig(p, dir, cutY, first), poseAim(p, dir, groundY), poseDump(dir),
//   poseRest(p, dir), fill, bladePoint(u, v), bladeNormal(), visibleNow
export class ScoopTool {
  constructor(app, imp) {
    this.app = app;
    this.imp = imp;
    this.state = 'idle';
    this.load = 0;
    this.last = null;
    this.dir = new THREE.Vector2(0, -1);
    this.dumpT = 0;
    this.emitted = 0;
    this.settleT = 0;
    this.lastP = new THREE.Vector3(0, 0.05, 0);
    this.path = [];
  }

  get spec() { return this.imp.spec; }
  get capacity() { return this.spec.capacity; }
  get busy() { return this.state !== 'idle'; }

  // ---- input -------------------------------------------------------------------
  down(p) {
    const { app, imp } = this;
    p = imp.clampReach(p.clone());
    if (this.state === 'loaded') { this.state = 'aim'; this.aim(p); return true; }
    // (the last throw still landing: it lands at once — the next cut does not wait for it)
    if (this.state === 'dump' || this.state === 'settle') this.finish(true);
    if (this.state !== 'idle') return true;
    const camDir = new THREE.Vector3();
    app.camera.getWorldDirection(camDir);
    this.dir.copy(imp.initialDir(p, new THREE.Vector2(camDir.x, camDir.z).normalize()));
    app.journal.begin('scoop', { tool: imp.name, bite: imp.bite }, app.clock);
    app.terrain.resetTake(); this._loadShown = null;   // remember which layer the blade cuts (colour of the load)
    this.snap = app.journal.pending.snap;
    this.load = 0;
    this.path = [];
    this.state = 'dig';
    this.last = p.clone();
    // the blade scrapes level: one cut height for the whole stroke
    this.cutY = this._snapHeight(p.x, p.z) - imp.bite;
    app.sfx.stab();
    app.sfx.scrapeStart();
    this._pose(p, true);
    this._stamp(p);
    return true;
  }

  move(p) {
    p = this.imp.clampReach(p.clone());
    if (this.state === 'aim') { this.aim(p); return; }
    if (this.state !== 'dig') return;
    const d = new THREE.Vector2(p.x - this.last.x, p.z - this.last.z);
    const len = d.length();
    const step = this.app.terrain.cell * 0.6;
    if (len < step) { this._pose(p); return; }
    d.divideScalar(len);
    this.dir.copy(this.imp.digDir(p, d, this.dir));
    const n = Math.ceil(len / step);
    const q = new THREE.Vector3();
    let speed = 0;
    for (let k = 1; k <= n && this.state === 'dig'; k++) {
      q.lerpVectors(this.last, p, k / n);
      speed += this._stamp(q);
    }
    this.app.sfx.scrapeLevel(Math.min(1, speed / this.capacity * 25 + 0.15));
    this.last.copy(p);
    if (this.state === 'dig') this._pose(p);
  }

  up() {
    if (this.state === 'dig') this._lift();
    else if (this.state === 'aim') this._startDump();
  }

  // a second finger arrived: stop cutting but keep what is on the blade
  interrupt() {
    if (this.state === 'dig') this._lift();
    else if (this.state === 'aim') this.state = 'loaded';
  }

  aim(p) {
    const app = this.app;
    this.lastP.copy(p);
    const h = app.terrain.inside(p.x, p.z) ? app.terrain.heightAt(p.x, p.z) : 0;
    this.imp.poseAim(p, this.dir, h);
  }

  // ---- internals -------------------------------------------------------------------
  _snapHeight(x, z) {
    const t = this.app.terrain, s = this.snap;
    let cx = Math.min(Math.max(t.toCellX(x), 0), t.rx - 1e-4), cz = Math.min(Math.max(t.toCellZ(z), 0), t.rz - 1e-4);
    const ix = Math.floor(cx), iz = Math.floor(cz), fx = cx - ix, fz = cz - iz, n = t.nx, i = iz * n + ix;
    const H = (k) => s.nat[k] + s.loose[k];
    return (H(i) * (1 - fx) + H(i + 1) * fx) * (1 - fz) + (H(i + n) * (1 - fx) + H(i + n + 1) * fx) * fz;
  }

  // cut height at a point: the stroke's level, but inside the setting-out
  // never below the design grade (when "stop at design grade" is on)
  _cutAt(p) {
    const app = this.app;
    let y = Math.max(this.cutY, app.terrain.floorY);
    if (app.settings.stopAtGrade) { const g = app.gradeAt(p.x, p.z); if (g !== null) y = Math.max(y, g); }
    return y;
  }

  _stamp(p) {
    const app = this.app, t = app.terrain;
    if (!t.inside(p.x, p.z)) return 0;
    const cutY = this._cutAt(p);
    const got = t.carve(p.x, p.z, this.dir.x, this.dir.y, this.spec, cutY, this.capacity - this.load, t.take.c > 0);
    if (got > 0) {
      this.load += got;
      // the heap on the blade is what it cut (sand / stone / soil) from the first bite
      const m = t.takenMaterials(), k = t.takenConcrete() > 0 ? 9 : m.indexOf(Math.max(...m));
      if (k !== this._loadShown && this.imp.setLoad) { this._loadShown = k; this.imp.setLoad(k, t.takenDepth()); }
      if (this.path.length === 0 || Math.hypot(p.x - this.path[this.path.length - 1][0], p.z - this.path[this.path.length - 1][1]) > 0.002) {
        this.path.push([+p.x.toFixed(5), +p.z.toFixed(5), +cutY.toFixed(5)]);
      }
      // a few crumbs kicked up by the blade (visual only, no volume)
      if (Math.random() < 0.5) {
        const v = new THREE.Vector3(this.dir.x * 0.12 + (Math.random() - 0.5) * 0.1, 0.25 + Math.random() * 0.2, this.dir.y * 0.12 + (Math.random() - 0.5) * 0.1);
        app.particles.emit(new THREE.Vector3(p.x, t.heightAt(p.x, p.z) + 0.001, p.z), v, 0, 0.0006 * K, 0);
      }
    }
    this.imp.fill = this.load / this.capacity;
    if (this.load >= this.capacity * 0.995) this._lift();
    return got;
  }

  _pose(p, first = false) {
    const t = this.app.terrain;
    const cutY = t.inside(p.x, p.z) ? Math.min(this._cutAt(p), this._snapHeight(p.x, p.z)) : 0;
    this.imp.poseDig(p, this.dir, cutY, first);
  }

  _lift() {
    const app = this.app;
    app.sfx.scrapeStop();
    if (this.load <= 1e-9) {
      // nothing cut (e.g. touched the tray floor): drop the empty action
      app.journal.cancel();
      this.state = 'idle';
      this._rest(this.last || this.lastP);
      return;
    }
    this.state = 'loaded';
    this.depth = app.terrain.takenDepth();
    // what is on the blade: share of each material (cut top-down: sand, stone, soil…)
    const m = app.terrain.takenMaterials();
    while (m.length <= CONC) m.push(0);
    m[CONC] = app.terrain.takenConcrete();   // fresh concrete: poured back as concrete
    const sum = m.reduce((a, b) => a + b, 0) || 1;
    this.share = m.map((x) => x / sum);
    this.mat = this.share.indexOf(Math.max(...this.share));
    const soil = this.share.slice(0, CONC);
    this.soilMat = soil.indexOf(Math.max(...soil));
    this.concOut = 0;
    if (this.imp.setLoad) this.imp.setLoad(this.mat, this.depth); else if (this.imp.loadMat) materialTint(this.mat, this.depth, this.imp.loadMat.color);
    this._loadShown = null;
    this.lastP.copy(this.last);
    this.aim(this.last);
    app.onShovelState?.();
  }

  _startDump() {
    this.state = 'dump';
    this.dumpT = 0;
    this.emitted = 0;
    this.total = Math.round(70 + 170 * Math.min(1, this.load / this.capacity));
    const app = this.app;
    this.imp.poseDump(this.dir, this.lastP);
    app.sfx.pour(Math.min(1, this.load / this.capacity));
    const m = app.journal.pending?.meta;
    if (m) { m.path = this.path; m.dump = [+this.lastP.x.toFixed(5), +this.lastP.z.toFixed(5)]; m.volume = this.load; }
    app.onShovelState?.();
  }

  _rest(p) { this.imp.poseRest(p, this.dir); }

  // the concrete on the blade slides off as a soft lump where it is tipped
  _dropConc() {
    if (!(this.concOut > 0)) return;
    const t = this.app.terrain;
    t.depositConc(t.clampX(this.lastP.x), t.clampZ(this.lastP.z), this.concOut, 0.0045 * K, 0);   // it slumps while the shovel settles
    this.concOut = 0;
  }

  // material of the crumb at fraction f of the load: the main material comes out
  // last, so a shovel of sand leaves sand on top even with some soil in it
  _matAt(f) {
    const sh = this.share || [1], main = this.mat || 0;
    let acc = 0;
    for (let k = 0; k < sh.length; k++) { if (k === main) continue; acc += sh[k]; if (f < acc) return k; }
    return main;
  }

  update(dt) {
    const app = this.app;
    if (this.state === 'dump') {
      this.dumpT += dt;
      const s = this.imp;
      if (this.dumpT > (s.dumpDelay ?? 0.12)) {
        const want = Math.min(this.total, Math.floor((this.dumpT - (s.dumpDelay ?? 0.12)) / (s.dumpTime ?? 0.38) * this.total));
        const per = this.load / this.total;
        const n = new THREE.Vector3();
        s.bladeNormal(n);
        while (this.emitted < want) {
          const r = Math.random;
          const pos = s.bladePoint(r() * 2 - 1, r());
          const v = n.clone().multiplyScalar((0.05 + r() * 0.08) * Math.sqrt(K)).add(new THREE.Vector3((r() - 0.5) * 0.08, -0.05, (r() - 0.5) * 0.08));
          // the load is poured material by material in proportion
          const mat = this._matAt(this.emitted / this.total);
          if (mat === CONC) {
            // concrete falls as a lump (its volume goes in below); these are only splashes
            this.concOut += per;
            if (r() < 0.35) app.particles.emit(pos, v, 0, (0.0009 + Math.pow(r(), 2) * 0.0016) * K, 0, 0, CONC);
            this.emitted++;
            continue;
          }
          app.particles.emit(pos, v, per, (0.0007 + Math.pow(r(), 3) * 0.0014) * K * (s.crumbScale ?? 1) * CRUMB[mat], KEEP[mat], this.depth || 0, mat);
          this.emitted++;
        }
        s.fill = Math.max(0, 1 - this.emitted / this.total) * (this.load / this.capacity);
        this._dropConc();
      }
      if (this.emitted >= this.total) {
        this.state = 'settle';
        this.settleT = 0;
        s.fill = 0;
        this.load = 0;
        this._rest(new THREE.Vector3(this.lastP.x - this.dir.x * 0.025 * K, 0, this.lastP.z - this.dir.y * 0.025 * K));
        app.onShovelState?.();
      }
    } else if (this.state === 'settle') {
      this.settleT += dt;
      if ((!app.particles.busy && !app.terrain.active) || this.settleT > 6) this.finish();
    }
  }

  // land everything, let the pile come to rest and commit the scoop
  finish(quick = false) {
    const app = this.app;
    if (this.state === 'dump') {
      // emit what is left instantly
      // pour the rest straight onto the chosen spot (the model may still be on its way)
      const rest = this.load * (this.total - this.emitted) / this.total;
      const t = app.terrain;
      const x = t.clampX(this.lastP.x), z = t.clampZ(this.lastP.z);
      const rc = rest * (this.share?.[CONC] || 0);
      this.concOut = (this.concOut || 0) + rc;
      this._dropConc();
      if (rest - rc > 0) t.deposit(x, z, rest - rc, 0.004 * K, this.depth || 0, this.soilMat || 0);
      this.emitted = this.total;
    }
    if (this.state === 'dump' || this.state === 'settle') {
      app.particles.flush();
      // (the next cut started: what is still sliding goes on in the frames after — a long loop here froze the game)
      const t0 = performance.now();
      for (let i = 0; i < 40000 && app.terrain.active && (!quick || performance.now() - t0 < 4); i++) app.terrain.relax(1);
      // tipped concrete: let it slump, then it stays (undo stays exact)
      for (let i = 0; i < 60 && app.terrain.cActive; i++) app.terrain.concStep(1 / 30, 2);
      app.terrain.cActive = null;
      app.journal.commit(app.clock);
      this.state = 'idle';
      this.load = 0;
      this.imp.fill = 0;
      app.onShovelState?.();
    }
  }

  // undo while the scoop is still in progress
  abort() {
    if (this.state === 'dump' || this.state === 'settle') { this.finish(); return false; }
    if (this.state === 'aim' && this.app.gestures?.mode === 'tool') { this.state = 'loaded'; this.aim(this.lastP); return true; }
    if (this.state !== 'idle') {
      this.app.sfx.scrapeStop();
      this.app.journal.cancel();
      this.state = 'idle';
      this.load = 0;
      this.imp.fill = 0;
      this._rest(this.lastP);
      this.app.onShovelState?.();
      return true;
    }
    return false;
  }
}
