import * as THREE from 'three';
import { MODEL_SCALE, TRAY, M_G20, M_SAND } from '../config.js';
import { uStrength } from './lintels.js';
import { FitJob, hammer, part, at, M as MMf } from './fitJob.js';
import { buildMosaic, buildCoping } from '../world/poolView.js';
import {
  POOL, POOL_LAYERS, MOSAICS, COPES, DECKS, DECK_WIDTHS, deckRing, fillBand, worldBox, newPool, poolFits, pitOutline, pitBox, floorBelt, wallBelt, floorCage, wallCage, faces, cellsOf, sheetsOf, sheetRect, faceStr,
  copeLayout, hitInner, hitRim, hitGround, slabRect, pitRect, PW, PF, wallTopY, waterMax, isPoolBelt, floorTopY, rimY,
} from '../world/pool.js';

// The pool done by the finger (pool.js): «Бассейн» → its stages one after the other. The pit,
// the crushed stone, the lean concrete and the concrete are done with the tools of the house
// (Земля, Материалы, Бетон); here: setting it out, the formwork, the cages, stripping, the
// coating, the mosaic, the coping, the water, the lights.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
const NAME = Object.fromEntries(POOL_LAYERS);
const BRUSH = 230;            // the coating brush (a roller 250 wide)
const FILL = 45, DRAIN = 70;  // mm a second (the game's garden hose and pump: 12× real)

export class PoolWork {
  constructor(app) { this.app = app; this.drag = null; this.sel = null; }
  get layer() { return NAME[this.app.settings.poolLayer] ? this.app.settings.poolLayer : 'pit'; }
  get mos() { return MOSAICS[this.app.settings.poolMos] ? this.app.settings.poolMos : 'turq'; }
  get copeCol() { return COPES[this.app.settings.poolCope] ? this.app.settings.poolCope : 'trav'; }
  get rec() { const all = this.app.objects.all('pool'); return all.find((r) => r.id === this.sel) || all.at(-1) || null; }
  // the pool at a point: the one whose pit it is in, else the nearest
  pick(p) {
    const all = this.app.objects.all('pool');
    if (!p || !all.length) return this.rec;
    let best = null, bd = Infinity;
    for (const r of all) { const [x0, z0, x1, z1] = pitBox(r), d = Math.hypot(Math.max(0, x0 - p.x, p.x - x1), Math.max(0, z0 - p.z, p.z - z1)); if (d < bd) bd = d, best = r; }
    if (best) this.sel = best.id;
    return best;
  }
  _rayOf(e) { if (!e || e.clientX === undefined) return null; _ray.setFromCamera(this.app.gestures.ndc(e.clientX, e.clientY), this.app.camera); return _ray.ray; }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  _live(l) { this.app.poolView?.setLive(l); }
  _belts(r) { const O = this.app.objects; return { fb: r.floor != null ? O.get(r.floor) : null, wb: r.wall != null ? O.get(r.wall) : null }; }
  toast(m) { this.app.ui?.toast(m); }
  // a piece put in (its record already in) shown going in bit by bit: the cage bar by bar, the
  // formwork board by board (view.reveal = { id, u }); then done()
  _grow(view, id, dur, done = null) {
    const app = this.app, mark = () => { view.dirty = true; app.poolView.dirty = true; };
    new FitJob(app, { steps: [[dur, (u) => { view.reveal = { id, u }; mark(); if (u < 1 && Math.random() < 0.12) app.sfx?.stab?.(); }]], parts: [], cleanup: () => { view.reveal = null; mark(); }, commit: done });
  }
  // a smooth way round: points [s, t] (mm, the pool's frame), the way's length; at(d) → { s, t, yaw }
  // (yaw: the heading in the world, as the plate takes it)
  _path(r, pts) {
    const seg = [], L = [0];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L.push(L[i - 1] + d); }
    const total = L.at(-1);
    const at = (d) => {
      d = Math.max(0, Math.min(total - 1e-6, d));
      let i = 0; while (i < seg.length - 1 && L[i + 1] < d) i++;
      const u = (d - L[i]) / (seg[i] || 1), [a0, b0] = pts[i], [a1, b1] = pts[i + 1], ds = a1 - a0, dt = b1 - b0;
      // (the heading turns over the last and first 250 mm of a leg: no snap at the corners)
      const h = (k) => { const [p0, q0] = pts[k], [p1, q1] = pts[k + 1]; return [p1 - p0, q1 - q0]; };
      let [hs, ht] = [ds, dt];
      if (i < seg.length - 1 && L[i + 1] - d < 250) { const w = 0.5 - (L[i + 1] - d) / 500, [n0, n1] = h(i + 1); hs = hs / seg[i] * (1 - w) + n0 / seg[i + 1] * w; ht = ht / seg[i] * (1 - w) + n1 / seg[i + 1] * w; }
      else if (i > 0 && d - L[i] < 250) { const w = 0.5 - (d - L[i]) / 500, [p0, p1] = h(i - 1); hs = hs / seg[i] * (1 - w) + p0 / seg[i - 1] * w; ht = ht / seg[i] * (1 - w) + p1 / seg[i - 1] * w; }
      const wx = r.u[0] * hs - r.u[1] * ht, wz = r.u[1] * hs + r.u[0] * ht;
      return { s: a0 + ds * u, t: b0 + dt * u, yaw: Math.atan2(wx, wz) };
    };
    return { at, total };
  }

  down(p, e) {
    const app = this.app, L = this.layer;
    if (L === 'pit') {
      const ray = this._rayOf(e), q = (ray && hitGround(ray, TRAY.soil)) || p;
      const near = app.objects.all('pool').find((r) => { const [x0, z0, x1, z1] = pitBox(r); return q.x > x0 && q.x < x1 && q.z > z0 && q.z < z1; });
      if (near) { this.sel = near.id; this.toast(this.status(false)); return true; }
      this.drag = { L, q, a: q.clone() };
      this._ghost(q, q);
      return true;
    }
    const r = this.pick(p);
    if (!r) { this.toast('Сначала «1 · Разметка»: коснитесь места бассейна на участке'); return true; }
    const { fb, wb } = this._belts(r);
    if (L === 'dig') return this._dig(r, fb), true;
    if (L === 'bed') return this._bed(r, fb), true;
    if (L === 'form1') return this._form1(r, fb), true;
    if (L === 'cage1') return this._cage1(r, fb), true;
    if (L === 'cage2') return this._cage2(r, fb), true;
    if (L === 'form2') return this._form2(r, fb, wb), true;
    if (L === 'strip') return this._strip(r, fb, wb), true;
    if (L === 'fill') return this._fill(r, fb, wb), true;
    if (L === 'base') return this._base(r), true;
    if (L === 'deck') return this._deck(r), true;
    if (L === 'light') {
      if (!wb) { this.toast('Прожекторы ставятся в опалубку стен вместе с закладными'); return true; }
      const on = !r.light;
      this._save('pool-light', () => app.objects.update(r.id, { light: on }));
      this.toast(on ? 'Подсветка включена — в сумерках и ночью вода засветится' : 'Подсветка выключена');
      return true;
    }
    // the work inside the bowl: after the walls are stripped
    if (!wb || !wb.stripped) { this.toast(!wb ? 'Сначала чаша: днище, стены, бетон' : !(wb.fill >= 0.95) ? 'Стены ещё не залиты бетоном' : 'Сначала снимите опалубку стен («Снять опалубку»)'); return true; }
    const live = JSON.parse(JSON.stringify(r));
    if (L === 'proof') { this.drag = { L, live, touched: new Set() }; this._paint(e); }
    else if (L === 'tile') { this.drag = { L, live, said: false }; this._tile(e); }
    else if (L === 'cope') { live.copeCol = this.copeCol; this.drag = { L, live }; this._cope(e); }
    else if (L === 'water') {
      if (app.settings.poolWater === 'drain' && !(r.water > 1)) { this.toast('Воды в чаше нет'); return true; }
      this.drag = { L, live, t: 0 };
      app.poolView.fillAt = { id: r.id, on: app.settings.poolWater !== 'drain', show: true };
      this.toast(app.settings.poolWater === 'drain' ? 'Насос откачивает воду — держите палец' : (r.tile || []).some((s) => /[a-z]/.test(s)) ? 'Шланг в чаше — держите палец, вода набирается' : 'Шланг в чаше — держите палец: вода на испытание герметичности чаши (до плитки её сливают)');
    }
    this._live(live);
    return true;
  }

  move(p, e) {
    const d = this.drag; if (!d) return;
    if (d.L === 'pit') { const ray = this._rayOf(e), q = (ray && hitGround(ray, TRAY.soil)) || p; d.q = q; this._ghost(q, d.a); return; }
    if (d.L === 'proof') this._paint(e);
    else if (d.L === 'tile') { d.moved = true; this._tile(e); }
    else if (d.L === 'cope') this._cope(e);
  }

  update(dt) {
    const d = this.drag; if (!d || d.L !== 'water') return;
    const r = d.live, max = waterMax(r), drain = this.app.settings.poolWater === 'drain';
    const lv = Math.max(0, Math.min(max, (r.water || 0) + (drain ? -DRAIN : FILL) * dt));
    if (lv !== r.water) { r.water = lv; this._live(r); }
    if (!drain && lv >= max && !d.full) { d.full = true; this.toast('Вода на 100 мм ниже борта — середина скиммеров. Отпустите'); }
    this.app.sfx?.scrapeLevel?.(0);
  }

  up() {
    const app = this.app, d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.L === 'pit') {
      this._live(null);
      app.ui?.hideMeasure?.();
      const { rec, snapped } = newPool(app, d.q, !!app.settings.poolTurn, d.a);
      const why = poolFits(app, rec);
      if (why) { this.toast(why); return; }
      this._save('pool-set-out', () => { const out = app.objects.add(pitOutline(rec)); const pr = app.objects.add({ ...rec, pit: out.id }); this.sel = pr.id; app.objects.update(out.id, { poolId: pr.id }); });
      this.toast(`Бассейн ${rec.L / 1000} × ${rec.W / 1000} м${snapped ? ' — по проекту' : ''}: размечен котлован ${((rec.L + 1700) / 1000).toFixed(1)} × ${((rec.W + 1700) / 1000).toFixed(1)} м глубиной 1,85 м. Дальше «2 · Котлован» — выкопается по разметке (или копайте сами: «Земля», погрузчик), потом «3 · Щебень и подбетонка»`.replace(/(\d)\.(\d)/g, '$1,$2'));
      return;
    }
    const r = d.live, id = r.id;
    if (d.L === 'water') {
      app.poolView.fillAt = { id, on: false, show: false };
      const lv = Math.round(r.water || 0);
      this._save('pool-water', () => app.objects.update(id, { water: lv }));
      this._live(null);
      this.toast(lv > 1 ? `Вода: ${(lv / 1000).toFixed(2).replace('.', ',')} м${lv >= waterMax(r) - 1 ? ' — полная чаша' : ''}` : 'Чаша пустая');
      return;
    }
    const patch = d.L === 'proof' ? { proof: r.proof } : d.L === 'tile' ? { tile: r.tile } : { cope: r.cope, copeCol: r.copeCol };
    const done = () => {
      this._save('pool-' + d.L, () => app.objects.update(id, patch));
      const msg = this._progress(app.objects.get(id), d.L);
      if (msg) this.toast(msg);
    };
    this._live(null);
    // the sheets of mosaic, the stones of the coping: fitted as on site (fitJob.js), then saved
    const old = app.objects.get(id);
    if (d.L === 'tile') this._fitSheets(r, old, done);
    else if (d.L === 'cope') this._fitStones(r, old, done);
    else done();
  }

  interrupt() { if (!this.drag) return; if (this.drag.L === 'water') this.app.poolView.fillAt = null; if (this.drag.L === 'pit') this.app.ui?.hideMeasure?.(); this.drag = null; this._live(null); }

  // ---- setting out ----------------------------------------------------------------------------
  _ghost(q, a = null) {
    const app = this.app, { rec, snapped } = newPool(app, q, !!app.settings.poolTurn, a);
    this._live(rec);
    const why = poolFits(app, rec);
    app.ui?.showMeasure?.(why || `Бассейн ${rec.L / 1000} × ${rec.W / 1000} м${snapped ? ' · по проекту' : ''} — тяните пальцем, чтобы задать размер`.replace(/(\d)\.(\d)/g, '$1,$2'));
  }

  // ---- the bowl ---------------------------------------------------------------------------------
  // the bottom slab's edge boards on the lean concrete: where it is (its top measured there)
  // the pit dug (or trimmed) to its outline: strip by strip, the walls straight down, the
  // floor level at −1,85 (what is dug out goes away by truck)
  _dig(r, fb) {
    const app = this.app, t = app.terrain;
    if (fb) { this.toast('Котлован уже готов — днище стоит'); return; }
    const [s0, t0, s1, t1] = pitRect(r), y = r.g - MM(POOL.pitDepth), layers = 3, steps = [];
    const inPit = (x, z) => { const [s, tt] = PF(r, x, z); return s >= s0 && s <= s1 && tt >= t0 && tt <= t1; };
    const box = pitBox(r), before = t.totalVolume(), dir = new THREE.Vector2(r.u[0], r.u[1]);
    app.journal.begin('pool-dig', {}, app.clock);
    // (dug as on site: layer by layer, bite after bite — each a rounded hollow with a ragged rim, the
    // bites overlapping, back and forth over the pit; the walls cut straight and the floor trimmed
    // level only at the end. Each bite the spade goes in, the soil flies up out of the pit)
    const sh = app.shovel, vis = sh.root.visible, R = 1250, SP = 1350, rr = Math.random;
    // (the bites one after the other, each going down over its own short time, several at once:
    // the hole deepens smoothly, never a jump; the spade is not shown — at this pace it would only flicker)
    const ns = Math.ceil((s1 - s0) / SP), nt = Math.ceil((t1 - t0) / SP), bites = [];
    for (let L = 0; L < layers; L++) {
      const yT = r.g - MM(POOL.pitDepth) * L / layers, yL = r.g - MM(POOL.pitDepth) * (L + 1) / layers - MM(L === layers - 1 ? 0 : 60);
      for (let j = 0; j <= nt; j++) for (let i0 = 0; i0 <= ns; i0++) {
        const i = (j + L) % 2 ? ns - i0 : i0;
        const bs = s0 + (s1 - s0) * i / ns + (rr() - 0.5) * SP * 0.8, bt = t0 + (t1 - t0) * j / nt + (rr() - 0.5) * SP * 0.8;
        const [x, z] = PW(r, Math.max(s0, Math.min(s1, bs)), Math.max(t0, Math.min(t1, bt)));
        bites.push({ x, z, R: MM(R * (0.8 + rr() * 0.45)), deep: yL - MM(rr() * 80), yT, seed: rr() * 6.28, p: 0 });
      }
    }
    const step = 0.045, life = 0.3, T = bites.length * step + life;
    steps.push([0, () => { sh.root.visible = false; }]);
    steps.push([T, (u) => {
      const now = u * T;
      for (let k = 0; k < bites.length; k++) {
        const b = bites[k], p = Math.max(0, Math.min(1, (now - k * step) / life));
        if (p <= b.p) continue;
        b.p = p;
        const e = p * p * (3 - 2 * p);
        t.scoop(b.x, b.z, b.R, b.yT + (b.deep - b.yT) * e, b.yT, inPit, b.seed);
        // (the soil thrown out of it as it goes down)
        if (p < 1 && rr() < 0.5) { const out = new THREE.Vector3(-r.u[1], 0, r.u[0]).multiplyScalar(rr() < 0.5 ? 1 : -1); app.particles?.emit(new THREE.Vector3(b.x + (rr() - 0.5) * b.R, b.yT, b.z + (rr() - 0.5) * b.R), new THREE.Vector3(out.x * (0.08 + rr() * 0.06), 0.2 + rr() * 0.15, out.z * (0.08 + rr() * 0.06)), 0, MM(30 + rr() * 50), 0, 0, 0); }
      }
      if (rr() < 0.15) app.sfx?.stab?.();
    }]);
    steps.push([0, () => { sh.root.visible = vis; }]);
    // (the loose topsoil round the edge taken off with it: it would slide in off the walls)
    steps.push([0.1, (u) => {
      if (u < 1) return;
      const e = 700, [a0, b0, a1, b1] = [s0 - e, t0 - e, s1 + e, t1 + e], bx = [box[0] - MM(e), box[1] - MM(e), box[2] + MM(e), box[3] + MM(e)];
      const ix0 = Math.max(0, Math.floor(t.toCellX(bx[0]))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(bx[2]))), iz0 = Math.max(0, Math.floor(t.toCellZ(bx[1]))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(bx[3])));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const [s, tt] = PF(r, t.toWorldX(ix), t.toWorldZ(iz)); if (s < a0 || s > a1 || tt < b0 || tt > b1) continue;
        const i = iz * t.nx + ix; if (t.conc[i] > 1e-6 || !(t.loose[i] > 0)) continue;
        t.loose[i] = 0; t.lN[i] = 0; for (let q = 0; q < 3; q++) t.lH[i * 3 + q] = 0;
      }
      t._touch(ix0, iz0, ix1, iz1);
      t.levelTo((x, z) => { const [ss, tt] = PF(r, x, z); return ss >= s0 && ss <= s1 && tt >= t0 && tt <= t1; }, y, box);
    }]);
    new FitJob(app, { steps, parts: [], onAbort: () => app.journal.cancel(), commit: () => {
      app.journal.commit(app.clock);
      const out = Math.max(0, before - t.totalVolume()) * MODEL_SCALE ** 3;
      this.toast(`Котлован ${((s1 - s0) / 1000).toFixed(1)} × ${((t1 - t0) / 1000).toFixed(1)} м, глубина 1,85 м — вынуто ${out.toFixed(1)} м³ (вывезено самосвалом). Стенки зачищены лопатой отвесно. Дальше «3 · Щебень и подбетонка»`.replace(/(\d)\.(\d)/g, '$1,$2'));
    } });
  }
  // the bed under the bowl: crushed stone 20–40, 200 mm, rammed with the plate compactor; then
  // 100 mm of lean concrete (подбетонка: a thin plain concrete over the stone — a clean, level
  // base for the slab's bars and its formwork)
  _bed(r, fb) {
    const app = this.app, t = app.terrain;
    if (fb) { this.toast('Основание уже готово — днище стоит'); return; }
    const [s0, t0, s1, t1] = pitRect(r), box = pitBox(r), y0 = r.g - MM(POOL.pitDepth);
    const inPit = (x, z) => { const [s, tt] = PF(r, x, z); return s >= s0 && s <= s1 && tt >= t0 && tt <= t1; };
    // (dug deep enough? the middle of the pit's floor)
    const [cx, cz] = PW(r, r.L / 2, r.W / 2), have = Math.round((r.g - t.nat[t.index(cx, cz)]) / S);   // (dug in the native ground: what crumbled in off the edges is cleared with it)
    if (have < POOL.pitDepth - 150) { this.toast(`Котлован ещё мелкий: ${have} мм из 1850 — «2 · Котлован» (или докопайте лопатой)`); return; }
    const cells = (f) => { const ix0 = Math.max(0, Math.floor(t.toCellX(box[0]))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(box[2]))), iz0 = Math.max(0, Math.floor(t.toCellZ(box[1]))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(box[3]))); for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const x = t.toWorldX(ix), z = t.toWorldZ(iz); if (inPit(x, z)) f(iz * t.nx + ix, x, z); } t._touch(ix0, iz0, ix1, iz1); };
    app.journal.begin('pool-bed', {}, app.clock);
    const steps = [], n = 10;
    // the floor trimmed level, then the stone: tipped into the pit in heaps (each where a barrow of
    // it is dumped — a cone at its slope), then raked out level, 200 mm, lane by lane
    steps.push([0.2, (u) => { if (u >= 1) t.levelTo(inPit, y0, box); }]);
    const area = (s1 - s0) * (t1 - t0) * S * S, vol = area * MM(POOL.gravel), nH = 6, heaps = [];
    for (let h = 0; h < nH; h++) {
      const [hx, hz] = PW(r, s0 + (s1 - s0) * (h % 3 + 0.5) / 3, t0 + (t1 - t0) * (Math.floor(h / 3) + 0.5) / 2);
      steps.push([0.45, (u) => {
        if (!heaps[h]) heaps[h] = t.heapStart(hx, hz, vol / nH, Math.tan(39 * Math.PI / 180));
        t.heapTo(heaps[h], vol / nH * u, M_G20);
        if (Math.random() < 0.7) app.particles?.emit(new THREE.Vector3(hx, y0 + MM(1200), hz), new THREE.Vector3((Math.random() - 0.5) * 0.02, -0.15, (Math.random() - 0.5) * 0.02), 0, MM(20 + Math.random() * 25), 0, 0, 3);
        if (u < 1 && Math.random() < 0.25) app.sfx?.pour?.(0.4);
      }]);
    }
    // (the rake: across the pit, lane after lane; behind it the stone lies level at 200 mm)
    const rk = app.rake, rvis = rk.root.visible, lanes = 4, rpos = rk.target.pos.clone(), rdir = rk.target.dir.clone(), rlift = rk.target.lift;
    steps.push([0, () => { rk.root.visible = true; }]);
    for (let k = 0; k < lanes; k++) steps.push([0.55, (u) => {
      const tt = t0 + (t1 - t0) * (k + 0.5) / lanes, ss = s0 + (s1 - s0) * (k % 2 ? 1 - u : u), [x, z] = PW(r, ss, tt);
      rk.setPose({ pos: new THREE.Vector3(x, y0 + MM(POOL.gravel) + MM(10), z), dir: new THREE.Vector2(-r.u[1], -r.u[0]), lift: 0.55 }, u === 0);
      // (what the rake has passed over: the lane level)
      const a = k % 2 ? ss : s0 - 1, b = k % 2 ? s1 + 1 : ss, lo = t0 + (t1 - t0) * k / lanes, hi = t0 + (t1 - t0) * (k + 1) / lanes;
      cells((i, cx, cz) => { const [s2, t2] = PF(r, cx, cz); if (s2 >= a && s2 <= b && t2 >= lo && t2 <= hi) { const want = MM(POOL.gravel); if (Math.abs(t.loose[i] - want) > 1e-7) { if (t.loose[i] > want) t._pop(i, t.loose[i] - want); else t._push(i, want - t.loose[i], M_G20); } } });
    }]);
    steps.push([0, () => { rk.setPose({ pos: rpos, dir: rdir, lift: rlift }, true); rk.root.visible = rvis; }]);
    // the plate over it: lane after lane on a serpentine (it heads where it goes, turns at the ends);
    // the stone rammed where it has passed
    { const lanes = 6, pts = [], m = 250;
      for (let k = 0; k < lanes; k++) { const tt = t0 + (t1 - t0) * (k + 0.5) / lanes; if (k % 2) pts.push([s1 - m, tt], [s0 + m, tt]); else pts.push([s0 + m, tt], [s1 - m, tt]); }
      const path = this._path(r, pts), yP = y0 + MM(POOL.gravel), wide = MM(450);
      steps.push([path.total / 1000 * 0.11, (u) => {
        const q = path.at(u * path.total), [x, z] = PW(r, q.s, q.t);
        app.concreteGear.plateOn = true; app.concreteGear.set('plate', new THREE.Vector3(x, yP, z), q.yaw, u === 0);
        const ix0 = Math.max(0, Math.floor(t.toCellX(x - wide))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(x + wide))), iz0 = Math.max(0, Math.floor(t.toCellZ(z - wide))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(z + wide)));
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) if (Math.hypot(t.toWorldX(ix) - x, t.toWorldZ(iz) - z) < wide && inPit(t.toWorldX(ix), t.toWorldZ(iz))) t.comp[iz * t.nx + ix] = 1;
        t._touch(ix0, iz0, ix1, iz1);
        if (u >= 1) { cells((i) => { t.comp[i] = 1; }); app.concreteGear.plateOn = false; app.concreteGear.set(null); }
      }]);
    }
    // the lean concrete: 100 over the stone, poured from one end to the other — the hose at the
    // front, the grey running out ahead of it and levelling behind
    { const lean = MM(POOL.lean), ix0 = Math.max(0, Math.floor(t.toCellX(box[0]))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(box[2]))), iz0 = Math.max(0, Math.floor(t.toCellZ(box[1]))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(box[3])));
      const list = []; cells((i, x, z) => { const [ss, tt] = PF(r, x, z); list.push([i, ss, tt]); });
      steps.push([0, () => app.concreteGear.set('hose', new THREE.Vector3(...(() => { const [x, z] = PW(r, s0, (t0 + t1) / 2); return [x, y0 + MM(POOL.gravel), z]; })()), 0, true)]);
      steps.push([2.4, (u) => {
        const front = s0 - 600 + (s1 - s0 + 1200) * u;
        for (const [i, ss, tt] of list) {
          // (thickest behind the front, a tongue running out ahead of it; never more than 100)
          const k = Math.max(0, Math.min(1, (front - ss) / 900 + 0.12 * Math.sin(tt * 0.004 + ss * 0.002)));
          const want = lean * k; if (want > t.conc[i]) { t.conc[i] = want; t.cTime[i] = app.clock; t.cSm[i] = 0.6; t.cBase[i] = 0; }
        }
        t._touch(ix0, iz0, ix1, iz1);
        const sw = Math.sin(u * Math.PI * 7) * (t1 - t0) * 0.38, [x, z] = PW(r, Math.max(s0, Math.min(s1, front - 300)), (t0 + t1) / 2 + sw);
        app.concreteGear.set('hose', new THREE.Vector3(x, y0 + MM(POOL.gravel) + lean, z));
        if (u >= 1) { for (const [i] of list) { t.conc[i] = lean; t.cTime[i] = app.clock; t.cSm[i] = 0.6; t.cBase[i] = 0; } t._touch(ix0, iz0, ix1, iz1); app.concreteGear.set(null); }
        if (Math.random() < 0.2) app.sfx?.pour?.(0.4);
      }]);
    }
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); app.concreteGear.set(null); rk.setPose({ pos: rpos, dir: rdir, lift: rlift }, true); rk.root.visible = rvis; }, commit: () => {
      app.journal.commit(app.clock);
      this.toast('Щебень 20–40 слоем 200 мм утрамбован виброплитой, сверху подбетонка 100 мм — ровное чистое основание на отметке −1,55 м. Дальше «4 · Опалубка днища»');
    } });
  }

  _form1(r, fb) {
    const app = this.app, t = app.terrain;
    if (fb) { this.toast(fb.fill > 0.05 ? 'Днище уже залито — дальше «6 · Арматура стен»' : 'Опалубка днища уже стоит — дальше «5 · Арматура днища»'); return; }
    // the bed: the middle height of the pit's floor under the slab (crushed stone, lean concrete)
    const [s0, t0, s1, t1] = slabRect(r), hs = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 6; j++) { const [x, z] = PW(r, s0 + (s1 - s0) * i / 12, t0 + (t1 - t0) * j / 6); if (t.inside(x, z)) hs.push(t.heightAt(x, z)); }
    hs.sort((a, b) => a - b);
    const bed = hs[Math.floor(hs.length / 2)], design = wallTopY(r) - MM(POOL.wallH + POOL.F), dmm = Math.round((bed - design) / S);
    if (dmm > 120) { this.toast(`Котлован не готов: дно на ${dmm} мм выше отметки. Копайте до −1,85 м, щебень 200 мм с виброплитой, подбетонка 100 мм — днище чаши ложится на −1,55 м`); return; }
    const ft = bed + MM(POOL.F), hw = Math.round((wallTopY(r) - ft) / S);
    let fid = null;
    this._save('pool-form1', () => { const b = app.objects.add(floorBelt({ ...r }, bed)); fid = b.id; app.objects.update(r.id, { floor: b.id, ft: +ft.toFixed(6), hw }); });
    this._grow(app.wallView, fid, 1.6);
    this.toast(`Опалубка днища: доски по краю плиты ${((r.L + 700) / 1000).toFixed(1)} × ${((r.W + 700) / 1000).toFixed(1)} м, 250 мм.${dmm < -120 ? ` Дно ниже отметки на ${-dmm} мм — стены выйдут выше (${hw} мм).` : ''} Дальше «5 · Арматура днища»`.replace(/(\d)\.(\d)/g, '$1,$2'));
  }
  _cage1(r, fb) {
    const app = this.app;
    if (!fb) { this.toast('Сначала «4 · Опалубка днища»'); return; }
    if (r.cage1 != null && app.objects.get(r.cage1)) { this.toast('Арматура днища уже связана — заливайте: «Бетон» → шланг по днищу, вибратор, правило по доскам'); return; }
    let cid = null;
    this._save('pool-cage1', () => { const c = app.objects.add(floorCage(r, fb.top)); cid = c.id; app.objects.update(r.id, { cage1: c.id }); });
    this._grow(app.rebarView, cid, 2.4);
    this.toast('Две сетки Ø12 шаг 200 на стульчиках и «лягушках», выпуски под стены. Теперь бетон: «Бетон» → шланг по днищу, вибратор, правило по доскам');
  }
  _cage2(r, fb) {
    const app = this.app;
    if (!fb || !(fb.fill >= 0.95)) { this.toast(!fb ? 'Сначала днище' : 'Днище ещё не залито доверху — «Бетон» → шланг'); return; }
    if (r.cage2 != null && app.objects.get(r.cage2)) { this.toast('Арматура стен уже стоит — дальше «7 · Опалубка стен и закладные»'); return; }
    let cid = null;
    this._save('pool-cage2', () => { const c = app.objects.add(wallCage(r)); cid = c.id; app.objects.update(r.id, { cage2: c.id }); });
    this._grow(app.rebarView, cid, 2.4);
    this.toast('Стены: вертикали и горизонтали Ø12 шаг 200 в две сетки, связаны с выпусками; по шву — бентонитовый шнур. Дальше «7 · Опалубка стен и закладные»');
  }
  _form2(r, fb, wb) {
    const app = this.app;
    if (wb) { this.toast(wb.fill > 0.05 ? 'Стены уже залиты' : 'Опалубка стен стоит — заливайте: «Бетон» → шланг по верху щитов, вибратор'); return; }
    if (!(r.cage2 != null && app.objects.get(r.cage2))) { this.toast('Сначала «6 · Арматура стен»'); return; }
    if (uStrength(fb, app.clock) < 0.5) { this.toast(`Днище набирает прочность: ${Math.round(uStrength(fb, app.clock) * 200)} % от нужной для щитов — подождите`); return; }
    let wid = null;
    this._save('pool-form2', () => { const b = app.objects.add(wallBelt(r)); wid = b.id; app.objects.update(r.id, { wall: b.id }); });
    this._grow(app.wallView, wid, 2.2);
    this.toast(`Щиты с двух сторон, ригели, стяжки; в щитах закладные: 2 скиммера, 3 форсунки, 2 прожектора, донный слив. Стены ${((r.hw || POOL.wallH) / 1000).toFixed(2).replace('.', ',')} м — заливайте: «Бетон» → шланг по верху щитов, вибратор`);
  }
  // ---- round the pool: the backfill, the deck's base, the deck ----
  get deckKey() { return DECKS[this.app.settings.poolDeck] ? this.app.settings.poolDeck : 'wpc:teak'; }
  get deckW() { return DECK_WIDTHS.includes(this.app.settings.poolDeckW) ? this.app.settings.poolDeckW : 1500; }
  // the gap between the walls and the pit's sides filled back with sand, 300 mm at a time, each
  // layer rammed with the plate — up to the ground
  _fill(r, fb, wb) {
    const app = this.app, t = app.terrain;
    if (!wb || !wb.stripped || !fb?.stripped) { this.toast('Засыпают, когда стены залиты и опалубка снята — бетон держит грунт'); return; }
    if (r.filled) { this.toast('Пазухи уже засыпаны — дальше «14 · Основание площадки»'); return; }
    const [bi, bo] = fillBand(), box = worldBox(r, [-bo, -bo, r.L + bo, r.W + bo]);
    const inBand = (x, z) => { const [s2, t2] = PF(r, x, z); const inO = s2 >= -bo && s2 <= r.L + bo && t2 >= -bo && t2 <= r.W + bo, inI = s2 > -bi && s2 < r.L + bi && t2 > -bi && t2 < r.W + bi; return inO && !inI; };
    const ix0 = Math.max(0, Math.floor(t.toCellX(box[0]))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(box[2]))), iz0 = Math.max(0, Math.floor(t.toCellZ(box[1]))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(box[3])));
    const cells = []; for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const x = t.toWorldX(ix), z = t.toWorldZ(iz); if (inBand(x, z)) cells.push([iz * t.nx + ix, x, z]); }
    app.journal.begin('pool-fill', {}, app.clock);
    const low = Math.min(...cells.map(([i]) => t.hAt(i))), layers = Math.max(1, Math.ceil((r.g - low) / MM(300))), steps = [];
    // the way round the pool in the gap (550 out from the water's edge), corner to corner
    const m = -550, ring = this._path(r, [[m, m], [r.L - m, m], [r.L - m, r.W - m], [m, r.W - m], [m, m + 1]]);
    const perim = (x, z) => { const [s2, t2] = PF(r, x, z), w = r.L + 1100, h = r.W + 1100, a = s2 - m, b = t2 - m;
      // (how far round the way a cell lies: by its nearest side)
      const d0 = Math.abs(t2 - m), d1 = Math.abs(s2 - (r.L - m)), d2 = Math.abs(t2 - (r.W - m)), d3 = Math.abs(s2 - m), k = [d0, d1, d2, d3].indexOf(Math.min(d0, d1, d2, d3));
      return k === 0 ? a : k === 1 ? w + b : k === 2 ? w + h + (w - a) : 2 * w + h + (h - b); };
    const pc = cells.map(([i, x, z]) => [i, perim(x, z)]);
    for (let k = 0; k < layers; k++) {
      const lv = Math.min(r.g, low + MM(300) * (k + 1)), y0 = low + MM(300) * k;
      steps.push([0.7, (u) => {
        // (the sand tipped in from a barrow going round: the layer comes up behind it, sloping
        // down ahead of it, all round once)
        const front = u * (ring.total + 1500);
        for (const [i, d] of pc) {
          const e = Math.max(0, Math.min(1, (front - d) / 1500)), y = y0 + (lv - y0) * e, h = t.hAt(i);
          if (h < y) t._push(i, y - h, M_SAND);
        }
        t._touch(ix0, iz0, ix1, iz1);
        const q = ring.at(Math.min(ring.total, front)), [x, z] = PW(r, q.s, q.t);
        if (u < 1 && Math.random() < 0.9) app.particles?.emit(new THREE.Vector3(x, r.g + MM(500), z), new THREE.Vector3(0, -0.15, 0), 0, MM(18 + Math.random() * 20), 0, 0, 1);
        if (Math.random() < 0.15) app.sfx?.pour?.(0.4);
      }]);
      steps.push([ring.total / 1000 * 0.05, (u) => {
        // (the plate round it after, heading the way it goes, turning at the corners; the sand
        // rammed where it has been)
        const q = ring.at(u * ring.total), [x, z] = PW(r, q.s, q.t), wide = MM(380);
        app.concreteGear.plateOn = true; app.concreteGear.set('plate', new THREE.Vector3(x, lv, z), q.yaw, u === 0);
        const ix0b = Math.max(0, Math.floor(t.toCellX(x - wide))), ix1b = Math.min(t.rx, Math.ceil(t.toCellX(x + wide))), iz0b = Math.max(0, Math.floor(t.toCellZ(z - wide))), iz1b = Math.min(t.rz, Math.ceil(t.toCellZ(z + wide)));
        for (let iz = iz0b; iz <= iz1b; iz++) for (let ix = ix0b; ix <= ix1b; ix++) if (inBand(t.toWorldX(ix), t.toWorldZ(iz)) && Math.hypot(t.toWorldX(ix) - x, t.toWorldZ(iz) - z) < wide) t.comp[iz * t.nx + ix] = 1;
        t._touch(ix0b, iz0b, ix1b, iz1b);
        if (u >= 1) { for (const [i] of cells) t.comp[i] = 1; app.concreteGear.plateOn = false; }
      }]);
    }
    steps.push([0, () => app.concreteGear.set(null)]);
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); app.concreteGear.set(null); }, commit: () => {
      app.objects.update(r.id, { filled: true });
      app.journal.commit(app.clock);
      this.toast(`Пазухи засыпаны песком слоями по 300 мм, каждый утрамбован виброплитой (${layers} слоя). Дальше «14 · Основание площадки»: выберите покрытие и ширину`);
    } });
  }
  // the deck's base, for the chosen covering: boards — concrete pads on the ground and joists 50 × 100
  // every 400 (the top 300 over the ground: flush with the coping); tiles, stone — crushed stone, then a
  // slab of concrete with a mesh, its top 30 under the coping (the glue and the tile)
  _base(r) {
    const app = this.app, t = app.terrain, key = this.deckKey, W = this.deckW, D = DECKS[key];
    if (!r.filled) { this.toast('Сначала «13 · Обратная засыпка»'); return; }
    if (r.base) { this.toast(r.deck ? 'Площадка готова' : 'Основание уже готово — дальше «15 · Покрытие площадки»'); return; }
    const base = { key, w: W }, ring = deckRing(r, W), steps = [];
    app.journal.begin('pool-base', { key }, app.clock);
    if (D.base === 'slab') {
      const box = worldBox(r, [ring[0][0], ring[0][1], ring[1][2], ring[1][3]]), cells = [];
      const ix0 = Math.max(0, Math.floor(t.toCellX(box[0]))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(box[2]))), iz0 = Math.max(0, Math.floor(t.toCellZ(box[1]))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(box[3])));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const x = t.toWorldX(ix), z = t.toWorldZ(iz), [s2, t2] = PF(r, x, z); if (ring.some(([a0, b0, a1, b1]) => s2 >= a0 && s2 <= a1 && t2 >= b0 && t2 <= b1)) cells.push(iz * t.nx + ix); }
      const ys = rimY(r) - MM(130), yc = rimY(r) - MM(30);
      steps.push([0.8, (u) => { for (const i of cells) { const h = t.hAt(i), want = r.g + (ys - r.g) * u; if (h < want) t._push(i, want - h, M_G20); } t._touch(ix0, iz0, ix1, iz1); if (Math.random() < 0.3) app.sfx?.pour?.(0.4); }]);
      steps.push([0.6, (u) => { if (u >= 1) for (const i of cells) t.comp[i] = 1; }]);
      steps.push([0.9, (u) => { for (const i of cells) { const h = t.hAt(i), want = ys + (yc - ys) * u; if (h < want) { t.conc[i] += want - h; t.cTime[i] = app.clock; t.cSm[i] = 0.8; } } t._touch(ix0, iz0, ix1, iz1); }]);
    } else {
      // (the joists go up side by side — drawn by the pool's view from the record)
      steps.push([2.4, (u) => { app.poolView.deckLive = { id: r.id, sides: 0, base: +u.toFixed(3) }; app.poolView.dirty = true; if (Math.random() < 0.1) app.sfx?.stab?.(); }]);
    }
    const cleanup = () => { app.poolView.deckLive = null; app.poolView.dirty = true; };
    // (the record first: the view draws the joists from it while they go up)
    app.objects.update(r.id, { base });
    new FitJob(app, { steps, parts: [], cleanup, onAbort: () => { app.journal.cancel(); cleanup(); }, commit: () => {
      app.journal.commit(app.clock);
      const A = ring.reduce((a, q) => a + (q[2] - q[0]) * (q[3] - q[1]), 0) / 1e6;
      this.toast(D.base === 'slab' ? `Основание: щебень с трамбовкой, бетонная плита 100 мм с сеткой, уклон 1 % от бассейна — ${A.toFixed(1)} м² под «${D.name}». Дальше «15 · Покрытие площадки»` : `Основание: бетонные опоры через 600 мм, лаги 50 × 100 через 400 мм — ${A.toFixed(1)} м² под «${D.name}». Дальше «15 · Покрытие площадки»`);
    } });
  }
  // the covering: side after side, board by board (tile by tile)
  _deck(r) {
    const app = this.app;
    if (!r.base) { this.toast('Сначала «14 · Основание площадки»'); return; }
    if (r.deck) { this.toast('Площадка уже уложена'); return; }
    const D = DECKS[r.base.key], steps = [], cleanup = () => { app.poolView.deckLive = null; app.poolView.dirty = true; };
    steps.push([3.6, (u) => { app.poolView.deckLive = { id: r.id, sides: +(4 * u).toFixed(3), base: 1 }; app.poolView.dirty = true; if (Math.random() < 0.12) app.sfx?.stab?.(); }]);
    new FitJob(app, { steps, parts: [], cleanup, onAbort: cleanup, commit: () => {
      this._save('pool-deck', () => app.objects.update(r.id, { deck: true }));
      this.toast(`Площадка: ${D.name}${D.base === 'joists' ? ' — доски на скрытом крепеже, зазор 6 мм' : ' — на клею, шов 3 мм'}. Бассейн с площадкой готов`);
    } });
  }

  _strip(r, fb, wb) {
    const app = this.app, todo = [], wait = [];
    for (const b of [fb, wb]) {
      if (!b || b.stripped) continue;
      if (!(b.fill >= 0.95)) { wait.push(b.part === 'floor' ? 'днище не залито' : 'стены не залиты'); continue; }
      const k = uStrength(b, app.clock);
      if (k < 1) { wait.push(`${b.part === 'floor' ? 'днище' : 'стены'}: прочность ${Math.round(k * 100)} %`); continue; }
      todo.push(b);
    }
    if (!todo.length) { this.toast(wait.length ? 'Рано снимать: ' + wait.join(', ') : !wb ? 'Снимать нечего — опалубка стен ещё не стоит' : 'Опалубка уже снята'); return; }
    // (taken off board by board — the walers and the ties first, the boards from the top down — then recorded)
    const save = () => {
      this._save('pool-strip', () => { for (const b of todo) app.objects.update(b.id, { stripped: true, set: true }); });
      this.toast(todo.some((b) => b.part === 'wall') ? 'Щиты, ригели и стяжки сняли — чаша готова. Пазухи можно засыпать; внутри — «9 · Гидроизоляция»' : 'Доски днища сняли');
    };
    const v = app.wallView, mark = () => { v.dirty = true; app.poolView.dirty = true; };
    const steps = todo.map((b) => [b.part === 'wall' ? 1.8 : 0.9, (u) => { v.reveal = { id: b.id, u: Math.max(0, 0.84 * (1 - u)) }; mark(); if (Math.random() < 0.1) app.sfx?.stab?.(); }]);
    new FitJob(app, { steps, parts: [], cleanup: () => { v.reveal = null; mark(); }, commit: save });
  }

  // ---- inside the bowl ----------------------------------------------------------------------
  _paint(e) {
    const d = this.drag, r = d.live, ray = this._rayOf(e); if (!ray) return;
    const h = hitInner(r, ray); if (!h) return;
    const F = faces(r), C = POOL.cell;
    r.proof = r.proof || [];
    let changed = false;
    for (const f of F) {
      const [ni, nj] = cellsOf(f), str = faceStr(r.proof, f.k, ni * nj).split('');
      let any = false;
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const p = f.P((i + 0.5) * C, (j + 0.5) * C);
        if ((p[0] - h.s) ** 2 + (p[1] - h.t) ** 2 + (p[2] - h.y) ** 2 > BRUSH * BRUSH) continue;
        const key = f.k * 100000 + j * ni + i;
        if (d.touched.has(key)) continue;   // (a coat a stroke)
        d.touched.add(key);
        if (str[j * ni + i] < '2') { str[j * ni + i] = String(+str[j * ni + i] + 1); any = true; }
      }
      if (any) { r.proof[f.k] = str.join(''); changed = true; }
    }
    for (let k = 0; k < 5; k++) if (r.proof[k] == null) r.proof[k] = '';
    if (changed) this._live(r);
  }
  _tile(e) {
    const d = this.drag, r = d.live, ray = this._rayOf(e); if (!ray) return;
    const h = hitInner(r, ray); if (!h) return;
    const F = faces(r), f = F[h.k], [ni, nj] = sheetsOf(f), letter = MOSAICS[this.mos][3];
    r.tile = r.tile || [];
    const str = faceStr(r.tile, f.k, ni * nj).split(''), [ci, cj] = cellsOf(f), coat = faceStr(r.proof, f.k, ci * cj);
    let changed = false;
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const [a0, b0, a1, b1] = sheetRect(f, i, j);
      // the sheet under the finger and those it reaches over (a sheet and a half wide)
      const reach = d.moved ? 160 : 0;   // (a tap: the sheet under the finger; drawn along: those it reaches over)
      if (Math.max(a0 - h.a, h.a - a1, 0) > reach || Math.max(b0 - h.b, h.b - b1, 0) > reach) continue;
      if (str[j * ni + i] === letter) continue;
      // the coating under it: two coats over most of it
      let n = 0, ok = 0;
      for (let b = Math.floor(b0 / POOL.cell); b < Math.ceil(b1 / POOL.cell); b++) for (let a = Math.floor(a0 / POOL.cell); a < Math.ceil(a1 / POOL.cell); a++) { n++; if (coat[b * ci + a] === '2') ok++; }
      if (ok < n * 0.8) { if (!d.said) { d.said = true; this.toast('Мозаика — по гидроизоляции в 2 слоя: сначала «9 · Гидроизоляция» здесь'); } continue; }
      str[j * ni + i] = letter; changed = true;
    }
    if (changed) { r.tile[f.k] = str.join(''); for (let k = 0; k < 5; k++) if (r.tile[k] == null) r.tile[k] = ''; this._live(r); this.app.sfx?.stab?.(); }
  }
  _cope(e) {
    const d = this.drag, r = d.live, ray = this._rayOf(e); if (!ray) return;
    const q = hitRim(r, ray); if (!q) return;
    r.cope = r.cope || [];
    let changed = false;
    for (const sd of copeLayout(r)) {
      const str = faceStr(r.cope, sd.side, sd.n).split('');
      for (const st of sd.list) {
        if (str[st.i] === '1') continue;
        // the finger within the stone (or 150 round it)
        const [sA, tA] = sd.P(st.a0, st.c0), [sB, tB] = sd.P(st.a1, st.c1);
        if (q[0] < Math.min(sA, sB) - 150 || q[0] > Math.max(sA, sB) + 150 || q[1] < Math.min(tA, tB) - 150 || q[1] > Math.max(tA, tB) + 150) continue;
        str[st.i] = '1'; changed = true;
      }
      r.cope[sd.side] = str.join('');
    }
    if (changed) { this._live(r); this.app.sfx?.stab?.(); }
  }
  // world point / normal of the bowl's frame (mm: s, t, y over the slab)
  _w(r, p) { const [x, z] = PW(r, p[0], p[1]); return new THREE.Vector3(x, floorTopY(r) + MM(p[2]), z); }
  _n(r, N) { const [x, z] = PW(r, N[0] * 1000, N[1] * 1000), [x0, z0] = PW(r, 0, 0); return new THREE.Vector3(x - x0, N[2] * MM(1000), z - z0).normalize(); }
  // the mosaic: a sheet or two by a tap — the glue combed on with the notched trowel, the
  // sheet pressed on, smoothed over; along the finger's way — sheet by sheet quickly
  _fitSheets(r, old, save) {
    const app = this.app, F = faces(r), list = [];
    for (const f of F) {
      const [ni, nj] = sheetsOf(f), a = faceStr(r.tile, f.k, ni * nj), b = faceStr(old?.tile, f.k, ni * nj);
      for (let k = 0; k < ni * nj; k++) if (a[k] !== '0' && a[k] !== b[k]) list.push({ f, k, ch: a[k], i: k % ni, j: (k / ni) | 0 });
    }
    if (!list.length) { save(); return; }
    const U = { uWaterY: { value: -1e9 }, uTime: { value: 0 }, uSun: { value: 1 }, uNightGlow: { value: 0 } };
    const one = list.length <= 2, chunk = one ? 1 : Math.max(1, Math.ceil(list.length / 24)), steps = [], parts = [];
    const T = one ? 1 : Math.min(1, 2.6 / (Math.ceil(list.length / chunk) * 0.12));
    for (let q = 0; q < list.length; q += chunk) {
      const grp = list.slice(q, q + chunk), tile = F.map((f) => { const [ni, nj] = sheetsOf(f), c = new Array(ni * nj).fill('0'); for (const e of grp) if (e.f.k === f.k) c[e.k] = e.ch; return c.join(''); });
      const g = buildMosaic({ ...r, tile }, U); g.visible = false; parts.push(g);
      const e = grp[0], n = this._n(r, e.f.N), [a0, b0, a1, b1] = sheetRect(e.f, e.i, e.j), mid = this._w(r, e.f.P((a0 + a1) / 2, (b0 + b1) / 2));
      const along = this._w(r, e.f.P(a1, (b0 + b1) / 2)).sub(this._w(r, e.f.P(a0, (b0 + b1) / 2))), upv = this._w(r, e.f.P(a0, b1)).sub(this._w(r, e.f.P(a0, b0))).normalize();
      if (one) {
        // (the glue: a grey bed growing behind the trowel, combed)
        const bed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xb4b2aa, roughness: 0.95 }));
        bed.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(upv.clone().cross(n).normalize(), upv, n));   // (right-handed: x = y × z)
        const w = along.length(), h = this._w(r, e.f.P(a0, b1)).distanceTo(this._w(r, e.f.P(a0, b0)));
        bed.visible = false; parts.push(bed);
        steps.push([0.55, (u) => {
          bed.visible = true; bed.scale.set(w * Math.max(0.02, u), h, 1);
          bed.position.copy(this._w(r, e.f.P(a0 + (a1 - a0) * u / 2, (b0 + b1) / 2))).addScaledVector(n, MM(4));
          app.handTools.set('notch', this._w(r, e.f.P(a0 + (a1 - a0) * u, b0 + 20)).addScaledVector(n, MM(5)), n, upv, 0);
        }]);
      }
      steps.push([(one ? 0.35 : 0.1) * T, (u) => { g.visible = true; g.position.copy(n).multiplyScalar(MM(one ? 25 : 10) * (1 - u)); if (one) app.handTools.hide(); }]);
      if (one) steps.push([0.4, (u) => { app.handTools.set('notch', mid.clone().addScaledVector(along, (u - 0.5) * 0.8).addScaledVector(n, MM(6)), n, upv, 0); }]);
    }
    new FitJob(app, { steps, parts, commit: save });
  }
  // the coping: a stone by a tap — glue on the wall's top, the stone set down on it, three
  // taps of the mallet, the level along it; along the finger's way — stone by stone quickly
  _fitStones(r, old, save) {
    const app = this.app, list = [];
    for (const sd of copeLayout(r)) {
      const a = faceStr(r.cope, sd.side, sd.n), b = faceStr(old?.cope, sd.side, sd.n);
      for (const st of sd.list) if (a[st.i] === '1' && b[st.i] !== '1') list.push({ sd, st });
    }
    if (!list.length) { save(); return; }
    const one = list.length <= 2, steps = [], parts = [], up = new THREE.Vector3(0, 1, 0), T = one ? 1 : Math.min(1, 3.2 / (list.length * 0.26));
    const top = (rimY(r) - floorTopY(r)) / S;
    for (const { sd, st } of list) {
      const g = buildCoping(r, new Set([sd.side + ':' + st.i])); if (!g) continue;
      g.visible = false; parts.push(g);
      const [s, t] = sd.P((st.a0 + st.a1) / 2, (st.c0 + st.c1) / 2), c = this._w(r, [s, t, top]);
      const [s1, t1] = sd.P(st.a1, (st.c0 + st.c1) / 2), along = this._w(r, [s1, t1, top]).sub(c).normalize();
      if (one) {
        const bl = at(part('blob'), this._w(r, [s, t, top - POOL.cope - POOL.glue]), up); bl.userData.obj.scale.set(4, 2.2, 1); parts.push(bl);
        steps.push([0.25, () => { bl.userData.obj.visible = true; }]);
      }
      steps.push([(one ? 0.45 : 0.13) * T, (u) => { g.visible = true; g.position.y = MMf(one ? 80 : 30) * (1 - u * u); }]);
      steps.push(hammer(app, c, up, one ? 3 : 1, (one ? 0.2 : 0.13) * T, null, along, 'mallet'));
      if (one) steps.push([0.45, () => app.handTools.set('level', c.clone().add(new THREE.Vector3(0, MMf(1), 0)), up, along, 0)]);
    }
    new FitJob(app, { steps, parts, commit: save });
  }

  // what is left of a layer (a toast after a stroke)
  _progress(r, L) {
    if (!r) return null;
    const F = faces(r);
    if (L === 'proof') {
      let n = 0, c1 = 0, c2 = 0;
      for (const f of F) { const [ni, nj] = cellsOf(f), s = faceStr(r.proof, f.k, ni * nj); for (const ch of s) { n++; if (ch >= '1') c1++; if (ch === '2') c2++; } }
      return c2 >= n * 0.98 ? 'Гидроизоляция в 2 слоя готова, ленты в углах вклеены — дальше «10 · Мозаика»' : `Гидроизоляция: 1-й слой ${Math.round(c1 / n * 100)} %, 2-й слой ${Math.round(c2 / n * 100)} %. Второй слой — новыми проходами`;
    }
    if (L === 'tile') {
      let n = 0, k = 0;
      for (const f of F) { const [ni, nj] = sheetsOf(f), s = faceStr(r.tile, f.k, ni * nj); for (const ch of s) { n++; if (ch !== '0') k++; } }
      return k >= n ? 'Мозаика уложена и затёрта — дальше «11 · Бортовой камень»' : `Мозаика: ${k} из ${n} листов 316 × 316`;
    }
    if (L === 'cope') {
      let n = 0, k = 0;
      for (const sd of copeLayout(r)) { const s = faceStr(r.cope, sd.side, sd.n); n += sd.n; for (const ch of s) if (ch === '1') k++; }
      return k >= n ? 'Бортовой камень уложен — наполняйте: «12 · Вода»' : `Бортовой камень: ${k} из ${n}`;
    }
    return null;
  }

  // what is next on the pool (from what is done): [stage, what to do] — the menu shows it as a chip
  next(r = this.rec) {
    if (!r) return ['pit', 'Разметьте бассейн: коснитесь участка'];
    const app = this.app, t = app.terrain, { fb, wb } = this._belts(r);
    const done = (L) => { const m = this._progress(r, L); return !!m && !/\d+ %|из \d/.test(m); };
    if (!fb) {
      const [cx, cz] = PW(r, r.L / 2, r.W / 2), have = (r.g - t.nat[t.index(cx, cz)]) / S;
      if (have < POOL.pitDepth - 150) return ['dig', 'Выкопайте котлован'];
      if (!(t.conc[t.index(cx, cz)] > 1e-6)) return ['bed', 'Щебень и подбетонка'];
      return ['form1', 'Опалубка днища'];
    }
    if (!(r.cage1 != null && app.objects.get(r.cage1))) return ['cage1', 'Арматура днища'];
    if (!(fb.fill >= 0.95)) return ['concrete', 'Залейте днище: «Бетон» → шланг по днищу, вибратор, правило'];
    if (!(r.cage2 != null && app.objects.get(r.cage2))) return ['cage2', 'Арматура стен'];
    if (!wb) return ['form2', 'Опалубка стен и закладные'];
    if (!(wb.fill >= 0.95)) return ['concrete', 'Залейте стены: «Бетон» → шланг по верху щитов, вибратор'];
    if (!fb.stripped || !wb.stripped) return ['strip', 'Снимите опалубку, когда бетон наберёт прочность'];
    if (!done('proof')) return ['proof', 'Гидроизоляция в 2 слоя'];
    if (!done('tile')) return ['tile', 'Мозаика'];
    if (!done('cope')) return ['cope', 'Бортовой камень'];
    if ((r.water || 0) < waterMax(r) - 1) return ['water', 'Наполните водой'];
    if (!r.filled) return ['fill', 'Засыпьте пазухи вокруг чаши'];
    if (!r.base) return ['base', 'Основание площадки вокруг'];
    if (!r.deck) return ['deck', 'Покрытие площадки'];
    if (!r.light) return ['light', 'Включите подсветку'];
    return [null, 'Бассейн готов 🎉'];
  }

  status(carry) {
    void carry;
    const r = this.rec, L = this.layer;
    const H = {
      pit: 'Коснитесь участка — разметится бассейн 8 × 3,5 м и котлован под него (тяните пальцем — свой размер; рядом с проектом — встанет по проекту)',
      dig: 'Коснитесь разметки — котлован выкопается по размерам (или копайте лопатой и погрузчиком; касание зачистит борта и дно по разметке)',
      bed: 'Коснитесь котлована — щебень 200 мм с трамбовкой и подбетонка 100 мм',
      form1: 'Коснитесь котлована — доски опалубки днища встанут на подбетонку',
      cage1: 'Коснитесь днища — две сетки Ø12 и выпуски под стены',
      cage2: 'Коснитесь днища — арматура стен (днище должно быть залито)',
      form2: 'Коснитесь чаши — щиты стен, ригели, стяжки и закладные',
      strip: 'Коснитесь чаши — снимется опалубка, где бетон набрал прочность',
      proof: 'Ведите пальцем по стенам и дну — обмазочная гидроизоляция; второй слой — новыми проходами',
      tile: 'Ведите пальцем по чаше — листы мозаики 316 × 316 ложатся на клей',
      cope: 'Ведите пальцем по краю чаши — бортовой камень ложится на клей',
      water: 'Держите палец — шланг наполняет чашу (или насос сливает)',
      light: 'Коснитесь чаши — включить / выключить подсветку',
      fill: 'Коснитесь бассейна — пазухи засыпаются песком слоями с трамбовкой',
      base: 'Выберите покрытие и ширину площадки, коснитесь бассейна — встанет основание',
      deck: 'Коснитесь бассейна — покрытие площадки уложится вокруг',
    };
    const [nx, nw] = this.next(r);
    return (!r && L !== 'pit' ? 'Сначала «1 · Разметка». ' : '') + H[L] + (r && nx !== L ? ` · Следующий шаг: ${nw}` : '');
  }

  remove(id) {
    const app = this.app, r = app.objects.get(id);
    if (!r) return;
    const { fb, wb } = this._belts(r);
    if ((fb && fb.fill > 0.05) || (wb && wb.fill > 0.05)) { this.toast('Чаша уже забетонирована — её не убрать (отменить можно кнопкой «Назад»)'); return; }
    this._save('pool-remove', () => {
      for (const c of app.objects.all('cage').filter((c) => c.poolId === id)) app.objects.remove(c.id);
      for (const b of [fb, wb]) if (b) app.objects.remove(b.id);
      if (r.pit != null) app.objects.remove(r.pit);
      app.objects.remove(id);
    });
    this.toast('Бассейн убран (котлован остаётся как выкопан)');
  }
  // a pool belt touched with «Удалить»: its formwork off (when ready) or the empty one away
  belt(b) { const r = this.app.objects.get(b.pool); if (!r) return; const { fb, wb } = this._belts(r); this._strip(r, fb, wb); }
}
export { isPoolBelt, PF };
