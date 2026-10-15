import * as THREE from 'three';
import { PUMP, MODEL_SCALE, CONCRETE } from '../config.js';

// Concrete work, as on a real slab:
//   hose     – hold a finger: the pump hose pours where the finger is
//   screed   – drag the rule over the concrete: it rides on the formwork tops
//              and pushes the excess ahead
//   vibro    – hold the poker in the concrete: it settles flat around it
//   trowel   – drag over fresh concrete: a closed, smooth surface
// Each press / stroke is one journal entry; the concrete is let to come to rest
// before it is committed (it keeps creeping while fresh).
const real = (m3) => m3 / MODEL_SCALE ** 3;

class ConcreteTool {
  constructor(app, kind) {
    this.app = app;
    this.kind = kind;
    this.state = 'idle';
    this.p = new THREE.Vector3();
    this.dir = new THREE.Vector2(0, 1);
  }

  get busy() { return this.state !== 'idle'; }
  get gear() { return this.app.concreteGear; }

  begin(type, meta, p) {
    const app = this.app;
    app.journal.begin(type, meta, app.clock);
    this.p.copy(p);
    this.last = p.clone();
    this.started = false;
    this.state = 'work';
  }

  // the stroke direction (smoothed), from the finger's motion
  steer(p) {
    const d = new THREE.Vector2(p.x - this.last.x, p.z - this.last.z), len = d.length();
    if (len < this.app.terrain.cell * 0.6) return 0;
    d.divideScalar(len);
    this.dir.copy(this.started ? this.dir.clone().lerp(d, 0.35).normalize() : d);
    this.started = true;
    return len;
  }

  up() { if (this.state === 'work') { this.state = 'settle'; this.settleT = 0; this.app.sfx.scrapeStop(); this.gear.pump.setStream(false); } }
  interrupt() { this.up(); }

  // where the concrete is worked right now (the flow is computed there while working)
  region() { return null; }

  update(dt) {
    if (this.state === 'settle') {
      this.settleT += dt;
      if (!this.app.terrain.cActive || this.settleT > 2.5) this.finish();
    }
    if (this.state === 'work') this.work(dt);
  }

  work() {}

  // let the concrete come to rest and commit
  finish() {
    const app = this.app, t = app.terrain;
    if (this.state === 'idle') return;
    app.sfx.scrapeStop();
    this.gear.pump.setStream(false);
    // (the concrete was let to settle frame by frame; whatever creep is left stops here —
    // a long settling loop at this point froze the game for seconds)
    t.flushOverflow();
    t.cActive = null;   // whatever creep is left stops here (it is recorded as it is)
    app.journal.commit(app.clock);
    this.state = 'idle';
    this.done?.();
    app.ui?.refresh();
  }

  abort() {
    if (this.state === 'idle') return false;
    this.app.sfx.scrapeStop();
    this.app.particles.flush();
    this.app.journal.cancel();
    this.state = 'idle';
    this.app.ui?.refresh();
    return true;
  }

  rest() {}
}

export class HoseTool extends ConcreteTool {
  constructor(app) { super(app, 'hose'); }

  region() {
    if (this.state !== 'work') return null;
    const sp = this.gear.pump.ready ? this.gear.pump.spout() : this.p;
    return this.app.terrain.cellBox(sp.x, sp.z, 0.13);
  }

  down(p) {
    if (this.state !== 'idle') return true;
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('concrete-pour', { rate: this.app.settings.pump }, p);
    this.poured = 0;
    this.warned = false;
    this.app.sfx.scrapeStart();
    this.app.sfx.scrapeLevel(0.25);
    this.gear.set('hose', this._tip(p), 0, true);
    return true;
  }

  move(p) { if (this.state === 'work' && this.app.terrain.inside(p.x, p.z)) { this.p.copy(p); this.gear.set('hose', this._tip(p)); } }

  _tip(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }

  work(dt) {
    const app = this.app, t = app.terrain;
    const vol = real(app.settings.pump || PUMP[1]) * dt;
    // the stream lands under the hose and spreads from there: the mound under the
    // hose flows out fast (it is pushed by the stream), the rest creeps
    // it lands under the spout (which swings a little behind the finger)
    const at = this.gear.pump.ready ? this.gear.pump.spout() : this.p;
    t.pourConc(t.clampX(at.x), t.clampZ(at.z), vol, 0.11);
    // full to the top of the formwork here? say so once per pour
    if (!this.warned) {
      const i = t.index(at.x, at.z), b = t.cellBox(at.x, at.z, 0.12);
      let top = 0;
      for (let iz = b.z0; iz <= b.z1; iz += 2) for (let ix = b.x0; ix <= b.x1; ix += 2) top = Math.max(top, t.wall[iz * t.nx + ix]);
      if (top && t.hAt(i) >= top - 0.0008) { this.warned = true; app.ui?.toast('Здесь опалубка заполнена до верха — ведите шланг дальше или отпустите'); }
    }
    this.poured += vol;
    // the stream out of the spout (looks only: the volume is poured above), and a few
    // splashes where it lands
    const pump = this.gear.pump, sp = pump.spout(), gy = t.heightAt(t.clampX(sp.x), t.clampZ(sp.z));
    pump.setStream(true, gy, app.clock);
    const r = Math.random;
    if (r() < 0.5) {
      const pos = new THREE.Vector3(sp.x, gy + 0.002, sp.z);
      const a = r() * Math.PI * 2;
      app.particles.emit(pos, new THREE.Vector3(Math.cos(a) * 0.12, 0.25 + r() * 0.2, Math.sin(a) * 0.12), 0, 0.0012 + r() * 0.0012, 0, 0, 9);
    }
    this.gear.set('hose', this._tip(this.p));
  }

  done() {
    const app = this.app, m = app.journal.done[app.journal.done.length - 1];
    if (m?.type === 'concrete-pour') m.meta.volume = this.poured;
    const all = app.terrain.concVolume() * MODEL_SCALE ** 3;
    app.ui?.toast(`Бетон: ${(this.poured * MODEL_SCALE ** 3).toFixed(2).replace('.', ',')} м³ · всего ${all.toFixed(2).replace('.', ',')} м³`);
  }
}

export class ScreedTool extends ConcreteTool {
  constructor(app) { super(app, 'screed'); }

  // the rule rides on the formwork of the outline it is in (or on the boards nearby,
  // or — with no formwork — at the level the concrete has where it starts)
  levelAt(p) {
    const app = this.app, t = app.terrain;
    const o = app.objects.all('outline').find((ol) => app.outlineContains(ol, p.x, p.z));
    const forms = o ? app.objects.all('form').filter((f) => f.outlineId === o.id) : [];
    if (forms.length) return Math.max(...forms.map((f) => f.y1));
    let top = 0;
    const b = t.cellBox(p.x, p.z, 0.15);
    for (let iz = b.z0; iz <= b.z1; iz++) for (let ix = b.x0; ix <= b.x1; ix++) top = Math.max(top, t.wall[iz * t.nx + ix]);
    return top || t.heightAt(p.x, p.z);
  }

  down(p) {
    if (this.state !== 'idle') return true;
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('screed', {}, p);
    this.stroke = { width: 2.0 / MODEL_SCALE, band: this.app.terrain.cell * 2.5, L: this.levelAt(p), moved: 0 };
    this.app.sfx.scrapeStart();
    this.gear.set('screed', new THREE.Vector3(p.x, this.stroke.L, p.z), Math.atan2(this.dir.x, this.dir.y), true);
    return true;
  }

  move(p) {
    if (this.state !== 'work') return;
    const t = this.app.terrain, len = this.steer(p);
    if (!len) return;
    const n = Math.ceil(len / (t.cell * 0.6)), q = new THREE.Vector3();
    let moved = 0;
    for (let k = 1; k <= n; k++) {
      q.lerpVectors(this.last, p, k / n);
      if (t.inside(q.x, q.z)) moved += t.screedStep(this.stroke, q.x, q.z, this.dir.x, this.dir.y);
    }
    t.concRelax(1);
    this.stroke.moved += moved;
    this.app.sfx.scrapeLevel(Math.min(0.7, 0.1 + moved * 3e5));
    this.last.copy(p);
    // the rule lies across the stroke
    this.gear.set('screed', new THREE.Vector3(p.x, this.stroke.L, p.z), Math.atan2(this.dir.x, this.dir.y));
  }

  up() {
    if (this.state === 'work') this.app.terrain.flushSpill(this.stroke, this.dir.x, this.dir.y);
    super.up();
  }
}

export class VibratorTool extends ConcreteTool {
  constructor(app) { super(app, 'vibro'); }

  down(p) {
    if (this.state !== 'idle') return true;
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('vibrate', {}, p);
    this.app.sfx.scrapeStart();
    this.gear.set('vibro', this._at(p), 0, true);
    return true;
  }

  move(p) { if (this.state === 'work' && this.app.terrain.inside(p.x, p.z)) this.p.copy(p); }
  _at(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }

  work(dt) {
    const t = this.app.terrain;
    t.vibrate(this.p.x, this.p.z, 0.4 / MODEL_SCALE);   // acts ~0.4 m around the poker
    this.app.sfx.scrapeLevel(0.35 + Math.random() * 0.1);
    // the poker shivers
    const j = 0.0006;
    this.gear.set('vibro', this._at(this.p).add(new THREE.Vector3((Math.random() - 0.5) * j, 0, (Math.random() - 0.5) * j)));
  }
}

export class TrowelTool extends ConcreteTool {
  constructor(app) { super(app, 'trowel'); }

  down(p) {
    if (this.state !== 'idle') return true;
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('trowel', {}, p);
    this.app.sfx.scrapeStart();
    this.gear.set('trowel', this._at(p), Math.atan2(this.dir.x, this.dir.y), true);
    this.touched = false;
    return true;
  }

  _at(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }

  move(p) {
    if (this.state !== 'work') return;
    const t = this.app.terrain, len = this.steer(p);
    if (!len) return;
    const n = Math.ceil(len / (t.cell * 1.5)), q = new THREE.Vector3();
    for (let k = 1; k <= n; k++) {
      q.lerpVectors(this.last, p, k / n);
      // the float is pushed along its long side
      if (t.trowelStep(q.x, q.z, this.dir.x, this.dir.y, 0.12 / MODEL_SCALE, 0.45 / MODEL_SCALE)) this.touched = true;
    }
    this.app.sfx.scrapeLevel(0.2);
    this.last.copy(p);
    this.gear.set('trowel', this._at(p), Math.atan2(this.dir.x, this.dir.y) + Math.PI / 2);
  }

  done() { if (!this.touched) this.app.ui?.toast(`Кельмой — только по свежему бетону (до ${Math.round(0.75 * CONCRETE.cure)} с после заливки)`); }
}
