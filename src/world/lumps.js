import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE, CONCRETE } from '../config.js';
import { mortarPhoto } from './terrainMaterial.js';

// A lump of set concrete (the owner, 2026-11-16: «a drop of concrete on the ground is a dab — not a pillar down to the bottom
// when the ground round it is dug; a bucket picks it up whole and carries it, into the truck too»).
// Concrete spilt on the bare ground (thin, on the ground's level — see scanLumps) is taken out of the ground's concrete once it is
// firm and becomes a thing (pieces of ≤ LUMP.piece m): a record { type: 'lump', x, z, y, yaw, cells: [[dx, dz, h] mm…],
// at: 'ground' | 'truck', tx, tz (in the truck's bed, its frame, model units) }. On the ground it rests on what is under it — dug
// round or under, it goes down with it; a bucket (excavator, loader) that scoops through it takes it whole (machineTool.js);
// tipped out, it falls (g) onto the ground or into a truck's body; the truck tips it out with its load; driven off to the tip —
// gone with the load.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S, G = 9.81 / MODEL_SCALE;
export const LUMP = { thick: 0.25, piece: 0.9, grade: 0.03 };

// the ground's firm spills → lumps (called now and then: main.js). A spill: firm concrete no thicker than LUMP.thick lying on the
// ground at its own level (not in a pit — a blinding is poured there — nor in a house), whatever its size and whatever it touches
// (an overflow along a slab's boards as well): what the bucket breaks off and takes. A big one in pieces of LUMP.piece m — as the
// bucket breaks it. A slab, a pad, a foundation (thicker) stay the ground's own: the soil under them is left, its face soil (the
// shader shows the concrete only its own thickness).
export function scanLumps(app) {
  const t = app.terrain, { nx, conc } = t, N = conc.length, firm = CONCRETE.stiff * 1.05, thin = MM(LUMP.thick * 1000), grade = MM(LUMP.grade * 1000);
  const spill = (i) => conc[i] > 1e-5 && t.cSpill[i] === 1 && conc[i] <= thin && t.curedAt(i) >= firm && t.zone?.[i] !== 1;   // (marked when it was poured: off the formwork, on the open ground — terrain._spillAt)
  const groups = new Map(), P = MM(LUMP.piece * 1000);
  for (let i = 0; i < N; i++) {
    if (conc[i] <= 1e-5 || !spill(i)) continue;
    const x = t.toWorldX(i % nx), z = t.toWorldZ((i / nx) | 0), k = Math.floor(x / P) * 65536 + Math.floor(z / P);
    let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(i);
  }
  const made = [];
  for (const list of groups.values()) {
    let cx = 0, cz = 0, bot = Infinity;
    for (const i of list) { const x = t.toWorldX(i % nx), z = t.toWorldZ((i / nx) | 0); cx += x; cz += z; bot = Math.min(bot, t.nat[i] + t.loose[i]); }
    cx /= list.length; cz /= list.length;
    const cells = list.map((i) => [Math.round((t.toWorldX(i % nx) - cx) / S), Math.round((t.toWorldZ((i / nx) | 0) - cz) / S), Math.max(4, Math.round(conc[i] / S))]);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const i of list) { const ix = i % nx, iz = (i / nx) | 0; x0 = Math.min(x0, ix); x1 = Math.max(x1, ix); z0 = Math.min(z0, iz); z1 = Math.max(z1, iz); conc[i] = 0; t.cBase[i] = 0; t.cSm[i] = 0; }
    t._concTouch(x0, z0, x1, z1); t._touch(x0, z0, x1, z1);
    made.push(app.objects.add({ type: 'lump', x: +cx.toFixed(6), z: +cz.toFixed(6), y: +bot.toFixed(6), yaw: 0, cells, cell: Math.round(t.cell / S), at: 'ground' }).id);
  }
  return made;
}

// its size: the cells' box (model units) and its volume (m³)
export function lumpSize(r) {
  const c = MM(r.cell || 30) / 2; let r2 = 0, h = 0, v = 0;
  for (const [dx, dz, hh] of r.cells) { r2 = Math.max(r2, Math.hypot(MM(dx), MM(dz)) + c); h = Math.max(h, MM(hh)); v += hh / 1000 * Math.pow((r.cell || 30) / 1000, 2); }
  return { r: r2, h, vol: v };
}

let _mat = null;
const mat = () => _mat || (_mat = mortarPhoto(new THREE.MeshStandardMaterial({ color: CONCRETE.color, roughness: 0.93 }), { tile: 1.23, k: 1.0, tint: 0.3 }));

// the view: a mesh for each lump — its cells as one rough body, the top of each cell its height, the edges a little lower (a dab,
// not a box); resting on the ground, falling, in a bucket (machineTool sets `held`), in the truck's body
export class LumpView {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'lumps'; app.scene.add(this.group);
    this.meshes = new Map(); this.fall = new Map(); this.slide = new Map(); this.held = null; this.dirty = true;
    app.objects.on((id, rec) => { if (!rec || rec.type === 'lump' || this.meshes.has(id)) this.dirty = true; });
  }
  _geo(r) {
    const c = MM(r.cell || 30), set = new Set(r.cells.map(([dx, dz]) => `${Math.round(dx / (r.cell || 30))},${Math.round(dz / (r.cell || 30))}`)), parts = [];
    for (const [dx, dz, hh] of r.cells) {
      const kx = Math.round(dx / (r.cell || 30)), kz = Math.round(dz / (r.cell || 30)), n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => set.has(`${kx + a},${kz + b}`)).length;
      const h = MM(hh) * (n >= 4 ? 1 : 0.65 + 0.08 * n), g = new THREE.BoxGeometry(c * 1.02, h, c * 1.02);   // (its rim thinner: a dab)
      g.translate(MM(dx), h / 2, MM(dz)); parts.push(g);
    }
    const g = mergeGeometries(parts); g.computeVertexNormals(); return g;
  }
  // where it rests: the highest ground under its cells (model units)
  restY(r, x = r.x, z = r.z) {
    const t = this.app.terrain, cs = Math.cos(r.yaw || 0), sn = Math.sin(r.yaw || 0); let y = -Infinity;
    for (const [dx, dz] of r.cells) { const px = x + MM(dx) * cs + MM(dz) * sn, pz = z - MM(dx) * sn + MM(dz) * cs; if (t.inside(px, pz)) y = Math.max(y, t.heightAt(px, pz)); }
    return Number.isFinite(y) ? y : r.y;
  }
  update(dt = 1 / 60) {
    const O = this.app.objects, seen = new Set(), T = this.app.machineTool?.truck;
    for (const r of O.all('lump')) {
      seen.add(r.id);
      let m = this.meshes.get(r.id);
      if (!m) { m = new THREE.Mesh(this._geo(r), mat()); m.castShadow = m.receiveShadow = true; m.userData.lumpId = r.id; this.group.add(m); this.meshes.set(r.id, m); }
      if (this.held?.id === r.id) continue;   // (in a bucket: machineTool moves it)
      if (r.at === 'truck' && T?.bed && T.root.visible) {
        const p = T.bed.localToWorld(new THREE.Vector3(r.tx, r.ty, r.tz)); m.position.copy(p); m.rotation.set(0, T.yaw + (r.yaw || 0), 0); continue;
      }
      // (on the ground: down to what is under it — at g when it is higher. Never up: what is tipped or pushed over it buries it, as a
      // stone is buried in a heap — the owner: covered, it is not seen; its height kept in its record, so a saved game keeps it so)
      let rest = this.restY(r), F = this.fall.get(r.id);
      let y = F ? F.y : m.userData.placed ? m.position.y : Math.min(r.y ?? rest, rest);
      // (on the surface, not under it: shoved up a heap's side it rides up on it; on a side steeper than concrete holds on sand
      // (~35°) it slides down, faster and faster, and stops where it is gentler (≤ 30°) — the owner)
      const t = this.app.terrain, sz = lumpSize(r), onTop = !F && y + sz.h * 0.5 >= t.heightAt(r.x, r.z) - MM(10);
      if (onTop && m.userData.placed) {
        if (rest > y) y = rest;   // (shoved onto higher ground: on it)
        const e = Math.max(sz.r, MM(150)), gx = (t.heightAt(r.x + e, r.z) - t.heightAt(r.x - e, r.z)) / (2 * e), gz = (t.heightAt(r.x, r.z + e) - t.heightAt(r.x, r.z - e)) / (2 * e);
        const sl = Math.hypot(gx, gz), ang = Math.atan(sl), S0 = this.slide.get(r.id);
        if (ang > (S0 ? 0.52 : 0.61) && sl > 1e-6) {
          const a = G * (Math.sin(ang) - 0.62 * Math.cos(ang)), v = Math.max(0, (S0?.v || 0) + Math.max(a, G * 0.05) * dt), dx = -gx / sl, dz = -gz / sl;
          const nx = r.x + dx * v * dt * Math.cos(ang), nz = r.z + dz * v * dt * Math.cos(ang);
          if (t.inside(nx, nz)) { r.x = +nx.toFixed(6); r.z = +nz.toFixed(6); rest = this.restY(r); y = rest; }
          this.slide.set(r.id, { v });
        } else if (S0) { this.slide.delete(r.id); this.app.sfx?.play?.('stone', { at: m.position, vol: 0.3 }); }
      } else this.slide.delete(r.id);
      if (!F && !m.userData.placed && r.y != null && r.y > rest + MM(5)) { this.fall.set(r.id, { y: r.y, v: 0 }); y = r.y; }
      if (y > rest + MM(5)) { const v = (this.fall.get(r.id)?.v || 0) + G * dt; y = Math.max(rest, y - v * dt); if (y > rest) this.fall.set(r.id, { y, v }); else { this.fall.delete(r.id); if (v > G * 0.15) this.app.sfx?.play?.('stone', { at: m.position, vol: 0.4 }); } }
      else this.fall.delete(r.id);   // (on it, or under what lies over it: it stays)
      if (!this.fall.has(r.id) && Math.abs((r.y ?? -1e9) - y) > MM(5)) r.y = +y.toFixed(6);   // (kept quietly: not a change of its own)
      m.position.set(r.x, y, r.z); m.rotation.set(0, r.yaw || 0, 0); m.userData.placed = true;
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); m.geometry.dispose(); this.meshes.delete(id); this.fall.delete(id); }
  }
  // let go at the mesh's present place (world): it falls from there
  drop(id) { const m = this.meshes.get(id); if (m) this.fall.set(id, { y: m.position.y, v: 0 }); }
}
