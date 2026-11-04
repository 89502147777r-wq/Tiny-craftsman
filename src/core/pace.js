// When a frame is drawn. While anything moves (a finger, the camera, a machine, the soil, the orbit) the
// picture is drawn at a steady cadence: every display frame up to 60 a second — on a 120 Hz screen every other
// one, never «sometimes one, sometimes two» (a threshold in milliseconds against frames that come with a little
// jitter drew them 33 and 50 ms apart in turn: the camera, moved by the clock, jerked); still, twice a second.
// fi — the display's frame interval (ms, kept by Pace from the frames' timestamps).
export class Pace {
  constructor() { this.fi = 1000 / 60; this.last = null; this.lastDraw = -1e9; this.since = 0; }
  // the display's next frame came at now (ms): is it drawn? live — something moves
  due(now, live) {
    if (this.last != null) { const d = now - this.last; if (d > 2 && d < 60) this.fi += (d - this.fi) * 0.05; }
    this.last = now; this.since++;
    // (moving: every n-th display frame, n by the display's rate — counted, so a frame a little early or
    // late does not drop the next one; still: by the clock)
    const n = Math.max(1, Math.floor((1000 / 60 + 1) / this.fi));
    const go = live ? this.since >= n : now - this.lastDraw >= 480 - this.fi * 0.5;
    if (go) { this.fd = now - this.lastDraw; this.lastDraw = now; this.since = 0; }
    return go;
  }
}
