import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { findHouse } from './pitchedTool.js';
import { Pile } from './blindPour.js';
import { uStrength } from './lintels.js';
import { heights } from '../world/blind.js';
import { BLIND, BLIND_LAYERS, BLIND_FIN, TILE_COLOURS, planOf, newBlind, layerTop, leftOf, runsOf, setOf } from '../world/blind.js';

// The blind area done by hand (blind.js): the boards and the channels are carried from the
// tray; the geotextile, the sand, the gravel, the mesh and the top (concrete or paving) are
// spread by the finger over the area; the boards come off at a touch.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
const NAME = Object.fromEntries(BLIND_LAYERS);
const UNDER = { geo: 'form', sand: 'geo', grav: 'sand', mesh: 'grav' };
const BRUSH = MM(300);

export class BlindWork {
  constructor(app) { this.app = app; this.drag = null; this.place = null; }
  get layer() { return this.app.settings.blindLayer || 'form'; }
  get isCarry() { return this.layer === 'form' || this.layer === 'drain'; }
  get fin() { return BLIND_FIN[this.app.settings.blindFin] ? this.app.settings.blindFin : 'conc'; }
  get col() { return TILE_COLOURS[this.app.settings.blindCol] ? this.app.settings.blindCol : 'grey'; }
  get rec() { return this.app.objects.all('blind')[0] || null; }
  _live(live) { const v = this.app.wallView; v.liveBlind = live; v.blindDirty = true; }
  _save(rec, patch, label) {
    const app = this.app;
    app.journal.act(label, {}, app.clock, () => { if (rec?.id) app.objects.update(rec.id, { ...patch }); else app.objects.add({ type: 'blind', ...patch }); });
  }
  // the finger on a level plane (y), in the frame of the area
  _at(e, rec, y) {
    if (!e || e.clientX === undefined) return null;
    _ray.setFromCamera(this.app.gestures.ndc(e.clientX, e.clientY), this.app.camera);
    const q = _ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    if (!q) return null;
    const [a, d] = planOf(rec).frame(q.x, q.z);
    return { a, d, q };
  }
  // the house with the ground it stands on
  _house() {
    const app = this.app, H = findHouse(app);
    if (!H) return null;
    return H;
  }

  // ---- the layers by the finger ----
  //   geo, mesh – a strip off the roll / a run of sheets along the wall the finger starts at,
  //               the whole width of the area, as far as it is drawn;
  //   sand, grav – the finger tips the shovel: a heap grows under it (Pile, blindPour.js);
  //               started on a heap, the finger is the rake: it spreads it level;
  //   fin        – concrete from the hose or the bucket («Бетон»); paving by the finger.
  down(p, e) {
    const app = this.app, L = this.layer, r = this.rec;
    if (this.isCarry) { app.ui.toast(this.status(false)); return true; }
    if (!r) { app.ui.toast('Отмостка: сначала опалубка — тяните её из лотка к дому'); return true; }
    if (L === 'strip') { this._strip(r); return true; }
    if (L === 'mesh' && (r.finKind || this.fin) === 'tile') { app.ui.toast('Под плитку сетка не нужна: плитка ложится на щебень с песком — выберите «Бетон / плитка»'); return true; }
    if (L === 'fin' && this.fin === 'conc') { app.ui.toast(r.mesh?.length ? 'Бетон отмостки — как в любую опалубку: «Бетон» → шланг или ведро по щебню и сетке, потом вибратор, правило по доскам и кельма' : 'Сначала сетка'); return true; }
    const need = L === 'fin' ? 'grav' : UNDER[L];
    if (need !== 'form' && !r[need]?.length) { app.ui.toast(`Сначала «${NAME[need]}»`); return true; }
    if (L === 'fin' && r.finKind && r.finKind !== this.fin) { app.ui.toast(`Здесь уже ${r.finKind === 'tile' ? 'плитка' : 'бетон'} — продолжайте им (или снимите «Удалить»)`); return true; }
    const y = layerTop(r, L === 'fin' ? 'grav' : need === 'form' ? 'geo' : need);
    const h = this._at(e, r, y);
    if (!h) return true;
    const P = planOf(r), k = P.cellAt(h.a, h.d), c = k >= 0 ? P.cells.get(k) : null;
    if (!c) { app.ui.toast('Ведите по отмостке — между стеной и досками'); return true; }
    const under = need === 'form' ? null : setOf(r[need]);
    if (under && !under.has(k)) { app.ui.toast(`Здесь ещё нет слоя «${NAME[need]}»`); return true; }
    if (L === 'sand' || L === 'grav') {
      const pile = new Pile(r, L), n = pile.at(h.a, h.d);
      const mode = this.app.settings.blindAct === 'rake' ? 'rake' : 'pour';
      if (mode === 'rake' && !pile.h.some((v) => v > 5)) { app.ui.toast(`Разравнивать нечего — сначала «Сыпать лопатой»${L === 'sand' ? ' (или лопатой с кучи песка)' : ' (или лопатой с кучи щебня)'}`); return true; }
      this.drag = { r, y, L, pile, n, a: h.a, d: h.d, mode, t: 0 };
      if (mode === 'rake') this._rake(this.drag, h.a, h.d, null, true);
      app.ui.toast(mode === 'pour' ? (L === 'sand' ? 'Сыплем песок лопатой — держите палец, куча растёт; потом ведите по куче — разровняете' : 'Сыплем щебень — держите палец; потом ведите по куче граблями') : 'Грабли: ведите по куче — разравниваете до 60 мм');
    } else if (L === 'geo' || L === 'mesh') {
      // (the side of the house it is on: the strip runs along that wall)
      const along = c.dx > c.dy ? 'd' : 'a', R = c.r, sg = along === 'd' ? (c.a < R[0] ? -1 : 1) : (c.d < R[1] ? -1 : 1);
      const edge = along === 'd' ? (sg < 0 ? R[0] : R[2]) : (sg < 0 ? R[1] : R[3]);
      const done = setOf(r[L]);
      this.drag = { r, y, L, along, sg, edge, R, s0: along === 'd' ? h.d : h.a, s1: along === 'd' ? h.d : h.a, cells: new Set(), done, under };
      this._band();
    } else {
      const done = setOf(r[L]);
      this.drag = { r, y, L, cells: new Set(), ok: (q) => !done.has(q) && (!under || under.has(q)) };
      this._dab(h.a, h.d);
    }
    this._show();
    app.sfx?.stab?.();
    return true;
  }
  move(p, e) {
    const d = this.drag; if (!d) return;
    const h = this._at(e, d.r, d.y); if (!h) return;
    if (d.pile) {
      const n = d.pile.at(h.a, h.d);
      if (n < 0) return;
      if (d.mode === 'rake') { const da = h.a - d.a, dd = h.d - d.d, L = Math.hypot(da, dd); if (L > MM(40)) { for (let s = MM(60); s <= L; s += MM(60)) d.pile.rake(d.pile.at(d.a + da * s / L, d.d + dd * s / L), da, dd); d.pile.rake(n, da, dd); d.pile.step(3); d.a = h.a; d.d = h.d; d.dir = [da, dd]; } this._rake(d, h.a, h.d, d.dir); }
      else { d.a = h.a; d.d = h.d; }
      d.n = n;
      this._show();
      return;
    }
    if (d.along) { d.s1 = d.along === 'd' ? h.d : h.a; this._band(); this._show(); return; }
    if (d.last) { const n = Math.ceil(Math.hypot(h.a - d.last[0], h.d - d.last[1]) / (BRUSH * 0.5)); for (let k = 1; k < n; k++) this._dab(d.last[0] + (h.a - d.last[0]) * k / n, d.last[1] + (h.d - d.last[1]) * k / n); }
    this._dab(h.a, h.d);
    this._show();
  }
  // the rake in the hands (world/rake.js, the one of «Земля»): its tines on the layer under the
  // finger, the handle back the way it is drawn (the head goes on ahead); let go — it lies there
  _rake(d, a, dd, dir, snap = false, down = false) {
    const rk = this.app.rake; if (!rk) return;
    const P = planOf(d.r), [x, z] = P.W2(a, dd), n = d.pile.at(a, dd), hs = d.L === 'grav' ? heights(d.r, 'sand') : null;
    const y = d.r.g + MM(8 + (n >= 0 ? d.pile.h[n] + (hs ? hs[n] : 0) : 0)) - MM(6);
    if (dir) { const [ex, ez] = P.W2(dir[0], dir[1]), l = Math.hypot(ex, ez) || 1; this._hdir = new THREE.Vector2(-ex / l, -ez / l); }
    rk.setPose({ pos: new THREE.Vector3(x, y + (down ? MM(8) : 0), z), dir: this._hdir || new THREE.Vector2(0, 1), lift: down ? 0.45 : 0.62 }, snap);
  }
  // the shovel tips while the finger is held (sand / gravel)
  update(dt) {
    const d = this.drag;
    if (!d?.pile || d.mode !== 'pour') return;
    d.t += dt;
    d.pile.pour(d.n, (d.L === 'sand' ? 60 : 50) * dt);
    d.pile.step(6);
    if ((d.f = (d.f || 0) + 1) % 2 === 0) this._show();
  }
  // the strip along the wall: across the whole width, from where the finger began to where it is
  _band() {
    const d = this.drag, P = planOf(d.r), C = P.C, W = d.r.W;
    let lo = Math.min(d.s0, d.s1) - C / 2, hi = Math.max(d.s0, d.s1) + C / 2;
    // (near the end of the wall it runs on out to the boards at the corner)
    const e0 = d.along === 'd' ? d.R[1] : d.R[0], e1 = d.along === 'd' ? d.R[3] : d.R[2];
    if (lo < e0 + W * 0.6) lo = Math.min(lo, e0 - W - C); if (hi > e1 - W * 0.6) hi = Math.max(hi, e1 + W + C);
    d.cells.clear();
    for (const [k, c] of P.cells) {
      const s = d.along === 'd' ? c.d : c.a, q = d.along === 'd' ? c.a : c.d;
      if (s < lo || s > hi || (d.sg < 0 ? q > d.edge : q < d.edge) || Math.abs(q - d.edge) > d.r.W + C) continue;
      if (d.done.has(k) || (d.under && !d.under.has(k))) continue;
      d.cells.add(k);
    }
    // (the roll: at the end being drawn, across the strip)
    const mid = d.edge + d.sg * d.r.W / 2, s = d.s1, dir = Math.sign(d.s1 - d.s0) || 1;
    d.roll = d.along === 'd' ? { a: mid, d: s, ang: dir > 0 ? Math.PI / 2 : -Math.PI / 2 } : { a: s, d: mid, ang: dir > 0 ? 0 : Math.PI };
    d.roll.spin = Math.abs(d.s1 - d.s0) / MM(70);
  }
  _dab(a, dd) {
    const d = this.drag, P = planOf(d.r), C = P.C, n = Math.ceil(BRUSH / C);
    d.last = [a, dd];
    const i0 = Math.floor((a - P.A0) / C), j0 = Math.floor((dd - P.D0) / C);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
      if (i < 0 || j < 0 || i >= P.ni || j >= P.nj) continue;
      const k = j * P.ni + i, c = P.cells.get(k);
      if (!c || Math.hypot(c.a - a, c.d - dd) > BRUSH || !d.ok(k)) continue;
      d.cells.add(k);
    }
  }
  _show() {
    const d = this.drag;
    if (d.pile) { this._live({ layer: d.L, H: d.pile.h, stream: d.mode === 'pour' ? { a: d.a, d: d.d, n: d.n, t: d.t } : null }); return; }
    this._live({ layer: d.L, cells: [...d.cells], kind: this.fin, col: this.col, roll: d.L === 'geo' ? d.roll : null });
  }
  up() {
    const d = this.drag, app = this.app, L = d?.L;
    this.drag = null; this._live(null);
    if (!d) return;
    if (d.pile) {
      if (d.mode === 'rake') this._rake(d, d.a, d.d, d.dir, false, true);
      d.pile.step(40);
      const patch = d.pile.patch();
      this._save(d.r, patch, 'blind-' + L);
      const left = Math.round(leftOf({ ...d.r, ...patch }, L) * 100), nm = L === 'sand' ? 'Песок' : 'Щебень';
      app.ui.toast(d.mode === 'pour' ? `${nm}: куча насыпана — выберите «Грабли — разровнять» и ведите по ней вдоль стены` : `${nm} разровняли граблями${L === 'sand' ? ' и пролили водой' : ''}` + (left > 1 ? ` — ровным слоем ещё не покрыто ${left} %` : ' — по всему дому'));
      return;
    }
    if (!d.cells.size) { app.ui.toast(`Здесь ${L === 'geo' ? 'нечего застилать' : 'уже готово или нет слоя под ним'}`); return; }
    const patch = { [L]: runsOf(new Set([...setOf(d.r[L]), ...d.cells])) };
    if (L === 'fin' && !d.r.finKind) { patch.finKind = this.fin; patch.finCol = this.col; }
    this._save(d.r, patch, 'blind-' + L);
    const left = Math.round(leftOf({ ...d.r, ...patch }, L) * 100);
    const what = { geo: 'Геотекстиль раскатали полосой вдоль стены', mesh: 'Сетка 150 × 150 из прутка Ø5 на стульчиках — листы внахлёст', fin: `Плитка «кирпичик» (${TILE_COLOURS[d.r.finCol || this.col][0].toLowerCase()}) на сухую смесь, уклон 3 % от стен` }[L];
    app.ui.toast(what + (left > 1 ? ` — осталось ${left} %` : ' — по всему дому'));
  }
  // the shovel (or the bucket) tipped over the area: sand / gravel into its layer (or null:
  // it goes onto the ground as anywhere) — mat: what is on the blade (1 sand, 2–3 gravel)
  dumpAt(p, mat) {
    const r = this.rec, L = mat === 1 ? 'sand' : mat === 2 || mat === 3 ? 'grav' : null;
    if (!r || !L || r.fin?.length) return null;
    const P = planOf(r), [a, d] = P.frame(p.x, p.z), k = P.cellAt(a, d);
    if (k < 0 || !P.cells.has(k)) return null;
    const need = L === 'sand' ? 'geo' : 'sand';
    if (!setOf(r[need]).has(k)) { this.app.ui.toast(`Сначала «${NAME[need]}» — здесь его нет`); return null; }
    const pile = new Pile(r, L);
    return { r, L, pile, n: pile.at(a, d) };
  }
  // the load (litres) into it: a heap where it was tipped
  dumpIn(t, litres) {
    const app = this.app, { pile, n } = t;
    for (let i = 0; i < 6; i++) { pile.pour(n, litres / 6); pile.step(4); }
    for (let i = 0; i < 60 && pile.step(4) > 1; i++);   // (it runs down to its slope)
    app.objects.update(t.r.id, pile.patch());
  }
  // the boards come off (the top is all done)
  _strip(r) {
    const app = this.app;
    if (r.stripped) { app.ui.toast('Опалубку уже сняли'); return; }
    if (!r.fin?.length || leftOf(r, 'fin') > 0.05) { app.ui.toast('Сначала закончите верх — бетон или плитку по всему периметру'); return; }
    if (r.finKind === 'conc') { const k = uStrength(r, app.clock); if (k < 1) { app.ui.toast(`Бетон набирает прочность: ${Math.round(k * 100)} % — доски рано снимать`); return; } }
    this._save(r, { stripped: true, ...(r.finKind === 'conc' ? { set: true } : {}) }, 'blind-strip');
    app.ui.toast(r.finKind === 'tile' ? 'Доски сняли — по краю остался бордюр' : 'Бетон набрал прочность — доски и колышки сняли');
  }

  // ---- the boards, the channels: carried from the tray ----
  carryMove(p, e) {
    const app = this.app, L = this.layer, r = this.rec;
    this.place = null;
    if (L === 'form') {
      const H = this._house();
      if (!H) { this._live(null); this.place = { why: 'Нет дома: отмостку делают вокруг готовых стен' }; return; }
      if (r && (r.geo?.length || r.fin?.length)) { this._live(null); this.place = { why: 'Опалубка уже стоит и слои по ней уложены' }; return; }
      const W = this.app.settings.blindW || 1000;
      const rec = { ...newBlind(H, W), g: +this._ground(H).toFixed(6), form: true };
      this.place = { rec, W };
      this._live({ form: rec });
      return;
    }
    // the channels: along the side under the finger
    if (!r) { this.place = { why: 'Сначала отмостка' }; return; }
    const h = this._at(e, r, r.g), P = planOf(r);
    let best = null;
    if (h) for (const sg of P.segs) {
      const s = sg.axis === 'a' ? h.a : h.d, c = sg.axis === 'a' ? h.d : h.a;
      const ds = Math.max(0, sg.s0 - s, s - sg.s1), dc = Math.abs(c - sg.at);
      const dist = Math.hypot(ds, dc);
      if (dist < MM(900) && (!best || dist < best.dist)) best = { sg, dist };
    }
    if (!best) { this._live(null); this.place = { why: 'Поднесите лоток к наружному краю отмостки' }; return; }
    const why = !r.stripped ? 'Лотки — вдоль готовой отмостки: сначала снимите опалубку' : null;
    this.place = { seg: best.sg, why, has: (r.drains || []).includes(best.sg.key) };
    this._live({ seg: best.sg.key, ok: !why });
  }
  // the ground round the house: the level of the terrain along it (over most of it)
  _ground(H) {
    const t = this.app.terrain, hs = [];
    for (const w of H.wings) for (let k = 0; k < 16; k++) {
      const th = k / 16 * Math.PI * 2, rA = w.A + MM(500), rB = w.B + MM(500), a = Math.cos(th) * rA, d = Math.sin(th) * rB;
      const x = w.cx + w.ux * a - w.uz * d, z = w.cz + w.uz * a + w.ux * d;
      if (t.inside(x, z)) hs.push(t.heightAt(x, z));
    }
    hs.sort((p, q) => p - q);
    return hs.length ? hs[Math.floor(hs.length * 0.85)] : H.g;   // (on the ground: over its bumps)
  }
  carryDrop() {
    const app = this.app, P = this.place, L = this.layer, r = this.rec;
    this.place = null; this._live(null);
    if (!P) { app.ui.toast(this.status(false)); return; }
    if (P.why) { app.ui.toast(P.why); return; }
    if (L === 'form') {
      const n = planOf(P.rec).segs.reduce((s, sg) => s + sg.s1 - sg.s0, 0) / S / 1000;
      if (r) app.journal.act('blind-form', {}, app.clock, () => { app.objects.remove(r.id); app.objects.add({ type: 'blind', ...P.rec }); });
      else this._save(null, P.rec, 'blind-form');
      app.ui.toast(`Опалубка отмостки: доски на колышках, ${n.toFixed(1).replace('.', ',')} м по периметру, ширина ${P.W} мм — дальше геотекстиль`);
      return;
    }
    const list = r.drains || [], key = P.seg.key, on = !list.includes(key);
    this._save(r, { drains: on ? [...list, key] : list.filter((k) => k !== key) }, 'blind-drain');
    app.ui.toast(on ? `Лотки с решётками: ${((P.seg.s1 - P.seg.s0) / S / 1000).toFixed(1).replace('.', ',')} м вдоль края, пескоуловитель в конце — в дождь в них стекает вода` : 'Лотки с этой стороны сняли');
  }
  status(carry) {
    const L = this.layer;
    if (carry) {
      const P = this.place;
      if (!P) return L === 'form' ? 'Поднесите опалубку к дому' : 'Поднесите лоток к краю отмостки';
      if (P.why) return 'Красный — ' + P.why;
      return L === 'form' ? `Опалубка вокруг дома, ширина ${P.W} мм — отпустите` : P.has ? 'Здесь лотки уже есть — отпустите, чтобы снять' : `Лотки вдоль этой стороны, ${((P.seg.s1 - P.seg.s0) / S / 1000).toFixed(1).replace('.', ',')} м — отпустите`;
    }
    return {
      form: `Опалубка: выберите ширину и тяните из лотка к дому — доски на колышках встанут вокруг стен (${this.app.settings.blindW || 1000} мм от стены)`,
      geo: 'Геотекстиль: ведите пальцем вдоль стены — рулон раскатывается ровной полосой на всю ширину отмостки',
      sand: this.app.settings.blindAct === 'rake' ? 'Грабли: ведите вдоль стены по песку — ровный слой 60 мм' : 'Песок: держите палец — сыплется кучей (или «Земля» → лопата: наберите с кучи песка и высыпьте сюда); потом «Грабли»',
      grav: this.app.settings.blindAct === 'rake' ? 'Грабли: ведите вдоль стены по щебню — ровный слой 60 мм' : 'Щебень: держите палец — сыплется кучей (или лопатой с кучи щебня); потом «Грабли»',
      mesh: 'Сетка: ведите пальцем вдоль стены — листы сетки 150 × 150 из прутка Ø5 на стульчиках (под бетон)',
      fin: this.fin === 'tile' ? 'Плитка: выберите цвет и ведите пальцем по щебню — «кирпичик» на сухую смесь с уклоном от стен, по краю бордюр' : 'Бетон: «Бетон» → шланг или ведро по сетке — 80 мм; правило по доскам даст уклон 3 % от стен, потом кельма',
      strip: 'Снять опалубку: коснитесь отмостки — когда верх готов по всему периметру',
      drain: 'Лотки: тяните из лотка к наружному краю отмостки — лоток с решёткой ляжет вдоль всей стороны',
    }[L];
  }
  // «Удалить»: the last thing done comes off
  remove(id) {
    const app = this.app, r = app.objects.get(id);
    if (!r) return;
    const steps = [['drains', 'лотки'], ['stripped', null], ['fin', 'верх'], ['mesh', 'сетку'], ['grav', 'щебень'], ['sand', 'песок'], ['geo', 'геотекстиль']];
    for (const [k, nm] of steps) {
      if (k === 'stripped') { if (r.stripped) { this._save(r, { stripped: false }, 'blind-unstrip'); app.ui.toast('Опалубку поставили обратно'); return; } continue; }
      if (!r[k]?.length) continue;
      const patch = { [k]: [] }; if (k === 'fin') Object.assign(patch, { finKind: null, finCol: null, lv: null, sm: null, fill: 0, castT: null, pourT: null, wetT: null, set: false }); if (k === 'sand' || k === 'grav') patch[k + 'H'] = null;
      this._save(r, patch, 'blind-remove');
      app.ui.toast(`Сняли ${nm}`);
      return;
    }
    app.journal.act('blind-remove', {}, app.clock, () => app.objects.remove(id));
    app.ui.toast('Опалубку отмостки сняли');
  }
}
export { BLIND };
