import * as THREE from 'three';
import { MODEL_SCALE, CONCRETE } from '../config.js';
import { KINDS } from '../world/walls.js';
import { boxOf } from './freeBrick.js';

// Openings in free masonry and what spans them:
//   lintel – a precast lintel: a standard length (1.0 … 3.0 m) that bears ≥ 250 mm on the
//            masonry each side, laid on the course beside the opening (on glue / mortar);
//   prop   – a temporary prop under an opening: a board at the level of the course top on
//            two posts, for U-blocks to be laid over the opening;
//   U-blocks are laid like blocks (freeBrick.js), on the prop and the masonry; the cage —
//            four Ø12 bars — goes into their channel; the hose fills the channel with
//            concrete (HoseTool), which sets; then the prop may come out.
const S = 1 / 1000 / MODEL_SCALE, _Y = new THREE.Vector3(0, 1, 0);
export const LINTEL_LENGTHS = [1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000];
const BEAR = 250;

// the opening nearest the finger: a gap 300 … 2700 mm between two units of one course,
// in one line — { ux, uz, nx, nz, yaw, c0, c1 (gap ends along), o (line point), top,
// width, gap }
export function findOpening(app, p, screen, finger) {
  const boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q && !u.lintel && u.kind !== 'prop').map(boxOf);
  let best = null, bd = Infinity;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (Math.abs(a.top - b.top) > 0.0006 || Math.abs(Math.sin(a.yaw - b.yaw)) > 0.05) continue;
    const dx = b.x - a.x, dz = b.z - a.z, along = dx * a.ux + dz * a.uz, side = -dx * a.uz + dz * a.ux;
    if (Math.abs(side) > 0.0008) continue;
    const gap = (Math.abs(along) - a.hl - b.hl) / S;
    if (gap < 300 || gap > 2700) continue;
    // nothing of that course in between
    const sg = Math.sign(along), e0 = a.hl, e1 = Math.abs(along) - b.hl;
    if (boxes.some((u, k) => k !== i && k !== j && Math.abs(u.top - a.top) < 0.0006 && (() => { const ex = u.x - a.x, ez = u.z - a.z, s = (ex * a.ux + ez * a.uz) * sg, sd = -ex * a.uz + ez * a.ux; return Math.abs(sd) < a.hw && s + u.hl > e0 + 0.0001 && s - u.hl < e1 - 0.0001; })())) continue;
    const ux = a.ux * sg, uz = a.uz * sg;
    const mid = (e0 + e1) / 2, cx = a.x + ux * mid, cz = a.z + uz * mid;
    let d;
    if (finger) { const sp = screen(new THREE.Vector3(cx, a.top, cz)); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 160) continue; }
    else { const dp = Math.hypot(cx - p.x, cz - p.z); if (dp > (e1 - e0) / 2 + 0.05) continue; d = Math.hypot(dp, a.top - p.y); }
    d -= a.top * 1e-3;   // (stacked courses with the same gap: the top one — where a lintel goes)
    if (d < bd) bd = d, best = { ux, uz, nx: -uz, nz: ux, yaw: Math.atan2(-uz, ux), o: [a.x, a.z], c0: e0, c1: e1, top: a.top, width: a.hw * 2, gap, kind: a.kind, a, b };
  }
  return best;
}

// the course beside the opening carries it for `len` (model) from the gap end, each side
function bears(app, op, len) {
  const boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q && !u.lintel && u.kind !== 'prop').map(boxOf);
  const covered = (s0, s1) => {
    const iv = [];
    for (const b of boxes) {
      if (Math.abs(b.top - op.top) > 0.0006) continue;
      const dx = b.x - op.o[0], dz = b.z - op.o[1], s = dx * op.ux + dz * op.uz, sd = -dx * op.uz + dz * op.ux;
      if (Math.abs(sd) > op.width / 2) continue;
      iv.push([s - b.hl - 0.0012, s + b.hl + 0.0012]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let e = s0;
    for (const [a, b] of iv) { if (a > e + 1e-5) break; e = Math.max(e, b); }
    return e >= s1 - 1e-5;
  };
  return covered(op.c0 - len, op.c0) && covered(op.c1, op.c1 + len);
}

// a precast lintel over the opening under the finger
export function placeLintel(app, p, screen, finger) {
  const op = findOpening(app, p, screen, finger);
  if (!op) return null;
  const k = KINDS[op.kind === 'block' || op.kind === 'ublock' ? 'block' : 'brick'];
  const len = LINTEL_LENGTHS.find((l) => l >= op.gap + 2 * BEAR);
  const H = (op.kind === 'brick' ? 2 * k.H + k.bed : k.H) * S, bed = k.bed * S;
  const mid = (op.c0 + op.c1) / 2;
  const x = op.o[0] + op.ux * mid, z = op.o[1] + op.uz * mid;
  const L = (len || 3000) * S;
  const ok = !!len && bears(app, op, ((len - op.gap) / 2) * S - 0.0001);
  const bot = op.top + bed, q = new THREE.Quaternion().setFromAxisAngle(_Y, op.yaw);
  // nothing in its way above the course
  const me = { x, z, yaw: op.yaw, ux: op.ux, uz: op.uz, hl: L / 2, hw: op.width / 2, bot, top: bot + H };
  const clash = app.objects.all('unit').filter((u) => u.p && u.s && u.q).map(boxOf).some((b) => me.bot < b.top - 1e-5 && me.top > b.bot + 1e-5 && overlap(me, b));
  return { ok: ok && !clash, how: 'lintel', kind: 'lintel', lenMm: len || 0, gapMm: Math.round(op.gap), p: new THREE.Vector3(x, bot + H / 2, z), q, s: new THREE.Vector3(L, H, op.width), bedY: op.top + bed / 2, bedT: bed };
}

// a temporary prop under the opening: a board flush with the top of the course
export function placeProp(app, p, screen, finger) {
  const op = findOpening(app, p, screen, finger);
  if (!op) return null;
  const T = 40 * S, L = op.gap * S - 0.0008, mid = (op.c0 + op.c1) / 2;
  const x = op.o[0] + op.ux * mid, z = op.o[1] + op.uz * mid;
  // the floor under it: the ground, or the masonry of the sill under a window
  const t = app.terrain, boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q).map(boxOf);
  let floor = t.inside(x, z) ? t.heightAt(x, z) : 0;
  for (const b of boxes) if (b.top < op.top - T && Math.abs((x - b.x) * b.ux + (z - b.z) * b.uz) < b.hl && Math.abs(-(x - b.x) * b.uz + (z - b.z) * b.ux) < b.hw) floor = Math.max(floor, b.top);
  const q = new THREE.Quaternion().setFromAxisAngle(_Y, op.yaw);
  return { ok: op.top - T - floor > 0.002, how: 'prop', kind: 'prop', gapMm: Math.round(op.gap), post: op.top - T - floor, p: new THREE.Vector3(x, op.top - T / 2, z), q, s: new THREE.Vector3(L, T, op.width), bedY: op.top - T, bedT: 0 };
}

// the run of U-blocks under the finger (one course, in line, touching): for the cage
export function uRun(app, p, screen, finger) {
  const us = app.objects.all('unit').filter((u) => u.kind === 'ublock').map(boxOf);
  let pick = null, bd = Infinity;
  for (const b of us) {
    let d;
    if (finger) { const sp = screen(new THREE.Vector3(b.x, b.top, b.z)); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 120) continue; }
    else { d = Math.hypot(b.x - p.x, b.z - p.z); if (d > b.hl + 0.02) continue; }
    if (d < bd) bd = d, pick = b;
  }
  if (!pick) return null;
  // grow it both ways along its line
  const run = [pick];
  let grown = true;
  while (grown) {
    grown = false;
    for (const b of us) {
      if (run.includes(b) || Math.abs(b.bot - pick.bot) > 0.0006 || Math.abs(Math.sin(b.yaw - pick.yaw)) > 0.05) continue;
      if (run.some((r) => { const dx = b.x - r.x, dz = b.z - r.z, al = Math.abs(dx * r.ux + dz * r.uz), sd = Math.abs(-dx * r.uz + dz * r.ux); return sd < 0.0008 && al - r.hl - b.hl < 0.0015; })) { run.push(b); grown = true; }
    }
  }
  const s = run.map((b) => (b.x - pick.x) * pick.ux + (b.z - pick.z) * pick.uz);
  const s0 = Math.min(...run.map((b, i) => s[i] - b.hl)), s1 = Math.max(...run.map((b, i) => s[i] + b.hl));
  return { run, pick, s0, s1, has: app.objects.all('bar').some((r) => r.uRun === run.map((b) => b.u.id).sort((x, y) => x - y).join(',')) };
}

// the cage of a run: 4 bars Ø12 in the channel (40 mm from its walls and bottom)
export function cageBars(R) {
  const b = R.pick, d = 12 * S, inner = 150 * S, base = 60 * S, c = 30 * S;
  const out = [];
  for (const y of [b.bot + base + c, b.bot + base + 150 * S]) for (const o of [-inner / 2 + c, inner / 2 - c]) {
    const A = [b.x + b.ux * (R.s0 + c) - b.uz * o, y, b.z + b.uz * (R.s0 + c) + b.ux * o];
    const B = [b.x + b.ux * (R.s1 - c) - b.uz * o, y, b.z + b.uz * (R.s1 - c) + b.ux * o];
    out.push({ type: 'bar', a: A.map((v) => +v.toFixed(5)), b: B.map((v) => +v.toFixed(5)), d: +d.toFixed(6), uRun: R.run.map((x) => x.u.id).sort((x, y) => x - y).join(',') });
  }
  return out;
}

// how far the concrete in a U-block has set (0 … 1)
export function uStrength(u, clock) { return u.pourT == null ? 0 : Math.max(0, Math.min(1, (clock - u.pourT) / (CONCRETE.cure * CONCRETE.stiff * 2))); }

function overlap(a, b, shrink = 0.4 * S) {
  for (const [ax, az] of [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]]) {
    const ra = Math.abs(a.hl * (a.ux * ax + a.uz * az)) + Math.abs(a.hw * (-a.uz * ax + a.ux * az));
    const rb = Math.abs(b.hl * (b.ux * ax + b.uz * az)) + Math.abs(b.hw * (-b.uz * ax + b.ux * az));
    if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) >= ra + rb - 2 * shrink) return false;
  }
  return true;
}
