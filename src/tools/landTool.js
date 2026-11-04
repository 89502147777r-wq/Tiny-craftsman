import * as THREE from 'three';
import { MODEL_SCALE, M_G20, M_SAND, M_SOIL } from '../config.js';
import { FitJob } from './fitJob.js';
import {
  PATH, TOPS, legsOf, legW, lengthOf, half, paveQuads, digQuads, kerbOuter, inQuads, boxOf, chainOf,
} from '../world/garden.js';
import { pointAt } from '../world/gardenView.js';
import { PathWork } from './pathTool.js';
import { LawnWork } from './lawnTool.js';
import { fenceLine, fenceLength } from '../world/fence.js';
import { fromV1 } from '../world/fence2.js';
import { PLANTS, hedgePlants } from '../world/plants.js';
import { LAWN, LAWN_HOW, inside as inPolyL, cellsOf as lawnCells } from '../world/lawn.js';

// «Благоустройство»: the path (pathTool.js), the lawn (lawnTool.js), the plants (here). Kept here for them
// both: the trough dug bite by bite, the stone and the sand spread and rammed (the path's «auto»), the turf
// rolled out (the lawn's), the ground's level along a line / inside an outline.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const f1 = (v) => v.toFixed(1).replace('.', ',');

export class LandWork {
  constructor(app) { this.app = app; this.drag = null; this.sel = null; this.pw = new PathWork(this); this.lw = new LawnWork(this); }
  get view() { return this.app.gardenView; }
  toast(m) { this.app.ui?.toast(m); }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  // the terrain's cells in the bands qs (with each one's chainage, mm)
  _cells(r, qs) {
    const t = this.app.terrain, [x0, z0, x1, z1] = boxOf(qs), out = [];
    const ix0 = Math.max(0, Math.floor(t.toCellX(x0))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(x1))), iz0 = Math.max(0, Math.floor(t.toCellZ(z0))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(z1)));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const x = t.toWorldX(ix), z = t.toWorldZ(iz); if (inQuads(qs, x, z)) out.push([iz * t.nx + ix, chainOf(r, x, z) / S, x, z]); }
    out.box = [ix0, iz0, ix1, iz1];
    return out;
  }

  get what() { const w = this.app.settings.landWhat; return w === 'lawn' || w === 'plant' ? w : 'path'; }
  get plantKind() { return PLANTS[this.app.settings.plantKind] ? this.app.settings.plantKind : 'tree'; }
  get how() { return LAWN_HOW[this.app.settings.lawnHow] ? this.app.settings.lawnHow : 'turf'; }

  // the finger: on the path (pathTool.js), on the lawn (lawnTool.js), planting (a hedge drawn along)
  down(p, e) {
    if (this.what === 'lawn') return this.lw.down(p, e);
    if (this.what === 'plant') return this._plantDown(p, e);
    return this.pw.down(p, e);
  }
  move(p, e) {
    if (this.pw.drag) { this.pw.move(p, e); return; }
    if (this.lw.drag) { this.lw.move(p, e); return; }
    const d = this.drag; if (!d) return;
    if (d.L === 'hedge') { const last = d.trail.at(-1); if (Math.hypot(p.x - last[0], p.z - last[1]) > MM(80)) { d.trail.push([p.x, p.z]); const pts = fenceLine(d.trail); this.view.setLiveFence(pts ? fromV1({ type: 'fence', pts, H: 1300, kind: 'slat', col: 'graphite', g: this._groundOf(pts) }) : null); if (pts) this.app.ui?.showMeasure?.(`Живая изгородь ${f1(fenceLength({ pts, kind: 'slat' }) / S / 1000)} м, ${hedgePlants({ pts }).length} растений — отпустите`); } return; }
  }
  update() {}
  up() {
    if (this.pw.drag) { this.pw.up(); return; }
    if (this.lw.drag) { this.lw.up(); return; }
    const d = this.drag;
    if (d?.L === 'hedge') { this.drag = null; this.view.setLiveFence(null); this.app.ui?.hideMeasure?.(); const pts = fenceLine(d.trail); if (!pts) { this.toast('Изгородь короче метра — ведите пальцем длиннее'); return; } this._plant({ kind: 'hedge', pts, g: this._groundOf(pts) }); return; }
    this.drag = null;
  }
  interrupt() { this.pw.interrupt(); this.lw.interrupt(); if (this.drag?.L === 'hedge') { this.view.setLiveFence(null); this.app.ui?.hideMeasure?.(); } this.drag = null; }

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
      if (rr() < 0.12) app.sfx?.play?.('shovel_dig');
    }], [0.15, (u) => { if (u >= 1) { t.levelTo(inside, y, box); sh.root.visible = vis; } }]];
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); sh.root.visible = vis; }, commit: () => {
      app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), dig: 1 } });
      app.journal.commit(app.clock);
      const out = Math.max(0, before - t.totalVolume()) * MODEL_SCALE ** 3;
      this.toast(`Корыто 300 мм выкопано, вынуто ${f1(out)} м³ (вывезено). Дальше «3 · Бордюр»`);
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
      if (u < 1 && Math.random() < 0.2) app.sfx?.pour?.(0.35, mat === M_SAND ? 'sand_pour' : 'gravel_pour');
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
      app.sfx?.engine?.('compactor', 0.6);
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



  // the next thing to do (the chip «➜ …»)
  // the next thing to do; what to do now
  next() { return this.what === 'lawn' ? this.lw.next() : this.what === 'plant' ? [null, this.plantStatus()] : this.pw.next(); }
  status() { return this.what === 'lawn' ? this.lw.status() : this.what === 'plant' ? this.plantStatus() : this.pw.status(); }
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
  _lGrass(r) {
    const app = this.app, how = this.how, { c } = this._lExtent(r);
    if (!c.length) { this.toast('Внутри разметки нет свободной земли'); return; }
    const A = c.length * (LAWN.cell / 1000) ** 2, u = r.u || [1, 0], yaw = Math.atan2(-u[0], -u[1]);
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
      if (k !== job._k) { job._k = k; app.sfx?.play?.('turf'); }
    }]];
    this._lJob(r, 'grass', steps, `Рулонный газон: ${n} рулонов 2 × 0,4 м на ${f1(A)} м², швы вразбежку. Дальше «6 · Полив»`);
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
      // (a pot or a lantern: carried and set down — no hole)
      if (P.pot) { steps.push([0.8, (u) => { const e = u * u * (3 - 2 * u); v.setAnim(key, { n: k + 1, drop: 600 * (1 - e) }); }]); return; }
      const hx = x + R * 1.6, hz = z + R * 0.4, vol = Math.PI * R * R * D * 0.6;
      // (dug)
      steps.push([per * 0.35, (u) => {
        if (!heaps[k]) heaps[k] = t.heapStart(hx, hz, vol, Math.tan(37 * Math.PI / 180));
        t.scoop(x, z, R, rec.g - D * u, rec.g, () => true, k);
        t.heapTo(heaps[k], vol * u, M_SOIL);
        if (Math.random() < 0.4) app.particles?.emit(new THREE.Vector3(x, rec.g, z), new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.15, (Math.random() - 0.5) * 0.08), 0, MM(25), 0, 0, 0);
        if (Math.random() < 0.15) app.sfx?.play?.(P.pot ? 'pot' : 'plant_dig');
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
    if (!P.light && P.mulch) steps.push([1, (u) => { for (let i = 0; i < 3; i++) { const [x, z] = spots[Math.floor(Math.random() * spots.length)]; app.particles?.emit(new THREE.Vector3(x + (Math.random() - 0.5) * R, rec.g + MM(500), z + (Math.random() - 0.5) * R), new THREE.Vector3(0, -0.3, 0), 0, MM(6), 0, 0, 1); } if (u < 1 && Math.random() < 0.2) app.sfx?.loop?.('plant-water', 'watering', 0.6, 1, null, true); }]);
    steps.push([P.light ? 0.1 : 0.6, (u) => v.setAnim(key, { n: 1e9, drop: 0, mulch: u })]);
    void cx; void cz;
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); v.setAnim(key, null); }, commit: () => {
      app.journal.commit(app.clock);
      v.setAnim(key, null);
      this.toast(P.pot ? (P.light ? `${P.name}: поставлен — ночью светит` : `${P.name}: поставлено`) : P.light ? `${P.name}: установлен, кабель 12 В проложен в траншее — включится в сумерках` : hedge ? `Живая изгородь: ${spots.length} туй через 500 мм, полита, замульчирована корой` : `${P.name}: посажено с комом в яму ${P.hole[0]} × ${P.hole[1]} мм, полито, приствольный круг замульчирован корой${P.stakes ? ', две опоры с подвязкой' : ''}`);
    } });
  }
  plantStatus() {
    return { bollard: 'Коснитесь у дорожки — встанет светильник-столбик (кабель 12 В в траншее); ночью светит', spot: 'Коснитесь у дерева — грунтовый прожектор подсветит его снизу', tree: 'Коснитесь земли — посадится дерево с опорами', ball: 'Коснитесь земли — посадится самшит, стриженный шаром', thuja: 'Коснитесь земли — посадится туя «Смарагд»', hedge: 'Ведите пальцем — вдоль линии посадится живая изгородь из туй' }[this.plantKind] || (PLANTS[this.plantKind].pot ? 'Коснитесь земли — поставится там' : PLANTS[this.plantKind].light ? 'Коснитесь земли — светильник встанет там (кабель 12 В в траншее); ночью светит' : 'Коснитесь земли — посадится там, с комом, полито и замульчировано');
  }
  removePlant(id) {
    if (!this.app.objects.get(id)) return;
    this._save('plant-remove', () => this.app.objects.remove(id));
    this.toast('Растение убрали');
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
