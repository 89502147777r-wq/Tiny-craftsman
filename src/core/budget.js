import * as THREE from 'three';
import { MODEL_SCALE, M_SAND, M_G5, M_G20 } from '../config.js';
import { pitBox, DECKS, deckRing } from '../world/pool.js';

// The budget (a mode of play): the money to build the house with, in US dollars.
//   – the masonry units come on pallets bought beforehand (gas block, brick, cinder block): a
//     pallet bought stands on the plot at once; each unit laid comes off the nearest one;
//   – the rest is paid as it is used: whatever an action put in (concrete by the m³, sand and
//     crushed stone delivered, bars by the metre, formwork, insulation, panels, the roof by the m²,
//     windows, doors …) is priced when it goes into the journal — in the same entry, so undo gives
//     the money back. A «−$231» floats up where it was done, and the till rings.
// The money: one record { type: 'budget', money, start }; none — the free mode (no money, the
// tray never runs out). A pallet: { type: 'stock', kind, x, z, yaw, n }.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const M3 = MODEL_SCALE ** 3, M2 = MODEL_SCALE ** 2, M1 = MODEL_SCALE;

// the pallets: how many units on one, the stack (along × across × layers), the price
export const PALLETS = {
  block: { name: 'Газоблок 600×250×300', short: 'Газоблок', of: 'газоблока', n: 36, na: 2, nc: 3, L: 600, H: 250, T: 300, usd: 140 },
  brick: { name: 'Кирпич 250×120×65', short: 'Кирпич', of: 'кирпича', n: 336, na: 4, nc: 6, L: 250, H: 65, T: 120, usd: 185 },
  cinder: { name: 'Шлакоблок 390×190×188', short: 'Шлакоблок', of: 'шлакоблока', n: 75, na: 3, nc: 5, L: 390, H: 188, T: 190, usd: 165 },
};
export const STARTS = [50000, 100000, 200000];
// the prices (USD, about what a builder pays in the US / Europe)
export const PRICE = {
  concrete: 165,     // m³, ready-mix C25 delivered
  sand: 38, gravel: 48,   // m³ delivered
  rebar: 0.85, wire6: 0.22,   // per metre (Ø10–16, Ø6 stirrups)
  board: 14,         // m² of formwork boards (timber)
  deck: 18,          // m² of slab formwork (deck, beams, props — hired)
  lintel: 32,        // per metre of a precast lintel
  ublock: 6,         // each
  window: 290, windowBig: 480, door: 650, garage: 1600, rwin: 520, rail: 260,   // m² / each / m
  eps: 6, wool: 5, glue: 3, mesh: 1.5, plaster: 7, membrane: 1.5, bracket: 2.5, railM: 4,
  panel: { stone: 34, clinker: 30, wood: 38, porc: 46, fc: 36, hpl: 62, cas: 42 },
  roof: { joists: 10, frame: 18, memb: 2.5, battens: 5, cover: { metal: 14, seam: 26, shingle: 17 }, ridge: 150, trim: 380, gutter: 460, plate: 12 },
  flat: 22,          // m² per layer of a flat roof
  blindM2: 9,        // m² per layer of the blind area (geotextile, mesh, tiles)
  bitumen: 3,        // m² coat
  column: { cage: 45, form: 35 },
  // the pool: the coating per m² per coat, the glass mosaic per m² (with its glue), a coping stone,
  // the embeds (2 skimmers, 3 inlets, 2 lights, the main drain), water per m³
  pool: { coat: 6, mosaic: 48, stone: 28, embeds: 1250, water: 2, joists: 24 },
  haul: 18,          // m³ of soil taken off the plot by the dump truck
};

export class Budget {
  constructor(app) {
    this.app = app;
    this.el = null; this.pops = null;
  }
  get rec() { return this.app.objects.all('budget')[0] || null; }
  get on() { return !!this.rec; }
  get money() { return this.rec?.money ?? 0; }

  // the HUD: the money in the top bar; the «−$…» popups
  mount() {
    const top = document.querySelector('.top-actions');
    if (top && !this.el) { this.el = document.createElement('div'); this.el.id = 'money'; top.prepend(this.el); }
    if (!this.pops) { this.pops = document.createElement('div'); this.pops.id = 'pops'; document.body.appendChild(this.pops); }
    this.refresh();
  }
  refresh() {
    if (!this.el) return;
    const r = this.rec;
    this.el.hidden = !r;
    if (!r) return;
    this.el.textContent = `$ ${fmt(r.money)}`;
    this.el.classList.toggle('neg', r.money < 0);
  }
  start(amount) {
    const app = this.app, r = this.rec;
    app.journal.act('budget', {}, app.clock, () => { if (r) app.objects.update(r.id, { money: amount, start: amount }); else app.objects.add({ type: 'budget', money: amount, start: amount }); });
    app.ui.toast(`Бюджет $${fmt(amount)}: купите поддоны блоков или кирпича (Кладка → 🛒), остальное — бетон, арматура, доски, панели… — списывается по ходу работы`);
    this.refresh();
  }
  stop() {
    const app = this.app, r = this.rec;
    if (!r) return;
    app.journal.act('budget-off', {}, app.clock, () => app.objects.remove(r.id));
    app.ui.toast('Стройка без денег: материалы не кончаются');
    this.refresh();
  }

  // ---- pallets ----
  stockOf(kind) { const k = kind === 'ublock' ? null : kind; return this.app.objects.all('stock').filter((s) => s.kind === k).reduce((a, s) => a + s.n, 0); }
  // the units of this kind needed (the free mode: always there)
  has(kind) { return !this.on || !PALLETS[kind] || this.stockOf(kind) > 0; }
  // take one off the nearest pallet (inside the journal entry of the laying)
  take(kind, p) {
    if (!this.on || !PALLETS[kind]) return true;
    const list = this.app.objects.all('stock').filter((s) => s.kind === kind && s.n > 0);
    if (!list.length) return false;
    const s = p ? list.reduce((a, q) => (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? q : a)) : list[0];
    this.app.objects.update(s.id, { n: s.n - 1 });
    return true;
  }
  noStock(kind) { this.app.ui.toast(`На участке кончился ${PALLETS[kind]?.short.toLowerCase() || 'материал'} — купите поддон: Кладка → 🛒 Купить поддон`); }
  // a pallet bought: on the plot near the middle of the view, clear of the masonry and the others
  buy(kind) {
    const app = this.app, P = PALLETS[kind];
    if (!this.on) return;
    if (this.money < P.usd) { app.ui.toast(`Не хватает денег: поддон стоит $${fmt(P.usd)}, осталось $${fmt(this.money)}`); app.sfx?.stab?.(); return; }
    const spot = this._spot();
    if (!spot) { app.ui.toast('Некуда поставить поддон — наведите камеру на свободную часть участка'); return; }
    app.journal.act('buy-pallet', { kind }, app.clock, () => {
      app.objects.add({ type: 'stock', kind, x: +spot.x.toFixed(6), z: +spot.z.toFixed(6), yaw: +spot.yaw.toFixed(4), n: P.n });
      this._pay([{ usd: P.usd, what: `Поддон: ${P.n} шт · ${P.name}` }], spot.p);
    });
  }
  // (a storage spot, as on site: on the bare ground beside the works, never on the foundation or a
  // slab, in a pit, in the way of the walls — 2 m clear of the masonry, the concrete, the marked
  // pits, the pools and the other pallets; the nearest such to the middle of the view)
  _spot() {
    const app = this.app, t = app.terrain, c = app.rig.goal.target, yaw = app.rig.goal.yaw, O = app.objects;
    const units = O.all('unit').filter((u) => u.p), stocks = O.all('stock'), clear = MM(2000);
    const near = (x, z) => {
      if (!t.inside(x, z) || Math.abs(x) > t.halfX - MM(1500) || Math.abs(z) > t.halfZ - MM(1500)) return true;
      for (let k = 0; k < 13; k++) {   // (the concrete, a pit, a heap round the spot)
        const a = k / 12 * Math.PI * 2, d = k === 12 ? 0 : clear * (k % 2 ? 1 : 0.5), qx = x + Math.cos(a) * d, qz = z + Math.sin(a) * d;
        if (!t.inside(qx, qz)) return true;
        const i = t.index(qx, qz);
        if (t.conc[i] > 1e-6 || t.top[i] > 1e-6 || t.loose[i] > MM(60) || Math.abs(t.heightAt(qx, qz) - t.heightAt(x, z)) > MM(150)) return true;
      }
      if (units.some((u) => Math.hypot(u.p[0] - x, u.p[2] - z) < clear)) return true;
      if (stocks.some((s2) => Math.hypot(s2.x - x, s2.z - z) < MM(1500))) return true;
      if (O.all('belt').some((b) => Math.hypot(b.o[0] - x, b.o[1] - z) < clear + b.ni * b.c)) return true;
      if (O.all('outline').some((o) => { const ps = o.kind === 'rect' ? [[o.x0, o.z0], [o.x1, o.z1]] : o.pts || []; if (!ps.length) return false; const xs = ps.map((q) => q[0]), zs = ps.map((q) => q[1]); return x > Math.min(...xs) - clear && x < Math.max(...xs) + clear && z > Math.min(...zs) - clear && z < Math.max(...zs) + clear; })) return true;
      if (O.all('pool').some((q) => { const [x0, z0, x1, z1] = pitBox(q); return x > x0 - clear && x < x1 + clear && z > z0 - clear && z < z1 + clear; })) return true;
      return false;
    };
    for (let ring = 0; ring < 30; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = (k / Math.max(1, ring * 6)) * Math.PI * 2, d = ring * MM(1200), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!near(x, z)) return { x, z, yaw: -yaw, p: new THREE.Vector3(x, t.heightAt(x, z), z) };
    }
    return null;
  }
  // a pallet taken away: the units still on it are sold back at their price
  remove(id) {
    const app = this.app, s = app.objects.get(id); if (!s) return;
    const P = PALLETS[s.kind], back = Math.round(P.usd * s.n / P.n);
    app.journal.act('pallet-remove', {}, app.clock, () => { app.objects.remove(id); if (back && this.on) this._pay([{ usd: -back, what: 'Возврат' }], null); });
    app.ui.toast(back ? `Поддон убрали — ${s.n} шт вернули поставщику: +$${fmt(back)}` : 'Пустой поддон убрали');
  }

  // ---- paying for what an action used (the journal: before its entry is committed) ----
  price(p) {
    if (!this.on) return;
    const app = this.app, O = app.objects, tx = O.tx;
    if (!tx) return;
    const items = [];
    const add = (usd, what) => { if (usd > 0.5) items.push({ usd, what }); };
    for (const [id, before] of tx) {
      const after = O.get(id);
      const type = after?.type || before?.type;
      if (type === 'budget' || type === 'stock') continue;
      try { this._priceRec(type, before, after, add); } catch { /* a record of an older shape */ }
    }
    // the ground: concrete in, sand and crushed stone brought, bitumen on it
    try { this._priceGround(p, add); } catch { /* no snapshot */ }
    if (items.length) this._pay(items, app.lastPoint || null);
  }
  _priceRec(type, b, a, add) {
    const P = PRICE;
    const isNew = !b && a, len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * M1;
    // (the boards of a formwork: 150 × 25, 6 m — how many for so many m² of shuttering)
    const boards = (m2) => Math.max(1, Math.ceil(m2 / (0.15 * 6)));
    if (type === 'unit' && isNew) {
      if (a.lintel) add(P.lintel * a.s[0] * M1, `Перемычка ${(a.s[0] * M1).toFixed(2)} м`);
      else if (a.kind === 'ublock') add(P.ublock, 'U-блок · 1 шт');
    } else if (type === 'form' && isNew) {
      const m2 = Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]) * M1 * Math.max(0.15, (a.y1 - a.y0) * M1);
      add(P.board * m2, `Доски 150×25 · ${boards(m2)} шт`);
    } else if (type === 'bar' && isNew) { const l = len(a.a, a.b); add(P.rebar * l, `Арматура · ${l.toFixed(1)} м`); }
    else if (type === 'mesh' && isNew) {
      const w = Math.abs(a.x1 - a.x0) * M1, d = Math.abs(a.z1 - a.z0) * M1, c = Math.max(0.05, (a.cell || MM(200)) * M1), l = w * (d / c + 1) + d * (w / c + 1);
      add(P.rebar * l, `Сетка ${(w * d).toFixed(1)} м² · ${Math.round(l)} м прутка`);
    } else if (type === 'cage' && isNew) {
      let m = 0, m6 = 0;
      for (const q of a.bars || []) { const l = len(q, q.slice(3)); if ((q[6] || 0) * M1 * 1000 < 8) m6 += l; else m += l; }
      add(P.rebar * m, `Арматура Ø12 · ${Math.round(m)} м (${(m * 0.888 / 1000).toFixed(2)} т)`);
      add(P.wire6 * m6, `Хомуты Ø6 · ${Math.round(m6)} м`);
    } else if (type === 'belt') {
      const cell = (a || b).c * M1, area = cell * cell;
      if (isNew) {
        const n = (a.lv || []).length, m2 = n * area;
        if (a.kind === 'slab') add(P.deck * m2, `Опалубка перекрытия ${m2.toFixed(0)} м² (аренда)`);
        else { const sh = m2 * 1.6 + (a.H || 0) * M1 * 2 * Math.sqrt(m2); add(P.board * sh, `Доски 150×25 · ${boards(sh)} шт`); }
      }
      if (a && b && a.lv && b.lv) {
        let v = 0; for (let i = 0; i < a.lv.length; i++) v += Math.max(0, (a.lv[i] || 0) - (b.lv[i] || 0)) / 1000 * area;
        add(P.concrete * v, `Бетон ${v.toFixed(2)} м³`);
      }
    } else if ((type === 'window') && isNew) {
      const m2 = (a.w || 1000) * (a.h || 1200) / 1e6, door = String(a.key || '').startsWith('door') || String(a.key || '').startsWith('gar');
      if (door) add(String(a.key).startsWith('gar') ? P.garage : P.door, String(a.key).startsWith('gar') ? 'Гаражные ворота · 1 шт' : 'Дверь · 1 шт');
      else add(m2 * (['pano', 'floor', 'corner', 'portal'].includes(a.key) ? P.windowBig : P.window), `Окно ${(a.w / 1000).toFixed(1)}×${(a.h / 1000).toFixed(1)} м`);
    } else if (type === 'rwin' && isNew) add(P.rwin, 'Мансардное окно');
    else if (type === 'rail' && isNew) add(P.rail * (a.len || 2000) / 1000, 'Ограждение');
    else if (type === 'facade') this._priceFacade(b || {}, a || {}, add);
    else if (type === 'proof') this._priceRoof(b, a, add);
    else if (type === 'roof') {
      const nb = Object.keys(b?.done || b?.layers || {}).length, na = Object.keys(a?.done || a?.layers || {}).length;
      if (na > nb) add(P.flat * (na - nb) * roofArea(a), 'Слой кровли');
    } else if (type === 'blind') {
      const cnt = (r) => ['geo', 'mesh', 'fin'].reduce((s, k) => s + runLen(r?.[k]), 0), c = (MM(100) * M1) ** 2;
      add(P.blindM2 * Math.max(0, cnt(a) - cnt(b)) * c, 'Отмостка');
    } else if (type === 'column') {
      const s0 = b?.stage ?? -1, s1 = a?.stage ?? -1;
      const hm = (a.h + (a.dep || 0)) * M1;
      if (s0 < 1 && s1 >= 1) add(P.rebar * hm * 4.6 + P.wire6 * hm * 5, `Арматура колонны · ${(hm * 4.6).toFixed(0)} м + хомуты`);
      if (s0 < 2 && s1 >= 2) add(P.board * hm * 1.2, `Фанера опалубки · ${(hm * 1.2).toFixed(1)} м²`);
      if (s0 < 3 && s1 >= 3) { const r = a.sec?.startsWith('p') || a.sec?.startsWith('r') ? +a.sec.slice(1) / 2000 : +a.sec.slice(2) / 1000; const sq = a.sec?.startsWith('sq'); const v = (sq ? r * r : Math.PI * r * r) * ((a.h + (a.dep || 0)) * M1); add(P.concrete * v, `Бетон ${v.toFixed(2)} м³`); }
    } else if (type === 'pool') {
      // the coats (cells 100 × 100, a coat each pass), the mosaic sheets (316 × 316), the stones, the embeds, the water
      const chars = (arr, f) => (arr || []).reduce((n, q) => n + (typeof q === 'string' ? [...q].reduce((m, c) => m + f(c), 0) : Array.isArray(q) ? q.length : 0), 0);
      const coats = (r) => chars(r?.proof, (c) => +c || 0), sheets = (r) => chars(r?.tile, (c) => (c !== '0' ? 1 : 0)), stones = (r) => chars(r?.cope, (c) => (c !== '0' ? 1 : 0));
      const dc = coats(a) - coats(b), dt = sheets(a) - sheets(b), ds = stones(a) - stones(b);
      if (dc > 0) add(P.pool.coat * dc * 0.01, `Гидроизоляция · ${(dc * 0.01).toFixed(1)} м² слоя`);
      if (dt > 0) add(P.pool.mosaic * dt * 0.1, `Мозаика · ${dt} листов (${(dt * 0.1).toFixed(1)} м²)`);
      if (ds > 0) add(P.pool.stone * ds, `Бортовой камень · ${ds} шт`);
      if (a && a.wall != null && b?.wall == null) add(P.pool.embeds, 'Закладные: 2 скиммера, 3 форсунки, 2 прожектора, слив');
      const dw = ((a?.water || 0) - (b?.water || 0)) / 1000 * (a?.L || 0) / 1000 * (a?.W || 0) / 1000;
      if (dw > 0.05) add(P.pool.water * dw, `Вода · ${dw.toFixed(1)} м³`);
      // the deck round it: its base (pads and joists — the slab is in the ground's concrete), the covering
      const dA = (q) => deckRing(q, q.base.w || 1500).reduce((s2, z) => s2 + (z[2] - z[0]) * (z[3] - z[1]), 0) / 1e6;
      if (a?.base && !b?.base && DECKS[a.base.key]?.base === 'joists') { const A = dA(a); add(P.pool.joists * A, `Опоры и лаги 50×100 · ${A.toFixed(1)} м² (${Math.ceil(A / 0.4 * 1.0)} м лаг)`); }
      if (a?.deck && !b?.deck && a.base) { const A = dA(a), D = DECKS[a.base.key]; add(D.usd * A, `${D.name} · ${A.toFixed(1)} м²${D.base === 'joists' ? ` (${Math.ceil(A / 0.146 / 4 * 1.05)} досок по 4 м)` : ` (${Math.ceil(A / (D.tile[0] * D.tile[1] / 1e6) * 1.05)} шт)`}`); }
    } else if (type === 'bitumen') {
      const sum = (r) => (r?.d || []).reduce((s, v, i) => s + (i % 4 === 3 ? v : 0), 0);
      add(P.bitumen * Math.max(0, sum(a) - sum(b)) * 0.006, 'Битум');
    }
  }
  _priceFacade(b, a, add) {
    const P = PRICE, d = (k) => Math.max(0, (a[k]?.length || 0) - (b[k]?.length || 0)), cell = (MM(50) * M1) ** 2;
    const cells = (r) => runLen(r), plc = (r) => Object.values(r?.pl || {}).reduce((s, x) => s + runLen(x), 0);
    add(P.eps * d('eps'), 'Утеплитель');
    add(P.wool * d('mw'), 'Минвата');
    add(P.bracket * d('br'), 'Кронштейны');
    add(P.railM * Math.max(0, len3(a.rl) - len3(b.rl)), 'Направляющие');
    add(P.membrane * Math.max(0, area4(a.mb) - area4(b.mb)), 'Мембрана');
    add(P.mesh * Math.max(0, area4(a.mesh) - area4(b.mesh)), 'Фасадная сетка');
    add(P.glue * Math.max(0, cells(a.glue) - cells(b.glue) + cells(a.emb) - cells(b.emb)) * cell, 'Клей');
    add(P.plaster * Math.max(0, plc(a) - plc(b)) * cell, 'Штукатурка');
    for (const k of ['pan', 'vp']) {
      const was = new Set((b[k] || []).map((q) => q.slice(0, 4).join(',')));
      let usd = 0; for (const q of a[k] || []) if (!was.has(q.slice(0, 4).join(','))) usd += P.panel[String(q[4]).split(':')[0]] || 35;
      add(usd, 'Панели');
    }
  }
  _priceRoof(b, a, add) {
    if (!a) return;
    const P = PRICE.roof, A = roofArea(a), kind = a.cover?.kind || 'metal';
    const share = (r, k) => { const v = r?.done?.[k]; if (v === true) return 1; if (!v?.length) return 0; let s = 0; for (const q of v) s += Math.abs(q[2] - q[1]); const tot = (r.wings || []).reduce((t, w) => t + 2 * w.A, 0) || 1; return Math.min(1, s / tot); };
    const per = { joists: P.joists * A, frame: P.frame * A, memb: P.memb * A, battens: P.battens * A, cover: (P.cover[kind] || 15) * A, ridge: P.ridge, trim: P.trim, gutter: P.gutter, plate: P.plate * Math.sqrt(A) * 4 };
    const name = { plate: 'Мауэрлат', joists: 'Лаги', ridge: 'Коньковый прогон', frame: 'Стропила', memb: 'Мембрана', battens: 'Обрешётка', cover: 'Покрытие', trim: 'Планки', gutter: 'Водосток' };
    for (const k of Object.keys(per)) { const ds = share(a, k) - share(b, k); if (ds > 0.001) add(per[k] * ds, name[k]); }
  }
  _priceGround(p, add) {
    const t = this.app.terrain, s = p.snap, ca = (t.cell * M1) ** 2;
    if (!s || !t.jDirty) return;
    let conc = 0, bit = 0, soil = 0;
    const J = t.jDirty, n = t.nx, mats = new Float64Array(8), L = t.lH.length / t.nat.length;
    for (let tz = 0; tz < t.jtnz; tz++) for (let tx = 0; tx < t.jtnx; tx++) {
      if (!J[tz * t.jtnx + tx]) continue;
      for (let iz = tz * 32; iz < Math.min(t.nz, tz * 32 + 32); iz++) for (let ix = tx * 32; ix < Math.min(n, tx * 32 + 32); ix++) {
        const i = iz * n + ix;
        conc += t.conc[i] - s.conc[i];
        soil += t.nat[i] - s.nat[i];
        bit += Math.max(0, t.bit[i] - s.bit[i]);
        for (let k = 0; k < L; k++) { const j = i * L + k; if (k < t.lN[i]) mats[t.lM[j]] += t.lH[j]; if (k < s.lN[i]) mats[s.lM[j]] -= s.lH[j]; }
      }
    }
    const v = (x) => x * ca * M1;
    if (conc > 0) add(PRICE.concrete * v(conc), `Бетон ${v(conc).toFixed(2)} м³`);
    // (soil gone off the plot — the native ground lower and not lying about loose: hauled away)
    const loose0 = mats[0] || 0, gone = -(soil + loose0);
    if (gone > 0 && v(gone) > 0.3) add(PRICE.haul * v(gone), `Вывоз грунта · ${v(gone).toFixed(1)} м³`);
    if (mats[M_SAND] > 0) add(PRICE.sand * v(mats[M_SAND]), `Песок ${v(mats[M_SAND]).toFixed(1)} м³`);
    const g = (mats[M_G5] || 0) + (mats[M_G20] || 0);
    if (g > 0) add(PRICE.gravel * v(g), `Щебень ${v(g).toFixed(1)} м³`);
    if (bit > 0) add(PRICE.bitumen * bit * ca, 'Битум');
  }
  // the money out (inside the current journal entry), the popup, the till
  _pay(items, at) {
    const app = this.app, r = this.rec;
    if (!r) return;
    const usd = Math.round(items.reduce((s, q) => s + q.usd, 0));
    if (!usd) return;
    app.objects.update(r.id, { money: Math.round(r.money - usd) });
    this.popup(usd, items, at);
    if (usd > 0) app.sfx?.cash?.(); else app.sfx?.stab?.();
    this.refresh();
    if (r.money - usd < 0 && r.money >= 0) app.ui.toast('Бюджет кончился — дальше стройка в долг (сумма красная)');
  }
  popup(usd, what, at) {
    if (!this.pops) return;
    const app = this.app, el = document.createElement('div');
    el.className = 'pop' + (usd < 0 ? ' plus' : '');
    // (the bill: what and how much, each its price)
    const list = Array.isArray(what) ? what : [{ what, usd: 0 }];
    el.innerHTML = `<b>${usd < 0 ? '+' : '−'}$${fmt(Math.abs(usd))}</b>` + list.slice(0, 5).map((q) => `<span>${q.what}${list.length > 1 && q.usd ? ` · $${fmt(Math.abs(q.usd))}` : ''}</span>`).join('') + (list.length > 5 ? `<span>… ещё ${list.length - 5}</span>` : '');
    let x = innerWidth / 2, y = innerHeight * 0.4;
    if (at) { const v = at.clone().project(app.camera); if (v.z < 1) { x = (v.x + 1) / 2 * innerWidth; y = (1 - v.y) / 2 * innerHeight; } }
    el.style.left = `${Math.max(60, Math.min(innerWidth - 60, x))}px`; el.style.top = `${Math.max(70, Math.min(innerHeight - 120, y))}px`;
    el.style.animationDuration = `${2.2 + 0.5 * Math.min(4, list.length - 1)}s`;
    this.pops.appendChild(el);
    setTimeout(() => el.remove(), 2200 + 500 * Math.min(4, list.length - 1));
  }
}

const fmt = (v) => Math.round(v).toLocaleString('en-US');
const runLen = (runs) => (runs || []).reduce((s, q) => s + (Array.isArray(q) ? q[1] || 0 : 0), 0);
const len3 = (rl) => (rl || []).reduce((s, q) => s + Math.abs(q[2] - q[1]) * M1, 0);
const area4 = (rs) => (rs || []).reduce((s, q) => s + Math.abs((q[2] - q[0]) * (q[3] - q[1])) * M2, 0);
function roofArea(r) { return (r?.wings || []).reduce((s, w) => s + 4 * (w.A + MM(500)) * (w.B + MM(500)) * M2, 0) || 50; }
void M3;
