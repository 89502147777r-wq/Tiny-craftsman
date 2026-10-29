import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf } from './freeBrick.js';
import { FitJob, drive, hammer } from './fitJob.js';
import { plan as beltPlan, toWorld as beltWorld, beltContains } from './belt.js';
import { RWIN_TYPES, rwinSpan } from '../world/roofWindows.js';
import { wingShape, valleys, planes, planeSpans, frameOf, MEMB, coverPiece, coverSlot, coverSlotAt, coverSlots, coverRows, MTILE, roofTop, planeAt, rafterGrid, STAGES, FINGER, PITCHED, PITCHES, PITCH_RANGE, ROOF_TYPES, COVERS, COVER_COLOURS, RWIN, GUTTERS, GUTTER_COLOURS } from '../world/pitched.js';

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
const STEP = { joists: PITCHED.step, frame: PITCHED.step, memb: 600, battens: PITCHED.step };
const PREV = { joists: 'plate', ridge: 'joists', frame: 'ridge', memb: 'frame', battens: 'memb', cover: 'battens', trim: 'cover', gutter: 'trim' };

// the house under the roof: the plan of the masonry in a grid along its walls, filled in,
// cut into rectangles → the wings; the top of the walls (or of the ring beam on them)
let _outside = null;
// the outside of the house (the plot reached from its edge, round the walls): (x, z) → true
// outside, false inside, null on a wall — or null when there is no house
export function houseOutside(app) { _outside = null; findHouse(app, null, true); return _outside; }
// the buildings on the plot: the masonry in groups — units touching (within 100 mm) belong to one
// (a garage beside the house is its own building, with its own roof). A floor slab cast between
// two tiers parts them: the walls on a slab are a building of their own (two small houses on one
// big slab — each its own wall plate and roof). Cached till units / slabs change
let _bk = null, _bs = null;
export function buildings(app) {
  const us = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop' && !u.lintel), slabs = app.objects.all('belt').filter((b) => b.kind === 'slab');
  const rings = app.objects.all('belt').filter((b) => !b.kind && !b.lform);
  const key = us.length + ':' + (us.at(-1)?.id ?? 0) + ':' + slabs.map((b) => b.id).join(',') + ':' + rings.map((b) => b.id).join(',');
  if (key === _bk) return _bs;
  const bx = us.map(boxOf), n = bx.length, par = Int32Array.from({ length: n }, (_, i) => i), gap = MM(100);
  const root = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const rad = bx.map((b) => Math.hypot(b.hl, b.hw));
  const apart = (a, b) => {
    // (one over the other with a slab between: apart)
    const [lo, hi] = a.top <= b.bot + MM(5) ? [a, b] : b.top <= a.bot + MM(5) ? [b, a] : [null, null];
    if (lo && hi.bot - lo.top > gap && slabs.some((s) => s.top > lo.top - MM(40) && s.top < hi.bot && (beltContains(s, lo.x, lo.z) || beltContains(s, hi.x, hi.z)))) return true;
    // (the boxes' gap along their sides — the axes of either)
    for (const [ax, az] of [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]]) {
      const ra = Math.abs(a.hl * (a.ux * ax + a.uz * az)) + Math.abs(a.hw * (-a.uz * ax + a.ux * az)), rb = Math.abs(b.hl * (b.ux * ax + b.uz * az)) + Math.abs(b.hw * (-b.uz * ax + b.ux * az));
      if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) - ra - rb > gap) return true;
    }
    return false;
  };
  const ord = [...bx.keys()].sort((i, j) => bx[i].x - bx[j].x);
  for (let p = 0; p < n; p++) {
    const i = ord[p], a = bx[i];
    for (let q = p + 1; q < n; q++) {
      const j = ord[q], b = bx[j];
      if (b.x - a.x > rad[i] + 0.2 + gap) break;
      if (Math.hypot(b.x - a.x, b.z - a.z) > rad[i] + rad[j] + gap || root(i) === root(j) || apart(a, b)) continue;
      par[root(i)] = root(j);
    }
  }
  // a ring beam cast over them ties them into one: the walls and the pillars apart from them
  // (a porch, a terrace under the same roof) carry one wall plate, one roof
  for (const R of rings) {
    let first = -1;
    for (let i = 0; i < n; i++) if (Math.abs(bx[i].top - R.top) < MM(30) && beltContains(R, bx[i].x, bx[i].z)) { if (first < 0) first = i; else if (root(i) !== root(first)) par[root(i)] = root(first); }
  }
  const g = new Map(); bx.forEach((b, i) => { const r = root(i); if (!g.has(r)) g.set(r, []); g.get(r).push(b); });
  _bk = key; _bs = [...g.values()].sort((p, q) => q.length - p.length);
  return _bs;
}
// the building nearest a point (on the ground: to its masonry), or the biggest
export function buildingAt(app, p) {
  const bs = buildings(app);
  if (!p || bs.length < 2) return bs[0] || null;
  let best = null, bd = Infinity;
  // (in height too: the walls of the tier the finger is at)
  for (const B of bs) for (const b of B) { const d = Math.hypot(b.x - p.x, b.z - p.z) - Math.hypot(b.hl, b.hw) + (p.y != null ? Math.max(0, b.bot - p.y, p.y - b.top) : 0); if (d < bd) bd = d, best = B; }
  return best;
}
// near: the building the finger is at (else the biggest); whole: all the masonry as one
// base: the plan of its lowest courses (the blind area goes round the foot of the house, not
// round an upper floor set out over it)
// band: the walls up to this level only (a lean-to: the garage's walls and the house's under their top)
export function findHouse(app, near = null, whole = false, base = false, band = null) {
  const all = whole ? app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop' && !u.lintel).map(boxOf) : buildingAt(app, near) || [];
  if (all.length < 8) return null;
  // the walls the roof stands on: the upper courses (a plinth, a wider first tier under them
  // would push the outline out)
  const yMax = band ?? Math.max(...all.map((b) => b.top)), yMin = Math.min(...all.map((b) => b.bot));
  const units = all.filter((b) => (base ? b.bot < yMin + MM(1500) : band != null ? b.top <= band + MM(30) && b.top > band - MM(1500) : b.top > yMax - MM(1500)));
  if (units.length < 8) return null;
  // the way the walls run: the most common direction (mod 90°), then the mean of the units
  // near it (laid by hand: each a little off — the plate must follow the walls, not a 1,4° step)
  const md = (b) => (((b.yaw % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2));
  const bins = new Map();
  for (const b of units) { const k = Math.round(md(b) * 40); bins.set(k, (bins.get(k) || 0) + b.hl); }
  const y0b = [...bins].sort((p, q) => q[1] - p[1])[0][0] / 40;
  let sx = 0, sy = 0;
  for (const b of units) { let d = md(b) - y0b; if (d > Math.PI / 4) d -= Math.PI / 2; if (d < -Math.PI / 4) d += Math.PI / 2; if (Math.abs(d) < 0.06) { sx += b.hl * Math.cos(d * 4); sy += b.hl * Math.sin(d * 4); } }
  const yaw = y0b + Math.atan2(sy, sx) / 4, ux = Math.cos(yaw), uz = -Math.sin(yaw);
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
  // what spans the openings closes the outline too: the lintels, the ring beams / cast
  // lintels (not units of the walls); and an opening left up to the top with nothing over it
  // yet — a gap ≤ 3,2 m along a wall between runs longer than it is thick
  const mark = (x, z) => { const pa = toA(x, z), pd = toD(x, z), i = Math.floor((pa - a0) / C), j = Math.floor((pd - d0) / C); if (i >= 0 && j >= 0 && i < ni && j < nj) grid[j * ni + i] = 1; };
  for (const b of app.objects.all('unit').filter((u) => u.lintel && u.p && u.s && u.q).map(boxOf)) {
    for (let s = -b.hl; s <= b.hl; s += C * 0.5) for (let t = -b.hw; t <= b.hw; t += C * 0.5) mark(b.x + b.ux * s - b.uz * t, b.z + b.uz * s + b.ux * t);
  }
  for (const b of app.objects.all('belt')) {
    if (b.kind === 'slab' || b.kind === 'pool') continue;
    const P = beltPlan(b);
    for (const [i, j] of P.cells) { const [x, z] = beltWorld(b, (i + 0.5) * b.c, (j + 0.5) * b.c); mark(x, z); }
  }
  {
    const longRun = Math.ceil(MM(360) / C), maxGap = Math.round(MM(3200) / C), add = [];
    const scan = (n, m, at) => {
      for (let a = 0; a < m; a++) {
        const runs = []; let st = -1;
        for (let b = 0; b <= n; b++) { const on = b < n && grid[at(a, b)]; if (on && st < 0) st = b; if (!on && st >= 0) { runs.push([st, b]); st = -1; } }
        for (let k = 1; k < runs.length; k++) { const [p0, p1] = runs[k - 1], [q0, q1] = runs[k]; if (q0 - p1 <= maxGap && p1 - p0 >= longRun && q1 - q0 >= longRun) for (let b = p1; b < q0; b++) add.push(at(a, b)); }
      }
    };
    scan(ni, nj, (j, i) => j * ni + i); scan(nj, ni, (i, j) => j * ni + i);
    for (const k of add) grid[k] = 1;
  }
  // filled in: what the outside cannot reach
  const out = new Uint8Array(ni * nj), st = [];
  for (let i = 0; i < ni; i++) st.push([i, 0], [i, nj - 1]); for (let j = 0; j < nj; j++) st.push([0, j], [ni - 1, j]);
  while (st.length) { const [i, j] = st.pop(); if (i < 0 || j < 0 || i >= ni || j >= nj) continue; const k = j * ni + i; if (out[k] || grid[k]) continue; out[k] = 1; st.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]); }
  const fill = new Uint8Array(ni * nj); for (let k = 0; k < fill.length; k++) fill[k] = out[k] ? 0 : 1;
  // (for the facade: is a point outside the house — reached from the edge of the plot)
  _outside = (x, z) => { const i = Math.floor((toA(x, z) - a0) / C), j = Math.floor((toD(x, z) - d0) / C); if (i < 0 || j < 0 || i >= ni || j >= nj) return true; const k = j * ni + i; return grid[k] ? null : !!out[k]; };
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
  // a lean-to (band): only the room the finger is at — its inside cells (walled in by its own walls
  // and the house's), out to the outer faces of its walls; not the whole plan round the house
  if (band != null && near) {
    const Tm = [...units.map((b) => 2 * Math.min(b.hw, b.hl))].sort((p, q) => p - q)[Math.floor(units.length / 2)], nT = Math.max(1, Math.round(Tm / C));
    const pi = Math.floor((toA(near.x, near.z) - a0) / C), pj = Math.floor((toD(near.x, near.z) - d0) / C);
    let seed = -1, sd = Infinity;
    for (let j = pj - 12; j <= pj + 12; j++) for (let i = pi - 12; i <= pi + 12; i++) { if (i < 0 || j < 0 || i >= ni || j >= nj) continue; const k = j * ni + i; if (grid[k] || out[k]) continue; const dd = (i - pi) ** 2 + (j - pj) ** 2; if (dd < sd) sd = dd, seed = k; }
    if (seed >= 0) {
      const seen = new Uint8Array(ni * nj), st2 = [seed]; seen[seed] = 1;
      let i0 = ni, i1 = -1, j0 = nj, j1 = -1;
      while (st2.length) { const k = st2.pop(), i = k % ni, j = (k - i) / ni; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); for (const q of [i > 0 ? k - 1 : -1, i < ni - 1 ? k + 1 : -1, k - ni, k + ni]) if (q >= 0 && q < ni * nj && !seen[q] && !grid[q] && !out[q]) { seen[q] = 1; st2.push(q); } }
      rects.length = 0;
      rects.push({ ar: (i1 - i0 + 1) * (j1 - j0 + 1), i0: Math.max(0, i0 - nT), i1: Math.min(ni, i1 + 1 + nT), j0: Math.max(0, j0 - nT), j1: Math.min(nj, j1 + 1 + nT) });
    }
  }
  if (!rects.length) return null;
  // the wings: the ridge along the longer side; an end touching another rectangle joins it.
  // Each side of a rectangle (on the 100 mm grid) goes onto the true outer face of the
  // walls along it (the wall plate, the studs in the ring beam, the blind area line up)
  // (each unit in the frame: its extent along a and d)
  const ext = units.map((b) => { let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity; for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const x = b.x + b.ux * b.hl * sx - b.uz * b.hw * sz, z = b.z + b.uz * b.hl * sx + b.ux * b.hw * sz, pa = toA(x, z), pd = toD(x, z); p0 = Math.min(p0, pa); p1 = Math.max(p1, pa); q0 = Math.min(q0, pd); q1 = Math.max(q1, pd); } return [p0, p1, q0, q1]; });
  // the face of the walls along a side: where most of them end (by their length along it) — a
  // pier standing out of the wall, a sill, is not the face the wall plate lines up with
  const face = (v, lo, hi, isA, out) => {
    const bins = new Map();
    for (const [p0, p1, q0, q1] of ext) {
      const q = isA ? (out > 0 ? p1 : p0) : (out > 0 ? q1 : q0), r0 = isA ? q0 : p0, r1 = isA ? q1 : p1;
      if (Math.abs(q - v) > C * 1.2) continue;
      const len = Math.min(r1, hi - C) - Math.max(r0, lo + C);
      if (len <= 0) continue;
      const k = Math.round(q / MM(5)); bins.set(k, (bins.get(k) || 0) + len);
    }
    let best = null, bw = 0;
    for (const [k, wt] of bins) if (wt > bw * 1.001 || (Math.abs(wt - bw) <= bw * 0.001 && (out > 0 ? k > best : k < best))) { best = k; bw = wt; }
    return best == null ? v : best * MM(5);
  };
  const wings = rects.map((r) => {
    let ra = [a0 + r.i0 * C, a0 + r.i1 * C], rd = [d0 + r.j0 * C, d0 + r.j1 * C];
    ra = [face(ra[0], rd[0], rd[1], true, -1), face(ra[1], rd[0], rd[1], true, 1)];
    rd = [face(rd[0], ra[0], ra[1], false, -1), face(rd[1], ra[0], ra[1], false, 1)];
    const along = ra[1] - ra[0] >= rd[1] - rd[0];
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
  for (const b of app.objects.all('belt')) if (b.kind !== 'pool' && b.fill > 0.5 && b.top + b.H > y0 - MM(50) && b.top + b.H < y0 + MM(400) && (band == null || wings.some((w) => beltContains(b, w.cx, w.cz)))) y0 = Math.max(y0, b.top + b.H);
  // the walls' thickness: from the face inward along each side, through the masonry there (the
  // joints bridged) — not the commonest unit (a brick pier's 120 mm bricks in a 300 mm block house)
  let T = [...units.map((b) => 2 * Math.min(b.hw, b.hl))].sort((p, q) => p - q)[Math.floor(units.length / 2)];
  {
    const deep = [];
    for (const w of wings) for (const [isA, out] of [[true, -1], [true, 1], [false, -1], [false, 1]]) {
      const f = isA ? w.ra[out > 0 ? 1 : 0] : w.rd[out > 0 ? 1 : 0], [lo, hi] = isA ? w.rd : w.ra;
      for (let r = lo + MM(300); r <= hi - MM(300); r += MM(400)) {
        const near = ext.filter(([p0, p1, q0, q1]) => (isA ? q0 <= r && q1 >= r : p0 <= r && p1 >= r));
        const inside = (q) => near.some(([p0, p1, q0, q1]) => (isA ? p0 <= q && p1 >= q : q0 <= q && q1 >= q));
        let last = null, gap = 0;
        for (let k = 1; k <= 80; k++) { const q = f - out * MM(10) * k + out * MM(5); if (inside(q)) { last = k; gap = 0; } else if (last != null && ++gap > 2) break; else if (last == null && k > 3) break; }
        if (last != null && last * 10 >= 80) deep.push(MM(last * 10));
      }
    }
    if (deep.length >= 4) { deep.sort((p, q) => p - q); T = deep[deep.length >> 1]; }
  }
  const g = Math.min(...all.map((b) => b.bot)) - MM(20);
  return { y0: +y0.toFixed(6), T: +T.toFixed(6), g: +g.toFixed(6), wings: wings.map((w) => ({ cx: +w.cx.toFixed(6), cz: +w.cz.toFixed(6), ux: +w.ux.toFixed(6), uz: +w.uz.toFixed(6), A: +w.A.toFixed(6), B: +w.B.toFixed(6), e: w.e, x: w.x.map((v) => +v.toFixed(6)) })) };
}

// A lean-to (пристройка) built on to a higher house — a garage of three walls, the fourth the house:
// the finger at the top of its walls (well under the house's top). The plan of the walls up to that
// level (the garage's and the house's under it) → the rectangle the finger is over: the garage; the
// side of it against walls going on up: the house. Its roof: one slope, rising to the house.
export function findLean(app, p) {
  if (!p) return null;
  const B = buildingAt(app, p);
  if (!B || B.length < 8) return null;
  const yMax = Math.max(...B.map((b) => b.top));
  // the unit nearest the finger: the top of the walls there
  let nb = null, bd = Infinity;
  for (const b of B) { const dx = p.x - b.x, dz = p.z - b.z, a = Math.max(0, Math.abs(dx * b.ux + dz * b.uz) - b.hl), d = Math.max(0, Math.abs(-dx * b.uz + dz * b.ux) - b.hw), dy = Math.max(0, b.bot - p.y, p.y - b.top), q = Math.hypot(a, d, dy); if (q < bd) bd = q, nb = b; }
  if (!nb) return null;
  // (the top of that wall: the highest unit stacked there)
  const yT = Math.max(...B.filter((b) => Math.hypot(b.x - nb.x, b.z - nb.z) < b.hl + nb.hl + MM(20) && b.top < yMax - MM(600) && b.top > nb.top - MM(800)).map((b) => b.top), nb.top);
  if (yMax - yT < MM(800)) return null;
  // (the same walls, the same part: as found before — the finger moving over it)
  const ck = B.length + ':' + B[0].u.id + ':' + Math.round(yT * 1e5) + ':' + app.objects.all('belt').length;
  if (_lean.key === ck && (!_lean.val || _lean.val.wings.some((q) => { const dx = p.x - q.cx, dz = p.z - q.cz; return Math.abs(dx * q.ux + dz * q.uz) <= q.A + MM(400) && Math.abs(-dx * q.uz + dz * q.ux) <= q.B + MM(400); }))) return _lean.val;
  const val = leanOf(app, p, B, yT);
  _lean.key = ck; _lean.val = val;
  return val;
}
const _lean = { key: null, val: null };
function leanOf(app, p, B, yT) {
  const H = findHouse(app, p, false, false, yT);
  if (!H) return null;
  const inW = (w, x, z, o = 0) => { const dx = x - w.cx, dz = z - w.cz; return Math.abs(dx * w.ux + dz * w.uz) <= w.A + o && Math.abs(-dx * w.uz + dz * w.ux) <= w.B + o; };
  const w = H.wings.find((q) => inW(q, p.x, p.z, MM(400))) || H.wings.reduce((a, q) => (Math.hypot(q.cx - p.x, q.cz - p.z) < Math.hypot(a.cx - p.x, a.cz - p.z) ? q : a));
  // the side against the house: units going on up over the lean-to's walls just past it
  const high = B.filter((b) => b.top > yT + MM(500));
  const vx = -w.uz, vz = w.ux, sides = [[0, vx, vz, w.B, w.A, w.ux, w.uz], [1, -vx, -vz, w.B, w.A, w.ux, w.uz], [2, w.ux, w.uz, w.A, w.B, vx, vz], [3, -w.ux, -w.uz, w.A, w.B, vx, vz]];
  let md = -1, best = 0, inner = false;
  const isHigh = (x, z) => high.some((b) => { const dx = x - b.x, dz = z - b.z; return Math.abs(dx * b.ux + dz * b.uz) <= b.hl + MM(10) && Math.abs(-dx * b.uz + dz * b.ux) <= b.hw + MM(10); });
  for (const [k, nx, nz, off, len, ax, az] of sides) {
    // (in the wall along that side — the house's wall may be taken in with the lean-to — and just past it)
    for (const [o, inn] of [[off - H.T / 2, true], [off + MM(120), false]]) {
      let hits = 0;
      for (let i = -2; i <= 2; i++) if (isHigh(w.cx + nx * o + ax * len * i * 0.4, w.cz + nz * o + az * len * i * 0.4)) hits++;
      if (hits > best) best = hits, md = k, inner = inn;
    }
  }
  if (md < 0 || best < 3) return null;
  // (the house's wall is not the lean-to's: its edge on the outer face of that wall)
  const T = inner ? H.T : 0, nw = { ...w };
  if (md <= 1) { const sg = md === 0 ? 1 : -1; nw.B = w.B - T / 2; nw.cx = w.cx - vx * sg * T / 2; nw.cz = w.cz - vz * sg * T / 2; }
  else { const sg = md === 2 ? 1 : -1; nw.A = w.A - T / 2; nw.cx = w.cx - w.ux * sg * T / 2; nw.cz = w.cz - w.uz * sg * T / 2; }
  return { ...H, lean: true, wings: [{ ...nw, e: ['end', 'end'], x: [0, 0], style: 'mono', md, abut: true, pitch: 12 }] };
}

// the roof has diagonal rafters to put up first: a hip end, or a valley between two wings
function needHips(r) { const sh = r.wings.map((w) => wingShape(r, w)); return sh.some((f) => !f.mono && f.ends.includes('hip')) || valleys(r, sh).length > 0; }

export class PitchedWork {
  constructor(app) { this.app = app; this.drag = null; this.place = null; }
  get stage() { return this.app.settings.proofStage || 'plate'; }
  get isCarry() { return !FINGER.has(this.stage); }   // (the covering too: piece by piece from the tray)
  // the roof worked on: the one last under the finger (several buildings, each its own roof)
  get rec() { const all = this.app.objects.all('proof'); return all.find((r) => r.id === this.sel) || all.at(-1) || null; }
  // the roof under the finger (its surface first hit), else the one nearest the point
  pick(e, p) {
    const all = this.app.objects.all('proof');
    if (all.length < 2) { this.sel = all[0]?.id; return; }
    let best = null, bt = Infinity;
    if (e) for (const r of all) { const h = this._hit(e, r); if (h && h.t < bt) bt = h.t, best = r; }
    if (!best && p) {
      for (const r of all) for (const w of r.wings) {
        const dx = p.x - w.cx, dz = p.z - w.cz, a = Math.abs(dx * w.ux + dz * w.uz) - w.A, d = Math.abs(-dx * w.uz + dz * w.ux) - w.B, q = Math.hypot(Math.max(0, a), Math.max(0, d));
        if (q < bt) bt = q, best = r;
      }
    }
    if (best) this.sel = best.id;
  }
  // the wing the type / the pitch / the slope go to (−1: all of them)
  get wing() { const r = this.rec, k = this.app.settings.proofWing ?? -1; return r && k >= 0 && k < r.wings.length ? k : -1; }
  // what the menu's type / pitch / slope go to: the roof worked on while its rafters are not all up
  // — once they are, the next roof (the menu then shows and keeps what is chosen for it)
  get target() { const r = this.rec; if (!r) return null; const f = r.done?.frame; return f === true || (Array.isArray(f) && r.wings.every((_, i) => f.some((q) => q[0] === i))) ? null : r; }
  opts(r = this.target) {
    const s = this.app.settings, w = r && this.wing >= 0 ? r.wings[this.wing] : null;
    const type = w?.style || (r ? r.style : s.proofType) || s.proofType || 'gable', kind = s.proofCover || 'metal';
    const p0 = w?.pitch || (r ? r.pitch : s.proofPitch) || s.proofPitch;
    const [plo, phi] = PITCH_RANGE[type], pitch = p0 >= plo && p0 <= phi ? p0 : PITCHES[type][type === 'mono' ? 1 : 2];
    const col = COVER_COLOURS[kind][s.proofCol] ? s.proofCol : Object.keys(COVER_COLOURS[kind])[0];
    const gk = GUTTERS[s.proofGut] ? s.proofGut : 'round', gc = GUTTER_COLOURS[s.proofGutCol] ? s.proofGutCol : 'graphite';
    return { style: type, pitch, cover: { kind, col }, gut: { kind: gk, col: gc }, md: w?.md || 0 };
  }
  _ends(wings) { return wings; }
  _live(live) { const v = this.app.wallView; v.liveProof = live && !live.ghost ? { ...live, id: this.rec?.id ?? null } : live; v.proofDirty = true; if (!live) this._ghostOff(); }
  _ghostOff() { const g = this._ghost; if (!g) return; this.app.scene.remove(g.mesh); if (this.place?.sheet !== g) g.mesh.geometry.dispose(); this._ghost = null; }   // (the piece let go keeps its geometry: it goes down onto the roof)
  // ---- the covering, piece by piece from the tray: the place on the slope under the finger, the
  // piece made for it (cut to the plane: a hip, the ridge, a valley, a roof window) ----
  _sheetMove(e) {
    const app = this.app, r = this.rec, no = (why) => { this._ghostOff(); this.why = why; return { ok: false, why }; };
    if (!r?.done?.battens) return no('Покрытие — на обрешётку: сначала этап «Обрешётка»');
    if (r.done.cover === true) return no('Покрытие уже уложено — дальше «Конёк и планки»');
    const h = this._hit(e); if (!h) return no('Поднесите лист к скату крыши');
    const w = r.wings[h.wi], pa = planeAt(r, w, h.f, h.a, h.d); if (!pa) return no('Поднесите лист к скату крыши');
    const [i, j] = coverSlotAt(r, pa.P, pa.x, pa.t), key = `${r.id}:${h.wi}:${pa.key}:${i}:${j}`;
    const spOf = (v) => (v === true ? [[h.f.lo - 1, h.f.hi + 1]] : (v || []).filter((q) => q[0] === h.wi).map((q) => [q[1], q[2]]));
    const slot = coverSlot(r, pa.P, i, j), cx = (slot[0] + slot[1]) / 2, ct = (slot[2] + slot[3]) / 2, inn = (v) => planeSpans(pa.P, spOf(v), h.f).some(([x0, x1, t0, t1]) => cx >= x0 && cx <= x1 && ct >= t0 && ct <= t1);
    const taken = (r.sheets || []).some((q) => q[0] === h.wi && q[1] === pa.key && q[2] === i && q[3] === j) || inn(r.done.cover);
    const why = taken ? 'Здесь лист уже лежит' : !inn(r.done.battens) ? 'Здесь ещё нет обрешётки' : !coverSlots(r).some((q) => q[0] === h.wi && q[1] === pa.key && q[2] === i && q[3] === j) ? 'Здесь листу нет места' : null;
    if (this._ghost?.key !== key) {
      this._ghostOff();
      const wins = app.objects.all('rwin').filter((q) => q.host === r.id && !q.flat), pc = coverPiece(r, h.wi, pa.key, ...slot, wins);
      if (!pc) return no('Здесь листу нет места');
      // (cut: narrower than a whole piece at its row — at a hip, at the ridge, in a valley)
      const R = coverRows(r, pa.P), cut = slot[3] - slot[2] < R.rowL - MM(5) || slot[1] - slot[0] < R.W - MM(5) || pa.P.xa(slot[2]) > slot[0] + MM(5) || pa.P.xb(slot[2]) < slot[1] - MM(5) || pa.P.xa(slot[3]) > slot[0] + MM(5) || pa.P.xb(slot[3]) < slot[1] - MM(5);
      this._ghost = { key, ...pc, slot, cut, at: [h.wi, pa.key, i, j], mat0: pc.mesh.material };
      pc.mesh.position.copy(pc.n).multiplyScalar(MM(80));
      app.scene.add(pc.mesh);
    }
    const g = this._ghost;
    g.mesh.material = why ? (this._red ||= new THREE.MeshBasicMaterial({ color: 0xd03030, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })) : g.mat0;
    this.why = why;
    this.place = why ? null : { sheet: g };
    return { ok: !why, why };
  }
  _sheetDrop(g) {
    const app = this.app, r = this.rec, kind = r.cover?.kind || 'metal';
    this._ghost = null;   // (the piece goes down onto the battens, then it is part of the roof)
    const m = g.mesh, n = g.n, [xa, xb, ta, tb] = g.slot, xm = (xa + xb) / 2;
    const at = (x, t) => { const [a, dd] = g.P.at(Math.max(g.P.xa(t) + MM(100), Math.min(g.P.xb(t) - MM(100), x)), t); return new THREE.Vector3(...g.f.W(a, dd, g.f.top(a, dd) + MM(40))); };
    const steps = [[0.3, (u) => { m.position.copy(n).multiplyScalar(MM(80) * (1 - u) * (1 - u)); }]];
    if (kind === 'shingle') for (const t of [ta + (tb - ta) * 0.3, ta + (tb - ta) * 0.7]) steps.push(hammer(app, at(xm, t), n, 2, 0.12));
    else for (const t of [ta + MM(90), (ta + tb) / 2, tb - MM(120)]) if (t > ta && t < tb) steps.push(drive(app, at(xm, t), n, null, 0.22));
    app.scene.remove(m);
    new FitJob(app, { steps, parts: [m], commit: () => {
      const cur = app.objects.get(r.id); if (!cur) return;
      const sheets = [...(cur.sheets || []), g.at], all = coverSlots(cur), full = all.every((q) => sheets.some((s2) => s2[0] === q[0] && s2[1] === q[1] && s2[2] === q[2] && s2[3] === q[3]));
      app.journal.act('proof-sheet', {}, app.clock, () => app.objects.update(r.id, { sheets, ...(full ? { done: { ...cur.done, cover: true } } : {}) }));
      const nm = kind === 'metal' ? 'Лист металлочерепицы' : kind === 'seam' ? 'Фальцевая панель' : 'Пачка мягкой черепицы';
      app.ui.toast(full ? `${COVERS[kind]} уложена вся — дальше «Конёк и планки»` : `${nm}${g.cut ? ' (подрезан по месту)' : ''} — уложено ${sheets.length} из ${all.length}`);
    } });
  }
  _save(patch, label) {
    const app = this.app, r = this.rec;
    app.journal.act(label, {}, app.clock, () => { if (r) app.objects.update(r.id, { ...patch }); else app.objects.add({ type: 'proof', ...patch }); });
  }
  // the settings changed (o: what changed): the roof follows while it can — the type, the pitch,
  // the slope of a wing till its rafters are up; the covering till it is laid
  applyOpts(o = {}) {
    if (!this.rec) return;
    if (!this.target && (o.style || o.pitch || o.md != null)) { this.app.ui.toast(`${o.style ? `Тип «${ROOF_TYPES[o.style]}»` : 'Уклон'} — для следующей крыши: поднесите мауэрлат к зданию без крыши (на той крыше стропила уже стоят)`); return; }
    const r = this.target || this.rec;   // (the gutters, the covering: on the roof worked on)
    const k = this.wing, framed = (wi) => r.done?.hips || r.done?.frame === true || (r.done?.frame || []).some((q) => q[0] === wi);
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
    if (o.gut) patch.gut = this.opts().gut;   // (the gutters can be changed any time: taken down, others hung)
    if (o.cover) { if (r.done?.cover) this.app.ui.toast(this.target ? 'Покрытие уже уложено — цвет не меняется' : 'Покрытие — для следующей крыши: на этой оно уже уложено'); else patch.cover = this.opts().cover; }
    if (Object.keys(patch).length) this._save(patch, 'proof-opts');
  }
  // the slope of a mono-pitch wing: which way it rises (round the four sides)
  turnSlope() { const r = this.target; if (!r) return; const k = this.wing, w = r.wings[k >= 0 ? k : 0]; this.applyOpts({ md: ((w.md || 0) + 1) % 4 }); }
  // the ridge of a wing turned 90° (along the other side): a wing on its own (not joined to
  // another), till its rafters are up
  turnRidge() {
    const r = this.target, app = this.app; if (!r) return;
    const k = this.wing, list = k >= 0 ? [k] : r.wings.map((_, i) => i);
    const framed = (wi) => r.done?.hips || r.done?.frame === true || (r.done?.frame || []).some((q) => q[0] === wi);
    if (list.some(framed)) { app.ui.toast('Стропила уже стоят — конёк не повернуть (снимите стропила «Удалить»)'); return; }
    if (list.some((i) => r.wings[i].e.includes('join') || r.wings.some((o) => o.e.includes('join')))) { app.ui.toast('У дома из нескольких крыльев конёк идёт вдоль каждого крыла — поверните скат у односкатного крыла или выберите тип'); return; }
    const wings = r.wings.map((w, i) => (list.includes(i) ? { ...w, ux: +(-w.uz).toFixed(6), uz: +w.ux.toFixed(6), A: w.B, B: w.A } : w));
    this._save({ wings }, 'proof-ridge');
    app.ui.toast('Конёк повернули на 90°');
  }

  // ---- the finger on the roof: the point of its surface (the top of the rafters) under it ----
  _hit(e, r = this.rec) {
    if (!r || !e || e.clientX === undefined) return null;
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
    return { wi, a, d: dd, f: shapes[wi], t: t1 };
  }
  down(p, e) {
    if (!this.isCarry) this.pick(e, p);
    const app = this.app, L = this.stage, r = this.rec;
    if (this.isCarry) { app.ui.toast(`${NAME[L]}: тяните из лотка справа на ${L === 'plate' ? 'верх стен' : 'крышу'}`); return true; }
    if (!r) { app.ui.toast('Сначала мауэрлат: тяните его из лотка на верх стен — крыша встанет по дому'); return true; }
    if (!r.done?.[PREV[L]] && !(L === 'frame' && r.done?.frame)) { app.ui.toast(`${NAME[L]} — после этапа «${NAME[PREV[L]]}»`); return true; }
    const h = this._hit(e);
    if (!h) { app.ui.toast(L === 'joists' ? 'Ведите пальцем над домом вдоль конька' : 'Ведите пальцем по крыше'); return true; }
    // the frame begins with the diagonal rafters (the hips from the ridge to the corners, the
    // valleys where wings meet): the jack rafters and the rafters by them rest on them
    if (L === 'frame' && needHips(r) && !r.done?.hips) {
      this._save({ done: { ...r.done, hips: true } }, 'proof-hips');
      const sh = r.wings.map((w) => wingShape(r, w)), nh = sh.reduce((n, f) => n + f.ends.filter((q) => q === 'hip').length * 2, 0), nv = valleys(r, sh).length;
      app.ui.toast(`Диагональные стропила: ${nh ? `${nh} вальмовых от конька к углам` : ''}${nh && nv ? ', ' : ''}${nv ? `${nv} ендовых` : ''} — спаренные 2 × 50×200, верхом на прогон, низом на угол мауэрлата. Дальше рядовые стропила и нарожники: ведите пальцем вдоль конька`);
      return true;
    }
    this.drag = this._dragAt(h);
    this._show();
    return true;
  }
  // a stroke: along the wing (the joists; the rafters on the long slopes — in pairs, both sides
  // together) or on the one plane the finger is on (the jack rafters of a hip end; the membrane,
  // a roll at a time; the battens, slope by slope)
  _dragAt(h) {
    const r = this.rec, L = this.stage, pa = planeAt(r, r.wings[h.wi], h.f, h.a, h.d);
    const own = pa && (L === 'memb' || L === 'battens' || (L === 'frame' && pa.P.end));
    return { wi: h.wi, a0: h.a, a1: h.a, f: h.f, dd: h.d, key: own ? pa.key : null, P: pa?.P, x0: pa?.x, x1: pa?.x, t: pa?.t };
  }
  move(p, e) {
    const d = this.drag; if (!d) return;
    const h = this._hit(e);
    if (!h) return;
    const n = this._dragAt(h);
    if (h.wi !== d.wi || n.key !== d.key) { this._commit(); this.drag = n; }
    else { d.a0 = Math.min(d.a0, h.a); d.a1 = Math.max(d.a1, h.a); if (n.x0 != null) { d.x0 = Math.min(d.x0, n.x0); d.x1 = Math.max(d.x1, n.x1); } }
    this._show();
  }
  // the stretches of a stage done on a wing (as pitched.js reads them)
  _sp(v, wi, f) { return v === true ? [[f.lo - 1, f.hi + 1]] : (v || []).filter((q) => q[0] === wi).map((q) => q.slice(1)); }
  _on(v, wi, f, P, x, t) { return planeSpans(P, this._sp(v, wi, f), f).some(([x0, x1, t0, t1]) => x >= x0 - 1e-6 && x <= x1 + 1e-6 && t >= t0 - 1e-6 && t <= t1 + 1e-6); }
  // the stretch done: rounded to whole rafters / rolls, cut to what the stage before did →
  // [a0, a1] or [x0, x1, plane, t0?, t1?]
  _span(d) {
    const L = this.stage, r = this.rec, f = d.f, k = MM(STEP[L] || PITCHED.step), prev = r.done?.[PREV[L]];
    if (d.key) {
      const P = d.P, lo = Math.min(P.xa(0), P.xa(P.L)), hi = Math.max(P.xb(0), P.xb(P.L));
      let x0 = lo + Math.floor((d.x0 - lo) / k) * k, x1 = lo + Math.ceil((Math.max(d.x1, d.x0 + 1e-6) - lo) / k) * k;
      if (x0 - lo < k * 1.2) x0 = lo; if (hi - x1 < k * 1.2) x1 = hi;
      x0 = Math.max(lo, x0); x1 = Math.min(hi, x1);
      if (x1 - x0 < MM(50)) return null;
      const xm = (x0 + x1) / 2;
      if (L === 'memb') {
        // (the next roll up: the lowest row not yet rolled out here — from the eave, each over the last)
        const n = Math.max(1, Math.ceil((P.L - MM(MEMB.lap)) / MM(MEMB.pitch) - 1e-6));
        let j = 0; while (j < n && this._on(r.done?.memb, d.wi, f, P, xm, j * MM(MEMB.pitch) + MM(700))) j++;
        if (j >= n) return null;
        const t0 = j * MM(MEMB.pitch), t1 = Math.min(P.L, t0 + MM(MEMB.roll));
        if (prev !== true && !this._on(prev, d.wi, f, P, xm, (t0 + t1) / 2)) return null;
        return [+x0.toFixed(6), +x1.toFixed(6), P.key, +t0.toFixed(6), +t1.toFixed(6)];
      }
      // (the battens: up from the eave as far as the membrane goes under them; the jack rafters of a
      // hip end on its diagonals — the stage before there)
      if (L === 'battens' && prev !== true) {
        let tt = 0; const st = MM(100), inP = (t) => xm < P.xa(t) || xm > P.xb(t);
        while (tt < P.L && (this._on(prev, d.wi, f, P, xm, Math.min(P.L, tt + st / 2)) || inP(tt + st / 2))) tt += st;
        if (tt < MM(300)) return null;
        return tt >= P.L - MM(50) ? [+x0.toFixed(6), +x1.toFixed(6), P.key] : [+x0.toFixed(6), +x1.toFixed(6), P.key, 0, +tt.toFixed(6)];
      }
      if (prev !== true && ![0.15, 0.5, 0.85].every((q) => this._on(prev, d.wi, f, P, xm, P.L * q) || xm < P.xa(P.L * q) || xm > P.xb(P.L * q))) return null;
      return [+x0.toFixed(6), +x1.toFixed(6), P.key];
    }
    let a0 = f.lo + Math.floor((d.a0 - f.lo) / k) * k, a1 = f.lo + Math.ceil((Math.max(d.a1, d.a0 + 1e-6) - f.lo) / k) * k;
    if (a0 - f.lo < k * 1.2) a0 = f.lo; if (f.hi - a1 < k * 1.2) a1 = f.hi;   // (near the end: on to it)
    a0 = Math.max(f.lo, a0); a1 = Math.min(f.hi, a1);
    if (prev !== true && Array.isArray(prev)) {
      const ps = prev.filter((q) => q[0] === d.wi && q[3] == null);
      if (!ps.length) return null;
      a0 = Math.max(a0, Math.min(...ps.map((q) => q[1]))); a1 = Math.min(a1, Math.max(...ps.map((q) => q[2])));
    }
    return a1 - a0 > MM(50) ? [+a0.toFixed(6), +a1.toFixed(6)] : null;
  }
  _liveOf(d, sp, cut = null) { return sp.length > 2 ? { stage: this.stage, w: d.wi, a0: sp[0], a1: cut?.x1 ?? sp[1], key: sp[2], t0: sp[3] ?? 0, t1: cut?.t1 ?? sp[4] ?? Infinity } : { stage: this.stage, w: d.wi, a0: sp[0], a1: cut?.x1 ?? sp[1] }; }
  _show() {
    const d = this.drag, sp = d && this._span(d);
    this._live(sp ? this._liveOf(d, sp) : null);
    if (sp) this.app.ui.showMeasure(`${NAME[this.stage]}: ${((sp[1] - sp[0]) / S / 1000).toFixed(1).replace('.', ',')} м`);
  }
  _commit(sp = null) {
    const d = this.drag, r = this.rec; if (!d || !r) return false;
    sp = sp || this._span(d); if (!sp) return false;
    const cur = r.done?.[this.stage];
    if (cur === true) return false;
    // merged with what is done on that wing (on that plane, in that row)
    const list = [...(cur || []), [d.wi, ...sp]], merged = [], gk = (q) => `${q[0]}|${q.slice(3).join('|')}`;
    for (const g of [...new Set(list.map(gk))]) {
      const grp = list.filter((q) => gk(q) === g), tail = grp[0].slice(3), iv = grp.map((q) => [q[1], q[2]]).sort((p, q) => p[0] - q[0]), out = [];
      for (const v of iv) { const m = out.at(-1); if (m && v[0] <= m[2] + MM(10)) m[2] = Math.max(m[2], v[1]); else out.push([grp[0][0], v[0], v[1], ...tail]); }
      merged.push(...out);
    }
    this._save({ done: { ...r.done, [this.stage]: merged } }, 'proof-' + this.stage);
    return true;
  }
  up() {
    const app = this.app, d = this.drag, L = this.stage;
    if (!d) return;
    // laid as it is done (fitJob.js), then saved: the joists one by one, a roll unrolled, the battens up the slope
    const sp = this.rec?.done?.[L] !== true ? this._span(d) : null;
    this.drag = null; app.ui.hideMeasure();
    if (!sp) { this._live(null); app.ui.toast(L === 'memb' && d.key ? 'Мембрана: здесь все рулоны уже раскатаны — или ещё нет стропил' : `${NAME[L]}: ведите пальцем по крыше — там, где уже готов этап «${NAME[PREV[L]]}»`); return; }
    const done = () => {
      this.drag = d; const ok = this._commit(sp); this.drag = null; this._live(null);
      if (!ok) return;
      const r = this.rec, left = this.left(r, L);
      app.ui.toast({ joists: 'Лаги перекрытия 50×200 уложены с мауэрлата на мауэрлат', frame: 'Стропила стоят', memb: 'Рулон мембраны раскатан и прихвачен скобами — следующий выше внахлёст 150 мм', battens: 'Контробрешётка и обрешётка прибиты — снизу вверх' }[L] + (left > 0.02 ? ` — осталось ${Math.round(left * 100)} %` : ' — этап готов'));
    };
    if (L === 'frame') { done(); return; }
    this._fitSpan(d, sp, L, done);
  }
  // the stretch laid as it is done, piece by piece: the joists one by one along the wing, a roll
  // of membrane unrolled along the eave and stapled, the battens nailed from the eave up
  _fitSpan(d, sp, L, save) {
    const app = this.app, f = d.f, r = this.rec, steps = [], up = new THREE.Vector3(0, 1, 0);
    const onP = (P, x, t, o = MM(30)) => { const [a, dd] = P.at(x, t); return new THREE.Vector3(...f.W(a, dd, f.top(a, dd) + o)); };
    if (sp.length > 2) {
      const P = d.P, n = frameOf(f, P).n, [x0, x1] = sp, t0 = sp[3] ?? 0, t1 = sp[4] ?? P.L;
      if (L === 'memb') {
        // unrolled along the eave in steps of 600, stapled along its top edge
        const k = MM(600), m = Math.max(1, Math.ceil((x1 - x0) / k)), T = Math.min(1, 4 / (m * 0.25));
        for (let i = 1; i <= m; i++) {
          const xe = Math.min(x1, x0 + i * k), xm = xe - k / 2, tm = Math.min(t1 - MM(100), t0 + MM(1350)), x = Math.max(P.xa(tm) + MM(50), Math.min(P.xb(tm) - MM(50), xm));
          steps.push([0.12 * T, (u) => { if (u >= 1) this._live(this._liveOf(d, sp, { x1: xe })); }]);
          steps.push(hammer(app, onP(P, x, tm), n, 1, 0.12 * T));
        }
      } else {
        // up the slope a batten at a time (two to a step on the screen), nailed to the counter-battens
        const k = MM(L === 'battens' && r.cover?.kind === 'shingle' ? 1250 : 700), m = Math.max(1, Math.ceil((t1 - t0) / k)), T = Math.min(1, 4.5 / (m * 0.3)), xm = (x0 + x1) / 2;
        for (let i = 1; i <= m; i++) {
          const te = Math.min(t1, t0 + i * k), tm = te - k / 2, x = Math.max(P.xa(tm) + MM(80), Math.min(P.xb(tm) - MM(80), xm));
          steps.push([0.12 * T, (u) => { if (u >= 1) this._live(this._liveOf(d, sp, { t1: te })); }]);
          if (x > P.xa(tm) && x < P.xb(tm)) steps.push(hammer(app, onP(P, x, tm), n, 1, 0.14 * T));
        }
      }
    } else {
      // the joists one at a time, nailed to the wall plate at each end
      const k = MM(PITCHED.step), m = Math.max(1, Math.round((sp[1] - sp[0]) / k)), T = Math.min(1, 4.5 / (m * 0.3)), w = r.wings[d.wi], yP = r.y0 + MM(PITCHED.plate) + MM(120);
      for (let i = 1; i <= m; i++) {
        const ae = i === m ? sp[1] : sp[0] + i * k, am = ae - k / 2;
        steps.push([0.1 * T, (u) => { if (u >= 1) this._live(this._liveOf(d, sp, { x1: ae })); }]);
        for (const sg of [-1, 1]) steps.push(hammer(app, new THREE.Vector3(...f.W(am, sg * (w.B - r.T / 2), yP)), up, 1, 0.1 * T));
      }
    }
    new FitJob(app, { steps, parts: [], commit: save, cleanup: () => this._live(null) });
  }
  left(r, L) {
    const cur = r.done?.[L]; if (cur === true) return 0;
    if (L === 'cover' && r.sheets?.length) return Math.max(0, 1 - r.sheets.length / Math.max(1, coverSlots(r).length));
    const shapes = r.wings.map((w) => wingShape(r, w));
    if (L === 'joists') { let all = 0, got = 0; shapes.forEach((f, wi) => { all += f.hi - f.lo; for (const q of (cur || []).filter((q2) => q2[0] === wi)) got += q[2] - q[1]; }); return Math.max(0, 1 - got / all); }
    // (the planes sampled: what share of them the stage covers)
    let all = 0, got = 0;
    shapes.forEach((f, wi) => { for (const P of planes(r, r.wings[wi], f)) for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      const t = P.L * (b + 0.5) / 8, xa = P.xa(t), xb = P.xb(t); if (xb - xa < MM(50)) continue;
      const x = xa + (xb - xa) * (a + 0.5) / 8; all++; if (this._on(cur, wi, f, P, x, t)) got++;
    } });
    return all ? Math.max(0, 1 - got / all) : 0;
  }


  // ---- the wall plate and the trims: from the tray ----
  carryMove(p, e) {
    const app = this.app, L = this.stage;
    this.place = null; this.why = null;
    if (L === 'plate') {
      app.ui.hideMeasure();
      // the building at the finger (a house, a garage beside it: each its own roof)
      // (at the top of a lower part built on to a house — a garage — its own lean-to roof)
      const B = buildingAt(app, p), lean = findLean(app, p), key = app.objects.all('unit').length + ':' + app.objects.all('belt').length + ':' + (B?.[0]?.u.id ?? 0) + ':' + (lean ? Math.round(lean.y0 * 1e4) + ':' + Math.round(lean.wings[0].cx * 1e3) : '');
      if (this._hk !== key) { this._hk = key; this._house = lean || findHouse(app, p); }
      const H = this._house;
      if (!H) { this._live(null); this.why = 'Не нахожу дом: нужны стены не меньше 2 × 2 м, замкнутые по контуру (крыша встаёт на их верх)'; return { ok: false, why: this.why }; }
      // (a roof already on this building)
      const on = app.objects.all('proof').find((q) => q.wings.some((w) => H.wings.some((v) => Math.hypot(w.cx - v.cx, w.cz - v.cz) < Math.max(v.A, v.B))));
      if (on) { this.sel = on.id; this._live(null); this.why = 'На этом здании мауэрлат уже лежит — дальше «Лаги» и «Стропила» (снять — «Удалить»)'; return { ok: false, why: this.why }; }
      // the finger over the house (on its walls, over the inside of it — the point there is
      // the ground or the far wall — or near it): there is one roof, it goes on the house
      if (p) {
        const near = H.wings.some((w) => { const dx = p.x - w.cx, dz = p.z - w.cz, a = dx * w.ux + dz * w.uz, d = -dx * w.uz + dz * w.ux; return Math.abs(a) < w.A + MM(4000) && Math.abs(d) < w.B + MM(4000); });
        if (!near) { this._live(null); this.why = 'Поднесите мауэрлат к дому — к верху стен'; return { ok: false, why: this.why }; }
      }
      // across the walls: where the finger is on the top of a wall — on the line of the studs, or
      // moved out / in by as much as they still go through the plate (30 mm of wood beside each);
      // on anchors (no studs), from flush with the outer face to flush with the inner
      const studs = app.objects.all('belt').some((b) => b.studs?.length && Math.abs(b.top + b.H - H.y0) < MM(40));
      const lim = studs ? 75 - 30 - 6 : Math.max(0, Math.round(H.T / S / 2) - 75);
      if (p) {
        let best = null;
        for (const w of H.wings) {
          const dx = p.x - w.cx, dz = p.z - w.cz, a = dx * w.ux + dz * w.uz, d = -dx * w.uz + dz * w.ux;
          for (const out of [Math.abs(a) <= w.A ? Math.abs(d) - (w.B - H.T / 2) : null, Math.abs(d) <= w.B ? Math.abs(a) - (w.A - H.T / 2) : null]) if (out != null && Math.abs(out) < H.T / 2 + MM(100) && (best == null || Math.abs(out) < Math.abs(best))) best = out;
        }
        if (best != null) { let mm = Math.round(best / S / 5) * 5; if (Math.abs(mm) <= 8) mm = 0; this._po = Math.max(-lim, Math.min(lim, mm)); }
      }
      const po = Math.max(-lim, Math.min(lim, this._po || 0));
      app.ui.showMeasure(po === 0 ? (studs ? 'Мауэрлат по оси шпилек' : 'Мауэрлат по оси стены') : `Мауэрлат сдвинут ${po > 0 ? 'наружу' : 'внутрь'} на ${Math.abs(po)} мм${studs ? ` (шпильки в брусе, до ${lim} мм)` : po === lim ? ' — заподлицо с наружной гранью' : po === -lim ? ' — заподлицо с внутренней гранью' : ''}`);
      const o = this.opts(null), rec = { ...H, ...o, po, wings: this._ends(H.wings, o.style), done: { plate: true } };   // (a new roof: as chosen in the menu)
      this.place = { rec };
      this._live({ ghost: rec });
      return { ok: true };
    }
    this.pick(e, p);
    const r = this.rec;
    if (L === 'cover') return this._sheetMove(e);
    if (L === 'gutter') {
      if (!r?.done?.trim) { this._live(null); return { ok: false, why: 'Водосток — когда стоят лобовые доски (этап «Конёк и планки»)' }; }
      if (r.done.gutter) return { ok: false, why: 'Водосток уже висит' };
      this.place = { gutter: true }; this._live({ stage: 'gutter', all: true }); return { ok: true };
    }
    if (L === 'joists') {
      if (!r?.done?.plate) { this._live(null); this.why = 'Лаги — на мауэрлат: сначала этап 1'; return { ok: false, why: this.why }; }
      if (r.done.joists) { this.why = 'Лаги уже лежат — дальше «Коньковый прогон»'; return { ok: false, why: this.why }; }
      this.place = { joists: true }; this._live({ stage: 'joists', all: true }); return { ok: true };
    }
    if (L === 'ridge') {
      if (!r?.done?.joists && !r?.done?.ridge) { this._live(null); this.why = 'Сначала лаги перекрытия (этап 2): стойки конька встают на них'; return { ok: false, why: this.why }; }
      if (!r?.done?.plate) { this._live(null); this.why = 'Коньковый прогон — на мауэрлат: сначала этап 1'; return { ok: false, why: this.why }; }
      if (r.done.ridge || r.done.frame) { this.why = 'Коньковый прогон уже стоит — дальше «Стропила»'; return { ok: false, why: this.why }; }
      this.place = { ridge: true }; this._live({ stage: 'ridge', all: true }); return { ok: true };
    }
    if (!r || !r.done?.cover) { this._live(null); return { ok: false, why: 'Конёк и планки — когда уложено покрытие' }; }
    if (r.done.trim) return { ok: false, why: 'Конёк и планки уже стоят' };
    this.place = { trim: true };
    this._live({ stage: 'trim', all: true });
    return { ok: true };
  }
  carryDrop() {
    const app = this.app, P = this.place;
    if (P?.sheet) { this.place = null; this._sheetDrop(P.sheet); return; }
    this.place = null; this._live(null); this._po = 0;
    if (this.stage === 'plate') app.ui.hideMeasure();
    if (!P) { app.ui.toast(this.why || (this.stage === 'plate' ? 'Мауэрлат — на верх стен' : 'Конёк и планки — на крышу с покрытием')); this.why = null; return; }
    if (P.rec) {
      // (a new roof: on the building it was carried to — the others keep theirs)
      let id = null; app.journal.act('proof-plate', {}, app.clock, () => { id = app.objects.add({ type: 'proof', ...P.rec }); id = id?.id ?? id; });
      if (id != null) this.sel = id;
      const n = P.rec.wings.length, t = ROOF_TYPES[P.rec.style].toLowerCase();
      const studs = app.objects.all('belt').some((b) => b.studs?.length);
      app.ui.toast(`Мауэрлат 150×150 ${studs ? 'на шпильках армопояса, шайбы и гайки' : 'на анкерах'} по всему дому${P.rec.po ? `, сдвинут ${P.rec.po > 0 ? 'наружу' : 'внутрь'} на ${Math.abs(P.rec.po)} мм` : ''}${P.rec.style !== 'hip' ? ', фронтоны из блоков' : ''} — крыша ${t}${n > 1 ? `, ${n} крыла с ендовами` : ''}, ${P.rec.pitch}°. Дальше — лаги перекрытия, коньковый прогон, стропила`);
      return;
    }
    const r = this.rec;
    if (P.joists) { this._save({ done: { ...r.done, joists: true } }, 'proof-joists'); app.ui.toast('Лаги перекрытия 50×200 через 600 мм поперёк дома, с мауэрлата на мауэрлат — дальше «Коньковый прогон»: стойки встанут на лаги'); return; }
    if (P.ridge) { this._save({ done: { ...r.done, ridge: true } }, 'proof-ridge'); app.ui.toast(r.wings.every((w) => (w.style || r.style) === 'mono') ? 'У односкатной крыши конька нет — стропила ложатся на мауэрлат высокой стены: дальше «Стропила»' : 'Коньковый прогон 150×200 на стойках (через ≤ 3 м; у короткого конька — одна в середине), стойки на лежне 150×100 поверх лаг, с подкосами под 45°; концы прогона — на фронтонах. Дальше — стропила пальцем вдоль конька: верхом на прогон, низом на мауэрлат'); return; }
    if (P.gutter) { this._save({ done: { ...r.done, gutter: true }, gut: this.opts().gut }, 'proof-gutter'); app.ui.toast('Водосток: желоба на крюках под карнизами, трубы по углам до земли — в дождь из них течёт вода'); return; }
    this._save({ done: { ...r.done, trim: true } }, 'proof-trim');
    app.ui.toast('Конёк, рёбра, лобовая доска, ветровые планки и софиты — дальше водосток');
  }
  status(carry) {
    const L = this.stage, r = this.rec;
    if (carry && L === 'cover') return this.place ? `Отпустите — ${this.place.sheet.cut ? 'лист подрежется по месту и ' : ''}ляжет сюда` : this.why || 'Поднесите лист к скату крыши';
    if (carry) return this.place ? (L === 'plate' ? 'Ведите пальцем поперёк стены — сдвиг мауэрлата по шпилькам; отпустите' : 'Отпустите') : (L === 'plate' ? 'Поднесите мауэрлат к верху стен' : L === 'gutter' ? 'Поднесите водосток к крыше' : L === 'ridge' ? 'Поднесите прогон к дому' : L === 'joists' ? 'Поднесите лаги к дому' : 'Поднесите конёк к крыше');
    const left = r ? this.left(r, L) : 1;
    return {
      plate: r ? 'Мауэрлат лежит — дальше «Лаги перекрытия»' : 'Скатная крыша: выберите тип, уклон и покрытие, потом тяните мауэрлат из лотка на верх стен — крыша встанет по дому (Г-, Т-образный — крыльями с ендовами)',
      joists: `Лаги перекрытия: ведите пальцем над домом вдоль конька — брусья 50×200 через 600 мм поперёк, с мауэрлата на мауэрлат, по одной${r?.done?.joists && left < 1 ? (left > 0.02 ? `; осталось ${Math.round(left * 100)} %` : ' — все лежат, дальше «Коньковый прогон»') : ''}`,
      ridge: r?.done?.ridge ? 'Прогон стоит — дальше «Стропила»' : 'Коньковый прогон: тяните из лотка на дом — стойки на лаги через ≤ 3 м, прогон по коньку (концы на фронтонах)',
      frame: r && needHips(r) && !r.done?.hips ? 'Стропила: коснитесь крыши — сначала диагональные (от конька к углам, в ендовы), на них потом лягут нарожники' : `Стропила: ведите пальцем по крыше вдоль конька — пары встают через 600 мм${left < 1 ? `; осталось ${Math.round(left * 100)} %` : ''}`,
      memb: `Мембрана: ведите пальцем вдоль карниза по одному скату — рулон 1,5 м раскатывается по стропилам, следующий ряд выше внахлёст 150 мм${r?.done?.memb && left > 0.02 ? `; осталось ${Math.round(left * 100)} %` : ''}`,
      battens: `Обрешётка: ведите пальцем по одному скату — контррейки по стропилам и рейки поперёк, снизу вверх (под мягкую черепицу — OSB)${r?.done?.battens && left > 0.02 ? `; осталось ${Math.round(left * 100)} %` : ''}`,
      cover: `${COVERS[r?.cover?.kind || 'metal']}: тяните ${r?.cover?.kind === 'shingle' ? 'пачку' : r?.cover?.kind === 'seam' ? 'панель' : 'лист'} из лотка на скат — по одному, от карниза вверх; у вальм, конька и ендов подрезается сам${r?.sheets?.length ? `; уложено ${r.sheets.length} из ${coverSlots(r).length}` : ''}`,
      trim: 'Конёк и планки: тяните из лотка на крышу',
      gutter: 'Водосток: тяните из лотка на крышу — желоба по карнизам, трубы по углам',
    }[L];
  }
  // «Удалить» on the roof: the last stage's last stretch comes off
  remove(id) {
    const app = this.app, r = app.objects.get(id); if (!r) return;
    // (the covering laid by hand: the last piece off, while nothing over it is on)
    if (r.sheets?.length && !r.done?.trim && !r.done?.gutter) {
      const done = { ...r.done }; delete done.cover;
      app.journal.act('proof-remove', {}, app.clock, () => app.objects.update(id, { sheets: r.sheets.slice(0, -1), done }));
      app.ui.toast('Сняли последний лист покрытия'); return;
    }
    const order = STAGES.flatMap((q) => (q[0] === 'frame' ? [['hips', 'Диагональные стропила'], q] : [q]));
    for (const [k, nm] of order.reverse()) {
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
  get type() { return RWIN_TYPES[this.app.settings.rwinType] ? this.app.settings.rwinType : 'pivot'; }
  carryMove(p, e) {
    this.app.wallTool.proof.pick(e, p);   // (the roof under the finger: each building its own)
    const app = this.app, pw = app.wallTool.proof, r = pw.rec, [, W0, H0] = RWIN[this.key], [Wm, Hm] = rwinSpan(this.type, W0, H0), W = MM(Wm), H = MM(Hm), ty = this.type;
    this.place = null;
    // a slope of the pitched roof under the finger
    const h = r && pw._hit(e);
    if (h) {
      const w = r.wings[h.wi], f = h.f, a = h.a, d = h.d;
      const pa = planeAt(r, w, f, a, d);
      if (!pa) { this._live(null); return { ok: false, why: 'Окно — на скат' }; }
      const P = pa.P;
      // between the rafters (in the middle of a bay), the height where the finger is
      const RG = rafterGrid(w, P), x0 = RG.x0, step = RG.step;
      // (the twin: over a rafter, a sash in the bay on each side of it)
      let x = ty === 'twin' ? x0 + Math.max(1, Math.min(RG.n - 1, Math.round((pa.x - x0) / step))) * step : x0 + (Math.max(0, Math.min(RG.n - 1, Math.floor((pa.x - x0) / step))) + 0.5) * step;
      let t = Math.max(H / 2 + MM(300), Math.min(P.L - H / 2 - MM(300), pa.t));
      const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]];
      let why = null;
      if (ty === 'dome') why = 'Купол — только на плоскую кровлю';
      else if (!(r.done?.frame === true || (r.done?.frame || []).some((q) => q[0] === h.wi))) why = 'Окно в скат — когда стоят стропила';
      else if (corners.some(([dx, dt]) => x + dx < P.xa(t + dt) + MM(150) || x + dx > P.xb(t + dt) - MM(150))) why = 'Здесь окно не помещается — ближе к середине ската';
      else if (app.objects.all('rwin').some((q) => q.host === r.id && q.wi === h.wi && q.plane === P.key && Math.abs(q.x - x) < W && Math.abs(q.t - t) < H + MM(200))) why = 'Здесь уже окно';
      this.place = { host: r.id, wi: h.wi, plane: P.key, x: +x.toFixed(6), t: +t.toFixed(6), why };
      this._live({ wi: h.wi, plane: P.key, x, t, key: this.key, col: this.col, wtype: ty });
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
        this._live({ flat: true, x: hit.point.x, y: hit.point.y, z: hit.point.z, yaw, key: this.key, col: this.col, wtype: ty });
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
    app.journal.act('rwin', {}, app.clock, () => app.objects.add({ type: 'rwin', key: this.key, col: this.col, wtype: this.type, ...rec }));
    app.ui.toast(P.flat ? `${RWIN_TYPES[this.type][0]} ${RWIN[this.key][0]} на плоскую кровлю: стакан 150 мм, мембрана заведена на него, рама и стеклопакет` : `${RWIN_TYPES[this.type][0]} окно ${RWIN[this.key][0]}: между стропилами, сверху и снизу ригели, вокруг — оклад, кровля подрезана`);
  }
  status() { return this.place ? (this.place.why ? 'Красный — ' + this.place.why : 'Отпустите') : 'Окно в крышу: тяните из лотка на скат (встанет между стропилами) или на плоскую кровлю'; }
}
