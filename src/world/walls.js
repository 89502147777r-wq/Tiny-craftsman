import * as THREE from 'three';
import { levels, UN } from '../tools/uPour.js';
import { MODEL_SCALE, CONCRETE } from '../config.js';
import { makeCastConcreteMaterial } from './terrainMaterial.js';
import { mortarOf } from '../tools/freeBrick.js';

// Masonry walls, laid the way they are on site.
// Records (objects store):
//   wall { a:[x,z], b:[x,z], kind, base, height, on, v } – the axis of a wall (model units),
//          base = the top of what it stands on, height = planned (real mm); on = the
//          wall it stands on (a tier: a brick plinth, the blockwork on it, …), same axis;
//          v = 2: whole units at corners / butt joints, the cut piece in the middle
//   bed  { wall, row, s0, s1 }                       – a strip of mortar / glue spread on
//          a course, s along the axis from a (real mm)
//   unit { wall, row, i, s0, s1, off, p, q, s, kind } – a block / brick as it was laid
// Sizes in real millimetres, converted with MODEL_SCALE.
export const KINDS = {
  block: { name: 'Газоблок', L: 600, H: 250, T: 300, bed0: 20, bed: 3, head: 3, min: 100, lintelRows: 1 },     // aerated concrete on glue (first course on mortar)
  // brick walls by thickness in half-bricks (nb): ½ = 120, 1 = 250, 1½ = 380, 2 = 510, 2½ = 640 mm,
  // chain bond (stretcher and header courses alternate)
  brick: brickKind('Кирпич ½', 1),
  brick2: brickKind('Кирпич 1', 2),
  brick3: brickKind('Кирпич 1½', 3),
  brick4: brickKind('Кирпич 2', 4),
  brick5: brickKind('Кирпич 2½', 5),
};
function brickKind(name, nb) { return { name, nb, L: 250, H: 65, T: nb * 120 + (nb - 1) * 10, W: 120, bed0: 12, bed: 12, head: 10, min: 55, lintelRows: 2 }; }
// what a course of a brick wall is made of, from one face to the other: S – a stretcher
// leaf (120 across), H – a header leaf (250 across). Stretcher courses start with a
// stretcher face, header courses with headers: the leaves overlap the joints below.
export function brickLeaves(nb, r) {
  const seq = [];
  let rem = nb;
  if (nb === 1 || r % 2 === 0) { seq.push('S'); rem--; }
  while (rem >= 2) { seq.push('H'); rem -= 2; }
  if (rem) seq.push('S');
  return seq;
}
// the level of a tier (0 = on the foundation)
export function level(w, walls) {
  let n = 0, c = w;
  while (c?.on && n < 8) { c = walls.find((o) => o.id === c.on); n++; }
  return n;
}
// the top of a wall (model y): what the next tier stands on
export function topY(w) { const k = KINDS[w.kind]; return rowY(w, rows(w) - 1) + k.H * S; }
// openings (real mm above the bottom of the wall) and the lintel over them
export const OPENINGS = {
  window: { name: 'Окно', y0: 900, y1: 2100, minW: 500 },
  door: { name: 'Дверь', y0: 0, y1: 2100, minW: 700 },
};
const BEAR = 250;   // a lintel rests 250 mm on the masonry each side
const S = 1 / 1000 / MODEL_SCALE;   // real mm → model m

export function axis(w) {
  const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
  return { ux: dx / len, uz: dz / len, nx: -dz / len, nz: dx / len, L: len / S };
}
export function rows(w) {
  const k = KINDS[w.kind];
  return Math.max(1, Math.floor((w.height - k.bed0) / (k.H + k.bed)));
}
// bottom of a course (model y)
export function rowY(w, r) { const k = KINDS[w.kind]; return w.base + (k.bed0 + r * (k.H + k.bed)) * S; }

// the other wall meeting this one at end e (0 = a, 1 = b): a corner
function cornerAt(w, e, walls) {
  const p = e ? w.b : w.a, tol = 0.012, lv = level(w, walls);
  for (const o of walls) {
    if (o.id === w.id || level(o, walls) !== lv) continue;
    for (const q of [o.a, o.b]) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < tol) return o;
  }
  return null;
}

// does end e of a wall butt into the face of another wall of its level (a partition)?
function abutsAt(w, e, walls) {
  const p = e ? w.b : w.a, lv = level(w, walls);
  for (const o of walls) {
    if (o.id === w.id || level(o, walls) !== lv) continue;
    const ax = axis(o), dx = p[0] - o.a[0], dz = p[1] - o.a[1], t = KINDS[o.kind].T / 2 * S;
    const d = Math.abs(dx * ax.nx + dz * ax.nz), s = (dx * ax.ux + dz * ax.uz) / S;
    if (Math.abs(d - t) < 0.003 && s > -KINDS[o.kind].T / 2 && s < ax.L + KINDS[o.kind].T / 2) return true;
  }
  return false;
}

// a course laid from an anchored start (a whole unit there) and, when the far end is
// anchored too, from that end as well: whole units at both ends, the cut piece(s) in
// between — placed so that its joints miss the joints of the course below (`avoid`),
// with a half unit next to the first one when nothing else staggers them
function anchoredGrid(a0, a1, len0, U, len1, k, avoid = []) {
  const both = len1 > 0;
  if (!both) { const out = []; for (let s = a0, first = true; s < a1; first = false) { const len = first ? len0 : U; out.push([s, s + len]); s += len + k.head; } return out; }
  if (a1 - a0 <= U + 1) return [[a0, a1]];
  const h = k.head, mid = (a0 + a1) / 2, N = Math.ceil((a1 - a0) / (U + h)) + 1;
  let best = null, bs = Infinity;
  const xs = [0];
  for (let x = Math.max(k.min, 100); x < U - 1; x += 25) xs.push(x);
  for (const half of [0, U / 2]) for (const halfB of [0, U / 2]) for (let n = 0; n <= N; n++) for (const x of xs) {
    // from a0: a whole one, (a half), n more whole ones, (a cut of x); from a1: whole ones
    // back to them; what is left between is one more cut (or nothing)
    const fw = [[a0, a0 + len0]];
    let s = a0 + len0 + h, ok = true;
    if (half) { fw.push([s, s + half]); s += half + h; }
    for (let i = 0; i < n; i++) { if (s + U > a1 - U - h + 1) { ok = false; break; } fw.push([s, s + U]); s += U + h; }
    if (!ok) break;
    if (x) { if (s + x > a1 - U - h + 1) continue; fw.push([s, s + x]); s += x + h; }
    const bw = [[a1 - len1, a1]];
    let e = a1 - len1 - h;
    if (halfB) { if (e - halfB < s + k.min) continue; bw.unshift([e - halfB, e]); e -= halfB + h; }   // a half next to the whole one at a1
    while (e - U >= s - 1) {
      bw.unshift([e - U, e]); e -= U + h;
      if (Math.abs(e + h - s) < 1) break;
      if (e - U < s && e - s < k.min) break;
    }
    const gap = e - s, pieces = [...fw];
    if (gap >= k.min) pieces.push([s, e]);
    else if (gap > -h + 1) continue;   // a sliver: not this way
    pieces.push(...bw);
    pieces.sort((p1, p2) => p1[0] - p2[0]);
    if (pieces.some((p1, i) => i && p1[0] < pieces[i - 1][1] + h - 1)) continue;
    const joints = pieces.slice(0, -1).map((p1) => p1[1] + h / 2);
    const clash = joints.filter((j) => avoid.some((a) => Math.abs(a - j) < 100)).length;
    const cuts = pieces.filter((p1) => p1[1] - p1[0] < U - 1);
    const score = clash * 1000 + (half ? 40 : 0) + (halfB ? 40 : 0) + cuts.length * 30 + Math.abs((cuts[0] ? (cuts[0][0] + cuts[0][1]) / 2 : mid) - mid) / 50;
    if (score < bs) { bs = score; best = pieces; }
  }
  return best || [[a0, a1]];
}

// the courses an opening takes (r0 ≤ r < r1) and the lintel over it (r1 … r1 + lintelRows − 1),
// its edges snapped to the courses
export function openingRows(w, o) {
  const k = KINDS[w.kind], c = k.H + k.bed;
  const r0 = Math.max(0, Math.round((o.y0 - (o.y0 > 0 ? k.bed0 : 0)) / c)), r1 = Math.max(r0 + 1, Math.round((o.y1 - k.bed0) / c));
  return { r0, r1, l1: r1 + k.lintelRows };
}

// The places of one course: [{ i, s0, s1, off, w, rot, cut, lintel }] — s along the axis
// (real mm from a), off across it, w the size across, rot = 1 for a header.
// The joints follow one running bond over the whole wall (every other course starts
// with a half; at a corner the courses of the two walls interlock); openings are cut
// out of it and a lintel bridges each opening in the course above it. A piece shorter
// than the minimum is never laid: it and its neighbour become two equal cut pieces.
export function course(w, r, walls, opens = []) {
  const k = KINDS[w.kind], { L } = axis(w);
  let a0 = 0, a1 = L;
  // an end at a corner or butting into another wall is anchored: the course starts there
  // with a whole unit (the corner overlap already staggers the joints), and the cut piece
  // goes into the middle of the wall — never at a corner
  const corner = [0, 1].map((e) => !!cornerAt(w, e, walls)), anch = [0, 1].map((e) => corner[e] || abutsAt(w, e, walls));
  for (const e of [0, 1]) {
    const o = cornerAt(w, e, walls);
    if (!o) continue;
    const pass = (r + (w.id < o.id ? 0 : 1)) % 2 === 0, t = KINDS[o.kind].T / 2;
    if (e === 0) a0 = pass ? -t : t; else a1 = pass ? L + t : L - t;
  }
  // what is not masonry in this course: openings, lintels (a lintel is one place)
  const gaps = [], lintels = [];
  for (const o of opens) {
    const { r0, r1, l1 } = openingRows(w, o);
    if (r >= r0 && r < r1) gaps.push([o.s0, o.s1, 0]);
    else if (r >= r1 && r < l1) {
      const g = [Math.max(a0, o.s0 - BEAR), Math.min(a1, o.s1 + BEAR)];
      gaps.push([g[0], g[1], k.head]);
      if (r === r1) lintels.push(g);
    }
  }
  gaps.sort((x, y) => x[0] - y[0]);
  const free = [];
  let f = a0;
  for (const [g0, g1, j] of gaps) { if (g0 - j > f) free.push([f, g0 - j]); f = Math.max(f, g1 + j); }
  if (a1 > f) free.push([f, a1]);
  const out = [];
  const lay = (len0, U, off, wAcross, rot, single = true) => {
    // the bond over the whole course, then clipped to the free stretches
    let grid = [];
    if (single && w.v >= 2 && (anch[0] || anch[1])) {
      const below = r > 0 ? courseMemo(w, r - 1, walls, opens).filter((x) => !x.lintel && (x.off || 0) === off).map((x) => x.s1 + k.head / 2) : [];
      // at a corner a whole unit every course; butting into a wall: whole and half by turns
      const endLen = (e) => (corner[e] ? U : r % 2 ? U / 2 : U);
      grid = anchoredGrid(a0, a1, anch[0] ? endLen(0) : len0, U, anch[1] ? endLen(1) : 0, k, below);
    }
    else for (let s = a0, first = true; s < a1; first = false) { const len = first ? len0 : U; grid.push([s, s + len]); s += len + k.head; }
    for (const [f0, f1] of free) {
      const ps = [];
      for (const [u0, u1] of grid) { const c0 = Math.max(u0, f0), c1 = Math.min(u1, f1); if (c1 - c0 > 1) ps.push([c0, c1]); }
      // no sliver: a piece under the minimum and its neighbour become two equal cuts
      const fix = (i, j) => { const t = ps[j][1] - ps[i][0]; const lo = Math.min(ps[i][0], ps[j][0]), hi = Math.max(ps[i][1], ps[j][1]); const h = (hi - lo - k.head) / 2; ps.splice(Math.min(i, j), 2, [lo, lo + h], [hi - h, hi]); void t; };
      if (ps.length > 1 && ps[0][1] - ps[0][0] < k.min) fix(0, 1);
      if (ps.length > 1 && ps.at(-1)[1] - ps.at(-1)[0] < k.min) fix(ps.length - 2, ps.length - 1);
      for (const [c0, c1] of ps) if (c1 - c0 >= Math.min(k.min, 30)) out.push({ s0: c0, s1: c1, off, w: wAcross, rot, cut: c1 - c0 < U - 1 });
    }
  };
  if (k.nb === 1) lay(r % 2 ? k.L / 2 : k.L, k.L, 0, k.T, 0);   // half-brick: stretcher bond
  else if (k.nb) {
    // leaves across the wall from one face: stretchers (¾ start every other stretcher
    // course: the joints step a quarter brick) and headers (a closer first)
    let x = -k.T / 2;
    for (const leaf of brickLeaves(k.nb, r)) {
      const wd = leaf === 'S' ? k.W : k.L, off = x + wd / 2;
      if (leaf === 'S') lay(r % 4 === 0 ? k.L : k.L * 0.75, k.L, off, k.W, 0, false);
      else lay(k.W / 2, k.W, off, k.L, 1, false);
      x += wd + k.head;
    }
  } else lay(r % 2 ? k.L / 2 : k.L, k.L, 0, k.T, 0);
  for (const [g0, g1] of lintels) out.push({ s0: g0, s1: g1, off: 0, w: k.T, rot: 0, lintel: true });
  out.sort((x, y) => x.s0 - y.s0 || x.off - y.off);
  out.forEach((x, i) => { x.i = i; });
  return out;
}

// course() remembered for a while (a course depends on the course below it)
const _memo = new Map();
function courseMemo(w, r, walls, opens) {
  const key = JSON.stringify([w.id, w.a, w.b, w.kind, w.height, w.base, w.v, w.on, r, walls.map((o) => [o.id, o.a, o.b, o.kind, o.on]), opens.map((o) => [o.s0, o.s1, o.kind, o.y0, o.y1])]);
  let c = _memo.get(key);
  if (!c) { if (_memo.size > 3000) _memo.clear(); c = course(w, r, walls, opens); _memo.set(key, c); }
  return c;
}

// where a course is solid (its places merged over the joints): [[s0, s1]…]
export function solid(w, r, walls, opens) {
  const iv = course(w, r, walls, opens).map((x) => [x.s0, x.s1]).sort((a, b) => a[0] - b[0]), out = [];
  for (const [a, b] of iv) { if (out.length && a - out.at(-1)[1] < 20) out.at(-1)[1] = Math.max(out.at(-1)[1], b); else out.push([a, b]); }
  return out;
}

// where mortar can go on a course: where the course is solid, but not over an opening
// below it (at a corner the other wall's course is under the end — that holds it too)
export function beddable(w, r, walls, opens) {
  let out = solid(w, r, walls, opens);
  if (r === 0) return out;
  for (const o of opens) {
    const { r0, r1 } = openingRows(w, o);
    if (r - 1 < r0 || r - 1 >= r1) continue;
    out = out.flatMap(([a, b]) => [[a, Math.min(b, o.s0)], [Math.max(a, o.s1), b]]).filter(([a, b]) => b - a > 10);
  }
  return out;
}

// is a place taken (a unit of this course covering its middle)
export function taken(units, r, sl) {
  const c = (sl.s0 + sl.s1) / 2;
  return units.some((u) => u.row === r && (u.off || 0) === (sl.off || 0) && u.s0 < c && u.s1 > c);
}

// can a place of course r be laid now: the course below must be there under it (a wall
// is raised in steps — a course may run ahead over the part already laid below it).
// Over an opening nothing is needed (a lintel rests on its two bearings); beyond the
// ends of the course below (a corner: the other wall's course) it is not checked.
function support(w, r, st) {
  const k = KINDS[w.kind];
  let units = st.units, lw = w, lr = r - 1;
  if (r === 0) {
    // a tier: on the top course of the wall below
    const low = w.on && st.walls.find((o) => o.id === w.on);
    if (!low) return () => true;
    units = st.lowUnits || []; lw = low; lr = rows(low) - 1;
  }
  const lk = KINDS[lw.kind], lopen = lw === w ? st.opens : (st.lowOpens || []);
  const below = course(lw, lr, st.walls, lopen);
  if (!below.length) return () => false;
  const lo = Math.min(...below.map((x) => x.s0)), hi = Math.max(...below.map((x) => x.s1));
  const laid = units.filter((u) => u.row === lr || (u.lintel && u.row <= lr && u.row + lk.lintelRows > lr)).map((u) => [u.s0 - lk.head - 1, u.s1 + lk.head + 1]);
  const beds = beddable(w, r, st.walls, st.opens);
  return (sl) => {
    for (const [a, b] of beds) {
      const c0 = Math.max(a, sl.s0, lo), c1 = Math.min(b, sl.s1, hi);
      if (c1 - c0 > 1 && covered(laid, c0, c1) < 0.98) return false;
    }
    return true;
  };
}

// the free places that can be laid now, over all courses: [{ r, sl }]
export function layable(w, st) {
  const out = [];
  for (let r = st.cur; r < st.n; r++) {
    const ok = support(w, r, st);
    for (const sl of course(w, r, st.walls, st.opens)) if (!taken(st.units, r, sl) && ok(sl)) out.push({ r, sl });
  }
  return out;
}

// the pallet beside a wall: how many units are still to lay, and how many of them are on
// the pallet standing there now (a pallet holds `cap`; an empty one is replaced by a full one)
export const PALLET = { block: { na: 2, nc: 2, nl: 6 }, brick: { na: 4, nc: 6, nl: 6 } };
export function palletStock(w, st) {
  let total = 0;
  for (let r = 0; r < st.n; r++) total += course(w, r, st.walls, st.opens).filter((x) => !x.lintel).length;
  const left = Math.max(0, total - st.units.filter((u) => !u.lintel).length);
  const g = PALLET[w.kind === 'block' ? 'block' : 'brick'], cap = g.na * g.nc * g.nl;
  return { left, cap, on: left ? (left - 1) % cap + 1 : 0, pallets: Math.ceil(left / cap) };
}

// what a cut piece is called on site
export function cutName(w, sl) {
  const len = Math.round(sl.s1 - sl.s0);
  if (w.kind === 'block') return `Доборный блок ${len} мм — отпилен по месту`;
  const L = sl.rot ? KINDS[w.kind].W : KINDS[w.kind].L;
  const f = len / L;
  const nm = Math.abs(f - 0.75) < 0.08 ? 'Трёхчетвёрка' : Math.abs(f - 0.5) < 0.08 ? 'Половинка' : Math.abs(f - 0.25) < 0.08 ? 'Четвертка' : 'Кирпич';
  return `${nm} — ${len} мм, отколот кирочкой`;
}

// where a slot's unit sits (model): centre, rotation, size (box scale)
export function slotPose(w, r, sl) {
  const k = KINDS[w.kind], { ux, uz, nx, nz } = axis(w);
  const sc = (sl.s0 + sl.s1) / 2 * S, off = sl.off * S;
  const p = new THREE.Vector3(w.a[0] + ux * sc + nx * off, rowY(w, r) + k.H * S / 2, w.a[1] + uz * sc + nz * off);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-uz, ux));
  const h = sl.lintel ? k.lintelRows * (k.H + k.bed) - k.bed : k.H;
  p.y = rowY(w, r) + h * S / 2;
  const s = new THREE.Vector3((sl.s1 - sl.s0) * S, h * S, sl.w * S);
  return { p, q, s };
}

// how much of [s0,s1] the intervals cover (0…1)
export function covered(list, s0, s1) {
  const iv = list.map((x) => [Math.max(s0, x[0]), Math.min(s1, x[1])]).filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  let c = 0, e = s0;
  for (const [a, b] of iv) { if (b <= e) continue; c += b - Math.max(a, e); e = b; }
  return c / Math.max(1e-6, s1 - s0);
}

// the state of a wall: units by row, beds by row, the lowest course not finished
export function wallState(w, objects, extra = []) {
  const units = objects.all('unit').filter((u) => u.wall === w.id);
  const beds = objects.all('bed').filter((b) => b.wall === w.id);
  const walls = [...objects.all('wall').filter((o) => !extra.some((e) => e.id === o.id)), ...extra], opens = objects.all('opening').filter((o) => o.wall === w.id);
  const n = rows(w);
  let cur = n;
  for (let r = 0; r < n; r++) {
    const c = course(w, r, walls, opens);
    if (c.some((sl) => !taken(units, r, sl))) { cur = r; break; }
  }
  const lowUnits = w.on ? objects.all('unit').filter((u) => u.wall === w.on) : null;
  const lowOpens = w.on ? objects.all('opening').filter((o) => o.wall === w.on) : null;
  return { units, beds, walls, opens, cur, n, lowUnits, lowOpens };
}

// ---- view ------------------------------------------------------------------------------
export class WallView {
  constructor(objects) {
    this.objects = objects;
    this.group = new THREE.Group();
    this.group.name = 'walls';
    const box = new THREE.BoxGeometry(1, 1, 1);
    const block = new THREE.MeshStandardMaterial({ map: aeratedTexture(), roughness: 0.92, color: 0xffffff });
    const brick = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.85, color: 0xffffff });
    this.max = { block: 4000, brick: 20000, mortar: 24000, lintel: 200, frame: 800 };
    this.blocks = new THREE.InstancedMesh(box, block, this.max.block);
    this.bricks = new THREE.InstancedMesh(box, brick, this.max.brick);
    this.mortar = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x4a4740, roughness: 0.95 }), this.max.mortar);
    // precast concrete lintels; the marked frame of a planned opening (orange, like the cord)
    this.lintels = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.9 }), this.max.lintel);
    this.frames = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xff6a1c, roughness: 0.6, emissive: 0x401000 }), this.max.frame);
    this.cord = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshStandardMaterial({ color: 0xff4a1c, roughness: 0.6 }));
    for (const m of [this.blocks, this.bricks, this.mortar]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.count = 0; this.group.add(m); }
    // pallets beside the walls: the wooden pallet (boards) — the blocks on it are drawn as blocks
    this.max.wood = 1200;
    this.wood = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xb9925e, roughness: 0.85 }), this.max.wood);
    // U-blocks (a channel open upwards: the shell of a monolithic lintel) and the concrete in them
    this.ublocks = new THREE.InstancedMesh(uShape(), block, this.max.block);
    // the concrete in the channels: one surface along each run (its levels: uPour.js)
    this.concU = { uClock: { value: 0 }, uCure: { value: CONCRETE.cure } };   // (the clock: main.js)
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), makeCastConcreteMaterial(this.concU));
    this.fillLive = null;   // levels by U-block id while it is being poured (the tool)
    this.fillDirty = false;
    for (const m of [this.ublocks, this.fill]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }
    this.ublocks.count = 0;
    this.wood.castShadow = this.wood.receiveShadow = true; this.wood.frustumCulled = false; this.wood.count = 0; this.group.add(this.wood);
    this.lintels.castShadow = this.lintels.receiveShadow = true;
    for (const m of [this.lintels, this.frames]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this.cord.visible = false; this.group.add(this.cord);
    // the mortar under a brick being laid and what is pressed out of it (mortarSqueeze.js)
    this.squeeze = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x5a564e, roughness: 0.75, side: THREE.DoubleSide }));
    this.squeeze.castShadow = this.squeeze.receiveShadow = true; this.squeeze.frustumCulled = false; this.squeeze.visible = false;
    this.group.add(this.squeeze);
    // where the carried unit would go: green — it can, red — it cannot
    this.hlMesh = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x35d06a, transparent: true, opacity: 0.45, depthWrite: false }));
    this.hlMesh.renderOrder = 5; this.hlMesh.visible = false; this.group.add(this.hlMesh);
    this.hl = null;        // { p, q, s, ok }
    for (const m of [this.blocks, this.bricks]) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m === this.blocks ? this.max.block * 3 : this.max.brick * 3), 3);
    this.owner = { blocks: [], bricks: [], lintels: [], frames: [], ublocks: [], fill: [], wood: [] };
    this.dirty = true;
    this.live = null;      // a unit in the hand / being set (wallTool)
    this.focus = null;     // wall id whose next course gets the cord
    this.marks = false;    // planned openings shown (while working on walls)
    objects.on((id, rec) => { if (['wall', 'unit', 'bed', 'opening'].includes(rec?.type) || this._known?.has(id)) this.dirty = true; });
  }

  update() {
    if (!this.dirty) { if (this.fillDirty) this._buildFill(); return; }
    this.dirty = false;
    const O = this.objects, walls = O.all('wall'), m = new THREE.Matrix4(), c = new THREE.Color();
    this._known = new Set([...walls, ...O.all('unit'), ...O.all('bed'), ...O.all('opening')].map((r) => r.id));
    let nb = 0, nk = 0, nm = 0, nl = 0, nf = 0, nw = 0, nu = 0, nc = 0;
    const c3 = new THREE.Color();
    this.owner = { blocks: [], bricks: [], lintels: [], frames: [], ublocks: [], fill: [], wood: [] };
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    const put = (u, id) => {
      P.fromArray(u.p); Q.fromArray(u.q); Sv.fromArray(u.s);
      const h = hash(u.row * 131 + u.i * 17 + (id || 0) * 7 + Math.round(u.off || 0));
      if (u.lintel) {
        if (nl < this.max.lintel) { this.lintels.setMatrixAt(nl, m.compose(P, Q, Sv)); this.owner.lintels[nl++] = id; }
      } else if (u.kind === 'ublock') {
        // a U-block: the shell (its channel open upwards) and the concrete in the channel
        if (nu < this.max.block) { this.ublocks.setMatrixAt(nu, m.compose(P, Q, Sv)); this.owner.ublocks[nu++] = id; }
      } else if (u.kind === 'prop') {
        // a temporary prop: the board and two posts down to the floor
        if (nw < this.max.wood - 3) {
          this.wood.setMatrixAt(nw, m.compose(P, Q, Sv)); this.owner.wood[nw++] = id;
          const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(Q), ph = u.post || 0, d = 80 * S;
          for (const sg of [-1, 1]) {
            const C = P.clone().addScaledVector(ux, sg * (Sv.x / 2 - d)); C.y -= Sv.y / 2 + ph / 2;
            this.wood.setMatrixAt(nw, m.compose(C, Q, new THREE.Vector3(d, ph, d))); this.owner.wood[nw++] = id;
          }
        }
      } else if (u.kind === 'block' && nb < this.max.block) {
        const cut = u.cut ? 0.035 : 0;   // a sawn face is a shade whiter
        this.blocks.setMatrixAt(nb, m.compose(P, Q, Sv));
        this.blocks.setColorAt(nb, c.setRGB(0.84 + h * 0.06 + cut, 0.835 + h * 0.05 + cut, 0.81 + h * 0.05 + cut));
        this.owner.blocks[nb++] = id;
      } else if (u.kind === 'brick' || u.kind === 'brick2' || u.kind === 'brick3' || u.kind === 'brick4' || u.kind === 'brick5' || !u.kind) {
        if (nk >= this.max.brick) return;
        this.bricks.setMatrixAt(nk, m.compose(P, Q, Sv));
        this.bricks.setColorAt(nk, c.setRGB(0.46 + h * 0.14, 0.17 + h * 0.06, 0.11 + h * 0.04));
        this.owner.bricks[nk++] = id;
      }
    };
    for (const w of walls) {
      const k = KINDS[w.kind], st = wallState(w, O), { ux, uz, nx, nz } = axis(w);
      const yaw = Math.atan2(-uz, ux), q = new THREE.Quaternion().setFromAxisAngle(_Y, yaw);
      for (const u of st.units) put(u, u.id);
      // mortar beds: a strip under the course, a little narrower than the wall
      for (const b of [...st.beds, ...(this.liveBed?.wall === w.id ? [this.liveBed] : [])]) {
        if (nm >= this.max.mortar) break;
        const t = b.row === 0 ? k.bed0 : k.bed, sc = (b.s0 + b.s1) / 2 * S;
        P.set(w.a[0] + ux * sc, rowY(w, b.row) - t * S / 2, w.a[1] + uz * sc);
        Sv.set((b.s1 - b.s0) * S, t * S, (k.T - (w.kind === 'block' ? 10 : 20)) * S);
        this.mortar.setMatrixAt(nm++, m.compose(P, q, Sv));
      }
      // head joints between laid neighbours (brick: mortar shows; blocks: thin glue)
      const byRow = new Map();
      for (const u of st.units) { const key = `${u.row}:${u.off || 0}`; (byRow.get(key) || byRow.set(key, []).get(key)).push(u); }
      for (const list of byRow.values()) {
        list.sort((a, b) => a.s0 - b.s0);
        for (let j = 1; j < list.length && nm < this.max.mortar; j++) {
          const A = list[j - 1], B = list[j];
          if (B.s0 - A.s1 > k.head * 1.5 || B.s0 < A.s1) continue;
          const sc = (A.s1 + B.s0) / 2 * S, y = rowY(w, A.row) + k.H * S / 2;
          P.set(w.a[0] + ux * sc + nx * (A.off || 0) * S, y, w.a[1] + uz * sc + nz * (A.off || 0) * S);
          Sv.set((B.s0 - A.s1) * S, k.H * S * 0.96, A.s[2] * 0.92);
          this.mortar.setMatrixAt(nm++, m.compose(P, q, Sv));
        }
      }
      // the pallet: 1200 × 800 mm, the rest of the blocks (bricks) stacked on it
      if (w.pallet && nw < 390) {
        const [px, pz, pyaw] = w.pallet, g = this.terrainY ? this.terrainY(px, pz) : w.base;
        const pq = new THREE.Quaternion().setFromAxisAngle(_Y, pyaw), ex = new THREE.Vector3(1, 0, 0).applyQuaternion(pq), ez = new THREE.Vector3(0, 0, 1).applyQuaternion(pq);
        const at = (a, y, c, sx, sy, sz) => { P.set(px + ex.x * a * S + ez.x * c * S, g + y * S, pz + ex.z * a * S + ez.z * c * S); Sv.set(sx * S, sy * S, sz * S); return m.compose(P, pq, Sv); };
        for (const c of [-350, 0, 350]) this.wood.setMatrixAt(nw++, at(0, 50, c, 1200, 100, 100));          // bearers
        for (let a = -540; a <= 540; a += 135) this.wood.setMatrixAt(nw++, at(a, 111, 0, 100, 22, 800));     // top boards
        // what is left on this pallet, as a stack (a full one replaces an empty one)
        const left = palletStock(w, st).on, bl = w.kind === 'block', pg = PALLET[bl ? 'block' : 'brick'];
        const L = bl ? 600 : 250, Hh = bl ? 250 : 65, Tt = bl ? 300 : 120, na = pg.na, nc = pg.nc;
        for (let i = 0; i < left; i++) {
          const lay = Math.floor(i / (na * nc)), j = i % (na * nc), ia = j % na, ic = Math.floor(j / na);
          const a = (ia - (na - 1) / 2) * (L + 4), c = (ic - (nc - 1) / 2) * (Tt + 4), y = 122 + lay * (Hh + 2) + Hh / 2;
          at(a, y, c, L, Hh, Tt);
          if (bl && nb < this.max.block) { this.blocks.setMatrixAt(nb, m.compose(P, pq, Sv)); this.blocks.setColorAt(nb, c3.setRGB(0.86, 0.855, 0.83)); this.owner.blocks[nb++] = null; }
          else if (!bl && nk < this.max.brick) { const h = hash(i * 7 + w.id); this.bricks.setMatrixAt(nk, m.compose(P, pq, Sv)); this.bricks.setColorAt(nk, c3.setRGB(0.46 + h * 0.14, 0.17 + h * 0.06, 0.11 + h * 0.04)); this.owner.bricks[nk++] = null; }
        }
      }
      // planned openings: an orange frame on both faces until the masonry is round them
      for (const o of this.marks ? [...st.opens, ...(this.liveOpening?.wall === w.id ? [this.liveOpening] : [])] : []) {
        const { r0, r1 } = openingRows(w, o), y0 = rowY(w, r0) - (r0 === 0 ? k.bed0 * S : 0), y1 = rowY(w, r1) - k.bed * S;
        const bar = 25 * S;
        for (const sg of [-1, 1]) {
          const fo = sg * (k.T / 2 + 3) * S;
          const at = (s0, s1, ya, yb) => {
            if (nf >= this.max.frame) return;
            const sc = (s0 + s1) / 2 * S;
            P.set(w.a[0] + ux * sc + nx * fo, (ya + yb) / 2, w.a[1] + uz * sc + nz * fo);
            Sv.set(Math.max(bar, (s1 - s0) * S), Math.max(bar, yb - ya), 4 * S);
            this.frames.setMatrixAt(nf, m.compose(P, q, Sv)); this.owner.frames[nf++] = o.id;
          };
          at(o.s0, o.s0, y0, y1); at(o.s1, o.s1, y0, y1); at(o.s0, o.s1, y1 - bar, y1);
          if (r0 > 0) at(o.s0, o.s1, y0, y0 + bar);
        }
      }
      // the cord stretched along the top of the course being laid
      if (w.id === this.focus && st.cur < st.n) {
        const cs = course(w, st.cur, st.walls, st.opens);
        const s0 = Math.min(...cs.map((x) => x.s0)), s1 = Math.max(...cs.map((x) => x.s1));
        const off = (k.T / 2 + 4) * S, y = rowY(w, st.cur) + k.H * S;
        const A = new THREE.Vector3(w.a[0] + ux * (s0 - 150) * S + nx * off, y, w.a[1] + uz * (s0 - 150) * S + nz * off);
        const B = new THREE.Vector3(w.a[0] + ux * (s1 + 150) * S + nx * off, y, w.a[1] + uz * (s1 + 150) * S + nz * off);
        this.cord.visible = true;
        this.cord.position.copy(A).add(B).multiplyScalar(0.5);
        this.cord.quaternion.setFromUnitVectors(_Y, B.clone().sub(A).normalize());
        this.cord.scale.set(0.0012 / MODEL_SCALE, A.distanceTo(B), 0.0012 / MODEL_SCALE);
      }
    }
    // free masonry: the units, the bed under each and a head joint only between neighbours
    for (const u of O.all('unit')) if (u.free) put(u, u.id);
    for (const j of mortarOf(O.all('unit'))) {
      if (nm >= this.max.mortar) break;
      P.set(j.x, j.y, j.z); Q.setFromAxisAngle(_Y, j.yaw); Sv.set(j.l, j.h, j.w);
      this.mortar.setMatrixAt(nm++, m.compose(P, Q, Sv));
    }
    if (!walls.some((w) => w.id === this.focus)) this.cord.visible = false;
    if (this.live) put(this.live, null);
    this.hlMesh.visible = !!this.hl;
    if (this.hl) {
      this.hlMesh.position.fromArray(this.hl.p); this.hlMesh.quaternion.fromArray(this.hl.q);
      this.hlMesh.scale.fromArray(this.hl.s).multiplyScalar(1.03);
      this.hlMesh.material.color.setHex(this.hl.ok ? 0x35d06a : 0xe8402a);
    }
    this.blocks.count = nb; this.bricks.count = nk; this.mortar.count = nm; this.lintels.count = nl; this.frames.count = nf; this.wood.count = nw; this.ublocks.count = nu;
    for (const im of [this.blocks, this.bricks, this.mortar, this.lintels, this.frames, this.wood, this.ublocks]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    this._buildFill();
    for (const im of [this.blocks, this.bricks]) im.instanceColor.needsUpdate = true;
  }

  // the concrete in the U-block channels: a surface over the levels of each block (UN
  // samples, joined to the next block of the run), a little higher at the walls (it
  // clings), end caps where the run ends; fresh — dark and wet, set — light
  _buildFill() {
    this.fillDirty = false;
    const us = this.objects.all('unit').filter((u) => u.kind === 'ublock');
    const lvOf = (u) => this.fillLive?.get(u.id) ?? levels(u);
    const pos = [], col = [], idx = [], own = [], pt = [];
    const m = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3(), v = new THREE.Vector3();
    const info = us.map((u) => { const yaw = 2 * Math.atan2(u.q[1], u.q[3]); return { u, lv: lvOf(u), ux: Math.cos(yaw), uz: -Math.sin(yaw) }; });
    // the neighbour's level at the shared end (or null)
    const endOf = (a, sg) => {
      for (const b of info) {
        if (b === a || Math.abs(b.u.p[1] - a.u.p[1]) > 0.0008) continue;
        const dx = b.u.p[0] - a.u.p[0], dz = b.u.p[2] - a.u.p[2], al = (dx * a.ux + dz * a.uz) * sg, sd = -dx * a.uz + dz * a.ux;
        if (Math.abs(sd) > 0.0008 || Math.abs(al - (a.u.s[0] + b.u.s[0]) / 2) > 0.0015) continue;
        // which end of b touches: the one facing a
        const same = b.ux * a.ux + b.uz * a.uz > 0;
        return (sg > 0) === same ? b.lv[0] : b.lv[UN - 1];
      }
      return null;
    };
    const fl = 60 / 250 - 0.5, hy = (h) => fl + Math.max(0, h) / 250, zs = [-0.25, -0.15, 0, 0.15, 0.25], lift = [1.5, 0.4, 0, 0.4, 1.5];
    for (const a of info) {
      const lv = a.lv;
      if (!lv.some((h) => h > 0.3)) continue;
      const u = a.u;
      P.fromArray(u.p); Q.fromArray(u.q); Sv.fromArray(u.s); m.compose(P, Q, Sv);
      // (the colour comes from the concrete shader, by the time it was poured; set = long ago)
      const c = [1, 1, 1], tp = u.set ? -1e6 : u.pourT ?? u.castT ?? 1e9;
      const nL = endOf(a, -1), nR = endOf(a, 1);
      // the stations along: the two ends and the cell centres
      const st = [[-0.5, nL != null ? (lv[0] + nL) / 2 : lv[0]]];
      for (let i = 0; i < UN; i++) st.push([-0.5 + (i + 0.5) / UN, lv[i]]);
      st.push([0.5, nR != null ? (lv[UN - 1] + nR) / 2 : lv[UN - 1]]);
      const o = pos.length / 3, mh = Sv.y;
      for (const [x, h] of st) for (let k = 0; k < zs.length; k++) {
        v.set(x, hy(h + (h > 0.3 ? lift[k] : 0)), zs[k]).applyMatrix4(m);
        pos.push(v.x, v.y, v.z); col.push(...c); pt.push(tp);
      }
      const W = zs.length;
      for (let i = 0; i + 1 < st.length; i++) for (let k = 0; k + 1 < W; k++) {
        const p0 = o + i * W + k, p1 = p0 + 1, p2 = p0 + W, p3 = p2 + 1;
        idx.push(p0, p1, p2, p1, p3, p2); own.push(u.id, u.id);
      }
      // end caps where the run ends (the open end of the channel)
      for (const [x, h, open, flip] of [[-0.5, st[0][1], nL == null, true], [0.5, st.at(-1)[1], nR == null, false]]) {
        if (!open || h < 0.3) continue;
        const b = pos.length / 3;
        for (const [y, z] of [[hy(0), -0.25], [hy(0), 0.25], [hy(h), -0.25], [hy(h), 0.25]]) { v.set(x, y, z).applyMatrix4(m); pos.push(v.x, v.y, v.z); col.push(...c.map((q) => q * 0.85)); pt.push(tp); }
        if (flip) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        own.push(u.id, u.id);
      }
      void mh;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aPour', new THREE.Float32BufferAttribute(pt, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.fill.geometry.dispose();
    this.fill.geometry = g;
    this.fill.visible = idx.length > 0;
    this.owner.fill = own;
  }

  ownerOf(hit) {
    if (hit.object === this.blocks) return this.owner.blocks[hit.instanceId];
    if (hit.object === this.bricks) return this.owner.bricks[hit.instanceId];
    if (hit.object === this.lintels) return this.owner.lintels[hit.instanceId];
    if (hit.object === this.frames) return this.owner.frames[hit.instanceId];
    if (hit.object === this.ublocks) return this.owner.ublocks[hit.instanceId];
    if (hit.object === this.fill) return this.owner.fill[Math.floor(hit.faceIndex)] ?? null;
    if (hit.object === this.wood) return this.owner.wood[hit.instanceId] ?? null;
    return null;
  }
}

const _Y = new THREE.Vector3(0, 1, 0);
// a U-block in a unit box: the bottom (60 of 250 mm) and two walls (75 of 300 mm each)
function uShape() {
  const parts = [[0, -0.5 + 0.12, 0, 1, 0.24, 1], [0, 0.12, -0.375, 1, 0.76, 0.25], [0, 0.12, 0.375, 1, 0.76, 0.25]];
  const pos = [], nor = [], uv = [], idx = [];
  for (const [x, y, z, w, h, d] of parts) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
    const o = pos.length / 3;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    idx.push(...Array.from(g.index.array, (i) => i + o));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function hash(i) { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

// aerated concrete: white-grey with small round pores, saw marks
function aeratedTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e7e1'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = Math.random() < 0.9 ? 0.6 + Math.random() * 0.9 : 1.5 + Math.random() * 1.6;
    g.fillStyle = `rgba(120,116,108,${0.25 + Math.random() * 0.35})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let y = 0; y < 256; y += 3) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; g.fillRect(0, y, 256, 1); }
  // the joint: glue squeezed out and the shadow of the chamfered edge — a dark line round each face
  g.strokeStyle = 'rgba(70,66,60,0.85)'; g.lineWidth = 5; g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(90,86,80,0.35)'; g.lineWidth = 12; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// a fired clay brick: speckles, darker flecks, slightly scorched edges
function brickTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const v = 150 + Math.random() * 105;
    g.fillStyle = `rgba(${v},${v * 0.92},${v * 0.88},0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const e = g.createLinearGradient(0, 0, 0, 128);
  e.addColorStop(0, 'rgba(60,30,20,0.22)'); e.addColorStop(0.06, 'rgba(0,0,0,0)'); e.addColorStop(0.94, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(60,30,20,0.22)');
  g.fillStyle = e; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
