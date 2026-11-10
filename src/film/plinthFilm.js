import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { look, low } from './director.js';
import { loadPhysics, physicsReady } from '../world/physics.js';

// «A plinth of five courses» — the training film of the owner's first rule of shooting, «нарастание»
// (growth, 2026-11-10): the first brick very close, laid at its real pace (from the corner, as on a site);
// the camera a little further — the wall to the next corner, its bricks laid sped up; further still — the
// first course of the second wall at once, then of the third and the fourth; from another angle the second
// course whole, then the third, the fourth, the fifth. Every process is to be shot so (Director.grow).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const X = 3000, Z = 2500;                       // (the walls' outer faces, mm: a plinth 6 × 5 m)
const L = 250, T = 120, H = 65, J = 10, BED = 12, ROWS = 5;

// the bricks, course by course, wall by wall (front → right → back → left), each wall from its corner on,
// in the order a bricklayer lays them: [course][wall] → records; a wall 250 thick (two stretchers side by
// side), the corners lapped course by course
export function plinthCourses(base) {
  const out = [];
  for (let k = 0; k < ROWS; k++) {
    const y = base + MM(BED + k * (H + J) + H / 2), lap = k % 2, walls = [];
    // [along x?, the outer face, from, to (the way it is laid), inwards]
    const plan = [[true, Z, -X, X, -1], [false, X, Z, -Z, -1], [true, -Z, X, -X, 1], [false, -X, -Z, Z, 1]];
    for (const [ax, face, from, to, inw] of plan) {
      const full = ax ? !lap : !!lap, cut = full ? 0 : 2 * T + J, a0 = Math.min(from, to) + cut, a1 = Math.max(from, to) - cut, list = [];
      for (const [r, half] of [[T / 2, 0], [T + J + T / 2, 1]]) {
        const off = ((k + half) % 2) * (L + J) / 2;
        for (let a = a0 - off; a < a1; a += L + J) {
          const lo = Math.max(a, a0), hi = Math.min(a + L, a1); if (hi - lo < 60) continue;
          const m = (lo + hi) / 2, w = face + inw * r, len = hi - lo;
          list.push({ m, rec: { type: 'unit', kind: 'brick', free: true, face: 'red', p: ax ? [MM(m), y, MM(w)] : [MM(w), y, MM(m)], s: (ax ? [len, H, T] : [T, H, len]).map(MM), q: [0, 0, 0, 1] } });
        }
      }
      list.sort((p, q) => (to > from ? p.m - q.m : q.m - p.m));
      walls.push(list.map((e) => e.rec));
    }
    out.push(walls);
  }
  return out;
}

export function* plinthFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, Tn = app.terrain, sfx = (n, o) => app.sfx?.play?.(n, o);
  Object.assign(app.settings, { dayHour: 10.5 }); app.sky.setHour(10.5);
  app.setTool('wall'); app.wallTool.setMode?.('lay');
  d.lock = true; d.hand = 0.35;
  // the strip under the walls: concrete 300 high, 450 wide, cast and set before the film starts
  const g = Tn.heightAt(0, 0), cells = [];
  for (let i = 0; i < Tn.conc.length; i++) { const x = Math.abs(Tn.toWorldX(i % Tn.nx)), z = Math.abs(Tn.toWorldZ(Math.floor(i / Tn.nx))); if (x < MM(X + 100) && z < MM(Z + 100) && !(x < MM(X - 350) && z < MM(Z - 350))) cells.push(i); }
  { let a = 1e9, b = -1, c = 1e9, e = -1; for (const i of cells) { const add = MM(300) - Tn.conc[i]; if (add > 0) Tn._concAdd(i, add, 1); const ix = i % Tn.nx, iz = Math.floor(i / Tn.nx); a = Math.min(a, ix); b = Math.max(b, ix); c = Math.min(c, iz); e = Math.max(e, iz); } if (b >= 0) Tn._concTouch(a, c, b, e); Tn.updateMesh?.(); }
  app.clock += 600;
  const base = Tn.heightAt(MM(-X + 125), MM(Z - 125)), C = plinthCourses(base), mid = new V(0, base, 0);
  const total = C.flat(2).length;
  // (a piece of work added at once: its bricks, the sound of a few of them)
  const pop = (list) => () => { for (const r of list) O.add(r); app.sfx?.seq?.(['brick', 'brick', 'brick']); };
  // ---- 1 · the first brick, very close, at its real pace — the game's own job (wallTool.layUnit): set down on the
  // mortar, three taps of the mallet, the mortar pressed out of the bed, the trowel cutting it off ----
  const W = app.wallTool, r0 = C[0][0].find((r) => r.s[0] > MM(L - 1)), P = new V(...r0.p);
  const close = look(new V(P.x - MM(420), P.y + MM(380), P.z + MM(820)), P);
  loadPhysics().catch(() => {});
  d.cut(close, { drift: 0.03, push: 0.05, hand: 0.5 });   // (the corner waiting for its brick while the physics comes)
  yield d.until(() => physicsReady());
  let began = false;
  const one = () => { if (!began) { began = W.layUnit(r0); if (began) d.jobs = 1; } return began && !app.busy(); };
  // ---- 2 · the wall to the next corner, sped up: the same work brick after brick — the first three whole (mallet,
  // mortar, trowel) three times as fast, the rest as a course is laid (the bed spread for ten bricks, each set down, one tap, its mortar cut off), ten times ----
  const wallA = C[0][0].filter((r) => r !== r0); let nA = 0;
  let bed = null, bedFrom = 0;
  // (to: how far along the wall this step goes; whole: how many bricks get the whole show; v: the speeds — whole, spreading, laying)
  const row = (to, whole, v) => () => {
    if (!app.physJob && nA < to) {
      const fast = nA >= whole; d.speed = fast ? v[2] : v[0];
      // (as a course is laid: the bed spread with the trowel for the next ten bricks, then each brick onto it)
      if (fast && (!bed || nA >= bedFrom + bed.length)) { bed = W.spreadBed(wallA.slice(nA, Math.min(to, nA + 10))); bedFrom = nA; if (bed) d.spreads = (d.spreads || 0) + 1; d.speed = v[1]; return false; }
      if (W.layUnit(wallA[nA], fast, 12, fast ? bed?.[nA - bedFrom] : null)) { nA++; d.jobs++; }
    }
    if (nA >= to && !app.busy()) { d.speed = 1; return true; }
    return false;
  };
  // ---- 3 · further: the first course of the second wall at once, of the third, of the fourth ----
  // ---- 4 · another angle: the second course whole, the third, the fourth, the fifth ----
  const wide = look(new V(MM(-X - 3600), base + MM(4600), MM(Z + 6200)), mid), other = low(new V(0, base + MM(250), 0), 0.62, MM(9500), MM(1500))   /* (rule 3: nothing hides whole courses coming — low, the horizon and the mountains in frame) */;
  yield* d.grow([
    { n: 1, until: one, hold: 0.6, push: 0.05 },
    // (a little further: the next stretch of the wall — two more bricks whole, then the bed spread for ten and they on it)
    { view: look(new V(MM(-X - 900), base + MM(1050), MM(Z + 1900)), new V(MM(-X + 900), base + MM(40), MM(Z - 125))), n: 12, until: row(12, 2, [4, 2.5, 5]), hold: 0.3 },
    // (further: the wall to the next corner — the same, faster)
    { view: look(new V(MM(-X - 3100), base + MM(3000), MM(Z + 3700)), new V(MM(-X + 2800), base, MM(Z - 125))), n: wallA.length - 12, until: row(wallA.length, 0, [4, 7, 16]), hold: 0.35 },
    { view: wide, n: C[0][1].length, act: pop(C[0][1]), lead: 0.45, hold: 0.45 },
    { n: C[0][2].length, act: pop(C[0][2]), lead: 0, hold: 0.4 },
    { n: C[0][3].length, act: pop(C[0][3]), lead: 0, hold: 0.55 },
    { view: other, turn: true, n: C[1].flat().length, act: pop(C[1].flat()), lead: 0.4, hold: 0.45 },
    { n: C[2].flat().length, act: pop(C[2].flat()), lead: 0, hold: 0.4 },
    { n: C[3].flat().length, act: pop(C[3].flat()), lead: 0, hold: 0.35 },
    { n: C[4].flat().length, act: pop(C[4].flat()), lead: 0, hold: 0.6 },
  ]);
  d.laid = { total, done: O.all('unit').length };
  // ---- the result, round it (the hook: put first by the recorder) ----
  d.lock = false;
  d.mark('hook');
  d.reveal(new V(0, base + MM(200), 0), MM(9000), 3.2, { yaw0: other.yaw, arc: 1.4, y0: MM(1300), y1: MM(2600) });
  d.count('BRICKS', total, '', 1.0);
  yield d.sec(3.2);
  d.mark('hookEnd');
  yield d.sec(0.1);
}
plinthFilm.seconds = 20;
plinthFilm.place = 'alps';   // (rule 3: a place worth looking at behind the work)
