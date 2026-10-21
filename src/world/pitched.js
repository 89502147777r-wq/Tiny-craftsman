import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { canvas, asTex, normalOf } from './roof.js';
import { aeratedTexture } from './walls.js';

// A pitched roof (скатная крыша) over the house, built up layer by layer:
//   plate   – the wall plate (мауэрлат) 150 × 150 on the top of the walls, and the masonry
//             the roof needs under it: the gables (фронтоны), on a mono-pitch roof its high
//             wall and the slopes of its ends,
//   frame   – the rafters 50 × 200 every 600, the ridge beam, the collar ties; the hip
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
//          walls), e: [end at −a, end at +a] ('gable' | 'hip' | 'join'), x: [how far a join
//          runs on] }
//   roof { y0 (the top of the walls), T (their thickness), style ('gable'|'hip'|'mono'),
//          pitch (°), cover { kind, col }, wings: […], done: { stage: true | [[w, a0, a1]…] } }
// A stage laid by the finger is done over stretches along a wing's ridge (a0…a1).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const PITCHED = { plate: 150, rafterW: 50, rafterH: 200, step: 600, eave: 500, gable: 400, cb: 50, batten: [25, 100], sheet: { metal: 1180, seam: 500, shingle: 1000 } };
export const ROOF_TYPES = { gable: 'Двускатная', hip: 'Вальмовая', mono: 'Односкатная' };
export const PITCHES = { gable: [25, 30, 35, 45], hip: [20, 25, 30, 35], mono: [8, 12, 15, 20] };
export const COVERS = { metal: 'Металлочерепица', seam: 'Фальц', shingle: 'Мягкая черепица' };
export const COVER_COLOURS = {
  metal: { ral3005: ['Вишня', 0x5b1f26], ral8017: ['Шоколад', 0x45322e], ral7024: ['Графит', 0x474a50], ral6005: ['Зелёный мох', 0x163f33], ral3011: ['Красно-коричневый', 0x7a2622] },
  seam: { ral7024: ['Графит', 0x45484d], ral7016: ['Антрацит', 0x383e42], ral9005: ['Чёрный', 0x17181a], zinc: ['Титан-цинк', 0x8d9295], copper: ['Медь', 0xa8653f] },
  shingle: { brown: ['Коричневая', ['#5e3b28', '#4a2c1e', '#6f4a33']], red: ['Красная', ['#7d2b22', '#65221b', '#8f3a2c']], grey: ['Серая', ['#5d6064', '#4b4e52', '#70737a']], green: ['Зелёная', ['#34463a', '#2a3a2f', '#43574a']] },
};
export const STAGES = [['plate', 'Мауэрлат и фронтоны'], ['frame', 'Стропила'], ['memb', 'Мембрана'], ['battens', 'Обрешётка'], ['cover', 'Покрытие'], ['trim', 'Конёк и планки']];
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
  const al = roof.pitch * Math.PI / 180, tn = Math.tan(al), cs = Math.cos(al), mono = roof.style === 'mono';
  const T = roof.T, R = w.B - T / 2 + MM(75), Ra = w.A - T / 2 + MM(75);
  const base = roof.y0 + MM(PITCHED.plate) + MM(PITCHED.rafterH) / cs;
  const Oe = MM(PITCHED.eave), Og = MM(PITCHED.gable);
  // how far each end runs out: the overhang, or into the wing it joins
  const ext = [0, 1].map((k) => (w.e[k] === 'join' ? (w.x?.[k] ?? 0) : w.e[k] === 'hip' ? Oe : Og));
  const lo = -(w.A + ext[0]), hi = w.A + ext[1];
  const L = (x, z) => { const dx = x - w.cx, dz = z - w.cz; return [dx * w.ux + dz * w.uz, -dx * w.uz + dz * w.ux]; };
  const W = (a, d, y) => [w.cx + w.ux * a - w.uz * d, y, w.cz + w.uz * a + w.ux * d];
  const hipLim = (a) => (a < 0 ? (w.e[0] === 'hip' ? Ra + a : Infinity) : (w.e[1] === 'hip' ? Ra - a : Infinity));
  const run = (a, d) => Math.min(mono ? R + d : R - Math.abs(d), hipLim(a));   // (in from the eaves, along the slope's fall)
  const top = (a, d) => base + run(a, d) * tn;
  const inside = (a, d, o = 0) => a >= lo - o && a <= hi + o && Math.abs(d) <= w.B + Oe + o;
  return { al, tn, cs, R, Ra, base, Oe, Og, ext, lo, hi, L, W, top, inside, mono, ridge: base + (mono ? 2 * R : R) * tn, ridgeA: [w.e[0] === 'hip' ? -(Ra - R) : lo, w.e[1] === 'hip' ? Ra - R : hi] };
}
// the roof over a point: the highest of the wings over it (−∞: none)
export function roofTop(roof, shapes, x, z, skip = -1) {
  let h = -Infinity;
  shapes.forEach((f, i) => { if (i === skip) return; const [a, d] = f.L(x, z); if (f.inside(a, d)) h = Math.max(h, f.top(a, d)); });
  return h;
}
// the planes of a wing: x along its eave, t up the slope from the eave's edge; at(x, t) → [a, d];
// the stretch of x of the plane at t: [xa(t), xb(t)]
function planes(roof, w, f) {
  const out = [], Le = w.B + f.Oe;
  if (f.mono) {
    out.push({ key: 'm', L: 2 * Le / f.cs, at: (x, t) => [x, -Le + t * f.cs], xa: () => f.lo, xb: () => f.hi, side: 1 });
    return out;
  }
  for (const sg of [-1, 1]) {
    const dd = (t) => Math.max(0, Le - t * f.cs);
    out.push({ key: 's' + sg, L: Le / f.cs, at: (x, t) => [x, sg * (Le - t * f.cs)], xa: (t) => (w.e[0] === 'hip' ? -(f.Ra - f.R + dd(t)) : f.lo), xb: (t) => (w.e[1] === 'hip' ? f.Ra - f.R + dd(t) : f.hi), side: sg });
  }
  for (const k of [0, 1]) if (w.e[k] === 'hip') {
    const sg = k ? 1 : -1, Ae = w.A + f.Oe;
    out.push({ key: 'e' + sg, end: sg, L: Le / f.cs, at: (x, t) => [sg * (Ae - t * f.cs), x], xa: (t) => -Math.max(0, Ae - t * f.cs - (f.Ra - f.R)), xb: (t) => Math.max(0, Ae - t * f.cs - (f.Ra - f.R)) });
  }
  return out;
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
// (not inside a wing it runs into) and within x0…x1; prof(x, t) → the height of the profile
function sheet(ctx, P, off, dx, dt, prof, uv, x0 = -Infinity, x1 = Infinity) {
  const { f, wi, roof, shapes } = ctx;
  const X0 = Math.max(x0, Math.min(P.xa(0), P.xa(P.L))), X1 = Math.min(x1, Math.max(P.xb(0), P.xb(P.L)));
  if (X1 - X0 < 1e-6) return null;
  const nx = Math.max(1, Math.ceil((X1 - X0) / dx)), nt = Math.max(1, Math.ceil(P.L / dt)), pos = [], uvs = [], hide = [], idx = [];
  const p = (x, t) => { const [a, d] = P.at(x, t); return new THREE.Vector3(...f.W(a, d, f.top(a, d))); };
  const xm = (X0 + X1) / 2, n = new THREE.Vector3().crossVectors(p(xm + 1e-4, 1e-4).sub(p(xm, 1e-4)), p(xm, 2e-4).sub(p(xm, 1e-4))).normalize();
  if (n.y < 0) n.negate();
  for (let j = 0; j <= nt; j++) {
    const t = Math.min(P.L, j * dt), xa = Math.max(X0, P.xa(t)), xb = Math.min(X1, P.xb(t));
    for (let i = 0; i <= nx; i++) {
      const x = xb < xa ? xa : Math.max(xa, Math.min(xb, X0 + i * (X1 - X0) / nx));
      const [a, d] = P.at(x, t), y = f.top(a, d), h = off + (prof ? prof(x, t) : 0), w = f.W(a, d, y);
      pos.push(w[0] + n.x * h, w[1] + n.y * h, w[2] + n.z * h);
      uvs.push(...uv(x, t));
      // (under another wing's roof: hidden — the valley)
      hide.push(xb < xa - 1e-7 || roofTop(roof, shapes, w[0], w[2], wi) > y + MM(2));
    }
  }
  for (let j = 0; j < nt; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (hide[a] && hide[b] && hide[c] && hide[d]) continue;
    if (hide[a] || hide[b] || hide[c] || hide[d]) { if ([a, b, c, d].filter((q) => hide[q]).length > 1) continue; }
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

// the roof, built to its stages (live: a stage being laid now — { stage, w, a0, a1 })
export function buildPitched(roof, live = null) {
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
    const f = shapes[wi], ctx = { f, wi, roof, shapes }, PL = planes(roof, w, f), Le = w.B + f.Oe;
    const mid = (a, d) => f.top(a, d) - tie / 2 / f.cs;
    const under = (a, d) => { const p = f.W(a, d, 0); return roofTop(roof, shapes, p[0], p[2], wi) > f.top(a, d) + MM(5); };   // (inside another wing's roof)
    // the wall plate on the middle of the walls (not across where a wing joins on)
    if (has('plate')) {
      const ya = roof.y0 + MM(75), ia = w.A - roof.T / 2, ib = w.B - roof.T / 2, pl = MM(PITCHED.plate);
      for (const s of [-1, 1]) {
        beams.add(f.W(-ia - MM(75), s * ib, ya), f.W(ia + MM(75), s * ib, ya), pl, pl);
        if (w.e[s < 0 ? 0 : 1] !== 'join') beams.add(f.W(s * ia, -ib + MM(75), ya), f.W(s * ia, ib - MM(75), ya), pl, pl);
      }
      gables(G, roof, w, f);
    }
    // the frame
    const fr = spans(done.frame, 'frame', wi, f);
    if (fr.length) {
      const [r0, r1] = f.ridgeA;
      if (!f.mono) for (const [a0, a1] of fr) { const b0 = Math.max(r0, a0), b1 = Math.min(r1, a1); if (b1 > b0) beams.add(f.W(b0, 0, f.ridge - tie * 0.7), f.W(b1, 0, f.ridge - tie * 0.7), rw, MM(250)); }
      const eL = f.mono ? -Le + MM(80) : Le - MM(80), ds = f.mono ? [[-Le + MM(80), Le - MM(80)]] : [[-eL, 0], [eL, 0]];
      for (let a = f.lo + rw; a <= f.hi - rw + 1e-7; a += step) {
        if (!inSpans(fr, a)) continue;
        const lim = (a < 0 && w.e[0] === 'hip') || (a > 0 && w.e[1] === 'hip') ? Math.max(0, Math.abs(a) - (f.Ra - f.R)) : null;
        for (const [d0, d1] of ds) {
          // (a jack rafter stops at the hip; a rafter under another wing's roof — none)
          const de = lim == null ? d1 : Math.sign(d0) * Math.min(Math.abs(d0), Math.max(0, f.R - (f.Ra - Math.abs(a))));
          if (lim != null && Math.abs(a) > f.Ra - f.R && Math.abs(de) >= Math.abs(d0) - MM(50)) continue;
          const dEnd = lim == null ? d1 : de;
          for (const [q0, q1] of runs(d0, dEnd, (d) => under(a, d))) {
            if (Math.abs(q1 - q0) < MM(200)) continue;
            beams.add(f.W(a, q0, mid(a, q0)), f.W(a, q1, mid(a, q1) + (q1 === dEnd && lim == null && !f.mono ? tie * 0.3 : 0)), rw, tie);
          }
        }
      }
      // the collar ties every second pair, two thirds up
      if (!f.mono) {
        const yt = roof.y0 + MM(PITCHED.plate) + f.R * f.tn * 0.62, dt = f.R * 0.38;
        for (let a = f.lo + rw, k = 0; a <= f.hi - rw; a += step, k++) if (k % 2 === 0 && inSpans(fr, a) && Math.abs(a) <= w.A - roof.T && !under(a, 0) && f.top(a, dt) - tie / f.cs > yt + MM(80)) beams.add(f.W(a + rw, -dt, yt), f.W(a + rw, dt, yt), rw, MM(150));
      }
      // the hip rafters and the end jacks
      for (const k of [0, 1]) if (w.e[k] === 'hip' && inSpans(fr, k ? f.hi - MM(100) : f.lo + MM(100))) {
        const sa = k ? 1 : -1, Ae = w.A + f.Oe - MM(80);
        for (const sd of [-1, 1]) {
          const a0 = sa * Ae, d0 = sd * (Le - MM(80)); beams.add(f.W(a0, d0, mid(a0, d0)), f.W(sa * (f.Ra - f.R), 0, mid(sa * (f.Ra - f.R), 0) + tie * 0.3), rw * 1.6, tie);
        }
        for (let d = -Le + step / 2; d < Le; d += step) { const aE = Math.abs(d) + (f.Ra - f.R); if (aE < Ae - MM(50)) beams.add(f.W(sa * Ae, d, mid(Ae, d)), f.W(sa * aE, d, mid(aE, d)), rw, tie); }
      }
    }
    // the membrane, the battens, the covering: over the stretches done
    const mb = spans(done.memb, 'memb', wi, f), bt = spans(done.battens, 'battens', wi, f), cv = spans(done.cover, 'cover', wi, f);
    const planeSpans = (P, sp) => (P.end ? (inSpans(sp, P.end > 0 ? f.hi - MM(100) : f.lo + MM(100)) ? [[-Infinity, Infinity]] : []) : sp);
    for (const P of PL) {
      for (const [a0, a1] of planeSpans(P, mb)) { const r = sheet(ctx, P, MM(1), MM(150), MM(150), null, (x, t) => [x / MM(1500), t / MM(1500)], a0, a1); if (r) add(new THREE.Mesh(r.g, mat('memb', () => new THREE.MeshStandardMaterial({ map: membTex(), roughness: 0.75, side: THREE.DoubleSide })))); }
      const bs = planeSpans(P, bt);
      if (bs.length) {
        const pp = (x, t) => { const [a, d] = P.at(x, t); return new THREE.Vector3(...f.W(a, d, f.top(a, d))); };
        const xm = (P.xa(0) + P.xb(0)) / 2, pn = new THREE.Vector3().crossVectors(pp(xm + 1e-4, 1e-4).sub(pp(xm, 1e-4)), pp(xm, 2e-4).sub(pp(xm, 1e-4))).normalize(); if (pn.y < 0) pn.negate();
        const cb = MM(PITCHED.cb), on = (o) => o / f.cs;
        // the counter-battens on the rafters (the sides)
        if (!P.end) for (let x = f.lo + rw; x <= f.hi - rw; x += step) {
          if (!bs.some(([a0, a1]) => x >= a0 && x <= a1)) continue;
          let t1 = P.L; while (t1 > 0 && (x < P.xa(t1) || x > P.xb(t1))) t1 -= MM(50);
          if (t1 < MM(200)) continue;
          for (const [t0, t2] of runs(0, t1, (t) => { const [a, d] = P.at(x, t); return under(a, d); })) {
            if (t2 - t0 < MM(150)) continue;
            const [a0, d0] = P.at(x, t0), [a1, d1] = P.at(x, t2);
            beams.add(f.W(a0, d0, f.top(a0, d0) + on(cb / 2)), f.W(a1, d1, f.top(a1, d1) + on(cb / 2)), cb, cb, pn);
          }
        }
        if (kind === 'shingle') for (const [a0, a1] of bs) { const r = sheet(ctx, P, MM(PITCHED.cb + 9), MM(250), MM(250), null, (x, t) => [x / MM(2500), t / MM(1250)], a0, a1); if (r) add(new THREE.Mesh(r.g, mat('osb', () => new THREE.MeshStandardMaterial({ map: osbTex(), roughness: 0.85 })))); }
        else {
          const st = MM(kind === 'seam' ? 300 : 350), [btt, bw] = PITCHED.batten.map(MM);
          for (let t = MM(60); t < P.L - MM(80); t += st) for (const [s0, s1] of bs) {
            const xa = Math.max(s0, P.xa(t)), xb = Math.min(s1, P.xb(t)); if (xb - xa < MM(80)) continue;
            // (only the pieces not under another wing)
            for (const [c0, c1] of runs(xa, xb, (x) => { const [a, d] = P.at(x, t); return under(a, d); })) {
              if (c1 - c0 < MM(80)) continue;
              const [a0, d0] = P.at(c0, t), [a1, d1] = P.at(c1, t);
              beams.add(f.W(a0, d0, f.top(a0, d0) + on(cb + btt / 2)), f.W(a1, d1, f.top(a1, d1) + on(cb + btt / 2)), bw, btt, pn);
            }
          }
        }
      }
      for (const [a0, a1] of planeSpans(P, cv)) {
        if (kind === 'metal') {
          const prof = (x, t) => { const wv = 0.5 - 0.5 * Math.cos(2 * Math.PI * x / MM(185)), fr2 = (t % MM(350)) / MM(350); return MM(19) * wv + MM(16) * Math.min(1, fr2 / 0.92) - MM(16) * Math.max(0, (fr2 - 0.92) / 0.08); };
          const r = sheet(ctx, P, coff, MM(185 / 6), MM(350 / 7), prof, (x, t) => [x / MM(1000), t / MM(1000)], a0, a1); if (r) add(new THREE.Mesh(r.g, metalMat()));
        } else if (kind === 'seam') {
          const r = sheet(ctx, P, coff, MM(100), MM(150), null, (x, t) => [x / MM(1000), t / MM(1000)], a0, a1); if (!r) continue;
          add(new THREE.Mesh(r.g, metalMat()));
          const rib = new Beams(), rh = MM(25), n = r.n;
          for (let x = Math.ceil((Math.max(a0, f.lo) - f.lo) / MM(500)) * MM(500) + f.lo; x < Math.min(a1, f.hi); x += MM(500)) {
            let t0 = 0, t1 = P.L; while (t1 > 0 && (x < P.xa(t1) || x > P.xb(t1))) t1 -= MM(50);
            const hid = (t) => { const [a, d] = P.at(x, t); return under(a, d); };
            while (t1 > t0 && hid(t1)) t1 -= MM(50); while (t0 < t1 && hid(t0)) t0 += MM(50);
            if (t1 - t0 <= MM(100) || x < P.xa(t0) || x > P.xb(t0)) continue;
            const [b0, e0] = P.at(x, t0), [b1, e1] = P.at(x, t1), o = coff + rh / 2, w0 = f.W(b0, e0, f.top(b0, e0)), w1 = f.W(b1, e1, f.top(b1, e1));
            rib.add([w0[0] + n.x * o, w0[1] + n.y * o, w0[2] + n.z * o], [w1[0] + n.x * o, w1[1] + n.y * o, w1[2] + n.z * o], MM(10), rh);
          }
          add(rib.mesh(metalMat()));
        } else {
          const T2 = shingleTex(cc[1]), r = sheet(ctx, P, coff, MM(250), MM(286), null, (x, t) => [x / MM(1000), t / MM(572)], a0, a1);
          if (r) add(new THREE.Mesh(r.g, mat('sh' + roof.cover.col, () => new THREE.MeshStandardMaterial({ map: T2.map, normalMap: T2.normalMap, roughness: 0.95, side: THREE.DoubleSide }))));
        }
      }
    }
    // the trims: the ridge, the hips, the fascia, the verges, the soffits
    if (has('trim')) trims(G, roof, w, f, wi, shapes, kind, cc, coff, metalMat);
  });
  // the valleys: a valley rafter under, the flashing over
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

// the masonry the roof needs over the walls: the gables (a gable end), on a mono-pitch roof the
// high wall and the slopes of its ends — up to the underside of the rafters
function gables(G, roof, w, f) {
  const gm = mat('gable', () => { const t = aeratedTexture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 }); });
  const yb = (a, d) => Math.max(roof.y0, f.top(a, d) - MM(PITCHED.rafterH) / f.cs - MM(5));
  const T = roof.T, faces = [];
  // (a face: along the line p0 → p1 on the plan (local), its inner normal side; the top: yb)
  for (const k of [0, 1]) if (w.e[k] === 'gable') { const a = (k ? 1 : -1) * w.A; faces.push({ pts: (q) => [a, q], q0: -w.B, q1: w.B, n: k ? -1 : 1, along: false, a }); }
  if (f.mono) faces.push({ pts: (q) => [q, w.B], q0: -w.A, q1: w.A, n: -1, along: true });
  for (const F of faces) {
    const N = 12, top = [];
    for (let k = 0; k <= N; k++) { const q = F.q0 + (F.q1 - F.q0) * k / N, [a, d] = F.pts(q); top.push([q, yb(F.along ? a : a - F.n * T / 2, F.along ? d - T / 2 : d)]); }
    if (top.every(([, y]) => y - roof.y0 < MM(40))) continue;
    const shp = new THREE.Shape([new THREE.Vector2(F.q0, roof.y0), new THREE.Vector2(F.q1, roof.y0), ...top.reverse().map(([q, y]) => new THREE.Vector2(q, y))]);
    const g = new THREE.ExtrudeGeometry(shp, { depth: T, bevelEnabled: false }), pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const q = pos.getX(i), y = pos.getY(i), e = pos.getZ(i);
      const [a, d] = F.along ? [q, w.B - e] : [F.a + F.n * e, q];
      const p = f.W(a, d, y); uv.setXY(i, (q + e) / MM(600), (y - roof.y0) / MM(253)); pos.setXYZ(i, ...p);
    }
    // (the frame swapped: back the right way round)
    const ix = g.index ? g.index.array : null;
    const flip = F.along ? (w.ux * w.ux + w.uz * w.uz > 0) : F.n > 0;
    if (flip) {
      if (ix) for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      else for (let k = 0; k < pos.count; k += 3) for (const A2 of [pos, uv]) { const n = A2.itemSize; for (let c = 0; c < n; c++) { const t = A2.array[(k + 1) * n + c]; A2.array[(k + 1) * n + c] = A2.array[(k + 2) * n + c]; A2.array[(k + 2) * n + c] = t; } }
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, gm); m.castShadow = m.receiveShadow = true; m.material.side = THREE.DoubleSide; G.add(m);
  }
}

function trims(G, roof, w, f, wi, shapes, kind, cc, coff, metalMat) {
  const tm = kind === 'shingle' ? mat('trimSh' + roof.cover.col, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(cc[1][0]).multiplyScalar(0.8), roughness: 0.9 })) : metalMat();
  const capR = MM(kind === 'shingle' ? 70 : 110), Le = w.B + f.Oe, tie = MM(PITCHED.rafterH);
  const cap = (p0, p1) => {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), L = a.distanceTo(b);
    if (L < 1e-6) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(capR, capR, L, 16), tm);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true; G.add(m);
  };
  const lift = coff / f.cs + MM(20) - capR * 0.55;
  const visible = (a, d) => { const p = f.W(a, d, 0); return roofTop(roof, shapes, p[0], p[2], wi) <= f.top(a, d) + MM(5); };
  if (!f.mono) {
    // the ridge: as far as it is the top
    let [r0, r1] = f.ridgeA; while (r0 < r1 && !visible(r0, 0)) r0 += MM(50); while (r1 > r0 && !visible(r1, 0)) r1 -= MM(50);
    cap(f.W(r0, 0, f.ridge + lift), f.W(r1, 0, f.ridge + lift));
    for (const k of [0, 1]) if (w.e[k] === 'hip') for (const sd of [-1, 1]) {
      const sa = k ? 1 : -1, a0 = sa * (w.A + f.Oe), d0 = sd * Le, ae = sa * (f.Ra - f.R);
      cap(f.W(a0, d0, f.top(a0, d0) + lift), f.W(ae, 0, f.ridge + lift));
    }
  }
  const fas = new Beams(), trimM = mat('fascia' + kind + roof.cover.col, () => new THREE.MeshStandardMaterial({ color: kind === 'shingle' ? 0x6b4a33 : cc[1], roughness: 0.6, metalness: 0.2 }));
  const fh = tie / f.cs + MM(50), yF = (a, d) => f.top(a, d) - fh / 2 + MM(20), sof = new Beams();
  // along the eaves (the low side of a mono-pitch roof, both sides of the others)
  for (const s of f.mono ? [-1, 1] : [-1, 1]) {
    let x0 = f.lo, x1 = f.hi; while (x0 < x1 && !visible(x0, s * Le)) x0 += MM(50); while (x1 > x0 && !visible(x1, s * Le)) x1 -= MM(50);
    if (x1 - x0 < MM(100)) continue;
    const yy = yF(0, s * Le);
    fas.add(f.W(x0, s * Le, yy), f.W(x1, s * Le, yy), MM(25), fh);
    sof.add(f.W(x0, s * (w.B + f.Oe / 2), yy - fh / 2 + MM(6)), f.W(x1, s * (w.B + f.Oe / 2), yy - fh / 2 + MM(6)), f.Oe, MM(10));
  }
  for (const k of [0, 1]) {
    const sa = k ? 1 : -1;
    if (w.e[k] === 'hip') { const a = sa * (w.A + f.Oe); fas.add(f.W(a, -Le, yF(a, 0)), f.W(a, Le, yF(a, 0)), MM(25), fh); sof.add(f.W(sa * (w.A + f.Oe / 2), -Le, yF(a, 0) - fh / 2 + MM(6)), f.W(sa * (w.A + f.Oe / 2), Le, yF(a, 0) - fh / 2 + MM(6)), f.Oe, MM(10)); }
    if (w.e[k] === 'gable') {
      // the verge boards up the gable's edges
      const a = sa * (w.A + f.Og);
      if (f.mono) fas.add(f.W(a, -Le, f.top(a, -Le) + coff / f.cs - MM(60)), f.W(a, Le, f.top(a, Le) + coff / f.cs - MM(60)), MM(30), MM(200));
      else for (const s2 of [-1, 1]) fas.add(f.W(a, s2 * Le, f.top(a, s2 * Le) + coff / f.cs - MM(60)), f.W(a, 0, f.ridge + coff / f.cs - MM(60)), MM(30), MM(200));
    }
  }
  const m1 = fas.mesh(trimM); if (m1) G.add(m1);
  const m2 = sof.mesh(mat('sof', () => new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6 }))); if (m2) G.add(m2);
}
