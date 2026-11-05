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
  lake: { street: false, trees: ['tree', 'tree3', 'pine'], lawn: null },
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
    if (!cfg) { this.group.visible = false; return; }
    if (this.built !== key) {
      this._clear();
      this.built = key;
      this._fence();
      if (cfg.street) this._street(R, tex);
      await this._trees(cfg, R, cfg.street);
      if (this.built !== key) return;
    }
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }
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
        if (gate) { const piv = mid < L / 2 ? p0 : p1; q0 = piv; q1 = [piv[0], piv[1] + (s1 - s0) * 0.97]; }   // (swung out towards the street)
        meshQ.push([q0, q1]);
        for (const p of [q0, q1]) { tubes.push([p, y0 + M(0.12), y0 + M(H + 0.12), M(0.02)]); feet.push(p); }
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
    // (the feet: rubber-grey blocks 0,7 × 0,15 × 0,2 across the fence)
    const foot = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 0.9 }), feet.length);
    feet.forEach((p, i) => foot.setMatrixAt(i, m4.compose(P.set(p[0], y0 + M(0.075), p[1]), Q.identity(), Sv.set(M(0.7), M(0.15), M(0.7)))));
    // (the mesh: one quad a panel, the wires drawn into a texture, cut out)
    const pos = [], uv = [], idx = [];
    for (const [p, q] of meshQ) {
      const o = pos.length / 3, L = Math.hypot(q[0] - p[0], q[1] - p[1]) / M(1), ya = y0 + M(0.16), yb = y0 + M(H + 0.1);
      pos.push(p[0], ya, p[1], q[0], ya, q[1], q[0], yb, q[1], p[0], yb, p[1]);
      uv.push(0, 0, L / 0.1, 0, L / 0.1, (H - 0.06) / 0.25, 0, (H - 0.06) / 0.25);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: wireTex(), color: 0xc4c8cc, roughness: 0.5, metalness: 0.6, alphaTest: 0.4, side: THREE.DoubleSide }));
    for (const o of [T, foot, mesh]) { o.castShadow = true; o.receiveShadow = true; this.group.add(o); }
  }

  // ---- the street in front (+z): the grass verge (the ground's own), the pavement, the kerb, the carriageway
  _street(R, tex) {
    const hz = TRAY.innerZ / 2 + M(0.35), y0 = TRAY.soil, X = R * 0.92;
    const z0 = hz + M(ROAD.verge), z1 = z0 + M(ROAD.walk), z2 = z1 + M(ROAD.kerb), z3 = z2 + M(ROAD.road), z4 = z3 + M(ROAD.kerb), z5 = z4 + M(ROAD.walk);
    const strip = (za, zb, y, t, tile, col) => {
      const g = new THREE.PlaneGeometry(2 * X, zb - za, 1, 1); g.rotateX(-Math.PI / 2); g.translate(0, y, (za + zb) / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * X / M(tile), uv.getY(i) * (zb - za) / M(tile));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t?.diff || null, normalMap: t?.nor || null, color: col, roughness: 0.95 }));
      m.receiveShadow = true; this.group.add(m); return m;
    };
    const walk = tex.walk, asph = tex.asphalt;
    strip(z0, z1, y0 + M(0.12), walk, 1.8, 0xbfc5cc);   // (grey concrete: the photo's slabs are warm)
    strip(z4, z5, y0 + M(0.12), walk, 1.8, 0xbfc5cc);
    strip(z2, z3, y0 + M(0.0), asph, 3.0, 0xd8d8d8);
    // the kerbs: precast 150 × 300, their tops 120 over the road; the line down the middle: 3 m on, 6 off, 0,12 wide
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85 });
    for (const za of [z1, z3]) { const g = new THREE.BoxGeometry(2 * X, M(0.3), M(ROAD.kerb)); const k = new THREE.Mesh(g, kerbMat); k.position.set(0, y0 - M(0.03), za + M(ROAD.kerb) / 2); k.castShadow = k.receiveShadow = true; this.group.add(k); }
    const n = Math.floor(2 * X / M(9)), line = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7 }), n);
    const m4 = new THREE.Matrix4(), zc = (z2 + z3) / 2;
    for (let i = 0; i < n; i++) line.setMatrixAt(i, m4.makeScale(M(3), 1, M(0.12)).setPosition(-X + M(4.5) + i * M(9), y0 + M(0.005), zc));
    line.receiveShadow = true; this.group.add(line);
    this.streetZ = [z0, z5];
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
    const sc = new THREE.Scene(); for (const a of [0, 2.09, 4.19]) { const q = a ? scene.clone(true) : scene; q.rotation.y = a; q.position.set(c.x - (c.x * Math.cos(a) - c.z * Math.sin(a)), 0, c.z - (c.x * Math.sin(a) + c.z * Math.cos(a))); sc.add(q); }
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

// the wire mesh of a panel (one 100 × 250 cell a texture tile): the wires opaque, the rest cut out
let _wire = null;
function wireTex() {
  if (_wire) return _wire;
  const c = document.createElement('canvas'); c.width = 32; c.height = 80;
  const g = c.getContext('2d'); g.clearRect(0, 0, 32, 80); g.fillStyle = '#fff'; g.fillRect(0, 0, 5, 80); g.fillRect(0, 0, 32, 5);
  _wire = new THREE.CanvasTexture(c); _wire.wrapS = _wire.wrapT = THREE.RepeatWrapping; _wire.anisotropy = 4;
  return _wire;
}
