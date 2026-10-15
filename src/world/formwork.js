import * as THREE from 'three';
import { MAT, MODEL_SCALE, K } from '../config.js';
import { variant } from './assets.js';
import { mulberry32 } from '../core/rand.js';

// Formwork run record (type 'form'):
//   { a: [x, z], b: [x, z], n: [nx, nz], y0, y1, inside? }
// Boards (25 × 150 mm) stand on edge along a → b, stacked from the ground y0 up
// to the top y1 (the top board ripped to fit). Normally their inner face is on
// the line and stakes are driven on the outer side (n) every 0.8 m, every second
// one braced. `inside`: the outer side is a pit wall — the boards stand inside
// the line against it, without stakes.
export class FormworkView {
  constructor(tex, objects, terrain) {
    this.objects = objects;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'formwork';
    const board = makeBoardMaterial(tex);
    const plain = new THREE.MeshStandardMaterial({
      map: variant(tex.plank.diff, 0.12, 0.6), normalMap: variant(tex.plank.nor, 0.12, 0.6),
      roughness: 0.85, color: 0xd8c0a0,
    });
    this.max = { boards: 3000, stakes: 1200, braces: 600 };
    this.boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), board, this.max.boards);
    this.boards.geometry.setAttribute('aBoard', new THREE.InstancedBufferAttribute(new Float32Array(this.max.boards * 3), 3));
    this.stakes = new THREE.InstancedMesh(makeStakeGeometry(), plain, this.max.stakes);
    this.braces = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), plain, this.max.braces);
    for (const m of [this.boards, this.stakes, this.braces]) {
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    this.owner = { boards: [], stakes: [], braces: [] };
    this.dirty = true;
    objects.on((id, rec) => { if (rec?.type === 'form' || this._known?.has(id)) this.dirty = true; });
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    const runs = this.objects.all('form');
    this._known = new Set(runs.map((r) => r.id));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    let nb = 0, ns = 0, nr = 0;
    const aB = this.boards.geometry.attributes.aBoard;
    const T = MAT.board.t, H = MAT.board.h;
    this.owner = { boards: [], stakes: [], braces: [] };
    for (const r of runs) {
      const rnd = mulberry32(r.id * 7919);
      const [ax, az] = r.a, [bx, bz] = r.b, [nx, nz] = r.n;
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 1e-4) continue;
      const yaw = Math.atan2(-dz, dx);
      const side = r.inside ? -1 : 1;   // which side of the line the boards are on
      const count = Math.max(1, Math.ceil((r.y1 - r.y0) / H - 0.2));
      for (let k = 0; k < count && nb < this.max.boards; k++) {
        // boards overhang the corners a little, alternating, like real lapped corners
        // (inside a pit they are cut to the line instead)
        const over = r.inside ? -T : (k % 2 ? 1 : -1) * T * 0.5 + rnd() * 0.0006;
        const len = L + T + (r.inside ? over : Math.abs(over));
        const cx = (ax + bx) / 2 + side * nx * (T / 2) + (dx / L) * (r.inside ? 0 : over * 0.5), cz = (az + bz) / 2 + side * nz * (T / 2) + (dz / L) * (r.inside ? 0 : over * 0.5);
        // from the ground up; the top board is ripped to the height that is left
        const bottom = r.y0 + k * (H + 0.00004), h = Math.min(H, r.y1 - bottom);
        if (h < H * 0.15) break;
        p.set(cx, bottom + h / 2, cz);
        q.setFromEuler(e.set(0, yaw, (rnd() - 0.5) * 0.004));
        s.set(len, h, T);
        this.boards.setMatrixAt(nb, m.compose(p, q, s));
        // which plank of the photo, and how much of it this board shows
        aB.setXYZ(nb, rnd(), Math.floor(rnd() * 8) / 8, (len * MODEL_SCALE) / 1.87);
        this.owner.boards[nb] = r.id;
        nb++;
      }
      // stakes on the outside every 0.8 m (at least at both ends); none against a pit wall
      const nSt = r.inside ? 0 : Math.max(2, Math.round(L / MAT.stake.step) + 1);
      for (let k = 0; k < nSt && ns < this.max.stakes; k++) {
        const t = nSt === 1 ? 0.5 : (0.06 + 0.88 * k / (nSt - 1));
        const x = ax + dx * t + nx * (T + MAT.stake.s / 2), z = az + dz * t + nz * (T + MAT.stake.s / 2);
        const g = this.terrain.inside(x, z) ? this.terrain.heightAt(x, z) : r.y0;
        const top = r.y1 + 0.0015 * K, bottom = Math.min(g, r.y0) - 0.008 * K;
        p.set(x, bottom, z);
        q.setFromEuler(e.set(0, yaw + (rnd() - 0.5) * 0.05, 0));
        s.set(MAT.stake.s, top - bottom, MAT.stake.s);
        this.stakes.setMatrixAt(ns, m.compose(p, q, s));
        this.owner.stakes[ns] = r.id;
        ns++;
        // brace: from the stake top down to the ground outside, every second stake
        if (k % 2 === 0 && nr < this.max.braces) {
          const reach = (r.y1 - g) + 0.012 * K;
          const fx = x + nx * reach, fz = z + nz * reach;
          const fg = this.terrain.inside(fx, fz) ? this.terrain.heightAt(fx, fz) : g;
          const A = new THREE.Vector3(x + nx * MAT.stake.s * 0.5, top - 0.002, z + nz * MAT.stake.s * 0.5), B = new THREE.Vector3(fx, fg - 0.001, fz);
          const D = B.clone().sub(A);
          p.copy(A).add(B).multiplyScalar(0.5);
          // brace lies in the vertical plane through the stake, wide face sideways
          const bx2 = D.clone().normalize(), bz2 = new THREE.Vector3().crossVectors(bx2, _y).normalize(), by2 = new THREE.Vector3().crossVectors(bz2, bx2);
          q.setFromRotationMatrix(_m.makeBasis(bx2, by2, bz2));
          s.set(D.length(), 0.03 / MODEL_SCALE, 0.025 / MODEL_SCALE);
          this.braces.setMatrixAt(nr, m.compose(p, q, s));
          this.owner.braces[nr] = r.id;
          nr++;
        }
      }
    }
    this.boards.count = nb; this.stakes.count = ns; this.braces.count = nr;
    for (const im of [this.boards, this.stakes, this.braces]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    aB.needsUpdate = true;
  }

  // object id under a raycast hit
  ownerOf(hit) {
    if (hit.object === this.boards) return this.owner.boards[hit.instanceId];
    if (hit.object === this.stakes) return this.owner.stakes[hit.instanceId];
    if (hit.object === this.braces) return this.owner.braces[hit.instanceId];
    return null;
  }
}

const _y = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4();

// Build formwork runs around an outline's boundary edges.
export function runsForEdges(edgeList, y0At, y1) {
  return edgeList.map((e) => ({ type: 'form', a: e.a, b: e.b, n: e.n, y0: y0At(e), y1 }));
}

export function makeBoardMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({
    map: tex.plank.diff, normalMap: tex.plank.nor, roughnessMap: tex.plank.arm,
    roughness: 1, metalness: 0, color: 0xf0dcc0,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBoard;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        // a 150 mm tall strip of the plank photo, length-matched to the board
        vec2 bu = vec2(uv.x * aBoard.z + aBoard.x, aBoard.y + uv.y * 0.11);
        vMapUv = bu; vNormalMapUv = bu; vRoughnessMapUv = bu;`);
  };
  m.customProgramCacheKey = () => 'tc-board';
  return m;
}

function makeStakeGeometry() {
  // unit-height square stake with its point at y = 0, sharpened over the bottom 15 %
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 4, 1);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.15) { const k = 0.2 + 0.8 * y / 0.15; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  }
  g.computeVertexNormals();
  return g;
}
