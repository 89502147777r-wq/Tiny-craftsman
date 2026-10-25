import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { plan, toWorld } from '../tools/belt.js';
import { isSlab } from '../tools/slab.js';
import { boxOf } from '../tools/freeBrick.js';

// Glass railings on the edges of a cast floor slab — round a balcony, a cantilever, the stair's
// opening, the gallery over the double height — as they are put up: an aluminium base shoe
// (a U channel 60 × 110) anchored to the slab 50 mm in from its edge, the laminated glass (two
// tempered 10 mm panes and the film: 21.52) wedged in it, panels up to 1.5 m with 10 mm gaps,
// 1100 over the floor (the code's minimum for a fall over 0.6 m), a stainless U cap along the top.
// A rail: { type: 'rail', slab, a: [x, z], b: [x, z], y (the slab's top), out: [x, z] (the edge's
// outward normal) } — it runs along one straight edge of the slab where nothing stands on it.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const RAIL = { H: 1100, shoe: [60, 110], back: 50, glass: 21.5, pane: 1500, gap: 10 };

// the straight runs of a slab's edges (its outline and its holes), world: { a, b, out, y }
export function slabRuns(b) {
  const P = plan(b), { ni, nj, c } = b, has = (i, j) => i >= 0 && j >= 0 && i < ni && j < nj && P.index[j * ni + i] >= 0;
  const top = b.top + Math.max(...b.lv, 0) * S, cl = b.clip;
  const cs = (v) => (cl ? Math.max(cl[0], Math.min(cl[2], v)) : v), ct = (v) => (cl ? Math.max(cl[1], Math.min(cl[3], v)) : v);
  const runs = [];
  // along i (the edges across j), then along j: each line of cells, the edge runs merged
  for (const dir of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const alongI = dir[0] === 0, N = alongI ? nj : ni, M = alongI ? ni : nj;
    for (let L = 0; L < N; L++) {
      let start = -1;
      for (let k = 0; k <= M; k++) {
        const i = alongI ? k : L, j = alongI ? L : k;
        const on = k < M && has(i, j) && !has(i + dir[0], j + dir[1]);
        if (on && start < 0) start = k;
        if (!on && start >= 0) {
          // the edge line: the cell's side toward dir; from start to k
          let s0, t0, s1, t1;
          if (alongI) { const t = (L + (dir[1] > 0 ? 1 : 0)) * c; s0 = start * c; s1 = k * c; t0 = t1 = t; }
          else { const s = (L + (dir[0] > 0 ? 1 : 0)) * c; t0 = start * c; t1 = k * c; s0 = s1 = s; }
          [s0, s1] = [cs(s0), cs(s1)]; [t0, t1] = [ct(t0), ct(t1)];
          const A = toWorld(b, s0, t0), B = toWorld(b, s1, t1), o0 = toWorld(b, 0, 0), od = toWorld(b, dir[0], dir[1]);
          const ox = od[0] - o0[0], oz = od[1] - o0[1], ol = Math.hypot(ox, oz) || 1;
          if (Math.hypot(B[0] - A[0], B[1] - A[1]) > MM(300)) runs.push({ a: A, b: B, out: [ox / ol, oz / ol], y: top });
          start = -1;
        }
      }
    }
  }
  return runs;
}

// the railing for the edge nearest p (world): the free stretch of it there (not under a wall,
// not where a railing is already) → { rec, why } or null
export function findRail(app, p) {
  const slabs = app.objects.all('belt').filter((b) => isSlab(b) && b.fill > 0.9);
  let best = null;
  for (const b of slabs) for (const r of slabRuns(b)) {
    if (Math.abs(p.y - r.y) > MM(1800)) continue;
    const ux = r.b[0] - r.a[0], uz = r.b[1] - r.a[1], L = Math.hypot(ux, uz), u = [ux / L, uz / L];
    const s = (p.x - r.a[0]) * u[0] + (p.z - r.a[1]) * u[1], d = Math.abs((p.x - r.a[0]) * r.out[0] + (p.z - r.a[1]) * r.out[1]);
    if (s < -MM(200) || s > L + MM(200) || d > MM(900)) continue;
    if (!best || d < best.d) best = { b, r, u, L, s: Math.max(0, Math.min(L, s)), d };
  }
  if (!best) return null;
  const { b, r, u, L, s } = best;
  // what stands on the edge: the masonry on the slab (its first course) near the edge line
  const blocked = [];
  for (const q of app.objects.all('unit').filter((x) => x.p && x.s && x.q).map(boxOf)) {
    if (Math.abs(q.bot - r.y) > MM(80)) continue;
    const ex = Math.abs(q.hl * q.ux) + Math.abs(q.hw * q.uz), ez = Math.abs(q.hl * q.uz) + Math.abs(q.hw * q.ux);
    const ds = (q.x - r.a[0]) * u[0] + (q.z - r.a[1]) * u[1], dn = (q.x - r.a[0]) * r.out[0] + (q.z - r.a[1]) * r.out[1];
    const half = Math.abs(ex * u[0]) + Math.abs(ez * u[1]), halfN = Math.abs(ex * r.out[0]) + Math.abs(ez * r.out[1]);
    if (dn - halfN > MM(20) || dn + halfN < -MM(450)) continue;
    blocked.push([ds - half - MM(20), ds + half + MM(20)]);
  }
  for (const q of app.objects.all('rail')) {
    if (Math.abs(q.y - r.y) > MM(30) || Math.abs(q.out[0] * r.out[0] + q.out[1] * r.out[1]) < 0.9) continue;
    const da = (q.a[0] - r.a[0]) * r.out[0] + (q.a[1] - r.a[1]) * r.out[1];
    if (Math.abs(da) > MM(30)) continue;
    const s0 = (q.a[0] - r.a[0]) * u[0] + (q.a[1] - r.a[1]) * u[1], s1 = (q.b[0] - r.a[0]) * u[0] + (q.b[1] - r.a[1]) * u[1];
    blocked.push([Math.min(s0, s1) - MM(5), Math.max(s0, s1) + MM(5)]);
  }
  // the free stretch round the finger (ends 20 mm off what stops it)
  let lo = 0, hi = L, why = null;
  for (const [b0, b1] of blocked) {
    if (s >= b0 && s <= b1) { why = 'Здесь на краю уже стоит стена или ограждение'; break; }
    if (b1 < s) lo = Math.max(lo, b1); if (b0 > s) hi = Math.min(hi, b0);
  }
  if (!why && hi - lo < MM(400)) why = 'Здесь слишком короткий свободный край';
  const A = [r.a[0] + u[0] * lo, r.a[1] + u[1] * lo], B = [r.a[0] + u[0] * hi, r.a[1] + u[1] * hi];
  return { rec: { type: 'rail', slab: b.id, a: A.map((v) => +v.toFixed(6)), b: B.map((v) => +v.toFixed(6)), y: +r.y.toFixed(6), out: r.out.map((v) => +v.toFixed(5)) }, len: Math.round((hi - lo) / S), why };
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    shoe: new THREE.MeshStandardMaterial({ color: 0x3a3d41, metalness: 0.5, roughness: 0.4 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xd2d6da, metalness: 1, roughness: 0.22 }),
    // clear laminated glass: a faint green in its thickness, the edges greener
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd8ece6, roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    edge: new THREE.MeshStandardMaterial({ color: 0x7fb8a3, roughness: 0.2, transparent: true, opacity: 0.65 }),
  };
  return MATS;
}
// the railing as a group (model scale, world placed): x along a→b, y up from the slab's top, z out
export function buildRail(r, ghost = null) {
  const M = mats(), L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) / S, G = { shoe: [], cap: [], glass: [], edge: [] };
  const box = (k, x0, x1, y0, y1, z0, z1) => G[k].push(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  const [sw, sh] = RAIL.shoe, zc = -RAIL.back - sw / 2, t = RAIL.glass;
  // the shoe: the channel's two walls and its floor, the end caps
  box('shoe', 0, L, 0, 12, zc - sw / 2, zc + sw / 2);
  for (const z of [zc - sw / 2 + 3, zc + sw / 2 - 3]) box('shoe', 0, L, 0, sh, z - 3, z + 3);
  box('shoe', 0, 4, 0, sh, zc - sw / 2, zc + sw / 2); box('shoe', L - 4, L, 0, sh, zc - sw / 2, zc + sw / 2);
  // the glass in panels, wedged into the channel; the green edges
  const n = Math.max(1, Math.ceil((L - 20) / RAIL.pane)), pw = (L - 20 - (n - 1) * RAIL.gap) / n;
  for (let k = 0; k < n; k++) {
    const x0 = 10 + k * (pw + RAIL.gap), x1 = x0 + pw;
    box('glass', x0, x1, 25, RAIL.H - 25, zc - t / 2, zc + t / 2);
    box('edge', x0, x0 + 2, 25, RAIL.H - 25, zc - t / 2, zc + t / 2); box('edge', x1 - 2, x1, 25, RAIL.H - 25, zc - t / 2, zc + t / 2);
  }
  // the cap along the top: a stainless U over the glass, its ends closed
  box('cap', 5, L - 5, RAIL.H - 27, RAIL.H, zc - t / 2 - 3, zc + t / 2 + 3);
  const g = new THREE.Group();
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), ghost === false ? new THREE.MeshBasicMaterial({ color: 0xd04040, transparent: true, opacity: 0.5, depthWrite: false }) : M[k]);
    m.castShadow = k !== 'glass'; m.receiveShadow = true;
    if (k === 'glass') m.renderOrder = 2;
    g.add(m);
  }
  // its place: the basis along the edge, up, out (in the model's scale)
  const ux = (r.b[0] - r.a[0]) / (L * S), uz = (r.b[1] - r.a[1]) / (L * S);
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(new THREE.Vector3(ux * S, 0, uz * S), new THREE.Vector3(0, S, 0), new THREE.Vector3(r.out[0] * S, 0, r.out[1] * S)).setPosition(r.a[0], r.y, r.a[1]);
  return g;
}
