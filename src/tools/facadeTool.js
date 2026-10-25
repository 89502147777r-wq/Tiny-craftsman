import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { FACADE, LAYERS, VLAYERS, VENT_SUB, VENT, railCols, bracketRows, ventSlot, railsHold, OFF, CELL, PANELS, panelMod, PLASTER_COLOURS, PLASTER_KINDS, ext, recOf, cutPiece, area, slotAt, sameSlot, inR, ck, cij, cellsOf, runsOf } from '../world/facade.js';

// The facade done by hand (facade.js), on the outside of the walls:
//   eps  – the boards carried from the tray, one by one, staggered, cut at the openings and
//          the corners; on the glue, five dowels each,
//   glue – the base coat spread with the spatula (the finger drags it over the boards),
//   mesh – the roll of mesh rolled out by the finger, 100 mm overlaps; it hangs loose,
//   emb  – the spatula presses the mesh into the fresh glue and smooths it over,
//   pl   – the plaster put on with the spatula (smooth and wet),
//   fl   – the float rubs it: the texture comes up the way the float goes,
//   pan  – the facade panels carried from the tray onto the insulation.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
const NAME = Object.fromEntries([...LAYERS, ...VLAYERS]);
const BRUSH = { glue: MM(170), emb: MM(170), pl: MM(170), fl: MM(140) };
const UNDER = { glue: 'eps', emb: 'glue', pl: 'emb', fl: 'pl' };

export class FacadeWork {
  constructor(app) { this.app = app; this.drag = null; this.place = null; }
  get layer() { return this.app.settings.facLayer || 'eps'; }
  get isCarry() { return ['eps', 'pan', 'mw', 'vp'].includes(this.layer); }
  get ventKey() { const k = this.app.settings.facVent; return k && VENT(k) ? k : 'porc:concrete'; }
  get variant() { return `${this.app.settings.facTex || 'bark'}:${this.app.settings.facCol || 'white'}`; }
  faces() { return this.app.wallView.facadeFaces(); }
  _rec(F) { return recOf(this.app.objects.all('facade'), F); }
  // the face under the finger (at the height of what is on it): the nearest along the ray
  _hit(e, off, only) {
    if (!e || e.clientX === undefined) return null;
    _ray.setFromCamera(this.app.gestures.ndc(e.clientX, e.clientY), this.app.camera);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    let best = null;
    for (const F of only ? [only] : this.faces()) {
      const nd = d.x * F.nx + d.z * F.nz, c = F.P + F.sg * off;
      if (Math.abs(nd) < 1e-6 || (only ? false : nd * F.sg > 0)) continue;   // (from the outside)
      const t = (c - (o.x * F.nx + o.z * F.nz)) / nd;
      if (t <= 0) continue;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, a = x * F.ux + z * F.uz, e2 = ext(F, off), m = only ? MM(2000) : MM(150);
      if (a < e2[0] - m || a > e2[2] + m || y < e2[1] - m || y > e2[3] + m) continue;
      if (!best || t < best.t) best = { F, a, y, t };
    }
    return best;
  }
  _save(F, patch, label) {
    const app = this.app, r = this._rec(F);
    const rec = { ux: F.ux, uz: F.uz, sg: F.sg, P: F.P, y0: F.y0, ...(r || {}), ...patch };
    delete rec.id;
    app.journal.act(label, {}, app.clock, () => { if (r) app.objects.update(r.id, rec); else app.objects.add({ type: 'facade', ...rec }); });
  }
  _live(F, live) { const v = this.app.wallView; v.liveFacade = F && live ? { key: F.key, ...live } : null; v.facadeDirty = true; }

  // what is under a cell (its middle) — for the coats
  _under(F, rec, layer, live) {
    const eps = rec?.eps || [], mesh = rec?.mesh || [];
    const glue = cellsOf(rec?.glue), emb = cellsOf(rec?.emb), pl = Object.values(rec?.pl || {}).map(cellsOf), pan = rec?.pan || [];
    return (k) => {
      const [i, j] = cij(k), a = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
      if (!cutPiece(F, [a - 1e-7, y - 1e-7, a + 1e-7, y + 1e-7], OFF.fin).length) return false;   // (an opening, off the face)
      if (pan.some((p) => inR(p, a, y))) return false;
      if (layer === 'glue') return eps.some((s) => inR(s, a, y) && cutPiece(F, s, OFF.eps).some((r) => inR(r, a, y)));
      if (layer === 'emb') return glue.has(k) && mesh.some((r) => inR(r, a, y));
      if (layer === 'pl') return emb.has(k) && mesh.some((r) => inR(r, a, y));
      if (layer === 'fl') return pl.some((s) => s.has(k)) || (live && live.has(k));
      return false;
    };
  }

  // ---- the spatula, the float, the roll: the finger on the wall ----
  down(p, e) {
    const app = this.app, L = this.layer;
    if (this.isCarry) { app.ui.toast(`${NAME[L]}: тяните ${L === 'eps' ? 'лист' : L === 'mw' ? 'плиту' : 'панель'} из лотка справа на стену`); return true; }
    if (L === 'br' || L === 'rl') return this._ventDown(e);
    const off = L === 'mesh' ? OFF.loose : L === 'mb' ? OFF.mb : L === 'glue' ? OFF.eps : OFF.glue;
    const h = this._hit(e, off);
    if (!h) { app.ui.toast(this.faces().length ? 'Ведите по наружной стороне стены' : 'Фасад — по наружным стенам: сначала кладка'); return true; }
    const rec = this._rec(h.F);
    const need = { glue: [rec?.eps?.length, 'Клей — по утеплителю: сначала листы ППС'], mesh: [rec?.glue?.length, 'Сетку кладут в свежий клей: сначала клей шпателем'], emb: [rec?.mesh?.length, 'Сначала раскатайте сетку по клею'], pl: [rec?.emb?.length, 'Штукатурка — по базовому слою: сетку вдавить в клей шпателем'], fl: [Object.keys(rec?.pl || {}).length, 'Затирают свежую штукатурку: сначала нанесите её шпателем'], mb: [rec?.mw?.length, 'Мембрану натягивают по минвате: сначала плиты утеплителя'] }[L];
    if (need && !need[0]) { app.ui.toast(need[1]); return true; }
    this.drag = { F: h.F, rec, off, a0: h.a, y0: h.y, a: h.a, y: h.y, cells: new Set(), da: 0, dy: 0 };
    if (L !== 'mesh' && L !== 'mb') { this.drag.ok = this._under(h.F, rec, L, this.drag.cells); this._dab(h.a, h.y); }
    this._show();
    app.sfx?.stab?.();
    return true;
  }
  move(p, e) {
    const d = this.drag;
    if (!d) return;
    const h = this._hit(e, d.off, d.F);
    if (!h) return;
    const L = this.layer;
    if (d.vent) { this._ventMove(h); return; }
    if (L === 'mesh' || L === 'mb') { d.a = h.a; d.y = h.y; d.rect = this._strip(d); }
    else {
      // the dabs along the way (no gaps when the finger is quick)
      const n = Math.ceil(Math.hypot(h.a - d.a, h.y - d.y) / (CELL * 0.7));
      for (let k = 1; k <= n; k++) this._dab(d.a + (h.a - d.a) * k / n, d.y + (h.y - d.y) * k / n);
      d.da += Math.abs(h.a - d.a); d.dy += Math.abs(h.y - d.y);
      d.a = h.a; d.y = h.y;
    }
    this._show();
  }
  _dab(a, y) {
    const d = this.drag, R = BRUSH[this.layer], e = ext(d.F, OFF.fin);
    // near an end / the top / the bottom of the wall the spatula runs out to it (no strip left)
    const near = R * 1.3, aa = a - e[0] < near ? e[0] : e[2] - a < near ? e[2] : null, yy = y - e[1] < near ? e[1] : e[3] - y < near ? e[3] : null;
    const i0 = Math.floor((Math.min(a - R, aa ?? Infinity)) / CELL), i1 = Math.floor(Math.max(a + R, aa ?? -Infinity) / CELL), j0 = Math.floor(Math.min(y - R, yy ?? Infinity) / CELL), j1 = Math.floor(Math.max(y + R, yy ?? -Infinity) / CELL);
    // the spatula is wide and short: an ellipse 2 : 1 across the stroke
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ca = (i + 0.5) * CELL, cy = (j + 0.5) * CELL;
      // (towards the edge it reaches: measured from the edge band)
      const pa = aa != null && (aa < a ? ca < a : ca > a) ? a + Math.sign(ca - a) * Math.max(0, Math.abs(ca - a) - Math.abs(aa - a)) : ca;
      const py = yy != null && (yy < y ? cy < y : cy > y) ? y + Math.sign(cy - y) * Math.max(0, Math.abs(cy - y) - Math.abs(yy - y)) : cy;
      const da = (pa - a) / R, dy = (py - y) / (R * 0.6);
      if (da * da + dy * dy > 1) continue;
      const k = ck(i, j);
      if (!d.cells.has(k) && d.ok(k)) d.cells.add(k);
    }
  }
  _show() {
    const d = this.drag, L = this.layer;
    if (L === 'mesh' || L === 'mb') {
      this._live(d.F, { layer: L, rect: d.rect, vert: d.vert, end: d.end, tool: d.rect && L === 'mesh' ? { kind: 'roll' } : null });
      if (d.rect) this.app.ui.showMeasure(`${L === 'mb' ? 'Мембрана' : 'Сетка'}: полоса ${((d.vert ? d.rect[3] - d.rect[1] : d.rect[2] - d.rect[0]) / S / 1000).toFixed(2)} м`.replace('.', ','));
      return;
    }
    this._live(d.F, { layer: L, cells: [...d.cells], variant: this.variant, dir: d.dy >= d.da ? 'v' : 'h', tool: { kind: L === 'fl' ? 'float' : 'spatula', a: d.a, y: d.y } });
  }
  up() {
    const d = this.drag, app = this.app, L = this.layer;
    this.drag = null; this._live(null); app.ui.hideMeasure();
    if (!d) return;
    const F = d.F, rec = this._rec(F) || {};
    if (d.vent) { this._ventUp(d, rec); return; }
    if (L === 'mb') {
      if (!d.rect) { app.ui.toast('Мембрана: проведите пальцем вдоль стены — рулон 1,5 м раскатается по минвате'); return; }
      this._save(F, { mb: [...(rec.mb || []), d.rect] }, 'facade-membrane');
      app.ui.toast('Мембрана натянута по минвате, нахлёст 100 мм, прихвачена дюбелями — дальше направляющие');
      return;
    }
    if (L === 'mesh') {
      if (!d.rect) { app.ui.toast('Сетка: проведите пальцем вдоль стены — сверху вниз, рулон раскатается за ним'); return; }
      this._save(F, { mesh: [...(rec.mesh || []), d.rect] }, 'facade-mesh');
      app.ui.toast('Сетка раскатана по клею, нахлёст 100 мм — она пока висит: вдавите её шпателем («Вдавить сетку»)');
      return;
    }
    if (!d.cells.size) { app.ui.toast({ glue: 'Здесь нет утеплителя под клей', emb: 'Здесь нет сетки на свежем клею', pl: 'Здесь нет готового базового слоя', fl: 'Здесь нет свежей штукатурки' }[L]); return; }
    const add = (runs) => runsOf(new Set([...cellsOf(runs), ...d.cells]));
    if (L === 'glue') this._save(F, { glue: add(rec.glue) }, 'facade-glue');
    else if (L === 'emb') this._save(F, { emb: add(rec.emb) }, 'facade-embed');
    else if (L === 'pl') {
      // over the old: this colour now, wet again
      const pl = {}, v = this.variant;
      for (const [k, runs] of Object.entries(rec.pl || {})) { const s = new Set([...cellsOf(runs)].filter((c) => !d.cells.has(c))); if (s.size) pl[k] = runsOf(s); }
      pl[v] = runsOf(new Set([...(pl[v] ? cellsOf(pl[v]) : []), ...d.cells]));
      const fl = { v: runsOf(new Set([...cellsOf(rec.fl?.v)].filter((c) => !d.cells.has(c)))), h: runsOf(new Set([...cellsOf(rec.fl?.h)].filter((c) => !d.cells.has(c)))) };
      this._save(F, { pl, fl }, 'facade-plaster');
    } else if (L === 'fl') {
      const dir = d.dy >= d.da ? 'v' : 'h', other = dir === 'v' ? 'h' : 'v';
      const fl = { [dir]: add(rec.fl?.[dir]), [other]: runsOf(new Set([...cellsOf(rec.fl?.[other])].filter((c) => !d.cells.has(c)))) };
      this._save(F, { fl }, 'facade-float');
    }
    const r2 = this._rec(F), left = this._left(F, r2, L);
    app.ui.toast({
      glue: 'Клей нанесён шпателем — пока свежий, раскатайте сетку',
      emb: 'Сетка вдавлена в клей и приглажена шпателем',
      pl: `Штукатурка «${PLASTER_KINDS[this.app.settings.facTex || 'bark']}», ${PLASTER_COLOURS[this.app.settings.facCol || 'white'][0].toLowerCase()} — нанесена; затирайте тёркой, пока не схватилась`,
      fl: `Затёрли ${d.dy >= d.da ? 'вверх-вниз' : 'по кругу вдоль'} — проявилась фактура`,
    }[L] + (left != null ? ` · осталось ${left} %` : ''));
  }
  // ---- the brackets and the rails: the finger along the wall ----
  _ventDown(e) {
    const app = this.app, L = this.layer, h = this._hit(e, L === 'br' ? 0 : OFF.rl);
    if (!h) { app.ui.toast(this.faces().length ? 'Ведите по наружной стороне стены' : 'Фасад — по наружным стенам: сначала кладка'); return true; }
    const rec = this._rec(h.F);
    if (rec?.eps?.length || rec?.pan?.length) { app.ui.toast('Здесь мокрый фасад — вентфасад на него не делают'); return true; }
    if (L === 'rl' && !rec?.br?.length) { app.ui.toast('Направляющие ставят на кронштейны: сначала кронштейны'); return true; }
    this.drag = { F: h.F, vent: true, rec, off: L === 'br' ? 0 : OFF.rl, pts: new Map(), a0: h.a, y0: h.y, a: h.a, y: h.y, cols: railCols(h.F), rows: bracketRows(h.F) };
    this._ventMove(h);
    return true;
  }
  _ventMove(h) {
    const d = this.drag, F = d.F, L = this.layer;
    if (L === 'br') {
      // the nodes near the finger's way get a bracket (not in an opening, not twice)
      const n = Math.ceil(Math.hypot(h.a - d.a, h.y - d.y) / MM(100)) || 1, have = d.rec?.br || [];
      for (let k = 0; k <= n; k++) {
        const a = d.a + (h.a - d.a) * k / n, y = d.y + (h.y - d.y) * k / n;
        for (const ca of d.cols) for (const ry of d.rows) {
          if (Math.hypot(ca - a, ry - y) > MM(320)) continue;
          const key = ca.toFixed(5) + ':' + ry.toFixed(5);
          if (d.pts.has(key) || have.some(([ba, by]) => Math.abs(ba - ca) < MM(5) && Math.abs(by - ry) < MM(5))) continue;
          if (!cutPiece(F, [ca - MM(30), ry - MM(60), ca + MM(30), ry + MM(60)], 0).length || F.holes.some((q) => ca > q[0] - MM(60) && ca < q[2] + MM(60) && ry > q[1] - MM(80) && ry < q[3] + MM(80))) continue;   // (an opening: none in it, 60 mm off its edge)
          if (F.topAt && ry > F.topAt(ca) - MM(120)) continue;
          d.pts.set(key, [ca, ry]);
        }
      }
      d.a = h.a; d.y = h.y;
      this._live(F, { layer: 'br', pts: [...d.pts.values()] });
      return;
    }
    // a rail: on the line of brackets nearest the finger, from where it went down to where it is
    d.a = h.a; d.y = h.y;
    const ca = d.cols.reduce((b, c) => (Math.abs(c - d.a0) < Math.abs(b - d.a0) ? c : b), d.cols[0]), e = ext(F, OFF.rl);
    let y0 = Math.min(d.y0, h.y), y1 = Math.max(d.y0, h.y);
    if (y0 - e[1] < MM(400)) y0 = e[1] + MM(20); if (e[3] - y1 < MM(400)) y1 = e[3] - MM(20);
    if (F.topAt) y1 = Math.min(y1, F.topAt(ca) - MM(20));
    const on = (d.rec?.br || []).filter(([ba, by]) => Math.abs(ba - ca) < MM(5) && by >= y0 - MM(60) && by <= y1 + MM(60)).length;
    d.rail = y1 - y0 > MM(300) ? [ca, +y0.toFixed(6), +y1.toFixed(6)] : null; d.on = on;
    this._live(F, { layer: 'rl', rail: d.rail });
    if (d.rail) this.app.ui.showMeasure(`Направляющая ${((y1 - y0) / S / 1000).toFixed(2).replace('.', ',')} м — на ${on} кронштейн${on === 1 ? 'е' : 'ах'}`);
  }
  _ventUp(d, rec) {
    const app = this.app, L = this.layer, F = d.F;
    if (L === 'br') {
      if (!d.pts.size) { app.ui.toast('Здесь кронштейны уже стоят (или проём)'); return; }
      this._save(F, { br: [...(rec.br || []), ...d.pts.values()] }, 'facade-brackets');
      app.ui.toast(`Кронштейнов: ${d.pts.size} — на анкер-дюбели, паронитовая прокладка от мостика холода`);
      return;
    }
    if (!d.rail) { app.ui.toast('Направляющая: проведите пальцем вверх или вниз вдоль линии кронштейнов'); return; }
    if (d.on < 2) { app.ui.toast('Направляющую крепят минимум на два кронштейна — продлите её'); return; }
    // (cut at the openings: the rail stops 20 mm short of an opening, goes on over it)
    let pieces = [[d.rail[1], d.rail[2]]];
    for (const q of F.holes) if (d.rail[0] > q[0] - MM(40) && d.rail[0] < q[2] + MM(40)) pieces = pieces.flatMap(([y0, y1]) => (q[3] <= y0 || q[1] >= y1 ? [[y0, y1]] : [[y0, q[1] - MM(20)], [q[3] + MM(20), y1]]).filter(([p, r]) => r - p > MM(200)));
    const old = (rec.rl || []).filter(([a, y0, y1]) => !(Math.abs(a - d.rail[0]) < MM(5) && pieces.some(([p, r]) => Math.min(r, y1) > Math.max(p, y0))));
    this._save(F, { rl: [...old, ...pieces.map(([y0, y1]) => [d.rail[0], +y0.toFixed(6), +y1.toFixed(6)])] }, 'facade-rail');
    app.ui.toast(`Направляющая на ${d.on} кронштейнах — на заклёпки, зазор 40 мм за панелями`);
  }
  // the share of the face's insulation not done yet in this layer
  _left(F, rec, L) {
    const eps = (rec?.eps || []).flatMap((s) => cutPiece(F, s, OFF.eps)), all = area(eps);
    if (!all) return null;
    const set = L === 'glue' ? cellsOf(rec.glue) : L === 'emb' ? cellsOf(rec.emb) : L === 'pl' ? new Set(Object.values(rec.pl || {}).flatMap((r) => [...cellsOf(r)])) : new Set([...cellsOf(rec.fl?.v), ...cellsOf(rec.fl?.h)]);
    return Math.max(0, Math.round((1 - set.size * CELL * CELL / all) * 100));
  }
  // the strip of mesh being rolled out: 1 m wide along the drag, snapped to the strip beside
  // it with its overlap and to the ends of the face; cut where the face ends
  _strip(d) {
    const mbL = this.layer === 'mb', F = d.F, W = MM(mbL ? VENT_SUB.mbW : FACADE.meshW), lap = MM(mbL ? VENT_SUB.mbLap : FACADE.meshLap), e = ext(F, mbL ? OFF.mb : OFF.loose), da = d.a - d.a0, dy = d.y - d.y0;
    if (Math.hypot(da, dy) < MM(150)) return null;
    if (d.vert == null) d.vert = Math.abs(dy) >= Math.abs(da);
    const V = d.vert, lo = V ? e[0] : e[1], hi = V ? e[2] : e[3], amin = V ? e[1] : e[0], amax = V ? e[3] : e[2], snap = MM(450);
    const acr = V ? d.a0 : d.y0;
    let c0 = acr - W / 2;
    if (Math.abs(acr - lo) < W / 2) c0 = lo; else if (Math.abs(acr - hi) < W / 2) c0 = hi - W;
    // to the strip beside it with the overlap: the nearest place that does not cover a strip again
    const prev = (this._rec(F)?.[mbL ? 'mb' : 'mesh'] || []).filter((r) => (r[3] - r[1] > r[2] - r[0]) === V).map((r) => (V ? [r[0], r[2]] : [r[1], r[3]]));
    const free = (x) => prev.every(([e0, e1]) => Math.min(e1, x + W) - Math.max(e0, x) <= lap + MM(5));
    let best = null;
    for (const [e0, e1] of prev) for (const x of [e1 - lap, e0 + lap - W]) if (Math.abs(x - c0) < snap && free(x) && (!best || Math.abs(x - c0) < Math.abs(best - c0))) best = x;
    if (best != null) c0 = best;
    let c1 = c0 + W; c0 = Math.max(c0, lo); c1 = Math.min(c1, hi);
    let a0 = Math.min(V ? d.y0 : d.a0, V ? d.y : d.a), a1 = Math.max(V ? d.y0 : d.a0, V ? d.y : d.a);
    if (a0 - amin < snap) a0 = amin; if (amax - a1 < snap) a1 = amax;
    a0 = Math.max(a0, amin); a1 = Math.min(a1, amax);
    if (a1 - a0 < MM(150) || c1 - c0 < MM(100)) return null;
    d.end = (V ? d.y : d.a) > (V ? d.y0 : d.a0) ? a1 : a0;
    return (V ? [c0, a0, c1, a1] : [a0, c0, a1, c1]).map((v) => +v.toFixed(6));
  }

  // ---- the boards and the panels: carried from the tray ----
  carryMove(p, e) {
    const L = this.layer, h = this._hit(e, L === 'eps' ? 0 : OFF.eps);
    this.place = null;
    if (!h) { this._live(null); return null; }
    const V = L === 'mw' || L === 'vp', key = L === 'vp' ? this.ventKey : this.app.settings.facPanel || 'stone:sandstone', md = L === 'mw' ? [VENT_SUB.mwL, VENT_SUB.mwW] : panelMod(key);
    const F = h.F, rec = this._rec(F), slot = V ? ventSlot(F, h.a, h.y, L, md) : slotAt(F, h.a, h.y, L, md), off = L === 'eps' ? OFF.eps : L === 'mw' ? OFF.mw : L === 'vp' ? OFF.vent : OFF.pan;
    const piece = cutPiece(F, slot, off), full = L === 'eps' ? MM(FACADE.epsL) * MM(FACADE.epsW) : MM(md[0]) * MM(md[1]);
    let why = null;
    if (!piece.length) why = 'Здесь проём — лист не нужен';
    else if ((rec?.[L] || []).some((s) => sameSlot(s, slot) || (L === 'pan' && Math.min(s[2], slot[2]) - Math.max(s[0], slot[0]) > MM(20) && Math.min(s[3], slot[3]) - Math.max(s[1], slot[1]) > MM(20)))) why = 'Это место уже закрыто';
    else if (L === 'mw' && (rec?.eps?.length || rec?.pan?.length)) why = 'Здесь мокрый фасад — вентфасад на него не делают';
    else if (L === 'mw' && !(rec?.br || []).some(([a, y]) => inR([slot[0] - MM(300), slot[1] - MM(800), slot[2] + MM(300), slot[3] + MM(800)], a, y))) why = 'Сначала кронштейны: минвату ставят между ними (они проходят сквозь плиту)';
    else if (L === 'vp' && !railsHold(rec, piece)) why = 'Панель крепят к направляющим: под ней нужно минимум две (на её краях — на стыках)';
    else if (L === 'pan') {
      // on the insulation, not over the plaster
      // (its points under the face's top: by a gable's slope the panel is cut along it)
      const pts = piece.flatMap((r) => [[(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], [r[0] + MM(60), r[1] + MM(60)], [r[2] - MM(60), r[3] - MM(60)], [r[0] + MM(60), r[3] - MM(60)], [r[2] - MM(60), r[1] + MM(60)]])
        .filter(([a, y]) => !F.topAt || y < F.topAt(a) - MM(20)).slice(0, 5);
      const eps = (rec?.eps || []).flatMap((s) => cutPiece(F, s, OFF.eps)), pl = Object.values(rec?.pl || {}).map(cellsOf);
      if (!pts.every(([a, y]) => eps.some((r) => inR(r, a, y)))) why = 'Панели вешают на утеплитель: сначала листы ППС';
      else if (pts.some(([a, y]) => pl.some((s) => s.has(ck(Math.floor(a / CELL), Math.floor(y / CELL)))))) why = 'Здесь уже штукатурка';
    }
    const cut = !why && Math.abs(area(piece) - full) > full * 0.01;
    this.place = { F, slot, why, cut, size: piece.length ? [Math.round((Math.max(...piece.map((r) => r[2])) - Math.min(...piece.map((r) => r[0]))) / S), Math.round((Math.max(...piece.map((r) => r[3])) - Math.min(...piece.map((r) => r[1]))) / S)] : [0, 0] };
    this._live(F, { layer: L, slot, ok: !why, key });
    return { ok: !why, why, cut };
  }
  carryDrop() {
    const app = this.app, P = this.place, L = this.layer;
    this.place = null; this._live(null);
    if (!P) { app.ui.toast(`${L === 'eps' ? 'Лист утеплителя' : 'Панель'} — на наружную сторону стены`); return; }
    if (P.why) { app.ui.toast(P.why); return; }
    const rec = this._rec(P.F) || {};
    if (L === 'mw') {
      this._save(P.F, { mw: [...(rec.mw || []), P.slot] }, 'facade-wool');
      app.ui.toast(`Плита минваты ${P.size[0]} × ${P.size[1]} × 100${P.cut ? ' — подрезана по месту' : ''}: надрезана под кронштейны, 2 тарельчатых дюбеля`);
    } else if (L === 'vp') {
      const key = this.ventKey, kind = key.split(':')[0];
      this._save(P.F, { vp: [...(rec.vp || []), [...P.slot, key]] }, 'facade-vent');
      app.ui.toast(`${PANELS[key][0]}: ${P.size[0]} × ${P.size[1]} мм${P.cut ? ' — подрезана' : ''} — ${{ porc: 'на кляммеры', fc: 'на заклёпки', hpl: 'на заклёпки', cas: 'навешена на крючки' }[kind]}, шов 8–10 мм открытый`);
    } else if (L === 'eps') {
      this._save(P.F, { eps: [...(rec.eps || []), P.slot] }, 'facade-eps');
      app.ui.toast(`Лист ППС ${P.size[0]} × ${P.size[1]} мм на клей${P.cut ? ' — подрезан по месту' : ''}, 5 дюбелей-грибков`);
    } else {
      const key = app.settings.facPanel || 'stone:sandstone';
      this._save(P.F, { pan: [...(rec.pan || []), [...P.slot, key]] }, 'facade-panel');
      app.ui.toast(`${PANELS[key][0]}: панель ${P.size[0]} × ${P.size[1]} мм${P.cut ? ' — подрезана по месту' : ''}`);
    }
  }
  status(carry) {
    const L = this.layer;
    if (carry) {
      const P = this.place, nm = L === 'eps' ? 'Лист' : L === 'mw' ? 'Плита' : 'Панель';
      if (!P) return `Поднесите ${L === 'eps' ? 'лист утеплителя' : L === 'mw' ? 'плиту минваты' : 'панель'} к наружной стороне стены`;
      if (P.why) return 'Красный — ' + P.why;
      return `${nm} ${P.size[0]} × ${P.size[1]} мм${P.cut ? ' — подрежется по месту' : ''} — отпустите`;
    }
    return {
      eps: 'Утеплитель ППС 1000 × 500 × 100: тяните лист из лотка на стену — ложится на клей вразбежку, у проёмов и углов подрезается, 5 грибков',
      glue: 'Клей: ведите шпателем по утеплителю — базовый слой 3 мм',
      mesh: 'Сетка: проведите пальцем вдоль стены (сверху вниз) — рулон 1 м раскатается по свежему клею, нахлёст 100 мм',
      emb: 'Вдавить сетку: ведите шпателем по сетке — она утопает в клею и приглаживается',
      pl: 'Штукатурка: выберите фактуру и цвет, ведите шпателем по базовому слою',
      fl: 'Затирка: ведите тёркой по свежей штукатурке — вверх-вниз или вдоль; проявится фактура',
      pan: 'Панели 1000 × 500: выберите вид и тяните из лотка на утеплитель — у проёмов и углов подрежутся',
      br: 'Кронштейны: ведите пальцем по стене — встанут на линиях направляющих (через 600 мм), по высоте через 800, на анкер-дюбели с паронитовой прокладкой',
      mw: 'Минвата 1000 × 600 × 100: тяните плиту из лотка между кронштейнами — вразбежку, 2 тарельчатых дюбеля',
      mb: 'Мембрана: проведите пальцем вдоль стены — рулон 1,5 м натянется по минвате, нахлёст 100 мм',
      rl: 'Направляющие: ведите пальцем вверх-вниз по линии кронштейнов — профиль встанет на них (минимум на два)',
      vp: 'Панели вентфасада: выберите материал и тяните из лотка на направляющие — открытые швы, у проёмов подрежутся',
    }[L];
  }
  // «Удалить» on the facade: what is on top under the finger comes off — the panel there, the
  // coat round the finger, the strip of mesh there, the board there
  remove(id, e) {
    const app = this.app, r = app.objects.get(id);
    if (!r) return;
    const F = this.faces().find((f) => recOf([r], f));
    const h = F && this._hit(e, OFF.fin, F) || (F && this._hit(e, OFF.eps, F));
    if (!F || !h) { app.ui.toast('Коснитесь того, что снять, на стене'); return; }
    const { a, y } = h, R = MM(250), save = (patch, nm) => {
      const rec = { ...r, ...patch }; delete rec.id;
      const empty = !rec.eps?.length && !rec.pan?.length && !rec.mesh?.length && !rec.br?.length && !rec.mw?.length && !rec.mb?.length && !rec.rl?.length && !rec.vp?.length && !cellsOf(rec.glue).size && !cellsOf(rec.emb).size && !Object.values(rec.pl || {}).some((x) => x?.length);
      app.journal.act('facade-remove', {}, app.clock, () => { if (empty) app.objects.remove(id); else app.objects.update(id, rec); });
      app.ui.toast(`Сняли ${nm}`);
    };
    const near = (set) => { const out = new Set(); for (const k of set) { const [i, j] = cij(k); if (Math.hypot((i + 0.5) * CELL - a, (j + 0.5) * CELL - y) < R) out.add(k); } return out; };
    const without = (runs) => { const s = cellsOf(runs), cut = near(s); return cut.size ? runsOf(new Set([...s].filter((k) => !cut.has(k)))) : null; };
    // the ventilated facade, from the top: the panel, the rail, the membrane, the wool, the bracket
    const vi = (r.vp || []).findIndex((p) => inR(p, a, y));
    if (vi >= 0) { save({ vp: r.vp.filter((_, k) => k !== vi) }, 'панель'); return; }
    const ri = (r.rl || []).findIndex(([ra, y0, y1]) => Math.abs(ra - a) < MM(120) && y >= y0 && y <= y1);
    if (ri >= 0 && !(r.vp || []).length) { save({ rl: r.rl.filter((_, k) => k !== ri) }, 'направляющую'); return; }
    const bi2 = (r.mb || []).findIndex((m) => inR(m, a, y));
    if (bi2 >= 0 && !(r.rl || []).length) { save({ mb: r.mb.filter((_, k) => k !== bi2) }, 'полосу мембраны'); return; }
    const wi = (r.mw || []).findIndex((s) => inR(s, a, y));
    if (wi >= 0) { save({ mw: r.mw.filter((_, k) => k !== wi) }, 'плиту минваты'); return; }
    const bri = (r.br || []).findIndex(([ba, by]) => Math.hypot(ba - a, by - y) < R);
    if (bri >= 0 && !(r.rl || []).some(([ra]) => Math.abs(ra - r.br[bri][0]) < MM(5))) { save({ br: r.br.filter((_, k) => k !== bri) }, 'кронштейн'); return; }
    // the panel
    const pi = (r.pan || []).findIndex((p) => inR(p, a, y));
    if (pi >= 0) { save({ pan: r.pan.filter((_, k) => k !== pi) }, 'панель'); return; }
    // the plaster (with its float marks)
    for (const [k, runs] of Object.entries(r.pl || {})) {
      const left = without(runs);
      if (left) { const fl = { v: without(r.fl?.v) || r.fl?.v || [], h: without(r.fl?.h) || r.fl?.h || [] }; save({ pl: { ...r.pl, [k]: left }, fl }, 'штукатурку'); return; }
    }
    const emb = without(r.emb); if (emb) { save({ emb }, 'базовый слой'); return; }
    const mi = (r.mesh || []).findIndex((m) => inR(m, a, y));
    if (mi >= 0) { save({ mesh: r.mesh.filter((_, k) => k !== mi) }, 'полосу сетки'); return; }
    const glue = without(r.glue); if (glue) { save({ glue }, 'клей'); return; }
    const ei = (r.eps || []).findIndex((s) => inR(s, a, y));
    if (ei >= 0) { save({ eps: r.eps.filter((_, k) => k !== ei) }, 'лист утеплителя'); return; }
    app.ui.toast('Здесь на стене ничего нет');
  }
}
