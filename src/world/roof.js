import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { plan, toWorld, toFrame, snapS } from '../tools/belt.js';
import { boxOf } from '../tools/freeBrick.js';
import { mats as winMats } from './windows.js';

// A flat roof (плоская кровля) on a floor slab, laid piece by piece as on site:
//   vap  – the vapour barrier: rolls 1,5 m wide rolled out by hand, 100 mm overlaps,
//   xps  – the insulation: XPS boards 1200 × 600 × 150, staggered, cut at the parapet,
//   wedge– the tapered boards 1000 × 1000: the slope, 2 % to the drain,
//   mem  – the PVC membrane: rolls 2,05 m, 80 mm overlaps welded; once the field is closed
//          it is turned up the parapet 300 mm and the drain goes in,
//   cop  – the coping on the parapet: 2 m pieces, cut at the ends,
//   grav – the ballast: gravel spread by hand.
// Each layer goes only where the one under it is. The roof's plan: the slab's cells not
// under the parapet (the masonry laid on the slab).
//   roof { slab, mem (colour), cop (colour), vap: [[s0,t0,s1,t1]…], xps: […], wedge: […],
//          memS: […], copS: [[x0,z0,x1,z1,y,w]…], grav: [cell…], drain: [s,t] }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const ROOF = { vap: 1, xps: 150, minWedge: 20, slope: 0.02, mem: 2, upstand: 300, gravel: 50, vapW: 1500, vapLap: 100, memW: 2050, memLap: 80, xpsL: 1200, xpsW: 600, wedgeL: 1000, copL: 2000 };
export const ROOF_LAYERS = [
  ['vap', 'Пароизоляция'], ['xps', 'Утеплитель XPS'], ['wedge', 'Клин 2 %'], ['mem', 'Мембрана'], ['cop', 'Отлив'], ['grav', 'Гравий'],
];
export const MEM_COLOURS = { grey: ['Светло-серая', '#a1a4a6'], graphite: ['Графит', '#3d4044'], white: ['Белая', '#e8e9e5'] };
export const COP_COLOURS = {
  zinc: ['Оцинковка', 0xb9bdc1, 0.9], ral7016: ['Антрацит', 0x383e42, 0.45], ral7024: ['Графит', 0x474a50, 0.45], ral9003: ['Белый', 0xeceeea, 0.3],
  ral8017: ['Шоколад', 0x45322e, 0.45], ral9005: ['Чёрный', 0x101113, 0.45], copper: ['Медь', 0xb87345, 0.95],
};

// ---- textures: drawn on a canvas, a normal map from the same height --------------------------
const TEX = {};
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export function canvas(n, m = n) { const cv = document.createElement('canvas'); cv.width = n; cv.height = m; return cv; }
export function asTex(cv, srgb = true) { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
// a normal map from a height canvas (its red channel)
export function normalOf(hc, k = 2) {
  const n = hc.width, m = hc.height, src = hc.getContext('2d').getImageData(0, 0, n, m).data, out = canvas(n, m), g = out.getContext('2d'), img = g.createImageData(n, m);
  const h = (x, y) => src[(((y + m) % m) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * k, dy = (h(x, y + 1) - h(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return asTex(out, false);
}
function noise(g, n, m, count, size, col) { for (let i = 0; i < count; i++) { g.fillStyle = col(); const r = size * (0.5 + rnd()); g.fillRect(rnd() * n, rnd() * m, r, r); } }

// the vapour barrier: a grey film with wrinkles and the maker's print (1,5 m × 1,5 m)
function vapTex() {
  if (TEX.vap) return TEX.vap;
  const n = 512, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  g.fillStyle = '#b8bec4'; g.fillRect(0, 0, n, n);
  h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  for (let i = 0; i < 70; i++) {   // wrinkles
    const x = rnd() * n, y = rnd() * n, a = rnd() * 3.14, l = 30 + rnd() * 120, w = 2 + rnd() * 6;
    h.save(); h.translate(x, y); h.rotate(a); const gr = h.createLinearGradient(0, -w, 0, w); gr.addColorStop(0, '#808080'); gr.addColorStop(0.5, rnd() < 0.5 ? '#b0b0b0' : '#555'); gr.addColorStop(1, '#808080'); h.fillStyle = gr; h.fillRect(-l / 2, -w, l, 2 * w); h.restore();
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(-l / 2, -1, l, 2); g.restore();
  }
  g.fillStyle = 'rgba(40,70,120,0.45)'; g.font = 'bold 18px sans-serif';
  for (let y = 40; y < n; y += 128) for (let x = (y / 128) % 2 ? 0 : 120; x < n; x += 260) g.fillText('ПАРОИЗОЛЯЦИЯ · В', x, y);
  return (TEX.vap = { map: asTex(c), normalMap: normalOf(hc, 3) });
}
// an XPS board 1200 × 600: orange, the fine cells, the stamp, the edges (a shiplap)
function xpsTex() {
  if (TEX.xps) return TEX.xps;
  const n = 512, m = 256, c = canvas(n, m), g = c.getContext('2d'), hc = canvas(n, m), h = hc.getContext('2d');
  g.fillStyle = '#e98a3c'; g.fillRect(0, 0, n, m);
  h.fillStyle = '#909090'; h.fillRect(0, 0, n, m);
  noise(g, n, m, 9000, 1.6, () => `rgba(${rnd() < 0.5 ? '255,210,160' : '160,75,20'},${0.08 + rnd() * 0.1})`);
  noise(h, n, m, 9000, 1.6, () => (rnd() < 0.5 ? '#9a9a9a' : '#858585'));
  // the skin of the board: faint lines along it
  for (let y = 0; y < m; y += 3) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`; g.fillRect(0, y, n, 1); }
  // the stamp
  g.fillStyle = 'rgba(70,40,120,0.55)'; g.font = 'bold 22px sans-serif'; g.fillText('XPS 300 · 150 мм', 30, 60); g.font = '14px sans-serif'; g.fillText('ТЕХНОПЛЕКС ЭКСТРУЗИЯ', 30, 82);
  // the edges: a darker band and a dip in the height (the step of the shiplap)
  g.fillStyle = 'rgba(110,50,10,0.45)'; for (const [x, y, w, hh] of [[0, 0, n, 6], [0, m - 6, n, 6], [0, 0, 6, m], [n - 6, 0, 6, m]]) g.fillRect(x, y, w, hh);
  h.fillStyle = '#404040'; for (const [x, y, w, hh] of [[0, 0, n, 4], [0, m - 4, n, 4], [0, 0, 4, m], [n - 4, 0, 4, m]]) h.fillRect(x, y, w, hh);
  return (TEX.xps = { map: asTex(c), normalMap: normalOf(hc, 2) });
}
// a tapered board 1000 × 1000: light grey beads of EPS, the arrow of its fall
function wedgeTex() {
  if (TEX.wedge) return TEX.wedge;
  const n = 384, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  g.fillStyle = '#dcdcd6'; g.fillRect(0, 0, n, n); h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  for (let i = 0; i < 2600; i++) { const x = rnd() * n, y = rnd() * n, r = 3 + rnd() * 3; g.strokeStyle = `rgba(150,150,140,${0.25 + rnd() * 0.25})`; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.stroke(); h.fillStyle = '#9a9a9a'; h.beginPath(); h.arc(x, y, r * 0.8, 0, 6.3); h.fill(); }
  g.strokeStyle = 'rgba(60,60,60,0.6)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, n - 3, n - 3);
  g.fillStyle = 'rgba(200,40,40,0.65)'; g.font = 'bold 20px sans-serif'; g.fillText('i = 2 %', n / 2 - 36, n / 2 - 30);
  g.strokeStyle = 'rgba(200,40,40,0.65)'; g.lineWidth = 4; g.beginPath(); g.moveTo(n / 2 - 60, n / 2); g.lineTo(n / 2 + 60, n / 2); g.lineTo(n / 2 + 40, n / 2 - 14); g.moveTo(n / 2 + 60, n / 2); g.lineTo(n / 2 + 40, n / 2 + 14); g.stroke();
  return (TEX.wedge = { map: asTex(c), normalMap: normalOf(hc, 2) });
}
// the membrane: a fine embossed surface (one metre)
function memTex(col) {
  const key = 'mem' + col;
  if (TEX[key]) return TEX[key];
  const n = 256, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  g.fillStyle = col; g.fillRect(0, 0, n, n); h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  noise(g, n, n, 5000, 1.4, () => `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.03})`);
  for (let y = 0; y < n; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < n; x += 4) { h.fillStyle = '#8c8c8c'; h.fillRect(x, y, 2, 2); }
  return (TEX[key] = { map: asTex(c), normalMap: normalOf(hc, 1.2) });
}
// brushed metal for the coping
function metalNormal() {
  if (TEX.metal) return TEX.metal;
  const n = 256, hc = canvas(n), h = hc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  for (let y = 0; y < n; y++) { h.fillStyle = `rgb(${120 + rnd() * 20 | 0},0,0)`; h.fillRect(0, y, n, 1); }
  return (TEX.metal = normalOf(hc, 0.6));
}
let GRAVEL = null;
function gravelTex() {
  if (GRAVEL) return GRAVEL;
  const L = new THREE.TextureLoader(), set = (t, srgb) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  GRAVEL = { map: set(L.load('assets/textures/gravel_floor_02/diff.jpg'), true), normalMap: set(L.load('assets/textures/gravel_floor_02/nor_gl.jpg'), false) };
  return GRAVEL;
}

// ---- the roof's plan -----------------------------------------------------------------------
// the units standing on the slab (the parapet)
export function onSlab(units, b) {
  const top0 = b.top + b.H;
  return units.filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf).filter((x) => x.bot > top0 - MM(5) && x.bot < top0 + MM(60));
}
// { on(i,j), cells, bbox [i0,j0,i1,j1] (cells), blocked } of a slab with what stands on it
export function roofArea(b, units) {
  const P = plan(b), { ni, nj, c } = b, par = onSlab(units, b), blocked = new Uint8Array(ni * nj);
  for (const u of par) {
    const n = Math.ceil(Math.max(u.hl, u.hw) / c) + 1, [s0, t0] = toFrame(b, u.x, u.z), ci = Math.floor(s0 / c), cj = Math.floor(t0 / c);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= ni || j >= nj) continue;
      const [x, z] = toWorld(b, (i + 0.5) * c, (j + 0.5) * c), dx = x - u.x, dz = z - u.z;
      if (Math.abs(dx * u.ux + dz * u.uz) < u.hl + c * 0.3 && Math.abs(-dx * u.uz + dz * u.ux) < u.hw + c * 0.3) blocked[j * ni + i] = 1;
    }
  }
  const on = (i, j) => i >= 0 && j >= 0 && i < ni && j < nj && !!P.mask[j * ni + i] && !blocked[j * ni + i];
  let i0 = ni, j0 = nj, i1 = -1, j1 = -1, n = 0;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (on(i, j)) { n++; i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i + 1); j1 = Math.max(j1, j + 1); }
  return { on, n, bbox: [i0, j0, i1, j1], blocked, par };
}
// the cells a rectangle in the frame covers (their centres in it)
export function cellsOf(b, [s0, t0, s1, t1]) {
  const c = b.c, out = [];
  for (let j = Math.max(0, Math.floor(t0 / c)); j < Math.min(b.nj, Math.ceil(t1 / c)); j++) for (let i = Math.max(0, Math.floor(s0 / c)); i < Math.min(b.ni, Math.ceil(s1 / c)); i++) {
    const cs = (i + 0.5) * c, ct = (j + 0.5) * c;
    if (cs > s0 && cs < s1 && ct > t0 && ct < t1) out.push([i, j]);
  }
  return out;
}
// how a layer covers the roof: a mask of cells
export function coverage(b, rects) {
  const m = new Uint8Array(b.ni * b.nj);
  for (const r of rects || []) for (const [i, j] of cellsOf(b, r)) m[j * b.ni + i] = 1;
  return m;
}
export function done(b, area, rects) {
  const m = coverage(b, rects); let left = 0;
  for (let j = 0; j < b.nj; j++) for (let i = 0; i < b.ni; i++) if (area.on(i, j) && !m[j * b.ni + i]) left++;
  return { left, of: area.n, full: area.n > 0 && left <= area.n * 0.005 };
}
// the drain: the middle of the roof (the cell nearest its centroid) — set with the first wedge
export function drainOf(b, area) {
  let si = 0, sj = 0, n = 0;
  for (let j = 0; j < b.nj; j++) for (let i = 0; i < b.ni; i++) if (area.on(i, j)) { si += i; sj += j; n++; }
  let di = Math.round(si / n), dj = Math.round(sj / n), bd = Infinity;
  if (!area.on(di, dj)) for (let j = 0; j < b.nj; j++) for (let i = 0; i < b.ni; i++) if (area.on(i, j)) { const d = Math.hypot(i - si / n, j - sj / n); if (d < bd) { bd = d; di = i; dj = j; } }
  return [(di + 0.5) * b.c, (dj + 0.5) * b.c];
}
// the thickness of the tapered layer at (s, t) of the frame (mm)
export const wedgeAt = (r, s, t) => ROOF.minWedge + ROOF.slope * Math.max(Math.abs(s - r.drain[0]), Math.abs(t - r.drain[1])) / S;

// an older roof (BUILD 88: stage / look): its layers as whole sheets
export function upgrade(r, b, area) {
  if (!r.stage || r.vap) return r;
  const [i0, j0, i1, j1] = area.bbox, c = b.c, all = [[i0 * c, j0 * c, i1 * c, j1 * c]];
  const look = { grey: 'grey', graphite: 'graphite', white: 'white', gravel: 'graphite' }[r.look] || 'grey';
  return { ...r, mem: look, cop: r.look === 'grey' ? 'zinc' : r.look === 'white' ? 'ral9003' : 'ral7016', vap: r.stage >= 1 ? all : [], xps: r.stage >= 2 ? all : [], wedge: r.stage >= 3 ? all : [], memS: r.stage >= 4 ? all : [], copS: r.stage >= 5 ? 'all' : [], grav: r.look === 'gravel' && r.stage >= 5 ? 'all' : [], drain: drainOf(b, area) };
}

// ---- the mesh -------------------------------------------------------------------------------
// live: a piece being laid { layer, rect } (drawn as if laid)
export function buildRoof(b, units, rec, live) {
  const area = roofArea(b, units);
  if (!area.n) return null;
  const r = upgrade(rec, b, area), top0 = b.top + b.H, c = b.c;
  if (!r.drain) r.drain = drainOf(b, area);
  const L = (k, rk = k) => [...(Array.isArray(r[rk]) ? r[rk] : []), ...(live && live.layer === k && live.rect ? [live.rect] : [])];
  const group = new THREE.Group();
  const W = (s, t, hmm) => { const [x, z] = toWorld(b, ...snapS(b, s, t)); return [x, top0 + MM(hmm), z]; };
  // a rectangle of the frame clipped cell by cell to the roof: quads at height h(s, t)
  const sheet = (rects, hOf, uvOf, lift) => {
    const pos = [], uv = [];
    rects.forEach((rc, k) => {
      for (const [i, j] of cellsOf(b, [rc[0] - c, rc[1] - c, rc[2] + c, rc[3] + c])) {
        if (!area.on(i, j)) continue;
        const a0 = Math.max(rc[0], i * c), a1 = Math.min(rc[2], (i + 1) * c), b0 = Math.max(rc[1], j * c), b1 = Math.min(rc[3], (j + 1) * c);
        if (a1 - a0 < 1e-7 || b1 - b0 < 1e-7) continue;
        const q = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([s, t]) => [...W(s, t, hOf(s, t) + lift * k), ...uvOf(s, t, rc)]);
        for (const id of [0, 3, 1, 1, 3, 2]) { pos.push(q[id][0], q[id][1], q[id][2]); uv.push(q[id][3], q[id][4]); }
      }
    });
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  const isHole = (i, j) => (b.holes || []).some(([a0, b0, a1, b1]) => i >= a0 && i < a1 && j >= b0 && j < b1);
  const add = (geo, mat, shadow = true) => { if (!geo) return; const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; group.add(m); };
  const mmS = (v) => v / S / 1000;   // model → metres (for texture coordinates)
  // the vapour barrier: the strips, each a hair above the last (they overlap)
  const vap = L('vap');
  if (vap.length) { const t = vapTex(); add(sheet(vap, () => 0.5, (s, t2) => [mmS(s) / 1.5, mmS(t2) / 1.5], 0.25), new THREE.MeshStandardMaterial({ ...t, roughness: 0.4, metalness: 0.15, side: THREE.DoubleSide }), false); }
  // the boards (XPS, the wedges): boxes, cut to the roof; the top textured per board
  const boards = (rects, base, hTop, tex, size, sheetTop = false) => {
    const parts = [];
    // (a tapered top follows the fall cell by cell: the membrane on it lies on it exactly)
    if (sheetTop) { const g = sheet(rects, hTop, (s, t, rc) => [mmS(s - (rc[4] ?? rc[0])) / size[0], mmS(t - (rc[5] ?? rc[1])) / size[1]], 0); if (g) parts.push(g); }
    for (const rc of rects) {
      const corner = (s, t) => hTop(s, t);
      const [s0, t0, s1, t1] = rc, cs = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];
      const top = cs.map(([s, t]) => W(s, t, corner(s, t))), bot = cs.map(([s, t]) => W(s, t, base));
      const pos = [], uv = [];
      const ux = ([s, t]) => [mmS(s - (rc[4] ?? s0)) / size[0], mmS(t - (rc[5] ?? t0)) / size[1]];
      // the top
      if (!sheetTop) for (const id of [0, 3, 1, 1, 3, 2]) { pos.push(...top[id]); uv.push(...ux(cs[id])); }
      // the sides (the cut face of a cut board shows the foam)
      for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; for (const [p, u] of [[bot[k], [0, 0]], [bot[k2], [1, 0]], [top[k2], [1, 0.12]], [bot[k], [0, 0]], [top[k2], [1, 0.12]], [top[k], [0, 0.12]]]) { pos.push(...p); uv.push(...u); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
      parts.push(g);
    }
    if (parts.length) add(mergeGeometries(parts, false), new THREE.MeshStandardMaterial({ ...tex, roughness: 0.75, side: THREE.DoubleSide }));
  };
  const xps = L('xps');
  if (xps.length) boards(xps, ROOF.vap, () => ROOF.vap + ROOF.xps, xpsTex(), [ROOF.xpsL / 1000, ROOF.xpsW / 1000]);
  const wedge = L('wedge'), base = ROOF.vap + ROOF.xps;
  if (wedge.length) boards(wedge, base, (s, t) => base + wedgeAt(r, s, t), wedgeTex(), [1, 1], true);
  // the membrane: strips over the wedges, the welds along their overlaps
  const memS = L('mem', 'memS'), memDone = done(b, area, r.memS).full, mc = MEM_COLOURS[r.mem] || MEM_COLOURS.grey;
  const top = (s, t) => base + wedgeAt(r, s, t);
  if (memS.length) {
    const t = memTex(mc[1]);
    add(sheet(memS, (s, t2) => top(s, t2) + ROOF.mem, (s, t2) => [mmS(s), mmS(t2)], 0.4), new THREE.MeshStandardMaterial({ ...t, roughness: 0.5, side: THREE.DoubleSide }));
    // the welds: a bead along the edge of each strip that lies on another
    const weld = [], wm = new THREE.MeshStandardMaterial({ color: new THREE.Color(mc[1]).multiplyScalar(0.8), roughness: 0.4 });
    memS.forEach((rc, k) => {
      const alongS = rc[2] - rc[0] > rc[3] - rc[1];
      for (const e of alongS ? [rc[1], rc[3]] : [rc[0], rc[2]]) {
        const over = memS.some((o, q) => q < k && (alongS ? e > o[1] && e < o[3] : e > o[0] && e < o[2]));
        if (!over) continue;
        const n = Math.ceil((alongS ? rc[2] - rc[0] : rc[3] - rc[1]) / c);
        for (let q = 0; q < n; q++) {
          const a = (alongS ? rc[0] : rc[1]) + (q + 0.5) * c, [s, t2] = alongS ? [a, e] : [e, a], [ii, jj] = [Math.floor(s / c), Math.floor(t2 / c)];
          if (!area.on(ii, jj)) continue;
          const p = W(s, t2, top(s, t2) + ROOF.mem + 0.4 * k + 1.5), geo = new THREE.BoxGeometry(alongS ? c : MM(12), MM(3), alongS ? MM(12) : c);
          geo.rotateY(Math.atan2(-b.u[1], b.u[0])); geo.translate(...p); geo.deleteAttribute('uv'); weld.push(geo.toNonIndexed());
        }
      }
    });
    if (weld.length) add(mergeGeometries(weld, false), wm, false);
  }
  // the field closed: turned up the parapet, the drain
  if (memDone) {
    const pos = [], { ni, nj } = b;
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      if (!area.on(i, j)) continue;
      for (const [q, e0, e1] of [[[i + 1, j], [i + 1, j], [i + 1, j + 1]], [[i - 1, j], [i, j + 1], [i, j]], [[i, j + 1], [i + 1, j + 1], [i, j + 1]], [[i, j - 1], [i, j], [i + 1, j]]]) {
        if (area.on(...q) || isHole(...q)) continue;   // (at an opening: its curb, below)
        const up = area.blocked[q[1] * ni + q[0]] ? ROOF.upstand : 0;
        const [s0, t0] = [e0[0] * c, e0[1] * c], [s1, t1] = [e1[0] * c, e1[1] * c];
        const h0 = top(s0, t0) + ROOF.mem, h1 = top(s1, t1) + ROOF.mem;
        const A = W(s0, t0, Math.max(h0, up)), B = W(s1, t1, Math.max(h1, up)), C = W(s0, t0, 0), D = W(s1, t1, 0);
        pos.push(...A, ...C, ...B, ...B, ...C, ...D);
      }
    }
    if (pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); add(g, new THREE.MeshStandardMaterial({ color: mc[1], roughness: 0.5, side: THREE.DoubleSide })); }
    // an opening in the slab (the stair well): a curb round it 300 mm over the roof, the
    // membrane turned up it and over its top, the coping on it, a skylight on the curb
    // (aluminium frame, double glazing) — as a roof hatch / lantern over a stair
    const yaw = Math.atan2(-b.u[1], b.u[0]), cw = MM(120), memMat = new THREE.MeshStandardMaterial({ ...memTex(mc[1]), roughness: 0.5 });
    const cc = COP_COLOURS[r.cop] || COP_COLOURS.zinc, copMat = new THREE.MeshStandardMaterial({ color: cc[1], roughness: 0.32, metalness: cc[2], normalMap: metalNormal() });
    const alu = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.4, metalness: 0.6 });
    const bx = (s0, t0, s1, t1, y0, y1, mat, list) => {
      const [x, z] = toWorld(b, (s0 + s1) / 2, (t0 + t1) / 2), g = new THREE.BoxGeometry(s1 - s0, y1 - y0, t1 - t0);
      g.rotateY(yaw); g.translate(x, (y0 + y1) / 2, z); g.deleteAttribute('uv'); (list || []).push(g.toNonIndexed()); return g;
    };
    for (const [a0, b0, a1, b1] of b.holes || []) {
      const S0 = a0 * c, T0 = b0 * c, S1 = a1 * c, T1 = b1 * c;
      const hTop = Math.max(...[[S0, T0], [S1, T0], [S1, T1], [S0, T1]].map(([s2, t2]) => top(s2 - cw, t2 - cw))) + ROOF.mem;
      const y0 = top0, yC = top0 + MM(hTop + ROOF.upstand), curb = [], cap = [], frame = [], glass = [];
      // the curb (four sides, on the roof round the opening), the membrane over it
      for (const [p0, q0, p1, q1] of [[S0 - cw, T0 - cw, S1 + cw, T0], [S0 - cw, T1, S1 + cw, T1 + cw], [S0 - cw, T0, S0, T1], [S1, T0, S1 + cw, T1]]) {
        bx(p0, q0, p1, q1, y0, yC, null, curb);
        bx(p0 - MM(25), q0 - MM(25), p1 + MM(25), q1 + MM(25), yC, yC + MM(3), null, cap);
      }
      // the skylight: its frame on the curb, the glass a little higher in the middle (it sheds water)
      const fy = yC + MM(3), fh = MM(70);
      for (const [p0, q0, p1, q1] of [[S0 - cw, T0 - cw, S1 + cw, T0 - cw + MM(60)], [S0 - cw, T1 + cw - MM(60), S1 + cw, T1 + cw], [S0 - cw, T0 - cw, S0 - cw + MM(60), T1 + cw], [S1 + cw - MM(60), T0 - cw, S1 + cw, T1 + cw]]) bx(p0, q0, p1, q1, fy, fy + fh, null, frame);
      bx(S0 - cw + MM(40), T0 - cw + MM(40), S1 + cw - MM(40), T1 + cw - MM(40), fy + fh - MM(10), fy + fh + MM(14), null, glass);
      if (curb.length) add(mergeGeometries(curb, false), memMat);
      if (cap.length) add(mergeGeometries(cap, false), copMat);
      if (frame.length) add(mergeGeometries(frame, false), alu);
      if (glass.length) { const gm = new THREE.Mesh(mergeGeometries(glass, false), winMats().glass); gm.renderOrder = 2; group.add(gm); }
    }
    // the drain: a collar welded to the membrane, the strainer dome with its ribs
    const [ds, dt] = r.drain, P0 = W(ds, dt, top(ds, dt) + ROOF.mem);
    const dm = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.55 }), dark = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(MM(210), MM(230), MM(10), 32), dm); col.position.set(P0[0], P0[1] + MM(5), P0[2]);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(MM(110), MM(110), MM(4), 24), dark); hole.position.set(P0[0], P0[1] + MM(11), P0[2]);
    group.add(col, hole);
    for (let k = 0; k < 8; k++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(MM(100), MM(5), 4, 16, Math.PI), dm);
      rib.position.set(P0[0], P0[1] + MM(12), P0[2]); rib.rotation.set(0, k * Math.PI / 8, 0); group.add(rib);
    }
  }
  // the ballast
  const grav = r.grav === 'all' ? null : new Set(r.grav || []), gl = live && live.layer === 'grav' ? live.cells : null;
  if (r.grav === 'all' || (grav && grav.size) || gl?.length) {
    const cells = [];
    for (let j = 0; j < b.nj; j++) for (let i = 0; i < b.ni; i++) { const k = j * b.ni + i; if (area.on(i, j) && (r.grav === 'all' || grav.has(k) || gl?.includes(k))) cells.push([i * c, j * c, (i + 1) * c, (j + 1) * c]); }
    const t = gravelTex();
    add(sheet(cells, (s, t2) => top(s, t2) + ROOF.mem + ROOF.gravel, (s, t2) => [mmS(s) / 1.2, mmS(t2) / 1.2], 0), new THREE.MeshStandardMaterial({ ...t, roughness: 0.95 }));
  }
  // the coping
  const cop = r.copS === 'all' ? parapetLines(b, units).map((l) => [...l.p0, ...l.p1, l.y, l.w]) : [...(r.copS || []), ...(live && live.layer === 'cop' && live.seg ? [live.seg] : [])];
  if (cop.length) {
    const cc = COP_COLOURS[r.cop] || COP_COLOURS.zinc, parts = [];
    for (const [x0, z0, x1, z1, y, w] of cop) {
      const L2 = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(-(z1 - z0), x1 - x0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W2 = w + MM(100);
      const nx = -(z1 - z0) / L2, nz = (x1 - x0) / L2;
      const put = (geo, ox, oy, oz) => { geo.rotateY(yaw); geo.translate(cx + ox, y + oy, cz + oz); geo.deleteAttribute('uv'); parts.push(geo.toNonIndexed()); };
      // the cap, a slight fall inward, the drips both sides, the joint strip at its end
      put(new THREE.BoxGeometry(L2, MM(2), W2), 0, MM(3), 0);
      for (const sd of [-1, 1]) put(new THREE.BoxGeometry(L2, MM(45), MM(2)), nx * sd * W2 / 2, -MM(20), nz * sd * W2 / 2);
      for (const sd of [-1, 1]) put(new THREE.BoxGeometry(L2, MM(3), MM(12)), nx * sd * (W2 / 2 - MM(6)), MM(-42), nz * sd * (W2 / 2 - MM(6)));
      const ex = (x1 - x0) / L2, ez = (z1 - z0) / L2; put(new THREE.BoxGeometry(MM(30), MM(3), W2), ex * (L2 / 2 - MM(15)), MM(5), ez * (L2 / 2 - MM(15)));
    }
    add(mergeGeometries(parts, false), new THREE.MeshStandardMaterial({ color: cc[1], roughness: 0.32, metalness: cc[2], normalMap: metalNormal() }));
  }
  // the roll at the end of the strip being rolled out
  if (live?.roll && live.rect) {
    const [a0, b0, a1, b1] = live.rect, A = live.roll.along, rad = MM(live.layer === 'vap' ? 55 : 85), len = A ? b1 - b0 : a1 - a0;
    const s = A ? live.roll.end : (a0 + a1) / 2, t2 = A ? (b0 + b1) / 2 : live.roll.end, h = live.layer === 'vap' ? 1 : top(s, t2) + ROOF.mem;
    const P0 = W(s, t2, h), roll = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 24), new THREE.MeshStandardMaterial({ ...(live.layer === 'vap' ? vapTex() : memTex(mc[1])), roughness: 0.45 }));
    const yaw = Math.atan2(-b.u[1], b.u[0]);
    roll.rotation.set(Math.PI / 2, 0, 0); roll.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), yaw + (A ? 0 : Math.PI / 2));
    roll.position.set(P0[0], P0[1] + rad, P0[2]); roll.castShadow = true; group.add(roll);
  }
  group.userData.roof = r;
  return group;
}

// the parapet's top: its lines (the top units, along each wall) → [{ p0, p1 (x, z), y, w, ux, uz }]
export function parapetLines(b, units) {
  const all = units.filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf), par = onSlab(units, b);
  const up = new Set(par); let grown = true;
  while (grown) { grown = false; for (const x of all) if (!up.has(x) && [...up].some((y) => Math.abs(x.bot - y.top) < MM(25) && Math.hypot(x.x - y.x, x.z - y.z) < x.hl + y.hl)) { up.add(x); grown = true; } }
  const tops = [...up].filter((x) => ![...up].some((y) => y !== x && Math.abs(y.bot - x.top) < MM(25) && Math.hypot(x.x - y.x, x.z - y.z) < Math.max(x.hl, y.hl)));
  const lines = [];
  for (const x of tops) {
    let ux = x.ux, uz = x.uz; if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uz < 0)) { ux = -ux; uz = -uz; }
    const d = -x.x * uz + x.z * ux, a = x.x * ux + x.z * uz;
    let l = lines.find((q) => Math.abs(q.ux * uz - q.uz * ux) < 0.05 && Math.abs(q.d - d) < x.hw + MM(40) && Math.abs(q.y - x.top) < MM(40));
    if (!l) lines.push((l = { ux, uz, d, y: x.top, w: x.hw * 2, iv: [] }));
    l.iv.push([a - x.hl, a + x.hl]);
  }
  const out = [];
  for (const l of lines) {
    l.iv.sort((p, q) => p[0] - q[0]);
    const m = []; for (const v of l.iv) { if (m.length && v[0] <= m.at(-1)[1] + MM(30)) m.at(-1)[1] = Math.max(m.at(-1)[1], v[1]); else m.push([...v]); }
    for (const [a0, a1] of m) out.push({ p0: [l.ux * a0 - l.uz * l.d, l.uz * a0 + l.ux * l.d], p1: [l.ux * a1 - l.uz * l.d, l.uz * a1 + l.ux * l.d], a0, a1, y: l.y, w: l.w, ux: l.ux, uz: l.uz, d: l.d });
  }
  return out;
}
