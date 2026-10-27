import * as THREE from 'three';
import { MODEL_SCALE, TRAY, PUMP } from '../config.js';
import { POOL, PW, rimY, floorTopY, wallTopY, waterMax, faces, cellsOf, sheetsOf, copeLayout, MOSAICS, embeds } from '../world/pool.js';
import { look } from './director.js';

// «How a backyard pool is built» — the pool done start to finish by the jobs of the pool tool
// (poolTool.js), filmed and cut by the director (director.js) as a film is: flights low over the
// bars and along the forms, a crane up from the pour, a skim over the water, close shots that
// follow the tools, cuts every second or two; and the game in it — the budget running down with
// every bill, the materials chosen by a finger.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const DECK = 'wpc:graphite', MOS = 'turq';

export function* poolFilm(d, app) {
  const V = THREE.Vector3, pw = app.wallTool.pool, st = app.settings;
  const scr = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  Object.assign(st, { wallKind: 'pool', poolMos: MOS, poolCope: 'trav', poolDeck: DECK, poolDeckW: 1500, pump: PUMP[2], dayHour: 11 });
  app.sky.setHour(11);
  app.setTool('wall'); app.wallTool.setMode('lay');
  // (the game's budget: $100k, every stage billed)
  if (!app.budget.on) app.objects.add({ type: 'budget', money: 100000, start: 100000 });
  d.bar(12);

  // the place: the middle of the plot, along it; points in the pool's frame (mm)
  const C = new V(0, TRAY.soil, 0.06);
  const R = () => pw.rec;
  const at = (s, t, y) => { const r = R(), [x, z] = PW(r, s, t); return new V(x, y ?? r.g, z); };
  const gy = (s, t, y) => at(s, t, R().g + MM(y));                      // (mm over the ground)
  const fl = (s, t, y = 0) => at(s, t, floorTopY(R()) + MM(y));         // (mm over the bowl's floor)
  const mid = (y) => at(POOL.L / 2, POOL.W / 2, y);
  const shovel = () => app.shovel.root.position;
  const gear = () => app.concreteGear.pos;
  const plate = () => (app.concreteGear.show === 'plate' ? gear() : null);
  const hand = () => { const h = app.handTools, t = h.cur && h.tools[h.cur]; return t?.g.visible ? t.g.position : null; };
  const W2 = POOL.W / 2;

  // ---- the plot: a flight low over the bare ground; the budget comes up --------------------------
  // (the plot's frame before the pool is set out: C its middle, along x)
  const g0 = (s, t, y) => new V(C.x + MM(s - POOL.L / 2), TRAY.soil + MM(y), C.z + MM(t - W2));
  d.fly([[g0(-9000, -6000, 900), g0(2000, W2, 0)], [g0(-4000, -2500, 650), g0(5000, W2, 0)], [g0(0, 0, 1800), g0(6000, W2, -200)]], 2.0);
  yield d.sec(0.05);
  d.kick('IT STARTS HERE', 1.0);
  d.money(true);
  yield d.sec(1.1);

  // 1 · setting out: straight down, the lines snap in
  st.poolLayer = 'pit';
  pw.down(C, scr(C)); pw.move(C, scr(C)); pw.up();
  d.cut({ target: C, yaw: 0.0, pitch: 1.45, dist: 1.25 }, { fx: 'flash', drift: 0.15, push: 0.08 });
  d.title('SETTING OUT', 'pit 9.7 × 5.2 m — wider than the pool', 1);
  yield d.sec(1.1);

  // 2 · the pit: a drone dropping into it as it is dug, then on the spade
  d.speed = 2.6;
  pw._dig(R(), null);
  d.fly([[gy(-2500, -3500, 6000), gy(POOL.L / 2, W2, -1200)], [gy(1000, -1200, 2200), gy(POOL.L / 2, W2, -1600)]], 1.4, { fx: 'whip' });
  d.title('EXCAVATION', '1.85 m deep, walls trimmed by hand', 2);
  d.count('soil hauled away', 93, ' m³', 1.6, 0, 2.2);
  yield d.sec(1.3);
  d.follow(shovel, { yaw: 1.2, pitch: 0.42, dist: 0.3 }, { fx: 'zoom', drift: 0.12, push: 0.06, lag: 3 });
  yield d.job();

  // 3 · the stone: low between the heaps as they are tipped, then on the plate
  d.speed = 3.2;
  pw._bed(R(), null);
  const pitY = -1820;
  d.fly([[gy(-1200, -1400, pitY + 1500), gy(2600, W2, pitY + 200)], [gy(1800, -1000, pitY + 1300), gy(6000, W2, pitY + 200)]], 1.8, { fx: 'flash' });
  d.title('GRAVEL BASE', '200 mm crushed stone, compacted', 3);
  d.shake(0.008, 0.4);
  yield d.sec(1.7);
  d.follow(plate, { yaw: 2.3, pitch: 0.55, dist: 0.4 }, { fx: 'whip', drift: 0.12, lag: 4 });
  d.pin('+ 100 mm lean concrete', fl(POOL.L * 0.7, POOL.W * 0.3, -280), 1.4, -1);
  yield d.job();

  // 4 · the floor's bars: the flight — low over the mesh, the ties going by under the lens
  d.speed = 1;
  pw._form1(R(), null);
  pw._cage1(R(), pw._belts(R()).fb);
  const ty = -60;   // (the top mesh: just under the slab's top)
  d.fly([
    [fl(-500, W2 - 500, ty + 260), fl(900, W2, ty)],
    [fl(2200, W2 - 200, ty + 160), fl(3800, W2 + 100, ty - 30)],
    [fl(5200, W2 + 300, ty + 200), fl(6800, W2 + 200, ty - 20)],
    [fl(7600, W2 + 900, ty + 900), fl(5200, W2, ty - 100)],
  ], 3.0, { fx: 'flash', ease: 'out' });
  d.title('FLOOR REBAR', 'two meshes Ø12, every crossing tied', 4);
  yield d.sec(1.2);
  d.pin('starter bars for the walls', fl(POOL.L, W2 + 400, 250), 1.5);
  yield d.sec(1.8);

  // 5 · the floor poured: on the hose; a crane up off the concrete to straight down
  yield* pour(d, app, pw, 'floor', () => {
    d.title('CONCRETE FLOOR', '250 mm slab, pumped in one go', 5);
    d.follow(gear, { yaw: 0.6, pitch: 0.5, dist: 0.24 }, { fx: 'whip', drift: 0.12, push: 0.04, lag: 5 });
  }, () => {
    d.fly([[fl(1800, -300, 600), fl(2600, W2, 0)], [fl(2600, 600, 3500), fl(POOL.L / 2, W2, 0)], [fl(POOL.L / 2 - 200, W2 - 50, 9500), fl(POOL.L / 2, W2, 0)]], 2.2, { fx: 'zoom' });
    d.count('concrete', 9.1, ' m³', 1.0, 0, 1.6, 1);
  });

  // 6 · the walls: forms with the parts cast in — a dolly along them inside, the pins going by
  d.kick('7 DAYS LATER', 0.9);
  app.clock += 2400;
  pw._cage2(R(), pw._belts(R()).fb);
  pw._form2(R(), pw._belts(R()).fb, null);
  d.cut({ target: mid(R().g - MM(1300)), yaw: 0.2, pitch: 0.95, dist: 0.9 }, { fx: 'flash', drift: 0.15 });
  yield d.sec(0.8);
  const E = embeds(R()), lamp = E.light[0];
  d.fly([[fl(7400, 2700, 900), fl(5600, 0, 800)], [fl(4600, 2500, 1000), fl(2800, 0, 800)], [fl(1700, 2300, 1100), fl(0, 0, 900)]], 2.4, { fx: 'whip' });
  d.title('WALL FORMS', 'lights, jets & skimmers cast in', 6);
  yield d.sec(0.7);
  d.pin('LED light', fl(lamp.a, 0, lamp.b), 1.5);
  yield d.sec(1.6);
  yield* pour(d, app, pw, 'wall', () => {
    d.title('CONCRETE WALLS', 'poured in one go — no cold joints', 7);
    d.follow(gear, { yaw: 2.4, pitch: 0.95, dist: 0.38 }, { fx: 'zoom', drift: -0.12, lag: 5 });
  }, () => d.cut({ target: mid(wallTopY(R())), yaw: 0.8, pitch: 0.7, dist: 1.0 }, { fx: 'whip', drift: 0.14 }));

  // 8 · stripped, the gap filled back
  d.kick('28 DAYS LATER', 0.9);
  d.cut(look(gy(-1800, -2200, 2600), gy(4200, W2, -1500)), { drift: 0.06, push: 0.05 });
  app.clock += 6000;
  { const r = R(), { fb, wb } = pw._belts(r); pw._strip(r, fb, wb); }
  yield d.sec(0.8);
  d.speed = 4;
  { const r = R(), { fb, wb } = pw._belts(r); pw._fill(r, fb, wb); }
  d.follow(plate, { yaw: 2.6, pitch: 0.8, dist: 0.36 }, { fx: 'whip', drift: 0.12, lag: 4 });
  d.title('BACKFILL', 'sand in 300 mm layers, each compacted', 8);
  yield d.job();
  // (the setting-out — stakes and strings round the pit — comes away once it is filled back)
  { const r = R(); if (r.pit != null && app.objects.get(r.pit)) pw._save('pit-out', () => app.objects.remove(r.pit)); }

  // 9 · the coating: straight down into the bowl, turning, swept over
  d.speed = 1;
  d.cut({ target: mid(floorTopY(R())), yaw: 1.57, pitch: 1.45, dist: 0.85 }, { fx: 'whip', drift: 0.3, push: 0.08 });
  d.title('WATERPROOFING', '2 coats of cement membrane', 9);
  yield* sweep(d, pw, 'proof', 1.6);

  // 10 · the mosaic: chosen by the finger (the game), then laid — low in the bowl
  const sw = (dir) => `assets/textures/${dir}/col.jpg`;
  d.title('GLASS MOSAIC', 'pick the colour — then sheet by sheet', 10);
  d.cut(look(fl(7300, 3000, 1100), fl(2600, 0, 600)), { fx: 'zoom', drift: 0.03, push: 0.05 });
  yield d.picker('CHOOSE THE MOSAIC', [['Turquoise', 'pool_mosaic_turq'], ['Blue', 'pool_mosaic_blue'], ['Aqua mix', 'pool_mosaic_aqua'], ['White', 'pool_mosaic_white']].map(([name, dir]) => ({ name, img: sw(dir) })), 0, 1.7);
  d.speed = 2.2;
  { const r = R(), old = JSON.parse(JSON.stringify(r)), L = MOSAICS[st.poolMos][3];
    const live = { ...old, tile: faces(r).map((f) => { const [ni, nj] = sheetsOf(f); return L.repeat(ni * nj); }) };
    pw._fitSheets(live, old, () => pw._save('pool-tile', () => app.objects.update(r.id, { tile: live.tile }))); }
  d.fly([[fl(7300, 3000, 1100), fl(2600, 0, 600)], [fl(5200, 2900, 700), fl(1200, 0, 500)]], 2.4, { ease: 'linear' });
  yield d.job();

  // 11 · the coping: on the mallet, then a skim along the stones
  d.speed = 2;
  { const r = R(), old = JSON.parse(JSON.stringify(r));
    const live = { ...old, copeCol: st.poolCope, cope: copeLayout(r).map((s) => '1'.repeat(s.n)) };
    pw._fitStones(live, old, () => pw._save('pool-cope', () => app.objects.update(r.id, { cope: live.cope, copeCol: live.copeCol }))); }
  d.follow(hand, { yaw: 0.5, pitch: 0.42, dist: 0.2 }, { fx: 'flash', drift: 0.1, lag: 7 });
  d.title('COPING', 'travertine, 30 mm over the water', 11);
  yield d.sec(1.1);
  d.fly([[gy(-900, -600, 650), gy(1500, 0, 300)], [gy(3000, -500, 500), gy(6000, 0, 280)], [gy(7600, -900, 900), gy(8000, W2, 200)]], 2.4, { fx: 'whip', ease: 'linear' });
  yield d.job();

  // 12 · the deck: chosen by the finger, then the joists and the boards — a low flight along it
  d.title('POOL DECK', 'pick the deck — joists, then boards', 12);
  d.cut(look(gy(-2600, -2800, 2600), gy(3600, W2, -300)), { fx: 'flash', drift: 0.05 });
  yield d.picker('CHOOSE THE DECK', [['Graphite WPC', 'deck/graphite'], ['Teak WPC', 'deck/teak'], ['Thermo ash', 'deck/thermo'], ['Travertine', 'travertine']].map(([name, dir]) => ({ name, img: sw(dir) })), 0, 1.7);
  d.speed = 2.6;
  pw._base(R());
  d.fly([[gy(-2200, -2600, 900), gy(2000, -900, 150)], [gy(2500, -2500, 700), gy(6500, -800, 150)]], 1.9, { fx: 'zoom', ease: 'linear' });
  yield d.job();
  pw._deck(R());
  d.fly([[gy(9800, -2600, 800), gy(6000, -900, 200)], [gy(6500, -2900, 1200), gy(2000, -700, 150)]], 2.6, { fx: 'whip', ease: 'linear' });
  yield d.job();

  // the water: a skim over the surface as it comes up, then wide
  d.speed = 14;
  st.poolLayer = 'water'; st.poolWater = 'fill';
  { const p = mid(floorTopY(R())); pw.down(p, scr(p)); }
  const water = () => fl(POOL.L * 0.25, W2, (pw.drag?.live?.water || R().water || 0));
  d.follow(water, { yaw: 1.3, pitch: 0.12, dist: 0.3 }, { fx: 'flash', drift: 0.06, push: 0.08, lag: 8 });
  d.title('');
  d.count('water', Math.round(POOL.L * POOL.W * waterMax(R()) / 1e9), ' m³', 2.2, 0, 2.4);
  yield d.sec(1.6);
  d.cut({ target: mid(rimY(R()) - MM(400)), yaw: 0.9, pitch: 0.55, dist: 0.95 }, { fx: 'whip', drift: 0.12 });
  yield d.until(() => (pw.drag?.live?.water || 0) >= waterMax(R()) - 1);
  pw.up();

  // the evening: the lights on — a slow flight round the pool, low
  d.speed = 1;
  pw._save('pool-light', () => app.objects.update(R().id, { light: true }));
  const h0 = 17.8;
  d.each(((k) => () => { k += d.dt / 1.8; app.sky.setHour(h0 + 2.4 * Math.min(1, k)); return k >= 1; })(0));
  d.fly([[gy(-2800, -2600, 1400), gy(3800, W2, -600)], [gy(3000, -4200, 1100), gy(4200, W2, -600)], [gy(9600, -3200, 1500), gy(4400, W2, -600)]], 4.4, { fx: 'flash', ease: 'linear' });
  yield d.sec(1.2);
  d.kick('FROM DIRT TO THIS', 1.7, 'gold');
  yield d.sec(2.0);
  d.end('Built step by step in Tiny Craftsman');
  yield d.sec(2.0);

  // the hook (put first by the renderer): the pool done, in the sun, a slow drone pass — «how?»
  d.clear();
  app.sky.setHour(12.5);
  d.fly([[gy(11000, -3600, 3200), gy(4200, W2, -700)], [gy(9600, -2400, 2300), gy(3800, W2, -500)]], 1.7, { ease: 'linear' });
  d.mark('hook');
  yield d.sec(0.05);
  d.title('HOW IS THIS BUILT?', 'every step, from bare ground');
  yield d.sec(1.6);
  d.mark('hookEnd');
}

// the hose over the floor slab / along the walls' tops till the forms are full; start() — the
// first shot, then() a second and a bit on
function* pour(d, app, pw, part, start, then) {
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
  then();
  const t1 = d.t + 1.6;
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
