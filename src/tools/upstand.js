import { MODEL_SCALE } from '../config.js';
import { plan, rle } from './belt.js';
import { boxOf } from './freeBrick.js';

// A concrete upstand on a roof terrace's edge (the «sail»): a low wall cast on the slab's free edges — round its outline and its
// holes, not where a wall stands on the slab — on the starter bars left in the slab. It is a ring beam on the slab: the same record
// (type 'belt', kind 'upstand'), on the slab's own grid (o, u, c, ni, nj — its cells are the slab's), so the boards, the cage, the
// hose, the stripping are the ring beam's. On site: 200 wide, as high as the terrace's build-up and 100–150 over it — the
// membrane is turned up its inner face and under the coping, the glass railing's shoe on its top.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const UPSTAND = { H: 450, w: 200 };

// → { rec, n, why } (rec null when there is no free edge)
// skip: [[x0, z0, x1, z1]…] (world) — the footprint of walls still to be built on the slab (a film knows its box before it is laid:
// the upstand is cast first, the walls go on the slab beside it — never through it); cast: false — the mask only, for the slab's
// starter bars before its concrete
export function findUpstand(app, slab, { H = UPSTAND.H, w = UPSTAND.w, skip = [], cast = true, spoutNear = null } = {}) {
  const b = slab, P = plan(b), { ni, nj, c } = b, top = b.top + b.H;
  if (cast && !(b.fill > 0.9)) return { rec: null, why: 'Сначала залейте перекрытие' };
  const k = Math.max(1, Math.round(MM(w) / c));
  // the distance (in cells, 8 ways) of each slab cell from the nearest cell that is not the slab: the edge band is ≤ k
  const dist = new Int32Array(ni * nj).fill(1e9), q = [];
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const id = j * ni + i;
    if (!P.mask[id]) { dist[id] = 0; q.push(id); continue; }
    if (i === 0 || j === 0 || i === ni - 1 || j === nj - 1) { dist[id] = 1; q.push(id); }
  }
  for (let h = 0; h < q.length; h++) {
    const id = q[h], i = id % ni, j = (id / ni) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, e = j + dj; if (a < 0 || e < 0 || a >= ni || e >= nj) continue;
      const n2 = e * ni + a; if (dist[n2] > dist[id] + 1) { dist[n2] = dist[id] + 1; q.push(n2); }
    }
  }
  // what stands on the slab (the walls of the box on it): no upstand under it, and none within a cell of it
  const on = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf).filter((x) => x.bot > top - MM(5) && x.bot < top + MM(80));
  const under = (i, j) => {
    const [x, z] = [b.o[0] + b.u[0] * (i + 0.5) * c - b.u[1] * (j + 0.5) * c, b.o[1] + b.u[1] * (i + 0.5) * c + b.u[0] * (j + 0.5) * c];
    // (the upstand runs up to the wall's face — flush: the membrane goes on from it up the wall's foot)
    return on.some((u) => { const dx = x - u.x, dz = z - u.z; return Math.abs(dx * u.ux + dz * u.uz) < u.hl + c * 0.2 && Math.abs(-dx * u.uz + dz * u.ux) < u.hw + c * 0.2; })
      || skip.some(([x0, z0, x1, z1]) => x > Math.min(x0, x1) && x < Math.max(x0, x1) && z > Math.min(z0, z1) && z < Math.max(z0, z1));
  };
  const m = new Uint8Array(ni * nj); let n = 0;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) { const id = j * ni + i; if (P.mask[id] && dist[id] <= k && !under(i, j)) { m[id] = 1; n++; } }
  if (!n) return { rec: null, why: 'Нет свободного края' };
  // the walls of it for the cage: the straight runs of the band, along s (rows) and along t (columns), each as wide as the band
  const segs = [], L = Math.max(4, 2 * k + 1);
  for (const par of [1, 0]) {
    const A = par ? ni : nj, B = par ? nj : ni, at = par ? (a, e) => m[e * ni + a] : (a, e) => m[a * ni + e];
    const open = new Map();   // key "a0:a1" → [e0, e1] of the rows with that run
    const flush = (key) => { const [a0, a1] = key.split(':').map(Number), [e0, e1] = open.get(key); open.delete(key); segs.push([a0 * c, a1 * c, (e0 + e1 + 1) / 2 * c, (e1 - e0 + 1) / 2 * c, par]); };
    for (let e = 0; e <= B; e++) {
      const runs = new Set();
      if (e < B) { let st = -1; for (let a = 0; a <= A; a++) { const v = a < A && at(a, e); if (v && st < 0) st = a; if (!v && st >= 0) { if (a - st >= L) runs.add(st + ':' + a); st = -1; } } }
      for (const key of [...open.keys()]) if (!runs.has(key)) flush(key);
      for (const key of runs) { if (open.has(key)) open.get(key)[1] = e; else open.set(key, [e, e]); }
    }
  }
  // the starter bars out of the slab (left in its cage before the concrete — U-bars Ø12 every 250, two legs 60 each side of the
  // upstand's middle, up 400 over the slab): [x0, y0, z0, x1, y1, z1, d]
  const starters = [], d = MM(12);
  for (const [a0, a1, l, , par] of segs) {
    const n = Math.max(1, Math.floor((a1 - a0 - MM(100)) / MM(250)));
    for (let q = 0; q <= n; q++) {
      const a = a0 + MM(50) + (a1 - a0 - MM(100)) * q / n;
      for (const o of [-MM(60), MM(60)]) {
        const [s2, t2] = par ? [a, l + o] : [l + o, a], x = b.o[0] + b.u[0] * s2 - b.u[1] * t2, z = b.o[1] + b.u[1] * s2 + b.u[0] * t2;
        starters.push([+x.toFixed(5), +(b.top + MM(40)).toFixed(5), +z.toFixed(5), +x.toFixed(5), +(top + MM(400)).toFixed(5), +z.toFixed(5), +d.toFixed(6)]);
      }
    }
  }
  // the overflow (аварийный перелив): a PVC spout Ø100 through the upstand 30 over the membrane, at its lowest corner — over the pool
  let spout = null;
  { let best = null; for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) { if (!m[j * ni + i]) continue; const sc = (i + 0.5) * c, tc = (j + 0.5) * c, x = b.o[0] + b.u[0] * sc - b.u[1] * tc, z = b.o[1] + b.u[1] * sc + b.u[0] * tc, key = spoutNear ? Math.hypot(x - spoutNear[0], z - spoutNear[1]) : sc + tc; if (!best || key < best.key) best = { key, sc, tc }; }
    if (best) spout = [+(b.o[0] + b.u[0] * best.sc - b.u[1] * best.tc).toFixed(5), +(b.o[1] + b.u[1] * best.sc + b.u[0] * best.tc).toFixed(5)]; }
  const rec = {
    type: 'belt', kind: 'upstand', starters, ...(spout ? { spout } : {}), slab: b.id, o: b.o.slice(), u: b.u.slice(), c: b.c, ni, nj, mask: rle(m), top: +top.toFixed(6), H: +MM(H).toFixed(6),
    lv: new Array(n).fill(0), sm: new Array(n).fill(0.3), fill: 0, ...(b.clip ? { clip: b.clip.slice() } : {}),
    segs: segs.map((s) => s.map((v, i) => (i < 4 ? +v.toFixed(6) : v))),
  };
  return { rec, n, why: null };
}
// the upstand on a slab's cell (a cast one): its height over the slab (model units) or 0
export function upstandAt(belts, slab, i, j) {
  for (const q of belts) if (q.kind === 'upstand' && q.slab === slab.id && q.fill > 0.9 && plan(q).mask[j * q.ni + i]) return q.H;
  return 0;
}
