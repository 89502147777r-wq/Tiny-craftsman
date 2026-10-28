import * as THREE from 'three';

// The paper on the walls and the pictures on them, drawn on the spot (no files to fetch, never the
// same twice): wallpapers — stripes, a herringbone, a geometric print, leaves, dots, arches; for a
// child — stars and moons, clouds, mountains, little animals; pictures — colour fields, a Bauhaus
// composition, lines, a landscape at sunset, a botanical, an arch; for a child — a rainbow, a whale,
// a balloon. Each from the dice and the room's colours.
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const hex = (c) => '#' + new THREE.Color(c).getHexString();
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texOf(c, rep) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

export const PAPERS = ['stripes', 'herring', 'geo', 'leaves', 'dots', 'arches', 'linen'];
export const KID_PAPERS = ['stars', 'clouds', 'mountains', 'animals', 'dots', 'stripes'];

// a tile of wallpaper (512 px for 0.5 m of wall): pattern, the ground colour, the print's colours
export function wallpaper(kind, ground, inks, s = 1) {
  seed = 1 + (s % 2147483646);
  const [c, g] = canvas(512, 512), I = inks.map(hex);
  g.fillStyle = hex(ground); g.fillRect(0, 0, 512, 512);
  if (kind === 'stripes') {
    const n = pick([8, 12, 16]), w = 512 / n;
    for (let i = 0; i < n; i += 2) { g.fillStyle = I[0]; g.globalAlpha = 0.55; g.fillRect(i * w, 0, w * (0.4 + rnd() * 0.5), 512); }
    g.globalAlpha = 0.35; g.fillStyle = I[1] || I[0]; for (let i = 1; i < n; i += 2) g.fillRect(i * w + w * 0.45, 0, 3, 512);
  } else if (kind === 'herring') {
    g.strokeStyle = I[0]; g.lineWidth = 3; g.globalAlpha = 0.5;
    for (let y = -64; y < 576; y += 32) for (let x = 0; x < 512; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 32, y + 32); g.lineTo(x + 64, y); g.stroke(); }
  } else if (kind === 'geo') {
    const n = 8, w = 64;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      g.fillStyle = I[(i + j) % I.length]; g.globalAlpha = 0.75; g.beginPath();
      const x = i * w, y = j * w, k = (i * 7 + j * 3) % 4;
      if (k === 0) { g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x, y + w); }
      else if (k === 1) { g.arc(x, y + w, w, -Math.PI / 2, 0); g.lineTo(x, y + w); }
      else if (k === 2) { g.moveTo(x + w, y + w); g.lineTo(x + w, y); g.lineTo(x, y + w); }
      else { g.arc(x + w, y, w, Math.PI / 2, Math.PI); g.lineTo(x + w, y); }
      g.fill();
    }
  } else if (kind === 'leaves') {
    g.globalAlpha = 0.8;
    for (let k = 0; k < 26; k++) {
      const x = rnd() * 512, y = rnd() * 512, a = rnd() * Math.PI * 2, L = 50 + rnd() * 50;
      for (const [dx, dy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
        g.save(); g.translate(x + dx, y + dy); g.rotate(a); g.fillStyle = pick(I);
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.5, -L * 0.35, L, 0); g.quadraticCurveTo(L * 0.5, L * 0.35, 0, 0); g.fill();
        g.strokeStyle = hex(ground); g.lineWidth = 1.5; g.beginPath(); g.moveTo(2, 0); g.lineTo(L - 4, 0); g.stroke(); g.restore();
      }
    }
  } else if (kind === 'dots') {
    const step = pick([32, 48, 64]), r = step * (0.12 + rnd() * 0.1);
    for (let y = 0; y < 512; y += step) for (let x = 0; x < 512; x += step) { g.fillStyle = I[((x + y) / step) % I.length | 0]; g.globalAlpha = 0.7; g.beginPath(); g.arc(x + ((y / step) % 2 ? step / 2 : 0), y, r, 0, 7); g.fill(); }
  } else if (kind === 'arches') {
    g.lineWidth = 6; g.globalAlpha = 0.6;
    for (let y = 0; y < 576; y += 128) for (let x = 0; x < 576; x += 128) for (let k = 0; k < 3; k++) { g.strokeStyle = I[k % I.length]; g.beginPath(); g.arc(x + ((y / 128) % 2 ? 64 : 0), y + 64, 56 - k * 16, Math.PI, 0); g.stroke(); }
  } else if (kind === 'linen') {
    g.globalAlpha = 0.08; for (let i = 0; i < 512; i += 2) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(i, 0, 1, 512); g.fillRect(0, i, 512, 1); }
  } else if (kind === 'stars') {
    for (let k = 0; k < 40; k++) {
      const x = rnd() * 512, y = rnd() * 512, r = 6 + rnd() * 14; g.fillStyle = pick(I); g.globalAlpha = 0.9;
      if (rnd() < 0.15) { g.beginPath(); g.arc(x, y, r * 1.4, 0, 7); g.fill(); g.fillStyle = hex(ground); g.beginPath(); g.arc(x + r * 0.6, y - r * 0.3, r * 1.2, 0, 7); g.fill(); continue; }
      g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } g.fill();
    }
  } else if (kind === 'clouds') {
    for (let k = 0; k < 9; k++) { const x = rnd() * 512, y = rnd() * 512, r = 18 + rnd() * 16; g.fillStyle = pick(I); g.globalAlpha = 0.85; for (const [dx, dy, q] of [[0, 0, 1], [r, -r * 0.4, 1.2], [r * 2.1, 0, 0.9], [r, r * 0.25, 1]]) { g.beginPath(); g.arc(x + dx, y + dy, r * q, 0, 7); g.fill(); } }
  } else if (kind === 'mountains') {
    for (let row = 0; row < 4; row++) { const y = 128 * row + 120; g.fillStyle = I[row % I.length]; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 512; x += 64) g.lineTo(x + 32, y - 40 - ((x / 64 + row) % 3) * 18), g.lineTo(x + 64, y); g.lineTo(512, y); g.fill(); g.fillStyle = '#fff'; g.globalAlpha = 0.7; }
  } else if (kind === 'animals') {
    // little bears' faces and bunnies in rows
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * 128 + (j % 2 ? 64 : 0) + 32, y = j * 128 + 64, col = I[(i + j) % I.length]; g.fillStyle = col; g.globalAlpha = 0.85;
      if ((i + j) % 2) { g.beginPath(); g.arc(x, y, 22, 0, 7); g.fill(); for (const s of [-1, 1]) { g.beginPath(); g.arc(x + s * 18, y - 18, 9, 0, 7); g.fill(); } }
      else { g.beginPath(); g.ellipse(x, y + 4, 18, 16, 0, 0, 7); g.fill(); for (const s of [-1, 1]) { g.beginPath(); g.ellipse(x + s * 8, y - 22, 6, 16, s * 0.2, 0, 7); g.fill(); } }
      g.fillStyle = '#3a3a3a'; g.globalAlpha = 0.8; for (const s of [-1, 1]) { g.beginPath(); g.arc(x + s * 7, y - 2, 2.5, 0, 7); g.fill(); }
    }
  }
  g.globalAlpha = 1;
  return texOf(c, true);
}

export const ARTS = ['fields', 'bauhaus', 'lines', 'sunset', 'botanic', 'arch', 'blobs'];
export const KID_ARTS = ['rainbow', 'whale', 'balloon', 'bauhaus'];

// a picture (w × h px), from the room's colours
export function artwork(kind, colours, s = 1, w = 256, h = 320) {
  seed = 7 + (s % 2147483646);
  const [c, g] = canvas(w, h), C = colours.map(hex), bg = rnd() < 0.5 ? '#f3efe7' : pick(['#e9e1d3', '#ddd6cb', '#1f2328', '#f6f3ee']);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (kind === 'fields') {
    let y = 0; for (let k = 0; k < 3; k++) { const hh = h * (0.2 + rnd() * 0.25); g.fillStyle = C[k % C.length]; g.globalAlpha = 0.85; g.fillRect(w * 0.1, h * 0.08 + y, w * 0.8, Math.min(hh, h * 0.84 - y)); y += hh + 6; }
  } else if (kind === 'bauhaus') {
    for (let k = 0; k < 5; k++) { g.fillStyle = C[k % C.length]; const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * w * 0.3; g.beginPath(); if (k % 3 === 0) g.arc(x, y, r, 0, 7); else if (k % 3 === 1) g.fillRect(x - r / 2, y - r / 2, r, r * 1.4); else { g.moveTo(x, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); } g.fill(); }
  } else if (kind === 'lines') {
    g.strokeStyle = C[0]; g.lineWidth = 3; g.beginPath(); let x = w * 0.2, y = h * 0.3; g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { const nx = w * (0.15 + rnd() * 0.7), ny = h * (0.15 + rnd() * 0.7); g.bezierCurveTo(x + 60, y - 40, nx - 40, ny + 60, nx, ny); x = nx; y = ny; } g.stroke();
    g.fillStyle = C[1] || C[0]; g.beginPath(); g.arc(w * (0.3 + rnd() * 0.4), h * (0.3 + rnd() * 0.4), 18, 0, 7); g.fill();
  } else if (kind === 'sunset') {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, C[0]); gr.addColorStop(1, C[1] || '#f2c9a0'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff4e0'; g.globalAlpha = 0.9; g.beginPath(); g.arc(w * 0.5, h * 0.55, w * 0.18, 0, 7); g.fill(); g.globalAlpha = 1;
    for (let k = 0; k < 3; k++) { g.fillStyle = C[(k + 2) % C.length]; g.globalAlpha = 0.6 + k * 0.15; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += w / 6) g.lineTo(x, h * (0.6 + k * 0.1) - rnd() * h * 0.12); g.lineTo(w, h); g.fill(); }
  } else if (kind === 'botanic') {
    g.strokeStyle = C[0]; g.fillStyle = C[0]; g.lineWidth = 3; const x0 = w / 2; g.beginPath(); g.moveTo(x0, h * 0.9); g.quadraticCurveTo(x0 + 20, h * 0.5, x0 - 10, h * 0.12); g.stroke();
    for (let k = 0; k < 9; k++) { const t = 0.2 + k * 0.08, y = h * (0.9 - t * 0.85), s = k % 2 ? 1 : -1, L = 50 - k * 3; g.save(); g.translate(x0 + 5, y); g.rotate(s * (0.7 + rnd() * 0.3)); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L / 2, -L / 3, L, 0); g.quadraticCurveTo(L / 2, L / 3, 0, 0); g.fill(); g.restore(); }
  } else if (kind === 'arch') {
    g.fillStyle = C[0]; g.beginPath(); g.moveTo(w * 0.22, h * 0.85); g.lineTo(w * 0.22, h * 0.45); g.arc(w * 0.5, h * 0.45, w * 0.28, Math.PI, 0); g.lineTo(w * 0.78, h * 0.85); g.fill();
    g.fillStyle = C[1] || C[0]; g.beginPath(); g.arc(w * 0.62, h * 0.3, w * 0.09, 0, 7); g.fill();
  } else if (kind === 'blobs') {
    for (let k = 0; k < 4; k++) { g.fillStyle = C[k % C.length]; g.globalAlpha = 0.85; g.beginPath(); const x = w * (0.2 + rnd() * 0.6), y = h * (0.2 + rnd() * 0.6), r = w * (0.12 + rnd() * 0.15); for (let a = 0; a <= 6.3; a += 0.5) { const q = r * (0.8 + rnd() * 0.4); g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } g.fill(); }
  } else if (kind === 'rainbow') {
    const cols = ['#e8a598', '#f2c48d', '#f5e1a4', '#a8d5ba', '#9cc3e4']; g.lineWidth = 16;
    cols.forEach((cc, k) => { g.strokeStyle = cc; g.beginPath(); g.arc(w / 2, h * 0.7, w * 0.38 - k * 16, Math.PI, 0); g.stroke(); });
  } else if (kind === 'whale') {
    g.fillStyle = '#cfe6f2'; g.fillRect(0, h * 0.6, w, h * 0.4); g.fillStyle = C[0]; g.beginPath(); g.ellipse(w / 2, h * 0.55, w * 0.3, h * 0.13, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(w * 0.78, h * 0.55); g.lineTo(w * 0.92, h * 0.42); g.lineTo(w * 0.9, h * 0.62); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(w * 0.32, h * 0.52, 4, 0, 7); g.fill();
  } else if (kind === 'balloon') {
    g.fillStyle = C[0]; g.beginPath(); g.ellipse(w / 2, h * 0.35, w * 0.2, h * 0.17, 0, 0, 7); g.fill(); g.strokeStyle = '#555'; g.lineWidth = 1.5; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2 + s * w * 0.12, h * 0.48); g.lineTo(w / 2 + s * 14, h * 0.66); g.stroke(); }
    g.fillStyle = '#a0784e'; g.fillRect(w / 2 - 16, h * 0.66, 32, 22);
  }
  g.globalAlpha = 1;
  return texOf(c, false);
}
