import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { planLift } from '../world/lift.js';
import { findPileSlab, slabCage } from '../tools/slab.js';
import { slabRuns, findRail } from '../world/railing.js';
import { findOpenings } from '../tools/windowFit.js';
import { unrle, rle } from '../tools/belt.js';
import { SHAFT_T } from '../world/collapse.js';

// «Villa on one glass shaft» — after the owner's short (Mr. Building, «Villa house 3-story», 35 M): the
// whole way from the ground to the finished villa, one fixed angle a stage (a camera on a tripod), the
// stage cut into jumps in time from the same spot (a time-lapse), almost no words; the question in the
// first frame — a house of three floors on one glass lift shaft: will it stand? It does — till the
// applause. Then the shaft gives, the house comes down; «why the real one looks like this» — the same
// house on real columns, and the last frame is the first one: played round, it never stops.
// The plan: the director's (his «Уроки» 2026-11-05), the order of the work: the foreman's.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const E = 4000;            // (the walls' outer faces: ±4 m round the shaft — the slab cantilevered to ±4,6 m)
const STOREY = 3053;       // (12 courses of blocks = 40 of bricks: the tops meet, the next slab lies on both)
// the walls of each floor: [kind, along, its outer face, from, to, openings [from, to], inwards];
// blank brick on one side, the floor-to-ceiling glass on the other — swapped on the floor above
export const FLOORS = [
  [['brick', 'x', E, -E, -1000, [], -1], ['block', 'x', E, 2000, E, [], -1], ['block', 'x', -E, -E, E, [[-1500, 1500]], 1],
    ['brick', 'z', -E, -E + 250, E - 250, [], 1], ['block', 'z', E, -E + 250, E - 250, [[-1000, 2000]], -1]],
  [['brick', 'x', E, 1000, E, [], -1], ['block', 'x', E, -E, -2000, [], -1], ['block', 'x', -E, -E, E, [[-1500, 1500]], 1],
    ['brick', 'z', E, -E + 250, E - 250, [], -1], ['block', 'z', -E, -E + 250, E - 250, [[-2000, 1000]], 1]],
];

// the units of one floor's walls, course by course (running bond, cut units at the ends and the openings)
export function courses(base, plan) {
  const out = [];
  for (const [kind, ax, fixed, a0, a1, gaps, inw] of plan) {
    const blk = kind === 'block', L = blk ? 600 : 250, J = blk ? 3 : 10, n = blk ? 12 : 40, H = blk ? 250 : 65, b0 = blk ? 20 : 12;
    const pitch = blk ? 253 : (STOREY - b0 - H) / (n - 1), rows = blk ? [150] : [60, 190];
    const runs = []; let c = a0;
    for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > c) runs.push([c, g0]); c = g1; }
    if (a1 > c) runs.push([c, a1]);
    for (let k = 0; k < n; k++) for (const r of rows) {
      const y = b0 + k * pitch + H / 2, off = ((k + (r === 190 ? 1 : 0)) % 2) * (L + J) / 2, w = fixed + inw * r;
      for (const [r0, r1] of runs) for (let a = r0 - off; a < r1; a += L + J) {
        const lo = Math.max(a, r0), hi = Math.min(a + L, r1); if (hi - lo < 40) continue;
        const m = (lo + hi) / 2, sz = blk ? [hi - lo, 250, 300] : [hi - lo, 65, 120];
        out.push({ y, rec: { type: 'unit', kind, free: true, p: ax === 'x' ? [MM(m), base + MM(y), MM(w)] : [MM(w), base + MM(y), MM(m)], s: (ax === 'x' ? sz : [sz[2], sz[1], sz[0]]).map(MM), q: [0, 0, 0, 1] } });
      }
    }
  }
  return out.sort((p, q) => p.y - q.y).map((u) => u.rec);
}

export function* villaFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, sfx = (n, o) => app.sfx?.play?.(n, o);
  Object.assign(app.settings, { dayHour: 10.5 });
  app.sky.setHour(10.5);
  app.setTool('wall'); app.wallTool.setMode?.('lay');
  d.lock = true; d.hand = 0.3;
  app.sfx?._load?.('applause');   // (the applause played live: fetched beforehand)
  const g = T.heightAt(0, 0), at = (h) => new V(0, g + MM(h), 0);
  // a fixed angle (the tripod): h mm over the ground at the shaft, yaw, pitch, dist mm
  const view = (h, yaw, pitch, dist) => ({ target: at(h), yaw, pitch, dist: MM(dist) });
  const tripod = (v) => d.cut(v, { drift: 0, push: 0.012, hand: 0.3 });
  // a stage as a time-lapse: n shots from the same spot; in each the work goes on a little (prog(u), u the
  // stage's share), between them it jumps on (a hard cut) — something changes every second or two
  function* lapse(v, prog, n, shot = 1.4, adv = 0.3, mark) {
    for (let k = 0; k < n; k++) {
      tripod(v);
      const a = k / n, b = k === n - 1 ? 1 : (k + adv) / n, t0 = d.t;
      if (mark) mark(k);
      yield d.until(() => { const u = Math.min(1, (d.t - t0) / shot); prog(a + (b - a) * u); return u >= 1; });
    }
    prog(1);
  }
  const A = view(5500, 0.35, 0.12, 26000);   // (the hero's angle: low in front — the hook, the striking, the end)

  // ---- 1 · the pad under the shaft: concrete 300 over 3 × 3 m (the shaft's foot + 300 all round) ----------
  // (the cells set through the ground's own concrete — its cure clock, smooth top — and their tiles redrawn)
  const castCells = (list, mm) => { let a = 1e9, b = -1, c = 1e9, e = -1; for (const [i] of list) { const add = MM(mm) - T.conc[i]; if (add > 0) T._concAdd(i, add, 1); const ix = i % T.nx, iz = Math.floor(i / T.nx); a = Math.min(a, ix); b = Math.max(b, ix); c = Math.min(c, iz); e = Math.max(e, iz); } if (b >= 0) T._concTouch(a, c, b, e); T.updateMesh?.(); };
  const cellsIn = (hx, hz) => { const out = []; for (let i = 0; i < T.conc.length; i++) { const x = T.toWorldX(i % T.nx), z = T.toWorldZ(Math.floor(i / T.nx)); if (Math.abs(x) < MM(hx) && Math.abs(z) < MM(hz)) out.push([i, z]); } return out; };
  const pad = cellsIn(1500, 1500);
  pad.sort((p, q) => p[1] - q[1]);
  let padDone = 0;
  const padTo = (u) => {
    const n = Math.round(pad.length * u); if (n <= padDone) return;
    castCells(pad.slice(padDone, n), 300);
    padDone = n;
    const z = pad[Math.min(pad.length - 1, n)][1];
    app.concreteGear?.set?.(u < 1 ? 'hose' : null, new V(Math.sin(d.t * 5) * MM(1100), g + MM(900), z));
    if (Math.random() < 0.15) app.sfx?.pour?.(0.5, 'concrete_splat');
  };
  // (as on a site: the boards round it on their stakes and the mesh Ø12 every 200 on its chairs first; the concrete
  // runs to the boards — it does not stand on its own — and the boards come off when it has set)
  const form = padForm(g, 1500, 300);
  app.scene.add(form.group);
  const padStage = (u) => {
    form.boards.visible = u > 0.02; form.mesh.visible = u > 0.3;
    if (u > 0.45) padTo(Math.min(1, (u - 0.45) / 0.45));
    if (u >= 0.97) form.boards.visible = false;
  };
  yield* lapse(view(0, 0.6, 0.85, 9000), padStage, 6, 1.4, 0.35, (k) => { if (k === 0) app.sfx?.seq?.(['plank', 'hammer_nail', 'stake', 'hammer_nail']); if (k === 2) app.sfx?.seq?.(['rebar', 'wire', 'wire']); });
  form.mesh.visible = false;   // (in the concrete now)
  app.scene.remove(form.group); form.dispose();
  app.concreteGear?.set?.(null);

  // ---- 2 · the shaft: its feet on the anchors, the posts, the steel head, the glass — bottom to top -------
  const g2 = T.heightAt(0, 0);
  const L = planLift(app, new V(0, g2, 0), MM(6500), new V(0, 0, 1));
  const lf = O.add(L.rec);
  app.simulate(0.05);
  const lg = () => app.wallView._liftG?.get(lf.id);
  let parts = null;
  const shaftTo = (u) => {
    const G = lg(); if (!G) return;
    if (!parts) {
      // (the steel first, bottom up; the glass last — as the foreman would have it, it would be broken otherwise)
      const glassy = (o) => { let y = false; o.traverse((q) => { if (q.material?.transparent || /glass|pane/i.test(q.name)) y = true; }); return y; };
      const box = new THREE.Box3();
      parts = G.children.map((c) => { box.setFromObject(c); return { c, y: box.min.y, glass: glassy(c) }; }).sort((p, q) => (p.glass - q.glass) || (p.y - q.y));
    }
    const n = Math.round(parts.length * u);
    parts.forEach((p, k) => { const was = p.c.visible; p.c.visible = k < n; if (!was && p.c.visible && k % 3 === 0) sfx(p.glass ? 'glass' : 'welding', { vol: 0.4 }); });
  };
  shaftTo(0);
  yield* lapse(view(2000, 0.6, 0.55, 11000), shaftTo, 8, 1.3, 0.3);

  // ---- 3 · the first slab on the shaft's head: the forest of props, the forms, the bars, the concrete -----
  const scr = (v) => app.wallTool._screen(v);
  const P1 = findPileSlab(app, new V(0, lf.top, 0), scr, null, undefined, 3500);
  if (!P1) { d.kick('NO SLAB', 2); yield d.sec(2); return; }
  const slab = (rec) => O.add({ ...rec, fill: 0, stripped: false });
  const s1 = slab(P1.rec);
  // (the slabs above: the same plan a storey up, no opening — the shaft stops at the first floor)
  // (the opening over the shaft closed: the shaft stops at the first floor — no hole in the floors above, none in the
  // green roof)
  const up = (src, top) => {
    const n = src.ni * src.nj, mask = unrle(src.mask, n), deck = unrle(src.deck, n), cnt = [0, 0];
    for (let k = 0; k < n; k++) if (mask[k]) cnt[deck[k] ? 1 : 0]++;
    const dv = cnt[1] >= cnt[0] ? 1 : 0;
    // (only the enclosed holes: what is open from the edge stays the slab's outline)
    const out = new Uint8Array(n), st = [];
    for (let i = 0; i < src.ni; i++) for (const j of [0, src.nj - 1]) st.push(j * src.ni + i);
    for (let j = 0; j < src.nj; j++) for (const i of [0, src.ni - 1]) st.push(j * src.ni + i);
    while (st.length) { const k = st.pop(); if (out[k] || mask[k]) continue; out[k] = 1; const i = k % src.ni, j = (k - i) / src.ni; if (i > 0) st.push(k - 1); if (i < src.ni - 1) st.push(k + 1); if (j > 0) st.push(k - src.ni); if (j < src.nj - 1) st.push(k + src.ni); }
    for (let k = 0; k < n; k++) if (!mask[k] && !out[k]) { mask[k] = 1; deck[k] = dv; }
    const r = { ...src, top, mask: rle(mask), deck: rle(deck), holes: [], lv: new Array(mask.reduce((a, v) => a + (v ? 1 : 0), 0)).fill(0), fill: 0, stripped: false };
    delete r.id; delete r.piles; delete r.castT; delete r.pourT; delete r.wetT; return O.add(r);
  };
  const pourer = (id) => {
    const b = O.get(id), n = b.ni * b.nj, mask = unrle(b.mask, n), cells = [];
    for (let k = 0; k < n; k++) if (mask[k]) { const i = k % b.ni, j = Math.floor(k / b.ni); cells.push({ i, j }); }
    const Hmm = b.H / S, lv = cells.map(() => 0), px = -b.u[1], pz = b.u[0];
    return (u) => {
      // (a front of concrete from the back corner on: the hose at it)
      const F = u * (b.ni + b.nj + 8);
      cells.forEach((c, k) => { lv[k] = Math.max(lv[k], Hmm * Math.max(0, Math.min(1, (F - (b.ni - c.i) - (b.nj - c.j)) / 6))); });
      const fi = Math.max(0, Math.min(b.ni, b.ni - F / 2)), fj = Math.max(0, Math.min(b.nj, b.nj - F / 2));
      const x = b.o[0] + (b.u[0] * fi + px * fj) * b.c, z = b.o[1] + (b.u[1] * fi + pz * fj) * b.c;
      app.concreteGear?.set?.(u < 1 ? 'hose' : null, new V(x, b.top + b.H + MM(600), z));
      const mean = lv.reduce((a, v) => a + v, 0) / lv.length / Hmm;
      O.update(id, u >= 1 ? { lv: lv.map(() => Math.round(Hmm)), fill: 1, castT: app.clock, pourT: app.clock, wetT: app.clock } : { lv: lv.map((v) => Math.round(v)), fill: +mean.toFixed(3), pourT: app.clock, wetT: app.clock });
      if (Math.random() < 0.2) app.sfx?.pour?.(0.5, 'concrete_splat');
    };
  };
  function* slabStage(id, v, nForm = 3, nPour = 4) {
    // the forms and the bars: the deck on the props (seen at once), then the cage
    let caged = false;
    yield* lapse(v, (u) => { if (u > 0.55 && !caged) { caged = true; O.add(slabCage(O.get(id))); app.sfx?.seq?.(['rebar', 'rebar', 'wire', 'wire']); } }, nForm, 1.2, 0.3, (k) => { if (k === 0) app.sfx?.seq?.(['plank', 'hammer_nail', 'plank', 'hammer_nail']); });
    d.speed = 3;
    yield* lapse(v, pourer(id), nPour, 1.4, 0.4);
    d.speed = 1;
    app.concreteGear?.set?.(null);
  }
  const V1 = view(3500, -0.6, 0.75, 22000);
  yield* slabStage(s1.id, V1);
  app.clock += 600;   // (+7 days: the walls may start)

  // ---- 4 · the first floor's walls: brick and blocks, the blank brick on one side, glass on the other -----
  const S1 = O.get(s1.id), top1 = S1.top + S1.H;
  const laid = (list) => { let k = 0; return (u) => { const n = Math.round(list.length * u); if (n > k) { for (; k < n; k++) O.add(list[k]); sfx(Math.random() < 0.5 ? 'block' : 'brick', { vol: 0.35 }); } }; };
  yield* lapse(view(5000, 0.6, 0.5, 24000), laid(courses(top1, FLOORS[0])), 8, 1.3, 0.3);

  // ---- 5 · the second slab and floor (the same again — faster) -----------------------------------------
  const s2 = up(O.get(s1.id), top1 + MM(STOREY));
  const V2 = view(8000, -0.6, 0.55, 26000);
  yield* slabStage(s2.id, V2, 2, 3);
  app.clock += 600;
  const S2 = O.get(s2.id), top2 = S2.top + S2.H;
  yield* lapse(V2, laid(courses(top2, FLOORS[1])), 6, 1.2, 0.3);

  // ---- 6 · the roof slab, the green roof, the dark fascias round the slabs -------------------------------
  const s3 = up(O.get(s2.id), top2 + MM(STOREY));
  const V3 = view(11000, 0.6, 0.9, 24000);
  yield* slabStage(s3.id, V3, 2, 3);
  const roof = O.add({ type: 'roof', slab: s3.id, stage: 1, look: 'grey' });
  const S3 = O.get(s3.id), ni = S3.ni, nj = S3.nj;
  const runs = [s1, s2, s3].flatMap((s) => slabRuns(O.get(s.id)));
  let fasc = 0, greenRows = 0;
  yield* lapse(V3, (u) => {
    const st = Math.min(4, 1 + Math.floor(u * 6));
    if (O.get(roof.id).stage !== st) { O.update(roof.id, { stage: st }); sfx('fabric', { vol: 0.4 }); }
    // (the sedum in strips, 500 mm off the edge: gravel there)
    const rows = Math.max(0, Math.round((u - 0.45) / 0.55 * (nj - 10)));
    if (rows > greenRows) { greenRows = rows; const green = []; for (let j = 5; j < 5 + rows; j++) for (let i = 5; i < ni - 5; i++) green.push(j * ni + i); O.update(roof.id, { green }); sfx('turf', { vol: 0.3 }); }
    const f = Math.round(runs.length * u);
    for (; fasc < f; fasc++) { const r = runs[fasc], F = findRail(app, new V((r.a[0] + r.b[0]) / 2, r.y, (r.a[1] + r.b[1]) / 2), 'ral7016'); if (F && !F.why) { O.add(F.rec); sfx('screwdriver', { vol: 0.3 }); } }
  }, 6, 1.3, 0.3);

  // ---- 7 · +28 days: the props out, from the top slab down — the house is left on its shaft -----------------
  app.clock += 2400;
  tripod(A);
  d.kick('+28 DAYS', 1.0);
  yield d.sec(1.2);
  for (const s of [s3, s2]) { tripod(A); O.update(s.id, { stripped: true, set: true }); app.sfx?.seq?.(['pipe', 'plank', 'pipe']); yield d.sec(1.0); }
  tripod(A); yield d.sec(0.6);
  O.update(s1.id, { stripped: true, set: true }); app.sfx?.seq?.(['pipe', 'plank', 'pipe', 'plank']);
  yield d.sec(1.6);   // (held: the house hangs on its shaft)

  // ---- 8 · the glass: the floor-to-ceiling windows, then the evening ------------------------------------
  const ops = findOpenings(app).filter((q) => q.h > 2500 && q.h < 3300 && q.w <= 3200 && !q.why2);
  let wk = 0;
  yield* lapse(view(6000, 0.6, 0.45, 26000), (u) => {
    const n = Math.round(ops.length * u);
    for (; wk < n; wk++) { const q = ops[wk]; O.add({ type: 'window', key: 'floor', col: 'anth', w: q.w, h: q.h, t: q.t, x: +q.x.toFixed(6), y: +q.y0.toFixed(6), z: +q.z.toFixed(6), yaw: +q.yaw.toFixed(5) }); sfx('glass', { vol: 0.4 }); }
    app.sky.setHour(10.5 + 5.5 * u);   // (to the late afternoon — low warm sun, the facade still lit)
  }, 5, 1.3, 0.3);

  // ---- 9 · the reveal: round the villa, the cabin going up — the hook is taken from here ---------------------
  d.lock = false;
  // (round the villa at 22–28 m, rising from 7 to 12 m — never under the cantilever)
  { const keys = []; for (let i = 0; i <= 5; i++) { const u = i / 5, a = -0.95 + 1.3 * u, R = MM(22000 + 6000 * u); keys.push([new V(Math.sin(a) * R, g + MM(7000 + 5000 * u), Math.cos(a) * R), at(6000)]); } d.fly(keys, 7, { ease: 'start' }); }
  yield d.sec(5.2);
  d.lock = true;
  tripod(A);
  app.wallView.rideLift?.(lf.id);
  const clap = sfx('applause', { vol: 0.9 });
  yield d.sec(2.2);
  // (the applause cut off at once — 0,3 s of silence, then the creak)
  try { clap?.stop(app.sfx.now + 0.04); } catch { /* done already */ }
  yield d.sec(0.3);

  // ---- 10 · the collapse: the applause cut off, the creak, the panes white, the house through the frame ----
  Object.assign(app.settings, { catKind: 'shaft', catPower: 5 });
  app.setTool('disaster');
  let st = null; app.disasterTool.run().then((s) => { st = s; });
  yield d.until(() => st);
  const D = app.disasterTool.sim, C = D.collapse;
  if (!C) { d.kick('—', 1); yield d.sec(1); return; }
  const ST = SHAFT_T;
  yield d.until(() => D.t > 2.2);
  // (the foot of the shaft, close: the panes whitening bottom up — slowed)
  d.cut(view(1500, 0.35, 0.22, 7000), { drift: 0, push: 0.01, hand: 0.4 });
  d.ramp(0.5, 0.2);
  yield d.until(() => D.t > ST.fail - 0.05);
  // (the match cut back: the house through the frame — slowed, the strike in real time)
  tripod(A);
  d.ramp(0.35, 0.2);
  yield d.until(() => C.struck || D.t > ST.fail + 3);
  d.ramp(1, 0.3);
  d.shake(0.025, 0.6); d.punch(0.92, 0.5);
  yield d.sec(4.5);
  d.cut(view(0, 0.2, 1.3, 20000), { drift: 0, push: 0.01, hand: 0.3 });
  yield d.sec(2.2);

  // ---- 11 · the answer: the same house on real columns ------------------------------------------------------
  app.disasterTool.finish(); app.setTool('wall');
  app.simulate(0.1);
  d.lock = false;
  tripod(A);
  d.title('WHY THE REAL ONE LOOKS LIKE THIS', '', 0);
  d.trans('flash', true);
  // (the shaft carries nothing now: a wide pad, four columns Ø600 to the slab's underside)
  const raft = cellsIn(4800, 4800), was = raft.map(([i]) => [i, T.conc[i], T.cTime[i], T.cBase[i], T.cY[i], T.cSm[i]]);
  castCells(raft, 300);   // (a raft under the whole house: the columns' braces stand on it too)
  yield d.sec(2.5);
  d.lock = true;
  const bot = O.get(s1.id).top, cols = [];
  for (const [x, z] of [[-2600, -2600], [2600, -2600], [2600, 2600], [-2600, 2600]]) {
    const y0 = T.heightAt(MM(x), MM(z));
    cols.push(O.add({ type: 'column', sec: 'rd', a: 600, h: +(bot - y0).toFixed(6), n: 10, course: 'block', tilt: [0, 0], x: MM(x), z: MM(z), y0, dep: 0, stage: 2, cage: true, fill: 0, on: 'concrete' }));
  }
  // (the forms, filled, struck by u ≈ 0,6 — then the bare concrete columns held in the frame)
  yield* lapse(A, (u) => { for (const c of cols) { const r = O.get(c.id), f = +Math.min(1, u / 0.4).toFixed(3), st2 = u < 0.45 ? 2 : u < 0.6 ? 3 : 4; if (r.stage !== st2 || Math.abs((r.fill || 0) - f) > 0.05) O.update(c.id, { stage: st2, fill: f }); } }, 4, 1.2, 0.3);
  yield d.sec(1.8);
  // the hook (put first by the renderer — film/recorder.js): the villa on its shaft alone, the cabin going up
  // in the glass, the question; the film ends here, so played round it goes on into the building of it
  for (const c of cols) O.remove(c.id);
  // (and the raft taken back: the hook is the villa on its small pad, as it was built)
  for (const [i, c, t, b, y, m] of was) { T.conc[i] = c; T.cTime[i] = t; T.cBase[i] = b; T.cY[i] = y; T.cSm[i] = m; }
  { let a = 1e9, b = -1, c = 1e9, e = -1; for (const [i] of was) { const ix = i % T.nx, iz = Math.floor(i / T.nx); a = Math.min(a, ix); b = Math.max(b, ix); c = Math.min(c, iz); e = Math.max(e, iz); } T._concTouch(a, c, b, e); T.updateMesh?.(); }
  app.simulate(0.05);
  d.clear();
  tripod(A);
  app.wallView.rideLift?.(lf.id);
  d.mark('hook');
  d.kick('WILL IT STAND?', 1.5);
  yield d.sec(1.9);
  d.mark('hookEnd');
  yield d.sec(0.1);
}

// the pad's forms: boards 40 × 300 on stakes outside, every metre; the mesh Ø12 every 200 on chairs, 50 up
function padForm(g, half, h) {
  const group = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.85 }), steel = new THREE.MeshStandardMaterial({ color: 0x6e4a32, roughness: 0.6, metalness: 0.35 });
  const boards = new THREE.Group(), mesh = new THREE.Group(), geos = [];
  const box = (gr, mat, w, hh, d, x, y, z) => { const ge = new THREE.BoxGeometry(MM(w), MM(hh), MM(d)); geos.push(ge); const m = new THREE.Mesh(ge, mat); m.position.set(MM(x), g + MM(y), MM(z)); m.castShadow = true; gr.add(m); };
  const o = half + 20, L = 2 * half + 80;
  for (const sg of [-1, 1]) { box(boards, wood, L, h + 20, 40, 0, (h + 20) / 2, sg * o); box(boards, wood, 40, h + 20, L, sg * o, (h + 20) / 2, 0); }
  for (let a = -half; a <= half + 1; a += 1000) for (const sg of [-1, 1]) { box(boards, wood, 50, h + 250, 50, a, (h + 250) / 2 - 150, sg * (o + 45)); box(boards, wood, 50, h + 250, 50, sg * (o + 45), (h + 250) / 2 - 150, a); }
  for (let a = -half + 50; a <= half - 49; a += 200) { box(mesh, steel, 2 * half - 100, 12, 12, 0, 56, a); box(mesh, steel, 12, 12, 2 * half - 100, a, 68, 0); }
  boards.visible = mesh.visible = false; group.add(boards, mesh);
  return { group, boards, mesh, dispose: () => { for (const ge of geos) ge.dispose(); } };   // (the materials kept: a shader warm-up may still look at them)
}

villaFilm.seconds = 125;   // (how long it runs: the shooting's progress — film/recorder.js)
