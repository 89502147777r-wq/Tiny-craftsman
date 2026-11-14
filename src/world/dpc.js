import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadModel } from './machines/models.js';

// The damp-proof course under the first course of masonry (the owner: «a roll, rolled out as it really is, English print,
// a good texture»): an SBS torch-on membrane, 3 mm, film both sides — a strip cut to the wall's length and width (+ 100) is
// torched down on the foundation: the torch at the nip between the roll and the concrete, the roll pushed on; it sticks, a
// glossy wave of molten bitumen in front of the roll, the bitumen pressed out a little at the edges (the sign it is fused right).
// The realist's review (2026-11-14), all but the worker, the primer and the dry run (the owner):
// - the propane flame by day: a sharp blue core at the cup, a nearly clear plume; orange sooty tongues and blue-grey smoke only
//   where the bitumen burns, at the nip; the cup heat-tinted, slotted; a lever, a wire stand — put down on it when done;
// - the bottle on the ground 3–5 m off, a reducer with a gauge; the hose lies on the ground in loose loops;
// - the roll is the strip's own length (it thins to nothing), the end dark with its turns, a core; outside the roll — the
//   underside with the burn-off indicator; on the laid strip — the top film, the print in one colour, half clear;
// - the strip follows the concrete; a strip over another (the lap 100, a corner) lies on it only where it is over it, a ramp
//   between; the beads uneven — drops, gaps; glossy hot, satin when cool;
// - the pace by the width: the same area a second (v · w = 0,06 m²/s).
// Records { type: 'dpc', a: [x, z], b: [x, z], y, w (mm) } — strips side by side lapped 100 when wider than the roll (1 m).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const DPC = { t: 3, roll: 1000, lap: 100, endLap: 150, len: 10000, core: 22, area: 60000, bead: 7, widths: [400, 480, 1300] };
export const dpcSpeed = (w) => DPC.area / Math.min(DPC.roll, w);   // mm/s

// the strips of a record: [{ off (mm across from the axis), w (mm) }], laid one after another
export function dpcStrips(r) {
  const W = r.w || 400;
  if (W <= DPC.roll) return [{ off: 0, w: W }];
  const n = Math.ceil((W - DPC.lap) / (DPC.roll - DPC.lap)), w = (W + (n - 1) * DPC.lap) / n, out = [];
  for (let i = 0; i < n; i++) out.push({ off: -W / 2 + w / 2 + i * (w - DPC.lap), w });
  return out;
}
export const dpcLen = (r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) / S;   // mm
// the roll's radius with L mm still on it (the turns 3 mm on a core of 22)
export const rollR = (L) => Math.sqrt(DPC.core ** 2 + Math.max(0, L) * DPC.t / Math.PI);
// how far the roll has turned when s of L is off it (the sum of ds/R as R thins: no sliding of its print)
const rollTurn = (L, s) => 2 * Math.PI * (rollR(L) - rollR(L - s)) / DPC.t;

// ---- textures ------------------------------------------------------------------------------------------------------------
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
function normalFrom(hc, k) {
  const W = hc.width, H = hc.height, hd = hc.getContext('2d').getImageData(0, 0, W, H).data, nc = cv(W, H), ng = nc.getContext('2d'), out = ng.createImageData(W, H);
  const at = (x, y) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k, i = (y * W + x) * 4, l = Math.hypot(dx, dy, 1);
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  ng.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(nc); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
// the film: graphite-black polyethylene, a fine embossed knurl, soft wrinkles from the roll. u: along (2 m a tile, 1024 px a
// metre), v: across (1 m — the roll's width)
function filmBase(W, H, g, h) {
  g.fillStyle = '#18181a'; g.fillRect(0, 0, W, H); h.fillStyle = '#808080'; h.fillRect(0, 0, W / 2, H / 2);
  const k = 6;
  for (let y = 0; y < H; y += k) for (let x = (y / k) % 2 ? k / 2 : 0; x < W; x += k) {
    g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(x, y, k / 2, k / 2);
    if (x % 2 === 0 && y % 2 === 0) { h.fillStyle = 'rgba(255,255,255,0.2)'; h.fillRect(x / 2, y / 2, 1.5, 1.5); h.fillStyle = 'rgba(0,0,0,0.2)'; h.fillRect(x / 2 + 1.5, y / 2 + 1.5, 1.5, 1.5); }
  }
  for (let i = 0; i < 80; i++) {
    const y = rnd() * H, x = rnd() * W, L = 150 + rnd() * 500, a = (rnd() - 0.5) * 0.25;
    h.strokeStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},0.09)`; h.lineWidth = 2 + rnd() * 3;
    h.beginPath(); h.moveTo(x / 2, y / 2); h.lineTo((x + Math.cos(a) * L) / 2, (y + Math.sin(a) * L) / 2); h.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.025)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
}
let _top = null, _under = null;
// the top film (seen on the laid strip): the maker's print in one colour, half clear, 20–35 mm letters every metre, worn here
// and there; spots where the film shrank in the heat near the edges (glossy, a little darker)
export function topTex() {
  if (_top) return _top;
  const W = 2048, H = 1024, c = cv(W, H), g = c.getContext('2d'), hc = cv(W / 2, H / 2), h = hc.getContext('2d');
  filmBase(W, H, g, h);
  const pc = cv(W, H), p = pc.getContext('2d');
  p.textBaseline = 'middle'; p.fillStyle = 'rgba(70,120,210,0.6)';
  for (const [y, x0] of [[H * 0.34, 60], [H * 0.66, 572]]) for (let x = x0; x < W; x += 1024) {
    p.font = 'bold 34px Arial, Helvetica, sans-serif'; p.fillText('SBS TORCH-ON MEMBRANE', x, y - 22);
    p.font = '24px Arial, Helvetica, sans-serif'; p.fillText('DAMP-PROOF COURSE · 3.0 mm · APPLY WITH TORCH · LAP 100 mm', x + 2, y + 14);
  }
  // (worn: little scuffs through the print)
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1400; i++) { p.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.6})`; p.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 7, 1 + rnd() * 2); }
  g.drawImage(pc, 0, 0);
  // the shrink spots of the film at both edges (30–80 mm)
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() > 0.5 ? rnd() * 90 : H - rnd() * 90, r = 15 + rnd() * 25;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.6); gr.addColorStop(0, 'rgba(5,5,6,0.9)'); gr.addColorStop(1, 'rgba(5,5,6,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2); g.fill();
    h.fillStyle = 'rgba(128,128,128,0.8)'; h.beginPath(); h.ellipse(x / 2, y / 2, r * 0.8, r / 2, 0, 0, Math.PI * 2); h.fill();
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.ClampToEdgeWrapping; map.anisotropy = 8;
  return (_top = { map, nor: normalFrom(hc, 2.2) });
}
// the underside (the outside of the roll): the burn-off film with its indicator — small grey diamonds every 25 mm that shrink
// when the film is burnt off
export function underTex() {
  if (_under) return _under;
  const W = 2048, H = 1024, c = cv(W, H), g = c.getContext('2d'), hc = cv(W / 2, H / 2), h = hc.getContext('2d');
  filmBase(W, H, g, h);
  g.strokeStyle = 'rgba(165,168,170,0.5)'; g.lineWidth = 1.6;
  for (let y = 14; y < H; y += 26) for (let x = ((y / 26) % 2) * 13 + 6; x < W; x += 26) { g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.stroke(); }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  return (_under = { map, nor: normalFrom(hc, 2.2) });
}
// the roll's end: nearly black, the turns' thin lines (film and the polyester core of each) — as many as there are turns
const _ends = new Map();
function endMat(turns) {
  const n = Math.max(1, Math.round(turns)); if (_ends.has(n)) return _ends.get(n);
  const N = 512, c = cv(N, N), g = c.getContext('2d');
  g.fillStyle = '#0d0d0e'; g.fillRect(0, 0, N, N);
  // (RingGeometry's uv: the plane's — the ring from r0 to R maps to [ri, 0,5] of the picture)
  const ri = 0.5 * DPC.core / (DPC.core + n * DPC.t);
  g.strokeStyle = 'rgba(150,150,145,0.16)'; g.lineWidth = Math.max(0.8, (0.5 - ri) * N / n * 0.18); g.beginPath();
  for (let t = 0; t <= n * Math.PI * 2; t += 0.03) { const r = (ri + (0.5 - ri) * t / (n * Math.PI * 2)) * N; g.lineTo(N / 2 + Math.cos(t) * r, N / 2 + Math.sin(t) * r); }
  g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }); _ends.set(n, m); return m;
}
// the torch's cup: stainless, heat-tinted toward the mouth (straw → brown → blue), sooty inside; air slots near its neck
let _cup = null;
function cupTex() {
  if (_cup) return _cup;
  const W = 256, H = 256, c = cv(W, H), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H);   // (v: 0 at the mouth → 1 at the neck)
  gr.addColorStop(0, '#26221f'); gr.addColorStop(0.18, '#3d3a44'); gr.addColorStop(0.35, '#4f4660'); gr.addColorStop(0.55, '#7a6448'); gr.addColorStop(0.75, '#a49a86'); gr.addColorStop(1, '#a9abad');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '0,0,0' : '255,255,255'},${0.04 + rnd() * 0.06})`; g.fillRect(rnd() * W, rnd() * H, 2, 1); }
  for (let k = 0; k < 6; k++) { g.fillStyle = '#060606'; g.fillRect(k * W / 6 + 12, H * 0.78, 18, H * 0.12); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return (_cup = t);
}
const mats = {};
const mat = (k, f) => mats[k] || (mats[k] = f());
const M = {
  top: () => mat('top', () => { const T = topTex(); return new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.nor, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.42 }); }),
  under: () => mat('under', () => { const T = underTex(); return new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.nor, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.45 }); }),
  edge: () => mat('edge', () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.55 })),
  // the molten bitumen pressed out: black, wet glossy while hot; satin cooled
  hot: () => mat('hot', () => new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.12 })),
  cool: () => mat('cool', () => new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.36 })),
  melt: () => mat('melt', () => new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.06, emissive: 0x1a0700, emissiveIntensity: 1 })),
  core: () => mat('core', () => new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.9, side: THREE.DoubleSide })),
  cup: () => mat('cup', () => new THREE.MeshStandardMaterial({ map: cupTex(), roughness: 0.62, metalness: 0.55, side: THREE.DoubleSide })),
  steel: () => mat('steel', () => new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.4, metalness: 0.8 })),
  wire: () => mat('wire', () => new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.6 })),
  brass: () => mat('brass', () => new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.38, metalness: 0.85 })),
  grip: () => mat('grip', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85 })),
  red: () => mat('red', () => new THREE.MeshStandardMaterial({ color: 0xa3261c, roughness: 0.6 })),
  dial: () => mat('dial', () => new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.4 })),
  hose: () => mat('hose', () => new THREE.MeshStandardMaterial({ color: 0xc8541e, roughness: 0.75 })),
};

// ---- the flame: shaders ---------------------------------------------------------------------------------------------------
const NOISE = /* glsl */ `
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
  float fbm(vec3 p) { return n3(p) * 0.55 + n3(p * 2.1 + 3.1) * 0.3 + n3(p * 4.3 + 7.7) * 0.15; }
`;
const uTime = { value: 0 };
// the jet: along the cone (uv.y: 1 at the cup → 0 at its tip), soft at its silhouette (the view-facing normal), noise running
// down it — the blue core: sharp, dense; the plume: nearly clear, a little blue
function jetMat(core) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying float vA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() { vA = uv.y; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying float vA; varying vec3 vN; varying vec3 vV; varying vec3 vP; ${NOISE}
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), ${core ? '0.9' : '1.6'});
        float n = fbm(vec3(vP.yz * 400.0, vA * 6.0 + uTime * ${core ? '9.0' : '14.0'}));
        float a = ${core ? 'smoothstep(0.0, 0.35, vA) * (0.75 + 0.25 * n)' : 'pow(vA, 1.4) * (0.35 + 0.65 * n)'} * edge;
        vec3 c = ${core ? 'mix(vec3(0.25, 0.45, 1.0), vec3(0.75, 0.85, 1.0), smoothstep(0.6, 1.0, vA))' : 'mix(vec3(0.35, 0.3, 0.9), vec3(0.45, 0.65, 1.0), vA)'};
        gl_FragColor = vec4(c * a * ${core ? '1.4' : '0.5'}, 1.0);
      }`,
  });
}
// the burning at the nip: tongues licking up from a line across the strip (a quad: x across, y up), orange to yellow, the tips
// sooty; flickering 8–15 times a second
function tongueMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime, uSeed: { value: Math.random() * 10 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uSeed; varying vec2 vU; ${NOISE}
      void main() {
        float x = vU.x, y = vU.y;
        float side = smoothstep(0.0, 0.12, x) * smoothstep(1.0, 0.88, x);
        float n = fbm(vec3(x * 9.0 + uSeed, y * 3.0 - uTime * 6.0, uTime * 2.3 + uSeed));
        float hgt = 0.25 + 0.75 * fbm(vec3(x * 6.0 + uSeed, uTime * 11.0, 1.0));
        float body = smoothstep(hgt, hgt * 0.35, y) * side;
        float a = body * (0.45 + 0.55 * n);
        vec3 c = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.85, 0.35), smoothstep(0.5, 0.0, y)) * mix(1.0, 0.35, smoothstep(0.4, 0.95, y / max(hgt, 0.01)));
        gl_FragColor = vec4(c * a * 0.9, 1.0);
      }`,
  });
}
// blue-grey bitumen smoke: a soft puff
let _puff = null;
function puffTex() {
  if (_puff) return _puff;
  const N = 128, c = cv(N, N), g = c.getContext('2d');
  for (let i = 0; i < 14; i++) { const x = N / 2 + (rnd() - 0.5) * N * 0.35, y = N / 2 + (rnd() - 0.5) * N * 0.35, r = N * (0.18 + rnd() * 0.2); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, N, N); }
  return (_puff = new THREE.CanvasTexture(c));
}
let _puffMat = null;
const puffMat = () => _puffMat || (_puffMat = new THREE.SpriteMaterial({ map: puffTex(), color: 0x8c919c, transparent: true, depthWrite: false, opacity: 0.2 }));

// ---- the torch: a roofer's propane torch — the cup with its air slots, the tube bent near it, the valve, the lever under the
// grip, the hose nipple, a wire stand under the tube. Built along +x (the cup's mouth at 0, facing −x)
function torch() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const cup = new THREE.Mesh(new THREE.LatheGeometry([[29, 0], [29.5, 6], [27, 40], [24, 85], [20, 105], [11, 118], [9, 130]].map(([r, y]) => new THREE.Vector2(MM(r), MM(y))), 28), M.cup());
  cup.rotation.z = -Math.PI / 2; body.add(cup);   // (its axis along +x, the mouth at 0)
  const tubeC = new THREE.CatmullRomCurve3([[130, 0], [220, 4], [320, 22], [600, 52], [1000, 70]].map(([x, y]) => new THREE.Vector3(MM(x), MM(y), 0)));
  body.add(new THREE.Mesh(new THREE.TubeGeometry(tubeC, 30, MM(8.5), 10, false), M.steel()));
  const end = tubeC.getPoint(1), dir = tubeC.getTangent(1), ang = Math.atan2(dir.y, dir.x);
  const tail = new THREE.Group(); tail.position.copy(end); tail.rotation.z = ang; body.add(tail);
  const cyl = (r, l, m, x, seg = 14) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(MM(r), MM(r), MM(l), seg), m); o.rotation.z = -Math.PI / 2; o.position.x = MM(x); tail.add(o); return o; };
  cyl(13, 70, M.brass(), 35); cyl(16, 22, M.brass(), 80);   // (the valve body, its nut)
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(MM(17), MM(17), MM(12), 16), M.red()); knob.position.set(MM(40), MM(26), 0); tail.add(knob);
  cyl(17, 170, M.grip(), 180); cyl(7, 40, M.brass(), 285);   // (the grip, the hose nipple)
  // the lever: a bent rod under the grip, from the valve
  const lev = new THREE.CatmullRomCurve3([[70, -14], [110, -40], [200, -44], [250, -30]].map(([x, y]) => new THREE.Vector3(MM(x), MM(y), 0)));
  tail.add(new THREE.Mesh(new THREE.TubeGeometry(lev, 12, MM(3.5), 6, false), M.wire()));
  // the stand: a wire bow under the tube 370 from the cup — two legs to the ground when it is put down
  for (const sd of [-1, 1]) {
    const leg = new THREE.CatmullRomCurve3([[360, 30, 0], [370, 0, sd * 40], [375, -45, sd * 75]].map(([x, y, z]) => new THREE.Vector3(MM(x), MM(y), MM(z))));
    body.add(new THREE.Mesh(new THREE.TubeGeometry(leg, 8, MM(3), 6, false), M.wire()));
  }
  g.userData.hand = new THREE.Vector3(MM(305), 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), ang).add(end);   // (the hose's end at the nipple)
  // the flame: down −x from the mouth
  const flame = new THREE.Group(); flame.visible = false; body.add(flame);
  const coreG = new THREE.ConeGeometry(MM(17), MM(95), 18, 6, true); coreG.translate(0, -MM(95) / 2, 0); coreG.rotateZ(-Math.PI / 2);
  const plumeG = new THREE.CylinderGeometry(MM(26), MM(85), MM(420), 22, 8, true); plumeG.translate(0, -MM(420) / 2, 0); plumeG.rotateZ(-Math.PI / 2);
  const coreM = new THREE.Mesh(coreG, jetMat(true)), plume = new THREE.Mesh(plumeG, jetMat(false));
  coreM.position.x = plume.position.x = MM(6); flame.add(plume, coreM);
  g.userData.flame = flame; g.userData.plume = plume; g.userData.body = body;
  g.traverse((o) => { if (o.isMesh && o.material.type !== 'ShaderMaterial') o.castShadow = true; });
  return g;
}
// the reducer on the bottle's valve: a brass nut, a black body, the gauge's white face
function reducer() {
  const g = new THREE.Group();
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(MM(16), MM(16), MM(26), 6), M.brass()); nut.position.y = MM(13); g.add(nut);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(MM(32), MM(32), MM(36), 20), M.grip()); body.rotation.z = Math.PI / 2; body.position.set(MM(30), MM(40), 0); g.add(body);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(MM(24), MM(24), MM(8), 20), M.dial()); dial.rotation.x = Math.PI / 2; dial.position.set(MM(30), MM(62), MM(10)); g.add(dial);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(MM(24), MM(3), 6, 20), M.steel()); rim.position.set(MM(30), MM(62), MM(14)); g.add(rim);
  const outlet = new THREE.Mesh(new THREE.CylinderGeometry(MM(6), MM(6), MM(30), 8), M.brass()); outlet.rotation.z = Math.PI / 2; outlet.position.set(MM(62), MM(40), 0); g.add(outlet);
  g.userData.out = new THREE.Vector3(MM(78), MM(40), 0);
  return g;
}

// ---- the view -----------------------------------------------------------------------------------------------------------
// a strip's place: its start, its way along, across; L mm long, w wide, off across the record's axis
function stripFrame(r, st) {
  const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  return { x: r.a[0] - uz * MM(st.off), z: r.a[1] + ux * MM(st.off), ux, uz, nx: -uz, nz: ux, L: L / S, w: st.w };
}
// how much of a strip lies at a point (1 inside, a 25 mm ramp at its edges, 0 out)
function cover(F, x, z, s1 = F.L) {
  const ax = (x - F.x) / S, az = (z - F.z) / S, al = ax * F.ux + az * F.uz, ac = Math.abs(ax * F.nx + az * F.nz);
  return Math.max(0, Math.min(1, Math.min(al, s1 - al, F.w / 2 - ac) / 25 + 0.5));
}
export class DpcView {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'dpc'; app.scene.add(this.group);
    this.meshes = new Map(); this.dirty = true; this.anim = new Map();   // id → { k (strip), s (mm) } while it is laid
    this.cooled = new Map();   // id → the clock it was finished (hot beads → cool after 15 s)
    app.objects.on((id, rec) => { if (!rec || rec.type === 'dpc' || this.meshes.has(id)) this.dirty = true; });
    this.work = null; this._t = 0; this.smoke = []; this.rest = null;
  }
  frame(r) { const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz) || 1; return { x: r.a[0], z: r.a[1], y: r.y, ux: dx / L, uz: dz / L, L: L / S }; }
  // what is under a point: the concrete and the strips laid before (other records before this one; this one's earlier strips)
  _under(id, k, x, z) {
    let y = this.app.terrain.heightAt(x, z) + MM(0.4);
    for (const r of this.app.objects.all('dpc')) {
      if (r.id > id) continue;
      const A = this.anim.get(r.id), sts = dpcStrips(r);
      sts.forEach((st, j) => {
        if (r.id === id && j >= k) return;
        const s1 = A ? (j < A.k ? Infinity : j === A.k ? A.s : -1) : Infinity; if (s1 < 0) return;
        const F = stripFrame(r, st); y += MM(DPC.t) * cover(F, x, z, Math.min(F.L, s1));
      });
    }
    return y;
  }
  setAnim(id, a) {
    const o = this.anim.get(id);
    if (a && o && o.k === a.k && Math.abs(o.s - a.s) < 40) { o.live = a; return; }   // (the strip rebuilt every 40 mm; the roll and the torch every frame)
    if (a) { this.anim.set(id, { ...a, live: a }); } else { this.anim.delete(id); if (o) { this.cooled.set(id, this.app.clock ?? 0); this._rest(id); } }
    this._build(id);
  }
  // a strip laid to s: its top over what is under it (a grid every 50 mm), its sides, the beads
  _sheet(r, k, st, s, hot) {
    const F = stripFrame(r, st), g = new THREE.Group(), w = st.w;
    const na = Math.max(2, Math.ceil(s / 50) + 1), nc = Math.max(2, Math.ceil(w / 50) + 1), pos = [], uv = [], idx = [], P = (al, ac) => [F.x + MM(al) * F.ux + MM(ac) * F.nx, F.z + MM(al) * F.uz + MM(ac) * F.nz];
    const top = [];
    for (let i = 0; i < na; i++) { const al = s * i / (na - 1); top.push([]); for (let j = 0; j < nc; j++) { const ac = -w / 2 + w * j / (nc - 1), [x, z] = P(al, ac), y = this._under(r.id, k, x, z) + MM(DPC.t); top[i].push([x, y, z]); pos.push(x, y, z); uv.push(al / 2000, 1 - (ac + w / 2) / DPC.roll); } }
    for (let i = 0; i < na - 1; i++) for (let j = 0; j < nc - 1; j++) { const a = i * nc + j, b = a + nc; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const gt = new THREE.BufferGeometry(); gt.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gt.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gt.setIndex(idx); gt.computeVertexNormals();
    // (the normals up: the winding is the grid's — the top must face the sky)
    { const nr = gt.attributes.normal; let up = 0; for (let i = 0; i < nr.count; i++) up += nr.getY(i); if (up < 0) { for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; gt.setIndex(idx); gt.computeVertexNormals(); } }
    const mt = new THREE.Mesh(gt, M.top()); mt.receiveShadow = true; g.add(mt);
    // the sides: 3 mm down, all round
    const sp = [], si = [], ring = [...top.map((row) => row[0]), ...top[na - 1].slice(1), ...top.map((row) => row[nc - 1]).reverse().slice(1), ...top[0].slice(1, -1).reverse()];
    ring.push(ring[0]);
    ring.forEach(([x, y, z], i) => { sp.push(x, y, z, x, y - MM(DPC.t), z); if (i) { const a = (i - 1) * 2; si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const gs = new THREE.BufferGeometry(); gs.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); gs.setIndex(si); gs.computeVertexNormals();
    const ms = new THREE.Mesh(gs, M.edge()); ms.material.side = THREE.DoubleSide; g.add(ms);
    // the beads: along both edges (and the ends laid), on what is under them — uneven: drops, thin stretches, gaps
    const bead = (pts) => {
      const bp = [], bi = []; let ring0 = -1;
      const hash = (v) => { const q = Math.sin(v * 12.9898 + r.id * 78.233 + k * 3.1) * 43758.5453; return q - Math.floor(q); };
      pts.forEach(([x, z, t], i) => {
        const gap = hash(Math.floor(t / 90)) < 0.12, rr = DPC.bead / 2 * (0.5 + 1.5 * hash(t * 0.37 + 1.7) ** 1.6);
        if (gap) { ring0 = -1; return; }
        const y = this._under(r.id, k, x, z), base = bp.length / 3, i1 = Math.min(i + 1, pts.length - 1), i0 = Math.max(i - 1, 0), ex = pts[i1][0] - pts[i0][0], ez = pts[i1][1] - pts[i0][1], el = Math.hypot(ex, ez) || 1, nx = -ez / el, nz = ex / el;
        for (let q = 0; q <= 6; q++) { const a = Math.PI * q / 6; bp.push(x + nx * MM(rr) * Math.cos(a), y + MM(rr) * Math.sin(a) * 0.55, z + nz * MM(rr) * Math.cos(a)); }
        if (ring0 >= 0) for (let q = 0; q < 6; q++) bi.push(ring0 + q, base + q, ring0 + q + 1, ring0 + q + 1, base + q, base + q + 1);
        ring0 = base;
      });
      if (!bi.length) return;
      const gb = new THREE.BufferGeometry(); gb.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); gb.setIndex(bi); gb.computeVertexNormals();
      const mb = new THREE.Mesh(gb, hot ? M.hot() : M.cool()); mb.material.side = THREE.DoubleSide; g.add(mb);
    };
    for (const sd of [-1, 1]) { const pts = []; for (let al = 0; al <= s; al += 25) { const [x, z] = P(al, sd * (w / 2 + 2)); pts.push([x, z, al + (sd > 0 ? 50000 : 0)]); } bead(pts); }
    { const pts = []; for (let ac = -w / 2; ac <= w / 2; ac += 25) { const [x, z] = P(-2, ac); pts.push([x, z, ac + 90000]); } bead(pts); }
    if (s >= F.L - 1) { const pts = []; for (let ac = -w / 2; ac <= w / 2; ac += 25) { const [x, z] = P(s + 2, ac); pts.push([x, z, ac + 120000]); } bead(pts); }
    return g;
  }
  _build(id) {
    const r = this.app.objects.get(id), old = this.meshes.get(id);
    if (old) { this.group.remove(old); old.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); this.meshes.delete(id); }
    if (!r || r.type !== 'dpc') return;
    const g = new THREE.Group(), A = this.anim.get(id), L = dpcLen(r), hot = !!A || (this.app.clock ?? 0) - (this.cooled.get(id) ?? -1e9) < 15;
    dpcStrips(r).forEach((st, k) => {
      let s = !A ? L : k < A.k ? L : k === A.k ? A.s : 0;
      if (A && k === A.k && L - s < 250) s = L;   // (the last turns lie down by themselves)
      if (s > 1) g.add(this._sheet(r, k, st, s, hot));
    });
    this.group.add(g); this.meshes.set(id, g);
  }
  // the work round the strip being laid: the roll, the melt, the torch with its flame, the burning, the smoke, the bottle, the hose
  _work() {
    if (this.work) return this.work;
    const W = new THREE.Group(); W.name = 'dpc-work';
    const rollG = new THREE.Group(), spin = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), M.under());
    body.castShadow = true; spin.add(body); rollG.add(spin);
    const ends = [-1, 1].map((sd) => { const e = new THREE.Mesh(new THREE.RingGeometry(1, 2, 48), M.edge()); spin.add(e); e.userData.sd = sd; return e; });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(MM(DPC.core), MM(DPC.core), 1, 20, 1, true), M.core()); spin.add(core);
    W.add(rollG);
    const melt = new THREE.Mesh(new THREE.BufferGeometry(), M.melt()); W.add(melt);
    const T = torch(); W.add(T);
    const tongues = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tongueMat()); W.add(m); return m; });
    const bottle = new THREE.Group(), red = reducer(); bottle.add(red); red.position.y = MM(580);
    loadModel('site/gasbottle.glb').then(({ scene }) => { scene.scale.setScalar(1 / MODEL_SCALE); scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (o.material) o.material.metalness = 0; } }); bottle.add(scene); }).catch(() => {});
    W.add(bottle);
    const hose = new THREE.Mesh(new THREE.BufferGeometry(), M.hose()); hose.castShadow = true; W.add(hose);
    this.work = { W, rollG, spin, body, ends, core, melt, T, tongues, bottle, red, hose, hoseKey: '', endKey: '' };
    this.group.add(W);
    return this.work;
  }
  // the torch put down on its stand by the strip's end, the bottle where it stood — for a minute, then taken away
  _rest(id) { if (this.app.objects.get(id)) this.rest = { id, until: (this.app.clock ?? 0) + 60 }; }
  _bottleAt(F0) {
    // (on the ground 3,5 m off the strip's start, on the side toward the plot's middle, inside the plot)
    const T = this.app.terrain, sd = (F0.nx * -F0.x + F0.nz * -F0.z) >= 0 ? 1 : -1;
    let x = F0.x - F0.ux * MM(800) + sd * F0.nx * MM(3500), z = F0.z - F0.uz * MM(800) + sd * F0.nz * MM(3500);
    x = Math.max(-T.halfX * 0.97, Math.min(T.halfX * 0.97, x)); z = Math.max(-T.halfZ * 0.97, Math.min(T.halfZ * 0.97, z));
    return [x, T.heightAt(x, z), z];
  }
  _hose(Wk, from, to, ground) {
    // (from the reducer down to the ground, along it in loose loops, up into the torch's grip with a sag)
    const key = [from, to].map((v) => v.toArray().map((q) => Math.round(q / MM(20))).join(',')).join('|'); if (key === Wk.hoseKey) return; Wk.hoseKey = key;
    const dx = to.x - from.x, dz = to.z - from.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L, n = Math.max(4, Math.ceil(L / MM(350)));
    const pts = [from.clone(), new THREE.Vector3(from.x + dx / L * MM(150), ground(from.x + dx / L * MM(150), from.z + dz / L * MM(150)) + MM(9), from.z + dz / L * MM(150))];
    for (let i = 1; i < n; i++) { const t = i / n, sw = Math.sin(t * Math.PI * 2.2) * MM(450) * Math.sin(t * Math.PI), x = from.x + dx * t + nx * sw, z = from.z + dz * t + nz * sw; pts.push(new THREE.Vector3(x, ground(x, z) + MM(9), z)); }
    const near = new THREE.Vector3(to.x - dx / L * MM(450), 0, to.z - dz / L * MM(450)); near.y = ground(near.x, near.z) + MM(9); pts.push(near, to.clone());
    Wk.hose.geometry.dispose(); Wk.hose.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 6, MM(9), 8, false);
  }
  update(dt = 1 / 60) {
    if (this.dirty) {
      this.dirty = false;
      const seen = new Set(this.app.objects.all('dpc').map((r) => r.id));
      for (const id of [...this.meshes.keys()]) if (!seen.has(id)) this._build(id);
      for (const id of seen) if (!this.meshes.has(id)) this._build(id);
    }
    const now = this.app.clock ?? 0;
    for (const [id, t0] of this.cooled) if (now - t0 >= 15) { this.cooled.delete(id); this._build(id); }   // (cooled: the beads satin)
    this._t += dt; uTime.value = this._t;
    const [id, A] = [...this.anim.entries()][0] || [], r = id != null && this.app.objects.get(id);
    const restR = !r && this.rest && now < this.rest.until && this.app.objects.get(this.rest.id);
    if (!r && !restR) { if (this.work) this.work.W.visible = false; this._smoke(dt, null); return; }
    const Wk = this._work(); Wk.W.visible = true;
    const ground = (x, z) => this.app.terrain.heightAt(x, z);
    const R0 = r || restR, sts = dpcStrips(R0), L = dpcLen(R0);
    const live = r ? (A.live || A) : { k: sts.length - 1, s: L }, st = sts[live.k], F = stripFrame(R0, st), s = Math.min(live.s, L), working = !!r && L - s >= 250;
    const P = (al, ac) => [F.x + MM(al) * F.ux + MM(ac) * F.nx, F.z + MM(al) * F.uz + MM(ac) * F.nz];
    const yaw = Math.atan2(-F.uz, F.ux);
    // the roll: on what is under it at the touch, its axis across, turned by what has come off it
    Wk.rollG.visible = working; Wk.melt.visible = working;
    const Rm = rollR(L - s), R = MM(Rm);
    if (working) {
      const [cx, cz] = P(s, 0), y0 = this._under(R0.id, live.k, cx, cz);
      Wk.rollG.position.set(cx, y0 + R, cz); Wk.rollG.rotation.set(0, yaw, 0);
      Wk.spin.rotation.set(0, 0, -rollTurn(L, s));
      Wk.body.scale.set(R, MM(st.w), R); Wk.body.rotation.set(Math.PI / 2, 0, 0); Wk.core.scale.set(1, MM(st.w + 4), 1); Wk.core.rotation.set(Math.PI / 2, 0, 0);
      const ek = `${st.w}|${Math.round(Rm)}`;
      if (ek !== Wk.endKey) { Wk.endKey = ek; for (const e of Wk.ends) { e.geometry.dispose(); e.geometry = new THREE.RingGeometry(MM(DPC.core), R, 48); e.material = endMat((Rm - DPC.core) / DPC.t); e.position.set(0, 0, e.userData.sd * MM(st.w) / 2); e.rotation.set(0, e.userData.sd > 0 ? 0 : Math.PI, 0); } }
      // the melt: a glossy black wave 12–24 mm in front of the roll's touch, all across, its front ragged
      const mp = [], mi = [], nc = Math.ceil(st.w / 20) + 1;
      for (let j = 0; j < nc; j++) { const ac = -st.w / 2 + st.w * j / (nc - 1), fr = 12 + 12 * Math.abs(Math.sin(j * 2.7 + Math.floor(this._t * 3))); for (const al of [s - 4, s + fr]) { const [x, z] = P(al, ac); mp.push(x, this._under(R0.id, live.k, x, z) + MM(1.6), z); } if (j) { const a = (j - 1) * 2; mi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
      Wk.melt.geometry.dispose(); const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3)); gm.setIndex(mi); gm.computeVertexNormals(); Wk.melt.geometry = gm; Wk.melt.material.side = THREE.DoubleSide;
    }
    // the torch: its cup 230 ahead of the roll's touch, 150 up, the jet 30° down into the nip, swung across ±(w − 100)/2 (≤ 150)
    // 1,5 times a second; done — on its stand by the strip's end, out
    const T0 = Wk.T;
    if (working) {
      const A0 = Math.min(150, (st.w - 100) / 2), sw = A0 * Math.sin(this._t * Math.PI * 2 * 1.5), [tx, tz] = P(s + Rm + 230, sw), y = this._under(R0.id, live.k, tx, tz) + MM(150);
      T0.position.set(tx, y, tz); T0.rotation.set(0, yaw, 0.52 - 0.06 * Math.sin(this._t * 4.1)); T0.userData.flame.visible = true;
      const fl = 1 + 0.12 * Math.sin(this._t * 23) + 0.06 * Math.sin(this._t * 37); T0.userData.plume.scale.set(fl, 1, 1);
    } else {
      const [tx, tz] = P(L + 250, st.w / 2 + 450); T0.position.set(tx, ground(tx, tz) + MM(46), tz); T0.rotation.set(0, yaw + 0.5, -0.035); T0.userData.flame.visible = false;
    }
    // the burning at the nip: three tongues across, 70–120 mm high, over 0,6–0,8 of the width
    Wk.tongues.forEach((m, i) => {
      m.visible = working; if (!working) return;
      const [x, z] = P(s + 15 + i * 9, (i - 1) * st.w * 0.08), y = this._under(R0.id, live.k, x, z);
      const hgt = MM(70 + 50 * Math.abs(Math.sin(this._t * (8 + i * 3.3) + i)));
      m.position.set(x, y + hgt / 2 + MM(3), z); m.rotation.set(0, yaw + Math.PI / 2 + (i - 1) * 0.12, 0); m.scale.set(MM(st.w * (0.6 + 0.1 * i)), hgt, 1);
    });
    // the bottle and its hose
    const [bx, by, bz] = this._bottleAt(stripFrame(R0, sts[0]));
    Wk.bottle.position.set(bx, by, bz); Wk.bottle.rotation.y = yaw;
    this.group.updateMatrixWorld(true);
    const hand = T0.userData.hand.clone(); T0.userData.body.localToWorld(hand); this.group.worldToLocal(hand);
    const out = Wk.red.userData.out.clone(); Wk.red.localToWorld(out); this.group.worldToLocal(out);
    this._hose(Wk, out, hand, ground);
    // the smoke where the bitumen burns
    this._smoke(dt, working ? (() => { const [x, z] = P(s + 20, 0); return new THREE.Vector3(x, this._under(R0.id, live.k, x, z) + MM(60), z); })() : null, st.w);
  }
  _smoke(dt, at, w = 400) {
    if (at) { this._puffT = (this._puffT || 0) + dt; while (this._puffT > 0.33) { this._puffT -= 0.33; const sp = new THREE.Sprite(puffMat().clone()); sp.position.copy(at); sp.position.x += MM((Math.random() - 0.5) * w * 0.6); sp.userData = { age: 0, life: 2 + Math.random(), vx: MM(60) * (Math.random() - 0.5), vz: MM(60) * (Math.random() - 0.5) }; this.group.add(sp); this.smoke.push(sp); } }
    for (const sp of [...this.smoke]) {
      const u = sp.userData; u.age += dt; const t = u.age / u.life;
      if (t >= 1) { this.group.remove(sp); sp.material.dispose(); this.smoke.splice(this.smoke.indexOf(sp), 1); continue; }
      sp.position.y += MM(450) * dt; sp.position.x += u.vx * dt; sp.position.z += u.vz * dt;
      sp.scale.setScalar(MM(150 + 450 * t)); sp.material.opacity = 0.22 * Math.min(1, t * 5) * (1 - t);
    }
  }
}
