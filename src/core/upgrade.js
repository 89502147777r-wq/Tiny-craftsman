import { fromV1 } from '../world/fence2.js';

// Records of an older kind read as today's, on their way into the store (a project loaded, a step undone
// or redone from an old journal, a record added): what draws and works on them knows only today's kind.
//   fence without v: 2 (put up all at once, before BUILD 245) → the fence by the post (fence2.js)
export function upgrade(r) {
  if (r?.type === 'fence' && r.v !== 2) return fromV1(r);
  return r;
}
