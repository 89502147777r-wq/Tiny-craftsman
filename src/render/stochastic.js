import * as THREE from 'three';

// Hex-tile ("stochastic") texturing: the plane is covered by a triangle grid,
// every grid vertex gets its own random offset into the photo texture and
// the three nearest are blended with contrast-preserving weights
// (Heitz & Neyret 2018, Mikkelsen 2022). The photo then never repeats in a
// visible grid. Offsets only (no rotation), so tangent-space normal maps
// stay valid. Mip levels come from the unshifted UV, so no seams.
export const STOCHASTIC_GLSL = /* glsl */ `
  uniform vec4 tcMeanMap;
  uniform vec4 tcMeanNor;
  uniform vec4 tcMeanArm;
  vec2 tcHash2(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }
  // grid of equilateral triangles: barycentric weights + three vertex ids
  void tcTriGrid(vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
    uv *= 3.4641016; // 2·√3
    vec2 sk = vec2(uv.x - 0.57735027 * uv.y, 1.15470054 * uv.y);
    vec2 b = floor(sk);
    vec3 t = vec3(fract(sk), 0.0);
    t.z = 1.0 - t.x - t.y;
    if (t.z > 0.0) { w = vec3(t.z, t.y, t.x); v1 = b; v2 = b + vec2(0.0, 1.0); v3 = b + vec2(1.0, 0.0); }
    else { w = vec3(-t.z, 1.0 - t.y, 1.0 - t.x); v1 = b + vec2(1.0); v2 = b + vec2(1.0, 0.0); v3 = b + vec2(0.0, 1.0); }
  }
  vec3 tcW; vec2 tcO1, tcO2, tcO3; float tcCell = 0.6;
  // call once per fragment with the base UV
  void tcStochSetup(vec2 uv) {
    vec2 v1, v2, v3;
    tcTriGrid(uv / tcCell, tcW, v1, v2, v3);
    tcO1 = tcHash2(v1) * 7.31; tcO2 = tcHash2(v2) * 7.31; tcO3 = tcHash2(v3) * 7.31;
    vec3 w = tcW * tcW;
    tcW = w / (w.x + w.y + w.z);
  }
  // Variance-preserving blend: the mix of three samples keeps the contrast
  // of the photo (a plain average would look washed out, "like plywood").
  // mean = average colour of the texture (computed on the CPU at load time).
  vec4 tcStoch(sampler2D t, vec2 uv, vec4 mean) {
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    vec4 c = (textureGrad(t, uv + tcO1, dx, dy) - mean) * tcW.x
           + (textureGrad(t, uv + tcO2, dx, dy) - mean) * tcW.y
           + (textureGrad(t, uv + tcO3, dx, dy) - mean) * tcW.z;
    return clamp(mean + c * inversesqrt(dot(tcW, tcW)), 0.0, 1.0);
  }
  // smooth value noise for large-scale colour patches
  float tcNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = tcHash2(i).x, b = tcHash2(i + vec2(1.0, 0.0)).x, c = tcHash2(i + vec2(0.0, 1.0)).x, d = tcHash2(i + vec2(1.0)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float tcFbm(vec2 p) { return tcNoise(p) * 0.5 + tcNoise(p * 2.03 + 7.1) * 0.3 + tcNoise(p * 4.1 + 3.3) * 0.2; }
`;

// Rewrite the standard chunks so map / normal / roughness / AO all sample stochastically.
export function stochasticChunks() {
  const S = THREE.ShaderChunk;
  return {
    map: S.map_fragment.replace('texture2D( map, vMapUv )', 'tcStoch( map, vMapUv, tcMeanMap )'),
    normal: S.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'tcStoch( normalMap, vNormalMapUv, tcMeanNor )'),
    rough: S.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'tcStoch( roughnessMap, vRoughnessMapUv, tcMeanArm )'),
    ao: S.aomap_fragment.replace('texture2D( aoMap, vAoMapUv )', 'tcStoch( aoMap, vAoMapUv, tcMeanArm )'),
  };
}

// Average colour of a loaded texture (linear 0..1 RGBA of the stored values).
const _means = new WeakMap();
export function textureMean(tex) {
  if (_means.has(tex)) return _means.get(tex);
  const img = tex.image;
  const out = new THREE.Vector4(0.5, 0.5, 0.5, 1);
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4 * 255;
    out.set(r / n, gg / n, b / n, 1);
    // colour textures are sampled as sRGB → linear in the shader
    if (tex.colorSpace === THREE.SRGBColorSpace) for (const k of ['x', 'y', 'z']) out[k] = Math.pow(out[k], 2.2);
  } catch (e) { console.warn('texture mean', e); }
  _means.set(tex, out);
  return out;
}

// uniforms for the three means of a material's map / normalMap / roughness-AO map
export function stochasticUniforms(map, nor, arm) {
  return {
    tcMeanMap: { value: map ? textureMean(map) : new THREE.Vector4(0.5, 0.5, 0.5, 1) },
    tcMeanNor: { value: nor ? textureMean(nor) : new THREE.Vector4(0.5, 0.5, 1, 1) },
    tcMeanArm: { value: arm ? textureMean(arm) : new THREE.Vector4(1, 0.8, 0, 1) },
  };
}
