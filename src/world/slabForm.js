import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { toWorld, cellAt, plan } from '../tools/belt.js';
import { SLAB, isSlab, slabForm, deckOf } from '../tools/slab.js';
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
    // (each prop's foot on a timber sole 50 × 200 × 600 — on the ground it would sink in; the realist)
    this.soles = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.85 }), this.max.props);
    for (const m of [this.beams, this.tubeLo, this.tubeHi, this.plates, this.soles]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.count = 0; group.add(m); }
    this.owner = { beams: [], tubeLo: [], tubeHi: [], plates: [], soles: [] };
    this.stripping = false; this.done = [];
  }

  ownerOf(hit) {
    for (const k of ['beams', 'tubeLo', 'tubeHi', 'plates', 'soles']) if (hit.object === this[k]) return this.owner[k][hit.instanceId] ?? null;
    return null;
  }

  // belts: the ring beam records (the slabs among them get a formwork unless stripped);
  // floor(x, z, below): what a prop stands on, under the height `below`.
  // Stripping (b.stripAt — the clock when the crew began; the owner: «one by one, as on site»): the formwork comes out piece by
  // piece from the cantilever's edge back to the walls (a bay of 1,5 m after another — the foreman: never from the wall out), each
  // piece let down and carried to the stack off the slab: the plywood sheets flat on each other, the beams in layers, the props
  // lying in a bundle. now: the clock. this.stripping — a slab is being stripped (drawn every frame); this.done — the slabs whose
  // last piece is on the stack (the caller marks them stripped)
  // reveal ({ id, u }: a film's «going up» — the props from the walls out, then the beams, then the plywood, u of them shown)
  build(belts, floor, now = 0, terrain = null, reveal = null) {
    for (const c of [...this.decks.children]) { c.geometry.dispose(); this.decks.remove(c); }
    const m = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    let nb = 0, np = 0, nq = 0;
    const own = (this.owner = { beams: [], tubeLo: [], tubeHi: [], plates: [], soles: [] });
    this.stripping = false; this.done = [];
    for (const b of belts) {
      if (!isSlab(b) || b.stripped) continue;
      const F = slabForm(b, (x, z) => floor(x, z, b.top - MM(500))), yaw = Math.atan2(-b.u[1], b.u[0]), ux = b.u[0], uz = -b.u[1];
      // the pieces: plywood sheets 1220 × 2440, beams cut to their stock lengths (2,45 / 3,9 m), the props
      const items = [], SH = [MM(1220), MM(2440)];
      for (const [s0, t0, s1, t1] of F.deck) for (let s = s0; s < s1 - MM(1); s += SH[0]) for (let t = t0; t < t1 - MM(1); t += SH[1]) items.push({ k: 'deck', r: [s, t, Math.min(s1, s + SH[0]), Math.min(t1, t + SH[1])] });
      const cut = (list, yTop, L) => { for (const [s0, t0, s1, t1] of list) { const len = Math.hypot(s1 - s0, t1 - t0), n = Math.max(1, Math.ceil(len / L)); for (let q = 0; q < n; q++) items.push({ k: 'beam', r: [s0 + (s1 - s0) * q / n, t0 + (t1 - t0) * q / n, s0 + (s1 - s0) * (q + 1) / n, t0 + (t1 - t0) * (q + 1) / n], yTop }); } };
      cut(F.sec, F.yDeck, MM(2450)); cut(F.prim, F.ySec, MM(3900));
      for (const [x, z, f0, top] of F.props) items.push({ k: 'prop', x, z, f0, top });
      // a piece at rest where it stands: its place [x, y, z] (the deck sheet's / beam's middle, the prop's foot)
      for (const it of items) {
        if (it.k === 'prop') { it.at = [it.x, it.f0, it.z]; continue; }
        const [x, z] = toWorld(b, (it.r[0] + it.r[2]) / 2, (it.r[1] + it.r[3]) / 2); it.at = [x, it.k === 'deck' ? b.top - MM(SLAB.deck) / 2 : it.yTop - MM(SLAB.beamH) / 2, z];
      }
      if (reveal && reveal.id === b.id && b.id != null) {
        // (the forest of props first — from the walls out, then the primaries on them, the secondaries, the sheets)
        const cx = items.reduce((a, it) => a + it.at[0], 0) / items.length, cz = items.reduce((a, it) => a + it.at[2], 0) / items.length;
        const R = { prop: 0, beam: 1, deck: 3 };
        for (const it of items) it.o = (R[it.k] + (it.k === 'beam' && it.yTop === F.yDeck ? 1 : 0)) * 1e6 - Math.hypot(it.at[0] - cx, it.at[2] - cz) / S;
        items.sort((p1, p2) => p1.o - p2.o);
        items.splice(Math.round(items.length * Math.max(0, Math.min(1, reveal.u))));
      }
      let strip = null;
      if (b.stripAt != null) {
        // (how far each piece is from what carries the slab: the cells over the walls — a flood out from them)
        const { ni, nj, c } = b, mask = plan(b).mask, D = deckOf(b), dist = new Float32Array(ni * nj).fill(1e9), q = [];
        for (let k = 0; k < ni * nj; k++) if (mask[k] && !D[k]) { dist[k] = 0; q.push(k); }
        for (let h = 0; h < q.length; h++) { const k = q[h], i = k % ni, j = (k / ni) | 0; for (const [a2, d2] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a2 < 0 || d2 < 0 || a2 >= ni || d2 >= nj) continue; const k2 = d2 * ni + a2; if (dist[k2] > dist[k] + 1) { dist[k2] = dist[k] + 1; q.push(k2); } } }
        const dAt = (x, z) => { const k = cellAt(b, x, z); return k >= 0 && dist[k] < 1e9 ? dist[k] * c : 0; };
        const ORD = { deck: 0, beam: 1, prop: 2 };   // (in a bay: the sheets and the beams down, then its props out)
        for (const it of items) { it.d = dAt(it.at[0], it.at[2]); it.bay = Math.round(it.d / MM(1500)); }
        items.sort((p1, p2) => p2.bay - p1.bay || ORD[p1.k] - ORD[p2.k] || p2.d - p1.d);
        // the stack: off the slab, on clear ground — out past the side nearest the plot's middle
        strip = { u: now - b.stripAt, pile: this._pileSpot(b, items, terrain, floor), n: { deck: 0, beam: 0, prop: 0 } };
        items.forEach((it, i) => { it.t0 = i * STRIP.slot; });
        this.order = items.map((it) => it.bay);   // (for the tests: from the cantilever's edge back)
        if (strip.u < items.length * STRIP.slot + STRIP.carry) this.stripping = true; else this.done.push(b.id);
      }
      // where a piece is now: in place, being carried (let down, lifted a little, walked over), or on the stack
      const pose = (it) => {
        if (!strip || strip.u < it.t0) return null;
        const tgt = this._stackPos(it, strip, yaw, ux, uz), v = Math.min(1, (strip.u - it.t0) / STRIP.carry);
        if (v >= 1) return { p: tgt, lie: 1 };
        const dn = Math.min(1, v / 0.25), w = Math.max(0, (v - 0.25) / 0.75), e = w * w * (3 - 2 * w);
        const y0 = it.at[1] - MM(150) * dn, p = [it.at[0] + (tgt[0] - it.at[0]) * e, y0 + (tgt[1] - y0) * e + Math.sin(e * Math.PI) * MM(250), it.at[2] + (tgt[2] - it.at[2]) * e];
        return { p, lie: it.k === 'prop' ? Math.min(1, v / 0.35) : 0 };
      };
      // the deck: plywood 18 mm, its top under the concrete
      const pos = [], uv = [], idx = [], sheet = MM(1220);
      const quad = (a, bb, c2, d) => { const o = pos.length / 3; for (const v of [a, bb, c2, d]) { pos.push(...v); uv.push(v[0] / sheet, v[2] / sheet); } idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
      const slabBox = (cs, yT, yB) => {
        const v = (k, y) => [cs[k][0], y, cs[k][1]];
        quad(v(0, yT), v(3, yT), v(2, yT), v(1, yT));   // top
        quad(v(0, yB), v(1, yB), v(2, yB), v(3, yB));   // underside
        for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; quad(v(k, yB), v(k2, yB), v(k2, yT), v(k, yT)); }
      };
      for (const it of items) {
        if (it.k !== 'deck') continue;
        const [s0, t0, s1, t1] = it.r, cs = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s2, t2]) => toWorld(b, s2, t2)), ps = pose(it);
        if (!ps) { slabBox(cs, b.top, F.yDeck); continue; }
        const dx = ps.p[0] - it.at[0], dz = ps.p[2] - it.at[2], dy = ps.p[1] - it.at[1];
        slabBox(cs.map(([x, z]) => [x + dx, z + dz]), b.top + dy, F.yDeck + dy);
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
      for (const it of items) {
        if (it.k !== 'beam' || nb >= this.max.beams) continue;
        const [s0, t0, s1, t1] = it.r, [x0, z0] = toWorld(b, s0, t0), [x1, z1] = toWorld(b, s1, t1), L = Math.hypot(x1 - x0, z1 - z0), ps = pose(it);
        Q.setFromAxisAngle(_Y, ps?.lie ? yaw : Math.atan2(-(z1 - z0), x1 - x0));   // (on the stack: all one way)
        this.beams.setMatrixAt(nb, m.compose(ps ? P.fromArray(ps.p) : P.fromArray(it.at), Q, Sv.set(L, MM(SLAB.beamH), MM(SLAB.beamW))));
        own.beams[nb++] = b.id ?? null;
      }
      // the props: a plate on the floor, the painted tube, the galvanised one out of it, the head plate; carried — wound in
      // short and laid down, its sole taken with it
      for (const it of items) {
        if (it.k !== 'prop' || np >= this.max.props) continue;
        const { x, z, f0, top } = it, ps = pose(it);
        const sole = MM(50), f = f0 + sole, pl = MM(8), h0 = top - f - 2 * pl, h = ps ? Math.min(h0, MM(1800)) : h0, lo = h0 * 0.55;
        if (!ps) {
          Q.setFromAxisAngle(_Y, yaw); this.soles.setMatrixAt(np, m.compose(P.set(x, f0 + sole / 2, z), Q, Sv.set(MM(600), sole, MM(200)))); own.soles[np] = b.id ?? null;
          Q.identity();
          this.tubeLo.setMatrixAt(np, m.compose(P.set(x, f + pl + lo / 2, z), Q, Sv.set(MM(30), lo, MM(30))));
          this.tubeHi.setMatrixAt(np, m.compose(P.set(x, f + pl + lo + (h - lo) / 2, z), Q, Sv.set(MM(24), h - lo + MM(60), MM(24))));
          own.tubeLo[np] = own.tubeHi[np] = b.id ?? null; np++;
          for (const y of [f + pl / 2, top - pl / 2]) { this.plates.setMatrixAt(nq, m.compose(P.set(x, y, z), Q, Sv.set(MM(150), pl, MM(150)))); own.plates[nq++] = b.id ?? null; }
          continue;
        }
        // (tipped from upright to lying along the stack's way, about its middle; the sole goes on the stack beside)
        const ang = ps.lie * Math.PI / 2, Qt = new THREE.Quaternion().setFromAxisAngle(_Y, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang));
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(Qt), mid = new THREE.Vector3().fromArray(ps.p).add(new THREE.Vector3(0, MM(15) + (1 - ps.lie) * h / 2, 0));
        const L1 = Math.min(lo, h * 0.6), L2 = h - L1;
        this.tubeLo.setMatrixAt(np, m.compose(P.copy(mid).addScaledVector(axis, -h / 2 + L1 / 2), Qt, Sv.set(MM(30), L1, MM(30))));
        this.tubeHi.setMatrixAt(np, m.compose(P.copy(mid).addScaledVector(axis, h / 2 - L2 / 2), Qt, Sv.set(MM(24), L2, MM(24))));
        Q.setFromAxisAngle(_Y, yaw); this.soles.setMatrixAt(np, m.compose(P.copy(mid).addScaledVector(axis, -h / 2 - MM(30)).add(new THREE.Vector3(0, -MM(10), 0)), Qt, Sv.set(MM(600), sole, MM(200))));
        own.tubeLo[np] = own.tubeHi[np] = own.soles[np] = b.id ?? null; np++;
      }
    }
    this.beams.count = nb; this.tubeLo.count = this.tubeHi.count = this.soles.count = np; this.plates.count = nq;
    for (const im of [this.beams, this.tubeLo, this.tubeHi, this.plates, this.soles]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }
  // the stack's spot: 2,5 m out past the slab's sides (the one toward the plot's middle first), on the ground (no concrete there)
  _pileSpot(b, items, terrain, floor) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const it of items) { x0 = Math.min(x0, it.at[0]); x1 = Math.max(x1, it.at[0]); z0 = Math.min(z0, it.at[2]); z1 = Math.max(z1, it.at[2]); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, o = MM(2500);
    const cand = [[cx, z1 + o], [x1 + o, cz], [cx, z0 - o], [x0 - o, cz], [x1 + o, z1 + o], [x0 - o, z1 + o], [x1 + o, z0 - o], [x0 - o, z0 - o]];
    cand.sort((p1, p2) => Math.hypot(p1[0], p1[1]) - Math.hypot(p2[0], p2[1]));
    const T = terrain, clear = ([x, z]) => !T || (T.inside(x, z) && !(T.conc[T.index(x, z)] > 1e-6));
    const [x, z] = cand.find(clear) || cand[0];
    return { x, z, y: T ? T.heightAt(x, z) : floor(x, z, Infinity) };
  }
  // a piece's place on the stack: three heaps side by side along the slab's way — the plywood, the beams, the props
  _stackPos(it, strip, yaw, ux, uz) {
    const P0 = strip.pile, k = (it.sk ??= strip.n[it.k]++), nx = -uz, nz = ux;
    const at = (a, c2, y) => [P0.x + ux * a + nx * c2, P0.y + y, P0.z + uz * a + nz * c2];
    if (it.k === 'deck') return at(-MM(1700), 0, MM(18) * k + MM(9));
    if (it.k === 'beam') { const row = k % 8, lay = (k / 8) | 0; return at(MM(500), (row - 3.5) * MM(110), MM(100) + lay * MM(202)); }
    const row = k % 10, lay = (k / 10) | 0; return at(MM(2400), (row - 4.5) * MM(70), MM(16) + lay * MM(30));
  }
}
// the crew's pace (game seconds): a piece after another, each let down and carried over
export const STRIP = { slot: 0.2, carry: 1.4 };

// what a prop stands on under a slab: the ground / the foundation, or a slab cast lower down
export function floorUnder(terrain, belts) {
  return (x, z, below) => {
    let h = terrain.inside(x, z) ? terrain.heightAt(x, z) : terrain.heightAt(Math.max(-terrain.halfX, Math.min(terrain.halfX, x)), Math.max(-terrain.halfZ, Math.min(terrain.halfZ, z)));
    // (a slab / a ring beam cast lower down: its concrete in the cell over the point, however
    // full the rest of it is — the props stand on it, not through it to the ground)
    for (const b of belts) {
      if ((b.kind === 'pool' && !b.stripped) || b.top > below) continue;   // (a pool's shell cast and stripped: the props over it stand on its floor / its walls' tops — a cantilever over the pool, the foreman)
      const k = cellAt(b, x, z), i = k >= 0 ? plan(b).index[k] : -1;
      if (i < 0) continue;
      const y = b.top + (b.lv?.[i] || 0) * S;
      if (y > b.top + MM(20) && y <= below) h = Math.max(h, y);
    }
    return h;
  };
}
