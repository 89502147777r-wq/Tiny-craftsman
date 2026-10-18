import * as THREE from 'three';
import { PUMP, MODEL_SCALE, CONCRETE } from '../config.js';
import { uRun } from './lintels.js';
const _ray = new THREE.Raycaster();

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


  // a U-block under the finger (the hose pours into its channel then, not onto the ground)
  _uAt(e) {
    const app = this.app, v = app.wallView;
    if (!e || !v || e.clientX === undefined) return null;
    _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
    const hit = _ray.intersectObjects([v.ublocks, v.fill], false)[0];
    const id = hit && v.ownerOf(hit), u = id && app.objects.get(id);
    return u && u.kind === 'ublock' ? u : null;
  }

  down(p, e) {
    if (this.state !== 'idle') return true;
    this.uT = this._uAt(e);
    if (!this.uT && !this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('concrete-pour', { rate: this.app.settings.pump }, p);
    this.poured = 0; this.uAcc = new Map(); this.uSync = 0;
    this.warned = false;
    this.app.sfx.scrapeStart();
    this.app.sfx.scrapeLevel(0.25);
    this.gear.set('hose', this._tip(p), 0, true);
    return true;
  }

  move(p, e) {
    if (this.state !== 'work') return;
    this.uT = this._uAt(e);
    if (this.uT || this.app.terrain.inside(p.x, p.z)) { if (this.uT) p = new THREE.Vector3(this.uT.p[0], 0, this.uT.p[2]); this.p.copy(p); this.gear.set('hose', this._tip(p)); }
  }

  _tip(p) {
    if (this.uT) return new THREE.Vector3(this.uT.p[0], this.uT.p[1] + this.uT.s[1] / 2, this.uT.p[2]);   // over the U-block
    return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z);
  }

  // concrete into the channel of the U-blocks: the one under the hose, then on along the
  // run; the channel holds 600 × 150 × 190 mm (17 l) — a full one starts to set
  _fillU(vol) {
    const app = this.app, S3 = MODEL_SCALE ** 3, cap = 0.6 * 0.15 * 0.19;
    const R = uRun(app, new THREE.Vector3(this.uT.p[0], 0, this.uT.p[2]), null, null);
    const run = (R ? R.run.map((b) => b.u) : [this.uT]).sort((a, b) => Math.hypot(a.p[0] - this.uT.p[0], a.p[2] - this.uT.p[2]) - Math.hypot(b.p[0] - this.uT.p[0], b.p[2] - this.uT.p[2]));
    let left = vol * S3;
    for (const u of run) {
      const f = (this.uAcc.get(u.id) ?? u.fill ?? 0);
      if (f >= 1) continue;
      const take = Math.min(left, (1 - f) * cap);
      this.uAcc.set(u.id, f + take / cap);
      left -= take;
      if (left <= 1e-9) break;
    }
    this.poured += vol - left / S3;
    if (left > 1e-9 && !this.warned) { this.warned = true; app.ui?.toast('U-блоки залиты доверху — отпустите'); }
    // into the records a few times a second (one journal entry for the pour)
    this.uSync += 1;
    if (this.uSync % 6 === 0) this._syncU();
  }
  finish() { if (this.state !== 'idle' && this.uAcc?.size) this._syncU(); super.finish(); }   // (the last of the fill into the record before it commits)

  _syncU() {
    const app = this.app;
    for (const [id, f] of this.uAcc) {
      const u = app.objects.get(id);
      if (!u || Math.abs((u.fill || 0) - f) < 1e-4) continue;
      app.objects.update(id, { fill: +Math.min(1, f).toFixed(4), ...(f >= 0.95 && u.pourT == null ? { pourT: +app.clock.toFixed(2) } : {}) });
    }
  }

  work(dt) {
    const app = this.app, t = app.terrain;
    const vol = real(app.settings.pump || PUMP[1]) * dt;
    // the stream lands under the hose and spreads from there: the mound under the
    // hose flows out fast (it is pushed by the stream), the rest creeps
    // it lands under the spout (which swings a little behind the finger)
    const at = this.gear.pump.ready ? this.gear.pump.spout() : this.p;
    if (this.uT) {
      this._fillU(vol);
      const pump = this.gear.pump, sp = pump.spout();
      pump.setStream(true, this.uT.p[1] + this.uT.s[1] / 2 - 0.004, app.clock);
      this.gear.set('hose', this._tip(this.p));
      void sp;
      return;
    }
    // the stream lands as a splat ~5 cm (real) across; the flow spreads it
    t.depositConc(t.clampX(at.x), t.clampZ(at.z), vol, 0.014);
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
    t.vibrate(this.p.x, this.p.z, 0.8 / MODEL_SCALE);   // acts ~0.8 m around the poker (a strong one)
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

// Waterproofing: bitumen mastic brushed onto the faces of the concrete (only where
// there is a face — the top of a slab stays clean)
export class BitumenTool extends ConcreteTool {
  constructor(app) { super(app, 'bitumen'); }

  down(p) {
    if (this.state !== 'idle') return true;
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('bitumen', {}, p);
    this.coated = 0;
    this.app.sfx.scrapeStart();
    this.gear.set('brush', this._at(p), 0, true);
    this._paint(p);
    return true;
  }

  _at(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }

  _paint(p) {
    this.coated += this.app.terrain.paintBitumen(p.x, p.z, 0.09 / MODEL_SCALE, 0.3);
  }

  move(p) {
    if (this.state !== 'work') return;
    const t = this.app.terrain, len = this.steer(p);
    if (!len) return;
    const n = Math.ceil(len / (t.cell * 2)), q = new THREE.Vector3();
    for (let k = 1; k <= n; k++) { q.lerpVectors(this.last, p, k / n); this._paint(q); }
    this.app.sfx.scrapeLevel(0.15);
    this.last.copy(p);
    this.gear.set('brush', this._at(p), Math.atan2(this.dir.x, this.dir.y));
  }

  done() { if (!this.coated) this.app.ui?.toast('Битумом мажут бетон — грани и верх фундамента'); }
}

// Plate compactor: drag it over loose soil / sand / crushed stone — it shakes along and
// the material settles (each pass about a third of the way to fully compacted)
export class PlateTool extends ConcreteTool {
  constructor(app) { super(app, 'plate'); }

  down(p) {
    if (this.state !== 'idle') return true;
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('compact', {}, p);
    this.app.sfx.scrapeStart();
    this.app.sfx.scrapeLevel(0.5);
    this.gear.set('plate', this._at(p), Math.atan2(this.dir.x, this.dir.y), true);
    return true;
  }

  _at(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }

  move(p) {
    if (this.state !== 'work') return;
    const t = this.app.terrain, len = this.steer(p);
    if (!len) return;
    const W = 0.5 / MODEL_SCALE, L = 0.6 / MODEL_SCALE, step = t.cell * 1.5;
    const gain = 0.12 * step / L;   // one pass over a spot: about a quarter of the way (3–4 passes)
    const n = Math.ceil(len / step), q = new THREE.Vector3();
    for (let k = 1; k <= n; k++) {
      q.lerpVectors(this.last, p, k / n);
      t.compactStep(q.x, q.z, this.dir.x, this.dir.y, W, L, gain);
    }
    this.last.copy(p);
  }

  work() {
    // the engine thumps; the model shakes itself (plate hard, engine less, handle hardly)
    this.app.sfx.scrapeLevel(0.45 + Math.random() * 0.15);
    this.gear.plateOn = true;
    this.gear.set('plate', this._at(this.last), Math.atan2(this.dir.x, this.dir.y));
  }

  // the edges of the settled strip crumble in before the pass is recorded
  finish() {
    this.gear.plateOn = false;
    const t = this.app.terrain;
    if (this.state !== 'idle') for (let i = 0; i < 40000 && t.active; i++) t.relax(1);
    super.finish();
  }

  done() {
    // settlement of this pass: how much thinner the loose material got (deepest spot)
    const snap = this.app.journal.done.at(-1)?.diff;
    let most = 0;
    if (snap) for (let k = 0; k < snap.idx.length; k++) most = Math.max(most, snap.bl[k] - snap.al[k]);
    const mm = Math.round(most * MODEL_SCALE * 1000);
    this.app.ui?.toast(mm > 0 ? `Уплотнено: осадка до ${mm} мм за проход` : 'Виброплита уплотняет насыпанный грунт, песок или щебень (не нетронутую землю)');
  }
}
