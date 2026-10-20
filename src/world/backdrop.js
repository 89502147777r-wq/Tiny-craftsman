import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { TRAY, SOIL_TILE, BACKDROP, MODEL_SCALE } from '../config.js';
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
    ring.absarc(0, 0, 30, 0, Math.PI * 2, false);   // (out to the haze of the distance)
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
        .replace('#include <map_fragment>', 'tcStochSetup(vMapUv);\n' + ch.map + '\n diffuseColor.rgb *= mix(0.82, 1.1, tcFbm(vGW.xz * 2.6));\n float fd = smoothstep(0.6, 9.0, length(vGW.xz)); diffuseColor.rgb = mix(diffuseColor.rgb, uFade, fd);')
        .replace('#include <normal_fragment_maps>', ch.normal + '\n normal = normalize(mix(normal, normalize(vNormal), smoothstep(0.6, 4.0, length(vGW.xz))));   // (no grain far off: it would ripple)');
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
    if (this.sky) this.sky.visible = mode === 'site';
    // the photo sheet glued round the box
    if (mode === 'posters' && !this.posters) await this._buildPosters();
    if (this.mode !== mode) return;
    if (this.posters) this.posters.visible = mode === 'posters';
    const s = app.scene;
    if (day) {
      s.environment = this.dayEnv;
      s.environmentIntensity = 0.9;
      s.background = mode === 'site' ? null : this.workshopBg;   // (in 'site' the hazy sky sphere is the background)
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
    const s1 = sampler(crane.image), s2 = sampler(board.image);
    const geo = makeWrapSheet(crane.image.width / crane.image.height, board.image.width / board.image.height, s1, s2);
    // the colour of the ground in the prints (their lowest strip) against the plot's sand
    const avg = (f, vs) => { const c = [0, 0, 0]; let n = 0; for (const v of vs) for (let u = 0.05; u < 1; u += 0.1) { const q = f(u, v); c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; n++; } return c.map((x) => x / n); };
    const pg = avg(s1, [0.07, 0.1, 0.13]).map((x, i) => (x + avg(s2, [0.07, 0.1, 0.13])[i]) / 2);
    const tint = new THREE.Color(0xcfc2b2), sd = avg(sampler(this.app.tex.top.diff.image), [0.1, 0.3, 0.5, 0.7, 0.9]).map((x, i) => x * [tint.r, tint.g, tint.b][i]);
    const groundGain = new THREE.Vector3(...sd.map((x, i) => Math.min(1.6, Math.max(0.6, x / Math.max(1e-3, pg[i])))));
    // matte photo paper: diffuse only — no glare on the rounded corner
    const front = new THREE.MeshLambertMaterial({ map: crane, side: THREE.FrontSide });
    front.onBeforeCompile = (sh) => {
      sh.uniforms.tB = { value: board };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 uvB;\nattribute float aMix;\nattribute vec3 aGain1;\nattribute vec3 aGain2;\nvarying vec2 vUvB;\nvarying float vMix;\nvarying vec3 vG1;\nvarying vec3 vG2;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvB = uvB; vMix = aMix; vG1 = aGain1; vG2 = aGain2;');
      // each print toned towards the other one near the joint (same brightness and colour
      // across it), and a feather of a few centimetres instead of a hard line
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tB;\nvarying vec2 vUvB;\nvarying float vMix;\nvarying vec3 vG1;\nvarying vec3 vG2;')
        .replace('#include <map_fragment>', 'vec4 cA = texture2D(map, vMapUv); cA.rgb *= vG1;\nvec4 cB = texture2D(tB, vUvB); cB.rgb *= vG2;\nvec4 sampledDiffuseColor = mix(cA, cB, smoothstep(0.0, 1.0, vMix));\n'
          // the foot of the prints goes over into the sand of the plot (same texture and tint)
          + 'vec3 sand = texture2D(tSand, vec2(vBW.x + vBW.z, vBW.y) / ' + SOIL_TILE.toFixed(5) + ').rgb * uSandTint * 1.3;\n'
          + 'float sf = 1.0 - smoothstep(' + (TRAY.soil + 0.006).toFixed(4) + ', ' + (TRAY.soil + 0.045).toFixed(4) + ', vBW.y);\n'
          // the ground of the prints toned to the colour of the plot's sand, fading out upwards
          + 'float gw = 1.0 - smoothstep(' + (TRAY.soil + 0.01).toFixed(4) + ', ' + (TRAY.soil + 0.16).toFixed(4) + ', vBW.y);\n'
          + 'sampledDiffuseColor.rgb *= mix(vec3(1.0), uGroundGain * 1.12, gw);\n'
          + 'sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sand, sf * sf * (3.0 - 2.0 * sf));\ndiffuseColor *= sampledDiffuseColor;');
      sh.uniforms.uGroundGain = { value: groundGain };
      sh.uniforms.tSand = { value: this.app.tex.top.diff };
      sh.uniforms.uSandTint = { value: new THREE.Color(0xcfc2b2) };
      sh.vertexShader = sh.vertexShader.replace('varying vec2 vUvB;', 'varying vec2 vUvB;\nvarying vec3 vBW;').replace('vUvB = uvB;', 'vUvB = uvB; vBW = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('uniform sampler2D tB;', 'uniform sampler2D tB;\nuniform sampler2D tSand;\nuniform vec3 uSandTint;\nuniform vec3 uGroundGain;\nvarying vec3 vBW;');
    };
    front.customProgramCacheKey = () => 'tc-backdrop-wrap-7';
    const back = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.85, side: THREE.BackSide });
    const g = new THREE.Group();
    g.name = 'posters';
    const m1 = new THREE.Mesh(geo, front), m2 = new THREE.Mesh(geo, back);
    // the print takes no shadows: the walls of the box stand behind it now and would darken its foot
    for (const m of [m1, m2]) { m.receiveShadow = false; m.castShadow = false; }
    g.add(m1, m2);
    // a little sand pushed up against the print along its foot (as on a real diorama):
    // the plot's own sand, so the joint between the plot and the print does not show
    g.add(makeSandBerm(geo.userData.path, this.ground.material));
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
    // the sky: the panorama round the camera at infinity, as before — but below its horizon
    // it fades into the haze of distant ground (the colour along the panorama's horizon),
    // where our own ground runs out to: the plot stands on ground that reaches the horizon,
    // the buildings of the panorama stand behind it (not its near ground seen from 1.7 m
    // under a plot hanging in the air)
    this.hazeU = { value: horizonColour(t) };
    this.fadeU.value.copy(this.hazeU.value);
    this.sky = hazySky(t, this.hazeU);
    this.sky.visible = false;
    this.app.scene.add(this.sky);
  }

  _photo(url) {
    if (this.cache[url]) return Promise.resolve(this.cache[url]);
    return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      this.cache[url] = t; res(t);
    }, undefined, rej));
  }
}

// a strip of sand along the foot of the backdrop: from the sheet (a little up it) down and
// out onto the plot, slightly below the soil at its outer edge (it disappears into it)
function makeSandBerm(path, material) {
  const prof = [[0, 0.0055], [0.008, 0.0038], [0.02, 0.0018], [0.04, 0.0004], [0.06, -0.0012]];   // (in from the sheet, up from the soil)
  const n = path.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // inwards: towards the middle of the box
    let nx = -tz, nz = tx; if (nx * path[i][0] + nz * path[i][1] > 0) { nx = -nx; nz = -nz; }
    for (const [d, y] of prof) pos.push(path[i][0] + nx * (d + 0.0004), TRAY.soil + y, path[i][1] + nz * (d + 0.0004));
  }
  const m = prof.length;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * m * 2), 2));
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.name = 'backdrop-sand';
  return mesh;
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
  // on the inner face of the walls (the white top of the wall is hidden behind it), its
  // foot down in the sand
  const e = 0.0012;
  const ox = TRAY.innerX / 2 - e, oz = TRAY.innerZ / 2 - e, R = radius - TRAY.wall - e;
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
  const rim = TRAY.soil + 0.004;   // where the prints start: just above the sand
  // the two prints are the two halves of one panorama (as on the real diorama): each runs
  // to the joint with its own edge, uncropped, both at one scale and bottom at the rim, so
  // the horizon, the sky and the ground run on across the corner
  const mid = s[side1.length + 23], FE = 0.025, FAR = 0.35;
  const k = Math.max(H, mid / aspect1, (total - mid) / aspect2);
  // (the lowest strip of the photos is darkened by the lens: it is hidden in the sand)
  const V0 = 0.05;
  const map1 = (si, y) => { const u = 1 - (mid - si) / (aspect1 * k); return [flip ? 1 - u : u, V0 + (y - rim) / k]; };
  const map2 = (si, y) => { const u = (si - mid) / (aspect2 * k); return [flip ? 1 - u : u, V0 + (y - rim) / k]; };
  const ys = [TRAY.soil - 0.006, rim - 0.002];
  for (let i = 0; i <= 16; i++) ys.push(rim + (k * (1 - V0) * i) / 16);   // the sheet as tall as the prints: all their sky
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
  g.userData.path = path;
  return g;
}

// The panorama on a sphere that moves with the camera (it is at infinity), drawn behind
// everything; below the horizon it turns into the haze colour.
function hazySky(map, hazeU) {
  const m = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: map }, uHaze: hazeU },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform sampler2D tMap; uniform vec3 uHaze; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        vec3 c = texture2D(tMap, uv).rgb;
        // a thin haze right over the horizon, haze below it
        c = mix(c, uHaze, smoothstep(0.03, -0.004, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: true,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), m);
  s.renderOrder = -100; s.frustumCulled = false;
  return s;
}

// the colour of the panorama just under its horizon (the distant ground and haze)
function horizonColour(t) {
  const { width: W, height: H } = t.image;
  const c = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let y = Math.floor(H * 0.505); y < H * 0.54; y += 2) for (let x = 0; x < W; x += 8) {
    const i = (y * W + x) * 4;
    c.r += px(t, i); c.g += px(t, i + 1); c.b += px(t, i + 2); n++;
  }
  return c.multiplyScalar(1 / n);
}
