import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { TRAY, SOIL_TILE } from '../config.js';
import { STOCHASTIC_GLSL, stochasticChunks } from '../render/stochastic.js';

// Background / lighting modes:
//   workshop – the diorama on the bench in the carpentry shop (HDRI + lamp)
//   site     – "life-size" illusion: 360° construction-site panorama, daylight,
//              no table, the plot continues into surrounding ground
//   posters  – miniature-photography trick: two photo prints standing on the
//              table behind the diorama (crane left, billboard right), daylight
export class Backdrop {
  constructor(app) {
    this.app = app;
    this.mode = 'workshop';
    this.cache = {};
    const pmrem = new THREE.PMREMGenerator(app.renderer);
    this.pmrem = pmrem;
    this.workshopEnv = app.scene.environment;
    this.workshopBg = app.scene.background;
    // ground that continues the plot in "site" mode
    // a big disc with a hole exactly where the plot is
    const ring = new THREE.Shape();
    ring.absarc(0, 0, 14, 0, Math.PI * 2, false);
    const hx = TRAY.innerX / 2 - 0.0005, hz = TRAY.innerZ / 2 - 0.0005;
    ring.holes.push(new THREE.Path([new THREE.Vector2(-hx, -hz), new THREE.Vector2(hx, -hz), new THREE.Vector2(hx, hz), new THREE.Vector2(-hx, hz)]));
    const g = new THREE.ShapeGeometry(ring, 64);
    g.rotateX(-Math.PI / 2);
    const tex = app.tex.top;
    const mat = new THREE.MeshStandardMaterial({ map: tex.diff, normalMap: tex.nor, roughness: 1, color: 0xcfc2b2 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvec4 gw = modelMatrix * vec4(position, 1.0); vGW = gw.xyz; vMapUv = gw.xz / ' + SOIL_TILE.toFixed(5) + '; vNormalMapUv = vMapUv;');
      const ch = stochasticChunks();
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nuniform vec3 uFade;\n' + STOCHASTIC_GLSL)
        .replace('#include <map_fragment>', 'tcStochSetup(vMapUv);\n' + ch.map + '\n diffuseColor.rgb *= mix(0.82, 1.1, tcFbm(vGW.xz * 2.6));\n float fd = smoothstep(2.5, 13.0, length(vGW.xz)); diffuseColor.rgb = mix(diffuseColor.rgb, uFade, fd);')
        .replace('#include <normal_fragment_maps>', ch.normal);
      sh.uniforms.uFade = this.fadeU;
    };
    this.fadeU = { value: new THREE.Color(0.55, 0.5, 0.44) };
    this.ground = new THREE.Mesh(g, mat);
    this.ground.position.y = TRAY.soil - 0.0012;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    app.scene.add(this.ground);
  }

  async set(mode) {
    if (mode === 'photo1' || mode === 'photo2') mode = 'posters'; // older projects
    const app = this.app, ws = app.workshop;
    this.mode = mode;
    const day = mode !== 'workshop';
    if (day) await this._loadDay();
    if (this.mode !== mode) return; // changed while loading
    ws.table.visible = mode !== 'site';
    ws.group.children.forEach((o) => { if (o.userData.prop) o.visible = mode !== 'site'; });
    if (app.stacks) app.stacks.visible = mode !== 'site';
    ws.tray.traverse((o) => { if (o.isMesh) o.visible = mode !== 'site'; });
    this.ground.visible = mode === 'site';
    // printed posters standing on the table behind the diorama
    if (mode === 'posters' && !this.posters) await this._buildPosters();
    if (this.mode !== mode) return;
    if (this.posters) this.posters.visible = mode === 'posters';
    const s = app.scene;
    if (day) {
      s.environment = this.dayEnv;
      s.environmentIntensity = 0.9;
      s.background = mode === 'site' ? this.dayTex : this.workshopBg;
      s.backgroundBlurriness = mode === 'site' ? 0.02 : 0.12;
      s.backgroundIntensity = mode === 'site' ? 1.0 : 0.6;
      s.backgroundRotation.set(0, 0, 0); s.environmentRotation.set(0, 0, 0);
      ws.sun.color.set(0xfff0dc); ws.sun.intensity = 3.4;
      ws.sun.userData.dir.copy(this.sunDir);
    } else {
      s.environment = this.workshopEnv; s.environmentIntensity = 0.8;
      s.background = this.workshopBg; s.backgroundBlurriness = 0.12; s.backgroundIntensity = 0.75;
      s.backgroundRotation.set(0, 2.2, 0); s.environmentRotation.set(0, 2.2, 0);
      ws.sun.color.set(0xffd6ad); ws.sun.intensity = 2.7;
      ws.sun.userData.dir.set(-0.5, 0.95, -0.34).normalize();
    }
  }

  update() {}

  // Two photo prints, the way miniature photographers do it: each sheet stands
  // upright behind the tray and its lower edge bends forward onto the table,
  // where it is taped down (a paper "sweep", so there is no seam between the
  // print and the table). Crane on the left, billboard on the right.
  async _buildPosters() {
    const [crane, board] = await Promise.all([this._photo('assets/backdrops/site-crane.jpg'), this._photo('assets/backdrops/site-billboard.jpg')]);
    const g = new THREE.Group();
    g.name = 'posters';
    const back = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.85, side: THREE.BackSide });
    const tape = new THREE.MeshStandardMaterial({ color: 0xd9cfae, roughness: 0.5, transparent: true, opacity: 0.75 });
    const zBack = -(TRAY.innerZ / 2 + TRAY.wall) - 0.4; // feet clear of the tray even where the sheets turn inwards
    const W = 1.6;
    [[crane, -0.78, 0.2], [board, 0.78, -0.2]].forEach(([tex, x, turn]) => {
      const H = W / (tex.image.width / tex.image.height);
      const sheet = makeSweep(W, H, 0.14, 0.09);
      const front = new THREE.Mesh(sheet, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, side: THREE.FrontSide }));
      const rear = new THREE.Mesh(sheet, back);
      const p = new THREE.Group();
      p.add(front, rear);
      // two strips of masking tape over the flat foot
      for (const s of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.0004, 0.07), tape);
        t.position.set(s * W * 0.38, 0.0002, 0.14 + 0.05);
        p.add(t);
      }
      p.position.set(x, 0.0003, zBack);
      p.rotation.y = turn;
      p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(p);
    });
    g.visible = false;
    this.app.scene.add(g);
    this.posters = g;
  }

  async _loadDay() {
    if (this.dayTex) return;
    const t = await new Promise((res, rej) => new HDRLoader().load('assets/hdri/construction_yard_2k.hdr', res, undefined, rej));
    t.mapping = THREE.EquirectangularReflectionMapping;
    this.dayTex = t;
    this.dayEnv = this.pmrem.fromEquirectangular(t).texture;
    this.sunDir = findSun(t);
    // average ground colour of the panorama for the distance fade
    this.fadeU.value.copy(groundColour(t));
  }

  _photo(url) {
    if (this.cache[url]) return Promise.resolve(this.cache[url]);
    return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      this.cache[url] = t; res(t);
    }, undefined, rej));
  }
}

const half = (h) => {
  // decode IEEE half float
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
};
const px = (t, i) => (t.type === THREE.HalfFloatType ? half(t.image.data[i]) : t.image.data[i]);

// direction of the brightest pixel of an equirectangular HDR (= the sun)
function findSun(t) {
  const { width: W, height: H } = t.image;
  let best = -1, bi = 0;
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    const l = px(t, i) * 0.3 + px(t, i + 1) * 0.6 + px(t, i + 2) * 0.1;
    if (l > best) { best = l; bi = y * W + x; }
  }
  const x = bi % W, y = Math.floor(bi / W);
  const u = (x + 0.5) / W, v = 1 - (y + 0.5) / H; // row 0 is the top of the image
  const lon = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  // keep the shadows readable: not lower than ~25°
  if (dir.y < 0.42) { dir.y = 0.42; }
  return dir.normalize();
}

function groundColour(t) {
  const { width: W, height: H } = t.image;
  const c = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let y = Math.floor(H * 0.62); y < H * 0.75; y += 4) for (let x = 0; x < W; x += 8) {
    const i = (y * W + x) * 4;
    c.r += px(t, i); c.g += px(t, i + 1); c.b += px(t, i + 2); n++;
  }
  c.multiplyScalar(1 / n);
  return c;
}

// A sheet of photo paper: upright part of height h, a bend of radius r and a
// flat foot of length f lying on the table (towards +z). The image runs from
// the top edge down over the bend; the foot carries its last rows.
function makeSweep(w, h, r, f) {
  const prof = [];
  const n = 18;
  prof.push([0, h + r, 0]);
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; prof.push([0, r - Math.sin(a) * r + 0, r - Math.cos(a) * r]); }
  prof.push([0, 0, r + f]);
  // arc length along the profile → v
  const len = [0];
  for (let i = 1; i < prof.length; i++) len.push(len[i - 1] + Math.hypot(prof[i][1] - prof[i - 1][1], prof[i][2] - prof[i - 1][2]));
  const L = len[len.length - 1], img = h + r * Math.PI / 2; // the photo covers the upright part and the bend
  const pos = [], uv = [], idx = [];
  const cols = 8;
  for (let i = 0; i < prof.length; i++) for (let c = 0; c <= cols; c++) {
    const x = (c / cols - 0.5) * w;
    pos.push(x, prof[i][1], prof[i][2]);
    uv.push(c / cols, Math.max(0, 1 - len[i] / img));
  }
  for (let i = 0; i < prof.length - 1; i++) for (let c = 0; c < cols; c++) {
    const a = i * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
