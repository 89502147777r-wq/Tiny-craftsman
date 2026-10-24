import * as THREE from 'three';
import { TRAY, BACKDROP } from '../config.js';
import { roundedOutline } from './plotShape.js';
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
  const TW = 4.8, TD = 4.0, TT = 0.045;
  // dark grey worn laminate top, as on the real workbench (dust, scratches)
  const tableMat = new THREE.MeshStandardMaterial({
    map: worktopTexture(), roughness: 0.62, metalness: 0.05, color: 0xffffff,
    normalMap: variant(tex.table.nor, TW / 0.55, TD / 0.55), normalScale: new THREE.Vector2(0.15, 0.15),
  });
  tableMat.map.repeat.set(TW / 1.2, TD / 1.2);
  const table = new THREE.Mesh(new THREE.BoxGeometry(TW, TT, TD), tableMat);
  table.position.set(0.1, TRAY.base - TT / 2, -0.2);
  table.receiveShadow = true;
  table.name = 'table';
  group.add(table);

  // ---- the box --------------------------------------------------------------
  // the box: light grey wood-grain laminate boards, as on the real table
  const plyFace = new THREE.MeshStandardMaterial({ map: laminateTexture(), roughness: 0.7, metalness: 0 });
  plyFace.map.repeat.set(1 / 0.6, 1 / 0.1);
  const W = TRAY.wall, OX = TRAY.innerX + 2 * W, OZ = TRAY.innerZ + 2 * W;
  const tray = new THREE.Group();
  tray.name = 'tray';
  // bottom board and walls: one plywood frame with a rounded corner where the
  // photo backdrop wraps round the box (extruded outlines, caps = ply edges)
  const shapeOf = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const outer = roundedOutline(OX / 2, OZ / 2, BACKDROP.radius);
  const inner = roundedOutline(TRAY.innerX / 2, TRAY.innerZ / 2, BACKDROP.radius - W);
  const extrude = (shape, h) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 24 });
    g.rotateX(-Math.PI / 2);
    return g;
  };
  // plywood end grain: layered stripes along the thickness
  const plies = plyEdgeTexture(false);
  plies.wrapS = plies.wrapT = THREE.RepeatWrapping;
  const sideBottom = new THREE.MeshStandardMaterial({ map: plies, roughness: 0.85, color: 0xeee2d2 });
  sideBottom.map = plies.clone(); sideBottom.map.repeat.set(20, 1 / 0.010); sideBottom.map.needsUpdate = true;
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe2ded5, roughness: 0.75 });
  const bottom = new THREE.Mesh(extrude(shapeOf(outer), 0.010), [plyFace, sideBottom]);
  bottom.position.y = TRAY.base;
  tray.add(bottom);
  const wallH = TRAY.height - TRAY.floor;
  const frame = shapeOf(outer);
  frame.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, -z))));
  const walls = new THREE.Mesh(extrude(frame, wallH), [rimMat, plyFace]);
  walls.position.y = TRAY.floor;
  tray.add(walls);
  tray.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(tray);

  // ---- steel ruler -----------------------------------------------------------------
  const rulerTop = new THREE.MeshStandardMaterial({ map: rulerTexture(), metalness: 0.85, roughness: 0.38, color: 0xd8dde2 });
  const rulerSide = new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.9, roughness: 0.3 });
  const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.0009, 0.026), [rulerSide, rulerSide, rulerTop, rulerSide, rulerSide, rulerSide]);
  ruler.position.set(-0.35, TRAY.base + 0.00045, TRAY.innerZ / 2 + TRAY.wall + 0.09);
  ruler.rotation.y = 0.05;
  ruler.castShadow = true; ruler.receiveShadow = true;
  ruler.userData.prop = true;
  group.add(ruler);

  // ---- pencil ---------------------------------------------------------------------
  const pencil = makePencil();
  pencil.position.set(0.25, TRAY.base + 0.0037, TRAY.innerZ / 2 + TRAY.wall + 0.14);
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
    p.y = TRAY.base + s.y * 0.6;
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

// light grey laminate with a fine horizontal wood grain (u: 0.6 m, v: 0.1 m per tile)
function laminateTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#cfccc5'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 520; i++) {
    const y = Math.random() * c.height, a = 0.03 + Math.random() * 0.12;
    g.strokeStyle = Math.random() < 0.7 ? `rgba(90,86,78,${a})` : `rgba(255,255,250,${a})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    const x0 = Math.random() * c.width - 200, len = 200 + Math.random() * 900;
    g.moveTo(x0, y);
    for (let x = x0; x < x0 + len; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 1.5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// dark grey worktop: mottled, with fine scratches and specks of sand
function worktopTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#4b4d50'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 260; i++) {
    const r = 20 + Math.random() * 120;
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    const v = Math.random() < 0.5 ? '255,255,255' : '0,0,0';
    gr.addColorStop(0, `rgba(${v},0.05)`); gr.addColorStop(1, `rgba(${v},0)`);
    g.save(); g.translate(Math.random() * 1024, Math.random() * 1024); g.fillStyle = gr; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore();
  }
  for (let i = 0; i < 400; i++) {
    g.strokeStyle = `rgba(220,220,215,${0.04 + Math.random() * 0.1})`; g.lineWidth = 0.5 + Math.random();
    const x = Math.random() * 1024, y = Math.random() * 1024, a = Math.random() * Math.PI, l = 10 + Math.random() * 90;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${170 + Math.random() * 40},${140 + Math.random() * 30},${90 + Math.random() * 20},${0.3 + Math.random() * 0.5})`; g.fillRect(Math.random() * 1024, Math.random() * 1024, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
