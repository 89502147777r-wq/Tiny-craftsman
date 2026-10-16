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
  block: { name: 'Газоблок', L: 600, H: 250, T: 300, bed0: 20, bed: 3, head: 3 },     // aerated concrete on glue (first course on mortar)
  brick: { name: 'Кирпич ½', L: 250, H: 65, T: 120, bed0: 12, bed: 12, head: 10 },    // half-brick wall, stretcher bond
  brick2: { name: 'Кирпич 1', L: 250, H: 65, T: 250, W: 120, bed0: 12, bed: 12, head: 10 },  // one-brick wall: stretcher and header courses
};
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

// The slots of one course: [{ i, s0, s1, off, w, rot }] — s along the axis (real mm),
// off across it, w the size across, rot = 1 for a header (brick across the wall).
// Running bond: every other course starts with a half; at a corner the courses of the
// two walls interlock (one passes through, then the other).
export function course(w, r, walls) {
  const k = KINDS[w.kind], { L } = axis(w);
  let a0 = 0, a1 = L;
  for (const e of [0, 1]) {
    const o = cornerAt(w, e, walls);
    if (!o) continue;
    const pass = (r + (w.id < o.id ? 0 : 1)) % 2 === 0, t = KINDS[o.kind].T / 2;
    if (e === 0) a0 = pass ? -t : t; else a1 = pass ? L + t : L - t;
  }
  const out = [];
  const lay = (len0, U, off, wAcross, rot) => {
    let s = a0, first = true;
    while (s < a1 - 20) {
      let len = first ? len0 : U;
      first = false;
      const rest = a1 - s;
      if (rest - len < U * 0.25 && rest > len) len = (rest - k.head) / 2;   // no sliver at the end: two equal cuts
      len = Math.min(len, rest);
      out.push({ i: out.length, s0: s, s1: s + len, off, w: wAcross, rot });
      s += len + k.head;
    }
  };
  if (w.kind === 'brick2') {
    if (r % 2 === 0) { for (const sg of [-1, 1]) lay(r % 4 === 0 ? k.L : k.L * 0.75, k.L, sg * (k.T - k.W) / 2, k.W, 0); }   // two leaves of stretchers
    else lay(k.W / 2 + 0, k.W, 0, k.T, 1);                                                                               // headers across
  } else lay(r % 2 ? k.L / 2 : k.L, k.L, 0, k.T, 0);
  return out;
}

// where a slot's unit sits (model): centre, rotation, size (box scale)
export function slotPose(w, r, sl) {
  const k = KINDS[w.kind], { ux, uz, nx, nz } = axis(w);
  const sc = (sl.s0 + sl.s1) / 2 * S, off = sl.off * S;
  const p = new THREE.Vector3(w.a[0] + ux * sc + nx * off, rowY(w, r) + k.H * S / 2, w.a[1] + uz * sc + nz * off);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-uz, ux));
  const s = new THREE.Vector3((sl.s1 - sl.s0) * S, k.H * S, sl.w * S);
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
  const walls = objects.all('wall');
  const n = rows(w);
  let cur = n;
  for (let r = 0; r < n; r++) {
    const c = course(w, r, walls);
    if (c.some((sl) => !units.some((u) => u.row === r && u.i === sl.i))) { cur = r; break; }
  }
  return { units, beds, walls, cur, n };
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
    this.max = { block: 4000, brick: 20000, mortar: 24000, ghost: 400 };
    this.blocks = new THREE.InstancedMesh(box, block, this.max.block);
    this.bricks = new THREE.InstancedMesh(box, brick, this.max.brick);
    this.mortar = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95 }), this.max.mortar);
    this.ghost = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0x7fd18a, transparent: true, opacity: 0.22, depthWrite: false }), this.max.ghost);
    this.cord = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshStandardMaterial({ color: 0xff4a1c, roughness: 0.6 }));
    for (const m of [this.blocks, this.bricks, this.mortar]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this.ghost.frustumCulled = false; this.ghost.count = 0; this.group.add(this.ghost);
    this.cord.visible = false; this.group.add(this.cord);
    for (const m of [this.blocks, this.bricks]) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m === this.blocks ? this.max.block * 3 : this.max.brick * 3), 3);
    this.owner = { blocks: [], bricks: [] };
    this.dirty = true;
    this.live = null;      // a unit in the hand / being set (wallTool)
    this.focus = null;     // wall id whose next course is shown (ghosts + cord)
    objects.on((id, rec) => { if (['wall', 'unit', 'bed'].includes(rec?.type) || this._known?.has(id)) this.dirty = true; });
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    const O = this.objects, walls = O.all('wall'), m = new THREE.Matrix4(), c = new THREE.Color();
    this._known = new Set([...walls, ...O.all('unit'), ...O.all('bed')].map((r) => r.id));
    let nb = 0, nk = 0, nm = 0, ng = 0;
    this.owner = { blocks: [], bricks: [] };
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    const put = (u, id) => {
      P.fromArray(u.p); Q.fromArray(u.q); Sv.fromArray(u.s);
      const h = hash(u.row * 131 + u.i * 17 + (id || 0) * 7 + Math.round(u.off || 0));
      if (u.kind === 'block' && nb < this.max.block) {
        this.blocks.setMatrixAt(nb, m.compose(P, Q, Sv));
        this.blocks.setColorAt(nb, c.setRGB(0.84 + h * 0.06, 0.835 + h * 0.05, 0.81 + h * 0.05));
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
      // the next course: where the units go (ghosts) and the cord stretched along its top
      if (w.id === this.focus && st.cur < st.n) {
        const cs = course(w, st.cur, st.walls);
        for (const sl of cs) {
          if (st.units.some((u) => u.row === st.cur && u.i === sl.i) || ng >= this.max.ghost) continue;
          const ps = slotPose(w, st.cur, sl);
          this.ghost.setMatrixAt(ng++, m.compose(ps.p, ps.q, ps.s.multiplyScalar(1.002)));
        }
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
    this.blocks.count = nb; this.bricks.count = nk; this.mortar.count = nm; this.ghost.count = ng;
    for (const im of [this.blocks, this.bricks, this.mortar, this.ghost]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    for (const im of [this.blocks, this.bricks]) im.instanceColor.needsUpdate = true;
  }

  ownerOf(hit) {
    if (hit.object === this.blocks) return this.owner.blocks[hit.instanceId];
    if (hit.object === this.bricks) return this.owner.bricks[hit.instanceId];
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
