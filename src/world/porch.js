import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// The porch at a door, cast in concrete as a builder casts it, and the canopy over it:
//   dig   – the ground under it dug out 300 deep;
//   grav  – crushed stone 150, rammed;
//   form  – the formwork: the side boards cut to the steps, a riser board for each step, braced;
//   conc  – the concrete poured from the bottom up (it fills the forms and levels at each tread);
//   strip – the boards off;
//   tile  – porcelain tiles on the landing and the treads (an anti-slip edge on each), the risers too;
//           a stainless railing on both sides when there are more than three steps;
// and the canopy: four anchors drilled into the wall, two stainless brackets, laminated glass on them.
// A porch record (its frame: o the middle of the door's sill outside the wall, u along the wall, n out
// of it; the sizes in real mm):
//   porch { door (id), o: [x, z], yaw, y (the sill: the landing's top), g (the ground), W, D (the
//           landing), n (steps), rise, run, tile, done: { dig, grav, form, conc, strip, tile } }
//   canopy { door (id), o, yaw, y (its underside), W, P (out from the wall) }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const PORCH = { run: 300, riseMax: 175, landing: 1200, side: 300, dig: 300, grav: 150, tile: 20, canopyP: 1200, canopyAbove: 250 };
export const PORCH_LAYERS = [['dig', 'Котлован'], ['grav', 'Щебень'], ['form', 'Опалубка'], ['conc', 'Бетон'], ['strip', 'Распалубка'], ['tile', 'Облицовка']];
export const PORCH_TILES = {
  porc_anthracite: ['Керамогранит антрацит', 'facade/porc_anthracite', 600, 0xffffff, false],
  porc_concrete: ['Керамогранит «бетон»', 'facade/porc_concrete', 600, 0xffffff, false],
  trav: ['Травертин', 'travertine', 600, 0xffffff, true],
  oak: ['Керамогранит «дуб»', 'deck/oakporc', 1200, 0xffffff, true],
};
// the porch for a door: the frame from the door record (its middle, out of the wall), the steps from
// the sill's height over the ground
export function porchFor(door, g) {
  const out = [Math.sin(door.yaw), Math.cos(door.yaw)], along = [out[1], -out[0]], half = (door.t || 300) / 2;
  const o = [door.x + out[0] * MM(half), door.z + out[1] * MM(half)];
  const H = Math.max(0, (door.y - g) / S), n = Math.max(0, Math.ceil((H - 20) / PORCH.riseMax)), rise = n ? H / (n + 0) : 0;
  const W = Math.max(1500, door.w + 2 * PORCH.side);
  return { o: o.map((v) => +v.toFixed(6)), u: along.map((v) => +v.toFixed(6)), nrm: out.map((v) => +v.toFixed(6)), yaw: door.yaw, y: door.y, g, W: Math.round(W), D: PORCH.landing, n: Math.max(0, n - 1), rise: Math.round(rise), run: PORCH.run, H: Math.round(H) };
}
// a point of the porch's frame (a along the wall, d out of it, mm) → world [x, z]
export const PW = (r, a, d) => [r.o[0] + (r.u[0] * a + r.nrm[0] * d) * S, r.o[1] + (r.u[1] * a + r.nrm[1] * d) * S];
// the porch's blocks: the landing and each step below it ([a0, a1, d0, d1, top mm over the ground])
export function blocksOf(r) {
  const out = [[-r.W / 2, r.W / 2, 0, r.D, r.H]];
  for (let k = 0; k < r.n; k++) out.push([-r.W / 2, r.W / 2, r.D + k * r.run, r.D + (k + 1) * r.run, r.H - (k + 1) * r.rise]);
  return out;
}
export const footprint = (r) => [-r.W / 2, r.W / 2, 0, r.D + r.n * r.run];
export function inPorch(r, x, z, pad = 0) {
  const dx = x - r.o[0], dz = z - r.o[1], a = (dx * r.u[0] + dz * r.u[1]) / S, d = (dx * r.nrm[0] + dz * r.nrm[1]) / S, [a0, a1, d0, d1] = footprint(r);
  return a >= a0 - pad && a <= a1 + pad && d >= d0 - pad && d <= d1 + pad;
}

// ---- drawn ------------------------------------------------------------------------------------------
const TEX = {};
function tex(folder, file, srgb) {
  const key = folder + '/' + file;
  if (TEX[key]) return TEX[key];
  const t = new THREE.TextureLoader().load(`assets/textures/${folder}/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[key] = t);
}
// a box in the porch's frame (a, d, y in mm over the ground), uv in mm / tile on every face
function boxGeo(r, a0, a1, d0, d1, y0, y1, tile) {
  const g = new THREE.BoxGeometry((a1 - a0) * S, (y1 - y0) * S, (d1 - d0) * S);
  const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i) / S + (a0 + a1) / 2, y = pos.getY(i) / S + (y0 + y1) / 2, z = pos.getZ(i) / S + (d0 + d1) / 2, ny = Math.abs(nrm.getY(i)), nx = Math.abs(nrm.getX(i));
    uv.setXY(i, (ny > 0.5 ? x : nx > 0.5 ? z : x) / tile, (ny > 0.5 ? z : y) / tile);
  }
  // (x along the wall, z out of it — the group is turned to the porch's frame)
  g.translate((a0 + a1) / 2 * S, (y0 + y1) / 2 * S, (d0 + d1) / 2 * S);
  return g;
}
// the frame's group: placed at o on the ground, x along the wall, z out of it
function frame(r) {
  const G = new THREE.Group();
  G.position.set(r.o[0], r.g, r.o[1]);
  G.rotation.y = Math.atan2(r.nrm[0], r.nrm[1]);
  return G;
}
// the concrete (filled up to uFill mm over the ground: each block's top flattened to it)
export function porchConcrete(r, U) {
  const G = frame(r), parts = [];
  for (const [a0, a1, d0, d1, top] of blocksOf(r)) parts.push(boxGeo(r, a0, a1, d0, d1, -PORCH.grav, top, 600));
  const m = new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), normalMap: tex('pool_coat', 'nor.jpg', false), color: 0xc9c6bf, roughness: 0.9 });
  m.onBeforeCompile = (sh) => { sh.uniforms.uFill = U.fill; sh.vertexShader = 'uniform float uFill;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed.y = min(transformed.y, uFill);`); };
  m.customProgramCacheKey = () => 'porchFill';
  for (const g of parts) { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; G.add(o); }
  return G;
}
// the formwork: a board along each side cut to the steps, a riser board at each step's front, the
// landing's front board, stakes and braces outside
export function porchForm(r) {
  const G = frame(r), m = new THREE.MeshStandardMaterial({ map: tex('raw_plank_wall', 'diff.jpg', true), roughness: 0.85 }), t = 25, B = blocksOf(r);
  const add = (g) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; G.add(o); };
  for (const [, , d0, d1, top] of B) for (const s of [-1, 1]) { const a = s * (r.W / 2 + t / 2); add(boxGeo(r, a - t / 2, a + t / 2, d0, d1, -50, top + 10, 400)); }
  B.forEach(([a0, a1, , d1, top], k) => { const lo = k < B.length - 1 ? B[k + 1][4] : -50; add(boxGeo(r, a0 - t, a1 + t, d1, d1 + t, lo, top + 10, 400)); });
  // (stakes along the sides)
  const [, , , D1] = footprint(r);
  for (let d = 200; d < D1; d += 600) for (const s of [-1, 1]) add(boxGeo(r, s * (r.W / 2 + t + 25) - 25, s * (r.W / 2 + t + 25) + 25, d - 25, d + 25, -150, Math.min(r.H, 400), 400));
  return G;
}
// the tiles: a 20 mm skin on every top and front (the joints from the texture's own tiles), an
// anti-slip strip near each tread's edge
export function porchTiles(r, U) {
  const P = PORCH_TILES[r.tile] || PORCH_TILES.porc_anthracite, G = frame(r), T = PORCH.tile, B = blocksOf(r);
  const m = new THREE.MeshStandardMaterial({ map: tex(P[1], 'col.jpg', true), ...(P[4] ? { normalMap: tex(P[1], 'nor.jpg', false) } : {}), color: P[3], roughness: 0.55 });
  m.onBeforeCompile = (sh) => { sh.uniforms.uTile = U.tile; sh.vertexShader = 'uniform float uTile;\nattribute float aK;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n if (aK >= uTile) transformed *= 0.0;`); };
  m.customProgramCacheKey = () => 'porchTile';
  const strip = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.9 });
  B.forEach(([a0, a1, d0, d1, top], k) => {
    const lo = k < B.length - 1 ? B[k + 1][4] : 0;
    for (const g of [boxGeo(r, a0, a1, d0, d1 + T, top, top + T, P[2]), boxGeo(r, a0, a1, d1, d1 + T, lo, top, P[2])]) {
      const n = g.attributes.position.count; g.setAttribute('aK', new THREE.Float32BufferAttribute(new Array(n).fill(B.length - 1 - k), 1));
      const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; G.add(o);
    }
    const sg = boxGeo(r, a0 + 30, a1 - 30, d1 - 40, d1 - 15, top + T, top + T + 1.5, 400); sg.setAttribute('aK', new THREE.Float32BufferAttribute(new Array(sg.attributes.position.count).fill(B.length - 1 - k), 1));
    const sm = strip.clone(); sm.onBeforeCompile = m.onBeforeCompile; sm.customProgramCacheKey = () => 'porchTile';
    G.add(new THREE.Mesh(sg, sm));
  });
  // a stainless railing both sides when there are more than three steps
  if (r.n > 3) {
    const st = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 }), rr = 21;
    const [, , , D1] = footprint(r);
    for (const s of [-1, 1]) {
      const a = s * (r.W / 2 - 60), pts = [];
      for (let d = 150; d <= D1 - 100; d += Math.max(400, (D1 - 250) / 4)) pts.push(d);
      const yAt = (d) => (d <= r.D ? r.H : r.H - Math.min(r.n, Math.ceil((d - r.D) / r.run)) * r.rise) + T;
      for (const d of pts) { const c = new THREE.Mesh(new THREE.CylinderGeometry(MM(rr), MM(rr), MM(900), 10), st); c.position.set(MM(a), MM(yAt(d) + 450), MM(d)); c.castShadow = true; G.add(c); }
      // (the handrail: over the landing level, then down along the pitch)
      const h0 = new THREE.Vector3(MM(a), MM(r.H + T + 900), MM(pts[0])), h1 = new THREE.Vector3(MM(a), MM(r.H + T + 900), MM(Math.min(r.D, pts.at(-1)))), h2 = new THREE.Vector3(MM(a), MM(yAt(pts.at(-1)) + 900), MM(pts.at(-1)));
      for (const [p, q] of [[h0, h1], [h1, h2]]) { if (p.distanceTo(q) < 1e-6) continue; const L = p.distanceTo(q), c = new THREE.Mesh(new THREE.CylinderGeometry(MM(rr), MM(rr), L, 10), st); c.position.copy(p).add(q).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize()); c.castShadow = true; G.add(c); }
    }
  }
  return G;
}
export const porchUniforms = () => ({ fill: { value: -1e9 }, tile: { value: -1 } });

// the canopy: two stainless brackets (a plate on the wall, a rod to the glass's front edge) and the glass
// the canopies over a door (all hung on 4 chemical anchors M12 in the wall): style — how it is made
export const CANOPIES = {
  glass: { name: 'Стеклянный на тягах', usd: 320, P: 1200 },
  arch: { name: 'Арочный, поликарбонат', usd: 190, P: 1000 },
  metal: { name: 'Односкатный, металлочерепица', usd: 240, P: 1100 },
  gable: { name: 'Двускатный деревянный', usd: 380, P: 1200 },
  slab: { name: 'Плоский модерн с подсветкой', usd: 450, P: 1300 },
};
export function canopyFor(door, style = 'glass') {
  const out = [Math.sin(door.yaw), Math.cos(door.yaw)], along = [out[1], -out[0]], half = (door.t || 300) / 2, C = CANOPIES[style] || CANOPIES.glass;
  return { style: CANOPIES[style] ? style : 'glass', o: [+(door.x + out[0] * MM(half)).toFixed(6), +(door.z + out[1] * MM(half)).toFixed(6)], u: along, nrm: out, y: +(door.y + MM(door.h + PORCH.canopyAbove)).toFixed(6), W: Math.max(1400, door.w + 600), P: C.P };
}
// a straight bar from a to b (mm, the canopy's frame), w × h across
function bar(a, b, w, h, m) {
  const A = new THREE.Vector3(...a.map(MM)), B = new THREE.Vector3(...b.map(MM)), L = A.distanceTo(B);
  const o = new THREE.Mesh(new THREE.BoxGeometry(MM(w), MM(h), L), m); o.position.copy(A).add(B).multiplyScalar(0.5); o.lookAt(o.position.clone().add(B.clone().sub(A))); return o;
}
function rod(a, b, r, m) {
  const A = new THREE.Vector3(...a.map(MM)), B = new THREE.Vector3(...b.map(MM)), o = new THREE.Mesh(new THREE.CylinderGeometry(MM(r), MM(r), A.distanceTo(B), 12), m);
  o.position.copy(A).add(B).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); return o;
}
// a corrugated / tiled sheet: a strip of quads along x (W) and down the slope (L), its profile wave(x)
function sheet(W, L, wave, m, nx = 80, nz = 24, stepWave = null) {
  const g = new THREE.PlaneGeometry(MM(W), MM(L), nx, nz); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / MM(1), z = pos.getZ(i) / MM(1); pos.setY(i, MM(wave(x) + (stepWave ? stepWave(z) : 0))); }
  g.computeVertexNormals(); const o = new THREE.Mesh(g, m); return o;
}
let _shingle = null;
function shingleTex() {
  if (_shingle) return _shingle;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#3c2f2a'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) for (let k = -1; k < 5; k++) {
    const x = k * 64 + (row % 2) * 32, y = row * 32, sh = 0.75 + Math.random() * 0.35;
    g.fillStyle = `rgb(${92 * sh | 0},${52 * sh | 0},${40 * sh | 0})`; g.beginPath(); g.moveTo(x + 2, y); g.lineTo(x + 62, y); g.lineTo(x + 62, y + 22); g.lineTo(x + 32, y + 31); g.lineTo(x + 2, y + 22); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 2, y + 26, 60, 3);
  }
  _shingle = new THREE.CanvasTexture(c); _shingle.colorSpace = THREE.SRGBColorSpace; _shingle.wrapS = _shingle.wrapT = THREE.RepeatWrapping; _shingle.anisotropy = 4;
  return _shingle;
}
// the canopy: in its frame — x along the wall, z out of it, y up, (0, 0, 0) at the wall under its middle;
// parts: anchors (4), brackets (what holds it), glass (the cover: laid on last)
export function canopyMesh(r, U) {
  const G = new THREE.Group(); G.position.set(r.o[0], r.y, r.o[1]); G.rotation.y = Math.atan2(r.nrm[0], r.nrm[1]);
  const W = r.W, P = r.P, style = r.style || 'glass';
  const st = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.22, metalness: 0.95 });
  const blk = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.6 });
  const parts = { anchors: [], brackets: [], glass: new THREE.Group() };
  const B = (o) => { G.add(o); parts.brackets.push(o); return o; };
  const xs = [-(W / 2 - 200), W / 2 - 200];
  // (the anchors: two per bracket, their nuts on the wall plate)
  const anchor = (x, y, m = st) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(MM(11), MM(11), MM(14), 6), m); b.rotation.x = Math.PI / 2; b.position.set(MM(x), MM(y), MM(14)); G.add(b); parts.anchors.push(b); };
  if (style === 'glass') {
    // triplex 8+8 on stainless arms, each held by a tie rod to a plate above, the glass on point fixings
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8ece8, roughness: 0.04, metalness: 0, transmission: 0.7, transparent: true, opacity: 0.38, thickness: MM(17) });
    for (const x of xs) {
      B(bar([x, 0, 0], [x, 0, P - 80], 40, 40, st));
      B(new THREE.Mesh(new THREE.BoxGeometry(MM(100), MM(160), MM(12)), st)).position.set(MM(x), MM(0), MM(6));
      B(new THREE.Mesh(new THREE.BoxGeometry(MM(90), MM(140), MM(12)), st)).position.set(MM(x), MM(560), MM(6));
      B(rod([x, 560, 20], [x, 20, P - 120], 9, st));
      for (const z of [150, P - 200]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(MM(22), MM(22), MM(30), 14), st); f.position.set(MM(x), MM(35), MM(z)); B(f); }
      anchor(x, -40); anchor(x, 600);
    }
    const gl = new THREE.Mesh(new THREE.BoxGeometry(MM(W), MM(17), MM(P)), glass); gl.position.set(0, MM(58), MM(P / 2)); parts.glass.add(gl);
  } else if (style === 'arch') {
    // bronze polycarbonate 8 mm bent over three arched steel ribs, an aluminium edge
    const poly = new THREE.MeshPhysicalMaterial({ color: 0xb88a4e, roughness: 0.25, transmission: 0.35, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
    const H = 420, arc = (t) => [P * Math.sin(t * Math.PI / 2), H * Math.cos(t * Math.PI / 2) - H * 0.15];   // (z, y) along the arch
    for (const x of [...xs, 0]) {
      for (let k = 0; k < 12; k++) { const [z0, y0] = arc(k / 12), [z1, y1] = arc((k + 1) / 12); B(bar([x, y0, Math.max(10, z0)], [x, y1, z1], 30, 30, blk)); }
      B(bar([x, -H * 0.15, 10], [x, -H * 0.15 - 260, 10], 60, 30, blk)); B(rod([x, -H * 0.15 - 240, 20], [x, arc(0.62)[1], arc(0.62)[0]], 10, blk));
      anchor(x, H * 0.7); anchor(x, -H * 0.15 - 200, blk);
    }
    const g = new THREE.PlaneGeometry(MM(W), 1, 1, 24), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const t = 1 - (pos.getY(i) + 0.5), [z, y] = arc(t); pos.setXYZ(i, pos.getX(i), MM(y + 18), MM(z)); }
    g.computeVertexNormals(); parts.glass.add(new THREE.Mesh(g, poly));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(MM(W + 20), MM(30), MM(20)), st); edge.position.set(0, MM(arc(1)[1] + 15), MM(P + 5)); parts.glass.add(edge);
  } else if (style === 'metal') {
    // a single slope of metal tiles (wine red) on a frame of 40 × 40 tubes, two triangle brackets under it
    const red = new THREE.MeshStandardMaterial({ color: 0x6d1f24, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide });
    const drop = 300, slope = Math.atan2(drop, P);
    for (const x of xs) {
      B(bar([x, 0, 0], [x, -drop, P], 40, 40, blk));
      B(bar([x, -drop - 0, 10], [x, -620, 10], 40, 40, blk)); B(bar([x, -600, 15], [x, -drop * 0.6, P * 0.6], 30, 30, blk));
      for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.TorusGeometry(MM(60), MM(8), 6, 16, Math.PI * 1.5), blk); c.rotation.y = Math.PI / 2; c.position.set(MM(x), MM(-420 + k * 60), MM(150 + k * 90)); B(c); }
      anchor(x, -50, blk); anchor(x, -560, blk);
    }
    B(bar([-W / 2, -drop, P], [W / 2, -drop, P], 40, 40, blk)); B(bar([-W / 2, 0, 20], [W / 2, 0, 20], 40, 40, blk));
    const tiles = sheet(W + 100, P / Math.cos(slope) + 100, (x) => 14 * Math.abs(Math.sin(x / 350 * Math.PI)), red, 120, 30, (z) => ((z % 350) + 350) % 350 < 40 ? -18 : 0);
    tiles.rotation.x = slope; tiles.position.set(0, MM(25 - drop / 2), MM(P / 2)); parts.glass.add(tiles);
  } else if (style === 'gable') {
    // two slopes of bitumen shingles on timber rafters, a ridge out from the wall, knee braces under it
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.75 });
    const sh = new THREE.MeshStandardMaterial({ map: shingleTex(), roughness: 0.9, side: THREE.DoubleSide });
    const rise = 450, half = W / 2 + 80, pitch = Math.atan2(rise, half), L = Math.hypot(rise, half);
    for (const x of xs) { B(bar([x, 0, 30], [x, 0, P], 90, 90, wood)); B(bar([x, -650, 40], [x, -650, 100], 90, 140, wood)); B(bar([x, -620, 60], [x, -30, P * 0.62], 70, 70, wood)); anchor(x, -60); anchor(x, -620); }
    B(bar([-half, 0, P], [half, 0, P], 90, 90, wood));
    for (const s of [-1, 1]) {
      B(bar([0, rise, P + 60], [s * half, 0, P + 60], 60, 120, wood)); B(bar([0, rise, 40], [s * half, 0, 40], 60, 120, wood));
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(MM(L + 60), MM(P + 160)), sh); roof.geometry.rotateX(-Math.PI / 2);
      const uv = roof.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L + 60) / 600, uv.getY(i) * (P + 160) / 600);
      roof.rotation.z = s * -pitch; roof.position.set(MM(s * half / 2), MM(rise / 2 + 70), MM(P / 2 + 40)); parts.glass.add(roof);
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(MM(120), MM(40), MM(P + 170)), new THREE.MeshStandardMaterial({ color: 0x4a2c22, roughness: 0.8 })); ridge.position.set(0, MM(rise + 92), MM(P / 2 + 40)); parts.glass.add(ridge);
    // (the gable boards, the front triangle)
    const tri = new THREE.Shape(); tri.moveTo(MM(-half), 0); tri.lineTo(MM(half), 0); tri.lineTo(0, MM(rise)); tri.closePath();
    const gab = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color: 0xb98a56, roughness: 0.8, side: THREE.DoubleSide })); gab.position.set(0, MM(50), MM(P + 70)); parts.glass.add(gab);
  } else {
    // a flat box of composite panels 140 thick, cantilevered on a hidden steel frame; downlights under it
    const pan = new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.35, metalness: 0.4 }), lit = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffd9a0, emissiveIntensity: 0.6 });
    for (const x of xs) { B(bar([x, 40, 0], [x, 40, P - 60], 60, 100, blk)); B(new THREE.Mesh(new THREE.BoxGeometry(MM(140), MM(120), MM(12)), blk)).position.set(MM(x), MM(40), MM(6)); anchor(x, 0, blk); anchor(x, 80, blk); }
    const slab = new THREE.Mesh(new THREE.BoxGeometry(MM(W + 200), MM(140), MM(P)), pan); slab.position.set(0, MM(40), MM(P / 2)); parts.glass.add(slab);
    for (const x of [-W / 4, W / 4]) { const d = new THREE.Mesh(new THREE.CircleGeometry(MM(40), 18), lit); d.rotation.x = Math.PI / 2; d.position.set(MM(x), MM(-31), MM(P * 0.55)); parts.glass.add(d); }
  }
  G.add(parts.glass); parts.glass.userData.y0 = parts.glass.position.y;
  G.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  G.userData.parts = parts;
  void U;
  return G;
}
