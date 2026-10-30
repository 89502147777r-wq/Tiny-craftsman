import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { isDoor, DOORS } from './doors.js';
import { WINDOWS } from './windows.js';
import { loadModel } from './machines/models.js';
import { FURN } from './furniture.js';
import { wallpaper, artwork, PAPERS, KID_PAPERS, ARTS, KID_ARTS } from './decor.js';

// «Готово»: the house lived in. Behind each window (the windows of one wall close together: one room)
// a room is found by looking round from it — its floor (the slab under it), its ceiling, how deep it
// goes and how wide (to the walls inside) — and furnished as such a room is, in a style of its own:
// Scandinavian, Japandi, loft, modern classic, minimal, boho; a child's room in its colours. Real
// furniture (furniture.js: Poly Haven CC0, Sketchfab CC BY — CREDITS.md), the walls painted, papered
// (decor.js), panelled in wooden slats, in mouldings; pictures drawn for the room; curtains, blinds;
// the floor's own wood. No two rooms alike: the dice of the house and of each room (its floor
// counted) choose the kind, the style, the layout, its side, the pieces, the colours. At dusk the
// lamps go on — in most rooms, not all — and the light spills out onto the ground.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _rc = new THREE.Raycaster();
const TEX = {};
function tex(folder, file, srgb, rep = 1) {
  const key = folder + '/' + file + rep;
  if (TEX[key]) return TEX[key];
  const t = new THREE.TextureLoader().load(`assets/textures/${folder}/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(rep, rep);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[key] = t);
}

// ---- the rooms ------------------------------------------------------------------------------------------
// what the house is made of, to look round in (not the garden, not the glass)
function solids(app) {
  const out = [];
  app.wallView.group.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !o.userData.glow && !o.userData.noPick && o.material && !(o.material.transparent && o.material.opacity < 0.6) && !o.userData.room) out.push(o); });
  return out;
}
function cast(objs, from, dir, far) {
  _rc.set(from, dir); _rc.far = far;
  const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  return _rc.intersectObjects(objs, false).find((h) => shown(h.object)) || null;
}
// The floor plan behind the windows: for each floor, the masonry at the height of a hand (the
// blocks and bricks laid, the windows and doors in their openings) drawn into a grid in the house's
// axes; what the outside can't reach from the grid's edge is inside — its rooms the masonry's own
// (inner walls) or, a hall with no walls in it, rooms of our own: cut by plasterboard partitions,
// each with its doorway, never across a window or a door, until each is a room's size and has a
// blank wall to stand the furniture on. The height to the top of the walls (not to the roof: a
// ceiling under the attic). Each room: its front the wall with the most glass, its openings on all
// four walls (the furniture keeps clear of them).
// → [{ wins, yaw, floor, ceil, o, u, n, a0, a1, D, walls: { F, B, L, R: { ext, open: [[s0, s1, y0, y1, door]] } }, kind, seed }]
export function roomsOf(app) {
  const all = app.objects.all('window').filter((w) => !w.corner), wins = all.filter((w) => !isDoor(w.key));
  if (!wins.length) return [];
  const objs = solids(app), t = app.terrain, rooms = [];
  // (each opening's floor: the slab under a point inside, else the ground; a door: its threshold)
  const floorOf = (w) => {
    if (isDoor(w.key)) return w.y;
    const out = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw)), K = WINDOWS[w.key] || {}, sill = K.sill ? MM(900) : 0;
    const probe = new THREE.Vector3(w.x, 0, w.z).addScaledVector(out, -MM((w.t || 300) / 2 + 600)); probe.y = w.y + MM(300);
    const down = cast(objs, probe, new THREE.Vector3(0, -1, 0), MM(1500));
    let f = down ? down.point.y : (t.inside(probe.x, probe.z) ? t.heightAt(probe.x, probe.z) : w.y - sill);
    if (f > w.y + MM(50) || f < w.y - MM(1300)) f = w.y - sill;
    return f;
  };
  const fl = new Map(all.map((w) => [w, floorOf(w)]));
  const levels = [];
  for (const w of wins) { const f = fl.get(w); if (!levels.some((q) => Math.abs(q - f) < MM(400))) levels.push(f); }
  levels.sort((p, q) => p - q);
  // the house's axes: along the walls of the first window
  const th = wins[0].yaw, ex = new THREE.Vector3(Math.cos(th), 0, -Math.sin(th)), ez = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
  const X = (x, z) => x * ex.x + z * ex.z, Z = (x, z) => x * ez.x + z * ez.z, W = (a, b) => new THREE.Vector3(a * ex.x + b * ez.x, 0, a * ex.z + b * ez.z);
  const units = app.objects.all('unit');
  for (const floor of levels) {
    const ops = all.filter((w) => Math.abs(fl.get(w) - floor) < MM(400) || (isDoor(w.key) && Math.abs(w.y - floor) < MM(400)));
    const ys = floor + MM(1200);
    // (the masonry round: the courses through the height of a hand; the top of the walls)
    const near = (x, z) => ops.some((w) => Math.hypot(w.x - x, w.z - z) < MM(16000));
    const us = units.filter((u) => u.p && u.s && Math.abs(u.p[1] - ys) < u.s[1] / 2 + MM(5) && near(u.p[0], u.p[2]));
    if (!us.length) continue;
    let top = floor + MM(2700);
    { const tops = units.filter((u) => u.p && u.s && near(u.p[0], u.p[2]) && u.p[1] > floor && u.p[1] < floor + MM(4500)).map((u) => u.p[1] + u.s[1] / 2); if (tops.length) top = Math.max(...tops); }
    // the grid (50 mm), its bounds round the masonry
    const c = MM(50), pts = [...us.map((u) => [X(u.p[0], u.p[2]), Z(u.p[0], u.p[2])]), ...ops.map((w) => [X(w.x, w.z), Z(w.x, w.z)])];
    const gx0 = Math.min(...pts.map((q) => q[0])) - MM(800), gz0 = Math.min(...pts.map((q) => q[1])) - MM(800);
    const nx = Math.ceil((Math.max(...pts.map((q) => q[0])) + MM(800) - gx0) / c), nz = Math.ceil((Math.max(...pts.map((q) => q[1])) + MM(800) - gz0) / c);
    if (nx * nz > 600 * 600) continue;
    // (the masonry at a hand's height and over the doors: a doorway in an inner wall, under its lintel,
    // parts two rooms; g12 — at a hand's height only: the doorways open in it)
    const g = new Uint8Array(nx * nz), g12 = new Uint8Array(nx * nz);   // g: 1 masonry, 2 outside, 3+ rooms
    // a rectangle (its middle, its yaw, its size) filled — a little bigger: the joints closed
    const fill = (cx, cz, yaw, sw, sd, both = true) => {
      const ca = Math.cos(yaw - th), sa = Math.sin(yaw - th), hx = sw / 2 + MM(30), hz = sd / 2 + MM(30);
      const R = Math.abs(ca) * hx + Math.abs(sa) * hz, Rz = Math.abs(sa) * hx + Math.abs(ca) * hz, X0 = X(cx, cz), Z0 = Z(cx, cz);
      for (let i = Math.max(0, Math.floor((X0 - R - gx0) / c)); i <= Math.min(nx - 1, Math.ceil((X0 + R - gx0) / c)); i++) for (let k = Math.max(0, Math.floor((Z0 - Rz - gz0) / c)); k <= Math.min(nz - 1, Math.ceil((Z0 + Rz - gz0) / c)); k++) {
        const px = gx0 + (i + 0.5) * c - X0, pz = gz0 + (k + 0.5) * c - Z0, lx = px * ca - pz * sa, lz = px * sa + pz * ca;
        if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) { g[i + k * nx] = 1; if (both) g12[i + k * nx] = 1; }
      }
    };
    for (const u of us) { const q = u.q || [0, 0, 0, 1], yaw = 2 * Math.atan2(q[1], q[3]); fill(u.p[0], u.p[2], yaw, u.s[0], u.s[2]); }
    const y2 = floor + MM(2350);
    if (y2 < top - MM(60)) for (const u of units) if (u.p && u.s && Math.abs(u.p[1] - y2) < u.s[1] / 2 + MM(5) && !(Math.abs(u.p[1] - ys) < u.s[1] / 2 + MM(5)) && near(u.p[0], u.p[2])) { const q = u.q || [0, 0, 0, 1]; fill(u.p[0], u.p[2], 2 * Math.atan2(q[1], q[3]), u.s[0], u.s[2], false); }
    for (const w of ops) fill(w.x, w.z, w.yaw, MM(w.w), MM(w.t || 300));
    const cellAt = (G2, xx, zz) => { const i = Math.floor((xx - gx0) / c), k = Math.floor((zz - gz0) / c); return i >= 0 && k >= 0 && i < nx && k < nz ? G2[i + k * nx] : 0; };
    // the outside: from the edge
    const st = [];
    for (let i = 0; i < nx; i++) for (const k of [0, nz - 1]) st.push(i + k * nx);
    for (let k = 0; k < nz; k++) for (const i of [0, nx - 1]) st.push(i + k * nx);
    const flood = (seed, v) => { const q = Array.isArray(seed) ? seed : [seed]; let n = 0, i0 = 1e9, i1 = -1, k0 = 1e9, k1 = -1; while (q.length) { const id = q.pop(); if (g[id] !== 0) continue; g[id] = v; n++; const i = id % nx, k = (id - i) / nx; i0 = Math.min(i0, i); i1 = Math.max(i1, i); k0 = Math.min(k0, k); k1 = Math.max(k1, k); if (i > 0) q.push(id - 1); if (i < nx - 1) q.push(id + 1); if (k > 0) q.push(id - nx); if (k < nz - 1) q.push(id + nx); } return { n, i0, i1, k0, k1 }; };
    flood(st, 2);
    // the rooms the masonry closes (a hall, or rooms with walls of their own)
    const halls = [];
    for (let id = 0, v = 3; id < g.length; id++) if (g[id] === 0) { const r = flood(id, v++); if (r.n * c * c > MM(1000) * MM(1000) * 3) halls.push(r); }
    for (const h of halls) {
      // its faces: the edges of its cells (the masonry drawn a little fat: they stand a hair in front of it)
      const x0 = gx0 + h.i0 * c, x1 = gx0 + (h.i1 + 1) * c, z0 = gz0 + h.k0 * c, z1 = gz0 + (h.k1 + 1) * c;
      // the openings on its walls: [side, from, to (along the wall, house axes), y0, y1, door, w]
      const on = [];
      for (const w of ops) {
        const px = X(w.x, w.z), pz = Z(w.x, w.z), hw = MM(w.w) / 2, y0 = w.y - floor, y1 = y0 + MM(w.h), door = isDoor(w.key), tol = MM((w.t || 300) / 2 + 250);
        if (Math.abs(pz - z1) < tol && px > x0 && px < x1) on.push(['+z', px - hw, px + hw, y0, y1, door, w]);
        else if (Math.abs(pz - z0) < tol && px > x0 && px < x1) on.push(['-z', px - hw, px + hw, y0, y1, door, w]);
        else if (Math.abs(px - x1) < tol && pz > z0 && pz < z1) on.push(['+x', pz - hw, pz + hw, y0, y1, door, w]);
        else if (Math.abs(px - x0) < tol && pz > z0 && pz < z1) on.push(['-x', pz - hw, pz + hw, y0, y1, door, w]);
      }
      // cut into rooms: [x0, x1, z0, z1, parts: { side: 'ext' | partition }]
      const leaves = [], parts = [];
      const split = (R, depth = 0) => {
        const [a0, a1, b0, b1] = R, wX = a1 - a0, wZ = b1 - b0, area = wX * wZ / MM(1000) / MM(1000);
        const touch = { '+z': Math.abs(b1 - z1) < 1e-6, '-z': Math.abs(b0 - z0) < 1e-6, '+x': Math.abs(a1 - x1) < 1e-6, '-x': Math.abs(a0 - x0) < 1e-6 };
        const opsIn = (side, lo, hi) => (touch[side] ? on.filter((o) => o[0] === side && o[2] > lo && o[1] < hi) : []);
        const sides = { '+z': opsIn('+z', a0, a1), '-z': opsIn('-z', a0, a1), '+x': opsIn('+x', b0, b1), '-x': opsIn('-x', b0, b1) };
        // (the partitions already cut, as blank walls: a room needs one without windows)
        const blank = Object.values(sides).some((v) => !v.length);
        if ((area <= 26 && blank) || area < 9 || depth > 4) { leaves.push(R); return; }
        let best = null;
        for (const ax of ['x', 'z']) {
          const L = ax === 'x' ? wX : wZ, lo = ax === 'x' ? a0 : b0;
          if (L < MM(5400)) continue;
          for (let tt = lo + MM(2600); tt <= lo + L - MM(2600); tt += MM(100)) {
            // (not across an opening: the partition meets the outer wall clear of it)
            const meets = (sd) => (sd === '+z' ? Math.abs(b1 - z1) < 1e-6 : sd === '-z' ? Math.abs(b0 - z0) < 1e-6 : sd === '+x' ? Math.abs(a1 - x1) < 1e-6 : Math.abs(a0 - x0) < 1e-6);
            const hitsOp = on.some((o) => (ax === 'x' ? o[0][1] === 'z' : o[0][1] === 'x') && meets(o[0]) && tt > o[1] - MM(150) && tt < o[2] + MM(150));
            if (hitsOp) continue;
            const A = ax === 'x' ? [a0, tt, b0, b1] : [a0, a1, b0, tt], B = ax === 'x' ? [tt, a1, b0, b1] : [a0, a1, tt, b1];
            const glass = (Rr) => on.filter((o) => !o[5] && ((o[0][1] === 'z' && o[1] < Rr[1] && o[2] > Rr[0] && (o[0] === '+z' ? Math.abs(Rr[3] - z1) < 1e-6 : Math.abs(Rr[2] - z0) < 1e-6)) || (o[0][1] === 'x' && o[1] < Rr[3] && o[2] > Rr[2] && (o[0] === '+x' ? Math.abs(Rr[1] - x1) < 1e-6 : Math.abs(Rr[0] - x0) < 1e-6)))).length;
            const opp = ax === 'x' ? sides['+x'].length && sides['-x'].length : sides['+z'].length && sides['-z'].length;
            const score = Math.abs((tt - lo) / L - 0.5) + (glass(A) && glass(B) ? 0 : 2) + (L >= Math.max(wX, wZ) ? 0 : 0.3) - (opp ? 0.6 : 0);
            if (!best || score < best.score) best = { score, ax, tt, A, B };
          }
        }
        if (!best) { leaves.push(R); return; }
        // the partition, its doorway near one end (the middle of the wall left for the furniture)
        const len = best.ax === 'x' ? wZ : wX, s0 = best.ax === 'x' ? b0 : a0, dw = MM(900), dp = s0 + Math.min(MM(500), len * 0.15);
        parts.push({ ax: best.ax, at: best.tt, from: s0, to: s0 + len, door: [dp, dp + dw] });
        split(best.A, depth + 1); split(best.B, depth + 1);
      };
      split([x0, x1, z0, z1]);
      for (const [a0, a1, b0, b1] of leaves) {
        // each wall of the room: the house's own (outside) or a partition; its openings (doors of the partitions too)
        const wallOf = (side) => {
          const ax = side[1] === 'z' ? 'z' : 'x', at = side === '+z' ? b1 : side === '-z' ? b0 : side === '+x' ? a1 : a0, lo = ax === 'z' ? a0 : b0, hi = ax === 'z' ? a1 : b1;
          const pt = parts.find((q) => q.ax === (ax === 'z' ? 'z' : 'x') && Math.abs(q.at - at) < MM(5) && q.from < hi - MM(5) && q.to > lo + MM(5));
          const open = pt ? [[pt.door[0], pt.door[1], 0, MM(2100), true]].filter((d) => d[1] > lo && d[0] < hi)
            : on.filter((o) => o[0] === side && o[2] > lo && o[1] < hi).map((o) => [Math.max(lo, o[1]), Math.min(hi, o[2]), o[3], o[4], o[5], o[6]]);
          if (!pt) {
            // (a doorway in the masonry: open at a hand's height, closed over the doors — the lintel)
            const dir = side[0] === '+' ? 1 : -1;
            let run = null;
            const runs = [];
            for (let v = lo + MM(25); v <= hi; v += MM(50)) {
              const at2 = at + dir * MM(120), xx = ax === 'z' ? v : at2, zz = ax === 'z' ? at2 : v;
              const gap = cellAt(g, xx, zz) === 1 && cellAt(g12, xx, zz) !== 1;
              if (gap && !run) run = [v, v]; else if (gap) run[1] = v; else if (run) { runs.push(run); run = null; }
            }
            if (run) runs.push(run);
            for (const [s0, s1] of runs) if (s1 - s0 > MM(450)) open.push([s0 - MM(25), s1 + MM(25), 0, Math.min(MM(2100), top - floor - MM(300)), true]);
          }
          return { ext: !pt, open, lo, hi };
        };
        const walls = { '+z': wallOf('+z'), '-z': wallOf('-z'), '+x': wallOf('+x'), '-x': wallOf('-x') };
        const glassOn = (k) => walls[k].ext ? walls[k].open.filter((o) => !o[4]).reduce((sum, o) => sum + (o[1] - o[0]) * (o[3] - o[2]), 0) : 0;
        // (a room with a garage door in its wall is the garage: its front that wall, the car facing it)
        const gWall = Object.keys(walls).find((k) => walls[k].ext && walls[k].open.some((q) => q[5] && DOORS[q[5].key]?.garage));
        const front = gWall || Object.keys(walls).sort((p, q) => glassOn(q) - glassOn(p))[0];
        if (!gWall && !glassOn(front)) continue;   // (no window: nothing of it is seen)
        // the room's own frame: o on its front wall's inner face, u along it, n out through it
        const nW = W(front === '+x' ? 1 : front === '-x' ? -1 : 0, front === '+z' ? 1 : front === '-z' ? -1 : 0), u = new THREE.Vector3(nW.z, 0, -nW.x);
        const corners = [W(a0, b0), W(a1, b0), W(a0, b1), W(a1, b1)], o = corners.reduce((m, q) => (q.dot(nW) > m.dot(nW) + 1e-9 ? q : m)).clone();
        const A = corners.map((q) => q.clone().sub(o).dot(u)), Dd = corners.map((q) => -q.clone().sub(o).dot(nW));
        const ra0 = Math.min(...A), ra1 = Math.max(...A), D = Math.max(...Dd);
        // (its walls in its own frame: F the front, B the back, L at a0, R at a1; openings along them in a / d)
        const toRoom = (k) => {
          const wl = walls[k], n2 = W(k === '+x' ? 1 : k === '-x' ? -1 : 0, k === '+z' ? 1 : k === '-z' ? -1 : 0);
          const role = n2.dot(nW) > 0.5 ? 'F' : n2.dot(nW) < -0.5 ? 'B' : n2.dot(u) > 0 ? 'R' : 'L';
          const along = (v) => { const P = k[1] === 'z' ? W(v, k === '+z' ? b1 : b0) : W(k === '+x' ? a1 : a0, v), q = P.sub(o); return role === 'F' || role === 'B' ? q.dot(u) : -q.dot(nW); };
          return [role, { ext: wl.ext, open: wl.open.map((q) => { const s0 = along(q[0]), s1 = along(q[1]); return [Math.min(s0, s1) / S, Math.max(s0, s1) / S, q[2] / S, q[3] / S, q[4]]; }) }];
        };
        const rw = Object.fromEntries(Object.keys(walls).map(toRoom));
        const fw = walls[front].open.filter((q) => !q[4] && q[5]).map((q) => q[5]);
        const rwins = Object.values(walls).flatMap((wl) => (wl.ext ? wl.open.filter((q) => !q[4] && q[5]).map((q) => q[5]) : []));
        let ceil = top; const upHit = cast(objs, W((a0 + a1) / 2, (b0 + b1) / 2).setY(floor + MM(1200)), new THREE.Vector3(0, 1, 0), MM(4000)); if (upHit && upHit.point.y < ceil) ceil = upHit.point.y;
        ceil = Math.min(floor + MM(3300), Math.max(floor + MM(2400), ceil));
        rooms.push({ garage: !!gWall, wins: rwins, fwins: fw, yaw: Math.atan2(nW.x, nW.z), floor, ceil, D, o, u, n: nW, a0: ra0, a1: ra1, walls: rw, big: fw.some((w) => !(WINDOWS[w.key] || {}).sill), glass: glassOn(front), door: Object.values(walls).some((wl) => wl.ext && wl.open.some((q) => q[4])) });
      }
    }
  }
  // (a window with no masonry round it — a wall not laid of blocks: the room behind it a box of our own)
  for (const w of wins) {
    if (rooms.some((r) => r.wins.includes(w))) continue;
    const floor = fl.get(w), nW = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw)), u = new THREE.Vector3(nW.z, 0, -nW.x);
    const o = new THREE.Vector3(w.x, 0, w.z).addScaledVector(nW, -MM((w.t || 300) / 2)), hw = w.w / 2, y0 = (w.y - floor) / S;
    const a0 = MM(-hw - 1500), a1 = MM(hw + 1500), D = MM(4200), part = (L) => ({ ext: false, open: [], len: L });
    rooms.push({ wins: [w], fwins: [w], yaw: w.yaw, floor, ceil: floor + MM(2800), D, o, u, n: nW, a0, a1, walls: { F: { ext: true, open: [[-hw, hw, y0, y0 + w.h, false]] }, B: part(), L: part(), R: part() }, big: !(WINDOWS[w.key] || {}).sill, glass: w.w * w.h, door: false });
  }
  // (each room its kind: on the ground floor the living room behind the most glass, the kitchen by
  // the entrance or next to it; upstairs the largest a bedroom, then by the dice — a child's room, a
  // bedroom, a study)
  const lvls = [...new Set(rooms.map((r) => Math.round(r.floor / MM(1500))))].sort((p, q) => p - q);
  const hs = houseSeed(rooms);
  for (const lv of lvls) {
    const on = rooms.filter((r) => Math.round(r.floor / MM(1500)) === lv).sort((p, q) => !!p.garage - !!q.garage || 0).sort((p, q) => q.glass * (q.a1 - q.a0) * q.D - p.glass * (p.a1 - p.a0) * p.D);
    let kitchen = false, k = 0;
    const cycle = ['kids', 'bed', 'study', 'kids', 'bed'];
    on.forEach((r, i) => {
      r.lv = lvls.indexOf(lv); r.seed = mix(hs, Math.round(r.o.x * 1e4), Math.round(r.o.z * 1e4), r.lv * 7919);
      if (r.garage) { r.kind = 'garage'; return; }
      if (r.lv === 0 && !on.slice(0, i).some((q) => !q.garage)) { r.kind = 'living'; return; }
      if (r.lv === 0 && !kitchen && (r.door || i === on.length - 1 || i === 1)) { r.kind = 'kitchen'; kitchen = true; return; }
      if (r.lv > 0 && i === 0) { r.kind = r.big && rnd1(r.seed) < 0.3 ? 'living' : 'bed'; return; }
      r.kind = cycle[(k++ + (hs % 5)) % cycle.length];
    });
  }
  return rooms;
}
function mix(...v) { let h = 2166136261; for (const x of v) { h ^= x & 0xffffffff; h = Math.imul(h, 16777619); h ^= h >>> 13; } return (h >>> 0) % 2147483646 + 1; }
function rnd1(s) { return ((s * 16807) % 2147483647) / 2147483647; }
function houseSeed(rooms) { return mix(rooms.length, ...rooms.flatMap((r) => r.wins.map((w) => Math.round(w.x * 1e3) + Math.round(w.z * 1e3) * 31))); }

// ---- the styles -------------------------------------------------------------------------------------------
// walls (paints), the accent walls it likes, its floors (deck textures and their tint), fabrics, the
// kitchen's fronts, curtains, rugs, the pictures' colours, its papers, its lamps
export const STYLES = {
  scandi: { walls: [0xf3f0ea, 0xeeeae3, 0xf6f4ef], accent: ['slats', 'paint', 'paper', 'paint'], paint: [0xb9c4b1, 0xd8cdbd, 0xa9b8c2, 0xe3d3c3], floor: [['oakporc', 0xf0e6da], ['oakporc', 0xe6d8c6]], slat: ['oakporc', 0xe8dccb], fab: [0xc9c4bb, 0x9ea4a8, 0xdcd4c7], kit: [0xf2f1ec, 0xdad6cf, 0xb9c4b1], top: 0xe0d2bc, curtain: [0xf3efe7, 0xe6e0d4], rug: [0xd8d1c4, 0xa6adb0, 0xcbbfae], art: [[0x8fa3ad, 0xd6b48c, 0x2f3b45], [0xc9a27e, 0x6d7f6a, 0xe6d5c3]], paper: ['stripes', 'linen', 'dots', 'herring'], pend: ['pend_dome', 'pend_globo', 'pend_linear'] },
  japandi: { walls: [0xebe4d8, 0xe6ddcf], accent: ['slats', 'slats', 'paint'], paint: [0xcdbba2, 0xb8a58c, 0x9a9183], floor: [['teak', 0xd9c4ab], ['oakporc', 0xd8c3a8]], slat: ['walnut', 0xb89b80], fab: [0xd6cbb8, 0xb3a690, 0x8c8172], kit: [0xd8cdbb, 0x6f6458, 0xe9e2d6], top: 0x7a6552, curtain: [0xe6dccb, 0xd2c4ad], rug: [0xcbbfa9, 0xa79a84], art: [[0x3b3631, 0xa88b6a, 0xe2d6c4], [0x6d6a55, 0xc2a37f, 0x2d2a26]], paper: ['linen', 'arches', 'herring'], pend: ['pend_dome', 'pend_linear', 'pend_bar'] },
  loft: { walls: [0xb9b6b0, 0xa9a6a0, 0xcbc7c0], accent: ['brick', 'concrete', 'slats', 'paint'], paint: [0x3d4246, 0x5a4a3e, 0x2f3a36], floor: [['walnut', 0xc9b29a], ['wenge', 0xd6c3ad]], slat: ['wenge', 0x9b8a7a], fab: [0x5a5652, 0x7a5b45, 0x3d4044], kit: [0x2f3133, 0x3e4a43, 0x5c5f61], top: 0x8a7a6a, curtain: [0x55585b, 0x8a857c], rug: [0x6f6a64, 0x8f7a63, 0x4a4d50], art: [[0xd9502b, 0x1f2328, 0xe6e2da], [0xe4b33b, 0x2a3640, 0xb7b0a4]], paper: ['geo', 'herring'], pend: ['pend_industrial', 'pend_loft', 'pend_bar'] },
  classic: { walls: [0xece5d9, 0xe6ddd0, 0xf1ebe1], accent: ['mould', 'paper', 'mould', 'paint'], paint: [0x6d7f8c, 0x8a9a85, 0xc4a99a, 0x2f4a5c], floor: [['oakporc', 0xd8c2a3], ['teak', 0xc8ae8f]], slat: ['walnut', 0xb59c84], fab: [0x2f4a5c, 0x40594a, 0xcdbfa8, 0x8a5c55], kit: [0xe9e4da, 0x8a9a85, 0x2f4a5c], top: 0xe8e4de, curtain: [0xd9ccb6, 0xbfa98c, 0x8a9a85], rug: [0xc9b79b, 0x8b6f5a, 0x6d7f8c], art: [[0x5c6e5a, 0xc7a46b, 0x2e2a25], [0x8a5c55, 0xd8c3a0, 0x33465a]], paper: ['stripes', 'leaves', 'arches'], pend: ['pend_globo', 'pend_dome'] },
  minimal: { walls: [0xf7f7f5, 0xf1f1ef], accent: ['paint', 'slats', 'concrete'], paint: [0x2b2d2f, 0xd9d9d6, 0x8c9094], floor: [['grey', 0xe0dedb], ['oakporc', 0xf2ebe3]], slat: ['wenge', 0x50504e], fab: [0xdedcd8, 0x2e3032, 0xb8b6b2], kit: [0xf4f4f2, 0x2b2d2f, 0xc9c7c3], top: 0x2b2d2f, curtain: [0xf5f5f2, 0xd8d6d2], rug: [0xd6d4d0, 0x8e8c88], art: [[0x111111, 0xd9d9d6, 0xb0aea9], [0x2b2d2f, 0xc79f74, 0xf0eee9]], paper: ['linen', 'stripes'], pend: ['pend_linear', 'pend_dome', 'pend_bar'] },
  boho: { walls: [0xf0e6d8, 0xead9c4], accent: ['paper', 'paint', 'paper'], paint: [0xc07b5a, 0xd9a47c, 0x8f9a72, 0xcf9f6b], floor: [['teak', 0xdcc2a2], ['oakporc', 0xe2cdb3]], slat: ['oakporc', 0xd5bc9c], fab: [0xd9c4a5, 0xb36f4f, 0x8f9a72], kit: [0xe9dfcf, 0x8f9a72, 0xc07b5a], top: 0xc9b08f, curtain: [0xeadcc5, 0xd9b48f], rug: [0xc98e64, 0xd9c4a5, 0x8f9a72], art: [[0xc07b5a, 0xe6c79c, 0x5b6b4f], [0xd99a6c, 0x8f9a72, 0xf2e3cc]], paper: ['leaves', 'arches', 'dots', 'geo'], pend: ['pend_globo', 'pend_dome', 'pend_industrial'] },
};
export const STYLE_NAMES = { scandi: 'Скандинавский', japandi: 'Джапанди', loft: 'Лофт', classic: 'Современная классика', minimal: 'Минимализм', boho: 'Бохо' };
const KIDS = { walls: [0xf6f1e8, 0xf2ece4], paint: [0xbfd8e6, 0xf2d0c4, 0xd8e6c4, 0xf3e2a9, 0xd6cbe6], inks: [[0xf2b5a7, 0xa7cbe0, 0xf5d88f], [0x9cc3e4, 0xffffff, 0xf2c48d], [0xa8d5ba, 0xf2b5a7, 0xd6cbe6]], fab: [0xa7cbe0, 0xf2b5a7, 0xa8d5ba, 0xf5d88f], rug: [0xa7cbe0, 0xf2b5a7, 0xa8d5ba, 0xf5d88f, 0xd6cbe6] };

// ---- the room built ---------------------------------------------------------------------------------------
const WARM = new THREE.Color(0xffd9ae);
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const hex = (c) => '#' + new THREE.Color(c).getHexString();

export function buildRoom(r) {
  let sd = r.seed || 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }, pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  const G = new THREE.Group(), A0 = r.a0 / S, A1 = r.a1 / S, D = r.D / S, H = (r.ceil - r.floor) / S, W = A1 - A0, cA = (A0 + A1) / 2;
  G.position.set(r.o.x, r.floor, r.o.z); G.rotation.y = r.yaw;
  const kids = r.kind === 'kids', st = r.style = r.style || pick(Object.keys(STYLES)), Y = STYLES[st];
  const mats = [], lamps = [];
  // (each material of the room glows a little of its own colour at night when its lamps are on)
  // (the glow a colour, not the material's texture again: an emissive map would make each of them a
  // shader of its own to build — a stall on a phone for each)
  const glow = (m, g) => { m.emissive = m.emissive || new THREE.Color(); m.emissive.copy(WARM); m.emissiveMap = null; m.userData.glow = g; mats.push(m); return m; };
  const M = (o, g = 0.55) => glow(std(o), g);
  const box = (m, a0, a1, d0, d1, y0, y1, par = G) => { const o = new THREE.Mesh(new THREE.BoxGeometry(MM(Math.max(1, a1 - a0)), MM(Math.max(1, y1 - y0)), MM(Math.max(1, d1 - d0))), m); o.position.set(MM((a0 + a1) / 2), MM((y0 + y1) / 2), -MM((d0 + d1) / 2)); o.receiveShadow = true; o.userData.merge = 1; par.add(o); return o; };
  const wood = (name, tint, rep = 1) => { const t = tex('deck/' + name, 'col.jpg', true).clone(); t.needsUpdate = true; t.userData.own = 1; t.repeat.set(rep, rep); return M({ map: t, color: tint, roughness: 0.6 }, 0.5); };
  // the openings on each wall of the room (F the front, B the back, L at A0, R at A1): [s0, s1, y0, y1, door] mm
  const OW = { F: [], B: [], L: [], R: [], ...Object.fromEntries(Object.entries(r.walls || {}).map(([k, v]) => [k, v.open])) };
  const EXT = { F: true, B: !r.walls || r.walls.B?.ext, L: !r.walls || r.walls.L?.ext, R: !r.walls || r.walls.R?.ext };
  const opLen = (k) => OW[k].reduce((m, q) => m + q[1] - q[0], 0);
  // (the furniture on the side walls goes on the left: mirrored so the left is the one with fewer openings)
  const mir = opLen('L') === opLen('R') ? rnd() < 0.5 : opLen('L') > opLen('R'), A = (a) => (mir ? A0 + A1 - a : a), side = (rot) => (mir ? -rot : rot);
  // the shell: the floor in the style's wood, the walls painted, the ceiling white
  const wallCol = kids ? pick(KIDS.walls) : pick(Y.walls), [fl, ft] = pick(Y.floor);
  const gar = r.kind === 'garage';
  const mWall = M({ color: gar ? pick([0xdcdcd8, 0xe6e4df, 0xcfd2d4]) : wallCol }, 1.0), mCeil = M({ color: 0xf6f4f0 }, 1.25);
  const ftx = tex('deck/' + fl, 'col.jpg', true).clone(); ftx.needsUpdate = true; ftx.userData.own = 1; ftx.repeat.set(Math.max(1, W / 1500), Math.max(1, D / 1500));
  // (the garage's floor: a grey epoxy over the screed, a little shine, the dust of tyres)
  const mFloor = gar ? M({ map: canvasTex(256, 256, (g) => { g.fillStyle = '#9a9c9e'; g.fillRect(0, 0, 256, 256); for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '30,30,30'},${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 4, 1 + Math.random() * 4); } }, true), color: 0xc8cacc, roughness: 0.35 }, 0.6) : M({ map: ftx, color: ft, roughness: 0.55 }, 0.75);
  if (gar) mFloor.map.repeat.set(Math.max(1, W / 2000), Math.max(1, D / 2000));
  box(mFloor, A0, A1, 0, D, 0, 12); box(mCeil, A0, A1, 0, D, H, H + 20);
  // a panel on a wall over [s0, s1] × [y0, y1] (along it; up), at `off` in from its face, `th` thick —
  // in pieces round the wall's openings (a window, a door, a partition's doorway stay open)
  const panel = (wall, m, s0, s1, y0, y1, off = 2, th = 6) => {
    const holes = OW[wall].filter((q) => q[1] > s0 && q[0] < s1 && q[3] > y0 && q[2] < y1).sort((p, q) => p[0] - q[0]);
    const rect = (a, b, c, d) => {
      if (b - a < 2 || d - c < 2) return;
      if (wall === 'B') box(m, a, b, D - off - th, D - off, c, d); else if (wall === 'F') box(m, a, b, off, off + th, c, d);
      else if (wall === 'L') box(m, A0 + off, A0 + off + th, a, b, c, d); else box(m, A1 - off - th, A1 - off, a, b, c, d);
    };
    let x = s0;
    for (const q of holes) { rect(x, Math.max(x, q[0]), y0, y1); rect(Math.max(s0, q[0]), Math.min(s1, q[1]), y0, Math.max(y0, q[2])); rect(Math.max(s0, q[0]), Math.min(s1, q[1]), Math.min(y1, q[3]), y1); x = Math.max(x, q[1]); }
    rect(x, s1, y0, y1);
  };
  const span = (wall) => (wall === 'F' || wall === 'B' ? [A0, A1] : [0, D]);
  // the walls: the house's own painted (a hair in front of its face, whichever finish is on it), the
  // partitions of plasterboard (half of each here, the other half the next room's)
  for (const k of ['F', 'B', 'L', 'R']) { const [s0, s1] = span(k); if (EXT[k]) panel(k, mWall, s0, s1, 0, H); else panel(k, mWall, s0, s1, 0, H, 0, 50); }
  const mSkirt = M({ color: 0xf4f2ee }, 0.6);
  for (const k of ['F', 'B', 'L', 'R']) { const [s0, s1] = span(k); panel(k, mSkirt, s0, s1, 0, 70, EXT[k] ? 8 : 50, 12); }   // (the skirting)
  // (an accent over the back wall, the left one: in pieces round their openings)
  const backFace = (m, a0, a1, y0 = 0, y1 = H) => panel('B', m, a0, a1, y0, y1, 8, 6);

  // an accent wall: slats, a paper, a paint, mouldings, brick or concrete — on the back wall over a0..a1
  const accent = (a0, a1, kind = kids ? pick(['paper', 'paper', 'paint']) : pick(Y.accent)) => {
    if (kind === 'slats') {
      const [wn, wt] = Y.slat, m = wood(wn, wt, 0.3), n = Math.floor((a1 - a0) / 60), g = new THREE.BoxGeometry(MM(40), MM(H - 90), MM(20));
      const im = new THREE.InstancedMesh(g, m, n), o = new THREE.Object3D();
      panel('B', M({ color: 0x1d1d1d }, 0.2), a0, a1, 0, H, 7, 3);
      for (let i = 0; i < n; i++) { const x = a0 + 30 + i * 60; if (OW.B.some((q) => x > q[0] - 30 && x < q[1] + 30)) { o.position.set(0, -1, 0); o.scale.setScalar(1e-4); o.updateMatrix(); im.setMatrixAt(i, o.matrix); o.scale.setScalar(1); continue; } o.position.set(MM(a0 + 30 + i * 60), MM((H - 90) / 2 + 80), -MM(D - 19)); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
      im.castShadow = im.receiveShadow = true; G.add(im);
    } else if (kind === 'paper') {
      const t = kids ? wallpaper(pick(KID_PAPERS), pick(KIDS.walls), pick(KIDS.inks), sd) : wallpaper(pick(Y.paper), pick(Y.walls), pick(Y.art), sd);
      t.repeat.set((a1 - a0) / 600, H / 600); backFace(M({ map: t }, 0.9), a0, a1);
    } else if (kind === 'mould') {
      backFace(M({ color: pick(Y.paint) }, 0.9), a0, a1);
      const mm = M({ color: 0xf4f1ea }, 0.8), n = Math.max(1, Math.round((a1 - a0) / 1100)), w = (a1 - a0) / n;
      for (let i = 0; i < n; i++) for (const [y0, y1] of [[300, 1000], [1250, H - 350]]) {
        const x0 = a0 + i * w + 150, x1 = a0 + (i + 1) * w - 150; if (y1 - y0 < 300 || OW.B.some((q) => q[1] > x0 && q[0] < x1 && q[3] > y0 && q[2] < y1)) continue;
        box(mm, x0, x1, D - 30, D - 8, y0, y0 + 30); box(mm, x0, x1, D - 30, D - 8, y1 - 30, y1); box(mm, x0, x0 + 30, D - 30, D - 8, y0, y1); box(mm, x1 - 30, x1, D - 30, D - 8, y0, y1);
      }
      box(mm, a0, a1, D - 40, D - 8, H - 80, H);
    } else if (kind === 'brick') {
      const t = canvasTex(512, 512, (g) => { g.fillStyle = '#d8d2c8'; g.fillRect(0, 0, 512, 512); for (let y = 0; y < 512; y += 32) for (let x = -64; x < 512; x += 128) { const xo = x + ((y / 32) % 2 ? 64 : 0); g.fillStyle = `hsl(${12 + Math.random() * 10},${35 + Math.random() * 20}%,${36 + Math.random() * 14}%)`; g.fillRect(xo + 3, y + 3, 122, 26); } }, true);
      t.repeat.set((a1 - a0) / 1000, H / 1000); backFace(M({ map: t, roughness: 0.95 }, 0.6), a0, a1);
    } else if (kind === 'concrete') {
      const t = canvasTex(256, 256, (g) => { g.fillStyle = '#9d9a95'; g.fillRect(0, 0, 256, 256); for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 2 + Math.random() * 6); } g.strokeStyle = 'rgba(0,0,0,0.12)'; g.strokeRect(0, 0, 256, 128); for (const [x, y] of [[20, 20], [236, 20], [20, 108], [236, 108]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill(); } }, true);
      t.repeat.set((a1 - a0) / 1200, H / 1200); backFace(M({ map: t, roughness: 0.9 }, 0.6), a0, a1);
    } else backFace(M({ color: kids ? pick(KIDS.paint) : pick(Y.paint) }, 0.9), a0, a1);
  };
  // a picture (or two, or three) on the back wall over a, its bottom at y
  const art = (a, y, wide) => {
    const n = wide ? pick([1, 2, 3]) : 1, w = wide && n === 1 ? pick([900, 1200]) : pick([450, 600]), h = n === 1 && wide ? w * 0.7 : w * 1.3, gap = 120;
    const frame = M({ color: pick([0x1d1d1d, 0xf4f2ee, 0xb08a62, 0xc9a86a]), roughness: 0.5 }, 0.4);
    for (let i = 0; i < n; i++) {
      const x = a + (i - (n - 1) / 2) * (w + gap);
      if (OW.B.some((q) => q[1] > x - w / 2 && q[0] < x + w / 2 && q[3] > y && q[2] < y + h) || x - w / 2 < A0 || x + w / 2 > A1) continue;
      const kind = kids ? pick(KID_ARTS) : pick(ARTS), t = artwork(kind, kids ? pick(KIDS.inks) : pick(Y.art), sd + i * 101, 256, Math.round(256 * h / w));
      box(frame, x - w / 2, x + w / 2, D - 34, D - 8, y, y + h);
      box(M({ map: t, roughness: 0.8 }, 0.5), x - w / 2 + 25, x + w / 2 - 25, D - 36, D - 34, y + 25, y + h - 25);
    }
  };
  // a rug: a flat in its colours — plain with a border, striped, a diamond, round
  const rug = (a, d, w, dep, round = kids && rnd() < 0.6) => {
    const cols = kids ? [pick(KIDS.rug), pick(KIDS.rug)] : [pick(Y.rug), pick(Y.rug)], kind = pick(['border', 'stripes', 'diamond', 'plain']);
    const t = canvasTex(256, 256, (g) => {
      g.fillStyle = hex(cols[0]); g.fillRect(0, 0, 256, 256); g.fillStyle = hex(cols[1]);
      if (round) { for (let k = 0; k < 5; k++) { g.globalAlpha = 0.35; g.beginPath(); g.arc(128, 128, 120 - k * 24, 0, 7); g.lineWidth = 6; g.strokeStyle = hex(cols[k % 2]); g.stroke(); } }
      else if (kind === 'border') { g.fillRect(0, 0, 256, 18); g.fillRect(0, 238, 256, 18); g.fillRect(0, 0, 18, 256); g.fillRect(238, 0, 18, 256); }
      else if (kind === 'stripes') for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 12, 256);
      else if (kind === 'diamond') { g.globalAlpha = 0.6; for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) { g.beginPath(); g.moveTo(x + 32, y + 4); g.lineTo(x + 60, y + 32); g.lineTo(x + 32, y + 60); g.lineTo(x + 4, y + 32); g.fill(); } }
      for (let k = 0; k < 4000; k++) { g.globalAlpha = 0.05; g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    });
    const m = M({ map: t, roughness: 1 }, 0.5);
    if (round) { const o = new THREE.Mesh(new THREE.CylinderGeometry(MM(w / 2), MM(w / 2), MM(10), 40), m); o.position.set(MM(a), MM(17), -MM(d)); o.receiveShadow = true; G.add(o); }
    else box(m, a - w / 2, a + w / 2, d - dep / 2, d + dep / 2, 12, 22);
  };

  // the furniture: a model (furniture.js) in its real size; at (a, d) on the floor (or at y), turned
  // by rot (0: facing the window, π/2: facing along +a); its footprint returned
  const dims = (key, rot = 0) => { const [w, h, d] = FURN[key].s.map((v) => v * 1000), q = Math.abs(Math.sin(rot)) > 0.5; return { w: q ? d : w, dep: q ? w : d, h, W: w, Dp: d }; };
  // (a piece is not stood in front of a window lower than it, nor of a door, nor in the way in from a
  // door; moved along its wall to the nearest free place, else left out)
  const placed = [];   // (the pieces stood so far: [x0, x1, z0, z1, y0, y1])
  const blocked = (a, d, f, y, solid = true) => {
    const x0 = a - f.w / 2, x1 = a + f.w / 2, z0 = d - f.dep / 2, z1 = d + f.dep / 2, h = y + f.h;
    if (x0 < A0 - 5 || x1 > A1 + 5 || z0 < -5 || z1 > D + 5) return true;
    if (solid && placed.some((p) => x1 > p[0] + 20 && x0 < p[1] - 20 && z1 > p[2] + 20 && z0 < p[3] - 20 && h > p[4] && y < p[5])) return true;
    if (y > 1900) return false;
    const hit = (k, s0, s1) => OW[k].some((q) => q[1] > s0 && q[0] < s1 && (q[4] || q[2] < h + 50));
    if ((z1 > D - 300 && hit('B', x0, x1)) || (z0 < 300 && hit('F', x0, x1)) || (x0 < A0 + 300 && hit('L', z0, z1)) || (x1 > A1 - 300 && hit('R', z0, z1))) return true;
    const way = 900, ov = (p0, p1, q0, q1) => p1 > q0 && p0 < q1;
    for (const q of OW.B) if (q[4] && ov(x0, x1, q[0], q[1]) && z1 > D - way) return true;
    for (const q of OW.F) if (q[4] && ov(x0, x1, q[0], q[1]) && z0 < way) return true;
    for (const q of OW.L) if (q[4] && ov(z0, z1, q[0], q[1]) && x0 < A0 + way) return true;
    for (const q of OW.R) if (q[4] && ov(z0, z1, q[0], q[1]) && x1 > A1 - way) return true;
    return false;
  };
  const put = (key, a, d, rot = 0, y = 0) => {
    if (!key || !FURN[key]) return null;
    // (chairs go under their table, the small things on others: not kept apart)
    const solid = ![].concat(FURN[key].c).some((c) => ['dchair', 'barstool', 'ochair', 'kidchair', 'toy', 'vase', 'pend', 'gsmall', 'tube'].includes(c)) && y < 300;
    const drive = [].concat(FURN[key].c).includes('car');   // (the car stands in the way in: the garage door's)
    { const f = dims(key, rot);
      if (!drive && blocked(a, d, f, y, solid)) {
        // (along the wall it stands at: the nearest free place)
        const byAB = Math.min(d, D - d) <= Math.min(a - A0, A1 - a);
        let ok = false;
        for (let k = 1; k <= 30 && !ok; k++) for (const sg of [1, -1]) { const s2 = sg * k * 100; if (byAB ? !blocked(a + s2, d, f, y, solid) : !blocked(a, d + s2, f, y, solid)) { if (byAB) a += s2; else d += s2; ok = true; break; } }
        if (!ok) return null;
      }
      if (solid) placed.push([a - f.w / 2, a + f.w / 2, d - f.dep / 2, d + f.dep / 2, y, y + f.h]); }
    const holder = new THREE.Group(); holder.name = 'F:' + key; holder.position.set(MM(a), MM(y + 12), -MM(d)); holder.rotation.y = rot; G.add(holder);
    loadModel('interior/' + key).then(({ scene }) => {
      scene.scale.setScalar(MM(1000));
      const cache = new Map();
      scene.traverse((o) => {
        if (!o.isMesh) return; o.userData.room = 1; o.userData.shared = 1; o.castShadow = false; o.receiveShadow = true;   // (its geometry the model's own, shared)
        // (a model's material in the few kinds the rooms use: its colour and relief maps kept, the
        // others — roughness, metal, occlusion maps — left out: fewer textures, fewer shaders to build)
        const one = (m) => { if (!cache.has(m)) { const c = m.clone(); c.roughnessMap = null; c.metalnessMap = null; c.aoMap = null; c.lightMap = null; c.emissiveMap = null; glow(c, 0.45); if (c.transparent && c.opacity > 0.9) c.transparent = false; cache.set(m, c); } return cache.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
        if (FURN[key].tint) o.material.color?.multiply(new THREE.Color(FURN[key].tint));
      });
      holder.add(scene);
      if (G.userData.lit != null) G.userData.apply?.();
    }).catch(() => {});
    return { ...dims(key, rot), a, d };
  };
  const cand = (cat) => Object.keys(FURN).filter((k) => [].concat(FURN[k].c).includes(cat) && !(cat === 'floorlamp' && FURN[k].s[0] > 0.8)), choose = (cat, fit) => {
    let L = cand(cat).filter((k) => (FURN[k].st || []).includes(kids ? 'kids' : st)); if (!L.length) L = cand(cat);
    if (fit) { const F = L.filter((k) => fit(dims(k))); if (F.length) L = F; }
    return L.length ? pick(L) : null;
  };
  const back = (cat, a, fit, gap = 30) => { const k = typeof cat === 'string' && FURN[cat] ? cat : choose(cat, fit); if (!k) return null; const f = dims(k); return put(k, A(a), D - f.dep / 2 - gap, 0); };
  // against the left wall (the right one when mirrored), facing across the room
  const onSide = (cat, d, fit, gap = 30, far = false) => { const k = typeof cat === 'string' && FURN[cat] ? cat : choose(cat, fit); if (!k) return null; const f = dims(k, Math.PI / 2), left = far ? A1 : A0, s = far ? -1 : 1; return put(k, A(left + s * (f.w / 2 + gap)), d, side(s * Math.PI / 2)); };
  const lampAt = (a, d, y, size = 90) => { const b = new THREE.Mesh(new THREE.SphereGeometry(MM(size), 12, 8), lampMat); b.position.set(MM(a), MM(y), -MM(d)); G.add(b); lamps.push(b); };
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffc77a, emissiveIntensity: 0, roughness: 0.6 });
  // a pendant over (a, d): the cord and its shade from the ceiling, its bulb that glows
  const pendant = (a, d, key = kids ? pick(['pend_globo', 'pend_dome']) : pick(Y.pend)) => {
    if (!FURN[key]) key = choose('pend'); if (!key) return; const f = dims(key), drop = Math.min(f.h, H - 1950); put(key, a, d, 0, H - drop - 12);
    lampAt(a, d, H - drop + 60, 70);
  };
  const tableLamp = (a, d, y) => { const sh = new THREE.Mesh(new THREE.CylinderGeometry(MM(100), MM(140), MM(200), 16, 1, true), lampMat); sh.position.set(MM(a), MM(y + 330), -MM(d)); G.add(sh); lamps.push(sh); box(M({ color: pick([0xd9d4ca, 0x2b2b2b, 0xb08a62]) }, 0.3), a - 60, a + 60, d - 60, d + 60, y, y + 230); };
  const tv = (a0, a1, d, far) => {
    // a flat TV on the side wall over its unit: 55″
    const x = far ? (mir ? A0 + 30 : A1 - 30) : (mir ? A1 - 30 : A0 + 30), w = 1230, s = mir !== !!far ? -1 : 1;
    if (OW[x < (A0 + A1) / 2 ? 'L' : 'R'].some((q) => q[1] > d - w / 2 && q[0] < d + w / 2 && q[3] > 1050 && q[2] < 1750)) return null;
    const o = box(tvMat, x - 15 * s, x + 15 * s, d - w / 2, d + w / 2, 1050, 1750); void a0; void a1; return o;
  };
  const tvMat = std({ color: 0x0b0c0f, roughness: 0.15, metalness: 0.3, emissive: 0x24344d, emissiveIntensity: 0 }); tvMat.userData.tv = 1;

  // ---- the layouts ----
  const living = (a0, a1) => {
    const c = (a0 + a1) / 2, w = a1 - a0;
    if (rnd() < 0.55 || D < 3600) {
      // the sofa on the back wall facing the light, the accent wall behind it, pictures over it
      accent(Math.max(a0, c - 1700), Math.min(a1, c + 1700));
      const so = back('sofa', c, (f) => f.w < w - 900);
      if (so) {
        art(c, so.h + 350, true);
        const ct = choose('ctable'), cf = ct && dims(ct), dct = D - so.dep - 450 - (cf ? cf.dep / 2 : 300);
        rug(A(c), dct, Math.min(w - 600, so.w + 600), Math.min(2400, so.dep + 1500));
        if (ct && dct > 900) put(ct, A(c), dct, 0);
        if (w > so.w + 2000) { const ac = choose('armchair'); if (ac) put(ac, A(c + so.w / 2 + 700), dct, side(-Math.PI / 2 - 0.4)); }
        const fl = choose('floorlamp'); if (fl && c - so.w / 2 - 350 > a0 + 200) put(fl, A(c - so.w / 2 - 300), D - 350, 0);
        const sd2 = choose('side'); if (sd2 && c + so.w / 2 + 350 < a1 - 100) put(sd2, A(c + so.w / 2 + 320), D - 300, 0);
        pendant(A(c), dct);
      }
      if (D > 3000) { const tu = onSide('tvunit', D * 0.45, (f) => f.w < D * 0.8); if (tu) tv(0, 0, tu.d, false); }
      const pl = choose('plant'); if (pl) put(pl, A(a1 - 400), D - 400);
      const fd = choose('floordecor'); if (fd && D > 3200) put(fd, A(a0 + 500), D * 0.35, side(Math.PI / 4));
    } else {
      // the sofa across the room facing the TV wall: the TV unit, slats or a paper behind it
      const tu = onSide('tvunit', D * 0.55, (f) => f.w < D * 0.8);
      if (tu) tv(0, 0, tu.d, false);
      const so = choose('sofa', (f) => f.w < D - 1200), sf = so && dims(so, Math.PI / 2), ax = a0 + (tu ? tu.dep : 450) + 2700;
      if (so && ax + sf.w / 2 < a1 - 200) {
        put(so, A(ax), D * 0.55, side(-Math.PI / 2));
        const ct = choose('ctable'); if (ct) put(ct, A(ax - sf.w / 2 - 650), D * 0.55, side(Math.PI / 2));
        rug(A(ax - sf.w / 2 - 650), D * 0.55, 2000, Math.min(2800, D * 0.6));
        pendant(A(ax - sf.w / 2 - 650), D * 0.55);
      }
      accent(a0, a1);
      const bk = back(pick(['bookcase', 'shelf', 'sideboard']), Math.min(a1 - 900, ax + 1000)); if (bk && bk.h < 1000) { const bx = Math.min(a1 - 900, ax + 1000), v = choose('vase'); if (v) put(v, A(bx - 250), D - bk.dep / 2 - 30, 0, bk.h); if (rnd() < 0.5) { const mr = choose('mirror'); if (mr) put(mr, A(bx), D - 40, 0, bk.h + 250); } else art(bx, bk.h + 300, false); }
      art(Math.max(a0 + 800, ax - 1200), 1300, false);
      const pl = choose('plant'); if (pl) put(pl, A(a0 + 400), 500);
      const fl = choose('floorlamp'); if (fl) put(fl, A(a1 - 350), 450);
    }
  };
  const kitchen = (a0, a1) => {
    const front = M({ color: pick(Y.kit), roughness: 0.45 }, 0.55), top = M({ color: Y.top, roughness: 0.35 }, 0.5), plinth = M({ color: 0x1c1c1c }, 0.2);
    const handle = M({ color: pick([0x1a1a1a, 0xb8955a, 0xb9bcbf]), metalness: 0.7, roughness: 0.3 }, 0.2);
    // (the run of units on the back wall: in its longest stretch clear of a door and of a low window)
    let k1 = a1 - 200, k0 = Math.max(a0 + 200, k1 - 3800);
    { const um = (x) => (mir ? A0 + A1 - x : x), lo = Math.min(um(a0 + 200), um(a1 - 200)), hi = Math.max(um(a0 + 200), um(a1 - 200));
      const cut = OW.B.filter((q) => q[4] || q[2] < 950).sort((p, q) => p[0] - q[0]); let best = [0, 0], x = lo;
      for (const q of cut) { if (q[0] - x > best[1] - best[0]) best = [x, Math.min(hi, q[0])]; x = Math.max(x, q[1]); }
      if (hi - x > best[1] - best[0]) best = [x, hi];
      const [p0, p1] = [Math.max(lo, best[0]), Math.min(hi, best[1])];
      if (p1 - p0 < 1500) { k0 = k1 = null; } else { const u0 = um(p0), u1 = um(p1); k1 = Math.max(u0, u1); k0 = Math.max(Math.min(u0, u1), k1 - 3800); } }
    const upper = k0 != null && !OW.B.some((q) => { const x0 = Math.min(A(k0), A(k1)), x1 = Math.max(A(k0), A(k1)); return q[1] > x0 && q[0] < x1 && q[3] > 900; });
    const fr = k0 != null ? choose('fridge') : null, ff = fr && dims(fr);
    let x1 = k1; if (fr) { put(fr, A(k1 - ff.w / 2), D - ff.dep / 2 - 20, 0); x1 = k1 - ff.w - 20; }
    if (k0 != null) {
    box(front, A(k0) < A(x1) ? A(k0) : A(x1), A(k0) < A(x1) ? A(x1) : A(k0), D - 600, D, 100, 870); box(top, Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 620, D, 870, 910); box(plinth, Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 580, D, 0, 100);
    placed.push([Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 620, D, 0, 910]);
    for (let x = k0 + 300; x < x1; x += 600) box(handle, A(x) - 120, A(x) + 120, D - 622, D - 602, 780, 800);
    // the splashback, then wall units or open shelves
    if (upper) box(M({ color: pick([0xf2f0eb, 0xdedbd5, 0x9fb3b0, 0x2b2d2f, 0xd9c7b0]), roughness: 0.2 }, 0.6), Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 10, D - 4, 910, 1500);
    if (!upper) { /* (a window over the run: no wall units) */ } else if (rnd() < 0.6) box(front, Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 350, D, 1500, 2200);
    else for (const y of [1600, 1950]) { box(M({ color: 0x8a6d50 }, 0.4), Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 260, D, y, y + 35); const v = choose('vase'); if (v) put(v, A(k0 + 300 + rnd() * 600), D - 130, 0, y + 35); }
    box(M({ color: 0xb9bcbf, metalness: 0.7, roughness: 0.3 }, 0.2), A((k0 + x1) / 2) - 300, A((k0 + x1) / 2) + 300, D - 560, D - 540, 920, 940);
    }
    // the table and its chairs (or a set), lamps over it; or an island with stools in a deep room
    const td = Math.max(1100, Math.min(D - 1900, D * 0.45)), ta = Math.max(a0 + 1000, Math.min(a1 - 1000, (a0 + a1) / 2));
    if (D > 4800 && rnd() < 0.4) {
      placed.push([A(ta) - 1050, A(ta) + 1050, td - 480, td + 480, 0, 920]);
      box(front, A(ta) - 1000, A(ta) + 1000, td - 450, td + 450, 100, 880); box(top, A(ta) - 1050, A(ta) + 1050, td - 480, td + 480, 880, 920);
      const bs = choose('barstool'); if (bs) for (const k of [-1, 0, 1]) put(bs, A(ta + k * 650), td - 700, 0);
      for (const k of [-1, 0, 1]) pendant(A(ta + k * 650), td);
    } else {
      const set = rnd() < 0.25 ? choose('diningset') : null;
      if (set) put(set, A(ta), td, 0);
      else {
        const tb = choose('dtable'), tf = tb && dims(tb);
        if (tb) put(tb, A(ta), td, 0);
        else { const tw = M({ map: tex('deck/' + Y.slat[0], 'col.jpg', true), color: Y.slat[1], roughness: 0.5 }, 0.5), leg = M({ color: 0x1c1c1c, metalness: 0.4 }, 0.2); box(tw, A(ta) - 900, A(ta) + 900, td - 450, td + 450, 720, 750); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(leg, A(ta) + x * 820 - 20, A(ta) + x * 820 + 20, td + z * 380 - 20, td + z * 380 + 20, 0, 720); }
        const ch = choose('dchair'), cw = tf ? tf.w : 1600, cd = tf ? tf.dep : 900;
        if (ch) for (const s of [-1, 1]) for (const k of cw > 1500 ? [-1, 1] : [0]) put(ch, A(ta + k * cw / 4), td + s * (cd / 2 + 200), s > 0 ? 0 : Math.PI);
      }
      rug(A(ta), td, 2400, 1800);
      pendant(A(ta), td);
    }
    const pl = choose('plantS') || choose('plant'); if (pl) put(pl, A(a0 + 350), D - 350);
  };
  const bed = () => {
    const kidsBed = kids, cat = kids ? (rnd() < 0.5 ? 'bunk' : rnd() < 0.3 ? 'crib' : 'kidbed') : 'bed';
    accent(Math.max(A0, cA - 1600), Math.min(A1, cA + 1600));
    const b = back(cat, cA, (f) => f.w < W - 1300) || back('bed', cA);
    if (b) {
      if (b.h < 1400) art(cA, Math.max(b.h, 900) + 250, true);
      rug(A(cA), D - b.dep * 0.6, Math.min(W - 400, b.w + 1000), Math.min(2200, b.dep));
      const ns = !kidsBed || cat === 'kidbed' ? choose('nightstand') : null;
      if (ns) for (const s of [-1, 1]) { const x = cA + s * (b.w / 2 + 320); if (x < A0 + 250 || x > A1 - 250) continue; const n = put(ns, A(x), D - dims(ns).dep / 2 - 30, 0); if (n) tableLamp(n.a, D - 200, n.h); }
    }
    // the wardrobe on a side wall, a dresser or a desk on the other
    if (D > 3200) onSide('wardrobe', Math.min(D - 700, D * 0.55), (f) => f.w < D * 0.6, 30, rnd() < 0.5);
    if (kids) {
      const t = choose('kidtable'); if (t) put(t, A(A0 + 900), Math.min(D * 0.45, 1400), 0);
      for (const c of ['toy', 'toy', 'kidchair']) { const k = choose(c); if (k) put(k, A(A0 + 400 + rnd() * (W - 800)), 500 + rnd() * Math.max(200, D * 0.35), side((rnd() - 0.5) * 1.5)); }
      const sh = back('shelf', A1 - 700, (f) => f.h < 1600 && f.w < 1300); if (sh) { const k = choose('toy'); if (k) put(k, A(A1 - 700), D - 200, 0, Math.min(sh.h, 900)); }
    } else {
      const ds = rnd() < 0.5 ? choose('dresser') : null; if (ds && W > 3600) put(ds, A(A1 - dims(ds).w / 2 - 200), 450, Math.PI);
      const ac = choose('armchair'); if (ac && W > 3800 && D > 3500) put(ac, A(A0 + 600), 700, side(Math.PI * 0.75));
      const pl = choose('plant'); if (pl) put(pl, A(A1 - 350), 400);
    }
    pendant(A(cA), D * 0.45);
  };
  const study = () => {
    accent(A0, A1);
    const dk = choose('desk'), df = dk && dims(dk, Math.PI);
    if (dk) { put(dk, A(cA), df.dep / 2 + 250, Math.PI); const oc = choose('ochair'); if (oc) put(oc, A(cA), df.dep + 650, 0); tableLamp(A(cA + df.w / 2 - 200), 450, df.h); }
    back(pick(['bookcase', 'shelf']), A0 + 900);
    const ac = choose('armchair'); if (ac) put(ac, A(A1 - 900), D - 900, side(-Math.PI * 0.25));
    const fl = choose('floorlamp'); if (fl) put(fl, A(A1 - 350), D - 350);
    if (rnd() < 0.5) { const g = choose('guitar'); if (g) put(g, A(A1 - 350), D * 0.45, side(-Math.PI / 2)); }
    art(cA, 1350, true);
    const pl = choose('plant'); if (pl) put(pl, A(A0 + 350), 400);
    pendant(A(cA), D * 0.5);
  };
  // the garage: the car in the middle facing its door; along one side the bench with its pegboard and
  // tools, along the other the tool chest and cart, the tyres, the ladder, the bike, the mower, the cans;
  // the racks of boxes on the back wall; tube lights under the ceiling
  const garage = () => {
    const car = choose('car'), cf = car && dims(car);
    if (car && W > cf.w + 1000 && D > cf.dep + 800) put(car, A(cA), Math.max(cf.dep / 2 + 350, Math.min(D / 2, D - cf.dep / 2 - 900)), 0);
    // the bench: a drawer cabinet with a worktop, the pegboard over it, the vice, the drill and the paints on it
    const bn = onSide('bench', Math.min(D - 800, D * 0.62), null, 30, false);
    if (bn) {
      const wa = mir ? A1 : A0, s2 = mir ? -1 : 1, d0 = bn.d - 650, d1 = bn.d + 650;
      const peg = canvasTex(256, 160, (g) => { g.fillStyle = '#c9a77c'; g.fillRect(0, 0, 256, 160); g.fillStyle = 'rgba(40,28,15,0.55)'; for (let y = 6; y < 160; y += 12) for (let x = 6; x < 256; x += 12) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); } }, true);
      box(M({ map: peg, roughness: 0.8 }, 0.6), mir ? wa - 20 : wa + 4, mir ? wa - 4 : wa + 20, d0, d1, bn.h + 250, bn.h + 1050);
      // (the tools hung on it: wrenches, a saw, a hammer — dark shapes on hooks)
      const steel = M({ color: 0x5c6064, metalness: 0.7, roughness: 0.4 }, 0.3), grip = M({ color: pick([0xc0392b, 0x2c6fb7, 0xe0a526]), roughness: 0.6 }, 0.3);
      for (let k = 0; k < 7; k++) { const d = d0 + 120 + k * 160, h0 = bn.h + 420 + (k % 3) * 120; box(steel, mir ? wa - 40 : wa + 20, mir ? wa - 20 : wa + 40, d - 12, d + 12, h0, h0 + 260 - (k % 2) * 80); box(grip, mir ? wa - 44 : wa + 18, mir ? wa - 18 : wa + 44, d - 18, d + 18, h0, h0 + 90); }
      box(M({ color: 0x7a5c3e, roughness: 0.7 }, 0.4), mir ? wa - bn.w - 40 : wa + 10, mir ? wa - 10 : wa + bn.w + 40, d0 + 100, d1 - 100, bn.h, bn.h + 40);   // (the worktop)
      const ax = A(A0 + bn.w / 2 + 30);
      const v = choose('vice'); if (v) put(v, ax, bn.d - 420, side(Math.PI / 2), bn.h + 40);
      for (const [cat, dd] of [['gdrill', 0], ['spray', 250], ['gtoolbox', -150]]) { const k = choose(cat); if (k) put(k, ax, bn.d + dd, side(Math.PI / 2 * (rnd() < 0.5 ? 1 : -1)), bn.h + 40); }
    }
    // the racks on the back wall, boxes and crates on their shelves
    const nR = Math.max(1, Math.min(3, Math.floor((W - 800) / 1200)));
    for (let k = 0; k < nR; k++) {
      const rk = back('grack', nR === 1 ? cA : A0 + 700 + k * (W - 1400) / (nR - 1));
      if (!rk) continue;
      for (const f of [0.03, 0.42, 0.62, 0.82]) { const c2 = choose(pick(['gbox', 'gcrate', 'gbox'])); if (c2 && rnd() < 0.8) put(c2, rk.a + (rnd() - 0.5) * Math.max(0, rk.w - 450), rk.d, (rnd() - 0.5) * 0.3, rk.h * f); }
    }
    // along the other side: what stands on the floor of a garage
    let d = 450;
    for (const cat of ['gchest', 'tyres', 'ladder', 'bike', 'mower', 'gcart', 'jerry', 'gen', 'broom', 'pump']) {
      if (d > D - 500) break;
      if (cat === 'tyres') {
        // (a stack of four, lying)
        const t = choose('tyre'); if (!t) continue; const tf = dims(t);
        const x = mir ? A0 + tf.w / 2 + 60 : A1 - tf.w / 2 - 60;
        for (let k = 0; k < 4; k++) { const hd = new THREE.Group(); hd.position.set(MM(x), MM(12 + tf.Dp / 2 + k * tf.Dp), -MM(d + tf.h / 2)); hd.rotation.x = Math.PI / 2; G.add(hd); loadModel('interior/' + t).then(({ scene }) => { scene.scale.setScalar(MM(1000)); scene.position.y = -MM(tf.h / 2); scene.traverse((o) => { if (o.isMesh) { o.userData.room = 1; o.userData.shared = 1; o.castShadow = false; o.material = glow(o.material.clone(), 0.4); } }); hd.add(scene); }).catch(() => {}); }
        placed.push([x - tf.w / 2, x + tf.w / 2, d, d + tf.h, 0, 4 * tf.Dp]); d += tf.h + 250; continue;
      }
      const k = choose(cat); if (!k) continue;
      const f = dims(k, Math.PI / 2), at = d + f.dep / 2;
      const q = onSide(k, at, null, 40, true);
      if (q) d = q.d + q.dep / 2 + 200;
    }
    const hr = choose('hose'); if (hr) put(hr, A(A1 - 400), D - 160, 0, 1200);
    // the lights: tube fittings on the ceiling, their tubes glowing at night
    for (const dd of [D * 0.3, D * 0.7]) { const tl = choose('tube'); if (tl) put(tl, A(cA), dd, Math.PI / 2, H - 60); const b = new THREE.Mesh(new THREE.BoxGeometry(MM(1200), MM(25), MM(60)), lampMat); b.rotation.y = Math.PI / 2; b.position.set(MM(A(cA)), MM(H - 40), -MM(dd)); G.add(b); lamps.push(b); }
  };
  if (r.kind === 'garage') garage();
  else if (r.kind === 'living') { if (W > 6800) { const L1 = A0 + Math.min(5200, W * 0.56); living(A0, L1); kitchen(L1, A1); } else living(A0, A1); }
  else if (r.kind === 'kitchen') kitchen(A0, A1);
  else if (r.kind === 'bed' || r.kind === 'kids') bed();
  else study();

  // the windows: sheers drawn to the sides, heavy curtains, a roman blind or a venetian one
  G.updateMatrixWorld(true);
  const how = r.kind === 'kitchen' || r.kind === 'study' ? pick(['roman', 'venetian', 'sheer']) : st === 'minimal' ? pick(['venetian', 'sheer']) : pick(['sheer', 'sheer', 'heavy', 'roman']);
  const cc = kids ? pick(KIDS.fab) : pick(Y.curtain), mSheer = glow(new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.9, transparent: true, opacity: 0.78, side: THREE.DoubleSide }), 1.5), mHeavy = M({ color: cc, side: THREE.DoubleSide, roughness: 0.95 }, 1.0);
  for (const w of gar ? [] : r.wins) {
    const half = w.w / 2, y0 = (w.y - r.floor) / S, y1 = y0 + w.h, out = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw));
    const Wn = new THREE.Group(); Wn.position.set(w.x, r.floor, w.z).addScaledVector(out, -MM((w.t || 300) / 2)); Wn.rotation.y = w.yaw;
    if (how === 'roman' || how === 'venetian') {
      const down = (y1 - y0) * (0.2 + 0.45 * rnd()), m = how === 'roman' ? mHeavy : M({ color: pick([0xf2f0eb, 0xd8d2c6, 0x2b2b2b, 0xb08a62]) }, 0.8);
      box(m, -half, half, 50, 70, y1 - down, y1 + 60, Wn);
      if (how === 'venetian') for (let y = y1 - down + 30; y < y1; y += 60) box(m, -half, half, 40, 80, y, y + 6, Wn);
    } else for (const s of [-1, 1]) {
      const heavy = how === 'heavy', cw = Math.min(heavy ? 600 : 750, half * (0.45 + 0.25 * rnd())), hh = H - 60, g = new THREE.PlaneGeometry(MM(cw), MM(hh), 14, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, MM(heavy ? 45 : 30) * Math.sin(p.getX(i) / MM(cw) * Math.PI * (heavy ? 5 : 7)));
      g.computeVertexNormals();
      const c = new THREE.Mesh(g, heavy ? mHeavy : mSheer); c.position.set(MM(s * (half + cw / 2 - 150)), MM(hh / 2), -MM(140)); c.userData.merge = 1; Wn.add(c);
      if (heavy && rnd() < 0.6) { const c2 = new THREE.Mesh(g, mSheer); c2.position.set(MM(s * (half * 0.5)), MM(hh / 2), -MM(90)); c2.scale.x = half / cw * 1.0; Wn.add(c2); }
    }
    // the rail
    box(M({ color: 0x2a2a2a, metalness: 0.5 }, 0.2), -half - 300, half + 300, 160, 180, H - 60, H - 40, Wn);
    G.attach(Wn);
  }
  // (the boxes and the curtains of one material: one mesh — a room is drawn in a few dozen calls, not
  // hundreds; none of it casts a shadow: the house's own walls do)
  G.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(G.matrixWorld).invert(), byMat = new Map(), gone = [];
  G.traverse((o) => { if (!o.isMesh || !o.userData.merge || o.userData.shared) return; const g2 = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(g2); gone.push(o); });
  for (const o of gone) { o.parent.remove(o); o.geometry.dispose(); }
  for (const [m, list] of byMat) {
    const ok = list.every((g2) => !!g2.index) || list.every((g2) => !g2.index);
    const geo = ok ? mergeGeometries(list, false) : null;
    if (geo) { const ms = new THREE.Mesh(geo, m); ms.receiveShadow = true; G.add(ms); for (const g2 of list) g2.dispose(); }
    else for (const g2 of list) { const ms = new THREE.Mesh(g2, m); ms.receiveShadow = true; G.add(ms); }
  }
  G.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.userData.room = 1; if (!o.userData.shared) o.castShadow = false; } });
  // at night: lit or not (most rooms are), how bright
  G.userData.lit = rnd() < 0.7; G.userData.bright = 0.7 + 0.5 * rnd();
  G.userData.mats = mats; G.userData.lamps = lamps; G.userData.lampMat = lampMat; G.userData.tv = tvMat; G.userData.tvOn = r.kind === 'living' && rnd() < 0.5;
  G.userData.kind = r.kind; G.userData.style = st;
  return G;
}

// the light spilling out of a window onto the ground in front of it at night
function spill(w, floor) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,205,140,0.85)'); gr.addColorStop(1, 'rgba(255,205,140,0)'); g.fillStyle = gr; g.fillRect(8, 0, 48, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const L = MM(2600), q = new THREE.Mesh(new THREE.PlaneGeometry(MM(w.w * 1.3), L), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  q.rotation.x = -Math.PI / 2; q.rotation.z = w.yaw; const out = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw));
  q.position.set(w.x + out.x * (L / 2 + MM(w.t / 2 || 150)), floor + MM(20), w.z + out.z * (L / 2 + MM(w.t / 2 || 150)));
  q.renderOrder = 7; q.userData.glow = 1; q.userData.spill = 1;
  return q;
}
// the whole house: its rooms (seed: a new set of dice each time «Готово» is pressed again)
export function buildInterior(app, seed = 0) {
  const G = new THREE.Group(), rooms = roomsOf(app), t = app.terrain, ground = Math.min(...rooms.map((q) => q.floor));
  const styles = Object.keys(STYLES), base = styles[mix(seed, rooms.length) % styles.length];
  for (const r of rooms) {
    r.seed = mix(r.seed, seed);
    // (the house has a style; some rooms their own)
    r.style = rnd1(r.seed) < 0.6 ? base : styles[mix(r.seed, 3) % styles.length];
    const R = buildRoom(r); G.add(R);
    R.userData.spills = [];
    for (const w of r.wins) {
      if (r.floor > ground + MM(1500)) continue;
      const out = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw)), gx = w.x + out.x * MM(800), gz = w.z + out.z * MM(800);
      const q = spill(w, t.inside(gx, gz) ? t.heightAt(gx, gz) : r.floor); G.add(q); R.userData.spills.push(q);
    }
  }
  G.userData.rooms = rooms.length; G.userData.list = rooms.map((r) => r.kind + ':' + r.style);
  return G;
}
// by day the rooms lit by the windows (a little of their own glow); at night lit rooms warm, the lamps
// bright, the TV flickering blue, the light out of the windows; the dark ones dark
export function interiorLight(G, k, time = 0) {
  for (const R of G.children) {
    const u = R.userData; if (!u.mats) continue;
    const on = u.lit ? k * u.bright : 0, day = 0.07 * (1 - k);
    for (const m of u.mats) m.emissiveIntensity = m.userData.glow * (day + on);
    u.lampMat.emissiveIntensity = u.lit ? 0.3 + 2.6 * k : 0.15 * (1 - k);
    u.tv.emissiveIntensity = u.tvOn && u.lit ? k * (0.8 + 0.4 * Math.sin(time * 7) * Math.sin(time * 2.3)) : 0;
    for (const q of u.spills || []) q.material.opacity = u.lit ? 0.55 * k : 0;
  }
}
