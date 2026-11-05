import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// What stands about a building site (the owner's picture: the site office, the toilet, the mixer, the pallets of blocks
// in their film, the timber on its bearers, a barrow, cones at the gate, a skip, a heap of sand) — each a record
// { type: 'siteprop', kind, x, z, yaw } the finger moves, turns or takes away (sitePropTool.js) when it is in the way.
// Drawn here, each of simple parts in its real size (mm), on what it stands on (blocks, a pallet, bearers).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const PROPS = {
  cabin: { name: 'Бытовка', r: 3200 },
  toilet: { name: 'Биотуалет', r: 700 },
  mixer: { name: 'Бетономешалка', r: 1000 },
  pallet: { name: 'Поддон с блоками', r: 800 },
  timber: { name: 'Штабель досок', r: 3100 },
  barrow: { name: 'Тачка', r: 800 },
  cones: { name: 'Конусы', r: 900 },
  skip: { name: 'Контейнер для мусора', r: 2100 },
  sand: { name: 'Куча песка', r: 1600 },
};
// where they stand at first (m, in the plot's frame: x along it, z towards the street; clear of the gate and the middle)
export const PROP_SEED = [
  ['cabin', -13.2, -10.6, 0], ['toilet', -8.9, -11.6, 0], ['skip', 13.0, -10.4, 0.2], ['sand', 12.6, 7.4, 0],
  ['pallet', 6.2, 10.6, 0], ['pallet', 7.7, 10.6, 0], ['pallet', 9.2, 10.6, 0.05], ['timber', -10.5, 10.4, 0],
  ['mixer', 3.6, 8.6, 0.6], ['barrow', 4.9, 7.0, -0.9], ['cones', 0, 11.4, 0],
];

const MATS = {};
let _tex = null;
export const setPropTex = (t) => { _tex = t; };   // (the game's ground photos: the sand heap is of the plot's sand)
const mat = (k, o) => (MATS[k] ||= new THREE.MeshStandardMaterial(o));
const box = (g, m, w, h, d, x, y, z, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(MM(w), MM(h), MM(d)), m); b.position.set(MM(x), MM(y), MM(z)); b.rotation.y = ry; g.add(b); return b; };
const cyl = (g, m, r0, r1, h, x, y, z, seg = 16) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(MM(r0), MM(r1), MM(h), seg), m); c.position.set(MM(x), MM(y), MM(z)); g.add(c); return c; };

// a texture of vertical ribs (the site office's profiled sheet)
let _ribs = null;
function ribs() {
  if (_ribs) return _ribs;
  const c = document.createElement('canvas'); c.width = 64; c.height = 4; const g = c.getContext('2d');
  for (let x = 0; x < 64; x++) { const v = 200 + 40 * Math.cos(x / 64 * Math.PI * 2 * 4); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 4); }
  _ribs = new THREE.CanvasTexture(c); _ribs.wrapS = _ribs.wrapT = THREE.RepeatWrapping; _ribs.colorSpace = THREE.SRGBColorSpace; return _ribs;
}

export function propMesh(kind) {
  const g = new THREE.Group();
  const conc = mat('conc', { color: 0x9b9890, roughness: 0.95 }), wood = mat('wood', { color: 0xb08a5a, roughness: 0.85 }), dark = mat('dark', { color: 0x2c2e30, roughness: 0.6 });
  const steel = mat('steel', { color: 0x8c9196, roughness: 0.45, metalness: 0.6 }), tyre = mat('tyre', { color: 0x1c1c1c, roughness: 0.9 });
  if (kind === 'cabin') {
    // a site office 6000 × 2440 × 2600 on four concrete blocks: white profiled sheet, a dark frame, a door, two windows
    const t = ribs().clone(); t.repeat.set(6000 / 300, 1); t.needsUpdate = true;
    const wall = new THREE.MeshStandardMaterial({ map: t, color: 0xe6e6e2, roughness: 0.6 });
    for (const [x, z] of [[-2700, -1000], [2700, -1000], [-2700, 1000], [2700, 1000]]) box(g, conc, 400, 200, 400, x, 100, z);
    box(g, wall, 5900, 2400, 2340, 0, 200 + 1300, 0);
    for (const [x, z] of [[-2970, -1190], [2970, -1190], [-2970, 1190], [2970, 1190]]) box(g, dark, 120, 2600, 120, x, 200 + 1300, z);
    box(g, dark, 6060, 150, 2500, 0, 200 + 2600 - 75, 0); box(g, dark, 6060, 150, 2500, 0, 200 + 75, 0);
    box(g, mat('door', { color: 0x5a6068, roughness: 0.5, metalness: 0.4 }), 900, 2000, 30, -1900, 200 + 150 + 1000, 1185);
    const glass = mat('cabglass', { color: 0x1d2a33, roughness: 0.1, metalness: 0.3 });
    for (const x of [0, 1800]) { box(g, glass, 1000, 900, 20, x, 200 + 1500, 1185); box(g, dark, 1080, 60, 40, x, 200 + 1030, 1190); }
    box(g, wood, 900, 150, 600, -1900, 75, 1500);   // (a step)
  } else if (kind === 'toilet') {
    // a portable toilet 1100 × 1100 × 2300: blue walls, a white roof, the door with its vent
    const blue = mat('blue', { color: 0x1f5fa8, roughness: 0.55 });
    box(g, blue, 1100, 2150, 1100, 0, 1075 + 40, 0); box(g, mat('white', { color: 0xeeeeea, roughness: 0.5 }), 1150, 120, 1150, 0, 2260, 0);
    box(g, mat('blue2', { color: 0x194f8c, roughness: 0.55 }), 800, 1900, 20, 0, 1050, 560); box(g, dark, 400, 120, 22, 0, 1900, 562);
    box(g, mat('base', { color: 0x203d63, roughness: 0.7 }), 1150, 80, 1150, 0, 40, 0);
  } else if (kind === 'mixer') {
    // a drum mixer: the orange drum tilted on its yoke, the frame on two wheels, the motor box
    const orange = mat('orange', { color: 0xd8641c, roughness: 0.5, metalness: 0.2 });
    const prof = [[0, -420], [330, -420], [400, -250], [400, 120], [250, 380], [180, 420]].map(([r, y]) => new THREE.Vector2(MM(r), MM(y)));
    const drum = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), orange); drum.material.side = THREE.DoubleSide;
    const d = new THREE.Group(); d.add(drum); d.position.set(0, MM(950), 0); d.rotation.z = -0.55; g.add(d);
    for (const s of [-1, 1]) { box(g, steel, 50, 900, 50, s * 480, 520, -150, 0); box(g, steel, 50, 50, 1300, s * 480, 120, 0); }
    box(g, steel, 1000, 50, 50, 0, 950, -150); box(g, mat('motor', { color: 0x3c4246, roughness: 0.5 }), 300, 250, 300, 380, 700, -350);
    for (const s of [-1, 1]) { const w = cyl(g, tyre, 200, 200, 90, s * 560, 200, 450, 18); w.rotation.z = Math.PI / 2; }
    box(g, steel, 40, 40, 900, -480, 820, 500, 0.4);   // (the handle)
  } else if (kind === 'pallet') {
    // a pallet 1200 × 1000 of aerated blocks 600 × 250 × 300 (5 courses, in shrink film)
    for (const z of [-430, 0, 430]) box(g, wood, 1200, 100, 140, 0, 50, z);
    for (let x = -540; x <= 540; x += 180) box(g, wood, 100, 25, 1000, x, 112, 0);
    const blk = mat('blk', { color: 0xdedcd4, roughness: 0.9 });
    for (let k = 0; k < 5; k++) for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) box(g, blk, 597, 247, 297, (a - 0.5) * 600, 125 + 125 + k * 250, (b - 1) * 300, 0);
    const film = mat('film', { color: 0xdfe8ee, roughness: 0.15, transparent: true, opacity: 0.1, depthWrite: false });
    box(g, film, 1220, 1270, 920, 0, 125 + 640, 0);
  } else if (kind === 'timber') {
    // boards 6 m long on three bearers, in 4 layers with spacers
    for (const x of [-2600, 0, 2600]) box(g, wood, 100, 100, 1300, x, 50, 0);
    const pl = mat('plank', { color: 0xcaa977, roughness: 0.8 });
    for (let k = 0; k < 4; k++) { for (let i = 0; i < 6; i++) box(g, pl, 6000, 50, 180, 0, 100 + 25 + k * 75, -500 + i * 200); if (k < 3) for (const x of [-2600, 0, 2600]) box(g, wood, 30, 25, 1200, x, 100 + 50 + k * 75 + 12, 0); }
  } else if (kind === 'barrow') {
    // a builder's barrow: the green tray, the wheel at the front, two handles, two legs
    const grn = mat('barrow', { color: 0x2f6b3a, roughness: 0.5, metalness: 0.3 });
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(MM(420), MM(300), MM(280), 4, 1, true), grn); tray.rotation.y = Math.PI / 4; tray.scale.set(1.25, 1, 0.9); tray.position.set(0, MM(560), 0); tray.material.side = THREE.DoubleSide; g.add(tray);
    const w = cyl(g, tyre, 190, 190, 80, 0, 190, 650, 18); w.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) { box(g, steel, 35, 35, 1500, s * 260, 470, -150, 0); box(g, steel, 30, 430, 30, s * 230, 215, -350); }
  } else if (kind === 'cones') {
    // three traffic cones 750 high: orange with two white bands, a black base
    const or = mat('cone', { color: 0xf0581c, roughness: 0.55 }), wh = mat('band', { color: 0xf2f2ee, roughness: 0.4 });
    for (const [x, z] of [[-1600, 0], [0, 200], [1600, 0]]) {
      box(g, dark, 400, 40, 400, x, 20, z);
      cyl(g, or, 30, 160, 710, x, 40 + 355, z, 16);
      cyl(g, wh, 70, 95, 120, x, 40 + 470, z, 16).scale.set(1.04, 1, 1.04); cyl(g, wh, 105, 125, 100, x, 40 + 290, z, 16).scale.set(1.04, 1, 1.04);
    }
  } else if (kind === 'skip') {
    // a skip 3600 × 1700 (top) / 2800 × 1700 (floor), 1300 high: yellow steel, ribbed, with rubble in it
    const yel = mat('skip', { color: 0xd9a90f, roughness: 0.55, metalness: 0.3 });
    const shape = new THREE.Shape([[-1800, 1300], [1800, 1300], [1400, 0], [-1400, 0]].map(([x, y]) => new THREE.Vector2(MM(x), MM(y))));
    const side = new THREE.ExtrudeGeometry(shape, { depth: MM(40), bevelEnabled: false });
    for (const z of [-870, 830]) { const m = new THREE.Mesh(side, yel); m.position.z = MM(z); g.add(m); }
    box(g, yel, 2800, 40, 1700, 0, 20, 0);
    for (const s of [-1, 1]) { const e = box(g, yel, 40, 1360, 1700, s * 1600, 650, 0); e.rotation.z = s * 0.3; }
    for (const x of [-1100, -400, 400, 1100]) box(g, yel, 120, 1300, 1820, x, 650, 0);
    const rub = mat('rubble', { color: 0x8b8378, roughness: 1 });
    for (let i = 0; i < 14; i++) box(g, rub, 300 + (i * 97) % 400, 120 + (i * 53) % 200, 250 + (i * 71) % 300, -1100 + (i * 173) % 2200, 1000 + (i * 37) % 200, -600 + (i * 113) % 1200, i);
  } else if (kind === 'sand') {
    // a heap of sand ≈ 2 m³ at its angle of repose (≈ 32°): 1500 across the foot, 900 high, a little lumpy
    const geo = new THREE.ConeGeometry(MM(1500), MM(900), 28, 6);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 1 + 0.06 * Math.sin(i * 1.7) * (1 - Math.abs(y) / MM(450)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    geo.computeVertexNormals(); geo.translate(0, MM(450) - MM(30), 0);
    // (the plot's own sand photo on it, its grain to scale; the slope a little darker — damp under the dry crust)
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / MM(1200), p.getZ(i) / MM(1200));
    g.add(new THREE.Mesh(geo, mat('sand', { map: _tex?.top?.diff || null, normalMap: _tex?.top?.nor || null, color: 0xe8d8bc, roughness: 1 })));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// the view: one group, a mesh for each record (made when it comes, moved when it is moved, gone when it goes)
export class SitePropView {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'siteprops'; app.scene.add(this.group);
    this.meshes = new Map(); this.dirty = true;
    app.objects.on((id, rec) => { if (!rec || rec.type === 'siteprop' || this.meshes.has(id)) this.dirty = true; });
  }
  update() {
    if (!this.dirty) return; this.dirty = false;
    const O = this.app.objects, T = this.app.terrain, seen = new Set();
    for (const r of O.all('siteprop')) {
      seen.add(r.id);
      let m = this.meshes.get(r.id);
      if (!m || m.userData.kind !== r.kind) { if (m) this.group.remove(m); m = propMesh(r.kind); m.userData.kind = r.kind; m.traverse((o) => { o.userData.propId = r.id; }); this.group.add(m); this.meshes.set(r.id, m); }
      this.place(m, r.x, r.z, r.yaw);
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); m.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); this.meshes.delete(id); }
  }
  // (standing on the ground there: its lowest point under the middle and the four corners of its foot)
  place(m, x, z, yaw = 0) {
    const T = this.app.terrain, r = MM(PROPS[m.userData.kind]?.r || 500) * 0.5;
    let y = -Infinity; for (const [dx, dz] of [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]]) { const X = T.clampX(x + dx), Z = Math.max(-T.halfZ, Math.min(T.halfZ, z + dz)); y = Math.max(y, T.heightAt(X, Z)); }
    m.position.set(x, y, z); m.rotation.y = yaw || 0;
  }
  // the prop under the finger (its id), by the ray
  pick(ray) { const h = ray.intersectObject(this.group, true)[0]; return h ? h.object.userData.propId ?? null : null; }
}
