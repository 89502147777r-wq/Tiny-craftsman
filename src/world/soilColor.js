import * as THREE from 'three';

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
