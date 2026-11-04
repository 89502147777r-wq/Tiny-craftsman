import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { colTop, axisAt, secOf, castDone } from './columns.js';
import { isSlab } from '../tools/slab.js';
import { toFrame } from '../tools/belt.js';

// The leg of a house on one column dressed as the architects draw it: a glass lift beside the column
// into the house's first floor, and a steel lattice round the column itself.
//
// The lift — a panoramic one, as built: a steel frame (posts 120 × 120, RAL 7016) on a base slab over a
// pit 1,2 m, laminated glass 8+8 between the posts in panes up to 2 m high with transoms, the guide rails
// on the back posts, the landing door at the ground (stainless, two leaves sliding to the side), the shaft
// up to the slab's soffit and on through its opening; the cabin 1100 × 1400 × 2200 — glass on three sides,
// a stainless frame and floor edge, a handrail, a light in its ceiling — at the ground or at the floor,
// riding between (0,6 m/s, eased in and out).
// The lattice: a diagrid of steel tubes Ø60 (two families of helices, 12 each, the rings every 2 m at the
// nodes), 150 off the column's face, white — cladding, it carries nothing.
// A lift: { type: 'lift', col (the column's id), x, z (the shaft's middle), y0 (the ground), y1 (the floor:
// the slab's top), w, d (mm), u: [x, z] (the shaft's front: the way the door looks), at: 0 | 1 (the cabin
// at the ground / at the floor) }.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const LIFT = { w: 1600, d: 1700, post: 120, pane: 2000, cabW: 1100, cabD: 1400, cabH: 2200, speed: 0.6, pit: 1200, gap: 150, lattice: 150 };

let M = null;
function mats() {
  if (M) return M;
  M = {
    frame: new THREE.MeshStandardMaterial({ color: 0x30353a, metalness: 0.55, roughness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.25 }),
    white: new THREE.MeshStandardMaterial({ color: 0xeeefec, metalness: 0.3, roughness: 0.45 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd6ebe6, roughness: 0.03, metalness: 0.05, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x2b2b2c, roughness: 0.7 }),
    light: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 1.2 }),
    conc: new THREE.MeshStandardMaterial({ color: 0x9e9c96, roughness: 0.9 }),
  };
  return M;
}
const boxG = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
function meshes(G, mm) {
  const g = new THREE.Group();
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), mm[k]);
    m.castShadow = k !== 'glass' && k !== 'light'; m.receiveShadow = true;
    if (k === 'glass') m.renderOrder = 2;
    g.add(m);
  }
  return g;
}

// the slab the lift goes up into over (x, z): its top (model units) and whether its opening is there
export function liftStop(objects, x, z, above) {
  let best = null;
  for (const b of objects.all('belt')) {
    if (!isSlab(b) || b.top < above + MM(1500)) continue;
    const [s, t] = toFrame(b, x, z), c = b.c;
    if (s < -c || t < -c || s > (b.ni + 1) * c || t > (b.nj + 1) * c) continue;
    if (!best || b.top < best.top) best = b;
  }
  if (!best) return null;
  const [s, t] = toFrame(best, x, z), c = best.c, i = Math.floor(s / c), j = Math.floor(t / c);
  const open = (best.holes || []).some(([a0, b0, a1, b1]) => i >= a0 && i < a1 && j >= b0 && j < b1);
  return { b: best, top: best.top + best.H, soffit: best.top, open };
}

// the lift beside a column, on the side of p (a world point); → { rec, why }
export function planLift(app, col, p) {
  if (!col || !castDone(col)) return { why: 'Лифт — у залитой колонны' };
  const top = colTop(col), [cx, cz] = axisAt(col, (col.y0 + top) / 2), a = MM(secOf(col).a / 2);
  let ux = p.x - cx, uz = p.z - cz; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
  // (along the main axes of the slab over it: the shaft square to the house)
  if (Math.abs(ux) > Math.abs(uz)) { ux = Math.sign(ux); uz = 0; } else { uz = Math.sign(uz); ux = 0; }
  const off = a + MM(LIFT.lattice + 80 + LIFT.d / 2), x = cx + ux * off, z = cz + uz * off;
  const st = liftStop(app.objects, x, z, col.y0);
  if (!st) return { why: 'Над лифтом должно быть перекрытие — лифт ведёт в первый этаж' };
  if (app.objects.all('lift').some((q) => q.col === col.id)) return { why: 'У этой колонны лифт уже есть' };
  const rec = { type: 'lift', col: col.id, x: +x.toFixed(6), z: +z.toFixed(6), y0: +col.y0.toFixed(6), y1: +st.top.toFixed(6), soffit: +st.soffit.toFixed(6), w: LIFT.w, d: LIFT.d, u: [ux, uz], at: 0 };
  return { rec, why: st.open ? null : 'Сначала проём в перекрытии над лифтом (его делают в опалубке, до бетона) — лифт выйдет в этаж через него', st };
}

// the shaft (world placed): x across the door, z out of it (the door's way), y up from the ground
export function buildLift(r, ghost = null) {
  const mm = ghost === false ? Object.fromEntries(Object.keys(mats()).map((k) => [k, new THREE.MeshBasicMaterial({ color: 0xd04040, transparent: true, opacity: 0.45, depthWrite: false })])) : mats();
  const G = { frame: [], steel: [], glass: [], floor: [], light: [], conc: [], white: [] };
  const W = r.w / 2, D = r.d / 2, P = LIFT.post, H = (r.y1 - r.y0) / S, Hs = (r.soffit - r.y0) / S;
  // the base slab over the pit, flush with the ground
  G.conc.push(boxG(-W - 150, W + 150, -LIFT.pit, 0, -D - 150, D + 150));
  // the posts at the corners, up through the opening to the floor's top
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.frame.push(boxG(sx * W - (sx > 0 ? P : 0), sx * W + (sx < 0 ? P : 0), 0, H, sz * D - (sz > 0 ? P : 0), sz * D + (sz < 0 ? P : 0)));
  // the transoms every pane and at the top under the soffit; the glass between, three sides and the door's side over the door
  const n = Math.max(1, Math.ceil(Hs / LIFT.pane)), ph = Hs / n;
  for (let k = 0; k <= n; k++) {
    const y = Math.min(Hs - 60, k * ph);
    for (const [x0, x1, z0, z1] of [[-W, W, -D, -D + 80], [-W, W, D - 80, D], [-W, -W + 80, -D, D], [W - 80, W, -D, D]]) G.frame.push(boxG(x0, x1, y, y + 60, z0, z1));
  }
  const doorTop = 2300;
  for (let k = 0; k < n; k++) {
    const y0 = k * ph + 60, y1 = (k + 1) * ph;
    G.glass.push(boxG(-W + P, W - P, y0, y1, -D + 30, -D + 46));   // (the back)
    G.glass.push(boxG(-W + 30, -W + 46, y0, y1, -D + P, D - P)); G.glass.push(boxG(W - 46, W - 30, y0, y1, -D + P, D - P));
    if (y1 > doorTop) G.glass.push(boxG(-W + P, W - P, Math.max(y0, doorTop + 60), y1, D - 46, D - 30));   // (the front, over the door)
  }
  // the landing door at the ground: its stainless frame, two glass leaves in stainless frames
  G.steel.push(boxG(-500, 500, doorTop, doorTop + 60, D - 60, D)); G.steel.push(boxG(-560, -500, 0, doorTop + 60, D - 60, D)); G.steel.push(boxG(500, 560, 0, doorTop + 60, D - 60, D));
  for (const [x0, x1] of [[-500, 0], [0, 500]]) { G.steel.push(boxG(x0, x1, 0, 40, D - 50, D - 20)); G.steel.push(boxG(x0, x1, doorTop - 40, doorTop, D - 50, D - 20)); G.glass.push(boxG(x0 + 20, x1 - 20, 40, doorTop - 40, D - 40, D - 30)); }
  // the guide rails on the back (T 89, steel)
  for (const x of [-LIFT.cabW / 2 - 60, LIFT.cabW / 2 + 60]) G.steel.push(boxG(x - 8, x + 8, 0, H, -D + P, -D + P + 70));
  const g = meshes(G, mm);
  // the cabin: its own group, raised by ride()
  const C = { frame: [], steel: [], glass: [], floor: [], light: [] }, cw = LIFT.cabW / 2, cd = LIFT.cabD / 2, ch = LIFT.cabH, zc = 40;
  C.floor.push(boxG(-cw, cw, 0, 60, -cd + zc, cd + zc)); C.steel.push(boxG(-cw - 10, cw + 10, -10, 60, cd + zc - 30, cd + zc));
  C.frame.push(boxG(-cw, cw, ch, ch + 80, -cd + zc, cd + zc));
  C.light.push(boxG(-300, 300, ch - 8, ch, -300 + zc, 300 + zc));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) C.steel.push(boxG(sx * cw - (sx > 0 ? 40 : 0), sx * cw + (sx < 0 ? 40 : 0), 60, ch, sz * cd + zc - (sz > 0 ? 40 : 0), sz * cd + zc + (sz < 0 ? 40 : 0)));
  C.glass.push(boxG(-cw + 40, cw - 40, 60, ch, -cd + zc, -cd + zc + 12)); C.glass.push(boxG(-cw, -cw + 12, 60, ch, -cd + zc + 40, cd + zc - 40)); C.glass.push(boxG(cw - 12, cw, 60, ch, -cd + zc + 40, cd + zc - 40));
  C.steel.push(boxG(-cw + 30, cw - 30, 900, 940, -cd + zc + 30, -cd + zc + 60));   // (the handrail on the back)
  const cab = meshes(C, mm); cab.name = 'cab'; g.add(cab);
  g.userData.cab = cab; g.userData.H = H;
  g.matrixAutoUpdate = false;
  const [ux, uz] = r.u, X = new THREE.Vector3(-uz * S, 0, ux * S);   // (across the door: x; out of it: z = u)
  g.matrix.makeBasis(X, new THREE.Vector3(0, S, 0), new THREE.Vector3(ux * S, 0, uz * S)).setPosition(r.x, r.y0, r.z);
  ride(g, r.at || 0);
  return g;
}
// the cabin at u (0 the ground … 1 the floor)
export function ride(g, u) { const cab = g.userData.cab; if (cab) cab.position.y = Math.max(0, Math.min(1, u)) * g.userData.H; }
// the time of a ride (s: at its speed, a second to start and to stop) and the cabin's place at a share of it
// (eased: it starts and stops softly)
export const rideTime = (r) => (r.y1 - r.y0) / S / 1000 / LIFT.speed + 1;
export const rideEase = (u) => { const e = Math.min(1, Math.max(0, u)); return e * e * (3 - 2 * e); };

// the lattice round a column: a diagrid of tubes (world placed)
export function buildLattice(col) {
  const mm = mats(), sec = secOf(col), R = MM(sec.a / 2 + LIFT.lattice), r = MM(30), y0 = col.y0 + MM(300), y1 = colTop(col) - MM(150);
  const H = y1 - y0, N = 12, turns = H / MM(2000) * 0.5, list = [];
  const at = (u, a) => { const y = y0 + H * u, [x, z] = axisAt(col, y); return new THREE.Vector3(x + Math.cos(a) * R, y, z + Math.sin(a) * R); };
  for (let k = 0; k < N; k++) for (const dir of [1, -1]) {
    const pts = []; for (let q = 0; q <= 48; q++) { const u = q / 48; pts.push(at(u, k / N * Math.PI * 2 + dir * u * turns * Math.PI * 2)); }
    list.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, r, 6, false));
  }
  const nr = Math.max(2, Math.round(H / MM(2000)) + 1);
  for (let q = 0; q < nr; q++) { const y = y0 + H * q / (nr - 1), [x, z] = axisAt(col, y), t = new THREE.TorusGeometry(R, MM(35), 6, 48); t.rotateX(Math.PI / 2); t.translate(x, y, z); list.push(t); }
  // the brackets to the column: short arms at the rings
  for (let q = 0; q < nr; q++) for (let k = 0; k < 4; k++) { const y = y0 + H * q / (nr - 1), [x, z] = axisAt(col, y), a = k * Math.PI / 2, b = new THREE.BoxGeometry(MM(LIFT.lattice + 20), MM(40), MM(40)); b.translate(MM(sec.a / 2 + LIFT.lattice / 2), 0, 0); b.rotateY(-a); b.translate(x, y, z); list.push(b); }
  const m = new THREE.Mesh(mergeGeometries(list.map((g) => g.index ? g.toNonIndexed() : g).map((g) => { g.deleteAttribute('uv'); return g; })), mm.white);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
