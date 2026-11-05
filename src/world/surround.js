import * as THREE from 'three';
import { TRAY, MODEL_SCALE } from '../config.js';
import { loadModel } from './machines/models.js';

// What is round the plot in the 360° places: not a flat disc fading into the photo (the owner: «the plot stands out,
// the smeared edges») but the place itself in 3D, as a real building site in a street is seen — the site fenced
// (temporary mesh panels on their feet, a gate for the lorries), outside it the grass verge, a pavement of concrete
// slabs, a kerb and the street (asphalt, a dashed white line), and round it all a ring of trees: the edge of the 3D
// ground and the photo's own ground are behind them, the photo seen only over them (sky, far trees, buildings).
// The trees far off are impostors: each model drawn once into a picture, stood up as a card that turns to the
// camera — a ring of 3D trees (18–75 k triangles each) would be a few million triangles on a phone.
const M = (m) => m / MODEL_SCALE;   // (metres → the plot's units)
// the look of each place's surroundings: a street in front (+z) or not, the trees round it
export const SURROUND = {
  site: { street: true, trees: ['tree', 'tree3', 'pine'], lawn: 'lawn' },
  meadow: { street: true, trees: ['tree', 'tree3', 'fir'], lawn: 'lawn' },
  alps: { street: false, trees: ['fir', 'pine', 'tree'], lawn: 'lawn' },
  forest: { street: false, trees: ['fir', 'pine', 'tree3'], lawn: null },
  lake: { street: false, trees: ['tree', 'tree3', 'pine'], lawn: 'lawn' },
  beach: { street: false, trees: [], lawn: null },
};
const ROAD = { verge: 1.6, walk: 2.0, kerb: 0.18, road: 7.0 };   // (m, out from the fence: grass, pavement, kerb, the carriageway)

export class Surround {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'surround'; this.group.visible = false;
    app.scene.add(this.group);
    this.built = null; this.imp = {};
  }
  // shown for a place (its key) or hidden; R — the panorama's radius (plot units)
  async set(key, R, tex) {
    const cfg = SURROUND[key];
    if (!cfg) { this.hide(); return; }
    if (!cfg.street) this.app.backdrop?.gU?.uRoad?.value.set(1e5, 1e5);
    if (this.built !== key) {
      this._clear();
      this.built = key; this.road = null;
      this._fence();
      if (cfg.street) this._street(R, tex);
      await this._trees(cfg, R, cfg.street);
      if (this.built !== key) return;
    }
    this.group.visible = true;
    // (the place's grass not drawn over the kerbs and the carriageway: they lie lower)
    this.app.backdrop?.gU?.uRoad?.value.set(...(cfg.street && this.road ? this.road : [1e5, 1e5]));
  }
  hide() { this.group.visible = false; this.app.backdrop?.gU?.uRoad?.value.set(1e5, 1e5); }
  _clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((q) => { if (q.isMesh) q.geometry?.dispose(); }); }
  }

  // ---- the fence: temporary mesh panels 3,5 × 2 m (galvanised tube frame, wire mesh 100 × 250), on concrete-filled
  // plastic feet, clamped; round the plot a little out from its edge, the gate (two panels open) on the street side
  _fence() {
    const hx = TRAY.innerX / 2 + M(0.35), hz = TRAY.innerZ / 2 + M(0.35), y0 = TRAY.soil, W = 3.5, H = 2.0;
    const runs = [[[-hx, hz], [hx, hz]], [[hx, hz], [hx, -hz]], [[hx, -hz], [-hx, -hz]], [[-hx, -hz], [-hx, hz]]];
    const tubes = [], feet = [], meshQ = [];
    for (const [k, [a, b]] of runs.entries()) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / M(W)), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      for (let i = 0; i < n; i++) {
        const s0 = i * L / n, s1 = (i + 1) * L / n, mid = (s0 + s1) / 2;
        // (the gate: the middle two panels of the street side swung open along the fence)
        const gate = k === 0 && Math.abs(mid - L / 2) < L / n;
        const p0 = [a[0] + ux * s0, a[1] + uz * s0], p1 = [a[0] + ux * s1, a[1] + uz * s1];
        let q0 = p0, q1 = p1;
        if (gate) { const piv = mid < L / 2 ? p0 : p1; q0 = piv; q1 = [piv[0], piv[1] - (s1 - s0) * 0.97]; }   // (swung in, into the site: out they would close the pavement)
        meshQ.push([q0, q1]);
        const dx = q1[0] - q0[0], dz = q1[1] - q0[1];
        for (const p of [q0, q1]) { tubes.push([p, y0 + M(0.12), y0 + M(H + 0.12), M(0.02)]); if (!feet.some((f) => Math.hypot(f[0][0] - p[0], f[0][1] - p[1]) < M(0.05))) feet.push([p, Math.atan2(-dz, dx)]); }
        tubes.push([q0, q1, y0 + M(H + 0.1), M(0.016)], [q0, q1, y0 + M(0.16), M(0.016)]);
      }
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.45, metalness: 0.75 });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6), m4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const T = new THREE.InstancedMesh(cyl, steel, tubes.length);
    tubes.forEach((t, i) => {
      if (t.length === 4 && typeof t[1] === 'number') { const [p, ya, yb, r] = t; T.setMatrixAt(i, m4.compose(P.set(p[0], (ya + yb) / 2, p[1]), Q.identity(), Sv.set(r, yb - ya, r))); }
      else { const [p, q, y, r] = t, d = new THREE.Vector3(q[0] - p[0], 0, q[1] - p[1]), L = d.length(); Q.setFromUnitVectors(Y, d.normalize()); T.setMatrixAt(i, m4.compose(P.set((p[0] + q[0]) / 2, y, (p[1] + q[1]) / 2), Q, Sv.set(r, L, r))); }
    });
    // (the feet: blocks of recycled rubber 650 × 220 × 130, the long side across the fence, one at each joint)
    const foot = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.92 }), feet.length);
    feet.forEach(([p, yaw], i) => foot.setMatrixAt(i, m4.compose(P.set(p[0], y0 + M(0.065), p[1]), Q.setFromAxisAngle(Y, yaw), Sv.set(M(0.22), M(0.13), M(0.65)))));
    // (the mesh: one quad a panel, the wires drawn into a texture, cut out)
    const pos = [], uv = [], idx = [];
    for (const [p, q] of meshQ) {
      const o = pos.length / 3, L = Math.hypot(q[0] - p[0], q[1] - p[1]) / M(1), ya = y0 + M(0.16), yb = y0 + M(H + 0.1);
      pos.push(p[0], ya, p[1], q[0], ya, q[1], q[0], yb, q[1], p[0], yb, p[1]);
      uv.push(0, 0, L / 0.1, 0, L / 0.1, (H - 0.06) / 0.25, 0, (H - 0.06) / 0.25);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // (galvanised wire Ø4 a cell 100 × 250 — 93 % open: far off a faint grey veil, the ground seen through it; blended, its
    // smaller copies averaging the wire away — cut out with a threshold it closed into a brown mat)
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: wireTex(), color: 0x9a9ea2, roughness: 0.55, metalness: 0.25, envMapIntensity: 0.3, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    for (const o of [T, foot, mesh]) { o.castShadow = true; o.receiveShadow = true; this.group.add(o); }
  }

  // ---- the street in front (+z): the grass verge (the ground's own), the pavement, the kerb, the carriageway
  _street(R, tex) {
    // (the levels: the carriageway lowest, 120 under the kerbs' tops; the pavements flush with the kerbs, the grass flush
    // with the pavements behind a garden edging; at the gate the site's entrance — crushed stone 4,5 m wide over the
    // verge and the pavement, the kerb dropped, the ruts going on, a muddy trail of the wheels on the asphalt)
    const hz = TRAY.innerZ / 2 + M(0.35), y0 = TRAY.soil, X = R * 0.92, G = M(2.25), up = M(0.12), yRoad = y0 - up;
    const z0 = hz + M(ROAD.verge), z1 = z0 + M(ROAD.walk), z2 = z1 + M(ROAD.kerb), z3 = z2 + M(ROAD.road), z4 = z3 + M(ROAD.kerb), z5 = z4 + M(ROAD.walk);
    const plane = (xa, xb, za, zb, y, t, tile, col, o = {}) => {
      const g = new THREE.PlaneGeometry(xb - xa, zb - za, 1, 1); g.rotateX(-Math.PI / 2); g.translate((xa + xb) / 2, y, (za + zb) / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (xa + uv.getX(i) * (xb - xa)) / M(tile), (za + uv.getY(i) * (zb - za)) / M(tile));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t?.diff || null, normalMap: t?.nor || null, color: col, roughness: 0.95, ...o }));
      // (the pavement's slabs grey concrete — the photo's are warm brown, read as boards)
      if (t && t === tex.walk) m.material.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, 0.18);'); };
      m.receiveShadow = true; this.group.add(m); return m;
    };
    const box = (xa, xb, za, zb, ya, yb, mat) => { const k = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, yb - ya, zb - za), mat); k.position.set((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2); k.castShadow = k.receiveShadow = true; this.group.add(k); return k; };
    const walk = tex.walk, asph = tex.asphalt, grey = 0xc4c6c8;
    // the pavements (the near one broken by the entrance), the asphalt
    plane(-X, -G, z0, z1, y0 + M(0.01), walk, 1.8, grey); plane(G, X, z0, z1, y0 + M(0.01), walk, 1.8, grey);
    plane(-X, X, z4, z5, y0 + M(0.01), walk, 1.8, grey);
    plane(-X, X, z2, z3, yRoad, asph, 3.0, 0xd8d8d8);
    // the kerbs 150 × 300 down to the road's base, the near one dropped to 30 over the road at the entrance
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85 });
    box(-X, -G, z1, z2, yRoad - M(0.18), y0 + M(0.01), kerbMat); box(G, X, z1, z2, yRoad - M(0.18), y0 + M(0.01), kerbMat);
    box(-G, G, z1, z2, yRoad - M(0.18), yRoad + M(0.03), kerbMat);
    box(-X, X, z3, z4, yRoad - M(0.18), y0 + M(0.01), kerbMat);
    // the garden edging 80 × 200 between the grass and the pavements, 30 over them
    const edge = new THREE.MeshStandardMaterial({ color: 0xa9a69e, roughness: 0.9 });
    box(-X, -G, z0 - M(0.08), z0, y0 - M(0.15), y0 + M(0.04), edge); box(G, X, z0 - M(0.08), z0, y0 - M(0.15), y0 + M(0.04), edge);
    box(-X, X, z5, z5 + M(0.08), y0 - M(0.15), y0 + M(0.04), edge);
    // the entrance: crushed stone from the fence to the kerb, sloping down over the dropped kerb; the ruts on it; the trail
    // (flat over the verge and the pavement, then a ramp down over the dropped kerb)
    plane(-G, G, hz, z1, y0 + M(0.015), tex.gravel, 1.2, 0x9a958c);
    const ramp = plane(-G, G, z1, z2 + M(0.02), y0 + M(0.015), tex.gravel, 1.2, 0x9a958c);
    { const p = ramp.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) > z1 + 1e-6) p.setY(i, yRoad + M(0.035)); p.needsUpdate = true; ramp.geometry.computeVertexNormals(); }
    const rutM = new THREE.MeshBasicMaterial({ color: 0x2c241c, transparent: true, opacity: 0.32, depthWrite: false });
    for (const sx of [-1, 1]) { const r = plane(sx * M(0.95) - M(0.2), sx * M(0.95) + M(0.2), hz, z1, y0 + M(0.02), null, 1, 0xffffff); r.material = rutM; }
    const trail = plane(-M(7), M(7), z2, z3, yRoad + M(0.004), null, 1, 0xffffff); trail.material = new THREE.MeshBasicMaterial({ map: trailTex(), transparent: true, depthWrite: false });
    { const uv = trail.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) > 0 ? 1 : 0, uv.getY(i) > z2 / M(1) + 1 ? 0 : 1); }   // (thick at the entrance's side)
    // the line down the middle: 3 m on, 6 off, 0,12 wide
    const n = Math.floor(2 * X / M(9)), line = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7 }), n);
    const m4 = new THREE.Matrix4(), zc = (z2 + z3) / 2;
    for (let i = 0; i < n; i++) line.setMatrixAt(i, m4.makeScale(M(3), 1, M(0.12)).setPosition(-X + M(4.5) + i * M(9), yRoad + M(0.005), zc));
    line.receiveShadow = true; this.group.add(line);
    this.streetZ = [z0, z5];
    // (the place's grass not drawn over the kerbs and the carriageway: they lie lower)
    this.road = [z1, z4];
  }

  // ---- the trees: a ring of impostors round it all, behind the street on its side
  async _trees(cfg, R, street) {
    if (!cfg.trees.length) return;
    const kinds = await Promise.all(cfg.trees.map((k) => this._impostor(k).catch(() => null)));
    const ok = kinds.filter(Boolean); if (!ok.length) return;
    let s = 1234567; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const per = ok.map(() => []), hx = TRAY.innerX / 2, hz = TRAY.innerZ / 2;
    const zFar = street ? this.streetZ[1] + M(2) : 0;
    // (an uneven ring: the trees from ~6 m outside the plot's edge to ~0,8 of the photo's radius, more of them further off)
    for (let i = 0; i < 600 && per.flat().length < 110; i++) {
      const a = rnd() * Math.PI * 2, r0 = Math.max(hx, hz) + M(6), r = r0 + (R * 0.8 - r0) * Math.sqrt(rnd());
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < hx + M(5) && Math.abs(z) < hz + M(5)) continue;
      if (street && z > 0 && z < zFar) continue;   // (not on the street)
      const k = Math.floor(rnd() * ok.length), h = M(ok[k].h * (0.75 + rnd() * 0.6));
      if (per.flat().some((t) => Math.hypot(t[0] - x, t[1] - z) < M(3))) continue;
      per[k].push([x, z, h, rnd()]);
    }
    ok.forEach((I, k) => { if (per[k].length) this.group.add(cards(I, per[k], TRAY.soil)); });
  }
  // a tree model drawn once from the side into a picture (its colours under an even light; the scene's light falls
  // on the card) — h: its height (m) in the ring
  async _impostor(kind) {
    if (this.imp[kind]) return this.imp[kind];
    const H = { tree: 9, tree2: 11, tree3: 10, pine: 12, fir: 14 }[kind] || 10;
    const { scene } = await loadModel('plants/' + kind);
    // (drawn in its own colours only — no metal, no environment to light it: the card is lit by the scene)
    scene.traverse((o) => { if (!o.isMesh) return; const m0 = Array.isArray(o.material) ? o.material[0] : o.material; o.material = new THREE.MeshBasicMaterial({ map: m0.map || null, color: m0.color || 0xffffff, alphaTest: m0.map ? 0.5 : 0, side: THREE.DoubleSide }); });
    const box = new THREE.Box3().setFromObject(scene), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const w = Math.max(sz.x, sz.z), asp = w / sz.y, PX = 512;
    // (its smaller copies made as it is drawn — set after, they were never made: the far cards sampled black)
    const rt = new THREE.WebGLRenderTarget(Math.round(PX * Math.min(1.5, asp)), PX, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    // (the young models' crowns are thin: three of it turned 0°, 120°, 240° in one picture — a grown tree's full crown)
    // (turned round the foot of its trunk — round the frame's middle a leaning trunk's foot went round too: three legs)
    const foot = new THREE.Vector3(), v = new THREE.Vector3(); let nf = 0; scene.updateMatrixWorld(true);
    scene.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y < box.min.y + sz.y * 0.03) { foot.add(v); nf++; } } });
    if (nf) foot.multiplyScalar(1 / nf); else foot.copy(c);
    const sc = new THREE.Scene(); for (const a of [0, 2.09, 4.19]) { const q = a ? scene.clone(true) : scene; q.rotation.y = a; q.position.set(foot.x - (foot.x * Math.cos(a) + foot.z * Math.sin(a)), 0, foot.z - (-foot.x * Math.sin(a) + foot.z * Math.cos(a))); sc.add(q); }
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, sz.y / 2, -sz.y / 2, -100, 100); cam.position.set(c.x, c.y, c.z + w); cam.lookAt(c.x, c.y, c.z);
    const r = this.app.renderer, prev = r.getRenderTarget(), pc = new THREE.Color(), pa = r.getClearAlpha(); r.getClearColor(pc);
    r.setRenderTarget(rt); r.setClearColor(0x506040, 0); r.clear(); r.render(sc, cam); r.setRenderTarget(prev); r.setClearColor(pc, pa);
    sc.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    return (this.imp[kind] = { tex: rt.texture, rt, h: H, asp: Math.min(1.5, asp) });
  }
}

// cards for one kind of tree: each a quad standing at its foot, turned round the vertical to the camera in the
// vertex shader — one draw for all of them
function cards(I, list, y0) {
  const pos = [], cen = [], cor = [], idx = [];
  for (const [x, z, h, j] of list) {
    const o = pos.length / 3, w = h * I.asp;
    for (const [cx, cy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { pos.push(x, y0 + cy * h, z); cen.push(x, y0, z); cor.push(cx * w, cy * h); }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCen', new THREE.Float32BufferAttribute(cen, 3));
  g.setAttribute('aCor', new THREE.Float32BufferAttribute(cor, 2));
  // (half of them mirrored — in the picture, not by turning the card over: a card's back face is lit from below, black)
  const uv = []; for (const t of list) uv.push(...(t[3] < 0.5 ? [0, 0, 1, 0, 1, 1, 0, 1] : [1, 0, 0, 0, 0, 1, 1, 1]));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere(); g.boundingSphere.radius += 2;
  const m = new THREE.MeshStandardMaterial({ map: I.tex, color: 0xb8bcb0, alphaTest: 0.45, roughness: 1, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aCen; attribute vec2 aCor; varying float vNear;')
      .replace('#include <beginnormal_vertex>', `vec3 toC = cameraPosition - aCen; toC.y = 0.0; toC = normalize(toC + vec3(1e-5, 0.0, 0.0));
        vec3 objectNormal = vec3(0.0, 1.0, 0.0);`)   // (lit as the ground is: no white card in the sun, no black one against it)
      .replace('#include <begin_vertex>', 'vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), toC)); vec3 transformed = aCen + rt * aCor.x + vec3(0.0, aCor.y, 0.0); vNear = length(cameraPosition.xz - aCen.xz);');
    // (a tree by the camera — it stood in the way of the plot: gone as a whole, closer than 15–16 m)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        float nearK = smoothstep(${M(15).toFixed(5)}, ${M(16).toFixed(5)}, vNear);
        if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > nearK) discard;`);
  };
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.receiveShadow = false; mesh.castShadow = false;
  return mesh;
}

// the muddy trail of the lorries' wheels on the asphalt: brown, thick at the entrance, thinning out both ways
function trailTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  for (let i = 0; i < 900; i++) { const x = Math.random() * 256, y = Math.random() * 64, k = Math.max(0, 1 - Math.abs(x - 128) / 128) ** 1.6 * Math.max(0, 1 - y / 64);
    g.fillStyle = `rgba(74, 58, 40, ${(0.06 + 0.5 * k * Math.random()).toFixed(3)})`; g.fillRect(x, y, 2 + Math.random() * 6, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// the wire mesh of a panel (one 100 × 250 cell a texture tile): the wires opaque, the rest cut out
let _wire = null;
function wireTex() {
  if (_wire) return _wire;
  const c = document.createElement('canvas'); c.width = 32; c.height = 80;
  const g = c.getContext('2d'), id = g.createImageData(32, 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 32; x++) { const k = (y * 32 + x) * 4, w = x < 3 || y < 3; id.data[k] = id.data[k + 1] = id.data[k + 2] = 235; id.data[k + 3] = w ? 255 : 0; }   // (grey all over: the clear parts too)
  g.putImageData(id, 0, 0);
  _wire = new THREE.CanvasTexture(c); _wire.wrapS = _wire.wrapT = THREE.RepeatWrapping; _wire.anisotropy = 4;
  return _wire;
}
