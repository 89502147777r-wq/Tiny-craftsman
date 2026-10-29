// Two languages. The game is written in Russian; in English every line that reaches the screen is
// looked up here as it appears: in the page (a watcher over the DOM — toasts, chips, the measure,
// the menu, the budget), in the dialogs and in the labels drawn into textures. A line built of a
// template (`Стена ${n} выложена`) is matched by its pattern, the parts put in translated as well.
import EN from './en.js';

export let LANG = 'ru';
const CYR = /[А-яЁё]/;

// the templates: '… {0} …' → a regex, longest first (the most specific wins)
const TPL = Object.keys(EN).filter((k) => /\{\d+\}/.test(k)).sort((a, b) => b.length - a.length).map((k) => {
  const ids = [];
  const parts = k.split(/(\{\d+\})/);
  // (two in a row: the first takes all it can, the second may be empty)
  const src = parts.map((p, i) => { const m = /^\{(\d+)\}$/.exec(p); if (!m) return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); ids.push(+m[1]); return parts[i + 1] === '' && parts[i + 2] ? '([\\s\\S]+)' : parts[i - 1] === '' && i > 1 ? '([\\s\\S]*?)' : '([\\s\\S]+?)'; }).join('');
  return { re: new RegExp(`^${src}$`), ids, en: EN[k] };
});
// the plain lines that may sit inside a longer one, longest first
const PARTS = Object.keys(EN).filter((k) => !/\{\d+\}/.test(k) && k.trim().length >= 3).sort((a, b) => b.length - a.length);
const E = '(?![А-яЁё])';   // (\b knows no Cyrillic)
const UNITS = [[`мм${E}`, 'mm'], ['см³', 'cm³'], [`см${E}`, 'cm'], ['м³', 'm³'], ['м²', 'm²'], [`м${E}`, 'm'], ['шт\\.?', 'pcs'], [`мин${E}`, 'min'], [`с${E}`, 's']].map(([u, en]) => [new RegExp(`(\\d)\\s?${u}`, 'g'), `$1 ${en}`]).concat([[/«([^»]*)»/g, '“$1”']]);

const cache = new Map();
function look(s) {
  if (s in EN) return EN[s];
  const t = s.trim().replace(/\s+/g, ' ');
  if (t !== s && t in EN) return s.replace(s.trim(), EN[t]);
  for (const p of TPL) {
    const m = p.re.exec(s);
    if (!m) continue;
    return p.en.replace(/\{(\d+)\}/g, (_, i) => tr(m[1 + p.ids.indexOf(+i)] ?? ''));
  }
  // a name put in a sentence in small letters (грунт → Грунт → Soil → soil)
  const up = s[0].toUpperCase() + s.slice(1);
  if (up !== s && up in EN) return EN[up][0].toLowerCase() + EN[up].slice(1);
  // a mark round the line (➜ …, … ›, ✓ …)
  const m = /^([^А-яЁё\d«(]+)?([\s\S]*?[А-яЁё\d»).%°³²])([^А-яЁё\d»).%°³²]+)?$/.exec(s);
  if (m && (m[1] || m[3]) && CYR.test(m[2])) { const r = look(m[2]); if (r !== null) return (m[1] || '') + r + (m[3] || ''); }
  return null;
}
// a Russian line → English (a line with no Cyrillic only gets its decimal commas made points)
export function tr(s) {
  if (LANG !== 'en' || typeof s !== 'string' || !s) return s;
  if (!CYR.test(s)) return s.replace(/(\d),(\d)/g, '$1.$2');
  let r = cache.get(s);
  if (r !== undefined) return r;
  r = look(s);
  if (r === null) {
    // a line glued of pieces: by its separators, then whatever known lines it holds
    const seg = s.split(/( — | · |\. |: |; |, |\n)/);
    r = seg.length > 1 ? seg.map((x, i) => (i % 2 || !x.trim() ? x : look(x) ?? x)).join('') : s;
    if (CYR.test(r)) for (const k of PARTS) if (r.includes(k)) r = r.split(k).join(EN[k]);
    for (const [re, to] of UNITS) r = r.replace(re, to);
  }
  r = r.replace(/(\d),(\d)/g, '$1.$2');
  if (cache.size > 4000) cache.clear();
  cache.set(s, r);
  if (CYR.test(r)) missed(s);
  return r;
}
// lines still Russian after all that (collected for the tests: window.__i18nMissed)
const MISSED = new Set();
function missed(s) { if (MISSED.size < 500) MISSED.add(s); }

const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
function doNode(n) {
  if (n.nodeType === 3) { const v = n.nodeValue; if (CYR.test(v)) { const r = tr(v); if (r !== v) n.nodeValue = r; } return; }
  if (n.nodeType !== 1 || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.hasAttribute('data-notr')) return;
  for (const a of ATTRS) { const v = n.getAttribute(a); if (v && CYR.test(v)) n.setAttribute(a, tr(v)); }
  for (let c = n.firstChild; c; c = c.nextSibling) doNode(c);
}

// the language: the one chosen in the menu, else the device's (Russian for Russian, English otherwise)
export function initLang(settings) {
  LANG = settings.lang || (/^(ru|be|uk|kk)\b/i.test(navigator.language || '') ? 'ru' : 'en');
  document.documentElement.lang = LANG;
  window.__i18nMissed = MISSED;
  if (LANG !== 'en') return;
  doNode(document.documentElement);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doNode(m.target);
      else if (m.type === 'attributes') doNode(m.target);
      else for (const n of m.addedNodes) doNode(n);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const al = window.alert.bind(window), cf = window.confirm.bind(window);
  window.alert = (s) => al(tr(String(s)));
  window.confirm = (s) => cf(tr(String(s)));
  // the labels printed on materials (a vapour barrier roll, an XPS board…)
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { return ft.call(this, typeof t === 'string' && CYR.test(t) ? tr(t) : t, ...a); };
}
