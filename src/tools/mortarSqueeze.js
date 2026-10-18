import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf } from './freeBrick.js';

// Mortar under a brick being laid, as on site. The bed is spread thicker than the joint
// (×1.6); the brick is set on it and tapped down to the joint: the mortar it presses out
// of the bed (its volume: the lost thickness × the brick's bed) goes out of the open sides
// as a lumpy bead along the bottom edge — into the joint where another unit stands there.
// Then the trowel, held at a slant against the face, is run along it and cuts the bead
// off, collecting it on its blade.
const MM = (v) => v / 1000 / MODEL_SCALE;
export const FAT = 1.6;   // the bed as spread, × the joint

export class Squeeze {
  // target: { p, q, s } of the brick in place; bedT: the joint; bedBot: the bottom of the bed
  constructor(app, unitId, target, bedT, bedBot) {
    this.app = app;
    const yaw = 2 * Math.atan2(target.q.y, target.q.w), ux = Math.cos(yaw), uz = -Math.sin(yaw);
    this.c = { x: target.p.x, z: target.p.z, ux, uz, hl: target.s.x / 2, hw: target.s.z / 2 };
    this.bot = target.p.y - target.s.y / 2;      // the brick's bottom in place
    this.bedBot = bedBot; this.bedT = bedT;
    this.seed = Math.random() * 100;
    // the four sides: open, or against another unit (the mortar goes into that joint)
    const others = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.id !== unitId).map(boxOf);
    const C = this.c, out = MM(6), yM = this.bot - bedT / 2;
    const sides = [
      { n: [-uz, ux], a: [ux, uz], half: C.hw, len: 2 * C.hl },    // the two long faces
      { n: [uz, -ux], a: [-ux, -uz], half: C.hw, len: 2 * C.hl },
      { n: [ux, uz], a: [-uz, ux], half: C.hl, len: 2 * C.hw },    // the ends
      { n: [-ux, -uz], a: [uz, -ux], half: C.hl, len: 2 * C.hw },
    ];
    const per = 2 * (sides[0].len + sides[2].len);
    for (const f of sides) {
      const px = C.x + f.n[0] * (f.half + out), pz = C.z + f.n[1] * (f.half + out);
      f.open = !others.some((b) => yM > b.bot - MM(15) && yM < b.top + MM(15) && Math.abs((px - b.x) * b.ux + (pz - b.z) * b.uz) <= b.hl + MM(2) && Math.abs(-(px - b.x) * b.uz + (pz - b.z) * b.ux) <= b.hw + MM(2));
      f.share = f.len / per;
      f.cut = 0;   // how far along the trowel has cut it off (0 … 1)
    }
    this.sides = sides;
    this.squeezed = 0;   // 0 … 1: how much of the extra thickness is pressed out
    this.lump = 0;       // the mortar on the trowel (model m³)
  }

  // the brick's bottom is at y now: the bed is pressed to that
  press(y) { this.squeezed = Math.max(this.squeezed, Math.min(1, Math.max(0, 1 - (y - this.bot) / ((FAT - 1) * this.bedT)))); this.y = y; }

  // the bead's cross-section (model m²) on a side
  area(f) {
    const C = this.c, V = this.squeezed * (FAT - 1) * this.bedT * 4 * C.hl * C.hw;
    return f.open ? V * f.share / f.len : 0;
  }

  // the trowel on side k at t (0 … 1 along it): the bead behind it is cut off onto the blade
  trim(k, t) {
    const f = this.sides[k];
    if (t > f.cut) { this.lump += this.area(f) * f.len * 0.75 * (t - f.cut); f.cut = t; }
  }

  // where the trowel is on side k at t: the bottom of the bed on the face, and the face's
  // outward normal / direction along
  at(k, t) {
    const C = this.c, f = this.sides[k], s = (t - 0.5) * f.len;
    return { p: new THREE.Vector3(C.x + f.n[0] * f.half + f.a[0] * s, this.bedBot, C.z + f.n[1] * f.half + f.a[1] * s), n: f.n, a: f.a };
  }

  // the bed (from its bottom up to the brick) and the beads, as one mesh
  geometry() {
    const C = this.c, pos = [], idx = [], y0 = this.bedBot, y1 = Math.max(this.y ?? this.bot + (FAT - 1) * this.bedT, y0 + MM(1));
    const P = (s, w, y) => [C.x + C.ux * s - C.uz * w, y, C.z + C.uz * s + C.ux * w];
    // the bed: a box the size of the brick's bed
    {
      const o = pos.length / 3, l = C.hl, w = C.hw;
      for (const y of [y0, y1]) for (const [s, ww] of [[-l, -w], [l, -w], [l, w], [-l, w]]) pos.push(...P(s, ww, y));
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(o + i, o + j, o + 4 + j, o + i, o + 4 + j, o + 4 + i); }
      idx.push(o + 4, o + 5, o + 6, o + 4, o + 6, o + 7);
    }
    // the beads: a lumpy half-round along the bottom of each open face, tapering at the ends
    const N = 28, M = 7;
    this.sides.forEach((f, k) => {
      const A = this.area(f);
      if (A <= 0 || f.cut >= 0.999) return;
      const r0 = Math.sqrt(2 * A / Math.PI), yc = (y0 + y1) / 2, o = pos.length / 3;
      const t0 = f.cut;
      for (let i = 0; i <= N; i++) {
        const t = t0 + (1 - t0) * i / N, s = (t - 0.5) * f.len;
        const lump = 1 + 0.28 * Math.sin(t * 23 + this.seed + k) * Math.sin(t * 9.3 + this.seed * 2) + 0.12 * Math.sin(t * 61 + k * 3);
        const r = r0 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.35) * lump;
        const bx = C.x + f.n[0] * f.half + f.a[0] * s, bz = C.z + f.n[1] * f.half + f.a[1] * s;
        for (let j = 0; j <= M; j++) {
          // from under (it sags onto the course below) round the outside to the top
          const ph = -Math.PI / 2 + Math.PI * j / M, rr = r * (j < M / 2 ? 0.9 : 1);
          pos.push(bx + f.n[0] * Math.cos(ph) * rr * 1.15, yc + Math.sin(ph) * rr * 0.8, bz + f.n[1] * Math.cos(ph) * rr * 1.15);
        }
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
        const a = o + i * (M + 1) + j, b = a + M + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // the open sides, long ones first (the order the trowel goes)
  get order() { return [0, 1, 2, 3].filter((k) => this.sides[k].open && this.area(this.sides[k]) > 0); }
}
