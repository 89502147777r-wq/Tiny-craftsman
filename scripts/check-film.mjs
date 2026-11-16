// Checks a film (src/film/) frame by frame without drawing it: the camera's jerks within a shot
// (a jump or a shudder of the eye or of where it looks), the shots too short to read, and the
// words over each other (bills, titles, counters, big words, pins). Usage:
//   node scripts/check-film.mjs found
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const film = process.argv[2] || 'found', FPS = 30;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
page.setDefaultTimeout(1800000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?film=${film}&offline=1&dpr=1&quality=low`);
await page.waitForFunction(() => window.__tc?.film, null, { timeout: 300000 });
const rowsRaw = await page.evaluate(async (FPS) => {
  const tc = window.__tc, f = tc.film, out = [];
  // (the sound: every play / loop / engine call's film time — a second with none is a silence)
  const sfx = tc.sfx, snd = [];
  if (sfx) for (const k of ['play', 'loop', 'engine']) { const o = sfx[k]?.bind(sfx); if (o) sfx[k] = (...a) => { snd.push(+f.t.toFixed(2)); return o(...a); }; }
  const objN = () => { let n = 0; for (const t of ['unit', 'belt', 'dpc', 'slab', 'column', 'pool']) n += tc.objects.all(t).length; return n; };
  const scr = (p) => { if (!p) return null; const v = p.clone().project(tc.camera); return v.z < 1 && Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95 ? [v.x, v.y] : null; };
  // (the words' boxes on the screen: which overlap)
  const boxes = () => [...document.querySelectorAll('#film .f-bill, #film .f-head, #film .f-kick, #film .f-count, #film .f-steps, #film .f-stage, #film .f-sketch, #film .f-next, #film .f-pin span, #film .f-rcpt .paper, #film .f-card')]
    
    .filter((e) => getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e.closest('.f-pin') || e).opacity > 0.35 && +getComputedStyle(e).opacity > 0.35 && e.offsetParent !== null)
    .map((e) => { const r = e.getBoundingClientRect(); return { k: e.className.split(' ')[0] || e.tagName, txt: e.textContent.slice(0, 24), x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; });
  for (let i = 0; i < 6000 && !f.done; i++) {
    if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0));   // (what the film waits for that is async — a catastrophe started — gets its turn)
    tc.filmStep(1 / FPS, 0, false);
    const c = tc.camera.position, q = tc.rig.target;
    const tp = f.toolAt?.(), wv = tc.wallView?.reveal, rv = tc.rebarView?.reveal;
    out.push({ t: +f.t.toFixed(3), n: f.shot?.n || 0, fx: f.fx.some((e) => e.kind !== 'shake'), title: f.stepName || '', e: [c.x, c.y, c.z], a: [q.x, q.y, q.z], d: tc.rig.dist, b: boxes(),
      tp: tp ? [tp.x, tp.y, tp.z] : null, ts: scr(tp), on: objN() + (wv ? wv.u : 0) + (rv ? rv.u : 0), job: !!(tc.physJob || tc.wallTool?.dpc?.busy || tc.concreteTools?.hose?.state === 'work') });
  }
  return { out, snd, marks: f.marks || {} };
}, FPS);
const { out: rows, snd, marks } = rowsRaw;
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
// ---- the analyst's rules (CLAUDE.md, «Порядок работы над роликом») — measured, not looked at
const H0 = marks.hook ?? Infinity, H1 = marks.hookEnd ?? Infinity, inHook = (t) => t >= H0 - 1e-6 && t <= H1 + 1e-6;
const vt = (t) => (t >= H0 ? t - H0 : t + (H1 - H0));   // (the video's time: the hook first)
const runs = (pred, min) => { const o = []; let s0 = null; for (const r of rows) { if (pred(r)) { if (s0 == null) s0 = r.t; } else { if (s0 != null && r.t - s0 > min) o.push([s0, r.t]); s0 = null; } } if (s0 != null && rows.at(-1).t - s0 > min) o.push([s0, rows.at(-1).t]); return o; };
const fmt = (a, what) => a.map(([x, y]) => `video ${vt(x).toFixed(1)}–${vt(y).toFixed(1)} s (film ${x.toFixed(1)}): ${what} ${(y - x).toFixed(1)} s`);
// (still: nothing done — no record added, no reveal growing, the tool not moving, the camera not moving — longer than 1.5 s)
const act = rows.map((r, i) => { const p = rows[i - 1]; if (!p) return true; const mv = r.tp && p.tp ? len(sub(r.tp, p.tp)) : 0; return r.on !== p.on || mv > 1e-4 || r.job || len(sub(r.e, p.e)) / r.d > 0.002; });
rows.forEach((r, i) => { r.act = act.slice(Math.max(0, i - 3), i + 4).some(Boolean); });   // (smoothed over ±0.1 s)
const still = fmt(runs((r) => !r.act && !inHook(r.t), 1.5), 'nothing moves');
// (the tool off the screen while it works, > 1 s)
const off = fmt(runs((r) => r.job && r.tp && !r.ts && !inHook(r.t), 1.0), 'the tool off screen');
// (a counter's number standing > 2 s)
const cnt = []; { let last = null, t0 = 0; for (const r of rows) { const c = r.b.find((b) => b.k === 'f-steps' || b.k === 'f-count'); const v = c ? c.txt : null; if (v !== last) { if (last && r.t - t0 > 2.0) cnt.push(`video ${vt(t0).toFixed(1)} s: «${last}» stands ${(r.t - t0).toFixed(1)} s`); last = v; t0 = r.t; } } }
// (a stage's bill over a still frame)
const billStill = uniq(rows.filter((r) => r.b.some((b) => b.k === 'f-stage') && !r.act).map((r) => `${r.t.toFixed(2)} s bill «${r.b.find((b) => b.k === 'f-stage').txt}» over a still frame`));
// (the first 10 s of the video: a frame without work)
const first10 = fmt(runs((r) => vt(r.t) < 10 && !inHook(r.t) && !r.act, 0.5), 'in the first 10 s, no work');
// (the hook: ≤ 2.5 s, ≤ 2 shots; the seam — the same words either side)
const hookRows = rows.filter((r) => inHook(r.t)), hookShots = new Set(hookRows.map((r) => r.n)).size;
const words = (r) => r.b.filter((b) => b.k !== 'f-kick').map((b) => b.k + ':' + b.txt).sort().join('|');
const before = rows.filter((r) => r.t < H0 && r.t >= H0 - 1.0), seam = before.length && hookRows.length ? [words(before.at(-1)), words(hookRows[0])] : null;
const hook = [];
if (H1 - H0 > 2.5) hook.push(`the hook ${(H1 - H0).toFixed(2)} s > 2.5`);
if (hookShots > 2) hook.push(`the hook has ${hookShots} shots > 2`);
if (seam && seam[0] !== seam[1]) hook.push(`the loop's seam: before «${seam[0]}» ≠ the hook «${seam[1]}»`);
// (silence > 1 s: no sound started within it — loops keep going, so a long one is a hint, not proof)
const sil = []; { const ts = [...snd].sort((a, b) => a - b); for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 1.0) sil.push(`video ${vt(ts[i - 1]).toFixed(1)} s: no new sound for ${(ts[i] - ts[i - 1]).toFixed(1)} s`); }
console.log(`\nSTILL (> 1.5 s):\n` + still.join('\n'));
console.log(`\nTOOL OFF SCREEN (> 1 s):\n` + off.join('\n'));
console.log(`\nCOUNTER STANDS (> 2 s):\n` + cnt.join('\n'));
console.log(`\nBILL OVER STILL:\n` + billStill.slice(0, 20).join('\n'));
console.log(`\nFIRST 10 S WITHOUT WORK:\n` + first10.join('\n'));
console.log(`\nHOOK / SEAM:\n` + hook.join('\n'));
console.log(`\nSILENCE (> 1 s):\n` + sil.slice(0, 20).join('\n'));
const fails = still.length + off.length + cnt.length + billStill.length + first10.length + hook.length;
console.log(`\nRULES: ${fails ? fails + ' problems' : 'all pass'}`);
console.log('LOG ' + JSON.stringify(rows.reduce((a, r) => { if (!a.length || a.at(-1)[0] !== r.n) a.push([r.n, r.t, r.title]); return a; }, [])));
console.log(`frames ${rows.length}, ${(rows.at(-1).t).toFixed(1)} s, shots ${shots.length}`);
console.log(`\nJERKS (${bad.length} frames):\n` + uniq(bad).slice(0, 40).join('\n'));
console.log(`\nSHORT SHOTS (${short.length}):\n` + short.join('\n'));
console.log(`\nOVERLAPS (${over.length} frames):\n` + uniq(over).slice(0, 40).join('\n'));
process.exit(0);
