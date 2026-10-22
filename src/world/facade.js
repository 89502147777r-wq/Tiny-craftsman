import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { canvas, asTex, normalOf } from './roof.js';
import { wallLines, masonry, findOpenings } from '../tools/windowFit.js';
import { beltContains } from '../tools/belt.js';
import { gableWalls } from './pitched.js';

// The facade (мокрый фасад / навесные панели), laid piece by piece as on site:
//   eps  – the insulation: facade EPS boards 1000 × 500 × 100 on glue, staggered, cut at the
//          openings and the corners; 5 dowels («грибки») each,
//   mesh – the base coat with the fibreglass mesh: rolls 1 m wide, 100 mm overlaps,
//   fin  – the finish: a thin-coat plaster (короед / шуба, a colour) put on by hand, or
//          facade panels (wood, stone, clinker) hung piece by piece.
export const FACADE = { eps: 100, epsL: 1000, epsW: 500, base: 5, plaster: 3, panel: 20, meshW: 1000, meshLap: 100, dowel: 60 };
export const PLASTER_COLOURS = {
  white: ['Белый', '#ecebe6'], ivory: ['Слоновая кость', '#e6dcc6'], sand: ['Песочный', '#d6c29c'], beige: ['Бежевый', '#c9b08c'],
  grey: ['Светло-серый', '#b9bbb8'], graphite: ['Графит', '#55585b'], terra: ['Терракота', '#b46f4f'], olive: ['Оливковый', '#8f9172'],
};
export const PLASTER_KINDS = { bark: 'Короед', fur: 'Шуба' };
// the panels: a type, then its colour (a key 'type:colour'); the old keys still read
export const PANEL_TYPES = {
  stone: ['Камень', { sandstone: ['Песчаник', ['#cdb894', '#b9a37c', '#d9c8a6', '#a99372']], slate: ['Сланец', ['#6b6f72', '#55595c', '#81848a', '#625f58']], travertine: ['Травертин', ['#e2d6bd', '#cfc0a2', '#ebe1cb', '#bfae8c']], granite: ['Гранит', ['#5a5450', '#6c6560', '#48433f', '#7a726a']], rust: ['Рваный ржавый', ['#9a6b45', '#b5875a', '#7d5537', '#c49a6c']] }],
  clinker: ['Клинкер', { red: ['Красный', ['#9c4a33', '#7c3626', '#b35d40']], brown: ['Коричневый', ['#5e3a2a', '#6f4632', '#4c2e22']], straw: ['Соломенный', ['#d5b779', '#c7a663', '#e0c58e']], graphite: ['Графит', ['#3d3d40', '#4a494b', '#2f2f32']], white: ['Белый', ['#e8e4dc', '#d9d4ca', '#f1eee8']] }],
  wood: ['Планкен', { oak: ['Светлый дуб', ['#b98a58', '#8c6038']], walnut: ['Термо-орех', ['#6b4429', '#43281a']], wenge: ['Венге', ['#3f2a20', '#24170f']], grey: ['Серый состаренный', ['#8d8a83', '#5f5c56']] }],
};
const KIND = { stone: 'stone', clinker: 'brick', wood: 'wood' };
export const PANELS = {};
for (const [t, [tn, cols]] of Object.entries(PANEL_TYPES)) for (const [c, [cn, pal]] of Object.entries(cols)) PANELS[`${t}:${c}`] = [`${tn} — ${cn.toLowerCase()}`, KIND[t], pal];
for (const [o, n] of Object.entries({ oak: 'wood:oak', walnut: 'wood:walnut', sandstone: 'stone:sandstone', slate: 'stone:slate', clinker: 'clinker:red' })) PANELS[o] = PANELS[n];

const TEX = {};
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const grey = (v) => { const k = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${k},${k},${k})`; };
const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); };
// a blob in the height: a radial gradient (wrapped round the tile)
function blob(h, n, x, y, r, v, a = 1) {
  for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) {
    const X = x + ox, Y = y + oy; if (X < -r || Y < -r || X > n + r || Y > n + r) continue;
    const gr = h.createRadialGradient(X, Y, 0, X, Y, r); gr.addColorStop(0, `rgba(${v},${v},${v},${a})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); h.fillStyle = gr; h.fillRect(X - r, Y - r, 2 * r, 2 * r);
  }
}

// ---- the insulation: a white EPS board 1000 × 500 (the beads, the stamp, the edges) ------------
export function epsTex() {
  if (TEX.eps) return TEX.eps;
  const n = 512, m = 256, c = canvas(n, m), g = c.getContext('2d'), hc = canvas(n, m), h = hc.getContext('2d');
  g.fillStyle = '#efefe9'; g.fillRect(0, 0, n, m); h.fillStyle = '#808080'; h.fillRect(0, 0, n, m);
  // the beads: rings of 3–5 mm
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * n, y = rnd() * m, r = 1 + rnd() * 1.4;
    g.strokeStyle = `rgba(150,150,140,${0.12 + rnd() * 0.12})`; g.lineWidth = 0.6; g.beginPath(); g.arc(x, y, r, 0, 6.28); g.stroke();
    h.fillStyle = grey(0.5 + rnd() * 0.08); h.beginPath(); h.arc(x, y, r * 0.9, 0, 6.28); h.fill();
  }
  g.fillStyle = 'rgba(30,90,170,0.6)'; g.font = 'bold 20px sans-serif'; g.fillText('ППС 16Ф · ФАСАД', 26, 46); g.font = '13px sans-serif'; g.fillText('1000×500×100  ГОСТ 15588', 26, 66);
  g.fillStyle = 'rgba(120,120,110,0.35)'; for (const [x, y, w, hh] of [[0, 0, n, 3], [0, m - 3, n, 3], [0, 0, 3, m], [n - 3, 0, 3, m]]) g.fillRect(x, y, w, hh);
  h.fillStyle = '#505050'; for (const [x, y, w, hh] of [[0, 0, n, 2], [0, m - 2, n, 2], [0, 0, 2, m], [n - 2, 0, 2, m]]) h.fillRect(x, y, w, hh);
  return (TEX.eps = { map: asTex(c), normalMap: normalOf(hc, 2), roughness: 0.9 });
}

// ---- the base coat (a 500 mm tile): grey glue in the trowel's sweeps; with the mesh pressed in --
function glueCanvas(col) {
  const n = 512, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  g.fillStyle = col; g.fillRect(0, 0, n, n); h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  for (let i = 0; i < 60; i++) { const x = rnd() * n, y = rnd() * n, r = 30 + rnd() * 70; blob(h, n, x, y, r, rnd() < 0.5 ? 150 : 100, 0.35); blob(g, n, x, y, r, rnd() < 0.5 ? 200 : 120, 0.08); }
  // the edges of the trowel's strokes
  for (let i = 0; i < 40; i++) { const x = rnd() * n, y = rnd() * n, l = 60 + rnd() * 160; h.fillStyle = 'rgba(190,190,190,0.5)'; h.fillRect(x, y, 1.5, l); h.fillRect(x - n, y, 1.5, l); h.fillRect(x, y - n, 1.5, l); }
  return { n, c, g, hc, h };
}
// the fresh glue: darker, wet
export function glueTex() {
  if (TEX.glue) return TEX.glue;
  const { c, hc } = glueCanvas('#8f908b');
  return (TEX.glue = { map: asTex(c), normalMap: normalOf(hc, 1.5), roughness: 0.55 });
}
function strands(ctx, n, col, w, jitter) {
  const st = n / 100;
  for (let k = 0; k < 100; k++) for (const dir of [0, 1]) {
    const p = k * st + (rnd() - 0.5) * jitter;
    ctx.strokeStyle = col(); ctx.lineWidth = w; ctx.beginPath();
    if (dir) { ctx.moveTo(p, 0); ctx.lineTo(p + (rnd() - 0.5) * jitter, n); } else { ctx.moveTo(0, p); ctx.lineTo(n, p + (rnd() - 0.5) * jitter); }
    ctx.stroke();
  }
}
// the mesh pressed into the glue and smoothed over: it shows through faintly
export function meshTex() {
  if (TEX.mesh) return TEX.mesh;
  const { n, c, g, hc, h } = glueCanvas('#a9aaa4');
  strands(g, n, () => `rgba(200,130,80,${0.07 + rnd() * 0.05})`, 1.1, 1);
  strands(h, n, () => 'rgba(150,150,150,0.5)', 1, 1);
  return (TEX.mesh = { map: asTex(c), normalMap: normalOf(hc, 1.5), roughness: 0.95 });
}
// the loose mesh (rolled out, not pressed in yet): orange strands, see-through
export function looseMeshTex() {
  if (TEX.loose) return TEX.loose;
  const n = 512, c = canvas(n), g = c.getContext('2d');
  strands(g, n, () => `rgb(${226 + rnd() * 20},${128 + rnd() * 20},${58 + rnd() * 10})`, 1.6, 0.6);
  g.fillStyle = 'rgba(40,40,40,0.8)'; g.font = 'bold 13px sans-serif'; g.fillText('ФАСАДНАЯ 160', 40, 30);
  return (TEX.loose = { map: asTex(c) });
}
// a smooth wet coat of the plaster (before the float): the colour, the trowel's sweeps
export function wetTex(colour) {
  const key = 'wet' + colour; if (TEX[key]) return TEX[key];
  const { c, g, hc } = glueCanvas(PLASTER_COLOURS[colour][1]);
  return (TEX[key] = { map: asTex(c), normalMap: normalOf(hc, 1.2), roughness: 0.5 });
}

// ---- the thin-coat plaster (a 500 mm tile): the height is the same for every colour ------------
function plasterHeight(kind) {
  const key = 'h' + kind; if (TEX[key]) return TEX[key];
  const n = 512, hc = canvas(n), h = hc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  // the fine sand of the mix
  for (let i = 0; i < 26000; i++) { h.fillStyle = grey(0.45 + rnd() * 0.2); const r = 0.6 + rnd() * 1.2; h.fillRect(rnd() * n, rnd() * n, r, r); }
  if (kind === 'bark') {
    // короед: the grains (2,5 mm) rolled by the float leave grooves — here up and down,
    // a little slanted, each a dark furrow with a lip
    for (let i = 0; i < 850; i++) {
      const x = rnd() * n, y = rnd() * n, l = 14 + rnd() * 34, a = Math.PI / 2 + (rnd() - 0.5) * 0.45, w = 2.4 + rnd() * 2;
      for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) {
        h.save(); h.translate(x + ox, y + oy); h.rotate(a);
        h.fillStyle = 'rgba(0,0,0,0.95)'; h.beginPath(); h.ellipse(0, 0, l / 2, w / 2, 0, 0, 6.28); h.fill();
        h.fillStyle = 'rgba(170,170,170,0.5)'; h.beginPath(); h.ellipse(l / 2 + 1, 0, 2, w / 2 + 0.5, 0, 0, 6.28); h.fill();
        h.restore();
      }
    }
  } else {
    // шуба: the mix thrown on — bumps of 2–6 mm, close together
    for (let i = 0; i < 9000; i++) blob(h, n, rnd() * n, rnd() * n, 2 + rnd() * 4.5, 230, 0.5 + rnd() * 0.4);
    for (let i = 0; i < 2500; i++) blob(h, n, rnd() * n, rnd() * n, 2 + rnd() * 3, 40, 0.4);
  }
  return (TEX[key] = hc);
}
export function plasterTex(kind, colour) {
  const key = kind + colour; if (TEX[key]) return TEX[key];
  const hc = plasterHeight(kind), n = hc.width, c = canvas(n), g = c.getContext('2d'), col = PLASTER_COLOURS[colour][1];
  g.fillStyle = col; g.fillRect(0, 0, n, n);
  // the colour follows the relief a little (the hollows hold the dust, the tops catch the light)
  g.globalAlpha = kind === 'bark' ? 0.28 : 0.2; g.globalCompositeOperation = 'multiply'; g.drawImage(hc, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  for (let i = 0; i < 4000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'; g.fillRect(rnd() * n, rnd() * n, 1.2, 1.2); }
  bake(c, hc, kind === 'bark' ? 0.9 : 1.1, 0.35);
  return (TEX[key] = { map: asTex(c), normalMap: normalOf(hc, kind === 'bark' ? 10 : 8), roughness: 0.97 });
}

// ---- the panels (a 1 m tile) ----------------------------------------------------------------
// the relief in the colour too: lit from the top left over the height (k: how strong), the
// hollows darker (they hold the shadow) — so the stone, the clinker, the plaster read in any light
function bake(c, hc, k, ao = 0.35) {
  const n = c.width, g = c.getContext('2d'), img = g.getImageData(0, 0, n, n), H = hc.getContext('2d').getImageData(0, 0, n, n).data;
  const h = (x, y) => H[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = h(x, y), lit = 1 + k * ((h(x - 2, y - 2) - h(x + 2, y + 2))), occ = 1 - ao * Math.max(0, 0.5 - v) * 2, f = Math.max(0.2, lit * occ), i = (y * n + x) * 4;
    img.data[i] = Math.min(255, img.data[i] * f); img.data[i + 1] = Math.min(255, img.data[i + 1] * f); img.data[i + 2] = Math.min(255, img.data[i + 2] * f);
  }
  g.putImageData(img, 0, 0);
}
function woodTex(cols) {
  const n = 512, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  // boards 140 mm with a 10 mm gap (×5,12 px), each its own tone, the grain along
  const bw = 140 * 0.512, gap = 10 * 0.512;
  for (let y = 0, k = 0; y < n; y += bw + gap, k++) {
    const t = 0.85 + rnd() * 0.3, base = shade(cols[0], t);
    g.fillStyle = base; g.fillRect(0, y, n, bw);
    for (let i = 0; i < 70; i++) {
      const yy = y + rnd() * bw, amp = 1 + rnd() * 3, ph = rnd() * 6, fr = 0.004 + rnd() * 0.01;
      g.strokeStyle = shade(cols[1], 0.8 + rnd() * 0.4) + (rnd() < 0.5 ? '55' : '88'); g.lineWidth = 0.6 + rnd() * 1.2; g.beginPath();
      for (let x = 0; x <= n; x += 8) { const yv = Math.min(y + bw - 1, Math.max(y + 1, yy + Math.sin(x * fr + ph) * amp)); x ? g.lineTo(x, yv) : g.moveTo(x, yv); }
      g.stroke();
      h.strokeStyle = 'rgba(110,110,110,0.5)'; h.lineWidth = 0.8; h.beginPath(); for (let x = 0; x <= n; x += 8) { const yv = yy + Math.sin(x * fr + ph) * amp; x ? h.lineTo(x, yv) : h.moveTo(x, yv); } h.stroke();
    }
    // the ends of the boards (staggered)
    const xe = ((k * 0.37) % 1) * n; g.fillStyle = shade(cols[1], 0.6); g.fillRect(xe, y, 2, bw); h.fillStyle = '#303030'; h.fillRect(xe, y, 2, bw);
    // the gap: dark, deep
    g.fillStyle = '#1d1712'; g.fillRect(0, y + bw, n, gap); h.fillStyle = '#101010'; h.fillRect(0, y + bw, n, gap);
    h.fillStyle = '#a8a8a8'; h.fillRect(0, y, n, 2); h.fillStyle = '#5a5a5a'; h.fillRect(0, y + bw - 2, n, 2);
  }
  bake(c, hc, 0.8, 0.5);
  return { map: asTex(c), normalMap: normalOf(hc, 5), roughness: 0.75 };
}
function stoneTex(cols) {
  // flat stones (a jittered Voronoi, wrapped), mortar between
  const n = 512, k = 8, cell = n / k, pts = [];
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) pts.push([(i + 0.15 + rnd() * 0.7) * cell, (j + 0.15 + rnd() * 0.7) * cell * 1, rnd()]);
  const c = canvas(n), g = c.getContext('2d'), img = g.createImageData(n, n), hc = canvas(n), hg = hc.getContext('2d'), himg = hg.createImageData(n, n);
  const pc = cols.map((h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 }));   // (sRGB, as drawn)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell); let d1 = 1e9, d2 = 1e9, best = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + k) % k, jj = (cj + dj + k) % k, p = pts[jj * k + ii];
      const px = p[0] + (ci + di - ii) * cell, py = p[1] + (cj + dj - jj) * cell, d = Math.hypot((x - px) * 0.6, y - py);
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1, i4 = (y * n + x) * 4, joint = edge < 4.5;
    // each stone its own tone, darker to its edge (the split face rounds off)
    const col = pc[Math.floor(best[2] * pc.length)], f = (0.9 + ((best[2] * 7.3) % 1) * 0.18) * (0.9 + Math.min(edge, 14) / 14 * 0.1) + (rnd() - 0.5) * 0.07;
    const hv = joint ? 0.12 : Math.min(1, 0.42 + Math.sqrt(Math.min(edge, 22) / 22) * 0.45 + best[2] * 0.08 + (rnd() - 0.5) * 0.06);
    if (joint) { const j = 70 + rnd() * 20; img.data[i4] = j; img.data[i4 + 1] = j * 0.97; img.data[i4 + 2] = j * 0.92; }
    else { img.data[i4] = col.r * 255 * f; img.data[i4 + 1] = col.g * 255 * f; img.data[i4 + 2] = col.b * 255 * f; }
    img.data[i4 + 3] = 255; himg.data[i4] = himg.data[i4 + 1] = himg.data[i4 + 2] = hv * 255; himg.data[i4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); hg.putImageData(himg, 0, 0);
  // the split face: a few layers of the stone
  for (let i = 0; i < 2600; i++) { const x = rnd() * n, y = rnd() * n, v = rnd() < 0.5 ? 210 : 50; hg.fillStyle = `rgba(${v},${v},${v},0.22)`; hg.fillRect(x, y, 3 + rnd() * 12, 1 + rnd() * 2); }
  for (let i = 0; i < 9000; i++) { const v = rnd() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${0.04 + rnd() * 0.06})`; g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2); }
  bake(c, hc, 1.6, 0.55);
  return { map: asTex(c), normalMap: normalOf(hc, 7), roughness: 0.92 };
}
function brickTex(cols) {
  // clinker 240 × 71, joints 10 mm (recessed), the courses staggered by half; each brick its
  // own shade and a rough fired face, the edges eased
  const n = 512, sc = 0.512, L = 250 * sc, H = 81 * sc, j = 10 * sc, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  g.fillStyle = '#7d7a74'; g.fillRect(0, 0, n, n); h.fillStyle = '#202020'; h.fillRect(0, 0, n, n);
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`; g.fillRect(rnd() * n, rnd() * n, 1.5, 1.5); }
  for (let r = 0, y = 0; y < n; r++, y += H) for (let x = (r % 2) * L / 2 - L; x < n; x += L) {
    const col = shade(cols[Math.floor(rnd() * cols.length)], 0.8 + rnd() * 0.35), w = L - j, hh = H - j, up = 0.62 + rnd() * 0.1;
    g.fillStyle = col; g.fillRect(x, y, w, hh);
    // the eased edges: a ramp of 3 px round the face
    for (let e = 0; e < 4; e++) { const v = Math.round((0.3 + (up - 0.3) * (e + 1) / 4) * 255); h.fillStyle = `rgb(${v},${v},${v})`; h.fillRect(x + e, y + e, w - 2 * e, hh - 2 * e); }
    // the fired face: pits, darker flecks (the iron in the clay), a lighter skin here and there
    for (let i = 0; i < 70; i++) { const px = x + 4 + rnd() * (w - 8), py = y + 4 + rnd() * (hh - 8), v = Math.round((up - 0.08 + rnd() * 0.16) * 255); h.fillStyle = `rgb(${v},${v},${v})`; h.fillRect(px, py, 1 + rnd() * 3, 1 + rnd() * 2); }
    for (let i = 0; i < 45; i++) { g.fillStyle = `rgba(${rnd() < 0.7 ? '20,10,5' : '255,235,200'},${0.06 + rnd() * 0.14})`; g.fillRect(x + rnd() * w, y + rnd() * hh, 1 + rnd() * 3, 1 + rnd() * 2); }
    const sh = g.createLinearGradient(x, y, x, y + hh); sh.addColorStop(0, 'rgba(255,255,255,0.06)'); sh.addColorStop(1, 'rgba(0,0,0,0.1)'); g.fillStyle = sh; g.fillRect(x, y, w, hh);
  }
  bake(c, hc, 1.3, 0.6);
  return { map: asTex(c), normalMap: normalOf(hc, 6), roughness: 0.62 };
}
export function panelTex(key) {
  if (TEX[key]) return TEX[key];
  const [, kind, cols] = PANELS[key];
  return (TEX[key] = kind === 'wood' ? woodTex(cols) : kind === 'stone' ? stoneTex(cols) : brickTex(cols));
}

// a material for a finish: { kind: 'plaster', tex: 'bark'|'fur', col } | { kind: 'panel', key };
// the tile: 500 mm for the plaster, 1 m for the panels (the uv in mm)
export function facadeMat(f) {
  const t = f.kind === 'eps' ? epsTex() : f.kind === 'mesh' ? meshTex() : f.kind === 'plaster' ? plasterTex(f.tex, f.col) : panelTex(f.key);
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: t.roughness, metalness: 0 });
}
export const tileOf = (f) => (f.kind === 'eps' ? [1000, 500] : f.kind === 'panel' ? [1000, 1000] : [500, 500]);

// ---- the faces: the outside of each line of wall ----------------------------------------------
// A face: the outer plane of a line of masonry (its units' far side, away from the middle of
// the house), along it a (model, a = x·u), up it y; a point off the wall by `off` (model):
// W(a, y, off). The ends meet the faces round the corners at their planes; one of the two
// at a corner (the one along x) runs on past it by the thickness of what is on it, so the
// insulation and the coats wrap the corner. The openings are holes [a0, y0, a1, y1].
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const CELL = MM(50);   // the grid the coats are spread on (the spatula's dabs)
export const OFF = { eps: MM(100), glue: MM(103), loose: MM(106), emb: MM(105), wet: MM(108), fin: MM(108), pan: MM(120) };
export const LAYERS = [['eps', 'Утеплитель'], ['glue', 'Клей'], ['mesh', 'Сетка'], ['emb', 'Вдавить сетку'], ['pl', 'Штукатурка'], ['fl', 'Затирка'], ['pan', 'Панели']];

const across = (b, nx, nz) => Math.abs(b.hl * (b.ux * nx + b.uz * nz)) + Math.abs(b.hw * (-b.uz * nx + b.ux * nz));
export function facadeFaces(objects) {
  const app = { objects }, units = masonry(app);
  if (!units.length) return [];
  let cx = 0, cz = 0; for (const b of units) { cx += b.x; cz += b.z; } cx /= units.length; cz /= units.length;
  const lines = wallLines(units), opens = findOpenings(app), faces = [];
  for (const L of lines) {
    if (L.units.length < 3) continue;
    const nx = -L.uz, nz = L.ux;
    // which side is out: away from the middle of the masonry
    let a0 = Infinity, a1 = -Infinity, lo = Infinity, hi = -Infinity;
    for (const u of L.units) { a0 = Math.min(a0, u.a0); a1 = Math.max(a1, u.a1); const c = u.b.x * nx + u.b.z * nz, h = across(u.b, nx, nz); lo = Math.min(lo, c - h); hi = Math.max(hi, c + h); }
    // which side is out: the side with less masonry near it (the house is on the inside: its
    // other walls; a loose block or a trial wall elsewhere on the plot does not turn it), the
    // middle of all the masonry only when that does not tell
    const am = (a0 + a1) / 2, md = (lo + hi) / 2, mine0 = new Set(L.units.map((u) => u.b));
    let wp = 0, wn = 0;
    for (const b of units) {
      if (mine0.has(b)) continue;
      const al = b.x * L.ux + b.z * L.uz, c = b.x * nx + b.z * nz - md;
      if (al < a0 - MM(300) || al > a1 + MM(300) || Math.abs(c) < MM(200) || Math.abs(c) > MM(12000)) continue;
      const wgt = (b.hl + b.hw) / (1 + Math.abs(c) / MM(3000));
      if (c > 0) wp += wgt; else wn += wgt;
    }
    const sg = Math.abs(wp - wn) > 0.15 * (wp + wn) && wp + wn > 0 ? (wp < wn ? 1 : -1) : (L.ux * am + nx * md - cx) * nx + (L.uz * am + nz * md - cz) * nz >= 0 ? 1 : -1;
    // its tiers by their outer faces: a plinth standing out of the wall over it (or a wall
    // set back) is a face of its own — the wall's facade starts over the plinth
    const outer = (u) => { const c = u.b.x * nx + u.b.z * nz, h = across(u.b, nx, nz); return sg > 0 ? c + h : -(c - h); };
    const sorted = [...L.units].sort((p, q) => outer(p) - outer(q)), tiers = [];
    for (const u of sorted) { const f = outer(u), T = tiers.at(-1); if (T && f - T.f0 < MM(25)) { T.us.push(u); T.f = Math.max(T.f, f); } else tiers.push({ f, f0: f, us: [u] }); }   // (each tier within 25 mm: a few mm off by hand, not a plinth)
    const big = tiers.filter((T) => T.us.length >= 3);
    for (const T of big) {
      const mine = new Set(T.us.map((u) => u.b));
      let b0 = Infinity, b1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const u of T.us) { b0 = Math.min(b0, u.a0); b1 = Math.max(b1, u.a1); y0 = Math.min(y0, u.bot); y1 = Math.max(y1, u.top); }
      const P = sg > 0 ? T.f : -T.f;
      if (b1 - b0 < MM(400)) continue;   // (a column of bricks across a wall: no face)
      // the outside only: no masonry against it in front (another leaf, a wall built on to it)
      // over a good part of it — a loose block lying on the plot does not count
      const front = units.filter((b) => {
        if (mine.has(b)) return false;
        const c = b.x * nx + b.z * nz, h = across(b, nx, nz), a = b.x * L.ux + b.z * L.uz, ha = across(b, L.ux, L.uz);
        const near = sg > 0 ? c - h > P - MM(30) && c - h < P + MM(150) : c + h < P + MM(30) && c + h > P - MM(150);
        return near && a + ha > b0 + MM(50) && a - ha < b1 - MM(50) && Math.min(b.top, y1) - Math.max(b.bot, y0) > Math.min(MM(100), (b.top - b.bot) * 0.6);
      });
      const cover = front.reduce((sum, b) => sum + Math.min(b.top, y1) - Math.max(b.bot, y0), 0);
      if (front.length >= 3 && cover > (y1 - y0) * 0.5) continue;
      // a tier standing out under it: the wall's facade starts on a starter track over it
      const ledge = big.some((o) => o !== T && o.f > T.f + MM(10) && Math.max(...o.us.map((u) => u.top)) <= y0 + MM(30));
      const holes = opens.filter((o) => Math.abs(o.line.d - L.d) < 1e-9 && Math.abs(o.line.ux - L.ux) < 1e-9).map((o) => { const m = o.x * L.ux + o.z * L.uz, w = MM(o.w) / 2; return [m - w, o.y0, m + w, o.y1]; });
      faces.push({ ux: L.ux, uz: L.uz, nx, nz, sg, P, a0: b0, a1: b1, y0, y1, holes, hw: L.hw, wrap0: false, wrap1: false, ledge, ru: Math.sign(L.ux * sg * nz - L.uz * sg * nx) || 1 });
    }
  }
  // the corners: an end of a face meets an end of a face across it (a corner of the house —
  // not any wall the line of it crosses); the nearest such for each end, on the extents the
  // faces had before (the order they are met in does not matter)
  const orig = faces.map((F) => [F.a0, F.a1]);
  faces.forEach((F, fi) => {
    const best = [null, null];
    faces.forEach((G, gi) => {
      if (F === G) return;
      const k = G.nx * F.ux + G.nz * F.uz;   // (G's across = ± F's along)
      if (Math.abs(k) < 0.99) return;
      const aG = G.P * Math.sign(k), bF = F.P * Math.sign(F.nx * G.ux + F.nz * G.uz), [g0, g1] = orig[gi], [f0, f1] = orig[fi];
      if (Math.min(Math.abs(bF - g0), Math.abs(bF - g1)) > 2 * F.hw + MM(80)) return;   // (F's plane at an end of G)
      if (Math.min(G.y1, F.y1) - Math.max(G.y0, F.y0) < (F.y1 - F.y0) * 0.5) return;
      const out = G.sg * k;   // (G faces along +u of F: F's far end)
      const e = out > 0 ? 1 : 0, d = Math.abs(aG - (e ? f1 : f0));
      if (d < 2 * G.hw + MM(80) && (!best[e] || d < best[e].d)) best[e] = { d, aG };
    });
    const wrap = Math.abs(F.ux) >= Math.abs(F.uz);
    if (best[1]) { F.a1 = best[1].aG; F.wrap1 = wrap; }
    if (best[0]) { F.a0 = best[0].aG; F.wrap0 = wrap; }
  });
  // up the ring beam cast on the wall (its band over the top course) and the gables of the
  // roof (built with it, not of units): the face goes up to the gable's slopes — the part
  // over them a hole in 100 mm steps
  for (const F of faces) {
    for (const b of objects.all('belt')) {
      if (!(b.fill > 0.3) || b.lform || Math.abs(b.top - F.y1) > MM(40)) continue;
      const am = (F.a0 + F.a1) / 2, c = F.P - F.sg * F.hw, [x, z] = [F.ux * am + F.nx * c, F.uz * am + F.nz * c];
      if (beltContains(b, x, z)) F.y1 = Math.max(F.y1, b.top + b.H);
    }
    for (const r of objects.all('proof')) {
      if (!r.done?.plate || F.y1 < r.y0 - MM(60)) continue;   // (the wall under the roof, not a plinth)
      for (const pts of gableWalls(r)) {
        const q = pts.map(([x, y, z]) => [x * F.ux + z * F.uz, y, x * F.nx + z * F.nz]);
        if (q.some(([, , c]) => Math.abs(c - F.P) > MM(80))) continue;
        q.sort((p, o) => p[0] - o[0]);
        const topAt = (a) => { for (let i = 1; i < q.length; i++) if (a <= q[i][0]) { const t = (a - q[i - 1][0]) / Math.max(1e-9, q[i][0] - q[i - 1][0]); return q[i - 1][1] + (q[i][1] - q[i - 1][1]) * Math.max(0, Math.min(1, t)); } return q.at(-1)[1]; };
        const Y = Math.max(...q.map((p) => p[1])), st = MM(100);
        if (Y <= F.y1) continue;
        F.y1 = Y;
        for (let a = F.a0 - MM(200); a < F.a1 + MM(200); a += st) { const yt = Math.min(topAt(a), topAt(a + st)); if (yt < Y - MM(1)) F.holes.push([a, yt, a + st, Y + MM(10)]); }
        F.gable = true;
      }
    }
  }
  for (const F of faces) F.key = faceKey(F);
  return faces;
}
const faceKey = (F) => `${Math.round(Math.atan2(F.uz, F.ux) * 1000)}:${F.sg}:${Math.round(F.P / CELL)}:${Math.round(F.y0 / CELL)}`;
// the record of a face (by its plane: the walls may be re-laid)
export const recOf = (recs, F) => recs.find((r) => r.ux * F.ux + r.uz * F.uz > 0.999 && r.sg === F.sg && Math.abs(r.P - F.P) < MM(20) && (r.y0 == null || Math.abs(r.y0 - F.y0) < MM(150)));
export const W = (F, a, y, off) => { const c = F.P + F.sg * off; return [F.ux * a + F.nx * c, y, F.uz * a + F.nz * c]; };
// the face's extent at an offset (round the corner it wraps)
export const ext = (F, off) => [F.a0 - (F.wrap0 ? off : 0), F.y0, F.a1 + (F.wrap1 ? off : 0), F.y1];

// ---- rects and cells ----------------------------------------------------------------------------
export const inR = (r, a, y) => a >= r[0] && a <= r[2] && y >= r[1] && y <= r[3];
export function minus(rects, h) {
  const out = [];
  for (const r of rects) {
    if (h[0] >= r[2] || h[2] <= r[0] || h[1] >= r[3] || h[3] <= r[1]) { out.push(r); continue; }
    if (h[1] > r[1]) out.push([r[0], r[1], r[2], h[1]]);
    if (h[3] < r[3]) out.push([r[0], h[3], r[2], r[3]]);
    const y0 = Math.max(r[1], h[1]), y1 = Math.min(r[3], h[3]);
    if (h[0] > r[0]) out.push([r[0], y0, h[0], y1]);
    if (h[2] < r[2]) out.push([h[2], y0, r[2], y1]);
  }
  return out;
}
const clip = (r, e) => { const q = [Math.max(r[0], e[0]), Math.max(r[1], e[1]), Math.min(r[2], e[2]), Math.min(r[3], e[3])]; return q[2] - q[0] > 1e-7 && q[3] - q[1] > 1e-7 ? q : null; };
// a piece as it is on the wall: its rect cut to the face and round the openings
export function cutPiece(F, r, off) { const q = clip(r, ext(F, off)); if (!q) return []; let out = [q]; for (const h of F.holes) out = minus(out, h); return out; }
export const area = (rs) => rs.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0);
// the cells: a Set of keys; stored as runs [j, i0, i1] (i1 past the end)
export const ck = (i, j) => (j + 30000) * 60000 + (i + 30000);
export const cij = (k) => [(k % 60000) - 30000, Math.floor(k / 60000) - 30000];
const _dec = new WeakMap();
export function cellsOf(runs) {
  if (!runs?.length) return new Set();
  let s = _dec.get(runs); if (s) return s;
  s = new Set(); for (const [j, i0, i1] of runs) for (let i = i0; i < i1; i++) s.add(ck(i, j));
  _dec.set(runs, s); return s;
}
export function runsOf(set) {
  const rows = new Map();
  for (const k of set) { const [i, j] = cij(k); (rows.get(j) || rows.set(j, []).get(j)).push(i); }
  const out = [];
  for (const [j, is] of [...rows].sort((p, q) => p[0] - q[0])) { is.sort((p, q) => p - q); let s0 = is[0], prev = is[0]; for (const i of is.slice(1)) { if (i !== prev + 1) { out.push([j, s0, prev + 1]); s0 = i; } prev = i; } out.push([j, s0, prev + 1]); }
  return out;
}
// cells → rects (row runs, merged up while the same)
function cellRects(set) {
  const runs = runsOf(set), open = new Map(), out = [];
  let row = null;
  for (const [j, i0, i1] of runs) {
    if (j !== row) { for (const [k, r] of [...open]) if (r.j1 < j) { out.push(r); open.delete(k); } row = j; }
    const k = i0 + ':' + i1, r = open.get(k);
    if (r && r.j1 === j) r.j1 = j + 1; else { if (r) out.push(r); open.set(k, { i0, i1, j0: j, j1: j + 1 }); }
  }
  out.push(...open.values());
  return out.map((r) => [r.i0 * CELL, r.j0 * CELL, r.i1 * CELL, r.j1 * CELL]);
}
// the slots of the boards / the panels: from the corner and the bottom of the face, the
// insulation staggered by half a board
export function slotAt(F, a, y, kind) {
  const [L, H] = kind === 'pan' ? [1000, 500] : [FACADE.epsL, FACADE.epsW], e = ext(F, kind === 'pan' ? OFF.pan : OFF.eps);
  const row = Math.floor((y - e[1]) / MM(H)), off = kind === 'eps' && row % 2 ? MM(L / 2) : 0;
  // (counted from the left end as seen from outside)
  const fromLeft = F.ru > 0, base = fromLeft ? e[0] - off : e[2] + off, col = Math.floor((fromLeft ? a - base : base - a) / MM(L));
  const s0 = fromLeft ? base + col * MM(L) : base - (col + 1) * MM(L), t0 = e[1] + row * MM(H);
  return [s0, t0, s0 + MM(L), t0 + MM(H)].map((v) => +v.toFixed(6));
}
export const sameSlot = (p, q) => Math.abs(p[0] - q[0]) < MM(2) && Math.abs(p[1] - q[1]) < MM(2);

// ---- the model of a face ------------------------------------------------------------------------
class Geo {
  constructor() { this.p = []; this.uv = []; }
  // a quad P0..P3 (corners in turn) facing n, its uvs
  quad(P, U, n) {
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const o = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of o) { this.p.push(...P[k]); this.uv.push(...U[k]); }
  }
  mesh(mat) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
  }
}
const MATS = {};
function mat(key, make) { return MATS[key] || (MATS[key] = make()); }
function stdMat(t, extra = {}, po = 0) {
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: t.roughness ?? 0.9, metalness: 0, ...extra });
  if (po) { m.polygonOffset = true; m.polygonOffsetFactor = -po; m.polygonOffsetUnits = -2 * po; }
  return m;
}
// a sheet on the face over rects at `off`, the uv: (a, y) / the tile (mm), from an origin
function sheet(geo, F, rects, off, tile, o = [0, 0], rot = false) {
  const n = [F.sg * F.nx, 0, F.sg * F.nz];
  for (const r of rects) {
    const cs = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    geo.quad(cs.map(([a, y]) => W(F, a, y, off)), cs.map(([a, y]) => { const u = F.ru * (a - o[0]) / MM(tile[0]), v = (y - o[1]) / MM(tile[1]); return rot ? [v, -u] : [u, v]; }), n);
  }
}
// a board: the front at off1, the edges back to off0
function board(geo, F, rects, off0, off1, tile, o) {
  sheet(geo, F, rects, off1, tile, o);
  const u = [F.ux, 0, F.uz];
  for (const r of rects) {
    const e = (pts, n) => geo.quad(pts.map(([a, y, f]) => W(F, a, y, f)), [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], n);
    e([[r[0], r[1], off0], [r[2], r[1], off0], [r[2], r[1], off1], [r[0], r[1], off1]], [0, -1, 0]);
    e([[r[0], r[3], off0], [r[2], r[3], off0], [r[2], r[3], off1], [r[0], r[3], off1]], [0, 1, 0]);
    e([[r[0], r[1], off0], [r[0], r[3], off0], [r[0], r[3], off1], [r[0], r[1], off1]], u.map((v) => -v));
    e([[r[2], r[1], off0], [r[2], r[3], off0], [r[2], r[3], off1], [r[2], r[1], off1]], u);
  }
}
// cells cut to the face and the openings
function cellsCut(F, set, off) { let out = []; for (const r of cellRects(set)) out.push(...cutPiece(F, r, off)); return out; }
const DOWELS = [[100, 100], [900, 100], [500, 250], [100, 400], [900, 400]];

// rec: { eps, glue, mesh, emb, pl: {variant: runs}, fl: { v, h }, pan }; live (the hand):
// { layer, slot | rect | cells, variant, dir, tool: { kind, a, y } }
export function buildFacade(F, rec, live) {
  const group = new THREE.Group();
  const eps = [...(rec.eps || [])], mesh = [...(rec.mesh || [])], pan = [...(rec.pan || [])];
  const glue = new Set(cellsOf(rec.glue)), emb = new Set(cellsOf(rec.emb)), pl = {}, fl = { v: new Set(cellsOf(rec.fl?.v)), h: new Set(cellsOf(rec.fl?.h)) };
  for (const [k, runs] of Object.entries(rec.pl || {})) pl[k] = new Set(cellsOf(runs));
  let ghost = null;
  if (live) {
    if (live.layer === 'eps' && live.slot) ghost = { kind: 'eps', slot: live.slot, ok: live.ok };
    if (live.layer === 'pan' && live.slot) ghost = { kind: 'pan', slot: live.slot, ok: live.ok, key: live.key };
    if (live.layer === 'mesh' && live.rect) mesh.push(live.rect);
    const add = (set) => { for (const k of live.cells || []) set.add(k); };
    if (live.layer === 'glue') add(glue);
    if (live.layer === 'emb') add(emb);
    if (live.layer === 'pl') { for (const s of [...Object.values(pl), fl.v, fl.h]) for (const k of live.cells || []) s.delete(k); add(pl[live.variant] || (pl[live.variant] = new Set())); }
    if (live.layer === 'fl') { for (const k of live.cells || []) { fl.v.delete(k); fl.h.delete(k); } add(fl[live.dir || 'v']); }
  }
  // the insulation: the boards, the dowels (until the glue covers them)
  const ge = new Geo(), gd = [];
  for (const s of eps) {
    board(ge, F, cutPiece(F, s, OFF.eps), 0, OFF.eps, [FACADE.epsL, FACADE.epsW], F.ru > 0 ? [s[0], s[1]] : [s[2], s[1]]);
    for (const [da, dy] of DOWELS) {
      const a = F.ru > 0 ? s[0] + MM(da) : s[2] - MM(da), y = s[1] + MM(dy);
      if (!cutPiece(F, s, OFF.eps).some((r) => inR(r, a, y))) continue;
      if (glue.has(ck(Math.floor(a / CELL), Math.floor(y / CELL)))) continue;
      gd.push(W(F, a, y, OFF.eps + MM(2)));
    }
  }
  const add = (m) => { if (m) group.add(m); return m; };
  add(ge.mesh(mat('eps', () => stdMat(epsTex()))));
  // over a plinth standing out: the starter track (цокольный профиль) the first row of
  // boards stands in — its base under them, a lip up their face, a drip over the plinth
  if (F.ledge && eps.length) {
    const alu = mat('track', () => new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.8, roughness: 0.35 })), yaw = Math.atan2(-F.uz, F.ux), am = (F.a0 + F.a1) / 2, L = F.a1 - F.a0;
    for (const [y, h, o, d] of [[F.y0 + MM(1), MM(2), OFF.eps / 2, OFF.eps + MM(4)], [F.y0 + MM(15), MM(30), OFF.eps + MM(2), MM(2)], [F.y0 - MM(4), MM(8), OFF.eps + MM(5), MM(3)]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, d), alu); m.position.set(...W(F, am, y, o)); m.rotation.y = yaw; m.castShadow = true; group.add(m);
    }
  }
  if (gd.length) {
    const dm = new THREE.InstancedMesh(new THREE.CylinderGeometry(MM(30), MM(32), MM(4), 16), mat('dowel', () => new THREE.MeshStandardMaterial({ color: '#d8d8d2', roughness: 0.55 })), gd.length);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(F.sg * F.nx, 0, F.sg * F.nz)), m4 = new THREE.Matrix4();
    gd.forEach((p, i) => dm.setMatrixAt(i, m4.compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1))));
    dm.castShadow = true; group.add(dm);
  }
  // the glue; the mesh rolled out on it (loose: off the wall, sagging); pressed in
  const gg = new Geo(); sheet(gg, F, cellsCut(F, glue, OFF.glue), OFF.glue, [500, 500]); add(gg.mesh(mat('glue', () => stdMat(glueTex(), {}, 1))));
  const embIn = new Set([...emb].filter((k) => glue.has(k)));
  const gl = new Geo();
  for (const r of mesh) for (const q of cutPiece(F, r, OFF.loose)) {
    // in strips of 100 mm, each off the wall by its sag; the pressed-in cells under it skipped
    const st = MM(100);
    for (let y = q[1]; y < q[3] - 1e-7; y += st) for (let a = q[0]; a < q[2] - 1e-7; a += st) {
      const c = [a, y, Math.min(a + st, q[2]), Math.min(y + st, q[3])], mid = ck(Math.floor((c[0] + c[2]) / 2 / CELL), Math.floor((c[1] + c[3]) / 2 / CELL));
      if (embIn.has(mid)) continue;
      const sag = MM(2.5 + 2.5 * Math.sin(a / MM(370) + y / MM(530)) * Math.cos(y / MM(290)));
      sheet(gl, F, [c], OFF.loose + sag, [500, 500], [r[0], r[1]]);
    }
  }
  add(gl.mesh(mat('loose', () => { const m = new THREE.MeshStandardMaterial({ map: looseMeshTex().map, transparent: true, alphaTest: 0.3, roughness: 0.7, side: THREE.DoubleSide }); return m; })));
  const meshCells = new Set([...embIn].filter((k) => { const [i, j] = cij(k), a = (i + 0.5) * CELL, y = (j + 0.5) * CELL; return mesh.some((r) => inR(r, a, y)); }));
  const gm = new Geo(); sheet(gm, F, cellsCut(F, meshCells, OFF.emb), OFF.emb, [500, 500]); add(gm.mesh(mat('emb', () => stdMat(meshTex(), {}, 2))));
  // the plaster: wet (smooth, the colour) → floated (its texture, the way the float went)
  for (const [variant, set] of Object.entries(pl)) {
    const [tex, col] = variant.split(':');
    const wet = new Set([...set].filter((k) => !fl.v.has(k) && !fl.h.has(k)));
    const gw = new Geo(); sheet(gw, F, cellsCut(F, wet, OFF.wet), OFF.wet, [500, 500]); add(gw.mesh(mat('wet' + col, () => stdMat(wetTex(col), {}, 3))));
    for (const dir of ['v', 'h']) {
      const done = new Set([...set].filter((k) => fl[dir].has(k)));
      const gf = new Geo(); sheet(gf, F, cellsCut(F, done, OFF.fin), OFF.fin, [500, 500], [0, 0], dir === 'h'); add(gf.mesh(mat('fin' + variant, () => stdMat(plasterTex(tex, col), {}, 3))));
    }
  }
  // the panels
  const byKey = {};
  for (const p of pan) (byKey[p[4]] || (byKey[p[4]] = [])).push(p);
  if (ghost?.kind === 'pan' && ghost.ok) (byKey[ghost.key] || (byKey[ghost.key] = [])).push([...ghost.slot, ghost.key]);
  for (const [key, ps] of Object.entries(byKey)) {
    const gp = new Geo();
    for (const p of ps) board(gp, F, cutPiece(F, p, OFF.pan).map((r) => [r[0] + MM(1), r[1] + MM(1), r[2] - MM(1), r[3] - MM(1)]), OFF.eps, OFF.pan, [1000, 1000], [0, 0]);
    add(gp.mesh(mat('pan' + key, () => stdMat(panelTex(key)))));
  }
  // the board in the hand: where it goes (green / red)
  if (ghost?.kind === 'eps' || (ghost?.kind === 'pan' && !ghost.ok)) {
    const gh = new Geo(), o0 = ghost.kind === 'eps' ? 0 : OFF.eps, o1 = ghost.kind === 'eps' ? OFF.eps : OFF.pan;
    board(gh, F, cutPiece(F, ghost.slot, o1), o0 + MM(1), o1 + MM(1), [FACADE.epsL, FACADE.epsW], F.ru > 0 ? [ghost.slot[0], ghost.slot[1]] : [ghost.slot[2], ghost.slot[1]]);
    const m = gh.mesh(ghost.ok && ghost.kind === 'eps' ? mat('epsGhost', () => stdMat(epsTex(), { emissive: 0x1d6b33, emissiveIntensity: 0.35 })) : mat('ghostRed', () => new THREE.MeshBasicMaterial({ color: 0xd04040, transparent: true, opacity: 0.5, depthWrite: false })));
    if (m) { m.castShadow = false; m.userData.noPick = true; group.add(m); }
  }
  // the tool in the hand: the spatula, the float, the roll
  if (live?.tool) group.add(toolMesh(F, live));
  return group;
}

// the spatula (a steel blade 350 mm), the float (a plastic plate 280 × 140), the roll of mesh
function toolMesh(F, live) {
  const { kind, a, y } = live.tool, g = new THREE.Group();
  const n = new THREE.Vector3(F.sg * F.nx, 0, F.sg * F.nz), u = new THREE.Vector3(F.ux * F.sg, 0, F.uz * F.sg), up = new THREE.Vector3(0, 1, 0);
  g.matrixAutoUpdate = false;
  const steel = mat('steel', () => new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 0.9, roughness: 0.3 }));
  const grip = mat('grip', () => new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6 }));
  const yellow = mat('grip2', () => new THREE.MeshStandardMaterial({ color: 0xe6b422, roughness: 0.5 }));
  if (kind === 'spatula') {
    // the blade flat on the wall, tilted 25° off it, the handle along its back
    const blade = new THREE.Mesh(new THREE.BoxGeometry(MM(350), MM(110), MM(1.2)), steel); blade.position.set(0, MM(40), MM(25)); blade.rotation.x = -0.45;
    const back = new THREE.Mesh(new THREE.BoxGeometry(MM(350), MM(18), MM(8)), grip); back.position.set(0, MM(90), MM(48)); back.rotation.x = -0.45;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(MM(14), MM(16), MM(130), 12), yellow); handle.position.set(0, MM(150), MM(80)); handle.rotation.x = -0.45;
    g.add(blade, back, handle);
  } else if (kind === 'float') {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(MM(280), MM(140), MM(10)), mat('pvc', () => new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.4 }))); plate.position.z = MM(6);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(MM(200), MM(30), MM(35)), yellow); handle.position.z = MM(35);
    g.add(plate, handle);
  } else if (kind === 'roll' && live.rect) {
    const r = live.rect, vert = live.vert, len = vert ? r[2] - r[0] : r[3] - r[1];
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(MM(45), MM(45), len, 20), mat('rollMat', () => new THREE.MeshStandardMaterial({ map: looseMeshTex().map, color: 0xffffff, roughness: 0.7, transparent: true, alphaTest: 0.2 })));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(MM(25), MM(25), len, 12), mat('core', () => new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.8 })));
    if (vert) roll.rotation.z = core.rotation.z = Math.PI / 2;
    roll.position.z = core.position.z = MM(45); g.add(roll, core);
  }
  const off = kind === 'roll' ? OFF.loose : live.layer === 'glue' ? OFF.glue : live.layer === 'emb' ? OFF.emb : OFF.wet;
  const ta = kind === 'roll' && live.rect ? (live.vert ? (live.rect[0] + live.rect[2]) / 2 : live.end) : a, ty = kind === 'roll' && live.rect ? (live.vert ? live.end : (live.rect[1] + live.rect[3]) / 2) : y;
  g.matrix.makeBasis(u, up, n).setPosition(...W(F, ta, ty, off));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.noPick = true; } });
  return g;
}
