import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { canvas, asTex, normalOf, gravelTex } from './roof.js';
import { WATER } from './pitched.js';

// The blind area (отмостка) round the house, done the way it is on site:
//   form  – the edge boards on stakes round the outside, the width away from the walls,
//   geo   – the geotextile on the ground (the finger spreads it),
//   sand  – sand 60 mm, then gravel 60 mm (the finger spreads them),
//   mesh  – the welded mesh on chairs (under the concrete only),
//   fin   – the top: concrete 80 mm with a slope of 3 % away from the walls, the expansion
//           joints at the corners and every 2 m — or paving (кирпичик) with a kerb at the edge,
//   strip – the boards come off,
//   drain – the drainage channels with grates along a side (in the rain the water runs in them).
// The plan is a grid of 100 mm cells in the frame of the house (a along its walls, d across):
// a cell is in the blind area when it is outside the house and within the width of it
// (measured square: the corners are square).
//   blind { ux, uz (the frame), rects [[a0, d0, a1, d1]…] (the house, to the outer faces of
//           its walls), W (the width), g (the ground it is laid on), A0, D0, ni, nj (the grid),
//           form, geo, sand, grav, mesh, fin (cells: runs [start, n]…), finKind ('conc'|'tile'),
//           finCol, stripped, drains [segment keys] }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const BLIND = { cell: 100, slope: 0.03, joint: 2000, chan: 150, top: 200 };
export const BLIND_WIDTHS = [600, 800, 1000, 1200];
export const BLIND_LAYERS = [['form', 'Опалубка'], ['geo', 'Геотекстиль'], ['sand', 'Песок'], ['grav', 'Щебень'], ['mesh', 'Сетка'], ['fin', 'Бетон / плитка'], ['strip', 'Снять опалубку'], ['drain', 'Лотки']];
export const BLIND_FIN = { conc: 'Бетон', tile: 'Плитка' };
export const TILE_COLOURS = { grey: ['Серая', '#8f8c87', '#7b7873'], red: ['Красная', '#9b4b3b', '#843e30'], brown: ['Коричневая', '#6d4c37', '#5a3d2b'], graphite: ['Графит', '#505257', '#404247'], sand: ['Песочная', '#bba57f', '#a48e69'] };
// the tops of the layers above the ground (mm)
const TOP = { geo: 8, sand: 60, grav: 120, mesh: 150 };
export const PAINT = ['geo', 'sand', 'grav', 'mesh', 'fin'];

// ---- the cells -----------------------------------------------------------------------------
export function runsOf(set) {
  const a = [...set].sort((p, q) => p - q), out = [];
  for (const k of a) { const l = out[out.length - 1]; if (l && l[0] + l[1] === k) l[1]++; else out.push([k, 1]); }
  return out;
}
export function setOf(runs) { const s = new Set(); for (const [k, n] of runs || []) for (let i = 0; i < n; i++) s.add(k + i); return s; }

// the plan of a record (cached): the cells, their distance from the walls, the outer edge
const _plans = new WeakMap();
export function planOf(rec) {
  let P = _plans.get(rec);
  if (P) return P;
  const C = MM(BLIND.cell), { ux, uz, rects, W, A0, D0, ni, nj } = rec;
  const near = (a, d) => {
    let best = null;
    for (const r of rects) {
      const dx = Math.max(0, r[0] - a, a - r[2]), dy = Math.max(0, r[1] - d, d - r[3]), m = Math.max(dx, dy);
      if (!best || m < best.m) best = { m, dx, dy, r };
    }
    return best;
  };
  const cells = new Map();
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const a = A0 + (i + 0.5) * C, d = D0 + (j + 0.5) * C, n = near(a, d);
    if (n.m > 0 && n.m <= W) cells.set(j * ni + i, { i, j, a, d, dist: n.m, dx: n.dx, dy: n.dy, r: n.r });
  }
  const house = (i, j) => { const a = A0 + (i + 0.5) * C, d = D0 + (j + 0.5) * C; return near(a, d).m === 0; };
  const inB = (i, j) => i >= 0 && j >= 0 && i < ni && j < nj && cells.has(j * ni + i);
  // the outer edge: the cell edges with nothing (neither the area nor the house) beyond, joined
  // into straight segments — a: along a (a line of constant d), d: along d
  const segs = [];
  for (const [axis, nOut] of [['a', -1], ['a', 1], ['d', -1], ['d', 1]]) {
    const lines = new Map();
    for (const c of cells.values()) {
      const oi = axis === 'a' ? c.i : c.i + nOut, oj = axis === 'a' ? c.j + nOut : c.j;
      if (inB(oi, oj) || house(oi, oj)) continue;
      const line = axis === 'a' ? c.j : c.i, pos = axis === 'a' ? c.i : c.j;
      (lines.get(line) || lines.set(line, []).get(line)).push(pos);
    }
    for (const [line, ps] of lines) {
      ps.sort((p, q) => p - q);
      let s0 = ps[0], prev = ps[0];
      for (const p of [...ps.slice(1), Infinity]) {
        if (p !== prev + 1) {
          const at = (axis === 'a' ? D0 : A0) + (line + (nOut > 0 ? 1 : 0)) * C;
          segs.push({ key: `${axis}${nOut}:${line}:${s0}`, axis, n: nOut, at, s0: (axis === 'a' ? A0 : D0) + s0 * C, s1: (axis === 'a' ? A0 : D0) + (prev + 1) * C });
          s0 = p;
        }
        prev = p;
      }
    }
  }
  const W2 = (a, d) => [a * ux - d * uz, a * uz + d * ux];
  const distAt = (a, d) => near(a, d).m;
  P = { cells, segs, C, W2, distAt, near, ni, nj, A0, D0, frame: (x, z) => [x * ux + z * uz, -x * uz + z * ux], cellAt: (a, d) => { const i = Math.floor((a - A0) / C), j = Math.floor((d - D0) / C); return i < 0 || j < 0 || i >= ni || j >= nj ? -1 : j * ni + i; } };
  _plans.set(rec, P);
  return P;
}
// the cells of the plan as a list (the loose layers and the concrete keep a value per cell in
// this order): index by cell key, the four neighbours (+a, −a, +d, −d; −1 off the area)
const _lists = new WeakMap();
export function cellList(P) {
  let L = _lists.get(P);
  if (L) return L;
  const keys = [...P.cells.keys()], index = new Map(keys.map((k, n) => [k, n]));
  const nb = keys.map((k) => { const c = P.cells.get(k); return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => { const i = c.i + di, j = c.j + dj; return i < 0 || j < 0 || i >= P.ni || j >= P.nj ? -1 : index.get(j * P.ni + i) ?? -1; }); });
  L = { keys, index, nb, n: keys.length };
  _lists.set(P, L);
  return L;
}
// the loose layers: sand 60 mm, gravel 60 mm; how steep a heap of it stands (mm of height
// between two cells 100 mm apart: the angle of repose, ~31° and ~37°)
export const LOOSE = { sand: { t: 60, rep: 60 }, grav: { t: 60, rep: 75 } };
// the heights (mm) of a loose layer per cell: as stored, or (older records) full where done
export function heights(rec, L) {
  const CL = cellList(planOf(rec)), h = new Float32Array(CL.n), st = rec[L + 'H'];
  if (Array.isArray(st) && st.length === CL.n) { for (let n = 0; n < CL.n; n++) h[n] = st[n]; return h; }
  const done = setOf(rec[L]);
  if (done.size) CL.keys.forEach((k, n) => { if (done.has(k)) h[n] = LOOSE[L].t; });
  return h;
}
// the concrete: mm over the gravel per cell (lv), how worked (sm); where it is full
export const CONC = { base: 120 };
// the top of the gravel under a point (the ground's loose cover, terrain.js), or its mark
export function gravTop(rec, x, z) { const h = BLIND_GROUND.at?.(x, z); return h ?? rec.g + MM(CONC.base); }
export function concCap(rec, c, base) { return Math.max(20, (finTop(rec, c.dist) - base) / S); }
// the sand and the gravel lie on the ground as its loose cover (terrain.js: poured by the finger,
// by the shovel, delivered — the same stuff, the same physics); a cell is done where the layer
// is near its thickness at the cell's middle
const _sets = new WeakMap();
export function looseSet(rec, L) {
  const t = BLIND_GROUND.t;
  if (!t) return setOf(rec[L]);
  let c = _sets.get(rec);
  if (!c || c.v !== t.version) _sets.set(rec, (c = { v: t.version }));
  if (c[L]) return c[L];
  const P = planOf(rec), out = new Set(), m = [0, 0, 0, 0], need = MM(LOOSE[L].t * 0.85);
  for (const [k, cell] of P.cells) {
    const [x, z] = P.W2(cell.a, cell.d); t.looseOf(t.index(x, z), m);
    if ((L === 'sand' ? m[1] : m[2] + m[3]) >= need) out.add(k);
  }
  return (c[L] = out);
}
export const layerSet = (rec, L) => (L === 'sand' || L === 'grav' ? looseSet(rec, L) : setOf(rec[L]));
export function concLevels(rec) {
  const CL = cellList(planOf(rec)), h = new Float32Array(CL.n);
  if (Array.isArray(rec.lv) && rec.lv.length === CL.n) for (let n = 0; n < CL.n; n++) h[n] = rec.lv[n];
  return h;
}

// the plan of a house (pitchedTool.findHouse): the frame of its first wing, its rectangles
export function newBlind(H, Wmm) {
  const w0 = H.wings[0], ux = w0.ux, uz = w0.uz, W = MM(Wmm), C = MM(BLIND.cell);
  const rects = H.wings.map((w) => {
    const ca = w.cx * ux + w.cz * uz, cd = -w.cx * uz + w.cz * ux, same = Math.abs(w.ux * ux + w.uz * uz) > 0.7;
    const ha = same ? w.A : w.B, hd = same ? w.B : w.A;
    return [ca - ha, cd - hd, ca + ha, cd + hd].map((v) => +v.toFixed(6));
  });
  const a0 = Math.min(...rects.map((r) => r[0])) - W - 2 * C, d0 = Math.min(...rects.map((r) => r[1])) - W - 2 * C;
  const a1 = Math.max(...rects.map((r) => r[2])) + W + 2 * C, d1 = Math.max(...rects.map((r) => r[3])) + W + 2 * C;
  return { ux, uz, rects, W: +W.toFixed(6), Wmm, A0: +a0.toFixed(6), D0: +d0.toFixed(6), ni: Math.ceil((a1 - a0) / C), nj: Math.ceil((d1 - d0) / C) };
}
// the top of the finished area at a distance from the walls (the slope away from the house)
export function finTop(rec, dist) { return rec.g + MM(BLIND.top) - BLIND.slope * dist; }
export function layerTop(rec, L, dist = 0) { return L === 'fin' ? finTop(rec, dist) : rec.g + MM(TOP[L] || 0); }
// the share of the area not yet done in a layer (0…1)
export function leftOf(rec, L) { const P = planOf(rec), s = layerSet(rec, L); let n = 0; for (const k of P.cells.keys()) if (s.has(k)) n++; return 1 - n / Math.max(1, P.cells.size); }

// ---- the materials -------------------------------------------------------------------------
const MATS = {};
const mat = (k, make) => MATS[k] || (MATS[k] = make());
function noiseTex(base, spread, n = 256, dots = 2600, k = 1) {
  const cv = canvas(n), g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, n, n);
  for (let i = 0; i < dots; i++) { const v = Math.random(); g.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${Math.random() * spread})`; g.fillRect(Math.random() * n, Math.random() * n, 1 + Math.random() * 2 * k, 1 + Math.random() * 2 * k); }
  return cv;
}
// the photo textures (set by walls.js once they are loaded)
export const BLIND_TEX = { tex: null };
// the terrain under it (set by walls.js): the boards and the edges of the layers go down to it
export const BLIND_GROUND = { at: null, t: null };
// the geotextile: white nonwoven polypropylene — a felt of fine fibres, the name printed along
// the roll in blue every 0,5 m («GEOTEXTILE · NONWOVEN 200 g/m²»), a line along each edge
let _geo = null;
function geoTex() {
  if (_geo) return _geo;
  const n = 1024, cv = canvas(n), g = cv.getContext('2d'), hc = canvas(512), h = hc.getContext('2d');
  g.fillStyle = '#e6e6e1'; g.fillRect(0, 0, n, n); h.fillStyle = '#808080'; h.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * n, y = Math.random() * n, a = Math.random() * Math.PI, L = 8 + Math.random() * 40, v = Math.random();
    g.strokeStyle = v > 0.5 ? `rgba(255,255,255,${0.25 + Math.random() * 0.4})` : `rgba(150,150,140,${0.08 + Math.random() * 0.16})`;
    g.lineWidth = 0.6 + Math.random() * 0.8; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * L / 2, y + Math.sin(a + 0.6) * L / 2, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    if (i % 2) { h.strokeStyle = v > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'; h.lineWidth = 0.8; h.beginPath(); h.moveTo(x / 2, y / 2); h.lineTo(x / 2 + Math.cos(a) * L / 2, y / 2 + Math.sin(a) * L / 2); h.stroke(); }
  }
  // the print: two rows, staggered; the edge lines
  g.fillStyle = 'rgba(28,72,160,0.85)'; g.textBaseline = 'middle';
  // (mirrored: the uv of the area runs the other way to the picture)
  g.save(); g.translate(n, 0); g.scale(-1, 1);
  for (const [y, x0] of [[n * 0.25, 40], [n * 0.75, n / 2 + 40]]) for (const x of [x0, x0 - n]) {
    g.font = 'bold 54px Arial, Helvetica, sans-serif'; g.fillText('GEOTEXTILE', x, y - 18);
    g.font = '26px Arial, Helvetica, sans-serif'; g.fillText('NONWOVEN PP · 200 g/m²', x + 4, y + 26);
  }
  g.restore();
  g.fillStyle = 'rgba(28,72,160,0.55)'; g.fillRect(0, 6, n, 5); g.fillRect(0, n - 11, n, 5);
  const t = asTex(cv); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return (_geo = { map: t, nor: normalOf(hc, 1.2) });
}
// uv in world millimetres (the boards: along them on the sides, across on the tops)
function worldUV(geo, mm) {
  const p = geo.attributes.position, nr = geo.attributes.normal, uv = new Float32Array(p.count * 2), k = 1 / MM(mm);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = nr.getX(i), ny = nr.getY(i), nz = nr.getZ(i);
    if (Math.abs(ny) > 0.7) { uv[i * 2] = (Math.abs(nx) > Math.abs(nz) ? z : x) * k; uv[i * 2 + 1] = (Math.abs(nx) > Math.abs(nz) ? x : z) * k * 0.2; }
    else { const tl = Math.hypot(nx, nz) || 1; uv[i * 2] = (x * -nz / tl + z * nx / tl) * k; uv[i * 2 + 1] = y * k; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
// the roll of geotextile being rolled out: across the way it goes, turning as it goes
export function geoRoll(P, roll, y, len) {
  const g = new THREE.Group(), R = MM(70), r0 = MM(25), [x, z] = P.W2(roll.a, roll.d), [ex, ez] = P.W2(Math.cos(roll.ang), Math.sin(roll.ang));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 32, 1, true), M.geo());
  const cap = new THREE.RingGeometry(r0, R, 32), ends = [];
  for (const s of [-1, 1]) { const c = new THREE.Mesh(cap, mat('geoEnd', () => new THREE.MeshStandardMaterial({ map: spiralTex(), roughness: 0.9 }))); c.position.y = s * len / 2; c.rotation.x = s * -Math.PI / 2; ends.push(c); }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, len + MM(20), 20, 1, true), M.core()); core.material.side = THREE.DoubleSide;
  const spin = new THREE.Group(); spin.add(body, core, ...ends); spin.rotation.y = roll.spin || 0;
  const axis = new THREE.Group(); axis.add(spin); axis.rotation.z = Math.PI / 2;   // (the axis along x)
  g.add(axis); g.position.set(x, y + R, z); g.rotation.y = Math.atan2(-ez, ex) + Math.PI / 2;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
let _spiral = null;
function spiralTex() {
  if (_spiral) return _spiral;
  const n = 256, cv = canvas(n), g = cv.getContext('2d');
  g.fillStyle = '#d8d8d2'; g.fillRect(0, 0, n, n); g.strokeStyle = 'rgba(120,120,110,0.5)'; g.lineWidth = 1.2; g.beginPath();
  for (let t = 0; t < 60 * Math.PI; t += 0.05) { const r = 34 + t * 0.5; g.lineTo(n / 2 + Math.cos(t) * r * 0.97, n / 2 + Math.sin(t) * r * 0.97); }
  g.stroke();
  return (_spiral = asTex(cv));
}
const M = {
  // the boards: the photo of sawn planks (formwork.js) when it is loaded, uv in world mm
  wood: () => mat('wood' + !!BLIND_TEX.tex, () => { const T = BLIND_TEX.tex?.plank; if (T) return new THREE.MeshStandardMaterial({ map: T.diff, normalMap: T.nor, roughnessMap: T.arm, roughness: 1, color: 0xf0dcc0 }); const cv = canvas(64, 256), g = cv.getContext('2d'); g.fillStyle = '#b48d5c'; g.fillRect(0, 0, 64, 256); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,60,30,${Math.random() * 0.25})`; g.fillRect(Math.random() * 64, 0, 1 + Math.random() * 2, 256); } return new THREE.MeshStandardMaterial({ map: asTex(cv), roughness: 0.85 }); }),
  geo: () => mat('geo', () => { const T = geoTex(); return new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.nor, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.92, side: THREE.DoubleSide }); }),
  core: () => mat('core', () => new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })),
  // the sand: the photo with its relief, sharp at a slant (anisotropy), a little lighter (dry)
  sand: () => mat('sand', () => {
    const L = new THREE.TextureLoader(), ld = (f, srgb) => { const t = L.load('assets/textures/dense_sand/' + f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    return new THREE.MeshStandardMaterial({ map: ld('diff.jpg', true), normalMap: ld('nor_gl.jpg', false), normalScale: new THREE.Vector2(0.9, 0.9), color: 0xfff6ea, roughness: 0.96 });
  }),
  grav: () => mat('grav', () => { const T = gravelTex(); return new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.normalMap, color: 0x8d8984, roughness: 0.9 }); }),
  mesh: () => mat('mesh', () => { const cv = canvas(128), g = cv.getContext('2d'); g.clearRect(0, 0, 128, 128); g.strokeStyle = '#5b5d60'; g.lineWidth = 4; for (const p of [2, 66]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 128); g.moveTo(0, p); g.lineTo(128, p); g.stroke(); } return new THREE.MeshStandardMaterial({ map: asTex(cv), alphaTest: 0.5, transparent: false, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }); }),
  conc: () => mat('conc', () => { const cv = noiseTex('#a7a49d', 0.12, 256, 6000); const t = asTex(cv); return new THREE.MeshStandardMaterial({ map: t, normalMap: normalOf(noiseTex('#808080', 0.5, 128, 3000), 0.6), roughness: 0.88 }); }),
  joint: () => mat('joint', () => new THREE.MeshStandardMaterial({ color: 0x3b3936, roughness: 0.9 })),
  kerb: () => mat('kerb', () => new THREE.MeshStandardMaterial({ map: asTex(noiseTex('#9d9a94', 0.15, 128, 2000)), roughness: 0.85 })),
  chan: () => mat('chan', () => new THREE.MeshStandardMaterial({ color: 0x8c8a85, roughness: 0.85 })),
  grate: () => mat('grate', () => { const cv = canvas(64, 64), g = cv.getContext('2d'); g.clearRect(0, 0, 64, 64); g.fillStyle = '#2f3134'; g.fillRect(0, 0, 64, 6); g.fillRect(0, 58, 64, 6); for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 3, 64); return new THREE.MeshStandardMaterial({ map: asTex(cv), alphaTest: 0.5, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide }); }),
  rod: () => mat('rod', () => new THREE.MeshStandardMaterial({ color: 0x5e5a55, metalness: 0.7, roughness: 0.55 })),
  chair: () => mat('chair', () => new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6 })),
  dark: () => mat('dark', () => new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 1 })),
  live: (ok) => mat('live' + ok, () => new THREE.MeshBasicMaterial({ color: ok ? 0x35d06a : 0xe8402a, transparent: true, opacity: 0.35, depthWrite: false })),
};
// the paving: «кирпичик» 200 × 100 in running bond, two shades, sand in the joints
function tileMat(col) {
  return mat('tile' + col, () => {
    const [, c1, c2] = TILE_COLOURS[col] || TILE_COLOURS.grey, n = 256, cv = canvas(n), g = cv.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
    g.fillStyle = '#c9bea5'; g.fillRect(0, 0, n, n); h.fillStyle = '#000'; h.fillRect(0, 0, n, n);
    const pw = 64, ph = 32;
    for (let r = 0; r < n / ph; r++) for (let k = -1; k < n / pw + 1; k++) {
      const x = k * pw + (r % 2) * pw / 2, y = r * ph;
      g.fillStyle = Math.random() < 0.5 ? c1 : c2; g.fillRect(x + 2, y + 2, pw - 4, ph - 4);
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(x + 2 + Math.random() * (pw - 6), y + 2 + Math.random() * (ph - 6), 2, 2); }
      h.fillStyle = '#fff'; h.fillRect(x + 3, y + 3, pw - 6, ph - 6); h.fillStyle = '#aaa'; h.strokeStyle = '#aaa'; h.strokeRect(x + 2.5, y + 2.5, pw - 5, ph - 5);
    }
    return new THREE.MeshStandardMaterial({ map: asTex(cv), normalMap: normalOf(hc, 1.6), roughness: 0.8 });
  });
}

// ---- the geometry --------------------------------------------------------------------------
// a layer over cells: the top (its height from top(a, d)) and the sides down to the ground
// where the next cell is not in it; uv in metres / tile
function slab(P, set, top, bottom, tile) {
  const { C, W2, A0, D0, ni } = P, pos = [], uv = [], idx = [], bot = typeof bottom === 'function' ? bottom : () => bottom;
  const v = (a, d, y, side) => { const [x, z] = W2(a, d); pos.push(x, y, z); if (side) uv.push((side === 1 ? a : d) / tile, y / tile); else uv.push(a / tile, d / tile); return pos.length / 3 - 1; };
  for (const k of set) {
    const c = P.cells.get(k); if (!c) continue;
    const a0 = A0 + c.i * C, a1 = a0 + C, d0 = D0 + c.j * C, d1 = d0 + C;
    const p = [v(a0, d0, top(a0, d0)), v(a1, d0, top(a1, d0)), v(a1, d1, top(a1, d1)), v(a0, d1, top(a0, d1))];
    idx.push(p[0], p[2], p[1], p[0], p[3], p[2]);
    // the sides
    for (const [di, dj, A, B] of [[0, -1, [a0, d0], [a1, d0]], [1, 0, [a1, d0], [a1, d1]], [0, 1, [a1, d1], [a0, d1]], [-1, 0, [a0, d1], [a0, d0]]]) {
      if (set.has(k + di + dj * ni) && P.cells.has(k + di + dj * ni)) continue;
      const sd = dj ? 1 : 2, q = [v(A[0], A[1], top(A[0], A[1]), sd), v(B[0], B[1], top(B[0], B[1]), sd), v(B[0], B[1], bot(B[0], B[1]), sd), v(A[0], A[1], bot(A[0], A[1]), sd)];
      idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// the welded mesh: rods Ø5 every 150 mm both ways over the cells it is laid on (the rods
// across on top of the rods along), on plastic chairs every 600 mm
function meshRods(P, set, y) {
  const C = P.C, step = MM(150), r = MM(2.5), rods = [], chairs = [], cov = MM(30);
  const has = (i, j) => i >= 0 && j >= 0 && i < P.ni && j < P.nj && set.has(j * P.ni + i) && P.cells.has(j * P.ni + i);
  const rod = (a0, d0, a1, d1, yy) => {
    const L = Math.hypot(a1 - a0, d1 - d0); if (L < MM(60)) return;
    const g = new THREE.CylinderGeometry(r, r, L, 6, 1, true);
    g.rotateZ(Math.PI / 2); if (Math.abs(d1 - d0) > Math.abs(a1 - a0)) g.rotateY(-Math.PI / 2);
    const [x, z] = P.W2((a0 + a1) / 2, (d0 + d1) / 2); g.rotateY(Math.atan2(-P.W2(1, 0)[1], P.W2(1, 0)[0])); g.translate(x, yy, z);
    rods.push(g);
  };
  // (the lines on the grid of the area: rods along a at constant d, then along d)
  for (const [along, n0, n1, m0, m1] of [['a', P.D0, P.D0 + P.nj * C, P.A0, P.A0 + P.ni * C], ['d', P.A0, P.A0 + P.ni * C, P.D0, P.D0 + P.nj * C]]) {
    for (let q = n0 + step / 2; q < n1; q += step) {
      const lane = Math.floor((q - n0) / C);
      let run = null;
      for (let m = 0; m <= Math.round((m1 - m0) / C); m++) {
        const on = along === 'a' ? has(m, lane) : has(lane, m);
        if (on && run == null) run = m;
        if (!on && run != null) {
          const s0 = m0 + run * C + cov, s1 = m0 + m * C - cov, yy = y + (along === 'a' ? -r : r);
          if (along === 'a') rod(s0, q, s1, q, yy); else rod(q, s0, q, s1, yy);
          if (along === 'a') for (let s = s0 + MM(150); s < s1; s += MM(600)) chairs.push([s, q]);
          run = null;
        }
      }
    }
  }
  const cg = [];
  let n = 0;
  for (const [a, d] of chairs) {
    if (n++ % 2) continue;
    const g = new THREE.CylinderGeometry(MM(12), MM(22), MM(30), 6), [x, z] = P.W2(a, d);
    g.translate(x, y - r - MM(15), z); cg.push(g);
  }
  return { rods: merge(rods), chairs: merge(cg) };
}
// a box along a segment: from s0 to s1, across from c0 to c1 (in the frame), y0…y1
function segBox(P, sg, s0, s1, c0, c1, y0, y1) {
  const [a0, a1, d0, d1] = sg.axis === 'a' ? [s0, s1, c0, c1] : [c0, c1, s0, s1];
  const A = Math.min(a0, a1), B = Math.max(a0, a1), D = Math.min(d0, d1), E = Math.max(d0, d1);
  const g = new THREE.BoxGeometry(B - A, y1 - y0, E - D), [x, z] = P.W2((A + B) / 2, (D + E) / 2);
  g.rotateY(Math.atan2(-P.W2(1, 0)[1], P.W2(1, 0)[0])); g.translate(x, (y0 + y1) / 2, z);
  return g;
}
// the stream of sand / gravel off the shovel: grains falling onto the heap under the finger
function stream(P, st, m, y) {
  const g = [], [x, z] = P.W2(st.a, st.d), rnd = (k) => { const v = Math.sin(k * 127.1 + st.t * 311.7) * 43758.5; return v - Math.floor(v); };
  for (let k = 0; k < 70; k++) {
    const f = rnd(k), r = MM(15 + 40 * rnd(k + 99)) * (0.3 + f), an = rnd(k + 7) * Math.PI * 2, sz = MM(6 + 10 * rnd(k + 3));
    const b = new THREE.BoxGeometry(sz, sz, sz); b.translate(x + Math.cos(an) * r, y + MM(20) + f * MM(450), z + Math.sin(an) * r); g.push(b);
  }
  const o = new THREE.Mesh(merge(g), m); o.castShadow = true; return o;
}
const merge = (gs) => { const ok = gs.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g)); if (!ok.length) return null; const n = ok.reduce((s, g) => s + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0; for (const g of ok) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; } const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return m; };

// the area as it is (rec), with what is being done over it (live: { layer, cells } or { seg, ok }
// or { form: rec })
export function buildBlind(rec, live) {
  const G = new THREE.Group(), P = planOf(rec), g0 = rec.g, add = (geo, m, shadow = true) => { if (!geo) return null; const o = new THREE.Mesh(geo, m); o.receiveShadow = true; o.castShadow = shadow; G.add(o); return o; };
  const flat = (L) => () => layerTop(rec, L), lv = live?.layer, lc = live?.cells ? new Set(live.cells) : null;
  const cellsOfL = (L) => { const s = setOf(rec[L]); if (lv === L && lc) for (const k of lc) s.add(k); return s; };
  // the layers
  const down = (a, d) => { const [x, z] = P.W2(a, d), h = BLIND_GROUND.at?.(x, z); return Math.min(g0, h ?? g0) - MM(40); };
  add(slab(P, cellsOfL('geo'), flat('geo'), down, MM(1000)), M.geo(), false);
  if (lv === 'geo' && live.roll) G.add(geoRoll(P, live.roll, layerTop(rec, 'geo'), Math.min(MM(1000), rec.W + MM(100))));
  // (the sand and the gravel are the ground's: drawn with it; here only the stream off the shovel)
  if (live?.stream) G.add(stream(P, live.stream, lv === 'grav' ? M.grav() : M.sand(), live.stream.y));
  const fin = cellsOfL('fin'), kind = rec.finKind || (lv === 'fin' ? live.kind : null) || 'conc';
  const top = (a, d) => finTop(rec, P.distAt(a, d));
  // the mesh: rods on chairs (in the concrete too: it is drawn over them)
  const meshCells = cellsOfL('mesh');
  if (meshCells.size && !(kind === 'conc' && rec.stripped)) { const R = meshRods(P, meshCells, layerTop(rec, 'mesh') - MM(5)); add(R.rods, M.rod()); add(R.chairs, M.chair()); }
  // (the concrete is cast in place: drawn with the other cast concrete, walls.js)
  if (kind === 'tile') add(slab(P, fin, top, g0 + MM(TOP.grav) - MM(2), MM(800)), tileMat(rec.finCol || live?.col || 'grey'));
  // the joints in the concrete: at the corners of the house and every 2 m along the walls
  if (kind === 'conc' && fin.size) {
    const J = [], C = P.C, w = MM(12);
    for (const k of fin) {
      const c = P.cells.get(k); if (!c) continue;
      const r = c.r;
      // lines of constant a (across the walls along a) and of constant d
      const linesA = [r[0], r[2]], linesD = [r[1], r[3]];
      if (c.dx === 0) for (let a = r[0] + MM(BLIND.joint); a < r[2] - MM(500); a += MM(BLIND.joint)) linesA.push(a);
      if (c.dy === 0) for (let d = r[1] + MM(BLIND.joint); d < r[3] - MM(500); d += MM(BLIND.joint)) linesD.push(d);
      for (const a of linesA) if (a >= c.a - C / 2 && a < c.a + C / 2 && c.dy > 0) J.push(segBox(P, { axis: 'd' }, c.d - C / 2, c.d + C / 2, a - w / 2, a + w / 2, top(a, c.d) - MM(6), top(a, c.d) + MM(0.6)));
      for (const d of linesD) if (d >= c.d - C / 2 && d < c.d + C / 2 && c.dx > 0) J.push(segBox(P, { axis: 'a' }, c.a - C / 2, c.a + C / 2, d - w / 2, d + w / 2, top(c.a, d) - MM(6), top(c.a, d) + MM(0.6)));
    }
    add(merge(J), M.joint(), false);
  }
  // the edge: the boards on stakes (till they come off) — the kerb under the paving
  const outerTop = finTop(rec, rec.W);
  if (rec.form && !rec.stripped) {
    const B = [], T = MM(25), stakes = [];
    for (const sg of P.segs) {
      // (down into the ground where it falls away: a wider board there, the stakes driven deeper)
      const out = sg.at + sg.n * MM(60), gAt = (q) => { const [x, z] = sg.axis === 'a' ? P.W2(q, out) : P.W2(out, q), h = BLIND_GROUND.at?.(x, z); return h == null ? g0 : h; };   // (the ground just outside: inside it is levelled)
      const s0 = sg.s0 - T * 2, s1 = sg.s1 + T * 2, n = Math.max(1, Math.ceil((s1 - s0) / MM(400)));
      for (let k = 0; k < n; k++) {
        const q0 = s0 + (s1 - s0) * k / n, q1 = s0 + (s1 - s0) * (k + 1) / n, low = Math.min(gAt(q0), gAt(q1), gAt((q0 + q1) / 2));
        B.push(segBox(P, sg, q0, q1, sg.at, sg.at + sg.n * T, Math.min(g0, low) - MM(40), outerTop + MM(10)));
      }
      for (let q = sg.s0 + MM(150); q < sg.s1; q += MM(1000)) stakes.push(segBox(P, sg, q - MM(20), q + MM(20), sg.at + sg.n * T, sg.at + sg.n * (T + MM(40)), Math.min(g0, gAt(q)) - MM(80), outerTop + MM(60)));
    }
    add(worldUV(merge([...B, ...stakes]), 1360), M.wood());
  }
  if (kind === 'tile' && fin.size) {
    const K = [];
    for (const sg of P.segs) K.push(segBox(P, sg, sg.s0 - MM(80), sg.s1 + MM(80), sg.at, sg.at + sg.n * MM(80), g0 - MM(80), outerTop + MM(25)));
    add(merge(K), M.kerb());
  }
  // the channels with grates outside the edge, a sand trap at the end; water in the rain
  const drains = new Set(rec.drains || []);
  const water = [];
  for (const sg of P.segs) {
    const on = drains.has(sg.key), hl = live?.seg === sg.key;
    if (!on && !hl) continue;
    const o = (rec.finKind === 'tile' ? MM(80) : 0), c0 = sg.at + sg.n * o, c1 = c0 + sg.n * MM(BLIND.chan), cy = outerTop - MM(5), deep = MM(120);
    if (hl && !on) { add(segBox(P, sg, sg.s0, sg.s1, c0, c1, cy - deep, cy + MM(10)), M.live(live.ok), false); continue; }
    const parts = [
      segBox(P, sg, sg.s0, sg.s1, c0, c0 + sg.n * MM(20), cy - deep, cy - MM(4)),
      segBox(P, sg, sg.s0, sg.s1, c1 - sg.n * MM(20), c1, cy - deep, cy - MM(4)),
      segBox(P, sg, sg.s0, sg.s1, c0, c1, cy - deep - MM(20), cy - deep),
      segBox(P, sg, sg.s0 - MM(20), sg.s0, c0, c1, cy - deep, cy - MM(4)), segBox(P, sg, sg.s1, sg.s1 + MM(20), c0, c1, cy - deep, cy - MM(4)),
    ];
    // the sand trap at the end: a box 300 × 300
    const e0 = sg.s1 - MM(300);
    parts.push(segBox(P, sg, e0, sg.s1, c1, c1 + sg.n * MM(20), cy - deep - MM(200), cy - MM(4)));
    add(merge(parts), M.chan());
    add(segBox(P, sg, sg.s0, sg.s1, c0 + sg.n * MM(18), c1 - sg.n * MM(18), cy - deep + MM(2), cy - deep + MM(3)), M.dark(), false);
    // the grate on top (its bars across)
    const gr = segBox(P, sg, sg.s0, sg.s1, c0 + sg.n * MM(20), c1 - sg.n * MM(20), cy - MM(6), cy - MM(4));
    const uvA = gr.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) * (sg.s1 - sg.s0) / MM(80));
    add(gr, M.grate(), false);
    water.push(segBox(P, sg, sg.s0, sg.s1, c0 + sg.n * MM(21), c1 - sg.n * MM(21), cy - deep + MM(5), cy - deep + MM(25)));
  }
  if (water.length) {
    const wm = mat('bwater', () => new THREE.MeshStandardMaterial({ color: 0x8fa3b0, transparent: true, opacity: 0, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    const o = add(merge(water), wm, false); o.onBeforeRender = () => { wm.opacity = 0.75 * WATER.rain; };
  }
  return G;
}
// the top of the area at a point (null: not on it) — for what stands on it (the downpipes)
export function blindTopAt(recs, x, z) {
  for (const r of recs) {
    if (!r.fin?.length) continue;
    const P = planOf(r), [a, d] = P.frame(x, z), k = P.cellAt(a, d);
    if (k >= 0 && P.cells.has(k) && setOf(r.fin).has(k)) return finTop(r, P.distAt(a, d));
  }
  return null;
}
