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
  await page.reload();
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
    for (let i = 0; i < 400 && tc.shovelTool.state !== 'idle'; i++) tc.simulate(0.05);
    mats.dumpedSand = t.topMat(t.index(-0.2, 0.25)) === 1;
    const lH = t.lH.slice();
    tc.undo(); tc.undo(); tc.redo(); tc.redo();
    let le = 0; for (let i = 0; i < lH.length; i++) le = Math.max(le, Math.abs(lH[i] - t.lH[i]));
    mats.undo = le < 1e-9;
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
  await page.reload();
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
    // a lawn round it
    Object.assign(tc.settings, { landWhat: 'lawn', lawnLayer: 'area', lawnHow: 'turf' });
    const L = [], C = [[-0.55, 0.45], [0.15, 0.45], [0.15, -0.05], [-0.55, -0.05]];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 10; i++) L.push(new V(C[k][0] + (C[(k + 1) % 4][0] - C[k][0]) * i / 10, 0.1, C[k][1] + (C[(k + 1) % 4][1] - C[k][1]) * i / 10));
    drag(L);
    for (const k of ['soil', 'rake', 'roll', 'grass', 'water']) { tc.settings.lawnLayer = k; tap(new V(0.05, 0.1, 0.0)); }
    const lawn = tc.objects.all('lawn')[0];
    out.lawn = { done: Object.keys(lawn?.done || {}).join(), cells: tc.gardenView.parts.get('L' + lawn.id)?.sub.body?.children.length };
    // a fence
    Object.assign(tc.settings, { landWhat: 'fence', fenceLayer: 'line', fenceKind: 'slat', fenceH: 1800 });
    const F = []; for (let i = 0; i <= 20; i++) F.push(new V(-0.6 + 0.8 * i / 20, 0.1, 0.55));
    drag(F);
    tc.settings.fenceLayer = 'gate'; tc.settings.gateType = 'wicket'; tap(F[5]);
    for (const k of ['holes', 'posts', 'fill']) { tc.settings.fenceLayer = k; tap(F[10]); }
    tc.settings.fenceLayer = 'gate'; tap(F[5]);
    const fence = tc.objects.all('fence')[0];
    out.fence = { done: Object.keys(fence?.done || {}).join(), gate: fence?.gates?.map((q) => q.type + (q.hung ? ':hung' : '') + (q.open ? ':open' : '')).join() };
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
  check('garden: a lawn round it (topsoil, rake, roller, turf, water), a fence (holes, posts, slats), plants and a light', land.lawn.done === 'soil,rake,roll,grass,water' && land.lawn.cells >= 2 && land.fence.done === 'holes,posts,fill' && land.fence.gate === 'wicket:hung:open' && land.plants === 'tree,ball,thuja,bollard,hedge', JSON.stringify({ lawn: land.lawn, fence: land.fence, plants: land.plants }));
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
  check('columns: in «Фундамент» (sizes, formwork, cage, stripping), not under the walls; the tray holds the formwork', c.chips === 'Размеры|1 · Опалубка|2 · Каркас|3 · Распалубка|Удалить' && c.tray === 'Опалубка' && !c.wallCols, JSON.stringify(c));
  check('columns: three piles bored, their two-half formwork set; a column not on the bare soil; the cages carried in', c.formed === '2false,2false,2false' && c.sqOnSoil && c.caged, JSON.stringify(c));
  check('columns: the bucket and the hose fill them, stripped once strong; a brick and a slab on the piles', c.pail > 0.03 && c.pail < 0.5 && c.cast === '3,3,3' && c.stripped === '4,4,4' && c.brick !== null && c.brick > 0 && c.brick < 25 && c.slab === '3' && c.starter < -30, JSON.stringify(c));
  check('columns: either order (a cage first, the formwork round it), tied into a foundation cage (no formwork till it is cast), the sliders resize the picked one', c.cageFirst === '0true' && c.formAfter === 2 && c.preview === 400 && c.resized === '400,4' && c.tied > 250 && c.tied < 450 && c.tiedStage === '0true' && c.tiedNoForm && c.boredCage === 'true|1200|true' && c.landing, JSON.stringify(c));
  check('black topsoil: delivered (1 m³), the soil shader builds', Math.abs(c.black - 1) < 0.05 && c.shader === 0, JSON.stringify(c));
  check('columns: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
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
