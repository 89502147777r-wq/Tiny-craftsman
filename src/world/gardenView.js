import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { PATH, TOPS, paversOf, kerbsOf, paveQuads, kerbOuter, bandQuads, legsOf, legW, lengthOf, half, inset } from './garden.js';
import { lawnUniforms, buildLawn, lawnLine, lawnGhost, turfRoll, roller, sprinkler } from './lawnView.js';
import { frameW } from './lawn.js';
import { fenceString, fencePosts, fenceFill, fenceUniforms, auger, fenceGates } from './fence.js';
import { PLANTS, plantBody, rootBall, mulchDisc, mulchStrip, spotsOf } from './plants.js';
import { buildLight, lightLevel } from './facadeLights.js';
import { buildInterior, interiorLight } from './interior.js';
import { mats as winMats } from './windows.js';
import { porchConcrete, porchForm, porchTiles, porchUniforms, canopyMesh, blocksOf as porchBlocks } from './porch.js';

// The garden drawn (garden.js): the paths — the pegs and the string of the setting-out, the
// geotextile, the kerbs on their concrete, the pavers, the sand in the joints. The ground's layers
// (the trough, the stone, the sand) are the terrain's. While a stage is being done, the tool says
// how far it has got (anim[id]: the pieces laid, the front along the path) and the parts show that
// much: the pieces drop into place one after another, the fabric unrolls, the joints fill.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const TEX = {};
function tex(folder, file, srgb) {
  const key = folder + '/' + file;
  if (TEX[key]) return TEX[key];
  const t = new THREE.TextureLoader().load(`assets/textures/${folder}/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[key] = t);
}
function dispose(g) { g?.traverse((o) => { if (o.isMesh || o.isLine) o.geometry?.dispose(); }); }

// ---- the geometry ------------------------------------------------------------------------------
// prisms over footprints (world [x, z] polygons, convex): the top at yT (a number or per corner), the
// bottom at yB, the top's edge chamfered by ch; per piece: its colour, its order, its chainage
function prisms(list, ch, tile) {
  const pos = [], uv = [], col = [], ord = [], ss = [];
  for (const it of list) {
    const p = it.p, n = p.length, yT = Array.isArray(it.yT) ? it.yT : p.map(() => it.yT), yB = it.yB, rgb = it.rgb || [1, 1, 1];
    const pi = ch > 0 ? inset(p, ch) : p;
    const V = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); col.push(...rgb); ord.push(it.ord ?? 0); ss.push(it.s ?? 0); };
    const top = (k) => [pi[k][0], yT[k], pi[k][1]];
    const tri = (a, b, c, side) => {
      for (const q of [a, b, c]) V(q[0], q[1], q[2], side ? (q[0] + q[2]) / tile : q[0] / tile, side ? q[1] / tile : q[2] / tile);
    };
    // the top (a fan; the polygon's winding made counter-clockwise from above)
    let area = 0; for (let k = 0; k < n; k++) area += p[k][0] * p[(k + 1) % n][1] - p[(k + 1) % n][0] * p[k][1];
    const w = area > 0 ? -1 : 1;   // (+y up, x right, z towards the viewer: ccw from above is negative in x-z)
    const ix = (k) => (w > 0 ? k : n - 1 - k);
    for (let k = 1; k < n - 1; k++) tri(top(ix(0)), top(ix(k)), top(ix(k + 1)));
    for (let k = 0; k < n; k++) {
      const a = ix(k), b = ix((k + 1) % n);
      const A = [p[a][0], yT[a] - ch, p[a][1]], B = [p[b][0], yT[b] - ch, p[b][1]], A0 = [p[a][0], yB, p[a][1]], B0 = [p[b][0], yB, p[b][1]];
      if (ch > 0) { tri(top(a), B, top(b), true); tri(top(a), A, B, true); }
      tri(A, B0, B, true); tri(A, A0, B0, true);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aOrd', new THREE.Float32BufferAttribute(ord, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(ss, 1));
  g.computeVertexNormals();
  return g;
}
// flat sheets over polygons at y (the front: their chainage per corner)
function sheets(list, y, tile) {
  const pos = [], uv = [], ss = [];
  for (const it of list) for (let k = 1; k < it.p.length - 1; k++) for (const q of [0, k, k + 1]) { const [x, z] = it.p[q]; pos.push(x, y, z); uv.push(x / tile, z / tile); ss.push(it.s[q]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(ss, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

// the materials: shown up to a count (the pieces, dropping into place) or up to a front (mm along)
function byCount(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uN = U.n; sh.uniforms.uDrop = U.drop;
    sh.vertexShader = 'attribute float aOrd;\nuniform float uN;\nuniform float uDrop;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float kDrop = clamp((aOrd - (uN - 6.0)) / 6.0, 0.0, 1.0);
      transformed.y += kDrop * kDrop * uDrop;
      if (aOrd >= uN) transformed = vec3(0.0, -1000.0, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'gardenCount';
  return mat;
}
function byFront(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uF = U.f;
    sh.vertexShader = 'attribute float aS;\nvarying float vS;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vS = aS;');
    sh.fragmentShader = 'uniform float uF;\nvarying float vS;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n if (vS > uF) discard;');
  };
  mat.customProgramCacheKey = () => 'gardenFront';
  return mat;
}
let _fabric = null;
function fabric() {
  if (_fabric) return _fabric;
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'); g.fillStyle = '#d9d8d2'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '120,118,110'},${Math.random() * 0.25})`; g.fillRect(Math.random() * n, Math.random() * n, 1 + Math.random() * 3, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return (_fabric = t);
}

export class GardenView {
  constructor(objects) {
    this.objects = objects;
    this.group = new THREE.Group(); this.group.name = 'garden';
    this.parts = new Map();   // path id → { g, keys, sub, U }
    this.live = null;          // a path being set out (no id): { pts, W }
    this.anim = {};            // id → { kerb: n, pave: n, geo, joint (mm along), roll }
    this.dirty = true;
    // («Готово»: the rooms behind the windows, made again a moment after the house changes)
    this.interior = null; this._intT = 0.2;
    objects.on(() => { this._intT = 0.4; });
    objects.on((id, rec) => { if (rec?.type === 'path' || rec?.type === 'lawn' || rec?.type === 'fence' || rec?.type === 'plant' || rec?.type === 'porch' || rec?.type === 'canopy' || rec?.type === 'flight' || this.parts.has('X' + id) || this.parts.has('P' + id) || this.parts.has('R' + id) || this.parts.has('C' + id) || this.parts.has(id) || this.parts.has('L' + id) || this.parts.has('F' + id)) this.dirty = true; });
    this.liveLawn = null;   // a lawn being drawn: { poly, g }
  }
  setLive(l) { this.live = l; this.dirty = true; }
  setLiveLawn(l) { this.liveLawn = l; this.dirty = true; }
  setLiveFence(l) { this.liveFence = l; this.dirty = true; }
  setAnim(id, a) { if (a) this.anim[id] = { ...(this.anim[id] || {}), ...a }; else delete this.anim[id]; this.dirty = true; }

  update(dt, app) {
    this._night = app.sky?.night ?? 0; this._dt = dt;
    if (this.dirty) this._build(app);
    this._interiorFrame(app, dt);
    for (const e of this.parts.values()) {
      if (e.lawn) { this._lawnFrame(e); continue; }
      if (e.fence) { this._fenceFrame(e); continue; }
      if (e.plant) { this._plantFrame(e); continue; }
      if (e.porch) { this._porchFrame(e); continue; }
      if (e.canopy) { this._canopyFrame(e); continue; }
      if (e.flight) { this._lightFrame(e); continue; }
      const r = e.rec, d = r.done || {}, a = this.anim[r.id] || {}, U = e.U;
      U.kerb.n.value = a.kerb ?? (d.kerb ? 1e9 : -1);
      U.bed.f.value = a.kerbS ?? (d.kerb ? 1e9 : -1e9);
      U.geo.f.value = a.geo ?? (d.geo ? 1e9 : -1e9);
      U.pave.n.value = a.pave ?? (d.pave ? 1e9 : -1);
      U.joint.f.value = a.joint ?? (d.joint ? 1e9 : -1e9);
      if (e.sub.kerb) e.sub.kerb.castShadow = a.kerb == null;
      if (e.roll) {
        const on = a.roll != null;
        e.roll.visible = on;
        if (on) { const L = lengthOf(r) / S, k = Math.max(0, Math.min(1, a.roll / L)), p = pointAt(r, a.roll); e.roll.position.set(p[0], r.g + MM(TOPS.geo + 60 * (1 - k) + 20), p[1]); e.roll.rotation.y = -Math.atan2(p[3], p[2]); const sc = 0.35 + 0.65 * (1 - k); e.roll.scale.set(sc, 1, sc); }
      }
    }
  }

  _build(app) {
    this.dirty = false;
    const list = this.objects.all('path').slice();
    if (this.live?.pts?.length > 1) list.push({ ...this.live, id: null, done: {}, g: this.live.g });
    const seen = new Set();
    for (const r of list) {
      const key = r.id ?? 'new';
      seen.add(key);
      let e = this.parts.get(key);
      if (!e) {
        const U = { kerb: { n: { value: 0 }, drop: { value: MM(60) } }, bed: { f: { value: 0 } }, geo: { f: { value: 0 } }, pave: { n: { value: 0 }, drop: { value: MM(45) } }, joint: { f: { value: 0 } } };
        e = { g: new THREE.Group(), keys: {}, sub: {}, U }; this.group.add(e.g); this.parts.set(key, e);
      }
      e.rec = r;
      this._buildPath(app, r, e);
    }
    const lawns = this.objects.all('lawn').slice();
    if (this.liveLawn?.poly?.length > 2) lawns.push({ ...this.liveLawn, id: null, done: {} });
    for (const r of lawns) {
      const key = 'L' + (r.id ?? 'new');
      seen.add(key);
      let e = this.parts.get(key);
      if (!e) { e = { g: new THREE.Group(), keys: {}, sub: {}, U: lawnUniforms(), lawn: true }; this.group.add(e.g); this.parts.set(key, e); }
      e.rec = r;
      this._buildLawn(app, r, e);
    }
    const fences = this.objects.all('fence').slice();
    if (this.liveFence?.pts?.length > 1) fences.push({ ...this.liveFence, id: null, done: {} });
    for (const r of fences) {
      const key = 'F' + (r.id ?? 'new');
      seen.add(key);
      let e = this.parts.get(key);
      if (!e) { e = { g: new THREE.Group(), keys: {}, sub: {}, U: fenceUniforms(), fence: true }; this.group.add(e.g); this.parts.set(key, e); }
      e.rec = r;
      const d = r.done || {}, a = this.anim['F' + r.id] || {}, gk = JSON.stringify((r.gates || []).map((q) => [q.s, q.w, q.type])), geo = [r.pts.flat().join(), r.H, r.kind, r.g, gk].join('|');
      this._part(e, 'string', !d.posts ? geo : null, () => fenceString(r));
      this._part(e, 'posts', d.posts || a.posts != null ? geo : null, () => fencePosts(r, e.U));
      this._part(e, 'fill', d.fill || a.fill != null ? geo + '|' + r.col : null, () => fenceFill(r, e.U));
      // the gates' leaves (hung with the fill, or one by one later)
      const hung = (r.gates || []).some((q) => q.hung) || d.fill || a.gate != null;
      this._part(e, 'gates', hung ? geo + '|' + r.col + '|' + (r.gates || []).map((q) => (q.hung ? 1 : 0)).join('') : null, () => { const G = new THREE.Group(); e.gl = fenceGates(r); for (const q of e.gl) G.add(q.group); return G; });
      if (!e.auger) { e.auger = auger(); e.auger.visible = false; e.g.add(e.auger); }
    }
    for (const r of this.objects.all('plant')) {
      const key = 'P' + r.id;
      seen.add(key);
      let e = this.parts.get(key);
      if (!e) { e = { g: new THREE.Group(), keys: {}, sub: {}, plant: true }; this.group.add(e.g); this.parts.set(key, e); }
      e.rec = r;
      const geo = [r.kind, r.x, r.z, (r.pts || []).flat().join(), r.g, r.s].join('|'), P = PLANTS[r.kind];
      // each plant (a hedge: each of its plants) with its root ball under it while it goes in
      this._part(e, 'body', geo, () => {
        const G = new THREE.Group();
        spotsOf(r).forEach(([x, z], i) => { const o = new THREE.Group(); o.position.set(x, r.g, z); o.rotation.y = (r.rot || 0) + i * 2.4; o.add(plantBody(r.kind, r.s || 1)); const b = rootBall(P.ball); b.visible = false; o.add(b); o.userData.ball = b; G.add(o); });
        return G;
      });
      this._part(e, 'mulch', P.mulch ? geo : null, () => {
        if (r.kind === 'hedge') { const m = mulchStrip(r.pts, P.mulch); m.position.y = r.g; return m; }
        const m = mulchDisc(P.mulch); m.position.x = r.x; m.position.z = r.z; m.position.y += r.g; return m;
      });
    }
    for (const r of this.objects.all('porch')) {
      const key = 'R' + r.id; seen.add(key);
      let e = this.parts.get(key);
      if (!e) { e = { g: new THREE.Group(), keys: {}, sub: {}, U: porchUniforms(), porch: true }; this.group.add(e.g); this.parts.set(key, e); }
      e.rec = r;
      const d = r.done || {}, a = this.anim[key] || {}, geo = [r.o, r.yaw, r.y, r.g, r.W, r.D, r.n].join('|');
      this._part(e, 'form', (d.form && !d.strip) || a.form != null ? geo : null, () => porchForm(r));
      this._part(e, 'conc', d.conc || a.fill != null ? geo : null, () => porchConcrete(r, e.U));
      this._part(e, 'tile', d.tile || a.tile != null ? geo + '|' + r.tile : null, () => porchTiles(r, e.U));
    }
    for (const r of this.objects.all('canopy')) {
      const key = 'C' + r.id; seen.add(key);
      let e = this.parts.get(key);
      if (!e) { e = { g: new THREE.Group(), keys: {}, sub: {}, canopy: true }; this.group.add(e.g); this.parts.set(key, e); }
      e.rec = r;
      this._part(e, 'body', [r.o, r.y, r.W, r.P].join('|'), () => canopyMesh(r));
    }
    for (const r of this.objects.all('flight')) {
      const key = 'X' + r.id; seen.add(key);
      let e = this.parts.get(key);
      if (!e) { e = { g: new THREE.Group(), keys: {}, sub: {}, flight: true }; this.group.add(e.g); this.parts.set(key, e); }
      e.rec = r;
      const pr = r.porch != null ? this.objects.get(r.porch) : null;
      this._part(e, 'body', JSON.stringify([r.kind, r.p, r.n, r.temp, r.pts, pr && [pr.o, pr.H, pr.W, pr.n]]), () => buildLight(r, app, pr));
    }
    for (const [k, e] of [...this.parts]) if (!seen.has(k)) { this.group.remove(e.g); dispose(e.g); this.parts.delete(k); }
  }
  // the house lived in: built when «Готово» is on (a while after the last change, the walls standing by
  // then), lit at dusk
  _interiorFrame(app, dt) {
    const rec = this.objects.all('interior')[0], on = !!rec;
    if (this._intT > 0) { this._intT -= dt || 0.016; if (this._intT <= 0 || !on) { this._intT = 0; if (this.interior) { this.group.remove(this.interior); dispose(this.interior); this.interior = null; } if (on) { app.wallView.group.updateMatrixWorld(true); this.interior = buildInterior(app, rec.seed || 0); this.group.add(this.interior); } } }
    // (a lived-in house's glass: clear double glazing, the rooms seen through it; a house being built: the
    // solar-control glass that mirrors the site)
    const gl = winMats().glass, lived = !!this.interior;
    if (gl.userData.lived !== lived) { gl.userData.lived = lived; Object.assign(gl, lived ? { metalness: 0.15, envMapIntensity: 0.55, opacity: 0.22, color: gl.color.setHex(0x8fa0a6) } : { metalness: 0.6, envMapIntensity: 1.6, opacity: 0.36, color: gl.color.setHex(0x6f838d) }); gl.needsUpdate = true; }
    if (this.interior) interiorLight(this.interior, Math.max(0, Math.min(1, ((this._night || 0) - 0.05) / 0.4)), (this._t = (this._t || 0) + (dt || 0.016)));
  }
  // a light: on at dusk (the lens, the light it throws); going in: the fixture growing to its place, a
  // strip shown along as far as it is stuck
  _lightFrame(e) {
    const G = e.sub.body; if (!G) return;
    const a = this.anim['X' + e.rec.id], n = this._night || 0, k = Math.max(0, Math.min(1, (n - 0.08) / 0.45));
    lightLevel(G, a ? 0 : k, a?.len ?? Infinity);
    const b = G.userData.body;
    if (e.rec.kind !== 'led') { const s = a ? Math.max(0.01, a.appear ?? 1) : 1; b.children.forEach((o) => o.scale.setScalar(s)); }
  }
  _porchFrame(e) {
    const r = e.rec, d = r.done || {}, a = this.anim['R' + r.id] || {};
    e.U.fill.value = a.fill ?? (d.conc ? 1e9 : -1e9);
    e.U.tile.value = a.tile ?? (d.tile ? 1e9 : -1);
    const f = e.sub.form;
    if (f) { const k = a.form ?? 1; f.visible = k > 0.02; f.position.y = r.g + (a.strip ? MM(400) * (1 - k) : MM(250) * (1 - k)); }
  }
  _canopyFrame(e) {
    const a = this.anim['C' + e.rec.id], P = e.sub.body?.userData.parts;
    if (!P) return;
    P.anchors.forEach((o, i) => { o.visible = !a || i < (a.anchors ?? 4); });
    for (const o of P.brackets) { o.visible = !a || (a.brackets ?? 1) > 0.01; o.scale.setScalar(a ? Math.max(0.01, a.brackets ?? 1) : 1); }
    P.glass.visible = !a || (a.glass ?? 1) > 0.01; P.glass.position.y = MM(39) + (a ? MM(400) * (1 - (a.glass ?? 1)) : 0);
  }
  // a plant going in: each one dropping into its hole in turn (a: { n (how many in), drop (mm, the
  // one going in), ball, mulch (0…1) }); once planted, all of them in place
  _plantFrame(e) {
    // (a light: its lens and the ground round it glow at night)
    if (PLANTS[e.rec.kind]?.light && e.sub.body) { const night = this._night || 0; e.sub.body.traverse((o) => { if (o.userData.lens) o.userData.lens.material.emissiveIntensity = 0.2 + 3 * night; if (o.userData.glow) o.userData.glow.material.opacity = 0.85 * night; }); }
    const r = e.rec, a = this.anim['P' + r.id], body = e.sub.body, P = PLANTS[r.kind], dep = MM(P.hole[1] - P.ball * 0.5);
    if (!body) return;
    body.children.forEach((o, i) => {
      const n = a ? a.n ?? 1e9 : 1e9, on = i < Math.ceil(n), cur = i === Math.ceil(n) - 1 && a && a.n != null;
      o.visible = on;
      // (in its hole the ball's top is at the ground's level; the plant comes down onto it)
      o.position.y = r.g + (cur ? MM(a.drop || 0) : 0);
      o.userData.ball.visible = !!(a && on && !a.settled);
    });
    if (e.sub.mulch) { const k = a ? a.mulch ?? 0 : 1; e.sub.mulch.visible = k > (r.kind === 'hedge' ? 0.5 : 0.01); if (r.kind !== 'hedge') e.sub.mulch.scale.set(Math.max(0.01, k), 1, Math.max(0.01, k)); }
  }
  _fenceFrame(e) {
    const r = e.rec, d = r.done || {}, a = this.anim['F' + r.id] || {};
    e.U.posts.n.value = a.posts ?? (d.posts ? 1e9 : -1);
    e.U.fill.n.value = a.fill ?? (d.fill ? 1e9 : -1);
    // the gates: shown when hung; each leaf swung (or rolled) toward where it is meant to be
    if (e.sub.gates && e.gl) {
      e.gs = e.gs || {};
      for (const q of e.gl) {
        const G = r.gates?.[q.gi]; if (!G) continue;
        const inst = a.gate === q.gi, shown = G.hung || d.fill || inst;
        q.group.visible = !!shown;
        const want = inst ? (a.gopen ?? 0) : G.open ? 1 : 0;
        const cur = e.gs[q.gi] ?? want, k = inst ? want : cur + (want - cur) * Math.min(1, (this._dt || 0.016) * 2.2);
        e.gs[q.gi] = k;
        const ease = k * k * (3 - 2 * k);
        for (const L of q.leaves) {
          if (L.base == null) L.base = L.pivot.position.x;
          if (L.slide) L.pivot.position.x = L.base - L.slide * ease; else L.pivot.rotation.y = L.side * ease * 1.45;
          L.pivot.position.y = inst ? MM(500) * (1 - (a.gu ?? 1)) : 0;
        }
      }
    }
    const g = a.augerAt;
    e.auger.visible = !!g;
    if (g) { e.auger.position.set(g.x, g.y, g.z); e.auger.userData.screw.rotation.y = g.spin; }
  }
  _buildLawn(app, r, e) {
    const d = r.done || {}, a = this.anim['L' + r.id] || {}, geo = [r.poly.flat().join(), r.g, r.u].join('|');
    this._part(e, 'ghost', r.id == null ? geo : null, () => lawnGhost(r));
    this._part(e, 'line', r.id != null && !d.grass ? geo : null, () => lawnLine(app, r));
    // (what is round it when the soil goes on: the paths, the pools)
    const near = this.objects.all('path').length + ':' + this.objects.all('pool').length;
    this._part(e, 'body', r.id != null && (d.soil || a.soil != null) ? geo + '|' + (r.how || 'turf') + '|' + near + '|' + (this.objects.get(r.id) ? 1 : 0) : null, () => buildLawn(app, r, e.U));
    if (!e.gear) {
      e.gear = { roll: turfRoll(), roller: roller(), spr: sprinkler() };
      for (const o of Object.values(e.gear)) { o.visible = false; e.g.add(o); }
    }
  }
  // the lawn's uniforms and its tools, from where the work has got
  _lawnFrame(e) {
    const r = e.rec, d = r.done || {}, a = this.anim['L' + r.id] || {}, U = e.U, seed = r.how === 'seed';
    U.uF.value = a.soil ?? (d.soil ? 1e9 : -1e9);
    U.uR.value = a.rake ?? (d.rake ? 1e9 : -1e9);
    U.uK.value = a.roll ?? (d.roll ? 1e9 : -1e9);
    U.uLay.value = a.lay ?? (d.grass && !seed ? 1e9 : -1);
    U.uGrow.value = a.grow ?? (d.grass && seed ? 1 : 0);
    U.uWater.value = a.water ?? (d.water ? 1 : 0);
    U.uWet.value = a.wet ?? 0;
    if (!e.gear) return;
    const put = (o, at) => { o.visible = !!at; if (at) { const [x, z] = frameW(r, at.a, at.b); o.position.set(x, at.y, z); o.rotation.set(0, at.yaw || 0, 0); if (at.s != null) o.scale.set(1, at.s, at.s); } };
    put(e.gear.roll, a.rollAt); put(e.gear.roller, a.rollerAt); put(e.gear.spr, a.sprAt);
  }
  _part(e, name, key, make) {
    if (e.keys[name] === key) return e.sub[name];
    if (e.sub[name]) { e.g.remove(e.sub[name]); dispose(e.sub[name]); }
    e.keys[name] = key;
    const g = key == null ? null : make();
    e.sub[name] = g;
    if (g) { e.g.add(g); g.traverse((o) => { if (o.isMesh && o.userData.uOwner === undefined) o.userData.uOwner = e.rec.id ?? null; }); }
    return g;
  }

  _buildPath(app, r, e) {
    const d = r.done || {}, a = this.anim[r.id] || {}, geo = [r.pts.flat().join(), r.W, r.g].join('|');
    // the ghost while it is drawn
    this._part(e, 'ghost', r.id == null ? geo : null, () => ghost(r));
    // the pegs and the string (until the kerbs are in)
    this._part(e, 'string', r.id != null && !d.kerb ? geo : null, () => strings(r));
    // the kerbs, their bed and haunch
    this._part(e, 'kerb', d.kerb || a.kerb != null ? geo : null, () => kerbMesh(r, e.U));
    this._part(e, 'geo', d.geo || a.geo != null ? geo : null, () => geoMesh(r, e.U));
    if (!e.roll && (a.roll != null)) { e.roll = rollMesh(r); e.g.add(e.roll); }
    this._part(e, 'pave', d.pave || a.pave != null ? geo + '|' + (r.paver || '') + (r.col || '') : null, () => paveMesh(r, e.U));
    this._part(e, 'joint', d.joint || a.joint != null ? geo : null, () => jointMesh(r, e.U));
  }
}

// a point at a chainage (mm): [x, z, ux, uz]
export function pointAt(r, s) {
  const legs = legsOf(r), m = s * S;
  let g = legs[0];
  for (const q of legs) if (m >= q.a0) g = q;
  const [x, z] = legW(g, Math.max(0, Math.min(g.a0 + g.L, m)), 0);
  return [x, z, g.u[0], g.u[1]];
}

function ghost(r) {
  const G = new THREE.Group(), y = r.g + MM(8);
  const m = new THREE.MeshBasicMaterial({ color: 0x7fe08a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const mk = new THREE.MeshBasicMaterial({ color: 0xf2f2ee, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  G.add(new THREE.Mesh(sheets(paveQuads(r).map((p) => ({ p, s: [0, 0, 0, 0] })), y, 1), m));
  const e = MM(PATH.kerbW);
  G.add(new THREE.Mesh(sheets([...bandQuads(r, half(r), half(r) + e), ...bandQuads(r, -half(r) - e, -half(r))].map((p) => ({ p, s: [0, 0, 0, 0] })), y + MM(2), 1), mk));
  G.traverse((o) => { o.renderOrder = 5; });
  return G;
}
// the setting-out: a peg at each corner of the kerbs' outer line, a string between them 100 over the ground
function strings(r) {
  const G = new THREE.Group(), qs = kerbOuter(r), y = r.g, peg = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 });
  const pegGeo = new THREE.BoxGeometry(MM(40), MM(450), MM(40)); pegGeo.translate(0, MM(450 / 2 - 150), 0);
  const ptsL = [qs[0][3], ...qs.map((q) => q[2])], ptsR = [qs[0][0], ...qs.map((q) => q[1])];
  for (const p of [...ptsL, ...ptsR]) { const o = new THREE.Mesh(pegGeo, peg); o.position.set(p[0], y, p[1]); o.castShadow = true; G.add(o); }
  const line = new THREE.LineBasicMaterial({ color: 0xfff3c4 });
  for (const pts of [ptsL, ptsR, [ptsL[0], ptsR[0]], [ptsL.at(-1), ptsR.at(-1)]]) G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, y + MM(100), z))), line));
  return G;
}
// the kerbs (grey concrete, the top's edges chamfered), on a bed of concrete with a haunch behind
function kerbMesh(r, U) {
  const G = new THREE.Group(), g = r.g, K = kerbsOf(r);
  const kerbs = K.map((k, i) => ({ p: k.p, yT: g + MM(TOPS.pave), yB: g - MM(PATH.kerbH), ord: i, s: k.s, rgb: [0.66, 0.66, 0.64] }));
  const km = byCount(new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), normalMap: tex('pool_coat', 'nor.jpg', false), vertexColors: true, roughness: 0.85 }), U.kerb);
  const mk = new THREE.Mesh(prisms(kerbs, MM(8), MM(600)), km); mk.receiveShadow = true; G.add(mk);
  // the bed (100 under the kerbs, 100 wider behind) and the haunch (from 2/3 up the kerb out to 100 behind)
  const h = half(r), kw = MM(PATH.kerbW), hb = MM(PATH.haunch), L = lengthOf(r) / S, legs = legsOf(r), bed = [], ch = MM(1);
  const sOf = (q) => q.map(([x, z]) => { let best = 0, bd = Infinity; for (const gq of legs) { const dx = x - gq.o[0], dz = z - gq.o[1], a = gq.a0 + dx * gq.u[0] + dz * gq.u[1], c = dx * gq.n[0] + dz * gq.n[1], aa = Math.max(gq.a0, Math.min(gq.a0 + gq.L, a)), dd = Math.hypot(aa - a, c); if (dd < bd) bd = dd, best = aa; } return best / S; });
  for (const [c0, c1] of [[h - MM(20), h + kw + hb], [-h - kw - hb, -h + MM(20)]]) for (const q of bandQuads(r, c0, c1)) bed.push({ p: q, yT: g - MM(PATH.kerbH), yB: g - MM(PATH.dig), s: Math.min(...sOf(q)) });
  for (const [c0, c1, inner] of [[h + kw, h + kw + hb, 0], [-h - kw - hb, -h - kw, 1]]) for (const q of bandQuads(r, c0, c1)) {
    const yT = q.map((_, k) => g - MM((k === 0 || k === 1) !== !!inner ? 80 : PATH.kerbH - 5));
    bed.push({ p: q, yT, yB: g - MM(PATH.kerbH), s: Math.min(...sOf(q)) });
  }
  // (the ends: in each end's frame, the bed and a haunch across it)
  for (const [gq, a0, a1, dir] of [[legs[0], -PATH.kerbW - PATH.haunch, 20, -1], [legs.at(-1), L - 20, L + PATH.kerbW + PATH.haunch, 1]]) {
    const cA = -h / S - PATH.kerbW - PATH.haunch, cB = -cA, P = (a, c) => legW(gq, a * S, c * S);
    bed.push({ p: [P(a0, cA), P(a1, cA), P(a1, cB), P(a0, cB)], yT: g - MM(PATH.kerbH), yB: g - MM(PATH.dig), s: dir < 0 ? -2000 : L });
    const e0 = dir < 0 ? -PATH.kerbW - PATH.haunch : L + PATH.kerbW, e1 = e0 + PATH.haunch, q = [P(e0, cA), P(e1, cA), P(e1, cB), P(e0, cB)];
    bed.push({ p: q, yT: q.map((_, k) => g - MM((dir < 0 ? (k === 1 || k === 2) : (k === 0 || k === 3)) ? 80 : PATH.kerbH - 5)), yB: g - MM(PATH.kerbH), s: dir < 0 ? -2000 : L });
  }
  const bm = byFront(new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), color: 0xb9b6ae, roughness: 0.95 }), U.bed);
  const mb = new THREE.Mesh(prisms(bed, ch, MM(800)), bm); mb.receiveShadow = true; G.add(mb);
  return G;
}
function geoMesh(r, U) {
  const g = r.g, legs = legsOf(r), list = paveQuads(r).map((p) => ({ p, s: p.map(([x, z]) => { let best = 0, bd = Infinity; for (const q of legs) { const dx = x - q.o[0], dz = z - q.o[1], a = q.a0 + dx * q.u[0] + dz * q.u[1], c = dx * q.n[0] + dz * q.n[1], aa = Math.max(q.a0, Math.min(q.a0 + q.L, a)), dd = Math.hypot(aa - a, c); if (dd < bd) bd = dd, best = a; } return best / S; }) }));
  const m = byFront(new THREE.MeshStandardMaterial({ map: fabric(), roughness: 0.95, side: THREE.DoubleSide }), U.geo);
  const o = new THREE.Mesh(sheets(list, g + MM(TOPS.geo), MM(1200)), m); o.receiveShadow = true;
  return o;
}
function rollMesh(r) {
  const w = MM(r.W - 20), geo = new THREE.CylinderGeometry(MM(60), MM(60), w, 18); geo.rotateZ(Math.PI / 2);
  const o = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: fabric(), roughness: 0.9 })); o.castShadow = true;
  return o;
}
// the pavers: concrete (the photo of a concrete face), each its own shade; the edges chamfered 4 mm
function paveMesh(r, U) {
  const g = r.g, P = paversOf(r).map((p, i) => ({ p: p.p, yT: g + MM(TOPS.pave), yB: g - MM(PATH.paver), ord: i, rgb: p.rgb.map((v) => Math.min(1, v * 0.95)), s: p.ord }));
  const m = byCount(new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), normalMap: tex('pool_coat', 'nor.jpg', false), vertexColors: true, roughness: 0.88 }), U.pave);
  const o = new THREE.Mesh(prisms(P, MM(4), MM(500)), m); o.receiveShadow = true;
  return o;
}
// the joints filled: a sand-coloured sheet just under the pavers' top (seen only between them)
function jointMesh(r, U) {
  const legs = legsOf(r), list = paveQuads(r).map((p) => ({ p, s: p.map(([x, z]) => { let best = 0, bd = Infinity; for (const q of legs) { const dx = x - q.o[0], dz = z - q.o[1], a = q.a0 + dx * q.u[0] + dz * q.u[1], c = dx * q.n[0] + dz * q.n[1], aa = Math.max(q.a0, Math.min(q.a0 + q.L, a)), dd = Math.hypot(aa - a, c); if (dd < bd) bd = dd, best = a; } return best / S; }) }));
  const m = byFront(new THREE.MeshStandardMaterial({ map: tex('dense_sand', 'diff.jpg', true), color: 0xd8cdb4, roughness: 1, side: THREE.DoubleSide }), U.joint);
  const o = new THREE.Mesh(sheets(list, r.g - MM(7), MM(400)), m); o.receiveShadow = true;
  return o;
}
