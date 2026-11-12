import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look, low } from './director.js';
import { loadPhysics, physicsReady } from '../world/physics.js';
import { edges } from '../world/outlines.js';
import { digPit } from '../tools/pitJob.js';
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
  slab: { x0: -5000, x1: 5150, z0: -2350, z1: 4200, h: 300, bed: 250 },
  pad: { x0: -8900, x1: -6900, z0: 1800, z1: 4700, h: 400, bed: 200 },
  pool: { x0: -6000, x1: 4000, z0: -5700, z1: -3100 },   // (the water's edge: 10 × 2.6 m)
  up: 250,                                                // (the tops of all of them over the ground: the pool's wall top)
};

export function* foundFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, G = app.concreteGear, st = app.settings, pw = app.wallTool.pool;
  Object.assign(st, { dayHour: 9.5, pump: 0.625, rebarD: 16, rebarStep: 200 }); app.sky.setHour(9.5);
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
  d.cut(look(P(-9500, 5200, 3500), P(-1000, 0, -4400)), { drift: 0.02, push: 0.02, hand: 0.4 });
  yield d.until(() => physicsReady());
  { const a = P(B.x0, 0, B.z0), b = P(B.x1, 0, B.z1); pw.down(a, scr(a)); pw.move(b, scr(b)); pw.up(); }
  const R = () => pw.rec, belts = () => pw._belts(R());
  yield d.sec(0.5);
  say('pool ' + JSON.stringify([R()?.L, R()?.W]));
  d.speed = 4;
  pw._dig(R(), null);
  yield d.until(idle);
  d.speed = 1;
  // ---- 2 · the shallow pits: the strip, the slab, the pad ---------------------------------------------
  app.setTool('mark');
  const pits = {};
  for (const k of ['spine', 'slab', 'pad']) { const q = IBIZA[k]; pits[k] = O.add({ type: 'outline', kind: 'rect', x0: MM(q.x0), z0: MM(q.z0), x1: MM(q.x1), z1: MM(q.z1), depth: +((q.h + q.bed - IBIZA.up) / MODEL_SCALE).toFixed(2) }); }
  d.cut(look(P(IBIZA.X0 + 3800, 2600, 9800), P(IBIZA.X0 - 600, 0, -1500)), { drift: 0.02, push: 0.02, hand: 0.4 });
  d.speed = 2;
  digPit(app, O.get(pits.spine.id));
  yield d.until(idle);
  d.speed = 6;
  d.cut(look(P(-11500, 7500, 10500), P(-500, 0, 0)), { drift: 0.02, push: 0.015, hand: 0.4 });
  digPit(app, O.get(pits.slab.id));
  yield d.until(idle);
  digPit(app, O.get(pits.pad.id));
  yield d.until(idle);
  d.speed = 1;
  app.budget._pay([{ usd: 650 }], P(0, 0, 0));   // (the shallow pits: ~28 m³ more taken away; the pool's pit is billed by its own job)
  d.stageBill('EXCAVATION · 130 m³');
  yield d.sec(0.9);
  say('dug ' + ['spine', 'slab', 'pad'].map((k) => Math.round((T.heightAt(MM((IBIZA[k].x0 + IBIZA[k].x1) / 2), MM((IBIZA[k].z0 + IBIZA[k].z1) / 2)) - g) / S)).join(' '));

  // ---- 3 · the beds: the pool's stone and lean concrete; sand and stone under the rest, rammed -------
  d.speed = 4;
  d.cut(look(P(-8500, 3000, -1200), P(-1000, -1700, -4400)), { drift: 0.02, push: 0.02, hand: 0.4 });
  pw._bed(R(), null);
  yield d.until(idle);
  d.speed = 1;
  say('bed done');
  d.done1 = true;
  d.mark('hook');
  d.kick('70 TONNES ON THIS?', 2.2, 'top');
  yield d.sec(2.4);
  d.mark('hookEnd');
  yield d.sec(0.1);
  void G; void low; void edges; void PW; void floorTopY; void wallTopY; void belts;
}
foundFilm.seconds = 34;
foundFilm.place = 'beach';
foundFilm.sounds = ['shovel_dig', 'soil_dump', 'gravel_pour', 'compactor', 'hammer_nail', 'plank', 'stake', 'rebar', 'wire', 'pump', 'concrete', 'concrete_splat', 'vibrator', 'screed', 'till', 'tap', 'waves', 'wind'];
