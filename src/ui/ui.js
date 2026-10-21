import { BUILD, MODEL_SCALE, MACHINES_ENABLED, MATERIALS, DELIVERY, PUMP, CONCRETE } from '../config.js';
import { bbox, contains } from '../world/outlines.js';
import { PANOS } from '../world/backdrop.js';

const $ = (id) => document.getElementById(id);
const real = (mmModel) => mmModel * MODEL_SCALE / 10; // model mm → real cm

// The menu: groups by stage of the work → their tools → the tool's modes.
// (the tool buttons themselves are in index.html, #toolrow, with data-group)
const GROUPS = [
  { id: 'camera', label: 'Камера', icon: 'camera' },
  { id: 'earth', label: 'Земля', icon: 'shovel' },
  { id: 'mark', label: 'Разметка', icon: 'mark' },
  { id: 'materials', label: 'Материалы', icon: 'sand' },
  { id: 'found', label: 'Фундамент', icon: 'form' },
  { id: 'concrete', label: 'Бетон', icon: 'hose' },
  { id: 'backfill', label: 'Засыпка', icon: 'plate' },
  { id: 'walls', label: 'Стены', icon: 'wall' },
  { id: 'machines', label: 'Техника', icon: 'machine' },
];
const m3 = (v) => `${String(v).replace('.', ',')} м³`;

const HINTS = {
  camera: 'Один палец — облёт и наклон. Два пальца — двигать участок, щипок — масштаб, поворот. Двойной тап — фокус.',
  shovel: 'Проведите пальцем по земле — лопата срежет слой грунта',
  rake: 'Ведите пальцем по кучке — грабли срежут верх и растащат грунт ровным слоем. Тяните к себе несколько раз',
  loaded: 'Коснитесь места для отвала и отпустите — грунт высыплется',
  deliver: (name, v) => `Коснитесь места на участке — самосвал высыплет кучу: ${name.toLowerCase()} ${m3(v)}. Потом лопатой в котлован и граблями разровнять`,
  hose: 'Держите палец — из шланга идёт бетон. Ведите по опалубке, начиная с дальнего угла. Подача — вверху',
  pail: 'Ведро бетона 24 л — для U-блоков: держите палец над лотком, ведро наклонится и бетон потечёт, растекаясь по лотку. Ведите вдоль ряда. Каждое нажатие — новое ведро',
  screed: 'Тяните правило по бетону — оно идёт по верху опалубки, лишнее сдвигается вперёд',
  vibro: 'Держите палец в бетоне — вибратор осаживает его, бетон растекается ровно вокруг',
  wall: {
    line: 'Необязательно (стену начинает и первый блок на краю фундамента). Проведите ось стены — от угла до угла (зелёная полоса — будущая стена). Концы прилипают к другим стенам — угол с перевязкой',
    opening: 'Проведите вдоль стены от края до края проёма — разметится окно (низ 900, верх 2100 мм) или дверь (до 2100 мм). Кладка обойдёт его, сверху ляжет перемычка. По фанере опалубки перекрытия — прямоугольник проёма в плите (под лестницу)',
    lay: 'Тяните блок или кирпич из лотка: к кладке — встанет впритык в ряд, на кладку — сверху, на плиту — у края. Направление — как у последнего уложенного, «↻ Повернуть» — на 90° (для угла). Зелёный — встанет, красный — некуда',
    delete: 'Коснитесь блока или кирпича, чтобы снять (только верхний), оранжевой рамки — убрать проём, пустой линии — убрать стену',
  },
  bitumen: 'Ведите кистью по бетону — грани и верх фундамента покроются битумной мастикой',
  plate: 'Ведите виброплиту по засыпке — грунт, песок, щебень уплотняются и оседают. Пройдите 3–4 раза',
  trowel: `Ведите кельмой по свежему бетону — поверхность станет гладкой (пока бетон не схватился, ~${Math.round(0.75 * CONCRETE.cure)} с)`,
  bucket: (name) => `Держите палец — из тачки высыпается ${name.toLowerCase()} (100 л за 3 с). Ведите туда, где нужно подсыпать`,
  mark: {
    edit: 'Тяните круглые метки, чтобы менять контур. Тап по контуру — выбрать.',
    rect: 'Проведите от угла до угла — появится контур котлована',
    trench: 'Ведите пальцем первую часть траншеи, затем тапайте следующие точки → «Готово»',
  },
  form: {
    outline: 'Коснитесь контура — доски встанут по всему периметру, колья снаружи',
    board: 'Проведите линию — встанет ряд досок с кольями',
    strip: 'Коснитесь контура или доски — опалубка снимется и ляжет штабелем рядом (когда бетон схватится)',
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
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      app.setTool(b.dataset.tool);
      if (this.fanOpen && !this.chips().length) this.fan(false);   // quiet mode: done choosing
    }));
    this.lastTool = {};
    this.groups = GROUPS.filter((g) => this.groupTools(g.id).length);
    for (const g of this.groups) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.gid = g.id;
      b.innerHTML = document.querySelector(`[data-tool="${g.icon}"] svg`).outerHTML + `<span>${g.label}</span>`;
      b.addEventListener('click', () => this.openGroup(g.id));
      $('groups').appendChild(b);
    }
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
      if (e.key >= '1' && e.key <= String(this.groups.length)) this.openGroup(this.groups[+e.key - 1].id);
      if (e.key.toLowerCase() === 'q') this.setQuiet(!app.settings.quiet);
    });
    this.bindSettings();
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

  // ---- groups → tools ----------------------------------------------------------------------------
  groupTools(gid) { return [...document.querySelectorAll(`#toolrow [data-group="${gid}"]`)].filter((b) => !b.hasAttribute('hidden')); }
  groupOf(tool) { return document.querySelector(`#toolrow [data-tool="${tool}"]`)?.dataset.group; }

  // a group opens on the tool used last in it
  openGroup(gid) {
    const tools = this.groupTools(gid).filter((b) => b.dataset.tool);
    const last = this.lastTool[gid];
    const pick = tools.find((b) => b.dataset.tool === last) || tools[0];
    if (pick) this.app.setTool(pick.dataset.tool);
    this.refresh();
  }

  renderGroups() {
    const app = this.app, gid = this.groupOf(app.tool);
    if (gid) this.lastTool[gid] = app.tool;
    for (const b of $('groups').children) b.classList.toggle('active', b.dataset.gid === gid);
    const multi = this.groupTools(gid).length > 1;
    for (const b of document.querySelectorAll('#toolrow > [data-group]')) b.classList.toggle('shown', multi && b.dataset.group === gid);
    $('ui').classList.toggle('has-toolrow', multi);
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

  // ---- quiet mode: one round button, the tools fan out of it -----------------------------------
  bindQuiet() {
    $('fab').addEventListener('click', () => this.fan(!this.fanOpen));
    $('fan-shade').addEventListener('pointerdown', (e) => { e.preventDefault(); this.fan(false); });
    this.setQuiet(!!this.app.settings.quiet, false);
  }

  buildFan() {
    const app = this.app, box = $('fan-items');
    box.innerHTML = '';
    const acts = [
      { svg: $('btn-undo').innerHTML, label: 'Отменить', fn: () => app.undo(), keep: true, id: 'undo' },
      { svg: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', label: 'Все панели', fn: () => this.setQuiet(false), id: 'exit' },
    ];
    const place = (el, r, a) => { el.style.setProperty('--x', `${-r * Math.cos(a)}px`); el.style.setProperty('--y', `${-r * Math.sin(a)}px`); };
    const R1 = 180, R2 = 92;
    this.fanItems = [];
    // outer ring: the groups; a group with several tools or with modes keeps the fan
    // open — its tools and modes show at the top of the screen
    this.groups.forEach((g, k) => {
      const el = document.createElement('button');
      el.className = 'fan-item';
      el.innerHTML = document.querySelector(`[data-tool="${g.icon}"] svg`).outerHTML + `<span>${g.label}</span>`;
      place(el, R1, (k / Math.max(1, this.groups.length - 1)) * Math.PI / 2);
      el.addEventListener('click', () => {
        this.openGroup(g.id);
        this.toast(g.label);
        if (this.groupTools(g.id).length < 2 && !this.chips().length) this.fan(false);
        this.refresh();
      });
      box.appendChild(el);
      this.fanItems.push({ el, group: g.id });
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
    $('ui').classList.toggle('fan-open', this.fanOpen);
  }

  renderFan() {
    if (!this.app.settings.quiet || !this.fanItems) return;
    const app = this.app;
    for (const it of this.fanItems) {
      if (it.group) it.el.classList.toggle('active', it.group === this.groupOf(app.tool));
      if (it.act === 'undo') it.el.disabled = !app.journal.canUndo && !app.busy();
    }
    const cur = document.querySelector(`#toolrow [data-tool="${app.tool}"] svg`);
    const key = app.tool;
    if (cur && this._fabKey !== key) { $('fab').innerHTML = cur.outerHTML; this._fabKey = key; }
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
        ...Object.entries(PANOS).map(([k, v]) => C(v.name, b === k, () => app.setBackdrop(k))),
        C('Фото-фон', b === 'posters', () => app.setBackdrop('posters')),
      ];
    }
    if (t === 'shovel') {
      return [
        C('Штыковая', app.settings.shovel === 'spade', () => { app.settings.shovel = 'spade'; app.applySettings(); }),
        C('Совковая', app.settings.shovel === 'scoop', () => { app.settings.shovel = 'scoop'; app.applySettings(); }),
      ];
    }
    if (t === 'hose') {
      const s = app.settings;
      return [['Тихо', PUMP[0]], ['Средне', PUMP[1]], ['Быстро', PUMP[2]]].map(([l, v]) => C(l, s.pump === v, () => { s.pump = v; app.applySettings(); }));
    }
    if (app.materialTools?.[t]) {
      const s = app.settings, bucket = s.matMode === 'bucket';
      const set = (o) => { Object.assign(s, o); app.applySettings(); };
      return [
        ...DELIVERY.map((v) => C(m3(v), !bucket && s.delivery === v, () => set({ matMode: 'deliver', delivery: v }))),
        C('Тачка 100 л', bucket, () => set({ matMode: 'bucket' })),
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
    if (t === 'wall') {
      const wt = app.wallTool, s = app.settings;
      const set = (o) => { Object.assign(s, o); app.applySettings(); app.ui.refresh(); };
      const out = [['lay', 'Класть'], ['opening', 'Проём'], ['line', 'Линия'], ['delete', 'Удалить']].map(([k, l]) => C(l, wt.mode === k, () => wt.setMode(k), k === 'delete' ? 'warn' : ''));
      if (wt.mode === 'line' || wt.mode === 'lay') {
        const brick = (s.wallKind || 'block') !== 'block';
        const wk = s.wallKind || 'block';
        if (wt.mode === 'line') out.push(C('Газоблок', wk === 'block', () => set({ wallKind: 'block' })), C('Кирпич', wk !== 'block', () => set({ wallKind: 'brick' })));
        else out.push(...[['block', 'Газоблок'], ['brick', 'Кирпич'], ['lintel', 'Перемычка'], ['prop', 'Подпорка'], ['ublock', 'U-блок'], ['ucage', 'Каркас'], ['belt', 'Опалубка пояса'], ['slab', 'Перекрытие'], ['window', 'Окно']].map(([k, l]) => C(l, wk === k, () => set({ wallKind: k }))));
        if (wt.mode === 'lay' && wk === 'window') out.push(...[['pvc1', '1 · ПВХ 1 ств.'], ['pvc2', '2 · ПВХ 2 ств.'], ['pvc3', '3 · Антрацит 3 ств.'], ['pano', '4 · Панорамное'], ['portal', '5 · Портал']].map(([k, l]) => C(l, (s.windowKey || 'pvc2') === k, () => set({ windowKey: k }))));
        if (wt.mode === 'lay' && wk === 'slab') out.push(...[[0, 'Без консоли'], [1500, 'Консоль 1,5 м'], [3000, 'Консоль 3 м']].map(([v, l]) => C(l, (s.slabCant || 0) === v, () => set({ slabCant: v }))));
        if (wt.mode === 'lay' && (wk === 'block' || wk === 'brick' || wk === 'ublock')) out.push(C('↻ Повернуть', !!s.wallTurn, () => set({ wallTurn: !s.wallTurn })));
        if (wt.mode === 'lay' && (wk === 'block' || wk === 'brick')) out.push(C(wk === 'brick' ? '½ кирпича' : '½ блока', !!s.wallHalf, () => set({ wallHalf: !s.wallHalf })));
        // the planned height of a wall laid out with «Линия» (one by one in «Класть»: not needed)
        if (!brick && wt.mode === 'line') out.push(...[[500, '↕ 0,5 м'], [1000, '1 м'], [1500, '1,5 м'], [2700, '2,7 м'], [3000, '3 м']].map(([v, l]) => C(l, (s.wallHeight || 1500) === v, () => set({ wallHeight: v }))));
      }
      if (wt.mode === 'opening') out.push(...[['window', 'Окно'], ['door', 'Дверь']].map(([k, l]) => C(l, (s.openKind || 'window') === k, () => set({ openKind: k }))));
      return out;
    }
    if (t === 'form' || t === 'rebar') {
      const b = t === 'form' ? app.formTool : app.rebarTool;
      const modes = t === 'form'
        ? [['outline', 'По контуру'], ['board', 'Доска'], ['strip', 'Распалубить'], ['delete', 'Удалить']]
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
      b.addEventListener('click', () => { c.fn(); if (this.fanOpen) this.fan(false); this.refresh(); });
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
    const mt = app.materialTools?.[t];
    if (mt) hint = mt.busy ? '' : app.settings.matMode === 'bucket' ? HINTS.bucket(mt.name) : HINTS.deliver(mt.name, app.settings.delivery);
    if (app.concreteTools?.[t]) hint = app.concreteTools[t].busy ? '' : HINTS[t];
    if (t === 'mark') hint = HINTS.mark[app.markTool.mode];
    if (t === 'form') hint = HINTS.form[app.formTool.mode];
    if (t === 'rebar') hint = HINTS.rebar[app.rebarTool.mode];
    app.wallTool?.syncTray();
    if (t === 'wall') hint = app.wallTool.mode === 'lay' ? (app.wallTool.status() || HINTS.wall.lay) : app.wallTool.busy || app.physJob ? '' : HINTS.wall[app.wallTool.mode];
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
    this.renderGroups();
    this.renderChips();
    this.renderParams();
    this.renderMachineControls();
    this.renderFan();
    // quiet mode: an unfinished trench keeps its «Готово» visible
    $('ui').classList.toggle('pending-trench', !!app.markTool.trench);
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
    // sand / crushed stone lying on the plot (real m³)
    if ((this.matT = (this.matT || 0) + 1) % 3 === 1) {
      const v = app.terrain.materialVolumes().map((x) => x * MODEL_SCALE ** 3);
      const short = ['', 'песок', 'щ. 5–20', 'щ. 20–40'];
      const parts = MATERIALS.map((m, k) => (k && v[k] > 0.005 ? `${short[k]} ${v[k].toFixed(2).replace('.', ',')}` : '')).filter(Boolean);
      $('st-mat-row').hidden = !parts.length;
      $('st-mat').textContent = parts.join(' · ') + (parts.length ? ' м³' : '');
      const c = app.terrain.concVolume() * MODEL_SCALE ** 3;
      $('st-conc-row').hidden = c < 0.005;
      $('st-conc').textContent = `${c.toFixed(2).replace('.', ',')} м³`;
    }
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
