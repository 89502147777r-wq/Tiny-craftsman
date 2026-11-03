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
// a plant from a model (Poly Haven, CC0, made light for phones: CREDITS.md): model — its file, k — its size
// against the real one, pick — the file holds several plants, one is taken (by the plant's turn), stakes —
// a young tree on two stakes, pot — it comes in its pot and is set down (no hole); grp — its menu group
const TREE = { ball: 600, hole: [1000, 600], mulch: 1200 }, CONIF = { ball: 400, hole: [700, 450], mulch: 900 }, BUSH = { ball: 300, hole: [500, 350], mulch: 700 }, BED = { ball: 120, hole: [300, 200], mulch: 900 }, POT = { ball: 0, hole: [0, 0], mulch: 0, pot: true };
export const PLANTS = {
  tree: { name: 'Дерево', ...TREE, usd: 180, model: 'plants/tree', stakes: true, grp: 'tree' },
  olive: { name: 'Олива', ...TREE, usd: 260, model: 'plants/tree2', k: 0.9, stakes: true, grp: 'tree' },
  wide: { name: 'Дерево раскидистое', ...TREE, usd: 220, model: 'plants/tree3', stakes: true, grp: 'tree' },
  jacaranda: { name: 'Жакаранда', ...TREE, usd: 320, model: 'plants/jacaranda', k: 0.32, stakes: true, grp: 'tree' },
  fir: { name: 'Ель', ...CONIF, usd: 90, model: 'plants/fir', k: 1.9, grp: 'tree' },
  pine: { name: 'Сосна', ...CONIF, usd: 95, model: 'plants/pine', k: 1.9, grp: 'tree' },
  thuja: { name: 'Туя «Смарагд»', ball: 350, hole: [600, 400], mulch: 700, usd: 38, H: 1700, R: 330, grp: 'bush' },
  hedge: { name: 'Живая изгородь', ball: 250, hole: [400, 350], mulch: 600, usd: 22, H: 1300, R: 260, step: 500, grp: 'bush' },
  ball: { name: 'Самшит, шар', ball: 300, hole: [500, 350], mulch: 700, usd: 45, R: 300, grp: 'bush' },
  searsia: { name: 'Кустарник вечнозелёный', ...BUSH, usd: 55, model: 'plants/searsia', grp: 'bush' },
  rooibos: { name: 'Кустарник низкий', ...BUSH, usd: 30, model: 'plants/rooibos', k: 1.5, pick: true, grp: 'bush' },
  fern: { name: 'Папоротник', ...BED, usd: 18, model: 'plants/fern', pick: true, grp: 'flower' },
  periwinkle: { name: 'Барвинок, клумба', ...BED, usd: 35, model: 'plants/periwinkle', grp: 'flower' },
  gazania: { name: 'Газания, клумба', ...BED, usd: 32, model: 'plants/gazania', k: 1.3, grp: 'flower' },
  ursinia: { name: 'Урсиния, клумба', ...BED, usd: 30, model: 'plants/ursinia', k: 1.4, grp: 'flower' },
  pot: { name: 'Сингониум в кашпо', ...POT, usd: 60, model: 'plants/pot', grp: 'pot' },
  ficus: { name: 'Фикус в кашпо', ...POT, usd: 75, model: 'plants/pot2', grp: 'pot' },
  aloe: { name: 'Алоэ в горшке', ...POT, usd: 25, model: 'plants/pot3', k: 1.6, grp: 'pot' },
  // the garden lights (12 V, the cable in a trench to them; a tall post on a small concrete footing):
  // light — how it is made (lamp()), or model — a photographed lamp (its glass glows); glow — the lit
  // ground round it (mm)
  bollard: { name: 'Светильник-столбик', ball: 120, hole: [250, 300], mulch: 0, usd: 95, light: 'bollard', glow: 1400, lgrp: 'path' },
  bollardR: { name: 'Столбик круглый 450', ball: 120, hole: [250, 300], mulch: 0, usd: 85, light: 'bollardR', glow: 1200, lgrp: 'path' },
  bollardT: { name: 'Столбик с жалюзи 900', ball: 150, hole: [300, 400], mulch: 0, usd: 140, light: 'bollardT', glow: 1800, lgrp: 'path' },
  mushroom: { name: 'Светильник-«гриб»', ball: 120, hole: [250, 300], mulch: 0, usd: 75, light: 'mushroom', glow: 1300, lgrp: 'path' },
  pagoda: { name: 'Светильник «пагода»', ball: 120, hole: [250, 300], mulch: 0, usd: 80, light: 'pagoda', glow: 1200, lgrp: 'path' },
  spot: { name: 'Грунтовый прожектор', ball: 100, hole: [200, 250], mulch: 0, usd: 70, light: 'spot', glow: 900, lgrp: 'accent' },
  inground: { name: 'Встроенный в землю', ball: 150, hole: [250, 250], mulch: 0, usd: 110, light: 'inground', glow: 700, lgrp: 'accent' },
  solar: { name: 'На солнечной батарее', ball: 60, hole: [80, 150], mulch: 0, usd: 15, light: 'solar', glow: 600, lgrp: 'path' },
  globe3: { name: 'Шар 300', ball: 150, hole: [250, 200], mulch: 0, usd: 60, light: 'globe3', glow: 1300, lgrp: 'deco' },
  globe5: { name: 'Шар 500', ball: 200, hole: [300, 200], mulch: 0, usd: 110, light: 'globe5', glow: 1900, lgrp: 'deco' },
  cube: { name: 'Куб 400', ball: 200, hole: [300, 200], mulch: 0, usd: 90, light: 'cube', glow: 1600, lgrp: 'deco' },
  modern: { name: 'Столб модерн 1,8 м', ball: 200, hole: [350, 600], mulch: 0, usd: 190, light: 'modern', glow: 2600, lgrp: 'post' },
  garden: { name: 'Фонарь садовый на столбе', ball: 250, hole: [400, 600], mulch: 0, usd: 240, light: 'garden', glow: 3000, lgrp: 'post' },
  street: { name: 'Фонарный столб 3,9 м', ball: 300, hole: [500, 800], mulch: 0, usd: 420, model: 'lights/street1', glow: 4500, lgrp: 'post' },
  lantern: { name: 'Фонарь «летучая мышь»', ball: 0, hole: [0, 0], mulch: 0, usd: 35, model: 'lights/lantern', k: 1.6, glow: 900, pot: true, lgrp: 'deco' },
  wlantern: { name: 'Фонарь деревянный', ball: 0, hole: [0, 0], mulch: 0, usd: 45, model: 'lights/wlantern', k: 1.5, glow: 1000, pot: true, lgrp: 'deco' },
};
for (const P of Object.values(PLANTS)) if (P.light || P.glow) P.light = P.light || 'model';

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
export function lamp(kind, P = {}) {
  const G = new THREE.Group(), body = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.45, metalness: 0.6 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
  const frost = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, emissive: 0xffe2b0, emissiveIntensity: 0, roughness: 0.55 });
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); G.add(o); return o; };
  const B = (w, h, d) => new THREE.BoxGeometry(MM(w), MM(h), MM(d)), C = (r0, r1, h, n = 18) => new THREE.CylinderGeometry(MM(r0), MM(r1), MM(h), n);
  let ly = 500;
  if (kind === 'bollard') {
    add(B(90, 600, 90), body, 0, MM(300), 0);
    G.userData.lens = add(B(80, 60, 92), lens, 0, MM(520), 0);
    add(B(100, 20, 100), body, 0, MM(600), 0);
  } else if (kind === 'bollardR') {
    add(C(55, 60, 360), body, 0, MM(180), 0);
    G.userData.lens = add(C(52, 52, 60), lens, 0, MM(390), 0);
    add(C(70, 62, 20), body, 0, MM(430), 0); add(C(20, 70, 12), body, 0, MM(446), 0); ly = 400;
  } else if (kind === 'bollardT') {
    add(B(140, 900, 140), body, 0, MM(450), 0).scale.set(1, 1, 1);
    G.userData.lens = add(B(120, 200, 150), lens, 0, MM(760), 0);
    for (let k = 0; k < 5; k++) add(B(150, 14, 160), body, 0, MM(675 + k * 40), 0);
    add(B(160, 24, 160), body, 0, MM(905), 0); ly = 760;
  } else if (kind === 'mushroom') {
    add(C(20, 24, 480), body, 0, MM(240), 0);
    const cap = add(new THREE.SphereGeometry(MM(150), 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, MM(480), 0); cap.scale.y = 0.45;
    G.userData.lens = add(new THREE.CircleGeometry(MM(140), 24).rotateX(Math.PI / 2), lens, 0, MM(478), 0); ly = 470;
  } else if (kind === 'pagoda') {
    add(B(50, 320, 50), body, 0, MM(160), 0);
    G.userData.lens = add(B(60, 110, 60), lens, 0, MM(380), 0);
    for (const [y, w] of [[330, 170], [390, 150], [450, 120]]) add(new THREE.ConeGeometry(MM(w * 0.75), MM(40), 4).rotateY(Math.PI / 4), body, 0, MM(y), 0);
    ly = 380;
  } else if (kind === 'inground') {
    add(C(70, 70, 30), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.9 }), 0, MM(10), 0);
    G.userData.lens = add(new THREE.CircleGeometry(MM(52), 20).rotateX(-Math.PI / 2), lens, 0, MM(26), 0); ly = 30;
  } else if (kind === 'solar') {
    add(C(9, 9, 330), body, 0, MM(165), 0); add(new THREE.ConeGeometry(MM(9), MM(80), 6).rotateX(Math.PI), body, 0, -MM(40), 0);
    G.userData.lens = add(C(38, 32, 60), frost, 0, MM(360), 0);
    add(C(45, 45, 14), body, 0, MM(397), 0);
    add(B(64, 3, 64), new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.2, metalness: 0.5 }), 0, MM(405), 0); ly = 360;
  } else if (kind === 'globe3' || kind === 'globe5') {
    const R = kind === 'globe3' ? 150 : 250;
    G.userData.lens = add(new THREE.SphereGeometry(MM(R), 28, 18), frost, 0, MM(R * 0.92), 0); ly = R;
    add(C(R * 0.35, R * 0.4, 30), body, 0, MM(15), 0);
  } else if (kind === 'cube') {
    G.userData.lens = add(B(400, 400, 400), frost, 0, MM(200), 0); ly = 200;
  } else if (kind === 'garden') {
    // (a cast base, a fluted pole, a four-sided lantern of frosted glass under a little roof with a finial)
    add(C(110, 130, 220, 8), body, 0, MM(110), 0); add(C(42, 50, 1900, 12), body, 0, MM(1170), 0); add(C(70, 50, 60, 12), body, 0, MM(2140), 0);
    G.userData.lens = add(C(120, 90, 300, 4).rotateY(Math.PI / 4), frost, 0, MM(2320), 0);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; add(B(14, 310, 14), body, Math.cos(a) * MM(98), MM(2320), Math.sin(a) * MM(98)); }
    add(new THREE.ConeGeometry(MM(180), MM(140), 4).rotateY(Math.PI / 4), body, 0, MM(2540), 0); add(new THREE.SphereGeometry(MM(25), 10, 8), body, 0, MM(2630), 0); ly = 2320;
  } else if (kind === 'modern') {
    add(B(100, 1800, 100), body, 0, MM(900), 0);
    G.userData.lens = add(B(30, 1000, 102), lens, MM(36), MM(1200), 0);
    add(B(220, 20, 220), body, 0, MM(10), 0); add(B(110, 20, 110), body, 0, MM(1810), 0); ly = 1500;
  } else {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(MM(45), MM(40), MM(110), 14), body); can.position.y = MM(90); can.rotation.x = -0.45; G.add(can);
    const l = new THREE.Mesh(new THREE.CircleGeometry(MM(36), 14), lens); l.position.set(0, MM(140), -MM(25)); l.rotation.x = -Math.PI / 2 - 0.45; G.add(l); G.userData.lens = l;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(MM(15), MM(150), 6), body); spike.rotation.x = Math.PI; spike.position.y = -MM(40); G.add(spike);
  }
  G.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  G.userData.lens.userData.lens = G.userData.lens;
  G.add(glowDisc(P.glow || 1200, kind === 'spot' ? -250 : 0)); void ly;
  return G;
}
// the light on the ground: an additive disc, bright in the middle (shown at night)
let _glowTex = null;
function glowDisc(R, dz = 0) {
  if (!_glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.35, 'rgba(255,200,130,0.45)'); gr.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace;
  }
  const glow = new THREE.Mesh(new THREE.CircleGeometry(MM(R), 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: _glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, MM(30), MM(dz)); glow.renderOrder = 6; glow.userData.glow = glow;
  return glow;
}
// a plant (or a lamp) from its model: one of the file's plants when it holds several, at its real size × s;
// a lamp's glass and bulb glow at night
function modelBody(P, s, turn) {
  const G = new THREE.Group();
  loadModel(P.model).then(({ scene }) => {
    if (P.pick) {
      const kids = scene.children.slice(), c = kids[Math.floor(Math.abs(turn) * 1000) % kids.length];
      for (const q of kids) if (q !== c) scene.remove(q);
      c.position.x = 0; c.position.z = 0;
    }
    scene.scale.setScalar(S * 1000 * s * (P.k || 1));
    if (P.light) scene.traverse((o) => {
      if (!o.isMesh || !/glass|bulb/i.test(o.material?.name || '')) return;
      o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffd9a0); o.material.emissiveIntensity = 0; o.userData.lens = o;
    });
    G.add(scene);
  }).catch(() => {});
  if (P.stakes) G.add(stakes());
  if (P.light) G.add(glowDisc(P.glow));
  return G;
}

// the plant itself (a group standing at its foot; the tree comes when its model has loaded)
export function plantBody(kind, s = 1, turn = 0) {
  const G = new THREE.Group(), P = PLANTS[kind];
  if (kind === 'ball') G.add(boxBall(P.R * s));
  else if (kind === 'thuja' || kind === 'hedge') G.add(thujaCone(P.H * s, P.R * s));
  else if (P.model) G.add(modelBody(P, P.light ? 1 : s, turn));
  else if (P.light) G.add(lamp(P.light, P));
  return G;
}
