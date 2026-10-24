import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_SCALE, TRAY } from '../config.js';
import { VILLA, PITS } from './villa.js';

// The project drawn over the plot, the way it is held against the site while building: the
// walls of a storey as pale glass with their openings cut out (doors orange, windows blue),
// the floor slabs with their holes, the stair, the carport's columns, and on the ground the
// pool, the terrace, the drive and the pits to set out. Room names lie on the floor.
//   show: 'off' | 'site' | 'f1' | 'f2' | 'all'
const S = 1 / 1000 / MODEL_SCALE;
const COL = { wall: 0x8fd0ff, edge: 0xbfe6ff, door: 0xff9a3c, window: 0x4fb4ff, slab: 0xd6ecff, site: 0xffffff, pool: 0x39a8e6, pit: 0xffd24a, stair: 0xe9f4ff, steel: 0x6c7a86, rail: 0x9fe3ff };

export class ProjectView {
  constructor(project = VILLA) {
    this.p = project;
    this.group = new THREE.Group();
    this.group.name = 'project';
    this.group.visible = false;
    this.show = 'off';
    const P = project;
    this.ox = -TRAY.innerX / 2 + P.at[0] * S;
    this.oz = -TRAY.innerZ / 2 + P.at[1] * S;
    this.y0 = TRAY.soil;
    const glass = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.mat = {
      wall: glass(COL.wall, 0.17), slab: glass(COL.slab, 0.12), stair: glass(COL.stair, 0.3), pool: glass(COL.pool, 0.35), site: glass(COL.site, 0.14),
      rail: glass(COL.rail, 0.3), steel: new THREE.MeshStandardMaterial({ color: COL.steel, metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.8 }),
    };
    this.lineMat = (c, o = 0.9) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
    this.layers = { site: this._site(), f1: this._floor(0), f2: this._floor(1), roof: this._roof() };
    for (const g of Object.values(this.layers)) this.group.add(g);
  }

  // house mm → world
  X(x) { return this.ox + x * S; }
  Z(z) { return this.oz + z * S; }
  Y(mm) { return this.y0 + mm * S; }
  floorY(i) { return this.p.ffl + i * this.p.storey; }

  setShow(m) {
    this.show = m;
    this.group.visible = m !== 'off';
    const L = this.layers, all = m === 'all';
    L.site.visible = m !== 'off';
    L.f1.visible = all || m === 'f1' || m === 'f2';
    L.f2.visible = all || m === 'f2';
    L.roof.visible = all;
    // (the storey below the one shown: only faint)
    L.f1.traverse((o) => { if (o.material?.userData?.base != null) o.material.opacity = o.material.userData.base * (m === 'f2' ? 0.35 : 1); });
  }

  // a box from house mm (x0..x1, z0..z1, y0..y1) — as geometry, for merging
  _box(x0, z0, x1, z1, y0, y1) {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0) * S, Math.abs(y1 - y0) * S, Math.abs(z1 - z0) * S);
    g.translate(this.X((x0 + x1) / 2), this.Y((y0 + y1) / 2), this.Z((z0 + z1) / 2));
    return g;
  }
  // a wall piece along an axis a→b from s0 to s1 (mm), t thick, y0..y1
  _wallPiece(a, b, s0, s1, t, y0, y1) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const g = new THREE.BoxGeometry((s1 - s0) * S, (y1 - y0) * S, t * S);
    g.rotateY(-Math.atan2(uz, ux));
    const m = (s0 + s1) / 2;
    g.translate(this.X(a[0] + ux * m), this.Y((y0 + y1) / 2), this.Z(a[1] + uz * m));
    return g;
  }
  _outline(pts, y, c, o) {   // a closed line through house-mm points at height y (mm)
    const v = pts.map(([x, z]) => new THREE.Vector3(this.X(x), this.Y(y), this.Z(z)));
    const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(v), this.lineMat(c, o));
    l.material.userData.base = o; l.renderOrder = 3;
    return l;
  }
  _mesh(geos, mat) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat.clone());
    m.material.userData.base = mat.opacity; m.renderOrder = 2;
    return m;
  }
  _edges(mesh, c, o) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), this.lineMat(c, o));
    l.material.userData.base = o; l.renderOrder = 3;
    return l;
  }
  _label(text, x, z, y, size = 900) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), F = 44;
    g.font = `600 ${F}px -apple-system, Helvetica, Arial, sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + 24; c.width = w; c.height = F + 20;
    g.font = `600 ${F}px -apple-system, Helvetica, Arial, sans-serif`;
    g.fillStyle = 'rgba(20,40,60,0.55)'; g.fillRect(0, 0, w, c.height);
    g.fillStyle = '#eaf6ff'; g.textBaseline = 'middle'; g.fillText(text, 12, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const h = size * S, m = new THREE.Mesh(new THREE.PlaneGeometry(h * w / c.height, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.material.userData.base = 1;
    m.rotation.x = -Math.PI / 2; m.position.set(this.X(x), this.Y(y) + 0.0004, this.Z(z)); m.renderOrder = 4;
    return m;
  }

  _floor(i) {
    const P = this.p, F = P.floors[i], g = new THREE.Group(), y0 = this.floorY(i), top = y0 + P.storey - P.slab;
    const T = { block: 300, brick: 120 };
    const walls = [], doors = [], wins = [];
    for (const w of F.walls) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), t = T[w.kind] || 300;
      const ops = F.openings.filter((o) => o.w === w.id).sort((a, b) => a.from - b.from);
      // the solid pieces: between the openings full height, under the sills and over the heads
      let s = 0;
      for (const o of ops) {
        if (o.from > s) walls.push(this._wallPiece(w.a, w.b, s, o.from, t, y0, top));
        if (o.sill > 0) walls.push(this._wallPiece(w.a, w.b, o.from, o.to, t, y0, y0 + o.sill));
        if (o.head < P.storey - P.slab) walls.push(this._wallPiece(w.a, w.b, o.from, o.to, t, y0 + o.head, top));
        // the opening itself: its frame line
        const fr = this._wallPiece(w.a, w.b, o.from, o.to, t * 0.4, y0 + o.sill, y0 + o.head);
        (o.type === 'door' || o.type === 'pass' ? doors : wins).push(fr);
        s = o.to;
      }
      if (s < L) walls.push(this._wallPiece(w.a, w.b, s, L, t, y0, top));
    }
    const wm = this._mesh(walls, this.mat.wall);
    g.add(wm, this._edges(wm, COL.edge, 0.55));
    if (wins.length) { const m = this._mesh(wins, this.mat.wall); m.visible = false; g.add(this._edges(m, COL.window, 0.95)); }
    if (doors.length) { const m = this._mesh(doors, this.mat.wall); m.visible = false; g.add(this._edges(m, COL.door, 0.95)); }
    // the floor it stands on: the slab's outline (the foundation slab under the 1st floor)
    if (i === 0) {
      g.add(this._outline([[-150, -150], [13350, -150], [13350, 8550], [-150, 8550]], y0, COL.slab, 0.8));
      for (const [x, z] of F.columns || []) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(80 * S, 80 * S, (P.storey - P.slab + P.ffl) * S, 12), this.mat.steel);
        c.position.set(this.X(x), this.Y((P.storey - P.slab + P.ffl) / 2), this.Z(z)); g.add(c);
      }
      // the stair
      const st = P.stair, n = st.risers, rise = P.storey / n, steps = [];
      for (let k = 0; k < n - 1; k++) {
        const za = st.zBottom + (st.zTop - st.zBottom) * (k / (n - 1)), zb = st.zBottom + (st.zTop - st.zBottom) * ((k + 1) / (n - 1));
        steps.push(this._box(st.x0, Math.min(za, zb), st.x1, Math.max(za, zb), y0 + rise * (k + 1) - 40, y0 + rise * (k + 1)));
      }
      const sm = this._mesh(steps, this.mat.stair); g.add(sm, this._edges(sm, COL.edge, 0.6));
    } else {
      // the floor slab under this storey, with its holes
      const s = P.slab1, sh = new THREE.Shape([[s.x0, s.z0], [s.x1, s.z0], [s.x1, s.z1], [s.x0, s.z1]].map(([x, z]) => new THREE.Vector2(x, z)));
      for (const h of P.holes) sh.holes.push(new THREE.Path([[h.x0, h.z0], [h.x0, h.z1], [h.x1, h.z1], [h.x1, h.z0]].map(([x, z]) => new THREE.Vector2(x, z))));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: P.slab, bevelEnabled: false });
      // (shape x, y → house x, z; extruded along +z → down from the floor)
      geo.applyMatrix4(new THREE.Matrix4().set(S, 0, 0, this.ox, 0, 0, -S, this.Y(y0), 0, S, 0, this.oz, 0, 0, 0, 1));
      const sm = new THREE.Mesh(geo, this.mat.slab.clone()); sm.material.userData.base = this.mat.slab.opacity; sm.renderOrder = 2;
      g.add(sm, this._edges(sm, COL.edge, 0.5));
      for (const [a, b] of F.rails || []) { const r = this._mesh([this._wallPiece(a, b, 0, Math.hypot(b[0] - a[0], b[1] - a[1]), 20, y0, y0 + 1100)], this.mat.rail); g.add(r, this._edges(r, COL.rail, 0.8)); }
    }
    for (const r of F.rooms) g.add(this._label(r.name, r.at[0], r.at[1], y0 + 5, 420));
    return g;
  }

  _roof() {
    const P = this.p, r = P.roofSlab, g = new THREE.Group(), y = this.floorY(2) - P.slab;
    const m = this._mesh([this._box(r.x0 - 150, r.z0 - 150, r.x1 + 150, r.z1 + 150, y, y + P.slab)], this.mat.slab);
    g.add(m, this._edges(m, COL.edge, 0.5));
    return g;
  }

  _site() {
    const P = this.p, s = P.site, g = new THREE.Group();
    const flat = (r, y, mat, c) => { const m = this._mesh([this._box(r.x0, r.z0, r.x1, r.z1, y - 20, y)], mat); g.add(m, this._edges(m, c, 0.8)); };
    flat(s.drive, 20, this.mat.site, COL.site); flat(s.path, 20, this.mat.site, COL.site);
    flat(s.terrace, s.terrace.y, this.mat.site, 0xd9b48a); flat(s.poolDeck, s.poolDeck.y, this.mat.site, 0xd8d2c4);
    // the pool: the bowl inside as a body of water, its walls as a rim
    const pl = s.pool, top = s.poolDeck.y, wl = top - pl.water;
    const water = this._mesh([this._box(pl.x0, pl.z0, pl.x1, pl.z1, wl - pl.depth, wl)], this.mat.pool);
    g.add(water, this._edges(water, COL.pool, 0.9));
    g.add(this._label(pl.name, (pl.x0 + pl.x1) / 2 - 1200, (pl.z0 + pl.z1) / 2, top + 10, 500));
    g.add(this._label(s.terrace.name, s.terrace.x0 + 1700, s.terrace.z0 + 1200, s.terrace.y + 10, 380));
    g.add(this._label(s.drive.name, s.drive.x0 + 2400, s.drive.z0 + 1500, 30, 300));
    // the pits to set out: a yellow line on the ground
    for (const pt of PITS) {
      const o = this._outline([[pt.x0, pt.z0], [pt.x1, pt.z0], [pt.x1, pt.z1], [pt.x0, pt.z1]], 15, COL.pit, 0.9);
      o.material.depthTest = false; g.add(o);   // (seen over the bumps of the ground)
      g.add(this._label(`${pt.name} · −${(pt.depth / 1000).toFixed(2).replace('.', ',')} м`, pt.x0 + 1600, pt.z0 + 350, 20, 300));
    }
    // the fence along the street, the gate at the drive
    const f = s.fence, fx0 = -P.at[0], fx1 = s.plot[0] - P.at[0];
    g.add(this._outline([[fx0 + 50, f.z + 60], [fx1 - 50, f.z + 60]], 1800, 0xc0c8d0, 0.6));
    return g;
  }

  // world rect (model m) of a pit to set out, and its depth in model mm (as the outlines take it)
  pitRect(pt) {
    return { x0: this.X(pt.x0), z0: this.Z(pt.z0), x1: this.X(pt.x1), z1: this.Z(pt.z1), depth: Math.round(pt.depth / MODEL_SCALE) };
  }
}
