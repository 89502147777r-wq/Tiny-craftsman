import * as THREE from 'three';

// Setting-out (разбивка): four stakes just outside the corners of the pit and
// a taut orange line between them. The pit outline itself is a chalk line
// drawn by the terrain shader.
export class Marking {
  constructor(terrain) {
    this.terrain = terrain;
    this.rect = { x0: -0.075, z0: -0.06, x1: 0.075, z1: 0.06 };
    this.offset = 0.007; // stakes stand a little outside the outline
    this.group = new THREE.Group();
    this.group.name = 'marking';
    const wood = new THREE.MeshStandardMaterial({ color: 0xcaa274, roughness: 0.8 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xd8401f, roughness: 0.6 });
    this.stakes = [];
    const stakeGeo = makeStakeGeometry();
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Group();
      const body = new THREE.Mesh(stakeGeo, wood);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.00205, 0.0018, 0.00205), paint);
      cap.position.y = 0.0105;
      s.add(body, cap);
      s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(s);
      this.stakes.push(s);
    }
    this.lineMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.55, emissive: 0x3a0e00 });
    this.lines = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.00022, 0.00022, 1, 6, 1), this.lineMat);
      l.castShadow = true;
      this.group.add(l);
      this.lines.push(l);
    }
    this.highlight = -1;
    this._seen = -1;
    this.update(true);
  }

  setRect(r) { this.rect = { ...r }; this.update(true); }

  corners() {
    const r = this.rect, o = this.offset;
    return [[r.x0 - o, r.z0 - o], [r.x1 + o, r.z0 - o], [r.x1 + o, r.z1 + o], [r.x0 - o, r.z1 + o]];
  }

  update(force = false) {
    const t = this.terrain;
    if (!force && t.version === this._seen) return;
    this._seen = t.version;
    const c = this.corners();
    const tops = [];
    for (let i = 0; i < 4; i++) {
      const [x, z] = c[i];
      const y = t.heightAt(x, z) - 0.002; // driven ~2 mm into the ground
      this.stakes[i].position.set(x, y, z);
      this.stakes[i].scale.setScalar(this.highlight === i ? 1.25 : 1);
      tops.push(new THREE.Vector3(x, y + 0.0085, z));
    }
    for (let i = 0; i < 4; i++) {
      const a = tops[i], b = tops[(i + 1) % 4];
      const l = this.lines[i];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a);
      l.position.copy(mid);
      l.scale.set(1, d.length(), 1);
      l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    }
  }

  // index of the stake closest to a ground point (within reach), or -1
  pick(x, z, reach = 0.02) {
    let best = -1, bd = reach;
    this.corners().forEach(([cx, cz], i) => { const d = Math.hypot(cx - x, cz - z); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // move one corner, keeping the outline a rectangle
  moveCorner(i, x, z) {
    const r = { ...this.rect }, o = this.offset, lim = this.terrain.half - 0.012, min = 0.03;
    x = Math.max(-lim, Math.min(lim, x)); z = Math.max(-lim, Math.min(lim, z));
    if (i === 0 || i === 3) r.x0 = Math.min(x + o, r.x1 - min); else r.x1 = Math.max(x - o, r.x0 + min);
    if (i === 0 || i === 1) r.z0 = Math.min(z + o, r.z1 - min); else r.z1 = Math.max(z - o, r.z0 + min);
    this.setRect(r);
  }
}

function makeStakeGeometry() {
  // square 2 mm stake, 12 mm long, sharpened point
  const g = new THREE.CylinderGeometry(0.00095 * Math.SQRT2, 0.00095 * Math.SQRT2, 0.012, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.006 - 0.001, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setXYZ(i, p.getX(i) * 0.15, p.getY(i) - 0.0025, p.getZ(i) * 0.15);
  g.computeVertexNormals();
  return g;
}
