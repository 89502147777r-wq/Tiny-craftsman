import * as THREE from 'three';
import { MODEL_SCALE, K, KT } from '../config.js';
import { KINDS, OPENINGS, axis, rows, rowY, course, slotPose, wallState, taken, cutName, openingRows, beddable, layable, palletStock, level, topY } from '../world/walls.js';
import { Episode, loadPhysics, physicsReady } from '../world/physics.js';
import { placeUnit, freeTops, topAt, beltTopAt, boxOf, dims } from './freeBrick.js';
import { placeLintel, placeProp, placeLintelForm, uRun, cageRec, uStrength } from './lintels.js';
import { Squeeze, FAT } from './mortarSqueeze.js';
import { findBelt, beltContains, beltCage, beltsOverlap, toWorld, beltStuds } from './belt.js';
import { findSlab, slabCage, isSlab, cantText, SLAB, slabHole } from './slab.js';
import { findOpenings, openingAt } from './windowFit.js';
import { WINDOWS, windowFits, WIN_COLOURS } from '../world/windows.js';
import { DOORS, doorFits, isDoor } from '../world/doors.js';
import { RoofWork } from './roofTool.js';
import { FacadeWork } from './facadeTool.js';
import { BlindWork } from './blindTool.js';
import { PitchedWork, RoofWindowWork } from './pitchedTool.js';
const winName = (k) => (WINDOWS[k] || DOORS[k]).name;

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

// why a precast lintel can't go over an opening
function lintelWhy(f) {
  return f.why === 'long' ? `проём ${f.gapMm} мм — шире, чем перекроет перемычка 3,9 м (с опорой по 250 мм): над таким проёмом — подпорка и U-блоки с каркасом`
    : f.why === 'above' ? `над опорой уже лежит следующий ряд — перемычку кладут раньше него: снимите блоки над опорой (по ${Math.round((f.lenMm - f.gapMm) / 2)} мм с каждой стороны)`
    : f.why === 'clash' ? `на месте перемычки уже что-то лежит — снимите это («Удалить»)`
    : `опоры меньше 250 мм: по бокам проёма (${f.gapMm} мм) нужно по ${Math.round((f.lenMm - f.gapMm) / 2)} мм кладки в том же ряду`;
}

function lformWhy(f) {
  return f.why === 'bear' ? 'по бокам проёма нужно по 250 мм кладки в том же ряду — опалубка ляжет на неё'
    : f.why === 'above' ? 'над опорой уже лежит следующий ряд — опалубку ставят до него: снимите блоки над опорой'
    : f.why === 'taken' ? 'здесь опалубка уже стоит'
    : f.why === 'low' ? 'под проёмом нет места для стоек'
    : 'на месте перемычки уже что-то лежит — снимите это («Удалить»)';
}

export class WallTool {
  constructor(app) {
    this.app = app;
    this.roof = new RoofWork(app);
    this.facade = new FacadeWork(app);
    this.blind = new BlindWork(app);
    this.proof = new PitchedWork(app);
    this.rwin = new RoofWindowWork(app);
    this.mode = 'lay';
    this.drag = null;
    // the tray of blocks in the corner of the screen: drag a block out of it onto a wall
    // (the pallet by the wall may be out of the picture)
    this.tray = typeof document !== 'undefined' ? document.getElementById('wall-tray') : null;
    // under the tray: a course along a line
    this.rowBtn = typeof document !== 'undefined' ? document.getElementById('wall-row') : null;
    this.rowBtn?.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.toggleRow(); });
    // and the delete: straight from laying and back (no going back through the menu)
    this.delBtn = typeof document !== 'undefined' ? document.getElementById('wall-del') : null;
    this.delBtn?.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (this.rowJob) this._rowStop(); this.setMode(this.mode === 'delete' ? 'lay' : 'delete'); app.ui.toast(this.mode === 'delete' ? 'Удаление: коснитесь того, что снять. Ещё раз «Удалить» — снова кладка' : 'Снова кладка'); });
    if (this.tray) {
      // the point under the finger: on the masonry when it is over it (else the ground behind it)
      const g = (e) => this._pt(app.gestures.ground(e.clientX, e.clientY) || this._lastP || new THREE.Vector3(), e);
      this.tray.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.mode !== 'lay' || app.physJob || app.physLoading) return;
        if (this.kind === 'roof' && !this.roof.isCarry) { app.ui.toast(this.roof.status(false)); return; }
        if (this.kind === 'facade' && !this.facade.isCarry) { app.ui.toast(this.facade.status(false)); return; }
        if (this.kind === 'blind' && !this.blind.isCarry) { app.ui.toast(this.blind.status(false)); return; }
        if (this.kind === 'proof' && !this.proof.isCarry) { app.ui.toast(this.proof.status(false)); return; }
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

  get busy() { return !!this.drag || !!this.carry || !!this.rowDrag || !!this.rowJob; }
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
    const hit = _ray.intersectObjects([v.blocks, v.bricks, v.cinders, v.lintels, v.mortar, v.frames, v.ublocks, ...v.ucut.children, v.fill, v.wood, v.beltBoards, ...v.slabForm.decks.children, v.roofs], true).find((h) => h.object === v.mortar || h.object === v.frames || v.ownerOf(h) != null);
    return hit ? hit.point.clone() : p;
  }

  down(p, e) {
    const app = this.app;
    p = this._pt(p, e);
    if (this.mode === 'line') {
      if (this.kind !== 'block') { app.ui.toast('Кирпич кладётся без линии — «Класть» и тяните из лотка'); return true; }
      this.drag = { a: this._snap([p.x, p.z]), b: [p.x, p.z] };
      return true;
    }
    if (this.mode === 'opening') {
      // on the deck of a slab's formwork: an opening in the slab (a stair well)
      const sl = app.objects.all('belt').find((b) => isSlab(b) && !b.stripped && beltContains(b, p.x, p.z) && Math.abs(p.y - b.top) < MM(40));
      if (sl) {
        if (sl.fill > 0.05) { app.ui.toast('Перекрытие уже залито — проём закладывают в опалубке до бетона'); return true; }
        this.drag = { slab: sl.id, a: [p.x, p.z], b: [p.x, p.z] };
        return true;
      }
      const n = this.nearest(p);
      if (!n) { app.ui.toast('Ведите вдоль стены — от одного края проёма до другого (или по фанере опалубки перекрытия — проём в плите)'); return true; }
      this.drag = { w: n.w, s0: n.s, s1: n.s, a: n.s };
      this.lastWall = n.w.id;
      return true;
    }
    if (this.mode === 'lay' && this.rowMode && (this.kind === 'block' || this.kind === 'brick' || this.kind === 'cinder')) {
      if (this.rowJob) { this._rowStop('Ряд остановлен'); return true; }
      this._rowDown(p, e); return true;
    }
    // a window already in: a touch gives it the colour chosen
    if (this.mode === 'lay' && this.kind === 'window' && e?.clientX !== undefined) {
      const id = app.pickObject(e.clientX, e.clientY, 'wall'), r = id && app.objects.get(id);
      if (r?.type === 'window' && !isDoor(r.key)) {
        const col = app.settings.winCol || 'white';
        if ((r.col || 'white') !== col) { app.journal.act('window-colour', {}, app.clock, () => app.objects.update(id, { col })); app.ui.toast(`Окно перекрасили: ${WIN_COLOURS[col][0].toLowerCase()}`); }
        else app.ui.toast(`Окно уже ${WIN_COLOURS[col][0].toLowerCase()} — выберите другой цвет и коснитесь окна`);
        return true;
      }
    }
    if (this.mode === 'lay' && this.kind === 'roof') return this.roof.down(p, e);
    if (this.mode === 'lay' && this.kind === 'facade') return this.facade.down(p, e);
    if (this.mode === 'lay' && this.kind === 'blind') return this.blind.down(p, e);
    if (this.mode === 'lay' && this.kind === 'proof') return this.proof.down(p, e);
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
    if (this.rowDrag) { this._rowMove(p, e); return; }
    if (this.roof.drag) { this.roof.move(p, e); return; }
    if (this.facade.drag) { this.facade.move(p, e); return; }
    if (this.blind.drag) { this.blind.move(p, e); return; }
    if (this.proof.drag) { this.proof.move(p, e); return; }
    if (!this.drag) return;
    if (this.mode === 'line') {
      this.drag.b = this._snap([p.x, p.z], this.drag.a);
      const L = Math.hypot(this.drag.b[0] - this.drag.a[0], this.drag.b[1] - this.drag.a[1]) * MODEL_SCALE;
      app.ui.showMeasure(`${L.toFixed(2)} м`);
      this._preview();
    } else if (this.mode === 'opening' && this.drag.slab) {
      const d = this.drag, b = app.objects.get(d.slab);
      if (!b) return;
      // the finger on the plane of the deck
      if (e && e.clientX !== undefined) {
        _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera);
        const q = _ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -b.top), new THREE.Vector3());
        if (q) d.b = [q.x, q.z];
      } else d.b = [p.x, p.z];
      const H = slabHole(b, d.a[0], d.a[1], d.b[0], d.b[1]);
      d.H = H;
      const v = app.wallView;
      if (H.rect) {
        const [a0, b0, a1, b1] = H.rect, [cx, cz] = toWorld(b, (a0 + a1) / 2 * b.c, (b0 + b1) / 2 * b.c);
        v.hl = { p: [cx, b.top + b.H / 2, cz], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-b.u[1], b.u[0])).toArray(), s: [(a1 - a0) * b.c, b.H, (b1 - b0) * b.c], ok: true };
        app.ui.showMeasure(`Проём ${(H.w / 1000).toFixed(1)} × ${(H.l / 1000).toFixed(1)} м`.replace(/\./g, ','));
      } else { v.hl = null; app.ui.showMeasure('Проём: протяните шире'); }
      v.dirty = true;
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
    if (this.rowDrag) { const d = this.rowDrag; this.rowDrag = null; this._rowStart(d); return; }
    if (this.roof.drag) { this.roof.up(); return; }
    if (this.facade.drag) { this.facade.up(); return; }
    if (this.blind.drag) { this.blind.up(); return; }
    if (this.proof.drag) { this.proof.up(); return; }
    this.drag = null;
    app.ui.hideMeasure();
    this._preview(true);
    if (!d) return;
    if (this.mode === 'line') {
      const L = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
      if (L < 0.3 / MODEL_SCALE) { app.ui.toast('Стена короче 30 см — проведите длиннее'); return; }
      const rec = { type: 'wall', a: d.a.map((x) => +x.toFixed(5)), b: d.b.map((x) => +x.toFixed(5)), kind: this.kind, height: app.settings.wallHeight || 1500, v: 2 };
      rec.base = +this._baseOf(rec).toFixed(5);
      rec.pallet = this._palletSpot(rec);
      const w = app.journal.act('wall-line', { kind: rec.kind }, app.clock, () => app.objects.add(rec));
      const added = app.objects.all('wall').at(-1);
      this.lastWall = added?.id; this._focus(added);
      app.ui.toast(`${KINDS[rec.kind].name}: стена ${(L * MODEL_SCALE).toFixed(2).replace('.', ',')} м, ${rows(rec)} рядов. Рядом поддон — «Класть»: берите блок и несите к стене`);
      void w;
    } else if (this.mode === 'opening' && d.slab) {
      app.wallView.hl = null; app.wallView.dirty = true;
      const b = app.objects.get(d.slab), H = d.H;
      if (!b || !H) return;
      if (!H.patch) { app.ui.toast(H.why); return; }
      const cage = app.objects.all('cage').find((r) => r.beltId === b.id);
      app.journal.act('slab-hole', {}, app.clock, () => {
        app.objects.update(b.id, H.patch);
        // the bars laid already: laid again round the opening
        if (cage) { app.objects.remove(cage.id); app.objects.add(slabCage(app.objects.get(b.id))); }
      });
      app.ui.toast(`Проём в перекрытии ${(H.w / 1000).toFixed(1)} × ${(H.l / 1000).toFixed(1)} м: коробка из досок, фанера и стойки там убраны; арматура обойдёт его, по краям — по 2 прутка Ø${SLAB.bar} в каждой сетке, на углах — диагональные`.replace(/(\d)\.(\d)/g, '$1,$2'));
    } else if (this.mode === 'opening') {
      this._showOpening(true);
      this._addOpening(d);
    }
  }

  interrupt() { this.drag = null; if (this.carry) this._carryCancel(); this._preview(true); this.app.ui.hideMeasure(); }

  update() { if (this.rowJob) this._rowStep(); }

  // ---- a course along a line: the «Ряд» button under the tray, then a finger drawn along
  // where the course goes — the units go down one after another (each set as by hand:
  // lowered onto the mortar, three taps of the mallet), continuing the course begun there
  toggleRow() {
    const app = this.app;
    if (this.rowJob) { this._rowStop('Ряд остановлен'); }
    this.rowMode = !this.rowMode;
    this.syncTray();
    if (this.rowMode) { loadPhysics().catch(() => {}); app.ui.toast(`Ряд по линии: проведите пальцем, где пойдёт ряд — ${this.kind === 'block' ? 'блоки' : 'кирпичи'} лягут один за другим, продолжая начатый ряд`); }
  }
  // the finger on the plane of the course (its top), or on the masonry / the ground
  _rowPt(p, e, y) {
    if (y == null || !e || e.clientX === undefined) return p.clone();
    _ray.setFromCamera(this.app.gestures.ndc(e.clientX, e.clientY), this.app.camera);
    return _ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3()) || p.clone();
  }
  // the finger on a brick / a block: that one is the guide — the course goes on from it,
  // laid the way it lies (a header goes on in headers, a stretcher in stretchers)
  _rowDown(p, e) {
    const app = this.app, grp = this.kind === 'block' ? 'block' : this.kind === 'cinder' ? 'cinder' : 'brick';
    const id = e?.clientX !== undefined ? app.pickObject(e.clientX, e.clientY, 'wall') : null, u = id && app.objects.get(id);
    const ref = u?.type === 'unit' && u.p && u.s && u.q && !u.lintel && u.kind !== 'ublock' && (boxOf(u).kind === 'brick' || boxOf(u).kind === 'block' || boxOf(u).kind === 'cinder') ? boxOf(u) : null;
    const y = ref ? ref.top : null;
    this.rowDrag = { ref, y, touch: p.clone(), pts: [ref ? new THREE.Vector3(ref.x, ref.top, ref.z) : p.clone()] };
    if (!ref) app.ui.toast(`Ряд начнётся здесь — или коснитесь ${grp === 'block' ? 'блока' : grp === 'cinder' ? 'шлакоблока' : 'кирпича'}-ориентира, ряд пойдёт от него`);
    this._rowShow();
  }
  _rowMove(p, e) {
    const d = this.rowDrag, q = this._rowPt(p, e, d.y);
    // the line: straight from the last corner; a new corner where the finger turns away
    const pts = d.pts, last = pts.at(-1);
    if (pts.length < 2) { if (Math.hypot(q.x - last.x, q.z - last.z) > MM(100)) pts.push(q); }
    else {
      const a = pts.at(-2), b = pts.at(-1), L1 = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L1, uz = (b.z - a.z) / L1;
      const off = Math.abs(-(q.x - a.x) * uz + (q.z - a.z) * ux), al = (q.x - a.x) * ux + (q.z - a.z) * uz;
      if (off > MM(450) && al > 0 && L1 > MM(400)) { b.set(a.x + ux * Math.min(al, L1 + MM(300)), b.y, a.z + uz * Math.min(al, L1 + MM(300))); pts.push(q); }   // (the corner where it turned)
      else pts[pts.length - 1] = q;
    }
    this._rowShow();
  }
  // the places of the course along the line (no checks yet): from the guide, square to it
  _rowPlan(d, kind, half) {
    const D = dims(kind, half), { L, W, J } = D, out = [];
    let pts = d.pts, corner = false;
    if (pts.length < 2) return out;
    let cx, cz, bot, mode, dir, hl, hw;
    // the first stretch, snapped to an axis of the guide (or as drawn)
    const a = pts[0], b = pts[1], l0 = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let dx = (b.x - a.x) / l0, dz = (b.z - a.z) / l0;
    const r = d.ref;
    if (r) {
      const cu = r.ux * dx + r.uz * dz, cv = -r.uz * dx + r.ux * dz;
      // across the guide: a header course goes on in headers (a unit of it lies side by side
      // with the guide), else the course turns the corner at the guide's near end
      const header = Math.abs(cv) > Math.abs(cu) && this.app.objects.all('unit').filter((u) => u.p && u.s && u.q).map(boxOf).some((b) => b !== r && Math.abs(b.bot - r.bot) < D.H * 0.3 && Math.abs(Math.sin(b.yaw - r.yaw)) < 0.1 && Math.abs((b.x - r.x) * r.ux + (b.z - r.z) * r.uz) < r.hl * 0.5 && Math.abs(Math.abs(-(b.x - r.x) * r.uz + (b.z - r.z) * r.ux) - (r.hw + b.hw + J)) < J * 3 + MM(15));
      if (Math.abs(cu) >= Math.abs(cv)) { mode = 'along'; dir = [r.ux * Math.sign(cu), r.uz * Math.sign(cu)]; }
      else if (header) { mode = 'across'; dir = [-r.uz * Math.sign(cv), r.ux * Math.sign(cv)]; }
      else {
        // (the end: the one the finger touched nearer, or the way the line leans)
        const t = d.touch, s = Math.abs(cu) > 0.15 ? Math.sign(cu) : t ? Math.sign((t.x - r.x) * r.ux + (t.z - r.z) * r.uz) || 1 : 1;
        mode = 'along'; dir = [r.ux * s, r.uz * s]; corner = true;
        pts = [pts[0], new THREE.Vector3(r.x + r.ux * s * r.hl, pts[0].y, r.z + r.uz * s * r.hl), ...pts.slice(1)];
      }
      cx = r.x; cz = r.z; bot = r.bot; hl = mode === 'along' ? r.hl : r.hw; hw = mode === 'along' ? r.hw : r.hl;
    } else {
      mode = 'along'; dir = [dx, dz]; bot = null; hl = 0; hw = W / 2;
      cx = a.x - dx * (J + L / 2); cz = a.z - dz * (J + L / 2); hl = L / 2;
    }
    const nl = mode === 'along' ? L / 2 : W / 2, nw = mode === 'along' ? W / 2 : L / 2;   // (the new ones: half along / across the course)
    // along the line the course is laid already: the next course goes on top of it, the
    // joints staggered by half a unit (the bond) — from over the middle of the guide
    if (corner) d.up = false;
    if (r && !corner) {
      const fx = cx + dir[0] * (hl + J + nl), fz = cz + dir[1] * (hl + J + nl);
      const taken = this.app.objects.all('unit').filter((u) => u.p && u.s && u.q).map(boxOf).some((b) => Math.abs(b.bot - r.bot) < D.H * 0.4 && Math.abs((fx - b.x) * b.ux + (fz - b.z) * b.uz) < b.hl - J && Math.abs(-(fx - b.x) * b.uz + (fz - b.z) * b.ux) < b.hw - J);
      if (taken) {
        bot = r.top + D.B;
        const sx = cx + dir[0] * (nl + J / 2), sz = cz + dir[1] * (nl + J / 2);   // (the first one: over the guide's joint with the next)
        cx = sx - dir[0] * (nl + J + nl); cz = sz - dir[1] * (nl + J + nl); hl = nl; hw = nw;
        d.up = true;
      } else d.up = false;
    }
    let ox = a.x, oz = a.z;
    for (let k = 1; k < pts.length && out.length < 200; k++) {
      const P = pts[k], Q = pts[k - 1];
      if (k > 1) {
        // a corner: the course turns square to the way it went
        const ex = P.x - Q.x, ez = P.z - Q.z, el = Math.hypot(ex, ez) || 1, side = Math.sign(-dir[1] * ex + dir[0] * ez) || 1;
        const nd = [-dir[1] * side, dir[0] * side];
        // round the corner: the last one's end, flush with its far face
        const fx = cx + dir[0] * (hl - nw), fz = cz + dir[1] * (hl - nw);
        cx = fx + nd[0] * (hw + J + nl) - nd[0] * (nl + J + nl); cz = fz + nd[1] * (hw + J + nl) - nd[1] * (nl + J + nl);
        hl = nl; hw = nw; dir = nd; ox = Q.x; oz = Q.z;
        void el;
      }
      // along this stretch: one after another until past its end
      const segL = k === 1 ? Math.max(0, (P.x - ox) * dir[0] + (P.z - oz) * dir[1]) : Math.hypot(P.x - ox, P.z - oz);
      for (let g = 0; g < 200 && out.length < 200; g++) {
        const nx = cx + dir[0] * (hl + J + nl), nz = cz + dir[1] * (hl + J + nl);
        const t = (nx - ox) * dir[0] + (nz - oz) * dir[1];
        if (t > segL + nl * 0.6) break;
        const yaw = mode === 'along' ? Math.atan2(-dir[1], dir[0]) : Math.atan2(-dir[0], -dir[1]);
        out.push({ x: nx, z: nz, yaw, bot });
        cx = nx; cz = nz; hl = nl; hw = nw;
      }
    }
    return out;
  }
  // the line and the places on it (the ghosts), while drawing and while laying
  _rowShow(plan) {
    const app = this.app, d = this.rowDrag;   // (only while drawing: gone once the finger is up)
    if (!this._rowG) {
      this._rowG = new THREE.Group(); this._rowG.renderOrder = 10; app.scene.add(this._rowG);
      this._rowMat = new THREE.MeshBasicMaterial({ color: 0xf0a53a, depthTest: false, transparent: true, opacity: 0.95 });
      this._rowGhost = new THREE.MeshBasicMaterial({ color: 0x35d06a, transparent: true, opacity: 0.38, depthWrite: false });
    }
    const G = this._rowG;
    for (const c of [...G.children]) { G.remove(c); c.geometry.dispose(); }
    if (!d) { G.visible = false; return; }
    G.visible = true;
    const pts = d.pts, y = (d.y ?? pts[0].y) + MM(15), w = MM(45);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-6) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(L + w, MM(4), w), this._rowMat);
      m.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2); m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); m.renderOrder = 11; m.frustumCulled = false; G.add(m);
    }
    // the dot on the guide
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(MM(70), MM(70), MM(6), 20), this._rowMat); dot.position.set(pts[0].x, y, pts[0].z); dot.renderOrder = 11; G.add(dot);
    const kind = this.rowJob?.kind || d.ref?.kind || this.kind, half = this.rowJob ? this.rowJob.half : d.ref ? !!d.ref.u.cut : !!app.settings.wallHalf, D = dims(kind, half);
    const list = plan || (this.rowJob ? this.rowJob.plan.slice(this.rowJob.n) : this._rowPlan(d, kind, half));
    const bot = d.ref ? d.ref.bot : (pts[0].y + D.B0);
    for (const q of list) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(D.L, D.H, D.W), this._rowGhost);
      m.position.set(q.x, (q.bot ?? bot) + D.H / 2, q.z); m.rotation.y = q.yaw; G.add(m);
    }
    if (this.rowDrag) app.ui.showMeasure(`Ряд: ${list.length} шт.`);
  }
  _rowStop(msg) {
    const J = this.rowJob;
    this.rowJob = null; this.rowDrag = null;
    this._rowShow();
    this.app.ui.hideMeasure();
    if (msg) this.app.ui.toast(J ? `${msg} — уложено ${J.n}` : msg);
    this.app.ui.refresh();
  }
  _rowStart(d) {
    // (the guide says what goes on: a brick or a block, whole or a half)
    const app = this.app, kind = d.ref ? d.ref.kind : this.kind, half = d.ref ? !!d.ref.u.cut : !!app.settings.wallHalf, plan = this._rowPlan(d, kind, half);
    if (!plan.length) { this._rowStop(d.ref ? 'Тяните линию от кирпича-ориентира вдоль будущего ряда' : 'Проведите линию длиннее — вдоль будущего ряда'); return; }
    this.rowJob = { kind, half, plan, n: 0, ref: d.ref, y: d.y, pts: d.pts };
    loadPhysics().catch(() => {});
    this._rowShow(); app.ui.hideMeasure();
    app.ui.toast(`Кладу ${d.up ? 'следующий ряд сверху' : 'ряд'}: ${plan.length} шт. — коснитесь, чтобы остановить`);
  }
  _rowStep() {
    const app = this.app, J = this.rowJob;
    if (app.physJob || app.physLoading || !physicsReady()) return;
    if (app.tool !== 'wall' || this.mode !== 'lay') { this._rowStop(); return; }
    const q = J.plan[J.n];
    if (!q) { this._rowStop('Ряд уложен по линии'); return; }
    const D = dims(J.kind, J.half), y = q.bot ?? (J.pts[0].y);
    const r = placeUnit(app, J.kind, new THREE.Vector3(q.x, y, q.z), null, null, false, { yaw: q.yaw, half: J.half });
    if (!r || !r.ok || Math.hypot(r.p.x - q.x, r.p.z - q.z) > D.L * 0.3 || (q.bot != null && Math.abs(r.p.y - D.H / 2 - q.bot) > D.H * 0.4)) {
      this._rowStop(J.n ? 'Дальше по линии ряд не встаёт (мешает кладка, проём или нет опоры)' : 'Здесь ряд не встаёт: ведите линию от кирпича-ориентира по верху кладки или по плите');
      return;
    }
    const u = { type: 'unit', free: true, kind: r.kind, row: 0, i: 0, s0: 0, s1: 0, off: 0, bedT: +r.bedT.toFixed(6), s: r.s.toArray().map((x) => +x.toFixed(6)), ...(r.half ? { cut: true } : {}) };
    app.physJob = new LayJob(app, null, u, { p: r.p, q: r.q, s: r.s, bedY: r.bedY, bedT: r.bedT }, null, []);
    // the rest of the plan follows where this one really went (and at its height)
    const dx = r.p.x - q.x, dz = r.p.z - q.z, bot = r.p.y - r.s.y / 2;
    for (let k = J.n + 1; k < J.plan.length; k++) { J.plan[k].x += dx; J.plan[k].z += dz; if (J.plan[k].bot == null) J.plan[k].bot = bot; }
    J.n++;
    app.settings.freeYaw = { ...(app.settings.freeYaw || {}), [J.kind === 'brick' || J.kind === 'cinder' ? J.kind : 'block']: +q.yaw.toFixed(5) };
  }


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
    const t = this.app.terrain, ax = axis(w), half = KINDS[w.kind].T / 2 * S, fb = freeTops(this.app);
    let m = -Infinity;
    for (let s = 0; s <= ax.L; s += 20) for (const o of [-half, 0, half]) {
      const x = w.a[0] + ax.ux * s * S + ax.nx * o, z = w.a[1] + ax.uz * s * S + ax.nz * o;
      if (t.inside(x, z)) m = Math.max(m, t.heightAt(x, z), topAt(fb, x, z), beltTopAt(this.app, x, z));   // the ground, a slab, the top of free brickwork, a ring beam
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
        if (beltTopAt(app, pose.p.x, pose.p.z) > rowY(w, r) + 1e-5) continue;   // (a ring beam is cast there: the course goes on it, free)
        let d;
        if (e && (e.clientX || e.clientY)) { const sp = this._screen(top); if (!sp.front) continue; d = Math.hypot(sp.x - e.clientX, sp.y - e.clientY); if (d > 90) continue; }
        else { d = Math.hypot(p.x - top.x, p.z - top.z) * 3500; if (d > 400) continue; }
        if (w.id === this.lastWall) d -= 6;
        d += (r - st.cur) * 2;   // the lower course first, when two are as near
        if (d < bd) { bd = d; best = { w, r, sl, st, pose }; }
      }
    }
    return best;
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
    rec = { type: 'wall', id: app.objects.nextId, a: rec.a.map((x) => +x.toFixed(5)), b: rec.b.map((x) => +x.toFixed(5)), kind, height: app.settings.wallHeight || 1500, v: 2, ...(rec.on ? { on: rec.on, base: +rec.base.toFixed(5) } : {}) };
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
    // the free brickwork is a surface too: a block wall can go on its top
    const fb = freeTops(app), top = (x, z) => topAt(fb, x, z);
    const onBricks = top(p.x, p.z) > t.heightAt(p.x, p.z);
    const onConc = !onBricks && conc(p.x, p.z), h0 = onBricks ? top(p.x, p.z) : t.heightAt(p.x, p.z);
    // the same surface: the top of the same course of bricks; concrete stays concrete;
    // any surface: no step up or down
    const same = (x, z) => t.inside(x, z) && (onBricks ? Math.abs(top(x, z) - h0) < 0.003
      : top(x, z) <= t.heightAt(x, z) && (!onConc || conc(x, z)) && Math.abs(t.heightAt(x, z) - h0) < (onConc ? 0.012 : 0.005));
    const far = (onConc || onBricks ? 15 : 1.5) / MODEL_SCALE, st = t.cell * 0.75;
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
    // how far it runs: measured from the finger (on the surface — the flush axis q may be
    // off a surface narrower than the wall, e.g. a block wall on a brick course)
    const pq = (q.x - p.x) * ux + (q.z - p.z) * uz;
    const end = (sg) => { const r = reach(p, ux * sg, uz * sg); return (r.wall ? (r.corner ?? r.d) : Math.max(0, r.d - (onBricks ? 0 : T / 2))) + pq * -sg; };   // on bricks: flush with their ends
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
    // where it goes: a brick — free masonry (freeBrick.js); a block — the next place of a
    // block wall if one is there, else beside / on other masonry (free), else a new block
    // wall on the bare slab, else a free block on the ground
    const fing = e && (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : null, scr = (x) => this._screen(x), turn = !!app.settings.wallTurn;
    let free = null, snap = null;
    // the direction of the work: the last unit laid of this kind («Повернуть» turns it)
    const grp = c.kind === 'block' || c.kind === 'ublock' ? 'block' : c.kind === 'cinder' ? 'cinder' : 'brick';
    const ref = app.settings.freeYaw?.[grp];
    const half = !!app.settings.wallHalf && (c.kind === 'block' || c.kind === 'brick' || c.kind === 'cinder');
    c.cage = null;
    if (c.kind === 'lintel') free = placeLintel(app, p, scr, fing);
    else if (c.kind === 'prop') free = placeProp(app, p, scr, fing);
    else if (c.kind === 'ublock') free = placeUnit(app, 'ublock', p, scr, fing, turn, { yaw: ref });
    else if (c.kind === 'belt') {
      // the formwork of a ring beam: round the whole top course under the finger
      const B = findBelt(app, p, scr, fing);
      if (B) B.exists = app.objects.all('belt').some((b) => Math.abs(b.top - B.rec.top) < 0.002 && beltsOverlap(b, B.rec));
      c.belt = B; c.free = undefined; c.snap = null;
      v.live = null; v.hl = null; v.liveBed = null;
      v.liveBelt = B && !B.exists ? B.rec : null; v.dirty = true;
      app.ui.refresh();
      return;
    } else if (c.kind === 'studs') {
      // the anchor studs: into the ring beam under the finger (its formwork, before the
      // concrete or while it is fresh)
      const b = app.objects.all('belt').find((q) => !isSlab(q) && !q.lform && beltContains(q, p.x, p.z) && p.y > q.top - 0.003 && p.y < q.top + q.H + MM(80)) || null;
      c.studBelt = b; c.free = undefined; c.snap = null; v.live = null; v.liveBed = null;
      if (b) {
        const L = b.ni * b.c, W = b.nj * b.c, [cx, cz] = toWorld(b, L / 2, W / 2);
        v.hl = { p: [cx, b.top + b.H + MM(100), cz], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-b.u[1], b.u[0])).toArray(), s: [L, MM(10), W], ok: !b.studs?.length && !(b.fill >= 0.95 && uStrength(b, app.clock) > 0.25) };
      } else v.hl = null;
      v.dirty = true; app.ui.refresh();
      return;
    } else if (c.kind === 'lform') {
      // the formwork of a lintel cast in place: over the opening under the finger
      const F = placeLintelForm(app, p, scr, fing);
      c.lform = F; c.free = undefined; c.snap = null;
      v.live = null; v.liveBed = null;
      v.liveBelt = F?.ok ? F.rec : null;
      if (F && !F.ok) {
        const r = F.rec, L = r.ni * r.c, W = r.nj * r.c, cx = r.o[0] + r.u[0] * L / 2 - r.u[1] * W / 2, cz = r.o[1] + r.u[1] * L / 2 + r.u[0] * W / 2;
        v.hl = { p: [cx, r.top + r.H / 2, cz], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-r.u[1], r.u[0])).toArray(), s: [L, r.H, W], ok: false };
      } else v.hl = null;
      v.dirty = true; app.ui.refresh();
      return;
    } else if (c.kind === 'blind') {
      c.free = undefined; c.snap = null; v.live = null; v.hl = null; v.liveBed = null;
      this.blind.carryMove(p, e); app.ui.refresh();
      return;
    } else if (c.kind === 'roof' || c.kind === 'facade' || c.kind === 'proof' || c.kind === 'rwin') {
      c.free = undefined; c.snap = null; v.live = null; v.hl = null; v.liveBed = null;
      (c.kind === 'roof' ? this.roof : c.kind === 'proof' ? this.proof : c.kind === 'rwin' ? this.rwin : this.facade).carryMove(p, e);
      app.ui.refresh();
      return;
    } else if (c.kind === 'window' || c.kind === 'door') {
      // a window / a door: into the opening under the finger, made to its size
      if (!c.openings) c.openings = findOpenings(app);
      const door = c.kind === 'door', o = openingAt(c.openings, p, scr, fing), key = door ? app.settings.doorKey || 'door1' : app.settings.windowKey || 'pvc2';
      c.win = o; c.free = undefined; c.snap = null;
      v.live = null; v.liveBed = null; v.liveWin = null; v.hl = null;
      if (o) {
        const taken = app.objects.all('window').some((w) => Math.hypot(w.x - o.x, w.z - o.z) < MM(150) && Math.abs(w.y - o.y0) < MM(150));
        o.why2 = taken ? 'В этом проёме уже стоит окно или дверь' : !o.ok ? o.why : door ? (o.floor ? doorFits(key, o.w, o.h) : 'Под дверь нужен проём до пола — здесь снизу кладка (это проём под окно)') : windowFits(key, o.w, o.h);
        if (!o.why2) v.liveWin = { key, w: o.w, h: o.h, t: o.t, x: o.x, y: o.y0, z: o.z, yaw: o.yaw, ...(door ? {} : { col: app.settings.winCol || 'white' }) };
        else v.hl = { p: [o.x, (o.y0 + o.y1) / 2, o.z], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw).toArray(), s: [o.w * S, o.y1 - o.y0, o.t * S], ok: false };
      }
      v.dirty = true;
      app.ui.refresh();
      return;
    } else if (c.kind === 'slab') {
      // the formwork of a floor slab: over the whole house under the finger
      const B = findSlab(app, p, scr, fing, app.settings.slabCant || 0);
      c.belt = B; c.free = undefined; c.snap = null;
      v.live = null; v.hl = null; v.liveBed = null;
      v.liveBelt = B && !B.exists ? B.rec : null; v.dirty = true;
      app.ui.refresh();
      return;
    } else if (c.kind === 'ucage') {
      // the cage: over a run of U-blocks, shown as the run lit up — or into a ring beam's formwork
      // (a ring beam's formwork under the finger first: the U-blocks of a lintel courses
      // below may be near it on the screen)
      c.beltCage = app.objects.all('belt').find((b) => !b.stripped && beltContains(b, p.x, p.z) && p.y > b.top - 0.003 && p.y < b.top + b.H + MM(60)) || null;   // (in its formwork — not the walls standing on a slab)
      const R = c.beltCage ? null : uRun(app, p, scr, fing);
      c.cage = R; c.free = undefined; c.snap = null;
      v.live = null;
      if (R) {
        const b = R.pick, mid = (R.s0 + R.s1) / 2, L = R.s1 - R.s0;
        v.hl = { p: [b.x + b.ux * mid, (b.bot + b.top) / 2, b.z + b.uz * mid], q: b.u.q, s: [L, b.top - b.bot, b.hw * 2], ok: !R.has };
      } else v.hl = null;
      v.liveBed = null; v.dirty = true; app.ui.refresh();
      return;
    } else if (c.kind !== 'block') free = placeUnit(app, c.kind === 'cinder' ? 'cinder' : 'brick', p, scr, fing, turn, { yaw: ref, half });
    else {
      // the next place of a block wall drawn with «Линия», else free: beside / on / on the ground
      snap = half ? null : this._snapTo(e, p);   // (a half: not a place of a drawn wall)
      if (!snap) free = placeUnit(app, 'block', p, scr, fing, turn, { yaw: ref, half });
    }
    if (c.kind !== 'block' || free) {
      const f = free;
      if (f && f.post != null) c.post = f.post;
      c.free = f; c.snap = null;
      if (f) {
        const lift = f.p.clone(); lift.y += MM(25);
        v.live = { type: 'unit', kind: f.kind, row: 0, i: 0, s: f.s.toArray(), p: lift.toArray(), q: f.q.toArray(), ...(f.kind === 'lintel' ? { lintel: true } : {}), ...(f.post != null ? { post: f.post } : {}) };
        v.hl = { p: f.p.toArray(), q: f.q.toArray(), s: f.s.toArray(), ok: f.ok };
      } else { v.live = null; v.hl = null; }
      v.liveBed = null; v.dirty = true;
      app.ui.refresh();
      return;
    }
    c.free = undefined;
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
    if (this.delBtn) { this.delBtn.hidden = !(this.app.tool === 'wall' && (this.mode === 'lay' || this.mode === 'delete')); this.delBtn.classList.toggle('active', this.mode === 'delete'); }
    this.tray.hidden = !on;
    if (this.rowBtn) { this.rowBtn.hidden = !(on && (this.kind === 'block' || this.kind === 'brick' || this.kind === 'cinder')); this.rowBtn.classList.toggle('active', !!this.rowMode); }
    if (!on) return;
    const kind = this.kind;
    this.tray.classList.toggle('brick', kind !== 'block' && kind !== 'cinder');
    this.tray.classList.toggle('cinder', kind === 'cinder');
    const lab = document.getElementById('wall-tray-label');
    const NAMES = { studs: 'Шпильки', lform: 'Опалубка перемычки', blind: 'Отмостка', block: 'Газоблок', brick: 'Кирпич', cinder: 'Шлакоблок', lintel: 'Перемычка', ublock: 'U-блок', prop: 'Подпорка', ucage: 'Каркас', belt: 'Опалубка пояса', slab: 'Перекрытие', window: 'Окно', door: 'Дверь', roof: 'Кровля', facade: 'Фасад', proof: 'Скатная крыша', rwin: 'Окно в крышу' };
    if (lab && kind === 'proof') { lab.textContent = { plate: 'Мауэрлат', joists: 'Лаги', ridge: 'Прогон', trim: 'Конёк', gutter: 'Водосток' }[this.app.settings.proofStage || 'plate'] || 'Крыша'; return; }
    if (lab && kind === 'blind') { lab.textContent = this.app.settings.blindLayer === 'drain' ? 'Лоток' : 'Опалубка'; return; }
    if (lab && kind === 'facade') { lab.textContent = { eps: 'Лист ППС', glue: 'Клей', mesh: 'Рулон сетки', emb: 'Шпатель', pl: 'Штукатурка', fl: 'Тёрка', pan: 'Панель' }[this.app.settings.facLayer || 'eps']; return; }
    if (lab && kind === 'roof') { lab.textContent = { vap: 'Рулон пароизоляции', xps: 'Лист XPS', wedge: 'Клиновидная плита', mem: 'Рулон мембраны', cop: 'Отлив 2 м', grav: 'Гравий' }[this.app.settings.roofLayer || 'vap']; return; }
    if (lab) lab.textContent = this.app.settings.wallHalf && (kind === 'block' || kind === 'brick' || kind === 'cinder') ? (kind === 'block' ? '½ блока' : kind === 'cinder' ? '½ шлакоблока' : '½ кирпича') : NAMES[kind] || 'Блок';
    const w = this._trayWall(), left = w ? this.palletLeft(w) : 0;
    this.tray.title = w ? `На поддоне: ${left}` : '';
  }

  _carryCancel() {
    const v = this.app.wallView;
    this.carry = null; v.live = null; v.liveBed = null; v.hl = null; v.liveBelt = null; v.liveWin = null; v.dirty = true; this.roof._live(null); this.facade._live(null); this.proof._live(null); this.rwin._live(null); this.blind._live(null);
    this.app.ui.refresh();
  }

  _carryDrop() {
    const app = this.app, snap = this.carry.snap, free = this.carry.free, ck = this.carry.kind, cage = this.carry.cage, belt = this.carry.belt, bc = this.carry.beltCage, win = this.carry.win, lf = this.carry.lform, sb = this.carry.studBelt;
    this._carryCancel();
    if (ck === 'studs') {
      if (!sb) { app.ui.toast('Шпильки — в армопояс: поднесите их к опалубке пояса на верху стен'); return; }
      if (sb.studs?.length) { app.ui.toast('В этом поясе шпильки уже стоят'); return; }
      if (sb.fill >= 0.95 && uStrength(sb, app.clock) > 0.25) { app.ui.toast('Бетон уже схватился — шпильки ставят в каркас до заливки или в свежий бетон'); return; }
      const st = beltStuds(sb);
      app.journal.act('belt-studs', {}, app.clock, () => app.objects.update(sb.id, { studs: st }));
      app.ui.toast(`Шпильки М12 под мауэрлат: ${st.length} шт. по оси стен — через ≤ 1 м и по 300 мм от углов, загнутым концом в бетон, 200 мм над поясом (мауэрлат 150 + шайба и гайка)`);
      return;
    }
    if (ck === 'lform') {
      if (!lf) { app.ui.toast('Опалубку перемычки — к проёму: промежутку 300…4000 мм между блоками одного ряда'); return; }
      if (!lf.ok) { app.ui.toast(lformWhy(lf)); return; }
      app.journal.act('lintel-form', {}, app.clock, () => app.objects.add(lf.rec));
      app.ui.toast(`Опалубка перемычки над проёмом ${lf.gapMm} мм: днище на стойках, доски по бокам, длина ${lf.lenMm} мм (опора по 250 мм), высота ${lf.hMm} мм — теперь «Каркас», потом бетон`);
      return;
    }
    if (ck === 'belt') {
      if (!belt) { app.ui.toast('Опалубку пояса — на верх стены: коснитесь верхнего ряда кладки'); return; }
      if (belt.exists) { app.ui.toast('На этих стенах опалубка пояса уже стоит'); return; }
      app.journal.act('belt-form', {}, app.clock, () => app.objects.add(belt.rec));
      app.ui.toast(`Опалубка пояса: доски по обе стороны стен, ${belt.lenM.toFixed(1).replace('.', ',')} м стен, высота пояса 250 мм — теперь каркас («Каркас»), потом бетон`);
      return;
    }
    if (ck === 'roof') { this.roof.carryDrop(); return; }
    if (ck === 'facade') { this.facade.carryDrop(); return; }
    if (ck === 'blind') { this.blind.carryDrop(); return; }
    if (ck === 'proof') { this.proof.carryDrop(); return; }
    if (ck === 'rwin') { this.rwin.carryDrop(); return; }
    if (ck === 'window' || ck === 'door') {
      const o = win, door = ck === 'door', key = door ? app.settings.doorKey || 'door1' : app.settings.windowKey || 'pvc2';
      if (!o) { app.ui.toast(door ? 'Дверь — в проём до пола: оставьте его в кладке (перемычка или перекрытие сверху) и поднесите дверь к нему' : 'Окно — в проём: оставьте его в кладке (перемычка или перекрытие сверху) и поднесите окно к нему'); return; }
      if (o.why2) { app.ui.toast(o.why2); return; }
      app.journal.act(door ? 'door' : 'window', {}, app.clock, () => app.objects.add({ type: 'window', key, ...(door ? {} : { col: app.settings.winCol || 'white' }), w: o.w, h: o.h, t: o.t, x: +o.x.toFixed(6), y: +o.y0.toFixed(6), z: +o.z.toFixed(6), yaw: +o.yaw.toFixed(5) }));
      app.ui.toast(door ? `${DOORS[key].name}: ${o.w} × ${o.h} мм — коробка на пене с зазором 15 мм, полотно на ${DOORS[key].entrance ? 'трёх петлях, порог' : 'двух петлях'}, наличники` : `${WINDOWS[key].name}: ${o.w} × ${o.h} мм — рама с зазором 18 мм на пене, снаружи лента и ${WINDOWS[key].sill ? 'отлив, внутри подоконник' : 'пароизоляция внутри'}`);
      return;
    }
    if (ck === 'slab') {
      if (!belt) { app.ui.toast('Перекрытие — на верх стен (или на армопояс): коснитесь верха стены'); return; }
      if (belt.exists) { app.ui.toast('Здесь опалубка перекрытия уже стоит'); return; }
      app.journal.act('slab-form', {}, app.clock, () => app.objects.add(belt.rec));
      app.ui.toast(`Опалубка перекрытия: ${belt.area.toFixed(1).replace('.', ',')} м², ${cantText(belt.rec)}; фанера на балках и стойках, по краю доски, толщина плиты 200 мм — теперь каркас («Каркас»), потом бетон шлангом`);
      return;
    }
    if (ck === 'ucage' && !cage && bc) {
      const sl = isSlab(bc);
      if (app.objects.all('cage').some((r) => r.beltId === bc.id)) { app.ui.toast('В этой опалубке каркас уже есть'); return; }
      if (bc.fill > 0.05) { app.ui.toast(sl ? 'Перекрытие уже залито — арматуру кладут до бетона' : 'Пояс уже залит — каркас кладут до бетона'); return; }
      if (sl) {
        const rec = slabCage(bc);
        app.journal.act('slab-cage', {}, app.clock, () => app.objects.add(rec));
        app.ui.toast(`Арматура перекрытия: две сетки Ø${SLAB.bar} с шагом ${SLAB.step} мм в обе стороны, нижняя на стульчиках (защитный слой ${SLAB.cover} мм), верхняя на «лягушках»${bc.cant ? `; над консолью — дополнительные верхние прутки Ø${SLAB.cantBar}: консоль работает на растяжение по верху` : ''} — теперь бетон (шланг)`);
        return;
      }
      const rec = beltCage(bc);
      app.journal.act('belt-cage', {}, app.clock, () => app.objects.add(rec));
      if (bc.lform) { app.ui.toast('Каркас перемычки: 4 прутка Ø12 на всю длину с опорами, хомуты Ø6 через ≤ 350 мм, звёздочки 40 мм — теперь бетон (ведро или шланг), потом вибратор и правило'); return; }
      app.ui.toast(`Каркас пояса: 4 прутка Ø12 вдоль каждой стены, на углах — внахлёст до дальней стороны, хомуты Ø6 через ≤ 350 мм, звёздочки — теперь бетон (ведро или шланг)`);
      return;
    }
    if (ck === 'ucage') {
      if (!cage) { app.ui.toast('Каркас — в лоток U-блоков или в опалубку пояса: поднесите к ним'); return; }
      if (cage.has) { app.ui.toast('В этих U-блоках каркас уже есть'); return; }
      const rec = cageRec(cage, app);
      app.journal.act('u-cage', {}, app.clock, () => app.objects.add(rec));
      app.ui.toast(`Каркас ${((cage.s1 - cage.s0) / S / 1000).toFixed(2).replace('.', ',')} м: 4 прутка Ø12, хомуты Ø6 через ≤ 350 мм, звёздочки 30 мм — теперь бетон в лоток: «Бетон → Ведро»`);
      return;
    }
    if (free !== undefined) {
      if (!free?.ok) {
        app.ui.toast(ck === 'lintel' ? (free ? lintelWhy(free) : 'Поднесите перемычку к проёму — промежутку 300…4000 мм между блоками одного ряда')
          : ck === 'prop' ? 'Подпорку — в проём: между блоками одного ряда, под их верх'
            : `Сюда ${ck === 'block' || ck === 'ublock' ? 'блок' : ck === 'cinder' ? 'шлакоблок' : 'кирпич'} не встанет (врезается в кладку или висит в воздухе) — вернули на поддон`);
        return;
      }
      const u = { type: 'unit', free: true, kind: free.kind, row: 0, i: 0, s0: 0, s1: 0, off: 0, bedT: +free.bedT.toFixed(6), s: free.s.toArray().map((x) => +x.toFixed(6)), ...(free.half ? { cut: true } : {}),
        ...(free.kind === 'lintel' ? { lintel: true } : {}), ...(free.post != null ? { post: +free.post.toFixed(6) } : {}) };
      if (free.kind === 'lintel') app.ui.toast(`Перемычка ${free.lenMm} мм над проёмом ${free.gapMm} мм — опора по ${Math.round((free.lenMm - free.gapMm) / 2)} мм`);
      if (free.kind === 'prop') app.ui.toast('Подпорка стоит — кладите на неё U-блоки (стыкуются с кладкой по бокам)');
      const pose = { p: free.p, q: free.q, s: free.s, bedY: free.bedY, bedT: free.bedT };
      // the next one goes the same way; «Повернуть» was for this one
      if (free.kind === 'block' || free.kind === 'brick' || free.kind === 'ublock' || free.kind === 'cinder') app.settings.freeYaw = { ...(app.settings.freeYaw || {}), [free.kind === 'brick' || free.kind === 'cinder' ? free.kind : 'block']: +(2 * Math.atan2(free.q.y, free.q.w)).toFixed(5) };
      if (app.settings.wallTurn) { app.settings.wallTurn = false; app.applySettings(); }
      const go = () => { app.physLoading = false; app.physJob = new LayJob(app, null, u, pose, null, []); };
      if (physicsReady()) go();
      else { app.physLoading = true; loadPhysics().then(go, () => { app.physLoading = false; app.ui.toast('Физика не загрузилась'); }); }
      return;
    }
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
    const c = this.carry;
    if (c?.kind === 'studs') return c.studBelt ? (c.studBelt.studs?.length ? 'Красный — шпильки здесь уже стоят' : (c.studBelt.fill >= 0.95 && uStrength(c.studBelt, this.app.clock) > 0.25) ? 'Красный — бетон уже схватился' : `Шпильки в пояс: ${beltStuds(c.studBelt).length} шт. — отпустите`) : 'Поднесите шпильки к армопоясу';
    if (c?.kind === 'lform') return c.lform ? (c.lform.ok ? `Опалубка перемычки над проёмом ${c.lform.gapMm} мм, длина ${c.lform.lenMm} мм — отпустите` : 'Красный — ' + lformWhy(c.lform)) : 'Поднесите опалубку к проёму в кладке';
    if (c?.kind === 'belt') return c.belt ? (c.belt.exists ? 'Здесь опалубка пояса уже стоит' : `Опалубка по верху стен: ${c.belt.lenM.toFixed(1).replace('.', ',')} м — отпустите`) : 'Поднесите к верхнему ряду кладки — опалубка встанет по всему его контуру';
    if (c?.kind === 'roof') return this.roof.status(true);
    if (c?.kind === 'facade') return this.facade.status(true);
    if (c?.kind === 'blind') return this.blind.status(true);
    if (c?.kind === 'proof') return this.proof.status(true);
    if (c?.kind === 'rwin') return this.rwin.status();
    if (c?.kind === 'window' || c?.kind === 'door') { const door = c.kind === 'door', key = door ? this.app.settings.doorKey || 'door1' : this.app.settings.windowKey || 'pvc2'; return c.win ? (c.win.why2 ? 'Красный — ' + c.win.why2 : `${winName(key)}: ${c.win.w} × ${c.win.h} мм — отпустите`) : door ? 'Поднесите дверь к проёму до пола — она встанет по его размеру' : 'Поднесите окно к проёму в кладке — оно встанет по его размеру'; }
    if (c?.kind === 'slab') return c.belt ? (c.belt.exists ? 'Здесь опалубка перекрытия уже стоит' : `Перекрытие ${c.belt.area.toFixed(1).replace('.', ',')} м², ${cantText(c.belt.rec)} — отпустите`) : 'Поднесите к верху стен (или армопояса) — перекрытие встанет на весь дом' + ((this.app.settings.slabCant || 0) ? ', консоль — с той стороны, где коснулись' : '');
    if (c?.kind === 'ucage') return c.cage ? (c.cage.has ? 'В этих U-блоках каркас уже есть' : `Каркас в ${c.cage.run.length} U-блок(а) — отпустите`) : c.beltCage ? (isSlab(c.beltCage) ? 'Арматура перекрытия — отпустите' : 'Каркас пояса — отпустите') : 'Поднесите каркас к ряду U-блоков, в опалубку пояса или перекрытия';
    if (c && (c.kind === 'lintel' || c.kind === 'prop') && !c.free) return c.kind === 'lintel' ? 'Поднесите перемычку к проёму в кладке' : 'Поднесите подпорку к проёму в кладке';
    if (c?.free && c.kind === 'lintel') return c.free.ok ? `Перемычка ${c.free.lenMm} мм над проёмом ${c.free.gapMm} мм. Отпустите` : 'Красный — ' + lintelWhy(c.free);
    if (c?.free && c.kind === 'prop') return c.free.ok ? `Подпорка в проём ${c.free.gapMm} мм. Отпустите` : 'Красный — сюда подпорку не поставить';
    if (c?.free) {
      const nm = c.kind === 'block' ? 'Блок' : c.kind === 'ublock' ? 'U-блок' : c.kind === 'cinder' ? 'Шлакоблок' : 'Кирпич';
      return c.free.ok ? `${nm} встанет на подсвеченное место${c.free.how === 'beside' ? ' — рядом' : c.free.how === 'top' ? ' — сверху' : ''}. Отпустите` : 'Красный — сюда не встанет. Поднесите к кладке, на неё или на плиту';
    }
    if (['lintel', 'prop', 'ublock', 'ucage', 'belt', 'slab', 'window', 'door', 'roof', 'facade', 'proof', 'rwin', 'blind', 'lform', 'studs'].includes(this.kind)) return {
      studs: 'Шпильки под мауэрлат: тяните из лотка к опалубке армопояса — до заливки (или в свежий бетон) встанут шпильки М12 по оси стен через ≤ 1 м; на них потом ляжет мауэрлат на шайбах и гайках',
      lform: 'Монолитная перемычка: тяните опалубку из лотка к проёму — днище на стойках и доски по бокам встанут над ним с опорой по 250 мм; потом «Каркас», бетон (ведро / шланг), вибратор, правило; когда наберёт прочность — «Удалить» снимет опалубку',
      blind: this.blind.status(false),
      roof: this.roof.status(false),
      proof: this.proof.status(false),
      rwin: this.rwin.status(),
      facade: this.facade.status(false),
      door: 'Дверь: выберите вид и тяните из лотка к проёму до пола, оставленному в кладке (сверху перемычка, U-блоки или перекрытие) — дверь подгонится по его размеру; снять — «Удалить»',
      window: 'Окно: выберите вид и цвет (по умолчанию белое) и тяните из лотка к проёму; коснитесь готового окна — оно перекрасится в выбранный цвет. Проём — в кладке (сверху перемычка, U-блоки или перекрытие) — окно подгонится по его размеру; снять — «Удалить»',
      slab: 'Перекрытие: поднесите к верху стен или армопояса — фанера на балках и стойках по всему дому, доски по краю (консоль — с той стороны, где коснулись); потом «Каркас», бетон шлангом, вибратор, правило; стойки и опалубку снимают («Удалить»), когда бетон наберёт прочность',
      belt: 'Армопояс в опалубке: поднесите к верхнему ряду стен — доски встанут по всему контуру; потом «Каркас», бетон (ведро / шланг), вибратор, правило; снять опалубку — «Удалить», когда бетон наберёт прочность',
      lintel: 'Перемычка: тяните из лотка к проёму — встанет над ним, опора ≥ 250 мм с каждой стороны, длина подберётся (1,0…3,0 м)',
      prop: 'Подпорка: поставьте в проём под монолитную перемычку, на неё — U-блоки',
      ublock: 'U-блок: кладите на подпорку над проёмом и рядом на кладку, как газоблок; потом каркас и бетон из ведра (Бетон → Ведро)',
      ucage: 'Каркас: поднесите к ряду U-блоков (в лоток), в опалубку перемычки или пояса — 4 прутка Ø12 в хомутах, со звёздочками',
    }[this.kind];
    if (this.kind !== 'block' || (c && c.kind !== 'block')) {
      if (c) return 'Несите к кирпичу (продолжит ряд, ляжет рядом или повернёт за угол), на кладку или на плиту';
      return 'Кирпич: тяните из лотка — к кирпичу, на кладку или на плиту. Поворот сам; «↻ Повернуть» — для первого кирпича';
    }
    if (!walls.length) return '';
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
    if (id && app.objects.get(id)?.type === 'roof') { this.roof.remove(id); return; }
    if (id && app.objects.get(id)?.type === 'facade') { this.facade.remove(id); return; }
    if (id && app.objects.get(id)?.type === 'blind') { this.blind.remove(id); return; }
    if (id && app.objects.get(id)?.type === 'proof') { this.proof.remove(id); return; }
    if (id && app.objects.get(id)?.type === 'rwin') { app.journal.act('rwin-remove', {}, app.clock, () => app.objects.remove(id)); app.ui.toast('Окно сняли — кровля снова сплошная'); return; }
    if (id && app.objects.get(id)?.type === 'window') {
      app.journal.act('window-remove', {}, app.clock, () => app.objects.remove(id));
      app.ui.toast('Сняли — проём снова пустой');
      return;
    }
    if (id && app.objects.get(id)?.type === 'belt') {
      // a ring beam / a slab: the formwork comes off once the concrete has set; empty — it goes
      const b = app.objects.get(id), sl = isSlab(b);
      if (!(b.fill > 0.05)) {
        app.journal.act('belt-remove', {}, app.clock, () => { for (const c of app.objects.all('cage').filter((r) => r.beltId === b.id)) app.objects.remove(c.id); app.objects.remove(b.id); });
        app.ui.toast(sl ? 'Опалубку перекрытия разобрали' : b.lform ? 'Опалубку перемычки разобрали' : 'Опалубку пояса разобрали');
        return;
      }
      if (b.stripped) { app.ui.toast(sl ? 'Стойки и опалубка уже сняты — перекрытие готово' : 'Опалубка уже снята — пояс готов'); return; }
      const k = uStrength(b, app.clock);
      if (!(b.fill >= 0.95) || k < 1) { app.ui.toast(!(b.fill >= 0.95) ? (sl ? 'Перекрытие залито не доверху — долейте бетон' : 'Пояс залит не доверху — долейте бетон') : `Бетон набирает прочность: ${Math.round(k * 100)} % — ${sl ? (b.cant ? 'стойки рано убирать: консоль без них просядет' : 'стойки рано убирать: плита прогнётся') : 'опалубку рано снимать'}`); return; }
      app.journal.act('belt-strip', {}, app.clock, () => app.objects.update(b.id, { stripped: true, set: true }));
      app.ui.toast(sl ? 'Стойки, балки и фанеру сняли — перекрытие готово' + (b.cant ? ', консоль держится сама' : '') : b.lform ? 'Стойки, днище и доски сняли — монолитная перемычка готова, на неё можно класть дальше' : 'Опалубку сняли — армопояс готов');
      return;
    }
    if (id) {
      const u = app.objects.get(id);
      if (!u || u.type !== 'unit') return;
      const rowsUp = u.lintel && KINDS[u.kind] ? KINDS[u.kind].lintelRows : 1;
      const w = app.objects.get(u.wall), tier = w && u.row + rowsUp >= rows(w) ? app.objects.all('wall').find((o) => o.on === w.id) : null;
      // a prop: comes out when the U-blocks on it are filled and the concrete has set
      if (u.kind === 'prop') {
        const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().fromArray(u.q));
        const onIt = app.objects.all('unit').filter((o) => {
          if (o.id === u.id || Math.abs(o.p[1] - o.s[1] / 2 - (u.p[1] + u.s[1] / 2)) > 0.002) return false;
          const dx = o.p[0] - u.p[0], dz = o.p[2] - u.p[2], al = Math.abs(dx * ax.x + dz * ax.z), ac = Math.abs(-dx * ax.z + dz * ax.x);
          return al < (u.s[0] + o.s[0]) / 2 && ac < (u.s[2] + o.s[2]) / 2;   // (its footprint over the board)
        });
        const weak = onIt.find((o) => o.kind !== 'ublock' || !(o.fill >= 0.95) || uStrength(o, app.clock) < 1);
        if (weak) {
          app.ui.toast(weak.kind !== 'ublock' ? 'На подпорке лежит не U-блок — сначала снимите его' : !(weak.fill >= 0.95) ? 'U-блоки на подпорке не залиты бетоном доверху' : `Бетон набирает прочность: ${Math.round(uStrength(weak, app.clock) * 100)} % — подпорку рано снимать`);
          return;
        }
        app.journal.act('prop-remove', {}, app.clock, () => { for (const o of onIt) app.objects.update(o.id, { set: true }); app.objects.remove(id); });
        app.ui.toast('Подпорку сняли — перемычка держит');
        return;
      }
      // anything lying on it (a course, a tier, a free brick on its top)
      const top = u.p[1] + u.s[1] / 2;
      const above = app.objects.all('unit').some((o) => o.id !== u.id && ((!u.free && ((o.wall === u.wall && !o.free && o.row === u.row + rowsUp) || (tier && o.wall === tier.id && o.row === 0)) && o.s0 < u.s1 && o.s1 > u.s0)
        || (o.p[1] - o.s[1] / 2 > top - 1e-4 && o.p[1] - o.s[1] / 2 - top < 0.003 && Math.hypot(o.p[0] - u.p[0], o.p[2] - u.p[2]) < (u.s[0] + o.s[0]) / 2 - 0.001)));
      if (above) { app.ui.toast('Сверху лежит следующий ряд — сначала снимите его'); return; }
      // the mortar spread for it goes with it (the bed of a wall course is a record of its own)
      app.journal.act('unit-remove', {}, app.clock, () => {
        if (!u.free) for (const b of app.objects.all('bed')) if (b.wall === u.wall && b.row === u.row && b.s0 >= u.s0 - 1 && b.s1 <= u.s1 + 1) app.objects.remove(b.id);
        app.objects.remove(id);
      });
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
    this.pending = app.journal.begin('lay', w ? { wall: w.id, row: unit.row, i: unit.i } : { free: unit.kind }, app.clock);
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
    const k = KINDS[w ? w.kind : unit.kind], bedT = w ? (unit.row === 0 ? k.bed0 : k.bed) * S : target.bedT;
    const bedBot = (w ? rowY(w, unit.row) : target.bedY + bedT / 2) - bedT;
    // a brick goes onto mortar spread thicker than the joint: it is pressed down into it and
    // squeezes the rest out of the open sides (mortarSqueeze.js), then the trowel cuts it off
    const brick = !!k?.nb && !unit.lintel && bedT > 0;
    const bedH = brick ? bedT * FAT : bedT;
    this.ep.staticBox(new THREE.Vector3(p.x, bedBot + bedH / 2, p.z), target.q, s.x / 2, bedH / 2, s.z / 2);
    this.sq = brick ? new Squeeze(app, null, target, bedT, bedBot) : null;
    // the hand puts it down a few mm off and slightly askew, 2 cm above
    const j = (m) => (Math.random() - 0.5) * m;
    const q0 = target.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(j(0.03), j(0.05), j(0.03))));
    const p0 = p.clone().add(new THREE.Vector3(j(MM(8)), MM(20), j(MM(8))));
    this.body = this.ep.box(s.x / 2, s.y / 2, s.z / 2, p0, q0, { density: unit.lintel ? 2400 : unit.kind === 'block' || unit.kind === 'ublock' || unit.kind === 'prop' ? 500 : unit.kind === 'cinder' ? 1300 : 1800, friction: 0.9 });
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
      // (lifted slowly, brought down fast)
      const f = (this.tapT % 0.22) / 0.22, swing = f < 0.7 ? Math.sin(f / 0.7 * Math.PI / 2) : Math.cos((f - 0.7) / 0.3 * Math.PI / 2);
      // the flat face of the head strikes the middle of the top; between taps it is swung up
      g.malletSwing = swing * 0.75;
      g.set('mallet', top, 0);
      if (this.tapT > (this.taps + 1) * 0.22) {
        this.taps++;
        this.app.sfx?.stab?.();
        this.from.lerp(this.target.p, 0.6); this.fromQ.slerp(this.target.q, 0.6);
        ep.moveTo(this.body, this.from, this.fromQ);
        if (this.taps >= 3) {
          // a brick: the pressed-out mortar is cut off with the trowel, side by side
          if (this.sq && this.sq.order.length) { this.phase = 'trim'; this.trimT = 0; this.trimK = 0; g.ktrowelLump = 0; }
          else { this._commit(); return; }
        }
      }
    }
    if (this.phase === 'trim') {
      // the trowel: set against the face at the joint, slanted, drawn along it in 0,18 s
      const sq = this.sq, order = sq.order, g = this.app.concreteGear, T = 0.18, lead = 0.05;   // (one quick stroke a side)
      this.trimT += dt;
      const k = order[this.trimK];
      const t = Math.min(1, Math.max(0, (this.trimT - lead) / T));
      const at = sq.at(k, Math.max(0.02, t));
      sq.trim(k, t);
      g.ktrowelTilt = 1.0;
      g.ktrowelLump = Math.cbrt(sq.lump * 0.75 / Math.PI) * 1.4;
      // (its +z out of the face: yaw from the normal)
      g.set('ktrowel', at.p, Math.atan2(at.n[0], at.n[1]), this.trimT < dt * 1.5);
      if (this.trimT > lead + T + 0.03) {
        this.trimK++; this.trimT = 0;
        if (this.trimK >= order.length) { this._commit(); return; }
      }
    }
    if (this.sq) {
      // the bed is pressed to where the brick is now
      const { p } = this._pose();
      this.sq.press(p.y - this.target.s.y / 2);
      const v = this.app.wallView;
      v.squeeze.geometry.dispose(); v.squeeze.geometry = this.sq.geometry(); v.squeeze.visible = true;
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
    // the mallet brings it to the cord and the level: exactly where it goes (what was left
    // after the taps, a fraction of a millimetre, used to add up along a course)
    const p = this.target.p, q = this.target.q;
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
    if (this.sq) { const v = this.app.wallView; v.squeeze.visible = false; this.sq = null; }
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
