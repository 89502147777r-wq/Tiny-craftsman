import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { TRAY, SOIL_TILE, BACKDROP, MODEL_SCALE } from '../config.js';
import { STOCHASTIC_GLSL, stochasticChunks } from '../render/stochastic.js';
import { innerCorner } from './plotShape.js';

// Background / lighting modes:
//   workshop – the diorama on the bench in the carpentry shop (HDRI + lamp)
//   site     – "life-size" illusion: 360° construction-site panorama, daylight,
//              no table, the plot continues into surrounding ground
//   posters  – miniature-photography trick: a photo sheet glued round two sides
//              of the box (crane on side 1, billboard on side 2), daylight
// The 360° backgrounds (Poly Haven, CC0): the photo (a 4k JPG, sharp) for what is seen,
// the HDRI (1k) for the light. R — how far off the panorama stands (its sphere round the
// plot, so it gets smaller with the plot as the camera draws back: the buildings, the trees
// keep their size next to the house); ground — the ground round the plot (null: the plot's
// own soil), going over into the photo's own ground further off.
export const PANOS = {
  site: { name: 'Стройплощадка 360°', id: 'construction_yard', R: 45, ground: null },
  beach: { name: 'У моря', id: 'spiaggia_di_mondello', R: 120, ground: 'coast_sand_01', tile: 2.5 },
  lake: { name: 'У озера', id: 'lakeside', R: 90, ground: 'coast_sand_01', tile: 2.5 },
  forest: { name: 'В лесу', id: 'forest_slope', R: 35, ground: 'forest_leaves_04', tile: 2 },
  meadow: { name: 'Луг', id: 'meadow_2', R: 45, ground: 'leafy_grass', tile: 2 },
  alps: { name: 'Горы', id: 'alps_field', R: 90, ground: 'leafy_grass', tile: 2 },
};
export const isPano = (m) => !!PANOS[m];
const EYE = 1.7;   // the panoramas were shot about this high (m)
// how far above the panorama's camera ours is (0 … 1): from up high the photo's ground
// (a bowl under the plot) would show — haze there
const HIGH_GLSL = `smoothstep(${(3 * EYE / MODEL_SCALE).toFixed(4)}, ${(14 * EYE / MODEL_SCALE).toFixed(4)}, vUp)`;

export class Backdrop {
  constructor(app) {
    this.app = app;
    this.mode = 'workshop';
    this.cache = {};
    const pmrem = new THREE.PMREMGenerator(app.renderer);
    this.pmrem = pmrem;
    this.workshopEnv = app.scene.environment;
    this.workshopBg = app.scene.background;
    // the ground round the plot in the 360° modes: a disc with a hole where the plot is;
    // near the plot its own soil, further out the ground of the place (sand, grass, forest
    // floor), fading out into the photo's own ground beyond
    const hx = TRAY.innerX / 2 - 0.0005, hz = TRAY.innerZ / 2 - 0.0005;
    this.groundHole = [hx, hz];
    const tex = app.tex.top;
    this.gU = {
      uFade: { value: new THREE.Color(0.55, 0.5, 0.44) }, tTheme: { value: tex.diff }, uThemeTile: { value: 1 / SOIL_TILE },
      uTheme: { value: 0 }, uOut: { value: new THREE.Vector2(1e5, 1e5 + 1) }, uHole: { value: new THREE.Vector2(hx, hz) },
    };
    const mat = new THREE.MeshStandardMaterial({ map: tex.diff, normalMap: tex.nor, roughness: 1, color: 0xf4e8d6, transparent: true });   // (the shade of the plot's own soil)
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.gU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvec4 gw = modelMatrix * vec4(position, 1.0); vGW = gw.xyz; vMapUv = gw.xz / ' + SOIL_TILE.toFixed(5) + '; vNormalMapUv = vMapUv;');
      // (plain texture lookups: the stochastic tiling showed as a honeycomb on this wide plane)
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vGW;
        uniform vec3 uFade; uniform sampler2D tTheme; uniform float uThemeTile; uniform float uTheme;
        uniform vec2 uOut; uniform vec2 uHole;
        ` + STOCHASTIC_GLSL)
        .replace('#include <map_fragment>', `#include <map_fragment>
        float gr = length(vGW.xz);
        // the place's own ground beyond the plot (the soil of the plot fades into it)
        float th = uTheme * smoothstep(0.0, 0.45, max(abs(vGW.x) - uHole.x, abs(vGW.z) - uHole.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(tTheme, vGW.xz * uThemeTile).rgb, th);
        diffuseColor.rgb *= mix(0.82, 1.1, tcFbm(vGW.xz * 2.6));
        // further off it fades out: the photo's own ground under it
        diffuseColor.a *= 1.0 - smoothstep(uOut.x, uOut.y, gr + (tcFbm(vGW.xz * 1.3) - 0.5) * 0.5);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), smoothstep(0.6, 4.0, length(vGW.xz))));   // (no grain far off: it would ripple)`);
    };
    this.fadeU = this.gU.uFade;
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.ground.position.y = TRAY.soil - 0.0012;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    app.scene.add(this.ground);
    this.panos = {};
  }

  // the ground disc out to radius r (model)
  _groundTo(r) {
    if (this._gR === r) return;
    this._gR = r;
    const ring = new THREE.Shape(), [hx, hz] = this.groundHole;
    ring.absarc(0, 0, r, 0, Math.PI * 2, false);
    // the hole: the plot's outline — with its rounded corner (else a gap shows there)
    const ic0 = innerCorner(), ic = { ...ic0, cz: -ic0.cz, sz: -ic0.sz }, pts = [], cs = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];   // (the shape's y is the plot's -z: it is turned down onto the ground)
    cs.forEach(([x, z], k) => {
      if (Math.sign(x) !== ic.sx || Math.sign(z) !== ic.sz) { pts.push(new THREE.Vector2(x, z)); return; }
      const [px, pz] = cs[(k + 3) % 4], [nx, nz] = cs[(k + 1) % 4];
      const e0 = [x + Math.sign(px - x) * (Math.abs(px - x) > 1e-9 ? ic.r : 0), z + Math.sign(pz - z) * (Math.abs(pz - z) > 1e-9 ? ic.r : 0)];
      const e1 = [x + Math.sign(nx - x) * (Math.abs(nx - x) > 1e-9 ? ic.r : 0), z + Math.sign(nz - z) * (Math.abs(nz - z) > 1e-9 ? ic.r : 0)];
      let t0 = Math.atan2(e0[1] - ic.cz, e0[0] - ic.cx), t1 = Math.atan2(e1[1] - ic.cz, e1[0] - ic.cx);
      if (t1 - t0 > Math.PI) t1 -= 2 * Math.PI; if (t0 - t1 > Math.PI) t1 += 2 * Math.PI;
      for (let q = 0; q <= 24; q++) { const t = t0 + (t1 - t0) * q / 24; pts.push(new THREE.Vector2(ic.cx + Math.cos(t) * ic.r, ic.cz + Math.sin(t) * ic.r)); }
    });
    ring.holes.push(new THREE.Path(pts));
    const g = new THREE.ShapeGeometry(ring, 96);
    g.rotateX(-Math.PI / 2);
    this.ground.geometry.dispose();
    this.ground.geometry = g;
  }

  async set(mode) {
    if (mode === 'photo1' || mode === 'photo2') mode = 'posters'; // older projects
    if (!isPano(mode) && mode !== 'posters') mode = 'workshop';
    const app = this.app, ws = app.workshop, pano = isPano(mode);
    this.mode = mode;
    const day = mode !== 'workshop';
    // (the photo sheet is lit by the construction-site daylight)
    const P = day ? await this._loadPano(pano ? mode : 'site') : null;
    if (this.mode !== mode) return; // changed while loading
    ws.table.visible = !pano;
    ws.group.children.forEach((o) => { if (o.userData.prop) o.visible = !pano; });
    if (app.stacks) app.stacks.visible = !pano;
    ws.tray.traverse((o) => { if (o.isMesh) o.visible = !pano; });
    this.ground.visible = pano;
    for (const p of Object.values(this.panos)) if (p.sky) p.sky.visible = pano && p === P;
    // the camera stays inside the panorama (and a real camera's depth of field — no
    // miniature blur)
    const lim = app.rig?.limits;
    if (lim) {
      const Rm = pano ? PANOS[mode].R / MODEL_SCALE : Infinity;
      // (in a panorama: out over its ground to 40 % of its radius, never out of its sphere)
      lim.maxDist = pano ? Math.min(10, Rm * 0.7) : 4; lim.boxX = pano ? Rm * 0.4 : 1.5; lim.boxZ = pano ? Rm * 0.4 : 1.2; lim.sphere = pano ? Rm * 0.85 : 0;
      app.rig.goal.dist = Math.min(app.rig.goal.dist, lim.maxDist); app.rig.clampTarget();
    }
    if (pano) {
      const cfg = PANOS[mode], Rm = cfg.R / MODEL_SCALE, g = this.gU;
      const o0 = Math.max(1.7, Rm * 0.2), o1 = Math.max(o0 + 0.8, Rm * 0.45);
      this._groundTo(o1 + 0.3);
      g.uOut.value.set(o0, o1); g.uFade.value.copy(P.haze);
      g.uTheme.value = cfg.ground ? 1 : 0;
      if (cfg.ground) { const t = await this._groundTex(cfg.ground); g.tTheme.value = t.diff; g.uThemeTile.value = MODEL_SCALE / (cfg.tile || 2); }
    } else { const g = this.gU; g.uTheme.value = 0; g.uOut.value.set(1e5, 1e5 + 1); }   // (the berm of the photo sheet shares this material)
    // the photo sheet glued round the box
    if (mode === 'posters' && !this.posters) await this._buildPosters();
    if (this.mode !== mode) return;
    if (this.posters) this.posters.visible = mode === 'posters';
    const s = app.scene;
    if (day) {
      s.environment = P.env;
      s.environmentIntensity = 0.9;
      s.background = pano ? null : this.workshopBg;   // (in a 360° mode the panorama sphere is the background)
      s.backgroundBlurriness = 0.12;
      s.backgroundIntensity = 0.6;
      s.backgroundRotation.set(0, 0, 0); s.environmentRotation.set(0, 0, 0);
      ws.sun.color.set(0xfff0dc); ws.sun.intensity = 3.4;
      ws.sun.userData.dir.copy(P.sun);
      this._drop(P);
    } else {
      s.environment = this.workshopEnv; s.environmentIntensity = 0.8;
      s.background = this.workshopBg; s.backgroundBlurriness = 0.12; s.backgroundIntensity = 0.75;
      s.backgroundRotation.set(0, 2.2, 0); s.environmentRotation.set(0, 2.2, 0);
      ws.sun.color.set(0xffd6ad); ws.sun.intensity = 2.7;
      ws.sun.userData.dir.set(-0.5, 0.95, -0.34).normalize();
      this._drop(null);   // (the panoramas off the GPU)
    }
  }

  update() {}
  get current() { return isPano(this.mode) ? this.panos[this.mode] : null; }

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

  // a panorama: the light from it (its HDRI), where its sun is, the haze colour along its
  // horizon; the photo on its sphere round the plot
  async _loadPano(key) {
    if (this.panos[key]) return this.panos[key];
    const cfg = PANOS[key];
    const [t, photo] = await Promise.all([
      new Promise((res, rej) => new HDRLoader().load(`assets/hdri/${cfg.id}_1k.hdr`, res, undefined, rej)),
      this._photo(`assets/backdrops/360/${cfg.id}_4k.jpg`),
    ]);
    t.mapping = THREE.EquirectangularReflectionMapping;
    const P = { env: this.pmrem.fromEquirectangular(t).texture, sun: findSun(t), haze: horizonColour(t) };
    t.dispose();
    photo.colorSpace = THREE.SRGBColorSpace; photo.anisotropy = 4; photo.wrapS = THREE.RepeatWrapping; photo.needsUpdate = true;
    P.photo = photo;
    P.sky = panoSphere(photo, P.haze, cfg.R / MODEL_SCALE, this.app.renderer.toneMappingExposure);
    P.sky.position.set(0, TRAY.soil + EYE / MODEL_SCALE, 0);
    P.sky.visible = false;
    this.app.scene.add(P.sky);
    this.panos[key] = P;
    return P;
  }

  // only one panorama kept on the GPU (the photo sheet's daylight stays)
  _drop(keep) {
    for (const [k, P] of Object.entries(this.panos)) {
      if (P === keep) continue;
      this.app.scene.remove(P.sky); P.sky.geometry.dispose(); P.sky.material.dispose();
      P.photo.dispose(); delete this.cache[P.photo.userData.url];
      P.env.dispose();
      delete this.panos[k];
    }
  }

  _groundTex(name) {
    this._gt = this._gt || {};
    if (!this._gt[name]) this._gt[name] = Promise.all(['diff', 'nor_gl'].map((m) => this._photo(`assets/textures/${name}/${m}.jpg`))).then(([diff, nor]) => {
      for (const t of [diff, nor]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
      nor.colorSpace = THREE.NoColorSpace;
      return { diff, nor };
    });
    return this._gt[name];
  }

  _photo(url) {
    if (this.cache[url]) return Promise.resolve(this.cache[url]);
    return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      t.userData.url = url; this.cache[url] = t; res(t);
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

// The panorama on a sphere of radius R round the plot (centred where its camera stood):
// each point shows the photo in its direction from the centre — from the centre it is the
// photo; from elsewhere what is in it stands about R away (so it keeps its size next to
// what is on the plot). Drawn behind everything. The photo is already tone-mapped: the
// tone mapping of the picture is undone for it, so it comes out on the screen as it is.
function panoSphere(map, haze, R, exposure) {
  const m = new THREE.ShaderMaterial({
    // the time of day and the weather (sky.js): the light on the place, dusk, night, rain
    uniforms: { tMap: { value: map }, uHaze: { value: haze }, uDim: { value: new THREE.Color(1, 1, 1) }, uNight: { value: 0 }, uDusk: { value: 0 }, uOver: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: `varying vec3 vDir; varying float vUp;
      void main() {
        vDir = position;
        vUp = cameraPosition.y - modelMatrix[3].y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform sampler2D tMap; uniform vec3 uHaze; varying vec3 vDir; varying float vUp;
      uniform vec3 uDim; uniform float uNight; uniform float uDusk; uniform float uOver; uniform vec3 uSunDir;
      // the inverse of three's ACES filmic (the final pass tone-maps everything)
      vec3 unACES(vec3 y) {
        const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        y = inverse(OUT) * clamp(y, 0.0, 0.985);
        vec3 a = 1.0 - 0.983729 * y, b = 0.0245786 - 0.4329510 * y, c = -(0.000090537 + 0.238081 * y);
        vec3 v = (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
        return max(inverse(IN) * v, 0.0) * ${(0.6 / exposure).toFixed(5)};
      }
      void main() {
        vec3 d = normalize(vDir);
        vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        // (the gradients without the jump where the photo's ends meet: no seam)
        vec2 gx = dFdx(uv), gy = dFdy(uv);
        gx.x -= floor(gx.x + 0.5); gy.x -= floor(gy.x + 0.5);
        vec3 c = unACES(textureGrad(tMap, uv, gx, gy).rgb);
        // seen from high up the photo's ground below its horizon is a bowl: haze there
        c = mix(c, uHaze, smoothstep(0.0, -0.12, d.y) * ${HIGH_GLSL});
        // the sky in the photo: bright, up, bluish or white (not the trees, the buildings)
        float lum = dot(c, vec3(0.3, 0.59, 0.11));
        float sky = smoothstep(0.0, 0.1, d.y) * smoothstep(0.18, 0.45, lum / max(0.25, ${(0.6).toFixed(2)})) * smoothstep(-0.12, 0.04, c.b - c.r);
        // rain: grey low cloud, everything duller
        // (only the sky goes grey; the place keeps its colours, a little duller under the cloud)
        c = mix(c, vec3(0.5, 0.52, 0.55) * (0.75 + 0.35 * smoothstep(0.0, 0.5, d.y)), uOver * 0.85 * sky);
        c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), uOver * 0.12);
        // dusk / dawn: the sky goes orange low down and towards the sun, the rest warmer
        float toSun = max(dot(d, normalize(uSunDir)), 0.0);
        vec3 duskSky = mix(vec3(1.0, 0.46, 0.2), vec3(0.42, 0.36, 0.62), smoothstep(0.02, 0.45, d.y)) * (0.55 + 1.1 * pow(toSun, 6.0));
        c = mix(c, duskSky * (0.5 + lum), uDusk * sky * (1.0 - uOver * 0.7));
        // the light on the place (the ground, the trees, the buildings)
        c *= uDim;
        // night: a deep blue sky with stars
        vec3 ns = mix(vec3(0.012, 0.018, 0.042), vec3(0.002, 0.004, 0.014), smoothstep(0.0, 0.7, d.y));
        vec3 sc = floor(d * 520.0);
        float st = fract(sin(dot(sc, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        ns += vec3(0.85, 0.9, 1.0) * step(0.9972, st) * smoothstep(0.04, 0.25, d.y) * (0.4 + 0.6 * fract(st * 91.7)) * (1.0 - uOver);
        c = mix(c, ns, uNight * sky);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: true,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48), m);
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
