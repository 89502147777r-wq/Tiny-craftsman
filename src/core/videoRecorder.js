// Clean video of the 3D view (no buttons): every rendered frame is copied onto
// a 2D canvas whose stream goes to a MediaRecorder, together with the game's
// sounds. Copying right after rendering works without preserveDrawingBuffer
// (Safari records a WebGL canvas directly only with it, which costs speed).
const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export class VideoRecorder {
  constructor(app) {
    this.app = app;
    this.rec = null;
    this.result = null;    // { blob, seconds, type }
  }

  get supported() {
    return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  }

  get recording() { return !!this.rec; }
  get seconds() { return this.rec ? (performance.now() - this.t0) / 1000 : 0; }

  start() {
    if (this.rec || !this.supported) return false;
    const src = this.app.renderer.domElement;
    // long side at most 1920 px, even sizes for the encoder
    const k = Math.min(1, 1920 / Math.max(src.width, src.height));
    const c = (this.canvas = document.createElement('canvas'));
    c.width = Math.floor(src.width * k / 2) * 2;
    c.height = Math.floor(src.height * k / 2) * 2;
    // (no copy here: outside the frame loop the WebGL buffer is already cleared — the
    // first video frame would be black)
    this.ctx = c.getContext('2d', { alpha: false });
    const stream = c.captureStream(30);
    const sfx = this.app.sfx;
    sfx.unlock();
    if (sfx.ctx?.createMediaStreamDestination) {
      this.dest = sfx.ctx.createMediaStreamDestination();
      sfx.master.connect(this.dest);
      for (const t of this.dest.stream.getAudioTracks()) stream.addTrack(t);
    }
    this.type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { ...(this.type ? { mimeType: this.type } : {}), videoBitsPerSecond: 12e6 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.stream = stream;
    this.waiting = true;   // the recorder starts on the first copied frame (no black frame)
    this.t0 = performance.now();
    this.result = null;
    return true;
  }

  // called right after every rendered frame
  frame() {
    if (!this.ctx) return;
    const c = this.canvas;
    this.ctx.drawImage(this.app.renderer.domElement, 0, 0, c.width, c.height);
    if (this.waiting) { this.waiting = false; this.rec.start(1000); this.t0 = performance.now(); }
  }

  stop() {
    const rec = this.rec;
    if (!rec) return Promise.resolve(this.result);
    const seconds = this.seconds;
    this.rec = null;
    this.waiting = false;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || this.type || 'video/webm';
        this.result = { blob: new Blob(this.chunks, { type }), seconds, type };
        this.chunks = [];
        for (const t of this.stream.getTracks()) t.stop();
        if (this.dest) { try { this.app.sfx.master.disconnect(this.dest); } catch { /* already gone */ } this.dest = null; }
        this.ctx = null; this.canvas = null;
        resolve(this.result);
      };
      if (rec.state === 'inactive') rec.onstop(); else rec.stop();
    });
  }

  // must run inside a tap (iOS allows the share sheet only then)
  async save() {
    const r = this.result;
    if (!r) return;
    const ext = r.type.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = new File([r.blob], `tiny-craftsman-${stamp}.${ext}`, { type: r.type.split(';')[0] });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  discard() { this.result = null; }
}
