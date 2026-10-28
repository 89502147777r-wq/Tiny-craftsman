import * as THREE from 'three';
import { MODEL_SCALE, CONCRETE } from '../config.js';
import { KINDS } from '../world/walls.js';
import { boxOf, unitBoxes, boxesNear } from './freeBrick.js';
import { rle } from './belt.js';

// Openings in free masonry and what spans them:
//   lintel – a precast lintel: a standard length (1.0 … 3.0 m) that bears ≥ 250 mm on the
//            masonry each side, laid on the course beside the opening (on glue / mortar);
//   prop   – a temporary prop under an opening: a board at the level of the course top on
//            two posts, for U-blocks to be laid over the opening;
//   U-blocks are laid like blocks (freeBrick.js), on the prop and the masonry; the cage —
//            four Ø12 bars — goes into their channel; the hose fills the channel with
//            concrete (HoseTool), which sets; then the prop may come out.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S, _Y = new THREE.Vector3(0, 1, 0);
export const LINTEL_LENGTHS = [1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3600, 3900];   // (3ПБ 36, 3ПБ 39 for the wide ones)
export const MAX_GAP = 6000;   // (over 3,4 m no precast lintel — a cast one in its formwork, or a prop and U-blocks; 6 m: the widest garage door)
const BEAR = 250;

// the opening nearest the finger: a gap 300 … 6000 mm between two units of one course,
// in one line — { ux, uz, nx, nz, yaw, c0, c1 (gap ends along), o (line point), top,
// width, gap }. Hand-laid jambs are rarely exact: the two sides may differ in height by
// up to a third of a course (an uneven footing) and stand off the line by up to a quarter
// of the wall's thickness
const tolY = (a, b) => 0.34 * Math.min(a.top - a.bot, b.top - b.bot);
export function findOpening(app, p, screen, finger) {
  const boxes = unitBoxes(app).filter((b) => b.kind !== 'lintel' && b.u.kind !== 'prop');
  // the units by their line (the wall's direction) and course (60 mm bands): a gap is between two of
  // one course in one line, so only those are paired — never every unit with every other
  const yawK = (b) => Math.round((((b.yaw % Math.PI) + Math.PI) % Math.PI) / 0.04) % 79, bands = new Map();
  for (let i = 0; i < boxes.length; i++) { const b = boxes[i], k = yawK(b) * 100000 + Math.round(b.top / (60 * S)); if (!bands.has(k)) bands.set(k, []); bands.get(k).push(i); }
  const near = (b) => { const y = yawK(b), t = Math.round(b.top / (60 * S)), out = []; for (const dy of [-1, 0, 1]) for (const dt of [-2, -1, 0, 1, 2]) { const L = bands.get(((y + dy + 79) % 79) * 100000 + t + dt); if (L) out.push(...L); } return out; };
  let best = null, bd = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i], NB = near(a);
    for (const j of NB) {
      if (j <= i) continue;
      const b = boxes[j], ty = tolY(a, b);
      if (Math.abs(a.top - b.top) > ty || Math.abs(Math.sin(a.yaw - b.yaw)) > 0.05) continue;
      const dx = b.x - a.x, dz = b.z - a.z, along = dx * a.ux + dz * a.uz, side = -dx * a.uz + dz * a.ux;
      if (Math.abs(side) > Math.min(a.hw, b.hw) / 2) continue;
      const gap = (Math.abs(along) - a.hl - b.hl) / S;
      if (gap < 300 || gap > MAX_GAP) continue;
      // nothing of that course in between
      const sg = Math.sign(along), e0 = a.hl, e1 = Math.abs(along) - b.hl;
      // (any unit of that course: turned ones too — the corner of a cross wall is no opening)
      const gx = a.x + a.ux * sg * (e0 + e1) / 2, gz = a.z + a.uz * sg * (e0 + e1) / 2;
      if (boxesNear(app, gx, gz, (e1 - e0) / 2 + 0.01).some((u) => u !== a && u !== b && u.u.kind !== 'prop' && Math.abs(u.top - a.top) < ty && (() => {
        const ex = u.x - a.x, ez = u.z - a.z, s = (ex * a.ux + ez * a.uz) * sg, sd = -ex * a.uz + ez * a.ux;
        const ha = Math.abs(u.hl * (u.ux * a.ux + u.uz * a.uz)) + Math.abs(u.hw * (-u.uz * a.ux + u.ux * a.uz)), hd = Math.abs(u.hl * (-u.uz * a.ux + u.ux * a.uz)) + Math.abs(u.hw * (u.ux * a.ux + u.uz * a.uz));
        return Math.abs(sd - side / 2) < a.hw + hd && s + ha > e0 + 0.0001 && s - ha < e1 - 0.0001;
      })())) continue;
      // (masonry under both ends of the gap, in the course below, an opening left between them: a
      // pocket for a lintel over that narrower opening — not an opening itself)
      { const bed0 = Math.min(a.bot, b.bot); let L0 = false, L1 = false;
        for (const u of boxesNear(app, gx, gz, (e1 - e0) / 2 + 0.01)) {
          if (u === a || u === b || u.kind === 'lintel' || u.u.kind === 'prop' || Math.abs(u.top - bed0) > ty) continue;
          const ex = u.x - a.x, ez = u.z - a.z, s = (ex * a.ux + ez * a.uz) * sg, sd = -ex * a.uz + ez * a.ux;
          const ha = Math.abs(u.hl * (u.ux * a.ux + u.uz * a.uz)) + Math.abs(u.hw * (-u.uz * a.ux + u.ux * a.uz)), hd = Math.abs(u.hl * (-u.uz * a.ux + u.ux * a.uz)) + Math.abs(u.hw * (u.ux * a.ux + u.uz * a.uz));
          if (Math.abs(sd - side / 2) >= a.hw + hd) continue;
          if (s - ha < e0 + MM(20) && s + ha > e0 + MM(150)) L0 = true;
          if (s + ha > e1 - MM(20) && s - ha < e1 - MM(150)) L1 = true;
        }
        if (L0 && L1) continue; }
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
  }
  if (best) fullWidth(best, boxes);
  return best;
}
// the whole thickness of the wall by the opening (a brick wall of 1 – 2½ bricks: its leaves side by
// side, headers across) — what spans it spans all of it: the line moved to its middle
function fullWidth(op, boxes) {
  let lo = Infinity, hi = -Infinity;
  for (const b of boxes) {
    if (Math.abs(b.top - op.top) > op.ty || Math.abs(Math.sin(b.yaw - op.yaw) * Math.cos(b.yaw - op.yaw)) > 0.05) continue;
    // (a turned unit is a header only in brickwork; by a block or cinder wall it is a cross wall)
    if (Math.abs(Math.sin(b.yaw - op.yaw)) > 0.5 && (op.kind !== 'brick' || b.kind !== 'brick')) continue;
    const dx = b.x - op.o[0], dz = b.z - op.o[1], s = dx * op.ux + dz * op.uz, sd = -dx * op.uz + dz * op.ux;
    const ha = Math.abs(b.hl * (b.ux * op.ux + b.uz * op.uz)) + Math.abs(b.hw * (-b.uz * op.ux + b.ux * op.uz)), hd = Math.abs(b.hl * (-b.uz * op.ux + b.ux * op.uz)) + Math.abs(b.hw * (b.ux * op.ux + b.uz * op.uz));
    // (beside the opening, within 600 mm of its sides, across the line up to 700 mm)
    if (Math.abs(sd) > 700 * S || s + ha < op.c0 - 600 * S || s - ha > op.c1 + 600 * S || (s - ha > op.c0 - 1e-4 && s + ha < op.c1 + 1e-4)) continue;
    lo = Math.min(lo, sd - hd); hi = Math.max(hi, sd + hd);
  }
  if (!(hi - lo > op.width + 5 * S)) return;
  const m = (lo + hi) / 2;
  op.o = [op.o[0] - op.uz * m, op.o[1] + op.ux * m]; op.width = hi - lo;
}
// the masonry the opening is in: its course height (a lintel the height of a course — two of bricks)
const kindOf = (op) => KINDS[op.kind === 'block' || op.kind === 'ublock' ? 'block' : op.kind === 'cinder' ? 'cinder' : 'brick'];

// the course beside the opening carries it for `len` (model) from the gap end, each side:
// the top it rests on (the highest unit under its ends — hand-laid courses differ by a few
// mm; the mortar under it makes up the rest), or null when the course is short of it
function bears(app, op, len, side) {
  const boxes = unitBoxes(app).filter((b) => b.kind !== 'lintel' && b.u.kind !== 'prop');
  const covered = (s0, s1) => {
    const iv = [];
    for (const b of boxes) {
      if (Math.abs(b.top - op.top) > op.ty) continue;
      const dx = b.x - op.o[0], dz = b.z - op.o[1], s = dx * op.ux + dz * op.uz, sd = -dx * op.uz + dz * op.ux;
      if (Math.abs(sd) > op.width / 2 + op.side) continue;
      iv.push([s - b.hl - 0.0012, s + b.hl + 0.0012, b.top]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let e = s0, top = -Infinity;
    for (const [a, b, t] of iv) { if (a > e + 1e-5) break; if (b > s0 && a < s1) top = Math.max(top, t); e = Math.max(e, b); }
    return e >= s1 - 1e-5 ? top : null;
  };
  if (side === 'L') return covered(op.c0 - len, op.c0);
  if (side === 'R') return covered(op.c1, op.c1 + len);
  const t0 = covered(op.c0 - len, op.c0), t1 = covered(op.c1, op.c1 + len);
  return t0 != null && t1 != null ? Math.max(t0, t1) : null;
}

function bearsAt(app, op, a0, a1) {
  const lenL = op.c0 - a0, lenR = a1 - op.c1;
  if (lenL <= 0 || lenR <= 0) return null;
  const t0 = bears(app, op, lenL, 'L'), t1 = bears(app, op, lenR, 'R');
  return t0 != null && t1 != null ? Math.max(t0, t1) : null;
}
// a precast lintel over the opening under the finger: the standard length that bears ≥ 250 mm each
// side; when the course at its level is already laid with pockets for it, it goes into them — moved
// along off the middle, or one size shorter (≥ 200 mm of bearing each side), as a mason fits it
export function placeLintel(app, p, screen, finger) {
  const op = findOpening(app, p, screen, finger);
  if (!op) return null;
  const k = kindOf(op);
  const H = (op.kind === 'brick' ? 2 * k.H + k.bed : k.H) * S, bed = k.bed * S, MINB = 200;
  let len = LINTEL_LENGTHS.find((l) => l >= op.gap + 2 * BEAR), mid = (op.c0 + op.c1) / 2;
  const sup0 = len ? bears(app, op, ((len - op.gap) / 2) * S - 0.0001) : null;
  const lvl = (sup0 ?? op.top) + bed;
  // (the pocket: what already stands in the course at its level, either side of the opening)
  const along = (b) => { const s = (b.x - op.o[0]) * op.ux + (b.z - op.o[1]) * op.uz, sd = -(b.x - op.o[0]) * op.uz + (b.z - op.o[1]) * op.ux, ha = Math.abs(b.hl * (b.ux * op.ux + b.uz * op.uz)) + Math.abs(b.hw * (-b.uz * op.ux + b.ux * op.uz)), hd = Math.abs(b.hl * (-b.uz * op.ux + b.ux * op.uz)) + Math.abs(b.hw * (b.ux * op.ux + b.uz * op.uz)); return { s, sd, ha, hd }; };
  let pl = -Infinity, pr = Infinity, inGap = false;
  for (const b of boxesNear(app, op.o[0] + op.ux * mid, op.o[1] + op.uz * mid, (op.c1 - op.c0) / 2 + 4000 * S)) {
    if (b.kind === 'lintel' || b.u.kind === 'prop' || !(b.bot < lvl + H - 0.0005 && b.top > lvl + 0.0005)) continue;
    const { s, sd, ha, hd } = along(b);
    if (Math.abs(sd) >= op.width / 2 + hd - 0.0005) continue;   // (beside the wall, not in it: a cross wall's end butting into it counts)
    if (s + ha <= op.c0 + 0.0005) pl = Math.max(pl, s + ha);
    else if (s - ha >= op.c1 - 0.0005) pr = Math.min(pr, s - ha);
    else inGap = true;
  }
  if (len && !inGap && (pr - pl) / S < len + 2) {
    // the pocket shorter than the lintel: one that fits it (with its bearing), the longest such
    const fit = [...LINTEL_LENGTHS].reverse().find((l) => l <= (pr - pl) / S + 2 && l >= op.gap + 2 * MINB);
    if (fit) len = fit;
  }
  const L = (len || 3000) * S;
  if (len && !inGap && Number.isFinite(pl) && Number.isFinite(pr) && pr - pl >= L - 0.0002) {
    // set into the pocket: as near the middle as it goes, ≥ 200 mm on each jamb
    const lo = Math.max(pl + L / 2, op.c1 + MINB * S - L / 2), hi = Math.min(pr - L / 2, op.c0 - MINB * S + L / 2);
    if (lo <= hi + 1e-6) mid = Math.min(hi, Math.max(lo, mid));
  }
  const a0 = mid - L / 2, a1 = mid + L / 2;
  const sup = len ? bearsAt(app, op, a0 + 0.0001, a1 - 0.0001) : null, bear = sup != null;
  const x = op.o[0] + op.ux * mid, z = op.o[1] + op.uz * mid;
  const bot = (bear ? sup : op.top) + bed, q = new THREE.Quaternion().setFromAxisAngle(_Y, op.yaw);
  // nothing in its way above the course
  const me = { x, z, yaw: op.yaw, ux: op.ux, uz: op.uz, hl: L / 2, hw: op.width / 2, bot, top: bot + H };
  const hit = unitBoxes(app).find((b) => me.bot < b.top - 1e-5 && me.top > b.bot + 1e-5 && overlap(me, b));
  // why it can't go: too wide / short of bearing / the next course already over its ends /
  // something else in its place
  const why = !len ? 'long' : !bear ? 'bear' : hit ? (hit.bot > me.bot - (me.top - me.bot) * 0.5 ? 'above' : 'clash') : null;
  return { ok: !why, why, how: 'lintel', kind: 'lintel', lenMm: len || 0, gapMm: Math.round(op.gap), p: new THREE.Vector3(x, bot + H / 2, z), q, s: new THREE.Vector3(L, H, op.width), bedY: op.top + bed / 2, bedT: bed };
}

// a lintel cast in place in a timber formwork (опалубка перемычки) over the opening under
// the finger: a belt record (belt.js — the cage, the concrete, the vibrator, the stripping
// work on it as on a ring beam) over the opening and 250 mm onto the course each side, the
// height of a course (two brick courses); under it over the opening a deck on beams and
// posts down to the floor (lform: the opening in its frame)
export function placeLintelForm(app, p, screen, finger) {
  const op = findOpening(app, p, screen, finger);
  if (!op) return null;
  const k = kindOf(op);
  const c = 50 * S, bear = BEAR * S, W = op.width;
  const sup = bears(app, op, bear - 0.0001);
  const top = sup ?? op.top, H = (op.kind === 'brick' ? 2 * k.H + k.bed : k.H) * S;
  const t = app.terrain, boxes = unitBoxes(app);
  // the ends: 250 mm onto the course each side — or as far as what already stands in the
  // course there (a block laid beside it: the formwork runs to its face, no board across
  // the end — the concrete is cast against the block, no gap left when it comes off)
  const ls = (b) => (b.x - op.o[0]) * op.ux + (b.z - op.o[1]) * op.uz, lt = (b) => -(b.x - op.o[0]) * op.uz + (b.z - op.o[1]) * op.ux;
  const hu = (b) => Math.abs(b.hl * (b.ux * op.ux + b.uz * op.uz)) + Math.abs(b.hw * (-b.uz * op.ux + b.ux * op.uz));
  let sA = op.c0 - bear, sB = op.c1 + bear;
  const closed = [false, false];
  for (const b of boxes) {
    if (b.bot < top - 5 * S || b.bot > top + 40 * S || Math.abs(lt(b)) > W / 2) continue;
    const s = ls(b), h = hu(b);
    if (s < op.c0) { const f = s + h; if (f > op.c0 - bear - 400 * S && f <= op.c0 - 150 * S && (!closed[0] || f > sA)) { sA = f; closed[0] = true; } }
    else if (s > op.c1) { const f = s - h; if (f < op.c1 + bear + 400 * S && f >= op.c1 + 150 * S && (!closed[1] || f < sB)) { sB = f; closed[1] = true; } }
  }
  const L = sB - sA, ni = Math.max(2, Math.round(L / c)), nj = Math.max(2, Math.round(W / c)), Wc = nj * c;
  const s0 = sA, tx = -op.uz, tz = op.ux;   // (s0: where it starts along the line)
  const o = [op.o[0] + op.ux * s0 - tx * Wc / 2, op.o[1] + op.uz * s0 - tz * Wc / 2];
  // the floor under the deck: the ground, or the masonry of a sill
  const mid = (op.c0 + op.c1) / 2, mx = op.o[0] + op.ux * mid, mz = op.o[1] + op.uz * mid;
  let floor = t.inside(mx, mz) ? t.heightAt(mx, mz) : 0;
  for (const b of boxes) if (b.top < top - 0.002 && Math.abs((mx - b.x) * b.ux + (mz - b.z) * b.uz) < b.hl && Math.abs(-(mx - b.x) * b.uz + (mz - b.z) * b.ux) < b.hw) floor = Math.max(floor, b.top);
  // nothing in its place (the next course already over the ends, a lintel, a belt)
  const me = { x: o[0] + op.ux * L / 2 + tx * Wc / 2, z: o[1] + op.uz * L / 2 + tz * Wc / 2, yaw: op.yaw, ux: op.ux, uz: op.uz, hl: L / 2, hw: Wc / 2, bot: top + 0.0003, top: top + H };
  const hit = boxes.find((b) => me.bot < b.top - 1e-5 && me.top > b.bot + 1e-5 && overlap(me, b));
  const taken = app.objects.all('belt').some((b) => !b.stripped && Math.abs(b.top - top) < 0.003 && Math.hypot(toW(b, b.ni * b.c / 2, b.nj * b.c / 2)[0] - me.x, toW(b, b.ni * b.c / 2, b.nj * b.c / 2)[1] - me.z) < me.hl);
  const why = sup == null ? 'bear' : hit ? (hit.bot > me.bot - H * 0.5 ? 'above' : 'clash') : taken ? 'taken' : top - floor < 0.004 ? 'low' : null;
  const n = ni * nj;
  const rec = {
    type: 'belt', lform: { g0: +(op.c0 - s0).toFixed(6), g1: +(op.c1 - s0).toFixed(6), floor: +floor.toFixed(6), closed }, clip: [0, 0, +L.toFixed(6), +Wc.toFixed(6)],
    o: o.map((v) => +v.toFixed(6)), u: [+op.ux.toFixed(6), +op.uz.toFixed(6)], c: +c.toFixed(7), ni, nj, mask: rle(new Uint8Array(n).fill(1)),
    top: +top.toFixed(6), H: +H.toFixed(6), lv: new Array(n).fill(0), sm: new Array(n).fill(0.3), fill: 0,
    segs: [[0, +L.toFixed(6), +(Wc / 2).toFixed(6), +(Wc / 2).toFixed(6), 1]],
  };
  return { ok: !why, why, rec, gapMm: Math.round(op.gap), lenMm: Math.round(L / S), hMm: Math.round(H / S) };
}
const toW = (b, s, t) => [b.o[0] + b.u[0] * s - b.u[1] * t, b.o[1] + b.u[1] * s + b.u[0] * t];

// a temporary prop under the opening: a board flush with the top of the course
export function placeProp(app, p, screen, finger) {
  const op = findOpening(app, p, screen, finger);
  if (!op) return null;
  const T = 40 * S, L = op.gap * S - 0.0008, mid = (op.c0 + op.c1) / 2;
  const x = op.o[0] + op.ux * mid, z = op.o[1] + op.uz * mid;
  // the floor under it: the ground, or the masonry of the sill under a window
  const t = app.terrain, boxes = unitBoxes(app);
  let floor = t.inside(x, z) ? t.heightAt(x, z) : 0;
  for (const b of boxes) if (b.top < op.top - T && Math.abs((x - b.x) * b.ux + (z - b.z) * b.uz) < b.hl && Math.abs(-(x - b.x) * b.uz + (z - b.z) * b.ux) < b.hw) floor = Math.max(floor, b.top);
  const q = new THREE.Quaternion().setFromAxisAngle(_Y, op.yaw);
  return { ok: op.top - T - floor > 0.002, how: 'prop', kind: 'prop', gapMm: Math.round(op.gap), post: op.top - T - floor, p: new THREE.Vector3(x, op.top - T / 2, z), q, s: new THREE.Vector3(L, T, op.width), bedY: op.top - T, bedT: 0 };
}

// the run of U-blocks under the finger (one course, in line, touching): for the cage
export function uRun(app, p, screen, finger) {
  const us = app.objects.all('unit').filter((u) => u.kind === 'ublock').map(boxOf);
  // the U-blocks with a cage already (a run done: the finger means another one)
  const caged = new Set([...app.objects.all('bar'), ...app.objects.all('cage')].flatMap((r) => (r.uRun ? String(r.uRun).split(',').map(Number) : [])));
  // the U-block the finger is on (the point under it on its top or in its channel) first
  let pick = us.find((b) => p.y > b.bot - 0.0005 && p.y < b.top + 0.002 && Math.abs((p.x - b.x) * b.ux + (p.z - b.z) * b.uz) <= b.hl + 0.001 && Math.abs(-(p.x - b.x) * b.uz + (p.z - b.z) * b.ux) <= b.hw + 0.001) || null, bd = Infinity;
  if (!pick) for (const b of us) {
    let d;
    if (finger) { const sp = screen(new THREE.Vector3(b.x, b.top, b.z)); if (!sp.front) continue; d = Math.hypot(sp.x - finger.x, sp.y - finger.y); if (d > 120) continue; d += Math.abs(b.top - p.y) * 3000; }   // (the one at the height the finger is on)
    else { d = Math.hypot(b.x - p.x, b.z - p.z); if (d > b.hl + 0.02) continue; d += Math.abs(b.top - p.y) * 3; }
    if (caged.has(b.u.id)) d += finger ? 400 : 1;   // (one without a cage before one with)
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
