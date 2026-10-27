import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE } from '../config.js';
import {
  POOL, MOSAICS, MOSAIC_BY_LETTER, COPES, PW, faces, cellsOf, sheetsOf, sheetRect, faceStr, copeLayout, embeds, wallLines,
  floorTopY, wallH, rimY, waterMax, pitRect, outer, isPoolBelt, PF,
} from './pool.js';

// The pool drawn (pool.js): what is not concrete, reinforcement or boards (those are the
// belts' and the cages' — walls.js, rebar.js): the walers and tie rods of the walls'
// formwork, the waterstop cord, the embedded parts, the coating and its tape, the mosaic,
// the coping, the water (and the hose filling it), the lights. Each part is rebuilt only when
// what it shows changes. The tool's work in progress (a stroke of the brush, the sheets just
// laid) is shown from `live` (a copy of the record) until it is saved.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const TEX = {};
function tex(folder, file, srgb, rep = true) {
  const key = folder + '/' + file;
  if (TEX[key]) return TEX[key];
  const t = new THREE.TextureLoader().load(`assets/textures/${folder}/${file}`);
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[key] = t);
}

// ---- under water: the mosaic, the coats, the parts are seen through it -----------------------
// (tinted the deeper they are, with the caustics of the sun playing over them)
const CAUSTIC = /* glsl */`
float poolCaustic(vec2 p, float t) {
  vec2 q = p; float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += vec2(sin(q.y * 0.83 + t * (0.9 + fi * 0.23) + fi), cos(q.x * 0.91 - t * (0.75 + fi * 0.17) - fi * 1.7));
    c += 1.0 / (1.0 + 18.0 * abs(sin(q.x) * sin(q.y)));
  }
  return c / 3.0;
}`;
export function underwater(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vPW;\nuniform float uWaterY, uTime, uSun, uNightGlow, uLamp;\nuniform vec3 uLampP0, uLampP1, uLampD0, uLampD1;\n${CAUSTIC}`)
      .replace('#include <opaque_fragment>', `
      {
        float dw = uWaterY - vPW.y;
        if (dw > 0.0) {
          // (model metres: 1,5 m of water is 0,143 here)
          float k = 1.0 - exp(-dw * 4.5);
          outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.42, 0.8, 0.86) + vec3(0.004, 0.03, 0.04) * uSun, k);
          float c = poolCaustic((vPW.xz + vec2(0.55, 0.35) * vPW.y) * 230.0, uTime * 1.3);
          outgoingLight *= 1.0 + (smoothstep(0.3, 0.75, c) * 1.5 - 0.1) * uSun * smoothstep(0.0, 0.004, dw) * (1.0 - 0.5 * k);
          outgoingLight += vec3(0.02, 0.09, 0.12) * uNightGlow * (1.0 - k * 0.3);
          // the lights: a cone each across the pool (the walls and the floor lit in a pool of
          // light, softly out to its edge), a halo round the lens
          if (uLamp > 0.001) {
            vec3 d0 = vPW - uLampP0, d1 = vPW - uLampP1;
            float l0 = length(d0), l1 = length(d1);
            float c0 = smoothstep(0.35, 0.9, dot(d0 / max(l0, 1e-5), uLampD0)), c1 = smoothstep(0.35, 0.9, dot(d1 / max(l1, 1e-5), uLampD1));
            float f = c0 * exp(-l0 / 0.22) + c1 * exp(-l1 / 0.22) + 1.6 * (exp(-l0 / 0.012) + exp(-l1 / 0.012));
            outgoingLight += vec3(0.5, 0.85, 1.0) * uLamp * f * 1.4;
          }
        }
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'pool-underwater';
  return mat;
}

// a tileable normal map of small waves (sums of whole-period sines)
let _wn = null;
function waterNormal() {
  if (_wn) return _wn;
  const N = 256, h = new Float32Array(N * N);
  let seed = 3; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves = Array.from({ length: 28 }, () => { const a = r() * Math.PI * 2, f = 1 + Math.floor(r() * 9); return [Math.round(Math.cos(a) * f), Math.round(Math.sin(a) * f), r() * 6.283, 1 / (0.6 + Math.hypot(Math.cos(a) * f, Math.sin(a) * f))]; });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0; for (const [fx, fy, ph, am] of waves) v += Math.sin((fx * x + fy * y) / N * 6.283 + ph) * am; h[y * N + x] = v; }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize(), i = (y * N + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _wn = new THREE.CanvasTexture(c); _wn.wrapS = _wn.wrapT = THREE.RepeatWrapping;
  return _wn;
}
// the tape for the corners: a grey rubber band with white fleece edges
let _tape = null;
function tapeTex() {
  if (_tape) return _tape;
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const e = Math.abs(x - 31.5) / 32, fleece = e > 0.55, n = Math.random() * 18;
    g.fillStyle = fleece ? `rgb(${178 + n * 0.6},${181 + n * 0.6},${184 + n * 0.6})` : `rgb(${96 + n},${104 + n},${114 + n})`;
    g.fillRect(x, y, 1, 1);
  }
  _tape = new THREE.CanvasTexture(c); _tape.wrapS = _tape.wrapT = THREE.RepeatWrapping; _tape.colorSpace = THREE.SRGBColorSpace;
  return _tape;
}
// the drain's grille: slots in white ABS
let _grill = null;
function grillTex() {
  if (_grill) return _grill;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f3f1'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1b1d1f';
  for (let k = 0; k < 9; k++) g.fillRect(18, 16 + k * 11, 92, 5);
  g.strokeStyle = '#d5d7d4'; g.lineWidth = 4; g.strokeRect(4, 4, 120, 120);
  _grill = new THREE.CanvasTexture(c); _grill.colorSpace = THREE.SRGBColorSpace;
  return _grill;
}
// a falling stream of water: streaks running down
let _streak = null;
function streakTex() {
  if (_streak) return _streak;
  const W = 32, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, a = (0.45 + 0.55 * Math.sin(x * 0.9 + Math.sin(y * 0.19) * 2) ** 2) * (0.6 + 0.4 * Math.random());
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  _streak = new THREE.CanvasTexture(c); _streak.wrapS = _streak.wrapT = THREE.RepeatWrapping;
  return _streak;
}

// geometry helpers: frame mm (s, t, y over the slab) → world
const V = (r, s, t, y) => { const [x, z] = PW(r, s, t); return [x, floorTopY(r) + MM(y), z]; };
// a quad (four frame points, counter-clockwise seen from the side it faces), with uvs
function quad(pos, uv, idx, nrm, P, UV, N) {
  const o = pos.length / 3;
  for (let k = 0; k < 4; k++) { pos.push(...P[k]); uv.push(...UV[k]); nrm.push(...N); }
  const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
  const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (c[0] * N[0] + c[1] * N[1] + c[2] * N[2] >= 0) idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
}
// a box in frame mm (s0..s1, t0..t1, y0..y1) as geometry (world)
function fbox(r, s0, t0, s1, t1, y0, y1) {
  const g = new THREE.BoxGeometry(1, 1, 1), m = new THREE.Matrix4(), [x0, z0] = PW(r, 0, 0), [xs, zs] = PW(r, 1000, 0), [xt, zt] = PW(r, 0, 1000);
  const us = new THREE.Vector3((xs - x0) / MM(1000), 0, (zs - z0) / MM(1000)), ut = new THREE.Vector3((xt - x0) / MM(1000), 0, (zt - z0) / MM(1000));
  const c = V(r, (s0 + s1) / 2, (t0 + t1) / 2, (y0 + y1) / 2);
  m.makeBasis(us.multiplyScalar(MM(Math.abs(s1 - s0))), new THREE.Vector3(0, MM(Math.abs(y1 - y0)), 0), ut.multiplyScalar(MM(Math.abs(t1 - t0)))).setPosition(...c);
  return g.applyMatrix4(m);
}
// the basis of a face at (a, b): the point on it (off it by `off` mm into the bowl), along,
// up (its b direction), the normal — as world vectors
function faceBasis(r, F, a, b, off = 0) {
  const p = F.P(a, b), q = F.P(a + 1, b), w = F.P(a, b + 1), w0 = (s, t, y) => new THREE.Vector3(...V(r, s, t, y));
  const P0 = w0(p[0] + F.N[0] * off, p[1] + F.N[1] * off, p[2] + F.N[2] * off);
  const A = w0(...q).sub(w0(...p)).normalize(), B = w0(...w).sub(w0(...p)).normalize();
  const [nx, nz] = PW(r, F.N[0], F.N[1]), [ox, oz] = PW(r, 0, 0), N = new THREE.Vector3(nx - ox, 0, nz - oz).multiplyScalar(1 / S);
  N.y = F.N[2]; N.normalize();
  if (new THREE.Vector3().crossVectors(A, B).dot(N) < 0) A.negate();
  return { P0, A, B, N };
}

export class PoolView {
  constructor(objects) {
    this.objects = objects;
    this.group = new THREE.Group(); this.group.name = 'pools';
    this.parts = new Map();   // pool id → { key per part, groups }
    this.live = null;          // the tool's copy of a pool being worked (or a new one: id null)
    this.fillAt = null;        // the hose: { id, on } while water runs in
    this.U = { uWaterY: { value: -1e9 }, uTime: { value: 0 }, uSun: { value: 1 }, uNightGlow: { value: 0 }, uLamp: { value: 0 }, uLampP0: { value: new THREE.Vector3(0, -1e3, 0) }, uLampP1: { value: new THREE.Vector3(0, -1e3, 0) }, uLampD0: { value: new THREE.Vector3(0, 0, 1) }, uLampD1: { value: new THREE.Vector3(0, 0, 1) } };
    this.dirty = true;
    objects.on((id, rec) => { if (rec?.type === 'pool' || isPoolBelt(rec) || rec?.poolId != null || this.parts.has(id) || this._belts?.has(id)) this.dirty = true; });
  }
  setLive(l) { this.live = l; this.dirty = true; }

  update(dt, app) {
    const U = this.U;
    U.uTime.value += dt;
    // the measuring tape (on demand): the pit's sizes and how deep it is now, read twice a second
    if ((this._mT = (this._mT || 0) + dt) > 0.5) {
      this._mT = 0;
      const on = !!app.settings.poolMeasure, t = app.terrain;
      for (const e of this.parts.values()) {
        const r = e.rec; if (r.id == null) continue;
        const [cx, cz] = PW(r, r.L / 2, r.W / 2), d = on ? Math.round((r.g - t.heightAt(cx, cz)) / (1 / 1000 / MODEL_SCALE) / 10) * 10 : null;
        this._part(e, 'measure', on ? [r.o, r.L, r.W, d].join() : null, () => (on ? measure(r, d) : null));
      }
    }
    const sky = app.sky, night = sky?.night ?? 0;
    U.uSun.value = (1 - night) * (1 - 0.7 * (sky?.over ?? 0));
    if (this.dirty) this._build(app);
    // the water (each pool its own level: the uniforms are per pool group)
    for (const e of this.parts.values()) {
      const r = e.rec;
      if (e.U) {
        e.U.uTime.value = U.uTime.value; e.U.uSun.value = U.uSun.value;
        const glow = r.light ? night : 0;
        e.U.uNightGlow.value = glow;
        if (e.water) { e.water.material.userData.U.uTime.value = U.uTime.value; e.water.material.userData.U.uGlow.value = glow; }
        // (on: by day the beams show faintly in the water, by night they light it)
        const lamp = r.light ? 0.35 + 0.65 * night : 0;
        e.U.uLamp.value = lamp;
        if (e.water) e.water.material.userData.U.uGlow.value = Math.max(glow * 0.4, lamp * 0.12);
        for (const L of e.lights || []) L.intensity = 0.06 * glow;
        if (e.lights?.length) { e.U.uLampP0.value.copy(e.lights[0].position); e.U.uLampD0.value.copy(e.lights[0].target.position).sub(e.lights[0].position).normalize(); const L1 = e.lights[1] || e.lights[0]; e.U.uLampP1.value.copy(L1.position); e.U.uLampD1.value.copy(L1.target.position).sub(L1.position).normalize(); }
        if (e.lens) e.lens.material.emissiveIntensity = r.light ? 1.2 + 4 * night : 0.2;
      }
      if (e.stream) {
        const on = this.fillAt?.id === r.id && this.fillAt.on;
        e.stream.visible = on; e.hose.visible = on || (this.fillAt?.id === r.id && this.fillAt.show);
        e.stream.material.map.offset.y -= dt * 3.5;
        if (e.water) e.water.material.userData.U.uHit.value.z = on ? 1 : Math.max(0, e.water.material.userData.U.uHit.value.z - dt * 2);
      }
    }
  }

  _build(app) {
    this.dirty = false;
    const recs = this.objects.all('pool'), live = this.live;
    const list = recs.map((r) => (live && live.id === r.id ? live : r));
    if (live && live.id == null) list.push(live);
    this._belts = new Set();
    const seen = new Set();
    for (const r of list) {
      const key = r.id ?? 'new';
      seen.add(key);
      let e = this.parts.get(key);
      if (!e) { e = { g: new THREE.Group(), keys: {}, sub: {} }; this.group.add(e.g); this.parts.set(key, e); }
      e.rec = r;
      this._buildPool(app, r, e);
    }
    for (const [k, e] of [...this.parts]) if (!seen.has(k)) { this.group.remove(e.g); dispose(e.g); this.parts.delete(k); }
  }

  // each part: rebuilt when its key changes
  _part(e, name, key, make) {
    if (e.keys[name] === key) return e.sub[name];
    if (e.sub[name]) { e.g.remove(e.sub[name]); dispose(e.sub[name]); }
    e.keys[name] = key;
    const g = make();
    e.sub[name] = g;
    if (g) { e.g.add(g); g.traverse((o) => { if (o.isMesh && o.userData.uOwner === undefined) o.userData.uOwner = e.rec.id ?? null; }); }
    return g;
  }

  _buildPool(app, r, e) {
    const O = this.objects, fb = r.floor != null ? O.get(r.floor) : null, wb = r.wall != null ? O.get(r.wall) : null;
    if (fb) this._belts.add(fb.id); if (wb) this._belts.add(wb.id);
    const geo = [r.o, r.u, r.L, r.W, r.ft, r.hw].join();
    // the uniforms of this pool (the water's level)
    if (!e.U) e.U = { uWaterY: { value: -1e9 }, uTime: { value: 0 }, uSun: { value: 1 }, uNightGlow: { value: 0 }, uLamp: { value: 0 }, uLampP0: { value: new THREE.Vector3(0, -1e3, 0) }, uLampP1: { value: new THREE.Vector3(0, -1e3, 0) }, uLampD0: { value: new THREE.Vector3(0, 0, 1) }, uLampD1: { value: new THREE.Vector3(0, 0, 1) } };
    e.U.uWaterY.value = r.water > 1 ? floorTopY(r) + MM(r.water) : -1e9;
    // the ghost while it is set out (no id yet): the water's volume, the pit's outline
    this._part(e, 'ghost', r.id == null ? geo : null, () => (r.id == null ? ghost(r) : null));
    // the walls' formwork: walers and tie rods (until the boards are off)
    this._part(e, 'form', wb && !wb.stripped ? geo + ':' + wb.id : null, () => (wb && !wb.stripped ? formwork(r) : null));
    // the waterstop on the slab (with the walls' cage), seen until the walls are cast
    const cage2 = r.cage2 != null && O.get(r.cage2);
    this._part(e, 'cord', cage2 ? geo : null, () => (cage2 ? cord(r) : null));
    // the embedded parts (with the walls' formwork)
    this._part(e, 'embeds', wb ? geo : null, () => { if (!wb) return null; const g = buildEmbeds(r, e.U); e.lens = g.userData.lens; e.lights = g.userData.lights; return g; });
    // the coating and the tape
    const pk = (r.proof || []).join('|');
    this._part(e, 'proof', pk.replace(/[0|]/g, '') ? geo + pk : null, () => (pk.replace(/[0|]/g, '') ? buildProof(r, e.U) : null));
    // the mosaic
    const tk = (r.tile || []).join('|');
    this._part(e, 'tile', tk.replace(/[0|]/g, '') ? geo + tk : null, () => (tk.replace(/[0|]/g, '') ? buildMosaic(r, e.U) : null));
    // the coping
    const ck = (r.cope || []).join('|') + ':' + (r.copeCol || 'trav');
    this._part(e, 'cope', (r.cope || []).some((q) => q.includes('1')) ? geo + ck : null, () => buildCoping(r));
    // the water and the hose
    const w = this._part(e, 'water', wb ? geo : null, () => (wb ? buildWater(r) : null));
    e.water = w?.userData.water || null; e.stream = w?.userData.stream || null; e.hose = w?.userData.hose || null;
    if (e.water) {
      const lv = Math.max(0, Math.min(waterMax(r), r.water || 0));
      e.water.visible = lv > 1;
      e.water.position.y = floorTopY(r) + MM(lv);
      if (e.stream) { const top = e.stream.userData.top; e.stream.scale.y = Math.max(1e-4, top - e.water.position.y + (lv > 1 ? 0 : -MM(8))); e.stream.position.y = top; }
    }
  }
}

function dispose(g) { g?.traverse((o) => { if (o.isMesh || o.isLine) o.geometry?.dispose(); }); }

// ---- the parts --------------------------------------------------------------------------------
// a label (canvas sprite) over the plot
function label(text, h) {
  const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 512; c.height = 128;
  g.fillStyle = 'rgba(20,22,26,0.82)'; g.beginPath(); g.roundRect(4, 14, 504, 100, 30); g.fill();
  g.fillStyle = '#ffd24a'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  sp.scale.set(h * 4, h, 1); sp.renderOrder = 20; sp.userData.noPick = true;
  return sp;
}
// the measuring tape along the pit's sides and down into it; its sizes and its depth now
function measure(r, depth) {
  const g = new THREE.Group(), [s0, t0, s1, t1] = pitRect(r), y = r.g + MM(60), mat = new THREE.LineBasicMaterial({ color: 0xffd24a, depthTest: false });
  const P = (s, t, yy = y) => { const [x, z] = PW(r, s, t); return new THREE.Vector3(x, yy, z); };
  const line = (a, b) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat); l.renderOrder = 19; l.userData.noPick = true; g.add(l); };
  line(P(s0, t0 - 250), P(s1, t0 - 250)); line(P(s0 - 250, t0), P(s0 - 250, t1));
  const yd = r.g - MM(depth || 0); line(P((s0 + s1) / 2, (t0 + t1) / 2), P((s0 + s1) / 2, (t0 + t1) / 2, yd));
  const h = MM(650);
  const a = label(`${((s1 - s0) / 1000).toFixed(2)} м`.replace('.', ','), h); a.position.copy(P((s0 + s1) / 2, t0 - 600, y + MM(200))); g.add(a);
  const b = label(`${((t1 - t0) / 1000).toFixed(2)} м`.replace('.', ','), h); b.position.copy(P(s0 - 600, (t0 + t1) / 2, y + MM(200))); g.add(b);
  const c = label(`глуб. ${((depth || 0) / 1000).toFixed(2)} м`.replace('.', ','), h); c.position.copy(P((s0 + s1) / 2, (t0 + t1) / 2, y + MM(400))); g.add(c);
  return g;
}

function ghost(r) {
  const g = new THREE.Group(), [s0, t0, s1, t1] = pitRect(r), H = wallH(r), wl = waterMax(r);
  const water = new THREE.Mesh(fbox(r, 0, 0, r.L, r.W, 0, wl), new THREE.MeshBasicMaterial({ color: 0x39a8e6, transparent: true, opacity: 0.35, depthWrite: false }));
  const bowl = new THREE.Mesh(fbox(r, ...outer(r).slice(0, 2), ...outer(r).slice(2), 0, H), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.12, depthWrite: false }));
  const pts = [[s0, t0], [s1, t0], [s1, t1], [s0, t1], [s0, t0]].map(([s, t]) => { const [x, z] = PW(r, s, t); return new THREE.Vector3(x, r.g + MM(30), z); });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd24a }));
  water.userData.noPick = bowl.userData.noPick = true;
  g.add(water, bowl, line);
  return g;
}

// the walls' formwork beyond the boards (walls.js): 50 × 100 walers on both faces at three
// heights, tie rods through the wall every 750 with plates and nuts outside the walers
let _woodM = null, _steelM = null;
const woodMat = () => _woodM || (_woodM = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.85 }));
const steelMat = () => _steelM || (_steelM = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.5, metalness: 0.7 }));
function formwork(r) {
  const H = wallH(r), T = POOL.T, wood = [], steel = [], L = r.L, W = r.W;
  const ys = [300, 800, 1300].filter((y) => y < H - 100);
  for (const y of ys) {
    const y0 = y - 50, y1 = y + 50, e = T + 150;
    // outside: round the bowl, crossing at the corners
    wood.push(fbox(r, -e, -T - 115, L + e, -T - 65, y0, y1), fbox(r, -e, W + T + 65, L + e, W + T + 115, y0, y1));
    wood.push(fbox(r, -T - 115, -e, -T - 65, W + e, y0 + 100, y1 + 100), fbox(r, L + T + 65, -e, L + T + 115, W + e, y0 + 100, y1 + 100));
    // inside: each wall's own, short of the corners
    wood.push(fbox(r, 120, 65, L - 120, 115, y0, y1), fbox(r, 120, W - 115, L - 120, W - 65, y0, y1));
    wood.push(fbox(r, 65, 120, 115, W - 120, y0, y1), fbox(r, L - 115, 120, L - 65, W - 120, y0, y1));
  }
  // the tie rods: across each wall, out past both walers, a plate and a nut at each end
  for (const y of ys) {
    for (const [len, at] of [[L, (k) => [k, -T / 2, 0]], [L, (k) => [k, W + T / 2, 0]], [W, (k) => [-T / 2, k, 1]], [W, (k) => [L + T / 2, k, 1]]]) {
      for (let k = 375; k < len - 200; k += 750) {
        const [s, t, ac] = at(k), half = T / 2 + 150;
        if (ac) { steel.push(fbox(r, s - half, t - 7, s + half, t + 7, y + 55, y + 69)); for (const sg of [-1, 1]) steel.push(fbox(r, s + sg * (T / 2 + 118) - 4, t - 45, s + sg * (T / 2 + 118) + 4, t + 45, y + 17, y + 107)); }
        else { steel.push(fbox(r, s - 7, t - half, s + 7, t + half, y + 55, y + 69)); for (const sg of [-1, 1]) steel.push(fbox(r, s - 45, t + sg * (T / 2 + 118) - 4, s + 45, t + sg * (T / 2 + 118) + 4, y + 17, y + 107)); }
      }
    }
  }
  const g = new THREE.Group(), mw = new THREE.Mesh(mergeGeometries(wood), woodMat()), ms = new THREE.Mesh(mergeGeometries(steel), steelMat());
  mw.castShadow = mw.receiveShadow = ms.castShadow = true;
  g.add(mw, ms);
  return g;
}

// the waterstop: a bentonite cord 20 × 25 on the slab along the middle of the walls
function cord(r) {
  const T = POOL.T, L = r.L, W = r.W, c = -T / 2, list = [
    fbox(r, c - 10, c - 12, L - c + 10, c + 12, 0, 20), fbox(r, c - 10, W - c - 12, L - c + 10, W - c + 12, 0, 20),
    fbox(r, c - 12, c, c + 12, W - c, 0, 20), fbox(r, L - c - 12, c, L - c + 12, W - c, 0, 20),
  ];
  const m = new THREE.Mesh(mergeGeometries(list), new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }));
  m.receiveShadow = true;
  return m;
}

// the embedded parts, white ABS, set flush with the finished surface (10 mm off the concrete)
function buildEmbeds(r, U) {
  const F = faces(r), E = embeds(r), white = [], dark = [], glass = [], grill = [], g = new THREE.Group(), lights = [];
  const put = (list, geo, f, a, b, off) => { const B = faceBasis(r, F[f], a, b, off); const m = new THREE.Matrix4().makeBasis(B.A, B.B, B.N).setPosition(B.P0); const g = geo.index ? geo.toNonIndexed() : geo.clone(); list.push(g.applyMatrix4(m)); return B; };
  const ring = (R0, R1, d) => { const sh = new THREE.Shape(); sh.absarc(0, 0, MM(R1), 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, MM(R0), 0, Math.PI * 2, true); sh.holes.push(h); return new THREE.ExtrudeGeometry(sh, { depth: MM(d), bevelEnabled: false, curveSegments: 28 }); };
  const disc = (R, d) => new THREE.CylinderGeometry(MM(R), MM(R), MM(d), 28).rotateX(Math.PI / 2).translate(0, 0, MM(d / 2));
  const box = (w, h, d, z = 0) => new THREE.BoxGeometry(MM(w), MM(h), MM(d)).translate(0, 0, MM(z + d / 2));
  // the skimmers: a square flange round the mouth, the mouth dark, the weir flap
  for (const s of E.skim) {
    // (a U round the mouth: its top is the wall's top, under the coping)
    const fr = new THREE.Shape(), w2 = s.w / 2, h2 = s.h / 2, F2 = w2 + 40;
    [[-F2, -h2 - 40], [F2, -h2 - 40], [F2, h2], [w2, h2], [w2, -h2], [-w2, -h2], [-w2, h2], [-F2, h2]].forEach(([x, y], k) => (k ? fr.lineTo(MM(x), MM(y)) : fr.moveTo(MM(x), MM(y))));
    put(white, new THREE.ExtrudeGeometry(fr, { depth: MM(12), bevelEnabled: false }), s.face, s.a, s.b, 0);
    put(dark, box(s.w, s.h, 4, -200), s.face, s.a, s.b, 0);
    for (const sg of [-1, 1]) put(dark, box(4, s.h, 200, -200).translate(sg * MM(s.w / 2), 0, 0), s.face, s.a, s.b, 0);
    put(dark, box(s.w, 4, 200, -200).translate(0, MM(s.h / 2), 0), s.face, s.a, s.b, 0);
    put(dark, box(s.w, 4, 200, -200).translate(0, -MM(s.h / 2), 0), s.face, s.a, s.b, 0);
    put(white, box(s.w - 10, s.h * 0.55, 6, -40).translate(0, -MM(s.h * 0.2), 0), s.face, s.a, s.b, 0);   // (the flap)
  }
  // the inlets: a flange, the eyeball and its jet
  for (const s of E.inlet) {
    put(white, ring(18, 52, 10), s.face, s.a, s.b, 0);
    put(white, new THREE.SphereGeometry(MM(26), 18, 12).scale(1, 1, 0.6).translate(0, 0, MM(8)), s.face, s.a, s.b, 0);
    put(dark, disc(9, 3).translate(0, 0, MM(22)), s.face, s.a, s.b, 0);
  }
  // the lights: a ring Ø 290, the glass; a spot under water, across the pool
  for (const s of E.light) {
    put(white, ring(112, 145, 14), s.face, s.a, s.b, 0);
    const B = put(glass, disc(112, 10), s.face, s.a, s.b, 0);
    const L = new THREE.SpotLight(0xbfe9ff, 0, MM(r.W * 1.6), 0.95, 0.6, 1.2);
    L.position.copy(B.P0).addScaledVector(B.N, MM(30));
    L.target.position.copy(B.P0).addScaledVector(B.N, MM(1500)).addScaledVector(B.B, MM(-300));
    g.add(L, L.target); lights.push(L);
  }
  // the main drain: a square grille on the floor
  for (const s of E.drain) put(grill, box(250, 250, 10), s.face, s.a, s.b, 0);
  const mW = underwater(new THREE.MeshStandardMaterial({ color: 0xf4f5f2, roughness: 0.35 }), U);
  const mD = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });
  const mG = new THREE.MeshStandardMaterial({ color: 0xe8f6ff, roughness: 0.08, metalness: 0.1, emissive: 0xbfe9ff, emissiveIntensity: 0.2 });
  const mGr = underwater(new THREE.MeshStandardMaterial({ map: grillTex(), roughness: 0.4 }), U);
  for (const [list, m] of [[white, mW], [dark, mD], [glass, mG], [grill, mGr]]) { if (!list.length) continue; const mesh = new THREE.Mesh(mergeGeometries(list), m); mesh.receiveShadow = true; g.add(mesh); if (m === mG) g.userData.lens = mesh; }
  g.userData.lights = lights;
  return g;
}

// the coating: a skin over each inner face (2 mm off the concrete), its value per vertex the
// coats of the cells round it; it runs out in a ragged brushed edge
function buildProof(r, U) {
  const F = faces(r), C = POOL.cell, pos = [], uv = [], nrm = [], coat = [], idx = [];
  for (const f of F) {
    const [ni, nj] = cellsOf(f), str = faceStr(r.proof, f.k, ni * nj);
    if (!/[12]/.test(str)) continue;
    const v = (i, j) => { let s = 0, n = 0; for (const [a, b] of [[i, j], [i - 1, j], [i, j - 1], [i - 1, j - 1]]) { if (a < 0 || b < 0 || a >= ni || b >= nj) continue; s += +str[b * ni + a]; n++; } return n ? s / n : 0; };
    const o = pos.length / 3;
    for (let j = 0; j <= nj; j++) for (let i = 0; i <= ni; i++) {
      const a = Math.min(f.len[0], i * C), b = Math.min(f.len[1], j * C), p = f.P(a, b);
      pos.push(...V(r, p[0] + f.N[0] * 2, p[1] + f.N[1] * 2, p[2] + f.N[2] * 2));
      const [x, z] = PW(r, f.N[0], f.N[1]), [x0, z0] = PW(r, 0, 0), l = Math.hypot(x - x0, z - z0) || 1;
      nrm.push(f.k === 0 ? 0 : (x - x0) / l, f.k === 0 ? 1 : 0, f.k === 0 ? 0 : (z - z0) / l);
      uv.push(a / 900 + f.k * 0.37, b / 900); coat.push(v(i, j));
    }
    // (which way the grid's triangles face: against the normal — the other winding)
    const q0 = pos.slice(o * 3, o * 3 + 3), q1 = pos.slice((o + 1) * 3, (o + 1) * 3 + 3), q2 = pos.slice((o + ni + 2) * 3, (o + ni + 2) * 3 + 3), nn = nrm.slice(o * 3, o * 3 + 3);
    const e1 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]], e2 = [q2[0] - q0[0], q2[1] - q0[1], q2[2] - q0[2]];
    const flip = (e1[1] * e2[2] - e1[2] * e2[1]) * nn[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * nn[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * nn[2] < 0;
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const c0 = +str[j * ni + i];
      // (only where it is painted or beside it)
      if (!c0 && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => { const a = i + di, b = j + dj; return a >= 0 && b >= 0 && a < ni && b < nj && +str[b * ni + a]; })) continue;
      const k = o + j * (ni + 1) + i;
      if (flip) idx.push(k, k + ni + 2, k + 1, k, k + ni + 1, k + ni + 2); else idx.push(k, k + 1, k + ni + 2, k, k + ni + 2, k + ni + 1);
    }
  }
  const g = new THREE.Group();
  if (idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aCoat', new THREE.Float32BufferAttribute(coat, 1));
    geo.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({ map: tex('pool_coat', 'col.jpg', true), normalMap: tex('pool_coat', 'nor.jpg', false), roughness: 0.82, side: THREE.DoubleSide });
    underwater(m, U);
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh) => {
      base(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCoat;\nvarying float vCoat;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoat = aCoat;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCoat;')
        .replace('#include <map_fragment>', `
          vec4 tc = texture2D(map, vMapUv);
          // (a ragged brushed edge: where the coats thin out the concrete shows through —
          // value noise in streaks along the brush)
          vec2 q = vMapUv * vec2(16.0, 7.0);
          vec2 qi = floor(q), qf = fract(q); qf = qf * qf * (3.0 - 2.0 * qf);
          float h00 = fract(sin(dot(qi, vec2(12.9898, 78.233))) * 43758.5), h10 = fract(sin(dot(qi + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5);
          float h01 = fract(sin(dot(qi + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5), h11 = fract(sin(dot(qi + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5);
          float nz = mix(mix(h00, h10, qf.x), mix(h01, h11, qf.x), qf.y);
          float c = vCoat;
          if (c < 0.25 + 0.5 * nz) discard;
          // (the first coat light grey, the second a darker blue-grey; over the edge of the
          // second the first shows)
          float two = smoothstep(1.05 + 0.5 * nz, 1.35 + 0.5 * nz, c);
          vec3 c1 = vec3(0.46, 0.46, 0.45), c2 = vec3(0.29, 0.33, 0.38);
          diffuseColor.rgb *= tc.rgb * mix(c1, c2, two);`);
    };
    m.customProgramCacheKey = () => 'pool-coat';
    const mesh = new THREE.Mesh(geo, m);
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  // the tape in the corners: where the first coat is on both faces beside it
  const tg = [], half = 60;
  const coatAt = (f, i, j) => { const [ni, nj] = cellsOf(f); if (i < 0 || j < 0 || i >= ni || j >= nj) return 0; return +faceStr(r.proof, f.k, ni * nj)[j * ni + i]; };
  const H = wallH(r);
  for (const f of F.slice(1)) {
    const [ni] = cellsOf(f);
    // along the floor
    for (let i = 0; i < ni; i++) {
      if (!coatAt(f, i, 0)) continue;
      const a0 = i * POOL.cell, a1 = Math.min(f.len[0], a0 + POOL.cell);
      const p00 = f.P(a0, 0), p10 = f.P(a1, 0), up0 = f.P(a0, half), up1 = f.P(a1, half);
      const fl = (p) => [p[0] + f.N[0] * half, p[1] + f.N[1] * half, 0];
      tg.push([p00, p10, up1, up0, f.N, 3], [fl(p00), fl(p10), p10, p00, [0, 0, 1], 3]);
    }
    // up the corner at its end (a = len) — the next face's start
    for (let j = 0; j * POOL.cell < H; j++) {
      if (!coatAt(f, ni - 1, j)) continue;
      const b0 = j * POOL.cell, b1 = Math.min(H, b0 + POOL.cell), L = f.len[0];
      const nx = F[f.k % 4 + 1];
      const a = f.P(L, b0), b = f.P(L, b1), a2 = f.P(L - half, b0), b2 = f.P(L - half, b1), c = nx.P(half, b0), d = nx.P(half, b1);
      tg.push([a2, a, b, b2, f.N, 3], [a, c, d, b, nx.N, 3]);
    }
  }
  if (tg.length) {
    const pos2 = [], uv2 = [], n2 = [], idx2 = [];
    for (const [p0, p1, p2, p3, N, off] of tg) {
      const P = [p0, p1, p2, p3].map((p) => V(r, p[0] + N[0] * off, p[1] + N[1] * off, p[2] + N[2] * off));
      const [x, z] = PW(r, N[0], N[1]), [x0, z0] = PW(r, 0, 0), l = Math.hypot(x - x0, z - z0) || 1;
      quad(pos2, uv2, idx2, n2, P, [[0, 0], [0, 1], [1, 1], [1, 0]].map(([u, v]) => [u * 0.5 + (N[2] ? 0.5 : 0), v * 0.4]), N[2] ? [0, 1, 0] : [(x - x0) / l, 0, (z - z0) / l]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(n2, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv2, 2)); geo.setIndex(idx2);
    const m = underwater(new THREE.MeshStandardMaterial({ map: tapeTex(), roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }), U);
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; g.add(mesh);
  }
  return g;
}

// the mosaic: the sheets laid (8 mm off the concrete: the coats, the glue, the glass), the
// chips and the joints from the photo (CC0), the texture's chips on the sheet's grid
function mosaicMat(key, U) {
  const [, folder, n] = MOSAICS[key];
  const m = new THREE.MeshStandardMaterial({ map: tex(folder, 'col.jpg', true), normalMap: tex(folder, 'nor.jpg', false), roughnessMap: tex(folder, 'rough.jpg', false), roughness: 0.6, metalness: 0, envMapIntensity: 0.9, normalScale: new THREE.Vector2(0.8, 0.8) });
  m.userData.period = n * POOL.sheet / 12;
  return underwater(m, U);
}
export function buildMosaic(r, U) {
  const F = faces(r), by = new Map(), off = 8;
  for (const f of F) {
    const [ni, nj] = sheetsOf(f), str = faceStr(r.tile, f.k, ni * nj);
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const ch = str[j * ni + i];
      if (ch === '0') continue;
      const key = MOSAIC_BY_LETTER[ch] || 'turq';
      if (!by.has(key)) by.set(key, { pos: [], uv: [], nrm: [], idx: [] });
      const B = by.get(key), per = MOSAICS[key][2] * POOL.sheet / 12;
      const [a0, b0, a1, b1] = sheetRect(f, i, j);
      // (the walls' sheets run down 8 mm onto the floor's: the corner closed)
      const P = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b]) => { const p = f.P(a, b); return V(r, p[0] + f.N[0] * off, p[1] + f.N[1] * off, p[2] + f.N[2] * off); });
      const [x, z] = PW(r, f.N[0], f.N[1]), [x0, z0] = PW(r, 0, 0), l = Math.hypot(x - x0, z - z0) || 1;
      // uv: the wall from its top down (the full sheets meet the coping), the floor from its corner
      const vb = (b) => (f.k === 0 ? b : b - f.len[1]) / per;
      quad(B.pos, B.uv, B.idx, B.nrm, P, [[a0 / per, vb(b0)], [a1 / per, vb(b0)], [a1 / per, vb(b1)], [a0 / per, vb(b1)]], f.k === 0 ? [0, 1, 0] : [(x - x0) / l, 0, (z - z0) / l]);
    }
  }
  const g = new THREE.Group();
  for (const [key, B] of by) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2)); geo.setIndex(B.idx);
    const mesh = new THREE.Mesh(geo, mosaicMat(key, U));
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

// the coping: stones 40 thick on 10 of glue on the walls' top, bullnosed on the water's side
// (a half round), 4 mm joints; travertine with its veins running along each stone (each from
// another place in the slab), or porcelain
export function buildCoping(r, only = null) {
  const lay = copeLayout(r), top = (rimY(r) - floorTopY(r)) / S, th = POOL.cope, R = th / 2, geos = [];
  let seed = 17; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // the profile across (c: from the water's edge out), up from the stone's bottom
  const prof = [];
  for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 - k / 10 * Math.PI; prof.push([R + Math.cos(a) * R, R + Math.sin(a) * R]); }
  for (const sd of lay) {
    const str = faceStr(r.cope, sd.side, sd.n);
    for (const st of sd.list) {
      if (str[st.i] !== '1') continue;
      const c0 = st.c0, c1 = st.c1, ox = rnd() * 3000, oy = rnd() * 3000, tint = 0.8 + rnd() * 0.1;
      if (only && !only.has(sd.side + ':' + st.i)) continue;   // (one stone on its own: as it will be drawn)
      // the section: the bullnose (from its bottom round to its top), then back along the top
      // and down the back (c1)
      const sec = [...prof.map(([c, y]) => [c0 + c, y]).reverse(), [c1, 0], [c1, th]];
      const pos = [], uv = [], col = [], idx = [];
      const W3 = (a, c, y) => { const [s, t] = sd.P(a, c); return V(r, s, t, top - th + y); };
      const n = sec.length;
      for (const a of [st.a0, st.a1]) for (const [c, y] of sec) { pos.push(...W3(a, c, y)); uv.push((a + ox) / 1000, (c + y * 1.5 + oy) / 1000); col.push(tint, tint, tint * 0.99); }
      for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; idx.push(k, n + k2, n + k, k, k2, n + k2); }
      // the ends
      const cap = (o, flip) => { const c0i = pos.length / 3; for (let k = 0; k < n; k++) { pos.push(pos[(o + k) * 3], pos[(o + k) * 3 + 1], pos[(o + k) * 3 + 2]); uv.push(uv[(o + k) * 2] + 0.3, uv[(o + k) * 2 + 1]); col.push(tint, tint, tint); } for (let k = 1; k + 1 < n; k++) idx.push(...(flip ? [c0i, c0i + k, c0i + k + 1] : [c0i, c0i + k + 1, c0i + k])); };
      cap(0, false); cap(n, true);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      geos.push(g.toNonIndexed());
    }
  }
  if (!geos.length) return null;
  const geo = mergeGeometries(geos); geo.computeVertexNormals();
  const ck = r.copeCol || 'trav', trav = ck === 'trav';
  const m = new THREE.MeshStandardMaterial(trav
    ? { map: tex('travertine', 'col.jpg', true), normalMap: tex('travertine', 'nor.jpg', false), roughnessMap: tex('travertine', 'rough.jpg', false), roughness: 0.75, vertexColors: true }
    : { map: tex('pool_coat', 'col.jpg', true), normalMap: tex('pool_coat', 'nor.jpg', false), color: COPES[ck][1], roughness: 0.6, vertexColors: true });
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// the water: a surface at its level over the whole bowl (in to the mosaic), its small waves
// two normal maps drifting across each other, rings where the hose's stream falls in; clear
// and tinted where looked down into, a mirror of the sky at a glancing angle. The garden hose
// over the coping and its stream (shown while filling).
function buildWater(r) {
  const g = new THREE.Group(), e = 8, L = r.L, W = r.W;
  const geo = new THREE.PlaneGeometry(MM(L - 2 * e), MM(W - 2 * e), 1, 1).rotateX(-Math.PI / 2);
  const [cx, cz] = PW(r, L / 2, W / 2), yaw = Math.atan2(-r.u[1], r.u[0]);
  geo.rotateY(yaw); geo.translate(cx, 0, cz);
  // world-scaled uvs: a wave pattern ~1,2 m across
  const P = geo.attributes.position, uv = geo.attributes.uv;
  for (let k = 0; k < P.count; k++) uv.setXY(k, P.getX(k) / MM(1200), P.getZ(k) / MM(1200));
  const WU = { uTime: { value: 0 }, uHit: { value: new THREE.Vector3(0, 0, 0) }, uGlow: { value: 0 } };
  const m = new THREE.MeshStandardMaterial({ color: 0x0e5f6e, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.5, normalMap: waterNormal(), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.6, depthWrite: false });
  m.userData.U = WU;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;').replace('#include <project_vertex>', '#include <project_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;\nuniform float uTime, uGlow;\nuniform vec3 uHit;')
      .replace('#include <normal_fragment_maps>', `
        vec3 n1 = texture2D(normalMap, vNormalMapUv + vec2(uTime * 0.021, uTime * 0.013)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, vNormalMapUv * 1.83 + vec2(-uTime * 0.017, uTime * 0.026)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
        mapN.xy *= normalScale;
        // the rings where the stream falls in
        if (uHit.z > 0.0) { vec2 dv = vPW.xz - uHit.xy; float d = length(dv); float w = sin(d * 1400.0 - uTime * 14.0) * exp(-d * 55.0) * uHit.z; mapN.xy += dv / max(d, 1e-5) * w * 0.5; }
        normal = normalize(tbn * mapN);`)
      .replace('#include <opaque_fragment>', `
        float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 4.0);
        diffuseColor.a = mix(0.38, 0.96, fr);
        outgoingLight += vec3(0.03, 0.22, 0.27) * uGlow;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'pool-water';
  const water = new THREE.Mesh(geo, m);
  water.renderOrder = 4; water.userData.noPick = true;
  g.add(water);
  g.userData.water = water;
  // the hose: from the deck beside the near side, over the coping, down inside
  const yR = rimY(r), [hx0, hz0] = PW(r, L * 0.62, -1800), [hx1, hz1] = PW(r, L * 0.6, -400), [hx2, hz2] = PW(r, L * 0.6, -60), [hx3, hz3] = PW(r, L * 0.6, 140);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(hx0, r.g + MM(15), hz0), new THREE.Vector3(hx1, yR + MM(18), hz1), new THREE.Vector3(hx2, yR + MM(30), hz2), new THREE.Vector3(hx3, yR - MM(120), hz3)]);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, MM(13), 8, false), new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.45 }));
  hose.castShadow = true; hose.visible = false; hose.userData.noPick = true;
  g.add(hose); g.userData.hose = hose;
  const sm = new THREE.MeshStandardMaterial({ color: 0xdff4ff, map: streakTex(), transparent: true, opacity: 0.75, roughness: 0.1, depthWrite: false });
  sm.map.repeat.set(1, 3);
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(MM(10), MM(13), 1, 10, 1, true).translate(0, -0.5, 0), sm);
  stream.position.set(hx3, yR - MM(120), hz3); stream.userData.top = yR - MM(120); stream.visible = false; stream.userData.noPick = true;
  g.add(stream); g.userData.stream = stream;
  WU.uHit.value.set(hx3, hz3, 0);
  return g;
}

export { wallLines };
