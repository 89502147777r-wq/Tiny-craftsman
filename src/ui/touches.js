// The touches shown on the screen (for screen recording: the video shows that it is a game
// played by hand): a dot under each finger while it is down, a ring where it tapped.
// On by default; «Показывать касания» in the menu.
export function showTouches(app) {
  const layer = document.createElement('div');
  layer.id = 'touches';
  document.body.appendChild(layer);
  const dots = new Map(), on = () => app.settings.touches !== false;
  const put = (el, e) => { el.style.left = `${e.clientX}px`; el.style.top = `${e.clientY}px`; };
  const opt = { capture: true, passive: true };
  window.addEventListener('pointerdown', (e) => {
    if (!on()) return;
    const d = dots.get(e.pointerId) || document.createElement('div');
    d.className = 'touch-dot'; put(d, e); layer.appendChild(d); dots.set(e.pointerId, d);
    const r = document.createElement('div'); r.className = 'touch-ring'; put(r, e); layer.appendChild(r);
    setTimeout(() => r.remove(), 520);
  }, opt);
  window.addEventListener('pointermove', (e) => { const d = dots.get(e.pointerId); if (d) put(d, e); }, opt);
  const up = (e) => {
    const d = dots.get(e.pointerId);
    if (!d) return;
    dots.delete(e.pointerId);
    d.classList.add('up');
    setTimeout(() => d.remove(), 300);
  };
  window.addEventListener('pointerup', up, opt);
  window.addEventListener('pointercancel', up, opt);
}
