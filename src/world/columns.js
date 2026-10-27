import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { makeCastConcreteMaterial } from './terrainMaterial.js';

// Cast columns (монолитные колонны) and bored piles (буронабивные сваи), as on site:
//   set   – a column is set out on the slab / the foundation (the starter bars of its cage
//           drilled and glued in); a pile — the auger bores its hole into the ground;
//   cage  – the bars (4 – 8, Ø12 – 16) tied into stirrups Ø6 every 200 mm; at the top the bars
//           run on past the concrete along the column's axis (the starter bars of what goes on it);
//   form  – square: film-faced plywood boards with steel clamps every 500 mm and two braces;
//           round / a pile above the ground: a cardboard tube;
//   pour  – the concrete from the hose to the level of the top (always cut level, 0°, whatever
//           the slope of the column), the vibrator; it sets;
//   strip – the formwork comes off once it has the strength.
// The height goes by the courses of the masonry beside it (gas block, brick, cinder block): its
// top level with the top of the n-th course. A column may lean (a slope of the axis): the top is
// still cut level, the starter bars keep to the axis.
//   column { x, z, y0 (its foot: the slab / the ground), dep (a pile: how far into the ground),
//            h (over the foot), sec, tilt: [tx, tz] (the axis: horizontal per vertical),
//            course, n, stage (0 set … 4 stripped), fill (0…1), pourT }
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
// the courses the height goes by: a course = the unit + its bed; the first bed thicker
export const COURSES = {
  block: { name: 'газоблок', H: 250, bed: 3, bed0: 20 },
  brick: { name: 'кирпич', H: 65, bed: 12, bed0: 12 },
  cinder: { name: 'шлакоблок', H: 188, bed: 10, bed0: 12 },
};
export const COL_STAGES = [['set', 'Разметка / бурение'], ['cage', 'Каркас'], ['form', 'Опалубка'], ['pour', 'Бетон'], ['strip', 'Распалубка']];
export const TILTS = [0, 2, 5, 10, 15];
export const PILE_DEP = 2000;
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

// the cage: the bars along the axis (the starter bars on past the top), the stirrups every 200
export function cageGeo(r) {
  const sec = COL_SECS[r.sec] || COL_SECS.sq250, half = MM(sec.a / 2 - COVER - sec.d / 2), d = MM(sec.d), y0 = colBot(r) + MM(50), y1 = colTop(r);
  const ax = new THREE.Vector3(r.tilt[0], 1, r.tilt[1]).normalize(), st = MM(STARTER) * ax.y;   // (the bars on along the axis by 500)
  const offs = sec.round ? Array.from({ length: sec.bars }, (_, k) => [Math.cos(k / sec.bars * Math.PI * 2) * half, Math.sin(k / sec.bars * Math.PI * 2) * half])
    : sec.bars === 8 ? [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([a, b]) => [a * half, b * half]) : [[-half, -half], [half, -half], [half, half], [-half, half]];
  const gs = [];
  for (const [ox, oz] of offs) { const [a0, b0] = axisAt(r, y0), [a1, b1] = axisAt(r, y1 + st); gs.push(rod([a0 + ox, y0, b0 + oz], [a1 + ox, y1 + st, b1 + oz], d / 2)); }
  // the stirrups (square / round), every 200 mm up the axis — the last 100 under the top
  const sh = half + d / 2 + MM(3);
  for (let y = y0 + MM(50); y < y1 - MM(60); y += MM(STEP) * ax.y) {
    const [cx, cz] = axisAt(r, y);
    if (sec.round) { const t = new THREE.TorusGeometry(sh, MM(3), 4, 18); t.rotateX(Math.PI / 2); t.translate(cx, y, cz); t.deleteAttribute('uv'); gs.push(t); }
    else { const c = [[-sh, -sh], [sh, -sh], [sh, sh], [-sh, sh]]; for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; gs.push(rod([cx + p[0], y, cz + p[1]], [cx + q[0], y, cz + q[1]], MM(3), 4)); } }
  }
  return mergeGeometries(gs);
}

// the concrete in it up to the level fill (0…1 of the height), the time it was poured
export function concreteGeo(r, fill, pourT) {
  const sec = COL_SECS[r.sec] || COL_SECS.sq250, y0 = colBot(r), y1 = y0 + (colTop(r) - y0) * Math.max(0.001, fill);
  const g = shear(r, y0, y1, MM(sec.a / 2), sec.round, 24), n = g.attributes.position.count;
  g.setAttribute('aPour', new THREE.Float32BufferAttribute(new Float32Array(n).fill(pourT ?? -1e9), 1));
  g.setAttribute('aSm', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.55), 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

// the formwork: square — four boards of 18 mm plywood round it, the clamps every 500 mm, two
// braces to the floor; round — the cardboard tube (from the ground up on a pile)
export function formParts(r) {
  const sec = COL_SECS[r.sec] || COL_SECS.sq250, a = MM(sec.a / 2), y0 = r.y0, y1 = colTop(r) + MM(sec.round ? 20 : 30), out = { ply: [], steel: [], wood: [], tube: [] };
  if (sec.round) { out.tube.push(shear(r, y0, y1, a + MM(6), true, 24)); return out; }
  const t = MM(18);
  // (the boards: two across the full width, two between them)
  for (const [cx, cz, hx, hz] of [[0, -(a + t / 2), a + t, t / 2], [0, a + t / 2, a + t, t / 2], [-(a + t / 2), 0, t / 2, a], [a + t / 2, 0, t / 2, a]]) {
    const g = shear({ ...r, x: r.x + cx, z: r.z + cz }, y0, y1, 1, false);
    // (a box of half sizes hx, hz: the unit prism scaled about its axis)
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const [ax, az] = axisAt({ ...r, x: r.x + cx, z: r.z + cz }, p.getY(i)); p.setX(i, ax + (p.getX(i) - ax) * hx); p.setZ(i, az + (p.getZ(i) - az) * hz); }
    out.ply.push(g);
  }
  // the clamps: a steel frame every 500 mm up (two at the least)
  const H = y1 - y0, nC = Math.max(2, Math.round(H / MM(500)) + 1), o = a + t + MM(25);
  for (let k = 0; k < nC; k++) {
    const y = y0 + MM(150) + (H - MM(300)) * k / Math.max(1, nC - 1), [cx, cz] = axisAt(r, y);
    for (const [sx, sz, lx, lz] of [[0, -o, o + MM(60), MM(25)], [0, o, o + MM(60), MM(25)], [-o, 0, MM(25), o + MM(60)], [o, 0, MM(25), o + MM(60)]]) {
      const g = new THREE.BoxGeometry(lx * 2, MM(50), lz * 2); g.translate(cx + sx, y, cz + sz); out.steel.push(g);
    }
  }
  // the braces: from two thirds up to the floor at 45° (two sides)
  const yb = y0 + H * 0.66, [bx, bz] = axisAt(r, yb), reach = H * 0.66;
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const s = r.tilt[0] * dx + r.tilt[1] * dz >= 0 ? -1 : 1;   // (on the side it leans away from — it holds it)
    const top = [bx + dx * s * (a + t), yb, bz + dz * s * (a + t)], foot = [bx + dx * s * (a + t + reach), y0 + MM(20), bz + dz * s * (a + t + reach)];
    out.wood.push(rod(top, foot, MM(30), 4));
    const pl = new THREE.BoxGeometry(MM(120), MM(40), MM(120)); pl.translate(foot[0], y0 + MM(20), foot[2]); out.wood.push(pl);
  }
  return out;
}

export class ColumnView {
  constructor(group, plyMat) {
    this.group = new THREE.Group(); this.group.name = 'columns'; group.add(this.group);
    this.concU = null;
    this.mats = {
      rebar: new THREE.MeshStandardMaterial({ color: 0x4f4338, roughness: 0.62, metalness: 0.55 }),
      ply: plyMat || new THREE.MeshStandardMaterial({ color: 0xb8714a, roughness: 0.55 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x3d6fb0, roughness: 0.45, metalness: 0.6 }),
      wood: new THREE.MeshStandardMaterial({ color: 0xc89a5c, roughness: 0.8 }),
      tube: new THREE.MeshStandardMaterial({ color: 0x9d8766, roughness: 0.9, side: THREE.DoubleSide }),
      hole: new THREE.MeshStandardMaterial({ color: 0x241c15, roughness: 1 }),
      spoil: new THREE.MeshStandardMaterial({ color: 0x6b5641, roughness: 1 }),
    };
    this.items = new Map();   // id → { key, g }
    this.live = new Map();    // id → { fill } (a pour in progress)
    this.ghost = null;
  }
  setConcreteUniforms(u) { if (!this.concMat) this.concMat = makeCastConcreteMaterial(u); }
  // only: 'cage' / 'form' — just that (the piece carried in by the fitting animation)
  _build(r, fill, only = null) {
    const g = new THREE.Group(), add = (geo, m, shadow = true) => { if (!geo) return; const o = new THREE.Mesh(geo, m); o.castShadow = shadow; o.receiveShadow = true; o.userData.uOwner = r.id ?? null; g.add(o); return o; };
    const sec = COL_SECS[r.sec] || COL_SECS.sq250;
    // a pile's hole while it is empty: the dark hole and the spoil round it
    if (sec.pile && (r.stage ?? 0) < 3 && fill <= 0 && !only) {
      const [x, z] = axisAt(r, r.y0);
      const h = new THREE.CircleGeometry(MM(sec.a / 2 + 10), 24); h.rotateX(-Math.PI / 2); h.translate(x, r.y0 + MM(4), z); add(h, this.mats.hole, false);
      const sp = new THREE.TorusGeometry(MM(sec.a / 2 + 160), MM(90), 6, 20); sp.rotateX(Math.PI / 2); sp.scale(1, 0.45, 1); sp.translate(x, r.y0 + MM(10), z); add(sp, this.mats.spoil);
    }
    if ((r.stage ?? 0) >= 1 && only !== 'form') add(cageGeo(r), this.mats.rebar);
    if (only === 'cage') return g;
    if (fill > 0 && !only) add(concreteGeo(r, fill, r.pourT), this.concMat);
    if (((r.stage ?? 0) >= 2 && (r.stage ?? 0) < 4) || only === 'form') {
      const F = formParts(r);
      for (const [k, list] of Object.entries(F)) if (list.length) add(mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q)).map((q) => { for (const n of Object.keys(q.attributes)) if (!['position', 'normal', ...(k === 'ply' || k === 'tube' ? ['uv'] : [])].includes(n)) q.deleteAttribute(n); return q; })), this.mats[k]);
    }
    return g;
  }
  update(objects) {
    const all = objects.all('column'), seen = new Set();
    for (const r of all) {
      const lv = this.live.get(r.id), fill = lv ? lv.fill : (r.stage ?? 0) >= 3 ? 1 : 0;
      const key = JSON.stringify([r.x, r.z, r.y0, r.h, r.dep, r.sec, r.tilt, r.stage, r.pourT, Math.round(fill * 200)]);
      seen.add(r.id);
      const it = this.items.get(r.id);
      if (it && it.key === key) continue;
      if (it) this._drop(it.g);
      const g = this._build(r, fill);
      this.group.add(g);
      this.items.set(r.id, { key, g });
    }
    for (const [id, it] of this.items) if (!seen.has(id)) { this._drop(it.g); this.items.delete(id); }
  }
  _drop(g) { this.group.remove(g); g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
  // where a column would go: green / red
  setGhost(r, ok) {
    if (this.ghost) { this._drop(this.ghost); this.ghost = null; }
    if (!r) return;
    const sec = COL_SECS[r.sec] || COL_SECS.sq250, geo = shear(r, colBot(r), colTop(r), MM(sec.a / 2), sec.round, 20);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ok ? 0x35d06a : 0xe0453a, transparent: true, opacity: 0.4, depthWrite: false }));
    m.renderOrder = 5;
    this.ghost = new THREE.Group(); this.ghost.add(m);
    // the axis and the starter bars' direction
    const st = MM(STARTER), [x1, z1] = axisAt(r, colTop(r)), ax = new THREE.Vector3(r.tilt[0], 1, r.tilt[1]).normalize();
    const line = new THREE.Mesh(rod([x1, colTop(r), z1], [x1 + ax.x * st, colTop(r) + ax.y * st, z1 + ax.z * st], MM(8)), new THREE.MeshBasicMaterial({ color: 0xff8a1c }));
    this.ghost.add(line);
    this.group.add(this.ghost);
  }
}
