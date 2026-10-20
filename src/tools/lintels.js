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
// width, gap }. Hand-laid jambs are rarely exact: the two sides may differ in height by
// up to a third of a course (an uneven footing) and stand off the line by up to a quarter
// of the wall's thickness
const tolY = (a, b) => 0.34 * Math.min(a.top - a.bot, b.top - b.bot);
export function findOpening(app, p, screen, finger) {
  const boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q && !u.lintel && u.kind !== 'prop').map(boxOf);
  let best = null, bd = Infinity;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j], ty = tolY(a, b);
    if (Math.abs(a.top - b.top) > ty || Math.abs(Math.sin(a.yaw - b.yaw)) > 0.05) continue;
    const dx = b.x - a.x, dz = b.z - a.z, along = dx * a.ux + dz * a.uz, side = -dx * a.uz + dz * a.ux;
    if (Math.abs(side) > Math.min(a.hw, b.hw) / 2) continue;
    const gap = (Math.abs(along) - a.hl - b.hl) / S;
    if (gap < 300 || gap > 2700) continue;
    // nothing of that course in between
    const sg = Math.sign(along), e0 = a.hl, e1 = Math.abs(along) - b.hl;
    if (boxes.some((u, k) => k !== i && k !== j && Math.abs(u.top - a.top) < ty && (() => { const ex = u.x - a.x, ez = u.z - a.z, s = (ex * a.ux + ez * a.uz) * sg, sd = -ex * a.uz + ez * a.ux; return Math.abs(sd - side / 2) < a.hw && s + u.hl > e0 + 0.0001 && s - u.hl < e1 - 0.0001; })())) continue;
    const ux = a.ux * sg, uz = a.uz * sg, top = Math.max(a.top, b.top);
    // the line: halfway between the two sides
    const ox = a.x - a.uz * side / 2, oz = a.z + a.ux * side / 2;
    const mid = (e0 + e1) / 2, cx = ox + ux * mid, cz = oz + uz * mid;
    let d;
    if (finger) { const sp = screen(new THREE.Vector3(cx, top, cz)); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 160) continue; }
    else { const dp = Math.hypot(cx - p.x, cz - p.z); if (dp > (e1 - e0) / 2 + 0.05) continue; d = Math.hypot(dp, top - p.y); }
    d -= top * 1e-3;   // (stacked courses with the same gap: the top one — where a lintel goes)
    if (d < bd) bd = d, best = { ux, uz, nx: -uz, nz: ux, yaw: Math.atan2(-uz, ux), o: [ox, oz], c0: e0, c1: e1, top, ty, width: Math.min(a.hw, b.hw) * 2, side: Math.abs(side), gap, kind: a.kind, a, b };
  }
  return best;
}

// the course beside the opening carries it for `len` (model) from the gap end, each side
function bears(app, op, len) {
  const boxes = app.objects.all('unit').filter((u) => u.p && u.s && u.q && !u.lintel && u.kind !== 'prop').map(boxOf);
  const covered = (s0, s1) => {
    const iv = [];
    for (const b of boxes) {
      if (Math.abs(b.top - op.top) > op.ty) continue;
      const dx = b.x - op.o[0], dz = b.z - op.o[1], s = dx * op.ux + dz * op.uz, sd = -dx * op.uz + dz * op.ux;
      if (Math.abs(sd) > op.width / 2 + op.side) continue;
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
  const bear = !!len && bears(app, op, ((len - op.gap) / 2) * S - 0.0001);
  const bot = op.top + bed, q = new THREE.Quaternion().setFromAxisAngle(_Y, op.yaw);
  // nothing in its way above the course
  const me = { x, z, yaw: op.yaw, ux: op.ux, uz: op.uz, hl: L / 2, hw: op.width / 2, bot, top: bot + H };
  const clash = app.objects.all('unit').filter((u) => u.p && u.s && u.q).map(boxOf).some((b) => me.bot < b.top - 1e-5 && me.top > b.bot + 1e-5 && overlap(me, b));
  // why it can't go: too wide / short of bearing / something above the course (a jamb a course higher)
  const why = !len ? 'long' : !bear ? 'bear' : clash ? 'clash' : null;
  return { ok: !why, why, how: 'lintel', kind: 'lintel', lenMm: len || 0, gapMm: Math.round(op.gap), p: new THREE.Vector3(x, bot + H / 2, z), q, s: new THREE.Vector3(L, H, op.width), bedY: op.top + bed / 2, bedT: bed };
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
    if (finger) { const sp = screen(new THREE.Vector3(b.x, b.top, b.z)); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 120) continue; d += Math.abs(b.top - p.y) * 3000; }   // (the one at the height the finger is on)
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
  return { run, pick, s0, s1, has: (() => { const k = run.map((b) => b.u.id).sort((x, y) => x - y).join(','); return [...app.objects.all('bar'), ...app.objects.all('cage')].some((r) => r.uRun === k); })() };
}

// the cage of a run, as on site: 4 bars Ø12 tied into square stirrups Ø6 every ≤ 350 mm
// (wire at each corner), plastic wheel spacers («звёздочки») on the bars — they hold the
// cage 30 mm off the floor and the walls of the channel. One `cage` record.
export function cageRec(R, app) {
  const b = R.pick, M = (v) => v * S, fl = b.bot + M(60);
  const ds = M(6), d = M(12);
  const sx = M(47), yb = fl + M(28), yt = fl + M(157);          // stirrup centre lines
  const bx = M(38), ybb = fl + M(37), ybt = fl + M(148);        // bars inside its corners
  const P = (s, o, y) => [b.x + b.ux * s - b.uz * o, y, b.z + b.uz * s + b.ux * o].map((v) => +v.toFixed(5));
  const s0 = R.s0 + M(30), s1 = R.s1 - M(30);
  const bars = [], ties = [], stars = [];
  for (const y of [ybb, ybt]) for (const o of [-bx, bx]) bars.push([...P(s0, o, y), ...P(s1, o, y), +d.toFixed(6)]);
  // stirrups: evenly, ≤ 350 mm apart, 50 mm in from the ends
  const n = Math.max(1, Math.ceil((s1 - s0 - M(100)) / M(350)));
  const at = [];
  for (let k = 0; k <= n; k++) at.push(s0 + M(50) + (s1 - s0 - M(100)) * k / n);
  const yaw = Math.atan2(-b.uz, b.ux);
  at.forEach((s, k) => {
    const c = [P(s, -sx, yb), P(s, sx, yb), P(s, sx, yt), P(s, -sx, yt)];
    for (let i = 0; i < 4; i++) bars.push([...c[i], ...c[(i + 1) % 4], +ds.toFixed(6)]);
    for (const [o, y] of [[-bx, ybb], [bx, ybb], [bx, ybt], [-bx, ybt]]) ties.push([...P(s + M(8), o, y), +(d * 0.9).toFixed(6), 0.785]);
    // spacers on the bottom bars at every other stirrup (and the last): they reach the
    // floor and the wall; on the top bars — the walls
    if (k % 2 === 0 || k === at.length - 1) for (const [o, y] of [[-bx, ybb], [bx, ybb], [-bx, ybt], [bx, ybt]]) stars.push([...P(s + M(70), o, y), +yaw.toFixed(4), +M(36).toFixed(6)]);
  });
  // a corner: the run ends against U-blocks running across it (a ring beam in U-blocks) —
  // Г-shaped bars, 600 mm legs, carry the bars round into the other wall
  if (app) {
    const us = app.objects.all('unit').filter((u) => u.kind === 'ublock' && !R.run.some((r) => r.u.id === u.id)).map(boxOf);
    for (const [end, sg] of [[R.s0, -1], [R.s1, 1]]) {
      const qx = b.x + b.ux * (end + sg * M(150)), qz = b.z + b.uz * (end + sg * M(150));
      const near = us.filter((o) => Math.abs(o.bot - b.bot) < M(15) && Math.abs(Math.sin(o.yaw - b.yaw)) > 0.95 && Math.hypot(o.x - qx, o.z - qz) < o.hl + M(200));
      if (!near.length) continue;
      // which way the other wall goes from the corner (across this run)
      const side = Math.sign(near.reduce((a, o) => a + (-(o.x - b.x) * b.uz + (o.z - b.z) * b.ux), 0)) || 1;
      for (const y of [ybb, ybt]) for (const o of [-bx, bx]) {
        // (the bend on the line of the other wall's bar: the outer bar round the outside)
        const bend = end + sg * (M(150) + (o * side < 0 ? bx : -bx));
        const A = P(end - sg * M(600), o, y), Bp = P(bend, o, y);
        const C = [Bp[0] - b.uz * side * M(600), y, Bp[2] + b.ux * side * M(600)].map((v) => +v.toFixed(5));
        bars.push([...A, ...Bp, +d.toFixed(6)], [...Bp, ...C, +d.toFixed(6)]);
      }
    }
  }
  return { type: 'cage', outlineId: null, uRun: R.run.map((x) => x.u.id).sort((x, y) => x - y).join(','), bars, chairs: [], frogs: [], ties, tied: true, stars, d };
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
