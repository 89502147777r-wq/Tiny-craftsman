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
  down(p) {
    if (!this._on(p.x, p.z)) return true;
    this.drag = { a: [p.x, p.z], b: [p.x, p.z], y: p.y };
    return true;
  }
  move(p) {
    const D = this.drag; if (!D) return;
    let dx = p.x - D.a[0], dz = p.z - D.a[1];
    // (nearly along an axis: along it — foundations here are square to the plot)
    if (Math.abs(dz) < Math.abs(dx) * 0.14) dz = 0; else if (Math.abs(dx) < Math.abs(dz) * 0.14) dx = 0;
    D.b = [D.a[0] + dx, D.a[1] + dz];

  }
  up() {
    const D = this.drag; this.drag = null; if (!D) return;
    const app = this.app, L = Math.hypot(D.b[0] - D.a[0], D.b[1] - D.a[1]) / S;
    if (L < 300) { app.ui?.toast(en() ? 'Too short — draw along the wall, at least 0.3 m' : 'Коротко — ведите вдоль стены, от 0,3 м'); return; }
    if (!this._on(D.b[0], D.b[1])) { app.ui?.toast(en() ? 'Its end is off the plot' : 'Конец линии — за участком'); return; }
    // (longer than a roll: the next strip lapped 150 over the end of the one before — the realist)
    const n = Math.ceil((L - DPC.endLap) / (DPC.len - DPC.endLap)), ux = (D.b[0] - D.a[0]) / (L * S), uz = (D.b[1] - D.a[1]) / (L * S), recs = [];
    for (let i = 0; i < n; i++) {
      const s0 = i * (DPC.len - DPC.endLap), s1 = Math.min(L, s0 + DPC.len), P = (s) => [+(D.a[0] + ux * s * S).toFixed(6), +(D.a[1] + uz * s * S).toFixed(6)];
      const top = D.y - this.app.terrain.heightAt(D.a[0], D.a[1]) > MM(20);   // (touched on a course of masonry, not on the ground: it lies flat on that top)
      recs.push({ type: 'dpc', a: P(s0), b: P(s1), y: +(D.y).toFixed(6), w: this.W, ...(top ? { top: 1 } : {}) });
    }
    const ids = []; app.journal.act('dpc-add', {}, app.clock, () => { for (const r of recs) ids.push(app.objects.add(r).id); });
    for (const id of ids) this.lay(id);
    app.ui?.toast(en() ? `Damp-proof course: ${(L / 1000).toFixed(1)} m × ${this.W} mm — torched down` : `Отсечная гидроизоляция: ${(L / 1000).toFixed(1).replace('.', ',')} м × ${this.W} мм — наплавляют`);
  }
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
    return en() ? `Damp-proof course ${this.W} mm: draw the wall's line on its base — concrete, ground, masonry: the roll is torched down along it`
      : `Гидроизоляция ${this.W} мм: ведите линию стены по основанию — бетону, грунту, кладке: рулон наплавят вдоль неё`;
  }
}
