import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { FitJob, ease } from './fitJob.js';
import { LANG } from '../i18n/i18n.js';
import { FENCE_KINDS, FENCE_HEIGHTS, FENCE_COLS, GATES, fenceLine, sOf, legs } from '../world/fence.js';
import { HOLE, RAIL_SECS, isV2, railRows, pegsFor, legBounds, pegXZ, bays2, railMesh, postMesh, earthAuger, welderKit, welderArc, hotBead, postA } from '../world/fence2.js';

// «Забор» (its own group on the top row; the fence by the post — fence2.js): the stages one after the
// other, each a touch where it is done:
//   line  – «Шнур» on: the finger pulls the string, the pegs on it every 1 … 5 m (the slider); off: a
//           peg dragged along the string (the distances to its neighbours shown) — the room for a
//           gate or a wicket left before a hole is dug;
//   holes – a touch on a peg: it is pulled out, the petrol auger bores its hole;
//   posts – the size (square / round, 40 … 100), then a touch on a hole: the post lowered into it and
//           plumbed; the concrete — «Бетон», the hose or the bucket, hole by hole;
//   rails – the section and the length (up to 6 m), carried from the tray onto the posts (from a post
//           to the farthest one it reaches), welded to each post and to the rail before it;
//   fill  – a touch: the bays with rails filled; gate – a touch on a bay left without rails.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const EN = () => LANG === 'en';
const m1 = (mm) => (mm / 1000).toFixed(2).replace(/\.?0+$/, '').replace('.', EN() ? '.' : ',');
export const F2_TABS = [['line', 'Разметка'], ['holes', 'Ямы'], ['posts', 'Столбы'], ['rails', 'Прожилины'], ['fill', 'Наполнение'], ['gate', 'Ворота и калитки']];
// the bay a gate / a wicket takes (mm): the narrowest and the widest
const GATE_W = { swing: [2500, 5000], swingArch: [2500, 5000], slide: [3000, 5000], wicket: [800, 1500], wicketArch: [800, 1500], wicketIntercom: [800, 1500] };

export class FenceWork {
  constructor(app) { this.app = app; this.drag = null; this.sel = null; this.cord = false; this.ghost = null; }
  get s() { return this.app.settings; }
  get L() { return F2_TABS.some(([k]) => k === this.s.f2Layer) ? this.s.f2Layer : 'line'; }
  get step() { return Math.max(1000, Math.min(5000, Math.round((this.s.fenceStep || 2500) / 100) * 100)); }
  get H() { return FENCE_HEIGHTS.includes(this.s.fenceH) ? this.s.fenceH : 1800; }
  get postSh() { return this.s.postSh === 'rd' ? 'rd' : 'sq'; }
  get postA() { return Math.max(40, Math.min(100, Math.round((this.s.postA || 60) / 10) * 10)); }
  get railSec() { return RAIL_SECS[this.s.railSec] ? this.s.railSec : 'r4020'; }
  get railL() { return Math.max(1000, Math.min(6000, Math.round((this.s.railL || 6000) / 500) * 500)); }
  get kind() { return FENCE_KINDS[this.s.fenceKind] ? this.s.fenceKind : 'slat'; }
  get col() { const c = this.s.fenceCol, K = FENCE_KINDS[this.kind]; return K.cols.includes(c) ? c : K.cols[0]; }
  get gateType() { return GATES[this.s.gateType] ? this.s.gateType : 'swing'; }
  get fences() { return this.app.objects.all('fence').filter(isV2); }
  get rec() { const all = this.fences; return all.find((r) => r.id === this.sel) || all.at(-1) || null; }
  get view() { return this.app.gardenView; }
  get busy() { return !!this.drag; }
  toast(m) { this.app.ui?.toast(m); }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  _scr(v) { return this.app.wallTool._screen(v); }
  _groundOf(pts) {
    const t = this.app.terrain, hs = [];
    for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 8; k++) { const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 8, z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 8; if (t.inside(x, z)) hs.push(t.heightAt(x, z)); }
    hs.sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length / 2)] : 0.1;
  }

  // the peg / the hole / the post under the finger (on the screen, else on the plot) of those `ok` lets
  pick(p, e, ok, px = 70) {
    let best = null, bd = Infinity;
    for (const r of this.fences) (r.pegs || []).forEach((q, i) => {
      if (!ok(q, r, i)) return;
      const [x, z] = pegXZ(r, q.s);
      let d;
      if (e && e.clientX !== undefined) { const sp = this._scr(new THREE.Vector3(x, r.g + MM(250), z)); if (!sp.front) return; d = Math.hypot(sp.x - e.clientX, sp.y - e.clientY); if (d > px) return; }
      else { d = Math.hypot(p.x - x, p.z - z) / S; if (d > 500) return; }
      if (d < bd) { bd = d; best = { r, i, q }; }
    });
    if (best) this.sel = best.r.id;
    return best;
  }
  // the fence nearest a point (within 1,5 m of its line): { r, s, off }
  near(p) {
    let best = null;
    for (const r of this.fences) { const [s, off] = sOf(r, p.x, p.z); if (off < MM(1500) && (!best || off < best.off)) best = { r, s, off }; }
    if (best) this.sel = best.r.id;
    return best;
  }

  down(p, e) {
    const app = this.app, L = this.L;
    if (app.physJob?.fit) app.physJob.finish();
    if (app.physJob) return true;
    if (L === 'line') {
      if (this.cord) { this.drag = { L: 'cord', trail: [[p.x, p.z]] }; app.ui?.showMeasure?.(EN() ? 'Pull the string with your finger' : 'Тяните шнур пальцем'); return true; }
      const P = this.pick(p, e, (q, r) => !q.hole && !!legBounds(r, q.s));
      if (!P) { this.toast(this.fences.length ? 'Колышек двигают пальцем вдоль шнура (кроме углов и концов); новая разметка — кнопка «Шнур» справа' : 'Включите «Шнур» справа и тяните разметку пальцем'); return true; }
      app.journal.begin('fence-peg', {}, app.clock);
      this.drag = { L: 'peg', id: P.r.id, i: P.i, s0: P.q.s };
      this._pegMove(p);
      return true;
    }
    if (L === 'holes') {
      const P = this.pick(p, e, (q) => !q.hole);
      if (!P) { this.toast(this.fences.length ? 'Коснитесь колышка — там пробурят яму' : 'Сначала «1 · Разметка»: натяните шнур'); return true; }
      this._drill(P.r, P.i); return true;
    }
    if (L === 'posts') {
      const P = this.pick(p, e, (q) => q.hole && !q.post);
      if (!P) { this.toast(this.fences.some((r) => r.pegs.some((q) => q.hole && !q.post)) ? 'Коснитесь ямы — в неё опустят столб' : 'Сначала «2 · Ямы»: пробурите яму'); return true; }
      this._post(P.r, P.i); return true;
    }
    if (L === 'rails') { this.drag = { L: 'rail' }; this._railMove(p, e); return true; }
    const N = this.near(p);
    if (!N) { this.toast('Коснитесь забора'); return true; }
    if (L === 'fill') this._fill(N.r);
    else if (L === 'gate') this._gate(N.r, N.s);
    return true;
  }
  trayDown(p, e) {
    if (this.L !== 'rails') { this.toast(this.status()); return false; }
    if (this.app.physJob?.fit) this.app.physJob.finish();
    if (this.app.physJob) return false;
    this.drag = { L: 'rail', tray: true };
    if (p) this._railMove(p, e);
    return true;
  }
  move(p, e) {
    const d = this.drag;
    if (!d) return;
    if (d.L === 'cord') {
      const last = d.trail.at(-1);
      if (Math.hypot(p.x - last[0], p.z - last[1]) < MM(80)) return;
      d.trail.push([p.x, p.z]);
      const pts = fenceLine(d.trail) || [d.trail[0], [p.x, p.z]], pegs = pegsFor(pts, this.step), len = legs({ pts }).reduce((a, g) => a + g.L, 0);
      this.view.setLiveFence({ v: 2, pts, g: this._groundOf(pts), pegs, H: this.H });
      this.app.ui?.showMeasure?.(EN() ? `String ${m1(len)} m, ${pegs.length} pegs every ${m1(this.step)} m — let go where it ends` : `Шнур ${m1(len)} м, ${pegs.length} колышков через ${m1(this.step)} м — отпустите, где он кончается`);
    } else if (d.L === 'peg') this._pegMove(p);
    else if (d.L === 'rail') this._railMove(p, e);
  }
  up() {
    const app = this.app, d = this.drag;
    this.drag = null;
    app.ui?.hideMeasure?.();
    if (!d) return;
    if (d.L === 'cord') {
      this.view.setLiveFence(null);
      const pts = fenceLine(d.trail);
      if (!pts) { this.toast('Шнур короче метра — тяните длиннее'); return; }
      const rec = { type: 'fence', v: 2, pts, g: +this._groundOf(pts).toFixed(6), step: this.step, H: this.H, kind: this.kind, col: this.col, pegs: pegsFor(pts, this.step), rails: [], filled: [], gates: [], done: {} };
      this._save('fence-line', () => { this.sel = app.objects.add(rec).id; });
      const len = legs({ pts }).reduce((a, g) => a + g.L, 0);
      this.toast(EN() ? `String ${m1(len)} m pulled, ${rec.pegs.length} pegs every ${m1(this.step)} m. Leave room for a gate: drag a peg along the string («Шнур» off). Next «2 · Holes»`
        : `Шнур ${m1(len)} м натянут, ${rec.pegs.length} колышков через ${m1(this.step)} м. Место под ворота — сдвиньте колышки вдоль шнура (выключите «Шнур»). Дальше «2 · Ямы»`);
      return;
    }
    if (d.L === 'peg') {
      const r = app.objects.get(d.id), q = r?.pegs[d.i];
      if (!q || Math.abs(q.s - d.s0) < 1) { app.journal.cancel(); return; }
      app.journal.commit(app.clock);
      const P = r.pegs, a = P[d.i - 1], b = P[d.i + 1];
      this.toast(EN() ? `Peg moved: bays ${m1(q.s - a.s)} m and ${m1(b.s - q.s)} m` : `Колышек сдвинут: пролёты ${m1(q.s - a.s)} м и ${m1(b.s - q.s)} м`);
      return;
    }
    if (d.L === 'rail') {
      if (d.lastP) d.P = this.plan(d.lastP);   // (the last move, skipped: where it was let go counts)
      this._ghost(null);
      if (!d.P) { if (!d.tray || d.moved) this.toast('Поднесите прожилину к столбам забора'); return; }
      if (d.P.why) { this.toast(d.P.why); return; }
      this._weld(d.P.r, d.P.q);
    }
  }
  interrupt() {
    const d = this.drag; this.drag = null;
    if (d?.L === 'cord') this.view.setLiveFence(null);
    if (d?.L === 'peg') this.app.journal.cancel();
    this._ghost(null); this.app.ui?.hideMeasure?.();
  }
  update() {}

  // ---- the pegs moved along the string; the spacing changed for a fence not dug yet ----
  _pegMove(p) {
    const app = this.app, d = this.drag, r = app.objects.get(d.id);
    if (!r) return;
    const P = r.pegs, [lb0, lb1] = legBounds(r, d.s0) || [0, 0], lo = Math.max(lb0, P[d.i - 1].s) + 300, hi = Math.min(lb1, P[d.i + 1].s) - 300;
    if (hi <= lo) return;
    const s = Math.round(Math.max(lo, Math.min(hi, sOf(r, p.x, p.z)[0])) / 10) * 10;
    if (s !== P[d.i].s) app.objects.update(r.id, { pegs: P.map((q, k) => (k === d.i ? { ...q, s } : q)) });
    const a = P[d.i - 1].s, b = P[d.i + 1].s;
    app.ui?.showMeasure?.(`← ${m1(s - a)} ${EN() ? 'm' : 'м'}  |  ${m1(b - s)} ${EN() ? 'm' : 'м'} →`);
  }
  setStep(v) {
    this.s.fenceStep = v;
    const r = this.rec;
    if (!r || r.pegs.some((q) => q.hole)) return;
    this._save('fence-step', () => this.app.objects.update(r.id, { step: this.step, pegs: pegsFor(r.pts, this.step) }));
  }

  // ---- a hole: the peg pulled out, the auger brought down, the hole bored (lifted twice to clear it),
  // the spoil thrown round, the auger lifted out ----
  _drill(r, i) {
    const app = this.app, t = app.terrain, q = r.pegs[i], [x, z, ux, uz] = pegXZ(r, q.s), R = MM(HOLE.r), deep = MM(HOLE.depth), key = 'F' + r.id;
    const A = earthAuger(); A.rotation.y = Math.atan2(-uz, ux) + Math.PI / 2; A.position.set(x, r.g + MM(700), z);
    const spoilV = Math.PI * (HOLE.r / 1000) ** 2 * HOLE.depth / 1000 / MODEL_SCALE ** 3;   // (model m³)
    app.journal.begin('fence-hole', {}, app.clock);
    let dug = 0, thrown = 0;
    const dig = (dep, seed) => { if (dep > dug + MM(20)) { dug = dep; t.scoop(x, z, R * 1.12, r.g - dug, r.g, () => true, seed); } };
    const throwSpoil = (u) => {
      // (what the screw brings up is thrown round the hole, a ring of loose soil)
      const want = spoilV * u;
      while (thrown < want) {
        const v = spoilV / 60, a = Math.random() * Math.PI * 2, sp = 0.08 + Math.random() * 0.1;
        app.particles?.emit(new THREE.Vector3(x + Math.cos(a) * R, r.g + MM(60), z + Math.sin(a) * R), new THREE.Vector3(Math.cos(a) * sp, 0.12 + Math.random() * 0.1, Math.sin(a) * sp), v, MM(25 + Math.random() * 25), 0.3, 0, 0);
        thrown += v;
      }
    };
    const depthAt = (u) => { const base = deep * u, lift = (k) => Math.max(0, 1 - Math.abs(u - k) / 0.05) * deep * 0.6; return Math.max(0, base - lift(0.45) - lift(0.8)); };
    new FitJob(app, {
      parts: [A],
      steps: [
        [0.35, (u) => { if (u > 0.1) this.view.setAnim(key, { hidePeg: i }); }],   // (the peg pulled out)
        [0.7, (u) => { A.position.y = r.g + MM(700) * (1 - ease(u)); A.userData.screw.rotation.y = u * 4; app.sfx?.engine?.('fence-auger', 0.25); }],
        [2.6, (u) => {
          const dep = depthAt(u);
          A.position.y = r.g - dep; A.userData.screw.rotation.y += 0.55; A.position.x = x + (Math.random() - 0.5) * MM(4);
          dig(Math.max(dug, deep * u), i); throwSpoil(u);
          app.sfx?.engine?.('fence-auger', 0.7);
        }],
        [0.7, (u) => { A.position.y = r.g - deep * (1 - ease(u)) + MM(300) * ease(u); A.userData.screw.rotation.y += 0.2 * (1 - u); app.sfx?.engine?.('fence-auger', 0.3 * (1 - u)); }],
      ],
      onAbort: () => { app.journal.cancel(); this.view.setAnim(key, null); app.sfx?.engine?.('fence-auger', 0); },
      commit: () => {
        t.scoop(x, z, R * 1.12, r.g - deep, r.g, () => true, i);
        app.particles?.flush?.();
        const cur = app.objects.get(r.id);
        app.objects.update(r.id, { pegs: cur.pegs.map((p, k) => (k === i ? { ...p, hole: 1 } : p)) });
        app.journal.commit(app.clock);
        this.view.setAnim(key, null); app.sfx?.engine?.('fence-auger', 0);
        const left = cur.pegs.filter((p, k) => !p.hole && k !== i).length;
        this.toast(EN() ? `Hole Ø 200 bored 1 m deep${left ? ` — ${left} pegs left` : ' — all bored. Next «3 · Posts»'}` : `Яма Ø 200 глубиной 1 м пробурена${left ? ` — осталось колышков: ${left}` : ' — все ямы готовы. Дальше «3 · Столбы»'}`);
      },
    });
  }

  // ---- a post: carried over its hole, lowered in onto the gravel at the bottom, plumbed with the level ----
  _post(r, i) {
    const app = this.app, q = r.pegs[i], post = { sh: this.postSh, a: this.postA, h: this.H }, G = postMesh(r, q, post), [x, z] = pegXZ(r, q.s);
    const lift = MM(post.h + 600);
    new FitJob(app, {
      parts: [G],
      steps: [
        [0.3, (u) => { G.position.y = lift; G.visible = u > 0; }],
        [1.0, (u) => { G.position.y = lift * (1 - ease(u)); G.rotation.z = 0.06 * (1 - u) * Math.sin(u * 9); }],
        [0.15, (u) => { G.position.y = MM(15) * Math.sin(u * Math.PI); G.rotation.z = 0; if (u >= 1) app.sfx?.stab?.(); }],
        [0.6, (u) => app.handTools.set('level', new THREE.Vector3(x, r.g + MM(900), z + MM(post.a / 2 + 4)), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), u)],
      ],
      commit: () => {
        const cur = app.objects.get(r.id);
        this._save('fence-post', () => app.objects.update(r.id, { pegs: cur.pegs.map((p, k) => (k === i ? { ...p, post } : p)) }));
        const name = post.sh === 'rd' ? `Ø ${post.a}` : `${post.a} × ${post.a}`;
        this.toast(EN() ? `Post ${name}, ${m1(post.h)} m above the ground, set plumb in its hole. Concrete it: «Concrete» → the hose or the bucket` : `Столб ${name}, ${m1(post.h)} м над землёй, выставлен по уровню в яме. Забетонируйте: «Бетон» → шланг или ведро`);
      },
    });
  }

  // ---- a rail carried to the posts: from the post nearest its start to the farthest it reaches ----
  plan(p) {
    const N = this.near(p);
    if (!N) return null;
    const r = N.r, L = this.railL, sec = this.railSec, posts = r.pegs.filter((q) => q.post);
    if (posts.length < 2) return { r, q: null, why: 'Нужны хотя бы два столба' };
    // (the leg the finger is over: the rail stays in it — round a corner it is cut and welded again)
    const lb = legs(r).find((g) => N.s >= g.s0 - 1 && N.s <= g.s0 + g.L + 1) || legs(r)[0], inLeg = posts.filter((q) => q.s >= lb.s0 - 1 && q.s <= lb.s0 + lb.L + 1);
    if (inLeg.length < 2) return { r, q: null, why: 'На этой стороне забора меньше двух столбов' };
    // (from the post nearest the rail's start — the finger is at its middle — to the farthest post it
    // reaches; past the leg's last post: back from it)
    const want = N.s - L / 2, A = inLeg.reduce((x, y) => (Math.abs(y.s - want) < Math.abs(x.s - want) ? y : x));
    const fwd = inLeg.filter((q) => q.s > A.s + 1 && q.s <= A.s + L + 1), back = inLeg.filter((q) => q.s < A.s - 1 && q.s >= A.s - L - 1);
    const a = fwd.length ? A.s : back.length ? back[0].s : A.s, b = fwd.length ? fwd.at(-1).s : A.s;
    if (b - a < 1) return { r, q: { a: A.s - 200, b: A.s + 200, y: 300, sec }, why: 'Прожилину кладут от столба к столбу — до соседнего столба дальше её длины' };
    // (each peg in it must have its post, concreted)
    const mid = r.pegs.filter((q) => q.s >= a - 1 && q.s <= b + 1);
    const h = Math.min(...mid.map((q) => q.post?.h || r.H)), rows = railRows(h), taken = (y) => (r.rails || []).some((o) => Math.abs(o.y - y) < 5 && o.a < b - 1 && o.b > a + 1);
    const y = rows.find((v) => !taken(v));
    const q = { a, b, y: y ?? rows.at(-1), sec };
    let why = null;
    if (mid.some((m) => !m.post)) why = 'Между столбами пустая яма — сначала столб';
    else if (mid.some((m) => !(m.fill >= 1))) why = 'Столбы ещё не забетонированы — «Бетон» → шланг или ведро';
    else if (y == null) why = 'Здесь все ряды прожилин уже есть';
    return { r, q, why };
  }
  _railMove(p, e) {
    const d = this.drag, now = performance.now();
    if (!p) return;
    d.moved = true;
    d.lastP = p;
    if (now - (d.t || 0) < 40) return;
    d.t = now;
    const P = this.plan(p);
    d.P = P;
    if (!P || !P.q) { this._ghost(null); this.app.ui?.showMeasure?.(P?.why || (EN() ? 'Bring the rail to the fence posts' : 'Поднесите прожилину к столбам забора')); return; }
    this._ghost(railMesh(P.r, P.q, !P.why));
    const len = P.q.b - P.q.a;
    this.app.ui?.showMeasure?.(P.why || (EN() ? `Rail ${RAIL_SECS[P.q.sec].name}, ${m1(len)} m at ${m1(P.q.y)} m — let go` : `Прожилина ${RAIL_SECS[P.q.sec].name}, ${m1(len)} м на высоте ${m1(P.q.y)} м — отпустите`));
    void e;
  }
  _ghost(o) {
    if (this.ghost) { this.app.scene.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost = null; }
    if (o) { this.ghost = o; this.app.scene.add(o); }
  }
  // laid on the posts, then welded: at each post a bead along its top and its bottom edge, at the end of
  // the rail before it a bead round the butt — the arc, the sparks, the bead glowing orange and cooling
  _weld(r, q) {
    const app = this.app, R = railMesh(r, q, true, false), kit = welderKit(), beads = new THREE.Group(), sec = RAIL_SECS[q.sec], pa = postA(r);
    const y = r.g + MM(q.y), Y0 = R.position.y;
    const spots = [];
    for (const p of r.pegs) if (p.post && p.s >= q.a - 1 && p.s <= q.b + 1) for (const dy of [sec.h / 2, -sec.h / 2]) spots.push({ s: p.s, dy, len: Math.min(p.post.a, 60) * 0.8 });
    const prev = (r.rails || []).find((o) => Math.abs(o.y - q.y) < 5 && (Math.abs(o.b - q.a) < 2 || Math.abs(o.a - q.b) < 2));
    if (prev) spots.push({ s: Math.abs(prev.b - q.a) < 2 ? q.a : q.b, dy: 0, len: sec.h, joint: true });
    kit.visible = false;
    const hot = [], cool = (dt) => { for (const b of hot) b.material.emissiveIntensity = Math.max(0, b.material.emissiveIntensity - dt * 0.9); };
    let last = 0;
    const tick = (u, dur) => { const dt = Math.max(0, (u - last) * dur); last = u >= 1 ? 0 : u; return dt; };
    const steps = [[0.7, (u) => { R.position.y = Y0 + MM(400) * (1 - ease(u)); if (u >= 1) app.sfx?.stab?.(); }]];
    for (const sp of spots) {
      const [x, z, ux, uz] = pegXZ(r, sp.s), nx = -uz, nz = ux, yaw = Math.atan2(-uz, ux);
      const pos = new THREE.Vector3(x + nx * MM(pa / 2 + (sp.joint ? sec.d : sec.d * 0.35)), y + MM(sp.dy), z + nz * MM(pa / 2 + (sp.joint ? sec.d : sec.d * 0.35)));
      const b = hotBead(MM(sp.len), 0); b.position.copy(pos); b.rotation.y = sp.joint ? yaw + Math.PI / 2 : yaw; if (sp.joint) b.rotation.z = Math.PI / 2; b.scale.set(0.001, 1, 1); beads.add(b);
      const dur = sp.joint ? 1.1 : 0.8;
      steps.push([dur, (u) => {
        const dt = tick(u, dur);
        kit.visible = u < 0.98;
        // (the electrode along the seam, held at 60° to it, the holder from outside and above)
        const along = sp.joint ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(ux, 0, uz), at = pos.clone().addScaledVector(along, MM(sp.len) * (u - 0.5));
        kit.position.copy(at); kit.rotation.set(0, yaw, 0); kit.userData.holder.rotation.set(-0.5, 0, 0.35);
        welderArc(kit, u < 0.95 ? 1 : 0, dt);
        b.scale.x = Math.max(0.001, Math.min(1, u * 1.05)); b.visible = true;
        if (!hot.includes(b)) hot.push(b);
        cool(dt * 0.3);
        app.sfx?.engine?.('fit-drill', u < 0.95 ? 0.08 : 0, 2);
      }]);
    }
    steps.push([1.2, (u) => { const dt = tick(u, 1.2); kit.visible = false; welderArc(kit, 0, dt); cool(dt * 1.4); }]);
    new FitJob(app, {
      parts: [R, kit, beads], steps,
      onAbort: () => app.sfx?.engine?.('fit-drill', 0),
      commit: () => {
        app.sfx?.engine?.('fit-drill', 0);
        const cur = app.objects.get(r.id);
        this._save('fence-rail', () => app.objects.update(r.id, { rails: [...(cur.rails || []), q] }));
        this.toast(EN() ? `Rail ${sec.name}, ${m1(q.b - q.a)} m welded to ${spots.filter((s) => !s.joint).length / 2} posts${prev ? ' and to the rail before it' : ''}` : `Прожилина ${sec.name}, ${m1(q.b - q.a)} м приварена к ${spots.filter((s) => !s.joint).length / 2} столбам${prev ? ' и к соседней прожилине' : ''}`);
      },
    });
  }

  // ---- the fill: the bays with rails on every row, not filled yet, bay by bay ----
  _fill(r) {
    const app = this.app, B = bays2(r).filter((b) => b.railed && !b.filled && b.gate < 0), kind = this.kind, col = this.col, key = 'F' + r.id;
    if (!B.length) { this.toast(bays2(r).some((b) => b.railed) ? 'Все пролёты с прожилинами уже заполнены' : 'Сначала «4 · Прожилины»: заполнение крепят к ним'); return; }
    if ((r.filled || []).length && (r.kind !== kind || r.col !== col)) { this.toast('У этого забора уже другое заполнение — выберите его в «5 · Наполнение»'); return; }
    const fresh = B.map((b) => b.mid), n = Math.max(1, B.reduce((a, b) => a + piecesIn(kind, r, b), 0));
    app.journal.begin('fence-fill', {}, app.clock);
    if (r.kind !== kind || r.col !== col) app.objects.update(r.id, { kind, col });
    this.view.setAnim(key, { fresh, fill: 0 });
    new FitJob(app, {
      parts: [],
      steps: [[Math.max(2.5, Math.min(14, n * (kind === 'mesh' || kind === 'chain' ? 0.45 : 0.06))), (u, job) => {
        const k = u * (n + 1);
        this.view.setAnim(key, { fresh, fill: u >= 1 ? 1e9 : k });
        if (Math.floor(k) !== job._k) { job._k = Math.floor(k); app.sfx?.stab?.(); }
      }]],
      onAbort: () => { app.journal.cancel(); this.view.setAnim(key, null); },
      commit: () => {
        const cur = app.objects.get(r.id);
        app.objects.update(r.id, { filled: [...(cur.filled || []), ...fresh] });
        app.journal.commit(app.clock); this.view.setAnim(key, null);
        this.toast(EN() ? `${FENCE_KINDS[kind].name}: ${B.length} bays filled` : `${FENCE_KINDS[kind].name}: заполнено пролётов — ${B.length}`);
      },
    });
  }

  // ---- a gate / a wicket into a bay left without rails (its width: the bay's), or opened / closed ----
  _gate(r, s) {
    const app = this.app, gates = r.gates || [], key = 'F' + r.id;
    const hit = gates.findIndex((q) => Math.abs(q.s - s) < q.w / 2);
    if (hit >= 0) {
      const open = !gates[hit].open;
      this._save('gate-open', () => app.objects.update(r.id, { gates: gates.map((q, i) => (i === hit ? { ...q, open } : q)) }));
      this.toast(open ? `${GATES[gates[hit].type].name}: открыто` : `${GATES[gates[hit].type].name}: закрыто`);
      return;
    }
    const b = bays2(r).find((q) => s >= q.a.s && s <= q.b.s);
    if (!b) { this.toast('Коснитесь пролёта забора'); return; }
    if (!(b.a.post && b.b.post) || !(b.a.fill >= 1 && b.b.fill >= 1)) { this.toast('Ворота вешают на забетонированные столбы с обеих сторон пролёта'); return; }
    if (b.railed || (r.rails || []).some((q) => q.a < b.b.s - 1 && q.b > b.a.s + 1)) { this.toast('В этом пролёте прожилины — ворота и калитки ставят в пролёт без них (его оставляют при разметке)'); return; }
    const T = GATES[this.gateType], [lo, hi] = GATE_W[this.gateType];
    if (b.L < lo || b.L > hi) { this.toast(EN() ? `The bay is ${m1(b.L)} m: ${T.name} takes ${m1(lo)} … ${m1(hi)} m — move the pegs at the setting-out` : `Пролёт ${m1(b.L)} м: ${T.name.toLowerCase()} — от ${m1(lo)} до ${m1(hi)} м. Ширину задают колышками при разметке`); return; }
    const gi = gates.length, rec = { s: Math.round(b.mid), w: Math.round(b.L), type: this.gateType, open: false, hung: 1 };
    app.journal.begin('gate', {}, app.clock);
    app.objects.update(r.id, { gates: [...gates, rec] });
    new FitJob(app, {
      parts: [],
      steps: [[1.0, (u, job) => { this.view.setAnim(key, { gate: gi, gu: u, gopen: 0 }); if (u > 0.9 && !job._g) { job._g = 1; app.sfx?.stab?.(); } }],
        [1.6, (u) => this.view.setAnim(key, { gate: gi, gu: 1, gopen: Math.sin(Math.PI * u) })]],
      onAbort: () => { app.journal.cancel(); this.view.setAnim(key, null); },
      commit: () => { app.journal.commit(app.clock); this.view.setAnim(key, null); this.toast(EN() ? `${T.name}, ${m1(b.L)} m: hung on the posts and tried. Tap it — open or close` : `${T.name}, ${m1(b.L)} м: ${T.gate ? 'навешены' : 'навешена'} на столбы и опробованы. Коснитесь — открыть или закрыть`); },
    });
  }

  status() {
    return {
      line: this.cord ? (EN() ? `Pull the string with your finger — a peg every ${m1(this.step)} m (the slider)` : `Тяните шнур пальцем — колышки через ${m1(this.step)} м (ползунок)`) : 'Двигайте колышки вдоль шнура — место под ворота и калитку; «Шнур» справа — новая разметка',
      holes: 'Коснитесь колышка — его вынут и пробурят яму',
      posts: 'Размер столба — в «Размерах», затем коснитесь ямы: столб опустят в неё. Бетон — «Бетон» → шланг или ведро',
      rails: 'Тяните прожилину из лотка справа к столбам — от столба до столба, её приварят',
      fill: `Коснитесь забора — «${FENCE_KINDS[this.kind].name}» в пролёты с прожилинами`,
      gate: `Коснитесь пролёта без прожилин — «${GATES[this.gateType].name}»; коснитесь ворот — открыть или закрыть`,
    }[this.L];
  }
}
// the pieces of the fill in a bay (for the length of the animation)
function piecesIn(kind, r, b) {
  const H = Math.min(b.a.post?.h || r.H, b.b.post?.h || r.H);
  return kind === 'slat' ? Math.floor((H - 50) / 150) : kind === 'louvre' ? Math.floor((H - 100) / 70) : kind === 'picket' ? Math.floor(b.L / 150) : 1;
}
void FENCE_COLS;
