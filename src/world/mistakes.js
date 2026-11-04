import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { LANG } from '../i18n/i18n.js';

// «Ошибки» — what a mistake of the build does to the house as the years go by: a time-lapse played over the
// house as it stands (a show, like the catastrophes: the records do not change; «Вернуть как было» — the house
// is built again from them). The years run by as a fast time-lapse (the sun going round and round, the year
// counting up) and the damage grows as it does on a real house: slowly, then faster.
// The «x-ray» (on by default) shows the stress in the masonry before anything cracks — yellow to red where
// the load gathers; the crack is born where it is reddest and runs along the mortar joints, as real cracks do.
//   lintel — a lintel cast without its bars (plain concrete does not hold bending): a hairline crack at the
//            bottom of its middle, then it breaks in two halves that turn down on their bearings; the masonry
//            over the opening sags as an arch (the arch of collapse, ~0,6 of the span high) with a stepped crack
//            along the joints round it; at last the bottom blocks of the arch fall out.
const S = MODEL_SCALE, M = (m) => m / S;   // (m → model)
export const MISTAKES = {
  lintel: { name: 'Перемычка без арматуры', en: 'A lintel without rebar', icon: '🧱', saved: 60, repair: 4200, years: 10 },
};
const ease = (u) => u * u * (3 - 2 * u), clamp01 = (u) => Math.max(0, Math.min(1, u));
const MASONRY = ['blocks', 'bricks', 'cinders', 'ublocks'];

export class Mistake {
  constructor(app) { this.app = app; this.on = false; }
  get secPerYear() { return 3.2; }

  // the lintel to break: the longest over an opening, with masonry on it
  _findLintel() {
    const wv = this.app.wallView, im = wv.lintels; if (!im?.count) return null;
    const m4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    let best = null;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m4); m4.decompose(P, Q, Sv);
      const ax = Sv.x >= Sv.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), L = Math.max(Sv.x, Sv.z), T = Math.min(Sv.x, Sv.z);
      ax.applyQuaternion(Q).setY(0).normalize();
      if (!best || L > best.L) best = { i, c: P.clone(), q: Q.clone(), s: Sv.clone(), ax, L, T, H: Sv.y, m: m4.clone() };
    }
    return best;
  }

  start(kind = 'lintel', years = 10) {
    if (this.on) this.stop();
    const app = this.app, wv = app.wallView;
    wv.update?.();
    const Lt = this._findLintel();
    if (!Lt) return { ok: false, why: 'lintel' };
    this.kind = kind; this.years = years; this.t = 0; this.on = true; this.done = false; this.said = {};
    wv.frozen = true;
    const nrm = new THREE.Vector3(-Lt.ax.z, 0, Lt.ax.x), top = Lt.c.y + Lt.H / 2;
    const span = Math.max(M(0.6), Lt.L - 2 * M(0.25)), h = span * 0.6;
    this.L = { ...Lt, nrm, top, span, h };
    // the masonry over it: each unit's place along the wall (a), up from the lintel's top (y), in the arch?
    const m4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    this.units = []; this.colors = [];
    for (const key of MASONRY) {
      const im = wv[key]; if (!im?.count || !im.visible) continue;
      if (im.instanceColor) this.colors.push({ im, orig: im.instanceColor.array.slice() });
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4); m4.decompose(P, Q, Sv);
        if (Sv.x * Sv.y * Sv.z < 1e-12) continue;
        const rel = P.clone().sub(Lt.c), a = rel.dot(Lt.ax), n = rel.dot(nrm), y = P.y - top;
        if (Math.abs(n) > Lt.T * 0.75 + M(0.05) || y < -M(0.02) || y > h + M(1.2) || Math.abs(a) > Lt.L / 2 + M(1.2)) continue;
        // (in the arch: under the line from the opening's edges up to its crown — by the unit's middle, so the
        // edge of what drops goes unit by unit: a stepped crack along the joints)
        const inA = y < h * (1 - Math.abs(a) / (span / 2 + M(0.1)));
        this.units.push({ im, i, base: m4.clone(), p: P.clone(), s: Sv.clone(), a, y, inA, half: Math.max(Sv.x, Sv.z) / 2, hh: Sv.y / 2, d: 0, fall: null, col: im.instanceColor ? [im.instanceColor.getX(i), im.instanceColor.getY(i), im.instanceColor.getZ(i)] : null });
      }
    }
    if (!this.units.some((u) => u.inA)) { this.stop(); return { ok: false, why: 'masonry' }; }
    // the lintel itself: hidden, two halves in its place (the same concrete) that turn down on their bearings
    wv.lintels.getMatrixAt(Lt.i, m4); this._lintelM = m4.clone();
    { const z = new THREE.Matrix4().makeScale(0, 0, 0); wv.lintels.setMatrixAt(Lt.i, z); wv.lintels.instanceMatrix.needsUpdate = true; }
    this.root = new THREE.Group(); this.root.name = 'mistake'; app.scene.add(this.root);
    this.halves = new THREE.InstancedMesh(wv.lintels.geometry, wv.lintels.material, 2); this.halves.castShadow = this.halves.receiveShadow = true; this.halves.frustumCulled = false;
    this.root.add(this.halves);
    // the cracks: dark slivers along the joints at the edge of what drops (through the wall: seen both sides)
    this.crackMat = new THREE.MeshBasicMaterial({ color: 0x1a1714 });
    this.cracks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.crackMat, 400); this.cracks.count = 0; this.cracks.frustumCulled = false; this.root.add(this.cracks);
    this._edges();
    // the words over the picture: the year, the mistake, at the end the bill
    this._overlay();
    this.h0 = app.settings.dayHour ?? 12;
    // (the camera brought round to the opening: in front of it, a little to the side and up — the finger
    // turns it as it likes after)
    { const toCam = nrm.clone(), C = app.camera.position; if (C.clone().sub(Lt.c).dot(nrm) < 0) toCam.negate();
      const yaw = Math.atan2(toCam.x, toCam.z) + 0.3, d = Math.max(M(4), span * 2.6);
      app.rig.goal.target.copy(Lt.c).setY(top + h * 0.4); app.rig.goal.yaw = yaw; app.rig.goal.pitch = 0.14; app.rig.goal.dist = d; }
    this._apply(0);
    return { ok: true, units: this.units.length, arch: this.units.filter((u) => u.inA).length };
  }

  // the joints at the arch's edge: a unit in it beside one out of it (along the course), or under one out of it
  _edges() {
    const ins = this.units.filter((u) => u.inA), outs = this.units.filter((u) => !u.inA), e = M(0.03);
    this.edges = [];
    for (const u of ins) for (const o of outs) {
      const dy = Math.abs(u.y - o.y), da = Math.abs(u.a - o.a);
      if (dy < u.hh * 0.5 && Math.abs(da - (u.half + o.half)) < e) this.edges.push({ u, o, kind: 'v', a: (u.a + o.a) / 2 + 0, y: u.y, len: u.hh * 2 });
      else if (o.y > u.y && Math.abs(o.y - u.y - (u.hh + o.hh)) < e && da < u.half + o.half - e) {
        const a0 = Math.max(u.a - u.half, o.a - o.half), a1 = Math.min(u.a + u.half, o.a + o.half);
        this.edges.push({ u, o, kind: 'h', a: (a0 + a1) / 2, y: u.y + u.hh, len: a1 - a0 });
      }
    }
  }

  _overlay() {
    const el = (this.el = document.createElement('div'));
    el.className = 'mistake-hud'; el.setAttribute('data-notr', '');
    el.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 64px);transform:translateX(-50%);z-index:30;pointer-events:none;text-align:center;font:600 15px/1.25 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000a';
    el.innerHTML = '<div class="m-what" style="font-size:13px;opacity:.85"></div><div class="m-year" style="font-size:30px;font-weight:800;letter-spacing:.5px"></div><div class="m-note" style="font-size:13px;opacity:.9"></div><div class="m-bill" style="margin-top:8px;font-size:15px;opacity:0;transition:opacity .4s"></div>';
    document.body.appendChild(el);
    const K = MISTAKES[this.kind], en = LANG === 'en';
    el.querySelector('.m-what').textContent = en ? `${K.en} over a ${(this.L.span * S).toFixed(1)} m opening` : `${K.name} над проёмом ${(this.L.span * S).toFixed(1).replace('.', ',')} м`;
  }
  _say(key, ru, en) { if (this.said[key]) return; this.said[key] = 1; this.note = LANG === 'en' ? en : ru; }

  // ---- the years going by ----------------------------------------------------------------------------
  update(dt) {
    if (!this.on || this.done) return;
    this.t += dt;
    const yrs = this.t / this.secPerYear, u = clamp01(yrs / this.years);
    // (the sun round once in 0,8 s: a day of the time-lapse — the light flickering by as on a real one)
    this.app.sky?.setHour?.(6 + 13 * ((this.t / 0.8) % 1));
    this._apply(yrs, dt);
    if (yrs >= this.years + 1.2) this._end();
  }
  _apply(yrs, dt = 0) {
    const app = this.app, L = this.L, Y = this.years;
    // how far it has gone: the hairline crack in the 1st year; the halves turning from the 2nd, slowly, then
    // faster (the creep of what is left, the cracks opening); the sag at the crown: up to 45 mm
    const k = clamp01((yrs - 1.5) / (Y - 1.5)), sag = M(0.045) * Math.pow(k, 1.8);
    this.sag = sag;
    if (yrs > 0.8) this._say('hair', 'Волосяная трещина внизу перемычки — бетон без арматуры не держит изгиб', 'A hairline crack under the lintel — plain concrete does not hold bending');
    if (sag > M(0.006)) this._say('sag', 'Перемычка разломилась — кладка над проёмом садится аркой', 'The lintel broke — the masonry over the opening sags as an arch');
    if (sag > M(0.03)) this._say('drop', 'Трещина по швам до верха арки, блоки выпадают', 'The crack runs up the joints, the blocks fall out');
    // the halves: each turns down about its outer bearing, its inner end down by the sag
    {
      const half = L.L / 2, ang = Math.atan2(sag, half - M(0.12)), m = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
      this._lintelM.decompose(P, Q, Sv);
      for (const side of [-1, 1]) {
        const s2 = Sv.clone(); if (Sv.x >= Sv.z) s2.x = Sv.x / 2 - M(0.002); else s2.z = Sv.z / 2 - M(0.002);
        const pivot = L.c.clone().addScaledVector(L.ax, side * (half - M(0.12))).setY(L.c.y - L.H / 2);
        const c = L.c.clone().addScaledVector(L.ax, side * half / 2);
        const R = new THREE.Quaternion().setFromAxisAngle(L.nrm, side * ang);
        const pc = c.clone().sub(pivot).applyQuaternion(R).add(pivot);
        m.compose(pc, R.clone().multiply(Q), s2);
        this.halves.setMatrixAt(side < 0 ? 0 : 1, m);
      }
      this.halves.instanceMatrix.needsUpdate = true;
    }
    // the masonry: what is in the arch goes down with the lintel (more at the crown's foot, less up the arch);
    // the x-ray tints by the stress — over the middle of the opening first, gathering round the arch's edge
    const m = new THREE.Matrix4(), xr = app.settings.mXray !== false, Ld = Math.max(1e-9, L.h);
    const st = clamp01(yrs / 2.5);
    for (const un of this.units) {
      if (un.fall) continue;
      const off = Math.abs(un.a) / (L.span / 2 + M(0.1));
      un.d = un.inA ? sag * (1 - 0.55 * un.y / Ld) * (1 - 0.35 * off) : 0;
      m.copy(un.base); m.elements[13] -= un.d; un.im.setMatrixAt(un.i, m);
      if (un.col && un.im.instanceColor) {
        // (the stress: over the opening, high under the arch's line — and along its edge most of all)
        const edge = un.inA ? 1 - Math.abs(un.y / Ld - (1 - off)) * 1.6 : clamp01(1 - (un.y - Ld * (1 - off)) / (Ld * 0.6)) * (off < 1.25 ? 1 : 0);
        const sv = xr ? clamp01(st * Math.max(0, edge) * (0.5 + 0.5 * clamp01(yrs / 4))) : 0;
        const r = un.col[0] + (1.0 - un.col[0]) * sv, g = un.col[1] + ((sv < 0.5 ? 0.85 : 0.25) - un.col[1]) * sv, b = un.col[2] + (0.08 - un.col[2]) * sv;
        un.im.instanceColor.setXYZ(un.i, r, g, b);
      }
    }
    // the bottom blocks of the arch fall out once it has sagged far enough
    if (sag > M(0.03) && !this.fell) {
      this.fell = true;
      const bottom = this.units.filter((q) => q.inA && q.y < L.h * 0.35).sort((p, q) => Math.abs(p.a) - Math.abs(q.a)).slice(0, 3);
      for (const q of bottom) q.fall = { v: new THREE.Vector3().addScaledVector(L.nrm, M(0.5) * (Math.random() < 0.5 ? -1 : 1)), w: (Math.random() - 0.5) * 6, rot: 0, y: 0, t: 0 };
      app.sfx?.play?.('collapse', { at: L.c, vol: 0.7 });
    }
    for (const q of this.units) if (q.fall && dt > 0) {
      const f = q.fall, gnd = app.terrain.heightAt(q.p.x + f.v.x * f.t, q.p.z + f.v.z * f.t) + q.hh;
      f.t += dt; f.v.y -= M(9.81) * dt;
      const p = q.p.clone().add(new THREE.Vector3(f.v.x * f.t, 0, f.v.z * f.t)); f.y += f.v.y * dt; p.y = Math.max(gnd, q.p.y - q.d + f.y);
      if (p.y <= gnd + 1e-6 && !f.landed) { f.landed = true; f.w *= 0.2; app.sfx?.play?.('stone', { at: p, vol: 0.6, gap: 0.05 }); app.particles?.emit?.(p.clone(), new THREE.Vector3(0, M(0.4), 0), 0, M(0.05), 0, 0, 0); }
      if (!f.landed) f.rot += f.w * dt;
      const R = new THREE.Quaternion().setFromAxisAngle(this.L.ax, f.rot), P0 = new THREE.Vector3(), Q0 = new THREE.Quaternion(), S0 = new THREE.Vector3();
      q.base.decompose(P0, Q0, S0); m.compose(p, R.multiply(Q0), S0); q.im.setMatrixAt(q.i, m);
    }
    for (const im of new Set(this.units.map((q) => q.im))) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    // the cracks: as wide as the two sides have parted (a hairline first, seen as the stress gathers)
    {
      let n = 0; const T = L.T + M(0.012), hair = yrs > 0.8 ? M(0.0015) : 0;
      const put = (a, y, len, w, vert) => {
        if (n >= this.cracks.instanceMatrix.count || w <= 0) return;
        const p = L.c.clone().addScaledVector(L.ax, a); p.y = L.top + y;
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), L.ax);
        m.compose(p, q, vert ? new THREE.Vector3(Math.max(w, M(0.002)), len, T) : new THREE.Vector3(len, Math.max(w, M(0.002)), T));
        this.cracks.setMatrixAt(n++, m);
      };
      for (const e of this.edges) {
        if (e.u.fall) continue;
        const w = e.u.d - e.o.d + hair * (sag > M(0.006) ? 1 : 0);
        put(e.a, e.kind === 'v' ? e.y - e.u.d / 2 : e.y - e.u.d / 2, e.len, e.kind === 'v' ? Math.min(M(0.012), M(0.002) + w * 0.25) : w, e.kind === 'v');
      }
      // (the lintel's own crack: up its middle from the bottom — a hairline, then the halves' V)
      if (hair) put(0, -L.H / 2 - sag / 2, L.H * (sag > M(0.006) ? 1.05 : 0.45), M(0.002) + sag * 0.35, true);
      this.cracks.count = n; this.cracks.instanceMatrix.needsUpdate = true;
    }
    // the words
    if (this.el) {
      const en = LANG === 'en', y = Math.min(this.years, Math.floor(yrs));
      this.el.querySelector('.m-year').textContent = en ? `Year ${y}` : `Год ${y}`;
      this.el.querySelector('.m-note').textContent = this.note || '';
    }
    if (this.t > 0.05 && Math.floor(yrs) !== this._yr) { this._yr = Math.floor(yrs); if (yrs > 1.2) app.sfx?.play?.('creak', { at: L.c, vol: 0.25 + 0.5 * k }); }
  }
  _end() {
    this.done = true;
    const K = MISTAKES[this.kind], en = LANG === 'en', b = this.el?.querySelector('.m-bill');
    if (b) { b.textContent = en ? `Saved: $${K.saved} (the bars) → the repair: $${K.repair.toLocaleString('en-US')}` : `Сэкономили: $${K.saved} (арматура) → ремонт: $${K.repair.toLocaleString('en-US')}`; b.style.opacity = 1; }
  }
  stop() {
    if (!this.on) return;
    const app = this.app, wv = app.wallView;
    this.on = false; this.done = false; this.fell = false;
    if (this.root) { app.scene.remove(this.root); this.halves?.dispose(); this.cracks?.geometry.dispose(); this.crackMat?.dispose(); this.root = null; }
    for (const c of this.colors) { c.im.instanceColor.array.set(c.orig); c.im.instanceColor.needsUpdate = true; }
    this.el?.remove(); this.el = null; this.note = '';
    if (this.h0 != null) app.sky?.setHour?.(this.h0);
    wv.frozen = false; wv.dirty = true; wv.update?.();
  }
  stats() { return { on: this.on, done: this.done, sag: (this.sag || 0) * S, cracks: this.cracks?.count || 0, fell: this.units?.filter((u) => u.fall).length || 0, arch: this.units?.filter((u) => u.inA).length || 0 }; }
}
