import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { isSlab } from '../tools/slab.js';
import { toFrame } from '../tools/belt.js';

// A panoramic glass lift standing on its own on the ground — and in the villa film the only thing the house
// stands on (the owner: «without a leg — the point is that it must not hold»; it does not, and it falls).
//
// As one is built (the look checked by the realist): a steel frame (posts 120 × 120, RAL 7016) on its pit
// 1,2 m (tanked — the pool is near; a ladder), laminated glass 8+8 between the posts in panes up to 2 m with
// transoms; a landing door at the ground and at each floor (stainless, two glass leaves); a hydraulic drive
// (the cylinder in the pit behind the cabin, its ram and a sheave lifting the cabin 2:1 on ropes — no machine
// room; the pump cabinet outside by the lower door); the cabin 1100 × 1400 × 2200 — glass on three sides, a
// stainless frame and floor edge, a handrail, a light. Its top (`top`) carries what is on it: a slab laid
// over it rests on steel bearing plates on the posts, an opening in it over the shaft (slab.js: `liftHole`);
// the shaft goes on up through the opening into the floors, a stop at each slab with its opening over the
// shaft, the headroom (the cabin + 1,2 m) over the top stop and the shaft's roof with vent grilles on it.
// A lift: { type: 'lift', x, z (the shaft's middle), y0 (the ground), top (the shaft's top: what it carries
// lies on it), w, d (mm), u: [x, z] (its front: the way the doors look), at: the stop the cabin is at (0 the
// ground) }.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const LIFT = { w: 1600, d: 1700, post: 120, pane: 2000, cabW: 1100, cabD: 1400, cabH: 2200, speed: 0.6, pit: 1200, head: 3400, joint: 50, door: 2300, plate: 20 };

let M = null;
function mats() {
  if (M) return M;
  M = {
    // (powder-coated steel: paint — no metallic sheen; the stainless: metal)
    frame: new THREE.MeshStandardMaterial({ color: 0x383d42, metalness: 0, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.25 }),
    glass: fresnelGlass(new THREE.MeshPhysicalMaterial({ color: 0xd6ebe6, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 })),
    edge: new THREE.MeshStandardMaterial({ color: 0x5f8f7c, roughness: 0.15, transparent: true, opacity: 0.85 }),
    epdm: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.85 }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0xc5c7c4, metalness: 0, roughness: 0.55 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x2b2b2c, roughness: 0.7 }),
    light: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 1.2 }),
    conc: new THREE.MeshStandardMaterial({ color: 0x9e9c96, roughness: 0.9 }),
  };
  return M;
}
export const liftMats = mats;
// glass as it is seen: nearly clear face on, a mirror at a grazing angle (Fresnel — Schlick, n 1,5)
export function fresnelGlass(m) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float cv = abs(dot(normalize(normal), normalize(vViewPosition)));
      float fr = 0.04 + 0.96 * pow(1.0 - cv, 5.0);
      diffuseColor.a = clamp(mix(0.1, 0.85, fr * 1.4), 0.0, 0.9);
    }
    #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'fresnelGlass';
  return m;
}
const boxG = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
function meshes(G, mm) {
  const g = new THREE.Group();
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), mm[k]);
    m.castShadow = k !== 'glass' && k !== 'light'; m.receiveShadow = true;
    if (k === 'glass') m.renderOrder = 2;
    m.name = k;
    g.add(m);
  }
  return g;
}

// the slabs over the lift with their opening over it, from the bottom: [top, soffit] (model units) — its stops
export function liftStops(objects, r) {
  const out = [];
  for (const b of objects.all('belt')) {
    if (!isSlab(b) || !(b.fill > 0.5) || b.top < r.top - MM(30)) continue;
    const [s, t] = toFrame(b, r.x, r.z), c = b.c, i = Math.floor(s / c), j = Math.floor(t / c);
    if (s < 0 || t < 0 || s > b.ni * c || t > b.nj * c) continue;
    if (!(b.holes || []).some(([a0, b0, a1, b1]) => i >= a0 && i < a1 && j >= b0 && j < b1)) continue;
    out.push([b.top + b.H, b.top]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// a lift on the ground at p (a world point), its top h (model units) over it, its doors toward `face` →
// { rec, why }
export function planLift(app, p, h, face) {
  const t = app.terrain;
  if (!t.inside(p.x, p.z)) return { why: 'За краем участка' };
  if (h < MM(LIFT.cabH + 600)) return { why: `Шахта ниже ${(LIFT.cabH + 600) / 1000} м — кабине не встать` };
  const near = app.objects.all('lift').find((q) => Math.hypot(q.x - p.x, q.z - p.z) < MM(LIFT.d + 200));
  if (near) return { why: 'Здесь уже стоит лифт', near };
  // (square to the plot: the doors on the side toward `face` — the camera)
  let ux = face.x - p.x, uz = face.z - p.z; if (Math.abs(ux) > Math.abs(uz)) { ux = Math.sign(ux) || 1; uz = 0; } else { uz = Math.sign(uz) || 1; ux = 0; }
  const y0 = t.heightAt(p.x, p.z);
  return { rec: { type: 'lift', x: +p.x.toFixed(6), z: +p.z.toFixed(6), y0: +y0.toFixed(6), top: +(y0 + h).toFixed(6), w: LIFT.w, d: LIFT.d, u: [ux, uz], at: 0 }, why: null };
}
// the lift under a point (in its footprint)
export function liftAt(objects, x, z, pad = 100) {
  return objects.all('lift').find((r) => { const [ux, uz] = r.u, dx = x - r.x, dz = z - r.z, a = Math.abs(dx * ux + dz * uz), b = Math.abs(-dx * uz + dz * ux); return a < MM(r.d / 2 + pad) && b < MM(r.w / 2 + pad); }) || null;
}

// the shaft (world placed): x across the door, z out of it (the door's way), y up from the ground; objects:
// the store (its stops — the slabs over it with their opening)
export function buildLift(r, objects, ghost = null) {
  const mm = ghost === false ? Object.fromEntries(Object.keys(mats()).map((k) => [k, new THREE.MeshBasicMaterial({ color: 0xd04040, transparent: true, opacity: 0.45, depthWrite: false })])) : mats();
  const G = { frame: [], steel: [], glass: [], floor: [], light: [], conc: [], edge: [], epdm: [], cabinet: [] }, panes = [];
  const W = r.w / 2, D = r.d / 2, P = LIFT.post, J = LIFT.joint, dT = LIFT.door;
  const stops = (objects ? liftStops(objects, r) : []).map(([t, so]) => [(t - r.y0) / S, (so - r.y0) / S]);
  const Top = (r.top - r.y0) / S, H = stops.length ? stops.at(-1)[0] : 0, Ht = stops.length ? H + LIFT.head : Top;
  // the pit: its floor and walls under the ground, the membrane outside, a ladder
  G.conc.push(boxG(-W - 200, W + 200, -LIFT.pit - 250, -LIFT.pit, -D - 200, D + 200));
  for (const [x0, x1, z0, z1] of [[-W - 200, -W, -D - 200, D + 200], [W, W + 200, -D - 200, D + 200], [-W, W, -D - 200, -D], [-W, W, D, D + 200]]) G.conc.push(boxG(x0, x1, -LIFT.pit, 0, z0, z1));
  for (let y = -LIFT.pit + 200; y < 0; y += 300) G.steel.push(boxG(W - 420, W - 120, y, y + 20, D - 60, D - 40));
  // the posts at the corners, up to the top (and on through the slab's opening, over the top stop by the headroom)
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.frame.push(boxG(sx * W - (sx > 0 ? P : 0), sx * W + (sx < 0 ? P : 0), 0, Ht, sz * D - (sz > 0 ? P : 0), sz * D + (sz < 0 ? P : 0)));
  // the transoms, the glass between (each pane kept: they crack and burst one by one)
  const glassIn = (y0, y1, front) => {
    const n = Math.max(1, Math.ceil((y1 - y0) / LIFT.pane)), ph = (y1 - y0) / n;
    for (let k = 0; k <= n; k++) { const y = Math.min(y1 - 60, y0 + k * ph); for (const [x0, x1, z0, z1] of [[-W, W, -D, -D + 80], [-W, W, D - 80, D], [-W, -W + 80, -D, D], [W - 80, W, -D, D]]) G.frame.push(boxG(x0, x1, y, y + 60, z0, z1)); }
    for (let k = 0; k < n; k++) {
      const a = y0 + k * ph + 60, b = y0 + (k + 1) * ph;
      panes.push(['back', -W + P, W - P, a, b, -D + 30, -D + 46], ['left', -W + 30, -W + 46, a, b, -D + P, D - P], ['right', W - 46, W - 30, a, b, -D + P, D - P]);
      if (b > front) panes.push(['front', -W + P, W - P, Math.max(a, front + 60), b, D - 46, D - 30]);
    }
  };
  glassIn(0, stops.length ? stops[0][1] - LIFT.plate : Top - LIFT.plate, dT);
  stops.forEach(([t], k) => glassIn(t, k + 1 < stops.length ? stops[k + 1][1] - J : Ht - 200, t + dT));
  // each pane: the glass, its green edge (8+8: 17 mm of float seen end on), the black EPDM round it and the
  // pressure plates 50 × 12 over its edges outside (screwed every 300)
  for (const q of panes) {
    const [side, x0, x1, y0, y1, z0, z1] = q; G.glass.push(boxG(x0, x1, y0, y1, z0, z1));
    // (the pane's outside: its normal — back −z, front +z, left −x, right +x)
    const along = side === 'back' || side === 'front', out = side === 'back' || side === 'left' ? -1 : 1;
    if (along) {
      G.edge.push(boxG(x0, x1, y0, y0 + 4, z0, z1), boxG(x0, x1, y1 - 4, y1, z0, z1), boxG(x0, x0 + 4, y0, y1, z0, z1), boxG(x1 - 4, x1, y0, y1, z0, z1));
      const zA = out < 0 ? z0 - 12 : z1, zB = zA + 12, zi = out < 0 ? z1 : z0 - 10;
      G.frame.push(boxG(x0 - 25, x0 + 25, y0, y1, zA, zB), boxG(x1 - 25, x1 + 25, y0, y1, zA, zB), boxG(x0, x1, y0 - 25, y0 + 25, zA, zB), boxG(x0, x1, y1 - 25, y1 + 25, zA, zB));
      G.epdm.push(boxG(x0 - 5, x0 + 10, y0, y1, zi, zi + 10), boxG(x1 - 10, x1 + 5, y0, y1, zi, zi + 10), boxG(x0, x1, y0 - 5, y0 + 10, zi, zi + 10), boxG(x0, x1, y1 - 10, y1 + 5, zi, zi + 10));
    } else {
      G.edge.push(boxG(x0, x1, y0, y0 + 4, z0, z1), boxG(x0, x1, y1 - 4, y1, z0, z1), boxG(x0, x1, y0, y1, z0, z0 + 4), boxG(x0, x1, y0, y1, z1 - 4, z1));
      const xA = out < 0 ? x0 - 12 : x1, xB = xA + 12, xi = out < 0 ? x1 : x0 - 10;
      G.frame.push(boxG(xA, xB, y0, y1, z0 - 25, z0 + 25), boxG(xA, xB, y0, y1, z1 - 25, z1 + 25), boxG(xA, xB, y0 - 25, y0 + 25, z0, z1), boxG(xA, xB, y1 - 25, y1 + 25, z0, z1));
      G.epdm.push(boxG(xi, xi + 10, y0, y1, z0 - 5, z0 + 10), boxG(xi, xi + 10, y0, y1, z1 - 10, z1 + 5), boxG(xi, xi + 10, y0 - 5, y0 + 10, z0, z1), boxG(xi, xi + 10, y1 - 10, y1 + 5, z0, z1));
    }
  }
  // the bearing plates on the posts' heads (what it carries lies on them); the joint brackets at the slabs over
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.steel.push(boxG(sx * W - 130, sx * W + 130, (stops[0]?.[1] ?? Top) - LIFT.plate, stops[0]?.[1] ?? Top, sz * D - 130, sz * D + 130));
  // the landing doors: at the ground and at each stop
  for (const y0 of [0, ...stops.map((q) => q[0])]) {
    G.steel.push(boxG(-500, 500, y0 + dT, y0 + dT + 60, D - 60, D)); G.steel.push(boxG(-560, -500, y0, y0 + dT + 60, D - 60, D)); G.steel.push(boxG(500, 560, y0, y0 + dT + 60, D - 60, D));
    for (const [x0, x1] of [[-500, 0], [0, 500]]) { G.steel.push(boxG(x0, x1, y0, y0 + 40, D - 50, D - 20)); G.steel.push(boxG(x0, x1, y0 + dT - 40, y0 + dT, D - 50, D - 20)); G.glass.push(boxG(x0 + 20, x1 - 20, y0 + 40, y0 + dT - 40, D - 40, D - 30)); }
  }
  // the shaft's roof: a steel deck (with nothing on it, or over the top stop's headroom), the vent grilles
  G.frame.push(boxG(-W - 40, W + 40, Ht - 200, Ht, -D - 40, D + 40));
  if (stops.length) for (const [z0, z1] of [[-D - 46, -D - 40], [D + 40, D + 46]]) for (let y = Ht - 180; y < Ht - 20; y += 30) G.steel.push(boxG(-W + 150, W - 150, y, y + 12, z0, z1));
  // the guide rails on the back (T 89), the hydraulic cylinder in the pit behind the cabin, the pump cabinet outside by the door
  const run = Math.max(H, Top * 0.5);
  for (const x of [-LIFT.cabW / 2 - 60, LIFT.cabW / 2 + 60]) G.steel.push(boxG(x - 8, x + 8, -LIFT.pit + 100, Ht - 300, -D + P, -D + P + 70));
  const cyl = new THREE.CylinderGeometry(70, 70, LIFT.pit + run / 2, 20); cyl.translate(0, (LIFT.pit + run / 2) / 2 - LIFT.pit, -D + P + 120); G.frame.push(cyl);
  G.cabinet.push(boxG(W + 120, W + 720, 0, 1800, D - 600, D)); G.steel.push(boxG(W + 140, W + 700, 1500, 1520, D + 1, D + 4));   // (the pump cabinet: RAL 7035)
  const g = meshes(G, mm);
  // the ram and its sheave (rising half the cabin's way), the ropes from the sheave down to the cabin's sling
  // (the ropes: three Ø12, 40 apart)
  const ram = new THREE.Mesh(new THREE.CylinderGeometry(45, 45, 1, 16), mm.steel), shv = new THREE.Mesh(new THREE.CylinderGeometry(160, 160, 60, 24), mm.frame);
  const rg = mergeGeometries([-40, 0, 40].map((x) => new THREE.CylinderGeometry(6, 6, 1, 6).translate(x, 0, 0))), ropes = new THREE.Mesh(rg, mm.steel);
  shv.rotation.z = Math.PI / 2; for (const m of [ram, shv, ropes]) { m.castShadow = true; g.add(m); }
  g.userData.hyd = { ram, shv, ropes, y0: run / 2, z: -D + P + 120 };
  // the cabin: its own group, moved by ride()
  const C = { frame: [], steel: [], glass: [], floor: [], light: [] }, cw = LIFT.cabW / 2, cd = LIFT.cabD / 2, ch = LIFT.cabH, zc = 40;
  C.floor.push(boxG(-cw, cw, 0, 60, -cd + zc, cd + zc)); C.steel.push(boxG(-cw - 10, cw + 10, -10, 60, cd + zc - 30, cd + zc));
  C.steel.push(boxG(-cw, cw, -750, -10, cd + zc - 8, cd + zc - 4));   // (the toe guard under the sill, 750)
  C.frame.push(boxG(-cw, cw, ch, ch + 80, -cd + zc, cd + zc));
  C.light.push(boxG(-300, 300, ch - 8, ch, -300 + zc, 300 + zc));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) C.steel.push(boxG(sx * cw - (sx > 0 ? 40 : 0), sx * cw + (sx < 0 ? 40 : 0), 60, ch, sz * cd + zc - (sz > 0 ? 40 : 0), sz * cd + zc + (sz < 0 ? 40 : 0)));
  C.glass.push(boxG(-cw + 40, cw - 40, 60, ch, -cd + zc, -cd + zc + 12)); C.glass.push(boxG(-cw, -cw + 12, 60, ch, -cd + zc + 40, cd + zc - 40)); C.glass.push(boxG(cw - 12, cw, 60, ch, -cd + zc + 40, cd + zc - 40));
  C.steel.push(boxG(-cw + 30, cw - 30, 900, 940, -cd + zc + 30, -cd + zc + 60));   // (the handrail on the back)
  const cab = meshes(C, mm); cab.name = 'cab'; g.add(cab);
  g.userData.cab = cab; g.userData.ys = [0, ...stops.map((q) => q[0])]; g.userData.panes = panes; g.userData.top = Ht;
  g.matrixAutoUpdate = false;
  const [ux, uz] = r.u, X = new THREE.Vector3(-uz * S, 0, ux * S);   // (across the door: x; out of it: z = u)
  g.matrix.makeBasis(X, new THREE.Vector3(0, S, 0), new THREE.Vector3(ux * S, 0, uz * S)).setPosition(r.x, r.y0, r.z);
  ride(g, r.at || 0);
  return g;
}
// the cabin at stop u (0 the ground, 1 the first stop…; between: on its way)
export function ride(g, u) {
  const ys = g.userData.ys || [0], k = Math.max(0, Math.min(ys.length - 1, u)), i = Math.max(0, Math.min(ys.length - 2, Math.floor(k))), y = ys.length > 1 ? ys[i] + (ys[i + 1] - ys[i]) * (k - i) : 0, cab = g.userData.cab;
  if (cab) cab.position.y = y;
  // (2:1: the ram's head at half the cabin's rise over the cylinder; the ropes from it down to the sling under the cabin)
  const h = g.userData.hyd; if (!h) return;
  const top = h.y0 + y / 2 + 300;
  h.ram.scale.set(1, top - h.y0, 1); h.ram.position.set(0, (h.y0 + top) / 2, h.z);
  h.shv.position.set(0, top + 160, h.z);
  const r0 = y + 60, r1 = top + 160; h.ropes.scale.set(1, Math.max(10, r1 - r0), 1); h.ropes.position.set(0, (r0 + r1) / 2, h.z + 160);
}
// the stops' heights (model, world y): 0 the ground
export const stopY = (objects, r, k) => (k <= 0 ? r.y0 : (liftStops(objects, r)[k - 1]?.[0] ?? r.y0));
// the time of a ride (s: at its speed, a second to start and to stop); eased in and out
export const rideTime = (objects, r, from = 0, to = 1) => Math.abs(stopY(objects, r, to) - stopY(objects, r, from)) / S / 1000 / LIFT.speed + 1;
export const rideEase = (u) => { const e = Math.min(1, Math.max(0, u)); return e * e * (3 - 2 * e); };
