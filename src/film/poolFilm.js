import * as THREE from 'three';
import { MODEL_SCALE, TRAY, PUMP } from '../config.js';
import { POOL, PW, PF, rimY, floorTopY, wallTopY, waterMax, faces, cellsOf, sheetsOf, copeLayout, MOSAICS, embeds } from '../world/pool.js';
import { look } from './director.js';
import { unrle } from '../tools/belt.js';

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
  // (the textures of what comes later fetched now: a material's first frame is never drawn black)
  THREE.Cache.enabled = true;
  for (const dir of ['deck/graphite', 'travertine', 'pool_mosaic_turq', 'pool_coat']) for (const f of ['col.jpg', 'nor.jpg', 'rough.jpg']) new THREE.ImageLoader().load(`assets/textures/${dir}/${f}`, () => {}, undefined, () => {});

  // the place: the middle of the plot, along it; points in the pool's frame (mm)
  const C = new V(0, TRAY.soil, 0.06);
  const R = () => pw.rec;
  const at = (s, t, y) => { const r = R(), [x, z] = PW(r, s, t); return new V(x, y ?? r.g, z); };
  const gy = (s, t, y) => at(s, t, R().g + MM(y));                      // (mm over the ground)
  const fl = (s, t, y = 0) => at(s, t, floorTopY(R()) + MM(y));         // (mm over the bowl's floor)
  const mid = (y) => at(POOL.L / 2, POOL.W / 2, y);
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
  d.speed = 3;
  pw._dig(R(), null);
  d.cut(look(gy(-1500, -2600, 3600), gy(POOL.L * 0.45, W2, -900)), { fx: 'whip', drift: 0.05, push: 0.1 });
  d.title('EXCAVATION', '1.85 m deep, walls trimmed by hand', 2);
  yield d.sec(1.4);
  d.fly([[gy(-2500, -3500, 6000), gy(POOL.L / 2, W2, -1200)], [gy(1000, -1200, 2200), gy(POOL.L / 2, W2, -1600)]], 1.8, { fx: 'zoom' });
  d.count('soil hauled away', 93, ' m³', 1.2, 0, 1.9);
  yield d.held(1.6);

  // 3 · the stone: low between the heaps as they are tipped, then on the plate
  d.speed = 3.2;
  pw._bed(R(), null);
  const pitY = -1820;
  d.fly([[gy(-1200, -1400, pitY + 1500), gy(2600, W2, pitY + 200)], [gy(1800, -1000, pitY + 1300), gy(6000, W2, pitY + 200)]], 1.8, { fx: 'flash' });
  d.title('GRAVEL BASE', '200 mm crushed stone, compacted', 3);
  d.shake(0.008, 0.4);
  yield d.sec(1.7);
  d.fly([[gy(8800, -1800, 1400), gy(5200, W2, pitY + 200)], [gy(8600, 4800, 1500), gy(3200, W2, pitY + 200)]], 2.2, { fx: 'whip', ease: 'linear' });
  d.pin('+ 100 mm lean concrete', fl(POOL.L * 0.7, POOL.W * 0.3, -280), 1.4, -1);
  yield d.held(1.3);

  // 4 · the floor's bars: the flight — low over the mesh, the ties going by under the lens
  // (the edge boards of the slab going on, board by board, seen wide)
  d.speed = 1.8;
  pw._form1(R(), null);
  d.cut(look(gy(-2600, -2400, 2400), gy(3600, W2, -1500)), { fx: 'flash', drift: 0.05, push: 0.06 });
  d.title('FLOOR FORMS & REBAR', 'edge boards, then two meshes Ø12', 4);
  yield d.job();
  d.speed = 1.2;
  pw._cage1(R(), pw._belts(R()).fb);
  const ty = -60;   // (the top mesh: just under the slab's top)
  d.fly([
    [fl(-500, W2 - 500, ty + 260), fl(900, W2, ty)],
    [fl(2200, W2 - 200, ty + 160), fl(3800, W2 + 100, ty - 30)],
    [fl(5200, W2 + 300, ty + 220), fl(6800, W2 + 200, ty - 40)],
  ], 3.0, { fx: 'flash', ease: 'out' });
  yield d.held(3.0);
  d.speed = 1;

  // 5 · the floor poured: on the hose; a crane up off the concrete to straight down
  yield* pour(d, app, pw, 'floor', () => {
    d.title('CONCRETE FLOOR', '250 mm slab, pumped in one go', 5);
    d.follow(gear, { yaw: 0.6, pitch: 0.5, dist: 0.26 }, { fx: 'whip', drift: 0.1, push: 0.03, lag: 2.2 });
  }, () => {
    d.fly([[fl(1800, -300, 600), fl(2600, W2, 0)], [fl(2600, 600, 3500), fl(POOL.L / 2, W2, 0)], [fl(POOL.L / 2 - 200, W2 - 50, 9500), fl(POOL.L / 2, W2, 0)]], 2.2, { fx: 'zoom' });
    d.count('concrete', 9.1, ' m³', 1.0, 0, 1.6, 1);
  });

  // 6 · the walls: forms with the parts cast in — a dolly along them inside, the pins going by
  d.kick('7 DAYS LATER', 0.9);
  app.clock += 2400;
  d.cut({ target: mid(R().g - MM(1300)), yaw: 0.2, pitch: 0.95, dist: 0.9 }, { fx: 'flash', drift: 0.15 });
  yield d.sec(0.6);
  // (the walls' bars going up, then the forms round them board by board)
  d.speed = 1.8;
  pw._cage2(R(), pw._belts(R()).fb);
  d.title('WALL REBAR & FORMS', 'lights, jets & skimmers cast in', 6);
  yield d.job();
  pw._form2(R(), pw._belts(R()).fb, null);
  const E = embeds(R()), lamp = E.light[0];
  d.fly([[fl(7400, 2700, 900), fl(5600, 0, 800)], [fl(4600, 2500, 1000), fl(2800, 0, 800)], [fl(1700, 2300, 1100), fl(0, 0, 900)]], 2.4, { fx: 'whip' });
  yield d.job();
  d.speed = 1;
  yield d.sec(0.7);
  d.pin('LED light', fl(lamp.a, 0, lamp.b), 1.5);
  yield d.sec(1.6);
  yield* pour(d, app, pw, 'wall', () => {
    d.title('CONCRETE WALLS', 'poured in one go — no cold joints', 7);
    d.fly([[gy(-1300, -1300, 1700), gy(1500, 0, 250)], [gy(2600, -1700, 1500), gy(5600, 0, 250)]], 2.4, { fx: 'zoom', ease: 'linear' });
  }, () => d.cut({ target: mid(wallTopY(R())), yaw: 0.8, pitch: 0.7, dist: 1.0 }, { fx: 'whip', drift: 0.14 }));

  // 8 · stripped, the gap filled back
  d.kick('28 DAYS LATER', 0.9);
  d.cut(look(gy(-1800, -2200, 2600), gy(4200, W2, -1500)), { drift: 0.06, push: 0.05 });
  app.clock += 6000;
  d.speed = 1.8;
  { const r = R(), { fb, wb } = pw._belts(r); pw._strip(r, fb, wb); }
  yield d.job();
  d.speed = 3;
  { const r = R(), { fb, wb } = pw._belts(r); pw._fill(r, fb, wb); }
  d.fly([[gy(-2200, W2, 2200), gy(0, W2, -300)], [gy(-1900, -2300, 2000), gy(2500, -500, -300)], [gy(2600, -2700, 1800), gy(6000, -500, -300)]], 2.6, { fx: 'whip', ease: 'linear' });
  d.title('BACKFILL', 'sand in 300 mm layers, each compacted', 8);
  yield d.held(1.3);
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
  yield d.held(1.3);

  // 11 · the coping: on the mallet, then a skim along the stones
  d.speed = 2;
  { const r = R(), old = JSON.parse(JSON.stringify(r));
    const live = { ...old, copeCol: st.poolCope, cope: copeLayout(r).map((s) => '1'.repeat(s.n)) };
    pw._fitStones(live, old, () => pw._save('pool-cope', () => app.objects.update(r.id, { cope: live.cope, copeCol: live.copeCol }))); }
  d.follow(hand, { yaw: 0.5, pitch: 0.42, dist: 0.22 }, { fx: 'flash', drift: 0.1, lag: 1.0 });
  d.title('COPING', 'travertine, 30 mm over the water', 11);
  yield d.sec(1.1);
  d.fly([[gy(-900, -600, 650), gy(1500, 0, 300)], [gy(3000, -500, 500), gy(6000, 0, 280)], [gy(7600, -900, 900), gy(8000, W2, 200)]], 2.4, { fx: 'whip', ease: 'linear' });
  yield d.held(1.3);

  // 12 · the deck: chosen by the finger, then the joists and the boards — a low flight along it
  d.title('POOL DECK', 'pick the deck — joists, then boards', 12);
  d.cut(look(gy(-2600, -2800, 2600), gy(3600, W2, -300)), { fx: 'flash', drift: 0.05 });
  yield d.picker('CHOOSE THE DECK', [['Graphite WPC', 'deck/graphite'], ['Teak WPC', 'deck/teak'], ['Thermo ash', 'deck/thermo'], ['Travertine', 'travertine']].map(([name, dir]) => ({ name, img: sw(dir) })), 0, 1.7);
  d.speed = 2.6;
  pw._base(R());
  d.fly([[gy(-2200, -2600, 900), gy(2000, -900, 150)], [gy(2500, -2500, 700), gy(6500, -800, 150)]], 1.9, { fx: 'zoom', ease: 'linear' });
  yield d.held(1.3);
  pw._deck(R());
  d.fly([[gy(9800, -2600, 800), gy(6000, -900, 200)], [gy(6500, -2900, 1200), gy(2000, -700, 150)]], 2.6, { fx: 'whip', ease: 'linear' });
  yield d.held(1.3);

  // the water: a skim over the surface as it comes up, then wide
  d.speed = 14;
  st.poolLayer = 'water'; st.poolWater = 'fill';
  { const p = mid(floorTopY(R())); pw.down(p, scr(p)); }
  const water = () => fl(POOL.L * 0.25, W2, (pw.drag?.live?.water || R().water || 0));
  d.follow(water, { yaw: 1.3, pitch: 0.12, dist: 0.3 }, { fx: 'flash', drift: 0.06, push: 0.08, lag: 8 });
  d.title(''); d.stepName = 'WATER & LIGHTS';
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
  d.fly([[gy(-2800, -2600, 1400), gy(3800, W2, -600)], [gy(3000, -4200, 1100), gy(4200, W2, -600)], [gy(9600, -3200, 1500), gy(4400, W2, -600)]], 5.8, { fx: 'flash', ease: 'linear' });
  yield d.sec(0.9);
  d.kick('FROM DIRT TO THIS', 1.3, 'gold');
  yield d.sec(1.3);
  // the answer to the hook's question: the bill of it all, stage by stage, the total stamped
  yield d.receipt('MATERIALS · POOL 8 × 3.5 M', 3.4, 'materials & machine hire · labour not included');

  // the loop: back into the sun, a drone flight that ends just where the film begins (the hook,
  // put first by the renderer, goes on with the same flight) — played round, it never stops
  d.clear();
  app.sky.setHour(12.5);
  const A = [gy(11000, -3600, 3200), gy(4200, W2, -700)], B = [gy(9600, -2400, 2300), gy(3800, W2, -500)];
  const back = (k) => [A[0].clone().lerp(B[0], -k), A[1].clone().lerp(B[1], -k)];
  d.fly([back(0.6), A], 1.0, { fx: 'flash', ease: 'linear' });   // (the same speed as the hook's: 0.6 of A→B in 1 s, A→B in 1.7 s)
  yield d.sec(1.0);
  d.fly([A, B], 1.7, { ease: 'linear' });
  d.mark('hook');
  yield d.sec(0.05);
  d.title('WHAT DID THIS POOL COST?', 'every step, every dollar — guess first');
  yield d.sec(1.65);
  d.mark('hookEnd');
}

// the pour, as the film shows it: a front of concrete going over the slab from one end to the other
// (the walls: round and round in lifts), the hose at the front — every frame a little more, never a
// heap left standing; start() — the first shot, then() a second and a bit on
function* pour(d, app, pw, part, start, then) {
  const V = THREE.Vector3, r = pw.rec, belt = () => pw._belts(pw.rec)[part === 'floor' ? 'fb' : 'wb'];
  const b0 = belt(), Hmm = b0.H / S, n = b0.ni * b0.nj, mask = unrle(b0.mask, n), cells = [];
  const px = -b0.u[1], pz = b0.u[0];
  for (let k = 0; k < n; k++) if (mask[k]) {
    const i = k % b0.ni, j = Math.floor(k / b0.ni), x = b0.o[0] + (b0.u[0] * (i + 0.5) + px * (j + 0.5)) * b0.c, z = b0.o[1] + (b0.u[1] * (i + 0.5) + pz * (j + 0.5)) * b0.c;
    const [ss, tt] = PF(r, x, z);
    cells.push({ ss, tt, x, z });
  }
  // (the walls: how far round each cell lies, as a share of the way round)
  const per = 2 * (r.L + r.W + 2 * POOL.T);
  const round = (ss, tt) => { const o = -POOL.T / 2, w = r.L + POOL.T, h = r.W + POOL.T, d0 = Math.abs(tt - o), d1 = Math.abs(ss - (r.L - o)), d2 = Math.abs(tt - (r.W - o)), d3 = Math.abs(ss - o), m = Math.min(d0, d1, d2, d3);
    return (m === d0 ? ss - o : m === d1 ? w + (tt - o) : m === d2 ? w + h + (w - (ss - o)) : 2 * w + h + (h - (tt - o))) / per; };
  if (part === 'wall') for (const c of cells) c.p = round(c.ss, c.tt);
  const lifts = 3, dur = part === 'floor' ? 3.0 : 3.2;
  app.setTool('hose');
  app.journal.begin('concrete-pour', {}, app.clock);
  start();
  const lv = new Array(cells.length).fill(0);
  let t0 = d.t, done = false;
  const y0 = part === 'floor' ? b0.top : b0.top;
  d.each(() => {
    if (done) return true;
    const u = Math.min(1, (d.t - t0) / dur), wob = (c) => 0.06 * Math.sin(c.tt * 0.004 + c.ss * 0.003);
    let hx = 0, hz = 0, hy = y0;
    if (part === 'floor') {
      const front = -900 + (r.L + 2600) * u;
      cells.forEach((c, k) => { lv[k] = Math.max(lv[k], Hmm * Math.max(0, Math.min(1, (front - c.ss) / 1500 + wob(c)))); });
      const [x, z] = PW(r, Math.max(-200, Math.min(r.L + 200, front - 500)), r.W / 2 + Math.sin(u * Math.PI * 9) * r.W * 0.42);
      hx = x; hz = z; hy = y0 + MM(Hmm * 0.8);
    } else {
      const F = u * (lifts + 0.35);
      cells.forEach((c, k) => { lv[k] = Math.max(lv[k], Hmm * Math.max(0, Math.min(1, (F - c.p) / lifts + wob(c) * 0.3))); });
      const q = F % 1, o = -POOL.T / 2, w = r.L + POOL.T, h = r.W + POOL.T, dd = q * per;
      const [ss, tt] = dd < w ? [o + dd, o] : dd < w + h ? [r.L - o, o + dd - w] : dd < 2 * w + h ? [r.L - o - (dd - w - h), r.W - o] : [o, r.W - o - (dd - 2 * w - h)];
      const [x, z] = PW(r, ss, tt); hx = x; hz = z; hy = wallTopY(r);
    }
    app.concreteGear.set('hose', new V(hx, hy, hz));
    const bb = belt(), mean = lv.reduce((a, v) => a + v, 0) / lv.length / Hmm;
    app.objects.update(bb.id, { lv: lv.map((v) => Math.round(v)), fill: +mean.toFixed(3), pourT: app.clock, wetT: app.clock });
    if (Math.random() < 0.3) app.sfx?.pour?.(0.5);
    return false;
  });
  yield d.sec(1.3);
  then();
  yield d.until(() => d.t - t0 >= dur);
  done = true;
  { const bb = belt(); app.objects.update(bb.id, { lv: lv.map(() => Math.round(Hmm)), fill: 1, castT: app.clock, pourT: app.clock, wetT: app.clock }); }
  app.journal.commit(app.clock);
  app.concreteGear.set(null);
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
