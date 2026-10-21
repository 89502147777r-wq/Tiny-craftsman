import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf } from './freeBrick.js';
import { wingShape, roofTop, planeAt, STAGES, FINGER, PITCHED, PITCHES, ROOF_TYPES, COVERS, COVER_COLOURS, RWIN } from '../world/pitched.js';

// The pitched roof laid by hand (pitched.js):
//   plate – carried from the tray onto the top of the walls: the house is found (its plan
//           from the masonry, cut into rectangles — the wings), the wall plate goes on all
//           round it and the masonry the roof needs (the gables, the high wall of a
//           mono-pitch roof),
//   frame, memb, battens, cover – the finger drawn along a wing of the roof: the rafters /
//           the membrane / the battens / the sheets go on where it passes (a rafter every
//           600, a sheet every 1180 / 500, …), only over what the stage before has done,
//   trim  – carried from the tray onto the roof: the ridge, the hips, the fascia, the verges.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
const NAME = Object.fromEntries(STAGES);
const STEP = { frame: PITCHED.step, memb: 1000, battens: PITCHED.step };
const PREV = { frame: 'plate', memb: 'frame', battens: 'memb', cover: 'battens', trim: 'cover', gutter: 'trim' };

// the house under the roof: the plan of the masonry in a grid along its walls, filled in,
// cut into rectangles → the wings; the top of the walls (or of the ring beam on them)
export function findHouse(app) {
  const units = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop' && !u.lintel).map(boxOf);
  if (units.length < 8) return null;
  // the way the walls run: the most common direction (mod 90°)
  const bins = new Map();
  for (const b of units) { const k = Math.round((((b.yaw % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) * 40); bins.set(k, (bins.get(k) || 0) + b.hl); }
  const yaw = [...bins].sort((p, q) => q[1] - p[1])[0][0] / 40, ux = Math.cos(yaw), uz = -Math.sin(yaw);
  const C = MM(100), toA = (x, z) => x * ux + z * uz, toD = (x, z) => -x * uz + z * ux;
  let a0 = Infinity, a1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (const b of units) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = b.x + b.ux * b.hl * sx - b.uz * b.hw * sz, z = b.z + b.uz * b.hl * sx + b.ux * b.hw * sz;
    a0 = Math.min(a0, toA(x, z)); a1 = Math.max(a1, toA(x, z)); d0 = Math.min(d0, toD(x, z)); d1 = Math.max(d1, toD(x, z));
  }
  const ni = Math.ceil((a1 - a0) / C) + 2, nj = Math.ceil((d1 - d0) / C) + 2, grid = new Uint8Array(ni * nj);
  a0 -= C; d0 -= C;
  // the walls on the grid (the cell's middle in a unit)
  for (const b of units) {
    const r = Math.hypot(b.hl, b.hw), ca = toA(b.x, b.z), cd = toD(b.x, b.z);
    for (let i = Math.floor((ca - r - a0) / C); i <= Math.ceil((ca + r - a0) / C); i++) for (let j = Math.floor((cd - r - d0) / C); j <= Math.ceil((cd + r - d0) / C); j++) {
      if (i < 0 || j < 0 || i >= ni || j >= nj) continue;
      const pa = a0 + (i + 0.5) * C, pd = d0 + (j + 0.5) * C, x = pa * ux - pd * uz, z = pa * uz + pd * ux;
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx * b.ux + dz * b.uz) <= b.hl + C * 0.5 && Math.abs(-dx * b.uz + dz * b.ux) <= b.hw + C * 0.5) grid[j * ni + i] = 1;
    }
  }
  // filled in: what the outside cannot reach
  const out = new Uint8Array(ni * nj), st = [];
  for (let i = 0; i < ni; i++) st.push([i, 0], [i, nj - 1]); for (let j = 0; j < nj; j++) st.push([0, j], [ni - 1, j]);
  while (st.length) { const [i, j] = st.pop(); if (i < 0 || j < 0 || i >= ni || j >= nj) continue; const k = j * ni + i; if (out[k] || grid[k]) continue; out[k] = 1; st.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]); }
  const fill = new Uint8Array(ni * nj); for (let k = 0; k < fill.length; k++) fill[k] = out[k] ? 0 : 1;
  // the rectangles: the largest first (histograms), down to 2 × 2 m
  const rects = [], left = fill.slice(), minC = Math.round(2000 / 100);
  for (let guard = 0; guard < 5; guard++) {
    const h = new Int32Array(ni); let best = null;
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) h[i] = left[j * ni + i] ? h[i] + 1 : 0;
      for (let i = 0; i < ni; i++) {
        if (!h[i]) continue;
        let hm = h[i];
        for (let k = i; k < ni && h[k]; k++) { hm = Math.min(hm, h[k]); const w = k - i + 1, ar = w * hm; if (w >= minC && hm >= minC && (!best || ar > best.ar)) best = { ar, i0: i, i1: k + 1, j0: j - hm + 1, j1: j + 1 }; }
      }
    }
    if (!best || (rects.length && best.ar < rects[0].ar * 0.12)) break;
    rects.push(best);
    for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) left[j * ni + i] = 0;
  }
  if (!rects.length) return null;
  // the wings: the ridge along the longer side; an end touching another rectangle joins it
  const wings = rects.map((r) => {
    const ra = [a0 + r.i0 * C, a0 + r.i1 * C], rd = [d0 + r.j0 * C, d0 + r.j1 * C], along = ra[1] - ra[0] >= rd[1] - rd[0];
    const ca = (ra[0] + ra[1]) / 2, cd = (rd[0] + rd[1]) / 2;
    return { r, ra, rd, cx: ca * ux - cd * uz, cz: ca * uz + cd * ux, ux: along ? ux : -uz, uz: along ? uz : ux, A: (along ? ra[1] - ra[0] : rd[1] - rd[0]) / 2, B: (along ? rd[1] - rd[0] : ra[1] - ra[0]) / 2, along };
  });
  for (const w of wings) {
    w.e = ['end', 'end']; w.x = [0, 0];
    for (const [k, sg] of [[0, -1], [1, 1]]) {
      // the strip just past this end, across the wing's width: in another rectangle?
      for (const o of wings) {
        if (o === w) continue;
        const touch = w.along
          ? (Math.abs((sg > 0 ? w.ra[1] : w.ra[0]) - (sg > 0 ? o.ra[0] : o.ra[1])) < C * 0.6 && o.rd[0] < w.rd[1] - C && o.rd[1] > w.rd[0] + C)
          : (Math.abs((sg > 0 ? w.rd[1] : w.rd[0]) - (sg > 0 ? o.rd[0] : o.rd[1])) < C * 0.6 && o.ra[0] < w.ra[1] - C && o.ra[1] > w.ra[0] + C);
        if (!touch) continue;
        // runs on into it to its ridge (its middle across)
        const oc = o.along ? (o.rd[0] + o.rd[1]) / 2 : (o.ra[0] + o.ra[1]) / 2, oHalf = o.B;
        w.e[k] = 'join'; w.x[k] = Math.min(oHalf, Math.abs((w.along ? (o.ra[0] + o.ra[1]) / 2 : (o.rd[0] + o.rd[1]) / 2) - (w.along ? (sg > 0 ? w.ra[1] : w.ra[0]) : (sg > 0 ? w.rd[1] : w.rd[0])))) || oHalf;
        void oc;
      }
    }
  }
  // the top: the walls, or a ring beam cast on them
  let y0 = Math.max(...units.map((b) => b.top));
  for (const b of app.objects.all('belt')) if (b.fill > 0.5 && b.top + b.H > y0 - MM(50) && b.top + b.H < y0 + MM(400)) y0 = Math.max(y0, b.top + b.H);
  const T = [...units.map((b) => 2 * Math.min(b.hw, b.hl))].sort((p, q) => p - q)[Math.floor(units.length / 2)];
  const g = Math.min(...units.map((b) => b.bot)) - MM(20);
  return { y0: +y0.toFixed(6), T: +T.toFixed(6), g: +g.toFixed(6), wings: wings.map((w) => ({ cx: +w.cx.toFixed(6), cz: +w.cz.toFixed(6), ux: +w.ux.toFixed(6), uz: +w.uz.toFixed(6), A: +w.A.toFixed(6), B: +w.B.toFixed(6), e: w.e, x: w.x.map((v) => +v.toFixed(6)) })) };
}

export class PitchedWork {
  constructor(app) { this.app = app; this.drag = null; this.place = null; }
  get stage() { return this.app.settings.proofStage || 'plate'; }
  get isCarry() { return !FINGER.has(this.stage); }
  get rec() { return this.app.objects.all('proof')[0] || null; }
  // the wing the type / the pitch / the slope go to (−1: all of them)
  get wing() { const r = this.rec, k = this.app.settings.proofWing ?? -1; return r && k >= 0 && k < r.wings.length ? k : -1; }
  opts() {
    const s = this.app.settings, r = this.rec, w = this.wing >= 0 ? r.wings[this.wing] : null;
    const type = w?.style || (r ? r.style : s.proofType) || s.proofType || 'gable', kind = s.proofCover || 'metal';
    const p0 = w?.pitch || (r ? r.pitch : s.proofPitch) || s.proofPitch;
    const pitch = PITCHES[type].includes(p0) ? p0 : PITCHES[type][type === 'mono' ? 1 : 2];
    const col = COVER_COLOURS[kind][s.proofCol] ? s.proofCol : Object.keys(COVER_COLOURS[kind])[0];
    return { style: type, pitch, cover: { kind, col }, md: w?.md || 0 };
  }
  _ends(wings) { return wings; }
  _live(live) { const v = this.app.wallView; v.liveProof = live; v.proofDirty = true; }
  _save(patch, label) {
    const app = this.app, r = this.rec;
    app.journal.act(label, {}, app.clock, () => { if (r) app.objects.update(r.id, { ...patch }); else app.objects.add({ type: 'proof', ...patch }); });
  }
  // the settings changed (o: what changed): the roof follows while it can — the type, the pitch,
  // the slope of a wing till its rafters are up; the covering till it is laid
  applyOpts(o = {}) {
    const r = this.rec; if (!r) return;
    const k = this.wing, framed = (wi) => r.done?.frame === true || (r.done?.frame || []).some((q) => q[0] === wi);
    const patch = {};
    if (o.style || o.pitch || o.md != null) {
      const list = k >= 0 ? [k] : r.wings.map((_, i) => i), blocked = list.filter(framed);
      if (blocked.length) { this.app.ui.toast('На этом крыле уже стоят стропила — тип и уклон не меняются (снимите стропила «Удалить»)'); }
      else {
        const wings = r.wings.map((w, i) => {
          if (!list.includes(i)) return w;
          const nw = { ...w };
          if (o.style) { if (k >= 0) nw.style = o.style; else delete nw.style; delete nw.pitch; }
          if (o.pitch) { if (k >= 0) nw.pitch = o.pitch; else delete nw.pitch; }
          if (o.md != null) nw.md = o.md;
          return nw;
        });
        patch.wings = wings;
        if (k < 0) { if (o.style) patch.style = o.style; if (o.pitch) patch.pitch = o.pitch; if (o.style && !o.pitch) patch.pitch = PITCHES[o.style][o.style === 'mono' ? 1 : 2]; }
        else if (o.style && !o.pitch) patch.wings[k].pitch = PITCHES[o.style][o.style === 'mono' ? 1 : 2];
      }
    }
    if (o.cover) { if (r.done?.cover) this.app.ui.toast('Покрытие уже уложено — цвет не меняется'); else patch.cover = this.opts().cover; }
    if (Object.keys(patch).length) this._save(patch, 'proof-opts');
  }
  // the slope of a mono-pitch wing: which way it rises (round the four sides)
  turnSlope() { const r = this.rec; if (!r) return; const k = this.wing, w = r.wings[k >= 0 ? k : 0]; this.applyOpts({ md: ((w.md || 0) + 1) % 4 }); }

  // ---- the finger on the roof: the point of its surface (the top of the rafters) under it ----
  _hit(e) {
    const r = this.rec; if (!r || !e || e.clientX === undefined) return null;
    _ray.setFromCamera(this.app.gestures.ndc(e.clientX, e.clientY), this.app.camera);
    const shapes = r.wings.map((w) => wingShape(r, w)), o = _ray.ray.origin, d = _ray.ray.direction;
    const above = (t) => { const x = o.x + d.x * t, z = o.z + d.z * t, h = roofTop(r, shapes, x, z); return !isFinite(h) || o.y + d.y * t > h; };
    let t0 = 0, t1 = null;
    for (let t = 0.01; t < 6; t += 0.004) if (!above(t)) { t1 = t; t0 = t - 0.004; break; }
    if (t1 == null) return null;
    for (let k = 0; k < 20; k++) { const m = (t0 + t1) / 2; if (above(m)) t0 = m; else t1 = m; }
    const x = o.x + d.x * t1, z = o.z + d.z * t1;
    let wi = -1, best = -Infinity;
    shapes.forEach((f, i) => { const [a, dd] = f.L(x, z); if (f.inside(a, dd) && f.top(a, dd) > best) { best = f.top(a, dd); wi = i; } });
    if (wi < 0) return null;
    const [a, dd] = shapes[wi].L(x, z);
    return { wi, a, d: dd, f: shapes[wi] };
  }
  down(p, e) {
    const app = this.app, L = this.stage, r = this.rec;
    if (this.isCarry) { app.ui.toast(`${NAME[L]}: тяните из лотка справа на ${L === 'plate' ? 'верх стен' : 'крышу'}`); return true; }
    if (!r) { app.ui.toast('Сначала мауэрлат: тяните его из лотка на верх стен — крыша встанет по дому'); return true; }
    if (!r.done?.[PREV[L]]) { app.ui.toast(`${NAME[L]} — после этапа «${NAME[PREV[L]]}»`); return true; }
    const h = this._hit(e);
    if (!h) { app.ui.toast('Ведите пальцем по крыше вдоль конька'); return true; }
    this.drag = { wi: h.wi, a0: h.a, a1: h.a, f: h.f };
    this._show();
    return true;
  }
  move(p, e) {
    const d = this.drag; if (!d) return;
    const h = this._hit(e);
    if (!h) return;
    if (h.wi !== d.wi) { this._commit(); this.drag = { wi: h.wi, a0: h.a, a1: h.a, f: h.f }; }
    else { d.a0 = Math.min(d.a0, h.a); d.a1 = Math.max(d.a1, h.a); }
    this._show();
  }
  // the stretch done: rounded to whole rafters / sheets, cut to what the stage before did
  _span(d) {
    const L = this.stage, r = this.rec, f = d.f, k = MM(L === 'cover' ? PITCHED.sheet[r.cover?.kind || 'metal'] : STEP[L]);
    let a0 = f.lo + Math.floor((d.a0 - f.lo) / k) * k, a1 = f.lo + Math.ceil((Math.max(d.a1, d.a0 + 1e-6) - f.lo) / k) * k;
    if (a0 - f.lo < k * 1.2) a0 = f.lo; if (f.hi - a1 < k * 1.2) a1 = f.hi;   // (near the end: on to it)
    a0 = Math.max(f.lo, a0); a1 = Math.min(f.hi, a1);
    const prev = r.done?.[PREV[L]];
    if (prev !== true && Array.isArray(prev)) {
      const ps = prev.filter((s) => s[0] === d.wi);
      if (!ps.length) return null;
      a0 = Math.max(a0, Math.min(...ps.map((s) => s[1]))); a1 = Math.min(a1, Math.max(...ps.map((s) => s[2])));
    }
    return a1 - a0 > MM(50) ? [+a0.toFixed(6), +a1.toFixed(6)] : null;
  }
  _show() {
    const d = this.drag, sp = d && this._span(d);
    this._live(sp ? { stage: this.stage, w: d.wi, a0: sp[0], a1: sp[1] } : null);
    if (sp) this.app.ui.showMeasure(`${NAME[this.stage]}: ${((sp[1] - sp[0]) / S / 1000).toFixed(1).replace('.', ',')} м`);
  }
  _commit() {
    const d = this.drag, r = this.rec; if (!d || !r) return false;
    const sp = this._span(d); if (!sp) return false;
    const cur = r.done?.[this.stage];
    if (cur === true) return false;
    // merged with what is done on that wing
    const list = [...(cur || []), [d.wi, ...sp]], merged = [];
    for (const wi of [...new Set(list.map((s) => s[0]))]) {
      const iv = list.filter((s) => s[0] === wi).map((s) => [s[1], s[2]]).sort((p, q) => p[0] - q[0]);
      for (const v of iv) { const m = merged.filter((s) => s[0] === wi).at(-1); if (m && v[0] <= m[2] + MM(10)) m[2] = Math.max(m[2], v[1]); else merged.push([wi, v[0], v[1]]); }
    }
    this._save({ done: { ...r.done, [this.stage]: merged } }, 'proof-' + this.stage);
    return true;
  }
  up() {
    const app = this.app, d = this.drag, L = this.stage;
    if (!d) return;
    const ok = this._commit();
    this.drag = null; this._live(null); app.ui.hideMeasure();
    if (!ok) { app.ui.toast(`${NAME[L]}: ведите пальцем по крыше вдоль конька — там, где уже готов этап «${NAME[PREV[L]]}»`); return; }
    const r = this.rec, left = this.left(r, L);
    app.ui.toast({ frame: 'Стропила стоят', memb: 'Мембрана раскатана внахлёст', battens: 'Контробрешётка и обрешётка прибиты', cover: `${COVERS[r.cover.kind]} уложена` }[L] + (left > 0.02 ? ` — осталось ${Math.round(left * 100)} %` : ' — весь скат готов'));
  }
  // the share of the roof not done in a stage
  left(r, L) {
    const cur = r.done?.[L]; if (cur === true) return 0;
    const shapes = r.wings.map((w) => wingShape(r, w));
    let all = 0, got = 0;
    shapes.forEach((f, wi) => { all += f.hi - f.lo; for (const s of (cur || []).filter((q) => q[0] === wi)) got += s[2] - s[1]; });
    return Math.max(0, 1 - got / all);
  }

  // ---- the wall plate and the trims: from the tray ----
  carryMove(p, e) {
    const app = this.app, L = this.stage, r = this.rec;
    this.place = null;
    if (L === 'plate') {
      if (r?.done?.plate) { this._live(null); return { ok: false, why: 'Мауэрлат уже лежит' }; }
      const key = app.objects.all('unit').length + ':' + app.objects.all('belt').length;
      if (this._hk !== key) { this._hk = key; this._house = findHouse(app); }
      const H = this._house;
      if (!H) { this._live(null); return { ok: false, why: 'Нет дома: сначала стены (крыша встаёт на верх стен)' }; }
      // the finger on the top of the walls (near it)
      if (p && Math.abs(p.y - H.y0) > MM(1500)) { this._live(null); return { ok: false, why: 'Поднесите к верху стен' }; }
      const o = this.opts(), rec = { ...H, ...o, wings: this._ends(H.wings, o.style), done: { plate: true } };
      this.place = { rec };
      this._live({ ghost: rec });
      return { ok: true };
    }
    if (L === 'gutter') {
      if (!r?.done?.trim) { this._live(null); return { ok: false, why: 'Водосток — когда стоят лобовые доски (этап «Конёк и планки»)' }; }
      if (r.done.gutter) return { ok: false, why: 'Водосток уже висит' };
      this.place = { gutter: true }; this._live({ stage: 'gutter', all: true }); return { ok: true };
    }
    if (!r || !r.done?.cover) { this._live(null); return { ok: false, why: 'Конёк и планки — когда уложено покрытие' }; }
    if (r.done.trim) return { ok: false, why: 'Конёк и планки уже стоят' };
    this.place = { trim: true };
    this._live({ stage: 'trim', all: true });
    return { ok: true };
  }
  carryDrop() {
    const app = this.app, P = this.place;
    this.place = null; this._live(null);
    if (!P) { app.ui.toast(this.stage === 'plate' ? 'Мауэрлат — на верх стен' : 'Конёк и планки — на крышу с покрытием'); return; }
    if (P.rec) {
      this._save(P.rec, 'proof-plate');
      const n = P.rec.wings.length, t = ROOF_TYPES[P.rec.style].toLowerCase();
      app.ui.toast(`Мауэрлат 150×150 на шпильках по всему дому${P.rec.style !== 'hip' ? ', фронтоны из блоков' : ''} — крыша ${t}${n > 1 ? `, ${n} крыла с ендовами` : ''}, ${P.rec.pitch}°. Дальше — стропила пальцем вдоль конька`);
      return;
    }
    const r = this.rec;
    if (P.gutter) { this._save({ done: { ...r.done, gutter: true } }, 'proof-gutter'); app.ui.toast('Водосток: желоба на крюках под карнизами, трубы по углам до земли — в дождь из них течёт вода'); return; }
    this._save({ done: { ...r.done, trim: true } }, 'proof-trim');
    app.ui.toast('Конёк, рёбра, лобовая доска, ветровые планки и софиты — дальше водосток');
  }
  status(carry) {
    const L = this.stage, r = this.rec;
    if (carry) return this.place ? 'Отпустите' : (L === 'plate' ? 'Поднесите мауэрлат к верху стен' : L === 'gutter' ? 'Поднесите водосток к крыше' : 'Поднесите конёк к крыше');
    const left = r ? this.left(r, L) : 1;
    return {
      plate: r ? 'Мауэрлат лежит — дальше «Стропила»' : 'Скатная крыша: выберите тип, уклон и покрытие, потом тяните мауэрлат из лотка на верх стен — крыша встанет по дому (Г-, Т-образный — крыльями с ендовами)',
      frame: `Стропила: ведите пальцем по крыше вдоль конька — пары встают через 600 мм${left < 1 ? `; осталось ${Math.round(left * 100)} %` : ''}`,
      memb: 'Мембрана: ведите пальцем вдоль ската — рулон раскатывается внахлёст по стропилам',
      battens: 'Обрешётка: ведите пальцем — контробрешётка по стропилам и рейки поперёк (под мягкую черепицу — OSB)',
      cover: `${COVERS[r?.cover?.kind || 'metal']}: ведите пальцем вдоль ската — листы ложатся один за другим, на вальмах и у ендов подрезаются`,
      trim: 'Конёк и планки: тяните из лотка на крышу',
      gutter: 'Водосток: тяните из лотка на крышу — желоба по карнизам, трубы по углам',
    }[L];
  }
  // «Удалить» on the roof: the last stage's last stretch comes off
  remove(id) {
    const app = this.app, r = app.objects.get(id); if (!r) return;
    for (const [k, nm] of [...STAGES].reverse()) {
      const v = r.done?.[k]; if (!v) continue;
      if (k === 'plate') { app.journal.act('proof-remove', {}, app.clock, () => app.objects.remove(id)); app.ui.toast('Сняли мауэрлат — крыши нет'); return; }
      const nv = v === true || v.length <= 1 ? undefined : v.slice(0, -1), done = { ...r.done }; if (nv) done[k] = nv; else delete done[k];
      app.journal.act('proof-remove', {}, app.clock, () => app.objects.update(id, { done }));
      app.ui.toast(`Сняли: ${nm.toLowerCase()}`);
      return;
    }
  }
}

// The windows in the roof: carried from the tray onto a slope of the pitched roof (between the
// rafters, the covering cut round them) or onto a flat roof (on a kerb)
export class RoofWindowWork {
  constructor(app) { this.app = app; this.place = null; }
  get key() { return this.app.settings.rwinKey || 's2'; }
  get col() { return this.app.settings.rwinCol || 'graphite'; }
  carryMove(p, e) {
    const app = this.app, pw = app.wallTool.proof, r = pw.rec, [, Wm, Hm] = RWIN[this.key], W = MM(Wm), H = MM(Hm);
    this.place = null;
    // a slope of the pitched roof under the finger
    const h = r && pw._hit(e);
    if (h) {
      const w = r.wings[h.wi], f = h.f, a = h.a, d = h.d;
      const pa = planeAt(r, w, f, a, d);
      if (!pa) { this._live(null); return { ok: false, why: 'Окно — на скат' }; }
      const P = pa.P;
      // between the rafters (in the middle of a bay), the height where the finger is
      const x0 = P.end || P.xd ? P.xa(0) : f.lo, step = MM(PITCHED.step);
      let x = x0 + MM(PITCHED.rafterW) + (Math.floor((pa.x - x0) / step) + 0.5) * step;
      let t = Math.max(H / 2 + MM(300), Math.min(P.L - H / 2 - MM(300), pa.t));
      const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]];
      let why = null;
      if (!(r.done?.frame === true || (r.done?.frame || []).some((q) => q[0] === h.wi))) why = 'Окно в скат — когда стоят стропила';
      else if (corners.some(([dx, dt]) => x + dx < P.xa(t + dt) + MM(150) || x + dx > P.xb(t + dt) - MM(150))) why = 'Здесь окно не помещается — ближе к середине ската';
      else if (app.objects.all('rwin').some((q) => q.host === r.id && q.wi === h.wi && q.plane === P.key && Math.abs(q.x - x) < W && Math.abs(q.t - t) < H + MM(200))) why = 'Здесь уже окно';
      this.place = { host: r.id, wi: h.wi, plane: P.key, x: +x.toFixed(6), t: +t.toFixed(6), why };
      this._live({ wi: h.wi, plane: P.key, x, t, key: this.key, col: this.col });
      return { ok: !why, why };
    }
    // a flat roof (its covering) under the finger
    const roofs = app.wallView.roofs;
    if (e && e.clientX !== undefined && roofs.children.length) {
      _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
      const hit = _ray.intersectObject(roofs, true)[0];
      if (hit && hit.face && hit.face.normal.y > 0.8) {
        const id = hit.object.userData.uOwner, rf = id != null ? app.objects.get(id) : null;
        const why = !rf || !(rf.memS?.length || rf.memS === 'all') ? 'Окно в плоскую крышу — на готовую мембрану' : null;
        const b = rf && app.objects.get(rf.slab), yaw = b ? Math.atan2(-b.u[1], b.u[0]) : 0;
        this.place = { flat: true, host: id, x: +hit.point.x.toFixed(6), y: +hit.point.y.toFixed(6), z: +hit.point.z.toFixed(6), yaw: +yaw.toFixed(5), why };
        this._live({ flat: true, x: hit.point.x, y: hit.point.y, z: hit.point.z, yaw, key: this.key, col: this.col });
        return { ok: !why, why };
      }
    }
    this._live(null);
    return { ok: false, why: 'Окно — на скат крыши (между стропилами) или на плоскую кровлю' };
  }
  _live(l) { const v = this.app.wallView; v.liveRwin = l; v.proofDirty = true; }
  carryDrop() {
    const app = this.app, P = this.place;
    this.place = null; this._live(null);
    if (!P) { app.ui.toast('Окно — на скат крыши или на плоскую кровлю'); return; }
    if (P.why) { app.ui.toast(P.why); return; }
    const { why, ...rec } = P; void why;
    app.journal.act('rwin', {}, app.clock, () => app.objects.add({ type: 'rwin', key: this.key, col: this.col, ...rec }));
    app.ui.toast(P.flat ? `Окно ${RWIN[this.key][0]} на плоскую кровлю: стакан 150 мм, мембрана заведена на него, рама и стеклопакет` : `Мансардное окно ${RWIN[this.key][0]}: между стропилами, сверху и снизу ригели, вокруг — оклад, кровля подрезана`);
  }
  status() { return this.place ? (this.place.why ? 'Красный — ' + this.place.why : 'Отпустите') : 'Окно в крышу: тяните из лотка на скат (встанет между стропилами) или на плоскую кровлю'; }
}
