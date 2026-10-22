import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { mats, box, glazing } from './windows.js';
import { GARAGES, GARAGE_SIZE, buildGarage } from './garage.js';

// Doors, built to the opening like the windows (windows.js): the frame (коробка) round the
// top and the sides, the leaf (полотно) in it with a 3 mm gap, its panels / grooves / glass,
// the hinges on one side, the handle and the lock on the other, the threshold of an
// entrance door; the casings (наличники) over the joint with the wall; the foam and the
// tapes in the gap round the frame. All in mm; the local frame as a window's (x along the
// wall, y up from the floor of the opening, z across the wall, + outside).
const S = 1 / 1000 / MODEL_SCALE;

export const DOORS = {
  door1: { name: 'Входная стальная', leaf: 'steel', entrance: true, grooves: true },
  door2: { name: 'Входная хай-тек', leaf: 'black', entrance: true, pull: true, slit: true },
  door3: { name: 'Межкомнатная, дуб', leaf: 'wood', panels: true },
  door4: { name: 'Межкомнатная белая со стеклом', leaf: 'white', frosted: true },
  door5: { name: 'Двустворчатая входная, дуб', leaf: 'wood', entrance: true, double: true, panels: true, lites: true },
  // the garage doors (garage.js)
  ...Object.fromEntries(Object.entries(GARAGES).map(([k, g]) => [k, { name: g.name, garage: g.kind }])),
};
export const isDoor = (key) => key in DOORS;

const SIZES = { door1: [400, 9000, 900, 9000], door2: [400, 9000, 900, 9000], door3: [400, 9000, 900, 9000], door4: [400, 9000, 900, 9000], door5: [800, 9000, 900, 9000], ...Object.fromEntries(Object.keys(GARAGES).map((k) => [k, GARAGE_SIZE])) };   // (made to any opening: the leaf, its panels, glass and handles follow it)
export function doorFits(key, w, h) {
  const [w0, w1, h0, h1] = SIZES[key], n = DOORS[key].name;
  if (w < w0) return `Проём ${w} мм узок для двери «${n}» (от ${w0} мм)`;
  if (w > w1) return `Проём ${w} мм широк для двери «${n}» (до ${w1} мм)`;
  if (h < h0) return `Проём ${h} мм низок для двери «${n}» (от ${h0} мм)`;
  if (h > h1) return `Проём ${h} мм высок для двери «${n}» (до ${h1} мм)`;
  return null;
}

let WOOD = null;
// oak veneer: drawn here (a photo of planks reads as a pallet) — straight grain along the
// leaf, the long darker streaks of the pores, a few wavy bands of the figure
function veneer() {
  const W = 256, H = 1024, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#c9a274'; g.fillRect(0, 0, W, H);
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // broad bands of a lighter / darker tone
  for (let i = 0; i < 14; i++) { const x = r() * W, w = 6 + r() * 30; g.fillStyle = `rgba(${r() < 0.5 ? '90,55,25' : '235,205,160'},${0.05 + r() * 0.08})`; g.fillRect(x, 0, w, H); g.fillRect(x - W, 0, w, H); }
  // the grain: thin lines, slightly wavy
  for (let i = 0; i < 420; i++) {
    const x0 = r() * W, amp = 0.5 + r() * 2.5, ph = r() * 6.28, fr = 0.004 + r() * 0.01, dark = r() < 0.7;
    g.strokeStyle = dark ? `rgba(80,48,20,${0.06 + r() * 0.16})` : `rgba(245,220,180,${0.05 + r() * 0.1})`;
    g.lineWidth = 0.4 + r() * 1.4;
    g.beginPath();
    for (let y = 0; y <= H; y += 16) { const x = x0 + Math.sin(y * fr + ph) * amp; if (y === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  }
  // short pore flecks
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(70,40,15,${0.1 + r() * 0.2})`; g.fillRect(r() * W, r() * H, 0.8, 3 + r() * 9); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// the wood material (made once, in a page)
export function setDoorTextures() {
  if (WOOD || typeof document === 'undefined') return;
  WOOD = new THREE.MeshStandardMaterial({ map: veneer(), color: 0xffffff, roughness: 0.42, side: THREE.DoubleSide });   // (lacquered)
}
const DM = {};
function dmats() {
  if (DM.steel) return DM;
  const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o });
  DM.steel = std({ color: 0x3a3c40, roughness: 0.5, metalness: 0.45 });
  DM.black = std({ color: 0x17181a, roughness: 0.42, metalness: 0.5 });
  DM.white = std({ color: 0xefeee8, roughness: 0.42 });
  DM.groove = std({ color: 0x1c1d20, roughness: 0.7, metalness: 0.3 });
  DM.frosted = new THREE.MeshStandardMaterial({ color: 0xd5dde0, roughness: 0.3, transparent: true, opacity: 0.68, side: THREE.DoubleSide });
  return DM;
}

// a wooden part's texture coordinates: from its position, the grain upright
function woodUV(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv[i * 2] = u / 900; uv[i * 2 + 1] = v / 1800;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function buildDoor(key, w, h, t = 300) {
  setDoorTextures();
  if (DOORS[key].garage) return buildGarage(key, w, h, t, WOOD);
  const P = DOORS[key], M = mats(), D = dmats(), gap = 15;
  const G = { frame: [], leaf: [], groove: [], chrome: [], glass: [], spacer: [], frosted: [], foam: [], tapeOut: [], tapeIn: [], casing: [], seal: [] };
  const ent = !!P.entrance, F = ent ? 50 : 30;            // the frame seen (steel / wood)
  const X0 = -w / 2 + gap, X1 = w / 2 - gap, Y1 = h - gap, Y0 = 0;
  const fd = ent ? 80 : Math.min(t, 200);                 // the frame's depth
  const zF = ent ? t / 2 - 40 - fd / 2 : 0;               // an entrance door in the outer part of the wall, an interior one in the middle
  const frameMat = P.leaf === 'wood' ? 'wood' : P.leaf;
  const FR = frameMat === 'wood' ? G.leaf : G.frame;      // (a wooden frame: the leaf's wood)
  // the foam and the tapes round it (sides and top)
  box(G.foam, X0 - gap / 2, (Y0 + Y1) / 2, zF, gap, Y1 - Y0, Math.min(fd, 60));
  box(G.foam, X1 + gap / 2, (Y0 + Y1) / 2, zF, gap, Y1 - Y0, Math.min(fd, 60));
  box(G.foam, 0, Y1 + gap / 2, zF, X1 - X0 + 2 * gap, gap, Math.min(fd, 60));
  // the frame: two jambs and the head
  box(FR, X0 + F / 2, Y1 / 2, zF, F, Y1, fd);
  box(FR, X1 - F / 2, Y1 / 2, zF, F, Y1, fd);
  box(FR, 0, Y1 - F / 2, zF, X1 - X0, F, fd);
  // the stop the leaf closes against (a rebate, 12 mm), its seal
  const stopZ = ent ? zF + fd / 2 - 10 : zF + 20;
  for (const [cx, cy, sx, sy] of [[X0 + F + 6, Y1 / 2, 12, Y1 - F], [X1 - F - 6, Y1 / 2, 12, Y1 - F], [0, Y1 - F - 6, X1 - X0 - 2 * F, 12]]) {
    box(FR, cx, cy, stopZ, sx, sy, 20);
    box(G.seal, cx, cy, stopZ - 12, sx, sy, 4);
  }
  // the threshold of an entrance door
  const thr = ent ? 22 : 0;
  if (ent) box(G.chrome, 0, thr / 2, zF, X1 - X0, thr, fd + 20);
  // the casings: inside an entrance door, both sides of an interior one — 70 wide, 10 thick, mitred tops (as boxes)
  const cas = (side) => {
    const z = side * (t / 2 + 5), cw = 70, list = frameMat === 'wood' ? G.leaf : P.leaf === 'white' ? G.casing : G.casing;
    box(list, X0 - cw / 2 + 10, (Y1 + cw - 10) / 2, z, cw, Y1 + cw - 10, 10);
    box(list, X1 + cw / 2 - 10, (Y1 + cw - 10) / 2, z, cw, Y1 + cw - 10, 10);
    box(list, 0, Y1 + cw / 2 - 10, z, X1 - X0 + 2 * cw - 20, cw, 10);
  };
  cas(-1);
  if (!ent) cas(1);
  // the leaves
  const lt = ent ? 70 : 40, zL = ent ? zF + fd / 2 - 20 - lt / 2 : zF + 10 - lt / 2 + 20;
  const lx0 = X0 + F + 3, lx1 = X1 - F - 3, ly0 = thr + (ent ? 3 : 10), ly1 = Y1 - F - 3;
  const leaves = P.double ? [[lx0, (lx0 + lx1) / 2 - 2, -1], [(lx0 + lx1) / 2 + 2, lx1, 1]] : [[lx0, lx1, 1]];
  const LF = P.leaf === 'wood' ? G.leaf : null;
  const leafList = LF || (G[P.leaf] = G[P.leaf] || []);
  leaves.forEach(([a, b, hand], li) => {
    const lw = b - a, lh = ly1 - ly0, cx = (a + b) / 2, cy = (ly0 + ly1) / 2;
    // the hinges on the side away from the handle
    const hingeX = hand > 0 ? a : b, handleX = hand > 0 ? b - 70 : a + 70;
    const zo = zL + lt / 2, zi = zL - lt / 2;   // the leaf's outer / inner face
    if (P.frosted) {
      // a white frame round a big frosted pane
      const r = 110;
      box(leafList, a + r / 2, cy, zL, r, lh, lt); box(leafList, b - r / 2, cy, zL, r, lh, lt);
      box(leafList, cx, ly1 - r / 2, zL, lw - 2 * r, r, lt); box(leafList, cx, ly0 + 160, zL, lw - 2 * r, 320, lt);
      box(G.frosted, cx, (ly0 + 320 + ly1 - r) / 2, zL, lw - 2 * r + 8, ly1 - r - ly0 - 320 + 8, 6);
    } else if (P.lites) {
      // the leaf with a glass lite in its upper part
      const r = 120, gy0 = ly0 + lh * 0.55;
      box(leafList, a + r / 2, cy, zL, r, lh, lt); box(leafList, b - r / 2, cy, zL, r, lh, lt);
      box(leafList, cx, ly1 - r / 2, zL, lw - 2 * r, r, lt); box(leafList, cx, (ly0 + gy0) / 2, zL, lw - 2 * r, gy0 - ly0, lt);
      glazing(G, a + r - 4, gy0 - 4, b - r + 4, ly1 - r + 4, zL, 16);
    } else if (P.slit) {
      // the leaf with a narrow glass slit by the handle side
      const sx = hand > 0 ? b - 220 : a + 220, sw = 90, s0 = ly0 + 250, s1 = ly1 - 250;
      box(leafList, (a + sx - sw / 2) / 2, cy, zL, sx - sw / 2 - a, lh, lt);
      box(leafList, (sx + sw / 2 + b) / 2, cy, zL, b - sx - sw / 2, lh, lt);
      box(leafList, sx, (ly0 + s0) / 2, zL, sw, s0 - ly0, lt); box(leafList, sx, (s1 + ly1) / 2, zL, sw, ly1 - s1, lt);
      glazing(G, sx - sw / 2 - 4, s0 - 4, sx + sw / 2 + 4, s1 + 4, zL, 16);
    } else box(leafList, cx, cy, zL, lw, lh, lt);
    if (P.grooves) {
      // milled grooves on the outer face: a frame and horizontal lines
      const m = 90, gw = 6;
      for (const y of [ly0 + m, ly1 - m]) box(G.groove, cx, y, zo + 0.5, lw - 2 * m, gw, 2);
      for (const x of [a + m, b - m]) box(G.groove, x, cy, zo + 0.5, gw, lh - 2 * m, 2);
      for (let k = 1; k <= 6; k++) box(G.groove, cx, ly0 + m + (lh - 2 * m) * k / 7, zo + 0.5, lw - 2 * m - 80, gw, 2);
    }
    if (P.panels) {
      // two raised panels on each face: a moulding round each
      const m = 110, mid = ly0 + lh * 0.42;
      const panels = P.lites ? [[ly0 + m, ly0 + lh * 0.55 - m]] : [[ly0 + m, mid - 40], [mid + 40, ly1 - m]];
      for (const z of [zo + 4, zi - 4]) for (const [p0, p1] of panels) {
        const pw = lw - 2 * m;
        box(leafList, cx, p0, z, pw, 14, 8); box(leafList, cx, p1, z, pw, 14, 8);
        box(leafList, a + m, (p0 + p1) / 2, z, 14, p1 - p0, 8); box(leafList, b - m, (p0 + p1) / 2, z, 14, p1 - p0, 8);
      }
    }
    // the hinges: 3 on an entrance door, 2 inside (cylinders as boxes, on the inside edge)
    for (const f of ent ? [0.1, 0.5, 0.88] : [0.12, 0.85]) box(G.chrome, hingeX, ly0 + lh * f, zi - 2, 14, 110, 14);
    // the handle and the lock (on one leaf of two)
    if (!P.double || li === 1) {
      const hy = ly0 + Math.min(1000, lh * 0.48);
      if (P.pull) {
        // a long pull bar outside, a lever inside
        const pl = Math.min(1200, lh * 0.55); box(G.chrome, handleX - hand * 20, hy, zo + 50, 30, pl, 30);
        for (const s of [-1, 1]) box(G.chrome, handleX - hand * 20, hy + s * (pl / 2 - 80), zo + 25, 22, 22, 50);
        box(G.chrome, handleX, hy, zi - 10, 50, 50, 20); box(G.chrome, handleX - hand * 55, hy, zi - 30, 120, 20, 20);
      } else for (const sgn of [1, -1]) {
        const zf = sgn > 0 ? zo : zi;
        box(G.chrome, handleX, hy, zf + sgn * 6, 52, 52, 12);                       // the rosette
        box(G.chrome, handleX - hand * 58, hy, zf + sgn * 30, 130, 22, 20);         // the lever
        box(G.chrome, handleX, hy - 90, zf + sgn * 5, 34, 40, 10);                  // the lock's escutcheon
      }
    }
  });
  const g = new THREE.Group();
  const matOf = (k) => (k === 'leaf' ? WOOD || M.board : k === 'frame' ? D[frameMat] || D.steel : k === 'casing' ? (P.leaf === 'white' ? D.white : WOOD || M.board) : D[k] || M[k] || M.pvc);
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    let geo = mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q)), false);
    if ((k === 'leaf' || k === 'casing') && WOOD) geo = woodUV(geo);
    const mesh = new THREE.Mesh(geo, matOf(k));
    mesh.castShadow = !['glass', 'frosted'].includes(k); mesh.receiveShadow = true;
    if (k === 'glass' || k === 'frosted') mesh.renderOrder = 2;
    g.add(mesh);
  }
  g.scale.setScalar(S);
  g.userData.window = { key, w, h };
  return g;
}
