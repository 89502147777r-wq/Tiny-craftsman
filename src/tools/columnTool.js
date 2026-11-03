import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { FitJob, wait, hammer, drive, ease } from './fitJob.js';
import { uStrength } from './lintels.js';
import { boxOf, beltTopAt } from './freeBrick.js';
import { isSlab } from './slab.js';
import { LANG } from '../i18n/i18n.js';
import { COURSES, COL_TYPES, PILE_DEP, BORE_DEP, holeR, secOf, typeOf, courseH, axisAt, colTop, colBot, cageOn, formOn, fillOf, castDone } from '../world/columns.js';

// Columns and piles by the finger («Фундамент → Колонны и сваи», columns.js). «Размеры» — sliders: the
// section, the height (in courses of the masonry), the slope and its side; they show the column picked
// (the last one set, or one touched) and change it while it has no concrete. The stages, in either
// order — the cage first or the formwork first:
//   form  – the formwork carried by the finger (green where it may stand, red where not): onto the base
//           under it (the foundation, the gravel, a slab, the masonry; a pile — the ground, the auger
//           bores the hole first), or round a cage standing there already;
//   cage  – the cage carried by the finger: into a formwork with none in it, or stood on its own — on
//           concrete (its starter bars drilled in), into a pile's hole (bored first), or into the cage of
//           a foundation not cast yet: its bars go down into it, their feet bent out and wired to it;
//   strip – a touch on a cast column: the formwork off (once the concrete has the strength);
//   del   – a touch: a column not cast yet is taken away.
// The concrete: «Бетон» — the hose or the bucket into the formwork (concreteTools.js).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
export const COL_TABS = [['form', 'Опалубка'], ['cage', 'Каркас'], ['strip', 'Распалубка']];
// the sides of the slope (the way the top leans), as seen on the plot from the start view
export const DIRS = [[0, '→'], [45, '↗'], [90, '↑'], [135, '↖'], [180, '←'], [225, '↙'], [270, '↓'], [315, '↘']];
export const TYPE_NAMES = { sq: 'Квадратная колонна', rd: 'Круглая колонна', pile: 'Свая' };
const LOOSE = new Set(['soil', 'sand', 'black']), GROUND = new Set(['soil', 'sand', 'gravel', 'black']);
const EN = () => LANG === 'en';
// (the lines with numbers that change: written in both languages here, not looked up)
const ON_EN = { soil: 'on the soil', sand: 'on sand', gravel: 'on gravel', black: 'on black topsoil', concrete: 'on the foundation concrete', slab: 'on the slab', belt: 'on the ring beam', masonry: 'on the masonry', column: 'on a column', fcage: 'tied into the foundation cage' };
const SEC_EN = (q) => (q.pile ? `Pile Ø${q.a}` : q.round ? `Round column Ø${q.a}` : `Column ${q.a} × ${q.a}`);
const COURSE_EN = { block: 'aerated block', brick: 'brick', cinder: 'cinder block' };
const ON = { soil: 'на грунте', sand: 'на песке', gravel: 'на щебне', black: 'на чернозёме', concrete: 'на бетоне фундамента', slab: 'на перекрытии', belt: 'на поясе', masonry: 'на кладке', column: 'на колонне', fcage: 'с привязкой к каркасу фундамента' };
const segD = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-12, k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(ax + dx * k - x, az + dz * k - z); };

export class ColumnWork {
  constructor(app) { this.app = app; this.sel = null; this.drag = null; }
  get s() { return this.app.settings; }
  get stage() { const s = this.s.colStage; return ['form', 'cage', 'strip', 'del'].includes(s) ? s : 'form'; }
  // the kind and the size (the old setting — a fixed section — read once)
  get type() { const t = this.s.colType; if (COL_TYPES[t]) return t; const o = this.s.colSec || ''; return o.startsWith('p') ? 'pile' : o.startsWith('r') ? 'rd' : 'sq'; }
  get a() { const T = COL_TYPES[this.type], v = this.s.colA || +(String(this.s.colSec || '').match(/\d+/)?.[0] || T.def); return Math.max(T.min, Math.min(T.max, Math.round(v / 10) * 10)); }
  get spec() { return secOf({ sec: this.type, a: this.a }); }
  get sec() { return this.type; }
  get course() { return COURSES[this.s.colCourse] ? this.s.colCourse : 'block'; }
  get n() { return Math.max(1, Math.min(60, this.s.colN || (this.course === 'brick' ? 36 : this.course === 'cinder' ? 14 : 11))); }
  get tiltDeg() { return Math.max(0, Math.min(15, Math.round(this.s.colTilt || 0))); }
  get dirDeg() { return ((Math.round((this.s.colDir || 0) / 45) * 45) % 360 + 360) % 360; }
  get rec() { return this.app.objects.get(this.sel) || null; }
  toast(m) { this.app.ui?.toast(m); }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  get V() { return this.app.wallView.columns; }

  // the tilt: the axis's horizontal run per unit of height, the way chosen
  tiltVec() { const t = Math.tan(this.tiltDeg * Math.PI / 180), a = this.dirDeg * Math.PI / 180; return [+(t * Math.cos(a)).toFixed(5), +(-t * Math.sin(a)).toFixed(5)]; }
  // the sizes as the menu has them (for a new column, or the picked one)
  sizes() { return { sec: this.type, a: this.a, h: +MM(courseH(this.course, this.n)).toFixed(6), n: this.n, course: this.course, tilt: this.tiltVec() }; }

  // the column nearest a point (within its size + reach mm)
  near(p, reach = 250) {
    let best = null, bd = Infinity;
    for (const r of this.app.objects.all('column')) {
      const [x, z] = axisAt(r, Math.max(colBot(r), Math.min(colTop(r), p.y))), d = Math.hypot(p.x - x, p.z - z) - MM(secOf(r).a / 2);
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

  // the cage of a foundation not cast yet under (x, z) (rebar.js: the strip's / the pit's cage, a mesh):
  // { y0 (the foundation's top: its boards' top, or the top bars + 50), anc (mm down to its bottom bars) }
  fcage(x, z, half) {
    const app = this.app, reach = half + MM(120);
    let top = -Infinity, bot = Infinity;
    for (const c of app.objects.all('cage')) {
      if (c.beltId != null) continue;
      for (const b of c.bars || []) { const [ax, ay, az, bx, by, bz] = b; if (Math.abs(ay - by) > MM(30) || segD(x, z, ax, az, bx, bz) > reach) continue; top = Math.max(top, ay, by); bot = Math.min(bot, ay, by); }
    }
    for (const m of app.objects.all('mesh')) if (x >= Math.min(m.x0, m.x1) && x <= Math.max(m.x0, m.x1) && z >= Math.min(m.z0, m.z1) && z <= Math.max(m.z0, m.z1)) { top = Math.max(top, m.y); bot = Math.min(bot, m.y); }
    if (top === -Infinity) return null;
    const t = app.terrain;
    if (t.inside(x, z) && t.conc[t.index(x, z)] > 1e-6 && t.heightAt(x, z) > top) return null;   // (cast already: it is concrete now)
    let ft = -Infinity;
    for (const f of app.objects.all('form')) { if (!f.a || !f.b) continue; const az = f.a[f.a.length - 1], bz = f.b[f.b.length - 1]; if (segD(x, z, f.a[0], az, f.b[0], bz) < MM(1500)) ft = Math.max(ft, f.y1 ?? -Infinity); }
    const y0 = ft > top ? ft : top + MM(50);
    return { y0, anc: Math.max(100, Math.round((y0 - bot) / S)) };
  }

  // what is under the finger: the top it is over (masonry, a slab, a ring beam, a cast column), the cage
  // of a foundation not cast yet (for a cage), or the ground (the concrete, the gravel, the sand, the soil)
  _hit(p, e, cage = false) {
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
    const fc = this.fcage(q.x, q.z, MM(this.a / 2));
    if (fc) return cage ? { p: q.setY(fc.y0), on: 'fcage', anc: fc.anc } : { p: q, on: 'fcage', open: true };
    if (!t.inside(q.x, q.z)) return { p: q, on: 'soil' };
    const i = t.index(q.x, q.z), m = t.topMat(i);
    q.y = t.heightAt(q.x, q.z);
    return { p: q, on: t.conc[i] > 1e-6 && !(t.top?.[i] > MM(20)) ? 'concrete' : m === 1 ? 'sand' : m === 2 || m === 3 ? 'gravel' : m === 4 ? 'black' : 'soil' };
  }
  // a new column at a point (its formwork or its cage): its foot (by masonry: the foot of its first course's bed)
  plan(p, e, what = 'form') {
    const app = this.app, H = this._hit(p, e, what === 'cage');
    if (!H) return null;
    const q = H.p, sec = this.spec, course = this.course;
    let y0 = q.y, why = null, snap = null;
    // masonry of that kind within 1,5 m: the column's foot at its first course's
    if (!sec.pile && H.on !== 'fcage' && !(what === 'cage' && GROUND.has(H.on))) {
      const us = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind === (course === 'block' ? 'block' : course)).map(boxOf).filter((b) => Math.hypot(b.x - q.x, b.z - q.z) < MM(1500) + b.hl);
      if (us.length) {
        const lo = us.reduce((a, b) => (b.bot < a.bot ? b : a));
        const foot = lo.bot - (lo.u.bedT ?? MM(COURSES[course].bed0));
        if (Math.abs(foot - q.y) < MM(400)) { y0 = foot; snap = true; }
      }
    }
    if (H.open) why = 'Здесь арматура фундамента — сначала каркас колонны (он привяжется к ней), опалубку — после бетона фундамента';
    else if (sec.pile && !GROUND.has(H.on)) why = `Сваю бурят в грунт — поставьте её на землю или щебень (сейчас ${ON[H.on]})`;
    // (a column's cage on the ground / loose fill: its hole bored first — the formwork alone does not go there)
    const bore = !sec.pile && what === 'cage' && GROUND.has(H.on);
    if (why) { /* (said above) */ } else if (!sec.pile && !bore && LOOSE.has(H.on)) why = `Колонну ставят на фундамент, плиту, перекрытие, кладку или щебёночную подушку — ${ON[H.on]} нужна свая`;
    if (app.objects.all('column').some((r) => Math.hypot(r.x - q.x, r.z - q.z) < MM((secOf(r).a + sec.a) / 2 + 120))) why = 'Здесь уже стоит колонна';
    if (!app.terrain.inside(q.x, q.z) && !['slab', 'belt', 'masonry', 'column'].includes(H.on)) why = 'За краем участка';
    const rec = { type: 'column', ...this.sizes(), x: +q.x.toFixed(6), z: +q.z.toFixed(6), y0: +y0.toFixed(6), dep: sec.pile ? +MM(PILE_DEP).toFixed(6) : bore ? +MM(BORE_DEP).toFixed(6) : 0, stage: what === 'form' ? 2 : 0, cage: what === 'cage', fill: 0, on: H.on };
    if (H.on === 'fcage') rec.anc = H.anc;
    if (bore) rec.bored = true;
    return { rec, why, snap };
  }
  // an existing column the carried piece goes onto: a formwork round a cage standing alone, a cage
  // into a formwork with none (no concrete in either)
  target(p, e, what) {
    const r = this.pick(p, e, 350);
    if (!r || fillOf(r) > 0 || castDone(r)) return r ? { r, why: castDone(r) ? 'Эта колонна уже залита' : 'В опалубку уже залит бетон' } : null;
    if (what === 'form') {
      if (formOn(r)) return { r, why: 'Опалубка здесь уже стоит' };
      if (r.anc && !this._cast(r)) return { r, why: 'Каркас привязан к фундаменту — опалубку ставят после бетона фундамента' };
      return { r };
    }
    if (cageOn(r)) return { r, why: 'Каркас здесь уже стоит' };
    return { r };
  }
  // the foundation under a tied cage cast (its concrete up to the column's foot)
  _cast(r) { const t = this.app.terrain; return t.inside(r.x, r.z) && t.conc[t.index(r.x, r.z)] > 1e-6 && t.heightAt(r.x, r.z) > r.y0 - MM(40); }

  down(p, e) {
    const app = this.app, L = this.stage;
    if (app.physJob?.fit) app.physJob.finish();
    if (app.physJob) return true;
    const e0 = e && e.clientX !== undefined ? [e.clientX, e.clientY] : null;
    if (L === 'form' || L === 'cage') { this.drag = { what: L, e0, hit: this.pick(p, e) }; this._carry(p, e, true); return true; }
    const r = this.pick(p, e);
    if (!r) return false;   // (no column there: the finger turns the camera)
    this.select(r, false);
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
    if (p) this._carry(p, e, true);
    return true;
  }
  move(p, e) {
    const d = this.drag;
    if (!d || !p) return;
    if (d.e0 && e && e.clientX !== undefined && Math.hypot(e.clientX - d.e0[0], e.clientY - d.e0[1]) > 12) d.moved = true;
    if (!d.e0) d.moved = true;
    this._carry(p, e);
  }
  // the piece carried: over a column it may go onto — that one; else a new column under the finger
  _carry(p, e, first = false) {
    const d = this.drag, now = performance.now();
    d.lastP = p; d.lastE = e && e.clientX !== undefined ? { clientX: e.clientX, clientY: e.clientY } : null;
    if (!first && now - (d.t || 0) < 45) { d.stale = true; return; }
    d.t = now; d.stale = false;
    if (!p) return;
    const T = this.target(p, e, d.what);
    d.T = T; d.P = T ? null : this.plan(p, e, d.what);
    const show = T ? T.r : d.P?.rec, ok = T ? !T.why : d.P && !d.P.why;
    if (!show) { this._gk = null; this.V?.setGhost(null); return; }
    const k = JSON.stringify([d.what, show.id ?? 0, show.x, show.z, show.y0, show.h, show.a, show.sec, show.tilt, !!ok]);
    if (k !== this._gk) { this._gk = k; this.V?.setGhost(show, !!ok, d.what); }
    this.app.ui?.showMeasure?.(T ? (T.why || (d.what === 'form' ? (EN() ? 'Formwork round the cage — let go' : 'Опалубка вокруг каркаса — отпустите') : (EN() ? 'Into the formwork — let go, the cage is lowered in' : 'В опалубку — отпустите, каркас опустится в неё'))) : (d.P.why || this._label(d.P.rec, d.P.snap, d.what)));
  }
  up() {
    const d0 = this.drag;
    if (d0?.stale && d0.lastP) this._carry(d0.lastP, d0.lastE, true);   // (the last move skipped: where it was let go counts)
    const d = this.drag; this.drag = null; this._gk = null;
    this.V?.setGhost(null);
    this.app.ui?.hideMeasure?.();
    if (!d) return;
    // a touch (no move) on a column that takes nothing here: it is picked (the sliders show its sizes)
    if (!d.moved && !d.tray && d.hit && (!d.T || d.T.why)) { this.select(d.hit); return; }
    if (d.T) { if (d.T.why) { this.toast(d.T.why); return; } if (d.what === 'form') this._formOn(d.T.r); else this._cage(d.T.r); return; }
    if (!d.P) { if (!d.tray || d.moved) this.toast(d.what === 'cage' ? 'Поднесите каркас к опалубке колонны или на основание' : 'Поднесите опалубку к месту колонны'); return; }
    if (d.P.why) { this.toast(d.P.why); return; }
    if (d.what === 'form') this._form(d.P.rec); else this._cageNew(d.P.rec);
  }
  interrupt() { this.drag = null; this._gk = null; this.V?.setGhost(null); this.app.ui?.hideMeasure?.(); }
  update() {}

  // a column picked: the menu's sizes become its own (the sliders show them)
  select(r, say = true) {
    this.sel = r.id;
    const q = secOf(r), t = Math.hypot(r.tilt[0], r.tilt[1]);
    Object.assign(this.s, { colType: typeOf(r), colA: q.a, colCourse: r.course || 'block', colN: r.n || this.n, colTilt: Math.round(Math.atan(t) * 180 / Math.PI), ...(t > 1e-6 ? { colDir: (Math.round(Math.atan2(-r.tilt[1], r.tilt[0]) * 180 / Math.PI / 45) * 45 + 360) % 360 } : {}) });
    this.app.ui?.refresh();
    if (say) this.toast(fillOf(r) > 0 || castDone(r) ? (EN() ? `${SEC_EN(q)}: cast — its sizes stay` : `${q.name}: залита — размеры уже не меняются`) : (EN() ? `${SEC_EN(q)} picked — the sliders in «Sizes» change it` : `${q.name} выбрана — ползунки в «Размерах» меняют её`));
  }

  _label(r, snap, what = 'form') {
    const sec = secOf(r), c = COURSES[r.course], mm = Math.round(r.h / S), cage = what === 'cage';
    if (EN()) return `${cage ? 'Cage' : sec.round ? 'Two-half formwork' : 'Board formwork'} — ${SEC_EN(sec)} ${ON_EN[r.on] || ''}: height ${mm} mm = ${r.n} course${r.n > 1 ? 's' : ''} (${COURSE_EN[r.course]})${snap ? ', foot at the foot of the first course nearby' : ''}${this.tiltDeg ? `, tilt ${this.tiltDeg}°` : ''}${sec.pile || r.bored ? `, a hole ${Math.round(r.dep / S)} mm bored first` : ''}${r.anc ? `, ${r.anc} mm into the foundation` : ''}`;
    return `${cage ? 'Каркас' : sec.round ? 'Опалубка из двух половин' : 'Щитовая опалубка'} — ${sec.name} ${ON[r.on] || ''}: высота ${mm} мм = ${r.n} ${rows(r.n)} (${c.name})${snap ? ', низ — по низу первого ряда кладки рядом' : ''}${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ''}${sec.pile || r.bored ? `, сначала яма ${Math.round(r.dep / S)} мм` : ''}${r.anc ? `, в фундамент на ${r.anc} мм` : ''}`;
  }

  // ---- the stages ----
  // before a new column: a pile's hole bored by the auger; on concrete the starter bars drilled and glued in
  _prep(rec, parts, steps) {
    const app = this.app, sec = secOf(rec);
    if (sec.pile || rec.bored) {
      // the auger turning down to the depth, the spoil thrown round; then lifted out
      const auger = augerMesh(MM(holeR(rec)));
      parts.push(auger);
      steps.push([2.2, (u) => {
        const dep = rec.dep * Math.min(1, u * 1.15), [ax, az] = axisAt(rec, rec.y0 - dep);
        auger.position.set(ax, rec.y0 - dep, az);
        auger.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(rec.tilt[0], 1, rec.tilt[1]).normalize());
        auger.children[0].rotation.y = u * 60;
        app.sfx?.engine?.('col-auger', u < 0.95 ? 0.5 : 0); app.sfx?.engine?.('col-bore', u < 0.95 ? 0.4 : 0);
        if (Math.random() < 0.6) app.particles?.emit(new THREE.Vector3(rec.x, rec.y0 + MM(40), rec.z), new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.08, (Math.random() - 0.5) * 0.12), 0, MM(18 + Math.random() * 20), 0.8, 0, 2);
      }]);
      steps.push([0.5, (u) => { const dep = rec.dep * (1 - u), [ax, az] = axisAt(rec, rec.y0 - dep); auger.position.set(ax, rec.y0 - dep, az); if (u >= 1) auger.visible = false; }]);
    } else if (['concrete', 'slab', 'belt', 'column'].includes(rec.on)) {
      const half = MM(sec.a / 2 - 45);
      for (const [ox, oz] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        const pnt = new THREE.Vector3(rec.x + ox, rec.y0, rec.z + oz);
        steps.push([0.3, (u) => { app.handTools.set('drill', pnt.clone().add(new THREE.Vector3(0, MM(20) * (1 - Math.min(1, u * 4)) - MM(60) * Math.max(0, Math.min(1, (u - 0.25) / 0.6)), 0)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), u * 90); app.sfx?.engine?.('fit-drill', u < 0.9 ? 0.18 : 0, 11); }]);
      }
    }
  }
  // the formwork's pieces brought in one by one (the boards / the halves from their side, the clamps
  // from above), bolted / knocked tight, the level up the side
  _pieces(r, G, steps) {
    const app = this.app, sec = secOf(r), far = MM(Math.max(500, sec.a * 2));
    for (const c of G.children) {
      c.visible = false;
      const [dx, dz] = c.userData.dir, drop = c.userData.drop;
      steps.push([drop ? 0.45 : 0.4, (u) => { const k = 1 - ease(u); c.visible = true; c.position.set(dx * far * k, drop ? MM(700) * k : 0, dz * far * k); if (u >= 1) app.sfx?.play?.('plank', { gap: 0.1 }); }]);
    }
    const side = (y) => { const [x, z] = axisAt(r, y); return new THREE.Vector3(x + MM(sec.a / 2 + (sec.round ? 70 : 90)), y, z); };
    if (sec.round) steps.push(...[0.3, 0.7].map((k) => drive(app, side(r.y0 + r.h * k), new THREE.Vector3(1, 0, 0), null, 0.35)));
    else steps.push(...[0.25, 0.7].map((k) => hammer(app, side(r.y0 + r.h * k), new THREE.Vector3(1, 0, 0), 2, 0.16)));
    steps.push([0.5, (u) => { const [x, z] = axisAt(r, r.y0 + Math.min(r.h * 0.5, MM(700))); app.handTools.set('level', new THREE.Vector3(x, r.y0 + Math.min(r.h * 0.5, MM(700)), z + MM(sec.a / 2 + 60)), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), u); }]);
    steps.push(wait(0.05));
  }
  _formToast(r, next) {
    const sec = secOf(r), lean = r.tilt[0] || r.tilt[1];
    const n = EN() ? (next ? ' Next “Cage”' : ' Next “Concrete” — the hose or the bucket') : (next ? ' Дальше «Каркас»' : ' Дальше «Бетон» — шланг или ведро');
    this.toast(EN() ? (sec.round ? `${sec.pile && !r.cage ? `The hole Ø${sec.a} bored ${PILE_DEP} mm deep; o` : 'O'}n it — two half shells of the formwork, the flanges bolted, plumb.${n}` : `Boards of 18 mm film-faced plywood with timbers, clamps every 500 mm, two braces${lean ? ' — they hold the tilt' : ''}.${n}`)
      : sec.round ? `${sec.pile && !r.cage ? `Скважина Ø${sec.a} на ${PILE_DEP} мм пробурена; н` : 'Н'}а неё — две полукруглые половины опалубки, фланцы стянуты болтами, по отвесу.${n}` : `Щиты из ламинированной фанеры 18 мм с брусками, хомуты через 500 мм, два подкоса${lean ? ' — держат наклон' : ''}.${n}`);
  }
  // a new column, the formwork first
  _form(rec) {
    const app = this.app, G = this.V.formGroup(rec), parts = [G], steps = [];
    this._prep(rec, parts, steps); this._pieces(rec, G, steps);
    new FitJob(app, { parts, steps, commit: () => { const { on, ...r } = rec; void on; this._save('column-form', () => { this.sel = app.objects.add(r).id; }); this._formToast(rec, true); } });
  }
  // the formwork round a cage standing already
  _formOn(r) {
    const app = this.app, G = this.V.formGroup(r), steps = [];
    this._pieces(r, G, steps);
    new FitJob(app, { parts: [G], steps, commit: () => { this.sel = r.id; this._save('column-form', () => app.objects.update(r.id, { stage: 2 })); this._formToast(r, false); } });
  }
  // the cage lowered into place from above; the ties done (at its top in a formwork, at its feet in a
  // foundation's cage)
  _lower(r, g, steps) {
    const app = this.app, sec = secOf(r), lift = colTop(r) - colBot(r) + MM(800 + (r.anc || 0)), [tx, tz] = axisAt(r, colTop(r));
    steps.push([0.25, (u) => { g.position.y = lift; g.visible = u > 0; }], [1.1, (u) => { g.position.y = lift * (1 - ease(u)); if (u >= 1) app.sfx?.play?.('rebar'); }]);
    if (r.anc) for (const [ox, oz] of [[1, 1], [-1, -1]]) steps.push(hammer(app, new THREE.Vector3(r.x + ox * MM(sec.a / 2 + 60), r.y0 - MM(r.anc) + MM(10), r.z + oz * MM(sec.a / 2 + 60)), new THREE.Vector3(0, 1, 0), 2, 0.16, null, new THREE.Vector3(1, 0, 0), 'hook'));
    else steps.push(...[0, 1].map((k) => hammer(app, new THREE.Vector3(tx + MM(k ? 60 : -60), colTop(r) + MM(120), tz + MM(sec.a / 2)), new THREE.Vector3(0, 0, 1), 2, 0.16, null, null, 'hook')));
    steps.push(wait(0.1));
  }
  _cageToast(r, alone) {
    const sec = secOf(r);
    const tail = EN() ? (alone ? (r.anc ? ` Its bars go ${r.anc} mm down into the foundation's cage, the feet bent out and wired to it. The formwork once the foundation is cast` : ' Next “Formwork” round it') : ' Next “Concrete” — the hose or the bucket')
      : (alone ? (r.anc ? ` Выпуски — на ${r.anc} мм в каркас фундамента, лапками по его нижним стержням, привязаны проволокой. Опалубку — после бетона фундамента` : ' Дальше «Опалубка» вокруг него') : ' Дальше «Бетон» — шланг или ведро');
    const hole = alone && (sec.pile || r.bored) ? (EN() ? `The hole Ø${holeR(r) * 2} bored ${Math.round(r.dep / S)} mm deep, the cage lowered into it. ` : `Яма Ø${holeR(r) * 2} на ${Math.round(r.dep / S)} мм пробурена, каркас опущен в неё. `) : '';
    this.toast(hole + (EN() ? `Cage: ${sec.bars} × Ø${sec.d}, stirrups Ø6 every 200 mm, spacers — 30 mm cover; starter bars 150 mm on top — into the slab's thickness, not out of it.${tail}` : `Каркас: ${sec.bars} × Ø${sec.d}, хомуты Ø6 через 200 мм, фиксаторы — защитный слой 30 мм; сверху выпуски 150 мм — в толщу перекрытия, не наружу.${tail}`));
  }
  // into a formwork / round nothing yet, on a column standing
  _cage(r) {
    const app = this.app, g = this.V.cageGroup(r), steps = [];
    this._lower(r, g, steps);
    new FitJob(app, { parts: [g], steps, commit: () => { this.sel = r.id; this._save('column-cage', () => app.objects.update(r.id, { cage: true })); this._cageToast(r, !formOn(r)); } });
  }
  // a new column, the cage first: stood on its own (bored / drilled first; or into a foundation's cage)
  _cageNew(rec) {
    const app = this.app, g = this.V.cageGroup(rec), parts = [g], steps = [];
    g.visible = false;
    this._prep(rec, parts, steps); this._lower(rec, g, steps);
    new FitJob(app, { parts, steps, commit: () => { const { on, ...r } = rec; void on; this._save('column-cage', () => { this.sel = app.objects.add(r).id; }); this._cageToast(rec, true); } });
  }
  _strip(r) {
    const app = this.app, sec = secOf(r);
    if (!castDone(r)) { this.toast(fillOf(r) > 0 ? 'Бетон залит не доверху — долейте (шланг или ведро)' : formOn(r) ? 'Сначала залейте бетон (Бетон → шланг или ведро)' : 'Здесь нет опалубки'); return; }
    if ((r.stage ?? 0) >= 4) { this.toast('Опалубку уже сняли'); return; }
    const k = uStrength({ pourT: r.pourT }, app.clock);
    if (k < 1) { this.toast(`Бетон набирает прочность: ${Math.round(k * 100)} % — опалубку рано снимать`); return; }
    const G = this.V.formGroup(r), pieces = G.children, far = MM(Math.max(600, sec.a * 2.4));
    this._save('column-strip', () => app.objects.update(r.id, { stage: 4 }));
    const steps = [];
    for (const c of [...pieces].sort((a, b) => b.userData.drop - a.userData.drop)) {
      const [dx, dz] = c.userData.dir, drop = c.userData.drop;
      steps.push([drop ? 0.4 : 0.45, (u, job) => { const q = u * u; if (u > 0 && !job['_cs' + dx + dz]) { job['_cs' + dx + dz] = 1; app.sfx?.play?.('crowbar', { vol: 0.6, gap: 0.15 }); } c.position.set(dx * far * q, drop ? MM(600) * q : -MM(60) * q, dz * far * q); if (u >= 1) { c.visible = false; app.sfx?.play?.('plank', { gap: 0.1 }); } }]);
    }
    new FitJob(app, { parts: [G], steps, commit: () => this.toast(sec.pile ? 'Опалубку сняли — свая готова: на неё можно лить ростверк или перекрытие, класть кладку' : 'Опалубку сняли — колонна готова: на неё — перекрытие или кладка, выпуски уйдут в них') });
  }

  // the sliders being moved: the picked column (no concrete in it) shown at the new sizes, not saved yet
  editable() { const r = this.rec; return r && !(fillOf(r) > 0) && !castDone(r) ? r : null; }
  // (the kind is the column's own: a slider of another kind's size leaves its section as it is)
  _patch(r) { const z = this.sizes(); if (z.sec !== typeOf(r)) { delete z.sec; delete z.a; } return z; }
  preview() {
    const r = this.editable();
    if (!r || !this.V) return;
    this.V.patch.set(r.id, this._patch(r));
  }
  // … and saved when the slider is let go
  restyle(r = this.editable()) {
    this.V?.patch.clear();
    if (!r || fillOf(r) > 0 || castDone(r)) return;
    const z = this._patch(r);
    if (Math.abs(z.h - r.h) < 1e-7 && z.tilt[0] === r.tilt[0] && z.tilt[1] === r.tilt[1] && (z.a ?? secOf(r).a) === secOf(r).a && z.course === r.course) return;
    if (z.a && z.a !== secOf(r).a && this.app.objects.all('column').some((o) => o.id !== r.id && Math.hypot(o.x - r.x, o.z - r.z) < MM((secOf(o).a + z.a) / 2 + 120))) { this.toast('Шире не поставить — рядом другая колонна'); delete z.a; delete z.sec; }
    this._save('column-size', () => this.app.objects.update(r.id, z));
    const q = secOf({ ...r, ...z }), mm = Math.round(z.h / S);
    this.toast(EN() ? `${SEC_EN(q)}: ${mm} mm = ${this.n} course${this.n > 1 ? 's' : ''} (${COURSE_EN[this.course]})${this.tiltDeg ? `, tilt ${this.tiltDeg}°` : ', upright'}`
      : `${q.name}: ${mm} мм = ${this.n} ${rows(this.n)} (${COURSES[this.course].name})${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ', вертикально'}`);
  }

  status() {
    const L = this.stage, sec = this.spec;
    if (L === 'form') return EN() ? `${SEC_EN(sec)}, ${courseH(this.course, this.n)} mm${this.tiltDeg ? `, tilt ${this.tiltDeg}°` : ''}: drag the formwork (or from the tray) to its place or round a cage — green fits; tap a column to pick it`
      : `${sec.name}, ${courseH(this.course, this.n)} мм${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ''}: ведите опалубку (или из лотка) на место или вокруг каркаса — зелёная встанет; тап по колонне — выбрать её`;
    if (L === 'cage') return 'Тяните каркас в опалубку или на основание: на бетон; на грунт или щебень — сначала пробурят яму; в арматуру фундамента (привяжется к ней); тап по колонне — выбрать её';
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
