import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf } from './freeBrick.js';
import { FitJob, drive, hammer } from './fitJob.js';
import { plan as beltPlan, toWorld as beltWorld, beltContains } from './belt.js';
import { RWIN_TYPES, rwinSpan } from '../world/roofWindows.js';
import { wingShape, roofTop, planeAt, rafterGrid, STAGES, FINGER, PITCHED, PITCHES, PITCH_RANGE, ROOF_TYPES, COVERS, COVER_COLOURS, RWIN, GUTTERS, GUTTER_COLOURS } from '../world/pitched.js';

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
  const corners = units.flatMap((b) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => { const x = b.x + b.ux * b.hl * sx - b.uz * b.hw * sz, z = b.z + b.uz * b.hl * sx + b.ux * b.hw * sz; return [toA(x, z), toD(x, z)]; }));
  const face = (v, lo, hi, isA, out) => {
    let best = null;
    for (const [pa, pd] of corners) {
      const q = isA ? pa : pd, r = isA ? pd : pa;
      if (Math.abs(q - v) > C * 1.2 || r < lo + C || r > hi - C) continue;
      if (best == null || (out > 0 ? q > best : q < best)) best = q;
    }
    return best ?? v;
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
  const T = [...units.map((b) => 2 * Math.min(b.hw, b.hl))].sort((p, q) => p - q)[Math.floor(units.length / 2)];
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

export class PitchedWork {
  constructor(app) { this.app = app; this.drag = null; this.place = null; }
  get stage() { return this.app.settings.proofStage || 'plate'; }
  get isCarry() { return !FINGER.has(this.stage); }
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
  _live(live) { const v = this.app.wallView; v.liveProof = live && !live.ghost ? { ...live, id: this.rec?.id ?? null } : live; v.proofDirty = true; }
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
    const framed = (wi) => r.done?.frame === true || (r.done?.frame || []).some((q) => q[0] === wi);
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
    if (!h) { app.ui.toast('Ведите пальцем по крыше вдоль конька'); return true; }
    this.drag = { wi: h.wi, a0: h.a, a1: h.a, f: h.f, dd: h.d };
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
    // the covering / the battens: laid out piece by piece (fitJob.js), then saved
    const sp = (L === 'cover' || L === 'battens') && this.rec?.done?.[L] !== true ? this._span(d) : null;
    if (sp) {
      this.drag = null; app.ui.hideMeasure();
      this._fitSpan(d, sp, L, () => {
        this.drag = d; const ok = this._commit(); this.drag = null; this._live(null);
        if (!ok) return;
        const r = this.rec, left = this.left(r, L);
        app.ui.toast({ battens: 'Контробрешётка и обрешётка прибиты', cover: `${COVERS[r.cover.kind]} уложена` }[L] + (left > 0.02 ? ` — осталось ${Math.round(left * 100)} %` : ' — весь скат готов'));
      });
      return;
    }
    const ok = this._commit();
    this.drag = null; this._live(null); app.ui.hideMeasure();
    if (!ok) { app.ui.toast(`${NAME[L]}: ведите пальцем по крыше вдоль конька — там, где уже готов этап «${NAME[PREV[L]]}»`); return; }
    const r = this.rec, left = this.left(r, L);
    app.ui.toast({ frame: 'Стропила стоят', memb: 'Мембрана раскатана внахлёст', battens: 'Контробрешётка и обрешётка прибиты', cover: `${COVERS[r.cover.kind]} уложена` }[L] + (left > 0.02 ? ` — осталось ${Math.round(left * 100)} %` : ' — весь скат готов'));
  }
  // the stretch laid as it is done: piece by piece along the slope (a sheet of the covering
  // screwed down, a run of battens nailed) — one by a short stroke in full, more quickly
  _fitSpan(d, sp, L, save) {
    const app = this.app, f = d.f, r = this.rec, k = MM(L === 'cover' ? PITCHED.sheet[r.cover?.kind || 'metal'] : STEP[L]);
    const n = Math.max(1, Math.round((sp[1] - sp[0]) / k)), one = n <= 2, T = one ? 1 : Math.min(1, 3.5 / (n * 0.3));
    const side = Math.sign(d.dd || 1), steps = [];
    const P = (a, dd) => { const [x, z] = f.W(a, dd); return new THREE.Vector3(x, f.top(a, dd) + MM(L === 'cover' ? 12 : 30), z); };
    const N = (a, dd) => { const e = MM(50), p0 = P(a, dd), pa = P(a + e, dd), pd = P(a, dd + e); return new THREE.Vector3().crossVectors(pd.sub(p0), pa.sub(p0)).normalize().multiplyScalar(side); };
    for (let i = 0; i < n; i++) {
      const a1 = i === n - 1 ? sp[1] : sp[0] + (i + 1) * k, am = sp[0] + (i + 0.5) * k;
      steps.push([(one ? 0.35 : 0.12) * T, (u) => { if (u >= 1) this._live({ stage: L, w: d.wi, a0: sp[0], a1 }); }]);
      const span = f.R || MM(4000), pts = one ? [0.25, 0.5, 0.75] : [0.5];
      for (const q of pts) {
        const dd = side * span * q, p = P(am, dd), nn = N(am, dd);
        if (nn.y < 0) nn.negate();
        steps.push(L === 'cover' ? drive(app, p, nn, null, (one ? 0.26 : 0.1) * T) : hammer(app, p, nn, one ? 2 : 1, (one ? 0.16 : 0.1) * T));
      }
    }
    new FitJob(app, { steps, parts: [], commit: save, cleanup: () => this._live(null) });
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
    const app = this.app, L = this.stage;
    this.place = null; this.why = null;
    if (L === 'plate') {
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
      const o = this.opts(null), rec = { ...H, ...o, wings: this._ends(H.wings, o.style), done: { plate: true } };   // (a new roof: as chosen in the menu)
      this.place = { rec };
      this._live({ ghost: rec });
      return { ok: true };
    }
    this.pick(e, p);
    const r = this.rec;
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
    this.place = null; this._live(null);
    if (!P) { app.ui.toast(this.why || (this.stage === 'plate' ? 'Мауэрлат — на верх стен' : 'Конёк и планки — на крышу с покрытием')); this.why = null; return; }
    if (P.rec) {
      // (a new roof: on the building it was carried to — the others keep theirs)
      let id = null; app.journal.act('proof-plate', {}, app.clock, () => { id = app.objects.add({ type: 'proof', ...P.rec }); id = id?.id ?? id; });
      if (id != null) this.sel = id;
      const n = P.rec.wings.length, t = ROOF_TYPES[P.rec.style].toLowerCase();
      const studs = app.objects.all('belt').some((b) => b.studs?.length);
      app.ui.toast(`Мауэрлат 150×150 ${studs ? 'на шпильках армопояса, шайбы и гайки' : 'на анкерах'} по всему дому${P.rec.style !== 'hip' ? ', фронтоны из блоков' : ''} — крыша ${t}${n > 1 ? `, ${n} крыла с ендовами` : ''}, ${P.rec.pitch}°. Дальше — лаги перекрытия, коньковый прогон, стропила`);
      return;
    }
    const r = this.rec;
    if (P.joists) { this._save({ done: { ...r.done, joists: true } }, 'proof-joists'); app.ui.toast('Лаги перекрытия 50×200 через 600 мм поперёк дома, с мауэрлата на мауэрлат — дальше «Коньковый прогон»: стойки встанут на лаги'); return; }
    if (P.ridge) { this._save({ done: { ...r.done, ridge: true } }, 'proof-ridge'); app.ui.toast(r.wings.every((w) => (w.style || r.style) === 'mono') ? 'У односкатной крыши конька нет — стропила ложатся на мауэрлат высокой стены: дальше «Стропила»' : 'Коньковый прогон 150×200 на стойках 100×100 (через ≤ 3 м, на лагах), концы — на фронтонах. Дальше — стропила пальцем вдоль конька: верхом на прогон, низом на мауэрлат'); return; }
    if (P.gutter) { this._save({ done: { ...r.done, gutter: true }, gut: this.opts().gut }, 'proof-gutter'); app.ui.toast('Водосток: желоба на крюках под карнизами, трубы по углам до земли — в дождь из них течёт вода'); return; }
    this._save({ done: { ...r.done, trim: true } }, 'proof-trim');
    app.ui.toast('Конёк, рёбра, лобовая доска, ветровые планки и софиты — дальше водосток');
  }
  status(carry) {
    const L = this.stage, r = this.rec;
    if (carry) return this.place ? 'Отпустите' : (L === 'plate' ? 'Поднесите мауэрлат к верху стен' : L === 'gutter' ? 'Поднесите водосток к крыше' : L === 'ridge' ? 'Поднесите прогон к дому' : L === 'joists' ? 'Поднесите лаги к дому' : 'Поднесите конёк к крыше');
    const left = r ? this.left(r, L) : 1;
    return {
      plate: r ? 'Мауэрлат лежит — дальше «Лаги перекрытия»' : 'Скатная крыша: выберите тип, уклон и покрытие, потом тяните мауэрлат из лотка на верх стен — крыша встанет по дому (Г-, Т-образный — крыльями с ендовами)',
      joists: r?.done?.joists ? 'Лаги лежат — дальше «Коньковый прогон»' : 'Лаги перекрытия: тяните из лотка на дом — брусья 50×200 через 600 мм поперёк, с мауэрлата на мауэрлат',
      ridge: r?.done?.ridge ? 'Прогон стоит — дальше «Стропила»' : 'Коньковый прогон: тяните из лотка на дом — стойки на лаги через ≤ 3 м, прогон по коньку (концы на фронтонах)',
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
