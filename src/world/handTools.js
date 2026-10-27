import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_SCALE } from '../config.js';

// The hand tools of the fitting work (fitJob.js), drawn in real sizes:
//   drill  – a rotary hammer (перфоратор) with an 8 mm bit 160 long,
//   driver – a cordless screwdriver (шуруповёрт) with a bit,
//   hammer – a claw hammer 300 mm,
//   notch  – a notched trowel 280 × 120 (teeth 6 × 6),
//   level  – an aluminium spirit level 600,
//   hook   – the twister for the binding wire (крючок),
//   foam   – a foam gun with its can.
// Each is posed by its working point (the tip of the bit, the face of the hammer, the edge
// of the trowel …) on a surface and the surface's outward normal: local +z is that normal
// (the tool stands out from the surface along it), local +y is "up" in the surface.
const M = (v) => v / 1000 / MODEL_SCALE;
export { M as toolMM };
const mat = (c, r = 0.55, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(M(w), M(h), M(d)), m); o.position.set(M(x), M(y), M(z)); return o; };
const cyl = (r0, r1, h, m, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(M(r0), M(r1), M(h), seg), m);
const alongZ = (o, z) => { o.rotation.x = Math.PI / 2; o.position.z = M(z); return o; };

export class HandTools {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'hand-tools';
    const steel = mat(0xa9aeb3, 0.3, 0.9), dark = mat(0x26282b, 0.5, 0.2), body = mat(0x1d5fa8, 0.45), red = mat(0xc8322a, 0.45), black = mat(0x18191b, 0.7);
    const wood = mat(0xb48654, 0.65), alu = mat(0xc9cdd1, 0.35, 0.8), yel = mat(0xe8b52a, 0.5);
    this.tools = {};
    // the rotary hammer: the bit along z from the tip, the chuck, the motor body, the pistol grip under it
    {
      const g = new THREE.Group(), spin = new THREE.Group();
      spin.add(alongZ(cyl(4, 4, 160, steel, 8), 80));
      const flute = alongZ(cyl(4.4, 4.4, 110, dark, 6), 60); flute.scale.set(1, 1, 0.6); spin.add(flute);
      g.add(spin);
      g.add(alongZ(cyl(22, 26, 70, black, 18), 195));
      g.add(alongZ(cyl(38, 38, 200, body, 20), 330));
      g.add(box(40, 140, 55, black, 0, -95, 410), box(70, 30, 120, body, 0, -165, 400));
      g.add(box(36, 110, 36, black, 0, -40, 250));   // the side handle
      this.tools.drill = { g, spin };
    }
    // the screwdriver: a short bit, the chuck, the body, the grip and the battery
    {
      const g = new THREE.Group(), spin = new THREE.Group();
      spin.add(alongZ(cyl(3, 3, 50, steel, 6), 25));
      g.add(spin);
      g.add(alongZ(cyl(17, 19, 45, black, 16), 72));
      g.add(alongZ(cyl(30, 30, 150, red, 18), 165));
      g.add(box(38, 130, 45, black, 0, -85, 205), box(70, 45, 95, dark, 0, -165, 200));
      this.tools.driver = { g, spin };
    }
    // the hammer: the head's face at the origin, striking along −z; the handle down (−y) to the hand
    {
      const g = new THREE.Group(), arm = new THREE.Group();
      arm.add(alongZ(cyl(15, 15, 60, steel, 14), 30), alongZ(cyl(11, 15, 45, steel, 14), 80));
      const claw = box(18, 22, 60, steel, 0, 0, 115); claw.rotation.x = 0.35; arm.add(claw);
      const h = cyl(13, 15, 300, wood, 10); h.position.set(0, M(-150), M(45)); arm.add(h);
      g.add(arm);
      this.tools.hammer = { g, arm, pivot: M(-300) };
    }
    // the rubber mallet: a black rubber head Ø 65 × 110 (its face at the origin), the handle down
    {
      const g = new THREE.Group(), arm = new THREE.Group();
      arm.add(alongZ(cyl(32, 32, 110, mat(0x141414, 0.85), 18), 55));
      const h = cyl(13, 15, 320, wood, 10); h.position.set(0, M(-160), M(55)); arm.add(h);
      g.add(arm);
      this.tools.mallet = { g, arm, pivot: M(-320) };
    }
    // the notched trowel: its toothed edge on the origin, the blade up the surface (+y), lying on it
    {
      const g = new THREE.Group(), sh = new THREE.Shape();
      sh.moveTo(M(-140), 0);
      for (let k = 0; k < 23; k++) { const x = -140 + k * 12; sh.lineTo(M(x + 3), 0); sh.lineTo(M(x + 3), M(6)); sh.lineTo(M(x + 9), M(6)); sh.lineTo(M(x + 9), 0); }
      sh.lineTo(M(140), 0); sh.lineTo(M(140), M(120)); sh.lineTo(M(-140), M(120)); sh.lineTo(M(-140), 0);
      const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: M(1.2), bevelEnabled: false }), steel);
      g.add(blade);
      g.add(box(40, 70, 18, dark, 0, 70, 12));
      const hnd = cyl(15, 17, 120, wood, 12); hnd.rotation.z = Math.PI / 2; hnd.position.set(0, M(75), M(55)); g.add(hnd);
      this.tools.notch = { g };
    }
    // the spirit level: lying on the surface along x
    {
      const g = new THREE.Group();
      g.add(box(600, 55, 22, alu, 0, 0, 11), box(560, 8, 2, yel, 0, 0, 23));
      for (const x of [-200, 0, 200]) { const v = cyl(6, 6, 30, mat(0x9be37a, 0.2), 10); v.rotation.z = Math.PI / 2; v.position.set(M(x), 0, M(23)); g.add(v); }
      this.tools.level = { g };
    }
    // the wire twister: the spiral rod's hook at the origin, the rod and the turning handle out along z
    {
      const g = new THREE.Group(), spin = new THREE.Group();
      const pts = []; for (let k = 0; k <= 60; k++) { const t = k / 60; pts.push(new THREE.Vector3(Math.cos(t * 24) * M(3), Math.sin(t * 24) * M(3), M(20 + t * 180))); }
      spin.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, M(2.2), 6), steel));
      const hk = new THREE.Mesh(new THREE.TorusGeometry(M(8), M(2), 6, 12, Math.PI * 1.3), steel); hk.position.z = M(12); spin.add(hk);
      g.add(spin, alongZ(cyl(14, 14, 110, yel, 12), 255));
      this.tools.hook = { g, spin };
    }
    // the foam gun: the nozzle's tip at the origin, the barrel back along z, the grip and the can
    {
      const g = new THREE.Group();
      g.add(alongZ(cyl(3, 5, 180, steel, 10), 90), alongZ(cyl(12, 12, 60, black, 12), 200));
      g.add(box(30, 120, 40, black, 0, -70, 230));
      const can = cyl(32, 32, 230, mat(0x2e7d32, 0.4, 0.4), 18); can.position.set(0, M(140), M(230)); g.add(can);
      this.tools.foam = { g };
    }
    for (const t of Object.values(this.tools)) { t.g.visible = false; t.g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } }); this.root.add(t.g); }
    this.cur = null;
  }

  // the tool in use at p (world) on a surface with the outward normal n; up: the surface's
  // up direction (default: world up, or for a floor the given direction); a: its parameter
  // (the bit's turn, the hammer's swing in rad)
  set(which, p, n, up = null, a = 0) {
    for (const [k, t] of Object.entries(this.tools)) t.g.visible = k === which;
    this.cur = which;
    const t = this.tools[which];
    if (!t) return;
    const z = n.clone().normalize();
    let y = (up ? up.clone() : new THREE.Vector3(0, 1, 0)).addScaledVector(z, -(up ? up.dot(z) : z.y));
    if (y.lengthSq() < 1e-8) y = new THREE.Vector3(0, 0, 1).addScaledVector(z, -z.z);
    y.normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    t.g.matrixAutoUpdate = true;
    t.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    t.g.position.copy(p);
    if (t.spin) t.spin.rotation.z = a;
    if (t.arm) {
      // (the swing turns the head out about the hand)
      t.arm.position.set(0, t.pivot, 0); t.arm.rotation.x = a;
      t.arm.children.forEach((c) => { if (!c.userData.base) c.userData.base = c.position.clone(); c.position.copy(c.userData.base).add(new THREE.Vector3(0, -t.pivot, 0)); });
    }
  }
  hide() { for (const t of Object.values(this.tools)) t.g.visible = false; this.cur = null; }

  // the scanned / modelled tools (Poly Haven, CC0 — CREDITS.md) in place of the drawn bodies, once
  // they have come: the cordless drill-driver, the hammer. (The bits and the swing stay as they are.)
  loadModels() {
    const L = new GLTFLoader();
    for (const [which, M0] of Object.entries(TOOL_MODELS)) {
      L.load(M0.url, (g) => {
        const t = this.tools[which]; if (!t) return;
        const o = g.scene;
        o.traverse((q) => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; } });
        // (to the tool's frame: scaled from metres to the model's mm, turned, its working point on the origin)
        const holder = new THREE.Group(); holder.add(o);
        o.scale.setScalar(M(1000) * (M0.scale || 1));
        o.rotation.set(...M0.rot);
        o.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
        o.position.sub(c).add(new THREE.Vector3(...M0.at.map(M)));
        o.position.add(M0.align(b, M));
        const host = t.arm || t.g;
        for (const ch of [...host.children]) if (ch !== t.spin && !(M0.keep || []).includes(host.children.indexOf(ch))) host.remove(ch);
        if (t.arm) holder.userData.base = new THREE.Vector3(0, 0, 0);
        host.add(holder);
      }, undefined, () => { /* keep the drawn one */ });
    }
  }
}

// how each model sits in its tool's frame: rot (euler, rad) turns it so its working end is at the
// origin side and its axis along +z (the drill's chuck out along +z, the grip down −y; the hammer's
// face toward −z, the handle down −y); at: where its middle goes (mm); align(box, M): a shift from
// its bounds (the chuck's nose 50 mm out — the bit before it; the face on the origin)
const TOOL_MODELS = {
  driver: { url: 'assets/models/tools/drill_01/Drill_01.gltf', rot: [0, Math.PI / 2, 0], at: [0, -45, 0], align: (b, M) => new THREE.Vector3(0, 0, M(50) - b.min.z + (b.min.z + b.max.z) / 2 - (b.min.z + b.max.z) / 2) },
  hammer: { url: 'assets/models/tools/cross_pein_hammer/cross_pein_hammer.gltf', rot: [0, 0, 0], at: [0, -120, 0], align: () => new THREE.Vector3() },
};
