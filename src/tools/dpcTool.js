import { MODEL_SCALE } from '../config.js';
import { DPC, dpcStrips, dpcLen, dpcSpeed } from '../world/dpc.js';
import { LANG } from '../i18n/i18n.js';

// «Стена» → «Кладка» → «Гидроизоляция»: the damp-proof course rolled out on the foundation before the first course (world/dpc.js).
// The finger draws the wall's line on the concrete (snapped along x or z when nearly so); let go — a strip the chosen
// width (the wall + 100) is cut and torched down along it: the roll pushed on at its pace, the torch at the nip. Wider than
// the roll (1 m): two strips lapped 100, one after the other.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const en = () => LANG === 'en';
export class DpcWork {
  constructor(app) { this.app = app; this.drag = null; this.jobs = []; }
  get W() { const w = +this.app.settings.dpcW; return DPC.widths.includes(w) ? w : DPC.widths[0]; }
  // (on anything — the owner: not only concrete: the ground, sand, gravel, a course of masonry; inside the plot)
  _on(x, z) { return this.app.terrain.inside(x, z); }
  // two touches (the owner, 2026-11-28: «нажал пальцем — появился рулон-фантом, который можно перемещать, а второй раз — регулировать
  // докуда раскатывать»; 2–3 s to lay): the first touch puts a phantom roll where the strip starts — the finger moves it; the next
  // touch, wherever it starts, drags how far it is rolled out (along x or z when nearly so), the phantom strip and its length shown;
  // let go — laid. A touch off the plot drops the plan (the roll put again with the next touch).
  down(p) {
    const P = this.plan;
    if (!this._on(p.x, p.z)) { if (P) { this.plan = null; this._ghost(); this.app.ui?.hideMeasure?.(); } return true; }
    if (!P) { this.plan = { a: [p.x, p.z], y: p.y, b: null }; this.drag = { roll: true }; this.move(p); return true; }
    this.drag = { roll: false }; this.move(p); return true;   // (the second touch, wherever it starts: how far — the finger is the end)
  }
  move(p) {
    const D = this.drag, P = this.plan; if (!D || !P) return;
    if (D.roll) {
      if (!this._on(p.x, p.z)) return;
      const ox = p.x - P.a[0], oz = p.z - P.a[1]; P.a = [p.x, p.z]; P.y = p.y;
      if (P.b) P.b = [P.b[0] + ox, P.b[1] + oz];   // (the way kept: moved with the roll)
    } else {
      let dx = p.x - P.a[0], dz = p.z - P.a[1];
      // (nearly along an axis: along it — foundations here are square to the plot)
      if (Math.abs(dz) < Math.abs(dx) * 0.14) dz = 0; else if (Math.abs(dx) < Math.abs(dz) * 0.14) dx = 0;
      P.b = [P.a[0] + dx, P.a[1] + dz];
    }
    this._ghost();
  }
  // what the plan is now: its length (mm), whether it can be laid, why not
  _check() {
    const P = this.plan; if (!P?.b) return { L: 0, ok: true };
    const L = Math.hypot(P.b[0] - P.a[0], P.b[1] - P.a[1]) / S;
    if (L < 300) return { L, ok: false, why: en() ? 'Too short — at least 0.3 m' : 'Коротко — от 0,3 м' };
    if (!this._on(P.b[0], P.b[1])) return { L, ok: false, why: en() ? 'Its end is off the plot' : 'Конец — за участком' };
    return { L, ok: true };
  }
  _top(P) { return P.y - this.app.terrain.heightAt(P.a[0], P.a[1]) > MM(20); }   // (touched on a course of masonry, not on the ground: it lies flat on that top)
  _ghost() {
    const P = this.plan, v = this.app.dpcView, ui = this.app.ui;
    if (!P) { v?.setGhost(null); return; }
    const c = this._check(); v?.setGhost({ a: P.a, b: P.b, y: P.y, w: this.W, top: this._top(P), ok: c.ok });
    if (!P.b) ui?.showMeasure?.(en() ? 'The roll: move it to the start' : 'Рулон: двигайте к началу');
    else { const m = (c.L / 1000).toFixed(2); ui?.showMeasure?.(c.ok ? (en() ? `${m} m × ${this.W} mm` : `${m.replace('.', ',')} м × ${this.W} мм`) : c.why); }
  }
  up() {
    const D = this.drag; this.drag = null; if (!D) return;
    const app = this.app, P = this.plan; if (!P) return;
    if (D.roll) { this._ghost(); if (!P.b) app.ui?.toast(en() ? 'Now drag how far to roll it out' : 'Теперь тяните — докуда раскатать'); return; }
    const c = this._check();
    if (!c.ok) { app.ui?.toast(c.why); return; }
    const top = this._top(P), a = P.a, b = P.b, y = P.y;
    this.plan = null; this._ghost(); app.ui?.hideMeasure?.();
    this._lay(a, b, y, top, !app.filmMode);
  }
  // one line at once (the films and the tests): from a to b at y — laid as the two touches lay it
  line(p0, p1) {
    const a = [p0.x, p0.z], dx = p1.x - p0.x, dz = p1.z - p0.z;
    const b = [p0.x + (Math.abs(dz) < Math.abs(dx) * 0.14 ? dx : Math.abs(dx) < Math.abs(dz) * 0.14 ? 0 : dx), p0.z + (Math.abs(dz) < Math.abs(dx) * 0.14 ? 0 : dz)];
    this.plan = { a, b, y: p0.y }; const c = this._check(), top = this._top(this.plan); this.plan = null; this._ghost();
    if (!c.ok) { this.app.ui?.toast(c.why); return; }
    this._lay(a, b, p0.y, top, !this.app.filmMode);
  }
  _lay(a, b, y, top, quick) {
    const app = this.app, L = Math.hypot(b[0] - a[0], b[1] - a[1]) / S;
    // (longer than a roll: the next strip lapped 150 over the end of the one before — the realist)
    const n = Math.ceil((L - DPC.endLap) / (DPC.len - DPC.endLap)), ux = (b[0] - a[0]) / (L * S), uz = (b[1] - a[1]) / (L * S), recs = [];
    for (let i = 0; i < n; i++) {
      const s0 = i * (DPC.len - DPC.endLap), s1 = Math.min(L, s0 + DPC.len), Q = (s) => [+(a[0] + ux * s * S).toFixed(6), +(a[1] + uz * s * S).toFixed(6)];
      recs.push({ type: 'dpc', a: Q(s0), b: Q(s1), y: +(y).toFixed(6), w: this.W, ...(top ? { top: 1 } : {}) });
    }
    const ids = []; app.journal.act('dpc-add', {}, app.clock, () => { for (const r of recs) ids.push(app.objects.add(r).id); });
    // (all of it in ≤ 2,4 s — the owner: «очень долго, 2–3 сек»; a roll's real pace when that is quicker; the films keep theirs)
    const total = recs.reduce((s2, r) => s2 + dpcLen(r) * dpcStrips(r).length, 0), k = quick ? Math.max(1, total / (DPC.quick * dpcSpeed(this.W))) : 1;
    for (const id of ids) this.lay(id, k);
    app.ui?.toast(en() ? `Damp-proof course: ${(L / 1000).toFixed(1)} m × ${this.W} mm — torched down` : `Отсечная гидроизоляция: ${(L / 1000).toFixed(1).replace('.', ',')} м × ${this.W} мм — наплавляют`);
  }
  interrupt() { this.drag = null; this.plan = null; this._ghost(); }
  // the strip(s) of a record laid at their pace (speed: × for a film)
  lay(id, speed = 1) { const v = this.app.dpcView; if (!v) return; this.jobs.push({ id, k: 0, s: 0, speed }); if (this.jobs.length === 1) v.setAnim(id, { k: 0, s: 0 }); }
  get busy() { return this.jobs.length > 0; }
  update(dt) {
    const app = this.app, v = app.dpcView; if (!this.jobs.length || !v) return;
    // (one roll at a time — one torch: the next strip when this one is down)
    const J = this.jobs[0], r = app.objects.get(J.id);
    if (!r) { this.jobs.shift(); v.setAnim(J.id, null); if (this.jobs[0]) v.setAnim(this.jobs[0].id, { k: 0, s: 0 }); return; }
    const L = dpcLen(r), sts = dpcStrips(r);
    J.s += dpcSpeed(sts[J.k].w) * J.speed * dt;   // (the same area a second whatever the width — the realist)
    if (J.s >= L) {
      J.k++; J.s = 0;
      if (J.k >= sts.length) { this.jobs.shift(); v.setAnim(J.id, null); app.sfx?.play?.('fabric', { vol: 0.4 }); if (this.jobs[0]) v.setAnim(this.jobs[0].id, { k: 0, s: 0 }); return; }
    }
    v.setAnim(J.id, { k: J.k, s: J.s });
    const F = v.frame(r), at = { x: F.x + F.ux * MM(J.s), y: r.y, z: F.z + F.uz * MM(J.s) };
    app.sfx?.loop?.('dpc-torch', 'torch', 0.55, 1, at, true);
  }
  // the strip under the finger taken off (before the masonry goes on it)
  remove(p) {
    const app = this.app; let best = null, bd = Infinity;
    for (const r of app.objects.all('dpc')) {
      const ax = r.b[0] - r.a[0], az = r.b[1] - r.a[1], L2 = ax * ax + az * az || 1, t = Math.max(0, Math.min(1, ((p.x - r.a[0]) * ax + (p.z - r.a[1]) * az) / L2));
      const d = Math.hypot(p.x - (r.a[0] + ax * t), p.z - (r.a[1] + az * t)); if (d < MM(r.w / 2 + 150) && d < bd) bd = d, best = r;
    }
    if (!best) { app.ui?.toast(en() ? 'Touch a strip of the damp-proof course' : 'Коснитесь полосы гидроизоляции'); return; }
    app.journal.act('dpc-del', {}, app.clock, () => app.objects.remove(best.id)); app.sfx?.play?.('fabric', { vol: 0.5 });
    app.ui?.toast(en() ? 'Torn off' : 'Полосу сорвали');
  }
  status() {
    if (this.plan) return en() ? `Damp-proof course ${this.W} mm: drag how far to roll it out (a touch off the plot — start again)`
      : `Гидроизоляция ${this.W} мм: тяните, докуда раскатать (касание за участком — заново)`;
    return en() ? `Damp-proof course ${this.W} mm: touch where the strip starts — a roll appears, move it with the finger`
      : `Гидроизоляция ${this.W} мм: коснитесь, где начало полосы, — появится рулон, его можно двигать`;
  }


}
