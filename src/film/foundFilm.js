import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look, low } from './director.js';
import { loadPhysics, physicsReady } from '../world/physics.js';
import { edges } from '../world/outlines.js';
import { digPit, bedPit } from '../tools/pitJob.js';
import { PW, floorTopY, wallTopY } from '../world/pool.js';

// «Ibiza», stage 1 — the foundations (docs/ideas/ibiza.md, the foreman's plan 2026-11-12; the owner: the stages are
// filmed strictly in the order of the build, nothing appears ready): the deep first — the pool's pit, its bed, its floor
// and walls; then the shallow pits of the spine's strip (1.5 × 12.1 × 0.6 m, for ~70 t of the stair wall), of the
// pavilion's slab (300) and of the fireplace's pad (400), their beds, formwork, cages, the concrete in one go; a week;
// the boards off. All of it the game's own work. The hook — this stage's result, low along the bare strip to the sea,
// «70 TONNES ON THIS?» — is the film's last shot (the recorder puts it first: the loop).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
// the house on the plot (mm; the sea toward −z): the spine along z at x = X0; the pavilion left of it; the pool before
// the pavilion, on the sea's side; the fireplace's pad far left
export const IBIZA = {
  X0: 6000,
  spine: { x0: 5250, x1: 6750, z0: -6050, z1: 6050, h: 600, bed: 200 },
  slab: { x0: -5000, x1: 5250, z0: -2350, z1: 4200, h: 300, bed: 250 },
  pad: { x0: -8900, x1: -6900, z0: 1800, z1: 4700, h: 400, bed: 200 },
  pool: { x0: -6000, x1: 4000, z0: -5700, z1: -3100 },   // (the water's edge: 10 × 2.6 m)
  up: 250,                                                // (the tops of all of them over the ground: the pool's wall top)
};

export function* foundFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, G = app.concreteGear, st = app.settings, pw = app.wallTool.pool;
  Object.assign(st, { dayHour: 9.5, pump: 1.25, rebarD: 16, rebarStep: 200 }); app.sky.setHour(9.5);
  d.lock = true; d.hand = 0.3;
  d.logo();
  st.propsSeeded = true; for (const r of O.all('siteprop')) O.remove(r.id);
  if (!app.budget.on) O.add({ type: 'budget', money: 150000, start: 150000 });
  d.money(true); d.byStages();
  const g = T.heightAt(MM(IBIZA.X0), 0), P = (x, y, z) => new V(MM(x), g + MM(y), MM(z)), idle = () => !app.busy();
  const hud = (i, row2, tool) => d.hud([['Pit', 'Formwork', 'Rebar', 'Concrete'].map((t, k) => (k === i ? '*' + t : t)), row2], tool);
  const say = (m) => { (d.notes = d.notes || []).push([+d.t.toFixed(1), m]); };
  loadPhysics().catch(() => {});

  // ---- 1 · the pool's pit: the deep first -------------------------------------------------------------
  const B = IBIZA.pool, scr = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  Object.assign(st, { wallKind: 'pool', poolLayer: 'pit' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(0, ['*Pool', 'Strip', 'Slab'], 'wall');
  d.cut(look(P(-1000, 5200, 4500), P(-1000, -900, -4400)), { drift: 0.015, push: 0.015, hand: 0.4 });
  { const a = P(B.x0, 0, B.z0), b = P(B.x1, 0, B.z1); pw.down(a, scr(a)); pw.move(b, scr(b)); pw.up(); }
  const R = () => pw.rec, belts = () => pw._belts(R());
  yield d.sec(0.5);
  say('pool ' + JSON.stringify([R()?.L, R()?.W]));
  d.speed = 6;
  pw._dig(R(), null);
  yield d.until(idle);
  d.speed = 1;
  const mid = (q) => [(q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2];
  d.stageBill('EXCAVATION · 104 m³');
  yield d.sec(0.6);
  // ---- 3 · the beds: the pool's stone and lean concrete; sand and stone under the rest, rammed -------
  d.speed = 8;
  d.cut(look(P(-1000, 3800, 1200), P(-1000, -1700, -4400)), { drift: 0.015, push: 0.015, hand: 0.4 });
  pw._bed(R(), null);
  yield d.until(idle);
  d.speed = 1;
  say('bed done');
  // ---- 4 · the pool's shell: the floor's boards and bars, its concrete; the walls' bars and forms, their concrete ----
  const fresh = () => { const now = T.clock || app.clock; for (let i = 0; i < T.conc.length; i++) if (T.conc[i] > 0) T.cTime[i] = now; };
  const hose = app.concreteTools.hose, at = (s, t, y) => { const [x, z] = PW(R(), s, t); return new V(x, y, z); };
  // (the hose led along a path till `full` says so, the game's clock of setting held — a real pour is one go)
  const pour = function* (path, full, TP, max, v = 16, wrap = true) {
    app.setTool('hose'); hud(3, ['*Hose', 'Vibrator', 'Rule'], 'hose');
    { const p0 = path(0); app.camera.updateMatrixWorld(true); hose.down(p0, scr(p0)); } let pt = 0; d.speed = v;
    yield d.until(() => { pt += d.dt * d.speed; fresh(); { const q = path(wrap ? (pt / TP) % 1 : Math.min(1, pt / TP)); app.camera.updateMatrixWorld(true); hose.move(q, scr(q)); } return full() || pt > max; });   // (the screen's point with it: what is under the hose — a belt, the ground — is found as under a finger)
    hose.up(); d.speed = 6;
    yield d.until(idle);
    d.speed = 1; G.set(null);
    return pt;
  };
  Object.assign(st, { wallKind: 'pool' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(1, ['*Pool floor', 'Pool walls'], 'wall');
  d.cut(look(P(-1000, 7500, 1500), P(-1000, -1600, -4400)), { drift: 0.01, push: 0.01, hand: 0.3 });
  d.speed = 8;
  pw._form1(R(), null);
  yield d.until(idle);
  pw._cage1(R(), belts().fb);
  yield d.until(idle);
  say('floor belt ' + JSON.stringify({ fb: !!belts().fb, cage: R().cage1 }));
  { const r = R(), yF = floorTopY(r);
    const t1 = yield* pour((u) => at(r.L * (0.04 + 0.92 * u), r.W * (0.5 + 0.46 * Math.sin(u * Math.PI * 12)), yF), () => belts().fb?.fill >= 0.965, 30, 200, 48);
    say('floor fill ' + belts().fb?.fill + ' in ' + t1.toFixed(0)); }
  // (two days: the floor hard enough for the walls' forms)
  d.hud(null);
  yield* d.lapse(2, 1.3, () => { app.clock += 2400 * d.dt / 1.3; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  Object.assign(st, { wallKind: 'pool' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(1, ['Pool floor', '*Pool walls'], 'wall');
  d.cut(look(P(-1000, 9000, 2600), P(-1000, -400, -4400)), { drift: 0.01, push: 0.01, hand: 0.3 });
  d.speed = 8;
  pw._cage2(R(), belts().fb);
  yield d.until(idle);
  pw._form2(R(), belts().fb, null);
  yield d.until(idle);
  say('wall belt ' + !!belts().wb);
  { const r = R(), yW = wallTopY(r), o = -125, w = r.L + 250, h = r.W + 250, per = 2 * (w + h);
    const round = (u) => { const dd = ((u * 3) % 1) * per; const [ss, tt] = dd < w ? [o + dd, o] : dd < w + h ? [r.L - o, o + dd - w] : dd < 2 * w + h ? [r.L - o - (dd - w - h), r.W - o] : [o, r.W - o - (dd - 2 * w - h)]; return at(ss, tt, yW); };
    const t2 = yield* pour(round, () => !belts().wb || belts().wb.fill >= 0.965, 60, 260, 60);
    say('wall fill ' + belts().wb?.fill + ' in ' + t2.toFixed(0)); }
  d.stageBill('POOL SHELL');
  yield d.sec(0.6);

  // (the deep finished first — the realist: three days, the walls' forms off, the gap round the shell filled back in layers —
  // before anything shallow is dug beside it)
  d.hud(null);
  yield* d.lapse(3, 1.4, () => { app.clock += 9000 * d.dt / 1.4; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  d.cut(look(P(-1000, 5200, 4500), P(-1000, -900, -4400)), { drift: 0.015, push: 0.015, hand: 0.4 });
  d.speed = 10;
  Object.assign(st, { wallKind: 'pool' }); app.setTool('wall'); app.wallTool.setMode('lay');
  { const { fb, wb } = belts(); pw._strip(R(), fb, wb); }
  yield d.until(idle);
  { const { fb, wb } = belts(); pw._fill(R(), fb, wb); }
  yield d.until(idle);
  d.speed = 1;
  say('pool ' + JSON.stringify({ fs: belts().fb?.stripped, ws: belts().wb?.stripped, filled: R().filled }));
  // ---- 2 · the shallow pits: the strip, the slab, the pad ---------------------------------------------
  app.setTool('mark');
  const pits = {};
  for (const k of ['spine', 'slab', 'pad']) { const q = IBIZA[k]; pits[k] = O.add({ type: 'outline', kind: 'rect', x0: MM(q.x0), z0: MM(q.z0), x1: MM(q.x1), z1: MM(q.z1), depth: +((q.h + q.bed - IBIZA.up) / MODEL_SCALE).toFixed(2) }); }
  d.cut(look(P(IBIZA.X0 + 1800, 2400, 10500), P(IBIZA.X0, 0, -1000)), { drift: 0.02, push: 0.02, hand: 0.4 });
  d.speed = 3;
  digPit(app, O.get(pits.spine.id));
  yield d.until(idle);
  d.speed = 10;
  d.cut(look(P(-2500, 8500, 13500), P(-500, 0, 0)), { drift: 0.02, push: 0.015, hand: 0.4 });
  digPit(app, O.get(pits.slab.id));
  yield d.until(idle);
  digPit(app, O.get(pits.pad.id));
  yield d.until(idle);
  d.speed = 1;
  app.budget._pay([{ usd: 650 }], P(0, 0, 0));   // (the shallow pits: ~28 m³ taken away)
  say('dug ' + ['spine', 'slab', 'pad'].map((k) => Math.round((T.heightAt(MM((IBIZA[k].x0 + IBIZA[k].x1) / 2), MM((IBIZA[k].z0 + IBIZA[k].z1) / 2)) - g) / S)).join(' '));

  d.cut(look(P(IBIZA.X0 + 1800, 2400, 10500), P(IBIZA.X0, 0, -1000)), { drift: 0.02, push: 0.02, hand: 0.4 });
  d.speed = 4;
  bedPit(app, O.get(pits.spine.id), IBIZA.spine.bed, 'g20');
  yield d.until(idle);
  d.speed = 12;
  d.cut(look(P(-2500, 8500, 13500), P(-500, 0, 0)), { drift: 0.02, push: 0.015, hand: 0.4 });
  bedPit(app, O.get(pits.slab.id), IBIZA.slab.bed, 'sand');
  yield d.until(idle);
  bedPit(app, O.get(pits.pad.id), IBIZA.pad.bed, 'g20');
  yield d.until(idle);
  d.speed = 1;
  d.stageBill('TRENCHES & BEDS');
  yield d.sec(0.6);
  say('beds ' + ['spine', 'slab', 'pad'].map((k) => Math.round((T.heightAt(MM(mid(IBIZA[k])[0]), MM(mid(IBIZA[k])[1])) - g) / S)).join(' '));

  // ---- 5 · the strip, the slab, the pad: boards, cages, the concrete in one go ---------------------------
  yield d.until(() => physicsReady());
  app.setTool('form'); app.formTool.setMode('outline');
  hud(1, ['*Boards 40 × 150', 'Stakes'], 'form');
  const F = app.formTool, keys = ['spine', 'slab', 'pad'], runsOf = {};
  for (const k of keys) { st.slab = IBIZA[k].h; const o = O.get(pits[k].id), y1 = F.topFor(o); runsOf[k] = edges(o).filter((e) => !(k === 'slab' && Math.abs(e.a[0] - MM(IBIZA.slab.x1)) < MM(5) && Math.abs(e.b[0] - MM(IBIZA.slab.x1)) < MM(5))).map((e) => F.run(e.a, e.b, e.n, y1, { outlineId: o.id })); }   // (the slab is cast against the strip's board: one board between them, no ridge of sand)
  const save = (id, list) => () => app.journal.act('formwork', { outlineId: id }, app.clock, () => { for (const r of list) O.add(r); });
  d.cut(look(P(IBIZA.X0 + 2600, 1500, 8600), P(IBIZA.X0 - 200, 0, 3000)), { drift: 0.02, push: 0.02, hand: 0.4 });
  { const rs = runsOf.spine.slice().sort((p, q) => q.n[1] - p.n[1]); d.speed = 5; F._fitRuns([rs[0]], true, save(pits.spine.id, [rs[0]])); yield d.until(idle); d.speed = 10; F._fitRuns(rs.slice(1), false, save(pits.spine.id, rs.slice(1))); yield d.until(idle); }
  d.cut(look(P(-2500, 8500, 13500), P(-500, 0, 0)), { drift: 0.02, push: 0.015, hand: 0.4 });
  d.speed = 14;
  for (const k of ['slab', 'pad']) { F._fitRuns(runsOf[k], false, save(pits[k].id, runsOf[k])); yield d.until(idle); }
  d.speed = 1;
  d.stageBill('BOARDS & STAKES');
  yield d.sec(0.6);
  say('forms ' + O.all('form').length);
  app.setTool('rebar'); app.rebarTool.setMode('cage');
  hud(2, ['*Cage Ø16 / 200', 'Bar', 'Mesh'], 'rebar');
  d.cut(look(P(IBIZA.X0 + 2400, 1700, 8200), P(IBIZA.X0, 0, 2500)), { drift: 0.02, push: 0.02, hand: 0.4 });
  for (const k of keys) {
    st.slab = IBIZA[k].h; st.rebarD = k === 'spine' ? 16 : 12;
    app.rebarTool.cageIn(O.get(pits[k].id));
    yield d.until(() => !!app.physJob || O.all('cage').some((c) => c.outlineId === pits[k].id));
    d.speed = k === 'spine' ? 2.5 : 16;
    if (k === 'spine') { yield d.sec(1.2); d.speed = 12; }
    if (k === 'slab') d.cut(look(P(-2500, 8500, 13500), P(-500, 0, 0)), { drift: 0.02, push: 0.015, hand: 0.4 });
    yield d.until(idle);
  }
  d.speed = 1;
  d.stageBill('REBAR');
  yield d.sec(0.6);
  say('cages ' + O.all('cage').length);
  // (the concrete: the strip along, the slab row by row, the pad — one go)
  for (const k of keys) {
    const q = IBIZA[k], v0 = T.concVolume(), want = MM(q.x1 - q.x0) * MM(q.z1 - q.z0) * MM(q.h), rows = Math.max(1, Math.round((q.x1 - q.x0) / 1300));
    const path = (u) => { const i = Math.min(rows - 1, Math.floor(u * rows)), f = u * rows - i, x = q.x0 + (q.x1 - q.x0) * (i + 0.5) / rows, z = q.z0 + (q.z1 - q.z0) * (0.1 + 0.8 * (i % 2 ? 1 - f : f)); return P(x, 0, z); };
    if (k === 'spine') d.cut(look(P(IBIZA.X0 + 900, 1900, 10200), P(IBIZA.X0, 0, -2500)), { drift: 0.01, push: 0.01, hand: 0.3 });
    if (k === 'slab') d.cut(look(P(-10500, 6500, 9500), P(-500, 0, 500)), { drift: 0.02, push: 0.015, hand: 0.4 });
    const tp = yield* pour(path, () => T.concVolume() - v0 >= want * (k === 'pad' ? 0.86 : 0.965), want * MODEL_SCALE ** 3 / st.pump * 1.0, want * MODEL_SCALE ** 3 / st.pump * 1.3, 16, false);   // (short of brim-full: the poker and the rule bring it to the boards' tops, none over them)
    say(k + ' poured ' + ((T.concVolume() - v0) * MODEL_SCALE ** 3).toFixed(1) + ' of ' + (want * MODEL_SCALE ** 3).toFixed(1) + ' in ' + tp.toFixed(0));
  }
  // (the poker round all of it — the crew's round — and the rule over the slab)
  app.setTool('vibro'); hud(3, ['Hose', '*Vibrator', 'Rule'], 'vibro');
  { const vib = app.concreteTools.vibro; let vt = 0; const sp = []; for (const k of keys) { const q = IBIZA[k]; for (let x = q.x0 + 500; x < q.x1; x += 1400) for (let z = q.z0 + 500; z < q.z1; z += 1400) sp.push([x, z]); }
    vib.down(P(sp[0][0], 0, sp[0][1])); d.speed = 12;
    yield d.until(() => { vt += d.dt * d.speed; fresh(); for (const [x, z] of sp) T.vibrate(MM(x), MM(z), MM(1300)); const i = Math.floor(vt / 0.14); if (i < sp.length) vib.move(P(sp[i][0], 0, sp[i][1])); return i >= sp.length || vt > 40; });
    vib.up(); yield d.until(idle); }
  app.setTool('screed'); hud(3, ['Hose', 'Vibrator', '*Rule'], 'screed');
  { const rule = app.concreteTools.screed, q = IBIZA.slab; d.speed = 9;
    d.cut(look(P(-9500, 4200, 8200), P(-500, 250, 800)), { drift: 0.02, push: 0.02, hand: 0.4 });
    for (let i = 0, x = q.x0 + 1000; x < q.x1; x += 2000, i++) { fresh(); const z0 = i % 2 ? q.z0 + 150 : q.z1 - 150, z1 = i % 2 ? q.z1 - 400 : q.z0 + 400; rule.down(P(x, 0, z0)); let u = 0;
      yield d.until(() => { u = Math.min(1, u + d.dt * d.speed / 4); rule.move(P(x, 0, z0 + (z1 - z0) * u)); return u >= 1; }); rule.up(); yield d.until(idle); } }
  d.speed = 1; G.set(null);
  d.stageBill('CONCRETE');
  yield d.sec(0.6);
  say('tops ' + keys.map((k) => Math.round((T.heightAt(MM(mid(IBIZA[k])[0]), MM(mid(IBIZA[k])[1])) - g) / S)).join(' '));

  // ---- 6 · a week; the boards off; the gap round the pool filled back ----------------------------------
  d.hud(null);
  d.cut(look(P(-3500, 5200, 13000), P(1000, 0, -1000)), { drift: 0.012, push: 0.01, hand: 0.3 });
  yield* d.lapse(7, 2.4, () => { app.clock += 9000 * d.dt / 2.4; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(16.5);
  app.setTool('form'); F.setMode('strip');
  d.speed = 3;
  for (const k of keys) { const [x, z] = mid(IBIZA[k]), p = P(x, 0, z); F.strip(p, scr(p)); yield d.until(() => !!app.physJob || !O.all('form').some((r) => r.outlineId === pits[k].id)); yield d.until(idle); d.speed = 20; }
  say('forms left ' + O.all('form').length);
  d.speed = 1;
  // (the boards taken off the site: the piles gone before the next stage)
  for (const r of O.all('formpile')) O.remove(r.id);
  yield d.sec(0.4);
  d.next();
  // ---- the hook (put first by the recorder): low along the bare strip to the pool's shell and the sea ----
  d.cut(look(P(IBIZA.X0 + 500, 1250, 9600), P(IBIZA.X0 - 1700, 100, -4000)), { drift: 0.015, push: 0.02, hand: 0.3 });
  yield d.sec(0.3);
  d.found = { tops: keys.map((k) => Math.round((T.heightAt(MM(mid(IBIZA[k])[0]), MM(mid(IBIZA[k])[1])) - g) / S)), forms: O.all('form').length, pool: { fs: !!belts().fb?.stripped, ws: !!belts().wb?.stripped, filled: !!R().filled } };
  d.mark('hook');
  d.kick('70 TONNES ON THIS?', 2.2, 'top');
  yield d.sec(2.4);
  d.mark('hookEnd');
  yield d.sec(0.1);
}
foundFilm.seconds = 34;
foundFilm.place = 'beach';
foundFilm.sounds = ['shovel_dig', 'soil_dump', 'gravel_pour', 'compactor', 'hammer_nail', 'plank', 'stake', 'rebar', 'wire', 'pump', 'concrete', 'concrete_splat', 'vibrator', 'screed', 'till', 'tap', 'waves', 'wind'];
