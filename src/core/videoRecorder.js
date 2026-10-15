import { Muxer, ArrayBufferTarget } from '../../vendor/mp4-muxer/mp4-muxer.mjs';

// Clean video of the 3D view (no buttons): every rendered frame is copied onto
// a 2D canvas (right after rendering — later the WebGL buffer is already
// cleared) and encoded together with the game's sounds.
//
// Main path: WebCodecs (H.264 + AAC) into an MP4 we assemble ourselves, every
// timestamp counted from the start of the recording. Safari's MediaRecorder
// stamps its MP4 with the phone's uptime, so the Photos app showed videos
// "988 hours" long. MediaRecorder is only the fallback for browsers without
// WebCodecs.
// H.264 first (iPhone hardware, plays everywhere); VP9 only where H.264 cannot be encoded
const CODECS = [['avc1.640028', 'avc'], ['avc1.4d0028', 'avc'], ['avc1.42e028', 'avc'], ['avc1.42001f', 'avc'], ['vp09.00.40.08', 'vp9']];
const MR_TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export class VideoRecorder {
  constructor(app) {
    this.app = app;
    this.on = false;
    this.result = null;    // { blob, seconds, type }
  }

  get webcodecs() { return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'; }
  get supported() { return this.webcodecs || !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream); }
  get recording() { return this.on; }
  get seconds() { return this.on && this.t0 ? (performance.now() - this.t0) / 1000 : 0; }

  async start() {
    if (this.on || !this.supported) return false;
    const src = this.app.renderer.domElement;
    // long side at most 1920 px, even sizes for the encoder
    const k = Math.min(1, 1920 / Math.max(src.width, src.height));
    const c = (this.canvas = document.createElement('canvas'));
    c.width = Math.floor(src.width * k / 2) * 2;
    c.height = Math.floor(src.height * k / 2) * 2;
    this.ctx = c.getContext('2d', { alpha: false });
    this.result = null;
    this.t0 = 0;
    this.on = true;
    try {
      this.mode = this.webcodecs && (await this._startCodecs()) ? 'codecs' : this._startRecorder() ? 'recorder' : null;
    } catch (e) {
      console.error('video', e);
      this.mode = this._startRecorder() ? 'recorder' : null;
    }
    if (!this.mode) { this.on = false; this.ctx = null; return false; }
    return true;
  }

  // ---- WebCodecs + own MP4 ------------------------------------------------------------------
  async _startCodecs() {
    const { width, height } = this.canvas;
    let video = null, vcodec = null;
    for (const [codec, kind] of CODECS) {
      const cfg = { codec, width, height, bitrate: 12e6, framerate: 30, latencyMode: 'realtime', ...(kind === 'avc' ? { avc: { format: 'avc' } } : {}) };
      if ((await VideoEncoder.isConfigSupported(cfg).catch(() => ({}))).supported) { video = cfg; vcodec = kind; break; }
    }
    if (!video) return false;
    // sound: the game's sound graph, tapped sample by sample
    const sfx = this.app.sfx;
    sfx.unlock();
    let audio = null;
    if (typeof AudioEncoder !== 'undefined' && sfx.ctx && sfx.enabled) {
      // AAC (plays everywhere); Opus only where AAC cannot be encoded
      for (const [codec, kind] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
        const cfg = { codec, sampleRate: sfx.ctx.sampleRate, numberOfChannels: 2, bitrate: 160000 };
        if ((await AudioEncoder.isConfigSupported(cfg).catch(() => ({}))).supported) { audio = cfg; this.acodec = kind; break; }
      }
    }
    if (!this.on) return false;   // stopped while we were asking
    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({
      target: this.target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: vcodec, width, height },
      ...(audio ? { audio: { codec: this.acodec, sampleRate: audio.sampleRate, numberOfChannels: 2 } } : {}),
    });
    this.failed = null;
    const fail = (e) => { this.failed = e; console.error('video encoder', e); };
    this.venc = new VideoEncoder({ output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta), error: fail });
    this.venc.configure(video);
    this.nFrames = 0;
    this.lastKey = -1e9;
    if (audio) {
      this.aenc = new AudioEncoder({ output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta), error: fail });
      this.aenc.configure(audio);
      this.samples = 0;
      const tap = (this.tap = sfx.ctx.createScriptProcessor(4096, 2, 2));
      tap.onaudioprocess = (e) => {
        if (!this.t0 || !this.aenc || this.aenc.state !== 'configured') return;
        const b = e.inputBuffer, n = b.length, data = new Float32Array(n * 2);
        data.set(b.getChannelData(0), 0);
        data.set(b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: b.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(this.samples / b.sampleRate * 1e6), data });
        this.samples += n;
        this.aenc.encode(ad);
        ad.close();
      };
      this.mute = sfx.ctx.createGain();
      this.mute.gain.value = 0;                 // the tap must reach the output to run, silently
      sfx.master.connect(tap); tap.connect(this.mute); this.mute.connect(sfx.ctx.destination);
    }
    this.hasAudio = !!audio;
    this.vcodec = vcodec;
    return true;
  }

  _frameCodecs() {
    if (!this.venc || this.venc.state !== 'configured' || this.failed) return;
    const now = performance.now();
    if (!this.t0) this.t0 = now;
    const us = Math.round((now - this.t0) * 1000);
    if (this.venc.encodeQueueSize > 3) return;   // the encoder is behind: skip this frame
    const f = new VideoFrame(this.canvas, { timestamp: us });
    const key = us - this.lastKey >= 2e6;        // a keyframe every 2 s
    if (key) this.lastKey = us;
    this.venc.encode(f, { keyFrame: key });
    f.close();
    this.nFrames++;
  }

  async _stopCodecs(seconds) {
    if (this.tap) {
      const sfx = this.app.sfx;
      try { sfx.master.disconnect(this.tap); } catch { /* gone */ }
      this.tap.onaudioprocess = null; this.tap.disconnect(); this.mute.disconnect();
      this.tap = null;
    }
    try {
      await this.venc.flush();
      if (this.aenc) await this.aenc.flush();
    } catch (e) { console.error('video flush', e); }
    this.venc.close();
    if (this.aenc && this.aenc.state !== 'closed') this.aenc.close();
    this.venc = null; this.aenc = null;
    if (!this.nFrames) return null;
    this.muxer.finalize();
    const blob = new Blob([this.target.buffer], { type: 'video/mp4' });
    this.muxer = null; this.target = null;
    return { blob, seconds, type: 'video/mp4', audio: this.hasAudio, codec: this.vcodec };
  }

  // ---- MediaRecorder fallback -------------------------------------------------------------------
  _startRecorder() {
    if (!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream)) return false;
    const stream = this.canvas.captureStream(30);
    const sfx = this.app.sfx;
    sfx.unlock();
    if (sfx.ctx?.createMediaStreamDestination) {
      this.dest = sfx.ctx.createMediaStreamDestination();
      sfx.master.connect(this.dest);
      for (const t of this.dest.stream.getAudioTracks()) stream.addTrack(t);
    }
    this.type = MR_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { ...(this.type ? { mimeType: this.type } : {}), videoBitsPerSecond: 12e6 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.stream = stream;
    return true;
  }

  _stopRecorder(seconds) {
    const rec = this.rec;
    this.rec = null;
    return new Promise((resolve) => {
      const done = () => {
        const type = rec.mimeType || this.type || 'video/webm';
        const r = this.chunks.length ? { blob: new Blob(this.chunks, { type }), seconds, type, audio: !!this.dest } : null;
        this.chunks = [];
        for (const t of this.stream.getTracks()) t.stop();
        if (this.dest) { try { this.app.sfx.master.disconnect(this.dest); } catch { /* already gone */ } this.dest = null; }
        resolve(r);
      };
      if (rec.state === 'inactive') done(); else { rec.onstop = done; rec.stop(); }
    });
  }

  // ---- shared ---------------------------------------------------------------------------------
  // called right after every rendered frame
  frame() {
    if (!this.on || !this.ctx || !this.mode) return;
    const c = this.canvas;
    this.ctx.drawImage(this.app.renderer.domElement, 0, 0, c.width, c.height);
    if (this.mode === 'codecs') this._frameCodecs();
    else if (this.rec && this.rec.state === 'inactive') { this.rec.start(); this.t0 = performance.now(); }  // no timeslice: one clean file
  }

  async stop() {
    if (!this.on) return this.result;
    const seconds = this.seconds;
    this.on = false;
    const mode = this.mode;
    this.mode = null;
    let r = null;
    if (mode === 'codecs') r = await this._stopCodecs(seconds);
    else if (mode === 'recorder') r = await this._stopRecorder(seconds);
    this.ctx = null; this.canvas = null;
    this.result = r;
    return r;
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
