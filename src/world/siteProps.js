import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadModel } from './machines/models.js';

// What stands about a building site (the owner's picture: the site office, the toilet, the mixer, the pallets of blocks
// in their film, the timber on its bearers, a barrow, cones at the gate, a skip) — each a record
// { type: 'siteprop', kind, x, z, yaw } the finger moves, turns or takes away (sitePropTool.js) when it is in the way.
// Drawn here, each of simple parts in its real size (mm), on what it stands on (blocks, a pallet, bearers).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
// each a model (Sketchfab, CC BY — CREDITS.md; cut out, stood on the ground at its middle, to its real size, light for a
// phone — scratchpad prep.mjs); foot — its footprint (mm) for standing it on the ground
export const PROPS = {
  cabin: { name: 'Бытовка', model: 'office', r: 3200, foot: [6060, 2440], lift: 200, piers: [[-2830, -1020], [0, -1020], [2830, -1020], [-2830, 1020], [0, 1020], [2100, 1020]] },   // (on six blocks, 200 clear; the front one at the door end under the body — the door is in a recess)
  toilet: { name: 'Биотуалет', model: 'toilet', r: 700, foot: [1110, 1120] },
  mixer: { name: 'Бетономешалка', model: 'mixer', r: 900, foot: [810, 1220] },
  pallet: { name: 'Поддон с блоками', model: 'cinderpallet', r: 800, foot: [1200, 1090] },
  bricks: { name: 'Поддон кирпича', model: 'brickpallet', r: 800, foot: [830, 1100] },
  bags: { name: 'Цемент в мешках', model: 'bags', r: 800, foot: [1250, 1180] },
  timber: { name: 'Штабель досок', model: 'timber', r: 2400, foot: [2460, 4500] },
  barrow: { name: 'Тачка', model: 'barrow', r: 800, foot: [1500, 660] },
  cones: { name: 'Конусы', model: 'cones', r: 900, foot: [1500, 1430] },
  skip: { name: 'Контейнер для мусора', model: 'skip', r: 2100, foot: [3900, 1800] },
};
// where they stand at first (m, in the plot's frame: x along it, z towards the street; clear of the gate and the middle)
export const PROP_SEED = [
  ['cabin', -13.2, -10.8, 0], ['toilet', -9.0, -11.6, 0], ['skip', 12.6, -10.6, 0.1],
  ['pallet', 6.2, 10.7, 0], ['bricks', 7.7, 10.7, 0], ['bags', 9.2, 10.7, 0.05], ['timber', -11.0, 9.6, 1.5708],
  ['mixer', 3.6, 8.6, 0.6], ['barrow', 4.9, 7.0, -0.9], ['cones', 0, 11.4, 0],
];

const PIER_GEO = new THREE.BoxGeometry(0.4, 1, 0.2), PIER_MAT = new THREE.MeshStandardMaterial({ color: 0x9b9890, roughness: 0.95 });
// a thing: its model, coming in when it has loaded (the group stands at once — moved, turned, picked as it is)
export function propMesh(kind) {
  const g = new THREE.Group(), P = PROPS[kind];
  // (what it stands on: concrete blocks 400 × 200 × 200 — their height to the ground under each, set where it is put)
  if (P?.piers) { g.userData.piers = P.piers.map(([x, z]) => { const b = new THREE.Mesh(PIER_GEO, PIER_MAT); b.position.set(x / 1000, 0, z / 1000); b.castShadow = b.receiveShadow = true; g.add(b); return b; }); }
  g.userData.ready = P ? loadModel('site/' + P.model).then(({ scene }) => { g.add(scene); return g; }).catch(() => g) : Promise.resolve(g);
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
    // (the ground dug or heaped under one: stood again on it)
    const rev = this.app.terrain.rev; if (rev !== this._rev) { this._rev = rev; this.dirty = true; }
    if (!this.dirty) return; this.dirty = false;
    const O = this.app.objects, T = this.app.terrain, seen = new Set();
    for (const r of O.all('siteprop')) {
      if (!PROPS[r.kind]) continue;   // (a kind taken off the list — the sand heap: not drawn)
      seen.add(r.id);
      let m = this.meshes.get(r.id);
      if (!m || m.userData.kind !== r.kind) {
        if (m) this.group.remove(m);
        m = propMesh(r.kind); m.userData.kind = r.kind; m.scale.setScalar(1 / MODEL_SCALE);   // (the model in metres)
        const id = r.id; m.userData.ready.then(() => m.traverse((o) => { o.userData.propId = id; }));
        this.group.add(m); this.meshes.set(r.id, m);
      }
      this.place(m, r.x, r.z, r.yaw);
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); this.meshes.delete(id); }   // (its geometry is the model's, shared by the copies: not disposed)
  }
  // (standing on the ground there: its lowest point under the middle and the four corners of its foot)
  place(m, x, z, yaw = 0) {
    const T = this.app.terrain, [fw, fd] = (PROPS[m.userData.kind]?.foot || [800, 800]).map((v) => MM(v) / 2), c = Math.cos(yaw || 0), sn = Math.sin(yaw || 0);
    // (its foot's middle and corners, turned with it — the highest of them: it stands on what is under it, not in it)
    let y = -Infinity; for (const [a, b] of [[0, 0], [fw, fd], [-fw, fd], [fw, -fd], [-fw, -fd]]) { const X = T.clampX(x + a * c + b * sn), Z = Math.max(-T.halfZ, Math.min(T.halfZ, z - a * sn + b * c)); y = Math.max(y, T.heightAt(X, Z)); }
    const P = PROPS[m.userData.kind]; y += MM(P?.lift || 0);
    m.position.set(x, y, z); m.rotation.y = yaw || 0;
    // (its blocks down to the ground under each: a little lower ground, a taller stack)
    if (m.userData.piers) for (const b of m.userData.piers) {
      const px = x + (b.position.x * c + b.position.z * sn) / MODEL_SCALE, pz = z + (-b.position.x * sn + b.position.z * c) / MODEL_SCALE;
      const h = Math.max(MM(50), y - T.heightAt(T.clampX(px), Math.max(-T.halfZ, Math.min(T.halfZ, pz)))) * MODEL_SCALE;   // (metres, as the model)
      b.scale.y = h; b.position.y = -h / 2;
    }
  }
  // the prop under the finger (its id), by the ray
  pick(ray) { const h = ray.intersectObject(this.group, true)[0]; return h ? h.object.userData.propId ?? null : null; }
}
