import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadModel } from './machines/models.js';

// The plants, planted as a gardener plants them: a hole twice the root ball's width dug, the plant
// (balled in hessian) lowered in, the soil back round it, watered in, mulched with bark; a tree
// also gets two stakes and a tie. A hedge: a trench along the line, a plant every 500.
//   plant { kind: 'tree' | 'ball' | 'thuja' | 'hedge', x, z (or pts for a hedge), g, s (its size
//           against the standard), rot }
// The tree is a photographed model (Poly Haven, CC0, simplified for phones: CREDITS.md); the clipped
// shrubs are made of leaf clusters (cards) round their shape.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const PLANTS = {
  tree: { name: 'Дерево', ball: 600, hole: [1000, 600], mulch: 1200, usd: 180 },
  ball: { name: 'Самшит, шар', ball: 300, hole: [500, 350], mulch: 700, usd: 45, R: 300 },
  thuja: { name: 'Туя «Смарагд»', ball: 350, hole: [600, 400], mulch: 700, usd: 38, H: 1700, R: 330 },
  hedge: { name: 'Живая изгородь', ball: 250, hole: [400, 350], mulch: 600, usd: 22, H: 1300, R: 260, step: 500 },
  // the garden lights (12 V, the cable in a trench to them): a bollard by a path, a spot at a tree's foot
  bollard: { name: 'Светильник-столбик', ball: 120, hole: [250, 300], mulch: 0, usd: 95, light: 'bollard' },
  spot: { name: 'Грунтовый прожектор', ball: 100, hole: [200, 250], mulch: 0, usd: 70, light: 'spot' },
};
export const hedgePlants = (r) => {
  const out = [];
  for (let i = 1; i < r.pts.length; i++) {
    const [x0, z0] = r.pts[i - 1], [x1, z1] = r.pts[i], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / MM(PLANTS.hedge.step)));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
  }
  return out;
};
// each place a plant stands (a hedge: each of its plants)
export const spotsOf = (r) => (r.kind === 'hedge' ? hedgePlants(r) : [[r.x, r.z]]);

// ---- the leaves -------------------------------------------------------------------------------------
// a cluster of small leaves on a transparent card (drawn once): boxwood's small round leaves, thuja's scales
const _cards = {};
function leafCard(kind) {
  if (_cards[kind]) return _cards[kind];
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  let seed = kind === 'thuja' ? 7 : 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const greens = kind === 'thuja' ? [[44, 82, 30], [58, 98, 36], [36, 68, 26], [72, 110, 42]] : [[38, 74, 30], [52, 92, 38], [30, 62, 26], [64, 102, 44]];
  for (let i = 0; i < (kind === 'thuja' ? 70 : 55); i++) {
    const x = n / 2 + (rnd() - 0.5) * n * 0.78, y = n / 2 + (rnd() - 0.5) * n * 0.78;
    if (Math.hypot(x - n / 2, y - n / 2) > n * 0.42) continue;
    const [r, gg, b] = greens[Math.floor(rnd() * greens.length)], k = 0.8 + rnd() * 0.4;
    g.fillStyle = `rgb(${r * k | 0},${gg * k | 0},${b * k | 0})`;
    g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI * 2);
    g.beginPath();
    if (kind === 'thuja') { g.ellipse(0, 0, 5, 16, 0, 0, Math.PI * 2); } else { g.ellipse(0, 0, 9, 13, 0, 0, Math.PI * 2); }
    g.fill();
    g.fillStyle = 'rgba(255,255,230,0.18)'; g.beginPath(); g.ellipse(-2, -3, 3, 6, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (_cards[kind] = t);
}
// a shape covered in cards: the shape's surface (point, normal) from f(u, v) over [0, 1]²
function foliage(kind, n, size, f, core) {
  const G = new THREE.Group(), m = new THREE.MeshStandardMaterial({ map: leafCard(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  const geo = new THREE.PlaneGeometry(1, 1), im = new THREE.InstancedMesh(geo, m, n);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const q = new THREE.Quaternion(), M = new THREE.Matrix4(), col = new THREE.Color(), up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    const [p, nrm] = f(rnd(), rnd(), rnd());
    const dir = nrm.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.1)).normalize();
    q.setFromUnitVectors(up, dir); q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28));
    const s = size * (0.8 + rnd() * 0.5);
    M.compose(p, q, new THREE.Vector3(s, s, s)); im.setMatrixAt(i, M);
    im.setColorAt(i, col.setScalar(0.75 + rnd() * 0.4));
  }
  im.castShadow = true; im.receiveShadow = true;
  G.add(im);
  if (core) { const o = new THREE.Mesh(core, new THREE.MeshStandardMaterial({ color: kind === 'thuja' ? 0x17240f : 0x1d3418, roughness: 0.9 })); o.castShadow = true; G.add(o); }
  return G;
}
// a boxwood clipped to a ball (R real mm), standing on the ground
export function boxBall(R) {
  const r = MM(R);
  return foliage('ball', Math.round(260 * (R / 300) ** 2), r * 0.5, (u, v, w) => {
    const th = u * Math.PI * 2, ph = Math.acos(1 - 2 * Math.min(0.92, v)), rr = r * (0.88 + w * 0.12);
    const n = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    return [n.clone().multiplyScalar(rr).add(new THREE.Vector3(0, r * 0.92, 0)), n];
  }, new THREE.SphereGeometry(r * 0.86, 16, 12).translate(0, r * 0.92, 0));
}
// a thuja 'Smaragd': a narrow cone (H, R real mm) on a short stem
export function thujaCone(H, R) {
  const h = MM(H), r = MM(R);
  const n = Math.round(1700 * (H / 1700) * (R / 330));
  return foliage('thuja', n, r * 0.55, (u, v, w) => {
    const y = h * (0.01 + 0.99 * Math.sqrt(v) * 0.999), k = 1 - (y - h * 0.01) / (h * 0.99), rad = r * (0.25 + 0.75 * Math.sin(Math.min(1, k * 1.25) * Math.PI / 2)) * (0.72 + w * 0.3), th = u * Math.PI * 2;
    const n2 = new THREE.Vector3(Math.cos(th), 0.35, Math.sin(th)).normalize();
    return [new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad), n2];
  }, new THREE.ConeGeometry(r * 0.62, h * 0.8, 14).translate(0, h * 0.5, 0));
}
// the root ball in hessian, the mulch ring of bark, two stakes with a tie
export function rootBall(D) {
  const o = new THREE.Mesh(new THREE.SphereGeometry(MM(D / 2), 14, 10), new THREE.MeshStandardMaterial({ color: 0x8a6e4b, roughness: 1 }));
  o.scale.y = 0.75; o.position.y = -MM(D * 0.32); o.castShadow = true;
  return o;
}
let _mulch = null;
function mulchTex() {
  if (_mulch) return _mulch;
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  g.fillStyle = '#3f2a1c'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 1400; i++) { const k = Math.random(); g.fillStyle = `rgb(${90 + k * 70 | 0},${58 + k * 40 | 0},${34 + k * 22 | 0})`; g.save(); g.translate(Math.random() * n, Math.random() * n); g.rotate(Math.random() * 6.28); g.fillRect(-4 - Math.random() * 5, -1.5, 8 + Math.random() * 10, 3 + Math.random() * 2); g.restore(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return (_mulch = t);
}
export function mulchDisc(D) {
  const g = new THREE.CircleGeometry(MM(D / 2), 28); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * D / 400, uv.getY(i) * D / 400);
  const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: mulchTex(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  o.position.y = MM(25); o.receiveShadow = true;
  return o;
}
export function mulchStrip(pts, W) {
  const G = new THREE.Group();
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], L = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.PlaneGeometry(L + MM(W), MM(W)); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (L / S + W) / 400, uv.getY(k) * W / 400);
    const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: mulchTex(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    o.position.set((x0 + x1) / 2, MM(25), (z0 + z1) / 2); o.rotation.y = -Math.atan2(z1 - z0, x1 - x0); o.receiveShadow = true;
    G.add(o);
  }
  return G;
}
export function stakes() {
  const G = new THREE.Group(), w = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.85 });
  for (const s of [-1, 1]) { const o = new THREE.Mesh(new THREE.CylinderGeometry(MM(25), MM(25), MM(1800), 8), w); o.position.set(s * MM(300), MM(600), 0); o.castShadow = true; G.add(o); }
  const tie = new THREE.Mesh(new THREE.BoxGeometry(MM(620), MM(30), MM(12)), new THREE.MeshStandardMaterial({ color: 0x2d2d2a, roughness: 0.7 })); tie.position.y = MM(1300); G.add(tie);
  return G;
}
// a garden light: an anthracite bollard 600 high with its lens under a hood; a spot on a spike, tilted up.
// The lens glows at night (userData.lens); the ground round it is lit by a soft disc (userData.glow)
export function lamp(kind) {
  const G = new THREE.Group(), body = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.45, metalness: 0.6 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
  if (kind === 'bollard') {
    const post = new THREE.Mesh(new THREE.BoxGeometry(MM(90), MM(600), MM(90)), body); post.position.y = MM(300); G.add(post);
    const l = new THREE.Mesh(new THREE.BoxGeometry(MM(80), MM(60), MM(92)), lens); l.position.y = MM(520); G.add(l); G.userData.lens = l;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(MM(100), MM(20), MM(100)), body); hood.position.y = MM(600); G.add(hood);
  } else {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(MM(45), MM(40), MM(110), 14), body); can.position.y = MM(90); can.rotation.x = -0.45; G.add(can);
    const l = new THREE.Mesh(new THREE.CircleGeometry(MM(36), 14), lens); l.position.set(0, MM(140), -MM(25)); l.rotation.x = -Math.PI / 2 - 0.45; G.add(l); G.userData.lens = l;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(MM(15), MM(150), 6), body); spike.rotation.x = Math.PI; spike.position.y = -MM(40); G.add(spike);
  }
  G.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // (the light on the ground: an additive disc, bright in the middle)
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.35, 'rgba(255,200,130,0.45)'); gr.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(new THREE.CircleGeometry(MM(kind === 'bollard' ? 1400 : 900), 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, MM(30), kind === 'spot' ? -MM(250) : 0); glow.renderOrder = 6; G.add(glow); G.userData.glow = glow;
  return G;
}

// the plant itself (a group standing at its foot; the tree comes when its model has loaded)
export function plantBody(kind, s = 1) {
  const G = new THREE.Group(), P = PLANTS[kind];
  if (kind === 'ball') G.add(boxBall(P.R * s));
  else if (kind === 'thuja' || kind === 'hedge') G.add(thujaCone(P.H * s, P.R * s));
  else if (P.light) G.add(lamp(P.light));
  else if (kind === 'tree') {
    loadModel('plants/tree').then(({ scene }) => { scene.scale.setScalar(S * 1000 * s); G.add(scene); }).catch(() => {});
    G.add(stakes());
  }
  return G;
}
