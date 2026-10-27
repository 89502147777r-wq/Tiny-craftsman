import * as THREE from 'three';
import { MODEL_SCALE, TRAY, PUMP } from '../config.js';
import { POOL, PW, rimY, floorTopY, wallTopY, waterMax, faces, cellsOf, sheetsOf, copeLayout, MOSAICS } from '../world/pool.js';

// «How a backyard pool is built» — the pool done start to finish by the jobs of the pool tool
// (poolTool.js), the camera and the words of the short over it (director.js)
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;

export function* poolFilm(d, app) {
  const V = THREE.Vector3, pw = app.wallTool.pool, st = app.settings;
  const scr = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  Object.assign(st, { wallKind: 'pool', poolMos: 'turq', poolCope: 'trav', poolDeck: 'wpc:grey', poolDeckW: 1500, pump: PUMP[2], dayHour: 11 });
  app.sky.setHour(11);
  app.setTool('wall'); app.wallTool.setMode('lay');

  // the place: the middle of the plot, along it
  const C = new V(0, TRAY.soil, 0.06);
  const at = (s, t, y) => { const r = pw.rec, [x, z] = PW(r, s, t); return new V(x, y ?? r.g, z); };
  const mid = () => at(POOL.L / 2, POOL.W / 2);
  d.view({ target: C, yaw: 0.6, pitch: 0.55, dist: 1.9 }, 0.01);
  yield d.sec(0.05);
  d.view({ target: C, yaw: 0.35, pitch: 0.72, dist: 1.55 }, 2.6);
  d.title('HOW A POOL IS BUILT', '8 × 3.5 m concrete pool · every step');
  yield d.sec(1.0);

  // 1 · setting out
  st.poolLayer = 'pit';
  pw.down(C, scr(C)); pw.move(C, scr(C)); pw.up();
  const r0 = pw.rec;
  d.title('SETTING OUT', 'pit 9.7 × 5.2 m', 'STEP 1');
  yield d.sec(1.0);

  // 2 · the pit
  d.speed = 1.6;
  d.view({ target: mid().setY(r0.g - MM(600)), yaw: 0.2, pitch: 0.82, dist: 1.0 }, 1.5, 0.03);
  d.title('EXCAVATION', '1.85 m deep · ~90 m³ of soil hauled', 'STEP 2');
  pw._dig(pw.rec, null);
  yield d.job();

  // 3 · crushed stone, rammed; lean concrete
  d.speed = 2.6;
  d.title('GRAVEL BASE', '200 mm crushed stone, compacted · 100 mm lean concrete', 'STEP 3');
  d.view({ target: mid().setY(r0.g - MM(1500)), yaw: 0.1, pitch: 0.85, dist: 1.05 }, 1.5, 0.02);
  pw._bed(pw.rec, null);
  yield d.job();

  // 4 · the floor: edge boards, two meshes of bars
  d.speed = 1;
  pw._form1(pw.rec, null);
  yield d.sec(0.3);
  pw._cage1(pw.rec, pw._belts(pw.rec).fb);
  d.title('FLOOR REBAR', 'two meshes Ø12 @ 200 mm · starter bars for walls', 'STEP 4');
  d.view({ target: at(POOL.L * 0.3, POOL.W * 0.4, floorTopY(pw.rec)), yaw: 0.9, pitch: 0.55, dist: 0.42 }, 1.6, 0.04);
  yield d.sec(0.6);
  d.pin('Ø12 rebar', at(POOL.L * 0.3, POOL.W * 0.3, floorTopY(pw.rec) - MM(80)), 1.6);
  yield d.sec(1.4);

  // 5 · the floor poured
  yield* pour(d, app, pw, 'floor', 'CONCRETE FLOOR', '250 mm slab · pump & vibrator', 'STEP 5');

  // 6 · the walls: bars, forms with the embedded parts (the floor gains strength first)
  d.flash('7 DAYS LATER');
  app.clock += 2400;
  yield d.sec(0.8);
  pw._cage2(pw.rec, pw._belts(pw.rec).fb);
  yield d.sec(0.2);
  pw._form2(pw.rec, pw._belts(pw.rec).fb, null);
  d.title('WALL FORMWORK', 'rebar cages · skimmers, jets & lights cast in', 'STEP 6');
  d.view({ target: mid().setY(wallTopY(pw.rec) - MM(400)), yaw: 0.45, pitch: 0.7, dist: 0.95 }, 1.2, 0.03);
  yield d.sec(1.6);
  yield* pour(d, app, pw, 'wall', 'CONCRETE WALLS', 'poured in one go · no cold joints', 'STEP 7');

  // 8 · stripped; the gap round it filled back
  d.flash('28 DAYS LATER');
  app.clock += 6000;
  yield d.sec(0.7);
  { const r = pw.rec, { fb, wb } = pw._belts(r); pw._strip(r, fb, wb); }
  d.title('STRIP & BACKFILL', 'sand in 300 mm layers, each one compacted', 'STEP 8');
  d.view({ target: mid().setY(r0.g - MM(700)), yaw: 0.3, pitch: 0.78, dist: 1.05 }, 1.2, 0.03);
  yield d.sec(0.4);
  d.speed = 3;
  { const r = pw.rec, { fb, wb } = pw._belts(r); pw._fill(r, fb, wb); }
  yield d.job();

  // 9 · the coating: two coats, swept over the bowl
  d.speed = 1;
  d.title('WATERPROOFING', '2 coats of cement membrane · taped corners', 'STEP 9');
  d.view({ target: mid().setY(floorTopY(pw.rec) + MM(500)), yaw: 0.25, pitch: 1.0, dist: 0.8 }, 1.2, 0.02);
  yield* sweep(d, pw, 'proof', 1.9);

  // 10 · the mosaic
  d.title('GLASS MOSAIC', '316 × 316 mm sheets on flexible glue', 'STEP 10');
  d.view({ target: mid().setY(floorTopY(pw.rec) + MM(600)), yaw: 0.7, pitch: 0.8, dist: 0.85 }, 1.2, 0.03);
  d.speed = 1.7;
  { const r = pw.rec, old = JSON.parse(JSON.stringify(r)), L = MOSAICS[st.poolMos][3];
    const live = { ...old, tile: faces(r).map((f) => { const [ni, nj] = sheetsOf(f); return L.repeat(ni * nj); }) };
    pw._fitSheets(live, old, () => pw._save('pool-tile', () => app.objects.update(r.id, { tile: live.tile }))); }
  yield d.job();

  // 11 · the coping
  d.title('COPING STONES', 'travertine, 30 mm over the water', 'STEP 11');
  d.view({ target: at(POOL.L * 0.15, 0, rimY(pw.rec)), yaw: 1.1, pitch: 0.55, dist: 0.6 }, 1.2, 0.05);
  d.speed = 1.8;
  { const r = pw.rec, old = JSON.parse(JSON.stringify(r));
    const live = { ...old, copeCol: st.poolCope, cope: copeLayout(r).map((s) => '1'.repeat(s.n)) };
    pw._fitStones(live, old, () => pw._save('pool-cope', () => app.objects.update(r.id, { cope: live.cope, copeCol: live.copeCol }))); }
  yield d.job();

  // 12 · the deck round it
  d.speed = 2.3;
  d.title('POOL DECK', 'concrete pads · joists · WPC boards', 'STEP 12');
  d.view({ target: mid(), yaw: 0.6, pitch: 0.7, dist: 1.15 }, 1.3, 0.04);
  pw._base(pw.rec);
  yield d.job();
  pw._deck(pw.rec);
  yield d.job();

  // 13 · the water
  d.speed = 11;
  d.title('FILLING', '≈ 40 m³ of water', 'STEP 13');
  d.view({ target: mid().setY(rimY(pw.rec) - MM(500)), yaw: 0.9, pitch: 0.5, dist: 0.85 }, 1.2, 0.04);
  st.poolLayer = 'water'; st.poolWater = 'fill';
  { const p = mid().setY(floorTopY(pw.rec)); pw.down(p, scr(p)); }
  yield d.until(() => (pw.drag?.live?.water || 0) >= waterMax(pw.rec) - 1);
  pw.up();

  // the evening: the lights come on
  d.speed = 1;
  pw._save('pool-light', () => app.objects.update(pw.rec.id, { light: true }));
  d.title('');
  d.view({ target: mid().setY(rimY(pw.rec)), yaw: 1.5, pitch: 0.42, dist: 1.0 }, 4.0, 0.03);
  const h0 = 17.5;
  d.each(((k) => (dt) => { k += dt / 2.6; app.sky.setHour(h0 + 2.8 * Math.min(1, k)); return k >= 1; })(0));
  yield d.sec(3.0);
  d.end('Built step by step in Tiny Craftsman');
  yield d.sec(2.2);
}

// the hose over the floor slab / along the walls' tops till the forms are full
function* pour(d, app, pw, part, title, sub, step) {
  const V = THREE.Vector3, r = pw.rec, hs = app.concreteTools.hose;
  const belt = () => pw._belts(pw.rec)[part === 'floor' ? 'fb' : 'wb'];
  const b = belt(), y = part === 'floor' ? b.top : wallTopY(r);
  // the way the hose goes: back and forth over the slab / round the walls
  const way = [];
  if (part === 'floor') { for (let j = 0; j < 5; j++) { const t = -250 + (r.W + 500) * (j + 0.5) / 5; for (let i = 0; i <= 8; i++) way.push([-250 + (r.L + 500) * (j % 2 ? 8 - i : i) / 8, t]); } }
  else { const o = -POOL.T / 2; for (const [s, t] of [[o, o], [r.L - o, o], [r.L - o, r.W - o], [o, r.W - o], [o, o]]) way.push([s, t]); }
  const P = (k) => { const n = way.length - 1, f = Math.min(n, k), i = Math.min(n - 1, Math.floor(f)), u = f - i, [s0, t0] = way[i], [s1, t1] = way[i + 1], [x, z] = PW(r, s0 + (s1 - s0) * u, t0 + (t1 - t0) * u); return new V(x, y, z); };
  d.title(title, sub, step);
  const [cx, cz] = PW(r, r.L / 2, r.W / 2);
  d.view({ target: new V(cx, y - MM(300), cz), yaw: part === 'floor' ? 0.25 : 0.75, pitch: 0.72, dist: 0.95 }, 1.2, 0.03);
  yield d.sec(1.0);
  app.setTool('hose');
  d.speed = 10;
  const ev = (p) => { const q = app.wallTool._screen(p); return { clientX: q.x, clientY: q.y }; };
  hs.down(new V(), ev(P(0)));
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
  const t1 = d.t + 3.6;
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
  // (by s: the far end first, along the pool)
  const order = F.map((f) => { const [ni] = cellsOf(f); return { f, ni }; });
  yield d.until(() => {
    const u = Math.min(1, (d.t - t0) / dur);
    live[key] = order.map(({ f, ni }) => {
      const [, nj] = cellsOf(f), out = [];
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const p = f.P((i + 0.5) * POOL.cell, (j + 0.5) * POOL.cell), x = p[0] / r.L;
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
