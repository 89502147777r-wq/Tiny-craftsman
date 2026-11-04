// The film's words (director.js: the step bar, the titles, the big words, the pins, the cards, the
// receipt…) are HTML over the picture; a film shot frame by frame (recorder.js) needs them in the
// video. paintDom draws an element and what is in it onto a 2D canvas the way the browser laid it out:
// the boxes (background, rounded corners, border, shadow), the pictures, the ::after boxes (the bar's
// fill, the finger's ring) and the text word by word where each word stands, in its font, colour and
// shadows. Only what #film's CSS uses: translate / scale (getBoundingClientRect has them), no rotation,
// no masks, no backdrop blur.
const imgs = new Map();
function picture(url) {
  let im = imgs.get(url);
  if (!im) { im = new Image(); im.decoding = 'sync'; im.src = url; imgs.set(url, im); }
  return im.complete && im.naturalWidth ? im : null;
}
const px = (v) => parseFloat(v) || 0;
// a computed colour «rgb(…)» / «rgba(…)»: its alpha (0 — nothing to draw)
const alphaOf = (c) => { if (!c || c === 'transparent') return 0; const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
// computed shadows: «rgba(0, 0, 0, 0.3) 0px 3px 0px, …» (the colour first) → [{ c, x, y, b }]
function shadows(v) {
  if (!v || v === 'none') return [];
  const out = [];
  for (const part of v.split(/,(?![^(]*\))/)) {
    if (/inset/.test(part)) continue;
    const c = (part.match(/rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+(?=\s)/i) || ['rgba(0,0,0,0.5)'])[0];
    const n = part.replace(c, '').trim().split(/\s+/).map(px);
    out.push({ c, x: n[0] || 0, y: n[1] || 0, b: n[2] || 0 });
  }
  return out;
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); rrectPath(ctx, x, y, w, h, r); }
function rrectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
}
const radius = (cs, w, s) => { const v = cs.borderTopLeftRadius; return v.endsWith('%') ? (parseFloat(v) / 100) * w : px(v) * s; };

// a box: x, y, w, h in the canvas's pixels; s — CSS px → canvas px (the element's own scale too)
function box(ctx, cs, x, y, w, h, s, op) {
  if (w < 0.5 || h < 0.5) return;
  const r = radius(cs, w, s), bg = cs.backgroundColor, bi = cs.backgroundImage;
  const fill = alphaOf(bg) > 0, sh = shadows(cs.boxShadow);
  ctx.globalAlpha = op;
  // (a mask of half circles along the bottom — the receipt's torn edge: «circle at Apx 100%, transparent Rpx» every Ppx, from Opx)
  const mk = cs.maskImage || cs.webkitMaskImage || '';
  const tear = /radial-gradient/.test(mk) ? { r: px((mk.match(/(?:transparent|rgba\([^)]*,\s*0\)) ([\d.]+)px/) || [])[1]) * s, a: px((mk.match(/at ([\d.]+)px/) || [])[1]) * s, p: px(((cs.maskSize || cs.webkitMaskSize || '').match(/([\d.]+)px/) || [])[1]) * s, o: px((cs.maskPosition || cs.webkitMaskPosition || '0px').split(' ')[0]) * s } : null;
  if (mk && mk !== 'none') sh.length = 0;   // (a masked box: its shadow is masked away too)
  if (tear && tear.p > 1) ctx.save();
  if (tear && tear.p > 1) {
    ctx.beginPath(); ctx.rect(x - 50 * s, y - 50 * s, w + 100 * s, h + 100 * s);
    for (let cx = x + tear.o + tear.a; cx < x + w + tear.p; cx += tear.p) { ctx.moveTo(cx + tear.r, y + h); ctx.arc(cx, y + h, tear.r, 0, Math.PI * 2); }
    ctx.clip('evenodd');
  }
  if (fill || (bi && bi !== 'none')) {
    rrect(ctx, x, y, w, h, r);
    // (the box's shadows under it: drawn by the fill, the last listed lowest)
    if (fill) {
      // (a box-shadow is outside the box only — under a see-through box nothing: the shape drawn far off,
      // its shadow brought back, clipped to round it)
      if (sh.length) {
        const F = 30000;
        ctx.save(); ctx.beginPath(); ctx.rect(-F, -F, 3 * F, 3 * F); rrectPath(ctx, x, y, w, h, r); ctx.clip('evenodd');
        for (const d of sh.reverse()) { ctx.save(); ctx.shadowColor = d.c; ctx.shadowBlur = d.b * s; ctx.shadowOffsetX = d.x * s - F; ctx.shadowOffsetY = d.y * s; ctx.fillStyle = '#000'; rrect(ctx, x + F, y, w, h, r); ctx.fill(); ctx.restore(); }
        ctx.restore();
        rrect(ctx, x, y, w, h, r);
      }
      ctx.fillStyle = bg; ctx.fill();
    }
    if (bi && bi !== 'none') {
      const u = bi.match(/url\(["']?([^"')]+)["']?\)/);
      if (u) {
        const im = picture(u[1]);
        if (im) {   // (background-size: cover)
          const k = Math.max(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * k, ih = im.naturalHeight * k;
          ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip(); ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); ctx.restore();
        }
      } else if (/radial-gradient/.test(bi)) {
        const cols = bi.match(/rgba?\([^)]*\)/g) || [];
        if (cols.length >= 2) {
          ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.scale(w / 2, h / 2);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
          cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c));
          ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
        }
      }
    }
  }
  if (tear && tear.p > 1) ctx.restore();
  const bw = px(cs.borderTopWidth) * s;
  if (bw > 0.2 && alphaOf(cs.borderTopColor) > 0 && cs.borderTopStyle !== 'none') {
    ctx.lineWidth = bw; ctx.strokeStyle = cs.borderTopColor;
    if (cs.borderTopStyle === 'dashed') ctx.setLineDash([bw * 3, bw * 2]);
    // (only the top dashed? the receipt's lines — a line along the top or the bottom)
    const all = px(cs.borderBottomWidth) > 0 && px(cs.borderLeftWidth) > 0;
    ctx.beginPath();
    if (all) { rrect(ctx, x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, r - bw / 2)); } else { ctx.moveTo(x, y + bw / 2); ctx.lineTo(x + w, y + bw / 2); }
    ctx.stroke(); ctx.setLineDash([]);
  } else {
    const bb = px(cs.borderBottomWidth) * s;
    if (bb > 0.2 && alphaOf(cs.borderBottomColor) > 0 && cs.borderBottomStyle !== 'none') {
      ctx.lineWidth = bb; ctx.strokeStyle = cs.borderBottomColor;
      if (cs.borderBottomStyle === 'dashed') ctx.setLineDash([bb * 3, bb * 2]);
      ctx.beginPath(); ctx.moveTo(x, y + h - bb / 2); ctx.lineTo(x + w, y + h - bb / 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

// the words of a text node, each where the browser put it
const range = typeof document !== 'undefined' ? document.createRange() : null;
function text(ctx, node, cs, o, k, s, op) {
  const str = node.textContent; if (!/\S/.test(str)) return;
  const up = cs.textTransform === 'uppercase', size = px(cs.fontSize) * s * k;
  if (size < 1) return;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size.toFixed(2)}px ${cs.fontFamily}`;
  const ls = px(cs.letterSpacing) * s * k;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${ls.toFixed(2)}px`;
  ctx.fillStyle = cs.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const sh = shadows(cs.textShadow).reverse();
  ctx.globalAlpha = op;
  for (const m of str.matchAll(/\S+/g)) {
    range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
    const rs = range.getClientRects();
    for (const rc of rs) {
      if (rc.width < 0.5) continue;
      const w = up ? m[0].toUpperCase() : m[0];
      const mt = ctx.measureText(w), A = mt.fontBoundingBoxAscent ?? size * 0.8, D = mt.fontBoundingBoxDescent ?? size * 0.2;
      const x = (rc.left - o.left) * k, y = (rc.top - o.top) * k + rc.height * k * (A / (A + D));
      // (the width as laid out: a font a little wider or narrower than the page's — squeezed to fit)
      const sx = mt.width > 0 ? Math.max(0.8, Math.min(1.25, (rc.width * k) / mt.width)) : 1;
      ctx.save();
      ctx.translate(x, y); ctx.scale(sx, 1);
      for (const d of sh) {   // (each shadow alone: the text drawn far away, its shadow brought back)
        ctx.save(); ctx.shadowColor = d.c; ctx.shadowBlur = d.b * s * k; ctx.shadowOffsetX = d.x * s * k - 20000 * sx; ctx.shadowOffsetY = d.y * s * k;
        ctx.fillText(w, 20000, 0); ctx.restore();
      }
      ctx.fillText(w, 0, 0);
      ctx.restore();
    }
  }
}

// a ::after box (the bar's fill: scaleX from the left; the finger's ring: scale from the middle)
function after(ctx, el, r, o, k, s, op) {
  const cs = getComputedStyle(el, '::after');
  if (!cs || !cs.content || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') return;
  const pop = op * (parseFloat(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
  if (pop < 0.004) return;
  const L = px(cs.left) * s, T = px(cs.top) * s, R = px(cs.right) * s, B = px(cs.bottom) * s;
  let x = (r.left - o.left) * k + L * k, y = (r.top - o.top) * k + T * k, w = r.width * k - (L + R) * k, h = r.height * k - (T + B) * k;
  const m = cs.transform && cs.transform !== 'none' ? cs.transform.match(/matrix\(([^)]+)\)/) : null;
  if (m) {
    const [a, , , d] = m[1].split(',').map(Number), org = cs.transformOrigin.split(' ').map(px);
    const ox = x + org[0] * s * k, oy = y + (org[1] ?? 0) * s * k;
    x = ox + (x - ox) * a; y = oy + (y - oy) * d; w *= a; h *= d;
  }
  box(ctx, cs, x, y, w, h, s * k, pop);
}

// (a see-through element is drawn whole onto a layer, then the layer onto the picture as see-through as
// it is: its text over its own shadow stays the text's colour — CSS's group opacity)
const layers = [];
function layer(d, w, h) {
  let c = layers[d];
  if (!c || c.width !== w || c.height !== h) c = layers[d] = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.clearRect(0, 0, w, h);
  return x;
}
// el and all in it onto ctx; o — the rect of the frame's box (CSS px); k — canvas px per CSS px
export function paintDom(ctx, el, o, k, op = 1, s0 = 1, depth = 0, flat = false) {
  const cs = getComputedStyle(el);
  if (cs.display === 'none') return;
  const own = parseFloat(cs.opacity);
  if (!(own * op > 0.004)) return;
  if (own < 0.99 && !flat && depth < 6) {
    const lx = layer(depth + 1, ctx.canvas.width, ctx.canvas.height);
    paintDom(lx, el, o, k, 1 / own, s0, depth + 1, true);   // (its own opacity undone inside: drawn at full, then faded as one)
    ctx.save(); ctx.globalAlpha = own * op; ctx.drawImage(lx.canvas, 0, 0); ctx.restore();
    return;
  }
  op *= own;
  const r = el.getBoundingClientRect();
  const s = el.offsetWidth > 0 ? r.width / el.offsetWidth : s0;   // (its scale: a transform's)
  if (cs.visibility !== 'hidden') {
    if (el.tagName === 'IMG') {
      if (el.complete && el.naturalWidth && r.width > 0) {
        const sh = (cs.filter.match(/drop-shadow\((.+)\)/) || [])[1];
        ctx.save(); ctx.globalAlpha = op;
        if (sh) { const d = shadows(sh)[0]; if (d) { ctx.shadowColor = d.c; ctx.shadowBlur = d.b * k; ctx.shadowOffsetX = d.x * k; ctx.shadowOffsetY = d.y * k; } }
        ctx.drawImage(el, (r.left - o.left) * k, (r.top - o.top) * k, r.width * k, r.height * k);
        ctx.restore();
      }
      return;
    }
    box(ctx, cs, (r.left - o.left) * k, (r.top - o.top) * k, r.width * k, r.height * k, s * k, op);
  }
  for (const c of el.childNodes) {
    if (c.nodeType === 1) paintDom(ctx, c, o, k, op, s, depth);
    else if (c.nodeType === 3 && cs.visibility !== 'hidden') text(ctx, c, cs, o, k, s, op);
  }
  if (cs.visibility !== 'hidden') after(ctx, el, r, o, k, s, op);
  ctx.globalAlpha = 1;
}
