import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { FitJob } from './fitJob.js';
import { gradeY } from '../world/outlines.js';

// A marked pit dug by itself («Разметка» → a pit chosen → «Выкопать»; the films' foundations): the pool's way of digging
// (poolTool._dig) for any marked rectangle — layer by layer, bite after bite, each a rounded hollow going down over its
// own short time, back and forth over the pit, the soil thrown out; the walls cut straight and the bottom trimmed level
// at the end. The soil is taken away (said in the toast, as the pool's). → true if the job began
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export function digPit(app, o, done = null) {
  const t = app.terrain;
  if (!o || o.kind !== 'rect' || app.physJob) return false;
  const y = gradeY(o), x0 = Math.min(o.x0, o.x1), x1 = Math.max(o.x0, o.x1), z0 = Math.min(o.z0, o.z1), z1 = Math.max(o.z0, o.z1);
  const g = t.heightAt((x0 + x1) / 2, (z0 + z1) / 2), deep = (g - y) / S;   // (mm, real)
  if (deep < 40) { app.ui?.toast('Котлован уже выкопан до отметки'); return false; }
  const inPit = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && !(t.conc[t.index(x, z)] > 1e-6);
  const layers = Math.max(1, Math.ceil(deep / 650)), R = Math.min(1250, Math.max(500, deep * 1.6)), SP = R * 1.08, rr = Math.random, before = t.totalVolume();
  const ns = Math.max(1, Math.ceil((x1 - x0) / MM(SP))), nt = Math.max(1, Math.ceil((z1 - z0) / MM(SP))), bites = [];
  for (let L = 0; L < layers; L++) {
    const yT = g - (g - y) * L / layers, yL = g - (g - y) * (L + 1) / layers - MM(L === layers - 1 ? 0 : 60);
    for (let j = 0; j <= nt; j++) for (let i0 = 0; i0 <= ns; i0++) {
      const i = (j + L) % 2 ? ns - i0 : i0;
      const bx = x0 + (x1 - x0) * i / ns + (rr() - 0.5) * MM(SP) * 0.8, bz = z0 + (z1 - z0) * j / nt + (rr() - 0.5) * MM(SP) * 0.8;
      bites.push({ x: Math.max(x0, Math.min(x1, bx)), z: Math.max(z0, Math.min(z1, bz)), R: MM(R * (0.8 + rr() * 0.45)), deep: yL - MM(rr() * 60), yT, seed: rr() * 6.28, p: 0 });
    }
  }
  const step = 0.045, life = 0.3, T = bites.length * step + life, sh = app.shovel, vis = sh?.root.visible, long = x1 - x0 >= z1 - z0;
  app.journal.begin('pit-dig', { id: o.id }, app.clock);
  const steps = [[0, () => { if (sh) sh.root.visible = false; }], [T, (u) => {
    const now = u * T;
    for (let k = 0; k < bites.length; k++) {
      const b = bites[k], p = Math.max(0, Math.min(1, (now - k * step) / life));
      if (p <= b.p) continue;
      b.p = p;
      t.scoop(b.x, b.z, b.R, b.yT + (b.deep - b.yT) * p * p * (3 - 2 * p), b.yT, inPit, b.seed);
      if (p < 1 && rr() < 0.5) { const s = rr() < 0.5 ? 1 : -1; app.particles?.emit(new THREE.Vector3(b.x + (rr() - 0.5) * b.R, b.yT, b.z + (rr() - 0.5) * b.R), new THREE.Vector3(long ? 0 : s * (0.08 + rr() * 0.06), 0.2 + rr() * 0.15, long ? s * (0.08 + rr() * 0.06) : 0), 0, MM(30 + rr() * 30), 0, 0, 0); }
    }
    if (rr() < 0.15) app.sfx?.play?.('shovel_dig');
  }], [0, () => { if (sh) sh.root.visible = vis; }], [0.1, (u) => { if (u >= 1) t.levelTo(inPit, y, [x0, z0, x1, z1]); }]];
  new FitJob(app, { steps, parts: [], onAbort: () => app.journal.cancel(), commit: () => {
    app.journal.commit(app.clock);
    const out = Math.max(0, before - t.totalVolume()) * MODEL_SCALE ** 3, w = (x1 - x0) * MODEL_SCALE, h = (z1 - z0) * MODEL_SCALE;
    app.ui?.toast(`Котлован ${w.toFixed(1)} × ${h.toFixed(1)} м, глубина ${(deep / 1000).toFixed(2)} м — вынуто ${out.toFixed(1)} м³ (вывезено самосвалом)`);
    done?.(out);
  } });
  return true;
}
