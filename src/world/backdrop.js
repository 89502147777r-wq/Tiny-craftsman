import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { TRAY } from '../config.js';

// Background / lighting modes:
//   workshop – the diorama on the bench in the carpentry shop (HDRI + lamp)
//   site     – "life-size" illusion: 360° construction-site panorama, daylight,
//              no table, the plot continues into surrounding ground
//   photo1/2 – miniature-photography trick: a printed photo backdrop curved
//              behind the diorama, always opposite the camera, in daylight
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
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvec4 gw = modelMatrix * vec4(position, 1.0); vGW = gw.xyz; vMapUv = gw.xz / 0.2; vNormalMapUv = vMapUv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nuniform vec3 uFade;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n float fd = smoothstep(2.5, 13.0, length(vGW.xz)); diffuseColor.rgb = mix(diffuseColor.rgb, uFade, fd);');
      sh.uniforms.uFade = this.fadeU;
    };
    this.fadeU = { value: new THREE.Color(0.55, 0.5, 0.44) };
    this.ground = new THREE.Mesh(g, mat);
    this.ground.position.y = TRAY.soil - 0.0012;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    app.scene.add(this.ground);
    // curved photo print
    const R = 2.6, arc = 1.35, H = R * arc / 1.5;
    const pg = new THREE.CylinderGeometry(R, R, H, 48, 1, true, Math.PI - arc / 2, arc);
    pg.translate(0, H / 2 - 0.02, 0);
    this.photoMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: true });
    this.photo = new THREE.Mesh(pg, this.photoMat);
    this.photo.visible = false;
    app.scene.add(this.photo);
  }

  async set(mode) {
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
    this.photo.visible = mode === 'photo1' || mode === 'photo2';
    if (this.photo.visible) {
      const t = await this._photo(mode === 'photo1' ? 'assets/backdrops/site-billboard.jpg' : 'assets/backdrops/site-crane.jpg');
      this.photoMat.map = t; this.photoMat.needsUpdate = true;
    }
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

  update() {
    if (!this.photo.visible) return;
    // keep the print behind the diorama as the camera orbits
    const cam = this.app.camera.position;
    this.photo.rotation.y = Math.atan2(cam.x, cam.z);
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
      t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; // seen from inside the curve
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
