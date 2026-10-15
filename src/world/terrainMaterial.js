import * as THREE from 'three';
import { TRAY, LOAM_TILE } from '../config.js';
import { STOCHASTIC_GLSL, stochasticChunks } from '../render/stochastic.js';
import { innerCorner } from './plotShape.js';

// Topsoil photo texture on undisturbed ground, triplanar "excavated soil wall"
// texture on cut faces, crumbly dark loose soil on spoil, a lime chalk line for
// the setting-out and an optional levelling overlay (нивелир).
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
  const uniforms = {
    tWall: { value: tex.wall.diff },
    tLoam: { value: tex.loam.diff },
    uLoamScale: { value: 1 / LOAM_TILE },
    tFloor: { value: tex.ply.diff },
    uWallScale: { value: 1 / 0.16 },
    uLooseScale: { value: 1 / 0.07 },
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
  };
  mat.userData.uniforms = uniforms;
  const ch = stochasticChunks();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSoil;
        varying vec3 vSoil;
        varying vec3 vWPos;
        varying vec3 vWNrm;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vSoil = aSoil;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tWall, tLoam;
        uniform float uLoamScale;
        uniform sampler2D tFloor;
        uniform float uWallScale, uLooseScale, uFloorY, uChalk, uLevel, uSoilY, uTime, uLayer;
        uniform sampler2D tMask;
        uniform vec4 uPlot;
        uniform vec4 uCorner;
        uniform vec2 uCornerSign;
        varying vec3 vSoil;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float tcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        ${STOCHASTIC_GLSL}`)
      .replace('#include <map_fragment>', `
        tcStochSetup(vMapUv);
        vec3 wn = normalize(vWNrm);
        float steepF = smoothstep(0.25, 0.75, 1.0 - wn.y);
        vec4 topC = tcStoch(map, vMapUv);
        // large patches: drier / damper / more clayey ground, so the plot never looks stamped
        {
          float m1 = tcFbm(vWPos.xz * 2.6), m2 = tcFbm(vWPos.xz * 0.8 + 11.0), m3 = tcFbm(vWPos.xz * 9.0 + 5.0);
          topC.rgb *= mix(0.88, 1.08, m1) * mix(0.93, 1.05, m3);
          topC.rgb = mix(topC.rgb, topC.rgb * vec3(1.08, 0.97, 0.86), smoothstep(0.45, 0.75, m2));        // warmer clay
          topC.rgb = mix(topC.rgb, vec3(dot(topC.rgb, vec3(0.33))) * vec3(0.98, 0.96, 0.93), smoothstep(0.55, 0.8, 1.0 - m2) * 0.2); // dusty grey
          // patches of darker loam (trodden, damper ground)
          vec3 sec = tcStoch(tLoam, vWPos.xz * uLoamScale).rgb;
          topC.rgb = mix(topC.rgb, sec, smoothstep(0.55, 0.8, tcFbm(vWPos.xz * 1.7 + 23.0)) * 0.3);
        }
        vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 wallC = texture2D(tWall, vWPos.zy * uWallScale).rgb * bw.x
                   + texture2D(tWall, vWPos.xz * uWallScale).rgb * bw.y
                   + texture2D(tWall, vWPos.xy * uWallScale).rgb * bw.z;
        vec3 looseC = texture2D(tWall, vWPos.xz * uLooseScale + 0.37).rgb;
        looseC = mix(looseC, texture2D(map, vWPos.xz * 7.3 + 0.21).rgb, 0.45) * vec3(0.66, 0.58, 0.5); // freshly turned spoil: dark and crumbly
        float dig = smoothstep(0.0003, 0.0022, vSoil.x);
        float lse = smoothstep(0.00015, 0.0015, vSoil.y);
        wallC = mix(vec3(dot(wallC, vec3(0.3333))), wallC, 0.75);           // a bit less saturated
        wallC = mix(textureLod(tWall, vec2(0.5), 12.0).rgb, wallC, 0.55);    // softer spade marks
        vec3 soilC = mix(topC.rgb, wallC * vec3(0.78, 0.70, 0.62), dig);
        // fresh cuts are moist: clearly darker than the sun-dried crust …
        soilC *= mix(1.0, 0.72, dig);
        // … and the ground is layered: every pass of the shovel deeper opens a
        // slightly darker, a little differently tinted layer (wavy boundaries)
        {
          float below = max(0.0, uSoilY - vWPos.y);
          float wob = (tcNoise(vWPos.xz * 55.0 + vWPos.y * 30.0) - 0.5) * uLayer * 0.35;
          float layer = floor((below + wob) / uLayer);
          float f = fract((below + wob) / uLayer);
          vec3 tint = mod(layer, 2.0) < 0.5 ? vec3(1.06, 1.0, 0.9) : vec3(0.93, 0.95, 1.02);
          vec3 strata = pow(vec3(0.85, 0.83, 0.8), vec3(layer)) * tint;
          // a thin darker seam where one layer meets the next
          strata *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.1, f)) * step(0.5, layer);
          soilC *= mix(vec3(1.0), strata, dig);
        }
        soilC = mix(soilC, looseC, lse);
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
          vec3 tint = dy > 0.001 ? vec3(1.0, 0.45, 0.12) : (dy < -0.001 ? vec3(0.2, 0.45, 1.0) : vec3(0.25, 1.0, 0.35));
          float f = fract(vWPos.y / 0.002);
          float iso = 1.0 - smoothstep(0.0, 0.08, min(f, 1.0 - f));
          soilC = mix(soilC, tint * 0.6, 0.35);
          soilC = mix(soilC, tint, iso * 0.6);
        }
        diffuseColor.rgb *= soilC;
      `)
      .replace('#include <normal_fragment_maps>', `${ch.normal}
        normal = normalize(mix(normal, normalize(vNormal) * faceDirection, max(steepF * 0.8, smoothstep(0.0, 0.0012, vSoil.y) * 0.45)));`)
      .replace('#include <aomap_fragment>', ch.ao)
      // the soil ends at the rounded corner of the tray (cut at the very end, after
      // every texture lookup: Apple GPUs dislike derivatives after a discard)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          vec2 dc = (vWPos.xz - uCorner.xy) * uCornerSign;
          if (dc.x > 0.0 && dc.y > 0.0 && length(dc) > uCorner.z) discard;
        }`)
      .replace('#include <roughnessmap_fragment>', `${ch.rough}
        roughnessFactor = mix(max(roughnessFactor, 0.94), 0.82, smoothstep(0.003, 0.02, vSoil.x)); // dry earth has no sheen`);
  };
  mat.customProgramCacheKey = () => 'tc-terrain-6';
  return mat;
}

// Plain fallback (no custom shader) in case a device cannot compile the soil
// shader: sand photo, normal map and roughness, nothing else.
export function makeFallbackTerrainMaterial(tex) {
  return new THREE.MeshStandardMaterial({ map: tex.top.diff, normalMap: tex.top.nor, roughnessMap: tex.top.arm, roughness: 1, metalness: 0 });
}
