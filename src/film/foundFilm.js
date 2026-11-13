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
  slab: { x0: -5000, x1: 4700, z0: -2350, z1: 4200, h: 300, bed: 250 },
  pad: { x0: -8900, x1: -6900, z0: 1800, z1: 4700, h: 400, bed: 200 },
  pool: { x0: -6000, x1: 4000, z0: -5700, z1: -3100 },   // (the water's edge: 10 × 2.6 m)
  up: 250,                                                // (the tops of all of them over the ground: the pool's wall top)
};

export function* foundFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, G = app.concreteGear, st = app.settings, pw = app.wallTool.pool;
  Object.assign(st, { dayHour: 9.5, pump: 1.25, rebarD: 16, rebarStep: 200, cover: 50, poolMeasure: false });   // (cover 50: the sea's salt — and no bar near a face; the pool's tape measure off) app.sky.setHour(9.5);
  d.lock = true; d.hand = 0.3;
  d.logo();
  st.propsSeeded = true; for (const r of O.all('siteprop')) O.remove(r.id);
  if (!app.budget.on) O.add({ type: 'budget', money: 150000, start: 150000 });
  d.money(true); d.byStages();
  const g = T.heightAt(MM(IBIZA.X0), 0), P = (x, y, z) => new V(MM(x), g + MM(y), MM(z)), idle = () => !app.busy();
  const hud = (i, row2, tool) => d.hud([['Pit', 'Formwork', 'Rebar', 'Concrete'].map((t, k) => (k === i ? '*' + t : t)), row2], tool);
  const say = (m) => { (d.notes = d.notes || []).push([+d.t.toFixed(1), m]); };
  loadPhysics().catch(() => {});
  // the shots of a stage (the director's table, after the owner: «ракурсы как попало… смена ракурсов от 1 до 3 секунд»): the camera
  // stands within a shot and cuts by the film's clock while the work goes on — from a corner along the long side ↔ low from the
  // side or out of the pit ↔ steeply down on a detail ↔ wide; list of [seconds, eye, aim] (mm; y over the ground); gone round
  // again if the work outlasts them
  let shotN = 0;
  const shots = (list) => { const id = ++shotN; let i = -1, t1 = -1; const f = () => { if (id !== shotN) return true; if (d.t >= t1) { i = (i + 1) % list.length; const [sec, e, a] = list[i]; d.cut(look(P(...e), P(...a)), { drift: 0.008, push: 0.01, hand: 0.25 }); t1 = d.t + sec; } return false; }; f(); d.each(f); };
  const ANCHOR = [[-8300, 2000, -1200], [-500, -1600, -4600]];   // (the bowl's anchor: its west corner, along it to the mountains)

  // ---- 1 · the pool's pit: the deep first -------------------------------------------------------------
  const B = IBIZA.pool, scr = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  Object.assign(st, { wallKind: 'pool', poolLayer: 'pit' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(0, ['*Pool', 'Strip', 'Slab'], 'wall');
  shots([[1.0, [-5200, 4200, -900], [-5600, -900, -3300]], [1.4, [6400, 1700, -1100], [-2500, -1300, -4600]]]);
  { const a = P(B.x0, 0, B.z0), b = P(B.x1, 0, B.z1); pw.down(a, scr(a)); pw.move(b, scr(b)); pw.up(); }
  const R = () => pw.rec, belts = () => pw._belts(R());
  yield d.sec(0.5);
  say('pool ' + JSON.stringify([R()?.L, R()?.W]));
  d.speed = 6;
  pw._dig(R(), null);
  yield d.until(idle);
  d.speed = 1;
  const mid = (q) => [(q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2];
  // (the top of a piece over the ground, mm: [mean, lowest, highest] over a grid 300 in from its edges)
  const topsOf = (q) => { const hs = []; for (let x = q.x0 + 300; x <= q.x1 - 300; x += 300) for (let z = q.z0 + 300; z <= q.z1 - 300; z += 300) hs.push((T.heightAt(MM(x), MM(z)) - g) / S); return [Math.round(hs.reduce((a, v) => a + v, 0) / hs.length), Math.round(Math.min(...hs)), Math.round(Math.max(...hs))]; };
  d.stageBill('EXCAVATION · 104 m³');
  yield d.sec(0.6);
  // ---- 3 · the beds: the pool's stone and lean concrete; sand and stone under the rest, rammed -------
  d.speed = 8;
  shots([[1.2, [-6300, -1100, -2800], [-500, -1750, -4500]], [1.0, [-2500, 2600, -3200], [-2800, -1800, -4400]], [1.3, ...ANCHOR]]);
  pw._bed(R(), null);
  yield d.until(idle);
  d.speed = 1;
  say('bed done');
  // ---- 4 · the pool's shell: the floor's boards and bars, its concrete; the walls' bars and forms, their concrete ----
  const fresh = () => { const now = T.clock || app.clock; for (let i = 0; i < T.conc.length; i++) if (T.conc[i] > 0) T.cTime[i] = now; };
  const hose = app.concreteTools.hose, at = (s, t, y) => { const [x, z] = PW(R(), s, t); return new V(x, y, z); };
  // (the hose led along a path till `full` says so, the game's clock of setting held — a real pour is one go)
  // (the hose led along a path till `full` says so — at a hand's pace on the screen: the film's time is bought with the pump's
  // delivery, not with the speed of the hand (the owner: the hose went mad); `belt` — what it pours into, named outright: found
  // by no ray of the screen, a phone's frame is not the test's; the game's clock of setting held — a real pour is one go)
  const pour = function* (path, full, TP, max, o = {}) {
    app.setTool('hose'); hud(3, ['*Hose', 'Vibrator', 'Rule'], 'hose');
    const pump0 = st.pump, ev = (q) => (o.belt && o.belt() ? { target: o.belt().id, hit: q } : undefined);
    // (the pump starts when the spout has come over the place: it travels there from where it hung — pouring on the way, it
    // left a cubic metre across the site, outside the boards)
    st.pump = 1e-5;
    { const p0 = path(0); hose.down(p0, ev(p0)); let w = 0; d.speed = 4;
      yield d.until(() => { w += d.dt * d.speed; hose.move(p0, ev(p0)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - p0.x, sp.z - p0.z) < MM(250)); }); }
    st.pump = o.pump ?? 2.5;
    let pt = 0; d.speed = o.v ?? 6;
    yield d.until(() => { pt += d.dt * d.speed; fresh(); o.each?.(pt); const q = path(o.wrap === false ? Math.min(1, pt / TP) : (pt / TP) % 1); hose.move(q, ev(q)); for (let n = 0; n < (o.poke || 0); n++) T.vibrate(q.x, q.z, MM(1700)); return full() || pt > max; });
    hose.up(); d.speed = 4;
    yield d.until(idle);
    d.speed = 1; G.set(null); st.pump = pump0;
    return pt;
  };
  Object.assign(st, { wallKind: 'pool' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(1, ['*Pool floor', 'Pool walls'], 'wall');
  shots([[1.2, [2600, 1800, -3600], [2200, -1600, -4400]], [1.2, [-6300, -1100, -2800], [-500, -1750, -4500]]]);
  d.speed = 8;
  pw._form1(R(), null);
  yield d.until(idle);
  pw._cage1(R(), belts().fb);
  yield d.until(idle);
  say('floor belt ' + JSON.stringify({ fb: !!belts().fb, cage: R().cage1 }));
  shots([[1.5, [3700, -1250, -5300], [-2500, -1550, -4200]], [1.0, [-800, 2300, -3500], [-1000, -1550, -4400]], [1.4, ...ANCHOR]]);
  { const r = R(), yF = floorTopY(r);
    const t1 = yield* pour((u) => at(r.L * (0.04 + 0.92 * u), r.W * (0.5 + 0.46 * Math.sin(u * Math.PI * 12)), yF), () => { const c = hose.ch; if (!c?.h) return false; let a = 0; for (let i = 0; i < c.h.length; i++) a += c.h[i]; const cap = c.cap || 1e9; a = 0; for (let i = 0; i < c.h.length; i++) a += Math.min(cap, c.h[i]); return c.full || a / c.h.length >= cap * 0.975; }   /* (what is heaped over the boards' tops does not count: the record's `fill` clamps it too) */, 14, 60, { belt: () => belts().fb, pump: 6 });   // (the record's `fill` is written when the hose is let go: the channel says when it is full)
    say('floor fill ' + belts().fb?.fill + ' in ' + t1.toFixed(0)); }
  // (two days: the floor hard enough for the walls' forms)
  d.hud(null);
  shots([[9, ...ANCHOR]]);
  yield* d.lapse(2, 1.3, () => { app.clock += 2400 * d.dt / 1.3; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  Object.assign(st, { wallKind: 'pool' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(1, ['Pool floor', '*Pool walls'], 'wall');
  shots([[1.0, [3600, -300, -5200], [-3500, -700, -5650]], [1.0, [5200, 3200, -1900], [3900, -300, -3200]]]);
  d.speed = 8;
  pw._cage2(R(), belts().fb);
  yield d.until(idle);
  pw._form2(R(), belts().fb, null);
  yield d.until(idle);
  say('wall belt ' + !!belts().wb);
  shots([[1.5, [-7300, 1000, -6300], [1000, 150, -5800]], [1.0, [4700, 2700, -4000], [4150, 150, -4400]], [1.8, [8500, 4800, 1800], [-1500, -300, -4500]]]);
  { const r = R(), yW = wallTopY(r), o = -125, w = r.L + 250, h = r.W + 250, per = 2 * (w + h);
    const round = (u) => { const dd = u * per; const [ss, tt] = dd < w ? [o + dd, o] : dd < w + h ? [r.L - o, o + dd - w] : dd < 2 * w + h ? [r.L - o - (dd - w - h), r.W - o] : [o, r.W - o - (dd - 2 * w - h)]; return at(ss, tt, yW); };
    const t2 = yield* pour(round, () => !belts().wb || !!hose.ch?.full, 30, 90, { belt: () => belts().wb, pump: 6 });
    say('wall fill ' + belts().wb?.fill + ' in ' + t2.toFixed(0)); }
  d.stageBill('POOL SHELL');
  yield d.sec(0.6);

  // (the deep finished first — the realist: three days, the walls' forms off, the gap round the shell filled back in layers —
  // before anything shallow is dug beside it)
  d.hud(null);
  shots([[9, [-3500, 1600, 900], [-1500, -200, -4400]]]);
  yield* d.lapse(3, 1.4, () => { app.clock += 9000 * d.dt / 1.4; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  shots([[0.8, [-3500, 1600, 900], [-1500, -200, -4400]], [1.0, [-7400, 2600, -3600], [-6500, -900, -4400]], [1.5, [5600, 1300, -1700], [-2500, -500, -2600]]]);
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
  shots([[1.2, [6900, 1900, 8200], [6000, -300, 3500]]]);
  d.speed = 3;
  digPit(app, O.get(pits.spine.id));
  yield d.until(idle);
  d.speed = 10;
  shots([[1.3, [9500, 6500, 9500], [-500, 0, 500]]]);
  digPit(app, O.get(pits.slab.id));
  yield d.until(idle);
  digPit(app, O.get(pits.pad.id));
  yield d.until(idle);
  d.speed = 1;
  app.budget._pay([{ usd: 650 }], P(0, 0, 0));   // (the shallow pits: ~28 m³ taken away)
  say('dug ' + ['spine', 'slab', 'pad'].map((k) => Math.round((T.heightAt(MM((IBIZA[k].x0 + IBIZA[k].x1) / 2), MM((IBIZA[k].z0 + IBIZA[k].z1) / 2)) - g) / S)).join(' '));

  shots([[1.2, [6900, 3000, 1500], [6000, -350, 500]]]);
  d.speed = 4;
  bedPit(app, O.get(pits.spine.id), IBIZA.spine.bed, 'g20');
  yield d.until(idle);
  d.speed = 12;
  shots([[1.2, [-6800, 1500, 6200], [1500, -300, 300]], [1.1, [-8700, 3400, 5400], [-7900, -150, 3250]]]);
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
  for (const k of keys) { st.slab = IBIZA[k].h; const o = O.get(pits[k].id), y1 = F.topFor(o); runsOf[k] = edges(o).map((e) => F.run(e.a, e.b, e.n, y1, { outlineId: o.id })); }   // (550 between the slab and the strip: room for both rows of boards and their stakes — the realist's other way; the shared board leaked)
  const save = (id, list) => () => app.journal.act('formwork', { outlineId: id }, app.clock, () => { for (const r of list) O.add(r); });
  shots([[1.2, [7300, 1300, 7400], [6000, 100, 6050]], [1.0, [7400, 2400, -8600], [5800, 0, 500]]]);
  { const rs = runsOf.spine.slice().sort((p, q) => q.n[1] - p.n[1]); d.speed = 5; F._fitRuns([rs[0]], true, save(pits.spine.id, [rs[0]])); yield d.until(idle); d.speed = 10; F._fitRuns(rs.slice(1), false, save(pits.spine.id, rs.slice(1))); yield d.until(idle); }
  shots([[1.0, [-5600, 4500, 5200], [-4300, 0, 3400]]]);
  d.speed = 14;
  for (const k of ['slab', 'pad']) { F._fitRuns(runsOf[k], false, save(pits[k].id, runsOf[k])); yield d.until(idle); }
  d.speed = 1;
  d.stageBill('BOARDS & STAKES');
  yield d.sec(0.6);
  say('forms ' + O.all('form').length);
  app.setTool('rebar'); app.rebarTool.setMode('cage');
  hud(2, ['*Cage Ø16 / 200', 'Bar', 'Mesh'], 'rebar');
  shots([[1.4, [3600, 1300, 7600], [6000, 0, 4300]], [1.0, [6800, 3200, -600], [6000, 0, -1500]]]);
  for (const k of keys) {
    st.slab = IBIZA[k].h; st.rebarD = k === 'spine' ? 16 : 12; st.cover = 110;   // (the boards stand inside the outline and the strip's concrete a little under their tops: with the cover of 50 the cage's chairs stood in its side faces — the owner: «торчит арматура»; 110 keeps every bar well inside)
    app.rebarTool.cageIn(O.get(pits[k].id));
    yield d.until(() => !!app.physJob || O.all('cage').some((c) => c.outlineId === pits[k].id));
    d.speed = k === 'spine' ? 2.5 : 16;
    if (k === 'spine') { yield d.sec(1.2); d.speed = 12; }
    if (k === 'slab') shots([[1.2, [8200, 3000, 7400], [-500, 0, 800]], [1.0, [-7400, 900, 7300], [-7900, 100, 3200]]]);
    yield d.until(idle);
  }
  d.speed = 1;
  d.stageBill('REBAR');
  yield d.sec(0.6);
  say('cages ' + O.all('cage').length);
  // (the concrete: the strip along, the slab row by row, the pad — one go)
  for (const k of keys) {
    const q = IBIZA[k], v0 = T.concVolume(), want = MM(q.x1 - q.x0) * MM(q.z1 - q.z0) * MM(q.h), rows = Math.max(1, Math.round((q.x1 - q.x0) / 1300));
    const path = (u) => { const i = Math.min(rows - 1, Math.floor(u * rows)), f = u * rows - i, x = q.x0 + (q.x1 - q.x0) * (i + 0.5) / rows, z = q.z0 + (q.z1 - q.z0) * (0.12 + 0.76 * (i % 2 ? 1 - f : f)); return P(x, 0, z); };
    if (k === 'spine') shots([[1.0, [6900, 2800, 5300], [6000, 200, 4500]], [1.5, [6500, 700, -7600], [5900, 150, -1000]]]);   // (the hose starts at the strip's +z end and goes toward the sea: its first load steeply from above, then low along, the front going away to the sea… seen from the sea's end coming at the camera)
    if (k === 'slab') shots([[1.5, [-7800, 4200, 7200], [-200, 150, 900]], [1.2, [700, 900, 5200], [-600, 250, 1800]]]);
    if (k === 'pad') shots([[1.0, [-8500, 3200, 2400], [-7900, 250, 3250]]]);
        const rate = k === 'slab' ? 1.25 : 0.3125, whole = want * MODEL_SCALE ** 3 / rate;
    // (what lies inside the outline, not what left the hose: some of it goes over the boards — and the poker follows the hose,
    // as a crew's does, so the heap under the stream runs out along the form instead of over its boards)
    const cellsIn = []; for (let i = 0; i < T.conc.length; i++) { const x = T.toWorldX(i % T.nx) / S, z = T.toWorldZ(Math.floor(i / T.nx)) / S; if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) cellsIn.push(i); }
    const inside = () => { let v = 0; for (const i of cellsIn) v += T.conc[i]; return v * T.cell * T.cell; };
    const tp = yield* pour(path, () => inside() >= want * (k === 'pad' ? 0.93 : k === 'spine' ? 0.9 : 0.975),   /* (the strip: what its boards hold is ~0.92 of the outline's — more only goes over them) */ k === 'slab' ? whole / 2 : whole, whole * 1.3, { v: k === 'slab' ? 8 : 10, pump: rate, wrap: k === 'slab', poke: 5 });   // (the narrow ones at the game's own delivery: at twice that the heap under the stream stood 400 over a strip 1.5 m wide and went over its boards)   // (the narrow ones in one slow pass: the spout lags the hand by up to a metre when it is swept — on a strip 1.5 m wide it poured past the boards)
    { const inV = (m) => { let v = 0; for (let i = 0; i < T.conc.length; i++) { if (!(T.conc[i] > 0)) continue; const x = T.toWorldX(i % T.nx) / S, z = T.toWorldZ(Math.floor(i / T.nx)) / S; if (x >= q.x0 - m && x <= q.x1 + m && z >= q.z0 - m && z <= q.z1 + m) v += T.conc[i]; } return +(v * T.cell * T.cell * MODEL_SCALE ** 3).toFixed(1); }; say(k + ' inside ' + inV(0) + ' +200: ' + inV(200) + ' +1000: ' + inV(1000) + ' base ' + Math.round((T.nat[T.index(MM(mid(q)[0]), MM(mid(q)[1]))] + T.loose[T.index(MM(mid(q)[0]), MM(mid(q)[1]))] - g) / S)); }
    say(k + ' tops after pour ' + JSON.stringify(topsOf(q)));
    say(k + ' poured ' + ((T.concVolume() - v0) * MODEL_SCALE ** 3).toFixed(1) + ' of ' + (want * MODEL_SCALE ** 3).toFixed(1) + ' in ' + tp.toFixed(0));
  }
  // (the poker round all of it — the crew's round — and the rule over the slab)
  let shake = () => {};
  app.setTool('vibro'); hud(3, ['Hose', '*Vibrator', 'Rule'], 'vibro');
  { const vib = app.concreteTools.vibro; let vt = 0; const sp = []; for (const k of keys) { const q = IBIZA[k]; for (let x = q.x0 + 400; x < q.x1; x += 1100) for (let z = q.z0 + 400; z < q.z1; z += 1100) sp.push([x, z]); }
    shake = (n) => { for (let q = 0; q < n; q++) for (const [x, z] of sp) T.vibrate(MM(x), MM(z), MM(1300)); };   // (the crew's whole round with the poker goes on meanwhile: all of it kept shaking, so it runs level — the film's seconds are few)
    const dips = [[-1400, 2400], [-300, 1500], [400, 2300], [-900, 1100]];   // (in the frame: four dips the eye can follow — the director)
    shots([[1.6, [700, 900, 3800], [-600, 250, 1800]]]);
    vib.down(P(dips[0][0], 0, dips[0][1])); d.speed = 3;
    yield d.until(() => { vt += d.dt * d.speed; fresh(); shake(10); const i = Math.floor(vt / 1.1); if (i < dips.length) vib.move(P(dips[i][0], 0, dips[i][1])); return i >= dips.length; });
    vib.up(); yield d.until(idle); }
  app.setTool('screed'); hud(3, ['Hose', 'Vibrator', '*Rule'], 'screed');
  { const rule = app.concreteTools.screed, q = IBIZA.slab; d.speed = 9;
    shots([[1.3, [-1300, 3200, 2100], [-2000, 250, 1500]], [1.5, [2000, 950, 6300], [2600, 250, 500]]]);
    for (let i = 0, x = -4000; x < q.x1; x += 2000, i++) { fresh(); const z0 = i % 2 ? q.z0 + 150 : q.z1 - 150, z1 = i % 2 ? q.z1 - 400 : q.z0 + 400; rule.down(P(x, 0, z0)); let u = 0;
      yield d.until(() => { shake(2); u = Math.min(1, u + d.dt * d.speed / 4); rule.move(P(x, 0, z0 + (z1 - z0) * u)); return u >= 1; }); rule.up(); yield d.until(idle); } }
  d.speed = 1; G.set(null);
  d.stageBill('CONCRETE');
  yield d.sec(0.6);
  say('tops ' + JSON.stringify(keys.map((k) => topsOf(IBIZA[k]))));

  // (what went over the boards shovelled away while it is soft — the crew's five minutes, between two shots)
  { const keep = (x, z) => keys.some((k) => { const q = IBIZA[k]; return x >= q.x0 - 60 && x <= q.x1 + 60 && z >= q.z0 - 60 && z <= q.z1 + 60; }) || (x > B.x0 - 1200 && x < B.x1 + 1200 && z > B.z0 - 1200 && z < B.z1 + 1200);
    let n = 0; for (let i = 0; i < T.conc.length; i++) if (T.conc[i] > 0) { const x = T.toWorldX(i % T.nx) / S, z = T.toWorldZ(Math.floor(i / T.nx)) / S; if (!keep(x, z)) { T.conc[i] = 0; n++; } }
    if (n) { T._concTouch(0, 0, T.rx, T.rz); T._touch(0, 0, T.rx, T.rz); T.updateMesh?.(); } say('spill cells cleared ' + n); }
  // ---- 6 · a week; the boards off; the gap round the pool filled back ----------------------------------
  d.hud(null);
  shots([[9, [-9000, 6000, 11000], [500, 0, -800]]]);
  yield* d.lapse(7, 2.4, () => { app.clock += 9000 * d.dt / 2.4; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(16.5);
  app.setTool('form'); F.setMode('strip');
  // (the owner: the boards must be stacked neatly on the plot — the game's own stripping does it: knocked off, carried one by one
  // to the stack; it is shown for the strip at a pace the eye follows, the slab's and the pad's are done between two shots)
  const strip = (k) => { const [x, z] = mid(IBIZA[k]), p = P(x, 0, z); F.strip(p, scr(p)); return () => !O.all('form').some((r) => r.outlineId === pits[k].id) && idle(); };
  d.next();
  shots([[1.3, [8600, 1100, 3000], [6700, 150, 600]], [1.2, [8200, 2600, -7400], [6200, 100, -1500]], [1.1, [7300, 1300, 7400], [6000, 100, 6050]]]);
  // (the braces knocked off, the stakes out, the first boards toppling — at a pace the eye follows; the carrying to the stack
  // is the crew's next hour: between two shots)
  d.speed = 2.5;
  { const f = strip('spine'); yield d.sec(2.6); d.speed = 1; d.jumpTo(f, 900); }
  for (const k of ['slab', 'pad']) { const f = strip(k); d.jumpTo(f, 900); }
  shots([[1.2, [8900, 2300, 4200], [7200, 0, 1500]], [1.1, [-5900, 3800, 5000], [-4700, 200, 3800]]]);
  yield d.sec(2.3);
  say('forms left ' + O.all('form').length);
  d.speed = 1;
  yield d.sec(0.2);
  shotN++;
  // ---- the hook (put first by the recorder): low along the bare strip to the pool's shell and the sea ----
  d.cut(look(P(6500, 1250, 9600), P(4300, 100, -4000)), { drift: 0.012, push: 0.015, hand: 0.3 });
  yield d.sec(0.3);
  d.found = { tops: keys.map((k) => topsOf(IBIZA[k])[0]), range: keys.map((k) => topsOf(IBIZA[k])), forms: O.all('form').length, pool: { fs: !!belts().fb?.stripped, ws: !!belts().wb?.stripped, filled: !!R().filled } };
  d.mark('hook');
  d.kick('70 TONNES ON THIS?', 2.2, 'top');
  yield d.sec(2.4);
  d.mark('hookEnd');
  yield d.sec(0.1);
}
foundFilm.seconds = 34;
foundFilm.place = 'beach';
foundFilm.sounds = ['shovel_dig', 'soil_dump', 'gravel_pour', 'compactor', 'hammer_nail', 'plank', 'stake', 'rebar', 'wire', 'pump', 'concrete', 'concrete_splat', 'vibrator', 'screed', 'till', 'tap', 'waves', 'wind'];
