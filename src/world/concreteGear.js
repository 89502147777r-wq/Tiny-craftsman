import * as THREE from 'three';
import { PumpHose } from './pumpHose.js';
import { makePlateCompactor, shakePlateCompactor } from './plateCompactor.js';
import { MODEL_SCALE } from '../config.js';

// Models of the concrete tools (sizes of the model, real sizes in comments):
//   hose     – the end hose of a boom pump: a swinging rope simulation (pumpHose.js, 2.5 ×)
//   rule     – aluminium screed rule 2 m, profile 100 × 20 mm
//   vibrator – immersion poker Ø 51 × 400 mm with its hose (drawn 2.5 × larger)
//   trowel   – steel float 450 × 120 mm with a handle
// Only the one in use is shown; poses are smoothed.
export class ConcreteGear {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'concrete-gear';
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.55, metalness: 0 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.4, metalness: 0.8 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x2b5fa8, roughness: 0.6 });
    this.rubber = rubber;
    this.pump = new PumpHose();
    // rule
    this.rule = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0 / MODEL_SCALE, 0.1 / MODEL_SCALE, 0.02 / MODEL_SCALE), alu);
    bar.position.y = 0.05 / MODEL_SCALE;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12 / MODEL_SCALE, 0.03 / MODEL_SCALE, 0.03 / MODEL_SCALE), grip);
    hand.position.y = 0.115 / MODEL_SCALE;
    this.rule.add(bar, hand);
    // vibrator: the steel poker (булава) of an immersion vibrator, Ø 51 × 400 mm, drawn
    // 2.5 × larger so it reads on the screen: a turned steel head with a domed nose, wear
    // grooves, a cone into the hex coupling, then the armoured rubber hose of the flexible
    // shaft. The nose half is grey with cement paste.
    this.vib = new THREE.Group();
    {
      const V = 2.5 / 1000 / MODEL_SCALE;   // real mm → model, 2.5 ×
      const head = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.28, metalness: 0.95 });
      const paste = new THREE.MeshStandardMaterial({ color: 0x7d7b75, roughness: 0.35, metalness: 0.35 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.45, metalness: 0.85 });
      const hoseM = new THREE.MeshStandardMaterial({ color: 0x1d1d1e, roughness: 0.7 });
      const band = new THREE.MeshStandardMaterial({ color: 0xe0601a, roughness: 0.55 });
      const lathe = (pts, mat) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * V, y * V)), 40), mat);
      // the nose: a dome, the lower body (dipped: paste on it)
      const nose = [[0, 0]];
      for (let k = 1; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; nose.push([25.5 * Math.sin(a), 25.5 * (1 - Math.cos(a))]); }
      nose.push([25.5, 150]);
      this.vib.add(lathe(nose, paste));
      // the upper body: bright turned steel with two wear grooves and a chamfer
      this.vib.add(lathe([[25.5, 150], [25.5, 215], [23.5, 218], [23.5, 224], [25.5, 227], [25.5, 300], [23.5, 303], [23.5, 309], [25.5, 312], [25.5, 360], [24, 366]], head));
      // the cone into the coupling, the hex nut, the ferrule of the hose
      this.vib.add(lathe([[24, 366], [17, 395], [17, 400]], head));
      const hex = new THREE.Mesh(new THREE.CylinderGeometry(21 * V, 21 * V, 26 * V, 6), dark);
      hex.position.y = 413 * V;
      this.vib.add(hex);
      this.vib.add(lathe([[19, 426], [19.5, 470], [18, 476]], head));   // crimped ferrule
      for (const y of [436, 448, 460]) { const r = new THREE.Mesh(new THREE.TorusGeometry(19.6 * V, 1.1 * V, 6, 32), dark); r.rotation.x = Math.PI / 2; r.position.y = y * V; this.vib.add(r); }
      // the first bit of the hose with an orange band (the rest is the cable tube)
      const h = new THREE.Mesh(new THREE.CylinderGeometry(17 * V, 17 * V, 60 * V, 20), hoseM);
      h.position.y = 506 * V;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(17.4 * V, 17.4 * V, 14 * V, 20), band);
      b.position.y = 500 * V;
      this.vib.add(h, b);
      this.vibTop = 536 * V;
      this.vibR = 17 * V;
    }
    this.cable = new THREE.Mesh(new THREE.BufferGeometry(), rubber);
    // trowel
    this.trowel = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.45 / MODEL_SCALE, 0.002 / MODEL_SCALE + 0.0004, 0.12 / MODEL_SCALE), steel);
    plate.position.y = 0.0006;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.02 / MODEL_SCALE, 0.06 / MODEL_SCALE, 0.012 / MODEL_SCALE), steel);
    post.position.y = 0.03 / MODEL_SCALE;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016 / MODEL_SCALE, 0.016 / MODEL_SCALE, 0.14 / MODEL_SCALE, 12), grip);
    handle.rotation.z = Math.PI / 2;
    handle.position.y = 0.065 / MODEL_SCALE;
    this.trowel.add(plate, post, handle);
    // bitumen brush: a wide flat brush on a long handle, its bristles black with mastic
    this.brush = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xb08250, roughness: 0.7 });
    const tar = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 0.3 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.15 / MODEL_SCALE, 0.03 / MODEL_SCALE, 0.05 / MODEL_SCALE), wood);
    head.position.y = 0.075 / MODEL_SCALE;
    const bristle = new THREE.Mesh(new THREE.BoxGeometry(0.15 / MODEL_SCALE, 0.06 / MODEL_SCALE, 0.04 / MODEL_SCALE), tar);
    bristle.position.y = 0.03 / MODEL_SCALE;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012 / MODEL_SCALE, 0.012 / MODEL_SCALE, 1.0 / MODEL_SCALE, 10), wood);
    stick.position.set(0, 0.09 / MODEL_SCALE + 0.48 / MODEL_SCALE, -0.12 / MODEL_SCALE); stick.rotation.x = -0.25;
    this.brush.add(head, bristle, stick);
    // rubber mallet (киянка): black rubber head Ø 65 × 110 mm on a wooden handle
    this.mallet = new THREE.Group();
    {
      const rub = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });
      const wood2 = new THREE.MeshStandardMaterial({ color: 0xb5895a, roughness: 0.7 });
      const head2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0325 / MODEL_SCALE, 0.0325 / MODEL_SCALE, 0.11 / MODEL_SCALE, 16), rub);
      head2.rotation.z = Math.PI / 2;
      const hnd = new THREE.Mesh(new THREE.CylinderGeometry(0.013 / MODEL_SCALE, 0.015 / MODEL_SCALE, 0.32 / MODEL_SCALE, 10), wood2);
      hnd.position.set(0, 0.16 / MODEL_SCALE, -0.03 / MODEL_SCALE); hnd.rotation.x = -0.2;
      this.mallet.add(head2, hnd);
    }
    // plate compactor: a detailed model in real sizes (plateCompactor.js)
    this.plate = makePlateCompactor();
    this.plateOn = false;
    this._t = 0;
    for (const o of [this.pump.group, this.rule, this.vib, this.cable, this.trowel, this.brush, this.plate, this.mallet]) {
      o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      o.visible = false;
      this.root.add(o);
    }
    this.pos = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.yaw = 0; this.yawGoal = 0;
    this.show = null;
  }

  // which tool is in hand (null = none), where (tip on the surface) and facing
  set(which, p, yaw = this.yawGoal, snap = false) {
    if (which !== this.show) snap = true;
    this.show = which;
    if (p) this.goal.copy(p);
    this.yawGoal = yaw;
    if (snap) { this.pos.copy(this.goal); this.yaw = yaw; this._snapHose = true; }
  }

  update(dt, camPos) {
    const k = 1 - Math.exp(-dt * 20);
    this.pos.lerp(this.goal, k);
    let dy = this.yawGoal - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * (1 - Math.exp(-dt * 12));
    const w = this.show;
    this.pump.group.visible = w === 'hose';
    this.rule.visible = w === 'screed';
    this.vib.visible = this.cable.visible = w === 'vibro';
    this.trowel.visible = w === 'trowel';
    this.brush.visible = w === 'brush';
    this.plate.visible = w === 'plate';
    this.mallet.visible = w === 'mallet';
    if (w === 'hose') {
      // the spout held ~25 cm above the concrete; the hose swings behind the hand
      this.pump.aim(this.goal.clone().add(new THREE.Vector3(0, 2.5 * (0.25 + 0.15) / MODEL_SCALE, 0)), camPos, this._snapHose);
      this._snapHose = false;
      this.pump.update(dt);
    } else if (w === 'screed') {
      this.rule.position.copy(this.pos);
      this.rule.rotation.set(0, this.yaw, 0);
    } else if (w === 'vibro') {
      this.vib.position.copy(this.pos).add(new THREE.Vector3(0, -0.24 / MODEL_SCALE, 0));   // the nose dipped into the concrete
      this.vib.rotation.set(0.15, this.yaw, 0);
      this.vib.updateMatrixWorld();
      const top = this.vib.localToWorld(new THREE.Vector3(0, this.vibTop, 0));
      this._tube(this.cable, top, camPos, this.vibR, 0.8);
    } else if (w === 'brush') {
      this.brush.position.copy(this.pos);
      this.brush.rotation.set(0, this.yaw, 0);
    } else if (w === 'plate') {
      this.plate.position.copy(this.pos);
      this.plate.rotation.set(0, this.yaw, 0);
      this._t += dt;
      shakePlateCompactor(this.plate, this.plateOn, this._t);
    } else if (w === 'mallet') {
      this.mallet.position.copy(this.goal);
      this.mallet.rotation.set(0, this.yaw, 0);
    } else if (w === 'trowel') {
      this.trowel.position.copy(this.pos);
      this.trowel.rotation.set(0, this.yaw, 0.04);
    }
  }

  // hose / cable: from the tool up and away (towards the pump, behind the camera side)
  _tube(mesh, from, camPos, r, len) {
    const key = `${from.x.toFixed(4)},${from.y.toFixed(4)},${from.z.toFixed(4)}`;
    if (mesh._key === key) return;
    mesh._key = key;
    const away = new THREE.Vector3(from.x - camPos.x, 0, from.z - camPos.z).normalize();
    const pts = [
      from.clone(),
      from.clone().add(new THREE.Vector3(0, len * 0.25, 0)),
      from.clone().add(away.clone().multiplyScalar(len * 0.12)).add(new THREE.Vector3(0, len * 0.55, 0)),
      from.clone().add(away.clone().multiplyScalar(len * 0.35)).add(new THREE.Vector3(0, len, 0)),
    ];
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 12, false);
  }
}
