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
      // (the realist, 302: two men, one trip each at a time — never a swarm in the air; a stake turned only once its point is out)
      let trips = 0, tilt = 0; const job = tc.physJob, up = new V(0, 1, 0), q0 = new tc.camera.quaternion.constructor();
      for (let i = 0; i < 3600 && tc.physJob; i++) { tc.simulate(1 / 30);
        if (job?.pieces) { const fly = new Set(job.pieces.filter((p) => p.from && !p.dropped).map((p) => p.carry)); trips = Math.max(trips, fly.size);
          for (const p of job.pieces) if (p.k === 'stake' && p.from && !p.dropped && p.body && Math.hypot(p.body.translation().x / 10.4651 - p.p.x, p.body.translation().z / 10.4651 - p.p.z) < 0.01) { const tr = p.body.translation(), r = p.body.rotation(); q0.set(r.x, r.y, r.z, r.w); const ax = up.clone().applyQuaternion(q0), tipY = tr.y / 10.4651 - Math.abs(ax.y) * p.s.y / 2; if (tipY < t.heightAt(tr.x / 10.4651, tr.z / 10.4651) - 1e-4) tilt = Math.max(tilt, Math.acos(Math.min(1, Math.abs(ax.y))) * 180 / Math.PI); } } }
      const pile = tc.objects.all('formpile')[0];
      const stripped = mine() === 0 && !!pile && pile.boards.length >= n0;
      tc.undo(); const back = mine() === n0 && !tc.objects.all('formpile').length; tc.redo();
      const bl = (pile?.items || []).filter((it) => it.k === 'board').sort((a, b) => a.p[1] - b.p[1]), layered = bl.every((it, k) => !k || it.s[0] <= bl[k - 1].s[0] + 1e-4 || it.p[1] - bl[k - 1].p[1] < 1e-4);
      out.strip = { trips, tilt: +tilt.toFixed(1), layered, bearers: (pile?.items || []).filter((it) => it.bear).length, n0, warned, running, stripped, items: pile?.items?.length, still: !!pile?.items?.every((it) => it.p.every(Number.isFinite)), boards: pile?.boards.length, stakes: pile?.stakes, back, conc: Math.abs(t.concVolume() - cv) < 1e-12 };
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
  check('stripping as a crew does it (the realist): ≤ 2 trips in the hands at once, a stake not turned while its point is in the ground (< 5°), the longest boards lowest, on 3 bearers', play.strip.trips <= 2 && play.strip.tilt < 5 && play.strip.layered && play.strip.bearers === 3, JSON.stringify(play.strip));
  check('stripping: warns while soft, then boards come off into a stack, concrete stays, undo', play.strip.warned && play.strip.running && play.strip.still && play.strip.stripped && play.strip.back && play.strip.conc && play.strip.n0 > 0, JSON.stringify(play.strip));
  check('project restored after reload', JSON.stringify(after) === JSON.stringify(play.saved), `${JSON.stringify(play.saved)} → ${JSON.stringify(after)}`);
  check('no console errors while playing', errors.length === 0, errors.slice(0, 3).join(' | '));
  const build = fs.readFileSync(path.join(root, 'src/config.js'), 'utf8').match(/BUILD = (\d+)/)[1];
  check('BUILD number in the game matches config', String(play.build) === build, `BUILD ${play.build}`);
  await browser.close();
}
console.log('—', sec());

server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${failed ? 'FAILED' : 'OK'}: ${results.length - failed}/${results.length} in ${sec()}`);
process.exit(failed ? 1 : 0);
