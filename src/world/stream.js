import * as THREE from 'three';

// A stream of loose material falling — off a bucket's lip into a truck's body or onto the ground,
// off the tailgate of a tipped body: a curtain from the lip down to where it lands, as wide as the
// lip lets it out, streaked and running down (its texture scrolls), the colour of what falls; two
// crossed sheets so it has body from any side. Set each frame it runs (`set`); not set, it thins out.
let _tex = null;
function streakTex() {
  if (_tex) return _tex;
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  let seed = 11; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // columns of grains of different density, running down; lumps here and there
  const col = Array.from({ length: W }, () => 0.35 + r() * 0.65);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, edge = Math.min(x, W - 1 - x) / (W * 0.18), a = Math.min(1, edge) * col[x] * (0.55 + 0.45 * Math.sin(y * 0.21 + x * 1.7 + col[x] * 9) ** 2) * (r() < 0.12 ? 0.3 : 1);
    const v = 200 + r() * 55;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(${150 + r() * 80},${150 + r() * 80},${150 + r() * 80},0.95)`; g.beginPath(); g.arc(r() * W, r() * H, 1 + r() * 2.5, 0, 6.3); g.fill(); }
  _tex = new THREE.CanvasTexture(c); _tex.wrapS = _tex.wrapT = THREE.RepeatWrapping; _tex.colorSpace = THREE.SRGBColorSpace;
  return _tex;
}

export class Streams {
  constructor(scene, n = 3) {
    this.list = [];
    for (let k = 0; k < n; k++) {
      const map = streakTex().clone(); map.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map, color: 0x8a6a48, roughness: 1, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.02 });
      const g = new THREE.Group(), a = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0), mat), b = a.clone();
      b.rotation.y = Math.PI / 2; g.add(a, b); g.visible = false; g.renderOrder = 3;
      scene.add(g);
      this.list.push({ g, a, b, mat, on: 0, set: false, w: 0 });
    }
  }
  // stream k from p0 (the lip, world) down to y1 at (x1, z1), w wide (model), its colour, how thick
  set(k, p0, p1, w, color, rate = 1, lip = null) {
    const s = this.list[k]; if (!s) return;
    const dy = p0.y - p1.y; if (!(dy > 1e-5)) return;
    s.set = true; s.rate = rate;
    s.g.position.copy(p0);
    // (straight from the lip to where it lands: leaning as it falls forward)
    const dx = p1.x - p0.x, dz = p1.z - p0.z, L = Math.hypot(dx, dy, dz);
    const down = new THREE.Vector3(dx, -dy, dz).normalize(), u = (lip ? lip.clone() : new THREE.Vector3(1, 0, 0)).addScaledVector(down, -(lip ? lip.dot(down) : down.x)).normalize(), n = new THREE.Vector3().crossVectors(u, down.clone().negate());
    s.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, down.clone().negate(), n));
    s.g.scale.set(Math.max(w, 1e-4), L, Math.max(w, 1e-4));
    // (across the lip: the first sheet along it, the second its thickness)
    s.b.scale.set(0.35, 1, 1);
    s.mat.color.copy(color);
    s.mat.map.repeat.set(Math.max(1, w / 0.02), Math.max(1, L / 0.02));
  }
  update(dt) {
    for (const s of this.list) {
      s.on = s.set ? Math.min(1, s.on + dt * 6) : Math.max(0, s.on - dt * 4);
      s.g.visible = s.on > 0.01;
      if (!s.g.visible) { s.set = false; continue; }
      s.mat.opacity = s.on * Math.min(1, 0.45 + 0.55 * (s.rate ?? 1));
      s.mat.map.offset.y += dt * 2.6;   // (it runs down)
      s.set = false;
    }
  }
}
