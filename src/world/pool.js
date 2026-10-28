import * as THREE from 'three';
import { MODEL_SCALE, TRAY } from '../config.js';
import { rle } from '../tools/belt.js';
import { VILLA } from './villa.js';

// The pool, built as a monolithic reinforced-concrete bowl is built on site:
//   pit    – the pit set out round the bowl (500 of working room each side) and dug to
//            −1850: then 200 of crushed stone rammed, 100 of lean concrete (Земля, Материалы,
//            Бетон — the tools of the house);
//   form1  – the edge boards of the bottom slab (250, 100 out past the walls) on the lean concrete;
//   cage1  – its two meshes Ø12 / 200 on chairs and frogs, the starter bars for the walls;
//   (the slab poured: Бетон → шланг, вибратор, правило по доскам)
//   cage2  – the walls' cage: two meshes Ø12 / 200 tied to the starters; the waterstop cord
//            on the slab under the walls;
//   form2  – the walls' formwork both sides (boards, studs, walers, tie rods) with the
//            embedded parts set in it: skimmers, inlets, lights, the main drain;
//   (the walls poured)
//   strip  – the boards come off once the concrete has set;
//   proof  – the coating inside, by the finger, two coats; the tape in the corners;
//   tile   – glass mosaic by the sheet (316 × 316, 12 × 12 chips of 25 mm) by the finger;
//   cope   – the coping stones round the rim (500 × 330 × 40, bullnosed, 30 over the water);
//   water  – filled from a garden hose (or let out), up to 100 under the coping;
//   light  – the lights under water.
// A pool record (sizes real mm, in its own frame: s along its length from the inner corner,
// t across, y up from the top of the bottom slab):
//   pool { o: [x, z] (the inner corner), u: [ux, uz], L, W (inside), g (the natural ground),
//          pit (outline id), floor, wall (belt ids), cage1, cage2 (cage ids),
//          ft (the top of the slab, world), hw (the walls' height over it),
//          proof: [strings per face, a digit per cell: the coats], tile: [strings per face
//          ('0' none, else the colour's letter)], cope: [strings per side], copeCol,
//          water (mm over the slab), light }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const POOL = {
  L: 8000, W: 3500, T: 250, F: 250, slabOut: 100, rim: 300, cope: 40, glue: 10, wallH: 1550,
  free: 100, room: 500, gravel: 200, lean: 100, pitDepth: 1850,
  cell: 100, sheet: 316.5, stone: 500, stoneW: 330, stoneOver: 30, joint: 4,
  bar: 12, step: 200, coverF: 50, coverW: 40,
};
export const POOL_LAYERS = [
  ['pit', 'Разметка'], ['dig', 'Котлован'], ['bed', 'Щебень и подбетонка'], ['form1', 'Опалубка днища'], ['cage1', 'Арматура днища'], ['cage2', 'Арматура стен'], ['form2', 'Опалубка стен и закладные'],
  ['strip', 'Снять опалубку'], ['proof', 'Гидроизоляция'], ['tile', 'Мозаика'], ['cope', 'Бортовой камень'], ['water', 'Вода'], ['light', 'Подсветка'],
  ['fill', 'Обратная засыпка'], ['base', 'Основание площадки'], ['deck', 'Покрытие площадки'],
];
// the deck round the pool (its top flush with the coping's): the kind of base under it, the boards /
// the tiles — photographs (ambientCG, CC0: CREDITS.md); { name, base: 'joists' (on pads and joists,
// boards 140 × 25 with a 6 mm gap) | 'slab' (crushed stone, a concrete slab, tiles on glue), tile
// (mm, along × across), tex folder, tint, usd per m² }
export const DECKS = {
  'wpc:teak': { name: 'ДПК · тик', base: 'joists', tex: 'deck/teak', tile: [4000, 140], usd: 62, tint: 0xd9c7b6 },
  'wpc:walnut': { name: 'ДПК · орех', base: 'joists', tex: 'deck/walnut', tile: [4000, 140], usd: 62 },
  'wpc:wenge': { name: 'ДПК · венге', base: 'joists', tex: 'deck/wenge', tile: [4000, 140], usd: 62 },
  'wpc:grey': { name: 'ДПК · серый', base: 'joists', tex: 'deck/grey', tile: [4000, 140], usd: 62, tint: 0xd8d8d8 },
  'wpc:graphite': { name: 'ДПК · графит', base: 'joists', tex: 'deck/graphite', tile: [4000, 140], usd: 62, tint: 0xb8b8b8 },
  'thermo:ash': { name: 'Термоясень', base: 'joists', tex: 'deck/thermo', tile: [3000, 120], usd: 74 },
  'porc:oak': { name: 'Керамогранит 20 мм · под дуб', base: 'slab', tex: 'deck/oakporc', tile: [1200, 200], usd: 58 },
  'porc:concrete': { name: 'Керамогранит 20 мм · бетон', base: 'slab', tex: 'facade/porc_concrete', tile: [600, 600], usd: 55 },
  'porc:anthracite': { name: 'Керамогранит 20 мм · антрацит', base: 'slab', tex: 'facade/porc_anthracite', tile: [600, 600], usd: 55 },
  'trav': { name: 'Травертин', base: 'slab', tex: 'travertine', tile: [600, 400], usd: 82 },
};
export const DECK_WIDTHS = [1000, 1500, 2000, 3000];
// the deck's plan: four rects in the pool's frame (s, t; mm) — the long sides full length with the
// corners, the short ones between — from the coping's outer edge (300 out of the water's edge) out W
export function deckRing(r, W) {
  const o = POOL.stoneW - POOL.stoneOver, L = r.L, Wd = r.W;
  return [[-o - W, -o - W, L + o + W, -o], [-o - W, Wd + o, L + o + W, Wd + o + W], [-o - W, -o, -o, Wd + o], [L + o, -o, L + o + W, Wd + o]];
}
// the gap between the walls' outer face and the pit's side (filled back with sand): [inner, outer] out of the water's edge
export const fillBand = () => [POOL.T, 850];
// the mosaic: name, texture folder, chips across the texture (the chips 25 mm, joints 1,4)
export const MOSAICS = {
  turq: ['Бирюзовая', 'pool_mosaic_turq', 12, 't'],
  blue: ['Синяя', 'pool_mosaic_blue', 12, 'b'],
  aqua: ['Аква, микс', 'pool_mosaic_aqua', 16, 'a'],
  graphite: ['Графит', 'pool_mosaic_graphite', 12, 'g'],
  white: ['Белая', 'pool_mosaic_white', 8, 'w'],
};
export const MOSAIC_BY_LETTER = Object.fromEntries(Object.entries(MOSAICS).map(([k, v]) => [v[3], k]));
// the coping: natural travertine, or a grey / graphite porcelain stone of the same size
export const COPES = { trav: ['Травертин', 0xffffff], grey: ['Серый керамогранит', 0xa9a8a4], graph: ['Графитовый керамогранит', 0x55565a] };

// ---- the frame -----------------------------------------------------------------------------
// frame mm → world [x, z]; world → frame mm [s, t]
export const PW = (r, s, t) => [r.o[0] + (r.u[0] * s - r.u[1] * t) * S, r.o[1] + (r.u[1] * s + r.u[0] * t) * S];
export const PF = (r, x, z) => { const dx = x - r.o[0], dz = z - r.o[1]; return [(dx * r.u[0] + dz * r.u[1]) / S, (-dx * r.u[1] + dz * r.u[0]) / S]; };
export const rimY = (r) => r.g + MM(POOL.rim);
export const wallTopY = (r) => rimY(r) - MM(POOL.cope + POOL.glue);
// the slab's top and the walls' height: as set out on the lean concrete (else as designed)
export const floorTopY = (r) => r.ft ?? wallTopY(r) - MM(POOL.wallH);
export const wallH = (r) => r.hw ?? POOL.wallH;
// the water's highest level (100 under the coping's top), mm over the slab
export const waterMax = (r) => wallH(r) + POOL.cope + POOL.glue - POOL.free;
export const yW = (r, y) => floorTopY(r) + MM(y);

// the bowl outside, the slab, the pit (frame mm)
export const outer = (r) => [-POOL.T, -POOL.T, r.L + POOL.T, r.W + POOL.T];
export const slabRect = (r) => { const e = POOL.T + POOL.slabOut; return [-e, -e, r.L + e, r.W + e]; };
export const pitRect = (r) => { const e = POOL.T + POOL.slabOut + POOL.room; return [-e, -e, r.L + e, r.W + e]; };
export function worldBox(r, [s0, t0, s1, t1]) {
  const cs = [PW(r, s0, t0), PW(r, s1, t0), PW(r, s0, t1), PW(r, s1, t1)];
  return [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))];
}
export const pitBox = (r) => worldBox(r, pitRect(r));
export const outerBox = (r) => worldBox(r, outer(r));
// within the bowl's outer faces (frame mm)
export function inBowl(r, x, z, pad = 0) { const [s, t] = PF(r, x, z), [a, b, c, d] = outer(r); return s >= a - pad && s <= c + pad && t >= b - pad && t <= d + pad; }

// ---- a new pool where the finger is (snapped onto the project's pool when near it) ---------
// a — the corner where the finger went down: drawn out from it to p, the water's own size (the
// longer side its length; 100 mm steps, POOL_SIZE's limits); else the standard pool
export const POOL_SIZE = { L: [3000, 12000], W: [2000, 6000] };
export function newPool(app, p, turn = false, a = null) {
  let L = POOL.L, W = POOL.W, u = turn ? [0, 1] : [1, 0];
  const pv = app.projectView, pl = VILLA.site.pool;
  let cx = p.x, cz = p.z, snapped = false;
  if (a && Math.hypot(p.x - a.x, p.z - a.z) > MM(800)) {
    const dx = Math.abs(p.x - a.x) / S, dz = Math.abs(p.z - a.z) / S, snap = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Math.round(v / 100) * 100));
    u = dx >= dz ? [1, 0] : [0, 1];
    L = snap(Math.max(dx, dz), POOL_SIZE.L); W = snap(Math.min(dx, dz), POOL_SIZE.W);
    if (W > L) W = L;
    // (the rect from the corner the finger started at, its far corner where it is now)
    cx = a.x + Math.sign(p.x - a.x || 1) * (u[0] ? L : W) / 2 * S; cz = a.z + Math.sign(p.z - a.z || 1) * (u[0] ? W : L) / 2 * S;
  } else if (pv && pl) {
    // the project's pool (projectView: house mm → world)
    const px = pv.X((pl.x0 + pl.x1) / 2), pz = pv.Z((pl.z0 + pl.z1) / 2);
    if (Math.hypot(p.x - px, p.z - pz) < MM(2500)) { cx = px; cz = pz; snapped = !turn; }
  }
  // the inner corner from the middle: back half the length along u, half the width across
  const o = [cx - (u[0] * L / 2 - u[1] * W / 2) * S, cz - (u[1] * L / 2 + u[0] * W / 2) * S];
  const rec = { type: 'pool', o: o.map((v) => +v.toFixed(6)), u, L, W, g: TRAY.soil, proof: [], tile: [], cope: [], water: 0, light: false };
  return { rec, snapped };
}
// it fits on the plot (the pit with a margin inside the tray), clear of other pools
export function poolFits(app, rec, skip = null) {
  const t = app.terrain, [x0, z0, x1, z1] = pitBox(rec), m = MM(300);
  if (x0 < -t.halfX + m || x1 > t.halfX - m || z0 < -t.halfZ + m || z1 > t.halfZ - m) return 'Котлован не помещается на участке — ближе к середине';
  for (const q of app.objects.all('pool')) {
    if (q.id === skip) continue;
    const [a0, b0, a1, b1] = pitBox(q);
    if (x0 < a1 && x1 > a0 && z0 < b1 && z1 > b0) return 'Здесь уже бассейн';
  }
  return null;
}
// the pit's outline record (Разметка: the shovel and the loader stop at its depth)
export function pitOutline(rec) {
  const [x0, z0, x1, z1] = pitBox(rec);
  return { type: 'outline', kind: 'rect', x0: +x0.toFixed(5), z0: +z0.toFixed(5), x1: +x1.toFixed(5), z1: +z1.toFixed(5), depth: +(POOL.pitDepth / MODEL_SCALE).toFixed(2), pool: true };
}

// ---- the concrete: the bottom slab and the walls as cast pieces (belt.js records) --------
// (the hose, the bucket, the vibrator, the rule and the trowel work them as any formwork)
export function floorBelt(r, top) {
  const c = 100, [s0, t0, s1, t1] = slabRect(r), ni = Math.round((s1 - s0) / c), nj = Math.round((t1 - t0) / c), n = ni * nj;
  const o = PW(r, s0, t0);
  return {
    type: 'belt', kind: 'pool', part: 'floor', pool: r.id, over: 0, o: o.map((v) => +v.toFixed(6)), u: r.u.slice(), c: +MM(c).toFixed(7), ni, nj,
    mask: rle(new Uint8Array(n).fill(1)), top: +top.toFixed(6), H: +MM(POOL.F).toFixed(6), lv: new Array(n).fill(0), sm: new Array(n).fill(0.3), fill: 0, segs: [],
  };
}
export function wallBelt(r) {
  const c = 50, [s0, t0, s1, t1] = outer(r), ni = Math.round((s1 - s0) / c), nj = Math.round((t1 - t0) / c), m = new Uint8Array(ni * nj), k = POOL.T / c;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (i < k || j < k || i >= ni - k || j >= nj - k) m[j * ni + i] = 1;
  let n = 0; for (const v of m) n += v;
  const o = PW(r, s0, t0);
  return {
    type: 'belt', kind: 'pool', part: 'wall', pool: r.id, over: 0, o: o.map((v) => +v.toFixed(6)), u: r.u.slice(), c: +MM(c).toFixed(7), ni, nj,
    mask: rle(m), top: +floorTopY(r).toFixed(6), H: +MM(wallH(r)).toFixed(6), lv: new Array(n).fill(0), sm: new Array(n).fill(0.3), fill: 0, segs: [],
  };
}
export const poolBelts = (app, r) => ({ floor: r.floor != null ? app.objects.get(r.floor) : null, wall: r.wall != null ? app.objects.get(r.wall) : null });
export const isPoolBelt = (b) => b?.kind === 'pool';

// ---- the reinforcement ---------------------------------------------------------------------
const f5 = (v) => +v.toFixed(5);
// the bottom slab: two meshes Ø12 / 200 (the lower on chairs 50, the upper on frogs, 40 under
// the top), the starters for both faces of the walls (L-bars: a 300 foot in the lower mesh,
// up 600 over the slab); wire at every other crossing
export function floorCage(r, top) {
  const P = (s, t, y) => { const [x, z] = PW(r, s, t); return [f5(x), f5(y), f5(z)]; };
  const d = MM(POOL.bar), dm = POOL.bar, st = POOL.step, cov = POOL.coverF, e = POOL.T + POOL.slabOut - cov;
  const [s0, t0, s1, t1] = [-e, -e, r.L + e, r.W + e];
  const H = POOL.F, ya = top + MM(cov + dm / 2), yb = ya + d, yd = top + MM(H - POOL.coverW - dm / 2), yc = yd - d;
  const bars = [], ties = [], chairs = [], frogs = [];
  const ns = Math.round((s1 - s0) / st), nt = Math.round((t1 - t0) / st);
  for (const [yA, yB] of [[ya, yb], [yc, yd]]) {
    for (let k = 0; k <= nt; k++) { const t = t0 + (t1 - t0) * k / nt; bars.push([...P(s0, t, yA), ...P(s1, t, yA), d]); }
    for (let k = 0; k <= ns; k++) { const s = s0 + (s1 - s0) * k / ns; bars.push([...P(s, t0, yB), ...P(s, t1, yB), d]); }
    for (let a = 0; a <= ns; a++) for (let b = 0; b <= nt; b++) if ((a + b) % 2 === 0) ties.push([...P(s0 + (s1 - s0) * a / ns, t0 + (t1 - t0) * b / nt, (yA + yB) / 2), d * 0.9, 0.785]);
  }
  for (let s = s0 + 300; s < s1; s += 600) for (let t = t0 + 300; t < t1; t += 600) chairs.push([...P(s, t, top), +MM(cov).toFixed(6)]);
  for (let s = s0 + 500; s < s1; s += 1000) for (let t = t0 + 500; t < t1; t += 1000) frogs.push([...P(s, t, yb + d / 2), 0, +(yc - d / 2 - yb - d / 2).toFixed(6)]);
  // the starters: on the lines of the walls' two meshes, every 200
  const yTop = top + MM(H + 600);
  for (const { a, b, n } of wallLines(r)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.round(L / st));
    for (let k = 0; k < m; k++) {   // (the last is the next line's first: the corner)
      const s = a[0] + (b[0] - a[0]) * k / m, t = a[1] + (b[1] - a[1]) * k / m;
      bars.push([...P(s, t, yb + d), ...P(s, t, yTop), d]);
      // the foot: in the lower mesh, into the bowl (300)
      bars.push([...P(s, t, yb + d), ...P(s - n[0] * 300, t - n[1] * 300, yb + d), d]);
    }
  }
  return { type: 'cage', outlineId: null, beltId: r.floor ?? null, poolId: r.id, part: 'floor', bars, chairs, frogs, ties, tied: true, stars: [], d };
}
// the lines of the walls' meshes (frame mm): each face of each wall, 40 in from it plus a bar:
// { a, b, n (outward from the inside of the bowl) }
export function wallLines(r) {
  const c = POOL.coverW + POOL.bar / 2, L = r.L, W = r.W, out = [];
  for (const [o, inner] of [[POOL.T - c, false], [c, true]]) {
    out.push({ a: [-o, -o], b: [L + o, -o], n: [0, -1], inner }, { a: [L + o, -o], b: [L + o, W + o], n: [1, 0], inner },
      { a: [L + o, W + o], b: [-o, W + o], n: [0, 1], inner }, { a: [-o, W + o], b: [-o, -o], n: [-1, 0], inner });
  }
  return out;
}
// the walls: verticals Ø12 / 200 on both faces (lapped on the starters), horizontals Ø12 /
// 200 outside them; wire at every other crossing; wheel spacers on the horizontals
export function wallCage(r) {
  const P = (s, t, y) => { const [x, z] = PW(r, s, t); return [f5(x), f5(y), f5(z)]; };
  const d = MM(POOL.bar), st = POOL.step, top = floorTopY(r), H = wallH(r);
  const bars = [], ties = [], stars = [];
  const yv0 = top + MM(50), yv1 = top + MM(H - POOL.coverW), rows = [];
  for (let y = 150; y <= H - POOL.coverW - 20; y += st) rows.push(y);
  for (const { a, b, n, inner } of wallLines(r)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.round(L / st)), ux = (b[0] - a[0]) / L, ut = (b[1] - a[1]) / L;
    // the verticals: beside the starters (a bar along the wall from them)
    const sh = POOL.bar * 1.1;
    for (let k = 0; k < m; k++) { const s = a[0] + (b[0] - a[0]) * k / m + ux * sh, t = a[1] + (b[1] - a[1]) * k / m + ut * sh; bars.push([...P(s, t, yv0), ...P(s, t, yv1), d]); }
    // the horizontals: on the outer side of the verticals (toward the formwork)
    const off = POOL.bar * (inner ? -1 : 1), oS = n[0] * off, oT = n[1] * off;
    const yaw = Math.atan2(-(r.u[1] * ux + r.u[0] * ut), r.u[0] * ux - r.u[1] * ut);
    rows.forEach((y, ry) => {
      bars.push([...P(a[0] + oS, a[1] + oT, top + MM(y)), ...P(b[0] + oS, b[1] + oT, top + MM(y)), d]);
      for (let k = 0; k <= m; k++) {
        const s = a[0] + (b[0] - a[0]) * k / m + ux * sh, t = a[1] + (b[1] - a[1]) * k / m + ut * sh;
        if ((k + ry) % 2 === 0) ties.push([...P(s + oS / 2, t + oT / 2, top + MM(y)), d * 0.9, 0.785]);
        if (ry % 3 === 1 && k % 4 === 2) stars.push([...P(s + oS + ux * 60, t + oT + ut * 60, top + MM(y)), +yaw.toFixed(4), +MM(POOL.coverW).toFixed(6)]);
      }
    });
  }
  return { type: 'cage', outlineId: null, beltId: null, poolId: r.id, part: 'wall', bars, chairs: [], frogs: [], ties, tied: true, stars, d };
}

// ---- the inner faces: the coats, the mosaic -----------------------------------------------
// face k: 0 the floor (a along s, b along t), 1 the wall at t = 0, 2 at s = L, 3 at t = W,
// 4 at s = 0 (a along the wall, b up); P(a, b) → [s, t, y] (mm), N the normal into the bowl
export function faces(r) {
  const L = r.L, W = r.W, H = wallH(r);
  return [
    { k: 0, len: [L, W], P: (a, b) => [a, b, 0], N: [0, 0, 1] },
    { k: 1, len: [L, H], P: (a, b) => [a, 0, b], N: [0, 1, 0] },
    { k: 2, len: [W, H], P: (a, b) => [L, a, b], N: [-1, 0, 0] },
    { k: 3, len: [L, H], P: (a, b) => [L - a, W, b], N: [0, -1, 0] },
    { k: 4, len: [W, H], P: (a, b) => [0, W - a, b], N: [1, 0, 0] },
  ];
}
export const cellsOf = (F) => [Math.ceil(F.len[0] / POOL.cell - 1e-6), Math.ceil(F.len[1] / POOL.cell - 1e-6)];
// the mosaic sheets of a face: [ni, nj]; on the walls they are laid from the top down (the cut
// row at the floor), on the floor from the corner
export const sheetsOf = (F) => [Math.ceil(F.len[0] / POOL.sheet - 1e-6), Math.ceil(F.len[1] / POOL.sheet - 1e-6)];
export function sheetRect(F, i, j) {
  const sh = POOL.sheet, a0 = i * sh, a1 = Math.min(F.len[0], a0 + sh);
  if (F.k === 0) return [a0, j * sh, a1, Math.min(F.len[1], (j + 1) * sh)];
  const b1 = F.len[1] - j * sh, b0 = Math.max(0, b1 - sh);
  return [a0, b0, a1, b1];
}
// the stored values of a face: a string, a character per cell (padded)
export function faceStr(arr, k, n, fill = '0') { const s = arr?.[k] || ''; return s.length === n ? s : (s + fill.repeat(n)).slice(0, n); }

// ---- the coping ------------------------------------------------------------------------------
// side 0 along t = 0, 1 along s = L, 2 along t = W, 3 along s = 0. The long sides (0, 2) run
// over the corners; the short ones between them. Each stone: { side, i, a0, a1 (along), c0, c1
// (across: c0 inner edge, 30 over the water) } in frame mm, and the corners of it
export function copeLayout(r) {
  const L = r.L, W = r.W, o = POOL.stoneW - POOL.stoneOver, j = POOL.joint, e = POOL.stoneOver + j;
  const sides = [
    { side: 0, from: -o, to: L + o, P: (a, c) => [a, -c] },
    { side: 1, from: e, to: W - e, P: (a, c) => [L + c, a] },
    { side: 2, from: -o, to: L + o, P: (a, c) => [L - a, W + c] },
    { side: 3, from: e, to: W - e, P: (a, c) => [-c, W - a] },
  ];
  return sides.map((sd) => {
    const span = sd.to - sd.from, n = Math.max(1, Math.round(span / (POOL.stone + j))), len = (span - (n - 1) * j) / n;
    const list = [];
    for (let i = 0; i < n; i++) { const a0 = sd.from + i * (len + j); list.push({ side: sd.side, i, a0, a1: a0 + len, c0: -POOL.stoneOver, c1: o }); }
    return { ...sd, n, list };
  });
}

// ---- the finger on the bowl ----------------------------------------------------------------
// the ray in the pool's frame (mm, y up from the slab's top)
function rayFrame(r, ray) {
  const o = ray.origin, d = ray.direction, [s, t] = PF(r, o.x, o.z), y = (o.y - floorTopY(r)) / S;
  const ds = (d.x * r.u[0] + d.z * r.u[1]) / S, dt = (-d.x * r.u[1] + d.z * r.u[0]) / S, dy = d.y / S;
  return { s, t, y, ds, dt, dy };
}
// the inner face hit first (from inside the bowl): { k, a, b, s, t, y } or null
export function hitInner(r, ray) {
  const q = rayFrame(r, ray), L = r.L, W = r.W, H = wallH(r) + 60;
  let best = null;
  const tryHit = (k, tt, s, t, y, a, b) => { if (tt > 0 && (!best || tt < best.tt)) best = { tt, k, a, b, s, t, y }; };
  // the floor
  if (q.dy < 0) { const tt = -q.y / q.dy, s = q.s + q.ds * tt, t = q.t + q.dt * tt; if (s >= 0 && s <= L && t >= 0 && t <= W) tryHit(0, tt, s, t, 0, s, t); }
  // the walls (seen from inside: the ray goes toward them)
  const wall = (k, plane, axis, sign) => {
    const p0 = axis === 's' ? q.s : q.t, dp = axis === 's' ? q.ds : q.dt;
    if (dp * sign <= 0) return;
    const tt = (plane - p0) / dp, s = q.s + q.ds * tt, t = q.t + q.dt * tt, y = q.y + q.dy * tt;
    if (y < 0 || y > H) return;
    if (axis === 't' && (s < 0 || s > L)) return;
    if (axis === 's' && (t < 0 || t > W)) return;
    const a = k === 1 ? s : k === 2 ? t : k === 3 ? L - s : W - t;
    tryHit(k, tt, s, t, y, a, y);
  };
  wall(1, 0, 't', -1); wall(2, L, 's', 1); wall(3, W, 't', 1); wall(4, 0, 's', -1);
  return best;
}
// the plane of the rim (the coping's top): [s, t] or null
export function hitRim(r, ray) {
  const q = rayFrame(r, ray), y = (rimY(r) - floorTopY(r)) / S;
  if (Math.abs(q.dy) < 1e-9) return null;
  const tt = (y - q.y) / q.dy;
  if (tt <= 0) return null;
  return [q.s + q.ds * tt, q.t + q.dt * tt];
}
// the plane of the ground at the pit's place: world point
export function hitGround(ray, y) {
  return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
}

// ---- the embedded parts (frame mm; y over the slab) ----------------------------------------
export function embeds(r) {
  const L = r.L, W = r.W, H = wallH(r), wl = waterMax(r);
  return {
    // two skimmers in the far wall, their mouths across the water line
    skim: [0.2, 0.8].map((f) => ({ face: 3, a: L * f, b: H - 5 - 75, w: 230, h: 150 })),
    // three inlets in the near wall, 350 under the water
    inlet: [0.15, 0.5, 0.85].map((f) => ({ face: 1, a: L * f, b: wl - 350 })),
    // two lights in the near wall, 600 under the water, facing the far one
    light: [1 / 3, 2 / 3].map((f) => ({ face: 1, a: L * f, b: wl - 600 })),
    // the main drain in the middle of the floor
    drain: [{ face: 0, a: L / 2, b: W / 2 }],
  };
}
