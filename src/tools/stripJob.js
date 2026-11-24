import * as THREE from 'three';
import { MAT, MODEL_SCALE } from '../config.js';
import { Episode, DENSITY } from '../world/physics.js';
import { runPieces } from '../world/formwork.js';

// Stripping the formwork with real physics (one journal entry):
//   1. the braces are knocked off, the stakes pulled out and dropped, then the
//      boards are pushed off the concrete face one after another — they topple,
//      bounce and lie where they fall
//   2. a worker carries them one by one to the stack and drops them on it:
//      boards flat, braces on them, stakes across the top — the stack builds up
//      as they really land
// When everything lies still the final poses become a 'formpile' object.
const S = MODEL_SCALE, M = (m) => m / S;   // real metres → model
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class StripJob {
  constructor(app, runs, spot) {
    this.app = app;
    const t = app.terrain;
    this.pending = app.journal.begin('strip', { outlineId: runs[0].outlineId, runs: runs.length }, app.clock);
    // the pieces as they stand, then the runs are gone from the objects
    const pieces = [];
    for (const r of runs) for (const pc of runPieces(r, t)) { pc.n = r.inside ? [-r.n[0], -r.n[1]] : r.n; pc.inside = !!r.inside; pieces.push(pc); }
    for (const r of runs) app.objects.remove(r.id);
    // the patch of ground the physics needs: the formwork and the stack
    let x0 = spot.x, x1 = spot.x, z0 = spot.z, z1 = spot.z;
    for (const pc of pieces) { x0 = Math.min(x0, pc.p.x); x1 = Math.max(x1, pc.p.x); z0 = Math.min(z0, pc.p.z); z1 = Math.max(z1, pc.p.z); }
    const pad = M(1.2), maxLen = Math.max(...pieces.filter((p) => p.k === 'board').map((p) => p.s.x), 0.1);
    this.ep = new Episode(t, x0 - pad - maxLen / 2, z0 - pad - maxLen / 2, x1 + pad + maxLen / 2, z1 + pad + maxLen / 2);
    this.ep.onLand = (b, v, at) => app.sfx?.play?.('plank', { vol: Math.min(1, v / 2.5), at, gap: 0.09 });
    this.spot = spot;
    // bodies: half sizes in model units, centred
    for (const pc of pieces) {
      pc.u = Math.random(); pc.v = Math.floor(Math.random() * 8) / 8;
      const c = pc.p.clone();
      if (pc.k === 'stake') c.add(_a.set(0, pc.s.y / 2, 0).applyQuaternion(pc.q));
      if (pc.k === 'board') c.addScaledVector(_a.set(pc.n[0], 0, pc.n[1]), t.cell * 1.2);   // clear of the (coarser) ground mesh
      if (pc.k === 'brace') c.y += M(0.01);
      // the solid a little shorter than the drawn piece: at the lapped corners the boards
      // of two runs overlap, and a brace touches its stake — overlapping solids would
      // fly apart the moment they are let go
      const hx = pc.k === 'board' ? pc.s.x / 2 - MAT.board.t * 1.2 : pc.k === 'brace' ? pc.s.x / 2 * 0.85 : pc.s.x / 2 * 0.9;
      pc.body = this.ep.box(hx, pc.s.y / 2 * (pc.k === 'stake' ? 0.98 : 0.97), pc.s.z / 2 * 0.9, c, pc.q, { density: DENSITY.wood, kinematic: true });
    }
    this.pieces = pieces;
    // (the realist, 302: the stack laid as a crew lays it — two men, one board a trip or an armful of three braces or five stakes,
    // walked over at 1,25 m/s and put down in its place: the boards longest lowest on three 50×50 bearers, the braces and the
    // stakes in their bundles beside; nothing thrown, no swarm in the air)
    this.ground = this._groundUnder(spot, maxLen);
    this.bearers = this._bearers(maxLen);
    const final = this._tidy(pieces.map((pc) => ({ k: pc.k, s: pc.s.toArray(), pc })));
    for (const it of final) {
      const pc = it.pc; pc.targetQ = new THREE.Quaternion().fromArray(it.q); pc.target = new THREE.Vector3().fromArray(it.p);
      if (pc.k === 'stake') pc.target.add(_a.set(0, pc.s.y / 2, 0).applyQuaternion(pc.targetQ));   // (the body's centre, not its point)
    }
    const trips = [], chunk = (list, n) => { for (let i = 0; i < list.length; i += n) trips.push(list.slice(i, i + n)); };
    chunk(pieces.filter((p) => p.k === 'brace'), 3);
    chunk(pieces.filter((p) => p.k === 'stake'), 5);
    chunk(pieces.filter((p) => p.k === 'board').sort((a, b) => b.s.x - a.s.x), 1);
    const free = [0.1, 0.5, 0.9], WALK = M(1.25);   // (three men: two were too slow to watch — the owner)
    for (const tr of trips) {
      const w = free.indexOf(Math.min(...free)), t0 = free[w], c = tr[0];
      const dist = Math.hypot(c.target.x - c.p.x, c.target.z - c.p.z);
      const tPull = c.k === 'stake' ? 0.5 : c.k === 'board' ? 0.4 : 0.2, tWalk = Math.max(0.6, dist / WALK), dur = tPull + 0.4 + tWalk + 0.5;
      for (const pc of tr) Object.assign(pc, { carry: t0, tPull, tWalk, dur, ease: pc.k === 'board' && !pc.inside });
      free[w] = t0 + dur + 0.3;   // (and walks back meanwhile — the next one he picks up)
    }
    // (in the game all of it in ≤ 2,5 s — the owner, 2026-11-24: «2–3 сек максимум». Not the crew's pace sped up (its short moves
    // went under a frame: pieces jumped — the realist): each trip — a board, an armful of braces or stakes — its own whole move,
    // 0,15 out, 0,15 up, the walk at ≤ 6 m/s (≥ 0,45 s), 0,15 down; the trips fanned out over the time, the lowest layer of the stack
    // first so nothing is put down through what already lies there. The films keep the crew's own pace.)
    if (!app.filmMode) {
      // (bigger armfuls: ten stakes, six braces — fewer trips in the air at once, ≤ ~15)
      trips.length = 0; const byY = (a, b) => a.target.y - b.target.y; chunk(pieces.filter((p) => p.k === 'brace').sort(byY), 6); chunk(pieces.filter((p) => p.k === 'stake').sort(byY), 10); chunk(pieces.filter((p) => p.k === 'board').sort((a, b) => b.s.x - a.s.x), 1);   // (each armful one layer of its bundle after another: the lower first)
      const order = trips.map((tr) => ({ tr, y: Math.min(...tr.map((p) => p.target.y)), dist: Math.max(...tr.map((p) => Math.hypot(p.target.x - p.p.x, p.target.z - p.p.z))) }))   /* (an armful gathered from all round: its farthest piece's walk) */.sort((a, b) => a.y - b.y);
      // (each trip's arrival by its place in the stack, evenly from 0,9 s to 2,3 s; its walk as long as that leaves — so a far one is
      // not rushed: ≤ 6 m/s at its fastest where the time allows)
      const T = 2.3, n = order.length;
      order.forEach((o, i) => { const need0 = Math.max(0.45, 1.18 * o.dist / M(6)), arrive = Math.min(T, Math.max(n > 1 ? 0.9 + (T - 0.9) * i / (n - 1) : 0.9, 0.45 + need0)), need = Math.max(0.45, 1.18 * o.dist / M(6)), tWalk = Math.max(0.45, Math.min(need, arrive - 0.45)), dur = 0.45 + tWalk;
        for (const pc of o.tr) Object.assign(pc, { carry: Math.max(0, arrive - dur), tPull: 0.15, tWalk, dur, lift: 0.15, put: 0.15, ease: pc.k === 'board' && !pc.inside }); });
      free.length = 0; free.push(T);
      this.quick = true;
    }
    this.end = Math.max(...free, 0.1);
    this.t = 0;
    this.done = false;
    app.sfx?.play?.('crowbar');
    this._show();
  }

  // three 50×50 bearers across under where the boards will lie
  _bearers(len) {
    const { x, z, yaw } = this.spot, ax = Math.cos(yaw), az = -Math.sin(yaw), H = MAT.board.h, w = 4 * H + M(0.1), b = M(0.05);
    const q = new THREE.Quaternion().setFromAxisAngle(_up, yaw + Math.PI / 2).toArray().map((v) => +v.toFixed(5));
    return [-0.42, 0, 0.42].map((f) => ({ k: 'brace', bear: true, p: [x + ax * len * f, this.ground + b / 2, z + az * len * f].map((v) => +v.toFixed(5)), q, s: [+w.toFixed(5), +b.toFixed(5), +b.toFixed(5)], u: 0.3, v: 0.5 }));
  }

  get busy() { return !this.done; }

  _groundUnder(spot, len) {
    const t = this.app.terrain, cy = Math.cos(spot.yaw), sy = Math.sin(spot.yaw);
    let g = -Infinity;
    for (const f of [-0.5, -0.25, 0, 0.25, 0.5]) for (const w of [-0.5, 0, 0.5]) {
      const x = spot.x + cy * len * f + sy * MAT.board.h * 4.2 * w, z = spot.z - sy * len * f + cy * MAT.board.h * 4.2 * w;
      if (t.inside(x, z)) g = Math.max(g, t.heightAt(x, z));
    }
    return Number.isFinite(g) ? g : 0;
  }

  update(dt) {
    if (this.done) return;
    if (this.app.journal.pending !== this.pending) { this._dispose(); return; }   // undone meanwhile
    this.ep.step(dt, (time) => this._script(time));
    // a piece that got through the ground (never should) is put back on the stack
    for (const pc of this.pieces) {
      const y = pc.body.translation().y / MODEL_SCALE;
      if (y < this.app.terrain.floorY - 0.02 && !pc.body.isKinematic()) {
        pc.body.setTranslation({ x: this.spot.x * MODEL_SCALE, y: (this.ground + 0.05) * MODEL_SCALE, z: this.spot.z * MODEL_SCALE }, true);
        pc.body.setLinvel({ x: 0, y: 0, z: 0 }, true); pc.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.t = this.ep.time;
    this._show();
    if (this.pieces.every((pc) => pc.dropped)) this._commit();   // (every piece put down in its place: kinematic all the way, nothing to settle)
  }

  // what the workers do at this moment of the simulation: each trip — pulled / eased off, lifted clear, walked over, put down
  _script(time) {
    const ep = this.ep, sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    // (quick: the walk at an even pace with a short start and stop — its peak ~1,15 × its mean, not the ease's 1,5)
    const tr = (x) => { x = Math.max(0, Math.min(1, x)); const r = 0.15, v = 1 / (1 - r); return x < r ? v * x * x / (2 * r) : x > 1 - r ? 1 - v * (1 - x) * (1 - x) / (2 * r) : v * (x - r / 2); };
    const wk = this.quick ? tr : sm, dtS = Math.max(0, time - (this._lastS ?? time)); this._lastS = time;
    for (const pc of this.pieces) {
      if (pc.dropped || time < pc.carry) continue;
      const b = pc.body, a = time - pc.carry;
      if (!pc.from) { ep.kinematic(b); pc.from = new THREE.Vector3(); pc.fromQ = new THREE.Quaternion(); ep.pose(b, pc.from, pc.fromQ); pc.safe = Math.max(pc.from.y, pc.target.y) + M(0.45); }
      // 1 · out: a stake straight up its own length's buried part (turned only once its point is out); a board eased 40 mm off
      // the concrete (one against the pit's wall straight up); a brace knocked loose
      if (pc.up == null) { const t = this.app.terrain; pc.up = pc.k === 'stake' ? Math.max(pc.s.y * 0.75, (t.inside(pc.p.x, pc.p.z) ? t.heightAt(pc.p.x, pc.p.z) : pc.p.y) - pc.p.y + M(0.05)) : 0; }   // (till its point is 50 mm out of the ground there)
      const up = pc.up, e = pc.ease ? M(0.04) : 0;
      const u1 = sm(a / pc.tPull), ox = pc.from.x + pc.n[0] * e * u1, oz = pc.from.z + pc.n[1] * e * u1, oy = pc.from.y + up * u1;
      if (a < pc.tPull) { ep.moveTo(b, _p.set(ox, oy, oz), pc.fromQ); continue; }
      // 2 · lifted clear, turned to how it will lie; 3 · walked over; 4 · lowered into its place
      const a2 = a - pc.tPull, lift = pc.lift ?? 0.4, walk = pc.tWalk, put = pc.put ?? 0.5;
      if (a2 < lift) { const u = sm(a2 / lift); _p.set(ox, oy + (pc.safe - oy) * u, oz); _q.slerpQuaternions(pc.fromQ, pc.targetQ, u * 0.5); }
      else if (a2 < lift + walk) { const u = wk((a2 - lift) / walk); _p.set(ox + (pc.target.x - ox) * u, pc.safe, oz + (pc.target.z - oz) * u); _q.slerpQuaternions(pc.fromQ, pc.targetQ, 0.5 + 0.5 * u); }
      else {
        // (quick: what is to lie under it not down yet — it waits over its place: the stack built from the bottom up)
        if (this.quick && this.pieces.some((o) => o !== pc && o.carry !== pc.carry && !o.dropped && o.target.y < pc.target.y - 1e-4 && Math.hypot(o.target.x - pc.target.x, o.target.z - pc.target.z) < M(0.3))) { pc.carry += dtS; _p.set(pc.target.x, pc.safe, pc.target.z); ep.moveTo(b, _p, pc.targetQ); continue; }
        const u = sm((a2 - lift - walk) / put); _p.set(pc.target.x, pc.safe + (pc.target.y - pc.safe) * u, pc.target.z); _q.copy(pc.targetQ); }
      ep.moveTo(b, _p, _q);
      if (a2 >= lift + walk + put) { pc.dropped = true; ep.moveTo(b, pc.target, pc.targetQ); app_land(this, pc); }
    }
  }

  // the top of what already lies on the stack (model y)
  _pileTop() {
    let top = this.ground;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), r = M(0.9);
    for (const pc of this.pieces) {
      if (!pc.dropped) continue;
      this.ep.pose(pc.body, p, q);
      if (Math.hypot(p.x - this.spot.x, p.z - this.spot.z) > r) continue;
      // the highest corner of the piece
      const h = Math.abs(_a.set(0, 1, 0).applyQuaternion(q).y) * pc.s.y / 2 + Math.abs(_a.set(1, 0, 0).applyQuaternion(q).y) * pc.s.x / 2 + Math.abs(_a.set(0, 0, 1).applyQuaternion(q).y) * pc.s.z / 2;
      top = Math.max(top, p.y + h);
    }
    return top;
  }

  // the pieces where physics has them now (the stake is drawn from its point)
  _items() {
    const out = [];
    for (const pc of this.pieces) {
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
      this.ep.pose(pc.body, p, q);
      if (pc.k === 'stake') p.sub(_a.set(0, pc.s.y / 2, 0).applyQuaternion(q));
      out.push({ k: pc.k, p: p.toArray().map((x) => +x.toFixed(5)), q: q.toArray().map((x) => +x.toFixed(5)), s: pc.s.toArray().map((x) => +x.toFixed(5)), u: pc.u, v: pc.v });
    }
    if (this.bearers) out.push(...this.bearers);
    return out;
  }

  _show() {
    const fv = this.app.formView;
    fv.live = this._items();
    fv.dirty = true;
  }

  // the stack squared up (the owner: the boards must be stacked neatly on the plot — what the physics leaves is a heap):
  // the boards flat, four abreast, layer on layer, one end flush, the longest lowest; the braces on them; the stakes in a
  // bundle beside. The crew's last minute with the stack — not shown piece by piece
  _tidy(items) {
    const { x, z, yaw } = this.spot, g = this.ground, H = MAT.board.h, T = MAT.board.t, N = 4, gap = M(0.012);
    const ax = Math.cos(yaw), az = -Math.sin(yaw), cx = Math.sin(yaw), cz = Math.cos(yaw);
    const Qy = new THREE.Quaternion().setFromAxisAngle(_up, yaw), flat = Qy.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_a.set(1, 0, 0), Math.PI / 2)), lying = Qy.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_a.set(0, 0, 1), -Math.PI / 2));
    const put = (it, a, c, y, q) => { it.p = [x + ax * a + cx * c, y, z + az * a + cz * c].map((v) => +v.toFixed(5)); it.q = q.toArray().map((v) => +v.toFixed(5)); };
    const boards = items.filter((i) => i.k === 'board').sort((p, q) => q.s[0] - p.s[0]), L = boards.length ? boards[0].s[0] : M(2), gb = g + M(0.05);   // (on the bearers)
    boards.forEach((it, i) => put(it, (it.s[0] - L) / 2, (i % N - (N - 1) / 2) * (H + gap), gb + T / 2 + Math.floor(i / N) * T, flat));
    // (the braces in their own bundle on the ground, on the stack's other side from the stakes)
    const c1 = -((N / 2) * (H + gap) + M(0.25));
    items.filter((i) => i.k === 'brace' && !i.bear).forEach((it, i) => put(it, (it.s[0] - L) / 2, c1 - (i % 6) * M(0.09), g + it.s[1] / 2 + Math.floor(i / 6) * it.s[1], Qy));
    const st = items.filter((i) => i.k === 'stake').sort((p, q) => q.s[1] - p.s[1]), w = st.length ? st[0].s[0] : 0, c0 = (N / 2) * (H + gap) + M(0.25);
    st.forEach((it, i) => put(it, -L / 2, c0 + (i % 6) * (w + M(0.006)), g + w / 2 + Math.floor(i / 6) * w, lying));
    return items;
  }
  _commit() {
    const app = this.app, items = this._tidy(this._items());
    const boards = this.pieces.filter((p) => p.k === 'board').map((p) => +p.s.x.toFixed(5));
    const stakes = this.pieces.filter((p) => p.k === 'stake').length;
    app.objects.add({ type: 'formpile', x: this.spot.x, z: this.spot.z, yaw: this.spot.yaw, boards, stakes, items });
    app.journal.commit(app.clock);
    this._dispose();
    app.ui?.toast(`Опалубка снята: ${boards.length} досок${stakes ? `, ${stakes} кольев` : ''} — сложены в штабель`);
    app.ui?.refresh();
  }

  _dispose() {
    this.done = true;
    this.ep?.dispose(); this.ep = null;
    this.app.formView.live = null;
    this.app.formView.dirty = true;
    if (this.app.physJob === this) this.app.physJob = null;
  }

  // run to the end at once (redo, tests, leaving the page)
  finish() {
    for (let i = 0; i < 3600 && !this.done; i++) this.update(1 / 10);
  }

  abort() {
    if (this.done) return false;
    this.app.journal.cancel();
    this._dispose();
    return true;
  }
}

// a piece put down: the knock of wood on wood
function app_land(job, pc) { job.app.sfx?.play?.('plank', { vol: pc.k === 'board' ? 0.6 : 0.4, at: pc.target, gap: job.quick ? 0.3 : 0.09 }); }   // (quick: a clatter now and then, not a machine-gun — the realist)
