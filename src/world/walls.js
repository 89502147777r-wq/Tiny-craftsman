import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// Masonry walls, laid the way they are on site.
// Records (objects store):
//   wall { a:[x,z], b:[x,z], kind, base, height }   – the axis of a wall (model units),
//          base = the top of the foundation it stands on, height = planned (real mm)
//   bed  { wall, row, s0, s1 }                       – a strip of mortar / glue spread on
//          a course, s along the axis from a (real mm)
//   unit { wall, row, i, s0, s1, off, p, q, s, kind } – a block / brick as it was laid
// Sizes in real millimetres; the model is 1:3.5.
export const KINDS = {
  block: { name: 'Газоблок', L: 600, H: 250, T: 300, bed0: 20, bed: 3, head: 3, min: 100, lintelRows: 1 },     // aerated concrete on glue (first course on mortar)
  brick: { name: 'Кирпич ½', L: 250, H: 65, T: 120, bed0: 12, bed: 12, head: 10, min: 55, lintelRows: 2 },    // half-brick wall, stretcher bond
  brick2: { name: 'Кирпич 1', L: 250, H: 65, T: 250, W: 120, bed0: 12, bed: 12, head: 10, min: 55, lintelRows: 2 },  // one-brick wall: stretcher and header courses
};
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
  const p = e ? w.b : w.a, tol = 0.012;
  for (const o of walls) {
    if (o.id === w.id) continue;
    for (const q of [o.a, o.b]) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < tol) return o;
  }
  return null;
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
  const lay = (len0, U, off, wAcross, rot) => {
    // the bond over the whole course, then clipped to the free stretches
    const grid = [];
    for (let s = a0, first = true; s < a1; first = false) { const len = first ? len0 : U; grid.push([s, s + len]); s += len + k.head; }
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
  if (w.kind === 'brick2') {
    if (r % 2 === 0) { for (const sg of [-1, 1]) lay(r % 4 === 0 ? k.L : k.L * 0.75, k.L, sg * (k.T - k.W) / 2, k.W, 0); }   // two leaves of stretchers
    else lay(k.W / 2, k.W, 0, k.T, 1);                                                                                   // headers across
  } else lay(r % 2 ? k.L / 2 : k.L, k.L, 0, k.T, 0);
  for (const [g0, g1] of lintels) out.push({ s0: g0, s1: g1, off: 0, w: k.T, rot: 0, lintel: true });
  out.sort((x, y) => x.s0 - y.s0 || x.off - y.off);
  out.forEach((x, i) => { x.i = i; });
  return out;
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
export function wallState(w, objects) {
  const units = objects.all('unit').filter((u) => u.wall === w.id);
  const beds = objects.all('bed').filter((b) => b.wall === w.id);
  const walls = objects.all('wall'), opens = objects.all('opening').filter((o) => o.wall === w.id);
  const n = rows(w);
  let cur = n;
  for (let r = 0; r < n; r++) {
    const c = course(w, r, walls, opens);
    if (c.some((sl) => !taken(units, r, sl))) { cur = r; break; }
  }
  return { units, beds, walls, opens, cur, n };
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
    this.mortar = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95 }), this.max.mortar);
    // precast concrete lintels; the marked frame of a planned opening (orange, like the cord)
    this.lintels = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.9 }), this.max.lintel);
    this.frames = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xff6a1c, roughness: 0.6, emissive: 0x401000 }), this.max.frame);
    this.cord = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshStandardMaterial({ color: 0xff4a1c, roughness: 0.6 }));
    for (const m of [this.blocks, this.bricks, this.mortar]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.count = 0; this.group.add(m); }
    // pallets beside the walls: the wooden pallet (boards) — the blocks on it are drawn as blocks
    this.wood = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xb9925e, roughness: 0.85 }), 400);
    this.wood.castShadow = this.wood.receiveShadow = true; this.wood.frustumCulled = false; this.wood.count = 0; this.group.add(this.wood);
    this.lintels.castShadow = this.lintels.receiveShadow = true;
    for (const m of [this.lintels, this.frames]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this.cord.visible = false; this.group.add(this.cord);
    for (const m of [this.blocks, this.bricks]) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m === this.blocks ? this.max.block * 3 : this.max.brick * 3), 3);
    this.owner = { blocks: [], bricks: [], lintels: [], frames: [] };
    this.dirty = true;
    this.live = null;      // a unit in the hand / being set (wallTool)
    this.focus = null;     // wall id whose next course gets the cord
    this.marks = false;    // planned openings shown (while working on walls)
    objects.on((id, rec) => { if (['wall', 'unit', 'bed', 'opening'].includes(rec?.type) || this._known?.has(id)) this.dirty = true; });
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    const O = this.objects, walls = O.all('wall'), m = new THREE.Matrix4(), c = new THREE.Color();
    this._known = new Set([...walls, ...O.all('unit'), ...O.all('bed'), ...O.all('opening')].map((r) => r.id));
    let nb = 0, nk = 0, nm = 0, nl = 0, nf = 0, nw = 0;
    const c3 = new THREE.Color();
    this.owner = { blocks: [], bricks: [], lintels: [], frames: [] };
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    const put = (u, id) => {
      P.fromArray(u.p); Q.fromArray(u.q); Sv.fromArray(u.s);
      const h = hash(u.row * 131 + u.i * 17 + (id || 0) * 7 + Math.round(u.off || 0));
      if (u.lintel) {
        if (nl < this.max.lintel) { this.lintels.setMatrixAt(nl, m.compose(P, Q, Sv)); this.owner.lintels[nl++] = id; }
      } else if (u.kind === 'block' && nb < this.max.block) {
        const cut = u.cut ? 0.035 : 0;   // a sawn face is a shade whiter
        this.blocks.setMatrixAt(nb, m.compose(P, Q, Sv));
        this.blocks.setColorAt(nb, c.setRGB(0.84 + h * 0.06 + cut, 0.835 + h * 0.05 + cut, 0.81 + h * 0.05 + cut));
        this.owner.blocks[nb++] = id;
      } else if (u.kind !== 'block' && nk < this.max.brick) {
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
          Sv.set((B.s0 - A.s1) * S, k.H * S * 0.96, (A.rot ? k.T : (k.W || k.T)) * S * 0.92);
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
        // how many are left (all the places of the wall less the laid ones), as a stack
        let total = 0;
        for (let r = 0; r < st.n; r++) total += course(w, r, st.walls, st.opens).filter((x) => !x.lintel).length;
        let left = Math.max(0, total - st.units.filter((u) => !u.lintel).length);
        const bl = w.kind === 'block';
        const L = bl ? 600 : 250, Hh = bl ? 250 : 65, Tt = bl ? 300 : 120, na = bl ? 2 : 4, nc = bl ? 2 : 6, nl = bl ? 3 : 6;   // a low stack: it must not hide the wall
        left = Math.min(left, na * nc * nl);
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
        this.cord.scale.set(0.0012 / 3.5, A.distanceTo(B), 0.0012 / 3.5);
      }
    }
    if (!walls.some((w) => w.id === this.focus)) this.cord.visible = false;
    if (this.live) put(this.live, null);
    this.blocks.count = nb; this.bricks.count = nk; this.mortar.count = nm; this.lintels.count = nl; this.frames.count = nf; this.wood.count = nw;
    for (const im of [this.blocks, this.bricks, this.mortar, this.lintels, this.frames, this.wood]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    for (const im of [this.blocks, this.bricks]) im.instanceColor.needsUpdate = true;
  }

  ownerOf(hit) {
    if (hit.object === this.blocks) return this.owner.blocks[hit.instanceId];
    if (hit.object === this.bricks) return this.owner.bricks[hit.instanceId];
    if (hit.object === this.lintels) return this.owner.lintels[hit.instanceId];
    if (hit.object === this.frames) return this.owner.frames[hit.instanceId];
    return null;
  }
}

const _Y = new THREE.Vector3(0, 1, 0);
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
  e.addColorStop(0, 'rgba(60,30,20,0.25)'); e.addColorStop(0.08, 'rgba(0,0,0,0)'); e.addColorStop(0.92, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(60,30,20,0.25)');
  g.fillStyle = e; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
