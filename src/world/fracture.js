import * as THREE from 'three';

// Masonry breaking as it does (the owner: «hundreds of pieces — a block splits into bits from a tenth of a block
// to twenty blocks, not along the joints: 0,23 of a block, 6,76 blocks»): the walls' units, wherever they are,
// cut by a power diagram (a Voronoi with weights: pieces of every size, smaller by the blow) in 3D — each unit's
// box clipped by every cell it lies in. A piece: all the bits of units in one cell — their faces with the units'
// own texture (as laid: a joint where a joint is), the new faces where they broke with the inside of the material
// (aerated concrete: grey, porous; brick: its fired red, specks), one convex hull for its body.
const rnd = (() => { let s = 424243; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// the broken insides: drawn once
const INS = {};
function inside(kind) {
  if (INS[kind]) return INS[kind];
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  if (kind === 'brick') {
    g.fillStyle = '#b4573a'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) { const v = rnd(); g.fillStyle = v < 0.5 ? `rgba(120,46,28,${0.3 + rnd() * 0.4})` : v < 0.8 ? `rgba(215,140,100,${0.3 + rnd() * 0.4})` : 'rgba(60,40,30,0.5)'; g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2); }
  } else {
    g.fillStyle = '#c9c7c0'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1400; i++) { const r = 0.5 + rnd() * 2; g.fillStyle = `rgba(${90 + rnd() * 40},${90 + rnd() * 40},${88 + rnd() * 40},${0.35 + rnd() * 0.4})`; g.beginPath(); g.arc(rnd() * n, rnd() * n, r, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return (INS[kind] = new THREE.MeshStandardMaterial({ map: t, roughness: 1, color: kind === 'brick' ? 0xffffff : 0xf2f0ea }));
}

// a unit's box faces (its own frame, −0.5 … 0.5): for each axis face, its 4 corners' uv from the instanced geometry
function faceUV(geo) {
  if (geo.userData._faceUV) return geo.userData._faceUV;
  const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, out = {};
  for (let i = 0; i < P.count; i++) {
    const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i), ax = Math.abs(nx) > 0.9 ? 0 : Math.abs(ny) > 0.9 ? 1 : 2, sg = [nx, ny, nz][ax] > 0 ? 1 : -1, k = ax * 2 + (sg > 0 ? 0 : 1);
    (out[k] ||= []).push({ p: [P.getX(i), P.getY(i), P.getZ(i)], uv: U ? [U.getX(i), U.getY(i)] : [0, 0] });
  }
  return (geo.userData._faceUV = out);
}
// uv at a point on face k (bilinear over its corners)
function uvAt(F, k, p) {
  const ax = k >> 1, a = (ax + 1) % 3, b = (ax + 2) % 3, cs = F[k]; if (!cs || cs.length < 4) return [0, 0];
  const pick = (sa, sb) => cs.reduce((best, c) => { const d = (c.p[a] * sa > 0 ? 0 : 1) + (c.p[b] * sb > 0 ? 0 : 1); return d < best.d ? { d, c } : best; }, { d: 9 }).c;
  const c00 = pick(-1, -1), c10 = pick(1, -1), c01 = pick(-1, 1), c11 = pick(1, 1), u = p[a] + 0.5, v = p[b] + 0.5;
  return [0, 1].map((j) => (c00.uv[j] * (1 - u) + c10.uv[j] * u) * (1 - v) + (c01.uv[j] * (1 - u) + c11.uv[j] * u) * v);
}
// a convex polytope (faces of points; face.k: the box face it is a part of, or -1 for a break) clipped by n·x ≤ d
function clip(faces, n, d) {
  const out = [], cap = [], f = (p) => p[0] * n[0] + p[1] * n[1] + p[2] * n[2] - d;
  for (const F of faces) {
    const P = F.pts, res = [];
    for (let i = 0; i < P.length; i++) {
      const A = P[i], B = P[(i + 1) % P.length], fa = f(A), fb = f(B);
      if (fa <= 0) res.push(A);
      if ((fa <= 0) !== (fb <= 0)) { const u = fa / (fa - fb), X = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u]; res.push(X); cap.push(X); }
    }
    if (res.length >= 3) out.push({ pts: res, k: F.k });
  }
  if (cap.length >= 3) {
    // (the cut face: its points in order round their middle, on the plane)
    const m = cap.reduce((a, p) => [a[0] + p[0] / cap.length, a[1] + p[1] / cap.length, a[2] + p[2] / cap.length], [0, 0, 0]);
    const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], e1 = norm(cross(n, t)), e2 = cross(n, e1);
    const uniq = []; for (const p of cap) if (!uniq.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-7)) uniq.push(p);
    uniq.sort((p, q) => Math.atan2(dot(sub(p, m), e2), dot(sub(p, m), e1)) - Math.atan2(dot(sub(q, m), e2), dot(sub(q, m), e1)));
    if (uniq.length >= 3) out.push({ pts: uniq, k: -1 });
  }
  return out;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const BOX = () => {
  const c = (x, y, z) => [x * 0.5, y * 0.5, z * 0.5];
  return [
    { k: 0, pts: [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)] }, { k: 1, pts: [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)] },
    { k: 2, pts: [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)] }, { k: 3, pts: [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)] },
    { k: 4, pts: [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)] }, { k: 5, pts: [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)] },
  ];
};

// units: [{ m (world matrix now), cl (its instanced mesh), kind ('block' | 'brick' …), dens }]; hit: where it struck
// (world); unitVol: a typical unit's volume (world units³). → pieces: { mesh (world placed geometry, its middle at
// the origin of `c`), c (Vector3), hull ([x, y, z] world), vol (in units), dens }
export function fracture(units, hit, opt = {}) {
  if (!units.length) return [];
  const centres = units.map((u) => new THREE.Vector3().setFromMatrixPosition(u.m));
  const vols = units.map((u) => { const s = new THREE.Vector3().setFromMatrixScale(u.m); return s.x * s.y * s.z; }), uv = vols.reduce((a, v) => a + v, 0) / vols.length;
  const unitL = Math.cbrt(uv), max = opt.max || 600;
  // seeds: sizes log-uniform 0.1 … 20 units (smaller by the blow), as many as fills the volume, at most `max`
  const total = vols.reduce((a, v) => a + v, 0), seeds = [];
  let filled = 0;
  const want = Math.max(150, Math.min(max, Math.round(units.length * 2.4)));   // (hundreds: about two pieces a unit, sizes by their weights)
  while (seeds.length < want) {
    const j = Math.floor(rnd() * units.length), c = centres[j], near = Math.min(1, c.distanceTo(hit) / (unitL * 14));
    // (most pieces small and middling — a tenth of a unit to three; one in twelve a big slab of wall, three to twenty;
    // by the blow nothing big)
    const big = near > 0.4 && rnd() < 0.08, lo = Math.log(big ? 3 : 0.1), hi = Math.log(big ? 20 : near < 0.4 ? 1.5 : 3), v = Math.exp(lo + (hi - lo) * rnd()) * uv;
    const s = new THREE.Vector3().setFromMatrixScale(units[j].m);
    seeds.push({ p: c.clone().add(new THREE.Vector3((rnd() - 0.5) * s.x, (rnd() - 0.5) * s.y, (rnd() - 0.5) * s.z).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(units[j].m))), w: Math.pow(v, 2 / 3) * (big ? 1.1 : 0.3), v });
    filled += v; void total;
  }
  // each cell: its planes against its nearest seeds (power distance)
  const K = 16;
  const planes = seeds.map((si) => {
    const nb = seeds.filter((sj) => sj !== si).map((sj) => ({ sj, d: si.p.distanceToSquared(sj.p) - sj.w })).sort((a, b) => a.d - b.d).slice(0, K);
    return nb.map(({ sj }) => { const n = sj.p.clone().sub(si.p), d = (sj.p.lengthSq() - si.p.lengthSq() - sj.w + si.w) / 2; return { n, d }; });
  });
  const reach = seeds.map((s) => Math.sqrt(s.w) * 2.2 + unitL * 1.5);
  const pieces = new Map();
  const Mi = new THREE.Matrix4(), nl = new THREE.Vector3(), t = new THREE.Vector3(), lin = new THREE.Matrix3();
  units.forEach((u, ui) => {
    const F = faceUV(u.cl.geometry), c = centres[ui], diag = Math.cbrt(vols[ui]) * 1.2;
    t.setFromMatrixPosition(u.m); lin.setFromMatrix4(u.m).transpose();
    seeds.forEach((sd, si) => {
      if (sd.p.distanceTo(c) > reach[si] + diag) return;
      let poly = BOX();
      for (const pl of planes[si]) {
        // (the plane in the unit's frame: (Mᵀn)·x ≤ d − n·t)
        nl.copy(pl.n).applyMatrix3(lin); poly = clip(poly, [nl.x, nl.y, nl.z], pl.d - pl.n.dot(t)); if (!poly.length) return;
      }
      if (!poly.length) return;
      let P = pieces.get(si); if (!P) pieces.set(si, (P = { tri: { face: new Map(), brk: new Map() }, pts: [], vol: 0, dens: u.dens, kinds: new Set() }));
      P.kinds.add(u.kind);
      const keyF = u.cl.uuid, keyB = u.kind === 'brick' ? 'brick' : 'block';
      const fa = P.tri.face.get(keyF) || { cl: u.cl, pos: [], uv: [] }, br = P.tri.brk.get(keyB) || { pos: [], uv: [] };
      P.tri.face.set(keyF, fa); P.tri.brk.set(keyB, br);
      const W = (p) => new THREE.Vector3(...p).applyMatrix4(u.m);
      let vol = 0; const pc = poly[0].pts[0];
      for (const f of poly) {
        const w = f.pts.map(W);
        for (let i = 1; i + 1 < f.pts.length; i++) {
          const tr = [0, i, i + 1], dst = f.k >= 0 ? fa : br;
          for (const q of tr) { dst.pos.push(w[q].x, w[q].y, w[q].z); if (f.k >= 0) dst.uv.push(...uvAt(F, f.k, f.pts[q])); else { const g = w[q]; dst.uv.push((g.x + g.z) * 6, g.y * 6); } }
          vol += Math.abs(dot(sub(f.pts[0], pc), cross(sub(f.pts[i], pc), sub(f.pts[i + 1], pc)))) / 6;
        }
        for (const p of w) P.pts.push(p);
      }
      P.vol += vol * vols[ui] / uv;
    });
  });
  // the pieces' meshes: around their middles
  const out = [];
  for (const P of pieces.values()) {
    if (P.pts.length < 4) continue;
    const c = P.pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / P.pts.length), g = new THREE.Group();
    for (const fa of P.tri.face.values()) if (fa.pos.length) g.add(mesh(fa.pos, fa.uv, c, fa.cl.material));
    for (const [k, br] of P.tri.brk) if (br.pos.length) g.add(mesh(br.pos, br.uv, c, inside(k)));
    g.position.copy(c); g.matrixAutoUpdate = false; g.updateMatrix();
    out.push({ g, c, hull: P.pts.map((p) => [p.x, p.y, p.z]), vol: P.vol, dens: P.dens });
  }
  return out;
}
function mesh(pos, uv, c, mat) {
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= c.x; pos[i + 1] -= c.y; pos[i + 2] -= c.z; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}
