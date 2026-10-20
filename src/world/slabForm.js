import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { toWorld, beltContains } from '../tools/belt.js';
import { SLAB, isSlab, slabForm } from '../tools/slab.js';
import { variant } from './assets.js';

// The formwork under a floor slab (slab.js): the deck of film-faced plywood, the timber
// beams (yellow, as the ones on every site), the telescopic steel props — the lower tube
// painted, the upper one galvanised, a plate at each end.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _Y = new THREE.Vector3(0, 1, 0);

export class SlabFormView {
  constructor(group, tex) {
    this.group = group;
    this.max = { beams: 600, props: 400 };
    const ply = tex ? variant(tex.ply.diff, 0.2, 0.5) : null;
    this.deckMat = new THREE.MeshStandardMaterial({ map: ply, color: 0xb8714a, roughness: 0.55 });   // (the brown film of a shuttering plywood)
    this.decks = new THREE.Group(); group.add(this.decks);
    const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
    this.beams = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xd9a632, roughness: 0.72 }), this.max.beams);
    this.tubeLo = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: 0xc2401f, roughness: 0.5, metalness: 0.35 }), this.max.props);
    this.tubeHi = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.35, metalness: 0.85 }), this.max.props);
    this.plates = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x7d8186, roughness: 0.45, metalness: 0.8 }), this.max.props * 2);
    for (const m of [this.beams, this.tubeLo, this.tubeHi, this.plates]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.count = 0; group.add(m); }
    this.owner = { beams: [], tubeLo: [], tubeHi: [], plates: [] };
  }

  ownerOf(hit) {
    for (const k of ['beams', 'tubeLo', 'tubeHi', 'plates']) if (hit.object === this[k]) return this.owner[k][hit.instanceId] ?? null;
    return null;
  }

  // belts: the ring beam records (the slabs among them get a formwork unless stripped);
  // floor(x, z, below): what a prop stands on, under the height `below`
  build(belts, floor) {
    for (const c of [...this.decks.children]) { c.geometry.dispose(); this.decks.remove(c); }
    const m = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    let nb = 0, np = 0, nq = 0;
    const own = (this.owner = { beams: [], tubeLo: [], tubeHi: [], plates: [] });
    for (const b of belts) {
      if (!isSlab(b) || b.stripped) continue;
      const F = slabForm(b, (x, z) => floor(x, z, b.top - MM(500)));
      // the deck: plywood 18 mm, its top under the concrete
      const pos = [], uv = [], idx = [], sheet = MM(1220);
      const quad = (a, bb, c, d) => { const o = pos.length / 3; for (const v of [a, bb, c, d]) { pos.push(...v); uv.push(v[0] / sheet, v[2] / sheet); } idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
      for (const [s0, t0, s1, t1] of F.deck) {
        const cs = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => toWorld(b, s, t)), yT = b.top, yB = F.yDeck;
        const v = (k, y) => [cs[k][0], y, cs[k][1]];
        quad(v(0, yT), v(3, yT), v(2, yT), v(1, yT));   // top
        quad(v(0, yB), v(1, yB), v(2, yB), v(3, yB));   // underside
        for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; quad(v(k, yB), v(k2, yB), v(k2, yT), v(k, yT)); }
      }
      if (idx.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, this.deckMat);
        mesh.castShadow = mesh.receiveShadow = true; mesh.userData.uOwner = b.id ?? null;
        this.decks.add(mesh);
      }
      // the beams: H20 timber (80 × 200 mm)
      const beam = (s0, t0, s1, t1, yTop) => {
        if (nb >= this.max.beams) return;
        const [x0, z0] = toWorld(b, s0, t0), [x1, z1] = toWorld(b, s1, t1), L = Math.hypot(x1 - x0, z1 - z0);
        Q.setFromAxisAngle(_Y, Math.atan2(-(z1 - z0), x1 - x0));
        this.beams.setMatrixAt(nb, m.compose(P.set((x0 + x1) / 2, yTop - MM(SLAB.beamH) / 2, (z0 + z1) / 2), Q, Sv.set(L, MM(SLAB.beamH), MM(SLAB.beamW))));
        own.beams[nb++] = b.id ?? null;
      };
      for (const [s0, t0, s1, t1] of F.sec) beam(s0, t0, s1, t1, F.yDeck);
      for (const [s0, t0, s1, t1] of F.prim) beam(s0, t0, s1, t1, F.ySec);
      // the props: a plate on the floor, the painted tube, the galvanised one out of it, the head plate
      for (const [x, z, f, top] of F.props) {
        if (np >= this.max.props) break;
        const pl = MM(8), h = top - f - 2 * pl, lo = h * 0.55;
        Q.identity();
        this.tubeLo.setMatrixAt(np, m.compose(P.set(x, f + pl + lo / 2, z), Q, Sv.set(MM(30), lo, MM(30))));
        this.tubeHi.setMatrixAt(np, m.compose(P.set(x, f + pl + lo + (h - lo) / 2, z), Q, Sv.set(MM(24), h - lo + MM(60), MM(24))));
        own.tubeLo[np] = own.tubeHi[np] = b.id ?? null; np++;
        for (const y of [f + pl / 2, top - pl / 2]) { this.plates.setMatrixAt(nq, m.compose(P.set(x, y, z), Q, Sv.set(MM(150), pl, MM(150)))); own.plates[nq++] = b.id ?? null; }
      }
    }
    this.beams.count = nb; this.tubeLo.count = this.tubeHi.count = np; this.plates.count = nq;
    for (const im of [this.beams, this.tubeLo, this.tubeHi, this.plates]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }
}

// what a prop stands on under a slab: the ground / the foundation, or a slab cast lower down
export function floorUnder(terrain, belts) {
  return (x, z, below) => {
    let h = terrain.inside(x, z) ? terrain.heightAt(x, z) : terrain.heightAt(Math.max(-terrain.halfX, Math.min(terrain.halfX, x)), Math.max(-terrain.halfZ, Math.min(terrain.halfZ, z)));
    for (const b of belts) {
      if (!isSlab(b) || !(b.fill > 0.5) || b.top + b.H > below || !beltContains(b, x, z)) continue;
      h = Math.max(h, b.top + b.H);
    }
    return h;
  };
}
