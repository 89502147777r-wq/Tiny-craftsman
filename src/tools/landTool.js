import * as THREE from 'three';
import { MODEL_SCALE, M_G20, M_SAND, M_SOIL } from '../config.js';
import { FitJob } from './fitJob.js';
import {
  PATH, PATH_LAYERS, PATH_WIDTHS, PAVERS, PAVE_COLS, TOPS, lineOf, lineWhy, legsOf, legW, lengthOf, half, paveQuads, digQuads, kerbOuter, inQuads, boxOf, chainOf, kerbsOf, paversOf,
} from '../world/garden.js';
import { pointAt } from '../world/gardenView.js';
import { FENCE, FENCE_LAYERS, FENCE_KINDS, FENCE_HEIGHTS, FENCE_COLS, GATES, fenceLine, postsOf, fenceLength, fillCount, sOf, gateFit, kindOf } from '../world/fence.js';
import { PLANTS, hedgePlants } from '../world/plants.js';
import { LAWN, LAWN_LAYERS, LAWN_HOW, polyOf, areaOf, inside as inPolyL, mainDir, cellsOf as lawnCells, frameW } from '../world/lawn.js';

// The garden done by the finger (garden.js): «Благоустройство» → «Дорожка» → its stages one after
// the other. The path is drawn by the finger along the ground; each next stage is a touch on it and
// is done before the eyes: the trough dug bite by bite, the kerbs set one by one, the fabric rolled
// out, the stone and the sand spread from the start to the end, the plate going over them, the
// pavers laid row after row.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const NAME = Object.fromEntries(PATH_LAYERS);
const ORDER = PATH_LAYERS.map(([k]) => k);
const LNAME = Object.fromEntries(LAWN_LAYERS), LORDER = LAWN_LAYERS.map(([k]) => k);
const FNAME = Object.fromEntries(FENCE_LAYERS), FORDER = FENCE_LAYERS.map(([k]) => k);
const f1 = (v) => v.toFixed(1).replace('.', ',');

export class LandWork {
  constructor(app) { this.app = app; this.drag = null; this.sel = null; }
  get layer() { return NAME[this.app.settings.pathLayer] ? this.app.settings.pathLayer : 'set'; }
  get W() { return PATH_WIDTHS.includes(this.app.settings.pathW) ? this.app.settings.pathW : 1200; }
  get paver() { return PAVERS[this.app.settings.pathPaver] ? this.app.settings.pathPaver : 'brick'; }
  get col() { return PAVE_COLS[this.app.settings.pathCol] ? this.app.settings.pathCol : 'grey'; }
  get rec() { const all = this.app.objects.all('path'); return all.find((r) => r.id === this.sel) || all.at(-1) || null; }
  get view() { return this.app.gardenView; }
  toast(m) { this.app.ui?.toast(m); }
  // the path at a point: the one it is on, else the nearest
  pick(p) {
    const all = this.app.objects.all('path');
    if (!p || !all.length) return this.rec;
    let best = null, bd = Infinity;
    for (const r of all) {
      if (inQuads(digQuads(r), p.x, p.z)) { best = r; break; }
      const a = chainOf(r, p.x, p.z), q = pointAt(r, a / S), d = Math.hypot(q[0] - p.x, q[1] - p.z);
      if (d < bd) bd = d, best = r;
    }
    if (best) this.sel = best.id;
    return best;
  }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  // the terrain's cells in the bands qs (with each one's chainage, mm)
  _cells(r, qs) {
    const t = this.app.terrain, [x0, z0, x1, z1] = boxOf(qs), out = [];
    const ix0 = Math.max(0, Math.floor(t.toCellX(x0))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(x1))), iz0 = Math.max(0, Math.floor(t.toCellZ(z0))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(z1)));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const x = t.toWorldX(ix), z = t.toWorldZ(iz); if (inQuads(qs, x, z)) out.push([iz * t.nx + ix, chainOf(r, x, z) / S, x, z]); }
    out.box = [ix0, iz0, ix1, iz1];
    return out;
  }
  // what is done of a path: the stage reached
  stageOf(r) { const d = r?.done || {}; let k = 0; for (let i = 1; i < ORDER.length; i++) if (d[ORDER[i]]) k = i; return k; }
  _need(r, L) {
    const i = ORDER.indexOf(L), d = r.done || {};
    if (d[L]) return `${NAME[L]} — уже сделано. Дальше «${ORDER.indexOf(this.next(r)[0]) + 1} · ${NAME[this.next(r)[0]] || ''}»`;
    for (let k = 1; k < i; k++) if (!d[ORDER[k]]) return `Сначала «${k + 1} · ${NAME[ORDER[k]]}»`;
    return null;
  }

  get what() { const w = this.app.settings.landWhat; return w === 'lawn' || w === 'fence' || w === 'plant' ? w : 'path'; }
  get plantKind() { return PLANTS[this.app.settings.plantKind] ? this.app.settings.plantKind : 'tree'; }
  get fenceLayer() { return FNAME[this.app.settings.fenceLayer] ? this.app.settings.fenceLayer : 'line'; }
  get fenceKind() { return FENCE_KINDS[this.app.settings.fenceKind] ? this.app.settings.fenceKind : 'slat'; }
  get fenceH() { return FENCE_HEIGHTS.includes(this.app.settings.fenceH) ? this.app.settings.fenceH : 1800; }
  get fenceCol() { const c = this.app.settings.fenceCol, K = FENCE_KINDS[this.fenceKind]; return K.cols.includes(c) ? c : K.cols[0]; }
  get gateType() { return GATES[this.app.settings.gateType] ? this.app.settings.gateType : 'swing'; }
  get fence() { const all = this.app.objects.all('fence'); return all.find((r) => r.id === this.fsel) || all.at(-1) || null; }
  get lawnLayer() { return LNAME[this.app.settings.lawnLayer] ? this.app.settings.lawnLayer : 'area'; }
  get how() { return LAWN_HOW[this.app.settings.lawnHow] ? this.app.settings.lawnHow : 'turf'; }
  get lawn() { const all = this.app.objects.all('lawn'); return all.find((r) => r.id === this.lsel) || all.at(-1) || null; }

  down(p, e) {
    if (this.what === 'lawn') return this._lawnDown(p, e);
    if (this.what === 'fence') return this._fenceDown(p, e);
    if (this.what === 'plant') return this._plantDown(p, e);
    const L = this.layer;
    if (L === 'set') {
      const app = this.app;
      this.drag = { L, trail: [[p.x, p.z]] };
      this.view.setLive(null);
      app.ui?.showMeasure?.('Ведите пальцем по земле — где пройдёт дорожка');
      return true;
    }
    const r = this.pick(p);
    if (!r) { this.toast('Сначала «1 · Разметка»: проведите пальцем по участку, где пройдёт дорожка'); return true; }
    if (this.app.physJob) return true;
    const why = this._need(r, L);
    if (why) { this.toast(why); return true; }
    ({ dig: () => this._dig(r), kerb: () => this._kerb(r), geo: () => this._geo(r), grav: () => this._grav(r), sand: () => this._sand(r), pave: () => this._pave(r), joint: () => this._joint(r) })[L]?.();
    return true;
  }
  move(p) {
    const d = this.drag; if (!d) return;
    if (d.L === 'area') { this._lawnMove(p); return; }
    if (d.L === 'fline') { this._fenceMove(p); return; }
    if (d.L === 'hedge') { const last = d.trail.at(-1); if (Math.hypot(p.x - last[0], p.z - last[1]) > MM(80)) { d.trail.push([p.x, p.z]); const pts = fenceLine(d.trail); this.view.setLiveFence(pts ? { pts, H: 1300, kind: 'slat', col: 'graphite', g: this._groundOf(pts) } : null); if (pts) this.app.ui?.showMeasure?.(`Живая изгородь ${f1(fenceLength({ pts, kind: 'slat' }) / S / 1000)} м, ${hedgePlants({ pts }).length} растений — отпустите`); } return; }
    const last = d.trail.at(-1);
    if (Math.hypot(p.x - last[0], p.z - last[1]) < MM(80)) return;
    d.trail.push([p.x, p.z]);
    const pts = lineOf(d.trail) || [d.trail[0], [p.x, p.z]];
    const g = this._groundOf(pts), r = { pts, W: this.W, g };
    this.view.setLive(r);
    const len = legsOf(r).reduce((s, q) => s + q.L, 0) / S / 1000;
    this.app.ui?.showMeasure?.(lineWhy(pts, this.W) || `Дорожка ${f1(len)} м × ${f1(this.W / 1000)} м — отпустите, где она кончается`);
  }
  update() {}
  up() {
    const app = this.app, d = this.drag;
    if (d?.L === 'area') { this._lawnUp(); return; }
    if (d?.L === 'fline') { this._fenceUp(); return; }
    if (d?.L === 'hedge') { this.drag = null; this.view.setLiveFence(null); this.app.ui?.hideMeasure?.(); const pts = fenceLine(d.trail); if (!pts) { this.toast('Изгородь короче метра — ведите пальцем длиннее'); return; } this._plant({ kind: 'hedge', pts, g: this._groundOf(pts) }); return; }
    this.drag = null;
    if (!d) return;
    this.view.setLive(null);
    app.ui?.hideMeasure?.();
    const pts = lineOf(d.trail);
    if (!pts) { this.toast('Дорожка короче метра — проведите пальцем длиннее, вдоль будущей дорожки'); return; }
    const why = lineWhy(pts, this.W);
    if (why) { this.toast(why); return; }
    const rec = { type: 'path', pts, W: this.W, g: +this._groundOf(pts).toFixed(6), done: {} };
    const fit = this._fits(rec);
    if (fit) { this.toast(fit); return; }
    this._save('path-set-out', () => { const o = app.objects.add(rec); this.sel = o.id; });
    const len = lengthOf(rec) / S / 1000;
    this.toast(`Дорожка ${f1(len)} м, ширина ${f1(this.W / 1000)} м: колышки и шнур по краям бордюров. Дальше «2 · Корыто»`);
  }
  interrupt() { if (this.drag?.L === 'set') { this.view.setLive(null); this.app.ui?.hideMeasure?.(); } if (this.drag?.L === 'area') { this.view.setLiveLawn(null); this.app.ui?.hideMeasure?.(); } if (this.drag?.L === 'fline') { this.view.setLiveFence(null); this.app.ui?.hideMeasure?.(); } this.drag = null; }

  // the ground's level along the line (the middle of what is there)
  _groundOf(pts) {
    const t = this.app.terrain, hs = [];
    for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 8; k++) { const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 8, z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 8; if (t.inside(x, z)) hs.push(t.heightAt(x, z)); }
    hs.sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length / 2)] : 0.1;
  }
  _fits(rec) {
    const t = this.app.terrain, [x0, z0, x1, z1] = boxOf(digQuads(rec)), m = MM(200);
    if (x0 < -t.halfX + m || x1 > t.halfX - m || z0 < -t.halfZ + m || z1 > t.halfZ - m) return 'Дорожка выходит за участок — ведите ближе к середине';
    return null;
  }

  // ---- 2 · the trough: bite after bite along the path, 300 deep; the soil goes away ----------
  _dig(r) {
    const app = this.app, t = app.terrain, qs = digQuads(r), y = r.g - MM(PATH.dig), box = boxOf(qs), before = t.totalVolume();
    const inside = (x, z) => inQuads(qs, x, z);
    const legs = legsOf(r), w = half(r) + MM(PATH.kerbW + PATH.room), bites = [], rr = Math.random, SP = 420;
    for (const g of legs) {
      const n = Math.max(1, Math.ceil(g.L / MM(SP))), rows = Math.max(2, Math.ceil(2 * w / MM(650)));
      for (let k = 0; k <= n; k++) for (let j0 = 0; j0 < rows; j0++) {
        const j = k % 2 ? rows - 1 - j0 : j0, a = g.a0 + g.L * k / n + (rr() - 0.5) * MM(150), c = -w + 2 * w * (j + 0.5) / rows + (rr() - 0.5) * MM(120);
        const [x, z] = legW(g, a, c);
        bites.push({ x, z, R: MM(380 + rr() * 140), deep: y - MM(rr() * 40), yT: r.g + MM(20), seed: rr() * 6.28, p: 0 });
      }
    }
    app.journal.begin('path-dig', {}, app.clock);
    const step = 0.035, life = 0.28, T = bites.length * step + life, sh = app.shovel, vis = sh.root.visible;
    const steps = [[0, () => { sh.root.visible = false; }], [T, (u) => {
      const now = u * T;
      for (let k = 0; k < bites.length; k++) {
        const b = bites[k], q = Math.max(0, Math.min(1, (now - k * step) / life));
        if (q <= b.p) continue;
        b.p = q;
        const e = q * q * (3 - 2 * q);
        t.scoop(b.x, b.z, b.R, b.yT + (b.deep - b.yT) * e, b.yT, inside, b.seed);
        if (q < 1 && rr() < 0.4) app.particles?.emit(new THREE.Vector3(b.x, r.g, b.z), new THREE.Vector3((rr() - 0.5) * 0.12, 0.18 + rr() * 0.12, (rr() - 0.5) * 0.12), 0, MM(25 + rr() * 40), 0, 0, 0);
      }
      if (rr() < 0.12) app.sfx?.stab?.();
    }], [0.15, (u) => { if (u >= 1) { t.levelTo(inside, y, box); sh.root.visible = vis; } }]];
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); sh.root.visible = vis; }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), dig: 1 } });
      app.journal.commit(app.clock);
      const out = Math.max(0, before - t.totalVolume()) * MODEL_SCALE ** 3;
      this.toast(`Корыто 300 мм выкопано, вынуто ${f1(out)} м³ (вывезено). Дальше «3 · Бордюр»`);
    } });
  }

  // ---- 3 · the kerbs: one after another on the concrete, tapped down to the string ------------
  _kerb(r) {
    const app = this.app, t = app.terrain, K = kerbsOf(r), g = r.g, v = this.view, gear = app.concreteGear;
    const [cx, cz] = legW(legsOf(r)[0], legsOf(r)[0].L / 2, 0);
    if (t.heightAt(cx, cz) > r.g - MM(PATH.dig - 60)) { this.toast('Корыто ещё не выкопано — «2 · Корыто»'); return; }
    // (behind the kerbs, out to the trough's side: the soil put back, rammed)
    const all = this._cells(r, digQuads(r)), ko = kerbOuter(r), back = all.filter(([, , x, z]) => !inQuads(ko, x, z));
    back.box = all.box;
    app.journal.begin('path-kerb', {}, app.clock);
    const per = 0.32, steps = [];
    const P = (k) => { const p = K[k].p, n = p.length; return new THREE.Vector3(p.reduce((s, q) => s + q[0], 0) / n, g, p.reduce((s, q) => s + q[1], 0) / n); };
    steps.push([0, () => v.setAnim(r.id, { kerb: 0, kerbS: K[0].s - 400 })]);
    steps.push([K.length * per + 0.6, (u, job) => {
      const n = u * (K.length + 2), k = Math.min(K.length - 1, Math.floor(n));
      v.setAnim(r.id, { kerb: u >= 1 ? 1e9 : n, kerbS: u >= 1 ? 1e9 : (K[k].s ?? 0) + 600 });
      // (the mallet on the one going down)
      const f = (n % 1), sw = f < 0.6 ? Math.sin(f / 0.6 * Math.PI / 2) : Math.cos((f - 0.6) / 0.4 * Math.PI / 2);
      gear.malletSwing = sw * 0.75; gear.set('mallet', P(Math.max(0, k - 1)), 0);
      if (Math.floor(n) !== job._lastK) { job._lastK = Math.floor(n); app.sfx?.stab?.(); }
      if (u >= 1) gear.set(null);
    }]);
    // the soil back behind them, from the start to the end
    const L = lengthOf(r) / S;
    steps.push([1.4, (u) => {
      const front = -1500 + (L + 3000) * u;
      for (const c of back) { if (c[1] > front || c[4]) continue; const i = c[0], h = t.hAt(i); if (h < g) t._push(i, g - h, M_SOIL); c[4] = 1; }
      t._touch(...back.box);
    }]);
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); v.setAnim(r.id, null); gear.set(null); }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), kerb: 1 } });
      app.journal.commit(app.clock);
      v.setAnim(r.id, null);
      this.toast(`Бордюры 1000 × 200 × 80: ${K.length} шт на бетоне с подпорой, по шнуру; за ними грунт засыпан. Дальше «4 · Геотекстиль»`);
    } });
  }

  // ---- 4 · the geotextile: rolled out from the start to the end -------------------------------
  _geo(r) {
    const app = this.app, v = this.view, L = lengthOf(r) / S;
    const steps = [[Math.max(1.6, L / 1000 * 0.35), (u) => { const s = -200 + (L + 400) * u; v.setAnim(r.id, { geo: s, roll: u < 1 ? Math.max(0, Math.min(L, s)) : null }); }]];
    new FitJob(app, { steps, parts: [], onAbort: () => v.setAnim(r.id, null), commit: () => {
      this._save('path-geo', () => app.objects.update(r.id, { done: { ...(r.done || {}), ...(app.objects.get(r.id).done || {}), geo: 1 } }));
      v.setAnim(r.id, null);
      this.toast(`Геотекстиль ${f1(L / 1000 * r.W / 1000)} м² — щебень не уйдёт в грунт. Дальше «5 · Щебень»`);
    } });
  }

  // a layer spread from the start to the end, up to the top yTop (the front: the material running
  // out ahead a little); then the tool over it
  _spread(r, mat, yTop, dur) {
    const app = this.app, t = app.terrain, cells = this._cells(r, paveQuads(r)), L = lengthOf(r) / S;
    return [dur, (u) => {
      const front = -600 + (L + 1200) * u;
      for (const c of cells) {
        const k = Math.max(0, Math.min(1, (front - c[1]) / 700 + 0.15 * Math.sin(c[1] * 0.004 + c[2] * 900)));
        const i = c[0], h = t.hAt(i), want = yTop - (1 - k) * MM(mat === M_G20 ? 120 : 30);
        if (k > 0 && want > h + 1e-7) t._push(i, want - h, mat);
      }
      t._touch(...cells.box);
      if (u < 1 && Math.random() < 0.6) { const p = pointAt(r, Math.max(0, Math.min(L, front - 300))); app.particles?.emit(new THREE.Vector3(p[0] + (Math.random() - 0.5) * half(r), yTop + MM(500), p[1] + (Math.random() - 0.5) * half(r)), new THREE.Vector3(0, -0.15, 0), 0, MM(mat === M_G20 ? 30 : 10), 0, 0, mat === M_G20 ? 3 : 1); }
      if (u < 1 && Math.random() < 0.2) app.sfx?.pour?.(0.35);
    }];
  }
  // the plate compactor along the path: down one side, back the other (heading where it goes)
  _plate(r, y, passes, onAt = null) {
    const app = this.app, t = app.terrain, L = lengthOf(r) / S, h = half(r) / S, lanes = r.W > 900 ? [-(h - 230), h - 230] : [0];
    const legs = [];
    for (let p = 0; p < passes; p++) lanes.forEach((c, k) => legs.push({ c, back: (p * lanes.length + k) % 2 === 1 }));
    const wide = MM(240), dur = legs.length * Math.max(1.2, L / 1000 * 0.32);
    return [dur, (u) => {
      const q = u * legs.length, k = Math.min(legs.length - 1, Math.floor(q)), f = q - k, lg = legs[k];
      const s = Math.max(150, Math.min(L - 150, (lg.back ? 1 - f : f) * L)), P = pointAt(r, s), n = [-P[3], P[2]];
      const x = P[0] + n[0] * MM(lg.c), z = P[1] + n[1] * MM(lg.c), yaw = Math.atan2(P[2] * (lg.back ? -1 : 1), P[3] * (lg.back ? -1 : 1));
      app.concreteGear.plateOn = true; app.concreteGear.set('plate', new THREE.Vector3(x, y, z), yaw, u === 0);
      const ix0 = Math.max(0, Math.floor(t.toCellX(x - wide))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(x + wide))), iz0 = Math.max(0, Math.floor(t.toCellZ(z - wide))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(z + wide)));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) if (Math.hypot(t.toWorldX(ix) - x, t.toWorldZ(iz) - z) < wide) t.comp[iz * t.nx + ix] = 1;
      t._touch(ix0, iz0, ix1, iz1);
      onAt?.(s);
      if (Math.random() < 0.1) app.sfx?.stab?.();
      if (u >= 1) { app.concreteGear.plateOn = false; app.concreteGear.set(null); }
    }];
  }

  // ---- 5 · the crushed stone 200, rammed ------------------------------------------------------
  _grav(r) {
    const app = this.app, t = app.terrain, y = r.g + MM(TOPS.grav), cells = this._cells(r, paveQuads(r));
    app.journal.begin('path-grav', {}, app.clock);
    const L = lengthOf(r) / S, steps = [this._spread(r, M_G20, y, Math.max(2, L / 1000 * 0.45)), this._plate(r, y, 1), [0, () => { for (const c of cells) t.comp[c[0]] = 1; t._touch(...cells.box); }]];
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); app.concreteGear.set(null); }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), grav: 1 } });
      app.journal.commit(app.clock);
      this.toast('Щебень 20–40 слоем 200 мм утрамбован виброплитой. Дальше «6 · Песок»');
    } });
  }

  // ---- 6 · the sand 40, screeded off the kerbs ---------------------------------------------------
  _sand(r) {
    const app = this.app, t = app.terrain, y = r.g + MM(TOPS.sand), cells = this._cells(r, paveQuads(r)), L = lengthOf(r) / S, gear = app.concreteGear;
    app.journal.begin('path-sand', {}, app.clock);
    const steps = [this._spread(r, M_SAND, y + MM(8), Math.max(1.6, L / 1000 * 0.35))];
    // (the rule across the path on the kerbs, pulled from the start to the end: the sand left level)
    steps.push([Math.max(1.6, L / 1000 * 0.4), (u) => {
      const s = L * u, P = pointAt(r, Math.max(0, Math.min(L, s)));
      gear.set('screed', new THREE.Vector3(P[0], y, P[1]), Math.atan2(-P[2], -P[3]), u === 0);
      for (const c of cells) if (c[1] < s) { const h = t.hAt(c[0]); if (h > y + 1e-7) t._pop(c[0], h - y); else if (h < y - 1e-7) t._push(c[0], y - h, M_SAND); }
      t._touch(...cells.box);
      if (Math.random() < 0.15) app.sfx?.scrapeLevel?.(0.3);
      if (u >= 1) { gear.set(null); app.sfx?.scrapeLevel?.(0); }
    }]);
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); gear.set(null); }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), sand: 1 } });
      app.journal.commit(app.clock);
      this.toast('Песок 40 мм выровнен правилом по бордюрам. Дальше «7 · Плитка»');
    } });
  }

  // ---- 7 · the pavers: row after row from the start --------------------------------------------
  _pave(r) {
    const app = this.app, v = this.view, key = this.paver, col = this.col;
    const live = { ...r, paver: key, col };
    const n = paversOf(live).length, cut = paversOf(live).filter((p) => p.cut).length;
    // (the record takes the kind and the colour at once: the view builds them; shown as laid)
    app.journal.begin('path-pave', {}, app.clock);
    app.objects.update(r.id, { paver: key, col });
    const dur = Math.max(3, Math.min(14, n / 45));
    const steps = [[dur, (u, job) => {
      const k = u * (n + 6);
      v.setAnim(r.id, { pave: u >= 1 ? 1e9 : k });
      if (Math.floor(k / 3) !== job._k) { job._k = Math.floor(k / 3); if (Math.random() < 0.5) app.sfx?.stab?.(); }
    }]];
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); v.setAnim(r.id, null); }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), pave: 1 } });
      app.journal.commit(app.clock);
      v.setAnim(r.id, null);
      this.toast(`Плитка «${PAVERS[key].name}», ${PAVE_COLS[col][0].toLowerCase()}: ${n} шт, из них подрезано ${cut}. Дальше «8 · Швы»`);
    } });
  }

  // ---- 8 · the joints: sand brushed in, the plate over the pavers on a mat ----------------------
  _joint(r) {
    const app = this.app, v = this.view, L = lengthOf(r) / S;
    const steps = [[Math.max(1.5, L / 1000 * 0.25), (u) => v.setAnim(r.id, { joint: -100 + (L + 200) * u })], this._plate(r, r.g, 1)];
    new FitJob(app, { steps, parts: [], onAbort: () => { v.setAnim(r.id, null); app.concreteGear.set(null); }, commit: () => {
      this._save('path-joint', () => app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), joint: 1 } }));
      v.setAnim(r.id, null);
      this.toast('Швы заполнены песком, плитка осажена виброплитой через резиновый коврик — дорожка готова');
    } });
  }

  // the next thing to do (the chip «➜ …»)
  next(r = this.rec) {
    if (this.what === 'lawn') return this.lawnNext();
    if (this.what === 'fence') return this.fenceNext();
    if (this.what === 'plant') return [null, this.plantStatus()];
    if (!r) return ['set', 'Разметьте дорожку: проведите пальцем по участку'];
    const d = r.done || {};
    for (const k of ORDER.slice(1)) if (!d[k]) return [k, NAME[k]];
    return [null, 'Дорожка готова'];
  }
  status() {
    if (this.what === 'lawn') return this.lawnStatus();
    if (this.what === 'fence') return this.fenceStatus();
    if (this.what === 'plant') return this.plantStatus();
    return {
      set: `Проведите пальцем по участку, где пройдёт дорожка шириной ${f1(this.W / 1000)} м — повороты по ходу пальца`,
      dig: 'Коснитесь дорожки — выкопается корыто 300 мм с запасом под бордюры',
      kerb: 'Коснитесь дорожки — бордюры встанут на бетон по шнуру, за ними засыплют грунт',
      geo: 'Коснитесь дорожки — по дну корыта раскатается геотекстиль',
      grav: 'Коснитесь дорожки — щебень 200 мм с трамбовкой виброплитой',
      sand: 'Коснитесь дорожки — песок 40 мм, выровненный правилом',
      pave: `Коснитесь дорожки — уложится плитка «${PAVERS[this.paver].name}», ${PAVE_COLS[this.col][0].toLowerCase()}`,
      joint: 'Коснитесь дорожки — швы засыплют песком и пройдут виброплитой',
    }[this.layer];
  }
  // ==== the lawn ===============================================================================
  _lawnPick(p) {
    const all = this.app.objects.all('lawn');
    const r = (p && all.find((q) => inPolyL(q.poly, p.x, p.z))) || null;
    if (r) this.lsel = r.id;
    return r || this.lawn;
  }
  _lawnNeed(r, L) {
    const i = LORDER.indexOf(L), d = r.done || {};
    if (d[L]) { const [nk, nw] = this.lawnNext(r); return nk ? `${LNAME[L]} — уже сделано. Дальше «${LORDER.indexOf(nk) + 1} · ${nw}»` : 'Газон готов'; }
    for (let k = 1; k < i; k++) if (!d[LORDER[k]]) return `Сначала «${k + 1} · ${LNAME[LORDER[k]]}»`;
    return null;
  }
  _lawnDown(p) {
    const L = this.lawnLayer;
    if (L === 'area') {
      this.drag = { L, trail: [[p.x, p.z]] };
      this.app.ui?.showMeasure?.('Обведите пальцем место под газон — контур замкнётся сам');
      return true;
    }
    const r = this._lawnPick(p);
    if (!r) { this.toast('Сначала «1 · Контур»: обведите пальцем место под газон'); return true; }
    if (this.app.physJob) return true;
    const why = this._lawnNeed(r, L);
    if (why) { this.toast(why); return true; }
    ({ soil: () => this._lSoil(r), rake: () => this._lRake(r), roll: () => this._lRoll(r), grass: () => this._lGrass(r), water: () => this._lWater(r) })[L]?.();
    return true;
  }
  _lawnMove(p) {
    const d = this.drag, last = d.trail.at(-1);
    if (Math.hypot(p.x - last[0], p.z - last[1]) < MM(100)) return;
    d.trail.push([p.x, p.z]);
    const poly = polyOf(d.trail);
    this.view.setLiveLawn(poly ? { poly, g: this._groundIn(poly) } : null);
    this.app.ui?.showMeasure?.(poly ? `Газон ${f1(areaOf(poly) / S / S / 1e6)} м² — отпустите, контур замкнётся` : 'Обведите пальцем место под газон');
  }
  _lawnUp() {
    const app = this.app, d = this.drag;
    this.drag = null;
    this.view.setLiveLawn(null); app.ui?.hideMeasure?.();
    const poly = polyOf(d.trail);
    if (!poly) { this.toast('Контур мал — обведите место под газон шире (от 1,5 м²)'); return; }
    const rec = { type: 'lawn', poly, g: +this._groundIn(poly).toFixed(6), u: mainDir(poly), how: this.how, done: {} };
    this._save('lawn-area', () => { const o = app.objects.add(rec); this.lsel = o.id; });
    this.toast(`Газон ${f1(areaOf(poly) / S / S / 1e6)} м²: контур размечен краской. Дальше «2 · Плодородный грунт»`);
  }
  // the ground's level inside an outline (the middle of what is there)
  _groundIn(poly) {
    const t = this.app.terrain, xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]), hs = [];
    for (let i = 0; i <= 10; i++) for (let k = 0; k <= 10; k++) { const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * i / 10, z = Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * k / 10; if (inPolyL(poly, x, z) && t.inside(x, z)) hs.push(t.heightAt(x, z)); }
    hs.sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length / 2)] : 0.1;
  }
  _lSet(r, k, v) { this.view.setAnim('L' + r.id, v === undefined ? null : { [k]: v }); }
  _lDone(r, k, msg) {
    const app = this.app, up = () => app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), [k]: 1 } });
    if (app.journal.pending) { up(); app.journal.commit(app.clock); } else this._save('lawn-' + k, up);
    this.view.setAnim('L' + r.id, null);
    if (msg) this.toast(msg);
  }
  _lJob(r, k, steps, msg, cleanup = null) {
    new FitJob(this.app, { steps, parts: [], onAbort: () => { if (this.app.journal.pending) this.app.journal.cancel(); this.view.setAnim('L' + r.id, null); cleanup?.(); }, commit: () => { cleanup?.(); this._lDone(r, k, msg); } });
  }
  // the extent of the lawn along its rows (mm), its cells
  _lExtent(r) { const c = lawnCells(this.app, r); return { c, a0: c.a0 / S, a1: c.a1 / S, b0: c.b0 / S, b1: c.b1 / S }; }
  _lSoil(r) {
    const app = this.app, { c, a0, a1, b0, b1 } = this._lExtent(r), A = c.length * (LAWN.cell / 1000) ** 2;
    if (!c.length) { this.toast('Внутри контура нет свободной земли (дорожки, бассейн, бетон)'); return; }
    const steps = [[Math.max(2, (a1 - a0) / 1000 * 0.35), (u) => {
      const f = a0 - 300 + (a1 - a0 + 600) * u;
      this.view.setAnim('L' + r.id, { soil: f });
      if (u < 1 && Math.random() < 0.7) { const [x, z] = frameW(r, MM(f), MM(b0 + (b1 - b0) * Math.random())); app.particles?.emit(new THREE.Vector3(x, r.g + MM(400), z), new THREE.Vector3(0, -0.15, 0), 0, MM(25), 0, 0, 0); }
      if (u < 1 && Math.random() < 0.15) app.sfx?.pour?.(0.3);
    }]];
    this._lJob(r, 'soil', steps, `Плодородный грунт 100 мм на ${f1(A)} м² (${f1(A * 0.1)} м³). Дальше «3 · Грабли»`);
  }
  _lRake(r) {
    const app = this.app, { a0, a1, b0, b1 } = this._lExtent(r), rk = app.rake, vis = rk.root.visible, pos = rk.target.pos.clone(), dir = rk.target.dir.clone(), lift = rk.target.lift;
    const u = r.u || [1, 0], back = () => { rk.setPose({ pos, dir, lift }, true); rk.root.visible = vis; };
    const steps = [[0, () => { rk.root.visible = true; }], [Math.max(2.5, (a1 - a0) / 1000 * 0.45), (q) => {
      const f = a0 + (a1 - a0) * q, sw = Math.sin(q * Math.PI * 2 * Math.max(4, (a1 - a0) / 900)), b = (b0 + b1) / 2 + sw * (b1 - b0) * 0.42;
      const [x, z] = frameW(r, MM(f), MM(b));
      rk.setPose({ pos: new THREE.Vector3(x, r.g + MM(16), z), dir: new THREE.Vector2(-u[0], -u[1]), lift: 0.5 }, q === 0);
      this.view.setAnim('L' + r.id, { rake: f - 250 });
      if (Math.random() < 0.12) app.sfx?.scrapeLevel?.(0.25);
      if (q >= 1) { back(); app.sfx?.scrapeLevel?.(0); }
    }]];
    this._lJob(r, 'rake', steps, 'Грунт разровнен граблями, камни и комья убраны. Дальше «4 · Каток»', back);
  }
  _lRoll(r) {
    const { a0, a1, b0, b1 } = this._lExtent(r), u = r.u || [1, 0], yaw = Math.atan2(-u[0], -u[1]);
    const lanes = Math.max(2, Math.ceil((a1 - a0) / 700)), dur = Math.min(12, Math.max(3, lanes * 0.35));
    const steps = [[dur, (q) => {
      const k = Math.min(lanes - 1, Math.floor(q * lanes)), f = q * lanes - k, a = a0 + (a1 - a0) * (k + 0.5) / lanes, b = k % 2 ? b1 - (b1 - b0) * f : b0 + (b1 - b0) * f;
      this.view.setAnim('L' + r.id, { roll: a0 + (a1 - a0) * k / lanes, rollerAt: q < 1 ? { a: MM(a), b: MM(b), y: r.g + MM(6), yaw: yaw + (k % 2 ? Math.PI / 2 : -Math.PI / 2) } : null });
      if (Math.random() < 0.08) this.app.sfx?.scrapeLevel?.(0.15);
    }]];
    this._lJob(r, 'roll', steps, 'Укатано садовым катком — грунт осел и не продавится. Дальше «5 · Газон»', () => this.app.sfx?.scrapeLevel?.(0));
  }
  _lGrass(r) {
    const app = this.app, how = this.how, { c } = this._lExtent(r), A = c.length * (LAWN.cell / 1000) ** 2, u = r.u || [1, 0], yaw = Math.atan2(-u[0], -u[1]);
    // (the record takes the way at once: the grass is built for it)
    app.journal.begin('lawn-grass', {}, app.clock);
    if (r.how !== how) app.objects.update(r.id, { how });
    if (how === 'seed') {
      const steps = [[1.6, (q) => { this.view.setAnim('L' + r.id, { grow: 0.02 * q }); if (Math.random() < 0.8) { const p = c[Math.floor(Math.random() * c.length)]; app.particles?.emit(new THREE.Vector3(p.x, r.g + MM(300), p.z), new THREE.Vector3(0, -0.1, 0), 0, MM(4), 0, 0, 1); } }],
        [3.2, (q) => this.view.setAnim('L' + r.id, { grow: 0.02 + 0.98 * q * q })]];
      this._lJob(r, 'grass', steps, `Посеяно ${f1(A * 0.035)} кг семян на ${f1(A)} м² — через три недели газон взошёл. Дальше «6 · Полив»`);
      return;
    }
    // the rolls: their order and extent (row by row)
    const rolls = [];
    for (const q of c) { const R = rolls[q.roll] || (rolls[q.roll] = { a0: Infinity, a1: -Infinity, b: 0, n: 0 }); R.a0 = Math.min(R.a0, q.a - q.ru * MM(LAWN.roll[0])); R.a1 = Math.max(R.a1, q.a); R.b += q.b; R.n++; }
    for (const R of rolls) R.b /= R.n;
    const n = rolls.length, dur = Math.max(3, Math.min(16, n * 0.22));
    const steps = [[dur, (q, job) => {
      const lay = q * n, k = Math.min(n - 1, Math.floor(lay)), f = lay - k, R = rolls[k];
      const a = R.a0 + MM(LAWN.roll[0]) * f;
      this.view.setAnim('L' + r.id, { lay: q >= 1 ? 1e9 : lay, rollAt: q < 1 ? { a: Math.min(a, R.a1), b: R.b, y: r.g + MM(10 + 130 * (1 - f * 0.6)), yaw, s: 1 - f * 0.6 } : null });
      if (k !== job._k) { job._k = k; app.sfx?.stab?.(); }
    }]];
    this._lJob(r, 'grass', steps, `Рулонный газон: ${n} рулонов 2 × 0,4 м на ${f1(A)} м², швы вразбежку. Дальше «6 · Полив»`);
  }
  _lWater(r) {
    const app = this.app, { c, a0, a1, b0, b1 } = this._lExtent(r), am = (a0 + a1) / 2, bm = (b0 + b1) / 2, R = Math.max(a1 - a0, b1 - b0) / 2;
    const steps = [[4, (q) => {
      this.view.setAnim('L' + r.id, { water: q, wet: Math.min(1, q * 3), sprAt: q < 1 ? { a: MM(am), b: MM(bm), y: r.g + MM(10) } : null });
      const [x, z] = frameW(r, MM(am), MM(bm));
      for (let i = 0; i < 4; i++) { const ang = q * 40 + i * 1.57, v = 0.5 + Math.random() * 0.5; app.particles?.emit(new THREE.Vector3(x, r.g + MM(220), z), new THREE.Vector3(Math.cos(ang) * MM(R) * 1.4 * v, 0.25, Math.sin(ang) * MM(R) * 1.4 * v), 0, MM(6), 0, 0, 1); }
      if (Math.random() < 0.2) app.sfx?.pour?.(0.2);
    }]];
    void c;
    this._lJob(r, 'water', steps, r.how === 'seed' ? 'Полито — газон густой и зелёный. Готово' : 'Полито — рулоны укоренились, швы сомкнулись. Газон готов');
  }
  lawnNext(r = this.lawn) {
    if (!r) return ['area', 'Обведите место под газон'];
    const d = r.done || {};
    for (const k of LORDER.slice(1)) if (!d[k]) return [k, LNAME[k]];
    return [null, 'Газон готов'];
  }
  lawnStatus() {
    return {
      area: 'Обведите пальцем место под газон — контур замкнётся сам; дорожки, бассейн и бетон внутри обойдутся',
      soil: 'Коснитесь газона — завезут и разровняют плодородный грунт 100 мм',
      rake: 'Коснитесь газона — грабли выровняют грунт и уберут камни',
      roll: 'Коснитесь газона — садовый каток укатает грунт',
      grass: this.how === 'seed' ? 'Коснитесь газона — посев семян (взойдёт через три недели)' : 'Коснитесь газона — рулоны газона лягут ряд за рядом, швы вразбежку',
      water: 'Коснитесь газона — полив дождевателем',
    }[this.lawnLayer];
  }
  removeLawn(id) {
    if (!this.app.objects.get(id)) return;
    this._save('lawn-remove', () => this.app.objects.remove(id));
    this.toast('Газон убрали');
  }

  // ==== the plants ============================================================================
  _plantDown(p) {
    if (this.app.physJob) return true;
    const kind = this.plantKind, t = this.app.terrain;
    if (kind === 'hedge') { this.drag = { L: 'hedge', trail: [[p.x, p.z]] }; this.app.ui?.showMeasure?.('Ведите пальцем, где пройдёт живая изгородь'); return true; }
    if (!t.inside(p.x, p.z)) return true;
    const i = t.index(p.x, p.z);
    if (t.conc[i] > 1e-6 || this.app.objects.all('path').some((q) => inQuads(kerbOuter(q), p.x, p.z))) { this.toast('Сюда не посадить — бетон или дорожка. Выберите землю или газон'); return true; }
    this._plant({ kind, x: +p.x.toFixed(5), z: +p.z.toFixed(5), g: +t.heightAt(p.x, p.z).toFixed(6), s: +(0.85 + Math.random() * 0.3).toFixed(2), rot: +(Math.random() * 6.28).toFixed(2) });
    return true;
  }
  // each plant: the hole dug (the soil heaped beside it), the plant lowered in, the soil back round
  // it, then watered in and mulched
  _plant(rec) {
    const app = this.app, t = app.terrain, P = PLANTS[rec.kind], v = this.view, hedge = rec.kind === 'hedge';
    const spots = hedge ? hedgePlants(rec) : [[rec.x, rec.z]], R = MM(P.hole[0] / 2), D = MM(P.hole[1]);
    app.journal.begin('plant', {}, app.clock);
    const r = app.objects.add({ type: 'plant', ...rec }), key = 'P' + r.id;
    v.setAnim(key, { n: 0, drop: 600, mulch: 0 });
    const heaps = [], per = hedge ? 0.55 : 2.2, steps = [];
    spots.forEach(([x, z], k) => {
      const hx = x + R * 1.6, hz = z + R * 0.4, vol = Math.PI * R * R * D * 0.6;
      // (dug)
      steps.push([per * 0.35, (u) => {
        if (!heaps[k]) heaps[k] = t.heapStart(hx, hz, vol, Math.tan(37 * Math.PI / 180));
        t.scoop(x, z, R, rec.g - D * u, rec.g, () => true, k);
        t.heapTo(heaps[k], vol * u, M_SOIL);
        if (Math.random() < 0.4) app.particles?.emit(new THREE.Vector3(x, rec.g, z), new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.15, (Math.random() - 0.5) * 0.08), 0, MM(25), 0, 0, 0);
        if (Math.random() < 0.15) app.sfx?.stab?.();
      }]);
      // (lowered in)
      steps.push([per * 0.3, (u) => { const e = u * u * (3 - 2 * u); v.setAnim(key, { n: k + 1, drop: 600 * (1 - e) }); }]);
      // (the soil back from the heap into the hole, firmed by the boot)
      steps.push([per * 0.35, (u) => {
        const H = heaps[k];
        for (let j = 0; j < H.n; j++) { const want = H.cur[j] * (1 - u), d = (H.curNow?.[j] ?? H.cur[j]) - want; if (d > 1e-9) { t._pop(H.idx[j], d); (H.curNow || (H.curNow = Float64Array.from(H.cur)))[j] = want; } }
        const yb = rec.g - D * (1 - u) * 0.999, b = [x - R, z - R, x + R, z + R];
        const ix0 = Math.max(0, Math.floor(t.toCellX(b[0]))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(b[2]))), iz0 = Math.max(0, Math.floor(t.toCellZ(b[1]))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(b[3])));
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { if (Math.hypot(t.toWorldX(ix) - x, t.toWorldZ(iz) - z) > R * 1.05) continue; const i = iz * t.nx + ix, h = t.hAt(i); if (h < yb) t._push(i, yb - h, M_SOIL); }
        t._touch(ix0, iz0, ix1, iz1); t._touch(...H.box);
        if (u >= 1) { t.levelTo((wx, wz) => Math.hypot(wx - x, wz - z) < R * 1.05, rec.g, b); v.setAnim(key, { n: k + 1, drop: 0 }); }
      }]);
    });
    // watered in, then the bark round it
    const [cx, cz] = spots[Math.floor(spots.length / 2)];
    if (!P.light) steps.push([1, (u) => { for (let i = 0; i < 3; i++) { const [x, z] = spots[Math.floor(Math.random() * spots.length)]; app.particles?.emit(new THREE.Vector3(x + (Math.random() - 0.5) * R, rec.g + MM(500), z + (Math.random() - 0.5) * R), new THREE.Vector3(0, -0.3, 0), 0, MM(6), 0, 0, 1); } if (u < 1 && Math.random() < 0.2) app.sfx?.pour?.(0.2); }]);
    steps.push([P.light ? 0.1 : 0.6, (u) => v.setAnim(key, { n: 1e9, drop: 0, mulch: u })]);
    void cx; void cz;
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); v.setAnim(key, null); }, commit: () => {
      app.journal.commit(app.clock);
      v.setAnim(key, null);
      this.toast(P.light ? `${P.name}: установлен, кабель 12 В проложен в траншее — включится в сумерках` : hedge ? `Живая изгородь: ${spots.length} туй через 500 мм, полита, замульчирована корой` : `${P.name}: посажено с комом в яму ${P.hole[0]} × ${P.hole[1]} мм, полито, приствольный круг замульчирован корой${rec.kind === 'tree' ? ', две опоры с подвязкой' : ''}`);
    } });
  }
  plantStatus() {
    return { bollard: 'Коснитесь у дорожки — встанет светильник-столбик (кабель 12 В в траншее); ночью светит', spot: 'Коснитесь у дерева — грунтовый прожектор подсветит его снизу', tree: 'Коснитесь земли — посадится дерево с опорами', ball: 'Коснитесь земли — посадится самшит, стриженный шаром', thuja: 'Коснитесь земли — посадится туя «Смарагд»', hedge: 'Ведите пальцем — вдоль линии посадится живая изгородь из туй' }[this.plantKind];
  }
  removePlant(id) {
    if (!this.app.objects.get(id)) return;
    this._save('plant-remove', () => this.app.objects.remove(id));
    this.toast('Растение убрали');
  }

  // ==== the fence ==============================================================================
  _fencePick(p) {
    const all = this.app.objects.all('fence');
    if (!all.length) return null;
    let best = null, bd = Infinity;
    for (const r of all) for (let i = 1; i < r.pts.length; i++) {
      const [x0, z0] = r.pts[i - 1], [x1, z1] = r.pts[i], dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz, k = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.z - z0) * dz) / L2)), d = Math.hypot(x0 + dx * k - p.x, z0 + dz * k - p.z);
      if (d < bd) bd = d, best = r;
    }
    if (best) this.fsel = best.id;
    return best;
  }
  _fenceDown(p) {
    const L = this.fenceLayer;
    if (L === 'line') { this.drag = { L: 'fline', trail: [[p.x, p.z]] }; this.app.ui?.showMeasure?.('Ведите пальцем, где встанет забор'); return true; }
    const r = this._fencePick(p);
    if (!r) { this.toast('Сначала «1 · Разметка»: проведите пальцем линию забора'); return true; }
    if (this.app.physJob) return true;
    if (L === 'gate') { this._gate(r, p); return true; }
    const i = FORDER.indexOf(L), d = r.done || {};
    if (d[L]) { const [nk, nw] = this.fenceNext(r); this.toast(nk ? `${FNAME[L]} — уже сделано. Дальше «${FORDER.indexOf(nk) + 1} · ${nw}»` : 'Забор готов'); return true; }
    for (let k = 1; k < Math.min(i, 4); k++) if (!d[FORDER[k]]) { this.toast(`Сначала «${k + 1} · ${FNAME[FORDER[k]]}»`); return true; }
    ({ holes: () => this._fHoles(r), posts: () => this._fPosts(r), fill: () => this._fFill(r) })[L]?.();
    return true;
  }
  _fenceMove(p) {
    const d = this.drag, last = d.trail.at(-1);
    if (Math.hypot(p.x - last[0], p.z - last[1]) < MM(80)) return;
    d.trail.push([p.x, p.z]);
    const pts = fenceLine(d.trail) || [d.trail[0], [p.x, p.z]];
    const r = { pts, H: this.fenceH, kind: this.fenceKind, col: this.fenceCol, g: this._groundOf(pts) };
    this.view.setLiveFence(r);
    this.app.ui?.showMeasure?.(`Забор ${f1(fenceLength(r) / S / 1000)} м, ${postsOf(r).length} столбов — отпустите, где он кончается`);
  }
  _fenceUp() {
    const app = this.app, d = this.drag;
    this.drag = null;
    this.view.setLiveFence(null); app.ui?.hideMeasure?.();
    const pts = fenceLine(d.trail);
    if (!pts) { this.toast('Забор короче метра — ведите пальцем длиннее'); return; }
    const rec = { type: 'fence', pts, H: this.fenceH, kind: this.fenceKind, col: this.fenceCol, g: +this._groundOf(pts).toFixed(6), done: {} };
    this._save('fence-line', () => { const o = app.objects.add(rec); this.fsel = o.id; });
    this.toast(`Забор ${f1(fenceLength(rec) / S / 1000)} м, высота ${f1(rec.H / 1000)} м: шнур натянут, места ${postsOf(rec).length} столбов отмечены. Дальше «2 · Ямы под столбы»`);
  }
  // each hole bored with the auger: the screw going down turning, the soil thrown up round it
  _fHoles(r) {
    const app = this.app, t = app.terrain, P = postsOf(r), per = 0.55, R = MM(FENCE.hole / 2), y = r.g - MM(FENCE.holeDepth);
    app.journal.begin('fence-holes', {}, app.clock);
    const done = new Set();
    const steps = [[P.length * per, (u) => {
      const q = u * P.length, k = Math.min(P.length - 1, Math.floor(q)), f = q - k, [x, z] = P[k];
      for (let i = 0; i < k; i++) if (!done.has(i)) { done.add(i); const [hx, hz] = P[i]; t.scoop(hx, hz, R * 1.15, y, r.g, () => true, i); }
      const dep = Math.min(1, f / 0.8);
      t.scoop(x, z, R * 1.15, r.g - (r.g - y) * dep, r.g, () => true, k);
      this.view.setAnim('F' + r.id, { augerAt: u < 1 ? { x, z, y: r.g - MM(FENCE.holeDepth) * dep + MM(40), spin: q * 40 } : null });
      if (Math.random() < 0.5 && f < 0.85) app.particles?.emit(new THREE.Vector3(x, r.g + MM(30), z), new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.1, (Math.random() - 0.5) * 0.15), 0, MM(20), 0, 0, 0);
      app.sfx?.engine?.('fence-auger', u < 1 ? 0.6 : 0);
      if (u >= 1) for (let i = 0; i < P.length; i++) { const [hx, hz] = P[i]; t.scoop(hx, hz, R * 1.15, y, r.g, () => true, i); }
    }]];
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); this.view.setAnim('F' + r.id, null); app.sfx?.engine?.('fence-auger', 0); }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), holes: 1 } });
      app.journal.commit(app.clock);
      this.view.setAnim('F' + r.id, null);
      app.sfx?.engine?.('fence-auger', 0);
      this.toast(`Пробурено ${P.length} ям Ø 200 глубиной 1 м. Дальше «3 · Столбы»`);
    } });
  }
  // the posts stood in the holes one by one, plumbed to the string, concreted
  _fPosts(r) {
    const app = this.app, t = app.terrain, P = postsOf(r), R = MM(FENCE.hole / 2 + 30);
    app.journal.begin('fence-posts', {}, app.clock);
    const filled = new Set();
    const steps = [[Math.max(2, P.length * 0.3), (u, job) => {
      const n = u * (P.length + 1);
      this.view.setAnim('F' + r.id, { posts: u >= 1 ? 1e9 : n });
      for (let i = 0; i < Math.min(P.length, Math.floor(n - 0.5)); i++) if (!filled.has(i)) {
        filled.add(i);
        const [x, z] = P[i], box = [x - R, z - R, x + R, z + R];
        t.levelTo((wx, wz) => Math.hypot(wx - x, wz - z) < R, r.g, box);
        if (job) app.sfx?.stab?.();
      }
      if (u >= 1) for (let i = 0; i < P.length; i++) { const [x, z] = P[i]; t.levelTo((wx, wz) => Math.hypot(wx - x, wz - z) < R, r.g, [x - R, z - R, x + R, z + R]); }
    }]];
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); this.view.setAnim('F' + r.id, null); }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), posts: 1 } });
      app.journal.commit(app.clock);
      this.view.setAnim('F' + r.id, null);
      this.toast(`${P.length} столбов 60 × 60 выставлены по шнуру и уровню и забетонированы. Дальше «4 · Заполнение»`);
    } });
  }
  _fFill(r) {
    const app = this.app, kind = this.fenceKind, col = this.fenceCol;
    app.journal.begin('fence-fill', {}, app.clock);
    if (r.kind !== kind || r.col !== col) app.objects.update(r.id, { kind, col });
    const rr = app.objects.get(r.id), n = fillCount(rr), ng = (rr.gates || []).length, Kn = FENCE_KINDS[kind].name;
    const steps = [[Math.max(2.5, Math.min(14, n * (kind === 'mesh' || kind === 'chain' ? 0.45 : 0.06))), (u, job) => {
      const k = u * (n + 1);
      this.view.setAnim('F' + r.id, { fill: u >= 1 ? 1e9 : k });
      if (Math.floor(k) !== job._k) { job._k = Math.floor(k); app.sfx?.stab?.(); }
    }]];
    // (the gates' leaves hung after it, each lowered onto its hinges and tried once)
    (rr.gates || []).forEach((q, gi) => { if (!q.hung) steps.push(...this._hang(r, gi)); });
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); this.view.setAnim('F' + r.id, null); }, commit: () => {
      const cur = app.objects.get(r.id);
      app.objects.update(r.id, { done: { ...(cur.done || {}), fill: 1 }, gates: (cur.gates || []).map((q) => ({ ...q, hung: 1 })) });
      app.journal.commit(app.clock);
      this.view.setAnim('F' + r.id, null);
      this.toast(`${Kn}: ${n} элементов${ng ? `, ворот и калиток: ${ng}` : ''} — забор готов`);
    } });
  }
  // a gate's leaves going on: lowered onto the hinges (or the rollers), then opened and closed once
  _hang(r, gi) {
    const app = this.app, key = 'F' + r.id;
    return [[1.0, (u, job) => { this.view.setAnim(key, { gate: gi, gu: u, gopen: 0 }); if (u > 0.9 && !job['_g' + gi]) { job['_g' + gi] = 1; app.sfx?.stab?.(); } }],
      [1.6, (u) => this.view.setAnim(key, { gate: gi, gu: 1, gopen: Math.sin(Math.PI * u) })],
      [0, () => this.view.setAnim(key, { gate: null })]];
  }
  // «Ворота и калитки»: a touch on the fence puts the chosen one there (the posts each side 100 × 100);
  // a touch on a gate already there opens or closes it
  _gate(r, p) {
    const app = this.app, [s, off] = sOf(r, p.x, p.z), gates = r.gates || [];
    const hit = gates.findIndex((q) => Math.abs(q.s - s) < q.w / 2 + 100);
    if (hit >= 0) {
      if (!gates[hit].hung && !(r.done || {}).fill) { this.toast('Створки повесят с заполнением забора («4 · Заполнение»)'); return; }
      const open = !gates[hit].open;
      this._save('gate-open', () => app.objects.update(r.id, { gates: gates.map((q, i) => (i === hit ? { ...q, open } : q)) }));
      this.toast(open ? `${GATES[gates[hit].type].name}: открыто` : `${GATES[gates[hit].type].name}: закрыто`);
      return;
    }
    if (off > MM(1500)) { this.toast('Коснитесь линии забора — там, где будут ворота или калитка'); return; }
    const T = GATES[this.gateType], c = gateFit(r, s, T.w);
    if (c == null) { this.toast(`Здесь не помещается: ${T.name.toLowerCase()} — ${T.w / 1000} м по прямой, от угла и других ворот`.replace(/(\d)\.(\d)/g, '$1,$2')); return; }
    const d = r.done || {}, gi = gates.length, rec = { s: c, w: T.w, type: this.gateType, open: false, hung: d.fill ? 1 : 0 };
    app.journal.begin('gate', {}, app.clock);
    app.objects.update(r.id, { gates: [...gates, rec] });
    // (the fence is up: the two gate posts set (the posts re-spaced round them), the leaves hung and tried)
    const steps = d.fill ? this._hang(r, gi) : [[0.3, () => {}]];
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); this.view.setAnim('F' + r.id, null); }, commit: () => {
      app.journal.commit(app.clock); this.view.setAnim('F' + r.id, null);
      this.toast(d.fill ? `${T.name} ${T.w / 1000} м: столбы 100 × 100 забетонированы, створки навешены и опробованы. Коснитесь ворот — открыть или закрыть` : d.posts ? `${T.name} ${T.w / 1000} м размечены: столбы 100 × 100 по краям; створки повесят с заполнением` : `${T.name} ${T.w / 1000} м размечены — по краям встанут столбы 100 × 100`);
    } });
  }
  fenceNext(r = this.fence) {
    if (!r) return ['line', 'Проведите линию забора'];
    const d = r.done || {};
    for (const k of FORDER.slice(1, 4)) if (!d[k]) return [k, FNAME[k]];
    return [null, 'Забор готов'];
  }
  fenceStatus() {
    return {
      line: `Ведите пальцем, где встанет забор высотой ${f1(this.fenceH / 1000)} м — углы по ходу пальца`,
      holes: 'Коснитесь забора — мотобур пробурит ямы под столбы',
      posts: 'Коснитесь забора — столбы встанут по шнуру и забетонируются',
      fill: `Коснитесь забора — заполнение «${FENCE_KINDS[this.fenceKind].name}», пролёт за пролётом; ворота и калитки — навешены`,
      gate: `Коснитесь линии забора — встанут «${GATES[this.gateType].name}»; коснитесь готовых ворот — открыть или закрыть`,
    }[this.fenceLayer];
  }
  removeFence(id) {
    if (!this.app.objects.get(id)) return;
    this._save('fence-remove', () => this.app.objects.remove(id));
    this.toast('Забор убрали');
  }

  remove(id) {
    const app = this.app;
    if (!app.objects.get(id)) return;
    this._save('path-remove', () => app.objects.remove(id));
    this.toast('Дорожку убрали (грунт и слои остались как есть)');
  }
}
