import * as THREE from 'three';
import { MODEL_SCALE, TRAY } from '../config.js';
import { uStrength } from './lintels.js';
import {
  POOL, POOL_LAYERS, MOSAICS, COPES, newPool, poolFits, pitOutline, pitBox, floorBelt, wallBelt, floorCage, wallCage, faces, cellsOf, sheetsOf, sheetRect, faceStr,
  copeLayout, hitInner, hitRim, hitGround, slabRect, PW, PF, wallTopY, waterMax, isPoolBelt,
} from '../world/pool.js';

// The pool done by the finger (pool.js): «Бассейн» → its stages one after the other. The pit,
// the crushed stone, the lean concrete and the concrete are done with the tools of the house
// (Земля, Материалы, Бетон); here: setting it out, the formwork, the cages, stripping, the
// coating, the mosaic, the coping, the water, the lights.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const _ray = new THREE.Raycaster();
const NAME = Object.fromEntries(POOL_LAYERS);
const BRUSH = 230;            // the coating brush (a roller 250 wide)
const FILL = 45, DRAIN = 70;  // mm a second (the game's garden hose and pump: 12× real)

export class PoolWork {
  constructor(app) { this.app = app; this.drag = null; this.sel = null; }
  get layer() { return NAME[this.app.settings.poolLayer] ? this.app.settings.poolLayer : 'pit'; }
  get mos() { return MOSAICS[this.app.settings.poolMos] ? this.app.settings.poolMos : 'turq'; }
  get copeCol() { return COPES[this.app.settings.poolCope] ? this.app.settings.poolCope : 'trav'; }
  get rec() { const all = this.app.objects.all('pool'); return all.find((r) => r.id === this.sel) || all.at(-1) || null; }
  // the pool at a point: the one whose pit it is in, else the nearest
  pick(p) {
    const all = this.app.objects.all('pool');
    if (!p || !all.length) return this.rec;
    let best = null, bd = Infinity;
    for (const r of all) { const [x0, z0, x1, z1] = pitBox(r), d = Math.hypot(Math.max(0, x0 - p.x, p.x - x1), Math.max(0, z0 - p.z, p.z - z1)); if (d < bd) bd = d, best = r; }
    if (best) this.sel = best.id;
    return best;
  }
  _rayOf(e) { if (!e || e.clientX === undefined) return null; _ray.setFromCamera(this.app.gestures.ndc(e.clientX, e.clientY), this.app.camera); return _ray.ray; }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  _live(l) { this.app.poolView?.setLive(l); }
  _belts(r) { const O = this.app.objects; return { fb: r.floor != null ? O.get(r.floor) : null, wb: r.wall != null ? O.get(r.wall) : null }; }
  toast(m) { this.app.ui?.toast(m); }

  down(p, e) {
    const app = this.app, L = this.layer;
    if (L === 'pit') {
      const ray = this._rayOf(e), q = (ray && hitGround(ray, TRAY.soil)) || p;
      const near = app.objects.all('pool').find((r) => { const [x0, z0, x1, z1] = pitBox(r); return q.x > x0 && q.x < x1 && q.z > z0 && q.z < z1; });
      if (near) { this.sel = near.id; this.toast(this.status(false)); return true; }
      this.drag = { L, q };
      this._ghost(q);
      return true;
    }
    const r = this.pick(p);
    if (!r) { this.toast('Сначала «1 · Котлован»: коснитесь места бассейна на участке'); return true; }
    const { fb, wb } = this._belts(r);
    if (L === 'form1') return this._form1(r, fb), true;
    if (L === 'cage1') return this._cage1(r, fb), true;
    if (L === 'cage2') return this._cage2(r, fb), true;
    if (L === 'form2') return this._form2(r, fb, wb), true;
    if (L === 'strip') return this._strip(r, fb, wb), true;
    if (L === 'light') {
      if (!wb) { this.toast('Прожекторы ставятся в опалубку стен вместе с закладными'); return true; }
      const on = !r.light;
      this._save('pool-light', () => app.objects.update(r.id, { light: on }));
      this.toast(on ? 'Подсветка включена — в сумерках и ночью вода засветится' : 'Подсветка выключена');
      return true;
    }
    // the work inside the bowl: after the walls are stripped
    if (!wb || !wb.stripped) { this.toast(!wb ? 'Сначала чаша: днище, стены, бетон' : !(wb.fill >= 0.95) ? 'Стены ещё не залиты бетоном' : 'Сначала снимите опалубку стен («Снять опалубку»)'); return true; }
    const live = JSON.parse(JSON.stringify(r));
    if (L === 'proof') { this.drag = { L, live, touched: new Set() }; this._paint(e); }
    else if (L === 'tile') { this.drag = { L, live, said: false }; this._tile(e); }
    else if (L === 'cope') { live.copeCol = this.copeCol; this.drag = { L, live }; this._cope(e); }
    else if (L === 'water') {
      if (app.settings.poolWater === 'drain' && !(r.water > 1)) { this.toast('Воды в чаше нет'); return true; }
      this.drag = { L, live, t: 0 };
      app.poolView.fillAt = { id: r.id, on: app.settings.poolWater !== 'drain', show: true };
      this.toast(app.settings.poolWater === 'drain' ? 'Насос откачивает воду — держите палец' : (r.tile || []).some((s) => /[a-z]/.test(s)) ? 'Шланг в чаше — держите палец, вода набирается' : 'Шланг в чаше — держите палец: вода на испытание герметичности чаши (до плитки её сливают)');
    }
    this._live(live);
    return true;
  }

  move(p, e) {
    const d = this.drag; if (!d) return;
    if (d.L === 'pit') { const ray = this._rayOf(e), q = (ray && hitGround(ray, TRAY.soil)) || p; d.q = q; this._ghost(q); return; }
    if (d.L === 'proof') this._paint(e);
    else if (d.L === 'tile') this._tile(e);
    else if (d.L === 'cope') this._cope(e);
  }

  update(dt) {
    const d = this.drag; if (!d || d.L !== 'water') return;
    const r = d.live, max = waterMax(r), drain = this.app.settings.poolWater === 'drain';
    const lv = Math.max(0, Math.min(max, (r.water || 0) + (drain ? -DRAIN : FILL) * dt));
    if (lv !== r.water) { r.water = lv; this._live(r); }
    if (!drain && lv >= max && !d.full) { d.full = true; this.toast('Вода на 100 мм ниже борта — середина скиммеров. Отпустите'); }
    this.app.sfx?.scrapeLevel?.(0);
  }

  up() {
    const app = this.app, d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.L === 'pit') {
      this._live(null);
      app.ui?.hideMeasure?.();
      const { rec, snapped } = newPool(app, d.q, !!app.settings.poolTurn);
      const why = poolFits(app, rec);
      if (why) { this.toast(why); return; }
      this._save('pool-set-out', () => { const out = app.objects.add(pitOutline(rec)); const pr = app.objects.add({ ...rec, pit: out.id }); this.sel = pr.id; app.objects.update(out.id, { poolId: pr.id }); });
      this.toast(`Бассейн ${POOL.L / 1000} × ${POOL.W / 1000} м${snapped ? ' — по проекту' : ''}: размечен котлован ${((POOL.L + 1700) / 1000).toFixed(1)} × ${((POOL.W + 1700) / 1000).toFixed(1)} м глубиной 1,85 м. Копайте («Земля» или погрузчик) до отметки, потом щебень 200 мм + виброплита, подбетонка 100 мм шлангом. Дальше «2 · Опалубка днища»`.replace(/(\d)\.(\d)/g, '$1,$2'));
      return;
    }
    const r = d.live, id = r.id;
    if (d.L === 'water') {
      app.poolView.fillAt = { id, on: false, show: false };
      const lv = Math.round(r.water || 0);
      this._save('pool-water', () => app.objects.update(id, { water: lv }));
      this._live(null);
      this.toast(lv > 1 ? `Вода: ${(lv / 1000).toFixed(2).replace('.', ',')} м${lv >= waterMax(r) - 1 ? ' — полная чаша' : ''}` : 'Чаша пустая');
      return;
    }
    const patch = d.L === 'proof' ? { proof: r.proof } : d.L === 'tile' ? { tile: r.tile } : { cope: r.cope, copeCol: r.copeCol };
    this._save('pool-' + d.L, () => app.objects.update(id, patch));
    this._live(null);
    const msg = this._progress(app.objects.get(id), d.L);
    if (msg) this.toast(msg);
  }

  interrupt() { if (!this.drag) return; if (this.drag.L === 'water') this.app.poolView.fillAt = null; if (this.drag.L === 'pit') this.app.ui?.hideMeasure?.(); this.drag = null; this._live(null); }

  // ---- setting out ----------------------------------------------------------------------------
  _ghost(q) {
    const app = this.app, { rec, snapped } = newPool(app, q, !!app.settings.poolTurn);
    this._live(rec);
    const why = poolFits(app, rec);
    app.ui?.showMeasure?.(why || `Бассейн ${POOL.L / 1000} × ${POOL.W / 1000} м${snapped ? ' · по проекту' : ''}`.replace('.', ','));
  }

  // ---- the bowl ---------------------------------------------------------------------------------
  // the bottom slab's edge boards on the lean concrete: where it is (its top measured there)
  _form1(r, fb) {
    const app = this.app, t = app.terrain;
    if (fb) { this.toast(fb.fill > 0.05 ? 'Днище уже залито — дальше «4 · Арматура стен»' : 'Опалубка днища уже стоит — дальше «3 · Арматура днища»'); return; }
    // the bed: the middle height of the pit's floor under the slab (crushed stone, lean concrete)
    const [s0, t0, s1, t1] = slabRect(r), hs = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 6; j++) { const [x, z] = PW(r, s0 + (s1 - s0) * i / 12, t0 + (t1 - t0) * j / 6); if (t.inside(x, z)) hs.push(t.heightAt(x, z)); }
    hs.sort((a, b) => a - b);
    const bed = hs[Math.floor(hs.length / 2)], design = wallTopY(r) - MM(POOL.wallH + POOL.F), dmm = Math.round((bed - design) / S);
    if (dmm > 120) { this.toast(`Котлован не готов: дно на ${dmm} мм выше отметки. Копайте до −1,85 м, щебень 200 мм с виброплитой, подбетонка 100 мм — днище чаши ложится на −1,55 м`); return; }
    const ft = bed + MM(POOL.F), hw = Math.round((wallTopY(r) - ft) / S);
    this._save('pool-form1', () => { const b = app.objects.add(floorBelt({ ...r }, bed)); app.objects.update(r.id, { floor: b.id, ft: +ft.toFixed(6), hw }); });
    this.toast(`Опалубка днища: доски по краю плиты ${((r.L + 700) / 1000).toFixed(1)} × ${((r.W + 700) / 1000).toFixed(1)} м, 250 мм.${dmm < -120 ? ` Дно ниже отметки на ${-dmm} мм — стены выйдут выше (${hw} мм).` : ''} Дальше «3 · Арматура днища»`.replace(/(\d)\.(\d)/g, '$1,$2'));
  }
  _cage1(r, fb) {
    const app = this.app;
    if (!fb) { this.toast('Сначала «2 · Опалубка днища»'); return; }
    if (r.cage1 != null && app.objects.get(r.cage1)) { this.toast('Арматура днища уже связана — заливайте: «Бетон» → шланг по днищу, вибратор, правило по доскам'); return; }
    this._save('pool-cage1', () => { const c = app.objects.add(floorCage(r, fb.top)); app.objects.update(r.id, { cage1: c.id }); });
    this.toast('Две сетки Ø12 шаг 200 на стульчиках и «лягушках», выпуски под стены. Теперь бетон: «Бетон» → шланг по днищу, вибратор, правило по доскам');
  }
  _cage2(r, fb) {
    const app = this.app;
    if (!fb || !(fb.fill >= 0.95)) { this.toast(!fb ? 'Сначала днище' : 'Днище ещё не залито доверху — «Бетон» → шланг'); return; }
    if (r.cage2 != null && app.objects.get(r.cage2)) { this.toast('Арматура стен уже стоит — дальше «5 · Опалубка стен и закладные»'); return; }
    this._save('pool-cage2', () => { const c = app.objects.add(wallCage(r)); app.objects.update(r.id, { cage2: c.id }); });
    this.toast('Стены: вертикали и горизонтали Ø12 шаг 200 в две сетки, связаны с выпусками; по шву — бентонитовый шнур. Дальше «5 · Опалубка стен и закладные»');
  }
  _form2(r, fb, wb) {
    const app = this.app;
    if (wb) { this.toast(wb.fill > 0.05 ? 'Стены уже залиты' : 'Опалубка стен стоит — заливайте: «Бетон» → шланг по верху щитов, вибратор'); return; }
    if (!(r.cage2 != null && app.objects.get(r.cage2))) { this.toast('Сначала «4 · Арматура стен»'); return; }
    if (uStrength(fb, app.clock) < 0.5) { this.toast(`Днище набирает прочность: ${Math.round(uStrength(fb, app.clock) * 200)} % от нужной для щитов — подождите`); return; }
    this._save('pool-form2', () => { const b = app.objects.add(wallBelt(r)); app.objects.update(r.id, { wall: b.id }); });
    this.toast(`Щиты с двух сторон, ригели, стяжки; в щитах закладные: 2 скиммера, 3 форсунки, 2 прожектора, донный слив. Стены ${((r.hw || POOL.wallH) / 1000).toFixed(2).replace('.', ',')} м — заливайте: «Бетон» → шланг по верху щитов, вибратор`);
  }
  _strip(r, fb, wb) {
    const app = this.app, todo = [], wait = [];
    for (const b of [fb, wb]) {
      if (!b || b.stripped) continue;
      if (!(b.fill >= 0.95)) { wait.push(b.part === 'floor' ? 'днище не залито' : 'стены не залиты'); continue; }
      const k = uStrength(b, app.clock);
      if (k < 1) { wait.push(`${b.part === 'floor' ? 'днище' : 'стены'}: прочность ${Math.round(k * 100)} %`); continue; }
      todo.push(b);
    }
    if (!todo.length) { this.toast(wait.length ? 'Рано снимать: ' + wait.join(', ') : !wb ? 'Снимать нечего — опалубка стен ещё не стоит' : 'Опалубка уже снята'); return; }
    this._save('pool-strip', () => { for (const b of todo) app.objects.update(b.id, { stripped: true, set: true }); });
    this.toast(todo.some((b) => b.part === 'wall') ? 'Щиты, ригели и стяжки сняли — чаша готова. Пазухи можно засыпать; внутри — «7 · Гидроизоляция»' : 'Доски днища сняли');
  }

  // ---- inside the bowl ----------------------------------------------------------------------
  _paint(e) {
    const d = this.drag, r = d.live, ray = this._rayOf(e); if (!ray) return;
    const h = hitInner(r, ray); if (!h) return;
    const F = faces(r), C = POOL.cell;
    r.proof = r.proof || [];
    let changed = false;
    for (const f of F) {
      const [ni, nj] = cellsOf(f), str = faceStr(r.proof, f.k, ni * nj).split('');
      let any = false;
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const p = f.P((i + 0.5) * C, (j + 0.5) * C);
        if ((p[0] - h.s) ** 2 + (p[1] - h.t) ** 2 + (p[2] - h.y) ** 2 > BRUSH * BRUSH) continue;
        const key = f.k * 100000 + j * ni + i;
        if (d.touched.has(key)) continue;   // (a coat a stroke)
        d.touched.add(key);
        if (str[j * ni + i] < '2') { str[j * ni + i] = String(+str[j * ni + i] + 1); any = true; }
      }
      if (any) { r.proof[f.k] = str.join(''); changed = true; }
    }
    for (let k = 0; k < 5; k++) if (r.proof[k] == null) r.proof[k] = '';
    if (changed) this._live(r);
  }
  _tile(e) {
    const d = this.drag, r = d.live, ray = this._rayOf(e); if (!ray) return;
    const h = hitInner(r, ray); if (!h) return;
    const F = faces(r), f = F[h.k], [ni, nj] = sheetsOf(f), letter = MOSAICS[this.mos][3];
    r.tile = r.tile || [];
    const str = faceStr(r.tile, f.k, ni * nj).split(''), [ci, cj] = cellsOf(f), coat = faceStr(r.proof, f.k, ci * cj);
    let changed = false;
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const [a0, b0, a1, b1] = sheetRect(f, i, j);
      // the sheet under the finger and those it reaches over (a sheet and a half wide)
      if (Math.max(a0 - h.a, h.a - a1, 0) > 160 || Math.max(b0 - h.b, h.b - b1, 0) > 160) continue;
      if (str[j * ni + i] === letter) continue;
      // the coating under it: two coats over most of it
      let n = 0, ok = 0;
      for (let b = Math.floor(b0 / POOL.cell); b < Math.ceil(b1 / POOL.cell); b++) for (let a = Math.floor(a0 / POOL.cell); a < Math.ceil(a1 / POOL.cell); a++) { n++; if (coat[b * ci + a] === '2') ok++; }
      if (ok < n * 0.8) { if (!d.said) { d.said = true; this.toast('Мозаика — по гидроизоляции в 2 слоя: сначала «7 · Гидроизоляция» здесь'); } continue; }
      str[j * ni + i] = letter; changed = true;
    }
    if (changed) { r.tile[f.k] = str.join(''); for (let k = 0; k < 5; k++) if (r.tile[k] == null) r.tile[k] = ''; this._live(r); this.app.sfx?.stab?.(); }
  }
  _cope(e) {
    const d = this.drag, r = d.live, ray = this._rayOf(e); if (!ray) return;
    const q = hitRim(r, ray); if (!q) return;
    r.cope = r.cope || [];
    let changed = false;
    for (const sd of copeLayout(r)) {
      const str = faceStr(r.cope, sd.side, sd.n).split('');
      for (const st of sd.list) {
        if (str[st.i] === '1') continue;
        // the finger within the stone (or 150 round it)
        const [sA, tA] = sd.P(st.a0, st.c0), [sB, tB] = sd.P(st.a1, st.c1);
        if (q[0] < Math.min(sA, sB) - 150 || q[0] > Math.max(sA, sB) + 150 || q[1] < Math.min(tA, tB) - 150 || q[1] > Math.max(tA, tB) + 150) continue;
        str[st.i] = '1'; changed = true;
      }
      r.cope[sd.side] = str.join('');
    }
    if (changed) { this._live(r); this.app.sfx?.stab?.(); }
  }
  // what is left of a layer (a toast after a stroke)
  _progress(r, L) {
    if (!r) return null;
    const F = faces(r);
    if (L === 'proof') {
      let n = 0, c1 = 0, c2 = 0;
      for (const f of F) { const [ni, nj] = cellsOf(f), s = faceStr(r.proof, f.k, ni * nj); for (const ch of s) { n++; if (ch >= '1') c1++; if (ch === '2') c2++; } }
      return c2 >= n * 0.98 ? 'Гидроизоляция в 2 слоя готова, ленты в углах вклеены — дальше «8 · Мозаика»' : `Гидроизоляция: 1-й слой ${Math.round(c1 / n * 100)} %, 2-й слой ${Math.round(c2 / n * 100)} %. Второй слой — новыми проходами`;
    }
    if (L === 'tile') {
      let n = 0, k = 0;
      for (const f of F) { const [ni, nj] = sheetsOf(f), s = faceStr(r.tile, f.k, ni * nj); for (const ch of s) { n++; if (ch !== '0') k++; } }
      return k >= n ? 'Мозаика уложена и затёрта — дальше «9 · Бортовой камень»' : `Мозаика: ${k} из ${n} листов 316 × 316`;
    }
    if (L === 'cope') {
      let n = 0, k = 0;
      for (const sd of copeLayout(r)) { const s = faceStr(r.cope, sd.side, sd.n); n += sd.n; for (const ch of s) if (ch === '1') k++; }
      return k >= n ? 'Бортовой камень уложен — наполняйте: «10 · Вода»' : `Бортовой камень: ${k} из ${n}`;
    }
    return null;
  }

  status(carry) {
    void carry;
    const r = this.rec, L = this.layer;
    const H = {
      pit: 'Коснитесь участка — разметится бассейн 8 × 3,5 м и котлован под него (рядом с проектом — встанет по проекту)',
      form1: 'Коснитесь котлована — доски опалубки днища встанут на подбетонку',
      cage1: 'Коснитесь днища — две сетки Ø12 и выпуски под стены',
      cage2: 'Коснитесь днища — арматура стен (днище должно быть залито)',
      form2: 'Коснитесь чаши — щиты стен, ригели, стяжки и закладные',
      strip: 'Коснитесь чаши — снимется опалубка, где бетон набрал прочность',
      proof: 'Ведите пальцем по стенам и дну — обмазочная гидроизоляция; второй слой — новыми проходами',
      tile: 'Ведите пальцем по чаше — листы мозаики 316 × 316 ложатся на клей',
      cope: 'Ведите пальцем по краю чаши — бортовой камень ложится на клей',
      water: 'Держите палец — шланг наполняет чашу (или насос сливает)',
      light: 'Коснитесь чаши — включить / выключить подсветку',
    };
    return (!r && L !== 'pit' ? 'Сначала «1 · Котлован». ' : '') + H[L];
  }

  remove(id) {
    const app = this.app, r = app.objects.get(id);
    if (!r) return;
    const { fb, wb } = this._belts(r);
    if ((fb && fb.fill > 0.05) || (wb && wb.fill > 0.05)) { this.toast('Чаша уже забетонирована — её не убрать (отменить можно кнопкой «Назад»)'); return; }
    this._save('pool-remove', () => {
      for (const c of app.objects.all('cage').filter((c) => c.poolId === id)) app.objects.remove(c.id);
      for (const b of [fb, wb]) if (b) app.objects.remove(b.id);
      if (r.pit != null) app.objects.remove(r.pit);
      app.objects.remove(id);
    });
    this.toast('Бассейн убран (котлован остаётся как выкопан)');
  }
  // a pool belt touched with «Удалить»: its formwork off (when ready) or the empty one away
  belt(b) { const r = this.app.objects.get(b.pool); if (!r) return; const { fb, wb } = this._belts(r); this._strip(r, fb, wb); }
}
export { isPoolBelt, PF };
