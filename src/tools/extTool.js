import * as THREE from 'three';
import { MODEL_SCALE, M_G20 } from '../config.js';
import { FitJob, drill } from './fitJob.js';
import { isDoor, DOORS } from '../world/doors.js';
import { PORCH, PORCH_LAYERS, PORCH_TILES, porchFor, blocksOf, footprint, inPorch, PW, canopyFor } from '../world/porch.js';

// The house's outside (porch.js): «Экстерьер» → the porch at a door, stage by stage, and the canopy over
// it. A touch near a door starts its porch (the pit dug); each next stage — a touch on the porch.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const NAME = Object.fromEntries(PORCH_LAYERS), ORDER = PORCH_LAYERS.map(([k]) => k);

export class ExtWork {
  constructor(app) { this.app = app; this.drag = null; }
  get what() { return this.app.settings.extWhat === 'canopy' ? 'canopy' : 'porch'; }
  get layer() { return NAME[this.app.settings.porchLayer] ? this.app.settings.porchLayer : 'dig'; }
  get tile() { return PORCH_TILES[this.app.settings.porchTile] ? this.app.settings.porchTile : 'porc_anthracite'; }
  get view() { return this.app.gardenView; }
  toast(m) { this.app.ui?.toast(m); }
  // the outside door nearest the touch (not a garage's), within 2.5 m
  _door(p) {
    let best = null, bd = MM(2500);
    for (const w of this.app.objects.all('window')) {
      if (!isDoor(w.key) || DOORS[w.key].garage) continue;
      const d = Math.hypot(w.x - p.x, w.z - p.z); if (d < bd) bd = d, best = w;
    }
    return best;
  }
  _porch(p) { return this.app.objects.all('porch').find((r) => inPorch(r, p.x, p.z, 400)) || null; }
  down(p) {
    if (this.app.physJob) return true;
    if (this.what === 'canopy') { this._canopy(p); return true; }
    const L = this.layer;
    let r = this._porch(p);
    if (!r) {
      const door = this._door(p);
      if (!door) { this.toast('Коснитесь у входной двери — крыльцо строят к ней'); return true; }
      if (this.app.objects.all('porch').some((q) => q.door === door.id)) { this.toast('У этой двери крыльцо уже есть'); return true; }
      if (L !== 'dig') { this.toast('Сначала «1 · Котлован»: коснитесь у входной двери'); return true; }
      this._dig(door);
      return true;
    }
    const d = r.done || {}, i = ORDER.indexOf(L);
    if (d[L]) { this.toast(`${NAME[L]} — уже сделано${this.next(r)[0] ? `. Дальше «${ORDER.indexOf(this.next(r)[0]) + 1} · ${this.next(r)[1]}»` : ''}`); return true; }
    for (let k = 0; k < i; k++) if (!d[ORDER[k]]) { this.toast(`Сначала «${k + 1} · ${NAME[ORDER[k]]}»`); return true; }
    ({ grav: () => this._grav(r), form: () => this._form(r), conc: () => this._conc(r), strip: () => this._strip(r), tile: () => this._tile(r) })[L]?.();
    return true;
  }
  move() {}
  up() {}
  interrupt() {}
  _cells(r, pad) {
    const t = this.app.terrain, [a0, a1, d0, d1] = footprint(r), cs = [PW(r, a0 - pad, d0), PW(r, a1 + pad, d0), PW(r, a0 - pad, d1 + pad), PW(r, a1 + pad, d1 + pad)];
    const box = [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))];
    const out = [], ix0 = Math.max(0, Math.floor(t.toCellX(box[0]))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(box[2]))), iz0 = Math.max(0, Math.floor(t.toCellZ(box[1]))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(box[3])));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const x = t.toWorldX(ix), z = t.toWorldZ(iz); if (inPorch(r, x, z, pad)) out.push([iz * t.nx + ix, x, z, ((x - r.o[0]) * r.nrm[0] + (z - r.o[1]) * r.nrm[1]) / S]); }
    out.box = box; out.ib = [ix0, iz0, ix1, iz1];
    return out;
  }
  _done(r, k) { this.app.objects.update(r.id, { done: { ...(this.app.objects.get(r.id).done || {}), [k]: 1 } }); }
  _job(steps, r, msg, abort = null) {
    const app = this.app;
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); this.view.setAnim('R' + r.id, null); abort?.(); }, commit: () => { app.journal.commit(app.clock); this.view.setAnim('R' + r.id, null); this.toast(msg); } });
  }
  // 1 · the pit under the porch: 300 deep, dug from the wall out
  _dig(door) {
    const app = this.app, t = app.terrain, g0 = (() => { const out = [Math.sin(door.yaw), Math.cos(door.yaw)], x = door.x + out[0] * MM(1200), z = door.z + out[1] * MM(1200); return t.inside(x, z) ? t.heightAt(x, z) : 0.1; })();
    const base = porchFor(door, g0);
    if (base.H > 2200) { this.toast('Порог выше 2,2 м над землёй — для такого крыльца нужен проект с лестничным маршем'); return; }
    app.journal.begin('porch-dig', {}, app.clock);
    const r = app.objects.add({ type: 'porch', door: door.id, ...base, tile: this.tile, done: {} });
    const cells = this._cells(r, 150), y = r.g - MM(PORCH.dig), D1 = footprint(r)[3] + 150, rr = Math.random;
    const steps = [[Math.max(1.5, D1 / 1000 * 0.9), (u) => {
      const front = -200 + (D1 + 400) * u;
      for (const c of cells) if (c[3] < front) { const want = Math.max(y, r.g - MM(PORCH.dig) * Math.min(1, (front - c[3]) / 350)); t.scoop(c[1], c[2], MM(40), want, r.g, () => true, c[0]); }
      if (rr() < 0.4) { const [x, z] = PW(r, (rr() - 0.5) * r.W, Math.max(0, front - 200)); app.particles?.emit(new THREE.Vector3(x, r.g, z), new THREE.Vector3((rr() - 0.5) * 0.1, 0.18, (rr() - 0.5) * 0.1), 0, MM(30), 0, 0, 0); }
      if (rr() < 0.12) app.sfx?.stab?.();
      if (u >= 1) { t.levelTo((x, z) => inPorch(r, x, z, 150), y, cells.box); this._done(r, 'dig'); }
    }]];
    this._job(steps, r, `Крыльцо ${(r.W / 1000).toFixed(1)} × ${((r.D + r.n * r.run) / 1000).toFixed(1)} м: площадка и ${r.n} ступ. по ${r.rise} мм; котлован 300 мм вынут. Дальше «2 · Щебень»`.replace(/(\d)\.(\d)/g, '$1,$2'));
  }
  // 2 · crushed stone 150, rammed
  _grav(r) {
    const app = this.app, t = app.terrain, cells = this._cells(r, 150), y = r.g - MM(PORCH.grav), D1 = footprint(r)[3];
    app.journal.begin('porch-grav', {}, app.clock);
    const steps = [[1.6, (u) => {
      const front = -200 + (D1 + 500) * u;
      for (const c of cells) if (c[3] < front) { const h = t.hAt(c[0]); if (h < y) t._push(c[0], y - h, M_G20); }
      t._touch(...cells.ib);
    }], [2, (u) => {
      const k = Math.floor(u * 4), f = u * 4 - k, a = (k % 2 ? -1 : 1) * r.W / 4, d = (k % 2 ? 1 - f : f) * (D1 - 200) + 100, [x, z] = PW(r, a, d);
      app.concreteGear.plateOn = u < 1; app.concreteGear.set(u < 1 ? 'plate' : null, new THREE.Vector3(x, y, z), Math.atan2(r.nrm[0] * (k % 2 ? -1 : 1), r.nrm[1] * (k % 2 ? -1 : 1)), u === 0);
      for (const c of cells) if (Math.hypot(c[1] - x, c[2] - z) < MM(300)) t.comp[c[0]] = 1;
      if (Math.random() < 0.1) app.sfx?.stab?.();
    }]];
    steps.push([0, () => { this._done(r, 'grav'); }]);
    this._job(steps, r, 'Щебень 150 мм утрамбован виброплитой. Дальше «3 · Опалубка»', () => app.concreteGear.set(null));
  }
  // 3 · the formwork boards, nailed up one after another
  _form(r) {
    const app = this.app;
    app.journal.begin('porch-form', {}, app.clock);
    const steps = [[2.2, (u, job) => { this.view.setAnim('R' + r.id, { form: u }); const k = Math.floor(u * 10); if (k !== job._k) { job._k = k; app.sfx?.stab?.(); } }], [0, () => this._done(r, 'form')]];
    this._job(steps, r, 'Опалубка: боковые щиты по профилю ступеней, доска на каждый подступенок, колья и распорки. Дальше «4 · Бетон»');
  }
  // 4 · the concrete: from the bottom up, the hose moving over the forms
  _conc(r) {
    const app = this.app, gear = app.concreteGear, B = blocksOf(r);
    app.journal.begin('porch-conc', {}, app.clock);
    const steps = [[Math.max(2.5, r.H / 1000 * 4), (u) => {
      const fill = -PORCH.grav + (r.H + PORCH.grav) * u;
      this.view.setAnim('R' + r.id, { fill, form: 1 });
      // (the hose over the block being filled: the highest still open)
      const open = B.filter((b) => b[4] > fill - 1), b = open.at(-1) || B[0], [x, z] = PW(r, Math.sin(u * 30) * r.W * 0.35, (b[2] + b[3]) / 2);
      gear.set(u < 1 ? 'hose' : null, new THREE.Vector3(x, r.g + MM(Math.min(fill, b[4])), z), 0, u === 0);
      if (Math.random() < 0.25) app.sfx?.pour?.(0.4);
    }], [0, () => this._done(r, 'conc')]];
    this._job(steps, r, `Бетон В25 залит: ${this._vol(r).toFixed(2).replace('.', ',')} м³, ступени выровнены кельмой. Дальше «5 · Распалубка» (когда бетон наберёт прочность)`, () => gear.set(null));
  }
  _vol(r) { return blocksOf(r).reduce((s, [a0, a1, d0, d1, top]) => s + (a1 - a0) * (d1 - d0) * ((top + PORCH.grav) / 1e9), 0); }
  // 5 · the boards off
  _strip(r) {
    const app = this.app;
    app.journal.begin('porch-strip', {}, app.clock);
    const steps = [[1.6, (u, job) => { this.view.setAnim('R' + r.id, { form: 1 - u, strip: true }); const k = Math.floor(u * 8); if (k !== job._k) { job._k = k; app.sfx?.stab?.(); } }], [0, () => this._done(r, 'strip')]];
    this._job(steps, r, 'Опалубку сняли. Дальше «6 · Облицовка»');
  }
  // 6 · the tiles, from the bottom step up to the landing
  _tile(r) {
    const app = this.app, n = blocksOf(r).length, tile = this.tile;
    app.journal.begin('porch-tile', {}, app.clock);
    if (r.tile !== tile) app.objects.update(r.id, { tile });
    const steps = [[Math.max(2, n * 0.7), (u, job) => { this.view.setAnim('R' + r.id, { tile: u * (n + 0.999) }); const k = Math.floor(u * n * 4); if (k !== job._k) { job._k = k; app.sfx?.stab?.(); } }], [0, () => this._done(r, 'tile')]];
    this._job(steps, r, `Облицовка «${PORCH_TILES[tile][0]}» на клею, на ступенях — противоскользящая полоса${r.n > 3 ? '; поручни из нержавейки с двух сторон' : ''}. Крыльцо готово`);
  }
  // the canopy over a door: the anchors drilled, the brackets bolted, the glass laid on
  _canopy(p) {
    const app = this.app, door = this._door(p);
    if (!door) { this.toast('Коснитесь у входной двери — козырёк вешают над ней'); return; }
    if (app.objects.all('canopy').some((q) => q.door === door.id)) { this.toast('Над этой дверью козырёк уже есть'); return; }
    const rec = { type: 'canopy', door: door.id, ...canopyFor(door) };
    app.journal.begin('canopy', {}, app.clock);
    const r = app.objects.add(rec), key = 'C' + r.id, n = new THREE.Vector3(rec.nrm[0], 0, rec.nrm[1]), steps = [];
    this.view.setAnim(key, { anchors: 0, brackets: 0, glass: 0 });
    let k = 0;
    for (const s of [-1, 1]) for (const yy of [120, 380]) {
      const a = s * (rec.W / 2 - 250), p0 = new THREE.Vector3(rec.o[0] + rec.u[0] * MM(a), rec.y + MM(yy), rec.o[1] + rec.u[1] * MM(a)), kk = ++k;
      steps.push(drill(app, p0, n, 0.4, 90), [0, () => this.view.setAnim(key, { anchors: kk })]);
    }
    steps.push([1, (u) => this.view.setAnim(key, { anchors: 4, brackets: u })]);
    steps.push([1.2, (u) => this.view.setAnim(key, { anchors: 4, brackets: 1, glass: u })]);
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); this.view.setAnim(key, null); }, commit: () => {
      app.journal.commit(app.clock); this.view.setAnim(key, null);
      this.toast(`Козырёк ${(rec.W / 1000).toFixed(1)} × ${(rec.P / 1000).toFixed(1)} м: 4 химических анкера М12, кронштейны из нержавейки с тягами, триплекс 8+8 мм`.replace(/(\d)\.(\d)/g, '$1,$2'));
    } });
  }
  next(r = this.app.objects.all('porch').at(-1)) {
    if (this.what === 'canopy') return [null, 'Коснитесь у двери — козырёк над входом'];
    if (!r) return ['dig', 'Коснитесь у входной двери — начнём крыльцо'];
    const d = r.done || {};
    for (const k of ORDER) if (!d[k]) return [k, NAME[k]];
    return [null, 'Крыльцо готово'];
  }
  status() {
    if (this.what === 'canopy') return 'Коснитесь у входной двери — над ней повесят стеклянный козырёк';
    return {
      dig: 'Коснитесь у входной двери — крыльцо по её порогу: площадка 1,2 м и ступени до земли; котлован 300 мм',
      grav: 'Коснитесь крыльца — щебень 150 мм с трамбовкой',
      form: 'Коснитесь крыльца — опалубка ступеней',
      conc: 'Коснитесь крыльца — бетон снизу вверх',
      strip: 'Коснитесь крыльца — снять опалубку',
      tile: `Коснитесь крыльца — облицовка «${PORCH_TILES[this.tile][0]}»`,
    }[this.layer];
  }
  remove(id) {
    const app = this.app, r = app.objects.get(id); if (!r) return;
    app.journal.act(r.type + '-remove', {}, app.clock, () => app.objects.remove(id));
    this.toast(r.type === 'canopy' ? 'Козырёк сняли' : 'Крыльцо убрали');
  }
}
