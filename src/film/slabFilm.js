import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look, low } from './director.js';
import { loadPhysics, physicsReady } from '../world/physics.js';
import { edges } from '../world/outlines.js';
import { runPieces } from '../world/formwork.js';

// «A slab 10 × 10 m and four columns» — the owner's plan (2026-11-11), shot by his rules (growth; the game's own
// work; the game's face; a scene never starts on an empty place): the boards of the formwork close up (their
// grain seen), the slab's cage laid bar by bar, the four columns' cages carried from the button to the corners
// (the ghost under the finger, each from another angle) and tied into it, the concrete out of the hose — it
// flows, heaps and creeps to the boards, never a level sheet — the poker here and there, the rule; a day and a
// night go by on the clock while it sets; the columns' formwork (the first close, the rest at once), their
// concrete. Every piece of work is the game's own job, started as the finger starts it.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const HALF = 5000, THICK = 300, COL_IN = 600;   // (mm: the slab's half side, its thickness, the columns' axes in from its edge)

export function* slabFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, G = app.concreteGear;
  Object.assign(app.settings, { dayHour: 10, slab: THICK, pump: 0.625, colStage: 'cage', colType: 'sq', colA: 300, colCourse: 'block', colN: 12, colTilt: 0 });
  app.sky.setHour(10);
  d.lock = true; d.hand = 0.35;
  const H = MM(HALF), g = T.heightAt(0, 0), top = g + MM(THICK);
  const P = (x, y, z) => new V(MM(x), g + MM(y), MM(z));
  const idle = () => !app.busy();
  const hud = (i, row2, tool) => d.hud([['Formwork', 'Rebar', 'Columns', 'Concrete'].map((t, k) => (k === i ? '*' + t : t)), row2], tool);
  loadPhysics().catch(() => {});
  // (the game's budget: every stage billed as its work goes into the journal)
  if (!app.budget.on) O.add({ type: 'budget', money: 60000, start: 60000 });
  d.money(true);
  // the outline of the slab (the marking is not the film's matter: it is there)
  const ol = O.add({ type: 'outline', kind: 'rect', x0: -H, z0: -H, x1: H, z1: H, depth: 0 });

  // ---- 1 · the formwork: the front run close up — the stakes driven, the boards set on edge and nailed ------
  app.setTool('form'); app.formTool.setMode('outline');
  hud(0, ['*Boards 40 × 150', 'Stakes'], 'form');
  const F = app.formTool, y1 = F.topFor(O.get(ol.id));
  const runs = edges(O.get(ol.id)).map((e) => F.run(e.a, e.b, e.n, y1, { outlineId: ol.id }));
  runs.sort((a, b) => b.n[1] - a.n[1]);   // (the front one — its outer side toward the camera — first)
  const front = runs[0], rest = runs.slice(1), nStakes = runPieces(front, T).filter((q) => q.k === 'stake').length;
  const save = (list) => () => app.journal.act('formwork', { outlineId: ol.id }, app.clock, () => { for (const r of list) O.add(r); });
  const a0 = new V(front.a[0], g, front.a[1]), b0 = new V(front.b[0], g, front.b[1]), along = b0.clone().sub(a0).normalize();
  // (the owner: the camera rode after the work too much — it stands: the run seen along from its corner while the stakes
  // are driven, then close over the corner for the boards — the grain of the wood)
  d.cut(look(a0.clone().addScaledVector(along, -MM(1500)).add(new V(0, MM(1500), MM(2100))), a0.clone().addScaledVector(along, MM(3600)).setY(g + MM(100))), { drift: 0.02, push: 0.02, hand: 0.4 });
  yield d.until(() => physicsReady());
  F._fitRuns([front], true, save([front]));
  d.speed = 5;
  yield d.until(() => !app.physJob || app.physJob.k >= nStakes * 2);   // (the stakes in)
  d.speed = 2.2;
  d.cut(look(a0.clone().addScaledVector(along, MM(300)).add(new V(0, MM(560), MM(1250))), a0.clone().addScaledVector(along, MM(1200)).setY(g + MM(150))), { drift: 0.02, push: 0.03, hand: 0.4 });
  yield d.until(idle);
  // (further: the three other sides, quickly)
  d.speed = 1.6;
  d.cut(look(P(-9500, 6500, 11500), P(0, 0, 0)), { drift: 0.03, push: 0.02, hand: 0.4 });
  F._fitRuns(rest, false, save(rest));
  yield d.until(idle);
  yield d.sec(0.35);

  // ---- 2 · the slab's cage: bar after bar, on its chairs ---------------------------------------------------
  app.setTool('rebar'); app.rebarTool.setMode('cage');
  hud(1, ['*Slab cage Ø12 / 200', 'Bar', 'Mesh'], 'rebar');
  d.cut(look(P(-HALF - 1200, 1500, HALF + 1700), P(-HALF + 1500, 100, HALF - 1500)), { drift: 0.03, push: 0.03, hand: 0.5 });
  app.rebarTool.cageIn(O.get(ol.id));
  yield d.until(() => !!app.physJob);
  // (bar on bar: the job says a bar now and then at this pace — the film lets each be heard)
  const clink = d.each(() => { if (!app.physJob) return true; app.sfx?.play?.(Math.random() < 0.25 ? 'wire' : 'rebar', { vol: 0.45, gap: 0.16 }); return false; });
  void clink;
  d.speed = 1.6;
  yield d.sec(2.0);
  d.speed = 5;
  d.cut(look(P(8500, 6000, 10500), P(0, 0, 0)), { drift: 0.03, push: 0.02, hand: 0.4 });
  yield d.until(idle);
  d.speed = 1;
  yield d.sec(0.3);

  // ---- 3 · the columns' cages: carried from the button to each corner (the ghost under the finger), lowered into
  // the slab's cage, their feet wired to it — each from another angle ----------------------------------------
  app.setTool('column'); app.settings.colStage = 'cage';
  hud(2, ['*Cage 4 × Ø16', 'Formwork'], 'column');
  const C = app.columnTool.col, c = HALF - COL_IN, corners = [[-c, c], [c, c], [c, -c], [-c, -c]];
  const canvas = app.renderer.domElement;
  // (a point of the plot on the screen; the button's middle)
  const onScreen = (p) => { app.camera.updateMatrixWorld(true); const q = p.clone().project(app.camera), R = canvas.getBoundingClientRect(); return [R.left + (q.x + 1) / 2 * R.width, R.top + (1 - q.y) / 2 * R.height]; };
  const button = () => { const R = d.hudEl?.querySelector('.f-fab')?.getBoundingClientRect(); return R ? [R.left + R.width / 2, R.top + R.height / 2] : [innerWidth * 0.85, innerHeight * 0.88]; };
  // a piece carried by the finger from the button to `to` in `dur` s of film, then let go; → done
  const carry = (to, dur) => { let t0 = null, on = false; return () => {
    if (t0 == null) t0 = d.t;
    const u = Math.min(1, (d.t - t0) / dur), k = u * u * (3 - 2 * u), a = button(), b = onScreen(to), x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k - Math.sin(Math.PI * k) * 40;
    const e = { clientX: x, clientY: y }, p = u >= 1 ? to : (app.gestures.ground(x, y) || to);
    if (!on) { on = C.trayDown(p, e); app.sfx?.play?.('tap', { vol: 0.5 }); } else C.move(p, e);
    if (u >= 1) { if (C.drag) C.drag.stale = true, C.drag.lastP = to, C.drag.lastE = e; C.up(); return true; }
    return false;
  }; };
  const views = [[-0.75, 0.42, 7.5], [0.8, 0.5, 8], [2.3, 0.45, 8.5], [-2.4, 0.5, 8]];   // (yaw, pitch, dist m: another angle each)
  for (let i = 0; i < 4; i++) {
    const [x, z] = corners[i], at = P(x, THICK / 2, z), [yaw, pitch, dist] = views[i];
    d.cut({ target: P(x * 0.8, 600, z * 0.8), yaw, pitch, dist: MM(dist * 1000) }, { drift: 0.03, push: 0.02, hand: 0.5 });
    yield d.sec(0.12);
    d.speed = 1;
    yield d.until(carry(at, i ? 0.7 : 1.0));
    d.speed = i ? 3 : 1.5;
    yield d.until(idle);
    yield d.sec(i ? 0.15 : 0.3);
  }
  d.speed = 1;
  const cols = O.all('column');

  // ---- 4 · the concrete: out of the hose, row by row — it heaps under the stream, flows, creeps to the boards -----
  app.setTool('hose');
  hud(3, ['*Hose', 'Vibrator', 'Rule'], 'hose');
  const hose = app.concreteTools.hose, want = 4 * H * H * MM(THICK), rows = 8, TP = 44;
  const path = (u) => { const k = Math.min(rows - 1, Math.floor(u * rows)), f = u * rows - k, z = H * 0.9 - (2 * H * 0.9) * (k + 0.5) / rows, x = (k % 2 ? 1 - f : f) * 2 * H * 0.84 - H * 0.84; return new V(x, g, z); };   // (short of the boards: the stream swings on a little past the hand — it went over them)

  // (the film's pour runs many times faster than the game's clock of setting: the concrete is kept workable — fresh —
  // till the rule has gone over it, as a real slab is for its hour or two)
  const fresh = () => { const now = T.clock || app.clock; for (let i = 0; i < T.conc.length; i++) if (T.conc[i] > 0) T.cTime[i] = now; };
  // (the camera stands: low, looking along the rows — the hose comes toward it and goes away, its cut top over the frame's
  // top edge all the way; three places for the eight rows, from one side and the other)
  const rowZ = (k) => HALF * 0.9 - (2 * HALF * 0.9) * (k + 0.5) / rows;
  const stand = (k, side) => d.cut(look(P(side * (HALF + 5200), 2500, rowZ(k)), P(side * (HALF - 6800), 0, rowZ(k))), { drift: 0.015, push: 0.01, hand: 0.35 });
  stand(1, 1);
  hose.down(path(0));
  let pt = 0, at = 0;
  d.speed = 8;
  yield d.until(() => {
    pt += d.dt * d.speed; fresh();
    if (pt < TP) hose.move(path(pt / TP));
    else { const k = Math.min(3, Math.floor((pt - TP) / 1.2)), [x, z] = corners[k]; hose.move(P(x * 0.9, 0, z * 0.9)); }
    const row = Math.min(rows - 1, Math.floor(pt / TP * rows)), want3 = row < 3 ? 0 : row < 6 ? 1 : 2;
    if (want3 !== at) { at = want3; stand(at === 1 ? 4 : 6.4, at === 1 ? -1 : 1); }
    return T.concVolume() >= want * 0.975 || pt > TP + 6;   // (a finger under the boards' tops: brim-full, the poker and the rule sent it over them)
  });
  hose.up();
  d.speed = 3;
  yield d.until(idle);

  // ---- 5 · the poker: here, there — where it is put the concrete runs level, the paste comes up; then the rule -----
  app.setTool('vibro'); d.hudPick(1, 1);
  hud(3, ['Hose', '*Vibrator', 'Rule'], 'vibro');
  const vib = app.concreteTools.vibro, rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const spots = []; for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) spots.push([(i - 3) * H * 0.29 + (rnd() - 0.5) * H * 0.1, (j - 3) * H * 0.29 + (rnd() - 0.5) * H * 0.1]);
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  vib.down(new V(spots[0][0], g, spots[0][1]));
  d.cut(look(P(-HALF - 5200, 2500, 1800), P(-HALF + 6800, 0, 1800)), { drift: 0.015, push: 0.01, hand: 0.35 });   // (the camera stands, as for the hose)
  let vt = 0; const DW = 0.4;
  // (the film shows the poker at a place in a second — the crew's whole round of the slab goes on meanwhile: all of it
  // is kept shaking, so it runs level as a vibrated slab does)
  const round = () => { for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) T.vibrate(i * H * 0.24, j * H * 0.24, MM(1300)); };
  d.speed = 7;
  let half2 = false;
  yield d.until(() => { vt += d.dt * d.speed; round(); fresh(); const k = Math.floor(vt / DW); if (k < spots.length) vib.move(new V(spots[k][0], g, spots[k][1]));
    if (!half2 && k >= spots.length / 2) { half2 = true; d.cut(look(P(HALF + 5200, 2500, -1800), P(HALF - 6800, 0, -1800)), { drift: 0.015, push: 0.01, hand: 0.35 }); }
    return k >= spots.length; });
  vib.up();
  yield d.until(idle);
  // (the rule: on the boards' tops, strip by strip — what stands over them goes on ahead of it)
  app.setTool('screed');
  hud(3, ['Hose', 'Vibrator', '*Rule'], 'screed');
  const rule = app.concreteTools.screed;
  d.cut(look(P(-7500, 5200, 9000), P(0, THICK, 0)), { drift: 0.03, push: 0.02, hand: 0.4 });
  d.speed = 5;
  for (let k = 0; k < 5; k++) {
    fresh();
    const x = (-HALF + 1000 + k * 2000), z0 = k % 2 ? -HALF + 150 : HALF - 150, z1 = -z0 * 0.9;   /* (stopped short of the far boards: what it pushes ahead stays in) */
    rule.down(P(x, 0, z0)); let u = 0;
    yield d.until(() => { u = Math.min(1, u + d.dt * d.speed / 4.5); rule.move(P(x, 0, z0 + (z1 - z0) * u)); return u >= 1; });
    rule.up();
    yield d.until(idle);
  }
  d.speed = 1; G.set(null);

  // ---- 6 · it sets: a day and a night on the clock (low, the horizon in frame — the slab is low yet) ------------
  d.hud(null);
  d.cut(low(P(0, THICK, 0), 0.5, MM(15500), MM(2300)), { drift: 0.02, push: 0.015, hand: 0.3 });
  yield* d.lapse(2, 1.9, (u) => { app.clock += 420 * d.dt / 1.9; void u; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });   // (the clock's ticking)
  app.sky.setHour(9.5);
  yield d.sec(0.25);

  // ---- 7 · the columns' formwork: the first close (carried from the button, set round the cage), the rest at once -----
  app.setTool('column'); app.settings.colStage = 'form';
  hud(2, ['Cage 4 × Ø16', '*Formwork'], 'column');
  { const r = cols[0], at = new V(r.x, r.y0 + MM(200), r.z);
    d.cut(look(at.clone().add(new V(-MM(2600), MM(1700), MM(3800))), new V(r.x, r.y0 + r.h * 0.42, r.z)), { drift: 0.03, push: 0.03, hand: 0.5 });
    yield d.sec(0.12);
    yield d.until(carry(at, 0.9));
    d.speed = 1.5;
    yield d.until(idle);
    d.speed = 1;
    if ((O.get(r.id).stage || 0) < 2) O.update(r.id, { stage: 2 }); }   // (never left without: the hose waits for it)
  const formAt = (r) => { O.update(r.id, { stage: 2 }); app.sfx?.seq?.(['plank', 'hammer_nail', 'plank']); d.punch(0.97, 0.3); };
  d.cut(look(P(-10500, 5200, 9500), P(0, 1500, 800)), { drift: 0.03, push: 0.02, hand: 0.4 });
  yield d.sec(0.4); formAt(cols[1]);
  yield d.sec(0.45); formAt(cols[2]);
  yield d.sec(0.4); formAt(cols[3]);
  yield d.sec(0.5);

  // ---- 8 · their concrete: the hose into each (seen from over its top) ---------------------------------------
  app.setTool('hose');
  hud(3, ['*Hose', 'Vibrator', 'Rule'], 'hose');
  for (let i = 0; i < 4; i++) {
    const r = cols[i], tp = new V(r.x, r.y0 + r.h, r.z), sx = Math.sign(r.x), sz = Math.sign(r.z);
    d.cut(look(tp.clone().add(new V(-sx * MM(2400), MM(1500), sz * MM(2600) + MM(600))), tp.clone().add(new V(0, -MM(500), 0))), { drift: 0.03, push: 0.03, hand: 0.5 });
    yield d.sec(0.1);
    let began = false; const tS = d.t;
    d.speed = i ? 12 : 5;
    yield d.until(() => {
      if (!began && d.t - tS > 1.5) return true;   // (the hose does not find it: on)
      const [x, y] = onScreen(tp), e = { clientX: x, clientY: y };
      if (!began) { began = hose.down(tp, e) && !!hose.uT; if (!began) { hose.up(); return false; } }
      else hose.move(tp, e);
      return (O.get(r.id).fill || 0) >= 0.99 || !!hose.ch?.full || hose.state !== 'work';
    });
    hose.up();
    yield d.until(idle);
    d.speed = 1;
    yield d.sec(0.15);
  }
  G.set(null);
  d.done4 = O.all('column').filter((r) => (r.fill || 0) >= 0.99).length;

  // ---- the result, round it (the hook: put first by the recorder) -------------------------------------------
  d.lock = false; d.hud(null);
  hud(3, ['*Done'], 'hose');
  d.mark('hook');
  d.reveal(P(0, 1500, 0), MM(15000), 3.4, { yaw0: -0.6, arc: 1.5, y0: MM(1500), y1: MM(4200) });
  app.sfx?.play?.('cash');
  d.count('CONCRETE, m³', Math.round((T.concVolume() + 4 * MM(300) * MM(300) * cols[0].h) / S ** 3 / 1e9), '', 1.0);
  yield d.sec(3.4);
  d.mark('hookEnd');
  yield d.sec(0.1);
}
slabFilm.seconds = 48;
slabFilm.place = 'lake';
slabFilm.sounds = ['hammer_nail', 'plank', 'stake', 'rebar', 'wire', 'tap', 'pump', 'concrete', 'concrete_splat', 'vibrator', 'screed', 'cash', 'birds', 'wind', 'crickets'];
