import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { plan, toWorld } from '../tools/belt.js';
import { boxOf } from '../tools/freeBrick.js';

// A flat roof (плоская кровля) on a floor slab, layer by layer as on site:
//   1 the vapour barrier (a foil film on the slab),
//   2 the insulation — XPS boards 150 mm, staggered,
//   3 the tapered insulation — the slope, 2 % to the drain,
//   4 the PVC membrane, welded in 2 m strips, turned up the parapet 300 mm, the drain,
//   5 the coping on the parapet (a steel cap with drips).
// The parapet: the masonry laid on the slab along its edge (the roof stops at it).
// The roof's plan: the slab's cells not under the parapet.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const ROOF = { vap: 1, xps: 150, minWedge: 20, slope: 0.02, mem: 2, upstand: 300, gravel: 50 };
export const ROOF_STAGES = ['Пароизоляция', 'Утеплитель XPS 150 мм', 'Клиновидный уклон 2 %', 'Мембрана и воронка', 'Отлив парапета'];

// the looks to choose from
export const ROOF_LOOKS = {
  grey: { name: 'Светло-серая мембрана, оцинкованный отлив', mem: '#9a9d9f', coping: 0xb9bcc0, copingMetal: 0.85 },
  graphite: { name: 'Графитовая мембрана, отлив антрацит', mem: '#3c3f43', coping: 0x383b3f, copingMetal: 0.5 },
  white: { name: 'Белая мембрана, белый отлив', mem: '#e9eae6', coping: 0xeeeeea, copingMetal: 0.3 },
  gravel: { name: 'Балласт из гравия, отлив антрацит', mem: '#3c3f43', coping: 0x383b3f, copingMetal: 0.5, gravel: true },
};

// textures drawn on a canvas: what one metre (or a board) of the surface looks like
const TEX = {};
function canvasTex(key, size, draw) {
  if (TEX[key]) return TEX[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (TEX[key] = t);
}
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// XPS boards 1200 × 600, staggered: the texture is 1200 × 1200 mm
const xpsTex = () => canvasTex('xps', 512, (g, n) => {
  g.fillStyle = '#e7843a'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,200,140' : '150,70,20'},${0.04 + rnd() * 0.06})`; g.fillRect(rnd() * n, rnd() * n, 2, 2); }
  g.strokeStyle = 'rgba(90,40,10,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, n / 2); g.lineTo(n, n / 2); g.moveTo(0, 0); g.lineTo(n, 0); g.moveTo(0, 0); g.lineTo(0, n / 2); g.moveTo(n / 2, n / 2); g.lineTo(n / 2, n); g.stroke();
});
// tapered boards 1000 × 1000, light grey
const wedgeTex = () => canvasTex('wedge', 256, (g, n) => {
  g.fillStyle = '#d6d7d2'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(120,120,115,${0.04 + rnd() * 0.06})`; g.fillRect(rnd() * n, rnd() * n, 1.5, 1.5); }
  g.strokeStyle = 'rgba(80,80,75,0.5)'; g.lineWidth = 2; g.strokeRect(0, 0, n, n);
});
// the membrane: 2 m strips, the welded overlap a darker band along each
const memTex = (col) => canvasTex('mem' + col, 512, (g, n) => {
  g.fillStyle = col; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.015 + rnd() * 0.02})`; g.fillRect(rnd() * n, rnd() * n, 2, 2); }
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, n, n * 0.02);
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, n * 0.02, n, 3);
});
const gravelTex = () => canvasTex('gravel', 512, (g, n) => {
  g.fillStyle = '#8f8b84'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 2600; i++) {
    const r = 3 + rnd() * 6, x = rnd() * n, y = rnd() * n, c = 110 + rnd() * 90;
    g.fillStyle = `rgb(${c},${c - 4},${c - 10})`; g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x + 1, y + 2, r * 0.9, r * 0.4, 0, 0, 6.3); g.fill();
  }
});

// the units standing on the slab (the parapet / the walls of a storey on it)
export function onSlab(units, b) {
  const top0 = b.top + b.H;
  return units.filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf).filter((x) => x.bot > top0 - MM(5) && x.bot < top0 + MM(60));
}

// stage: how many layers are laid (1 … 5); look: ROOF_LOOKS key
export function buildRoof(b, units, stage = 5, look = 'grey') {
  const L = ROOF_LOOKS[look] || ROOF_LOOKS.grey, P = plan(b), { ni, nj, c } = b, top0 = b.top + b.H;
  // the parapet's footprint in the slab's cells
  const par = onSlab(units, b), blocked = new Uint8Array(ni * nj);
  for (const u of par) {
    const n = Math.ceil(Math.max(u.hl, u.hw) / c) + 1, [s0, t0] = [(u.x - b.o[0]) * b.u[0] + (u.z - b.o[1]) * b.u[1], -(u.x - b.o[0]) * b.u[1] + (u.z - b.o[1]) * b.u[0]];
    const ci = Math.floor(s0 / c), cj = Math.floor(t0 / c);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= ni || j >= nj) continue;
      const [x, z] = toWorld(b, (i + 0.5) * c, (j + 0.5) * c), dx = x - u.x, dz = z - u.z;
      if (Math.abs(dx * u.ux + dz * u.uz) < u.hl + c * 0.3 && Math.abs(-dx * u.uz + dz * u.ux) < u.hw + c * 0.3) blocked[j * ni + i] = 1;
    }
  }
  const on = (i, j) => i >= 0 && j >= 0 && i < ni && j < nj && P.mask[j * ni + i] && !blocked[j * ni + i];
  // the cells of the roof, the drain at their middle
  let si = 0, sj = 0, n = 0;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (on(i, j)) { si += i; sj += j; n++; }
  if (!n) return null;
  let di = Math.round(si / n), dj = Math.round(sj / n);
  if (!on(di, dj)) { let bd = Infinity; for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (on(i, j)) { const d = Math.hypot(i - si / n, j - sj / n); if (d < bd) { bd = d; di = i; dj = j; } } }
  // the tapered layer: 20 mm at the drain, + 2 % of the distance from it (a square fall to it)
  const dist = (i, j) => Math.max(Math.abs(i - di), Math.abs(j - dj)) * c / S;   // (mm)
  const wedge = (i, j) => (stage >= 3 ? ROOF.minWedge + ROOF.slope * dist(i, j) : 0);
  const layerTop = (i, j) => (stage >= 1 ? ROOF.vap : 0) + (stage >= 2 ? ROOF.xps : 0) + wedge(i, j) + (stage >= 4 ? ROOF.mem : 0);
  // the corner heights: the mean of the cells round it that are on
  const vh = (i, j) => { let h = 0, k = 0; for (const [a, d] of [[i, j], [i - 1, j], [i, j - 1], [i - 1, j - 1]]) if (on(a, d)) { h += layerTop(a, d); k++; } return k ? h / k : 0; };
  const pos = [], uv = [], idx = [];
  const V = (i, j, hmm) => { const [x, z] = toWorld(b, i * c, j * c); pos.push(x, top0 + MM(hmm), z); uv.push(x / MM(1000), z / MM(1000)); return pos.length / 3 - 1; };
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    if (!on(i, j)) continue;
    const a = V(i, j, vh(i, j)), b2 = V(i + 1, j, vh(i + 1, j)), c2 = V(i + 1, j + 1, vh(i + 1, j + 1)), d = V(i, j + 1, vh(i, j + 1));
    idx.push(a, d, b2, b2, d, c2);
    // the sides where it ends (at the parapet the membrane goes up it)
    for (const [q, e0, e1] of [[[i + 1, j], [i + 1, j], [i + 1, j + 1]], [[i - 1, j], [i, j + 1], [i, j]], [[i, j + 1], [i + 1, j + 1], [i, j + 1]], [[i, j - 1], [i, j], [i + 1, j]]]) {
      if (on(...q)) continue;
      const up = stage >= 4 && blocked[q[1] * ni + q[0]] ? ROOF.upstand : 0;
      const h0 = vh(...e0), h1 = vh(...e1);
      const t0 = V(...e0, Math.max(h0, up)), t1 = V(...e1, Math.max(h1, up)), b0 = V(...e0, 0), b1 = V(...e1, 0);
      idx.push(t0, b0, t1, t1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  let mat;
  if (stage === 1) mat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
  else if (stage === 2) { const t = xpsTex(); t.repeat.set(1 / 1.2, 1 / 1.2); mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }); }
  else if (stage === 3) mat = new THREE.MeshStandardMaterial({ map: wedgeTex(), roughness: 0.85, side: THREE.DoubleSide });
  else if (L.gravel && stage >= 5) { const t = gravelTex(); t.repeat.set(1.6, 1.6); mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide }); }
  else { const t = memTex(L.mem); t.repeat.set(0.5, 0.5); mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, side: THREE.DoubleSide }); }
  const group = new THREE.Group();
  const roof = new THREE.Mesh(g, mat); roof.castShadow = roof.receiveShadow = true; group.add(roof);
  // the drain: a collar, the dome of its strainer
  if (stage >= 4) {
    const [x, z] = toWorld(b, (di + 0.5) * c, (dj + 0.5) * c), y = top0 + MM(layerTop(di, dj));
    const dm = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6 });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(MM(200), MM(220), MM(8), 24), dm); col.position.set(x, y + MM(4), z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(MM(90), 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5, wireframe: false }));
    dome.position.set(x, y + MM(8), z);
    group.add(col, dome);
  }
  // the coping on the parapet: on the top units, 50 mm over each face, drips along the edges
  if (stage >= 5 && par.length) {
    const all = units.filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf);
    // the parapet: up from the slab, the top units (nothing on them)
    const up = new Set(par); let grown = true;
    while (grown) { grown = false; for (const x of all) if (!up.has(x) && [...up].some((y) => Math.abs(x.bot - y.top) < MM(25) && Math.hypot(x.x - y.x, x.z - y.z) < x.hl + y.hl)) { up.add(x); grown = true; } }
    const tops = [...up].filter((x) => ![...up].some((y) => y !== x && Math.abs(y.bot - x.top) < MM(25) && Math.hypot(x.x - y.x, x.z - y.z) < Math.max(x.hl, y.hl)));
    const parts = [];
    for (const x of tops) {
      const yaw = Math.atan2(-x.uz, x.ux), L2 = x.hl * 2 + MM(6), W = x.hw * 2 + MM(100), y = x.top + MM(1);
      const add = (geo, ox, oy, oz) => { geo.rotateY(yaw); geo.translate(x.x + ox, y + oy, x.z + oz); parts.push(geo.toNonIndexed()); };
      add(new THREE.BoxGeometry(L2, MM(2), W), 0, MM(1), 0);
      for (const sd of [-1, 1]) { const nx = -x.uz * sd, nz = x.ux * sd; add(new THREE.BoxGeometry(L2, MM(40), MM(2)), nx * (W / 2), -MM(20), nz * (W / 2)); }
    }
    if (parts.length) {
      for (const p of parts) { p.deleteAttribute('uv'); }
      const cm = new THREE.Mesh(mergeGeometries(parts, false), new THREE.MeshStandardMaterial({ color: L.coping, roughness: 0.35, metalness: L.copingMetal }));
      cm.castShadow = cm.receiveShadow = true; group.add(cm);
    }
  }
  group.userData.roof = { stage, look, drain: [di, dj] };
  return group;
}
