import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { makeCastConcreteMaterial } from './terrainMaterial.js';
import { beltContains } from '../tools/belt.js';

// Cast columns (монолитные колонны) and bored piles (буронабивные сваи), as on site («Фундамент →
// Колонны и сваи»; the concrete — «Бетон», the hose or the bucket):
//   sizes – the section (square / round / a pile), the height by the courses of the masonry beside
//           it (gas block, brick, cinder block: its top level with the top of the n-th course),
//           the slope of the axis and its side;
//   form  – the formwork carried by the finger to its place (it sits on what is under it: the
//           foundation, the gravel, a slab, the masonry; a pile — the auger bores its hole first):
//           square — film-faced plywood boards with timbers, steel clamps every 500 mm and two
//           braces; round — two steel half shells bolted together by their flanges;
//   cage  – the cage carried into the formwork (as into a lintel's): the bars (4 – 8, Ø12 – 16) in
//           stirrups Ø6 every 200 mm, the spacer wheels; at the top the starter bars run on along
//           the axis (into what goes on it);
//   pour  – the concrete from the hose / the bucket up to the top (always cut level, whatever the
//           slope); it sets;
//   strip – the formwork comes off once it has the strength.
// On a cast column / pile: a slab, the masonry.
//   column { x, z, y0 (its foot), dep (a pile: how far into the ground), h (over the foot), sec,
//            tilt: [tx, tz] (the axis: horizontal per vertical), course, n, cage (in),
//            stage (2 the formwork on, 3 cast, 4 stripped; old records: 0 set out, 1 a cage),
//            fill (0…1 while it is poured), pourT }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const COL_SECS = {
  sq200: { name: 'Колонна 200 × 200', round: false, a: 200, bars: 4, d: 12 },
  sq250: { name: 'Колонна 250 × 250', round: false, a: 250, bars: 4, d: 12 },
  sq300: { name: 'Колонна 300 × 300', round: false, a: 300, bars: 4, d: 14 },
  sq400: { name: 'Колонна 400 × 400', round: false, a: 400, bars: 8, d: 16 },
  p300: { name: 'Свая Ø300', round: true, pile: true, a: 300, bars: 4, d: 12 },
  p400: { name: 'Свая Ø400', round: true, pile: true, a: 400, bars: 6, d: 14 },
  r300: { name: 'Круглая колонна Ø300', round: true, a: 300, bars: 6, d: 12 },
};
// the kinds by the slider (the record: sec = 'sq' / 'rd' / 'pile', a = the size, mm); the old records'
// fixed sections above still read. The bars by the size: 4 (square up to 300) … 8, Ø12 … 16
export const COL_TYPES = { sq: { min: 150, max: 500, def: 250 }, rd: { min: 200, max: 500, def: 300 }, pile: { min: 200, max: 600, def: 300 } };
const reinf = (round, a) => ({ bars: round ? (a <= 300 ? 6 : 8) : (a <= 300 ? 4 : 8), d: a <= 250 ? 12 : a <= 350 ? 14 : 16 });
export function secOf(r) {
  const o = COL_SECS[r?.sec];
  if (o) return r.a && r.a !== o.a ? { ...o, a: r.a, ...reinf(o.round, r.a), name: o.name.replace(/\d+( × \d+)?$/, o.round ? `${r.a}` : `${r.a} × ${r.a}`) } : o;
  const t = r?.sec === 'rd' ? 'rd' : r?.sec === 'pile' ? 'pile' : 'sq', a = r?.a || COL_TYPES[t].def;
  return { name: t === 'sq' ? `Колонна ${a} × ${a}` : t === 'rd' ? `Круглая колонна Ø${a}` : `Свая Ø${a}`, round: t !== 'sq', pile: t === 'pile', a, ...reinf(t !== 'sq', a), type: t };
}
// the kind of a record: sq / rd / pile
export const typeOf = (r) => secOf(r).type || (secOf(r).pile ? 'pile' : secOf(r).round ? 'rd' : 'sq');
// the courses the height goes by: a course = the unit + its bed; the first bed thicker
export const COURSES = {
  block: { name: 'газоблок', H: 250, bed: 3, bed0: 20 },
  brick: { name: 'кирпич', H: 65, bed: 12, bed0: 12 },
  cinder: { name: 'шлакоблок', H: 188, bed: 10, bed0: 12 },
};
export const COL_STAGES = [['form', 'Опалубка'], ['cage', 'Каркас'], ['strip', 'Распалубка']];
export const TILTS = [0, 2, 5, 10, 15];
export const PILE_DEP = 2000;
// a column's cage set on the ground / loose fill: a hole bored for it first, 1,2 m (below the frost),
// round, wide enough for the square cage's corners
export const BORE_DEP = 1200;
export const holeR = (r) => { const q = secOf(r); return q.round ? q.a / 2 : Math.round(q.a * 0.72); };   // mm
export const bored = (r) => secOf(r).pile || !!r.bored;
const STARTER = 500, COVER = 30, STEP = 200;
export const courseH = (course, n) => { const c = COURSES[course] || COURSES.block; return c.bed0 + n * c.H + (n - 1) * c.bed; };   // mm
// the axis at a height: the middle of the column's section at y (it leans by tilt)
export const axisAt = (r, y) => [r.x + r.tilt[0] * (y - r.y0), r.z + r.tilt[1] * (y - r.y0)];
export const colTop = (r) => r.y0 + r.h;
export const colBot = (r) => r.y0 - (r.dep || 0);

// a prism / a cylinder sheared along the axis between two levels (its sections level: the top cut
// level whatever the slope); half: the half side (or the radius); out: a hollow shell (a tube / boards)
function shear(r, y0, y1, half, round, seg = 20) {
  const pts = round ? Array.from({ length: seg }, (_, k) => [Math.cos(k / seg * Math.PI * 2) * half, Math.sin(k / seg * Math.PI * 2) * half]) : [[-half, -half], [half, -half], [half, half], [-half, half]];
  const n = pts.length, pos = [], nor = [], uv = [];
  const [ax0, az0] = axisAt(r, y0), [ax1, az1] = axisAt(r, y1);
  const tri = (a, b, c, na, nb, nc, ua, ub, uc) => { pos.push(...a, ...b, ...c); nor.push(...na, ...nb, ...nc); uv.push(...ua, ...ub, ...uc); };
  let per = 0;
  for (let k = 0; k < n; k++) {
    const p = pts[k], q = pts[(k + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const A = [ax0 + p[0], y0, az0 + p[1]], B = [ax0 + q[0], y0, az0 + q[1]], C = [ax1 + q[0], y1, az1 + q[1]], D = [ax1 + p[0], y1, az1 + p[1]];
    const nr = round ? [[p[0] / half, 0, p[1] / half], [q[0] / half, 0, q[1] / half]] : (() => { const v = [q[1] - p[1], 0, -(q[0] - p[0])], l = Math.hypot(v[0], v[2]); return [[v[0] / l, 0, v[2] / l], [v[0] / l, 0, v[2] / l]]; })();
    // (outward: the winding of the points is counter-clockwise seen from above in x, z → the normal is (dz, −dx))
    const u0 = per / MM(1000), u1 = (per + L) / MM(1000), v0 = y0 / MM(1000), v1 = y1 / MM(1000);
    tri(A, C, B, nr[0], nr[1], nr[1], [u0, v0], [u1, v1], [u1, v0]);
    tri(A, D, C, nr[0], nr[0], nr[1], [u0, v0], [u0, v1], [u1, v1]);
    per += L;
  }
  // the top (level) and the bottom
  for (const [y, ax, az, up] of [[y1, ax1, az1, 1], [y0, ax0, az0, -1]]) for (let k = 1; k < n - 1; k++) {
    const P = (i) => [ax + pts[i][0], y, az + pts[i][1]], U = (i) => [pts[i][0] / MM(1000), pts[i][1] / MM(1000)];
    if (up > 0) tri(P(0), P(k + 1), P(k), [0, 1, 0], [0, 1, 0], [0, 1, 0], U(0), U(k + 1), U(k));
    else tri(P(0), P(k), P(k + 1), [0, -1, 0], [0, -1, 0], [0, -1, 0], U(0), U(k), U(k + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// a rod between two points
const _Y = new THREE.Vector3(0, 1, 0);
function rod(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_Y, B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  g.deleteAttribute('uv');
  return g;
}

// the cage: the bars along the axis (the starter bars on past the top: r.starter mm, 500 when
// nothing is on it yet), the stirrups every 200, the plastic spacer wheels (the cover) on the bars
export function cageParts(r) {
  const sec = secOf(r), half = MM(sec.a / 2 - COVER - sec.d / 2), d = MM(sec.d), y0 = r.anc ? r.y0 - MM(r.anc) : colBot(r) + MM(50), y1 = colTop(r);
  const ax = new THREE.Vector3(r.tilt[0], 1, r.tilt[1]).normalize(), st = MM(r.starter ?? STARTER) * ax.y;   // (the bars on along the axis)
  const offs = sec.round ? Array.from({ length: sec.bars }, (_, k) => [Math.cos(k / sec.bars * Math.PI * 2) * half, Math.sin(k / sec.bars * Math.PI * 2) * half])
    : sec.bars === 8 ? [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([a, b]) => [a * half, b * half]) : [[-half, -half], [half, -half], [half, half], [-half, half]];
  const gs = [], pl = [];
  for (const [ox, oz] of offs) { const [a0, b0] = axisAt(r, y0), [a1, b1] = axisAt(r, y1 + st); gs.push(rod([a0 + ox, y0, b0 + oz], [a1 + ox, y1 + st, b1 + oz], d / 2)); }
  // (tied into the foundation's cage: each bar's foot bent out 250 mm along its bottom bars — the «лапки» —
  // and wired to them)
  if (r.anc) for (const [ox, oz] of offs) {
    const L = Math.hypot(ox, oz) || 1, [a0, b0] = axisAt(r, y0), fx = a0 + ox, fz = b0 + oz;
    gs.push(rod([fx, y0, fz], [fx + ox / L * MM(250), y0, fz + oz / L * MM(250)], d / 2));
    for (const k of [0.3, 0.8]) { const t = new THREE.TorusGeometry(MM(7), MM(1.6), 3, 8); t.rotateX(Math.PI / 2); t.translate(fx + ox / L * MM(250) * k, y0 + MM(6), fz + oz / L * MM(250) * k); t.deleteAttribute('uv'); gs.push(t); }
  }
  // the stirrups (square / round), every 200 mm up the axis — the last 100 under the top
  const sh = half + d / 2 + MM(3);
  for (let y = Math.max(y0 + MM(50), r.anc ? r.y0 - MM(r.anc - 100) : -Infinity); y < y1 - MM(60); y += MM(STEP) * ax.y) {
    const [cx, cz] = axisAt(r, y);
    if (sec.round) { const t = new THREE.TorusGeometry(sh, MM(3), 4, 18); t.rotateX(Math.PI / 2); t.translate(cx, y, cz); t.deleteAttribute('uv'); gs.push(t); }
    else { const c = [[-sh, -sh], [sh, -sh], [sh, sh], [-sh, sh]]; for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; gs.push(rod([cx + p[0], y, cz + p[1]], [cx + q[0], y, cz + q[1]], MM(3), 4)); } }
  }
  // the spacer wheels (Ø60, the cover 30): on the outer bars every metre, upright, facing out
  const H = y1 - y0;
  for (let y = y0 + MM(300); y < y1 - MM(200); y += Math.max(MM(900), H / 4)) {
    const [cx, cz] = axisAt(r, y);
    for (const [ox, oz] of offs) {
      const L = Math.hypot(ox, oz) || 1, nx = ox / L, nz = oz / L;
      const w = new THREE.TorusGeometry(MM(COVER - 4), MM(5), 4, 10);
      w.rotateY(Math.atan2(-nz, nx) + Math.PI / 2);   // (its plane: up and out)
      w.translate(cx + ox + nx * MM(sec.d / 2 + COVER / 2 - 4) * 0.5, y, cz + oz + nz * MM(sec.d / 2 + COVER / 2 - 4) * 0.5);
      w.deleteAttribute('uv'); pl.push(w);
    }
  }
  return { rebar: mergeGeometries(gs), plastic: pl.length ? mergeGeometries(pl) : null };
}
export const cageGeo = (r) => cageParts(r).rebar;

// the concrete in it up to the level fill (0…1 of the height), the time it was poured
export function concreteGeo(r, fill, pourT) {
  const sec = secOf(r), y0 = colBot(r), y1 = y0 + (colTop(r) - y0) * Math.max(0.001, fill);
  const g = shear(r, y0, y1, MM(sec.a / 2), sec.round, 24), n = g.attributes.position.count;
  g.setAttribute('aPour', new THREE.Float32BufferAttribute(new Float32Array(n).fill(pourT ?? -1e9), 1));
  g.setAttribute('aSm', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.55), 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

// a box along the axis: the middle (cx, cz) off the axis, half sizes hx, hz, between two levels
function prism(r, cx, cz, hx, hz, y0, y1) {
  const q = { ...r, x: r.x + cx, z: r.z + cz }, g = shear(q, y0, y1, 1, false), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const [ax, az] = axisAt(q, p.getY(i)); p.setX(i, ax + (p.getX(i) - ax) * hx); p.setZ(i, az + (p.getZ(i) - az) * hz); }
  g.computeVertexNormals();
  return g;
}
// a part of a cylinder's shell along the axis (an arc a0…a1 of radius rad), open, both faces
function arcShell(r, y0, y1, rad, a0, a1, seg = 14) {
  const pos = [], nor = [], [x0, z0] = axisAt(r, y0), [x1, z1] = axisAt(r, y1);
  for (let k = 0; k < seg; k++) {
    const t0 = a0 + (a1 - a0) * k / seg, t1 = a0 + (a1 - a0) * (k + 1) / seg, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const A = [x0 + c0 * rad, y0, z0 + s0 * rad], B = [x0 + c1 * rad, y0, z0 + s1 * rad], C = [x1 + c1 * rad, y1, z1 + s1 * rad], D = [x1 + c0 * rad, y1, z1 + s0 * rad];
    pos.push(...A, ...C, ...B, ...A, ...D, ...C);
    nor.push(c0, 0, s0, c1, 0, s1, c1, 0, s1, c0, 0, s0, c0, 0, s0, c1, 0, s1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// The formwork, as a set of pieces (each one brought in / taken off on its own):
//   square – four boards of film-faced plywood 18 mm, each with two upright timbers 50 × 50 on its
//            back; the steel clamps every 500 mm and two braces to the floor (one piece);
//   round  – two half shells of steel 3 mm, split along the column, each with its flanges
//            (40 mm) bolted to the other's every 300 mm; the clamp rings every 500 mm.
// piece: { dir: [dx, dz] (it comes in / goes off that way), drop (it comes down from above),
//          ply / steel / wood / shell / bolt: [geometries] }
export function formPieces(r) {
  const sec = secOf(r), a = MM(sec.a / 2), y0 = r.y0, y1 = colTop(r) + MM(sec.round ? 20 : 30), H = y1 - y0;
  const pieces = [], piece = (o) => { const p = { ply: [], steel: [], wood: [], shell: [], bolt: [], dir: [0, 0], drop: false, ...o }; pieces.push(p); return p; };
  if (sec.round) {
    const t = MM(3), R = a + t, fl = MM(40), ft = MM(8);
    for (const sd of [1, -1]) {
      // (the half on the +z side: the arc 0…π; its flanges at ±x)
      const P = piece({ dir: [0, sd] });
      P.shell.push(arcShell(r, y0, y1, R, sd > 0 ? 0 : Math.PI, sd > 0 ? Math.PI : Math.PI * 2, 16));
      for (const sx of [1, -1]) {
        P.shell.push(prism(r, sx * (R + fl / 2), sd * ft / 2, fl / 2, ft / 2, y0, y1));
        // the bolts through the two flanges, every 300 mm
        if (sd > 0) for (let y = y0 + MM(120); y < y1 - MM(60); y += MM(300)) {
          const [cx, cz] = axisAt(r, y), b = new THREE.CylinderGeometry(MM(7), MM(7), ft * 2 + MM(24), 6); b.rotateX(Math.PI / 2); b.translate(cx + sx * (R + fl * 0.6), y, cz); P.bolt.push(b);
          const n = new THREE.BoxGeometry(MM(20), MM(20), MM(10)); n.translate(cx + sx * (R + fl * 0.6), y, cz + ft + MM(5)); P.bolt.push(n);
        }
      }
      // (stiffening ribs round the half, every 500 mm)
      for (let y = y0 + MM(150); y < y1 - MM(60); y += MM(500)) {
        const [cx, cz] = axisAt(r, y), ring = new THREE.TorusGeometry(R + MM(6), MM(7), 4, 16, Math.PI); ring.rotateX(sd > 0 ? Math.PI / 2 : -Math.PI / 2); ring.translate(cx, y, cz); ring.deleteAttribute('uv'); P.shell.push(ring);
      }
    }
    return pieces;
  }
  const t = MM(18), rib = MM(25);
  // (the boards: two across the full width, two between them; each with two timbers on its back)
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const P = piece({ dir: [nx, nz] }), across = nx === 0, hl = across ? a + t : a;
    P.ply.push(prism(r, nx * (a + t / 2), nz * (a + t / 2), across ? hl : t / 2, across ? t / 2 : hl, y0, y1));
    for (const s of [-0.55, 0.55]) {
      const o = a + t + rib, w = s * hl;
      P.wood.push(prism(r, across ? w : nx * o, across ? nz * o : w, rib, rib, y0, y1));
    }
  }
  // the clamps: a steel frame every 500 mm up (two at the least), round the timbers
  const C = piece({ drop: true }), nC = Math.max(2, Math.round(H / MM(500)) + 1), o = a + t + 2 * rib + MM(25);
  for (let k = 0; k < nC; k++) {
    const y = y0 + MM(150) + (H - MM(300)) * k / Math.max(1, nC - 1), [cx, cz] = axisAt(r, y);
    for (const [sx, sz, lx, lz] of [[0, -o, o + MM(60), MM(25)], [0, o, o + MM(60), MM(25)], [-o, 0, MM(25), o + MM(60)], [o, 0, MM(25), o + MM(60)]]) {
      const g = new THREE.BoxGeometry(lx * 2, MM(50), lz * 2); g.translate(cx + sx, y, cz + sz); C.steel.push(g);
    }
  }
  // the braces: from two thirds up to the floor at 45° (two sides), a plate under each foot
  const yb = y0 + H * 0.66, [bx, bz] = axisAt(r, yb), reach = H * 0.66;
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const s = r.tilt[0] * dx + r.tilt[1] * dz >= 0 ? -1 : 1;   // (on the side it leans away from — it holds it)
    const top = [bx + dx * s * (o - MM(25)), yb, bz + dz * s * (o - MM(25))], foot = [bx + dx * s * (a + t + reach), y0 + MM(20), bz + dz * s * (a + t + reach)];
    C.wood.push(rod(top, foot, MM(30), 4));
    const pl = new THREE.BoxGeometry(MM(120), MM(40), MM(120)); pl.translate(foot[0], y0 + MM(20), foot[2]); C.wood.push(pl);
  }
  return pieces;
}
// (the old flat list of all of them, by material)
export function formParts(r) {
  const out = { ply: [], steel: [], wood: [], shell: [], bolt: [] };
  for (const p of formPieces(r)) for (const k of Object.keys(out)) out[k].push(...p[k]);
  return out;
}
// the record's state: the cage in (old records: from stage 1), the formwork on, the concrete in it
export const cageOn = (r) => r.cage ?? ((r.stage ?? 0) >= 1);
export const formOn = (r) => (r.stage ?? 0) >= 2 && (r.stage ?? 0) < 4;
export const fillOf = (r) => ((r.stage ?? 0) >= 3 ? 1 : Math.max(0, Math.min(1, r.fill || 0)));
// cast and its formwork off or its concrete set: what goes on it may (a slab, the masonry)
export const castDone = (r) => (r.stage ?? 0) >= 3;

export class ColumnView {
  constructor(group, plyMat) {
    this.group = new THREE.Group(); this.group.name = 'columns'; group.add(this.group);
    this.concU = null;
    this.mats = {
      rebar: new THREE.MeshStandardMaterial({ color: 0x4f4338, roughness: 0.62, metalness: 0.55 }),
      plastic: new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.6 }),
      ply: plyMat || new THREE.MeshStandardMaterial({ color: 0xb8714a, roughness: 0.55 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x3d6fb0, roughness: 0.45, metalness: 0.6 }),
      wood: new THREE.MeshStandardMaterial({ color: 0xc89a5c, roughness: 0.8 }),
      shell: new THREE.MeshStandardMaterial({ color: 0x8e9aa4, roughness: 0.42, metalness: 0.7, side: THREE.DoubleSide }),
      bolt: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.8 }),
      hole: new THREE.MeshStandardMaterial({ color: 0x241c15, roughness: 1 }),
      spoil: new THREE.MeshStandardMaterial({ color: 0x6b5641, roughness: 1 }),
    };
    this.items = new Map();   // id → { key, g }
    this.live = new Map();    // id → { fill } (a pour in progress)
    this.ghost = null;
    this.patch = new Map();   // id → { a, h, n, tilt … } (the sliders being moved: shown, not saved yet)
  }
  setConcreteUniforms(u) { if (!this.concMat) this.concMat = makeCastConcreteMaterial(u); }
  // the formwork as pieces, each its own group (the fitting animation moves them one by one)
  formGroup(r, mat = null) {
    const G = new THREE.Group();
    for (const P of formPieces(r)) {
      const g = new THREE.Group(); g.userData.dir = P.dir; g.userData.drop = P.drop;
      for (const k of ['ply', 'steel', 'wood', 'shell', 'bolt']) {
        if (!P[k].length) continue;
        const geo = mergeGeometries(P[k].map((q) => (q.index ? q.toNonIndexed() : q)).map((q) => { for (const n of Object.keys(q.attributes)) if (!['position', 'normal', ...(k === 'ply' && !mat ? ['uv'] : [])].includes(n)) q.deleteAttribute(n); return q; }));
        if (k === 'ply' && !mat && !geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        const o = new THREE.Mesh(geo, mat || this.mats[k]); o.castShadow = !mat; o.receiveShadow = !mat; o.userData.uOwner = r.id ?? null; if (mat) o.renderOrder = 5; g.add(o);
      }
      G.add(g);
    }
    return G;
  }
  cageGroup(r, mat = null) {
    const g = new THREE.Group(), C = cageParts(r);
    for (const [k, geo] of Object.entries(C)) if (geo) { const o = new THREE.Mesh(geo, mat || this.mats[k]); o.castShadow = !mat; o.userData.uOwner = r.id ?? null; if (mat) o.renderOrder = 5; g.add(o); }
    return g;
  }
  // only: 'cage' / 'form' — just that (the piece carried in by the fitting animation)
  _build(r, fill, only = null) {
    if (only === 'cage') return this.cageGroup(r);
    if (only === 'form') return this.formGroup(r);
    const g = new THREE.Group(), add = (geo, m, shadow = true) => { if (!geo) return; const o = new THREE.Mesh(geo, m); o.castShadow = shadow; o.receiveShadow = true; o.userData.uOwner = r.id ?? null; g.add(o); return o; };
    const sec = secOf(r);
    // a pile's hole while it is empty: the dark hole and the spoil round it
    if ((sec.pile || r.bored) && (r.stage ?? 0) < 3) {
      const [x, z] = axisAt(r, r.y0), hr = holeR(r);
      if (fill <= 0) { const h = new THREE.CircleGeometry(MM(hr + 10), 24); h.rotateX(-Math.PI / 2); h.translate(x, r.y0 + MM(4), z); add(h, this.mats.hole, false); }
      const sp = new THREE.TorusGeometry(MM(hr + 180), MM(80), 6, 20); sp.rotateX(Math.PI / 2); sp.scale(1, 0.45, 1); sp.translate(x, r.y0 + MM(10), z); add(sp, this.mats.spoil);
    }
    if (cageOn(r)) g.add(this.cageGroup(r));
    if (fill > 0) { const c = add(concreteGeo(r, fill, r.pourT), this.concMat); c.userData.conc = 1; }
    if (formOn(r)) g.add(this.formGroup(r));
    return g;
  }
  // the concrete alone, at another level (a pour going on: the formwork and the cage stay as built)
  _setConcrete(it, r, fill) {
    const old = it.g.children.find((o) => o.userData.conc);
    if (old) { it.g.remove(old); old.geometry.dispose(); }
    if (fill > 0) { const o = new THREE.Mesh(concreteGeo(r, fill, r.pourT ?? 0), this.concMat); o.receiveShadow = true; o.userData.uOwner = r.id; o.userData.conc = 1; it.g.add(o); }
  }
  update(objects) {
    const all = objects.all('column'), seen = new Set();
    // the starter bars of a column with a slab / masonry on it: into that, not out through it
    const v = objects.ver ?? 0;
    if (this._covV !== v || this._covO !== objects) { this._covV = v; this._covO = objects; this._cov = new Map(); for (const r of all) if (castDone(r)) this._cov.set(r.id, covered(r, objects)); }
    for (const r0 of all) {
      const r = this.patch.has(r0.id) ? { ...r0, ...this.patch.get(r0.id) } : r0;
      const lv = this.live.get(r.id), fill = lv ? lv.fill : fillOf(r), st = this._cov.get(r.id) ? 150 : STARTER;
      // (the concrete's level apart: while it is poured only the concrete is made again)
      const key = JSON.stringify([r.x, r.z, r.y0, r.h, r.dep, r.sec, r.a, r.anc, r.tilt, r.stage, cageOn(r), r.pourT, fill > 0, st]), fk = Math.round(fill * 200);
      seen.add(r.id);
      const it = this.items.get(r.id);
      if (it && it.key === key) { if (it.fk !== fk) { it.fk = fk; this._setConcrete(it, { ...r, pourT: r.pourT ?? lv?.t }, fill); } continue; }
      if (it) this._drop(it.g);
      const g = this._build({ ...r, starter: st, pourT: r.pourT ?? lv?.t }, fill);
      this.group.add(g);
      this.items.set(r.id, { key, g, fk });
    }
    for (const [id, it] of this.items) if (!seen.has(id)) { this._drop(it.g); this.items.delete(id); }
  }
  _drop(g) { this.group.remove(g); g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
  // where it would go: green / red — the formwork (what = 'form'), the cage carried ('cage'),
  // or the column itself (anything else)
  setGhost(r, ok, what = 'form') {
    if (this.ghost) { this._drop(this.ghost); this.ghost = null; }
    if (!r) return;
    const mat = new THREE.MeshBasicMaterial({ color: ok ? 0x35d06a : 0xe0453a, transparent: true, opacity: what === 'cage' ? 0.85 : 0.42, depthWrite: false });
    this.ghost = what === 'cage' ? this.cageGroup(r, mat) : what === 'form' ? this.formGroup(r, mat) : new THREE.Group();
    const sec = secOf(r);
    if (what !== 'cage') {
      // the column inside: its body faint, the axis and the starter bars' direction
      const m = new THREE.Mesh(shear(r, colBot(r), colTop(r), MM(sec.a / 2), sec.round, 20), new THREE.MeshBasicMaterial({ color: ok ? 0x35d06a : 0xe0453a, transparent: true, opacity: 0.18, depthWrite: false }));
      m.renderOrder = 5; this.ghost.add(m);
      const st = MM(STARTER), [x1, z1] = axisAt(r, colTop(r)), ax = new THREE.Vector3(r.tilt[0], 1, r.tilt[1]).normalize();
      this.ghost.add(new THREE.Mesh(rod([x1, colTop(r), z1], [x1 + ax.x * st, colTop(r) + ax.y * st, z1 + ax.z * st], MM(8)), new THREE.MeshBasicMaterial({ color: 0xff8a1c })));
      // the base it stands on: a ring / a square round its foot
      const [x0, z0] = axisAt(r, r.y0), ring = new THREE.RingGeometry(MM(sec.a / 2 + 40), MM(sec.a / 2 + 90), sec.round ? 28 : 4, 1, sec.round ? 0 : Math.PI / 4);
      ring.rotateX(-Math.PI / 2); ring.translate(x0, r.y0 + MM(6), z0);
      const rm = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: ok ? 0x35d06a : 0xe0453a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })); rm.renderOrder = 6; this.ghost.add(rm);
    }
    this.ghost.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });   // (the finger's ray goes through it)
    this.group.add(this.ghost);
  }
}

// a slab cast on the column's top, or masonry laid on it
function covered(r, objects) {
  const top = colTop(r), [x, z] = axisAt(r, top), near = MM(secOf(r).a / 2);
  for (const b of objects.all('belt')) if (b.kind === 'slab' && Math.abs(b.top - top) < MM(40) && b.fill > 0.05 && beltContains(b, x, z)) return true;
  for (const u of objects.all('unit')) if (u.p && u.s && Math.abs(u.p[1] - u.s[1] / 2 - top) < MM(40) && Math.abs(u.p[0] - x) < u.s[0] / 2 + near && Math.abs(u.p[2] - z) < u.s[0] / 2 + near) return true;
  return false;
}
