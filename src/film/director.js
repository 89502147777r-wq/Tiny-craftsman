import * as THREE from 'three';

// The film mode (?film=pool): a short played out by itself — the work done stage by stage by the
// same jobs the finger starts, filmed and cut in the game (what is recorded off the screen is the
// short). A script is a generator: it does a thing, then yields what to wait for (d.sec(2),
// d.job(), d.until(f)). Its time is the film's (real seconds); the work runs `speed` times faster.
//
// The camera: shots — a cut (d.cut), a move (d.move), a shot that follows a moving thing
// (d.follow); every shot keeps moving (drift: a turn, push: a dolly in or out), a zoom punch
// (d.punch), a shake on a blow (d.shake), the cut's transition (flash, whip, blur, zoom).
// The words: a step bar along the top, titles word by word, a sub line sliding in, big words in
// the middle (d.kick), counters (d.count), pins on things (d.pin). All of it on the film's clock:
// rendered frame by frame a frame takes longer than a CSS animation.
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const ease = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) ** 3;
const back = (u) => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };   // (overshoots, settles)
const _v = new THREE.Vector3();

export class Director {
  constructor(app, script, offline = false) {
    this.app = app; this.t = 0; this.dt = 0; this.speed = 1; this.done = false;
    this.w = null; this.shot = null; this.tasks = new Set(); this.items = []; this.fx = [];
    this.stepAt = 0; this.stepT = 0; this.fin = null;
    const el = (this.el = document.createElement('div'));
    el.id = 'film';
    el.innerHTML = '<div class="f-bar"></div><div class="f-heads"></div><div class="f-pins"></div><div class="f-flash"></div><div class="f-end"><img src="assets/brand/logo-stack-light.png" alt=""><span></span></div>';
    document.body.appendChild(el);
    document.body.classList.add('filming');
    this.$ = (c) => el.querySelector(c);
    this.canvas = document.getElementById('view');
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
      el.addEventListener('pointerdown', () => { if (this.gate) { this.gate = false; g.remove(); app.sfx?.unlock?.(); el.style.pointerEvents = 'none'; } });
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
  // a named moment of the film (the renderer moves the «hook» … «hookEnd» part to the front)
  mark(name) { this.marks = this.marks || {}; this.marks[name] = this.t; }
  // the words cleared at once (a clean shot)
  clear() { for (const it of this.items) it.t1 = -1; this.fin = null; this.stepAt = 0; }

  // ---- what the script waits for ---------------------------------------------------------------
  sec(s) { const t1 = this.t + s; return () => this.t >= t1; }
  job() { return () => !this.app.busy(); }
  until(f) { return f; }
  // (something done every frame while the script goes on: f(dt of the work) → true when it is over)
  each(f) { this.tasks.add(f); return f; }
  // the work's speed eased to v in dur seconds (a speed ramp)
  ramp(v, dur = 0.4) { const v0 = this.speed, t0 = this.t; this.each(() => { const u = clamp01((this.t - t0) / dur); this.speed = v0 + (v - v0) * ease(u); return u >= 1; }); }

  // ---- the camera ---------------------------------------------------------------------------------
  // a view: { target (Vector3), yaw, pitch, dist }; o: { drift (rad/s), push (share of the
  // distance a second, + in), fx (the cut: 'flash' | 'whip' | 'blur' | 'zoom'), dur (a move) }
  _now() { const s = this.app.rig.state(); return { target: new THREE.Vector3().fromArray(s.target), yaw: s.yaw, pitch: s.pitch, dist: s.dist }; }
  _full(v, from) { return { target: (v.target || from.target).clone(), yaw: v.yaw ?? from.yaw, pitch: v.pitch ?? from.pitch, dist: v.dist ?? from.dist }; }
  cut(v, o = {}) {
    const g = this._full(v, this._now());
    this.shot = { from: g, goal: g, t0: this.t, dur: 1e-3, drift: o.drift ?? 0.05, push: o.push ?? 0.04, k: 1 };
    if (o.fx) this.trans(o.fx);
  }
  move(v, dur = 1.2, o = {}) {
    const from = this.shot ? this._eval(this.shot) : this._now(), goal = this._full(v, from);
    goal.yaw = from.yaw + Math.atan2(Math.sin(goal.yaw - from.yaw), Math.cos(goal.yaw - from.yaw));   // (the short way round)
    this.shot = { from, goal, t0: this.t, dur: Math.max(1e-3, dur), drift: o.drift ?? 0.03, push: o.push ?? 0, k: 1 };
    if (o.fx) this.trans(o.fx);
  }
  // follow f() (a point in the plot) from a view's yaw / pitch / dist; lag: how slowly it keeps up
  follow(f, v, o = {}) {
    const p = f() || this._now().target, g = { target: p.clone(), yaw: v.yaw, pitch: v.pitch, dist: v.dist };
    this.shot = { from: g, goal: g, t0: this.t, dur: 1e-3, drift: o.drift ?? 0.06, push: o.push ?? 0.03, k: 1, f, lag: o.lag ?? 6, at: p.clone() };
    if (o.fx) this.trans(o.fx);
  }
  // a zoom punch: the distance × k, quickly, overshooting a little (it stays till the next shot)
  punch(k = 0.75, dur = 0.3) { const s = this.shot; if (!s) return; const k0 = s.k, t0 = this.t; this.each(() => { const u = clamp01((this.t - t0) / dur); if (this.shot === s) s.k = k0 + (k - k0) * back(u); return u >= 1; }); }
  shake(a = 0.012, dur = 0.35) { this.fx.push({ kind: 'shake', a, t0: this.t, t1: this.t + dur }); }
  // the cut's transition
  trans(kind) {
    const d = { flash: 0.22, blur: 0.25, zoom: 0.28, whip: 0.24 }[kind];
    if (d) this.fx.push({ kind, t0: this.t, t1: this.t + d, dir: Math.random() < 0.5 ? -1 : 1 });
  }
  _eval(s) {
    const u = ease(clamp01((this.t - s.t0) / s.dur)), f = s.from, g = s.goal, age = this.t - s.t0;
    let target;
    if (s.f) { const p = s.f(); if (p) s.at.lerp(p, 1 - Math.exp(-this.dt * s.lag)); target = s.at.clone(); }
    else target = f.target.clone().lerp(g.target, u);
    return { target, yaw: f.yaw + (g.yaw - f.yaw) * u + s.drift * age, pitch: f.pitch + (g.pitch - f.pitch) * u, dist: (f.dist + (g.dist - f.dist) * u) * Math.max(0.3, 1 - s.push * age) * s.k };
  }
  _camera() {
    if (!this.shot) return;
    const v = this._eval(this.shot);
    let blur = 0, scale = 1, white = 0;
    for (const e of [...this.fx]) {
      if (this.t > e.t1) { this.fx.splice(this.fx.indexOf(e), 1); continue; }
      const u = clamp01((this.t - e.t0) / (e.t1 - e.t0));
      if (e.kind === 'shake') { const a = e.a * (1 - u), t = this.t * 47; v.yaw += a * Math.sin(t) * 1.4; v.pitch += a * Math.sin(t * 1.37 + 1); v.target.y += a * v.dist * 0.4 * Math.sin(t * 0.91 + 2); }
      if (e.kind === 'flash') white = Math.max(white, (1 - u) ** 2 * 0.6);
      if (e.kind === 'blur') blur = Math.max(blur, 6 * (1 - u));
      if (e.kind === 'zoom') { scale = 1 + 0.16 * (1 - easeOut(u)); blur = Math.max(blur, 3 * (1 - u) ** 2); }
      if (e.kind === 'whip') { v.yaw += e.dir * 0.5 * (1 - easeOut(u)); blur = Math.max(blur, 7 * (1 - u) ** 2); }
    }
    this.app.rig.setState({ target: v.target.toArray(), yaw: v.yaw, pitch: v.pitch, dist: v.dist }, true);
    this.app.focusPoint = this.shot.f ? this.shot.at : null;
    this.canvas.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : '';
    this.canvas.style.transform = scale > 1.001 ? `scale(${scale.toFixed(4)})` : '';
    this.$('.f-flash').style.opacity = white.toFixed(3);
  }

  // ---- the words over the picture ------------------------------------------------------------------
  _item(el, parent, t1, anim) { parent.appendChild(el); const it = { el, t0: this.t, t1, anim }; this.items.push(it); return it; }
  // the bar of the steps along the top (n of them)
  bar(n) { this.$('.f-bar').innerHTML = '<i></i>'.repeat(n); }
  // a stage's title: the step's chip pops, the words come up one by one, the sub line slides in
  title(main, sub = '', step = 0) {
    for (const it of this.items) if (it.head && it.out == null) { it.out = this.t; it.t1 = this.t + 0.22; }
    if (step) { this.stepAt = step; this.stepT = this.t; }
    if (!main) return;
    const h = document.createElement('div');
    h.className = 'f-head';
    h.innerHTML = (step ? `<div class="f-step">STEP ${step}</div>` : '') + '<div class="f-title"></div><div class="f-sub"></div>';
    const T = h.querySelector('.f-title');
    for (const w of main.split(' ')) { const s = document.createElement('span'); s.textContent = w; T.appendChild(s); T.appendChild(document.createTextNode(' ')); }
    h.querySelector('.f-sub').textContent = sub;
    const it = this._item(h, this.$('.f-heads'), Infinity, (el, age, it) => {
      const out = it.out != null ? clamp01((this.t - it.out) / 0.22) : 0;
      el.style.opacity = (1 - out).toFixed(3);
      el.style.transform = `translateY(${(-30 * easeOut(out)).toFixed(1)}px)`;
      const chip = el.querySelector('.f-step');
      if (chip) { const u = clamp01(age / 0.3); chip.style.transform = `scale(${(0.3 + 0.7 * back(u)).toFixed(3)})`; chip.style.opacity = clamp01(age / 0.12).toFixed(3); }
      el.querySelectorAll('.f-title span').forEach((s, i) => { const u = clamp01((age - 0.08 - i * 0.07) / 0.28); s.style.opacity = clamp01(u * 2.5).toFixed(3); s.style.transform = `translateY(${((1 - easeOut(u)) * 60).toFixed(1)}%) scale(${(1.25 - 0.25 * back(u)).toFixed(3)})`; });
      const sb = el.querySelector('.f-sub'), u2 = clamp01((age - 0.35) / 0.35);
      sb.style.opacity = u2.toFixed(3); sb.style.transform = `translateX(${((1 - easeOut(u2)) * -40).toFixed(1)}px)`;
    });
    it.head = true;
  }
  // a big word in the middle: punched in, shaken, gone («7 DAYS LATER»)
  kick(text, dur = 1.1, cls = '') {
    const e = document.createElement('div');
    e.className = 'f-kick ' + cls; e.textContent = text;
    this._item(e, this.el, this.t + dur, (el, age, it) => {
      const life = it.t1 - it.t0, u = clamp01(age / 0.25), out = clamp01((age - life + 0.2) / 0.2);
      const sh = age < 0.35 ? Math.sin(age * 90) * 6 * (1 - age / 0.35) : 0;
      el.style.opacity = (Math.min(u * 3, 1) * (1 - out)).toFixed(3);
      el.style.transform = `translate(-50%, -50%) translateX(${sh.toFixed(1)}px) scale(${(1.8 - 0.8 * back(u) + out * 0.3).toFixed(3)})`;
    });
  }
  // a counter that runs up: «92 m³» (under the title, in the middle of the frame)
  count(label, to, unit = '', dur = 1.2, from = 0, life = 2.2, dec = 0) {
    const e = document.createElement('div');
    e.className = 'f-count'; e.innerHTML = '<small></small><b></b>';
    e.querySelector('small').textContent = label;
    const b = e.querySelector('b');
    this._item(e, this.el, this.t + life, (el, age, it) => {
      const u = clamp01(age / dur), out = clamp01((age - (it.t1 - it.t0) + 0.25) / 0.25), p = clamp01(age / 0.3);
      b.textContent = (from + (to - from) * easeOut(u)).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + unit;
      el.style.opacity = (p * (1 - out)).toFixed(3);
      el.style.transform = `translate(-50%, 0) scale(${(0.6 + 0.4 * back(p)).toFixed(3)}) translateY(${(out * 20).toFixed(1)}px)`;
    });
  }
  // a pin on a thing in the plot (a point, or a function giving one): the dot pops, the line
  // grows, the name slides out
  pin(text, p, dur = 2.2, side = 1) {
    const e = document.createElement('div');
    e.className = 'f-pin';
    e.innerHTML = '<i></i><b></b><span></span>';
    e.querySelector('span').textContent = text;
    const pos = typeof p === 'function' ? p : p.clone();
    this._item(e, this.$('.f-pins'), this.t + dur, (el, age, it) => {
      _v.copy(typeof pos === 'function' ? pos() : pos).project(this.app.camera);
      const W = window.innerWidth, H = window.innerHeight, vis = _v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15;
      el.style.display = vis ? '' : 'none';
      const px = (_v.x + 1) / 2 * W;
      el.style.transform = `translate(${px.toFixed(1)}px, ${((1 - _v.y) / 2 * H).toFixed(1)}px)`;
      // (the name on the side with room for it)
      const left = side < 0 ? px - el.querySelector('span').offsetWidth > W * 0.04 : px + el.querySelector('span').offsetWidth > W * 0.96;
      el.classList.toggle('left', left);
      const out = clamp01((age - (it.t1 - it.t0) + 0.25) / 0.25);
      el.style.opacity = (1 - out).toFixed(3);
      el.querySelector('i').style.transform = `scale(${back(clamp01(age / 0.25)).toFixed(3)})`;
      el.querySelector('b').style.transform = `scaleY(${easeOut(clamp01((age - 0.12) / 0.25)).toFixed(3)})`;
      const u = clamp01((age - 0.3) / 0.3), s = el.querySelector('span');
      s.style.opacity = u.toFixed(3); s.style.transform = `translateX(${((1 - easeOut(u)) * (left ? 24 : -24)).toFixed(1)}px)`;
    });
  }
  end(text) { this.title(''); this.$('.f-end span').textContent = text || ''; this.fin = this.t; }
  _words() {
    for (const it of [...this.items]) {
      if (this.t > it.t1) { it.el.remove(); this.items.splice(this.items.indexOf(it), 1); continue; }
      it.anim(it.el, this.t - it.t0, it);
    }
    // the step bar: the steps done full, the one going on filling
    const bar = this.$('.f-bar'), segs = bar.children;
    for (let i = 0; i < segs.length; i++) segs[i].style.setProperty('--f', i < this.stepAt - 1 ? 1 : i === this.stepAt - 1 ? clamp01((this.t - this.stepT) / 0.5).toFixed(3) : 0);
    bar.style.opacity = this.fin != null ? clamp01(1 - (this.t - this.fin) / 0.3) : this.stepAt ? 1 : 0;
    const e = this.$('.f-end');
    if (this.fin != null) { const u = clamp01((this.t - this.fin) / 0.5); e.style.opacity = u; e.querySelector('img').style.transform = `scale(${(0.7 + 0.3 * back(u)).toFixed(3)})`; } else e.style.opacity = 0;
  }

  // ---- a frame: dt — real seconds -------------------------------------------------------------
  update(dt) {
    this.dt = dt;
    if (this.gate) { this._camera(); return; }
    if (this.done && !this.byeArmed) { this.byeArmed = true; this.el.style.pointerEvents = 'auto'; this.el.addEventListener('pointerdown', () => this.leave()); }
    this.t += dt;
    for (const f of [...this.tasks]) if (f(dt * this.speed)) this.tasks.delete(f);
    this._advance();
    this._camera();
    this._words();
  }
}
