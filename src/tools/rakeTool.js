import * as THREE from 'three';
import { RAKE, KT as K } from '../config.js';

// Rake: drag a finger over the ground and the rake follows it, the head across
// the direction of the stroke. It cuts the top off heaps, drags the soil along
// in a small windrow that drops into hollows, breaks clods and leaves tine
// furrows. One stroke = one journal entry (undoable as a whole).
export class RakeTool {
  constructor(app, rake) {
    this.app = app;
    this.rake = rake;
    this.state = 'idle';
    this.dir = new THREE.Vector2(0, 1);     // stroke direction
    this.hdir = new THREE.Vector2(0, 1);    // handle direction (towards the person)
    this.last = null;
    this.lastP = new THREE.Vector3();
  }

  get busy() { return this.state !== 'idle'; }

  down(p) {
    const app = this.app, t = app.terrain;
    if (this.state !== 'idle' || !t.inside(p.x, p.z)) return this.state !== 'idle';
    app.journal.begin('rake', { tool: 'rake' }, app.clock);
    this.stroke = {
      width: RAKE.width, band: t.cell * 2.2, bite: RAKE.bite, reach: RAKE.tineLen * 0.9, climb: RAKE.climb, push: RAKE.push,
      L: null, S: 0, swept: [], vAt: (this._vAt ||= new Float32Array(t.nat.length)).fill(NaN), moved: 0,
    };
    this.path = [];
    this.state = 'rake';
    this.started = false;
    this.pull = 1;
    this.last = p.clone();
    // until the finger moves, the head lies across the view
    const cam = app.camera.position;
    this.hdir.set(cam.x - p.x, cam.z - p.z).normalize();
    this.dir.copy(this.hdir);
    this._pose(p);
    app.sfx.scrapeStart();
    return true;
  }

  move(p) {
    if (this.state !== 'rake') return;
    const t = this.app.terrain;
    const d = new THREE.Vector2(p.x - this.last.x, p.z - this.last.z);
    const len = d.length(), step = t.cell * 0.6;
    if (len < step) { this._pose(p); return; }
    d.divideScalar(len);
    this.dir.copy(this.started ? this.dir.clone().lerp(d, 0.3).normalize() : d);
    this.started = true;
    // the handle points to the person: along the stroke when pulling, against it when pushing
    const cam = this.app.camera.position;
    const c = new THREE.Vector2(cam.x - p.x, cam.z - p.z).normalize();
    const along = this.dir.dot(c);
    if (along > 0.25) this.pull = 1; else if (along < -0.25) this.pull = -1;
    this.hdir.copy(this.dir).multiplyScalar(this.pull);
    const n = Math.ceil(len / step), q = new THREE.Vector3();
    let moved = 0;
    for (let k = 1; k <= n; k++) {
      q.lerpVectors(this.last, p, k / n);
      if (!t.inside(q.x, q.z)) continue;
      moved += t.rakeStep(this.stroke, q.x, q.z, this.dir.x, this.dir.y, len / n);
      t.relax(1);   // the windrow slumps as it rolls
      this.app.particles.rakeClods(q.x, q.z, this.dir.x, this.dir.y, RAKE.width / 2, this.stroke.band, this.stroke.band + t.cell * 2, 0.0006 * K);
    }
    this.stroke.moved += moved;
    this.app.sfx.scrapeLevel(Math.min(0.8, 0.12 + moved * 4e5));
    if (this.path.length === 0 || Math.hypot(p.x - this.path[this.path.length - 1][0], p.z - this.path[this.path.length - 1][1]) > 0.003) {
      this.path.push([+p.x.toFixed(5), +p.z.toFixed(5)]);
    }
    this.last.copy(p);
    this._pose(p);
  }

  up() { if (this.state === 'rake') this.finish(); }
  interrupt() { this.up(); }

  // lift the rake: furrows behind the tines, let the windrow settle, journal it
  finish() {
    if (this.state !== 'rake') return;
    const app = this.app, t = app.terrain;
    app.sfx.scrapeStop();
    this.state = 'idle';
    if (this.stroke.swept.length) t.rakeGrooves(this.stroke, RAKE.width / (RAKE.tines - 1), RAKE.groove);
    for (let i = 0; i < 40000 && t.active; i++) t.relax(1);
    const m = app.journal.pending?.meta;
    if (m) { m.path = this.path; m.volume = this.stroke.moved; }
    app.journal.commit(app.clock);
    this.rest(this.last);
    app.ui?.refresh();
  }

  // undo while raking: drop the stroke
  abort() {
    if (this.state !== 'rake') return false;
    this.app.sfx.scrapeStop();
    this.app.journal.cancel();
    this.state = 'idle';
    this.rest(this.last);
    return true;
  }

  update() {}

  _pose(p) {
    const t = this.app.terrain, s = this.stroke;
    // tine tips on the line the head rests on (or on the ground before the first step)
    const y = s && s.L !== null ? s.L - s.bite : t.heightAt(p.x, p.z) - RAKE.bite;
    this.lastP.set(p.x, y, p.z);
    this.rake.setPose({ pos: this.lastP, dir: this.hdir, lift: 0.62 });
  }

  // put down near the front right corner: tines in the soil, the handle lying
  // on the ground along the front edge
  putDown() {
    const t = this.app.terrain, R = RAKE;
    const x = t.halfX - 0.009 * K, z = t.halfZ - 0.022 * K, xe = x - R.handle * 0.95;
    const y = t.heightAt(x, z) + 0.0004 * K, ye = t.heightAt(xe, z) + 0.0013 * K;
    const rise = R.tineLen + 0.0045 * K;   // socket above the tine tips
    this.rake.setPose({ pos: new THREE.Vector3(x, y, z), dir: new THREE.Vector2(-1, 0), lift: Math.asin(Math.max(-0.5, Math.min(0.5, (ye - y - rise) / R.handle))) });
    this.hdir.set(-1, 0);
    this.last = new THREE.Vector3(x, y, z);
  }

  // lying where it was left: tines on the ground, handle raised a little
  rest(p) {
    const t = this.app.terrain;
    const h = t.inside(p.x, p.z) ? t.heightAt(p.x, p.z) : 0.1;
    this.rake.setPose({ pos: new THREE.Vector3(p.x, h + 0.0005 * K, p.z), dir: this.hdir, lift: 0.5 });
  }
}
