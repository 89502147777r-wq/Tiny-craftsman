// The site's yard: what stands on the ground beside the work (stacks of boards, the curing film's roll and its weights, the machines,
// the site's things) and where a new stack may go — on bare ground, off the concrete and the pits, clear of everything already there.
// The owner, 2026-11-18: the curing film's roll lay through a stack of boards and the excavator's bucket stood in it — each stack had
// been put at its own point, none looked at its neighbours. Each thing is a disc (x, z, r — model units): a stack's half diagonal, a
// machine with its boom's reach.
import { MODEL_SCALE } from '../config.js';
import { PROPS } from './siteProps.js';

const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
// a stack's own size (mm): the edge / ring beam boards 3 m long, six 150 a layer — with the curing film's roll and weights beside it
export const YARD = { boards: 1700, boardsCure: 2200, formpile: 2100, machine: 4600, gap: 300 };

// every thing on the ground now: [{ x, z, r, what, id }]
export function occupied(app, skip = null) {
  const O = app.objects, out = [];
  for (const r of O.all('siteprop')) out.push({ x: r.x, z: r.z, r: MM((PROPS[r.kind]?.r ?? 1000) + 150), what: 'prop:' + r.kind, id: r.id });
  for (const r of O.all('vehicle')) out.push({ x: r.x, z: r.z, r: MM(YARD.machine), what: 'machine:' + r.kind, id: r.id });   // (the boom's reach, parked)
  for (const r of O.all('formpile')) out.push({ x: r.x, z: r.z, r: MM(YARD.formpile), what: 'formpile', id: r.id });
  for (const b of O.all('belt')) {
    if (b.id === skip) continue;
    if (b.kind === 'slab' && b.sidesPile && (b.sidesOff || b.stripAt != null || b.stripped)) out.push({ x: b.sidesPile[0], z: b.sidesPile[1], r: MM(b.cureOff > 0 ? YARD.boardsCure : YARD.boards), what: 'sides', id: b.id });
    else if (b.kind !== 'slab' && b.stripped && Array.isArray(b.pile)) out.push({ x: b.pile[0], z: b.pile[1], r: MM(YARD.boards), what: 'pile', id: b.id });
  }
  return out;
}
// any two things on the ground that run into each other (for the tests)
export function clashes(app) {
  const L = occupied(app), bad = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const p = L[i], q = L[j]; if (p.what.startsWith('machine') && q.what.startsWith('machine')) continue;
    if (!/^(sides|pile)$/.test(p.what) && !/^(sides|pile)$/.test(q.what)) continue;   // (the stacks of a slab / a belt against all; what stood before them is checked by its own film)
    const d = Math.hypot(p.x - q.x, p.z - q.z), need = p.r + q.r;
    if (d < need) bad.push(`${p.what} ↔ ${q.what}: ${Math.round(d / S)} mm apart, ${Math.round(need / S)} needed`);
  }
  return bad;
}
// a place for a stack of radius rMm, as near `near` [x, z] as can be: bare ground at the site's level (no concrete, no pit), inside the
// plot, clear of everything on the ground (skip — the record the stack belongs to, its old place not counted)
// ok(x, z): a film's own limit (out of its frames)
export function freeSpot(app, near, rMm, skip = null, ok = null) {
  const T = app.terrain, r = MM(rMm), things = occupied(app, skip), g0 = T.heightAt(near[0], near[1]);
  const okAt = (x, z) => {
    if (ok && !ok(x, z)) return false;
    if (things.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + MM(YARD.gap))) return false;
    for (const [a, c] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      const px = x + a * r, pz = z + c * r; if (!T.inside(px, pz)) return false;
      if (T.conc?.[T.index(px, pz)] > 1e-6) return false;
      if (Math.abs(T.heightAt(px, pz) - g0) > MM(150)) return false;   // (no pit, no heap)
    }
    return true;
  };
  for (let d = 0; d <= MM(12000); d += MM(500)) for (let k = 0, n = d ? Math.max(8, Math.round(2 * Math.PI * d / MM(800))) : 1; k < n; k++) {
    const a = k / n * 2 * Math.PI, x = near[0] + Math.cos(a) * d, z = near[1] + Math.sin(a) * d;
    if (okAt(x, z)) return [+x.toFixed(5), +z.toFixed(5)];
  }
  return near.slice();
}
