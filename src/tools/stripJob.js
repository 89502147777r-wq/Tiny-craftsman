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
const CARRY = 0.75;   // s to carry one piece over
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
    // order of work: braces off, stakes out, boards pushed over
    let at = 0.1;
    for (const pc of pieces.filter((p) => p.k === 'brace')) { pc.release = at; at += 0.06; }
    at += 0.15;
    for (const pc of pieces.filter((p) => p.k === 'stake')) { pc.pull = at; pc.release = at + 0.3; at += 0.07; }
    at += 0.35;
    for (const pc of pieces.filter((p) => p.k === 'board')) { pc.release = at; at += 0.12; }
    this.carryAt = at + 1.3;
    // then to the stack: long boards first, braces, stakes on top
    const order = [...pieces.filter((p) => p.k === 'board').sort((a, b) => b.s.x - a.s.x), ...pieces.filter((p) => p.k === 'brace'), ...pieces.filter((p) => p.k === 'stake')];
    this.ground = this._groundUnder(spot, maxLen);
    const cy = Math.cos(spot.yaw), sy = Math.sin(spot.yaw);
    const u = new THREE.Vector3(cy, 0, -sy), v = new THREE.Vector3(sy, 0, cy);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spot.yaw, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    const T = MAT.board.t, H = MAT.board.h;
    let level = this.ground, k = 0, sk = 0;
    order.forEach((pc, i) => {
      pc.carry = this.carryAt + i * 0.22;
      const j = (Math.random() - 0.5);
      let off, along = (Math.random() - 0.5) * M(0.05);
      if (pc.k === 'stake') { off = 0; along = (sk - (pieces.filter((p) => p.k === 'stake').length - 1) / 2) * MAT.stake.s * 1.25; sk++; }
      else { const row = k % 4; if (row === 0 && k) level += T * 1.05; off = (row - 1.5) * H * 1.06 + j * M(0.02); k++; }
      const lift = pc.k === 'stake' ? level + T * 2 + MAT.stake.s : level + T * 1.5;
      pc.target = this.spot && new THREE.Vector3(spot.x, lift + M(0.12), spot.z).addScaledVector(v, off).addScaledVector(u, along);
      pc.targetQ = flat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), j * 0.06));
    });
    this.end = order.length ? order.at(-1).carry + CARRY : this.carryAt;
    this.t = 0;
    this.done = false;
    app.sfx?.stab?.();
    this._show();
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
    const flying = this.pieces.some((pc) => pc.body.isKinematic());
    if (this.t > this.end + 0.5 && !flying && (this.ep.still() || this.t > this.end + 2.5)) this._commit();
  }

  // what the workers do at this moment of the simulation
  _script(time) {
    const ep = this.ep;
    for (const pc of this.pieces) {
      const b = pc.body;
      if (pc.k === 'stake' && time >= pc.pull && time < pc.release) {
        // pulled straight up out of the ground
        const f = (time - pc.pull) / (pc.release - pc.pull);
        ep.moveTo(b, _p.copy(pc.p).add(_a.set(0, pc.s.y / 2 + pc.s.y * 0.75 * f, 0).applyQuaternion(pc.q)), pc.q);
      }
      if (!pc.released && time >= pc.release) {
        pc.released = true;
        ep.dynamic(b);
        const n = new THREE.Vector3(pc.n[0], 0, pc.n[1]);
        if (pc.k === 'board') {
          // pushed at the top away from the concrete: it topples outwards (against a
          // pit wall it is lifted out and tipped onto the slab)
          if (pc.inside) ep.push(b, { x: -n.x * 0.4, y: 1.6, z: -n.z * 0.4 }, _a.crossVectors(n, _up).multiplyScalar(1.5));
          else ep.push(b, { x: n.x * 0.35, y: 0, z: n.z * 0.35 }, _a.crossVectors(_up, n).multiplyScalar(1.8));
        } else if (pc.k === 'stake') {
          ep.push(b, { x: n.x * 0.8 + (Math.random() - 0.5) * 0.4, y: 0.6, z: n.z * 0.8 + (Math.random() - 0.5) * 0.4 }, { x: (Math.random() - 0.5) * 4, y: 0, z: (Math.random() - 0.5) * 4 });
        } else {
          ep.push(b, { x: n.x * 0.3, y: 0.2, z: n.z * 0.3 }, null);
        }
      }
      // carried to the stack the way a worker does it: lifted clear, carried over the
      // top of the stack, lowered and let go just above it (never through the pile —
      // a carried piece is not stopped by anything and would scatter it)
      if (pc.carry !== undefined && time >= pc.carry && !pc.dropped) {
        if (!pc.from) {
          ep.kinematic(b);
          pc.from = new THREE.Vector3(); pc.fromQ = new THREE.Quaternion();
          ep.pose(b, pc.from, pc.fromQ);
          const top = this._pileTop();
          pc.drop = pc.target.clone(); pc.drop.y = Math.max(top, this.ground) + (pc.k === 'stake' ? MAT.stake.s : MAT.board.t) + M(0.04);
          pc.safe = Math.max(pc.from.y, pc.drop.y) + M(0.35);
        }
        const f = Math.min(1, (time - pc.carry) / CARRY);
        const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
        if (f < 0.3) _p.set(pc.from.x, pc.from.y + (pc.safe - pc.from.y) * sm(f / 0.3), pc.from.z);
        else if (f < 0.75) { const g = sm((f - 0.3) / 0.45); _p.set(pc.from.x + (pc.drop.x - pc.from.x) * g, pc.safe, pc.from.z + (pc.drop.z - pc.from.z) * g); }
        else {
          // lowering: to just above the stack as it is now (others landed meanwhile)
          if (!pc.lowering) { pc.lowering = true; pc.drop.y = Math.max(pc.drop.y, this._pileTop() + (pc.k === 'stake' ? MAT.stake.s : MAT.board.t) + M(0.04)); pc.safe = Math.max(pc.safe, pc.drop.y + M(0.05)); }
          _p.set(pc.drop.x, pc.safe + (pc.drop.y - pc.safe) * sm((f - 0.75) / 0.25), pc.drop.z);
        }
        _q.slerpQuaternions(pc.fromQ, pc.targetQ, sm((f - 0.1) / 0.6));
        ep.moveTo(b, _p, _q);
        if (f >= 1) {
          pc.dropped = true;
          ep.dynamic(b);
          ep.push(b, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
        }
      }
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
    return out;
  }

  _show() {
    const fv = this.app.formView;
    fv.live = this._items();
    fv.dirty = true;
  }

  _commit() {
    const app = this.app, items = this._items();
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
