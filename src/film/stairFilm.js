import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look } from './director.js';
import { loadPhysics, physicsReady } from '../world/physics.js';
import { findBelt, beltCage, beltsOverlap, plan, toWorld } from '../tools/belt.js';
import { IBIZA } from './foundFilm.js';
import { placeLintelForm } from '../tools/lintels.js';

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
    const x = -ZW + w / 2 + r * (w + CB.J), off = head ? ((r + 1) % 2) * (along + CB.J) / 2 : ((k / 2 + r) % 2) * (CB.L + CB.J) / 2, cuts = [];   // (headers at the faces shifted ¼ — the realist: else the joints ran through two courses)
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
      // (bricks — a pier 1½: [across from the face, its width across, its length along, joint, its row's shift]; a stretcher course —
      // stretchers at the face, headers behind; the next — headers at the face (shifted ¼), stretchers behind (shifted ½): no joint over a
      // joint (the realist: the courses were all alike — a joint up the pier's middle))
      const rows = blk ? [[150, 300, 600, 3, (k % 2) * 301.5]] : (k % 2 ? [[125, 250, 120, 10, 65], [320, 120, 250, 10, 125]] : [[60, 120, 250, 10, 0], [255, 250, 120, 10, 0]]);
      for (const [r, wid, L, J, off] of rows) {
        const w = fixed + inw * r;
        // (from the wall's corner A0, not from the trimmed start: the realist — the trim of the corner and the shift of the course
        // cancelled each other, the joints one over another the whole height)
        for (let a = (blk ? A0 : a0) - off; a < a1; a += L + J) {
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
  // (the analyst and the owner, 2026-11-15: the stage's own pencil sketch pinned in the corner — the goal of this film, no more; at
  // the end it grows to the frame over the same view and washes into the real thing: «the plan came true». Made from the film's own
  // last frame (scratchpad sketch filter) — the lines fall on the real ones)
  const sk = document.createElement('img'); sk.className = 'f-sketch'; sk.src = 'assets/films/ibiza-2-sketch-card.png'; sk.alt = ''; d.el.appendChild(sk);
  const pin = document.createElement('img'); pin.className = 'f-pin'; pin.src = 'assets/films/sketch-pin.png'; pin.alt = ''; d.el.appendChild(pin);   // (its own picture: taken out first at the end — the realist)
  const bill = (label) => { d.stageBill(label); sk.style.opacity = pin.style.opacity = '0.35'; const t1 = d.t + 1.4; d.each(() => { if (d.t < t1) return false; sk.style.opacity = pin.style.opacity = ''; return true; }); };   // (under the bill's card: the sheet dimmed)
  d.money(true); d.byStages();
  // (stage 1's excavator parked at the plot's edge, past the fireplace's pad — out of the work's way, now and then in a wide shot (the
  // owner); it stood in two shots, a camera inside it)
  for (const r of O.all('vehicle')) O.remove(r.id);
  { const mt = app.machineTool, x = MM(-12600), z = MM(7400), yaw = 0.35;
    O.add({ type: 'vehicle', kind: 'excavator', x, z, yaw, swing: 0, boom: 0, stick: 0, curl: 0, load: 0 });
    let ok = false; mt.ensureExc?.().then(() => { ok = true; }).catch(() => { ok = true; }); yield d.until(() => ok);
    const E = mt.exc; if (E) { E.place(T, x, z, yaw); for (const k of ['swing', 'boom', 'stick', 'curl']) E[k] = E[k + 'Goal'] = 0; E.boom = E.boomGoal = 0.15; E.update(0); } }
  const g = T.heightAt(MM(-9000), MM(9000)), P = (x, y, z) => new V(MM(x), g + MM(y), MM(z)), idle = () => !app.busy();
  // (the walls set out level from the HIGHEST point of the concrete under them — the owner saw a brick and a block «in the air»: the
  // slab and the strip are not cast dead flat, a course set from one point in the middle stood over the lower edge; as on site the
  // first bed takes up the difference — thicker where the concrete is lower)
  const hi = (pts) => Math.max(...pts.map(([x, z]) => T.heightAt(MM(x), MM(z))));
  const sTop = hi([...Array(25).keys()].flatMap((i) => [[X0 - 500, ZB - i * 480], [X0, ZB - i * 480], [X0 + 500, ZB - i * 480]]));
  const pTop = hi([...Array(21).keys()].flatMap((i) => { const x = IBIZA.slab.x0 + 100 + i * 470, z = IBIZA.slab.z0 + 100 + i * 315; return [[x, IBIZA.slab.z0 + 150], [x, IBIZA.slab.z1 - 150], [IBIZA.slab.x0 + 150, z], [IBIZA.slab.x1 - 150, z]]; }));
  // (the slab measured by its own concrete: the cells joined to its middle — flood fill — not all thick concrete near its outline:
  // the pool's shell lies 0,4 m off its front and was taken in, the walls set out in the gap between the two (the owner: «the brick
  // is between the foundations»))
  { const B0 = IBIZA.slab; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; const half = T.cell / S / 2 || 15;
    const start = T.index(MM((B0.x0 + B0.x1) / 2), MM((B0.z0 + B0.z1) / 2)), seen = new Uint8Array(T.conc.length), st = [start]; seen[start] = 1;
    while (st.length) {
      const i = st.pop(), ix = i % T.nx, iz = Math.floor(i / T.nx), x = T.toWorldX(ix) / S, z = T.toWorldZ(iz) / S;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= T.nx || jz >= T.nz) continue; const j = jz * T.nx + jx; if (!seen[j] && T.conc[j] > MM(150)) { seen[j] = 1; st.push(j); } }
    }
    // (the outermost cells' middles → their edges, less a hair: the block's face flush with the slab's)
    if (x1 > x0 && x1 - x0 < (B0.x1 - B0.x0) + 600) SL = { ...B0, x0: Math.round(x0 - half + 5), x1: Math.round(x1 + half - 5), z0: Math.round(z0 - half + 5), z1: Math.round(z1 + half - 5) };
    (d.notes = d.notes || []).push([0, 'slab as cast ' + JSON.stringify([SL.x0, SL.x1, SL.z0, SL.z1])]);
    layout(); }   // (the strip's top and the slab's: stage 1's concrete)
  // (the share of frames with the stream over the last ~half second — it flickers where the concrete runs out of room: on, off)
  let wetE = 1; const dry = () => { wetE = wetE * 0.8 + (G.pump?.stream?.visible ? 0.2 : 0); return wetE < 0.5 ? 1 : 0; }, wet0 = () => { wetE = 1; };
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
  const s0 = new V(MM(X0), T.heightAt(MM(X0), MM(ZB)) + MM(100), MM(ZB));   // (the roll's start: the camera there from the first frame)
  tool = () => { const Tt = app.dpcView?.work?.T; return Tt?.visible !== false && Tt ? Tt.position.clone() : s0.clone(); };
  // (the owner's rule for rolled materials, 2026-11-15: the first shot — the work itself at its pace; the next ones — the roll unrolling
  // faster and faster, smoothly — never a jump to it done)
  const roll = function* (t1, k, vmax) { const t0 = d.t; yield d.until(() => { const v = d.t - t0 < t1 ? 1 : Math.min(vmax, Math.exp(k * (d.t - t0 - t1))); for (const J of dpc.jobs) J.speed = v; return !dpc.jobs.length; }); };
  // (the 2–10 s after the hook: the work close, the tool in the frame — never a wide grey frame: the first film lost 30 % there)
  act([[1.3, [900, 350, 1100], 1], [1.4, [-1700, 1000, -2200], 1], [1.6, [2200, 1400, 2000], 1], [9, [-1600, 1300, 2400], 1]]);
  yield* roll(1.2, 1.9, 420);
  still();
  // the pavilion's strips: one after another, unrolling fast, seen from far and high — the whole footprint (the owner: from above, far,
  // for the scale)
  act([[9, [2600, 2300, 2800], 1]]);   // (the torch followed over the pavilion's strips, near — not the whole site from high)
  // (the ends 60 in from the slab's edge: a line ending on its very edge is «off the concrete»)
  // (under the front 480 — its brick piers are 380; the rest 400; 25 mm out past the slab's edge — the realist)
  const z0 = SL.z0 + 215, z1 = SL.z1 - 175, xa = SL.x0 + 175, xb = SL.x1 - 175, e0 = SL.x0 + 60, e1 = SL.x1 - 60;
  for (const [a, b, w] of [[[e0, z0], [e1, z0], 480], [[e0, z1], [e1, z1], 400], [[xa, SL.z0 + 60], [xa, SL.z1 - 60], 400], [[xb, SL.z0 + 60], [xb, SL.z1 - 60], 400], [[IN, SL.z0 + 380], [IN, SL.z1 - 300], 400]]) {
    lay(a, b, w); const t0 = d.t; yield d.until(() => { const v = Math.min(450, 60 * Math.exp(4.5 * (d.t - t0))); for (const J of dpc.jobs) J.speed = v; return !dpc.jobs.length; });
    app.sfx?.play?.('fabric', { vol: 0.5 });
  }
  app.budget._pay?.([{ usd: 6 * 0.4 * 47 + 1.3 * 11.8 * 9 }], P(0, 0, 0));

  // ---- 2 · the masonry: the first cinder block close (the game's job), the course along the spine; the first aerated block, its
  // course; a brick pier; then all of it rising together — to one level ----
  const spineLow = [...Array(NLOW).keys()].map((k) => spineCourse(sTop + MM(3), k, k));
  const pav = pavilion(pTop + MM(3), sTop + MM(3 + CB.BED + (NLOW - 1) * (CB.H + CB.J) + CB.H));
  // (the first course's bed down to the concrete and the membrane under each unit: what the slab lacks there, the mortar takes up)
  const fit = (r) => { const bot = r.p[1] - r.s[1] / 2, under = T.heightAt(r.p[0], r.p[2]) + MM(3.4), bed = bot - under; if (bed < MM(60) && bed > MM(4)) r.bedT = +bed.toFixed(6); };
  for (const r of [...spineLow[0], ...pav.filter((q) => q.p[1] - q.s[1] / 2 - pTop < MM(40))]) fit(r);
  hud(['DPC', 'Cinder', 'Gas block', 'Brick'], 1, ['*By hand', 'Course'], 'wall');
  st.wallKind = 'cinder';
  yield d.until(() => physicsReady());
  // (one block of a low step held back: the hook's action — laid there by the mallet, close in the foreground (the analyst: the hook
  // must move))
  const hold = spineLow[3][0];
  const first = spineLow[0].find((r) => r.p[0] > MM(X0 + 400)) || spineLow[0][0];
  let laidN = 0;
  const job = (rec, fast) => { if (app.physJob) return false; if (W.layUnit(rec, fast, rec.bedT ? rec.bedT / S : rec.kind === 'block' ? 20 : 12)) {   /* (the first course of blocks on 20 of mortar) */ laidN++; tool = () => new V().fromArray(rec.p); return true; } return false; };
  tool = () => new V().fromArray(first.p);
  act([[2.4, [1200, 500, 1400], 1]]);
  yield d.until(() => job(first, false));
  bill('DPC MEMBRANE');   // (over the first block's laying, past the 10th second — the analyst)
  yield d.until(idle);
  // (the course on along the outer face toward the sea: ×3)
  const row = spineLow[0].filter((r) => Math.abs(r.p[0] - first.p[0]) < MM(5) && r !== first).sort((p, q) => q.p[2] - p.p[2]).slice(0, 5);
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
  for (const r of fb.slice(1, 4)) { yield d.until(() => job(r, true)); }
  yield d.until(idle);
  // a brick pier
  hud(['DPC', 'Cinder', 'Gas block', 'Brick'], 3, ['*By hand', 'Course'], 'wall');
  const pier = pav.filter((r) => r.kind === 'brick' && r.p[0] < MM(-1000));   // (the pier the inner wall stands against)
  tool = () => new V().fromArray(pier[0].p);
  act([[1.4, [-900, 900, -1100], 1], [1.2, [1500, 1300, -1800], 4]]);
  for (const r of pier.slice(0, 4)) { yield d.until(() => job(r, r !== pier[0])); }
  yield d.until(idle);
  still();
  // all of it rising together, by the share of the height (the director: else the bricks — 41 courses — look faster than the blocks)
  const done = new Set([first, ...row, ...fb.slice(0, 4), ...pier.slice(0, 4)]);
  const all = [...spineLow.flat(), ...pav].filter((r) => !done.has(r) && r !== hold);
  const lvl = (r) => (r.p[1] - (r.kind === 'cinder' ? sTop : pTop)) / MM(3170);
  all.sort((p, q) => lvl(p) - lvl(q));
  shots([[2.0, [-9000, 3000, -8500], [1500, 1200, 1500]], [1.6, [16000, 15000, 12000], [1000, 1500, 0]]]);
  { let i = 0; const n = all.length, dur = 3.4, t0 = d.t;
    yield d.until(() => { const want = Math.min(n, Math.ceil(n * Math.min(1, (d.t - t0) / dur))); if (want > i) { for (; i < want; i++) O.add(all[i]); tick(1); } return i >= n; }); }
  app.budget._pay?.([{ usd: (O.all('unit').filter((u) => u.kind === 'cinder').length * 2.2 + pav.length * 3.1) }], P(0, 0, 0));
  bill('BLOCKS & BRICKS');
  say('masonry ' + O.all('unit').length);

  // ---- 3 · the ring beam over both, at one level (a joint between them — they stand on two foundations): its boards, its cage,
  // the concrete by the hose, the poker ----
  hud(['Formwork', 'Rebar', 'Concrete'], 0, null, 'wall');
  const topS = Math.max(...O.all('unit').filter((u) => u.kind === 'cinder').map((u) => u.p[1] + u.s[1] / 2));
  const B = findBelt(app, new V(MM(X0), topS, MM(-3000)));
  say('belt ' + (B ? `${B.rec.ni}×${B.rec.nj}` : 'none'));
  // (the pavilion's walls: a ring of their own — they stand apart from the spine (a gap between the two foundations): the beam found
  // from the spine's top does not reach them (the realist: the pavilion stood bare under a bill «RING BEAM»); over its openings the
  // beam is a lintel on props)
  const topP = Math.max(...O.all('unit').filter((u) => u.kind === 'block').map((u) => u.p[1] + u.s[1] / 2));
  const BP = findBelt(app, new V(MM(0), topP, MM(SL.z1 - 150)));
  say('pavilion belt ' + (BP ? `${BP.rec.ni}×${BP.rec.nj}` : 'none'));
  let beltId = null, pavId = null; const lintels = [];
  if (B) {
    B.rec.H = MM(200);   // (a course high: the step over it no taller than the rest — the foreman)
    const WV = app.wallView, RV = app.rebarView;
    // the formwork going up board by board (the owner: «no process of the formwork» — the game's own reveal, as the pool's boards)
    const rise = function* (view, id, dur, snd) { const t0 = d.t; let k = 0; yield d.until(() => { const u = Math.min(1, (d.t - t0) / dur); view.reveal = { id, u }; view.dirty = true; if (u * 8 > k) { k++; app.sfx?.play?.(snd[k % snd.length], { vol: 0.5 }); } if (u >= 1) { view.reveal = null; view.dirty = true; return true; } return false; }); };
    app.journal.act('belt', {}, app.clock, () => { beltId = O.add(B.rec).id; });
    WV.reveal = { id: beltId, u: 0 }; WV.dirty = true;
    shots([[1.3, [7600, 3900, -2400], [6000, 3300, -5000]], [1.1, [-1800, 4300, -6900], [6000, 3300, -3000]]]);
    d.speed = 1; yield* rise(WV, beltId, 2.4, ['plank', 'hammer_nail', 'hammer_nail']);
    // the pavilion's ring: boards round it, seen whole from far (its openings bridged — a lintel on props)
    if (BP && !beltsOverlap(BP.rec, B.rec)) {   // (one ring over both when the tops meet: not twice)
      BP.rec.H = MM(200);
      app.journal.act('belt', {}, app.clock, () => { pavId = O.add(BP.rec).id; });
      WV.reveal = { id: pavId, u: 0 }; WV.dirty = true;
      shots([[9, [-12000, 14000, 12000], [1000, 3000, 0]]]);
      yield* rise(WV, pavId, 1.6, ['plank', 'hammer_nail']);
      // (over the front's three glass openings the ring is a lintel cast in place — its soffit on props, boards each side, 250 onto the
      // piers: the game's «lintel formwork»; the ring had no concrete over the openings at all (the owner saw it «not filling»))
      for (const x of [(FRONT[0][1] + FRONT[1][0]) / 2, (FRONT[1][1] + FRONT[2][0]) / 2, (FRONT[2][1] + FRONT[3][0]) / 2]) {
        const L = placeLintelForm(app, new V(MM(x), BP.rec.top - MM(5), MM(SL.z0 + 150)));
        say('lintel ' + x + ' ' + (L ? `${L.ok ? 'ok' : L.why} ${L.lenMm}×${L.hMm} top ${Math.round((L.rec.top - BP.rec.top) / S)}` : 'none'));
        // ('above' — the ring's own top course over its ends: it is the ring it joins, at its level)
        if (L?.rec && L.lenMm > 2000) { L.rec.top = BP.rec.top; L.rec.H = MM(200);   // (at the ring's level and height: one beam with it)
 app.journal.act('lintel-form', {}, app.clock, () => { lintels.push({ id: O.add(L.rec).id, x0: x - L.lenMm / 2, x1: x + L.lenMm / 2 }); }); }
      }
      app.sfx?.seq?.(['plank', 'hammer_nail', 'pipe']);
    }
    // the cages lowered in: the chairs, then bar after bar, the ties (the game's reveal of a cage)
    hud(['Formwork', 'Rebar', 'Concrete'], 1, null, 'wall');
    shots([[1.2, [7200, 4200, -4000], [6000, 3300, -5200]]]);
    let cageA = null, cageB = null;
    app.journal.act('belt-cage', {}, app.clock, () => { cageA = O.add(beltCage(O.get(beltId))).id; if (pavId != null) cageB = O.add(beltCage(O.get(pavId))).id; for (const l of lintels) O.add(beltCage(O.get(l.id))); });
    if (cageB != null) { RV.reveal = { id: cageB, u: 1 }; }
    yield* rise(RV, cageA, 1.4, ['rebar', 'wire']);
    // the concrete: the hose along the spine's beam, always over the place still to fill — the stream seen the whole pour, the beam
    // filling under it (the owner: «no stream, the pour stops and at once the beam is full»); the poker after it
    hud(['Formwork', 'Rebar', 'Concrete'], 2, ['*Hose', 'Vibrator'], 'hose');
    const hose = app.concreteTools.hose, yb = topS + MM(200);
    const pts = [[X0, -5600], [X0, 1100]];
    const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), tot = segs.reduce((a, b) => a + b, 0);
    const path = (u) => { let s = u * tot, i = 0; while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; } const a = pts[i], b = pts[i + 1], f = Math.min(1, s / segs[i]); return new V(MM(a[0] + (b[0] - a[0]) * f), yb, MM(a[1] + (b[1] - a[1]) * f)); };
    app.setTool('hose');
    const ev = (q) => ({ target: beltId, hit: q });
    st.pump = 1e-5; { const p0 = path(0); hose.down(p0, ev(p0)); let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(p0, ev(p0)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - p0.x, sp.z - p0.z) < MM(250)); }); }
    st.pump = 12;   // (the pump's delivery buys the film's time — the hand stays at a hand's pace: the owner's lesson of stage 1)
    tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
    act([[1.1, [1800, 600, 1600], 1], [1.1, [-2200, 1100, -1800], 4], [9, [3000, 2000, -3500], 8]]);
    // (the front of the pour: the spout led on to the first cell not yet full along the beam — at most a hand's pace)
    // (to the end and back, over what is still short — a pass a layer, as on site — till the beam is full)
    // (the hand led from where the SPOUT is: while there is room under it the hand stays and the stream pours; when it is full there —
    // half a metre on. A beam 200 high takes what lands only ~0,8 m along it (its tongue 1:4): a hand led ahead of the spout left the
    // spout over full cells, the pump stopped — no stream (the owner)); loop: a ring, round and round; else to the end and back
    const lead = (ch, pf, len, loop, setDir, dir0 = 1) => {
      const sp = G.pump?.ready ? G.pump.spout() : null; if (!sp || !ch?.h) return null;
      let us = 0, bd = Infinity; for (let i = 0; i <= 400; i++) { const q = pf(i / 400), dd = Math.hypot(q.x - sp.x, q.z - sp.z); if (dd < bd) bd = dd, us = i / 400; }
      const k = ch.at(sp.x, sp.z), roomy = ch.room ? ch.room(k) : ch.h[k] < ch.cap - 8;
      if (roomy) return pf(us);
      let dv = dir0, un = us + dv * 500 / len;
      if (!loop && (un > 1 || un < 0)) { dv = -dv; setDir?.(dv); un = us + dv * 500 / len; }
      return pf(loop ? un : Math.max(0, Math.min(1, un)));
    };
    // (the owner, 2026-11-15: when there is no room under the spout the hose comes away at once — never held over full concrete, no
    // stream: dry() — seconds since the stream was last seen)
    let u = 0, dir = 1; const t0 = d.t, share = (ch) => { let a = 0; for (const v of ch.h) a += Math.min(1, v / ch.cap); return a / ch.h.length; };
    yield d.until(() => {
      const ch = hose.ch;
      const q = lead(ch, path, tot, false, (v) => { dir = v; }, dir) || path(u); hose.move(q, ev(q));
      return !!ch?.full || (ch?.h && share(ch) > 0.985) || d.t - t0 > 6 || (d.t - t0 > 1 && dry() > 0.5);
    });
    hose.up(); d.speed = 4; yield d.until(idle); d.speed = 1; G.set?.(null);
    still();
    say('belt fill ' + O.get(beltId)?.fill + ' u ' + u.toFixed(2) + ' in ' + (d.t - t0).toFixed(1));
    // (the last tenth topped up and worked level between two shots — the poker's round: no step in the frame)
    { const b = O.get(beltId); if (b && b.fill < 0.999) app.journal.act('belt-pour', {}, app.clock, () => O.update(beltId, { lv: b.lv.map(() => b.H / S), sm: b.lv.map(() => 0.9), fill: 1 })); }
    // the pavilion's ring: the hose too — round it along the walls, the stream into the boards (the owner: «the ring poured without the
    // hose, a timelapse — it must be the build-up»): ×1 close, ×3, ×6 from further, the front of the pour led on to what is not yet full
    const pb = pavId != null && O.get(pavId);
    if (pb) {
      const ri = 150, rp = [[SL.x0 + ri, SL.z0 + ri], [SL.x1 - ri, SL.z0 + ri], [SL.x1 - ri, SL.z1 - ri], [SL.x0 + ri, SL.z1 - ri], [SL.x0 + ri, SL.z0 + ri]];
      const ys = pb.top + pb.H, sg = rp.slice(1).map((q, i) => Math.hypot(q[0] - rp[i][0], q[1] - rp[i][1])), tl = sg.reduce((x, y) => x + y, 0);
      const ring = (u) => { let s2 = ((u % 1) + 1) % 1 * tl, i = 0; while (i < sg.length - 1 && s2 > sg[i]) { s2 -= sg[i]; i++; } const A = rp[i], Bq = rp[i + 1], f = Math.min(1, s2 / sg[i]); return new V(MM(A[0] + (Bq[0] - A[0]) * f), ys, MM(A[1] + (Bq[1] - A[1]) * f)); };
      const evp = (q) => { const l = Math.abs(q.z / S - (SL.z0 + 150)) < 300 && lintels.find((r) => q.x / S > r.x0 + 200 && q.x / S < r.x1 - 200); return { target: l ? l.id : pavId, hit: q }; };   // (over an opening — into its lintel)
      app.setTool('hose');
      st.pump = 1e-5; { const p0 = ring(0); hose.down(p0, evp(p0)); let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(p0, evp(p0)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - p0.x, sp.z - p0.z) < MM(250)); }); }
      st.pump = 1;   // (a ring's hose — 60 l/s at most: the hand walks at 0,75 m/s; the ring is long and narrow: the delivery up, the hand at its pace)
      tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
      act([[1.2, [-1500, 700, -1600], 1], [1.3, [2600, 1500, 2200], 3], [9, [-5200, 3800, -4800], 10]]);
      // (round it at a steady walk, ~1,2 m/s of the game's clock — the delivery set so that one round fills it: the stream always lands on
      // what is still to fill)
      const t0 = d.t; let ur = 0; wet0();
      yield d.until(() => {
        ur += d.dt * d.speed * MM(ur < 1 ? 750 : 1500) / MM(tl);
        const q = ring(ur); hose.move(q, evp(q));
        return (ur >= 1 && hose.ch?.h && share(hose.ch) > 0.97 && hose.ch.b?.id === pavId) || d.t - t0 > 8.5 || (d.t - t0 > 1 && dry() > 0.5);   // (a second, quicker round over what is short)
      });
      hose.up(); d.speed = 4; yield d.until(idle); d.speed = 1; G.set?.(null);
      still();
      say('pavilion fill ' + O.get(pavId)?.fill + ' lintels ' + lintels.map((l) => O.get(l.id)?.fill?.toFixed(2)).join(',') + ' in ' + (d.t - t0).toFixed(1));
      for (const id of [pavId, ...lintels.map((l) => l.id)]) { const r = O.get(id); if (r && r.fill < 0.999) app.journal.act('belt-pour', {}, app.clock, () => O.update(id, { lv: r.lv.map(() => r.H / S), sm: r.lv.map(() => 0.9), fill: 1 })); }
    }
  }
  bill('RING BEAM 3.4');
  // ---- a week: the beam sets, its boards off ----
  d.hud(null);
  shots([[9, [-16000, 18000, 14000], [1500, 2000, 0]]]);
  // (the clock over work — the analyst: never over a still frame: the beams' boards come off board by board under it)
  { const ids = [beltId, pavId, ...lintels.map((l) => l.id)].filter((id) => id != null);
    yield* d.lapse(7, 1.3, (q) => { app.clock += 9000 * d.dt / 1.3; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); const n = ids.length, k = Math.min(n - 1, Math.floor(q * n)), u = 1 - (q * n - k); for (let i = 0; i < k; i++) if (!O.get(ids[i])?.stripped) O.update(ids[i], { stripped: true, pile: [+MM(-3200 + i * 1300).toFixed(6), +MM(7600).toFixed(6)] }); app.wallView.reveal = { id: ids[k], u: Math.max(0, u) }; app.wallView.dirty = true; if (Math.random() < 0.3) app.sfx?.play?.('plank', { vol: 0.35, gap: 0.15 }); });
    app.wallView.reveal = null; }
  app.sky.setHour(9.5);
  app.journal.act('belt-strip', {}, app.clock, () => { for (const [i, id] of [beltId, pavId, ...lintels.map((l) => l.id)].entries()) if (id != null) O.update(id, { pile: O.get(id)?.pile || [+MM(-3200 + i * 1300).toFixed(6), +MM(7600).toFixed(6)], stripped: true }); });
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
  // (one block of a high step held back: the hook's action — laid there by the mallet (the analyst: motion from the 0th frame))
  const rest = spineUp.flat().filter((r) => r !== u0 && r !== hold && !spineUp[0].slice(1, 6).includes(r));
  // (the analyst: the stair is the stage's «wow» — the most time: in profile against the sky, then on its axis from below)
  // (three different: the profile against the sky; low from the sea's corner up to the top; high from behind along it — the owner:
  // 35–40 s were one profile twice with a view along the steps between)
  // (the steps seen rising first — from high behind, along them; then low from the sea's corner; the profile on the sky last, when they
  // are all there: the side of a half-laid wall is a grey band — a dead frame)
  shots([[1.9, [13500, 9500, 9500], [5000, 3500, -1500]], [1.5, [11000, 1300, -11500], [6000, 4800, -3500]], [9, [15500, 4300, 500], [6000, 4300, -500]]]);
  { let i = 0; const n = rest.length, dur = 5.0, t0 = d.t;
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
    { const WV = app.wallView, t0 = d.t; yield d.until(() => { const u = Math.min(1, (d.t - t0) / 1.0); WV.reveal = { id: landId, u }; WV.dirty = true; if (u >= 1) { WV.reveal = null; return true; } return false; }); }   // (its boards going up too)
    const hose = app.concreteTools.hose, yb = topU + MM(200), ev = (q) => ({ target: landId, hit: q });
    app.setTool('hose'); hud(['Cinder', 'Formwork', 'Concrete'], 2, ['*Hose', 'Vibrator'], 'hose');
    const a = new V(MM(X0), yb, MM(-4300)), b = new V(MM(X0), yb, MM(-5600));
    st.pump = 1e-5; hose.down(a, ev(a)); { let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(a, ev(a)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - a.x, sp.z - a.z) < MM(250)); }); }
    st.pump = 4; tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
    act([[1.0, [-2200, 1400, -1600], 3], [9, [-3000, 2200, -2400], 6]]);
    // (till it is full, the camera on it — the owner: «the landing's beam did not fill in the frames»)
    let pt = 0; wet0(); const t0 = d.t, lDry = dry; yield d.until(() => { pt += d.dt * d.speed; const q = a.clone().lerp(b, 0.5 + 0.5 * Math.sin(pt * 0.6)); hose.move(q, ev(q)); const ch = hose.ch; return !!ch?.full || (ch?.h && ch.h.every((v) => v >= ch.cap - 8)) || d.t - t0 > 3.5 || (d.t - t0 > 0.6 && lDry() > 0.5); });
    hose.up(); d.speed = 4; yield d.until(idle); d.speed = 1; G.set?.(null);
    still();
    { const r = O.get(landId); if (r) app.journal.act('belt-pour', {}, app.clock, () => O.update(landId, { lv: r.lv.map(() => r.H / S), sm: r.lv.map(() => 0.9), fill: 1 })); }
  }
  // (the sketch's own view: the camera set where the drawing was made from — still, no hand)
  shotN++; d.cut(look(new V(MM(17500), MM(9000), MM(15500)), new V(MM(2600), MM(3200), MM(-1600))), { drift: 0, push: 0, hand: 0 });
  app.budget._pay?.([{ usd: rest.length * 2.2 + 900 }], P(0, 0, 0));
  bill('STEPS & LANDING');
  yield d.sec(0.9);
  // (the sheet grows from its corner to its place in the frame — its drawing is the band 36 %…92 % of the frame from the sketch's view,
  // the stair's top off its edge (the analyst: the answer to the hook's «where?» never on the sheet) — then washes away into the real
  // view, which shows the top: the answer)
  // (the pin out first, up and away — else its red head hung on the sky after the sheet had washed off: the realist)
  { const tp = d.t; pin.style.opacity = ''; app.sfx?.play?.('tap', { vol: 0.4 }); yield d.until(() => { const u = Math.min(1, (d.t - tp) / 0.2); pin.style.top = 16.8 - 2 * u + '%'; pin.style.opacity = String(1 - u); return u >= 1; }); pin.remove(); }
  { const r0 = { l: 71, t: 16.5, w: 26 }, r1 = { l: -4.81, t: 31.2, w: 109.63 }, t0 = d.t; sk.style.opacity = ''; app.sfx?.play?.('fabric', { vol: 0.5 });
    yield d.until(() => { const u = Math.min(1, (d.t - t0) / 0.5), e = u * u * (3 - 2 * u); sk.classList.add('grow'); sk.style.left = r0.l + (r1.l - r0.l) * e + '%'; sk.style.top = r0.t + (r1.t - r0.t) * e + '%'; sk.style.width = r0.w + (r1.w - r0.w) * e + '%'; return u >= 1; });
    yield d.sec(0.35);
    const t1 = d.t; yield d.until(() => { const u = Math.min(1, (d.t - t1) / 1.0); sk.style.opacity = String(1 - u); return u >= 1; });
    sk.remove(); }
  // (the loop: the end on the hook's own view — the same frame both sides of the seam, the block still to be laid: the analyst)
  shotN++;
  hud(['Cinder', 'Formwork', 'Concrete'], 0, ['*By hand', 'Course'], 'wall');
  st.wallKind = 'cinder'; app.setTool('wall'); W.setMode('lay');
  d.cut(look(P(8200, 2100, 12500), P(5900, 4700, -2600)), { drift: 0.01, push: 0.02, hand: 0.25 });   // (from behind the foot, a little to the side: the risers climbing away into the sky — closer and lower it read as the wall's flat side)
  d.kick('?', 0.7, 'top');   // (where the next part goes — no shape of it: the analyst)
  yield d.sec(0.4);
  d.next(); d.nextEl?.classList.add('small');
  yield d.sec(1.2);
  // ---- the hook (put first by the recorder; the content analyst, 2026-11-15): low, three-quarters from the stair's foot, up along its
  // steps into the sky, the sea on the horizon past the top; motion from the first frame — a block laid on a high step by the mallet;
  // the question names the thing: «34 STEPS TO WHERE?»; the HUD — the masonry's; «TO BE CONTINUED» smaller and lower (the analyst's
  // option (a): it stays both sides of the loop's seam, under the question) ----
  shotN++;
  hud(['Cinder', 'Formwork', 'Concrete'], 0, ['*By hand', 'Course'], 'wall');
  st.wallKind = 'cinder'; app.setTool('wall'); W.setMode('lay');
  d.nextEl?.classList.add('small');
  d.cut(look(P(8200, 2100, 12500), P(5900, 4700, -2600)), { drift: 0.01, push: 0.07, hand: 0.25 });   // (from behind the foot, a little to the side: the risers climbing away into the sky — closer and lower it read as the wall's flat side)
  yield d.sec(0.2);
  d.mark('hook');
  d.kick('34 STEPS TO WHERE?', 2.2, 'top');
  { const t0 = d.t; let laid = false; yield d.until(() => { if (!laid) laid = job(hold, false); return d.t - t0 >= 2.2; }); }   // (no rule in the frame — no rule's sound: the realist)
  if (!O.all('unit').some((u) => Math.abs(u.p[0] - hold.p[0]) < 1e-6 && Math.abs(u.p[1] - hold.p[1]) < 1e-6 && Math.abs(u.p[2] - hold.p[2]) < 1e-6)) O.add(hold);
  d.mark('hookEnd');
  d.stair = { pavId, units: O.all('unit').length, cinder: O.all('unit').filter((u) => u.kind === 'cinder').length, belts: O.all('belt').length, dpc: O.all('dpc').length, beltId, landId, laidN };
  yield d.sec(0.1);
}
stairFilm.seconds = 45;
stairFilm.place = 'beach';
stairFilm.start = 'assets/films/ibiza-1.json.gz';
stairFilm.sounds = ['block', 'brick', 'trowel', 'trowel_tap', 'mallet', 'tap', 'till', 'cash', 'torch', 'fabric', 'plank', 'hammer_nail', 'rebar', 'wire', 'pump', 'concrete', 'vibrator', 'screed', 'waves', 'wind', 'birds'];
