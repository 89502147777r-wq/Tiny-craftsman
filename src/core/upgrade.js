import { fromV1 } from '../world/fence2.js';
import { pathFromV1 } from '../world/garden.js';

// Records of an older kind read as today's, on their way into the store (a project loaded, a step undone
// or redone from an old journal, a record added): what draws and works on them knows only today's kind.
//   fence without v: 2 (put up all at once, before BUILD 245) → the fence by the post (fence2.js)
//   path without v: 2 (a stage at a touch, before BUILD 253) → the path laid by hand (garden.js)
//   lawn without v: 2 (before BUILD 254) → the lawn by hand: the same stages (its topsoil, drawn then as a
//   layer of its own, is the ground's own now — under the grass it is not seen)
export function upgrade(r) {
  if (!r || r.v === 2) return r;
  if (r.type === 'fence') return fromV1(r);
  if (r.type === 'path') return pathFromV1(r);
  if (r.type === 'lawn' && Array.isArray(r.poly)) return { ...r, v: 2 };
  return r;
}
