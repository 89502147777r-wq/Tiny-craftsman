import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Loads the CC-BY machine models (see CREDITS.md). Files were optimised with
// glTF-Transform (WebP textures ≤ 1024 px, meshopt geometry). Every machine
// gets its own copy of the scene graph so its parts can move independently.
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

export function loadModel(name) {
  if (!cache.has(name)) {
    cache.set(name, new Promise((res, rej) => loader.load(`assets/models/${name}.glb`, (g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.anisotropy = 4; if (m.transparent && m.opacity > 0.9) { m.transparent = false; m.depthWrite = true; } }   // (an opaque part marked BLEND: the loader turned its depth writes off — what is drawn after it would cover it)
        }
      });
      res(g);
    }, undefined, rej)));
  }
  return cache.get(name).then((g) => ({ scene: g.scene.clone(true), animations: g.animations }));
}

export function findNode(root, name) {
  let out = null;
  root.traverse((o) => { if (!out && o.name === name) out = o; });
  return out;
}

// Wrap a loaded scene so that: forward = +X, it stands on y = 0, its centre
// (or a chosen pivot) sits at the origin, and its size matches the real
// machine at 1:12. `forward` is the model's own forward axis.
export function normalise(scene, { forward = '+z', length, height, pivot }) {
  const holder = new THREE.Group();
  const turn = new THREE.Group();
  turn.add(scene);
  turn.rotation.y = { '+z': Math.PI / 2, '-z': -Math.PI / 2, '+x': 0, '-x': Math.PI }[forward];
  holder.add(turn);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(turn);
  const size = box.getSize(new THREE.Vector3());
  const k = length ? length / size.x : height / size.y;
  turn.scale.setScalar(k);
  holder.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(turn);
  const c = pivot ? pivot.getWorldPosition(new THREE.Vector3()) : b2.getCenter(new THREE.Vector3());
  turn.position.set(-c.x, -b2.min.y, -c.z);
  holder.updateMatrixWorld(true);
  return { holder, scale: k };
}
