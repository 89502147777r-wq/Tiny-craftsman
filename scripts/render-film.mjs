// Renders a film of the game (src/film/) to frames and an mp4, frame by frame (any speed of the
// machine gives a smooth 30 fps video). Usage:
//   node scripts/render-film.mjs pool out/ [--w 540 --h 960 --dsf 2 --fps 30 --quality high --every 1 --max 90]
// (--every N keeps every Nth frame only: a quick preview; --max: seconds of film at most)
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const film = argv[0] || 'pool', out = path.resolve(argv[1] || 'film-out');
const W = +opt('w', 540), H = +opt('h', 960), DSF = +opt('dsf', 2), FPS = +opt('fps', 30), Q = opt('quality', 'high'), EVERY = +opt('every', 1), MAX = +opt('max', 90);
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
for (const f of fs.readdirSync(path.join(out, 'frames'))) fs.unlinkSync(path.join(out, 'frames', f));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.css': 'text/css', '.glb': 'model/gltf-binary', '.webmanifest': 'application/json', '.webp': 'image/webp' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
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
  const shoot = k % EVERY === 0;
  const st = await page.evaluate(([dt, draw]) => { const tc = window.__tc; tc.filmStep(dt, performance.now() / 1000, draw); return { done: tc.film.done, t: tc.film.t }; }, [1 / FPS, shoot]);
  if (k++ % EVERY === 0) { await page.screenshot({ path: path.join(out, 'frames', `f${String(n).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 }); n++; }
  if (k % (FPS * 2) === 0) console.log(`film ${st.t.toFixed(1)} s · ${n} frames · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (st.done || st.t > MAX) break;
}
await browser.close(); server.close();
const fr = FPS / EVERY;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fr), '-i', path.join(out, 'frames', 'f%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', path.join(out, `${film}.mp4`)]);
console.log('done', path.join(out, `${film}.mp4`), n, 'frames');
