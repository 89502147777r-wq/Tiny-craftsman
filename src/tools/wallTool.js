import * as THREE from 'three';
import { MODEL_SCALE, K, KT } from '../config.js';
import { KINDS, OPENINGS, axis, rows, rowY, course, slotPose, wallState, taken, cutName, openingRows, beddable, layable, palletStock, level, topY } from '../world/walls.js';
import { Episode, loadPhysics, physicsReady } from '../world/physics.js';

// Walls (aerated concrete blocks or bricks of ½ … 2½ bricks), as on site:
//   lay    – take a block (brick) from the tray or the pallet and carry it: onto a wall
//            it snaps to the nearest free place that has masonry under it; onto the edge
//            of the foundation (a slab or a strip) the first block starts a wall along that
//            edge, from corner to corner; onto the top of a wall of another material it
//            starts a tier on it (a brick plinth → the blockwork → …)
//   line   – (optional) drag the axis of a wall over the foundation (ends snap to other walls'
//            ends → a corner, and to the axes)
//   opening– drag along a wall: a window / door opening (a lintel goes over it)
//   lay    – take a block (brick, lintel) from the pallet beside the wall and carry it
//            to the wall: it snaps to the nearest free place of the course being laid
//            (found on the screen — no need to hit the wall exactly), the mortar under
//            it shows; let go — the mortar is spread, the block is set down, settles
//            (physics) and is tapped level with the mallet. Let go away from the wall —
//            it goes back on the pallet.
//   delete – tap a unit to take it off (if nothing lies on it); tap an empty wall line
//            to remove it
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();

export class WallTool {
  constructor(app) {
    this.app = app;
    this.mode = 'lay';
    this.drag = null;
    // the tray of blocks in the corner of the screen: drag a block out of it onto a wall
    // (the pallet by the wall may be out of the picture)
    this.tray = typeof document !== 'undefined' ? document.getElementById('wall-tray') : null;
    if (this.tray) {
      // the point under the finger: on the masonry when it is over it (else the ground behind it)
      const g = (e) => this._pt(app.gestures.ground(e.clientX, e.clientY) || this._lastP || new THREE.Vector3(), e);
      this.tray.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.mode !== 'lay' || app.physJob || app.physLoading) return;
        const w = this._trayWall();
        try { this.tray.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
        this.carry = { kind: this.kind, pallet: w, snap: null, tray: true };
        this.tray.classList.add('active');
        loadPhysics().catch(() => {});
        this._carryMove(g(e), e);
      });
      this.tray.addEventListener('pointermove', (e) => { if (this.carry?.tray) { e.preventDefault(); this._carryMove(g(e), e); } });
      this.tray.addEventListener('pointerup', (e) => { if (this.carry?.tray) { e.preventDefault(); this.tray.classList.remove('active'); this._carryDrop(); } });
      this.tray.addEventListener('pointercancel', () => { if (this.carry?.tray) { this.tray.classList.remove('active'); this._carryCancel(); } });
    }
  }

  get busy() { return !!this.drag || !!this.carry; }
  // one finger works on the wall in every mode (the camera: two fingers)
  blocksOrbit() { return true; }

  setMode(m) {
    this.mode = m;
    if (m === 'lay') {
      loadPhysics().catch(() => {});
      // walls laid out before the pallets existed get theirs now
      const bare = this.app.objects.all('wall').filter((w) => !w.pallet);
      if (bare.length) this.app.journal.act('pallets', {}, this.app.clock, () => { for (const w of bare) this.app.objects.update(w.id, { pallet: this._palletSpot(w) }); });
    }
    this.app.ui.refresh();
    this._focus();
  }
  get kind() { return this.app.settings.wallKind || 'block'; }
  get openKind() { return this.app.settings.openKind || 'window'; }

  // the wall nearest to a point (within reach), with the position along it (real mm)
  nearest(p, reach = 0.035 * KT) {
    let best = null;
    for (const w of this.app.objects.all('wall')) {
      const ax = axis(w), dx = p.x - w.a[0], dz = p.z - w.a[1];
      const s = (dx * ax.ux + dz * ax.uz) / S, d = Math.abs(dx * ax.nx + dz * ax.nz);
      if (s < -200 || s > ax.L + 200) continue;
      // the wall being worked on wins at a corner (the finger is as near to the other one)
      const dd = (w.id === this.lastWall ? d - 0.012 : d) - level(w, this.app.objects.all('wall')) * 0.004;   // the upper tier first
      if (d < reach && (!best || dd < best.dd)) best = { w, s, d, dd };
    }
    return best;
  }

  // the next course (ghost places + cord) is shown while spreading mortar and laying
  _focus(w) {
    const v = this.app.wallView;
    v.marks = true;
    v.focus = this.mode === 'lay' ? (w ? w.id : this.lastWall ?? null) : null;
    v.dirty = true;
  }

  // the point under the finger: on the wall itself (blocks, mortar, the ghost places)
  // when the finger is on it — the ground point behind a wall would miss it
  _pt(p, e) {
    if (!e || e.clientX === undefined || (!e.clientX && !e.clientY)) return p;
    const app = this.app, v = app.wallView;
    _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
    // laid masonry only (not the unit in the hand, not the stacks on the pallets)
    const hit = _ray.intersectObjects([v.blocks, v.bricks, v.lintels, v.mortar, v.frames], false).find((h) => h.object === v.mortar || h.object === v.frames || v.ownerOf(h) != null);
    return hit ? hit.point.clone() : p;
  }

  down(p, e) {
    const app = this.app;
    p = this._pt(p, e);
    if (this.mode === 'line') {
      this.drag = { a: this._snap([p.x, p.z]), b: [p.x, p.z] };
      return true;
    }
    if (this.mode === 'opening') {
      const n = this.nearest(p);
      if (!n) { app.ui.toast('Ведите вдоль стены — от одного края проёма до другого'); return true; }
      this.drag = { w: n.w, s0: n.s, s1: n.s, a: n.s };
      this.lastWall = n.w.id;
      return true;
    }
    if (this.mode === 'lay') {
      if (app.physJob || app.physLoading) return true;   // the last one is still being set
      const w = this._palletAt(e, p);
      if (!w) { app.ui.toast('Тяните блок из лотка справа (или с поддона у стены) — на край фундамента или на стену'); return true; }
      this.carry = { kind: w.kind, pallet: w, p: p.clone(), snap: null };
      app.settings.wallKind = w.kind;
      this.lastWall = w.id; this._focus(w);
      loadPhysics().catch(() => {});
      app.sfx?.stab?.();
      this._carryMove(p, e);
      return true;
    }
    if (this.mode === 'delete') { this._delete(p, e); return true; }
    return false;
  }

  move(p, e) {
    const app = this.app;
    p = this._pt(p, e);
    if (this.carry) { this._carryMove(p, e); return; }
    if (!this.drag) return;
    if (this.mode === 'line') {
      this.drag.b = this._snap([p.x, p.z], this.drag.a);
      const L = Math.hypot(this.drag.b[0] - this.drag.a[0], this.drag.b[1] - this.drag.a[1]) * MODEL_SCALE;
      app.ui.showMeasure(`${L.toFixed(2)} м`);
      this._preview();
    } else if (this.mode === 'opening') {
      const d = this.drag, ax = axis(d.w);
      const s = ((p.x - d.w.a[0]) * ax.ux + (p.z - d.w.a[1]) * ax.uz) / S;
      d.s0 = Math.round(Math.min(d.a, s) / 50) * 50; d.s1 = Math.round(Math.max(d.a, s) / 50) * 50;
      app.ui.showMeasure(`${OPENINGS[this.openKind].name}: ${(d.s1 - d.s0) / 1000} м`.replace('.', ','));
      this._showOpening();
    }
  }

  up() {
    const app = this.app, d = this.drag;
    if (this.carry) { this._carryDrop(); return; }
    this.drag = null;
    app.ui.hideMeasure();
    this._preview(true);
    if (!d) return;
    if (this.mode === 'line') {
      const L = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
      if (L < 0.3 / MODEL_SCALE) { app.ui.toast('Стена короче 30 см — проведите длиннее'); return; }
      const rec = { type: 'wall', a: d.a.map((x) => +x.toFixed(5)), b: d.b.map((x) => +x.toFixed(5)), kind: this.kind, height: app.settings.wallHeight || 1500 };
      rec.base = +this._baseOf(rec).toFixed(5);
      rec.pallet = this._palletSpot(rec);
      const w = app.journal.act('wall-line', { kind: rec.kind }, app.clock, () => app.objects.add(rec));
      const added = app.objects.all('wall').at(-1);
      this.lastWall = added?.id; this._focus(added);
      app.ui.toast(`${KINDS[rec.kind].name}: стена ${(L * MODEL_SCALE).toFixed(2).replace('.', ',')} м, ${rows(rec)} рядов. Рядом поддон — «Класть»: берите блок и несите к стене`);
      void w;
    } else if (this.mode === 'opening') {
      this._showOpening(true);
      this._addOpening(d);
    }
  }

  interrupt() { this.drag = null; if (this.carry) this._carryCancel(); this._preview(true); this.app.ui.hideMeasure(); }

  update() {}

  // ---- line ----------------------------------------------------------------------------
  _snap(q, from) {
    let [x, z] = q;
    // to another wall's end (a corner) …
    for (const w of this.app.objects.all('wall')) for (const e of [w.a, w.b]) if (Math.hypot(e[0] - x, e[1] - z) < 0.04) return [e[0], e[1]];
    // … else along the axes from the start
    if (from) {
      const dx = x - from[0], dz = z - from[1], ang = Math.atan2(dz, dx), k = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(ang - k) < 0.12) { const L = Math.hypot(dx, dz); x = from[0] + Math.cos(k) * L; z = from[1] + Math.sin(k) * L; }
    }
    return [x, z];
  }

  // the foundation under the wall: its highest point (the first bed evens out the rest)
  _baseOf(w) {
    const t = this.app.terrain, ax = axis(w), half = KINDS[w.kind].T / 2 * S;
    let m = -Infinity;
    for (let s = 0; s <= ax.L; s += 20) for (const o of [-half, 0, half]) {
      const x = w.a[0] + ax.ux * s * S + ax.nx * o, z = w.a[1] + ax.uz * s * S + ax.nz * o;
      if (t.inside(x, z)) m = Math.max(m, t.heightAt(x, z));
    }
    return Number.isFinite(m) ? m : 0.1;
  }

  _preview(off) {
    const v = this.app.wallView;
    if (off || !this.drag || this.mode !== 'line') { if (this._line) this._line.visible = false; return; }
    if (!this._line) {
      this._line = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x7fd18a, transparent: true, opacity: 0.35, depthWrite: false }));
      v.group.add(this._line);
    }
    const { a, b } = this.drag, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-4) return;
    const T = KINDS[this.kind].T * S, h = 0.01;
    const y = this.app.terrain.heightAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    this._line.visible = true;
    this._line.position.set((a[0] + b[0]) / 2, y + h / 2, (a[1] + b[1]) / 2);
    this._line.rotation.set(0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), 0);
    this._line.scale.set(L, h, T);
  }

  // the mortar being spread (drawn as a bed record in the view)
  _showBed() {
    const v = this.app.wallView;
    v.liveBed = this._liveBed && this.drag ? { wall: this.drag.w.id, row: this.drag.row, ...this._liveBed } : null;
    v.dirty = true;
  }

  // ---- openings ------------------------------------------------------------------------
  // a door / window opening: its width is dragged along the wall, its height is the
  // standard one snapped to the courses; it needs room for the lintel's bearing each side
  _addOpening(d) {
    const app = this.app, w = d.w, k = KINDS[w.kind], o = OPENINGS[this.openKind], ax = axis(w);
    const width = d.s1 - d.s0;
    if (width < o.minW) { app.ui.toast(`${o.name}: проведите шире — не меньше ${o.minW} мм`); return; }
    if (d.s0 < 250 || d.s1 > ax.L - 250) { app.ui.toast('До угла нужно ≥ 250 мм — там опирается перемычка'); return; }
    const rec = { type: 'opening', wall: w.id, kind: this.openKind, s0: d.s0, s1: d.s1, y0: o.y0, y1: o.y1 };
    const { l1 } = openingRows(w, rec);
    if (l1 > rows(w)) { app.ui.toast(`Стена низкая для ${this.openKind === 'door' ? 'двери' : 'окна'} с перемычкой — нужна высота 2,7 м`); return; }
    const others = app.objects.all('opening').filter((x) => x.wall === w.id);
    if (others.some((x) => x.s0 < d.s1 + 500 && x.s1 > d.s0 - 500)) { app.ui.toast('Между проёмами нужен простенок ≥ 500 мм'); return; }
    // masonry already there?
    const { r0, r1 } = openingRows(w, rec);
    if (app.objects.all('unit').some((u) => u.wall === w.id && u.row >= r0 && u.row < l1 && u.s0 < d.s1 && u.s1 > d.s0)) {
      app.ui.toast('Здесь уже выложено — проём размечают до кладки этих рядов'); return;
    }
    app.journal.act('opening', { wall: w.id, kind: rec.kind }, app.clock, () => app.objects.add(rec));
    app.ui.toast(`${o.name} ${width} мм: ряды ${r0 + 1}–${r1}, перемычка в ряду ${r1 + 1}`);
    void k;
  }

  _showOpening(off) {
    const v = this.app.wallView;
    v.liveOpening = off || !this.drag ? null : { wall: this.drag.w.id, kind: this.openKind, s0: this.drag.s0, s1: this.drag.s1, y0: OPENINGS[this.openKind].y0, y1: OPENINGS[this.openKind].y1 };
    v.dirty = true;
  }

  // ---- lay: carry from the pallet -------------------------------------------------------
  // the pallet of a new wall: beside its middle, on the side the camera sees (or, for a
  // building already started, outside it), on the plot
  _palletSpot(w) {
    // beyond an end of the wall and a little to the side the camera sees: within reach,
    // but it never stands between the camera and the wall
    const app = this.app, t = app.terrain, ax = axis(w), k = KINDS[w.kind];
    const cam = app.camera.position, side = (cam.x - w.a[0]) * ax.nx + (cam.z - w.a[1]) * ax.nz >= 0 ? 1 : -1;
    const along = 900 * S, aside = (k.T / 2 + 500) * S, yaw = +Math.atan2(-ax.uz, ax.ux).toFixed(4);
    const walls = app.objects.all('wall').filter((o) => o.id !== w.id);
    const clear = (x, z) => t.inside(x, z) && walls.every((o) => { const oa = axis(o), dx = x - o.a[0], dz = z - o.a[1], s = (dx * oa.ux + dz * oa.uz) / S; return s < -700 || s > oa.L + 700 || Math.abs(dx * oa.nx + dz * oa.nz) > 0.2; });
    const cands = [
      [w.a[0] - ax.ux * along + ax.nx * aside * side, w.a[1] - ax.uz * along + ax.nz * aside * side],
      [w.b[0] + ax.ux * along + ax.nx * aside * side, w.b[1] + ax.uz * along + ax.nz * aside * side],
      [w.a[0] - ax.ux * along - ax.nx * aside * side, w.a[1] - ax.uz * along - ax.nz * aside * side],
      [w.b[0] + ax.ux * along - ax.nx * aside * side, w.b[1] + ax.uz * along - ax.nz * aside * side],
      [(w.a[0] + w.b[0]) / 2 + ax.nx * (aside + 0.2) * side, (w.a[1] + w.b[1]) / 2 + ax.nz * (aside + 0.2) * side],
    ];
    const c = cands.find(([x, z]) => clear(x, z)) || cands.find(([x, z]) => t.inside(x, z)) || cands[4];
    return [+c[0].toFixed(5), +c[1].toFixed(5), yaw];
  }

  _screen(v) {
    const r = this.app.renderer.domElement.getBoundingClientRect(), q = v.clone().project(this.app.camera);
    return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height, front: q.z < 1 };
  }

  // the pallet under the finger (on the screen, generous)
  _palletAt(e, p) {
    let best = null, bd = Infinity;
    for (const w of this.app.objects.all('wall')) {
      if (!w.pallet) continue;
      const c = new THREE.Vector3(w.pallet[0], this.app.terrain.heightAt(w.pallet[0], w.pallet[1]) + 0.06, w.pallet[1]);
      let d;
      if (e && (e.clientX || e.clientY)) { const sp = this._screen(c); d = Math.hypot(sp.x - e.clientX, sp.y - e.clientY); if (d > 80) continue; }
      else { d = Math.hypot(p.x - c.x, p.z - c.z) * 1000; if (d > 0.09 * 1000) continue; }
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  // the free place of a course being laid nearest the finger on the screen (≤ 90 px)
  // (any course: a course may run ahead over the part of the one below already laid);
  // only walls of the material carried
  _snapTo(e, p) {
    const app = this.app, kind = this.carry?.kind;
    let best = null, bd = Infinity;
    for (const w of app.objects.all('wall')) {
      if (kind && w.kind !== kind) continue;
      const st = wallState(w, app.objects);
      if (st.cur >= st.n) continue;
      const k = KINDS[w.kind];
      for (const { r, sl } of layable(w, st)) {
        const pose = slotPose(w, r, sl), top = pose.p.clone(); top.y = rowY(w, r) + k.H * S;
        let d;
        if (e && (e.clientX || e.clientY)) { const sp = this._screen(top); if (!sp.front) continue; d = Math.hypot(sp.x - e.clientX, sp.y - e.clientY); if (d > 90) continue; }
        else { d = Math.hypot(p.x - top.x, p.z - top.z) * 3500; if (d > 400) continue; }
        if (w.id === this.lastWall) d -= 6;
        d += (r - st.cur) * 2;   // the lower course first, when two are as near
        if (d < bd) { bd = d; best = { w, r, sl, st, pose }; }
      }
    }
    return best || (kind ? this._newWall(p, kind, e) : null);
  }

  // where a new wall would go. On the top of a wall of another material: a tier on it.
  // Else on the surface under the finger (a slab, a strip, the ground): near an edge of
  // it the wall runs along that edge, its outer face flush with it; further in it is a
  // partition, running across to the nearest edge or wall face (both ways, up to the
  // edges of the surface and the faces of the walls it meets). «Повернуть» turns it.
  // The first place of it nearest the finger. (A virtual wall record: added when the
  // block is let go.)
  _newWall(p, kind, e) {
    const app = this.app, walls = app.objects.all('wall'), k = KINDS[kind];
    const seg = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / l2)); return Math.hypot(a[0] + dx * t - p.x, a[1] + dz * t - p.z); };
    // tiers: on what is laid of a wall of another material (nothing on it yet): the
    // courses not laid yet are dropped from it — the new material goes on from here
    let tier = null, bd = Infinity, tierP = null, tp = null;
    for (const w0 of walls) {
      if (w0.kind === kind || walls.some((o) => o.on === w0.id)) continue;
      tp = null;
      const k0 = KINDS[w0.kind], laid = app.objects.all('unit').filter((u) => u.wall === w0.id);
      if (!laid.length) continue;
      const nl = Math.max(...laid.map((u) => u.row + (u.lintel ? k0.lintelRows : 1)));
      const cap = { ...w0, height: k0.bed0 + nl * (k0.H + k0.bed) };
      // near the top of what is laid: on the screen (the finger over its top edge), or in the plot
      const ty = topY(cap);
      let d = Infinity;
      if (e && (e.clientX || e.clientY)) {
        const A = this._screen(new THREE.Vector3(w0.a[0], ty, w0.a[1])), B = this._screen(new THREE.Vector3(w0.b[0], ty, w0.b[1]));
        const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((e.clientX - A.x) * dx + (e.clientY - A.y) * dy) / l2));
        const ds = Math.hypot(A.x + dx * t - e.clientX, A.y + dy * t - e.clientY);
        if (A.front && B.front && ds < 45) { d = ds / 1e4; tp = [w0.a[0] + (w0.b[0] - w0.a[0]) * t, w0.a[1] + (w0.b[1] - w0.a[1]) * t]; }
      }
      if (d === Infinity) { const dw = seg(w0.a, w0.b); if (dw < k0.T / 2 * S + 0.01 && p.y > ty - 0.03) d = dw; }
      if (d < bd) { bd = d; tier = cap; tierP = tp; }
    }
    let rec;
    if (tier) rec = { a: tier.a, b: tier.b, on: tier.id, base: topY(tier) };
    else {
      const run = this._run(p, k);
      if (!run) return null;
      rec = { a: run.a, b: run.b };
    }
    rec = { type: 'wall', id: app.objects.nextId, a: rec.a.map((x) => +x.toFixed(5)), b: rec.b.map((x) => +x.toFixed(5)), kind, height: app.settings.wallHeight || 1500, ...(rec.on ? { on: rec.on, base: +rec.base.toFixed(5) } : {}) };
    if (!rec.on) rec.base = +this._baseOf(rec).toFixed(5);
    const extra = tier ? [rec, tier] : [rec], st = wallState(rec, app.objects, extra), ax = axis(rec);
    const px = tierP ? tierP[0] : p.x, pz = tierP ? tierP[1] : p.z;
    const s = ((px - rec.a[0]) * ax.ux + (pz - rec.a[1]) * ax.uz) / S;
    let pick = null, pd = Infinity;
    for (const { r, sl } of layable(rec, st)) { if (r) continue; const d = Math.abs((sl.s0 + sl.s1) / 2 - s); if (d < pd) { pd = d; pick = sl; } }
    if (!pick) return null;
    return { w: rec, r: 0, sl: pick, st, pose: slotPose(rec, 0, pick), create: true, cap: tier && tier.height !== walls.find((o) => o.id === tier.id).height ? { id: tier.id, height: tier.height } : null };
  }

  // the run of a new wall through p on the surface there (see _newWall): { a, b } or null
  _run(p, k) {
    const app = this.app, t = app.terrain, walls = app.objects.all('wall').filter((w) => !w.on), T = k.T * S;
    if (!t.inside(p.x, p.z)) return null;
    const conc = (x, z) => t.conc[t.index(x, z)] > 1e-4;
    const onConc = conc(p.x, p.z), h0 = t.heightAt(p.x, p.z);
    // the same surface: concrete stays concrete; any surface: no step up or down
    const same = (x, z) => t.inside(x, z) && (!onConc || conc(x, z)) && Math.abs(t.heightAt(x, z) - h0) < (onConc ? 0.012 : 0.005);
    const far = (onConc ? 15 : 1.5) / MODEL_SCALE, st = t.cell * 0.75;
    // how far the surface goes from q along (dx, dz), and where a wall face stops it
    const reach = (q, dx, dz) => {
      let d = 0;
      while (d < far && same(q.x + dx * (d + st), q.z + dz * (d + st))) d += st;
      let edge = d < far, wall = Infinity, hit = null;
      for (const w of walls) {
        const ax = axis(w), den = dx * ax.nx + dz * ax.nz;
        if (Math.abs(den) < 0.5) continue;   // parallel: does not stop it
        const dist = -((q.x - w.a[0]) * ax.nx + (q.z - w.a[1]) * ax.nz) / den;   // to its axis
        const face = dist - KINDS[w.kind].T / 2 * S / Math.abs(den);
        if (face < -1e-4 || face >= Math.min(d, wall)) continue;
        const x = q.x + dx * dist, z = q.z + dz * dist, along = ((x - w.a[0]) * ax.ux + (z - w.a[1]) * ax.uz) / S;
        if (along < -KINDS[w.kind].T / 2 - 50 || along > ax.L + KINDS[w.kind].T / 2 + 50) continue;
        wall = face;
        // at the end of that wall: a corner (the two meet on their axes and interlock)
        const tip = [w.a, w.b].find((c) => Math.hypot(c[0] - x, c[1] - z) < KINDS[w.kind].T * S);
        hit = tip ? dist : null;
      }
      if (wall < d) return { d: wall, wall: true, corner: hit };
      return { d, edge };
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ dx, dz, ...reach(p, dx, dz) }));
    const near = dirs.reduce((m, x) => (x.d < m.d ? x : m));
    const band = T + 0.4 / MODEL_SCALE;
    // along the nearest edge (flush with it), or a partition towards it; «Повернуть» swaps
    let along = near.d < band && near.edge && !near.wall;
    if (app.settings.wallTurn) along = !along;
    const ux = along ? -near.dz : near.dx, uz = along ? near.dx : near.dz;
    const q = p.clone();
    if (along && near.edge) { q.x += near.dx * (near.d - T / 2); q.z += near.dz * (near.d - T / 2); }
    else { // a partition: on a 50 mm grid across
      const g = 50 * S;
      if (ux) q.z = Math.round(q.z / g) * g; else q.x = Math.round(q.x / g) * g;
    }
    const end = (sg) => { const r = reach(q, ux * sg, uz * sg); return r.wall ? (r.corner ?? r.d) : Math.max(0, r.d - T / 2); };
    const e1 = end(1), e0 = end(-1);
    if (e0 + e1 < 0.3 / MODEL_SCALE) return null;
    const a = [q.x - ux * e0, q.z - uz * e0], b = [q.x + ux * e1, q.z + uz * e1];
    // the run of a wall already there belongs to it
    const ul = Math.hypot(ux, uz);
    if (walls.some((w) => { const ax = axis(w); return Math.abs(ax.ux * uz - ax.uz * ux) / ul < 0.1 && Math.abs((q.x - w.a[0]) * ax.nx + (q.z - w.a[1]) * ax.nz) < (KINDS[w.kind].T * S + T) / 2 && ((q.x - w.a[0]) * ax.ux + (q.z - w.a[1]) * ax.uz) / S > -100 && ((q.x - w.a[0]) * ax.ux + (q.z - w.a[1]) * ax.uz) / S < ax.L + 100; })) return null;
    // corners: an end near another wall's end takes it exactly
    for (const e of [a, b]) for (const w of walls) for (const c of [w.a, w.b]) if (Math.hypot(e[0] - c[0], e[1] - c[1]) < 0.012) { e[0] = c[0]; e[1] = c[1]; }
    return { a, b };
  }

  _unitFor(w, r, sl, pose) {
    const u = { type: 'unit', wall: w.id, row: r, i: sl.i, s0: +sl.s0.toFixed(1), s1: +sl.s1.toFixed(1), off: sl.off, kind: w.kind, s: pose.s.toArray().map((x) => +x.toFixed(6)) };
    if (sl.lintel) u.lintel = true;
    if (sl.cut) u.cut = true;
    return u;
  }

  _carryMove(p, e) {
    const app = this.app, c = this.carry, v = app.wallView;
    this._lastP = p;
    const snap = this._snapTo(e, p);
    const was = c.snap && `${c.snap.w.id}:${c.snap.sl.s0}`;
    c.snap = snap;
    if (snap) {
      const { w, r, sl, pose } = snap, u = this._unitFor(w, r, sl, pose);
      const lift = pose.p.clone(); lift.y += MM(25);
      v.live = { ...u, p: lift.toArray(), q: pose.q.toArray() };
      v.hl = { p: pose.p.toArray(), q: pose.q.toArray(), s: pose.s.toArray(), ok: true };
      // the mortar it will be set in
      const parts = this._bedFor(w, r, sl);
      v.liveBed = parts.length ? { wall: w.id, row: r, s0: parts[0][0], s1: parts.at(-1)[1] } : null;
      if (was !== `${w.id}:${sl.s0}`) { this.lastWall = w.id; this._focus(w); }
    } else {
      // in the hand: under the finger, above the ground
      const k = KINDS[c.kind], yaw = c.pallet ? (() => { const ax = axis(c.pallet); return Math.atan2(-ax.uz, ax.ux); })() : app.rig?.yaw || 0;
      const s = new THREE.Vector3(k.L * S, k.H * S, (k.nb ? k.W : k.T) * S);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).toArray();
      v.live = { type: 'unit', kind: c.kind, row: 0, i: 0, s: s.toArray(), p: [p.x, p.y + MM(350), p.z], q };
      // nothing to set it on here: the spot under the finger in red
      const g = app.terrain.inside(p.x, p.z) ? Math.max(p.y, app.terrain.heightAt(p.x, p.z)) : p.y;
      v.hl = { p: [p.x, g + s.y / 2, p.z], q, s: s.toArray(), ok: false };
      v.liveBed = null;
    }
    v.dirty = true;
    app.ui.refresh();
  }

  // the mortar under a place: on the masonry below it (a lintel: its two bearings)
  _bedFor(w, r, sl) {
    const app = this.app, opens = app.objects.all('opening').filter((o) => o.wall === w.id);
    return beddable(w, r, app.objects.all('wall'), opens).map(([a, b]) => [Math.max(a, sl.s0), Math.min(b, sl.s1)]).filter(([a, b]) => b - a > 10);
  }

  // the wall the tray serves: the one being worked on, else the first one not finished
  // (of the material chosen)
  _trayWall() {
    const walls = this.app.objects.all('wall').filter((w) => w.kind === this.kind);
    const open = walls.filter((w) => { const st = wallState(w, this.app.objects); return st.cur < st.n; });
    return open.find((w) => w.id === this.lastWall) || open[0] || null;
  }
  palletLeft(w) { return palletStock(w, wallState(w, this.app.objects)).on; }
  _noWall() {
    const n = KINDS[this.kind].name;
    return this.app.objects.all('wall').some((w) => w.kind === this.kind) ? `Стены «${n}» выложены до верха`
      : `Стены из материала «${n}» нет: «Линия» → «${n}» → проведите стену (или выберите материал своей стены)`;
  }

  // the tray: shown while laying, labelled with the material
  syncTray() {
    if (!this.tray) return;
    const on = this.app.tool === 'wall' && this.mode === 'lay';
    this.tray.hidden = !on;
    if (!on) return;
    const kind = this.kind;
    this.tray.classList.toggle('brick', kind !== 'block');
    const lab = document.getElementById('wall-tray-label');
    if (lab) lab.textContent = kind === 'block' ? 'Газоблок' : 'Кирпич';
    const w = this._trayWall(), left = w ? this.palletLeft(w) : 0;
    this.tray.title = w ? `На поддоне: ${left}` : '';
  }

  _carryCancel() {
    const v = this.app.wallView;
    this.carry = null; v.live = null; v.liveBed = null; v.hl = null; v.dirty = true;
    this.app.ui.refresh();
  }

  _carryDrop() {
    const app = this.app, snap = this.carry.snap;
    this._carryCancel();
    if (!snap) { app.ui.toast('Блок вернули на поддон — поднесите его к ряду на стене, к краю фундамента или на верх стены из другого материала'); return; }
    const { w, r, sl, st, pose } = snap, u = this._unitFor(w, r, sl, pose);
    if (snap.create) {
      w.pallet = this._palletSpot(w);
      app.ui.toast(`${KINDS[w.kind].name}: новая ${w.on ? 'стена на ' + KINDS[app.objects.get(w.on).kind].name.toLowerCase() : 'стена'} — ${(axis(w).L / 1000).toFixed(2).replace('.', ',')} м, ${rows(w)} рядов`);
    }
    if (sl.cut) app.ui.toast(cutName(w, sl));
    if (sl.lintel) app.ui.toast(`Перемычка ${Math.round(sl.s1 - sl.s0)} мм — по 250 мм опоры с каждой стороны`);
    const beds = this._bedFor(w, r, sl);
    const go = () => { app.physLoading = false; app.physJob = new LayJob(app, w, u, pose, st, beds, snap.create ? w : null, snap.cap); this.lastWall = w.id; };
    if (physicsReady()) go();
    else { app.physLoading = true; loadPhysics().then(go, () => { app.physLoading = false; app.ui.toast('Физика не загрузилась'); }); }
  }

  // what is going on, for the hint line: wall · course · place
  status() {
    const app = this.app, walls = app.objects.all('wall');
    if (!walls.length) return '';
    const c = this.carry;
    if (c?.snap) {
      if (c.snap.create) {
        const w = c.snap.w;
        return `Новая стена «${KINDS[w.kind].name}» ${w.on ? 'на стене ' + (walls.findIndex((x) => x.id === w.on) + 1) : 'от края до края'}: ${(axis(w).L / 1000).toFixed(2).replace('.', ',')} м, ${rows(w)} рядов. Отпустите — первый ${w.kind === 'block' ? 'блок' : 'кирпич'}`;
      }
      const { w, r, sl, st } = c.snap, cs = course(w, r, st.walls, st.opens);
      const what = sl.lintel ? 'перемычка' : sl.cut ? `добор ${Math.round(sl.s1 - sl.s0)} мм` : w.kind === 'block' ? 'блок' : 'кирпич';
      return `Стена ${walls.indexOf(w) + 1} · ряд ${r + 1} из ${st.n} · место ${cs.indexOf(cs.find((x) => x.s0 === sl.s0 && x.off === sl.off)) + 1} из ${cs.length} — ${what}. Отпустите`;
    }
    if (c) return 'Красный — сюда не встанет. Несите на плиту, фундамент или землю, к стене или на верх стены из другого материала';
    const w = this._trayWall();
    if (!w) return `${KINDS[this.kind].name}: тяните из лотка на край фундамента — начнётся стена вдоль него (или на верх стены из другого материала — ярус)`;
    const st = wallState(w, app.objects);
    if (st.cur >= st.n) return `Стена ${walls.indexOf(w) + 1} выложена до верха`;
    const cs = course(w, st.cur, st.walls, st.opens), left = cs.filter((sl) => !taken(st.units, st.cur, sl)).length, ps = palletStock(w, st);
    return `Стена ${walls.indexOf(w) + 1} · ряд ${st.cur + 1} из ${st.n}: осталось ${left} из ${cs.length} · на поддоне ${ps.on} из ${ps.cap}${ps.pallets > 1 ? ` (ещё поддонов: ${ps.pallets - 1})` : ''}. Тяните блок из лотка на стену`;
  }

  // ---- delete --------------------------------------------------------------------------
  _delete(p, e) {
    const app = this.app, id = app.pickObject(e.clientX, e.clientY, 'wall');
    if (id && app.objects.get(id)?.type === 'opening') {
      const o = app.objects.get(id);
      if (app.objects.all('unit').some((u) => u.wall === o.wall && u.lintel && u.s0 < o.s1 && u.s1 > o.s0)) { app.ui.toast('Над проёмом уже перемычка — сначала снимите её'); return; }
      app.journal.act('opening-remove', {}, app.clock, () => app.objects.remove(id));
      app.ui.toast('Проём убран — ряды будут сплошными');
      return;
    }
    if (id) {
      const u = app.objects.get(id);
      const rowsUp = u.lintel ? KINDS[u.kind].lintelRows : 1;
      const w = app.objects.get(u.wall), tier = w && u.row + rowsUp >= rows(w) ? app.objects.all('wall').find((o) => o.on === w.id) : null;
      const above = app.objects.all('unit').some((o) => ((o.wall === u.wall && o.row === u.row + rowsUp) || (tier && o.wall === tier.id && o.row === 0)) && o.s0 < u.s1 && o.s1 > u.s0);
      if (above) { app.ui.toast('Сверху лежит следующий ряд — сначала снимите его'); return; }
      app.journal.act('unit-remove', {}, app.clock, () => app.objects.remove(id));
      return;
    }
    const n = this.nearest(p);
    if (n && app.objects.all('wall').some((o) => o.on === n.w.id)) { app.ui.toast('На этой стене стоит следующий ярус — сначала уберите его'); return; }
    if (n && !app.objects.all('unit').some((u) => u.wall === n.w.id)) {
      app.journal.act('wall-remove', {}, app.clock, () => { for (const b of [...app.objects.all('bed'), ...app.objects.all('opening')].filter((b) => b.wall === n.w.id)) app.objects.remove(b.id); app.objects.remove(n.w.id); });
      app.ui.toast('Линия стены убрана');
    } else app.ui.toast('Коснитесь блока / кирпича, чтобы снять его');
  }
}

// One unit: lowered by hand onto the mortar a little off, it settles (physics: the
// units around, the bed, the foundation), then three taps of the rubber mallet bring it
// to the cord and the level. One journal entry.
class LayJob {
  constructor(app, w, unit, target, st, beds = [], newWall = null, cap = null) {
    this.app = app;
    this.unit = unit;
    this.target = target;
    this.pending = app.journal.begin('lay', { wall: w.id, row: unit.row, i: unit.i }, app.clock);
    if (cap) app.objects.update(cap.id, { height: cap.height });   // the wall below ends where it is laid to
    if (newWall) app.objects.add(newWall);   // the first block starts the wall (same journal entry)
    // the mortar is spread first (same journal entry)
    for (const [a, b] of beds) app.objects.add({ type: 'bed', wall: w.id, row: unit.row, s0: +a.toFixed(1), s1: +b.toFixed(1) });
    const p = target.p, s = target.s, pad = 0.12;
    this.ep = new Episode(app.terrain, p.x - pad, p.z - pad, p.x + pad, p.z + pad, 2, 120);
    this.ep.maxV = 0.6;
    // supports: units already laid near it, the mortar of this course
    for (const u of app.objects.all('unit')) {
      const q = new THREE.Vector3().fromArray(u.p);
      if (q.distanceTo(p) > 0.2) continue;
      this.ep.staticBox(q, new THREE.Quaternion().fromArray(u.q), u.s[0] / 2 * 0.999, u.s[1] / 2, u.s[2] / 2 * 0.999);
    }
    const k = KINDS[w.kind], bedT = (unit.row === 0 ? k.bed0 : k.bed) * S;
    this.ep.staticBox(new THREE.Vector3(p.x, rowY(w, unit.row) - bedT / 2, p.z), target.q, s.x / 2, bedT / 2, s.z / 2);
    // the hand puts it down a few mm off and slightly askew, 2 cm above
    const j = (m) => (Math.random() - 0.5) * m;
    const q0 = target.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(j(0.03), j(0.05), j(0.03))));
    const p0 = p.clone().add(new THREE.Vector3(j(MM(8)), MM(20), j(MM(8))));
    this.body = this.ep.box(s.x / 2, s.y / 2, s.z / 2, p0, q0, { density: unit.lintel ? 2400 : w.kind === 'block' ? 500 : 1800, friction: 0.9 });
    this.t = 0;
    this.phase = 'drop';
    this.done = false;
    this.from = new THREE.Vector3(); this.fromQ = new THREE.Quaternion();
    app.sfx?.stab?.();
    this._show();
  }

  get busy() { return !this.done; }

  update(dt) {
    if (this.done) return;
    if (this.app.journal.pending !== this.pending) { this._dispose(); return; }
    const ep = this.ep;
    ep.step(dt);
    this.t += dt;
    if (this.phase === 'drop' && (this.t > 0.35 && ep.still() || this.t > 0.9)) {
      this.phase = 'tap'; this.tapT = 0; this.taps = 0;
      ep.pose(this.body, this.from, this.fromQ);
      ep.kinematic(this.body);
    }
    if (this.phase === 'tap') {
      // the mallet: three taps, each takes half of what is left to the cord / level
      this.tapT += dt;
      const g = this.app.concreteGear, top = this.target.p.clone(); top.y += this.target.s.y / 2;
      const swing = Math.max(0, Math.sin(Math.min(1, (this.tapT % 0.22) / 0.22) * Math.PI));
      g.set('mallet', top.clone().add(new THREE.Vector3(0, MM(40) + swing * MM(90), 0)), 2 * Math.atan2(this.target.q.y, this.target.q.w));
      if (this.tapT > (this.taps + 1) * 0.22) {
        this.taps++;
        this.app.sfx?.stab?.();
        this.from.lerp(this.target.p, 0.6); this.fromQ.slerp(this.target.q, 0.6);
        ep.moveTo(this.body, this.from, this.fromQ);
        if (this.taps >= 3) { this._commit(); return; }
      }
    }
    this._show();
  }

  _pose() { const p = new THREE.Vector3(), q = new THREE.Quaternion(); this.ep.pose(this.body, p, q); return { p, q }; }

  _show() {
    const { p, q } = this._pose();
    this.app.wallView.live = { ...this.unit, p: p.toArray(), q: q.toArray() };
    this.app.wallView.dirty = true;
  }

  _commit() {
    const app = this.app;
    // what is left after the mallet: well under a millimetre and a tenth of a degree
    const p = this.from, q = this.fromQ;
    app.objects.add({ ...this.unit, p: p.toArray().map((x) => +x.toFixed(6)), q: q.toArray().map((x) => +x.toFixed(6)) });
    app.journal.commit(app.clock);
    this._dispose();
    app.concreteGear.set(null);
    app.ui?.refresh();
    const w = app.objects.get(this.unit.wall), st = w && wallState(w, app.objects);
    if (st && st.cur > this.unit.row) app.ui?.toast(st.cur >= st.n ? 'Стена выложена до верха' : `Ряд ${this.unit.row + 1} готов — дальше ряд ${st.cur + 1}`);
  }

  _dispose() {
    this.done = true;
    this.ep?.dispose(); this.ep = null;
    this.app.wallView.live = null; this.app.wallView.dirty = true;
    if (this.app.physJob === this) this.app.physJob = null;
  }

  finish() { for (let i = 0; i < 600 && !this.done; i++) this.update(1 / 20); }

  abort() {
    if (this.done) return false;
    this.app.journal.cancel();
    this._dispose();
    this.app.concreteGear.set(null);
    return true;
  }
}
