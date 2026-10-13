import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../../config.js';

// real metres → model metres
export const R = (v) => v / MODEL_SCALE;

// ---- materials ---------------------------------------------------------------------------
export function machineMaterials(color) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0.05, clearcoat: 0.55, clearcoatRoughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x26282a, roughness: 0.55, metalness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.12, metalness: 1.0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.92, metalness: 0 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x223038, roughness: 0.05, metalness: 0, transmission: 0, opacity: 0.35, transparent: true }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 0.4, roughness: 0.2 }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 }),
  };
}

export function box(w, h, d, mat, x = 0, y = 0, z = 0, bevel = 0) {
  const g = bevel ? roundedBox(w, h, d, bevel) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function cyl(r, len, mat, axis = 'z', seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Box with softly rounded edges (cheap: extruded rounded rect + bevel).
export function roundedBox(w, h, d, r) {
  r = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5);
  const s = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const bv = Math.min(r * 0.6, d * 0.25);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv * 0.6, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * bv) / 2);
  g.computeVertexNormals();
  return g;
}

// Extrude a 2D side profile (x forward, y up) across z.
export function profile(points, depth, mat, holes = []) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const bv = depth * 0.08;
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -(depth - 2 * bv) / 2);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---- hydraulic cylinder --------------------------------------------------------------------
// Barrel hinged at A, rod hinged at B; the rod slides out of the barrel as
// the joints move. A and B are Object3D anchors anywhere in the hierarchy.
export class Hydraulic {
  constructor(rBarrel, rRod, barrelLen, mats) {
    this.group = new THREE.Group();
    this.barrel = cyl(rBarrel, barrelLen, mats.paint, 'y', 14);
    this.barrel.geometry.translate(0, barrelLen / 2, 0);
    const cap = cyl(rBarrel * 1.15, rBarrel * 0.6, mats.dark, 'y', 14);
    cap.position.y = barrelLen;
    this.rod = cyl(rRod, barrelLen, mats.chrome, 'y', 10);
    this.rod.geometry.translate(0, barrelLen / 2, 0);
    const eye = cyl(rBarrel * 0.9, rBarrel * 1.6, mats.dark, 'z', 10);
    this.rodEye = eye;
    const eyeA = eye.clone();
    this.group.add(this.barrel, cap, this.rod, eye, eyeA);
    this.len = barrelLen;
    this.A = null; this.B = null;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  attach(A, B) { this.A = A; this.B = B; return this; }

  update() {
    const parent = this.group.parent;
    if (!parent || !this.A || !this.B) return;
    this.A.getWorldPosition(this._a); this.B.getWorldPosition(this._b);
    parent.worldToLocal(this._a); parent.worldToLocal(this._b);
    const d = this._b.clone().sub(this._a), L = d.length();
    this.group.position.copy(this._a);
    this.group.quaternion.setFromUnitVectors(_up, d.divideScalar(L || 1));
    // rod: its far end sits at B
    this.rod.position.y = L - this.len;
    this.rodEye.position.y = L;
  }
}

const _up = new THREE.Vector3(0, 1, 0);

// ---- rubber track -----------------------------------------------------------------------------
// A belt around a stadium (sprocket at the rear, idler at the front). The
// chevron tread is a scrolling normal/colour texture, so it runs with the
// machine's movement.
export function makeTrack(length, height, width, thickness, mats) {
  const Rr = height / 2, x0 = -length / 2 + Rr, x1 = length / 2 - Rr;
  const loop = [];
  const seg = 18;
  // bottom straight → front arc → top straight → rear arc (counter-clockwise seen from +z)
  for (let i = 0; i <= 10; i++) loop.push([x0 + (x1 - x0) * i / 10, 0]);
  for (let i = 1; i <= seg; i++) { const a = -Math.PI / 2 + Math.PI * i / seg; loop.push([x1 + Math.cos(a) * Rr, Rr + Math.sin(a) * Rr]); }
  for (let i = 1; i <= 10; i++) loop.push([x1 + (x0 - x1) * i / 10, height]);
  for (let i = 1; i < seg; i++) { const a = Math.PI / 2 + Math.PI * i / seg; loop.push([x0 + Math.cos(a) * Rr, Rr + Math.sin(a) * Rr]); }
  // cumulative arc length for u
  const n = loop.length;
  const acc = [0];
  for (let i = 1; i <= n; i++) { const a = loop[i - 1], b = loop[i % n]; acc.push(acc[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const P = acc[n];
  const pos = [], uv = [], idx = [];
  // 4 rings per loop point: outer-left, outer-right, inner-right, inner-left
  for (let i = 0; i <= n; i++) {
    const a = loop[i % n], prev = loop[(i - 1 + n) % n], next = loop[(i + 1) % n];
    const tx = next[0] - prev[0], ty = next[1] - prev[1], tl = Math.hypot(tx, ty);
    const nx = ty / tl, ny = -tx / tl; // outward normal (loop is counter-clockwise)
    const ox = a[0] + nx * thickness, oy = a[1] + ny * thickness;
    const u = acc[i] / P;
    pos.push(ox, oy, -width / 2, ox, oy, width / 2, a[0], a[1], width / 2, a[0], a[1], -width / 2);
    uv.push(u, 0, u, 1, u, 0.9, u, 0.1);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = (i + 1) * 4;
    const quad = (p, q) => idx.push(a + p, a + q, b + p, a + q, b + q, b + p);
    quad(1, 0); quad(2, 1); quad(3, 2); quad(0, 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tread = treadTextures(Math.round(P / (0.09 / MODEL_SCALE)));
  const mat = new THREE.MeshStandardMaterial({ map: tread.map, normalMap: tread.nor, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.9, color: 0xffffff, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.perimeter = P;
  return mesh;
}

function treadTextures(lugs) {
  const W = 1024, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H, u = (x / W) * lugs;
    const side = v < 0.5 ? (0.5 - v) : (v - 0.5);
    const ph = (u + side * 0.9) % 1;              // chevron
    hgt[y * W + x] = ph < 0.42 && side > 0.06 && side < 0.46 ? 1 : 0;
  }
  const map = g.createImageData(W, H), nor = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, h = hgt[y * W + x];
    const c0 = 22 + h * 10 + Math.random() * 6;
    map.data[i] = c0; map.data[i + 1] = c0; map.data[i + 2] = c0 + 1; map.data[i + 3] = 255;
    const hx = hgt[y * W + (x + 1) % W] - hgt[y * W + (x - 1 + W) % W];
    const hy = hgt[Math.min(H - 1, y + 1) * W + x] - hgt[Math.max(0, y - 1) * W + x];
    const l = Math.hypot(hx * 3, hy * 3, 1);
    nor.data[i] = (-hx * 3 / l * 0.5 + 0.5) * 255; nor.data[i + 1] = (-hy * 3 / l * 0.5 + 0.5) * 255; nor.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nor.data[i + 3] = 255;
  }
  g.putImageData(map, 0, 0);
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; c2.getContext('2d').putImageData(nor, 0, 0);
  const t1 = new THREE.CanvasTexture(c), t2 = new THREE.CanvasTexture(c2);
  t1.colorSpace = THREE.SRGBColorSpace; t2.colorSpace = THREE.NoColorSpace;
  for (const t of [t1, t2]) { t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map: t1, nor: t2 };
}

// ---- tyre with lugs ------------------------------------------------------------------------
export function makeWheel(radius, width, mats, rimColor, lugCount = 22) {
  const g = new THREE.Group();
  const prof = [];
  const rIn = radius * 0.62, sh = width * 0.5;
  // tyre cross-section (radius, axial)
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + Math.PI * i / 12;
    prof.push(new THREE.Vector2(radius * 0.86 + Math.cos(a) * radius * 0.12, Math.sin(a) * sh * 0.96));
  }
  prof.unshift(new THREE.Vector2(rIn, -sh * 0.9));
  prof.push(new THREE.Vector2(rIn, sh * 0.9));
  const tyreGeo = new THREE.LatheGeometry(prof, 40);
  tyreGeo.rotateX(Math.PI / 2); // axis → z
  const lugs = [];
  for (let i = 0; i < lugCount; i++) {
    for (const s of [-1, 1]) {
      const b = new THREE.BoxGeometry(radius * 0.11, radius * 0.07, width * 0.46);
      b.translate(0, radius * 0.97, s * width * 0.23);
      b.rotateY(s * 0.45);        // chevron
      b.rotateZ((i + (s > 0 ? 0.5 : 0)) / lugCount * Math.PI * 2);
      lugs.push(b);
    }
  }
  const tyre = new THREE.Mesh(mergeGeometries([tyreGeo.toNonIndexed(), ...lugs.map((l) => l.toNonIndexed())]), mats.rubber);
  tyre.castShadow = tyre.receiveShadow = true;
  const rimMat = new THREE.MeshPhysicalMaterial({ color: rimColor, roughness: 0.4, clearcoat: 0.4 });
  const rim = cyl(rIn * 1.02, width * 0.82, rimMat, 'z', 24);
  const disc = cyl(rIn * 0.75, width * 0.5, rimMat, 'z', 20);
  disc.position.z = width * 0.12;
  const hub = cyl(rIn * 0.3, width * 0.7, mats.dark, 'z', 12);
  hub.position.z = width * 0.18;
  g.add(tyre, rim, disc, hub);
  for (let i = 0; i < 6; i++) {
    const nut = cyl(rIn * 0.05, width * 0.1, mats.steel, 'z', 6);
    nut.position.set(Math.cos(i / 6 * Math.PI * 2) * rIn * 0.2, Math.sin(i / 6 * Math.PI * 2) * rIn * 0.2, width * 0.53);
    g.add(nut);
  }
  return g;
}

// IK for a two-link arm in a plane: from pivot (0,0) reach point (x, y) with
// link lengths a, b, elbow up. Returns absolute angles [shoulder, elbow].
export function ik2(x, y, a, b) {
  let d = Math.hypot(x, y);
  d = Math.min(Math.max(d, Math.abs(a - b) + 1e-5), a + b - 1e-5);
  const th = Math.atan2(y, x);
  const k = Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))));
  const s = th + k;
  const ex = Math.cos(s) * a, ey = Math.sin(s) * a;
  const ux = Math.cos(th) * d, uy = Math.sin(th) * d;
  return [s, Math.atan2(uy - ey, ux - ex)];
}
