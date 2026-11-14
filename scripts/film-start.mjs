// The start of a stage film: the film before it played to its end without drawing, the plot saved as a project (no history) —
// the next stage starts there (the owner: «the same plot, the same records»). Usage: node scripts/film-start.mjs found assets/films/ibiza-1.json.gz
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const film = process.argv[2] || 'found', out = process.argv[3] || 'assets/films/ibiza-1.json.gz';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 })).newPage();
page.setDefaultTimeout(3600000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?film=${film}&offline=1&dpr=1&quality=low`);
await page.waitForFunction(() => window.__tc?.film, null, { timeout: 300000 });
const text = await page.evaluate(async () => {
  const tc = window.__tc, f = tc.film;
  for (let i = 0; i < 20000 && !f.done; i++) { if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0)); tc.filmStep(1 / 30, 0, false); }
  // (the film's own machinery off the plot: what a stage leaves is the work, not the cameras)
  tc.simulate(2);
  return tc.projectText();
});
const zlib = await import('node:zlib');
fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
fs.writeFileSync(path.resolve(root, out), zlib.gzipSync(text, { level: 9 }));
console.log(out, (text.length / 1e6).toFixed(1), 'MB →', (fs.statSync(path.resolve(root, out)).size / 1e6).toFixed(2), 'MB');
await browser.close(); server.close();
