// Stage 2 scenario through the game's own tool API (same code paths as touch):
// pit + trench layout, digging, formwork, rebar cage + ties, mesh, excavator,
// tractor, backdrops, undo/redo, save/reload, Blender replay consistency.
// Usage: node tests/stage2.mjs [baseUrl] [outDir]   (Q=low|medium|high)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const base = process.argv[2] || 'http://localhost:8080/';
const outDir = process.argv[3] || 'docs/screenshots/stage2';
fs.mkdirSync(outDir, { recursive: true });
const q = process.env.Q || 'low';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name, cam, wait = 2500) => {
  if (cam) await ev((c) => window.__tc.rig.setState(c), cam);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  console.log('shot', name);
};
const ready = async () => { await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 }); await page.waitForTimeout(800); };
const idle = () => page.waitForFunction(() => !window.__tc.busy() && !window.__tc.journal.pending, null, { timeout: 120000 });

await page.goto(`${base}?dpr=1&quality=${q}`);
await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('tiny-craftsman'); });
await page.reload();
await ready();
if (process.env.DOF) await ev((d) => { window.__tc.settings.dof = d; window.__tc.applySettings(); }, Number(process.env.DOF));
const total0 = await ev(() => window.__tc.terrain.totalVolume());
check('fresh plot has the default pit outline', (await ev(() => window.__tc.objects.all('outline').length)) === 1);

// ---- marking: a trench (L-shape) with the marking tool ------------------------------------
await ev(() => {
  const tc = window.__tc, V = tc.camera.position.constructor;
  tc.setTool('mark'); tc.markTool.setMode('trench');
  tc.markTool.down(new V(-0.24, 0.1, 0.12)); tc.markTool.move(new V(-0.12, 0.1, 0.12)); tc.markTool.up();
  tc.markTool.down(new V(-0.12, 0.1, 0.19)); tc.markTool.up();
  tc.markTool.finishTrench();
});
const outs = await ev(() => window.__tc.objects.all('outline').map((o) => ({ kind: o.kind, pts: o.pts?.length, depth: o.depth })));
check('trench outline created', outs.some((o) => o.kind === 'trench' && o.pts === 3), JSON.stringify(outs));
await shot('01-marking', { target: [-0.05, 0.09, 0.05], yaw: 0.3, pitch: 0.95, dist: 0.62 });

// ---- dig the pit and the trench with the shovel (stops at design grade) -------------------
await ev(async () => {
  const tc = window.__tc, V = tc.camera.position.constructor;
  tc.setTool('shovel');
  const wait = () => new Promise((res) => { const f = () => (tc.shovelTool.state === 'idle' ? res() : setTimeout(f, 30)); f(); });
  const dumps = [[0.17, -0.12], [0.2, -0.08], [0.15, -0.16], [0.21, -0.14]];
  let k = 0;
  const swipe = async (x0, z0, x1, z1) => {
    let t = 0;
    while (t < 1) {
      const ts = t;
      tc.shovelTool.down(new V(x0 + (x1 - x0) * t, 0.1, z0 + (z1 - z0) * t));
      while (tc.shovelTool.state === 'dig' && t < 1) { t += 0.01; tc.shovelTool.move(new V(x0 + (x1 - x0) * t, 0.1, z0 + (z1 - z0) * t)); }
      tc.shovelTool.up();
      if (tc.shovelTool.state === 'loaded') { const d = dumps[k++ % dumps.length]; tc.shovelTool.down(new V(d[0], 0.1, d[1])); tc.shovelTool.up(); tc.shovelTool.finish(); }
      await wait();
      if (t === ts) t += 0.04;
    }
  };
  tc.settings.bite = 5;
  for (let pass = 0; pass < 3; pass++) for (let z = -0.052; z <= 0.053; z += 0.013) await swipe(-0.068, z, 0.068, z);
  for (let pass = 0; pass < 10; pass++) { await swipe(-0.235, 0.12, -0.125, 0.12); await swipe(-0.12, 0.125, -0.12, 0.185); }
});
const dug = await ev(() => { const tc = window.__tc; return { exc: tc.terrain.excavatedVolume() * 1e6, total: tc.terrain.totalVolume(), n: tc.journal.done.length }; });
check('pit + trench dug, volume conserved', dug.exc > 50 && Math.abs(dug.total - total0) / total0 < 1e-4, `exc=${dug.exc.toFixed(1)} cm3, drift=${((dug.total - total0) * 1e9).toFixed(2)} mm3, actions=${dug.n}`);
await shot('02-dug', { target: [-0.04, 0.08, 0.04], yaw: 0.45, pitch: 0.75, dist: 0.6 });

// ---- formwork around the pit, rebar cage, ties, a mesh sheet, a single bar -----------------
const fw = await ev(() => {
  const tc = window.__tc, V = tc.camera.position.constructor, ev = { clientX: 0, clientY: 0 };
  tc.setTool('form'); tc.formTool.setMode('outline');
  tc.formTool.down(new V(0, 0.09, 0), ev);          // pit
  tc.formTool.down(new V(-0.2, 0.09, 0.12), ev);    // trench
  tc.setTool('rebar'); tc.rebarTool.setMode('cage');
  tc.rebarTool.down(new V(0, 0.09, 0), ev);
  tc.rebarTool.down(new V(-0.2, 0.09, 0.12), ev);
  tc.rebarTool.setMode('tie');
  tc.rebarTool.down(new V(0, 0.09, 0), ev);
  tc.rebarTool.setMode('mesh');
  tc.rebarTool.down(new V(0.12, 0.1, 0.05), ev); tc.rebarTool.move(new V(0.2, 0.1, 0.12)); tc.rebarTool.up();
  tc.rebarTool.setMode('bar');
  tc.rebarTool.down(new V(0.1, 0.1, 0.16), ev); tc.rebarTool.move(new V(0.22, 0.1, 0.163)); tc.rebarTool.up();
  return { forms: tc.objects.all('form').length, cages: tc.objects.all('cage').map((c) => ({ bars: c.bars.length, tied: c.tied })), mesh: tc.objects.all('mesh').length, bars: tc.objects.all('bar').length };
});
check('formwork runs placed (pit 4 + trench sides)', fw.forms >= 10, JSON.stringify(fw));
check('cages laid out, pit cage tied', fw.cages.length === 2 && fw.cages.some((c) => c.tied && c.bars > 20));
check('mesh sheet and single bar placed', fw.mesh === 1 && fw.bars === 1);
await shot('03-formwork-rebar', { target: [0.0, 0.085, 0.0], yaw: 0.5, pitch: 0.62, dist: 0.32 });
await shot('04-cage-macro', { target: [0.03, 0.08, 0.03], yaw: 0.9, pitch: 0.45, dist: 0.13 });
await shot('05-trench-cage', { target: [-0.17, 0.085, 0.13], yaw: -0.2, pitch: 0.6, dist: 0.2 });

// undo / redo of an object action
const u = await ev(() => {
  const tc = window.__tc;
  const before = tc.objects.all('bar').length;
  tc.undo(); const afterUndo = tc.objects.all('bar').length;
  tc.redo(); const afterRedo = tc.objects.all('bar').length;
  return { before, afterUndo, afterRedo };
});
check('undo/redo of a placed bar', u.before === 1 && u.afterUndo === 0 && u.afterRedo === 1, JSON.stringify(u));

// ---- excavator: drive in, dig a scoop, dump it --------------------------------------------
const ex = await ev(async () => {
  const tc = window.__tc, V = tc.camera.position.constructor;
  tc.setTool('machine'); tc.machineTool.select('excavator');
  const m = tc.machineTool.machine;
  // wait for game time (the software renderer in CI runs at a few fps)
  const sleep = (ms) => new Promise((r) => { const t0 = tc.clock; const f = () => (tc.clock - t0 >= ms / 1000 ? r() : setTimeout(f, 20)); f(); });
  const x0 = m.x, z0 = m.z;
  tc.machineTool.joystick(0, -1); await sleep(1500); tc.machineTool.joystick(0, 0); await sleep(1200);
  const moved = Math.hypot(m.x - x0, m.z - z0);
  // dig on untouched ground behind the pit (pulling towards the cab), dump to the side
  const c = m.local(0, 0);
  const vol0 = tc.terrain.excavatedVolume();
  const tgt = { x: c.x + 0.02, z: c.z - 0.2 };
  const d = Math.hypot(tgt.x - c.x, tgt.z - c.z), ux = (c.x - tgt.x) / d, uz = (c.z - tgt.z) / d;
  tc.machineTool.down(new V(tgt.x, 0.1, tgt.z));
  for (let i = 1; i <= 30 && tc.machineTool.scoop.state === 'dig'; i++) tc.machineTool.move(new V(tgt.x + ux * i * 0.003, 0.1, tgt.z + uz * i * 0.003));
  tc.machineTool.up();
  const loaded = tc.machineTool.scoop.state;
  await sleep(800);
  tc.machineTool.down(new V(c.x - 0.15, 0.1, c.z - 0.04)); await sleep(900);
  tc.machineTool.up();
  await sleep(2500);
  return { moved, loaded, state: tc.machineTool.scoop.state, dug: (tc.terrain.excavatedVolume() - vol0) * 1e6 };
});
check('excavator drives', ex.moved > 0.03, `moved ${(ex.moved * 1000).toFixed(0)} mm`);
check('excavator bucket digs and dumps', ex.loaded === 'loaded' && ex.dug > 5, JSON.stringify(ex));
await idle();
await shot('06-excavator', await ev(() => { const m = window.__tc.machineTool.machines.excavator; return { target: [m.x, m.y + 0.06, m.z], yaw: m.yaw + 2.2, pitch: 0.38, dist: 0.5 }; }), 3000);

// ---- tractor: drive with the bucket down (bulldoze), carry, dump ---------------------------
const tr = await ev(async () => {
  const tc = window.__tc;
  const sleep = (ms) => new Promise((r) => { const t0 = tc.clock; const f = () => (tc.clock - t0 >= ms / 1000 ? r() : setTimeout(f, 20)); f(); });
  tc.machineTool.select('tractor');
  const m = tc.machineTool.machine;
  const total = tc.terrain.totalVolume();
  tc.machineTool.loader('dig'); await sleep(1200);
  tc.machineTool.joystick(0, -0.8); await sleep(2200); tc.machineTool.joystick(0, 0); await sleep(600);
  const load = m.load;
  tc.machineTool.loader('raise'); await sleep(1500);
  tc.machineTool.loader('dump'); await sleep(2500);
  await new Promise((res) => { const f = () => (!tc.particles.busy ? res() : setTimeout(f, 50)); f(); });
  return { load: load * 1e6, after: m.load * 1e6, drift: (tc.terrain.totalVolume() + m.load - total) * 1e9 };
});
check('tractor bucket fills when pushing', tr.load > 5, JSON.stringify(tr));
check('tractor dump empties bucket, soil conserved', tr.after < 0.5 && Math.abs(tr.drift) < 50, `drift ${tr.drift.toFixed(2)} mm3`);
await idle();
await shot('07-tractor', await ev(() => { const m = window.__tc.machineTool.machines.tractor; return { target: [m.x, m.y + 0.06, m.z], yaw: m.yaw + 1.0, pitch: 0.35, dist: 0.5 }; }), 3000);

// ---- backdrops ------------------------------------------------------------------------------
await ev(() => window.__tc.setTool('camera'));
await ev(() => window.__tc.setBackdrop('site'));
await page.waitForFunction(() => window.__tc.backdrop.mode === 'site' && window.__tc.backdrop.dayTex, null, { timeout: 60000 });
await shot('08-site-panorama', { target: [0, 0.1, 0], yaw: 0.6, pitch: 0.28, dist: 0.9 }, 4000);
await ev(() => window.__tc.setBackdrop('photo2'));
await shot('09-photo-backdrop', { target: [0, 0.1, 0], yaw: 0.0, pitch: 0.3, dist: 0.7 }, 4000);
await ev(() => window.__tc.setBackdrop('workshop'));
await shot('10-workshop-overview', { target: [0, 0.07, 0], yaw: 0.5, pitch: 0.62, dist: 1.0 }, 3000);

// ---- persistence + Blender consistency --------------------------------------------------------
await idle();
const exp = await ev(async () => {
  const tc = window.__tc;
  const { toJSON, fromJSON } = await import('./src/core/storage.js');
  const p = fromJSON(toJSON(tc.buildProject()));
  const nat = p.terrain.nat.slice(), loose = p.terrain.loose.slice();
  for (const r of [...p.journal.done].reverse()) if (r.diff) r.diff.idx.forEach((i, k) => { nat[i] = r.diff.bn[k]; loose[i] = r.diff.bl[k]; });
  let start = 0; for (let i = 0; i < nat.length; i++) start = Math.max(start, Math.abs(nat[i] - p.terrain.orig[i]), loose[i]);
  for (const r of p.journal.done) if (r.diff) r.diff.idx.forEach((i, k) => { nat[i] = r.diff.an[k]; loose[i] = r.diff.al[k]; });
  let end = 0; for (let i = 0; i < nat.length; i++) end = Math.max(end, Math.abs(nat[i] - p.terrain.nat[i]), Math.abs(loose[i] - p.terrain.loose[i]));
  // object replay: rebuild the final object set from the journal ops
  const objs = new Map();
  for (const r of p.journal.done) for (const o of r.objs || []) { if (o.after) objs.set(o.id, o.after); else objs.delete(o.id); }
  const finalIds = new Set(p.objects.items.map((r) => r.id));
  const sameObjs = objs.size >= finalIds.size - 1 && [...finalIds].every((id) => objs.has(id) || p.objects.items.find((r) => r.id === id)?.type === 'outline');
  await tc.saveNow();
  return { start, end, sameObjs, actions: p.journal.done.length, objects: p.objects.items.length, kb: Math.round(toJSON(p).length / 1024) };
});
check('journal replays terrain exactly', exp.start < 1e-9 && exp.end < 1e-9, `start ${exp.start} end ${exp.end}`);
check('journal replays objects', exp.sameObjs, JSON.stringify(exp));
const before = await ev(() => ({ n: window.__tc.journal.done.length, o: window.__tc.objects.all().length, ex: !!window.__tc.machineTool.machines.excavator }));
await page.reload();
await ready();
const after = await ev(() => ({ n: window.__tc.journal.done.length, o: window.__tc.objects.all().length, ex: !!window.__tc.machineTool.machines.excavator }));
check('everything restored after reload', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
fs.writeFileSync(`${outDir}/stage2-results.json`, JSON.stringify({ results, errors }, null, 1));
if (process.env.EXPORT) fs.writeFileSync(process.env.EXPORT, await ev(async () => { const { toJSON } = await import('./src/core/storage.js'); return toJSON(window.__tc.buildProject()); }));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
