import * as THREE from 'three';
import { MODEL_SCALE, M_SAND, M_G20 } from '../config.js';
import { findHouse } from './pitchedTool.js';
import { uStrength } from './lintels.js';
import { BLIND, BLIND_LAYERS, BLIND_FIN, TILE_COLOURS, planOf, newBlind, layerTop, leftOf, runsOf, setOf, layerSet, heights, LOOSE } from '../world/blind.js';

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
  // the area worked on: the one last under the finger (each building its own)
  get rec() { const all = this.app.objects.all('blind'); return all.find((r) => r.id === this.sel) || all.at(-1) || null; }
  // the area at a point: the one it lies in, else the one whose house is nearest
  pick(p) {
    const all = this.app.objects.all('blind');
    if (!p || all.length < 2) { this.sel = all[0]?.id; return; }
    let best = null, bd = Infinity;
    for (const r of all) {
      const P = planOf(r), [a, d] = P.frame(p.x, p.z), k = P.cellAt(a, d);
      if (k >= 0 && P.cells.has(k)) { best = r; break; }
      for (const R of r.rects) { const q = Math.hypot(Math.max(0, R[0] - a, a - R[2]), Math.max(0, R[1] - d, d - R[3])); if (q < bd) bd = q, best = r; }
    }
    if (best) this.sel = best.id;
  }
  // the area of a house already there (its first wing's middle inside the area's walls)
  _of(H) {
    const w = H.wings[0];
    return this.app.objects.all('blind').find((r) => { const a = w.cx * r.ux + w.cz * r.uz, d = -w.cx * r.uz + w.cz * r.ux; return r.rects.some((R) => a > R[0] && a < R[2] && d > R[1] && d < R[3]); }) || null;
  }
  // (nothing was shown over the area: nothing to take off — it is not rebuilt for that)
  _live(live) { const v = this.app.wallView; if (!live && !v.liveBlind) return; v.liveBlind = live && !live.form ? { ...live, id: this.rec?.id ?? null } : live; v.blindDirty = true; }
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
  _house(p) {
    const app = this.app, H = findHouse(app, p);
    if (!H) return null;
    return H;
  }

  // ---- the layers by the finger ----
  //   geo, mesh – a strip off the roll / a run of sheets along the wall the finger starts at,
  //               the whole width of the area, as far as it is drawn;
  //   sand, grav – the ground's loose cover (terrain.js, as the sand of «Материалы»): the finger
  //               tips the shovel (a heap grows under it), or is the rake of «Земля»; the
  //               shovel brings it from a heap too; the boards hold it in;
  //   fin        – concrete from the hose or the bucket («Бетон»); paving by the finger.
  down(p, e) {
    if (!this.isCarry) this.pick(p);
    const app = this.app, L = this.layer, r = this.rec;
    if (this.isCarry) { app.ui.toast(this.status(false)); return true; }
    if (!r) { app.ui.toast('Отмостка: сначала опалубка — тяните её из лотка к дому'); return true; }
    if (L === 'strip') { this._strip(r); return true; }
    if (L === 'mesh' && (r.finKind || this.fin) === 'tile') { app.ui.toast('Под плитку сетка не нужна: плитка ложится на щебень с песком — выберите «Бетон / плитка»'); return true; }
    if (L === 'fin' && this.fin === 'conc') { app.ui.toast(r.mesh?.length ? 'Бетон отмостки — как в любую опалубку: «Бетон» → шланг или ведро по щебню и сетке, потом вибратор, правило по доскам и кельма' : 'Сначала сетка'); return true; }
    const need = L === 'fin' ? 'grav' : UNDER[L];
    if (need !== 'form' && !layerSet(r, need).size) { app.ui.toast(`Сначала «${NAME[need]}»`); return true; }
    if (L === 'fin' && r.finKind && r.finKind !== this.fin) { app.ui.toast(`Здесь уже ${r.finKind === 'tile' ? 'плитка' : 'бетон'} — продолжайте им (или снимите «Удалить»)`); return true; }
    const y = layerTop(r, L === 'fin' ? 'grav' : need === 'form' ? 'geo' : need);
    const h = this._at(e, r, y);
    if (!h) return true;
    const P = planOf(r), k = P.cellAt(h.a, h.d), c = k >= 0 ? P.cells.get(k) : null;
    if (!c) { app.ui.toast('Ведите по отмостке — между стеной и досками'); return true; }
    const under = need === 'form' ? null : layerSet(r, need);
    if (under && !under.has(k)) { app.ui.toast(`Здесь ещё нет слоя «${NAME[need]}»`); return true; }
    if (L === 'sand' || L === 'grav') {
      const t = app.terrain, mode = ['rake', 'rule'].includes(app.settings.blindAct) ? app.settings.blindAct : 'pour';
      if (mode === 'rule') {
        // the rule on the marks: the layer's top level all across, the surplus pushed on
        app.journal.begin('blind-rule', { layer: L }, app.clock);
        this.drag = { r, y, L, rule: true, a: h.a, d: h.d, carry: new Float64Array(4), top: r.g + MM(7 + LOOSE[L].t * (L === 'sand' ? 1 : 2)) };
        this._ruleShow(this.drag, null, true);
        app.ui.toast(`Правило: ведите вдоль стены — ${L === 'sand' ? 'песок' : 'щебень'} срезается ровно на ${L === 'sand' ? 60 : 120} мм от геотекстиля, лишнее тащится вперёд и засыпает ямки`);
        return true;
      }
      void t;
      if (mode === 'rake') {
        // the rake of «Земля» (rakeTool.js): over the ground's cover, inside the boards
        this.drag = { r, y, L, rake: true };
        app.rakeTool.down(new THREE.Vector3(h.q.x, 0, h.q.z));
        app.ui.toast('Грабли: ведите вдоль стены — срезают кучи, валик падает в ямки; слой 60 мм');
        return true;
      }
      app.journal.begin('blind-' + L, { pour: L }, app.clock);
      this.drag = { r, y, L, pour: true, x: h.q.x, z: h.q.z, a: h.a, d: h.d, t: 0, mat: L === 'sand' ? M_SAND : M_G20 };
      app.ui.toast(L === 'sand' ? 'Сыплем песок — держите палец, куча растёт; потом «Грабли — разровнять»' : 'Сыплем щебень — держите палец, куча растёт; потом «Грабли — разровнять»');
      void t;
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
    if (d.rake) { this.app.rakeTool.move(new THREE.Vector3(h.q.x, 0, h.q.z)); return; }
    if (d.rule) {
      const da = h.a - d.a, dd = h.d - d.d, L = Math.hypot(da, dd), step = this.app.terrain.cell * 0.7;
      if (L < step) return;
      const ua = da / L, ud = dd / L, n = Math.ceil(L / step);
      // (the first move: the rule set down a little behind — it takes up the tail of the last
      // windrow, which has run back over where the finger starts)
      if (!d.u) { const back = MM(900), m = Math.ceil(back / step); for (let k = 0; k <= m; k++) this._ruleStep(d, d.a - ua * back * (1 - k / m), d.d - ud * back * (1 - k / m), ua, ud); }
      for (let k = 1; k <= n; k++) this._ruleStep(d, d.a + da * k / n, d.d + dd * k / n, ua, ud);
      d.a = h.a; d.d = h.d; d.u = [ua, ud];
      this._ruleShow(d, d.u);
      return;
    }
    if (d.pour) { d.x = h.q.x; d.z = h.q.z; d.a = h.a; d.d = h.d; return; }
    if (d.along) { d.s1 = d.along === 'd' ? h.d : h.a; this._band(); this._show(); return; }
    if (d.last) { const n = Math.ceil(Math.hypot(h.a - d.last[0], h.d - d.last[1]) / (BRUSH * 0.5)); for (let k = 1; k < n; k++) this._dab(d.last[0] + (h.a - d.last[0]) * k / n, d.last[1] + (h.d - d.last[1]) * k / n); }
    this._dab(h.a, h.d);
    this._show();
  }
  // one position of the rule (a, dd; drawn along ua, ud): across the whole width of the area,
  // what is over the top line taken off and carried, the hollows under it filled from it
  // (dump: what is carried is all laid down here)
  _ruleStep(d, a, dd, ua, ud, dump = false) {
    const t = this.app.terrain, P = planOf(d.r), W = d.r.W + P.C, cell = t.cell, seg = (this._seg ||= { m: new Uint8Array(8), h: new Float64Array(8), n: 0 });
    const order = d.L === 'sand' ? [1, 2, 3, 0] : [3, 2, 1, 0];
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1, total = 0;
    const pts = [];
    for (let q = -W; q <= W; q += cell * 0.7) {
      const [x, z] = P.W2(a - ud * q, dd + ua * q), i = t.index(x, z);
      if (t.zone[i] !== 1 || t.conc[i] > 1e-6 || pts.includes(i)) continue;
      pts.push(i);
    }
    if (dump) { total = d.carry.reduce((s, v) => s + v, 0); if (!pts.length || total <= 0) return; }
    for (const i of pts) {
      const s = t.nat[i] + t.loose[i];
      if (dump) { for (const m of order) if (d.carry[m] > 0) t._push(i, d.carry[m] / pts.length, m); }
      else if (s > d.top + 1e-7) {
        t._pop(i, s - d.top, seg);
        for (let k = 0; k < seg.n; k++) d.carry[seg.m[k]] += seg.h[k];
      } else if (s < d.top - 1e-7) {
        let need = d.top - s;
        for (const m of order) { if (need <= 0) break; const g = Math.min(need, d.carry[m]); if (g > 0) { t._push(i, g, m); d.carry[m] -= g; need -= g; } }
      }
      const ix = i % t.nx, iz = (i / t.nx) | 0;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
    if (dump) d.carry.fill(0);
    if (x1 >= 0) t._touch(x0, z0, x1, z1);
  }
  // what the rule carries when it is lifted: into the hollows round where it stopped (nearest
  // first, up to the mark, within 1,5 m) — only the rest is left as a windrow
  _ruleFill(d) {
    const t = this.app.terrain, P = planOf(d.r), [cx, cz] = P.W2(d.a, d.d), R = MM(1500), n = Math.ceil(R / t.cell);
    const ci = Math.round(t.toCellX(cx)), cj = Math.round(t.toCellZ(cz)), list = [];
    for (let iz = Math.max(0, cj - n); iz <= Math.min(t.rz, cj + n); iz++) for (let ix = Math.max(0, ci - n); ix <= Math.min(t.rx, ci + n); ix++) {
      const i = iz * t.nx + ix, r2 = (ix - ci) ** 2 + (iz - cj) ** 2;
      if (r2 > n * n || t.zone[i] !== 1 || t.conc[i] > 1e-6) continue;
      const need = d.top - (t.nat[i] + t.loose[i]);
      if (need > 1e-7) list.push([r2, i, need]);
    }
    list.sort((p, q) => p[0] - q[0]);
    const order = d.L === 'sand' ? [1, 2, 3, 0] : [3, 2, 1, 0];
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (const [, i, need0] of list) {
      let need = need0;
      for (const m of order) { if (need <= 0) break; const g = Math.min(need, d.carry[m]); if (g > 0) { t._push(i, g, m); d.carry[m] -= g; need -= g; } }
      const ix = i % t.nx, iz = (i / t.nx) | 0;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
      if (d.carry.every((v) => v <= 0)) break;
    }
    if (x1 >= 0) t._touch(x0, z0, x1, z1);
  }
  // what is still carried after that: laid on ahead as a low wedge (up to 40 mm over the mark
  // where the rule stopped, thinning out to nothing 2 m on) — the next stroke takes it up
  _ruleSpread(d, ua, ud) {
    const t = this.app.terrain, P = planOf(d.r), W = d.r.W + P.C, cell = t.cell, len = MM(2000), order = d.L === 'sand' ? [1, 2, 3, 0] : [3, 2, 1, 0];
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    const seen = new Set();
    for (let s = 0; s <= len && d.carry.some((v) => v > 0); s += cell * 0.7) {
      const cap = d.top + MM(40) * (1 - s / len), a = d.a + ua * s, dd = d.d + ud * s;
      for (let q = -W; q <= W; q += cell * 0.7) {
        const [x, z] = P.W2(a - ud * q, dd + ua * q), i = t.index(x, z);
        if (seen.has(i) || t.zone[i] !== 1 || t.conc[i] > 1e-6) continue;
        seen.add(i);
        let room = cap - (t.nat[i] + t.loose[i]);
        for (const m of order) { if (room <= 0) break; const g = Math.min(room, d.carry[m]); if (g > 0) { t._push(i, g, m); d.carry[m] -= g; room -= g; } }
        const ix = i % t.nx, iz = (i / t.nx) | 0;
        if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
      }
    }
    if (x1 >= 0) t._touch(x0, z0, x1, z1);
  }
  // the rule in the hands (concreteGear.js): on the top line, across the way it is drawn
  _ruleShow(d, u, snap = false) {
    const P = planOf(d.r), [x, z] = P.W2(d.a, d.d), [ex, ez] = u ? P.W2(u[0], u[1]) : [1, 0];
    this.app.concreteGear.set('screed', new THREE.Vector3(x, d.top, z), Math.atan2(ex, ez), snap);
  }
  // the shovel tips while the finger is held (sand / gravel)
  update(dt) {
    this._migrate();
    this._cover(dt);
    const d = this.drag;
    if (!d?.pour) return;
    // (into the ground's cover at the finger: it runs down with the rest, inside the boards)
    const t = this.app.terrain, l = (d.L === 'sand' ? 60 : 50) * dt;
    d.t += dt;
    t.deposit(d.x, d.z, l / 1000 / MODEL_SCALE ** 3, MM(90), 0, d.mat);
    if ((d.f = (d.f || 0) + 1) % 2 === 0) this._show();
  }
  // the geotextile hides what came under it: the ground there held at its level (a hole filled,
  // a bump cut), crumbs of soil that fell or ran onto it from the building round (up to 40 mm,
  // under the sand / gravel laid on it) pressed under the sheet — it lies flat, a thin sheet
  _cover(dt) {
    const t = this.app.terrain;
    if (this.drag) return;
    if ((this._covT = (this._covT || 0) + dt) < 0.25 || t.version === this._covV) return;
    this._covT = 0;
    for (const r of this.app.objects.all('blind')) if (r.geo?.length && !r.fin?.length) this._coverOne(r);
    this._covV = t.version;
  }
  _coverOne(r) {
    const t = this.app.terrain, c = ((this._cov ||= new Map()).get(r.id) || this._cov.set(r.id, {}).get(r.id));
    const key = r.g + ':' + JSON.stringify(r.geo);
    if (c.k !== key) {
      const P = planOf(r), geo = setOf(r.geo), cs = [...geo].map((k) => P.cells.get(k)).filter(Boolean).map((c) => P.W2(c.a, c.d)), out = [];
      if (cs.length) {
        const ix0 = Math.max(0, Math.floor(t.toCellX(Math.min(...cs.map((q) => q[0])) - P.C))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(Math.max(...cs.map((q) => q[0])) + P.C)));
        const iz0 = Math.max(0, Math.floor(t.toCellZ(Math.min(...cs.map((q) => q[1])) - P.C))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(Math.max(...cs.map((q) => q[1])) + P.C)));
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) if (geo.has(P.cellAt(...P.frame(t.toWorldX(ix), t.toWorldZ(iz))))) out.push(iz * t.nx + ix);
      }
      c.i = Int32Array.from(out); c.k = key;
    }
    const base = r.g + MM(7), cap = MM(40), L = 3, { nat, lN, lM, lH, loose, conc } = t;
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (const i of c.i) {
      if (conc[i] > 1e-6) continue;
      let ch = false;
      if (Math.abs(nat[i] - base) > 1e-7) { nat[i] = base; ch = true; }
      const n = lN[i], b = i * L;
      let cut = 0, h = 0;
      while (cut < n && lM[b + cut] === 0) h += lH[b + cut++];
      if (cut && h <= cap) {
        for (let k = cut; k < n; k++) { lH[b + k - cut] = lH[b + k]; lM[b + k - cut] = lM[b + k]; }
        for (let k = n - cut; k < n; k++) lH[b + k] = 0;
        lN[i] = n - cut; loose[i] = Math.max(0, loose[i] - h); ch = true;
      }
      if (!ch) continue;
      const ix = i % t.nx, iz = (i / t.nx) | 0;
      if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
    }
    if (x1 >= 0) t._touch(x0, z0, x1, z1);
  }
  // older areas kept their sand / gravel in themselves: onto the ground with it (once)
  _migrate() {
    const r = this.rec, t = this.app.terrain;
    // (a geotextile laid before the ground was levelled under it, BUILD 130: the ground under
    // it set to its level once — what lies on it stays, the cushion's marks hold)
    // (once a session for each area: undone, it is not done again over the user's «Отменить»)
    const once = (this._migrated ||= new Set());
    if (r && !this.app.journal.pending && r.geo?.length && !r.based && !r.fin?.length && !Array.isArray(r.sandH) && !once.has(r.id)) {
      once.add(r.id);
      const P = planOf(r), geo = setOf(r.geo), cs = [...geo].map((k) => P.cells.get(k)).filter(Boolean).map((c) => P.W2(c.a, c.d));
      if (cs.length) {
        const box = [Math.min(...cs.map((q) => q[0])) - P.C, Math.min(...cs.map((q) => q[1])) - P.C, Math.max(...cs.map((q) => q[0])) + P.C, Math.max(...cs.map((q) => q[1])) + P.C];
        this.app.journal.act('blind-base', {}, this.app.clock, () => { t.setBase((x, z) => geo.has(P.cellAt(...P.frame(x, z))), r.g + MM(7), box); this.app.objects.update(r.id, { based: true }); });
        return;
      }
    }
    if (!r || this.app.journal.pending || !(Array.isArray(r.sandH) || Array.isArray(r.gravH) || (!r.fin?.length && (r.sand?.length || r.grav?.length)))) return;
    const P = planOf(r), A = P.C * P.C;
    this.app.journal.act('blind-migrate', {}, this.app.clock, () => {
      for (const [L, mat] of [['sand', M_SAND], ['grav', M_G20]]) {
        const h = heights(r, L), keys = [...P.cells.keys()];
        keys.forEach((k, n) => { if (h[n] > 0.5) { const c = P.cells.get(k), [x, z] = P.W2(c.a, c.d); t.deposit(x, z, MM(h[n]) * A, P.C * 0.5, 0, mat); } });
      }
      this.app.objects.update(r.id, { sand: [], grav: [], sandH: null, gravH: null });
    });
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
    // (the stream alone: its grains moved, the area itself not rebuilt — walls.js)
    if (d.pour) { this.app.wallView.blindStream = { r: d.r, L: d.L, a: d.a, d: d.d, t: d.t, y: this.app.terrain.heightAt(d.x, d.z) }; return; }
    this._live({ layer: d.L, cells: [...d.cells], kind: this.fin, col: this.col, roll: d.L === 'geo' ? d.roll : null });
  }
  up() {
    const d = this.drag, app = this.app, L = d?.L;
    this.drag = null; this.app.wallView.blindStream = null;
    this._live(null);
    if (!d) return;
    if (d.rule) {
      // what the rule still carries: a windrow ahead of where it stopped
      const t = app.terrain, [ua, ud] = d.u || [1, 0];
      const left0 = d.carry.reduce((q, v) => q + v, 0);
      if (left0 > 0) this._ruleFill(d);
      if (d.carry.reduce((q, v) => q + v, 0) > 0) this._ruleSpread(d, ua, ud);
      if (d.carry.reduce((q, v) => q + v, 0) > 0) this._ruleStep(d, d.a + ua * MM(2100), d.d + ud * MM(2100), ua, ud, true);
      for (let i = 0; i < 40000 && t.active; i++) t.relax(1);
      app.journal.commit(app.clock); app.concreteGear.set(null);
      const left = Math.round(leftOf(d.r, L) * 100), nm = L === 'sand' ? 'Песок' : 'Щебень';
      app.ui.toast(`${nm} выровняли правилом` + (left > 1 ? ` — ровным слоем ещё не покрыто ${left} % (где не хватило — досыпьте и пройдите ещё раз)` : ' — по всему дому'));
      return;
    }
    if (d.rake || d.pour) {
      const t = app.terrain;
      if (d.rake) app.rakeTool.up();
      else { for (let i = 0; i < 40000 && t.active; i++) t.relax(1); app.journal.commit(app.clock); }
      const left = Math.round(leftOf(d.r, L) * 100), nm = L === 'sand' ? 'Песок' : 'Щебень';
      app.ui.toast(d.pour ? `${nm}: куча насыпана — «Правило — ровно» и ведите вдоль стены (или «Грабли»)` : `${nm} разровняли граблями` + (left > 1 ? ` — слоем 60 мм ещё не покрыто ${left} %` : ' — по всему дому'));
      return;
    }
    if (!d.cells.size) { app.ui.toast(`Здесь ${L === 'geo' ? 'нечего застилать' : 'уже готово или нет слоя под ним'}`); return; }
    const patch = { [L]: runsOf(new Set([...setOf(d.r[L]), ...d.cells])) };
    if (L === 'fin' && !d.r.finKind) { patch.finKind = this.fin; patch.finCol = this.col; }
    if (L === 'geo') {
      // (the ground under the strip levelled to the sheet: what is poured on lies on it)
      const P = planOf(d.r), cs = [...d.cells].map((k) => P.cells.get(k)), pts = cs.map((c) => P.W2(c.a, c.d)), pad = P.C;
      const box = [Math.min(...pts.map((q) => q[0])) - pad, Math.min(...pts.map((q) => q[1])) - pad, Math.max(...pts.map((q) => q[0])) + pad, Math.max(...pts.map((q) => q[1])) + pad];
      app.journal.act('blind-geo', {}, app.clock, () => { app.objects.update(d.r.id, patch); app.terrain.levelTo((x, z) => d.cells.has(P.cellAt(...P.frame(x, z))), d.r.g + MM(7), box, MM(100)); });   // (a thin crust of concrete run out of the forms: broken off under the strip)
    } else this._save(d.r, patch, 'blind-' + L);
    const left = Math.round(leftOf({ ...d.r, ...patch }, L) * 100);
    const what = { geo: 'Геотекстиль раскатали полосой вдоль стены', mesh: 'Сетка 150 × 150 из прутка Ø5 на стульчиках — листы внахлёст', fin: `Плитка «кирпичик» (${TILE_COLOURS[d.r.finCol || this.col][0].toLowerCase()}) на сухую смесь, уклон 3 % от стен` }[L];
    app.ui.toast(what + (left > 1 ? ` — осталось ${left} %` : ' — по всему дому'));
  }
  // the boards come off (the top is all done)
  _strip(r, del = false) {
    const app = this.app, more = del ? ' (а слои — «Удалить» по самой отмостке, сверху вниз)' : '';
    if (r.stripped) { app.ui.toast('Опалубку уже сняли'); return; }
    if (!r.fin?.length || leftOf(r, 'fin') > 0.05) { app.ui.toast('Доски снимают, когда верх готов — бетон или плитка по всему периметру' + more); return; }
    // (its strength counts from the pour: or from the last concrete put in, if it never quite filled)
    if (r.finKind === 'conc') { const k = uStrength({ pourT: r.pourT ?? r.wetT ?? r.castT }, app.clock); if (k < 1) { app.ui.toast(`Бетон набирает прочность: ${Math.round(k * 100)} % — доски рано снимать` + more); return; } }
    this._save(r, { stripped: true, ...(r.finKind === 'conc' ? { set: true } : {}) }, 'blind-strip');
    app.ui.toast(r.finKind === 'tile' ? 'Доски сняли — по краю остался бордюр' : 'Бетон набрал прочность — доски и колышки сняли');
  }

  // ---- the boards, the channels: carried from the tray ----
  carryMove(p, e) {
    const app = this.app, L = this.layer;
    this.place = null;
    if (L === 'form') {
      // (round the building at the finger: a house, a garage beside it — each its own area)
      const H = this._house(p);
      if (!H) { this._live(null); this.place = { why: 'Нет дома: отмостку делают вокруг готовых стен' }; return; }
      const r = this._of(H);
      if (r && (r.geo?.length || r.fin?.length)) { this._live(null); this.place = { why: 'Опалубка уже стоит и по ней уложены слои — чтобы переставить её заново по земле, снимите слои: «Удалить» по отмостке (сверху вниз до геотекстиля включительно), потом поднесите опалубку ещё раз' }; return; }
      const W = this.app.settings.blindW || 1000;
      const rec0 = newBlind(H, W), rec = { ...rec0, g: +this._ground(H, { ...rec0, g: H.g }).toFixed(6), form: true, based: true };   // (the ground levelled under each strip as it is laid)
      this.place = { rec, W, old: r?.id ?? null };
      this._live({ form: rec, old: r?.id ?? null });
      return;
    }
    this.pick(p);
    const r = this.rec;
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
  // the ground the boards stand on: its surface (all of it — the soil, the sand, the gravel lying
  // there) along the line of the boards every 100 mm. The level found over half the perimeter and
  // more (within ±25 mm) — that one; if no level holds half of it, the mean of all
  _ground(H, rec) {
    const t = this.app.terrain, hs = [], P = planOf(rec);
    for (const sg of P.segs) for (let q = sg.s0; q <= sg.s1; q += MM(100)) {
      const [x, z] = sg.axis === 'a' ? P.W2(q, sg.at) : P.W2(sg.at, q);
      if (t.inside(x, z)) hs.push(t.heightAt(x, z));
    }
    if (!hs.length) return H.g;
    hs.sort((p, q) => p - q);
    let best = 0, b0 = 0;
    for (let i = 0, j = 0; i < hs.length; i++) { while (hs[i] - hs[j] > MM(50)) j++; if (i - j + 1 > best) best = i - j + 1, b0 = j; }
    const pick = best >= hs.length * 0.5 ? hs.slice(b0, b0 + best) : hs;
    return pick.reduce((a, v) => a + v, 0) / pick.length;
  }
  carryDrop() {
    const app = this.app, P = this.place, L = this.layer, r = this.rec;
    this.place = null; this._live(null);
    if (!P) { app.ui.toast(this.status(false)); return; }
    if (P.why) { app.ui.toast(P.why); return; }
    if (L === 'form') {
      const n = planOf(P.rec).segs.reduce((s, sg) => s + sg.s1 - sg.s0, 0) / S / 1000;
      // (the boards of this house set again: the old ones off; another house: an area of its own)
      let id = null; app.journal.act('blind-form', {}, app.clock, () => { if (P.old != null) app.objects.remove(P.old); const o = app.objects.add({ type: 'blind', ...P.rec }); id = o?.id ?? o; });
      if (id != null) this.sel = id;
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
      sand: this.app.settings.blindAct === 'rule' ? 'Правило: ведите вдоль стены — песок ровно на 60 мм от геотекстиля, лишнее тащится вперёд в ямки' : this.app.settings.blindAct === 'rake' ? 'Грабли: ведите вдоль стены по песку — срезают кучи' : 'Песок: держите палец — сыплется кучей; или лопатой с кучи, или доставка из «Материалов» — всё ляжет на геотекстиль; потом «Правило — ровно 60 мм»',
      grav: this.app.settings.blindAct === 'rule' ? 'Правило: ведите вдоль стены — щебень ровно на 120 мм от геотекстиля (60 мм по песку)' : this.app.settings.blindAct === 'rake' ? 'Грабли: ведите вдоль стены по щебню — срезают кучи' : 'Щебень: держите палец — сыплется кучей (или лопатой с кучи щебня); потом «Правило — ровно 120 мм»',
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
    // (on the boards: they come off — the layers stay)
    if (app.lastPick?.object?.userData?.part === 'form' && !r.stripped && (r.geo?.length || r.mesh?.length || r.fin?.length)) { this._strip(r, true); return; }
    const steps = [['drains', 'лотки'], ['stripped', null], ['fin', 'верх'], ['mesh', 'сетку'], ['geo', 'геотекстиль']];   // (the sand, the gravel: the shovel takes them off)
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
