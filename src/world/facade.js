import * as THREE from 'three';
import { canvas, asTex, normalOf } from './roof.js';

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
export const PANELS = {
  oak: ['Планкен — светлый дуб', 'wood', ['#b98a58', '#8c6038']], walnut: ['Планкен — термо-орех', 'wood', ['#6b4429', '#43281a']],
  sandstone: ['Камень — песчаник', 'stone', ['#cdb894', '#b9a37c', '#d9c8a6', '#a99372']], slate: ['Камень — сланец', 'stone', ['#73777a', '#5c6063', '#878a8c', '#6a675f']],
  clinker: ['Клинкер — красный', 'brick', ['#9c4a33', '#7c3626', '#b35d40']],
};

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

// ---- the base coat with the mesh (a 500 mm tile): grey glue, the 5 mm mesh showing through -----
export function meshTex() {
  if (TEX.mesh) return TEX.mesh;
  const n = 512, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  g.fillStyle = '#a9aaa4'; g.fillRect(0, 0, n, n); h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  // the trowel's sweeps
  for (let i = 0; i < 60; i++) { const x = rnd() * n, y = rnd() * n, r = 30 + rnd() * 70; blob(h, n, x, y, r, rnd() < 0.5 ? 150 : 100, 0.35); blob(g, n, x, y, r, rnd() < 0.5 ? 200 : 120, 0.08); }
  // the mesh: 5 mm (5 px), the strands a little wavy
  const st = 512 / 100;
  for (let k = 0; k < 100; k++) for (const dir of [0, 1]) {
    const p = k * st + (rnd() - 0.5);
    g.strokeStyle = `rgba(214,120,60,${0.22 + rnd() * 0.1})`; g.lineWidth = 1.1; h.strokeStyle = 'rgba(170,170,170,0.8)'; h.lineWidth = 1;
    for (const ctx of [g, h]) { ctx.beginPath(); if (dir) { ctx.moveTo(p, 0); ctx.lineTo(p + (rnd() - 0.5), n); } else { ctx.moveTo(0, p); ctx.lineTo(n, p + (rnd() - 0.5)); } ctx.stroke(); }
  }
  return (TEX.mesh = { map: asTex(c), normalMap: normalOf(hc, 1.5), roughness: 0.95 });
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
  g.globalAlpha = kind === 'bark' ? 0.45 : 0.3; g.globalCompositeOperation = 'multiply'; g.drawImage(hc, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  for (let i = 0; i < 4000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'; g.fillRect(rnd() * n, rnd() * n, 1.2, 1.2); }
  return (TEX[key] = { map: asTex(c), normalMap: normalOf(hc, kind === 'bark' ? 6 : 5), roughness: 0.97 });
}

// ---- the panels (a 1 m tile) ----------------------------------------------------------------
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
  return { map: asTex(c), normalMap: normalOf(hc, 3), roughness: 0.75 };
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
    const hv = joint ? 0.2 : Math.min(1, 0.5 + Math.min(edge, 14) / 14 * 0.3 + (rnd() - 0.5) * 0.08);
    if (joint) { const j = 95 + rnd() * 20; img.data[i4] = j; img.data[i4 + 1] = j * 0.97; img.data[i4 + 2] = j * 0.92; }
    else { img.data[i4] = col.r * 255 * f; img.data[i4 + 1] = col.g * 255 * f; img.data[i4 + 2] = col.b * 255 * f; }
    img.data[i4 + 3] = 255; himg.data[i4] = himg.data[i4 + 1] = himg.data[i4 + 2] = hv * 255; himg.data[i4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); hg.putImageData(himg, 0, 0);
  // the split face: a few layers of the stone
  for (let i = 0; i < 1400; i++) { const x = rnd() * n, y = rnd() * n; hg.fillStyle = `rgba(${rnd() < 0.5 ? 200 : 60},0,0,0.25)`; hg.fillRect(x, y, 3 + rnd() * 10, 1.5); }
  return { map: asTex(c), normalMap: normalOf(hc, 2.5), roughness: 0.9 };
}
function brickTex(cols) {
  // clinker 240 × 71, joints 10 mm, the courses staggered by half
  const n = 512, sc = 0.512, L = 250 * sc, H = 81 * sc, c = canvas(n), g = c.getContext('2d'), hc = canvas(n), h = hc.getContext('2d');
  g.fillStyle = '#8d8a84'; g.fillRect(0, 0, n, n); h.fillStyle = '#404040'; h.fillRect(0, 0, n, n);
  for (let r = 0, y = 0; y < n; r++, y += H) for (let x = (r % 2) * L / 2 - L; x < n; x += L) {
    const col = shade(cols[Math.floor(rnd() * cols.length)], 0.85 + rnd() * 0.3);
    g.fillStyle = col; g.fillRect(x, y, L - 10 * sc, H - 10 * sc); h.fillStyle = '#9a9a9a'; h.fillRect(x, y, L - 10 * sc, H - 10 * sc);
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; g.fillRect(x + rnd() * L * 0.9, y + rnd() * H * 0.8, 2, 2); }
  }
  return { map: asTex(c), normalMap: normalOf(hc, 2.5), roughness: 0.7 };
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
