// Everything placed on the plot besides soil: outlines, formwork runs, rebar,
// mesh panels, machines. Plain JSON records keyed by id. While a journal
// action is open, the store remembers each touched record's previous state,
// so the action can be undone/redone and replayed in Blender.
const clone = (r) => (r == null ? null : JSON.parse(JSON.stringify(r)));

export class ObjectStore {
  constructor() {
    this.map = new Map();
    this.nextId = 1;
    this.tx = null;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(id, rec) { this.ver = (this.ver || 0) + 1; for (const fn of this.listeners) fn(id, rec); }

  get(id) { return this.map.get(id) || null; }
  all(type) { const out = []; for (const r of this.map.values()) if (!type || r.type === type) out.push(r); return out; }

  add(rec) {
    rec = clone(rec);
    if (!rec.id) rec.id = this.nextId++;
    else this.nextId = Math.max(this.nextId, rec.id + 1);
    this._track(rec.id);
    this.map.set(rec.id, rec);
    this._emit(rec.id, rec);
    return rec;
  }

  update(id, patch) {
    const cur = this.map.get(id);
    if (!cur) return null;
    this._track(id);
    const rec = { ...cur, ...clone(patch), id };
    this.map.set(id, rec);
    this._emit(id, rec);
    return rec;
  }

  remove(id) {
    if (!this.map.has(id)) return;
    this._track(id);
    this.map.delete(id);
    this._emit(id, null);
  }

  _track(id) {
    if (this.tx && !this.tx.has(id)) this.tx.set(id, clone(this.map.get(id) || null));
  }

  begin() { this.tx = new Map(); }

  // close the transaction → list of { id, before, after } that really changed
  end() {
    const tx = this.tx;
    this.tx = null;
    if (!tx) return null;
    const ops = [];
    for (const [id, before] of tx) {
      const after = clone(this.map.get(id) || null);
      if (JSON.stringify(before) !== JSON.stringify(after)) ops.push({ id, before, after });
    }
    return ops.length ? ops : null;
  }

  // roll back an open transaction
  revert() {
    const tx = this.tx;
    this.tx = null;
    if (!tx) return;
    for (const [id, before] of tx) this._put(id, before);
  }

  apply(ops, forward) {
    for (const o of ops) this._put(o.id, clone(forward ? o.after : o.before));
  }

  _put(id, rec) {
    if (rec) this.map.set(id, rec); else this.map.delete(id);
    this._emit(id, rec);
  }

  toJSON() { return { nextId: this.nextId, items: [...this.map.values()] }; }

  load(data) {
    const ids = [...this.map.keys()];
    this.map.clear();
    for (const id of ids) this._emit(id, null);
    this.nextId = data?.nextId || 1;
    for (const r of data?.items || []) { this.map.set(r.id, r); this._emit(r.id, r); this.nextId = Math.max(this.nextId, r.id + 1); }
  }
}
