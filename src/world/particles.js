import * as THREE from 'three';
import { mulberry32 } from '../core/rand.js';
import { variant } from './assets.js';
import { materialTint } from './soilColor.js';

const G = -9.81;

// Falling soil crumbs. Each crumb carries a share of soil volume and hands it
// to the heightfield where it lands, so a dumped scoop builds a real pile.
// A fraction of the crumbs stays on top of the pile as visible clods.
export class SoilParticles {
  constructor(tex, terrain, max = 1400) {
    this.terrain = terrain;
    this.max = max;
    this.rnd = mulberry32(99);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.75 + 0.5 * hash3(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: variant(tex.wall.diff, 0.15, 0.15), roughness: 1, color: 0xffffff });
    this._col = new THREE.Color();
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.items = [];

    // clods resting on the ground
    this.clodMax = 4000;
    this.clods = new THREE.InstancedMesh(geo, mat, this.clodMax);
    this.clods.castShadow = true; this.clods.receiveShadow = true;
    this.clods.frustumCulled = false;
    this.clods.count = 0;
    this.clodList = [];
    this._seenVersion = -1;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }

  get busy() { return this.items.length > 0; }

  emit(pos, vel, vol, size, keep = 0.25, depth = 0, mat = 0) {
    if (this.items.length >= this.max) { this.terrain.deposit(pos.x, pos.z, vol, 0.002, depth, mat); return; }
    const r = this.rnd;
    this.items.push({
      p: pos.clone(), v: vel.clone(), vol, size: size * (0.6 + r() * 0.8),
      rot: new THREE.Euler(r() * 6, r() * 6, r() * 6), spin: (r() - 0.5) * 30, keep: r() < keep, age: 0, depth, mat,
    });
  }

  // Land everything immediately (used before committing an action).
  flush() {
    for (const it of this.items) this._land(it, it.p.x, it.p.z);
    this.items.length = 0;
    this.mesh.count = 0;
  }

  _land(it, x, z) {
    this.terrain.deposit(x, z, it.vol, Math.max(0.0012, it.size * 1.2), it.depth || 0, it.mat || 0);
    // soil clods and crushed stones stay visible on top (sand does not)
    if (it.keep && it.mat !== 1 && this.terrain.inside(x, z) && this.clodList.length < this.clodMax) {
      // (a clod does not stay where it fell on a heap's side: it rolls down till the ground is gentle)
      const t = this.terrain, d = Math.max(t.cell, it.size);
      for (let k = 0; k < 40; k++) {
        const gx = (t.heightAt(x + d, z) - t.heightAt(x - d, z)) / (2 * d), gz = (t.heightAt(x, z + d) - t.heightAt(x, z - d)) / (2 * d), gl = Math.hypot(gx, gz);
        if (gl < 0.45) break;
        x = t.clampX(x - gx / gl * d); z = t.clampZ(z - gz / gl * d);
      }
      this.clodList.push({ x, z, size: it.size, rot: it.rot.clone(), sink: 0.35 + this.rnd() * 0.35, depth: it.depth || 0, mat: it.mat || 0 });
      this._seenVersion = -1;
    }
  }

  update(dt) {
    const t = this.terrain;
    const items = this.items;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.age += dt;
      it.v.y += G * dt;
      it.v.multiplyScalar(1 - 0.6 * dt);
      it.p.addScaledVector(it.v, dt);
      it.rot.x += it.spin * dt; it.rot.z += it.spin * 0.7 * dt;
      const inside = t.inside(it.p.x, it.p.z);
      const ground = inside ? t.heightAt(it.p.x, it.p.z) : 0;
      if (it.p.y - it.size * 0.5 <= ground || it.age > 3) {
        const cx = t.clampX(it.p.x), cz = t.clampZ(it.p.z);
        this._land(it, cx, cz);
        continue;
      }
      items[w++] = it;
    }
    items.length = w;
    const m = this._m, q = this._q, s = this._s;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      q.setFromEuler(it.rot);
      s.setScalar(it.size);
      this.mesh.setMatrixAt(i, m.compose(it.p, q, s));
      this.mesh.setColorAt(i, materialTint(it.mat, it.depth || 0, this._col));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (t.version !== this._seenVersion) this._refreshClods();
  }

  // Clods ride on the surface; they vanish when their loose soil is dug away.
  _refreshClods() {
    const t = this.terrain;
    this._seenVersion = t.version;
    const m = this._m, q = this._q, s = this._s, p = new THREE.Vector3();
    let w = 0;
    for (const c of this.clodList) {
      const i = t.index(c.x, c.z);
      if (t.loose[i] < 0.0006) continue;
      this.clodList[w++] = c;
    }
    this.clodList.length = w;
    for (let i = 0; i < w; i++) {
      const c = this.clodList[i];
      p.set(c.x, t.heightAt(c.x, c.z) + c.size * (0.5 - c.sink), c.z);
      q.setFromEuler(c.rot);
      s.setScalar(c.size);
      this.clods.setMatrixAt(i, m.compose(p, q, s));
      this.clods.setColorAt(i, materialTint(c.mat, c.depth || 0, this._col));
    }
    if (this.clods.instanceColor) this.clods.instanceColor.needsUpdate = true;
    this.clods.count = w;
    this.clods.instanceMatrix.needsUpdate = true;
  }

  // the rake drags the clods under its head along and breaks them up
  rakeClods(cx, cz, dx, dz, hw, band, ahead, minSize) {
    let w = 0, hit = false;
    for (const c of this.clodList) {
      const rx = c.x - cx, rz = c.z - cz, u = rx * dx + rz * dz, v = rx * -dz + rz * dx;
      if (u >= -band - c.size && u <= c.size && Math.abs(v) <= hw) {
        hit = true;
        c.x += dx * ahead * 0.5; c.z += dz * ahead * 0.5;
        if (!c.mat) c.size *= 0.86;   // clods break up, stones do not
        c.rot.x += 0.7; c.rot.z += 0.4;
        if (c.size < minSize) continue;
      }
      this.clodList[w++] = c;
    }
    this.clodList.length = w;
    if (hit) this._seenVersion = -1;
  }

  clearClods() { this.clodList.length = 0; this._seenVersion = -1; }
}

function hash3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
