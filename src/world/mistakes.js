import * as THREE from 'three';
import { MODEL_SCALE } from '../config.js';
import { LANG } from '../i18n/i18n.js';

// «Ошибки» — what a mistake of the build does to the house as the years go by: a time-lapse played over the
// house as it stands (a show, like the catastrophes: the records do not change; «Вернуть как было» — the house
// is built again from them). The years run by as a fast time-lapse (the sun going round and round, the year
// counting up) and the damage grows as it does on a real house: slowly, then faster.
// The «x-ray» (on by default) shows the stress in the masonry before anything cracks — yellow to red where
// the load gathers; the crack is born where it is reddest and runs along the mortar joints, as real cracks do.
//   lintel — a lintel cast without its bars (plain concrete does not hold bending): a hairline crack at the
//            bottom of its middle, then it breaks in two halves that turn down on their bearings; the masonry
//            over the opening sags as an arch (the arch of collapse, ~0,6 of the span high); the window under
//            it takes the load: its frame is squeezed, its glass cracks; at last the bottom of the arch falls.
// The cracks are as real ones are: jagged («a bolt of lightning»), through the blocks themselves mostly, along a
// joint now and then for a short way, with a branch or two; a hairline first, opening wider where it began.
// A facade on insulation does not crack with the wall (the board and the render ride on the insulation): with
// one, the cracks are seen inside, on the bare blocks, and through it by the x-ray (the facade hidden then).
const S = MODEL_SCALE, M = (m) => m / S;   // (m → model)
export const MISTAKES = {
  lintel: { name: 'Перемычка без арматуры', en: 'A lintel without rebar', icon: '🧱', saved: 60, repair: 4200, years: 10 },
};
const ease = (u) => u * u * (3 - 2 * u), clamp01 = (u) => Math.max(0, Math.min(1, u));
const MASONRY = ['blocks', 'bricks', 'cinders', 'ublocks'];

export class Mistake {
  constructor(app) { this.app = app; this.on = false; }
  get secPerYear() { return 3.2; }

  // the lintel to break: the longest over an opening, with masonry on it
  _findLintel() {
    const wv = this.app.wallView, im = wv.lintels; if (!im?.count) return null;
    const m4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    let best = null;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m4); m4.decompose(P, Q, Sv);
      const ax = Sv.x >= Sv.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), L = Math.max(Sv.x, Sv.z), T = Math.min(Sv.x, Sv.z);
      ax.applyQuaternion(Q).setY(0).normalize();
      if (!best || L > best.L) best = { i, c: P.clone(), q: Q.clone(), s: Sv.clone(), ax, L, T, H: Sv.y, m: m4.clone() };
    }
    return best;
  }

  start(kind = 'lintel', years = 10) {
    if (this.on) this.stop();
    const app = this.app, wv = app.wallView;
    wv.update?.();
    const Lt = this._findLintel();
    if (!Lt) return { ok: false, why: 'lintel' };
    this.kind = kind; this.years = years; this.t = 0; this.on = true; this.done = false; this.said = {};
    wv.frozen = true;
    const nrm = new THREE.Vector3(-Lt.ax.z, 0, Lt.ax.x), top = Lt.c.y + Lt.H / 2;
    const span = Math.max(M(0.6), Lt.L - 2 * M(0.25)), h = span * 0.6;
    this.L = { ...Lt, nrm, top, span, h };
    // the masonry over it: each unit's place along the wall (a), up from the lintel's top (y), in the arch?
    const m4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
    this.units = []; this.colors = [];
    for (const key of MASONRY) {
      const im = wv[key]; if (!im?.count || !im.visible) continue;
      if (im.instanceColor) this.colors.push({ im, orig: im.instanceColor.array.slice() });
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4); m4.decompose(P, Q, Sv);
        if (Sv.x * Sv.y * Sv.z < 1e-12) continue;
        const rel = P.clone().sub(Lt.c), a = rel.dot(Lt.ax), n = rel.dot(nrm), y = P.y - top;
        if (Math.abs(n) > Lt.T * 0.75 + M(0.05) || y < -M(0.02) || y > h + M(1.2) || Math.abs(a) > Lt.L / 2 + M(1.2)) continue;
        // (in the arch: under the line from the opening's edges up to its crown — by the unit's middle, so the
        // edge of what drops goes unit by unit: a stepped crack along the joints)
        const inA = Math.abs(a) < span / 2 && y < h * (1 - (a / (span / 2)) ** 2);   // (the arch of collapse: a parabola)
        this.units.push({ im, i, base: m4.clone(), p: P.clone(), s: Sv.clone(), a, y, inA, half: Math.max(Sv.x, Sv.z) / 2, hh: Sv.y / 2, d: 0, fall: null, col: im.instanceColor ? [im.instanceColor.getX(i), im.instanceColor.getY(i), im.instanceColor.getZ(i)] : null });
      }
    }
    if (!this.units.some((u) => u.inA)) { this.stop(); return { ok: false, why: 'masonry' }; }
    // the lintel itself: hidden, two halves in its place (the same concrete) that turn down on their bearings
    wv.lintels.getMatrixAt(Lt.i, m4); this._lintelM = m4.clone();
    { const z = new THREE.Matrix4().makeScale(0, 0, 0); wv.lintels.setMatrixAt(Lt.i, z); wv.lintels.instanceMatrix.needsUpdate = true; }
    this.root = new THREE.Group(); this.root.name = 'mistake'; app.scene.add(this.root);
    this.halves = new THREE.InstancedMesh(wv.lintels.geometry, wv.lintels.material, 2); this.halves.castShadow = this.halves.receiveShadow = true; this.halves.frustumCulled = false;
    this.root.add(this.halves);
    // the cracks: jagged lines on both faces of the masonry (each side: whether a facade covers it)
    this.crackMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.facSide = [1, -1].map((sd) => !!wv.facades?.children.length && this._faceOff(0, h * 0.4, sd, true) > this._faceOff(0, h * 0.4, sd, false) + M(0.02));
    this.facade = this.facSide.some(Boolean);
    this._cracks();
    // the window under the opening: it takes the load when the lintel gives
    this._window();
    // the words over the picture: the year, the mistake, at the end the bill
    this._overlay();
    this.h0 = app.settings.dayHour ?? 12;
    // (the camera brought round to the opening: in front of it, a little to the side and up — the finger
    // turns it as it likes after)
    { const toCam = nrm.clone(), C = app.camera.position; if (C.clone().sub(Lt.c).dot(nrm) < 0) toCam.negate();
      const yaw = Math.atan2(toCam.x, toCam.z) + 0.3, d = Math.max(M(4), span * 2.6);
      app.rig.goal.target.copy(Lt.c).setY(top + h * 0.4); app.rig.goal.yaw = yaw; app.rig.goal.pitch = 0.14; app.rig.goal.dist = d; }
    this._apply(0);
    return { ok: true, units: this.units.length, arch: this.units.filter((u) => u.inA).length };
  }

  // a point on the wall (a along it from the lintel's middle, y the height, n off its middle line)
  _at(y, a, n) { const L = this.L; return L.c.clone().addScaledVector(L.ax, a).addScaledVector(L.nrm, n).setY(y); }
  // how far out the wall's outer surface is there (side ±1): a ray from outside onto the masonry (and the facade)
  _faceOff(a, y, side, facade = true) {
    const L = this.L, wv = this.app.wallView, ray = (this._ray ||= new THREE.Raycaster());
    const o = this._at(L.top + y, a, side * M(1.5)), d = L.nrm.clone().multiplyScalar(-side);
    ray.set(o, d); ray.far = M(1.6);
    const objs = [wv.blocks, wv.bricks, wv.cinders, wv.ublocks, ...(facade && wv.facades ? [wv.facades] : [])].filter(Boolean);
    const hit = ray.intersectObjects(objs, true)[0];
    return hit ? M(1.5) - hit.distance : L.T / 2;
  }
  // the cracks' paths (in the wall's plane: a along it, y up from the lintel's top), as they are on a real failed
  // plain-concrete lintel in glued aerated concrete (the realist): the lintel's own crack up its middle from the
  // bottom (open below, closed at the top: a hinge); the arch of collapse over the opening — a parabola from
  // each top corner of the opening, steep there (≈ 65°), level at the crown, the two meeting there. Each nearly
  // straight on the whole, ragged only in the small (length 1,03 … 1,10 of the chord); at a real bed joint now
  // and then a short run along it (then back to its line smoothly, no hook); a hairline branch or two near the tip,
  // forward along it at 20 … 40°. Seeded by the lintel's place: every house its own.
  _cracks() {
    const L = this.L, seed = (Math.abs(Math.round(L.c.x * 1e4) * 73856093 ^ Math.round(L.c.z * 1e4) * 19349663) % 2147483646) + 1;
    const rnd = (() => { let x = seed; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
    const AMP = [0.017, 0.023, 0.029, 0.038, 0.046, 0.058, 0.066];
    // (the real bed joints over the lintel: the tops of the courses in the masonry there)
    const beds = [...new Set(this.units.filter((u) => Math.abs(u.a) < L.span).map((u) => Math.round((u.y + u.hh) / M(0.005)) * M(0.005)))].sort((p, q) => p - q);
    const jogP = 0.3;
    const rough = (P, k = 1) => {
      let lb = 0; for (let i = 1; i < P.length; i++) lb += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      for (const amp0 of AMP) {
        const amp = amp0 * k, Q = [P[0]];
        for (let i = 1; i < P.length; i++) { const [xa, ya] = P[i - 1], [xb, yb] = P[i], l = Math.hypot(xb - xa, yb - ya) || 1e-9, off = (rnd() * 2 - 1) * amp * l * 2.2; Q.push([(xa + xb) / 2 - (yb - ya) / l * off, (ya + yb) / 2 + (xb - xa) / l * off], P[i]); }
        P = Q;
      }
      // (a joint crossed: now and then along it a little way, and on from there — every point after it shifted)
      const out = [P[0]]; let joint = 0, sh = 0;
      for (let i = 1; i < P.length; i++) {
        const [xa, ya] = P[i - 1], [xb, yb] = P[i], j = beds.find((y) => (ya - y) * (yb - y) < 0);
        if (j != null && rnd() < jogP) { const xj = xa + (xb - xa) * (j - ya) / ((yb - ya) || 1e-9) + sh, run = (M(0.02) + rnd() * M(0.06)) * (rnd() < 0.5 ? -1 : 1); out.push([xj, j], [xj + run, j]); sh += run; joint += Math.abs(run); out.push([xb + sh, yb]); continue; }
        out.push([xb + sh, yb]); sh *= 0.96;   // (back to its line smoothly, over a few cm: no hook)
      }
      out.joint = joint; out.lb = lb;
      return out;
    };
    const h = L.h, sp = L.span / 2, C = [];
    // the lintel's own crack: from its bottom middle up through it (a hinge at its top)
    { const P = []; for (let i = 0; i <= 4; i++) P.push([(rnd() - 0.5) * M(0.004) * i, -L.H + L.H * i / 4]); C.push({ p: rough(P, 0.6), t0: 0.02, t1: 0.15, kind: 'lintel' }); }
    // the arch: from each top corner of the opening, along the parabola, to the crown
    for (const sd of [-1, 1]) { const P = []; for (let i = 0; i <= 12; i++) { const u = i / 12, a = sd * sp * (1 - u); P.push([a, h * (1 - (a / sp) ** 2)]); } C.push({ p: rough(P), s0: M(0.004), s1: M(0.014), kind: 'arch' }); }
    // the branches: near each main crack's tip, forward along it at 20 … 40°
    for (const m of [C[1], C[2]]) for (let k = 0, n = 1 + (rnd() < 0.5 ? 1 : 0); k < n; k++) {
      const i = Math.floor(m.p.length * (0.55 + 0.35 * rnd())), [x, y] = m.p[i], [x2, y2] = m.p[Math.min(m.p.length - 1, i + 8)], tl = Math.hypot(x2 - x, y2 - y) || 1;
      const ang = (rnd() < 0.5 ? -1 : 1) * (0.35 + 0.35 * rnd()), ca = Math.cos(ang), sa = Math.sin(ang), dx = ((x2 - x) * ca - (y2 - y) * sa) / tl, dy = ((x2 - x) * sa + (y2 - y) * ca) / tl, l = M(0.03) + rnd() * M(0.12);
      C.push({ p: rough([[x, y], [x + dx * l / 2, y + dy * l / 2], [x + dx * l, y + dy * l]], 1.2), s0: m.s0 + M(0.004), s1: m.s1 + M(0.006), kind: 'branch', root: m });
    }
    for (const c of C) { let s0 = 0; c.len = [0]; for (let i = 1; i < c.p.length; i++) { s0 += Math.hypot(c.p[i][0] - c.p[i - 1][0], c.p[i][1] - c.p[i - 1][1]); c.len.push(s0); } c.L = s0; c.joint = c.p.joint; c.Lb = c.p.lb; }
    this.paths = C;
    // (each face of the masonry: how far out it is along each path — sampled, held between the samples)
    for (const c of C) { let last = null; c.off = c.p.map(([a, y], i) => (i % 6 === 0 || !last ? (last = [this._faceOff(a, y, 1, false), this._faceOff(a, y, -1, false)]) : last)); }
    const g = new THREE.BufferGeometry(), n = C.reduce((s0, c) => s0 + c.p.length, 0) * 2 * 2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const idx = []; let base = 0;
    for (const c of C) for (let side = 0; side < 2; side++) { for (let i = 0; i < c.p.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } base += c.p.length * 2; }
    g.setIndex(idx);
    this.crackMesh = new THREE.Mesh(g, this.crackMat); this.crackMesh.frustumCulled = false; this.root.add(this.crackMesh);
  }
  // how far the masonry at (a, y) has gone down: what is in the arch rests on the lintel's halves and goes down
  // with them — most at the middle, nothing at the opening's edges — less up toward the crown; outside: still
  drop(a, y) {
    const L = this.L, sp = L.span / 2;
    if (Math.abs(a) >= sp || y > L.h * (1 - (a / sp) ** 2)) return 0;
    return (this.sag || 0) * (1 - Math.abs(a) / sp) * (1 - 0.5 * Math.max(0, y) / L.h);
  }
  _drawCracks(yrs, sag) {
    const L = this.L, geo = this.crackMesh.geometry, A = geo.attributes.position.array, Cc = geo.attributes.color.array, facOn = this.app.wallView.facades?.visible !== false;
    const cam = this.app.camera, px = 2 * Math.tan((cam.fov || 50) * Math.PI / 360) / Math.max(300, innerHeight || 800);   // (a pixel's angle: no line thinner than it)
    const th = Math.atan2(sag, L.span / 2), hair = M(0.0002);
    let v = 0, cv = 0, shown = 0;
    for (const c of this.paths) {
      // how far along it has grown (0…1): the lintel's at once in the first weeks, the arch's as it sags
      const k = c.t0 != null ? clamp01((yrs - c.t0) / (c.t1 - c.t0)) : clamp01((sag - c.s0) / (c.s1 - c.s0));
      const reach = c.L * Math.pow(k, 0.7);
      if (k > 0) shown++;
      for (let side = 0; side < 2; side++) {
        // (a face under a facade: not seen — unless the x-ray has taken the facade away)
        const hid = this.facSide[side] && facOn;
        for (let i = 0; i < c.p.length; i++) {
          const [a, y] = c.p[i], s = c.len[i], on = !hid && k > 0 && s <= reach;
          const ip = Math.min(c.p.length - 1, i + 1), im = Math.max(0, i - 1), ta = c.p[ip][0] - c.p[im][0], ty = c.p[ip][1] - c.p[im][1], tl = Math.hypot(ta, ty) || 1;
          // (its true width: the lintel's — open at its bottom, 2·H·θ, closed at its top; the arch's — what the
          // two sides have parted across it: the drop inside × how level it runs there; a hairline at least, and
          // thinner still at its growing tip)
          let w = 0;
          if (on) {
            w = c.kind === 'lintel' ? Math.max(hair, 2 * th * (-y)) : c.kind === 'branch' ? Math.max(hair, this.drop(a, y - M(0.02)) * Math.abs(ta / tl) * 0.4) : Math.max(hair, this.drop(a, y - M(0.02)) * Math.abs(ta / tl));
            w *= Math.pow(clamp01((reach - s) / M(0.15) + (k >= 1 ? 1 : 0)), 0.6) * (0.85 + 0.3 * Math.abs(Math.sin(i * 1.7)));
          }
          const wr = on ? Math.max(w, cam.position.distanceTo(this._at(L.top + y, a, 0)) * px) : 0;   // (drawn: at least a pixel)
          const qa = -ty / tl * wr / 2, qy = ta / tl * wr / 2, n = (side ? -1 : 1) * (c.off[i][side] + M(0.0015));
          const p1 = this._at(L.top + y + qy, a + qa, n), p2 = this._at(L.top + y - qy, a - qa, n);
          A[v++] = p1.x; A[v++] = p1.y; A[v++] = p1.z; A[v++] = p2.x; A[v++] = p2.y; A[v++] = p2.z;
          // (its colour by its width: a hairline grey — dust in it; from ~2 mm dark, its depth showing)
          const dk = clamp01((w / M(0.001) - 0.5) / 1.5), r = 0.416 + (0.082 - 0.416) * dk, g = 0.392 + (0.071 - 0.392) * dk, b = 0.361 + (0.059 - 0.361) * dk;
          for (let q = 0; q < 2; q++) { Cc[cv++] = r; Cc[cv++] = g; Cc[cv++] = b; }
          c.w1 = i === 0 ? w : c.w1;
        }
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; this.crackN = shown;
  }
  // the window in the opening (if there is one): its glass, the cracks to show on it (spreading from the top
  // middle where it is pressed: a web of lines, their order in the alpha — shown as the alpha test drops)
  _window() {
    const app = this.app, L = this.L, wv = app.wallView, bot = L.c.y - L.H / 2;
    let best = null;
    for (const r of app.objects.all('window')) {
      const e = wv._win?.get(r.id); if (!e) continue;
      const b = new THREE.Box3().setFromObject(e.group); if (b.isEmpty()) continue;
      const c = b.getCenter(new THREE.Vector3()), rel = c.clone().sub(L.c);
      if (Math.abs(rel.dot(L.ax)) > L.span / 2 || Math.abs(rel.dot(L.nrm)) > L.T || b.max.y < bot - M(0.4) || b.max.y > bot + M(0.08)) continue;
      if (!best || b.max.y > best.b.max.y) best = { r, g: e.group, b, c };
    }
    if (!best) return;
    const glass = []; best.g.traverse((o) => { if (o.isMesh && o.material?.transparent && o.material.opacity < 0.6) glass.push(o); });
    const tex = crackTexture(), cracks = [];
    for (const o of glass) {
      const gb = new THREE.Box3().setFromObject(o), gc = gb.getCenter(new THREE.Vector3()), gs = gb.getSize(new THREE.Vector3());
      const w = Math.abs(gs.x * L.ax.x) + Math.abs(gs.z * L.ax.z), h = gs.y; if (w < M(0.1) || h < M(0.1)) continue;
      for (const sd of [1, -1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xdfe8ec, alphaMap: tex, alphaTest: 1, side: THREE.DoubleSide, depthWrite: false }));
        m.position.copy(gc).addScaledVector(L.nrm, sd * M(0.003)); m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(L.ax, new THREE.Vector3(0, 1, 0), L.nrm)); m.visible = false; m.renderOrder = 3;
        this.root.add(m); cracks.push(m);
      }
    }
    this.win = { g: best.g, sy: best.g.scale.y, h: best.b.max.y - best.b.min.y, c: best.c, cracks };
  }
  _overlay() {
    const el = (this.el = document.createElement('div'));
    el.className = 'mistake-hud'; el.setAttribute('data-notr', '');
    el.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 64px);transform:translateX(-50%);z-index:30;pointer-events:none;text-align:center;font:600 15px/1.25 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000a';
    el.innerHTML = '<div class="m-what" style="font-size:13px;opacity:.85"></div><div class="m-year" style="font-size:30px;font-weight:800;letter-spacing:.5px"></div><div class="m-note" style="font-size:13px;opacity:.9"></div><div class="m-bill" style="margin-top:8px;font-size:15px;opacity:0;transition:opacity .4s"></div>';
    document.body.appendChild(el);
    const K = MISTAKES[this.kind], en = LANG === 'en';
    el.querySelector('.m-what').textContent = en ? `${K.en} over a ${(this.L.span * S).toFixed(1)} m opening` : `${K.name} над проёмом ${(this.L.span * S).toFixed(1).replace('.', ',')} м`;
  }
  _say(key, ru, en) { if (this.said[key]) return; this.said[key] = 1; this.note = LANG === 'en' ? en : ru; }

  // ---- the years going by ----------------------------------------------------------------------------
  update(dt) {
    if (!this.on || this.done) return;
    this.t += dt;
    const yrs = this.t / this.secPerYear, u = clamp01(yrs / this.years);
    // (the sun round once in 0,8 s: a day of the time-lapse — the light flickering by as on a real one)
    this.app.sky?.setHour?.(6 + 13 * ((this.t / 0.8) % 1));
    this._apply(yrs, dt);
    if (yrs >= this.years + 1.2) this._end();
  }
  _apply(yrs, dt = 0) {
    const app = this.app, L = this.L, Y = this.years, wv0 = app.wallView;
    // how far it has gone (the realist): a lintel without bars breaks in the first weeks, once the load comes on
    // (its middle bottom cracks right through: brittle); then it creeps, fast at first, slower and slower —
    // 4 mm at once, toward ~24 mm with a window under it (it holds the rest), ~45 without — breathing with the
    // seasons (wider in winter)
    const tb = 0.08, sInf = this.win ? M(0.024) : M(0.045), s0 = M(0.004);
    const sag = yrs < tb ? 0 : s0 + (sInf - s0) * (1 - Math.exp(-(yrs - tb) / 1.5)) * (1 + 0.08 * Math.sin(yrs * Math.PI * 2));
    this.sag = sag;
    if (yrs > 0.03) this._say('hair', 'Перемычка треснула посередине снизу — бетон без арматуры не держит изгиб', 'The lintel cracks at its middle bottom — plain concrete does not hold bending');
    if (sag > M(0.006)) this._say('sag', 'Перемычка переломилась — кладка над проёмом садится аркой', 'The lintel broke — the masonry over the opening sags as an arch');
    if (sag > M(0.018)) this._say('arch', this.facade ? 'Свод обрушения отделился — снаружи трещин не видно: фасад на утеплителе их не повторяет' : 'Свод обрушения отделился трещинами — кладка держится на сломанной перемычке', this.facade ? 'The arch of collapse has come apart — not seen outside: a facade on insulation does not follow it' : 'The arch of collapse has come apart — the masonry rests on the broken lintel');
    // the halves: three hinges — each turns down about its bearing at the opening's edge, the two touching at
    // their top in the middle (crushed a little there), the crack open below by 2·H·θ
    {
      const sp = L.span / 2, th = Math.atan2(sag, sp), m = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3();
      this._lintelM.decompose(P, Q, Sv);
      for (const side of [-1, 1]) {
        const s2 = Sv.clone(); if (Sv.x >= Sv.z) s2.x = Sv.x / 2 - M(0.001); else s2.z = Sv.z / 2 - M(0.001);
        const pivot = L.c.clone().addScaledVector(L.ax, side * sp).setY(L.c.y - L.H / 2);
        const c = L.c.clone().addScaledVector(L.ax, side * L.L / 4);
        const R = new THREE.Quaternion().setFromAxisAngle(L.nrm, side * th);
        const pc = c.clone().sub(pivot).applyQuaternion(R).add(pivot);
        // (its inner top corner kept at the middle: the halves bear on each other there, they do not overlap)
        const top = L.c.clone().setY(L.c.y + L.H / 2), topR = top.clone().sub(pivot).applyQuaternion(R).add(pivot), slide = top.clone().sub(topR).dot(L.ax);
        pc.addScaledVector(L.ax, slide);
        m.compose(pc, R.clone().multiply(Q), s2);
        this.halves.setMatrixAt(side < 0 ? 0 : 1, m);
      }
      this.halves.instanceMatrix.needsUpdate = true;
    }
    // the masonry: what is in the arch goes down with the lintel (this.drop); the x-ray tints by the stress — over
    // the middle of the opening first, gathering along the arch's line
    const m = new THREE.Matrix4(), xr = app.settings.mXray !== false, Ld = Math.max(1e-9, L.h);
    const st = clamp01(yrs / 1.2);
    for (const un of this.units) {
      const off = Math.abs(un.a) / (L.span / 2 + M(0.1));
      un.d = un.inA ? this.drop(un.a, un.y - un.hh) : 0;
      m.copy(un.base); m.elements[13] -= un.d; un.im.setMatrixAt(un.i, m);
      if (un.col && un.im.instanceColor) {
        const line = 1 - (un.a / (L.span / 2)) ** 2, edge = Math.abs(un.a) < L.span / 2 + M(0.3) ? clamp01(1 - Math.abs(un.y / Ld - Math.max(0, line)) * 1.6) : 0;
        const sv = xr ? clamp01(st * edge * (0.6 + 0.4 * clamp01(yrs / 3))) : 0;
        const r = un.col[0] + (1.0 - un.col[0]) * sv, g = un.col[1] + ((sv < 0.5 ? 0.85 : 0.25) - un.col[1]) * sv, b = un.col[2] + (0.08 - un.col[2]) * sv;
        un.im.instanceColor.setXYZ(un.i, r, g, b);
      }
    }
    // the blocks stay in (glued, the wedge rests on the halves on their 250 mm bearings): what falls is the
    // concrete crushed at the hinge — chips from the lintel's top middle — and dust from the cracks
    if (sag > M(0.008) && (this.chips || 0) < 6 && dt > 0 && Math.random() < dt * 1.5) {
      this.chips = (this.chips || 0) + 1;
      const p = this._at(L.top - M(0.01), (Math.random() - 0.5) * M(0.05), (Math.random() - 0.5) * L.T * 0.8);
      app.particles?.emit?.(p, new THREE.Vector3((Math.random() - 0.5) * M(0.2), M(0.1), (Math.random() - 0.5) * M(0.2)).addScaledVector(L.nrm, (Math.random() < 0.5 ? -1 : 1) * M(0.15)), 0, M(0.012 + Math.random() * 0.02), 0, 0, 0);
      app.sfx?.play?.('debris', { at: p, vol: 0.35, gap: 0.6 });
    }
    for (const im of new Set(this.units.map((q) => q.im))) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    // (the x-ray sees through a facade: it is hidden while the x-ray is on)
    if (this.facade && wv0.facades) wv0.facades.visible = app.settings.mXray === false;
    // the cracks: each grows from where it starts to its full length, a hairline at its tip, as wide as the
    // two sides have parted where it began
    this._drawCracks(yrs, sag);
    // the window: its frame squeezed by what the lintel no longer carries, its glass cracking
    if (this.win) {
      // (the frame sits 15 mm under the lintel: the sag takes that gap first — the sash jams — then squeezes the
      // frame; 3 … 5 mm more and the glass cracks)
      const W = this.win, press = Math.max(0, sag - M(0.015));
      W.g.scale.y = W.sy * (1 - press / Math.max(1e-6, W.h));
      if (sag > M(0.012)) this._say('jam', 'Створку окна заклинило — перемычка выбрала монтажный зазор', 'The window sash jams — the lintel has taken up the fitting gap');
      if (press > M(0.004) && !this.said.glass) { this.said.glass = 1; app.sfx?.play?.('glass_break', { at: W.c, vol: 0.6 }); this.note = LANG === 'en' ? 'The lintel came down on the window — the frame squeezed, the glass cracked' : 'Перемычка легла на окно — раму сжало, стекло лопнуло'; }
      const k2 = clamp01((press - M(0.004)) / M(0.006));
      for (const m of W.cracks) { m.visible = k2 > 0; m.material.alphaTest = Math.max(0.02, 1 - k2); }
    }
    // the words
    if (this.el) {
      const en = LANG === 'en', y = Math.min(this.years, Math.floor(yrs));
      this.el.querySelector('.m-year').textContent = en ? `Year ${y}` : `Год ${y}`;
      this.el.querySelector('.m-note').textContent = this.note || '';
    }
    if (this.t > 0.05 && Math.floor(yrs) !== this._yr) { this._yr = Math.floor(yrs); if (yrs > 1.2) app.sfx?.play?.('creak', { at: L.c, vol: 0.25 + 0.5 * clamp01(sag / M(0.024)) }); }
  }
  _end() {
    this.done = true;
    const K = MISTAKES[this.kind], en = LANG === 'en', b = this.el?.querySelector('.m-bill');
    if (b) { b.textContent = en ? `Saved: $${K.saved} (the bars) → the repair: $${K.repair.toLocaleString('en-US')}` : `Сэкономили: $${K.saved} (арматура) → ремонт: $${K.repair.toLocaleString('en-US')}`; b.style.opacity = 1; }
  }
  stop() {
    if (!this.on) return;
    const app = this.app, wv = app.wallView;
    this.on = false; this.done = false; this.fell = false;
    if (this.root) { app.scene.remove(this.root); this.halves?.dispose(); this.crackMat?.dispose(); this.root = null; }
    for (const c of this.colors) { c.im.instanceColor.array.set(c.orig); c.im.instanceColor.needsUpdate = true; }
    if (this.win) { this.win.g.scale.y = this.win.sy; for (const m of this.win.cracks) { m.parent?.remove(m); m.material.dispose(); } this.win = null; }
    if (wv.facades) wv.facades.visible = true;
    this.crackMesh?.geometry.dispose();
    this.el?.remove(); this.el = null; this.note = '';
    if (this.h0 != null) app.sky?.setHour?.(this.h0);
    wv.frozen = false; wv.dirty = true; wv.update?.();
  }
  stats() { return { on: this.on, done: this.done, sag: (this.sag || 0) * S, cracks: this.crackN || 0, chips: this.chips || 0, jam: !!this.said.jam, glass: !!this.win?.cracks.some((m) => m.visible), paths: this.paths?.map((c) => ({ kind: c.kind, L: c.L * S, chord: (c.Lb || c.L) * S, joint: c.joint * S, w0: (c.w1 || 0) * S })), fell: this.units?.filter((u) => u.fall).length || 0, arch: this.units?.filter((u) => u.inA).length || 0 }; }
}

// the glass's cracks: a web from where it is pressed (the top middle) — jagged radial lines and rings between
// them; the alpha is the order a line appears in (bright first: shown as the alpha test drops)
let _ctex = null;
function crackTexture() {
  if (_ctex) return _ctex;
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n); g.lineCap = 'round';
  let x0 = 0x51f3a7; const r = () => ((x0 = (x0 * 16807) % 2147483647) / 2147483647);
  const ox = n * (0.45 + r() * 0.1), oy = n * 0.06, rays = [];
  for (let k = 0; k < 13; k++) {
    const ang = Math.PI * (0.05 + 0.9 * (k + r() * 0.6) / 13), len = n * (0.35 + r() * 0.75), pts = [[ox, oy]];
    let x = ox, y = oy; for (let s = 0; s < 14; s++) { const a = ang + (r() - 0.5) * 0.5; x += Math.cos(a) * len / 14; y += Math.sin(a) * len / 14; pts.push([x, y]); }
    rays.push(pts);
    const v = 255 - Math.floor(k / 13 * 120);
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 2.2; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.stroke();
  }
  for (let ring = 1; ring < 6; ring++) for (let k = 0; k < rays.length - 1; k++) {
    if (r() < 0.35) continue;
    const a = rays[k][Math.min(13, ring * 2 + 1)], b = rays[k + 1][Math.min(13, ring * 2 + 1)], v = 200 - ring * 25;
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(...a); g.quadraticCurveTo((a[0] + b[0]) / 2 + (r() - 0.5) * 20, (a[1] + b[1]) / 2 + (r() - 0.5) * 20, ...b); g.stroke();
  }
  // (the canvas's top is the glass's top: drawn from y 0 down — flipped onto the plane)
  _ctex = new THREE.CanvasTexture(c); _ctex.flipY = false; return _ctex;
}
