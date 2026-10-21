import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { canvas, asTex, normalOf } from './roof.js';
import { aeratedTexture } from './walls.js';

// A pitched roof (скатная крыша) over a rectangular house, built up layer by layer:
//   plate   – the wall plate (мауэрлат) 150 × 150 on the top of the walls,
//   frame   – the rafters 50 × 200 every 600, the ridge beam, the collar ties; a hip roof:
//             the hip rafters and the jack rafters; a gable roof: the gables of blocks,
//   memb    – the membrane on the rafters,
//   battens – the counter-battens 50 × 50 along the rafters and the battens across (350 for
//             the metal tile, 500 for the standing seam), or a deck of OSB for the shingles,
//   cover   – the covering: the metal tile (its waves and steps), the standing seam sheets
//             (their ribs), the soft shingles,
//   trim    – the ridge, the hips, the fascia, the verge boards, the soffits.
// The frame of the house: the middle (cx, cz), along the ridge u, half sizes A (along), B
// (across) to the outer faces of the walls, the wall's thickness T, the top of the walls y0.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const PITCHED = { plate: 150, rafterW: 50, rafterH: 200, step: 600, eave: 500, gable: 400, cb: 50, batten: [25, 100] };
export const ROOF_TYPES = { gable: 'Двускатная', hip: 'Вальмовая' };
export const COVERS = { metal: 'Металлочерепица', seam: 'Фальц', shingle: 'Мягкая черепица' };
export const COVER_COLOURS = {
  metal: { ral3005: ['Вишня', 0x5b1f26], ral8017: ['Шоколад', 0x45322e], ral7024: ['Графит', 0x474a50], ral6005: ['Зелёный мох', 0x163f33], ral3011: ['Красно-коричневый', 0x7a2622] },
  seam: { ral7024: ['Графит', 0x45484d], ral7016: ['Антрацит', 0x383e42], ral9005: ['Чёрный', 0x17181a], zinc: ['Титан-цинк', 0x8d9295], copper: ['Медь', 0xa8653f] },
  shingle: { brown: ['Коричневая', ['#5e3b28', '#4a2c1e', '#6f4a33']], red: ['Красная', ['#7d2b22', '#65221b', '#8f3a2c']], grey: ['Серая', ['#5d6064', '#4b4e52', '#70737a']], green: ['Зелёная', ['#34463a', '#2a3a2f', '#43574a']] },
};
export const STAGES = ['plate', 'frame', 'memb', 'battens', 'cover', 'trim'];

// ---- the shape: the height of the top of the rafters over a point of the plan ---------------
export function shape(sp) {
  const al = sp.pitch * Math.PI / 180, tn = Math.tan(al), cs = Math.cos(al);
  const R = sp.B - sp.T / 2 + MM(75), Ra = sp.A - sp.T / 2 + MM(75), hip = sp.type === 'hip';
  const base = sp.y0 + MM(PITCHED.plate) + MM(PITCHED.rafterH) / cs;
  // (dd: distance in from the side's outer face of the wall plate)
  const top = (a, d) => base + Math.min(R - Math.abs(d), hip ? Ra - Math.abs(a) : Infinity) * tn;
  const ux = sp.ux, uz = sp.uz, vx = -uz, vz = ux;
  const W = (a, d, y) => [sp.cx + ux * a + vx * d, y, sp.cz + uz * a + vz * d];
  const Oe = MM(PITCHED.eave), Og = hip ? Oe : MM(PITCHED.gable);
  return { al, tn, cs, R, Ra, hip, base, top, W, Oe, Og, ridge: base + R * tn, rl: hip ? Math.max(0, Ra - R) : sp.A + Og };
}
// the planes of the roof: x along the eave, t up the slope from the eave's edge;
// at(x, t) → [a, d], the limit |x| ≤ xm(t)
function planes(sp, f) {
  const out = [], hip = f.hip, Ls = (sp.B + f.Oe) / f.cs;
  for (const sg of [-1, 1]) {
    out.push({ key: 's' + sg, L: Ls, X: sp.A + f.Og, at: (x, t) => [x, sg * (sp.B + f.Oe - t * f.cs)], xm: (t) => (hip ? f.Ra - f.R + Math.max(0, sp.B + f.Oe - t * f.cs) : sp.A + f.Og), sg, side: true });
    if (hip) out.push({ key: 'e' + sg, L: Ls, X: sp.B + f.Oe, at: (x, t) => [sg * (sp.A + f.Oe - t * f.cs), x], xm: (t) => Math.max(0, sp.A + f.Oe - t * f.cs - (f.Ra - f.R)), sg, side: false });
  }
  return out;
}

// ---- the textures ----------------------------------------------------------------------------
const TEX = {};
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function woodTex() {
  if (TEX.wood) return TEX.wood;
  const n = 256, c = canvas(n), g = c.getContext('2d');
  g.fillStyle = '#c9a274'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${120 + rnd() * 40},${80 + rnd() * 30},${40},${0.15 + rnd() * 0.25})`; g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath(); const y = rnd() * n; g.moveTo(0, y); for (let x = 0; x <= n; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 2); g.stroke(); }
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(90,55,25,0.45)'; g.beginPath(); g.ellipse(rnd() * n, rnd() * n, 3 + rnd() * 4, 2 + rnd() * 3, 0, 0, 6.28); g.fill(); }
  return (TEX.wood = asTex(c));
}
function membTex() {
  if (TEX.memb) return TEX.memb;
  const n = 512, c = canvas(n), g = c.getContext('2d');
  g.fillStyle = '#c9ced3'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.08})`; g.fillRect(rnd() * n, rnd() * n, 2, 2); }
  g.fillStyle = 'rgba(30,80,150,0.55)'; g.font = 'bold 22px sans-serif';
  for (let y = 60; y < n; y += 170) for (let x = (y / 170) % 2 ? 10 : 140; x < n; x += 260) g.fillText('ИЗОСПАН · AM', x, y);
  g.fillStyle = 'rgba(30,80,150,0.4)'; g.fillRect(0, 8, n, 3);   // (the line for the overlap)
  return (TEX.memb = asTex(c));
}
function osbTex() {
  if (TEX.osb) return TEX.osb;
  const n = 512, c = canvas(n), g = c.getContext('2d');
  g.fillStyle = '#c8a46e'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 1600; i++) { const v = 120 + rnd() * 100; g.fillStyle = `rgba(${v + 30},${v},${v * 0.6},0.55)`; g.save(); g.translate(rnd() * n, rnd() * n); g.rotate(rnd() * 6.28); g.fillRect(-14, -3, 18 + rnd() * 26, 4 + rnd() * 5); g.restore(); }
  g.strokeStyle = 'rgba(60,40,20,0.6)'; g.lineWidth = 2; g.strokeRect(1, 1, n - 2, n - 2);
  return (TEX.osb = asTex(c));
}
// soft shingles: rows of hexagonal tabs, the granules in three tones (a tile 1000 × 572)
function shingleTex(cols) {
  const key = 'sh' + cols.join(); if (TEX[key]) return TEX[key];
  const n = 512, m = 293, c = canvas(n, m), g = c.getContext('2d'), hc = canvas(n, m), h = hc.getContext('2d');
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, n, m); h.fillStyle = '#202020'; h.fillRect(0, 0, n, m);
  const rows = 4, rh = m / rows, tw = n / 3;
  for (let r = 0; r < rows + 1; r++) for (let k = -1; k < 4; k++) {
    const x0 = k * tw + (r % 2 ? tw / 2 : 0), y0 = r * rh - rh * 0.15;
    const col = cols[Math.floor(rnd() * cols.length)];
    // a hexagonal tab, its lower part showing
    const P = [[x0 + 4, y0], [x0 + tw - 4, y0], [x0 + tw - 4, y0 + rh * 0.8], [x0 + tw / 2 + 18, y0 + rh * 1.05], [x0 + tw / 2 - 18, y0 + rh * 1.05], [x0 + 4, y0 + rh * 0.8]];
    for (const ctx of [g, h]) { ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = ctx === g ? col : '#9a9a9a'; ctx.fill(); }
    // its granules
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.06 + rnd() * 0.1})`; g.fillRect(x0 + rnd() * tw, y0 + rnd() * rh, 1.6, 1.6); }
  }
  return (TEX[key] = { map: asTex(c), normalMap: normalOf(hc, 3) });
}

// ---- the parts -------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
// beams: a box from p0 to p1, w wide, h deep (h in the vertical plane through it)
class Beams {
  constructor() { this.list = []; }
  add(p0, p1, w, h, up = null) {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), x = b.clone().sub(a), L = x.length();
    if (L < 1e-7) return;
    x.normalize();
    // (its depth: up, or square to the roof's plane when given its normal)
    let z = new THREE.Vector3().crossVectors(x, up || new THREE.Vector3(0, 1, 0));
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1); z.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    _m.makeBasis(x, y, z); _q.setFromRotationMatrix(_m);
    this.list.push(_m.compose(_p.copy(a).add(b).multiplyScalar(0.5), _q, _s.set(L, h, w)).clone());
  }
  mesh(mat) {
    if (!this.list.length) return null;
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.list.length);
    this.list.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = m.receiveShadow = true; return m;
  }
}
// a sheet over a plane at an offset (along the plane's normal), clamped to its limit;
// prof(x, t) → the height of the profile (model), uv(x, t)
function sheet(sp, f, P, off, dx, dt, prof, uv, t0 = 0, t1 = P.L) {
  const nx = Math.ceil(2 * P.X / dx), nt = Math.max(1, Math.ceil((t1 - t0) / dt)), pos = [], uvs = [], idx = [];
  // the normal of the plane: from two of its points
  const p = (x, t) => { const [a, d] = P.at(x, t); return new THREE.Vector3(...f.W(a, d, f.top(a, d))); };
  const n = new THREE.Vector3().crossVectors(p(1e-4, t0 + 1e-4).sub(p(0, t0 + 1e-4)), p(0, t0 + 2e-4).sub(p(0, t0 + 1e-4))).normalize();
  if (n.y < 0) n.negate();
  for (let j = 0; j <= nt; j++) {
    const t = Math.min(t1, t0 + j * dt), xm = P.xm(t);
    for (let i = 0; i <= nx; i++) {
      const x = Math.max(-xm, Math.min(xm, -P.X + i * dx));
      const [a, d] = P.at(x, t), y = f.top(a, d), h = off + (prof ? prof(x, t) : 0), w = f.W(a, d, y);
      pos.push(w[0] + n.x * h, w[1] + n.y * h, w[2] + n.z * h);
      uvs.push(...uv(x, t));
    }
  }
  for (let j = 0; j < nt; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // (facing up)
  const nn = g.attributes.normal; let up = 0; for (let i = 0; i < nn.count; i += 7) up += nn.getY(i);
  if (up < 0) { for (let k = 0; k < idx.length; k += 3) { const q = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = q; } g.setIndex(idx); g.computeVertexNormals(); }
  return { g, n };
}

const MATS = {};
const mat = (k, make) => MATS[k] || (MATS[k] = make());

// sp: the frame (cx, cz, ux, uz, A, B, T, y0), type, pitch (°), cover { kind, col },
// stages: a Set of what is done
export function buildPitched(sp, stages = new Set(STAGES)) {
  const f = shape(sp), G = new THREE.Group(), has = (k) => stages.has(k), PL = planes(sp, f);
  const wood = mat('wood', () => new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.85 }));
  const beams = new Beams(), tie = MM(PITCHED.rafterH), rw = MM(PITCHED.rafterW);
  const mid = (a, d) => f.top(a, d) - tie / 2 / f.cs;   // (the rafter's axis under the top)
  // the wall plate on the middle of the walls
  if (has('plate')) {
    const ya = sp.y0 + MM(75), ia = sp.A - sp.T / 2, ib = sp.B - sp.T / 2, pl = MM(PITCHED.plate);
    for (const s of [-1, 1]) {
      beams.add(f.W(-ia - MM(75), s * ib, ya), f.W(ia + MM(75), s * ib, ya), pl, pl);
      beams.add(f.W(s * ia, -ib + MM(75), ya), f.W(s * ia, ib - MM(75), ya), pl, pl);
    }
  }
  if (has('frame')) {
    const step = MM(PITCHED.step), ia = sp.A - sp.T / 2, Le = sp.B + f.Oe - MM(80);   // (the tails cut plumb behind the fascia)
    // the ridge beam
    beams.add(f.W(-f.rl, 0, f.ridge - tie * 0.7), f.W(f.rl, 0, f.ridge - tie * 0.7), rw, MM(250));
    // the common rafters, in pairs (on a hip roof: where the ridge is)
    const xs = [];
    const lim = f.hip ? f.Ra - f.R : sp.A + f.Og - rw;
    for (let a = -lim; a <= lim + 1e-6; a += Math.min(step, (2 * lim) / Math.max(1, Math.round(2 * lim / step)))) xs.push(a);
    for (const a of xs) for (const s of [-1, 1]) beams.add(f.W(a, s * Le, mid(a, Le)), f.W(a, 0, mid(a, 0) + tie * 0.3), rw, tie);
    // the collar ties every second pair, at two thirds up
    const yt = sp.y0 + MM(PITCHED.plate) + f.R * f.tn * 0.62, dt = f.R - (yt - sp.y0 - MM(PITCHED.plate)) / f.tn;
    xs.forEach((a, k) => { if (k % 2 === 0 && Math.abs(a) <= ia) beams.add(f.W(a + rw, -dt, yt), f.W(a + rw, dt, yt), rw, MM(150)); });
    if (f.hip) {
      for (const sa of [-1, 1]) for (const sd of [-1, 1]) {
        // the hip rafter: from the corner of the eaves to the end of the ridge
        const a0 = sa * (sp.A + f.Oe - MM(80)), d0 = sd * (sp.B + f.Oe - MM(80));
        beams.add(f.W(a0, d0, mid(a0, d0)), f.W(sa * f.rl, 0, mid(sa * f.rl, 0) + tie * 0.3), rw * 1.6, tie);
        // the jack rafters onto it: on the side and on the end
        for (let k = 1; ; k++) {
          const a = sa * (f.rl + k * step); if (Math.abs(a) > sp.A + f.Oe - MM(100)) break;
          const dEnd = Math.abs(a) - (f.Ra - f.R);   // (where it meets the hip, |d|)
          beams.add(f.W(a, sd * Le, mid(a, Le)), f.W(a, sd * Math.max(0, dEnd), mid(a, dEnd)), rw, tie);
        }
        for (let k = 0; ; k++) {
          const d = sd * k * step; if (Math.abs(d) > sp.B + f.Oe - MM(100)) break;
          if (sd < 0 && k === 0) continue;
          const aEnd = Math.abs(d) + (f.Ra - f.R);
          beams.add(f.W(sa * (sp.A + f.Oe - MM(80)), d, mid(sp.A + f.Oe - MM(80), d)), f.W(sa * aEnd, d, mid(aEnd, d)), rw, tie);
        }
      }
    } else {
      // the gables: blocks up to the rafters at each end
      const gm = mat('gable', () => { const t = aeratedTexture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 }); });
      for (const s of [-1, 1]) {
        const a0 = s * (sp.A - sp.T), a1 = s * sp.A, yb = (dd) => sp.y0 + MM(PITCHED.plate) + Math.max(0, f.R - dd) * f.tn;
        const pts = [[-sp.B, sp.y0], [sp.B, sp.y0], [sp.B, yb(sp.B)], [0, yb(0)], [-sp.B, yb(sp.B)]];
        const shp = new THREE.Shape(pts.map(([d, y]) => new THREE.Vector2(d, y)));
        const g = new THREE.ExtrudeGeometry(shp, { depth: Math.abs(a1 - a0), bevelEnabled: false });
        // (into the frame: x = d, y = y, z along a)
        const pos = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const d = pos.getX(i), y = pos.getY(i), a = Math.min(a0, a1) + pos.getZ(i), w = f.W(a, d, y);
          uv.setXY(i, (d + a) / MM(600), (y - sp.y0) / MM(253)); pos.setXYZ(i, ...w);
        }
        // (x and z swapped: the faces turned inside out — back the right way)
        const ix = g.index ? g.index.array : null;
        if (ix) { for (let k = 0; k < ix.length; k += 3) { const q = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = q; } }
        else { const P = g.attributes.position, U = g.attributes.uv; for (let k = 0; k < P.count; k += 3) for (const A of [P, U]) { const n = A.itemSize, t = []; for (let c = 0; c < n; c++) t.push(A.array[(k + 1) * n + c]); for (let c = 0; c < n; c++) { A.array[(k + 1) * n + c] = A.array[(k + 2) * n + c]; A.array[(k + 2) * n + c] = t[c]; } } }
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, gm); m.castShadow = m.receiveShadow = true; G.add(m);
      }
    }
  }
  const add = (m) => { if (m) G.add(m); return m; };
  // the membrane on the rafters
  if (has('memb')) for (const P of PL) {
    const { g } = sheet(sp, f, P, MM(1), MM(400), MM(400), null, (x, t) => [x / MM(1500), t / MM(1500)]);
    add(new THREE.Mesh(g, mat('memb', () => new THREE.MeshStandardMaterial({ map: membTex(), roughness: 0.75, side: THREE.DoubleSide }))));
  }
  // the counter-battens along the rafters, the battens / the deck
  if (has('battens')) {
    const cb = MM(PITCHED.cb), kind = sp.cover?.kind || 'metal';
    for (const P of PL) {
      const nOff = (o) => o / f.cs;
      const pp = (x, t) => { const [a, d] = P.at(x, t); return new THREE.Vector3(...f.W(a, d, f.top(a, d))); };
      const pn = new THREE.Vector3().crossVectors(pp(1e-4, 1e-4).sub(pp(0, 1e-4)), pp(0, 2e-4).sub(pp(0, 1e-4))).normalize();
      if (pn.y < 0) pn.negate();
      if (P.side) {
        const lim = P.X - rw;
        for (let x = -lim; x <= lim + 1e-6; x += MM(PITCHED.step)) {
          const t1 = P.L, xs = Math.max(-P.xm(0), Math.min(P.xm(0), x));
          // (up to where the plane ends at this x: the hip)
          let tEnd = t1; if (f.hip) { const dEnd = Math.abs(x) - (f.Ra - f.R); tEnd = dEnd > 0 ? (sp.B + f.Oe - dEnd) / f.cs : t1; }
          const [a0, d0] = P.at(xs, 0), [a1, d1] = P.at(xs, tEnd);
          beams.add(f.W(a0, d0, f.top(a0, d0) + nOff(cb / 2)), f.W(a1, d1, f.top(a1, d1) + nOff(cb / 2)), cb, cb);
        }
      }
      if (kind === 'shingle') {
        const { g } = sheet(sp, f, P, MM(PITCHED.cb + 9), MM(500), MM(500), null, (x, t) => [x / MM(2500), t / MM(1250)]);
        add(new THREE.Mesh(g, mat('osb', () => new THREE.MeshStandardMaterial({ map: osbTex(), roughness: 0.85 }))));
      } else {
        const st = MM(kind === 'seam' ? 300 : 350), [bt, bw] = PITCHED.batten.map(MM);
        for (let t = MM(60); t < P.L - MM(80); t += st) {
          const xm = P.xm(t + bw / 2); if (xm < MM(80)) continue;
          const [a0, d0] = P.at(-xm, t), [a1, d1] = P.at(xm, t);
          beams.add(f.W(a0, d0, f.top(a0, d0) + nOff(cb + bt / 2)), f.W(a1, d1, f.top(a1, d1) + nOff(cb + bt / 2)), bw, bt, pn);
        }
      }
    }
  }
  add(beams.mesh(wood));
  // the covering
  const cover = sp.cover || { kind: 'metal', col: 'ral3005' }, kind = cover.kind, coff = MM(PITCHED.cb + (kind === 'shingle' ? 22 : PITCHED.batten[0] + 2));
  const cc = COVER_COLOURS[kind][cover.col] || Object.values(COVER_COLOURS[kind])[0];
  const metalMat = () => mat('cov' + kind + cover.col, () => new THREE.MeshStandardMaterial({ color: cc[1], metalness: kind === 'seam' ? 0.55 : 0.35, roughness: kind === 'seam' ? 0.42 : 0.5, side: THREE.DoubleSide }));
  if (has('cover')) for (const P of PL) {
    if (kind === 'metal') {
      // Monterrey: waves of 185 mm across, steps of 350 mm up the slope
      const prof = (x, t) => { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * x / MM(185)), fr = (t % MM(350)) / MM(350); return MM(19) * w + MM(16) * Math.min(1, fr / 0.92) - MM(16) * Math.max(0, (fr - 0.92) / 0.08); };
      const { g } = sheet(sp, f, P, coff, MM(185 / 6), MM(350 / 7), prof, (x, t) => [x / MM(1000), t / MM(1000)]);
      add(new THREE.Mesh(g, metalMat()));
    } else if (kind === 'seam') {
      const { g, n } = sheet(sp, f, P, coff, MM(250), MM(300), null, (x, t) => [x / MM(1000), t / MM(1000)]);
      add(new THREE.Mesh(g, metalMat()));
      // the standing seams every 500 up the slope
      const rib = new Beams(), rh = MM(25);
      for (let x = -P.X + MM(250); x < P.X; x += MM(500)) {
        let t1 = P.L; while (t1 > 0 && P.xm(t1) < Math.abs(x)) t1 -= MM(50);
        if (t1 <= MM(100)) continue;
        const [a0, d0] = P.at(x, 0), [a1, d1] = P.at(x, t1), o = coff + rh / 2;
        const w0 = f.W(a0, d0, f.top(a0, d0)), w1 = f.W(a1, d1, f.top(a1, d1));
        rib.add([w0[0] + n.x * o, w0[1] + n.y * o, w0[2] + n.z * o], [w1[0] + n.x * o, w1[1] + n.y * o, w1[2] + n.z * o], MM(10), rh);
      }
      add(rib.mesh(metalMat()));
    } else {
      const T = shingleTex(cc[1]);
      const { g } = sheet(sp, f, P, coff, MM(500), MM(286), null, (x, t) => [x / MM(1000), t / MM(572)]);
      add(new THREE.Mesh(g, mat('sh' + cover.col, () => new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.normalMap, roughness: 0.95, side: THREE.DoubleSide }))));
    }
  }
  // the ridge, the hips, the fascia, the verges, the soffits
  if (has('trim')) {
    const tm = kind === 'shingle' ? mat('trimSh' + cover.col, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(cc[1][0]).multiplyScalar(0.8), roughness: 0.9 })) : metalMat();
    const yR = f.ridge + coff / f.cs + MM(20);
    const capR = MM(kind === 'shingle' ? 70 : 110);
    const cap = (p0, p1) => {
      const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), L = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(capR, capR, L, 16), tm);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      m.castShadow = true; G.add(m);
    };
    cap(f.W(-f.rl - (f.hip ? 0 : MM(20)), 0, yR - capR * 0.55), f.W(f.rl + (f.hip ? 0 : MM(20)), 0, yR - capR * 0.55));
    if (f.hip) for (const sa of [-1, 1]) for (const sd of [-1, 1]) {
      const a0 = sa * (sp.A + f.Oe), d0 = sd * (sp.B + f.Oe);
      cap(f.W(a0, d0, f.top(a0, d0) + coff / f.cs + MM(15) - capR * 0.55), f.W(sa * f.rl, 0, yR - capR * 0.55));
    }
    const fas = new Beams(), white = mat('soffit', () => new THREE.MeshStandardMaterial({ color: kind === 'shingle' ? 0x6b4a33 : cc[1], roughness: 0.6, metalness: 0.2 }));
    const Le = sp.B + f.Oe, fh = tie / f.cs + MM(50), yF = (a, d) => f.top(a, d) - fh / 2 + MM(20);   // (the fascia: over the ends of the rafters)
    // the fascia boards along the eaves (round all four sides on a hip roof)
    for (const s of [-1, 1]) {
      fas.add(f.W(-(sp.A + f.Og), s * Le, yF(0, Le)), f.W(sp.A + f.Og, s * Le, yF(0, Le)), MM(25), fh);
      if (f.hip) fas.add(f.W(s * (sp.A + f.Oe), -Le, yF(sp.A + f.Oe, 0)), f.W(s * (sp.A + f.Oe), Le, yF(sp.A + f.Oe, 0)), MM(25), fh);
      else for (const s2 of [-1, 1]) {
        // the verge: up the gable's edge from the eave to the ridge
        const a = s * (sp.A + f.Og);
        fas.add(f.W(a, s2 * Le, f.top(a, Le) + coff / f.cs - MM(60)), f.W(a, 0, f.ridge + coff / f.cs - MM(60)), MM(30), MM(200));
      }
    }
    add(fas.mesh(white));
    // the soffits: under the overhang, from the wall to the fascia
    const sof = new Beams();
    for (const s of [-1, 1]) {
      const y = yF(0, Le) - fh / 2 + MM(6), d0 = s * sp.B, d1 = s * Le;   // (under the ends of the rafters)
      sof.add(f.W(-(sp.A + f.Og), (d0 + d1) / 2, y), f.W(sp.A + f.Og, (d0 + d1) / 2, y), Math.abs(d1 - d0), MM(10));
      if (f.hip) sof.add(f.W(s * (sp.A + f.Oe / 2), -Le, y), f.W(s * (sp.A + f.Oe / 2), Le, y), f.Oe, MM(10));
    }
    add(sof.mesh(mat('sof', () => new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6 }))));
  }
  G.userData.shape = f;
  return G;
}
