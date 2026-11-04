import * as THREE from 'three';
import { MODEL_SCALE, M_BLACK } from '../config.js';
import { kerbOuter, inQuads, boxOf } from './garden.js';
import { pitBox } from './pool.js';

// The lawn, made the way a landscaper makes it:
//   area  – its outline drawn by the finger (closed by itself); what lies inside it and is not a
//           path, a pool, a house or concrete is the lawn;
//   soil  – topsoil 100 tipped and spread over it;
//   rake  – raked level, the stones and the clods out;
//   roll  – rolled with a garden roller (the soil settles; footprints would not stay);
//   grass – turf in rolls 2000 × 400, row after row, the joints staggered; or seed sown (it comes
//           up in three weeks);
//   water – watered with a sprinkler (the turf roots, the seams close, the grass greens).
// A lawn record: lawn { poly: [[x, z]…] (world), g (the ground's level), how: 'turf' | 'seed',
//                       u: [ux, uz] (the rows run along it), done: { soil, rake, roll, grass, water } }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const LAWN = { cell: 100, roll: [2000, 400], soil: 100 };
export const LAWN_HOW = { turf: 'Рулонный газон', seed: 'Посев семян' };

// a closed outline from the finger's trail (straightened within 200 mm); null: too small
export function polyOf(trail) {
  if (trail.length < 3) return null;
  const tol = MM(200), out = [trail[0]];
  const dp = (a, b) => {
    let k = -1, best = tol;
    const [x0, z0] = trail[a], [x1, z1] = trail[b], L = Math.hypot(x1 - x0, z1 - z0) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((trail[i][0] - x0) * (z1 - z0) - (trail[i][1] - z0) * (x1 - x0)) / L; if (d > best) best = d, k = i; }
    if (k < 0) { out.push(trail[b]); return; }
    dp(a, k); dp(k, b);
  };
  dp(0, trail.length - 1);
  // (the last point near the first: one)
  if (out.length > 3 && Math.hypot(out.at(-1)[0] - out[0][0], out.at(-1)[1] - out[0][1]) < MM(600)) out.pop();
  if (out.length < 3 || areaOf(out) < MM(1000) * MM(1500)) return null;
  return out.map(([x, z]) => [+x.toFixed(5), +z.toFixed(5)]);
}
export function areaOf(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; a += ax * bz - bx * az; } return Math.abs(a) / 2; }
export function inside(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; }
  return c;
}
// the direction the rows run: along the outline's longest side
export function mainDir(p) {
  let best = [1, 0], bl = 0;
  for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length], L = Math.hypot(bx - ax, bz - az); if (L > bl) bl = L, best = [(bx - ax) / L, (bz - az) / L]; }
  return best.map((v) => +v.toFixed(5));
}

// the cells of the lawn (100 mm, in its rows' frame: a along u, b across): [{ a, b, x, z, roll, ru }]
// — those inside the outline and free (no path, no pool, no concrete, the ground at its level);
// each cell's roll of turf (the rows across b, staggered half a roll) and where it is along it
// the polygon (in the lawn's frame) cut by the rectangle a0…a1 × b0…b1 (Sutherland–Hodgman, the rectangle the window)
function clipRect(P, a0, a1, b0, b1) {
  let out = P;
  for (const [k, v, keep] of [[0, a0, 1], [0, a1, -1], [1, b0, 1], [1, b1, -1]]) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const p = src[i], q = src[(i + 1) % src.length], ip = (p[k] - v) * keep >= 0, iq = (q[k] - v) * keep >= 0;
      if (ip) out.push(p);
      if (ip !== iq) { const f = (v - p[k]) / (q[k] - p[k]); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
    }
    if (!out.length) return out;
  }
  return out;
}
const areaAB = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; };
function centroidAB(P) { let a = 0, x = 0, y = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], c = p[0] * q[1] - q[0] * p[1]; a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c; } return Math.abs(a) < 1e-14 ? P[0] : [x / (3 * a), y / (3 * a)]; }
export function cellsOf(app, r) {
  const t = app.terrain, u = r.u || [1, 0], n = [-u[1], u[0]], C = MM(LAWN.cell), [RL, RW] = LAWN.roll.map(MM);
  const P = r.poly.map(([x, z]) => [x * u[0] + z * u[1], x * n[0] + z * n[1]]);
  const a0 = Math.min(...P.map((q) => q[0])), a1 = Math.max(...P.map((q) => q[0])), b0 = Math.min(...P.map((q) => q[1])), b1 = Math.max(...P.map((q) => q[1]));
  const paths = app.objects.all('path').map((p) => kerbOuter(p)), pools = app.objects.all('pool').map((q) => pitBox(q));
  const out = [];
  for (let b = b0; b < b1; b += C) for (let a = a0; a < a1; a += C) {
    // (the cell cut to the outline: a cell on a slanted side keeps only its part inside — no steps of
    // whole squares along it; where the middle of that part is is what is looked at)
    const piece = clipRect(P, a, a + C, b, b + C), ar = areaAB(piece);
    if (ar < C * C * 0.02) continue;
    const full = ar > C * C * 0.999, [pa, pb] = full ? [a + C / 2, b + C / 2] : centroidAB(piece);
    const ca = a + C / 2, cb = b + C / 2, x = pa * u[0] + pb * n[0], z = pa * u[1] + pb * n[1];
    if (!t.inside(x, z)) continue;
    const i = t.index(x, z);
    if (t.conc[i] > 1e-6 || (Math.abs(t.hAt(i) - r.g) > MM(400) && !(t.topMat(i) === M_BLACK && t.hAt(i) - r.g < MM(1500)))) continue;   // (topsoil on it, a heap left — of black topsoil tipped by hand too: still the lawn)
    if (paths.some((q) => inQuads(q, x, z))) continue;
    if (pools.some(([px0, pz0, px1, pz1]) => x > px0 && x < px1 && z > pz0 && z < pz1)) continue;
    const row = Math.floor((cb - b0) / RW), sh = row % 2 ? RL / 2 : 0, k = Math.floor((ca - a0 + sh) / RL);
    out.push({ a: ca, b: cb, x, z, row, k, ru: ((ca - a0 + sh) / RL) - k, rv: ((cb - b0) / RW) - row, clip: full ? null : piece });
  }
  // the rolls' order: row by row, each row from the start
  const rolls = new Map();
  for (const c of out) { const key = c.row * 10000 + c.k + 5000; if (!rolls.has(key)) rolls.set(key, rolls.size); }
  const keys = [...rolls.keys()].sort((p, q) => p - q), ord = new Map(keys.map((k, i) => [k, i]));
  for (const c of out) c.roll = ord.get(c.row * 10000 + c.k + 5000);
  out.nRolls = keys.length;
  out.a0 = a0; out.a1 = a1; out.b0 = b0; out.b1 = b1;
  return out;
}
export { boxOf };
// (the frame's point → world)
export const frameW = (r, a, b) => { const u = r.u || [1, 0], n = [-u[1], u[0]]; return [a * u[0] + b * n[0], a * u[1] + b * n[1]]; };
export const _ = THREE;
