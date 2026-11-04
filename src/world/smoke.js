import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// Puffs in the air: a machine's exhaust (dark, rising, spreading) and the dust its wheels raise off
// dry loose ground (light, low, drifting). A pool of soft sprites, each living a couple of seconds.
const R = (m) => m / MODEL_SCALE;
const KIND = {
  smoke: { color: 0x3c3a38, opacity: 0.42, size0: 0.15, size1: 1.1, rise: 0.55, life: 2.4 },
  dust: { color: 0xb59a78, opacity: 0.32, size0: 0.35, size1: 1.8, rise: 0.12, life: 2.2 },
  // (the catastrophes: a cloud of dust off a fall of masonry; the flames and the black smoke of a fire)
  cloud: { color: 0xa89478, opacity: 0.5, size0: 1.2, size1: 7, rise: 0.25, life: 4.5 },
  flame: { color: 0xff8a2a, opacity: 0.85, size0: 0.6, size1: 1.6, rise: 2.2, life: 0.9, add: true },
  soot: { color: 0x1c1a19, opacity: 0.6, size0: 1.0, size1: 8, rise: 1.6, life: 5 },
  // (a building come down: grey concrete dust, slow, hanging long — 5–10 s — and drifting with the wind)
  rubble: { color: 0xb8a58a, opacity: 0.55, size0: 2, size1: 10, rise: 0.5, life: 6 },
  // (the air pushed out from under a falling slab: a ring of dust running out along the ground — fast, stopping in a second)
  ring: { color: 0xb8a58a, opacity: 0.8, size0: 1.2, size1: 6, rise: 0.08, life: 3.5, damp: 2.6 },
};

export class Puffs {
  constructor(scene, max = 120) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d'), grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; s.renderOrder = 5; scene.add(s);
      this.pool.push({ s, age: 0, life: 0, k: null, v: new THREE.Vector3() });
    }
    this.next = 0;
  }
  // one puff of `kind` at p (world), drifting with v (world, model units/s); strength 0…1 its density
  emit(kind, p, v, strength = 1) {
    const it = this.pool[this.next++ % this.pool.length], k = KIND[kind];
    it.k = k; it.age = 0; it.life = k.life * (0.8 + Math.random() * 0.4); it.str = strength;
    it.s.position.copy(p); it.v.copy(v).add(new THREE.Vector3((Math.random() - 0.5) * R(0.15), R(k.rise) * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * R(0.15)));
    it.s.material.color.setHex(k.color); it.s.material.blending = k.add ? THREE.AdditiveBlending : THREE.NormalBlending; it.s.visible = true;
  }
  update(dt) {
    for (const it of this.pool) {
      if (!it.s.visible) continue;
      it.age += dt;
      const u = it.age / it.life;
      if (u >= 1) { it.s.visible = false; continue; }
      it.s.position.addScaledVector(it.v, dt); it.v.multiplyScalar(Math.max(0, 1 - (it.k.damp ?? 0.8) * dt));
      const sz = R(it.k.size0 + (it.k.size1 - it.k.size0) * Math.sqrt(u));
      it.s.scale.set(sz, sz, sz);
      it.s.material.opacity = it.k.opacity * it.str * Math.min(1, u * 6) * (1 - u) ** 1.5;
    }
  }
}
