import * as THREE from 'three';
import { TRAY, LOAM_TILE, MATERIALS, CONCRETE } from '../config.js';
import { STOCHASTIC_GLSL, stochasticChunks, stochasticUniforms, textureMean } from '../render/stochastic.js';
import { innerCorner } from './plotShape.js';

// The soil of the plot.
//   • untouched ground: sand photo, stochastically tiled (no repeats), patches
//   • cut faces and pit floors: moist, layered — every pass of the shovel deeper
//     is a darker layer with a wavy boundary
//   • spoil (loose soil): the colour of the layer it was dug from (the terrain
//     keeps that depth per cell: aSoil.w)
//   • loose sand / crushed stone: their photo textures (aMat = share of each in
//     the top 2 mm, from the terrain layers)
//   • chalk line of the setting-out, levelling overlay (нивелир), the rounded
//     tray corner
// Two variants share the colouring: "full" (stochastic photo texturing) and
// "light" (plain texture lookups, for devices whose GPU cannot build the full one).

// shared GLSL: layer colour for a depth below the original surface
const STRATA_GLSL = /* glsl */ `
  float tcSNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  vec3 tcStrata(float below, vec2 xz, float y) {
    float wob = (tcSNoise(xz * 55.0 + y * 30.0) - 0.5) * 0.35; // wavy layer boundaries
    float n = below / uLayer + wob;
    float layer = floor(n);
    float f = n - layer;
    vec3 tint = mod(layer, 2.0) < 0.5 ? vec3(1.06, 1.0, 0.9) : vec3(0.93, 0.95, 1.02);
    vec3 c = pow(vec3(0.85, 0.83, 0.8), vec3(layer)) * tint;
    // a thin darker seam where one layer meets the next
    return c * (1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.1, f)) * step(0.5, layer));
  }
`;

function baseUniforms(tex) {
  return {
    tWall: { value: tex.wall.diff },
    uWallMean: { value: textureMean(tex.wall.diff) },
    tLoam: { value: tex.loam.diff },
    uLoamMean: { value: textureMean(tex.loam.diff) },
    uLoamScale: { value: 1 / LOAM_TILE },
    tFloor: { value: tex.ply.diff },
    uWallScale: { value: 1 / 0.16 },
    uFloorY: { value: TRAY.floor },
    tMask: { value: null },      // R chalk, G inside outline, B design depth
    uPlot: { value: new THREE.Vector4(-0.3, -0.225, 0.6, 0.45) }, // x0, z0, sizeX, sizeZ
    uSoilY: { value: TRAY.soil },
    uChalk: { value: 1 },
    uLevel: { value: 0 },
    uLayer: { value: 0.012 },   // thickness of one dug layer = one pass of the shovel
    uTime: { value: 0 },
    uCorner: { value: (() => { const c = innerCorner(); return new THREE.Vector4(c.cx, c.cz, c.r, 0); })() },
    uCornerSign: { value: (() => { const c = innerCorner(); return new THREE.Vector2(c.sx, c.sz); })() },
    tMat: { value: tex.matDiff },
    uClock: { value: 0 },
    uCure: { value: CONCRETE.cure },
    uMatScale: { value: new THREE.Vector3(1 / MATERIALS[1].tile, 1 / MATERIALS[2].tile, 1 / MATERIALS[3].tile) },
  };
}

const VERT_COMMON = `#include <common>
        attribute vec4 aSoil;
        attribute vec3 aMat;
        attribute vec3 aConc;
        varying vec4 vSoil;
        varying vec3 vMat;
        varying vec3 vConc;
        varying vec3 vWPos;
        varying vec3 vWNrm;`;
const VERT_PROJECT = `#include <project_vertex>
        vSoil = aSoil;
        vMat = aMat;
        vConc = aConc;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`;

// one sampler per declaration: some mobile shader compilers choke on lists
const FRAG_DECL = `
        uniform sampler2D tWall;
        uniform sampler2D tLoam;
        uniform sampler2D tFloor;
        uniform sampler2D tMask;
        uniform highp sampler2DArray tMat;
        uniform vec3 uMatScale;
        varying vec3 vMat;
        varying vec3 vConc;
        uniform float uClock;
        uniform float uCure;
        uniform vec4 uWallMean;
        uniform vec4 uLoamMean;
        uniform float uLoamScale;
        uniform float uWallScale;
        uniform float uFloorY;
        uniform float uChalk;
        uniform float uLevel;
        uniform float uSoilY;
        uniform float uTime;
        uniform float uLayer;
        uniform vec4 uPlot;
        uniform vec4 uCorner;
        uniform vec2 uCornerSign;
        varying vec4 vSoil;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float tcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

// colour of the soil at this fragment, given the colour of the untouched ground (topC)
// and of the cut material (wallC)
const FRAG_SOIL = `
        float dig = smoothstep(0.0003, 0.0022, vSoil.x);
        float lse = smoothstep(0.00015, 0.0015, vSoil.y);
        vec3 cutC = wallC * vec3(0.78, 0.70, 0.62) * 0.72;          // moist fresh cut
        vec3 soilC = mix(topC.rgb, cutC * tcStrata(max(0.0, uSoilY - vWPos.y), vWPos.xz, vWPos.y), dig);
        // spoil: the same cut material, coloured like the layer it came from
        vec3 looseC = wallTopC * vec3(0.78, 0.70, 0.62) * 0.72 * tcStrata(vSoil.w, vWPos.xz, 0.0) * 1.08;
        soilC = mix(soilC, looseC, lse);
        // loose sand and crushed stone on top (both stone sizes share one photo)
        {
          vec2 mq = vWPos.xz;
          vec3 cS = texture(tMat, vec3(mq * uMatScale.x, 0.0)).rgb * vec3(1.05, 1.0, 0.86);
          // granite crushed stone: medium grey (the photo is a light driveway gravel)
          vec3 c5 = texture(tMat, vec3(mq * uMatScale.y, 1.0)).rgb * vec3(0.5, 0.5, 0.52);
          vec3 c20 = texture(tMat, vec3(mq * uMatScale.z + 0.37, 1.0)).rgb * vec3(0.54, 0.53, 0.53);
          float mSum = vMat.x + vMat.y + vMat.z;
          vec3 mc = (cS * vMat.x + c5 * vMat.y + c20 * vMat.z) / max(0.001, mSum);
          soilC = mix(soilC, mc, smoothstep(0.0, 1.0, clamp(mSum, 0.0, 1.0)));
        }
        // concrete: wet and dark when fresh, light grey once set; trowelled = even tone
        float concW = smoothstep(0.00008, 0.0006, vConc.x);
        float cure = clamp((uClock - vConc.y) / uCure, 0.0, 1.0);
        {
          // fresh: an even, wet cement paste (only big soft patches of bleed water);
          // set: matt light grey, cloudy, with fine pores; trowelled = more even
          vec2 cq = vWPos.xz;
          float big = tcSNoise(cq * 7.0) * 0.6 + tcSNoise(cq * 19.0 + 3.0) * 0.4;   // (shared noise: the light shader has no tcFbm)
          vec3 fresh = vec3(0.098, 0.097, 0.093) * mix(0.94, 1.05, big);
          vec3 setC = vec3(0.42, 0.413, 0.392) * mix(0.88, 1.05, mix(big, 0.6, vConc.z * 0.6));
          float pore = step(0.982, tcHash(floor(cq * 1100.0))) * (1.0 - 0.7 * vConc.z);
          setC *= 1.0 - pore * 0.35;
          // dries patchily
          vec3 cc = mix(fresh, setC, smoothstep(0.05, 1.0, cure + (big - 0.5) * 0.2));
          // drying starts at the edges and on thin spots
          soilC = mix(soilC, cc, concW);
        }
        // the tray bottom shows through where everything has been dug out
        float bottom = (1.0 - smoothstep(uFloorY + 0.0002, uFloorY + 0.0009, vWPos.y)) * (1.0 - lse);
        soilC = mix(soilC, texture2D(tFloor, vWPos.xz * 4.0).rgb * 0.8, bottom);
        soilC *= 1.0 - 0.32 * vSoil.z;
        // setting-out: chalk line, outline regions and their design depth
        vec2 q = vWPos.xz;
        vec4 mk = texture2D(tMask, (q - uPlot.xy) / uPlot.zw);
        float grain = tcHash(floor(q * 2400.0));
        float chalk = smoothstep(0.25, 0.75, mk.r) * (1.0 - dig) * (1.0 - lse) * step(0.25, grain);
        soilC = mix(soilC, vec3(0.80, 0.79, 0.74), chalk * uChalk * 0.9);
        // levelling overlay inside the outlines
        if (uLevel > 0.5 && mk.g > 0.5) {
          float targetY = uSoilY - mk.b * 0.1;
          float dy = vWPos.y - targetY;
          vec3 lv = dy > 0.001 ? vec3(1.0, 0.45, 0.12) : (dy < -0.001 ? vec3(0.2, 0.45, 1.0) : vec3(0.25, 1.0, 0.35));
          float fl = fract(vWPos.y / 0.002);
          float iso = 1.0 - smoothstep(0.0, 0.08, min(fl, 1.0 - fl));
          soilC = mix(soilC, lv * 0.6, 0.35);
          soilC = mix(soilC, lv, iso * 0.6);
        }
        diffuseColor.rgb *= soilC;`;

// the soil ends at the rounded corner of the tray — cut at the very end of the
// shader, after every texture lookup
const FRAG_CORNER = `#include <dithering_fragment>
        {
          vec2 dc = (vWPos.xz - uCorner.xy) * uCornerSign;
          if (dc.x > 0.0 && dc.y > 0.0 && length(dc) > uCorner.z) discard;
        }`;

const ROUGH_TAIL = `
        roughnessFactor = mix(max(roughnessFactor, 0.94), 0.82, smoothstep(0.003, 0.02, vSoil.x)); // dry earth has no sheen
        {
          // fresh concrete has a wet sheen (glossy when trowelled), set concrete is matt
          float cw = smoothstep(0.00008, 0.0006, vConc.x), cu = clamp((uClock - vConc.y) / uCure, 0.0, 1.0);
          float wetR = mix(0.24, 0.1, vConc.z), dryR = mix(0.9, 0.72, vConc.z);   // wet paste glistens
          roughnessFactor = mix(roughnessFactor, mix(wetR, dryR, smoothstep(0.1, 0.8, cu)), cw);
        }`;

export function makeTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.top.diff,
    normalMap: tex.top.nor,
    normalScale: new THREE.Vector2(1.7, 1.7),
    roughnessMap: tex.top.arm,
    aoMap: tex.top.arm,
    aoMapIntensity: 0.8,
    roughness: 1,
    metalness: 0,
  });
  const uniforms = { ...baseUniforms(tex), ...stochasticUniforms(tex.top.diff, tex.top.nor, tex.top.arm), tMatN: { value: tex.matNor } };
  mat.userData.uniforms = uniforms;
  const ch = stochasticChunks();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_COMMON).replace('#include <project_vertex>', VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_DECL}\n        uniform highp sampler2DArray tMatN;${STOCHASTIC_GLSL}${STRATA_GLSL}`)
      .replace('#include <map_fragment>', `
        tcStochSetup(vMapUv);
        vec3 wn = normalize(vWNrm);
        vec4 topC = tcStoch(map, vMapUv, tcMeanMap);
        // large patches: drier / damper / more clayey ground, so the plot never looks stamped
        {
          float m1 = tcFbm(vWPos.xz * 2.6);
          float m2 = tcFbm(vWPos.xz * 0.8 + 11.0);
          float m3 = tcFbm(vWPos.xz * 9.0 + 5.0);
          topC.rgb *= mix(0.88, 1.08, m1) * mix(0.93, 1.05, m3);
          topC.rgb = mix(topC.rgb, topC.rgb * vec3(1.08, 0.97, 0.86), smoothstep(0.45, 0.75, m2));
          topC.rgb = mix(topC.rgb, vec3(dot(topC.rgb, vec3(0.33))) * vec3(0.98, 0.96, 0.93), smoothstep(0.55, 0.8, 1.0 - m2) * 0.2);
          vec3 sec = tcStoch(tLoam, vWPos.xz * uLoamScale, uLoamMean).rgb;
          topC.rgb = mix(topC.rgb, sec, smoothstep(0.55, 0.8, tcFbm(vWPos.xz * 1.7 + 23.0)) * 0.3);
        }
        vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 wallTopC = texture2D(tWall, vWPos.xz * uWallScale).rgb;
        vec3 wallC = texture2D(tWall, vWPos.zy * uWallScale).rgb * bw.x + wallTopC * bw.y + texture2D(tWall, vWPos.xy * uWallScale).rgb * bw.z;
        // softer, less saturated spade marks so the layers read
        wallC = mix(uWallMean.rgb, mix(vec3(dot(wallC, vec3(0.3333))), wallC, 0.75), 0.55);
        wallTopC = mix(uWallMean.rgb, wallTopC, 0.6);
        ${FRAG_SOIL}`)
      .replace('#include <normal_fragment_maps>', `${ch.normal}
        float steepF = smoothstep(0.25, 0.75, 1.0 - normalize(vWNrm).y);
        normal = normalize(mix(normal, normalize(vNormal) * faceDirection, max(steepF * 0.8, smoothstep(0.0, 0.0012, vSoil.y) * 0.45)));
        {
          float ms = clamp(vMat.x + vMat.y + vMat.z, 0.0, 1.0);
          vec3 n0 = texture(tMatN, vec3(vWPos.xz * uMatScale.x, 0.0)).xyz;
          vec3 n1 = texture(tMatN, vec3(vWPos.xz * uMatScale.y, 1.0)).xyz;
          vec3 n2 = texture(tMatN, vec3(vWPos.xz * uMatScale.z + 0.37, 1.0)).xyz;
          vec3 mn = (n0 * vMat.x + n1 * vMat.y + n2 * vMat.z) / max(0.001, vMat.x + vMat.y + vMat.z) * 2.0 - 1.0;
          vec3 off = (viewMatrix * vec4(mn.x, 0.0, mn.y, 0.0)).xyz;
          normal = normalize(mix(normal, normalize(normalize(vNormal) * faceDirection + off * 1.3), ms));
          // concrete: its own surface instead of the soil photo — lumpy as poured, flat when trowelled
          float cw = smoothstep(0.00008, 0.0006, vConc.x);
          if (cw > 0.001) {
            // soft slump waves as poured (none once trowelled), a faint paste ripple
            vec2 cq = vWPos.xz * 26.0;
            float e = 0.25, f0 = tcFbm(cq), fx = tcFbm(cq + vec2(e, 0.0)), fz = tcFbm(cq + vec2(0.0, e));
            vec2 rq = vWPos.xz * 160.0;
            float r0 = tcNoise(rq), rx = tcNoise(rq + vec2(0.3, 0.0)), rz = tcNoise(rq + vec2(0.0, 0.3));
            vec3 g = vec3(f0 - fx, 0.0, f0 - fz) * (1.0 - vConc.z) * 0.55 + vec3(r0 - rx, 0.0, r0 - rz) * (1.0 - 0.8 * vConc.z) * 0.12;
            vec3 cn = normalize(normalize(vNormal) * faceDirection + (viewMatrix * vec4(g, 0.0)).xyz);
            normal = normalize(mix(normal, cn, cw));
          }
        }`)
      .replace('#include <aomap_fragment>', ch.ao.replace('tcStoch( aoMap, vAoMapUv, tcMeanArm )', 'mix(tcStoch( aoMap, vAoMapUv, tcMeanArm ), vec4(1.0), smoothstep(0.00008, 0.0006, vConc.x))'))
      .replace('#include <roughnessmap_fragment>', `${ch.rough}${ROUGH_TAIL}`)
      .replace('#include <dithering_fragment>', FRAG_CORNER);
  };
  mat.customProgramCacheKey = () => 'tc-terrain-12';
  return mat;
}

// Light variant: the same soil colouring with plain texture lookups (no
// stochastic tiling, no extra normal tricks). Used when a device cannot build
// the full shader.
export function makeLightTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ map: tex.top.diff, normalMap: tex.top.nor, roughness: 1, metalness: 0 });
  const uniforms = baseUniforms(tex);
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_COMMON).replace('#include <project_vertex>', VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_DECL}${STRATA_GLSL}`)
      .replace('#include <map_fragment>', `
        vec4 topC = texture2D(map, vMapUv);
        vec3 wallTopC = mix(uWallMean.rgb, texture2D(tWall, vWPos.xz * uWallScale).rgb, 0.6);
        vec3 wallC = mix(uWallMean.rgb, texture2D(tWall, vec2(vWPos.x + vWPos.z, vWPos.y) * uWallScale).rgb, 0.5);
        wallC = mix(wallC, wallTopC, smoothstep(0.4, 0.8, normalize(vWNrm).y));
        ${FRAG_SOIL}`)
      .replace('#include <dithering_fragment>', FRAG_CORNER);
  };
  mat.customProgramCacheKey = () => 'tc-terrain-light-6';
  return mat;
}

// Last resort: no custom shader at all.
export function makeFallbackTerrainMaterial(tex) {
  return new THREE.MeshStandardMaterial({ map: tex.top.diff, normalMap: tex.top.nor, roughnessMap: tex.top.arm, roughness: 1, metalness: 0 });
}
