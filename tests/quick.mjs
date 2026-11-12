// Quick check before publishing (a few minutes, no screenshots):
//   the game starts without errors, the soil shaders build (full and light),
//   the shader sources pass glslangValidator (if installed), the shovel digs
//   and conserves soil, undo/redo is exact, the rake flattens the spoil heap,
//   outline + formwork + cage + ties can be placed, the project survives a reload,
//   and the quiet mode works (with the tools' modes).
// Starts its own static web server. Usage: node tests/quick.mjs
// Optional: WEBKIT=/path/to/playwright-browsers → also starts the game in WebKit.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();

// ---- static server ------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const sec = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

async function open(browserType, query, opts = {}, locale = 'ru-RU') {
  const browser = await browserType.launch(opts);
  const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, locale })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto(`${base}?dpr=1&quality=low${query}`);
  await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 });
  return { browser, page, errors };
}

// what a terrain program looks like on this browser
const shaderState = () => {
  const tc = window.__tc, gl = tc.renderer.getContext();
  tc.simulate(0.05);
  tc.renderer.render(tc.scene, tc.camera);
  const prog = tc.renderer.properties.get(tc.terrain.mesh.material).currentProgram;
  const src = prog ? gl.getAttachedShaders(prog.program).map((s) => ({ vert: gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.VERTEX_SHADER, src: gl.getShaderSource(s) })) : [];
  return { runnable: prog?.diagnostics ? prog.diagnostics.runnable : true, errors: tc.shaderErrors, fallback: !!tc.fallbackMat, light: !!tc.lightMat && tc.terrain.mesh.material === tc.lightMat, src };
};

let glslang = null;
try { execFileSync('glslangValidator', ['--version'], { stdio: 'ignore' }); glslang = 'glslangValidator'; } catch { /* not installed */ }
function validate(src, name) {
  if (!glslang) return 'skipped';
  const f = path.join(os.tmpdir(), `tc-${name}.${src.vert ? 'vert' : 'frag'}`);
  // three.js has a function called "average", which newer GLSL reserves: rename for the validator only
  fs.writeFileSync(f, src.src.replace(/\baverage\b/g, 'tcAverage'));
  try { execFileSync(glslang, [f], { stdio: 'pipe' }); return 'ok'; } catch (e) { return String(e.stdout || e.message).slice(-400); }
}

// ---- 0. The frames' cadence (core/pace.js): while something moves, drawn evenly — at 60 Hz every frame, at
// 120 Hz every other one — even when the display's frames come with a little jitter; still: twice a second ----
{
  const { Pace } = await import('../src/core/pace.js');
  const run = (hz, live, secs = 6) => { const P = new Pace(), f = 1000 / hz, gaps = []; let x = 0x1234567, last = null;
    const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
    for (let k = 0; k < secs * hz; k++) { const now = 1000 + k * f + (rnd() - 0.5) * 3; if (P.due(now, live)) { if (last != null && k > hz) gaps.push(Math.round((now - last) / f)); last = now; } }
    return [...new Set(gaps)].sort().join(','); };
  const r = { hz60: run(60, true), hz120: run(120, true), hz90: run(90, true), still: run(60, false) };
  { const rain = { hz60: run(60, 2), hz120: run(120, 2), hz90: run(90, 2) };
    { const { shadowDue } = await import('../src/core/pace.js');
    const ok = !shadowDue(0.05, { recent: true }) && shadowDue(0.11, { recent: true }) && shadowDue(0.01, { work: true }) && shadowDue(0, { box: true }) && !shadowDue(1.5, {}) && shadowDue(2.1, {});
    check('shadows: drawn again for a cause — work each frame, the box moved now, a finger 10 a second, still every 2 s', ok, ''); }
  check('frames: only the rain moving — half the rate (60 Hz: every other frame, 120 Hz: every 4th)', rain.hz60 === '2' && rain.hz120 === '4' && rain.hz90 === '2', JSON.stringify(rain)); }
  check('frames: drawn evenly while things move (60 Hz: every frame, 120 Hz: every other), twice a second when still', r.hz60 === '1' && r.hz120 === '2' && r.hz90 === '1' && r.still.split(',').every((g) => g >= 28 && g <= 31), JSON.stringify(r));
}

// ---- 1. Chromium: start, shaders --------------------------------------------------------------
for (const variant of ['full', 'light']) {
  const { browser, page, errors } = await open(pw.chromium, variant === 'light' ? '&soil=light' : '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const st = await page.evaluate(shaderState);
  check(`${variant} soil shader builds`, st.runnable && !st.fallback && (variant === 'light') === st.light, JSON.stringify({ runnable: st.runnable, errors: st.errors }));
  const v = st.src.map((s) => validate(s, variant));
  check(`${variant} soil shader is valid GLSL ES`, v.every((r) => r === 'ok' || r === 'skipped'), v.join(' / '));
  if (variant === 'full') {
    // quiet mode: one round button; a tool with modes keeps the fan open and shows them
    const q = await page.evaluate(() => {
      const tc = window.__tc, ui = tc.ui, vis = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
      ui.setQuiet(true);
      const quiet = !vis('.tools') && !document.getElementById('fan').hidden;
      ui.fan(true);
      [...document.querySelectorAll('.fan-item')].find((e) => e.textContent.includes('Фундамент')).click();
      const toolrow = vis('#toolrow') && ui.fanOpen;
      document.querySelector('#toolrow [data-tool="rebar"]').click();
      const modes = [...document.querySelectorAll('#subbar .chip-btn')].map((b) => b.textContent);
      const shown = vis('#subbar') && ui.fanOpen;
      [...document.querySelectorAll('#subbar .chip-btn')].find((b) => b.textContent === 'Сетка').click();
      const picked = tc.rebarTool.mode === 'mesh' && !ui.fanOpen && !vis('#subbar');
      ui.setQuiet(false);
      const normal = vis('.tools') && document.getElementById('fan').hidden;
      return { quiet, toolrow, modes, shown, picked, normal };
    });
    check('quiet mode: panels hidden, tool modes in the fan, panels come back', q.quiet && q.toolrow && q.shown && q.picked && q.normal, JSON.stringify(q));
  }
  check(`${variant}: no console errors on start`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}
console.log('—', sec());

// ---- 2. Chromium: play ------------------------------------------------------------------------
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('tiny-craftsman'); });
  await page.reload({ timeout: 120000 });
  await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 });
  const play = await page.evaluate(async () => {
    const SC = (await import('/src/config.js')).MODEL_SCALE;   // real = model × SC
    const tc = window.__tc, V = tc.camera.position.constructor, t = tc.terrain;
    const out = { build: tc.BUILD };
    const tot0 = t.totalVolume();
    tc.setTool('shovel');
    const wait = () => { for (let i = 0; i < 400 && tc.shovelTool.state !== 'idle'; i++) tc.simulate(0.05); };
    // three passes along one strip inside the pit outline, dumping beside it
    for (let pass = 0; pass < 3; pass++) {
      let s = 0;
      while (s < 1) {
        const s0 = s;
        tc.shovelTool.down(new V(-0.25 + 0.2 * s, 0.1, -0.1));
        while (tc.shovelTool.state === 'dig' && s < 1) { s += 0.02; tc.shovelTool.move(new V(-0.25 + 0.2 * s, 0.1, -0.1)); }
        tc.shovelTool.up();
        if (tc.shovelTool.state === 'loaded') { tc.shovelTool.down(new V(0.55, 0.1, 0.55)); tc.shovelTool.up(); }
        wait();
        if (s === s0) s += 0.05;
      }
    }
    tc.particles.flush();
    for (let i = 0; i < 4000 && t.active; i++) t.relax(1);
    out.depth = t.orig[t.index(-0.15, -0.1)] - t.heightAt(-0.15, -0.1);
    out.drift = (t.totalVolume() - tot0) * 1e9;
    out.spoilDepth = t.ldep[t.index(0.55, 0.55)];
    out.scoops = tc.journal.done.length;
    const snap = t.nat.slice();
    tc.undo(); const undone = tc.journal.done.length === out.scoops - 1; tc.redo();
    let err = 0; for (let i = 0; i < snap.length; i++) err = Math.max(err, Math.abs(snap[i] - t.nat[i]));
    out.undo = undone && err < 1e-9;
    // rake the spoil heap: four strokes across it towards the camera side
    const peak = () => { let m = -1; for (let z = 0.4; z <= 0.7; z += 0.003) for (let x = 0.4; x <= 0.7; x += 0.003) m = Math.max(m, t.heightAt(x, z)); return m; };
    const h0 = peak(), v0 = t.totalVolume(), n0 = tc.journal.done.length;
    tc.setTool('rake');
    for (const x of [0.55, 0.52, 0.58, 0.55]) {
      tc.rakeTool.down(new V(x, 0.1, 0.45));
      for (let s = 0; s <= 1.0001; s += 0.05) { tc.rakeTool.move(new V(x, 0.1, 0.45 + 0.2 * s)); tc.simulate(1 / 30); }
      tc.rakeTool.up();
    }
    out.rake = { h0: (h0 - 0.1) * 1000, h1: (peak() - 0.1) * 1000, drift: (t.totalVolume() - v0) * 1e9, strokes: tc.journal.done.length - n0 };
    const rs = t.loose.slice();
    tc.undo(); tc.redo();
    let rerr = 0; for (let i = 0; i < rs.length; i++) rerr = Math.max(rerr, Math.abs(rs[i] - t.loose[i]));
    out.rake.undo = rerr < 1e-9;
    // sand and crushed stone: a delivered heap has exactly its volume (a little sand may
    // mix into old spoil where layers merge); the shovel carries
    // sand as sand; undo restores the layers exactly
    tc.ui.openGroup('materials');
    const mats = { group: tc.tool };
    tc.settings.matMode = 'deliver'; tc.settings.delivery = 5;
    const vm0 = t.totalVolume();
    tc.activeTool().down(new V(0.2, 0.1, -0.1));
    for (let i = 0; i < 600 && tc.busy(); i++) tc.simulate(1 / 30);
    mats.heap = (t.totalVolume() - vm0) / (5 / SC ** 3);
    mats.sand = t.materialVolumes()[1] / (5 / SC ** 3);
    tc.setTool('shovel');
    tc.shovelTool.down(new V(0.12, 0.1, -0.1)); for (let s = 0; s < 1 && tc.shovelTool.state === 'dig'; s += 0.04) tc.shovelTool.move(new V(0.12 + 0.12 * s, 0.1, -0.1)); tc.shovelTool.up();
    mats.loadSand = tc.shovelTool.mat === 1;
    if (tc.shovelTool.state === 'loaded') { tc.shovelTool.down(new V(-0.2, 0.1, 0.25)); tc.shovelTool.up(); }
    // (till the sand has landed and lain still: crumbs fall at the real g now — a snapshot taken with some still in the air,
    // or the heap still slumping, differed from what redo brings back: the test «blinked»)
    for (let i = 0; i < 800 && (tc.shovelTool.state !== 'idle' || tc.particles.busy || t.active || tc.busy()); i++) tc.simulate(0.05);
    mats.dumpedSand = t.topMat(t.index(-0.2, 0.25)) === 1;
    // (what the journal holds is the ground as it was when the dump was committed; the heap may creep a hair after that —
    // by how much depends on the machine's load (the settling has a time budget a frame): the layers are compared with
    // the journal's own state — brought to it by one undo / redo — not with the creep. That was the «blinking».)
    tc.undo(); tc.redo();
    const lH = t.lH.slice();
    tc.undo(); tc.undo(); tc.redo(); tc.redo();
    let le = 0, nle = 0; for (let i = 0; i < lH.length; i++) { const dv = Math.abs(lH[i] - t.lH[i]); if (dv > 1e-9) nle++; le = Math.max(le, dv); }
    mats.undo = le < 1e-9;
    // (when it fails: by how much, in how many cells, and what was still going on — it has blinked for reasons not yet pinned down)
    if (!mats.undo) mats.why = { le, cells: nle, of: lH.length, active: !!t.active, cActive: !!t.cActive, crumbs: tc.particles.items.length, busy: tc.busy(), done: tc.journal.done.length, undone: tc.journal.undone?.length };
    mats.drift = (t.totalVolume() - vm0) / (5 / SC ** 3) - 1;
    out.mats = mats;
    // setting-out, formwork, cage, ties
    const e = { clientX: 0, clientY: 0 };
    tc.setTool('mark'); tc.markTool.setMode('trench');
    tc.markTool.down(new V(0.55, 0.1, 0.1)); tc.markTool.move(new V(0.8, 0.1, 0.1)); tc.markTool.up();
    tc.markTool.down(new V(0.8, 0.1, 0.3)); tc.markTool.up(); tc.markTool.finishTrench();
    tc.setTool('form'); tc.formTool.setMode('outline'); tc.formTool.down(new V(0.68, 0.09, 0.1), e);
    tc.setTool('rebar'); tc.rebarTool.setMode('cage'); tc.rebarTool.down(new V(0.68, 0.09, 0.1), e);
    tc.rebarTool.setMode('tie'); tc.rebarTool.down(new V(0.68, 0.09, 0.1), e);
    // concrete: formwork round the pit holds it; the pumped volume is exact; undo exact
    {
      const o = tc.objects.all('outline').find((x) => x.kind === 'rect');
      tc.setTool('form'); tc.formTool.setMode('outline'); tc.formTool.down(new V((o.x0 + o.x1) / 2, 0.1, o.z0), e);
      tc.simulate(0.1);
      tc.setTool('hose'); tc.settings.pump = 0.1;
      const h = tc.activeTool(), c0 = t.concVolume();
      h.down(new V((o.x0 + o.x1) / 2, 0.1, (o.z0 + o.z1) / 2)); tc.simulate(3); h.up();
      for (let i = 0; i < 300 && tc.busy(); i++) tc.simulate(1 / 15);
      let leak = 0, all = 0;
      for (let iz = 0; iz <= t.rz; iz++) for (let ix = 0; ix <= t.rx; ix++) { const c = t.conc[iz * t.nx + ix]; if (!c) continue; all += c; const x = t.toWorldX(ix), z = t.toWorldZ(iz); if (x < o.x0 - 0.02 || x > o.x1 + 0.02 || z < o.z0 - 0.02 || z > o.z1 + 0.02) leak += c; }
      const cs = t.conc.slice();
      tc.undo(); const gone = t.concVolume() < 1e-12; tc.redo();
      let ce = 0; for (let i = 0; i < cs.length; i++) ce = Math.max(ce, Math.abs(cs[i] - t.conc[i]));
      out.conc = { vol: (t.concVolume() - c0) / h.poured, leak: leak / all, undo: gone && ce < 1e-9, m3: +(h.poured * SC ** 3).toFixed(3) };
    }
    // sand poured onto concrete lies on it (the concrete does not rise); undo exact
    {
      const o = tc.objects.all('outline').find((x) => x.kind === 'rect');
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, i = t.index(cx, cz);
      const c0 = t.conc.slice(), v0 = t.totalVolume();
      tc.journal.act('test-sand', {}, tc.clock, () => { t.deposit(cx, cz, 2e-5, 0.01, 0, 1); for (let k = 0; k < 4000 && t.active; k++) t.relax(1); });
      let dc = 0; for (let k = 0; k < c0.length; k++) dc = Math.max(dc, Math.abs(c0[k] - t.conc[k]));
      const onTop = t.top[i] > 0 && t.topM[i] === 1, vol = Math.abs(t.totalVolume() - v0 - 2e-5) / 2e-5;
      tc.undo(); const back = t.top.every((x) => x === 0);
      out.sandOnConc = { onTop, concMoved: dc, vol, back };
    }
    // backfill: the plate compactor settles loose soil (and only loose); undo exact
    {
      const x = 0.55, z = -0.3;
      tc.journal.act('test-soil', {}, tc.clock, () => { t.deposit(x, z, 4e-5, 0.03, 0, 0); for (let k = 0; k < 6000 && t.active; k++) t.relax(1); });
      const l0 = t.loose[t.index(x, z)], n0 = t.nat[t.index(x, z)];
      tc.setTool('plate'); const pl = tc.activeTool();
      pl.down(new V(x - 0.06, 0.1, z)); for (let s = 0; s <= 1; s += 0.05) { pl.move(new V(x - 0.06 + 0.12 * s, 0.1, z)); tc.simulate(1 / 30); } pl.up();
      for (let i = 0; i < 100 && tc.busy(); i++) tc.simulate(1 / 15);
      const l1 = t.loose[t.index(x, z)], c1 = t.comp[t.index(x, z)];
      tc.undo(); const back = t.loose[t.index(x, z)] === l0 && t.comp[t.index(x, z)] === 0;
      tc.redo();
      out.plate = { settledMm: +((l0 - l1) * SC * 1000).toFixed(1), comp: +c1.toFixed(2), nativeKept: t.nat[t.index(x, z)] === n0, back };
    }
    // walls: a line, mortar on the first course, a block laid (physics + mallet) at its place, undo
    {
      const W = await import('/src/world/walls.js');
      tc.setTool('wall'); const wt = tc.wallTool; tc.settings.wallKind = 'block'; tc.settings.wallHeight = 1000;
      wt.setMode('line'); wt.down(new V(-0.5, 0.1, -0.6), e); wt.move(new V(-0.2, 0.1, -0.6)); wt.up();
      const w = tc.objects.all('wall').at(-1);
      // carry a block from the pallet: let go off the plot → back on the pallet; at the wall → laid
      wt.setMode('lay');
      const pal = () => new V(w.pallet[0], 0.1, w.pallet[1]);
      wt.down(pal(), e); wt.move(new V(1.9, 0.1, 0), e); wt.up();
      const refused = !tc.objects.all('unit').length;
      wt.down(pal(), e); wt.move(new V(-0.45, 0.1, -0.6), e); wt.up();
      for (let i = 0; i < 400 && (tc.physJob || tc.physLoading); i++) { if (tc.physLoading) await new Promise((r) => setTimeout(r, 50)); else tc.simulate(1 / 30); }
      const u = tc.objects.all('unit')[0];
      const sl = u && W.course(w, 0, tc.objects.all('wall')).find((x) => Math.abs(x.s0 - u.s0) < 1), tgt = sl && W.slotPose(w, 0, sl);
      const err = u ? tgt.p.distanceTo(new V().fromArray(u.p)) * SC * 1000 : 99;
      tc.undo(); const back = !tc.objects.all('unit').length; tc.redo();
      out.walls = { rows: W.rows(w), refused, laid: !!u, bed: tc.objects.all('bed').length > 0, errMm: +err.toFixed(2), back };
      // free brickwork: a brick on the slab edge (flush, along it), the next continues the
      // course (head joint 10 mm, same height), one on top of them (bed 12 mm), a brick into
      // nothing under it is refused (red), a brick on the blockwork; undo
      {
        const o = tc.objects.all('outline').find((x) => x.kind === 'rect'), settle = async () => { for (let i = 0; i < 400 && (tc.physJob || tc.physLoading); i++) { if (tc.physLoading) await new Promise((r) => setTimeout(r, 50)); else tc.simulate(1 / 30); } };
        const mm = (v) => v / 1000 / SC;
        const put = async (p, drop = true) => { tc.settings.wallKind = 'brick'; wt.carry = { kind: 'brick', pallet: null, snap: null }; wt._carryMove(p, null); const f = wt.carry.free; if (drop) { wt._carryDrop(); await settle(); } else wt._carryCancel(); return f; };
        const n0 = tc.objects.all('unit').length, top = t.heightAt((o.x0 + o.x1) / 2, o.z0 + 0.02);
        const f1 = await put(new V((o.x0 + o.x1) / 2, top, o.z0 + mm(80)));
        const u1 = tc.objects.all('unit').at(-1);
        const f2 = await put(new V(u1.p[0] + mm(260), top, u1.p[2]));
        const u2 = tc.objects.all('unit').at(-1);
        const f3 = await put(new V(u1.p[0] + mm(130), u1.p[1] + mm(77), u1.p[2]));
        const u3 = tc.objects.all('unit').at(-1);
        const red = await put(new V(1.9, 0.1, 0), false);   // off the plot: nothing to set it on
        const yaw = (u) => Math.abs(Math.sin(2 * Math.atan2(u.q[1], u.q[3])));
        // on the block wall laid above (its top course)
        const blk = tc.objects.all('unit').filter((u) => u.kind === 'block').sort((a, b) => b.p[1] - a.p[1])[0];
        const f4 = blk && await put(new V(blk.p[0], blk.p[1] + blk.s[1] / 2 + mm(40), blk.p[2]));
        const u4 = tc.objects.all('unit').at(-1);
        out.tiers = {
          laid: tc.objects.all('unit').length - n0, okAll: !!(f1?.ok && f2?.ok && f3?.ok && f4?.ok), red: red ? !red.ok : true,
          flushMm: +((u1.p[2] - u1.s[2] / 2 - o.z0) * SC * 1000).toFixed(1), along: yaw(u1) < 0.01,
          stepMm: +(Math.hypot(u2.p[0] - u1.p[0], u2.p[2] - u1.p[2]) * SC * 1000).toFixed(1), level: Math.abs(u2.p[1] - u1.p[1]) * SC * 1000 < 0.5,
          upMm: +((u3.p[1] - u1.p[1]) * SC * 1000).toFixed(1), onBlockMm: blk ? +((u4.p[1] - u4.s[1] / 2 - blk.p[1] - blk.s[1] / 2) * SC * 1000).toFixed(1) : null,
        };
        tc.undo(); out.tiers.undo = tc.objects.all('unit').length === n0 + 3; tc.redo();
        // a block on the free brickwork: a block wall along it, on its top
        for (let k = 2; k <= 6; k++) await put(new V(u1.p[0] + mm(260 * k), top, u1.p[2]));   // (the finger on the slab: the course goes on)
        const last = tc.objects.all('unit').at(-1), wn = tc.objects.all('wall').length;
        tc.settings.wallKind = 'block'; tc.settings.wallHeight = 1000;
        wt.carry = { kind: 'block', pallet: null, snap: null }; wt._carryMove(new V(last.p[0], last.p[1] + last.s[1] / 2, last.p[2]), null); wt._carryDrop(); await settle();
        const nb = tc.objects.all('unit').at(-1);
        out.tiers.blockOnBricks = nb && nb.kind === 'block' && nb.free ? { glueMm: +((nb.p[1] - nb.s[1] / 2 - (last.p[1] + last.s[1] / 2)) * SC * 1000).toFixed(1), noWall: tc.objects.all('wall').length === wn } : null;
        // a second block beside it: the same course, a 3 mm joint
        wt.carry = { kind: 'block', pallet: null, snap: null }; wt._carryMove(new V(nb.p[0] - mm(620), nb.p[1], nb.p[2]), null); wt._carryDrop(); await settle();
        const nb2 = tc.objects.all('unit').at(-1);
        if (out.tiers.blockOnBricks) { out.tiers.blockOnBricks.besideLevel = nb2 !== nb && Math.abs(nb2.p[1] - nb.p[1]) * SC * 1000 < 0.5; out.tiers.blockOnBricks.stepMm = +(Math.hypot(nb2.p[0] - nb.p[0], nb2.p[2] - nb.p[2]) * SC * 1000).toFixed(1); }
        tc.settings.wallHeight = 1000; tc.settings.wallKind = 'block';
      }
      tc.setTool('camera');
    }
    // spilled concrete outside: the shovel takes it (only it, not the soil) and tips it into the form
    {
      const o = tc.objects.all('outline').find((x) => x.kind === 'rect');
      tc.setTool('hose'); const h = tc.activeTool();
      h.down(new V(0.3, 0.1, 0.75)); tc.simulate(4); h.up();
      for (let i = 0; i < 300 && tc.busy(); i++) tc.simulate(1 / 15);
      const near = () => { let v = 0; for (let z = 0.55; z <= 0.95; z += t.cell) for (let x = 0.1; x <= 0.5; x += t.cell) v += t.conc[t.index(x, z)]; return v * t.cellArea; };
      const c0 = t.concVolume(), s0 = t.totalVolume(), at0 = t.conc[t.index(0.3, 0.75)], n0 = near();
      tc.setTool('shovel'); const sh = tc.shovelTool;
      sh.down(new V(0.28, 0.1, 0.75)); for (let s = 0; s < 1 && sh.state === 'dig'; s += 0.04) sh.move(new V(0.28 + 0.06 * s, 0.1, 0.75)); sh.up();
      const loaded = sh.mat === 9 && sh.load > 0, took = n0 - near() > sh.load * 0.9;
      if (sh.state === 'loaded') { sh.down(new V((o.x0 + o.x1) / 2, 0.1, (o.z0 + o.z1) / 2)); sh.up(); }
      for (let i = 0; i < 400 && sh.state !== 'idle'; i++) tc.simulate(0.05);
      const c1 = t.concVolume(), cs = t.conc.slice();
      tc.undo(); const back = Math.abs(t.conc[t.index(0.3, 0.75)] - at0) < 1e-9; tc.redo();
      let ce = 0; for (let i = 0; i < cs.length; i++) ce = Math.max(ce, Math.abs(cs[i] - t.conc[i]));
      out.shovelConc = { loaded, took, vol: Math.abs(c1 / c0 - 1), soil: Math.abs(t.totalVolume() - s0) * 1e9, undo: back && ce < 1e-9 };
    }
    out.objects = { outlines: tc.objects.all('outline').length, forms: tc.objects.all('form').length, cages: tc.objects.all('cage').length, tied: tc.objects.all('cage').some((c) => c.tied) };
    // stripping: soft concrete only warns; once it has set the boards come off into a stack; undo
    {
      const o = tc.objects.all('outline').find((x) => x.kind === 'rect');
      const mine = () => tc.objects.all('form').filter((f) => f.outlineId === o.id).length;
      const n0 = mine(), cv = t.concVolume();
      tc.setTool('form'); tc.formTool.setMode('strip');
      tc.formTool.down(new V((o.x0 + o.x1) / 2, 0.1, (o.z0 + o.z1) / 2), e);
      const warned = mine() === n0;
      tc.formTool._force = null;
      tc.clock += 200; tc.simulate(0.1);
      tc.formTool.down(new V((o.x0 + o.x1) / 2, 0.1, (o.z0 + o.z1) / 2), e);
      for (let i = 0; i < 200 && tc.physLoading; i++) await new Promise((r) => setTimeout(r, 50));
      const running = !!tc.physJob;
      for (let i = 0; i < 1200 && tc.physJob; i++) tc.simulate(1 / 30);   // the boards fall and are stacked (Rapier)
      const pile = tc.objects.all('formpile')[0];
      const stripped = mine() === 0 && !!pile && pile.boards.length >= n0;
      tc.undo(); const back = mine() === n0 && !tc.objects.all('formpile').length; tc.redo();
      out.strip = { n0, warned, running, stripped, items: pile?.items?.length, still: !!pile?.items?.every((it) => it.p.every(Number.isFinite)), boards: pile?.boards.length, stakes: pile?.stakes, back, conc: Math.abs(t.concVolume() - cv) < 1e-12 };
    }
    tc.setTool('camera');
    await tc.saveNow();
    out.saved = { n: tc.journal.done.length, o: tc.objects.all().length, exc: +(t.excavatedVolume() * 1e6).toFixed(3), sand: +(t.materialVolumes()[1] * 1e6).toFixed(2), conc: +(t.concVolume() * 1e6).toFixed(2) };
    return out;
  });
  check('shovel digs (3 passes ≥ 25 mm)', play.depth > 0.025, `${(play.depth * 1000).toFixed(1)} mm, ${play.scoops} scoops`);
  check('soil volume conserved', Math.abs(play.drift) < 50, `${play.drift.toFixed(2)} mm3`);
  check('spoil remembers the layer it came from', play.spoilDepth > 0.003, `${(play.spoilDepth * 1000).toFixed(1)} mm`);
  check('undo / redo exact', play.undo);
  check('rake lowers the heap, keeps the soil, undoes', play.rake.h1 < play.rake.h0 - 5 && Math.abs(play.rake.drift) < 50 && play.rake.strokes === 4 && play.rake.undo,
    `${play.rake.h0.toFixed(1)} → ${play.rake.h1.toFixed(1)} mm, ${play.rake.drift.toFixed(2)} mm3, ${play.rake.strokes} strokes`);
  check('sand: heap of the ordered volume, shovel carries sand, layers undo exactly', play.mats.group === 'sand' && Math.abs(play.mats.heap - 1) < 1e-4 && play.mats.sand > 0.98 && play.mats.sand < 1.0001 && play.mats.loadSand && play.mats.dumpedSand && play.mats.undo && Math.abs(play.mats.drift) < 1e-4, JSON.stringify(play.mats));
  check('concrete: pumped volume exact, held by the formwork, undo exact', Math.abs(play.conc.vol - 1) < 1e-4 && play.conc.leak < 0.001 && play.conc.undo, JSON.stringify(play.conc));
  check('sand on concrete lies on top (concrete unchanged), volume exact, undo', play.sandOnConc.onTop && play.sandOnConc.concMoved === 0 && play.sandOnConc.vol < 1e-4 && play.sandOnConc.back, JSON.stringify(play.sandOnConc));
  check('plate compactor: loose soil settles and gets compacted, native ground kept, undo exact', play.plate.settledMm > 0.1 && play.plate.comp > 0.1 && play.plate.nativeKept && play.plate.back, JSON.stringify(play.plate));
  check('free brickwork: along the slab edge, continues the course (260 mm, level), next course 77 mm up, red with nothing under, on blockwork, undo; blocks on the free bricks, side by side', play.tiers?.laid === 4 && play.tiers.okAll && play.tiers.red && play.tiers.along && Math.abs(play.tiers.stepMm - 260) < 1 && play.tiers.level && Math.abs(play.tiers.upMm - 77) < 1 && Math.abs(play.tiers.onBlockMm - 12) < 2 && play.tiers.undo && Math.abs(play.tiers.blockOnBricks?.glueMm - 3) < 1 && play.tiers.blockOnBricks.noWall && play.tiers.blockOnBricks.besideLevel && Math.abs(play.tiers.blockOnBricks.stepMm - 603) < 2, JSON.stringify(play.tiers));
  check('walls: a block carried from the pallet (let go in the open → back), laid at its place with mortar, undo', play.walls.refused && play.walls.laid && play.walls.bed && play.walls.errMm < 2 && play.walls.back && play.walls.rows === 3, JSON.stringify(play.walls));
  check('shovel takes spilled fresh concrete and tips it into the form, volume exact, undo', play.shovelConc.loaded && play.shovelConc.took && play.shovelConc.vol < 1e-6 && play.shovelConc.undo, JSON.stringify(play.shovelConc));
  check('trench, formwork, cage and ties placed', play.objects.outlines === 2 && play.objects.forms >= 8 && play.objects.cages === 1 && play.objects.tied, JSON.stringify(play.objects));
  await page.reload({ timeout: 120000 });   // (a loaded container: the load event can take more than 30 s)
  await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 });
  const after = await page.evaluate(() => { const tc = window.__tc; return { n: tc.journal.done.length, o: tc.objects.all().length, exc: +(tc.terrain.excavatedVolume() * 1e6).toFixed(3), sand: +(tc.terrain.materialVolumes()[1] * 1e6).toFixed(2), conc: +(tc.terrain.concVolume() * 1e6).toFixed(2) }; });
  check('stripping: warns while soft, then boards come off into a stack, concrete stays, undo', play.strip.warned && play.strip.running && play.strip.still && play.strip.stripped && play.strip.back && play.strip.conc && play.strip.n0 > 0, JSON.stringify(play.strip));
  check('project restored after reload', JSON.stringify(after) === JSON.stringify(play.saved), `${JSON.stringify(play.saved)} → ${JSON.stringify(after)}`);
  check('no console errors while playing', errors.length === 0, errors.slice(0, 3).join(' | '));
  const build = fs.readFileSync(path.join(root, 'src/config.js'), 'utf8').match(/BUILD = (\d+)/)[1];
  check('BUILD number in the game matches config', String(play.build) === build, `BUILD ${play.build}`);
  await browser.close();
}
console.log('—', sec());

// ---- 2a. The garden: a path, a lawn and a fence through all their stages -------------------------
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const land = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, out = {};
    tc.setTool('wall'); wt.setMode('lay');
    const e = (p) => { const sp = wt._screen(p); return { clientX: sp.x, clientY: sp.y }; };
    const drag = (pts) => { wt.down(pts[0], e(pts[0])); for (const p of pts) wt.move(p, e(p)); wt.up(); };
    const tap = (p) => { wt.down(p, e(p)); wt.up(); for (let i = 0; i < 4000 && tc.physJob; i++) tc.simulate(1 / 30); tc.simulate(0.05); };
    tc.rig.setState({ target: [0, 0.1, 0], yaw: 0.5, pitch: 0.9, dist: 1.6 }); tc.simulate(0.05);
    // (the path by hand: its own section, 2f)
    tc.settings.wallKind = 'land';
    // a lawn (by hand: the string, the black topsoil, the turf, the water)
    Object.assign(tc.settings, { landWhat: 'lawn', lawnLayer: 'area', lawnHow: 'turf' }); tc.wallTool.land.lw.cord = true;
    drag([new V(-0.55, 0.1, -0.05), new V(0.15, 0.1, 0.45)]); tc.wallTool.land.lw.cord = false;
    for (const k of ['soil', 'grass', 'water']) { tc.settings.lawnLayer = k; tap(new V(0.05, 0.1, 0.0)); }
    const lawn = tc.objects.all('lawn')[0];
    out.lawn = { done: Object.keys(lawn?.done || {}).join(), cells: tc.gardenView.parts.get('L' + lawn?.id)?.sub.body?.children.length };
    // a fence of the old kind (put up at once, before BUILD 245) read from a project: a fence by the post —
    // its holes, posts, rails and slats done, its wicket hung; undone and redone it stays the new kind
    { const g = tc.terrain.heightAt(-0.2, 0.55), old = { type: 'fence', pts: [[-0.6, 0.55], [0.2, 0.55]], H: 1800, kind: 'slat', col: 'graphite', g, done: { holes: 1, posts: 1, fill: 1 }, gates: [{ s: 2000, w: 1000, type: 'wicket', open: true, hung: 1 }] };
      tc.journal.act('fence-old', {}, tc.clock, () => tc.objects.add(old)); tc.simulate(0.05);
      const f1 = tc.objects.all('fence')[0]; tc.undo(); tc.redo(); tc.simulate(0.05); const f = tc.objects.all('fence')[0], B = (await import('/src/world/fence2.js')).bays2(f);
      out.fence = { v: f1?.v === 2 && f?.v === 2 && !f.done, posts: f.pegs.filter((q) => q.post && q.fill >= 1).length, railed: B.filter((b) => b.railed && b.filled).length, gate: f.gates.map((q) => q.type + (q.hung ? ':hung' : '') + (q.open ? ':open' : '')).join() + (B.some((b) => b.gate === 0) ? ':bay' : ''), drawn: !!tc.gardenView.parts.get('F' + f.id)?.sub.fill }; }
    // a path and a lawn of the old kind (before BUILD 253 / 254), finished: read as laid by hand — every kerb,
    // the fabric, every paver; the lawn with its turf — and drawn
    { const G = await import('/src/world/garden.js'), g = tc.terrain.heightAt(-0.2, -0.62);
      tc.journal.act('path-old', {}, tc.clock, () => tc.objects.add({ type: 'path', pts: [[-0.5, -0.62], [0.1, -0.62]], W: 1200, g, paver: 'brick', col: 'grey', done: { dig: 1, kerb: 1, geo: 1, grav: 1, sand: 1, pave: 1, joint: 1 } }));
      tc.undo(); tc.redo();
      const lo = tc.objects.add({ type: 'lawn', poly: [[0.3, -0.25], [0.5, -0.25], [0.5, -0.05], [0.3, -0.05]], g: tc.terrain.heightAt(0.4, -0.15), u: [1, 0], how: 'turf', done: { soil: 1, rake: 1, roll: 1, grass: 1, water: 1 } });
      tc.simulate(0.05);
      const p = tc.objects.all('path').at(-1), pe = tc.gardenView.parts.get(p.id), l = tc.objects.get(lo.id);
      out.old = { path: p.v === 2 && p.laid.length === G.paversOf(p).length && p.kerbs.length === G.kerbsOf(p).length && p.geo.length === 1 && !!pe?.sub.pave && !!pe?.sub.kerb, lawn: l.v === 2 && !!tc.gardenView.parts.get('L' + l.id)?.sub.body };
      tc.objects.remove(p.id); tc.objects.remove(l.id); }
    // plants and a light
    Object.assign(tc.settings, { landWhat: 'plant' });
    for (const [k, x] of [['tree', 0.3], ['ball', 0.35], ['thuja', 0.4], ['bollard', 0.45]]) { tc.settings.plantKind = k; tap(new V(x, 0.1, -0.3)); }
    tc.settings.plantKind = 'hedge'; const Hg = []; for (let i = 0; i <= 10; i++) Hg.push(new V(0.3 + 0.2 * i / 10, 0.1, -0.4)); drag(Hg); for (let i = 0; i < 4000 && tc.physJob; i++) tc.simulate(1 / 30);
    out.plants = tc.objects.all('plant').map((q) => q.kind).join();
    // a porch to a door with its sill 700 over the ground, and a canopy over it
    const S = 1 / 1000 / (9000 / 860);
    tc.journal.act('door', {}, tc.clock, () => tc.objects.add({ type: 'window', key: 'door1', w: 1000, h: 2100, t: 300, x: -0.9, y: 0.1 + 700 * S, z: -0.6, yaw: 0 }));
    Object.assign(tc.settings, { wallKind: 'ext', extWhat: 'porch' });
    const D = new V(-0.9, 0.1, -0.5);
    for (const k of ['dig', 'grav', 'form', 'conc', 'strip', 'tile']) { tc.settings.porchLayer = k; tap(D); }
    tc.settings.extWhat = 'canopy'; tap(D);
    Object.assign(tc.settings, { extWhat: 'light', flKind: 'steps' }); tap(D);
    const po = tc.objects.all('porch')[0];
    out.porch = { steps: po?.n, rise: po?.rise, done: Object.keys(po?.done || {}).join(), canopy: tc.objects.all('canopy').length, lights: tc.objects.all('flight').map((q) => q.kind).join() };
    // «Готово»: a window, the rooms behind it furnished; again: gone; undo brings them back
    tc.journal.act('win', {}, tc.clock, () => tc.objects.add({ type: 'window', key: 'pano', w: 2400, h: 2100, t: 300, x: 0.2, y: 0.1, z: -0.6, yaw: 0 }));
    const on = tc.wallTool.ext.ready(); for (let i = 0; i < 30; i++) tc.simulate(1 / 30);
    const rooms = tc.gardenView.interior?.userData.rooms;
    const s0 = tc.objects.all('interior')[0]?.seed; tc.wallTool.ext.reroll(); for (let i = 0; i < 30; i++) tc.simulate(1 / 30);
    const rerolled = tc.objects.all('interior')[0]?.seed !== s0 && !!tc.gardenView.interior;
    tc.wallTool.ext.ready(); for (let i = 0; i < 30; i++) tc.simulate(1 / 30);
    const off = !tc.gardenView.interior; tc.undo(); for (let i = 0; i < 30; i++) tc.simulate(1 / 30);
    out.interior = { on, rooms, rerolled, off, back: !!tc.gardenView.interior };
    // openings: a doorway in a block wall from the floor, a brick pier on the same line laid
    // to other heights (its courses neither split nor shorten it)
    { const { findOpenings } = await import('/src/tools/windowFit.js');
      const S = 1 / 1000 / (9000 / 860), X0 = 1.2, Z0 = 1.2, y0 = tc.terrain.heightAt(X0, Z0), q = [0, 0, 0, 1], recs = [];
      for (let r = 0; r < 10; r++) for (let k = 0; k < 10; k++) { const a = k * 603 + 300 + (r % 2) * 300; if (a > 6000 - 300 || (r < 8 && a > 1500 && a < 4500)) continue; recs.push({ type: 'unit', free: true, kind: 'block', p: [X0 + a * S, y0 + (3 + r * 253 + 125) * S, Z0], q, s: [600 * S, 250 * S, 300 * S], bedT: 3 * S }); }
      for (let r = 0; r < 30; r++) for (const a of [-1100, -850]) recs.push({ type: 'unit', free: true, kind: 'brick', p: [X0 + a * S, y0 + (19 + r * 77 + 32.5) * S, Z0], q, s: [250 * S, 65 * S, 120 * S], bedT: 12 * S });
      tc.journal.act('pier', {}, tc.clock, () => { for (const r of recs) tc.objects.add(r); });
      const o = findOpenings(tc).find((v) => Math.abs(v.x - (X0 + 3000 * S)) < 0.02 && Math.abs(v.z - Z0) < 0.02);
      out.pier = o && { ok: o.ok, w: o.w, h: o.h, floor: Math.round((o.y0 - y0) / S) };
      tc.undo();
      // a ring beam over two hollow piers (two rows of bricks, 140 mm between) 3 m apart: one beam
      // as wide as the piers over the span, not a strip over each row
      const { findBelt } = await import('/src/tools/belt.js'), P = [];
      for (let r = 0; r < 12; r++) for (const a of [0, 3380]) for (const t of [-130, 130]) P.push({ type: 'unit', free: true, kind: 'brick', p: [X0 + a * S, y0 + (12 + r * 77 + 32.5) * S, Z0 + t * S], q, s: [380 * S, 65 * S, 120 * S], bedT: 12 * S });
      tc.journal.act('piers', {}, tc.clock, () => { for (const r of P) tc.objects.add(r); });
      const top = P.at(-1), B = findBelt(tc, new V(top.p[0], top.p[1] + 32.5 * S, top.p[2]), null, null), sp = B?.rec.spans || [];
      out.span = { spans: sp.length, wide: sp.map(([i0, j0, i1, j1]) => Math.min(i1 - i0, j1 - j0) * 50), long: sp.map(([, , , , , , L]) => L) };
      // cast, it ties the piers into one building: one wall plate, one roof over both
      { const { buildings } = await import('/src/tools/pitchedTool.js'), at = (a) => (g) => g.some((b) => Math.abs(b.x - (X0 + a * S)) < 0.01 && Math.abs(b.z - Z0) < 0.03);
        const apart = !buildings(tc).some((g) => at(0)(g) && at(3380)(g));
        tc.journal.act('ring', {}, tc.clock, () => tc.objects.add({ ...B.rec, fill: 1, castT: -1e6, set: true, stripped: true }));
        out.span.tied = apart && buildings(tc).some((g) => at(0)(g) && at(3380)(g)); tc.undo(); }
      // the wall plate on a block house 6 × 6 m with a brick pier standing 150 mm out of a wall:
      // the walls' face and thickness (300) from the walls, not the pier; moved by the finger across
      { const { findHouse } = await import('/src/tools/pitchedTool.js'), U = [], qz = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
        for (let r = 0; r < 4; r++) for (let k = 0; k < 10; k++) {
          const a = -2700 + k * 600 + 300, y = y0 + (3 + r * 253 + 125) * S;
          if (a < 2700) { U.push({ type: 'unit', free: true, kind: 'block', p: [X0 + a * S, y, Z0 - 2850 * S], q, s: [600 * S, 250 * S, 300 * S], bedT: 3 * S }, { type: 'unit', free: true, kind: 'block', p: [X0 + a * S, y, Z0 + 2850 * S], q, s: [600 * S, 250 * S, 300 * S], bedT: 3 * S }); }
          const b = -3000 + k * 600 + 300;
          if (b < 3000) U.push({ type: 'unit', free: true, kind: 'block', p: [X0 - 2850 * S, y, Z0 + b * S], q: qz, s: [600 * S, 250 * S, 300 * S], bedT: 3 * S }, { type: 'unit', free: true, kind: 'block', p: [X0 + 2850 * S, y, Z0 + b * S], q: qz, s: [600 * S, 250 * S, 300 * S], bedT: 3 * S });
        }
        for (let r = 0; r < 13; r++) for (const t of [-65, 65]) U.push({ type: 'unit', free: true, kind: 'brick', p: [X0 + 3025 * S, y0 + (12 + r * 77 + 32.5) * S, Z0 + (500 + t) * S], q, s: [250 * S, 65 * S, 120 * S], bedT: 12 * S });
        tc.journal.act('house', {}, tc.clock, () => { for (const r of U) tc.objects.add(r); });
        const P0 = new V(X0 + 2850 * S, y0 + 1015 * S, Z0), H = findHouse(tc, P0), w = H?.wings[0];
        const pt = tc.wallTool.proof; tc.settings.proofStage = 'plate'; pt.carryMove(new V(X0 + 2910 * S, y0 + 1015 * S, Z0), null); const po = pt.place?.rec.po;
        pt.carryMove(new V(X0 + 2700 * S, y0 + 1015 * S, Z0), null); const po2 = pt.place?.rec.po; pt.place = null; pt.carryDrop();
        out.plate = H && { T: Math.round(H.T / S), A: Math.round(w.A / S), B: Math.round(w.B / S), po, po2 };
        // the facade at a corner: boards on one wall run on round it over the other's end — that end
        // is insulation of the other face: glued over, a panel goes on it (cut to it)
        { const FM = await import('/src/world/facade.js'), ft = tc.wallTool.facade, fs = ft.faces(), MM = (v) => v * S;
          const F = fs.find((q) => q.cn1 && q.a1 - q.a0 > MM(1000)), G = F?.cn1.G, ge = G && (Math.abs(G.a0 - F.cn1.aF) < Math.abs(G.a1 - F.cn1.aF) ? 0 : 1);
          const r0 = { type: 'facade', ux: F.ux, uz: F.uz, sg: F.sg, P: F.P, y0: F.y0, eps: [] }, rg = { type: 'facade', ux: G.ux, uz: G.uz, sg: G.sg, P: G.P, y0: G.y0, eps: [] };
          // F's boards at its corner end running on over G's end (G has a board there flush)
          for (let k = 0; k < 2; k++) { const y = F.y0 + MM(500) * k; r0.eps.push([F.a1 - MM(900), y, F.a1 + MM(100), y + MM(500), F.a1 - MM(900), F.a1 + MM(100)]); }
          for (let k = 0; k < 2; k++) { const y = G.y0 + MM(500) * k, e = ge ? G.a1 : G.a0; rg.eps.push(ge ? [e - MM(1000), y, e, y + MM(500)] : [e, y, e + MM(1000), y + MM(500)]); }
          tc.journal.act('fac', {}, tc.clock, () => { tc.objects.add(r0); tc.objects.add(rg); });
          const ends = FM.cornerEnds(G, (X) => ft._rec(X)), eA = ends[0] ? (ends[0][0] + ends[0][2]) / 2 : null, eY = G.y0 + MM(250);
          const glueOk = eA != null && ft._under(G, ft._rec(G), 'glue')(FM.ck(Math.floor(eA / FM.CELL), Math.floor(eY / FM.CELL)));
          const sl = FM.slotAt(G, eA ?? 0, eY, 'pan', [600, 300]), tr = eA != null ? ft._panTrim(G, ft._rec(G), sl, eA) : null;
          out.corner = { ends: ends.length, glueOk, pan: tr && Math.round((tr[2] - tr[0]) / S) };
          // a stroke at a wall with only the sky behind the finger (looking up under the eaves): the
          // facade still gets it — the camera does not take it; the shovel still leaves the sky to the camera
          { const st0 = tc.rig.state(); tc.rig.setState({ target: [X0, y0 + MM(2500), Z0], yaw: 0, pitch: -0.35, dist: 0.25 }); tc.simulate(1 / 30);
            const W = innerWidth / 2, H = innerHeight * 0.12, k0 = tc.settings.wallKind, t0 = tc.tool;
            tc.setTool('wall'); tc.settings.wallKind = 'facade'; tc.wallTool.setMode('lay'); const onFac = !!tc.gestures.point(W, H);
            tc.setTool('shovel'); const onShovel = !!tc.gestures.point(W, H);
            tc.settings.wallKind = k0; tc.setTool(t0); tc.rig.setState(st0);
            out.corner.sky = { onFac, onShovel }; }
          tc.undo(); }
        tc.undo(); }
      tc.undo(); }
    return out;
  });
  check('«Готово»: rooms furnished behind the windows, another interior, off again, undo', land.interior.on && land.interior.rooms >= 1 && land.interior.rerolled && land.interior.off && land.interior.back, JSON.stringify(land.interior));
  check('garden: a lawn (topsoil, turf, water), old fence / path / lawn read as today\'s (posts, rails, slats, wicket; kerbs, pavers; turf), plants and a light', land.lawn.done === 'soil,grass,water' && land.lawn.cells >= 2 && land.fence.v && land.fence.posts >= 5 && land.fence.railed >= 3 && land.fence.gate === 'wicket:hung:open:bay' && land.fence.drawn && land.old.path && land.old.lawn && land.plants === 'tree,ball,thuja,bollard,hedge', JSON.stringify({ lawn: land.lawn, fence: land.fence, plants: land.plants }));
  check('exterior: a porch cast to a door (pit, stone, forms, concrete, stripped, tiled) and a canopy over it', land.porch.steps === 3 && land.porch.done === 'dig,grav,form,conc,strip,tile' && land.porch.canopy === 1 && land.porch.lights === 'steps', JSON.stringify(land.porch));
  check('openings: a doorway from the floor beside a brick pier on the same line', land.pier?.ok && land.pier.floor <= 5 && land.pier.h >= 8 * 253 - 10 && land.pier.w > 2300, JSON.stringify(land.pier));
  check('ring beam over hollow piers: one beam as wide as the piers; cast, one building (one wall plate)', land.span?.spans === 1 && land.span.wide[0] >= 350 && land.span.tied,JSON.stringify(land.span));
  check('wall plate: on the walls\' face and middle (a pier standing out ignored), moved across by the finger', land.plate && Math.abs(land.plate.T - 300) <= 10 && Math.abs(land.plate.A - 3000) <= 10 && Math.abs(land.plate.B - 3000) <= 10 && land.plate.po === 60 && land.plate.po2 === -75, JSON.stringify(land.plate));
  check('facade corner: the board ends round a corner are glued and take a panel (cut to them); a stroke with the sky behind it reaches the facade', land.corner?.ends >= 2 && land.corner.glueOk && land.corner.pan >= 60 && land.corner.sky?.onFac && !land.corner.sky.onShovel, JSON.stringify(land.corner));
  check('garden: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2b. English: a device in English gets the whole game in English ------------------------------
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }, 'en-US');
  const en = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ui = window.__tc.ui, left = new Set();
    const scan = () => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/[А-яЁё]/.test(n.nodeValue) && !n.parentElement.closest('[data-notr]')) left.add(n.nodeValue.trim()); };
    for (const g of ui.groups) { ui.openGroup(g.id); await sleep(40); scan(); for (const b of ui.groupTools(g.id)) { ui.openGroup(g.id); b.click(); await sleep(40); scan(); } }
    ui.toast('Ряд ${3} готов — дальше ряд ${4}'.replace('${3}', 2).replace('${4}', 3)); await sleep(20);
    const toast = document.getElementById('toast').textContent;
    ui.openMenu(true); await sleep(60); scan();
    return { lang: document.documentElement.lang, left: [...left].slice(0, 5), toast, menu: document.querySelector('#menu h4').textContent };
  });
  check('English: the page, the tools and the toasts are in English', en.lang === 'en' && !en.left.length && en.toast === 'Course 2 done — next course 3' && en.menu === 'Tool', JSON.stringify(en));
  check('English: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2c. the modelled doors, gates and windows: all come, each fits any opening ------------------
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const op = await page.evaluate(async () => {
    const K = await import('/src/world/openingKits.js'), Wn = await import('/src/world/windows.js'), Dr = await import('/src/world/doors.js');
    await K.loadKits();
    const out = { kits: K.kitsLoaded(), want: Object.keys(K.KITS).length, bad: [], band: 0, hold: null, built: 0 };
    // every window / door / gate at a small and a big opening: inside the opening (its sill, casings,
    // guides a little past it), nothing NaN, of the model when it has one
    const T = await import('three'), b = new T.Box3();
    const sizes = (k) => (k.startsWith('gar') ? [[2400, 2000], [5500, 2600]] : k === 'door6' ? [[1400, 2050], [2200, 2500]] : k === 'portal' ? [[1800, 2100], [4200, 2600]] : [[900, 1200], [2400, 2400]]);
    for (const key of [...Object.keys(Wn.WINDOWS).filter((k) => k !== 'corner'), ...Object.keys(Dr.DOORS)]) for (const [w, h] of sizes(key)) {
      const door = Dr.isDoor(key), g = (door ? Dr.buildDoor : Wn.buildWindow)(key, w, h, 300, 'brown');
      g.scale.setScalar(1); g.updateMatrixWorld(true); b.setFromObject(g); out.built++;
      const pad = key.startsWith('gar') ? 400 : 150, ok = [b.min.x, b.max.x, b.min.y, b.max.y].every(Number.isFinite) && b.min.x > -w / 2 - pad && b.max.x < w / 2 + pad && b.min.y > -120 && (key.startsWith('gar') || b.max.y < h + pad);
      const model = door ? !!(Dr.doorKit?.(key) || ['gar3', 'gar4'].includes(key)) : !!Wn.windowKit(key);
      if (!ok || !model) out.bad.push(`${key} ${w}x${h} ${ok ? '' : 'box ' + [b.min.x, b.max.x, b.min.y, b.max.y].map(Math.round)} ${model ? '' : 'drawn'}`);
    }
    // the frame keeps its width: the band along the left edge of a 1000 and a 2000 window only moves
    const a1 = K.fitKit('w_tilt', -500, 500, 0, 1400, 0), a2 = K.fitKit('w_tilt', -1000, 1000, 0, 1400, 0);
    for (let p = 0; p < a1.length; p++) { const x1 = a1[p].geo.attributes.position, x2 = a2[p].geo.attributes.position; for (let i = 0; i < x1.count; i++) if (x1.getX(i) < -500 + 100 && Math.abs(x2.getX(i) - x1.getX(i) + 500) > 0.01) out.band++; }
    // a door's handle stays at the height of a hand on a taller door
    const hy = (h) => { const q = K.fitKit('d_steel_grey', -500, 500, 0, h, 0).filter((x) => x.role === 'metal'); const bb = new T.Box3(); for (const x of q) { x.geo.computeBoundingBox(); bb.union(x.geo.boundingBox); } return Math.round((bb.min.y + bb.max.y) / 2); };
    out.hold = [hy(2050), hy(2600)];
    return out;
  });
  check('openings: the door, gate and window models all load; every kind is made of them and fits small and big openings', op.kits === op.want && !op.bad.length && op.built > 40, JSON.stringify({ ...op, bad: op.bad.slice(0, 6) }));
  check('openings: a model\'s frame keeps its width when stretched (9-slice), a door\'s handle stays at hand height', op.band === 0 && Math.abs(op.hold[0] - op.hold[1]) < 5, JSON.stringify({ band: op.band, hold: op.hold }));
  // «Готово» on a house of blocks 8 × 7 m (walls 3 m), an inner wall with a doorway under its lintel,
  // windows and a door round it: two rooms, parted by that wall, its doorway open, the ceiling at the
  // top of the walls (not up under the roof), clear of the walls
  const plan = await page.evaluate(async () => {
    const tc = window.__tc, S = 1 / 1000 / (9000 / 860), M = (v) => v * S, g0 = tc.terrain.heightAt(0, 0);
    const blocks = [];
    const wall = (x0, z0, x1, z1, skip = () => false) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.round(L / 600), yaw = Math.atan2(-(z1 - z0), x1 - x0);
      for (let r = 0; r < 12; r++) for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
        if (skip(x, z, r)) continue;
        blocks.push({ type: 'unit', kind: 'block', free: true, s: [M(L / n - 10), M(240), M(300)], p: [M(x), g0 + M(125 + r * 250), M(z)], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });
      }
    };
    wall(-4000, 3350, 4000, 3350); wall(-4000, -3350, 4000, -3350); wall(-3850, -3200, -3850, 3200); wall(3850, -3200, 3850, 3200);
    wall(300, -3200, 300, 3200, (x, z, r) => Math.abs(z) < 600 && r < 9);   // (the inner wall: its doorway 1,7 m wide, the lintel over 2,25 m)
    tc.journal.act('house', {}, tc.clock, () => {
      for (const b of blocks) tc.objects.add(b);
      for (const [key, x, z, yaw, w, h, y] of [['pvc2', -2000, 3350, 0, 1200, 1400, 900], ['pvc2', 2000, 3350, 0, 1200, 1400, 900], ['pano', -2000, -3350, Math.PI, 2400, 2100, 0], ['gar1', 2075, -3350, Math.PI, 2500, 2100, 0], ['pvc1', -3850, 0, -Math.PI / 2, 900, 1400, 900]])
        tc.objects.add({ type: 'window', key, w, h, t: 300, x: M(x), y: g0 + M(y), z: M(z), yaw });
    });
    for (let i = 0; i < 6; i++) tc.simulate(1 / 30);
    const I = await import('/src/world/interior.js'), rooms = I.roomsOf(tc).filter((r) => Math.abs(r.o.x) < M(5000) && Math.abs(r.o.z) < M(5000));
    const G = I.buildInterior(tc, 1), pieces = []; G.traverse((o) => { if (o.name?.startsWith('F:')) pieces.push(o.name.slice(2)); });
    const out = rooms.map((r) => {
      const c = r.o.clone().addScaledVector(r.u, (r.a0 + r.a1) / 2).addScaledVector(r.n, -r.D / 2);
      return { kind: r.kind, car: r.kind === 'garage' ? pieces.filter((k) => k.startsWith('g_car')).length : undefined, gar: r.kind === 'garage' ? pieces.filter((k) => k.startsWith('g_')).length : undefined, H: Math.round((r.ceil - r.floor) / S), W: Math.round((r.a1 - r.a0) / S), D: Math.round(r.D / S), cx: Math.round(c.x / S), doors: Object.values(r.walls).flatMap((w) => w.open.filter((q) => q[4]).map((q) => Math.round(q[1] - q[0]))) };
    });
    tc.undo(); for (let i = 0; i < 4; i++) tc.simulate(1 / 30);
    return out;
  });
  const west = plan.find((r) => r.cx < 300), east = plan.find((r) => r.cx > 300);
  const gar = plan.find((r) => r.kind === 'garage');
  check('«Готово»: a room with a garage door is the garage — a car in it, the bench, the racks, the tyres…', gar && gar.cx > 300 && gar.car === 1 && gar.gar >= 8, JSON.stringify(gar));
  check('«Готово»: the rooms of a house of blocks — parted by its inner wall (its doorway open), the ceiling at the top of the walls', plan.length === 2 && west && east && plan.every((r) => r.H >= 2800 && r.H <= 3100 && r.D < 7000 && r.W < 7000) && west.W + east.W < 7800 && plan.every((r) => r.doors.some((d) => d > 1400 && d < 2000)), JSON.stringify(plan));
  check('openings: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2d. Columns and piles («Фундамент»): the formwork by the finger on what is under it, the cage
// carried into it, the concrete by the bucket and the hose, the stripping; a slab and a brick on them;
// the black topsoil delivered -----------------------------------------------------------------------
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const c = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, col = wt.col, o = {};
    const e = (p) => { tc.camera.updateMatrixWorld(); tc.camera.matrixWorldInverse.copy(tc.camera.matrixWorld).invert(); tc.camera.updateProjectionMatrix(); wt._rc = null; const sp = wt._screen(p); return { clientX: sp.x, clientY: sp.y }; };   // (the camera's matrices as a drawn frame has them)
    const run = () => { for (let i = 0; i < 4000 && tc.physJob; i++) tc.simulate(1 / 30); tc.simulate(0.05); };
    const G = (x, z) => new V(x, tc.terrain.heightAt(x, z), z), cols = () => tc.objects.all('column');
    tc.rig.setState({ target: [0, 0.05, 0], yaw: 0.5, pitch: 0.7, dist: 1.4 }); tc.simulate(0.05);
    tc.ui.openGroup('found'); tc.setTool('column'); tc.ui.refresh();
    o.chips = tc.ui.chips().map((q) => q.label).join('|');
    o.tray = document.getElementById('wall-tray').hidden ? '' : document.getElementById('wall-tray-label').textContent;
    o.wallCols = JSON.stringify((() => { tc.setTool('wall'); const x = JSON.stringify(tc.ui.chips()); tc.setTool('column'); return x; })()).includes('Колонны');
    Object.assign(tc.settings, { colSec: 'p300', colStage: 'form', colTilt: 0, colCourse: 'block', colN: 1 });
    for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [0, 0.1]]) { const p = G(x, z); col.down(p, e(p)); col.move(p, e(p)); col.up(); run(); }
    o.formed = cols().map((r) => `${r.stage}${r.cage}`).join();
    tc.settings.colSec = 'sq250'; { const p = G(0.3, 0.3); col.down(p, e(p)); o.sqOnSoil = !!col.drag?.P?.why; col.interrupt(); }
    tc.settings.colStage = 'cage';
    for (const r of cols()) { const far = G(r.x + 0.2, r.z + 0.2), mid = new V(r.x, r.y0 + r.h / 2, r.z); col.down(far, e(far)); col.move(G(r.x, r.z), e(mid)); col.up(); run(); }
    o.caged = cols().every((r) => r.cage);
    tc.setTool('pail'); const pail = tc.concreteTools.pail, r0 = cols()[0], top0 = new V(r0.x, r0.y0 + r0.h, r0.z);
    pail.down(top0, e(top0)); tc.simulate(8); pail.up(); tc.simulate(2);
    o.pail = tc.objects.get(r0.id).fill;
    tc.setTool('hose'); const hose = tc.concreteTools.hose;
    for (const r of cols()) { const top = new V(r.x, r.y0 + r.h, r.z); hose.down(top, e(top)); for (let i = 0; i < 80 && !hose.ch?.full; i++) { hose.move(top, e(top)); tc.simulate(0.25); } hose.up(); for (let k = 0; k < 40 && hose.state !== 'idle'; k++) tc.simulate(0.25); tc.simulate(0.1); }   // (the pour done before the next post is touched)
    o.cast = cols().map((r) => r.stage).join();
    tc.setTool('column'); tc.settings.colStage = 'strip'; tc.clock += 1e6; tc.simulate(0.05);
    for (const r of cols()) { const m = new V(r.x, r.y0 + r.h / 2, r.z); col.down(G(r.x, r.z), e(m)); col.up(); run(); }
    o.stripped = cols().map((r) => r.stage).join();
    const FB = await import('/src/tools/freeBrick.js'), r1 = cols()[1], tp = new V(r1.x, r1.y0 + r1.h, r1.z);
    tc.setTool('wall'); wt.setMode('lay');
    const pt = wt._pt(G(r1.x, r1.z), e(tp)), pu = FB.placeUnit(tc, 'brick', pt, (v) => wt._screen(v), null, false, {});
    o.brick = pu?.ok ? +((pu.p.y - pu.s.y / 2 - (r1.y0 + r1.h)) * 10465).toFixed(1) : null;   // (its bed over the top, mm)
    Object.assign(tc.settings, { wallKind: 'slab', slabCant: 0 });
    wt.carry = { kind: 'slab', tray: true, snap: null }; wt._carryMove(tp, e(tp)); wt._carryDrop(); run();
    o.slab = tc.objects.all('belt').filter((b) => b.kind === 'slab').map((b) => b.piles).join();
    // (and with a cantilever 1,5 m: the same slab set out reaches 1,5 m past the piles' edge — on its own props)
    { const SL = await import('/src/tools/slab.js'), P0 = SL.findPileSlab(tc, tp, (v) => wt._screen(v), null, undefined, 0), P1 = SL.findPileSlab(tc, tp, (v) => wt._screen(v), null, undefined, 1500);
      o.cant = P0 && P1 ? { cant: P1.rec.cant?.[2], grow: Math.round(((P1.rec.ni - P0.rec.ni) + (P1.rec.nj - P0.rec.nj)) * 100) } : null; }
    // (the slab cast: a column set on it over a pile — its continuation, as a frame building goes up; beside — allowed, said)
    { const sl = tc.objects.all('belt').find((b) => b.kind === 'slab'), Hm = sl.H / (1 / 1000 / 10.4651);
      tc.objects.update(sl.id, { lv: sl.lv.map(() => Math.round(Hm)), fill: 1, castT: tc.clock - 1e6, pourT: tc.clock - 1e6, wetT: tc.clock - 1e6 }); tc.simulate(0.05);
      const kt = tc.settings.colType; tc.settings.colType = 'sq'; const top = sl.top + sl.H, over = col.plan(new V(r1.x, top, r1.z), null), off = col.plan(new V(r1.x + (cols()[0].x - r1.x) / 2, top, r1.z + (cols()[0].z - r1.z) / 2), null);
      o.up = { over: over && !over.why && over.snap, off: off && !off.why ? off.snap || 'ok' : off?.why }; tc.settings.colType = kt; }
    // the piles' starter bars end inside the slab cast on them (200 thick, 40 cover over them)
    { const CM = await import('/src/world/columns.js'), T3 = await import('three'), sl = tc.objects.all('belt').find((b) => b.kind === 'slab'), bb = new T3.Box3();
      o.starter = Math.max(...cols().slice(0, 3).map((r) => { const g = CM.cageParts({ ...r, starter: CM.STARTER }).rebar; g.computeBoundingBox(); return Math.round((g.boundingBox.max.y - (sl.top + sl.H)) * 10465); })); void bb; }
    // either order: a pile's cage first (bored, lowered in), the formwork round it after
    tc.setTool('column'); Object.assign(tc.settings, { colType: 'pile', colA: 300, colStage: 'cage', colN: 2 });
    const p4 = G(0.3, -0.25); col.down(p4, e(p4)); col.move(p4, e(p4)); col.up(); run();
    const r4 = cols().at(-1); o.cageFirst = `${r4.stage}${r4.cage}`;
    tc.settings.colStage = 'form'; { const m = new V(r4.x, r4.y0 + r4.h / 2, r4.z); col.down(G(r4.x, r4.z), e(m)); col.move(G(r4.x, r4.z), e(m)); col.up(); run(); }
    o.formAfter = tc.objects.get(r4.id).stage;
    // the sliders: the picked column (no concrete) takes the size and the height
    col.select(tc.objects.get(r4.id), false); Object.assign(tc.settings, { colA: 400, colN: 4 }); col.preview(); o.preview = wt.col.V.patch.get(r4.id)?.a; col.restyle();
    o.resized = `${tc.objects.get(r4.id).a},${tc.objects.get(r4.id).n}`;
    // a cage tied into the cage of a foundation not cast yet (its feet down to the bottom bars)
    const g5 = tc.terrain.heightAt(-0.3, -0.3), M5 = 1 / 1000 / 10.4651;
    tc.objects.add({ type: 'cage', outlineId: 999, bars: [[-0.4, g5 - 200 * M5, -0.3, -0.2, g5 - 200 * M5, -0.3, 12 * M5], [-0.4, g5 + 100 * M5, -0.3, -0.2, g5 + 100 * M5, -0.3, 12 * M5]], chairs: [], frogs: [], ties: [] });
    Object.assign(tc.settings, { colType: 'sq', colA: 250, colStage: 'cage', colN: 4 }); { const p = G(-0.3, -0.3); col.down(p, e(p)); col.move(p, e(p)); col.up(); run(); }
    const r5 = cols().at(-1); o.tied = r5.anc; o.tiedStage = `${r5.stage}${r5.cage}`;
    tc.settings.colStage = 'form'; { const m = new V(r5.x, r5.y0 + r5.h / 2, r5.z); col.down(G(r5.x, r5.z), e(m)); col.move(G(r5.x, r5.z), e(m)); col.up(); run(); }
    o.tiedNoForm = tc.objects.get(r5.id).stage === 0;
    // a square column's cage on the bare soil: its hole bored first (1,2 m), the cage lowered into it
    Object.assign(tc.settings, { colType: 'sq', colA: 250, colStage: 'cage', colN: 4 }); { const p = G(0.35, 0.3); col.down(p, e(p)); col.move(p, e(p)); col.up(); run(); }
    const r6 = cols().at(-1); o.boredCage = `${r6.bored}|${Math.round(r6.dep * 10465)}|${r6.cage}`;
    // a leaning pile: the stream lands straight under the opening at the top (on the inner face of its low side)
    { const CT = await import('/src/tools/concreteTools.js'), M7 = 1 / 1000 / 10.4651, r7 = { x: 0, z: 0, y0: 0, h: 2800 * M7, dep: 2000 * M7, tilt: [0.27, 0], sec: 'pile', a: 300 }, q = CT.columnLanding(r7, -2000 * M7);
      o.landing = Math.abs(q.x - 0.27 * r7.h) < 1e-9 && Math.abs(q.z) < 1e-9 && q.y > 0 && q.y < r7.h; }
    tc.setTool('black'); Object.assign(tc.settings, { matMode: 'deliver', delivery: 1 }); const bl = tc.materialTools.black;
    bl.down(G(0.35, -0.3)); for (let i = 0; i < 400 && bl.busy; i++) tc.simulate(0.1);
    o.black = +(tc.terrain.materialVolumes()[4] * 10.47 ** 3).toFixed(2);
    tc.renderer.render(tc.scene, tc.camera); o.shader = tc.shaderErrors.length;
    return o;
  });
  check('columns: in «Фундамент» (sizes, formwork, cage, stripping), not under the walls; the tray holds the formwork', c.chips === 'Размеры|1 · Опалубка|2 · Каркас|3 · Распалубка|4 · Лифт-шахта|Удалить' && c.tray === 'Опалубка' && !c.wallCols, JSON.stringify(c));
  check('columns: three piles bored, their two-half formwork set; a column not on the bare soil; the cages carried in', c.formed === '2false,2false,2false' && c.sqOnSoil && c.caged, JSON.stringify(c));
  check('columns: the bucket and the hose fill them, stripped once strong; a brick and a slab on the piles (and with a cantilever); a column on the slab over a pile (its continuation)', c.pail > 0.03 && c.pail < 0.5 && c.cast === '3,3,3' && c.stripped === '4,4,4' && c.brick !== null && c.brick > 0 && c.brick < 25 && c.slab === '3' && c.starter < -30 && c.cant?.cant === 1500 && c.cant.grow >= 1400 && c.cant.grow <= 1600 && c.up?.over === 'over' && c.up.off && !/колонна/.test(c.up.off), JSON.stringify(c));
  check('columns: either order (a cage first, the formwork round it), tied into a foundation cage (no formwork till it is cast), the sliders resize the picked one', c.cageFirst === '0true' && c.formAfter === 2 && c.preview === 400 && c.resized === '400,4' && c.tied > 250 && c.tied < 450 && c.tiedStage === '0true' && c.tiedNoForm && c.boredCage === 'true|1200|true' && c.landing, JSON.stringify(c));
  check('black topsoil: delivered (1 m³), the soil shader builds', Math.abs(c.black - 1) < 0.05 && c.shader === 0, JSON.stringify(c));
  check('columns: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2d'. A tree column (a house on one support): a trunk Ø1200 with its bars round the edge, two branches
// out of its top leaning apart (30°), a slab on them with its cantilevers all round, 350 thick ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, col = wt.col, o = {}, MM = (v) => v / 1000 / 10.4651;
    const e = (p) => { tc.camera.updateMatrixWorld(); tc.camera.matrixWorldInverse.copy(tc.camera.matrixWorld).invert(); tc.camera.updateProjectionMatrix(); wt._rc = null; const sp = wt._screen(p); return { clientX: sp.x, clientY: sp.y }; };
    const SL = await import('/src/tools/slab.js'), CM = await import('/src/world/columns.js');
    const g = tc.terrain.heightAt(0, 0);
    tc.objects.add({ type: 'column', sec: 'rd', a: 1200, h: +MM(3000).toFixed(6), n: 10, course: 'block', tilt: [0, 0], x: 0, z: 0, y0: g, dep: 0, stage: 3, cage: true, fill: 1, on: 'concrete' });
    const tr = CM.secOf({ sec: 'rd', a: 1200 }); o.trunk = { bars: tr.bars, d: tr.d };
    tc.simulate(0.1);
    tc.rig.setState({ target: [0, g + MM(3000), 0], yaw: 0.3, pitch: 0.6, dist: 1.2 }); tc.simulate(0.05);
    tc.setTool('column');
    Object.assign(tc.settings, { colType: 'rd', colA: 700, colTilt: 30, colDir: 0, colN: 6, colCourse: 'block', colStage: 'form' });
    const top = new V(0, g + MM(3000), 0), behind = () => { const c = tc.camera.position, d = top.clone().sub(c); return c.clone().add(d.multiplyScalar((c.y - g) / (c.y - top.y))); };
    o.tilt = col.tiltDeg;
    const P1 = col.plan(behind(), e(top)); o.b1 = P1 && { why: P1.why, on: P1.rec.on, foot: Math.round((P1.rec.y0 - g) / MM(1)) };
    if (P1 && !P1.why) tc.objects.add({ ...P1.rec, stage: 3, fill: 1, cage: true });
    tc.settings.colDir = 180; const P2 = col.plan(behind(), e(top)); o.b2 = P2?.why ?? 'ok';
    if (P2 && !P2.why) tc.objects.add({ ...P2.rec, stage: 3, fill: 1, cage: true });
    tc.settings.colDir = 0; o.b3 = col.plan(behind(), e(top))?.why;   // (the same way again: in the way)
    tc.simulate(0.1);
    const br = tc.objects.all('column').filter((r) => r.tilt[0] || r.tilt[1]), t0 = br[0] && CM.axisAt(br[0], CM.colTop(br[0]));
    const S1 = t0 && SL.findPileSlab(tc, new V(t0[0], CM.colTop(br[0]), t0[1]), (v) => wt._screen(v), null, undefined, 3000);
    o.slab = S1 && { piles: S1.rec.piles, cants: S1.rec.cants?.length, H: Math.round(S1.rec.H / MM(1)), w: S1.rec.ni * 100, l: S1.rec.nj * 100, text: SL.cantText(S1.rec) };
    o.noCant = !!(t0 && SL.findPileSlab(tc, new V(t0[0], CM.colTop(br[0]), t0[1]), (v) => wt._screen(v), null, undefined, 0));
    return o;
  });
  check('tree column: a trunk Ø1200 has Ø32 bars every ~150 mm; two branches out of its top lean apart, the same way again is in the way', o.trunk.bars >= 20 && o.trunk.d === 32 && o.tilt === 30 && o.b1?.why == null && o.b1?.on === 'column' && Math.abs(o.b1.foot - 3000) < 5 && o.b2 === 'ok' && !!o.b3, JSON.stringify(o));
  check('tree column: a slab on its two branches — cantilevers all round (3 m), 350 thick; without a cantilever none', o.slab?.piles === 2 && o.slab.cants === 4 && o.slab.H === 350 && o.slab.w > 7500 && o.slab.l > 6500 && /кругом/.test(o.slab.text) && !o.noCant, JSON.stringify(o));
  check('tree column: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2d''. The villa's parts (the owner: no leg — the house stands on a glass lift shaft): the shaft on the
// ground by the column tool, a slab laid on its top (cantilevered all round, its opening over the shaft), the
// cabin riding up into the floor; the fascia on the slab's outer edges (not round the opening); a green roof —
// sedum in the field, gravel 500 mm along the parapet ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, o = {}, MM = (v) => v / 1000 / 10.4651;
    const e = (p) => { tc.camera.updateMatrixWorld(); tc.camera.matrixWorldInverse.copy(tc.camera.matrixWorld).invert(); tc.camera.updateProjectionMatrix(); wt._rc = null; const sp = wt._screen(p); return { clientX: sp.x, clientY: sp.y }; };
    const SL = await import('/src/tools/slab.js'), LF = await import('/src/world/lift.js'), RL = await import('/src/world/railing.js');
    const g = tc.terrain.heightAt(0, 0);
    // the shaft: as tall as the column in «Размеры» (26 courses of blocks ≈ 6,5 m) — not on the bare ground;
    // on a cast pad 3 × 3 m
    tc.rig.setState({ target: [0, g, 0], yaw: 0, pitch: 0.6, dist: 1.6 }); tc.simulate(0.05);
    tc.setTool('column'); Object.assign(tc.settings, { colStage: 'lift', colCourse: 'block', colN: 26 });
    const gp = new V(0, g, 0); tc.columnTool.down(gp, e(gp)); tc.columnTool.up(); o.onSoil = tc.objects.all('lift').length;
    const T = tc.terrain; for (let i = 0; i < T.conc.length; i++) { const x = T.toWorldX(i % T.nx), z = T.toWorldZ(Math.floor(i / T.nx)); if (Math.abs(x) < MM(1500) && Math.abs(z) < MM(1500)) T.conc[i] = MM(250); }
    T.updateMesh?.(); const g2 = T.heightAt(0, 0);
    { const gq = new V(0, g2, 0); tc.columnTool.down(gq, e(gq)); tc.columnTool.up(); tc.simulate(0.1); }
    const lf = tc.objects.all('lift')[0];
    o.shaft = lf && { h: Math.round((lf.top - lf.y0) / MM(1)), u: lf.u };
    o.again = (() => { tc.columnTool.down(new V(MM(1500), g, 0), e(new V(MM(1500), g, 0))); tc.columnTool.up(); return tc.objects.all('lift').length; })();
    // the slab on its top: cantilevered 3,5 m all round, the opening over the shaft
    const P = SL.findPileSlab(tc, new V(lf.x, lf.top, lf.z), (v) => wt._screen(v), null, undefined, 3500);
    o.slab = P && { piles: P.rec.piles, cants: P.rec.cants?.length, holes: (P.rec.holes || []).length, liftHole: P.rec.holes?.[0]?.[4], w: P.rec.ni * 100 };
    const sl = tc.objects.add(P.rec), s2 = tc.objects.get(sl.id);
    tc.simulate(0.1); { const F = tc.wallView.slabForm; o.props = F.tubeLo.count; o.soles = F.soles.count; }   // (each prop on its timber sole)
    tc.objects.update(sl.id, { lv: s2.lv.map(() => Math.round(s2.H / MM(1))), fill: 1, castT: tc.clock - 1e6, pourT: tc.clock - 1e6, wetT: tc.clock - 1e6, stripped: true });
    tc.simulate(0.1);
    o.stops = LF.liftStops(tc.objects, tc.objects.get(lf.id)).length;
    o.liftMesh = !!tc.wallView._liftG?.get(lf.id);
    // a tap on the lift: the cabin rides up into the floor
    const lp = new V(lf.x, g, lf.z); tc.columnTool.down(lp, e(lp)); tc.columnTool.up(); o.busy = tc.wallView.liftBusy;
    tc.simulate(LF.rideTime(tc.objects, tc.objects.get(lf.id), 0, 1) + 0.5); o.at = tc.objects.get(lf.id).at;
    o.cabY = Math.round(tc.wallView._liftG.get(lf.id).userData.cab.position.y); o.floor = Math.round((s2.top + s2.H - lf.y0) / MM(1));
    // the fascia: four outer edges, none round the lift's opening
    const s3 = tc.objects.get(sl.id);
    for (const run of RL.slabRuns(s3)) { const m = new V((run.a[0] + run.b[0]) / 2, run.y, (run.a[1] + run.b[1]) / 2); const F = RL.findRail(tc, m, 'ral7016'); if (F && !F.why) tc.objects.add(F.rec); }
    o.fascias = tc.objects.all('rail').filter((q) => q.fascia).length;
    o.again2 = RL.findRail(tc, new V(...[s3.o[0] + s3.ni * s3.c / 2, 0, s3.o[1]].map((v, i) => (i === 1 ? s3.top + s3.H : v))), 'ral7016')?.why;
    // the green roof (the membrane done): painted over the whole slab
    tc.objects.add({ type: 'roof', slab: sl.id, stage: 4, look: 'grey' }); tc.simulate(0.05);
    tc.setTool('wall'); Object.assign(tc.settings, { wallKind: 'roof', roofLayer: 'green' });
    tc.rig.setState({ target: [0, s3.top + s3.H, 0], yaw: 0, pitch: 1.45, dist: 2.2 }); tc.simulate(0.05);
    const rw = wt.roof, c0 = new V(s3.o[0] + MM(300), s3.top + s3.H, s3.o[1] + MM(300));
    rw.down(c0, e(c0));
    for (let i = 0; i <= 40; i++) for (const zz of [0.1, 0.3, 0.5, 0.7, 0.9]) { const q = new V(s3.o[0] + s3.ni * s3.c * i / 40, s3.top + s3.H, s3.o[1] + s3.nj * s3.c * zz); rw.move(q, e(q)); }
    rw.up(); tc.simulate(0.05);
    const rf = tc.objects.all('roof')[0];
    o.green = (rf.green || []).length; o.grav = (rf.grav || []).length;
    // (no green cell within 500 mm of the slab's edge)
    o.greenEdge = Math.min(...(rf.green || [0]).map((k) => { const i = k % s3.ni, j = (k - i) / s3.ni; return Math.min(i, j, s3.ni - 1 - i, s3.nj - 1 - j); }));
    return o;
  });
  check('villa: a lift shaft not on the bare ground, on a cast pad (≈ 6.5 m, one only there); a slab on its top cantilevered all round with the opening over it; the cabin rides up to the floor', o.onSoil === 0 && o.shaft?.h > 6000 && o.again === 1 && o.slab?.piles === 1 && o.slab.cants === 4 && o.slab.holes === 1 && o.slab.liftHole === 1 && o.stops === 1 && o.liftMesh && o.busy && o.at === 1 && Math.abs(o.cabY - o.floor) < 5, JSON.stringify(o));
  check('villa: the slab\'s props each on a timber sole (not on the bare ground)', o.props > 20 && o.soles === o.props, JSON.stringify({ props: o.props, soles: o.soles }));
  check('villa: the fascia on the four outer edges (not round the opening), not twice', o.fascias === 4 && /уже/.test(o.again2 || ''), JSON.stringify(o));
  check('villa: a green roof — sedum in the field, gravel 500 mm at the edge', o.green > 500 && o.grav > 100 && o.greenEdge >= 5, JSON.stringify(o));
  check('villa: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2e. The fence by the post («Забор»): the string with its pegs, a peg moved for a wicket, the holes
// one by one, the posts, the concrete by the bucket and the hose, the rails welded, the fill, the wicket
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const f = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, fw = wt.fence, o = {}, F2 = await import('/src/world/fence2.js');
    const e = (p) => { tc.camera.updateMatrixWorld(); tc.camera.matrixWorldInverse.copy(tc.camera.matrixWorld).invert(); tc.camera.updateProjectionMatrix(); wt._rc = null; const sp = wt._screen(p); return { clientX: sp.x, clientY: sp.y }; };   // (the camera's matrices as a drawn frame has them)
    const run = () => { for (let i = 0; i < 4000 && tc.physJob; i++) tc.simulate(1 / 30); tc.simulate(0.05); };
    const G = (x, z) => new V(x, tc.terrain.heightAt(x, z), z), sAt = (s) => { const [x, z] = F2.pegXZ(fw.rec, s); return new V(x, fw.rec.g, z); }, at = (i) => sAt(fw.rec.pegs[i].s);
    tc.rig.setState({ target: [0, 0.05, 0.1], yaw: 0.2, pitch: 0.75, dist: 1.5 }); tc.simulate(0.05);
    tc.ui.openGroup('fenceG'); tc.ui.refresh();
    o.chips = tc.ui.navNodes().list.map((c) => c.label).join('|');
    o.inLand = JSON.stringify((() => { tc.ui.openGroup('landG'); const x = tc.ui.navNodes().list.map((c) => c.label); tc.ui.openGroup('fenceG'); return x; })()).includes('Забор');
    Object.assign(tc.settings, { f2Layer: 'line', fenceStep: 2000 }); fw.cord = true; tc.ui.refresh();
    o.ui = !document.getElementById('fence-cord').hidden && !document.getElementById('params').hidden;
    const pts = []; for (let k = 0; k <= 20; k++) pts.push(G(-0.38 + 0.76 * k / 20, 0.15));
    fw.down(pts[0], e(pts[0])); for (const p of pts) fw.move(p, e(p)); fw.up();
    o.pegs = fw.rec.pegs.map((q) => q.s).join();
    fw.cord = false; { const p = at(3); fw.down(p, e(p)); const q = sAt(5000); fw.move(q, e(q)); fw.up(); }
    o.moved = fw.rec.pegs[3].s;
    tc.settings.f2Layer = 'holes'; for (let i = 0; i < fw.rec.pegs.length; i++) { const p = at(i); fw.down(p, e(new V(p.x, p.y + 0.02, p.z))); fw.up(); run(); }
    o.holes = fw.rec.pegs.map((q) => (q.hole ? 1 : 0)).join('');
    Object.assign(tc.settings, { f2Layer: 'posts', postSh: 'rd', postA: 80, fenceH: 1800 });
    for (let i = 0; i < fw.rec.pegs.length; i++) { const p = at(i); fw.down(p, e(p)); fw.up(); run(); }
    o.posts = fw.rec.pegs.map((q) => (q.post ? q.post.sh + q.post.a : '-')).join();
    // (the camera back: all the posts on the phone's screen — a hose aimed off its edge floods the plot)
    tc.rig.setState({ target: [0, 0.05, 0.15], yaw: 0, pitch: 0.95, dist: 2.3 }); for (let k = 0; k < 12; k++) tc.simulate(0.25);   // (and settled there)
    o.onScreen = fw.rec.pegs.every((q) => { const [x, z] = F2.pegXZ(fw.rec, q.s), sp = e(new V(x, fw.rec.g, z)); return sp.clientX > 10 && sp.clientX < innerWidth - 10; });
    tc.setTool('pail'); { const pail = tc.concreteTools.pail, p = at(2), top = new V(p.x, p.y + 0.05, p.z); pail.down(top, e(top)); tc.simulate(8); pail.up(); tc.simulate(2); o.pail = fw.rec.pegs[2].fill; }
    tc.setTool('hose'); tc.settings.pump = 1; const hose = tc.concreteTools.hose;
    // (a drawn frame between one press and the next, as between a real finger's touches)
    for (let i = 0; i < fw.rec.pegs.length; i++) { const p = at(i), top = new V(p.x, p.y + 0.06, p.z); await new Promise((r) => requestAnimationFrame(() => r())); hose.down(top, e(top)); for (let k = 0; k < 40 && !hose.ch?.full; k++) { hose.move(top, e(top)); tc.simulate(0.25); } hose.up(); for (let k = 0; k < 40 && hose.state !== 'idle'; k++) tc.simulate(0.25); tc.simulate(0.1); }   // (the pour done before the next post is touched)
    o.conc = fw.rec.pegs.every((q) => q.fill === 1);
    tc.ui.openGroup('fenceG'); Object.assign(tc.settings, { f2Layer: 'rails', railSec: 'r4020', railL: 4000 }); tc.ui.refresh();
    o.tray = document.getElementById('wall-tray').hidden ? '' : document.getElementById('wall-tray-label').textContent;
    for (const s of [2000, 2000, 7000, 7000]) { const p = sAt(s); fw.trayDown(p, e(p)); fw.move(p, e(p)); fw.up(); run(); }
    o.rails = fw.rec.rails.map((q) => `${q.a}-${q.b}@${q.y}`).join();
    // a rail put against the other side of the string goes on that side; the posts' ground is their own
    { const [x, z, ux, uz] = F2.pegXZ(fw.rec, 3000), q = fw.plan(new V(x + uz * 0.05, fw.rec.g, z - ux * 0.05)); o.otherSide = q?.q?.side; }
    o.postG = fw.rec.pegs.every((q) => q.g != null);
    // the fill: the materials, each with its colours inside it
    tc.ui.navPath = ['fence', 'f2fill']; o.fillTabs = tc.ui.navNodes().list.every((c) => c.kids && c.kids.length && c.kids.every((k) => k.label.startsWith('◼')));
    Object.assign(tc.settings, { f2Layer: 'fill', fenceKind: 'slat' }); { const p = sAt(1000); fw.down(p, e(p)); fw.up(); run(); }
    o.filled = fw.rec.filled.length;
    Object.assign(tc.settings, { f2Layer: 'gate', gateType: 'swing' }); { const p = sAt(4500); fw.down(p, e(p)); fw.up(); run(); }
    o.swingRefused = fw.rec.gates.length === 0;
    tc.settings.gateType = 'wicket'; { const p = sAt(4500); fw.down(p, e(p)); fw.up(); run(); }
    o.gates = fw.rec.gates.map((q) => `${q.type}:${q.w}`).join();
    tc.renderer.render(tc.scene, tc.camera);
    tc.undo(); o.undo = fw.rec.gates.length === 0;
    // «Удалить» a part at a time: the wicket, a section, a rail (refused while a section hangs on it), a post (refused while rails are welded to it), its hole
    // the wicket's way: its hinges on the other post, opening to the back — the record and the leaf's turn follow
    { tc.redo(); fw.lastGate = [fw.rec.id, 0]; const FG = (await import('/src/world/fence.js')).fenceGates, rot = () => FG(fw.rec, { side: 1, z: 65 })[0].leaves[0].rot, pos = () => FG(fw.rec, { side: 1, z: 65 })[0].group.position.clone();
      const r0 = rot(), p0 = pos(); fw.setGateWay({ gateHinge: 'R' }); const p1 = pos(); fw.setGateWay({ gateSwing: 'back' }); const r1 = rot();
      o.way = `${fw.rec.gates[0].hinge}:${fw.rec.gates[0].swing}:${p0.distanceTo(p1) > 0.05}:${r0 === -1 && r1 === -1}`; fw.setGateWay({ gateHinge: 'L', gateSwing: 'front' }); tc.undo(); }
    { const Mm = 1 / 1000 / 10.4651, at2 = (s, y) => { const q = sAt(s); q.y = fw.rec.g + y * Mm; return q; }, R = () => fw.rec, log = [];
      const del = (s, y) => { fw.removePart(R(), at2(s, y)); log.push(`${R().gates.length}/${R().filled.length}/${R().rails.length}/${R().pegs.filter((q) => q.post).length}/${R().pegs.filter((q) => q.hole).length}`); };
      del(4500, 1000); del(1000, 1000); del(1000, 1500); del(3000, 1000); del(1000, 1500); del(1000, 300); del(2000, 900); del(2000, 900);
      o.del = log.join(' '); o.delFence = !!R(); }
    // a fence on brick pillars laid on a strip: the pegs set on the pillars, no holes; the rails between them on
    // the embedded plates; corrugated sheet (its colour) in the bay
    { const M = 1 / 1000 / 10.4651, zP = -0.25, g2 = tc.terrain.heightAt(-0.1, zP);
      for (const x of [-0.2, -0.2 + 2000 * M]) for (let k = 0; k < 16; k++) for (const dz of [-62, 62]) tc.objects.add({ type: 'unit', kind: 'brick', free: true, p: [x, g2 + (12 + 77 * k + 32) * M, zP + dz * M], s: [250 * M, 65 * M, 120 * M], q: [0, 0, 0, 1] });
      tc.ui.openGroup('fenceG'); Object.assign(tc.settings, { f2Layer: 'line', fenceStep: 2000 }); fw.cord = true;
      const L2 = []; for (let k = 0; k <= 10; k++) L2.push(G(-0.2 - 300 * M + (2600 * M) * k / 10, zP));
      fw.down(L2[0], e(L2[0])); for (const p of L2) fw.move(p, e(p)); fw.up(); fw.cord = false;
      const r2 = fw.rec; o.pillarPegs = r2.pegs.filter((q) => q.pillar).length;
      tc.settings.f2Layer = 'holes'; { const q = r2.pegs.find((x) => x.pillar), [x, z] = F2.pegXZ(r2, q.s), p = new V(x, r2.g, z); fw.down(p, e(new V(x, r2.g + 0.02, z))); fw.up(); run(); o.noHole = !fw.rec.pegs.find((x) => x.pillar).hole; }
      Object.assign(tc.settings, { f2Layer: 'rails', railSec: 'r4020', railL: 6000 });
      { const pa = r2.pegs.filter((q) => q.pillar), mid = (pa[0].s + pa[1].s) / 2; for (let k = 0; k < 2; k++) { const p = sAt(mid); fw.trayDown(p, e(p)); fw.move(p, e(p)); fw.up(); run(); } }
      o.inline = fw.rec.rails.map((q) => `${q.inline ? 'in' : 'face'}:${q.ea}-${q.eb}@${q.y}`).join();
      Object.assign(tc.settings, { f2Layer: 'fill', fenceKind: 'prof', fenceCol: 'wine' });
      { const pa = fw.rec.pegs.filter((q) => q.pillar), p = sAt((pa[0].s + pa[1].s) / 2); fw.down(p, e(p)); fw.up(); run(); }
      o.prof = `${fw.rec.kind}:${fw.rec.col}:${(fw.rec.filled || []).length}`;
      tc.renderer.render(tc.scene, tc.camera);
      // a post on the strip's concrete: four anchor holes, the post on its plate — standing, no concrete
      const xc = 0.25, zc = -0.3; tc.terrain.depositConc(xc, zc, 0.00004, 0.02); for (let k = 0; k < 20; k++) tc.simulate(0.1); tc.terrain.flushOverflow?.();
      tc.settings.f2Layer = 'line'; fw.cord = true; const L3 = [G(xc, zc), G(xc + 0.1, zc), G(xc + 0.2, zc)]; fw.down(L3[0], e(L3[0])); for (const p of L3) fw.move(p, e(p)); fw.up(); fw.cord = false;
      const r3 = fw.rec; tc.settings.f2Layer = 'holes'; { const [x, z] = F2.pegXZ(r3, 0), p = new V(x, r3.g, z); fw.down(p, e(new V(x, r3.g + 0.02, z))); fw.up(); run(); }
      tc.settings.f2Layer = 'posts'; { const [x, z] = F2.pegXZ(fw.rec, 0), p = new V(x, fw.rec.g, z); fw.down(p, e(p)); fw.up(); run(); }
      o.anchor = `${fw.rec.pegs[0].hole}:${!!fw.rec.pegs[0].post}:${fw.fixed(fw.rec, fw.rec.pegs[0])}`; }
    return o;
  });
  check('fence: its own group (6 stages), not under «Благоустройство»; the string with pegs every 2 m, a peg moved for a wicket', f.chips === '1 · Разметка|2 · Ямы|3 · Столбы|4 · Прожилины|5 · Наполнение|6 · Ворота и калитки|Удалить' && !f.inLand && f.ui && f.pegs === '0,2000,4000,6000,7953' && f.moved === 5000, JSON.stringify(f));
  check('fence: holes one by one, round posts Ø80 in each, concrete by the bucket and the hose', f.holes === '11111' && f.posts === 'rd80,rd80,rd80,rd80,rd80' && f.pail > 0.3 && f.pail < 1 && f.conc, JSON.stringify(f));
  check('fence: rails welded post to post (two rows), the railed bays filled, a wicket in the bay left (a gate too wide refused), undo', f.tray === 'Прожилина' && f.rails === '0-4000@300,0-4000@1500,5000-7953@300,5000-7953@1500' && f.otherSide === -1 && f.postG && f.fillTabs && f.filled === 3 && f.swingRefused && f.gates === 'wicket:1000' && f.undo, JSON.stringify(f));
  check('fence: a wicket hung on either post (left / right), opening to the front or the back', f.way?.startsWith('R:back:true'), JSON.stringify(f.way));
  check('fence: «Удалить» takes a part at a time — the wicket, a section, a rail, a post, its hole (not the whole fence)', f.del === '0/3/4/5/5 0/2/4/5/5 0/2/4/5/5 0/1/4/5/5 0/1/3/5/5 0/1/2/5/5 0/1/2/4/5 0/1/2/4/4' && f.delFence, JSON.stringify(f));
  check('fence: on brick pillars (the pegs set on them, no holes, the rails between them on the plates), corrugated sheet in its colour; a post anchored on the strip\'s concrete', f.pillarPegs === 2 && f.noHole && /^in:pillar-pillar@300,in:pillar-pillar@\d+$/.test(f.inline) && f.prof === 'prof:wine:1' && f.anchor === 'anchor:true:true', JSON.stringify(f));
  check('fence: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2f. The garden path by hand: the string, the trough, the kerbs, the geotextile, the stone, the sand, the pavers ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, pw = wt.land.pw, o = {}, toasts = [];
    const t0 = tc.ui.toast.bind(tc.ui); tc.ui.toast = (m) => { toasts.push(m); t0(m); };
    const e = (p) => { tc.camera.updateMatrixWorld(); tc.camera.matrixWorldInverse.copy(tc.camera.matrixWorld).invert(); tc.camera.updateProjectionMatrix(); wt._rc = null; const sp = wt._screen(p); return { clientX: sp.x, clientY: sp.y }; };
    const run = () => { for (let i = 0; i < 6000 && tc.physJob; i++) tc.simulate(1 / 30); tc.simulate(0.05); };
    const G = (x, z) => new V(x, tc.terrain.heightAt(x, z), z);
    tc.rig.setState({ target: [0, 0.05, 0.1], yaw: 0.2, pitch: 0.9, dist: 1.6 }); for (let k = 0; k < 8; k++) tc.simulate(0.25);
    tc.ui.openGroup('landG'); Object.assign(tc.settings, { wallKind: 'land', landWhat: 'path', pathLayer: 'set', pathW: 1200, pathCorner: 'round', pathR: 1500 }); tc.ui.refresh();
    o.chips = tc.ui.navNodes().list.map((c) => c.label).join('|');
    tc.ui.navPath = ['land', 'path']; o.pathChips = tc.ui.navNodes().list.map((c) => c.label).join('|');
    o.cord = !document.getElementById('fence-cord').hidden; o.sliders = document.getElementById('params').textContent;
    pw.cord = true;
    const pts = []; for (let k = 0; k <= 12; k++) pts.push(G(-0.3 + 0.3 * k / 12, 0.0)); for (let k = 1; k <= 12; k++) pts.push(G(0.0, 0.0 + 0.25 * k / 12));
    wt.down(pts[0], e(pts[0])); for (const p of pts) wt.move(p, e(p)); wt.up(); pw.cord = false;
    const r = () => pw.rec; o.base = r()?.base?.length; o.ptsN = r()?.pts?.length; o.round = r()?.round;
    // a corner moved
    { const q = r().base[1], p = new V(q[0], r().g, q[1]); wt.down(p, e(p)); const p2 = new V(q[0] + 0.02, r().g, q[1]); wt.move(p2, e(p2)); wt.up(); o.moved = +(r().base[1][0] - q[0]).toFixed(3); }
    tc.settings.pathLayer = 'dig'; { const P = r().pts[3], p = G(P[0], P[1]); wt.down(p, e(p)); wt.up(); run(); } o.dug = pw.troughOK(r());
    tc.settings.pathLayer = 'kerb'; tc.ui.refresh(); o.tray = document.getElementById('wall-tray').hidden ? '' : document.getElementById('wall-tray-label').textContent;
    const K = (await import('/src/world/garden.js')).kerbsOf(r()), cen = (k) => new V(k.p.reduce((s, q) => s + q[0], 0) / k.p.length, r().g, k.p.reduce((s, q) => s + q[1], 0) / k.p.length);
    o.K = K.length;
    // one by one from the tray, then rows for the rest
    { const p = cen(K[0]); pw.trayDown(p, e(p)); pw.move(p, e(p)); pw.up(); run(); } o.one = r().kerbs.length;
    pw.row = true; for (let guard = 0; guard < 30 && r().kerbs.length < K.length; guard++) { const left = K.map((k, i) => i).filter((i) => !r().kerbs.includes(i)); const a = cen(K[left[0]]), b = cen(K[left.at(-1)]); wt.down(a, e(a)); wt.move(b, e(b)); wt.up(); run(); } pw.row = false;
    o.kerbs = `${r().kerbs.length}/${K.length}:${!!r().done.kerb}`;
    tc.settings.pathLayer = 'geo'; { const L = (await import('/src/world/garden.js')).lengthOf(r()) * 10465; const GV = await import('/src/world/gardenView.js'); const P0 = GV.pointAt(r(), 0), P1 = GV.pointAt(r(), L); const a = new V(P0[0], r().g, P0[1]); wt.down(a, e(a)); for (let k = 1; k <= 20; k++) { const P = GV.pointAt(r(), L * k / 20), p = new V(P[0], r().g, P[1]); wt.move(p, e(p)); } wt.up(); void P1; }
    o.geo = +pw.geoCover(r()).toFixed(2);
    tc.settings.pathLayer = 'grav'; { const P = r().pts[3], p = G(P[0], P[1]); wt.down(p, e(p)); wt.up(); run(); } o.grav = pw.stageDone(r(), 'grav');
    tc.settings.pathLayer = 'sand'; { const P = r().pts[3], p = G(P[0], P[1]); wt.down(p, e(p)); wt.up(); run(); } o.sand = pw.stageDone(r(), 'sand');
    Object.assign(tc.settings, { pathLayer: 'pave', pathPaver: 'cobble', pathCol: 'trio' });
    { const GA = await import('/src/world/garden.js'), GV = await import('/src/world/gardenView.js'), L = GA.lengthOf(r()) * 10465; for (const c of [-0.3, 0, 0.3]) { const P0 = GV.pointAt(r(), 0); const a = new V(P0[0] - P0[3] * c * 0.057, r().g, P0[1] + P0[2] * c * 0.057); wt.down(a, e(a)); for (let k = 0; k <= 60; k++) { const P = GV.pointAt(r(), L * k / 60), p = new V(P[0] - P[3] * c * 0.057, r().g, P[1] + P[2] * c * 0.057); wt.move(p, e(p)); } wt.up(); } }
    o.laid = `${r().laid.length}/${(await import('/src/world/garden.js')).paversOf(r()).length}:${r().paver}:${r().col}`;
    tc.renderer.render(tc.scene, tc.camera);
    o.toasts = toasts.slice(-6); o.missed = [...(window.__i18nMissed || [])].slice(0, 5);
    return o;
  });
  check('path: «Благоустройство» opens on «Дорожка», 7 stages (no joints); the string with the width and the corners\' radius', o.chips.startsWith('Дорожка|') && o.pathChips === '1 · Разметка|2 · Корыто|3 · Бордюр|4 · Геотекстиль|5 · Щебень|6 · Песок|7 · Плитка' && o.cord && o.sliders.includes('Радиус') && o.round === 1500 && o.ptsN > o.base && o.moved === 0.02, JSON.stringify(o));
  check('path: the trough, the kerbs one from the tray then in rows (all in), the geotextile rolled by the finger, the stone and the sand', o.dug && o.one === 1 && /^(\d+)\/\1:true$/.test(o.kerbs) && o.geo > 0.95 && o.grav && o.sand, JSON.stringify(o));
  check('path: the pavers laid by the finger (a three-size cobble in a three-colour blend), the area counted', /^\d+\/\d+:cobble:trio$/.test(o.laid) && +o.laid.split('/')[0] > 150 && o.toasts.some((t) => /Уложено \d+,\d из \d+,\d м²/.test(t)), JSON.stringify(o));
  check('path: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2g. The lawn by hand ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, lw = wt.land.lw, o = {};
    const e = (p) => { tc.camera.updateMatrixWorld(); tc.camera.matrixWorldInverse.copy(tc.camera.matrixWorld).invert(); tc.camera.updateProjectionMatrix(); wt._rc = null; const sp = wt._screen(p); return { clientX: sp.x, clientY: sp.y }; };
    const run = () => { for (let i = 0; i < 8000 && tc.physJob; i++) tc.simulate(1 / 30); tc.simulate(0.05); };
    const G = (x, z) => new V(x, tc.terrain.heightAt(x, z), z);
    tc.rig.setState({ target: [0, 0.05, 0.1], yaw: 0.2, pitch: 0.9, dist: 1.6 }); for (let k = 0; k < 8; k++) tc.simulate(0.25);
    tc.ui.openGroup('landG'); Object.assign(tc.settings, { wallKind: 'land', landWhat: 'lawn', lawnLayer: 'area', lawnHow: 'turf' }); tc.ui.refresh();
    tc.ui.navPath = ['land', 'lawn']; o.chips = tc.ui.navNodes().list.map((c) => c.label).join('|');
    o.cord = !document.getElementById('fence-cord').hidden;
    // a pit dug in it and a heap left on it (the rake must make them good)
    tc.terrain.scoop(-0.1, 0.05, 0.02, tc.terrain.heightAt(-0.1, 0.05) - 0.01, tc.terrain.heightAt(-0.1, 0.05), () => true, 1);
    lw.cord = true; { const a = G(-0.25, -0.05), b = G(0.1, 0.2); wt.down(a, e(a)); wt.move(b, e(b)); wt.up(); } lw.cord = false;
    const r = () => lw.rec; o.poly = r()?.poly.length;
    // a corner peg dragged out, a touch on a string: a new peg, dragged
    { const q = r().poly[2], p = new V(q[0], r().g, q[1]); wt.down(p, e(p)); const p2 = new V(q[0] + 0.03, r().g, q[1] + 0.02); wt.move(p2, e(p2)); wt.up(); }
    { const [a, b] = [r().poly[0], r().poly[1]], m = G((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); wt.down(m, e(m)); const m2 = new V(m.x, m.y, m.z - 0.04); wt.move(m2, e(m2)); wt.up(); }
    o.poly2 = r().poly.length; o.firstId = r().id;
    const pitY = tc.terrain.heightAt(-0.1, 0.05);
    tc.settings.lawnLayer = 'soil'; { const p = G(-0.05, 0.07); wt.down(p, e(p)); wt.up(); run(); }
    o.soil = lw.soilOn(r()); o.pitFilled = tc.terrain.heightAt(-0.1, 0.05) > pitY + 0.005; o.top = tc.terrain.topMat(tc.terrain.index(-0.05, 0.07));
    tc.settings.lawnLayer = 'grass'; { const p = G(-0.05, 0.07); wt.down(p, e(p)); wt.up(); run(); } o.grass = !!r().done.grass;
    tc.settings.lawnLayer = 'water'; { const p = G(-0.05, 0.07); wt.down(p, e(p)); wt.up(); run(); } o.water = !!r().done.water;
    // a second lawn: the black topsoil tipped by hand in a heap (as from «Материалы»), then «Газон»: raked level first, the turf on it, the sprinkler
    tc.settings.lawnLayer = 'area'; lw.cord = true; { const a = G(0.2, -0.05), b = G(0.42, 0.15); wt.down(a, e(a)); wt.move(b, e(b)); wt.up(); } lw.cord = false;
    { const t = tc.terrain, M = 1 / 1000 / 10.4651, r2 = r(); o.second = r2 && r2.id !== o.firstId;
      for (let dx = -0.06; dx <= 0.06; dx += 0.005) for (let dz = -0.06; dz <= 0.06; dz += 0.005) { const d = Math.hypot(dx, dz); if (d > 0.06) continue; const i = t.index(0.31 + dx, 0.05 + dz); t._push(i, 600 * M * (1 - (d / 0.06) ** 2), 4); }
      t._touch(0, 0, t.rx, t.rz);
      tc.settings.lawnLayer = 'grass'; { const p = G(0.25, 0.0); wt.down(p, e(p)); wt.up(); run(); run(); }
      const hs = []; for (let x = 0.24; x <= 0.38; x += 0.02) for (let z = 0.0; z <= 0.1; z += 0.02) hs.push(t.heightAt(x, z));
      o.byHand = { grass: !!r().done.grass, bump: Math.round((Math.max(...hs) - Math.min(...hs)) / M), black: lw.soilOn(r()) };
      tc.settings.lawnLayer = 'water'; { const p = G(0.25, 0.0); wt.down(p, e(p)); wt.up(); run(); } o.byHand.water = !!r().done.water; }
    // a triangle: its slanted sides cut along the string (no steps of whole 100 mm squares) — the cells' area is the triangle's
    { const L = await import('/src/world/lawn.js'), poly = [[-0.4, -0.35], [-0.1, -0.35], [-0.4, -0.12]], r3 = { poly, g: tc.terrain.heightAt(-0.3, -0.3), u: [1, 0] };
      const c = L.cellsOf(tc, r3), C = 100 / 1000 / 10.4651, ar = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
      const got = c.reduce((s2, q) => s2 + (q.clip ? ar(q.clip) : C * C), 0), want = L.areaOf(poly);
      o.tri = { ratio: +(got / want).toFixed(3), clipped: c.filter((q) => q.clip).length, outside: c.filter((q) => q.clip && q.clip.some(([a, b]) => b > -0.35 - 1e-6 && a > -0.4 - 1e-6 && (a + 0.4) / 0.3 + (b + 0.35) / 0.23 > 1 + 1e-3)).length }; }
    tc.renderer.render(tc.scene, tc.camera);
    return o;
  });
  check('lawn: 4 stages (no rake, no roller); a rectangle by the string, a corner peg dragged, a new peg put in a string', o.chips === '1 · Разметка|2 · Чернозём|3 · Газон|4 · Полив' && o.cord && o.poly === 4 && o.poly2 === 5, JSON.stringify(o));
  check('lawn: the black topsoil tipped in heaps and raked level (a pit filled), the turf, the sprinkler', o.soil && o.pitFilled && o.top === 4 && o.grass && o.water, JSON.stringify(o));
  check('lawn: black topsoil tipped by hand in a heap — «Газон» rakes it level first, the turf and the sprinkler go on it', o.second && o.byHand?.grass && o.byHand.bump < 60 && o.byHand.water, JSON.stringify(o.byHand));
  check('lawn: a triangle — the slanted side cut along the string, not in steps of squares', o.tri && Math.abs(o.tri.ratio - 1) < 0.01 && o.tri.clipped > 10 && o.tri.outside === 0, JSON.stringify(o.tri));
  check('lawn: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2h. Plants and garden lights: every kind goes in (a pot set down, no hole), its model comes, a lamp glows ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, land = wt.land, o = {};
    const { PLANTS } = await import('/src/world/plants.js');
    const run = () => { for (let i = 0; i < 8000 && tc.physJob; i++) tc.simulate(1 / 30); tc.simulate(0.05); };
    tc.ui.openGroup('landG'); Object.assign(tc.settings, { wallKind: 'land', landWhat: 'plant', plantKind: 'tree' }); tc.ui.refresh();
    tc.ui.navPath = ['land', 'plants']; o.groups = tc.ui.navNodes().list.map((c) => c.label).join('|');
    tc.ui.navPath = ['land', 'lights']; o.lgroups = tc.ui.navNodes().list.map((c) => c.label).join('|');
    const kinds = Object.keys(PLANTS).filter((k) => k !== 'hedge');
    o.plants = kinds.filter((k) => !PLANTS[k].light).length + 1; o.lights = kinds.filter((k) => PLANTS[k].light).length;
    kinds.forEach((k, i) => { tc.settings.plantKind = k; const x = -0.45 + (i % 7) * 0.15, z = -0.4 + Math.floor(i / 7) * 0.16; land._plantDown(new V(x, tc.terrain.heightAt(x, z), z)); run(); });
    o.n = tc.objects.all('plant').length; o.want = kinds.length;
    // a pot: no hole under it
    const pot = tc.objects.all('plant').find((q) => q.kind === 'aloe'); o.potLevel = Math.abs(tc.terrain.heightAt(pot.x, pot.z) - pot.g) < 1e-4;
    tc.renderer.render(tc.scene, tc.camera);
    // every model comes (meshes in it); a photographed lamp has its glass to glow
    const M = await import('/src/world/machines/models.js');
    o.bad = [];
    for (const k of kinds) {
      const P = PLANTS[k]; if (!P.model) continue;
      try { const { scene } = await M.loadModel(P.model); let n = 0; scene.traverse((q) => { if (q.isMesh) n++; }); if (!n) o.bad.push(k + ':empty'); if (P.light === 'model') { let g = 0; scene.traverse((q) => { if (q.isMesh && /glass|bulb/i.test(q.material?.name || '')) g++; }); if (!g) o.bad.push(k + ':noglass'); } } catch (err) { o.bad.push(k + ':' + err); }
    }
    // the exterior: every canopy built whole (nothing NaN, over the door, out of the wall), the photographed wall lights load
    { const Pm = await import('/src/world/porch.js'), T = await import('three'), Fl = await import('/src/world/facadeLights.js'); o.canopies = [];
      for (const k of Object.keys(Pm.CANOPIES)) { const c = Pm.canopyMesh({ style: k, o: [0, 0], nrm: [0, 1], u: [1, 0], y: 0.1, W: 1600, P: Pm.CANOPIES[k].P }); c.updateMatrixWorld(true); const b = new T.Box3().setFromObject(c); o.canopies.push(`${k}:${[b.min.z, b.max.z, b.min.y].every(Number.isFinite) && b.min.z > -0.01 && b.max.z > 0.09 && c.userData.parts.anchors.length >= 4 ? 'ok' : 'bad'}`); }
      o.wallModels = []; for (const [k, F] of Object.entries(Fl.FLIGHTS)) if (F.model) { try { const { scene } = await M.loadModel(F.model); let g = 0; scene.traverse((q) => { if (q.isMesh && /glass|bulb/i.test(q.material?.name || '')) g++; }); o.wallModels.push(k + (g ? '' : ':noglass')); } catch (err) { o.wallModels.push(k + ':' + err); } } }
    // night: the lamps' lenses glow
    const B = await import('/src/world/plants.js'); const g = B.plantBody('globe5'); let lens = null; g.traverse((q) => { if (q.userData.lens) lens = q; }); o.lens = !!lens;
    return o;
  });
  check('plants: 4 groups, ≥ 15 kinds; lights: 4 groups, ≥ 15 kinds', o.groups === 'Деревья|Кустарники|Цветы и клумбы|В кашпо' && o.lgroups === 'У дорожки|Подсветка|Декоративные|Фонарные столбы' && o.plants >= 15 && o.lights >= 15, JSON.stringify(o));
  check('plants: every kind planted or set (a pot with no hole), every model loads, a lamp has its lens', o.n === o.want && o.potLevel && !o.bad.length && o.lens, JSON.stringify(o));
  check('exterior: 5 canopies built whole, 4 photographed wall lights with glass that glows', o.canopies?.length === 5 && o.canopies.every((q) => q.endsWith(':ok')) && o.wallModels?.length === 4 && o.wallModels.every((q) => !q.includes(':')), JSON.stringify([o.canopies, o.wallModels]));
  check('plants: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2i. Machines («Техника»): the loader in an area into the truck; the excavator digs and tips; the truck out to the tip ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, mt = tc.machineTool, t = tc.terrain, o = {}, M = 1 / 10.4651;
    const G = (x, z) => new V(x, t.heightAt(x, z), z), frames = (n) => { for (let i = 0; i < n; i++) tc.simulate(1 / 30); };
    tc.setTool('machine'); tc.ui.navPath = ['machines']; tc.ui.refresh();
    o.chips = tc.ui.navNodes().list.map((c) => c.label).join('|');
    await mt.ensure(); frames(5);
    // a heap and a pit in the area
    const g0 = t.heightAt(0.0, 0.15);
    t.deposit(-0.05, 0.12, 1.2 / 1146, 0.8 * M, 0, 0); for (let i = 0; i < 40000 && t.active; i++) t.relax(1);
    t.scoop(0.12, 0.22, 0.25 * M, g0 - 0.15 * M, g0 + 1, () => true, 3); t._touch(0, 0, t.rx, t.rz);
    o.bumpBefore = Math.round((t.heightAt(-0.05, 0.12) - g0) / M * 1000);
    mt.down(G(-0.25, -0.05)); mt.move(G(0.25, 0.35)); mt.up();
    o.area = !!mt.area; o.state = mt.state;
    let k = 0; for (; k < 90000 && (mt.state !== 'idle' || mt.area); k++) { tc.simulate(1 / 30); if (k % 300 === 0) await new Promise((r) => setTimeout(r, 0)); }
    o.steps = k; o.hauled = +((mt.recOf('truck')?.hauled || 0) + (mt.recOf('truck')?.load || 0) * 3).toFixed(2);
    const hs = []; for (let x = -0.2; x <= 0.2; x += 0.02) for (let z = 0.0; z <= 0.3; z += 0.02) hs.push(t.heightAt(x, z)); hs.sort((a, b) => a - b);
    o.spread = Math.round((hs[Math.floor(hs.length * 0.95)] - hs[Math.floor(hs.length * 0.05)]) / M * 1000);
    o.pit = Math.round((t.heightAt(0.12, 0.22) - g0) / M * 1000);
    // the excavator: in, the boom down into the ground, the bucket curled in — it fills; up, opened — empty
    mt.enter('excavator'); for (let i = 0; i < 200 && !mt.driving; i++) await new Promise((r) => setTimeout(r, 50));
    o.exc = mt.driving && mt.drv === 'excavator'; const E = mt.exc;
    o.btns = [...document.querySelectorAll('#mbtns button')].map((b) => b.textContent).join('|');
    // a dig as a driver does it: the stick out, the bucket's teeth turned down, the boom down into the ground
    // (the teeth lead: it cuts), the bucket curled in — full, as much as came out of the ground; up, opened —
    // empty; then pressed down on the ground with the bucket open (nothing cuts): it does not go in, the
    // machine's front comes up on its tracks instead
    const soilV = () => { let v = 0; for (let i = 0; i < t.nat.length; i++) v += t.nat[i] + t.loose[i]; return v * t.cellArea; }, dug0 = soilV();
    const go = (n, l, r) => { mt.joystick('l', ...l); mt.joystick('r', ...r); frames(n); mt.joystick('l', 0, 0); mt.joystick('r', 0, 0); frames(3); };
    go(60, [0, -1], [0, 0]); go(12, [0, 0], [-1, 0]); go(40, [0, 0], [0, 1]);
    const teeth = E.teethWorld(new V()); o.teethLow = teeth.y < t.heightAt(teeth.x, teeth.z) + 0.3 * M;
    go(40, [0, 1], [0, 0]); go(40, [0, 1], [-1, 0]); go(30, [0, 0], [-1, 0]);
    o.full = +E.load.toFixed(2);
    { const inB = mt.digG.load * t.cellArea, out = dug0 - soilV(); o.inBucket = +(inB / Math.max(1e-12, out)).toFixed(2); }
    // (lifted curled in, it keeps what it holds — nothing runs out till it is tipped; the soil in it crowned and lumpy,
    // not a level plane)
    { const l0 = E.load; go(60, [0, 0], [0, -1]); o.carried = +(E.load / Math.max(1e-9, l0)).toFixed(2);
      E._fill(E.load); const gp = E.soil.geometry.attributes.position, up = E._upLocal(), hs = []; for (let i = 0; i < gp.count; i++) hs.push(gp.getY(i) * up[0] + gp.getZ(i) * up[1]); hs.sort((a, b) => a - b);
      const top = hs.slice(Math.floor(hs.length * 0.7)); o.crown = +((top[top.length - 1] - top[0]) / E.chord).toFixed(2); }
    go(70, [0, 0], [1, 0]); frames(30);
    o.after = +E.load.toFixed(2);
    // (a crumb off the lip falls as things fall: 2 m in ~0,65 s — not in a frame or two, seen hanging still)
    { const P = tc.particles; P.emit(new V(0, t.heightAt(0, 0) + 2 * M, 0), new V(0, 0, 0), 0, 0.003, 0, 0, 0, true); const it = P.items[P.items.length - 1];
      for (let i = 0; i < 12; i++) tc.simulate(1 / 30); o.fallAt04 = P.items.includes(it); for (let i = 0; i < 24; i++) tc.simulate(1 / 30); o.fallAt12 = !P.items.includes(it); }
    { let deepest = 0; mt.joystick('r', 0, 1); for (let i = 0; i < 60; i++) { tc.simulate(1 / 30); for (const q of E.hardPoints()) if (t.inside(q.x, q.z)) deepest = Math.max(deepest, t.heightAt(q.x, q.z) - q.y); }
      o.heave = +E.heave.toFixed(3); mt.joystick('r', 0, 0); frames(5); o.deepest = +(deepest / M * 1000).toFixed(0); }

    mt.setExcMode('drive'); const x0 = E.x, z0 = E.z; mt.joystick('l', 0, -1); frames(45); mt.joystick('l', 0, 0); frames(5); o.drove = Math.hypot(E.x - x0, E.z - z0) > 0.3 * M;
    mt.exit(); frames(5);
    // the truck: loaded, driven out past the plot's edge — to the tip, back empty
    mt.enter('truck'); for (let i = 0; i < 200 && !(mt.driving && mt.drv === 'truck'); i++) await new Promise((r) => setTimeout(r, 50));
    const T = mt.truck, h0 = mt.recOf('truck')?.hauled || 0;
    // (tipped in from 2 m over the body: counted at once, the heap grows when it has fallen — not before)
    { T.load = 0; T.update(0.01); const p = T.bedCentre(new V()); p.y += 2 * M; const v0 = T._hfVol(); T.pourAt(p, 0.1); for (let i = 0; i < 6; i++) T.update(1 / 30);
      o.inAir = T._hfVol() - v0 < 1e-12 && T.load > 0.09; for (let i = 0; i < 30; i++) T.update(1 / 30); o.landed = Math.abs(T._hfVol() / T.cap - T.load) < 0.01 && !T.falling.length; }
    T.load = 0.6; o.signs = !!mt._signs?.visible;
    mt.joystick('l', 0, -1); for (let i = 0; i < 2400 && T.load > 0.01; i++) tc.simulate(1 / 30); mt.joystick('l', 0, 0);
    o.tip = T.load < 0.01 && (mt.recOf('truck')?.hauled || 0) > h0 + 0.5;
    mt.exit();
    return o;
  });
  check('machines: «Техника» — the loader into the truck (an area), the loader, the truck, the excavator; nothing else', o.chips === 'Погрузчик в самосвал|Сесть в погрузчик|Сесть в самосвал|Сесть в экскаватор', JSON.stringify(o));
  check('machines: an area set out — the heap cut and loaded into the truck, the pit filled, the area level', o.area && o.state === 'work' && o.steps < 90000 && o.hauled > 0 && o.spread < 90 && o.pit > -60, JSON.stringify(o));
  check('machines: the excavator — the boom down, the bucket curled in fills it (as much as came out of the ground), not through the ground (held down: its front lifts), lifted it keeps it (crowned, lumpy), opened it is empty, the crumbs fall at g; it drives on its tracks', o.exc && o.btns.includes('Ход') && o.teethLow && o.full > 0.2 && o.deepest <= 40 && o.heave > 0.01 && o.inBucket > 0.9 && o.inBucket < 1.1 && o.after < 0.05 && o.drove && o.carried >= 0.95 && o.crown > 0.15 && o.fallAt04 && o.fallAt12, JSON.stringify(o));
  check('machines: the truck driven out past the plot\'s edge with a load — to the tip, back empty; what is tipped into it heaps when it lands', o.signs && o.tip && o.inAir && o.landed, JSON.stringify(o));
  check('machines: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2j. Sounds: every sound the code asks for is in the library, every file of it is there and decodes ----
{
  const fs = await import('fs'), path = await import('path');
  const lib = await import(path.resolve('src/audio/sounds.js')), names = new Set(Object.keys(lib.SOUNDS));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const asked = new Set(), missing = new Set();
  for (const f of walk('src')) { const t = fs.readFileSync(f, 'utf8'); for (const m of t.matchAll(/sfx\??\.(?:play\??\.?\(|pour\??\.?\([^,)]*,\s*|scrapeStart\??\.?\()\s*'([a-z_]+)'/g)) asked.add(m[1]); for (const m of t.matchAll(/\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) if (/sfx/.test(t.slice(Math.max(0, m.index - 120), m.index))) { asked.add(m[1]); asked.add(m[2]); } }
  const eng = fs.readFileSync('src/audio/sfx.js', 'utf8').match(/const ENGINES = \{([^}]*)\}/)[1]; for (const m of eng.matchAll(/:\s*'([a-z_]+)'/g)) asked.add(m[1]);
  for (const n of ['tap', 'cash', 'block', 'rain', 'thunder', 'birds', 'crickets', 'wind', 'soil_pour', 'drill', 'screwdriver', 'engine']) asked.add(n);
  asked.delete('engine');
  for (const n of asked) if (!names.has(n)) missing.add(n);
  const files = Object.values(lib.SOUNDS).flatMap((S) => S.f), absent = files.filter((f) => !fs.existsSync(`assets/sounds/${f}.mp3`));
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const o = await page.evaluate(async () => {
    const s = window.__tc.sfx; s.unlock(); const L = (await import('/src/audio/sounds.js')).SOUNDS;
    const got = await Promise.all(Object.keys(L).map(async (n) => [n, (await s._load(n))?.length || 0, L[n].f.length]));
    const bad = got.filter(([, a, b]) => a !== b).map(([n, a, b]) => `${n}:${a}/${b}`);
    const src = s.play('brick'); s.loop('t', 'loader', 0.5); const looping = s.loops.has('t'); s.loop('t', 'loader', 0);
    // (a loop kept at 0 every frame — the sky's crickets by day — is stopped, not put off for ever)
    for (let i = 0; i < 90; i++) { s.loop('t', 'loader', 0); await new Promise((r) => setTimeout(r, 16)); }
    // (the status line: the whole ground counted only when it changed — not 3 times a second at rest)
    const T = window.__tc.terrain, ev = T.excavatedVolume; let calls = 0; T.excavatedVolume = function () { calls++; return ev.call(this); };
    await new Promise((r) => setTimeout(r, 3000)); T.excavatedVolume = ev;
    return { n: got.length, bad, played: !!src, looping, stopped: !s.loops.has('t'), statCalls: calls };
  });
  check('sounds: every sound asked for is in the library (no synthesised buzz left), its files there', !missing.size && !absent.length && asked.size > 50, JSON.stringify({ asked: asked.size, missing: [...missing], absent: absent.slice(0, 5) }));
  check('sounds: every file decodes in the browser; a one-shot plays, a loop runs', o.n >= 85 && !o.bad.length && o.played && o.looping && o.stopped, JSON.stringify(o));
  check('status line: the ground not counted again while nothing changes', o.statCalls <= 1, JSON.stringify({ statCalls: o.statCalls }));
  check('sounds: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2k. Catastrophes: a house of blocks; a weak quake leaves it, a strong one brings it down; every kind runs; all back as it was ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, t = tc.terrain, M = 1 / 1000 / 10.4651, o = {};
    // a box of aerated blocks 6 × 5 m, 9 courses (2,25 m), on the ground
    const g = t.heightAt(0, 0), add = (x, y, z, ax) => tc.objects.add({ type: 'unit', kind: 'block', free: true, p: [x, y, z], s: ax ? [600 * M, 250 * M, 300 * M] : [300 * M, 250 * M, 600 * M], q: [0, 0, 0, 1] });
    for (let k = 0; k < 9; k++) { const y = g + (125 + 250 * k) * M, sh = (k % 2) * 300 * M;
      for (let a = -3000 * M + 300 * M + sh; a < 3000 * M - 299 * M; a += 600 * M) { add(a, y, -2500 * M, true); add(a, y, 2500 * M, true); }
      for (let b = -2500 * M + 450 * M + sh; b < 2500 * M - 449 * M; b += 600 * M) { add(-2850 * M, y, b, false); add(2850 * M, y, b, false); } }
    for (let i = 0; i < 6; i++) tc.simulate(0.1);
    // (free blocks are tinted like the others — a NaN tint drew them black)
    { const ic = tc.wallView.blocks.instanceColor?.array; o.tint = !!ic && Array.from(ic.slice(0, tc.wallView.blocks.count * 3)).every(Number.isFinite); }
    tc.setTool('disaster'); tc.ui.navLevel = 'chips'; tc.ui.navPath = []; tc.ui.refresh();
    o.chips = tc.ui.navNodes().list.map((c) => c.label).join('|'); o.slider = !!document.getElementById('p-cat-r');
    const D = tc.disasterTool, run = async (kind, power, secs) => { Object.assign(tc.settings, { catKind: kind, catPower: power }); const st = await D.run(); const t0 = performance.now(); for (let i = 0; i < secs * 30; i++) tc.simulate(1 / 30); const ms = (performance.now() - t0) / (secs * 30); const s = D.sim.stats(); D.reset(); return { pieces: st.pieces, share: +s.share.toFixed(2), ms: Math.round(ms) }; };
    o.weak = await run('quake', 1, 18);
    o.strong = await run('quake', 10, 18);
    // (the ruins at rest cost nothing: after the show the physics is no longer stepped; while it goes, it is drawn)
    { Object.assign(tc.settings, { catKind: 'quake', catPower: 10 }); await D.run(); o.live = tc.moving(); while (!D.sim.done) tc.simulate(1 / 30); for (let i = 0; i < 40; i++) tc.simulate(1 / 30);
      let t0 = performance.now(); for (let i = 0; i < 60; i++) tc.simulate(1 / 30); const ms = (performance.now() - t0) / 60; o.restFlag = D.sim.resting; D.reset(); tc.simulate(0.1);
      t0 = performance.now(); for (let i = 0; i < 60; i++) tc.simulate(1 / 30); const base = (performance.now() - t0) / 60;
      o.rest = { resting: o.restFlag, ms: +ms.toFixed(2), base: +base.toFixed(2) }; }
    o.back = tc.wallView.blocks.visible && !tc.scene.getObjectByName('disaster') && !tc.wallView.frozen;
    o.kinds = {};
    for (const k of ['hurricane', 'tornado', 'tsunami', 'flood', 'fire', 'meteor']) o.kinds[k] = (await run(k, 10, 14)).share;
    // a mistake: a wall 4,2 m with an opening 1,5 m, a lintel 2,0 m over it (cast without bars), 4 courses on it
    { const mm = (v) => v * M, z0 = mm(5500), add = (x, y, w, lintel = false) => tc.objects.add({ type: 'unit', kind: 'block', free: true, ...(lintel ? { lintel: true } : {}), p: [mm(x), y, z0], s: [mm(w), mm(lintel ? 250 : 240), mm(300)], q: [0, 0, 0, 1] });
      tc.journal.act('wall-m', {}, tc.clock, () => {
        for (let r = 0; r < 12; r++) { const y = g + (125 + 250 * r) * M; if (r === 7) { add(0, y, 2000, true); for (const x of [-1800, 1800]) add(x, y, 590); continue; }
          for (let x = -1800 + (r % 2) * 300; x <= 1800; x += 600) { if (r < 7 && Math.abs(x) < 900) continue; if (Math.abs(x) <= 2100) add(Math.max(-1800, Math.min(1800, x)), y, 590); } }
        // (a window in the opening, up under the lintel: it takes the load when the lintel gives)
        tc.objects.add({ type: 'window', key: 'pvc2', w: 1400, h: 1380, t: 300, x: 0, y: g + mm(360), z: z0, yaw: 0 }); });
      for (let i = 0; i < 4; i++) tc.simulate(0.1);
      Object.assign(tc.settings, { catKind: 'lintel', misYears: 10, mXray: true }); tc.ui.refresh();
      o.misChip = tc.ui.navNodes().list.map((c) => c.label).join('|').includes('Перемычка без арматуры') && !!document.getElementById('p-cat-r');
      const st = await D.run(), X = D.mis, red = () => { const c = X.units.filter((u) => u.inA && u.col); return c.length ? Math.max(...c.map((u) => u.col[2] - u.im.instanceColor.getZ(u.i))) : 0; };   // (red-yellow: the blue gone)
      for (let i = 0; i < 30 * 3 * X.secPerYear; i++) tc.simulate(1 / 30);
      o.mis = { ok: st.ok, arch: st.arch, xray: +red().toFixed(2), early: +X.stats().sag.toFixed(3) };
      for (let i = 0; i < 30 * 9 * X.secPerYear; i++) tc.simulate(1 / 30);
      const f = X.stats(); Object.assign(o.mis, { sag: +f.sag.toFixed(3), cracks: f.cracks, chips: f.chips, fell: f.fell, jam: f.jam, done: f.done, glass: f.glass, bill: !!document.querySelector('.mistake-hud .m-bill')?.textContent,
        // (the realist's checks on the cracks: not a straight cut — a bolt of lightning; through the blocks mostly)
        rough: Math.min(...f.paths.filter((q) => q.kind === 'arch').map((q) => +(q.L / q.chord).toFixed(3))), roughMax: Math.max(...f.paths.filter((q) => q.kind === 'arch').map((q) => +(q.L / q.chord).toFixed(3))), joint: Math.max(...f.paths.filter((q) => q.kind === 'arch').map((q) => +(q.joint / q.L).toFixed(2))),
        // (the two arch cracks meet at the crown; the halves touch at their top)
        meet: +(Math.hypot(X.paths[1].p.at(-1)[0] - X.paths[2].p.at(-1)[0], X.paths[1].p.at(-1)[1] - X.paths[2].p.at(-1)[1]) / M).toFixed(0) });
      D.reset(); const lm = new tc.camera.matrix.constructor(); tc.wallView.lintels.getMatrixAt(0, lm);
      o.mis.back = !tc.wallView.frozen && !document.querySelector('.mistake-hud') && Math.abs(lm.determinant()) > 1e-15; }
    return o;
  });
  check('catastrophes: 8 kinds, the power slider, run and back as it was; free blocks tinted (not black)', o.chips.split('|').length === 11 && o.slider && o.back && o.tint, JSON.stringify(o));
  check('catastrophes: drawn while one goes on; the ruins at rest cost nothing (no physics stepped after the end)', o.live && o.rest.resting && o.rest.ms < o.rest.base + 1.5, JSON.stringify([o.live, o.rest]));
  check('catastrophes: a M 4 quake leaves the house standing, a M 9 one brings it down', o.weak.pieces > 250 && o.weak.share < 0.05 && o.strong.share > 0.4, JSON.stringify([o.weak, o.strong]));
  check('catastrophes: the tornado, the tsunami and the meteor at full power break the house', o.kinds.tornado > 0.1 && o.kinds.tsunami > 0.1 && o.kinds.meteor > 0.1, JSON.stringify(o.kinds));
  check('mistakes: a lintel without bars — the x-ray reddens, it breaks in weeks and creeps (to ≈24 mm over a window), three hinges, the arch of collapse cracks meet at the crown, nearly straight and ragged in the small, the sash jams then the glass cracks, the blocks stay in (chips fall), the bill; back as it was', o.misChip && o.mis?.ok && o.mis.arch >= 4 && o.mis.xray > 0.2 && o.mis.early > 0.012 && o.mis.sag > 0.018 && o.mis.sag <= 0.027 && o.mis.cracks >= 3 && o.mis.rough >= 1.02 && o.mis.roughMax <= 1.2 && o.mis.joint < 0.2 && o.mis.meet < 60 && o.mis.jam && o.mis.glass && o.mis.fell === 0 && o.mis.chips >= 1 && o.mis.done && o.mis.bill && o.mis.back, JSON.stringify(o.mis));
  check('catastrophes: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2k'. «Обрушение опоры»: a house on its glass lift shaft — the posts bow, the panes crack and whiten, the
// house sinks and leans, then falls as one body (≈ g), strikes and breaks into pieces; the slabs fall too (not
// lost); a fascia does not hold it up; all back as it was ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, V = tc.camera.position.constructor, wt = tc.wallTool, o = {}, MM = (v) => v / 1000 / 10.4651, M = 1 / 1000 / 10.4651;
    const SL = await import('/src/tools/slab.js'), LF = await import('/src/world/lift.js'), RL = await import('/src/world/railing.js'), CL = await import('/src/world/collapse.js'), THREE = await import('three');
    const T = tc.terrain; for (let i = 0; i < T.conc.length; i++) { const x = T.toWorldX(i % T.nx), z = T.toWorldZ(Math.floor(i / T.nx)); if (Math.abs(x) < MM(1500) && Math.abs(z) < MM(1500)) T.conc[i] = MM(250); }
    const g = T.heightAt(0, 0);
    const lf = tc.objects.add(LF.planLift(tc, new V(0, g, 0), MM(6500), new V(1, 0, 3)).rec);
    const sl = tc.objects.add(SL.findPileSlab(tc, new V(0, lf.top, 0), (v) => wt._screen(v), null, undefined, 3500).rec), s2 = tc.objects.get(sl.id);
    tc.objects.update(sl.id, { lv: s2.lv.map(() => Math.round(s2.H / MM(1))), fill: 1, castT: tc.clock - 1e6, pourT: tc.clock - 1e6, wetT: tc.clock - 1e6, stripped: true });
    tc.simulate(0.1);
    const s3 = tc.objects.get(sl.id), ytop = s3.top + s3.H;
    for (const run of RL.slabRuns(s3)) { const F = RL.findRail(tc, new V((run.a[0] + run.b[0]) / 2, run.y, (run.a[1] + run.b[1]) / 2), 'ral7016'); if (F && !F.why) tc.objects.add(F.rec); }
    const add = (x, y, z, ax) => tc.objects.add({ type: 'unit', kind: 'block', free: true, p: [x, y, z], s: ax ? [600 * M, 250 * M, 300 * M] : [300 * M, 250 * M, 600 * M], q: [0, 0, 0, 1] });
    for (let k = 0; k < 6; k++) { const y = ytop + (125 + 250 * k) * M, sh = (k % 2) * 300 * M;
      for (let a = -3500 * M + 300 * M + sh; a < 3500 * M - 299 * M; a += 600 * M) { add(a, y, -3000 * M, true); add(a, y, 3000 * M, true); }
      for (let b = -3000 * M + 450 * M + sh; b < 3000 * M - 449 * M; b += 600 * M) { add(-3350 * M, y, b, false); add(3350 * M, y, b, false); } }
    for (let i = 0; i < 6; i++) tc.simulate(0.1);
    tc.setTool('disaster'); Object.assign(tc.settings, { catKind: 'shaft', catPower: 5 });
    o.chip = tc.ui.chips().some((c) => /Обрушение опоры/.test(c.label));
    tc.objects.add(SL.slabCage(tc.objects.get(sl.id))); tc.simulate(0.05);
    // (a green roof on it: torn with the slab's pieces, not falling whole)
    { const b = tc.objects.get(sl.id), green = []; for (let j = 6; j < b.nj - 6; j++) for (let i = 6; i < b.ni - 6; i++) green.push(j * b.ni + i); tc.objects.add({ type: 'roof', slab: sl.id, stage: 4, look: 'grey', green }); tc.simulate(0.1); }   // (its bars: they go with its pieces, not left hanging)
    const sc0 = tc.wallView._liftG.get(lf.id).children.map((ch) => [ch.scale.y, ch.position.y]);
    const tr0 = performance.now(); await tc.disasterTool.run(); o.runMs = Math.round(performance.now() - tr0);
    const D = tc.disasterTool.sim, C = D.collapse, ST = CL.SHAFT_T;
    o.barsHidden = !tc.rebarView.group.visible;
    o.roofTorn = { roofPanels: C.panels.filter((p) => p.sort === 'roof').length, hidden: tc.wallView.roofs.children.length > 0 && tc.wallView.roofs.children.every((ch) => !ch.visible), onPieces: C.panels.filter((p) => p.sort === 'slab' && p.o.children.length >= 2).length };
    // (the cast concrete is not hidden as a whole — only the slabs shown in pieces leave it; hiding it all left a slab's bars alone)
    { const wv = tc.wallView, ix = wv.fill.geometry.index.array, own = wv.owner.fill, cut = new Set(C.panels.filter((p) => p.sort === 'slab').map((p) => p.o.userData.slab));
      o.fill = { shown: wv.fill.visible, tris: ix.length / 3, want: own.filter((id) => !cut.has(id)).length, total: own.length, cut: cut.size }; }
    o.carried = C && [C.chunks.length, C.panels.filter((p) => p.sort === 'slab').length, C.panels.filter((p) => p.sort === 'skin').length];
    const run = (t1) => { while (D.t < t1) tc.simulate(1 / 30); };
    const y0 = C.body.translation().y;
    run(ST.white - 0.1); o.cracked = C.panes.filter((p) => p.crack.alphaTest < 0.9).length; o.panes = C.panes.length; o.bowSink = +((y0 - C.body.translation().y) * 1000).toFixed(1); o.lean = +(C.tilt * 180 / Math.PI).toFixed(2);
    run(ST.fail - 0.05); o.white = C.panes.filter((p) => p.whited).length;
    // (from the failure: the house's fall — its drop by ~0.6 s after it is free, against a free fall's ½gt²)
    run(ST.fail + 0.1); const yA = C.body?.translation().y, tA = D.t; run(ST.fail + 0.35); o.headGap = C.struck ? 0 : Math.round(C._shortLast >= C.Hpost - 351 ? 0 : Math.abs(C._shortLast - C._shortTo)); run(ST.fail + 0.6); const yB = C.body ? C.body.translation().y : null, tB = D.t;
    o.fall = yA != null && yB != null ? { drop: +(yA - yB).toFixed(2), free: +(0.5 * 9.81 * ((tB - ST.fail) ** 2 - (tA - ST.fail) ** 2)).toFixed(2) } : null;
    run(ST.fail + 4); o.struck = C.struck; o.free = C.chunks.filter((c) => c.free).length; o.slabMaxY = +Math.max(...C.panels.filter((p) => p.sort === 'slab').map((p) => p.body.translation().y - g * 10.4651)).toFixed(2); o.slabsDown = o.slabMaxY < 3;
    o.maxUp = Math.max(...C.chunks.map((c) => c.body.linvel().y));
    // (not a Lego set: the slab's pieces all different, the wall's chunks of every size; a corner first; nothing on edge)
    { const areas = C.panels.filter((p) => p.sort === 'slab').map((p) => { const b = new THREE.Box3().setFromObject(p.o); return Math.round((b.max.x - b.min.x) * (b.max.z - b.min.z) * 1e5); });
      o.slabDistinct = new Set(areas).size / areas.length; const sz = C.chunks.map((c) => c.vol); o.chunkSizes = [+Math.min(...sz).toFixed(2), +Math.max(...sz).toFixed(1), sz.length];
      o.strikeAngle = +C.strikeAngle.toFixed(1);
      o.slabTilt = Math.max(...C.panels.filter((p) => p.sort === 'slab').map((p) => { const r = p.body.rotation(), q = new THREE.Quaternion(r.x, r.y, r.z, r.w), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q); return Math.acos(Math.min(1, Math.abs(up.y))) * 180 / Math.PI; }));
      o.tilts = C.panels.filter((p) => p.sort === 'slab').map((p) => { const r = p.body.rotation(), q = new THREE.Quaternion(r.x, r.y, r.z, r.w), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), b = new THREE.Box3().setFromObject(p.o); return [Math.round(Math.acos(Math.min(1, Math.abs(up.y))) * 57.3), +((b.max.x - b.min.x) * (b.max.z - b.min.z) * 100).toFixed(1)]; }).filter((t) => t[0] > 30);
      o.overTop = C.chunks.some((c) => c.body.translation().y > C.top0 * 10.4651 + 0.3); }
    // (the crushed shaft's own parts — the sheave, the ram, the ropes — come down with it, none left hanging in the air)
    { const L = [...tc.wallView._liftG.get(lf.id).children].filter((ch) => ch.visible && ch.userData.y0 != null && ch.userData.y0 > 0.01);
      o.liftParts = L.length; o.hanging = L.filter((ch) => ch.scale.y < 0.99 * (ch.userData.sy0 ?? 1) && ch.position.y > ch.userData.y0 * 0.99).length; }
    tc.disasterTool.stop?.(); D.stop(); tc.simulate(0.1);
    o.barsBack = tc.rebarView.group.visible;
    o.back = !tc.scene.getObjectByName('disaster') && !tc.wallView.frozen && tc.wallView._liftG.get(lf.id).children.every((ch, i) => ch.visible && ch.scale.y === sc0[i][0] && ch.position.y === sc0[i][1]);
    return o;
  });
  check('support collapse: the chip; the house carried whole (its chunks, the slab in pieces, the fascias)', o.chip && o.carried?.[0] > 40 && o.carried[1] >= 18 && o.carried[2] === 4, JSON.stringify(o));
  check('support collapse: the posts bow first — the house sinks a few mm and leans ≤ 3°; the panes crack bottom-up, then whiten', o.bowSink > 0.2 && o.bowSink < 60 && o.lean > 0 && o.lean <= 3 && o.cracked > 0 && o.white === o.panes, JSON.stringify(o));
  check('support collapse: the house falls as a body would (its drop ≥ 60 % of a free fall\'s), strikes, breaks; the slabs come down; nothing bounces up', o.fall && o.fall.drop > 0.6 * o.fall.free && o.struck && o.free > 0 && o.slabsDown && o.maxUp < 1.5, JSON.stringify(o));
  check('support collapse: not a Lego set — the slab in pieces all different, the walls split through their blocks — hundreds of pieces from a tenth of a block to many; a corner first (≥ 8°); no slab piece on edge (≤ 40° — lying on the heap), nothing over the walls', o.slabDistinct > 0.9 && o.chunkSizes[0] < 0.3 && o.chunkSizes[1] > 4 && o.chunkSizes[2] >= 150 && o.strikeAngle >= 8 && o.slabTilt <= 40 && !o.overTop, JSON.stringify(o));
  check('support collapse: the falling house stays on the shaft\'s head (≤ 20 mm) — not in the air over it', o.headGap <= 20, JSON.stringify({ headGap: o.headGap }));
  check('support collapse: the green roof torn with the slab (on its pieces), not one whole sheet', o.roofTorn.roofPanels === 0 && o.roofTorn.hidden && o.roofTorn.onPieces >= 10, JSON.stringify(o.roofTorn));
  check('support collapse: nothing left hanging in the air — the shaft\'s parts come down as it is crushed', o.liftParts > 0 && o.hanging === 0, JSON.stringify(o));
  check('catastrophe: the cast concrete stays shown — only the slabs in pieces leave it (their bars with them, back after)', o.barsHidden && o.barsBack && o.fill.shown && o.fill.tris === o.fill.want && o.fill.cut === 1 && o.fill.total > 0, JSON.stringify(o.fill));
  check('support collapse: all back as it was; no console errors', o.back && errors.length === 0, errors.slice(0, 3).join(' | ') + JSON.stringify(o));
  await browser.close();
}

// ---- 2l. The film director's grammar (director.js): the beat's three angles, the longest shot, hard cuts within a stage, the hand-held sway ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, { Director } = await import('./src/film/director.js'), THREE = await import('three'), o = {};
    const P = new THREE.Vector3(0, tc.terrain.heightAt(0, 0), 0);
    let busyUntil = 0; const busy0 = tc.busy; tc.busy = () => d.t < busyUntil;
    function* script(d) {
      d.bar(3);
      d.cut({ target: P, yaw: 0, pitch: 0.5, dist: 1 }, { fx: 'flash' }); d.title('ONE', '', 1);
      o.fx0 = d.fx.filter((e) => e.kind === 'flash').length;
      yield d.sec(0.5);
      d.cut({ target: P, yaw: 1, pitch: 0.5, dist: 1 }, { fx: 'whip' });   // (the same stage: a hard cut)
      o.fxIn = d.fx.filter((e) => e.kind === 'whip').length;
      yield d.sec(7);                                                          // (held too long: cut by itself)
      busyUntil = d.t + 5;
      yield* d.beat(P, 'detail', { yaw: 0.3 });
      d.kick('7 DAYS LATER'); d.cut({ target: P, yaw: 2, pitch: 0.6, dist: 1 }, { fx: 'flash' });
      o.fxJump = d.fx.some((e) => e.kind === 'flash' && e.t0 === d.t);
      yield d.sec(0.4);
    }
    const d = new Director(tc, script, true);
    let maxYaw = 0;
    for (let i = 0; i < 30 * 25 && !d.done; i++) { d.update(1 / 30); if (d.shot && !d.shot.f && !d.fx.length) { const dy = tc.rig.state().yaw - d._eval(d.shot).yaw; maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(Math.sin(dy), Math.cos(dy)))); } }
    tc.busy = busy0;
    o.done = d.done; o.log = d.log.map((s) => [s.kind, +s.t0.toFixed(1), s.pitch == null ? null : +s.pitch.toFixed(2), s.auto ? 1 : 0]);
    // (the shots: none held longer than the cap; the beat: above, low, above)
    o.longest = Math.max(...d.log.map((s, i) => (d.log[i + 1]?.t0 ?? d.t) - s.t0));
    const b = d.log.filter((s) => s.kind === 'follow').map((s) => s.pitch);
    o.beat = b.length >= 3 && b[0] > 1.2 && b[1] < 0.5 && b.at(-1) > 1.2;
    o.sway = +maxYaw.toFixed(4);
    d.el.remove(); document.body.classList.remove('filming');
    return o;
  });
  check('film director: the beat is setup from above → action low → payoff from above; no shot over 6 s', o.done && o.beat && o.longest <= 6.05 && o.log.some((s) => s[3]), JSON.stringify(o));
  check('film director: within a stage a hard cut (no transition), over a jump in time one; the hand-held sway is small', o.fx0 === 1 && o.fxIn === 0 && o.fxJump && o.sway > 0.0005 && o.sway < 0.02, JSON.stringify({ fx0: o.fx0, fxIn: o.fxIn, fxJump: o.fxJump, sway: o.sway }));
  check('film director: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2l''. «Нарастание» (the owner's first rule of shooting): the plinth film — the first brick close at its pace, then
// the wall sped up, then walls and courses at once: each step no nearer (but a new angle) and more bricks a second ----
{
  const { browser, page, errors } = await open(pw.chromium, '&film=plinth&offline=1', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await page.waitForFunction(() => window.__tc?.film, null, { timeout: 120000 });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, f = tc.film;
    for (let i = 0; i < 3000 && !f.done; i++) { if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0)); tc.filmStep(1 / 30, 0, false); }
    const G = f.grows || [], rate = G.map((g) => g.n / g.s);
    return { done: f.done, steps: G.length, first: G[0], near: G.every((g, i) => !i || g.turn || g.dist >= G[i - 1].dist * 0.999), faster: rate.every((r, i) => !i || r > rate[i - 1] * 0.5) /* (a shorter wall, the last hold for the eye: not under half the pace before) */ && rate[1] > rate[0] * 5 && rate[2] > rate[1] * 2 && rate[6] > rate[5], up: rate.at(-1) / rate[0],
      laid: f.laid, hud: { rows: document.querySelectorAll('#film .f-hud .f-row').length, on: document.querySelector('#film .f-hud .f-row:nth-child(2) b.on')?.textContent, fab: !!document.querySelector('#film .f-hud .f-fab img') }, jobs: f.jobs, spreads: f.spreads, pitch: f.grows.map((g) => g.pitch), spreadLeft: tc.wallView.spreadG.children.length, t: +f.t.toFixed(1), hook: f.marks?.hook != null && f.marks?.hookEnd != null };
  });
  check('film: «нарастание» — one brick close at its real pace (the game\'s own job: mallet, mortar, trowel), then more and more at once, the camera further each step; all the bricks laid', o.done && o.steps >= 8 && o.first.n === 1 && o.first.s >= 2 && o.near && o.faster && o.up > 100 && o.laid.total === o.laid.done && o.laid.total > 500 && o.hud.rows === 2 && o.hud.on === 'Course' && o.hud.fab /* (the game's face over the film: the chips' rows, the tool button; the way of laying switched) */ && o.spreads >= 4 && o.spreadLeft === 0 /* (the bed spread with the trowel ten bricks at a time, none left unlaid) */ && Math.min(...o.pitch.slice(-4)) < 0.25 /* (rule 3: the courses seen from near level — the horizon in frame) */ && o.jobs >= 40 /* (the close and the sped-up steps: the game's own laying job, brick by brick) */ && o.hook && o.t < 22, JSON.stringify(o));
  check('film (plinth): no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2l''''. «34 steps to the sea» (Ibiza, stage 2): the stepped cinder-block wall — the bond across every other course, the
// sea's end flush, every tread one course, all the blocks laid, the hook (the last block) marked for the loop, two stage bills
{
  const { browser, page, errors } = await open(pw.chromium, '&film=stair&offline=1', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await page.waitForFunction(() => window.__tc?.film, null, { timeout: 120000 });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, f = tc.film;
    const [{ stairCourses }, { MODEL_SCALE }] = await Promise.all([import('/src/film/stairFilm.js'), import('/src/config.js')]);
    const C = stairCourses(0), S = 1 / 1000 / MODEL_SCALE;
    for (let i = 0; i < 4000 && !f.done; i++) { if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0)); tc.filmStep(1 / 30, 0, false); }
    const ends = C.map((k) => k.flat()), lo = ends.map((l) => Math.max(...l.map((r) => r.p[2] + r.s[2] / 2))), hi = ends.map((l) => Math.min(...l.map((r) => r.p[2] - r.s[2] / 2)));
    const run = lo.slice(1).map((v, k) => (lo[k] - v) / S);
    return { done: f.done, laid: f.laid, n: C.length, rows: C.map((k) => k.length), sea: hi.map((v) => Math.round((v - hi[0]) / S)), run, total: C.flat(2).length,
      marks: f.marks, bills: (f.stageBillsLog || []).map((q) => q.usd), spent: 60000 - tc.budget.money };
  });
  check('film (stair): 34 courses, each a 300 tread, the bond across every other course, the sea end flush, under the cinder limit',
    o.n === 34 && o.rows.every((r, k) => r === (k % 2 ? 3 : 6)) && o.run.every((v) => Math.abs(v - 300) < 2) && o.sea.every((v) => Math.abs(v) <= 1) && o.total < 4000,
    JSON.stringify({ rows: o.rows.slice(0, 4), run: o.run.slice(0, 3), sea: o.sea.slice(0, 4), total: o.total }));
  check('film (stair): every block laid, the hook marked before its end (the loop), blocks and mortar billed = spent',
    o.done && o.laid?.done === o.total && o.marks?.hook > 0 && o.marks.hookEnd > o.marks.hook && o.bills.length === 2 && Math.abs(o.bills.reduce((a, v) => a + v, 0) - o.spent) <= 3,
    JSON.stringify({ done: o.done, laid: o.laid, marks: o.marks, bills: o.bills, spent: o.spent }));
  check('film (stair): no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2l'''. The slab film: every stage is the game's own work, started as the finger starts it — the formwork, the slab's
// cage, the columns' cages carried and tied into it, the hose, the poker, the rule, a day on the clock, the columns' forms
// and concrete; the slab ends level, the columns full ----
{
  const { browser, page, errors } = await open(pw.chromium, '&film=slab&offline=1', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await page.waitForFunction(() => window.__tc?.film, null, { timeout: 120000 });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, f = tc.film, t = tc.terrain, M = 1 / 10.4651, H = 5 * M;
    const toast = tc.ui.toast.bind(tc.ui), said = []; tc.ui.toast = (m) => { said.push(String(m)); return toast(m); };
    const g = t.heightAt(0, 0);
    let ghosts = 0, hudMax = 0, frogEarly = 0, frogEnd = 0, frogAll = 0;
    for (let i = 0; i < 3600 && !f.done; i++) { if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0)); tc.filmStep(1 / 30, 0, false); if (tc.columnTool.col.V?.ghost) ghosts++;
      { const J = tc.physJob; if (J?.frogAt != null) { frogAll = J.frogs.length; if (J.t < J.frogAt - 0.05) frogEarly = Math.max(frogEarly, J.nFrogs || 0); else frogEnd = Math.max(frogEnd, J.nFrogs || 0); } } const R = document.querySelector('#film .f-hud .f-row')?.getBoundingClientRect(); if (R) hudMax = Math.max(hudMax, R.right - innerWidth, -R.left); }
    const hs = []; for (let x = -H * 0.95; x <= H * 0.95; x += H / 10) for (let z = -H * 0.95; z <= H * 0.95; z += H / 10) hs.push((t.heightAt(x, z) - g) / M * 1000); hs.sort((a, b) => a - b);
    const cols = tc.objects.all('column');
    // (the top mat under the concrete everywhere: the cover over its bars after the rule — none showing through, the far board too)
    let cover = 1e9; { const cg = tc.objects.all('cage')[0], top = Math.max(...cg.bars.map((b) => Math.max(b[1], b[4]))); for (let x = -H * 0.99; x <= H * 0.99; x += H / 40) for (let z = -H * 0.99; z <= H * 0.99; z += H / 40) cover = Math.min(cover, (t.heightAt(x, z) - top) / M * 1000); }
    // (what went over the boards: the concrete lying outside the outline)
    let over = 0; for (let i = 0; i < t.conc.length; i++) { if (t.conc[i] <= 1e-7) continue; const x = t.toWorldX(i % t.nx), z = t.toWorldZ(Math.floor(i / t.nx)); if (Math.abs(x) > H + 0.008 || Math.abs(z) > H + 0.008) over += t.conc[i]; }
    return { cover: Math.round(cover), bills: (f.stageBillsLog || []).map((q) => q.usd), billNames: (f.stageBillsLog || []).map((q) => q.label).join('|'), frogEarly, frogEnd, frogAll, over: +(over * t.cellArea / M ** 3).toFixed(2), money: tc.budget.money, weather: tc.settings.weather, raining: !!tc.sky.raining, moneyShown: !document.querySelector('#film .f-money')?.hidden, done: f.done, t: +f.t.toFixed(1), forms: tc.objects.all('form').length, cages: tc.objects.all('cage').length, cols: cols.length, tied: cols.filter((r) => r.anc > 100).length, full: cols.filter((r) => (r.fill || 0) >= 0.99 && r.stage >= 3).length,
      m3: +(t.concVolume() / M ** 3).toFixed(1), p10: Math.round(hs[Math.floor(hs.length * 0.1)]), p90: Math.round(hs[Math.floor(hs.length * 0.9)]), ghosts, hudOut: Math.round(hudMax), refused: said.filter((m) => /Сначала опалубка|привязан к фундаменту/.test(m)).length, hook: f.marks?.hook != null && f.marks?.hookEnd != null };
  });
  check('film (slab): the formwork, the cage, four column cages carried under the finger and tied in, 30 m³ out of the hose run level by the poker and the rule, the columns formed and cast — all by the game\'s own jobs', o.done && o.t < 60 && o.forms === 4 && o.cages === 1 && o.cols === 4 && o.tied === 4 && o.full === 4 && o.m3 > 28.5 && o.m3 < 31 && o.p10 > 255 && o.p90 < 335 && o.ghosts > 20 && o.hudOut <= 0 && o.refused === 0 && o.hook && o.over < 0.12 /* (not over the boards) */ && o.frogAll > 20 && o.frogEarly === 0 && o.frogEnd === o.frogAll /* (the frogs: none before the bottom mat lies, all before the top one) */ && o.money < 56000 && o.money > 40000 && o.moneyShown /* (the budget billed and shown) */ && o.weather === 'clear' && !o.raining && o.cover >= 15 && o.bills.length === 6 && o.bills.every((v) => v > 0) && Math.abs(o.bills.reduce((a, v) => a + v, 0) - (60000 - o.money)) <= 3 /* (billed stage by stage, by name — all of what was spent) */, JSON.stringify(o));
  check('film (slab): no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2l'. A film shot in the game frame by frame (film/recorder.js): an mp4 of exactly a 60th a frame, the
// hook first, the words painted into the frames (film/compose.js), the sounds on the film's clock ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, { Director } = await import('./src/film/director.js'), THREE = await import('three'), o = {};
    const P = new THREE.Vector3(0, tc.terrain.heightAt(0, 0), 0);
    function* script(d) {
      d.bar(2); d.cut({ target: P, yaw: 0, pitch: 0.6, dist: 1.5 }); d.title('BIG WORDS', '', 1);
      yield d.sec(0.5); d.mark('hook'); tc.sfx.play('block'); yield d.sec(0.4); d.mark('hookEnd'); yield d.sec(0.2);
    }
    // (the sky's birds and wind off: the check is the blow against the film's quiet, not the ambience's random bars)
    tc.sfx.ambience = () => {}; tc.sfx.rain = () => {};
    tc.filmOffline = true; const d = new Director(tc, script, true); tc.film = d;   /* (held: the frame loop does not step it while the recorder is fetched) */
    const { recordFilm } = await import('./src/film/recorder.js');
    // (the words: white text in the title's band of a frame after the title came up)
    const onFrame = (x, i) => { if (i !== 20) return; const px = x.getImageData(0, 30, 180, 40).data; let n = 0; for (let j = 0; j < px.length; j += 4) if (px[j] > 235 && px[j + 1] > 235 && px[j + 2] > 235) n++; o.words = n; };
    let r; try { r = await recordFilm(tc, { fps: 30, w: 180, h: 320, max: 3, onFrame }); } catch (e) { return { err: String(e) }; }
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    o.ftyp = String.fromCharCode(...buf.slice(4, 8)); o.seconds = +r.seconds.toFixed(3); o.frames = r.frames;
    // (the sound cut like the frames: the blow at the hook's start — the video's start; before it, in the film, quiet)
    const peak = (a, b) => { let m = 0; for (let i = Math.round(a * r.rate); i < Math.round(b * r.rate); i++) m = Math.max(m, Math.abs(r.pcm[0][i])); return m; };
    o.blow = +peak(0, 0.15).toFixed(3); o.before = +peak(0.5, r.seconds).toFixed(3);
    o.sound = o.blow > 0.02 && o.before < o.blow * 0.2;
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(r.blob);
    await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 8000); });
    o.dur = +v.duration.toFixed(2); o.size = [v.videoWidth, v.videoHeight];
    o.box = !!tc.recBox && tc.renderer.domElement.width === 180;
    return o;
  });
  check('film shot frame by frame: an mp4, 180×320, the hook first (0.4 s), the film up to it after (0.5 s)', !o.err && o.ftyp === 'ftyp' && o.frames >= 26 && o.frames <= 30 && Math.abs(o.seconds - 0.93) < 0.07 && Math.abs(o.dur - o.seconds) < 0.1 && o.size[0] === 180 && o.size[1] === 320 && o.box, JSON.stringify(o));
  check('film shot frame by frame: the title painted into the frame; the sound in it', o.words > 40 && o.sound, JSON.stringify(o));
  check('film shot frame by frame: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2n. The 360° places: the photo's own ground laid on the ground round the plot (no disc of other ground over it,
// no fence, no trees), a ragged rim of the site's soil at the plot's edge; the site's things round it ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, o = {};
    // (two choices of one place at once — the start, a tap: one load, the sky kept, not dropped by the other)
    tc.settings.backdrop = 'lake'; await Promise.all([tc.backdrop.set('lake'), tc.backdrop.set('lake')]); o.oneLoad = !!tc.backdrop.panos.lake?.sky?.parent && tc.backdrop.panos.lake.sky.visible;
    tc.settings.backdrop = 'meadow'; await tc.backdrop.set('meadow'); tc.simulate(0.1);
    const P = tc.backdrop.panos.meadow, U = P.sky.material.uniforms, tu = tc.terrainMat.userData.uniforms;
    o.laid = /vGr = 1\.0/.test(P.sky.material.vertexShader) && !!U.tSoil.value && U.uLow.value === 0;
    o.noDisc = !tc.backdrop.ground.visible; o.noSurround = !tc.scene.getObjectByName('surround');
    o.site = tu.uSite.value;
    tc.settings.backdrop = 'site'; await tc.backdrop.set('site'); tc.simulate(0.1); o.siteTrodden = tu.uSite.value === 1 && tc.backdrop.panos.site.sky.material.uniforms.uSite.value === 1;
    // (the site's things: put round it once; the finger carries one, turns it, takes it away; undo brings it back)
    const PR = () => tc.objects.all('siteprop'), V = tc.camera.position.constructor, W = tc.wallTool.prop;
    o.props = PR().length; o.meshes = tc.siteProps.group.children.length;
    const m0 = PR().find((r) => r.kind === 'mixer'), M1 = (m) => m / 10.4651;
    Object.assign(tc.settings, { wallKind: 'siteprop', propMode: 'move' });
    W.down(new V(m0.x, 0, m0.z)); W.move(new V(m0.x + M1(3), 0, m0.z - M1(2))); W.up(); tc.simulate(0.05);
    const m1 = tc.objects.get(m0.id); o.moved = +((m1.x - m0.x) * 10.4651).toFixed(2);
    tc.journal.undo?.(); tc.simulate(0.05); o.undone = Math.abs(tc.objects.get(m0.id).x - m0.x) < 1e-6;
    tc.settings.propMode = 'turn'; W.down(new V(m0.x, 0, m0.z)); o.turned = +(tc.objects.get(m0.id).yaw - m0.yaw).toFixed(3);
    tc.settings.propMode = 'del'; W.down(new V(m0.x, 0, m0.z)); tc.simulate(0.05); o.gone = !tc.objects.get(m0.id) && tc.siteProps.group.children.length === o.meshes - 1;
    // (the bin — «Удалить» — in this tab: the thing under the finger, nothing else)
    { const t0 = PR().find((r) => r.kind === 'toilet'), n0 = tc.objects.all().length; tc.wallTool._delete(new V(t0.x, 0, t0.z)); tc.simulate(0.05); o.binTook = !tc.objects.get(t0.id) && tc.objects.all().length === n0 - 1; }
    tc.settings.propMode = 'cabin'; W.down(new V(0, 0, 0)); o.added = PR().filter((r) => r.kind === 'cabin').length;
    // (the ground changed under one — dug, heaped: it is stood on it again, not left in the air)
    { const m = tc.siteProps.meshes.get(PR()[0].id), y = m.position.y; m.position.y = y + 1; tc.terrain.rev = (tc.terrain.rev || 0) + 1; tc.siteProps.update(); o.restood = Math.abs(m.position.y - y) < 1e-6; }
    // (each thing its real height — a part lost in a comment, a roof gone, shows here)
    { const SP = await import('/src/world/siteProps.js'), THREE = await import('three'); o.heights = {};
      for (const k of Object.keys(SP.PROPS)) { const g = await SP.propMesh(k).userData.ready, b = new THREE.Box3().setFromObject(g.children.at(-1)); /* (the model, not its blocks) */ o.heights[k] = Math.round((b.max.y - b.min.y) * 1000);
        /* (its foot — what stands on the ground: no wider than the model, not much narrower) */ const f = SP.PROPS[k].foot, d = [(b.max.x - b.min.x) * 1000, (b.max.z - b.min.z) * 1000]; (o.feet ||= {})[k] = f.every((v, i) => v <= d[i] + 25 && v >= d[i] * 0.8); } }   // (the models in metres)
    tc.settings.backdrop = 'workshop'; await tc.backdrop.set('workshop'); tc.simulate(0.1);
    o.hidden = tu.uSite.value === 0;
    return o;
  });
  check('360° places: the photo\'s own ground laid round the plot (no disc, no fence, no trees), the site\'s soil rim; the trodden ground only at the site', o.oneLoad && o.laid && o.noDisc && o.noSurround && o.site === 0 && o.siteTrodden && o.hidden, JSON.stringify(o));
  check('site things: put round the site once (10), carried by the finger (3 m), undone, turned 45°, taken away, put down', o.props === 10 && o.meshes === 10 && Math.abs(o.moved - 3) < 0.05 && o.undone && Math.abs(o.turned - 0.785) < 0.01 && o.gone && o.binTook && o.added === 2 && o.restood, JSON.stringify(o));
  check('site things: each its model, its real height (toilet 2,3 m, cabin 2,55 — taller than it, mixer 1,35, barrow 0,74, cones 0,75; none missing)', Object.values(o.feet).every(Boolean) && Math.abs(o.heights.toilet - 2300) < 30 && Math.abs(o.heights.cabin - 2550) < 40 && o.heights.cabin / o.heights.toilet >= 1.08 && Math.abs(o.heights.mixer - 1350) < 30 && o.heights.pallet > 500 && o.heights.bricks > 500 && o.heights.bags > 500 && Math.abs(o.heights.barrow - 740) < 40 && Math.abs(o.heights.cones - 750) < 30 && Object.values(o.heights).every((h) => h > 200), JSON.stringify(o.heights));
  check('360° places: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2o. Facing bricks («Стены» → «Кладка» → «Кирпич» → «Облицовочный»): a brick laid takes the colour chosen, drawn
// with its colour's band of the atlas; the filler brick none ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, wt = tc.wallTool, M = 1 / 1000 / 10.4651, o = {}, W = await import('/src/world/walls.js');
    o.colours = Object.keys(W.FACING).length;
    tc.settings.brickFace = 'anthracite'; o.face = wt._face('brick').face; o.blockNone = !wt._face('block').face;
    tc.settings.brickFace = null; o.fillerNone = !wt._face('brick').face;
    const g = tc.terrain.heightAt(0, 0), add = (x, face) => tc.objects.add({ type: 'unit', kind: 'brick', free: true, ...(face ? { face } : {}), p: [x, g + 32.5 * M, 0], s: [250 * M, 65 * M, 120 * M], q: [0, 0, 0, 1] });
    add(0, 'yellow'); add(260 * M, null); tc.simulate(0.2);
    const a = tc.wallView.bricks.geometry.attributes.aLayer.array, own = tc.wallView.owner.bricks, recs = tc.objects.all('unit');
    o.layers = own.slice(0, tc.wallView.bricks.count).map((id, i) => [recs.find((r) => r.id === id)?.face || 'filler', a[i]]);
    o.tex = !!tc.wallView.bricks.material.map?.image?.src?.includes('brick_atlas');
    return o;
  });
  check('facing bricks: 7 colours; a brick laid takes the colour chosen (the filler one none, a block none); drawn with its band of the atlas', o.colours === 7 && o.face === 'anthracite' && o.blockNone && o.fillerNone && o.layers.some(([f, l]) => f === 'yellow' && l === 6) && o.layers.some(([f, l]) => f === 'filler' && l === 0), JSON.stringify(o));
  check('facing bricks: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 2m. The realist (.claude/agents/realist.md): checks of what the game shows against how it really is ----
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const o = await page.evaluate(async () => {
    const tc = window.__tc, t = tc.terrain, M = 1 / 1000 / 10.4651, o = {};
    // a heap of sand tipped in one place: it slides until it lies at its angle of repose (dry sand 30–34°)
    const x = -0.3, z = -0.3; for (let k = 0; k < 40; k++) t.deposit(x, z, 6.5e-6, 0.02, 0, 1);   // (≈ 0,3 m³)
    for (let i = 0; i < 4000 && t.active; i++) t.relax(1);
    let worst = 0; const c = t.cell;
    for (let a = -0.25; a <= 0.25; a += c) for (let b = -0.25; b <= 0.25; b += c) { const h0 = t.heightAt(x + a, z + b), h1 = t.heightAt(x + a + c, z + b), h2 = t.heightAt(x + a, z + b + c); worst = Math.max(worst, Math.abs(h1 - h0) / c, Math.abs(h2 - h0) / c); }
    o.heap = +((t.heightAt(x, z) - t.orig[t.index(x, z)]) / M).toFixed(0); o.slope = +(Math.atan(worst) * 180 / Math.PI).toFixed(1);
    // the pump's end hose: the hand walks it (≤ 1,2 m/s), the stream starts at the spout, thinner below, lags when swept
    { const { PumpHose } = await import('/src/world/pumpHose.js'), V = tc.camera.position.constructor, H = new PumpHose(), m = 1 / 10.4651;
      H.group.visible = true; H.aim(new V(0, 0.6 * m, 0), new V(0, 1, 5), true); const gy = () => 0; let vmax = 0, top = 0, lag = 0, last = H.hand.clone();
      H.target.set(2 * m, 0.6 * m, 0);
      for (let i = 0; i < 150; i++) { H.update(1 / 30); const ln = H.setStream(true, gy, i / 30, 1 / 30); vmax = Math.max(vmax, H.hand.distanceTo(last) * 30 / m); last.copy(H.hand);
        const sp = H.spout(), p0 = H.stream.geometry.attributes.position; if (p0) { let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 10; k++) { cx += p0.getX(k); cy += p0.getY(k); cz += p0.getZ(k); } top = Math.max(top, Math.hypot(cx / 10 - sp.x, cy / 10 - sp.y, cz / 10 - sp.z) / m); } }
      // (swept at 0,6 m/s: the foot of the stream behind the spout)
      for (let i = 0; i < 60; i++) { H.target.x += 0.02 * m; H.update(1 / 30); const ln = H.setStream(true, gy, 5 + i / 30, 1 / 30); if (i > 40) lag = Math.max(lag, (H.spout().x - ln.x) / m); }
      // (full of concrete it is stiff: straight down out of the clamp — its first half metre no more than a few degrees off plumb, even swept)
      let root = 0; for (let i = 0; i < 40; i++) { H.target.x += 0.03 * m; H.update(1 / 30); root = Math.max(root, Math.atan2(Math.hypot(H.p[3].x - H.p[0].x, H.p[3].z - H.p[0].z), H.p[0].y - H.p[3].y) * 180 / Math.PI); }
      // (the stream never runs off sideways: brought to a new place 6 m away, and stepped many times to one move of the
      // hose (a film sped up), its pieces stay under the spout — within a metre of it; over a column: straight down)
      let side = 0; { H.setStream(false); H.aim(new V(6 * m, 3.4 * m, 2 * m), new V(0, 1, 5), true); for (let i = 0; i < 30; i++) { H.target.x += 0.004 * m; H.update(1 / 30); for (let k = 0; k < 8; k++) { H.setStream(true, gy, 9 + i / 30, 1 / 240, i >= 15); const sp = H.spout(); for (const q of H.drops) side = Math.max(side, Math.hypot(q.p.x - sp.x, q.p.z - sp.z) / m); } } }
      o.hose = { side: +side.toFixed(2), root: +root.toFixed(1), vmax: +vmax.toFixed(2), top: +(top * 1000).toFixed(1), lag: +(lag * 1000).toFixed(0), thin: H.stream.userData.bottomR <= H.stream.userData.topR }; }
    return o;
  });
  check('realist: a heap of sand lies at its angle of repose (≤ 36°), not as a column', o.heap > 40 && o.slope <= 36, JSON.stringify(o));
  check('realist: the pump hose — led by hand (≤ 2,7 m/s — between a walk and the finger), the stream from the spout, thinner below, lagging when swept', o.hose.vmax <= 2.7 && o.hose.vmax > 1.5 && o.hose.root < 12 && o.hose.side < 1 && o.hose.top < 6 && o.hose.thin && o.hose.lag >= 0 /* (never ahead of the spout; the stiff hose sways little, so the stream lags by a millimetre or two) */ && o.hose.lag < 250, JSON.stringify(o.hose));
  check('realist: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- 3. WebKit (Safari's engine), if installed ------------------------------------------------------
if (process.env.WEBKIT) {
  try {
    const dir = fs.readdirSync(process.env.WEBKIT).find((d) => d.startsWith('webkit-'));
    const { browser, page, errors } = await open(pw.webkit, '', { executablePath: path.join(process.env.WEBKIT, dir, 'pw_run.sh') });
    const st = await page.evaluate(shaderState);
    check('WebKit: soil shader builds', st.runnable && !st.fallback && !st.light, JSON.stringify(st.errors));
    check('WebKit: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
  } catch (e) { check('WebKit run', false, e.message.slice(0, 200)); }
}

server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${failed ? 'FAILED' : 'OK'}: ${results.length - failed}/${results.length} in ${sec()}`);
process.exit(failed ? 1 : 0);
