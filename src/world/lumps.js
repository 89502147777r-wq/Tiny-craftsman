import * as THREE from 'three';
import { MODEL_SCALE, CONCRETE, M_G5 } from '../config.js';
import { mortarPhoto } from './terrainMaterial.js';

// A lump of set concrete (the owner, 2026-11-16: «a drop of concrete on the ground is a dab — not a pillar down to the bottom when
// the ground round it is dug; a bucket picks it up whole and carries it, into the truck too»; the realist, 2026-11-17).
// Concrete spilt off the formwork onto the open ground (marked when poured — terrain._spillAt), once firm, ≥ 25 mm and ≤ 0,25 m
// thick, leaves the ground's concrete and becomes ONE thing per spill — a record { type: 'lump', x, z, y, yaw, cells: [[dx, dz, h,
// b] mm…] (b: its underside over its lowest point — the imprint of the ground it set on), at: 'ground' | 'truck', tx, ty, tz }.
// It lies in its imprint and along the slope (≤ 35°); dug under, it goes down; over a pit's edge it tips and slides in; what is
// heaped by it covers it, never lifts it; shoved, it rides on the surface; a bucket's teeth that hit a big one break it into uneven
// pieces 0,2–0,7 m (`breakLump`) — what fits, the bucket takes; tipped out, it falls; the truck's body tipping lets them slide out
// with the load one after another and fly 0,5–1,5 m off the tailgate; to the tip — gone with the load.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S, G = 9.81 / MODEL_SCALE;
export const LUMP = { thick: 0.5, minT: 0.025, minA: 0.01, whole: 0.3, slope: 35 };
const TAN = Math.tan(LUMP.slope * Math.PI / 180), UP = new THREE.Vector3(0, 1, 0);

// the ground's firm spills → lumps, one per spill (called now and then: main.js)
export function scanLumps(app) {
  const t = app.terrain, { nx, conc } = t, N = conc.length, firm = CONCRETE.stiff * 1.05, thin = MM(LUMP.thick * 1000), minT = MM(LUMP.minT * 1000);
  const spill = (i) => conc[i] >= minT && t.cSpill[i] === 1 && conc[i] <= thin && t.curedAt(i) >= firm && t.zone?.[i] !== 1;
  const seen = new Uint8Array(N), made = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || conc[s] < minT || !spill(s)) continue;
    const list = [s], st = [s]; seen[s] = 1;
    while (st.length) {
      const i = st.pop(), ix = i % nx, iz = (i / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = ix + dx, jz = iz + dz; if ((!dx && !dz) || jx < 0 || jz < 0 || jx > t.rx || jz > t.rz) continue;
        const j = jz * nx + jx; if (seen[j] || !spill(j)) continue; seen[j] = 1; st.push(j); list.push(j);
      }
    }
    if (list.length * t.cellArea * MODEL_SCALE * MODEL_SCALE < LUMP.minA) continue;   // (a speck: a stain, crumbled with the soil)
    let cx = 0, cz = 0, bot = Infinity;
    for (const i of list) { cx += t.toWorldX(i % nx); cz += t.toWorldZ((i / nx) | 0); bot = Math.min(bot, t.nat[i] + t.loose[i]); }
    cx /= list.length; cz /= list.length;
    const cells = list.map((i) => [Math.round((t.toWorldX(i % nx) - cx) / S), Math.round((t.toWorldZ((i / nx) | 0) - cz) / S), Math.round(conc[i] / S), Math.round((t.nat[i] + t.loose[i] - bot) / S)]);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const i of list) { const ix = i % nx, iz = (i / nx) | 0; x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); z0 = Math.min(z0, iz); z1 = Math.max(z1, iz); conc[i] = 0; t.cBase[i] = 0; t.cSm[i] = 0; t.cSpill[i] = 0; }
    t._concTouch(x0, z0, x1, z1); t._touch(x0, z0, x1, z1);
    made.push(app.objects.add({ type: 'lump', x: +cx.toFixed(6), z: +cz.toFixed(6), y: +bot.toFixed(6), yaw: 0, cells, cell: +(t.cell / S).toFixed(3), at: 'ground' }).id);   // (its cell as it is, 31,4 mm — rounded, the cells' keys drifted over a metre: neighbours lost)
  }
  return made;
}

// its size: r — the farthest of it from its middle (model units), h — its thickest, vol (m³), area (m²)
export function lumpSize(r) {
  const c = MM(r.cell || 30) / 2, a = Math.pow((r.cell || 30) / 1000, 2); let r2 = 0, h = 0, v = 0;
  for (const [dx, dz, hh] of r.cells) { r2 = Math.max(r2, Math.hypot(MM(dx), MM(dz)) + c); h = Math.max(h, MM(hh)); v += hh / 1000 * a; }
  return { r: r2, h, vol: v, area: r.cells.length * a };
}

// its extent along a world direction (ux, uz), model units — across a bucket's mouth, along it (the realist: what passes the mouth is
// measured in the bucket's axes, not by the farthest corner)
export function lumpExtent(r, ux, uz) {
  const cs = Math.cos(r.yaw || 0), sn = Math.sin(r.yaw || 0), c = MM(r.cell || 30); let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of r.cells) { const X = MM(dx) * cs + MM(dz) * sn, Z = -MM(dx) * sn + MM(dz) * cs, d = X * ux + Z * uz; lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return hi - lo + c;
}
// its mean thickness (model units) — what it breaks by
export function lumpThick(r) { let s = 0; for (const c of r.cells) s += c[2]; return MM(s / Math.max(1, r.cells.length)); }
// how long a bucket must bear on it before it cracks (s): 25 mm 0,1 s, 150 mm 0,7 s, thicker ~h² (250 mm ~1,9 s: 2–3 bearings) — the realist
export function pressNeed(r) { const h = lumpThick(r) * MODEL_SCALE; return h <= 0.15 ? 0.1 + 0.6 * Math.max(0, h - 0.025) / 0.125 : Math.min(3.5, 0.7 * (h / 0.15) ** 2); }
// the size its pieces break to: 3–6 of its thicknesses (4,5 h), not under 80 mm, none wider than what the bucket takes
export function chipR(r, w) { return Math.max(MM(80), Math.min(2.5 * lumpThick(r), w * 0.45)); }   // (a radius: the pieces come out ~2 of it across — 3–6 thicknesses)

// it breaks where it is hit (the realist, 2026-11-24): from the point `at` (world) 3–5 nearly straight cracks run out; what is within
// 3–6 of its thicknesses of it comes off in wedges between them, the rest stays one slab (one through-crack across it now and then);
// the broken faces marked (a cell's 5th: 1 — drawn full height, light, `_geo`); 5–15 % of what comes off is crumbs (crushed grit that
// stays on the ground — the particles carry it); the pieces part 5–30 mm from the blow, the wedges tilted 3–10°; dust low and short.
// → the new ids (the old one gone); `breakLump.last` — { crumbs (m³), before, after (m³) } for the tests
export function breakLump(app, id, maxR, rnd = Math.random, at = null) {
  const O = app.objects, r = O.get(id); if (!r) return [];
  const C = r.cell || 30, A = Math.pow(C / 1000, 2), cs = Math.cos(r.yaw || 0), sn = Math.sin(r.yaw || 0);
  const vol0 = r.cells.reduce((a, c) => a + c[2] / 1000 * A, 0), hMean = r.cells.reduce((a, c) => a + c[2], 0) / r.cells.length;
  // (the blow in its own frame, mm; none given — its middle)
  let H = [0, 0];
  if (at) { const dx = at.x - r.x, dz = at.z - r.z; H = [(dx * cs - dz * sn) / S, (dx * sn + dz * cs) / S]; }
  { let bd = Infinity, bc = null; for (const c of r.cells) { const d = Math.hypot(c[0] - H[0], c[1] - H[1]); if (d < bd) bd = d, bc = c; } if (bd > C * 2) H = [bc[0], bc[1]]; }
  // (mm: the wedges' reach — 1–2 radii of relative stiffness of a slab on the ground, l = (E h³ / 12(1 − ν²) k)^¼ (E 30 GPa, ν 0,2, k 50 MN/m³):
  // 150 mm ≈ 0,65 m, 30 mm ≈ 0,19 m; on a narrow slab they run out to its edges — the realist. A wedge wider than the bucket is split after)
  const lRel = Math.pow(30e9 * Math.pow(hMean / 1000, 3) / (12 * 0.96 * 5e7), 0.25) * 1000, Rc = Math.max(80, lRel * 1.1);
  const nRay = 3 + Math.floor(rnd() * 3), a0 = rnd() * Math.PI * 2, rays = [];
  for (let k = 0; k < nRay; k++) rays.push(a0 + (k + 0.25 + rnd() * 0.5) * Math.PI * 2 / nRay);
  const wob = rnd() * 10, reach = rays.map(() => 0.9 + rnd() * 0.8);
  const sector = (c) => {   // (which wedge: between which rays its bearing lies — the cracks nearly straight, a little wavering)
    const d = Math.hypot(c[0] - H[0], c[1] - H[1]), ang = Math.atan2(c[1] - H[1], c[0] - H[0]) + Math.sin(d * 0.012 + wob) * 0.05;
    let best = nRay - 1; for (let k = 0; k < nRay; k++) { const lo = rays[k], hi = rays[(k + 1) % nRay] + (k + 1 === nRay ? Math.PI * 2 : 0); let a = ang; while (a < lo) a += Math.PI * 2; if (a < hi) { best = k; break; } }
    return best;
  };
  // (its cells' keys counted from its first cell: its cells lie half a cell off the round millimetres — rounded alone, neighbours merged)
  const X0 = r.cells[0][0], Z0 = r.cells[0][1], group = new Map(), key = (c) => Math.round((c[0] - X0) / C) + ',' + Math.round((c[1] - Z0) / C);
  const through = rnd() < 0.5 ? Math.floor(rnd() * nRay) : -1;
  for (const c of r.cells) {
    const d = Math.hypot(c[0] - H[0], c[1] - H[1]), k = sector(c), lim = Rc * (reach[k] + 0.12 * Math.sin(Math.atan2(c[1] - H[1], c[0] - H[0]) * 3 + wob));
    if (d <= lim) group.set(key(c), 'w' + k);
    else if (through >= 0) { const ra = rays[through], side = Math.cos(ra) * (c[1] - H[1]) - Math.sin(ra) * (c[0] - H[0]) + Math.sin(d * 0.01 + wob) * 15; group.set(key(c), side > 0 ? 'rA' : 'rB'); }
    else group.set(key(c), 'r');
  }
  // (the pieces: each group's connected parts)
  const byKey = new Map(r.cells.map((c) => [key(c), c])), seen = new Set(), comps = [];
  for (const c of r.cells) {
    const k0 = key(c); if (seen.has(k0)) continue;
    const g = group.get(k0), list = [], st = [c]; seen.add(k0);
    while (st.length) { const q = st.pop(); list.push(q); const [a, b] = key(q).split(',').map(Number); for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const kk = (a + u) + ',' + (b + v), n = byKey.get(kk); if (n && !seen.has(kk) && group.get(kk) === g) { seen.add(kk); st.push(n); } } }
    comps.push({ g, list, rest: g[0] === 'r' });
  }
  // (a wedge still wider than the bucket takes: split again, unevenly)
  const pieces = [];
  // (a wedge wider than the bucket takes: cut into pieces ~2 maxR across — seeds spread over it (each the farthest from the others),
  // each cell to its nearest, the cut wavering; not halved at random — that left slivers)
  const split = (cells, rest, depth = 0) => {
    const mx = cells.reduce((a, c) => a + c[0], 0) / cells.length, mz = cells.reduce((a, c) => a + c[1], 0) / cells.length;
    const rr = Math.max(...cells.map((c) => Math.hypot(c[0] - mx, c[1] - mz))) + C / 2, mR = maxR / S;
    if (rest || rr <= mR * 1.15 || cells.length <= 12 || depth >= 3) { pieces.push({ g: cells, mx, mz, rest }); return; }
    const k = Math.max(2, Math.min(24, Math.round(cells.length * C * C / (Math.PI * mR * mR * 0.8)))), seeds = [cells[Math.floor(rnd() * cells.length)]];
    while (seeds.length < k) { let best = null, bd = -1; for (let q = 0; q < cells.length; q += 3) { const c = cells[q]; let d = Infinity; for (const s0 of seeds) d = Math.min(d, Math.hypot(c[0] - s0[0], c[1] - s0[1])); d *= 0.85 + 0.3 * rnd(); if (d > bd) bd = d, best = c; } seeds.push(best); }
    const grp = seeds.map(() => []);
    for (const c of cells) { let bi = 0, bd = Infinity; for (let n = 0; n < k; n++) { const d = Math.hypot(c[0] - seeds[n][0], c[1] - seeds[n][1]) + Math.sin(c[0] * 0.017 + c[1] * 0.011 + n * 2.3) * 18; if (d < bd) bd = d, bi = n; } grp[bi].push(c); }
    for (const g of grp) if (g.length) split(g, false, depth + 1);
  };
  for (const p of comps) split(p.list, p.rest);
  // (its broken faces: a cell whose neighbour went to another piece)
  const pieceOf = new Map(); pieces.forEach((p, n) => { for (const c of p.g) pieceOf.set(key(c), n); });
  const crack = [];
  // (c[4]: which of its sides are broken — bits 1 −z, 2 +x, 4 +z, 8 −x; its poured sides stay as they were)
  for (const p of pieces) for (const c of p.g) { const [a, b] = key(c).split(',').map(Number), n0 = pieceOf.get(key(c)); let br = c[4] === 1 ? 31 : (c[4] || 0); for (const [u, v, bit] of [[1, 0, 2], [-1, 0, 8], [0, 1, 4], [0, -1, 1]]) { const n = pieceOf.get((a + u) + ',' + (b + v)); if (n != null && n !== n0) { br |= bit | 16; if (n > n0) crack.push(c); } } c[4] = br; }   // (16: the sides' format — a bare 1 is an old record's «broken»)
  // (crumbs: off what came off — 10–15 % of a thin one, 5 % of a thick; specks under 0,01 m² crumble whole)
  const frac = hMean < 50 ? 0.12 : 0.06; let crumbs = 0;
  const cosY = Math.cos(r.yaw || 0), sinY = Math.sin(r.yaw || 0), wx = (dx, dz) => r.x + MM(dx) * cosY + MM(dz) * sinY, wz = (dx, dz) => r.z - MM(dx) * sinY + MM(dz) * cosY;
  O.remove(id);
  const ids = [];
  for (const p of pieces) {
    const vol = p.g.reduce((a, c) => a + c[2] / 1000 * A, 0);
    // (a speck, or a sliver one or two cells wide — it crumbles: such a thin strip of concrete does not hold together)
    const ex = (f) => { let lo = Infinity, hi = -Infinity; for (const c of p.g) { const v = f(c); lo = Math.min(lo, v); hi = Math.max(hi, v); } return (hi - lo) / C + 1; };
    if (p.g.length * A < 0.007 || Math.min(ex((c) => c[0]), ex((c) => c[1]), ex((c) => c[0] + c[1]) / 1.41, ex((c) => c[0] - c[1]) / 1.41) < 2.5) { crumbs += vol; continue; }
    let k = 1; if (!p.rest) { k = 1 - frac; crumbs += vol * frac; }
    const bmin = Math.min(...p.g.map((c) => c[3] || 0));
    // (parted from the blow 5–30 mm — the slab left 0–5; the wedges tilted 3–10° about a level axis)
    const ox = p.mx - H[0], oz = p.mz - H[1], ol = Math.hypot(ox, oz) || 1, gap = rnd() * 3,   /* (borne on from above, a slab on the ground hardly parts sideways: its gaps open from the wedges' tilt — the realist) */ mx = p.mx + ox / ol * gap, mz = p.mz + oz / ol * gap;
    // (a wedge sinks with its point toward the blow — the ground pressed there: a funnel, 2–6°; the realist)
    const tl = p.rest ? 0 : (2 + rnd() * 4) * Math.PI / 180, hx = -ox / ol, hz = -oz / ol, tdx = hx * cosY + hz * sinY, tdz = -hx * sinY + hz * cosY;
    const rec = { type: 'lump', x: +wx(mx, mz).toFixed(6), z: +wz(mx, mz).toFixed(6), y: +((r.y ?? 0) + MM(bmin)).toFixed(6), yaw: r.yaw || 0,
      cells: p.g.map((c) => [Math.round(c[0] - p.mx), Math.round(c[1] - p.mz), Math.max(1, Math.round(c[2] * k)), (c[3] || 0) - bmin, c[4] || 0]), cell: C, at: 'ground' };
    if (tl) rec.tilt = [+(tdz * tl).toFixed(4), +(-tdx * tl).toFixed(4)];   // (about x: +z side down; about z: +x side up — the side toward the blow down)
    ids.push(O.add(rec).id);
  }
  // (the crumbs: half a smear of grit 2–20 mm along the cracks, in the gaps on the ground (grey crushed stone, laid there); half
  // angular bits 5–50 mm, mostly small, concrete-grey, dropping into the gaps and along the edges — they stay; each carries its share)
  const P = app.particles, t = app.terrain, top = (r.y ?? 0), along = crack.length ? crack : r.cells, smear = 0, bits = crumbs;   // (all as grains: a smear on the ground read as paint — the realist)
  if (t) { const nS = Math.max(1, Math.ceil(along.length / 2)); for (let q = 0; q < along.length; q += 2) { const c = along[q], x = wx(c[0], c[1]), z = wz(c[0], c[1]); if (t.inside(x, z)) t.deposit(x, z, smear / MODEL_SCALE ** 3 / nS, MM(50), 0, M_G5); } }
  const n = Math.max(30, Math.min(90, Math.round(bits / 0.0002))), grey = [0.30, 0.29, 0.27];   // (linear: ~170 sRGB — concrete's grey, a little lighter than the slab's weathered top)
  if (P && bits > 0) for (let q = 0; q < n; q++) {
    const c = along[Math.floor(rnd() * along.length)], e = (rnd() - 0.5) * C * 0.6, sz = q < 12 ? 10 + rnd() * 10 : 2.5 + Math.pow(rnd(), 2.2) * 12;   // (a dozen bits 20–40 mm right at the break — seen from 2–3 m; the rest small)
    const pos = new THREE.Vector3(wx(c[0] + e, c[1] - e), top + MM((c[3] || 0) + c[2] * (0.5 + 0.5 * rnd())), wz(c[0] + e, c[1] - e));
    P.emit(pos, new THREE.Vector3((rnd() - 0.5) * MM(300), MM(150 + rnd() * 250), (rnd() - 0.5) * MM(300)), bits / MODEL_SCALE ** 3 / n, MM(sz), 1, 0, M_G5, true, grey);
  } else if (bits > 0 && t) t.deposit(r.x, r.z, bits / MODEL_SCALE ** 3, MM(300), 0, M_G5);
  // (dust: a little, low, a second at most — concrete on damp ground hardly dusts)
  const D = app.machineTool?.puffs; if (D) for (let q = 0; q < 5; q++) { const c = crack[Math.floor(rnd() * Math.max(1, crack.length))] || r.cells[0]; D.emit('chip', new THREE.Vector3(wx(c[0], c[1]), top + MM(c[2] + 60), wz(c[0], c[1])), new THREE.Vector3((rnd() - 0.5) * MM(400), 0, (rnd() - 0.5) * MM(400)), 0.6); }
  const after = ids.reduce((a, i) => a + O.get(i).cells.reduce((b, c) => b + c[2] / 1000 * A, 0), 0);
  breakLump.last = { crumbs, before: vol0, after, pieces: ids.length };
  { const p = at ? new THREE.Vector3(at.x, top, at.z) : new THREE.Vector3(r.x, top, r.z); app.sfx?.play?.('stone', { at: p, vol: 0.8 }); app.sfx?.play?.('metal_hit', { at: p, vol: 0.35 }); app.sfx?.play?.('debris', { at: p, vol: 0.45 }); }   // (the dry crack at the blow, the bits settling)
  return ids;
}

let _mat = null;
// (a fresh break shows its aggregate: broken stones 5–20 mm, darker and warmer than the cement, 25–35 % of it, and the pits of those
// that fell out — drawn in the shader on the broken faces (their vertex colour over 1,1 marks them), not in the mesh: the realist)
const mat = () => {
  if (_mat) return _mat;
  const m = mortarPhoto(new THREE.MeshStandardMaterial({ color: CONCRETE.color, roughness: 0.93, vertexColors: true }), { tile: 1.23, k: 1.0, tint: 0.3 });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        vec2 lhash(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        // (the stones on a break: x — inside one (0…1 to its middle), y — a pit of one that fell out)
        vec2 lStones(vec2 p) { vec2 ip = floor(p), fp = fract(p); float st = 0.0, pit = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)), h = lhash(ip + g), c = g + 0.2 + 0.6 * h - fp;
            float rad = 0.22 + 0.22 * fract(h.x * 7.3), d = length(c * vec2(1.0, 0.8 + 0.4 * h.y)), in_ = 1.0 - smoothstep(rad * 0.85, rad, d);
            if (h.y < 0.62) st = max(st, in_ * (1.0 - d / rad)); else if (h.y > 0.9) pit = max(pit, in_); }
          return vec2(st, pit); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_COLOR
        if (vColor.r > 1.1) { vec2 q = vec2(vMWPos.x + vMWPos.z, vMWPos.y) * ${(MODEL_SCALE / 0.016).toFixed(1)};   // (a cell ~16 mm: stones 5–20 mm)
          vec2 s = lStones(q) + 0.5 * lStones(q * 2.3 + 7.1);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.6, 0.52), clamp(s.x * 3.0, 0.0, 1.0));
          diffuseColor.rgb *= 1.0 - 0.35 * clamp(s.y, 0.0, 1.0); }
        #endif`);
  };
  m.customProgramCacheKey = () => 'lumpBreak';
  return (_mat = m);
};

// the view: each lump a smooth dab — its top the cells' heights over its underside (the imprint), smoothed, its rim thinning out to
// 5–10 mm, its underside and rim soiled; lying in its imprint along the slope, falling, sliding; in a bucket (machineTool's `holds`);
// in the truck's body, sliding out as it tips
export class LumpView {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'lumps'; app.scene.add(this.group);
    this.meshes = new Map(); this.fall = new Map(); this.slide = new Map(); this.shoved = new Set(); this.holds = []; this.dirty = true;
    app.objects.on((id, rec) => { if (!rec || rec.type === 'lump' || this.meshes.has(id)) this.dirty = true; });
  }
  get held() { return this.holds[0] || null; }
  isHeld(id) { return this.holds.some((h) => h.id === id); }
  _geo(r) {
    const C = r.cell || 30, cs = MM(C), key = (a, b) => a + ',' + b, cells = new Map(), X0 = r.cells[0][0], Z0 = r.cells[0][1];   // (keyed from its first cell — see breakLump)
    for (const [dx, dz, h, b, br] of r.cells) cells.set(key(Math.round((dx - X0) / C), Math.round((dz - Z0) / C)), [h, b || 0, br || 0]);
    // (corner vertices: the mean of the cells about them; on the rim, thin)
    const V = new Map();
    for (const k of cells.keys()) { const [a, b] = k.split(',').map(Number); for (const [u, w] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!V.has(key(a + u, b + w))) V.set(key(a + u, b + w), null); }
    for (const k of V.keys()) {
      const [a, b] = k.split(',').map(Number); let hs = 0, bs = 0, n = 0, br = 0;
      for (const [u, w] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const c = cells.get(key(a + u, b + w)); if (c) { hs += c[0]; bs += c[1]; n++; br = Math.max(br, c[2]); } }
      // (its poured rim thins out to a skin; a broken edge stands its full height — a face, not a dab: the realist)
      V.set(k, { h: hs / n, b: bs / n, rim: n < 4, br: false, n });
    }
    // (a vertex on a broken side: full height; the poured rim thins out to a skin)
    for (const [k, c] of cells) { if (!c[2]) continue; const [a, b] = k.split(',').map(Number), cb = c[2] === 1 ? 15 : c[2] & 15;
      for (const [e, [u0, w0, u1, w1]] of [[1, [0, 0, 1, 0]], [2, [1, 0, 1, 1]], [4, [0, 1, 1, 1]], [8, [0, 0, 0, 1]]]) if (cb & e) { V.get(key(a + u0, b + w0)).br = true; V.get(key(a + u1, b + w1)).br = true; } }
    for (const v of V.values()) if (v.rim && !v.br) v.h = Math.max(6, v.h * 0.18);
    // (a broken edge in plan: not the cells' 31 mm stairs — a crack runs nearly straight: its rim corners eased toward their rim
    // neighbours, three passes; the poured rim keeps its own outline)
    for (const v of V.values()) { v.ox = 0; v.oz = 0; }
    const rimN = (k) => { const [a, b] = k.split(',').map(Number), out = []; for (const [u, w] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = V.get(key(a + u, b + w)); if (q && q.rim) out.push([u, w, q]); } return out; };
    for (let p = 0; p < 4; p++) {
      const moves = [];
      for (const [k, v] of V) { if (!v.br) continue; const nb = rimN(k); if (nb.length !== 2) continue; let sx = 0, sz = 0; for (const [u, w, q] of nb) { sx += u + q.ox; sz += w + q.oz; } moves.push([v, 0.5 * v.ox + 0.5 * (sx / nb.length), 0.5 * v.oz + 0.5 * (sz / nb.length)]); }   // (only along an edge: a vertex where more rims meet is a narrow neck — left)
      for (const [v, x, z] of moves) { v.ox = Math.max(-0.7, Math.min(0.7, x)); v.oz = Math.max(-0.7, Math.min(0.7, z)); }
    }
    for (let p = 0; p < 2; p++) {   // (the top smoothed: a poured skin, not steps)
      const nh = new Map();
      for (const [k, v] of V) { if (v.rim) { nh.set(k, v.h); continue; } const [a, b] = k.split(',').map(Number); let s = v.h * 2, n = 2; for (const [u, w] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = V.get(key(a + u, b + w)); if (q && !q.rim) { s += q.h; n++; } } nh.set(k, s / n); }
      for (const [k, h] of nh) V.get(k).h = h;
    }
    const pos = [], col = [], idx = [], ti = new Map(), bi = new Map(), fi = new Map(), flat = [];
    const Pt = (k, top) => { const m = top ? ti : bi; if (m.has(k)) return m.get(k); const [a, b] = k.split(',').map(Number), v = V.get(k), y = MM(v.b) + (top ? MM(v.h) : 0);
      pos.push(MM(X0) + (a - 0.5 + (v.ox || 0)) * cs, y, MM(Z0) + (b - 0.5 + (v.oz || 0)) * cs); const dirt = top ? (v.rim && !v.br ? 0.72 : 1) : 0.55; col.push(dirt, dirt * 0.97, dirt * 0.93); m.set(k, pos.length / 3 - 1); return pos.length / 3 - 1; };
    for (const k of cells.keys()) {
      const [a, b] = k.split(',').map(Number), c = [key(a, b), key(a + 1, b), key(a + 1, b + 1), key(a, b + 1)];
      const t = c.map((q) => Pt(q, true)), u = c.map((q) => Pt(q, false));
      idx.push(t[0], t[2], t[1], t[0], t[3], t[2], u[0], u[1], u[2], u[0], u[2], u[3]);
      const brk = cells.get(key(a, b))[2], bits = brk === 1 ? 15 : brk & 15;   // (an old record: 1 — all its open sides)
      for (const [e, [da, db]] of [[0, [0, -1]], [1, [1, 0]], [2, [0, 1]], [3, [-1, 0]]]) if (!cells.has(key(a + da, b + db))) {
        const i0 = e, i1 = (e + 1) % 4;
        if (!(bits & [1, 2, 4, 8][e])) { idx.push(t[i0], t[i1], u[i1], t[i0], u[i1], u[i0]); continue; }   // (its rim: the top down to the underside)
        // (a broken face: its own vertices — a sharp edge, fresh and lighter than the weathered top (sRGB +20–40), rough ±3 mm across)
        // (its vertices shared along the crack — one smooth face, not a strip a cell — and level-normalled after; fresh: lighter than
        // a poured edge facing the same way by 20–40 sRGB, down to its foot)
        const ck = [c[i0], c[i1], c[i1], c[i0]];
        const q = [t[i0], t[i1], u[i1], u[i0]].map((vi, n) => { const fk = ck[n] + (n < 2 ? 't' : 'b'); if (fi.has(fk)) return fi.get(fk);
          pos.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]); const L = n < 2 ? 1.6 : 1.3; col.push(L, L * 0.98, L * 0.95); const id = pos.length / 3 - 1; fi.set(fk, id); flat.push(id); return id; });
        idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    { const N = g.attributes.normal; for (const i of flat) { const x = N.getX(i), z = N.getZ(i), l = Math.hypot(x, z) || 1; N.setXYZ(i, x / l, 0, z / l); } }   // (a broken face stands upright: its normals level)
    return g;
  }
  // where it rests: its imprint along the plane of the ground under it (≤ 35°), as low as it goes with all of it over the ground
  // → { y (its origin's height), q (its turn), steep (the slope it would need) }
  pose(r, x = r.x, z = r.z) {
    const t = this.app.terrain, cs = Math.cos(r.yaw || 0), sn = Math.sin(r.yaw || 0), step = Math.max(1, Math.floor(r.cells.length / 48)), P = [];
    for (let k = 0; k < r.cells.length; k += step) { const [dx, dz, , b] = r.cells[k], X = MM(dx) * cs + MM(dz) * sn, Z = -MM(dx) * sn + MM(dz) * cs; if (t.inside(x + X, z + Z)) P.push([X, Z, t.heightAt(x + X, z + Z) - MM(b || 0)]); }
    if (!P.length) return { y: r.y ?? 0, q: new THREE.Quaternion().setFromAxisAngle(UP, r.yaw || 0), steep: 0 };
    // (the plane by least squares, its slope held to 35°)
    let sx = 0, sz = 0, sv = 0, sxx = 0, szz = 0, sxz = 0, sxv = 0, szv = 0; const n = P.length;
    for (const [X, Z, v] of P) { sx += X; sz += Z; sv += v; sxx += X * X; szz += Z * Z; sxz += X * Z; sxv += X * v; szv += Z * v; }
    const mx = sx / n, mz = sz / n, mv = sv / n, cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxv = sxv / n - mx * mv, czv = szv / n - mz * mv, det = cxx * czz - cxz * cxz;
    let a = det > 1e-12 ? (cxv * czz - czv * cxz) / det : 0, c = det > 1e-12 ? (czv * cxx - cxv * cxz) / det : 0;
    const gr = Math.hypot(a, c), steep = Math.atan(gr); if (gr > TAN) { a *= TAN / gr; c *= TAN / gr; }
    let y = -Infinity; for (const [X, Z, v] of P) y = Math.max(y, v - a * X - c * Z);
    const nrm = new THREE.Vector3(-a, 1, -c).normalize(), q = new THREE.Quaternion().setFromUnitVectors(UP, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(UP, r.yaw || 0));
    // (a wedge broken off: tilted 3–10° in its bed, one edge up — its low edge pressed into the ground, not floating)
    if (r.tilt) { const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tilt[0], 0, r.tilt[1])); q.premultiply(tq); y += Math.sin(Math.hypot(r.tilt[0], r.tilt[1])) * lumpSize(r).r * 0.8 - MM(5); }   // (its point ≤ ~10 mm into the ground, its outer edge up)
    return { y, q, steep };
  }
  update(dt = 1 / 60) {
    const O = this.app.objects, seen = new Set(), T = this.app.machineTool?.truck, t = this.app.terrain;
    for (const r of O.all('lump')) {
      seen.add(r.id);
      let m = this.meshes.get(r.id);
      if (!m) { m = new THREE.Mesh(this._geo(r), mat()); m.castShadow = m.receiveShadow = true; m.userData.lumpId = r.id; this.group.add(m); this.meshes.set(r.id, m); }
      if (this.isHeld(r.id)) continue;   // (in a bucket: machineTool moves it)
      if (r.at === 'truck' && T?.bed && T.root.visible) {
        // (in the body; tipped, it slides with the load to the tailgate — the one nearest it first — and off it, flying 0,5–1,5 m)
        if (T.tip > 0.35) {
          const v = MM(800) * Math.min(1, (T.tip - 0.35) / 0.3) * (0.8 + ((r.id * 7919) % 100) / 250);
          r.tx = +(r.tx - v * dt).toFixed(6);
          if (r.tx < T.x0 + MM(150)) {
            const p = T.bed.localToWorld(new THREE.Vector3(r.tx, r.ty, r.tz)), fx = Math.cos(T.yaw), fz = -Math.sin(T.yaw), sp = MM(1000 + ((r.id * 104729) % 1000));
            O.update(r.id, { at: 'ground', x: +p.x.toFixed(6), z: +p.z.toFixed(6) }); this.fall.set(r.id, { y: p.y, v: 0, vx: -fx * sp, vz: -fz * sp });
            if (T.load > 0) T.load = Math.max(0, T.load - lumpSize(r).vol / MODEL_SCALE ** 3 / (T.cap || 1));
            m.position.copy(p); m.userData.placed = true; continue;
          }
        }
        const p = T.bed.localToWorld(new THREE.Vector3(r.tx, r.ty, r.tz)); m.position.copy(p); m.quaternion.copy(T.root.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(UP, r.yaw || 0)); continue;
      }
      // (on the ground: in its imprint along the slope — at g down to it when it is higher. Never up of itself: what is heaped by or
      // over it buries it — the owner: covered, it is not seen; its height kept in its record so a saved game keeps it so)
      const sz = lumpSize(r);
      let P = this.pose(r), F = this.fall.get(r.id);
      let y = F ? F.y : m.userData.placed ? m.position.y : Math.min(r.y ?? P.y, P.y);
      if (!F && !m.userData.placed && r.y != null && r.y > P.y + MM(5)) { this.fall.set(r.id, { y: r.y, v: 0 }); y = r.y; F = this.fall.get(r.id); }
      const onTop = !F && y >= P.y - MM(10);
      if (onTop && m.userData.placed) {
        if (P.y > y && this.shoved.has(r.id)) y = P.y;   // (shoved onto higher ground: on it)
        // (steeper under it than it holds on — over a pit's edge, a heap's side past ~35°: it slides down, faster and faster; below its
        // friction angle it slows down and stops, at 30° at the latest)
        const e = Math.max(sz.r, MM(150)), gx = (t.heightAt(r.x + e, r.z) - t.heightAt(r.x - e, r.z)) / (2 * e), gz = (t.heightAt(r.x, r.z + e) - t.heightAt(r.x, r.z - e)) / (2 * e);
        const sl = Math.hypot(gx, gz), ang = Math.max(Math.atan(sl), P.steep > 0.61 ? Math.min(P.steep, 1.2) : 0), S0 = this.slide.get(r.id);
        const a0 = G * (Math.sin(ang) - 0.62 * Math.cos(ang)), v0 = S0 ? Math.max(0, S0.v + a0 * dt) : 0;
        if (sl > 1e-6 && (S0 ? v0 > 0 && ang > 0.52 : ang > 0.61)) {
          const v = S0 ? v0 : Math.max(0, a0 * dt), dx = -gx / sl, dz = -gz / sl, nx = r.x + dx * v * dt * Math.cos(ang), nz = r.z + dz * v * dt * Math.cos(ang);
          if (t.inside(nx, nz)) { r.x = +nx.toFixed(6); r.z = +nz.toFixed(6); P = this.pose(r); if (y - P.y < MM(30)) y = P.y; }
          this.slide.set(r.id, { v });
        } else if (S0) { this.slide.delete(r.id); this.app.sfx?.play?.('stone', { at: m.position, vol: 0.3 }); }
      } else this.slide.delete(r.id);
      if (y > P.y + MM(5)) {
        const F1 = this.fall.get(r.id) || { v: 0 }, v = F1.v + G * dt; y = Math.max(P.y, y - v * dt);
        if (F1.vx) { r.x = +(r.x + F1.vx * dt).toFixed(6); r.z = +(r.z + F1.vz * dt).toFixed(6); P = this.pose(r); }
        if (y > P.y) this.fall.set(r.id, { ...F1, y, v }); else { this.fall.delete(r.id); if (v > G * 0.15) this.app.sfx?.play?.('stone', { at: m.position, vol: 0.4 }); }
      } else this.fall.delete(r.id);
      if (!this.fall.has(r.id) && Math.abs((r.y ?? -1e9) - y) > MM(5)) r.y = +y.toFixed(6);   // (kept quietly: not a change of its own)
      m.position.set(r.x, y, r.z);
      if (y >= P.y - MM(10)) m.quaternion.slerp(P.q, m.userData.placed ? Math.min(1, dt * 8) : 1);   // (lying: along what is under it; buried: as it was)
      m.userData.placed = true;
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); m.geometry.dispose(); this.meshes.delete(id); this.fall.delete(id); }
    this.holds = this.holds.filter((h) => O.get(h.id));
    this.shoved.clear();
  }
  // how deep a point (world) is in a lump lying on the ground — one big enough to bear on (≥ 0,2 m²), not held; the bucket is held by it
  // like by firm ground (the realist: the teeth bear on it, the machine's front comes up, then it cracks). The lowest 35 % of its
  // thickness is not counted: teeth there are under its edge, lifting it, not bearing on it. → { d, id, at } (d model units)
  solidDepth(P, skip) {
    let best = { d: 0, id: null, at: null };
    for (const r of this.app.objects.all('lump')) {
      if (r.at !== 'ground' || this.isHeld(r.id) || skip?.(r)) continue;
      const m = this.meshes.get(r.id); if (!m || !m.userData.placed) continue;
      let ud = m.userData; if (!ud.cm || ud.cmFor !== r.cells) { const C = r.cell || 30, X0 = r.cells[0][0], Z0 = r.cells[0][1]; ud.cm = new Map(r.cells.map((c) => [Math.round((c[0] - X0) / C) + ',' + Math.round((c[1] - Z0) / C), c])); ud.cmFor = r.cells; ud.sz = lumpSize(r); ud.o = [X0, Z0]; }
      if (ud.sz.area < 0.03) continue;   // (a broken-off wedge too: the bucket comes down onto it, not through it)
      const cx = m.position.x, cz = m.position.z, R0 = ud.sz.r + MM(100); let inv = null;
      for (const q of P) {
        if (Math.abs(q.x - cx) > R0 || Math.abs(q.z - cz) > R0) continue;
        if (!inv) { m.updateMatrixWorld(true); inv = new THREE.Matrix4().copy(m.matrixWorld).invert(); }
        const l = q.clone().applyMatrix4(inv), C = r.cell || 30, c = ud.cm.get(Math.round((l.x - MM(ud.o[0])) / MM(C)) + ',' + Math.round((l.z - MM(ud.o[1])) / MM(C))); if (!c) continue;
        const b = MM(c[3] || 0), h = MM(c[2]), d = b + h - l.y;
        if (l.y > b + h * 0.35 && d > 0 && d > best.d) best = { d: Math.min(d, MM(300)), id: r.id, at: q.clone() };
      }
    }
    return best;
  }
  // lifted off the ground: where it lay stays marked — the ground pressed 0–5 mm, ragged, and a grey film of the cement that went
  // into it (a 2 mm grit film — its volume taken off the lump itself: nothing out of nothing) — a stain and a dent, not a layer (the realist)
  stain(r) {
    const t = this.app.terrain, m = this.meshes.get(r.id); if (!t || !m) return;
    const cs = Math.cos(r.yaw || 0), sn = Math.sin(r.yaw || 0), C = r.cell || 30, step = Math.max(1, Math.round(90 / C)), touched = [];
    let film = 0;
    for (let k = 0; k < r.cells.length; k += step) {
      const [dx, dz] = r.cells[k], X = MM(dx) * cs + MM(dz) * sn, Z = -MM(dx) * sn + MM(dz) * cs, x = m.position.x + X, z = m.position.z + Z; if (!t.inside(x, z)) continue;
      const i = t.index(x, z), dent = MM(4.5 + 1.5 * Math.sin(x * 731 + z * 977)); if (t.conc[i] <= 1e-6) { t.nat[i] -= dent; touched.push(i); }
      const v = MM(C) * MM(C) * step * MM(1.5); t.deposit(x, z, v, MM(50), 0, M_G5); film += v;
    }
    if (touched.length) { let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1; for (const i of touched) { const ix = i % t.nx, iz = (i / t.nx) | 0; x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); z0 = Math.min(z0, iz); z1 = Math.max(z1, iz); } t._touch(Math.max(0, x0 - 1), Math.max(0, z0 - 1), Math.min(t.rx, x1 + 1), Math.min(t.rz, z1 + 1)); }
    const vol = lumpSize(r).vol / MODEL_SCALE ** 3; if (vol > 0 && film > 0) { const k = Math.max(0.5, 1 - film / vol); this.app.objects.update(r.id, { cells: r.cells.map((c) => [c[0], c[1], Math.max(1, Math.round(c[2] * k)), ...c.slice(3)]) }); }
    return film * MODEL_SCALE ** 3;
  }
  // let go at the mesh's present place (world): it falls from there
  drop(id, vx = 0, vz = 0) { const m = this.meshes.get(id); if (m) this.fall.set(id, { y: m.position.y, v: 0, vx, vz }); }
}
