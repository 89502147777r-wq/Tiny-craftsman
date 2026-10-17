import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { TRAY, SOIL_TILE, BACKDROP } from '../config.js';
import { STOCHASTIC_GLSL, stochasticChunks } from '../render/stochastic.js';

// Background / lighting modes:
//   workshop – the diorama on the bench in the carpentry shop (HDRI + lamp)
//   site     – "life-size" illusion: 360° construction-site panorama, daylight,
//              no table, the plot continues into surrounding ground
//   posters  – miniature-photography trick: a photo sheet glued round two sides
//              of the box (crane on side 1, billboard on side 2), daylight
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
    // the photo sheet glued round the box
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

  // The photo backdrop, the way miniature photographers do it: one sheet of
  // photo paper glued tight to the outside of the box along two sides that
  // meet at the rounded corner. Side 1 (far side) shows the crane photo,
  // side 2 (right side) the billboard; the two prints are butted in the middle
  // of the rounded corner (each covers its own side and half the curve). The sheet runs from the table
  // up past the rim; the photos start at the rim, where the soil ends.
  async _buildPosters() {
    const [crane, board] = await Promise.all([this._photo('assets/backdrops/site-crane.jpg'), this._photo('assets/backdrops/site-billboard.jpg')]);
    for (const t of [crane, board]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
    const geo = makeWrapSheet(crane.image.width / crane.image.height, board.image.width / board.image.height, sampler(crane.image), sampler(board.image));
    // matte photo paper: diffuse only — no glare on the rounded corner
    const front = new THREE.MeshLambertMaterial({ map: crane, side: THREE.FrontSide });
    front.onBeforeCompile = (sh) => {
      sh.uniforms.tB = { value: board };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 uvB;\nattribute float aMix;\nattribute vec3 aGain1;\nattribute vec3 aGain2;\nvarying vec2 vUvB;\nvarying float vMix;\nvarying vec3 vG1;\nvarying vec3 vG2;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvB = uvB; vMix = aMix; vG1 = aGain1; vG2 = aGain2;');
      // each print toned towards the other one near the joint (same brightness and colour
      // across it), and a feather of a few centimetres instead of a hard line
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tB;\nvarying vec2 vUvB;\nvarying float vMix;\nvarying vec3 vG1;\nvarying vec3 vG2;')
        .replace('#include <map_fragment>', 'vec4 cA = texture2D(map, vMapUv); cA.rgb *= vG1;\nvec4 cB = texture2D(tB, vUvB); cB.rgb *= vG2;\nvec4 sampledDiffuseColor = mix(cA, cB, smoothstep(0.0, 1.0, vMix));\ndiffuseColor *= sampledDiffuseColor;');
    };
    front.customProgramCacheKey = () => 'tc-backdrop-wrap-3';
    const back = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.85, side: THREE.BackSide });
    const g = new THREE.Group();
    g.name = 'posters';
    const m1 = new THREE.Mesh(geo, front), m2 = new THREE.Mesh(geo, back);
    for (const m of [m1, m2]) { m.receiveShadow = true; m.castShadow = false; }
    g.add(m1, m2);
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

// read a photo's colours (linear-ish 0…1) at a texture coordinate, from a small copy
function sampler(img) {
  const w = 256, h = Math.max(8, Math.round(256 * img.height / img.width));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, lin = (x) => Math.pow(x / 255, 2.2);
  return (u, v) => {
    const x = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1)))), y = Math.min(h - 1, Math.max(0, Math.round((1 - v) * (h - 1))));
    let r = 0, gg = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)), k = (yy * w + xx) * 4;
      r += lin(d[k]); gg += lin(d[k + 1]); b += lin(d[k + 2]); n++;
    }
    return [r / n, gg / n, b / n];
  };
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

// One sheet of paper wrapped round the outside of the box: along side 1, round
// the rounded corner, along side 2. Attributes: uv → photo 1 (crane), uvB →
// photo 2 (billboard), aMix → 0 on side 1 … 1 on side 2 (blend over the corner).
// Each photo "covers" its part (cropped, ground kept), starting at the rim.
function makeWrapSheet(aspect1, aspect2, sample1, sample2) {
  const { sx, sz, radius, height: H, first = 'x' } = BACKDROP;
  const e = 0.0012; // paper on the plywood
  const ox = TRAY.innerX / 2 + TRAY.wall + e, oz = TRAY.innerZ / 2 + TRAY.wall + e, R = radius + e;
  const cx = sx * (ox - R), cz = sz * (oz - R);
  const side1 = [], arc = [], side2 = [];
  // side 1 runs from its far end to the corner, side 2 from the corner away
  let n1, n2; // outward normals (x, z)
  if (first === 'x') {
    for (let i = 0; i <= 40; i++) side1.push([-sx * ox + (cx + sx * ox) * (i / 40), sz * oz]);
    for (let i = 1; i <= 30; i++) side2.push([sx * ox, cz + (-sz * oz - cz) * (i / 30)]);
    n1 = [0, sz]; n2 = [sx, 0];
  } else {
    for (let i = 0; i <= 40; i++) side1.push([sx * ox, -sz * oz + (cz + sz * oz) * (i / 40)]);
    for (let i = 1; i <= 30; i++) side2.push([cx + (-sx * ox - cx) * (i / 30), sz * oz]);
    n1 = [sx, 0]; n2 = [0, sz];
  }
  const a0 = Math.atan2(n1[1], n1[0]);
  let da = Math.atan2(n2[1], n2[0]) - a0; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
  for (let i = 1; i < 48; i++) { const a = a0 + da * (i / 48); arc.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); }
  const path = [...side1, ...arc, ...side2];
  const s = [0];
  for (let i = 1; i < path.length; i++) s.push(s[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L1 = s[side1.length - 1], L2 = s[side1.length + arc.length], total = s[s.length - 1];
  // the picture must run to the right of someone looking at side 1 from inside the box
  const d0 = [path[1][0] - path[0][0], path[1][1] - path[0][1]], right = [-n1[1], n1[0]];
  const flip = d0[0] * right[0] + d0[1] * right[1] < 0;
  const rim = TRAY.height;
  const cover = (s0, s1, aspect) => {
    const W = s1 - s0, k = Math.max(W / aspect, H);
    return (si, y) => {
      const u = 0.5 + ((si - s0) - W / 2) / (aspect * k);
      return [flip ? 1 - u : u, (y - rim) / k];
    };
  };
  const mid = s[side1.length + 23], FE = 0.025, FAR = 0.35, map1 = cover(0, mid, aspect1), map2 = cover(mid, total, aspect2);
  const ys = [0, rim - 0.004];
  for (let i = 0; i <= 16; i++) ys.push(rim + (H * i) / 16);
  // the colour of each print at the joint, row by row (a strip a few cm wide on its side):
  // both are toned to their mean there, fading back to the true colours FAR away
  const gains = ys.map((y) => {
    const yy = Math.max(y, rim) + 0.02, avg = (f, map, a, b) => { const c = [0, 0, 0]; for (let k = 0; k < 4; k++) { const [u, v] = map(a + (b - a) * (k + 0.5) / 4, yy); const q = f(u, v); c[0] += q[0] / 4; c[1] += q[1] / 4; c[2] += q[2] / 4; } return c; };
    const c1 = avg(sample1, map1, mid - 0.06, mid), c2 = avg(sample2, map2, mid, mid + 0.06);
    const g = (a, b) => Math.min(1.5, Math.max(0.67, ((a + b) / 2 + 0.02) / (a + 0.02)));
    return [[0, 1, 2].map((k) => g(c1[k], c2[k])), [0, 1, 2].map((k) => g(c2[k], c1[k]))];
  });
  const pos = [], uv = [], uvB = [], mix = [], g1 = [], g2 = [], idx = [];
  for (let j = 0; j < ys.length; j++) for (let i = 0; i < path.length; i++) {
    pos.push(path[i][0], ys[j], path[i][1]);
    uv.push(...map1(s[i], Math.max(ys[j], rim)));
    uvB.push(...map2(s[i], Math.max(ys[j], rim)));
    mix.push(Math.min(1, Math.max(0, (s[i] - mid + FE) / (2 * FE))));
    const w = Math.max(0, 1 - Math.abs(s[i] - mid) / FAR), sm = w * w * (3 - 2 * w);
    for (let k = 0; k < 3; k++) { g1.push(1 + (gains[j][0][k] - 1) * sm); g2.push(1 + (gains[j][1][k] - 1) * sm); }
  }
  const n = path.length;
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uvB', new THREE.Float32BufferAttribute(uvB, 2));
  g.setAttribute('aMix', new THREE.Float32BufferAttribute(mix, 1));
  g.setAttribute('aGain1', new THREE.Float32BufferAttribute(g1, 3));
  g.setAttribute('aGain2', new THREE.Float32BufferAttribute(g2, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the printed side must face the box (inwards)
  const nrm = g.attributes.normal;
  const inward = -(nrm.getX(0) * path[0][0] + nrm.getZ(0) * path[0][1]) > 0;
  if (!inward) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}
