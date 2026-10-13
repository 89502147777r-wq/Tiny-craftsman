import { BUILD, MODEL_SCALE } from '../config.js';
import { bbox, contains } from '../world/outlines.js';

const $ = (id) => document.getElementById(id);
const real = (mmModel) => mmModel * MODEL_SCALE / 10; // model mm → real cm

const HINTS = {
  camera: 'Один палец — облёт, два — масштаб. Двойной тап — навести фокус.',
  shovel: 'Проведите пальцем по земле — лопата срежет слой грунта',
  loaded: 'Коснитесь места для отвала и отпустите — грунт высыплется',
  mark: {
    edit: 'Тяните круглые метки, чтобы менять контур. Тап по контуру — выбрать.',
    rect: 'Проведите от угла до угла — появится контур котлована',
    trench: 'Ведите пальцем первую часть траншеи, затем тапайте следующие точки → «Готово»',
  },
  form: {
    outline: 'Коснитесь контура — доски встанут по всему периметру, колья снаружи',
    board: 'Проведите линию — встанет ряд досок с кольями',
    delete: 'Коснитесь доски или кола, чтобы убрать ряд',
  },
  rebar: {
    cage: 'Коснитесь контура — разложится каркас (2 сетки или каркас ленты с хомутами)',
    bar: 'Проведите линию — уложится пруток (липнет к осям)',
    mesh: 'Проведите прямоугольник — ляжет кладочная сетка 100×100',
    tie: 'Коснитесь контура с каркасом — свяжем все пересечения проволокой',
    delete: 'Коснитесь стержня, сетки или стульчика, чтобы убрать',
  },
  machine: {
    none: 'Выберите машину — она заедет на участок',
    excavator: 'Джойстик — ехать. Палец по земле — копать ковшом к себе, тап — высыпать',
    tractor: 'Джойстик — ехать. «Копать» опускает ковш: трактор срезает грунт и толкает его',
  },
};

export class UI {
  constructor(app) {
    this.app = app;
    this.statT = 0;
    $('build').textContent = `BUILD ${BUILD}`;
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => app.setTool(b.dataset.tool)));
    $('btn-undo').addEventListener('click', () => app.undo());
    $('btn-redo').addEventListener('click', () => app.redo());
    $('btn-level').addEventListener('click', () => { app.settings.level = !app.settings.level; app.applySettings(); });
    $('btn-menu').addEventListener('click', () => this.openMenu(true));
    $('menu-close').addEventListener('click', () => this.openMenu(false));
    $('act-film').addEventListener('click', () => this.film(true));
    let filmTap = 0;
    $('film-exit').addEventListener('click', () => { const n = performance.now(); if (n - filmTap < 400) this.film(false); filmTap = n; });
    $('act-export').addEventListener('click', () => app.exportProject());
    $('act-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { await app.importProject(f); this.openMenu(false); } catch (err) { alert('Не удалось открыть проект: ' + err.message); }
      e.target.value = '';
    });
    $('act-new').addEventListener('click', async () => {
      if (confirm('Начать новый участок? Текущая стройка и журнал будут удалены с устройства (сначала можно сделать экспорт).')) {
        await app.newProject(); this.openMenu(false);
      }
    });
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); }
      const tools = ['camera', 'shovel', 'mark', 'form', 'rebar', 'machine'];
      if (e.key >= '1' && e.key <= '6') app.setTool(tools[+e.key - 1]);
    });
    this.bindSettings();
    this.bindJoystick();
    this.refresh();
  }

  bindSettings() {
    const s = this.app.settings, app = this.app;
    const bind = (id, key, fmt, parse = Number) => {
      const el = $(id);
      const out = $('o-' + id.split('-')[1]);
      const show = () => { if (out) out.textContent = fmt(s[key]); };
      el.value = s[key];
      show();
      el.addEventListener('input', () => { s[key] = parse(el.value); show(); app.applySettings(); });
    };
    bind('set-bite', 'bite', (v) => `${v} мм (${real(v).toFixed(0)} см в натуре)`);
    bind('set-target', 'target', (v) => `${v} мм (${real(v).toFixed(0)} см)`);
    bind('set-dof', 'dof', (v) => (v < 0.02 ? 'выкл' : `${Math.round(v * 100)}%`));
    bind('set-shovel', 'shovel', () => '', String);
    bind('set-quality', 'quality', () => '', String);
    bind('set-backdrop', 'backdrop', () => '', String);
    bind('set-slab', 'slab', (v) => `${v} мм`);
    bind('set-rebarD', 'rebarD', () => '');
    bind('set-rebarStep', 'rebarStep', (v) => `${v} мм`);
    bind('set-cover', 'cover', (v) => `${v} мм`);
    for (const [id, key] of [['set-shake', 'shake'], ['set-sound', 'sound'], ['set-grade', 'stopAtGrade']]) {
      const el = $(id);
      el.checked = !!s[key];
      el.addEventListener('change', () => { s[key] = el.checked; app.applySettings(); });
    }
  }

  // virtual joystick for the machines (its own pointer, so the canvas gestures stay free)
  bindJoystick() {
    const el = $('joy'), knob = $('joy-knob');
    let id = null;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
      // small dead zone, then a soft curve for fine control
      const f = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.12) / 0.88;
      this.app.machineTool.joystick(f(x) * Math.abs(f(x)) ** 0.5, f(y));
    };
    el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture(id); this.app.sfx.unlock(); set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; this.app.machineTool.joystick(0, 0); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  openMenu(open) {
    $('menu').hidden = !open;
    if (open) {
      $('journal-count').textContent = this.app.journal.done.length;
      $('track-len').textContent = Math.round(this.app.recorder.duration);
    }
  }

  film(on) {
    $('ui').hidden = on;
    $('film-exit').hidden = !on;
    if (on) this.openMenu(false);
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // ---- mode chips per tool ---------------------------------------------------------------------
  chips() {
    const app = this.app, t = app.tool;
    const C = (label, on, fn, cls = '') => ({ label, on, fn, cls });
    if (t === 'camera') {
      const b = app.settings.backdrop;
      return [
        C(app.settings.orbit ? '■ Стоп облёт' : '▶ Облёт', app.settings.orbit, () => { app.settings.orbit = !app.settings.orbit; app.applySettings(); }),
        C('Мастерская', b === 'workshop', () => app.setBackdrop('workshop')),
        C('Стройплощадка 360°', b === 'site', () => app.setBackdrop('site')),
        C('Фото: билборд', b === 'photo1', () => app.setBackdrop('photo1')),
        C('Фото: кран', b === 'photo2', () => app.setBackdrop('photo2')),
      ];
    }
    if (t === 'shovel') {
      return [
        C('Штыковая', app.settings.shovel === 'spade', () => { app.settings.shovel = 'spade'; app.applySettings(); }),
        C('Совковая', app.settings.shovel === 'scoop', () => { app.settings.shovel = 'scoop'; app.applySettings(); }),
      ];
    }
    if (t === 'mark') {
      const m = app.markTool;
      const out = [
        C('Правка', m.mode === 'edit', () => m.setMode('edit')),
        C('＋ Котлован', m.mode === 'rect', () => m.setMode('rect')),
        C('＋ Траншея', m.mode === 'trench', () => m.setMode('trench')),
      ];
      if (m.trench) out.push(C('✓ Готово', true, () => m.finishTrench()));
      if (m.selected && !m.trench) out.push(C('Удалить контур', false, () => m.deleteSelected(), 'warn'));
      return out;
    }
    if (t === 'form' || t === 'rebar') {
      const b = t === 'form' ? app.formTool : app.rebarTool;
      const modes = t === 'form'
        ? [['outline', 'По контуру'], ['board', 'Доска'], ['delete', 'Удалить']]
        : [['cage', 'Каркас'], ['bar', 'Пруток'], ['mesh', 'Сетка'], ['tie', 'Вязать'], ['delete', 'Удалить']];
      return modes.map(([k, l]) => C(l, b.mode === k, () => b.setMode(k), k === 'delete' ? 'warn' : ''));
    }
    if (t === 'machine') {
      const mt = app.machineTool;
      return [
        C('Мини-экскаватор', mt.active === 'excavator', () => mt.select('excavator')),
        C('Мини-трактор', mt.active === 'tractor', () => mt.select('tractor')),
      ];
    }
    return [];
  }

  renderChips() {
    const list = this.chips();
    const key = JSON.stringify(list.map((c) => [c.label, c.on, c.cls]));
    if (key === this._chipKey) return;
    this._chipKey = key;
    const bar = $('subbar');
    bar.innerHTML = '';
    for (const c of list) {
      const b = document.createElement('button');
      b.className = `chip-btn ${c.on ? 'on' : ''} ${c.cls}`;
      b.textContent = c.label;
      b.addEventListener('click', () => { c.fn(); this.refresh(); });
      bar.appendChild(b);
    }
  }

  // sliders for the selected outline (depth, trench width)
  renderParams() {
    const app = this.app, el = $('params');
    const o = app.tool === 'mark' ? app.markTool.rec : null;
    el.hidden = !o;
    if (!o) { this._paramKey = null; return; }
    const key = `${o.id}:${o.kind}`;
    if (key !== this._paramKey) {
      this._paramKey = key;
      el.innerHTML = `<div class="ttl">${o.kind === 'rect' ? 'Котлован' : 'Траншея'} #${o.id}</div>
        <label>Глубина <output id="p-depth"></output><input id="p-depth-r" type="range" min="4" max="85" step="1"></label>
        ${o.kind === 'trench' ? '<label>Ширина <output id="p-width"></output><input id="p-width-r" type="range" min="20" max="80" step="1"></label>' : ''}`;
      const d = $('p-depth-r');
      d.addEventListener('input', () => app.markTool.edit({ depth: +d.value }, false));
      d.addEventListener('change', () => app.markTool.edit({ depth: +d.value }, true));
      const w = $('p-width-r');
      if (w) {
        w.addEventListener('input', () => app.markTool.edit({ width: +w.value / 1000 }, false));
        w.addEventListener('change', () => app.markTool.edit({ width: +w.value / 1000 }, true));
      }
    }
    const d = $('p-depth-r');
    if (document.activeElement !== d) d.value = o.depth;
    $('p-depth').textContent = `${o.depth} мм · ${real(o.depth).toFixed(0)} см`;
    const w = $('p-width-r');
    if (w) { if (document.activeElement !== w) w.value = Math.round(o.width * 1000); $('p-width').textContent = `${(o.width * 1000).toFixed(0)} мм · ${(o.width * MODEL_SCALE * 100).toFixed(0)} см`; }
  }

  renderMachineControls() {
    const app = this.app, mt = app.machineTool;
    const show = app.tool === 'machine' && !!mt.machine;
    $('joy').hidden = !show;
    const box = $('mbtns');
    box.hidden = !show;
    if (!show) { this._mKey = null; return; }
    const m = mt.machine;
    const btns = m.kind === 'excavator'
      ? [[m.t.blade > 0.5 ? 'Отвал ↓' : 'Отвал ↑', () => mt.blade(), m.t.blade < 0.5]]
      : [['Копать', () => mt.loader('dig'), m.mode === 'dig'], ['Везти', () => mt.loader('carry'), m.mode === 'carry'],
        ['Поднять', () => mt.loader('raise'), m.mode === 'raise'], ['Высыпать', () => mt.loader('dump'), m.mode === 'dump']];
    const key = JSON.stringify(btns.map((b) => [b[0], b[2]]));
    if (key === this._mKey) return;
    this._mKey = key;
    box.innerHTML = '';
    for (const [label, fn, on] of btns) {
      const b = document.createElement('button');
      b.textContent = label;
      if (on) b.className = 'on';
      b.addEventListener('click', () => { fn(); this.refresh(); });
      box.appendChild(b);
    }
  }

  refresh() {
    const app = this.app;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === app.tool));
    $('btn-level').classList.toggle('on', !!app.settings.level);
    $('btn-undo').disabled = !app.journal.canUndo && !app.busy();
    $('btn-redo').disabled = !app.journal.canRedo;
    let hint = '';
    const t = app.tool;
    if (t === 'camera') hint = HINTS.camera;
    if (t === 'shovel') {
      const st = app.shovelTool.state;
      hint = st === 'loaded' || st === 'aim' ? HINTS.loaded : st === 'idle' ? HINTS.shovel : '';
    }
    if (t === 'mark') hint = HINTS.mark[app.markTool.mode];
    if (t === 'form') hint = HINTS.form[app.formTool.mode];
    if (t === 'rebar') hint = HINTS.rebar[app.rebarTool.mode];
    if (t === 'machine') {
      const mt = app.machineTool;
      hint = HINTS.machine[mt.active || 'none'];
      if (mt.active === 'excavator' && mt.scoop && (mt.scoop.state === 'loaded' || mt.scoop.state === 'aim')) hint = 'Коснитесь места в зоне вылета стрелы и отпустите — ковш высыплет грунт';
    }
    if (this._hint !== hint) { $('hint').textContent = hint; this._hint = hint; }
    $('hint').classList.toggle('top', t === 'machine' || (t === 'mark' && !!app.markTool.selected));
    this.renderChips();
    this.renderParams();
    this.renderMachineControls();
  }

  setSaveState(s) {
    const i = $('st-save');
    i.classList.toggle('pending', s !== 'saved');
    $('st-save-text').textContent = s === 'saved' ? 'сохранено' : s === 'error' ? 'ошибка сохранения' : 'сохраняю…';
  }

  showMeasure(text) {
    const el = $('measure');
    el.hidden = false;
    el.textContent = text;
  }

  moveMeasure(x, y) {
    const el = $('measure');
    if (el.hidden) return;
    // keep the label on screen (it sits above the finger, centred)
    const half = el.offsetWidth / 2 + 8;
    el.style.left = `${Math.min(window.innerWidth - half, Math.max(half, x))}px`;
    el.style.top = `${Math.max(el.offsetHeight * 1.4 + 8, y - 30)}px`;
  }

  hideMeasure() { $('measure').hidden = true; }

  tick(dt) {
    this.statT += dt;
    if (this.statT < 0.3) return;
    this.statT = 0;
    const app = this.app;
    const v = app.terrain.excavatedVolume();
    $('st-vol').textContent = `${(v * 1e6).toFixed(1)} см³ · ${(v * MODEL_SCALE ** 3).toFixed(2)} м³`;
    // depth of the selected outline (or the first one)
    const outs = app.objects.all('outline');
    const o = (app.markTool.selected && app.objects.get(app.markTool.selected)) || outs[0];
    if (o) {
      const d = app.terrain.regionDepth(bbox(o), (x, z) => contains(o, x, z)).meanDepth * 1000;
      $('st-depth-label').textContent = o.kind === 'rect' ? 'Глубина котлована' : 'Глубина траншеи';
      $('st-depth').textContent = `${d.toFixed(1)} / ${o.depth} мм`;
    } else {
      $('st-depth-label').textContent = 'Разметки нет';
      $('st-depth').textContent = '—';
    }
    this.refresh();
  }
}
