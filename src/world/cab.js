import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The excavator's cab from inside (the owner, 2026-11-19, a photo from a cab: «a realistic view from the cab — the hands on the
// joysticks, the boots on the pedals, the monitors with the logo, the small things; the camera turned with the finger»). The model's own
// cab is half the height of a real one (0,7 m floor to roof): from inside it is hidden and this one, real size round the driver's eyes,
// is drawn instead — in metres, the eye at its origin, +z ahead, +x to the driver's left (the boom on his right), y up.
// The driver: «Worker talk animation» (Sketchfab, Bazsi1986, CC BY — CREDITS.md), a Mixamo rig: sat by his bones, his hands put on
// the joysticks (two-bone IK) every frame they move, the fingers closed round the grips, the thumb along the grip's side, not up;
// his boots on the travel pedals; his head not drawn (the camera is in it).
// The joysticks: «joy t» (Sketchfab, angeloraffaelecatalano, CC BY): a machine's grip, tilted with the sticks on the screen.
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const V = THREE.Vector3, Q = THREE.Quaternion;
// the cab (m, from the eye): floor, roof, the front glass, the side walls, the back
export const CAB = { floor: -1.22, roof: 0.46, front: 0.8, left: 0.52, right: -0.52, back: -0.5, bar: -0.45 };   // (bar: the front glass's lower edge, 0,77 over the floor — the realist)
// the joysticks' pivots (on the consoles' fronts), the pedals
// (the grips ~0,25–0,3 ahead of the elbows on the armrests, ±0,28 — the realist; in sight at the picture's lower corners; the pedals hinged at their back edges on a housing)
const STICK = { l: new V(0.28, -0.6, 0.28), r: new V(-0.28, -0.6, 0.28) };
const TILT = 0.32;   // (the grip's lean at a stick pushed all the way, rad)

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
// the glass's dirt: dust thicker low and at the edges, the wiper's fan cleaner, a few drops' rings and streaks
function dirtTex(wiper) {
  return canvasTex(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(191,212,207,0.06)'; g.fillRect(0, 0, w, h);   // (the dust light and thin: the ground behind the glass seen through it — the realist)
    for (let i = 0; i < 9000; i++) { const x = rnd() * w, y = rnd() * h, e = Math.min(x, w - x, y, h - y) / (w / 2), a = 0.03 + 0.12 * (1 - e) * (0.5 + y / h); g.fillStyle = `rgba(184,165,138,${a * rnd()})`; g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < 40; i++) { const x = rnd() * w, y = rnd() * h * 0.6; g.strokeStyle = `rgba(184,165,138,${0.04 + rnd() * 0.06})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 8, y + 30 + rnd() * 90); g.stroke(); }
    for (let i = 0; i < 30; i++) { const x = rnd() * w, y = rnd() * h, r = 1 + rnd() * 2.5; g.strokeStyle = `rgba(184,165,138,${0.08 + rnd() * 0.1})`; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
    if (wiper) { g.globalCompositeOperation = 'destination-out'; const cx = w * wiper, cy = h * 1.0; for (let r = h * 0.3; r < h * 0.97; r += 2) { g.strokeStyle = `rgba(0,0,0,${0.55 + 0.25 * Math.sin(r * 0.05)})`; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r, Math.PI * 1.5, Math.PI * 1.97); g.stroke(); } g.globalCompositeOperation = 'source-over'; }   // (the fan about the wiper's pivot by the left pillar: 85° from the pillar)
  });
}
// worn paint, rubber, plastic — small grain so they do not read as flat colour
function grainTex(base, k = 0.12, scratches = 0) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { const v = (rnd() - 0.5) * k * 255; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < scratches; i++) { g.strokeStyle = `rgba(200,200,200,${0.1 + rnd() * 0.2})`; g.lineWidth = 1; g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 10); g.stroke(); }
  });
}
// the monitor's screen: the logo over the gauges (engine speed, fuel, coolant), the time, the mode
function screenTex(logo) {
  const t = canvasTex(512, 320, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#16202a'); bg.addColorStop(1, '#0b1015'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8ecef'; g.font = 'bold 26px sans-serif'; g.fillText('09:41', 16, 34); g.fillStyle = '#9fb3c2'; g.font = '20px sans-serif'; g.fillText('MODE  P', w - 120, 34);
    const gauge = (cx, cy, r, f, label, col) => { g.lineWidth = 12; g.strokeStyle = '#2a3642'; g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); g.stroke(); g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * f)); g.stroke(); g.fillStyle = '#cfd8de'; g.font = '18px sans-serif'; g.textAlign = 'center'; g.fillText(label, cx, cy + 8); g.textAlign = 'left'; };
    gauge(100, 200, 62, 0.62, 'RPM', '#f2b632'); gauge(256, 200, 62, 0.8, 'FUEL', '#5fd068'); gauge(412, 200, 62, 0.45, 'TEMP', '#58a6ff');
  });
  if (logo) { const img = new Image(); img.onload = () => { const g = t.image.getContext('2d'); const w = 200, hh = w * img.height / img.width; g.drawImage(img, (512 - w) / 2, 46, w, hh); t.needsUpdate = true; }; img.src = logo; }
  return t;
}

// under the cab's roof the sun does not reach: its direct light on the driver and the cab's insides ×0,25 (the sky's and the ground's
// light ×0,5 — the roof and the walls hide half the sky; the form reads by it); the shadow map is not drawn every frame on a phone, so this, not shadows (the realist, round 3)
const SHADE = { value: 0.25 };
function shaded(m) {
  if (!m || m.transparent || m.userData.shaded) return m; m.userData.shaded = true;
  m.onBeforeCompile = (sh) => { sh.uniforms.uShade = SHADE; sh.fragmentShader = 'uniform float uShade;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directDiffuse *= uShade; reflectedLight.directSpecular *= uShade; reflectedLight.indirectDiffuse *= 0.5; reflectedLight.indirectSpecular *= 0.5;'); };
  m.customProgramCacheKey = () => 'cab-shaded'; m.needsUpdate = true; return m;
}
export class Cab {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'cab-inside'; this.group.visible = false;
    this.ready = this._build();
  }
  async _build() {
    const G = this.group, std = (o) => new THREE.MeshStandardMaterial(o);
    // (no metal in the paint: without reflections it reads black — the realist; a little light of their own for the light that comes in
    // through the glass from all round)
    const lit = (o) => std({ ...o, emissive: 0x6a6a6a, emissiveMap: o.map, emissiveIntensity: 0.13 });
    const paint = lit({ map: grainTex('#4a4d50', 0.1, 30), roughness: 0.6, metalness: 0 });
    const plastic = lit({ map: grainTex('#404346', 0.08), roughness: 0.75 });
    const rubber = lit({ map: grainTex('#1f2021', 0.15), roughness: 0.95 });
    const head = lit({ map: grainTex('#8a8c8e', 0.06), roughness: 0.9 }); head.emissiveIntensity = 0.55;   // (the headliner lit from below — the floor, the knees, the glass)
    const tint = new THREE.MeshPhysicalMaterial({ color: 0x5f6f66, transparent: true, opacity: 0.55, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    const glassM = (wiper) => new THREE.MeshPhysicalMaterial({ color: 0xbfd4cf, transparent: true, opacity: 1, roughness: 0.05, metalness: 0, transmission: 0, alphaMap: null, map: dirtTex(wiper), depthWrite: false, side: THREE.DoubleSide, premultipliedAlpha: false });
    const box = (w, h, d, m, x, y, z, name, parent = G) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.name = name || ''; parent.add(o); return o; };
    const cyl = (r0, r1, h, m, x, y, z, parent = G) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 12), m); o.position.set(x, y, z); parent.add(o); return o; };
    const C = CAB, H = C.roof - C.floor, W = C.left - C.right, D = C.front - C.back;
    // floor: a ribbed rubber mat, dusty from the boots
    box(W, 0.03, D, lit({ map: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#2a2a29'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) { g.fillStyle = '#383735'; g.fillRect(0, y, w, 3); } for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(150,128,100,${Math.random() * 0.18})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }), roughness: 0.95 }), 0, C.floor - 0.015, (C.front + C.back) / 2, 'floor');
    // the roof: a headliner round a window over the front half (tinted, its guard's bars)
    const rw = [-0.25, 0.25], rz = [0.15, 0.55];
    box(W, 0.03, rz[0] - C.back, head, 0, C.roof + 0.015, (rz[0] + C.back) / 2, 'roof');
    box(W, 0.03, C.front - rz[1], head, 0, C.roof + 0.015, (C.front + rz[1]) / 2, 'roof');
    for (const [a, b] of [[C.right, rw[0]], [rw[1], C.left]]) box(b - a, 0.03, rz[1] - rz[0], head, (a + b) / 2, C.roof + 0.015, (rz[0] + rz[1]) / 2, 'roof');
    { const o = new THREE.Mesh(new THREE.PlaneGeometry(rw[1] - rw[0], rz[1] - rz[0]), tint); o.rotation.x = Math.PI / 2; o.position.set(0, C.roof + 0.03, (rz[0] + rz[1]) / 2); G.add(o); }
    for (let k = 1; k <= 3; k++) box(0.015, 0.015, rz[1] - rz[0], paint, rw[0] + (rw[1] - rw[0]) * k / 4, C.roof + 0.05, (rz[0] + rz[1]) / 2, 'guard');
    // the back: a wall up to the bar's height, a window over it (the hood and the counterweight behind)
    box(W, -0.2 - C.floor, 0.03, head, 0, (C.floor - 0.2) / 2, C.back - 0.015, 'back');
    box(W, 0.08, 0.03, head, 0, C.roof - 0.04, C.back - 0.015, 'back');
    // the pillars: the front two, the back two; the front glass's bar, the roof's front rail, the door's frame (left)
    for (const x of [C.left - 0.035, C.right + 0.035]) { box(0.07, H, 0.09, paint, x, (C.roof + C.floor) / 2, C.front - 0.045); box(0.07, H, 0.07, paint, x, (C.roof + C.floor) / 2, C.back + 0.05); }
    box(W, 0.06, 0.06, paint, 0, C.bar, C.front - 0.03, 'bar');
    box(W, 0.08, 0.1, paint, 0, C.roof - 0.04, C.front - 0.05, 'rail');
    box(0.05, 0.05, D, paint, C.left - 0.025, C.bar, (C.front + C.back) / 2, 'doorbar');
    box(0.05, H, 0.05, paint, C.left - 0.025, (C.roof + C.floor) / 2, 0.05, 'doorpost');
    box(0.04, 0.04, D, paint, C.right + 0.02, C.bar, (C.front + C.back) / 2, 'rightbar');   // (the right glass's frame bar at the front bar's height, as a CAT 320's)
    box(0.02, 0.14, 0.03, rubber, C.left - 0.06, -0.25, 0.1, 'doorhandle');
    // the upper front glass's two latches under the rail
    for (const x of [0.3, -0.3]) box(0.06, 0.03, 0.04, rubber, x, C.roof - 0.1, C.front - 0.06, 'latch');
    // the glass: the front upper (wiped), the front lower, the sides, the back window
    const pane = (w, h, m, x, y, z, ry) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); o.position.set(x, y, z); o.rotation.y = ry; o.renderOrder = 5; G.add(o); return o; };
    // (the wiper's pivot at x 0,40: the pane is turned round, its u from +x — (0,47 − 0,40) / 0,94)
    pane(W - 0.1, C.roof - C.bar - 0.1, glassM((W / 2 - 0.05 - (C.left - 0.12)) / (W - 0.1)), 0, (C.roof + C.bar) / 2, C.front - 0.01, Math.PI);
    pane(W - 0.1, C.bar - (C.floor + 0.32) - 0.05, glassM(0), 0, (C.bar + C.floor + 0.32) / 2, C.front - 0.01, Math.PI);
    pane(W - 0.1, C.roof - 0.08 + 0.2, glassM(0), 0, (C.roof - 0.08 - 0.2) / 2, C.back + 0.002, 0);
    box(W, 0.32, 0.04, paint, 0, C.floor + 0.16, C.front - 0.02, 'kick');
    for (const [x, ry] of [[C.left - 0.005, -Math.PI / 2], [C.right + 0.005, Math.PI / 2]]) pane(D - 0.18, H - 0.14, glassM(0), x, (C.roof + C.floor) / 2 + 0.02, (C.front + C.back) / 2, ry);
    // the wiper: outside the glass, parked down the left pillar, its arm and blade
    { const w = new THREE.Group(); w.position.set(C.left - 0.12, C.bar + 0.04, C.front + 0.02); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.62, 0.012), paint); arm.position.y = 0.31; w.add(arm); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.55, 0.01), rubber); blade.position.set(0, 0.36, -0.005); w.add(blade); w.rotation.z = -0.32; G.add(w); }
    // the mirror outside the left pillar; vents on the pillars
    { const m = new THREE.Group(); m.position.set(C.left + 0.16, C.bar + 0.1, C.front - 0.05); box(0.18, 0.004, 0.004, paint, -0.08, 0, 0, '', m); box(0.12, 0.2, 0.02, rubber, 0.02, 0, 0, '', m); const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.18), std({ color: 0x9aa6ae, roughness: 0.05, metalness: 1 })); gl.position.set(0.02, 0, -0.011); gl.rotation.y = Math.PI; m.add(gl); m.rotation.y = 0.35; G.add(m); }
    for (const x of [C.left - 0.08, C.right + 0.08]) { const v = cyl(0.03, 0.03, 0.02, rubber, x, C.bar + 0.12, C.front - 0.1); v.rotation.x = Math.PI / 2 - 0.3; }
    // the consoles each side, standing on the floor: their bodies, armrests (vinyl, on to the grips), the rubber boots under the grips
    const vinyl = lit({ map: grainTex('#262626', 0.12), roughness: 0.6 });
    for (const [k, x] of [['l', 0.37], ['r', -0.37]]) {
      box(0.2, -0.6 - C.floor, 0.62, plastic, x, (C.floor - 0.6) / 2, 0.08, 'console-' + k);
      box(0.13, 0.06, 0.4, vinyl, x + Math.sign(x) * 0.03, -0.6 + 0.03, -0.05, 'armrest-' + k);
      const boot = cyl(0.035, 0.06, 0.06, rubber, 0, 0, 0); boot.position.copy(STICK[k]).add(new V(0, 0.03, 0));
    }
    // the hydraulics' lock lever by the left console (yellow, down: working); the right console's engine dial, its keys, the radio
    { const l = cyl(0.012, 0.012, 0.3, lit({ color: 0xd8a420, roughness: 0.5 }), 0.26, -0.72, -0.05); l.rotation.x = -0.9; }
    { const dial = cyl(0.025, 0.025, 0.02, rubber, -0.4, -0.59, 0.32); void dial; const panel = box(0.12, 0.005, 0.16, lit({ map: canvasTex(64, 96, (g, w, h) => { g.fillStyle = '#1c1d1f'; g.fillRect(0, 0, w, h); const cs = ['#d9d9d9', '#58a6ff', '#f2b632', '#5fd068']; for (let i = 0; i < 8; i++) { g.fillStyle = '#2e3033'; g.fillRect(8 + (i % 2) * 28, 8 + Math.floor(i / 2) * 20, 20, 14); g.fillStyle = cs[i % 4]; g.fillRect(14 + (i % 2) * 28, 13 + Math.floor(i / 2) * 20, 8, 3); } }), roughness: 0.7 }), -0.4, -0.598, 0.04, 'keys'); void panel; }
    // the fire extinguisher (red) and the glass hammer at the back right pillar
    cyl(0.05, 0.05, 0.32, lit({ color: 0xb01c14, roughness: 0.45 }), C.right + 0.035, C.floor + 0.2, C.back + 0.135);
    // (the hammer 0,25 long in its clip on the pillar's face; the extinguisher in a strap on it)
    box(0.022, 0.22, 0.022, rubber, C.right + 0.085, -0.07, C.back + 0.1, 'hammer'); box(0.03, 0.035, 0.09, lit({ color: 0xc0201a, roughness: 0.5 }), C.right + 0.085, 0.055, C.back + 0.1, 'hammer-head');
    box(0.03, 0.04, 0.05, plastic, C.right + 0.085, 0.02, C.back + 0.1, 'clip');
    cyl(0.053, 0.053, 0.03, paint, C.right + 0.035, C.floor + 0.28, C.back + 0.135); box(0.04, 0.03, 0.03, paint, C.right + 0.035, C.floor + 0.28, C.back + 0.07, 'bracket');
    // the travel pedals and their levers on a housing before the seat, each hinged at its back edge (moved with its track — pose())
    box(0.46, 0.1, 0.32, plastic, 0, C.floor + 0.05, 0.6, 'housing');
    this.pedals = {};
    for (const [k, x] of [['l', 0.15], ['r', -0.15]]) {
      const pv = new THREE.Group(); pv.position.set(x, C.floor + 0.1, 0.46); G.add(pv);
      box(0.12, 0.02, 0.26, lit({ map: grainTex('#3a3d40', 0.2, 60), roughness: 0.7, metalness: 0 }), 0, 0.01, 0.13, 'pedal-' + k, pv);
      for (let r = 0; r < 4; r++) box(0.1, 0.006, 0.02, rubber, 0, 0.023, 0.04 + r * 0.06, '', pv);
      const lv = new THREE.Group(); lv.position.set(x, C.floor + 0.1, 0.7); G.add(lv);
      cyl(0.012, 0.012, 0.5, paint, 0, 0.25, 0, lv); cyl(0.02, 0.02, 0.1, rubber, 0, 0.5, 0, lv); cyl(0.03, 0.045, 0.06, rubber, 0, 0.03, 0, lv);
      this.pedals[k] = { pv, lv };
    }
    // the monitor: on a bracket from the right front pillar, turned to the driver — the logo, the gauges; a screen as bright as a real
    // one in the day (not lit past the sky), glass over it
    { const m = new THREE.Group(); m.position.set(C.right + 0.14, -0.3, C.front - 0.16); m.rotation.set(-0.4, 2.61, 0, 'YXZ');   // (its screen to the eye: back, left and up)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.17, 0.05), plastic); m.add(body);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.13), new THREE.MeshBasicMaterial({ map: screenTex('assets/brand/logo-line-light.png'), color: 0xb3b3b3 })); scr.position.z = 0.026; m.add(scr); this.screen = scr;
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false })); sg.position.z = 0.028; m.add(sg);
      G.add(m); m.updateMatrix();
      // (the bracket: from the pillar's inner face to the monitor's back)
      const a = new V(C.right + 0.035, -0.3, C.front - 0.08), b = new V(0, 0, -0.03).applyMatrix4(m.matrix), d = b.clone().sub(a);
      const br = cyl(0.014, 0.014, d.length(), paint, 0, 0, 0); br.position.copy(a).addScaledVector(d, 0.5); br.quaternion.setFromUnitVectors(new V(0, 1, 0), d.normalize()); }
    // the joysticks
    this.sticks = {};
    const jg = await loader.loadAsync('assets/models/joystick.glb').catch(() => null);
    for (const [k, p] of Object.entries(STICK)) {
      const piv = new THREE.Group(); piv.position.copy(p); G.add(piv);
      if (jg) { const j = jg.scene.clone(true); j.traverse((o) => { if (o.isMesh) { const n = o.material?.name || ''; o.material = /Plastic1/.test(n) ? std({ color: 0xe0a030, roughness: 0.5, side: THREE.DoubleSide }) : std({ map: grainTex(/Plastic7/.test(n) ? '#1a1b1c' : '#2a2b2d', 0.1), roughness: /lambert/.test(n) ? 0.9 : 0.6, side: THREE.DoubleSide }); } });
        const b = new THREE.Box3().setFromObject(j), c = b.getCenter(new V()); j.position.set(k === 'l' ? -c.x : c.x, -b.min.y, c.z); j.rotation.y = Math.PI; if (k === 'l') j.scale.x = -1; piv.add(j); this.gripH = b.max.y - b.min.y; }   // (turned: the trigger to the front)
      this.sticks[k] = piv;
    }
    this.gripH ||= 0.18;
    await this._driver();
    // (the roof, the walls, the pillars and the consoles shade what is inside — the sun comes in only through the glass, the pillars'
    // shadows over the knees; the glass and the driver cast none (his own would only flicker on him), all of it takes them — the realist)
    G.traverse((o) => { if (!o.isMesh) return; o.frustumCulled = false; let man = false; for (let p = o; p; p = p.parent) if (p === this.man) man = true;
      o.receiveShadow = true; o.castShadow = !man && !o.material?.transparent; if (!o.material?.isMeshBasicMaterial) shaded(o.material); });
  }
  // the driver: loaded, measured by his bones, sat
  async _driver() {
    const g = await loader.loadAsync('assets/models/operator.glb').catch(() => null); if (!g) return;
    const man = g.scene; this.man = man; this.group.add(man);
    const bones = {}; man.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, '')] = o; if (o.isMesh) { o.frustumCulled = false; const mn = o.material?.name || '';
      // (no head, eyes or hair — the camera is in his head; the trousers darker work-blue, the shoes dark brown work boots — the realist)
      if (/Head|Eye/.test(o.name + ' ' + mn) || mn === 'obj_default.001') o.visible = false;
      if (mn === 'Material.010') { o.material.color.setRGB(0.75, 0.62, 0.38); this._noStraps(o.geometry); } if (mn === 'shirt') o.material.color.setRGB(0.5, 0.5, 0.5); if (/shirt|Material\.01/.test(mn)) o.material.side = THREE.DoubleSide;   // (the sleeves' and the trousers' insides drawn: no hole at the shoulder seen from behind)
     
      if (mn === 'Material.012') o.material.color.setRGB(0.3, 0.2, 0.13);  } });   // (linear: ×0,6 and ×0,45 in sRGB)
    this.b = bones;
    // his size: the model's rest height to 1,8 m
    // (by his bones — the mesh's own box is in other units than the skeleton that moves it: the head's top to a foot, 1,72 m in a 1,8 m man)
    this.group.updateMatrixWorld(true); const top = this.group.worldToLocal((bones.HeadTop_End || bones.Head).getWorldPosition(new V())), ft = this.group.worldToLocal(bones.LeftFoot.getWorldPosition(new V()));   // (in the cab's metres)
    const s = 1.72 / Math.max(1e-6, top.y - ft.y); man.scale.multiplyScalar(s); this.k = s;
    this.rest = {}; for (const [n, b] of Object.entries(bones)) this.rest[n] = b.quaternion.clone();
    this.palm = {}; man.updateMatrixWorld(true); const down = new V(0, -1, 0).applyQuaternion(man.getWorldQuaternion(new Q()));
    for (const k of ['Left', 'Right']) this.palm[k] = down.clone().applyQuaternion(bones[k + 'Hand'].getWorldQuaternion(new Q()).invert());
    this.pose({ l: [0, 0], r: [0, 0] });
  }
  // the overalls' straps over the shoulders off (above the chest, the top 14 % of the trousers' mesh): skinned, they stood off the
  // shoulder as an empty frame when the look went round — the bib in front stays (the realist, round 4)
  _noStraps(g) {
    const P = g.attributes.position; g.computeBoundingBox(); const b = g.boundingBox, cut = b.min.y + (b.max.y - b.min.y) * 0.86;
    const idx = g.index ? g.index.array : Array.from({ length: P.count }, (_, i) => i), keep = [];
    for (let i = 0; i < idx.length; i += 3) { if (P.getY(idx[i]) > cut || P.getY(idx[i + 1]) > cut || P.getY(idx[i + 2]) > cut) continue; keep.push(idx[i], idx[i + 1], idx[i + 2]); }
    g.setIndex(keep);
  }
  // a bone turned so its child (or a point down its length) points at a world point
  _aim(bone, child, target) {
    bone.updateWorldMatrix(true, true);
    const a = bone.getWorldPosition(new V()), c = child.getWorldPosition(new V()), from = c.sub(a).normalize(), to = target.clone().sub(a).normalize();
    const dq = new Q().setFromUnitVectors(from, to), wq = bone.getWorldQuaternion(new Q()), pq = bone.parent.getWorldQuaternion(new Q());
    bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq))); bone.updateWorldMatrix(false, true);
  }
  // two bones from a root to an end, the end on a target, the middle joint bent toward a pole
  _ik(up, mid, end, target, pole) {
    up.updateWorldMatrix(true, true);
    const A = up.getWorldPosition(new V()), B = mid.getWorldPosition(new V()), Cc = end.getWorldPosition(new V());
    const a = A.distanceTo(B), b = B.distanceTo(Cc), d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, A.distanceTo(target)));
    const dir = target.clone().sub(A).normalize(), x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
    const side = pole.clone().sub(A); side.addScaledVector(dir, -side.dot(dir)).normalize();
    const knee = A.clone().addScaledVector(dir, x).addScaledVector(side, h);
    this._aim(up, mid, knee); this._aim(mid, end, A.clone().addScaledVector(dir, d));
  }
  // the hand's own axes now: its fingers' way (to the fingers' root — the model's hand is a mitten, one chain of finger bones) and its palm's
  // normal (down in the rest pose, T with the palms down — kept in the hand's own frame)
  _handAxes(b, k) {
    const H = b[k + 'Hand'], h = H.getWorldPosition(new V()), f = b[k + 'HandIndex1'].getWorldPosition(new V()).sub(h).normalize();
    const n = this.palm[k].clone().applyQuaternion(H.getWorldQuaternion(new Q())); n.addScaledVector(f, -n.dot(f)).normalize(); return { f, n };
  }
  // the hand turned so its fingers go along f and its palm faces n
  _orient(H, b, k, side, f, n) {
    if (!b[k + 'HandIndex1'] || !this.palm) return; H.updateWorldMatrix(true, true);
    const a = this._handAxes(b, k), m0 = new THREE.Matrix4().makeBasis(a.f, a.n, a.f.clone().cross(a.n)), n1 = n.clone().addScaledVector(f, -n.dot(f)).normalize();
    const m1 = new THREE.Matrix4().makeBasis(f, n1, f.clone().cross(n1)), dq = new Q().setFromRotationMatrix(m1.multiply(m0.transpose()));
    const wq = H.getWorldQuaternion(new Q()), pq = H.parent.getWorldQuaternion(new Q()); H.quaternion.copy(pq.invert().multiply(dq.multiply(wq))); H.updateWorldMatrix(false, true);
  }
  // one finger joint bent toward the palm by a (rad): about the hand's across-axis (a thumb — about the fingers' way, toward the palm)
  _curl(bn, b, k, side, a, thumb) {
    if (!bn) return; const ax = this._handAxes(b, k), axis = (thumb ? ax.f.clone() : ax.f.clone().cross(ax.n)).normalize();
    // (the sign: the bone's way turned by +a about f × n goes toward n — toward the palm)
    const dq = new Q().setFromAxisAngle(axis, thumb ? (side === 'r' ? -a : a) : a), wq = bn.getWorldQuaternion(new Q()), pq = bn.parent.getWorldQuaternion(new Q());
    bn.quaternion.copy(pq.invert().multiply(dq.multiply(wq))); bn.updateWorldMatrix(false, true);
  }
  // the pose for the sticks now: seated, the hands on the grips, the grips leaning as the sticks are pushed
  // the pose now: the sticks (as on the screen, each [x, y]), the pedals (each track's speed −1..1), the look's turn (rad) and the time
  // since the last pose — the grips and pedals follow with a spring (~0,05 s), as a real stick let go comes back to its middle
  pose(st, dt = 1) {
    const b = this.b, G = this.group; if (!b || !this.man) return;
    const sp = (this._sp ||= { l: [0, 0], r: [0, 0], p: [0, 0] }), f = 1 - Math.exp(-dt / 0.05);
    for (const k of ['l', 'r']) for (let i = 0; i < 2; i++) sp[k][i] += ((st[k] || [0, 0])[i] - sp[k][i]) * f;
    for (let i = 0; i < 2; i++) sp.p[i] += ((st.pedals || [0, 0])[i] - sp.p[i]) * f;
    for (const [n, q] of Object.entries(this.rest)) b[n].quaternion.copy(q);
    for (const [k, piv] of Object.entries(this.sticks || {})) { const s = sp[k]; piv.rotation.set(s[1] * TILT, 0, -s[0] * TILT); }
    // (the pedals hinged at their back edges, the toes up ~23°, each pushed with its track ±0,22 rad; its lever with it)
    for (const [i, k] of [[0, 'l'], [1, 'r']]) { const P = this.pedals?.[k]; if (!P) continue; P.pv.rotation.x = -0.4 + 0.22 * sp.p[i]; P.lv.rotation.x = 0.22 * sp.p[i]; P.pv.updateMatrixWorld(true); }
    const man = this.man; man.position.set(0, 0, 0); man.rotation.set(0, 0, 0); man.updateMatrixWorld(true);
    const W = (v) => G.localToWorld(v.clone());
    // the hips at the seat: 0,64 under the eye (the head's bone ~0,1 under the eyes), 0,12 behind it; the body upright, a little forward;
    // looking far round (past the neck's 1,4 rad) the body turns too, up to 0,8 rad
    const hipsW = b.Hips.getWorldPosition(new V()), hipsL = G.worldToLocal(hipsW.clone()); man.position.add(new V(0, -0.64, -0.12).sub(hipsL)); man.updateMatrixWorld(true);
    const lk = st.look || 0, tw = Math.sign(lk) * Math.min(0.8, Math.max(0, Math.abs(lk) - 1.4));
    b.Spine.rotation.x += 0.12; b.Spine.rotation.y += tw; b.Spine.updateMatrixWorld(true);
    // the legs: the knees apart and up, the boots flat on the pedals (the heel by the hinge, the sole along the plate)
    for (const [k, side] of [['Left', 'l'], ['Right', 'r']]) {
      const pv = this.pedals?.[side]?.pv; if (!pv) continue;
      const foot = pv.localToWorld(new V(0, 0.02 + 0.085, 0.05)), toe = pv.localToWorld(new V(0, 0.02 + 0.035, 0.2)), pole = W(new V(side === 'l' ? 0.5 : -0.5, 0.1, 0.8));
      this._ik(b[k + 'UpLeg'], b[k + 'Leg'], b[k + 'Foot'], foot, pole);
      if (b[k + 'ToeBase']) this._aim(b[k + 'Foot'], b[k + 'ToeBase'], toe);
    }
    // the arms: the hands on the grips, the elbows down and out
    for (const [k, side] of [['Left', 'l'], ['Right', 'r']]) {
      const piv = this.sticks?.[side]; if (!piv) continue; piv.updateMatrixWorld(true);
      // the hand over the grip's top as a driver holds it: the palm down on the knob, the fingers forward and down round its front, the
      // thumb on its inner side, not up (the owner); the hand leans with the stick
      const pq = piv.getWorldQuaternion(new Q());
      const f = new V(0, -0.05, 1).normalize().applyQuaternion(pq), n = new V(0, -1, -0.05).normalize().applyQuaternion(pq);   // (the palm along the knob's top, the wrist straight)
      const top = piv.localToWorld(new V(0, this.gripH * 0.92, 0.0)), s = G.getWorldScale(new V()).x;
      const palm = top.clone().addScaledVector(n, -0.024 * s).add(new V(0, 0, -0.015 * s).applyQuaternion(pq)), wrist = palm.clone().addScaledVector(f, -0.08 * s);
      const elbowPole = W(new V(side === 'l' ? 0.35 : -0.35, -1.0, -0.5));
      this._ik(b[k + 'Arm'], b[k + 'ForeArm'], b[k + 'Hand'], wrist, elbowPole);
      this._orient(b[k + 'Hand'], b, k, side, f, n);
      // the fingers down round the knob's front (~45°, 55°, 35° at the three joints), the thumb along its inner side
      [0.75, 0.95, 0.6].forEach((a, i) => this._curl(b[k + 'HandIndex' + (i + 1)], b, k, side, a));
      [0.3, 0.35, 0.25].forEach((a, i) => this._curl(b[k + 'HandThumb' + (i + 1)], b, k, side, a, true));
    }
  }
}
