import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { beltContains, toFrame } from './belt.js';
import { isSlab } from './slab.js';
import { ROOF, ROOF_LAYERS, roofArea, cellsOf, coverage, done, drainOf, parapetLines, upgrade, COP_COLOURS } from '../world/roof.js';

// The flat roof laid by hand (roof.js): the rolls (the vapour barrier, the membrane) are
// rolled out by dragging a finger over the slab; the boards (XPS, the wedges) and the
// coping are carried from the tray and laid one by one, cut where they meet the parapet;
// the gravel is spread by the finger.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
const ROLLS = { vap: [ROOF.vapW, ROOF.vapLap], mem: [ROOF.memW, ROOF.memLap] };
const BOARDS = { xps: [ROOF.xpsL, ROOF.xpsW, true], wedge: [ROOF.wedgeL, ROOF.wedgeL, false] };
const UNDER = { xps: 'vap', wedge: 'xps', mem: 'wedge' };
const NAME = Object.fromEntries(ROOF_LAYERS);
const r6 = (v) => +v.toFixed(6);

export class RoofWork {
  constructor(app) { this.app = app; this.drag = null; }
  get layer() { return this.app.settings.roofLayer || 'vap'; }
  get isRoll() { return !!ROLLS[this.layer]; }
  get isCarry() { return !!BOARDS[this.layer] || this.layer === 'cop'; }

  // the cast slab under p (the top one), its roof record (upgraded) and area
  _slab(p) {
    const app = this.app, sl = app.objects.all('belt').filter((b) => isSlab(b) && b.fill > 0.9 && beltContains(b, p.x, p.z) && p.y > b.top + b.H - MM(80)).sort((a, b) => b.top - a.top)[0];
    if (!sl) return null;
    const units = app.objects.all('unit'), area = roofArea(sl, units);
    const rec = app.objects.all('roof').find((r) => r.slab === sl.id);
    return { b: sl, area, rec: rec ? upgrade(rec, sl, area) : { slab: sl.id, vap: [], xps: [], wedge: [], memS: [], copS: [], grav: [] }, id: rec?.id, units };
  }
  // the finger on the roof's plane (at the height of what is laid there)
  _plane(e, y) {
    if (!e || e.clientX === undefined) return null;
    _ray.setFromCamera(this.app.gestures.ndc(e.clientX, e.clientY), this.app.camera);
    return _ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  }
  _save(R, patch, label) {
    const app = this.app, rec = { ...R.rec, ...patch };
    delete rec.stage; delete rec.look; delete rec.id;
    app.journal.act(label, {}, app.clock, () => { if (R.id) app.objects.update(R.id, rec); else app.objects.add({ type: 'roof', ...rec }); });
  }
  _live(R, live) { const v = this.app.wallView; v.liveRoof = R && live ? { slab: R.b.id, ...live } : null; v.roofDirty = true; }

  // ---- the rolls and the gravel: the finger on the slab ----
  down(p, e) {
    const app = this.app, L = this.layer;
    if (this.isCarry) { app.ui.toast(`${NAME[L]}: тяните из лотка справа на кровлю`); return true; }
    const R = this._slab(p);
    if (!R) { app.ui.toast('Кровля — на залитое перекрытие (внутри парапета)'); return true; }
    if (!R.area.n) { app.ui.toast('На перекрытии нет места под кровлю'); return true; }
    if (L === 'mem' && !done(R.b, R.area, R.rec.wedge).full && !R.rec.wedge.length) { app.ui.toast('Мембрана — по клиновидному слою: сначала «Клин 2 %»'); return true; }
    if (L === 'grav' && !done(R.b, R.area, R.rec.memS).full) { app.ui.toast('Гравий — на готовую мембрану'); return true; }
    const y = R.b.top + R.b.H + MM(L === 'vap' ? 1 : 200);
    const q = this._plane(e, y) || p, [s, t] = toFrame(R.b, q.x, q.z);
    this.drag = { R, y, s0: s, t0: t, s, t, cells: new Set() };
    if (L === 'grav') this._paint(s, t);
    return true;
  }
  move(p, e) {
    const d = this.drag;
    if (!d) return;
    const q = this._plane(e, d.y) || p, [s, t] = toFrame(d.R.b, q.x, q.z);
    d.s = s; d.t = t;
    if (this.layer === 'grav') { this._paint(s, t); this._live(d.R, { layer: 'grav', cells: [...d.cells] }); return; }
    d.rect = this._strip(d);
    this._live(d.R, d.rect ? { layer: this.layer, rect: d.rect, roll: { along: d.alongS, end: d.end, w: ROLLS[this.layer][0] } } : null);
    if (d.rect) this.app.ui.showMeasure(`${NAME[this.layer]}: полоса ${((d.alongS ? d.rect[2] - d.rect[0] : d.rect[3] - d.rect[1]) / S / 1000).toFixed(2)} × ${((d.alongS ? d.rect[3] - d.rect[1] : d.rect[2] - d.rect[0]) / S / 1000).toFixed(2)} м`.replace(/\./g, ','));
  }
  up() {
    const d = this.drag, app = this.app, L = this.layer;
    this.drag = null; this._live(null); app.ui.hideMeasure();
    if (!d) return;
    if (L === 'grav') {
      if (!d.cells.size) return;
      const old = d.R.rec.grav === 'all' ? [] : d.R.rec.grav || [];
      this._save(d.R, { grav: [...new Set([...old, ...d.cells])] }, 'roof-gravel');
      app.ui.toast('Рассыпали гравий — ведите дальше, пока не закроете мембрану');
      return;
    }
    const rc = d.rect;
    if (!rc) { app.ui.toast(`${NAME[L]}: проведите пальцем вдоль кровли — рулон раскатится за ним`); return; }
    const key = L === 'vap' ? 'vap' : 'memS';
    const patch = { [key]: [...(d.R.rec[key] || []), rc] };
    if (L === 'mem') patch.mem = app.settings.roofMem || 'grey';
    this._save(d.R, patch, L === 'vap' ? 'roof-vap' : 'roof-mem');
    const left = done(d.R.b, d.R.area, patch[key]);
    app.ui.toast(left.full ? (L === 'vap' ? 'Пароизоляция уложена по всей плите — дальше утеплитель (листы из лотка)' : 'Мембрана закрыла кровлю: заведена на парапет, швы сварены, воронка на месте — дальше отлив') : `${NAME[L]}: полоса уложена внахлёст ${ROLLS[L][1]} мм — осталось ${Math.round(left.left / left.of * 100)} % площади`);
  }
  // the strip being rolled out: along the drag, the roll's width across it, snapped to the
  // parapet / to the strip beside it with its overlap, cut where the roof ends
  _strip(d) {
    const L = this.layer, [W0, lap] = ROLLS[L], W = MM(W0), b = d.R.b, c = b.c, [i0, j0, i1, j1] = d.R.area.bbox, bb = [i0 * c, j0 * c, i1 * c, j1 * c];
    const ds = d.s - d.s0, dt = d.t - d.t0;
    if (Math.hypot(ds, dt) < MM(150)) return null;
    if (d.alongS == null) d.alongS = Math.abs(ds) >= Math.abs(dt);
    const A = d.alongS, lo = A ? bb[1] : bb[0], hi = A ? bb[3] : bb[2], amin = A ? bb[0] : bb[1], amax = A ? bb[2] : bb[3];
    // across: the finger's side of the strip, snapped
    const acr = A ? d.t0 : d.s0, snap = MM(450);
    let c0 = acr - W / 2;
    const prev = (d.R.rec[L === 'vap' ? 'vap' : 'memS'] || []).filter((r) => (r[2] - r[0] > r[3] - r[1]) === A);
    if (Math.abs(acr - lo) < W) c0 = lo;
    else if (Math.abs(acr - hi) < W) c0 = hi - W;
    for (const r of prev) {
      const e0 = A ? r[1] : r[0], e1 = A ? r[3] : r[2];
      if (Math.abs(c0 - (e1 - MM(lap))) < snap) c0 = e1 - MM(lap);
      else if (Math.abs(c0 + W - (e0 + MM(lap))) < snap) c0 = e0 + MM(lap) - W;
    }
    let c1 = c0 + W;
    c0 = Math.max(c0, lo); c1 = Math.min(c1, hi);   // (cut along at the parapet)
    // along: from the start to the finger, snapped to the parapet, cut there
    let a0 = Math.min(A ? d.s0 : d.t0, A ? d.s : d.t), a1 = Math.max(A ? d.s0 : d.t0, A ? d.s : d.t);
    if (a0 - amin < snap) a0 = amin;
    if (amax - a1 < snap) a1 = amax;
    a0 = Math.max(a0, amin); a1 = Math.min(a1, amax);
    if (a1 - a0 < MM(150) || c1 - c0 < MM(100)) return null;
    d.end = (A ? d.s : d.t) > (A ? d.s0 : d.t0) ? a1 : a0;
    return (A ? [a0, c0, a1, c1] : [c0, a0, c1, a1]).map(r6);
  }
  _paint(s, t) {
    const d = this.drag, b = d.R.b, rad = MM(600), mem = coverage(b, d.R.rec.memS);
    for (const [i, j] of cellsOf(b, [s - rad, t - rad, s + rad, t + rad])) {
      const k = j * b.ni + i;
      if (d.R.area.on(i, j) && mem[k] && Math.hypot((i + 0.5) * b.c - s, (j + 0.5) * b.c - t) < rad) d.cells.add(k);
    }
  }

  // ---- the boards and the coping: carried from the tray ----
  carryMove(p, e) {
    const L = this.layer, R = this._slab(p);
    this.place = null;
    if (!R) { this._live(null); return null; }
    if (L === 'cop') return this._coping(R, p);
    const y = R.b.top + R.b.H + MM(L === 'xps' ? 1 : 151);
    const q = this._plane(e, y) || p, [s, t] = toFrame(R.b, q.x, q.z);
    const [BL, BW, stagger] = BOARDS[L], b = R.b, c = b.c, [i0, j0, i1, j1] = R.area.bbox, s0b = i0 * c, t0b = j0 * c;
    // the slot of the course under the finger (staggered by half a board)
    const row = Math.floor((t - t0b) / MM(BW)), off = stagger && row % 2 ? MM(BL / 2) : 0, col = Math.floor((s - s0b + off) / MM(BL));
    const os = s0b - off + col * MM(BL), ot = t0b + row * MM(BW);
    let rc = [os, ot, os + MM(BL), ot + MM(BW)];
    rc = [Math.max(rc[0], i0 * c), Math.max(rc[1], j0 * c), Math.min(rc[2], i1 * c), Math.min(rc[3], j1 * c)];
    // cut to the roof: the run of whole columns / rows round the finger
    const ci = Math.min(Math.max(Math.floor(s / c), Math.ceil(rc[0] / c - 1e-6)), Math.floor(rc[2] / c - 1e-6)), cj = Math.min(Math.max(Math.floor(t / c), Math.ceil(rc[1] / c - 1e-6)), Math.floor(rc[3] / c - 1e-6));
    const I0 = Math.round(rc[0] / c), I1 = Math.round(rc[2] / c), J0 = Math.round(rc[1] / c), J1 = Math.round(rc[3] / c);
    // free: on the roof and not laid yet in this layer (a gap left round an opening is filled by a piece cut to it)
    const mineM = coverage(b, R.rec[L]), free = (i, j) => R.area.on(i, j) && !mineM[j * b.ni + i];
    const colOk = (i, p0, p1) => { for (let j = p0; j < p1; j++) if (!free(i, j)) return false; return true; };
    const rowOk = (j, p0, p1) => { for (let i = p0; i < p1; i++) if (!free(i, j)) return false; return true; };
    if (!free(ci, cj)) { this._live(R, null); return { ok: false, why: R.area.on(ci, cj) ? 'Это место уже закрыто' : 'Здесь места под лист нет' }; }
    // grown from the finger's cell as far as the board and the free space go (the longer way first)
    let a = ci, z = ci + 1, u = cj, w = cj + 1, grown = true;
    while (grown) {
      grown = false;
      if (a > I0 && colOk(a - 1, u, w)) { a--; grown = true; }
      if (z < I1 && colOk(z, u, w)) { z++; grown = true; }
      if (u > J0 && rowOk(u - 1, a, z)) { u--; grown = true; }
      if (w < J1 && rowOk(w, a, z)) { w++; grown = true; }
    }
    rc = [a * c, u * c, z * c, w * c].map(r6);
    const cut = Math.abs((rc[2] - rc[0]) - MM(BL)) > MM(5) || Math.abs((rc[3] - rc[1]) - MM(BW)) > MM(5);
    const cells = cellsOf(b, rc), mine = coverage(b, R.rec[L]), under = coverage(b, R.rec[UNDER[L]]);
    let why = null;
    if (cells.some(([i, j]) => mine[j * b.ni + i])) why = 'Это место уже закрыто';
    else if (cells.some(([i, j]) => !under[j * b.ni + i])) why = L === 'xps' ? 'Утеплитель — на пароизоляцию: сначала раскатайте плёнку' : 'Клин — на утеплитель: сначала листы XPS';
    const piece = [...rc, r6(os), r6(ot)];
    this.place = { R, piece, why, cut, size: [Math.round((rc[2] - rc[0]) / S), Math.round((rc[3] - rc[1]) / S)] };
    this._live(R, { layer: L, rect: piece });
    return { ok: !why, why, cut };
  }
  _coping(R, p) {
    const lines = parapetLines(R.b, R.units);
    let best = null, bd = Infinity;
    for (const l of lines) {
      const a = p.x * l.ux + p.z * l.uz, off = Math.abs(-p.x * l.uz + p.z * l.ux - l.d);
      if (off > l.w / 2 + MM(250) || Math.abs(p.y - l.y) > MM(400) || a < l.a0 - MM(200) || a > l.a1 + MM(200)) continue;
      if (off < bd) { bd = off; best = { l, a: Math.max(l.a0, Math.min(l.a1, a)) }; }
    }
    if (!best) { this._live(R, null); return { ok: false, why: 'Отлив — на верх парапета' }; }
    const { l, a } = best;
    // what of this line is covered already
    const segs = (R.rec.copS === 'all' ? [] : R.rec.copS || [])
      .filter(([x0, z0, x1, z1]) => { const L2 = Math.hypot(x1 - x0, z1 - z0) || 1; return Math.abs(((x1 - x0) * l.uz - (z1 - z0) * l.ux) / L2) < 0.05 && Math.abs(-((x0 + x1) / 2) * l.uz + ((z0 + z1) / 2) * l.ux - l.d) < l.w; })   // (only the pieces on this line)
      .map(([x0, z0, x1, z1]) => [x0 * l.ux + z0 * l.uz, x1 * l.ux + z1 * l.uz].sort((p2, q) => p2 - q));
    const covered = (v) => segs.some(([s0, s1]) => v > s0 + MM(5) && v < s1 - MM(5));
    if (covered(a)) { this._live(R, null); return { ok: false, why: 'Здесь отлив уже стоит' }; }
    // the gap round the finger; the piece from its start in 2 m steps, cut at its end
    let g0 = l.a0, g1 = l.a1;
    for (const [s0, s1] of segs) { if (s1 <= a + MM(5) && s1 > g0) g0 = s1; if (s0 >= a - MM(5) && s0 < g1) g1 = s0; }
    const P = MM(ROOF.copL), k = Math.floor((a - g0) / P), p0 = g0 + k * P, p1 = Math.min(g1, p0 + P);
    const W = (v) => [l.ux * v - l.uz * l.d, l.uz * v + l.ux * l.d];
    const seg = [...W(p0), ...W(p1), r6(l.y), r6(l.w)].map(r6);
    const memDone = done(R.b, R.area, R.rec.memS).full;
    const why = memDone ? null : 'Отлив ставят, когда мембрана заведена на парапет: сначала закройте кровлю мембраной';
    this.place = { R, seg, why, cut: p1 - p0 < P - MM(5), size: [Math.round((p1 - p0) / S)] };
    this._live(R, { layer: 'cop', seg });
    return { ok: !why, why, cut: this.place.cut };
  }
  carryDrop() {
    const app = this.app, P = this.place, L = this.layer;
    this.place = null; this._live(null);
    if (!P) { app.ui.toast(L === 'cop' ? 'Отлив — на верх парапета' : `${NAME[L]} — на кровлю (на залитое перекрытие)`); return; }
    if (P.why) { app.ui.toast(P.why); return; }
    if (L === 'cop') {
      const old = P.R.rec.copS === 'all' ? [] : P.R.rec.copS || [];
      this._save(P.R, { copS: [...old, P.seg], cop: app.settings.roofCop || 'zinc' }, 'roof-coping');
      app.ui.toast(`Отлив ${P.size[0]} мм${P.cut ? ' (подрезан по месту)' : ''} — «${COP_COLOURS[app.settings.roofCop || 'zinc'][0]}»`);
      return;
    }
    const patch = { [L]: [...(P.R.rec[L] || []), P.piece] };
    if (L === 'wedge' && !P.R.rec.drain) patch.drain = drainOf(P.R.b, P.R.area);
    this._save(P.R, patch, L === 'xps' ? 'roof-xps' : 'roof-wedge');
    const left = done(P.R.b, P.R.area, patch[L]);
    app.ui.toast(`${L === 'xps' ? 'Лист XPS' : 'Клиновидная плита'} ${P.size[0]} × ${P.size[1]} мм${P.cut ? ' — подрезан по месту' : ''}; ${left.full ? 'слой закрыт' : `осталось ${Math.round(left.left / left.of * 100)} %`}`);
  }
  status(carry) {
    const L = this.layer;
    if (carry) {
      const P = this.place;
      if (!P) return L === 'cop' ? 'Поднесите отлив к верху парапета' : `Поднесите ${L === 'xps' ? 'лист XPS' : 'клиновидную плиту'} к кровле`;
      if (P.why) return 'Красный — ' + P.why;
      return L === 'cop' ? `Отлив ${P.size[0]} мм${P.cut ? ' (подрежется)' : ''} — отпустите` : `${L === 'xps' ? 'Лист' : 'Плита'} ${P.size[0]} × ${P.size[1]} мм${P.cut ? ' — подрежется по месту' : ''} — отпустите`;
    }
    return {
      vap: 'Пароизоляция: проведите пальцем по перекрытию — рулон 1,5 м раскатается за пальцем; следующая полоса ляжет внахлёст 100 мм, у парапета подрежется',
      xps: 'Утеплитель XPS 1200 × 600 × 150: тяните лист из лотка на кровлю — ложится вразбежку, у парапета подрезается',
      wedge: 'Клин 2 %: тяните плиту из лотка — толщина по месту, уклон к воронке в середине',
      mem: 'Мембрана: проведите пальцем — рулон 2,05 м раскатается, нахлёст 80 мм сваривается; когда закроете кровлю — заведётся на парапет, встанет воронка',
      cop: 'Отлив: тяните из лотка на верх парапета — куски по 2 м, на углах и в конце подрезаются',
      grav: 'Гравий: ведите пальцем по готовой мембране — рассыпается слой 50 мм',
    }[L];
  }
  // «Удалить» on the roof: the last piece of its top layer comes off
  remove(id) {
    const app = this.app, r0 = app.objects.get(id), b = r0 && app.objects.get(r0.slab);
    if (!b) return;
    const r = upgrade(r0, b, roofArea(b, app.objects.all('unit')));
    for (const [k, nm] of [['grav', 'гравий'], ['copS', 'отлив'], ['memS', 'полосу мембраны'], ['wedge', 'клиновидную плиту'], ['xps', 'лист XPS'], ['vap', 'полосу пароизоляции']]) {
      const v = r[k];
      if (!v || (Array.isArray(v) && !v.length)) continue;
      const patch = { ...r, [k]: v === 'all' ? [] : k === 'grav' ? [] : v.slice(0, -1) };
      delete patch.stage; delete patch.look; delete patch.id;
      const empty = ['vap', 'xps', 'wedge', 'memS', 'copS', 'grav'].every((q) => !patch[q] || !patch[q].length);
      app.journal.act('roof-remove', {}, app.clock, () => { if (empty) app.objects.remove(id); else app.objects.update(id, patch); });
      app.ui.toast(`Сняли ${nm}`);
      return;
    }
  }
}
