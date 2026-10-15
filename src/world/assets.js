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

export async function loadAssets(renderer, onProgress, quality = 'high') {
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
  // loose materials: albedo and normal of sand and crushed stone as texture arrays
  // (layer 0 sand, 1 crushed stone — both stone sizes use it at another scale)
  const S = quality === 'low' ? 512 : 1024;
  const mats = Promise.all(['dense_sand', 'gravel_floor_02'].flatMap((n) => [`assets/textures/${n}/diff.jpg`, `assets/textures/${n}/nor_gl.jpg`].map(loadImage)))
    .then(([sd, sn, gd, gn]) => { tex.matDiff = arrayTexture([sd, gd], S, true, aniso); tex.matNor = arrayTexture([sn, gn], S / 2, false, aniso); });
  jobs.push(mats);
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

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + url)); im.src = url; });
}

// several images of one size → a DataArrayTexture with mipmaps (wraps like a normal texture)
function arrayTexture(images, size, srgb, aniso) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  const data = new Uint8Array(size * size * 4 * images.length);
  images.forEach((im, k) => {
    g.drawImage(im, 0, 0, size, size);
    data.set(g.getImageData(0, 0, size, size).data, k * size * size * 4);
  });
  const t = new THREE.DataArrayTexture(data, size, size, images.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
