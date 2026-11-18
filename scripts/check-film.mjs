// Checks a film (src/film/) frame by frame without drawing it: the camera's jerks within a shot
// (a jump or a shudder of the eye or of where it looks), the shots too short to read, and the
// words over each other (bills, titles, counters, big words, pins). Usage:
//   node scripts/check-film.mjs found
import { createRequire } from 'node:module';
import { mark as gateMark, filmHash } from './film-gate.mjs';
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
  const boxes = () => [...document.querySelectorAll('#film .f-bill, #film .f-head, #film .f-kick, #film .f-count, #film .f-steps, #film .f-rew, #film .f-stage, #film .f-sketch, #film .f-next, #film .f-pin span, #film .f-rcpt .paper, #film .f-card')]
    
    .filter((e) => getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e.closest('.f-pin') || e).opacity > 0.35 && +getComputedStyle(e).opacity > 0.35 && e.getClientRects().length > 0)
    .map((e) => { const r = e.getBoundingClientRect(), F = document.getElementById('film')?.getBoundingClientRect() || { top: 0, height: innerHeight }; return { k: e.className.split(' ')[0] || e.tagName, txt: e.textContent.slice(0, 24), x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, yb: (r.bottom - F.top) / F.height, o: +getComputedStyle(e).opacity * +getComputedStyle(e.closest('.f-pin') || e).opacity }; });
  // (the film's subject — d.subject(): a THREE.Box3 — on the screen, as fractions of the frame (x0, y0, x1, y1, top-down) and as the
  // plates' px: is it whole and uncovered on the loop's frame)
  const subj = () => { const B = f.subject?.(); if (!B || B.isEmpty()) return null; tc.camera.updateMatrixWorld(); let x0 = 1, y0 = 1, x1 = 0, y1 = 0, behind = false;
    for (const x of [B.min.x, B.max.x]) for (const y of [B.min.y, B.max.y]) for (const z of [B.min.z, B.max.z]) { const v = new tc.camera.position.constructor(x, y, z).project(tc.camera); if (v.z > 1) behind = true; const sx = (v.x + 1) / 2, sy = (1 - v.y) / 2; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
    const F = document.getElementById('film')?.getBoundingClientRect() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
    return { x0, y0, x1, y1, behind, px: [F.left + x0 * F.width, F.top + y0 * F.height, F.left + x1 * F.width, F.top + y1 * F.height], fw: F.width, fl: F.left }; };
  for (let i = 0; i < 6000 && !f.done; i++) {
    // (a real pause each frame, as the render's round trip: the models and sounds the film waits for load as they do when it is drawn)
    await new Promise((r) => setTimeout(r, 4));
    tc.filmStep(1 / FPS, performance.now() / 1000, false);
    const c = tc.camera.position, q = tc.rig.target;
    const tp = f.toolAt?.(), wv = tc.wallView?.reveal, rv = tc.rebarView?.reveal;
    out.push({ t: +f.t.toFixed(3), n: f.shot?.n || 0, fx: f.fx.some((e) => e.kind !== 'shake'), title: f.stepName || '', e: [c.x, c.y, c.z], a: [q.x, q.y, q.z], d: tc.rig.dist, b: boxes(),
      tp: tp ? [tp.x, tp.y, tp.z] : null, ts: scr(tp), sub: subj(), sv: !!tc.concreteGear?.pump?.stream?.visible, hw: tc.concreteTools?.hose?.state === 'work' && !!tc.concreteGear?.pump?.ready, hm: (() => { const H = tc.handTools; if (H?.cur !== 'hammer' || !H.tools.hammer?.g.visible || !wv) return null; const p = H.tools.hammer.g.getWorldPosition(tc.camera.position.clone()), F = tc.wallView.boardFaces ? tc.wallView.boardFaces(tc.objects.get(wv.id)) : []; if (!F.length) return null; const nU = Math.max(1, Math.ceil(wv.u * F.length)); let m = Infinity; for (const f of F.slice(0, nU)) { const dx = f.x1 - f.x0, dz = f.z1 - f.z0, L2 = dx * dx + dz * dz, q = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - f.x0) * dx + (p.z - f.z0) * dz) / L2)) : 0; m = Math.min(m, Math.hypot(p.x - f.x0 - dx * q, p.z - f.z0 - dz * q)); } return m * 10.4651; })(), on: objN() + (tc.objects.ver || 0) + (wv ? wv.u : 0) + (rv ? rv.u : 0), job: !!(tc.physJob || tc.wallTool?.dpc?.busy || tc.concreteTools?.hose?.state === 'work') });
  }
  return { out, snd, marks: f.marks || {}, typed: f.hudTyped || [], notes: (f.notes || []).map((n) => String(n[1])) };
}, FPS);
const { out: rows, snd, marks, typed, notes } = rowsRaw;
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
// (still: nothing done — no record added or changed (objects.ver: a roof's layer, a facade's boards), no reveal growing, the tool not
// moving, the camera not moving — longer than 1.5 s)
const act = rows.map((r, i) => { const p = rows[i - 1]; if (!p) return true; const mv = r.tp && p.tp ? len(sub(r.tp, p.tp)) : 0; const bx = (q) => q.b.map((b) => `${b.k}${b.txt}${b.x0.toFixed(0)},${b.y0.toFixed(0)},${b.x1.toFixed(0)},${(b.o ?? 1).toFixed(2)}`).join('|');
  return r.on !== p.on || mv > 2e-5 || bx(r) !== bx(p) || r.job || len(sub(r.e, p.e)) / r.d > 0.002; });
rows.forEach((r, i) => { r.act = act.slice(Math.max(0, i - 3), i + 4).some(Boolean); });   // (smoothed over ±0.1 s)
const still = fmt(runs((r) => !r.act && !inHook(r.t), 1.5), 'nothing moves');
// (the tool off the screen while it works, > 1 s)
const off = fmt(runs((r) => r.job && r.tp && !r.ts && !inHook(r.t), 1.0), 'the tool off screen');
// (a counter's number standing > 2 s)
const cnt = []; { let last = null, t0 = 0; for (const r of rows) { const c = r.b.find((b) => b.k === 'f-steps' || b.k === 'f-count'); const v = c ? c.txt : null; if (v !== last) { if (last && v && r.t - t0 > 2.0) cnt.push(`video ${vt(t0).toFixed(1)} s: «${last}» stands ${(r.t - t0).toFixed(1)} s`); last = v; t0 = r.t; } } }
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
if (process.env.CHK_AT) { const [x, y] = process.env.CHK_AT.split(',').map(Number); for (const r of rows) if (r.t >= x && r.t <= y) console.log('AT', r.t.toFixed(2), r.n, r.act ? 'A' : '-', r.job ? 'J' : '-', r.ts ? 'S' : '-', r.tp ? r.tp.map((v) => v.toFixed(3)).join(',') : 'no-tp', r.on, r.e.map((v) => v.toFixed(3)).join(','), JSON.stringify(r.b.map((b) => [b.k, b.txt, Math.round(b.x0), Math.round(b.y0), +(b.o ?? 1).toFixed(2)]))); }
console.log('ROWS ' + rows.filter((r, i) => i % 15 === 0).map((r) => `${r.t.toFixed(1)}:${r.job ? 'J' : '-'}${r.ts ? 'S' : '-'}${r.act ? 'A' : '-'}${r.on}`).join(' '));
// (the timeline for the analyst, in the video's order — the hook first: each 0.5 s — the shot, work on / the tool on screen, the words)
{ const tl = rows.filter((r, i) => i % 15 === 0).map((r) => ({ v: vt(r.t), r })).sort((a, b) => a.v - b.v);
  console.log('\nTIMELINE (video s | shot | work | tool on screen | words):\n' + tl.map(({ v, r }) => `${v.toFixed(1).padStart(5)} | ${String(r.n).padStart(2)} | ${r.job ? 'work' : r.act ? 'moves' : 'STILL'} | ${r.ts ? 'tool' : '-'} | ${r.b.filter((b) => b.k !== 'f-sketch').map((b) => b.txt).join(' / ')}`).join('\n')); }
// (a cut is a jump of the eye or the aim, not a new shot object: two shots that look the same are one)
const stepE = rows.map((r, i) => (i ? len(sub(r.e, rows[i - 1].e)) / r.d : 0)), stepA = rows.map((r, i) => (i ? len(sub(r.a, rows[i - 1].a)) / r.d : 0));
const near = (arr, i) => { const v = []; for (let j = i - 4; j <= i + 4; j++) if (j !== i && j > 0 && j < arr.length) v.push(arr[j]); v.sort((a, b) => a - b); return v[v.length >> 1] || 0; };
// (a jump far above the camera's own pace either side — a fly or a fast follow moves every frame, a cut once)
const cuts = [rows[0].t]; for (let i = 1; i < rows.length; i++) { const jE = stepE[i] > 0.04 && stepE[i] > 5 * near(stepE, i), jA = stepA[i] > 0.08 && stepA[i] > 5 * near(stepA, i); if (jE || jA) cuts.push(rows[i].t); }
cuts.push(rows.at(-1).t);
const shortCut = []; for (let i = 0; i < cuts.length - 1; i++) { const t0 = cuts[i], t1 = cuts[i + 1]; if (t1 - t0 < 0.8 - 1e-6 && !inHook(t0) && !inHook(t1 - 0.01) && i < cuts.length - 2) shortCut.push(`video ${vt(t0).toFixed(1)} s: a shot of ${(t1 - t0).toFixed(2)} s < 0.8`); }
// (one meaning text at a time — a bill, a kick, a title; the counter, «to be continued», the sketch do not count)
const MEAN = ['f-stage', 'f-kick', 'f-head', 'f-card', 'f-bill', 'f-rcpt'];
const two = uniq(rows.filter((r) => !inHook(r.t) && r.b.filter((b) => MEAN.includes(b.k)).length > 1).map((r) => `${r.t.toFixed(2)} s two texts: ${r.b.filter((b) => MEAN.includes(b.k)).map((b) => '«' + b.txt + '»').join(' + ')}`));
// (a text over the work: the tool on screen ≥ 70 % of the time it is up, never > 1 s without it)
const txt = (r) => !inHook(r.t) && r.b.some((b) => b.k === 'f-stage' || b.k === 'f-kick'), txtRows = rows.filter(txt);
const txtTool = txtRows.length ? txtRows.filter((r) => r.ts).length / txtRows.length : 1;
const txtOff = fmt(runs((r) => txt(r) && !r.ts, 1.0), 'a text up without the tool on screen');
if (txtTool < 0.7) txtOff.unshift(`the tool on screen under texts ${(txtTool * 100).toFixed(0)} % < 70 %`);
// («TO BE CONTINUED» 2.5–3.5 s before the seam)
const nx = rows.find((r) => r.t < H0 && r.b.some((b) => b.k === 'f-next')), nxt = [];
if (Number.isFinite(H0)) { if (!nx) nxt.push('no «TO BE CONTINUED» before the seam'); else if (H0 - nx.t < 2.5 || H0 - nx.t > 3.5) nxt.push(`«TO BE CONTINUED» ${(H0 - nx.t).toFixed(1)} s before the seam (2.5–3.5)`); }
// (the tool on screen in every shot — a thing coming up by itself is as empty: ≤ 1 s without it, but the hook and the sketch's finale)
const F0 = marks.finale ?? Infinity, inFin = (t) => t >= F0 - 1e-6 && t < H0;
const noTool = fmt(runs((r) => !r.ts && !inHook(r.t) && !inFin(r.t) && r.t > 0.4, 1.0), 'no tool on screen');
console.log(`\nNO TOOL (> 1 s, any shot):\n` + noTool.join('\n'));
// (no words on the screen — numbers, signs, the picture: the first viewers may not read English (the owner, 2026-11-16); DAYS is known
// to all; «TO BE CONTINUED» is the owner's own plate)
// (the owner, 2026-11-18: a stage's bill names what the money went on — one or two English words, «BOARDS», «CINDER BLOCKS»; every
// other text of the film's own stays without words)
const OKW = new Set(['DAYS', 'DAY']), billWords = (b) => b.k === 'f-stage' && (b.txt.match(/\p{L}{2,}/gu) || []).length <= 2;
const wordy = uniq(rows.flatMap((r) => r.b.filter((b) => ['f-stage', 'f-kick', 'f-head', 'f-card', 'f-steps', 'f-count', 'f-bill'].includes(b.k) && !billWords(b)).flatMap((b) => (b.txt.match(/\p{L}{2,}/gu) || []).filter((w) => !OKW.has(w.toUpperCase())).map((w) => `${r.t.toFixed(1)} s ${b.k} «${b.txt}»: «${w}»`))));
console.log(`\nWORDS ON SCREEN:\n` + wordy.slice(0, 20).join('\n'));
console.log(`\nSHORT CUTS (< 0.8 s, outside the hook):\n` + shortCut.join('\n'));
console.log(`\nTWO TEXTS AT ONCE:\n` + two.slice(0, 20).join('\n'));
console.log(`\nTEXT WITHOUT THE TOOL:\n` + txtOff.join('\n'));
console.log(`\nTO BE CONTINUED:\n` + nxt.join('\n'));
console.log(`\nSTILL (> 1.5 s):\n` + still.join('\n'));
console.log(`\nTOOL OFF SCREEN (> 1 s):\n` + off.join('\n'));
console.log(`\nCOUNTER STANDS (> 2 s):\n` + cnt.join('\n'));
console.log(`\nBILL OVER STILL:\n` + billStill.slice(0, 20).join('\n'));
console.log(`\nFIRST 10 S WITHOUT WORK:\n` + first10.join('\n'));
console.log(`\nHOOK / SEAM:\n` + hook.join('\n'));
console.log(`\nSILENCE (> 1 s):\n` + sil.slice(0, 20).join('\n'));
// (the menu in the frame is the game's own (the owner, 2026-11-17: «актуальное меню» — the material in the frame is the one chosen in
// it): rows typed in the film (d.hud([...])) instead of read from the game (d.menu) fail; so does a film's own «… FAILED» note)
// (nothing of the film's own lower than 75 % of the frame — YouTube Shorts' captions and buttons lie there: the analyst's list)
const lowP = uniq(rows.flatMap((r) => r.b.filter((q) => q.k !== 'f-sketch' && q.yb > 0.75).map((q) => `${r.t.toFixed(2)} s ${q.k} «${q.txt}» to ${(q.yb * 100).toFixed(0)} % of the height`)));
console.log(`\nUNDER 75 % (the Shorts zone):\n` + lowP.slice(0, 10).join('\n'));
// ---- the closed release list as numbers (the owner, 2026-11-17: «мерить числами, картинки — только как выглядит») ----
const list = [];
if (Number.isFinite(H0)) {
  const pre = rows.filter((r) => r.t < H0).at(-1), h0 = rows.find((r) => inHook(r.t)), hk = rows.filter((r) => inHook(r.t));
  // (the loop's frame: the subject whole in the frame's clear band, no plate over it; the last frame = the first — the camera ≤ 2 % of its distance)
  for (const [nm, r] of [['first frame', h0], ['last frame', pre]]) {
    if (!r?.sub) { if (r && rows.some((q) => q.sub)) list.push(`${nm}: no subject`); continue; }
    const S = r.sub; if (S.behind || S.x0 < 0.02 || S.x1 > 0.98 || S.y0 < 0.1 || S.y1 > 0.75) list.push(`${nm}: the subject not whole in the frame's band — x ${S.x0.toFixed(2)}–${S.x1.toFixed(2)}, y ${S.y0.toFixed(2)}–${S.y1.toFixed(2)}`);
    for (const b of r.b) { if (b.k === 'f-sketch') continue; const w = Math.min(b.x1, S.px[2]) - Math.max(b.x0, S.px[0]), h = Math.min(b.y1, S.px[3]) - Math.max(b.y0, S.px[1]); if (w > 4 && h > 4) list.push(`${nm}: ${b.k} «${b.txt}» over the subject`); }
  }
  if (pre && h0) { const de = len(sub(pre.e, h0.e)) / h0.d, da = len(sub(pre.a, h0.a)) / h0.d; if (de > 0.02 || da > 0.02) list.push(`the loop's seam: the camera moved ${(Math.max(de, da) * 100).toFixed(1)} % of its distance`);
    const k = (r) => r.b.filter((b) => b.k === 'f-next').map((b) => `${Math.round(b.x0)},${Math.round(b.y0)},${Math.round(b.x1 - b.x0)}`).join(); if (k(pre) !== k(h0)) list.push(`the loop's seam: «TO BE CONTINUED» not the same both sides (${k(pre) || '–'} / ${k(h0) || '–'})`); }
  // (the rewind: its sign from the hook's first 0,1 s; its count changing at least every 0,3 s while it runs)
  const rew = hk.filter((r) => r.b.some((b) => b.k === 'f-rew'));
  if (hk.length && rows.some((r) => r.b.some((b) => b.k === 'f-steps') && inHook(r.t))) {
    if (!rew.length || rew[0].t - H0 > 0.1) list.push(`the rewind's sign from ${rew.length ? (rew[0].t - H0).toFixed(2) : '—'} s of the hook (≤ 0,1)`);
    let last = null, lt = H0; for (const r of rew) { const c = r.b.find((b) => b.k === 'f-steps')?.txt; if (c !== last) { if (last != null && r.t - lt > 0.3) list.push(`the rewind's count stood ${(r.t - lt).toFixed(2)} s on «${last}»`); last = c; lt = r.t; } }
    // (no bare foundation after it: from its stop to the hook's end ≤ 0,3 s; the film's first frame with the tool on the screen)
    const stop = rew.at(-1)?.t ?? H0; if (H1 - stop > 0.35) list.push(`after the rewind ${(H1 - stop).toFixed(2)} s before the film (≤ 0,3)`);
    const b0 = rows.find((r) => r.t >= 0); if (b0 && !b0.ts) list.push('the film\'s first frame: no tool on the screen');
  }
  // (the stage's sketch: its paper 22–25 % of the frame's width — the picture is 1,117 × its paper with its shadow)
  const sk = rows.flatMap((r) => r.b.filter((b) => b.k === 'f-sketch' && !inFin(r.t)).map((b) => (b.x1 - b.x0) / (r.sub?.fw || 1) / 1.117)).filter((w) => w < 0.6);
  if (rows.some((r) => r.sub) && sk.length) { const m = [...sk].sort((p, q) => p - q)[sk.length >> 1]; if (m > 0.255 || m < 0.215) list.push(`the sketch's paper ${(m * 100).toFixed(1)} % of the width (22–25)`); }   // (its usual size: the median — it flies in small)
}
// (the hammer nails the board being put up — the owner: it beat the air on one side while the boards went up on the other)
{ const far = rows.filter((r) => r.hm != null && r.hm > 0.6); if (far.length > 3) list.push(`the hammer ${Math.max(...far.map((r) => r.hm)).toFixed(1)} m from any board up (${far.length} frames, from ${far[0].t.toFixed(1)} s)`); }
// (the stream seen while the hose pours — the owner: the formwork filled with no stream)
{ const w = rows.filter((r) => r.hw), v = w.filter((r) => r.sv); if (w.length > 20 && v.length < w.length * 0.9) list.push(`the stream seen ${(100 * v.length / w.length).toFixed(0)} % of the hose's pouring (≥ 90)`); }
console.log(`\nTHE RELEASE LIST (numbers):\n` + list.join('\n'));
const menu = [...new Set(typed)].map((r) => `menu typed by the film, not the game's: ${r}`).concat(notes.filter((n) => /FAILED/.test(n)));
console.log(`\nMENU / NOTES:\n` + menu.join('\n'));
const fails = list.length + lowP.length + menu.length + still.length + off.length + cnt.length + billStill.length + first10.length + hook.length + shortCut.length + two.length + txtOff.length + nxt.length + noTool.length + wordy.length;
console.log(`\nRULES: ${fails ? fails + ' problems' : 'all pass'}`);
if (!fails) console.log('gate: rules passed for version ' + gateMark(film, 'rules')); else console.log('gate: version ' + filmHash(film) + ' NOT passed — no render');
console.log('LOG ' + JSON.stringify(rows.reduce((a, r) => { if (!a.length || a.at(-1)[0] !== r.n) a.push([r.n, r.t, r.title]); return a; }, [])));
console.log(`frames ${rows.length}, ${(rows.at(-1).t).toFixed(1)} s, shots ${shots.length}`);
console.log(`\nJERKS (${bad.length} frames):\n` + uniq(bad).slice(0, 40).join('\n'));
console.log(`\nSHORT SHOTS (${short.length}):\n` + short.join('\n'));
console.log(`\nOVERLAPS (${over.length} frames):\n` + uniq(over).slice(0, 40).join('\n'));
process.exit(0);
