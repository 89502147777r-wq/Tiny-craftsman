import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { findHouse } from './pitchedTool.js';
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

  // ---- the layers spread by the finger ----
  down(p, e) {
    const app = this.app, L = this.layer, r = this.rec;
    if (this.isCarry) { app.ui.toast(this.status(false)); return true; }
    if (!r) { app.ui.toast('Отмостка: сначала опалубка — тяните её из лотка к дому'); return true; }
    if (L === 'strip') { this._strip(r); return true; }
    if (L === 'mesh' && (r.finKind || this.fin) === 'tile') { app.ui.toast('Под плитку сетка не нужна: плитка ложится на щебень с песком — выберите «Бетон / плитка»'); return true; }
    const need = L === 'fin' ? (this.fin === 'tile' ? 'grav' : 'mesh') : UNDER[L];
    if (need !== 'form' && !r[need]?.length) { app.ui.toast(`Сначала «${NAME[need === 'mesh' ? 'mesh' : need]}»`); return true; }
    if (L === 'fin' && r.finKind && r.finKind !== this.fin) { app.ui.toast(`Здесь уже ${r.finKind === 'tile' ? 'плитка' : 'бетон'} — продолжайте им (или снимите «Удалить»)`); return true; }
    const y = layerTop(r, L === 'fin' ? 'mesh' : L);
    const h = this._at(e, r, y);
    if (!h) return true;
    const under = need === 'form' ? null : setOf(r[need]), done = setOf(r[L]);
    this.drag = { r, y, cells: new Set(), ok: (k) => !done.has(k) && (!under || under.has(k)) };
    this._dab(h.a, h.d);
    if (L === 'geo') this.drag.roll = { a: h.a, d: h.d, ang: 0, spin: 0 };
    this._show();
    app.sfx?.stab?.();
    return true;
  }
  move(p, e) {
    const d = this.drag; if (!d) return;
    const h = this._at(e, d.r, d.y); if (!h) return;
    if (d.last) { const n = Math.ceil(Math.hypot(h.a - d.last[0], h.d - d.last[1]) / (BRUSH * 0.5)); for (let k = 1; k < n; k++) this._dab(d.last[0] + (h.a - d.last[0]) * k / n, d.last[1] + (h.d - d.last[1]) * k / n); }
    // (the roll of geotextile: across the way the finger goes, turning as it rolls)
    if (this.layer === 'geo' && d.last) { const da = h.a - d.last[0], dd = h.d - d.last[1], L = Math.hypot(da, dd); if (L > 1e-6) { const ang = Math.atan2(dd, da); d.roll = { a: h.a, d: h.d, ang: d.roll && L < MM(15) ? d.roll.ang : ang, spin: (d.roll?.spin || 0) + L / MM(70) }; } }
    this._dab(h.a, h.d);
    this._show();
  }
  _dab(a, dd) {
    // (the geotextile comes off the roll the whole width of the area)
    const d = this.drag, P = planOf(d.r), C = P.C, Rb = this.layer === 'geo' ? Math.max(BRUSH, d.r.W * 0.6 + C) : BRUSH, n = Math.ceil(Rb / C);
    d.last = [a, dd];
    const i0 = Math.floor((a - P.A0) / C), j0 = Math.floor((dd - P.D0) / C);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
      if (i < 0 || j < 0 || i >= P.ni || j >= P.nj) continue;
      const k = j * P.ni + i, c = P.cells.get(k);
      if (!c || Math.hypot(c.a - a, c.d - dd) > Rb || !d.ok(k)) continue;
      d.cells.add(k);
    }
  }
  _show() { const d = this.drag; this._live({ layer: this.layer, cells: [...d.cells], kind: this.fin, col: this.col, roll: d.roll || null }); }
  up() {
    const d = this.drag, app = this.app, L = this.layer;
    this.drag = null; this._live(null);
    if (!d) return;
    if (!d.cells.size) { app.ui.toast(`Здесь ${L === 'geo' ? 'нечего застилать' : 'уже готово или нет слоя под ним'}`); return; }
    const patch = { [L]: runsOf(new Set([...setOf(d.r[L]), ...d.cells])) };
    if (L === 'fin' && !d.r.finKind) { patch.finKind = this.fin; patch.finCol = this.col; }
    this._save(d.r, patch, 'blind-' + L);
    const left = Math.round(leftOf({ ...d.r, ...patch }, L) * 100);
    const what = { geo: 'Геотекстиль раскатали с рулона', sand: 'Песок насыпали и пролили водой — 60 мм', grav: 'Щебень 60 мм разровняли', mesh: 'Сетка 150 × 150 на стульчиках', fin: (patch.finKind || d.r.finKind) === 'tile' ? `Плитка «кирпичик» (${TILE_COLOURS[d.r.finCol || this.col][0].toLowerCase()}) на сухую смесь, уклон 3 % от стен` : 'Бетон 80 мм, уклон 3 % от стен, швы на углах и через 2 м' }[L];
    app.ui.toast(what + (left > 1 ? ` — осталось ${left} %` : ' — по всему дому'));
  }
  // the boards come off (the top is all done)
  _strip(r) {
    const app = this.app;
    if (r.stripped) { app.ui.toast('Опалубку уже сняли'); return; }
    if (!r.fin?.length || leftOf(r, 'fin') > 0.05) { app.ui.toast('Сначала закончите верх — бетон или плитку по всему периметру'); return; }
    this._save(r, { stripped: true }, 'blind-strip');
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
      geo: 'Геотекстиль: ведите пальцем по отмостке — полотно ляжет на грунт, чтобы песок не уходил в землю',
      sand: 'Песок: ведите пальцем — подушка 60 мм, проливается водой и трамбуется',
      grav: 'Щебень: ведите пальцем — 60 мм фракции 20–40 по песку',
      mesh: 'Сетка: ведите пальцем — кладочная сетка 150 × 150 на стульчиках (под бетон)',
      fin: this.fin === 'tile' ? 'Плитка: выберите цвет и ведите пальцем по щебню — «кирпичик» на сухую смесь с уклоном от стен, по краю бордюр' : 'Бетон: ведите пальцем по сетке — 80 мм с уклоном 3 % от стен, деформационные швы на углах и через 2 м',
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
      const patch = { [k]: [] }; if (k === 'fin') { patch.finKind = null; patch.finCol = null; }
      this._save(r, patch, 'blind-remove');
      app.ui.toast(`Сняли ${nm}`);
      return;
    }
    app.journal.act('blind-remove', {}, app.clock, () => app.objects.remove(id));
    app.ui.toast('Опалубку отмостки сняли');
  }
}
export { BLIND };
