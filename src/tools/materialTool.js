import * as THREE from 'three';
import { MATERIALS, DELIVERY, BUCKET, MODEL_SCALE, K } from '../config.js';

// Sand / crushed stone, brought the way it is on a real site:
//   «Завезти» — tap the plot: a heap of the chosen size (0.25…2 m³ real) is
//              tipped there like from a dump truck; then shovel it into the pit
//              and level it with the rake
//   «Ведро»   — hold a finger down: a 10 l bucket pours where the finger is
//              (one bucket per 2 s), for exact work
// One delivery / one pour = one journal entry. Volumes are exact: every crumb
// carries its share to the heightfield.
const CRUMB = [1, 0.55, 0.8, 1.45], KEEP = [0, 0, 0, 0];   // stones show in the texture; crumbs only fly
const real = (m3) => m3 / MODEL_SCALE ** 3;   // real m³ → model m³

export class MaterialTool {
  constructor(app, mat) {
    this.app = app;
    this.mat = mat;
    this.state = 'idle';
    this.p = new THREE.Vector3();
  }

  get busy() { return this.state !== 'idle'; }
  get mode() { return this.app.settings.matMode || 'deliver'; }
  get name() { return MATERIALS[this.mat].name; }

  down(p) {
    const app = this.app, t = app.terrain;
    if (this.state !== 'idle') return true;
    if (!t.inside(p.x, p.z)) return false;
    this.p.copy(p);
    const m3 = this.mode === 'deliver' ? app.settings.delivery : 0;
    app.journal.begin(this.mode === 'deliver' ? 'deliver' : 'bucket', { material: MATERIALS[this.mat].id, m3: m3 || undefined, at: [+p.x.toFixed(4), +p.z.toFixed(4)] }, app.clock);
    this.poured = 0;
    this.t = 0;
    if (this.mode === 'deliver') {
      // a heap: the bigger, the longer it takes to tip
      this.total = real(m3);
      this.duration = 1.4 + 1.2 * Math.sqrt(m3);
      this.crumbs = Math.round(260 + 260 * Math.sqrt(m3));
      this.drop = 0.16 + 0.06 * Math.sqrt(m3);   // height of the truck body above the ground
      this.spread = 0.012 + 0.02 * Math.sqrt(m3);
      this.state = 'pour';
    } else {
      this.total = Infinity;               // until the finger is lifted
      this.rate = real(BUCKET) / 3;        // one wheelbarrow per 3 s
      this.drop = 0.035 * K;
      this.spread = 0.004 * K;
      this.state = 'bucket';
    }
    app.sfx.pour(0.8);
    return true;
  }

  move(p) { if (this.state === 'bucket' && this.app.terrain.inside(p.x, p.z)) this.p.copy(p); }

  up() {
    if (this.state === 'bucket') this._settle();
  }

  interrupt() { this.up(); }

  update(dt) {
    const app = this.app;
    if (this.state === 'pour' || this.state === 'bucket') {
      this.t += dt;
      let want;
      if (this.state === 'pour') want = Math.min(this.total, this.total * Math.min(1, this.t / this.duration));
      else want = this.poured + this.rate * dt;
      const vol = want - this.poured;
      if (vol > 0) {
        // the volume goes straight into the heightfield as a soft splat (a crumb
        // carrying a whole heap's share would make a needle); the crumbs are the look
        const t = app.terrain;
        // splat about a third of the final cone's radius: the heap needs little settling
        const cone = Math.cbrt(3 * Math.min(this.total, this.poured + this.rate * 4 || this.total) / (Math.PI * MATERIALS[this.mat].repose));
        // the truck body empties unevenly: the stream wanders a little
        const j = this.state === 'pour' ? cone * 0.25 : 0, ja = Math.random() * Math.PI * 2, jr = Math.random() * j;
        t.deposit(this.p.x + Math.cos(ja) * jr, this.p.z + Math.sin(ja) * jr, vol, Math.max(this.spread * 0.7 + t.cell, cone * 0.35), 0, this.mat);
        const per = this.state === 'pour' ? this.total / this.crumbs : this.rate / 90;
        let n = Math.min(40, Math.max(1, Math.round(vol / per)));
        const r = Math.random;
        const ground = t.heightAt(this.p.x, this.p.z);
        while (n-- > 0) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * this.spread;
          const pos = new THREE.Vector3(this.p.x + Math.cos(a) * d, ground + this.drop * (0.8 + r() * 0.4), this.p.z + Math.sin(a) * d);
          const v = new THREE.Vector3((r() - 0.5) * 0.08, -0.3 - r() * 0.3, (r() - 0.5) * 0.08);
          const size = (0.0006 + Math.pow(r(), 3) * 0.0012) * K * CRUMB[this.mat];
          app.particles.emit(pos, v, 0, size, KEEP[this.mat], 0, this.mat);
        }
        this.poured = want;
      }
      if (this.state === 'pour' && this.poured >= this.total - 1e-12) this._settle();
    } else if (this.state === 'settle') {
      this.settleT += dt;
      if ((!app.particles.busy && !app.terrain.active) || this.settleT > 5) this.finish();
    }
  }

  _settle() {
    this.state = 'settle';
    this.settleT = 0;
    const m = this.app.journal.pending?.meta;
    if (m) m.volume = this.poured;
  }

  // land everything, let the heap come to rest and commit
  finish() {
    const app = this.app;
    if (this.state === 'idle') return;
    if (this.state === 'pour') { this.state = 'settle'; }
    app.particles.flush();
    for (let i = 0; i < 60000 && app.terrain.active; i++) app.terrain.relax(1);
    const m = app.journal.pending?.meta;
    if (m) m.volume = this.poured;
    app.journal.commit(app.clock);
    this.state = 'idle';
    const v = app.terrain.materialVolumes()[this.mat] * MODEL_SCALE ** 3;
    if (this.poured > 0) app.ui?.toast(`${this.name}: ${(this.poured * MODEL_SCALE ** 3).toFixed(2).replace('.', ',')} м³ · на участке ${v.toFixed(2).replace('.', ',')} м³`);
    app.ui?.refresh();
  }

  // undo while pouring: nothing of it stays
  abort() {
    if (this.state === 'idle') return false;
    this.app.particles.flush();
    this.app.journal.cancel();
    this.state = 'idle';
    this.app.ui?.refresh();
    return true;
  }
}

export { DELIVERY };
