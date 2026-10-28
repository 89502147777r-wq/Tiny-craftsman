import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { lineOf } from './garden.js';

// A fence, put up the way a fencer does it:
//   line  – its line drawn by the finger (the posts' line; corners where the finger turns); the gates
//           and the wickets marked on it (they may go in later too);
//   holes – a hole for each post bored with an earth auger, Ø 200, 1000 deep (at the ends, the corners,
//           each side of a gate; between them evenly, ≤ the kind's span);
//   posts – steel posts 60 × 60 (100 × 100 at the gates) stood to the string and concreted;
//   fill  – bay by bay: the rails, then the infill — horizontal WPC slats; vertical metal pickets;
//           louvres; welded 3D panels; chain-link stretched on its wires — and the gates' leaves hung.
// A fence record (the line in world model metres, the sizes in real mm):
//   fence { pts: [[x, z]…], H, kind, col, g (the ground's level), done: { holes, posts, fill },
//           gates: [{ s (its middle: mm along the line), w, type, open }] }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const FENCE = { post: 60, bigPost: 100, hole: 200, holeDepth: 1000, slat: 140, slatT: 20, slatGap: 10, panel: 2500, slatStep: 2000, gap: 50 };
export const FENCE_LAYERS = [['line', 'Разметка'], ['holes', 'Ямы под столбы'], ['posts', 'Столбы'], ['fill', 'Заполнение'], ['gate', 'Ворота и калитки']];
// the kinds: the name, the span between posts, the colours they come in
export const FENCE_KINDS = {
  slat: { name: 'Горизонтальное ранчо (ДПК)', step: 2000, cols: ['graphite', 'teak', 'grey', 'walnut'] },
  picket: { name: 'Евроштакетник', step: 2500, cols: ['anth', 'brown', 'green', 'white'] },
  louvre: { name: 'Жалюзи', step: 2500, cols: ['anth', 'black', 'brown'] },
  mesh: { name: '3D-панели', step: 2560, cols: ['anth', 'green'] },
  chain: { name: 'Сетка-рабица', step: 2500, cols: ['galv', 'green'] },
};
export const FENCE_HEIGHTS = [1200, 1500, 1800, 2000];
// the colours: the WPC boards' photographs; powder coats (RAL); galvanised
export const FENCE_COLS = {
  graphite: ['Графит', 'deck/graphite', 0xb8b8b8], teak: ['Тик', 'deck/teak', 0xd9c7b6], grey: ['Серый', 'deck/grey', 0xd8d8d8], walnut: ['Орех', 'deck/walnut', 0xffffff],
  anth: ['RAL 7016 графит', null, 0x383e42], green: ['RAL 6005 зелёный', null, 0x114232], brown: ['RAL 8017 шоколад', null, 0x45322e], white: ['RAL 9016 белый', null, 0xeef0ec],
  black: ['RAL 9005 чёрный', null, 0x151617], galv: ['Оцинковка', null, 0xa9adb0],
};
// the gates and the wickets: the width, how they open, the shape of the top
export const GATES = {
  swing: { name: 'Распашные ворота', w: 3500, leaves: 2, gate: true },
  swingArch: { name: 'Распашные ворота с аркой', w: 3500, leaves: 2, arch: 300, gate: true },
  slide: { name: 'Откатные ворота', w: 4000, slide: true, gate: true },
  wicket: { name: 'Калитка', w: 1000, leaves: 1 },
  wicketArch: { name: 'Калитка с аркой', w: 1000, leaves: 1, arch: 200 },
  wicketIntercom: { name: 'Калитка с домофоном и почтовым ящиком', w: 1000, leaves: 1, intercom: true },
};
export const kindOf = (r) => (FENCE_KINDS[r.kind] ? r.kind : 'slat');
export const colOf = (r) => { const K = FENCE_KINDS[kindOf(r)]; return K.cols.includes(r.col) ? r.col : K.cols[0]; };
export const fenceLine = (trail) => lineOf(trail);

// ---- along the line ---------------------------------------------------------------------------------
function legs(r) {
  const out = []; let s = 0;
  for (let i = 1; i < r.pts.length; i++) { const [x0, z0] = r.pts[i - 1], [x1, z1] = r.pts[i], L = Math.hypot(x1 - x0, z1 - z0) / S; out.push({ x0, z0, ux: (x1 - x0) / (L * S), uz: (z1 - z0) / (L * S), s0: s, L }); s += L; }
  return out;
}
export const lengthMm = (r) => legs(r).reduce((s, g) => s + g.L, 0);
// the point at s (mm along the line): [x, z, ux, uz]
export function pointAtS(r, s) {
  const G = legs(r); let g = G[0];
  for (const q of G) if (s >= q.s0) g = q;
  const k = Math.max(0, Math.min(g.L, s - g.s0));
  return [g.x0 + g.ux * MM(k), g.z0 + g.uz * MM(k), g.ux, g.uz];
}
// where a point is along the line (mm) and how far off it
export function sOf(r, x, z) {
  let best = [0, Infinity];
  for (const g of legs(r)) { const a = Math.max(0, Math.min(g.L, ((x - g.x0) * g.ux + (z - g.z0) * g.uz) / S)), px = g.x0 + g.ux * MM(a), pz = g.z0 + g.uz * MM(a), d = Math.hypot(px - x, pz - z); if (d < best[1]) best = [g.s0 + a, d]; }
  return best;
}
// a gate's place: kept within one leg, clear of the corners and of the other gates (null: no room)
export function gateFit(r, s, w, skip = -1) {
  const G = legs(r), g = G.find((q) => s >= q.s0 && s <= q.s0 + q.L) || G.at(-1), m = 150;
  if (g.L < w + 2 * m) return null;
  const c = Math.max(g.s0 + m + w / 2, Math.min(g.s0 + g.L - m - w / 2, s));
  for (const [i, q] of (r.gates || []).entries()) if (i !== skip && Math.abs(q.s - c) < (q.w + w) / 2 + 300) return null;
  return Math.round(c);
}
// the posts: [x, z, big (a gate's), s] — at the ends, the corners and each side of a gate; between them evenly
export function postsOf(r) {
  const G = legs(r), step = FENCE_KINDS[kindOf(r)].step, gates = (r.gates || []).map((q) => [q.s - q.w / 2, q.s + q.w / 2]);
  const hard = new Set([0, ...G.map((g) => g.s0 + g.L)]);
  for (const [a, b] of gates) { hard.add(a); hard.add(b); }
  const H = [...hard].sort((a, b) => a - b), out = [];
  const big = (s) => gates.some(([a, b]) => Math.abs(s - a) < 1 || Math.abs(s - b) < 1);
  for (let i = 0; i < H.length; i++) {
    out.push(H[i]);
    if (i === H.length - 1) break;
    const a = H[i], b = H[i + 1], mid = (a + b) / 2;
    if (gates.some(([p, q]) => mid > p && mid < q)) continue;
    const n = Math.max(1, Math.ceil((b - a) / step - 1e-6));
    for (let k = 1; k < n; k++) out.push(a + (b - a) * k / n);
  }
  return out.map((s) => { const [x, z] = pointAtS(r, s); return [x, z, big(s) ? 1 : 0, s]; });
}
// the bays between the posts: { a, b, L, gate (its index, or -1) }
export function baysOf(r) {
  const P = postsOf(r), out = [], gates = r.gates || [];
  for (let i = 1; i < P.length; i++) {
    const mid = (P[i - 1][3] + P[i][3]) / 2, gi = gates.findIndex((q) => Math.abs(mid - q.s) < q.w / 2 - 1);
    out.push({ a: P[i - 1], b: P[i], L: Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), gate: gi });
  }
  return out;
}
export const fenceLength = (r) => baysOf(r).filter((b) => b.gate < 0).reduce((s, b) => s + b.L, 0);

// ---- drawn --------------------------------------------------------------------------------------
const TEX = {};
function tex(folder, file, srgb) {
  const key = folder + '/' + file;
  if (TEX[key]) return TEX[key];
  const t = new THREE.TextureLoader().load(`assets/textures/${folder}/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[key] = t);
}
let _chain = null;
// chain-link: woven diamonds of galvanised wire (drawn once, alpha cut out)
function chainTex() {
  if (_chain) return _chain;
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
  for (const [a, b, p, q] of [[0, 0, 64, 64], [64, 64, 128, 128], [64, 0, 0, 64], [128, 64, 64, 128], [64, 0, 128, 64], [0, 64, 64, 128]]) { g.beginPath(); g.moveTo(a, b); g.lineTo(p, q); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return (_chain = t);
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const at = (x, y, z, yaw = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
const yawOf = (a, b) => Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
// shown by count (the pieces going in one after another; each its order): dropped onto its place
function counted(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uN = U.n;
    sh.vertexShader = 'attribute float aOrd;\nuniform float uN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      if (aOrd >= uN) transformed *= 0.0;
      else { float kk = clamp(uN - aOrd, 0.0, 1.0); transformed.y += (1.0 - kk) * ${MM(250).toFixed(8)}; }`);
  };
  mat.customProgramCacheKey = () => 'fenceCount';
  return mat;
}
// instanced pieces: [[matrix, order]…]
function pieces(geo, mat, list, U) {
  const g = geo.clone(), m = new THREE.InstancedMesh(g, U ? counted(mat, U) : mat, Math.max(1, list.length)), ord = new Float32Array(Math.max(1, list.length));
  list.forEach(([M, k], i) => { m.setMatrixAt(i, M); ord[i] = k; });
  if (!list.length) m.count = 0;
  g.setAttribute('aOrd', new THREE.InstancedBufferAttribute(ord, 1));
  m.castShadow = m.receiveShadow = true;
  return m;
}
const metal = (c, rough = 0.45) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.5 });
function fillMat(kind, col) {
  const C = FENCE_COLS[col] || FENCE_COLS.anth;
  if (kind === 'slat') return new THREE.MeshStandardMaterial({ map: tex(C[1] || 'deck/graphite', 'col.jpg', true), normalMap: tex(C[1] || 'deck/graphite', 'nor.jpg', false), color: C[2], roughness: 0.75 });
  if (kind === 'chain') return new THREE.MeshStandardMaterial({ color: C[2], alphaMap: chainTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 });
  return metal(C[2], kind === 'mesh' ? 0.5 : 0.4);
}

// the string line and the pegs while it is set out; a dab of paint where each post goes; the gates' gaps
export function fenceString(r) {
  const G = new THREE.Group(), y = r.g + MM(150), line = new THREE.LineBasicMaterial({ color: 0xfff3c4 });
  G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(r.pts.map(([x, z]) => new THREE.Vector3(x, y, z))), line));
  const pg = box(MM(40), MM(450), MM(40)); pg.translate(0, MM(75), 0);
  const pm = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 });
  for (const [x, z] of [r.pts[0], r.pts.at(-1)]) { const o = new THREE.Mesh(pg, pm); o.position.set(x, r.g, z); o.castShadow = true; G.add(o); }
  const dot = new THREE.Mesh(new THREE.CircleGeometry(MM(90), 12), new THREE.MeshBasicMaterial({ color: 0xff5a1f })); dot.rotation.x = -Math.PI / 2;
  const big = new THREE.Mesh(new THREE.CircleGeometry(MM(130), 12), new THREE.MeshBasicMaterial({ color: 0x2f8cff })); big.rotation.x = -Math.PI / 2;
  for (const [x, z, b] of postsOf(r)) { const d = (b ? big : dot).clone(); d.position.set(x, r.g + MM(8), z); G.add(d); }
  return G;
}
// the posts (shown one by one as they go in; a gate's posts 100 × 100), their concrete with them
export function fencePosts(r, U) {
  const G = new THREE.Group(), P = postsOf(r), H = r.H, top = r.g + MM(H), bot = r.g - MM(FENCE.holeDepth - 100);
  const pm = metal(0x2f3236);
  const mk = (s) => { const g = box(MM(s), top - bot + MM(s > 60 ? 100 : 0), MM(s)); g.translate(0, (top + bot) / 2 + MM(s > 60 ? 50 : 0), 0); return g; };
  const yaw = (i) => yawOf(P[Math.max(0, i - 1)], P[Math.min(P.length - 1, i + 1)]);
  const small = [], large = [];
  P.forEach(([x, z, b], i) => (b ? large : small).push([at(x, 0, z, yaw(i)), i]));
  G.add(pieces(mk(FENCE.post), pm, small, U.posts), pieces(mk(FENCE.bigPost), pm, large, U.posts));
  const cap = box(MM(66), MM(6), MM(66)); cap.translate(0, top + MM(3), 0);
  const capB = box(MM(106), MM(6), MM(106)); capB.translate(0, top + MM(103), 0);
  G.add(pieces(cap, pm, small, U.posts), pieces(capB, pm, large, U.posts));
  const cg = new THREE.CylinderGeometry(MM(95), MM(105), MM(60), 14); cg.translate(0, r.g - MM(25), 0);
  G.add(pieces(cg, new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), color: 0xbdbab3, roughness: 0.95 }), P.map(([x, z], i) => [at(x, 0, z), i]), U.posts));
  return G;
}
// the fill of the bays (the gates' bays left open: their leaves are fenceGates'); the order: bay by bay,
// the rails first, then the infill from the bottom (slats, louvres) or along (pickets)
export function fenceFill(r, U) {
  const G = new THREE.Group(), kind = kindOf(r), col = colOf(r), B = baysOf(r).filter((b) => b.gate < 0), H = r.H, m = fillMat(kind, col), rail = metal((FENCE_COLS[col] || FENCE_COLS.anth)[2]);
  const L = { rails: [], fill: [], wire: [] };
  let ord = 0;
  for (const b of B) {
    const yaw = yawOf(b.a, b.b), cx = (b.a[0] + b.b[0]) / 2, cz = (b.a[1] + b.b[1]) / 2, ux = (b.b[0] - b.a[0]) / b.L, uz = (b.b[1] - b.a[1]) / b.L, nx = -uz, nz = ux;
    const span = (len, y, M) => { M.multiply(new THREE.Matrix4().makeScale(len, 1, 1)); return M; };
    const inner = b.L - MM(FENCE.post);
    if (kind === 'slat') {
      const rows = Math.floor((H - FENCE.gap) / (FENCE.slat + FENCE.slatGap)), off = MM(FENCE.post / 2 + FENCE.slatT / 2);
      for (let k = 0; k < rows; k++) L.fill.push([span(b.L + MM(FENCE.post), 0, at(cx + nx * off, r.g + MM(FENCE.gap + k * (FENCE.slat + FENCE.slatGap) + FENCE.slat / 2), cz + nz * off, yaw)), ord++]);
    } else if (kind === 'picket') {
      // two rails 40 × 20 on the posts' face, the pickets 120 wide 30 apart screwed to them
      const off = MM(FENCE.post / 2 + 10);
      for (const y of [300, H - 300]) L.rails.push([span(b.L + MM(FENCE.post), 0, at(cx + nx * off, r.g + MM(y), cz + nz * off, yaw)), ord++]);
      const n = Math.floor((b.L / S - FENCE.post) / 150);
      for (let k = 0; k < n; k++) { const s = -inner / 2 + (inner - (n - 1) * MM(150)) / 2 + k * MM(150); L.fill.push([at(cx + ux * s + nx * MM(FENCE.post / 2 + 24), r.g + MM(100 + (H - 100) / 2), cz + uz * s + nz * MM(FENCE.post / 2 + 24), yaw), ord++]); }
    } else if (kind === 'louvre') {
      // the blades 100 deep at 45°, every 70 between two U-channels on the posts
      const n = Math.floor((H - 2 * FENCE.gap) / 70);
      for (let k = 0; k < n; k++) { const M = at(cx, r.g + MM(FENCE.gap + 35 + k * 70), cz, yaw); M.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 4)); M.multiply(new THREE.Matrix4().makeScale(inner, 1, 1)); L.fill.push([M, ord++]); }
    } else if (kind === 'mesh') {
      const M = at(cx, r.g + MM(FENCE.gap), cz, yaw); M.multiply(new THREE.Matrix4().makeScale(inner, 1, 1)); L.fill.push([M, ord++]);
    } else {
      // chain-link: three tension wires, the mesh stretched over them
      for (const y of [80, H / 2, H - 40]) L.wire.push([span(b.L, 0, at(cx, r.g + MM(y), cz, yaw)), ord]);
      const M = at(cx, r.g + MM(40 + (H - 40) / 2), cz, yaw); M.multiply(new THREE.Matrix4().makeScale(b.L, 1, 1)); L.fill.push([M, ord++]);
    }
  }
  if (kind === 'slat') G.add(pieces(box(1, MM(FENCE.slat), MM(FENCE.slatT)), m, L.fill, U.fill));
  else if (kind === 'picket') { G.add(pieces(box(1, MM(20), MM(40)), rail, L.rails, U.fill)); G.add(pieces(box(MM(120), MM(H - 100), MM(8)), m, L.fill, U.fill)); }
  else if (kind === 'louvre') G.add(pieces(box(1, MM(100), MM(3)), m, L.fill, U.fill));
  else if (kind === 'mesh') G.add(meshPanel(H, m, L.fill, U.fill));
  else {
    // (the mesh's cells 55 mm: the texture repeated over the bay — the bays of a fence are near enough alike)
    const avg = B.length ? B.reduce((s, b) => s + b.L, 0) / B.length / S : 2500, t = chainTex().clone(); t.needsUpdate = true; t.repeat.set(avg / 55, (H - 40) / 55);
    const cm = m.clone(); cm.alphaMap = t;
    G.add(pieces(box(1, MM(4), MM(4)), metal(0x8e9396, 0.35), L.wire, U.fill)); G.add(chainPlane(H, cm, L.fill, U.fill));
  }
  return G;
}
// a welded panel (unit length along x): wires Ø5 at 200 × 50, three V-folds — as one geometry, instanced per bay
function meshPanel(H, m, list, U) {
  const parts = [], w = MM(5), h = MM(H - FENCE.gap - 20);
  for (let k = 0; k <= 12; k++) { const g = box(w / 1, h, w); g.translate(-0.5 + k / 12, h / 2, 0); parts.push(g); }
  for (let y = 0; y <= H - FENCE.gap - 20; y += 200) { const g = box(1, w, w); g.translate(0, MM(y), 0); parts.push(g); }
  for (const f of [0.2, 0.5, 0.8]) { const g = box(1, w, MM(40)); g.translate(0, h * f, 0); parts.push(g); }
  // (the vertical wires scaled with the bay: thin enough that it does not show)
  const geo = mergeBoxes(parts);
  return pieces(geo, m, list, U);
}
function chainPlane(H, m, list, U) {
  const g = new THREE.PlaneGeometry(1, MM(H - 40));
  return pieces(g, m, list, U);
}
function mergeBoxes(list) {
  const pos = [], nor = [], idx = []; let base = 0;
  for (const g of list) { const gi = g.toNonIndexed(); const p = gi.attributes.position.array, n = gi.attributes.normal.array; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); } for (let i = 0; i < p.length / 3; i++) idx.push(base + i); base += p.length / 3; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}
// the number of pieces of the fill (for the animation's count)
export const fillCount = (r) => { const k = kindOf(r), B = baysOf(r).filter((b) => b.gate < 0), H = r.H; return B.length * (k === 'slat' ? Math.floor((H - FENCE.gap) / (FENCE.slat + FENCE.slatGap)) : k === 'louvre' ? Math.floor((H - 2 * FENCE.gap) / 70) : 1) + (k === 'picket' ? B.reduce((s, b) => s + 2 + Math.floor((b.L / S - FENCE.post) / 150), 0) - B.length : 0); };

// ---- the gates ----------------------------------------------------------------------------------------
// a leaf (local: x along from its hinge 0 … w, y up from the ground, z across): a steel frame 60 × 40,
// the infill of the fence's kind inside it; an arch on top; for a wicket a handle and a lock
function leaf(kind, col, w, H, arch = 0, opts = {}) {
  const G = new THREE.Group(), C = FENCE_COLS[col] || FENCE_COLS.anth, fm = metal(kind === 'slat' || kind === 'chain' ? 0x2f3236 : C[2], 0.4), fill = fillMat(kind, col);
  const t = 60, y0 = 60, top = (x) => H - 40 + (arch ? arch * Math.sin(Math.PI * Math.max(0, Math.min(1, x / w))) : 0);
  const add = (geo, m, x, y, z = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(MM(x), MM(y), MM(z)); o.rotation.z = rz; o.castShadow = true; o.receiveShadow = true; G.add(o); return o; };
  add(box(MM(w), MM(t), MM(40)), fm, w / 2, y0);
  add(box(MM(t), MM(top(0) - y0), MM(40)), fm, t / 2, (y0 + top(0)) / 2);
  add(box(MM(t), MM(top(w) - y0), MM(40)), fm, w - t / 2, (y0 + top(w)) / 2);
  // (the top: straight, or an arch in short straight pieces)
  const n = arch ? 12 : 1;
  for (let k = 0; k < n; k++) { const xa = w * k / n, xb = w * (k + 1) / n, ya = top(xa), yb = top(xb), L = Math.hypot(xb - xa, yb - ya); add(box(MM(L + 4), MM(t), MM(40)), fm, (xa + xb) / 2, (ya + yb) / 2, 0, Math.atan2(yb - ya, xb - xa)); }
  const x0 = t, x1 = w - t, inner = x1 - x0;
  if (kind === 'slat') {
    for (let y = y0 + t / 2 + 20; y + FENCE.slat < Math.min(top(0), top(w)) - t / 2; y += FENCE.slat + FENCE.slatGap) add(box(MM(inner), MM(FENCE.slat), MM(FENCE.slatT)), fill, (x0 + x1) / 2, y + FENCE.slat / 2, 10);
  } else if (kind === 'picket') {
    const nn = Math.floor(inner / 150);
    for (let k = 0; k < nn; k++) { const x = x0 + (inner - (nn - 1) * 150) / 2 + k * 150, h = top(x) - y0 - t; add(box(MM(120), MM(h), MM(8)), fill, x, y0 + t / 2 + h / 2, 22); }
  } else if (kind === 'louvre') {
    for (let y = y0 + t / 2 + 40; y < Math.min(top(0), top(w)) - t / 2 - 30; y += 70) { const o = add(box(MM(inner), MM(100), MM(3)), fill, (x0 + x1) / 2, y); o.rotation.x = Math.PI / 4; }
  } else if (kind === 'mesh') {
    for (let x = x0; x <= x1 + 1; x += 50 * 4) { const h = top(x) - y0 - t; add(box(MM(5), MM(h), MM(5)), fill, x, y0 + t / 2 + h / 2); }
    for (let y = y0 + t; y < Math.min(top(0), top(w)) - t; y += 200) add(box(MM(inner), MM(5), MM(5)), fill, (x0 + x1) / 2, y);
  } else {
    const h = Math.min(top(0), top(w)) - y0 - t, g = new THREE.PlaneGeometry(MM(inner), MM(h)); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * inner / 55, uv.getY(i) * h / 55);
    add(g, fill, (x0 + x1) / 2, y0 + t / 2 + h / 2);
  }
  if (opts.handle) {
    const st = metal(0xc8ccd0, 0.25);
    add(box(MM(30), MM(180), MM(40)), metal(0x1d1e20), w - t - 40, 1000, 30);
    add(box(MM(140), MM(18), MM(18)), st, w - t - 90, 1060, 60);
  }
  return G;
}
// the gates of a fence: { group, leaves: [{ pivot, side, swing }] } per gate; posts are fencePosts'
export function fenceGates(r) {
  const out = [], kind = kindOf(r), col = colOf(r), H = r.H;
  (r.gates || []).forEach((q, gi) => {
    const T = GATES[q.type] || GATES.swing, [ax, az] = pointAtS(r, q.s - q.w / 2), [bx, bz, ux, uz] = pointAtS(r, q.s + q.w / 2), yaw = Math.atan2(-uz, ux);
    const G = new THREE.Group(), leaves = [], gap = 20, Wc = q.w - FENCE.bigPost - 2 * gap;
    G.position.set(ax, r.g, az); G.rotation.y = yaw;
    const x0 = FENCE.bigPost / 2 + gap;
    if (T.slide) {
      // the cantilever gate: the leaf with its tail (behind the post it rolls back past), the bottom
      // beam, two roller carriages on a concrete pad, the catcher on the far post
      const tail = Math.round(Wc * 0.45), lw = Wc + tail, L = leaf(kind, col, Wc, H - 40, 0), pivot = new THREE.Group();
      pivot.add(L); L.position.x = MM(tail);
      const tm = metal(0x2f3236, 0.4);
      const tb = new THREE.Mesh(box(MM(tail), MM(60), MM(40)), tm); tb.position.set(MM(tail / 2), MM(90), 0); pivot.add(tb);
      const diag = new THREE.Mesh(box(MM(Math.hypot(tail, H - 300)), MM(40), MM(40)), tm); diag.position.set(MM(tail / 2), MM((H - 300) / 2 + 90), 0); diag.rotation.z = Math.atan2(H - 300, tail); pivot.add(diag);
      const beam = new THREE.Mesh(box(MM(lw), MM(60), MM(70)), tm); beam.position.set(MM(lw / 2), MM(30), 0); pivot.add(beam);
      pivot.position.x = MM(x0 - tail); G.add(pivot);
      const pad = new THREE.Mesh(box(MM(tail + 300), MM(80), MM(400)), new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), color: 0xbdbab3, roughness: 0.95 })); pad.position.set(MM(x0 - tail / 2 - 150), MM(-30), 0); pad.receiveShadow = true; G.add(pad);
      for (const k of [0.15, 0.75]) { const c = new THREE.Mesh(box(MM(220), MM(80), MM(120)), metal(0x7c8287, 0.3)); c.position.set(MM(x0 - tail * (1 - k)), MM(40), 0); G.add(c); }
      leaves.push({ pivot, slide: MM(Wc + gap) });
    } else {
      const n = T.leaves || 1, lw = Wc / n;
      for (let k = 0; k < n; k++) {
        const pivot = new THREE.Group(), L = leaf(kind, col, lw - (n > 1 ? gap / 2 : 0), H - 40 + (T.arch ? 0 : 0), T.arch ? (n > 1 ? T.arch / 1 : T.arch) : 0, { handle: k === n - 1 });
        if (k === 1) { L.scale.x = -1; pivot.position.x = MM(q.w - FENCE.bigPost / 2 - gap); } else pivot.position.x = MM(x0);
        // (a two-leaf arch: each leaf a half of it — the right one mirrored)
        if (T.arch && n > 1) L.scale.x *= 1;
        pivot.add(L); G.add(pivot);
        // hinges on the post's side
        const hm = metal(0x1d1e20, 0.5);
        for (const y of [250, H - 400]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(MM(14), MM(14), MM(120), 8), hm); h.position.set(0, MM(y), 0); pivot.add(h); }
        leaves.push({ pivot, side: k === 1 ? -1 : 1 });
      }
      if (T.intercom) {
        // the intercom panel and the mailbox on the post by the wicket
        const panel = new THREE.Mesh(box(MM(110), MM(240), MM(30)), metal(0x26282b, 0.3)); panel.position.set(MM(q.w), MM(1350), MM(70)); G.add(panel);
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(MM(14), MM(14), MM(8), 12), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x5aa8e6, emissiveIntensity: 0.6 })); btn.rotation.x = Math.PI / 2; btn.position.set(MM(q.w), MM(1300), MM(88)); G.add(btn);
        const box2 = new THREE.Mesh(box(MM(360), MM(420), MM(140)), metal(0x383e42, 0.4)); box2.position.set(MM(-250), MM(1000), MM(110)); G.add(box2);
      }
    }
    G.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    out.push({ group: G, leaves, gi });
  });
  return out;
}
export const fenceUniforms = () => ({ posts: { n: { value: -1 } }, fill: { n: { value: -1 } } });
// the earth auger (a two-man petrol auger): the motor, the bars, the screw
export function auger() {
  const G = new THREE.Group(), red = new THREE.MeshStandardMaterial({ color: 0xc6372b, roughness: 0.5, metalness: 0.2 }), steel = new THREE.MeshStandardMaterial({ color: 0x6d7175, roughness: 0.35, metalness: 0.85 }), black = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.6 });
  const screw = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(MM(20), MM(20), MM(1100), 8), steel); shaft.position.y = MM(550); screw.add(shaft);
  for (let k = 0; k < 22; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(MM(190), MM(6), MM(60)), steel); f.position.y = MM(40 + k * 45); f.rotation.y = k * 0.9; f.rotation.z = 0.25; screw.add(f); }
  G.add(screw); G.userData.screw = screw;
  const motor = new THREE.Mesh(new THREE.BoxGeometry(MM(260), MM(220), MM(220)), red); motor.position.y = MM(1250); G.add(motor);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(MM(14), MM(14), MM(1100), 8), black); bar.rotation.z = Math.PI / 2; bar.position.y = MM(1300); G.add(bar);
  G.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return G;
}
