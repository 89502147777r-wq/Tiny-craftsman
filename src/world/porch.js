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
export function canopyFor(door) {
  const out = [Math.sin(door.yaw), Math.cos(door.yaw)], along = [out[1], -out[0]], half = (door.t || 300) / 2;
  return { o: [+(door.x + out[0] * MM(half)).toFixed(6), +(door.z + out[1] * MM(half)).toFixed(6)], u: along, nrm: out, y: +(door.y + MM(door.h + PORCH.canopyAbove)).toFixed(6), W: Math.max(1400, door.w + 600), P: PORCH.canopyP };
}
export function canopyMesh(r, U) {
  const G = new THREE.Group(); G.position.set(r.o[0], r.y, r.o[1]); G.rotation.y = Math.atan2(r.nrm[0], r.nrm[1]);
  const st = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfeee9, roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.45, thickness: MM(17) });
  const parts = { anchors: [], brackets: [], glass: null };
  for (const s of [-1, 1]) {
    const a = s * (r.W / 2 - 250);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(MM(80), MM(250), MM(10)), st); plate.position.set(MM(a), MM(250), MM(5)); G.add(plate);
    const p0 = new THREE.Vector3(MM(a), MM(475), MM(10)), p1 = new THREE.Vector3(MM(a), MM(30), MM(r.P - 100));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(MM(12), MM(12), p0.distanceTo(p1), 10), st);
    rod.position.copy(p0).add(p1).multiplyScalar(0.5); rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize()); G.add(rod);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(MM(40), MM(30), MM(r.P - 60)), st); arm.position.set(MM(a), MM(15), MM((r.P - 60) / 2)); G.add(arm);
    parts.brackets.push(plate, rod, arm);
    for (const y of [120, 380]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(MM(9), MM(9), MM(16), 8), st); b.rotation.x = Math.PI / 2; b.position.set(MM(a), MM(y), MM(14)); G.add(b); parts.anchors.push(b); }
  }
  const gl = new THREE.Mesh(new THREE.BoxGeometry(MM(r.W), MM(17.5), MM(r.P)), glass); gl.position.set(0, MM(30 + 9), MM(r.P / 2)); G.add(gl); parts.glass = gl;
  G.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  G.userData.parts = parts;
  void U;
  return G;
}
