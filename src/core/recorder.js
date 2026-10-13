// Samples camera + tool motion (20 Hz while anything moves) on the project
// clock, so Blender can re-shoot exactly what was seen on the phone.
export const TRACK_FIELDS = [
  't',
  'cam_px', 'cam_py', 'cam_pz', 'cam_qx', 'cam_qy', 'cam_qz', 'cam_qw', 'cam_vfov', 'cam_focus',
  'tool_px', 'tool_py', 'tool_pz', 'tool_qx', 'tool_qy', 'tool_qz', 'tool_qw', 'tool_fill', 'tool_type',
];
const F = TRACK_FIELDS.length;

export class Recorder {
  constructor() {
    this.chunks = [];
    this.cur = new Float32Array(F * 1024);
    this.len = 0;
    this.last = null;
    this.interval = 1 / 20;
    this.acc = 0;
  }

  get samples() { return this.chunks.reduce((s, c) => s + c.length / F, 0) + this.len; }
  get duration() { return this.lastT || 0; }

  sample(clock, dt, camera, focus, shovel) {
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc = 0;
    const p = camera.position, q = camera.quaternion, sp = shovel.root.position, sq = shovel.root.quaternion;
    const row = [clock, p.x, p.y, p.z, q.x, q.y, q.z, q.w, camera.fov, focus, sp.x, sp.y, sp.z, sq.x, sq.y, sq.z, sq.w, shovel.fill, shovel.type === 'scoop' ? 1 : 0];
    // skip samples where nothing moved
    if (this.last) {
      let moved = false;
      for (let i = 1; i < F; i++) if (Math.abs(row[i] - this.last[i]) > 2e-5) { moved = true; break; }
      if (!moved) return;
    }
    this.last = row;
    this.lastT = clock;
    if (this.len === 1024) { this.chunks.push(this.cur); this.cur = new Float32Array(F * 1024); this.len = 0; }
    this.cur.set(row, this.len * F);
    this.len++;
  }

  toArray() {
    const n = this.samples;
    const out = new Float32Array(n * F);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    out.set(this.cur.subarray(0, this.len * F), o);
    return out;
  }

  load(arr) {
    this.chunks = [];
    this.cur = new Float32Array(F * 1024);
    this.len = 0;
    this.last = null;
    if (!arr || !arr.length) return;
    this.chunks.push(arr.slice());
    this.lastT = arr[arr.length - F];
  }
}
