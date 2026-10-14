import * as THREE from 'three';
import { mulberry32 } from '../core/rand.js';
import { insideTray } from './plotShape.js';

// Diorama "static grass": little tufts of 2–5 mm fibres on the untouched
// ground — a building site is bare earth, so weeds grow in clumps mostly
// along the edges. A tuft disappears as soon as its patch is dug or buried.
export class Grass {
  constructor(terrain, count = 1100) {
    this.terrain = terrain;
    const rnd = mulberry32(21);
    const geo = makeTuftGeometry(rnd);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.tufts = [];
    const hx = terrain.halfX - 0.004, hz = terrain.halfZ - 0.004;
    for (let i = 0; i < count; i++) {
      // clustered placement: patches of grass rather than a uniform lawn
      let x, z, tries = 0;
      do {
        x = (rnd() * 2 - 1) * hx; z = (rnd() * 2 - 1) * hz; tries++;
      } while (tries < 12 && (!insideTray(x, z, 0.006) || patch(x, z) * (Math.min(hx - Math.abs(x), hz - Math.abs(z)) < 0.14 ? 1 : 0.12) < rnd()));
      if (!insideTray(x, z, 0.006)) { x = 0; z = 0; }
      const s = 0.5 + rnd() * 0.55;
      this.tufts.push({ x, z, s, rot: rnd() * Math.PI * 2, tilt: (rnd() - 0.5) * 0.4 });
    }
    this._seen = -1;
    this.color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = rnd();
      this.color.setRGB(0.36 + 0.16 * k, 0.38 + 0.14 * k, 0.18 + 0.06 * k); // dry straw → olive (diorama static grass)
      this.mesh.setColorAt(i, this.color);
    }
  }

  update() {
    const t = this.terrain;
    if (t.version === this._seen) return;
    this._seen = t.version;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < this.tufts.length; i++) {
      const g = this.tufts[i];
      const k = t.index(g.x, g.z);
      const dug = t.orig[k] - t.nat[k] > 0.0006 || t.loose[k] > 0.0012;
      if (dug) { s.setScalar(0); } else s.setScalar(g.s);
      p.set(g.x, t.heightAt(g.x, g.z) - 0.0002, g.z);
      q.setFromEuler(e.set(g.tilt, g.rot, 0));
      this.mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function patch(x, z) {
  const v = Math.sin(x * 41 + 1.3) * Math.sin(z * 37 - 0.7) + Math.sin((x + z) * 23);
  return 0.25 + 0.75 * Math.max(0, v * 0.5);
}

function makeTuftGeometry(rnd) {
  const pos = [], col = [], idx = [];
  const blades = 14;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const lean = 0.25 + rnd() * 0.5;
    const len = 0.002 + rnd() * 0.0038;
    const w = 0.00011 + rnd() * 0.00008;
    const ox = (rnd() - 0.5) * 0.0016, oz = (rnd() - 0.5) * 0.0016;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const base = pos.length / 3;
    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const f = s / segs;
      const bend = lean * f * f;
      const cx = ox + dx * bend * len, cz = oz + dz * bend * len, cy = len * f * (1 - 0.25 * lean * f);
      const ww = w * (1 - f * 0.9);
      pos.push(cx - px * ww, cy, cz - pz * ww, cx + px * ww, cy, cz + pz * ww);
      const shade = 0.4 + 0.6 * f; // dark, dusty root
      col.push(shade, shade, shade, shade, shade, shade);
    }
    for (let s = 0; s < segs; s++) {
      const i0 = base + s * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // grass normals point mostly up so tufts are lit like a lawn, not like paper
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) { n.setXYZ(i, n.getX(i) * 0.4, 1, n.getZ(i) * 0.4); }
  g.normalizeNormals?.();
  return g;
}
