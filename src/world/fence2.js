import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import { legs, pointAtS, FENCE, FENCE_KINDS, kindOf, postsOf } from './fence.js';

// The fence put up post by post («Забор», fenceTool.js), as a fencer does it:
//   line  – the string pulled along the finger, the pegs on it every `step` (1 … 5 m); each peg can
//           be moved along the string (the room for a gate or a wicket left before anything is dug);
//   holes – one hole at a time, where the finger taps: the peg pulled out, the petrol earth auger
//           bores Ø 200 to 1 m;
//   posts – a profile pipe (square 40 … 100 or round Ø 40 … 100) lowered into a hole and plumbed;
//           the concrete — «Бетон», the hose or the bucket, into each hole;
//   rails – profile pipes (40 × 20 …) up to their length laid on the posts' face, welded to each
//           post and to the rail before them;
//   fill  – the bays with rails, bay by bay; gates and wickets — into the bays left without rails.
//   fence { v: 2, pts, g, step, H, kind, col, pegs: [{ s, hole, post: { sh, a, h }, fill, pourT }],
//           rails: [{ a, b, y, sec }] (from s, to s, its height mm, [height, depth] mm), filled: [s…],
//           gates: [{ s (the bay's middle), w (its width), type, hung, open }] }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const HOLE = { r: 100, depth: 1000 };
export const RAIL_SECS = { r4020: { name: '40 × 20', h: 40, d: 20 }, r4025: { name: '40 × 25', h: 40, d: 25 }, r6040: { name: '60 × 40', h: 60, d: 40 } };
export const isV2 = (r) => r?.v === 2;
// a fence of the old kind (put up all at once, before BUILD 245: { pts, H, kind, col, g, done: { holes,
// posts, fill }, gates }) as a fence by the post — the same posts where they stood, each stage done as it
// was: the holes bored, the posts 60 × 60 (100 × 100 at the gates) concreted, the rails on every row of
// each bay and its infill, the gates hung. Read so on loading (core/upgrade.js): nothing else draws the old.
export function fromV1(r) {
  if (!r || r.v === 2 || !Array.isArray(r.pts)) return r;
  const d = r.done || {}, H = r.H || 1800;
  const pegs = postsOf(r).map(([, , big, s]) => {
    const q = { s: Math.round(s) };
    if (d.holes || d.posts) { q.hole = 1; q.g = r.g; }
    if (d.posts) { q.post = { sh: 'sq', a: big ? FENCE.bigPost : FENCE.post, h: H }; q.fill = 1; q.pourT = 0; }
    return q;
  });
  const gates = (r.gates || []).map((q) => ({ s: Math.round(q.s), w: Math.round(q.w), type: q.type, open: !!q.open, hung: q.hung || d.fill ? 1 : 0, hinge: 'L', swing: 'front' }));
  const rails = [], filled = [];
  if (d.fill && d.posts) for (let i = 1; i < pegs.length; i++) {
    const a = pegs[i - 1].s, b = pegs[i].s, mid = (a + b) / 2;
    if (gates.some((q) => Math.abs(mid - q.s) < q.w / 2 - 1)) continue;
    for (const y of railRows(H)) rails.push({ a, b, y, sec: 'r4020', side: 1 });
    filled.push(mid);
  }
  const { done, ...rest } = r;
  void done;
  return { ...rest, v: 2, step: FENCE_KINDS[kindOf(r)].step, kind: kindOf(r), H, pegs, rails, filled, gates };
}
// the rows of rails on posts h high: two (three from 2 m)
export const railRows = (h) => (h >= 2000 ? [300, Math.round(h / 2), h - 300] : [300, h - 300]);

// the pegs of a line: at the start of each leg, every `step` along it, at its end (the corners shared)
export function pegsFor(pts, step) {
  const out = [];
  for (const g of legs({ pts })) {
    for (let k = 0; k * step < g.L - 1; k++) { const s = g.s0 + k * step; if (!out.length || s - out.at(-1).s > 1) out.push({ s: Math.round(s) }); }
    out.push({ s: Math.round(g.s0 + g.L) });
  }
  // (a last bay of a leg shorter than 30 cm: its peg goes)
  return out.filter((q, i, a) => i === 0 || q.s - a[i - 1].s > 300 || i === a.length - 1).filter((q, i, a) => i === 0 || q.s - a[i - 1].s > 1);
}
// the leg a peg is on: [from s, to s] (a corner's: fixed)
export function legBounds(r, s) {
  for (const g of legs(r)) if (s > g.s0 + 1 && s < g.s0 + g.L - 1) return [g.s0, g.s0 + g.L];
  return null;
}
export const pegXZ = (r, s) => pointAtS(r, s);
// the ground at a post (taken when its hole is bored: a sloping plot), else the line's
export const gOf = (r, q) => q?.g ?? r.g;
export const postTop = (r, q) => gOf(r, q) + MM(q.post?.h || r.H || 1800);
// the hole as the auger leaves it (its rim a little ragged: the concrete fills all of it)
export const HOLE_R = HOLE.r * 1.28;   // (the auger's hole, its rim not quite round: 0,76 … 1,26 × its radius)
// where the concrete is poured into a post's hole: into the gap between the post and the hole's wall,
// on the side toward `from` (the camera)
export function pourSpot(r, q, from) {
  const [x, z] = pegXZ(r, q.s), dx = from.x - x, dz = from.z - z, L = Math.hypot(dx, dz) || 1, d = MM(((q.post?.a || 60) / 2 + HOLE_R) / 2);
  return [x + dx / L * d, z + dz / L * d];
}
export const postA = (r) => Math.max(40, ...(r.pegs || []).map((q) => q.post?.a || 0));
// the bays between neighbouring posts; railed: rails on every row of it
export function bays2(r) {
  const P = (r.pegs || []), out = [];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], mid = (a.s + b.s) / 2, h = Math.min(a.post?.h || a.pillar?.h || r.H, b.post?.h || b.pillar?.h || r.H);
    const railed = !!((a.post || a.pillar) && (b.post || b.pillar)) && new Set((r.rails || []).filter((q) => q.a <= a.s + 1 && q.b >= b.s - 1).map((q) => Math.round(q.y))).size >= railRows(h).length;   // (its rows: at their heights over what is under it)
    const gi = (r.gates || []).findIndex((q) => Math.abs(q.s - mid) < 2);
    out.push({ i, a, b, mid, L: b.s - a.s, railed, gate: gi, filled: (r.filled || []).some((m) => Math.abs(m - mid) < 2) });
  }
  return out;
}

// ---- drawn ------------------------------------------------------------------------------------
const mats = {};
const M = (k, make) => mats[k] || (mats[k] = make());
const std = (o) => new THREE.MeshStandardMaterial(o);
const steelM = () => M('steel', () => std({ color: 0x2f3236, roughness: 0.45, metalness: 0.55 }));
const concM = () => M('conc', () => { const t = new THREE.TextureLoader().load('assets/textures/pool_coat/col.jpg'); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return std({ map: t, color: 0xbdbab3, roughness: 0.95 }); });
const wetM = () => M('wet', () => { const m = concM().clone(); m.color.setHex(0x6a6863); m.roughness = 0.25; return m; });   // (fresh: dark, wet, shining)
const weldM = () => M('weld', () => std({ color: 0x3a3632, roughness: 0.7, metalness: 0.4 }));
const pegM = () => M('peg', () => std({ color: 0xc49a62, roughness: 0.85 }));
const tapeM = () => M('tape', () => std({ color: 0xff5a1f, roughness: 0.6 }));

// the string and the pegs not yet pulled for their holes; `hide`: the peg being pulled now
export function stringAndPegs(r, hide = -1) {
  const G = new THREE.Group(), y = r.g + MM(120);
  G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(r.pts.map(([x, z]) => new THREE.Vector3(x, y, z))), M('line', () => new THREE.LineBasicMaterial({ color: 0xfff3c4 }))));
  // a peg: a 40 × 40 stake 500 long, 380 out of the ground, pointed, an orange tape at its top
  const peg = new THREE.BoxGeometry(MM(36), MM(400), MM(36)); peg.translate(0, MM(180), 0);
  const tip = new THREE.ConeGeometry(MM(25), MM(90), 4); tip.rotateX(Math.PI); tip.rotateY(Math.PI / 4); tip.translate(0, MM(-55), 0);
  const tape = new THREE.BoxGeometry(MM(40), MM(40), MM(40)); tape.translate(0, MM(340), 0);
  const pegs = (r.pegs || []).map((q, i) => [q, i]).filter(([q, i]) => !q.hole && !q.pillar && i !== hide);
  if (pegs.length) {
    const P = new THREE.InstancedMesh(mergeGeometries([peg.toNonIndexed(), tip.toNonIndexed()]), pegM(), pegs.length);
    const T = new THREE.InstancedMesh(tape, tapeM(), pegs.length), m = new THREE.Matrix4();
    pegs.forEach(([q], k) => { const [x, z] = pegXZ(r, q.s); m.makeTranslation(x, r.g, z); P.setMatrixAt(k, m); T.setMatrixAt(k, m); });
    P.castShadow = true; G.add(P, T);
  }
  return G;
}
// the posts in their holes and the concrete round them (live: { i, f } — a hole being poured)
export function postsAndConcrete(r, live = null) {
  const G = new THREE.Group();
  (r.pegs || []).forEach((q, i) => {
    const [x, z, ux, uz] = pegXZ(r, q.s), yaw = Math.atan2(-uz, ux), g = gOf(r, q), anchor = q.hole === 'anchor', bot = anchor ? g + MM(10) : g - MM(HOLE.depth - 100);
    if (q.post && anchor) {
      // (on concrete: the base plate 200 × 200 × 10 on four anchors, two gussets to the post)
      const pl = new THREE.Mesh(new THREE.BoxGeometry(MM(200), MM(10), MM(200)), steelM()); pl.position.set(x, g + MM(5), z); pl.rotation.y = yaw; pl.castShadow = true; G.add(pl);
      for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const n = new THREE.Mesh(new THREE.CylinderGeometry(MM(12), MM(12), MM(14), 6), steelM()); n.position.set(x + (ax * Math.cos(yaw) + az * Math.sin(yaw)) * MM(70), g + MM(17), z + (-ax * Math.sin(yaw) + az * Math.cos(yaw)) * MM(70)); G.add(n); }
      for (const sx of [1, -1]) { const gu = new THREE.Mesh(new THREE.BoxGeometry(MM(6), MM(80), MM(70)), steelM()); gu.position.set(x + Math.cos(yaw) * sx * MM(q.post.a / 2 + 3), g + MM(50), z - Math.sin(yaw) * sx * MM(q.post.a / 2 + 3)); gu.rotation.y = yaw; G.add(gu); }
    }
    if (q.post) {
      const a = MM(q.post.a), top = g + MM(q.post.h), L = top - bot;
      const geo = q.post.sh === 'rd' ? new THREE.CylinderGeometry(a / 2, a / 2, L, 16) : new THREE.BoxGeometry(a, L, a);
      const o = new THREE.Mesh(geo, steelM()); o.position.set(x, (top + bot) / 2, z); o.rotation.y = yaw; o.castShadow = true; o.receiveShadow = true; o.userData.post = i; G.add(o);
      // the cap welded on its top
      const cap = q.post.sh === 'rd' ? new THREE.CylinderGeometry(a / 2 + MM(3), a / 2 + MM(3), MM(5), 16) : new THREE.BoxGeometry(a + MM(6), MM(5), a + MM(6));
      const c = new THREE.Mesh(cap, steelM()); c.position.set(x, top + MM(2.5), z); c.rotation.y = yaw; G.add(c);
    }
    const f = anchor ? 0 : live && live.i === i ? live.f : q.fill || 0;
    if (f > 0) {
      // the concrete fills the hole wall to wall round the post, up to its level; full: level with the
      // ground and a collar sloped off round the post (the rain runs away from it)
      const y0 = g - MM(HOLE.depth), y1 = y0 + MM(HOLE.depth) * Math.min(1, f), R = MM(HOLE_R), fresh = q.pourT == null || live?.i === i;
      const cg = new THREE.CylinderGeometry(R, R * 0.97, y1 - y0, 20); cg.translate(x, (y0 + y1) / 2, z);
      const o = new THREE.Mesh(cg, fresh && f < 1 ? wetM() : concM()); o.receiveShadow = true; o.userData.post = i; G.add(o);
      if (f >= 1) { const a = (q.post?.a || 60) / 2; const c = new THREE.CylinderGeometry(MM(a + 25), R + MM(20), MM(30), 20); c.translate(x, g + MM(12), z); const k = new THREE.Mesh(c, concM()); k.receiveShadow = true; G.add(k); }
    }
  });
  return G;
}
// the rails on the posts' face (the side the string is pulled to the right of), the welds at the posts
// and at the joints between rails
// where a rail lies: on the posts' face (the side it was put against), from the first post's far edge to
// the last's; inline (between brick pillars — or a pillar and a post): on the line, from face to face,
// on the embedded plates in the masonry
export function railPlace(r, q) {
  const sec = RAIL_SECS[q.sec] || RAIL_SECS.r4020, sd = q.side || 1, [ax, az, ux, uz] = pegXZ(r, q.a + 0.5), [bx, bz] = pegXZ(r, q.b - 0.5);
  const nx = -uz * sd, nz = ux * sd, yaw = Math.atan2(-uz, ux), y = r.g + MM(q.y), D = Math.hypot(bx - ax, bz - az);
  if (q.inline) {
    const ha = MM(q.ha || 30), hb = MM(q.hb || 30), mid = (ha + D - hb) / 2;
    return { sec, L: Math.max(MM(50), D - ha - hb), cx: ax + ux * mid, cz: az + uz * mid, y, yaw, ux, uz, nx, nz, off: 0, ends: [[ax + ux * ha, az + uz * ha, q.ea], [bx - ux * hb, bz - uz * hb, q.eb]] };
  }
  const pa = postA(r), off = MM(pa / 2 + sec.d / 2);
  return { sec, L: D + MM(pa), cx: (ax + bx) / 2 + nx * off, cz: (az + bz) / 2 + nz * off, y, yaw, ux, uz, nx, nz, off, pa };
}
export function railsAndWelds(r) {
  const G = new THREE.Group(), list = r.rails || [], parts = [], welds = [], plates = [];
  for (const q of list) {
    const R = railPlace(r, q), { sec, y, yaw, nx, nz } = R;
    const g = new THREE.BoxGeometry(R.L, MM(sec.h), MM(sec.d));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(R.cx, y, R.cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
    parts.push(g);
    if (q.inline) {
      // each end on its plate: an embedded plate 120 × 120 × 8 in the pillar's face (a post: its own side), a
      // bead round the rail's end
      for (const [ex, ez, kind] of R.ends) {
        const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        if (kind === 'pillar') { const pl = new THREE.BoxGeometry(MM(8), MM(120), MM(120)); pl.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(ex, y, ez), rot, new THREE.Vector3(1, 1, 1))); pl.deleteAttribute('uv'); plates.push(pl); }
        const b = new THREE.BoxGeometry(MM(10), MM(sec.h + 6), MM(sec.d + 6)); b.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(ex - R.ux * MM(kind === 'pillar' ? -8 : -2), y, ez - R.uz * MM(kind === 'pillar' ? -8 : -2)), rot, new THREE.Vector3(1, 1, 1))); b.deleteAttribute('uv'); welds.push(b);
      }
      continue;
    }
    // a weld at every post it crosses: a bead along its top and its bottom edge at the post's face
    for (const p of r.pegs || []) if (p.post && p.s >= q.a - 1 && p.s <= q.b + 1) {
      const [px, pz] = pegXZ(r, p.s);
      for (const dy of [sec.h / 2, -sec.h / 2]) welds.push(bead(px + nx * MM(R.pa / 2 + sec.d * 0.35), y + MM(dy), pz + nz * MM(R.pa / 2 + sec.d * 0.35), yaw, MM(Math.min(p.post.a, 60) * 0.8)));
    }
  }
  // the joints: a rail starting where another ends on the same row — a bead round the butt
  for (const q of list) for (const o of list) if (o !== q && !q.inline && !o.inline && Math.abs(o.y - q.y) < 5 && Math.abs(o.b - q.a) < 2) {
    const sec = RAIL_SECS[q.sec] || RAIL_SECS.r4020, pa = postA(r), [x, z, ux, uz] = pegXZ(r, q.a), nx = -uz * (q.side || 1), nz = ux * (q.side || 1);
    const b = new THREE.BoxGeometry(MM(10), MM(sec.h + 6), MM(sec.d + 6)); b.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x + nx * MM(pa / 2 + sec.d / 2), r.g + MM(q.y), z + nz * MM(pa / 2 + sec.d / 2)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-uz, ux)), new THREE.Vector3(1, 1, 1)));
    b.deleteAttribute('uv'); welds.push(b);
  }
  if (parts.length) { const o = new THREE.Mesh(mergeGeometries(parts), steelM()); o.castShadow = true; o.receiveShadow = true; G.add(o); }
  if (welds.length) G.add(new THREE.Mesh(mergeGeometries(welds), weldM()));
  if (plates.length) G.add(new THREE.Mesh(mergeGeometries(plates), M('plate', () => std({ color: 0x6f6a64, roughness: 0.55, metalness: 0.6 }))));
  return G;
}
// a weld bead: a short rippled seam (a row of squashed beads)
function bead(x, y, z, yaw, len) {
  const gs = [], n = 5;
  for (let k = 0; k < n; k++) { const s = new THREE.SphereGeometry(MM(4.5), 6, 4); s.scale(1.3, 0.8, 1); s.translate(-len / 2 + len * (k + 0.5) / n, 0, 0); s.deleteAttribute('uv'); gs.push(s); }
  const g = mergeGeometries(gs);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
  return g;
}
// a rail carried by the finger (green: it goes there; red: not), or laid by the animation
export function railMesh(r, q, ok = true, ghost = true) {
  const R = railPlace(r, q);
  const o = new THREE.Mesh(new THREE.BoxGeometry(Math.max(MM(100), R.L), MM(R.sec.h), MM(R.sec.d)), ghost ? new THREE.MeshBasicMaterial({ color: ok ? 0x35d06a : 0xe0453a, transparent: true, opacity: 0.6, depthWrite: false }) : steelM());
  o.position.set(R.cx, R.y, R.cz); o.rotation.y = R.yaw;
  if (ghost) o.renderOrder = 6; else o.castShadow = true;
  return o;
}
// a post carried down into its hole by the animation
export function postMesh(r, q, post) {
  const g = gOf(r, q), a = MM(post.a), bot = q.hole === 'anchor' ? g + MM(10) : g - MM(HOLE.depth - 100), top = g + MM(post.h), L = top - bot, G = new THREE.Group();
  const o = new THREE.Mesh(post.sh === 'rd' ? new THREE.CylinderGeometry(a / 2, a / 2, L, 16) : new THREE.BoxGeometry(a, L, a), steelM()); o.position.y = (top + bot) / 2; o.castShadow = true; G.add(o);
  const [x, z, ux, uz] = pegXZ(r, q.s); G.position.set(x, 0, z); G.rotation.y = Math.atan2(-uz, ux);
  return G;
}

// ---- the earth auger: a one-man petrol auger (a 2-stroke 52 cc engine, a reduction gearbox, a
// wide frame with two grips and the throttle; a screw Ø 200 × 800, a fishtail point and two
// cutting blades). Local: the screw's tip at the origin, up the y axis; userData.screw turns.
export function earthAuger() {
  const G = new THREE.Group(), screw = new THREE.Group();
  const orange = std({ color: 0xe0661b, roughness: 0.42, metalness: 0.15 }), black = std({ color: 0x1b1c1e, roughness: 0.65 }), rubber = std({ color: 0x111111, roughness: 0.9 });
  const steel = std({ color: 0x8b9095, roughness: 0.32, metalness: 0.9 }), dark = std({ color: 0x3a3d40, roughness: 0.4, metalness: 0.8 }), alu = std({ color: 0xb9bdc1, roughness: 0.35, metalness: 0.85 });
  const fuel = std({ color: 0xf2efe6, roughness: 0.35, transparent: true, opacity: 0.85 }), red = std({ color: 0xb3261e, roughness: 0.5 });
  const add = (parent, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(MM(x), MM(y), MM(z)); o.rotation.set(rx, ry, rz); o.castShadow = true; parent.add(o); return o; };
  // the screw: the shaft Ø 40, the flight (a true helix, 2 turns per 300 mm), the point, the blades
  add(screw, new THREE.CylinderGeometry(MM(20), MM(20), MM(900), 12), steel, 0, 470);
  screw.add(new THREE.Mesh(helix(MM(21), MM(98), MM(150), MM(60), MM(820), MM(4)), Object.assign(steel.clone(), { side: THREE.DoubleSide })));
  add(screw, new THREE.ConeGeometry(MM(22), MM(70), 4), steel, 0, 25, 0, Math.PI, 0, 0);
  const fish = new THREE.BoxGeometry(MM(44), MM(60), MM(5)); add(screw, fish, dark, 0, 40, 0, 0, 0.3, 0);
  for (const s of [1, -1]) add(screw, new THREE.BoxGeometry(MM(80), MM(8), MM(30)), dark, s * 55, 58, 0, s * 0.35, 0, 0);
  // the hex coupling at the top of the shaft, the pin
  add(screw, new THREE.CylinderGeometry(MM(28), MM(28), MM(70), 6), dark, 0, 935);
  add(screw, new THREE.CylinderGeometry(MM(5), MM(5), MM(80), 6), steel, 0, 940, 0, 0, 0, Math.PI / 2);
  G.add(screw); G.userData.screw = screw;
  // the gearbox: an aluminium housing over the coupling
  add(G, new THREE.CylinderGeometry(MM(60), MM(70), MM(130), 16), alu, 0, 1030);
  add(G, new THREE.CylinderGeometry(MM(75), MM(75), MM(20), 16), dark, 0, 1100);
  // the frame: a steel tube bent into a wide U round the engine, rubber grips at its ends, the throttle
  const tube = new THREE.CatmullRomCurve3([[-380, 1120, 120], [-380, 1160, 0], [-300, 1180, -60], [0, 1190, -90], [300, 1180, -60], [380, 1160, 0], [380, 1120, 120]].map(([x, y, z]) => new THREE.Vector3(MM(x), MM(y), MM(z))));
  G.add(Object.assign(new THREE.Mesh(new THREE.TubeGeometry(tube, 40, MM(13), 8), black), { castShadow: true }));
  for (const s of [1, -1]) {
    add(G, new THREE.CylinderGeometry(MM(17), MM(17), MM(130), 10), rubber, s * 380, 1120, 175, Math.PI / 2);
    add(G, new THREE.BoxGeometry(MM(12), MM(60), MM(25)), red, s * 380, 1100, 160, 0.3);   // (the throttle lever / the stop switch)
  }
  add(G, new THREE.BoxGeometry(MM(60), MM(30), MM(40)), black, -150, 1175, -70);   // (the frame's clamp to the gearbox)
  add(G, new THREE.BoxGeometry(MM(60), MM(30), MM(40)), black, 150, 1175, -70);
  // the engine: the crankcase, the finned cylinder, the shroud, the fuel tank, the recoil starter,
  // the air filter, the muffler with its guard, the spark plug cap
  const E = new THREE.Group(); E.position.set(0, MM(1180), 0); G.add(E);
  add(E, new THREE.BoxGeometry(MM(170), MM(130), MM(150)), orange, 0, 70);
  for (let k = 0; k < 7; k++) add(E, new THREE.CylinderGeometry(MM(48), MM(48), MM(4), 16), alu, 0, 150 + k * 11, 0);
  add(E, new THREE.CylinderGeometry(MM(26), MM(28), MM(80), 12), alu, 0, 180);
  add(E, new THREE.BoxGeometry(MM(10), MM(28), MM(10)), black, 0, 240, 20, 0.6);   // (the plug cap)
  const shroud = new THREE.SphereGeometry(MM(95), 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); shroud.scale(1.05, 0.9, 0.95); add(E, shroud, orange, 0, 140, -10);
  add(E, new THREE.CylinderGeometry(MM(70), MM(70), MM(40), 20), black, -105, 85, 0, 0, 0, Math.PI / 2);   // (the starter)
  add(E, new THREE.BoxGeometry(MM(14), MM(40), MM(14)), red, -132, 85, 30);   // (its handle)
  const tank = new THREE.SphereGeometry(MM(75), 16, 10); tank.scale(1, 0.6, 0.9); add(E, tank, fuel, 0, 35, 120);
  add(E, new THREE.CylinderGeometry(MM(18), MM(18), MM(20), 12), black, 0, 75, 145);   // (the tank's cap)
  add(E, new THREE.BoxGeometry(MM(80), MM(70), MM(55)), black, 110, 110, 40);   // (the air filter)
  const muff = new THREE.CylinderGeometry(MM(38), MM(38), MM(110), 12); add(E, muff, dark, 95, 95, -95, 0, 0, Math.PI / 2);
  for (let k = 0; k < 5; k++) add(E, new THREE.BoxGeometry(MM(8), MM(90), MM(4)), black, 55 + k * 20, 95, -138);   // (its guard)
  G.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return G;
}
// a helical flight: a ribbon between radius r0 and r1, `pitch` per turn, from y0 to y1, thickness t
function helix(r0, r1, pitch, y0, y1, t) {
  const turns = (y1 - y0) / pitch, n = Math.ceil(turns * 40), pos = [], idx = [];
  for (let k = 0; k <= n; k++) {
    const a = k / n * turns * Math.PI * 2, y = y0 + (y1 - y0) * k / n, c = Math.cos(a), s = Math.sin(a);
    for (const [r, dy] of [[r0, 0], [r1, 0], [r0, t], [r1, t]]) pos.push(c * r, y + dy, s * r);
  }
  for (let k = 0; k < n; k++) {
    const b = k * 4, q = b + 4;
    idx.push(b, q, b + 1, b + 1, q, q + 1);          // the bottom face
    idx.push(b + 2, b + 3, q + 2, b + 3, q + 3, q + 2);   // the top face
    idx.push(b + 1, q + 1, b + 3, b + 3, q + 1, q + 3);   // the outer edge
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---- the welder's electrode holder (an inverter welder's): the insulated jaw, the cable, the rod; and
// the arc: a flickering blue-white light, the glowing tip, the sparks; the bead glowing as it is laid
export function welderKit() {
  const G = new THREE.Group(), holder = new THREE.Group();
  const black = std({ color: 0x171717, roughness: 0.7 }), red = std({ color: 0xa52019, roughness: 0.5 }), copper = std({ color: 0xb06a3a, roughness: 0.35, metalness: 0.8 });
  const rod = std({ color: 0x6f6b64, roughness: 0.6, metalness: 0.5 });
  const add = (p, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(MM(x), MM(y), MM(z)); o.rotation.set(rx, ry, rz); o.castShadow = true; p.add(o); return o; };
  // (local: the electrode's tip at the origin, the holder up and back along +y/+z)
  add(holder, new THREE.CylinderGeometry(MM(1.6), MM(1.6), MM(300), 6), rod, 0, 150, 0);
  add(holder, new THREE.BoxGeometry(MM(36), MM(30), MM(60)), copper, 0, 300, 0);
  add(holder, new THREE.CylinderGeometry(MM(20), MM(18), MM(210), 12), red, 0, 315, 120, Math.PI / 2 - 0.3);
  add(holder, new THREE.BoxGeometry(MM(14), MM(70), MM(18)), black, 0, 330, 10, 0.4);
  const cable = new THREE.CatmullRomCurve3([[0, 345, 225], [0, 360, 400], [0, 250, 700], [0, 80, 1100]].map(([x, y, z]) => new THREE.Vector3(MM(x), MM(y), MM(z))));
  holder.add(new THREE.Mesh(new THREE.TubeGeometry(cable, 20, MM(9), 6), black));
  G.add(holder); G.userData.holder = holder;
  // the arc's glow (no light source: a new light would make every material compile again — a stall);
  // a white core and a wide blue-white halo
  const halo = new THREE.Mesh(new THREE.SphereGeometry(MM(60), 12, 8), new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  G.add(halo); G.userData.halo = halo;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(MM(9), 10, 8), new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  G.add(glow); G.userData.glow = glow;
  // the sparks: little hot streaks thrown out and falling
  const N = 40, sp = new THREE.InstancedMesh(new THREE.BoxGeometry(MM(1.5), MM(1.5), MM(14)), new THREE.MeshBasicMaterial({ color: 0xffb347, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), N);
  sp.frustumCulled = false; G.add(sp);
  G.userData.sparks = { mesh: sp, list: Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 })) };
  return G;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _s = new THREE.Vector3(1, 1, 1);
// one frame of the arc at the kit's origin: on (0…1 how bright), dt
export function welderArc(kit, on, dt) {
  const { halo, glow, sparks } = kit.userData, f = on > 0 ? 0.6 + Math.random() * 0.4 : 0;
  halo.visible = glow.visible = on > 0; glow.scale.setScalar(0.6 + f * 0.8); halo.scale.setScalar(0.7 + f * 0.9);
  const g = -9.8 / MODEL_SCALE;
  let k = 0;
  for (const s of sparks.list) {
    if (s.life <= 0 && on > 0 && Math.random() < 0.5) { s.p.set(0, 0, 0); const a = Math.random() * Math.PI * 2, u = Math.random(); s.v.set(Math.cos(a) * (0.05 + u * 0.12), 0.05 + Math.random() * 0.15, Math.sin(a) * (0.05 + u * 0.12)); s.life = 0.25 + Math.random() * 0.45; }
    if (s.life > 0) { s.life -= dt; s.v.y += g * dt * 0.6; s.p.addScaledVector(s.v, dt); }
    _q.setFromUnitVectors(_z, s.v.lengthSq() > 0 ? s.v.clone().normalize() : _z);
    _m.compose(s.p, _q, s.life > 0 ? _s : _s.clone().setScalar(0));
    sparks.mesh.setMatrixAt(k++, _m);
  }
  sparks.mesh.instanceMatrix.needsUpdate = true;
}
// a bead being laid: hot orange, cooling to the steel's grey
export function hotBead(len, h) {
  const g = new THREE.CapsuleGeometry(MM(4.5), len, 4, 8); g.rotateZ(Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ color: 0x3a3632, emissive: 0xff7a1a, emissiveIntensity: 1.6, roughness: 0.6, metalness: 0.4 });
  const o = new THREE.Mesh(g, m); o.userData.h = h; return o;
}
void FENCE;
