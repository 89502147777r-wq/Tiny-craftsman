import * as THREE from 'three';
import { MAT, MODEL_SCALE, TRAY } from '../config.js';
import { contains, bbox, gradeY, offsetPolyline } from './outlines.js';

const MM = (v) => v / 1000 / MODEL_SCALE; // real millimetres → model metres
const CHAIR_R = MM(25) / 0.81;            // plastic chair: Ø50 mm footprint (geometry base radius 0.81)
const chairH = (h) => Math.min(MM(120), Math.max(MM(15), h));

// Records:
//   bar  { a: [x,y,z], b: [x,y,z], d }                     – a single bar
//   cage { outlineId, bars: [[ax,ay,az,bx,by,bz,d]…], chairs: [[x,y,z,h]…],
//          frogs: [[x,y,z,yaw,h]…], ties: [[x,y,z]…], tied }   – auto layout
//   mesh { x0, z0, x1, z1, y, cell, d }                     – welded mesh panel
export class RebarView {
  constructor(objects) {
    this.objects = objects;
    this.group = new THREE.Group();
    this.group.name = 'rebar';
    this.max = { rods: 6000, chairs: 1500, frogs: 600, ties: 6000, stars: 600 };
    const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    rodGeo.translate(0, 0.5, 0);
    rodGeo.setAttribute('aRib', new THREE.InstancedBufferAttribute(new Float32Array(this.max.rods), 1));
    this.rods = new THREE.InstancedMesh(rodGeo, makeRebarMaterial(), this.max.rods);
    this.chairs = new THREE.InstancedMesh(makeChairGeometry(), new THREE.MeshStandardMaterial({ color: 0x505457, roughness: 0.55 }), this.max.chairs);
    this.frogs = new THREE.InstancedMesh(makeFrogGeometry(), new THREE.MeshStandardMaterial({ color: 0x5d4a3e, roughness: 0.6, metalness: 0.5 }), this.max.frogs);
    this.ties = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.28, 5, 10), new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.45, metalness: 0.7 }), this.max.ties);
    // plastic wheel spacers («звёздочки») clipped on the bars: dark grey plastic
    this.stars = new THREE.InstancedMesh(makeStarGeometry(), new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.5 }), this.max.stars);
    for (const m of [this.rods, this.chairs, this.frogs, this.ties, this.stars]) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    this.owner = { rods: [], chairs: [], frogs: [], ties: [], stars: [] };
    this.dirty = true;
    this._types = new Set(['bar', 'cage', 'mesh']);
    objects.on((id, rec) => { if (this._types.has(rec?.type) || this._known?.has(id)) this.dirty = true; });
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    const recs = this.objects.all().filter((r) => this._types.has(r.type));
    this._known = new Set(recs.map((r) => r.id));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    const aRib = this.rods.geometry.attributes.aRib;
    const o = (this.owner = { rods: [], chairs: [], frogs: [], ties: [], stars: [] });
    let nr = 0, nc = 0, nf = 0, nt = 0, ns = 0;
    const rod = (ax, ay, az, bx, by, bz, d, id) => {
      if (nr >= this.max.rods) return;
      A.set(ax, ay, az); B.set(bx, by, bz);
      const D = B.clone().sub(A), L = D.length();
      if (L < 1e-5) return;
      q.setFromUnitVectors(_up, D.divideScalar(L));
      s.set(d / 2, L, d / 2);
      this.rods.setMatrixAt(nr, m.compose(A, q, s));
      aRib.setX(nr, L / (d * 0.75 * 4)); // 4 ribs per texture tile, a rib every 0.75 d
      o.rods[nr++] = id;
    };
    for (const r of recs) {
      if (r.type === 'bar') rod(...r.a, ...r.b, r.d, r.id);
      else if (r.type === 'mesh') { for (const b of rodsOf(r)) rod(...b, r.id); }
      else if (r.type === 'cage') {
        // (a cage going in: its chairs first, then bar after bar, the ties last — this.reveal = { id, u })
        const rv = this.reveal && r.id != null && this.reveal.id === r.id ? this.reveal.u : 1, part = (a, b) => Math.max(0, Math.min(1, (rv - a) / (b - a)));
        const nB = Math.ceil(r.bars.length * part(0.12, 0.8)), nC = Math.ceil(r.chairs.length * part(0, 0.15)), nT = Math.ceil((r.ties?.length || 0) * part(0.72, 1));
        const nF = Math.ceil(r.frogs.length * part(0.35, 0.55)), nS = Math.ceil((r.stars?.length || 0) * part(0.3, 0.8));
        let kb = 0;
        for (const b of r.bars) { if (kb++ >= nB) break; rod(b[0], b[1], b[2], b[3], b[4], b[5], b[6], r.id); }
        let kc = 0;
        for (const c of r.chairs) {
          if (kc++ >= nC) break;
          if (nc >= this.max.chairs) break;
          p.set(c[0], c[1], c[2]); s.set(CHAIR_R, c[3], CHAIR_R); // fixed Ø50 mm base, height to the bars
          this.chairs.setMatrixAt(nc, m.compose(p, q.identity(), s));
          o.chairs[nc++] = r.id;
        }
        let kf = 0;
        for (const f of r.frogs) {
          if (nf >= this.max.frogs || kf++ >= nF) break;
          p.set(f[0], f[1], f[2]); q.setFromEuler(e.set(0, f[3], 0)); s.set(f[4], f[4], f[4]);
          this.frogs.setMatrixAt(nf, m.compose(p, q, s));
          o.frogs[nf++] = r.id;
        }
        let ks = 0;
        for (const st of r.stars || []) {
          // [x, y, z, yaw of the bar, radius]: the wheel stands across the bar
          if (ns >= this.max.stars || ks++ >= nS) break;
          p.set(st[0], st[1], st[2]); q.setFromEuler(e.set(0, st[3] + Math.PI / 2, 0)); s.set(st[4], st[4], st[4]);
          this.stars.setMatrixAt(ns, m.compose(p, q, s));
          o.stars[ns++] = r.id;
        }
        if (r.tied) {
          let kt = 0;
          for (const t of r.ties) {
            if (nt >= this.max.ties || kt++ >= nT) break;
            p.set(t[0], t[1], t[2]); q.setFromEuler(e.set(Math.PI / 2, 0, t[4] || 0.785)); s.setScalar(t[3] || MM(7));
            this.ties.setMatrixAt(nt, m.compose(p, q, s));
            o.ties[nt++] = r.id;
          }
        }
      }
    }
    // pieces in flight (physics, see rebarJob.js)
    if (this.live) {
      for (const b of this.live.rods || []) rod(...b, null);
      for (const c of this.live.chairs || []) {
        if (nc >= this.max.chairs) break;
        p.set(c[0], c[1], c[2]); s.set(CHAIR_R, c[3], CHAIR_R);
        this.chairs.setMatrixAt(nc, m.compose(p, q.identity(), s)); o.chairs[nc++] = null;
      }
      for (const f of this.live.frogs || []) {
        if (nf >= this.max.frogs) break;
        p.set(f[0], f[1], f[2]); q.setFromEuler(e.set(0, f[3], 0)); s.set(f[4], f[4], f[4]);
        this.frogs.setMatrixAt(nf, m.compose(p, q, s)); o.frogs[nf++] = null;
      }
    }
    this.rods.count = nr; this.chairs.count = nc; this.frogs.count = nf; this.ties.count = nt; this.stars.count = ns;
    for (const im of [this.rods, this.chairs, this.frogs, this.ties, this.stars]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    aRib.needsUpdate = true;
  }

  ownerOf(hit) {
    for (const k of ['rods', 'chairs', 'frogs', 'ties', 'stars']) if (hit.object === this[k]) return this.owner[k][hit.instanceId];
    return null;
  }
}

const _up = new THREE.Vector3(0, 1, 0);

// The bars of a record as [ax,ay,az, bx,by,bz, d] in the plot (a mesh that physics
// dropped carries its pose: p / q of its centre).
export function rodsOf(r) {
  if (r.type === 'bar') return [[...r.a, ...r.b, r.d]];
  if (r.type === 'cage') return r.bars;
  if (r.type !== 'mesh') return [];
  const out = meshLocal(r);
  if (!r.q) {
    const c = meshCentre(r);
    return out.map((b) => [b[0] + c[0], b[1] + c[1], b[2] + c[2], b[3] + c[0], b[4] + c[1], b[5] + c[2], b[6]]);
  }
  const q = new THREE.Quaternion().fromArray(r.q), P = new THREE.Vector3().fromArray(r.p), A = new THREE.Vector3(), B = new THREE.Vector3();
  return out.map((b) => { A.set(b[0], b[1], b[2]).applyQuaternion(q).add(P); B.set(b[3], b[4], b[5]).applyQuaternion(q).add(P); return [A.x, A.y, A.z, B.x, B.y, B.z, b[6]]; });
}
// a welded mesh in its own frame (centre of the sheet, at the bottom of the lower bars)
export function meshCentre(r) { return [(r.x0 + r.x1) / 2, r.y, (r.z0 + r.z1) / 2]; }
export function meshLocal(r) {
  const d = r.d, [cx, , cz] = meshCentre(r), out = [];
  for (let z = r.z0; z <= r.z1 + 1e-6; z += r.cell) out.push([r.x0 - cx, d * 0.5, z - cz, r.x1 - cx, d * 0.5, z - cz, d]);
  for (let x = r.x0; x <= r.x1 + 1e-6; x += r.cell) out.push([x - cx, d * 1.4, r.z0 - cz, x - cx, d * 1.4, r.z1 - cz, d]);
  return out;
}

// ---- builders --------------------------------------------------------------------------
// Level the bottom bars are laid from: the pit floor under the cage. A high
// quantile, not the maximum — a lump or a spoil heap must not lift the cage.
function groundMax(terrain, bb, inside) {
  const hs = [];
  const step = 0.004;
  for (let z = bb.z0; z <= bb.z1; z += step) for (let x = bb.x0; x <= bb.x1; x += step) {
    if (inside && !inside(x, z)) continue;
    if (!terrain.inside(x, z)) continue;
    hs.push(terrain.heightAt(x, z));
  }
  if (!hs.length) return TRAY.soil;
  hs.sort((a, b) => a - b);
  return hs[Math.floor((hs.length - 1) * 0.7)];
}

// Two-layer slab cage inside a rectangular outline.
export function cageForRect(o, terrain, st) {
  const d = MM(st.rebarD), step = MM(st.rebarStep), cover = MM(st.cover);
  const x0 = o.x0 + cover, x1 = o.x1 - cover, z0 = o.z0 + cover, z1 = o.z1 - cover;
  const floor = groundMax(terrain, { x0, z0, x1, z1 });
  // the slab stands on what is in the pit (the cushion may be above the design level):
  // its top is a slab's thickness above that, or the design top if higher
  const top = Math.max(gradeY(o), floor) + MM(st.slab);
  const yb = floor + cover;                 // centre line of the lowest bars
  // always two layers (bottom and top mesh), held apart by the frogs
  const yt = Math.max(yb + 5 * d, top - cover - d);
  const twoLayers = true;
  const bars = [], chairs = [], frogs = [], ties = [];
  const xs = spread(x0, x1, step), zs = spread(z0, z1, step);
  const layer = (y) => {
    for (const z of zs) bars.push([x0, y, z, x1, y, z, d]);            // lower bars run along X
    for (const x of xs) bars.push([x, y + d, z0, x, y + d, z1, d]);    // upper bars along Z, resting on them
    xs.forEach((x, i) => zs.forEach((z, j) => ties.push([x, y + d * 0.5, z, d * 0.9, (i + j) % 2 ? 0.785 : -0.785])));
  };
  layer(yb);
  if (twoLayers) layer(yt - d);
  // plastic chairs under the bottom layer (every second crossing), frogs between layers
  xs.forEach((x, i) => zs.forEach((z, j) => {
    if ((i + j) % 2 === 0) {
      const g = terrain.inside(x, z) ? terrain.heightAt(x, z) : floor;
      chairs.push([x, g, z, chairH(yb - d / 2 - g)]);
    }
    // frogs («лягушки»), each tied to both layers: every 3rd crossing, chequered (~0,6 m)
    if (twoLayers && i % 3 === 1 && (j + (Math.floor(i / 3) % 2) * 1) % 3 === 1) frogs.push([x + step * 0.25, yb + d * 1.5, z, (i % 2) * Math.PI / 2, yt - yb - 2 * d]);
  }));
  return { type: 'cage', outlineId: o.id, bars, chairs, frogs, ties, tied: false, d, step };
}

// Strip-foundation cage along a trench: 2 + 2 longitudinal bars and stirrups.
export function cageForTrench(o, terrain, st) {
  const d = MM(st.rebarD), ds = MM(8), step = MM(st.rebarStep * 1.5), cover = MM(st.cover);
  const half = o.width / 2 - cover;
  const bb = bbox(o);
  const floor = groundMax(terrain, bb, (x, z) => contains(o, x, z));
  const top = TRAY.soil + MM(st.slab) * 0.5;  // a low plinth above ground
  const yb = floor + cover, yt = Math.max(yb + 4 * d, top - cover);
  const bars = [], chairs = [], frogs = [], ties = [];
  const L = offsetPolyline(o.pts, half - ds), R = offsetPolyline(o.pts, -(half - ds));
  for (const side of [L, R]) for (const y of [yb + ds, yt - ds]) {
    for (let i = 0; i < side.length - 1; i++) bars.push([side[i][0], y, side[i][1], side[i + 1][0], y, side[i + 1][1], d]);
  }
  // stirrups (хомуты) along each segment
  for (let i = 0; i < o.pts.length - 1; i++) {
    const [ax, az] = o.pts[i], [bx, bz] = o.pts[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const nx = -dz / len, nz = dx / len;
    for (let t = step / 2; t < len; t += step) {
      const cx = ax + dx / len * t, cz = az + dz / len * t;
      const p1 = [cx + nx * half, cz + nz * half], p2 = [cx - nx * half, cz - nz * half];
      bars.push([p1[0], yb, p1[1], p2[0], yb, p2[1], ds]);
      bars.push([p1[0], yt, p1[1], p2[0], yt, p2[1], ds]);
      bars.push([p1[0], yb, p1[1], p1[0], yt, p1[1], ds]);
      bars.push([p2[0], yb, p2[1], p2[0], yt, p2[1], ds]);
      for (const pp of [p1, p2]) for (const y of [yb + ds, yt - ds]) ties.push([pp[0] - nx * ds * (pp === p1 ? 1 : -1), y, pp[1] - nz * ds * (pp === p1 ? 1 : -1), d * 0.9, 0.785]);
      const g = terrain.inside(cx, cz) ? terrain.heightAt(cx, cz) : floor;
      chairs.push([cx + nx * half * 0.6, g, cz + nz * half * 0.6, chairH(yb - g)]);
      chairs.push([cx - nx * half * 0.6, g, cz - nz * half * 0.6, chairH(yb - g)]);
    }
  }
  return { type: 'cage', outlineId: o.id, bars, chairs, frogs, ties, tied: false, d, step };
}

export function meshPanel(x0, z0, x1, z1, terrain, st) {
  const cell = MAT.meshCell, d = MAT.meshD, cover = MM(st.cover);
  [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)];
  [z0, z1] = [Math.min(z0, z1), Math.max(z0, z1)];
  // whole cells only, like a real cut sheet
  x1 = x0 + Math.max(1, Math.round((x1 - x0) / cell)) * cell;
  z1 = z0 + Math.max(1, Math.round((z1 - z0) / cell)) * cell;
  const y = groundMax(terrain, { x0, z0, x1, z1 }) + cover;
  return { type: 'mesh', x0, z0, x1, z1, y, cell, d };
}

export function singleBar(a, b, terrain, st, snap = true) {
  const d = MM(st.rebarD), cover = MM(st.cover);
  let [ax, az] = a, [bx, bz] = b;
  if (snap) {
    // snap to the X / Z axis within 6°
    const ang = Math.atan2(bz - az, bx - ax), k = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - k) < 0.105) {
      const L = Math.hypot(bx - ax, bz - az);
      bx = ax + Math.cos(k) * L; bz = az + Math.sin(k) * L;
    }
  }
  const y = Math.max(terrain.minAlong(ax, az, bx, bz), maxAlong(terrain, ax, az, bx, bz)) + cover + d / 2;
  return { type: 'bar', a: [ax, y, az], b: [bx, y, bz], d };
}

function maxAlong(t, x0, z0, x1, z1) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / t.cell));
  let m = -1e9;
  for (let k = 0; k <= n; k++) {
    const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
    if (t.inside(x, z)) m = Math.max(m, t.heightAt(x, z));
  }
  return m > -1e8 ? m : TRAY.soil;
}

function spread(a, b, step) {
  const n = Math.max(1, Math.round((b - a) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n);
  return out;
}

// ---- materials & small parts -------------------------------------------------------------
export function makeRebarMaterial() {
  // periodic-profile rebar: two longitudinal ribs + crescent cross ribs, as a normal map
  const W = 64, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    let h = 0;
    const lon = Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75));
    if (lon < 0.025) h = 1;
    const side = u < 0.5 ? 0 : 0.5;            // ribs on the two halves are offset
    const ph = ((v * 4 + side + (u % 0.5) * 0.35) % 1);
    const rib = Math.exp(-Math.pow((ph - 0.5) / 0.07, 2));
    const crescent = Math.sin(((u % 0.5) / 0.5) * Math.PI);
    h = Math.max(h, rib * crescent);
    hgt[y * W + x] = h;
  }
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hx = hgt[y * W + ((x + 1) % W)] - hgt[y * W + ((x - 1 + W) % W)];
    const hy = hgt[((y + 1) % H) * W + x] - hgt[((y - 1 + H) % H) * W + x];
    const nx = -hx * 2.2, ny = -hy * 2.2, nz = 1, l = Math.hypot(nx, ny, nz);
    const i = (y * W + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const nor = new THREE.CanvasTexture(c);
  nor.wrapS = nor.wrapT = THREE.RepeatWrapping;
  nor.colorSpace = THREE.NoColorSpace;
  // mill-scale steel with patches of light rust
  const c2 = document.createElement('canvas'); c2.width = 64; c2.height = 256;
  const g2 = c2.getContext('2d');
  g2.fillStyle = '#4a4440'; g2.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 260; i++) {
    g2.fillStyle = Math.random() < 0.6 ? 'rgba(140,72,34,0.35)' : 'rgba(30,28,27,0.35)';
    g2.beginPath(); g2.ellipse(Math.random() * 64, Math.random() * 256, 2 + Math.random() * 8, 2 + Math.random() * 14, 0, 0, 6.3); g2.fill();
  }
  const map = new THREE.CanvasTexture(c2);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map, normalMap: nor, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.62, metalness: 0.55 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRib;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvec2 ru = vec2(uv.x, uv.y * aRib);\nvMapUv = vec2(uv.x, uv.y * aRib * 0.05);\nvNormalMapUv = ru;');
  };
  m.customProgramCacheKey = () => 'tc-rebar';
  return m;
}

export function makeChairGeometry() {
  // plastic rebar chair, unit height: a ribbed frustum with a saddle on top
  const pts = [new THREE.Vector2(0.0, 0), new THREE.Vector2(0.9, 0), new THREE.Vector2(0.75, 0.08), new THREE.Vector2(0.45, 0.85), new THREE.Vector2(0.55, 1.0), new THREE.Vector2(0.0, 1.0)];
  const g = new THREE.LatheGeometry(pts, 8);
  g.scale(0.9, 1, 0.9);
  return g;
}

function makeFrogGeometry() {
  // "лягушка": Z-shaped bent bar spacer, unit height
  const path = new THREE.CurvePath();
  const P = (x, y) => new THREE.Vector3(x, y, 0);
  path.add(new THREE.LineCurve3(P(-0.6, 0), P(-0.2, 0)));
  path.add(new THREE.LineCurve3(P(-0.2, 0), P(-0.1, 1)));
  path.add(new THREE.LineCurve3(P(-0.1, 1), P(0.1, 1)));
  path.add(new THREE.LineCurve3(P(0.1, 1), P(0.2, 0)));
  path.add(new THREE.LineCurve3(P(0.2, 0), P(0.6, 0)));
  return new THREE.TubeGeometry(path, 40, 0.045, 5, false);
}

function makeStarGeometry() {
  // wheel spacer, unit outer radius, in the XY plane (the bar runs along Z through its
  // hub): a toothed rim, spokes, a hub with the clip slot; 4 % thick
  const sh = new THREE.Shape(), teeth = 14;
  for (let i = 0; i < teeth * 2; i++) {
    const a = i / (teeth * 2) * Math.PI * 2, r = i % 2 ? 0.86 : 1.0;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  // windows between the spokes, and the hole for the bar
  const win = 6;
  for (let i = 0; i < win; i++) {
    const a0 = (i + 0.12) / win * Math.PI * 2, a1 = (i + 0.88) / win * Math.PI * 2, h = new THREE.Path();
    h.absarc(0, 0, 0.74, a0, a1, false);
    h.absarc(0, 0, 0.36, a1, a0, true);
    h.closePath();
    sh.holes.push(h);
  }
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.19, 0, Math.PI * 2, true); sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -0.04);
  return g;
}
