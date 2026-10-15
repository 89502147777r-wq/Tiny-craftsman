import * as THREE from 'three';

// Models of the concrete tools (sizes of the model, real sizes in comments):
//   hose     – the 125 mm rubber end hose of a boom pump, hanging from above
//   rule     – aluminium screed rule 2 m, profile 100 × 20 mm
//   vibrator – immersion poker Ø 50 mm, 0.4 m long, with its cable
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
    // hose: a tube rebuilt along a hanging curve
    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), rubber);
    this.hoseEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.0185, 0.0185, 0.012, 20, 1, true), steel);
    // rule
    this.rule = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0 / 3.5, 0.1 / 3.5, 0.02 / 3.5), alu);
    bar.position.y = 0.05 / 3.5;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12 / 3.5, 0.03 / 3.5, 0.03 / 3.5), grip);
    hand.position.y = 0.115 / 3.5;
    this.rule.add(bar, hand);
    // vibrator poker + cable
    this.vib = new THREE.Group();
    const poker = new THREE.Mesh(new THREE.CylinderGeometry(0.025 / 3.5, 0.022 / 3.5, 0.4 / 3.5, 16), steel);
    poker.position.y = 0.2 / 3.5;
    this.vib.add(poker);
    this.cable = new THREE.Mesh(new THREE.BufferGeometry(), rubber);
    // trowel
    this.trowel = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.45 / 3.5, 0.002 / 3.5 + 0.0004, 0.12 / 3.5), steel);
    plate.position.y = 0.0006;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.02 / 3.5, 0.06 / 3.5, 0.012 / 3.5), steel);
    post.position.y = 0.03 / 3.5;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016 / 3.5, 0.016 / 3.5, 0.14 / 3.5, 12), grip);
    handle.rotation.z = Math.PI / 2;
    handle.position.y = 0.065 / 3.5;
    this.trowel.add(plate, post, handle);
    for (const o of [this.hose, this.hoseEnd, this.rule, this.vib, this.cable, this.trowel]) {
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
    if (snap) { this.pos.copy(this.goal); this.yaw = yaw; this._lastHose = null; }
  }

  update(dt, camPos) {
    const k = 1 - Math.exp(-dt * 20);
    this.pos.lerp(this.goal, k);
    let dy = this.yawGoal - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * (1 - Math.exp(-dt * 12));
    const w = this.show;
    this.hose.visible = this.hoseEnd.visible = w === 'hose';
    this.rule.visible = w === 'screed';
    this.vib.visible = this.cable.visible = w === 'vibro';
    this.trowel.visible = w === 'trowel';
    if (w === 'hose') {
      const end = this.pos.clone().add(new THREE.Vector3(0, 0.03, 0));   // ~10 cm above the concrete
      this.hoseEnd.position.copy(end).add(new THREE.Vector3(0, 0.006, 0));
      this._tube(this.hose, end, camPos, 0.018, 1.1);
    } else if (w === 'screed') {
      this.rule.position.copy(this.pos);
      this.rule.rotation.set(0, this.yaw, 0);
    } else if (w === 'vibro') {
      this.vib.position.copy(this.pos).add(new THREE.Vector3(0, -0.03, 0));   // dipped into the concrete
      this.vib.rotation.set(0.15, this.yaw, 0);
      const top = this.vib.localToWorld(new THREE.Vector3(0, 0.4 / 3.5, 0));
      this._tube(this.cable, top, camPos, 0.0045, 0.8);
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
