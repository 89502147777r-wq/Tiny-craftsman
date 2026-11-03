import * as THREE from 'three';
import { MODEL_SCALE, M_BLACK } from '../config.js';
import { FitJob } from './fitJob.js';
import { LANG } from '../i18n/i18n.js';
import { LAWN, LAWN_HOW, areaOf, inside as inPoly, mainDir, cellsOf, frameW } from '../world/lawn.js';

// The lawn by hand («Благоустройство → Газон», lawn records v: 2):
//   area  – «Шнур» on: the finger pulls a rectangle of string between four pegs; off: a peg dragged to a
//           new place, a touch on a string puts a new peg in it (dragged straight away) — any polygon;
//   soil  – black topsoil: the tipper drops heaps over the area, the rake spreads them lane by lane —
//           the pits, the bumps, the ditch along a path made level; or by hand («Материалы» → чернозём,
//           «Земля» → грабли) — the stage sees it lying there;
//   grass – turf rolled out row by row, or seed sown;
//   water – the sprinkler (Poly Haven) turning, its jets over the lawn, the lawn wet and greening.
const S = 1 / 1000 / MODEL_SCALE, MM = (v) => v * S;
const EN = () => LANG === 'en';
const f1 = (v) => (EN() ? v.toFixed(1) : v.toFixed(1).replace('.', ','));
// every cell of the ground (≈ 31 mm) under the lawn's cells (100 mm) — what the heaps, the rake and the
// leveller work on; one ground cell per lawn cell left the rest of the ground brown between black dots
function groundCells(t, r, c) {
  const u = r.u || [1, 0], n = [-u[1], u[0]], H = MM(LAWN.cell) / 2, seen = new Set(), out = [];
  for (const q of c) {
    const ix0 = Math.max(0, Math.ceil(t.toCellX(q.x - H * 1.5))), ix1 = Math.min(t.rx, Math.floor(t.toCellX(q.x + H * 1.5))), iz0 = Math.max(0, Math.ceil(t.toCellZ(q.z - H * 1.5))), iz1 = Math.min(t.rz, Math.floor(t.toCellZ(q.z + H * 1.5)));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * t.nx + ix; if (seen.has(i)) continue;
      const x = t.toWorldX(ix), z = t.toWorldZ(iz), a = x * u[0] + z * u[1], b = x * n[0] + z * n[1];
      if (Math.abs(a - q.a) > H + 1e-9 || Math.abs(b - q.b) > H + 1e-9) continue;
      seen.add(i); out.push({ i, a, b, x, z });
    }
  }
  return out;
}
export const LAWN_LAYERS2 = [['area', 'Разметка'], ['soil', 'Чернозём'], ['grass', 'Газон'], ['water', 'Полив']];
const NAME = Object.fromEntries(LAWN_LAYERS2);

export class LawnWork {
  constructor(land) { this.land = land; this.app = land.app; this.drag = null; this.cord = false; }
  get s() { return this.app.settings; }
  get L() { return NAME[this.s.lawnLayer] ? this.s.lawnLayer : 'area'; }
  get how() { return LAWN_HOW[this.s.lawnHow] ? this.s.lawnHow : 'turf'; }
  get view() { return this.app.gardenView; }
  get lawns() { return this.app.objects.all('lawn').filter((r) => r.v === 2); }
  get rec() { const all = this.lawns; return all.find((r) => r.id === this.land.lsel) || all.at(-1) || null; }
  toast(m) { this.app.ui?.toast(m); }
  _save(label, fn) { const app = this.app; return app.journal.act(label, {}, app.clock, fn); }
  _scr(v) { return this.app.wallTool._screen(v); }
  pick(p) { const r = this.lawns.find((q) => inPoly(q.poly, p.x, p.z)) || null; if (r) this.land.lsel = r.id; return r; }

  // the black topsoil on it (by the tipper and the rake, or by hand): most of its free ground under it
  soilOn(r) {
    if (r.done?.soil) return true;
    const t = this.app.terrain, c = cellsOf(this.app, r);
    if (!c.length) return false;
    let n = 0, k = 0;
    for (let i = 0; i < c.length; i += Math.max(1, Math.floor(c.length / 120))) { k++; if (t.topMat(t.index(c[i].x, c[i].z)) === M_BLACK) n++; }
    return n >= k * 0.6;
  }
  next(r = this.rec) {
    if (!r) return ['area', 'Разметьте газон: «Шнур» справа'];
    const d = r.done || {};
    if (!this.soilOn(r)) return ['soil', NAME.soil];
    if (!d.grass) return ['grass', NAME.grass];
    if (!d.water) return ['water', NAME.water];
    return [null, 'Газон готов'];
  }

  down(p, e) {
    const app = this.app, L = this.L;
    if (app.physJob?.fit) app.physJob.finish();
    if (app.physJob) return true;
    if (L === 'area') {
      if (this.cord) { this.drag = { L: 'rect', a: [p.x, p.z], b: [p.x, p.z] }; app.ui?.showMeasure?.(EN() ? 'Pull the string out — a rectangle' : 'Тяните шнур — прямоугольник'); return true; }
      const P = this._peg(p, e);
      if (P) { app.journal.begin('lawn-peg', {}, app.clock); this.drag = { L: 'peg', id: P.r.id, k: P.k }; return true; }
      // (a touch on a string: a new peg in it, dragged straight away)
      const Q = this._string(p, e);
      if (Q) {
        app.journal.begin('lawn-peg', {}, app.clock);
        const poly = [...Q.r.poly.slice(0, Q.k + 1), [+Q.x.toFixed(5), +Q.z.toFixed(5)], ...Q.r.poly.slice(Q.k + 1)];
        app.objects.update(Q.r.id, { poly, u: mainDir(poly) });
        this.drag = { L: 'peg', id: Q.r.id, k: Q.k + 1 };
        this.toast(EN() ? 'A new peg in the string — drag it' : 'Новый колышек на шнуре — тяните его');
        return true;
      }
      this.toast(this.lawns.length ? 'Колышки двигают пальцем, тап по шнуру — новый колышек; новая разметка — «Шнур» справа' : 'Включите «Шнур» справа и растяните пальцем место под газон');
      return true;
    }
    const r = this.pick(p);
    if (!r) { this.toast('Коснитесь газона (сначала «1 · Разметка»)'); return true; }
    if (L === 'soil') { if (this.soilOn(r)) { this.toast('Чернозём уже лежит — дальше «3 · Газон»'); return true; } this._soil(r); return true; }
    if (L === 'grass') { this.levelFirst(r, () => this.land._lGrass(app.objects.get(r.id) || r)); return true; }
    if (L === 'water') { if (r.done?.grass) this._water(r); else this.levelFirst(r, () => this._water(app.objects.get(r.id) || r)); return true; }
    return true;
  }
  move(p, e) {
    const d = this.drag, app = this.app;
    if (!d || !p) return;
    if (d.L === 'rect') {
      d.b = [p.x, p.z];
      const poly = rectOf(d.a, d.b);
      this.view.setLiveLawn(poly ? { poly, g: this.land._groundIn(poly), v: 2, pegsOnly: true } : null);
      const w = Math.abs(d.b[0] - d.a[0]) / S / 1000, h = Math.abs(d.b[1] - d.a[1]) / S / 1000;
      app.ui?.showMeasure?.(EN() ? `${f1(w)} × ${f1(h)} m = ${f1(w * h)} m²` : `${f1(w)} × ${f1(h)} м = ${f1(w * h)} м²`);
    } else if (d.L === 'peg') {
      const r = app.objects.get(d.id); if (!r) return;
      const poly = r.poly.map((q, k) => (k === d.k ? [+p.x.toFixed(5), +p.z.toFixed(5)] : q));
      app.objects.update(r.id, { poly, u: mainDir(poly) });
      const n = poly.length, A = poly[(d.k + n - 1) % n], B = poly[(d.k + 1) % n], q = poly[d.k];
      app.ui?.showMeasure?.(EN() ? `${f1(Math.hypot(q[0] - A[0], q[1] - A[1]) / S / 1000)} m | ${f1(Math.hypot(B[0] - q[0], B[1] - q[1]) / S / 1000)} m · ${f1(areaOf(poly) / S / S / 1e6)} m²` : `${f1(Math.hypot(q[0] - A[0], q[1] - A[1]) / S / 1000)} м | ${f1(Math.hypot(B[0] - q[0], B[1] - q[1]) / S / 1000)} м · ${f1(areaOf(poly) / S / S / 1e6)} м²`);
    }
  }
  up() {
    const app = this.app, d = this.drag;
    this.drag = null;
    app.ui?.hideMeasure?.();
    if (!d) return;
    if (d.L === 'rect') {
      this.view.setLiveLawn(null);
      const poly = rectOf(d.a, d.b);
      if (!poly || areaOf(poly) < MM(1000) * MM(1000)) { this.toast('Место под газон мало — растяните шнур шире (от 1 м²)'); return; }
      const rec = { type: 'lawn', v: 2, poly, g: +this.land._groundIn(poly).toFixed(6), u: mainDir(poly), how: this.how, done: {} };
      this._save('lawn-area', () => { this.land.lsel = app.objects.add(rec).id; });
      this.toast(EN() ? `Lawn ${f1(areaOf(poly) / S / S / 1e6)} m²: four pegs and the string. Drag a peg; a touch on the string — a new peg. Next «2 · Black topsoil»` : `Газон ${f1(areaOf(poly) / S / S / 1e6)} м²: четыре колышка и шнур. Колышек тяните; тап по шнуру — новый колышек. Дальше «2 · Чернозём»`);
      return;
    }
    if (d.L === 'peg') {
      const r = app.objects.get(d.id);
      if (!r || areaOf(r.poly) < MM(500) * MM(500)) { app.journal.cancel(); this.toast('Так газон слишком мал'); return; }
      app.journal.commit(app.clock);
    }
  }
  interrupt() { const d = this.drag; this.drag = null; if (d?.L === 'rect') this.view.setLiveLawn(null); if (d?.L === 'peg') this.app.journal.cancel(); this.app.ui?.hideMeasure?.(); }

  _peg(p, e) {
    let best = null, bd = Infinity;
    for (const r of this.lawns) r.poly.forEach((q, k) => {
      let d;
      if (e && e.clientX !== undefined) { const sp = this._scr(new THREE.Vector3(q[0], r.g + MM(200), q[1])); if (!sp.front) return; d = Math.hypot(sp.x - e.clientX, sp.y - e.clientY); if (d > 60) return; }
      else { d = Math.hypot(p.x - q[0], p.z - q[1]) / S; if (d > 400) return; }
      if (d < bd) { bd = d; best = { r, k }; }
    });
    return best;
  }
  _string(p) {
    let best = null, bd = MM(250);
    for (const r of this.lawns) for (let k = 0; k < r.poly.length; k++) {
      const [ax, az] = r.poly[k], [bx, bz] = r.poly[(k + 1) % r.poly.length], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-12, t = Math.max(0.05, Math.min(0.95, ((p.x - ax) * dx + (p.z - az) * dz) / L2));
      const x = ax + dx * t, z = az + dz * t, d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) { bd = d; best = { r, k, x, z }; }
    }
    return best;
  }

  // the rake drawn along the lanes over the cells: the soil level at y (the heaps down, the pits filled)
  _rakeSteps(r, c, cells, y, box) {
    const app = this.app, t = app.terrain;
    const a0 = c.a0, a1 = c.a1, b0 = c.b0, b1 = c.b1, lanes = Math.max(2, Math.ceil((b1 - b0) / MM(900)));
    const rk = app.rake, vis = rk.root.visible, pos0 = rk.target.pos.clone(), dir0 = rk.target.dir.clone(), lift0 = rk.target.lift;
    const back = () => { rk.setPose({ pos: pos0, dir: dir0, lift: lift0 }, true); rk.root.visible = vis; };
    const steps = [];
    // 2 · the rake along the lanes: the soil drawn level (the heaps down, the pits and the ditch filled)
    const u = r.u || [1, 0], dur = Math.max(3, Math.min(14, lanes * (a1 - a0) / MM(1000) * 0.35));
    steps.push([0, () => { rk.root.visible = true; }]);
    steps.push([dur, (q) => {
      const L = Math.min(lanes - 1, Math.floor(q * lanes)), f = q * lanes - L, back2 = L % 2, a = back2 ? a1 - (a1 - a0) * f : a0 + (a1 - a0) * f, bl0 = b0 + (b1 - b0) * L / lanes, bl1 = b0 + (b1 - b0) * (L + 1) / lanes, sw = Math.sin(q * 160), b = (bl0 + bl1) / 2 + sw * (bl1 - bl0) * 0.3;
      const [x, z] = frameW(r, a, b);
      rk.setPose({ pos: new THREE.Vector3(x, Math.max(t.heightAt(x, z), y) + MM(10), z), dir: new THREE.Vector2(back2 ? u[0] : -u[0], back2 ? u[1] : -u[1]), lift: 0.4 + 0.2 * Math.abs(sw) }, q === 0);
      for (const qq of cells) {
        if (qq.b < bl0 - MM(50) || qq.b > bl1 + MM(50) || (back2 ? qq.a < a : qq.a > a)) continue;
        const h = t.hAt(qq.i);
        if (h < y - 1e-7) t._push(qq.i, y - h, M_BLACK); else if (h > y + 1e-7) t._pop(qq.i, h - y);
      }
      t._touch(...box);
      if (Math.random() < 0.12) app.sfx?.scrapeLevel?.(0.25);
    }]);
    steps.push([0.05, () => { for (const q of cells) { const h = t.hAt(q.i); if (h < y) t._push(q.i, y - h, M_BLACK); else if (h > y) t._pop(q.i, h - y); } t._touch(...box); back(); app.sfx?.scrapeLevel?.(0); }]);
    return { steps, back };
  }
  // the ground under the lawn not level (the topsoil tipped by hand from «Материалы» in heaps): raked
  // level first — at the height its soil gives over the area — then `then`
  levelFirst(r, then) {
    const app = this.app, t = app.terrain, c = cellsOf(app, r);
    if (!c.length) { this.toast('Внутри разметки нет свободной земли'); return; }
    const cells = groundCells(t, r, c), hs = cells.map((q) => t.hAt(q.i));
    const lo = Math.min(...hs), hi = Math.max(...hs);
    if (hi - lo < MM(60)) { then(); return; }
    const y = hs.reduce((a, b) => a + b, 0) / hs.length, box = cellsBox(t, c), { steps, back } = this._rakeSteps(r, c, cells, y, box);
    app.journal.begin('lawn-rake', {}, app.clock);
    new FitJob(app, { steps, parts: [], onAbort: () => { app.journal.cancel(); back(); }, commit: () => {
      app.objects.update(r.id, { g: +y.toFixed(6), done: { ...(app.objects.get(r.id).done || {}), ...(this.soilOn(r) ? { soil: 1 } : {}) } });
      app.journal.commit(app.clock);
      this.toast(EN() ? `Raked level first: the heaps spread, ${f1((hi - lo) / S)} mm of bumps made good` : `Сначала разровняли граблями: кучи растянуты, перепад ${Math.round((hi - lo) / S)} мм выровнен`);
      then();   // (the job is off app.physJob by now: the next one starts straight away)
    } });
  }

  // ---- the black topsoil: heaps tipped over the area, raked level lane by lane ----
  _soil(r) {
    const app = this.app, t = app.terrain, c = cellsOf(app, r), A = c.length * (LAWN.cell / 1000) ** 2;
    if (!c.length) { this.toast('Внутри разметки нет свободной земли'); return; }
    const y = r.g + MM(LAWN.soil), nH = Math.max(2, Math.min(9, Math.round(A / 6)));
    // the heaps: spread over the area (the cells' middles of nH parts)
    const heaps = [];
    for (let k = 0; k < nH; k++) { const q = c[Math.floor((k + 0.5) / nH * c.length)]; heaps.push({ x: q.x, z: q.z, R: MM(700 + Math.random() * 300), h: MM(350 + Math.random() * 120), p: 0 }); }
    const cells = groundCells(t, r, c), box = cellsBox(t, c);
    const { steps: rake, back } = this._rakeSteps(r, c, cells, y, box);
    app.journal.begin('lawn-soil', {}, app.clock);
    const steps = [];
    // 1 · the heaps tipped one after another
    for (const H of heaps) steps.push([0.6, (u) => {
      const want = Math.min(1, u * 1.1);
      if (want <= H.p) return;
      H.p = want;
      for (const q of cells) { const d = Math.hypot(q.x - H.x, q.z - H.z); if (d >= H.R) continue; const top = r.g + H.h * want * (1 - (d / H.R) ** 2); const h = t.hAt(q.i); if (h < top) t._push(q.i, top - h, M_BLACK); }
      t._touch(...box);
      if (Math.random() < 0.7) app.particles?.emit(new THREE.Vector3(H.x, r.g + H.h + MM(300), H.z), new THREE.Vector3((Math.random() - 0.5) * 0.1, -0.2, (Math.random() - 0.5) * 0.1), 0, MM(30), 0, 0, M_BLACK);   // (no clods left lying: raked away)
      if (Math.random() < 0.2) app.sfx?.pour?.(0.35);
    }]);
    steps.push(...rake);
    new FitJob(app, {
      steps, parts: [],
      onAbort: () => { app.journal.cancel(); back(); },
      commit: () => {
        app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), soil: 1 } });
        app.journal.commit(app.clock);
        this.toast(EN() ? `Black topsoil: ${nH} heaps tipped and raked level, ${f1(A * LAWN.soil / 1000)} m³ over ${f1(A)} m² — the pits, the bumps and the ditch by the path made good. Next «3 · Lawn»` : `Чернозём: ${nH} кучи высыпаны и разровнены граблями, ${f1(A * LAWN.soil / 1000)} м³ на ${f1(A)} м² — ямки, бугорки и канавка у дорожки выровнены. Дальше «3 · Газон»`);
      },
    });
  }

  // ---- the water: the sprinkler set in the middle, turning; its jets of drops over the lawn ----
  _water(r) {
    const app = this.app, c = cellsOf(app, r);
    if (!c.length) { this.toast('Здесь нечего поливать'); return; }
    const am = (c.a0 + c.a1) / 2, bm = (c.b0 + c.b1) / 2, [x, z] = frameW(r, am, bm), R = Math.max(c.a1 - c.a0, c.b1 - c.b0) * 0.55, t = app.terrain, gy = t.inside(x, z) ? t.heightAt(x, z) : r.g;
    const kit = sprinklerKit(); kit.position.set(x, gy + MM(15), z);
    const key = 'L' + r.id;
    let last = 0;
    new FitJob(app, {
      parts: [kit],
      steps: [
        [0.6, (u) => { kit.position.y = gy + MM(15) + MM(300) * (1 - u); }],
        [5, (u) => {
          const dt = Math.max(0, (u - last) * 5); last = u;
          sprinklerRun(kit, dt, u < 0.95, R, gy);
          this.view.setAnim(key, { water: u, wet: Math.min(1, u * 2.5) });
          if (Math.random() < 0.15) app.sfx?.pour?.(0.18);
        }],
        [0.8, (u) => { const dt = 0.016; sprinklerRun(kit, dt, false, R, gy); this.view.setAnim(key, { water: 1, wet: 1 - u * 0.3 }); }],
      ],
      onAbort: () => this.view.setAnim(key, null),
      commit: () => { this._save('lawn-water', () => app.objects.update(r.id, { done: { ...(app.objects.get(r.id).done || {}), water: 1 } })); this.view.setAnim(key, null); this.toast(r.how === 'seed' || app.objects.get(r.id).how === 'seed' ? 'Полито — газон густой и зелёный. Готово' : 'Полито — рулоны укоренились, швы сомкнулись. Газон готов'); },
    });
  }

  status() {
    return {
      area: this.cord ? 'Растяните шнур пальцем — прямоугольник под газон' : 'Колышки двигают пальцем, тап по шнуру — новый колышек; новая разметка — «Шнур» справа',
      soil: 'Коснитесь газона — самосвал высыплет чернозём кучками, грабли разровняют (или сами: «Материалы» → чернозём, «Земля» → грабли)',
      grass: this.how === 'seed' ? 'Коснитесь газона — посев семян' : 'Коснитесь газона — рулоны лягут ряд за рядом, швы вразбежку',
      water: 'Коснитесь газона — поливалка в середине, струи по всему газону',
    }[this.L];
  }
}

function rectOf(a, b) {
  if (Math.abs(b[0] - a[0]) < MM(300) || Math.abs(b[1] - a[1]) < MM(300)) return null;
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]].map(([x, z]) => [+x.toFixed(5), +z.toFixed(5)]);
}
function cellsBox(t, c) {
  const xs = c.map((q) => q.x), zs = c.map((q) => q.z);
  return [Math.max(0, Math.floor(t.toCellX(Math.min(...xs))) - 1), Math.max(0, Math.floor(t.toCellZ(Math.min(...zs))) - 1), Math.min(t.rx, Math.ceil(t.toCellX(Math.max(...xs))) + 1), Math.min(t.rz, Math.ceil(t.toCellZ(Math.max(...zs))) + 1)];
}

// the sprinkler: the model (a spinner on wheels, Poly Haven), its jets of drops
import { loadModel } from '../world/machines/models.js';
function sprinklerKit() {
  const G = new THREE.Group(), body = new THREE.Group(); G.add(body); G.userData.body = body;
  loadModel('garden/sprinkler').then(({ scene }) => { scene.scale.setScalar(MM(1000)); scene.traverse((o) => { if (o.isMesh) o.castShadow = true; if (/spinner|nozel/i.test(o.name)) (G.userData.spin ||= []).push(o); }); body.add(scene); }).catch(() => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(MM(90), MM(110), MM(60), 16), new THREE.MeshStandardMaterial({ color: 0x2d7d3a })); m.position.y = MM(30); body.add(m);
  });
  // (the drops: small, clear, drawn out along their flight — a jet's streaks)
  const N = 700, drops = new THREE.InstancedMesh(new THREE.SphereGeometry(MM(3.2), 5, 3), new THREE.MeshStandardMaterial({ color: 0xdcefff, transparent: true, opacity: 0.32, roughness: 0.02, metalness: 0.2, depthWrite: false }), N);
  drops.frustumCulled = false; G.add(drops);
  G.userData.drops = { mesh: drops, list: Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 })), ang: 0 };
  return G;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0), _s = new THREE.Vector3();
function sprinklerRun(G, dt, on, R, gy) {
  const D = G.userData.drops, g = 9.8 / MODEL_SCALE, top = MM(110);
  D.ang += dt * 7;
  for (const o of G.userData.spin || []) o.rotation.y = D.ang;
  // (two arms: each throws its jet a little up, out to the lawn's edge)
  const v0 = Math.sqrt(g * R * 1.05);
  let k = 0;
  for (const s of D.list) {
    if (s.life <= 0 && on && Math.random() < 0.5) {
      const arm = Math.random() < 0.5 ? 0 : Math.PI, a = D.ang + arm + (Math.random() - 0.5) * 0.35, sp = v0 * (0.25 + Math.random() * 0.75), up = 0.55 + Math.random() * 0.25;
      s.p.set(Math.cos(a) * MM(120), top, Math.sin(a) * MM(120)); s.v.set(Math.cos(a) * sp * Math.cos(up), sp * Math.sin(up), Math.sin(a) * sp * Math.cos(up)); s.life = 3;
    }
    if (s.life > 0) { s.v.y -= g * dt; s.p.addScaledVector(s.v, dt); s.life -= dt; if (G.position.y + s.p.y < gy) s.life = 0; }
    const sc = s.life > 0 ? 1 : 0;
    _q.setFromUnitVectors(_y, s.v.lengthSq() ? s.v.clone().normalize() : _y);
    _m.compose(s.p, _q, _s.set(sc, sc * (2 + Math.min(4, s.v.length() * 6)), sc)); D.mesh.setMatrixAt(k++, _m);
  }
  D.mesh.instanceMatrix.needsUpdate = true;
}
void inPoly;
