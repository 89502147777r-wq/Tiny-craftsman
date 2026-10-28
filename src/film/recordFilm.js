import { Muxer, ArrayBufferTarget } from '../../vendor/mp4-muxer/mp4-muxer.mjs';

// The film recorded on the device it plays on (its GPU draws it, WebCodecs encodes it): frame by frame
// on the film's own clock — a frame drawn slowly is still one 30th of the film — each frame the 3D
// picture with the words of the film painted over it (they are HTML: painted from their layout), the
// H.264 chunks kept and put into an MP4 at the end, the hook moved to the front (as the renderer's cut).
// Run inside rec.html's frame (a 360 × 640 phone's screen): it reports to the page (postMessage).
const post = (m) => { try { parent.postMessage({ tcRec: true, ...m }, '*'); } catch { /* not framed */ } };

export async function recordFilm(app, { fps = 30, bitrate = 7e6, max = 120 } = {}) {
  if (typeof VideoEncoder === 'undefined') { post({ error: 'no-webcodecs' }); return; }
  const src = app.renderer.domElement, W = src.width & ~1, H = src.height & ~1;
  const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
  const ctx = comp.getContext('2d');
  const chunks = []; let meta0 = null, failed = null;
  const enc = new VideoEncoder({
    output: (c, meta) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push({ key: c.type === 'key', data: b }); if (meta?.decoderConfig && !meta0) meta0 = meta; },
    error: (e) => { failed = e; },
  });
  // (the codec: High, then Main, then Baseline — whichever the device can do at this size)
  let cfg = null;
  for (const codec of ['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.42e033', 'avc1.42e01f']) {
    const c = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch { /* next */ }
  }
  if (!cfg) { post({ error: 'no-h264' }); return; }
  enc.configure(cfg);
  const film = app.film, k2 = W / window.innerWidth, marks = {}, t0 = performance.now();
  let k = 0, seen = 0;
  for (;;) {
    app.filmStep(1 / fps, 0, true);
    // (a new mark: the frame starts a part the cut may move — it is a keyframe)
    const now = Object.keys(film.marks || {});
    let key = k === 0 || k % (fps * 2) === 0;
    if (now.length > seen) { for (const n of now) if (!(n in marks)) marks[n] = k; seen = now.length; key = true; }
    drawFrame(ctx, src, film, k2, W, H);
    const f = new VideoFrame(comp, { timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps) });
    enc.encode(f, { keyFrame: key });
    f.close();
    k++;
    if (failed) { post({ error: String(failed.message || failed) }); return; }
    if (k % 6 === 0) post({ frame: k, t: film.t, sec: (performance.now() - t0) / 1000 });
    while (enc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 4));
    await new Promise((r) => setTimeout(r, 0));
    if (film.done || film.t > max) break;
  }
  await enc.flush(); enc.close();
  // the cut: [hook … hookEnd) first, then [start … hook)
  let order = chunks.map((_, i) => i);
  if (marks.hook != null && marks.hookEnd != null && marks.hookEnd > marks.hook) order = [...order.slice(marks.hook, marks.hookEnd), ...order.slice(0, marks.hook)];
  const mux = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  const dur = 1e6 / fps;
  order.forEach((i, n) => mux.addVideoChunkRaw(chunks[i].data, chunks[i].key ? 'key' : 'delta', Math.round(n * dur), Math.round(dur), n === 0 ? meta0 : undefined));
  mux.finalize();
  const blob = new Blob([mux.target.buffer], { type: 'video/mp4' });
  post({ done: true, frames: order.length, sec: (performance.now() - t0) / 1000, blob, w: W, h: H });
}

// one frame: the 3D picture (with the cut's blur and zoom, which the film puts on the canvas as CSS),
// then the film's words over it
function drawFrame(ctx, src, film, k, W, H) {
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const st = film.canvas?.style, m = /scale\(([\d.]+)\)/.exec(st?.transform || ''), b = /blur\(([\d.]+)px\)/.exec(st?.filter || ''), s = m ? +m[1] : 1;
  if (b) ctx.filter = `blur(${(+b[1] * k).toFixed(1)}px)`;
  ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
  ctx.drawImage(src, 0, 0, W, H);
  ctx.restore();
  paintDom(ctx, film.el, k);
}

// ---- the words: painted from the page's own layout ---------------------------------------------------
const NONE = 'rgba(0, 0, 0, 0)';
function shadowOf(v) {
  // the first of a shadow list: «rgba(…) x y blur» or «x y blur rgba(…)»
  if (!v || v === 'none') return null;
  const first = v.split(/,(?![^(]*\))/)[0], col = (/rgba?\([^)]*\)|#\w+/.exec(first) || ['rgba(0,0,0,0.5)'])[0], nums = first.replace(col, '').trim().split(/\s+/).map(parseFloat).filter((x) => !Number.isNaN(x));
  return { col, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0 };
}
function rrect(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
export function paintDom(ctx, root, k) {
  if (!root) return;
  const walk = (el, op) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return;
    const o = op * parseFloat(cs.opacity || '1');
    if (o < 0.01) return;
    const r = el.getBoundingClientRect(), sc = el.offsetWidth ? r.width / el.offsetWidth : 1;
    if (r.width > 0 && r.height > 0) {
      ctx.save(); ctx.globalAlpha = o;
      const bg = cs.backgroundColor, rad = parseFloat(cs.borderTopLeftRadius) * sc * k || 0;
      if (cs.backgroundImage.includes('gradient')) {
        const g = ctx.createRadialGradient((r.left + r.width / 2) * k, (r.top + r.height / 2) * k, 0, (r.left + r.width / 2) * k, (r.top + r.height / 2) * k, Math.max(r.width, r.height) * 0.7 * k);
        g.addColorStop(0, 'rgba(8,10,14,0.3)'); g.addColorStop(1, 'rgba(8,10,14,0.72)'); ctx.fillStyle = g; ctx.fillRect(r.left * k, r.top * k, r.width * k, r.height * k);
      }
      if (bg && bg !== NONE && bg !== 'transparent') {
        const sh = shadowOf(cs.boxShadow);
        if (sh) { ctx.shadowColor = sh.col; ctx.shadowOffsetX = sh.x * k; ctx.shadowOffsetY = sh.y * k; ctx.shadowBlur = sh.blur * k; }
        ctx.fillStyle = bg; rrect(ctx, r.left * k, r.top * k, r.width * k, r.height * k, rad); ctx.fill();
      }
      if (el.tagName === 'IMG' && el.complete) { ctx.shadowColor = 'transparent'; try { ctx.drawImage(el, r.left * k, r.top * k, r.width * k, r.height * k); } catch { /* not loaded */ } }
      ctx.restore();
    }
    // the text of this element: each text node, over its line boxes
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((q) => q.width > 0);
      if (!rects.length) continue;
      ctx.save(); ctx.globalAlpha = o;
      const fs = parseFloat(cs.fontSize) * sc * k;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fs.toFixed(1)}px ${cs.fontFamily}`;
      ctx.fillStyle = cs.color; ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx && cs.letterSpacing !== 'normal') ctx.letterSpacing = `${(parseFloat(cs.letterSpacing) * sc * k).toFixed(2)}px`;
      const sh = shadowOf(cs.textShadow);
      if (sh) { ctx.shadowColor = sh.col; ctx.shadowOffsetX = sh.x * sc * k; ctx.shadowOffsetY = sh.y * sc * k; ctx.shadowBlur = sh.blur * sc * k; }
      let text = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (cs.textTransform === 'uppercase') text = text.toUpperCase();
      // (wrapped over several lines: the words dealt out by the lines' widths)
      const words = text.split(' '), lines = [];
      if (rects.length === 1) lines.push(text);
      else { let wi = 0; for (const q of rects) { let line = ''; while (wi < words.length) { const t = line ? line + ' ' + words[wi] : words[wi]; if (line && ctx.measureText(t).width > q.width * k * 1.02) break; line = t; wi++; } lines.push(line); } if (wi < words.length) lines[lines.length - 1] += ' ' + words.slice(wi).join(' '); }
      rects.forEach((q, i) => { if (lines[i]) ctx.fillText(lines[i], q.left * k, (q.top + q.height / 2) * k); });
      ctx.restore();
    }
    for (const c of el.children) walk(c, o);
  };
  walk(root, 1);
}
