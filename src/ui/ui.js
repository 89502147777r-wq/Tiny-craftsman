import { BUILD, MODEL_SCALE } from '../config.js';

const $ = (id) => document.getElementById(id);

const HINTS = {
  camera: 'Один палец — облёт, два — масштаб. Двойной тап — навести фокус.',
  shovel: 'Проведите пальцем по земле — лопата срежет слой грунта',
  loaded: 'Коснитесь места для отвала и отпустите — грунт высыплется',
  mark: 'Тяните колышки — так задаётся контур котлована',
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
    // keyboard shortcuts for desktop testing
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); }
      if (e.key === '1') app.setTool('camera');
      if (e.key === '2') app.setTool('shovel');
      if (e.key === '3') app.setTool('mark');
    });
    this.bindSettings();
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
    bind('set-bite', 'bite', (v) => `${v} мм (${(v * MODEL_SCALE / 10).toFixed(0)} см в натуре)`);
    bind('set-target', 'target', (v) => `${v} мм (${(v * MODEL_SCALE / 10).toFixed(0)} см)`);
    bind('set-dof', 'dof', (v) => (v < 0.02 ? 'выкл' : `${Math.round(v * 100)}%`));
    bind('set-shovel', 'shovel', () => '', String);
    bind('set-quality', 'quality', () => '', String);
    for (const [id, key] of [['set-shake', 'shake'], ['set-sound', 'sound']]) {
      const el = $(id);
      el.checked = !!s[key];
      el.addEventListener('change', () => { s[key] = el.checked; app.applySettings(); });
    }
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

  refresh() {
    const app = this.app;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === app.tool));
    $('btn-level').classList.toggle('on', !!app.settings.level);
    $('btn-undo').disabled = !app.journal.canUndo && !app.shovelTool.busy;
    $('btn-redo').disabled = !app.journal.canRedo;
    let hint = HINTS[app.tool] || '';
    if (app.tool === 'shovel') {
      const st = app.shovelTool.state;
      if (st === 'loaded' || st === 'aim') hint = HINTS.loaded;
      else if (st !== 'idle') hint = '';
    }
    if (app.tool === 'mark') {
      const r = app.marking.rect;
      const w = (r.x1 - r.x0) * 1000, d = (r.z1 - r.z0) * 1000;
      hint = `${HINTS.mark}: ${w.toFixed(0)} × ${d.toFixed(0)} мм (${(w * MODEL_SCALE / 1000).toFixed(2)} × ${(d * MODEL_SCALE / 1000).toFixed(2)} м)`;
    }
    if (this._hint !== hint) { $('hint').textContent = hint; this._hint = hint; }
  }

  setSaveState(s) {
    const i = $('st-save');
    i.classList.toggle('pending', s !== 'saved');
    $('st-save-text').textContent = s === 'saved' ? 'сохранено' : s === 'error' ? 'ошибка сохранения' : 'сохраняю…';
  }

  showMeasure(x, y) {
    const r = this.app.marking.rect;
    const w = (r.x1 - r.x0) * 1000, d = (r.z1 - r.z0) * 1000;
    const el = $('measure');
    el.hidden = false;
    el.textContent = `${w.toFixed(0)} × ${d.toFixed(0)} мм · ${(w * MODEL_SCALE / 1000).toFixed(2)} × ${(d * MODEL_SCALE / 1000).toFixed(2)} м`;
    // keep the label on screen (it sits above the finger, centred)
    const half = el.offsetWidth / 2 + 8;
    el.style.left = `${Math.min(window.innerWidth - half, Math.max(half, x))}px`;
    el.style.top = `${Math.max(el.offsetHeight * 1.4 + 8, y)}px`;
    this.refresh();
  }

  hideMeasure() { $('measure').hidden = true; this.refresh(); }

  tick(dt) {
    this.statT += dt;
    if (this.statT < 0.3) return;
    this.statT = 0;
    const app = this.app;
    const v = app.terrain.excavatedVolume();
    const cm3 = v * 1e6;
    const real = v * MODEL_SCALE ** 3;
    $('st-vol').textContent = `${cm3.toFixed(1)} см³ · ${real.toFixed(2)} м³`;
    const d = app.terrain.pitStats(app.marking.rect).meanDepth * 1000;
    $('st-depth').textContent = `${d.toFixed(1)} / ${app.settings.target} мм`;
    this.refresh();
  }
}

