import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look, low } from './director.js';
import { loadPhysics, physicsReady } from '../world/physics.js';

// «Ibiza», stage 2 — «34 steps to the sea» (docs/ideas/ibiza.md, the owner's choice 2026-11-12): the spine wall of
// the house, laid of cinder blocks, its top stepping up course by course toward the sea — the stair is the masonry
// itself (each course one tread shorter). The rules agreed with the marketer and the SMM: the hook is this stage's
// own result with motion in it (the last block of the 34th step going down, its mallet) and a question of a few
// words; the film runs up to that very moment, so the video (the recorder puts the hook first) loops on the same
// frame and the same blow; the growth («нарастание»): the first block close at its real pace, the course sped up,
// then courses at once, faster and faster, slowing to 1× for the last block.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const N = 34, RUN = 300, LAND = 1300;                         // (steps, the tread, the landing over the sea, mm)
const L = 390, H = 188, T = 190, J = 10, BED = 12, ROWS = 6;   // (the cinder block; six across: a wall 1190 thick)
const XA = -(RUN * (N - 1) + LAND + RUN) / 2, XB = -XA;       // (the wall's ends: the low one and the sea's)
const ZW = (ROWS * T + (ROWS - 1) * J) / 2;

// (the wall runs along z and rises toward −z — toward the sea of «У моря»: its low end at +z)
// the blocks course by course: [course] → [row across] → records along the wall from its low end (as a mason lays a
// course: from the corner on); course k starts k treads in, all of them end at the landing; the joints lapped
export function stairCourses(base) {
  const out = [];
  for (let k = 0; k < N; k++) {
    const y = base + MM(BED + k * (H + J) + H / 2), a0 = XA + k * RUN, a1 = XB, rows = [];
    // (the bond across too — the realist: six walls of 190 side by side would have five joints running the whole height:
    // every other course the blocks lie across the wall, three of them, 3 × 390 + 2 × 10 = 1190; the rows laid from the
    // sea's end, so that end is flush, the cut pieces at the treads' fronts)
    const head = k % 2 === 1, n = head ? 3 : ROWS, w = head ? L : T, along = head ? T : L;
    for (let r = 0; r < n; r++) {
      const x = -ZW + w / 2 + r * (w + J), off = head ? (r % 2) * (along + J) / 2 : ((k / 2 + r) % 2) * (L + J) / 2, list = [];
      for (let b = a1 + off; b > a0; b -= along + J) {
        const hi = Math.min(b, a1), lo = Math.max(b - along, a0); if (hi - lo < 90) continue;   // (a cut block: no shorter than 90)
        list.push({ type: 'unit', kind: 'cinder', free: true, p: [MM(x), y, MM(-(lo + hi) / 2)], s: (head ? [L, H, hi - lo] : [hi - lo, H, T]).map(MM), q: head ? [0, 0, 0, 1] : [0, 0.70711, 0, 0.70711] });   // (a stretcher turned along the wall — its hollows the right way, not squeezed across)
      }
      rows.push(list.reverse());   // (laid from the low end on, as the mason goes)
    }
    out.push(rows);
  }
  return out;
}

export function* stairFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, Tn = app.terrain;
  Object.assign(app.settings, { dayHour: 16.5 }); app.sky.setHour(16.5);   // (low sun across the steps: every tread draws its shadow)
  app.setTool('wall'); app.wallTool.setMode?.('lay');
  d.lock = true; d.hand = 0.3;
  d.logo();
  d.hud([['Wall', '*Cinder block', 'Brick'], ['*By hand', 'Course']], 'wall');
  // (the site's things — the cabin, the mixer, the barrow, the pallets — stand where the stair and its camera go: away for this film)
  app.settings.propsSeeded = true; for (const r of O.all('siteprop')) O.remove(r.id);
  // (but what a mason needs by the wall — the realist: the pallets of blocks, the mixer — on the side the cameras do not look from)
  for (const [kind, x, z, yaw] of [['pallet', -2600, 3600, 0.1], ['pallet', -2700, 1900, -0.05], ['pallet', -2500, 200, 0.08], ['mixer', -3300, 5600, 0.6]]) O.add({ type: 'siteprop', kind, x: +MM(x).toFixed(5), z: +MM(z).toFixed(5), yaw });
  if (!app.budget.on) O.add({ type: 'budget', money: 60000, start: 60000 });
  d.money(true); d.byStages();
  // the strip under the wall — stage 1 of the house, a film of its own (the pit, the compacted bed, the formwork, the rebar, the
  // concrete; the foreman: 1.4–1.5 × 0.6 m, reinforced, for ~70 t of wall): here only its result, cast and set before this film —
  // 600 deep, its top 20 mm over the sand
  const cells = [];
  for (let i = 0; i < Tn.conc.length; i++) { const x = Math.abs(Tn.toWorldX(i % Tn.nx)), z = Math.abs(Tn.toWorldZ(Math.floor(i / Tn.nx))); if (x < MM(ZW + 155) && z < MM(XB + 150)) cells.push(i); }
  { let a = 1e9, b = -1, c = 1e9, e = -1; for (const i of cells) { Tn.nat[i] -= MM(580); const add = MM(600) - Tn.conc[i];   /* (the strip in the ground — the realist: on top of the sand the first step was 500 high) */ if (add > 0) Tn._concAdd(i, add, 1); const ix = i % Tn.nx, iz = Math.floor(i / Tn.nx); a = Math.min(a, ix); b = Math.max(b, ix); c = Math.min(c, iz); e = Math.max(e, iz); } if (b >= 0) Tn._concTouch(a, c, b, e); Tn.updateMesh?.(); }
  app.clock += 600;
  const base = Tn.heightAt(0, MM(-(XA + 200))), C = stairCourses(base), total = C.flat(2).length, top = base + MM(BED + N * (H + J));
  // (blocks a mason lays added at once — a piece of work done between two shots: their records, a few of their knocks)
  let laid = 0;
  const pop = (list) => () => { for (const r of list) O.add(r); laid += list.length; app.sfx?.seq?.(['block', 'block', 'trowel']); };
  // (what they cost: the cinder blocks come on pallets of 75 — billed at the stage's end)
  const pay = (n) => app.budget._pay([{ usd: 165 * n / 75 }], new V(0, base, 0));
  const W = app.wallTool;
  // ---- 1 · the first block, very close, at its real pace — the game's own job: on its bed of mortar, the mallet,
  // the mortar pressed out and cut off with the trowel ----
  const row0 = C[0][ROWS - 1], r0 = row0[0], P = new V(...r0.p);
  loadPhysics().catch(() => {});
  d.cut(look(new V(P.x + MM(950), P.y + MM(420), P.z + MM(700)), P), { drift: 0.03, push: 0.05, hand: 0.45 });
  yield d.until(() => physicsReady());
  let began = false;
  const one = () => { if (!began) { began = W.layUnit(r0); if (began) { d.jobs = 1; laid++; } } return began && !app.busy(); };
  // ---- 2 · the course along the wall, sped up: the trowel spreads the bed for ten blocks, each set down on its piece ----
  const rowA = row0.slice(1); let nA = 0, bed = null, bedFrom = 0;
  const front = () => { const r = rowA[Math.max(0, Math.min(rowA.length - 1, nA))]; return new V(P.x, base + MM(60), Math.min(P.z, r.p[2] + MM(400))); };
  // (whole: how many get the whole show — mallet, mortar, trowel — before the course goes as courses go; v: the speeds — whole, spreading, laying)
  const course = (to, whole, v) => () => {
    if (!app.physJob && nA < whole) { d.speed = v[0]; if (W.layUnit(rowA[nA])) { nA++; laid++; d.jobs++; } return false; }
    if (!app.physJob && nA < to) {
      d.speed = v[2];
      if (!bed || nA >= bedFrom + bed.length) { bed = W.spreadBed(rowA.slice(nA, Math.min(to, nA + 4)))   /* (the realist: under the sun no more than 3–4 blocks ahead) */; bedFrom = nA; if (bed && !d.spreads) d.hudPick(1, 1); d.spreads = (d.spreads || 0) + (bed ? 1 : 0); d.speed = v[1]; return false; }
      if (W.layUnit(rowA[nA], true, 12, bed?.[nA - bedFrom])) { nA++; laid++; d.jobs++; }
    }
    if (nA >= to && !app.busy()) { d.speed = 1; return true; }
    return false;
  };
  const nCourse = Math.min(14, rowA.length);
  // ---- 3 · further: the rest of the first course at once, then the courses — the steps — rising one after another,
  // faster and faster (one, then two, then three a beat), slowing down toward the landing ----
  const rest0 = [...C[0].slice(0, ROWS - 1).flat(), ...rowA.slice(nCourse)];
  const mid = new V(0, base + MM(2200), 0);
  const side = low(new V(0, base + MM(2400), 0), 1.35, MM(20000), MM(1300));   // (rule 3: low, the horizon; the steps' profile rising to the left, toward the sea)
  const back = look(new V(MM(300), base + MM(1150), MM(-XA + 5200)), new V(0, base + MM(3600), MM(-1800)));   // (on the stair's axis behind its foot: the risers one over another, up into the sea's sky)
  const last = C[N - 1].at(-1).at(-1);   // (the hook's block: the outer corner of the 34th step, over the sea)
  const group = (from, to) => C.slice(from, to).flat(2).filter((r) => r !== last);
  yield* d.grow([
    { n: 1, until: one, hold: 0.5, push: 0.05 },
    { view: look(new V(P.x + MM(2600), base + MM(1300), P.z + MM(1800)), new V(P.x, base + MM(80), P.z - MM(1400))), follow: front, lag: 2.5, n: nCourse, until: course(nCourse, 2, [2.5, 3, 4]), hold: 0.3 },
    { view: side, turn: true, n: rest0.length, act: pop(rest0), lead: 0.35, hold: 0.45 },
  ]);
  // ---- 4 · the steps rising over the days (the realist: thousands of blocks in seconds only with the time shown — a crew of three,
  // ≈ 300 a day, no more than ~1.4 m of height a day): 12 days, the courses laid in the daytime hours; halfway, the other angle ----
  let kDone = 1, turned = false;
  const DAYS = 12, h0 = app.sky.hour ?? 16.5;
  yield* d.lapse(DAYS, 9.5, (u) => {
    const h = h0 + u * DAYS * 24, day = Math.floor((h - 7) / 24), hh = ((h % 24) + 24) % 24;
    const want = Math.min(N, 1 + Math.round((N - 1) * Math.min(1, (day + (hh >= 7 && hh <= 18 ? (hh - 7) / 11 : hh > 18 ? 1 : 0)) / DAYS)));
    if (want > kDone) { pop(group(kDone, want))(); kDone = want; }
    if (!turned && u > 0.5) { turned = true; d.cut(back, { drift: 0.004, push: 0.012, hand: 0.35 }); }
  });
  if (kDone < N) pop(group(kDone, N))();
  pay(laid + 1);
  d.stageBill(`CINDER BLOCKS × ${(laid + 1).toLocaleString('en-US')}`);
  yield d.sec(1.9);
  // (the mortar — the realist: ≈ 6 m³ for this wall, its cement and sand)
  app.budget._pay([{ usd: 640 }], new V(0, base, 0));
  d.stageBill('MORTAR · 6 m³');
  yield d.sec(1.9);
  // ---- the hook (put first by the recorder): the last block of the 34th step at its real pace — the video ends on
  // the frame before it, so it loops on the same shot and the same blow ----
  const Pl = new V(...last.p);
  d.cut(look(new V(MM(450), base + MM(2300), Pl.z + MM(12500)), new V(0, Pl.y - MM(1100), Pl.z + MM(900))), { drift: 0.02, hand: 0.3 });
  yield d.sec(0.35);
  d.speed = 1;
  let hookOn = false;
  d.mark('hook');
  yield d.until(() => { if (!hookOn) { hookOn = W.layUnit(last); if (hookOn) laid++; } return hookOn; });
  d.kick(`${N} STEPS TO THE SEA?`, 2.4, 'top');
  yield d.until(() => !app.busy());
  yield d.sec(0.3);
  d.laid = { total, done: O.all('unit').filter((u) => u.kind === 'cinder').length, top: +(top / S).toFixed(0) - +(base / S).toFixed(0) };
  d.mark('hookEnd');
  yield d.sec(0.1);
}
stairFilm.seconds = 28;
stairFilm.place = 'beach';
stairFilm.sounds = ['block', 'trowel', 'trowel_tap', 'mallet', 'tap', 'till', 'cash', 'waves', 'wind', 'birds'];
