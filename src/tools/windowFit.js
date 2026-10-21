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

export function findOpenings(app) {
  const units = app.objects.all('unit').filter((u) => u.p && u.s && u.q && u.kind !== 'prop').map(boxOf);
  if (!units.length) return [];
  // the middle of the masonry (which side of a wall is outside)
  let cx = 0, cz = 0; for (const b of units) { cx += b.x; cz += b.z; } cx /= units.length; cz /= units.length;
  // lines of wall: a direction (one way only) and the offset across it
  const lines = [];
  for (const b of units) {
    for (const [ax, az, along, across] of [[b.ux, b.uz, b.hl, b.hw], [-b.uz, b.ux, b.hw, b.hl]]) {
      // (a unit belongs to the line it runs along; a header / a turned one to both)
      if (along < across * 0.9 && across > MM(150)) continue;
      let ux = ax, uz = az;
      if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uz < 0)) { ux = -ux; uz = -uz; }
      const d = -b.x * uz + b.z * ux, a = b.x * ux + b.z * uz;
      let L = lines.find((l) => Math.abs(l.ux * uz - l.uz * ux) < 0.02 && Math.abs(l.d - d) < Math.max(l.hw, across) + MM(20));
      if (!L) lines.push((L = { ux, uz, d, hw: across, units: [] }));
      L.hw = Math.max(L.hw, across);
      L.units.push({ a0: a - along, a1: a + along, bot: b.bot, top: b.top, b });
    }
  }
  const out = [];
  for (const L of lines) {
    if (L.units.length < 3) continue;
    // its courses: the levels of the bottoms of the units
    const lv = [];
    for (const u of [...L.units].sort((p, q) => p.bot - q.bot)) if (!lv.length || u.bot - lv.at(-1).bot > MM(30)) lv.push({ bot: u.bot, top: u.top, us: [u] }); else { const c = lv.at(-1); c.us.push(u); c.top = Math.max(c.top, u.top); }
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
        const j = gaps[q].findIndex((g) => Math.min(a1, g[1]) - Math.max(a0, g[0]) >= MM(MIN_W));
        if (j < 0) break;
        used[q].add(j); a0 = Math.max(a0, gaps[q][j][0]); a1 = Math.min(a1, gaps[q][j][1]); top = q;
      }
      // the bottom: the top of the course under it, or the floor (the bed under the first course)
      const y0 = k > 0 ? lv[k - 1].top : lv[k].bot - (lv[k].us[0].b.u.bedT ?? MM(20)), yTop = lv[top].top;
      // the top: a lintel / U-blocks / the next course spanning it, or a ring beam / a slab on the walls
      const mid = (a0 + a1) / 2, x = L.ux * mid - L.uz * L.d, z = L.uz * mid + L.ux * L.d;
      let y1 = null, why = null;
      const over = L.units.filter((u) => u.bot > yTop - MM(5) && u.bot < yTop + MM(80) && u.a0 < a1 && u.a1 > a0);
      if (over.length) {
        const iv = over.map((u) => [u.a0, u.a1]).sort((p, q) => p[0] - q[0]); let reach = a0 + MM(5), ok = true;
        for (const v of iv) { if (v[0] > reach + MM(30)) { ok = false; break; } reach = Math.max(reach, v[1]); }   // (the joints between them bridged)
        y1 = Math.min(...over.map((u) => u.bot)) - (over[0].b.u.bedT ?? 0);
        if (!ok || reach < a1 - MM(5)) why = 'Над проёмом кладка не сплошная — положите перемычку или U-блоки';
      } else {
        const bl = app.objects.all('belt').find((b) => b.fill > 0.3 && beltContains(b, x, z) && Math.abs(b.top - yTop) < MM(60));
        if (bl) y1 = bl.top;
        else { y1 = yTop; why = 'Над проёмом нет перемычки — сначала перемычка, U-блоки или перекрытие'; }
      }
      const w = (a1 - a0) / S, h = (y1 - y0) / S;
      if (h < MIN_H) return;
      // the outside: away from the middle of the masonry
      const nx = -L.uz, nz = L.ux, outSign = (x - cx) * nx + (z - cz) * nz >= 0 ? 1 : -1;
      const yaw = Math.atan2(-L.uz, L.ux) + (outSign > 0 ? 0 : Math.PI);
      out.push({ x, z, y0, y1, w: Math.round(w), h: Math.round(h), t: Math.round((L.hw * 2) / S), yaw, ok: !why, why, floor: k === 0, line: L });
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
