import * as THREE from 'three';
import { MODEL_SCALE, TRAY, MAT, K } from '../config.js';
import { edges, gradeY, contains } from '../world/outlines.js';
import { cageForRect, cageForTrench, meshPanel, singleBar } from '../world/rebar.js';

const MM = (v) => v / 1000 / MODEL_SCALE;

// Formwork and reinforcement placement.
//   form:  outline – tap an outline: boards all round it, stakes outside
//          board   – drag a line: one run of boards (stakes away from the
//                    nearest outline, or to the left of the drag)
//   rebar: cage    – tap an outline: two-layer cage / strip cage with stirrups
//          bar     – drag a single bar (snaps to the axes)
//          mesh    – drag a rectangle: welded mesh sheet
//          tie     – tap a cage: tie every crossing with wire
//   both:  delete  – tap a board, stake, bar…
export class BuildTool {
  constructor(app, kind) {
    this.app = app;
    this.kind = kind; // 'form' | 'rebar'
    this.mode = kind === 'form' ? 'outline' : 'cage';
    this.drag = null;
  }

  setMode(m) { this.mode = m; this.app.ui.refresh(); }

  down(p, e) {
    const { app } = this;
    if (this.mode === 'delete') {
      const id = app.pickObject(e.clientX, e.clientY, this.kind);
      if (id) app.journal.act('delete', { id }, app.clock, () => app.objects.remove(id));
      app.ui.toast(id ? 'Удалено' : 'Здесь нечего удалять');
      return true;
    }
    if (['outline', 'cage', 'tie'].includes(this.mode)) {
      const o = app.outlineView.pickOutline(p.x, p.z);
      if (!o) { app.ui.toast('Коснитесь контура (разметки)'); return false; }
      if (this.mode === 'outline') this.formAround(o);
      else if (this.mode === 'cage') this.cageIn(o);
      else this.tie(o);
      return true;
    }
    // drag modes
    this.drag = { a: p.clone(), b: p.clone() };
    this.preview(true);
    return true;
  }

  move(p) {
    if (!this.drag) return;
    this.drag.b.copy(p);
    this.preview(true);
    const L = Math.hypot(p.x - this.drag.a.x, p.z - this.drag.a.z) * MODEL_SCALE;
    this.app.ui.showMeasure(this.mode === 'mesh'
      ? `${(Math.abs(p.x - this.drag.a.x) * MODEL_SCALE).toFixed(2)} × ${(Math.abs(p.z - this.drag.a.z) * MODEL_SCALE).toFixed(2)} м`
      : `${L.toFixed(2)} м`);
  }

  up() {
    const { app } = this;
    const d = this.drag;
    this.drag = null;
    this.preview(false);
    app.ui.hideMeasure();
    if (!d) return;
    const a = [d.a.x, d.a.z], b = [d.b.x, d.b.z];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.008 * K) return;
    if (this.mode === 'board') this.boardRun(a, b);
    else if (this.mode === 'bar') app.journal.act('rebar-bar', {}, app.clock, () => app.objects.add(singleBar(a, b, app.terrain, app.settings)));
    else if (this.mode === 'mesh') app.journal.act('rebar-mesh', {}, app.clock, () => app.objects.add(meshPanel(a[0], a[1], b[0], b[1], app.terrain, app.settings)));
  }

  interrupt() { this.drag = null; this.preview(false); this.app.ui.hideMeasure(); }

  // ---- formwork -----------------------------------------------------------------------------
  // top of the formwork: for a slab, its height above what actually lies in the pit
  // (the dug floor, or the sand / crushed-stone cushion); a strip foundation stands
  // half its height above the ground
  topFor(o) {
    if (o.kind === 'trench') return TRAY.soil + MM(this.app.settings.slab) * 0.5;
    return this.baseIn(o) + MM(this.app.settings.slab);
  }

  // level of the pit floor (median height inside the outline, away from the walls)
  baseIn(o) {
    const t = this.app.terrain, m = 0.012 * K, hs = [];
    for (let x = o.x0 + m; x <= o.x1 - m; x += 0.01) for (let z = o.z0 + m; z <= o.z1 - m; z += 0.01) hs.push(t.heightAt(x, z));
    if (!hs.length) return gradeY(o);
    hs.sort((a, b) => a - b);
    return hs[hs.length >> 1];
  }

  // one run of boards along a → b (n = outer side). Boards stand on the lowest point
  // along the run; where the ground outside is a pit wall higher than half a board,
  // they go inside the line against the wall (no room for stakes there).
  run(a, b, n, y1, extra = {}) {
    const t = this.app.terrain, T = MAT.board.t;
    const ix = -n[0] * 0.002 * K, iz = -n[1] * 0.002 * K;
    const y0 = t.minAlong(a[0] + ix, a[1] + iz, b[0] + ix, b[1] + iz);
    let out = 0, cnt = 0;
    for (let k = 0; k <= 8; k++) {
      const f = 0.1 + 0.8 * k / 8, x = a[0] + (b[0] - a[0]) * f + n[0] * T * 1.5, z = a[1] + (b[1] - a[1]) * f + n[1] * T * 1.5;
      if (t.inside(x, z)) { out += t.heightAt(x, z); cnt++; }
    }
    const wall = cnt > 0 && out / cnt > y0 + MAT.board.h * 0.5;
    return { type: 'form', a, b, n, y0, y1: Math.max(y1, y0 + MAT.board.h * 0.5), inside: wall || undefined, ...extra };
  }

  formAround(o) {
    const { app } = this;
    if (app.objects.all('form').some((r) => r.outlineId === o.id)) { app.ui.toast('Опалубка по этому контуру уже стоит'); return; }
    const y1 = this.topFor(o);
    app.journal.act('formwork', { outlineId: o.id }, app.clock, () => {
      for (const e of edges(o)) app.objects.add(this.run(e.a, e.b, e.n, y1, { outlineId: o.id }));
    });
    app.ui.toast('Опалубка установлена');
  }

  boardRun(a, b) {
    const { app } = this, t = app.terrain;
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    let n = [-dz / L, dx / L]; // left of the drag
    // stakes go away from the outline the run is next to
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const o = app.outlineView.pickOutline(mid[0] - n[0] * 0.004, mid[1] - n[1] * 0.004) || app.outlineView.pickOutline(mid[0] + n[0] * 0.004, mid[1] + n[1] * 0.004);
    if (o && contains(o, mid[0] + n[0] * 0.004, mid[1] + n[1] * 0.004)) n = [-n[0], -n[1]];
    const y1 = o ? this.topFor(o) : t.minAlong(a[0], a[1], b[0], b[1]) + MM(this.app.settings.slab);
    app.journal.act('formwork-board', {}, app.clock, () => app.objects.add(this.run(a, b, n, y1)));
  }

  // ---- reinforcement -------------------------------------------------------------------------
  cageIn(o) {
    const { app } = this;
    if (app.objects.all('cage').some((r) => r.outlineId === o.id)) { app.ui.toast('Каркас в этом контуре уже есть'); return; }
    const rec = o.kind === 'rect' ? cageForRect(o, app.terrain, app.settings) : cageForTrench(o, app.terrain, app.settings);
    app.journal.act('rebar-cage', { outlineId: o.id }, app.clock, () => app.objects.add(rec));
    app.ui.toast(`Каркас: ${rec.bars.length} стержней`);
  }

  tie(o) {
    const { app } = this;
    const cage = app.objects.all('cage').find((r) => r.outlineId === o.id);
    if (!cage) { app.ui.toast('Сначала разложите каркас'); return; }
    if (cage.tied) { app.ui.toast('Уже связано'); return; }
    app.journal.act('rebar-tie', { id: cage.id }, app.clock, () => app.objects.update(cage.id, { tied: true }));
    app.ui.toast(`Вязка: ${cage.ties.length} узлов`);
  }

  // thin line showing what is being drawn
  preview(on) {
    const app = this.app;
    if (!this.line) {
      this.line = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xf0a63a, transparent: true, opacity: 0.85, depthTest: false }));
      this.line.renderOrder = 20;
      app.scene.add(this.line);
    }
    this.line.visible = on && !!this.drag;
    if (!this.line.visible) return;
    const { a, b } = this.drag, t = app.terrain;
    const ya = t.heightAt(a.x, a.z) + 0.002 * K, yb = t.heightAt(b.x, b.z) + 0.002 * K;
    if (this.mode === 'mesh') {
      this.line.position.set((a.x + b.x) / 2, Math.max(ya, yb), (a.z + b.z) / 2);
      this.line.scale.set(Math.abs(b.x - a.x) + 1e-4, 0.0004 * K, Math.abs(b.z - a.z) + 1e-4);
      this.line.rotation.set(0, 0, 0);
    } else {
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      this.line.position.set((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2);
      this.line.scale.set(L + 1e-4, 0.0008 * K, 0.0008 * K);
      this.line.rotation.set(0, Math.atan2(-(b.z - a.z), b.x - a.x), 0);
    }
  }
}
