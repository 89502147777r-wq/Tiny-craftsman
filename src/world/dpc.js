import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';

// The damp-proof course under the first course of masonry (the owner: «a roll, rolled out as it really is, English print,
// a good texture»): an SBS torch-on membrane, 3 mm, film both sides — a strip cut to the wall's width + 100 is laid on the
// foundation, the torch heating the nip between the roll and the concrete, the roll pushed on: it sticks, the molten
// bitumen pressed out a little at both edges (the sign it is fused right). Records { type: 'dpc', a: [x, z], b: [x, z], y,
// w (mm), n } — n strips side by side lapped 100 when the wall is wider than the roll (1 m).
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
export const DPC = { t: 3, roll: 1000, lap: 100, len: 10000, core: 30, speed: 250 /* mm/s */, bead: 7, widths: [400, 480, 1300] };

// the strips of a record: [{ off (mm across from the axis), w (mm) }], laid one after another
export function dpcStrips(r) {
  const W = r.w || 400;
  if (W <= DPC.roll) return [{ off: 0, w: W }];
  const n = Math.ceil((W - DPC.lap) / (DPC.roll - DPC.lap)), w = (W + (n - 1) * DPC.lap) / n, out = [];
  for (let i = 0; i < n; i++) out.push({ off: -W / 2 + w / 2 + i * (w - DPC.lap), w });
  return out;
}
export const dpcLen = (r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) / S;   // mm

let _tex = null;
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// the film's face: graphite-black polyethylene with a fine embossed diamond, the maker's indicator print (light grey
// diamonds — they shrink when the film is burnt off underneath), the print every 0,5 m, the lap band along one edge
// (sanded, for the next strip). u: along (2 m a tile), v: across (1 m — the roll's width)
export function dpcTex() {
  if (_tex) return _tex;
  const W = 2048, H = 1024, c = cv(W, H), g = c.getContext('2d'), hc = cv(W / 2, H / 2), h = hc.getContext('2d');
  g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, W, H); h.fillStyle = '#808080'; h.fillRect(0, 0, W / 2, H / 2);
  // the embossed film: a diamond knurl 6 mm (≈ 6 px a mm/1) — light on one flank, dark on the other
  const k = 6;
  for (let y = 0; y < H; y += k) for (let x = (y / k) % 2 ? k / 2 : 0; x < W; x += k) {
    g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(x, y, k / 2, k / 2);
    if (x % 2 === 0 && y % 2 === 0) { h.fillStyle = 'rgba(255,255,255,0.22)'; h.fillRect(x / 2, y / 2, 1.5, 1.5); h.fillStyle = 'rgba(0,0,0,0.22)'; h.fillRect(x / 2 + 1.5, y / 2 + 1.5, 1.5, 1.5); }
  }
  // the film's soft wrinkles from the roll (long, low)
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * H, x = Math.random() * W, L = 150 + Math.random() * 500, a = (Math.random() - 0.5) * 0.25;
    h.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},0.08)`; h.lineWidth = 2 + Math.random() * 3;
    h.beginPath(); h.moveTo(x / 2, y / 2); h.lineTo((x + Math.cos(a) * L) / 2, (y + Math.sin(a) * L) / 2); h.stroke();
  }
  // the indicator print: small hollow diamonds every 50 mm
  g.strokeStyle = 'rgba(170,170,165,0.55)'; g.lineWidth = 2;
  for (let y = 60; y < H - 110; y += 51) for (let x = ((y / 51) % 2) * 51 + 20; x < W; x += 102) { g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y); g.closePath(); g.stroke(); }
  // the lap band: 100 mm along one edge, sanded — grey grit, no film, a dashed line at its edge
  g.fillStyle = '#3a3936'; g.fillRect(0, H - 102, W, 102);
  for (let i = 0; i < 26000; i++) { const x = Math.random() * W, y = H - 102 + Math.random() * 102, v = 70 + Math.random() * 90; g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(x, y, 1.6, 1.6); }
  for (let i = 0; i < 5000; i++) { h.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'; h.fillRect(Math.random() * W / 2, (H - 102 + Math.random() * 102) / 2, 1, 1); }
  g.setLineDash([24, 14]); g.strokeStyle = 'rgba(220,220,215,0.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, H - 104); g.lineTo(W, H - 104); g.stroke(); g.setLineDash([]);
  // the print: two staggered rows every 0,5 m (1024 px = 1 m along)
  g.textBaseline = 'middle'; g.fillStyle = 'rgba(232,232,226,0.92)';
  for (const [y, x0] of [[H * 0.3, 40], [H * 0.62, 552]]) for (let x = x0; x < W; x += 1024) {
    g.font = 'bold 56px Arial, Helvetica, sans-serif'; g.fillText('SBS TORCH-ON MEMBRANE', x, y - 30);
    g.font = '34px Arial, Helvetica, sans-serif'; g.fillText('DAMP-PROOF COURSE · 3.0 mm · 1 × 10 m', x + 2, y + 22);
    g.font = 'bold 30px Arial, Helvetica, sans-serif'; g.fillText('▲ THIS SIDE UP   ·   APPLY WITH TORCH   ·   LAP 100 mm', x + 2, y + 62);
  }
  // the selvedge line at the other edge
  g.fillStyle = 'rgba(200,200,195,0.6)'; g.fillRect(0, 10, W, 4);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.ClampToEdgeWrapping; map.anisotropy = 8;
  // the relief → a normal map
  const hd = h.getImageData(0, 0, W / 2, H / 2).data, nc = cv(W / 2, H / 2), ng = nc.getContext('2d'), out = ng.createImageData(W / 2, H / 2), w2 = W / 2, h2 = H / 2;
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const at = (xx, yy) => hd[(((yy + h2) % h2) * w2 + ((xx + w2) % w2)) * 4] / 255;
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2, i = (y * w2 + x) * 4, l = Math.hypot(dx, dy, 1);
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  ng.putImageData(out, 0, 0);
  const nor = new THREE.CanvasTexture(nc); nor.wrapS = THREE.RepeatWrapping; nor.wrapT = THREE.ClampToEdgeWrapping; nor.anisotropy = 8;
  return (_tex = { map, nor });
}
// the roll's end: the spiral of the turns — black bitumen, the films grey lines between
let _end = null;
function endTex() {
  if (_end) return _end;
  const n = 256, c = cv(n, n), g = c.getContext('2d');
  g.fillStyle = '#121213'; g.fillRect(0, 0, n, n); g.strokeStyle = 'rgba(120,120,118,0.55)'; g.lineWidth = 1; g.beginPath();
  for (let t = 0; t < 80 * Math.PI; t += 0.04) { const r = 20 + t * 0.42; if (r > 127) break; g.lineTo(n / 2 + Math.cos(t) * r, n / 2 + Math.sin(t) * r); }
  g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (_end = t);
}
const mats = {};
const mat = (k, f) => mats[k] || (mats[k] = f());
const M = {
  film: () => mat('film', () => { const T = dpcTex(); return new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.nor, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.42, metalness: 0 }); }),
  edge: () => mat('edge', () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5 })),
  // the molten bitumen pressed out: black, wet glossy
  bead: () => mat('bead', () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.16, metalness: 0 })),
  end: () => mat('end', () => new THREE.MeshStandardMaterial({ map: endTex(), roughness: 0.6 })),
  steel: () => mat('steel', () => new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.35, metalness: 0.85 })),
  brass: () => mat('brass', () => new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.9 })),
  grip: () => mat('grip', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })),
  hose: () => mat('hose', () => new THREE.MeshStandardMaterial({ color: 0xc8541e, roughness: 0.7 })),
  bottle: () => mat('bottle', () => new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.45, metalness: 0.3 })),
  flameO: () => mat('flameO', () => new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
  flameB: () => mat('flameB', () => new THREE.MeshBasicMaterial({ color: 0x5a8cff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
};
// the roll's radius with L mm still on it (the turns 3 mm on a hollow of 30)
export const rollR = (L) => Math.sqrt((DPC.core) ** 2 + Math.max(0, L) * DPC.t / Math.PI);

// a strip laid from 0 to s (mm along), w wide, on the top at y; in the strip's own frame (x along, z across)
function sheet(s, w, i) {
  const g = new THREE.Group(), L = MM(Math.max(1, s)), W = MM(w), T = MM(DPC.t);
  const geo = new THREE.BoxGeometry(L, T, W); geo.translate(L / 2, T / 2 + MM(0.3) * (i + 1) + MM(DPC.t) * i, 0);
  // the uv of the top: along — 2 m a tile, across — the strip's part of the roll's 1 m (the lap band at the far edge)
  const uv = geo.attributes.uv, p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) uv.setXY(k, (p.getX(k) / S) / 2000, 1 - (p.getZ(k) / S + w / 2) / DPC.roll);
  const top = new THREE.Mesh(geo, [M.edge(), M.edge(), M.film(), M.edge(), M.edge(), M.edge()]);
  g.add(top);
  // the beads at both edges: a squashed half-round, 7 mm, a little wavy (pressed by the roll, not drawn by a ruler)
  for (const sd of [-1, 1]) {
    const n = Math.max(2, Math.ceil(s / 120)), pts = [];
    for (let j = 0; j <= n; j++) { const x = s * j / n; pts.push(new THREE.Vector3(MM(x), MM(1.5) + MM(DPC.t) * i, sd * (W / 2 + MM(2.5 + Math.sin(x * 0.031 + sd * 2) * 1.2)))); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, MM(DPC.bead / 2), 6, false), M.bead());
    tube.scale.y = 0.55; g.add(tube);
  }
  return g;
}
// the roll at s (mm along) of a strip w wide, Lrem mm still on it: its axis across, turned as it has rolled
function roll(w, Lrem, s) {
  const R = MM(rollR(Lrem)), r0 = MM(DPC.core), g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, MM(w), 40, 1, true), M.film());
  const uv = body.geometry.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (2 * Math.PI * R / S) / 2000, uv.getY(k) * w / DPC.roll);
  const spin = new THREE.Group(); spin.add(body);
  for (const sd of [-1, 1]) { const e = new THREE.Mesh(new THREE.RingGeometry(r0, R, 40), M.end()); e.position.y = sd * MM(w) / 2; e.rotation.x = sd * -Math.PI / 2; spin.add(e); }
  spin.rotation.y = -(s * S) / R;
  const ax = new THREE.Group(); ax.add(spin); ax.rotation.x = Math.PI / 2;   // (the axis across the strip: z)
  g.add(ax); g.position.set(MM(s), R + MM(DPC.t), 0);
  return g;
}
// the torch: a bell nozzle pointing back into the nip, its tube up and forward to the hand, the valve, the hose; the flame
function torch() {
  const g = new THREE.Group(), cyl = (r0, r1, l, m, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, MM(l), seg), m);
  const head = new THREE.Group();
  const bell = cyl(MM(30), MM(24), 140, M.steel(), 20); bell.position.y = MM(70); head.add(bell);
  const tube = cyl(MM(8), MM(8), 800, M.steel()); tube.position.y = MM(140 + 400); head.add(tube);
  const valve = cyl(MM(12), MM(12), 60, M.brass()); valve.position.y = MM(140 + 760); head.add(valve);
  const knob = cyl(MM(18), MM(18), 14, M.brass()); knob.rotation.z = Math.PI / 2; knob.position.set(MM(20), MM(140 + 760), 0); head.add(knob);
  const grip = cyl(MM(16), MM(16), 160, M.grip()); grip.position.y = MM(140 + 870); head.add(grip);
  // the flame out of the bell (down its axis): a blue core and the orange plume, flickering
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(MM(55), MM(320), 18, 1, true), M.flameO()); outer.position.y = -MM(160); outer.rotation.x = Math.PI;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(MM(20), MM(110), 14, 1, true), M.flameB()); inner.position.y = -MM(55); inner.rotation.x = Math.PI;
  flame.add(outer, inner); head.add(flame);
  // (no light of its own: a light coming and going recompiles every material — a stall; the flame is bright enough)
  // (the head tipped: the nozzle 30° above the base, pointing back at the nip)
  head.rotation.z = -Math.PI / 2 + 0.52;
  g.add(head);
  g.userData = { flame, outer, inner };
  return g;
}
// the propane bottle standing at the start of the run, the hose from it to the torch's hand end
function bottle() {
  const g = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(MM(150), MM(150), MM(480), 24), M.bottle());
  body.position.y = MM(290); g.add(body);
  const top = new THREE.Mesh(new THREE.SphereGeometry(MM(150), 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.bottle()); top.position.y = MM(530); g.add(top);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(MM(155), MM(155), MM(50), 24, 1, true), M.steel()); foot.position.y = MM(25); g.add(foot);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(MM(18), MM(22), MM(70), 12), M.brass()); valve.position.y = MM(710); g.add(valve);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(MM(90), MM(12), 8, 24), M.steel()); ring.rotation.x = Math.PI / 2; ring.position.y = MM(700); g.add(ring);
  return g;
}

// the view: what is laid (each record's strips), and the work going on (a roll, the torch, the bottle and the hose)
export class DpcView {
  constructor(app) {
    this.app = app; this.group = new THREE.Group(); this.group.name = 'dpc'; app.scene.add(this.group);
    this.meshes = new Map(); this.dirty = true; this.anim = new Map();   // id → { k (strip), s (mm) } while it is laid
    app.objects.on((id, rec) => { if (!rec || rec.type === 'dpc' || this.meshes.has(id)) this.dirty = true; });
    this.tool = null; this._t = 0;
  }
  // a record's frame: its start, its way along, its top
  frame(r) { const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz) || 1; return { x: r.a[0], z: r.a[1], y: r.y, ux: dx / L, uz: dz / L, L: L / S }; }
  setAnim(id, a) { if (a) this.anim.set(id, a); else this.anim.delete(id); this._build(id); }
  _build(id) {
    const r = this.app.objects.get(id), old = this.meshes.get(id);
    if (old) { this.group.remove(old); old.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); this.meshes.delete(id); }
    if (!r || r.type !== 'dpc') return;
    const F = this.frame(r), g = new THREE.Group(), A = this.anim.get(id), strips = dpcStrips(r);
    strips.forEach((st, k) => {
      const s = !A ? F.L : k < A.k ? F.L : k === A.k ? A.s : 0;
      if (s > 1) { const m = sheet(s, st.w, k); m.position.z = MM(st.off); g.add(m); }
      if (A && k === A.k) {
        const rl = roll(st.w, DPC.len - s, s); rl.position.z = MM(st.off); rl.position.y += MM(DPC.t) * k; g.add(rl);
        const R = MM(rollR(DPC.len - s));
        if (!this.tool) { this.tool = torch(); this.bot = bottle(); }
        this.tool.position.set(MM(s) + R + MM(230), MM(DPC.t) * (k + 1) + MM(150), MM(st.off)); g.add(this.tool);
        this.bot.position.set(-MM(450), 0, MM(st.off + st.w / 2 + 350)); g.add(this.bot);
        // the hose: from the bottle's valve along the ground to the torch's hand end
        const hand = new THREE.Vector3(MM(s) + R + MM(230) + Math.cos(0.52) * MM(1000), MM(150) + Math.sin(0.52) * MM(1000), MM(st.off));
        const v0 = new THREE.Vector3(-MM(450), MM(710), MM(st.off + st.w / 2 + 350));
        const pts = [v0, new THREE.Vector3(-MM(300), MM(20), v0.z), new THREE.Vector3(hand.x * 0.6, MM(20), v0.z), hand];
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, MM(6), 6, false), M.hose()));
      }
    });
    g.position.set(F.x, F.y, F.z); g.rotation.y = Math.atan2(-F.uz, F.ux);
    g.traverse((o) => { if (o.isMesh && !o.material.blending) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(g); this.meshes.set(id, g);
  }
  update(dt = 1 / 60) {
    if (this.dirty) {
      this.dirty = false;
      const seen = new Set(this.app.objects.all('dpc').map((r) => r.id));
      for (const id of [...this.meshes.keys()]) if (!seen.has(id)) this._build(id);
      for (const id of seen) if (!this.meshes.has(id)) this._build(id);
    }
    // the flame flickers while a strip is laid
    if (this.tool && this.anim.size) {
      this._t += dt; const U = this.tool.userData, f = 1 + Math.sin(this._t * 37) * 0.06 + Math.sin(this._t * 61) * 0.05 + (Math.random() - 0.5) * 0.08;
      U.outer.scale.set(f, 1.05 * f + 0.05 * Math.sin(this._t * 23), f); U.inner.scale.setScalar(1 + (Math.random() - 0.5) * 0.05);
    }
  }
}
