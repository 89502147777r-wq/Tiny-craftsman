// Construction journal: every committed action with the exact terrain change
// it caused (sparse before/after), plus undo/redo. The same records feed the
// Blender export, so the film can be rebuilt step by step.
export class Journal {
  constructor(terrain) {
    this.terrain = terrain;
    this.done = [];
    this.undone = [];
    this.pending = null;
    this.nextId = 1;
    this.onChange = null;
  }

  begin(type, meta = {}, clock = 0) {
    if (this.pending) this.commit(clock);
    this.pending = { type, meta, t0: clock, snap: this.terrain.snapshot(), extra: null };
    return this.pending;
  }

  // Commit the pending action. Returns the record, or null when it changed nothing.
  commit(clock = 0) {
    const p = this.pending;
    if (!p) return null;
    this.pending = null;
    const diff = this.terrain.diffFrom(p.snap);
    const noTerrain = diff.idx.length === 0;
    if (noTerrain && !p.extra) return null;
    const rec = { id: this.nextId++, type: p.type, t0: p.t0, t1: clock, meta: p.meta, diff: noTerrain ? null : diff, extra: p.extra };
    this.done.push(rec);
    this.undone.length = 0;
    this.onChange?.('commit', rec);
    return rec;
  }

  cancel() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.terrain.restore(p.snap);
    this.onChange?.('cancel', null);
  }

  // Non-terrain actions (e.g. moving the setting-out) carry before/after state.
  record(type, before, after, clock = 0) {
    if (this.pending) this.commit(clock);
    const rec = { id: this.nextId++, type, t0: clock, t1: clock, meta: {}, diff: null, extra: { before, after } };
    this.done.push(rec);
    this.undone.length = 0;
    this.onChange?.('commit', rec);
    return rec;
  }

  undo() {
    if (this.pending) { this.cancel(); return { cancelled: true }; }
    const rec = this.done.pop();
    if (!rec) return null;
    if (rec.diff) this.terrain.applyDiff(rec.diff, false);
    this.undone.push(rec);
    this.onChange?.('undo', rec);
    return rec;
  }

  redo() {
    const rec = this.undone.pop();
    if (!rec) return null;
    if (rec.diff) this.terrain.applyDiff(rec.diff, true);
    this.done.push(rec);
    this.onChange?.('redo', rec);
    return rec;
  }

  get canUndo() { return !!this.pending || this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
}
