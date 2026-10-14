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
  topFor(o) { return o.kind === 'trench' ? TRAY.soil + MM(this.app.settings.slab) * 0.5 : gradeY(o) + MM(this.app.settings.slab); }

  formAround(o) {
    const { app } = this, t = app.terrain;
    if (app.objects.all('form').some((r) => r.outlineId === o.id)) { app.ui.toast('Опалубка по этому контуру уже стоит'); return; }
    const y1 = this.topFor(o);
    app.journal.act('formwork', { outlineId: o.id }, app.clock, () => {
      for (const e of edges(o)) {
        // boards stand on the lowest point just inside the edge
        const ix = -e.n[0] * 0.002 * K, iz = -e.n[1] * 0.002 * K;
        const y0 = t.minAlong(e.a[0] + ix, e.a[1] + iz, e.b[0] + ix, e.b[1] + iz);
        app.objects.add({ type: 'form', outlineId: o.id, a: e.a, b: e.b, n: e.n, y0, y1: Math.max(y1, y0 + MAT.board.h) });
      }
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
    const y0 = t.minAlong(a[0], a[1], b[0], b[1]);
    const y1 = o ? this.topFor(o) : y0 + MM(this.app.settings.slab);
    app.journal.act('formwork-board', {}, app.clock, () => app.objects.add({ type: 'form', a, b, n, y0, y1: Math.max(y1, y0 + MAT.board.h) }));
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
