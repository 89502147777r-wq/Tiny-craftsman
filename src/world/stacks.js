import * as THREE from 'three';
import { MAT, MODEL_SCALE, TRAY } from '../config.js';
import { makeBoardMaterial } from './formwork.js';
import { makeRebarMaterial } from './rebar.js';
import { mulberry32 } from '../core/rand.js';

// Building materials waiting on the workbench next to the diorama:
// a stack of 3 m boards on bearers, a tied bundle of Ø12 bars and a few
// sheets of welded mesh. Pure set dressing for the shot.
export function buildStacks(tex) {
  const g = new THREE.Group();
  g.name = 'stacks';
  const rnd = mulberry32(5);
  const X0 = -(TRAY.innerX / 2 + TRAY.wall) - 0.06; // left of the tray
  const T = MAT.board.t, H = MAT.board.h, L = 3 / MODEL_SCALE;

  // ---- boards: 5 layers × 6 on two bearers ----------------------------------------------
  const nB = 32;
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), makeBoardMaterial(tex), nB);
  const aB = new THREE.InstancedBufferAttribute(new Float32Array(nB * 3), 3);
  boards.geometry.setAttribute('aBoard', aB);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  let k = 0;
  const bx = X0 - 0.05, bz = -0.08;
  for (const dz of [-L * 0.35, L * 0.35]) { // bearers across the stack
    p.set(bx, H / 2, bz + dz); q.setFromEuler(e.set(0, 0, 0)); s.set(6 * H + 0.006, H, T * 2);
    boards.setMatrixAt(k, m.compose(p, q, s)); aB.setXYZ(k, rnd(), 0.5, 0.6); k++;
  }
  for (let layer = 0; layer < 5; layer++) for (let i = 0; i < 6; i++) {
    p.set(bx + (i - 2.5) * (H + 0.0004) + (rnd() - 0.5) * 0.0008, H + T / 2 + layer * (T + 0.00005), bz + (rnd() - 0.5) * 0.004);
    q.setFromEuler(e.set(0, Math.PI / 2 + (rnd() - 0.5) * 0.01, 0));
    s.set(L, T, H);
    boards.setMatrixAt(k, m.compose(p, q, s));
    aB.setXYZ(k, rnd(), Math.floor(rnd() * 8) / 8, 3 / 1.87);
    k++;
  }
  boards.count = k;
  boards.castShadow = boards.receiveShadow = true;
  g.add(boards);

  // ---- rebar bundle -----------------------------------------------------------------------
  const d = 0.012 / MODEL_SCALE, n = 26;
  const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  geo.setAttribute('aRib', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(L / (d * 3)), 1));
  const bars = new THREE.InstancedMesh(geo, makeRebarMaterial(), n);
  const cx = X0 - 0.02, cz = 0.13;
  let i = 0;
  for (let row = 0; row < 4 && i < n; row++) {
    const cnt = [8, 7, 6, 5][row];
    for (let c = 0; c < cnt && i < n; c++, i++) {
      p.set(cx + (c - (cnt - 1) / 2) * d * 1.05 + (rnd() - 0.5) * d * 0.2, d / 2 + row * d * 0.88, cz + (rnd() - 0.5) * 0.006);
      q.setFromEuler(e.set(Math.PI / 2, (rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.01));
      s.set(d / 2, L, d / 2);
      bars.setMatrixAt(i, m.compose(p, q, s));
    }
  }
  bars.count = i;
  bars.castShadow = bars.receiveShadow = true;
  g.add(bars);
  // binding wire around the bundle
  const wire = new THREE.MeshStandardMaterial({ color: 0x2c2c2e, metalness: 0.7, roughness: 0.4 });
  for (const t of [-0.35, 0, 0.35]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(d * 4.4, d * 0.12, 6, 28), wire);
    w.scale.set(1, 0.55, 1);
    w.position.set(cx, d * 1.8, cz + t * L);
    g.add(w);
  }

  // ---- welded mesh sheets ------------------------------------------------------------------
  const sheetW = 2 / MODEL_SCALE, sheetD = 1 / MODEL_SCALE, cell = MAT.meshCell, md = MAT.meshD;
  const wires = [];
  for (let sh = 0; sh < 4; sh++) {
    const ox = X0 - 0.05 + (rnd() - 0.5) * 0.004, oz = 0.30 + (rnd() - 0.5) * 0.004, y = sh * md * 2.2 + md;
    const rot = (rnd() - 0.5) * 0.04;
    for (let z = 0; z <= sheetD + 1e-6; z += cell) wires.push([ox, y, oz, sheetW, z, 0, rot]);
    for (let x = 0; x <= sheetW + 1e-6; x += cell) wires.push([ox, y + md, oz, sheetD, x, 1, rot]);
  }
  const mw = new THREE.InstancedMesh(new THREE.CylinderGeometry(md / 2, md / 2, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5b5450, metalness: 0.6, roughness: 0.55 }), wires.length);
  wires.forEach(([ox, y, oz, len, off, dir, rot], j) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    let lx, lz, qx;
    if (dir === 0) { lx = -sheetW / 2 + len / 2; lz = -sheetD / 2 + off; q.setFromEuler(e.set(0, -rot, Math.PI / 2)); }
    else { lx = -sheetW / 2 + off; lz = -sheetD / 2 + len / 2; q.setFromEuler(e.set(Math.PI / 2, 0, rot)); }
    qx = lx * c - lz * sn; const qz = lx * sn + lz * c;
    p.set(ox + qx, y, oz + qz); s.set(1, len, 1);
    mw.setMatrixAt(j, m.compose(p, q, s));
  });
  mw.castShadow = mw.receiveShadow = true;
  g.add(mw);
  return g;
}
