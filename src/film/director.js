import * as THREE from 'three';

// The film mode (?film=pool): a short played out by itself — the work done stage by stage by the
// same jobs the finger starts, the camera on its own path, the titles and the pins over the
// picture (the cutting is done in the game: what is recorded off the screen is the short).
// A script is a generator: it does a thing, then yields what to wait for (d.sec(2), d.job(),
// d.until(f)). Its time is the film's (real seconds); the work runs `speed` times faster.
const ease = (u) => u * u * (3 - 2 * u);
const _v = new THREE.Vector3();

export class Director {
  constructor(app, script, offline = false) {
    this.app = app; this.t = 0; this.speed = 1; this.done = false;
    this.w = null; this.cam = null; this.orbit = 0; this.tasks = new Set(); this.pins = [];
    const el = (this.el = document.createElement('div'));
    el.id = 'film';
    el.innerHTML = '<div class="f-head"><div class="f-step"></div><div class="f-title"></div><div class="f-sub"></div></div><div class="f-flash"></div><div class="f-pins"></div><div class="f-end"><img src="assets/brand/logo-stack-light.png" alt=""><span></span></div>';
    document.body.appendChild(el);
    document.body.classList.add('filming');
    this.$ = (c) => el.querySelector(c);
    this.gen = script(this, app);
    this._advance();   // (the first view is set up behind the start screen)
    // (on the phone: a tap starts it — time to start the screen recording, and the sound may only
    // start from a touch; at the end a tap goes back to the game)
    this.gate = !offline;
    if (this.gate) {
      const g = document.createElement('div');
      g.className = 'f-gate';
      g.innerHTML = '<b>Нажмите, чтобы начать</b><span>Сначала включите запись экрана.<br>Ролик снимается сам — ваш участок не тронется.</span>';
      el.appendChild(g);
      el.style.pointerEvents = 'auto';
      el.addEventListener('pointerdown', () => {
        if (this.gate) { this.gate = false; g.remove(); app.sfx?.unlock?.(); el.style.pointerEvents = 'none'; return; }
      });
    }
  }
  _advance() {
    let guard = 0;
    while (!this.done && (!this.w || this.w()) && guard++ < 50) {
      const n = this.gen.next();
      if (n.done) { this.done = true; this.w = null; break; }
      this.w = n.value || null;
    }
  }
  leave() { location.href = location.pathname; }

  // ---- what the script waits for ---------------------------------------------------------------
  sec(s) { const t1 = this.t + s; return () => this.t >= t1; }
  job() { return () => !this.app.busy(); }
  until(f) { return f; }
  // (something done every frame while the script waits: f(dt of the work) → true when it is over)
  each(f) { this.tasks.add(f); return f; }

  // ---- the camera: to a view in `dur` seconds (target, yaw, pitch, dist), then a slow turn -----
  view(to, dur = 1.5, orbit = 0) {
    const s = this.app.rig.state();
    const from = { target: new THREE.Vector3().fromArray(s.target), yaw: s.yaw, pitch: s.pitch, dist: s.dist };
    const goal = { target: to.target ? to.target.clone() : from.target.clone(), yaw: to.yaw ?? from.yaw, pitch: to.pitch ?? from.pitch, dist: to.dist ?? from.dist };
    goal.yaw = from.yaw + Math.atan2(Math.sin(goal.yaw - from.yaw), Math.cos(goal.yaw - from.yaw));   // (the short way round)
    this.cam = { from, goal, t0: this.t, dur: Math.max(1e-3, dur), orbit };
  }
  _camera() {
    const c = this.cam; if (!c) return;
    const u = ease(Math.min(1, (this.t - c.t0) / c.dur)), f = c.from, g = c.goal;
    const turn = c.orbit * Math.max(0, this.t - c.t0);
    const s = { target: _v.copy(f.target).lerp(g.target, u).toArray(), yaw: f.yaw + (g.yaw - f.yaw) * u + turn, pitch: f.pitch + (g.pitch - f.pitch) * u, dist: f.dist + (g.dist - f.dist) * u };
    this.app.rig.setState(s, true);
  }

  // ---- the words over the picture ------------------------------------------------------------------
  // (they fade in and out on the film's clock, not by CSS: rendered frame by frame, a frame takes
  // longer than the fade)
  // a stage's title (top of the frame, clear of the platform's buttons below and on the right)
  title(main, sub = '', step = '') {
    this.$('.f-step').textContent = step; this.$('.f-title').textContent = main; this.$('.f-sub').textContent = sub;
    this.head = main ? { t0: this.t } : null;
  }
  // a big word in the middle for a moment («7 DAYS LATER»)
  flash(text, dur = 1.2) { this.$('.f-flash').textContent = text; this.fl = { t0: this.t, t1: this.t + dur }; }
  // a pin on a thing in the plot: a dot on it, a line, its name (for `dur` seconds)
  pin(text, p, dur = 2.5, side = 1) {
    const e = document.createElement('div');
    e.className = 'f-pin' + (side < 0 ? ' left' : '');
    e.innerHTML = '<i></i><b></b><span></span>';
    e.querySelector('span').textContent = text;
    this.$('.f-pins').appendChild(e);
    const pin = { e, p: p.clone(), t0: this.t, t1: this.t + dur };
    this.pins.push(pin);
    return pin;
  }
  end(text) { this.title(''); this.$('.f-end span').textContent = text || ''; this.fin = { t0: this.t }; }
  _words() {
    const t = this.t, fade = (t0, t1 = Infinity, k = 0.25) => Math.max(0, Math.min(1, (t - t0) / k, (t1 - t) / k));
    const h = this.$('.f-head'), a = this.head ? fade(this.head.t0) : 0;
    h.style.opacity = a; h.style.transform = `translateY(${((1 - a) * -14).toFixed(1)}px)`;
    const f = this.$('.f-flash'), b = this.fl ? fade(this.fl.t0, this.fl.t1, 0.2) : 0;
    f.style.opacity = b; f.style.transform = `translate(-50%, -50%) scale(${(0.92 + 0.08 * b).toFixed(3)})`;
    this.$('.f-end').style.opacity = this.fin ? fade(this.fin.t0, Infinity, 0.5) : 0;
    const cam = this.app.camera, W = window.innerWidth, H = window.innerHeight;
    for (const q of [...this.pins]) {
      if (t > q.t1 + 0.3) { q.e.remove(); this.pins.splice(this.pins.indexOf(q), 1); continue; }
      _v.copy(q.p).project(cam);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      q.e.style.display = vis ? '' : 'none';
      q.e.style.opacity = fade(q.t0, q.t1);
      q.e.style.transform = `translate(${((_v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - _v.y) / 2 * H).toFixed(1)}px)`;
    }
  }

  // ---- a frame: dt — real seconds -------------------------------------------------------------
  update(dt) {
    if (this.gate) { this._camera(); return; }
    if (this.done && !this.byeArmed) { this.byeArmed = true; this.el.style.pointerEvents = 'auto'; this.el.addEventListener('pointerdown', () => this.leave()); }
    this.t += dt;
    for (const f of [...this.tasks]) if (f(dt * this.speed)) this.tasks.delete(f);
    this._advance();
    this._camera();
    this._words();
  }
}
