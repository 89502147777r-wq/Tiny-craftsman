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
  // (the owner: a few of the site's things for the look — the toilet, the mixer, pallets; away from the work and the cameras' axes)
  for (const [kind, x, z, yaw] of [['toilet', 13800, 9800, -0.4], ['mixer', 11600, 7600, 0.7], ['pallet', 10200, 10400, 0.05], ['pallet', 11700, 10600, -0.08]]) O.add({ type: 'siteprop', kind, x: +MM(x).toFixed(5), z: +MM(z).toFixed(5), yaw });
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
  // an action by «нарастание» (the owner's rule, 2026-11-13): the first shot opens on the action itself at its real pace, the next from
  // another angle faster, the next from another fast — and on, cutting every 1–3 s. In a shot the camera stands (a tripod) and
  // pans after the tool — the bucket's teeth, the spout, the plate, the poker, the rule: the work never goes out of the frame
  // (the owner: «like watching a race from the stands» — the plate passing a camera that looked at one spot).
  // list: [seconds, [dx, height over the site, dz] mm from the tool when cut, speed] — after the last, the last two by turns
  const toolPt = () => {
    if (excOn != null && mt.exc) { const ph = mt._ad?.ph; if (!toolPt.e || ['reach', 'lower', 'drag', 'curl'].includes(ph)) toolPt.e = mt.exc.teethWorld(new V()); return toolPt.e.clone(); }
    if (G.show === 'hose' && G.pump?.ready) return G.pump.spout().clone().add(new V(0, -MM(400), 0));
    if (G.show) return G.pos.clone();
    return null;
  };
  const act = (list, fallback = null) => {
    const id = ++shotN; let k = -1, t1 = -1, eye = null, aim = null, sp = 1, sec0 = 0;
    const f = () => {
      if (id !== shotN) return true;
      const p = toolPt() || (fallback && P(...fallback)); if (!p) return false;
      // (the machine, going along its pit, come up to the camera: the next angle)
      if (eye && excOn != null && mt.exc && d.t > t1 - sec0 + 0.4 && Math.hypot(eye.x - mt.exc.x, eye.z - mt.exc.z) < MM(5500)) t1 = d.t;   // (not twice in 0,4 s)
      if (d.t >= t1 || !eye) {
        k++; const L = list.length, i = k < L ? k : L - 2 + ((k - L) % 2), [sec, [dx, dy, dz], v] = list[Math.max(0, i)];
        eye = new V(p.x + MM(dx), g + MM(dy), p.z + MM(dz)); aim = p.clone(); sp = v;
        // (never in a thing's face: drawn in toward the tool till 2,5 m clear of the site's things and 4 m of the machine's body)
        const clear = () => [...O.all('siteprop').map((r) => [r.x, r.z, MM(2500)]), ...(mt.exc ? [[mt.exc.x, mt.exc.z, MM(6000)]] : [])].every(([x, z, r]) => Math.hypot(eye.x - x, eye.z - z) > r);
        for (let n = 0; n < 12 && !clear(); n++) { eye.x = p.x + (eye.x - p.x) * 0.85; eye.z = p.z + (eye.z - p.z) * 0.85; }
        d.cut(look(eye, aim), { drift: 0.004, push: 0.006, hand: 0.2 }); t1 = d.t + sec; sec0 = sec;
      } else { aim.lerp(p, 1 - Math.exp(-d.dt * 2.5)); const vw = look(eye, aim); if (d.shot) d.shot.goal = d.shot.from = d._full(vw, d.shot.goal); }
      d.speed = sp; if (excOn != null) excOn = sp;
      return false;
    };
    f(); d.each(f);
  };
  const stopAct = () => { ++shotN; };
  const ANCHOR = [[-8300, 2000, -1200], [-500, -1600, -4600]];   // (the bowl's anchor: its west corner, along it to the mountains)
  // the excavator of the game, driven as a driver drives it (the owner: the digging by «нарастание» — the machine digging close at
  // its real pace, the bucket tipped where it is seen, then faster, then in cuts): [game s, left x, left y, right x, right y] — the
  // stick out, the boom down, the bucket curled in, up, swung round, opened, swung back
  const mt = app.machineTool;   // (driven by the game's driver, mt.excDrive: tipped behind it, off the marked pit)
  let excOn = null;   // (the speed it digs at; null — parked)
  // (yaw — the tracks' way: along the pit's edge; sw — the house turned to the pit: it digs to its side and tips to the other, off
  // the marking; it travels only along its tracks — the owner: «it moves sideways, against all sense»)
  const excAt = function* (x, z, yaw, sw = 0) {
    if (!mt.recOf('excavator')) O.add({ type: 'vehicle', kind: 'excavator', x: MM(x), z: MM(z), yaw, swing: 0, boom: 0, stick: 0, curl: 0, load: 0 });
    let ok = false; mt.ensureExc().then(() => { ok = true; }); yield d.until(() => ok);
    const E = mt.exc; E.place(T, MM(x), MM(z), yaw); for (const k of ['swing', 'boom', 'stick', 'curl']) E[k] = E[k + 'Goal'] = 0; E.swing = E.swingGoal = sw; E.load = 0; E.update(0); mt.excMode = 'dig'; mt._ad = null;
  };
  { d.each(() => { if (excOn == null || !mt.exc) return false; let dt = d.dt * excOn; app.sfx?.engine?.('excavator', 0.55); app.sfx?.engine?.('hydraulic', 0.4);
      while (dt > 1e-6) { const h = Math.min(dt, 1 / 30); mt.excDrive(h); dt -= h; }   // (the game's driver: teeth first — the owner saw the bucket's heel press and the machine rise)
      return false; }); }
  // a time-lapse of the digging (the owner: a pit growing fast under a bucket working at its pace is nonsense — the real buckets are
  // shown at ×1 and ×3, then the clock): the pits' own jobs run on under the clock, the machine travelling along its tracks
  // from a to b (mm), the house as it was
  const digLapse = function* (jobs, a, b, yaw, days = 1, dur = 1.6) {
    excOn = null; app.sfx?.engine?.('excavator', 0); app.sfx?.engine?.('hydraulic', 0);
    let k = 0; const ts = d.t; jobs[0]?.();
    yield* d.lapse(days, dur, () => {
      app.clock += 9000 * d.dt / dur; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 });
      app.simulate(1.2, 1 / 15); if (idle() && k + 1 < jobs.length) jobs[++k]();
      const u = Math.min(1, (d.t - ts) / dur); if (mt.exc) { mt.exc.place(T, MM(a[0] + (b[0] - a[0]) * u), MM(a[1] + (b[1] - a[1]) * u), yaw); mt.exc.update(0); }
    });
    while (k + 1 < jobs.length) { d.jumpTo(idle, 3000); jobs[++k](); }
    d.jumpTo(idle, 3000);
    app.sky.setHour(9.5);
  };
  const excOff = (x, z, yaw) => { excOn = null; app.sfx?.engine?.('excavator', 0); app.sfx?.engine?.('hydraulic', 0); if (mt.exc) { mt.exc.place(T, MM(x), MM(z), yaw); for (const k of ['swing', 'boom', 'stick', 'curl']) mt.exc[k] = mt.exc[k + 'Goal'] = 0; mt.exc.update(0); } };
  // (the soil it tipped beside the pit: taken away by the trucks — between two shots; what lies outside `keep` as it was before)
  const spoil0 = () => T.loose.slice(), haul = (was, keep) => { for (let i = 0; i < T.loose.length; i++) if (T.loose[i] > was[i] + 1e-7) { const x = T.toWorldX(i % T.nx) / S, z = T.toWorldZ(Math.floor(i / T.nx)) / S; if (!keep(x, z)) T.loose[i] = was[i]; } T._touch(0, 0, T.rx, T.rz); };
  // (the first piece of a job at its real pace, close; then faster: when `on()` comes, `slow` s of film at `v0`, then `v1`)
  const firstSlow = (on, view, slow, v0, v1) => { let t0 = null; d.each(() => { if (t0 == null) { if (!on()) return false; t0 = d.t; d.speed = v0; if (view) shots(view); } if (d.t - t0 >= slow) { d.speed = v1; return true; } return false; }); };

  // ---- 1 · the pool's pit: the deep first -------------------------------------------------------------
  const B = IBIZA.pool, scr = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  Object.assign(st, { wallKind: 'pool', poolLayer: 'pit' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(0, ['*Pool', 'Strip', 'Slab'], 'wall');
  { const a = P(B.x0, 0, B.z0), b = P(B.x1, 0, B.z1); pw.down(a, scr(a)); pw.move(b, scr(b)); pw.up(); }
  const R = () => pw.rec, belts = () => pw._belts(R());
  say('pool ' + JSON.stringify([R()?.L, R()?.W]));
  yield* excAt(2500, -100, Math.PI, -Math.PI / 2);   // (its tracks along the pit's edge 1,8 m back from it, the house turned to the pit)
  const was0 = spoil0();
  // (by «нарастание»: close beside the boom at its real pace — the teeth going in, the bucket filling; from the pit's far side
  // faster — the camera panning after the bucket; then the clock: the pit dug, the machine backed along its edge)
  excOn = 1;
  act([[2.8, [2600, 1200, 2300], 1], [2.6, [-2600, 700, -2600], 3]]);
  yield d.sec(5.4);
  say('exc done');
  stopAct(); d.speed = 1;
  shots([[9, [-9200, 2600, 1500], [-1000, -800, -4400]]]);
  yield* digLapse([() => pw._dig(R(), null)], [2500, -100], [-4500, -100], Math.PI);
  say('pit done');
  excOff(15000, -9500, Math.PI);
  haul(was0, (x, z) => x > B.x0 - 900 && x < B.x1 + 900 && z > B.z0 - 900 && z < B.z1 + 900);   // (the spoil behind it: the trucks', between two shots)
  const mid = (q) => [(q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2];
  // (the top of a piece over the ground, mm: [mean, lowest, highest] over a grid 300 in from its edges)
  const topsOf = (q) => { const hs = []; for (let x = q.x0 + 300; x <= q.x1 - 300; x += 300) for (let z = q.z0 + 300; z <= q.z1 - 300; z += 300) hs.push((T.heightAt(MM(x), MM(z)) - g) / S); return [Math.round(hs.reduce((a, v) => a + v, 0) / hs.length), Math.round(Math.min(...hs)), Math.round(Math.max(...hs))]; };
  d.stageBill('EXCAVATION · 104 m³');
  yield d.sec(0.6);
  // ---- 3 · the beds: the pool's stone and lean concrete; sand and stone under the rest, rammed -------
  // (the stone tipped, raked, the plate over it — by «нарастание», the camera after the rake and the plate)
  act([[2.0, [-4200, 2300, 3200], 1], [2.0, [4400, 2000, 2600], 3], [1.8, [-5600, 2600, 2800], 6], [1.8, [4800, 2100, -900], 6]], [-1000, -1500, -4400]);   // (from the pit's edge, a medium shot — not a heap of stone close up in the pit: the owner)
  pw._bed(R(), null);
  yield d.until(idle);
  stopAct(); d.speed = 1;
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
  shots([[1.2, [4600, 900, -1800], [1000, -1500, -4400]], [1.2, [-7600, 1100, -6900], [-1500, -1500, -4300]]]);
  d.speed = 8;
  pw._form1(R(), null);
  yield d.until(idle);
  pw._cage1(R(), belts().fb);
  yield d.until(idle);
  say('floor belt ' + JSON.stringify({ fb: !!belts().fb, cage: R().cage1 }));
  act([[2.2, [2200, 1000, 1900], 1], [2.0, [-2600, 800, -1900], 3], [1.8, [-6000, 2300, 2300], 6], [1.8, [4300, 1300, -1300], 6]]);
  { const r = R(), yF = floorTopY(r);
    const t1 = yield* pour((u) => at(r.L * (0.04 + 0.92 * u), r.W * (0.5 + 0.46 * Math.sin(u * Math.PI * 12)), yF), () => { const c = hose.ch; if (!c?.h) return false; let a = 0; for (let i = 0; i < c.h.length; i++) a += c.h[i]; const cap = c.cap || 1e9; a = 0; for (let i = 0; i < c.h.length; i++) a += Math.min(cap, c.h[i]); return c.full || a / c.h.length >= cap * 0.975; }   /* (what is heaped over the boards' tops does not count: the record's `fill` clamps it too) */, 14, 60, { belt: () => belts().fb, pump: 6 });   // (the record's `fill` is written when the hose is let go: the channel says when it is full)
    stopAct(); say('floor fill ' + belts().fb?.fill + ' in ' + t1.toFixed(0)); }
  // (two days: the floor hard enough for the walls' forms)
  d.hud(null);
  shots([[9, ...ANCHOR]]);
  yield* d.lapse(2, 1.3, () => { app.clock += 2400 * d.dt / 1.3; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  Object.assign(st, { wallKind: 'pool' }); app.setTool('wall'); app.wallTool.setMode('lay');
  hud(1, ['Pool floor', '*Pool walls'], 'wall');
  shots([[1.2, [5600, 1000, -7600], [-1500, -400, -5200]], [1.2, [-7900, 1200, -1900], [-1000, -300, -4400]]]);
  d.speed = 8;
  pw._cage2(R(), belts().fb);
  yield d.until(idle);
  pw._form2(R(), belts().fb, null);
  yield d.until(idle);
  say('wall belt ' + !!belts().wb);
  act([[2.2, [1900, 900, 1700], 1], [2.0, [-2300, 700, -2000], 3], [1.8, [3600, 1800, 3000], 6], [1.8, [-4000, 1200, 1500], 6]]);
  { const r = R(), yW = wallTopY(r), o = -125, w = r.L + 250, h = r.W + 250, per = 2 * (w + h);
    const round = (u) => { const dd = u * per; const [ss, tt] = dd < w ? [o + dd, o] : dd < w + h ? [r.L - o, o + dd - w] : dd < 2 * w + h ? [r.L - o - (dd - w - h), r.W - o] : [o, r.W - o - (dd - 2 * w - h)]; return at(ss, tt, yW); };
    // (as on a site: the hose over the gap between the boards, round and round — a layer each lap, not one wave the wall's height;
    // the first stretch at the corner at a hand's real pace)
    const t2 = yield* pour(round, () => !belts().wb || !!hose.ch?.full, 22, 300, { belt: () => belts().wb, pump: 3.5, v: 2, });
    stopAct(); say('wall fill ' + belts().wb?.fill + ' in ' + t2.toFixed(0)); }
  d.stageBill('POOL SHELL');
  yield d.sec(0.6);

  // (the deep finished first — the realist: three days, the walls' forms off, the gap round the shell filled back in layers —
  // before anything shallow is dug beside it)
  d.hud(null);
  shots([[9, [-3500, 1600, 900], [-1500, -200, -4400]]]);
  yield* d.lapse(3, 1.4, () => { app.clock += 9000 * d.dt / 1.4; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  shots([[0.8, [-3500, 1600, 900], [-1500, -200, -4400]], [1.2, [-9200, 1200, -2400], [-5500, -600, -4600]], [1.5, [5600, 1300, -1700], [-2500, -500, -2600]]]);
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
  const pits = {}, keys0 = ['spine', 'slab', 'pad'];
  for (const k of ['spine', 'slab', 'pad']) { const q = IBIZA[k]; pits[k] = O.add({ type: 'outline', kind: 'rect', x0: MM(q.x0), z0: MM(q.z0), x1: MM(q.x1), z1: MM(q.z1), depth: +((q.h + q.bed - IBIZA.up) / MODEL_SCALE).toFixed(2) }); }
  // (the owner: once in the film, a shower — about ten seconds: over the trenches, the boards and the cages, before the concrete)
  st.weather = 'rain'; const rainFrom = d.t;
  yield* excAt(9300, 4000, Math.PI / 2, Math.PI / 2);   // (its tracks along the trench, 3 m east of it, the house turned to it; it tips to the east)
  const was1 = spoil0();
  // (by «нарастание», the camera across the trench from the machine panning after the bucket: close ×1, then faster; then the clock)
  excOn = 1;
  act([[2.8, [-1700, 1100, 2600], 1], [2.6, [-2900, 600, -2500], 3]]);
  yield d.sec(5.4);
  stopAct(); d.speed = 1;
  shots([[9, [2600, 2300, -9800], [7000, -200, 1000]]]);
  yield* digLapse([() => digPit(app, O.get(pits.spine.id))], [9300, 4000], [9300, -4000], Math.PI / 2);
  // (the slab's pit: the machine gone round to its north edge — its buckets at ×3 a moment, the clock again: the slab's and the
  // pad's pits dug, the machine travelling west along their edge)
  yield* excAt(4000, 7300, Math.PI, -Math.PI / 2);
  excOn = 1;
  act([[2.4, [2400, 1300, -3200], 3]]);
  yield d.sec(2.4);
  stopAct(); d.speed = 1;
  shots([[9, [-9000, 2600, -2000], [-1500, -300, 3200]]]);
  yield* digLapse([() => digPit(app, O.get(pits.slab.id)), () => digPit(app, O.get(pits.pad.id))], [4000, 7300], [-7900, 7300], Math.PI);
  excOff(15000, -9500, Math.PI);
  haul(was1, (x, z) => keys0.some((k) => { const q = IBIZA[k]; return x >= q.x0 - 300 && x <= q.x1 + 300 && z >= q.z0 - 300 && z <= q.z1 + 300; }));
  app.budget._pay([{ usd: 650 }], P(0, 0, 0));   // (the shallow pits: ~28 m³ taken away)
  st.weather = 'clear'; say('rain for ' + (d.t - rainFrom).toFixed(1) + ' s');   // (once, ~10 s: over the trenches being dug — the owner)
  say('dug ' + ['spine', 'slab', 'pad'].map((k) => Math.round((T.heightAt(MM((IBIZA[k].x0 + IBIZA[k].x1) / 2), MM((IBIZA[k].z0 + IBIZA[k].z1) / 2)) - g) / S)).join(' '));

  // (the beds: the stone tipped and spread, the plate over it — the camera after the plate; the heaps' tipping seen from the trench's end)
  act([[2.0, [3600, 2200, 3400], 1], [2.0, [-3800, 2000, -3000], 3], [1.8, [3800, 2400, -4200], 6], [1.8, [-3600, 2000, 3200], 6]], [6000, -300, 3000]);   // (from the trench's edge, medium)
  bedPit(app, O.get(pits.spine.id), IBIZA.spine.bed, 'g20');
  yield d.until(idle);
  act([[1.8, [2600, 1300, 2400], 6], [1.8, [-3000, 1400, 2200], 6]], [0, -200, 900]);
  bedPit(app, O.get(pits.slab.id), IBIZA.slab.bed, 'sand');
  yield d.until(idle);
  bedPit(app, O.get(pits.pad.id), IBIZA.pad.bed, 'g20');
  yield d.until(idle);
  stopAct(); d.speed = 1;
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
  { const rs = runsOf.spine.slice().sort((p, q) => q.n[1] - p.n[1]); d.speed = 1; F._fitRuns([rs[0]], true, save(pits.spine.id, [rs[0]])); yield d.sec(2.6); d.speed = 3; yield d.until(idle); shots([[1.6, [-1200, 1500, 9000], [5800, 0, 2000]], [1.4, [9600, 1400, -2600], [6000, 0, 1000]]]); d.speed = 6;   /* (the owner: the forms sped up too much — the process not felt: the first board ×1, then ×3, then ×6 from another angle) */ F._fitRuns(rs.slice(1), false, save(pits.spine.id, rs.slice(1))); yield d.until(idle); }
  shots([[1.2, [-8200, 1400, 6600], [-3500, 0, 3600]]]);
  d.speed = 6;
  for (const k of ['slab', 'pad']) { F._fitRuns(runsOf[k], false, save(pits[k].id, runsOf[k])); yield d.until(idle); }
  d.speed = 1;
  d.stageBill('BOARDS & STAKES');
  yield d.sec(0.6);
  say('forms ' + O.all('form').length);
  app.setTool('rebar'); app.rebarTool.setMode('cage');
  hud(2, ['*Cage Ø16 / 200', 'Bar', 'Mesh'], 'rebar');
  shots([[1.4, [3600, 1300, 7600], [6000, 0, 4300]], [1.2, [9300, 1300, 600], [6000, 0, -1500]]]);
  for (const k of keys) {
    st.slab = IBIZA[k].h; st.rebarD = k === 'spine' ? 16 : 12; st.cover = 110;   // (the boards stand inside the outline and the strip's concrete a little under their tops: with the cover of 50 the cage's chairs stood in its side faces — the owner: «торчит арматура»; 110 keeps every bar well inside)
    app.rebarTool.cageIn(O.get(pits[k].id));
    yield d.until(() => !!app.physJob || O.all('cage').some((c) => c.outlineId === pits[k].id));
    d.speed = k === 'spine' ? 1 : 8;
    if (k === 'spine') { yield d.sec(1.6); d.speed = 3; yield d.sec(1.4); d.speed = 7; }
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
    const path = (u) => { const i = Math.min(rows - 1, Math.floor(u * rows)), f = u * rows - i, x = q.x0 + 900 + (q.x1 - q.x0 - 1800) * (i + 0.5) / rows, z = q.z0 + 900 + (q.z1 - q.z0 - 1800) * (i % 2 ? 1 - f : f); return P(x, 0, z); };   // (0,9 m in from the boards: the heap under the stream runs out to them, not over)
    // (the hose by «нарастание»: close on the stream ×1, another side ×3, then fast — the camera after the spout)
    if (k === 'spine') act([[2.2, [2000, 900, 1800], 1], [2.0, [-2200, 700, -2400], 3], [1.8, [2600, 1600, -3800], 6], [1.8, [-2800, 1100, 2600], 6]]);
    if (k === 'slab') act([[1.8, [2400, 1200, 2200], 6], [1.8, [-3000, 1500, -2200], 6]]);
    if (k === 'pad') act([[1.6, [-2600, 1100, -2000], 6]]);
        const rate = k === 'slab' ? 0.625 : 0.3125, whole = want * MODEL_SCALE ** 3 / rate;
    // (what lies inside the outline, not what left the hose: some of it goes over the boards — and the poker follows the hose,
    // as a crew's does, so the heap under the stream runs out along the form instead of over its boards)
    const cellsIn = []; for (let i = 0; i < T.conc.length; i++) { const x = T.toWorldX(i % T.nx) / S, z = T.toWorldZ(Math.floor(i / T.nx)) / S; if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) cellsIn.push(i); }
    const inside = () => { let v = 0; for (const i of cellsIn) v += T.conc[i]; return v * T.cell * T.cell; };
    const tp = yield* pour(path, () => inside() >= want * (k === 'pad' ? 0.93 : k === 'spine' ? 0.9 : 0.975),   /* (the strip: what its boards hold is ~0.92 of the outline's — more only goes over them) */ k === 'slab' ? whole / 2 : whole, whole * 1.3, { v: k === 'slab' ? 8 : 10, pump: rate, wrap: k === 'slab', poke: 5 });   // (the narrow ones at the game's own delivery: at twice that the heap under the stream stood 400 over a strip 1.5 m wide and went over its boards)   // (the narrow ones in one slow pass: the spout lags the hand by up to a metre when it is swept — on a strip 1.5 m wide it poured past the boards)
    { const inV = (m) => { let v = 0; for (let i = 0; i < T.conc.length; i++) { if (!(T.conc[i] > 0)) continue; const x = T.toWorldX(i % T.nx) / S, z = T.toWorldZ(Math.floor(i / T.nx)) / S; if (x >= q.x0 - m && x <= q.x1 + m && z >= q.z0 - m && z <= q.z1 + m) v += T.conc[i]; } return +(v * T.cell * T.cell * MODEL_SCALE ** 3).toFixed(1); }; say(k + ' inside ' + inV(0) + ' +200: ' + inV(200) + ' +1000: ' + inV(1000) + ' base ' + Math.round((T.nat[T.index(MM(mid(q)[0]), MM(mid(q)[1]))] + T.loose[T.index(MM(mid(q)[0]), MM(mid(q)[1]))] - g) / S)); }
    stopAct(); say(k + ' tops after pour ' + JSON.stringify(topsOf(q)));
    say(k + ' poured ' + ((T.concVolume() - v0) * MODEL_SCALE ** 3).toFixed(1) + ' of ' + (want * MODEL_SCALE ** 3).toFixed(1) + ' in ' + tp.toFixed(0));
  }
  // (the poker round all of it — the crew's round — and the rule over the slab)
  let shake = () => {};
  app.setTool('vibro'); hud(3, ['Hose', '*Vibrator', 'Rule'], 'vibro');
  { const vib = app.concreteTools.vibro; let vt = 0; const sp = []; for (const k of keys) { const q = IBIZA[k]; for (let x = q.x0 + 400; x < q.x1; x += 1100) for (let z = q.z0 + 400; z < q.z1; z += 1100) sp.push([x, z]); }
    shake = (n) => { for (let q = 0; q < n; q++) for (const [x, z] of sp) T.vibrate(MM(x), MM(z), MM(1300)); };   // (the crew's whole round with the poker goes on meanwhile: all of it kept shaking, so it runs level — the film's seconds are few)
    const dips = [[-1400, 2400], [-300, 1500], [400, 2300]];   // (in the frame: four dips the eye can follow — the director)
    act([[1.8, [1400, 800, 1600], 1], [1.6, [-1800, 600, -1500], 3]]);
    vib.down(P(dips[0][0], 0, dips[0][1]));
    yield d.until(() => { vt += d.dt * d.speed; fresh(); shake(10); const i = Math.floor(vt / 0.9); if (i < dips.length) vib.move(P(dips[i][0], 0, dips[i][1])); return i >= dips.length; });
    vib.up(); stopAct(); yield d.until(idle); }
  app.setTool('screed'); hud(3, ['Hose', 'Vibrator', '*Rule'], 'screed');
  { const rule = app.concreteTools.screed, q = IBIZA.slab;
    act([[2.0, [1600, 800, 1500], 1], [1.8, [-2000, 700, -1600], 3], [1.6, [2600, 1400, -2400], 6], [1.6, [-2600, 1000, 1800], 6]]);   // (beside the rule's pass, close: the bar going over the concrete seen)
    for (let i = 0, x = -3400; x < q.x1; x += 3200, i++) { fresh(); const z0 = i % 2 ? q.z0 + 150 : q.z1 - 150, z1 = i % 2 ? q.z1 - 400 : q.z0 + 400; rule.down(P(x, 0, z0)); let u = 0;
      yield d.until(() => { shake(2); u = Math.min(1, u + d.dt * d.speed / 4); rule.move(P(x, 0, z0 + (z1 - z0) * u)); return u >= 1; }); rule.up(); yield d.until(idle); } }
  stopAct(); d.speed = 1; G.set(null);
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
  // (the owner: the stripping must be seen — the stakes knocked out, the boards eased off, carried to the stack beside the site:
  // the first of them close at their real pace, the rest between two shots)
  shots([[9, [9400, 1100, 4300], [6800, 150, 1500]]]);
  d.speed = 1;
  { const f = strip('spine'); yield d.sec(2.0); shots([[9, [3400, 900, 6800], [6000, 150, 3000]]]); d.speed = 4; yield d.sec(1.4); d.speed = 1; d.jumpTo(f, 3000); }   /* (the owner: «too slow, boring» — ×1 a moment, ×4, then done) */
  for (const k of ['slab', 'pad']) { const f = strip(k); d.jumpTo(f, 3000); }
  shots([[1.2, [8900, 2300, 4200], [7200, 0, 1500]], [1.1, [-8400, 1400, 6800], [-4200, 200, 3800]]]);
  d.next();
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
// (the excavator's model fetched before the film's first frame — loaded at its turn it was a still frame of seconds)
foundFilm.prepare = async (app) => {
  if (!app.machineTool.recOf('excavator')) app.objects.add({ type: 'vehicle', kind: 'excavator', x: MM(-1000), z: MM(-1250), yaw: Math.PI / 2, swing: 0, boom: 0, stick: 0, curl: 0, load: 0 });
  await app.machineTool.ensureExc();
};
foundFilm.seconds = 70;
foundFilm.place = 'beach';
foundFilm.sounds = ['excavator', 'hydraulic', 'crowbar', 'shovel_dig', 'soil_dump', 'gravel_pour', 'compactor', 'hammer_nail', 'plank', 'stake', 'rebar', 'wire', 'pump', 'concrete', 'concrete_splat', 'vibrator', 'screed', 'till', 'tap', 'waves', 'wind'];
