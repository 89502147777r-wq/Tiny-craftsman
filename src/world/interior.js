import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { isDoor } from './doors.js';
import { WINDOWS } from './windows.js';
import { boxBall } from './plants.js';

// «Готово»: the house lived in. Behind each window (the windows of one wall close together: one room)
// a room is found by looking round from it — its floor (the slab under it), its ceiling, how deep it
// goes and how wide (to the walls inside) — and furnished as such a room is: a living room behind the
// big glazing on the ground floor, a kitchen and dining room behind the other windows down there,
// a bedroom upstairs; curtains or blinds at the windows; the lamps lit at dusk, the light spilling
// out onto the ground. Only what is seen through the glass is made: low and cheap for the phone.
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
  // (what each is: by the floor it is on and its windows)
  const ground = Math.min(...rooms.map((r) => r.floor));
  let kitchen = false;
  for (const r of rooms) {
    const up = r.floor > ground + MM(1500);
    r.kind = up ? 'bed' : r.wins.some((w) => !(WINDOWS[w.key] || {}).sill) ? 'living' : (!kitchen ? 'kitchen' : 'study');
    if (r.kind === 'kitchen') kitchen = true;
  }
  return rooms;
}

// ---- the things in them ---------------------------------------------------------------------------------
const M = {};
function mats() {
  if (M.wall) return M;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  M.wall = std({ color: 0xf1ece3, emissive: 0xffd9a8, emissiveIntensity: 0 });
  M.ceil = std({ color: 0xf6f4ef, emissive: 0xffd9a8, emissiveIntensity: 0 });
  M.floor = std({ map: tex('deck/oakporc', 'col.jpg', true), color: 0xd8c6b0, roughness: 0.6 });
  M.fabric = std({ color: 0x8b8f93, roughness: 0.95 }); M.fabric2 = std({ color: 0xc9bca8, roughness: 0.95 }); M.fabric3 = std({ color: 0x3f4e5e, roughness: 0.95 });
  M.wood = std({ map: tex('deck/walnut', 'col.jpg', true), roughness: 0.55 }); M.oak = std({ map: tex('deck/oakporc', 'col.jpg', true), roughness: 0.6 });
  M.black = std({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.3 }); M.white = std({ color: 0xf3f2ee, roughness: 0.45 }); M.steel = std({ color: 0xb9bcbf, metalness: 0.7, roughness: 0.3 });
  M.tv = std({ color: 0x0c0d10, roughness: 0.15, metalness: 0.2, emissive: 0x1b2a40, emissiveIntensity: 0 });
  M.lamp = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffc77a, emissiveIntensity: 0, roughness: 0.6 });
  M.rug = std({ color: 0xb7aa98, roughness: 1 }); M.linen = new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.9, transparent: true, opacity: 0.82, side: THREE.DoubleSide, emissive: 0xffd9a8, emissiveIntensity: 0 });
  M.blind = std({ color: 0xe8e3d8, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffd9a8, emissiveIntensity: 0 });
  M.art = std({ color: 0x9c6b4e, roughness: 0.7 }); M.pot = std({ color: 0xd9d4ca, roughness: 0.6 });
  // (indoors the sun does not reach — the light off the walls stands for it; at night the lamps' light
  // on everything: each thing glows a little of its own colour, warm)
  for (const m of Object.values(M)) if (m !== M.lamp && m !== M.tv) { if (!m.emissiveIntensity && m.emissive.getHex() === 0) m.emissive.setHex(0xffe2c0); m.userData.glow = { wall: 1.1, ceil: 1.3, floor: 0.8, linen: 1.5, blind: 1.4 }[Object.keys(M).find((k) => M[k] === m)] ?? 0.55; if (m.map) m.emissiveMap = m.map; }
  return M;
}
// a box in the room's frame: a along the wall from its o (mm), d into the room from the wall's inner face, y up from the floor
function piece(G, m, a0, a1, d0, d1, y0, y1) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(MM(a1 - a0), MM(y1 - y0), MM(d1 - d0)), m);
  o.position.set(MM((a0 + a1) / 2), MM((y0 + y1) / 2), -MM((d0 + d1) / 2)); o.castShadow = true; o.receiveShadow = true; G.add(o);
  return o;
}
let _seed = 1; const rnd = () => { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647; };
function sofa(G, a, d, w = 2400) { const m = mats(); piece(G, m.fabric, a - w / 2, a + w / 2, d, d + 900, 0, 420); piece(G, m.fabric, a - w / 2, a + w / 2, d + 700, d + 900, 420, 820); for (const s of [-1, 1]) piece(G, m.fabric, a + s * w / 2 - (s > 0 ? 180 : 0), a + s * w / 2 + (s < 0 ? 180 : 0), d, d + 900, 420, 620); for (let k = 0; k < 3; k++) piece(G, m.fabric2, a - w / 2 + 250 + k * (w - 500) / 3 + 40, a - w / 2 + 250 + (k + 1) * (w - 500) / 3 - 40, d + 560, d + 700, 420, 760); }
function table(G, a, d, w, dep, h, top, legs) { piece(G, top, a - w / 2, a + w / 2, d, d + dep, h - 30, h); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) piece(G, legs, a + x * (w / 2 - 60) - 20, a + x * (w / 2 - 60) + 20, d + dep / 2 + z * (dep / 2 - 60) - 20, d + dep / 2 + z * (dep / 2 - 60) + 20, 0, h - 30); }
function chair(G, a, d, facing) { const m = mats(); piece(G, m.oak, a - 220, a + 220, d - 220, d + 220, 430, 460); piece(G, m.oak, a - 220, a + 220, facing > 0 ? d - 220 : d + 190, facing > 0 ? d - 190 : d + 220, 460, 880); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) piece(G, m.black, a + x * 190 - 12, a + x * 190 + 12, d + z * 190 - 12, d + z * 190 + 12, 0, 430); }
function pendant(G, a, d, top, drop = 900) { const m = mats(); piece(G, m.black, a - 4, a + 4, d - 4, d + 4, top - drop, top); const s = new THREE.Mesh(new THREE.ConeGeometry(MM(180), MM(220), 18, 1, true), m.lamp); s.position.set(MM(a), MM(top - drop - 80), -MM(d)); G.add(s); return s; }
function floorLamp(G, a, d) { const m = mats(); piece(G, m.black, a - 15, a + 15, d - 15, d + 15, 0, 1500); const s = new THREE.Mesh(new THREE.CylinderGeometry(MM(170), MM(220), MM(300), 18, 1, true), m.lamp); s.position.set(MM(a), MM(1600), -MM(d)); G.add(s); }
function plant(G, a, d) { const m = mats(); const p = new THREE.Mesh(new THREE.CylinderGeometry(MM(180), MM(140), MM(380), 16), m.pot); p.position.set(MM(a), MM(190), -MM(d)); G.add(p); const b = boxBall(330); b.position.set(MM(a), MM(330), -MM(d)); b.scale.set(1, 1.4, 1); G.add(b); }
function bed(G, a, d) { const m = mats(); piece(G, m.wood, a - 900, a + 900, d, d + 2100, 0, 300); piece(G, m.white, a - 860, a + 860, d + 40, d + 2060, 300, 520); piece(G, m.fabric3, a - 880, a + 880, d + 700, d + 2080, 500, 560); piece(G, m.wood, a - 950, a + 950, d - 80, d, 0, 1150); for (const s of [-1, 1]) piece(G, m.white, a + s * 430 - 350, a + s * 430 + 350, d + 60, d + 480, 520, 680); for (const s of [-1, 1]) { piece(G, m.wood, a + s * 1250 - 250, a + s * 1250 + 250, d, d + 420, 0, 480); const l = new THREE.Mesh(new THREE.CylinderGeometry(MM(110), MM(140), MM(220), 16), m.lamp); l.position.set(MM(a + s * 1250), MM(620), -MM(d + 200)); G.add(l); } }

// one room: its shell (the floor, three walls, the ceiling — the window wall is the house's own), what
// is in it, the curtains at its windows
export function buildRoom(r) {
  _seed = 7 + Math.round(Math.abs(r.o.x * 1e4 + r.o.z * 1e3)) % 1000;
  const m = mats(), G = new THREE.Group(), A0 = r.a0 / S, A1 = r.a1 / S, D = r.D / S, H = (r.ceil - r.floor) / S;
  G.position.set(r.o.x, r.floor, r.o.z); G.rotation.y = r.yaw;
  // (the frame: x along the wall (u), y up, -z into the room)
  // (the floor finished over the slab; the walls and the ceiling the house's where it has them)
  const sh = r.sh || { L: 1, R: 1, B: 1, C: 1 };
  piece(G, m.floor, A0, A1, 0, D, 0, 12); if (sh.C) piece(G, m.ceil, A0, A1, 0, D, H, H + 20);
  if (sh.B) piece(G, m.wall, A0, A1, D, D + 20, 0, H); if (sh.L) piece(G, m.wall, A0 - 20, A0, 0, D, 0, H); if (sh.R) piece(G, m.wall, A1, A1 + 20, 0, D, 0, H);
  // (the skirting)
  piece(G, m.white, A0, A1, D - 15, D, 0, 80);
  const cA = (A0 + A1) / 2, lamps = [];
  // (the living room and the kitchen with its dining table: one each, or both in one open-plan room
  // when it is wide enough — the sofa by the big glazing, the kitchen beyond)
  const living = (A0, A1) => {
    const cA = (A0 + A1) / 2;
    piece(G, m.rug, cA - 1500, cA + 1500, D * 0.3, D * 0.3 + 2000, 0, 8);
    sofa(G, cA, Math.min(D - 1000, D * 0.3 + 1300), Math.min(2800, (A1 - A0) * 0.55));
    table(G, cA, D * 0.3 + 400, 1100, 600, 380, m.oak, m.black);
    // the TV on a low unit on a side wall; the art on the back wall
    piece(G, m.wood, A0 + 20, A0 + 470, D * 0.35, D * 0.35 + 1800, 0, 450); piece(G, m.tv, A0 + 40, A0 + 90, D * 0.35 + 200, D * 0.35 + 1600, 700, 1500);
    piece(G, m.art, cA - 600, cA + 600, D - 40, D - 20, 1300, 2000);
    floorLamp(G, A1 - 450, D - 500); plant(G, A0 + 450, D - 450);
    lamps.push(pendant(G, cA, D * 0.5, H, 600));
  };
  const kitchen = (A0, A1) => {
    const cA = (A0 + A1) / 2;
    // the run along the back wall: base units with the worktop, wall units over it, a tall fridge column
    const k1 = A1 - 200, k0 = Math.max(A0 + 200, k1 - 3600);
    piece(G, m.white, k0, k1, D - 600, D, 100, 870); piece(G, m.oak, k0, k1, D - 620, D, 870, 910); piece(G, m.black, k0, k1, D - 590, D, 0, 100);
    piece(G, m.white, k0 + 650, k1, D - 350, D, 1450, 2150); piece(G, m.white, k0, k0 + 600, D - 620, D, 0, 2150);
    piece(G, m.steel, (k0 + k1) / 2 - 300, (k0 + k1) / 2 + 300, D - 560, D - 540, 920, 960);
    // the dining table with chairs, two pendants over it
    const tA = Math.max(A0 + 1100, Math.min(A1 - 1100, cA)), tD = Math.max(400, Math.min(D - 2000, D * 0.35 + 300));
    table(G, tA, tD, 1800, 900, 750, m.oak, m.black);
    for (const s of [-1, 1]) for (const k of [-1, 1]) chair(G, tA + k * 450, tD + 450 + s * 650, -s);
    lamps.push(pendant(G, tA - 450, tD + 450, H), pendant(G, tA + 450, tD + 450, H));
  };
  if (r.kind === 'living') {
    const W = A1 - A0;
    if (W > 6500) { const L1 = A0 + Math.min(5000, W * 0.55); living(A0, L1); kitchen(L1, A1); } else living(A0, A1);
  } else if (r.kind === 'kitchen') {
    kitchen(A0, A1);
  } else if (r.kind === 'bed') {
    bed(G, cA, Math.max(D - 2200, 400) + 0);
    piece(G, m.rug, cA - 1300, cA + 1300, Math.max(D - 2600, 300), Math.max(D - 2600, 300) + 1200, 0, 8);
    piece(G, m.white, A0 + 20, A0 + 620, D * 0.15, D * 0.15 + 2000, 0, 2300);
    lamps.push(pendant(G, cA, D * 0.5, H, 300));
  } else {
    table(G, cA, D - 800, 1400, 700, 750, m.oak, m.black); chair(G, cA, D - 1000, 1);
    piece(G, m.wood, A1 - 420, A1 - 20, D * 0.2, D * 0.2 + 1600, 0, 2000);
    plant(G, A0 + 400, D - 400);
    lamps.push(pendant(G, cA, D * 0.5, H, 300));
  }
  // the windows: sheer curtains drawn to the sides, or a blind half down
  // (each in its own window's frame: a corner room has windows on two walls)
  G.updateMatrixWorld(true);
  for (const w of r.wins) {
    const half = w.w / 2, y0 = (w.y - r.floor) / S, y1 = y0 + w.h, out = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw));
    const W = new THREE.Group(); W.position.set(w.x, r.floor, w.z).addScaledVector(out, -MM((w.t || 300) / 2)); W.rotation.y = w.yaw;
    if (r.kind === 'kitchen') piece(W, m.blind, -half, half, 60, 80, y1 - (y1 - y0) * (0.25 + 0.3 * rnd()), y1 + 80);
    else for (const s of [-1, 1]) {
      const cw = Math.min(700, half * 0.6), g = new THREE.PlaneGeometry(MM(cw), MM(H - 40), 12, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, MM(35) * Math.sin(p.getX(i) / MM(cw) * Math.PI * 6));
      g.computeVertexNormals();
      const c = new THREE.Mesh(g, m.linen); c.position.set(MM(s * (half + cw / 2 - 120)), MM((H - 40) / 2), -MM(120)); c.castShadow = true; W.add(c);
    }
    G.attach(W);
  }
  G.traverse((o) => { if (o.isMesh) o.userData.room = 1; });
  G.userData.lamps = lamps;
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
export function buildInterior(app) {
  const G = new THREE.Group(), rooms = roomsOf(app), t = app.terrain;
  for (const r of rooms) {
    G.add(buildRoom(r));
    for (const w of r.wins) { if (WINDOWS[w.key]?.sill && r.floor > Math.min(...rooms.map((q) => q.floor)) + MM(1500)) continue; const out = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw)), gx = w.x + out.x * MM(800), gz = w.z + out.z * MM(800); G.add(spill(w, t.inside(gx, gz) ? t.heightAt(gx, gz) : r.floor)); }
  }
  G.userData.rooms = rooms.length;
  return G;
}
// at night the rooms lit: the walls and the ceiling warm, the lamps bright, the light out of the windows
export function interiorLight(G, k) {
  const m = mats();
  for (const q of Object.values(m)) if (q.userData.glow) q.emissiveIntensity = q.userData.glow * (0.07 + 0.93 * k);
  m.lamp.emissiveIntensity = 0.3 + 2.6 * k; m.tv.emissiveIntensity = 0.6 * k;
  G.traverse((o) => { if (o.userData.spill) o.material.opacity = 0.55 * k; });
}
