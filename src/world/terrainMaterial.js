import * as THREE from 'three';
import { TRAY } from '../config.js';

// Topsoil photo texture on undisturbed ground, triplanar "excavated soil wall"
// texture on cut faces, crumbly dark loose soil on spoil, a lime chalk line for
// the setting-out and an optional levelling overlay (нивелир).
export function makeTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.top.diff,
    normalMap: tex.top.nor,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: tex.top.arm,
    aoMap: tex.top.arm,
    aoMapIntensity: 0.8,
    roughness: 1,
    metalness: 0,
  });
  const uniforms = {
    tWall: { value: tex.wall.diff },
    tFloor: { value: tex.ply.diff },
    uWallScale: { value: 1 / 0.16 },
    uLooseScale: { value: 1 / 0.07 },
    uFloorY: { value: TRAY.floor },
    uMark: { value: new THREE.Vector4(-0.075, -0.06, 0.075, 0.06) },
    uChalk: { value: 1 },
    uLevel: { value: 0 },
    uTargetY: { value: TRAY.soil - 0.015 },
    uTime: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
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
        uniform sampler2D tWall;
        uniform sampler2D tFloor;
        uniform float uWallScale, uLooseScale, uFloorY, uChalk, uLevel, uTargetY, uTime;
        uniform vec4 uMark;
        varying vec3 vSoil;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float tcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `
        vec3 wn = normalize(vWNrm);
        float steepF = smoothstep(0.25, 0.75, 1.0 - wn.y);
        vec4 topC = texture2D(map, vMapUv);
        vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 wallC = texture2D(tWall, vWPos.zy * uWallScale).rgb * bw.x
                   + texture2D(tWall, vWPos.xz * uWallScale).rgb * bw.y
                   + texture2D(tWall, vWPos.xy * uWallScale).rgb * bw.z;
        vec3 looseC = texture2D(tWall, vWPos.xz * uLooseScale + 0.37).rgb;
        looseC = mix(looseC, texture2D(map, vWPos.xz * 7.3 + 0.21).rgb, 0.45) * vec3(0.74, 0.68, 0.62);
        float dig = smoothstep(0.0003, 0.0022, vSoil.x);
        float lse = smoothstep(0.00015, 0.0015, vSoil.y);
        vec3 soilC = mix(topC.rgb, wallC * vec3(0.86, 0.80, 0.74), dig);
        // fresh cuts are moister, so darker the deeper you go
        soilC *= mix(1.0, 0.86, smoothstep(0.002, 0.02, vSoil.x));
        soilC = mix(soilC, looseC, lse);
        // the tray bottom shows through where everything has been dug out
        float bottom = (1.0 - smoothstep(uFloorY + 0.0002, uFloorY + 0.0009, vWPos.y)) * (1.0 - lse);
        soilC = mix(soilC, texture2D(tFloor, vWPos.xz * 4.0).rgb * 0.8, bottom);
        soilC *= 1.0 - 0.32 * vSoil.z;
        // setting-out rectangle: signed distance to its border
        vec2 q = vWPos.xz;
        vec2 cMin = uMark.xy, cMax = uMark.zw;
        vec2 dOut = max(cMin - q, q - cMax);
        float sd = length(max(dOut, 0.0)) + min(max(dOut.x, dOut.y), 0.0);
        float grain = tcHash(floor(q * 2400.0));
        float chalk = (1.0 - smoothstep(0.0004, 0.0009, abs(sd))) * (1.0 - dig) * (1.0 - lse) * step(0.25, grain);
        soilC = mix(soilC, vec3(0.80, 0.79, 0.74), chalk * uChalk * 0.9);
        // levelling overlay inside the pit outline
        if (uLevel > 0.5 && sd < 0.0) {
          float dy = vWPos.y - uTargetY;
          vec3 tint = dy > 0.001 ? vec3(1.0, 0.45, 0.12) : (dy < -0.001 ? vec3(0.2, 0.45, 1.0) : vec3(0.25, 1.0, 0.35));
          float f = fract(vWPos.y / 0.002);
          float iso = 1.0 - smoothstep(0.0, 0.08, min(f, 1.0 - f));
          soilC = mix(soilC, tint * 0.6, 0.35);
          soilC = mix(soilC, tint, iso * 0.6);
        }
        diffuseColor.rgb *= soilC;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal) * faceDirection, max(steepF * 0.8, smoothstep(0.0, 0.0012, vSoil.y) * 0.45)));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.82, smoothstep(0.003, 0.02, vSoil.x));`);
  };
  mat.customProgramCacheKey = () => 'tc-terrain-1';
  return mat;
}
