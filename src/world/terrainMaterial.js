import * as THREE from 'three';
import { TRAY, LOAM_TILE, MATERIALS, CONCRETE, MODEL_SCALE, RESCALE } from '../config.js';
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
// the stones of the aggregate and a smooth noise (shared with the concrete in the U-blocks)
export const CONC_NOISE_GLSL = /* glsl */ `
  // the stones of the concrete aggregate: rounded grains (Voronoi cells with a dome),
  // x = height of the stone here (0 = cement paste between stones), yz = its slope
  vec3 tcStones(vec2 p) {
    vec2 ip = floor(p), fp = fract(p);
    float best = 8.0, br = 1.0; vec2 bc = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(fract(sin(dot(ip + g, vec2(127.1, 311.7))) * 43758.5453), fract(sin(dot(ip + g, vec2(269.5, 183.3))) * 43758.5453));
      vec2 r = g + 0.1 + o * 0.8 - fp;
      float rad = 0.32 + 0.28 * fract(o.x * 13.7 + o.y * 7.3);
      float d = length(r) / rad;
      if (d < best) { best = d; bc = r; br = rad; }
    }
    float dome = sqrt(max(0.0, 1.0 - best * best));
    vec2 grad = dome > 0.02 ? (bc / (br * br)) / dome : vec2(0.0);
    return vec3(dome, grad);
  }

  float tcSNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
`;
const STRATA_GLSL = CONC_NOISE_GLSL + /* glsl */ `
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
    uWet: { value: 0 },   // (rain: the soil wet — darker, with a sheen)
    uCure: { value: CONCRETE.cure },
    uMatScale: { value: new THREE.Vector3(1 / MATERIALS[1].tile, 1 / MATERIALS[2].tile, 1 / MATERIALS[3].tile) },
  };
}

const VERT_COMMON = `#include <common>
        attribute vec4 aSoil;
        attribute vec3 aMat;
        attribute vec3 aConc;
        attribute vec2 aExtra;
        varying vec4 vSoil;
        varying vec3 vMat;
        varying vec3 vConc;
        varying vec2 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNrm;`;
const VERT_PROJECT = `#include <project_vertex>
        vSoil = aSoil;
        vMat = aMat;
        vConc = aConc;
        vExtra = aExtra;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`;

// one sampler per declaration: some mobile shader compilers choke on lists
const FRAG_DECL = `
        uniform float uWet;
        uniform sampler2D tWall;
        uniform sampler2D tLoam;
        uniform sampler2D tFloor;
        uniform sampler2D tMask;
        uniform highp sampler2DArray tMat;
        uniform vec3 uMatScale;
        varying vec3 vMat;
        varying vec3 vConc;
        varying vec2 vExtra;
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
          vec3 c5 = texture(tMat, vec3(mq * uMatScale.y, 1.0)).rgb * vec3(0.56, 0.56, 0.58);
          vec3 c20 = texture(tMat, vec3(mq * uMatScale.z + 0.37, 1.0)).rgb * vec3(0.46, 0.45, 0.44);
          // the single stones: 5–20 mm fine and light, 20–40 mm coarse, each stone its own
          // shade, deep dark gaps between them
          if (vMat.y + vMat.z > 0.01) {
            vec2 mqs = mq * ${RESCALE.toFixed(5)};   // stones of real size at the model scale
            vec3 s5 = tcStones(mqs * 300.0), s20 = tcStones(mqs * 118.0 + 7.0);
            c5 *= mix(0.62, 1.0, smoothstep(0.0, 0.3, s5.x)) * (0.9 + 0.2 * tcHash(floor(mqs * 300.0)));
            c20 *= mix(0.35, 1.0, smoothstep(0.0, 0.4, s20.x)) * (0.78 + 0.4 * tcHash(floor(mqs * 118.0 + 7.0)));
          }
          float mSum = vMat.x + vMat.y + vMat.z;
          vec3 mc = (cS * vMat.x + c5 * vMat.y + c20 * vMat.z) / max(0.001, mSum);
          soilC = mix(soilC, mc, smoothstep(0.0, 1.0, clamp(mSum, 0.0, 1.0)));
        }
        // compacted with the plate: denser, a shade darker, the loose crumbs pressed in
        soilC *= 1.0 - 0.09 * vExtra.y;
        // concrete: wet and dark when fresh, light grey once set; trowelled = even tone
        float concW = smoothstep(0.00008, 0.0006, vConc.x);
        float cure = clamp((uClock - vConc.y) / uCure, 0.0, 1.0);
        {
          // fresh: an even, wet cement paste (only big soft patches of bleed water);
          // set: matt light grey, cloudy, with fine pores; trowelled = more even
          vec2 cq = vWPos.xz * ${RESCALE.toFixed(5)};   // real sizes of stones, pores, patches
          float big = tcSNoise(cq * 7.0) * 0.6 + tcSNoise(cq * 19.0 + 3.0) * 0.4;   // (shared noise: the light shader has no tcFbm)
          // as poured: a coarse grey mass, the stones of the aggregate showing; the
          // vibrator / rule / trowel bring the darker wet paste up and close it (vConc.z)
          float sm = vConc.z;
          // stones 5–20 mm (real) stick out of the paste as poured; the vibrator and the
          // rule sink them (the paste closes over them)
          // two sizes of aggregate (5–10 and 10–20 mm real), half-buried in the paste
          vec3 st = tcStones(cq * 240.0), st2 = tcStones(cq * 115.0 + 17.0);
          float sink = 0.45 + 0.5 * sm;
          float stone = max(smoothstep(sink, sink + 0.2, st.x) * step(0.45, tcHash(floor(cq * 240.0))),
                            smoothstep(sink + 0.05, sink + 0.25, st2.x) * step(0.55, tcHash(floor(cq * 115.0 + 17.0))));
          float shade = fract(sin(dot(floor(cq * 240.0), vec2(41.3, 289.1))) * 9631.7);
          vec3 paste = vec3(0.062, 0.062, 0.06) * mix(0.92, 1.05, big) * mix(1.0, 0.82, smoothstep(0.2, 1.0, sm));
          vec3 rock = vec3(0.092, 0.09, 0.086) * mix(0.8, 1.25, shade);   // stones still under a film of paste
          vec3 fresh = mix(paste, rock, stone * 0.8);
          vec3 setC = vec3(0.19, 0.187, 0.178) * mix(0.88, 1.05, mix(big, 0.6, vConc.z * 0.6));
          float pore = step(0.982, tcHash(floor(cq * 1100.0))) * (1.0 - 0.7 * vConc.z);
          setC *= 1.0 - pore * 0.35;
          // dries patchily
          vec3 cc = mix(fresh, setC, smoothstep(0.05, 1.0, cure + (big - 0.5) * 0.2));
          // a stripped side: the face cast against the boards — smooth, the joints and
          // grain of the 150 mm boards printed in it, a few blowholes
          vec3 wn = normalize(vWNrm);
          float cside = 1.0 - smoothstep(0.35, 0.7, wn.y);
          if (cside > 0.001) {
            float along = (abs(wn.x) > abs(wn.z) ? vWPos.z : vWPos.x) * ${RESCALE.toFixed(5)}, wy = vWPos.y * ${RESCALE.toFixed(5)};
            float by = fract(vWPos.y / ${(0.15 / MODEL_SCALE).toFixed(6)});
            float joint = 1.0 - smoothstep(0.0, 0.035, min(by, 1.0 - by));
            float grain = tcSNoise(vec2(along * 40.0, wy * 1400.0)) * 0.6 + tcSNoise(vec2(along * 9.0, wy * 300.0)) * 0.4;
            float hole = step(0.985, tcHash(floor(vec2(along, wy) * 900.0)));
            vec3 face = mix(vec3(0.07, 0.07, 0.067), vec3(0.17, 0.168, 0.161), smoothstep(0.05, 1.0, cure)) * (0.93 + 0.12 * grain) * (1.0 - 0.28 * joint) * (1.0 - 0.45 * hole);   // (no top-view noise here: it would streak)
            cc = mix(cc, face, cside);
          }
          // bitumen mastic brushed on (faces and top): black, a little brown where thin
          {
            float bn = tcSNoise((vWPos.xz * 400.0 + vWPos.y * 300.0) * ${RESCALE.toFixed(5)});
            vec3 bitC = vec3(0.012, 0.011, 0.01) * (0.85 + 0.3 * bn) + vec3(0.02, 0.012, 0.005) * (1.0 - smoothstep(0.4, 1.0, vExtra.x));
            cc = mix(cc, bitC, smoothstep(0.0, 0.6, vExtra.x));
          }
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
        float chalk = smoothstep(0.25, 0.75, mk.r) * (1.0 - dig) * (1.0 - lse) * step(0.25, grain) * (1.0 - concW);   // chalk is on the ground, not on concrete
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
          float wetR = mix(0.8, 0.32, vConc.z), dryR = mix(0.9, 0.72, vConc.z);   // moist and matt as poured, the worked paste glistens
          roughnessFactor = mix(roughnessFactor, mix(wetR, dryR, smoothstep(0.1, 0.8, cu)), cw);
          // bitumen on a face shines
          roughnessFactor = mix(roughnessFactor, 0.28, smoothstep(0.0, 0.6, vExtra.x) * cw);
        }
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.78, uWet);   // (after rain: a wet sheen)`;

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
        normal = normalize(mix(normal, normalize(vNormal) * faceDirection, vExtra.y * 0.55));   // compacted: pressed flat
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
            // as poured: lumps and the stones of the aggregate; after vibrator and rule a
            // fine texture; trowelled almost flat
            float rough = pow(1.0 - vConc.z, 1.5);
            vec2 cq = vWPos.xz * (55.0 * ${RESCALE.toFixed(5)});
            float e = 0.3, f0 = tcFbm(cq), fx = tcFbm(cq + vec2(e, 0.0)), fz = tcFbm(cq + vec2(0.0, e));
            vec2 sq = vWPos.xz * ${RESCALE.toFixed(5)};
            vec3 st = tcStones(sq * 240.0), st2 = tcStones(sq * 115.0 + 17.0);
            float sink = 0.45 + 0.5 * vConc.z;
            float w1 = smoothstep(sink - 0.1, sink + 0.25, st.x) * step(0.45, tcHash(floor(sq * 240.0)));
            float w2 = smoothstep(sink - 0.05, sink + 0.3, st2.x) * step(0.55, tcHash(floor(sq * 115.0 + 17.0)));
            vec2 rq = vWPos.xz * (700.0 * ${RESCALE.toFixed(5)});
            float r0 = tcNoise(rq), rx = tcNoise(rq + vec2(0.4, 0.0)), rz = tcNoise(rq + vec2(0.0, 0.4));
            vec3 g = vec3(f0 - fx, 0.0, f0 - fz) * rough * 0.9 - vec3(st.y, 0.0, st.z) * w1 * 0.12 - vec3(st2.y, 0.0, st2.z) * w2 * 0.06
                   + vec3(r0 - rx, 0.0, r0 - rz) * (1.0 - 0.85 * vConc.z) * 0.25;
            vec3 cn = normalize(normalize(vNormal) * faceDirection + (viewMatrix * vec4(g, 0.0)).xyz);
            normal = normalize(mix(normal, cn, cw * smoothstep(0.35, 0.7, normalize(vWNrm).y)));   // (not on a stripped side: it would streak)
            normal = normalize(mix(normal, normalize(vNormal) * faceDirection, cw * (1.0 - smoothstep(0.35, 0.7, normalize(vWNrm).y))));   // a cast face is smooth
          }
        }`)
      .replace('#include <aomap_fragment>', ch.ao.replace('tcStoch( aoMap, vAoMapUv, tcMeanArm )', 'mix(tcStoch( aoMap, vAoMapUv, tcMeanArm ), vec4(1.0), smoothstep(0.00008, 0.0006, vConc.x))'))
      .replace('#include <roughnessmap_fragment>', `${ch.rough}${ROUGH_TAIL}`)
      .replace('#include <dithering_fragment>', FRAG_CORNER);
  };
  mat.customProgramCacheKey = () => 'tc-terrain-23';
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
  mat.customProgramCacheKey = () => 'tc-terrain-light-17';
  return mat;
}

// Last resort: no custom shader at all.
export function makeFallbackTerrainMaterial(tex) {
  return new THREE.MeshStandardMaterial({ map: tex.top.diff, normalMap: tex.top.nor, roughnessMap: tex.top.arm, roughness: 1, metalness: 0 });
}

// Concrete cast in place outside the terrain (the channels of the U-blocks): the same
// colour and texture as the concrete of the foundation — fresh: dark wet paste with the
// stones of the aggregate showing; set: matt light grey, cloudy, fine pores; wet sheen
// while fresh. Per vertex: aPour — when it was poured (clock), uClock / uCure shared.
// steel: precast in a steel mould (a lintel) — the sides smooth, no boards printed in them
export function makeCastConcreteMaterial(uniforms, { steel = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPour;\nattribute float aSm;\nvarying float vPour;\nvarying float vSm;\nvarying vec3 vCWPos;\nvarying vec3 vCWNrm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPour = aPour;\nvSm = aSm;\n#ifdef USE_INSTANCING\nvCWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvCWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);\n#else\nvCWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCWNrm = normalize(mat3(modelMatrix) * objectNormal);\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uClock;
        uniform float uCure;
        varying float vPour;
        varying float vSm;
        varying vec3 vCWPos;
        varying vec3 vCWNrm;
        float tcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        ${CONC_NOISE_GLSL}
        // set concrete as on the foundation: matt light grey, cloudy, the fine grain of the
        // cement and the sand, small round pores (cq: real size)
        vec3 tcConcSet(vec2 cq, float big, float sm) {
          vec3 c = vec3(0.19, 0.187, 0.178) * mix(0.88, 1.05, mix(big, 0.6, sm * 0.6));
          c *= 0.94 + 0.09 * tcSNoise(cq * 650.0) + 0.05 * tcSNoise(cq * 2300.0 + 11.0);
          vec2 pc = cq * 1100.0;
          float pr = step(0.982, tcHash(floor(pc))) * (1.0 - smoothstep(0.12, 0.32, length(fract(pc) - 0.5)));
          return c * (1.0 - pr * 0.35 * (1.0 - 0.7 * sm));
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float cure = clamp((uClock - vPour) / uCure, 0.0, 1.0);
        {
          vec2 cq = vCWPos.xz * ${RESCALE.toFixed(5)};
          float big = tcSNoise(cq * 7.0) * 0.6 + tcSNoise(cq * 19.0 + 3.0) * 0.4;
          float sm = vSm;   // how much it was worked: vibrator, rule, trowel (0.3 as poured from a bucket)
          vec3 st = tcStones(cq * 240.0), st2 = tcStones(cq * 115.0 + 17.0);
          float sink = 0.45 + 0.5 * sm;
          float stone = max(smoothstep(sink, sink + 0.2, st.x) * step(0.45, tcHash(floor(cq * 240.0))),
                            smoothstep(sink + 0.05, sink + 0.25, st2.x) * step(0.55, tcHash(floor(cq * 115.0 + 17.0))));
          float shade = fract(sin(dot(floor(cq * 240.0), vec2(41.3, 289.1))) * 9631.7);
          vec3 paste = vec3(0.062, 0.062, 0.06) * mix(0.92, 1.05, big) * mix(1.0, 0.82, smoothstep(0.2, 1.0, sm));
          vec3 rock = vec3(0.092, 0.09, 0.086) * mix(0.8, 1.25, shade);
          vec3 fresh = mix(paste, rock, stone * 0.8);
          vec3 setC = tcConcSet(cq, big, sm);
          vec3 cc = mix(fresh, setC, smoothstep(0.05, 1.0, cure + (big - 0.5) * 0.2));
          // a side cast against the boards (seen once the formwork is off): smooth, the joints
          // and the grain of the 150 mm boards printed in it, a few blowholes — as the foundation
          float cside = 1.0 - smoothstep(0.35, 0.7, abs(normalize(vCWNrm).y));
          if (cside > 0.001) {
            vec3 wn = normalize(vCWNrm);
            float along = (abs(wn.x) > abs(wn.z) ? vCWPos.z : vCWPos.x) * ${RESCALE.toFixed(5)}, wy = vCWPos.y * ${RESCALE.toFixed(5)};
            float by = fract(vCWPos.y / ${(0.15 / MODEL_SCALE).toFixed(6)});
            float joint = ${steel ? '0.0' : '1.0 - smoothstep(0.0, 0.035, min(by, 1.0 - by))'};
            float grain = (tcSNoise(vec2(along * 40.0, wy * 1400.0)) * 0.6 + tcSNoise(vec2(along * 9.0, wy * 300.0)) * 0.4) * ${steel ? '0.3' : '1.0'};
            // the face: the same concrete as the top (its grain, its pores), the boards printed faintly
            vec2 sq2 = vec2(along, wy);
            float bigS = tcSNoise(sq2 * 7.0) * 0.6 + tcSNoise(sq2 * 19.0 + 3.0) * 0.4;
            vec3 face = mix(vec3(0.07, 0.07, 0.067) * mix(0.92, 1.05, bigS), tcConcSet(sq2, bigS, 0.5), smoothstep(0.05, 1.0, cure + (bigS - 0.5) * 0.2)) * (0.97 + 0.06 * grain) * (1.0 - 0.12 * joint);
            cc = mix(cc, face, cside);
          }
          diffuseColor.rgb *= cc * vColor;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // the top as poured: lumps and the stones of the aggregate standing out of the paste;
          // worked (vibrator, rule, trowel) — finer, then almost flat (as the foundation)
          float up = smoothstep(0.35, 0.7, normalize(vCWNrm).y);
          if (up > 0.001) {
            float rough = pow(1.0 - vSm, 1.5);
            vec2 cq = vCWPos.xz * (55.0 * ${RESCALE.toFixed(5)});
            float e = 0.3;
            #define TCFB(p) (tcSNoise(p) * 0.5 + tcSNoise((p) * 2.13 + 5.0) * 0.3 + tcSNoise((p) * 4.7 + 9.0) * 0.2)
            float f0 = TCFB(cq), fx = TCFB(cq + vec2(e, 0.0)), fz = TCFB(cq + vec2(0.0, e));
            vec2 sq = vCWPos.xz * ${RESCALE.toFixed(5)};
            vec3 st = tcStones(sq * 240.0), st2 = tcStones(sq * 115.0 + 17.0);
            float sink = 0.45 + 0.5 * vSm;
            float w1 = smoothstep(sink - 0.1, sink + 0.25, st.x) * step(0.45, tcHash(floor(sq * 240.0)));
            float w2 = smoothstep(sink - 0.05, sink + 0.3, st2.x) * step(0.55, tcHash(floor(sq * 115.0 + 17.0)));
            // and the fine grit of the surface (the paste, the sand in it) — gone only under the trowel, as on the foundation
            vec2 rq = vCWPos.xz * (700.0 * ${RESCALE.toFixed(5)});
            float r0 = tcSNoise(rq), rx = tcSNoise(rq + vec2(0.4, 0.0)), rz = tcSNoise(rq + vec2(0.0, 0.4));
            vec3 g = vec3(f0 - fx, 0.0, f0 - fz) * rough * 1.6 - vec3(st.y, 0.0, st.z) * w1 * 0.12 - vec3(st2.y, 0.0, st2.z) * w2 * 0.06
                   + vec3(r0 - rx, 0.0, r0 - rz) * (1.0 - 0.85 * vSm) * 0.25;
            normal = normalize(normal + (viewMatrix * vec4(g, 0.0)).xyz * up);
          }
          // the sides: the fine grit of the cast face (as the top, a little smoother)
          float sd = 1.0 - up;
          if (sd > 0.001) {
            vec3 wn = normalize(vCWNrm), ta = abs(wn.x) > abs(wn.z) ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
            vec2 rq = vec2(dot(vCWPos, ta), vCWPos.y) * (700.0 * ${RESCALE.toFixed(5)});
            float r0 = tcSNoise(rq), ra = tcSNoise(rq + vec2(0.4, 0.0)), rb = tcSNoise(rq + vec2(0.0, 0.4));
            vec3 g = (ta * (r0 - ra) + vec3(0.0, 1.0, 0.0) * (r0 - rb)) * 0.16;
            normal = normalize(normal + (viewMatrix * vec4(g, 0.0)).xyz * sd);
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(0.8, 0.32, vSm), mix(0.9, 0.72, vSm), smoothstep(0.1, 0.8, cure));   // (as the foundation)`);
  };
  m.customProgramCacheKey = () => 'tc-cast-concrete' + (steel ? '-steel' : '');
  return m;
}
