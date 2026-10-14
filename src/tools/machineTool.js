import * as THREE from 'three';
import { Excavator } from '../world/machines/excavator.js';
import { Tractor, MixerTruck, ConcretePump, SiteMixer } from '../world/machines/vehicles.js';
import { PARKING, MACHINES_ENABLED } from '../config.js';
import { R } from '../world/machines/parts.js';

const CLASSES = { excavator: Excavator, tractor: Tractor, mixer: MixerTruck, pump: ConcretePump, siteMixer: SiteMixer };
export const DRIVABLE = ['excavator', 'tractor', 'mixer', 'pump'];

// Machines on the plot. They stand parked along the far edge; the chosen one
// is driven with the left joystick.
//   excavator, auto:   finger stroke on the ground = one dig cycle along it
//                      (reach out → teeth in → drag to the cab → curl → lift),
//                      tap while the bucket is full = swing there and dump
//   excavator, manual: two ISO joysticks like in the cab
//   tractor:           loader buttons; the bucket cuts what its edge meets
//   truck mixer:       drum mixing / discharge, chute swing
// Every dig cycle and every drive (first input → standstill) is one journal action.
export class MachineTool {
  constructor(app) {
    this.app = app;
    this.machines = {};      // kind → Machine
    this.active = null;      // kind
    this.idle = 0;
    this.syncing = false;
    this.stroke = null;      // finger stroke for the excavator
    app.objects.on((id, rec) => {
      if (this.syncing) return;
      if (rec?.type === 'machine') { if (MACHINES_ENABLED) this._ensure(rec.kind, rec.id).apply(rec); }
      else if (!rec) for (const [k, m] of Object.entries(this.machines)) if (m.id === id) this._despawn(k);
    });
  }

  get machine() { return this.active ? this.machines[this.active] : null; }

  _ensure(kind, id) {
    let m = this.machines[kind];
    if (!m) {
      m = new CLASSES[kind](this.app);
      this.machines[kind] = m;
      this.app.scene.add(m.root);
      // the model arrives later: re-apply the stored pose once it is built
      m.ready.then(() => {
        if (this.machines[kind] !== m) return;
        const r = m.id && this.app.objects.get(m.id);
        if (r) m.apply(r);
        this.app.ui?.refresh();
      }).catch((e) => console.error('machine model', kind, e));
    }
    if (id) m.id = id;
    return m;
  }

  _despawn(kind) {
    const m = this.machines[kind];
    if (!m) return;
    this.app.scene.remove(m.root);
    delete this.machines[kind];
    if (this.active === kind) this.active = null;
  }

  // records for the parked fleet of a fresh plot
  static parkedRecords() {
    return Object.entries(PARKING).map(([kind, [x, z, yaw]]) => ({ type: 'machine', kind, x, z, yaw, load: 0 }));
  }

  select(kind) {
    const { app } = this;
    // the machine left behind stops where it is (and is saved there)
    const prev = this.machine;
    if (prev) { prev.throttle = 0; prev.steer = 0; prev.v = 0; prev.yawRate = 0; }
    if (this._driving()) app.journal.commit(app.clock);
    this.active = kind;
    if (!this.machines[kind] || !this.machines[kind].id) {
      const [x, z, yaw] = PARKING[kind];
      app.journal.act('machine-add', { kind }, app.clock, () => app.objects.add({ type: 'machine', kind, x, z, yaw, load: 0 }));
    }
    const m = this.machine;
    app.focusPoint = null;
    app.rig.lookAtPoint(new THREE.Vector3(m.x, m.y + R(1.2), m.z));
    if (app.rig.goal.dist > 1.1) app.rig.goal.dist = 0.75;
    app.ui.refresh();
  }

  // ---- input ---------------------------------------------------------------------------------
  joystick(x, y) {
    const m = this.machine;
    if (!m) return;
    if (m.kind === 'excavator' && m.mode === 'manual') { this.manual('l', x, y); return; }
    if ((x || y) && !this._driving()) this._beginDrive();
    m.throttle = -y; m.steer = x;
    this.idle = 0;
  }

  // ISO manual control: 'l' / 'r' stick
  manual(side, x, y) {
    const m = this.machines.excavator;
    if (!m || this.active !== 'excavator') return;
    if ((x || y) && !this._driving()) this._beginDrive();
    if (side === 'l') { m.manual.lx = x; m.manual.ly = y; } else { m.manual.rx = x; m.manual.ry = y; }
    this.idle = 0;
  }

  setExMode(mode) {
    const m = this.machines.excavator;
    if (!m || m.busy) return;
    m.mode = mode;
    m.manual = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this.app.ui.refresh();
  }

  toggleTravel() {
    const m = this.machines.excavator;
    if (!m) return;
    m.manualTravel = !m.manualTravel;
    m.manual.lx = m.manual.ly = 0;
    this.app.ui.refresh();
  }

  loader(mode) {
    const m = this.machine;
    if (!m || m.kind !== 'tractor') return;
    if (!this._driving()) this._beginDrive({ loader: mode });
    m.setBucket(mode);
    this.idle = 0;
    this.app.ui.refresh();
  }

  drum(dir) {
    const m = this.machine;
    if (!m || m.kind !== 'mixer') return;
    m.drumSpeed = dir > 0 ? 0.9 : -1.6;
    this.app.ui.refresh();
  }

  chute(d) {
    const m = this.machine;
    if (!m || m.kind !== 'mixer') return;
    if (!this._driving()) this._beginDrive({ chute: true });
    m.t.chute = Math.max(-1.4, Math.min(1.4, m.t.chute + d));
    this.idle = 0;
    this.app.ui.refresh();
  }

  _beginDrive(meta = {}) { this.app.journal.begin('drive', { kind: this.active, ...meta }, this.app.clock); }
  _driving() { return this.app.journal.pending?.type === 'drive'; }
  _digging() { return this.app.journal.pending?.type === 'excavate'; }

  // ---- ground gestures: the excavator in auto mode digs along a finger stroke ------------------
  down(p) {
    const m = this.machines.excavator;
    if (this.active !== 'excavator' || !m || !m.nodes || m.mode !== 'auto') return false;
    if (m.cycle && m.cycle.phase !== 'hold') return false;  // busy: the finger orbits instead
    this.stroke = { a: p.clone(), b: p.clone(), t0: performance.now() };
    this.app.ui.showMeasure?.('');
    return true;
  }

  move(p) {
    if (!this.stroke) return;
    this.stroke.b.copy(p);
    const d = Math.hypot(p.x - this.stroke.a.x, p.z - this.stroke.a.z) * 12;
    this.app.ui.showMeasure?.(`${d.toFixed(1)} м`);
  }

  up(p) {
    const s = this.stroke, m = this.machines.excavator;
    this.stroke = null;
    this.app.ui.hideMeasure?.();
    if (!s || !m) return;
    if (p) s.b.copy(p);
    const { app } = this;
    if (m.cycle && m.cycle.phase === 'hold') { m.dumpAt(s.b); app.ui.refresh(); return; }
    if (this._driving()) app.journal.commit(app.clock);
    app.journal.begin('excavate', { a: [+s.a.x.toFixed(4), +s.a.z.toFixed(4)], b: [+s.b.x.toFixed(4), +s.b.z.toFixed(4)] }, app.clock);
    // stroke drawn towards the cab: a = far end; drawn away from it: reverse
    const c = m.slewCenter();
    const da = Math.hypot(s.a.x - c.x, s.a.z - c.z), db = Math.hypot(s.b.x - c.x, s.b.z - c.z);
    const [far, near] = da >= db ? [s.a, s.b] : [s.b, s.a];
    m.startDig(far, near, R(0.25));
    this.settle = 0;
    app.ui.refresh();
  }

  interrupt() { this.stroke = null; this.app.ui.hideMeasure?.(); }

  // undo during a cycle: stop and roll it back
  abort() {
    const m = this.machines.excavator;
    if (!this._digging()) return false;
    if (m) { m.cycle = null; m.bucketPhys.load = 0; m.travelPose(); }
    this.app.particles.items.length = 0;
    this.app.particles.mesh.count = 0;
    this.app.journal.cancel();
    return true;
  }

  // finish what is running (tool switch / redo): the soil drops where it is
  finish() {
    const m = this.machines.excavator;
    if (m && m.cycle) {
      if (m.bucketPhys.load > 0) {
        const tip = m.tipWorld();
        this.app.terrain.deposit(tip.x, tip.z, m.bucketPhys.load, R(0.4));
        m.bucketPhys.load = 0;
      }
      m.cycle = null;
      m.travelPose();
      m.applyJoints(1, true);
    }
    for (const k of Object.keys(this.machines)) { const mm = this.machines[k]; mm.throttle = 0; mm.steer = 0; mm.v = 0; if (mm.manual) mm.manual = { lx: 0, ly: 0, rx: 0, ry: 0 }; }
    if (this._digging() || this._driving()) {
      this.app.particles.flush();
      for (let i = 0; i < 3000 && this.app.terrain.active; i++) this.app.terrain.relax(1);
      this.app.journal.commit(this.app.clock);
    }
  }

  // ---- per frame -------------------------------------------------------------------------------
  update(dt) {
    for (const m of Object.values(this.machines)) m.update(dt);
    const { app } = this;
    const settled = !app.terrain.active && !app.particles.busy;
    if (this._digging()) {
      const m = this.machines.excavator;
      if (!m || !m.cycle) {
        this.settle = settled ? (this.settle || 0) + dt : 0;
        if (this.settle > 0.4) app.journal.commit(app.clock);
      }
    }
    // close the drive action once everything has come to rest
    if (this._driving()) {
      const m = this.machine;
      const mi = m?.manual;
      const input = m && (Math.abs(m.throttle) > 1e-3 || Math.abs(m.steer) > 1e-3 || (mi && (mi.lx || mi.ly || mi.rx || mi.ry)));
      const moving = m && (Math.abs(m.v) > 1e-4 || (m.jointsReached && !m.jointsReached(0.01)) || m.mode === 'dump' || (m.bucketPhys && m.bucketPhys.spilling > 0));
      this.idle = !input && !moving && settled ? this.idle + dt : 0;
      if (this.idle > 0.6) app.journal.commit(app.clock);
    }
  }

  // write live machine poses into the object store (called before each commit)
  sync() {
    this.syncing = true;
    try {
      for (const m of Object.values(this.machines)) {
        if (!m.id || !this.app.objects.get(m.id)) continue;
        const r = m.record();
        const cur = this.app.objects.get(m.id);
        if (JSON.stringify({ ...cur, id: 0 }) !== JSON.stringify({ ...cur, ...r, id: 0 })) this.app.objects.update(m.id, r);
      }
    } finally { this.syncing = false; }
  }

  get excavatorState() {
    const m = this.machines.excavator;
    return m?.cycle ? m.cycle.phase : 'idle';
  }

  busy() { return this._driving() || this._digging() || !!this.stroke; }
}
