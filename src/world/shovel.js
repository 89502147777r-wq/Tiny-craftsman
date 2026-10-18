import * as THREE from 'three';
import { SHOVELS, KT as K } from '../config.js';
import { makeNoise2 } from '../core/rand.js';
import { variant } from './assets.js';
import { loadModel } from './machines/models.js';

// A scale shovel. Local frame: blade tip at the origin, handle along +Y,
// working (front) face of the blade towards +Z. The parts are drawn at the
// original 1:12 size and the whole model is scaled by K.
export class Shovel {
  constructor(tex, app) {
    this.app = app;
    this.root = new THREE.Group();
    this.root.name = 'shovel';
    this.tex = tex;
    this.metal = makeBladeMaterial();
    this.wood = new THREE.MeshStandardMaterial({
      map: variant(tex.table.diff, 0.05, 0.6), normalMap: variant(tex.table.nor, 0.05, 0.6),
      roughness: 0.62, metalness: 0, color: 0xc9a27a,
    });
    this.loadMat = new THREE.MeshStandardMaterial({ map: variant(tex.wall.diff, 0.12, 0.12), roughness: 1, color: 0x9c8c7c });
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.pos = new THREE.Vector3(-0.118, 0.05, 0.118);
    this.dir = new THREE.Vector2(0.7, -0.7);
    this.tilt = 0.25; this.roll = 0;
    this.target = { pos: this.pos.clone(), dir: this.dir.clone(), tilt: this.tilt, roll: this.roll };
    this.fill = 0;           // 0..1 of capacity, drives the heap on the blade
    this._fillShown = 0;
    this.setType('spade');
  }

  setType(type) {
    this.type = type;
    this.spec = SHOVELS[type];
    this.model.clear();
    const w = this.spec.width / K, L = this.spec.length / K, pointed = this.spec.pointed;
    this.model.scale.setScalar(K);
    const blade = new THREE.Mesh(makeBladeGeometry(w, L, pointed), this.metal);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0021, 0.013, 16, 1), this.metal);
    socket.position.set(0, L + 0.0055, -0.0011);
    const steps = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.0005, 0.0019), this.metal);
    steps.position.set(0, L - 0.0002, -0.0012);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.00135, 0.00145, 0.098, 14, 1), this.wood);
    handle.position.set(0, L + 0.01 + 0.049, -0.0011);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0015, 12, 8), this.wood);
    knob.position.set(0, L + 0.01 + 0.098, -0.0011);
    this.load = new THREE.Mesh(makeLoadGeometry(), this.loadMat);
    this.load.rotation.x = Math.PI / 2;
    this.load.position.set(0, L * 0.42, 0.0003);
    this.load.visible = false;
    this.model.add(blade, socket, steps, handle, knob, this.load);
    this.model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // the real shovel (a CC BY model, CREDITS.md) replaces the drawn one once loaded
    const drawn = [blade, socket, steps, handle, knob];
    loadModel(type === 'spade' ? 'spade' : 'scoop').then(({ scene }) => {
      if (this.type !== type) return;
      const g = new THREE.Group();
      g.add(scene);
      // the scoop lies along +Z (blade at +Z, its hollow up): stood up, blade down, the
      // hollow to the front (+Z); the spade already stands along +Y
      if (type === 'scoop') scene.rotation.x = Math.PI / 2;
      const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3());
      const k = (L + 0.108) / sz.y;
      scene.scale.multiplyScalar(k);
      const b2 = new THREE.Box3().setFromObject(g);
      scene.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      for (const o of drawn) o.visible = false;
      this.model.add(g);
    }).catch(() => {});
  }

  setPose({ pos, dir, tilt, roll }, snap = false) {
    if (pos) this.target.pos.copy(pos);
    if (dir && dir.lengthSq() > 1e-8) this.target.dir.copy(dir).normalize();
    if (tilt !== undefined) this.target.tilt = tilt;
    if (roll !== undefined) this.target.roll = roll;
    if (snap) { this.pos.copy(this.target.pos); this.dir.copy(this.target.dir); this.tilt = this.target.tilt; this.roll = this.target.roll; }
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 22), kr = 1 - Math.exp(-dt * 12);
    this.pos.lerp(this.target.pos, k);
    this.dir.lerp(this.target.dir, kr).normalize();
    this.tilt += (this.target.tilt - this.tilt) * kr;
    this.roll += (this.target.roll - this.roll) * kr;
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.orientation(this.dir, this.tilt, this.roll));
    this._fillShown += (this.fill - this._fillShown) * (1 - Math.exp(-dt * 14));
    const f = this._fillShown;
    this.load.visible = f > 0.01;
    if (this.load.visible) {
      const s = Math.cbrt(f);
      const w = this.spec.width / K, L = this.spec.length / K;
      // (sphere is rotated: local Y = heap height, local Z = along the blade)
      this.load.scale.set(w * 0.46 * s, 0.0062 * s, L * 0.36 * s);
    }
  }

  orientation(dir, tilt, roll, out = new THREE.Quaternion()) {
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    const y = _v1.set(-dir.x * st, ct, -dir.y * st);
    const z = _v2.set(dir.x * ct, st, dir.y * ct);
    const x = _v3.crossVectors(y, z);
    _m.makeBasis(x, y, z);
    out.setFromRotationMatrix(_m);
    if (roll) out.multiply(_q.setFromAxisAngle(_up, roll));
    return out;
  }

  // World position of a point on the blade face (for spilling soil).
  bladePoint(u, v, out = new THREE.Vector3()) {
    const { width: w, length: L } = this.spec;
    out.set(u * w * 0.4, L * (0.3 + v * 0.35), 0.002 * K);
    return this.root.localToWorld(out);
  }

  bladeNormal(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).applyQuaternion(this.root.quaternion);
  }

  // ---- implement interface for ScoopTool -------------------------------------------------
  get name() { return 'shovel'; }
  get bite() { return this.app.settings.bite / 1000; }
  clampReach(p) { return p; }
  initialDir(p, camDir) { return camDir; }
  digDir(p, drag, cur) { return cur.clone().lerp(drag, 0.35).normalize(); }
  poseDig(p, dir, cutY, first) {
    const L = this.spec.length;
    const tip = new THREE.Vector3(p.x + dir.x * L * 0.28, cutY + 0.0004 * K, p.z + dir.y * L * 0.28);
    this.setPose({ pos: tip, dir, tilt: first ? 0.5 : 0.95, roll: 0 });
  }
  poseAim(p, dir, groundY) {
    this.setPose({ pos: new THREE.Vector3(p.x - dir.x * 0.006 * K, groundY + 0.022 * K, p.z - dir.y * 0.006 * K), dir, tilt: 1.02, roll: 0 });
  }
  // tip the blade over sideways; the shovel moves so the load falls right under the
  // finger (the soil leaves the blade's edge and flies a little along its face)
  poseDump(dir, at) {
    const tilt = 1.12, roll = 1.75;
    if (at) {
      const q = this.orientation(this.target.dir, tilt, roll, new THREE.Quaternion());
      const c = new THREE.Vector3(0, this.spec.length * 0.475, 0.002 * K).applyQuaternion(q).add(this.target.pos);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      this.target.pos.x += at.x - (c.x + n.x * 0.02);
      this.target.pos.z += at.z - (c.z + n.z * 0.02);
    }
    this.setPose({ tilt, roll });
  }
  poseRest(p) {
    const t = this.app.terrain;
    const h = t.inside(p.x, p.z) ? t.heightAt(p.x, p.z) : 0;
    this.setPose({ pos: new THREE.Vector3(p.x, h + 0.004 * K, p.z), tilt: 0.28, roll: 0 });
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

function makeBladeGeometry(w, L, pointed) {
  const s = new THREE.Shape();
  if (pointed) {
    s.moveTo(0, 0);
    s.quadraticCurveTo(w * 0.5, L * 0.03, w * 0.5, L * 0.45);
    s.lineTo(w * 0.5, L);
    s.lineTo(-w * 0.5, L);
    s.lineTo(-w * 0.5, L * 0.45);
    s.quadraticCurveTo(-w * 0.5, L * 0.03, 0, 0);
  } else {
    const r = w * 0.12;
    s.moveTo(-w * 0.5 + r, 0);
    s.lineTo(w * 0.5 - r, 0);
    s.quadraticCurveTo(w * 0.5, 0, w * 0.5, r);
    s.lineTo(w * 0.47, L);
    s.lineTo(-w * 0.47, L);
    s.lineTo(-w * 0.5, r);
    s.quadraticCurveTo(-w * 0.5, 0, -w * 0.5 + r, 0);
  }
  const t = 0.00035;
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 10, steps: 1 });
  // subdivide-free bend: dish the blade (edges forward) and curl the top back
  const p = g.attributes.position;
  const dirt = new Float32Array(p.count);
  const noise = makeNoise2(11);
  const dish = pointed ? 9 : 14;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    let z = p.getZ(i) - t / 2;
    z += dish * x * x;
    z -= 0.0012 * Math.pow(Math.max(0, y / L - 0.75) / 0.25, 2);
    p.setZ(i, z);
    const n = 0.5 + 0.5 * noise.fbm(x * 900, y * 900, 3);
    dirt[i] = Math.min(1, Math.max(0, (1 - y / (L * 0.75)) * 1.1 + (n - 0.5) * 0.7));
  }
  g.setAttribute('dirt', new THREE.BufferAttribute(dirt, 1));
  g.computeVertexNormals();
  return g;
}

function makeBladeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x6a6e72, metalness: 0.9, roughness: 0.4 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float dirt;\nvarying float vDirt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDirt = dirt;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDirt;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat dd = clamp(vDirt, 0.0, 1.0) * 0.85;\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.15, 0.11), dd);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - dd;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, dd);');
  };
  m.customProgramCacheKey = () => 'tc-blade';
  return m;
}

function makeLoadGeometry() {
  const g = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  const noise = makeNoise2(5);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.22 * noise.fbm(x * 3 + 5, z * 3 + y * 2, 3) + 0.08 * noise(x * 11, z * 11);
    p.setXYZ(i, x * k, y * k * (0.8 + 0.2 * (1 - y)), z * k);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, p.getZ(i) * 0.5 + 0.5);
  return g;
}
