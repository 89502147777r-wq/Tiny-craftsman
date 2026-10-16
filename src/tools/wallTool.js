import * as THREE from 'three';
import { MODEL_SCALE, K } from '../config.js';
import { KINDS, OPENINGS, axis, rows, rowY, course, slotPose, covered, wallState, taken, cutName, openingRows, beddable } from '../world/walls.js';
import { Episode, loadPhysics, physicsReady } from '../world/physics.js';

// Walls (aerated concrete blocks or bricks), as on site:
//   line   – drag the axis of a wall over the foundation (ends snap to other walls'
//            ends → a corner, and to the axes)
//   mortar – drag the trowel along the course: a strip of mortar / glue is spread
//   lay    – tap at the wall: a block / brick is set into the nearest free place of
//            the course (only on mortar, only over a finished course below); it is
//            lowered by hand, settles on the mortar (physics) and is tapped level with
//            the mallet. Hold the finger to keep laying.
//   delete – tap a unit to take it off (if nothing lies on it); tap an empty wall line
//            to remove it
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();

export class WallTool {
  constructor(app) {
    this.app = app;
    this.mode = 'line';
    this.drag = null;
    this.hold = null;
  }

  get busy() { return !!this.drag || !!this.hold; }
  // one finger works on the wall in every mode (the camera: two fingers)
  blocksOrbit() { return true; }

  setMode(m) { this.mode = m; if (m === 'lay') loadPhysics().catch(() => {}); this.app.ui.refresh(); this._focus(); }
  get kind() { return this.app.settings.wallKind || 'block'; }
  get openKind() { return this.app.settings.openKind || 'window'; }

  // the wall nearest to a point (within reach), with the position along it (real mm)
  nearest(p, reach = 0.035 * K) {
    let best = null;
    for (const w of this.app.objects.all('wall')) {
      const ax = axis(w), dx = p.x - w.a[0], dz = p.z - w.a[1];
      const s = (dx * ax.ux + dz * ax.uz) / S, d = Math.abs(dx * ax.nx + dz * ax.nz);
      if (s < -200 || s > ax.L + 200) continue;
      // the wall being worked on wins at a corner (the finger is as near to the other one)
      const dd = w.id === this.lastWall ? d - 0.012 : d;
      if (d < reach && (!best || dd < best.dd)) best = { w, s, d, dd };
    }
    return best;
  }

  // the next course (ghost places + cord) is shown while spreading mortar and laying
  _focus(w) {
    const v = this.app.wallView;
    v.marks = true;
    v.focus = this.mode === 'mortar' || this.mode === 'lay' ? (w ? w.id : this.lastWall ?? null) : null;
    v.dirty = true;
  }

  // the point under the finger: on the wall itself (blocks, mortar, the ghost places)
  // when the finger is on it — the ground point behind a wall would miss it
  _pt(p, e) {
    if (!e || e.clientX === undefined || (!e.clientX && !e.clientY)) return p;
    const app = this.app, v = app.wallView;
    _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
    const hit = _ray.intersectObjects([v.blocks, v.bricks, v.lintels, v.mortar, v.frames], false)[0];
    return hit ? hit.point : p;
  }

  down(p, e) {
    const app = this.app;
    p = this._pt(p, e);
    if (this.mode === 'line') {
      this.drag = { a: this._snap([p.x, p.z]), b: [p.x, p.z] };
      return true;
    }
    if (this.mode === 'opening') {
      const n = this.nearest(p);
      if (!n) { app.ui.toast('Ведите вдоль стены — от одного края проёма до другого'); return true; }
      this.drag = { w: n.w, s0: n.s, s1: n.s, a: n.s };
      this.lastWall = n.w.id;
      return true;
    }
    if (this.mode === 'mortar') {
      const n = this.nearest(p);
      if (!n) { app.ui.toast('Ведите кельмой вдоль стены'); return false; }
      const st = wallState(n.w, app.objects);
      if (st.cur >= st.n) { app.ui.toast('Стена выложена до верха'); return false; }
      this.drag = { w: n.w, row: st.cur, s0: n.s, s1: n.s };
      this.lastWall = n.w.id; this._focus(n.w);
      app.concreteGear.set('trowel', new THREE.Vector3(p.x, rowY(n.w, st.cur), p.z), Math.atan2(axis(n.w).ux, axis(n.w).uz), true);
      app.sfx.scrapeStart();
      return true;
    }
    if (this.mode === 'lay') {
      this.hold = { p: p.clone(), next: 0 };
      this._lay(p);
      return true;
    }
    if (this.mode === 'delete') { this._delete(p, e); return true; }
    return false;
  }

  move(p, e) {
    const app = this.app;
    p = this._pt(p, e);
    if (this.hold) this.hold.p.copy(p);
    if (!this.drag) return;
    if (this.mode === 'line') {
      this.drag.b = this._snap([p.x, p.z], this.drag.a);
      const L = Math.hypot(this.drag.b[0] - this.drag.a[0], this.drag.b[1] - this.drag.a[1]) * MODEL_SCALE;
      app.ui.showMeasure(`${L.toFixed(2)} м`);
      this._preview();
    } else if (this.mode === 'opening') {
      const d = this.drag, ax = axis(d.w);
      const s = ((p.x - d.w.a[0]) * ax.ux + (p.z - d.w.a[1]) * ax.uz) / S;
      d.s0 = Math.round(Math.min(d.a, s) / 50) * 50; d.s1 = Math.round(Math.max(d.a, s) / 50) * 50;
      app.ui.showMeasure(`${OPENINGS[this.openKind].name}: ${(d.s1 - d.s0) / 1000} м`.replace('.', ','));
      this._showOpening();
    } else if (this.mode === 'mortar') {
      const d = this.drag, ax = axis(d.w);
      const s = ((p.x - d.w.a[0]) * ax.ux + (p.z - d.w.a[1]) * ax.uz) / S;
      d.s0 = Math.min(d.s0, s); d.s1 = Math.max(d.s1, s);
      const cs = course(d.w, d.row, app.objects.all('wall'), app.objects.all('opening').filter((o) => o.wall === d.w.id)), lo = Math.min(...cs.map((x) => x.s0)), hi = Math.max(...cs.map((x) => x.s1));
      d.s0 = Math.max(d.s0, lo); d.s1 = Math.min(d.s1, hi);
      app.wallView.live = null;
      this._liveBed = { s0: d.s0, s1: d.s1 };
      app.concreteGear.set('trowel', new THREE.Vector3(p.x, rowY(d.w, d.row), p.z), Math.atan2(ax.ux, ax.uz));
      app.sfx.scrapeLevel(0.2);
      this._showBed();
    }
  }

  up() {
    const app = this.app, d = this.drag;
    this.drag = null;
    this.hold = null;
    app.ui.hideMeasure();
    this._preview(true);
    if (!d) return;
    if (this.mode === 'line') {
      const L = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
      if (L < 0.3 / MODEL_SCALE) { app.ui.toast('Стена короче 30 см — проведите длиннее'); return; }
      const rec = { type: 'wall', a: d.a.map((x) => +x.toFixed(5)), b: d.b.map((x) => +x.toFixed(5)), kind: this.kind, height: app.settings.wallHeight || 1500 };
      rec.base = +this._baseOf(rec).toFixed(5);
      const w = app.journal.act('wall-line', { kind: rec.kind }, app.clock, () => app.objects.add(rec));
      const added = app.objects.all('wall').at(-1);
      this.lastWall = added?.id; this._focus(added);
      app.ui.toast(`${KINDS[rec.kind].name}: стена ${(L * MODEL_SCALE).toFixed(2).replace('.', ',')} м, ${rows(rec)} рядов. Дальше — «Раствор» и «Класть»`);
      void w;
    } else if (this.mode === 'opening') {
      this._showOpening(true);
      this._addOpening(d);
    } else if (this.mode === 'mortar') {
      app.sfx.scrapeStop();
      app.concreteGear.set(null);
      this._liveBed = null; this._showBed();
      if (d.s1 - d.s0 < 50) return;
      // mortar stays on the masonry under it (none over an opening; on a lintel's bearings)
      const opens = app.objects.all('opening').filter((o) => o.wall === d.w.id);
      const parts = beddable(d.w, d.row, app.objects.all('wall'), opens).map(([a, b]) => [Math.max(a, d.s0), Math.min(b, d.s1)]).filter(([a, b]) => b - a > 30);
      if (!parts.length) return;
      app.journal.act('mortar', { wall: d.w.id, row: d.row }, app.clock, () => { for (const [a, b] of parts) app.objects.add({ type: 'bed', wall: d.w.id, row: d.row, s0: +a.toFixed(1), s1: +b.toFixed(1) }); });
    }
  }

  interrupt() { this.drag = null; this.hold = null; this._preview(true); this.app.ui.hideMeasure(); }

  // holding the finger in «lay»: the next unit as soon as the last one is set
  update() {
    if (this.hold && this.mode === 'lay' && !this.app.physJob && !this.app.physLoading && performance.now() > this.hold.next) this._lay(this.hold.p, true);
  }

  // ---- line ----------------------------------------------------------------------------
  _snap(q, from) {
    let [x, z] = q;
    // to another wall's end (a corner) …
    for (const w of this.app.objects.all('wall')) for (const e of [w.a, w.b]) if (Math.hypot(e[0] - x, e[1] - z) < 0.04) return [e[0], e[1]];
    // … else along the axes from the start
    if (from) {
      const dx = x - from[0], dz = z - from[1], ang = Math.atan2(dz, dx), k = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(ang - k) < 0.12) { const L = Math.hypot(dx, dz); x = from[0] + Math.cos(k) * L; z = from[1] + Math.sin(k) * L; }
    }
    return [x, z];
  }

  // the foundation under the wall: its highest point (the first bed evens out the rest)
  _baseOf(w) {
    const t = this.app.terrain, ax = axis(w), half = KINDS[w.kind].T / 2 * S;
    let m = -Infinity;
    for (let s = 0; s <= ax.L; s += 20) for (const o of [-half, 0, half]) {
      const x = w.a[0] + ax.ux * s * S + ax.nx * o, z = w.a[1] + ax.uz * s * S + ax.nz * o;
      if (t.inside(x, z)) m = Math.max(m, t.heightAt(x, z));
    }
    return Number.isFinite(m) ? m : 0.1;
  }

  _preview(off) {
    const v = this.app.wallView;
    if (off || !this.drag || this.mode !== 'line') { if (this._line) this._line.visible = false; return; }
    if (!this._line) {
      this._line = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x7fd18a, transparent: true, opacity: 0.35, depthWrite: false }));
      v.group.add(this._line);
    }
    const { a, b } = this.drag, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-4) return;
    const T = KINDS[this.kind].T * S, h = 0.01;
    const y = this.app.terrain.heightAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    this._line.visible = true;
    this._line.position.set((a[0] + b[0]) / 2, y + h / 2, (a[1] + b[1]) / 2);
    this._line.rotation.set(0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), 0);
    this._line.scale.set(L, h, T);
  }

  // the mortar being spread (drawn as a bed record in the view)
  _showBed() {
    const v = this.app.wallView;
    v.liveBed = this._liveBed && this.drag ? { wall: this.drag.w.id, row: this.drag.row, ...this._liveBed } : null;
    v.dirty = true;
  }

  // ---- openings ------------------------------------------------------------------------
  // a door / window opening: its width is dragged along the wall, its height is the
  // standard one snapped to the courses; it needs room for the lintel's bearing each side
  _addOpening(d) {
    const app = this.app, w = d.w, k = KINDS[w.kind], o = OPENINGS[this.openKind], ax = axis(w);
    const width = d.s1 - d.s0;
    if (width < o.minW) { app.ui.toast(`${o.name}: проведите шире — не меньше ${o.minW} мм`); return; }
    if (d.s0 < 250 || d.s1 > ax.L - 250) { app.ui.toast('До угла нужно ≥ 250 мм — там опирается перемычка'); return; }
    const rec = { type: 'opening', wall: w.id, kind: this.openKind, s0: d.s0, s1: d.s1, y0: o.y0, y1: o.y1 };
    const { l1 } = openingRows(w, rec);
    if (l1 > rows(w)) { app.ui.toast(`Стена низкая для ${this.openKind === 'door' ? 'двери' : 'окна'} с перемычкой — нужна высота 2,7 м`); return; }
    const others = app.objects.all('opening').filter((x) => x.wall === w.id);
    if (others.some((x) => x.s0 < d.s1 + 500 && x.s1 > d.s0 - 500)) { app.ui.toast('Между проёмами нужен простенок ≥ 500 мм'); return; }
    // masonry already there?
    const { r0, r1 } = openingRows(w, rec);
    if (app.objects.all('unit').some((u) => u.wall === w.id && u.row >= r0 && u.row < l1 && u.s0 < d.s1 && u.s1 > d.s0)) {
      app.ui.toast('Здесь уже выложено — проём размечают до кладки этих рядов'); return;
    }
    app.journal.act('opening', { wall: w.id, kind: rec.kind }, app.clock, () => app.objects.add(rec));
    app.ui.toast(`${o.name} ${width} мм: ряды ${r0 + 1}–${r1}, перемычка в ряду ${r1 + 1}`);
    void k;
  }

  _showOpening(off) {
    const v = this.app.wallView;
    v.liveOpening = off || !this.drag ? null : { wall: this.drag.w.id, kind: this.openKind, s0: this.drag.s0, s1: this.drag.s1, y0: OPENINGS[this.openKind].y0, y1: OPENINGS[this.openKind].y1 };
    v.dirty = true;
  }

  // ---- lay -----------------------------------------------------------------------------
  _lay(p, quiet = false) {
    const app = this.app, n = this.nearest(p);
    if (!n) { if (!quiet) app.ui.toast('Коснитесь у стены (сначала проведите её линию)'); return; }
    const w = n.w, st = wallState(w, app.objects);
    this.lastWall = w.id; this._focus(w);
    if (st.cur >= st.n) { if (!quiet) app.ui.toast('Стена выложена до верха'); this.hold = null; return; }
    const r = st.cur, cs = course(w, r, st.walls, st.opens);
    const free = cs.filter((sl) => !taken(st.units, r, sl));
    // the free place nearest the finger that has mortar under it
    const beds = st.beds.filter((b) => b.row === r).map((b) => [b.s0, b.s1]);
    // (a lintel needs mortar under its two bearings)
    const bedded = (sl) => sl.lintel ? covered(beds, sl.s0, sl.s0 + 200) > 0.7 && covered(beds, sl.s1 - 200, sl.s1) > 0.7 : covered(beds, sl.s0, sl.s1) > 0.7;
    const ok = free.filter(bedded).sort((a, b) => Math.abs((a.s0 + a.s1) / 2 - n.s) - Math.abs((b.s0 + b.s1) / 2 - n.s));
    if (!ok.length) {
      if (!quiet) app.ui.toast(`Ряд ${r + 1}: сначала «Раствор» — ${w.kind === 'block' ? (r === 0 ? 'цементный раствор' : 'клей') : 'раствор'} под ${w.kind === 'block' ? 'блок' : 'кирпич'}`);
      this.hold = null;
      return;
    }
    const sl = ok[0], target = slotPose(w, r, sl);
    const unit = { type: 'unit', wall: w.id, row: r, i: sl.i, s0: +sl.s0.toFixed(1), s1: +sl.s1.toFixed(1), off: sl.off, kind: w.kind, s: target.s.toArray().map((x) => +x.toFixed(6)) };
    if (sl.lintel) unit.lintel = true;
    if (sl.cut) { unit.cut = true; app.ui.toast(cutName(w, sl)); }
    if (sl.lintel) app.ui.toast(`Перемычка ${Math.round(sl.s1 - sl.s0)} мм — по 250 мм опоры с каждой стороны`);
    const go = () => { app.physLoading = false; app.physJob = new LayJob(app, w, unit, target, st); };
    if (physicsReady()) go();
    else { app.physLoading = true; loadPhysics().then(go, () => { app.physLoading = false; app.ui.toast('Физика не загрузилась'); }); }
    if (this.hold) this.hold.next = performance.now() + 120;
  }

  // ---- delete --------------------------------------------------------------------------
  _delete(p, e) {
    const app = this.app, id = app.pickObject(e.clientX, e.clientY, 'wall');
    if (id && app.objects.get(id)?.type === 'opening') {
      const o = app.objects.get(id);
      if (app.objects.all('unit').some((u) => u.wall === o.wall && u.lintel && u.s0 < o.s1 && u.s1 > o.s0)) { app.ui.toast('Над проёмом уже перемычка — сначала снимите её'); return; }
      app.journal.act('opening-remove', {}, app.clock, () => app.objects.remove(id));
      app.ui.toast('Проём убран — ряды будут сплошными');
      return;
    }
    if (id) {
      const u = app.objects.get(id);
      const rowsUp = u.lintel ? KINDS[u.kind].lintelRows : 1;
      const above = app.objects.all('unit').some((o) => o.wall === u.wall && o.row === u.row + rowsUp && o.s0 < u.s1 && o.s1 > u.s0);
      if (above) { app.ui.toast('Сверху лежит следующий ряд — сначала снимите его'); return; }
      app.journal.act('unit-remove', {}, app.clock, () => app.objects.remove(id));
      return;
    }
    const n = this.nearest(p);
    if (n && !app.objects.all('unit').some((u) => u.wall === n.w.id)) {
      app.journal.act('wall-remove', {}, app.clock, () => { for (const b of [...app.objects.all('bed'), ...app.objects.all('opening')].filter((b) => b.wall === n.w.id)) app.objects.remove(b.id); app.objects.remove(n.w.id); });
      app.ui.toast('Линия стены убрана');
    } else app.ui.toast('Коснитесь блока / кирпича, чтобы снять его');
  }
}

// One unit: lowered by hand onto the mortar a little off, it settles (physics: the
// units around, the bed, the foundation), then three taps of the rubber mallet bring it
// to the cord and the level. One journal entry.
class LayJob {
  constructor(app, w, unit, target, st) {
    this.app = app;
    this.unit = unit;
    this.target = target;
    this.pending = app.journal.begin('lay', { wall: w.id, row: unit.row, i: unit.i }, app.clock);
    const p = target.p, s = target.s, pad = 0.12;
    this.ep = new Episode(app.terrain, p.x - pad, p.z - pad, p.x + pad, p.z + pad, 2, 120);
    this.ep.maxV = 0.6;
    // supports: units already laid near it, the mortar of this course
    for (const u of app.objects.all('unit')) {
      const q = new THREE.Vector3().fromArray(u.p);
      if (q.distanceTo(p) > 0.2) continue;
      this.ep.staticBox(q, new THREE.Quaternion().fromArray(u.q), u.s[0] / 2 * 0.999, u.s[1] / 2, u.s[2] / 2 * 0.999);
    }
    const k = KINDS[w.kind], bedT = (unit.row === 0 ? k.bed0 : k.bed) * S;
    this.ep.staticBox(new THREE.Vector3(p.x, rowY(w, unit.row) - bedT / 2, p.z), target.q, s.x / 2, bedT / 2, s.z / 2);
    // the hand puts it down a few mm off and slightly askew, 2 cm above
    const j = (m) => (Math.random() - 0.5) * m;
    const q0 = target.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(j(0.03), j(0.05), j(0.03))));
    const p0 = p.clone().add(new THREE.Vector3(j(MM(8)), MM(20), j(MM(8))));
    this.body = this.ep.box(s.x / 2, s.y / 2, s.z / 2, p0, q0, { density: unit.lintel ? 2400 : w.kind === 'block' ? 500 : 1800, friction: 0.9 });
    this.t = 0;
    this.phase = 'drop';
    this.done = false;
    this.from = new THREE.Vector3(); this.fromQ = new THREE.Quaternion();
    app.sfx?.stab?.();
    this._show();
  }

  get busy() { return !this.done; }

  update(dt) {
    if (this.done) return;
    if (this.app.journal.pending !== this.pending) { this._dispose(); return; }
    const ep = this.ep;
    ep.step(dt);
    this.t += dt;
    if (this.phase === 'drop' && (this.t > 0.35 && ep.still() || this.t > 0.9)) {
      this.phase = 'tap'; this.tapT = 0; this.taps = 0;
      ep.pose(this.body, this.from, this.fromQ);
      ep.kinematic(this.body);
    }
    if (this.phase === 'tap') {
      // the mallet: three taps, each takes half of what is left to the cord / level
      this.tapT += dt;
      const g = this.app.concreteGear, top = this.target.p.clone(); top.y += this.target.s.y / 2;
      const swing = Math.max(0, Math.sin(Math.min(1, (this.tapT % 0.22) / 0.22) * Math.PI));
      g.set('mallet', top.clone().add(new THREE.Vector3(0, MM(40) + swing * MM(90), 0)), 2 * Math.atan2(this.target.q.y, this.target.q.w));
      if (this.tapT > (this.taps + 1) * 0.22) {
        this.taps++;
        this.app.sfx?.stab?.();
        this.from.lerp(this.target.p, 0.6); this.fromQ.slerp(this.target.q, 0.6);
        ep.moveTo(this.body, this.from, this.fromQ);
        if (this.taps >= 3) { this._commit(); return; }
      }
    }
    this._show();
  }

  _pose() { const p = new THREE.Vector3(), q = new THREE.Quaternion(); this.ep.pose(this.body, p, q); return { p, q }; }

  _show() {
    const { p, q } = this._pose();
    this.app.wallView.live = { ...this.unit, p: p.toArray(), q: q.toArray() };
    this.app.wallView.dirty = true;
  }

  _commit() {
    const app = this.app;
    // what is left after the mallet: well under a millimetre and a tenth of a degree
    const p = this.from, q = this.fromQ;
    app.objects.add({ ...this.unit, p: p.toArray().map((x) => +x.toFixed(6)), q: q.toArray().map((x) => +x.toFixed(6)) });
    app.journal.commit(app.clock);
    this._dispose();
    app.concreteGear.set(null);
    const w = app.objects.get(this.unit.wall), st = w && wallState(w, app.objects);
    if (st && st.cur > this.unit.row) app.ui?.toast(st.cur >= st.n ? 'Стена выложена до верха' : `Ряд ${this.unit.row + 1} готов — проверьте уровнем; дальше раствор на ряд ${st.cur + 1}`);
  }

  _dispose() {
    this.done = true;
    this.ep?.dispose(); this.ep = null;
    this.app.wallView.live = null; this.app.wallView.dirty = true;
    if (this.app.physJob === this) this.app.physJob = null;
  }

  finish() { for (let i = 0; i < 600 && !this.done; i++) this.update(1 / 20); }

  abort() {
    if (this.done) return false;
    this.app.journal.cancel();
    this._dispose();
    this.app.concreteGear.set(null);
    return true;
  }
}
