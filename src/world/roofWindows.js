import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';

// The windows in the roof, modelled after the real ones: the flashing collar with its pleated
// apron over the covering, the frame and the sash in their aluminium cladding (bevelled edges),
// the rubber seals, the glazing unit with its spacer, the vent flap, the hinges, the white lining
// inside. Built in a local frame: x across the slope, y up the slope, z out of the roof (0 is
// the top of the covering); sizes in real millimetres.
const MM = (v) => v / 1000 / MODEL_SCALE;

export const RWIN_TYPES = {
  pivot: ['Среднеповоротное', 'Ось посередине створки, сверху клапан проветривания'],
  top: ['Панорамное', 'Верхнеподвесное: открывается наружу вверх, ручка снизу'],
  twin: ['Двойное', 'Две створки рядом в одном окладе, между ними стропило'],
  hatch: ['Люк-выход', 'Створка на боковых петлях — выход на крышу'],
  dome: ['Зенитный купол', 'Акриловый купол на стакане — только плоская кровля'],
};
export const RWIN_GAP = 100;   // twin: between the two sashes (over the rafter)
// the size the window takes in the covering (mm): [width, height]
export function rwinSpan(type, Wm, Hm) { return type === 'twin' ? [2 * Wm + RWIN_GAP, Hm] : [Wm, Hm]; }

const MATS = {};
const mat = (k, make) => MATS[k] || (MATS[k] = make());
function brushed() {
  return mat('brushTex', () => {
    const n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n; const g = cv.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) { const v = 100 + Math.random() * 56; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, Math.random() * n, n, Math.random() < 0.8 ? 1 : 2); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  });
}
const M = {
  clad: (hex) => mat('clad' + hex, () => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.55, roughness: 0.38, roughnessMap: brushed(), envMapIntensity: 1.2 })),
  rubber: () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.75 })),
  spacer: () => mat('spacer', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.6, roughness: 0.4 })),
  glass: () => mat('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x3e4c55, metalness: 0.65, roughness: 0.03, transparent: true, opacity: 0.8, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false })),
  lining: () => mat('lining', () => new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.45 })),
  pine: () => mat('pine', () => new THREE.MeshStandardMaterial({ color: 0xd9b27c, roughness: 0.55 })),
  apron: (hex) => mat('apron' + hex, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.6), metalness: 0.05, roughness: 0.75, side: THREE.DoubleSide })),
  grille: () => mat('grille', () => new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.9 })),
  kerb: () => mat('kerbM', () => new THREE.MeshStandardMaterial({ color: 0x3c3f42, roughness: 0.85 })),
  dome: () => mat('dome', () => new THREE.MeshPhysicalMaterial({ color: 0xb9d3dd, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.8, side: THREE.DoubleSide, depthWrite: false })),
};

// a rounded rectangle (mm) as a path
function rrect(p, x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  p.moveTo(MM(x0 + r), MM(y0)); p.lineTo(MM(x1 - r), MM(y0)); p.quadraticCurveTo(MM(x1), MM(y0), MM(x1), MM(y0 + r));
  p.lineTo(MM(x1), MM(y1 - r)); p.quadraticCurveTo(MM(x1), MM(y1), MM(x1 - r), MM(y1));
  p.lineTo(MM(x0 + r), MM(y1)); p.quadraticCurveTo(MM(x0), MM(y1), MM(x0), MM(y1 - r));
  p.lineTo(MM(x0), MM(y0 + r)); p.quadraticCurveTo(MM(x0), MM(y0), MM(x0 + r), MM(y0));
  return p;
}
// a bevelled block or ring: outer [x0,y0,x1,y1], the hole inside (or none), z from z0 to z1
function block(o, hole, z0, z1, bev = 4, r = 6) {
  bev = Math.min(bev, (z1 - z0) / 2.5);
  const s = rrect(new THREE.Shape(), o[0] + bev, o[1] + bev, o[2] - bev, o[3] - bev, r);
  if (hole) s.holes.push(rrect(new THREE.Path(), hole[0] - bev, hole[1] - bev, hole[2] + bev, hole[3] + bev, Math.max(1, r - 3)));
  const g = new THREE.ExtrudeGeometry(s, { depth: MM(z1 - z0 - 2 * bev), bevelEnabled: true, bevelThickness: MM(bev), bevelSize: MM(bev), bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, MM(z0 + bev));
  return g;
}
const ring = (w, h, side, z0, z1, bev, r, cx = 0, cy = 0, sides = null) => {
  const [l, b, rr, t] = sides || [side, side, side, side];
  return block([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], [cx - w / 2 + l, cy - h / 2 + b, cx + w / 2 - rr, cy + h / 2 - t], z0, z1, bev, r);
};
const box = (x0, y0, z0, x1, y1, z1) => { const g = new THREE.BoxGeometry(MM(x1 - x0), MM(y1 - y0), MM(z1 - z0)); g.translate(MM((x0 + x1) / 2), MM((y0 + y1) / 2), MM((z0 + z1) / 2)); return g; };
const cyl = (r, L, x, y, z, axis = 'x') => { const g = new THREE.CylinderGeometry(MM(r), MM(r), MM(L), 12); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(MM(x), MM(y), MM(z)); return g; };

// the pleated apron under the window: lead-like, folded in waves, lying on the covering
function apron(w, y0, depth, z0, drop = 0) {
  const nx = Math.ceil(w / 8), ny = 6, g = new THREE.PlaneGeometry(MM(w), MM(depth), nx, ny), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / MM(1), y = p.getY(i) / MM(1), f = 0.5 - y / depth;   // 0 at the window, 1 at the lower edge
    p.setZ(i, MM(z0 * (1 - f) - drop * 0.45 * f + 3 + Math.sin(x / 34 * Math.PI * 2) * 7 * Math.min(1, f * 2.5)));
  }
  g.translate(0, MM(y0 - depth / 2), 0); g.computeVertexNormals();
  return g;
}

// one sash in its frame, the centre at cx (mm); type decides the details
function unit(parts, type, w, h, cx) {
  const top = type !== 'top' && type !== 'hatch';
  // the frame: its cladding 70 high, 50 wide; the sash over it, 34 high; the seal between
  parts.clad.push(ring(w, h, 50, 0, 70, 5, 8, cx));
  parts.rubber.push(ring(w - 76, h - 76, 10, 66, 74, 1, 4, cx));
  const sw = w - 70, sh = h - (top ? 160 : 90), sy = top ? -45 : 0, side = type === 'top' ? 52 : 60;
  parts.clad.push(ring(sw, sh, side, 72, 106, 6, 10, cx, sy, [side, type === 'top' ? 90 : side, side, side]));
  // the glazing unit: the spacer frame and the glass a little under the top of the sash
  const gw = sw - 2 * side + 16, gh = sh - side - (type === 'top' ? 90 : side) + 16, gy = sy + (type === 'top' ? 19 : 0);
  parts.spacer.push(ring(gw, gh, 14, 88, 96, 1, 3, cx, gy));
  parts.glass.push(box(cx - gw / 2 + 2, gy - gh / 2 + 2, 96, cx + gw / 2 - 2, gy + gh / 2 - 2, 98));
  parts.rubber.push(ring(gw + 6, gh + 6, 8, 98, 102, 1, 3, cx, gy));
  // the white lining inside, down into the roof (the reveal), and the pine sash seen from inside
  parts.lining.push(ring(w + 30, h + 30, 30, -260, -10, 2, 2, cx));
  parts.pine.push(ring(w - 90, h - 90, 46, 20, 64, 2, 3, cx));
  if (top) {
    // the head cover with the vent flap: the slot of the grille along the front
    parts.clad.push(block([cx - w / 2 - 6, h / 2 - 125, cx + w / 2 + 6, h / 2 + 8], null, 60, 112, 8, 12));
    parts.grille.push(box(cx - w / 2 + 40, h / 2 - 128, 78, cx + w / 2 - 40, h / 2 - 121, 100));
    for (let x = -w / 2 + 70; x < w / 2 - 60; x += 46) parts.clad.push(box(cx + x, h / 2 - 129, 76, cx + x + 6, h / 2 - 120, 102));
  } else if (type === 'top') {
    // the handle bar along the bottom of the sash, the hinge housings at the top
    parts.clad.push(block([cx - sw / 2 + 30, sy - sh / 2 - 6, cx + sw / 2 - 30, sy - sh / 2 + 40], null, 100, 122, 6, 10));
    for (const s of [-1, 1]) parts.clad.push(block([cx + s * (sw / 2 - 10) - 28, sy + sh / 2 - 120, cx + s * (sw / 2 - 10) + 28, sy + sh / 2 - 10], null, 100, 118, 6, 10));
  } else {
    // the hatch: two hinges on the left, the lock lever on the right
    for (const y of [-h / 4, h / 4]) {
      parts.clad.push(block([cx - w / 2 - 18, y - 45, cx - w / 2 + 40, y + 45], null, 60, 96, 4, 6));
      parts.spacer.push(cyl(9, 100, cx - w / 2 - 14, y, 96, 'y'));
    }
    parts.spacer.push(block([cx + sw / 2 - 46, -90, cx + sw / 2 - 16, 90], null, 106, 122, 4, 10));
  }
}

// the window, as a group in its local frame. flat: on a kerb on a flat roof
export function buildRoofWindow(q, Wm, Hm, colour, flat = false, lift = 0) {
  const type = RWIN_TYPES[q.wtype] ? q.wtype : 'pivot', grp = new THREE.Group();
  const parts = { clad: [], rubber: [], spacer: [], glass: [], lining: [], pine: [], apron: [], grille: [], kerb: [] };
  const [w, h] = rwinSpan(type, Wm, Hm);
  let z0 = 0;
  if (flat) {
    // the kerb 150 high, the membrane turned up it, a cap of flashing on top
    parts.kerb.push(block([-w / 2 - 110, -h / 2 - 110, w / 2 + 110, h / 2 + 110], [-w / 2 + 10, -h / 2 + 10, w / 2 - 10, h / 2 - 10], 0, 150, 6, 20));
    parts.apron.push(ring(w + 240, h + 240, 30, 0, 12, 3, 30));
    parts.clad.push(ring(w + 236, h + 236, 128, 150, 162, 3, 22));
    z0 = 162;
  } else {
    // the flashing collar round it on the covering, the pleated apron below
    // (on a profiled covering the collar stands on its crests, the apron laid down over them)
    parts.clad.push(ring(w + 180, h + 170, 90, 0, 22, 4, 14, 0, 5, [90, 80, 90, 90]));
    parts.clad.push(ring(w + 180, h + 170, 12, -lift, 2, 2, 14, 0, 5));
    parts.apron.push(apron(w + 300, -h / 2 - 80, 170, 6, lift));
  }
  const pre = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length]));
  if (type === 'dome') {
    parts.clad.push(ring(w + 60, h + 60, 70, 0, 50, 6, 30));
    parts.rubber.push(ring(w - 70, h - 70, 8, 48, 54, 1, 20));
    const d = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    d.rotateX(Math.PI / 2); d.scale(MM(w / 2 - 20), MM(h / 2 - 20), MM(Math.min(w, h) * 0.24)); d.translate(0, 0, MM(50));
    const inner = d.clone(); inner.scale(0.96, 0.96, 0.9); inner.translate(0, 0, MM(4));
    parts.dome = [d, inner];
  } else if (type === 'twin') {
    for (const s of [-1, 1]) unit(parts, 'pivot', Wm, Hm, s * (Wm + RWIN_GAP) / 2);
    parts.clad.push(block([-RWIN_GAP / 2 - 12, -h / 2 - 4, RWIN_GAP / 2 + 12, h / 2 - 120], null, 0, 64, 4, 6));
  } else unit(parts, type, w, h, 0);
  // (on the flat roof all but the kerb and its membrane stand on the kerb's cap)
  for (const [k, gs] of Object.entries(parts)) gs.forEach((g, i) => { if (i >= (pre[k] || 0) && z0) g.translate(0, 0, MM(z0)); });
  const mats = { clad: M.clad(colour), rubber: M.rubber(), spacer: M.spacer(), glass: M.glass(), lining: M.lining(), pine: M.pine(), apron: M.apron(colour), grille: M.grille(), kerb: M.kerb(), dome: M.dome() };
  for (const [k, gs] of Object.entries(parts)) {
    if (!gs.length) continue;
    const geo = mergeGeometries(gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') n.deleteAttribute(a); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; }));
    const m = new THREE.Mesh(geo, mats[k]);
    m.castShadow = k !== 'glass' && k !== 'dome'; m.receiveShadow = true;
    if (k === 'glass' || k === 'dome') m.renderOrder = 2;
    grp.add(m);
  }
  return grp;
}
