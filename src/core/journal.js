// Construction journal: every committed action with the exact terrain change
// it caused (sparse before/after) and the objects it added/changed/removed,
// plus undo/redo. The same records feed the Blender export, so the film can
// be rebuilt step by step.
export class Journal {
  constructor(terrain, objects) {
    this.terrain = terrain;
    this.objects = objects;
    this.done = [];
    this.undone = [];
    this.pending = null;
    this.nextId = 1;
    this.onChange = null;
  }

  begin(type, meta = {}, clock = 0) {
    if (this.pending) this.commit(clock);
    this.pending = { type, meta, t0: clock, snap: this.terrain.snapshot() };
    this.objects.begin();
    return this.pending;
  }

  // Commit the pending action. Returns the record, or null when it changed nothing.
  commit(clock = 0) {
    const p = this.pending;
    if (!p) return null;
    this.onBeforeCommit?.(p);
    this.pending = null;
    const diff = this.terrain.diffFrom(p.snap);
    const objs = this.objects.end();
    if (diff.idx.length === 0 && !objs) return null;
    const rec = { id: this.nextId++, type: p.type, t0: p.t0, t1: clock, meta: p.meta, diff: diff.idx.length ? diff : null, objs };
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
    this.objects.revert();
    this.onChange?.('cancel', null);
  }

  // One-shot action: run fn() inside its own journal entry.
  act(type, meta, clock, fn) {
    this.begin(type, meta, clock);
    try { fn(); } catch (e) { this.cancel(); throw e; }
    return this.commit(clock);
  }

  undo() {
    if (this.pending) { this.cancel(); return { cancelled: true }; }
    const rec = this.done.pop();
    if (!rec) return null;
    if (rec.diff) this.terrain.applyDiff(rec.diff, false);
    if (rec.objs) this.objects.apply(rec.objs, false);
    this.undone.push(rec);
    this.onChange?.('undo', rec);
    return rec;
  }

  redo() {
    const rec = this.undone.pop();
    if (!rec) return null;
    if (rec.diff) this.terrain.applyDiff(rec.diff, true);
    if (rec.objs) this.objects.apply(rec.objs, true);
    this.done.push(rec);
    this.onChange?.('redo', rec);
    return rec;
  }

  get canUndo() { return !!this.pending || this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
}
