import * as THREE from 'three';
import { MODEL_SCALE, TRAY, MAT, K, KT, CONCRETE } from '../config.js';
import { edges, gradeY, contains } from '../world/outlines.js';
import { cageForRect, cageForTrench, meshPanel, singleBar } from '../world/rebar.js';
import { loadPhysics, physicsReady } from '../world/physics.js';
import { StripJob } from './stripJob.js';
import { RebarJob } from './rebarJob.js';
import { FitJob, hammer } from './fitJob.js';
import { runPieces } from '../world/formwork.js';

const MM = (v) => v / 1000 / MODEL_SCALE;

// Formwork and reinforcement placement.
//   form:  outline – tap an outline: boards all round it, stakes outside
//          board   – drag a line: one run of boards (stakes away from the
//                    nearest outline, or to the left of the drag)
//   rebar: cage    – tap an outline: two-layer cage / strip cage with stirrups
//          bar     – drag a single bar (snaps to the axes)
//          mesh    – drag a rectangle: welded mesh sheet
//          tie     – tap a cage: tie every crossing with wire
//          strip   – tap an outline or a board: the formwork comes off (once the
//                    concrete has set) and is stacked next to it
//   both:  delete  – tap a board, stake, bar…
export class BuildTool {
  constructor(app, kind) {
    this.app = app;
    this.kind = kind; // 'form' | 'rebar'
    this.mode = kind === 'form' ? 'outline' : 'cage';
    this.drag = null;
  }

  setMode(m) { this.mode = m; if (['strip', 'cage', 'bar', 'mesh'].includes(m)) loadPhysics().catch(() => {}); this.app.ui.refresh(); }

  down(p, e) {
    const { app } = this;
    if (this.mode === 'delete') {
      const id = app.pickObject(e.clientX, e.clientY, this.kind);
      if (id) app.journal.act('delete', { id }, app.clock, () => app.objects.remove(id));
      app.ui.toast(id ? 'Удалено' : 'Здесь нечего удалять');
      return true;
    }
    if (this.mode === 'strip') { this.strip(p, e); return true; }
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
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.008 * KT) return;
    if (this.mode === 'board') this.boardRun(a, b);
    // bars and mesh sheets are let go and lie where they come to rest (physics)
    else if (this.mode === 'bar') { const rec = singleBar(a, b, app.terrain, app.settings); this.physics(() => new RebarJob(app, rec, 'rebar-bar', {})); }
    else if (this.mode === 'mesh') { const rec = meshPanel(a[0], a[1], b[0], b[1], app.terrain, app.settings); this.physics(() => new RebarJob(app, rec, 'rebar-mesh', {})); }
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
    // the boards stand on the ground along the run, down to its lowest point on a slope —
    // but a pit / a trench crossing under the run (ground higher on both sides of it) is
    // spanned: the boards go over it on their stakes, they do not sink into it
    const N = 48, hs = [];
    for (let k = 0; k <= N; k++) { const f = k / N, x = a[0] + (b[0] - a[0]) * f + ix, z = a[1] + (b[1] - a[1]) * f + iz; if (t.inside(x, z)) hs.push(t.heightAt(x, z)); }
    let y0 = t.minAlong(a[0] + ix, a[1] + iz, b[0] + ix, b[1] + iz);
    if (hs.length > 2) {
      const lm = [], rm = [];
      hs.forEach((h, k) => (lm[k] = Math.max(h, k ? lm[k - 1] : -Infinity)));
      for (let k = hs.length - 1; k >= 0; k--) rm[k] = Math.max(hs[k], k < hs.length - 1 ? rm[k + 1] : -Infinity);
      const ok = hs.filter((h, k) => Math.min(lm[k], rm[k]) - h <= MAT.board.h * 0.5);
      if (ok.length) y0 = Math.max(y0, Math.min(...ok) - 0.001 * K);
    }
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
    const y1 = this.topFor(o), runs = edges(o).map((e) => this.run(e.a, e.b, e.n, y1, { outlineId: o.id }));
    this._fitRuns(runs, false, () => {
      app.journal.act('formwork', { outlineId: o.id }, app.clock, () => { for (const r of runs) app.objects.add(r); });
      app.ui.toast('Опалубка установлена');
    });
  }

  // the formwork put up as it is done (fitJob.js): the stakes driven in, the boards set on
  // edge from the bottom up and nailed to them, the braces; one run by hand in full, the
  // whole outline quickly
  _fitRuns(runs, one, save) {
    const app = this.app, t = app.terrain, mat = app.formView.stakes.material, steps = [], parts = [], up = new THREE.Vector3(0, 1, 0);
    const box = new THREE.BoxGeometry(1, 1, 1), stakeGeo = app.formView.stakes.geometry;
    const all = runs.map((r) => runPieces(r, t)), nPieces = all.reduce((a, p) => a + p.length, 0);
    const T = one ? 1 : Math.min(1, 4 / (nPieces * 0.09));
    const mk = (pc) => { const m = new THREE.Mesh(pc.k === 'stake' ? stakeGeo : box, mat); m.position.copy(pc.p); m.quaternion.copy(pc.q); m.scale.copy(pc.s); m.castShadow = true; m.visible = false; m.userData.keepGeo = true; parts.push(m); return m; };
    runs.forEach((r, ri) => {
      const ps = all[ri], n = new THREE.Vector3(r.n[0], 0, r.n[1]);
      // the stakes first (driven down), then the boards from the bottom, then the braces
      for (const pc of ps.filter((q) => q.k === 'stake')) {
        const m = mk(pc), top = pc.p.clone().setY(pc.p.y + pc.s.y), y0 = pc.p.y;
        if (one) steps.push([0.15, () => { m.visible = true; m.position.y = y0 + MM(150); }], hammer(app, top.clone().setY(top.y + MM(150)), up, 3, 0.16, (k) => { m.position.y = y0 + MM(150) * (1 - k / 3); }, n));
        else steps.push([0.09 * T, (u) => { m.visible = true; m.position.y = y0 + MM(80) * (1 - u); }]);
      }
      for (const pc of ps.filter((q) => q.k === 'board')) {
        const m = mk(pc), p0 = pc.p.clone();
        steps.push([(one ? 0.25 : 0.09) * T, (u) => { m.visible = true; m.position.copy(p0).addScaledVector(n, -MM(one ? 200 : 60) * (1 - u)); }]);
        if (one) { const at = p0.clone().addScaledVector(n, -MM(14)); steps.push(hammer(app, at, n.clone().negate(), 2, 0.14)); }
      }
      for (const pc of ps.filter((q) => q.k === 'brace')) { const m = mk(pc); steps.push([(one ? 0.2 : 0.06) * T, () => { m.visible = true; }]); }
    });
    new FitJob(app, { steps, parts, commit: save });
  }

  // Stripping: all the runs of the outline tapped (or the run of the board tapped)
  // come off in one go; boards and stakes are stacked beside it. While the concrete
  // behind them is still soft the first tap only warns (a second one strips anyway).
  strip(p, e) {
    const { app } = this, t = app.terrain, all = app.objects.all('form');
    let runs = [];
    const o = app.outlineView.pickOutline(p.x, p.z);
    if (o) runs = all.filter((r) => r.outlineId === o.id);
    if (!runs.length) {
      const id = app.pickObject(e.clientX, e.clientY, 'form'), r = id && app.objects.get(id);
      if (r?.type === 'form') runs = r.outlineId ? all.filter((x) => x.outlineId === r.outlineId) : [r];
    }
    if (!runs.length) { app.ui.toast('Коснитесь контура с опалубкой или доски'); return; }
    // is the concrete behind the boards hard enough?
    const key = runs.map((r) => r.id).join(',');
    const wait = this.softFor(runs);
    if (wait > 0 && !(this._force?.key === key && performance.now() < this._force.until)) {
      this._force = { key, until: performance.now() + 5000 };
      app.ui.toast(`Бетон ещё не схватился — подождите ~${Math.ceil(wait)} с. Коснитесь ещё раз, чтобы снять сейчас (бетон поплывёт)`);
      return;
    }
    this._force = null;
    if (app.physJob || app.physLoading) return;
    const T = MAT.board.t;
    const spot = this.pileSpot(runs, Math.max(...runs.map((r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) + T)));
    t.cActive = null;
    // the boards come off with real physics (Rapier, loaded on first use)
    this.physics(() => new StripJob(app, runs, spot));
  }

  // start an action that runs with real physics (Rapier is loaded on first use)
  physics(make) {
    const { app } = this;
    if (app.physJob || app.physLoading) return;
    const go = () => { app.physLoading = false; app.physJob = make(); app.ui.refresh(); };
    if (physicsReady()) { go(); return; }
    app.physLoading = true;
    app.ui.toast('Загружаю физику…');
    loadPhysics().then(go, (err) => { app.physLoading = false; console.error(err); app.ui.toast('Физика не загрузилась'); });
  }

  // seconds until the concrete next to these runs stops flowing (0 = it has set or there is none)
  softFor(runs) {
    const t = this.app.terrain, clock = this.app.clock, setT = CONCRETE.stiff * CONCRETE.cure, m = 0.01 * K;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of runs) for (const q of [r.a, r.b]) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    let wait = 0;
    const ix0 = Math.max(0, Math.floor(t.toCellX(x0 - m))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(x1 + m)));
    const iz0 = Math.max(0, Math.floor(t.toCellZ(z0 - m))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(z1 + m)));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * t.nx + ix;
      if (t.conc[i] > 1e-5) wait = Math.max(wait, t.cTime[i] + setT - clock);
    }
    return wait;
  }

  // where the stack goes: beside the longest run, outside it, clear of the braces
  pileSpot(runs, len) {
    const t = this.app.terrain, H = MAT.board.h;
    const sorted = runs.slice().sort((p, q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) - Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]));
    for (const dist of [0.045 * K, 0.07 * K, 0.025 * K]) for (const r of sorted) {
      const mx = (r.a[0] + r.b[0]) / 2, mz = (r.a[1] + r.b[1]) / 2;
      const x = mx + r.n[0] * (dist + 2.2 * H), z = mz + r.n[1] * (dist + 2.2 * H);   // n: away from the outline
      const yaw = Math.atan2(-(r.b[1] - r.a[1]), r.b[0] - r.a[0]);
      const ux = Math.cos(yaw) * len / 2, uz = -Math.sin(yaw) * len / 2;
      // the whole stack and room around it on the plot (boards slide off a stack a bit)
      const wx = Math.sin(yaw) * (2.5 * H + MM(500)), wz = Math.cos(yaw) * (2.5 * H + MM(500)), ex = ux * 1.15, ez = uz * 1.15;
      if ([[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a, b]) => t.inside(x + ex * a + wx * b, z + ez * a + wz * b))) return { x, z, yaw };
    }
    const r = sorted[0];
    return { x: t.clampX((r.a[0] + r.b[0]) / 2 + r.n[0] * 0.05 * K), z: t.clampZ((r.a[1] + r.b[1]) / 2 + r.n[1] * 0.05 * K), yaw: Math.atan2(-(r.b[1] - r.a[1]), r.b[0] - r.a[0]) };
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
    const run = this.run(a, b, n, y1);
    this._fitRuns([run], true, () => app.journal.act('formwork-board', {}, app.clock, () => app.objects.add(run)));
  }

  // ---- reinforcement -------------------------------------------------------------------------
  cageIn(o) {
    const { app } = this;
    if (app.objects.all('cage').some((r) => r.outlineId === o.id)) { app.ui.toast('Каркас в этом контуре уже есть'); return; }
    const rec = o.kind === 'rect' ? cageForRect(o, app.terrain, app.settings) : cageForTrench(o, app.terrain, app.settings);
    app.ui.toast(`Каркас: ${rec.bars.length} стержней`);
    // a slab cage is laid bar by bar with physics; a strip cage (stirrups, tied as a
    // whole) is placed as it is
    if (o.kind === 'rect') this.physics(() => new RebarJob(app, rec, 'rebar-cage', { outlineId: o.id }));
    else app.journal.act('rebar-cage', { outlineId: o.id }, app.clock, () => app.objects.add(rec));
  }

  tie(o) {
    const { app } = this;
    const cage = app.objects.all('cage').find((r) => r.outlineId === o.id);
    if (!cage) { app.ui.toast('Сначала разложите каркас'); return; }
    if (cage.tied) { app.ui.toast('Уже связано'); return; }
    // (the twister going over the crossings, the wire twisted at each; the rest done with it)
    const ties = cage.ties, n = Math.min(28, ties.length), steps = [], parts = [], up = new THREE.Vector3(0, 1, 0);
    const geo = new THREE.TorusGeometry(1, 0.28, 5, 10), mat = app.rebarView.ties.material;
    for (let k = 0; k < n; k++) {
      const tt = ties[Math.floor(k * ties.length / n)], p = new THREE.Vector3(tt[0], tt[1], tt[2]);
      const m = new THREE.Mesh(geo, mat); m.position.copy(p); m.rotation.set(Math.PI / 2, 0, tt[4] || 0.785); m.scale.setScalar(tt[3] || MM(7)); m.visible = false; m.userData.keepGeo = true; parts.push(m);
      steps.push([0.13, (u) => { app.handTools.set('hook', p.clone().add(new THREE.Vector3(0, MM(6), 0)), up, null, u * 40); if (u >= 1) m.visible = true; }]);
    }
    new FitJob(app, { steps, parts, commit: () => {
      app.journal.act('rebar-tie', { id: cage.id }, app.clock, () => app.objects.update(cage.id, { tied: true }));
      app.ui.toast(`Вязка: ${cage.ties.length} узлов`);
    } });
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
      this.line.scale.set(Math.abs(b.x - a.x) + 1e-4, 0.0004 * KT, Math.abs(b.z - a.z) + 1e-4);
      this.line.rotation.set(0, 0, 0);
    } else {
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      this.line.position.set((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2);
      this.line.scale.set(L + 1e-4, 0.0008 * KT, 0.0008 * KT);
      this.line.rotation.set(0, Math.atan2(-(b.z - a.z), b.x - a.x), 0);
    }
  }
}
