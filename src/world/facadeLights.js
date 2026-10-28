import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { blocksOf as porchBlocks } from './porch.js';

// The lights of the house's outside, put up as an electrician puts them up: a fixture screwed to the
// wall (the holes drilled first), downlights let into the soffit, an LED strip in its aluminium channel
// stuck along an edge, uplights in the ground at the wall's foot, a light in each step of the porch.
// At dusk they come on: the lens glows, and the light they throw is drawn on what it falls on — the
// cones up and down a wall, the scallops of the downlights on the ground, the soft line of the strip.
//   flight { kind, p: [x, y, z] (where it is fixed), n: [x, y, z] (the surface's normal there), temp,
//            pts: [[x, y, z, nx, ny, nz]…] (a strip), porch (its id: the step lights) }
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const FLIGHTS = {
  sconce: { name: 'Бра вверх-вниз', usd: 85, on: 'wall' },
  cube: { name: 'Настенный куб, свет вниз', usd: 65, on: 'wall' },
  downlight: { name: 'Точечный в софит', usd: 35, on: 'ceiling' },
  uplight: { name: 'Прожектор на фасад', usd: 95, on: 'wall' },
  led: { name: 'Светодиодная лента', usd: 18, on: 'any', strip: true },
  steps: { name: 'Подсветка ступеней', usd: 40, on: 'porch' },
};
export const FLIGHT_TEMPS = { warm: ['Тёплый 2700K', 0xffc78a], neutral: ['Нейтральный 4000K', 0xfff0d8], cool: ['Холодный 5000K', 0xe4edff] };

// ---- the light's own textures (drawn once) ------------------------------------------------------------
const _t = {};
function canvasTex(key, w, h, f) {
  if (_t[key]) return _t[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.max(0, Math.min(1, f((x + 0.5) / w * 2 - 1, (y + 0.5) / h))), i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (_t[key] = t);
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// a cone of light on a wall: v 0 at the fixture … 1 far; it spreads as it goes and fades
const coneTex = () => canvasTex('cone', 128, 256, (u, v) => { const w = 0.12 + 0.88 * Math.pow(v, 0.8); return Math.pow(1 - v, 1.4) * (1 - smooth(w * 0.55, w, Math.abs(u))) * smooth(0, 0.04, v) * 1.15; });
// the scallop a downlight throws on a wall: a bright arc under it, a long soft tail
const scallopTex = () => canvasTex('scallop', 128, 256, (u, v) => { const w = 0.25 + 0.75 * Math.sqrt(v); return Math.pow(1 - v, 1.2) * (1 - smooth(w * 0.5, w, Math.abs(u))) * smooth(0.02, 0.18, v) * 1.1; });
const discTex = () => canvasTex('disc', 128, 128, (u, v) => { const r = Math.hypot(u, v * 2 - 1); return Math.pow(Math.max(0, 1 - r), 1.6); });
const ribbonTex = () => canvasTex('ribbon', 8, 128, (u, v) => Math.pow(Math.max(0, 1 - Math.abs(v * 2 - 1)), 2.2));
const beamTex = () => canvasTex('beam', 8, 128, (u, v) => 0.6 * Math.pow(1 - v, 1.5));
function glowMat(tex, col) {
  return new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
}
// a quad on a surface (normal n), its "up" along dir u (in the surface), from the fixture out to len
function quadOn(p, n, up, len, width, tex, col, back = 0) {
  const g = new THREE.PlaneGeometry(width, len); g.translate(0, len / 2 - back, 0);
  // (the texture's v: 0 at the fixture → 1 far — the plane's +y)
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const m = new THREE.Mesh(g, glowMat(tex, col));
  const x = new THREE.Vector3().crossVectors(up, n).normalize(), M = new THREE.Matrix4().makeBasis(x, up, n);
  m.quaternion.setFromRotationMatrix(M); m.position.copy(p).addScaledVector(n, MM(3));
  m.renderOrder = 7; m.userData.glow = 1;
  return m;
}
const metal = (c = 0x26292c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.6 });
const lens = (col) => new THREE.MeshStandardMaterial({ color: 0xfff7ea, emissive: col, emissiveIntensity: 0, roughness: 0.3 });
// a fixture's body on a surface: built in its own frame (z out of the surface, y up the wall)
function onSurface(G, p, n) {
  const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
  const x = new THREE.Vector3().crossVectors(up, n).normalize();
  G.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, n)); G.position.copy(p);
  return up;
}

// the wall nearest a point under a soffit (within 900): { p (on it, level with the point), n } — the
// downlights and the strips wash it below them
const _rc = new THREE.Raycaster();
function wallNear(app, p) {
  let best = null;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    _rc.set(p.clone().add(new THREE.Vector3(0, -MM(60), 0)), d); _rc.far = MM(900);
    const h = _rc.intersectObject(app.wallView.group, true).find((q) => q.face && !q.object.userData.glow && (() => { for (let o = q.object; o; o = o.parent) if (!o.visible) return false; return true; })());
    if (h && (!best || h.distance < best.d)) best = { d: h.distance, p: h.point.clone(), n: d.clone().negate() };
  }
  return best;
}
// one light: { body (the fixture: placed), glows: [the light it throws] }
export function buildLight(r, app, porch = null) {
  const G = new THREE.Group(), col = (FLIGHT_TEMPS[r.temp] || FLIGHT_TEMPS.warm)[1], p = new THREE.Vector3(...(r.p || [0, 0, 0])), n = new THREE.Vector3(...(r.n || [0, 0, 1])).normalize();
  const body = new THREE.Group(), glows = new THREE.Group(), lensM = lens(col), M = metal();
  G.add(body, glows);
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(MM(w), MM(h), MM(d)), m); o.position.set(MM(x), MM(y), MM(z)); o.castShadow = true; body.add(o); return o; };
  const groundY = (x, z) => (app.terrain.inside(x, z) ? app.terrain.heightAt(x, z) : p.y - MM(2500));
  if (r.kind === 'sconce' || r.kind === 'cube') {
    const fx = new THREE.Group(); body.add(fx); const up = onSurface(fx, p, n);
    const prev = body; body.remove(fx); prev.add(fx);
    const b = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(MM(w), MM(h), MM(d)), m); o.position.set(MM(x), MM(y), MM(z)); o.castShadow = true; fx.add(o); };
    if (r.kind === 'sconce') { b(80, 220, 90, M, 0, 0, 45); b(70, 8, 80, lensM, 0, 112, 48); b(70, 8, 80, lensM, 0, -112, 48); }
    else { b(110, 110, 110, M, 0, 0, 55); b(90, 6, 90, lensM, 0, -56, 58); }
    glows.add(quadOn(p.clone().addScaledVector(up, MM(-90)), n, up.clone().negate(), MM(r.kind === 'cube' ? 1500 : 1800), MM(1100), coneTex(), col));
    if (r.kind === 'sconce') glows.add(quadOn(p.clone().addScaledVector(up, MM(90)), n, up, MM(1800), MM(1100), coneTex(), col));
    // (the pool on the ground under it)
    const gy = groundY(p.x + n.x * MM(500), p.z + n.z * MM(500)), d = new THREE.Mesh(new THREE.CircleGeometry(MM(900), 24).rotateX(-Math.PI / 2), glowMat(discTex(), col));
    d.position.set(p.x + n.x * MM(450), gy + MM(15), p.z + n.z * MM(450)); d.renderOrder = 7; glows.add(d);
  } else if (r.kind === 'uplight') {
    // in the ground 300 out from the wall, tilted at it; the wash up the wall from its foot
    const gy = groundY(p.x + n.x * MM(300), p.z + n.z * MM(300)), base = new THREE.Vector3(p.x + n.x * MM(300), gy, p.z + n.z * MM(300));
    const o = new THREE.Mesh(new THREE.CylinderGeometry(MM(55), MM(55), MM(40), 16), M); o.position.copy(base).add(new THREE.Vector3(0, MM(18), 0)); body.add(o);
    const l = new THREE.Mesh(new THREE.CircleGeometry(MM(45), 16), lensM); l.rotation.x = -Math.PI / 2; l.position.copy(base).add(new THREE.Vector3(0, MM(39), 0)); body.add(l);
    const foot = new THREE.Vector3(p.x, gy + MM(30), p.z);
    glows.add(quadOn(foot, n, new THREE.Vector3(0, 1, 0), MM(4200), MM(1300), coneTex(), col));
  } else if (r.kind === 'downlight') {
    // let into the soffit (a ring and its lens), the beam down to the ground, its scallop there
    const fx = new THREE.Group(); onSurface(fx, p, n); body.add(fx);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(MM(45), MM(45), MM(6), 18), metal(0xd9dbdc)); ring.rotation.x = Math.PI / 2; ring.position.z = MM(2); fx.add(ring);
    const l = new THREE.Mesh(new THREE.CircleGeometry(MM(32), 18), lensM); l.position.z = MM(6); fx.add(l);
    const gy = groundY(p.x, p.z), H = Math.max(MM(500), p.y - gy);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(MM(40), Math.max(MM(250), H * 0.33), H, 20, 1, true), glowMat(beamTex(), col));
    // (the beam's texture: bright at its top, gone at the ground)
    cone.position.set(p.x, p.y - H / 2, p.z); cone.renderOrder = 7; cone.material.opacity = 0; cone.userData.beam = 1; glows.add(cone);
    const d = new THREE.Mesh(new THREE.CircleGeometry(Math.max(MM(300), H * 0.36), 24).rotateX(-Math.PI / 2), glowMat(discTex(), col)); d.position.set(p.x, gy + MM(15), p.z); d.renderOrder = 7; glows.add(d);
    // (near a wall: the scallop it throws down the wall)
    const w = wallNear(app, p);
    if (w) glows.add(quadOn(w.p, w.n, new THREE.Vector3(0, -1, 0), Math.min(H, MM(3200)), MM(1100), scallopTex(), col));
  } else if (r.kind === 'led' && r.pts?.length > 1) {
    // the strip in its channel: a thin bright line on the surface, and the soft band it lights
    const pts = r.pts.map((q) => [new THREE.Vector3(q[0], q[1], q[2]), new THREE.Vector3(q[3], q[4], q[5])]);
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const [a, na] = pts[i - 1], [b, nb] = pts[i], L = a.distanceTo(b); if (L < 1e-6) continue;
      const nn = na.clone().add(nb).normalize(), dir = b.clone().sub(a).normalize(), up = new THREE.Vector3().crossVectors(nn, dir).normalize();
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(L + MM(4), MM(16), MM(10)), [M, M, M, M, lensM, M]);
      strip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, nn)); strip.position.copy(mid).addScaledVector(nn, MM(5));
      strip.userData.s0 = s; strip.userData.s1 = s + L; body.add(strip);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(L, MM(700)), glowMat(ribbonTex(), col));
      band.quaternion.copy(strip.quaternion); band.position.copy(mid).addScaledVector(nn, MM(3)); band.renderOrder = 7; band.userData.s0 = s; band.userData.s1 = s + L; glows.add(band);
      // (a strip under a soffit: the wall below washed by it, a soft band fading down)
      if (nn.y < -0.5) {
        const w = wallNear(app, mid);
        if (w) { const q = quadOn(w.p.clone().add(new THREE.Vector3(0, MM(40), 0)), w.n, new THREE.Vector3(0, -1, 0), MM(1600), L, beamTex(), col); q.userData.s0 = s; q.userData.s1 = s + L; glows.add(q); }
      }
      s += L;
    }
    G.userData.len = s;
  } else if (r.kind === 'steps' && porch) {
    // a small light in each riser, near each end; its pool on the tread below
    const B = porchBlocks(porch), fx = (a, d, y) => { const x = porch.o[0] + (porch.u[0] * a + porch.nrm[0] * d) * S, z = porch.o[1] + (porch.u[1] * a + porch.nrm[1] * d) * S; return new THREE.Vector3(x, porch.g + MM(y), z); };
    const nn = new THREE.Vector3(porch.nrm[0], 0, porch.nrm[1]);
    B.forEach((b, k) => {
      const lo = k < B.length - 1 ? B[k + 1][4] : 0, y = lo + (b[4] - lo) * 0.45, d = b[3] + 22;
      for (const a of [-porch.W / 2 + 250, porch.W / 2 - 250]) {
        const c = fx(a, d, y), o = new THREE.Mesh(new THREE.BoxGeometry(MM(90), MM(30), MM(6)), lensM); o.position.copy(c); o.rotation.y = Math.atan2(nn.x, nn.z); body.add(o);
        const t = new THREE.Mesh(new THREE.CircleGeometry(MM(380), 20).rotateX(-Math.PI / 2), glowMat(discTex(), col)); t.position.copy(fx(a, d + 200, lo + 25)); t.renderOrder = 7; glows.add(t);
      }
    });
  }
  G.userData.body = body; G.userData.glows = glows; G.userData.lens = lensM;
  return G;
}
// the light of one at the night's level k (0 day … 1 night); a strip shown up to len (mm·S) as it goes on
export function lightLevel(G, k, shown = Infinity) {
  G.userData.lens.emissiveIntensity = 0.15 + 3.2 * k;
  G.userData.glows.traverse((o) => { if (!o.isMesh) return; const vis = !(o.userData.s0 > shown); o.visible = vis; o.material.opacity = (o.userData.beam ? 0.22 : 0.95) * k; });
  G.userData.body.traverse((o) => { if (o.isMesh && o.userData.s0 != null) o.visible = o.userData.s0 <= shown; });
}
