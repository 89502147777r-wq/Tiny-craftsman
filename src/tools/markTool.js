import { MODEL_SCALE, K, KT } from '../config.js';
import { moveHandle, sizeText } from '../world/outlines.js';

const MM = (v) => v / 1000 / MODEL_SCALE;

// Setting-out editor.
//   edit   – drag the round handles to reshape; tap an outline to select it
//   rect   – drag from corner to corner to lay out a pit
//   trench – touch-drag the first segment, then tap to add more points,
//            «Готово» to finish
export class MarkTool {
  constructor(app) {
    this.app = app;
    this.mode = 'edit';
    this.selected = null;
    this.drag = null;
    this.creating = null;
    this.trench = null;
  }

  setMode(m) {
    if (this.trench) this.finishTrench();
    this.mode = m;
    this.app.ui.refresh();
  }

  select(id) {
    this.selected = id;
    this.app.outlineView.setHandles(this.app.tool === 'mark', id);
    this.app.ui.refresh();
  }

  get rec() { return this.selected ? this.app.objects.get(this.selected) : null; }

  down(p) {
    const { app } = this, ov = app.outlineView;
    const snap = (v) => Math.round(v / 0.001) * 0.001; // 1 mm model grid
    if (this.mode === 'edit') {
      const h = ov.pickHandle(p.x, p.z, this.reach());
      if (h) {
        this.select(h.id);
        app.journal.begin('outline-edit', { id: h.id }, app.clock);
        this.drag = h;
        return true;
      }
      const o = ov.pickOutline(p.x, p.z);
      this.select(o ? o.id : null);
      return false; // let a drag on empty ground orbit the camera
    }
    if (this.mode === 'rect') {
      app.journal.begin('outline-add', { kind: 'rect' }, app.clock);
      const x = snap(p.x), z = snap(p.z);
      const rec = app.objects.add({ type: 'outline', kind: 'rect', x0: x, z0: z, x1: x + 0.001, z1: z + 0.001, depth: app.settings.target });
      this.creating = { id: rec.id, ax: x, az: z };
      this.select(rec.id);
      return true;
    }
    if (this.mode === 'trench') {
      const pt = [snap(p.x), snap(p.z)];
      if (!this.trench) {
        app.journal.begin('outline-add', { kind: 'trench' }, app.clock);
        const rec = app.objects.add({ type: 'outline', kind: 'trench', pts: [pt, [pt[0] + 0.001, pt[1]]], width: MM(app.settings.trenchWidth), depth: Math.round(app.settings.trenchDepth / MODEL_SCALE) });
        this.trench = { id: rec.id };
        this.select(rec.id);
      } else {
        const o = app.objects.get(this.trench.id);
        app.objects.update(o.id, { pts: [...o.pts, this._orth(o.pts, pt)] });
      }
      return true;
    }
    return false;
  }

  move(p) {
    const { app } = this;
    if (this.drag) {
      const o = app.objects.get(this.drag.id);
      if (o) app.objects.update(o.id, moveHandle(o, this.drag.i, p.x, p.z));
      app.ui.showMeasure(sizeText(app.objects.get(this.drag.id), MODEL_SCALE));
    } else if (this.creating) {
      const c = this.creating;
      const x = Math.round(p.x / 0.001) * 0.001, z = Math.round(p.z / 0.001) * 0.001;
      app.objects.update(c.id, { x0: Math.min(c.ax, x), x1: Math.max(c.ax, x) + 1e-4, z0: Math.min(c.az, z), z1: Math.max(c.az, z) + 1e-4 });
      app.ui.showMeasure(sizeText(app.objects.get(c.id), MODEL_SCALE));
    } else if (this.trench) {
      const o = app.objects.get(this.trench.id);
      const pts = o.pts.slice();
      pts[pts.length - 1] = this._orth(pts.slice(0, -1), [p.x, p.z]);
      app.objects.update(o.id, { pts });
      app.ui.showMeasure(sizeText(app.objects.get(o.id), MODEL_SCALE));
    }
  }

  up() {
    const { app } = this;
    app.ui.hideMeasure();
    if (this.drag) { this.drag = null; app.journal.commit(app.clock); }
    else if (this.creating) {
      const o = app.objects.get(this.creating.id);
      this.creating = null;
      if (o && o.x1 - o.x0 > 0.012 * KT && o.z1 - o.z0 > 0.012 * KT) app.journal.commit(app.clock);
      else { app.journal.cancel(); this.select(null); }
    }
    app.ui.refresh();
  }

  interrupt() { if (this.drag || this.creating) this.up(); }

  finishTrench() {
    const { app } = this;
    const t = this.trench;
    this.trench = null;
    if (!t) return;
    const o = app.objects.get(t.id);
    const pts = (o?.pts || []).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.004 * K);
    if (pts.length >= 2) { app.objects.update(t.id, { pts }); app.journal.commit(app.clock); }
    else { app.journal.cancel(); this.select(null); }
    app.ui.refresh();
  }

  // keep trench legs straight: snap to the previous direction ± 90° within 6°
  _orth(pts, pt) {
    if (pts.length < 1) return pt;
    const a = pts[pts.length - 1];
    const dx = pt[0] - a[0], dz = pt[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1e-4) return pt;
    let base = 0;
    if (pts.length >= 2) { const b = pts[pts.length - 2]; base = Math.atan2(a[1] - b[1], a[0] - b[0]); }
    const ang = Math.atan2(dz, dx), k = base + Math.round((ang - base) / (Math.PI / 2)) * (Math.PI / 2);
    return Math.abs(ang - k) < 0.105 ? [a[0] + Math.cos(k) * L, a[1] + Math.sin(k) * L] : pt;
  }

  reach() { return Math.max(0.008 * KT, this.app.rig.dist * 0.035); }

  deleteSelected() {
    const { app } = this;
    const id = this.selected;
    if (!id) return;
    app.journal.act('outline-delete', { id }, app.clock, () => {
      // formwork and cages that belong to it go too
      for (const r of app.objects.all()) if (r.outlineId === id) app.objects.remove(r.id);
      app.objects.remove(id);
    });
    this.select(null);
  }

  // live slider edits of the selected outline: begin on first input, commit on change
  edit(patch, final) {
    const { app } = this;
    if (!this.selected) return;
    if (!app.journal.pending || app.journal.pending.type !== 'outline-param') app.journal.begin('outline-param', { id: this.selected }, app.clock);
    app.objects.update(this.selected, patch);
    if (final) app.journal.commit(app.clock);
  }
}
