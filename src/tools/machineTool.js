import { Excavator } from '../world/machines/excavator.js';
import { Tractor } from '../world/machines/tractor.js';
import { ScoopTool } from './scoopTool.js';

// Machines on the plot. The active machine is driven with the on-screen
// joystick; the excavator digs with a finger on the ground (same scoop
// workflow as the shovel), the tractor works its loader with buttons.
// Each drive (from first input to standstill) is one journal action.
export class MachineTool {
  constructor(app) {
    this.app = app;
    this.machines = {};      // kind → Machine
    this.active = null;      // kind
    this.scoop = null;       // ScoopTool for the excavator
    this.idle = 0;
    this.syncing = false;
    app.objects.on((id, rec) => {
      if (this.syncing) return;
      if (rec?.type === 'machine') this._ensure(rec.kind, rec.id).apply(rec);
      else if (!rec) for (const [k, m] of Object.entries(this.machines)) if (m.id === id) this._despawn(k);
    });
  }

  get machine() { return this.active ? this.machines[this.active] : null; }

  _ensure(kind, id) {
    let m = this.machines[kind];
    if (!m) {
      m = kind === 'excavator' ? new Excavator(this.app) : new Tractor(this.app);
      this.machines[kind] = m;
      this.app.scene.add(m.root);
      if (kind === 'excavator') this.scoop = new ScoopTool(this.app, m);
    }
    if (id) m.id = id;
    return m;
  }

  _despawn(kind) {
    const m = this.machines[kind];
    if (!m) return;
    this.app.scene.remove(m.root);
    delete this.machines[kind];
    if (kind === 'excavator') this.scoop = null;
    if (this.active === kind) this.active = null;
  }

  // bring a machine onto the plot (driving in from the near edge)
  select(kind) {
    const { app } = this;
    this.active = kind;
    if (!this.machines[kind] || !this.machines[kind].id) {
      const m = this._ensure(kind);
      const t = app.terrain;
      m.x = kind === 'excavator' ? -t.halfX + m.radius + 0.01 : t.halfX - m.radius - 0.01;
      m.z = t.halfZ - m.radius - 0.01;
      m.yaw = kind === 'excavator' ? 0.6 : Math.PI - 0.6;
      m.followGround(0, true);
      if (m.updateJoints) m.updateJoints(1, true);
      app.journal.act('machine-add', { kind }, app.clock, () => { const r = app.objects.add(m.record()); m.id = r.id; });
    }
    app.focusPoint = null;
    app.rig.lookAtPoint(this.machine.root.position.clone().setY(this.machine.y + 0.04));
    app.ui.refresh();
  }

  // ---- input ---------------------------------------------------------------------------------
  joystick(x, y) {
    const m = this.machine;
    if (!m) return;
    if ((x || y) && !this._driving()) this.app.journal.begin('drive', { kind: m.kind }, this.app.clock);
    m.throttle = -y; m.steer = x;
    this.idle = 0;
  }

  loader(mode) {
    const m = this.machine;
    if (!m || m.kind !== 'tractor') return;
    if (!this._driving()) this.app.journal.begin('drive', { kind: m.kind, loader: mode }, this.app.clock);
    m.setBucket(mode);
    this.idle = 0;
    this.app.ui.refresh();
  }

  blade() {
    const m = this.machine;
    if (!m || m.kind !== 'excavator') return;
    if (!this._driving()) this.app.journal.begin('drive', { kind: m.kind, blade: true }, this.app.clock);
    m.t.blade = m.t.blade > 0.5 ? 0 : 1;
    this.idle = 0;
    this.app.ui.refresh();
  }

  _driving() { return this.app.journal.pending?.type === 'drive'; }

  // ground gestures: only the excavator uses them (digging)
  down(p) {
    if (this.active !== 'excavator' || !this.scoop) return false;
    if (this._driving()) this.app.journal.commit(this.app.clock);
    this.scoop.down(p);
    return true;
  }
  move(p) { if (this.active === 'excavator' && this.scoop) this.scoop.move(p); }
  up() { if (this.active === 'excavator' && this.scoop) this.scoop.up(); this.app.ui.refresh(); }
  interrupt() { if (this.scoop) this.scoop.interrupt(); }

  // ---- per frame -------------------------------------------------------------------------------
  update(dt) {
    for (const m of Object.values(this.machines)) m.update(dt);
    if (this.scoop) this.scoop.update(dt);
    // close the drive action once everything has come to rest
    if (this._driving()) {
      const m = this.machine;
      const still = !m || (Math.abs(m.throttle) < 1e-3 && Math.abs(m.v) < 1e-4 && m.mode !== 'dump');
      this.idle = still && !this.app.terrain.active && !this.app.particles.busy ? this.idle + dt : 0;
      if (this.idle > 0.6) this.app.journal.commit(this.app.clock);
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

  busy() { return this._driving() || (this.scoop && this.scoop.busy); }
}
