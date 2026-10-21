import { MODEL_SCALE } from '../config.js';
import { findBelt, plan, toWorld, toFrame, beltContains, rle, unrle } from './belt.js';

// The floor slab (монолитное перекрытие) cast on the top of the walls (or on a cast ring
// beam), as on site: the formwork deck — film-faced plywood on timber beams (secondary
// every 500 mm, primary every 1,5 m) on telescopic steel props every 1,2 m standing on the
// floor below — and edge boards round it; a cage of two mats Ø12 every 200 mm both ways
// (the bottom one on plastic chairs, the top one on "frogs"); concrete from the hose,
// the vibrator, the rule, the trowel; once it has the strength the props come out.
//
// A cantilever (консоль): the slab runs on past one wall into the air (the "floating"
// floors of a high-tech house). Over it the bars that carry it are at the TOP (the slab
// is stretched along its top there): extra top bars Ø14 between the top mat's bars, from
// the edge back into the slab 1,5 × the cantilever.
//
// The slab is a ring-beam record (belt.js) of its own kind: the same plan of cells in the
// frame of the walls (100 mm here), the same concrete in it.
//   belt { kind: 'slab', … , deck (run lengths: the cells over the open, on the props),
//          cant: [ds, dt, mm] (the side of the cantilever in the frame, its length) }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const SLAB = { cell: 100, H: 200, cover: 25, bar: 12, step: 200, cantBar: 14, deck: 18, sec: 500, prim: 1500, prop: 1200, beamH: 200, beamW: 80 };
export const isSlab = (b) => b?.kind === 'slab';

// The slab over the walls under the finger: { rec, n, area (m²), exists } or null.
// cantMm: the cantilever, on the side of the house nearest the finger
export function findSlab(app, p, screen, finger, cantMm = 0) {
  const belts = app.objects.all('belt');
  // on a cast ring beam: the slab goes on its top
  let base = belts.find((b) => !isSlab(b) && b.fill > 0.5 && beltContains(b, p.x, p.z) && p.y > b.top + b.H * 0.5 && p.y < b.top + b.H + MM(60));
  let T;
  if (base) T = base.top + Math.max(...base.lv) * S;
  else {
    const B = findBelt(app, p, screen, finger);
    if (!B) return null;
    base = B.rec; T = base.top;
    // a ring beam already on these walls: the slab goes on it, not under it
    if (belts.some((b) => !isSlab(b) && Math.abs(b.top - T) < MM(20) && beltContains(b, p.x, p.z))) return null;
  }
  const c = MM(SLAB.cell), R = Math.round(MM(1600) / c), pad = Math.ceil(MM(cantMm) / c) + 1;   // (R: openings up to 3,2 m in the top course are bridged)
  const W = Math.ceil(base.ni * base.c / c), Hh = Math.ceil(base.nj * base.c / c), ni = W + 2 * pad, nj = Hh + 2 * pad;
  const at = (i, j) => toWorld(base, (i - pad + 0.5) * c, (j - pad + 0.5) * c);
  // the supports: the cells over the walls (the ring under them)
  const sup = new Uint8Array(ni * nj);
  let i0 = Infinity, i1 = -1, j0 = Infinity, j1 = -1;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (beltContains(base, ...at(i, j))) { sup[j * ni + i] = 1; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
  if (i1 < 0) return null;
  // inside: all that the walls close round (what is not reached from outside). An opening
  // in the top course (a window up to the slab, a door) does not let the outside in: gaps
  // up to 2R between the walls along a row / a column of cells are closed for this
  const blk = sup.slice();
  const bridge = (n, m, at) => {
    for (let a = 0; a < m; a++) {
      let last = -1;
      for (let b = 0; b < n; b++) {
        if (!sup[at(a, b)]) continue;
        if (last >= 0 && b - last > 1 && b - last - 1 <= 2 * R) for (let q = last + 1; q < b; q++) blk[at(a, q)] = 1;
        last = b;
      }
    }
  };
  bridge(ni, nj, (j, i) => j * ni + i);
  bridge(nj, ni, (i, j) => j * ni + i);
  const out = new Uint8Array(ni * nj), st = [];
  for (let i = 0; i < ni; i++) for (const j of [0, nj - 1]) if (!blk[j * ni + i] && !out[j * ni + i]) { out[j * ni + i] = 1; st.push(j * ni + i); }
  for (let j = 0; j < nj; j++) for (const i of [0, ni - 1]) if (!blk[j * ni + i] && !out[j * ni + i]) { out[j * ni + i] = 1; st.push(j * ni + i); }
  while (st.length) {
    const k = st.pop(), i = k % ni, j = (k / ni) | 0;
    for (const [a, d] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || d < 0 || a >= ni || d >= nj) continue; const q = d * ni + a; if (!blk[q] && !out[q]) { out[q] = 1; st.push(q); } }
  }
  const m = new Uint8Array(ni * nj);
  for (let k = 0; k < m.length; k++) m[k] = out[k] ? 0 : 1;
  // the cantilever: past the wall on the side of the house nearest the finger, the whole width
  let cant = null;
  if (cantMm > 0) {
    const [ps, pt] = toFrame(base, p.x, p.z), fi = ps / c + pad - 0.5, fj = pt / c + pad - 0.5;
    const sides = [[1, 0, i1 - fi], [-1, 0, fi - i0], [0, 1, j1 - fj], [0, -1, fj - j0]];
    const [ds, dt] = sides.reduce((a, b) => (Math.abs(b[2]) < Math.abs(a[2]) ? b : a));
    const n = Math.round(MM(cantMm) / c);
    for (let k = 1; k <= n; k++) {
      if (ds) { const i = ds > 0 ? i1 + k : i0 - k; for (let j = j0; j <= j1; j++) m[j * ni + i] = 1; }
      else { const j = dt > 0 ? j1 + k : j0 - k; for (let i = i0; i <= i1; i++) m[j * ni + i] = 1; }
    }
    cant = [ds, dt, cantMm];
  }
  // cropped to what is in it
  let a0 = ni, a1 = -1, b0 = nj, b1 = -1;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (m[j * ni + i]) { a0 = Math.min(a0, i); a1 = Math.max(a1, i); b0 = Math.min(b0, j); b1 = Math.max(b1, j); }
  const NI = a1 - a0 + 1, NJ = b1 - b0 + 1, mask = new Uint8Array(NI * NJ), deck = new Uint8Array(NI * NJ);
  let n = 0;
  for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) {
    const k = (j + b0) * ni + (i + a0);
    if (!m[k]) continue;
    mask[j * NI + i] = 1; n++;
    if (!sup[k]) deck[j * NI + i] = 1;
  }
  const [ox, oz] = toWorld(base, (a0 - pad) * c, (b0 - pad) * c);
  const rec = {
    type: 'belt', kind: 'slab', o: [+ox.toFixed(6), +oz.toFixed(6)], u: base.u.slice(), c: +c.toFixed(7), ni: NI, nj: NJ,
    mask: rle(mask), deck: rle(deck), top: +T.toFixed(6), H: +MM(SLAB.H).toFixed(6), lv: new Array(n).fill(0), sm: new Array(n).fill(0.3), fill: 0, segs: [],
    cant,
  };
  const exists = belts.some((b) => isSlab(b) && Math.abs(b.top - rec.top) < MM(30) && beltContains(b, p.x, p.z));
  return { rec, n, area: n * (SLAB.cell / 1000) ** 2, exists };
}

// the deck cells of a slab (over the open)
const _deck = new Map();
export function deckOf(b) {
  const key = b.id + ':' + b.ni + 'x' + b.nj;
  const c = _deck.get(key);
  if (c && c.rec === b.deck) return c.m;
  const m = unrle(b.deck, b.ni * b.nj);
  _deck.set(key, { rec: b.deck, m });
  return m;
}

// The formwork under it, in the frame: the deck as rectangles of plywood, the secondary and
// primary beams (runs over the deck), the props on the primaries (on the floor below).
// floor(x, z): the height of what a prop stands on
export function slabForm(b, floor) {
  const D = deckOf(b), { ni, nj, c } = b, on = (i, j) => i >= 0 && j >= 0 && i < ni && j < nj && D[j * ni + i];
  const deck = [];
  // rows of deck cells merged into rectangles (the same run in the next rows joins it)
  const open = new Map();
  for (let j = 0; j <= nj; j++) {
    const runs = new Set();
    if (j < nj) for (let i = 0; i < ni;) { if (!on(i, j)) { i++; continue; } const s = i; while (on(i, j)) i++; runs.add(`${s}:${i}`); }
    for (const [k, r] of [...open]) if (!runs.has(k)) { deck.push([r[0] * c, r[1] * c, r[2] * c, j * c]); open.delete(k); }
    for (const k of runs) if (!open.has(k)) { const [s, e] = k.split(':').map(Number); open.set(k, [s, j, e]); }
  }
  const yDeck = b.top - MM(SLAB.deck), ySec = yDeck - MM(SLAB.beamH), yPrim = ySec - MM(SLAB.beamH);
  // runs of deck cells along a line: [from, to] in the frame
  const runsAlong = (fixed, alongS) => {
    const out = [], n = alongS ? ni : nj, k = Math.floor(fixed / c);
    for (let a = 0; a < n;) {
      if (!(alongS ? on(a, k) : on(k, a))) { a++; continue; }
      const s = a; while (alongS ? on(a, k) : on(k, a)) a++;
      out.push([s * c, a * c]);
    }
    return out;
  };
  const sec = [], prim = [], props = [];
  // secondary beams along s, every 500 mm across
  for (let t = MM(150); t < nj * c; t += MM(SLAB.sec)) for (const [a, e] of runsAlong(t, true)) sec.push([a, t, e, t]);
  // primary beams along t, every 1,5 m (the first 300 mm in), the props under them
  let s0 = Infinity, s1 = -Infinity;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (on(i, j)) { s0 = Math.min(s0, i * c); s1 = Math.max(s1, (i + 1) * c); }
  if (s1 > s0) {
    const n = Math.max(1, Math.round((s1 - s0 - MM(600)) / MM(SLAB.prim)));
    for (let k = 0; k <= n; k++) {
      const s = s0 + MM(300) + (s1 - s0 - MM(600)) * k / n;
      for (const [a, e] of runsAlong(s, false)) {
        prim.push([s, a, s, e]);
        const m = Math.max(1, Math.round((e - a - MM(400)) / MM(SLAB.prop)));
        for (let q = 0; q <= m; q++) {
          const t = a + MM(200) + (e - a - MM(400)) * q / m, [x, z] = toWorld(b, s, t), f = floor(x, z);
          if (yPrim - f > MM(300)) props.push([x, z, f, yPrim]);
        }
      }
    }
  }
  return { deck, sec, prim, props, yDeck, ySec, yPrim };
}

// The cage: two mats Ø12 every 200 mm both ways (bottom: 25 mm cover on plastic chairs,
// top: 25 mm under the top on frogs), wire at every other crossing; over a cantilever extra
// top bars Ø14 between the top mat's bars, back into the slab 1,5 × the cantilever
export function slabCage(b) {
  const P = plan(b), { ni, nj, c } = b, bars = [], ties = [], chairs = [], frogs = [];
  const d = MM(SLAB.bar), cov = MM(SLAB.cover), st = MM(SLAB.step), y0 = b.top, H = b.H;
  const inside = (s, t) => { const i = Math.floor(s / c), j = Math.floor(t / c); return i >= 0 && j >= 0 && i < ni && j < nj && P.mask[j * ni + i]; };
  const W = (s, t, y) => { const [x, z] = toWorld(b, s, t); return [+x.toFixed(5), +y.toFixed(5), +z.toFixed(5)]; };
  // the runs of the plan along a line, less the cover at the ends
  const runs = (fixed, alongS) => {
    const out = [], L = alongS ? ni * c : nj * c, q = MM(10);
    let a = null;
    const N = Math.ceil(L / q);
    for (let k = 0; k <= N; k++) {
      const x = (k + 0.5) * q, inn = k < N && (alongS ? inside(x, fixed) : inside(fixed, x));
      if (inn && a == null) a = x - q / 2;
      if (!inn && a != null) { if (x - q / 2 - a > 2 * cov + MM(100)) out.push([a + cov, x - q / 2 - cov]); a = null; }
    }
    return out;
  };
  const yb1 = y0 + cov + d / 2, yb2 = yb1 + d, yt2 = y0 + H - cov - d / 2, yt1 = yt2 - d;
  const lines = (L) => { const n = Math.floor((L - 2 * cov) / st); const off = (L - n * st) / 2; return Array.from({ length: n + 1 }, (_, k) => off + k * st); };
  const tL = lines(nj * c), sL = lines(ni * c);
  for (const [y, yx] of [[yb1, yb2], [yt1, yt2]]) {
    for (const t of tL) for (const [a, e] of runs(t, true)) bars.push([...W(a, t, y), ...W(e, t, y), +d.toFixed(6)]);
    for (const s of sL) for (const [a, e] of runs(s, false)) bars.push([...W(s, a, yx), ...W(s, e, yx), +d.toFixed(6)]);
  }
  // wire: every other crossing of each mat
  for (let p = 0; p < tL.length; p += 2) for (let q = 0; q < sL.length; q += 2) {
    const t = tL[p], s = sL[q];
    if (!inside(s, t)) continue;
    for (const y of [yb1 + d / 2, yt1 + d / 2]) ties.push([...W(s, t, y), +(d * 0.9).toFixed(6), 0.785]);
  }
  // chairs under the bottom mat and frogs between the mats, about every 1 m
  for (let p = 2; p < tL.length; p += 5) for (let q = 2; q < sL.length; q += 5) {
    const t = tL[p], s = sL[q];
    if (!inside(s, t)) continue;
    const [x, , z] = W(s + st / 2, t, y0);
    chairs.push([x, +y0.toFixed(5), z, +(yb1 - d / 2 - y0).toFixed(6)]);
    const [fx, , fz] = W(s, t + st / 2, y0);
    frogs.push([fx, +(yb2 + d / 2).toFixed(5), fz, ((p + q) % 2) * Math.PI / 2, +(yt1 - yb2 - d).toFixed(6)]);
  }
  // round an opening: two bars along each side in both mats (400 mm on past the corners),
  // a diagonal bar at each corner (the cracks start there)
  for (const [a0, b0, a1, b1] of b.holes || []) {
    const S0 = a0 * c, S1 = a1 * c, T0 = b0 * c, T1 = b1 * c, ext = MM(400);
    const seg = (fixed, from, to, alongS, y) => { for (const [a, e] of runs(fixed, alongS)) { const f = Math.max(a, from), t = Math.min(e, to); if (t - f > MM(200)) bars.push(alongS ? [...W(f, fixed, y), ...W(t, fixed, y), +d.toFixed(6)] : [...W(fixed, f, y), ...W(fixed, t, y), +d.toFixed(6)]); } };
    for (const [ys, yt] of [[yb1, yb2], [yt1, yt2]]) for (const o of [MM(60), MM(110)]) {
      seg(T0 - o, S0 - ext, S1 + ext, true, ys); seg(T1 + o, S0 - ext, S1 + ext, true, ys);
      seg(S0 - o, T0 - ext, T1 + ext, false, yt); seg(S1 + o, T0 - ext, T1 + ext, false, yt);
    }
    for (const [cs, ct, gs, gt] of [[S0, T0, -1, -1], [S1, T0, 1, -1], [S1, T1, 1, 1], [S0, T1, -1, 1]]) {
      // across the corner, 150 mm out from it, 800 mm long
      const ms = cs + gs * MM(150) / Math.SQRT2, mt = ct + gt * MM(150) / Math.SQRT2, h = MM(400) / Math.SQRT2;
      const e0 = [ms - gt * h, mt + gs * h], e1 = [ms + gt * h, mt - gs * h], inn = ([a, b]) => [[0, 0], [cov, 0], [-cov, 0], [0, cov], [0, -cov]].every(([u, v]) => inside(a + u, b + v));
      if (!inn(e0) || !inn(e1)) continue;   // (by an edge of the slab: it would stick out)
      for (const y of [yb2 + d, yt1 - d]) bars.push([...W(...e0, y), ...W(...e1, y), +d.toFixed(6)]);
    }
  }
  // the cantilever: the bars that carry it — on top, between the top mat's
  if (b.cant) {
    const [ds, dt, mm] = b.cant, dc = MM(SLAB.cantBar), back = MM(mm) * 1.5 + MM(mm), y = ds ? yt1 : yt2;   // (beside the top mat's bars that run the same way)
    if (ds) {
      const iEdge = ds > 0 ? ni * c - cov : cov, iIn = iEdge - ds * back;
      const lo = Math.min(iIn, iEdge), hi = Math.max(iIn, iEdge);
      for (const t of tL.slice(0, -1).map((v) => v + st / 2)) if (inside(iEdge - ds * MM(50), t)) for (const [a, e] of runs(t, true)) { const f = Math.max(a, lo), g = Math.min(e, hi); if (g - f > MM(300)) bars.push([...W(f, t, y), ...W(g, t, y), +dc.toFixed(6)]); }
    } else {
      const jEdge = dt > 0 ? nj * c - cov : cov, jIn = jEdge - dt * back;
      const lo = Math.min(jIn, jEdge), hi = Math.max(jIn, jEdge);
      for (const s of sL.slice(0, -1).map((v) => v + st / 2)) if (inside(s, jEdge - dt * MM(50))) for (const [a, e] of runs(s, false)) { const f = Math.max(a, lo), g = Math.min(e, hi); if (g - f > MM(300)) bars.push([...W(s, f, y), ...W(s, g, y), +dc.toFixed(6)]); }
    }
  }
  return { type: 'cage', outlineId: null, beltId: b.id, bars, chairs, frogs, ties, tied: true, stars: [], d };
}

// An opening (a stair well) set out in the formwork before the concrete, as on site: a box
// of boards on the deck — the plywood and the props go there, the bars stop short of it
// and it gets its own bars round it. Only the cells over the open go (over a wall the
// slab stays). (x0, z0)–(x1, z1): two corners. → { patch, rect: [i0, j0, i1, j1], w, l (mm) }
// or { why }
export function slabHole(b, x0, z0, x1, z1) {
  const [sa, ta] = toFrame(b, x0, z0), [sb, tb] = toFrame(b, x1, z1), c = b.c;
  const i0 = Math.max(0, Math.round(Math.min(sa, sb) / c)), i1 = Math.min(b.ni, Math.round(Math.max(sa, sb) / c));
  const j0 = Math.max(0, Math.round(Math.min(ta, tb) / c)), j1 = Math.min(b.nj, Math.round(Math.max(ta, tb) / c));
  const P = plan(b), D = deckOf(b), mask = P.mask.slice(), deck = D.slice();
  let gone = 0, a0 = Infinity, a1 = -1, b0 = Infinity, b1 = -1;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const k = j * b.ni + i;
    if (!mask[k] || !deck[k]) continue;
    mask[k] = 0; deck[k] = 0; gone++;
    a0 = Math.min(a0, i); a1 = Math.max(a1, i + 1); b0 = Math.min(b0, j); b1 = Math.max(b1, j + 1);
  }
  const w = (a1 - a0) * SLAB.cell, l = (b1 - b0) * SLAB.cell;
  if (!gone || Math.min(w, l) < 600) return { why: 'Проём меньше 600 мм — протяните шире' };
  const lv = [], sm = [];
  P.cells.forEach(([i, j], k) => { if (mask[j * b.ni + i]) { lv.push(b.lv[k]); sm.push(b.sm[k]); } });
  const rect = [a0, b0, a1, b1];
  return { patch: { mask: rle(mask), deck: rle(deck), lv, sm, holes: [...(b.holes || []), rect] }, rect, w, l };
}

// the cantilever as words: «консоль 1,5 м»
export const cantText = (b) => (b?.cant ? `консоль ${(b.cant[2] / 1000).toFixed(1).replace('.', ',')} м` : 'без консоли');
