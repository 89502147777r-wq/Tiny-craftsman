import * as THREE from 'three';
import { MODEL_SCALE, TRAY } from '../config.js';
import { look } from './director.js';
import { findSlab, slabHole, slabCage, slabForm } from '../tools/slab.js';
import { floorUnder } from '../world/slabForm.js';
import { beltCage, beltContains, plan, toWorld, toFrame } from '../tools/belt.js';
import { findUpstand } from '../tools/upstand.js';
import { slabRuns, findRail } from '../world/railing.js';
import { roofArea, ROOF } from '../world/roof.js';
import { findOpenings } from '../tools/windowFit.js';
import { ext, OFF, CELL, cutPiece, runsOf, ck, railCols, bracketRows, VENT_SUB } from '../world/facade.js';

// «Ibiza», stages 3–5 in one film (the owner, 2026-11-15; the plan by seconds — docs/ideas/film3-plan.md, the owner's «ок»
// 2026-11-18, up to 90 s): the «sail» — the slab 300 over the pavilion with its cantilevers 3 m over the pool and 2,4 m to the left
// (a notch round the fireplace's tower, the olive's opening) — its props, beams and plywood going up piece by piece, its bars, the
// hose, the rule, the curing film, a week; its edge boards off, its upstand cast; the damp-proof course; the box of aerated block on
// it; the box's roof slab; 28 days — the props out from the cantilever's edge back to the walls: the sail hangs over the water (the
// «wow»); the box's green roof; the terrace (its membrane turned up the upstand, the stone deck on pedestals, the glass railing); the
// glass walls; the plaster, the HPL in walnut, the spine's sandstone on its ventilated facade; the white fascias last. Every close step
// is the game's own work, by «нарастание» (×1 → ×3 → ×6, never more). It starts where stage 2 ended (assets/films/ibiza-2.json.gz);
// the hook is the rewind from the last frame (the loop), a «?» under the cantilever's free corner — no words.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
// the pavilion as stage 2 left it (its slab as cast — stairFilm measured it): the walls' outer faces, the inner wall's middle
const SL = { x0: -4940, x1: 4657, z0: -2318, z1: 4171 }, IN = -1665;
const FRONT = 3000, LEFT = 2400;   // (the cantilevers: over the pool, to the left — the architect's v2)
const OLIVE = [-7100, -1750, -5300, 50];   // (the olive's opening — the owner: behind the pool, by the fireplace)
const TOWER = [-7400, 1770, -7070, 4300];  // (the fireplace tower's notch in the left cantilever: its face −7,1 + a joint 30)
const CORNER = [-7340, -5318];
// (the box's walls' strips on the sail, 300 + 25 each side: the upstand is cast before them — it stops at their faces)
const BOXSKIP = () => [[IN - 300, SL.z0, SL.x1, SL.z0 + 300], [IN - 300, SL.z1 - 300, SL.x1, SL.z1], [IN - 300, SL.z0, IN, SL.z1], [SL.x1 - 300, SL.z0, SL.x1, SL.z1]].map((r) => r.map((v) => v / 1000 / MODEL_SCALE));
// (the terrace's drain on the left cantilever, between the olive's opening and the front: the falls to it; the overflow by it)
const DRAIN = [-6640, -3500];

// the box's walls on the sail: aerated block 300, 12 courses on glue (the first on mortar 20) — the corners bonded every other course;
// its left side on the pavilion's inner wall, the rest over the pavilion's walls (the path of the loads — docs/ideas/ibiza.md); a
// glass wall to the sea 2,5 m (the slab over it bridges it — its edge the lintel)
const BOX = () => [
  ['x', SL.z0, IN - 150, 0, 1, [0, 0], [300, 0]], ['x', SL.z0, 2500, SL.x1, 1, [0, 0], [0, 300]],
  ['x', SL.z1, IN - 150, SL.x1, -1, [0, 0], [300, 300]],
  ['z', IN - 150, SL.z0, SL.z1, 1, [300, 300], [0, 0]], ['z', SL.x1, SL.z0, SL.z1, -1, [300, 300], [0, 0]],
];
function boxWalls(base) {
  const out = [];
  for (const [ax, fixed, A0, A1, inw, even, odd] of BOX()) for (let k = 0; k < 12; k++) {
    const [t0, t1] = k % 2 ? odd : even, a0 = A0 + t0, a1 = A1 - t1, y0 = 20 + k * 253, w = fixed + inw * 150;
    for (let a = A0 - (k % 2) * 301.5; a < a1; a += 603) {
      const lo = Math.max(a, a0), hi = Math.min(a + 600, a1); if (hi - lo < 40) continue;
      const m = (lo + hi) / 2, sz = [hi - lo, 250, 300], y = base + MM(y0 + 125);
      out.push({ type: 'unit', kind: 'block', free: true, p: ax === 'x' ? [MM(m), y, MM(w)] : [MM(w), y, MM(m)], s: (ax === 'x' ? sz : [sz[2], sz[1], sz[0]]).map(MM), q: [0, 0, 0, 1] });
    }
  }
  return out.sort((p, q) => p.p[1] - q.p[1]);
}
// (a debug start: ?filmFrom=<stage> with ?filmStart=<the plot saved where it begins> — scratchpad devsnap.mjs)
const FROM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('filmFrom') : null;

export function* sailFilm(d, app) {
  const V = THREE.Vector3, O = app.objects, T = app.terrain, st = app.settings, W = app.wallTool, G = app.concreteGear, H = app.handTools;
  Object.assign(st, { dayHour: 9.5, pump: 1.25, rebarD: 12, cover: 30, slabCant: 3000 }); app.sky.setHour(9.5);
  d.lock = true; d.hand = 0.3;
  const startIds = new Set(O.all().map((r) => r.id));
  d.logo();
  // (the analyst and the owner, 2026-11-15: the stage's own pencil sketch pinned in the corner — the goal of this film; at the end it
  // grows to the frame over the same view and washes into the real thing; made from the film's own loop frame)
  const sk = document.createElement('img'); sk.className = 'f-sketch'; sk.src = 'assets/films/ibiza-3-sketch-card.png'; sk.alt = ''; d.el.appendChild(sk);
  const pin = document.createElement('img'); pin.className = 'f-tack'; pin.src = 'assets/films/sketch-pin.png'; pin.alt = ''; d.el.appendChild(pin);   // (its own picture: taken out first at the end — the realist)
  // (the owner and the analyst, 2026-11-16: the sheet is pinned in, not there from the start — over the torch's close work, just after
  // the hook (never in it: ≤ 2 motions there), 0.5 s: in from the top right turning, a small bounce, then the pin pressed in 0.1 s;
  // real recordings — paper, the pin into cork)
  { const t0 = d.t + 0.9; sk.style.opacity = pin.style.opacity = '0'; let rustled = false, pressed = false;
    const back = (u) => { const c = 1.2; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };   // (ease-out with an overshoot: the bounce)
    d.each(() => {
      const u = (d.t - t0) / 0.5; if (u < 0) return false;
      if (!rustled) { rustled = true; app.sfx?.play?.('paper', { vol: 0.5 }); }
      const v = Math.min(1, u), e = back(v);
      sk.style.opacity = String(Math.min(1, v * 2.5));   // (from past the frame's corner, small — a flight, not an appearing: the analyst)
      sk.style.transform = v < 1 ? `translate(${(1 - e) * 150}%, ${-(1 - e) * 130}%) rotate(${(1 - e) * 22}deg) scale(${0.45 + 0.55 * e})` : '';
      const p = (d.t - t0 - 0.5) / 0.1;   // (the pin: from above, larger — pressed down into the sheet)
      if (p >= 0) {
        if (!pressed) { pressed = true; app.sfx?.play?.('pin', { vol: 0.6 }); }
        const w = Math.min(1, p); pin.style.opacity = String(Math.min(1, w * 3)); pin.style.transform = w < 1 ? `translateY(${-(1 - w) * 70}%) scale(${1 + (1 - w) * 0.6})` : '';
        if (w >= 1) { pin.style.opacity = sk.style.opacity = ''; return true; }
      }
      return false;
    }); }
  // (a big word over the frame: the sheet dimmed under it, as under a bill — check-film: words never over each other)
  let dimN = 0; const dim = (dur) => { dimN++; sk.style.opacity = pin.style.opacity = '0.3'; const t1 = d.t + dur; d.each(() => { if (d.t < t1) return false; if (--dimN === 0) sk.style.opacity = pin.style.opacity = ''; return true; }); };
  d.money(true); d.byStages();
  const say = (m) => { (d.notes = d.notes || []).push([+d.t.toFixed(1), m]); };
  const g = T.heightAt(MM(-9000), MM(9000)), P = (x, y, z) => new V(MM(x), g + MM(y), MM(z)), idle = () => !app.busy();
  // (an eye over the ground where it stands, never in it — the beach falls to the sea)
  const PE = (x, y, z) => new V(MM(x), Math.max(g, T.heightAt(MM(x), MM(z))) + MM(y), MM(z));
  const lift = (e) => { const h = T.heightAt(e.x, e.z) + MM(350); if (e.y < h) e.y = h; return e; };
  // ---- the camera (as in stages 1–2): a still shot list cut by the film's clock, or a tripod panning after the tool ----
  // (what the crew finished off the camera — a pour's rest: done at the next cut, never seen filling up by itself)
  let later = []; const flush = () => { const f = later; later = []; for (const fn of f) fn(); };
  let shotN = 0, cutT = -9, tool = () => null; d.toolAt = () => tool();   // (for scripts/check-film.mjs: where the work is)
  const shots = (list) => { const id = ++shotN; let i = -1, t1 = -1; const f = () => { if (id !== shotN) return true; if (i < 0 && d.t - cutT < 0.85) return false; if (d.t >= t1) { if (i >= list.length - 1) { t1 = d.t + 1; return false; } i++; const [sec, e, a] = list[i]; d.cut(look(PE(...e), P(...a)), { drift: 0.006, push: 0.008, hand: 0.2 }); cutT = d.t; flush(); t1 = d.t + sec; } return false; }; f(); d.each(f); };
  const act = (list) => {
    const id = ++shotN; let k = -1, t1 = -1, eye = null, aim = null, sp = 1;
    const f = () => {
      if (id !== shotN) return true;
      const p = tool(); if (!p) return false;
      if (!eye && d.t - cutT < 0.85) return false;   // (the shot on is younger than 0,85 s: it stays a little — no flash of a shot)
      if (eye && d.t >= t1 && k >= list.length - 1) { t1 = d.t + 1; }   // (past the list's end: the last shot goes on, no cut a frame before the work ends)
      else if (d.t >= t1 || !eye) {
        k++; const L = list.length, i = k < L ? k : L - 2 + ((k - L) % 2), [sec, [dx, dy, dz], v] = list[Math.max(0, i)];
        eye = lift(new V(p.x + MM(dx), p.y + MM(dy), p.z + MM(dz))); aim = p.clone(); sp = v;
        d.cut(look(eye, aim), { drift: 0.004, push: 0.006, hand: 0.2 }); cutT = d.t; flush(); t1 = d.t + sec;
      } else { const st0 = p.clone().sub(aim).multiplyScalar(1 - Math.exp(-d.dt * 6)), mx = MM(4000) * d.dt; if (st0.length() > mx) st0.setLength(mx); aim.add(st0); const vw = look(eye, aim); if (d.shot) d.shot.goal = d.shot.from = d._full(vw, d.shot.goal); }   // (the pan after the work: the aim never quicker than ~4 m/s — a piece going on across the slab is not a cut)
      d.speed = sp; return false;
    };
    f(); d.each(f);
  };
  const still = () => { ++shotN; };
  const WV = app.wallView, RV = app.rebarView;
  // (a bill once a stage's work is done — one or two words of the material (the owner, 2026-11-18), over the sky, never two at once)
  // (shown once the next work is going — over the work moving, never over a still frame: check-film; 2 s apart)
  let billT = -9, billed = 0; const billSoon = (label, after = 0.4, atShow = false) => { const at = Math.max(d.t + after, billT + 2.05), usd = atShow ? 0 : Math.round((d._billFrom ?? app.budget.money) - app.budget.money - billed); billed += usd; billT = at; d.each(() => { if (d.t < at) return false; billed -= usd; dim(1.9); d.stageBill(label, atShow ? Math.round((d._billFrom ?? app.budget.money) - app.budget.money - billed) : usd); return true; }); };   // (atShow: the sum as it is shown — the pour's rest is finished at the cut before it)   // (the sum as the stage's work ends — what comes after it is the next bill's)
  const money0 = app.budget.money;
  // (the hammer nailing at a point: two blows a nail — the realist; it stands, then it is put away)
  const HU = new V(0, 1, 0);
  const nail = (p, n, tn) => { const ph = (tn % 0.6) / 0.6, fz = (ph * 2) % 1, sw = fz < 0.7 ? Math.sin(fz / 0.7 * Math.PI / 2) : Math.cos((fz - 0.7) / 0.3 * Math.PI / 2); H.set('hammer', p, n, HU, sw * 0.6); return Math.floor(tn / 0.3); };
  let blow0 = -1; const blowSnd = (b) => { if (b !== blow0) { blow0 = b; if (b > 0) app.sfx?.play?.('hammer_nail', { vol: 0.55 }); } };
  // ---- the things of the film found on the plot (a debug start begins in the middle) ----
  const slabs = () => O.all('belt').filter((b) => b.kind === 'slab').sort((a, b) => a.top - b.top);
  const sailRec = () => slabs().find((b) => b.top - g > MM(3000) && b.top - g < MM(4500));
  const roofRec = () => slabs().find((b) => b.top - g > MM(6000));
  const ring = O.all('belt').find((b) => b.kind !== 'pool' && b.kind !== 'slab' && b.kind !== 'upstand' && b.top - g > MM(3000) && beltContains(b, MM(0), MM(SL.z1 - 150)));
  const yTop = ring ? ring.top + ring.H : g + MM(3650);
  // (the subject for check-film — the sail and the box on it whole and uncovered on the loop's frame)
  // (the loop's frame is the question — the cantilevers' free corner over the empty pool, nothing under it: that part of the sail and
  // the pool under it, whole in the frame's band; the whole sail with its box can not be seen from eye height inside the plot in 9:16)
  d.subject = () => { const b = sailRec(); if (!b) return null; const B = new THREE.Box3(); B.expandByPoint(new V(MM(CORNER[0]), b.top + b.H + MM(450), MM(CORNER[1]))); B.expandByPoint(new V(MM(CORNER[0] + 2000), b.top - MM(1500), MM(CORNER[1] + 300))); return B; };   // (its free end: 2 m of the front edge from the corner, the air 1,5 m under it)
  d.subjectAll = () => { const b = sailRec(); if (!b) return null; const B = new THREE.Box3(); for (const [s, t] of [[0, 0], [b.ni * b.c, 0], [0, b.nj * b.c], [b.ni * b.c, b.nj * b.c]]) { const [x, z] = toWorld(b, s, t); B.expandByPoint(new V(x, b.top, z)); } const r = roofRec(); B.expandByPoint(new V(B.min.x, r ? r.top + r.H + MM(150) : b.top + b.H + MM(1200), B.min.z)); return B; };
  const snake = (x0, x1, z0, z1, step) => { const pts = []; for (let z = z0, k = 0; z <= z1; z += step, k++) pts.push(k % 2 ? [x1, z] : [x0, z], k % 2 ? [x0, z] : [x1, z]); return pts; };
  const full = (id) => { const r = O.get(id); if (r && r.fill < 0.999) app.journal.act('belt-pour', {}, app.clock, () => O.update(id, { lv: r.lv.map(() => r.H / S), sm: r.lv.map(() => 0.9), fill: 1 })); };
  // (a slab poured by the hose to the end — the owner: the build-up with the hose, never the clock: the hand along the snake, the
  // shots ×1 → ×3 → ×6; the hand at a walk in the close shot, quicker after (vOf); done — full, or no room under the spout for a
  // moment: the hose comes away at once (no stream held over full concrete))
  // (the hand at a walk — the game's hose follows a hand ≤ 2,6 m/s: quicker, the spout lags, the heap under it runs over the boards);
  // the shots' time is the pour seen; the rest of it the crew pours meanwhile — full at the cut to the next work, never in a shot)
  const hosePour = function* (id, pts, acts, vOf = (sp) => (sp <= 1 ? 900 : 2400)) {
    const hose = app.concreteTools.hose, b = O.get(id), yb = b.top + b.H, ev = (q) => ({ target: id, hit: q });
    const sg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), tl = sg.reduce((x, y) => x + y, 0);
    const path = (u) => { let s2 = Math.max(0, Math.min(1, u)) * tl, i = 0; while (i < sg.length - 1 && s2 > sg[i]) { s2 -= sg[i]; i++; } const A = pts[i], Bq = pts[i + 1], f = Math.min(1, s2 / sg[i]); return new V(MM(A[0] + (Bq[0] - A[0]) * f), yb, MM(A[1] + (Bq[1] - A[1]) * f)); };
    app.setTool('hose'); d.menu([], 'hose', 'Быстро');
    st.pump = 1e-5; { const p0 = path(0); hose.down(p0, ev(p0)); let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(p0, ev(p0)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - p0.x, sp.z - p0.z) < MM(500)); }); d.speed = 1; }
    // (the delivery from the volume and the hand's walk: one pass fills it)
    // (the delivery follows the hand: what a metre of the snake holds — the slab's area over the path's length × its depth — as the
    // hand walks it; too much and it heaps under the spout and runs off, too little and the hand leaves it short)
    const vol = plan(b).cells.length * (b.c / S / 1000) ** 2 * (b.H / S / 1000), perM = 1.1 * vol / (tl / 1000), cap = b.kind === 'slab' ? 1e9 : 0.2;
    const rate = () => Math.max(0.01, Math.min(cap, perM * vOf(d.speed) / 1000));
    st.pump = rate();
    tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
    act(acts);
    const seen = acts.reduce((a, q) => a + q[0], 0);
    let u = 0, wetE = 1; const t0 = d.t, share = (ch) => { let a = 0; for (const x of ch.h) a += Math.min(1, x / ch.cap); return a / ch.h.length; };
    yield d.until(() => {
      u += d.dt * d.speed * vOf(d.speed) / tl; const q = path(u); hose.move(q, ev(q)); st.pump = rate();
      wetE = wetE * 0.8 + (G.pump?.stream?.visible ? 0.2 : 0);   // (the share of frames with the stream lately: it flickers where there is no room)
      const ch = hose.ch;
      return (u >= 1 && (!ch?.h || share(ch) > 0.97 || wetE < 0.5)) || (d.t - t0 > 1 && wetE < 0.5 && ch?.h && share(ch) > 0.9) || d.t - t0 > seen;
    });
    { const ch = hose.ch; if (ch?.h) { let a = 0, mx = 0, n0 = 0; for (const x of ch.h) { a += x; mx = Math.max(mx, x); if (x < 5) n0++; } say(`pour ${id} cells ${ch.h.length} mean ${(a / ch.h.length).toFixed(0)} max ${mx.toFixed(0)} cap ${ch.cap.toFixed(0)} empty ${n0} spilt ${(ch.spilt || 0).toFixed(0)}`); } }
    hose.up(); hose.finish?.(); d.speed = 4; yield d.until(idle); d.speed = 1; G.set?.(null);
    still();
    const f = O.get(id)?.fill ?? 0; say(`pour ${id} fill ${f.toFixed(3)} in ${(d.t - t0).toFixed(1)} (the rest at the cut)`);
    later.push(() => full(id));
  };

  const phases = [];
  // (the owner, 2026-11-18, «в»: this film ends with the sail hanging over the water; the green roof, the terrace, the glass and the
  // finish are the next film's — their stages stay here for it, not played)
  const PLAY = new Set(['form', 'rebar', 'pour', 'week', 'upstand', 'dpc', 'box', 'roofslab', 'month', 'strip']);
  let maxProp = 0;
  const phase = (name, fn) => phases.push([name, fn]);

  // ==== 1 · the sail's formwork: the props from the cantilever's edge, the beams, the plywood — piece by piece ====
  phase('form', function* () {
    const B = findSlab(app, new V(MM(0), yTop - MM(20), MM(SL.z1 - 150)), null, null, 0, { H: 300, bridge: 6000, cants: [[0, -1, FRONT], [-1, 0, LEFT]], within: [MM(SL.x0 - 60), MM(SL.z0 - 60), MM(SL.x1 + 60), MM(SL.z1 + 60)] });
    say('sail ' + (B ? `${B.rec.ni}×${B.rec.nj} ${B.area.toFixed(1)} m² H ${Math.round(B.rec.H / S)}` : 'none FAILED') + ' ring ' + (ring?.id ?? '-'));
    if (!B) return;
    st.wallKind = 'slab'; app.setTool('wall'); d.menu(['mono', 'slab'], 'wall');
    let sail = null;
    app.journal.act('slab-form', {}, app.clock, () => { sail = O.add(B.rec).id; });
    for (const [r, notch] of [[OLIVE, false], [TOWER, true]]) { const Hh = slabHole(O.get(sail), MM(r[0]), MM(r[1]), MM(r[2]), MM(r[3]), notch); say((notch ? 'notch ' : 'hole ') + (Hh.patch ? `${Hh.w}×${Hh.l}` : Hh.why + ' FAILED')); if (Hh.patch) app.journal.act('slab-hole', {}, app.clock, () => O.update(sail, Hh.patch)); }
    const SF = WV.slabForm, rec = () => O.get(sail);
    // (how many pieces: the reveal with u = 1 counts them; the first one's place — the camera is on it from the first frame)
    WV.reveal = { id: sail, u: 1, slab: true }; WV.dirty = true; app.simulate(0.05);
    const N = SF.revealTip?.n || 200;
    WV.reveal = { id: sail, u: 0.5 / N, slab: true }; WV.dirty = true; app.simulate(0.05);
    const first = SF.revealTip ? new V().fromArray(SF.revealTip.at).add(new V(0, MM(1500), 0)) : P(CORNER[0], 2000, CORNER[1]);
    say('form pieces ' + N);
    { const b0 = O.get(sail), fl = floorUnder(T, O.all('belt')), F = slabForm(b0, (x, z) => fl(x, z, b0.top - MM(500))); for (const q of F.props) maxProp = Math.max(maxProp, q[3] - q[2]); }
    // (the deck's sheets are the last 40 or so; the board faces round its edge come up with the rest)
    const nDeck = SF.revealKinds?.deck || 40;
    let n = 0; const setN = (x) => { n = Math.max(0, Math.min(N, x)); WV.reveal = { id: sail, u: n / N, slab: true }; WV.dirty = true; };
    setN(0.5);
    const tipAt = () => { const tp = SF.revealTip; if (!tp) return null; const p = new V().fromArray(tp.at); if (tp.k === 'prop') p.y += MM(1500); return p; };
    // (in the fast shots the pieces go on all over: the work is the slab's middle there — a fixed point, the camera still)
    const T0 = [0, 2.0, 3.9, 5.4, 6.8, 7.5], NN = [0.5, 2, 8, N - nDeck, N - nDeck + 1, N];
    const tF0 = d.t; let lastP = first; const fastAt = () => { const e = d.t - tF0; return (e >= T0[2] - 0.05 && e < T0[3] - 0.05) || e >= T0[4] - 0.05; }; const midF = (() => { const b0 = O.get(sail), [x, z] = toWorld(b0, b0.ni * b0.c / 2, b0.nj * b0.c / 2); return new V(x, b0.top - MM(1600), z); })();
    tool = () => (H.cur === 'hammer' && H.tools.hammer.g.visible ? H.tools.hammer.g.getWorldPosition(new V()) : fastAt() ? midF.clone() : (lastP = tipAt() || lastP));
    // the camera by the clock (a shot each): ×1 the first props stood up under the cantilever's corner — low from the pool's floor;
    // ×3 the row on; ×6 the forest and the beams; ×1 a sheet let down onto the beams and nailed to the edge board; ×6 the deck
    act([[2.0, [-2000, -700, -2200], 1], [1.9, [-1800, 300, 2600], 3], [1.5, [-3600, 1800, -3800], 6], [1.4, [1700, 1000, -1600], 1], [0.9, [-2600, 1700, -2700], 6]]);
    const snd = ['metal_hit', 'pipe', 'plank']; let k = 0, nailed = null; const t0 = d.t;
    yield d.until(() => {
      const e = d.t - t0, q = Math.min(T0.length - 2, T0.findIndex((x, i) => e >= x && e < (T0[i + 1] ?? 1e9))), f = Math.min(1, (e - T0[q]) / (T0[q + 1] - T0[q]));
      const was = Math.floor(n);
      setN(q === 3 ? NN[3] + Math.min(1, f / 0.45) * 0.999 : NN[q] + (NN[q + 1] - NN[q]) * f);
      if (Math.floor(n) > was) app.sfx?.play?.(snd[k++ % snd.length], { vol: 0.45, gap: 0.07 });
      // (the sheet down: nailed at its edge to the edge board under it — two blows a nail, a nail every 0,4 m along it)
      if (q === 3 && f > 0.45) {
        if (!nailed) { const tp = SF.revealTip, at = tp ? new V().fromArray(tp.at) : first; let best = null;
          for (const F of WV.boardFaces?.(rec()) || []) { const dx = F.x1 - F.x0, dz = F.z1 - F.z0, L2 = dx * dx + dz * dz || 1, w = Math.max(0, Math.min(1, ((at.x - F.x0) * dx + (at.z - F.z0) * dz) / L2)), x = F.x0 + dx * w, z = F.z0 + dz * w, dd = Math.hypot(x - at.x, z - at.z); if (!best || dd < best.dd) best = { dd, x, z, F, ux: dx / Math.sqrt(L2), uz: dz / Math.sqrt(L2) }; }
          nailed = best ? { p: new V(best.x + best.F.ox, best.F.y + MM(70), best.z + best.F.oz), n: new V(best.F.ox, 0, best.F.oz).normalize(), ux: best.ux, uz: best.uz, t: d.t } : null; }
        if (nailed) { const tn = d.t - nailed.t, j = Math.floor(tn / 0.6); blowSnd(nail(nailed.p.clone().add(new V(nailed.ux * MM(400) * j, 0, nailed.uz * MM(400) * j)), nailed.n, tn)); }
      } else if (H.cur === 'hammer' && H.tools.hammer.g.visible) H.hide();
      return e >= T0.at(-1);
    });
    H.hide(); setN(N); WV.reveal = null; WV.dirty = true;
    billSoon('FORMWORK', 1.9);   // (what the formwork cost — shown over the bars' close work, where the hook is)
    say('props ' + SF.tubeLo.count + ' beams ' + SF.beams.count + (nailed ? '' : ' no nailing FAILED'));
  });

  // ==== 2 · the bars: the bottom mat on chairs, the frogs between, the top mat — bar after bar, the hook at the newest ====
  phase('rebar', function* () {
    const b = sailRec(); if (!b) return;
    app.rebarTool?.setMode?.('cage'); app.setTool('rebar'); d.menu([], 'rebar');
    let cage = null; const rec = slabCage(b); rec.tied = true;
    // (the upstand's U-bars left in the slab's cage before its concrete — the realist: an upstand is tied to its slab)
    { const U0 = findUpstand(app, b, { cast: false, skip: BOXSKIP(), spoutNear: [MM(DRAIN[0]), MM(DRAIN[1])], spoutY: 190 }); if (U0.rec) { for (const q of U0.rec.starters) rec.bars.push(q.slice()); say('starters ' + U0.rec.starters.length); } }
    app.journal.act('slab-cage', {}, app.clock, () => { cage = O.add(rec).id; });
    const NB = rec.bars.length; let nb = 0;
    const setB = (x) => { nb = Math.max(0, Math.min(NB, x)); RV.reveal = { id: cage, u: Math.min(1, 0.12 + 0.68 * nb / NB), lower: true }; RV.dirty = true; };
    setB(0.05);
    const b0 = rec.bars[0], first = new V((b0[0] + b0[3]) / 2, (b0[1] + b0[4]) / 2, (b0[2] + b0[5]) / 2);
    const tipAt = () => { const tp = RV.revealTip; return tp ? new V().fromArray(tp.at) : null; };
    let lastP = first; tool = () => (H.cur === 'hook' && H.tools.hook.g.visible ? H.tools.hook.g.getWorldPosition(new V()) : (lastP = tipAt() || lastP));
    act([[1.7, [1500, 900, -1800], 1], [1.4, [-2200, 1000, 1600], 3], [1.5, [2800, 1500, -2600], 6]]);
    // ×1: the first bar let down onto its chairs (0,9 s), the hook twisting the wire at a crossing on it; ×3: bar after bar; ×6: the rest
    const t0 = d.t; let k = 0, hk = null;
    yield d.until(() => {
      const e = d.t - t0, was = Math.floor(nb);
      setB(e < 0.9 ? 0.05 + 0.95 * e / 0.9 : e < 1.7 ? 1 : e < 3.1 ? 1 + 5 * (e - 1.7) / 1.4 : 6 + (NB - 6) * Math.min(1, (e - 3.1) / 1.5));
      if (Math.floor(nb) > was) app.sfx?.play?.(k++ % 3 ? 'rebar' : 'wire', { vol: 0.45, gap: 0.07 });
      if (e >= 0.9 && e < 1.7) { if (!hk) { const tp = RV.revealTip; hk = tp ? { a: new V().fromArray(tp.a), c: new V().fromArray(tp.b) } : { a: first, c: first }; }
        const u = e - 0.9, p = hk.a.clone().lerp(hk.c, 0.46 + 0.04 * Math.floor(u / 0.4) + 0.01 * Math.min(1, (u % 0.4) / 0.15)).add(new V(0, MM(8 + 6 * Math.sin(u * 9)), 0)); H.set('hook', p, HU, null, u * 40); if (Math.floor(u / 0.4) !== Math.floor((u - d.dt) / 0.4)) app.sfx?.play?.('wire', { vol: 0.5 }); }
      else if (H.cur === 'hook' && H.tools.hook.g.visible) H.hide();
      return e >= 4.6;
    });
    H.hide(); setB(NB); RV.reveal = null; RV.dirty = true;
    billSoon('REBAR', 0.6);
    say('cage bars ' + NB);
  });

  phase('pour', function* () {
    const b = sailRec(); if (!b) return;
    yield* hosePour(b.id, snake(SL.x0 - LEFT + 300, SL.x1 - 300, SL.z0 - FRONT + 300, SL.z1 - 300, 600),   // (rows 600 apart: the splat ~500 wide with what runs out of it)
      [[1.4, [1500, 700, -1700], 1], [1.5, [-2400, 1100, -2000], 3], [1.5, [3200, 1900, -3400], 6]]);
    // the rule over it along the cantilever (the bar levelling the concrete): close ×1, then ×3
    { const y = b.top + b.H + MM(15), z0 = SL.z0 - FRONT + 650, xs = [SL.x0 - LEFT + 900, SL.x1 - 900]; let u = 0;   // (≥ 250 from the edge's row of starters even at its swing — the realist)
      G.set('screed', new V(MM(xs[0]), y, MM(z0)), Math.PI / 2, true);
      tool = () => G.pos.clone();
      act([[1.2, [-900, 700, -1300], 1], [1.2, [1400, 900, -1700], 3]]);
      const t1 = d.t; yield d.until(() => { u += d.dt * d.speed * 0.9 / ((xs[1] - xs[0]) / 1000); G.set('screed', new V(MM(xs[0] + (xs[1] - xs[0]) * Math.min(1, u)), y, MM(z0 + 150 * Math.sin(u * 40))), Math.PI / 2); app.sfx?.play?.('screed', { vol: 0.4, gap: 0.35 }); return u >= 1 || d.t - t1 > 1.3; });
      G.set(null); }
    // (the film once the water's sheen is off it — the realist: 1–3 hours in the heat; laid at once its creases print in the concrete)
    tool = () => P(CORNER[0] + 1500, 3700, CORNER[1] + 1500);
    yield* d.lapse(2 / 24, 0.6, () => { app.clock += 300 * d.dt / 0.6; });
    // the curing film rolled over it: the first strip close at its pace, then faster and faster (the owner's rule for rolls)
    billSoon('CONCRETE', 0.3, true);   // (the sail's concrete — the pour finished at the rule's cut — over the film rolling out)
    yield* cureRoll(b);
  });
  // (the polyethylene over the fresh concrete — the same film as the roof's vapour barrier, strips 1,5 m lapped 100, rolled out
  // along the slab: the game's own roll, drawn by the roof as a «cure» layer; taken off at a week)
  const cureRoll = function* (b) {
    const area = roofArea(b, O.all('unit')), [i0, j0, i1, j1] = area.bbox, c = b.c, rects = [], Wd = MM(1500), lap = MM(100);
    for (let t = j0 * c; t < j1 * c - MM(50); t += Wd - lap) rects.push([i0 * c, t, i1 * c, Math.min(j1 * c, t + Wd)]);
    let rr = O.all('roof').find((r) => r.slab === b.id);
    if (!rr) app.journal.act('roof-cure', {}, app.clock, () => { rr = O.add({ type: 'roof', slab: b.id, vap: [], xps: [], wedge: [], memS: [], copS: [], grav: [], cure: [] }); });
    const done = [], t00 = d.t; let k = 0, s = i0 * c;
    tool = () => { const rc = rects[k]; if (!rc) return null; const [x, z] = toWorld(b, s, (rc[1] + rc[3]) / 2); return new V(x, b.top + b.H + MM(60), z); };
    act([[1.1, [-1300, 650, -1100], 1], [1.3, [1600, 1000, -2200], 3]]);
    yield d.until(() => {
      const e = d.t - t00, v = e < 1.0 ? 1 : Math.min(120, Math.exp(5 * (e - 1.0)));   // (m/s of the roll: a walk, then faster)
      s += MM(1000) * v * d.dt * d.speed * 1.2;
      const rc = rects[k]; if (!rc) return true;
      if (s >= rc[2]) { done.push(rc); k++; s = i0 * c; O.update(rr.id, { cure: done.slice() }); app.sfx?.play?.('fabric', { vol: 0.4 }); WV.liveRoof = null; return k >= rects.length; }
      WV.liveRoof = { slab: b.id, layer: 'cure', rect: [rc[0], rc[1], s, rc[3]], roll: { along: true, end: s, w: 1500 } }; WV.roofDirty = true;
      return false;
    });
    WV.liveRoof = null; WV.roofDirty = true; still();
    say('cure strips ' + rects.length);
  };

  // ==== 4 · a week: the clock over the sail on its forest of props; the film off, the edge boards off (the props stay) ====
  phase('week', function* () {
    const b = sailRec(); if (!b) return;
    d.hud(null);
    tool = () => P(CORNER[0] + 900, 3500, CORNER[1] + 300);   // (the work: the sail on its props)
    shots([[9, [-9500, 1300, -9500], [-3500, 3200, -3600]]]);   // (low from the pool's edge: the forest of props and the film over it)
    // (meanwhile: the film taken off, the edge boards off into their stack on the beach (the props stay — the foreman))
    const rr = O.all('roof').find((r) => r.slab === b.id); let off = 0;
    yield* d.lapse(7, 1.4, (u) => { app.clock += 9000 * d.dt / 1.4; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 });
      if (off < 1 && u > 0.35) { off = 1; if (rr) O.update(rr.id, { cure: [] }); }
      if (off < 2 && u > 0.6) { off = 2; app.journal.act('slab-sides', {}, app.clock, () => O.update(b.id, { sidesOff: true, sidesPile: [MM(-9800), MM(7600)] })); app.sfx?.seq?.(['crowbar', 'plank', 'plank']); } });
    app.sky.setHour(9.5);
    d.kick('+7 DAYS', 1.0, 'top'); dim(1.0); billT = d.t;
    yield d.sec(1.05);
  });

  // ==== 5 · the upstand on the terrace's free edges: its boards (×3), its cage, the hose along it (×6) ====
  phase('upstand', function* () {
    const b = sailRec(); if (!b) return;
    const U = findUpstand(app, b, { skip: BOXSKIP(), spoutNear: [MM(DRAIN[0]), MM(DRAIN[1])], spoutY: 190 });   // (the membrane by the drain: 1 + 150 + 20 + 0,02·700 + 2 ≈ 190 over the slab)
    if (U.rec) U.rec.startersInSlab = true;
    say('upstand ' + (U.rec ? `${U.n} cells, ${U.rec.segs.length} runs` : U.why + ' FAILED'));
    if (!U.rec) return;
    st.wallKind = 'upstand'; app.setTool('wall'); d.menu(['mono'], 'wall');
    let up = null; app.journal.act('upstand-form', {}, app.clock, () => { up = O.add(U.rec).id; });
    WV.reveal = { id: up, u: 0 }; WV.dirty = true;
    const tipAt = () => { const f = WV.revealTip?.(O.get(up), WV.reveal?.u ?? 1); return f ? new V(f.x + f.ox, f.y, f.z + f.oz) : null; };
    // (the boards go up all round its 60 m fast: the work point stays at the corner the camera is on — the boards running past it)
    const upC = P(CORNER[0] + 800, 3900, CORNER[1] + 400); tool = () => upC.clone(); void tipAt;
    act([[1.0, [1300, 1100, -1200], 3], [1.0, [-2600, 1700, -2400], 6]]);
    { const t0 = d.t; let k = 0; yield d.until(() => { const u = Math.min(1, (d.t - t0) / 1.6); WV.reveal = { id: up, u }; WV.dirty = true; if (u * 10 > k) { k++; app.sfx?.play?.(k % 2 ? 'plank' : 'hammer_nail', { vol: 0.45 }); } return u >= 1; }); }
    WV.reveal = null; WV.dirty = true;
    { let cg = null; app.journal.act('belt-cage', {}, app.clock, () => { cg = O.add(beltCage(O.get(up))).id; });
      // (its bars laid inside the starters along the edge, one after another — never all at once: the realist)
      let lastC = null; tool = () => { const tp = RV.revealTip; if (tp) lastC = new V().fromArray(tp.at); return lastC || P(CORNER[0], 3800, CORNER[1]); };
      const t0 = d.t; let k = 0; yield d.until(() => { const u = Math.min(1, (d.t - t0) / 0.9); RV.reveal = { id: cg, u: 0.12 + 0.88 * u, lower: true }; RV.dirty = true; if (u * 8 > k) { k++; app.sfx?.play?.(k % 2 ? 'rebar' : 'wire', { vol: 0.4 }); } return u >= 1; });
      RV.reveal = null; RV.dirty = true; }
    // the hose along it: round the free edge from the cantilever's corner
    const ub = O.get(up), cells = plan(ub).cells, pts = [];
    { const ring = cells.map(([i, j]) => toWorld(ub, (i + 0.5) * ub.c, (j + 0.5) * ub.c)), cx = ring.reduce((a, q) => a + q[0], 0) / ring.length, cz = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      ring.sort((p, q) => Math.atan2(p[1] - cz, p[0] - cx) - Math.atan2(q[1] - cz, q[0] - cx));
      for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 60))) pts.push([ring[i][0] / S, ring[i][1] / S]); }
    // (the hose along the stretch by the corner — seen ×3, ×6; the rest of the ring the crew pours while the camera goes on: it is full
    // in the next shot, never filling up by itself in one)
    { const k0 = pts.reduce((bi, p, i) => (Math.hypot(p[0] - CORNER[0], p[1] - CORNER[1]) < Math.hypot(pts[bi][0] - CORNER[0], pts[bi][1] - CORNER[1]) ? i : bi), 0), near = [];
      for (let i = 0; i < 9; i++) near.push(pts[(k0 + i) % pts.length]);
      const hose = app.concreteTools.hose, ub2 = O.get(up), yb = ub2.top + ub2.H, sg = near.slice(1).map((p, i) => Math.hypot(p[0] - near[i][0], p[1] - near[i][1])), tl = sg.reduce((a, v) => a + v, 0);
      const path = (u) => { let s2 = Math.max(0, Math.min(1, u)) * tl, i = 0; while (i < sg.length - 1 && s2 > sg[i]) { s2 -= sg[i]; i++; } const A = near[i], Bq = near[i + 1], f = Math.min(1, s2 / sg[i]); return new V(MM(A[0] + (Bq[0] - A[0]) * f), yb, MM(A[1] + (Bq[1] - A[1]) * f)); };
      const ev = (q) => ({ target: up, hit: q });
      app.setTool('hose'); d.menu([], 'hose', 'Быстро'); st.pump = 0.2;
      { const p0 = path(0); hose.down(p0, ev(p0)); let w = 0; d.speed = 4; yield d.until(() => { w += d.dt * d.speed; hose.move(p0, ev(p0)); const sp = G.pump?.ready ? G.pump.spout() : null; return w > 6 || (!!sp && Math.hypot(sp.x - p0.x, sp.z - p0.z) < MM(500)); }); d.speed = 1; }
      tool = () => (G.pump?.ready ? G.pump.spout().clone().add(new V(0, -MM(400), 0)) : null);
      act([[0.9, [1200, 900, -1200], 3], [0.9, [-2400, 1600, -2200], 6]]);
      let u = 0; const t0 = d.t; yield d.until(() => { u += d.dt * d.speed * 0.25 / (tl / 1000); const q = path(u); hose.move(q, ev(q)); return u >= 1 || d.t - t0 > 1.6; });
      hose.up(); hose.finish?.(); G.set?.(null);
      // (the poker after it in the narrow gap — the realist: layers, a vibrator Ø35; the bubbles up)
      let w2 = 0; const tv = d.t; tool = () => G.pos?.clone?.() || path(0);
      yield d.until(() => { w2 += d.dt * d.speed; const q = path(Math.max(0, 0.55 - w2 * 0.25)); G.set('vibro', new V(q.x, q.y - MM(60), q.z), 0); app.sfx?.loop?.('vib-up', 'vibrator', 0.5, 1, q, true); return d.t - tv > 0.8; });
      G.set(null); still(); }
    later.push(() => full(up));
  });

  // ==== 6 · the damp-proof course under the box: the torch and the roll on the sail's top over the pavilion's walls ====
  phase('dpc', function* () {
    const b = sailRec(); if (!b) return;
    st.dpcW = 400; st.wallKind = 'dpc'; app.setTool('wall'); W.setMode('lay'); d.menu(['masonry'], 'wall');
    const dpc = W.dpc, y = b.top + b.H, lay = (a, c) => { dpc.down({ x: MM(a[0]), y, z: MM(a[1]) }); dpc.move({ x: MM(c[0]), y, z: MM(c[1]) }); dpc.up(); };
    const lines = [[[2500 + 50, SL.z0 + 150], [SL.x1 - 50, SL.z0 + 150]], [[IN - 150, SL.z0 + 150], [0, SL.z0 + 150]], [[SL.x1 - 150, SL.z0 + 150], [SL.x1 - 150, SL.z1 - 150]], [[IN - 150, SL.z1 - 150], [SL.x1 - 50, SL.z1 - 150]], [[IN, SL.z0 + 150], [IN, SL.z1 - 150]]];
    lay(...lines[2]);
    tool = () => { const Tt = app.dpcView?.work?.T; return Tt && Tt.visible !== false ? Tt.position.clone() : null; };
    act([[1.4, [700, 650, -900], 1], [1.4, [-1100, 900, 1300], 3]]);
    const t0 = d.t; yield d.until(() => { const v = d.t - t0 < 1.0 ? 1 : Math.min(300, Math.exp(2.4 * (d.t - t0 - 1.0))); for (const J of dpc.jobs) J.speed = v; return d.t - t0 > 2.0 || !dpc.jobs.length; });
    for (const l of [lines[0], lines[1], lines[3], lines[4]]) lay(...l);
    for (const J of dpc.jobs) J.speed = 450;
    yield d.until(() => !dpc.jobs.length);
    app.budget._pay?.([{ usd: 0.4 * 40 * 9 }], P(0, 0, 0));
    still();
  });

  // ==== 7 · the box: aerated block 300 on the pavilion's walls — the first block close, its course, then the courses ====
  phase('box', function* () {
    const b = sailRec(); if (!b) return;
    billSoon('UPSTAND', 0.5);   // (the upstand and the damp-proof course under the box — over its first block going on)
    const sTop = b.top + b.H, box = boxWalls(sTop + MM(3));
    st.wallKind = 'block'; app.setTool('wall'); W.setMode('lay'); d.menu(['masonry'], 'wall');
    const job = (rec, fast) => { if (app.physJob) return false; if (W.layUnit(rec, fast, 20)) { tool = () => new V().fromArray(rec.p); return true; } return false; };
    const c0 = box.filter((r) => Math.abs(r.p[1] - box[0].p[1]) < MM(5)), b0 = c0.filter((r) => Math.abs(r.p[2] - MM(SL.z0 + 150)) < MM(5)).sort((p, q) => q.p[0] - p.p[0]);
    tool = () => new V().fromArray(b0[0].p);
    act([[1.6, [-1300, 700, -1300], 1], [1.6, [900, 1000, -2600], 3]]);
    yield d.until(() => job(b0[0], false)); yield d.until(idle);
    for (const r of b0.slice(1, 5)) { yield d.until(() => job(r, true)); }
    yield d.until(idle);
    still();
    { const done = new Set(b0.slice(0, 5)), rest = box.filter((r) => !done.has(r));
      shots([[9, [-9000, 2000, -16000], [500, 4800, 500]]]);   // (from the beach, an eye at 2 m: the courses going up on the sail)
      let i = 0; const n = rest.length, dur = 2.3, t0 = d.t;
      yield d.until(() => { const want = Math.min(n, Math.ceil(n * Math.min(1, (d.t - t0) / dur) ** 1.4)); if (want > i) { for (; i < want; i++) O.add(rest[i]); app.sfx?.play?.('block', { vol: 0.4, gap: 0.08 }); } return i >= n; }); }
    app.budget._pay?.([{ usd: box.length * 3.1 }], P(0, 0, 0));
    say('box blocks ' + box.length);
    billSoon('BLOCKS', 0.5);
  });

  // ==== 8 · the box's roof slab 200 on its walls: its props on the sail (over the sail's own), the sheets, the mats, the hose ====
  phase('roofslab', function* () {
    const units = O.all('unit').filter((u) => u.kind === 'block'), bTop = Math.max(...units.map((u) => u.p[1] + u.s[1] / 2));
    const R = findSlab(app, new V(MM(1500), bTop - MM(10), MM(SL.z1 - 150)), null, null, 0, {});
    say('roof slab ' + (R ? `${R.area.toFixed(1)} m²` : 'none FAILED'));
    if (!R) return;
    st.wallKind = 'slab'; st.slabCant = 0; app.setTool('wall'); d.menu(['mono', 'slab'], 'wall');
    let roof = null; app.journal.act('slab-form', {}, app.clock, () => { roof = O.add(R.rec).id; });
    // (seen from the beach, low, through the glass wall's gap: the props in the box over the sail's props under it)
    tool = () => P(800, 4200, 0);   // (the props going up in the box, over the sail's)
    shots([[9, [-2500, 1700, -15000], [800, 4200, 0]]]);
    { const t0 = d.t; let k = 0; yield d.until(() => { const u = Math.min(1, (d.t - t0) / 1.4); WV.reveal = { id: roof, u, slab: true }; WV.dirty = true; if (u * 8 > k) { k++; app.sfx?.play?.(k % 2 ? 'metal_hit' : 'plank', { vol: 0.4 }); } return u >= 1; }); }
    WV.reveal = null; WV.dirty = true;
    let rc = null; app.journal.act('slab-cage', {}, app.clock, () => { const c = slabCage(O.get(roof)); c.tied = true; rc = O.add(c).id; });
    app.sfx?.seq?.(['rebar', 'rebar', 'wire']);
    yield* hosePour(roof, snake(IN - 150 + 300, SL.x1 - 300, SL.z0 + 300, SL.z1 - 300, 600), [[1.6, [1500, 800, -1500], 6]]);
    // the rule over the box's roof (the pour finished at its cut) — its bill over it: the work going on under it
    { const RB = O.get(roof), y = RB.top + RB.H + MM(15), xs = [IN + 300, SL.x1 - 500], zr = SL.z0 + 900; let u = 0;
      G.set('screed', new V(MM(xs[0]), y, MM(zr)), Math.PI / 2, true); tool = () => G.pos.clone();
      act([[1.3, [-2600, 2300, -3200], 3]]);   // (over the roof from the front, outside the box: not against its wall)
      billSoon('ROOF SLAB', 0.15, true);
      const t1 = d.t; yield d.until(() => { u += d.dt * d.speed * 0.9 / ((xs[1] - xs[0]) / 1000); G.set('screed', new V(MM(xs[0] + (xs[1] - xs[0]) * Math.min(1, u)), y, MM(zr + 120 * Math.sin(u * 40))), Math.PI / 2); app.sfx?.play?.('screed', { vol: 0.4, gap: 0.35 }); return u >= 1 || d.t - t1 > 2.1; });
      G.set(null); still(); }
  });

  // ==== 9 · 28 days: the clock; meanwhile the box's roof props out through its glass wall's gap ====
  phase('month', function* () {
    const roof = roofRec(); d.hud(null);
    // (the work: the box's roof formwork going out piece by piece — the piece being carried; else the shot's own aim)
    const aimM = P(-1500, 3600, -1500); tool = () => { const t = WV.slabForm.stripTip; return t ? new V().fromArray(t) : aimM.clone(); };
    // (a slow dolly in over the clock — the 28 days going by, the box's formwork going out: never a still frame under the bill)
    still(); d.fly([[PE(-10500, 1700, -15500), P(-1500, 3600, -1500)], [PE(-8600, 1600, -12600), P(-1500, 3600, -1500)]], 3.2, { hand: 0.15 }); cutT = d.t; flush();
    // (meanwhile — the realist: the box's roof formwork out piece by piece through the glass wall's gap to a stack outside (its props
    // over the sail's, so first); the upstand's boards off into their stack — none left in the concrete's way)
    let off = 0; const ups = O.all('belt').find((q) => q.kind === 'upstand');
    yield* d.lapse(28, 1.6, (u) => { app.clock += 9000 * d.dt / 1.6; app.sfx?.play?.('tap', { vol: 0.25, gap: 0.11 });
      if (off < 1 && u > 0.1 && roof) { off = 1; app.journal.act('belt-strip', {}, app.clock, () => O.update(roof.id, { stripAt: +app.clock.toFixed(3) })); }
      if (off < 2 && u > 0.3 && ups) { off = 2; app.journal.act('belt-strip', {}, app.clock, () => O.update(ups.id, { stripped: true, pile: [MM(-8500), MM(7600)] })); WV.dirty = true; }
      if (roof && O.get(roof.id)?.stripAt != null && !O.get(roof.id).stripped) app.clock += 60 * d.dt; });
    app.sky.setHour(10);
    yield d.until(() => d.t >= billT + 1.95);   // (the bill's card gone before the big word: one text at a time)
    d.kick('+28 DAYS', 1.0, 'top'); dim(1.0); billT = d.t;
    yield d.sec(1.05);   // (its plate gone before the «wow»'s first cut — the analyst)
  });

  // ==== 10 · the «wow»: the sail's props out from the cantilever's edge back to the walls — it hangs over the water ====
  phase('strip', function* () {
    const b = sailRec(); if (!b) return;
    st.wallKind = 'slab'; app.setTool('wall'); d.menu(['mono', 'slab'], 'wall');
    app.journal.act('belt-strip', {}, app.clock, () => O.update(b.id, { stripAt: +app.clock.toFixed(3) }));
    let lastS = P(CORNER[0] + 600, 2400, CORNER[1] + 600); tool = () => { const t = WV.slabForm.stripTip; if (t) lastS = new V().fromArray(t); return lastS; };
    // (the first pieces at their pace, close from the pool's floor; then faster from further; the last prop close; then nothing)
    d.mark('wow');
    // (the first pieces at their pace, close from the pool's floor; then faster from further — the camera on the edge being stripped;
    // the far shot the rest at once (many hands, the crew's clock run on) — stopped two props before the end: the last one close, ×1)
    shots([[1.8, [-9300, 900, -8300], [-6600, 2600, -5300]], [2.0, [-11500, 1500, -10500], [-4500, 2800, -3500]], [9, [-14500, 1800, -15000], [-1500, 3200, -1500]]]);
    const t0 = d.t, SF = WV.slabForm, left = () => (SF.propsLeft?.[b.id] ? SF.propsLeft[b.id].length : 99);
    yield d.until(() => { const e = d.t - t0; d.speed = e < 1.8 ? 1 : e < 3.8 ? 3 : 6; if (e > 3.8 && left() > 3) app.clock += d.dt * 6 * 4; return left() <= 1 || !!O.get(b.id)?.stripped || e > 30; });
    d.speed = 1; say('props left ' + left() + ' at ' + d.t.toFixed(1));
    // the last prop: close, low from the pool's floor — wound down, tipped, carried off (×1)
    { const lp = SF.propsLeft?.[b.id]?.[0]; if (lp) { const foot = new V().fromArray(lp), aim = foot.clone().add(new V(0, MM(1500), 0)), eye = lift(foot.clone().add(new V(MM(-2300), MM(1000), MM(-2100))));
        still(); tool = () => { const t = SF.stripTip; return t ? new V().fromArray(t) : aim.clone(); };
        d.cut(look(eye, aim), { drift: 0.002, push: 0.004, hand: 0.15 }); cutT = d.t; } }
    yield d.until(() => !!O.get(b.id)?.stripped || d.t - t0 > 40);
    d.mark('wowEnd');
    say('stripped ' + !!O.get(b.id)?.stripped + ' at ' + d.t.toFixed(1) + ' max prop ' + Math.round(maxProp / S));
  });

  // ==== 11 · the box's green roof: its layers rolled, then the sedum mats in strips (from the sail's edge, close over it) ====
  phase('green', function* () {
    const roof = roofRec(); if (!roof) return;
    st.wallKind = 'roof'; app.setTool('wall'); d.menu(['roofs', 'roof'], 'wall', '7 · Зелёная кровля');
    const RB = roof, area = roofArea(RB, O.all('unit')), [i0, j0, i1, j1] = area.bbox, c = RB.c, all = [[i0 * c, j0 * c, i1 * c, j1 * c]];
    let rr = O.all('roof').find((r) => r.slab === RB.id);
    app.journal.act('roof-layers', {}, app.clock, () => { const p = { vap: all, xps: all, wedge: all }; if (rr) O.update(rr.id, p); else rr = O.add({ type: 'roof', slab: RB.id, mem: 'graphite', cop: 'ral9003', memS: [], copS: [], grav: [], ...p }); });
    // (the owner, 2026-11-18, «б»: the finish in ~15 s — the box's membrane laid off the camera, the sedum seen)
    const strips = []; for (let t = j0 * c; t < j1 * c - MM(50); t += MM(2050 - 80)) strips.push([i0 * c, t, i1 * c, Math.min(j1 * c, t + MM(2050))]);
    later.push(() => O.update(rr.id, { memS: strips.slice() }));
    let k = strips.length, s = i0 * c; const t0 = d.t, done = [];
    yield d.until(() => {
      const e = d.t - t0, v = e < 1.0 ? 1 : Math.min(40, Math.exp(2.5 * (e - 1.0)));
      s += MM(1000) * v * d.dt * d.speed * 1.2;
      const q = strips[k]; if (!q) return true;
      if (s >= q[2]) { done.push(q); k++; s = i0 * c; O.update(rr.id, { memS: done.slice() }); app.sfx?.play?.('fabric', { vol: 0.4 }); WV.liveRoof = null; return k >= strips.length; }
      WV.liveRoof = { slab: RB.id, layer: 'mem', rect: [q[0], q[1], s, q[3]], roll: { along: true, end: s, w: 2050 } }; WV.roofDirty = true; return false;
    });
    // the sedum mats: a strip close, then strip after strip faster (500 off the edge and the drain: gravel)
    const free = Math.round(MM(ROOF.greenFree) / c), ni = RB.ni;
    const isFree = (i, j) => { for (let dj = -free; dj <= free; dj++) for (let di = -free; di <= free; di++) if (!area.on(i + di, j + dj)) return true; return false; };
    const green = [], grav = []; let row = j0; const t1 = d.t;
    tool = () => { const [x, z] = toWorld(RB, (i0 + i1) / 2 * c, (row + 0.5) * c); return new V(x, RB.top + RB.H + MM(300), z); };
    act([[1.1, [1200, 1200, -1300], 1], [1.5, [2600, 2400, -2600], 6]]);
    yield d.until(() => {
      const e = d.t - t1, want = Math.min(j1, j0 + Math.floor(e < 1.1 ? e * 3 : 3 + (e - 1.1) * 70));
      for (; row < want; row++) { for (let i = i0; i < i1; i++) if (area.on(i, row)) (isFree(i, row) ? grav : green).push(row * ni + i); app.sfx?.play?.('turf', { vol: 0.35, gap: 0.12 }); }
      O.update(rr.id, { green: green.slice(), grav: grav.slice() });
      return row >= j1;
    });
    still();
    say('green cells ' + green.length);
  });

  // ==== 12 · the terrace on the sail: its layers, the membrane turned up the upstand; the stone deck on pedestals; the glass ====
  phase('terrace', function* () {
    const b = sailRec(); if (!b) return;
    st.wallKind = 'roof'; app.setTool('wall'); d.menu(['roofs', 'roof'], 'wall', '4 · Мембрана');
    const area = roofArea(b, O.all('unit')), [i0, j0, i1, j1] = area.bbox, c = b.c, all = [[i0 * c, j0 * c, i1 * c, j1 * c]];
    say(`terrace cells ${area.n} upstand ${area.terrace}`);
    billSoon('SEDUM', 0.6);
    let rr = O.all('roof').find((r) => r.slab === b.id);
    // (the drain: in the corner of the left cantilever by the olive — the falls to it)
    const dr = toFrame(b, MM(DRAIN[0]), MM(DRAIN[1]));
    app.journal.act('roof-layers', {}, app.clock, () => { const p = { vap: all, xps: all, wedge: all, memS: [], mem: 'graphite', cop: 'ral9003', cure: [], drain: dr }; if (rr) O.update(rr.id, p); else rr = O.add({ type: 'roof', slab: b.id, copS: [], grav: [], ...p }); });
    const strips = []; for (let s = i0 * c; s < i1 * c - MM(50); s += MM(2050 - 80)) strips.push([s, j0 * c, Math.min(i1 * c, s + MM(2050)), j1 * c]);
    let k = 0, t = j0 * c; const t0 = d.t, done = [];
    tool = () => { const q = strips[k]; if (!q) return null; const [x, z] = toWorld(b, (q[0] + q[2]) / 2, t); return new V(x, b.top + b.H + MM(300), z); };
    act([[0.9, [-1300, 900, -1400], 1]]);
    { const t3 = d.t; d.each(() => { if (d.t - t3 < 0.9) return false; shots([[9, [-11000, 7000, -13500], [-3500, 3900, -1500]]]); return true; }); }   // (the strips running on fast: the whole terrace in the frame, from the sea's side)
    yield d.until(() => {
      const e = d.t - t0, v = e < 0.9 ? 1 : Math.min(120, Math.exp(4.5 * (e - 0.9)));
      t += MM(1000) * v * d.dt * d.speed * 1.2;
      const q = strips[k]; if (!q) return true;
      if (t >= q[3]) { done.push(q); k++; t = j0 * c; O.update(rr.id, { memS: done.slice() }); app.sfx?.play?.('fabric', { vol: 0.4 }); WV.liveRoof = null; return k >= strips.length; }
      WV.liveRoof = { slab: b.id, layer: 'mem', rect: [q[0], q[1], q[2], t], roll: { along: false, end: t, w: 2050 } }; WV.roofDirty = true; return false;
    });
    WV.liveRoof = null; WV.roofDirty = true;
    // the deck: the first tile let down onto its pedestals close (×1), a row (×3), all (×6)
    const cells = []; for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (area.on(i, j)) cells.push(j * b.ni + i);
    const tile = (k2) => { const i = k2 % b.ni, j = (k2 / b.ni) | 0; return Math.floor((i + 0.5) * c / MM(600)) + ':' + Math.floor((j + 0.5) * c / MM(600)); };
    const byTile = new Map(); for (const k2 of cells) { const key = tile(k2); (byTile.get(key) || byTile.set(key, []).get(key)).push(k2); }
    // (from the cantilever's corner over the pool back: the tiles in rows)
    const tiles = [...byTile.entries()].sort((p, q) => { const [a1, b1] = p[0].split(':').map(Number), [a2, b2] = q[0].split(':').map(Number); return b1 - b2 || a1 - a2; });
    const laid = []; let n = 0, paid = false; const t1 = d.t;
    const tileP = (q) => { const [ti, tj] = q[0].split(':').map(Number), [x, z] = toWorld(b, (ti + 0.5) * MM(600), (tj + 0.5) * MM(600)); return new V(x, b.top + b.H + MM(380), z); };
    // (close: the tile going down; then the rows going on fast — the work is the terrace, its middle)
    const midT = tiles.length ? tileP(tiles[tiles.length >> 1]) : null;
    tool = () => { const q = tiles[Math.min(n, tiles.length - 1)]; if (!q) return null; return d.t - t1 > 1.9 && midT ? midT.clone() : tileP(q); };
    act([[1.0, [-900, 600, -1100], 1], [0.9, [1500, 800, -1500], 3], [1.0, [-2600, 1700, -2600], 6]]);
    yield d.until(() => {
      const e = d.t - t1, want = Math.min(tiles.length, Math.floor(e < 1.0 ? e : e < 1.9 ? 1 + (e - 1.0) * 10 : 10 + (e - 1.9) * 320));
      const fr = e < 1.0 ? e : 1;
      if (e > 1.9 && !paid) { paid = true; app.budget._pay?.([{ usd: cells.length * (c / S / 1000) ** 2 * 95 }], P(0, 0, 0)); }
      for (; n < want; n++) { laid.push(...tiles[n][1]); app.sfx?.play?.('block', { vol: 0.35, gap: 0.09 }); }
      O.update(rr.id, { deck: laid.slice() });
      WV.liveRoof = n < tiles.length && e < 1.0 ? { slab: b.id, layer: 'deck', cells: tiles[n][1], lift: (1 - fr) * 250 } : null; WV.roofDirty = true;
      return n >= tiles.length;
    });
    WV.liveRoof = null; WV.roofDirty = true; still();
    // the glass railing on the upstand, run after run: the first close
    st.wallKind = 'rail'; app.setTool('wall'); d.menu(['win'], 'wall');
    const runs = slabRuns(b), rails = [];
    for (const r of runs) { const p = new V((r.a[0] + r.b[0]) / 2, r.y, (r.a[1] + r.b[1]) / 2), F = findRail(app, p); if (F && !F.why && F.rec.up) rails.push(F.rec); }
    rails.sort((p, q) => Math.hypot(p.a[0] - MM(CORNER[0]), p.a[1] - MM(CORNER[1])) - Math.hypot(q.a[0] - MM(CORNER[0]), q.a[1] - MM(CORNER[1])));
    say('rails ' + rails.length);
    // (the work point slides along the newest railing as its panels go in — the glaziers along it)
    let ri = 0, rt = d.t; tool = () => { const r = rails[Math.max(0, ri - 1)]; if (!r) return null; const f = Math.min(1, (d.t - rt) / 0.2); return new V(r.a[0] + (r.b[0] - r.a[0]) * f, r.y + r.up + MM(600), r.a[1] + (r.b[1] - r.a[1]) * f); };
    if (rails.length) { app.journal.act('rail', {}, app.clock, () => O.add(rails[ri++])); app.sfx?.play?.('glass', { vol: 0.6 }); }
    act([[0.9, [1500, 300, -2200], 1]]);
    billSoon('DECK', 0.3);
    { const t1 = d.t; d.each(() => { if (d.t - t1 < 0.9) return false; shots([[9, [-9500, 3400, -17000], [-2500, 4100, -1500]]]); return true; }); }   // (then from the beach: every edge of the sail, each railing going on seen)
    { const t2 = d.t; yield d.until(() => { const want = Math.min(rails.length, 1 + Math.floor((d.t - t2) / 0.2)); for (; ri < want; ri++) { O.add(rails[ri]); rt = d.t; app.sfx?.play?.('glass', { vol: 0.45, gap: 0.1 }); } return ri >= rails.length && d.t - t2 > 1.7; }); }
    still();
  });

  // ==== 13 · the glass walls: floor to ceiling in the pavilion's openings and the box's — the first close ====
  phase('glass', function* () {
    st.wallKind = 'window'; st.windowKey = 'floor'; st.winCol = 'anth'; app.setTool('wall'); d.menu(['win', 'wins'], 'wall');
    const ops = findOpenings(app).filter((q) => q.h > 2400 && q.h < 3400 && q.w <= 3300 && !q.why2).sort((p, q) => p.z - q.z || p.x - q.x);
    say('openings ' + ops.length);
    let wk = 0; tool = () => { const q = ops[Math.max(0, wk - 1)]; return q ? new V(q.x, q.y0 + MM(1300), q.z) : null; };
    const put = (q) => { O.add({ type: 'window', key: 'floor', col: 'anth', w: q.w, h: q.h, t: q.t, x: +q.x.toFixed(6), y: +q.y0.toFixed(6), z: +q.z.toFixed(6), yaw: +q.yaw.toFixed(5) }); app.sfx?.play?.('glass', { vol: 0.45, gap: 0.1 }); };
    if (ops.length) { put(ops[wk++]); }
    act([[1.0, [-1800, 300, -3600], 1]]);
    yield d.sec(1.0);
    shots([[9, [-1500, 2200, -17500], [-500, 3200, 0]]]);   // (from the beach: the whole front, each glass wall going in seen)
    { const t0 = d.t; yield d.until(() => { const want = Math.min(ops.length, 1 + Math.floor((d.t - t0) / 0.15)); for (; wk < want; wk++) put(ops[wk]); return wk >= ops.length && d.t - t0 > 0.9; }); }
    still();
  });

  // ==== 14 · the finish, face after face: the white plaster on the pavilion, the HPL on the box, the spine's sandstone ====
  phase('finish', function* () {
    const FT = W.facade, faces = FT.faces(), mm = (v) => Math.round(v / S);
    const allCells = (F) => { const e = ext(F, OFF.fin), set = new Set(); for (let j = Math.floor(e[1] / CELL); j * CELL < e[3]; j++) for (let i = Math.floor(e[0] / CELL); i * CELL < e[2]; i++) { const a = (i + 0.5) * CELL, y = (j + 0.5) * CELL; if (a > e[0] && a < e[2] && y > e[1] && y < e[3] && cutPiece(F, [a - 1e-7, y - 1e-7, a + 1e-7, y + 1e-7], OFF.fin).length) set.add(ck(i, j)); } return runsOf(set); };
    const slots = (F, layer) => { st.facLayer = layer; return FT._areaSlots(F, ext(F, 0)).slots; };
    const save = (F, patch) => FT._save(F, patch, 'facade-film');
    const top = (F) => mm(F.y0);
    const width = (F) => { const e = ext(F, 0); return mm(e[2] - e[0]); };
    const inner = (F) => F.key.split(':')[2] === '33';   // (the pavilion's inner wall's face to the left room)
    const pavF = faces.filter((F) => top(F) >= 1330 && top(F) < 1360 && width(F) > 300 && !inner(F) && Math.abs(F.ux) + Math.abs(F.uz) > 0.5 && !(Math.abs(F.uz) > 0.9 && mm(ext(F, 0)[0]) < -5000));
    const boxF = faces.filter((F) => top(F) > 4900 && top(F) < 5050 && width(F) > 1500 && mm(ext(F, 0)[0]) > -2400);
    const spineF = faces.filter((F) => !pavF.includes(F) && !boxF.includes(F) && (mm(ext(F, 0)[0]) <= -5700 || mm(ext(F, 0)[0]) >= 5400 || mm(ext(F, 0)[0]) === 6005));
    say(`faces pav ${pavF.length} box ${boxF.length} spine ${spineF.length} of ${faces.length}`);
    const plaster = (F, part = 1) => { const cells = allCells(F), sl = slots(F, 'eps'); save(F, { eps: sl.slice(0, Math.ceil(sl.length * part)) }); if (part >= 1) save(F, { glue: cells, mesh: [ext(F, OFF.loose)], emb: cells, pl: { 'bark:white': cells } }); };
    const vent = (F, key, part = 1) => {
      const cols = railCols(F), rows = bracketRows(F), br = [], rl = [], mb = [];
      for (const a of cols) for (const y of rows) {
        if (F.topAt && y > F.topAt(a) - MM(120)) continue;
        if (F.holes.some((q) => a > q[0] - MM(60) && a < q[2] + MM(60) && y > q[1] - MM(80) && y < q[3] + MM(80))) continue;
        if (!cutPiece(F, [a - MM(30), y - MM(60), a + MM(30), y + MM(60)], 0).length) continue;
        br.push([+a.toFixed(6), +y.toFixed(6)]);
      }
      const er = ext(F, OFF.rl);
      for (const a of cols) {
        let pieces = [[er[1] + MM(20), F.topAt ? Math.min(er[3] - MM(20), F.topAt(a) - MM(20)) : er[3] - MM(20)]];
        for (const q of F.holes) if (a > q[0] - MM(40) && a < q[2] + MM(40)) pieces = pieces.flatMap(([p, r]) => (q[3] <= p || q[1] >= r ? [[p, r]] : [[p, q[1] - MM(20)], [q[3] + MM(20), r]]));
        for (const [p, r] of pieces) if (r - p > MM(300) && br.filter(([ba, by]) => Math.abs(ba - a) < MM(5) && by >= p - MM(60) && by <= r + MM(60)).length >= 2) rl.push([a, +p.toFixed(6), +r.toFixed(6)]);
      }
      const em = ext(F, OFF.mb);
      for (let a = em[0]; a < em[2] - MM(10); a += MM(VENT_SUB.mbW - VENT_SUB.mbLap)) mb.push([+a.toFixed(6), +em[1].toFixed(6), +Math.min(em[2], a + MM(VENT_SUB.mbW)).toFixed(6), +em[3].toFixed(6)]);
      st.facVent = key;
      // (as on site, one layer after another over the face: the brackets, the wool, the membrane, the rails, the panels)
      const L = [() => save(F, { br }), () => save(F, { mw: slots(F, 'mw') }), () => save(F, { mb }), () => save(F, { rl }), () => save(F, { vp: slots(F, 'vp').map((q) => [...q, key]) })];
      const upto = Math.max(1, Math.ceil(part * L.length)); F._vn = F._vn || 0; for (; F._vn < upto; F._vn++) L[F._vn]();
    };
    // (one face close: its boards one by one, the trowel on the newest; then the faces after it)
    const byPart = function* (F, fn, dur, snd) { const t0 = d.t; let k = -1, kk = -1; yield d.until(() => { const u = Math.min(1, (d.t - t0) / dur), q = Math.floor(u * 30); if (q > k) { k = q; fn(F, Math.max(0.05, u)); if (Math.floor(u * 6) > kk) { kk = Math.floor(u * 6); app.sfx?.play?.(snd, { vol: 0.45 }); } } return u >= 1; }); fn(F, 1); };
    const faceBy = function* (list, fn, dur, snd) { const t0 = d.t, n = list.length; let i = 0, q0 = -1; if (!n) return; tool = () => mid(list[Math.min(n - 1, i)]);
      yield d.until(() => { const x = Math.min(n, n * (d.t - t0) / dur); while (i < Math.floor(x) && i < n) { fn(list[i], 1); i++; app.sfx?.play?.(snd, { vol: 0.45, gap: 0.12 }); } if (i < n) { const q = Math.floor((x - i) * 10); if (q !== q0) { q0 = q; fn(list[i], Math.max(0.1, x - i)); } } return i >= n; }); };
    const mid = (F) => { const a = (F.a0 + F.a1) / 2, y = (F.y0 + F.y1) / 2; return new V(F.ux * a + F.nx * F.P, y, F.uz * a + F.nz * F.P); };   // (a face's middle: along it a, out of it P)
    st.wallKind = 'facade'; app.setTool('wall'); d.menu(['facade', 'wet', 'pl'], 'wall');
    billSoon('GLASS', 1.2);
    if (pavF.length) { const F0 = pavF.slice().sort((a, b) => mid(a).z - mid(b).z)[0], pm = mid(F0), nx = F0.nx * F0.sg, nz = F0.nz * F0.sg; tool = () => pm.clone(); H.set('notch', pm.clone().add(new V(nx * MM(170), 0, nz * MM(170))), new V(nx, 0, nz), HU);
      act([[1.1, [nx * 2600 - F0.ux * 900, 200, nz * 2600 - F0.uz * 900], 1]]);
      yield* byPart(F0, plaster, 1.1, 'plaster'); H.hide();
      shots([[9, [-11500, 1800, -9000], [-1000, 2200, 0]]]);
      yield* faceBy(pavF.filter((F) => F !== F0), plaster, 0.9, 'plaster'); }
    st.facVent = 'hpl:walnut'; d.menu(['facade', 'vent', 'vp'], 'wall');
    shots([[9, [-9500, 2600, -14000], [1200, 5400, 1200]]]);
    billSoon('PLASTER', 0.4);
    yield* faceBy(boxF, (F, u) => vent(F, 'hpl:walnut', u), 1.1, 'nailgun');
    st.facVent = 'porc:sandstone'; d.menu(['facade', 'vent', 'vp'], 'wall');
    shots([[9, [15500, 2200, -6000], [6000, 3800, -1000]]]);   // (low along the spine, the steps in profile)
    yield* faceBy(spineF.sort((a, b) => a.y0 - b.y0), (F, u) => vent(F, 'porc:sandstone', u), 1.8, 'stone');
    still();
  });

  // ==== 15 · the white fascias round both slabs' edges, side after side (after the membranes and the facades: the foreman) ====
  phase('fascia', function* () {
    st.wallKind = 'fascia'; app.setTool('wall'); d.menu(['facade', 'fascia'], 'wall', 'Белый');
    billSoon('PANELS', 0.4);
    shots([[9, [-12000, 2400, -14500], [-500, 4400, -500]]]);
    const runs = [sailRec(), roofRec()].filter(Boolean).flatMap((b) => slabRuns(b));
    let fasc = 0, i = 0; const t0 = d.t, rp = (r) => new V((r.a[0] + r.b[0]) / 2, r.y, (r.a[1] + r.b[1]) / 2); tool = () => (runs[Math.max(0, i - 1)] ? rp(runs[Math.max(0, i - 1)]) : null);
    yield d.until(() => { const want = Math.min(runs.length, Math.ceil(runs.length * Math.min(1, (d.t - t0) / 1.0))); for (; i < want; i++) { const r = runs[i]; const F = findRail(app, new V((r.a[0] + r.b[0]) / 2, r.y, (r.a[1] + r.b[1]) / 2), 'ral9003'); if (F && !F.why) { O.add(F.rec); fasc++; app.sfx?.play?.('metal_hit', { vol: 0.35, gap: 0.1 }); } } return i >= runs.length && d.t - t0 > 1.3; });
    say('fascias ' + fasc);
  });

  // the loop's frame (the video starts and ends on it): low from the sea side, the sail and the box on it whole inside the frame's clear
  // band (under the logo and the budget, over «TO BE CONTINUED» and the Shorts zone), the ground under the frame's bottom on the plot
  // (past it the panorama's ground is smeared) — fitted by projecting the subject's box, not guessed (the stair's loop, stage 2)
  function fitLoop() {
    const Bx = d.subject(); if (!Bx) return [PE(-12500, 1300, -9000), P(-1500, 3900, -3600)];
    const corners = []; for (const x of [Bx.min.x, Bx.max.x]) for (const y of [Bx.min.y, Bx.max.y]) for (const z of [Bx.min.z, Bx.max.z]) corners.push(new V(x, y, z));
    const c = Bx.getCenter(new V()), cam = app.camera.clone(), band = { l: 0.03, r: 0.97, t: 0.13, b: 0.66 }, mid = (band.t + band.b) / 2;
    const PX = TRAY.innerX / 2 - MM(500), PZ = TRAY.innerZ / 2 - MM(500), U = (m) => m / MODEL_SCALE;
    const groundOn = () => { for (const nx of [-1, 0, 1]) { const dd = new V(nx, -1, 0.5).unproject(cam).sub(cam.position).normalize(); if (dd.y > -1e-4) continue; const G0 = T.heightAt(cam.position.x, cam.position.z); const h = cam.position.clone().addScaledVector(dd, (G0 - cam.position.y) / dd.y); if (Math.abs(h.x) > PX || Math.abs(h.z) > PZ) return false; } return true; };
    const inBand = () => corners.every((q) => { const v = q.clone().project(cam), sx = (v.x + 1) / 2, sy = (1 - v.y) / 2; return v.z < 1 && sx > band.l && sx < band.r && sy > band.t && sy < band.b; });
    const a0 = Math.atan2(-5840, -8230);   // (low from the pool's far edge, by the sea: the free corner of the cantilevers toward the camera, the sky behind (the plan's frame))
    for (let deg = 0; deg <= 80; deg += 5) for (const sg of deg ? [1, -1] : [1]) {
      const a = a0 + sg * THREE.MathUtils.degToRad(deg), dir = new V(Math.cos(a), 0, Math.sin(a));
      for (let m = 8; m <= 24; m += 0.5) for (let h = 1.0; h <= 5; h += 0.3) {
        const e = c.clone().addScaledVector(dir, U(m)); e.y = Math.max(g, T.heightAt(e.x, e.z)) + U(h);
        const aim = c.clone(); cam.position.copy(e);
        for (let k = 0; k < 4; k++) { cam.lookAt(aim); cam.updateMatrixWorld(); cam.updateProjectionMatrix(); let lo = 1, hi = 0; for (const q of corners) { const sy = (1 - q.clone().project(cam).y) / 2; lo = Math.min(lo, sy); hi = Math.max(hi, sy); } const off = (lo + hi) / 2 - mid, half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * aim.distanceTo(e); aim.y -= off * 2 * half; }
        cam.lookAt(aim); cam.updateMatrixWorld();
        if (!inBand() || !groundOn()) continue;
        say(`loop fit ${sg * deg}° ${m} m, eye ${h.toFixed(1)} m`); return [e, aim];
      }
    }
    say('loop fit FAILED');
    return [PE(-12500, 1300, -9000), P(-1500, 3900, -3600)];
  }
  // ---- play: from the start, or a debug start's stage on ----
  let on = !FROM;
  for (const [name, fn] of phases) { if (!on && name === FROM) on = true; if (!on || !PLAY.has(name)) continue; d.mark(name); yield* fn(); }

  // ==== the end: the loop's frame — low from the sea side: the sail hanging over the empty pool, nothing under its corner ====
  d.hud(null);
  d.mark('finale');
  // (the plan's frame, checked on a picture: low from the pool's far edge, the free corner on the sky — the analyst's loop; fitLoop's
  // whole-subject search can only find it from high up)
  const loopV = [PE(-12500, 1300, -9000), P(-1500, 3900, -3600)];
  shotN++; d.cut(look(...loopV), { drift: 0, push: 0, hand: 0 }); flush();
  yield d.sec(1.0);   // (it hangs: a second of nothing but the waves)
  // (the pin out first, then the sheet grows from its corner to its place — its drawing over the frame's band 21–77 %, made from this
  // very view: the lines fall on the real ones — then washes away into the real view: «the plan came true»)
  { const tp = d.t; pin.style.opacity = ''; app.sfx?.play?.('tap', { vol: 0.4 }); yield d.until(() => { const u = Math.min(1, (d.t - tp) / 0.2); pin.style.top = 23.23 - 2 * u + '%'; pin.style.opacity = String(1 - u); return u >= 1; }); pin.remove(); }
  { sk.src = 'assets/films/ibiza-3-sketch-flat.png';
    const r0 = { l: 72.8, t: 22.5, w: 26.8 }, r1 = { l: -6.41, t: 17.23, w: 112.82 }, t0 = d.t; sk.style.opacity = ''; app.sfx?.play?.('fabric', { vol: 0.5 });
    yield d.until(() => { const u = Math.min(1, (d.t - t0) / 0.5), e = u * u * (3 - 2 * u); sk.classList.add('grow'); sk.style.left = r0.l + (r1.l - r0.l) * e + '%'; sk.style.top = r0.t + (r1.t - r0.t) * e + '%'; sk.style.width = r0.w + (r1.w - r0.w) * e + '%'; return u >= 1; });
    yield d.sec(0.3);
    const t1 = d.t; yield d.until(() => { const u = Math.min(1, (d.t - t1) / 0.8); sk.style.opacity = String(1 - u); return u >= 1; });
    sk.remove(); }
  d.next(); d.nextEl?.classList.add('small');   // (~3 s before the seam, after the sheet is gone — never over it: the analyst)
  // (what the film cost — the bills added up, one sign: «−$X → ?» over the sky, then only the «?» under the free corner)
  const spent = Math.round(money0 - app.budget.money);   // (all the film's work — each of its costs in one of the bills: check-film sums them)
  d.spentShown = spent;
  const tot = document.createElement('div'); tot.className = 'f-steps'; tot.setAttribute('data-notr', ''); tot.textContent = `−$${spent.toLocaleString('en-US')} → ?`; tot.style.top = '20%'; d.el.appendChild(tot);
  app.sfx?.play?.('cash', { vol: 0.6 });
  yield d.sec(1.25);
  tot.remove();
  const q = document.createElement('div'); q.className = 'f-steps'; q.setAttribute('data-notr', ''); q.textContent = '?';
  const cornerP = () => { const b = sailRec(); return new V(MM(CORNER[0]), (b ? b.top : g + MM(3650)) - MM(600), MM(CORNER[1])); };
  // (under the cantilever's free corner, where a column «should» stand — below the subject on the screen: never over it)
  const at = (el) => { const v = cornerP().project(app.camera), Bx = d.subject(); let lo = 0; if (Bx) for (const x of [Bx.min.x, Bx.max.x]) for (const y of [Bx.min.y, Bx.max.y]) for (const z of [Bx.min.z, Bx.max.z]) lo = Math.max(lo, (1 - new V(x, y, z).project(app.camera).y) / 2);
    el.style.left = ((v.x + 1) / 2 * 100).toFixed(2) + '%'; el.style.top = (Math.max((1 - v.y) / 2, lo + 0.015) * 100).toFixed(2) + '%'; };
  at(q); d.el.appendChild(q);
  yield d.sec(1.35);
  d.sail = { sail: sailRec()?.id, roof: roofRec()?.id, props: WV.slabForm.tubeLo.count, units: O.all('unit').length, rails: O.all('rail').length, spent };
  // ---- the hook (put first by the recorder; the video ends at its mark — the loop): the rewind from this frame — layer by layer from
  // the top down, the props back for a blink, the sail gone — «◀◀», a whoosh, a dull stop: the bare pavilion of stage 2 ----
  d.mark('hook');
  { const topOf = (r) => (r.type === 'unit' ? r.p[1] + r.s[1] / 2 : r.type === 'dpc' ? (r.y ?? 0) + MM(5) : Array.isArray(r.bars) && r.bars.length ? Math.max(...r.bars.map((b) => Math.max(b[1], b[4]))) + MM(80) : r.type === 'roof' ? -1e9 : r.type === 'rail' ? r.y + MM(1200) : r.type === 'window' ? r.y + MM(3000) : r.type === 'facade' ? MM(9000) : r.top != null ? r.top + (r.H ?? 0) : r.y ?? r.p?.[1] ?? 0);
    const back = O.all().filter((r) => !startIds.has(r.id) && r.type !== 'siteprop' && r.type !== 'vehicle').sort((p, q2) => topOf(q2) - topOf(p));
    const gone = [], t0 = d.t; let rw = null, stopped = false, made = false, n = 0;
    yield d.until(() => {
      const u = Math.min(1, Math.max(0, (d.t - t0 - 0.03) / 1.2)), e = u;   // (no slow start: the count changes every ≤ 0,3 s — the analyst)
      if (!made && d.t - t0 > 0.04) { made = true; rw = document.createElement('div'); rw.className = 'f-rew'; rw.setAttribute('data-notr', ''); rw.textContent = '◀◀'; d.el.appendChild(rw); app.sfx?.play?.('rewind', { vol: 0.8 }); }
      for (const want = Math.ceil(back.length * e); n < want; n++) { const r = back[n]; if (O.get(r.id)) { gone.push(r); O.remove(r.id); } }
      q.style.opacity = String(Math.max(0, 1 - (d.t - t0) / 0.5));
      if (d.nextEl) d.nextEl.style.opacity = String(Math.max(0, 1 - Math.max(0, d.t - t0 - 0.05) / 0.25));
      if (u >= 1 && !stopped) { stopped = true; app.sfx?.play?.('thud', { vol: 0.9 }); rw?.remove(); rw = null; }
      return stopped && d.t - t0 >= 1.35;
    });
    q.remove();
    d.mark('hookEnd');
    for (const r of gone.reverse()) O.add(r); }
  yield d.sec(0.1);
}
sailFilm.seconds = 90;
sailFilm.place = 'beach';
sailFilm.start = 'assets/films/ibiza-2.json.gz';
sailFilm.sounds = ['plaster', 'nailgun', 'stone', 'glass', 'turf', 'block', 'trowel', 'trowel_tap', 'mallet', 'tap', 'till', 'cash', 'plank', 'hammer_nail', 'metal_hit', 'pipe', 'rebar', 'wire', 'pump', 'concrete', 'vibrator', 'screed', 'crowbar', 'fabric', 'torch', 'rewind', 'thud', 'paper', 'pin', 'waves', 'wind', 'birds'];
