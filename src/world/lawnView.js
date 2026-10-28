import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { LAWN, cellsOf, frameW } from './lawn.js';

// The lawn drawn (lawn.js): its outline sprayed on the ground; the topsoil (spread, raked, rolled —
// each showing as far as it has got); the grass: turf rolled out roll by roll (the seams seen until
// it is watered), or the seed coming up; the roll being laid, the garden roller, the sprinkler.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const TEX = {};
function tex(folder, file, srgb) {
  const key = folder + '/' + file;
  if (TEX[key]) return TEX[key];
  const t = new THREE.TextureLoader().load(`assets/textures/${folder}/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[key] = t);
}
export const lawnUniforms = () => ({ uF: { value: -1e9 }, uR: { value: -1e9 }, uK: { value: -1e9 }, uLay: { value: -1 }, uGrow: { value: 0 }, uWater: { value: 0 }, uWet: { value: 0 }, uShell: { value: 0 } });

// the cells as quads over the ground (corner heights from the terrain), with what the shaders need
function cellGeo(app, r, cells, lift) {
  const t = app.terrain, C = MM(LAWN.cell), H = new Map(), pos = [], uv = [], aA = [], aRoll = [], aU = [], aV = [];
  const h = (a, b) => { const k = Math.round(a / C * 2) + ':' + Math.round(b / C * 2); let y = H.get(k); if (y === undefined) { const [x, z] = frameW(r, a, b); y = t.inside(x, z) ? t.heightAt(x, z) : r.g; H.set(k, y); } return y; };
  const RL = LAWN.roll[0], RW = LAWN.roll[1], du = LAWN.cell / RL, dv = LAWN.cell / RW;
  for (const c of cells) {
    const a0 = c.a - C / 2, a1 = c.a + C / 2, b0 = c.b - C / 2, b1 = c.b + C / 2;
    const q = [[a0, b0, -0.5, -0.5], [a1, b0, 0.5, -0.5], [a1, b1, 0.5, 0.5], [a0, b1, -0.5, 0.5]];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      const [a, b, su, sv] = q[k], [x, z] = frameW(r, a, b);
      pos.push(x, h(a, b) + lift, z); uv.push(x / MM(1200), z / MM(1200)); aA.push(a / S);
      aRoll.push(c.roll); aU.push(Math.max(0, Math.min(1, c.ru + su * du))); aV.push(Math.max(0, Math.min(1, c.rv + sv * dv)));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 1));
  g.setAttribute('aRoll', new THREE.Float32BufferAttribute(aRoll, 1));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(aU, 1));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(aV, 1));
  g.computeVertexNormals();
  return g;
}
const VARS = 'attribute float aA;\nattribute float aRoll;\nattribute float aU;\nattribute float aV;\nvarying float vA;\nvarying float vRoll;\nvarying float vU;\nvarying float vV;\n';
const PASS = 'vA = aA; vRoll = aRoll; vU = aU; vV = aV;';
const FVARS = 'varying float vA;\nvarying float vRoll;\nvarying float vU;\nvarying float vV;\nuniform float uF;\nuniform float uR;\nuniform float uK;\nuniform float uLay;\nuniform float uGrow;\nuniform float uWater;\nuniform float uWet;\nuniform float uShell;\n';
function hook(mat, U, key, frag, vert = '') {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = VARS + 'uniform float uShell;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${PASS}\n${vert}`);
    sh.fragmentShader = FVARS + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${frag}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
// the topsoil: dark, crumbly; smoother where raked, with the roller's lanes once rolled
function soilMat(U) {
  return hook(new THREE.MeshStandardMaterial({ map: tex('forest_ground_06', 'diff.jpg', true), normalMap: tex('forest_ground_06', 'nor_gl.jpg', false), color: 0x5a4434, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), U, 'lawnSoil', `
    if (vA > uF) discard;
    float raked = step(vA, uR), rolled = step(vA, uK);
    diffuseColor.rgb *= mix(0.78 + 0.3 * fract(sin(dot(floor(vMapUv * 60.0), vec2(12.9, 78.2))) * 43758.5), 1.0, raked);
    diffuseColor.rgb *= 1.0 + rolled * (0.06 + 0.05 * step(0.5, fract(vV * 0.0 + vA / 900.0)));`);
}
// the grass: turf laid roll by roll (the seams dark until watered) or the seed coming up; shells over
// it give the blades their depth
function grassMat(U, shell, seed) {
  const m = new THREE.MeshStandardMaterial({ map: tex('lawn', 'col.jpg', true), normalMap: tex('lawn', 'nor.jpg', false), roughness: 0.92, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -4 - shell, polygonOffsetUnits: -4 - shell });
  const Us = { ...U, uShell: { value: shell } };
  return hook(m, Us, 'lawnGrass' + (seed ? 'S' : 'T'), `
    float laid = ${seed ? '1.0' : 'step(vRoll + vU, uLay)'};
    if (laid < 0.5) discard;
    float nz = fract(sin(dot(floor(vMapUv * 900.0), vec2(12.9898, 78.233))) * 43758.5453);
    ${seed ? 'if (nz > uGrow * (1.15 - 0.25 * uShell)) discard;' : ''}
    if (uShell > 0.5 && nz < 0.35 + 0.18 * uShell) discard;
    float seam = ${seed ? '0.0' : '(1.0 - smoothstep(0.0, 0.04, min(vU, 1.0 - vU)) * smoothstep(0.0, 0.12, min(vV, 1.0 - vV)))'};
    diffuseColor.rgb *= (1.0 - 0.55 * seam * (1.0 - uWater)) * (0.82 + 0.25 * uWater) * (0.85 + 0.08 * uShell);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.9, 0.85), uWet * 0.5);`,
  `transformed.y += uShell * ${MM(9).toFixed(8)};`);
}

export function buildLawn(app, r, U) {
  const G = new THREE.Group(), d = r.done || {}, cells = cellsOf(app, r);
  G.userData.nRolls = cells.nRolls; G.userData.a0 = cells.a0 / S; G.userData.a1 = cells.a1 / S;
  if (!cells.length) return G;
  const soil = new THREE.Mesh(cellGeo(app, r, cells, MM(6)), soilMat(U)); soil.receiveShadow = true; G.add(soil);
  const seed = r.how === 'seed', geo = cellGeo(app, r, cells, MM(10));
  for (let k = 0; k < 3; k++) { const o = new THREE.Mesh(geo, grassMat(U, k, seed)); o.receiveShadow = k === 0; o.userData.keepGeo = k > 0; G.add(o); }
  void d;
  return G;
}
// the outline sprayed on the ground (white marking paint)
export function lawnLine(app, r) {
  const t = app.terrain, pts = [];
  for (let i = 0; i <= r.poly.length; i++) {
    const [x0, z0] = r.poly[i % r.poly.length], [x1, z1] = r.poly[(i + 1) % r.poly.length];
    if (i === r.poly.length) break;
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / MM(200)));
    for (let k = 0; k < n; k++) { const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n; pts.push(new THREE.Vector3(x, (t.inside(x, z) ? t.heightAt(x, z) : r.g) + MM(15), z)); }
  }
  pts.push(pts[0].clone());
  const L = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf4f4ee }));
  const G = new THREE.Group(); G.add(L);
  return G;
}
// the ghost while it is drawn: the area filled
export function lawnGhost(r) {
  const shape = new THREE.Shape(r.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, r.g + MM(10), 0);
  const o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x7fe08a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
  o.renderOrder = 5;
  return o;
}
// a roll of turf (laid out from it), the garden roller, the sprinkler
export function turfRoll() {
  const g = new THREE.CylinderGeometry(MM(130), MM(130), MM(400), 20); g.rotateZ(Math.PI / 2);
  const m = [new THREE.MeshStandardMaterial({ map: tex('forest_ground_06', 'diff.jpg', true), color: 0x6b5340, roughness: 1 }), new THREE.MeshStandardMaterial({ map: tex('lawn', 'col.jpg', true), roughness: 0.9 })];
  const o = new THREE.Mesh(g, m[1]); o.castShadow = true;
  return o;
}
export function roller() {
  const G = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x3b4a3f, roughness: 0.5, metalness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.6, metalness: 0.4 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(MM(160), MM(160), MM(600), 24), steel); drum.rotation.z = Math.PI / 2; drum.position.y = MM(160); G.add(drum);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(MM(12), MM(12), MM(1150), 8), dark);
    arm.position.set(s * MM(260), MM(160) + MM(480), -MM(330)); arm.rotation.x = -0.62; G.add(arm);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(MM(14), MM(14), MM(560), 8), dark); bar.rotation.z = Math.PI / 2; bar.position.set(0, MM(160) + MM(950), -MM(680)); G.add(bar);
  G.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return G;
}
export function sprinkler() {
  const G = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x2d7d3a, roughness: 0.5 }), y = new THREE.MeshStandardMaterial({ color: 0xe6c229, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(MM(90), MM(110), MM(40), 16), m); base.position.y = MM(20); G.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(MM(12), MM(12), MM(160), 8), y); post.position.y = MM(120); G.add(post);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(MM(25), MM(25), MM(30), 10), y); head.position.y = MM(210); G.add(head);
  G.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return G;
}
