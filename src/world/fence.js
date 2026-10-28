import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { lineOf } from './garden.js';

// A fence, put up the way a fencer does it:
//   line  – its line drawn by the finger (the posts' line; corners where the finger turns);
//   holes – a hole for each post bored with an earth auger, Ø 200, 1000 deep (every ≤ 2 m for slats,
//           2.5 m for mesh panels; at the ends and the corners);
//   posts – steel posts 60 × 60 (powder-coated) stood in them to the string and concreted;
//   rails – (slats) none: the boards go straight onto the posts; (mesh) the brackets for the panels;
//   fill  – the slats 140 × 20 from the bottom up, 10 mm apart, screwed to each post; or the welded
//           3D panels 2500 wide, bracket by bracket.
// A fence record (the line in world model metres, the sizes in real mm):
//   fence { pts: [[x, z]…], H, kind ('slat' | 'mesh'), col, g (the ground's level),
//           done: { holes, posts, fill } }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const FENCE = { post: 60, hole: 200, holeDepth: 1000, slat: 140, slatT: 20, slatGap: 10, panel: 2500, slatStep: 2000, gap: 50 };
export const FENCE_LAYERS = [['line', 'Разметка'], ['holes', 'Ямы под столбы'], ['posts', 'Столбы'], ['fill', 'Заполнение']];
export const FENCE_KINDS = { slat: 'Горизонтальные доски', mesh: '3D-панели' };
export const FENCE_HEIGHTS = [1200, 1500, 1800, 2000];
// the slats' colours (the WPC deck boards' photographs), the panels' powder coat
export const FENCE_COLS = {
  graphite: ['Графит', 'deck/graphite', 0xb8b8b8], teak: ['Тик', 'deck/teak', 0xd9c7b6], grey: ['Серый', 'deck/grey', 0xd8d8d8], walnut: ['Орех', 'deck/walnut', 0xffffff],
  anth: ['RAL 7016 графит', null, 0x383e42], green: ['RAL 6005 зелёный', null, 0x114232],
};
export const fenceLine = (trail) => lineOf(trail);
// the posts: [[x, z]…] — at the ends and corners, between them evenly at ≤ step
export function postsOf(r) {
  const step = MM(r.kind === 'mesh' ? FENCE.panel + FENCE.post : FENCE.slatStep), out = [];
  for (let i = 1; i < r.pts.length; i++) {
    const [x0, z0] = r.pts[i - 1], [x1, z1] = r.pts[i], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / step - 1e-6));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
  }
  return out;
}
// the bays between the posts: [{ a: [x, z], b: [x, z], L }]
export function baysOf(r) {
  const P = postsOf(r), out = [];
  for (let i = 1; i < P.length; i++) out.push({ a: P[i - 1], b: P[i], L: Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) });
  return out;
}
export const fenceLength = (r) => baysOf(r).reduce((s, b) => s + b.L, 0);

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
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// shown by count (the pieces going in one after another): the order per instance
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
// instances of one piece (a matrix each, in order)
function inst(geo, mat, mats, U) {
  const g = geo.clone(), m = new THREE.InstancedMesh(g, U ? counted(mat, U) : mat, mats.length);
  const ord = new Float32Array(mats.length);
  mats.forEach((M, i) => { m.setMatrixAt(i, M); ord[i] = i; });
  g.setAttribute('aOrd', new THREE.InstancedBufferAttribute(ord, 1));
  m.castShadow = m.receiveShadow = true;
  return m;
}
const at = (x, y, z, yaw = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));

// the string line and the pegs while it is set out; the holes' spoil
export function fenceString(r) {
  const G = new THREE.Group(), y = r.g + MM(150), line = new THREE.LineBasicMaterial({ color: 0xfff3c4 });
  G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(r.pts.map(([x, z]) => new THREE.Vector3(x, y, z))), line));
  const pg = box(MM(40), MM(450), MM(40)); pg.translate(0, MM(75), 0);
  const pm = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 });
  for (const [x, z] of [r.pts[0], r.pts.at(-1)]) { const o = new THREE.Mesh(pg, pm); o.position.set(x, r.g, z); o.castShadow = true; G.add(o); }
  // (where each post goes: a dab of marking paint)
  const dot = new THREE.Mesh(new THREE.CircleGeometry(MM(90), 12), new THREE.MeshBasicMaterial({ color: 0xff5a1f })); dot.rotation.x = -Math.PI / 2;
  for (const [x, z] of postsOf(r)) { const d = dot.clone(); d.position.set(x, r.g + MM(8), z); G.add(d); }
  return G;
}
// the posts (shown one by one as they go in; their concrete with them)
export function fencePosts(r, U) {
  const G = new THREE.Group(), P = postsOf(r), H = r.H, top = r.g + MM(H), bot = r.g - MM(FENCE.holeDepth - 100);
  const pm = new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.45, metalness: 0.5 });
  const geo = box(MM(FENCE.post), top - bot, MM(FENCE.post)); geo.translate(0, (top + bot) / 2, 0);
  const yawOf = (i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; return Math.atan2(-(b[1] - a[1]), b[0] - a[0]); };
  G.add(inst(geo, pm, P.map(([x, z], i) => at(x, 0, z, yawOf(i))), U.posts));
  // the cap on each post
  const cap = box(MM(66), MM(6), MM(66)); cap.translate(0, top + MM(3), 0);
  G.add(inst(cap, pm, P.map(([x, z], i) => at(x, 0, z, yawOf(i))), U.posts));
  // the concrete round the foot (its top, sloped off the post: seen at the ground)
  const cg = new THREE.CylinderGeometry(MM(95), MM(105), MM(60), 14); cg.translate(0, r.g - MM(25), 0);
  G.add(inst(cg, new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), color: 0xbdbab3, roughness: 0.95 }), P.map(([x, z]) => at(x, 0, z)), U.posts));
  return G;
}
// the fill: slats bay by bay from the bottom up, or a panel per bay
export function fenceFill(r, U) {
  const G = new THREE.Group(), B = baysOf(r), H = r.H, col = FENCE_COLS[r.col] || (r.kind === 'mesh' ? FENCE_COLS.anth : FENCE_COLS.graphite);
  if (r.kind === 'mesh') {
    // a welded panel: wires Ø5 at 200 × 50, three V-folds; on brackets
    const m = new THREE.MeshStandardMaterial({ color: col[2], roughness: 0.5, metalness: 0.4 });
    const wire = MM(5), mats = [], matsH = [];
    let ord = 0;
    const vert = box(wire, MM(H - FENCE.gap - 20), wire), hor = box(1, wire, wire);
    const vM = [], hM = [], hS = [];
    for (const b of B) {
      const L = b.L - MM(FENCE.post + 20), yaw = Math.atan2(-(b.b[1] - b.a[1]), b.b[0] - b.a[0]), ux = (b.b[0] - b.a[0]) / b.L, uz = (b.b[1] - b.a[1]) / b.L;
      const cx = (b.a[0] + b.b[0]) / 2, cz = (b.a[1] + b.b[1]) / 2, y0 = r.g + MM(FENCE.gap), n = Math.round(L / MM(200));
      for (let k = 0; k <= n; k++) { const s = -L / 2 + L * k / n; vM.push([at(cx + ux * s, y0 + MM(H - FENCE.gap - 20) / 2, cz + uz * s, yaw), ord]); }
      for (let y = 0; y <= H - FENCE.gap - 20; y += 50) { if (y % 200 !== 0 && y > 150 && y < H - 300) continue; const M = at(cx, y0 + MM(y), cz, yaw); M.multiply(new THREE.Matrix4().makeScale(L, 1, 1)); hM.push([M, ord]); }
      void hS; void mats; void matsH;
      ord++;
    }
    const mk = (geo, list) => { const im = new THREE.InstancedMesh(geo.clone(), counted(m.clone(), U.fill), list.length), o = new Float32Array(list.length); list.forEach(([M, k], i) => { im.setMatrixAt(i, M); o[i] = k; }); im.geometry.setAttribute('aOrd', new THREE.InstancedBufferAttribute(o, 1)); im.castShadow = true; return im; };
    G.add(mk(vert, vM), mk(hor, hM));
    return G;
  }
  // slats: one per row per bay (each its own piece, screwed at both posts), the rows 150 apart
  const m = new THREE.MeshStandardMaterial({ map: tex(col[1] || 'deck/graphite', 'col.jpg', true), normalMap: tex(col[1] || 'deck/graphite', 'nor.jpg', false), color: col[2], roughness: 0.75 });
  const rows = Math.floor((H - FENCE.gap) / (FENCE.slat + FENCE.slatGap)), list = [];
  for (let row = 0; row < rows; row++) B.forEach((b) => {
    const yaw = Math.atan2(-(b.b[1] - b.a[1]), b.b[0] - b.a[0]), cx = (b.a[0] + b.b[0]) / 2, cz = (b.a[1] + b.b[1]) / 2, nx = -(b.b[1] - b.a[1]) / b.L, nz = (b.b[0] - b.a[0]) / b.L;
    const off = MM(FENCE.post / 2 + FENCE.slatT / 2);
    const M = at(cx + nx * off, r.g + MM(FENCE.gap + row * (FENCE.slat + FENCE.slatGap) + FENCE.slat / 2), cz + nz * off, yaw);
    M.multiply(new THREE.Matrix4().makeScale(b.L + MM(FENCE.post), 1, 1));
    list.push(M);
  });
  // (the order: bay by bay, each from the bottom up)
  const per = B.length, order = list.map((M, i) => [M, (i % per) * rows + Math.floor(i / per)]).sort((p, q) => p[1] - q[1]);
  const geo = box(1, MM(FENCE.slat), MM(FENCE.slatT));
  // (the uv along the slat: the texture's boards run along it)
  const im = new THREE.InstancedMesh(geo, counted(m, U.fill), order.length), o = new Float32Array(order.length);
  order.forEach(([M], i) => { im.setMatrixAt(i, M); o[i] = i; });
  geo.setAttribute('aOrd', new THREE.InstancedBufferAttribute(o, 1));
  im.castShadow = im.receiveShadow = true;
  G.add(im);
  return G;
}
export const fenceUniforms = () => ({ posts: { n: { value: -1 } }, fill: { n: { value: -1 } } });
// the earth auger (a two-man petrol auger, here held at the post's place): the motor, the bars, the screw
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
