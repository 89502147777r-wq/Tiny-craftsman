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
export const CAB = { floor: -1.22, roof: 0.46, front: 0.8, left: 0.52, right: -0.52, back: -0.5, bar: -0.26 };
// the joysticks' pivots (on the consoles' fronts), the pedals
const STICK = { l: new V(0.34, -0.6, 0.3), r: new V(-0.34, -0.6, 0.3) }, PEDAL = { l: new V(0.15, -1.12, 0.6), r: new V(-0.15, -1.12, 0.6) };
const TILT = 0.32;   // (the grip's lean at a stick pushed all the way, rad)

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
// the glass's dirt: dust thicker low and at the edges, the wiper's fan cleaner, a few drops' rings and streaks
function dirtTex(wiper) {
  return canvasTex(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const x = rnd() * w, y = rnd() * h, e = Math.min(x, w - x, y, h - y) / (w / 2), a = 0.05 + 0.25 * (1 - e) * (0.5 + y / h); g.fillStyle = `rgba(120,104,84,${a * rnd()})`; g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < 40; i++) { const x = rnd() * w, y = rnd() * h * 0.6; g.strokeStyle = `rgba(110,95,78,${0.05 + rnd() * 0.08})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 8, y + 30 + rnd() * 90); g.stroke(); }
    for (let i = 0; i < 60; i++) { const x = rnd() * w, y = rnd() * h, r = 2 + rnd() * 5; g.strokeStyle = `rgba(130,115,95,${0.12 + rnd() * 0.15})`; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
    if (wiper) { g.globalCompositeOperation = 'destination-out'; const cx = w * 0.5, cy = h * 1.02; for (let r = h * 0.35; r < h * 0.98; r += 2) { g.strokeStyle = `rgba(0,0,0,${0.55 + 0.25 * Math.sin(r * 0.05)})`; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r, Math.PI * 1.17, Math.PI * 1.83); g.stroke(); } g.globalCompositeOperation = 'source-over'; }
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

export class Cab {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'cab-inside'; this.group.visible = false;
    this.ready = this._build();
  }
  async _build() {
    const G = this.group, std = (o) => new THREE.MeshStandardMaterial(o);
    const paint = std({ map: grainTex('#2b2e31', 0.1, 30), roughness: 0.55, metalness: 0.3 });
    const plastic = std({ map: grainTex('#202224', 0.08), roughness: 0.75 });
    const rubber = std({ map: grainTex('#151617', 0.15), roughness: 0.95 });
    const head = std({ map: grainTex('#5c5f63', 0.06), roughness: 0.9 });
    const glassM = (wiper) => new THREE.MeshPhysicalMaterial({ color: 0xbfd4cf, transparent: true, opacity: 1, roughness: 0.08, metalness: 0, transmission: 0, alphaMap: null, map: dirtTex(wiper), depthWrite: false, side: THREE.DoubleSide, premultipliedAlpha: false });
    const box = (w, h, d, m, x, y, z, name) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.name = name || ''; G.add(o); return o; };
    const C = CAB, H = C.roof - C.floor, W = C.left - C.right;
    // floor (a rubber mat, dusty from the boots), roof (headliner), the back wall
    box(W, 0.03, C.front - C.back, std({ map: grainTex('#4b4741', 0.2, 50), roughness: 0.95 }), 0, C.floor - 0.015, (C.front + C.back) / 2, 'floor');
    box(W, 0.03, C.front - C.back, head, 0, C.roof + 0.015, (C.front + C.back) / 2, 'roof');
    box(W, H, 0.03, head, 0, (C.roof + C.floor) / 2, C.back - 0.015, 'back');
    // the pillars: the front two, the back two; the front glass's bar, the roof's front rail, the door's frame (left)
    for (const x of [C.left - 0.035, C.right + 0.035]) { box(0.07, H, 0.09, paint, x, (C.roof + C.floor) / 2, C.front - 0.045); box(0.07, H, 0.07, paint, x, (C.roof + C.floor) / 2, C.back + 0.05); }
    box(W, 0.06, 0.06, paint, 0, C.bar, C.front - 0.03, 'bar');
    box(W, 0.08, 0.1, paint, 0, C.roof - 0.04, C.front - 0.05, 'rail');
    box(0.05, 0.05, C.front - C.back, paint, C.left - 0.025, C.bar, (C.front + C.back) / 2, 'doorbar');
    // the glass: the front upper (wiped), the front lower, the sides, the roof window's front half
    const pane = (w, h, m, x, y, z, ry) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); o.position.set(x, y, z); o.rotation.y = ry; o.renderOrder = 5; G.add(o); return o; };
    pane(W - 0.1, C.roof - C.bar - 0.1, glassM(true), 0, (C.roof + C.bar) / 2, C.front - 0.01, Math.PI);
    pane(W - 0.1, C.bar - (C.floor + 0.32) - 0.05, glassM(false), 0, (C.bar + C.floor + 0.32) / 2, C.front - 0.01, Math.PI);
    box(W, 0.32, 0.04, paint, 0, C.floor + 0.16, C.front - 0.02, 'kick');
    for (const [x, ry] of [[C.left - 0.005, -Math.PI / 2], [C.right + 0.005, Math.PI / 2]]) pane(C.front - C.back - 0.18, H - 0.14, glassM(false), x, (C.roof + C.floor) / 2 + 0.02, (C.front + C.back) / 2, ry);
    // the wiper: parked down the left pillar, its arm and blade
    { const w = new THREE.Group(); w.position.set(C.left - 0.12, C.bar + 0.04, C.front - 0.03); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.62, 0.012), paint); arm.position.y = 0.31; w.add(arm); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.55, 0.01), rubber); blade.position.set(0, 0.36, -0.005); w.add(blade); w.rotation.z = -0.32; G.add(w); }
    // the consoles each side: their bodies, armrests (vinyl), the rubber boots under the grips
    for (const [k, x] of [['l', 0.34], ['r', -0.34]]) {
      box(0.24, 0.5, 0.62, plastic, x, -0.6 - 0.25, 0.08, 'console-' + k);
      box(0.15, 0.06, 0.34, std({ map: grainTex('#1d1d1d', 0.12), roughness: 0.6 }), x + Math.sign(x) * 0.03, -0.6 + 0.03, -0.12, 'armrest-' + k);
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.06, 16, 4), rubber); boot.position.copy(STICK[k]).add(new V(0, 0.03, 0)); G.add(boot);
    }
    // the travel levers and pedals before the seat
    for (const [k, x] of [['l', 0.15], ['r', -0.15]]) {
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8), paint); lever.position.set(x, C.floor + 0.32, 0.66); lever.rotation.x = -0.2; G.add(lever);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10), rubber); grip.position.set(x, C.floor + 0.6, 0.6); grip.rotation.x = -0.2; G.add(grip);
      const pedal = box(0.12, 0.02, 0.24, std({ map: grainTex('#3a3d40', 0.2, 60), roughness: 0.6, metalness: 0.6 }), x, C.floor + 0.12, 0.6, 'pedal-' + k); pedal.rotation.x = 0.55;
    }
    // the monitor: on its arm at the front right, turned to the driver — the logo, the gauges
    { const m = new THREE.Group(); m.position.set(C.right + 0.14, -0.3, C.front - 0.16); m.rotation.set(-0.4, 2.61, 0, 'YXZ');   // (its screen to the eye: back, left and up)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.17, 0.05), plastic); m.add(body);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.13), new THREE.MeshBasicMaterial({ map: screenTex('assets/brand/logo-line-light.png'), toneMapped: false })); scr.position.z = 0.026; m.add(scr); this.screen = scr;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8), paint); arm.position.set(0, -0.15, -0.02); m.add(arm); G.add(m); }
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
    G.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  }
  // the driver: loaded, measured by his bones, sat
  async _driver() {
    const g = await loader.loadAsync('assets/models/operator.glb').catch(() => null); if (!g) return;
    const man = g.scene; this.man = man; this.group.add(man);
    const bones = {}; man.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, '')] = o; if (o.isMesh) { o.frustumCulled = false; if (/Head|Eye/.test(o.name + ' ' + (o.material?.name || ''))) o.visible = false; } });
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
  pose(st) {
    const b = this.b, G = this.group; if (!b || !this.man) return;
    for (const [n, q] of Object.entries(this.rest)) b[n].quaternion.copy(q);
    for (const [k, piv] of Object.entries(this.sticks || {})) { const s = st[k] || [0, 0]; piv.rotation.set(s[1] * TILT, 0, -s[0] * TILT * (k === 'l' ? 1 : 1)); }
    const man = this.man; man.position.set(0, 0, 0); man.rotation.set(0, 0, 0); man.updateMatrixWorld(true);
    const W = (v) => G.localToWorld(v.clone());
    // the hips at the seat: 0,64 under the eye (the head's bone ~0,1 under the eyes), 0,14 behind it; the body upright, a little forward
    const hipsW = b.Hips.getWorldPosition(new V()), hipsL = G.worldToLocal(hipsW.clone()); man.position.add(new V(0, -0.64, -0.12).sub(hipsL)); man.updateMatrixWorld(true);
    b.Spine.rotation.x += 0.12; b.Spine.updateMatrixWorld(true);
    // the legs: the knees ahead, the feet on the pedals
    for (const [k, side] of [['Left', 'l'], ['Right', 'r']]) {
      const foot = W(PEDAL[side].clone().add(new V(0, 0.09, -0.05))), pole = W(new V(side === 'l' ? 0.7 : -0.7, 0.1, 0.8));
      this._ik(b[k + 'UpLeg'], b[k + 'Leg'], b[k + 'Foot'], foot, pole);
      if (b[k + 'ToeBase']) this._aim(b[k + 'Foot'], b[k + 'ToeBase'], W(PEDAL[side].clone().add(new V(0, 0.02, 0.12))));
    }
    // the arms: the hands on the grips, the elbows down and out
    for (const [k, side] of [['Left', 'l'], ['Right', 'r']]) {
      const piv = this.sticks?.[side]; if (!piv) continue; piv.updateMatrixWorld(true);
      // the hand over the grip's top as a driver holds it: the palm down on the knob, the fingers forward and down round its front, the
      // thumb on its inner side, not up (the owner); the hand leans with the stick
      const pq = piv.getWorldQuaternion(new Q());
      const f = new V(0, -0.45, 1).normalize().applyQuaternion(pq), n = new V(0, -1, -0.45).normalize().applyQuaternion(pq);
      const top = piv.localToWorld(new V(0, this.gripH * 0.92, 0.0)), s = G.getWorldScale(new V()).x;
      const palm = top.clone().addScaledVector(n, -0.012 * s).add(new V(0, 0, -0.015 * s).applyQuaternion(pq)), wrist = palm.clone().addScaledVector(f, -0.08 * s);
      const elbowPole = W(new V(side === 'l' ? 0.7 : -0.7, -0.9, -0.4));
      this._ik(b[k + 'Arm'], b[k + 'ForeArm'], b[k + 'Hand'], wrist, elbowPole);
      this._orient(b[k + 'Hand'], b, k, side, f, n);
      // the fingers down round the knob's front (~45°, 55°, 35° at the three joints), the thumb along its inner side
      [0.75, 0.95, 0.6].forEach((a, i) => this._curl(b[k + 'HandIndex' + (i + 1)], b, k, side, a));
      [0.3, 0.35, 0.25].forEach((a, i) => this._curl(b[k + 'HandThumb' + (i + 1)], b, k, side, a, true));
    }
  }
}
