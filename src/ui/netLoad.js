// What the game is loading, and how far it is (the owner, 2026-11-25: «текстуры долго прогружаются, и техника — сделай
// неброскую шкалу с процентами, чтобы я видел, когда что и как грузит, а после загрузки чтобы она убиралась»).
// Every file the game asks for goes through an <img> (three's TextureLoader) or fetch (GLTFLoader, HDRLoader, the sounds,
// the json): both are watched here, from the first line of the game on — no loader has to know about it. A file is done
// when the browser has all of it (its resource timing entry: fetch resolves at the headers, a model's body comes after),
// or it failed. While anything is on its way: a thin line at the very top and a small label under it — what kind of
// thing (the kind with the most still on its way), how many of how many files, percent of the files, megabytes in. All done — it fades out. Not in a film (it is not the game's; the recorder never
// paints it anyway: it is outside #film).
import { LANG } from '../i18n/i18n.js';

const KINDS = [
  [/\/assets\/(hdri|backdrops)\//, 'Панорама', 'Panorama'],
  [/\/assets\/models\/(machines|site|operator|joystick)|excavator|loader|truck/i, 'Техника', 'Machines'],
  [/\/assets\/models\//, 'Модели', 'Models'],
  [/\/assets\/textures\//, 'Текстуры', 'Textures'],
  [/\/assets\/sounds\//, 'Звуки', 'Sounds'],
  [/\/vendor\/|\.wasm/, 'Движок', 'Engine'],
  [/./, 'Файлы', 'Files'],
];
const kindOf = (url) => KINDS.find(([re]) => re.test(url));

const pending = new Map(), log = [];   // url → { kind, size, got }
let total = 0, done = 0, bytesGot = 0, el = null, hideT = 0, raf = 0;

const watch = (u) => {
  if (typeof u !== 'string' || !u || /^(data|blob):/.test(u)) return null;
  let url; try { url = new URL(u, location.href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  return url.href;
};
function start(href) {
  if (pending.has(href)) return;
  if (!pending.size) { total = 0; done = 0; bytesGot = 0; }   // (a new batch: the percent from 0)
  pending.set(href, { kind: kindOf(href), size: 0, t: performance.now() });
  if (log.length < 400) log.push(['+', Math.round(performance.now()), href.replace(location.origin, '')]);
  total++; show();
}
function finish(href, size = 0) {
  const p = pending.get(href); if (!p) return;
  pending.delete(href); done++;
  if (log.length < 400) log.push(['-', Math.round(performance.now()), href.replace(location.origin, ''), size]);
  bytesGot += size;
  show();
}

// <img>: three's ImageLoader sets .src on an image element
const D = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
if (D?.set) Object.defineProperty(HTMLImageElement.prototype, 'src', {
  ...D,
  set(v) {
    const h = watch(v);
    if (h) {
      start(h);
      const end = () => { this.removeEventListener('load', end); this.removeEventListener('error', end); finish(h, sizeOf(h)); };
      this.addEventListener('load', end); this.addEventListener('error', end);
    }
    D.set.call(this, v);
  },
});
// fetch: done when its body is all in (the resource timing entry), or it failed
const F = window.fetch?.bind(window);
if (F) window.fetch = function (input, init) {
  const h = watch(typeof input === 'string' ? input : input?.url);
  const p = F(input, init);
  if (h) {
    start(h);
    p.then((r) => { if (!r.ok) finish(h); else setTimeout(() => finish(h), 60000); }, () => finish(h));   // (a safety: never stuck)
  }
  return p;
};
const sizeOf = (h) => { const e = performance.getEntriesByName(h).pop(); return e ? (e.encodedBodySize || e.transferSize || 0) : 0; };
try {
  performance.setResourceTimingBufferSize?.(2000);
  new PerformanceObserver((list) => { for (const e of list.getEntries()) if (pending.has(e.name)) finish(e.name, e.encodedBodySize || e.transferSize || 0); })
    .observe({ type: 'resource', buffered: true });
} catch { /* no resource timing: fetches end by their safety timeout */ }

function show() {
  if (raf) return;
  raf = requestAnimationFrame(draw);
}
function draw() {
  raf = 0;
  if (!el) {
    if (!document.body) { show(); return; }
    const st = document.createElement('style');
    st.textContent = `#netload{position:fixed;left:0;right:0;top:0;z-index:9999;pointer-events:none;transition:opacity .6s}
#netload:not(.off){transition:none}#netload.off{opacity:0}#netload>i{display:block;height:2px;width:0;background:rgba(255,190,90,.85);transition:width .25s}
#netload>span{position:absolute;right:10px;top:calc(env(safe-area-inset-top,0px) + 4px);font:500 10px/1.5 system-ui,sans-serif;
color:rgba(255,255,255,.82);background:rgba(20,16,12,.38);padding:0 7px;border-radius:8px;white-space:nowrap;letter-spacing:.02em}
body.rec #netload,body.film #netload{display:none}`;
    document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'netload'; el.setAttribute('data-notr', '');
    el.innerHTML = '<i></i><span></span>';
    document.body.appendChild(el);
  }
  if (window.__tc?.filmMode) { el.classList.add('off'); return; }
  // (the label under the top buttons, at the right — not over the logo, the buttons, the notch)
  const bar = document.querySelector('.top-actions'), r = bar && bar.offsetParent && bar.getBoundingClientRect();
  el.lastChild.style.top = r && r.bottom > 0 ? `${Math.round(r.bottom + 6)}px` : '';
  const left = pending.size;
  const pct = Math.round(100 * (left ? done / Math.max(1, total) : 1));
  el.firstChild.style.width = `${pct}%`;
  if (left) {
    clearTimeout(hideT); el.classList.remove('off');
    const by = new Map(); for (const p of pending.values()) by.set(p.kind, (by.get(p.kind) || 0) + 1);
    const k = [...by.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const name = LANG === 'en' ? k[2] : k[1];
    const mb = bytesGot > 2e5 ? ` · ${(bytesGot / 1048576).toFixed(1)} ${LANG === 'en' ? 'MB' : 'МБ'}` : '';
    el.lastChild.textContent = `${name} ${done}/${total} · ${pct} %${mb}`;
  } else {
    el.lastChild.textContent = `${LANG === 'en' ? 'Loaded' : 'Загружено'} ${total} · 100 %`;
    clearTimeout(hideT); hideT = setTimeout(() => el.classList.add('off'), 900);
  }
}
// (for the tests: what is on its way)
export const netLoad = { log, start, finish, get pending() { return [...pending.keys()]; }, get total() { return total; }, get done() { return done; }, get shown() { return !!el && !el.classList.contains('off'); } };
