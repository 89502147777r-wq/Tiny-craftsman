import * as THREE from 'three';
import { MODEL_SCALE, M_G20, M_SAND } from '../config.js';
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

// The bed of a dug pit by itself (the pool's way, poolTool._bed, for any marked rectangle): the material tipped in heaps,
// spread level to `thick` mm, rammed with the plate lane after lane. mat: 'g20' | 'sand'. → true if the job began
export function bedPit(app, o, thick = 200, mat = 'g20', done = null) {
  const t = app.terrain;
  if (!o || o.kind !== 'rect' || app.physJob) return false;
  const x0 = Math.min(o.x0, o.x1), x1 = Math.max(o.x0, o.x1), z0 = Math.min(o.z0, o.z1), z1 = Math.max(o.z0, o.z1), M = mat === 'sand' ? M_SAND : M_G20;
  const inPit = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const ix0 = Math.max(0, Math.floor(t.toCellX(x0))), ix1 = Math.min(t.rx, Math.ceil(t.toCellX(x1))), iz0 = Math.max(0, Math.floor(t.toCellZ(z0))), iz1 = Math.min(t.rz, Math.ceil(t.toCellZ(z1)));
  const cells = []; for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const x = t.toWorldX(ix), z = t.toWorldZ(iz); if (inPit(x, z) && !(t.conc[iz * t.nx + ix] > 1e-6)) cells.push([iz * t.nx + ix, x, z]); }
  if (!cells.length) return false;
  { const m = MM(400); app.particles?.clearIn?.(x0 - m, z0 - m, x1 + m, z1 + m); }   // (the bottom and its edge cleaned before the bed)
  const base = cells.map((c) => t.nat[c[0]]).sort((a, b) => a - b)[cells.length >> 1], want = MM(thick), yTop = base + want;
  const long = x1 - x0 >= z1 - z0, A0 = long ? x0 : z0, A1 = long ? x1 : z1, C0 = long ? z0 : x0, C1 = long ? z1 : x1, W = (p, c) => (long ? [p, c] : [c, p]);
  const area = (x1 - x0) * (z1 - z0), vol = area * want, heaps = [], steps = [];
  // (the heaps: barrowfuls — none wider than the pit, so nothing runs over its edge into a neighbour's; the realist)
  const tanA = Math.tan((mat === 'sand' ? 33 : 39) * Math.PI / 180), rH = Math.min(MM(900), 0.4 * (C1 - C0)), vH = Math.PI * rH ** 3 * tanA / 3, nH = Math.max(2, Math.min(80, Math.ceil(vol / vH)));
  const nC = Math.max(1, Math.min(Math.floor((C1 - C0) / (2.2 * rH)), Math.ceil(Math.sqrt(nH * (C1 - C0) / (A1 - A0))))), nA = Math.ceil(nH / nC), tH = Math.max(0.05, Math.min(0.4, 3.2 / nH));
  app.journal.begin('pit-bed', { id: o.id }, app.clock);
  for (let h = 0; h < nH; h++) {
    const [hx, hz] = W(A0 + (A1 - A0) * (Math.floor(h / nC) + 0.5) / nA, C0 + (C1 - C0) * (h % nC + 0.5) / nC);
    steps.push([tH, (u) => {
      if (!heaps[h]) heaps[h] = t.heapStart(hx, hz, vol / nH, tanA);
      t.heapTo(heaps[h], vol / nH * u, M);
      if (u < 1 && Math.random() < 0.25) app.sfx?.pour?.(0.4, mat === 'sand' ? 'sand_pour' : 'gravel_pour');
    }]);
  }
  // (spread: a front going along the pit — behind it the layer lies level)
  steps.push([Math.max(0.6, (A1 - A0) / MM(1000) * 0.12), (u) => {
    const f = A0 + (A1 - A0) * u;
    for (const [i, x, z] of cells) if ((long ? x : z) <= f) { const h = t.loose[i], w = Math.max(0, yTop - t.nat[i]); if (Math.abs(h - w) > 1e-7) { if (h > w) t._pop(i, h - w); else t._push(i, w - h, M); } }   // (level at its top: the hollows the digging left under it are filled — the slab over it is as thick everywhere)
    t._touch(ix0, iz0, ix1, iz1);
    if (Math.random() < 0.2) app.sfx?.play?.('rake', { vol: 0.4 });
  }]);
  // (the plate: lane after lane on a serpentine; rammed where it has passed)
  { const lanes = Math.max(1, Math.round((C1 - C0) / MM(700))), pts = [], m = MM(250);
    for (let k = 0; k < lanes; k++) { const c = C0 + (C1 - C0) * (k + 0.5) / lanes; if (k % 2) pts.push(W(A1 - m, c), W(A0 + m, c)); else pts.push(W(A0 + m, c), W(A1 - m, c)); }
    const seg = []; let total = 0; for (let k = 1; k < pts.length; k++) { const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push([total, l]); total += l; }
    const wide = MM(450), G = app.concreteGear;
    steps.push([Math.max(0.8, total / MM(1000) * 0.1), (u) => {
      const s = u * total; let k = seg.findIndex(([a, l]) => s <= a + l); if (k < 0) k = seg.length - 1;
      const [a, l] = seg[k], f = l > 0 ? Math.min(1, (s - a) / l) : 0, x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f;
      app.sfx?.engine?.('compactor', u < 1 ? 0.7 : 0);
      G.plateOn = true; G.set('plate', new THREE.Vector3(x, yTop, z), Math.atan2(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]), u === 0);
      for (const [i, cx, cz] of cells) if (Math.hypot(cx - x, cz - z) < wide) t.comp[i] = 1;
      t._touch(ix0, iz0, ix1, iz1);
      if (u >= 1) { for (const [i] of cells) t.comp[i] = 1; G.plateOn = false; G.set(null); }
    }]);
  }
  new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); app.concreteGear.set(null); app.sfx?.engine?.('compactor', 0); }, commit: () => {
    app.journal.commit(app.clock);
    app.ui?.toast(`${mat === 'sand' ? 'Песок' : 'Щебень 20–40'} слоем ${thick} мм утрамбован виброплитой — ${(vol * MODEL_SCALE ** 3).toFixed(1)} м³`);
    done?.();
  } });
  return true;
}
