// The film pipeline's gate (CLAUDE.md, «Порядок работы над роликом»; the owner, 2026-11-16: «so that no step is skipped»).
// A film's version is the hash of what draws it (its script, the director, the compositor, the styles). Two marks per version,
// in .film-gate/<film>.json (not in git):
//   rules — written by scripts/check-film.mjs when every automatic rule passes on this very version;
//   ok    — written by hand (`node scripts/film-gate.mjs <film> ok "<the analyst's words>"`) only after the analyst (content-analyst)
//           read the no-render run's timeline and said ok.
// scripts/render-film.mjs refuses to draw a version without both. Change the film — both marks are gone for it.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILES = (film) => [`src/film/${film}Film.js`, 'src/film/director.js', 'src/film/compose.js', 'styles.css'];
export function filmHash(film) {
  const h = crypto.createHash('sha1');
  for (const f of FILES(film)) { const p = path.join(root, f); h.update(f + '\0'); if (fs.existsSync(p)) h.update(fs.readFileSync(p)); }
  return h.digest('hex').slice(0, 16);
}
const file = (film) => path.join(root, '.film-gate', `${film}.json`);
const read = (film) => { try { return JSON.parse(fs.readFileSync(file(film), 'utf8')); } catch { return {}; } };
export function mark(film, kind, note = '') {
  const g = read(film), hash = filmHash(film);
  if (g.hash !== hash) { for (const k of Object.keys(g)) delete g[k]; g.hash = hash; }
  g[kind] = { at: new Date().toISOString(), note };
  fs.mkdirSync(path.dirname(file(film)), { recursive: true }); fs.writeFileSync(file(film), JSON.stringify(g, null, 1));
  return hash;
}
export function gate(film) {
  const g = read(film), hash = filmHash(film), miss = [];
  if (g.hash !== hash) miss.push('the film changed since its last check (or was never checked): run `node scripts/check-film.mjs ' + film + '`');
  else {
    if (!g.rules) miss.push('the automatic rules have not all passed on this version: `node scripts/check-film.mjs ' + film + '`');
    if (!g.ok) miss.push('no analyst ok on this version\'s timeline: send it to content-analyst, then `node scripts/film-gate.mjs ' + film + ' ok "<his words>"`');
  }
  return { hash, miss };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [film, kind, note] = process.argv.slice(2);
  if (!film) { console.log('usage: node scripts/film-gate.mjs <film> [ok "<note>"]'); process.exit(1); }
  if (kind === 'ok') {
    const g = read(film), hash = filmHash(film);
    if (g.hash !== hash || !g.rules) { console.log('refused: run check-film on this version first (its rules must pass)'); process.exit(1); }
    mark(film, 'ok', note || ''); console.log('analyst ok recorded for', film, hash);
  } else { const r = gate(film); console.log(film, r.hash, r.miss.length ? '\n- ' + r.miss.join('\n- ') : 'ready to render'); }
}
