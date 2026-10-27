import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { boxOf } from './freeBrick.js';
import { beltContains } from './belt.js';

// The openings left in the masonry (by hand, block by block, or by a wall drawn with an
// opening): along each line of wall, in each course, the gaps between the units; a gap
// over the same place course after course is an opening — from the top of the course
// under it (or the floor) up to what spans it (a lintel, U-blocks, a ring beam, a slab).
//   → [{ x, z (the middle of the opening on the middle of the wall), y0, y1 (model),
//        w, h, t (mm), yaw (the window's: local +z = outside), ok, why }]
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const MIN_W = 350, MIN_H = 350;

// the lines of wall: a direction (one way only), the offset across it (d), the half
// thickness (hw), the units along it { a0, a1, bot, top, b }
export function wallLines(units) {
  const lines = [];
  for (const b of units) {
    for (const [ax, az, along, across] of [[b.ux, b.uz, b.hl, b.hw], [-b.uz, b.ux, b.hw, b.hl]]) {
      // (a unit belongs to the line it runs along; a header / a turned one to both)
      if (along < across * 0.9 && across > MM(150)) continue;
      let ux = ax, uz = az;
      if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uz < 0)) { ux = -ux; uz = -uz; }
      const d = -b.x * uz + b.z * ux, a = b.x * ux + b.z * uz;
      let L = lines.find((l) => Math.abs(l.ux * uz - l.uz * ux) < 0.05 && Math.abs(l.d - d) < Math.max(l.hw, across) + MM(40));   // (laid by hand: up to 3° and 40 mm off)
      if (!L) lines.push((L = { ux, uz, d, hw: across, units: [] }));
      L.hw = Math.max(L.hw, across);
      L.units.push({ a0: a - along, a1: a + along, bot: b.bot, top: b.top, b });
    }
  }
  return lines;
}
export const masonry = (app) => app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf);

export function findOpenings(app) {
  const units = masonry(app);
  if (!units.length) return [];
  // the middle of the masonry (which side of a wall is outside)
  let cx = 0, cz = 0; for (const b of units) { cx += b.x; cz += b.z; } cx /= units.length; cz /= units.length;
  const lines = wallLines(units);
  const out = [];
  for (const L of lines) {
    if (L.units.length < 3) continue;
    // its courses: the levels of the bottoms of the units
    const lv = [];
    // (a course of bricks under blocks is a course of its own: the step to the next one is
    // over half the lower of the two units, not of the block)
    for (const u of [...L.units].sort((p, q) => p.bot - q.bot)) if (!lv.length || u.bot - lv.at(-1).bot > Math.min(u.top - u.bot, lv.at(-1).us[0].top - lv.at(-1).us[0].bot) * 0.5) lv.push({ bot: u.bot, top: u.top, us: [u] }); else { const c = lv.at(-1); c.us.push(u); c.top = Math.max(c.top, u.top); }
    // each course: the masonry along it (joints bridged), the gaps between
    const covered = (c) => { const iv = c.us.map((u) => [u.a0, u.a1]).sort((p, q) => p[0] - q[0]), m = []; for (const v of iv) { if (m.length && v[0] <= m.at(-1)[1] + MM(30)) m.at(-1)[1] = Math.max(m.at(-1)[1], v[1]); else m.push([...v]); } return m; };
    const gaps = lv.map((c) => { const m = covered(c), g = []; for (let i = 1; i < m.length; i++) if (m[i][0] - m[i - 1][1] >= MM(MIN_W)) g.push([m[i - 1][1], m[i][0]]); return g; });
    const used = lv.map(() => new Set());
    for (let k = 0; k < lv.length; k++) gaps[k].forEach((g0, gi) => {
      if (used[k].has(gi)) return;
      // up the courses while the gap goes on (the width: what is open in all of them)
      let a0 = g0[0], a1 = g0[1], top = k;
      used[k].add(gi);
      for (let q = k + 1; q < lv.length; q++) {
        if (lv[q].bot - lv[q - 1].top > MM(60)) break;   // (a slab / a ring beam between: the next storey's opening)
        const j = gaps[q].findIndex((g) => Math.min(a1, g[1]) - Math.max(a0, g[0]) >= MM(MIN_W));
        if (j < 0) break;
        // a lintel cast in place spans it at this course (the course beside it, the gap filled
        // with concrete): the opening stops under it (a floor slab cast inside at this level does not)
        { const m = (a0 + a1) / 2, mx = L.ux * m - L.uz * L.d, mz = L.uz * m + L.ux * L.d;
          if (app.objects.all('belt').some((b) => b.kind !== 'slab' && b.fill > 0.3 && b.top > lv[q - 1].top - MM(30) && b.top < lv[q].bot + MM(40) && beltContains(b, mx, mz))) break; }
        used[q].add(j); a0 = Math.max(a0, gaps[q][j][0]); a1 = Math.min(a1, gaps[q][j][1]); top = q;
      }
      // the bottom: the top of the course under it, or the floor (the bed under the first course)
      // the storey: back down to the first course over a slab / the foundation
      let k0 = k; while (k0 > 0 && lv[k0].bot - lv[k0 - 1].top <= MM(60)) k0--;
      const first = k === k0, yTop = lv[top].top;
      let y0 = !first ? lv[k - 1].top : lv[k].bot - (lv[k].us[0].b.u.bedT ?? MM(20));
      // nothing under it down to the bottom of the masonry beside it (any of it — a first course
      // laid a little off this line, a slab cast in the gap): the opening goes on down there
      const band = L.hw + MM(200), near = [];
      for (const b of units) {
        const ba = b.x * L.ux + b.z * L.uz, bd = -b.x * L.uz + b.z * L.ux, ext = Math.abs(b.hl * (b.ux * L.ux + b.uz * L.uz)) + Math.abs(b.hw * (-b.uz * L.ux + b.ux * L.uz));
        if (Math.abs(bd - L.d) < band && ba + ext > a0 - MM(1500) && ba - ext < a1 + MM(1500) && b.top > lv[k0].bot - MM(150)) near.push({ b, ba, ext });   // (this storey's)
      }
      const under = near.some((q) => q.ba + q.ext > a0 + MM(20) && q.ba - q.ext < a1 - MM(20) && q.b.bot < y0 - MM(5));
      const deep = Math.min(...near.map((q) => q.b.bot - (q.b.u.bedT ?? MM(20))));
      if (!under && deep < y0 - MM(30)) y0 = deep;
      // the top: a lintel / U-blocks / the next course spanning it, or a ring beam / a slab on the walls
      // the plane of this storey's wall by the opening (a wall upstairs set a little off the one
      // under it is on the same line, but the window goes in its own plane): the middle of the
      // units of these courses near it
      let Ld = L.d;
      { const ds = []; for (let q = k; q <= top; q++) for (const u of lv[q].us) if (u.a1 > a0 - MM(1200) && u.a0 < a1 + MM(1200)) ds.push(-u.b.x * L.uz + u.b.z * L.ux);
        if (ds.length) { ds.sort((p, q) => p - q); Ld = ds[ds.length >> 1]; } }
      const mid = (a0 + a1) / 2, x = L.ux * mid - L.uz * Ld, z = L.uz * mid + L.ux * Ld;
      let y1 = null, why = null;
      const over = L.units.filter((u) => u.bot > yTop - MM(5) && u.bot < yTop + MM(80) && u.a0 < a1 && u.a1 > a0);
      if (over.length) {
        const iv = over.map((u) => [u.a0, u.a1]).sort((p, q) => p[0] - q[0]); let reach = a0 + MM(5), ok = true;
        for (const v of iv) { if (v[0] > reach + MM(30)) { ok = false; break; } reach = Math.max(reach, v[1]); }   // (the joints between them bridged)
        y1 = Math.min(...over.map((u) => u.bot)) - (over[0].b.u.bedT ?? 0);
        if (!ok || reach < a1 - MM(5)) why = 'Над проёмом кладка не сплошная — положите перемычку или U-блоки';
      } else {
        // a ring beam / a slab cast on the walls each side of it (its plan may stop at the gap:
        // it was set out on the masonry) spans it
        const side = (a) => [L.ux * a - L.uz * Ld, L.uz * a + L.ux * Ld];
        const bl = app.objects.all('belt').find((b) => b.fill > 0.3 && b.top > yTop - MM(30) && b.top < yTop + MM(80) && (beltContains(b, x, z) || (beltContains(b, ...side(a0 - MM(150))) && beltContains(b, ...side(a1 + MM(150))))));
        if (bl) y1 = bl.top;
        else { y1 = yTop; why = 'Над проёмом нет перемычки — сначала перемычка, U-блоки или перекрытие'; }
      }
      const w = (a1 - a0) / S, h = (y1 - y0) / S;
      if (h < MIN_H) return;
      // the outside: away from the middle of the masonry
      const nx = -L.uz, nz = L.ux, outSign = (x - cx) * nx + (z - cz) * nz >= 0 ? 1 : -1;
      const yaw = Math.atan2(-L.uz, L.ux) + (outSign > 0 ? 0 : Math.PI);
      const floor0 = Math.min(deep, lv[k0].bot - (lv[k0].us[0].b.u.bedT ?? MM(20)));   // (a doorway: from the floor, or over the first course — a step; a brick plinth under it too: ≤ 450 mm)
      out.push({ x, z, y0, y1, w: Math.round(w), h: Math.round(h), t: Math.round((L.hw * 2) / S), yaw, ok: !why, why, floor: y0 - floor0 < MM(450), line: L });
    });
  }
  return out;
}

// the opening the finger is over (on the screen: inside its outline, else the nearest
// middle within 160 px); screen(v) → { x, y, front }
export function openingAt(list, p, screen, finger) {
  let best = null, bd = Infinity;
  for (const o of list) {
    const c = new THREE.Vector3(o.x, (o.y0 + o.y1) / 2, o.z);
    let d;
    if (finger) {
      const sp = screen(c); if (!sp.front) continue;
      d = Math.hypot(sp.x - finger.x, sp.y - finger.y);
      // inside its outline on the screen: the corners
      const ux = Math.cos(o.yaw), uz = -Math.sin(o.yaw), hw = o.w * S / 2;
      const cs = [[-hw, o.y0], [hw, o.y0], [hw, o.y1], [-hw, o.y1]].map(([a, y]) => screen(new THREE.Vector3(o.x + ux * a, y, o.z + uz * a)));
      const xs = cs.map((q) => q.x), ys = cs.map((q) => q.y);
      if (finger.x > Math.min(...xs) && finger.x < Math.max(...xs) && finger.y > Math.min(...ys) && finger.y < Math.max(...ys)) d *= 0.2;
      else if (d > 160) continue;
    } else { d = Math.hypot(p.x - o.x, p.z - o.z); if (d > o.w * S / 2 + 0.03 || p.y < o.y0 - 0.01 || p.y > o.y1 + 0.01) continue; }
    if (d < bd) bd = d, best = o;
  }
  return best;
}

// Corner openings (for corner glazing): two walls meeting at a corner, both stopping short of it
// course after course — the corner itself open from the floor (or a sill course) up to the slab /
// the ring beam cast over it, which carries the corner (a cantilever: no post in the corner).
//   → [{ corner: true, O: [x, z] (the outer corner), dA, dB (unit, from the corner along each wall
//        toward its masonry), wA, wB (mm: the corner to each wall's masonry), tA, tB (mm), y0, y1,
//        x, z, w, h, yaw (for picking: leg A), ok, why, floor }]
export function findCorners(app) {
  const units = masonry(app);
  if (units.length < 6) return [];
  let cx = 0, cz = 0; for (const b of units) { cx += b.x; cz += b.z; } cx /= units.length; cz /= units.length;
  const lines = wallLines(units).filter((L) => L.units.length >= 3), out = [];
  // a course of a line: its bottom, top and what it covers along it (the joints bridged)
  const courses = (L) => {
    const lv = [];
    for (const u of [...L.units].sort((p, q) => p.bot - q.bot)) if (!lv.length || u.bot - lv.at(-1).bot > Math.min(u.top - u.bot, lv.at(-1).us[0].top - lv.at(-1).us[0].bot) * 0.5) lv.push({ bot: u.bot, top: u.top, us: [u] }); else { const c = lv.at(-1); c.us.push(u); c.top = Math.max(c.top, u.top); }
    for (const c of lv) { const iv = c.us.map((u) => [u.a0, u.a1]).sort((p, q) => p[0] - q[0]), m = []; for (const v of iv) { if (m.length && v[0] <= m.at(-1)[1] + MM(30)) m.at(-1)[1] = Math.max(m.at(-1)[1], v[1]); else m.push([...v]); } c.m = m; }
    return lv;
  };
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const A = lines[i], B = lines[j];
    if (Math.abs(A.ux * B.ux + A.uz * B.uz) > 0.05) continue;
    // where their axes cross: a point of a line has p·n = d (n = (−uz, ux))
    const det = -A.uz * B.ux + A.ux * B.uz;
    if (Math.abs(det) < 1e-9) continue;
    const Cx = (A.d * B.ux - A.ux * B.d) / det, Cz = (-A.uz * B.d + B.uz * A.d) / det;
    const aC = Cx * A.ux + Cz * A.uz, bC = Cx * B.ux + Cz * B.uz;
    // each wall's masonry on one side of the corner only, and near it (not a wall far off on the same line)
    const side = (L, c) => { const m = L.units.map((u) => (u.a0 + u.a1) / 2 - c); return m.every((v) => v > 0) ? 1 : m.every((v) => v < 0) ? -1 : 0; };
    const sA = side(A, aC), sB = side(B, bC);
    if (!sA || !sB) continue;
    const endA = sA > 0 ? Math.min(...A.units.map((u) => u.a0)) : Math.max(...A.units.map((u) => u.a1)), endB = sB > 0 ? Math.min(...B.units.map((u) => u.a0)) : Math.max(...B.units.map((u) => u.a1));
    if (Math.abs(endA - aC) > MM(7000) || Math.abs(endB - bC) > MM(7000)) continue;
    // the courses: open at the corner in both (the masonry's end in each this far from the corner)
    const ca = courses(A), cb = courses(B), lv = [];
    for (const c of ca) {
      const d = cb.find((q) => Math.abs(q.bot - c.bot) < (c.top - c.bot) * 0.5);
      if (!d) continue;
      const gap = (cs, cc, s, hwO) => { const e = s > 0 ? Math.min(...cs.m.map((v) => v[0]).filter((v) => v > cc - hwO - MM(30))) : Math.max(...cs.m.map((v) => v[1]).filter((v) => v < cc + hwO + MM(30))); return Number.isFinite(e) ? Math.abs(e - cc) - hwO : 0; };
      lv.push({ bot: Math.min(c.bot, d.bot), top: Math.max(c.top, d.top), gA: gap(c, aC, sA, B.hw), gB: gap(d, bC, sB, A.hw), bed: c.us[0].b.u.bedT ?? MM(20) });
    }
    // the open run at the top of the storey: down from the top course while both are open
    let k1 = lv.length - 1; while (k1 >= 0 && !(lv[k1].gA >= MM(MIN_W) && lv[k1].gB >= MM(MIN_W))) k1--;
    if (k1 < 0) continue;
    let k0 = k1; while (k0 > 0 && lv[k0 - 1].gA >= MM(MIN_W) && lv[k0 - 1].gB >= MM(MIN_W) && lv[k0].bot - lv[k0 - 1].top < MM(60)) k0--;
    const gA = Math.min(...lv.slice(k0, k1 + 1).map((c) => c.gA)), gB = Math.min(...lv.slice(k0, k1 + 1).map((c) => c.gB));
    const y0 = k0 > 0 && lv[k0].bot - lv[k0 - 1].top < MM(60) ? lv[k0 - 1].top : lv[k0].bot - lv[k0].bed, yTop = lv[k1].top;
    // the outer corner (the outer faces of both walls), the walls' directions from it
    const nAx = -A.uz, nAz = A.ux, nBx = -B.uz, nBz = B.ux;
    const oA = ((Cx - cx) * nAx + (Cz - cz) * nAz) >= 0 ? 1 : -1, oB = ((Cx - cx) * nBx + (Cz - cz) * nBz) >= 0 ? 1 : -1;
    const Ox = Cx + nAx * oA * A.hw + nBx * oB * B.hw, Oz = Cz + nAz * oA * A.hw + nBz * oB * B.hw;
    const dA = [A.ux * sA, A.uz * sA], dB = [B.ux * sB, B.uz * sB];
    const wA = Math.round((gA + 2 * B.hw) / S), wB = Math.round((gB + 2 * A.hw) / S);
    // over it: a slab / a ring beam cast over the corner carries it
    const px = Ox + (dA[0] + dB[0]) * MM(100), pz = Oz + (dA[1] + dB[1]) * MM(100);
    const bl = app.objects.all('belt').find((b) => b.fill > 0.3 && b.top > yTop - MM(30) && b.top < yTop + MM(80) && beltContains(b, px, pz));
    const y1 = bl ? bl.top : yTop, h = Math.round((y1 - y0) / S);
    if (h < MIN_H) continue;
    const floor0 = Math.min(...[...A.units, ...B.units].map((u) => u.bot - (u.b.u.bedT ?? MM(20))));
    const mx = Ox + dA[0] * MM(wA / 2) + dB[0] * MM(150), mz = Oz + dA[1] * MM(wA / 2) + dB[1] * MM(150);
    out.push({ corner: true, O: [+Ox.toFixed(6), +Oz.toFixed(6)], dA, dB, wA, wB, tA: Math.round(A.hw * 2 / S), tB: Math.round(B.hw * 2 / S), y0, y1, h, w: Math.min(wA, wB), t: Math.round(A.hw * 2 / S),
      x: mx, z: mz, yaw: Math.atan2(-dA[1], dA[0]), ok: !!bl, why: bl ? null : 'Над угловым проёмом нужна плита или монолитный пояс — угол без стойки держит перекрытие (консоль)', floor: y0 - floor0 < MM(450) });
  }
  return out;
}
