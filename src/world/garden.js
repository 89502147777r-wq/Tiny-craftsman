import { MODEL_SCALE } from '../config.js';

// Garden paths, laid the way a landscaper lays them:
//   set   – the line set out by the finger: pegs at the ends and the turns, a string each side;
//   dig   – the trough: the topsoil off, 300 deep (wider than the path: room for the kerbs);
//   kerb  – garden kerbs 1000 × 200 × 80 each side and across the ends, set on a bed of concrete
//           with a haunch behind them; the soil put back behind the haunch;
//   geo   – geotextile over the trough's floor (the stone does not sink into the soil);
//   grav  – crushed stone 20–40, 200, rammed with the plate compactor;
//   sand  – sand 40, screeded off with a rule on the kerbs;
//   pave  – the pavers 60, laid from the start row after row, cut at the turns and the edges;
//   joint – sand brushed into the joints, the plate over them on a rubber mat.
// A path record (the line in world metres of the model, the sizes in real mm):
//   path { pts: [[x, z]…] (its middle line), W (between the kerbs), g (the ground's level),
//          paver, col (laid with), done: { dig, kerb, geo, grav, sand, pave, joint } }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const PATH = { dig: 300, kerbW: 80, kerbH: 200, kerbL: 1000, room: 150, bed: 100, haunch: 100, grav: 200, sand: 40, paver: 60, joint: 3 };
export const PATH_LAYERS = [['set', 'Разметка'], ['dig', 'Корыто'], ['kerb', 'Бордюр'], ['geo', 'Геотекстиль'], ['grav', 'Щебень'], ['sand', 'Песок'], ['pave', 'Плитка'], ['joint', 'Швы']];
export const PATH_WIDTHS = [800, 1000, 1200, 1500, 2000];
// the pavers: the piece (mm, along the row × across it) and how they are laid
export const PAVERS = {
  brick: { name: 'Кирпичик 200 × 100', a: 100, c: 200, lay: 'bond', usd: 26 },
  herring: { name: 'Ёлочка 200 × 100', a: 100, c: 200, lay: 'herring', usd: 29 },
  square: { name: 'Квадрат 300 × 300', a: 300, c: 300, lay: 'grid', usd: 31 },
  slab: { name: 'Плита 600 × 300', a: 300, c: 600, lay: 'bond', usd: 34 },
};
// the colours (concrete pavers, through-dyed): the base and the spread from piece to piece; the mix: of three
export const PAVE_COLS = {
  grey: ['Серая', [0.56, 0.55, 0.53], 0.06],
  graphite: ['Графит', [0.3, 0.31, 0.33], 0.05],
  red: ['Красная', [0.6, 0.29, 0.23], 0.07],
  brown: ['Коричневая', [0.42, 0.29, 0.21], 0.07],
  sand: ['Песочная', [0.73, 0.65, 0.5], 0.06],
  mix: ['Осенний микс', null, 0.05],
};
const MIX = [[0.6, 0.29, 0.23], [0.42, 0.29, 0.21], [0.73, 0.62, 0.45]];
// the tops of the layers, mm from the ground's level
export const TOPS = { floor: -PATH.dig, geo: -PATH.dig + 2, grav: -PATH.paver - PATH.sand, sand: -PATH.paver, pave: 0 };

// ---- the line --------------------------------------------------------------------------------
// the finger's trail [[x, z]…] → the path's middle line: straightened (the trail's wobble within
// 150 mm), no leg under 400 mm, no turn under 6° (null: too short)
export function lineOf(trail) {
  if (trail.length < 2) return null;
  const tol = MM(150);
  const dp = (pts, a, b, out) => {
    let k = -1, best = tol;
    const [x0, z0] = pts[a], [x1, z1] = pts[b], L = Math.hypot(x1 - x0, z1 - z0) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - x0) * (z1 - z0) - (pts[i][1] - z0) * (x1 - x0)) / L; if (d > best) best = d, k = i; }
    if (k < 0) { out.push(pts[b]); return; }
    dp(pts, a, k, out); dp(pts, k, b, out);
  };
  let pts = [trail[0]]; dp(trail, 0, trail.length - 1, pts);
  // (short legs: their two ends become one)
  for (let changed = true; changed && pts.length > 2;) {
    changed = false;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (L >= MM(400)) continue;
      if (i === pts.length - 1) pts.splice(i - 1, 1); else if (i === 1) pts.splice(1, 1); else pts.splice(i - 1, 2, [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2]);
      changed = true; break;
    }
  }
  for (let i = 1; i < pts.length - 1;) { if (Math.abs(turnAt(pts, i)) < 6 * Math.PI / 180) pts.splice(i, 1); else i++; }
  const len = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  return len < MM(1000) ? null : pts.map(([x, z]) => [+x.toFixed(5), +z.toFixed(5)]);
}
// the turn at an inner point (radians, + to the left)
export function turnAt(pts, i) {
  const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
  let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
// what is wrong with a line (null: it can be laid)
export function lineWhy(pts, W) {
  for (let i = 1; i < pts.length - 1; i++) if (Math.abs(turnAt(pts, i)) > 95 * Math.PI / 180) return 'Поворот круче 90° — так плитку не уложить: разметьте две дорожки';
  // (a leg between two turns: long enough for the corners not to cross)
  for (let i = 1; i < pts.length - 2; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), need = (W / 2 + PATH.kerbW + PATH.room) * (Math.tan(Math.abs(turnAt(pts, i)) / 2) + Math.tan(Math.abs(turnAt(pts, i + 1)) / 2));
    if (L / S < need) return 'Повороты слишком близко друг к другу — ведите плавнее';
  }
  return null;
}

// the legs: { o (start), u (unit along), n (unit to the left), L, a0 (the chainage at o) }
const _legs = new WeakMap();
export function legsOf(r) {
  let G = _legs.get(r);
  if (G && G.pts === r.pts) return G.legs;
  const legs = [];
  let a0 = 0;
  for (let i = 1; i < r.pts.length; i++) {
    const [x0, z0] = r.pts[i - 1], [x1, z1] = r.pts[i], L = Math.hypot(x1 - x0, z1 - z0), u = [(x1 - x0) / L, (z1 - z0) / L];
    legs.push({ o: [x0, z0], u, n: [-u[1], u[0]], L, a0 });
    a0 += L;
  }
  G = { pts: r.pts, legs };
  _legs.set(r, G);
  return legs;
}
export const lengthOf = (r) => { const l = legsOf(r).at(-1); return l.a0 + l.L; };
// a point of leg k: along a (its own chainage), across c (to the left) → [x, z]
export const legW = (g, a, c) => [g.o[0] + g.u[0] * (a - g.a0) + g.n[0] * c, g.o[1] + g.u[1] * (a - g.a0) + g.n[1] * c];
export const legL = (g, x, z) => { const dx = x - g.o[0], dz = z - g.o[1]; return [g.a0 + dx * g.u[0] + dz * g.u[1], dx * g.n[0] + dz * g.n[1]]; };

// each leg's piece of a band from c0 to c1 across the line (model units; the ends pushed out by ext):
// a convex quad [x, z]×4 (the corners mitred) — the legs' quads meet edge to edge at the turns
export function bandQuads(r, c0, c1, ext = 0) {
  const L = legsOf(r), out = [];
  const off = (k, c) => {
    // the point at the start of leg k (k = L.length: the end of the last), c to the left
    const g0 = L[Math.max(0, k - 1)], g1 = L[Math.min(L.length - 1, k)];
    const p = k < L.length ? g1.o : [g0.o[0] + g0.u[0] * g0.L, g0.o[1] + g0.u[1] * g0.L];
    let nx = g0.n[0] + g1.n[0], nz = g0.n[1] + g1.n[1];
    const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    const k2 = c / (nx * g1.n[0] + nz * g1.n[1]);
    let x = p[0] + nx * k2, z = p[1] + nz * k2;
    if (k === 0) { x -= g1.u[0] * ext; z -= g1.u[1] * ext; }
    if (k === L.length) { x += g0.u[0] * ext; z += g0.u[1] * ext; }
    return [x, z];
  };
  for (let k = 0; k < L.length; k++) out.push([off(k, c0), off(k + 1, c0), off(k + 1, c1), off(k, c1)]);
  return out;
}
// inside a convex polygon (either winding)
export function inPoly(q, x, z) {
  let sgn = 0;
  for (let i = 0; i < q.length; i++) {
    const [ax, az] = q[i], [bx, bz] = q[(i + 1) % q.length], cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (Math.abs(cr) < 1e-14) continue;
    const s = cr > 0 ? 1 : -1;
    if (!sgn) sgn = s; else if (s !== sgn) return false;
  }
  return true;
}
// the bands of a path (model units): the paving between the kerbs, the trough dug (the kerbs, the room behind them)
export const half = (r) => MM(r.W / 2);
export const paveQuads = (r) => bandQuads(r, -half(r), half(r));
export const digQuads = (r) => { const e = MM(PATH.kerbW + PATH.room); return bandQuads(r, -half(r) - e, half(r) + e, e); };
export const kerbOuter = (r) => { const e = MM(PATH.kerbW); return bandQuads(r, -half(r) - e, half(r) + e, e); };
export const inQuads = (qs, x, z) => qs.some((q) => inPoly(q, x, z));
export function boxOf(qs) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of qs) for (const [x, z] of q) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}
// the chainage of a point (along the nearest leg)
export function chainOf(r, x, z) {
  let best = 0, bd = Infinity;
  for (const g of legsOf(r)) { const [a, c] = legL(g, x, z), aa = Math.max(g.a0, Math.min(g.a0 + g.L, a)), d = Math.hypot(aa - a, c); if (d < bd) bd = d, best = aa; }
  return best;
}

// ---- the pieces: a convex polygon clipped to a convex polygon --------------------------------
function clip(poly, q) {
  // (q's winding: its edges' inside to the left when counter-clockwise)
  let area = 0; for (let i = 0; i < q.length; i++) { const [ax, az] = q[i], [bx, bz] = q[(i + 1) % q.length]; area += ax * bz - bx * az; }
  const sg = area > 0 ? 1 : -1;
  let out = poly;
  for (let i = 0; i < q.length && out.length; i++) {
    const [ax, az] = q[i], [bx, bz] = q[(i + 1) % q.length], side = (p) => sg * ((bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax));
    const inp = out; out = [];
    for (let k = 0; k < inp.length; k++) {
      const P = inp[k], Q = inp[(k + 1) % inp.length], sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
  }
  return out;
}
export function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; a += ax * bz - bx * az; } return Math.abs(a) / 2; }
// a convex polygon moved in by d on every side
export function inset(p, d) {
  let area = 0; for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; area += ax * bz - bx * az; }
  const sg = area > 0 ? 1 : -1, n = p.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = p[i], [bx, bz] = p[(i + 1) % n], L = Math.hypot(bx - ax, bz - az) || 1e-12, nx = -sg * (bz - az) / L, nz = sg * (bx - ax) / L;
    lines.push([ax + nx * d, az + nz * d, (bx - ax) / L, (bz - az) / L]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const [px, pz, ux, uz] = lines[(i + n - 1) % n], [qx, qz, vx, vz] = lines[i], den = ux * vz - uz * vx;
    if (Math.abs(den) < 1e-9) { out.push([qx, qz]); continue; }
    const t = ((qx - px) * vz - (qz - pz) * vx) / den;
    out.push([px + ux * t, pz + uz * t]);
  }
  return out;
}

// the pavers of a path: [{ p: [[x, z]…] (the top's outline, world), cut, ord (the chainage), rgb }]
// in the order they are laid (from the start, row by row, each row from the left)
export function paversOf(r, key = r.paver || 'brick', col = r.col || 'grey') {
  const P = PAVERS[key] || PAVERS.brick, C = PAVE_COLS[col] || PAVE_COLS.grey, legs = legsOf(r), qs = paveQuads(r), h = half(r) / S, j = PATH.joint / 2;
  const out = [];
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  legs.forEach((g, k) => {
    const q = qs[k], ql = q.map(([x, z]) => legL(g, x, z).map((v) => v / S)), qi = inset(ql, j);
    const aLo = Math.min(...ql.map((v) => v[0])), aHi = Math.max(...ql.map((v) => v[0]));
    const rects = [];
    if (P.lay === 'herring') {
      // a herringbone at 45° to the path: pairs of a long and an upright piece, stepping on the diagonal
      const d = P.a, c45 = Math.SQRT1_2, R = (u, v) => [(u - v) * c45, (u + v) * c45];   // the pattern's frame → (a, c)
      const span = Math.max(aHi - aLo, 2 * h) + 4 * d, n = Math.ceil(span / d) + 2, a0 = Math.floor(aLo / (2 * d)) * 2 * d;
      for (let i = -n; i <= n; i++) for (let m = -n; m <= n; m++) {
        const bu = i + 2 * m, bv = i - 2 * m;
        for (const [u0, v0, w, hh] of [[bu * d, bv * d, 2 * d, d], [bu * d, bv * d + d, d, 2 * d]]) {
          const pts = [[u0, v0], [u0 + w, v0], [u0 + w, v0 + hh], [u0, v0 + hh]].map(([u, v]) => { const [a, c] = R(u, v); return [a + a0, c]; });
          const ca = pts.reduce((s, p) => s + p[0], 0) / 4, cc = pts.reduce((s, p) => s + p[1], 0) / 4;
          if (ca < aLo - 3 * d || ca > aHi + 3 * d || Math.abs(cc) > h + 3 * d) continue;
          rects.push(pts);
        }
      }
    } else {
      const A = P.a, Cw = P.c, r0 = Math.floor(aLo / A) - 1, r1 = Math.ceil(aHi / A) + 1;
      for (let row = r0; row <= r1; row++) {
        const sh = P.lay === 'bond' && row % 2 ? Cw / 2 : 0;
        for (let c = -h - sh; c < h; c += Cw) rects.push([[row * A, c], [row * A + A, c], [row * A + A, c + Cw], [row * A, c + Cw]]);
      }
    }
    for (const R of rects) {
      const Ri = inset(R, j), full = polyArea(Ri), p = clip(Ri, qi);
      if (p.length < 3) continue;
      const ar = polyArea(p);
      if (ar < full * 0.04) continue;
      const ca = p.reduce((s, v) => s + v[0], 0) / p.length, cc = p.reduce((s, v) => s + v[1], 0) / p.length;
      const base = C[1] || MIX[Math.floor(rnd() * 3)], v = (rnd() - 0.5) * 2 * C[2];
      out.push({ p: p.map(([a, c]) => legW(g, a * S, c * S)), cut: ar < full * 0.97, ord: ca + (cc + h) / (2 * h + 1) * 0.5 * P.a, rgb: base.map((x) => Math.max(0, Math.min(1, x * (1 + v)))) });
    }
  });
  out.sort((a, b) => a.ord - b.ord);
  return out;
}
// the kerbs: [{ p: [[x, z]…] (the footprint), s (the chainage, mm), ord }] — each side leg by leg (cut
// at the turns), across the ends; laid from the start: the start's end, then both sides together
// along the path, the far end last
export function kerbsOf(r) {
  const legs = legsOf(r), h = half(r) / S, kw = PATH.kerbW, j = PATH.joint / 2, out = [];
  const total = lengthOf(r) / S;
  for (const side of [1, -1]) {
    const qs = side > 0 ? bandQuads(r, half(r), half(r) + MM(kw)) : bandQuads(r, -half(r) - MM(kw), -half(r));
    legs.forEach((g, k) => {
      const ql = qs[k].map(([x, z]) => legL(g, x, z).map((v) => v / S)), lo = Math.min(...ql.map((v) => v[0])), hi = Math.max(...ql.map((v) => v[0]));
      const c0 = side > 0 ? h : -h - kw, c1 = c0 + kw;
      for (let a = lo; a < hi - 1; a += PATH.kerbL) {
        const p = clip(inset([[a, c0], [a + PATH.kerbL, c0], [a + PATH.kerbL, c1], [a, c1]], j), ql);
        const sa = Math.min(hi, a + PATH.kerbL / 2);
        if (p.length >= 3 && polyArea(p) > 40 * kw) out.push({ p: p.map(([aa, c]) => legW(g, aa * S, c * S)), s: sa, ord: sa + (side > 0 ? 0 : 1) });
      }
    });
  }
  // across the ends: from the outside of one kerb to the outside of the other
  const wAll = 2 * (h + kw), n = Math.ceil(wAll / PATH.kerbL), ends = [[legs[0], -kw, 0, -kw / 2 - 1000], [legs.at(-1), total, total + kw, total + kw / 2 + 1000]];
  for (const [g, a0, a1, s] of ends) {
    for (let i = 0; i < n; i++) {
      const c0 = -h - kw + wAll * i / n, c1 = -h - kw + wAll * (i + 1) / n;
      out.push({ p: inset([[a0, c0], [a1, c0], [a1, c1], [a0, c1]], j).map(([a, c]) => legW(g, a * S, c * S)), s: (a0 + a1) / 2, ord: s + i });
    }
  }
  out.sort((a, b) => a.ord - b.ord);
  return out;
}
// the colour of a paver's surface (a swatch for the chips)
export const paveRGB = (col) => (PAVE_COLS[col]?.[1] || MIX[0]);
