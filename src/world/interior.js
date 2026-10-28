import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { isDoor } from './doors.js';
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
// the windows grouped into rooms: [{ wins, yaw, floor, ceil, a0, a1 (along the wall, m from o), D, o, u, n }]
export function roomsOf(app) {
  const wins = app.objects.all('window').filter((w) => !w.corner && !(isDoor(w.key)));
  const objs = solids(app), t = app.terrain, rooms = [];
  // (the big glazing first: its room is the one the others may open into)
  wins.sort((p, q) => !!(WINDOWS[p.key] || {}).sill - !!(WINDOWS[q.key] || {}).sill);
  const inRoom = (r, p) => { const v = p.clone().sub(r.o), a = v.dot(r.u), d = -v.dot(r.n); return a > r.a0 && a < r.a1 && d > 0 && d < r.D; };
  for (const w of wins) {
    const out = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw)), along = new THREE.Vector3(out.z, 0, -out.x), half = MM((w.t || 300) / 2);
    const inner = new THREE.Vector3(w.x, 0, w.z).addScaledVector(out, -half);
    const K = WINDOWS[w.key] || {}, sill = K.sill ? MM(900) : 0;
    // (the floor: the slab under a point inside, else the ground)
    const probe = inner.clone().addScaledVector(out, -MM(600)); probe.y = w.y + MM(300);
    const down = cast(objs, probe, new THREE.Vector3(0, -1, 0), MM(1500));
    let floor = down ? down.point.y : (t.inside(probe.x, probe.z) ? t.heightAt(probe.x, probe.z) : w.y - sill);
    if (floor > w.y + MM(50) || floor < w.y - MM(1300)) floor = w.y - sill;
    // (a room already there — the window on its side wall: the corner room with windows on two walls)
    const r1 = rooms.find((r) => Math.abs(r.floor - floor) < MM(300) && inRoom(r, probe.clone().setY(0)));
    if (r1) { r1.wins.push(w); continue; }
    const mid = inner.clone().addScaledVector(out, -MM(200)); mid.y = floor + MM(1200);
    // (the house's own walls, slab and ceiling where the rays find them; where not, the room's shell)
    const up = cast(objs, mid.clone(), new THREE.Vector3(0, 1, 0), MM(4000)), ceil = up ? Math.max(floor + MM(2300), up.point.y) : floor + MM(2800);
    const back = cast(objs, mid.clone(), out.clone().negate(), MM(7500)), D = back ? Math.max(MM(1500), back.distance) : MM(4200);
    const side = (s) => cast(objs, mid.clone().addScaledVector(out, -MM(400)), along.clone().multiplyScalar(s), MM(7500));
    const hL = side(-1), hR = side(1);
    const aL = -Math.max(MM(w.w / 2 + 300), hL ? hL.distance : MM(2000)), aR = Math.max(MM(w.w / 2 + 300), hR ? hR.distance : MM(2000));
    const sh = { L: !hL, R: !hR, B: !back, C: !up, F: !down };
    // (a room already on this wall, level with it and overlapping: the window joins it)
    const r0 = rooms.find((r) => Math.abs(Math.atan2(Math.sin(r.yaw - w.yaw), Math.cos(r.yaw - w.yaw))) < 0.05 && Math.abs(r.floor - floor) < MM(300) && Math.abs(new THREE.Vector3(w.x, 0, w.z).sub(r.o).dot(r.n)) < MM(200) && (() => { const a = new THREE.Vector3(w.x, 0, w.z).sub(r.o).dot(r.u); return a + aL < r.a1 + MM(400) && a + aR > r.a0 - MM(400); })());
    if (r0) {
      const a = new THREE.Vector3(w.x, 0, w.z).sub(r0.o).dot(r0.u);
      if (a + aL < r0.a0) { r0.a0 = a + aL; r0.sh.L = sh.L; }
      if (a + aR > r0.a1) { r0.a1 = a + aR; r0.sh.R = sh.R; }
      r0.wins.push(w); if (D > r0.D) { r0.D = D; r0.sh.B = sh.B; } continue;
    }
    rooms.push({ wins: [w], yaw: w.yaw, floor, ceil, D, o: inner.clone(), u: along, n: out, a0: aL, a1: aR, big: !K.sill, sh });
  }
  // (rooms do not run into each other: the big glazing's room first, the next one stops at its wall —
  // short of it, or narrower beside it, whichever leaves more of the room)
  rooms.sort((p, q) => q.big - p.big);
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    for (const q of rooms.slice(0, i)) {
      if (Math.abs(q.floor - r.floor) > MM(1500)) continue;
      const pts = [[q.a0, 0], [q.a1, 0], [q.a0, q.D], [q.a1, q.D]].map(([a, d]) => q.o.clone().addScaledVector(q.u, a).addScaledVector(q.n, -d).sub(r.o)), A = pts.map((p) => p.dot(r.u)), Dd = pts.map((p) => -p.dot(r.n));
      const qa0 = Math.min(...A), qa1 = Math.max(...A), qd0 = Math.min(...Dd), qd1 = Math.max(...Dd), m = MM(150);
      if (qa1 <= r.a0 + m || qa0 >= r.a1 - m || qd1 <= m || qd0 >= r.D - m) continue;
      const wa = r.wins.map((w) => new THREE.Vector3(w.x, 0, w.z).sub(r.o).dot(r.u)), wl = Math.min(...r.wins.map((w, k) => wa[k] - MM(w.w / 2))), wr = Math.max(...r.wins.map((w, k) => wa[k] + MM(w.w / 2)));
      const opts = [];
      if (qd0 - MM(100) > MM(1800)) opts.push(() => { r.D = qd0 - MM(100); r.sh.B = true; }, (r.a1 - r.a0) * (qd0 - MM(100)));
      if (qa0 - MM(100) > wr + MM(200)) opts.push(() => { r.a1 = qa0 - MM(100); r.sh.R = true; }, (qa0 - MM(100) - r.a0) * r.D);
      if (qa1 + MM(100) < wl - MM(200)) opts.push(() => { r.a0 = qa1 + MM(100); r.sh.L = true; }, (r.a1 - qa1 - MM(100)) * r.D);
      let best = -1; for (let k = 0; k < opts.length; k += 2) if (best < 0 || opts[k + 1] > opts[best + 1]) best = k;
      if (best >= 0) opts[best](); else { r.D = Math.max(MM(1200), Math.min(r.D, qd0 - MM(100))); r.sh.B = true; }
    }
  }
  // (each room its kind: on the ground floor the living room behind the big glazing, the kitchen behind
  // the next window; upstairs the largest a bedroom, then by the dice — a child's room, a bedroom, a study)
  const levels = [...new Set(rooms.map((r) => Math.round(r.floor / MM(1500))))].sort((p, q) => p - q);
  const hs = houseSeed(rooms);
  for (const lv of levels) {
    const on = rooms.filter((r) => Math.round(r.floor / MM(1500)) === lv).sort((p, q) => (q.a1 - q.a0) * q.D - (p.a1 - p.a0) * p.D);
    let kitchen = false, living = false, k = 0;
    const cycle = ['kids', 'bed', 'study', 'kids', 'bed'];
    on.forEach((r, i) => {
      r.lv = levels.indexOf(lv); r.seed = mix(hs, Math.round(r.o.x * 1e4), Math.round(r.o.z * 1e4), r.lv * 7919);
      if (r.lv === 0 && r.big && !living) { r.kind = 'living'; living = true; return; }
      if (r.lv === 0 && !kitchen) { r.kind = 'kitchen'; kitchen = true; return; }
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
  const glow = (m, g) => { m.emissive = m.emissive || new THREE.Color(); m.emissive.copy(WARM); if (m.map) m.emissiveMap = m.map; m.userData.glow = g; mats.push(m); return m; };
  const M = (o, g = 0.55) => glow(std(o), g);
  const box = (m, a0, a1, d0, d1, y0, y1, par = G) => { const o = new THREE.Mesh(new THREE.BoxGeometry(MM(Math.max(1, a1 - a0)), MM(Math.max(1, y1 - y0)), MM(Math.max(1, d1 - d0))), m); o.position.set(MM((a0 + a1) / 2), MM((y0 + y1) / 2), -MM((d0 + d1) / 2)); o.castShadow = o.receiveShadow = true; par.add(o); return o; };
  const wood = (name, tint, rep = 1) => { const t = tex('deck/' + name, 'col.jpg', true).clone(); t.needsUpdate = true; t.repeat.set(rep, rep); return M({ map: t, color: tint, roughness: 0.6 }, 0.5); };
  const mir = rnd() < 0.5, A = (a) => (mir ? A0 + A1 - a : a), side = (rot) => (mir ? -rot : rot);
  // the shell: the floor in the style's wood, the walls painted, the ceiling white
  const wallCol = kids ? pick(KIDS.walls) : pick(Y.walls), [fl, ft] = pick(Y.floor);
  const mWall = M({ color: wallCol }, 1.0), mCeil = M({ color: 0xf6f4f0 }, 1.25);
  const ftx = tex('deck/' + fl, 'col.jpg', true).clone(); ftx.needsUpdate = true; ftx.repeat.set(Math.max(1, W / 1500), Math.max(1, D / 1500));
  const mFloor = M({ map: ftx, color: ft, roughness: 0.55 }, 0.75);
  const sh = r.sh || { L: 1, R: 1, B: 1, C: 1 };
  box(mFloor, A0, A1, 0, D, 0, 12); if (sh.C) box(mCeil, A0, A1, 0, D, H, H + 20);
  if (sh.B) box(mWall, A0, A1, D, D + 20, 0, H); if (sh.L) box(mWall, A0 - 20, A0, 0, D, 0, H); if (sh.R) box(mWall, A1, A1 + 20, 0, D, 0, H);
  // (the walls' inner faces a hair in front of the house's own, so a finish shows on them whichever is there)
  const backFace = (m, a0, a1, y0 = 0, y1 = H) => box(m, a0, a1, D - 8, D - 2, y0, y1);
  const leftFace = (m, d0, d1, y0 = 0, y1 = H) => { const a = mir ? A1 : A0; return box(m, mir ? a - 8 : a + 2, mir ? a - 2 : a + 8, d0, d1, y0, y1); };
  backFace(mWall, A0, A1); leftFace(mWall, 0, D); { const a = mir ? A0 : A1; box(mWall, mir ? a + 2 : a - 8, mir ? a + 8 : a - 2, 0, D, 0, H); }
  box(M({ color: 0xf4f2ee }, 0.6), A0, A1, D - 18, D - 6, 0, 70);   // (the skirting)

  // an accent wall: slats, a paper, a paint, mouldings, brick or concrete — on the back wall over a0..a1
  const accent = (a0, a1, kind = kids ? pick(['paper', 'paper', 'paint']) : pick(Y.accent)) => {
    if (kind === 'slats') {
      const [wn, wt] = Y.slat, m = wood(wn, wt, 0.3), n = Math.floor((a1 - a0) / 60), g = new THREE.BoxGeometry(MM(40), MM(H - 90), MM(20));
      const im = new THREE.InstancedMesh(g, m, n), o = new THREE.Object3D();
      box(M({ color: 0x1d1d1d }, 0.2), a0, a1, D - 10, D - 7, 0, H);
      for (let i = 0; i < n; i++) { o.position.set(MM(a0 + 30 + i * 60), MM((H - 90) / 2 + 80), -MM(D - 19)); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
      im.castShadow = im.receiveShadow = true; G.add(im);
    } else if (kind === 'paper') {
      const t = kids ? wallpaper(pick(KID_PAPERS), pick(KIDS.walls), pick(KIDS.inks), sd) : wallpaper(pick(Y.paper), pick(Y.walls), pick(Y.art), sd);
      t.repeat.set((a1 - a0) / 600, H / 600); backFace(M({ map: t }, 0.9), a0, a1);
    } else if (kind === 'mould') {
      backFace(M({ color: pick(Y.paint) }, 0.9), a0, a1);
      const mm = M({ color: 0xf4f1ea }, 0.8), n = Math.max(1, Math.round((a1 - a0) / 1100)), w = (a1 - a0) / n;
      for (let i = 0; i < n; i++) for (const [y0, y1] of [[300, 1000], [1250, H - 350]]) {
        const x0 = a0 + i * w + 150, x1 = a0 + (i + 1) * w - 150; if (y1 - y0 < 300) continue;
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
      const x = a + (i - (n - 1) / 2) * (w + gap), kind = kids ? pick(KID_ARTS) : pick(ARTS), t = artwork(kind, kids ? pick(KIDS.inks) : pick(Y.art), sd + i * 101, 256, Math.round(256 * h / w));
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
  const put = (key, a, d, rot = 0, y = 0) => {
    if (!key || !FURN[key]) return null;
    const holder = new THREE.Group(); holder.name = 'F:' + key; holder.position.set(MM(a), MM(y + 12), -MM(d)); holder.rotation.y = rot; G.add(holder);
    loadModel('interior/' + key).then(({ scene }) => {
      scene.scale.setScalar(MM(1000));
      const cache = new Map();
      scene.traverse((o) => {
        if (!o.isMesh) return; o.userData.room = 1;
        const one = (m) => { if (!cache.has(m)) { const c = m.clone(); glow(c, 0.45); if (c.transparent && c.opacity > 0.9) c.transparent = false; cache.set(m, c); } return cache.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
        if (FURN[key].tint) o.material.color?.multiply(new THREE.Color(FURN[key].tint));
      });
      holder.add(scene);
      if (G.userData.lit != null) G.userData.apply?.();
    }).catch(() => {});
    return { ...dims(key, rot), a, d };
  };
  const cand = (cat) => Object.keys(FURN).filter((k) => [].concat(FURN[k].c).includes(cat)), choose = (cat, fit) => {
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
      if (D > 3000) { const tu = onSide('tvunit', D * 0.45, (f) => f.w < D * 0.8); if (tu) tv(0, 0, D * 0.45, false); }
      const pl = choose('plant'); if (pl) put(pl, A(a1 - 400), D - 400);
      const fd = choose('floordecor'); if (fd && D > 3200) put(fd, A(a0 + 500), D * 0.35, side(Math.PI / 4));
    } else {
      // the sofa across the room facing the TV wall: the TV unit, slats or a paper behind it
      const tu = onSide('tvunit', D * 0.55, (f) => f.w < D * 0.8);
      if (tu) tv(0, 0, D * 0.55, false);
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
    const k1 = a1 - 200, k0 = Math.max(a0 + 200, k1 - 3800), fr = choose('fridge'), ff = fr && dims(fr);
    let x1 = k1; if (fr) { put(fr, A(k1 - ff.w / 2), D - ff.dep / 2 - 20, 0); x1 = k1 - ff.w - 20; }
    box(front, A(k0) < A(x1) ? A(k0) : A(x1), A(k0) < A(x1) ? A(x1) : A(k0), D - 600, D, 100, 870); box(top, Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 620, D, 870, 910); box(plinth, Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 580, D, 0, 100);
    for (let x = k0 + 300; x < x1; x += 600) box(handle, A(x) - 120, A(x) + 120, D - 622, D - 602, 780, 800);
    // the splashback, then wall units or open shelves
    box(M({ color: pick([0xf2f0eb, 0xdedbd5, 0x9fb3b0, 0x2b2d2f, 0xd9c7b0]), roughness: 0.2 }, 0.6), Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 10, D - 4, 910, 1500);
    if (rnd() < 0.6) box(front, Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 350, D, 1500, 2200);
    else for (const y of [1600, 1950]) { box(M({ color: 0x8a6d50 }, 0.4), Math.min(A(k0), A(x1)), Math.max(A(k0), A(x1)), D - 260, D, y, y + 35); const v = choose('vase'); if (v) put(v, A(k0 + 300 + rnd() * 600), D - 130, 0, y + 35); }
    box(M({ color: 0xb9bcbf, metalness: 0.7, roughness: 0.3 }, 0.2), A((k0 + x1) / 2) - 300, A((k0 + x1) / 2) + 300, D - 560, D - 540, 920, 940);
    // the table and its chairs (or a set), lamps over it; or an island with stools in a deep room
    const td = Math.max(1100, Math.min(D - 1900, D * 0.45)), ta = Math.max(a0 + 1000, Math.min(a1 - 1000, (a0 + a1) / 2));
    if (D > 4800 && rnd() < 0.4) {
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
      if (ns) for (const s of [-1, 1]) { const x = cA + s * (b.w / 2 + 320); if (x < A0 + 250 || x > A1 - 250) continue; const n = put(ns, A(x), D - dims(ns).dep / 2 - 30, 0); tableLamp(A(x), D - 200, n.h); }
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
  if (r.kind === 'living') { if (W > 6800) { const L1 = A0 + Math.min(5200, W * 0.56); living(A0, L1); kitchen(L1, A1); } else living(A0, A1); }
  else if (r.kind === 'kitchen') kitchen(A0, A1);
  else if (r.kind === 'bed' || r.kind === 'kids') bed();
  else study();

  // the windows: sheers drawn to the sides, heavy curtains, a roman blind or a venetian one
  G.updateMatrixWorld(true);
  const how = r.kind === 'kitchen' || r.kind === 'study' ? pick(['roman', 'venetian', 'sheer']) : st === 'minimal' ? pick(['venetian', 'sheer']) : pick(['sheer', 'sheer', 'heavy', 'roman']);
  const cc = kids ? pick(KIDS.fab) : pick(Y.curtain), mSheer = glow(new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.9, transparent: true, opacity: 0.78, side: THREE.DoubleSide }), 1.5), mHeavy = M({ color: cc, side: THREE.DoubleSide, roughness: 0.95 }, 1.0);
  for (const w of r.wins) {
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
      const c = new THREE.Mesh(g, heavy ? mHeavy : mSheer); c.position.set(MM(s * (half + cw / 2 - 150)), MM(hh / 2), -MM(140)); c.castShadow = true; Wn.add(c);
      if (heavy && rnd() < 0.6) { const c2 = new THREE.Mesh(g, mSheer); c2.position.set(MM(s * (half * 0.5)), MM(hh / 2), -MM(90)); c2.scale.x = half / cw * 1.0; Wn.add(c2); }
    }
    // the rail
    box(M({ color: 0x2a2a2a, metalness: 0.5 }, 0.2), -half - 300, half + 300, 160, 180, H - 60, H - 40, Wn);
    G.attach(Wn);
  }
  G.traverse((o) => { if (o.isMesh || o.isInstancedMesh) o.userData.room = 1; });
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
