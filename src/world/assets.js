import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const SETS = {
  top: 'gravelly_sand',     // fine sandy soil, like the sand in the real diorama
  loam: 'forest_ground_06',
  wall: 'excavated_soil_wall',
  table: 'wood_table_worn',
  ply: 'plywood',
  plank: 'raw_plank_wall',
};

export async function loadAssets(renderer, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, done, total) => onProgress?.(done / total);
  const tl = new THREE.TextureLoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url, srgb) => new Promise((res, rej) => tl.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, rej));

  const tex = {};
  const jobs = [];
  for (const [key, name] of Object.entries(SETS)) {
    tex[key] = {};
    const base = `assets/textures/${name}/`;
    jobs.push(load(base + 'diff.jpg', true).then((t) => (tex[key].diff = t)));
    jobs.push(load(base + 'nor_gl.jpg', false).then((t) => (tex[key].nor = t)));
    jobs.push(load(base + 'arm.jpg', false).then((t) => (tex[key].arm = t)));
  }
  const hdr = new Promise((res, rej) => new HDRLoader(manager).load('assets/hdri/carpentry_shop_02_1k.hdr', res, undefined, rej));
  const [env] = await Promise.all([hdr, ...jobs]);
  env.mapping = THREE.EquirectangularReflectionMapping;
  tex.env = env;
  return tex;
}

// Same texture with its own repeat/offset (shares the GPU image).
export function variant(t, rx, ry = rx, rot = 0) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.rotation = rot;
  c.needsUpdate = true;
  return c;
}
