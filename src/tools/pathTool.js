import * as THREE from 'three';
import { MODEL_SCALE, M_G5, M_G20, M_SAND, M_SOIL } from '../config.js';
import { FitJob, ease } from './fitJob.js';
import { LANG } from '../i18n/i18n.js';
import {
  PATH, PATH_LAYERS2, PAVERS, PAVE_COLS, TOPS, lineOf, lineWhy, filletLine, legsOf, legL, lengthOf, half, paveQuads, digQuads, kerbOuter, inQuads, chainOf, kerbsOf, paversOf,
} from '../world/garden.js';
import { pointAt } from '../world/gardenView.js';

// The garden path laid by hand («Благоустройство → Дорожка», path records v: 2; garden.js):
//   set   – «Шнур» on: the finger pulls the path's middle line (its width — the slider); the corners
//           straight or rounded (their radius — the slider); off: a corner's peg dragged to a new place;
//   dig   – the trough dug at a touch (300 under the ground, wider than the path) — or by the shovel;
//   kerb  – the kerbs one at a time (the ghost under the finger, as a block: green — it goes there) or
//           a row along a side («Ряд»): each on its bed of concrete, a quarter of it out of the ground,
//           tapped down with the mallet; the soil put back behind them once all are in;
//   geo   – the geotextile rolled out by the finger along the trough;
//   grav, sand – spread and rammed at a touch — or by hand from «Материалы» (the rake, the plate):
//           when they lie at their levels the stage is done;
//   pave  – the pavers laid by the finger where it goes, the joints filled as they go; the area laid.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const EN = () => LANG === 'en';
const f1 = (v) => (EN() ? v.toFixed(1) : v.toFixed(1).replace('.', ','));
const NAME = Object.fromEntries(PATH_LAYERS2);

export class PathWork {
  constructor(land) { this.land = land; this.app = land.app; this.drag = null; this.cord = false; this.row = false; this.ghost = null; }
  get s() { return this.app.settings; }
  get L() { return NAME[this.s.pathLayer] ? this.s.pathLayer : 'set'; }
  get W() { return Math.max(500, Math.min(3000, Math.round((this.s.pathW || 1200) / 100) * 100)); }
  get roundOn() { return this.s.pathCorner === 'round'; }
  get R() { return Math.max(300, Math.min(5000, Math.round((this.s.pathR || 1500) / 100) * 100)); }
  get paver() { return PAVERS[this.s.pathPaver] ? this.s.pathPaver : 'brick'; }
  get col() { return PAVE_COLS[this.s.pathCol] ? this.s.pathCol : 'grey'; }
  get view() { return this.app.gardenView; }
  get paths() { return this.app.objects.all('path').filter((r) => r.v === 2); }
  get rec() { const all = this.paths; return all.find((r) => r.id === this.land.sel) || all.at(-1) || null; }
  toast(m) { this.app.ui?.toast(m); }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  _scr(v) { return this.app.wallTool._screen(v); }

  // the width and the corners chosen: taken by the path set out last while its trough is not dug
  restyle() {
    const r = this.rec, app = this.app;
    if (!r || r.done?.dig || (r.kerbs || []).length) return;
    const round = this.roundOn ? this.R : 0;
    if (r.W === this.W && (r.round || 0) === round) return;
    if (lineWhy(r.base || r.pts, this.W)) { this.toast(lineWhy(r.base || r.pts, this.W)); return; }
    this._save('path-size', () => app.objects.update(r.id, { W: this.W, round, pts: filletLine(r.base || r.pts, round) }));
  }
  // the path under (or nearest) a point, within its trough and 1 m round it
  pick(p) {
    let best = null, bd = Infinity;
    for (const r of this.paths) {
      const s = chainOf(r, p.x, p.z) / S, P = pointAt(r, s), d = Math.hypot(P[0] - p.x, P[1] - p.z) - half(r);
      if (d < MM(1000) && d < bd) { bd = d; best = r; }
    }
    if (best) this.land.sel = best.id;
    return best;
  }

  // ---- what lies in the trough (the other work on the plot counts) ----
  _samples(r, n = 24) {
    const L = lengthOf(r) / S, out = [];
    for (let k = 0; k < n; k++) { const s = L * (k + 0.5) / n, P = pointAt(r, s); for (const c of [-0.6, 0, 0.6]) out.push([P[0] - P[3] * half(r) * c, P[1] + P[2] * half(r) * c]); }
    return out;
  }
  troughOK(r) {
    if (r.done?.dig) return true;
    const t = this.app.terrain, P = this._samples(r), y = r.g - MM(PATH.dig - 60);
    return P.filter(([x, z]) => t.inside(x, z) && t.heightAt(x, z) <= y).length >= P.length * 0.85;
  }
  // a layer lying at its level: its top material, within 25 mm of the level (rammed, for the stone)
  layerOK(r, mats, yTop, rammed) {
    const t = this.app.terrain, P = this._samples(r);
    const ok = P.filter(([x, z]) => { if (!t.inside(x, z)) return false; const i = t.index(x, z); return mats.includes(t.topMat(i)) && Math.abs(t.heightAt(x, z) - yTop) < MM(25) && (!rammed || t.comp[i] > 0); }).length;
    return ok >= P.length * 0.8;
  }
  kerbsAll(r) { return (r.kerbs || []).length >= kerbsOf(r).length; }
  geoCover(r) { const L = lengthOf(r) / S; return Math.min(1, merge(r.geo || []).reduce((s, [a, b]) => s + (Math.min(L, b) - Math.max(0, a)), 0) / Math.max(1, L)); }
  stageDone(r, k) {
    const d = r.done || {};
    if (k === 'dig') return this.troughOK(r);
    if (k === 'kerb') return this.kerbsAll(r);
    if (k === 'geo') return d.geo || this.geoCover(r) > 0.95;
    if (k === 'grav') return d.grav || this.layerOK(r, [M_G5, M_G20], r.g + MM(TOPS.grav), true);
    if (k === 'sand') return d.sand || this.layerOK(r, [M_SAND], r.g + MM(TOPS.sand), false);
    if (k === 'pave') return (r.laid || []).length >= paversOf(r).length;
    return false;
  }
  // (no stage waits for another: the trough as deep as it is dug, the layers as thick as they are spread —
  // the pavers go on at the ground's level whatever is under them)
  _need() { return null; }
  next(r = this.rec) {
    if (!r) return ['set', 'Разметьте дорожку: включите «Шнур» и тяните пальцем'];
    for (const [k, n] of PATH_LAYERS2.slice(1)) if (!this.stageDone(r, k)) return [k, n];
    return [null, 'Дорожка готова'];
  }

  down(p, e) {
    const app = this.app, L = this.L;
    if (app.physJob?.fit) app.physJob.finish();
    if (app.physJob) return true;
    if (L === 'set') {
      if (this.cord) { this.drag = { L: 'cord', trail: [[p.x, p.z]] }; app.ui?.showMeasure?.(EN() ? 'Pull the string along the path' : 'Тяните шнур вдоль будущей дорожки'); return true; }
      // (a corner's peg: dragged to a new place, the line after it — before the trough is dug)
      const V = this._corner(p, e);
      if (!V) { this.toast(this.paths.length ? 'Колышек на углу двигают пальцем; новая разметка — «Шнур» справа' : 'Включите «Шнур» справа и тяните пальцем — где пройдёт дорожка'); return true; }
      if (V.r.done?.dig || (V.r.kerbs || []).length) { this.toast('Корыто уже выкопано — разметку не двигают'); return true; }
      app.journal.begin('path-corner', {}, app.clock);
      this.drag = { L: 'corner', id: V.r.id, k: V.k };
      return true;
    }
    const r = this.pick(p);
    if (!r) { this.toast('Сначала «1 · Разметка»: включите «Шнур» и протяните дорожку'); return true; }
    const why = this._need(r, L);
    if (why) { this.toast(why); return true; }
    if (L === 'dig') { if (this.troughOK(r)) { this.toast('Корыто уже выкопано. Дальше «3 · Бордюр»'); return true; } this.land._dig(r); return true; }
    if (L === 'kerb') { this.drag = { L: 'kerb', id: r.id, row: this.row }; this._kerbMove(p, e, true); return true; }
    if (L === 'geo') { const s0 = chainOf(r, p.x, p.z) / S; this.drag = { L: 'geo', id: r.id, s0, s1: s0 }; this.view.setAnim(r.id, { geo: [s0, s0], roll: s0, rolled: 0 }); return true; }
    if (L === 'grav') {
      if (this.stageDone(r, 'grav')) { this.toast('Щебень уже насыпан и утрамбован. Дальше «6 · Песок»'); return true; }
      this.land._grav(r); return true;
    }
    if (L === 'sand') {
      if (this.stageDone(r, 'sand')) { this.toast('Песок уже выровнен. Дальше «7 · Плитка»'); return true; }
      this.land._sand(r); return true;
    }
    if (L === 'pave') {
      if ((r.laid || []).length && (r.paver !== this.paver || r.col !== this.col)) { this.toast('Здесь уже кладут другую плитку — выберите её же в «7 · Плитка» (или разберите)'); return true; }
      app.journal.begin('path-pave', {}, app.clock);
      if (!(r.laid || []).length) app.objects.update(r.id, { paver: this.paver, col: this.col });
      this.drag = { L: 'pave', id: r.id, laid: [...(app.objects.get(r.id).laid || [])], t: 0 };
      this._paveMove(p);
      return true;
    }
    return true;
  }
  // the tray (the kerb taken from it)
  trayDown(p, e) {
    if (this.L !== 'kerb') { this.toast(this.status()); return false; }
    const r = p ? this.pick(p) : this.rec;
    if (!r) { this.toast('Сначала «1 · Разметка»'); return false; }
    const why = this._need(r, 'kerb');
    if (why) { this.toast(why); return false; }
    this.drag = { L: 'kerb', id: r.id, row: false, tray: true };
    if (p) this._kerbMove(p, e, true);
    return true;
  }
  move(p, e) {
    const d = this.drag, app = this.app;
    if (!d || !p) return;
    if (d.L === 'cord') {
      const last = d.trail.at(-1);
      if (Math.hypot(p.x - last[0], p.z - last[1]) < MM(80)) return;
      d.trail.push([p.x, p.z]);
      const base = lineOf(d.trail) || [d.trail[0], [p.x, p.z]], pts = filletLine(base, this.roundOn ? this.R : 0), g = this.land._groundOf(pts), r = { pts, W: this.W, g };
      this.view.setLive(r);
      const len = legsOf(r).reduce((s, q) => s + q.L, 0) / S / 1000;
      app.ui?.showMeasure?.(lineWhy(base, this.W) || (EN() ? `Path ${f1(len)} m × ${f1(this.W / 1000)} m — let go where it ends` : `Дорожка ${f1(len)} м × ${f1(this.W / 1000)} м — отпустите, где она кончается`));
    } else if (d.L === 'corner') {
      const r = app.objects.get(d.id); if (!r) return;
      const base = r.base.map((q, k) => (k === d.k ? [+p.x.toFixed(5), +p.z.toFixed(5)] : q)), why = lineWhy(base, r.W);
      d.why = why;
      if (!why) app.objects.update(r.id, { base, pts: filletLine(base, r.round || 0) });
      const lg = legsOf({ pts: base }), lens = lg.map((q) => f1(q.L / S / 1000)).join(' · ');
      app.ui?.showMeasure?.(why || (EN() ? `Legs: ${lens} m` : `Отрезки: ${lens} м`));
    } else if (d.L === 'kerb') this._kerbMove(p, e);
    else if (d.L === 'geo') {
      const r = app.objects.get(d.id), L = lengthOf(r) / S;
      d.s1 = Math.max(0, Math.min(L, chainOf(r, p.x, p.z) / S));
      this.view.setAnim(r.id, { geo: [d.s0, d.s1], roll: d.s1, rolled: Math.abs(d.s1 - d.s0) });
      app.ui?.showMeasure?.(EN() ? `Geotextile ${f1(Math.abs(d.s1 - d.s0) / 1000)} m` : `Геотекстиль ${f1(Math.abs(d.s1 - d.s0) / 1000)} м`);
    } else if (d.L === 'pave') this._paveMove(p);
  }
  up() {
    const app = this.app, d = this.drag;
    this.drag = null;
    app.ui?.hideMeasure?.();
    if (!d) return;
    if (d.L === 'cord') {
      this.view.setLive(null);
      const base = lineOf(d.trail);
      if (!base) { this.toast('Дорожка короче метра — тяните шнур длиннее'); return; }
      const why = lineWhy(base, this.W);
      if (why) { this.toast(why); return; }
      const round = this.roundOn ? this.R : 0, pts = filletLine(base, round);
      const rec = { type: 'path', v: 2, base, pts, round, W: this.W, g: +this.land._groundOf(pts).toFixed(6), done: {}, kerbs: [], geo: [], laid: [] };
      const fit = this.land._fits(rec);
      if (fit) { this.toast(fit); return; }
      this._save('path-set-out', () => { this.land.sel = app.objects.add(rec).id; });
      const len = lengthOf(rec) / S / 1000;
      this.toast(EN() ? `Path ${f1(len)} m, ${f1(this.W / 1000)} m wide, corners ${round ? 'rounded' : 'square'}: pegs and strings along the kerbs. A corner peg can be dragged («Шнур» off). Next «2 · Trough»`
        : `Дорожка ${f1(len)} м, ширина ${f1(this.W / 1000)} м, углы ${round ? 'скруглённые' : 'прямые'}: колышки и шнур по бордюрам. Угловой колышек можно сдвинуть («Шнур» выключен). Дальше «2 · Корыто»`);
      return;
    }
    if (d.L === 'corner') { if (d.why) { app.journal.cancel(); this.toast(d.why); } else app.journal.commit(app.clock); return; }
    if (d.L === 'kerb') { this._ghost(null); if (d.P && !d.P.why) this._kerbLay(d); else if (d.P?.why) this.toast(d.P.why); else if (!d.tray || d.moved) this.toast('Поднесите бордюр к краю дорожки'); return; }
    if (d.L === 'geo') {
      const r = app.objects.get(d.id);
      this.view.setAnim(r.id, null);
      if (Math.abs(d.s1 - d.s0) < 150) { this.toast('Раскатайте рулон вдоль корыта — ведите пальцем'); return; }
      const geo = merge([...(r.geo || []), [Math.min(d.s0, d.s1), Math.max(d.s0, d.s1)]]);
      this._save('path-geo', () => app.objects.update(r.id, { geo, done: { ...(r.done || {}), ...(this.geoCover({ ...r, geo }) > 0.95 ? { geo: 1 } : {}) } }));
      const cov = this.geoCover(app.objects.get(r.id)), A = lengthOf(r) / S / 1000 * (r.W + 2 * (PATH.kerbW + PATH.room)) / 1000 * cov;
      this.toast(EN() ? `Geotextile rolled out: ${Math.round(cov * 100)} % of the trough (${f1(A)} m²)${cov > 0.95 ? '. Next «5 · Crushed stone»' : ' — roll on'}` : `Геотекстиль раскатан: ${Math.round(cov * 100)} % корыта (${f1(A)} м²)${cov > 0.95 ? '. Дальше «5 · Щебень»' : ' — раскатывайте дальше'}`);
      return;
    }
    if (d.L === 'pave') {
      const r = app.objects.get(d.id);
      this.view.setAnim(r.id, null);
      if (d.laid.length === (r.laid || []).length) { app.journal.cancel(); return; }
      app.objects.update(r.id, { laid: d.laid, ...(d.laid.length >= paversOf(r).length ? { done: { ...(r.done || {}), pave: 1 } } : {}) });
      app.journal.commit(app.clock);
      const all = paversOf(r), A = d.laid.reduce((s, i) => s + (all[i]?.area || 0), 0) / 1e6, T = all.reduce((s, q) => s + q.area, 0) / 1e6;
      this.toast(EN() ? `Laid ${f1(A)} of ${f1(T)} m² (${d.laid.length} of ${all.length} pieces), the joints swept with sand${d.laid.length >= all.length ? ' — the path is finished' : ''}` : `Уложено ${f1(A)} из ${f1(T)} м² (${d.laid.length} из ${all.length} шт), швы заметены песком${d.laid.length >= all.length ? ' — дорожка готова' : ''}`);
    }
  }
  interrupt() {
    const d = this.drag; this.drag = null; this._ghost(null);
    if (d?.L === 'cord') this.view.setLive(null);
    if (d?.L === 'corner' || d?.L === 'pave') { this.app.journal.cancel(); if (d.L === 'pave') this.view.setAnim(d.id, null); }
    if (d?.L === 'geo') this.view.setAnim(d.id, null);
    this.app.ui?.hideMeasure?.();
  }

  // a corner of a path's line under the finger (its pegs each side): { r, k }
  _corner(p, e) {
    let best = null, bd = Infinity;
    for (const r of this.paths) (r.base || []).forEach((q, k) => {
      let d;
      if (e && e.clientX !== undefined) { const sp = this._scr(new THREE.Vector3(q[0], r.g, q[1])); if (!sp.front) return; d = Math.hypot(sp.x - e.clientX, sp.y - e.clientY); if (d > 70) return; }
      else { d = Math.hypot(p.x - q[0], p.z - q[1]) / S; if (d > 600) return; }
      if (d < bd) { bd = d; best = { r, k }; }
    });
    return best;
  }

  // ---- the kerbs ----
  // the kerb not laid yet nearest the finger (the ghost on it); in a row: from where it started
  _kerbMove(p, e, first = false) {
    const d = this.drag, app = this.app, r = app.objects.get(d.id);
    if (!r) return;
    if (!first) d.moved = true;
    const K = kerbsOf(r), laid = new Set(r.kerbs || []);
    let best = -1, bd = Infinity;
    K.forEach((k, i) => { if (laid.has(i)) return; const cx = k.p.reduce((s, q) => s + q[0], 0) / k.p.length, cz = k.p.reduce((s, q) => s + q[1], 0) / k.p.length, dd = Math.hypot(cx - p.x, cz - p.z); if (dd < bd) { bd = dd; best = i; } });
    if (best < 0) { d.P = { why: 'Бордюры уже все уложены' }; this._ghost(null); return; }
    if (bd > MM(900)) { d.P = null; this._ghost(null); app.ui?.showMeasure?.(EN() ? 'Bring the kerb to the path\'s edge' : 'Поднесите бордюр к краю дорожки'); return; }
    if (d.row && first) d.start = best;
    const side = (i) => { const k = K[i], cx = k.p.reduce((s, q) => s + q[0], 0) / k.p.length, cz = k.p.reduce((s, q) => s + q[1], 0) / k.p.length, g = legsOf(r).find((q) => chainOf(r, cx, cz) >= q.a0 - 1e-9) || legsOf(r)[0]; return Math.sign(legL(g, cx, cz)[1]) || 1; };
    let list = [best];
    if (d.row && d.start != null) {
      const a = K[d.start].s, b = K[best].s, sd = side(d.start), lo = Math.min(a, b), hi = Math.max(a, b);
      list = K.map((k, i) => i).filter((i) => !laid.has(i) && side(i) === sd && K[i].s >= lo - 1 && K[i].s <= hi + 1).sort((x, y) => (a <= b ? K[x].s - K[y].s : K[y].s - K[x].s));
      if (!list.includes(d.start)) list.unshift(d.start);
    }
    d.P = { list, why: null };
    const k = d.row && d.start != null ? list : [best], key = k.join(',');
    if (key !== this._gk) { this._gk = key; this._ghost(kerbGhost(r, k.map((i) => K[i]))); }
    const len = k.reduce((s, i) => s + polyLen(K[i].p), 0);
    app.ui?.showMeasure?.(EN() ? `${k.length > 1 ? `A row of ${k.length} kerbs, ${f1(len / 1000)} m` : `Kerb ${Math.round(len)} mm`} — let go` : `${k.length > 1 ? `Ряд из ${k.length} бордюров, ${f1(len / 1000)} м` : `Бордюр ${Math.round(len)} мм`} — отпустите`);
  }
  _ghost(o) { this._gk = o ? this._gk : null; if (this.ghost) { this.app.scene.remove(this.ghost); this.ghost.traverse((m) => m.geometry?.dispose()); this.ghost = null; } if (o) { this.ghost = o; this.app.scene.add(o); } }
  // each lowered onto its bed of concrete, tapped down with the rubber mallet to the string; once the
  // last is in, the soil is put back behind them
  _kerbLay(d) {
    const app = this.app, r = app.objects.get(d.id), K = kerbsOf(r), list = d.P.list, gear = app.concreteGear, steps = [];
    app.journal.begin('path-kerb', {}, app.clock);
    const laidNow = [];
    for (const i of list) {
      const k = K[i], cx = k.p.reduce((s, q) => s + q[0], 0) / k.p.length, cz = k.p.reduce((s, q) => s + q[1], 0) / k.p.length;
      steps.push([0.42, (u, job) => {
        if (!laidNow.includes(i)) { laidNow.push(i); this.view.setAnim(r.id, { kerbs: [...laidNow] }); }
        const f = (u * 2) % 1, sw = f < 0.6 ? Math.sin(f / 0.6 * Math.PI / 2) : Math.cos((f - 0.6) / 0.4 * Math.PI / 2);
        gear.malletSwing = sw * 0.75; gear.set('mallet', new THREE.Vector3(cx, r.g + MM(PATH.kerbUp), cz), 0, u === 0);
        if (Math.floor(u * 2) !== job['_k' + i]) { job['_k' + i] = Math.floor(u * 2); app.sfx?.stab?.(); }
      }]);
    }
    steps.push([0.05, () => gear.set(null)]);
    new FitJob(app, {
      steps, parts: [],
      onAbort: () => { app.journal.cancel(); this.view.setAnim(r.id, null); gear.set(null); },
      commit: () => {
        const cur = app.objects.get(r.id), kerbs = [...new Set([...(cur.kerbs || []), ...list])].sort((a, b) => a - b), all = kerbs.length >= K.length;
        app.objects.update(r.id, { kerbs, ...(all ? { done: { ...(cur.done || {}), kerb: 1 } } : {}) });
        if (all) this._backfill(cur);
        app.journal.commit(app.clock);
        this.view.setAnim(r.id, null);
        this.toast(EN() ? `${list.length > 1 ? `${list.length} kerbs` : 'A kerb'} set on concrete, a quarter of it out of the ground (${PATH.kerbUp} mm); ${kerbs.length} of ${K.length}${all ? ' — all in, the soil put back behind them. Next «4 · Geotextile»' : ''}`
          : `${list.length > 1 ? `Бордюров уложено: ${list.length}` : 'Бордюр уложен'} на бетон, над землёй ${PATH.kerbUp} мм (четверть высоты); всего ${kerbs.length} из ${K.length}${all ? ' — все, за ними засыпан грунт. Дальше «4 · Геотекстиль»' : ''}`);
      },
    });
  }
  _backfill(r) {
    const t = this.app.terrain, all = this.land._cells(r, digQuads(r)), ko = kerbOuter(r);
    for (const c of all) { if (inQuads(ko, c[2], c[3])) continue; const h = t.hAt(c[0]); if (h < r.g) t._push(c[0], r.g - h, M_SOIL); }
    t._touch(...all.box);
  }

  // ---- the pavers: those round the finger laid, one after another (each drops into its place) ----
  _paveMove(p) {
    const d = this.drag, app = this.app, r = app.objects.get(d.id), all = paversOf(r), has = new Set(d.laid);
    const near = [];
    all.forEach((q, i) => { if (has.has(i)) return; const cx = q.p.reduce((s, v) => s + v[0], 0) / q.p.length, cz = q.p.reduce((s, v) => s + v[1], 0) / q.p.length; if (Math.hypot(cx - p.x, cz - p.z) < MM(380)) near.push([q.ord, i]); });
    near.sort((a, b) => a[0] - b[0]);
    for (const [, i] of near.slice(0, 8)) d.laid.push(i);
    if (near.length) { if (Math.random() < 0.5) app.sfx?.stab?.(); this.view.setAnim(r.id, { laid: d.laid.slice((r.laid || []).length), pave: d.laid.length }); }
    const A = d.laid.reduce((s, i) => s + (all[i]?.area || 0), 0) / 1e6, T = all.reduce((s, q) => s + q.area, 0) / 1e6;
    app.ui?.showMeasure?.(EN() ? `Laid ${f1(A)} of ${f1(T)} m²` : `Уложено ${f1(A)} из ${f1(T)} м²`);
  }

  status() {
    const L = this.L;
    if (L === 'set') return this.cord ? (EN() ? `Pull the string with your finger — a path ${f1(this.W / 1000)} m wide, corners ${this.roundOn ? 'rounded' : 'square'}` : `Тяните шнур пальцем — дорожка ${f1(this.W / 1000)} м, углы ${this.roundOn ? 'скруглённые' : 'прямые'}`) : 'Угловой колышек двигают пальцем; новая разметка — «Шнур» справа';
    return {
      dig: 'Коснитесь дорожки — корыто выкопают (или копайте лопатой: «Земля»)',
      kerb: 'Бордюр из лотка — к краю дорожки, отпустите; «Ряд» — ведите вдоль края',
      geo: 'Ведите пальцем вдоль корыта — рулон геотекстиля раскатывается',
      grav: 'Коснитесь дорожки — щебень насыплют и утрамбуют (или сами: «Материалы» → щебень, грабли, виброплита)',
      sand: 'Коснитесь дорожки — песок насыплют и выровняют (или сами из «Материалов»)',
      pave: 'Ведите пальцем по дорожке — плитка ложится, швы заметаются песком',
    }[L];
  }
}

function merge(list) {
  const s = list.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort((x, y) => x[0] - y[0]), out = [];
  for (const q of s) { if (out.length && q[0] <= out.at(-1)[1] + 50) out.at(-1)[1] = Math.max(out.at(-1)[1], q[1]); else out.push([...q]); }
  return out;
}
const polyLen = (p) => { let m = 0; for (let i = 0; i < p.length; i++) for (let k = i + 1; k < p.length; k++) m = Math.max(m, Math.hypot(p[i][0] - p[k][0], p[i][1] - p[k][1])); return m / S; };
// the ghost of kerbs: their bodies (green), standing where they will
function kerbGhost(r, K) {
  const G = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0x35d06a, transparent: true, opacity: 0.55, depthWrite: false });
  const yT = r.g + MM(PATH.kerbUp), yB = r.g - MM(PATH.kerbH - PATH.kerbUp);
  for (const k of K) {
    const sh = new THREE.Shape(k.p.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: yT - yB, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, yB, 0);
    const o = new THREE.Mesh(g, m); o.renderOrder = 6; G.add(o);
  }
  G.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
  return G;
}
void ease;
