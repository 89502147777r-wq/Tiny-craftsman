import { MODEL_SCALE } from '../config.js';
import { DPC, dpcStrips, dpcLen } from '../world/dpc.js';
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
  _conc(x, z) { const t = this.app.terrain; return t.inside(x, z) && t.conc[t.index(x, z)] > 1e-6; }
  down(p) {
    if (!this._conc(p.x, p.z)) { this.app.ui?.toast(en() ? 'Draw the wall\'s line on the concrete of the foundation' : 'Ведите линию стены по бетону фундамента'); return true; }
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
    if (L > DPC.len) { app.ui?.toast(en() ? 'A roll is 10 m — draw up to 10 m, then the next' : 'В рулоне 10 м — ведите до 10 м, дальше следующим'); return; }
    if (!this._conc(D.b[0], D.b[1])) { app.ui?.toast(en() ? 'Its end is off the concrete' : 'Конец линии — не на бетоне'); return; }
    const r = { type: 'dpc', a: D.a.map((v) => +v.toFixed(6)), b: D.b.map((v) => +v.toFixed(6)), y: +(D.y).toFixed(6), w: this.W };
    let id; app.journal.act('dpc-add', {}, app.clock, () => { id = app.objects.add(r).id; });
    this.lay(id);
    app.ui?.toast(en() ? `Damp-proof course: ${(L / 1000).toFixed(1)} m × ${this.W} mm — torched down` : `Отсечная гидроизоляция: ${(L / 1000).toFixed(1).replace('.', ',')} м × ${this.W} мм — наплавляют`);
  }
  // the strip(s) of a record laid at their pace (speed: × for a film)
  lay(id, speed = 1) { const v = this.app.dpcView; if (!v) return; this.jobs.push({ id, k: 0, s: 0, speed }); v.setAnim(id, { k: 0, s: 0 }); }
  get busy() { return this.jobs.length > 0; }
  update(dt) {
    const app = this.app, v = app.dpcView; if (!this.jobs.length || !v) return;
    for (const J of [...this.jobs]) {
      const r = app.objects.get(J.id);
      if (!r) { this.jobs.splice(this.jobs.indexOf(J), 1); v.setAnim(J.id, null); continue; }
      const L = dpcLen(r), n = dpcStrips(r).length;
      J.s += DPC.speed * J.speed * dt;
      if (J.s >= L) { J.k++; J.s = 0; if (J.k >= n) { this.jobs.splice(this.jobs.indexOf(J), 1); v.setAnim(J.id, null); app.sfx?.play?.('fabric', { vol: 0.4 }); continue; } }
      v.setAnim(J.id, { k: J.k, s: J.s });
      const F = v.frame(r), at = { x: F.x + F.ux * MM(J.s), y: r.y, z: F.z + F.uz * MM(J.s) };
      app.sfx?.loop?.('dpc-torch', 'torch', 0.55, 1, at, true);
    }
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
    return en() ? `Damp-proof course ${this.W} mm: draw the wall's line on the concrete — the roll is torched down along it`
      : `Гидроизоляция ${this.W} мм: ведите линию стены по бетону — рулон наплавят вдоль неё`;
  }
}
