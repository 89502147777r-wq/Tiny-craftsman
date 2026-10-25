import * as THREE from 'three';
import { PUMP, MODEL_SCALE, CONCRETE } from '../config.js';
import { Channel } from './uPour.js';
import { BeltChannel, beltContains } from './belt.js';
import { isSlab } from './slab.js';
import { houseOutside } from './pitchedTool.js';
import { boxOf } from './freeBrick.js';
import { BlindChannel } from './blindPour.js';
import { BLIND, layerSet } from '../world/blind.js';

// the concrete cast in place on the walls: a run of U-blocks or a ring beam
const makeChannel = (app, t) => (t.type === 'belt' ? new BeltChannel(app, t) : t.type === 'blind' ? new BlindChannel(app, t) : new Channel(app, t));
const topOf = (t) => (t.type === 'belt' ? t.top + t.H : t.type === 'blind' ? t.g + BLIND.top / 1000 / MODEL_SCALE : t.p[1] + t.s[1] / 2);
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

  // the concrete in the channel of U-blocks (uPour.js) instead of the ground: when the
  // finger is on a U-block the vibrator, the rule and the trowel work it there
  _uAt(e) {
    const app = this.app, v = app.wallView;
    if (!e || !v || e.clientX === undefined) return null;
    _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
    const hit = _ray.intersectObjects([v.ublocks, ...v.ucut.children, v.fill, v.wood, v.beltBoards, ...v.slabForm.decks.children, v.blocks, v.bricks, v.cinders, v.lintels, v.blinds], true)[0];
    if (!hit) return null;
    this._uHit = hit.point;
    const id = v.ownerOf(hit), r = id && app.objects.get(id);
    if (r?.type === 'belt') return r;
    // the blind area: once its gravel is down (under the mesh) and it is not paved
    if (r?.type === 'blind') {
      if (!layerSet(r, 'grav').size) { if (!this._bSaid) { this._bSaid = true; app.ui?.toast('Отмостка: бетон — по щебню и сетке, сначала их'); } return null; }
      if (r.finKind === 'tile') { if (!this._bSaid) { this._bSaid = true; app.ui?.toast('Здесь отмостка из плитки — бетон не нужен'); } return null; }
      return r;
    }
    if (r?.kind === 'ublock') return r;
    // (between the boards of a ring beam: on the masonry under it)
    return app.objects.all('belt').find((b) => beltContains(b, hit.point.x, hit.point.z) && hit.point.y > b.top - 0.002 && hit.point.y < b.top + b.H + 0.004) || null;
  }
  _uBegin(e, type) {
    const u = this._uAt(e);
    if (!u) return false;
    if (!(u.fill > 0.05)) { this.app.ui?.toast(u.type === 'blind' ? 'В отмостке ещё нет бетона — сначала залейте (ведро или шланг)' : u.type === 'belt' ? 'В опалубке пояса ещё нет бетона — сначала залейте (ведро или шланг)' : 'В лотке U-блоков ещё нет бетона — сначала залейте (Бетон → Ведро)'); return true; }
    const t0 = u.wetT ?? u.pourT ?? u.castT;   // (from the last fresh concrete)
    if (u.set || (t0 != null && this.app.clock - t0 > 0.75 * CONCRETE.cure)) { this.app.ui?.toast(u.type === 'blind' ? 'Бетон отмостки уже схватился — его не провибрировать и не загладить' : u.type === 'belt' ? 'Бетон пояса уже схватился — его не провибрировать и не загладить' : 'Бетон в лотке уже схватился — его не провибрировать и не загладить'); return true; }
    this.begin(type, { u: u.id }, this._uHit.clone());
    const ch = makeChannel(this.app, u);
    this.uw = { ch, top: topOf(u), i: ch.at(this._uHit.x, this._uHit.z) };
    this.uw.last = this.uw.i;
    this.app.sfx.scrapeStart();
    return true;
  }
  // the sample under the finger (on this run), or null
  _uSample(e) {
    const u = this._uAt(e);
    return u && this.uw.ch.has(u) ? this.uw.ch.at(this._uHit.x, this._uHit.z) : null;
  }

  up() { this._bSaid = false; if (this.state === 'work') { this.state = 'settle'; this.settleT = 0; this.app.sfx.scrapeStop(); this.gear.pump.setStream(false); } }
  interrupt() { this.up(); }

  update(dt) {
    if (this.state === 'settle') {
      this.settleT += dt;
      // concrete in a channel (U-blocks, the ring beam, a slab, the blind area) flows on frame
      // by frame until it holds (not all at once on the finger's release)
      const ch = this.uw?.ch || this.ch;
      if (ch) { const m = ch.step(dt); ch.show(this.app.wallView); if ((this.settleT > 0.3 && m < dt) || this.settleT > 12) this.finish(); }
      else if (!this.app.terrain.cActive || this.settleT > 2.5) this.finish();
    }
    if (this.state === 'work') this.work(dt);
  }

  work() {}

  // let the concrete come to rest and commit
  finish() {
    const app = this.app, t = app.terrain;
    if (this.state === 'idle') return;
    if (this.uw) {
      // (the channel: into its records; the ground is not touched)
      app.sfx.scrapeStop();
      this.uw.ch.write(app); this.uw = null;
      app.wallView.fillLive = app.wallView.fillLiveSm = app.wallView.beltLive = app.wallView.blindLive = null; app.wallView.fillDirty = true;
      app.journal.commit(app.clock);
      this.state = 'idle';
      app.ui?.refresh();
      return;
    }
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
    if (this.uw) { this.uw = null; this.app.wallView.fillLive = this.app.wallView.fillLiveSm = this.app.wallView.beltLive = this.app.wallView.blindLive = null; this.app.wallView.fillDirty = true; }
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


  down(p, e) {
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
    if (this.state !== 'idle') return true;
    this.uT = this._uAt(e);
    if (this.uT) p = new THREE.Vector3(this._uHit.x, 0, this._uHit.z);
    if (!this.uT && !this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('concrete-pour', { rate: this.app.settings.pump }, p);
    this.poured = 0; this.ch = null; this.brimSaid = false;
    this.warned = false;
    this.app.sfx.scrapeStart();
    this.app.sfx.scrapeLevel(0.25);
    this.gear.set('hose', this._tip(p), 0, true);
    return true;
  }

  move(p, e) {
    if (this.state !== 'work') return;
    this.uT = this._uAt(e);
    if (this.uT || this.app.terrain.inside(p.x, p.z)) { if (this.uT) p = new THREE.Vector3(this._uHit.x, 0, this._uHit.z); this.p.copy(p); this.gear.set('hose', this._tip(p)); }
  }

  _tip(p) {
    if (this.uT) return new THREE.Vector3(p.x, topOf(this.uT), p.z);   // over the U-block / the ring beam
    return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z);
  }

  // concrete into the channel of the U-blocks (uPour.js): it lands under the hose and
  // flows along the run (or round the ring beam)
  _fillU(dt) {
    const app = this.app;
    if (!this.ch?.has(this.uT)) { if (this.ch) this.ch.write(app); this.ch = makeChannel(app, this.uT); }
    const ch = this.ch, i = ch.at(this.p.x, this.p.z);
    // (a ring beam takes the hose near its pump rate: 37 … 60 l/s; the narrow channel of the
    // U-blocks 8 l/s)
    const lps = isSlab(this.uT) || this.uT.type === 'blind' ? (app.settings.pump || PUMP[1]) * (this.uT.type === 'blind' ? 300 : 1000) : this.uT.type === 'belt' ? Math.min(60, (app.settings.pump || PUMP[1]) * 300) : 8;   // (a slab: the pump's whole rate)
    if (!ch.full && ch.h[i] < (ch.brim ? ch.brim(i) : ch.cap) - 2) { ch.pour(i, lps * dt); this.poured += lps / 1000 * dt / MODEL_SCALE ** 3; }
    else if (!ch.full && !this.brimSaid) { this.brimSaid = true; app.ui?.toast(this.uT.type === 'blind' ? 'Здесь отмостка полна — ведите шланг дальше вдоль дома' : isSlab(this.uT) ? 'Здесь уже 200 мм — ведите шланг дальше по перекрытию' : this.uT.type === 'belt' ? 'Здесь опалубка полна — ведите шланг дальше по поясу' : 'Здесь лоток полон — ведите шланг дальше вдоль ряда'); }
    else if (ch.full && !this.warned) { this.warned = true; app.ui?.toast(this.uT.type === 'blind' ? 'Отмостка залита — отпустите; потом вибратор, правило по доскам (уклон от стен) и кельма' : isSlab(this.uT) ? 'Перекрытие залито — отпустите; потом вибратор и правило по доскам' : this.uT.type === 'belt' ? 'Пояс залит доверху — отпустите' : 'U-блоки залиты доверху — отпустите'); }
    ch.step(dt);
    ch.show(app.wallView);
    return ch.point(i);
  }
  abort() { this.ch = null; this.app.wallView.fillLive = this.app.wallView.fillLiveSm = this.app.wallView.beltLive = this.app.wallView.blindLive = null; this.app.wallView.fillDirty = true; return super.abort(); }
  finish() {
    if (this.state !== 'idle' && this.ch) { this.ch.write(this.app); this.ch = null; this.app.wallView.fillLive = this.app.wallView.fillLiveSm = this.app.wallView.beltLive = this.app.wallView.blindLive = null; this.app.wallView.fillDirty = true; }
    super.finish();
  }

  work(dt) {
    const app = this.app, t = app.terrain;
    const vol = real(app.settings.pump || PUMP[1]) * dt;
    // the stream lands under the hose and spreads from there: the mound under the
    // hose flows out fast (it is pushed by the stream), the rest creeps
    // it lands under the spout (which swings a little behind the finger)
    const at = this.gear.pump.ready ? this.gear.pump.spout() : this.p;
    if (this.uT) {
      const at = this._fillU(dt);
      this.gear.pump.setStream(true, at.y, app.clock);
      this.gear.set('hose', this._tip(this.p));
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

// A bucket of concrete (24 l) poured by hand into the channel of the U-blocks: hold the
// finger over the U-blocks — the bucket tips over the channel and the concrete runs out
// of its lip, heaps up and flows along the run (uPour.js); the more it empties, the more
// it is tipped. Each press is a fresh bucket from the mixer and one journal entry.
export const PAIL_L = 24;
export class PailTool extends ConcreteTool {
  constructor(app) { super(app, 'pail'); }


  down(p, e) {
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
    if (this.state !== 'idle') return true;
    const u = this._uAt(e);
    if (!u) { this.app.ui?.toast('Ведро — для U-блоков, пояса и отмостки: коснитесь лотка, опалубки пояса или щебня отмостки'); return true; }
    this.uT = u;
    this.begin('u-pour', {}, p);
    this.ch = makeChannel(this.app, u);
    this.left = PAIL_L; this.tilt = 0; this.poured = 0; this.warned = false; this.flow = 0; this.brimSaid = false;
    this.i = this.ch.at(this._uHit.x, this._uHit.z);
    this._pose(true);
    return true;
  }

  move(p, e) {
    if (this.state !== 'work') return;
    const u = this._uAt(e);
    if (!u) return;
    if (!this.ch.has(u)) { this.ch.write(this.app); this.ch = makeChannel(this.app, u); }
    this.uT = u;
    // the sample under the finger
    this.i = this.ch.at(this._uHit.x, this._uHit.z);
  }

  _hitP(e) {
    const app = this.app, v = app.wallView;
    _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
    return _ray.intersectObjects([v.ublocks, ...v.ucut.children, v.fill], false)[0]?.point || null;
  }

  // the bucket held with its lip over the sample, tipped towards the wall from the
  // camera's side
  _pose(snap = false) {
    const at = this.ch.point(this.i), u = this.uT, top = topOf(u);
    const lip = new THREE.Vector3(at.x, top, at.z);   // (the gear holds the lip above it, clear of the blocks)
    const g = this.gear;
    g.pailTilt = this.tilt; g.pailLeft = this.left / PAIL_L;
    g.pailStream = this.flow > 0.05 ? at.y : null;
    g.set('pail', lip, g.yawGoal, snap);
  }

  work(dt) {
    const app = this.app, ch = this.ch;
    // tipping: on until it runs, then further as it empties
    // (where the channel is full already it is held back: lead it on along the run)
    const brim = ch.h[this.i] >= (ch.brim ? ch.brim(this.i) : ch.cap) - 2;
    if (brim && !ch.full && !this.brimSaid) { this.brimSaid = true; app.ui?.toast(this.uT?.type === 'blind' ? 'Здесь отмостка полна — ведите ведро дальше' : 'Здесь лоток полон — ведите ведро дальше вдоль ряда'); }
    const want = this.left > 0 && !brim ? 1.25 + 0.75 * (1 - this.left / PAIL_L) : 0.6;
    this.tilt += (want - this.tilt) * (1 - Math.exp(-dt * 4));
    const run = this.left > 0 && this.tilt > 1.1 ? Math.min(1, (this.tilt - 1.1) / 0.15) : 0;
    this.flow = run;
    if (run > 0 && !ch.full) {
      const l = Math.min(this.left, 3.5 * run * dt);
      ch.pour(this.i, l); this.left -= l; this.poured += l / 1000 / MODEL_SCALE ** 3;
      if (this.left <= 0) app.ui?.toast('Ведро пустое — отпустите и наберите ещё');
    } else if (ch.full && !this.warned) { this.warned = true; app.ui?.toast(this.uT?.type === 'blind' ? 'Отмостка залита — отпустите' : 'U-блоки залиты доверху — отпустите'); }
    ch.step(dt);
    if (run > 0 && Math.random() < 0.3) {
      const p = ch.point(this.i), a = Math.random() * Math.PI * 2;
      app.particles?.emit(p, new THREE.Vector3(Math.cos(a) * 0.05, 0.12, Math.sin(a) * 0.05), 0, 0.0008, 0, 0, 9);
    }
    ch.show(app.wallView);
    this._pose();
  }

  up() { this._bSaid = false; if (this.state === 'work') { this.state = 'settle'; this.settleT = 0; } }

  update(dt) {
    if (this.state === 'work') this.work(dt);
    else if (this.state === 'settle') {
      // the bucket is lifted back, the concrete flows on a little
      this.settleT += dt; this.flow = 0;
      this.tilt += (0 - this.tilt) * (1 - Math.exp(-dt * 6));
      const moved = this.ch.step(dt);
      this.ch.show(this.app.wallView);
      this._pose();
      if (this.settleT > 0.6 && (moved < dt || this.settleT > 12)) this.finish();
    }
  }

  finish() {
    const app = this.app;
    if (this.state === 'idle') return;
    this.ch.write(app);
    app.wallView.fillLive = app.wallView.fillLiveSm = app.wallView.beltLive = app.wallView.blindLive = null; app.wallView.fillDirty = true;
    const m = app.journal.pending;
    if (m) m.meta.litres = +((PAIL_L - this.left)).toFixed(1);
    app.journal.commit(app.clock);
    this.state = 'idle'; this.ch = null;
    this.gear.pailStream = null;
    app.ui?.refresh();
    const R = app.objects.all('unit').filter((u) => u.kind === 'ublock');
    if (R.length && R.every((u) => (u.fill || 0) >= 0.95)) app.ui?.toast('Лотки залиты — бетон набирает прочность, потом можно снять подпорку');
  }

  abort() {
    if (this.state === 'idle') return false;
    this.ch = null; this.app.wallView.fillLive = this.app.wallView.fillLiveSm = this.app.wallView.beltLive = this.app.wallView.blindLive = null; this.app.wallView.fillDirty = true;
    this.gear.pailStream = null;
    this.app.journal.cancel();
    this.state = 'idle';
    this.app.ui?.refresh();
    return true;
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

  down(p, e) {
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
    if (this.state !== 'idle') return true;
    if (this._uBegin(e, 'u-screed')) { if (this.uw) this._uRule(this.uw.i, [1, 0], true); return true; }
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('screed', {}, p);
    this.stroke = { width: 2.0 / MODEL_SCALE, band: this.app.terrain.cell * 2.5, L: this.levelAt(p), moved: 0 };
    this.app.sfx.scrapeStart();
    this.gear.set('screed', new THREE.Vector3(p.x, this.stroke.L, p.z), Math.atan2(this.dir.x, this.dir.y), true);
    return true;
  }

  // in the channel: the rule lies across it on the two rims and is drawn along it,
  // pushing what stands above the rims on ahead
  _uRule(i, sg, snap = false) {   // (sg: the direction it is drawn in)
    const ch = this.uw.ch, at = ch.point(i), [dx, dz] = sg;
    this.gear.set('screed', new THREE.Vector3(at.x, this.uw.top, at.z), Math.atan2(dx, dz), snap);
  }

  move(p, e) {
    if (this.state !== 'work') return;
    if (this.uw) {
      const i = this._uSample(e);
      if (i == null || i === this.uw.last) return;
      const d = this.uw.ch.dir(this.uw.last, i);
      this.uw.ch.rule(this.uw.last, i);
      this.uw.last = i;
      this.uw.ch.show(this.app.wallView);
      this.app.sfx.scrapeLevel(0.4);
      this._uRule(i, d);
      return;
    }
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
    if (this.state === 'work' && !this.uw) this.app.terrain.flushSpill(this.stroke, this.dir.x, this.dir.y);
    super.up();
  }
}

export class VibratorTool extends ConcreteTool {
  constructor(app) { super(app, 'vibro'); }

  down(p, e) {
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
    if (this.state !== 'idle') return true;
    if (this._uBegin(e, 'u-vibrate')) { if (this.uw) this.gear.set('vibro', this.uw.ch.point(this.uw.i), 0, true); return true; }
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('vibrate', {}, p);
    this.app.sfx.scrapeStart();
    this.gear.set('vibro', this._at(p), 0, true);
    return true;
  }

  move(p, e) {
    if (this.state !== 'work') return;
    if (this.uw) { const i = this._uSample(e); if (i != null) this.uw.i = i; return; }
    if (this.app.terrain.inside(p.x, p.z)) this.p.copy(p);
  }
  _at(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }

  work(dt) {
    if (this.uw) {
      // in the channel: ~0,8 m of it either way runs level, the paste comes up
      const ch = this.uw.ch;
      ch.vibrate(this.uw.i, 16, dt);
      ch.show(this.app.wallView);
      this.app.sfx.scrapeLevel(0.35 + Math.random() * 0.1);
      const j = 0.0006;
      this.gear.set('vibro', ch.point(this.uw.i).add(new THREE.Vector3((Math.random() - 0.5) * j, 0, (Math.random() - 0.5) * j)));
      return;
    }
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

  down(p, e) {
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
    if (this.state !== 'idle') return true;
    if (this._uBegin(e, 'u-trowel')) {
      if (this.uw) { const ch = this.uw.ch; this.gear.set('trowel', ch.point(this.uw.i), Math.PI / 2, true); this.touched = true; }
      return true;
    }
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('trowel', {}, p);
    this.app.sfx.scrapeStart();
    this.gear.set('trowel', this._at(p), Math.atan2(this.dir.x, this.dir.y), true);
    this.touched = false;
    return true;
  }

  _at(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }

  move(p, e) {
    if (this.state !== 'work') return;
    if (this.uw) {
      // in the channel: the float (450 mm) along it closes and smooths the surface
      const i = this._uSample(e), ch = this.uw.ch;
      if (i == null || i === this.uw.last) return;
      const [dx, dz] = ch.dir(this.uw.last, i);
      ch.float(this.uw.last, i);
      this.uw.last = i;
      ch.show(this.app.wallView);
      this.app.sfx.scrapeLevel(0.2);
      this.gear.set('trowel', ch.point(i), Math.atan2(dx, dz) + Math.PI / 2);
      return;
    }
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
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
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
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
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

const MM = (v) => v / 1000 / MODEL_SCALE;
// Crowbar (лом): hold the finger on the concrete that ran out of the forms and set — the bar
// jabs, it breaks off in chips under it and is carried off (what lay on it falls on the ground).
// What ran out lies on the ground, outside the house: the concrete in a dug trench or pit (a
// footing), inside the walls (a floor slab) or under them is not touched; up to 400 mm thick.
export class BreakerTool extends ConcreteTool {
  constructor(app) { super(app, 'breaker'); }
  _at(p) { return new THREE.Vector3(p.x, this.app.terrain.heightAt(p.x, p.z), p.z); }
  _yaw(p) { const c = this.app.camera.position; return Math.atan2(c.x - p.x, c.z - p.z); }
  down(p) {
    if (this.state === 'settle') this.finish();   // (a new press: what still flows is taken as it is)
    if (this.state !== 'idle') return true;
    if (!this.app.terrain.inside(p.x, p.z)) return false;
    this.begin('break', {}, p);
    this.got = 0; this.thick = 0; this.jab = 0;
    // (what is a spill: on the ground as it was dug (not down in a trench), outside the house —
    // right up to the face of the wall, but not under its masonry)
    const t = this.app.terrain, out = houseOutside(this.app), e = MM(5);
    const feet = this.app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf).filter((b) => Math.abs(b.bot - t.heightAt(b.x, b.z)) < MM(400));
    const under = (x, z) => feet.some((b) => { const dx = x - b.x, dz = z - b.z; return Math.abs(dx * b.ux + dz * b.uz) < b.hl + e && Math.abs(-dx * b.uz + dz * b.ux) < b.hw + e; });
    this.ok = (i, x, z) => t.nat[i] + t.loose[i] > t.orig[i] - MM(50) && (!out || out(x, z) !== false) && !under(x, z);
    this.gear.set('breaker', this._at(p), this._yaw(p), true);
    return true;
  }
  move(p) { if (this.state === 'work') { this.p.copy(p); this.last.copy(p); } }
  work(dt) {
    const app = this.app, t = app.terrain, p = this.p;
    this.jab += dt;
    this.gear.barOn = true;
    this.gear.set('breaker', this._at(p), this._yaw(p));
    if (this.jab < 0.14) return;   // (a jab every 0.14 s)
    this.jab = 0;
    const r = t.chipConc(p.x, p.z, MM(170), MM(25), MM(400), this.ok);
    this.got += r.got; this.thick += r.thick;
    if (r.got > 0) {
      app.sfx.stab();
      const q = this._at(p), V = THREE.Vector3;
      for (let k = 0; k < 3; k++) app.particles.emit(q.clone().add(new V(0, MM(10), 0)), new V((Math.random() - 0.5) * 0.25, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.25), 0, MM(14), 0, 0, 3);   // (chips fly up; they are carried off — nothing left on the ground)
    }
  }
  up() {
    if (this.state !== 'work') return;
    this.gear.barOn = false;
    const app = this.app, got = this.got, thick = this.thick;
    this.finish();
    if (got > 0) app.ui?.toast(`Наплыв бетона отбили ломом (${(got * MODEL_SCALE ** 3 * 1000).toFixed(0)} л в мусор) — ведите по нему дальше, пока не откроется земля`);
    else app.ui?.toast(thick ? 'Это фундамент или плита (бетон в траншее, внутри дома или под кладкой) — ломом их не отбивают' : 'Здесь нет застывшего бетона — ведите лом по наплывам у фундамента и опалубок');
  }
}
