import * as THREE from 'three';
import { TRAY } from '../config.js';

// ---- geometry ------------------------------------------------------------------------
// Outline records (type 'outline'):
//   { kind: 'rect',   x0, z0, x1, z1, depth }            – a pit
//   { kind: 'trench', pts: [[x, z], …], width, depth }   – a strip-foundation trench
// depth is in model millimetres below natural ground.

export function gradeY(o) { return TRAY.soil - o.depth / 1000; }

export function contains(o, x, z) {
  if (o.kind === 'rect') return x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1;
  return distToPolyline(o.pts, x, z) <= o.width / 2;
}

export function bbox(o, pad = 0) {
  if (o.kind === 'rect') return { x0: o.x0 - pad, z0: o.z0 - pad, x1: o.x1 + pad, z1: o.z1 + pad };
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of o.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const r = o.width / 2 + pad;
  return { x0: x0 - r, z0: z0 - r, x1: x1 + r, z1: z1 + r };
}

export function distToPolyline(pts, x, z) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

// Offset an open polyline sideways (+ = left of travel) with mitred joints.
export function offsetPolyline(pts, d) {
  const out = [];
  const n = pts.length;
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz) || 1e-9;
    segN.push([-dz / l, dx / l]);
  }
  for (let i = 0; i < n; i++) {
    let nx, nz, k = 1;
    if (i === 0) [nx, nz] = segN[0];
    else if (i === n - 1) [nx, nz] = segN[n - 2];
    else {
      const a = segN[i - 1], b = segN[i];
      nx = a[0] + b[0]; nz = a[1] + b[1];
      const l = Math.hypot(nx, nz) || 1e-9;
      nx /= l; nz /= l;
      k = 1 / Math.max(0.25, nx * a[0] + nz * a[1]);
    }
    out.push([pts[i][0] + nx * d * k, pts[i][1] + nz * d * k]);
  }
  return out;
}

// Closed boundary loop of an outline, pushed outwards by `off` (counter-clockwise
// when seen from above, i.e. outward normal is to the right of travel).
export function polygon(o, off = 0) {
  if (o.kind === 'rect') {
    return [[o.x0 - off, o.z0 - off], [o.x0 - off, o.z1 + off], [o.x1 + off, o.z1 + off], [o.x1 + off, o.z0 - off]];
  }
  const h = o.width / 2 + off;
  const left = offsetPolyline(o.pts, h), right = offsetPolyline(o.pts, -h);
  // extend the ends by `off` so stakes sit beyond the trench ends
  if (off > 0) {
    const ext = (p, q) => { const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1; return [p[0] + dx / l * off, p[1] + dz / l * off]; };
    const n = o.pts.length;
    left[0] = ext(left[0], left[1]); right[0] = ext(right[0], right[1]);
    left[n - 1] = ext(left[n - 1], left[n - 2]); right[n - 1] = ext(right[n - 1], right[n - 2]);
  }
  const loop = [...right, ...left.reverse()];
  return signedArea(loop) < 0 ? loop.reverse() : loop;
}

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) { const [x0, z0] = loop[i], [x1, z1] = loop[(i + 1) % loop.length]; a += x0 * z1 - x1 * z0; }
  return a / 2;
}

// Boundary edges with their outward normals (used by formwork).
export function edges(o) {
  const loop = polygon(o, 0);
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 1e-4) continue;
    let n = [dz / l, -dx / l];
    const mx = (a[0] + b[0]) / 2 + n[0] * 0.0005, mz = (a[1] + b[1]) / 2 + n[1] * 0.0005;
    if (pointInPolygon(loop, mx, mz)) n = [-n[0], -n[1]];
    out.push({ a, b, n });
  }
  return out;
}

export function pointInPolygon(loop, x, z) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, zi] = loop[i], [xj, zj] = loop[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Points the user can drag in the marking tool.
export function handles(o) {
  if (o.kind === 'rect') return [[o.x0, o.z0], [o.x1, o.z0], [o.x1, o.z1], [o.x0, o.z1]];
  return o.pts.map((p) => [p[0], p[1]]);
}

export function moveHandle(o, i, x, z, min = 0.02) {
  if (o.kind === 'rect') {
    const r = { x0: o.x0, z0: o.z0, x1: o.x1, z1: o.z1 };
    if (i === 0 || i === 3) r.x0 = Math.min(x, r.x1 - min); else r.x1 = Math.max(x, r.x0 + min);
    if (i === 0 || i === 1) r.z0 = Math.min(z, r.z1 - min); else r.z1 = Math.max(z, r.z0 + min);
    return r;
  }
  const pts = o.pts.map((p) => [p[0], p[1]]);
  pts[i] = [x, z];
  return { pts };
}

export function sizeText(o, scale) {
  if (o.kind === 'rect') {
    const w = (o.x1 - o.x0) * 1000, d = (o.z1 - o.z0) * 1000;
    return `${w.toFixed(0)} × ${d.toFixed(0)} мм · ${(w * scale / 1000).toFixed(2)} × ${(d * scale / 1000).toFixed(2)} м`;
  }
  let L = 0;
  for (let i = 0; i < o.pts.length - 1; i++) L += Math.hypot(o.pts[i + 1][0] - o.pts[i][0], o.pts[i + 1][1] - o.pts[i][1]);
  return `траншея ${(L * scale).toFixed(2)} м × ${(o.width * scale * 100).toFixed(0)} см`;
}

// ---- view ------------------------------------------------------------------------------
// Stakes + string line around every outline, drag handles in the marking
// tool, and a mask texture the terrain shader reads: R = chalk line,
// G = inside an outline, B = design depth (0..100 mm).
export class OutlineView {
  constructor(terrain, objects) {
    this.terrain = terrain;
    this.objects = objects;
    this.group = new THREE.Group();
    this.group.name = 'outlines';
    this.items = new Map();
    this.offset = 0.007;
    this.showHandles = false;
    this.selected = null;
    this.wood = new THREE.MeshStandardMaterial({ color: 0xcaa274, roughness: 0.8 });
    this.paint = new THREE.MeshStandardMaterial({ color: 0xd8401f, roughness: 0.6 });
    this.lineMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.55, emissive: 0x3a0e00 });
    this.handleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    this.handleSelMat = new THREE.MeshBasicMaterial({ color: 0xf0a63a, transparent: true, opacity: 0.95, depthTest: false });
    this.stakeGeo = makeStakeGeometry();
    this.capGeo = new THREE.BoxGeometry(0.00205, 0.0018, 0.00205);
    this.lineGeo = new THREE.CylinderGeometry(0.00022, 0.00022, 1, 6, 1);
    this.handleGeo = new THREE.RingGeometry(0.0035, 0.0052, 24).rotateX(-Math.PI / 2);

    const W = 2048, H = Math.round(W * terrain.sizeZ / terrain.sizeX);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.mask = new THREE.CanvasTexture(this.canvas);
    this.mask.flipY = false;
    this.mask.colorSpace = THREE.NoColorSpace;
    this.mask.generateMipmaps = false;
    this.mask.minFilter = THREE.LinearFilter;
    this._maskDirty = true;
    this._seen = -1;
    objects.on((id, rec) => { if (rec?.type === 'outline' || this.items.has(id)) { this._rebuild(id, rec); this._maskDirty = true; } });
  }

  outlines() { return this.objects.all('outline'); }

  _rebuild(id, rec) {
    const old = this.items.get(id);
    if (old) { this.group.remove(old.group); this.items.delete(id); }
    if (!rec || rec.type !== 'outline') return;
    const g = new THREE.Group();
    const loop = polygon(rec, this.offset);
    const stakes = loop.map(() => {
      const s = new THREE.Group();
      const body = new THREE.Mesh(this.stakeGeo, this.wood);
      const cap = new THREE.Mesh(this.capGeo, this.paint);
      cap.position.y = 0.0105;
      body.castShadow = cap.castShadow = true;
      s.add(body, cap);
      g.add(s);
      return s;
    });
    const lines = loop.map(() => { const l = new THREE.Mesh(this.lineGeo, this.lineMat); l.castShadow = true; g.add(l); return l; });
    const hs = handles(rec).map(() => {
      const h = new THREE.Mesh(this.handleGeo, this.handleMat);
      h.renderOrder = 10;
      g.add(h);
      return h;
    });
    this.group.add(g);
    this.items.set(id, { group: g, loop, stakes, lines, hs, rec });
    this._place(this.items.get(id));
  }

  _place(it) {
    const t = this.terrain;
    const tops = it.loop.map(([x, z], i) => {
      const y = (t.inside(x, z) ? t.heightAt(x, z) : TRAY.soil) - 0.002;
      it.stakes[i].position.set(x, y, z);
      return new THREE.Vector3(x, y + 0.0085, z);
    });
    for (let i = 0; i < tops.length; i++) {
      const a = tops[i], b = tops[(i + 1) % tops.length], l = it.lines[i];
      const d = b.clone().sub(a);
      l.position.copy(a).add(b).multiplyScalar(0.5);
      l.scale.set(1, Math.max(1e-4, d.length()), 1);
      l.quaternion.setFromUnitVectors(_up, d.normalize());
    }
    const hp = handles(it.rec);
    const sel = this.selected === it.rec.id;
    it.hs.forEach((h, i) => {
      const [x, z] = hp[i];
      h.position.set(x, (t.inside(x, z) ? t.heightAt(x, z) : TRAY.soil) + 0.0006, z);
      h.visible = this.showHandles;
      h.material = sel ? this.handleSelMat : this.handleMat;
      h.scale.setScalar(sel ? 1.25 : 1);
    });
  }

  setHandles(on, selected = this.selected) {
    this.showHandles = on;
    this.selected = selected;
    for (const it of this.items.values()) this._place(it);
  }

  update() {
    if (this.terrain.version !== this._seen) {
      this._seen = this.terrain.version;
      for (const it of this.items.values()) this._place(it);
    }
    if (this._maskDirty) this._drawMask();
  }

  _drawMask() {
    this._maskDirty = false;
    const { ctx, canvas } = this, t = this.terrain;
    const sx = canvas.width / t.sizeX, sz = canvas.height / t.sizeZ;
    const P = ([x, z]) => [(x + t.halfX) * sx, (z + t.halfZ) * sz];
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // regions, shallow first so the deepest wins where outlines overlap
    const os = this.outlines().sort((a, b) => a.depth - b.depth);
    for (const o of os) {
      const b = Math.max(0, Math.min(255, Math.round(o.depth / 100 * 255)));
      ctx.fillStyle = `rgb(0,255,${b})`;
      ctx.beginPath();
      polygon(o, 0).forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.fill();
    }
    // chalk lines on top (additive into R)
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgb(255,0,0)';
    ctx.lineWidth = Math.max(1.6, 0.0011 * sx);
    ctx.lineJoin = 'miter';
    for (const o of os) {
      ctx.beginPath();
      polygon(o, 0).forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    this.mask.needsUpdate = true;
  }

  // nearest drag handle to a ground point → { id, i } or null
  pickHandle(x, z, reach = 0.012) {
    let best = null, bd = reach;
    for (const it of this.items.values()) {
      handles(it.rec).forEach(([hx, hz], i) => {
        const d = Math.hypot(hx - x, hz - z);
        if (d < bd || (d < reach && it.rec.id === this.selected && best?.id !== this.selected)) { bd = d; best = { id: it.rec.id, i }; }
      });
    }
    return best;
  }

  // outline under a ground point (deepest first)
  pickOutline(x, z) {
    const hits = this.outlines().filter((o) => contains(o, x, z) || distToEdge(o, x, z) < 0.006);
    hits.sort((a, b) => b.depth - a.depth);
    return hits[0] || null;
  }
}

function distToEdge(o, x, z) {
  const loop = polygon(o, 0);
  return distToPolyline([...loop, loop[0]], x, z);
}

const _up = new THREE.Vector3(0, 1, 0);

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
