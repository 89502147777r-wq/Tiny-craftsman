import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { colTop, axisAt, secOf, castDone } from './columns.js';
import { isSlab } from '../tools/slab.js';
import { toFrame, toWorld } from '../tools/belt.js';
import { FASCIA } from './railing.js';

// The leg of a house on one column dressed as the architects draw it: a glass lift beside the column
// into the house's first floor, and a steel lattice round the column itself.
//
// The lift — a panoramic one, as built (EN 81-20; the realist's check of build 273): a steel frame (posts
// 120 × 120, RAL 7016) on its pit 1,2 m (sunk in the raft, tanked — a pool is near), laminated glass 8+8
// between the posts in panes up to 2 m with transoms; the shaft through the slab's opening — the opening at
// least 6d off the column's face (EC2 6.4.2: no hole in the punching zone of the only support), framed
// by downstand beams — and on over the floor by the headroom (the cabin + 1,2 m) to its roof with vent
// grilles (a glass shaft heats up); a landing door at each stop; at the slab a movement joint 50 mm with
// slotted brackets (the cantilever deflects 20 mm and creeps — the shaft must not carry it), the shaft
// tied back to the column every ≤ 2,5 m through the lattice (the wind on the glass); a hydraulic drive
// (two stops at 0,6 m/s: the cylinder in the pit behind the cabin, its ram and a sheave lifting the cabin
// 2:1 on ropes — no machine room; the pump cabinet by the lower door); the cabin 1100 × 1400 × 2200 —
// glass on three sides, a stainless frame and floor edge, a handrail, a light — riding between the stops.
// The lattice: a diagrid of steel tubes Ø60 (two families of helices, 12 each, the rings every 2 m at the
// nodes), 150 off the column's face, white — cladding, it carries nothing.
// A lift: { type: 'lift', col (the column's id), x, z (the shaft's middle), y0 (the ground), stops: [[top,
// soffit] of each slab it stops on, from the bottom], y1 (the top stop), w, d (mm), u: [x, z] (the shaft's
// front: the way the door looks), at: the stop the cabin is at (0 the ground), tie (mm), clear (mm) }. It
// stops on every slab with its opening over the shaft — the roof's too (the roof terrace); the headroom
// over the top stop goes up through the roof (the lift's overrun box on it).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const LIFT = { w: 1600, d: 1700, post: 120, pane: 2000, cabW: 1100, cabD: 1400, cabH: 2200, speed: 0.6, pit: 1200, gap: 150, lattice: 150, head: 3400, joint: 50, beam: [300, 400], tie: 2500, door: 2300 };

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

// the slabs over (x, z) from the bottom: { b, top, soffit, open (its opening over the point) }
export function slabsOver(objects, x, z, above) {
  const out = [];
  for (const b of objects.all('belt')) {
    if (!isSlab(b) || b.top < above + MM(1500)) continue;
    const [s, t] = toFrame(b, x, z), c = b.c;
    if (s < 0 || t < 0 || s > b.ni * c || t > b.nj * c) continue;
    const i = Math.floor(s / c), j = Math.floor(t / c), open = (b.holes || []).some(([a0, b0, a1, b1]) => i >= a0 && i < a1 && j >= b0 && j < b1);
    out.push({ b, top: b.top + b.H, soffit: b.top, open });
  }
  return out.sort((a, b) => a.top - b.top);
}
export const liftStop = (objects, x, z, above) => slabsOver(objects, x, z, above)[0] || null;

// the lift for a house on a column, on the side of p (a world point) → { rec, why }. Not through the slabs by
// the column: an opening in a flat slab is kept 6d off its only support's face (EC2 6.4.2: the punching zone)
// — on a house this size that is past its cantilevers' edge. So a panoramic lift outside, along the facade
// on that side, as they are built: its own frame on its pit, a door into each floor, 50 mm off the slabs'
// fascias with slotted brackets at each (the cantilever deflects and creeps — the shaft carries nothing of it).
export function planLift(app, col, p) {
  if (!col || !castDone(col)) return { why: 'Лифт — у залитой колонны' };
  const top = colTop(col), [cx, cz] = axisAt(col, top);
  if (app.objects.all('lift').some((q) => q.col === col.id)) return { why: 'У этой колонны лифт уже есть' };
  const house = slabsOver(app.objects, cx, cz, col.y0);
  if (!house.length) return { why: 'Над колонной должно быть перекрытие — лифт ведёт в этажи' };
  const b0 = house[0].b, [sc, tc] = toFrame(b0, cx, cz), [ps, pt] = toFrame(b0, p.x, p.z);
  const cl = b0.clip || [0, 0, b0.ni * b0.c, b0.nj * b0.c];
  // (the side: the slab's edge nearest the touch, square to it)
  let ds = ps - sc, dt = pt - tc; if (Math.abs(ds) > Math.abs(dt)) { ds = Math.sign(ds); dt = 0; } else { dt = Math.sign(dt); ds = 0; }
  const edgeOf = (b) => { const c = b.clip || [0, 0, b.ni * b.c, b.nj * b.c]; return ds > 0 ? c[2] : ds < 0 ? c[0] : dt > 0 ? c[3] : c[1]; };
  const e = edgeOf(b0), out = MM(FASCIA.gap + FASCIA.t + LIFT.joint + LIFT.d / 2);
  const fs = ds ? e + ds * out : sc, ft = dt ? e + dt * out : tc;
  const [x, z] = toWorld(b0, fs, ft);
  // (the stops: the house's floors whose edge on that side is there — each slab, from the bottom)
  const stops = house.filter((q) => Math.abs(edgeOf(q.b) - e) < MM(300)).map((q) => [+q.top.toFixed(6), +q.soffit.toFixed(6)]);
  const o0 = toWorld(b0, 0, 0), o1 = toWorld(b0, ds, dt), L = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]) || 1, ux = -(o1[0] - o0[0]) / L, uz = -(o1[1] - o0[1]) / L;   // (the doors look into the house)
  const y0 = app.terrain?.inside?.(x, z) ? app.terrain.heightAt(x, z) : col.y0;
  const rec = { type: 'lift', col: col.id, x: +x.toFixed(6), z: +z.toFixed(6), y0: +y0.toFixed(6), stops, y1: stops.at(-1)[0], soffit: stops.at(-1)[1], w: LIFT.w, d: LIFT.d, u: [+ux.toFixed(5), +uz.toFixed(5)], at: 0, out: 1,
    clear: Math.round(Math.hypot(x - cx, z - cz) / MM(1) - secOf(col).a / 2 - LIFT.d / 2) };
  return { rec, why: null };
}

// the shaft (world placed): x across the door, z out of it (the door's way), y up from the ground
export function buildLift(r, ghost = null) {
  const mm = ghost === false ? Object.fromEntries(Object.keys(mats()).map((k) => [k, new THREE.MeshBasicMaterial({ color: 0xd04040, transparent: true, opacity: 0.45, depthWrite: false })])) : mats();
  const G = { frame: [], steel: [], glass: [], floor: [], light: [], conc: [], white: [] };
  const W = r.w / 2, D = r.d / 2, P = LIFT.post, J = LIFT.joint, dT = LIFT.door;
  const stops = (r.stops?.length ? r.stops : [[r.y1, r.soffit]]).map(([t, so]) => [(t - r.y0) / S, (so - r.y0) / S]);
  const H = stops.at(-1)[0], Hs = stops[0][1], Ht = H + LIFT.head;
  // the pit: its floor and walls under the ground (tanked: the dark of the membrane outside), a ladder
  G.conc.push(boxG(-W - 200, W + 200, -LIFT.pit - 250, -LIFT.pit, -D - 200, D + 200));
  for (const [x0, x1, z0, z1] of [[-W - 200, -W, -D - 200, D + 200], [W, W + 200, -D - 200, D + 200], [-W, W, -D - 200, -D], [-W, W, D, D + 200]]) G.conc.push(boxG(x0, x1, -LIFT.pit, 0, z0, z1));
  G.floor.push(boxG(-W - 210, W + 210, -LIFT.pit - 250, -40, -D - 210, -D - 200));
  for (let y = -LIFT.pit + 200; y < 0; y += 300) G.steel.push(boxG(W - 420, W - 120, y, y + 20, D - 60, D - 40));
  // the posts at the corners, up through the opening and on over the floor by the headroom
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.frame.push(boxG(sx * W - (sx > 0 ? P : 0), sx * W + (sx < 0 ? P : 0), 0, Ht, sz * D - (sz > 0 ? P : 0), sz * D + (sz < 0 ? P : 0)));
  // the transoms, the glass between: up to the joint under the slab, then from the floor to the roof
  const glassIn = (y0, y1, front) => {
    const n = Math.max(1, Math.ceil((y1 - y0) / LIFT.pane)), ph = (y1 - y0) / n;
    for (let k = 0; k <= n; k++) { const y = Math.min(y1 - 60, y0 + k * ph); for (const [x0, x1, z0, z1] of [[-W, W, -D, -D + 80], [-W, W, D - 80, D], [-W, -W + 80, -D, D], [W - 80, W, -D, D]]) G.frame.push(boxG(x0, x1, y, y + 60, z0, z1)); }
    for (let k = 0; k < n; k++) {
      const a = y0 + k * ph + 60, b = y0 + (k + 1) * ph;
      G.glass.push(boxG(-W + P, W - P, a, b, -D + 30, -D + 46));
      G.glass.push(boxG(-W + 30, -W + 46, a, b, -D + P, D - P)); G.glass.push(boxG(W - 46, W - 30, a, b, -D + P, D - P));
      if (b > front) G.glass.push(boxG(-W + P, W - P, Math.max(a, front + 60), b, D - 46, D - 30));
    }
  };
  // (the glass from each stop up to the joint under the next slab; over the top stop up to the roof of the shaft)
  glassIn(0, Hs - J, dT);
  stops.forEach(([t], k) => glassIn(t, k + 1 < stops.length ? stops[k + 1][1] - J : Ht - 200, t + dT));
  // the landing doors: at the ground and at each stop (a stainless frame, two glass leaves)
  for (const y0 of [0, ...stops.map((q) => q[0])]) {
    G.steel.push(boxG(-500, 500, y0 + dT, y0 + dT + 60, D - 60, D)); G.steel.push(boxG(-560, -500, y0, y0 + dT + 60, D - 60, D)); G.steel.push(boxG(500, 560, y0, y0 + dT + 60, D - 60, D));
    for (const [x0, x1] of [[-500, 0], [0, 500]]) { G.steel.push(boxG(x0, x1, y0, y0 + 40, D - 50, D - 20)); G.steel.push(boxG(x0, x1, y0 + dT - 40, y0 + dT, D - 50, D - 20)); G.glass.push(boxG(x0 + 20, x1 - 20, y0 + 40, y0 + dT - 40, D - 40, D - 30)); }
  }
  // the shaft's roof: a steel deck, the vent grilles along its sides
  G.frame.push(boxG(-W - 40, W + 40, Ht - 200, Ht, -D - 40, D + 40));
  for (const [x0, x1, z0, z1] of [[-W + 150, W - 150, -D - 46, -D - 40], [-W + 150, W - 150, D + 40, D + 46]]) for (let y = Ht - 180; y < Ht - 20; y += 30) G.steel.push(boxG(x0, x1, y, y + 12, z0, z1));
  // at each slab: the joint — slotted angle brackets from the front posts to the slab's face through the fascia
  // (free up and down); through an opening (r.out unset — an old lift): the framing beams round it too
  const [bw, bh] = LIFT.beam, o = J, reach = J + FASCIA.gap + FASCIA.t;
  if (r.out) for (const [, so] of stops) for (const x of [-W + 60, W - 60]) { G.steel.push(boxG(x - 40, x + 40, so + 60, so + 180, D, D + reach)); G.steel.push(boxG(x - 90, x + 90, so + 40, so + 200, D + reach - 12, D + reach)); }
  else for (const [, so] of stops) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.steel.push(boxG(sx * W - 40 + (sx > 0 ? 0 : -J), sx * W + 40 + (sx > 0 ? J : 0), so - 140, so - 20, sz * D - 40, sz * D + 40));
    G.conc.push(boxG(-W - o - bw, W + o + bw, so - bh, so, -D - o - bw, -D - o)); G.conc.push(boxG(-W - o - bw, W + o + bw, so - bh, so, D + o, D + o + bw));
    G.conc.push(boxG(-W - o - bw, -W - o, so - bh, so, -D - o, D + o)); G.conc.push(boxG(W + o, W + o + bw, so - bh, so, -D - o, D + o));
  }
  // the ties to the column every ≤ 2,5 m (two tubes Ø76 from the back posts to plates on its face)
  if (!r.out && r.tie > 0) { const nt = Math.max(1, Math.ceil(Hs / LIFT.tie) - 1); for (let k = 1; k <= nt; k++) { const y = Hs * k / (nt + 1); for (const x of [-W + 60, W - 60]) { G.frame.push(boxG(x - 38, x + 38, y - 38, y + 38, -D - r.tie, -D)); G.frame.push(boxG(x - 90, x + 90, y - 90, y + 90, -D - r.tie, -D - r.tie + 15)); } } }
  // the guide rails on the back (T 89), the hydraulic cylinder in the pit behind the cabin, the pump cabinet outside by the door
  for (const x of [-LIFT.cabW / 2 - 60, LIFT.cabW / 2 + 60]) G.steel.push(boxG(x - 8, x + 8, -LIFT.pit + 100, Ht - 300, -D + P, -D + P + 70));
  const cyl = new THREE.CylinderGeometry(70, 70, LIFT.pit + H / 2, 20); cyl.translate(0, (LIFT.pit + H / 2) / 2 - LIFT.pit, -D + P + 120); G.frame.push(cyl);
  G.frame.push(boxG(W + 120, W + 720, 0, 1800, D - 600, D)); G.steel.push(boxG(W + 140, W + 700, 1500, 1520, D + 1, D + 4));
  const g = meshes(G, mm);
  // the ram and its sheave (rise half the cabin's way), the ropes from the pit over the sheave down to the cabin's sling
  const ram = new THREE.Mesh(new THREE.CylinderGeometry(45, 45, 1, 16), mm.steel), shv = new THREE.Mesh(new THREE.CylinderGeometry(160, 160, 60, 24), mm.frame), ropes = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mm.frame);
  shv.rotation.z = Math.PI / 2; for (const m of [ram, shv, ropes]) { m.castShadow = true; g.add(m); }
  g.userData.hyd = { ram, shv, ropes, y0: H / 2 - 0, z: -D + P + 120 };
  // the cabin: its own group, raised by ride()
  const C = { frame: [], steel: [], glass: [], floor: [], light: [] }, cw = LIFT.cabW / 2, cd = LIFT.cabD / 2, ch = LIFT.cabH, zc = 40;
  C.floor.push(boxG(-cw, cw, 0, 60, -cd + zc, cd + zc)); C.steel.push(boxG(-cw - 10, cw + 10, -10, 60, cd + zc - 30, cd + zc));
  C.frame.push(boxG(-cw, cw, ch, ch + 80, -cd + zc, cd + zc));
  C.light.push(boxG(-300, 300, ch - 8, ch, -300 + zc, 300 + zc));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) C.steel.push(boxG(sx * cw - (sx > 0 ? 40 : 0), sx * cw + (sx < 0 ? 40 : 0), 60, ch, sz * cd + zc - (sz > 0 ? 40 : 0), sz * cd + zc + (sz < 0 ? 40 : 0)));
  C.glass.push(boxG(-cw + 40, cw - 40, 60, ch, -cd + zc, -cd + zc + 12)); C.glass.push(boxG(-cw, -cw + 12, 60, ch, -cd + zc + 40, cd + zc - 40)); C.glass.push(boxG(cw - 12, cw, 60, ch, -cd + zc + 40, cd + zc - 40));
  C.steel.push(boxG(-cw + 30, cw - 30, 900, 940, -cd + zc + 30, -cd + zc + 60));   // (the handrail on the back)
  const cab = meshes(C, mm); cab.name = 'cab'; g.add(cab);
  g.userData.cab = cab; g.userData.H = H; g.userData.ys = [0, ...stops.map((q) => q[0])];
  g.matrixAutoUpdate = false;
  const [ux, uz] = r.u, X = new THREE.Vector3(-uz * S, 0, ux * S);   // (across the door: x; out of it: z = u)
  g.matrix.makeBasis(X, new THREE.Vector3(0, S, 0), new THREE.Vector3(ux * S, 0, uz * S)).setPosition(r.x, r.y0, r.z);
  ride(g, r.at || 0);
  return g;
}
// the cabin at stop u (0 the ground, 1 the first floor…; between: on its way)
export function ride(g, u) {
  const ys = g.userData.ys || [0, g.userData.H], k = Math.max(0, Math.min(ys.length - 1, u)), i = Math.min(ys.length - 2, Math.floor(k)), y = ys[i] + (ys[i + 1] - ys[i]) * (k - i), cab = g.userData.cab;
  if (cab) cab.position.y = y;
  // (2:1: the ram's head at half the cabin's rise over the cylinder; the ropes from it down to the sling under the cabin)
  const h = g.userData.hyd; if (!h) return;
  const top = h.y0 + y / 2 + 300;
  h.ram.scale.set(1, top - h.y0, 1); h.ram.position.set(0, (h.y0 + top) / 2, h.z);
  h.shv.position.set(0, top + 160, h.z);
  const r0 = y + 60, r1 = top + 160; h.ropes.scale.set(30, Math.max(10, r1 - r0), 12); h.ropes.position.set(0, (r0 + r1) / 2, h.z + 160);
}
// the time of a ride (s: at its speed, a second to start and to stop) and the cabin's place at a share of it
// (eased: it starts and stops softly)
export const stopY = (r, k) => (k <= 0 ? r.y0 : (r.stops?.[k - 1]?.[0] ?? r.y1));
export const rideTime = (r, from = 0, to = 1) => Math.abs(stopY(r, to) - stopY(r, from)) / S / 1000 / LIFT.speed + 1;
export const rideEase = (u) => { const e = Math.min(1, Math.max(0, u)); return e * e * (3 - 2 * e); };

// the lattice round a column: a diagrid of tubes (world placed)
export function buildLattice(col) {
  const mm = mats(), sec = secOf(col), R = MM(sec.a / 2 + LIFT.lattice), r = MM(30), y0 = col.y0 + MM(300), y1 = colTop(col) - MM(150);
  const H = y1 - y0, N = 12, nr0 = Math.max(2, Math.round(H / MM(2000)) + 1), m = Math.max(1, Math.round((H / (nr0 - 1)) / (2 * Math.PI * R / N))), turns = m * (nr0 - 1) / (2 * N), list = [];   // (the rings on the nodes: m crossings between rings)
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
