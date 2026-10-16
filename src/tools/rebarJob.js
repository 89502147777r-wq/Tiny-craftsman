import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { Episode } from '../world/physics.js';
import { rodsOf, meshLocal, meshCentre } from '../world/rebar.js';

// Laying reinforcement with real physics (steel, 7850 kg/m³), one journal entry:
//   bar   – one bar is let go a hand's height above where it should lie and comes to
//           rest on what is there: the ground, other bars, chairs
//   mesh  – a welded sheet, dropped as one piece
//   cage  – a slab cage is laid the way it is on site: chairs first, the bottom bars
//           one by one onto the chairs, the cross bars one by one onto them, frogs,
//           then the tied top mat is lowered onto the frogs
// Bars that are already there (other cages, bars, meshes), chairs and frogs are fixed
// supports. The final poses go into the record.
const S = MODEL_SCALE, M = (m) => m / S;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _A = new THREE.Vector3(), _B = new THREE.Vector3();

export class RebarJob {
  constructor(app, rec, type, meta) {
    this.app = app;
    this.rec = rec;
    const t = app.terrain;
    this.pending = app.journal.begin(type, meta, app.clock);
    // the area: the new piece and a margin
    const mine = rodsOf(rec);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of mine) { x0 = Math.min(x0, b[0], b[3]); x1 = Math.max(x1, b[0], b[3]); z0 = Math.min(z0, b[2], b[5]); z1 = Math.max(z1, b[2], b[5]); }
    const pad = M(0.6);
    // a cage is laid bar by bar from a finger's height (60 Hz is enough); a bar or a sheet
    // is let go from higher: finer steps, or a thin fast bar would slip through
    this.ep = new Episode(t, x0 - pad, z0 - pad, x1 + pad, z1 + pad, 2, rec.type === 'cage' ? 60 : 120);
    this.ep.maxV = 1;   // bars are lowered, not thrown
    // what is already there holds it up
    const near = (b) => Math.max(b[0], b[3]) > x0 - pad && Math.min(b[0], b[3]) < x1 + pad && Math.max(b[2], b[5]) > z0 - pad && Math.min(b[2], b[5]) < z1 + pad;
    for (const r of app.objects.all()) {
      if (!['bar', 'mesh', 'cage'].includes(r.type)) continue;
      for (const b of rodsOf(r)) if (near(b)) this.ep.staticCapsule(_A.set(b[0], b[1], b[2]), _B.set(b[3], b[4], b[5]), b[6] / 2);
      if (r.type === 'cage') this._supports(r.chairs, r.frogs, r);
    }
    this.pieces = [];   // { body, local: rods in the body frame, at: release time }
    this.t = 0;
    this.done = false;
    if (rec.type === 'bar') this._bar();
    else if (rec.type === 'mesh') this._mesh();
    else this._cage();
    this.end = Math.max(...this.pieces.map((p) => p.at)) + 0.6;
    app.sfx?.stab?.();
    this._show();
  }

  get busy() { return !this.done; }

  // chairs (cylinders) and frogs (a block from the bottom mat up to the top mat)
  _supports(chairs, frogs, r) {
    const d = r.d || M(0.012);
    // a plastic chair: a post with a cradle on top — the bar lies in it between two lips
    // (across the bars along X, which are the ones laid on the chairs)
    for (const c of chairs) {
      this.ep.staticCylinder(_p.set(c[0], c[1], c[2]), M(0.02), c[3]);
      for (const sgn of [-1, 1]) this.ep.staticBox(_p.set(c[0], c[1] + c[3] + d * 0.3, c[2] + sgn * (d / 2 + M(0.01))), _q.identity(), M(0.015), d * 0.3, M(0.002));
    }
    for (const f of frogs || []) {
      const y0 = f[1] + d * 0.2, y1 = f[1] + f[4] - d;   // from on the bottom mat up to under the top one
      if (y1 <= y0) continue;
      this.ep.staticBox(_p.set(f[0], (y0 + y1) / 2, f[2]), _q.setFromEuler(new THREE.Euler(0, f[3], 0)), (r.step || M(0.2)) * 0.2, (y1 - y0) / 2, d);
    }
  }

  // one piece: rods in its own frame, centred at c (plot), released at time `at`
  // from `lift` above where it was meant to lie
  _piece(rods, c, at, lift) {
    // (the body appears when it is brought: nothing hangs in the air before)
    const pc = { body: null, rods, at, c, lift, extend: 0 };
    this.pieces.push(pc);
    return pc;
  }

  _bar() {
    const r = this.rec, c = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2];
    this._piece([[r.a[0] - c[0], r.a[1] - c[1], r.a[2] - c[2], r.b[0] - c[0], r.b[1] - c[1], r.b[2] - c[2], r.d]], c, 0.05, M(0.15));
  }

  _mesh() {
    this.meshPc = this._piece(meshLocal(this.rec), meshCentre(this.rec), 0.05, M(0.15));
  }

  _cage() {
    const r = this.rec;
    this.chairs = r.chairs; this.frogs = r.frogs;
    this._supports(r.chairs, r.frogs, r);
    // the layers: lower bars (along X), cross bars on them; a second (top) mat if any
    const ys = [...new Set(r.bars.map((b) => +b[1].toFixed(6)))].sort((a, b) => a - b);
    const bottom = r.bars.filter((b) => b[1] <= ys[0] + r.d * 1.5);
    const top = r.bars.filter((b) => b[1] > ys[0] + r.d * 1.5);
    let at = 0.15;
    const single = (b) => {
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const pc = this._piece([[b[0] - c[0], b[1] - c[1], b[2] - c[2], b[3] - c[0], b[4] - c[1], b[5] - c[2], b[6]]], c, at, M(0.01));
      pc.bar = r.bars.indexOf(b);
      pc.extend = 1;   // the ends are tied in a real cage: the edge cross bar does not roll off a bar's end
      at += 0.07;
    };
    // along X first (they lie on the chairs), then the cross bars on them
    bottom.filter((b) => Math.abs(b[3] - b[0]) >= Math.abs(b[5] - b[2])).forEach(single);
    at += 0.3;
    bottom.filter((b) => Math.abs(b[3] - b[0]) < Math.abs(b[5] - b[2])).forEach(single);
    if (top.length) {
      // the top mat is tied as one piece and lowered onto the frogs
      at += 0.6;
      let cx = 0, cy = Infinity, cz = 0;
      for (const b of top) { cx += b[0] + b[3]; cz += b[2] + b[5]; cy = Math.min(cy, b[1]); }
      const c = [cx / (2 * top.length), cy, cz / (2 * top.length)];
      const pc = this._piece(top.map((b) => [b[0] - c[0], b[1] - c[1], b[2] - c[2], b[3] - c[0], b[4] - c[1], b[5] - c[2], b[6]]), c, at, M(0.08));
      pc.top = top.map((b) => r.bars.indexOf(b));
    }
  }

  update(dt) {
    if (this.done) return;
    if (this.app.journal.pending !== this.pending) { this._dispose(); return; }
    this.ep.step(dt, (time) => {
      for (const pc of this.pieces) if (!pc.body && time >= pc.at) pc.body = this.ep.rods(pc.rods, _p.set(pc.c[0], pc.c[1] + pc.lift, pc.c[2]), _q.identity(), { extend: pc.extend });
    });
    this.t = this.ep.time;
    this._show();
    if (this.t > this.end && this.pieces.every((pc) => pc.body) && (this.ep.still() || this.t > this.end + 3)) this._commit();
  }

  // the rods of every piece where physics has it now
  _world(pc) {
    if (!pc.body) return [];
    this.ep.pose(pc.body, _p, _q);
    return pc.rods.map((b) => {
      _A.set(b[0], b[1], b[2]).applyQuaternion(_q).add(_p); _B.set(b[3], b[4], b[5]).applyQuaternion(_q).add(_p);
      return [+_A.x.toFixed(5), +_A.y.toFixed(5), +_A.z.toFixed(5), +_B.x.toFixed(5), +_B.y.toFixed(5), +_B.z.toFixed(5), b[6]];
    });
  }

  _show() {
    const v = this.app.rebarView;
    v.live = { rods: this.pieces.flatMap((pc) => this._world(pc)), chairs: this.chairs || [], frogs: this.frogs || [] };
    v.dirty = true;
  }

  _commit() {
    const app = this.app, r = { ...this.rec };
    if (r.type === 'bar') {
      const [b] = this._world(this.pieces[0]);
      r.a = b.slice(0, 3); r.b = b.slice(3, 6);
    } else if (r.type === 'mesh') {
      this.ep.pose(this.meshPc.body, _p, _q);
      r.p = _p.toArray().map((x) => +x.toFixed(5)); r.q = _q.toArray().map((x) => +x.toFixed(6));
    } else {
      r.bars = r.bars.map((b) => b.slice());
      for (const pc of this.pieces) {
        const w = this._world(pc);
        if (pc.bar !== undefined) r.bars[pc.bar] = w[0];
        if (pc.top) pc.top.forEach((k, j) => { r.bars[k] = w[j]; });
      }
    }
    app.objects.add(r);
    app.journal.commit(app.clock);
    this._dispose();
    app.ui?.refresh();
  }

  _dispose() {
    this.done = true;
    this.ep?.dispose(); this.ep = null;
    this.app.rebarView.live = null;
    this.app.rebarView.dirty = true;
    if (this.app.physJob === this) this.app.physJob = null;
  }

  finish() { for (let i = 0; i < 3600 && !this.done; i++) this.update(1 / 10); }

  abort() {
    if (this.done) return false;
    this.app.journal.cancel();
    this._dispose();
    return true;
  }
}
