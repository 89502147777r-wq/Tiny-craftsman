import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { KINDS } from '../world/walls.js';

// Free masonry: bricks (and blocks next to other blocks) are laid one by one, anywhere —
// no wall records, no planned courses. Where a carried unit goes is worked out from what
// is around the finger:
//   beside one of its kind – it continues the course (head joint), lies alongside it (the
//                      next leaf), or turns 90° at its end for a corner (flush with one
//                      face) — the same course height as that one;
//   on bricks / blocks – on the top of what is under it (bed joint): along it at quarter
//                      steps, flush with one face or in the middle, or turned across it
//                      («Повернуть»);
//   on the ground      – a slab, a strip, the ground: on the highest point under it,
//                      parallel to the nearest edge of that surface (flush with it when
//                      close), «Повернуть» turns it.
// Beside wins over on top, on top over the bare ground, then the nearest to the finger
// on the screen; refused (red) when it would cut into masonry or has nothing under it.
const S = 1 / 1000 / MODEL_SCALE;
const _Y = new THREE.Vector3(0, 1, 0);

// sizes of a free unit (model): length, height, width, head joint, bed joint, first bed
export function dims(kind, half = false) {
  const k = KINDS[kind === 'block' ? 'block' : 'brick'];
  // half: a half unit (sawn / broken in two: a joint shorter than half)
  return { L: (half ? (k.L - k.head) / 2 : k.L) * S, Lf: k.L * S, H: k.H * S, W: (k.W || k.T) * S, J: k.head * S, B: k.bed * S, B0: k.bed0 * S, kind: kind === 'block' ? 'block' : 'brick' };
}
const group = (u) => (u.kind === 'block' ? 'block' : 'brick');

function yawOf(q) { const v = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().fromArray(q)); return Math.atan2(-v.z, v.x); }

// a laid unit as a box: centre, axes, half sizes, bottom / top
export function boxOf(u) {
  const yaw = yawOf(u.q);
  return { u, x: u.p[0], z: u.p[2], yaw, ux: Math.cos(yaw), uz: -Math.sin(yaw), hl: u.s[0] / 2, hw: u.s[2] / 2, bot: u.p[1] - u.s[1] / 2, top: u.p[1] + u.s[1] / 2, kind: u.lintel ? 'lintel' : group(u) };
}

// two boxes overlap in plan (separating axes), shrunk a little
function overlap2(a, b, shrink = 0.4 * S) {
  for (const [ax, az] of [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]]) {
    const ra = Math.abs(a.hl * (a.ux * ax + a.uz * az)) + Math.abs(a.hw * (-a.uz * ax + a.ux * az));
    const rb = Math.abs(b.hl * (b.ux * ax + b.uz * az)) + Math.abs(b.hw * (-b.uz * ax + b.ux * az));
    if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) >= ra + rb - 2 * shrink) return false;
  }
  return true;
}
function inside(b, x, z, m = 0) {
  const dx = x - b.x, dz = z - b.z;
  return Math.abs(dx * b.ux + dz * b.uz) <= b.hl + m && Math.abs(-dx * b.uz + dz * b.ux) <= b.hw + m;
}

// the bed joint under a laid unit (model): stored on free ones; a course of a wall: the
// first one on mortar, the others on glue / mortar
function bedOf(u, D) { return u.bedT ?? (u.row === 0 && !u.free ? D.B0 : D.B); }

// opts.ground = false: only places by / on masonry (none on the bare ground)
export function placeUnit(app, kind, p, screen, finger, turn, opts = {}) {
  const t = app.terrain, D = dims(kind, opts.half), { L, H, W, J, B, B0 } = D;
  const cand = (x, z, yaw, bot, bed, how) => ({ x, z, yaw, ux: Math.cos(yaw), uz: -Math.sin(yaw), hl: L / 2, hw: W / 2, bot, top: bot + H, bed, how });
  const boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q).map(boxOf);
  const cands = [];
  // near the finger: on the screen (the finger is often over the ground behind a unit),
  // else in the plot
  const near = (b, px) => {
    if (!finger) return Math.hypot(b.x - p.x, b.z - p.z) < 0.07 + b.hl;
    const sp = screen(new THREE.Vector3(b.x, b.top, b.z));
    return sp.front && Math.hypot(sp.x - finger.x, sp.y - finger.y) < px;
  };
  // beside one of its kind: continue the course, the next leaf, a corner
  for (const n of boxes) {
    if (n.kind !== D.kind || !near(n, 240)) continue;
    const nx = -n.uz, nz = n.ux, bed = bedOf(n.u, D);   // the same course: the same bed under it
    for (const sg of [-1, 1]) {
      const a = n.hl + J + L / 2;
      { const cc = cand(n.x + n.ux * a * sg, n.z + n.uz * a * sg, n.yaw, n.bot, bed, 'beside'); cc.across = false; cands.push(cc); }
      const b = n.hw + J + W / 2;
      { const cc = cand(n.x + nx * b * sg, n.z + nz * b * sg, n.yaw, n.bot, bed, 'beside'); cc.leaf = true; cands.push(cc); }
      for (const sd of [-1, 1]) {
        const c = n.hl + J + W / 2, f = L / 2 - n.hw;
        const cc = cand(n.x + n.ux * c * sg + nx * f * sd, n.z + n.uz * c * sg + nz * f * sd, n.yaw + Math.PI / 2, n.bot, bed, 'beside'); cc.across = true; cands.push(cc);
      }
    }
  }
  // on the top of a unit: along it at quarter steps, flush with a face or in the middle,
  // or turned across it
  for (const b of boxes) {
    if (!(inside(b, p.x, p.z, 0.006) || near(b, 170))) continue;
    const bx = -b.uz, bz = b.ux, q = (D.Lf + J) / 4, n = Math.floor((b.hl + L / 2) / q), onFace = inside(b, p.x, p.z, 0.002) && Math.abs(p.y - b.top) < 0.002;   // the finger on its top face
    for (let k = -n; k <= n; k++) for (const [yaw, half] of [[b.yaw, W / 2], [b.yaw + Math.PI / 2, L / 2]]) {
      const offs = new Set([0, +(b.hw - half).toFixed(7), -(b.hw - half).toFixed(7)]);
      for (const o of offs) { const c = cand(b.x + b.ux * k * q + bx * o, b.z + b.uz * k * q + bz * o, yaw, b.top + B, B, 'top'); c.across = yaw !== b.yaw; c.onFace = onFace; cands.push(c); }
    }
  }
  // on the ground / a slab (the first bed is thicker under a block: mortar, not glue)
  if (opts.ground !== false && t.inside(p.x, p.z)) {
    const e = edgeNear(t, p);
    let yaw = opts.yaw ?? (e ? Math.atan2(-e.uz, e.ux) : 0);
    if (turn) yaw += Math.PI / 2;
    let x = p.x, z = p.z;
    if (e && !turn && e.d < W / 2 + 0.03) { x += e.nx * (e.d - W / 2); z += e.nz * (e.d - W / 2); }   // flush with the edge
    const c = cand(x, z, yaw, 0, B0, 'ground');
    let g = -Infinity;
    for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const px = x + c.ux * c.hl * a * 0.95 - c.uz * c.hw * b * 0.95, pz = z + c.uz * c.hl * a * 0.95 + c.ux * c.hw * b * 0.95;
      if (t.inside(px, pz)) g = Math.max(g, t.heightAt(px, pz));
    }
    c.bot = g + B0; c.top = c.bot + H;
    cands.push(c);
  }
  // score: on the screen (the top centre of it), else in the plot
  // a magnet: a place on the top or on the ground near a unit of the same course is set
  // exactly against it — in line with it and one joint away (parallel), or into the
  // corner at its end, flush with one of its faces (turned) — the course stays true
  const snapped = [];
  for (const c of cands) {
    if (c.how === 'beside') continue;
    let best = null;
    for (const n of boxes) {
      if (n.kind !== D.kind || Math.abs(n.bot - c.bot) > 0.0006) continue;
      const dx = c.x - n.x, dz = c.z - n.z, along = dx * n.ux + dz * n.uz, side = -dx * n.uz + dz * n.ux;
      const par = Math.abs(Math.sin(c.yaw - n.yaw)) < 0.05, perp = Math.abs(Math.cos(c.yaw - n.yaw)) < 0.05;
      const spots = [];
      if (par) {
        if (Math.abs(side) > n.hw + c.hw) continue;
        spots.push([Math.sign(along || 1) * (n.hl + J + c.hl), 0, 'line']);
      } else if (perp) {
        // turned: across the end of n, flush with one of its faces …
        spots.push([Math.sign(along || 1) * (n.hl + J + c.hw), Math.sign(side || 1) * (c.hl - n.hw), 'flush']);
        // … or its end butting into the long face of n, flush with n's end (n runs past the corner)
        for (const e of [-1, 1]) spots.push([e * (n.hl - c.hw), Math.sign(side || 1) * (n.hw + J + c.hl), 'flush']);
        // … or just butting into it where it is (over what is under it) — only when flush won't do
        if (Math.abs(along) <= n.hl + c.hw) spots.push([along, Math.sign(side || 1) * (n.hw + J + c.hl), 'free']);
      } else continue;
      for (const [ta, ts, kind] of spots) {
        const d = Math.hypot(along - ta, side - ts);
        // (in that unit's course: its height and its bed)
        if (d < L * 0.45) { snapped.push({ ...c, x: n.x + n.ux * ta - n.uz * ts, z: n.z + n.uz * ta + n.ux * ts, bot: n.bot, top: n.bot + H, bed: c.how === 'ground' ? bedOf(n.u, D) : c.bed, snap: kind === 'flush' ? 2 : 1 }); c.gone = true; }   // (the loose place goes: only the true one stays)
      }
    }
    void best;
  }
  for (let i = cands.length - 1; i >= 0; i--) if (cands[i].gone) cands.splice(i, 1);
  cands.push(...snapped);
  // no turning by itself: every place has the direction of the work (the last unit laid,
  // or what it goes on / by), «Повернуть» turns it by 90°
  if (opts.yaw != null) {
    const want = opts.yaw + (turn ? Math.PI / 2 : 0);
    for (let i = cands.length - 1; i >= 0; i--) if (Math.abs(Math.sin(cands[i].yaw - want)) > 0.05) cands.splice(i, 1);
  } else if (turn) {
    for (let i = cands.length - 1; i >= 0; i--) if (cands[i].how !== 'ground' && !cands[i].across) cands.splice(i, 1);
  } else for (let i = cands.length - 1; i >= 0; i--) if (cands[i].across) cands.splice(i, 1);
  const bias = { beside: 0, top: finger ? 22 : 20, ground: finger ? 45 : 60 };
  let best = null, bd = Infinity, bestBad = null, bb = Infinity;
  // places by / on the masonry first: when one of them fits, the bare ground (often the
  // ground far behind a wall, under a finger held over it) is a worse guess
  cands.sort((a, b) => (a.how === 'ground') - (b.how === 'ground'));
  for (const c of cands) {
    if (c.how === 'ground' && best) c.late = true;
    const top = new THREE.Vector3(c.x, c.bot, c.z);   // the middle of its bed: the finger is on the surface it goes on
    let d;
    if (finger) { const sp = screen(top); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 110) continue; }
    else { d = top.distanceTo(p) * 4000; }
    d += c.how === 'top' && c.onFace ? 0 : bias[c.how];
    if (c.late) d += finger ? 50 : 100;
    if (c.leaf && !inside(c, p.x, p.z)) d += finger ? 25 : 60;   // the next leaf: only where the finger really is
    if (c.snap) d -= c.snap === 2 ? (finger ? 45 : 60) : (finger ? 6 : 10);   // set true against a neighbour (into a corner flush wins)
    const ok = !boxes.some((b) => c.bot < b.top - 1e-5 && c.top > b.bot + 1e-5 && overlap2(c, b)) && supported(t, boxes, c, c.snap === 2);
    if (ok && d < bd) { bd = d; best = c; }
    if (!ok && d < bb) { bb = d; bestBad = c; }
  }
  const c = best || bestBad;
  if (!c) return null;
  const q = new THREE.Quaternion().setFromAxisAngle(_Y, c.yaw);
  return { ok: !!best, how: c.how, kind: D.kind, half: !!opts.half, bedMm: Math.round((c.bed ?? B) / S), p: new THREE.Vector3(c.x, c.bot + H / 2, c.z), q, s: new THREE.Vector3(L, H, W), bedY: c.bot - (c.bed ?? B) / 2, bedT: c.bed ?? B };
}

// it stands: its centre over something (it does not tip over) and at least a third of it
// (3 of 9 points) on a top at its bed, or on the ground
function supported(t, boxes, c, lenient = false) {
  const bed = c.bot - (c.bed ?? 0);
  // on a top at its bed (a joint between two is bridged), or on the ground
  const on = (x, z) => boxes.some((u) => Math.abs(u.top - bed) < 0.0015 && inside(u, x, z, KINDS.brick.head * S)) || (t.inside(x, z) && t.heightAt(x, z) > bed - 0.004 && t.heightAt(x, z) < bed + 0.0015);
  if (!lenient && !on(c.x, c.z)) return false;   // (set true into a corner: a third under it is enough)
  let n = 0;
  for (const a of [-0.8, 0, 0.8]) for (const b of [-0.8, 0, 0.8]) if (on(c.x + c.ux * c.hl * a - c.uz * c.hw * b, c.z + c.uz * c.hl * a + c.ux * c.hw * b)) n++;
  return n >= 3;
}

// the nearest edge of the surface under p (a slab edge, a step) along the axes, ≤ 0.6 m
function edgeNear(t, p) {
  const conc = (x, z) => t.conc[t.index(x, z)] > 1e-4, on = conc(p.x, p.z), h0 = t.heightAt(p.x, p.z);
  const same = (x, z) => t.inside(x, z) && (!on || conc(x, z)) && Math.abs(t.heightAt(x, z) - h0) < 0.006;
  const far = 0.6 / MODEL_SCALE, st = t.cell * 0.5;
  let best = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let d = 0;
    while (d < far && same(p.x + dx * (d + st), p.z + dz * (d + st))) d += st;
    if (d < far && (!best || d < best.d)) best = { d: d + st / 2, nx: dx, nz: dz, ux: -dz, uz: dx };
  }
  return best;
}

// the mortar of free masonry, drawn: the bed under each unit (a little inside its faces)
// and a head joint only where a neighbour of the course is there — nothing at free ends
export function mortarOf(units) {
  const out = [], list = units.filter((u) => u.free && u.p && u.s && u.q).map(boxOf);
  const cell = 0.03, grid = new Map(), key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  list.forEach((b, i) => { const k = key(b.x, b.z); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  for (const [i, b] of list.entries()) {
    const D = dims(b.kind), inset = (b.kind === 'block' ? 4 : 10) * S, bed = bedOf(b.u, D);
    // the bed
    out.push({ x: b.x, y: b.bot - bed / 2, z: b.z, yaw: b.yaw, l: b.hl * 2 - 2 * inset, h: bed, w: b.hw * 2 - 2 * inset });
    // head joints to the neighbours along it (each pair once)
    const cx = Math.floor(b.x / cell), cz = Math.floor(b.z / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) for (const j of grid.get(`${gx},${gz}`) || []) {
      if (j <= i) continue;
      const o = list[j];
      if (o.kind !== b.kind || Math.abs(o.bot - b.bot) > 0.0003) continue;
      const dx = o.x - b.x, dz = o.z - b.z, along = dx * b.ux + dz * b.uz, across = -dx * b.uz + dz * b.ux;
      const par = Math.abs(Math.sin(o.yaw - b.yaw)) < 0.05;
      let gap, mx, mz, len, wid;
      if (par && Math.abs(across) < 0.0008) {           // end to end
        gap = Math.abs(along) - b.hl - o.hl; if (gap < 0 || gap > D.J * 1.8) continue;
        const s = Math.sign(along) * (b.hl + gap / 2); mx = b.x + b.ux * s; mz = b.z + b.uz * s; len = gap; wid = b.hw * 2 - 2 * inset;
        out.push({ x: mx, y: (b.bot + b.top) / 2 - 0.5 * S, z: mz, yaw: b.yaw, l: len, h: b.top - b.bot - 1 * S, w: wid });
      } else if (par && Math.abs(along) < 0.0008 + Math.abs(b.hl - o.hl)) {   // side by side (two leaves)
        gap = Math.abs(across) - b.hw - o.hw; if (gap < 0 || gap > D.J * 1.8) continue;
        const s = Math.sign(across) * (b.hw + gap / 2); mx = b.x - b.uz * s; mz = b.z + b.ux * s;
        out.push({ x: mx, y: (b.bot + b.top) / 2 - 0.5 * S, z: mz, yaw: b.yaw, l: b.hl * 2 - 2 * inset, h: b.top - b.bot - 1 * S, w: gap });
      }
    }
  }
  return out;
}

// the tops of the free masonry, for laying a block wall on it: the highest top over (x, z)
// (the joints bridged), or -Infinity
export function freeTops(app) { return app.objects.all('unit').filter((u) => u.free && u.p && u.s && u.q).map(boxOf); }
export function topAt(boxes, x, z) {
  let h = -Infinity;
  for (const b of boxes) if (b.top > h && inside(b, x, z, KINDS.brick.head * S * 0.75)) h = b.top;
  return h;
}
