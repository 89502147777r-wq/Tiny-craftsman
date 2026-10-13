import * as THREE from 'three';

// Scene → HDR target (MSAA + depth) → single-pass macro bokeh (scatter-as-gather
// with circle-of-confusion from depth) → filmic tone mapping, vignette, grain.
export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.quality = 'high';
    this.dofAmount = 1;
    this.focus = 0.35;
    this.target = null;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

    this.cocMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uNear: { value: 0.01 }, uFar: { value: 10 },
        uFocus: { value: 0.35 }, uCocScale: { value: 10 }, uMaxCoc: { value: 14 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tColor, tDepth;
        uniform float uNear, uFar, uFocus, uCocScale, uMaxCoc;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          float d = texture2D(tDepth, vUv).x;
          float z = -perspectiveDepthToViewZ(d, uNear, uFar);
          if (d >= 1.0) z = 1e4;
          // thin-lens circle of confusion in pixels, signed (- in front of focus)
          float coc = (1.0 / uFocus - 1.0 / z) * uCocScale;
          coc = clamp(coc, -uMaxCoc, uMaxCoc);
          gl_FragColor = vec4(c, coc);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.dofMat = new THREE.ShaderMaterial({
      defines: { RAD_SCALE: '2.0' },
      uniforms: {
        tCoc: { value: null }, uPixel: { value: new THREE.Vector2() }, uMaxCoc: { value: 14 },
        uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.035 }, uEnabled: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tCoc;
        uniform vec2 uPixel;
        uniform float uMaxCoc, uTime, uVignette, uGrain, uEnabled;
        varying vec2 vUv;
        const float GOLDEN = 2.39996323;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec4 c0 = texture2D(tCoc, vUv);
          vec3 color = c0.rgb;
          if (uEnabled > 0.5) {
            float centerSize = abs(c0.a);
            float tot = 1.0;
            float radius = RAD_SCALE;
            float ang = hash(vUv * 917.0 + uTime) * 6.2831;
            for (int i = 0; i < 200; i++) {
              if (radius >= uMaxCoc) break;
              vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uPixel * radius;
              vec4 s = texture2D(tCoc, tc);
              float sampleSize = abs(s.a);
              // background must not bleed over a sharper foreground
              if (s.a > c0.a) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
              float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
              color += mix(color / tot, s.rgb, m);
              tot += 1.0;
              radius += RAD_SCALE / radius;
              ang += GOLDEN;
            }
            color /= tot;
          }
          // lens vignette + sensor grain
          vec2 q = vUv - 0.5;
          float v = 1.0 - uVignette * smoothstep(0.15, 0.85, dot(q, q) * 2.2);
          color *= v;
          float g = hash(vUv * 1013.0 + fract(uTime * 7.31)) - 0.5;
          color += color * g * uGrain;
          gl_FragColor = vec4(max(color, 0.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.dofMat.toneMapped = true;

    this.quad = new THREE.Mesh(tri, this.cocMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.size = new THREE.Vector2();
  }

  setQuality(q) {
    this.quality = q;
    const rs = q === 'high' ? '2.0' : q === 'medium' ? '3.2' : '5.0';
    this.dofMat.defines.RAD_SCALE = rs;
    this.dofMat.needsUpdate = true;
    this._alloc(true);
  }

  _alloc(force) {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = this.size.x, h = this.size.y;
    if (!force && this.target && this.target.width === w && this.target.height === h) return;
    this.target?.dispose(); this.cocTarget?.dispose();
    const samples = this.quality === 'low' ? 0 : 4;
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, samples,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    this.cocTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.dofMat.uniforms.uPixel.value.set(1 / w, 1 / h);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    this._alloc(false);
    r.setRenderTarget(this.target);
    r.render(scene, camera);

    const h = this.size.y;
    // CoC scale: proportional to aperture and image height, tuned for a macro look
    const cocScale = 0.0105 * h * this.dofAmount;
    const maxCoc = Math.min(22, 0.0115 * h) * Math.min(1, this.dofAmount * 1.4 + 0.05);
    const cu = this.cocMat.uniforms;
    cu.tColor.value = this.target.texture; cu.tDepth.value = this.target.depthTexture;
    cu.uNear.value = camera.near; cu.uFar.value = camera.far; cu.uFocus.value = this.focus;
    cu.uCocScale.value = cocScale; cu.uMaxCoc.value = maxCoc;
    this.quad.material = this.cocMat;
    r.setRenderTarget(this.cocTarget);
    r.render(this.quadScene, this.quadCam);

    const du = this.dofMat.uniforms;
    du.tCoc.value = this.cocTarget.texture; du.uMaxCoc.value = Math.max(1, maxCoc);
    du.uTime.value = time % 100; du.uEnabled.value = this.dofAmount > 0.01 ? 1 : 0;
    this.quad.material = this.dofMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
