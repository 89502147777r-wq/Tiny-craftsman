import * as THREE from 'three';
import { MODEL_SCALE, TRAY, PUMP } from '../config.js';
import { POOL, PW, rimY, floorTopY, wallTopY, waterMax, faces, cellsOf, sheetsOf, copeLayout, MOSAICS, embeds } from '../world/pool.js';

// «How a backyard pool is built» — the pool done start to finish by the jobs of the pool tool
// (poolTool.js), filmed and cut by the director (director.js): two or three shots a stage — wide,
// close on the tool at work, low or from above — cut every second or two, with the words over it.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const DECK = 'trav';

export function* poolFilm(d, app) {
  const V = THREE.Vector3, pw = app.wallTool.pool, st = app.settings;
  const scr = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  Object.assign(st, { wallKind: 'pool', poolMos: 'turq', poolCope: 'trav', poolDeck: DECK, poolDeckW: 1500, pump: PUMP[2], dayHour: 11 });
  app.sky.setHour(11);
  app.setTool('wall'); app.wallTool.setMode('lay');
  d.bar(12);

  // the place: the middle of the plot, along it; points in the pool's frame (mm)
  const C = new V(0, TRAY.soil, 0.06);
  const R = () => pw.rec;
  const at = (s, t, y) => { const r = R(), [x, z] = PW(r, s, t); return new V(x, y ?? r.g, z); };
  const fl = (s, t, y = 0) => at(s, t, floorTopY(R()) + MM(y));
  const mid = (y) => at(POOL.L / 2, POOL.W / 2, y);
  const gy = (s2, t2, y) => at(s2, t2, R().g + MM(y));   // (mm over the ground)
  // a view from a point at a point (the camera's yaw / pitch / distance from them)
  const look = (eye, tgt) => { const v = eye.clone().sub(tgt), dist = v.length(); return { target: tgt, yaw: Math.atan2(v.x, v.z), pitch: Math.asin(v.y / dist), dist }; };
  const shovel = () => app.shovel.root.position;
  const gear = () => app.concreteGear.pos;
  const hand = () => { const h = app.handTools, t = h.cur && h.tools[h.cur]; return t?.g.visible ? t.g.position : null; };

  // ---- the hook: the empty plot, pushed into fast; the title -----------------------------------------
  d.cut({ target: C, yaw: 0.5, pitch: 0.22, dist: 1.6 }, { drift: 0.08, push: 0.22 });
  yield d.sec(0.05);
  d.kick('IT STARTS HERE', 1.0);
  yield d.sec(1.0);

  // 1 · setting out: from above, the lines snap in
  st.poolLayer = 'pit';
  pw.down(C, scr(C)); pw.move(C, scr(C)); pw.up();
  d.cut({ target: C, yaw: 0.0, pitch: 1.42, dist: 1.25 }, { fx: 'flash', drift: 0.12, push: 0.06 });
  d.title('SETTING OUT', 'pit 9.7 × 5.2 m — 1.7 m wider than the pool', 1);
  yield d.sec(1.2);

  // 2 · the pit: close on the spade, then the hole from above with the soil counted
  d.speed = 2.4;
  pw._dig(R(), null);
  d.follow(shovel, { yaw: 1.2, pitch: 0.42, dist: 0.32 }, { fx: 'whip', drift: 0.1, push: 0.05, lag: 3 });
  d.title('EXCAVATION', '1.85 m deep, walls trimmed by hand', 2);
  yield d.sec(1.2);
  d.cut({ target: mid(R().g - MM(1000)), yaw: 2.6, pitch: 0.7, dist: 0.85 }, { fx: 'zoom', drift: 0.1, push: 0.06 });
  d.count('soil hauled away', 93, ' m³', 1.2, 0, 1.8);
  yield d.job();

  // 3 · the stone: tipped in heaps (low, from the pit's floor), raked, the plate
  d.speed = 3.2;
  pw._bed(R(), null);
  d.cut({ target: at(POOL.L * 0.35, POOL.W * 0.5, R().g - MM(1600)), yaw: 1.4, pitch: 0.2, dist: 0.5 }, { fx: 'flash', drift: 0.12, push: 0.12 });
  d.title('GRAVEL BASE', '200 mm crushed stone, compacted', 3);
  d.shake(0.01, 0.4);
  yield d.sec(1.2);
  d.follow(() => (app.concreteGear.show === 'plate' ? gear() : null), { yaw: 2.3, pitch: 0.55, dist: 0.42 }, { fx: 'whip', drift: 0.1, lag: 4 });
  d.pin('+ 100 mm lean concrete', fl(POOL.L * 0.7, POOL.W * 0.3, -280), 1.4, -1);
  yield d.job();

  // 4 · the floor's bars: a macro low across the mesh, then up and over it
  d.speed = 1;
  pw._form1(R(), null);
  pw._cage1(R(), pw._belts(R()).fb);
  d.cut({ target: fl(POOL.L * 0.25, POOL.W * 0.45, -120), yaw: 1.57, pitch: 0.14, dist: 0.16 }, { fx: 'flash', drift: 0.05, push: 0.18 });
  d.title('FLOOR REBAR', 'two meshes Ø12 every 200 mm', 4);
  d.pin('starter bars for the walls', fl(0, POOL.W * 0.4, 150), 1.5);
  yield d.sec(1.3);
  d.move({ target: mid(R().g - MM(1200)), yaw: 0.9, pitch: 1.0, dist: 0.95 }, 0.9, { drift: 0.1 });
  yield d.sec(0.9);

  // 5 · the floor poured: on the hose, then wide; the cubes counted
  yield* pour(d, app, pw, 'floor', () => {
    d.title('CONCRETE FLOOR', '250 mm slab, pumped in one go', 5);
    d.follow(gear, { yaw: 0.6, pitch: 0.55, dist: 0.26 }, { fx: 'whip', drift: 0.12, push: 0.04, lag: 5 });
  }, (k) => {
    if (k === 1) { d.cut({ target: mid(R().g - MM(1350)), yaw: 0.2, pitch: 0.95, dist: 0.9 }, { fx: 'zoom', drift: 0.1 }); d.count('concrete', 9.1, ' m³', 1.0, 0, 1.5, 1); }
  });

  // 6 · the walls: forms with the parts cast in, poured from the top
  d.kick('7 DAYS LATER', 0.9);
  d.cut({ target: mid(R().g - MM(1300)), yaw: 0.2, pitch: 0.95, dist: 0.9 }, { fx: 'flash', drift: 0.15 });
  app.clock += 2400;
  pw._cage2(R(), pw._belts(R()).fb);
  pw._form2(R(), pw._belts(R()).fb, null);
  yield d.sec(0.9);
  const E = embeds(R()), lamp = E.light[0], sk = E.skim[0];
  d.cut(look(gy(5600, 2900, -350), gy(2600, 0, -800)), { fx: 'whip', drift: -0.04, push: 0.1 });
  d.title('WALL FORMS', 'lights, jets & skimmers cast in', 6);
  d.pin('LED light', fl(lamp.a, 0, lamp.b), 1.6);
  d.pin('skimmer', fl(POOL.L - sk.a, POOL.W, sk.b), 1.6, -1);
  yield d.sec(1.6);
  yield* pour(d, app, pw, 'wall', () => {
    d.title('CONCRETE WALLS', 'poured in one go — no cold joints', 7);
    d.follow(gear, { yaw: 2.4, pitch: 0.95, dist: 0.4 }, { fx: 'zoom', drift: -0.12, lag: 5 });
  }, (k) => {
    if (k === 1) d.cut({ target: mid(wallTopY(R())), yaw: 0.8, pitch: 0.75, dist: 1.0 }, { fx: 'whip', drift: 0.12 });
  });

  // 8 · stripped, the gap filled back: the plate up close
  d.kick('28 DAYS LATER', 0.9);
  d.cut(look(gy(-1800, -2200, 2600), gy(4200, 1750, -1500)), { drift: 0.06, push: 0.05 });
  app.clock += 6000;
  { const r = R(), { fb, wb } = pw._belts(r); pw._strip(r, fb, wb); }
  yield d.sec(0.8);
  d.speed = 4;
  { const r = R(), { fb, wb } = pw._belts(r); pw._fill(r, fb, wb); }
  d.follow(() => (app.concreteGear.show === 'plate' ? gear() : null), { yaw: 2.6, pitch: 0.8, dist: 0.36 }, { fx: 'whip', drift: 0.12, lag: 4 });
  d.title('BACKFILL', 'sand in 300 mm layers, each compacted', 8);
  yield d.job();
  // (the setting-out — stakes and strings round the pit — comes away once it is filled back)
  { const r = R(); if (r.pit != null && app.objects.get(r.pit)) pw._save('pit-out', () => app.objects.remove(r.pit)); }

  // 9 · the coating: straight down into the bowl, swept over
  d.speed = 1;
  d.cut({ target: mid(floorTopY(R())), yaw: 1.57, pitch: 1.45, dist: 0.85 }, { fx: 'whip', drift: 0.2, push: 0.06 });
  d.title('WATERPROOFING', '2 coats of cement membrane', 9);
  yield* sweep(d, pw, 'proof', 1.6);

  // 10 · the mosaic: low in the bowl along the long wall
  d.speed = 2.2;
  d.cut(look(fl(7300, 3000, 1100), fl(2600, 0, 600)), { fx: 'zoom', drift: 0.03, push: 0.12 });
  d.title('GLASS MOSAIC', 'sheet by sheet on flexible glue', 10);
  { const r = R(), old = JSON.parse(JSON.stringify(r)), L = MOSAICS[st.poolMos][3];
    const live = { ...old, tile: faces(r).map((f) => { const [ni, nj] = sheetsOf(f); return L.repeat(ni * nj); }) };
    pw._fitSheets(live, old, () => pw._save('pool-tile', () => app.objects.update(r.id, { tile: live.tile }))); }
  yield d.job();

  // 11 · the coping: close on a stone and the mallet, then along the edge
  d.speed = 2;
  { const r = R(), old = JSON.parse(JSON.stringify(r));
    const live = { ...old, copeCol: st.poolCope, cope: copeLayout(r).map((s) => '1'.repeat(s.n)) };
    pw._fitStones(live, old, () => pw._save('pool-cope', () => app.objects.update(r.id, { cope: live.cope, copeCol: live.copeCol }))); }
  d.follow(hand, { yaw: 0.5, pitch: 0.42, dist: 0.2 }, { fx: 'flash', drift: 0.1, lag: 7 });
  d.title('COPING', 'travertine, 30 mm over the water', 11);
  yield d.sec(1.2);
  d.cut(look(gy(-900, -700, 750), gy(4200, 0, 300)), { fx: 'whip', drift: 0.02, push: 0.12 });
  yield d.job();

  // 12 · the deck round it: low over the stones going down
  d.speed = 2.6;
  pw._base(R());
  d.cut(look(gy(-2000, -2600, 1100), gy(3000, -700, 300)), { fx: 'zoom', drift: 0.04, push: 0.08 });
  d.title('POOL DECK', 'travertine on a concrete slab', 12);
  yield d.job();
  pw._deck(R());
  d.cut({ target: mid(rimY(R())), yaw: 0.4, pitch: 0.7, dist: 1.1 }, { fx: 'whip', drift: 0.12 });
  yield d.job();

  // the water: at the surface as it comes up, then wide
  d.speed = 14;
  st.poolLayer = 'water'; st.poolWater = 'fill';
  { const p = mid(floorTopY(R())); pw.down(p, scr(p)); }
  const water = () => fl(POOL.L * 0.25, POOL.W * 0.5, (pw.drag?.live?.water || R().water || 0));
  d.follow(water, { yaw: 1.3, pitch: 0.12, dist: 0.32 }, { fx: 'flash', drift: 0.05, push: 0.08, lag: 8 });
  d.title('');
  d.count('water', Math.round(POOL.L * POOL.W * waterMax(R()) / 1e9), ' m³', 2.2, 0, 2.4);
  yield d.sec(1.6);
  d.cut({ target: mid(rimY(R()) - MM(400)), yaw: 0.9, pitch: 0.55, dist: 0.95 }, { fx: 'whip', drift: 0.1 });
  yield d.until(() => (pw.drag?.live?.water || 0) >= waterMax(R()) - 1);
  pw.up();

  // the evening: the lights come on — a low turn round the pool
  d.speed = 1;
  pw._save('pool-light', () => app.objects.update(R().id, { light: true }));
  d.cut(look(gy(-2600, -2400, 1500), gy(3600, 1750, -700)), { fx: 'flash', drift: 0.14, push: 0.04 });
  const h0 = 17.6;
  d.each(((k) => () => { k += d.dt / 1.6; app.sky.setHour(h0 + 2.3 * Math.min(1, k)); return k >= 1; })(0));
  yield d.sec(1.0);
  d.kick('FROM DIRT TO THIS', 1.6, 'gold');
  yield d.sec(1.9);
  d.end('Built step by step in Tiny Craftsman');
  yield d.sec(2.0);

  // the hook (put first by the renderer): the pool done, in the sun, a slow push — «how?»
  d.clear();
  app.sky.setHour(12.5);
  d.cut(look(gy(10200, -3000, 2700), gy(3900, 1750, -500)), { drift: -0.08, push: 0.1 });
  d.mark('hook');
  yield d.sec(0.05);
  d.title('HOW IS THIS BUILT?', 'every step, from bare ground');
  yield d.sec(1.6);
  d.mark('hookEnd');
}

// the hose over the floor slab / along the walls' tops till the forms are full; start() — the
// first shot, then shot(k) for k = 1 a second on
function* pour(d, app, pw, part, start, shot) {
  const V = THREE.Vector3, r = pw.rec, hs = app.concreteTools.hose;
  const belt = () => pw._belts(pw.rec)[part === 'floor' ? 'fb' : 'wb'];
  const b = belt(), y = part === 'floor' ? b.top : wallTopY(r);
  // the way the hose goes: back and forth over the slab / round the walls
  const way = [];
  if (part === 'floor') { for (let j = 0; j < 5; j++) { const t = -250 + (r.W + 500) * (j + 0.5) / 5; for (let i = 0; i <= 8; i++) way.push([-250 + (r.L + 500) * (j % 2 ? 8 - i : i) / 8, t]); } }
  else { const o = -POOL.T / 2; for (const [s, t] of [[o, o], [r.L - o, o], [r.L - o, r.W - o], [o, r.W - o], [o, o]]) way.push([s, t]); }
  const P = (k) => { const n = way.length - 1, f = Math.min(n, k), i = Math.min(n - 1, Math.floor(f)), u = f - i, [s0, t0] = way[i], [s1, t1] = way[i + 1], [x, z] = PW(r, s0 + (s1 - s0) * u, t0 + (t1 - t0) * u); return new V(x, y, z); };
  app.setTool('hose');
  d.speed = 10;
  const ev = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  hs.down(new V(), ev(P(0)));
  start();
  let k = 0, done = false;
  const full = () => { const c = hs.ch; return !!c && (c.full || c.h.reduce((a, v) => a + v, 0) / c.h.length / c.cap >= 0.985); };
  // (the hose goes on when the concrete under it is up to the top)
  d.each((dt) => {
    if (done) return true;
    const c = hs.ch, p = P(k);
    let here = false;
    if (c) { const i = c.at(p.x, p.z), cap = c.brim ? c.brim(i) : c.cap; here = c.h[i] >= cap - 3; }
    k += dt * (here ? 2.2 : 0.35) * (part === 'floor' ? 1 : 0.5);
    if (k > way.length - 1) k = 0;
    hs.move(new V(), ev(P(k)));
    return false;
  });
  yield d.sec(1.3);
  shot(1);
  const t1 = d.t + 1.5;
  yield d.until(() => full() || d.t > t1);
  done = true;
  hs.up();
  yield d.until(() => !hs.busy);
  // (what the hose did not reach in the film's time: topped up — the short shows the pour, not all of it)
  { const b = belt(); if (b && !(b.fill >= 0.97)) pw._save('concrete-pour', () => app.objects.update(b.id, { lv: b.lv.map(() => b.H / S), fill: 1, castT: app.clock, pourT: app.clock, wetT: app.clock })); }
  app.setTool('wall');
  d.speed = 1;
}

// a layer swept over the bowl's faces: the cells go over from one end to the other, coat after coat
function* sweep(d, pw, key, dur) {
  const app = pw.app, r = pw.rec, F = faces(r), live = JSON.parse(JSON.stringify(r)), t0 = d.t;
  const want = (f) => { const [ni, nj] = cellsOf(f); return ni * nj; };
  live[key] = F.map((f) => '0'.repeat(want(f)));
  pw._live(live);
  yield d.until(() => {
    const u = Math.min(1, (d.t - t0) / dur);
    live[key] = F.map((f) => {
      const [ni, nj] = cellsOf(f), out = [];
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const x = f.P((i + 0.5) * POOL.cell, (j + 0.5) * POOL.cell)[0] / r.L;
        out.push(u * 2.1 - x > 1.05 ? '2' : u * 2.1 - x > 0.02 ? '1' : '0');
      }
      return out.join('');
    });
    pw._live(live);
    return u >= 1;
  });
  live[key] = F.map((f) => '2'.repeat(want(f)));
  pw._save('pool-' + key, () => app.objects.update(r.id, { [key]: live[key] }));
  pw._live(null);
}
