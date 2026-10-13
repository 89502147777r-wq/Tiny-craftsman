import * as THREE from 'three';

// Shovel workflow:
//   swipe on the ground  → the blade cuts a layer (bite) along the swipe until
//                          the blade is full, then lifts with the soil on it
//   touch somewhere      → the loaded shovel follows the finger
//   release              → the shovel tips and the soil pours onto the ground
// One swipe + its dump = one "scoop" in the journal (undoable as a whole).
export class ShovelTool {
  constructor(app) {
    this.app = app;
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

  get spec() { return this.app.shovel.spec; }
  get capacity() { return this.spec.capacity; }
  get busy() { return this.state !== 'idle'; }

  // ---- input -------------------------------------------------------------------
  down(p) {
    const { app } = this;
    if (this.state === 'loaded') { this.state = 'aim'; this.aim(p); return; }
    if (this.state !== 'idle') return;
    const camDir = new THREE.Vector3();
    app.camera.getWorldDirection(camDir);
    this.dir.set(camDir.x, camDir.z).normalize();
    app.journal.begin('scoop', { shovel: app.shovel.type, bite: app.settings.bite }, app.clock);
    this.snap = app.journal.pending.snap;
    this.load = 0;
    this.path = [];
    this.state = 'dig';
    this.last = p.clone();
    app.sfx.stab();
    app.sfx.scrapeStart();
    this._pose(p, 0.5, true);
    this._stamp(p);
  }

  move(p) {
    if (this.state === 'aim') { this.aim(p); return; }
    if (this.state !== 'dig') return;
    const d = new THREE.Vector2(p.x - this.last.x, p.z - this.last.z);
    const len = d.length();
    const step = this.app.terrain.cell * 0.6;
    if (len < step) { this._pose(p, 0.95); return; }
    d.divideScalar(len);
    this.dir.lerp(d, 0.35).normalize();
    const n = Math.ceil(len / step);
    const q = new THREE.Vector3();
    let speed = 0;
    for (let k = 1; k <= n && this.state === 'dig'; k++) {
      q.lerpVectors(this.last, p, k / n);
      speed += this._stamp(q);
    }
    this.app.sfx.scrapeLevel(Math.min(1, speed / this.capacity * 25 + 0.15));
    this.last.copy(p);
    if (this.state === 'dig') this._pose(p, 0.95);
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
    app.shovel.setPose({ pos: new THREE.Vector3(p.x - this.dir.x * 0.006, h + 0.022, p.z - this.dir.y * 0.006), dir: this.dir, tilt: 1.02, roll: 0 });
  }

  // ---- internals -------------------------------------------------------------------
  _snapHeight(x, z) {
    const t = this.app.terrain, s = this.snap;
    let cx = Math.min(Math.max(t.toCell(x), 0), t.res - 1e-4), cz = Math.min(Math.max(t.toCell(z), 0), t.res - 1e-4);
    const ix = Math.floor(cx), iz = Math.floor(cz), fx = cx - ix, fz = cz - iz, n = t.n, i = iz * n + ix;
    const H = (k) => s.nat[k] + s.loose[k];
    return (H(i) * (1 - fx) + H(i + 1) * fx) * (1 - fz) + (H(i + n) * (1 - fx) + H(i + n + 1) * fx) * fz;
  }

  _stamp(p) {
    const app = this.app, t = app.terrain;
    if (!t.inside(p.x, p.z)) return 0;
    const cutY = this._snapHeight(p.x, p.z) - app.settings.bite / 1000;
    const got = t.carve(p.x, p.z, this.dir.x, this.dir.y, this.spec, cutY, this.capacity - this.load);
    if (got > 0) {
      this.load += got;
      if (this.path.length === 0 || Math.hypot(p.x - this.path[this.path.length - 1][0], p.z - this.path[this.path.length - 1][1]) > 0.002) {
        this.path.push([+p.x.toFixed(5), +p.z.toFixed(5), +cutY.toFixed(5)]);
      }
      // a few crumbs kicked up by the blade (visual only, no volume)
      if (Math.random() < 0.5) {
        const v = new THREE.Vector3(this.dir.x * 0.12 + (Math.random() - 0.5) * 0.1, 0.25 + Math.random() * 0.2, this.dir.y * 0.12 + (Math.random() - 0.5) * 0.1);
        app.particles.emit(new THREE.Vector3(p.x, t.heightAt(p.x, p.z) + 0.001, p.z), v, 0, 0.0006, 0);
      }
    }
    this.app.shovel.fill = this.load / this.capacity;
    if (this.load >= this.capacity * 0.995) this._lift();
    return got;
  }

  _pose(p, tilt, snap = false) {
    const app = this.app, t = app.terrain, L = this.spec.length;
    const cutY = t.inside(p.x, p.z) ? Math.max(this._snapHeight(p.x, p.z) - app.settings.bite / 1000, t.floorY) : 0;
    const tip = new THREE.Vector3(p.x + this.dir.x * L * 0.28, cutY + 0.0004, p.z + this.dir.y * L * 0.28);
    app.shovel.setPose({ pos: tip, dir: this.dir, tilt, roll: 0 }, snap && !app.shovel.root.visible);
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
    app.shovel.setPose({ tilt: 1.12, roll: 1.75 });
    app.sfx.pour(Math.min(1, this.load / this.capacity));
    const m = app.journal.pending?.meta;
    if (m) { m.path = this.path; m.dump = [+this.lastP.x.toFixed(5), +this.lastP.z.toFixed(5)]; m.volume = this.load; }
    app.onShovelState?.();
  }

  _rest(p) {
    const app = this.app, t = app.terrain;
    const h = t.inside(p.x, p.z) ? t.heightAt(p.x, p.z) : 0;
    app.shovel.setPose({ pos: new THREE.Vector3(p.x, h + 0.004, p.z), tilt: 0.28, roll: 0 });
  }

  update(dt) {
    const app = this.app;
    if (this.state === 'dump') {
      this.dumpT += dt;
      const s = app.shovel;
      if (this.dumpT > 0.12) {
        const want = Math.min(this.total, Math.floor((this.dumpT - 0.12) / 0.38 * this.total));
        const per = this.load / this.total;
        const n = new THREE.Vector3();
        s.bladeNormal(n);
        while (this.emitted < want) {
          const r = Math.random;
          const pos = s.bladePoint(r() * 2 - 1, r());
          const v = n.clone().multiplyScalar(0.05 + r() * 0.08).add(new THREE.Vector3((r() - 0.5) * 0.08, -0.05, (r() - 0.5) * 0.08));
          app.particles.emit(pos, v, per, 0.0007 + Math.pow(r(), 3) * 0.0014, 0.32);
          this.emitted++;
        }
        s.fill = Math.max(0, 1 - this.emitted / this.total) * (this.load / this.capacity);
      }
      if (this.emitted >= this.total) {
        this.state = 'settle';
        this.settleT = 0;
        s.fill = 0;
        this.load = 0;
        this._rest(new THREE.Vector3(this.lastP.x - this.dir.x * 0.025, 0, this.lastP.z - this.dir.y * 0.025));
      }
    } else if (this.state === 'settle') {
      this.settleT += dt;
      if ((!app.particles.busy && !app.terrain.active) || this.settleT > 6) this.finish();
    }
  }

  // land everything, let the pile come to rest and commit the scoop
  finish() {
    const app = this.app;
    if (this.state === 'dump') {
      // emit what is left instantly
      while (this.emitted < this.total) {
        const pos = app.shovel.bladePoint(Math.random() * 2 - 1, Math.random());
        app.terrain.deposit(pos.x, pos.z, this.load / this.total, 0.002);
        this.emitted++;
      }
    }
    if (this.state === 'dump' || this.state === 'settle') {
      app.particles.flush();
      for (let i = 0; i < 40000 && app.terrain.active; i++) app.terrain.relax(1);
      app.journal.commit(app.clock);
      this.state = 'idle';
      this.load = 0;
      app.shovel.fill = 0;
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
      this.app.shovel.fill = 0;
      this._rest(this.lastP);
      this.app.onShovelState?.();
      return true;
    }
    return false;
  }
}
