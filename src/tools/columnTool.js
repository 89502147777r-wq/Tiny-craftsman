import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { FitJob, wait, call, hammer } from './fitJob.js';
import { uStrength } from './lintels.js';
import { boxOf } from './freeBrick.js';
import { COL_SECS, COURSES, COL_STAGES, TILTS, PILE_DEP, courseH, axisAt, colTop } from '../world/columns.js';

// Columns and piles by the finger («Монолит → Колонны и сваи», columns.js): the stage chosen in
// the menu, a tap does it —
//   set   – on the slab / the foundation / the ground: a column set out there (a pile: the hole
//           bored by the auger); by masonry its foot is the foot of the masonry's first course,
//           so its top is level with the top of the n-th course; a tap on one: it is picked;
//   cage, form, pour, strip – on a column: that stage (each after the one before).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
const NAME = Object.fromEntries(COL_STAGES);

export class ColumnWork {
  constructor(app) { this.app = app; this.sel = null; this.drag = null; }
  get stage() { return NAME[this.app.settings.colStage] ? this.app.settings.colStage : 'set'; }
  get sec() { return COL_SECS[this.app.settings.colSec] ? this.app.settings.colSec : 'sq250'; }
  get course() { return COURSES[this.app.settings.colCourse] ? this.app.settings.colCourse : 'block'; }
  get n() { return Math.max(1, Math.min(60, this.app.settings.colN || (this.course === 'brick' ? 36 : this.course === 'cinder' ? 14 : 11))); }
  get tiltDeg() { return TILTS.includes(this.app.settings.colTilt) ? this.app.settings.colTilt : 0; }
  get dirDeg() { return ((this.app.settings.colDir || 0) % 360 + 360) % 360; }
  get rec() { return this.app.objects.get(this.sel) || null; }
  toast(m) { this.app.ui?.toast(m); }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }

  // the tilt: the axis's horizontal run per unit of height, the way chosen
  tiltVec() { const t = Math.tan(this.tiltDeg * Math.PI / 180), a = this.dirDeg * Math.PI / 180; return [+(t * Math.cos(a)).toFixed(5), +(-t * Math.sin(a)).toFixed(5)]; }

  // the column nearest a point (within its size + 250 mm)
  near(p) {
    let best = null, bd = Infinity;
    for (const r of this.app.objects.all('column')) {
      const [x, z] = axisAt(r, Math.max(r.y0, Math.min(colTop(r), p.y))), d = Math.hypot(p.x - x, p.z - z) - MM(COL_SECS[r.sec]?.a / 2 || 125);
      if (d < MM(250) && d < bd) bd = d, best = r;
    }
    return best;
  }
  // where the finger is: the top of what it is over (the slab, the masonry, a ring beam) or the ground
  _hit(p, e) {
    const app = this.app;
    if (e && e.clientX !== undefined) {
      _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
      const v = app.wallView, list = [v.fill, v.blocks, v.bricks, v.cinders, v.lintels, ...v.slabForm.decks.children, v.columns?.group].filter(Boolean);
      const h = _ray.intersectObjects(list, true)[0], g = p ? p.distanceTo(_ray.ray.origin) : Infinity;
      if (h && h.distance < g - MM(5) && h.face && h.face.normal.y > -0.5) return { p: h.point.clone(), on: 'top' };
    }
    return p ? { p: p.clone(), on: 'ground' } : null;
  }
  // a new column at a point: its foot (by masonry: the foot of its first course's bed)
  plan(p, e) {
    const app = this.app, H = this._hit(p, e);
    if (!H) return null;
    const q = H.p, sec = COL_SECS[this.sec], course = this.course;
    let y0 = q.y, why = null, snap = null;
    // masonry of that kind within 1,5 m: the column's foot at its first course's
    const us = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind === (course === 'block' ? 'block' : course)).map(boxOf).filter((b) => Math.hypot(b.x - q.x, b.z - q.z) < MM(1500) + b.hl);
    if (us.length) {
      const lo = us.reduce((a, b) => (b.bot < a.bot ? b : a));
      const foot = lo.bot - (lo.u.bedT ?? MM(COURSES[course].bed0));
      if (Math.abs(foot - q.y) < MM(400)) { y0 = foot; snap = true; }
    }
    if (sec.pile && H.on !== 'ground') why = 'Сваю бурят в грунт — коснитесь земли (на плите — колонна)';
    if (app.objects.all('column').some((r) => Math.hypot(r.x - q.x, r.z - q.z) < MM((COL_SECS[r.sec].a + sec.a) / 2 + 50))) why = 'Здесь уже стоит колонна';
    const h = MM(courseH(course, this.n));
    const rec = { type: 'column', sec: this.sec, x: +q.x.toFixed(6), z: +q.z.toFixed(6), y0: +y0.toFixed(6), dep: sec.pile ? +MM(PILE_DEP).toFixed(6) : 0, h: +h.toFixed(6), tilt: this.tiltVec(), course, n: this.n, stage: 0 };
    return { rec, why, snap };
  }

  down(p, e) {
    const app = this.app, L = this.stage;
    if (app.physJob?.fit) app.physJob.finish();
    const hit = this._hit(p, e)?.p || p;
    const r0 = hit && this.near(hit);
    if (L === 'set') {
      if (r0) { this.sel = r0.id; this.toast(this.status(false)); app.ui?.refresh(); return true; }
      const P = this.plan(p, e);
      if (!P) return true;
      this.drag = { P };
      app.wallView.columns?.setGhost(P.rec, !P.why);
      app.ui?.showMeasure?.(P.why || this._label(P.rec, P.snap));
      return true;
    }
    const r = r0 || this.rec;
    if (!r) { this.toast('Сначала «1 · Разметка»: коснитесь места колонны на плите или сваи на земле'); return true; }
    this.sel = r.id;
    if (L === 'cage') this._cage(r);
    else if (L === 'form') this._form(r);
    else if (L === 'pour') this._pour(r);
    else if (L === 'strip') this._strip(r);
    return true;
  }
  move(p, e) {
    if (!this.drag) return;
    const P = this.plan(p, e);
    if (!P) return;
    this.drag.P = P;
    this.app.wallView.columns?.setGhost(P.rec, !P.why);
    this.app.ui?.showMeasure?.(P.why || this._label(P.rec, P.snap));
  }
  up() {
    const d = this.drag; this.drag = null;
    this.app.wallView.columns?.setGhost(null);
    this.app.ui?.hideMeasure?.();
    if (!d) return;
    if (d.P.why) { this.toast(d.P.why); return; }
    this._set(d.P.rec);
  }
  interrupt() { this.drag = null; this.app.wallView.columns?.setGhost(null); this.app.ui?.hideMeasure?.(); }
  update() {}

  _label(r, snap) {
    const sec = COL_SECS[r.sec], c = COURSES[r.course];
    return `${sec.name}: высота ${Math.round(r.h / S)} мм = ${r.n} ${rows(r.n)} (${c.name})${snap ? ', низ — по низу первого ряда кладки рядом' : ''}${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ''}${sec.pile ? `, в грунт ${PILE_DEP} мм` : ''}`;
  }

  // ---- the stages ----
  _set(rec) {
    const app = this.app, sec = COL_SECS[rec.sec];
    const parts = [];
    let auger = null;
    const steps = [];
    if (sec.pile) {
      // the auger: a helix on a stem, turning down into the ground to the depth, the spoil thrown up
      auger = augerMesh(MM(sec.a / 2));
      parts.push(auger);
      const [x, z] = [rec.x, rec.z];
      steps.push([2.2, (u) => {
        const dep = rec.dep * Math.min(1, u * 1.15), [ax, az] = axisAt(rec, rec.y0 - dep);
        auger.position.set(ax, rec.y0 - dep, az); auger.rotation.y = u * 60;
        auger.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(rec.tilt[0], 1, rec.tilt[1]).normalize());
        auger.children[0].rotation.y = u * 60;
        app.sfx?.engine?.('fit-drill', u < 0.95 ? 0.22 : 0, 7);
        if (Math.random() < 0.6) app.particles?.emit(new THREE.Vector3(x, rec.y0 + MM(40), z), new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.08, (Math.random() - 0.5) * 0.12), 0, MM(18 + Math.random() * 20), 0.8, 0, 2);
      }]);
      steps.push([0.5, (u) => { const dep = rec.dep * (1 - u), [ax, az] = axisAt(rec, rec.y0 - dep); auger.position.set(ax, rec.y0 - dep, az); }]);
    } else {
      // the starter bars: drilled into the slab and glued in (the drill at each)
      const half = MM(sec.a / 2 - 45);
      for (const [ox, oz] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        const pnt = new THREE.Vector3(rec.x + ox, rec.y0, rec.z + oz);
        steps.push([0.32, (u) => { app.handTools.set('drill', pnt.clone().add(new THREE.Vector3(0, MM(20) * (1 - Math.min(1, u * 4)) - MM(60) * Math.max(0, Math.min(1, (u - 0.25) / 0.6)), 0)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), u * 90); app.sfx?.engine?.('fit-drill', u < 0.9 ? 0.18 : 0, 11); }]);
      }
    }
    new FitJob(app, {
      parts, steps,
      commit: () => { this._save('column-set', () => { this.sel = app.objects.add(rec).id; }); this.toast(sec.pile ? `Скважина Ø${sec.a} на ${PILE_DEP} мм пробурена — дальше «Каркас»` : `${sec.name} размечена, выпуски вклеены в плиту — дальше «Каркас»`); },
    });
  }
  _cage(r) {
    const app = this.app;
    if ((r.stage ?? 0) >= 1) { this.toast((r.stage ?? 0) >= 2 ? 'Каркас уже внутри опалубки' : 'Каркас уже стоит — дальше «Опалубка»'); return; }
    // the cage lowered / stood in, the ties done at its foot
    const g = this.app.wallView.columns._build({ ...r, stage: 1 }, 0, 'cage');
    const lift = MM(600);
    new FitJob(app, {
      parts: [g],
      steps: [
        [0.7, (u) => { g.position.y = lift * (1 - u * u * (3 - 2 * u)); }],
        ...[0, 1, 2].map((k) => hammer(app, new THREE.Vector3(r.x + MM(60), r.y0 + MM(200 + k * 300), r.z + MM(COL_SECS[r.sec].a / 2)), new THREE.Vector3(0, 0, 1), 1, 0.18, null, null, 'hammer')),
        wait(0.1),
      ],
      commit: () => { this._save('column-cage', () => app.objects.update(r.id, { stage: 1 })); this.toast(`Каркас: ${COL_SECS[r.sec].bars} × Ø${COL_SECS[r.sec].d}, хомуты Ø6 через 200 мм; сверху выпуски 500 мм по оси колонны`); },
    });
  }
  _form(r) {
    const app = this.app, sec = COL_SECS[r.sec];
    if ((r.stage ?? 0) < 1) { this.toast('Сначала «Каркас»'); return; }
    if ((r.stage ?? 0) >= 2) { this.toast((r.stage ?? 0) >= 4 ? 'Опалубку уже сняли' : 'Опалубка уже стоит'); return; }
    const g = this.app.wallView.columns._build(r, 0, 'form');
    new FitJob(app, {
      parts: [g],
      steps: [
        [0.6, (u) => { const k = 1 - u * u * (3 - 2 * u); g.position.set(MM(500) * k, 0, 0); }],
        ...(sec.round ? [] : [0, 1].map((k) => hammer(app, new THREE.Vector3(r.x, r.y0 + MM(300 + k * 700), r.z + MM(sec.a / 2 + 60)), new THREE.Vector3(0, 0, 1), 2, 0.16))),
        // the level up the side: plumb (or the slope set)
        [0.5, (u) => app.handTools.set('level', new THREE.Vector3(r.x, r.y0 + Math.min(r.h * 0.5, MM(700)), r.z + MM(sec.a / 2 + 40)), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), u)],
      ],
      commit: () => { this._save('column-form', () => app.objects.update(r.id, { stage: 2 })); this.toast(sec.round ? 'Труба-опалубка надета, выставлена по отвесу и раскреплена — дальше «Бетон»' : `Щиты из ламинированной фанеры 18 мм, хомуты через 500 мм, два подкоса${r.tilt[0] || r.tilt[1] ? ' — держат наклон' : ''}; верх щитов — отметка среза бетона. Дальше «Бетон»`); },
    });
  }
  _pour(r) {
    const app = this.app, V = app.wallView.columns;
    if ((r.stage ?? 0) < 2) { this.toast((r.stage ?? 0) < 1 ? 'Сначала «Каркас», потом «Опалубка»' : 'Сначала «Опалубка»'); return; }
    if ((r.stage ?? 0) >= 3) { this.toast('Колонна уже залита'); return; }
    // the hose's stream from above into it, the level rising; the vibrator; the top struck level
    const top = colTop(r), [tx, tz] = axisAt(r, top), stream = new THREE.Mesh(new THREE.CylinderGeometry(MM(28), MM(34), 1, 10), new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.5 }));
    const t0 = app.clock;
    new FitJob(app, {
      parts: [stream],
      steps: [
        [2.4, (u) => {
          const f = Math.min(1, u * 1.05), lvl = r.y0 - (r.dep || 0) + (top - r.y0 + (r.dep || 0)) * f, from = top + MM(900);
          stream.visible = u < 0.98; stream.scale.y = Math.max(0.001, from - lvl); stream.position.set(tx, (from + lvl) / 2, tz);
          V.live.set(r.id, { fill: f }); V.update(app.objects);
          app.sfx?.engine?.('fit-drill', u < 0.97 ? 0.08 : 0, 3);
        }],
        [0.8, (u) => { app.handTools.set('drill', new THREE.Vector3(tx, top - MM(300) * Math.sin(u * Math.PI), tz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), u * 300); }],
        call(() => V.live.delete(r.id)),
      ],
      cleanup: () => { V.live.delete(r.id); V.update(app.objects); },
      commit: () => { this._save('column-pour', () => app.objects.update(r.id, { stage: 3, pourT: +t0.toFixed(3) })); this.toast('Залили до отметки среза — верх ровный, по уровню; выпуски торчат по оси. Бетон набирает прочность, потом «Распалубка»'); },
    });
  }
  _strip(r) {
    const app = this.app;
    if ((r.stage ?? 0) < 3) { this.toast('Сначала залейте бетон'); return; }
    if ((r.stage ?? 0) >= 4) { this.toast('Опалубку уже сняли'); return; }
    const k = uStrength({ pourT: r.pourT }, app.clock);
    if (k < 1) { this.toast(`Бетон набирает прочность: ${Math.round(k * 100)} % — опалубку рано снимать`); return; }
    const g = this.app.wallView.columns._build(r, 0, 'form');
    this._save('column-strip', () => app.objects.update(r.id, { stage: 4 }));
    new FitJob(app, { parts: [g], steps: [[0.7, (u) => { g.position.set(MM(700) * u * u, -MM(100) * u, 0); }]], commit: () => this.toast('Опалубку сняли — колонна готова, выпуски под следующий ярус') });
  }

  // the picked column (not cast yet) takes the height / the slope set in the menu
  restyle(r) {
    const h = +MM(courseH(this.course, this.n)).toFixed(6), tilt = this.tiltVec();
    if (Math.abs(h - r.h) < 1e-7 && tilt[0] === r.tilt[0] && tilt[1] === r.tilt[1]) return;
    this._save('column-height', () => this.app.objects.update(r.id, { h, n: this.n, course: this.course, tilt }));
    this.toast(`Колонна: ${Math.round(h / S)} мм = ${this.n} ${rows(this.n)} (${COURSES[this.course].name})${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ', вертикально'}`);
  }

  status(carry) {
    const r = this.rec, L = this.stage;
    void carry;
    if (L === 'set') return `${COL_SECS[this.sec].name}, ${this.n} ${rows(this.n)} (${COURSES[this.course].name}) = ${courseH(this.course, this.n)} мм${this.tiltDeg ? `, наклон ${this.tiltDeg}°` : ''}: коснитесь плиты (колонна) или земли (свая) и ведите — отпустите на месте`;
    if (!r) return 'Сначала разметка колонны';
    const st = ['размечена', 'каркас', 'опалубка', 'залита', 'готова'][r.stage ?? 0];
    return `${COL_SECS[r.sec].name}, ${Math.round(r.h / S)} мм — ${st}. Коснитесь её: «${NAME[L]}»`;
  }
  remove(id) {
    const app = this.app, r = app.objects.get(id);
    if (!r) return;
    if ((r.stage ?? 0) >= 3) { this.toast('Залитую колонну не снять'); return; }
    this._save('column-remove', () => app.objects.remove(id));
    this.toast('Колонну убрали');
  }
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
