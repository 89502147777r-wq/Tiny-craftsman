// Renders a film of the game (src/film/) to frames and an mp4, frame by frame (any speed of the
// machine gives a smooth 30 fps video). Usage:
//   node scripts/render-film.mjs found out/ [--w 540 --h 960 --dsf 2 --fps 30 --quality high --every 1 --max 90]
// (--every N keeps every Nth frame only: a quick preview; --max: seconds of film at most)
// A film drawn frame by frame is the same every run (main.js: the dice seeded), so it can be drawn
// in parts and taken up again: --part i/n draws every frame k with k % n === i (the rest only run,
// not drawn); frames already on disk are not drawn again; --assemble only cuts the mp4 from them.
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const film = argv[0] || 'found', out = path.resolve(argv[1] || 'film-out');
// (the pipeline's gate: no render of a version without its rules passed and the analyst's ok — scripts/film-gate.mjs)
{ const { gate } = await import('./film-gate.mjs'); const g = gate(film); if (g.miss.length && !argv.includes('--assemble')) { console.log(`render refused (${film} ${g.hash}):\n- ` + g.miss.join('\n- ')); process.exit(2); } }
const [PI, PN] = (opt('part', '0/1')).split('/').map(Number), ASSEMBLE = argv.includes('--assemble');
const W = +opt('w', 540), H = +opt('h', 960), DSF = +opt('dsf', 2), FPS = +opt('fps', 30), Q = opt('quality', 'high'), EVERY = +opt('every', 1), MAX = +opt('max', 90);
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
// --redo a-b (film seconds): only those frames drawn again, from 1 s before to 1 s after — the rest kept (the owner, 2026-11-17). The
// film runs from the start undrawn (its state at a must be the same); past b the first kept frame is drawn again and compared: the
// same — done, the rest kept; not the same (the fix changed what comes after) — the window goes on a second more, and again
const REDO = (opt('redo', '') || '').split('-').map(Number), fname = (i) => `f${String(i).padStart(5, '0')}.jpg`;
let redoEnd = -1;
if (REDO.length === 2 && REDO.every(Number.isFinite)) {
  const fr0 = (+opt('fps', 30)) / (+opt('every', 1)), i0 = Math.max(0, Math.floor((REDO[0] - 1) * fr0)); redoEnd = Math.ceil((REDO[1] + 1) * fr0);
  for (let i = i0; i <= redoEnd; i++) fs.rmSync(path.join(out, 'frames', fname(i)), { force: true });
  console.log(`redo frames ${i0}…${redoEnd} (film ${(i0 / fr0).toFixed(1)}–${(redoEnd / fr0).toFixed(1)} s)`);
}
const same = (a, b) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }), m = /average:([\d.]+|inf)/.exec(r.stderr || ''); return !!m && (m[1] === 'inf' || +m[1] > 40); };   // (PSNR over 40 dB: the same picture)
const have = new Set(fs.readdirSync(path.join(out, 'frames')));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.css': 'text/css', '.glb': 'model/gltf-binary', '.webmanifest': 'application/json', '.webp': 'image/webp' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
if (!ASSEMBLE) {
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true })).newPage();
page.setDefaultTimeout(600000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${server.address().port}/?film=${film}&offline=1&dpr=${DSF}&quality=${Q}`);
await page.waitForFunction(() => window.__tc?.film, null, { timeout: 300000 });
const t0 = Date.now();
let n = 0, k = 0;
for (;;) {
  const name = `f${String(Math.floor(k / EVERY)).padStart(5, '0')}.jpg`;
  const idx = Math.floor(k / EVERY), check = redoEnd >= 0 && k % EVERY === 0 && idx === redoEnd + 1 && have.has(name);
  const shoot = check || (k % EVERY === 0 && idx % PN === PI && !have.has(name));
  const st = await page.evaluate(([dt, draw]) => { const tc = window.__tc; tc.filmStep(dt, performance.now() / 1000, draw); return { done: tc.film.done, t: tc.film.t }; }, [1 / FPS, shoot]);
  k++;
  if (check) {
    const tmp = path.join(out, 'seam.jpg'); await page.screenshot({ path: tmp, type: 'jpeg', quality: 92 });
    if (same(tmp, path.join(out, 'frames', name))) { console.log(`seam at frame ${idx}: the same — the rest kept`); redoEnd = -1; fs.rmSync(tmp, { force: true }); }
    else { const fr0 = FPS / EVERY, upto = idx + Math.ceil(fr0); console.log(`seam at frame ${idx}: changed — redrawing on to ${upto}`); fs.renameSync(tmp, path.join(out, 'frames', name)); for (let i = idx + 1; i <= upto; i++) { fs.rmSync(path.join(out, 'frames', fname(i)), { force: true }); have.delete(fname(i)); } redoEnd = upto; }
  } else if (shoot) { await page.screenshot({ path: path.join(out, 'frames', name), type: 'jpeg', quality: 92 }); n++; }
  if (k % (FPS * 2) === 0) console.log(`film ${st.t.toFixed(1)} s · ${n} frames · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (st.done || st.t > MAX) break;
}
fs.writeFileSync(path.join(out, 'marks.json'), JSON.stringify(await page.evaluate(() => window.__tc.film.marks || {})));
await browser.close();
}
server.close();
if (PN > 1 && !ASSEMBLE) { console.log('part done', PI, '/', PN); process.exit(0); }
const marks = JSON.parse(fs.readFileSync(path.join(out, 'marks.json'), 'utf8'));
const fr = FPS / EVERY;
// the cut: the hook (marked «hook» … «hookEnd» at the end of the film) first, then the film up to it
let src = path.join(out, 'frames', 'f%05d.jpg');
if (marks.hook != null && marks.hookEnd != null) {
  const fi = (t) => Math.ceil(t * fr - 1e-6), cut = path.join(out, 'cut'), nf = fs.readdirSync(path.join(out, 'frames')).length;
  const all = Array.from({ length: nf }, (_, i) => `f${String(i).padStart(5, '0')}.jpg`);
  const miss = all.filter((f) => !fs.existsSync(path.join(out, 'frames', f)));
  if (miss.length) { console.log('frames missing:', miss.length, miss.slice(0, 5)); process.exit(1); }
  fs.rmSync(cut, { recursive: true, force: true }); fs.mkdirSync(cut);
  const order = [...all.slice(fi(marks.hook), fi(marks.hookEnd)), ...all.slice(0, fi(marks.hook))];
  order.forEach((f, i) => fs.copyFileSync(path.join(out, 'frames', f), path.join(cut, `c${String(i).padStart(5, '0')}.jpg`)));
  src = path.join(cut, 'c%05d.jpg');
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fr), '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', path.join(out, `${film}.mp4`)]);
console.log('done', path.join(out, `${film}.mp4`));
