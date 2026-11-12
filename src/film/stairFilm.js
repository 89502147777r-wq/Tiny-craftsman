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

// the blocks course by course: [course] → [row across] → records along the wall from its low end (as a mason lays a
// course: from the corner on); course k starts k treads in, all of them end at the landing; the joints lapped
export function stairCourses(base) {
  const out = [];
  for (let k = 0; k < N; k++) {
    const y = base + MM(BED + k * (H + J) + H / 2), a0 = XA + k * RUN, a1 = XB, rows = [];
    for (let r = 0; r < ROWS; r++) {
      const z = -ZW + T / 2 + r * (T + J), off = ((k + r) % 2) * (L + J) / 2, list = [];
      for (let a = a0 - off; a < a1; a += L + J) {
        const lo = Math.max(a, a0), hi = Math.min(a + L, a1); if (hi - lo < 90) continue;   // (a cut block: no shorter than 90)
        list.push({ type: 'unit', kind: 'cinder', free: true, p: [MM((lo + hi) / 2), y, MM(z)], s: [hi - lo, H, T].map(MM), q: [0, 0, 0, 1] });
      }
      rows.push(list);
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
  if (!app.budget.on) O.add({ type: 'budget', money: 60000, start: 60000 });
  d.money(true); d.byStages();
  // the strip under the wall (stage 1 of the house): concrete 300 high, 1.5 m wide, cast and set before this film
  const cells = [];
  for (let i = 0; i < Tn.conc.length; i++) { const x = Math.abs(Tn.toWorldX(i % Tn.nx)), z = Math.abs(Tn.toWorldZ(Math.floor(i / Tn.nx))); if (x < MM(XB + 150) && z < MM(ZW + 155)) cells.push(i); }
  { let a = 1e9, b = -1, c = 1e9, e = -1; for (const i of cells) { const add = MM(300) - Tn.conc[i]; if (add > 0) Tn._concAdd(i, add, 1); const ix = i % Tn.nx, iz = Math.floor(i / Tn.nx); a = Math.min(a, ix); b = Math.max(b, ix); c = Math.min(c, iz); e = Math.max(e, iz); } if (b >= 0) Tn._concTouch(a, c, b, e); Tn.updateMesh?.(); }
  app.clock += 600;
  const base = Tn.heightAt(MM(XA + 200), 0), C = stairCourses(base), total = C.flat(2).length, top = base + MM(BED + N * (H + J));
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
  d.cut(look(new V(P.x - MM(700), P.y + MM(420), P.z + MM(950)), P), { drift: 0.03, push: 0.05, hand: 0.45 });
  yield d.until(() => physicsReady());
  let began = false;
  const one = () => { if (!began) { began = W.layUnit(r0); if (began) { d.jobs = 1; laid++; } } return began && !app.busy(); };
  // ---- 2 · the course along the wall, sped up: the trowel spreads the bed for ten blocks, each set down on its piece ----
  const rowA = row0.slice(1); let nA = 0, bed = null, bedFrom = 0;
  const front = () => { const r = rowA[Math.max(0, Math.min(rowA.length - 1, nA))]; return new V(Math.max(P.x, r.p[0] - MM(400)), base + MM(60), P.z); };
  // (whole: how many get the whole show — mallet, mortar, trowel — before the course goes as courses go; v: the speeds — whole, spreading, laying)
  const course = (to, whole, v) => () => {
    if (!app.physJob && nA < whole) { d.speed = v[0]; if (W.layUnit(rowA[nA])) { nA++; laid++; d.jobs++; } return false; }
    if (!app.physJob && nA < to) {
      d.speed = v[2];
      if (!bed || nA >= bedFrom + bed.length) { bed = W.spreadBed(rowA.slice(nA, Math.min(to, nA + 10))); bedFrom = nA; if (bed && !d.spreads) d.hudPick(1, 1); d.spreads = (d.spreads || 0) + (bed ? 1 : 0); d.speed = v[1]; return false; }
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
  const side = low(new V(0, base + MM(1800), 0), 0.5, MM(19000), MM(1400));   // (rule 3: low, the horizon and the sea behind the steps)
  const back = low(new V(MM(XA * 0.25), base + MM(2600), 0), 1.15, MM(15000), MM(1700));
  const steps = [];
  const last = C[N - 1][0][C[N - 1][0].length - 1];   // (the hook's block: the outer corner of the 34th step, over the sea)
  const group = (from, to) => C.slice(from, to).flat(2).filter((r) => r !== last);
  for (let k = 1, g = 1; k < N;) {
    const k0 = k, to = Math.min(N, k + g), n = group(k0, to).length;   // (k0: the loop moves k on before the step is played)
    // (halfway up, another angle: from the sea's end, low, down the steps already there — the rest rising toward the camera)
    const turn = k0 <= N / 2 && to > N / 2;
    steps.push({ ...(turn ? { view: back, turn: true, lead: 0.3 } : { lead: 0 }), n, act: () => pop(group(k0, to))(), hold: k < 4 ? 0.55 : k > N - 7 ? 0.5 : k < 12 ? 0.4 : 0.32 });
    k = to; g = k < 4 ? 1 : k < 12 ? 2 : k < N - 7 ? 3 : 1;
  }
  yield* d.grow([
    { n: 1, until: one, hold: 0.5, push: 0.05 },
    { view: look(new V(P.x - MM(1800), base + MM(1300), P.z + MM(2600)), new V(P.x + MM(1400), base + MM(80), P.z)), follow: front, lag: 2.5, n: nCourse, until: course(nCourse, 2, [2.5, 3, 4]), hold: 0.3 },
    { view: side, turn: true, n: rest0.length, act: pop(rest0), lead: 0.35, hold: 0.45 },
    ...steps,
  ]);
  pay(laid + 1);
  d.stageBill(`CINDER BLOCKS × ${(laid + 1).toLocaleString('en-US')}`);
  yield d.sec(1.9);
  // ---- the hook (put first by the recorder): the last block of the 34th step at its real pace — the video ends on
  // the frame before it, so it loops on the same shot and the same blow ----
  const Pl = new V(...last.p);
  d.cut(look(new V(Pl.x + MM(2600), Pl.y + MM(700), Pl.z + MM(5200)), new V(Pl.x - MM(2600), Pl.y - MM(1500), 0)), { drift: 0.02, hand: 0.3 });
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
