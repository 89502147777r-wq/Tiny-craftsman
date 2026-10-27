import { BUILD, MODEL_SCALE, MATERIALS, DELIVERY, PUMP, CONCRETE } from '../config.js';
import { bbox, contains } from '../world/outlines.js';
import { PANOS } from '../world/backdrop.js';
import { DAY_LENGTHS, WEATHER } from '../world/sky.js';
import { showTouches } from './touches.js';
import { ROOF_LAYERS, MEM_COLOURS, COP_COLOURS } from '../world/roof.js';
import { WIN_COLOURS } from '../world/windows.js';
import { POOL_LAYERS, MOSAICS, COPES } from '../world/pool.js';
import { BLIND_LAYERS, BLIND_WIDTHS, BLIND_FIN, TILE_COLOURS } from '../world/blind.js';
import { LAYERS as FAC_LAYERS, VLAYERS as FAC_VLAYERS, PLASTER_COLOURS, PLASTER_KINDS, PANEL_TYPES, VENT } from '../world/facade.js';
import { RWIN_TYPES } from '../world/roofWindows.js';
import { ROOF_TYPES, PITCHES, PITCH_RANGE, COVERS, COVER_COLOURS, STAGES as PROOF_STAGES, RWIN, RWIN_COLOURS, GUTTERS, GUTTER_COLOURS } from '../world/pitched.js';

const $ = (id) => document.getElementById(id);
const real = (mmModel) => mmModel * MODEL_SCALE / 10; // model mm → real cm

// The menu: groups by stage of the work → their tools → the tool's modes.
// (the tool buttons themselves are in index.html, #toolrow, with data-group)
const GROUPS = [
  { id: 'camera', label: 'Камера', icon: 'camera' },
  { id: 'mark', label: 'Разметка', icon: 'mark' },
  { id: 'earth', label: 'Земля', icon: 'shovel' },
  { id: 'materials', label: 'Материалы', icon: 'sand' },
  { id: 'found', label: 'Фундамент', icon: 'form' },
  { id: 'concrete', label: 'Бетон', icon: 'hose' },
  { id: 'walls', label: 'Стены', icon: 'wall' },
  // (of the walls' tool, but on the top row of their own: straight to their chips; kinds: the
  // work under it, the first the one it opens on)
  { id: 'winG', label: 'Окна и двери', svg: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="17"/><path d="M12 3v17M5 11h14"/><path d="M3 21h18"/></svg>', virt: { kinds: ['window', 'door', 'rail'], path: ['win'] } },
  { id: 'roofG', label: 'Кровля', svg: '<svg viewBox="0 0 24 24"><path d="M2 12L12 4l10 8"/><path d="M5 10v10h14V10"/><rect x="13" y="8" width="3" height="3"/></svg>', virt: { kinds: ['proof', 'roof', 'rwin'], path: ['roofs'] } },
  { id: 'facadeG', label: 'Фасад', svg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/><path d="M4 9h16M4 14h16M9 4v5M15 9v5M9 14v6"/><path d="M2 20h20"/></svg>', virt: { kinds: ['facade'], path: ['facade'] } },
  { id: 'blindG', label: 'Отмостка', svg: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="13"/><path d="M2 16h20l-2 4H4z"/><path d="M7 18h.01M12 18h.01M17 18h.01"/></svg>', virt: { kinds: ['blind'], path: ['blind'] } },
  { id: 'poolG', label: 'Бассейн', svg: '<svg viewBox="0 0 24 24"><path d="M3 7h18v10H3z"/><path d="M5 12c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0"/><path d="M7 4v6M11 4v6M7 6h4"/></svg>', virt: { kinds: ['pool'], path: ['pool'] } },
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
  breaker: 'Лом: держите палец на застывшем наплыве бетона (у фундамента, у опалубок) и ведите — корка откалывается и уходит в мусор; фундамент и плиты (толще 10 см) не трогает',
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
  haul: 'Коснитесь кучи: самосвал встанет у края участка, погрузчик наберёт ковш и ссыплет в кузов — так, пока куча не уйдёт до проектной отметки. Полный самосвал уезжает и возвращается пустым',
  machine: 'Погрузчик: ведите пальцем по участку — он подъедет, опустит ковш и пройдёт по линии, срезая бугры и засыпая ямы по проектной отметке (уровень большей части участка, с уклоном от дома). Дом, отмостку и бетон не трогает',
};

export class UI {
  constructor(app) {
    this.app = app;
    this.statT = 0;
    $('build').textContent = `BUILD ${BUILD}`;
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      app.setTool(b.dataset.tool);
      this.navPath = []; this.navLevel = this.chips().length ? 'chips' : 'tools';
      if (this.fanOpen && !this.chips().length) this.fan(false);   // quiet mode: done choosing
      this.refresh();
    }));
    // one row at a time at the bottom: the groups → a group's tools → a tool's modes (and
    // deeper: the material → its layer → its colour), «‹» goes back up
    this.navPath = []; this.navLevel = 'groups';
    const back = document.createElement('button');
    back.className = 'tool nav-back'; back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Назад</span>';
    back.addEventListener('click', () => this.navBack());
    $('toolrow').prepend(back);
    this.lastTool = {};
    this.groups = GROUPS.filter((g) => g.virt || this.groupTools(g.id).length);
    for (const g of this.groups) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.gid = g.id;
      b.innerHTML = this.groupSvg(g) + `<span>${g.label}</span>`;
      b.addEventListener('click', () => this.openGroup(g.id));
      $('groups').appendChild(b);
    }
    $('btn-undo').addEventListener('click', () => app.undo());
    $('btn-redo').addEventListener('click', () => app.redo());
    $('btn-level').addEventListener('click', () => { app.settings.level = !app.settings.level; app.applySettings(); });
    $('btn-menu').addEventListener('click', () => this.openMenu(true));
    // the numbers in the corner: shown / hidden by the small button over them (remembered)
    const st = $('stats'), sb = $('btn-stats');
    const showStats = (on) => { st.classList.toggle('collapsed', !on); sb.classList.toggle('off', !on); try { localStorage.setItem('tc-stats', on ? '1' : '0'); } catch { /* private mode */ } };
    let statsOn = true; try { statsOn = localStorage.getItem('tc-stats') !== '0'; } catch { /* private mode */ }
    showStats(statsOn);
    sb.addEventListener('click', () => showStats(st.classList.contains('collapsed')));
    // the hints at the bottom: shown / hidden by the button beside it (remembered)
    const hb = $('btn-hints'), ui = $('ui');
    const showHints = (on) => { ui.classList.toggle('no-hints', !on); hb.classList.toggle('off', !on); try { localStorage.setItem('tc-hints', on ? '1' : '0'); } catch { /* private mode */ } };
    let hintsOn = true; try { hintsOn = localStorage.getItem('tc-hints') !== '0'; } catch { /* private mode */ }
    showHints(hintsOn);
    hb.addEventListener('click', () => showHints(ui.classList.contains('no-hints')));
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
    this.bindJoystick('joy', 'joy-knob', (x, y) => app.machineTool.joystick('l', x, y));
    this.bindJoystick('joy2', 'joy2-knob', (x, y) => app.machineTool.joystick('r', x, y));
    this.bindSettings();
    showTouches(app);
    this.bindQuiet();
    this.refresh();
  }

  // a virtual joystick for the machines (its own pointer, so the canvas gestures stay free)
  bindJoystick(elId, knobId, cb) {
    const el = $(elId), knob = $(knobId);
    let id = null;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
      // (a small dead zone, then a soft curve for fine control)
      const f = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.12) / 0.88;
      cb(f(x) * Math.abs(f(x)) ** 0.5, f(y));
    };
    el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture(id); this.app.sfx.unlock?.(); set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; cb(0, 0); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  renderMachineControls() {
    const app = this.app, mt = app.machineTool, on = app.tool === 'machine' && mt.driving;
    $('joy').hidden = !on; $('joy2').hidden = !on;
    $('ui').classList.toggle('driving', on);   // (the tools' row away: the bucket is low in the picture)
    const box = $('mbtns');
    box.hidden = !on; box.classList.toggle('up', on);
    if (!on) { this._mKey = null; return; }
    if (this._mKey === mt.drv + mt.view) return;
    this._mKey = mt.drv + mt.view;
    box.innerHTML = '';
    // (the view: the cab → the roof → behind, round and round; the button says the next one)
    const next = { cab: 'roof', roof: 'back', back: 'cab' }[mt.view] || 'cab';
    const v = document.createElement('button'); v.textContent = { cab: 'Из кабины', roof: 'С крыши', back: 'Вид сзади' }[next];
    v.addEventListener('click', () => mt.setView(next));
    const b = document.createElement('button'); b.textContent = 'Выйти';
    b.addEventListener('click', () => { mt.exit(); this.refresh(); });
    box.append(v, b);
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
    for (const [id, key] of [['set-shake', 'shake'], ['set-sound', 'sound'], ['set-grade', 'stopAtGrade'], ['set-touches', 'touches']]) {
      const el = $(id);
      el.checked = key === 'touches' ? s[key] !== false : !!s[key];
      el.addEventListener('change', () => { s[key] = el.checked; app.applySettings(); });
    }
  }

  // ---- groups → tools ----------------------------------------------------------------------------
  groupTools(gid) { return [...document.querySelectorAll(`#toolrow [data-group="${gid}"]`)].filter((b) => !b.hasAttribute('hidden')); }
  groupOf(tool) { return document.querySelector(`#toolrow [data-tool="${tool}"]`)?.dataset.group; }

  // a group opens on the tool used last in it: its tools (when several), else its modes
  groupSvg(g) { return g.svg || document.querySelector(`[data-tool="${g.icon}"] svg`).outerHTML; }
  // the group on the top row the current work is under (the facade, the windows: their own)
  curGroup() {
    const app = this.app, k = app.settings.wallKind;
    if (app.tool === 'wall' && this.virt) return this.virt.id;   // (its «Удалить» too)
    if (app.tool === 'wall' && app.wallTool.mode === 'lay') { const v = GROUPS.find((g) => g.virt && g.virt.kinds.includes(k)); if (v) return v.id; }
    return this.groupOf(app.tool);
  }
  openGroup(gid) {
    const vg = GROUPS.find((g) => g.id === gid && g.virt);
    if (vg) {
      // the walls' tool with this kind, straight to its chips
      const app = this.app;
      app.setTool('wall'); if (app.wallTool.mode !== 'lay') app.wallTool.setMode('lay');
      if (!vg.virt.kinds.includes(app.settings.wallKind)) app.settings.wallKind = vg.virt.kinds[0];
      app.applySettings();
      this._navTool = 'wall'; this.virt = vg;
      this.navPath = [...vg.virt.path]; this.navLevel = 'chips';
      this.refresh();
      return;
    }
    this.virt = null;
    // (back to the walls from the facade / the windows: the masonry again)
    if (gid === 'walls' && GROUPS.some((g) => g.virt?.kinds.includes(this.app.settings.wallKind))) { this.app.settings.wallKind = 'block'; this.app.applySettings(); }
    if (gid === 'walls' && this.app.wallTool && !['lay', 'delete'].includes(this.app.wallTool.mode)) this.app.wallTool.setMode('lay');
    const tools = this.groupTools(gid).filter((b) => b.dataset.tool);
    const last = this.lastTool[gid];
    const pick = tools.find((b) => b.dataset.tool === last) || tools[0];
    if (pick) this.app.setTool(pick.dataset.tool);
    this.navPath = [];
    this.navLevel = this.groupTools(gid).length > 1 ? 'tools' : this.chips().length ? 'chips' : 'groups';
    this.refresh();
  }
  navBack() {
    if (this.virt && this.navLevel === 'chips' && this.navPath.length <= this.virt.virt.path.length) { this.virt = null; this.navLevel = 'groups'; this.navPath = []; }
    else if (this.navLevel === 'chips' && this.navPath.length) this.navPath.pop();
    else if (this.navLevel === 'chips' && this.groupTools(this.groupOf(this.app.tool)).length > 1) this.navLevel = 'tools';
    else { this.navLevel = 'groups'; this.navPath = []; }
    this.refresh();
  }
  // the chips of the level open now (the tree: a chip with `kids` opens them)
  navNodes() {
    let list = this.chips();
    const crumbs = [], path = [];
    for (const id of this.navPath) {
      const n = list.find((c) => c.id === id && c.kids);
      if (!n) break;
      path.push(id); crumbs.push(n.crumb || n.label); list = typeof n.kids === 'function' ? n.kids() : n.kids;
    }
    this.navPath = path;
    return { list, crumbs };
  }

  renderGroups() {
    const app = this.app, gid = this.groupOf(app.tool);
    if (gid) this.lastTool[gid] = app.tool;
    const cg = this.curGroup();
    for (const b of $('groups').children) b.classList.toggle('active', b.dataset.gid === cg);
    // (the tool changed by itself — a shortcut, the fan: its group, from the top)
    if (this._navTool !== app.tool) { if (this._navTool !== undefined && this.navLevel !== 'groups') { this.navPath = []; this.navLevel = this.groupTools(gid).length > 1 ? 'tools' : this.chips().length ? 'chips' : 'groups'; } this._navTool = app.tool; }
    const lv = this.navLevel;
    for (const b of document.querySelectorAll('#toolrow > [data-group]')) b.classList.toggle('shown', lv === 'tools' && b.dataset.group === gid);
    const ui = $('ui');
    ui.classList.toggle('has-toolrow', lv === 'tools');
    for (const k of ['groups', 'tools', 'chips']) ui.classList.toggle('nav-' + k, lv === k);
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
      el.innerHTML = this.groupSvg(g) + `<span>${g.label}</span>`;
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
    if (!on) { this.navLevel = 'groups'; this.navPath = []; }   // (the panels back: from the top)
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
    // a group of chips: opens its own row (and does what `self` does: selects it); `crumb` — its name on the path
    const G = (id, label, kids, crumb = null, self = null) => ({ id, label, kids, crumb: crumb || label.replace(/^\S+ · /, ''), on: self ? !!self.on : false, fn: self?.fn, cls: self?.cls || '' });
    if (t === 'camera') {
      const b = app.settings.backdrop, st = app.settings;
      const out = [
        C(st.orbit ? '■ Стоп облёт' : '▶ Облёт', st.orbit, () => { st.orbit = !st.orbit; app.applySettings(); }),
        G('bg', 'Фон', [
          C('Мастерская', b === 'workshop', () => app.setBackdrop('workshop')),
          ...Object.entries(PANOS).map(([k, v]) => C(v.name, b === k, () => app.setBackdrop(k))),
          C('Фото-фон', b === 'posters', () => app.setBackdrop('posters')),
        ]),
      ];
      // the time of day and the weather (outdoors only)
      if (b !== 'workshop' && app.sky) out.push(
        G('time', `🕓 ${app.sky.label()}`, [
          ...[[7, 'Утро'], [13, 'День'], [20.4, 'Закат'], [0, 'Ночь']].map(([h, l]) => C(l, false, () => { app.sky.setHour(h); })),
          ...DAY_LENGTHS.map((m) => C(m ? `Сутки ${m} мин` : 'Время стоит', (st.dayMin ?? 30) === m, () => { st.dayMin = m; app.applySettings(); })),
        ], 'Время'),
        G('weather', (st.weather || 'auto') === 'rain' ? '🌧 Погода' : '☀ Погода', Object.entries(WEATHER).map(([k, l]) => C(l, (st.weather || 'auto') === k, () => { st.weather = k; app.applySettings(); }))),
      );
      return out;
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
      const pj = app.settings.project || 'off', setP = (v) => { app.settings.project = v; app.applySettings(); app.ui.refresh(); };
      out.push(G('proj', '📐 Проект', [
        ...[['off', 'Скрыть'], ['site', 'Участок'], ['f1', '1 этаж'], ['f2', '2 этаж'], ['all', 'Весь дом']].map(([k, l]) => C(l, pj === k, () => setP(k))),
        C('Вынести котлованы', false, () => m.setOut()),
      ], 'Проект', { on: pj !== 'off' }));
      if (m.trench) out.push(C('✓ Готово', true, () => m.finishTrench()));
      if (m.selected && !m.trench) out.push(C('Удалить контур', false, () => m.deleteSelected(), 'warn'));
      return out;
    }
    if (t === 'wall') {
      const wt = app.wallTool, s = app.settings;
      const set = (o) => { Object.assign(s, o); app.applySettings(); app.ui.refresh(); };
      const lay = (o) => { if (wt.mode !== 'lay') wt.setMode('lay'); set(o); };
      const wk = s.wallKind || 'block', L = wt.mode === 'lay';
      const K = (k, l) => C(l, L && wk === k, () => lay({ wallKind: k }));
      const has = (...ks) => L && ks.includes(wk);
      // the masonry
      const masonry = [K('block', 'Газоблок'), K('brick', 'Кирпич'), K('cinder', 'Шлакоблок'), K('ublock', 'U-блок')];
      if (has('block', 'brick', 'ublock', 'cinder')) masonry.push(C('↻ Повернуть', !!s.wallTurn, () => set({ wallTurn: !s.wallTurn })));
      if (has('block', 'brick', 'cinder')) masonry.push(C(wk === 'brick' ? '½ кирпича' : '½ блока', !!s.wallHalf, () => set({ wallHalf: !s.wallHalf })));
      // the roof: its layer → the colour
      const RL = s.roofLayer || 'vap';
      const roof = ROOF_LAYERS.map(([k, l], i) => {
        const c = C(`${i + 1} · ${l}`, has('roof') && RL === k, () => lay({ wallKind: 'roof', roofLayer: k }));
        if (k === 'mem') return G('mem', c.label, Object.entries(MEM_COLOURS).map(([q, [n]]) => C('◼ ' + n, (s.roofMem || 'grey') === q, () => lay({ wallKind: 'roof', roofLayer: 'mem', roofMem: q }))), null, c);
        if (k === 'cop') return G('cop', c.label, Object.entries(COP_COLOURS).map(([q, [n]]) => C('◼ ' + n, (s.roofCop || 'zinc') === q, () => lay({ wallKind: 'roof', roofLayer: 'cop', roofCop: q }))), null, c);
        return c;
      });
      // the facade: its layer → the texture, the colour / the panel
      const FL = s.facLayer || 'eps';
      const facade = FAC_LAYERS.map(([k, l], i) => {
        const c = C(`${i + 1} · ${l}`, has('facade') && FL === k, () => lay({ wallKind: 'facade', facLayer: k }));
        if (k === 'pl') return G('pl', c.label, [
          ...Object.entries(PLASTER_KINDS).map(([q, n]) => C('▦ ' + n, (s.facTex || 'bark') === q, () => lay({ wallKind: 'facade', facLayer: 'pl', facTex: q }))),
          ...Object.entries(PLASTER_COLOURS).map(([q, [n]]) => C('◼ ' + n, (s.facCol || 'white') === q, () => lay({ wallKind: 'facade', facLayer: 'pl', facCol: q }))),
        ], null, c);
        if (k === 'pan') {
          // the panels: the type (stone, clinker, planks) → its colour
          const cur = s.facPanel || 'stone:sandstone';
          return G('pan', c.label, Object.entries(PANEL_TYPES).filter(([t, [, cols]]) => !VENT(`${t}:${Object.keys(cols)[0]}`)).map(([t, [tn, cols]]) => G('pt' + t, tn, Object.entries(cols).map(([q, [n]]) => C('◼ ' + n, cur === `${t}:${q}`, () => lay({ wallKind: 'facade', facLayer: 'pan', facPanel: `${t}:${q}` }))), null, C('', cur.startsWith(t + ':'), () => lay({ wallKind: 'facade', facLayer: 'pan', facPanel: `${t}:${Object.keys(cols)[0]}` })))), null, c);
        }
        return c;
      });
      // the ventilated facade: its stages; the panels → the material → its colour
      const vent = FAC_VLAYERS.map(([k, l], i) => {
        const c = C(`${i + 1} · ${l}`, has('facade') && FL === k, () => lay({ wallKind: 'facade', facLayer: k }));
        if (k !== 'vp') return c;
        const cur = s.facVent || 'porc:concrete';
        return G('vp', c.label, Object.entries(PANEL_TYPES).filter(([t, [, cols]]) => VENT(`${t}:${Object.keys(cols)[0]}`)).map(([t, [tn, cols]]) => G('vt' + t, tn, Object.entries(cols).map(([q, [n]]) => C('◼ ' + n, cur === `${t}:${q}`, () => lay({ wallKind: 'facade', facLayer: 'vp', facVent: `${t}:${q}` }))), null, C('', cur.startsWith(t + ':'), () => lay({ wallKind: 'facade', facLayer: 'vp', facVent: `${t}:${Object.keys(cols)[0]}` })))), null, c);
      });
      const isV = FAC_VLAYERS.some(([k]) => k === FL);
      // the pitched roof: its type, pitch, covering (and colour), then the stages
      const po = wt.proof.opts(), pr = wt.proof.target, wsel = wt.proof.wing;   // (a roof with its rafters up: the menu is for the next one)
      const pset = (o, ch) => { lay({ wallKind: 'proof', ...o }); wt.proof.applyOpts(ch); };
      const wingName = (w, i) => `Крыло ${i + 1} · ${(2 * w.A / (1 / 1000 / (9000 / 860)) / 1000).toFixed(1).replace('.', ',')}×${(2 * w.B / (1 / 1000 / (9000 / 860)) / 1000).toFixed(1).replace('.', ',')} м`;
      const proof = [
        // (a house of several wings: each its own type — the wing first)
        ...(pr && pr.wings.length > 1 ? [G('pwing', wsel >= 0 ? `Крыло ${wsel + 1}` : 'Все крылья', [C('Все крылья', wsel < 0, () => set({ wallKind: 'proof', proofWing: -1 })), ...pr.wings.map((w, i) => C(wingName(w, i), wsel === i, () => set({ wallKind: 'proof', proofWing: i })))], 'Крыло')] : []),
        G('ptype', `Тип: ${ROOF_TYPES[po.style]}`, Object.entries(ROOF_TYPES).map(([k, l]) => C(l, po.style === k, () => pset({ proofType: k }, { style: k }))), 'Тип'),
        G('ppitch', `Уклон ${po.pitch}°`, [
          ...[-5, -1, 1, 5].map((d) => { const v = Math.max(PITCH_RANGE[po.style][0], Math.min(PITCH_RANGE[po.style][1], po.pitch + d)); return C(`${d > 0 ? '+' : '−'}${Math.abs(d)}°`, false, () => pset({ proofPitch: v }, { pitch: v })); }),
          ...PITCHES[po.style].map((v) => C(`${v}°`, po.pitch === v, () => pset({ proofPitch: v }, { pitch: v }))),
        ], 'Уклон'),
        ...(pr ? [po.style === 'mono' ? C('↻ Скат', false, () => { lay({ wallKind: 'proof' }); wt.proof.turnSlope(); }) : C('↻ Конёк', false, () => { lay({ wallKind: 'proof' }); wt.proof.turnRidge(); })] : []),
        G('pcover', COVERS[po.cover.kind], Object.entries(COVERS).map(([k, l]) => G('pc' + k, l, Object.entries(COVER_COLOURS[k]).map(([q, [n]]) => C('◼ ' + n, po.cover.kind === k && po.cover.col === q, () => pset({ proofCover: k, proofCol: q }, { cover: true }))), null, C('', po.cover.kind === k, () => pset({ proofCover: k }, { cover: true })))), 'Покрытие'),
        // the gutters: the kind → the colour (changed on the roof at once when they hang)
        G('pgut', `Водосток: ${GUTTERS[po.gut.kind]}`, Object.entries(GUTTERS).map(([k, l]) => G('pg' + k, l, Object.entries(GUTTER_COLOURS).map(([q, [n]]) => C('◼ ' + n, po.gut.kind === k && po.gut.col === q, () => pset({ proofGut: k, proofGutCol: q, proofStage: 'gutter' }, { gut: true }))), null, C('', po.gut.kind === k, () => pset({ proofGut: k, proofStage: 'gutter' }, { gut: true })))), 'Водосток'),
        ...PROOF_STAGES.map(([k, l], i) => C(`${i + 1} · ${l}`, has('proof') && (s.proofStage || 'plate') === k, () => lay({ wallKind: 'proof', proofStage: k }))),
      ];
      // the blind area: the width, then its stages (the top: concrete or paving and its colour)
      const BL = s.blindLayer || 'form', bset = (o) => lay({ wallKind: 'blind', ...o });
      const blind = [
        G('bw', `Ширина ${(s.blindW || 1000) / 1000} м`.replace('.', ','), BLIND_WIDTHS.map((v) => C(`${v / 1000} м`.replace('.', ','), (s.blindW || 1000) === v, () => bset({ blindW: v, blindLayer: 'form' }))), 'Ширина'),
        ...BLIND_LAYERS.map(([k, l], i) => {
          const c = C(`${i + 1} · ${k === 'fin' ? BLIND_FIN[s.blindFin || 'conc'] : l}`, has('blind') && BL === k, () => bset({ blindLayer: k }));
          // (sand, gravel: tipped off the shovel, or the rake over it)
          if (k === 'sand' || k === 'grav') return G('b' + k, c.label, [C('Сыпать лопатой', has('blind') && BL === k && (s.blindAct || 'pour') === 'pour', () => bset({ blindLayer: k, blindAct: 'pour' })), C('Грабли', has('blind') && BL === k && s.blindAct === 'rake', () => bset({ blindLayer: k, blindAct: 'rake' })), C(`Правило — ровно ${k === 'sand' ? 60 : 120} мм`, has('blind') && BL === k && s.blindAct === 'rule', () => bset({ blindLayer: k, blindAct: 'rule' }))], null, c);
          if (k !== 'fin') return c;
          return G('bfin', c.label, [C('Бетон', (s.blindFin || 'conc') === 'conc', () => bset({ blindLayer: 'fin', blindFin: 'conc' })), G('btile', 'Плитка', Object.entries(TILE_COLOURS).map(([q, [n]]) => C('◼ ' + n, s.blindFin === 'tile' && (s.blindCol || 'grey') === q, () => bset({ blindLayer: 'fin', blindFin: 'tile', blindCol: q }))), null, C('', s.blindFin === 'tile', () => bset({ blindLayer: 'fin', blindFin: 'tile' })))], null, c);
        }),
      ];
      // the pool: its stages (the mosaic: its colour; the coping: its stone; the water: in / out)
      const PL = s.poolLayer || 'pit', plset = (o) => lay({ wallKind: 'pool', ...o });
      const pool = POOL_LAYERS.map(([k, l], i) => {
        const c = C(`${i + 1} · ${l}`, has('pool') && PL === k, () => plset({ poolLayer: k }));
        if (k === 'pit') return G('ppit', c.label, [C('Разметить', has('pool') && PL === 'pit', () => plset({ poolLayer: 'pit' })), C('↻ Повернуть', !!s.poolTurn, () => plset({ poolLayer: 'pit', poolTurn: !s.poolTurn })), C('📏 Замер', !!s.poolMeasure, () => plset({ poolMeasure: !s.poolMeasure }))], null, c);
        if (k === 'tile') return G('ptile', c.label, Object.entries(MOSAICS).map(([q, [n]]) => C('◼ ' + n, (s.poolMos || 'turq') === q, () => plset({ poolLayer: 'tile', poolMos: q }))), null, c);
        if (k === 'cope') return G('pcope', c.label, Object.entries(COPES).map(([q, [n]]) => C('◼ ' + n, (s.poolCope || 'trav') === q, () => plset({ poolLayer: 'cope', poolCope: q }))), null, c);
        if (k === 'dig') return G('pdig', c.label, [C('Копать по разметке', has('pool') && PL === 'dig', () => plset({ poolLayer: 'dig' })), C('📏 Замер', !!s.poolMeasure, () => plset({ poolMeasure: !s.poolMeasure }))], null, c);
        if (k === 'water') return G('pwater', c.label, [C('Наполнить', s.poolWater !== 'drain', () => plset({ poolLayer: 'water', poolWater: 'fill' })), C('Слить', s.poolWater === 'drain', () => plset({ poolLayer: 'water', poolWater: 'drain' }))], null, c);
        return c;
      });
      // the windows in the roof (a slope or a flat roof): the size, the colour of the frame
      const rwin = [
        ...Object.entries(RWIN_TYPES).map(([k, [l]]) => C(l, has('rwin') && (s.rwinType || 'pivot') === k, () => lay({ wallKind: 'rwin', rwinType: k }))),
        ...Object.entries(RWIN).map(([k, [l]]) => C(l, has('rwin') && (s.rwinKey || 's2') === k, () => lay({ wallKind: 'rwin', rwinKey: k }))),
        ...Object.entries(RWIN_COLOURS).map(([k, [l]]) => C('◼ ' + l, (s.rwinCol || 'graphite') === k, () => lay({ wallKind: 'rwin', rwinCol: k }))),
      ];
      const pick = (list, key, kind, def) => list.map(([k, l]) => C(l, has(kind) && (s[key] || def) === k, () => lay({ wallKind: kind, [key]: k })));
      const del = () => C('Удалить', wt.mode === 'delete', () => wt.setMode('delete'), 'warn');
      const hid = (n) => ({ ...n, hidden: true });
      // the top row's own groups (hidden here: opened from there), then the walls themselves
      return [
        hid(G('facade', 'Фасад', [G('wet', 'Мокрый фасад', facade, null, C('', has('facade') && !isV, () => lay({ wallKind: 'facade', facLayer: isV ? 'eps' : FL }))), G('vent', 'Вентфасад', vent, null, C('', has('facade') && isV, () => lay({ wallKind: 'facade', facLayer: isV ? FL : 'br' }))), del()], null, C('', has('facade'), () => lay({ wallKind: 'facade' })))),
        hid(G('win', 'Окна и двери', [
          G('wins', 'Окна', [...pick([['pvc1', '1 · ПВХ 1 ств.'], ['pvc2', '2 · ПВХ 2 ств.'], ['pvc3', '3 · ПВХ 3 ств.'], ['pano', '4 · Панорамное'], ['floor', '5 · Витраж в пол'], ['corner', '6 · Угловое остекление'], ['portal', '7 · Портал']], 'windowKey', 'window', 'pvc2'), G('wcol', `Цвет: ${WIN_COLOURS[s.winCol || 'white'][0]}`, Object.entries(WIN_COLOURS).map(([k, [l]]) => C('◼ ' + l, (s.winCol || 'white') === k, () => lay({ wallKind: 'window', winCol: k }))), 'Цвет')], null, C('', has('window'), () => lay({ wallKind: 'window' }))),
          G('door', 'Двери', pick([['door1', '1 · Стальная'], ['door2', '2 · Хай-тек'], ['door3', '3 · Дуб'], ['door4', '4 · Белая со стеклом'], ['door5', '5 · Двустворчатая']], 'doorKey', 'door', 'door1'), null, C('', has('door'), () => lay({ wallKind: 'door' }))),
          G('garage', 'Гаражные ворота', pick([['gar1', '1 · Секционные'], ['gar2', '2 · Рулонные'], ['gar3', '3 · Распашные, дерево'], ['gar4', '4 · Скрытые, под отделку']], 'doorKey', 'door', 'gar1'), null, C('', has('door') && String(s.doorKey).startsWith('gar'), () => lay({ wallKind: 'door', doorKey: 'gar1' }))),
          C('Стеклянное ограждение', has('rail'), () => lay({ wallKind: 'rail' })),
          del(),
        ], null, C('', has('window', 'door', 'rail')))),
        hid(G('roofs', 'Кровля', [
          G('proof', 'Скатная крыша', proof, null, C('', has('proof'), () => lay({ wallKind: 'proof' }))),
          G('roof', 'Плоская кровля', roof, null, C('', has('roof'), () => lay({ wallKind: 'roof' }))),
          G('rwin', 'Окна в крышу', rwin, null, C('', has('rwin'), () => lay({ wallKind: 'rwin' }))),
          del(),
        ], null, C('', has('proof', 'roof', 'rwin')))),
        hid(G('blind', 'Отмостка', [...blind, del()], null, C('', has('blind'), () => lay({ wallKind: 'blind' })))),
        hid(G('pool', 'Бассейн', [...pool, del()], null, C('', has('pool'), () => lay({ wallKind: 'pool' })))),
        G('masonry', 'Кладка', masonry, null, C('', has('block', 'brick', 'ublock', 'cinder'))),
        G('lintel', 'Перемычки', [K('lintel', 'Готовая перемычка'), K('lform', 'Опалубка перемычки'), K('prop', 'Подпорка'), K('ucage', 'Каркас')], null, C('', has('lintel', 'lform', 'prop', 'ucage'))),
        G('mono', 'Монолит', [K('belt', 'Опалубка пояса'), K('studs', 'Шпильки'), G('slab', 'Перекрытие', [[0, 'Без консоли'], [1500, 'Консоль 1,5 м'], [3000, 'Консоль 3 м']].map(([v, l]) => C(l, has('slab') && (s.slabCant || 0) === v, () => lay({ wallKind: 'slab', slabCant: v }))), null, K('slab', 'Перекрытие'))], null, C('', has('belt', 'studs', 'slab'))),
        del(),
      ];
    }
    if (t === 'form' || t === 'rebar') {
      const b = t === 'form' ? app.formTool : app.rebarTool;
      const modes = t === 'form'
        ? [['outline', 'По контуру'], ['board', 'Доска'], ['strip', 'Распалубить'], ['delete', 'Удалить']]
        : [['cage', 'Каркас'], ['bar', 'Пруток'], ['mesh', 'Сетка'], ['tie', 'Вязать'], ['delete', 'Удалить']];
      return modes.map(([k, l]) => C(l, b.mode === k, () => b.setMode(k), k === 'delete' ? 'warn' : ''));
    }
    if (t === 'machine') {
      const s = app.settings, mt = app.machineTool, set = (o) => { if (mt.driving) mt.exit(); Object.assign(s, o); app.applySettings(); app.ui.refresh(); };
      return [
        C('Погрузчик · планировка', !mt.driving && s.machineMode !== 'haul', () => set({ machineMode: 'grade' })),
        C('Погрузчик · в самосвал', !mt.driving && s.machineMode === 'haul', () => set({ machineMode: 'haul' })),
        C('Сесть в погрузчик', mt.driving && mt.drv === 'loader', () => { if (mt.driving) mt.exit(); mt.enter('loader'); }),
        C('Сесть в самосвал', mt.driving && mt.drv === 'truck', () => { if (mt.driving) mt.exit(); mt.enter('truck'); }),
        G('gslope', `Уклон от дома ${s.gradeSlope ?? 1.5} %`.replace('.', ','), [0, 1, 1.5, 2].map((v) => C(`${v} %`.replace('.', ','), (s.gradeSlope ?? 1.5) === v, () => set({ gradeSlope: v }))), 'Уклон'),
      ];
    }
    return [];
  }

  renderChips() {
    const show = this.navLevel === 'chips' || (this.app.settings.quiet && this.fanOpen);
    const { list, crumbs } = show ? this.navNodes() : { list: [], crumbs: [] };
    const key = JSON.stringify([show, crumbs, list.map((c) => [c.label, c.on, c.cls, !!c.kids])]);
    if (key === this._chipKey) return;
    this._chipKey = key;
    const bar = $('subbar');
    bar.innerHTML = '';
    if (!show) return;
    const add = (label, cls, fn) => { const b = document.createElement('button'); b.className = `chip-btn ${cls}`; b.textContent = label; if (fn) b.addEventListener('click', fn); bar.appendChild(b); return b; };
    add('‹', 'back', () => this.navBack());
    const tool = this.virt ? '' : document.querySelector(`#toolrow [data-tool="${this.app.tool}"] span`)?.textContent || '';
    add([tool, ...crumbs].filter(Boolean).join(' › '), 'crumb');
    for (const c of list) {
      if (c.hidden) continue;
      add(c.label + (c.kids ? ' ›' : ''), `${c.on ? 'on' : ''} ${c.cls || ''} ${c.kids ? 'group' : ''}`, () => {
        c.fn?.();
        if (c.kids) this.navPath.push(c.id);
        else if (this.fanOpen) this.fan(false);
        this.refresh();
      });
    }
    bar.scrollLeft = 0;
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
        <label>Глубина <output id="p-depth"></output><input id="p-depth-r" type="range" min="4" max="235" step="1"></label>
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
    if (t === 'machine') hint = app.machineTool.busy() || app.machineTool.driving ? '' : app.machineTool.loader?.loaded ? (app.settings.machineMode === 'haul' ? HINTS.haul : HINTS.machine) : 'Погрузчик заезжает на участок…';
    if (this._hint !== hint) { $('hint').textContent = hint; this._hint = hint; }
    this.renderGroups();
    this.renderChips();
    this.renderMachineControls();
    this.renderParams();
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
