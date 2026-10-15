import { BUILD, MODEL_SCALE, MACHINES_ENABLED } from '../config.js';
import { bbox, contains } from '../world/outlines.js';

const $ = (id) => document.getElementById(id);
const real = (mmModel) => mmModel * MODEL_SCALE / 10; // model mm → real cm

const HINTS = {
  camera: 'Один палец — облёт и наклон. Два пальца — двигать участок, щипок — масштаб, поворот. Двойной тап — фокус.',
  shovel: 'Проведите пальцем по земле — лопата срежет слой грунта',
  rake: 'Ведите пальцем по кучке — грабли срежут верх и растащат грунт ровным слоем. Тяните к себе несколько раз',
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
    none: 'Выберите машину — вся техника стоит на стоянке у дальнего края',
    excavator: 'Джойстик — ехать. Проведите пальцем по земле от дальней точки к кабине — экскаватор сделает копок',
    exHold: 'Ковш полон. Коснитесь места в зоне вылета стрелы — повернёт и высыплет',
    exBusy: 'Экскаватор работает… (отмена — стрелка назад)',
    exManual: 'Левый: ←→ поворот, ↑↓ рукоять. Правый: ↑↓ стрела, ←→ ковш (как в кабине, ISO)',
    exTravel: 'Левый джойстик — ехать на гусеницах. Правый: ↑↓ стрела, ←→ ковш',
    tractor: 'Джойстик — ехать. «Ковш вниз» — срезает грунт по пути, «Высыпать» — опрокинуть ковш',
    mixer: 'Джойстик — ехать. Барабан: замес или выгрузка, лоток — поворот',
    pump: 'Джойстик — перекатить прицепной бетононасос',
  },
};

export class UI {
  constructor(app) {
    this.app = app;
    this.statT = 0;
    $('build').textContent = `BUILD ${BUILD}`;
    if (!MACHINES_ENABLED) document.querySelector('[data-tool="machine"]')?.setAttribute('hidden', '');
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => app.setTool(b.dataset.tool)));
    $('btn-undo').addEventListener('click', () => app.undo());
    $('btn-redo').addEventListener('click', () => app.redo());
    $('btn-level').addEventListener('click', () => { app.settings.level = !app.settings.level; app.applySettings(); });
    $('btn-menu').addEventListener('click', () => this.openMenu(true));
    $('menu-close').addEventListener('click', () => this.openMenu(false));
    $('act-quiet').addEventListener('click', () => { this.setQuiet(true); this.openMenu(false); });
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
      const tools = ['camera', 'shovel', 'rake', 'mark', 'form', 'rebar', 'machine'];
      if (e.key >= '1' && e.key <= '7') app.setTool(tools[+e.key - 1]);
      if (e.key.toLowerCase() === 'q') this.setQuiet(!app.settings.quiet);
    });
    this.bindSettings();
    this.bindRecording();
    this.bindQuiet();
    this.bindJoystick();
    this.bindJoystick('joy2', 'joy2-knob', (x, y) => this.app.machineTool.manual('r', x, y));
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
  bindJoystick(elId = 'joy', knobId = 'joy-knob', cb = (x, y) => this.app.machineTool.joystick(x, y)) {
    const el = $(elId), knob = $(knobId);
    let id = null;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
      // small dead zone, then a soft curve for fine control
      const f = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.12) / 0.88;
      cb(f(x) * Math.abs(f(x)) ** 0.5, f(y));
    };
    el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture(id); this.app.sfx.unlock(); set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; cb(0, 0); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  openMenu(open) {
    $('menu').hidden = !open;
    if (open) {
      $('journal-count').textContent = this.app.journal.done.length;
      $('track-len').textContent = Math.round(this.app.recorder.duration);
      // diagnostics for reports from phones: which soil shader runs, GPU errors
      const a = this.app, gl = a.renderer.getContext();
      const which = a.terrain.mesh.material === a.fallbackMat ? 'простой' : a.lightMat && a.terrain.mesh.material === a.lightMat ? 'упрощённый' : 'полный';
      $('diag').textContent = `Диагностика: грунт — ${which}; GPU — ${gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)} текстур` + (a.shaderErrors.length ? `; ошибка: ${a.shaderErrors[0].slice(0, 300)}` : '');
    }
  }

  // ---- clean video of the 3D view -----------------------------------------------------------
  bindRecording() {
    const v = this.app.video;
    $('btn-rec').addEventListener('click', () => this.toggleRec());
    $('recpill').addEventListener('click', () => this.toggleRec());
    $('vs-save').addEventListener('click', async () => { await v.save(); $('vsheet').hidden = true; v.discard(); });
    $('vs-del').addEventListener('click', () => { $('vsheet').hidden = true; v.discard(); });
  }

  async toggleRec() {
    const v = this.app.video;
    this.fan(false);
    if (v.recording) {
      const r = await v.stop();
      if (r) {
        const s = Math.round(r.seconds);
        $('vs-info').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${(r.blob.size / 1048576).toFixed(1)} МБ · ${r.type.includes('mp4') ? 'MP4' : 'WebM'} — только сцена, без кнопок`;
        $('vsheet').hidden = false;
      }
    } else if (!v.supported) this.toast('Этот браузер не умеет записывать видео');
    else if (v.start()) this.toast('Запись идёт — кнопок в видео не будет');
    this.refresh();
  }

  // ---- quiet mode: one round button, the tools fan out of it -----------------------------------
  bindQuiet() {
    $('fab').addEventListener('click', () => this.fan(!this.fanOpen));
    $('fan-shade').addEventListener('pointerdown', (e) => { e.preventDefault(); this.fan(false); });
    this.setQuiet(!!this.app.settings.quiet, false);
  }

  buildFan() {
    const app = this.app, box = $('fan-items');
    box.innerHTML = '';
    const tools = [...document.querySelectorAll('.tools .tool')].filter((b) => !b.hidden);
    const acts = [
      { svg: $('btn-undo').innerHTML, label: 'Отменить', fn: () => app.undo(), keep: true, id: 'undo' },
      { svg: $('btn-rec').innerHTML, label: 'Запись', fn: () => this.toggleRec(), id: 'rec' },
      { svg: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', label: 'Все панели', fn: () => this.setQuiet(false), id: 'exit' },
    ];
    const place = (el, r, a) => { el.style.setProperty('--x', `${-r * Math.cos(a)}px`); el.style.setProperty('--y', `${-r * Math.sin(a)}px`); };
    const R1 = 200, R2 = 98;
    this.fanItems = [];
    tools.forEach((b, k) => {
      const el = document.createElement('button');
      el.className = 'fan-item';
      el.innerHTML = b.querySelector('svg').outerHTML + `<span>${b.querySelector('span').textContent}</span>`;
      place(el, R1, (k / Math.max(1, tools.length - 1)) * Math.PI / 2);
      el.addEventListener('click', () => {
        if (b.dataset.tool) { app.setTool(b.dataset.tool); this.toast(b.querySelector('span').textContent); this.fan(false); } else b.click();
        this.refresh();
      });
      box.appendChild(el);
      this.fanItems.push({ el, tool: b.dataset.tool, src: b });
    });
    acts.forEach((a, k) => {
      const el = document.createElement('button');
      el.className = 'fan-item';
      el.innerHTML = a.svg + `<span>${a.label}</span>`;
      place(el, R2, (0.12 + k * 0.38) * Math.PI / 2 / 0.88);
      el.addEventListener('click', () => { a.fn(); if (!a.keep) this.fan(false); this.refresh(); });
      box.appendChild(el);
      this.fanItems.push({ el, act: a.id });
    });
  }

  setQuiet(on, save = true) {
    const app = this.app;
    app.settings.quiet = on;
    if (save) app.applySettings();
    $('ui').classList.toggle('quiet', on);
    $('fan').hidden = !on;
    if (on) { this.buildFan(); this.toast('Тихий режим: инструменты — в круглой кнопке'); }
    this.fan(false);
    this.refresh();
  }

  fan(open) {
    this.fanOpen = !!open && !!this.app.settings.quiet;
    $('fan').classList.toggle('open', this.fanOpen);
    $('fan-shade').hidden = !this.fanOpen;
  }

  renderFan() {
    if (!this.app.settings.quiet || !this.fanItems) return;
    const app = this.app, rec = app.video.recording;
    for (const it of this.fanItems) {
      if (it.tool) it.el.classList.toggle('active', it.tool === app.tool);
      else if (it.src) it.el.classList.toggle('on', it.src.classList.contains('on'));
      if (it.act === 'rec') it.el.classList.toggle('recon', rec);
      if (it.act === 'undo') it.el.disabled = !app.journal.canUndo && !app.busy();
    }
    const cur = document.querySelector(`.tools [data-tool="${app.tool}"] svg`);
    const key = app.tool;
    if (cur && this._fabKey !== key) { $('fab').innerHTML = cur.outerHTML; this._fabKey = key; }
    $('fan').classList.toggle('rec', rec);
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
        C('Фото-фон', b === 'posters', () => app.setBackdrop('posters')),
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
        C('Экскаватор', mt.active === 'excavator', () => mt.select('excavator')),
        C('Трактор', mt.active === 'tractor', () => mt.select('tractor')),
        C('Миксер', mt.active === 'mixer', () => mt.select('mixer')),
        C('Бетононасос', mt.active === 'pump', () => mt.select('pump')),
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
    const m = mt.machine;
    const manual = show && m.kind === 'excavator' && m.mode === 'manual';
    $('joy').hidden = !show;
    $('joy2').hidden = !manual;
    const box = $('mbtns');
    box.hidden = !show;
    box.classList.toggle('up', manual);
    if (!show) { this._mKey = null; return; }
    let btns = [];
    if (m.kind === 'excavator') {
      btns = [['Авто', () => mt.setExMode('auto'), m.mode === 'auto'], ['Ручное', () => mt.setExMode('manual'), m.mode === 'manual']];
      if (manual) btns.push([m.manualTravel ? 'Левый: ход' : 'Левый: стрела', () => mt.toggleTravel(), !!m.manualTravel]);
    } else if (m.kind === 'tractor') {
      btns = [['Ковш вниз', () => mt.loader('dig'), m.mode === 'dig'], ['Везти', () => mt.loader('carry'), m.mode === 'carry'],
        ['Поднять', () => mt.loader('raise'), m.mode === 'raise'], ['Высыпать', () => mt.loader('dump'), m.mode === 'dump']];
    } else if (m.kind === 'mixer') {
      btns = [['Замес', () => mt.drum(1), m.drumSpeed > 0], ['Выгрузка', () => mt.drum(-1), m.drumSpeed < 0],
        ['Лоток ←', () => mt.chute(0.35), false], ['Лоток →', () => mt.chute(-0.35), false]];
    }
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
    if (t === 'rake') hint = app.rakeTool.busy ? '' : HINTS.rake;
    if (t === 'mark') hint = HINTS.mark[app.markTool.mode];
    if (t === 'form') hint = HINTS.form[app.formTool.mode];
    if (t === 'rebar') hint = HINTS.rebar[app.rebarTool.mode];
    if (t === 'machine') {
      const mt = app.machineTool;
      hint = HINTS.machine[mt.active || 'none'];
      const ex = mt.machines.excavator;
      if (mt.active === 'excavator' && ex) {
        if (!ex.nodes) hint = 'Загружаю модель экскаватора…';
        else if (ex.mode === 'manual') hint = ex.manualTravel ? HINTS.machine.exTravel : HINTS.machine.exManual;
        else if (mt.excavatorState === 'hold') hint = HINTS.machine.exHold;
        else if (mt.excavatorState !== 'idle') hint = HINTS.machine.exBusy;
      }
    }
    if (this._hint !== hint) { $('hint').textContent = hint; this._hint = hint; }
    $('hint').classList.toggle('top', t === 'machine');
    this.renderChips();
    this.renderParams();
    this.renderMachineControls();
    this.renderFan();
    const rec = this.app.video.recording;
    $('btn-rec').classList.toggle('on', rec);
    $('recpill').hidden = !rec;
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
    if (app.video.recording) { const s = Math.floor(app.video.seconds); $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
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
