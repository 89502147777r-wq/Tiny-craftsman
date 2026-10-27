import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// Bitumen mastic on anything built (blocks, bricks, lintels, ring beams and slabs, columns …),
// as the brush lays it: one pass — a thin coat, the surface still shows through it (darker,
// with a sheen); each pass more over the same place — thicker, till it is black and glossy.
// The coats are dabs of the brush in the plot (world space): { x, y, z, k (passes) } in one
// record { type: 'bitumen', d: [x, y, z, k, …] }. The materials of the walls look them up
// (a grid over the plot → the dabs in each cell, in two float textures).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const BIT = { r: 55, max: 8000, cell: 150, kMax: 4 };
const TW = 256, HS = 256;   // (the dabs' texture: 256 wide; the hash table: 256 × 256 slots)

export const BIT_U = {
  uBitDabs: { value: null }, uBitGrid: { value: null }, uBitO: { value: new THREE.Vector3() }, uBitCell: { value: 1 }, uBitR: { value: MM(BIT.r) }, uBitOn: { value: 0 },
};
// a cell of the grid in the plot (x, y, z) → its slot in the table (as the shader works it out)
const slot = (gx, gy, gz) => ((Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ Math.imul(gz, 83492791)) >>> 0) & (HS * HS - 1);

// the dabs into the textures: each dab in every cell its ball touches (the cells hashed into a
// table — two cells in one slot share it, the shader only looks a little longer)
export function buildBitumen(rec, halfX, halfZ) {
  const d = rec?.d || [], n = d.length / 4, c = MM(BIT.cell), r = MM(BIT.r), ox = -halfX - c, oy = -2, oz = -halfZ - c;
  const slots = new Map();
  for (let i = 0; i < n; i++) {
    const x = d[i * 4], y = d[i * 4 + 1], z = d[i * 4 + 2];
    const seen = new Set();
    for (let gx = Math.floor((x - r - ox) / c); gx <= Math.floor((x + r - ox) / c); gx++) for (let gy = Math.floor((y - r - oy) / c); gy <= Math.floor((y + r - oy) / c); gy++) for (let gz = Math.floor((z - r - oz) / c); gz <= Math.floor((z + r - oz) / c); gz++) {
      const k = slot(gx, gy, gz); if (seen.has(k)) continue; seen.add(k);
      if (!slots.has(k)) slots.set(k, []); slots.get(k).push(i);
    }
  }
  let total = 0; for (const l of slots.values()) total += l.length;
  const th = Math.max(1, Math.ceil(total / TW)), dabs = new Float32Array(TW * th * 4), grid = new Float32Array(HS * HS * 4);
  let at = 0;
  for (const [k, l] of slots) {
    grid[k * 4] = at; grid[k * 4 + 1] = l.length;
    for (const i of l) { dabs.set([d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]], at * 4); at++; }
  }
  const U = BIT_U;
  U.uBitDabs.value?.dispose(); U.uBitGrid.value?.dispose();
  const tex = (a, w, h) => { const t = new THREE.DataTexture(a, w, h, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  U.uBitDabs.value = tex(dabs, TW, th); U.uBitGrid.value = tex(grid, HS, HS);
  U.uBitO.value.set(ox, oy, oz); U.uBitCell.value = c; U.uBitR.value = r; U.uBitOn.value = n ? 1 : 0;
}

// a pass of the brush at p: a dab there — over one already there (not yet touched by this pass)
// it is one coat more; touched: the set of the dabs this pass has been over
export function dab(rec, p, touched) {
  const d = rec.d, r = MM(BIT.r) * 0.75, n = d.length / 4;
  let hit = false;
  for (let i = 0; i < n; i++) {
    if (Math.abs(d[i * 4] - p.x) > r || Math.abs(d[i * 4 + 2] - p.z) > r || Math.abs(d[i * 4 + 1] - p.y) > r) continue;
    if (Math.hypot(d[i * 4] - p.x, d[i * 4 + 1] - p.y, d[i * 4 + 2] - p.z) > r) continue;
    hit = true;
    if (!touched.has(i)) { touched.add(i); d[i * 4 + 3] = Math.min(BIT.kMax, d[i * 4 + 3] + 1); }
  }
  if (!hit && n < BIT.max) { touched.add(n); d.push(+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5), 1); return true; }
  return hit;
}

// the coats into a material of the walls (its own shader changes kept)
export function withBitumen(m) {
  if (!m || m.userData.bit) return m;
  m.userData.bit = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, rd) => {
    prev?.call(m, sh, rd);
    Object.assign(sh.uniforms, BIT_U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBitW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\nvBitW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvBitW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBitW;
        uniform sampler2D uBitDabs; uniform sampler2D uBitGrid; uniform vec3 uBitO; uniform float uBitCell; uniform float uBitR; uniform float uBitOn;
        float bitCoat(vec3 w) {
          if (uBitOn < 0.5) return 0.0;
          ivec3 g = ivec3(floor((w - uBitO) / uBitCell));
          if (g.x < 0 || g.y < 0 || g.z < 0) return 0.0;
          uint h = ((uint(g.x) * 73856093u) ^ (uint(g.y) * 19349663u) ^ (uint(g.z) * 83492791u)) & ${HS * HS - 1}u;
          vec4 c = texelFetch(uBitGrid, ivec2(int(h % ${HS}u), int(h / ${HS}u)), 0);
          int st = int(c.r + 0.5), cnt = int(c.g + 0.5);
          float best = 0.0;
          for (int i = 0; i < 64; i++) {
            if (i >= cnt) break;
            int id = st + i;
            vec4 d = texelFetch(uBitDabs, ivec2(id % ${TW}, id / ${TW}), 0);
            float f = 1.0 - smoothstep(0.62 * uBitR, 1.08 * uBitR, length(w - d.xyz));
            best = max(best, d.w * f);
          }
          return best;
        }`)
      .replace('#include <emissivemap_fragment>', `{
          float bc = bitCoat(vBitW);
          if (bc > 0.001) {
            // (the brush's streaks in a thin coat; the bitumen: brown-black, glossy when thick)
            float streak = 0.86 + 0.14 * sin(dot(vBitW, vec3(5300.0, 7100.0, 4700.0)));
            float thin = clamp(bc * streak, 0.0, 1.0), full = smoothstep(1.1, 3.6, bc);
            // (a thin coat: the surface darkened, brown-black, its texture through it; thicker — the mastic itself)
            vec3 tint = mix(diffuseColor.rgb, diffuseColor.rgb * 0.07 + vec3(0.011, 0.008, 0.005), thin);
            diffuseColor.rgb = mix(tint, vec3(0.008, 0.007, 0.006), full);
            roughnessFactor = mix(roughnessFactor, 0.32, max(thin * 0.6, full));
          }
        }
        #include <emissivemap_fragment>`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|' + (prev ? prev.toString() : '') + '|bit';
  m.needsUpdate = true;
  return m;
}
