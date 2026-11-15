import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look } from './director.js';
import { findSlab, slabHole, slabCage, SLAB } from '../tools/slab.js';
import { findBelt, beltCage, beltContains, plan, toWorld } from '../tools/belt.js';
import { IBIZA } from './foundFilm.js';
import { slabRuns, findRail } from '../world/railing.js';
import { findOpenings } from '../tools/windowFit.js';

// «Ibiza», stages 3–5 in one film (the owner, 2026-11-15; the foreman's plan and the analyst's rhythm): the «sail» — the slab 300 over
// the pavilion with its cantilevers 3 m over the pool and 2,4 m to the left (a notch round the fireplace's tower, a joint 30 — its own
// foundation; the olive's opening in it), on a forest of props, poured, a week; the box on it (aerated block on the pavilion's walls,
// the props still under the sail), its roof slab; 28 days — the props out from the cantilever's edge back to the walls: the sail
// hangs over the water (the film's «wow»); the box's roof green; the glass; the finish — sandstone on the spine, the white plaster,
// the planks. It starts where stage 2 ended (assets/films/ibiza-2.json.gz). Every close step is the game's own work.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
// the pavilion as stage 2 left it (its slab as cast — stairFilm measured it): the walls' outer faces, the inner wall's middle
const SL = { x0: -4940, x1: 4657, z0: -2318, z1: 4171 }, IN = -1665;
const FRONT = 3000, LEFT = 2400;   // (the cantilevers: over the pool, to the left — the architect's v2)
const OLIVE = [-7100, -1750, -5300, 50];   // (the olive's opening — the owner: behind the pool, by the fireplace)
const TOWER = [-7400, 1770, -7070, 4300];  // (the fireplace tower's notch in the left cantilever: its face −7,1 + a joint 30)

// the box's walls on the sail: aerated block 300, 12 courses on glue (the first on mortar 20) — the corners bonded every other course;
// its left side on the pavilion's inner wall, the rest over the pavilion's walls (the path of the loads — docs/ideas/ibiza.md); a
// glass wall to the sea 2,5 m (the slab over it bridges it — its edge the lintel)
const BOX = () => [
  ['x', SL.z0, IN - 150, 0, 1, [0, 0], [300, 0]], ['x', SL.z0, 2500, SL.x1, 1, [0, 0], [0, 300]],
  ['x', SL.z1, IN - 150, SL.x1, -1, [0, 0], [300, 300]],
  ['z', IN - 150, SL.z0, SL.z1, 1, [300, 300], [0, 0]], ['z', SL.x1, SL.z0, SL.z1, -1, [300, 300], [0, 0]],
];
function boxWalls(base) {
  const out = [];
  for (const [ax, fixed, A0, A1, inw, even, odd] of BOX()) for (let k = 0; k < 12; k++) {
    const [t0, t1] = k % 2 ? odd : even, a0 = A0 + t0, a1 = A1 - t1, y0 = 20 + k * 253, w = fixed + inw * 150;
    for (let a = A0 - (k % 2) * 301.5; a < a1; a += 603) {
      const lo = Math.max(a, a0), hi = Math.min(a + 600, a1); if (hi - lo < 40) continue;
      const m = (lo + hi) / 2, sz = [hi - lo, 250, 300], y = base + MM(y0 + 125);
      out.push({ type: 'unit', kind: 'block', free: true, p: ax === 'x' ? [MM(m), y, MM(w)] : [MM(w), y, MM(m)], s: (ax === 'x' ? sz : [sz[2], sz[1], sz[0]]).map(MM), q: [0, 0, 0, 1] });
    }
  }
  return out.sort((p, q) => p.p[1] - q.p[1]);
}

export function* sailFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, st = app.settings, W = app.wallTool, G = app.concreteGear;
  Object.assign(st, { dayHour: 9.5, pump: 1.25, rebarD: 12, cover: 30 }); app.sky.setHour(9.5);
  d.lock = true; d.hand = 0.3;
  d.logo();
  d.money(true); d.byStages();
  const say = (m) => { (d.notes = d.notes || []).push([+d.t.toFixed(1), m]); };
  const g = T.heightAt(MM(-9000), MM(9000)), P = (x, y, z) => new V(MM(x), g + MM(y), MM(z)), idle = () => !app.busy();
  // (an eye over the ground where it stands, never in it — the beach falls to the sea: the hook stood under the sand)
  const PE = (x, y, z) => new V(MM(x), Math.max(g, T.heightAt(MM(x), MM(z))) + MM(y), MM(z));
  const hud = (row1, i, row2, tool) => d.hud([row1.map((t, k) => (k === i ? '*' + t : t)), ...(row2 ? [row2] : [])], tool);
  // ---- the camera: a still shot list cut by the film's clock, or a tripod panning after the tool (as in stages 1–2) ----
  let shotN = 0, tool = () => null;
  const shots = (list) => { const id = ++shotN; let i = -1, t1 = -1; const f = () => { if (id !== shotN) return true; if (d.t >= t1) { i = (i + 1) % list.length; const [sec, e, a] = list[i]; d.cut(look(PE(...e), P(...a)), { drift: 0.006, push: 0.008, hand: 0.2 }); t1 = d.t + sec; } return false; }; f(); d.each(f); };
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
  const WV = app.wallView, RV = app.rebarView;
  const rise = function* (view, id, dur, snd, extra = {}) { const t0 = d.t; let k = 0; yield d.until(() => { const u = Math.min(1, (d.t - t0) / dur); view.reveal = { id, u, ...extra }; view.dirty = true; if (u * 10 > k) { k++; app.sfx?.play?.(snd[k % snd.length], { vol: 0.5 }); } if (u >= 1) { view.reveal = null; view.dirty = true; return true; } return false; }); };
  // (a slab's cells filled under the clock in the order key(x, z) gives — the hose's way; what is full already stays)
  const pourOn = function* (id, days, dur, key) {
    const b = O.get(id); if (!b) return;
    const Pp = plan(b), cap = b.H / S, lv = b.lv.slice(), ks = Pp.cells.map(([i, j]) => { const [x, z] = toWorld(b, (i + 0.5) * b.c, (j + 0.5) * b.c); return key(x, z); });
    const idx = [...lv.keys()].filter((k) => lv[k] < cap - 5).sort((a, c) => ks[a] - ks[c]), n = idx.length;
    yield* d.lapse(days, dur, (q) => { const want = Math.floor(n * q); for (let i = 0; i < want; i++) lv[idx[i]] = cap; WV.beltLive = WV.beltLive || new Map(); WV.beltLive.set(id, { lv, sm: lv.map(() => 0.9) }); WV.fillDirty = true; app.sfx?.play?.('concrete', { vol: 0.35, gap: 0.3 }); });
    WV.beltLive?.delete(id); full(id);
  };
  const full = (id) => { const r = O.get(id); if (r && r.fill < 0.999) app.journal.act('belt-pour', {}, app.clock, () => O.update(id, { lv: r.lv.map(() => r.H / S), sm: r.lv.map(() => 0.9), fill: 1 })); };

  // ---- 0 · where stage 2 ended: the stair and the pavilion, one shot ----
  shots([[1.2, [16000, 4200, 9000], [1000, 3000, -1000]]]);
  yield d.sec(1.2);

  // ---- 1 · the sail: the forest of props from the walls out, the beams, the plywood; the olive's box; the notch at the tower ----
  // (the pavilion's ring — stage 2 cast the spine's and the pavilion's separately, a joint between: the one under the back wall)
  const ring = O.all('belt').find((b) => b.kind !== 'pool' && b.kind !== 'slab' && b.top > MM(3000) && beltContains(b, MM(0), MM(SL.z1 - 150)));
  const yTop = ring ? ring.top + ring.H : g + MM(3650);
  const B = findSlab(app, new V(MM(0), yTop - MM(20), MM(SL.z1 - 150)), null, null, 0, { H: 300, bridge: 6000, cants: [[0, -1, FRONT], [-1, 0, LEFT]], within: [MM(SL.x0 - 60), MM(SL.z0 - 60), MM(SL.x1 + 60), MM(SL.z1 + 60)] });
  say('sail ' + (B ? `${B.rec.ni}×${B.rec.nj} ${B.area.toFixed(1)} m² H ${Math.round(B.rec.H / S)} cants ${JSON.stringify(B.rec.cants)}` : 'none') + ' ring ' + (ring?.id ?? '-'));
  if (!B) { d.sail = { none: true }; return; }
  let sail = null;
  app.journal.act('slab-form', {}, app.clock, () => { sail = O.add(B.rec).id; });
  for (const [r, notch] of [[OLIVE, false], [TOWER, true]]) { const H = slabHole(O.get(sail), MM(r[0]), MM(r[1]), MM(r[2]), MM(r[3]), notch); say((notch ? 'notch ' : 'hole ') + (H.patch ? `${H.w}×${H.l}` : H.why)); if (H.patch) app.journal.act('slab-hole', {}, app.clock, () => O.update(sail, H.patch)); }
  hud(['Ring beam', 'Slab', 'Rebar', 'Concrete'], 1, null, 'wall');
  shots([[1.4, [-10500, 3200, 2500], [-2000, 2600, -3500]], [1.4, [-9500, 1500, -9000], [-2000, 2400, -2500]], [9, [-15000, 9000, -14000], [-1000, 2000, 0]]]);
  WV.reveal = { id: sail, u: 0, slab: true }; WV.dirty = true;
  yield* rise(WV, sail, 5.0, ['metal_hit', 'plank', 'hammer_nail'], { slab: true });
  say('props ' + (app.wallView.slabForm.tubeLo.count) + ' beams ' + app.wallView.slabForm.beams.count);
  d.stageBill('PROPS & DECK');
  // ---- 2 · the cages: the bottom mat on chairs, the frogs, the top mat, the bars over the cantilevers ----
  hud(['Ring beam', 'Slab', 'Rebar', 'Concrete'], 2, null, 'wall');
  shots([[1.3, [-6200, 5200, -5600], [-3500, 3500, -3000]], [9, [-13000, 12000, -12000], [-1500, 3000, 0]]]);
  let cage = null;
  app.journal.act('slab-cage', {}, app.clock, () => { cage = O.add(slabCage(O.get(sail))).id; });
  yield* rise(RV, cage, 3.0, ['rebar', 'wire']);
  d.stageBill('REBAR');
  // ---- 3 · the concrete: the hose from the cantilever's edge, the poker after it; the rule ----
  hud(['Ring beam', 'Slab', 'Rebar', 'Concrete'], 3, ['*Hose', 'Vibrator'], 'hose');
  const hose = app.concreteTools.hose, sb = O.get(sail), yb = sb.top + sb.H, ev = (q) => ({ target: sail, hit: q });
  // (a snake over the slab, row after row from the sea's edge back — as a crew pours a slab)
  const pts = []; { const xs = [SL.x0 - LEFT + 600, SL.x1 - 600]; for (let z = SL.z0 - FRONT + 500, k = 0; z < SL.z1 - 300; z += 1400, k++) { pts.push(k % 2 ? [xs[1], z] : [xs[0], z], k % 2 ? [xs[0], z] : [xs[1], z]); } }
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), tot = segs.reduce((a, b) => a + b, 0);
  const path = (u) => { let s2 = u * tot, i = 0; while (i < segs.length - 1 && s2 > segs[i]) { s2 -= segs[i]; i++; } const a = pts[i], b = pts[i + 1], f = Math.min(1, s2 / segs[i]); return new V(MM(a[0] + (b[0] - a[0]) * f), yb, MM(a[1] + (b[1] - a[1]) * f)); };
  app.setTool('hose');
  st.pump = 1e-5; { const p0 = path(0); hose.down(p0, ev(p0)); let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(p0, ev(p0)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - p0.x, sp.z - p0.z) < MM(250)); }); }
  st.pump = 8;
  tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
  act([[1.2, [1800, 700, 1600], 1], [1.2, [-2400, 1200, -1900], 3], [9, [3500, 2500, -4000], 6]]);
  { let u = 0; const t0 = d.t; yield d.until(() => { u = Math.min(1, (d.t - t0) / 3.6) * 0.3; const q = path(u); hose.move(q, ev(q)); return d.t - t0 >= 3.6; }); }
  hose.up(); d.speed = 4; yield d.until(idle); d.speed = 1; G.set?.(null);
  say('sail fill ' + O.get(sail)?.fill?.toFixed(3));
  // (the rest of it under the clock, row after row as the hose went — seen whole from high and far: the scale (the owner))
  shots([[9, [-15000, 13000, -14000], [-1000, 2500, -500]]]);
  yield* pourOn(sail, 0.3, 1.6, (x, z) => { const r = Math.floor((z / S - (SL.z0 - FRONT)) / 1400); return r * 1e6 + (r % 2 ? -x : x) / S; });
  d.stageBill('CONCRETE');
  // ---- a week: the sail sets on its props ----
  d.hud(null);
  shots([[9, [-16000, 15000, -15000], [-1000, 2500, 0]]]);
  yield* d.lapse(7, 1.3, () => { app.clock += 9000 * d.dt / 1.3; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(9.5);
  app.journal.act('slab-sides', {}, app.clock, () => O.update(sail, { sidesOff: true }));   // (a week: the edge boards off, the props stay — the foreman)
  app.sfx?.seq?.(['crowbar', 'plank']);
  d.kick('+7 DAYS', 1.2, 'top');
  yield d.sec(1.2);
  // ---- 4 · the box on the sail: aerated block 300 on the pavilion's walls (its left side on the inner wall), the props still under
  // the sail (the foreman: the walls over the walls — they may go on at a week); the first block close, its course, then all ----
  const sTop = sb.top + sb.H;
  const box = boxWalls(sTop + MM(3));
  hud(['Gas block', 'Slab', 'Rebar', 'Concrete'], 0, ['*By hand', 'Course'], 'wall');
  st.wallKind = 'block'; app.setTool('wall'); W.setMode('lay');
  const job = (rec, fast) => { if (app.physJob) return false; if (W.layUnit(rec, fast, 20)) { tool = () => new V().fromArray(rec.p); return true; } return false; };
  const c0 = box.filter((r) => Math.abs(r.p[1] - box[0].p[1]) < MM(5)), b0 = c0.filter((r) => Math.abs(r.p[2] - MM(SL.z0 + 150)) < MM(5)).sort((p, q) => q.p[0] - p.p[0]);
  tool = () => new V().fromArray(b0[0].p);
  act([[1.5, [-1300, 600, -1300], 1], [1.4, [900, 1000, -2600], 3]]);
  yield d.until(() => job(b0[0], false)); yield d.until(idle);
  for (const r of b0.slice(1, 5)) { yield d.until(() => job(r, true)); }
  yield d.until(idle);
  still();
  { const done = new Set(b0.slice(0, 5)), rest = box.filter((r) => !done.has(r));
    shots([[1.8, [-9500, 6500, -9000], [1500, 4500, 1000]], [9, [15000, 14000, -12000], [1000, 4500, 1000]]]);
    let i = 0; const n = rest.length, dur = 3.2, t0 = d.t;
    yield d.until(() => { const want = Math.min(n, Math.ceil(n * Math.min(1, (d.t - t0) / dur))); if (want > i) { for (; i < want; i++) O.add(rest[i]); app.sfx?.play?.('block', { vol: 0.4, gap: 0.08 }); } return i >= n; }); }
  app.budget._pay?.([{ usd: box.length * 3.1 }], P(0, 0, 0));
  d.stageBill('BLOCKS');
  // ---- 5 · the box's roof slab 200 on its walls: its props on the sail, over the sail's own ----
  const bTop = Math.max(...box.map((u) => u.p[1] + u.s[1] / 2));
  const R = findSlab(app, new V(MM(1500), bTop - MM(10), MM(SL.z1 - 150)), null, null, 0, {});
  say('roof slab ' + (R ? `${R.area.toFixed(1)} m²` : 'none'));
  let roof = null, roofCage = null;
  if (R) {
    app.journal.act('slab-form', {}, app.clock, () => { roof = O.add(R.rec).id; });
    shots([[9, [15000, 15000, -11000], [1000, 5000, 1000]]]);
    yield* rise(WV, roof, 1.6, ['metal_hit', 'plank'], { slab: true });
    app.journal.act('slab-cage', {}, app.clock, () => { roofCage = O.add(slabCage(O.get(roof))).id; });
    yield* rise(RV, roofCage, 1.0, ['rebar', 'wire']);
    yield* pourOn(roof, 0.2, 1.2, (x, z) => z / S * 1e3 + x / S);
  }
  // ---- 28 days: then the props out — the sail's from its cantilever's edge back to the walls; it hangs over the water ----
  d.hud(null);
  shots([[9, [-16000, 15000, -15000], [-1000, 3000, 0]]]);
  yield* d.lapse(28, 1.6, () => { app.clock += 9000 * d.dt / 1.6; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 }); });
  app.sky.setHour(10);
  d.kick('+28 DAYS', 1.2, 'top');
  yield d.sec(1.0);
  hud(['Ring beam', 'Slab', 'Rebar', 'Concrete'], 1, ['*Strip'], 'wall');
  app.journal.act('belt-strip', {}, app.clock, () => { O.update(sail, { stripAt: +app.clock.toFixed(3) }); if (roof != null) O.update(roof, { stripAt: +(app.clock - 1e4).toFixed(3) }); });
  // (the first pieces at their pace, close under the cantilever's edge; then faster from further — the sail still on its props
  // behind; the last prop out — a second of nothing: it hangs)
  shots([[1.6, [-2500, 1200, -7600], [-1500, 3000, -4600]], [2.2, [-11000, 1500, -9500], [-1500, 3000, -3000]], [9, [-14500, 2500, -11500], [-1500, 3000, -1500]]]);
  { const t0 = d.t; yield d.until(() => { const e = d.t - t0; d.speed = e < 1.6 ? 1 : e < 3.8 ? 3 : 12; return !!O.get(sail)?.stripped || e > 14; }); }
  d.speed = 1; say('stripped ' + !!O.get(sail)?.stripped + ' at ' + d.t.toFixed(1));
  shots([[9, [-1500, 700, -9500], [-800, 3600, -3000]]]);
  yield d.sec(1.2);
  // ---- 6 · the box's roof: the vapour barrier, the XPS, the wedge, the membrane — then the sedum mats in strips (500 off the edge:
  // gravel), close from above on the work (the owner: from above only on the action itself, close); the white fascias round the slabs ----
  let fasc = 0;
  if (roof != null) {
    const rr = O.add({ type: 'roof', slab: roof, stage: 1, look: 'grey' }), RB = O.get(roof), ni = RB.ni, nj = RB.nj;
    hud(['Roof', 'Facade', 'Glass'], 0, ['Layers', '*Green roof'], 'wall');
    shots([[1.4, [3500, 9400, -2600], [1300, 6900, 900]], [9, [-6000, 12500, -6500], [1300, 6900, 1000]]]);
    let rows = 0; const t0 = d.t, dur = 3.4;
    yield d.until(() => {
      const u = Math.min(1, (d.t - t0) / dur), stg = Math.min(4, 1 + Math.floor(u * 6));
      if (O.get(rr.id).stage !== stg) { O.update(rr.id, { stage: stg }); app.sfx?.play?.('fabric', { vol: 0.4 }); }
      const rw = Math.max(0, Math.round((u - 0.45) / 0.55 * (nj - 10)));
      if (rw > rows) { rows = rw; const green = []; for (let j = 5; j < 5 + rows; j++) for (let i = 5; i < ni - 5; i++) green.push(j * ni + i); O.update(rr.id, { green }); app.sfx?.play?.('turf', { vol: 0.35, gap: 0.12 }); }
      return u >= 1;
    });
    d.stageBill('GREEN ROOF');
  }
  { const runs = [sail, roof].filter((id) => id != null).flatMap((id) => slabRuns(O.get(id)));
    for (const r of runs) { const F = findRail(app, new V((r.a[0] + r.b[0]) / 2, r.y, (r.a[1] + r.b[1]) / 2), 'ral9003'); if (F && !F.why) { O.add(F.rec); fasc++; } } }
  say('fascias ' + fasc);
  // ---- 7 · the glass: floor to ceiling in the pavilion's openings and the box's ----
  hud(['Roof', 'Facade', 'Glass'], 2, null, 'wall');
  const ops = findOpenings(app).filter((q) => q.h > 2400 && q.h < 3400 && q.w <= 3300 && !q.why2);
  say('openings ' + ops.length);
  shots([[9, [-9000, 2600, -15500], [0, 3500, 0]]]);
  { let wk = 0; const t0 = d.t, dur = 1.8; yield d.until(() => { const n = Math.round(ops.length * Math.min(1, (d.t - t0) / dur)); for (; wk < n; wk++) { const q = ops[wk]; O.add({ type: 'window', key: 'floor', col: 'anth', w: q.w, h: q.h, t: q.t, x: +q.x.toFixed(6), y: +q.y0.toFixed(6), z: +q.z.toFixed(6), yaw: +q.yaw.toFixed(5) }); app.sfx?.play?.('glass', { vol: 0.4 }); } return d.t - t0 >= dur; }); }
  d.stageBill('GLAZING');
  d.sail = { sail, cage, roof, props: app.wallView.slabForm.tubeLo.count, box: box.length, fasc, glass: ops.length };
  // ---- the hook (put first by the recorder): low under the sail's cantilever over the empty pool ----
  shotN++;
  d.cut(look(PE(-1500, 700, -9000), P(-800, 3400, -3000)), { drift: 0.012, push: 0.03, hand: 0.25 });
  yield d.sec(0.4);
  d.mark('hook');
  d.kick('WHAT HOLDS IT UP?', 2.2, 'top');
  yield d.sec(2.2);
  d.mark('hookEnd');
  yield d.sec(0.1);
}
sailFilm.seconds = 55;
sailFilm.place = 'beach';
sailFilm.start = 'assets/films/ibiza-2.json.gz';
sailFilm.sounds = ['block', 'trowel', 'trowel_tap', 'mallet', 'tap', 'till', 'cash', 'plank', 'hammer_nail', 'metal_hit', 'rebar', 'wire', 'pump', 'concrete', 'vibrator', 'screed', 'crowbar', 'fabric', 'waves', 'wind', 'birds'];
