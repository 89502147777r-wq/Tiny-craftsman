import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';

// Windows, built to the opening they go into (a model of a fixed size would stretch its
// profiles): the frame and the sashes swept along real cross-sections of the profiles
// (mitred corners), the black rubber seals, the glazing beads, the double glazing with the
// spacer along its edges, the handles; outside the sill flashing, inside the window board,
// the foam in the gap round the frame. Everything in mm; the group is scaled to the model.
//
// The local frame of a window: x along the wall (0 = the middle of the opening), y up
// from the bottom of the opening, z across the wall (+ outside), the wall's middle at 0.
const S = 1 / 1000 / MODEL_SCALE;

export const WINDOWS = {
  pvc1: { name: 'ПВХ, одна створка', mat: 'pvc', cols: [1], sill: true },
  pvc2: { name: 'ПВХ, две створки', mat: 'pvc', cols: [1, 1], sill: true },
  pvc3: { name: 'ПВХ антрацит, три створки', mat: 'anth', cols: [1, 0, 1], sill: true },
  pano: { name: 'Панорамное, узкий алюминий', mat: 'alu', narrow: true, maxPane: 1600 },
  portal: { name: 'Раздвижной портал', mat: 'alu', slide: true },
};

// what a window can be made to: → null, or why not
const SIZES = { pvc1: [400, 1300, 400, 2400], pvc2: [900, 2100, 400, 2400], pvc3: [1500, 3200, 400, 2400], pano: [500, 7000, 600, 4000], portal: [1800, 7000, 1800, 3200] };
export function windowFits(key, w, h) {
  const [w0, w1, h0, h1] = SIZES[key], n = WINDOWS[key].name;
  if (w < w0) return `Проём ${w} мм узок для «${n}» (от ${w0} мм) — выберите другое окно`;
  if (w > w1) return `Проём ${w} мм широк для «${n}» (до ${w1} мм) — выберите другое окно`;
  if (h < h0) return `Проём ${h} мм по высоте мал для «${n}» (от ${h0} мм)`;
  if (h > h1) return `Проём ${h} мм по высоте велик для «${n}» (до ${h1} мм)`;
  return null;
}

// cross-sections [a (in from the outer edge of the piece), d (across, + outside)], mm
const PROF = {
  // PVC frame 70 deep, 63 seen: a rebate for the sash inside
  frame: [[0, -35], [0, 35], [44, 35], [47, 32], [52, 32], [52, -22], [63, -22], [63, -32], [60, -35]],
  // PVC sash 78 deep (it stands 8 proud of the frame inside), 52 seen round the glass
  sash: [[0, -43], [0, 24], [6, 30], [44, 30], [47, 27], [47, -40], [44, -43]],
  // the glazing bead inside, sloped
  bead: [[0, -40], [0, -24], [4, -24], [18, -38], [18, -40]],
  // narrow aluminium: 25 seen, 70 deep, the glass straight in it
  alu: [[0, -35], [0, 35], [22, 35], [25, 32], [25, 8], [30, 8], [30, -6], [25, -6], [25, -32], [22, -35]],
  aluBead: [[0, -20], [0, -12], [8, -12], [8, -20]],
  // a sliding panel's aluminium sash: 45 seen, 42 deep
  slideSash: [[0, -21], [0, 21], [42, 21], [45, 18], [45, -18], [42, -21]],
  // the portal's outer frame: 50 seen, 120 deep (two tracks)
  slideFrame: [[0, -60], [0, 60], [46, 60], [50, 56], [50, -56], [46, -60]],
};

const MATS = {};
export function mats() {
  if (MATS.pvc) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o });
  MATS.pvc = std({ color: 0xf1f1ec, roughness: 0.32 });
  MATS.anth = std({ color: 0x383b3f, roughness: 0.42 });
  MATS.anthIn = MATS.pvc;   // (anthracite outside, white inside: the face toward the room)
  MATS.alu = std({ color: 0x1d1e20, roughness: 0.38, metalness: 0.55 });
  MATS.seal = std({ color: 0x101010, roughness: 0.85 });
  MATS.spacer = std({ color: 0x8b9095, roughness: 0.35, metalness: 0.8 });
  MATS.chrome = std({ color: 0xc9ccd0, roughness: 0.18, metalness: 1 });
  MATS.board = std({ color: 0xf4f3ee, roughness: 0.5 });
  MATS.foam = std({ color: 0xe6cf78, roughness: 0.95 });
  MATS.tapeOut = std({ color: 0x4a4d52, roughness: 0.9 });
  MATS.tapeIn = std({ color: 0xc9ccd0, roughness: 0.4, metalness: 0.6 });
  MATS.glass = new THREE.MeshPhysicalMaterial({ color: 0x6f8584, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, ior: 1.7, specularIntensity: 1, envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide });   // (clear, a little green at its edge; the reflections make it)
  return MATS;
}

// a rectangle of profile swept round [x0, x1] × [y0, y1] at depth z (mitred corners)
export function sweep(out, x0, y0, x1, y1, prof, z = 0, sides = [1, 1, 1, 1]) {
  const pos = [];
  const at = (side, a) => [
    [[x0 + a, y0 + a], [x1 - a, y0 + a]],   // bottom
    [[x1 - a, y0 + a], [x1 - a, y1 - a]],   // right
    [[x1 - a, y1 - a], [x0 + a, y1 - a]],   // top
    [[x0 + a, y1 - a], [x0 + a, y0 + a]],   // left
  ][side];
  for (let s = 0; s < 4; s++) {
    if (!sides[s]) continue;
    for (let k = 0; k < prof.length; k++) {
      const p = prof[k], q = prof[(k + 1) % prof.length], A = at(s, p[0]), B = at(s, q[0]);
      const v = [[...A[0], z + p[1]], [...A[1], z + p[1]], [...B[1], z + q[1]], [...B[0], z + q[1]]];
      pos.push(...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  out.push(g);
}
export function box(out, cx, cy, cz, sx, sy, sz, rx = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  g.translate(cx, cy, cz);
  g.deleteAttribute('uv');
  out.push(g.toNonIndexed());
}
// a glazing unit: two panes, the spacer along the edges between them, the seals over it
export function glazing(G, x0, y0, x1, y1, z, gap = 16) {
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const dz of [-gap / 2 - 2, gap / 2 + 2]) box(G.glass, cx, cy, z + dz, w, h, 4);
  sweep(G.spacer, x0 + 2, y0 + 2, x1 - 2, y1 - 2, [[0, -gap / 2], [0, gap / 2], [9, gap / 2], [9, -gap / 2]], z);
}

// The window `key` for an opening w × h (mm) in a wall t thick: a THREE.Group in the model's
// scale, its origin at the middle of the bottom of the opening, in the middle of the wall
export function buildWindow(key, w, h, t = 300) {
  const P = WINDOWS[key], M = mats(), gap = 18;
  const G = { frame: [], inner: [], seal: [], bead: [], glass: [], spacer: [], chrome: [], board: [], foam: [], tapeOut: [], tapeIn: [] };
  const X0 = -w / 2 + gap, X1 = w / 2 - gap, Y0 = (P.sill ? 30 : 10) + gap, Y1 = h - gap;   // the frame's outside (a sill support profile under a PVC frame)
  const zF = t / 2 - 35 - 70;   // the frame stands in the outer part of the wall, 70 in from its face
  // the foam in the gap round it, a little back from the faces of the frame
  sweep(G.foam, X0 - gap, Y0 - gap, X1 + gap, Y1 + gap, [[0, -28], [0, 28], [gap, 28], [gap, -28]], zF);
  // over it the tapes: outside the grey pre-compressed tape (ПСУЛ — the foam must stay dry),
  // inside the foil vapour barrier tape
  sweep(G.tapeOut, X0 - gap - 6, Y0 - gap - 6, X1 + gap + 6, Y1 + gap + 6, [[0, 34], [0, 36], [gap + 14, 36], [gap + 14, 34]], zF, P.sill ? [0, 1, 1, 1] : [1, 1, 1, 1]);
  sweep(G.tapeIn, X0 - gap - 6, Y0 - gap - 6, X1 + gap + 6, Y1 + gap + 6, [[0, -36], [0, -34], [gap + 14, -34], [gap + 14, -36]], zF, P.sill ? [0, 1, 1, 1] : [1, 1, 1, 1]);
  if (P.slide) {
    // the portal: a deep frame, two big panels in two tracks, the one inside slides over
    sweep(G.frame, X0, Y0, X1, Y1, PROF.slideFrame, zF);
    const F = 50, mid = (X0 + X1) / 2, lap = 30;
    const panel = (a, b, z, handle) => {
      sweep(G.frame, a, Y0 + F, b, Y1 - F, PROF.slideSash, z);
      sweep(G.seal, a + 45, Y0 + F + 45, b - 45, Y1 - F - 45, [[0, -8], [0, 8], [3, 8], [3, -8]], z);
      glazing(G, a + 42, Y0 + F + 42, b - 42, Y1 - F - 42, z, 16);
      if (handle) {
        // a long pull bar on the inside of the panel
        const hx = handle < 0 ? a + 22 : b - 22, hy = Y0 + (Y1 - Y0) * 0.45;
        box(G.chrome, hx, hy, z - 21 - 30, 22, Math.min(900, (Y1 - Y0) * 0.4), 22);
        for (const s of [-1, 1]) box(G.chrome, hx, hy + s * Math.min(380, (Y1 - Y0) * 0.17), z - 21 - 15, 16, 16, 30);
      }
    };
    panel(X0 + F, mid + lap, zF + 26, 0);          // outside, fixed
    panel(mid - lap, X1 - F, zF - 26, -1);         // inside, slides
    // the threshold track
    box(G.chrome, (X0 + X1) / 2, Y0 + 6, zF, X1 - X0 - 2 * F, 12, 100);
  } else if (P.narrow) {
    // panoramic: the narrow aluminium frame, split into panes by mullions as it needs
    sweep(G.frame, X0, Y0, X1, Y1, PROF.alu, zF);
    const F = 25, n = Math.max(1, Math.ceil((X1 - X0 - 2 * F) / P.maxPane)), mw = 50;
    const pw = (X1 - X0 - 2 * F - (n - 1) * mw) / n;
    for (let i = 0; i < n; i++) {
      const a = X0 + F + i * (pw + mw), b = a + pw;
      if (i > 0) box(G.frame, a - mw / 2, (Y0 + Y1) / 2, zF, mw, Y1 - Y0 - 2 * F, 70);
      glazing(G, a + 2, Y0 + F + 2, b - 2, Y1 - F - 2, zF + 2, 16);
      sweep(G.seal, a, Y0 + F, b, Y1 - F, [[0, 12], [0, 16], [5, 16], [5, 12]], zF);
      sweep(G.bead, a, Y0 + F, b, Y1 - F, PROF.aluBead, zF);
    }
  } else {
    // PVC: the frame, mullions between the columns, a sash (with a handle) or a fixed pane in each
    sweep(G.frame, X0, Y0, X1, Y1, PROF.frame, zF);
    const F = 52, n = P.cols.length, mw = 76;
    const cw = (X1 - X0 - 2 * F - (n - 1) * mw) / n;
    for (let i = 0; i < n; i++) {
      const a = X0 + F + i * (cw + mw), b = a + cw;
      if (i > 0) {
        // the mullion: the frame's profile both ways
        box(G.frame, a - mw / 2, (Y0 + Y1) / 2, zF + 6, mw, Y1 - Y0 - 2 * F, 58);
        box(G.frame, a - mw / 2, (Y0 + Y1) / 2, zF - 28, mw - 24, Y1 - Y0 - 2 * F, 14);
      }
      if (P.cols[i]) {
        // the sash: over the frame's rebate by 8 mm all round
        const sa = a - 8, sb = b + 8, sy0 = Y0 + F - 8, sy1 = Y1 - F + 8;
        sweep(G.frame, sa, sy0, sb, sy1, PROF.sash, zF);
        sweep(G.seal, sa - 2, sy0 - 2, sb + 2, sy1 + 2, [[0, -27], [0, -22], [4, -22], [4, -27]], zF);
        sweep(G.seal, sa + 47, sy0 + 47, sb - 47, sy1 - 47, [[0, 24], [0, 28], [4, 28], [4, 24]], zF);
        sweep(G.bead, sa + 47, sy0 + 47, sb - 47, sy1 - 47, PROF.bead, zF);
        glazing(G, sa + 44, sy0 + 44, sb - 44, sy1 - 44, zF - 4, 16);
        // the handle on the stile away from the hinges (toward the middle of the window), inside
        const right = n === 1 ? true : i < n / 2, hx = right ? sb - 26 : sa + 26, hy = Math.min(sy0 + (sy1 - sy0) * 0.5, sy0 + 1100);
        box(G.board, hx, hy, zF - 43 - 6, 32, 78, 12);
        box(G.board, hx, hy - 52, zF - 43 - 26, 22, 120, 16);
      } else {
        sweep(G.seal, a, Y0 + F, b, Y1 - F, [[0, 24], [0, 28], [4, 28], [4, 24]], zF);
        sweep(G.bead, a, Y0 + F, b, Y1 - F, PROF.bead, zF);
        glazing(G, a - 4, Y0 + F - 4, b + 4, Y1 - F + 4, zF - 4, 16);
      }
    }
  }
  if (P.sill) {
    // outside: the sill flashing — out past the face of the wall, sloped, a drip at its edge
    const zo = zF + 35, out = t / 2 - zo + 40, ys = Y0 - 4;
    box(G.frame, 0, ys - 12, zo + out / 2, w + 40, 2, out, 0.14);
    box(G.frame, 0, ys - 12 - Math.sin(0.14) * out / 2 - 9, zo + out - 1, w + 40, 18, 2);
    // the support profile under the frame
    box(G.frame, 0, Y0 - 15, zF, X1 - X0, 30, 60);
    // inside: the window board, 40 thick, into the reveals 50 each side, 50 past the wall
    const zi = zF - 35, inn = zi + t / 2 + 50;
    box(G.board, 0, Y0 - 20, zi - inn / 2, w + 100, 40, inn);
  }
  const g = new THREE.Group();
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    const mat = k === 'frame' ? M[P.mat] : k === 'inner' ? M.pvc : k === 'bead' ? M[P.mat] : k === 'board' ? (P.mat === 'pvc' || P.mat === 'anth' ? M.pvc : M.board) : M[k];
    const mesh = new THREE.Mesh(mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q)), false), mat);
    mesh.castShadow = k !== 'glass'; mesh.receiveShadow = k !== 'glass';
    if (k === 'glass') mesh.renderOrder = 2;
    g.add(mesh);
  }
  g.scale.setScalar(S);
  g.userData.window = { key, w, h };
  return g;
}
