// A film shot in the game frame by frame (the phone's own video encoder, WebCodecs): each frame is
// exactly a 60th of the film however long the phone takes to draw it — no frame dropped, no jerk, the
// best quality (the picture 1080×1920, the shadows, every step of the work). The film's words
// (director.js's HTML) are painted into each frame (compose.js); the sounds go on the film's clock
// into an offline context (audio/sfx.js) and are rendered at the end. The hook («hook» … «hookEnd»,
// marked at the end of the film) is put first, as scripts/render-film.mjs does: the frames are kept
// encoded, a key frame where the hook starts, and the mp4 made of them in the new order (mp4-muxer).
import { Muxer, ArrayBufferTarget } from '../../vendor/mp4-muxer/mp4-muxer.mjs';
import { paintDom } from './compose.js';
import { LANG } from '../i18n/i18n.js';

export const canRecord = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
const L = (ru, en) => (LANG === 'en' ? en : ru);
const tick = () => new Promise((r) => setTimeout(r, 0));

async function videoConfig(w, h, fps) {
  const bitrate = fps > 30 ? 10e6 : 7e6;   // (YouTube's 1080p: 8–12 Mbit/s)
  for (const codec of ['avc1.64002A', 'avc1.4D402A', 'avc1.42E02A', 'avc1.640028', 'avc1.4D4028', 'avc1.42001F']) {
    const c = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) return c; } catch { /* next */ }
  }
  return null;
}
async function audioConfig(rate) {
  if (typeof AudioEncoder !== 'function') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const c = { codec, sampleRate: rate, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(c)).supported) return { c, mux }; } catch { /* next */ }
  }
  return null;
}
// a WAV of the sound (the phone can not encode it into the mp4: given beside it)
function wav(ch, rate) {
  const n = ch[0].length, b = new DataView(new ArrayBuffer(44 + n * 4));
  const s = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); b.setUint32(4, 36 + n * 4, true); s(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 2, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 4, true); b.setUint16(32, 4, true); b.setUint16(34, 16, true); s(36, 'data'); b.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < 2; c++, o += 2) b.setInt16(o, Math.max(-1, Math.min(1, ch[c][i])) * 0x7fff, true);
  return new Blob([b.buffer], { type: 'audio/wav' });
}

// app: the game (film mode, the director made, its gate gone); o: { fps, w, h, max (s of film at most), onProgress(info) }
// → { blob (mp4), wav (when the sound is not in it), seconds, frames }
export async function recordFilm(app, o = {}) {
  const f = app.film, fps = o.fps || 60, W = o.w || 1080, H = o.h || 1920, RATE = 48000;
  const MAX = o.max || Math.ceil((f.estimate || 40) * 1.4 + 10);   // (s of film at most: the sound's buffer is that long)
  const vc = await videoConfig(W, H, fps);
  if (!vc) throw new Error('no H.264 encoder');
  // the frame's box on the screen: 9:16 in the middle; the canvas drawn at the video's size
  app.filmOffline = true;   // (main.js's frame loop steps the film no more: here, a 60th a frame)
  const bw = Math.min(innerWidth, innerHeight * W / H), bh = bw * H / W;
  app.recBox = { w: W, h: H, cssW: bw, cssH: bh, left: (innerWidth - bw) / 2, top: (innerHeight - bh) / 2 };
  const root = document.documentElement.style;
  root.setProperty('--rec-w', `${bw}px`); root.setProperty('--rec-h', `${bh}px`); root.setProperty('--rec-l', `${app.recBox.left}px`); root.setProperty('--rec-t', `${app.recBox.top}px`);
  document.body.classList.add('rec');
  app.resize();
  // the sound on the film's clock (a frame's sounds at the frame's start)
  await app.sfx.offline(MAX + 2, () => Math.max(0, f.t - 1 / fps), RATE);
  // (the pictures the words use: loaded before — a frame does not wait for them)
  await Promise.all(['assets/brand/logo-line-dark.png', 'assets/brand/logo-stack-light.png', ...[...f.el.querySelectorAll('img')].map((m) => m.src)].map((u) => new Promise((r) => { const m = new Image(); m.onload = m.onerror = r; m.src = u; })));
  const out = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = out.getContext('2d', { alpha: false });
  const gl = app.renderer.domElement, k = W / bw;
  // the frames, kept encoded (by the frame's number)
  const chunks = []; let vmeta = null, err = null;
  const enc = new VideoEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); chunks.push({ d, key: c.type === 'key', i: Math.round(c.timestamp * fps / 1e6) }); if (m?.decoderConfig && !vmeta) vmeta = m; }, error: (e) => { err = e; } });
  enc.configure(vc);
  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* not given */ }
  const t0 = performance.now();
  let hs = -1, he = -1, i = 0, lastKey = 0, n = 0;
  try {
    for (; ; i++) {
      if (err) throw err;
      app.filmStep(1 / fps, f.t, true);
      // the picture (a cut's blur and zoom punch as the director set them on the canvas), then the words
      const lk = f.look || { blur: 0, scale: 1 };
      ctx.filter = lk.blur > 0.2 && 'filter' in ctx ? `blur(${(lk.blur * k).toFixed(1)}px)` : 'none';
      const sc = lk.scale || 1;
      ctx.drawImage(gl, (W - W * sc) / 2, (H - H * sc) / 2, W * sc, H * sc);
      ctx.filter = 'none';
      paintDom(ctx, f.el, { left: app.recBox.left, top: app.recBox.top }, k);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      // (the hook: from the frame its mark is set in — what comes with the mark, a title, a blow, is in it;
      // the film ends where the hook does: that frame is not in the video)
      if (hs < 0 && f.marks?.hook != null) hs = i;
      if (he < 0 && f.marks?.hookEnd != null) { he = i; break; }
      const key = i === 0 || i === hs || i - lastKey >= fps * 2;
      if (key) lastKey = i;
      const vf = new VideoFrame(out, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: key }); vf.close();
      n = i + 1;
      o.onFrame?.(ctx, i);   // (the tests: the frame as it went into the video)
      if (f.done || f.t >= MAX) break;
      while (enc.encodeQueueSize > 3) await tick();
      if (i % 3 === 0) { o.onProgress?.({ t: f.t, frames: n, sec: (performance.now() - t0) / 1000 }); await new Promise((r) => requestAnimationFrame(r)); }
    }
    await enc.flush();
  } finally { enc.close?.(); wake?.release?.().catch(() => {}); }
  if (err) throw err;
  // the order: the hook, then the film up to it
  const segs = hs > 0 && he > hs ? [[hs, he], [0, hs]] : [[0, n]];
  const total = segs.reduce((a, [p, q]) => a + q - p, 0);
  o.onProgress?.({ t: f.t, frames: n, sec: (performance.now() - t0) / 1000, phase: 'sound' });
  // the sound: rendered, cut the same way
  const buf = await app.sfx.ctx.startRendering();
  const ch = [0, 1].map((c) => { const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)), dst = new Float32Array(Math.round(total * RATE / fps)); let w = 0; for (const [p, q] of segs) { const a = Math.round(p * RATE / fps), b = Math.min(src.length, Math.round(q * RATE / fps)); dst.set(src.subarray(a, b).slice(0, dst.length - w), w);
    // (a join of two parts: 8 ms faded out and in — no click where a sound is cut)
    const F = Math.round(0.008 * RATE), e = Math.min(dst.length, w + (b - a));
    if (segs.length > 1) for (let j = 0; j < F; j++) { const g = j / F; if (w + j < e) dst[w + j] *= w ? g : 1; if (e - 1 - j >= w) dst[e - 1 - j] *= g; }
    w += Math.round((q - p) * RATE / fps); } return dst; });
  const ac = await audioConfig(RATE);
  const achunks = []; let ameta = null;
  if (ac) {
    let aerr = null;
    const aenc = new AudioEncoder({ output: (c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); achunks.push({ d, key: c.type === 'key', ts: c.timestamp, dur: c.duration }); if (m?.decoderConfig && !ameta) ameta = m; }, error: (e) => { aerr = e; } });
    aenc.configure(ac.c);
    for (let a = 0; a < ch[0].length; a += RATE) {
      const len = Math.min(RATE, ch[0].length - a), data = new Float32Array(len * 2);
      data.set(ch[0].subarray(a, a + len), 0); data.set(ch[1].subarray(a, a + len), len);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round(a * 1e6 / RATE), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close?.();
    if (aerr || !achunks.length) achunks.length = 0;
  }
  // the mp4
  const target = new ArrayBufferTarget();
  const mux = new Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: 'avc', width: W, height: H, frameRate: fps }, ...(achunks.length ? { audio: { codec: ac.mux, numberOfChannels: 2, sampleRate: RATE } } : {}) });
  const byI = new Map(chunks.map((c) => [c.i, c]));
  let v = 0, first = true;
  for (const [p, q] of segs) for (let j = p; j < q; j++, v++) {
    const c = byI.get(j); if (!c) continue;
    mux.addVideoChunkRaw(c.d, first || c.key ? 'key' : 'delta', Math.round(v * 1e6 / fps), Math.round(1e6 / fps), first ? vmeta : undefined);
    first = false;
  }
  achunks.forEach((c, j) => mux.addAudioChunkRaw(c.d, c.key ? 'key' : 'delta', c.ts, c.dur, j === 0 ? ameta : undefined));
  mux.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), pcm: ch, rate: RATE, w: W, h: H, fps, wav: achunks.length ? null : wav(ch, RATE), seconds: total / fps, frames: total, took: (performance.now() - t0) / 1000 };
}

// the screens round it: the shooting's progress, then the video — save it, watch it, again, back to the game
export function recordUi(app) {
  const ui = document.createElement('div');
  ui.className = 'rec-ui';
  ui.innerHTML = `<div class="rec-card"><b>${L('Снимаю ролик…', 'Shooting the film…')}</b><div class="rec-bar"><i></i></div><span class="rec-n" data-notr></span><small>${L('Каждый кадр — ровно 1/60 секунды, поэтому видео выйдет идеально плавным. Не блокируйте телефон и не уходите из Safari.', 'Each frame is exactly 1/60 s, so the video comes out perfectly smooth. Keep the phone unlocked and stay in Safari.')}</small></div>`;
  document.body.appendChild(ui);
  const set = (info) => {
    const est = app.film.estimate || 40, u = Math.min(1, info.t / est);
    ui.querySelector('.rec-bar i').style.width = `${(u * 100).toFixed(1)}%`;
    const left = u > 0.03 ? Math.max(0, info.sec * (1 / u - 1)) : 0;
    ui.querySelector('.rec-n').textContent = info.phase === 'sound' ? L('Свожу звук и собираю mp4…', 'Mixing the sound, making the mp4…')
      : L(`Снято ${info.t.toFixed(1)} с ролика · ${Math.floor(info.sec / 60)}:${String(Math.floor(info.sec % 60)).padStart(2, '0')}${left > 5 ? ` · осталось ≈ ${Math.ceil(left / 60)} мин` : ''}`,
        `${info.t.toFixed(1)} s of film shot · ${Math.floor(info.sec / 60)}:${String(Math.floor(info.sec % 60)).padStart(2, '0')}${left > 5 ? ` · ≈ ${Math.ceil(left / 60)} min left` : ''}`);
  };
  const done = (r) => {
    const url = URL.createObjectURL(r.blob), mb = (r.blob.size / 1048576).toFixed(1);
    const file = new File([r.blob], `tiny-craftsman-${app.filmMode}.mp4`, { type: 'video/mp4' });
    ui.innerHTML = `<div class="rec-card done"><b>${L('Ролик готов', 'The film is ready')}</b><video src="${url}" controls playsinline loop></video><span data-notr>${L(`${r.seconds.toFixed(1)} с · ${mb} МБ · ${r.w}×${r.h}, ${r.fps} кадров/с`, `${r.seconds.toFixed(1)} s · ${mb} MB · ${r.w}×${r.h}, ${r.fps} fps`)}</span>${r.wav ? `<small>${L('Звук отдельным файлом: этот телефон не умеет класть его в видео.', 'The sound is a separate file: this phone can not put it into the video.')}</small>` : ''}<div class="rec-btns"><button class="rec-save">💾 ${L('Сохранить видео', 'Save the video')}</button>${r.wav ? `<button class="rec-wav">🔊 ${L('Сохранить звук', 'Save the sound')}</button>` : ''}<button class="rec-again">🔁 ${L('Снять заново', 'Shoot again')}</button><button class="rec-back">← ${L('В игру', 'Back to the game')}</button></div></div>`;
    const save = async (fl, blob) => {
      // (the phone: the share sheet — «Save Video» puts it in Photos; else a download)
      try { if (navigator.canShare?.({ files: [fl] })) { await navigator.share({ files: [fl] }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fl.name }); document.body.appendChild(a); a.click(); a.remove();
    };
    ui.querySelector('.rec-save').onclick = () => save(file, r.blob);
    if (r.wav) ui.querySelector('.rec-wav').onclick = () => save(new File([r.wav], `tiny-craftsman-${app.filmMode}.wav`, { type: 'audio/wav' }), r.wav);
    ui.querySelector('.rec-again').onclick = () => location.reload();
    ui.querySelector('.rec-back').onclick = () => app.film.leave();
    app.filmResult = r;
  };
  const fail = (e) => {
    console.error(e);
    ui.innerHTML = `<div class="rec-card"><b>${L('Не получилось снять', 'Could not shoot it')}</b><small data-notr>${String(e?.message || e)}</small><div class="rec-btns"><button class="rec-back">← ${L('В игру', 'Back to the game')}</button></div></div>`;
    ui.querySelector('.rec-back').onclick = () => app.film.leave();
    app.filmResult = { error: String(e?.message || e) };
  };
  return { set, done, fail, el: ui };
}
