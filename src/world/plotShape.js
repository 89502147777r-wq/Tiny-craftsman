import { TRAY, BACKDROP } from '../config.js';

// The tray has one rounded corner (where the photo backdrop wraps round it).
// Outline of a rectangle of half sizes hx × hz with that corner rounded to
// radius r, as [x, z] points going round once.
export function roundedOutline(hx, hz, r, seg = 24) {
  const { sx, sz } = BACKDROP;
  const pts = [];
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    if (cx === sx && cz === sz && r > 0) {
      // arc from the edge before the corner to the edge after it
      const ox = cx * (hx - r), oz = cz * (hz - r);
      const start = angleOf(cx, cz, true), end = angleOf(cx, cz, false);
      for (let i = 0; i <= seg; i++) { const a = start + (end - start) * (i / seg); pts.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]); }
    } else pts.push([cx * hx, cz * hz]);
  }
  return pts;
}

// going round the corners in the order (-,-) → (+,-) → (+,+) → (-,+), i.e. along +x first
function angleOf(cx, cz, first) {
  const key = `${cx},${cz}`;
  // [arc start, arc end] angles in the x/z plane (angle measured from +x towards +z)
  const t = { '1,-1': [-Math.PI / 2, 0], '1,1': [0, Math.PI / 2], '-1,1': [Math.PI / 2, Math.PI], '-1,-1': [Math.PI, Math.PI * 1.5] }[key];
  return first ? t[0] : t[1];
}

// inner radius of the rounded corner and its centre (soil side)
export function innerCorner() {
  const { sx, sz, radius } = BACKDROP;
  const r = radius - TRAY.wall;
  return { r, cx: sx * (TRAY.innerX / 2 - r), cz: sz * (TRAY.innerZ / 2 - r), sx, sz };
}

// is a point of the plot inside the tray (not cut off by the rounded corner)?
export function insideTray(x, z, margin = 0) {
  const c = innerCorner();
  const dx = (x - c.cx) * c.sx, dz = (z - c.cz) * c.sz;
  if (dx <= 0 || dz <= 0) return true;
  return Math.hypot(dx, dz) <= c.r - margin;
}
