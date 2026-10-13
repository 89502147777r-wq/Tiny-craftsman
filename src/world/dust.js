import * as THREE from 'three';
import { mulberry32 } from '../core/rand.js';

// Dust floating in the lamp light. The points do not write depth, so the
// bokeh pass blurs them with the background into soft out-of-focus discs.
export function makeDust(count = 140) {
  const rnd = mulberry32(42);
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = (rnd() - 0.5) * 0.9;
    seeds[i * 3 + 1] = 0.03 + rnd() * 0.45;
    seeds[i * 3 + 2] = (rnd() - 0.5) * 0.9;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
  const sprite = new THREE.CanvasTexture(c);
  const mat = new THREE.PointsMaterial({
    size: 0.0011, map: sprite, color: 0xffe2b8, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  return {
    points,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const sx = seeds[i * 3], sy = seeds[i * 3 + 1], sz = seeds[i * 3 + 2];
        pos[i * 3] = sx + 0.02 * Math.sin(t * 0.13 + i);
        pos[i * 3 + 1] = sy + 0.015 * Math.sin(t * 0.09 + i * 1.7);
        pos[i * 3 + 2] = sz + 0.02 * Math.cos(t * 0.11 + i * 0.6);
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}
