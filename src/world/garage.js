import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { canvas, normalOf } from './roof.js';

// The garage doors, built to the opening like the doors (doors.js) — in mm, the local frame
// of a window: x along the wall, y up from the floor of the opening, z across the wall
// (+ outside), the wall t thick:
//   sectional – steel sandwich panels 40 mm (a stucco grain, two ribs each) hung inside the
//               opening on vertical guides that turn into the tracks under the ceiling, the
//               torsion shaft with its springs over the lintel, rubber seals, the handle;
//   roller    – aluminium slats 77 mm in side guides on the facade, the box over the
//               opening with its rounded front, the bottom bar with its seal and lock;
//   swing     – two leaves of planks on a steel frame in the opening: ledges and braces
//               inside, long strap hinges and a ring pull outside, the drop bolt and the hasp.
const S = 1 / 1000 / MODEL_SCALE;
export const GARAGES = {
  gar1: { name: 'Гаражные секционные', kind: 'sectional' },
  gar2: { name: 'Гаражные рулонные', kind: 'roller' },
  gar3: { name: 'Гаражные распашные, дерево', kind: 'swing' },
};
export const GARAGE_SIZE = [1800, 6000, 1800, 3500];   // w from…to, h from…to (mm)

const M = {};
function mats(wood) {
  if (M.panel) { if (wood && M.wood !== wood) { M.wood = wood; M.ledge = wood.clone(); M.ledge.color.setHex(0x9c7a58); } return M; }
  const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o });
  // the stucco grain of the steel (a fine orange-peel relief)
  const n = 256, hc = canvas(n), h = hc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, n, n);
  let seed = 3; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) { const v = 90 + r() * 80; h.fillStyle = `rgba(${v},${v},${v},0.5)`; h.beginPath(); h.arc(r() * n, r() * n, 1 + r() * 2.5, 0, 7); h.fill(); }
  const stucco = normalOf(hc, 1.6); stucco.wrapS = stucco.wrapT = THREE.RepeatWrapping;
  M.panel = std({ color: 0x3b3e42, roughness: 0.55, metalness: 0.35, normalMap: stucco, normalScale: new THREE.Vector2(0.6, 0.6) });
  M.panelIn = std({ color: 0xe9e9e4, roughness: 0.6, metalness: 0.2, normalMap: stucco, normalScale: new THREE.Vector2(0.4, 0.4) });
  M.groove = std({ color: 0x141517, roughness: 0.8 });
  M.galv = std({ color: 0xaab0b4, roughness: 0.35, metalness: 0.85 });
  M.spring = std({ color: 0x1e1f21, roughness: 0.4, metalness: 0.7 });
  M.rubber = std({ color: 0x0e0e0f, roughness: 0.9 });
  M.alu = std({ color: 0xc3c7ca, roughness: 0.32, metalness: 0.7 });
  M.aluDark = std({ color: 0x8b9094, roughness: 0.4, metalness: 0.7 });
  M.iron = std({ color: 0x1a1a1b, roughness: 0.55, metalness: 0.6 });
  M.frame = std({ color: 0x2b2c2e, roughness: 0.5, metalness: 0.5 });
  M.wood = wood || std({ color: 0x9a6b42, roughness: 0.6 });
  M.ledge = M.wood.clone(); M.ledge.color.setHex(0x9c7a58);   // (the ledges and braces a shade darker: weathered, oiled)
  return M;
}
const box = (out, cx, cy, cz, sx, sy, sz) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(cx, cy, cz); out.push(g); };
const cyl = (out, r, L, cx, cy, cz, axis = 'x', seg = 12) => { const g = new THREE.CylinderGeometry(r, r, L, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(cx, cy, cz); out.push(g); };
// uv from the position (mm / su, sv) on the face each triangle looks along
function planarUV(g, su, sv) {
  g.computeVertexNormals();
  const p = g.attributes.position, nr = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i));
    const u = az >= ax && az >= ay ? p.getX(i) : ax >= ay ? p.getZ(i) : p.getX(i), v = ay > ax && ay > az ? p.getZ(i) : p.getY(i);
    uv[i * 2] = u / su; uv[i * 2 + 1] = v / sv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function sectional(G, w, h, t) {
  const zi = -t / 2, cw = w + 180, top = h + 90, n = Math.max(3, Math.round(top / 560)), ph = top / n, zc = zi - 32, d = 40;
  // the panels, their joints (a dark line where one closes into the next), two ribs each
  for (let k = 0; k < n; k++) {
    const y0 = k * ph, y1 = y0 + ph;
    box(G.panel, 0, (y0 + y1) / 2, zc, cw, ph - 3, d);
    box(G.groove, 0, y1 - 1.5, zc + d / 2 - 6, cw, 4, 12);
    for (const f of [1 / 3, 2 / 3]) { box(G.groove, 0, y0 + ph * f, zc + d / 2 + 0.5, cw - 4, 6, 2); box(G.panel, 0, y0 + ph * f + 5, zc + d / 2 + 1.5, cw - 4, 4, 2); }
    // the hinges between the panels and the rollers at the sides (inside)
    if (k) for (const x of [-cw / 2 + 60, -cw / 6, cw / 6, cw / 2 - 60]) box(G.galv, x, y0, zc - d / 2 - 4, 50, 70, 8);
    for (const s of [-1, 1]) cyl(G.galv, 22, 26, s * (cw / 2 + 18), y0 + ph / 2, zc - 10, 'x');
  }
  // the inside face white (the panels' inner skin)
  box(G.panelIn, 0, top / 2, zc - d / 2 - 0.5, cw - 6, top - 6, 1);
  // the seals: at the bottom, up the sides, the lintel's
  box(G.rubber, 0, 6, zc + 4, cw, 12, d - 4);
  for (const s of [-1, 1]) box(G.rubber, s * (w / 2 + 70), top / 2, zi - 6, 30, top, 12);
  box(G.rubber, 0, h + 50, zi - 6, w + 160, 30, 12);
  // the handle outside on the bottom panel
  box(G.iron, 0, ph * 0.55, zc + d / 2 + 14, 160, 26, 14); for (const s of [-1, 1]) box(G.iron, s * 70, ph * 0.55, zc + d / 2 + 6, 20, 26, 14);
  // the guides up the sides, turned into the tracks under the ceiling, the shaft and springs
  const ty = top + 220, L = Math.min(3200, top + 400);
  for (const s of [-1, 1]) {
    const gx = s * (cw / 2 + 45);
    box(G.galv, gx, top / 2 + 60, zc - 10, 4, top + 120, 70); box(G.galv, gx - s * 30, top / 2 + 60, zc + 25, 60, top + 120, 4);
    box(G.galv, gx, ty, zc - L / 2, 4, 70, L); box(G.galv, gx - s * 30, ty - 35, zc - L / 2, 60, 4, L);
    box(G.galv, gx, ty - 200, zc - L + 40, 40, 400, 40);   // (the hanger to the ceiling)
  }
  cyl(G.galv, 13, cw + 60, 0, top + 140, zi - 120, 'x');
  for (const s of [-1, 1]) {
    // the springs: coils of a dark wire round the shaft
    for (let k = 0; k < 26; k++) cyl(G.spring, 48, 7, s * (cw * 0.12 + k * 9), top + 140, zi - 120, 'x', 14);
    cyl(G.galv, 70, 10, s * (cw / 2 + 20), top + 140, zi - 120, 'x', 20);   // (the cable drums)
    box(G.galv, s * (cw / 2 + 20), top + 70, zi - 40, 90, 150, 6);
  }
  box(G.galv, 0, top + 140, zi - 40, 120, 140, 6);   // (the middle bearing plate)
}

function roller(G, w, h, t) {
  const zo = t / 2, gw = 70, gx = w / 2 + gw / 2 - 20, slat = 77, zc = zo + 38;
  // the guides on the facade, either side of the opening
  for (const s of [-1, 1]) {
    box(G.alu, s * gx, h / 2, zc, gw, h, 60);
    box(G.rubber, s * (gx - gw / 2 + 4), h / 2, zc, 6, h, 30);
  }
  // the curtain: slats with a rounded face, the joints dark
  const cw = w + 2 * gw - 70, n = Math.ceil((h - 60) / slat);
  for (let k = 0; k < n; k++) {
    const y0 = 60 + k * slat, y1 = Math.min(h, y0 + slat);
    box(G.alu, 0, (y0 + y1) / 2, zc, cw, y1 - y0 - 3, 12);
    cyl(G.alu, 30, cw, 0, (y0 + y1) / 2, zc - 22, 'x', 18);   // (the lens of the slat: a shallow curve)
    box(G.groove, 0, y1 - 1.5, zc + 4, cw, 3, 6);
  }
  // the bottom bar, its seal and the lock
  box(G.aluDark, 0, 32, zc, cw, 56, 20); box(G.rubber, 0, 3, zc, cw, 6, 18);
  cyl(G.iron, 14, 6, 0, 32, zc + 12, 'z', 16); box(G.iron, 0, 32, zc + 15, 4, 16, 2);
  // the box over the opening: a square back, the front rounded down to the slot
  const bh = 300, bd = 300, sh = new THREE.Shape(), r = 120, bx = w + 2 * gw;
  sh.moveTo(0, 0); sh.lineTo(bd - r, 0); sh.quadraticCurveTo(bd, 0, bd, r); sh.lineTo(bd, bh); sh.lineTo(0, bh); sh.lineTo(0, 0);
  const eg = new THREE.ExtrudeGeometry(sh, { depth: bx, bevelEnabled: false, curveSegments: 8 });
  eg.rotateY(Math.PI / 2); eg.translate(-bx / 2, h, zo + bd);
  G.alu.push(eg);
  for (const s of [-1, 1]) box(G.aluDark, s * (bx / 2 + 2), h + bh / 2, zo + bd / 2, 4, bh, bd);   // (the end caps)
}

function swing(G, w, h, t) {
  const zo = t / 2, fd = 80, zF = zo - 40 - fd / 2, F = 60, gap = 15;
  const X0 = -w / 2 + gap, X1 = w / 2 - gap, Y1 = h - gap;
  // the steel frame of angles in the opening
  box(G.frame, X0 + F / 2, Y1 / 2, zF, F, Y1, fd); box(G.frame, X1 - F / 2, Y1 / 2, zF, F, Y1, fd); box(G.frame, 0, Y1 - F / 2, zF, X1 - X0, F, fd);
  // the leaves: planks 120 with a chamfered joint, ledges and braces inside
  const lx0 = X0 + F + 5, lx1 = X1 - F - 5, ly0 = 25, ly1 = Y1 - F - 5, lt = 36, zL = zF + fd / 2 - 10 + lt / 2;
  for (const [a, b, hand] of [[lx0, -3, -1], [3, lx1, 1]]) {
    const lw = b - a, pw = 120, n = Math.max(2, Math.round(lw / pw)), q = lw / n;
    for (let k = 0; k < n; k++) {
      const x0 = a + k * q;
      box(G.wood, x0 + q / 2, (ly0 + ly1) / 2, zL, q - 4, ly1 - ly0, lt);
      box(G.groove, x0 + q - 1, (ly0 + ly1) / 2, zL + lt / 2 - 3, 3, ly1 - ly0, 6);
    }
    // inside: three ledges, the braces between them (rising to the hinge side)
    const zi = zL - lt / 2 - 14, ys = [ly0 + 200, (ly0 + ly1) / 2, ly1 - 200];
    for (const y of ys) box(G.ledge, (a + b) / 2, y, zi, lw - 40, 140, 28);
    for (let i = 0; i < 2; i++) {
      const yA = ys[i] + 70, yB = ys[i + 1] - 70, xA = hand < 0 ? b - 60 : a + 60, xB = hand < 0 ? a + 60 : b - 60, L = Math.hypot(xB - xA, yB - yA);
      const g = new THREE.BoxGeometry(L, 120, 28); g.rotateZ(Math.atan2(yB - yA, xB - xA)); g.translate((xA + xB) / 2, (yA + yB) / 2, zi); G.ledge.push(g);
    }
    // outside: the strap hinges (a long tapering strap, the knuckle on the frame), the bolts' heads
    const hx = hand < 0 ? a : b, zo2 = zL + lt / 2 + 3;
    for (const y of [ly0 + 220, (ly0 + ly1) / 2, ly1 - 220]) {
      const L = Math.min(800, lw * 0.6), sx = hx - hand * L / 2;
      box(G.iron, sx, y, zo2, L, 50, 6);
      box(G.iron, hx - hand * (L - 30), y, zo2, 60, 30, 6);
      cyl(G.iron, 14, 140, hx + hand * 10, y, zo2 - 6, 'y');
      for (let k = 1; k < 5; k++) cyl(G.iron, 9, 6, hx - hand * L * k / 5.2, y, zo2 + 4, 'z', 10);
    }
  }
  // the ring pull, the hasp with its padlock, the drop bolt on the left leaf
  const zo3 = zL + lt / 2 + 4, hy = Math.min(1100, ly1 * 0.45);
  const ring = new THREE.TorusGeometry(55, 8, 8, 24); ring.translate(-150, hy - 60, zo3 + 30); G.iron.push(ring);
  box(G.iron, -150, hy, zo3 + 4, 70, 70, 8);
  box(G.iron, 0, hy, zo3 + 4, 260, 50, 8); box(G.galv, 40, hy - 50, zo3 + 30, 60, 70, 26);
  box(G.iron, lx0 + 120, 200, zo3 + 10, 26, 400, 26); box(G.iron, lx0 + 120, 380, zo3 + 4, 80, 30, 8);
}

// the garage door `key` for an opening w × h (mm) in a wall t thick — a THREE.Group in the
// model's scale, its origin at the middle of the bottom of the opening, in the middle of the wall
export function buildGarage(key, w, h, t = 300, wood = null) {
  const P = GARAGES[key], MM = mats(wood);
  const G = { panel: [], panelIn: [], groove: [], galv: [], spring: [], rubber: [], alu: [], aluDark: [], iron: [], frame: [], wood: [], ledge: [] };
  (P.kind === 'roller' ? roller : P.kind === 'swing' ? swing : sectional)(G, w, h, t);
  const g = new THREE.Group();
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    let geo = mergeGeometries(list.map((q) => { const n = q.index ? q.toNonIndexed() : q; for (const a of Object.keys(n.attributes)) if (a !== 'position') n.deleteAttribute(a); return n; }), false);
    geo = planarUV(geo, k === 'wood' || k === 'ledge' ? 900 : 300, k === 'wood' || k === 'ledge' ? 1800 : 300);
    const mesh = new THREE.Mesh(geo, MM[k]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.scale.setScalar(S);
  g.userData.window = { key, w, h };
  return g;
}
