import * as THREE from 'three';
import { MATERIALS } from '../config.js';

// Colour of the ground by depth, shared by the soil shader (strata), the
// spoil it makes, the crumbs in flight and the load on the shovel, so what
// comes off the blade has the colour of the layer it was cut from.
// `layer` = thickness of one layer (one pass of the shovel), metres.
export const SOIL = { layer: 0.012 };
const BASE = new THREE.Color(0xb59a78);           // freshly cut, moist sandy soil (linear-ish multiplier for the photo texture)

export function strataFactor(depth, out = new THREE.Color()) {
  const k = Math.floor(Math.max(0, depth) / SOIL.layer);
  out.setRGB(Math.pow(0.85, k), Math.pow(0.83, k), Math.pow(0.8, k));
  if (k % 2) out.multiply(_t.setRGB(0.93, 0.95, 1.02)); else out.multiply(_t.setRGB(1.06, 1.0, 0.9));
  return out;
}

// instance / material colour for crumbs, clods and the load on the blade
export function soilTint(depth, out = new THREE.Color()) {
  return strataFactor(depth, out).multiply(BASE);
}
const _t = new THREE.Color();

// crumbs / stones / the load of other materials (the particle texture is the brown
// cut-soil photo, so stone greys are pushed a little towards blue to come out grey)
const MAT_TINT = MATERIALS.map((m, k) => (k === 0 ? null : new THREE.Color(m.color)));
const STONE = new THREE.Color(0.62, 0.8, 1.15);
const CONC = new THREE.Color(0.42, 0.47, 0.6);   // grey after the brown particle texture
export function materialTint(mat, depth, out = new THREE.Color()) {
  if (!mat) return soilTint(depth, out);
  if (mat === 9) return out.copy(CONC);   // fresh concrete
  out.copy(MAT_TINT[mat]);
  if (mat >= 2) out.multiply(STONE);
  return out;
}
