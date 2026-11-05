import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { PROPS, PROP_SEED } from '../world/siteProps.js';
import { LANG } from '../i18n/i18n.js';
const _ray = new THREE.Raycaster();

// «Площадка»: what stands about the site (world/siteProps.js) — put where the finger says, carried by the finger
// when it is in the way, turned, taken away. The choice: a kind (put it), «Переставить» (the default), «Повернуть»,
// «Убрать».
const M = (m) => m / MODEL_SCALE;
export class PropWork {
  constructor(app) { this.app = app; this.drag = null; this.last = null; }
  get mode() { const m = this.app.settings.propMode; return m === 'turn' || m === 'del' || PROPS[m] ? m : 'move'; }
  _at(e, p) {
    const app = this.app, V = app.siteProps; if (!V) return null;
    if (e && e.clientX !== undefined) { _ray.setFromCamera(app.gestures.ndc(e.clientX, e.clientY), app.camera); const id = V.pick(_ray); if (id != null) return app.objects.get(id); }
    // (or the nearest one round the point, within its own size)
    let best = null, bd = Infinity;
    for (const r of app.objects.all('siteprop')) { const d = Math.hypot(r.x - p.x, r.z - p.z); if (d < M((PROPS[r.kind]?.r || 600) / 1000) && d < bd) bd = d, best = r; }
    return best;
  }
  down(p, e) {
    const app = this.app, O = app.objects, mode = this.mode, en = LANG === 'en';
    if (PROPS[mode]) {
      const r = { type: 'siteprop', kind: mode, x: +p.x.toFixed(5), z: +p.z.toFixed(5), yaw: 0 };
      app.journal.act('prop-add', {}, app.clock, () => { this.last = O.add(r).id; });
      app.sfx?.play?.('plank', { vol: 0.5 });
      app.ui?.toast(en ? 'Put down — «Move» carries it, «Turn» turns it' : `${PROPS[mode].name}: поставили — «Переставить» переносит, «Повернуть» поворачивает`);
      return true;
    }
    const r = this._at(e, p);
    if (!r) { app.ui?.toast(en ? 'Touch a thing on the site' : 'Коснитесь вещи на площадке: бытовки, поддона, тачки…'); return true; }
    this.last = r.id;
    if (mode === 'del') { app.journal.act('prop-del', {}, app.clock, () => O.remove(r.id)); app.sfx?.play?.('plank', { vol: 0.4 }); app.ui?.toast(en ? 'Taken away' : `${PROPS[r.kind]?.name || ''}: убрали с площадки`); return true; }
    if (mode === 'turn') { app.journal.act('prop-turn', {}, app.clock, () => O.update(r.id, { yaw: +(((r.yaw || 0) + Math.PI / 4) % (Math.PI * 2)).toFixed(4) })); return true; }
    // carried: it follows the finger over the ground, put down where it is let go
    this.drag = { id: r.id, dx: r.x - p.x, dz: r.z - p.z, x: r.x, z: r.z };
    return true;
  }
  move(p) {
    const D = this.drag; if (!D) return;
    const T = this.app.terrain, m = this.app.siteProps?.meshes.get(D.id); if (!m) return;
    D.x = Math.max(-T.halfX, Math.min(T.halfX, p.x + D.dx)); D.z = Math.max(-T.halfZ, Math.min(T.halfZ, p.z + D.dz));
    this.app.siteProps.place(m, D.x, D.z, this.app.objects.get(D.id)?.yaw);
  }
  up() {
    const D = this.drag; this.drag = null; if (!D) return;
    const O = this.app.objects, r = O.get(D.id); if (!r || (Math.abs(D.x - r.x) < 1e-6 && Math.abs(D.z - r.z) < 1e-6)) return;
    this.app.journal.act('prop-move', {}, this.app.clock, () => O.update(D.id, { x: +D.x.toFixed(5), z: +D.z.toFixed(5) }));
    this.app.sfx?.play?.('block', { vol: 0.3 });
  }
  status() {
    const m = this.mode, en = LANG === 'en';
    if (PROPS[m]) return en ? 'Touch the ground — it is put there' : `Коснитесь земли — ${PROPS[m].name.toLowerCase()} встанет туда`;
    if (m === 'turn') return en ? 'Touch a thing — it turns by 45°' : 'Коснитесь вещи — повернётся на 45°';
    if (m === 'del') return en ? 'Touch a thing — it is taken away' : 'Коснитесь вещи — её уберут с площадки';
    return en ? 'Drag a thing with a finger — it is carried there' : 'Тяните вещь пальцем — её перенесут туда, где отпустите';
  }
}

// the site furnished once, when it is first seen in a place round it (a 360° background): the site office at the back,
// the toilet by it, the skip, the sand, the pallets and the timber by the gate, the mixer, a barrow, cones at the gate
export function seedProps(app) {
  if (app.settings.propsSeeded || app.objects.all('siteprop').length) return;
  app.settings.propsSeeded = true;
  for (const [kind, x, z, yaw] of PROP_SEED) app.objects.add({ type: 'siteprop', kind, x: +M(x).toFixed(5), z: +M(z).toFixed(5), yaw });
}
