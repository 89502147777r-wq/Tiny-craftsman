import * as THREE from 'three';
import { TRAY, MODEL_SCALE } from '../config.js';
import { isPano } from './backdrop.js';

// The time of day and the weather round the plot (the 360° places and the photo sheet; the
// workshop is indoors and stays as it is):
//   the day  – the sun goes over (east → south → west) through a day of `dayMin` minutes
//              (settings, 0 – stopped): warm and low at dawn and dusk, white at noon; at
//              night the moon, a deep blue sky with stars, the panorama dark;
//   the lamps– two floodlights on masts by the plot come on at dusk (no shadows unless
//              the quality is high: the phone stays cool);
//   the rain – now and then (weather «auto») or on demand: streaks round the camera,
//              splashes, grey low cloud; what is out gets wet — darker, with a sheen;
//              water drops on metal and glass; puddles gather in the low places of the
//              plot (their water lies level: the ground round them hides the edge). After
//              it everything dries out slowly.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const RISE = 5.5, SET = 21;   // (a summer day)
export const DAY_LENGTHS = [10, 30, 60, 0];
export const WEATHER = { auto: 'Погода: авто', clear: 'Ясно', rain: 'Дождь' };

export class Sky {
  constructor(app) {
    this.app = app;
    this.hour = app.settings.dayHour ?? 11;
    this.rain = 0; this.wet = 0; this.pool = 0; this.over = 0;
    this.raining = false; this.weatherT = 120 + Math.random() * 240;
    this.time = 0; this._saveT = 0; this._scanT = 0; this._spotsT = 0;
    this.mats = new Map();
    this._lamps();
    this._rainMesh();
    this.puddles = new THREE.Group(); this.puddles.name = 'puddles'; app.scene.add(this.puddles);
  }
  get on() { const m = this.app.backdrop?.mode; return !!m && m !== 'workshop'; }
  get busy() { return this.on && this.rain > 0.01; }   // (the rain moves: drawn at 30 a second)
  setHour(h) { this.hour = ((h % 24) + 24) % 24; this.app.settings.dayHour = +this.hour.toFixed(2); this.app.poke?.(); }
  label() {
    const h = this.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  update(dt) {
    const app = this.app, st = app.settings;
    if (!this.on) { if (this._wasOn) this._off(); return; }
    this._wasOn = true;
    this.time += dt;
    // the clock
    const dm = st.dayMin ?? 30;
    if (dm > 0) this.hour = (this.hour + dt * 24 / (dm * 60)) % 24;
    if ((this._saveT += dt) > 5) { this._saveT = 0; st.dayHour = +this.hour.toFixed(2); }
    // the weather
    const w = st.weather || 'auto';
    if (w === 'auto') {
      this.weatherT -= dt;
      if (this.weatherT <= 0) {
        this.raining = !this.raining && Math.random() < 0.6;
        this.weatherT = this.raining ? 90 + Math.random() * 240 : 240 + Math.random() * 480;
      }
    } else this.raining = w === 'rain';
    const goal = this.raining ? 1 : 0;
    this.over += (goal - this.over) * Math.min(1, dt / 12);
    this.rain += ((this.over > 0.6 && this.raining ? 1 : 0) - this.rain) * Math.min(1, dt / 6);
    if (this.rain > 0.15) { this.wet = Math.min(1, this.wet + dt * this.rain / 35); this.pool = Math.min(1, this.pool + dt * this.rain / 80); }
    else { this.wet = Math.max(0, this.wet - dt / 240); this.pool = Math.max(0, this.pool - dt / 420); }
    this._light();
    this._rainUpdate(dt);
    this._puddlesUpdate(dt);
    if ((this._scanT -= dt) <= 0) { this._scanT = 1; this._wetScan(); }
    app.sfx?.rain?.(this.rain);
  }

  // ---- the sun, the moon, the sky -----------------------------------------------------------
  _light() {
    const app = this.app, ws = app.workshop, P = app.backdrop.current, s = app.scene, h = this.hour;
    const df = (h - RISE) / (SET - RISE);
    const el = df >= 0 && df <= 1 ? Math.sin(Math.PI * df) * 1.0 : -Math.sin(Math.PI * Math.min(1, ((h - SET + 24) % 24) / (24 - (SET - RISE)))) * 0.35;
    const se = Math.sin(el);
    // the panorama's own sun stands for noon; the sun goes round from there
    const base = P?.sun || new THREE.Vector3(-0.5, 0.95, -0.34).normalize(), az0 = Math.atan2(base.z, base.x);
    const az = az0 + (h - (RISE + SET) / 2) / (SET - RISE) * Math.PI * 1.15;
    const sun = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.max(Math.sin(el), -0.4), Math.cos(el) * Math.sin(az)).normalize();
    const day = sm(-0.04, 0.22, se), night = 1 - sm(-0.16, 0.02, se), dusk = Math.max(0, sm(-0.12, 0.02, se) - sm(0.06, 0.32, se));
    this.night = night;
    const o = this.over;
    if (day > 0.02) {
      ws.sun.userData.dir.copy(sun.y > 0.03 ? sun : sun.clone().setY(0.03).normalize());
      const warm = new THREE.Color(0xff8a3c), white = new THREE.Color(0xfff0dc);
      ws.sun.color.copy(warm.lerp(white, sm(0.04, 0.45, se)));
      ws.sun.intensity = 3.4 * day * (1 - 0.8 * o);
    } else {
      // the moon: high in the other side of the sky, cold and faint
      ws.sun.userData.dir.set(-Math.cos(az) * 0.6, 0.75, -Math.sin(az) * 0.6).normalize();
      ws.sun.color.set(0x9fb4e8);
      ws.sun.intensity = 0.32 * (1 - 0.8 * o);
    }
    s.environmentIntensity = 0.9 * (0.05 + 0.95 * day) * (1 - 0.3 * o) + 0.03 * night;
    app.renderer.toneMappingExposure = 1.05 * (1 + 0.45 * night);   // (the eye gets used to the dark)
    if (P?.sky) {
      const u = P.sky.material.uniforms;
      const k = (0.06 + 0.94 * day) * (1 - 0.35 * o);
      u.uDim.value.setRGB(k * (1 - 0.18 * night), k * (1 - 0.1 * night), k * (1 + 0.25 * night));
      u.uNight.value = night; u.uDusk.value = dusk; u.uOver.value = o; u.uSunDir.value.copy(sun);
    }
    // the floodlights: on from dusk to dawn
    const lamp = sm(0.1, 0.0, se);
    for (const L of this.lamps) {
      L.spot.intensity = 2.6 * lamp;
      L.glow.material.opacity = 0.9 * lamp; L.face.material.color.setScalar(0.25 + 3 * lamp);
      L.mast.visible = isPano(app.backdrop.mode);
    }
    const hq = app.settings.quality === 'high';
    if (this.lamps[0].spot.castShadow !== hq) this.lamps[0].spot.castShadow = hq;
  }

  _lamps() {
    const app = this.app, y0 = TRAY.soil, H = MM(6500);
    this.lamps = [];
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e32, metalness: 0.6, roughness: 0.5 });
    for (const [sx, sz] of [[1, -1], [-1, 1]]) {
      const x = sx * (TRAY.innerX / 2 + MM(2500)), z = sz * (TRAY.innerZ / 2 + MM(2500));
      const mast = new THREE.Group(); mast.name = 'floodlight'; mast.userData.noWet = false;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(MM(55), MM(80), H, 10), steel); pole.position.set(x, y0 + H / 2, z);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(MM(700), MM(120), MM(700)), new THREE.MeshStandardMaterial({ color: 0x8e8b84, roughness: 0.9 })); foot.position.set(x, y0 + MM(60), z);
      // the lamp: a box with its glass face to the plot
      const head = new THREE.Group(); head.position.set(x, y0 + H + MM(150), z);
      head.lookAt(0, y0, 0);
      const box = new THREE.Mesh(new THREE.BoxGeometry(MM(620), MM(420), MM(180)), dark);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(MM(560), MM(360)), new THREE.MeshBasicMaterial({ color: 0x404040 }));
      face.position.z = MM(92);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffe2b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(MM(2600)); glow.position.z = MM(200);
      head.add(box, face, glow);
      for (const m of [pole, foot, box]) { m.castShadow = true; m.receiveShadow = true; }
      mast.add(pole, foot, head);
      app.scene.add(mast);
      const spot = new THREE.SpotLight(0xfff1d8, 0, 0, 0.62, 0.55, 0);
      spot.position.set(x, y0 + H + MM(100), z); spot.target.position.set(-x * 0.2, y0, -z * 0.2);
      spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.001;
      app.scene.add(spot, spot.target);
      this.lamps.push({ mast, spot, glow, face });
    }
  }

  // ---- the rain: streaks round the camera, splashes on the ground ----------------------------
  _rainMesh() {
    const N = 3000, pos = new Float32Array(N * 6), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const r = [Math.random(), Math.random(), Math.random()]; pos.set(r, i * 6); pos.set(r, i * 6 + 3); end[i * 2 + 1] = 1; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainU = { uC: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3(1, 1, 1) }, uT: { value: 0 }, uLen: { value: 0.01 }, uRain: { value: 0 }, uWind: { value: new THREE.Vector2(0.08, 0.03) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aEnd; uniform vec3 uC; uniform vec3 uB; uniform float uT; uniform float uLen; uniform vec2 uWind; varying float vE;
        void main() {
          float y = fract(position.y - uT * 1.6 + position.x * 7.13);
          vec3 w = uC + vec3((position.x - 0.5) * uB.x, y * uB.y, (position.z - 0.5) * uB.z);
          w.y += aEnd * uLen; w.xz += uWind * aEnd * uLen * 4.0;
          vE = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `uniform float uRain; varying float vE;
        void main() { gl_FragColor = vec4(0.74, 0.76, 0.8, (0.03 + 0.22 * vE) * uRain); }`,
    });
    this.rainLines = new THREE.LineSegments(g, m); this.rainLines.frustumCulled = false; this.rainLines.renderOrder = 20; this.rainLines.visible = false;
    this.app.scene.add(this.rainLines);
    // the splashes: little rings popping on the ground
    const M = 600, sp = new Float32Array(M * 3), seed = new Float32Array(M);
    for (let i = 0; i < M; i++) seed[i] = Math.random();
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(sp, 3)); g2.setAttribute('aS', new THREE.BufferAttribute(seed, 1));
    this.splU = { uT: { value: 0 }, uRain: { value: 0 }, uSize: { value: 30 } };
    const m2 = new THREE.ShaderMaterial({
      uniforms: this.splU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aS; uniform float uT; uniform float uSize; varying float vP;
        void main() {
          vP = fract(uT * 2.3 + aS * 17.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (0.3 + vP) / max(0.02, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float uRain; varying float vP;
        void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; q.y *= 2.6; float r = length(q);
          float ring = smoothstep(0.55, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r));
          gl_FragColor = vec4(0.85, 0.87, 0.9, ring * (1.0 - vP) * 0.6 * uRain); if (gl_FragColor.a < 0.01) discard; }`,
    });
    this.splash = new THREE.Points(g2, m2); this.splash.frustumCulled = false; this.splash.visible = false; this.splash.renderOrder = 19;
    this.app.scene.add(this.splash);
  }
  _rainUpdate(dt) {
    const app = this.app, cam = app.camera, r = this.rain, on = r > 0.01;
    this.rainLines.visible = this.splash.visible = on;
    if (!on) return;
    const rig = app.rig, dist = rig?.dist ?? 0.5, size = Math.min(1.4, Math.max(0.18, dist * 1.1));
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const c = cam.position.clone().addScaledVector(fwd, size * 0.45), g = TRAY.soil;
    const u = this.rainU;
    u.uC.value.set(c.x, Math.max(g - MM(200), cam.position.y - size * 0.6), c.z);
    u.uB.value.set(size, size * 1.2, size);
    u.uT.value = this.time * (0.86 / (size * 1.2)) / 1.6;   // (9 m/s)
    u.uLen.value = size * 0.026; u.uRain.value = r;
    this.rainLines.geometry.setDrawRange(0, Math.floor(6000 * (0.35 + 0.65 * r)));
    // the splashes round where the camera looks
    const s = this.splU; s.uT.value = this.time; s.uRain.value = r * sm(0.0, 0.3, this.wet + 0.1); s.uSize.value = MM(110) * app.renderer.domElement.height * 0.9;
    if ((this._spotsT -= dt) <= 0) {
      this._spotsT = 1.2;
      const t = app.terrain, p = this.splash.geometry.attributes.position, tg = rig?.target || new THREE.Vector3(), R = Math.min(0.8, Math.max(0.12, dist * 0.7));
      for (let i = 0; i < p.count; i++) {
        let x = tg.x + (Math.random() - 0.5) * 2 * R, z = tg.z + (Math.random() - 0.5) * 2 * R;
        x = t.clampX ? t.clampX(x) : x; z = t.clampZ ? t.clampZ(z) : z;
        p.setXYZ(i, x, (t.inside(x, z) ? t.heightAt(x, z) : g) + MM(10), z);
      }
      p.needsUpdate = true;
    }
  }

  // ---- the puddles: water lying level in the low places of the plot -------------------------
  _spots() {
    const t = this.app.terrain, step = 0.022, hx = TRAY.innerX / 2 - 0.02, hz = TRAY.innerZ / 2 - 0.02, out = [];
    const H = (x, z) => (t.inside(x, z) ? t.heightAt(x, z) : Infinity);
    const nx = Math.floor(2 * hx / step), nz = Math.floor(2 * hz / step), grid = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) grid.push(H(-hx + i * step, -hz + j * step));
    const at = (i, j) => (i < 0 || j < 0 || i > nx || j > nz ? Infinity : grid[j * (nx + 1) + i]);
    for (let j = 2; j <= nz - 2; j++) for (let i = 2; i <= nx - 2; i++) {
      const h = at(i, j);
      if (!isFinite(h)) continue;
      let low = true, rim = Infinity;
      for (let dj = -2; dj <= 2 && low; dj++) for (let di = -2; di <= 2; di++) if ((di || dj) && at(i + di, j + dj) < h) { low = false; break; }
      if (!low) continue;
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; rim = Math.min(rim, H(-hx + i * step + Math.cos(a) * step * 3, -hz + j * step + Math.sin(a) * step * 3)); }
      const depth = rim - h;
      if (depth > MM(15)) out.push({ x: -hx + i * step, z: -hz + j * step, h, depth, r: step * 3.4 });
    }
    out.sort((a, b) => b.depth - a.depth);
    const keep = [];
    for (const p of out) if (keep.length < 10 && keep.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > step * 4)) keep.push(p);
    // on flat ground: a few shallow ones (water does not soak in at once)
    let tries = 0;
    while (keep.length < 9 && tries++ < 80) {
      const x = (Math.random() * 2 - 1) * hx, z = (Math.random() * 2 - 1) * hz, h = H(x, z);
      if (!isFinite(h) || keep.some((q) => Math.hypot(q.x - x, q.z - z) < step * 4)) continue;
      keep.push({ x, z, h, depth: MM(6), r: MM(900) + Math.random() * MM(1400), flat: true });
    }
    return keep;
  }
  _puddlesUpdate(dt) {
    const G = this.puddles, f = this.pool;
    G.visible = f > 0.01;
    if (!G.visible) { if (G.children.length) this._clearPuddles(); return; }
    if (!G.children.length) {
      if (!this._pm) {
        this._pm = new THREE.MeshStandardMaterial({ color: 0x3a362f, roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.86, alphaMap: puddleTex(), normalMap: rippleTex(), normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
        this._pm.userData.noWet = true;
      }
      for (const p of this._spots()) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), this._pm);
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6.28; m.userData = { p, noWet: true }; m.receiveShadow = true; m.renderOrder = 3;
        G.add(m);
      }
    }
    for (const m of G.children) {
      const p = m.userData.p, k = sm(0, 1, f);
      // a basin fills up; on flat ground a film spreads
      if (p.flat) { m.scale.setScalar(p.r * (0.3 + 0.7 * k)); m.position.set(p.x, p.h + MM(1.5), p.z); }
      else { m.scale.setScalar(p.r); m.position.set(p.x, p.h + p.depth * 0.75 * k + MM(1), p.z); }
    }
    const nm = this._pm.normalMap; nm.offset.x = (nm.offset.x + dt * 0.05 * this.rain) % 1; nm.offset.y = (nm.offset.y + dt * 0.031 * this.rain) % 1;
    this._pm.normalScale.setScalar(0.08 + 0.5 * this.rain);
  }
  _clearPuddles() { for (const m of [...this.puddles.children]) { this.puddles.remove(m); m.geometry.dispose(); } }

  // ---- wet: what is out under the rain goes darker and shines; drops on metal and glass -------
  _wetScan() {
    const w = this.wet, app = this.app;
    if (w <= 0 && !this._wetOn) return;
    this._wetOn = w > 0;
    const tu = app.terrainMat?.userData?.uniforms?.uWet; if (tu) tu.value = w;
    const seen = new Set();
    app.scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || o.userData.noWet || !o.visible) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || seen.has(m) || m.userData.noWet || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial)) continue;
        seen.add(m);
        let r = this.mats.get(m);
        if (!r) this.mats.set(m, (r = { c: m.color.clone(), r: m.roughness, ac: m.color.clone(), ar: m.roughness }));
        // (someone changed it since: that is its colour now)
        if (!m.color.equals(r.ac)) r.c.copy(m.color);
        if (m.roughness !== r.ar) r.r = m.roughness;
        const metal = (m.metalness ?? 0) > 0.5, glass = m.transparent && (m.opacity ?? 1) < 0.5;
        if (metal || glass) {
          // drops of water: a normal map of drops (put on once), as strong as it is wet
          if (!m.normalMap && m.isMeshStandardMaterial) { m.normalMap = dropsTex(); m.normalScale = new THREE.Vector2(0, 0); m.needsUpdate = true; r.drops = true; }
          if (r.drops) m.normalScale.setScalar(1.1 * w);
          if (m.roughness !== undefined) m.roughness = r.r;
        } else {
          m.color.copy(r.c).multiplyScalar(1 - (m === app.terrainMat ? 0.45 : 0.36) * w * (r.r > 0.45 ? 1 : 0.5));
          if (m.roughness !== undefined && m !== app.terrainMat) m.roughness = r.r + (Math.max(0.3, r.r * 0.55) - r.r) * w;
        }
        r.ac.copy(m.color); r.ar = m.roughness;
      }
    });
  }

  _off() {
    this._wasOn = false;
    this.rainLines.visible = this.splash.visible = false;
    for (const L of this.lamps) { L.spot.intensity = 0; L.mast.visible = false; L.glow.material.opacity = 0; }
    this.app.renderer.toneMappingExposure = 1.05;
    this.app.sfx?.rain?.(0);
  }
}

// ---- the textures ------------------------------------------------------------------------------
let _glow, _pud, _rip, _drops;
function cv(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }
function glowTex() {
  if (_glow) return _glow;
  const c = cv(128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,240,210,0.6)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (_glow = new THREE.CanvasTexture(c));
}
// a puddle's outline: a ragged blob, soft at its edge
function puddleTex() {
  if (_pud) return _pud;
  const n = 256, c = cv(n), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * 6.28, d = Math.random() * 60, r = 30 + Math.random() * 45, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  }
  const t = new THREE.CanvasTexture(c); return (_pud = t);
}
function heightToNormal(h, n, k) {
  const src = h.getContext('2d').getImageData(0, 0, n, n).data, c = cv(n), g = c.getContext('2d'), img = g.createImageData(n, n);
  const H = (x, y) => src[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y + 1) - H(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// rings on the water where the drops fall
function rippleTex() {
  if (_rip) return _rip;
  const n = 256, h = cv(n), g = h.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * n, y = Math.random() * n, r = 4 + Math.random() * 16;
    for (const [ox, oy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? 200 : 60},0,0,0.5)`; g.lineWidth = 1.5; g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.28); g.stroke(); }
  }
  _rip = heightToNormal(h, n, 2.5); _rip.repeat.set(3, 3); return _rip;
}
// drops of water on metal and glass
function dropsTex() {
  if (_drops) return _drops;
  const n = 256, h = cv(n), g = h.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * n, y = Math.random() * n, r = 1.5 + Math.random() * Math.random() * 7;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 1.25, 0, 0, 6.28); g.fill();
  }
  _drops = heightToNormal(h, n, 6); _drops.repeat.set(2, 2); return _drops;
}
