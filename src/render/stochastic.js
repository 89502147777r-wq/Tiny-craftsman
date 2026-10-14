import * as THREE from 'three';

// Hex-tile ("stochastic") texturing: the plane is covered by a triangle grid,
// every grid vertex gets its own random offset into the photo texture and
// the three nearest are blended with contrast-preserving weights
// (Heitz & Neyret 2018, Mikkelsen 2022). The photo then never repeats in a
// visible grid. Offsets only (no rotation), so tangent-space normal maps
// stay valid. Mip levels come from the unshifted UV, so no seams.
export const STOCHASTIC_GLSL = /* glsl */ `
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
  vec3 tcW; vec2 tcO1, tcO2, tcO3; float tcCell = 0.55;
  // call once per fragment with the base UV
  void tcStochSetup(vec2 uv) {
    vec2 v1, v2, v3;
    tcTriGrid(uv / tcCell, tcW, v1, v2, v3);
    tcO1 = tcHash2(v1) * 7.31; tcO2 = tcHash2(v2) * 7.31; tcO3 = tcHash2(v3) * 7.31;
    vec3 w = pow(tcW, vec3(5.0));
    tcW = w / (w.x + w.y + w.z);
  }
  vec4 tcStoch(sampler2D t, vec2 uv) {
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    return textureGrad(t, uv + tcO1, dx, dy) * tcW.x
         + textureGrad(t, uv + tcO2, dx, dy) * tcW.y
         + textureGrad(t, uv + tcO3, dx, dy) * tcW.z;
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
    map: S.map_fragment.replace('texture2D( map, vMapUv )', 'tcStoch( map, vMapUv )'),
    normal: S.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'tcStoch( normalMap, vNormalMapUv )'),
    rough: S.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'tcStoch( roughnessMap, vRoughnessMapUv )'),
    ao: S.aomap_fragment.replace('texture2D( aoMap, vAoMapUv )', 'tcStoch( aoMap, vAoMapUv )'),
  };
}
