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
    // rubber mallet (киянка): black rubber head Ø 65 × 110 mm on a wooden handle 320 mm.
    // Held by the end of the handle (the group's origin — the wrist), the handle level
    // at the strike, the head's axis upright: it hits with its flat face; the swing
    // turns it up about the wrist (malletSwing, rad)
    this.mallet = new THREE.Group();
    this.malletSwing = 0;
    {
      const rub = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });
      const wood2 = new THREE.MeshStandardMaterial({ color: 0xb5895a, roughness: 0.7 });
      const L = 0.32 / MODEL_SCALE, r = 0.0325 / MODEL_SCALE, hl = 0.11 / MODEL_SCALE;
      const head2 = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hl, 20), rub);
      head2.position.set(0, 0, -L);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, hl * 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 0.95 }));
      face.position.set(0, -hl / 2, -L);
      const hnd = new THREE.Mesh(new THREE.CylinderGeometry(0.013 / MODEL_SCALE, 0.015 / MODEL_SCALE, L - r, 10), wood2);
      hnd.rotation.x = Math.PI / 2; hnd.position.set(0, 0, -(L - r) / 2);
      this.mallet.add(head2, face, hnd);
      this.malletL = L; this.malletH = hl;
    }
    // a builder's bucket (galvanised, Ø 300 / 250 × 290 mm, a wire handle; it holds 24 l: the game's own) with
    // concrete: the group's origin is the point of its lip it pours over; pailTilt (rad)
    // tips it about that point, pailStream — the level the stream falls to (or null)
    this.pail = new THREE.Group();
    this.pailTilt = 0; this.pailStream = null; this.pailLeft = 1;
    {
      const zinc = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide });
      const wet = new THREE.MeshStandardMaterial({ color: 0x4f4c48, roughness: 0.3 });
      const rt = 0.15 / MODEL_SCALE, rb = 0.125 / MODEL_SCALE, h = 0.29 / MODEL_SCALE;
      this.pailBody = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 28, 1, true), zinc);
      shell.position.y = -h / 2;
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(rb, 28), zinc);
      bottom.rotation.x = -Math.PI / 2; bottom.position.y = -h;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rt, 0.004 / MODEL_SCALE, 6, 32), zinc);
      rim.rotation.x = Math.PI / 2;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(rt * 0.98, 0.003 / MODEL_SCALE, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.5, metalness: 0.8 }));
      handle.rotation.y = Math.PI / 2; handle.position.y = -0.03 / MODEL_SCALE;
      // the concrete in it (its surface; it slides down as it empties)
      this.pailConc = new THREE.Mesh(new THREE.CircleGeometry(rt * 0.97, 24), wet);
      this.pailConc.rotation.x = -Math.PI / 2;
      this.pailBody.add(shell, bottom, rim, handle, this.pailConc);
      // the body sits beside the lip point: the lip is its rim towards the wall
      this.pailBody.position.x = rt;
      this.pail.add(this.pailBody);
      this.pailH = h; this.pailRt = rt; this.pailRb = rb;
      // the stream from the lip
      this.pailFlow = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), wet);
      this.pailFlow.visible = false;
      this.root.add(this.pailFlow);
    }
    // bricklayer's trowel (кельма): a pointed steel blade 180 × 115 mm, a cranked neck and
    // a wooden handle. The group's origin is the middle of the blade's side edge, local x
    // along that edge, the blade reaching out to +z: held at a slant against the face of
    // the masonry (ktrowelTilt) it cuts the pressed-out mortar off; ktrowelLump — the
    // mortar collected on it (radius, model)
    this.ktrowel = new THREE.Group();
    this.ktrowelTilt = 0.6; this.ktrowelLump = 0;
    {
      const M = (v) => v / 1000 / MODEL_SCALE;
      const sh = new THREE.Shape();
      sh.moveTo(M(-90), 0); sh.lineTo(M(90), 0);
      sh.quadraticCurveTo(M(70), M(60), M(-10), M(115));
      sh.quadraticCurveTo(M(-70), M(80), M(-90), 0);
      const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: M(1.5), bevelEnabled: false, curveSegments: 10 }), steel);
      blade.rotation.x = Math.PI / 2;   // the shape's y → +z (out from the edge), its thickness → down
      this.ktBlade = new THREE.Group();
      this.ktBlade.add(blade);
      // the neck rises from the middle of the blade, the handle goes on out and up
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(M(4), M(4), M(55), 8), steel);
      neck.position.set(M(-15), M(26), M(60));
      const hnd = new THREE.Mesh(new THREE.CylinderGeometry(M(13), M(15), M(115), 12), new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.6 }));
      hnd.rotation.x = Math.PI / 2; hnd.position.set(M(-15), M(52), M(120));
      this.ktLump = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x5a564e, roughness: 0.75 }));
      this.ktLump.scale.set(1, 0.45, 1); this.ktLump.position.set(0, 0, M(35)); this.ktLump.visible = false;
      this.ktBlade.add(neck, hnd, this.ktLump);
      this.ktrowel.add(this.ktBlade);
    }
    // plate compactor: a detailed model in real sizes (plateCompactor.js)
    this.plate = makePlateCompactor();
    this.plateOn = false;
    this._t = 0;
    for (const o of [this.pump.group, this.rule, this.vib, this.cable, this.trowel, this.brush, this.plate, this.mallet, this.pail, this.ktrowel]) {
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
    this.pail.visible = w === 'pail';
    this.ktrowel.visible = w === 'ktrowel';
    if (w !== 'pail') this.pailFlow.visible = false;
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
      // goal: the strike point (the middle of the top of the unit); the hand is off
      // towards the camera, the handle level at the strike
      // (to the right of the unit and a little towards the camera: the swing is seen side-on)
      const c = new THREE.Vector3(camPos.x - this.goal.x, 0, camPos.z - this.goal.z).normalize();
      const d = new THREE.Vector3(-c.z, 0, c.x).multiplyScalar(0.85).addScaledVector(c, 0.5).normalize();
      const yaw = Math.atan2(d.x, d.z);
      this.mallet.position.copy(this.goal).addScaledVector(d, this.malletL);
      this.mallet.position.y += this.malletH / 2;
      this.mallet.rotation.set(this.malletSwing, yaw, 0, 'YXZ');
    } else if (w === 'ktrowel') {
      // goal: the bottom of the joint on the face; yaw: the face's outward normal (+z)
      this.ktrowel.position.copy(this.pos);
      this.ktrowel.rotation.set(0, this.yaw, 0);
      this.ktBlade.rotation.set(-this.ktrowelTilt, 0, 0);
      const r = this.ktrowelLump;
      this.ktLump.visible = r > 1e-5;
      if (r > 1e-5) { this.ktLump.scale.set(r * 1.3, r * 0.55, r); this.ktLump.position.set(0, r * 0.3, r * 1.1); }
    } else if (w === 'pail') {
      // tipped over the lip, its body to the right of it (seen side-on from the camera)
      const c = new THREE.Vector3(camPos.x - this.pos.x, 0, camPos.z - this.pos.z).normalize();
      const d = new THREE.Vector3(-c.z, 0, c.x).multiplyScalar(0.9).addScaledVector(c, 0.3).normalize();
      // the goal is the top of the U-blocks under the lip: the lip is held 110 mm above it,
      // higher while the bucket is still upright so no part of it dips into the blocks
      // (the lowest corner of its profile, tipped by pailTilt, stays 25 mm above them)
      const th = this.pailTilt, sn = Math.sin(th), cs = Math.cos(th), rt = this.pailRt, rb = this.pailRb, h = this.pailH;
      const low = Math.min(0, 2 * rt * sn, (rt - rb) * sn - h * cs, (rt + rb) * sn - h * cs);
      this._lift = Math.max(0.11 / MODEL_SCALE, 0.025 / MODEL_SCALE - low);
      this.pail.position.copy(this.pos); this.pail.position.y += this._lift;
      this.pail.rotation.set(0, Math.atan2(-d.z, d.x), th, 'YXZ');
      // the concrete in it: lower as it empties (it is drawn level with the rim when tipped)
      this.pailConc.position.y = -this.pailH * (1 - Math.max(0.05, this.pailLeft) * 0.85);
      this.pailConc.visible = this.pailLeft > 0.02 && this.pailTilt < 1.0;
      const f = this.pailFlow;
      f.visible = this.pailStream != null;
      if (f.visible) {
        const top = this.pail.position, hgt = Math.max(0.0005, top.y - this.pailStream), r = 0.018 / MODEL_SCALE * (0.8 + 0.2 * Math.sin(this._t * 40));
        this._t += dt;
        f.position.set(top.x, top.y - hgt / 2, top.z);
        f.scale.set(r, hgt, r * 0.8);
        f.rotation.set(0, 0, 0);
      }
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
