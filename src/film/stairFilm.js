import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look } from './director.js';
import { loadPhysics, physicsReady } from '../world/physics.js';
import { findBelt, beltCage } from '../tools/belt.js';
import { IBIZA } from './foundFilm.js';

// «Ibiza», stage 2 — the stair wall and the pavilion (docs/ideas/ibiza.md; the foreman's plan and the owner's choices 2026-11-14;
// the director's shot table). It starts where stage 1 ended — the same plot, the same records (assets/films/ibiza-1.json.gz, made
// by scripts/film-start.mjs from the foundations film's last frame). In the order of a site: the damp-proof course torched down on
// the strip and round the slab's edge → the spine of cinder blocks 1190 (its back end stepping up, a tread 300 a course) and the
// pavilion's walls of aerated block 300 with brick piers between the openings, together, to one level → the ring beam over both
// (a joint between them — two foundations: the owner) → a week → the steps on up to 6,8 → the landing's beam. No windows yet, no
// scaffold, no hoist (the owner). Every close step is the game's own work (the torch, the trowel and the mallet, the hose); the far
// ones «at once» put the records down. The camera: close after the tool ↔ still and far for the scale (the owner: from above too,
// far, when something happens there).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const X0 = IBIZA.X0, ZB = 5750, ZS = -5750;   // (the spine's axis; its back (low) end and its sea end, mm)
const RUN = 300, NLOW = 16, NUP = 17;         // (the tread; the courses under the ring beam; over it)
const CB = { L: 390, H: 188, T: 190, J: 10, BED: 12, ROWS: 6 };   // (the cinder block: six across — a wall 1190)
// the pavilion: its walls on the slab's edges ([kind, along, outer face, from, to, gaps, inwards]), the brick piers between the
// glass openings of the front, the inner wall with a door
// (the slab as it was cast — measured from its concrete at the film's start: the walls stand on its very edge, not half over it —
// the owner saw a block hanging in the air; stage 1's boards stood inside the outline, the slab is a little smaller than drawn)
const IN = -1665;   // (the inner bearing wall's middle: under the front's first brick pier)
let SL = { ...IBIZA.slab }, FRONT, PAV;
function layout() {
FRONT = [[SL.x0, -4400], [-1920, -1410], [1070, 1580], [4060, SL.x1]];   // (block corners, brick piers — the openings 2,48 m between)
// (the corners bonded — the owner: «перехлёстом»: every other course the front and the back run through to the corner and the sides
// stop at them, on the next the sides run through; the inner wall, under the front's pier, ties into the back wall every other
// course: [kind, along, outer face, from, to, inwards, even course's ends trimmed [from, to], odd's]
PAV = [
  ['block', 'x', SL.z0, FRONT[0][0], FRONT[0][1], 1, [0, 0], [300, 0]], ['brick', 'x', SL.z0, FRONT[1][0], FRONT[1][1], 1, [0, 0], [0, 0]],
  ['brick', 'x', SL.z0, FRONT[2][0], FRONT[2][1], 1, [0, 0], [0, 0]], ['block', 'x', SL.z0, FRONT[3][0], FRONT[3][1], 1, [0, 0], [0, 300]],
  ['block', 'x', SL.z1, SL.x0, IN - 150, -1, [0, 0], [300, 300]], ['block', 'x', SL.z1, IN + 150, SL.x1, -1, [-300, 0], [300, 0]],
  ['block', 'z', SL.x0, SL.z0, SL.z1, 1, [300, 300], [0, 0]], ['block', 'z', SL.x1, SL.z0, SL.z1, -1, [300, 300], [0, 0]],
  ['block', 'z', IN, SL.z0 + 380, 800, 1, [0, 0], [0, 0]], ['block', 'z', IN, 1700, SL.z1, 1, [0, 300], [0, 0]],   // (the inner wall: a door 0,9 m)
];
}

// the spine's courses: [course k] → records, as a mason lays them (from the back on); course k starts at its tread `step`; the bond
// across every other course (headers); base — the top it stands on (y, model units)
function spineCourse(base, k, step, y0 = null) {
  const out = [], y = (y0 ?? base) + MM(CB.BED + (y0 == null ? k : 0) * (CB.H + CB.J) + CB.H / 2), a0 = -(ZB - step * RUN), a1 = -ZS;   // (along: −z → +a)
  const head = k % 2 === 1, n = head ? 3 : CB.ROWS, w = head ? CB.L : CB.T, along = head ? CB.T : CB.L, ZW = (CB.ROWS * CB.T + (CB.ROWS - 1) * CB.J) / 2;
  for (let r = 0; r < n; r++) {
    const x = -ZW + w / 2 + r * (w + CB.J), off = head ? (r % 2) * (along + CB.J) / 2 : ((k / 2 + r) % 2) * (CB.L + CB.J) / 2, cuts = [];
    let b = a1; if (off > 0) { cuts.push([a1 - (along - off), a1]); b = a1 - (along - off) - CB.J; }
    while (b - a0 > 1) { const rem = b - a0; if (rem <= along) { cuts.push([a0, b]); break; } if (rem < along + CB.J + 90) { const h = (rem - CB.J) / 2; cuts.push([b - h, b], [a0, a0 + h]); break; } cuts.push([b - along, b]); b -= along + CB.J; }
    for (const [lo, hi] of cuts.reverse()) out.push({ type: 'unit', kind: 'cinder', free: true, p: [MM(X0 + x), y, MM(-(lo + hi) / 2)], s: (head ? [CB.L, CB.H, hi - lo] : [hi - lo, CB.H, CB.T]).map(MM), q: head ? [0, 0, 0, 1] : [0, 0.70711, 0, 0.70711] });
  }
  return out.sort((p, q) => q.p[2] - p.p[2]);   // (from the back end toward the sea)
}
// the pavilion's walls course by course to one level with the spine (top — the spine's top, model units: the slab and the strip are
// not cast to one level — the beam must lie on both): blocks 12 courses + a course cut to what is left (253 a course on glue; the
// first on mortar 20), bricks 41 courses in piers 510 × 380 (a stretcher row and a header row, swapped each course), the joints eased
function pavilion(base, top) {
  const need = (top - base) / S, cut = Math.max(50, need - 3053 - 3), pitch = (need - 12 - 65) / 40;
  const out = [];
  for (const [kind, ax, fixed, A0, A1, inw, even, odd] of PAV) {
    const blk = kind === 'block';
    const crs = blk ? [...Array(12).keys()].map((k) => [20 + k * 253, 250, k]).concat([[3053 + 3, cut, 12]]) : [...Array(41).keys()].map((k) => [12 + k * pitch, 65, k]);
    for (const [y0, H, k] of crs) {
      const [t0, t1] = k % 2 ? odd : even, a0 = A0 + t0, a1 = A1 - t1;
      const rows = blk ? [[150, 300, 600, 3]] : (k % 2 ? [[60, 120, 250, 10], [255, 250, 120, 10]] : [[60, 120, 120, 10], [255, 250, 250, 10]]);
      // (bricks: [across from the face, its width across, its length along, joint]; a stretcher row and a header row swapped)
      for (const [r, wid, L, J] of (blk ? rows : rows.map((q, i) => (k % 2 ? q : [q[0], i ? 250 : 120, i ? 120 : 250, 10])))) {
        const off = blk ? (k % 2) * (L + J) / 2 : 0, w = fixed + inw * r;
        for (let a = a0 - off; a < a1; a += L + J) {
          const lo = Math.max(a, a0), hi = Math.min(a + L, a1); if (hi - lo < 40) continue;
          const m = (lo + hi) / 2, sz = [hi - lo, H, wid], y = base + MM(y0 + H / 2);
          out.push({ y: y0, rec: { type: 'unit', kind, free: true, p: ax === 'x' ? [MM(m), y, MM(w)] : [MM(w), y, MM(m)], s: (ax === 'x' ? sz : [sz[2], sz[1], sz[0]]).map(MM), q: [0, 0, 0, 1] } });
        }
      }
    }
  }
  return out.sort((p, q) => p.y - q.y).map((u) => u.rec);
}

export function* stairFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, st = app.settings, W = app.wallTool, G = app.concreteGear;
  Object.assign(st, { dayHour: 9.5, pump: 1.25, rebarD: 12, cover: 40 }); app.sky.setHour(9.5);
  d.lock = true; d.hand = 0.3;
  d.logo();
  d.money(true); d.byStages();
  // (stage 1's excavator parked at the plot's edge, past the fireplace's pad — out of the work's way, now and then in a wide shot (the
  // owner); it stood in two shots, a camera inside it)
  for (const r of O.all('vehicle')) O.remove(r.id);
  { const mt = app.machineTool, x = MM(-12600), z = MM(7400), yaw = 0.35;
    O.add({ type: 'vehicle', kind: 'excavator', x, z, yaw, swing: 0, boom: 0, stick: 0, curl: 0, load: 0 });
    let ok = false; mt.ensureExc?.().then(() => { ok = true; }).catch(() => { ok = true; }); yield d.until(() => ok);
    const E = mt.exc; if (E) { E.place(T, x, z, yaw); for (const k of ['swing', 'boom', 'stick', 'curl']) E[k] = E[k + 'Goal'] = 0; E.boom = E.boomGoal = 0.15; E.update(0); } }
  const g = T.heightAt(MM(-9000), MM(9000)), P = (x, y, z) => new V(MM(x), g + MM(y), MM(z)), idle = () => !app.busy();
  const sTop = T.heightAt(MM(X0), MM(0)), pTop = T.heightAt(MM(0), MM(1000));
  { const B0 = IBIZA.slab; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; const half = T.cell / S / 2 || 15;
    for (let i = 0; i < T.conc.length; i++) { if (T.conc[i] < MM(150)) continue; const x = T.toWorldX(i % T.nx) / S, z = T.toWorldZ(Math.floor(i / T.nx)) / S;
      if (x < B0.x0 - 400 || x > B0.x1 + 400 || z < B0.z0 - 400 || z > B0.z1 + 400) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    // (the outermost cells' middles → their edges, less a hair: the block's face flush with the slab's)
    if (x1 > x0) SL = { ...B0, x0: Math.round(x0 - half + 5), x1: Math.round(x1 + half - 5), z0: Math.round(z0 - half + 5), z1: Math.round(z1 + half - 5) };
    layout(); }   // (the strip's top and the slab's: stage 1's concrete)
  const say = (m) => { (d.notes = d.notes || []).push([+d.t.toFixed(1), m]); };
  const hud = (row1, i, row2, tool) => d.hud([row1.map((t, k) => (k === i ? '*' + t : t)), ...(row2 ? [row2] : [])], tool);
  loadPhysics().catch(() => {});
  // ---- the camera (as in stage 1): a still shot list cut by the film's clock, or a tripod panning after the tool ----
  let shotN = 0, tool = () => null;
  const shots = (list) => { const id = ++shotN; let i = -1, t1 = -1; const f = () => { if (id !== shotN) return true; if (d.t >= t1) { i = (i + 1) % list.length; const [sec, e, a] = list[i]; d.cut(look(P(...e), P(...a)), { drift: 0.006, push: 0.008, hand: 0.2 }); t1 = d.t + sec; } return false; }; f(); d.each(f); };
  const act = (list) => {
    const id = ++shotN; let k = -1, t1 = -1, eye = null, aim = null, sp = 1;
    const f = () => {
      if (id !== shotN) return true;
      const p = tool(); if (!p) return false;
      if (d.t >= t1 || !eye) {
        k++; const L = list.length, i = k < L ? k : L - 2 + ((k - L) % 2), [sec, [dx, dy, dz], v] = list[Math.max(0, i)];
        eye = new V(p.x + MM(dx), p.y + MM(dy), p.z + MM(dz)); aim = p.clone(); sp = v;
        d.cut(look(eye, aim), { drift: 0.004, push: 0.006, hand: 0.2 }); t1 = d.t + sec;
      } else { aim.lerp(p, 1 - Math.exp(-d.dt * 2.5)); const vw = look(eye, aim); if (d.shot) d.shot.goal = d.shot.from = d._full(vw, d.shot.goal); }
      d.speed = sp; return false;
    };
    f(); d.each(f);
  };
  const still = () => { ++shotN; };
  const tick = (n = 1) => app.sfx?.seq?.(Array(n).fill('block'));

  // ---- 1 · the damp-proof course: the spine's strip 1300 (two strips lapped), the slab's edges 400 ----
  hud(['DPC', 'Cinder', 'Gas block', 'Brick'], 0, null, 'wall');
  st.wallKind = 'dpc'; app.setTool('wall'); W.setMode('lay');
  const dpc = W.dpc, lay = (a, b, w) => { st.dpcW = w; const y = T.heightAt(MM(a[0]), MM(a[1])); dpc.down({ x: MM(a[0]), y, z: MM(a[1]) }); dpc.move({ x: MM(b[0]), y, z: MM(b[1]) }); dpc.up(); };
  lay([X0, ZB + 150], [X0, ZS - 150], 1300);
  tool = () => { const Tt = app.dpcView?.work?.T; return Tt?.visible !== false && Tt ? Tt.position.clone() : null; };
  act([[2.0, [1400, 600, 1600], 1], [1.8, [-1700, 1000, -2200], 3], [1.4, [3200, 2200, 3000], 6]]);
  yield d.sec(5.2);
  still();
  d.jumpTo(() => !dpc.jobs.length, 2000);
  // the pavilion's strips: one after another, seen from far and high — the whole footprint (the owner: from above, far, for the scale)
  shots([[9, [-14000, 13000, -12000], [500, 0, 1000]]]);
  // (the ends 60 in from the slab's edge: a line ending on its very edge is «off the concrete»)
  const z0 = SL.z0 + 150, z1 = SL.z1 - 150, xa = SL.x0 + 150, xb = SL.x1 - 150, e0 = SL.x0 + 60, e1 = SL.x1 - 60;
  for (const [a, b] of [[[e0, z0], [e1, z0]], [[e0, z1], [e1, z1]], [[xa, SL.z0 + 60], [xa, SL.z1 - 60]], [[xb, SL.z0 + 60], [xb, SL.z1 - 60]], [[IN, SL.z0 + 380], [IN, SL.z1 - 300]]]) {
    lay(a, b, 400); d.jumpTo(() => !dpc.jobs.length, 600); app.sfx?.play?.('fabric', { vol: 0.5 }); yield d.sec(0.32);
  }
  app.budget._pay?.([{ usd: 6 * 0.4 * 47 + 1.3 * 11.8 * 9 }], P(0, 0, 0));
  d.stageBill('DPC MEMBRANE');
  yield d.sec(1.0);

  // ---- 2 · the masonry: the first cinder block close (the game's job), the course along the spine; the first aerated block, its
  // course; a brick pier; then all of it rising together — to one level ----
  const spineLow = [...Array(NLOW).keys()].map((k) => spineCourse(sTop + MM(3), k, k));
  const pav = pavilion(pTop + MM(3), sTop + MM(3 + CB.BED + (NLOW - 1) * (CB.H + CB.J) + CB.H));
  hud(['DPC', 'Cinder', 'Gas block', 'Brick'], 1, ['*By hand', 'Course'], 'wall');
  st.wallKind = 'cinder';
  yield d.until(() => physicsReady());
  const first = spineLow[0].find((r) => r.p[0] > MM(X0 + 400)) || spineLow[0][0];
  let laidN = 0;
  const job = (rec, fast) => { if (app.physJob) return false; if (W.layUnit(rec, fast)) { laidN++; tool = () => new V().fromArray(rec.p); return true; } return false; };
  tool = () => new V().fromArray(first.p);
  act([[3.0, [1200, 500, 1400], 1]]);
  yield d.until(() => job(first, false));
  yield d.until(idle);
  // (the course on along the outer face toward the sea: ×3)
  const row = spineLow[0].filter((r) => Math.abs(r.p[0] - first.p[0]) < MM(5) && r !== first).sort((p, q) => q.p[2] - p.p[2]).slice(0, 8);
  act([[2.2, [2400, 900, -600], 3]]);
  for (const r of row) { yield d.until(() => job(r, true)); }
  yield d.until(idle);
  // the first aerated block — the pavilion's front corner, from inside the slab toward the sea
  hud(['DPC', 'Cinder', 'Gas block', 'Brick'], 2, ['*By hand', 'Course'], 'wall');
  const pBlocks = pav.filter((r) => r.kind === 'block'), b0 = pBlocks.filter((r) => Math.abs(r.p[1] - pBlocks[0].p[1]) < MM(5)).sort((p, q) => (q.p[0] - p.p[0]) || (p.p[2] - q.p[2]));
  const fb = b0.filter((r) => Math.abs(r.p[2] - MM(SL.z0 + 150)) < MM(5));
  tool = () => new V().fromArray(fb[0].p);
  act([[1.6, [-1300, 700, 1200], 1], [1.4, [600, 1000, -2600], 3]]);
  yield d.until(() => job(fb[0], false)); yield d.until(idle);
  for (const r of fb.slice(1, 6)) { yield d.until(() => job(r, true)); }
  yield d.until(idle);
  // a brick pier
  hud(['DPC', 'Cinder', 'Gas block', 'Brick'], 3, ['*By hand', 'Course'], 'wall');
  const pier = pav.filter((r) => r.kind === 'brick' && r.p[0] < MM(-1000));   // (the pier the inner wall stands against)
  tool = () => new V().fromArray(pier[0].p);
  act([[1.4, [-900, 900, -1100], 1], [1.2, [1500, 1300, -1800], 4]]);
  for (const r of pier.slice(0, 6)) { yield d.until(() => job(r, r !== pier[0])); }
  yield d.until(idle);
  still();
  // all of it rising together, by the share of the height (the director: else the bricks — 41 courses — look faster than the blocks)
  const done = new Set([first, ...row, ...fb.slice(0, 6), ...pier.slice(0, 6)]);
  const all = [...spineLow.flat(), ...pav].filter((r) => !done.has(r));
  const lvl = (r) => (r.p[1] - (r.kind === 'cinder' ? sTop : pTop)) / MM(3170);
  all.sort((p, q) => lvl(p) - lvl(q));
  shots([[3.2, [-9000, 3000, -8500], [1500, 1200, 1500]], [1.6, [16000, 15000, 12000], [1000, 1500, 0]]]);
  { let i = 0; const n = all.length, dur = 4.6, t0 = d.t;
    yield d.until(() => { const want = Math.min(n, Math.ceil(n * Math.min(1, (d.t - t0) / dur))); if (want > i) { for (; i < want; i++) O.add(all[i]); tick(1); } return i >= n; }); }
  app.budget._pay?.([{ usd: (O.all('unit').filter((u) => u.kind === 'cinder').length * 2.2 + pav.length * 3.1) }], P(0, 0, 0));
  d.stageBill('BLOCKS & BRICKS');
  yield d.sec(1.2);
  say('masonry ' + O.all('unit').length);

  // ---- 3 · the ring beam over both, at one level (a joint between them — they stand on two foundations): its boards, its cage,
  // the concrete by the hose, the poker ----
  hud(['Formwork', 'Rebar', 'Concrete'], 0, null, 'wall');
  const topS = Math.max(...O.all('unit').filter((u) => u.kind === 'cinder').map((u) => u.p[1] + u.s[1] / 2));
  const B = findBelt(app, new V(MM(X0), topS, MM(-3000)));
  say('belt ' + (B ? `${B.rec.ni}×${B.rec.nj}` : 'none'));
  let beltId = null;
  if (B) {
    B.rec.H = MM(200);   // (a course high: the step over it no taller than the rest — the foreman)
    shots([[1.4, [7600, 3900, -2400], [6000, 3300, -5000]], [1.2, [-12000, 14000, 12000], [1000, 3000, 0]]]);
    app.sfx?.seq?.(['plank', 'plank', 'hammer_nail', 'plank', 'hammer_nail']);
    app.journal.act('belt', {}, app.clock, () => { beltId = O.add(B.rec).id; });
    yield d.sec(2.6);
    hud(['Formwork', 'Rebar', 'Concrete'], 1, null, 'wall');
    shots([[1.2, [7200, 4200, -4000], [6000, 3300, -5200]]]);
    app.sfx?.seq?.(['rebar', 'wire', 'wire']);
    app.journal.act('belt-cage', {}, app.clock, () => O.add(beltCage(O.get(beltId))));
    yield d.sec(1.2);
    // the concrete: the hose along the spine's beam, then round the pavilion's (the poker after it)
    hud(['Formwork', 'Rebar', 'Concrete'], 2, ['*Hose', 'Vibrator'], 'hose');
    const hose = app.concreteTools.hose, yb = topS + MM(200);
    const pts = [[X0, -5600], [X0, 1100], [SL.x1 - 150, SL.z0 + 150], [SL.x0 + 150, SL.z0 + 150], [SL.x0 + 150, SL.z1 - 150], [SL.x1 - 150, SL.z1 - 150], [SL.x1 - 150, SL.z0 + 150]];
    const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), tot = segs.reduce((a, b) => a + b, 0);
    const path = (u) => { let s = u * tot, i = 0; while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; } const a = pts[i], b = pts[i + 1], f = Math.min(1, s / segs[i]); return new V(MM(a[0] + (b[0] - a[0]) * f), yb, MM(a[1] + (b[1] - a[1]) * f)); };
    app.setTool('hose');
    const ev = (q) => ({ target: beltId, hit: q });
    st.pump = 1e-5; { const p0 = path(0); hose.down(p0, ev(p0)); let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(p0, ev(p0)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - p0.x, sp.z - p0.z) < MM(250)); }); }
    st.pump = 3;
    tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
    act([[1.6, [1800, 600, 1600], 1], [1.4, [-2000, 1100, -1800], 3], [1.2, [3000, 2000, -3500], 6]]);
    let pt = 0; const TP = 60, t0 = d.t;
    yield d.until(() => { pt += d.dt * d.speed; const q = path(Math.min(1, pt / TP)); hose.move(q, ev(q)); T.vibrate?.(q.x, q.z, MM(1500)); return !!hose.ch?.full || d.t - t0 > 4.6; });
    hose.up(); d.speed = 4; yield d.until(idle); d.speed = 1; G.set?.(null);
    still();
    // (the rest of the pour between two shots — the crew's hour: the beam full, worked level)
    { const b = O.get(beltId); if (b) app.journal.act('belt-pour', {}, app.clock, () => O.update(beltId, { lv: b.lv.map(() => b.H / S), sm: b.lv.map(() => 0.9), fill: 1 })); }
    say('belt fill ' + O.get(beltId)?.fill);
  }
  d.stageBill('RING BEAM 3.4');
  // ---- a week: the beam sets, its boards off ----
  d.hud(null);
  shots([[9, [-16000, 18000, 14000], [1500, 2000, 0]]]);
  yield* d.lapse(7, 1.6, () => { app.clock += 9000 * d.dt / 1.6; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  if (beltId != null) app.journal.act('belt-strip', {}, app.clock, () => O.update(beltId, { stripped: true }));
  d.kick('+7 DAYS', 1.2, 'top');

  // ---- 4 · the steps on up: the first block over the beam close, its course; then the courses one by one in profile ----
  const bTop = beltId != null ? O.get(beltId).top + O.get(beltId).H : topS + MM(200);
  const spineUp = [...Array(NUP).keys()].map((j) => spineCourse(sTop, NLOW + j, NLOW + j, bTop + MM(j * (CB.H + CB.J))));
  hud(['Cinder', 'Formwork', 'Concrete'], 0, ['*By hand', 'Course'], 'wall');
  st.wallKind = 'cinder'; app.setTool('wall'); W.setMode('lay');
  const u0 = spineUp[0][0];
  tool = () => new V().fromArray(u0.p);
  act([[1.6, [1300, 500, 1300], 1], [1.2, [-1600, 900, -1200], 3]]);
  yield d.until(() => job(u0, false)); yield d.until(idle);
  for (const r of spineUp[0].slice(1, 6)) { yield d.until(() => job(r, true)); }
  yield d.until(idle);
  still();
  const rest = spineUp.flat().filter((r) => r !== u0 && !spineUp[0].slice(1, 6).includes(r));
  shots([[9, [15500, 4300, 500], [6000, 4300, -500]]]);
  { let i = 0; const n = rest.length, dur = 2.6, t0 = d.t;
    yield d.until(() => { const want = Math.min(n, Math.ceil(n * Math.min(1, (d.t - t0) / dur))); if (want > i) { for (; i < want; i++) O.add(rest[i]); tick(1); } return i >= n; }); }
  // ---- 5 · the landing's beam on the 34th step: boards and cage at once, the concrete ----
  const topU = Math.max(...O.all('unit').filter((u) => u.kind === 'cinder').map((u) => u.p[1] + u.s[1] / 2));
  const B2 = findBelt(app, new V(MM(X0), topU, MM(-5200)));
  let landId = null;
  if (B2) {
    B2.rec.H = MM(200);
    shots([[1.2, [18000, 16000, 6000], [5000, 3500, -1000]]]);
    app.sfx?.seq?.(['plank', 'hammer_nail', 'rebar']);
    app.journal.act('belt', {}, app.clock, () => { landId = O.add(B2.rec).id; O.add(beltCage(O.get(landId))); });
    yield d.sec(0.7);
    const hose = app.concreteTools.hose, yb = topU + MM(200), ev = (q) => ({ target: landId, hit: q });
    app.setTool('hose'); hud(['Cinder', 'Formwork', 'Concrete'], 2, ['*Hose', 'Vibrator'], 'hose');
    const a = new V(MM(X0), yb, MM(-4300)), b = new V(MM(X0), yb, MM(-5600));
    st.pump = 1e-5; hose.down(a, ev(a)); { let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(a, ev(a)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - a.x, sp.z - a.z) < MM(250)); }); }
    st.pump = 2; tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
    act([[1.0, [1800, 700, 1800], 3], [0.9, [-2200, 1400, -1600], 6]]);
    let pt = 0; const t0 = d.t; yield d.until(() => { pt += d.dt * d.speed; const q = a.clone().lerp(b, 0.5 + 0.5 * Math.sin(pt * 0.6)); hose.move(q, ev(q)); T.vibrate?.(q.x, q.z, MM(1200)); return !!hose.ch?.full || d.t - t0 > 1.9; });
    hose.up(); d.speed = 4; yield d.until(idle); d.speed = 1; G.set?.(null);
    still();
    { const r = O.get(landId); if (r) app.journal.act('belt-pour', {}, app.clock, () => O.update(landId, { lv: r.lv.map(() => r.H / S), sm: r.lv.map(() => 0.9), fill: 1 })); }
  }
  shots([[9, [15500, 5600, -9500], [6000, 4300, -1500]]]);
  app.budget._pay?.([{ usd: rest.length * 2.2 + 900 }], P(0, 0, 0));
  d.stageBill('STEPS & LANDING');
  yield d.sec(1.0);
  d.next();
  // ---- the hook (put first by the recorder): the rule over the fresh landing at 6,8, low on the stair's axis, the sea beyond ----
  shotN++;
  d.cut(look(P(6700, 7600, -1200), P(6000, 6900, -5000)), { drift: 0.01, push: 0.012, hand: 0.3 });
  yield d.sec(0.4);
  d.mark('hook');
  d.kick('STAIRS TO NOWHERE?', 2.2, 'top');
  { const r = landId != null && O.get(landId); if (r) { const t0 = d.t; yield d.until(() => { const u = (d.t - t0) / 2.2; app.sfx?.play?.('screed', { vol: 0.5, gap: 0.5 }); return u >= 1; }); } else yield d.sec(2.2); }
  d.mark('hookEnd');
  d.stair = { units: O.all('unit').length, cinder: O.all('unit').filter((u) => u.kind === 'cinder').length, belts: O.all('belt').length, dpc: O.all('dpc').length, beltId, landId, laidN };
  yield d.sec(0.1);
}
stairFilm.seconds = 45;
stairFilm.place = 'beach';
stairFilm.start = 'assets/films/ibiza-1.json.gz';
stairFilm.sounds = ['block', 'brick', 'trowel', 'trowel_tap', 'mallet', 'tap', 'till', 'cash', 'torch', 'fabric', 'plank', 'hammer_nail', 'rebar', 'wire', 'pump', 'concrete', 'vibrator', 'screed', 'waves', 'wind', 'birds'];
