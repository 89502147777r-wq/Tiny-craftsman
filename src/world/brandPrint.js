// The maker's print on a material (a roll of membrane, a board of insulation, a mat of wool): our own logo in staggered rows, as a
// real maker prints its name along a roll — the owner, 2026-11-18: no Russian words and no real (Russian) brand on the materials;
// the game's logo instead of «YOUR LOGO» placeholders. Drawn onto the material's canvas once the logo's picture is in; the texture
// is refreshed then.
const IMG = {};
function img(src) {
  if (IMG[src]) return IMG[src];
  const im = new Image(); im.src = src;
  return (IMG[src] = im);
}
// cv: the canvas; tex: its texture (or a function giving it — the cache is set after the canvas is drawn); rows every dy px, a logo
// every dx px along them, every other row shifted by half
export function printLogo(cv, tex, { dark = true, w = 140, dx = 260, dy = 128, y0 = 40, alpha = 0.5, tint = null } = {}) {
  if (typeof Image === 'undefined') return;
  const im = img(`assets/brand/logo-line-${dark ? 'dark' : 'light'}.png`);
  const draw = () => {
    const g = cv.getContext('2d'), h = w * im.naturalHeight / im.naturalWidth;
    // (a print in the maker's ink colour: the logo's shape filled with the tint)
    let src = im;
    if (tint) { const t = document.createElement('canvas'); t.width = Math.ceil(w); t.height = Math.ceil(h); const q = t.getContext('2d'); q.drawImage(im, 0, 0, w, h); q.globalCompositeOperation = 'source-in'; q.fillStyle = tint; q.fillRect(0, 0, w, h); src = t; }
    g.save(); g.globalAlpha = alpha;
    for (let k = 0, y = y0; y < cv.height + h; y += dy, k++) for (let x = (k % 2) * dx / 2 - dx / 2; x < cv.width + w; x += dx) g.drawImage(src, x, y - h / 2, w, h);
    g.restore();
    const t = typeof tex === 'function' ? tex() : tex; if (t) t.needsUpdate = true;
  };
  if (im.complete && im.naturalWidth) draw(); else im.addEventListener('load', draw, { once: true });
}
