// Checks a film (src/film/) frame by frame without drawing it: the camera's jerks within a shot
// (a jump or a shudder of the eye or of where it looks), the shots too short to read, and the
// words over each other (bills, titles, counters, big words, pins). Usage:
//   node scripts/check-film.mjs pool
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const film = process.argv[2] || 'pool', FPS = 30;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
page.setDefaultTimeout(1800000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?film=${film}&offline=1&dpr=1&quality=low`);
await page.waitForFunction(() => window.__tc?.film, null, { timeout: 300000 });
const rows = await page.evaluate((FPS) => {
  const tc = window.__tc, f = tc.film, out = [];
  // (the words' boxes on the screen: which overlap)
  const boxes = () => [...document.querySelectorAll('#film .f-bill, #film .f-head, #film .f-kick, #film .f-count, #film .f-pin span, #film .f-rcpt .paper, #film .f-card')]
    
    .filter((e) => getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e.closest('.f-pin') || e).opacity > 0.35 && +getComputedStyle(e).opacity > 0.35 && e.offsetParent !== null)
    .map((e) => { const r = e.getBoundingClientRect(); return { k: e.className.split(' ')[0] || e.tagName, txt: e.textContent.slice(0, 24), x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; });
  for (let i = 0; i < 4000 && !f.done; i++) {
    tc.filmStep(1 / FPS, 0, false);
    const c = tc.camera.position, q = tc.rig.target;
    out.push({ t: +f.t.toFixed(3), n: f.shot?.n || 0, fx: f.fx.some((e) => e.kind !== 'shake'), title: f.stepName || '', e: [c.x, c.y, c.z], a: [q.x, q.y, q.z], d: tc.rig.dist, b: boxes() });
  }
  return out;
}, FPS);
await browser.close(); server.close();
// ---- the camera: within a shot, the change of the eye's and the aim's velocity (a jerk), as a share of the distance
const sub = (a, b) => a.map((v, i) => v - b[i]), len = (a) => Math.hypot(...a);
const bad = [];
for (let i = 2; i < rows.length; i++) {
  const [a, b, c] = [rows[i - 2], rows[i - 1], rows[i]];
  if (a.n !== c.n || c.fx || b.fx) continue;
  const je = len(sub(sub(c.e, b.e), sub(b.e, a.e))) / c.d, ja = len(sub(sub(c.a, b.a), sub(b.a, a.a))) / c.d;
  if (je > 0.012 || ja > 0.012) bad.push(`${c.t.toFixed(2)} s [${c.title}] shot ${c.n}: jerk eye ${je.toFixed(3)} aim ${ja.toFixed(3)}`);
}
// shots that last under 0.8 s
const shots = []; for (const r of rows) { const l = shots.at(-1); if (!l || l.n !== r.n) shots.push({ n: r.n, t0: r.t, t1: r.t, title: r.title }); else l.t1 = r.t; }
const short = shots.filter((s, i) => i < shots.length - 1 && s.t1 - s.t0 < 0.8).map((s) => `${s.t0.toFixed(2)} s [${s.title}] shot ${s.n}: ${(s.t1 - s.t0).toFixed(2)} s`);
// the words over each other
const over = [];
for (const r of rows) {
  for (let i = 0; i < r.b.length; i++) for (let j = i + 1; j < r.b.length; j++) {
    const p = r.b[i], q = r.b[j], w = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), h = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
    if (w > 4 && h > 4) over.push(`${r.t.toFixed(2)} s [${r.title}] ${p.k} «${p.txt}» × ${q.k} «${q.txt}»`);
  }
}
const uniq = (a) => { const seen = new Set(); return a.filter((s) => { const k = s.replace(/^[\d.]+ s /, ''); if (seen.has(k)) return false; seen.add(k); return true; }); };
console.log(`frames ${rows.length}, ${(rows.at(-1).t).toFixed(1)} s, shots ${shots.length}`);
console.log(`\nJERKS (${bad.length} frames):\n` + uniq(bad).slice(0, 40).join('\n'));
console.log(`\nSHORT SHOTS (${short.length}):\n` + short.join('\n'));
console.log(`\nOVERLAPS (${over.length} frames):\n` + uniq(over).slice(0, 40).join('\n'));
process.exit(0);
