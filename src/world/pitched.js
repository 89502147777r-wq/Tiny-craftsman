import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { canvas, asTex, normalOf, gravelTex } from './roof.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { aeratedTexture } from './walls.js';

// A pitched roof (скатная крыша) over the house, built up layer by layer:
//   plate   – the wall plate (мауэрлат) 150 × 150 on the top of the walls, and the masonry
//             the roof needs under it: the gables (фронтоны), on a mono-pitch roof its high
//             wall and the slopes of its ends,
//   joists  – the ceiling joists 50 × 200 every 600 across the house, from plate to plate,
//   ridge   – the ridge purlin 150 × 200 on posts 100 × 100 (≤ 3 m apart) standing on the
//             joists; the gables carry its ends,
//   frame   – the rafters 50 × 200 every 600 off the purlin, the collar ties; the hip
//             rafters and the jack rafters; the valley rafters where two wings meet,
//   memb    – the membrane on the rafters,
//   battens – the counter-battens 50 × 50 and the battens across (350 for the metal tile,
//             300 for the standing seam), or a deck of OSB for the shingles,
//   cover   – the covering: the metal tile (its waves and steps), the standing seam (its
//             ribs), the soft shingles; the valley flashing,
//   trim    – the ridge, the hips, the fascia, the verge boards, the soffits.
// The roof is made of WINGS (крылья): rectangles of the house, each with its own ridge. A
// plain house is one wing; an L, a T, a U — two, three. Each end of a wing is a gable, a hip
// or a JOIN: it runs on into the wing it meets, and where their slopes cut each other the
// valleys are (the roof over a point is the highest of the wings over it).
//   wing { cx, cz, ux, uz (along its ridge), A, B (half sizes to the outer faces of the
//          walls), e: [end at −a, end at +a] ('join' or free), x: [how far a join runs on],
//          style, pitch (its own; else the roof's), md (a mono-pitch wing: which way its
//          slope rises — 0: +d, 1: −d, 2: +a, 3: −a) }
//   roof { y0 (the top of the walls), T (their thickness), style ('gable'|'hip'|'mono'),
//          pitch (°), cover { kind, col }, gut { kind, col } (the gutters: GUTTERS, GUTTER_COLOURS), wings: […], done: { stage: true | [[w, a0, a1]…] } }
// A stage laid by the finger is done over stretches along a wing's ridge (a0…a1).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const PITCHED = { plate: 150, rafterW: 50, rafterH: 200, step: 600, eave: 500, gable: 400, cb: 50, batten: [25, 100], sheet: { metal: 1180, seam: 500, shingle: 1000 } };
export const ROOF_TYPES = { gable: 'Двускатная', hip: 'Вальмовая', mono: 'Односкатная' };
export const PITCHES = { gable: [25, 30, 35, 45], hip: [20, 25, 30, 35], mono: [8, 12, 15, 20] };
// any pitch within these (the chips above are the usual ones; ± steps between them)
export const PITCH_RANGE = { gable: [10, 60], hip: [10, 50], mono: [3, 35] };
export const COVERS = { metal: 'Металлочерепица', seam: 'Фальц', shingle: 'Мягкая черепица' };
export const COVER_COLOURS = {
  metal: { ral3005: ['Вишня', 0x5b1f26], ral8017: ['Шоколад', 0x45322e], ral7024: ['Графит', 0x474a50], ral6005: ['Зелёный мох', 0x163f33], ral3011: ['Красно-коричневый', 0x7a2622] },
  seam: { ral7024: ['Графит', 0x45484d], ral7016: ['Антрацит', 0x383e42], ral9005: ['Чёрный', 0x17181a], zinc: ['Титан-цинк', 0x8d9295], copper: ['Медь', 0xa8653f] },
  shingle: { brown: ['Коричневая', ['#5e3b28', '#4a2c1e', '#6f4a33']], red: ['Красная', ['#7d2b22', '#65221b', '#8f3a2c']], grey: ['Серая', ['#5d6064', '#4b4e52', '#70737a']], green: ['Зелёная', ['#34463a', '#2a3a2f', '#43574a']] },
};
export const STAGES = [['plate', 'Мауэрлат и фронтоны'], ['joists', 'Лаги перекрытия'], ['ridge', 'Коньковый прогон'], ['frame', 'Стропила'], ['memb', 'Мембрана'], ['battens', 'Обрешётка'], ['cover', 'Покрытие'], ['trim', 'Конёк и планки'], ['gutter', 'Водосток']];
// the windows in the roof (мансардные окна): the same windows go into a slope (between the
// rafters, the covering cut round them, a flashing collar) or onto a flat roof (on a kerb)
export const RWIN = { s1: ['55 × 78', 550, 780], s2: ['78 × 118', 780, 1180], s3: ['78 × 140', 780, 1400], s4: ['114 × 118', 1140, 1180] };
export const RWIN_COLOURS = { graphite: ['Графит', 0x3a3d41], grey: ['Серый', 0x7a7f84], brown: ['Коричневый', 0x4a3426] };
// a shared value the sky sets: how hard it rains (the water out of the downpipes)
export const WATER = { rain: 0 };
// the ground under what comes down to it (a downpipe, a chain): the blind area's top where it is
export const GROUND = { at: null };
export const FINGER = new Set(['frame', 'memb', 'battens', 'cover']);   // (laid along the wing by the finger; the rest at one go)

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

// ---- the shape of a wing -----------------------------------------------------------------------
// local: a along the ridge, d across (v = (−uz, ux)); the height of the top of the rafters
export function wingShape(roof, w) {
  const style = w.style || roof.style || 'gable', pitch = w.pitch || roof.pitch || 35;
  const al = pitch * Math.PI / 180, tn = Math.tan(al), cs = Math.cos(al), mono = style === 'mono', md = mono ? (w.md || 0) : -1;
  const T = roof.T, R = w.B - T / 2 + MM(75), Ra = w.A - T / 2 + MM(75);
  const base = roof.y0 + MM(PITCHED.plate) + MM(PITCHED.rafterH) / cs;
  const Oe = MM(PITCHED.eave), Og = MM(PITCHED.gable);
  // the ends: a join runs on into the wing it meets; a free end — a hip, or a gable (a mono-pitch
  // roof sloping along the ridge: its low end an eave)
  const ends = [0, 1].map((k) => (w.e[k] === 'join' ? 'join' : style === 'hip' ? 'hip' : 'gable'));
  const lowEnd = md === 2 ? 0 : md === 3 ? 1 : -1;
  const ext = [0, 1].map((k) => (ends[k] === 'join' ? (w.x?.[k] ?? 0) : ends[k] === 'hip' || k === lowEnd ? Oe : Og));
  const lo = -(w.A + ext[0]), hi = w.A + ext[1], side = md >= 2 ? Og : Oe;   // (a mono along the ridge: its long sides are verges)
  const L = (x, z) => { const dx = x - w.cx, dz = z - w.cz; return [dx * w.ux + dz * w.uz, -dx * w.uz + dz * w.ux]; };
  const W = (a, d, y) => [w.cx + w.ux * a - w.uz * d, y, w.cz + w.uz * a + w.ux * d];
  const hipLim = (a) => (a < 0 ? (ends[0] === 'hip' ? Ra + a : Infinity) : (ends[1] === 'hip' ? Ra - a : Infinity));
  const run = (a, d) => (md === 0 ? R + d : md === 1 ? R - d : md === 2 ? Ra + a : md === 3 ? Ra - a : Math.min(R - Math.abs(d), hipLim(a)));
  const top = (a, d) => base + run(a, d) * tn;
  const inside = (a, d, o = 0) => a >= lo - o && a <= hi + o && Math.abs(d) <= w.B + side + o;
  return { style, pitch, al, tn, cs, R, Ra, base, Oe, Og, side, ext, ends, lo, hi, L, W, top, inside, mono, md, ridge: base + R * tn, ridgeA: [ends[0] === 'hip' ? -(Ra - R) : lo, ends[1] === 'hip' ? Ra - R : hi] };
}
// the roof over a point: the highest of the wings over it (−∞: none)
export function roofTop(roof, shapes, x, z, skip = -1) {
  let h = -Infinity;
  shapes.forEach((f, i) => { if (i === skip) return; const [a, d] = f.L(x, z); if (f.inside(a, d)) h = Math.max(h, f.top(a, d)); });
  return h;
}
// the planes of a wing: x along the eave, t up the slope from the eave's edge; at(x, t) → [a, d];
// the stretch of x at t: [xa(t), xb(t)]; xa_ / xb_: what the edges are ('verge', 'hip', 'join');
// xd: x runs across the ridge (a mono-pitch roof sloping along it: then t is along a)
export function planes(roof, w, f) {
  const out = [], Le = w.B + f.Oe;
  if (f.md === 0 || f.md === 1) {
    const s = f.md === 0 ? 1 : -1;
    out.push({ key: 'm', L: 2 * Le / f.cs, at: (x, t) => [x, s * (-Le + t * f.cs)], xa: () => f.lo, xb: () => f.hi, ea: f.ends[0], eb: f.ends[1], hiEdge: true });
    return out;
  }
  if (f.md >= 2) {
    const s = f.md === 2 ? 1 : -1, a0 = s > 0 ? f.lo : f.hi, Ls = w.B + f.side;
    out.push({ key: 'm', xd: true, L: (f.hi - f.lo) / f.cs, at: (x, t) => [a0 + s * t * f.cs, x], xa: () => -Ls, xb: () => Ls, ea: 'gable', eb: 'gable', hiEdge: f.ends[s > 0 ? 1 : 0] !== 'join', tOfA: (a) => (a - a0) * s / f.cs });
    return out;
  }
  for (const sg of [-1, 1]) {
    const dd = (t) => Math.max(0, Le - t * f.cs);
    out.push({ key: 's' + sg, sg, L: Le / f.cs, at: (x, t) => [x, sg * (Le - t * f.cs)], xa: (t) => (f.ends[0] === 'hip' ? -(f.Ra - f.R + dd(t)) : f.lo), xb: (t) => (f.ends[1] === 'hip' ? f.Ra - f.R + dd(t) : f.hi), ea: f.ends[0], eb: f.ends[1] });
  }
  for (const k of [0, 1]) if (f.ends[k] === 'hip') {
    const sg = k ? 1 : -1, Ae = w.A + f.Oe;
    out.push({ key: 'e' + sg, end: sg, L: Le / f.cs, at: (x, t) => [sg * (Ae - t * f.cs), x], xa: (t) => -Math.max(0, Ae - t * f.cs - (f.Ra - f.R)), xb: (t) => Math.max(0, Ae - t * f.cs - (f.Ra - f.R)), ea: 'hip', eb: 'hip' });
  }
  return out;
}
// the plane of a wing over a point (local a, d): its key, x, t
export function planeAt(roof, w, f, a, d) {
  const PL = planes(roof, w, f);
  let P;
  if (f.mono) P = PL[0];
  else {
    const hipSide = (a < 0 && f.ends[0] === 'hip') || (a > 0 && f.ends[1] === 'hip');
    P = hipSide && f.Ra - Math.abs(a) < f.R - Math.abs(d) ? PL.find((q) => q.end === Math.sign(a)) : PL.find((q) => q.sg === (d >= 0 ? 1 : -1));
  }
  if (!P) return null;
  const Le = w.B + f.Oe;
  let x, t;
  if (P.xd) { x = d; t = P.tOfA(a); }
  else if (P.key === 'm') { x = a; t = (d * (f.md === 0 ? 1 : -1) + Le) / f.cs; }
  else if (P.end) { x = d; t = (w.A + f.Oe - Math.abs(a)) / f.cs; }
  else { x = a; t = (Le - Math.abs(d)) / f.cs; }
  return { P, key: P.key, x, t };
}
// the stretches of a wing done in a stage: true — all; [[w, a0, a1]…]
const spans = (done, k, wi, f) => (done === true ? [[f.lo - 1, f.hi + 1]] : (done || []).filter((s) => s[0] === wi).map((s) => [s[1], s[2]]));
// the pieces of v0…v1 where hidden(v) is false (sampled every 50 mm)
function runs(v0, v1, hidden) {
  const out = [], n = Math.max(2, Math.ceil(Math.abs(v1 - v0) / MM(50)));
  let s = null;
  for (let k = 0; k <= n; k++) {
    const v = v0 + (v1 - v0) * k / n, h = hidden(v);
    if (!h && s == null) s = v;
    if ((h || k === n) && s != null) { out.push([s, h ? v0 + (v1 - v0) * (k - 1) / n : v]); s = null; }
  }
  return out;
}
const inSpans = (sp, a) => sp.some(([a0, a1]) => a >= a0 - 1e-7 && a <= a1 + 1e-7);
// a plane's stretches for a stage: in x (x along a), or in t (a slope along the ridge) — [[x0, x1, t0, t1]…]
function planeSpans(P, sp, f) {
  if (P.end) return inSpans(sp, P.end > 0 ? f.hi - MM(100) : f.lo + MM(100)) ? [[-Infinity, Infinity, 0, Infinity]] : [];
  if (P.xd) return sp.map(([a0, a1]) => { const t0 = P.tOfA(a0), t1 = P.tOfA(a1); return [-Infinity, Infinity, Math.min(t0, t1), Math.max(t0, t1)]; });
  return sp.map(([a0, a1]) => [a0, a1, 0, Infinity]);
}
// the normal of a plane, and its directions along x and up t (world)
function frameOf(f, P) {
  const xm = (P.xa(0) + P.xb(0)) / 2, p = (x, t) => { const [a, d] = P.at(x, t); return new THREE.Vector3(...f.W(a, d, f.top(a, d))); };
  const ex = p(xm + 1e-4, 1e-4).sub(p(xm, 1e-4)).normalize(), et = p(xm, 2e-4).sub(p(xm, 1e-4)).normalize();
  const n = new THREE.Vector3().crossVectors(ex, et).normalize(); if (n.y < 0) n.negate();
  return { n, ex, et, pt: (x, t, off = 0) => p(x, t).addScaledVector(n, off) };
}

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

// a sheet over a plane at an offset along its normal; only where this wing's roof is the top
// (not inside a wing it runs into), not in the holes (the windows), within x0…x1, t0…t1
function sheet(ctx, P, off, dx, dt, prof, uv, x0 = -Infinity, x1 = Infinity, t0 = 0, t1 = Infinity, holes = []) {
  const { f, wi, roof, shapes } = ctx;
  const X0 = Math.max(x0, Math.min(P.xa(0), P.xa(P.L))), X1 = Math.min(x1, Math.max(P.xb(0), P.xb(P.L)));
  const T0 = Math.max(0, t0), T1 = Math.min(P.L, t1);
  if (X1 - X0 < 1e-6 || T1 - T0 < 1e-6) return null;
  const nx = Math.max(1, Math.ceil((X1 - X0) / dx)), nt = Math.max(1, Math.ceil((T1 - T0) / dt)), pos = [], uvs = [], hide = [], idx = [];
  const { n } = frameOf(f, P);
  for (let j = 0; j <= nt; j++) {
    const t = Math.min(T1, T0 + j * dt), xa = Math.max(X0, P.xa(t)), xb = Math.min(X1, P.xb(t));
    for (let i = 0; i <= nx; i++) {
      const x = xb < xa ? xa : Math.max(xa, Math.min(xb, X0 + i * (X1 - X0) / nx));
      const [a, d] = P.at(x, t), y = f.top(a, d), h = off + (prof ? prof(x, t) : 0), w = f.W(a, d, y);
      pos.push(w[0] + n.x * h, w[1] + n.y * h, w[2] + n.z * h);
      uvs.push(...uv(x, t));
      hide.push(xb < xa - 1e-7 || holes.some((q) => x > q[0] && x < q[1] && t > q[2] && t < q[3]) || roofTop(roof, shapes, w[0], w[2], wi) > y + MM(2));
    }
  }
  for (let j = 0; j < nt; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if ([a, b, c, d].filter((q) => hide[q]).length > 1) continue;
    idx.push(a, b, c, b, d, c);
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const nn = g.attributes.normal; let up = 0; for (let i = 0; i < nn.count; i += 7) up += nn.getY(i);
  if (up < 0) { for (let k = 0; k < idx.length; k += 3) { const q = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = q; } g.setIndex(idx); g.computeVertexNormals(); }
  return { g, n };
}

// the valleys: where the slopes of two wings meet (both the top there) → [[p0, p1]…] (world)
export function valleys(roof, shapes) {
  const out = [];
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const fi = shapes[i], fj = shapes[j];
    // walk a grid over where both are, mark where they are level and both the top
    const pts = [];
    const bb = (f, w) => [f.W(f.lo, -(w.B + f.Oe), 0), f.W(f.hi, -(w.B + f.Oe), 0), f.W(f.lo, w.B + f.Oe, 0), f.W(f.hi, w.B + f.Oe, 0)];
    const ci = bb(fi, roof.wings[i]), cj = bb(fj, roof.wings[j]);
    const x0 = Math.max(Math.min(...ci.map((q) => q[0])), Math.min(...cj.map((q) => q[0]))), x1 = Math.min(Math.max(...ci.map((q) => q[0])), Math.max(...cj.map((q) => q[0])));
    const z0 = Math.max(Math.min(...ci.map((q) => q[2])), Math.min(...cj.map((q) => q[2]))), z1 = Math.min(Math.max(...ci.map((q) => q[2])), Math.max(...cj.map((q) => q[2])));
    if (x1 <= x0 || z1 <= z0) continue;
    const st = MM(60), hgt = (f, x, z) => { const [a, d] = f.L(x, z); return f.inside(a, d) ? f.top(a, d) : -Infinity; };
    for (let x = x0; x <= x1; x += st) for (let z = z0; z <= z1; z += st) {
      const hi = hgt(fi, x, z), hj = hgt(fj, x, z);
      if (!isFinite(hi) || !isFinite(hj) || Math.abs(hi - hj) > st * 0.6 * fi.tn) continue;
      if (roofTop(roof, shapes, x, z) > Math.max(hi, hj) + MM(5)) continue;
      // (a valley: the roof dips there — lower than a little way off on both sides)
      pts.push([x, Math.max(hi, hj), z]);
    }
    if (pts.length < 4) continue;
    // the points lie along straight lines from the inner corner of the eaves up: fit one
    // line per cluster (by direction from the lowest point)
    pts.sort((p, q) => p[1] - q[1]);
    const used = new Set();
    for (let k = 0; k < pts.length; k++) {
      if (used.has(k)) continue;
      const p0 = pts[k], line = [k];
      // the farthest point that keeps the others near the line
      let best = null;
      for (let m = pts.length - 1; m > k; m--) {
        if (used.has(m)) continue;
        const q = pts[m], dx = q[0] - p0[0], dz = q[2] - p0[2], L = Math.hypot(dx, dz);
        if (L < MM(400)) continue;
        const near = pts.map((r, n) => [n, Math.abs((r[0] - p0[0]) * dz - (r[2] - p0[2]) * dx) / L, ((r[0] - p0[0]) * dx + (r[2] - p0[2]) * dz) / L]).filter(([n, off, al]) => !used.has(n) && off < st * 0.8 && al > -st && al < L + st);
        if (near.length >= Math.max(4, L / st * 0.5)) { best = { q, near }; break; }
      }
      if (!best) continue;
      for (const [n] of best.near) used.add(n);
      used.add(k); line.push(0);
      out.push([p0, best.q]);
    }
  }
  return out;
}

const MATS = {};
const mat = (k, make) => MATS[k] || (MATS[k] = make());
const winMats = (col) => ({
  frame: mat('rwF' + col, () => new THREE.MeshStandardMaterial({ color: (RWIN_COLOURS[col] || RWIN_COLOURS.graphite)[1], metalness: 0.5, roughness: 0.4 })),
  glass: mat('rwG', () => new THREE.MeshStandardMaterial({ color: 0x2a3a44, metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6 })),
  inner: mat('rwI', () => new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.8 })),
});

// the roof, built to its stages (live: a stage being laid now — { stage, w, a0, a1 } or
// { stage, all }); wins: the windows in it ({ wi, plane, x, t, key, col })
export function buildPitched(roof, live = null, wins = []) {
  const G = new THREE.Group(), done = { ...(roof.done || {}) };
  if (live?.stage) { const cur = done[live.stage]; done[live.stage] = live.all || cur === true ? true : [...(cur || []), [live.w, live.a0, live.a1]]; }
  const has = (k) => !!done[k] && (done[k] === true || done[k].length);
  const shapes = roof.wings.map((w) => wingShape(roof, w));
  const wood = mat('wood', () => new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.85 }));
  const beams = new Beams(), tie = MM(PITCHED.rafterH), rw = MM(PITCHED.rafterW), step = MM(PITCHED.step);
  const kind = roof.cover?.kind || 'metal', cc = COVER_COLOURS[kind][roof.cover?.col] || Object.values(COVER_COLOURS[kind])[0];
  const coff = MM(PITCHED.cb + (kind === 'shingle' ? 22 : PITCHED.batten[0] + 2));
  const metalMat = () => mat('cov' + kind + (roof.cover?.col || ''), () => new THREE.MeshStandardMaterial({ color: cc[1], metalness: kind === 'seam' ? 0.55 : 0.35, roughness: kind === 'seam' ? 0.42 : 0.5, side: THREE.DoubleSide }));
  const add = (m) => { if (m) { m.castShadow = m.receiveShadow = true; G.add(m); } return m; };
  const VL = valleys(roof, shapes);
  roof.wings.forEach((w, wi) => {
    const f = shapes[wi], ctx = { f, wi, roof, shapes }, PL = planes(roof, w, f);
    const under = (a, d) => { const p = f.W(a, d, 0); return roofTop(roof, shapes, p[0], p[2], wi) > f.top(a, d) + MM(5); };   // (inside another wing's roof)
    const holesOf = (P) => wins.filter((q) => q.wi === wi && q.plane === P.key).map((q) => { const [, W2, H2] = RWIN[q.key] || RWIN.s2; return [q.x - MM(W2 / 2 + 40), q.x + MM(W2 / 2 + 40), q.t - MM(H2 / 2 + 40), q.t + MM(H2 / 2 + 40)]; });
    // the wall plate on the middle of the walls (not across where a wing joins on); the masonry under the roof
    if (has('plate')) {
      const ya = roof.y0 + MM(75), ia = w.A - roof.T / 2, ib = w.B - roof.T / 2, pl = MM(PITCHED.plate);
      for (const s of [-1, 1]) {
        beams.add(f.W(-ia - MM(75), s * ib, ya), f.W(ia + MM(75), s * ib, ya), pl, pl);
        if (f.ends[s < 0 ? 0 : 1] !== 'join') beams.add(f.W(s * ia, -ib + MM(75), ya), f.W(s * ia, ib - MM(75), ya), pl, pl);
      }
      walls(G, roof, w, f);
    }
    // the ceiling joists across the house on the plate, every 600 (not inside another wing)
    const yL = roof.y0 + MM(PITCHED.plate) + MM(100), ib = w.B - roof.T / 2, jA = w.A - roof.T, joistAt = [];
    for (let a = -jA + MM(50); a <= jA - MM(50) + 1e-7; a += step) joistAt.push(a);
    if (has('joists')) for (const a of joistAt) { if (under(a, 0)) continue; beams.add(f.W(a, -ib - MM(60), yL), f.W(a, ib + MM(60), yL), rw, MM(200)); }
    // the ridge purlin (as on site): posts on the joists, the purlin on the posts and on the
    // gables; the rafters rest on it
    if ((has('ridge') || has('frame')) && !f.mono) {
      const [r0, r1] = f.ridgeA, yR = f.ridge - tie / f.cs - MM(100);
      for (const [b0, b1] of runs(r0, r1, (a) => under(a, 0))) if (b1 - b0 > MM(200)) beams.add(f.W(b0, 0, yR), f.W(b1, 0, yR), MM(150), MM(200));
      const in0 = Math.max(r0, -(w.A - roof.T)), in1 = Math.min(r1, w.A - roof.T), n = Math.max(1, Math.ceil((in1 - in0) / MM(3000)));
      for (let i = 0; i <= n; i++) {
        if ((i === 0 && f.ends[0] !== 'hip') || (i === n && f.ends[1] !== 'hip')) continue;   // (a gable / a joined wing carries the end)
        let a = in0 + (in1 - in0) * i / n;
        if (has('joists')) a = joistAt.reduce((p, q) => (Math.abs(q - a) < Math.abs(p - a) ? q : p), joistAt[0]) + rw / 2 + MM(50);   // (beside a joist, nailed to it)
        if (under(a, 0) || yR - MM(100) - (yL + MM(100)) < MM(150)) continue;
        if (!has('joists')) beams.add(f.W(a, -ib, yL), f.W(a, ib, yL), MM(100), MM(200));   // (a roof begun before the joists: a beam under the post)
        beams.add(f.W(a, 0, yL + MM(100)), f.W(a, 0, yR - MM(100)), MM(100), MM(100));
      }
    }
    const fr = spans(done.frame, 'frame', wi, f);
    // the rafters on each plane, every 600 along it (a jack stops at the hip; under another
    // wing's roof — none; round a window — cut, with a header and a sill across)
    const rafterLines = (P, sp) => {
      const out = [], hs = holesOf(P), x0 = P.end ? P.xa(0) : P.xd ? P.xa(0) : f.lo;
      for (let x = x0 + rw; x <= P.xb(0) - rw + 1e-7; x += step) {
        if (x < P.xa(0) + rw * 0.5) continue;
        let t1 = P.L; while (t1 > 0 && (x < P.xa(t1) - 1e-7 || x > P.xb(t1) + 1e-7)) t1 -= MM(40);
        if (t1 < MM(200)) continue;
        for (const [sx0, sx1, st0, st1] of planeSpans(P, sp, f)) {
          if (x < sx0 || x > sx1) continue;
          const a0 = Math.max(0, st0), a1 = Math.min(t1, st1);
          for (const [q0, q1] of runs(a0, a1, (t) => { const [a, d] = P.at(x, t); return under(a, d) || hs.some((h) => x > h[0] - rw && x < h[1] + rw && t > h[2] && t < h[3]); })) if (q1 - q0 > MM(150)) out.push([x, q0, q1]);
        }
      }
      return out;
    };
    if (fr.length) {
      const [r0, r1] = f.ridgeA;
      void r0; void r1;
      for (const P of PL) {
        const F = frameOf(f, P);
        for (const [x, t0, t1] of rafterLines(P, fr)) beams.add(F.pt(x, t0, -tie / 2).toArray(), F.pt(x, t1, -tie / 2).toArray(), rw, tie);
        // the headers round the windows
        for (const h of holesOf(P)) for (const t of [h[2], h[3]]) beams.add(F.pt(h[0] - rw, t, -tie / 2).toArray(), F.pt(h[1] + rw, t, -tie / 2).toArray(), rw, tie);
      }
      if (!f.mono) {
        const yt = roof.y0 + MM(PITCHED.plate) + f.R * f.tn * 0.62, dt = f.R * 0.38;
        for (let a = f.lo + rw, k = 0; a <= f.hi - rw; a += step, k++) if (k % 2 === 0 && inSpans(fr, a) && Math.abs(a) <= w.A - roof.T && !under(a, 0) && f.top(a, dt) - tie / f.cs > yt + MM(80)) beams.add(f.W(a + rw, -dt, yt), f.W(a + rw, dt, yt), rw, MM(150));
      }
      const Le = w.B + f.Oe;
      for (const k of [0, 1]) if (f.ends[k] === 'hip' && inSpans(fr, k ? f.hi - MM(100) : f.lo + MM(100))) {
        const sa = k ? 1 : -1, Ae = w.A + f.Oe - MM(80), mid = (a, d) => f.top(a, d) - tie / 2 / f.cs;
        for (const sd of [-1, 1]) { const a0 = sa * Ae, d0 = sd * (Le - MM(80)); beams.add(f.W(a0, d0, mid(a0, d0)), f.W(sa * (f.Ra - f.R), 0, mid(sa * (f.Ra - f.R), 0) + tie * 0.3), rw * 1.6, tie); }
      }
    }
    // the membrane, the battens, the covering over what is done
    const mb = spans(done.memb, 'memb', wi, f), bt = spans(done.battens, 'battens', wi, f), cv = spans(done.cover, 'cover', wi, f);
    for (const P of PL) {
      const hs = holesOf(P), F = frameOf(f, P);
      for (const [x0, x1, t0, t1] of planeSpans(P, mb, f)) { const r = sheet(ctx, P, MM(1), MM(150), MM(150), null, (x, t) => [x / MM(1500), t / MM(1500)], x0, x1, t0, t1, hs); if (r) add(new THREE.Mesh(r.g, mat('memb', () => new THREE.MeshStandardMaterial({ map: membTex(), roughness: 0.75, side: THREE.DoubleSide })))); }
      if (bt.length) {
        const cb = MM(PITCHED.cb);
        for (const [x, t0, t1] of rafterLines(P, bt)) beams.add(F.pt(x, t0, cb / 2).toArray(), F.pt(x, t1, cb / 2).toArray(), cb, cb, F.n);
        if (kind === 'shingle') for (const [x0, x1, t0, t1] of planeSpans(P, bt, f)) { const r = sheet(ctx, P, MM(PITCHED.cb + 9), MM(250), MM(250), null, (x, t) => [x / MM(2500), t / MM(1250)], x0, x1, t0, t1, hs); if (r) add(new THREE.Mesh(r.g, mat('osb', () => new THREE.MeshStandardMaterial({ map: osbTex(), roughness: 0.85 })))); }
        else {
          const st = MM(kind === 'seam' ? 300 : 350), [btt, bw] = PITCHED.batten.map(MM);
          for (const [s0, s1, u0, u1] of planeSpans(P, bt, f)) for (let t = MM(60); t < P.L - MM(80); t += st) {
            if (t < u0 || t > u1) continue;
            const xa = Math.max(s0, P.xa(t)), xb = Math.min(s1, P.xb(t)); if (xb - xa < MM(80)) continue;
            for (const [c0, c1] of runs(xa, xb, (x) => { const [a, d] = P.at(x, t); return under(a, d) || hs.some((h) => x > h[0] && x < h[1] && t > h[2] && t < h[3]); })) {
              if (c1 - c0 < MM(80)) continue;
              beams.add(F.pt(c0, t, cb + btt / 2).toArray(), F.pt(c1, t, cb + btt / 2).toArray(), bw, btt, F.n);
            }
          }
        }
      }
      for (const [x0, x1, t0, t1] of planeSpans(P, cv, f)) {
        if (kind === 'metal') {
          const prof = (x, t) => { const wv = 0.5 - 0.5 * Math.cos(2 * Math.PI * x / MM(185)), fr2 = (t % MM(350)) / MM(350); return MM(19) * wv + MM(16) * Math.min(1, fr2 / 0.92) - MM(16) * Math.max(0, (fr2 - 0.92) / 0.08); };
          const r = sheet(ctx, P, coff, MM(185 / 6), MM(350 / 7), prof, (x, t) => [x / MM(1000), t / MM(1000)], x0, x1, t0, t1, hs); if (r) add(new THREE.Mesh(r.g, metalMat()));
        } else if (kind === 'seam') {
          const r = sheet(ctx, P, coff, MM(100), MM(150), null, (x, t) => [x / MM(1000), t / MM(1000)], x0, x1, t0, t1, hs); if (!r) continue;
          add(new THREE.Mesh(r.g, metalMat()));
          const rib = new Beams(), rh = MM(25), xs0 = Math.max(x0, Math.min(P.xa(0), P.xa(P.L))), xs1 = Math.min(x1, Math.max(P.xb(0), P.xb(P.L)));
          for (let x = Math.ceil((xs0 - f.lo) / MM(500)) * MM(500) + f.lo; x < xs1; x += MM(500)) {
            let tt1 = Math.min(P.L, t1); while (tt1 > 0 && (x < P.xa(tt1) || x > P.xb(tt1))) tt1 -= MM(50);
            for (const [q0, q1] of runs(Math.max(0, t0), tt1, (t) => { const [a, d] = P.at(x, t); return under(a, d) || hs.some((h) => x > h[0] && x < h[1] && t > h[2] && t < h[3]); })) {
              if (q1 - q0 <= MM(100) || x < P.xa(q0) || x > P.xb(q0)) continue;
              rib.add(F.pt(x, q0, coff + rh / 2).toArray(), F.pt(x, q1, coff + rh / 2).toArray(), MM(10), rh, F.n);
            }
          }
          add(rib.mesh(metalMat()));
        } else {
          const T2 = shingleTex(cc[1]), r = sheet(ctx, P, coff, MM(250), MM(286), null, (x, t) => [x / MM(1000), t / MM(572)], x0, x1, t0, t1, hs);
          if (r) add(new THREE.Mesh(r.g, mat('sh' + roof.cover.col, () => new THREE.MeshStandardMaterial({ map: T2.map, normalMap: T2.normalMap, roughness: 0.95, side: THREE.DoubleSide }))));
        }
      }
      // the windows in this plane
      for (const q of wins.filter((q2) => q2.wi === wi && q2.plane === P.key)) G.add(slopeWindow(F, q, coff, has('cover')));
    }
    if (has('trim')) trims(G, roof, w, f, wi, shapes, PL, kind, cc, coff, metalMat);
    if (has('gutter')) gutters(G, roof, w, f, wi, shapes, PL, kind, cc, coff, metalMat);
  });
  if (VL.length) {
    const vb = new Beams(), vf = new Beams();
    for (const [p, q] of VL) {
      if (has('frame')) vb.add([p[0], p[1] - tie * 0.6, p[2]], [q[0], q[1] - tie * 0.6, q[2]], rw * 2, tie);
      if (has('cover')) vf.add([p[0], p[1] + coff + MM(25), p[2]], [q[0], q[1] + coff + MM(25), q[2]], MM(300), MM(4));
    }
    add(vb.mesh(wood)); add(vf.mesh(kind === 'shingle' ? mat('valSh', () => new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8 })) : metalMat()));
  }
  add(beams.mesh(wood));
  G.userData.shapes = shapes;
  return G;
}

// the masonry under the roof: each outer wall of the wing (not where it joins another) built up
// to the underside of the rafters where they stand clear of the wall plate — the gables, on a
// mono-pitch roof its high wall and the slopes of its ends
// the gables (and the high walls of a mono-pitch roof) of a roof with its wall plate on: the
// line of their tops along the outer face — [[x, y, z]…] each (the facade goes up to them)
export function gableWalls(roof) {
  const out = [];
  roof.wings.forEach((w) => {
    const f = wingShape(roof, w), T = roof.T, y0 = roof.y0, ub = (a, d) => Math.max(y0, f.top(a, d) - MM(PITCHED.rafterH) / f.cs - MM(5));
    const faces = [];
    for (const k of [0, 1]) if (f.ends[k] !== 'join') { const s = k ? 1 : -1; faces.push({ q0: -w.B, q1: w.B, at: (q, e) => [s * (w.A - e), q] }); }
    for (const s of [-1, 1]) faces.push({ q0: -w.A, q1: w.A, at: (q, e) => [q, s * (w.B - e)] });
    for (const F of faces) {
      const N = 32, pts = [];
      for (let k = 0; k <= N; k++) { const q = F.q0 + (F.q1 - F.q0) * k / N, [a, d] = F.at(q, T / 2), [ao, do_] = F.at(q, 0); pts.push(f.W(ao, do_, ub(a, d))); }
      if (Math.max(...pts.map((p) => p[1])) < y0 + MM(PITCHED.plate) + MM(150)) continue;
      out.push(pts);
    }
  });
  return out;
}
function walls(G, roof, w, f) {
  const gm = mat('gable', () => { const t = aeratedTexture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, side: THREE.DoubleSide }); });
  const T = roof.T, y0 = roof.y0, ub = (a, d) => Math.max(y0, f.top(a, d) - MM(PITCHED.rafterH) / f.cs - MM(5));
  const faces = [];
  for (const k of [0, 1]) if (f.ends[k] !== 'join') { const s = k ? 1 : -1; faces.push({ q0: -w.B, q1: w.B, at: (q, e) => [s * (w.A - e), q] }); }
  for (const s of [-1, 1]) faces.push({ q0: -w.A, q1: w.A, at: (q, e) => [q, s * (w.B - e)] });
  for (const F of faces) {
    const N = 16, top = [];
    for (let k = 0; k <= N; k++) { const q = F.q0 + (F.q1 - F.q0) * k / N, [a, d] = F.at(q, T / 2); top.push([q, ub(a, d)]); }
    if (Math.max(...top.map(([, y]) => y)) < y0 + MM(PITCHED.plate) + MM(150)) continue;   // (only where it stands clear: a gable, a high wall)
    const shp = new THREE.Shape([new THREE.Vector2(F.q0, y0), new THREE.Vector2(F.q1, y0), ...top.reverse().map(([q, y]) => new THREE.Vector2(q, y))]);
    const g = new THREE.ExtrudeGeometry(shp, { depth: T, bevelEnabled: false }), pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) { const q = pos.getX(i), y = pos.getY(i), e = pos.getZ(i), [a, d] = F.at(q, e); uv.setXY(i, (q + e) / MM(600), (y - y0) / MM(253)); pos.setXYZ(i, ...f.W(a, d, y)); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, gm); m.castShadow = m.receiveShadow = true; G.add(m);
  }
}

function trims(G, roof, w, f, wi, shapes, PL, kind, cc, coff, metalMat) {
  const tm = kind === 'shingle' ? mat('trimSh' + roof.cover.col, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(cc[1][0]).multiplyScalar(0.8), roughness: 0.9 })) : metalMat();
  const capR = MM(kind === 'shingle' ? 70 : 110), tie = MM(PITCHED.rafterH), Le = w.B + f.Oe;
  const cap = (p0, p1) => {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), L = a.distanceTo(b); if (L < 1e-6) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(capR, capR, L, 16), tm);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); m.castShadow = true; G.add(m);
  };
  const lift = coff / f.cs + MM(20) - capR * 0.55;
  const vis = (a, d) => { const p = f.W(a, d, 0); return roofTop(roof, shapes, p[0], p[2], wi) <= f.top(a, d) + MM(5); };
  if (!f.mono) {
    let [r0, r1] = f.ridgeA; while (r0 < r1 && !vis(r0, 0)) r0 += MM(50); while (r1 > r0 && !vis(r1, 0)) r1 -= MM(50);
    cap(f.W(r0, 0, f.ridge + lift), f.W(r1, 0, f.ridge + lift));
    for (const k of [0, 1]) if (f.ends[k] === 'hip') for (const sd of [-1, 1]) { const sa = k ? 1 : -1, a0 = sa * (w.A + f.Oe), d0 = sd * Le; cap(f.W(a0, d0, f.top(a0, d0) + lift), f.W(sa * (f.Ra - f.R), 0, f.ridge + lift)); }
  }
  const fas = new Beams(), sof = new Beams(), fh = tie / f.cs + MM(50);
  const trimM = mat('fascia' + kind + roof.cover.col, () => new THREE.MeshStandardMaterial({ color: kind === 'shingle' ? 0x6b4a33 : cc[1], roughness: 0.6, metalness: 0.2 }));
  for (const P of PL) {
    const F = frameOf(f, P), hidden = (x, t) => { const [a, d] = P.at(x, t); return !vis(a, d); };
    // the eave: the fascia over the rafters' ends, the soffit under the overhang
    const ov = (P.xd ? f.Oe : f.Oe), ts = ov / 2 / f.cs;
    for (const [x0, x1] of runs(P.xa(0), P.xb(0), (x) => hidden(x, 0))) {
      if (x1 - x0 < MM(100)) continue;
      const e0 = F.pt(x0, 0), e1 = F.pt(x1, 0), yy = e0.y - fh / 2 + MM(20);
      fas.add([e0.x, yy, e0.z], [e1.x, yy, e1.z], MM(25), fh);
      const s0 = F.pt(x0, ts), s1 = F.pt(x1, ts); sof.add([s0.x, yy - fh / 2 + MM(6), s0.z], [s1.x, yy - fh / 2 + MM(6), s1.z], ov, MM(10));
    }
    // the high edge of a mono-pitch roof
    if (P.hiEdge) { const e0 = F.pt(P.xa(P.L), P.L, coff - MM(40)), e1 = F.pt(P.xb(P.L), P.L, coff - MM(40)); fas.add([e0.x, e0.y - MM(80), e0.z], [e1.x, e1.y - MM(80), e1.z], MM(30), MM(220)); }
    // the verges up the gable's edges
    for (const [side, kindE] of [[0, P.ea], [1, P.eb]]) {
      if (kindE !== 'gable' || P.end) continue;
      const xe = side ? P.xb(0) : P.xa(0);
      for (const [t0, t1] of runs(0, P.L, (t) => hidden(xe, t))) if (t1 - t0 > MM(200)) fas.add(F.pt(xe, t0, coff - MM(60)).toArray(), F.pt(xe, t1, coff - MM(60)).toArray(), MM(30), MM(200), F.n);
    }
  }
  const m1 = fas.mesh(trimM); if (m1) G.add(m1);
  const m2 = sof.mesh(mat('sof', () => new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6 }))); if (m2) G.add(m2);
}

// the gutters along the eaves and how the water comes down from them (roof.gut { kind, col }):
//   round  – a half-round gutter 125 on hooks, round downpipes 90 in clamps down the walls,
//   square – a box gutter 125 × 85, rectangular downpipes 100 × 75,
//   chain  – a rain chain of links hung from the outlet, the water running down it,
//   cups   – a rain chain of cups (each one spills into the next);
// a downpipe kicks out onto a concrete splash channel (лоток), a chain hangs into a drain
// bowl of pebbles (the stormwater inlet under it). In the rain the water runs out of them.
function gutters(G, roof, w, f, wi, shapes, PL, kind, cc, coff, metalMat) {
  const gt = roof.gut || {}, typ = GUTTERS[gt.kind] ? gt.kind : 'round', GC = GUTTER_COLOURS[gt.col];
  const gm = GC ? mat('gut' + gt.col, () => new THREE.MeshStandardMaterial({ color: GC[1], metalness: GC[2] ? 0.85 : 0.25, roughness: GC[2] ? 0.32 : 0.42, side: THREE.DoubleSide }))
    : kind === 'shingle' ? mat('gutSh', () => new THREE.MeshStandardMaterial({ color: 0x5a3b28, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide })) : metalMat();
  const vis = (a, d) => { const p = f.W(a, d, 0); return roofTop(roof, shapes, p[0], p[2], wi) <= f.top(a, d) + MM(5); };
  const up = new THREE.Vector3(0, 1, 0), ground = roof.g ?? roof.y0 - MM(3000), gAt = (p) => Math.max(ground, GROUND.at?.(p.x, p.z) ?? -Infinity), sq = typ === 'square', chain = typ === 'chain' || typ === 'cups';
  const depth = sq ? MM(85) : MM(62), prof = sq ? [[-MM(62), MM(6)], [-MM(62), -MM(85)], [MM(56), -MM(85)], [MM(72), MM(12)], [MM(80), MM(12)]] : gutterRound(MM(62));
  const pipes = new Beams(), hooks = new Beams(), tubes = [], links = [], drains = [], streams = [];
  for (const P of PL) {
    const F = frameOf(f, P), out = F.et.clone().setY(0).normalize().negate();
    for (const [x0, x1] of runs(P.xa(0), P.xb(0), (x) => { const [a, d] = P.at(x, 0); return !vis(a, d); })) {
      if (x1 - x0 < MM(300)) continue;
      const lip = (x) => F.pt(x, 0, coff).addScaledVector(out, MM(50)).addScaledVector(up, -MM(55));   // the top of the gutter, on its axis
      const c0 = lip(x0), c1 = lip(x1), along = c1.clone().sub(c0).normalize(), side = new THREE.Vector3().crossVectors(along, up).normalize();
      const sgn = side.dot(out) > 0 ? 1 : -1;   // (the profile's +s: out, away from the wall)
      G.add(trough(c0, c1, prof.map(([q, y]) => [q * sgn, y]), gm));
      // the hooks under it every 600
      for (let x = x0 + MM(150); x < x1 - MM(100); x += MM(600)) {
        const c = lip(x);
        for (let i = 0; i + 1 < prof.length; i++) {
          const pa = c.clone().addScaledVector(side, prof[i][0] * sgn * 1.04).addScaledVector(up, prof[i][1] - MM(3)), pb = c.clone().addScaledVector(side, prof[i + 1][0] * sgn * 1.04).addScaledVector(up, prof[i + 1][1] - MM(3));
          hooks.add(pa.toArray(), pb.toArray(), MM(4), MM(25), along);
        }
        // and back up to the fascia board
        const back = c.clone().addScaledVector(out, -MM(62)).addScaledVector(up, MM(6));
        hooks.add(back.toArray(), back.clone().addScaledVector(out, -MM(40)).addScaledVector(up, MM(30)).toArray(), MM(25), MM(4));
      }
      // where the water comes down: near both ends of the run
      for (const x of [x0 + MM(250), x1 - MM(250)]) {
        const c = lip(x), bot = c.clone().addScaledVector(up, -depth);
        // the outlet (воронка) under the gutter
        tubes.push(cone(bot, MM(sq ? 58 : 52), MM(sq ? 44 : 46), MM(70)));
        if (chain) {
          const top = bot.clone().addScaledVector(up, -MM(70)), g0 = gAt(top);
          const end = new THREE.Vector3(top.x, g0 + MM(70), top.z);
          if (typ === 'chain') for (let y = top.y, k = 0; y > end.y + MM(20); y -= MM(42), k++) links.push([top.x, y - MM(21), top.z, k % 2]);
          else for (let y = top.y; y > end.y + MM(60); y -= MM(118)) links.push([top.x, y - MM(40), top.z, 2]);
          drains.push(end.clone().setY(g0));
          streams.push([top, end, MM(typ === 'chain' ? 17 : 10)]);
        } else {
          // the downpipe: down from the outlet, the offset back to the wall, down the wall, the kick out at the foot
          const top = bot.clone().addScaledVector(up, -MM(70));
          const wallP = top.clone().addScaledVector(out, -(f.Oe - MM(110))).setY(top.y - MM(350));
          const gk = gAt(wallP.clone().addScaledVector(out, MM(450)));
          const foot = wallP.clone().setY(gk + MM(300)), kick = foot.clone().addScaledVector(out, MM(200)).setY(gk + MM(150));
          const p0 = top.clone().setY(top.y - MM(100));
          const path = [top, p0, wallP, foot, kick];
          for (let i = 0; i + 1 < path.length; i++) {
            if (sq) pipes.add(path[i].toArray(), path[i + 1].toArray(), MM(100), MM(75), out);
            else tubes.push(tube(path[i], path[i + 1], MM(45)));
          }
          if (!sq) for (let i = 1; i + 1 < path.length; i++) tubes.push(new THREE.SphereGeometry(MM(45), 10, 6).translate(path[i].x, path[i].y, path[i].z));
          // the clamps to the wall every 1.5 m
          for (let y = wallP.y - MM(300); y > foot.y + MM(200); y -= MM(1500)) {
            const cp = wallP.clone().setY(y);
            if (sq) pipes.add(cp.clone().setY(y - MM(15)).toArray(), cp.clone().setY(y + MM(15)).toArray(), MM(108), MM(83), out);
            else tubes.push(tube(cp.clone().setY(y - MM(15)), cp.clone().setY(y + MM(15)), MM(50)));
            pipes.add(cp.toArray(), cp.clone().addScaledVector(out, -MM(70)).toArray(), MM(6), MM(20));
          }
          // the splash channel under the kick
          const ch = kick.clone().addScaledVector(out, MM(260)).setY(gk);
          drains.push({ ch, out });
          streams.push([kick.clone().addScaledVector(out, MM(30)), ch.clone().addScaledVector(out, -MM(160)).setY(gk + MM(40)), MM(20)]);
        }
      }
    }
  }
  const m = pipes.mesh(gm); if (m) G.add(m);
  const hm = hooks.mesh(gm); if (hm) G.add(hm);
  if (tubes.length) { const tm = new THREE.Mesh(mergeGeometries(tubes.map((g) => (g.index ? g.toNonIndexed() : g))), gm); tm.castShadow = true; G.add(tm); }
  // the chains (one instanced mesh of links / of cups)
  if (links.length) {
    const cupsOn = typ === 'cups', geo = cupsOn ? cupGeo() : new THREE.TorusGeometry(MM(13), MM(3.2), 5, 12).scale(1, 1.7, 1);
    const im = new THREE.InstancedMesh(geo, gm, links.length), q = new THREE.Quaternion(), M4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    links.forEach(([x, y, z, k], i) => { q.setFromAxisAngle(up, k === 1 ? Math.PI / 2 : 0); im.setMatrixAt(i, M4.compose(new THREE.Vector3(x, y, z), q, one)); });
    im.castShadow = true; G.add(im);
    if (cupsOn) {   // the links between the cups
      const lk = new THREE.InstancedMesh(new THREE.TorusGeometry(MM(9), MM(2.4), 4, 10).scale(1, 2.2, 1), gm, links.length);
      links.forEach(([x, y, z], i) => lk.setMatrixAt(i, M4.compose(new THREE.Vector3(x, y + MM(62), z), q.identity(), one)));
      G.add(lk);
    }
  }
  // the drains: a bowl of pebbles under a chain, a concrete channel under a downpipe
  const conc = mat('drainC', () => new THREE.MeshStandardMaterial({ color: 0x8e8c86, roughness: 0.9 }));
  const peb = mat('drainP', () => { const T = gravelTex(); return new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.normalMap, color: 0x8f8a84, roughness: 0.85 }); });
  for (const d of drains) {
    if (d.isVector3) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(MM(230), MM(240), MM(90), 20, 1, true), conc); ring.position.set(d.x, d.y + MM(45), d.z);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(MM(235), MM(14), 5, 20).rotateX(Math.PI / 2), conc); rim.position.set(d.x, d.y + MM(90), d.z);
      const bed = new THREE.Mesh(new THREE.CircleGeometry(MM(228), 20).rotateX(-Math.PI / 2), peb); bed.position.set(d.x, d.y + MM(70), d.z);
      for (const o of [ring, rim, bed]) { o.castShadow = o.receiveShadow = true; G.add(o); }
    } else {
      const { ch, out } = d, yaw = Math.atan2(-out.z, out.x), grp = new THREE.Group();
      const L = MM(500), Wd = MM(160), H = MM(60);
      for (const [y, h, z, wd] of [[H / 2 - MM(10), H - MM(20), 0, Wd], [H / 2, H, -Wd / 2 + MM(15), MM(30)], [H / 2, H, Wd / 2 - MM(15), MM(30)]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(L, h, wd), conc); b.position.set(0, y - (wd === Wd ? MM(15) : 0), z); b.castShadow = b.receiveShadow = true; grp.add(b);
      }
      grp.position.copy(ch); grp.rotation.y = yaw; G.add(grp);
    }
  }
  // the water: streaks running down (a texture scrolled), as thick as the rain is hard
  if (streams.length) {
    const wm = waterMat();
    for (const [a, b, r] of streams) {
      const st = new THREE.Mesh(tube(a, b, r, 6), wm); st.renderOrder = 2;
      st.onBeforeRender = () => { wm.opacity = 0.45 * WATER.rain; wm.map.offset.y = (performance.now() / 700) % 1; };
      G.add(st);
    }
  }
}
export const GUTTERS = { round: 'Круглый', square: 'Прямоугольный', chain: 'Цепь', cups: 'Цепь с чашами' };
export const GUTTER_COLOURS = { white: ['Белый', 0xecebe6], brown: ['Коричневый', 0x4b3326], graphite: ['Графит', 0x3d4145], red: ['Вишня', 0x5b1f26], zinc: ['Оцинковка', 0xb9bec1, true], copper: ['Медь', 0xb36b3d, true] };
// the profile of a half-round gutter (s across, y up from its top edge): the bead rolled at the outer lip
function gutterRound(r) {
  const pts = [[-r, MM(6)]];
  for (let i = 0; i <= 12; i++) { const th = Math.PI * (1 - i / 12); pts.push([Math.cos(th) * r, -Math.sin(th) * r]); }
  for (let i = 0; i <= 5; i++) { const th = Math.PI * (1 - i / 5) - Math.PI / 2; pts.push([r + MM(6) + Math.cos(th) * MM(6), Math.sin(th) * MM(6) + MM(6)]); }
  return pts;
}
// a gutter from c0 to c1 along its profile, the ends closed
function trough(c0, c1, prof, material) {
  const dir = c1.clone().sub(c0).normalize(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(dir, up).normalize(), pos = [], idx = [], n = prof.length;
  const at = (c, [q, y]) => c.clone().addScaledVector(side, q).addScaledVector(up, y);
  for (const c of [c0, c1]) for (const pr of prof) { const p = at(c, pr); pos.push(p.x, p.y, p.z); }
  for (let i = 0; i + 1 < n; i++) idx.push(i, n + i, i + 1, i + 1, n + i, n + i + 1);
  // the end caps: a fan from the middle of the top
  for (const [k, c] of [[0, c0], [1, c1]]) {
    const mid = c.clone().addScaledVector(up, Math.min(...prof.map((q) => q[1])) * 0.25), base = pos.length / 3; pos.push(mid.x, mid.y, mid.z);
    for (let i = 0; i + 1 < n; i++) idx.push(base, k * n + i, k * n + i + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.castShadow = m.receiveShadow = true;
  return m;
}
// a round pipe from a to b
function tube(a, b, r, seg = 10) {
  const d = b.clone().sub(a), L = d.length(), g = new THREE.CylinderGeometry(r, r, Math.max(L, 1e-6), seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// the outlet funnel: from the bottom of the gutter (r0) down to the pipe (r1)
function cone(top, r0, r1, h) { return new THREE.CylinderGeometry(r0, r1, h, 12, 1, true).translate(top.x, top.y - h / 2, top.z); }
// a cup of a rain chain: a bell, open at the top, a hole in the bottom (the water falls through)
function cupGeo() {
  const pts = [[MM(14), MM(-34)], [MM(24), MM(-36)], [MM(34), MM(-28)], [MM(40), MM(-8)], [MM(43), MM(14)], [MM(46), MM(30)], [MM(48), MM(32)], [MM(44), MM(30)], [MM(40), MM(12)], [MM(36), MM(-8)], [MM(30), MM(-24)], [MM(22), MM(-30)], [MM(14), MM(-30)]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 14);
}
let _water = null;
function waterMat() {
  if (_water) return _water;
  const cv = canvas(32, 128), g = cv.getContext('2d');
  g.fillStyle = 'rgb(120,138,150)'; g.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(225,238,248,${0.15 + Math.random() * 0.35})`; g.fillRect(Math.random() * 32, Math.random() * 128, 1 + Math.random() * 2, 8 + Math.random() * 30); }
  const t = asTex(cv); t.repeat.set(1, 3);
  return (_water = new THREE.MeshStandardMaterial({ map: t, color: 0xdde8f0, transparent: true, opacity: 0, roughness: 0.08, metalness: 0.1, depthWrite: false }));
}

// a window in a slope: the flashing collar over the covering round it, the frame, the glass
function slopeWindow(F, q, coff, covered) {
  const [, Wm, Hm] = RWIN[q.key] || RWIN.s2, W = MM(Wm), H = MM(Hm), M = winMats(q.col || 'graphite'), b = new Beams(), g = new Beams(), inn = new Beams();
  const P = (x, t, o) => F.pt(q.x + x, q.t + t, o).toArray();
  const base = covered ? coff : MM(30);
  // the collar (flashing) round it, the frame (60 wide, 90 high), the glass on it, the lining under
  b.add(P(-W / 2 - MM(70), 0, base + MM(6)), P(W / 2 + MM(70), 0, base + MM(6)), H + MM(140), MM(8), F.n);
  for (const s of [-1, 1]) {
    b.add(P(s * (W / 2 - MM(30)), -H / 2, base + MM(50)), P(s * (W / 2 - MM(30)), H / 2, base + MM(50)), MM(60), MM(90), F.n);
    b.add(P(-W / 2, s * (H / 2 - MM(30)), base + MM(50)), P(W / 2, s * (H / 2 - MM(30)), base + MM(50)), MM(60), MM(90), F.n);
  }
  g.add(P(-W / 2 + MM(60), 0, base + MM(92)), P(W / 2 - MM(60), 0, base + MM(92)), H - MM(120), MM(6), F.n);
  inn.add(P(-W / 2 + MM(40), 0, base - MM(120)), P(W / 2 - MM(40), 0, base - MM(120)), H - MM(80), MM(10), F.n);
  const grp = new THREE.Group();
  for (const [bb, m] of [[b, M.frame], [g, M.glass], [inn, M.inner]]) { const mm = bb.mesh(m); if (mm) { mm.castShadow = m !== M.glass; grp.add(mm); } }
  return grp;
}
// a window on a flat roof: on a kerb 150 high, the membrane turned up it, the frame, the glass
export function flatWindow(q) {
  const [, Wm, Hm] = RWIN[q.key] || RWIN.s2, W = MM(Wm), H = MM(Hm), M = winMats(q.col || 'graphite'), grp = new THREE.Group();
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(W + MM(200), MM(150), H + MM(200)), mat('kerb', () => new THREE.MeshStandardMaterial({ color: 0x9fa3a6, roughness: 0.6 })));
  kerb.position.y = MM(75);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + MM(60), MM(70), H + MM(60)), M.frame); frame.position.y = MM(185);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W - MM(60), MM(10), H - MM(60)), M.glass); glass.position.y = MM(225);
  for (const m of [kerb, frame]) { m.castShadow = m.receiveShadow = true; }
  grp.add(kerb, frame, glass);
  grp.position.set(q.x, q.y, q.z); grp.rotation.y = q.yaw || 0;
  return grp;
}
