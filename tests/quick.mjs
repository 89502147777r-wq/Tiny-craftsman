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

async function open(browserType, query, opts = {}) {
  const browser = await browserType.launch(opts);
  const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 })).newPage();
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
      const rebar = [...document.querySelectorAll('.fan-item')].find((e) => e.textContent.includes('Арматура'));
      rebar.click();
      const modes = [...document.querySelectorAll('#subbar .chip-btn')].map((b) => b.textContent);
      const shown = vis('#subbar') && ui.fanOpen;
      [...document.querySelectorAll('#subbar .chip-btn')].find((b) => b.textContent === 'Сетка').click();
      const picked = tc.rebarTool.mode === 'mesh' && !ui.fanOpen && !vis('#subbar');
      ui.setQuiet(false);
      const normal = vis('.tools') && document.getElementById('fan').hidden;
      return { quiet, modes, shown, picked, normal };
    });
    check('quiet mode: panels hidden, tool modes in the fan, panels come back', q.quiet && q.shown && q.picked && q.normal, JSON.stringify(q));
  }
  check(`${variant}: no console errors on start`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}
console.log('—', sec());

// ---- 2. Chromium: play ------------------------------------------------------------------------
{
  const { browser, page, errors } = await open(pw.chromium, '', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('tiny-craftsman'); });
  await page.reload();
  await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 });
  const play = await page.evaluate(async () => {
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
    // setting-out, formwork, cage, ties
    const e = { clientX: 0, clientY: 0 };
    tc.setTool('mark'); tc.markTool.setMode('trench');
    tc.markTool.down(new V(0.55, 0.1, 0.1)); tc.markTool.move(new V(0.8, 0.1, 0.1)); tc.markTool.up();
    tc.markTool.down(new V(0.8, 0.1, 0.3)); tc.markTool.up(); tc.markTool.finishTrench();
    tc.setTool('form'); tc.formTool.setMode('outline'); tc.formTool.down(new V(0.68, 0.09, 0.1), e);
    tc.setTool('rebar'); tc.rebarTool.setMode('cage'); tc.rebarTool.down(new V(0.68, 0.09, 0.1), e);
    tc.rebarTool.setMode('tie'); tc.rebarTool.down(new V(0.68, 0.09, 0.1), e);
    out.objects = { outlines: tc.objects.all('outline').length, forms: tc.objects.all('form').length, cages: tc.objects.all('cage').length, tied: tc.objects.all('cage').some((c) => c.tied) };
    tc.setTool('camera');
    await tc.saveNow();
    out.saved = { n: tc.journal.done.length, o: tc.objects.all().length, exc: +(t.excavatedVolume() * 1e6).toFixed(3) };
    return out;
  });
  check('shovel digs (3 passes ≥ 25 mm)', play.depth > 0.025, `${(play.depth * 1000).toFixed(1)} mm, ${play.scoops} scoops`);
  check('soil volume conserved', Math.abs(play.drift) < 50, `${play.drift.toFixed(2)} mm3`);
  check('spoil remembers the layer it came from', play.spoilDepth > 0.003, `${(play.spoilDepth * 1000).toFixed(1)} mm`);
  check('undo / redo exact', play.undo);
  check('rake lowers the heap, keeps the soil, undoes', play.rake.h1 < play.rake.h0 - 5 && Math.abs(play.rake.drift) < 50 && play.rake.strokes === 4 && play.rake.undo,
    `${play.rake.h0.toFixed(1)} → ${play.rake.h1.toFixed(1)} mm, ${play.rake.drift.toFixed(2)} mm3, ${play.rake.strokes} strokes`);
  check('trench, formwork, cage and ties placed', play.objects.outlines === 2 && play.objects.forms >= 4 && play.objects.cages === 1 && play.objects.tied, JSON.stringify(play.objects));
  await page.reload();
  await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 });
  const after = await page.evaluate(() => { const tc = window.__tc; return { n: tc.journal.done.length, o: tc.objects.all().length, exc: +(tc.terrain.excavatedVolume() * 1e6).toFixed(3) }; });
  check('project restored after reload', JSON.stringify(after) === JSON.stringify(play.saved), `${JSON.stringify(play.saved)} → ${JSON.stringify(after)}`);
  check('no console errors while playing', errors.length === 0, errors.slice(0, 3).join(' | '));
  const build = fs.readFileSync(path.join(root, 'src/config.js'), 'utf8').match(/BUILD = (\d+)/)[1];
  check('BUILD number in the game matches config', String(play.build) === build, `BUILD ${play.build}`);
  await browser.close();
}
console.log('—', sec());

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
