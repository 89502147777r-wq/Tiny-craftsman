import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf, unitBoxes } from './freeBrick.js';

// The ring beam (армопояс) cast in a timber formwork on the top course of the walls, as on
// site: boards on edge along both faces of the top course (100 mm down over the masonry,
// 250 mm above it) with studs every 600 mm; a cage of 4 bars Ø12 in stirrups Ø6 along
// every wall, the bars run through the corners; concrete from the bucket or the hose runs
// along the whole ring (round the corners too); the vibrator, the rule on the boards, the
// trowel; once it has set the boards come off.
//
// The ring's plan is a grid of 50 mm cells in the frame of the walls (the top course of a
// house is square to itself): the cells over the top course, joined into one piece.
//   belt { o:[x,z], u:[ux,uz], c, ni, nj, mask (run lengths, from "outside"), top, H,
//          lv[] (mm of concrete per inside cell), sm[], fill, castT, pourT, set, stripped,
//          segs: [[s0,t0,s1,t1,w]…] (the walls, for the cage) }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const BELT = { cell: 50, H: 250, over: 100, board: 25, cover: 40, span: 6000 };   // (span: the widest a cast beam bridges between pillars / walls)
const YIELD = 1.2, K = 30;   // (it runs along the beam quicker than in a narrow channel)

// ---- the plan ------------------------------------------------------------------------------
export function rle(mask) {
  const out = [];
  let v = 0, n = 0;
  for (const m of mask) { if (m === v) n++; else { out.push(n); v = m; n = 1; } }
  out.push(n);
  return out;
}
export function unrle(runs, size) {
  const m = new Uint8Array(size);
  let k = 0, v = 0;
  for (const n of runs) { if (v) m.fill(1, k, k + n); k += n; v ^= 1; }
  return m;
}

// the cells of a belt record, its inside cells (row-major) and their neighbours
const _cache = new Map();
export function plan(b) {
  const key = b.id + ':' + b.mask.length + ':' + b.ni + 'x' + b.nj;
  const c = _cache.get(key);
  if (c && c.rec === b.mask) return c;
  const mask = unrle(b.mask, b.ni * b.nj), cells = [], index = new Int32Array(b.ni * b.nj).fill(-1);
  for (let j = 0; j < b.nj; j++) for (let i = 0; i < b.ni; i++) if (mask[j * b.ni + i]) { index[j * b.ni + i] = cells.length; cells.push([i, j]); }
  const nb = cells.map(([i, j]) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].map(([a, d]) => (a >= 0 && d >= 0 && a < b.ni && d < b.nj ? index[d * b.ni + a] : -1)));
  const out = { rec: b.mask, mask, cells, index, nb };
  _cache.set(key, out);
  return out;
}
// frame ⇄ plot
export const toWorld = (b, s, t) => [b.o[0] + b.u[0] * s - b.u[1] * t, b.o[1] + b.u[1] * s + b.u[0] * t];
// a slab's true outline (its clip: the outer faces of the walls under it, in its frame):
// the grid lines within 0,8 cell of it are moved onto it (the cells are 100 mm, the walls
// are not on that grid — the concrete, the boards, the bars end at the faces)
export function snapS(b, s, t) {
  if (!b.clip) return [s, t];
  const [s0, t0, s1, t1] = b.clip, m = b.c * 0.8;
  return [Math.abs(s - s0) < m ? s0 : Math.abs(s - s1) < m ? s1 : s, Math.abs(t - t0) < m ? t0 : Math.abs(t - t1) < m ? t1 : t];
}
export const toFrame = (b, x, z) => { const dx = x - b.o[0], dz = z - b.o[1]; return [dx * b.u[0] + dz * b.u[1], -dx * b.u[1] + dz * b.u[0]]; };
export function cellAt(b, x, z) {
  const [s, t] = toFrame(b, x, z), i = Math.floor(s / b.c), j = Math.floor(t / b.c);
  return i >= 0 && j >= 0 && i < b.ni && j < b.nj ? j * b.ni + i : -1;
}
export function beltContains(b, x, z) { const k = cellAt(b, x, z); return k >= 0 && plan(b).index[k] >= 0; }
// two plans share ground (a few of the cells of one in the other)
export function beltsOverlap(a, b) {
  const P = plan(b), step = Math.max(1, Math.floor(P.cells.length / 200));
  for (let k = 0; k < P.cells.length; k += step) { const [i, j] = P.cells[k], [x, z] = toWorld(b, (i + 0.5) * b.c, (j + 0.5) * b.c); if (beltContains(a, x, z)) return true; }
  return false;
}

// The ring on the top course under the finger: { rec (a belt without id), n cells } or null
export function findBelt(app, p, screen, finger) {
  const boxes = unitBoxes(app).filter((b) => b.u.kind !== 'prop');
  // the top under the finger
  let pick = null, bd = Infinity;
  for (const b of boxes) {
    let d;
    if (finger) { const sp = screen(new THREE.Vector3(b.x, b.top, b.z)); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 140) continue; }
    else { const dx = p.x - b.x, dz = p.z - b.z; if (Math.abs(dx * b.ux + dz * b.uz) > b.hl + 0.01 || Math.abs(-dx * b.uz + dz * b.ux) > b.hw + 0.01) continue; d = Math.abs(p.y - b.top); }
    d -= b.top * 1e-3;   // (the top one)
    if (d < bd) bd = d, pick = b;
  }
  if (!pick) return null;
  // nothing on it
  if (boxes.some((o) => o.bot > pick.top - MM(5) && o.bot < pick.top + MM(30) && Math.hypot(o.x - pick.x, o.z - pick.z) < o.hl + pick.hl)) return null;
  const T = pick.top, ux = pick.ux, uz = pick.uz;
  // (the lintels cast in place over the openings, flush with the top course: the ring beam runs on over them)
  const cast = app.objects.all('belt').filter((b) => b.lform && b.fill > 0.3).map((b) => {
    const L = b.ni * b.c, W = b.nj * b.c, [x, z] = toWorld(b, L / 2, W / 2), yaw = Math.atan2(-b.u[1], b.u[0]);
    return { x, z, ux: b.u[0], uz: b.u[1], hl: L / 2, hw: W / 2, bot: b.top, top: b.top + b.H, yaw };
  });
  const tops = [...boxes, ...cast].filter((b) => Math.abs(b.top - T) < MM(15) && Math.abs(Math.sin(2 * (b.yaw - pick.yaw))) < 0.05);
  // the frame: the walls' directions; its origin at the lowest corner of them all
  const fr = (b) => { const s = b.x * ux + b.z * uz, t = -b.x * uz + b.z * ux, par = Math.abs(Math.cos(b.yaw - pick.yaw)) > 0.7; return { s, t, hs: par ? b.hl : b.hw, ht: par ? b.hw : b.hl }; };
  const F = tops.map(fr);
  const c = MM(BELT.cell), pad = c;
  const s0 = Math.min(...F.map((f) => f.s - f.hs)) - pad, t0 = Math.min(...F.map((f) => f.t - f.ht)) - pad;
  const s1 = Math.max(...F.map((f) => f.s + f.hs)) + pad, t1 = Math.max(...F.map((f) => f.t + f.ht)) + pad;
  const ni = Math.ceil((s1 - s0) / c), nj = Math.ceil((t1 - t0) / c);
  if (ni * nj > 400000) return null;
  const m = new Uint8Array(ni * nj), e = MM(4);   // (the joints between the units are bridged)
  for (const f of F) {
    const i0 = Math.ceil((f.s - f.hs - e - s0) / c - 0.5), i1 = Math.floor((f.s + f.hs + e - s0) / c - 0.5);
    const j0 = Math.ceil((f.t - f.ht - e - t0) / c - 0.5), j1 = Math.floor((f.t + f.ht + e - t0) / c - 0.5);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m[j * ni + i] = 1;
  }
  // a small hole closed all round (the core of a brick pier left for a column, ≤ 600 mm): the
  // beam goes over the whole pier — a pier is one support, not a ring of two strips beside it
  {
    const lab = new Uint8Array(ni * nj), small = Math.round(MM(600) / c);
    for (let k0 = 0; k0 < ni * nj; k0++) {
      if (m[k0] || lab[k0]) continue;
      const st = [k0], comp = []; lab[k0] = 1; let edge = false, i0 = ni, i1 = -1, j0 = nj, j1 = -1;
      while (st.length) {
        const k = st.pop(), i = k % ni, j = (k / ni) | 0; comp.push(k);
        i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
        if (i === 0 || j === 0 || i === ni - 1 || j === nj - 1) edge = true;
        for (const q of [i > 0 ? k - 1 : -1, i < ni - 1 ? k + 1 : -1, j > 0 ? k - ni : -1, j < nj - 1 ? k + ni : -1]) if (q >= 0 && !m[q] && !lab[q]) { lab[q] = 1; st.push(q); }
      }
      if (!edge && i1 - i0 < small && j1 - j0 < small) for (const k of comp) m[k] = 1;
    }
  }
  // an opening left up to the top course (a door, a window under the ring beam) is bridged:
  // along a row / a column, a gap ≤ 3,2 m between two runs of the walls longer than a
  // wall is thick (across the house the runs are only the walls' thickness: not bridged)
  // and a gap between a pillar and a wall, or between two pillars (a terrace under the roof): the beam
  // over it is a ригель — up to 6 m, as on site; wider, a pillar more is needed in between
  const bridged = new Uint8Array(ni * nj); let long = 0;
  {
    const longRun = Math.ceil(MM(300) / c), maxGap = Math.round(MM(BELT.span) / c), add = [];
    const scan = (n, m, at) => {
      // (a run is an end of a span only when it is a wall along the line — longer along it than
      // across — or a pillar, about square: not a wall the line crosses)
      const end = (a, p0, p1) => { const mid = (p0 + p1) >> 1; let w = 1; for (let d = a + 1; d < m && m_(at(d, mid)); d++) w++; for (let d = a - 1; d >= 0 && m_(at(d, mid)); d--) w++; return p1 - p0 >= longRun && p1 - p0 >= 0.75 * w; };
      for (let a = 0; a < m; a++) {
        const runs = []; let st = -1;
        for (let b = 0; b <= n; b++) { const on = b < n && m_(at(a, b)); if (on && st < 0) st = b; if (!on && st >= 0) { runs.push([st, b]); st = -1; } }
        for (let k = 1; k < runs.length; k++) {
          const [p0, p1] = runs[k - 1], [q0, q1] = runs[k];
          if (!end(a, p0, p1) || !end(a, q0, q1)) continue;
          if (q0 - p1 <= maxGap) for (let b = p1; b < q0; b++) add.push(at(a, b));
          else if (q0 - p1 <= Math.round(MM(16000) / c)) long = Math.max(long, (q0 - p1) * BELT.cell);
        }
      }
    };
    const m_ = (k) => m[k];
    scan(ni, nj, (j, i) => j * ni + i);
    scan(nj, ni, (i, j) => j * ni + i);
    for (const k of add) { m[k] = 1; bridged[k] = 1; }
    // a beam is as wide as what it bears on (the narrower of its two ends, ≤ 600 mm): not two
    // strips over a pier of two rows of bricks with a hollow between, not a strip over a part of it
    const seen = new Uint8Array(ni * nj), wide = Math.round(MM(600) / c), fill = [];
    for (let k0 = 0; k0 < ni * nj; k0++) {
      if (!bridged[k0] || seen[k0]) continue;
      let i0 = ni, i1 = -1, j0 = nj, j1 = -1; const st = [k0]; seen[k0] = 1;
      while (st.length) { const k = st.pop(), i = k % ni, j = (k / ni) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); for (const q of [i > 0 ? k - 1 : -1, i < ni - 1 ? k + 1 : -1, j > 0 ? k - ni : -1, j < nj - 1 ? k + ni : -1]) if (q >= 0 && bridged[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
      const alongJ = j1 - j0 >= i1 - i0, n2 = alongJ ? ni : nj, at = alongJ ? (a, e) => e * ni + a : (a, e) => a * ni + e;
      const [a0, a1, e0, e1] = alongJ ? [i0, i1, j0 - 1, j1 + 1] : [j0, j1, i0 - 1, i1 + 1];
      if (e0 < 0 || e1 >= (alongJ ? nj : ni)) continue;
      // across each end: the masonry under the beam's end, out to its sides
      // (over a hollow ≤ 150 mm in it: the core of a pier)
      const ext = (e) => {
        let lo = a0, hi = a1;
        for (let d; ; lo = d) { d = lo - 1; while (d > 0 && d >= lo - 4 && !m[at(d, e)]) d--; if (d < 0 || d < lo - 4 || !m[at(d, e)]) break; }
        for (let d; ; hi = d) { d = hi + 1; while (d < n2 - 1 && d <= hi + 4 && !m[at(d, e)]) d++; if (d >= n2 || d > hi + 4 || !m[at(d, e)]) break; }
        return [lo, hi];
      };
      const [l0, h0] = ext(e0), [l1, h1] = ext(e1), lo = Math.max(l0, l1), hi = Math.min(h0, h1);
      if (hi - lo + 1 > wide || (lo === a0 && hi === a1)) continue;
      for (let a = lo; a <= hi; a++) for (let e = e0 + 1; e < e1; e++) { const k = at(a, e); if (!m[k]) fill.push(k); }
    }
    for (const k of fill) { m[k] = 1; bridged[k] = 1; }
  }
  // the piece under the finger
  const pf = fr(pick), si = Math.floor((pf.s - s0) / c), sj = Math.floor((pf.t - t0) / c);
  if (!m[sj * ni + si]) return null;
  const keep = new Uint8Array(ni * nj), st = [sj * ni + si];
  keep[st[0]] = 1;
  while (st.length) {
    const k = st.pop(), i = k % ni, j = (k / ni) | 0;
    for (const [a, d] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || d < 0 || a >= ni || d >= nj) continue; const q = d * ni + a; if (m[q] && !keep[q]) { keep[q] = 1; st.push(q); } }
  }
  let n = 0; for (const v of keep) n += v;
  // the walls (for the cage): units in line merged into runs, in the frame
  const segs = [];
  for (const par of [true, false]) {
    const groups = new Map();
    tops.forEach((b, k) => {
      const f = F[k], along = Math.abs(Math.cos(b.yaw - pick.yaw)) > 0.7 === par;
      if (!along) return;
      const ci = Math.floor(((par ? f.s : f.s) - s0) / c), cj = Math.floor(((par ? f.t : f.t) - t0) / c);
      if (!keep[cj * ni + ci]) return;
      const key = `${Math.round((par ? f.t : f.s) / MM(20))}:${Math.round((par ? f.ht : f.hs) / MM(10))}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(f);
    });
    for (const g of groups.values()) {
      const iv = g.map((f) => (par ? [f.s - f.hs, f.s + f.hs, f.t, f.ht] : [f.t - f.ht, f.t + f.ht, f.s, f.hs])).sort((a, b) => a[0] - b[0]);
      let cur = null;
      for (const v of iv) {
        if (cur && v[0] <= cur[1] + MM(3200)) cur[1] = Math.max(cur[1], v[1]);   // (on over an opening it bridges)
        else { if (cur) segs.push(cur); cur = [...v, par]; }
      }
      if (cur) segs.push(cur);
    }
  }
  // the spans (what the beam bridges, nothing of the course under it): each a rectangle of cells; the
  // beam over it as deep as the span asks (≈ 1/12 of it, 250 … 600 mm: below the ring beam's bottom
  // by the rest), on a deck of plywood on beams and props down to what is under it (the slab, a sill)
  const spans = [];
  {
    const seen = new Uint8Array(ni * nj), t = app.terrain;
    for (let k0 = 0; k0 < ni * nj; k0++) {
      if (!bridged[k0] || !keep[k0] || seen[k0]) continue;
      let i0 = ni, i1 = -1, j0 = nj, j1 = -1; const st2 = [k0]; seen[k0] = 1;
      while (st2.length) { const k = st2.pop(), i = k % ni, j = (k / ni) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); for (const q of [i > 0 ? k - 1 : -1, i < ni - 1 ? k + 1 : -1, j > 0 ? k - ni : -1, j < nj - 1 ? k + ni : -1]) if (q >= 0 && bridged[q] && keep[q] && !seen[q]) { seen[q] = 1; st2.push(q); } }
      const L = Math.max(i1 - i0 + 1, j1 - j0 + 1) * BELT.cell, h = Math.min(600, Math.max(BELT.H, Math.ceil(L / 12 / 50) * 50)), drop = h - BELT.H;
      const sm = s0 + (i0 + i1 + 1) / 2 * c, tm = t0 + (j0 + j1 + 1) / 2 * c, x = sm * ux - tm * uz, z = sm * uz + tm * ux;
      let floor = t.inside(x, z) ? t.heightAt(x, z) : T - MM(2500);
      for (const b of boxes) if (b.top < T - MM(drop + 50) && Math.abs((x - b.x) * b.ux + (z - b.z) * b.uz) < b.hl && Math.abs(-(x - b.x) * b.uz + (z - b.z) * b.ux) < b.hw) floor = Math.max(floor, b.top);
      spans.push([i0, j0, i1 + 1, j1 + 1, drop, +floor.toFixed(6), Math.round(L)]);
    }
  }
  const rec = {
    type: 'belt', o: [+(ux * s0 - uz * t0).toFixed(6), +(uz * s0 + ux * t0).toFixed(6)], u: [+ux.toFixed(6), +uz.toFixed(6)], c: +c.toFixed(7), ni, nj,
    mask: rle(keep), top: +T.toFixed(6), H: +MM(BELT.H).toFixed(6), lv: new Array(n).fill(0), sm: new Array(n).fill(0.3), fill: 0,
    // (the walls in the frame relative to the origin: from, to along; the line across; half width; along s?)
    segs: segs.map(([a, b, l, h, par]) => [+(a - (par ? s0 : t0)).toFixed(6), +(b - (par ? s0 : t0)).toFixed(6), +(l - (par ? t0 : s0)).toFixed(6), +h.toFixed(6), par ? 1 : 0]),
    ...(spans.length ? { spans } : {}),
  };
  // (the spans' cages: the bars of the beam, along its span, as deep as it is)
  for (const [i0, j0, i1, j1, drop, , L] of spans) {
    const par = i1 - i0 >= j1 - j0, a0 = (par ? i0 : j0) * c, a1 = (par ? i1 : j1) * c, l = ((par ? j0 + j1 : i0 + i1) / 2) * c, h = ((par ? j1 - j0 : i1 - i0) / 2) * c;
    rec.segs.push([+(a0 - MM(250)).toFixed(6), +(a1 + MM(250)).toFixed(6), +l.toFixed(6), +h.toFixed(6), par ? 1 : 0, +MM(drop).toFixed(6), L > 3000 ? 14 : 12]);
  }
  return { rec, n, lenM: segs.reduce((a, v) => a + (v[1] - v[0]), 0) / S / 1000, long, spans: spans.length };
}

// the boards: the edges of the plan, merged into straight runs — [s0,t0,s1,t1, ns,nt]
export function boardsOf(b) {
  return boardsOf0(b).map(([s0, t0, s1, t1, ns, nt]) => [...snapS(b, s0, t0), ...snapS(b, s1, t1), ns, nt]);
}
function boardsOf0(b) {
  const P = plan(b), out = [], { ni, nj, c } = b, inside = (i, j) => i >= 0 && j >= 0 && i < ni && j < nj && P.mask[j * ni + i];
  // edges along s (between rows), then along t (between columns)
  for (let j = 0; j <= nj; j++) for (const sg of [-1, 1]) {
    let start = -1;
    for (let i = 0; i <= ni; i++) {
      const e = i < ni && (sg < 0 ? inside(i, j) && !inside(i, j - 1) : inside(i, j - 1) && !inside(i, j));
      if (e && start < 0) start = i;
      if (!e && start >= 0) { out.push([start * c, j * c, i * c, j * c, 0, sg]); start = -1; }
    }
  }
  for (let i = 0; i <= ni; i++) for (const sg of [-1, 1]) {
    let start = -1;
    for (let j = 0; j <= nj; j++) {
      const e = j < nj && (sg < 0 ? inside(i, j) && !inside(i - 1, j) : inside(i - 1, j) && !inside(i, j));
      if (e && start < 0) start = j;
      if (!e && start >= 0) { out.push([i * c, start * c, i * c, j * c, sg, 0]); start = -1; }
    }
  }
  return out;
}

// the cage: 4 bars Ø12 along every wall, on through the corners (to the far face, less the
// cover), stirrups Ø6 every ≤ 350 mm, wire at their corners, wheel spacers
export function beltCage(b) {
  const P = plan(b), bars = [], ties = [], stars = [], d = MM(12), ds = MM(6), cov = MM(BELT.cover), H = b.H, y0 = b.top;
  const W = (s, t, y) => { const [x, z] = toWorld(b, s, t); return [+x.toFixed(5), +y.toFixed(5), +z.toFixed(5)]; };
  const inside = (s, t) => { const i = Math.floor(s / b.c), j = Math.floor(t / b.c); return i >= 0 && j >= 0 && i < b.ni && j < b.nj && P.mask[j * b.ni + i]; };
  for (const [a0, a1, l, h, par, drop = 0, dia = 12] of b.segs) {
    const pt = (al, ac) => (par ? [al, l + ac] : [l + ac, al]), y0 = b.top - drop, H = b.H + drop, d = MM(dia);   // (a beam over a span: deeper, its bars thicker)
    // the ends: on through a corner as far as the ring goes (≤ 600 mm), less the cover
    const ext = (a, sg) => { let e = 0; while (e < MM(600) && inside(...pt(a + sg * (e + b.c * 0.5), 0))) e += b.c * 0.5; return Math.max(0, e - cov); };
    const e0 = ext(a0, -1), e1 = ext(a1, 1);
    const bx = h - cov - ds - d / 2, yb = y0 + cov + ds + d / 2, yt = y0 + H - cov - ds - d / 2, lift = par ? 0 : d;   // (the crossing bars ride on the others)
    for (const y of [yb, yt]) for (const o of [-bx, bx]) bars.push([...W(...pt(a0 - e0, o), y + lift), ...W(...pt(a1 + e1, o), y + lift), +d.toFixed(6)]);
    const sx = h - cov - ds / 2, sb = y0 + cov + ds / 2, st = y0 + H - cov - ds / 2;
    const n = Math.max(1, Math.ceil((a1 - a0 - MM(100)) / MM(350)));
    for (let k = 0; k <= n; k++) {
      const a = a0 + MM(50) + (a1 - a0 - MM(100)) * k / n;
      const q = [W(...pt(a, -sx), sb + lift), W(...pt(a, sx), sb + lift), W(...pt(a, sx), st + lift), W(...pt(a, -sx), st + lift)];
      for (let i = 0; i < 4; i++) bars.push([...q[i], ...q[(i + 1) % 4], +ds.toFixed(6)]);
      for (const [o, y] of [[-bx, yb], [bx, yb], [bx, yt], [-bx, yt]]) ties.push([...W(...pt(a + MM(8), o), y + lift), +(d * 0.9).toFixed(6), 0.785]);
      if (k % 2 === 0) {
        const yaw = Math.atan2(-(par ? b.u[1] : b.u[0]), par ? b.u[0] : -b.u[1]);
        for (const [o, y] of [[-bx, yb], [bx, yb]]) stars.push([...W(...pt(a + MM(70), o), y + lift), +yaw.toFixed(4), +MM(38).toFixed(6)]);
      }
    }
  }
  return { type: 'cage', outlineId: null, beltId: b.id, bars, chairs: [], frogs: [], ties, tied: true, stars, d };
}

// ---- the concrete in it (the same interface as Channel in uPour.js) ------------------------
export class BeltChannel {
  constructor(app, b) {
    this.app = app; this.b = b; this.P = plan(b);
    this.h = b.lv.slice(); this.sm = (b.sm || []).slice();
    while (this.sm.length < this.h.length) this.sm.push(0.3);
    this.cap = b.H / S;   // mm
    // (a pool's bottom slab: a heap under the hose in the middle of it does not fall over the
    // boards — it runs out; only at the boards does what is over them go over)
    this.inner = b.kind === 'pool';
    if (this.inner) this.edge = this.P.nb.map((n) => n.some((q) => q < 0));
    this.spilt = 0;
  }
  has(t) { return !!t && t.id === this.b.id; }
  get full() { return this.h.every((v) => v >= this.cap - 3); }
  at(x, z) {
    const b = this.b, [s, t] = toFrame(b, x, z), i0 = Math.floor(s / b.c), j0 = Math.floor(t / b.c);
    let best = 0, bd = Infinity;
    for (let r = 0; r <= 6 && bd === Infinity; r++) for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= b.ni || j >= b.nj) continue;
      const k = this.P.index[j * b.ni + i];
      if (k < 0) continue;
      const d = Math.hypot(i + 0.5 - s / b.c, j + 0.5 - t / b.c);
      if (d < bd) bd = d, best = k;
    }
    return best;
  }
  point(k) {
    const b = this.b, [i, j] = this.P.cells[k], [x, z] = toWorld(b, (i + 0.5) * b.c, (j + 0.5) * b.c);
    return new THREE.Vector3(x, b.top + MM(this.h[k]), z);
  }
  topY() { return this.b.top + this.b.H; }
  pour(k, l) {
    const cm = this.b.c / S / 1000, per = 1e-3 / (cm * cm) * 1000;   // mm per litre on one cell (400 on 50 mm, 100 on a slab's 100 mm)
    // (it lands across the whole width of the beam at once: a splat ~550 mm round; on a slab ~600)
    const ks = [...this._near(k, Math.max(2, Math.round(MM(250) / this.b.c)))], w = 1 / ks.length;
    for (const q of ks) this.h[q] += l * w * per;
  }
  _flow(d, yieldMm, kk, only) {
    const h = this.h, nb = this.P.nb;
    let moved = 0;
    for (let k = 0; k < h.length; k++) {
      if (only && !only.has(k)) continue;
      for (const q of [nb[k][0], nb[k][2]]) {   // (each pair once: +s, +t)
        if (q < 0 || (only && !only.has(q))) continue;
        const dh = h[k] - h[q], e = Math.abs(dh) - yieldMm;
        if (e <= 0) continue;
        const f = Math.sign(dh) * e * kk * d * 0.4;
        h[k] -= f; h[q] += f; moved += Math.abs(f);
      }
    }
    return moved;
  }
  step(dt) {
    let moved = 0;
    const subs = Math.max(1, Math.ceil(dt * K / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) {
      moved += this._flow(d, YIELD, K);
      for (let k = 0; k < this.h.length; k++) if (this.h[k] > this.cap + 40 && (!this.inner || this.edge[k])) { const o = (this.h[k] - this.cap - 40) * Math.min(1, 8 * d); this.h[k] -= o; this.spilt += o; }   // (a heap up to 40 mm over the boards stands; more falls over)
    }
    return moved;
  }
  settle() { for (let k = 0; k < 400 && this.step(0.05) > 0.05; k++); }
  _near(k, r) {
    const [i0, j0] = this.P.cells[k], set = new Set(), b = this.b;
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= b.ni || j >= b.nj || Math.hypot(i - i0, j - j0) > r) continue;
      const q = this.P.index[j * b.ni + i]; if (q >= 0) set.add(q);
    }
    return set;
  }
  vibrate(k, r, dt) {
    const near = this._near(k, r), subs = Math.max(1, Math.ceil(dt * K * 2 / 0.2)), d = dt / subs;
    for (let s = 0; s < subs; s++) this._flow(d, 0, K * 2, near);
    const [i0, j0] = this.P.cells[k];
    for (const q of near) { const [i, j] = this.P.cells[q]; this.sm[q] = Math.max(this.sm[q], Math.min(0.5, this.sm[q] + dt * 1.2 * (1 - Math.hypot(i - i0, j - j0) / (r + 1)))); }   // (the vibrator settles it, it does not smooth it: ≤ 0.5, as the foundation)
  }
  dir(a, b) {
    const pa = this.point(a), pb = this.point(b), dx = pb.x - pa.x, dz = pb.z - pa.z, l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }
  // the rule on the boards, drawn from cell a to cell b: across the ring it takes everything
  // above the boards and pushes it on ahead
  rule(a, bk) {
    const pa = this.point(a), pb = this.point(bk), L = Math.hypot(pb.x - pa.x, pb.z - pa.z), [dx, dz] = this.dir(a, bk);
    const n = Math.max(1, Math.ceil(L / (this.b.c * 0.7)));
    for (let m = 0; m <= n; m++) {
      const x = pa.x + (pb.x - pa.x) * m / n, z = pa.z + (pb.z - pa.z) * m / n;
      for (let k = 0; k < this.h.length; k++) {
        const p = this.point(k), ex = p.x - x, ez = p.z - z, al = ex * dx + ez * dz, ac = -ex * dz + ez * dx;
        if (Math.abs(al) > this.b.c * 0.6 || Math.abs(ac) > MM(1000)) continue;
        this.sm[k] = Math.max(this.sm[k], 0.55);
        const over = this.h[k] - this.cap;
        if (over <= 0) continue;
        this.h[k] = this.cap;
        const q = this.at(p.x + dx * this.b.c, p.z + dz * this.b.c);
        if (q !== k) this.h[q] += over; else this.spilt += over;
      }
    }
  }
  // the float from a to b: closes and smooths a strip 450 mm long along it
  float(a, bk) {
    const pa = this.point(a), pb = this.point(bk), near = new Set();
    for (const k of [a, bk]) for (const q of this._near(k, 4)) near.add(q);
    const L = Math.hypot(pb.x - pa.x, pb.z - pa.z), n = Math.ceil(L / this.b.c);
    for (let m = 1; m < n; m++) for (const q of this._near(this.at(pa.x + (pb.x - pa.x) * m / n, pa.z + (pb.z - pa.z) * m / n), 4)) near.add(q);
    this._flow(0.05, 0, 4, near);
    for (const q of near) this.sm[q] = Math.min(1, this.sm[q] + 0.35);
  }
  show(v) { v.beltLive = v.beltLive || new Map(); v.beltLive.set(this.b.id, { lv: this.h, sm: this.sm }); v.fillDirty = true; }
  write(app) {
    const b = app.objects.get(this.b.id);
    if (!b) return;
    const lv = this.h.map((v) => Math.round(Math.max(0, Math.min(this.cap, v)) * 2) / 2), sm = this.sm.map((v) => Math.round(v * 100) / 100);
    const fill = +(lv.reduce((a, v) => a + v, 0) / lv.length / this.cap).toFixed(4);
    // wetT: when fresh concrete was last added (it stays workable from then on)
    const more = fill > (b.fill || 0) + 1e-4;
    app.objects.update(b.id, { lv, sm, fill, ...(more ? { wetT: +app.clock.toFixed(2) } : {}), ...(b.castT == null && fill > 0 ? { castT: +app.clock.toFixed(2) } : {}), ...(fill >= 0.95 && b.pourT == null ? { pourT: +app.clock.toFixed(2) } : {}) });
    if (app.wallView.beltLive) app.wallView.beltLive.delete(b.id);
  }
}

// the anchor studs for the wall plate (шпильки М12): on the middle line of every wall of the
// ring, 300 mm in from its ends and every ≤ 1 m between — [s, t] in the frame
export function beltStuds(b) {
  const out = [], e = MM(300);
  for (const [a0, a1, l, , par] of b.segs || []) {
    if (a1 - a0 < MM(700)) continue;
    const n = Math.max(1, Math.ceil((a1 - a0 - 2 * e) / MM(1000)));
    for (let k = 0; k <= n; k++) { const a = a0 + e + (a1 - a0 - 2 * e) * k / n; out.push((par ? [a, l] : [l, a]).map((v) => +v.toFixed(6))); }
  }
  return out;
}
