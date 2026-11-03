import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { FitJob, wait, hammer, drive, ease } from './fitJob.js';
import { uStrength } from './lintels.js';
import { boxOf, beltTopAt } from './freeBrick.js';
import { isSlab } from './slab.js';
import { LANG } from '../i18n/i18n.js';
import { COL_SECS, COURSES, TILTS, PILE_DEP, courseH, axisAt, colTop, colBot, cageOn, formOn, fillOf, castDone } from '../world/columns.js';

// Columns and piles by the finger («Фундамент → Колонны и сваи», columns.js). The sizes first
// (the section, the height by the courses, the slope and its side), then the stages:
//   form  – the formwork carried by the finger (its ghost green where it may stand, red where
//           not): it sits on what is under it — the foundation, the gravel, a slab, the masonry
//           (a column), the ground or the gravel (a pile: the auger bores the hole first); let go:
//           it is set up there;
//   cage  – the cage carried into a formwork with none in it (as into a lintel's): let go over it,
//           it is lowered in and tied;
//   strip – a touch on a cast column: the formwork off (once the concrete has the strength);
//   del   – a touch: a column not cast yet is taken away.
// The concrete: «Бетон» — the hose or the bucket into the formwork (concreteTools.js).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
export const COL_TABS = [['form', 'Опалубка'], ['cage', 'Каркас'], ['strip', 'Распалубка']];
// the sides of the slope (the way the top leans), as seen on the plot from the start view
export const DIRS = [[0, '→'], [45, '↗'], [90, '↑'], [135, '↖'], [180, '←'], [225, '↙'], [270, '↓'], [315, '↘']];
const LOOSE = new Set(['soil', 'sand', 'black']), GROUND = new Set(['soil', 'sand', 'gravel', 'black']);
const EN = () => LANG === 'en';
// (the lines with numbers that change: written in both languages here, not looked up)
const ON_EN = { soil: 'on the soil', sand: 'on sand', gravel: 'on gravel', black: 'on black topsoil', concrete: 'on the foundation concrete', slab: 'on the slab', belt: 'on the ring beam', masonry: 'on the masonry', column: 'on a column' };
const SEC_EN = (k) => (k.startsWith('p') ? `Pile Ø${COL_SECS[k].a}` : k.startsWith('r') ? `Round column Ø${COL_SECS[k].a}` : `Column ${COL_SECS[k].a} × ${COL_SECS[k].a}`);
const COURSE_EN = { block: 'aerated block', brick: 'brick', cinder: 'cinder block' };
const ON = { soil: 'на грунте', sand: 'на песке', gravel: 'на щебне', black: 'на чернозёме', concrete: 'на бетоне фундамента', slab: 'на перекрытии', belt: 'на поясе', masonry: 'на кладке', column: 'на колонне' };

export class ColumnWork {
  constructor(app) { this.app = app; this.sel = null; this.drag = null; }
  get stage() { const s = this.app.settings.colStage; return ['form', 'cage', 'strip', 'del'].includes(s) ? s : 'form'; }
  get sec() { return COL_SECS[this.app.settings.colSec] ? this.app.settings.colSec : 'sq250'; }
  get course() { return COURSES[this.app.settings.colCourse] ? this.app.settings.colCourse : 'block'; }
  get n() { return Math.max(1, Math.min(60, this.app.settings.colN || (this.course === 'brick' ? 36 : this.course === 'cinder' ? 14 : 11))); }
  get tiltDeg() { return TILTS.includes(this.app.settings.colTilt) ? this.app.settings.colTilt : 0; }
  get dirDeg() { return ((this.app.settings.colDir || 0) % 360 + 360) % 360; }
  get rec() { return this.app.objects.get(this.sel) || null; }
  toast(m) { this.app.ui?.toast(m); }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  get V() { return this.app.wallView.columns; }

  // the tilt: the axis's horizontal run per unit of height, the way chosen
  tiltVec() { const t = Math.tan(this.tiltDeg * Math.PI / 180), a = this.dirDeg * Math.PI / 180; return [+(t * Math.cos(a)).toFixed(5), +(-t * Math.sin(a)).toFixed(5)]; }

  // the column nearest a point (within its size + 250 mm)
  near(p, reach = 250) {
    let best = null, bd = Infinity;
    for (const r of this.app.objects.all('column')) {
      const [x, z] = axisAt(r, Math.max(colBot(r), Math.min(colTop(r), p.y))), d = Math.hypot(p.x - x, p.z - z) - MM(COL_SECS[r.sec]?.a / 2 || 125);
      if (d < MM(reach) && d < bd) bd = d, best = r;
    }
    return best;
  }
  // the column under the finger: its formwork / cage / concrete hit, else the nearest to the point
  pick(p, e, reach = 250) {
    const app = this.app;
    if (e && e.clientX !== undefined && this.V) {
      _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
      for (const h of _ray.intersectObject(this.V.group, true)) { const id = h.object.userData?.uOwner, r = id != null && app.objects.get(id); if (r?.type === 'column') return r; }
    }
    return p ? this.near(p, reach) : null;
  }

  // what is under the finger: the top it is over (masonry, a slab, a ring beam, a cast column) or
  // the ground (the foundation's concrete, the gravel, the sand, the soil) — { p, on }
  _hit(p, e) {
    const app = this.app, t = app.terrain;
    if (e && e.clientX !== undefined) {
      _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
      const v = app.wallView, list = [v.fill, v.blocks, v.bricks, v.cinders, v.lintels, v.ublocks, ...v.slabForm.decks.children, this.V?.group].filter(Boolean);
      const g = p ? p.distanceTo(_ray.ray.origin) : Infinity;
      for (const h of _ray.intersectObjects(list, true)) {
        if (h.distance >= g - MM(5)) break;
        if (!h.face || h.face.normal.y < 0.3) continue;   // (a top, not a side)
        const id = v.ownerOf(h), r = id != null && app.objects.get(id);
        if (r?.type === 'column') { if (!castDone(r)) continue; const [cx, cz] = axisAt(r, colTop(r)); return { p: new THREE.Vector3(cx, colTop(r), cz), on: 'column' }; }
        if (r?.type === 'belt') return { p: h.point.clone(), on: isSlab(r) ? 'slab' : 'belt' };
        if (r?.type === 'unit') return { p: h.point.clone(), on: 'masonry' };
        if (v.slabForm.decks.children.includes(h.object)) continue;   // (the deck of a slab not cast: not a base)
        return { p: h.point.clone(), on: 'masonry' };
      }
    }
    if (!p) return null;
    const q = p.clone(), bt = beltTopAt(app, q.x, q.z);
    if (bt > -Infinity && bt > q.y - MM(5)) return { p: q.setY(bt), on: 'belt' };
    if (!t.inside(q.x, q.z)) return { p: q, on: 'soil' };
    const i = t.index(q.x, q.z), m = t.topMat(i);
    q.y = t.heightAt(q.x, q.z);
    return { p: q, on: t.conc[i] > 1e-6 && !(t.top?.[i] > MM(20)) ? 'concrete' : m === 1 ? 'sand' : m === 2 || m === 3 ? 'gravel' : m === 4 ? 'black' : 'soil' };
  }
  // the formwork of a new column at a point: its foot (by masonry: the foot of its first course's bed)
  plan(p, e) {
    const app = this.app, H = this._hit(p, e);
    if (!H) return null;
    const q = H.p, sec = COL_SECS[this.sec], course = this.course;
    let y0 = q.y, why = null, snap = null;
    // masonry of that kind within 1,5 m: the column's foot at its first course's
    if (!sec.pile) {
      const us = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind === (course === 'block' ? 'block' : course)).map(boxOf).filter((b) => Math.hypot(b.x - q.x, b.z - q.z) < MM(1500) + b.hl);
      if (us.length) {
        const lo = us.reduce((a, b) => (b.bot < a.bot ? b : a));
        const foot = lo.bot - (lo.u.bedT ?? MM(COURSES[course].bed0));
        if (Math.abs(foot - q.y) < MM(400)) { y0 = foot; snap = true; }
      }
    }
    if (sec.pile && !GROUND.has(H.on)) why = `Сваю бурят в грунт — поставьте её опалубку на землю или щебень (сейчас ${ON[H.on]})`;
    if (!sec.pile && LOOSE.has(H.on)) why = `Колонну ставят на фундамент, плиту, перекрытие, кладку или щебёночную подушку — ${ON[H.on]} нужна свая`;
    if (app.objects.all('column').some((r) => Math.hypot(r.x - q.x, r.z - q.z) < MM((COL_SECS[r.sec].a + sec.a) / 2 + 120))) why = 'Здесь уже стоит колонна';
    if (!app.terrain.inside(q.x, q.z) && H.on !== 'slab' && H.on !== 'belt' && H.on !== 'masonry' && H.on !== 'column') why = 'За краем участка';
    const h = MM(courseH(course, this.n));
    const rec = { type: 'column', sec: this.sec, x: +q.x.toFixed(6), z: +q.z.toFixed(6), y0: +y0.toFixed(6), dep: sec.pile ? +MM(PILE_DEP).toFixed(6) : 0, h: +h.toFixed(6), tilt: this.tiltVec(), course, n: this.n, stage: 2, cage: false, fill: 0, on: H.on };
    return { rec, why, snap };
  }

  down(p, e) {
    const app = this.app, L = this.stage;
    if (app.physJob?.fit) app.physJob.finish();
    if (app.physJob) return true;
    if (L === 'form') {
      const P = this.plan(p, e);
      if (!P) return true;
      this.drag = { what: 'form', P };
      this._showForm(P);
      return true;
    }
    if (L === 'cage') { this.drag = { what: 'cage' }; this._cageMove(p, e, true); return true; }
    const r = this.pick(p, e);
    if (!r) return false;   // (no column there: the finger turns the camera)
    this.sel = r.id;
    if (L === 'strip') this._strip(r);
    else if (L === 'del') this.remove(r.id);
    return true;
  }
  // the tray (the corner of the screen): the formwork / the cage taken from it
  trayDown(p, e) {
    const L = this.stage;
    if (L !== 'form' && L !== 'cage') { this.toast(this.status()); return false; }
    if (this.app.physJob?.fit) this.app.physJob.finish();
    if (this.app.physJob) return false;
    this.drag = { what: L, tray: true };
    this.move(p, e);
    return true;
  }
  move(p, e) {
    const d = this.drag;
    if (!d) return;
    if (d.what === 'cage') { this._cageMove(p, e); return; }
    const P = this.plan(p, e);
    if (!P) return;
    d.P = P;
    this._showForm(P);
  }
  _showForm(P) {
    // (the ghost rebuilt only when it moved: a formwork is a few hundred triangles)
    const k = JSON.stringify([P.rec.x, P.rec.z, P.rec.y0, P.rec.h, P.rec.sec, P.rec.tilt, !P.why]);
    if (k !== this._gk) { this._gk = k; this.V?.setGhost(P.rec, !P.why, 'form'); }
    this.app.ui?.showMeasure?.(P.why || this._label(P.rec, P.snap));
  }
  up() {
    // (the last move may have been skipped — the place under the finger where it was let go counts)
    if (this.drag?.what === 'cage' && this.drag.stale) this._cageMove(this.drag.lastP, this.drag.lastE, false, true);
    const d = this.drag; this.drag = null; this._gk = null;
    this.V?.setGhost(null);
    this.app.ui?.hideMeasure?.();
    if (!d) return;
    if (d.what === 'cage') { if (d.target) this._cage(d.target); else if (!d.tray || d.moved) this.toast(d.why || 'Каркас — в опалубку колонны: поднесите его к опалубке без каркаса и отпустите'); return; }
    if (!d.P) return;
    if (d.P.why) { this.toast(d.P.why); return; }
    this._form(d.P.rec);
  }
  interrupt() { this.drag = null; this._gk = null; this.V?.setGhost(null); this.app.ui?.hideMeasure?.(); }
  update() {}

  _label(r, snap) {
    const sec = COL_SECS[r.sec], c = COURSES[r.course];
    const mm = Math.round(r.h / S);
    if (EN()) return `${sec.round ? 'Two-half formwork' : 'Board formwork'} — ${SEC_EN(r.sec)} ${ON_EN[r.on] || ''}: height ${mm} mm = ${r.n} course${r.n > 1 ? 's' : ''} (${COURSE_EN[r.course]})${snap ? ', foot at the foot of the first course nearby' : ''}${this.tiltDeg ? `, tilt ${this.tiltDeg}°` : ''}${sec.pile ? `, hole ${PILE_DEP} mm` : ''}`;
    return `${sec.round ? 'Опалубка из двух половин' : 'Щитовая опалубка'} — ${sec.name} ${ON[r.on] || ''}: высота ${mm} мм = ${r.n} ${rows(r.n)} (${c.name})${snap ? ', низ — по низу первого ряда кладки рядом' : ''}${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ''}${sec.pile ? `, скважина ${PILE_DEP} мм` : ''}`;
  }

  // ---- the cage carried to a formwork ----
  _cageMove(p, e, first = false, force = false) {
    const d = this.drag, now = performance.now();
    if (!first) d.moved = true;
    d.lastP = p; d.lastE = e && e.clientX !== undefined ? { clientX: e.clientX, clientY: e.clientY } : null;
    if (!first && !force && now - (d.t || 0) < 50) { d.stale = true; return; }
    d.stale = false;
    d.t = now;
    const r = this.pick(p, e, 700), ok = r && formOn(r) && !cageOn(r) && !(fillOf(r) > 0);
    d.target = ok ? r : null;
    d.why = r && !ok ? (!formOn(r) ? ((r.stage ?? 0) >= 4 ? 'Эта колонна уже готова' : 'Сначала опалубка — каркас ставят в неё') : cageOn(r) ? 'В этой опалубке каркас уже стоит' : 'В опалубку уже залит бетон') : null;
    if (ok) {
      const k = 'c' + r.id;
      if (k !== this._gk) { this._gk = k; this.V?.setGhost({ ...r }, true, 'cage'); }
      this.app.ui?.showMeasure?.(EN() ? `Cage: ${COL_SECS[r.sec].bars} × Ø${COL_SECS[r.sec].d}, stirrups Ø6 every 200 — let go, it is lowered into the formwork` : `Каркас: ${COL_SECS[r.sec].bars} × Ø${COL_SECS[r.sec].d}, хомуты Ø6 через 200 — отпустите, он опустится в опалубку`);
      return;
    }
    // (not over a formwork: the cage carried in the hand, upright, red)
    if (!p) return;
    const H = this._hit(p, e), q = H ? H.p : p, sec = this.sec, h = MM(courseH(this.course, this.n));
    const g = { type: 'column', sec, x: q.x, z: q.z, y0: q.y + MM(150), dep: 0, h, tilt: [0, 0] };
    const k = JSON.stringify([Math.round(q.x / MM(20)), Math.round(q.z / MM(20)), Math.round(q.y / MM(20)), sec, h]);
    if (k !== this._gk) { this._gk = k; this.V?.setGhost(g, false, 'cage'); }
    this.app.ui?.showMeasure?.(d.why || 'Поднесите каркас к опалубке колонны');
  }

  // ---- the stages ----
  // the formwork set up: (a pile: the auger bores the hole; on concrete: the starter bars of the
  // cage drilled and glued in) the boards / the two half shells brought in, the clamps, the level
  _form(rec) {
    const app = this.app, sec = COL_SECS[rec.sec];
    const G = this.V.formGroup(rec), pieces = G.children, parts = [G], steps = [];
    for (const c of pieces) c.visible = false;
    if (sec.pile) {
      // the auger: a helix on a stem, turning down into the ground to the depth, the spoil thrown up
      const auger = augerMesh(MM(sec.a / 2));
      parts.push(auger);
      steps.push([2.2, (u) => {
        const dep = rec.dep * Math.min(1, u * 1.15), [ax, az] = axisAt(rec, rec.y0 - dep);
        auger.position.set(ax, rec.y0 - dep, az);
        auger.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(rec.tilt[0], 1, rec.tilt[1]).normalize());
        auger.children[0].rotation.y = u * 60;
        app.sfx?.engine?.('fit-drill', u < 0.95 ? 0.22 : 0, 7);
        if (Math.random() < 0.6) app.particles?.emit(new THREE.Vector3(rec.x, rec.y0 + MM(40), rec.z), new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.08, (Math.random() - 0.5) * 0.12), 0, MM(18 + Math.random() * 20), 0.8, 0, 2);
      }]);
      steps.push([0.5, (u) => { const dep = rec.dep * (1 - u), [ax, az] = axisAt(rec, rec.y0 - dep); auger.position.set(ax, rec.y0 - dep, az); if (u >= 1) auger.visible = false; }]);
    } else if (['concrete', 'slab', 'belt', 'column'].includes(rec.on)) {
      // the starter bars: drilled into the concrete and glued in (the drill at each)
      const half = MM(sec.a / 2 - 45);
      for (const [ox, oz] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        const pnt = new THREE.Vector3(rec.x + ox, rec.y0, rec.z + oz);
        steps.push([0.3, (u) => { app.handTools.set('drill', pnt.clone().add(new THREE.Vector3(0, MM(20) * (1 - Math.min(1, u * 4)) - MM(60) * Math.max(0, Math.min(1, (u - 0.25) / 0.6)), 0)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), u * 90); app.sfx?.engine?.('fit-drill', u < 0.9 ? 0.18 : 0, 11); }]);
      }
    }
    // the pieces one by one: from their side (the boards, the halves), from above (the clamps)
    const far = MM(Math.max(500, sec.a * 2));
    for (const c of pieces) {
      const [dx, dz] = c.userData.dir, drop = c.userData.drop;
      steps.push([drop ? 0.45 : 0.4, (u) => { const k = 1 - ease(u); c.visible = true; c.position.set(dx * far * k, drop ? MM(700) * k : 0, dz * far * k); }]);
    }
    // the flanges bolted (round) / the clamps knocked tight (square); the level up the side
    const side = (y) => { const [x, z] = axisAt(rec, y); return new THREE.Vector3(x + MM(sec.a / 2 + (sec.round ? 70 : 90)), y, z); };
    if (sec.round) steps.push(...[0.3, 0.7].map((k) => drive(app, side(rec.y0 + rec.h * k), new THREE.Vector3(1, 0, 0), null, 0.35)));
    else steps.push(...[0.25, 0.7].map((k) => hammer(app, side(rec.y0 + rec.h * k), new THREE.Vector3(1, 0, 0), 2, 0.16)));
    steps.push([0.5, (u) => { const [x, z] = axisAt(rec, rec.y0 + Math.min(rec.h * 0.5, MM(700))); app.handTools.set('level', new THREE.Vector3(x, rec.y0 + Math.min(rec.h * 0.5, MM(700)), z + MM(sec.a / 2 + 60)), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), u); }]);
    steps.push(wait(0.05));
    new FitJob(app, {
      parts, steps,
      commit: () => {
        const { on, ...r } = rec; void on;
        this._save('column-form', () => { this.sel = app.objects.add(r).id; });
        const lean = rec.tilt[0] || rec.tilt[1];
        this.toast(EN() ? (sec.round
          ? `${sec.pile ? `The hole Ø${sec.a} bored ${PILE_DEP} mm deep; o` : 'O'}n it — two half shells of the formwork, the flanges bolted, plumb. Next “Cage”`
          : `Boards of 18 mm film-faced plywood with timbers, clamps every 500 mm, two braces${lean ? ' — they hold the tilt' : ''}; the top of the boards is the concrete's top. Next “Cage”`)
          : sec.round
            ? `${sec.pile ? `Скважина Ø${sec.a} на ${PILE_DEP} мм пробурена; н` : 'Н'}а неё — две полукруглые половины опалубки, фланцы стянуты болтами, по отвесу. Дальше «Каркас»`
            : `Щиты из ламинированной фанеры 18 мм с брусками, хомуты через 500 мм, два подкоса${lean ? ' — держат наклон' : ''}; верх щитов — отметка среза бетона. Дальше «Каркас»`);
      },
    });
  }
  _cage(r) {
    const app = this.app, sec = COL_SECS[r.sec];
    // the cage lowered into the formwork from above, the ties done at its top
    const g = this.V.cageGroup(r), lift = colTop(r) - colBot(r) + MM(800);
    const [tx, tz] = axisAt(r, colTop(r));
    new FitJob(app, {
      parts: [g],
      steps: [
        [0.25, (u) => { g.position.y = lift; g.visible = u > 0; }],
        [1.1, (u) => { g.position.y = lift * (1 - ease(u)); }],
        ...[0, 1].map((k) => hammer(app, new THREE.Vector3(tx + MM(k ? 60 : -60), colTop(r) + MM(120), tz + MM(sec.a / 2)), new THREE.Vector3(0, 0, 1), 2, 0.16, null, null, 'hook')),
        wait(0.1),
      ],
      commit: () => { this._save('column-cage', () => app.objects.update(r.id, { cage: true, stage: Math.max(2, r.stage ?? 0) })); this.toast(EN() ? `The cage is in the formwork: ${sec.bars} × Ø${sec.d}, stirrups Ø6 every 200 mm, spacers — 30 mm cover; starter bars 500 mm on top. Next “Concrete” — the hose or the bucket` : `Каркас в опалубке: ${sec.bars} × Ø${sec.d}, хомуты Ø6 через 200 мм, фиксаторы — защитный слой 30 мм; сверху выпуски 500 мм. Дальше «Бетон» — шланг или ведро`); },
    });
  }
  _strip(r) {
    const app = this.app, sec = COL_SECS[r.sec];
    if (!castDone(r)) { this.toast(fillOf(r) > 0 ? 'Бетон залит не доверху — долейте (шланг или ведро)' : formOn(r) ? 'Сначала залейте бетон (Бетон → шланг или ведро)' : 'Здесь нет опалубки'); return; }
    if ((r.stage ?? 0) >= 4) { this.toast('Опалубку уже сняли'); return; }
    const k = uStrength({ pourT: r.pourT }, app.clock);
    if (k < 1) { this.toast(`Бетон набирает прочность: ${Math.round(k * 100)} % — опалубку рано снимать`); return; }
    const G = this.V.formGroup(r), pieces = G.children, far = MM(Math.max(600, sec.a * 2.4));
    this._save('column-strip', () => app.objects.update(r.id, { stage: 4 }));
    const steps = [];
    // (the clamps first, then the boards / the halves apart)
    for (const c of [...pieces].sort((a, b) => b.userData.drop - a.userData.drop)) {
      const [dx, dz] = c.userData.dir, drop = c.userData.drop;
      steps.push([drop ? 0.4 : 0.45, (u) => { const q = u * u; c.position.set(dx * far * q, drop ? MM(600) * q : -MM(60) * q, dz * far * q); if (u >= 1) c.visible = false; }]);
    }
    new FitJob(app, { parts: [G], steps, commit: () => this.toast(sec.pile ? 'Опалубку сняли — свая готова: на неё можно лить ростверк или перекрытие, класть кладку' : 'Опалубку сняли — колонна готова: на неё — перекрытие или кладка, выпуски уйдут в них') });
  }

  // the picked column (no concrete in it yet) takes the height / the slope set in the menu
  restyle(r) {
    if (!r || fillOf(r) > 0 || castDone(r)) return;
    const h = +MM(courseH(this.course, this.n)).toFixed(6), tilt = this.tiltVec();
    if (Math.abs(h - r.h) < 1e-7 && tilt[0] === r.tilt[0] && tilt[1] === r.tilt[1]) return;
    this._save('column-height', () => this.app.objects.update(r.id, { h, n: this.n, course: this.course, tilt }));
    const mm = Math.round(h / S);
    this.toast(EN() ? `Column: ${mm} mm = ${this.n} course${this.n > 1 ? 's' : ''} (${COURSE_EN[this.course]})${this.tiltDeg ? `, tilt ${this.tiltDeg}°` : ', upright'}`
      : `Колонна: ${mm} мм = ${this.n} ${rows(this.n)} (${COURSES[this.course].name})${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ', вертикально'}`);
  }

  status() {
    const L = this.stage, sec = COL_SECS[this.sec];
    if (L === 'form') return EN() ? `${SEC_EN(this.sec)}, ${courseH(this.course, this.n)} mm${this.tiltDeg ? `, tilt ${this.tiltDeg}°` : ''}: drag the formwork with your finger (or from the tray) — green fits, red does not; let go in place`
      : `${sec.name}, ${courseH(this.course, this.n)} мм${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ''}: ведите пальцем опалубку (или из лотка) — зелёная встанет, красная нет; отпустите на месте`;
    if (L === 'cage') return 'Тяните каркас из лотка (или пальцем) к опалубке колонны и отпустите — он опустится в неё';
    if (L === 'strip') return 'Коснитесь залитой колонны — опалубку снимут, когда бетон наберёт прочность';
    return 'Коснитесь колонны без бетона — её уберут';
  }
  remove(id) {
    const app = this.app, r = app.objects.get(id);
    if (!r) return;
    if (fillOf(r) > 0) { this.toast('Залитую колонну не снять'); return; }
    this._save('column-remove', () => app.objects.remove(id));
    if (this.sel === id) this.sel = null;
    this.toast('Колонну убрали');
  }
}

// The tool on the bottom row («Фундамент → Колонны и сваи»): the work above, by the finger and the tray
export class ColumnTool {
  constructor(app) { this.app = app; }
  get col() { return this.app.wallTool.col; }
  get busy() { return !!this.col.drag; }
  blocksOrbit() { return this.col.stage === 'form' || this.col.stage === 'cage'; }
  down(p, e) { return this.col.down(p, e); }
  move(p, e) { this.col.move(p, e); }
  up() { this.col.up(); }
  interrupt() { this.col.interrupt(); }
  abort() { this.col.interrupt(); }
  update(dt) { this.col.update(dt); }
}

function rows(n) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'ряд' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'ряда' : 'рядов'; }

// the auger of a pile rig: a helix round a stem, its tip at the origin
function augerMesh(r) {
  const g = new THREE.Group(), spin = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.8, roughness: 0.4 });
  const pts = []; for (let k = 0; k <= 120; k++) { const t = k / 120; pts.push(new THREE.Vector3(Math.cos(t * 40) * r * 0.75, MM(40) + t * MM(1600), Math.sin(t * 40) * r * 0.75)); }
  spin.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, r * 0.22, 5), steel));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(MM(40), MM(40), MM(3200), 10), steel); stem.position.y = MM(1600); spin.add(stem);
  g.add(spin);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
