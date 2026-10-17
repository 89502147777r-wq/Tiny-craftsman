import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { KINDS } from '../world/walls.js';

// Free brickwork: bricks are laid one by one, anywhere, as many as you like — no wall
// records, no planned courses. Where a carried brick goes is worked out from what is
// around the finger:
//   beside a brick   – it continues the course (10 mm head joint), or lies alongside it
//                      (the next leaf, 10 mm joint), or turns 90° at its end for a corner
//                      (flush with one face) — the same course height as that brick;
//   on bricks/blocks – on the top of what is under the finger (12 mm bed): along it, at
//                      quarter-brick steps, flush with one face or in the middle, or turned
//                      across it;
//   on the ground    – a slab, a strip, the ground: on the highest point under it (12 mm
//                      bed), parallel to the nearest edge of that surface (flush with it
//                      when close), «Повернуть» turns it.
// The candidate nearest the finger on the screen wins; it is refused (red) when it would
// cut into a brick or block, or has nothing under it.
const S = 1 / 1000 / MODEL_SCALE, K = KINDS.brick;
const L = K.L * S, H = K.H * S, W = K.W * S, J = K.head * S, B = K.bed * S;
const _Y = new THREE.Vector3(0, 1, 0);

export const BRICK_SIZE = [L, H, W];

function yawOf(q) { const v = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().fromArray(q)); return Math.atan2(-v.z, v.x); }

// a laid unit as a box: centre, axes, half sizes, bottom / top
function boxOf(u) {
  const yaw = yawOf(u.q);
  return { u, x: u.p[0], z: u.p[2], yaw, ux: Math.cos(yaw), uz: -Math.sin(yaw), hl: u.s[0] / 2, hw: u.s[2] / 2, bot: u.p[1] - u.s[1] / 2, top: u.p[1] + u.s[1] / 2, brick: u.kind !== 'block' && !u.lintel };
}
function cand(x, z, yaw, bot) { return { x, z, yaw, ux: Math.cos(yaw), uz: -Math.sin(yaw), hl: L / 2, hw: W / 2, bot, top: bot + H }; }

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

export function placeBrick(app, p, screen, finger, turn) {
  const t = app.terrain;
  const boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q).map(boxOf);
  const cands = [];
  // near the finger: on the screen (the finger is often over the ground behind a brick),
  // else in the plot
  const near = (b, px) => {
    if (!finger) return Math.hypot(b.x - p.x, b.z - p.z) < 0.07;
    const sp = screen(new THREE.Vector3(b.x, b.top, b.z));
    return sp.front && Math.hypot(sp.x - finger.x, sp.y - finger.y) < px;
  };
  // beside a brick: continue the course, the next leaf, a corner
  for (const n of boxes) {
    if (!n.brick || !near(n, 220)) continue;
    const nx = -n.uz, nz = n.ux;   // across it
    for (const sg of [-1, 1]) {
      const a = n.hl + J + L / 2;
      cands.push(cand(n.x + n.ux * a * sg, n.z + n.uz * a * sg, n.yaw, n.bot));
      const b = n.hw + J + W / 2;
      cands.push(cand(n.x + nx * b * sg, n.z + nz * b * sg, n.yaw, n.bot));
      for (const sd of [-1, 1]) {
        const c = n.hl + J + W / 2, f = L / 2 - n.hw;
        cands.push(cand(n.x + n.ux * c * sg + nx * f * sd, n.z + n.uz * c * sg + nz * f * sd, n.yaw + Math.PI / 2, n.bot));
      }
    }
  }
  // on the top of a brick / block: along it at quarter-brick steps, flush with a face or
  // in the middle, or turned across it
  for (const b of boxes) {
    if (!(inside(b, p.x, p.z, 0.006) || near(b, 160))) continue;
    const bx = -b.uz, bz = b.ux, q = (L + J) / 4, n = Math.floor(b.hl / q);
    for (let k = -n; k <= n; k++) for (const [yaw, half] of [[b.yaw, W / 2], [b.yaw + Math.PI / 2, L / 2]]) {
      const offs = new Set([0, +(b.hw - half).toFixed(7), -(b.hw - half).toFixed(7)]);
      for (const o of offs) { const c = cand(b.x + b.ux * k * q + bx * o, b.z + b.uz * k * q + bz * o, yaw, b.top + B); c.across = yaw !== b.yaw; cands.push(c); }
    }
  }
  // on the ground / a slab
  if (t.inside(p.x, p.z)) {
    const e = edgeNear(t, p);
    let yaw = e ? Math.atan2(-e.uz, e.ux) : 0;
    if (turn) yaw += Math.PI / 2;
    let x = p.x, z = p.z;
    if (e && !turn && e.d < W / 2 + 0.03) { x += e.nx * (e.d - W / 2); z += e.nz * (e.d - W / 2); }   // flush with the edge
    const c = cand(x, z, yaw, 0);
    let g = -Infinity;
    for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const px = x + c.ux * c.hl * a * 0.95 - c.uz * c.hw * b * 0.95, pz = z + c.uz * c.hl * a * 0.95 + c.ux * c.hw * b * 0.95;
      if (t.inside(px, pz)) g = Math.max(g, t.heightAt(px, pz));
    }
    // a unit standing there: the ground is not where it goes
    c.bot = g + B; c.top = c.bot + H; c.ground = true;
    cands.push(c);
  }
  // score: on the screen (the top centre of it), else in the plot
  let best = null, bd = Infinity, bestBad = null, bb = Infinity;
  for (const c of cands) {
    const top = new THREE.Vector3(c.x, c.top, c.z);
    let d;
    if (finger) { const sp = screen(top); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 110) continue; }
    else { d = top.distanceTo(p) * 4000; }
    if (c.ground) d += finger ? 45 : 60;   // a place by a brick or on the masonry wins over the bare ground
    if (c.across !== undefined && c.across !== !!turn) d += finger ? 25 : 120;   // on the masonry: along it (across with «Повернуть»)
    const ok = !boxes.some((b) => c.bot < b.top - 1e-5 && c.top > b.bot + 1e-5 && overlap2(c, b)) && supported(t, boxes, c);
    if (ok && d < bd) { bd = d; best = c; }
    if (!ok && d < bb) { bb = d; bestBad = c; }
  }
  const c = best || bestBad;
  if (!c) return null;
  const q = new THREE.Quaternion().setFromAxisAngle(_Y, c.yaw);
  return { ok: !!best, p: new THREE.Vector3(c.x, c.bot + H / 2, c.z), q, s: new THREE.Vector3(L, H, W), bedY: c.bot - B / 2, onGround: !!c.ground };
}

// something under at least 3 of 5 points of it: a top at its bed, or the ground
function supported(t, boxes, c) {
  let n = 0;
  for (const [a, b] of [[0, 0], [0.8, 0.8], [0.8, -0.8], [-0.8, 0.8], [-0.8, -0.8]]) {
    const x = c.x + c.ux * c.hl * a - c.uz * c.hw * b, z = c.z + c.uz * c.hl * a + c.ux * c.hw * b;
    const bed = c.bot - B;
    if (boxes.some((u) => Math.abs(u.top - bed) < 0.0015 && inside(u, x, z))) { n++; continue; }
    if (t.inside(x, z) && t.heightAt(x, z) > bed - 0.004 && t.heightAt(x, z) < bed + 0.0015) n++;
  }
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
