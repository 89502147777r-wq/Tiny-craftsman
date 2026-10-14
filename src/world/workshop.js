import * as THREE from 'three';
import { TRAY } from '../config.js';
import { variant } from './assets.js';
import { mulberry32 } from '../core/rand.js';

// The real-size scene around the diorama: workbench, plywood tray, a steel
// ruler and pencil for scale, the workshop HDRI and a warm work lamp.
export function buildWorkshop(scene, renderer, tex) {
  const group = new THREE.Group();
  group.name = 'workshop';
  scene.add(group);

  // ---- environment ---------------------------------------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(tex.env);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.8;
  scene.background = tex.env;
  scene.backgroundBlurriness = 0.12;
  scene.backgroundIntensity = 0.75;
  scene.backgroundRotation.set(0, 2.2, 0);
  scene.environmentRotation.set(0, 2.2, 0);
  pmrem.dispose();

  // ---- lamp ------------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffd6ad, 2.7);
  sun.position.set(-0.5, 0.95, -0.34);
  sun.target.position.set(0, 0.03, 0);
  sun.userData.dir = sun.position.clone().normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -0.5; sc.right = 0.5; sc.top = 0.5; sc.bottom = -0.5; sc.near = 0.05; sc.far = 6;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.0007;
  group.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 0.35);
  rim.position.set(0.5, 0.3, 0.6);
  group.add(rim);

  // ---- workbench ---------------------------------------------------------------
  const TW = 3.8, TD = 3.3, TT = 0.045;
  const tableMat = new THREE.MeshStandardMaterial({
    map: variant(tex.table.diff, TW / 0.55, TD / 0.55),
    normalMap: variant(tex.table.nor, TW / 0.55, TD / 0.55),
    roughnessMap: variant(tex.table.arm, TW / 0.55, TD / 0.55),
    roughness: 1, metalness: 0,
    color: 0xd9cfc4,
  });
  const table = new THREE.Mesh(new THREE.BoxGeometry(TW, TT, TD), tableMat);
  table.position.set(0.1, -TT / 2, -0.2);
  table.receiveShadow = true;
  table.name = 'table';
  group.add(table);

  // ---- plywood tray --------------------------------------------------------------
  const plyFace = new THREE.MeshStandardMaterial({
    map: variant(tex.ply.diff, 0.6, 0.25), normalMap: variant(tex.ply.nor, 0.6, 0.25),
    roughnessMap: variant(tex.ply.arm, 0.6, 0.25), roughness: 1, metalness: 0, color: 0xe8ddd0,
  });
  const edgeH = new THREE.MeshStandardMaterial({ map: plyEdgeTexture(false), roughness: 0.85, color: 0xeee2d2 });
  const edgeV = new THREE.MeshStandardMaterial({ map: plyEdgeTexture(true), roughness: 0.85, color: 0xeee2d2 });
  const W = TRAY.wall, OX = TRAY.innerX + 2 * W, OZ = TRAY.innerZ + 2 * W;
  const tray = new THREE.Group();
  tray.name = 'tray';
  // bottom board
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(OX, TRAY.floor, OZ), [edgeV, edgeV, plyFace, plyFace, edgeV, edgeV]);
  bottom.position.y = TRAY.floor / 2;
  tray.add(bottom);
  // walls: px, nx, py, ny, pz, nz
  const wallH = TRAY.height - TRAY.floor;
  const longGeo = new THREE.BoxGeometry(OX, wallH, W);
  const shortGeo = new THREE.BoxGeometry(TRAY.innerZ, wallH, W);
  const wallMats = [edgeV, edgeV, edgeH, plyFace, plyFace, plyFace];
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(longGeo, wallMats);
    a.position.set(0, TRAY.floor + wallH / 2, s * (TRAY.innerZ / 2 + W / 2));
    const b = new THREE.Mesh(shortGeo, wallMats);
    b.rotation.y = Math.PI / 2;
    b.position.set(s * (TRAY.innerX / 2 + W / 2), TRAY.floor + wallH / 2, 0);
    tray.add(a, b);
  }
  tray.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(tray);

  // ---- steel ruler -----------------------------------------------------------------
  const rulerTop = new THREE.MeshStandardMaterial({ map: rulerTexture(), metalness: 0.85, roughness: 0.38, color: 0xd8dde2 });
  const rulerSide = new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.9, roughness: 0.3 });
  const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.0009, 0.026), [rulerSide, rulerSide, rulerTop, rulerSide, rulerSide, rulerSide]);
  ruler.position.set(-0.35, 0.00045, TRAY.innerZ / 2 + TRAY.wall + 0.09);
  ruler.rotation.y = 0.05;
  ruler.castShadow = true; ruler.receiveShadow = true;
  ruler.userData.prop = true;
  group.add(ruler);

  // ---- pencil ---------------------------------------------------------------------
  const pencil = makePencil();
  pencil.position.set(0.25, 0.0037, TRAY.innerZ / 2 + TRAY.wall + 0.14);
  pencil.rotation.y = 1.1;
  pencil.userData.prop = true;
  group.add(pencil);

  // ---- soil crumbs that missed the tray ------------------------------------------
  const rnd = mulberry32(3);
  const crumbGeo = new THREE.IcosahedronGeometry(1, 0);
  const crumbMat = new THREE.MeshStandardMaterial({ map: tex.wall.diff, roughness: 1, color: 0x8a7a6a });
  const crumbs = new THREE.InstancedMesh(crumbGeo, crumbMat, 70);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < crumbs.count; i++) {
    const side = rnd() < 0.6 ? 1 : -1;
    const spill = 0.004 + Math.pow(rnd(), 2.2) * 0.05;
    if (rnd() < 0.5) p.set((rnd() - 0.5) * OX, 0, side * (OZ / 2 + spill)); else p.set(side * (OX / 2 + spill), 0, (rnd() - 0.5) * OZ);
    const r = 0.0004 + Math.pow(rnd(), 3) * 0.0016;
    s.set(r * (0.8 + rnd() * 0.5), r * (0.5 + rnd() * 0.3), r * (0.8 + rnd() * 0.5));
    p.y = s.y * 0.6;
    q.setFromEuler(e.set(rnd() * 6, rnd() * 6, rnd() * 6));
    crumbs.setMatrixAt(i, m.compose(p, q, s));
  }
  crumbs.castShadow = true; crumbs.receiveShadow = true;
  crumbs.userData.prop = true;
  group.add(crumbs);

  return { group, sun, table, tray, followShadow };
}

// The shadow map covers what the camera sees: an area around the target that
// grows with the distance and reaches further ahead of the camera (where the
// view widens), so every machine, clod and tuft on screen stands in its shadow.
const _c = new THREE.Vector3();
function followShadow(sun, target, dist, yaw = 0) {
  const ext = Math.min(2.6, Math.max(0.3, dist * 1.5));
  const sc = sun.shadow.camera;
  if (Math.abs(sc.right - ext) > ext * 0.08) {
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.far = 6 + ext * 2;
    sc.updateProjectionMatrix();
  }
  // shift the box away from the camera: the far side of the frame is wider
  const ax = target.x - Math.sin(yaw) * ext * 0.35, az = target.z - Math.cos(yaw) * ext * 0.35;
  // snap to whole shadow texels so the edges do not crawl while panning
  const texel = (2 * sc.right) / sun.shadow.mapSize.x;
  _c.set(Math.round(ax / texel) * texel, Math.max(0.03, target.y - 0.04), Math.round(az / texel) * texel);
  sun.target.position.copy(_c);
  sun.position.copy(_c).addScaledVector(sun.userData.dir, 3 + ext);
  sun.target.updateMatrixWorld();
}

function plyEdgeTexture(vertical) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const plies = ['#d9b98c', '#b48d5e', '#dcbd90', '#a98352', '#d6b689', '#b08a5a', '#dbbb8e'];
  const k = 64 / plies.length;
  plies.forEach((col, i) => {
    g.fillStyle = col;
    if (vertical) g.fillRect(i * k, 0, k + 1, 64); else g.fillRect(0, i * k, 64, k + 1);
  });
  g.globalAlpha = 0.18;
  for (let i = 0; i < 300; i++) { g.fillStyle = Math.random() < 0.5 ? '#5a3d1e' : '#fff3dc'; g.fillRect(Math.random() * 64, Math.random() * 64, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rulerTexture() {
  const c = document.createElement('canvas');
  c.width = 4096; c.height = 336;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, '#c9ced3'); grd.addColorStop(0.5, '#e4e7ea'); grd.addColorStop(1, '#c4c9ce');
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  // brushed steel streaks
  g.globalAlpha = 0.07;
  for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; g.fillRect(Math.random() * c.width, Math.random() * c.height, 200 + Math.random() * 900, 1); }
  g.globalAlpha = 1;
  const pxPerMm = c.width / 320; // texture spans 320 mm, scale starts 10 mm in
  g.fillStyle = '#111';
  for (let mm = 0; mm <= 300; mm++) {
    const x = (10 + mm) * pxPerMm;
    const len = mm % 10 === 0 ? 100 : mm % 5 === 0 ? 70 : 42;
    g.fillRect(x - 1.5, 0, 3, len);
  }
  g.font = '600 58px Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  for (let cm = 0; cm <= 30; cm++) g.fillText(String(cm), (10 + cm * 10) * pxPerMm, 170);
  g.font = '500 34px Helvetica, Arial, sans-serif';
  g.textAlign = 'left';
  g.fillText('INOX  300 mm', 60 * pxPerMm, 290);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makePencil() {
  const g = new THREE.Group();
  const L = 0.15, R = 0.0037;
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xe0a21a, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 6), paint);
  body.rotation.z = Math.PI / 2;
  const wood = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, 0.0009, 0.018, 18), new THREE.MeshStandardMaterial({ color: 0xd9b48a, roughness: 0.8 }));
  wood.rotation.z = -Math.PI / 2; wood.position.x = L / 2 + 0.009;
  const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0001, 0.004, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.35, metalness: 0.4 }));
  lead.rotation.z = -Math.PI / 2; lead.position.x = L / 2 + 0.018 + 0.002;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.012, 24), new THREE.MeshStandardMaterial({ color: 0xbfc3c7, metalness: 1, roughness: 0.35 }));
  cap.rotation.z = Math.PI / 2; cap.position.x = -L / 2 - 0.006;
  const eraser = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.008, 24), new THREE.MeshStandardMaterial({ color: 0xe48a8a, roughness: 0.9 }));
  eraser.rotation.z = Math.PI / 2; eraser.position.x = -L / 2 - 0.016;
  g.add(body, wood, lead, cap, eraser);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
