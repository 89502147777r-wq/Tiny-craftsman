import { Disaster, CATS } from '../world/disaster.js';
import { LANG } from '../i18n/i18n.js';

// «Катаклизмы»: the kind, its power (the slider: in its own units — the magnitude, the wind, the wave…),
// «Запустить» — it comes over the house as it stands; «Вернуть как было» — the house back, untouched (it is
// a show: the project is not changed). The finger turns the camera round meanwhile.
export class DisasterTool {
  constructor(app) { this.app = app; this.sim = new Disaster(app); }
  get kind() { return CATS[this.app.settings.catKind] ? this.app.settings.catKind : 'quake'; }
  get power() { return Math.max(1, Math.min(10, +this.app.settings.catPower || 5)); }
  get running() { return this.sim.on && !this.sim.done; }
  down() { return false; }
  move() {}
  up() {}
  interrupt() {}
  update(dt) {
    if (!this.sim.on) return;
    const was = this.sim.done;
    this.sim.update(dt);
    if (this.sim.done && !was) this.app.ui?.toast(this.report());
  }
  async run() {
    const app = this.app;
    if (this.sim.on) this.sim.stop();
    const st = await this.sim.start(this.kind, this.power);
    if (!st.pieces) { this.sim.stop(); app.ui?.toast(LANG === 'en' ? 'Nothing to destroy yet — build a house first' : 'Разрушать пока нечего — сначала постройте дом'); return st; }
    const C = CATS[this.kind];
    app.ui?.toast(`${C.icon} ${LANG === 'en' ? C.en : C.name}: ${C.unit(this.power, LANG === 'en')}`);
    return st;
  }
  reset() { this.sim.stop(); this.app.ui?.toast(LANG === 'en' ? 'The house is back as it was' : 'Дом снова как был'); }
  finish() { if (this.sim.on) this.sim.stop(); }
  // what it did: the masonry down, the roof, the windows — and so: stood / damaged / destroyed
  report() {
    const s = this.sim.stats(), en = LANG === 'en', pc = Math.round(s.share * 100);
    const verdict = pc < 3 && !s.roofsGone ? (en ? 'The house stood' : 'Дом выстоял') : pc < 25 ? (en ? 'The house is damaged' : 'Дом повреждён') : pc < 60 ? (en ? 'The house is badly damaged' : 'Дом сильно разрушен') : (en ? 'The house is destroyed' : 'Дом разрушен');
    return en ? `${verdict}: ${pc}% of the masonry down, roofs torn off ${s.roofsGone}/${s.roofs}, windows broken ${s.windowsGone}/${s.windows}. «Back as it was» — the house returns`
      : `${verdict}: обрушено ${pc}% кладки, сорвано кровли ${s.roofsGone}/${s.roofs}, выбито окон ${s.windowsGone}/${s.windows}. «Вернуть как было» — дом вернётся`;
  }
}
