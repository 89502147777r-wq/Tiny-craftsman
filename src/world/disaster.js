import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { loadPhysics } from './physics.js';
import { Puffs } from './smoke.js';
import { isSlab } from '../tools/slab.js';
import { ShaftCollapse, slabPieces, hullDesc } from './collapse.js';

// Catastrophes (a show, not a change to the project: nothing in the records moves — at «Вернуть как было»
// the house is as it was). The house is taken as it is drawn: every block, brick and lintel of the walls,
// grouped into chunks of masonry (a few units across and a few courses up, as masonry breaks), and the
// other parts — the roofs, the windows, the facades — as panels. Each starts held in place (kinematic);
// what a chunk carries and what carries it is known (the support graph). The catastrophe loads them —
// the ground's acceleration, the wind's pressure, the water's drag — against their strength (the mortar,
// the ring beam, the kind of unit, a random weakness); a chunk over its strength breaks free and falls
// as a rigid body (Rapier: real metres, kilograms, g); what it carried, left with nothing under it, follows.
// The free pieces are pushed by the wind / the water (drag, buoyancy) and lie where they fall.
//   kinds: quake (magnitude 4…9), hurricane (category 1…5), tornado (EF0…EF5), tsunami (the wave 0,5…12 m),
//   flood (the water 0,2…3 m), fire (a spark … an inferno), meteor (Ø 0,2…5 m); power 1…10.
const S = MODEL_SCALE, M = (v) => v / S;   // (model → m: ×S; m → model: /S)
export const CATS = {
  quake: { name: 'Землетрясение', en: 'Earthquake', icon: '🌍', unit: (p) => `M ${(4 + (p - 1) * 5 / 9).toFixed(1)}`, dur: 14 },
  hurricane: { name: 'Ураган', en: 'Hurricane', icon: '🌀', unit: (p, en) => `${Math.round(33 + (p - 1) * 47 / 9)} ${en ? 'm/s · cat.' : 'м/с · кат.'} ${Math.min(5, 1 + Math.floor((p - 1) / 2))}`, dur: 18 },
  tornado: { name: 'Смерч', en: 'Tornado', icon: '🌪', unit: (p, en) => `EF${Math.min(5, Math.floor((p - 1) / 1.8))} · ${Math.round(30 + (p - 1) * 65 / 9)} ${en ? 'm/s' : 'м/с'}`, dur: 16 },
  tsunami: { name: 'Цунами', en: 'Tsunami', icon: '🌊', unit: (p, en) => (en ? `a ${(0.5 + (p - 1) * 11.5 / 9).toFixed(1)} m wave` : `волна ${(0.5 + (p - 1) * 11.5 / 9).toFixed(1).replace('.', ',')} м`), dur: 18 },
  flood: { name: 'Наводнение', en: 'Flood', icon: '💧', unit: (p, en) => (en ? `water ${(0.2 + (p - 1) * 2.8 / 9).toFixed(1)} m` : `вода ${(0.2 + (p - 1) * 2.8 / 9).toFixed(1).replace('.', ',')} м`), dur: 20 },
  fire: { name: 'Пожар', en: 'Fire', icon: '🔥', unit: (p, en) => (en ? ['a spark', 'a small fire', 'a fire', 'a big fire', 'a firestorm'] : ['искра', 'возгорание', 'пожар', 'сильный пожар', 'огненный шторм'])[Math.min(4, Math.floor((p - 1) / 2))], dur: 22 },
  shaft: { name: 'Обрушение опоры', en: 'Support collapse', icon: '🏚', unit: (p, en) => (en ? 'the house on its lift shaft' : 'дом на шахте лифта'), dur: 14 },
  meteor: { name: 'Метеорит', en: 'Meteorite', icon: '☄', unit: (p, en) => `Ø ${(0.2 + (p - 1) * 4.8 / 9).toFixed(1)} ${en ? 'm' : 'м'}`, dur: 12 },
};

// what the view's instanced meshes hold: masonry (broken into chunks) and how heavy (kg/m³) and strong
const MASONRY = [['blocks', 600, 1.0], ['ublocks', 600, 1.0], ['bricks', 1800, 1.25], ['cinders', 1400, 0.9], ['lintels', 2400, 2.2]];
const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

export class Disaster {
  constructor(app) { this.app = app; this.on = false; this.puffs = null; }

  // ---- setting up --------------------------------------------------------------------------------
  async start(kind, power) {
    if (this.on) this.stop();
    const R = (this.R = await loadPhysics());
    const app = this.app, wv = app.wallView, t = app.terrain;
    this.kind = kind; this.power = power; this.t = 0; this.on = true; this.done = false; this.broken = 0; this.said = {}; this.resting = false; this._restN = 0;
    wv._ride = null;   // (a lift's ride stopped: the view frozen, it would never get there — and keep the frames going)
    wv.update?.(); wv.frozen = true;
    this.root = new THREE.Group(); this.root.name = 'disaster'; app.scene.add(this.root);
    this.puffs = this.puffs || new Puffs(app.scene, 420);
    // the world: gravity, the ground (a height field on a kinematic body — it can shake)
    const W = (this.world = new R.World({ x: 0, y: -9.81, z: 0 })); W.timestep = 1 / 60;
    this.ground = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    { const st = 4, nx = Math.ceil(t.rx / st), nz = Math.ceil(t.rz / st), h = new Float32Array((nx + 1) * (nz + 1));
      for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) h[b + a * (nz + 1)] = t.hAt(Math.min(t.rz, b * st) * t.nx + Math.min(t.rx, a * st)) * S;
      const sx = nx * st * t.cell * S, sz = nz * st * t.cell * S;
      W.createCollider(R.ColliderDesc.heightfield(nz, nx, h, { x: sx, y: 1, z: sz }).setTranslation(t.toWorldX(0) * S + sx / 2, 0, t.toWorldZ(0) * S + sz / 2).setFriction(0.8).setRestitution(0.05), this.ground); }
    // the masonry: each unit as drawn, into chunks
    this.pieces = []; this.clones = [];
    const m4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    for (const [key, dens, str] of MASONRY) {
      // (the view's own instanced meshes are moved — the view is frozen meanwhile, and built again from the
      // records after: their materials, tints and attributes are all theirs)
      const im = wv[key]; if (!im || !im.count || !im.visible) continue;
      this.clones.push({ im });
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4); m4.decompose(P, Q, Sv);
        if (Sv.x * Sv.y * Sv.z < 1e-12) continue;
        this.pieces.push({ cl: im, i, p: P.clone(), q: Q.clone(), s: Sv.clone(), dens, str, lintel: key === 'lintels' });
      }
    }
    this.hidden = [wv.mortar].filter((m) => m?.visible); for (const m of this.hidden) m.visible = false;
    // the chunks: a grid along the walls (0,9 m across, 0,75 m up — smaller the stronger it is)
    const big = this.pieces.length > 1200 ? Math.min(2.2, Math.sqrt(this.pieces.length / 1200)) : 1;   // (a big house: bigger chunks — no more than ~500 bodies on a phone)
    const ca = M((this.power > 6 ? 0.6 : 0.9) * big), cy = M((this.power > 6 ? 0.5 : 0.75) * Math.sqrt(big)), grid = new Map();
    for (const pc of this.pieces) { const k = pc.lintel ? 'L' + pc.i : `${Math.floor(pc.p.x / ca)}|${Math.floor(pc.p.y / cy)}|${Math.floor(pc.p.z / ca)}`; let c = grid.get(k); if (!c) grid.set(k, (c = { pieces: [] })); c.pieces.push(pc); }
    this.chunks = [...grid.values()];
    const belt = app.objects.all('belt').length > 0, slab = app.objects.all('slab').length > 0;
    let y0 = Infinity, y1 = -Infinity;
    for (const c of this.chunks) {
      const b = (c.box = new THREE.Box3()); for (const pc of c.pieces) b.expandByPoint(pc.p.clone().addScaledVector(pc.s, -0.5)).expandByPoint(pc.p.clone().addScaledVector(pc.s, 0.5));
      c.c = b.getCenter(new THREE.Vector3()); y0 = Math.min(y0, b.min.y); y1 = Math.max(y1, b.max.y);
      const bd = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.c.x * S, c.c.y * S, c.c.z * S).setLinearDamping(0.05).setAngularDamping(0.25));
      let mass = 0;
      for (const pc of c.pieces) {
        const hx = Math.max(0.01, pc.s.x * S / 2 - 0.003), hy = Math.max(0.01, pc.s.y * S / 2 - 0.003), hz = Math.max(0.01, pc.s.z * S / 2 - 0.003);
        W.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation((pc.p.x - c.c.x) * S, (pc.p.y - c.c.y) * S, (pc.p.z - c.c.z) * S).setRotation(pc.q).setDensity(pc.dens).setFriction(0.75).setRestitution(0.08), bd);
        pc.local = new THREE.Matrix4().compose(pc.p.clone().sub(c.c), pc.q, pc.s); mass += pc.dens * 8 * hx * hy * hz;
      }
      c.body = bd; c.mass = mass; c.free = false;
      c.str = (c.pieces[0].str) * (0.55 + 0.9 * rnd()) * (belt ? 1.5 : 1) * (slab ? 1.15 : 1);
      c.area = Math.max((b.max.x - b.min.x), (b.max.z - b.min.z)) * (b.max.y - b.min.y) * S * S;
    }
    this.y0 = y0; this.H = Math.max(M(0.5), y1 - y0);
    // who carries whom: a chunk on another (its bottom at the other's top, overlapping in plan); on the ground
    const near = (a, b, e) => a.box.min.x < b.box.max.x - e && a.box.max.x > b.box.min.x + e && a.box.min.z < b.box.max.z - e && a.box.max.z > b.box.min.z + e;
    const byY = [...this.chunks].sort((a, b) => a.box.min.y - b.box.min.y), e = M(0.02), gap = M(0.06);
    for (const c of this.chunks) { c.under = []; c.over = []; c.grounded = c.box.min.y < y0 + M(0.1); }
    for (const a of byY) for (const b of byY) if (b !== a && Math.abs(b.box.min.y - a.box.max.y) < gap && near(a, b, e)) { b.under.push(a); a.over.push(b); }
    // the panels: the roofs, the windows, the facades, the roof's proofing, the blind area — whole pieces
    this.panels = [];
    const panel = (o, sort) => {
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o); if (b.isEmpty() || !isFinite(b.min.x)) return;
      const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
      const p = { o, sort, box: b, c, parent: o.parent, local: o.matrix.clone(), auto: o.matrixAutoUpdate, free: false };
      this.root.attach(o); o.matrixAutoUpdate = false; o.updateMatrix();
      p.off = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z).multiply(o.matrix);
      const bd = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x * S, c.y * S, c.z * S).setLinearDamping(0.1).setAngularDamping(0.4));
      const hx = Math.max(0.02, sz.x * S / 2), hy = Math.max(0.02, sz.y * S / 2), hz = Math.max(0.02, sz.z * S / 2), dens = sort === 'roof' ? 120 : sort === 'window' ? 350 : sort === 'slab' ? 2400 : 60;
      const hd = o.userData?.hull && hullDesc(R, o.userData.hull, c);   // (a slab's piece: its own shape)
      W.createCollider((hd || R.ColliderDesc.cuboid(hx, Math.min(hy, sort === 'roof' ? hy : 0.4), hz)).setDensity(dens * (sort === 'roof' ? Math.min(1, 0.4 / hy) : 1)).setFriction(0.7), bd);
      p.body = bd; p.area = (sort === 'roof' ? sz.x * sz.z : Math.max(sz.x, sz.z) * sz.y) * S * S;
      p.under = this.chunks.filter((ch) => ch.box.max.x > b.min.x - M(0.05) && ch.box.min.x < b.max.x + M(0.05) && ch.box.max.z > b.min.z - M(0.05) && ch.box.min.z < b.max.z + M(0.05) && (sort === 'roof' ? ch.box.max.y > b.min.y - M(0.4) && ch.box.max.y < b.min.y + M(0.6) : ch.box.max.y > b.min.y && ch.box.min.y < b.max.y));
      p.cap = (sort === 'roof' ? 1300 : sort === 'window' ? 1800 : sort === 'slab' ? 1e9 : 2500) * (0.75 + 0.5 * rnd()) * (belt && sort === 'roof' ? 1.3 : 1);
      this.panels.push(p);
    };
    // (a flat roof on a slab shown in pieces: its build-up goes on the pieces — collapse.js — its own picture hidden)
    const pieced = (id) => { const b = app.objects.get(id); return b && isSlab(b) && b.fill > 0.5; };
    for (const g of [wv.roofs, wv.proofs]) if (g) for (const ch of [...g.children]) {
      let own = null; ch.traverse((o) => { if (own == null && o.userData?.uOwner != null) own = o.userData.uOwner; });
      const rr = own != null && g === wv.roofs ? app.objects.get(own) : null;
      if (rr?.slab && pieced(rr.slab)) { if (ch.visible) { ch.visible = false; this.hidden.push(ch); } continue; }
      const parts = ch.children.length > 1 && ch.children.length < 60 ? [...ch.children] : [ch]; for (const o of parts) panel(o, 'roof');
    }
    for (const ch of [...(wv.windows?.children || [])]) panel(ch, 'window');
    // (the slabs: their cast concrete is one mesh of the view, hidden — as pieces of their own, heavy, falling
    // when what carries them goes; the lifts stay out of it: a shaft that fails is shown by its own kind)
    const cut = new Set();
    for (const o of slabPieces(app.objects)) { panel(o, 'slab'); cut.add(o.userData.slab); }
    // (the cast concrete stays as it is — the foundation, the blind area, a slab not yet cast through; only the slabs
    // shown in pieces are taken out of it: hiding it all left their bars standing alone)
    const fg = wv.fill?.geometry, own = wv.owner?.fill;
    if (fg?.index && own && cut.size) {
      const a = fg.index.array, keep = [];
      for (let t = 0; t < a.length / 3; t++) if (!cut.has(own[t])) keep.push(a[3 * t], a[3 * t + 1], a[3 * t + 2]);
      this.fillIdx = [fg, fg.index]; fg.setIndex(keep);
    }
    // (the bars of the slabs in pieces went with them — their pieces show the stubs; drawn on, the cage hung in the air
    // over the heap. Hidden when all the cages are in cast concrete or in those slabs: no bare cage would go missing)
    const rv = app.rebarView?.group, cages = app.objects.all('cage');
    if (rv?.visible && cut.size && cages.every((c) => cut.has(c.beltId) || (app.objects.get(c.beltId)?.fill ?? 0) > 0.9)) { rv.visible = false; this.hidden.push(rv); }
    const liftGs = new Set(wv._liftG ? [...wv._liftG.values()] : []);
    for (const g of [wv.facades, wv.blinds, wv.rails]) if (g) for (const ch of [...g.children]) if (!liftGs.has(ch)) panel(ch, 'skin');
    // the scene of it: water, the funnel, the meteor; the sky and the sound
    this._setupFx();
    this.collapse = kind === 'shaft' ? new ShaftCollapse(this) : null;
    app.ui?.refresh();
    return this.stats();
  }

  stats() {
    const n = this.chunks?.length || 0, k = this.chunks?.filter((c) => c.free).length || 0, pr = this.panels?.filter((p) => p.sort === 'roof'), pw = this.panels?.filter((p) => p.sort === 'window');
    return { chunks: n, broken: k, share: n ? k / n : 0, roofs: pr?.length || 0, roofsGone: pr?.filter((p) => p.free).length || 0, windows: pw?.length || 0, windowsGone: pw?.filter((p) => p.free).length || 0, pieces: this.pieces?.length || 0 };
  }

  // ---- breaking free -------------------------------------------------------------------------------
  _free(c, vel = null) {
    if (c.free) return;
    c.free = true; this.broken++;
    c.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    const v = vel || this._groundVel || { x: 0, y: 0, z: 0 };
    c.body.setLinvel({ x: v.x + (rnd() - 0.5) * 0.3, y: v.y, z: v.z + (rnd() - 0.5) * 0.3 }, true);
    c.body.setAngvel({ x: (rnd() - 0.5) * 0.8, y: (rnd() - 0.5) * 0.4, z: (rnd() - 0.5) * 0.8 }, true);
    // (what it carried has one support less; nothing left under it — it comes down after it)
    for (const o of c.over) if (!o.free && !o.grounded && o.under.every((u) => u.free)) o.dropAt = this.t + 0.05 + rnd() * 0.25;
    const now = this.app.sfx?.ctx?.currentTime || 0;
    if (now - (this._crackT || 0) > 0.12) { this._crackT = now; this.app.sfx?.play?.(c.pieces[0].dens > 1000 ? 'debris' : 'brick', { vol: 0.6, at: c.c, gap: 0.08 }); }
    if (rnd() < 0.35) this.puffs?.emit('cloud', c.c.clone(), new THREE.Vector3(0, 0, 0), 1);
  }
  _freePanel(p, vel = null) {
    if (p.free) return;
    p.free = true;
    if (p.sort === 'skin') { p.o.visible = false; this.puffs?.emit('dust', p.c.clone(), new THREE.Vector3(0, 0, 0), 2); this.app.sfx?.play?.('debris', { vol: 0.5, at: p.c }); return; }
    p.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    if (vel) p.body.setLinvel(vel, true);
    this.app.sfx?.play?.(p.sort === 'window' ? 'glass_break' : 'wood_crack', { at: p.c, gap: 0.2 });
  }

  // ---- each frame ------------------------------------------------------------------------------------
  update(dt) {
    if (!this.on || !this.world) return;
    // (the show over and the heap at rest: its bodies no longer stepped — a heap of hundreds of hulls never quite
    // sleeps, its solver's jitter took a whole core while the ruins stood on the screen)
    if (this.done && this._rest()) { this._fxFrame(Math.min(dt, 1 / 30)); return; }
    dt = Math.min(dt, 1 / 30);
    const steps = dt > 1 / 45 ? 2 : 1, h = dt / steps;
    for (let k = 0; k < steps; k++) { this.t += h; this._load(h); this.world.timestep = h; this.world.step(); }
    this._draw();
    this._fxFrame(dt);
  }
  _rest() {
    if (this.resting) return true;
    if ((this._restN = (this._restN || 0) + 1) % 15) return false;
    let fast = 0;
    this.world.forEachRigidBody((b) => { if (fast || !b.isDynamic() || b.isSleeping()) return; const v = b.linvel(), w = b.angvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > 0.0025 || w.x * w.x + w.y * w.y + w.z * w.z > 0.09) fast++; });
    return (this.resting = !fast || this.t > CATS[this.kind].dur + 14);
  }
  // the catastrophe's strength now (0 … 1: it comes, holds, goes)
  get env() { const D = CATS[this.kind].dur, t = this.t; return Math.max(0, Math.min(1, t / 2, (D - t) / 3)); }
  _load(h) {
    const k = this.kind, p = this.power, env = this.env, R = this.R;
    if (k === 'shaft') { this.collapse?.load(h); return; }
    const dropNow = (c) => { if (!c.free && c.dropAt != null && this.t >= c.dropAt) this._free(c); };
    for (const c of this.chunks) dropNow(c);
    // (a panel whose walls are gone comes down)
    for (const pn of this.panels) if (!pn.free && pn.under.length && pn.under.filter((c) => c.free).length > pn.under.length * (pn.sort === 'roof' ? 0.35 : 0.3)) this._freePanel(pn);
    if (k === 'quake') {
      // the ground moves: two frequencies along x and z, a little up and down (PGA from the magnitude)
      const Mg = 4 + (p - 1) * 5 / 9, pga = 0.25 * Math.pow(10, 0.3 * (Mg - 6)) * env, A = 0.09 * pga, t = this.t;
      const off = { x: A * (Math.sin(t * 8.2) + 0.6 * Math.sin(t * 17.1 + 1)), y: 0.25 * A * Math.sin(t * 11.3), z: A * (Math.sin(t * 6.7 + 2) + 0.5 * Math.sin(t * 14.9)) };
      const prev = this._off || { x: 0, y: 0, z: 0 }; this._groundVel = { x: (off.x - prev.x) / h, y: (off.y - prev.y) / h, z: (off.z - prev.z) / h }; this._off = off;
      this.ground.setNextKinematicTranslation(off);
      for (const c of this.chunks) if (!c.free) c.body.setNextKinematicTranslation({ x: c.c.x * S + off.x, y: c.c.y * S + off.y, z: c.c.z * S + off.z });
      for (const pn of this.panels) if (!pn.free) pn.body.setNextKinematicTranslation({ x: pn.c.x * S + off.x, y: pn.c.y * S + off.y, z: pn.c.z * S + off.z });
      // demand: the acceleration, more the higher it stands (the house sways), against its strength
      for (const c of this.chunks) {
        if (c.free) continue;
        const hgt = (c.box.min.y - this.y0) / this.H, d = pga * (1 + 1.6 * hgt) * (c.over.length ? 1 : 1.25) * (0.7 + 0.6 * Math.abs(Math.sin(this.t * 5 + c.c.x * 30)));
        if (d > 0.9 * c.str && rnd() < h * 3 * (d / (0.9 * c.str) - 0.7)) this._free(c);
      }
      for (const pn of this.panels) if (!pn.free && pn.sort === 'window' && pga > 0.45 && rnd() < h * pga * 0.4) this._freePanel(pn);
      this.app.rig && (this.app.rig.shakeAmp = Math.min(1, pga * 1.5));
    } else if (k === 'hurricane' || k === 'tornado') {
      // the wind: its speed (m/s) and way at a place; the pressure on what faces it, the drag on what flies
      for (const c of this.chunks) {
        if (c.free) continue;
        const u = this._air(c.c), V = Math.hypot(u.x, u.z), q = 0.5 * 1.2 * (V * V + u.y * u.y) * 0.9;
        const exposed = !c.over.length || c.over.every((o) => o.free);
        const d = (q * c.area) / (c.mass * 9.81 * (exposed ? 1.2 : 3.5) * c.str) + (u.y > 20 ? u.y / 60 : 0);
        if (d > 1 && rnd() < h * 2 * (d - 0.8)) this._free(c, { x: u.x * 0.15, y: Math.max(0, u.y * 0.2), z: u.z * 0.15 });
      }
      for (const pn of this.panels) {
        if (pn.free) continue;
        const u = this._air(pn.c), q = 0.5 * 1.2 * (u.x * u.x + u.z * u.z + u.y * u.y), gust = 0.8 + 0.4 * Math.sin(this.t * 2.3 + pn.c.x * 40);
        if (q * gust * (pn.sort === 'roof' ? 0.85 : 1) > pn.cap) this._freePanel(pn, { x: u.x * 0.2, y: 2, z: u.z * 0.2 });
      }
      this._dragAll((pos) => this._air(pos), 1.2, h);
    } else if (k === 'tsunami' || k === 'flood') {
      for (const c of this.chunks) {
        if (c.free) continue;
        const w = this._water(c.c), sub = Math.max(0, Math.min(1, (w.y - c.box.min.y) / (c.box.max.y - c.box.min.y)));
        if (sub <= 0) continue;
        // (the current's drag; the water stands as high inside — through the doors — so its weight pushes little)
        const pr = 0.5 * 1000 * 1.6 * (w.u * w.u) + (k === 'flood' ? 0.04 * 1000 * 9.81 * Math.max(0, (w.y - c.box.min.y) * S) : 0);
        const d = pr * c.area * sub / (c.mass * 9.81 * 6 * c.str * (c.over.length ? 1.6 : 1));
        if (d > 1 && rnd() < h * 2 * (d - 0.8)) this._free(c, { x: w.vx * 0.4, y: 0, z: w.vz * 0.4 });
      }
      for (const pn of this.panels) if (!pn.free && pn.sort !== 'roof') { const w = this._water(pn.c); if (w.y > pn.box.min.y && (w.u > 2.5 || k === 'flood' && w.y > pn.c.y && rnd() < h * 0.3)) this._freePanel(pn, { x: w.vx * 0.3, y: 0, z: w.vz * 0.3 }); }
      this._dragWater(h);
    } else if (k === 'fire') {
      // what burns (the roofs, the frames, the facade's foam) burns down in turn; the heat cracks the masonry
      // over the openings (the lintels) and the top courses when it is fierce
      for (const pn of this.panels) {
        if (pn.free) continue;
        if (pn.burnAt == null) pn.burnAt = (pn.sort === 'window' ? 1 : pn.sort === 'skin' ? 2 : 4) + rnd() * (14 - p);
        pn.burn = Math.max(0, (this.t - pn.burnAt) / (6 + 8 * rnd()) * (0.4 + p / 10));
        if (pn.burn > 0 && !pn.charred) { pn.charred = true; this._char(pn.o); }
        if (pn.burn > 1 && (pn.sort !== 'skin' || p > 5)) this._freePanel(pn);
      }
      if (p > 5) for (const c of this.chunks) if (!c.free && (c.pieces[0].lintel || !c.over.length) && rnd() < h * 0.02 * (p - 5) * this.env) this._free(c);
    } else if (k === 'meteor') {
      const D = 0.2 + (p - 1) * 4.8 / 9, hit = 2.0;
      if (this.t >= hit && !this._hit) {
        this._hit = true;
        const at = this.target, Rb = M(4 + 6 * Math.pow(D, 0.9));
        this.app.sfx?.play?.('explosion', { vol: 1 }); this.app.rig && (this.app.rig.shakeAmp = Math.min(1, 0.3 + D * 0.25));
        for (const c of this.chunks) {
          const r = Math.max(M(0.5), c.c.distanceTo(at));
          if (r > Rb * 1.6) continue;
          if (r < Rb || rnd() < (Rb / r) ** 3) { const v = (24 * D) / (r * S + 1), dir = c.c.clone().sub(at).normalize(); this._free(c, { x: dir.x * v, y: 2 + v * 0.5, z: dir.z * v }); }
        }
        for (const pn of this.panels) if (pn.c.distanceTo(at) < Rb * 1.3) { const dir = pn.c.clone().sub(at).normalize(), v = (20 * D) / (pn.c.distanceTo(at) * S + 1); this._freePanel(pn, { x: dir.x * v, y: 3 + v * 0.4, z: dir.z * v }); }
        for (let i = 0; i < 40; i++) this.puffs?.emit('smoke', at.clone().add(new THREE.Vector3((rnd() - 0.5) * Rb, rnd() * Rb * 0.3, (rnd() - 0.5) * Rb)), new THREE.Vector3(0, 0, 0), 3);
      }
    }
    void R;
  }
  // the air at a place (m/s): the hurricane — one way with gusts, a little up over the roofs; the tornado —
  // a vortex moving across the plot (round it, in to it, up its middle)
  _air(pos) {
    const p = this.power, env = this.env;
    if (this.kind === 'hurricane') {
      const V = (33 + (p - 1) * 47 / 9) * env * (0.75 + 0.35 * Math.sin(this.t * 1.7 + pos.x * 3) * Math.sin(this.t * 0.9));
      const hgt = Math.max(0, (pos.y - this.y0) * S);
      return { x: V * this.wdir.x, y: hgt > 2 ? V * 0.12 : 0, z: V * this.wdir.z };
    }
    const Vm = (30 + (p - 1) * 65 / 9) * env, c = this.vortex, dx = (pos.x - c.x) * S, dz = (pos.z - c.z) * S, r = Math.hypot(dx, dz) + 0.1, rc = 6 + p * 1.2;
    const vt = r < rc ? Vm * r / rc : Vm * rc / r, vr = -0.35 * vt, vy = 0.7 * Vm * Math.exp(-((r / rc) ** 2));
    return { x: (-dz / r) * vt + (dx / r) * vr, y: vy, z: (dx / r) * vt + (dz / r) * vr };
  }
  // the water at a place: { y (its surface, model), u (m/s), vx, vz }
  _water(pos) {
    const w = this.waterAt(pos.x, pos.z);
    return { y: w.y, u: w.u, vx: w.u * this.wdir.x, vz: w.u * this.wdir.z };
  }
  waterAt(x, z) {
    const p = this.power, t = this.t, g0 = this.groundY;
    if (this.kind === 'flood') { const Hf = 0.2 + (p - 1) * 2.8 / 9, k = Math.min(1, t / 9) * Math.min(1, Math.max(0, (CATS.flood.dur + 6 - t) / 8)); return { y: g0 + M(Hf * k), u: (0.3 + Hf * 0.35) * k }; }
    const Hw = 0.5 + (p - 1) * 11.5 / 9, c = Math.sqrt(9.81 * Hw) * 0.9, s = (x - this.w0.x) * this.wdir.x + (z - this.w0.z) * this.wdir.z;   // (s: m along the way the wave goes, from where it starts)
    const front = (t - 1) * c, d = (front - s * S);   // (m behind the front)
    if (d < 0) return { y: g0 - M(0.5), u: 0 };
    const hgt = Hw * (d < 6 ? 0.6 + 0.4 * Math.sin(Math.min(1, d / 6) * Math.PI / 2) : Math.max(0.35, 1 - (d - 6) / (c * 10))) * Math.min(1, Math.max(0, (CATS.tsunami.dur + 8 - t) / 10));
    return { y: g0 + M(hgt), u: c * (d < 6 ? 1.1 : 0.75) * Math.min(1, hgt / Hw * 1.5) };
  }
  // the drag of the air on every free piece (and the panels flying)
  _dragAll(air, rho, h) {
    const go = (b, area) => {
      if (!b.isDynamic()) return;
      const t = b.translation(), u = air({ x: t.x / S, y: t.y / S, z: t.z / S }), v = b.linvel(), rx = u.x - v.x, ry = u.y - v.y, rz = u.z - v.z, rv = Math.hypot(rx, ry, rz), k = 0.5 * rho * 1.1 * area * rv * h;
      if (rv > 1) b.applyImpulse({ x: rx * k, y: ry * k, z: rz * k }, true);
    };
    for (const c of this.chunks) if (c.free) go(c.body, c.area * 0.6);
    for (const p of this.panels) if (p.free && p.sort !== 'skin') go(p.body, Math.min(p.area, 8));
  }
  // the water on what is free in it: the drag of its current, the buoyancy (wood floats, masonry does not)
  _dragWater(h) {
    const go = (b, area, vol) => {
      if (!b.isDynamic()) return;
      const t = b.translation(), w = this._water({ x: t.x / S, y: t.y / S, z: t.z / S });
      if (w.y * S < t.y) return;
      const v = b.linvel(), rx = w.vx - v.x, rz = w.vz - v.z, rv = Math.hypot(rx, rz), k = 0.5 * 1000 * 1.0 * area * rv * h;
      b.applyImpulse({ x: rx * k, y: 1000 * 9.81 * vol * h, z: rz * k }, true);
      b.setLinearDamping(1.5);
    };
    for (const c of this.chunks) if (c.free) go(c.body, c.area * 0.5, c.mass / Math.max(600, c.pieces[0].dens));
    for (const p of this.panels) if (p.free && p.sort !== 'skin') go(p.body, Math.min(p.area, 8), p.body.mass() / 300);
  }
  // burnt: black and dull
  _char(o) {
    o.traverse((m) => {
      if (!m.isMesh) return;
      if (!m.userData._mat0) m.userData._mat0 = m.material;
      const ms = Array.isArray(m.material) ? m.material : [m.material];
      m.material = ms.map((x) => { const c = x.clone(); c.color?.multiplyScalar(0.18); if (c.map) c.color?.setRGB(0.12, 0.1, 0.09); c.roughness = 1; c.metalness = 0; c.emissive?.setRGB(0.25, 0.06, 0); return c; });
      if (m.material.length === 1) m.material = m.material[0];
      (this._charred ||= []).push(m);
    });
  }

  // ---- drawing -----------------------------------------------------------------------------------------
  _draw() {
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), B = new THREE.Matrix4(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), dirty = new Set();
    this.collapse?.drawCarried();
    for (const c of this.chunks) {
      if ((!c.free && this.kind !== 'quake') || c.carry) continue;
      if (c.free && c.body.isSleeping() && c.drawn) continue;
      const t = c.body.translation(), r = c.body.rotation(); P.set(t.x / S, t.y / S, t.z / S); Q.set(r.x, r.y, r.z, r.w); B.compose(P, Q, one);
      for (const pc of c.pieces) { m.multiplyMatrices(B, pc.local); pc.cl.setMatrixAt(pc.i, m); dirty.add(pc.cl); }
      c.drawn = c.body.isSleeping();
    }
    for (const cl of dirty) cl.instanceMatrix.needsUpdate = true;
    for (const p of this.panels) {
      if ((p.sort === 'skin' && this.kind !== 'shaft') || (!p.free && this.kind !== 'quake') || p.carry || p.gone) continue;
      const t = p.body.translation(), r = p.body.rotation(); P.set(t.x / S, t.y / S, t.z / S); Q.set(r.x, r.y, r.z, r.w);
      p.o.matrix.multiplyMatrices(B.compose(P, Q, one), p.off); p.o.matrixWorldNeedsUpdate = true;
    }
  }

  // ---- the scene: the water, the funnel, the meteor, the fire, the sky -------------------------------------
  _setupFx() {
    const app = this.app, t = app.terrain, k = this.kind, sfx = app.sfx;
    this.groundY = t.heightAt(0, 0);
    const box = new THREE.Box3(); for (const c of this.chunks) box.union(c.box);
    this.centre = box.isEmpty() ? new THREE.Vector3(0, this.groundY, 0) : box.getCenter(new THREE.Vector3());
    const a = rnd() * Math.PI * 2; this.wdir = { x: Math.cos(a), z: Math.sin(a) };
    this.w0 = { x: this.centre.x - this.wdir.x * M(40), z: this.centre.z - this.wdir.z * M(40) };
    this.vortex = new THREE.Vector3(this.centre.x - this.wdir.x * M(35), this.groundY, this.centre.z - this.wdir.z * M(35));
    this.target = this.centre.clone().add(new THREE.Vector3((rnd() - 0.5) * M(3), 0, (rnd() - 0.5) * M(3))); this.target.y = this.groundY;
    const loop = { quake: 'quake', hurricane: 'hurricane', tornado: 'tornado', tsunami: 'waves', flood: 'flood', fire: 'fire', meteor: null }[k];
    this.loopName = loop;
    if (k === 'hurricane' || k === 'tornado' || k === 'flood') { this._sky = app.settings.weather; app.settings.weather = 'rain'; app.applySettings?.(); }
    if (k === 'tsunami' || k === 'flood') {
      // the water: a sheet over the plot, its surface from waterAt; foam on its front
      const W = (t.halfX * 2 + M(60)), Hh = (t.halfZ * 2 + M(60)), g = new THREE.PlaneGeometry(W, Hh, 80, 80); g.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: k === 'flood' ? 0x5b4a32 : 0x2f5a66, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.86, side: THREE.DoubleSide });
      this.water = new THREE.Mesh(g, mat); this.water.frustumCulled = false; this.water.renderOrder = 4; this.root.add(this.water);
    }
    if (k === 'tornado') {
      // the funnel: a tall turning cone of dust and cloud, thin at the ground
      const g = new THREE.CylinderGeometry(M(30), M(3), M(120), 32, 20, true); g.translate(0, M(60), 0);
      const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
      for (let i = 0; i < 900; i++) { const v = 60 + Math.random() * 90 | 0; x.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.05 + Math.random() * 0.12})`; x.fillRect(Math.random() * 128, Math.random() * 256, 4 + Math.random() * 30, 1 + Math.random() * 4); }
      const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(3, 1);
      this.funnel = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, color: 0x8a8478 }));
      this.root.add(this.funnel);
    }
    if (k === 'meteor') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(M(0.3 + this.power * 0.12), 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb060 }));
      const tail = new THREE.Mesh(new THREE.ConeGeometry(M(0.6 + this.power * 0.2), M(14), 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.6, depthWrite: false }));
      tail.rotation.x = Math.PI; tail.position.y = M(7); m.add(tail);
      this.meteor = m; this.root.add(m); sfx?.play?.('fire', { vol: 0.5 });
    }
  }
  _fxFrame(dt) {
    const app = this.app, k = this.kind, env = this.env, sfx = app.sfx;
    if (this.loopName) sfx?.loop?.('disaster', this.loopName, Math.max(0.15, env) * (0.5 + this.power / 20), 1, null, true);
    if (this.water) {
      const pos = this.water.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), w = this.waterAt(x, z); pos.setY(i, w.y + (k === 'tsunami' ? M(0.15) * Math.sin(x * 40 + this.t * 3) : M(0.03) * Math.sin(x * 60 + z * 40 + this.t * 2))); }
      pos.needsUpdate = true; this.water.geometry.computeVertexNormals();
    }
    if (this.funnel) {
      const sp = M(9 + this.power * 0.6) * dt;
      if (this.t > 1) this.vortex.add(new THREE.Vector3(this.wdir.x * sp, 0, this.wdir.z * sp));
      this.funnel.position.copy(this.vortex); this.funnel.rotation.y += dt * 4; this.funnel.material.opacity = 0.85 * Math.max(0.1, env);
      if (Math.random() < 0.6) this.puffs?.emit('dust', this.vortex.clone().add(new THREE.Vector3((Math.random() - 0.5) * M(8), 0, (Math.random() - 0.5) * M(8))), new THREE.Vector3(0, 0, 0), 3);
    }
    if (this.meteor) {
      const f = Math.min(1, this.t / 2), from = this.target.clone().add(new THREE.Vector3(M(-60), M(90), M(-30)));
      this.meteor.position.lerpVectors(from, this.target, f); this.meteor.lookAt(this.target); this.meteor.rotateX(-Math.PI / 2);
      this.meteor.visible = f < 1;
    }
    if (k === 'fire') for (const p of this.panels) if (p.burn > 0 && p.burn < 1.6 && Math.random() < 0.5) this.puffs?.emit(Math.random() < 0.55 ? 'flame' : 'soot', p.c.clone().add(new THREE.Vector3((Math.random() - 0.5) * (p.box.max.x - p.box.min.x), (p.box.max.y - p.box.min.y) * 0.5, (Math.random() - 0.5) * (p.box.max.z - p.box.min.z))), new THREE.Vector3(0, 0, 0), 2.5);
    if (k === 'quake' && env > 0.3 && Math.random() < 0.1 * env) this.puffs?.emit('dust', this.centre.clone().add(new THREE.Vector3((Math.random() - 0.5) * M(10), 0, (Math.random() - 0.5) * M(10))), new THREE.Vector3(0, 0, 0), 1.5);
    this.collapse?.fx(dt);
    this.puffs?.update(dt);
    if (this.t > CATS[k].dur + 6 && !this.done) { this.done = true; if (this.app.rig) this.app.rig.shakeAmp = 0; app.ui?.refresh(); }
  }

  // ---- as it was ---------------------------------------------------------------------------------------
  stop() {
    if (!this.on) return;
    const app = this.app, wv = app.wallView;
    this.clones = [];
    for (const m of this.hidden || []) m.visible = true;
    if (this.fillIdx) { const [fg, ix] = this.fillIdx; if (this.app.wallView.fill.geometry === fg) fg.setIndex(ix); this.fillIdx = null; }
    this.collapse?.stop(); this.collapse = null;
    for (const p of this.panels || []) {
      p.o.visible = true;
      if (!p.parent) { p.o.geometry?.dispose(); continue; }   // (a slab's piece: made for the show)
      p.parent.add(p.o); p.o.matrix.copy(p.local); p.o.matrix.decompose(p.o.position, p.o.quaternion, p.o.scale); p.o.matrixAutoUpdate = p.auto; p.o.updateMatrixWorld(true);
    }
    for (const m of this._charred || []) if (m.userData._mat0) { m.material = m.userData._mat0; delete m.userData._mat0; }   // (the real materials back)
    app.scene.remove(this.root); this.root = null;
    this.world?.free(); this.world = null;
    wv.frozen = false; wv.dirty = true; wv.roofDirty = wv.facadeDirty = true;
    if (this._sky !== undefined) { app.settings.weather = this._sky; app.applySettings?.(); this._sky = undefined; }
    if (app.rig) app.rig.shakeAmp = 0;
    app.sfx?.loop?.('disaster', this.loopName || 'quake', 0);
    this.on = false; this.chunks = this.panels = this.pieces = []; this._charred = null; this._hit = false; this._off = null;
    app.ui?.refresh();
  }
}
