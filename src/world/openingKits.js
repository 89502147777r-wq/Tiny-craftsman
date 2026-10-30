import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The modelled doors, gates and windows (assets/models/openings, CC-BY / CC0 — see CREDITS.md),
// fitted to any opening: a model of a fixed size can't be scaled as a whole (its frames would
// grow fat or thin), so it is cut into nine (9-slice): the band of the frame along each edge
// keeps its width, only the middle stretches; the small hardware (handles, locks, knobs) is
// moved, never stretched. Each part of a model has its role in its material's name ("frame:…"):
// frame — tinted to the chosen colour, glass / frosted — the game's glazing, metal — the
// hardware, seal, leaf, keep — as drawn. Everything in mm, the local frame of windows.js
// (x along the wall from the middle, y up from the bottom, z across, + outside).
//
// The models load in the background; until they come the openings are drawn as before
// (windows.js, doors.js, garage.js) and are rebuilt when they arrive (onKits).

// each kit: its frame band across x / y (mm, in the model) — what keeps its width
export const KITS = {
  w_tilt: { mx: 115, my: 115 },   // a PVC tilt-and-turn window, one sash
  w_alu: { mx: 70, my: 70 },      // a narrow aluminium window: a fixed pane and three sashes
  w_slide: { mx: 120, my: 120 },  // a PVC lift-and-slide portal, two panels
  d_black: { mx: 140, my: 150, holdY: true },        // entrance, black steel with four lights and a pull bar
  d_wood_side: { mx: 120, my: 140, holdY: true, side: 600 },   // entrance, dark wood with a frosted side light
  d_steel_grey: { mx: 160, my: 160, holdY: true },   // entrance, grey steel, panelled
  d_steel_white: { mx: 160, my: 160, holdY: true },
  d_oak: { mx: 160, my: 160, holdY: true },          // interior, oak, panelled
  d_white_glass: { mx: 150, my: 150, holdY: true },  // white with a big glass light
  d_leaf_a: { mx: 120, my: 120, holdY: true, leaf: true },   // leaves only (the frame is ours): walnut with lights
  d_leaf_e: { mx: 120, my: 120, holdY: true, leaf: true },
  d_leaf_f: { mx: 120, my: 120, holdY: true, leaf: true },
  g_sect: { mx: 140, my: 140 },   // a sectional garage door, smooth, a few grooves across
  g_wicket: { mx: 120, my: 140, holdY: true },   // the wicket door to go with it
  g_white: { mx: 120, my: 120, holdY: true },   // an up-and-over door, white steel, ribbed upright (a scan)
  g_modern: { mx: 150, my: 150 },   // a modern anthracite door, two rows of glazed slits
  g_roll: { mx: 90, my: 90 },     // a roller door's curtain
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const kits = new Map(), waiters = new Set();
let loading = null;
export const hasKit = (n) => kits.has(n);
export const onKits = (f) => waiters.add(f);
export const kitsLoaded = () => kits.size;

// a float copy of an attribute (the loaded ones may be quantized)
function floatAttr(a) {
  const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = a.getComponent(i, j);
  return new THREE.BufferAttribute(out, k);
}

// the connected pieces of a part (a handle, a lock, a knob — each its own piece): per vertex its
// piece, per piece its box
function pieces(geo) {
  const n = geo.attributes.position.count, p = geo.attributes.position, idx = geo.index;
  const up = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (up[a] !== a) a = up[a] = up[up[a]]; return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) up[a] = b; };
  // (the vertices on one spot are one even where the model's seams split them)
  const at = new Map();
  for (let i = 0; i < n; i++) { const key = `${Math.round(p.getX(i) * 2)},${Math.round(p.getY(i) * 2)},${Math.round(p.getZ(i) * 2)}`; const j = at.get(key); if (j === undefined) at.set(key, i); else join(i, j); }
  if (idx) for (let t = 0; t < idx.count; t += 3) { join(idx.getX(t), idx.getX(t + 1)); join(idx.getX(t), idx.getX(t + 2)); }
  const of = new Int32Array(n), boxes = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i); of[i] = r;
    let b = boxes.get(r); if (!b) boxes.set(r, (b = new THREE.Box3()));
    b.expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  }
  return { of, boxes };
}

function prepare(name, gltf) {
  const parts = [], box = new THREE.Box3();
  gltf.scene.updateMatrixWorld(true);
  const toMM = new THREE.Matrix4().makeScale(1000, 1000, 1000);
  const K = KITS[name];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mat = o.material, role = (mat.name || 'keep:').split(':')[0] || 'keep';
    if (K.skip?.includes(role)) return;
    const src = o.geometry, geo = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'uv']) if (src.attributes[a]) geo.setAttribute(a, floatAttr(src.attributes[a]));
    geo.setIndex(src.index ? Array.from(src.index.array) : [...Array(src.attributes.position.count).keys()]);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toMM, o.matrixWorld));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (K.clipY) {
      // (what is over the door's top left out)
      const p = geo.attributes.position, ix = geo.index.array, keep = [];
      for (let t = 0; t < ix.length; t += 3) if (Math.max(p.getY(ix[t]), p.getY(ix[t + 1]), p.getY(ix[t + 2])) <= K.clipY) keep.push(ix[t], ix[t + 1], ix[t + 2]);
      geo.setIndex(keep);
      if (!keep.length) return;
    }
    geo.computeBoundingBox();
    if (K.clipY) {
      // (the box of what is drawn: of the vertices the faces left use)
      const p = geo.attributes.position, b = new THREE.Box3(), v = new THREE.Vector3();
      for (const i of geo.index.array) b.expandByPoint(v.fromBufferAttribute(p, i));
      geo.boundingBox = b;
    }
    box.union(geo.boundingBox);
    parts.push({ geo, role, mat, pc: role === 'metal' ? pieces(geo) : null });
  });
  kits.set(name, { name, parts, box, ...KITS[name] });
}

// a kit is loaded when it is first wanted (an opening of it built, or chosen to be): → whether it is in
// (the openings are built anew of it when it comes — kitsLoaded() changes); the others never loaded:
// their textures would take the phone's memory for nothing
const loadingK = new Map();
function loadOne(n) {
  return new Promise((res) => loader.load(`assets/models/openings/${KITS[n].file || n}.glb`, (g) => { try { prepare(n, g); } catch (e) { console.warn('kit', n, e); } res(); }, undefined, () => res()))
    .then(() => { for (const f of waiters) f(n); });
}
export function wantKit(n) {
  if (!n || !KITS[n]) return false;
  if (kits.has(n)) return true;
  if (!loadingK.has(n)) loadingK.set(n, loadOne(n));
  return false;
}
// the kits asked for so far, all in
export const kitsPending = () => Promise.all([...loadingK.values()]);
// all of them (the tests)
export function loadKits() {
  if (loading) return loading;
  for (const n of Object.keys(KITS)) wantKit(n);
  return (loading = kitsPending());
}

// one axis cut into nine: [b0, b1] (the model) onto [t0, t1], the bands m at the ends kept
function slicer(b0, b1, t0, t1, m) {
  const L = b1 - b0, T = t1 - t0;
  m = Math.min(m, L / 2 - 1);
  // (an opening narrower than the two bands: all of it in scale)
  if (T < 2 * m + 10) return (v) => t0 + (v - b0) * T / L;
  const k = (T - 2 * m) / (L - 2 * m);
  return (v) => (v <= b0 + m ? t0 + (v - b0) : v >= b1 - m ? t1 - (b1 - v) : t0 + m + (v - b0 - m) * k);
}

// The kit `name` fitted to [x0, x1] × [y0, y1], the middle of its depth at z: → its parts
// [{ geo, role, mat }] (new geometries; the caller gives them materials). opts: flip — mirrored
// (the left-hand of a pair), split — the frame's outer half apart from its inner (role
// 'frameIn': a laminated PVC profile is coloured outside only), depth — its depth to (mm)
export function fitKit(name, x0, x1, y0, y1, z, opts = {}) {
  const K = kits.get(name);
  if (!K) return null;
  const B = K.box, sx = slicer(B.min.x, B.max.x, x0, x1, K.mx), sy = slicer(B.min.y, B.max.y, y0, y1, K.my);
  const zc = (B.min.z + B.max.z) / 2, kz = opts.depth ? opts.depth / (B.max.z - B.min.z) : 1;
  const out = [];
  for (const P of K.parts) {
    const geo = P.geo.clone(), p = geo.attributes.position, n = p.count;
    const moved = new Map();
    for (let i = 0; i < n; i++) {
      let X = p.getX(i), Y = p.getY(i);
      const pb = P.pc && P.pc.boxes.get(P.pc.of[i]);
      if (pb && Math.max(pb.max.x - pb.min.x, pb.max.y - pb.min.y) < 400) {
        // a piece of the hardware: moved with the point it is on, its own shape kept
        let d = moved.get(pb);
        if (!d) {
          const cx = (pb.min.x + pb.max.x) / 2, cy = (pb.min.y + pb.max.y) / 2;
          // (the handles of a door stay at the height of a hand)
          const ty = K.holdY ? Math.min(y0 + (cy - B.min.y), y1 - 250) : sy(cy);
          moved.set(pb, (d = [sx(cx) - cx, ty - cy]));
        }
        X += d[0]; Y += d[1];
      } else { X = sx(X); Y = sy(Y); }
      p.setXYZ(i, opts.flip ? -X : X, Y, z + (p.getZ(i) - zc) * kz);
    }
    // (its bounds anew: the copied ones are the model's — the camera would cull it by them)
    geo.boundingBox = null; geo.boundingSphere = null;
    if (opts.flip) {
      const nr = geo.attributes.normal;
      for (let i = 0; i < n; i++) nr.setX(i, -nr.getX(i));
      const ix = geo.index.array;
      for (let t = 0; t < ix.length; t += 3) { const a = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = a; }
    }
    if (opts.split && P.role === 'frame') {
      // the frame's faces apart: on the outer half of its depth / on the inner
      const ix = geo.index.array, A = [], Bn = [];
      for (let t = 0; t < ix.length; t += 3) ((p.getZ(ix[t]) + p.getZ(ix[t + 1]) + p.getZ(ix[t + 2])) / 3 >= z ? A : Bn).push(ix[t], ix[t + 1], ix[t + 2]);
      const gi = geo.clone(); gi.setIndex(Bn); geo.setIndex(A);
      out.push({ geo, role: 'frame', mat: P.mat }, { geo: gi, role: 'frameIn', mat: P.mat });
    } else out.push({ geo, role: P.role, mat: P.mat });
  }
  return out;
}

// one geometry of the parts of one material (they may differ in their attributes: the common ones kept)
export function mergeParts(list, mergeGeometries) {
  if (list.length === 1) return list[0];
  const names = Object.keys(list[0].attributes).filter((a) => list.every((g) => g.attributes[a]));
  for (const g of list) for (const a of Object.keys(g.attributes)) if (!names.includes(a)) g.deleteAttribute(a);
  return mergeGeometries(list, false);
}

// the kit's own size (mm): [w, h, d]
export function kitSize(name) {
  const K = kits.get(name);
  return K ? [K.box.max.x - K.box.min.x, K.box.max.y - K.box.min.y, K.box.max.z - K.box.min.z] : null;
}

// a material of a kit, tinted (made once for each)
const TINT = new Map();
export function kitMat(src, hex, o = {}) {
  const key = src.uuid + ':' + hex + ':' + JSON.stringify(o);
  let m = TINT.get(key);
  if (!m) {
    m = src.clone();
    if (hex !== null) m.color.setHex(hex);
    // (opaque, both its faces; a texture with holes in it — the slits of a door — cut, not blended)
    m.alphaTest = src.transparent && src.map ? 0.5 : 0;
    m.side = THREE.DoubleSide; m.transparent = false; m.depthWrite = true;
    m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null; m.emissiveMap = null;   // (fewer shaders to build, fewer textures)
    Object.assign(m, o);
    if (m.map) m.map.anisotropy = 4;
    TINT.set(key, m);
  }
  return m;
}
