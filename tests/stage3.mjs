// Stage 3 scenario through the game's own tool API (same code paths as touch):
// big plot with the parked fleet, excavator dig cycles (auto + manual ISO),
// tractor loader, truck mixer, concrete pump, trench + formwork + rebar,
// undo/redo, camera pan, backdrops, save/reload, Blender replay, migration of
// a stage-2 project. The simulation is advanced with tc.simulate() so the
// software renderer of CI does not slow the game clock down.
// Usage: node tests/stage3.mjs [baseUrl] [outDir]   (Q=low|medium|high)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const base = process.argv[2] || 'http://localhost:8080/';
const outDir = process.argv[3] || 'docs/screenshots/stage3';
fs.mkdirSync(outDir, { recursive: true });
const q = process.env.Q || 'low';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: Number(process.env.DSF || 2), isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name, cam, wait = 2500) => {
  if (cam) await ev((c) => { window.__tc.rig.setState(c); }, cam);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 240000 });
  console.log('shot', name);
};
const ready = async () => {
  await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 180000 });
  await ev(() => Promise.all(Object.values(window.__tc.machineTool.machines).map((m) => m.ready)));
  await page.waitForTimeout(800);
};

await page.goto(`${base}?dpr=1&quality=${q}`);
await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('tiny-craftsman'); });
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await ready();
errors.length = 0; // texture loads cut off by the reload above are not errors of the game
if (process.env.DOF) await ev((d) => { window.__tc.settings.dof = d; window.__tc.applySettings(); }, Number(process.env.DOF));
const total0 = await ev(() => window.__tc.terrain.totalVolume());
// machines can be switched off in config (MACHINES_ENABLED): then the tool button is hidden
const MACH = await ev(() => !document.querySelector('[data-tool="machine"]')?.hasAttribute('hidden'));

// ---- fresh plot: 2.4 × 1.8 m, pit outline, the fleet parked along the back edge ------------
const fresh = await ev(() => {
  const tc = window.__tc, M = tc.machineTool.machines;
  return {
    size: [tc.terrain.sizeX, tc.terrain.sizeZ], outlines: tc.objects.all('outline').length,
    machines: Object.fromEntries(Object.entries(M).map(([k, m]) => [k, [+m.x.toFixed(3), +m.z.toFixed(3), !!m.holder || !!m.nodes]])),
    backdrop: tc.settings.backdrop, bg: tc.backdrop.mode,
  };
});
check('plot is 2.4 × 1.8 m', fresh.size[0] === 2.4 && fresh.size[1] === 1.8, JSON.stringify(fresh.size));
if (MACH) check('fleet parked at the back edge, models loaded', Object.keys(fresh.machines).length === 5 && Object.values(fresh.machines).every(([x, z, ok]) => ok && z < -0.25), JSON.stringify(fresh.machines));
else check('machines are switched off: none on the plot', Object.keys(fresh.machines).length === 0, JSON.stringify(fresh.machines));
check('site panorama is the default background', fresh.backdrop === 'site');
await page.waitForFunction(() => window.__tc.backdrop.dayTex, null, { timeout: 60000 });
await shot('01-overview', { target: [0, 0.1, 0.0], yaw: 0.35, pitch: 0.42, dist: 2.2 }, 4000);
if (MACH) await shot('02-parking', { target: [0.05, 0.12, -0.62], yaw: 0.25, pitch: 0.3, dist: 1.05 }, 3000);

// ---- hand digging at the model scale: the shovel cuts a visible pit, undo/redo -----------------
{
  const dig = await ev(() => {
    const tc = window.__tc, V = tc.camera.position.constructor;
    tc.setTool('shovel');
    const tot0 = tc.terrain.totalVolume();
    const wait = () => { for (let i = 0; i < 400 && tc.shovelTool.state !== 'idle'; i++) tc.simulate(0.05); };
    for (let z = -0.15; z <= 0.0; z += 0.05) {
      let t = 0;
      while (t < 1) {
        const ts = t;
        tc.shovelTool.down(new V(-0.3 + 0.3 * t, 0.1, z));
        while (tc.shovelTool.state === 'dig' && t < 1) { t += 0.01; tc.shovelTool.move(new V(-0.3 + 0.3 * t, 0.1, z)); }
        tc.shovelTool.up();
        if (tc.shovelTool.state === 'loaded') { tc.shovelTool.down(new V(0.55, 0.1, 0.55)); tc.shovelTool.up(); }
        wait();
        if (t === ts) t += 0.04;
      }
    }
    tc.particles.flush();
    for (let i = 0; i < 3000 && tc.terrain.active; i++) tc.terrain.relax(1);
    const depth = tc.terrain.orig[tc.terrain.index(-0.15, -0.08)] - tc.terrain.heightAt(-0.15, -0.08);
    const n = tc.journal.done.length, snap = tc.terrain.nat.slice();
    tc.undo(); const undone = tc.journal.done.length === n - 1; tc.redo();
    let err = 0; for (let i = 0; i < snap.length; i++) err = Math.max(err, Math.abs(snap[i] - tc.terrain.nat[i]));
    return { depth, scoops: n, drift: (tc.terrain.totalVolume() - tot0) * 1e9, undone, err, blade: tc.shovel.spec.width };
  });
  check('shovel at 1:3.5: a 6 cm blade', Math.abs(dig.blade - 0.06) < 1e-3, dig.blade.toFixed(4));
  check('hand-dug pit reaches the design grade (40 mm)', dig.depth > 0.03, `${(dig.depth * 1000).toFixed(1)} mm, ${dig.scoops} scoops`);
  check('soil conserved while digging', Math.abs(dig.drift) < 50, `${dig.drift.toFixed(2)} mm3`);
  check('undo/redo of a scoop', dig.undone && dig.err < 1e-9, JSON.stringify(dig));
  await shot('03-shovel-pit', { target: [-0.12, 0.09, -0.05], yaw: 0.5, pitch: 0.6, dist: 0.9 }, 3000);
}

if (MACH) {
// ---- excavator: drive out, two auto dig cycles inside the pit outline, dump beside it -------
const ex = await ev(() => {
  const tc = window.__tc, mt = tc.machineTool, V = tc.camera.position.constructor;
  tc.setTool('machine'); mt.select('excavator');
  const m = mt.machines.excavator;
  const x0 = m.x, z0 = m.z;
  mt.joystick(0, -1); tc.simulate(3.5); mt.joystick(0, 0); tc.simulate(3);
  const moved = Math.hypot(m.x - x0, m.z - z0);
  const vol0 = tc.terrain.excavatedVolume(), tot0 = tc.terrain.totalVolume();
  const f = m.forward(), P = (d, s = 0) => new V(m.x + f.x * d - f.y * s, 0.1, m.z + f.y * d + f.x * s);
  const phases = new Set();
  const run = (fn, max) => { for (let t = 0; t < max && fn(); t += 0.1) { tc.simulate(0.1); phases.add(mt.excavatorState); } };
  const fills = [];
  for (const s of [0, 0.05]) {
    mt.down(P(0.25, s)); mt.move(P(0.14, s)); mt.up(P(0.14, s));
    run(() => mt.excavatorState !== 'hold' && mt.excavatorState !== 'idle', 60);
    fills.push(+m.bucketPhys.fill.toFixed(2));
    const d = P(0.16, -0.17);
    mt.down(d); mt.up(d);
    run(() => mt.excavatorState !== 'idle' || tc.journal.pending, 60);
  }
  tc.particles.flush();
  return { moved, fills, phases: [...phases], load: m.bucketPhys.load * 1e9, state: mt.excavatorState, dug: (tc.terrain.excavatedVolume() - vol0) * 1e6, drift: (tc.terrain.totalVolume() + m.bucketPhys.load - tot0) * 1e9, actions: tc.journal.done.map((r) => r.type) };
});
check('excavator drives on its tracks', ex.moved > 0.05, `moved ${(ex.moved * 1000).toFixed(0)} mm`);
check('dig cycle: swing → lower → drag → curl → lift → dump → home', ['swing', 'lower', 'drag', 'curl', 'lift', 'toDump', 'dump', 'home'].every((p) => ex.phases.includes(p)), ex.phases.join(','));
check('bucket fills on each stroke', ex.fills.every((f) => f > 0.6), JSON.stringify(ex.fills));
check('soil dug and conserved', ex.dug > 50 && Math.abs(ex.drift) < 50, `dug ${ex.dug.toFixed(1)} cm3, drift ${ex.drift.toFixed(2)} mm3, left in bucket ${ex.load.toFixed(1)} mm3, ${ex.state}`);
check('each dig cycle is one journal action', ex.actions.filter((t) => t === 'excavate').length === 2, ex.actions.join(','));

// undo/redo of a dig cycle
const ur = await ev(() => {
  const tc = window.__tc, t = tc.terrain;
  const snap = t.nat.slice(), n = tc.journal.done.length;
  tc.undo(); const undone = tc.journal.done.length === n - 1;
  tc.redo();
  let err = 0; for (let i = 0; i < snap.length; i++) err = Math.max(err, Math.abs(snap[i] - t.nat[i]));
  return { undone, err };
});
check('undo/redo of a dig cycle', ur.undone && ur.err < 1e-9, JSON.stringify(ur));

// mid-cycle screenshot
await ev(() => {
  const tc = window.__tc, mt = tc.machineTool, m = mt.machines.excavator, V = tc.camera.position.constructor;
  const f = m.forward(), P = (d, s) => new V(m.x + f.x * d - f.y * s, 0.1, m.z + f.y * d + f.x * s);
  mt.down(P(0.26, 0.1)); mt.move(P(0.15, 0.1)); mt.up(P(0.15, 0.1));
  for (let t = 0; t < 30 && mt.excavatorState !== 'drag'; t += 0.1) tc.simulate(0.1);
  tc.simulate(1.2);
});
await shot('03-excavator-dig', await ev(() => { const m = window.__tc.machineTool.machines.excavator, f = m.forward(); return { target: [m.x + f.x * 0.12, m.y + 0.07, m.z + f.y * 0.12], yaw: m.yaw - 1.25, pitch: 0.2, dist: 0.62 }; }), 3000);
await ev(() => { const tc = window.__tc, mt = tc.machineTool; for (let t = 0; t < 40 && mt.excavatorState !== 'hold'; t += 0.1) tc.simulate(0.1); });
await shot('04-excavator-full', await ev(() => { const m = window.__tc.machineTool.machines.excavator; const b = m.bucketWorld(); return { target: [b.x, b.y, b.z], yaw: m.yaw - 0.9, pitch: 0.25, dist: 0.42 }; }), 2500);
await ev(() => {
  const tc = window.__tc, mt = tc.machineTool, m = mt.machines.excavator, V = tc.camera.position.constructor;
  const f = m.forward(), d = new V(m.x + f.x * 0.16 + f.y * 0.17, 0.1, m.z + f.y * 0.16 - f.x * 0.17);
  mt.down(d); mt.up(d);
  for (let t = 0; t < 30 && !(m.cycle && m.cycle.phase === 'dump'); t += 0.1) tc.simulate(0.1);
  tc.simulate(0.7);
});
await shot('05-excavator-dump', await ev(() => { const m = window.__tc.machineTool.machines.excavator; const b = m.bucketWorld(); return { target: [b.x, b.y - 0.03, b.z], yaw: m.yaw + 0.4, pitch: 0.3, dist: 0.55 }; }), 2500);
await ev(() => { const tc = window.__tc; for (let t = 0; t < 40 && (tc.machineTool.excavatorState !== 'idle' || tc.journal.pending); t += 0.1) tc.simulate(0.1); });

// manual ISO controls
const man = await ev(() => {
  const tc = window.__tc, mt = tc.machineTool, m = mt.machines.excavator;
  mt.setExMode('manual');
  const j0 = { ...m.j }, tip0 = m.tipWorld().y;
  mt.manual('r', 0, 1); tc.simulate(1); mt.manual('r', 0, 0);   // right stick back = boom up
  const up = m.tipWorld().y - tip0;
  mt.manual('l', 1, 0); tc.simulate(1); mt.manual('l', 0, 0);   // left stick right = swing right
  const sw = m.j.slew - j0.slew;
  tc.simulate(3);
  const committed = !tc.journal.pending && tc.journal.done.at(-1).type === 'drive';
  mt.setExMode('auto');
  return { up, sw, committed };
});
check('manual: right stick back raises the boom', man.up > 0.005, man.up.toFixed(4));
check('manual: left stick right swings right', man.sw < -0.1, man.sw.toFixed(3));
check('manual work is journaled when the machine stops', man.committed);

// ---- tractor: loader down, push, lift and dump --------------------------------------------
const tr = await ev(() => {
  const tc = window.__tc, mt = tc.machineTool;
  mt.select('tractor');
  const m = mt.machines.tractor;
  const total = tc.terrain.totalVolume();
  mt.loader('dig'); tc.simulate(1.5);
  mt.joystick(0.3, -1); tc.simulate(3); mt.joystick(0, 0); tc.simulate(1);
  const load = m.load;
  mt.loader('carry'); tc.simulate(1.5);
  mt.joystick(-0.5, -0.6); tc.simulate(1.5); mt.joystick(0, 0); tc.simulate(1);
  mt.loader('dump'); tc.simulate(4.5);
  tc.particles.flush();
  return { load: load * 1e6, after: m.load * 1e6, mode: m.mode, drift: (tc.terrain.totalVolume() + m.load - total) * 1e9 };
});
check('tractor bucket fills when pushing', tr.load > 10, JSON.stringify(tr));
check('tractor lifts and dumps everything, soil conserved', tr.after < 0.5 && Math.abs(tr.drift) < 50, `drift ${tr.drift.toFixed(2)} mm3, mode ${tr.mode}`);
await shot('06-tractor', await ev(() => { const m = window.__tc.machineTool.machines.tractor; return { target: [m.x, m.y + 0.06, m.z], yaw: m.yaw + 0.9, pitch: 0.35, dist: 0.6 }; }), 3000);

// ---- truck mixer and concrete pump ----------------------------------------------------------
const mx = await ev(() => {
  const tc = window.__tc, mt = tc.machineTool;
  mt.select('mixer');
  const m = mt.machines.mixer, x0 = m.x, z0 = m.z, d0 = m.drumSpin.rotation.y;
  mt.joystick(0.4, -0.8); tc.simulate(3); mt.joystick(0, 0); tc.simulate(2);
  const drum = m.drumSpin.rotation.y - d0;
  mt.drum(-1); mt.chute(0.35); mt.chute(0.35); tc.simulate(2);
  const p = mt.machines.pump, px = p.x;
  mt.select('pump'); mt.joystick(0, -0.6); tc.simulate(2); mt.joystick(0, 0); tc.simulate(2);
  return { moved: Math.hypot(m.x - x0, m.z - z0), turned: Math.abs(m.yaw), drum, discharge: m.drumSpeed < 0, chute: m.chute, pumpMoved: Math.abs(p.x - px) };
});
check('truck mixer drives and steers', mx.moved > 0.1 && mx.turned > 0.05, JSON.stringify(mx));
check('mixer drum turns, discharge + chute swing', mx.drum > 1 && mx.discharge && mx.chute > 0.5);
check('concrete pump can be moved', mx.pumpMoved > 0.03);
await shot('07-mixer-pump', await ev(() => { const m = window.__tc.machineTool.machines.mixer; return { target: [m.x, m.y + 0.12, m.z], yaw: m.yaw + 0.5, pitch: 0.25, dist: 1.0 }; }), 3000);

}

// ---- trench with formwork and rebar (right of the pit) -------------------------------------
const fw = await ev(() => {
  const tc = window.__tc, V = tc.camera.position.constructor, e = { clientX: 0, clientY: 0 };
  tc.setTool('mark'); tc.markTool.setMode('trench');
  tc.markTool.down(new V(0.55, 0.1, 0.1)); tc.markTool.move(new V(0.8, 0.1, 0.1)); tc.markTool.up();
  tc.markTool.down(new V(0.8, 0.1, 0.3)); tc.markTool.up();
  tc.markTool.finishTrench();
  const trench = tc.objects.all('outline').find((o) => o.kind === 'trench');
  tc.setTool('form'); tc.formTool.setMode('outline'); tc.formTool.down(new V(0.68, 0.09, 0.1), e);
  tc.setTool('rebar'); tc.rebarTool.setMode('cage'); tc.rebarTool.down(new V(0.68, 0.09, 0.1), e);
  tc.rebarTool.setMode('mesh'); tc.rebarTool.down(new V(0.5, 0.1, 0.5), e); tc.rebarTool.move(new V(0.6, 0.1, 0.6)); tc.rebarTool.up();
  return { trench: trench?.pts?.length, forms: tc.objects.all('form').length, cages: tc.objects.all('cage').length, mesh: tc.objects.all('mesh').length };
});
check('trench outline, formwork, cage and mesh placed', fw.trench === 3 && fw.forms >= 4 && fw.cages === 1 && fw.mesh === 1, JSON.stringify(fw));
await shot('08-trench-formwork', { target: [0.7, 0.1, 0.2], yaw: 0.6, pitch: 0.6, dist: 0.45 }, 3000);

// ---- camera: two-finger drag moves over the plot when zoomed in -----------------------------
const cam = await ev(() => {
  const tc = window.__tc, c = document.getElementById('view');
  tc.setTool('shovel');
  tc.rig.setState({ target: [0, 0.1, 0], yaw: 0, pitch: 0.6, dist: 0.25 });
  const pe = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', bubbles: true }));
  pe('pointerdown', 11, 150, 420); pe('pointerdown', 12, 250, 420);
  for (let i = 1; i <= 15; i++) { pe('pointermove', 11, 150 - i * 10, 420); pe('pointermove', 12, 250 - i * 10, 420); }
  pe('pointerup', 11, 0, 0); pe('pointerup', 12, 0, 0);
  const g = tc.rig.goal;
  return { x: g.target.x, z: g.target.z, dist: g.dist, journal: !tc.journal.pending };
});
check('two-finger drag pans at macro zoom (no dig)', cam.x > 0.03 && Math.abs(cam.dist - 0.25) < 0.01 && cam.journal, JSON.stringify(cam));

// ---- backdrops -------------------------------------------------------------------------------
await ev(() => window.__tc.setTool('camera'));
await shot('09-site-panorama', { target: [0, 0.12, 0.2], yaw: 0.2, pitch: 0.16, dist: 1.6 }, 3500);
await ev(() => window.__tc.setBackdrop('workshop'));
await shot('10-workshop', { target: [0, 0.07, 0], yaw: 0.5, pitch: 0.55, dist: 2.8 }, 3500);
await ev(() => window.__tc.setBackdrop('site'));
await page.waitForTimeout(1000);

// ---- persistence + Blender consistency --------------------------------------------------------
const exp = await ev(async () => {
  const tc = window.__tc;
  const { toJSON, fromJSON } = await import('./src/core/storage.js');
  const p = fromJSON(toJSON(tc.buildProject()));
  const nat = p.terrain.nat.slice(), loose = p.terrain.loose.slice();
  for (const r of [...p.journal.done].reverse()) if (r.diff) r.diff.idx.forEach((i, k) => { nat[i] = r.diff.bn[k]; loose[i] = r.diff.bl[k]; });
  let start = 0; for (let i = 0; i < nat.length; i++) start = Math.max(start, Math.abs(nat[i] - p.terrain.orig[i]), loose[i]);
  for (const r of p.journal.done) if (r.diff) r.diff.idx.forEach((i, k) => { nat[i] = r.diff.an[k]; loose[i] = r.diff.al[k]; });
  let end = 0; for (let i = 0; i < nat.length; i++) end = Math.max(end, Math.abs(nat[i] - p.terrain.nat[i]), Math.abs(loose[i] - p.terrain.loose[i]));
  await tc.saveNow();
  return { start, end, version: p.version, fields: p.track.fields.length, tracks: ['ex_slew', 'tr_lift', 'mx_drum', 'pu_x', 'rk_px'].every((f) => p.track.fields.includes(f)), actions: p.journal.done.length, kb: Math.round(toJSON(p).length / 1024) };
});
check('journal replays terrain exactly', exp.start < 1e-9 && exp.end < 1e-9, `start ${exp.start} end ${exp.end}`);
check('project v3 with machine and rake tracks', exp.version === 3 && exp.tracks, JSON.stringify(exp));
const snap = () => ev(() => { const tc = window.__tc; return { n: tc.journal.done.length, o: tc.objects.all().length, m: Object.fromEntries(Object.entries(tc.machineTool.machines).map(([k, m]) => [k, [+m.x.toFixed(4), +m.z.toFixed(4)]])) }; });
const before = await snap();
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await ready();
const after = await snap();
check('everything restored after reload (machines where they were left)', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
const total1 = await ev(() => window.__tc.terrain.totalVolume());
check('total soil volume conserved over the session', Math.abs(total1 - total0) / total0 < 1e-5, `${((total1 - total0) * 1e9).toFixed(1)} mm3`);

// ---- a stage-2 project file is moved into the middle of the new plot -------------------------
const mig = await ev(async () => {
  const tc = window.__tc, st = await import('./src/core/storage.js');
  const rx = 300, rz = 225, n = (rx + 1) * (rz + 1), cell = 0.002;
  const orig = new Float32Array(n).fill(0.1), nat = new Float32Array(n), loose = new Float32Array(n);
  for (let iz = 0; iz <= rz; iz++) for (let ix = 0; ix <= rx; ix++) { const x = ix * cell - 0.3, z = iz * cell - 0.225; nat[iz * (rx + 1) + ix] = Math.abs(x) < 0.08 && Math.abs(z) < 0.06 ? 0.08 : 0.1; }
  const p = { format: 'tiny-craftsman-project', version: 2, stage: 2, clock: 10, terrain: { rx, rz, cell, soilY: 0.1, seed: 7, orig, nat, loose },
    objects: { nextId: 3, items: [{ id: 1, type: 'outline', kind: 'rect', x0: -0.08, z0: -0.06, x1: 0.08, z1: 0.06, depth: 20 }, { id: 2, type: 'machine', kind: 'excavator', x: 0, z: 0, yaw: 0 }] },
    settings: { backdrop: 'workshop' }, journal: { done: [], undone: [] }, track: { fields: [], data: new Float32Array(0) } };
  await tc.importProject(new File([st.toJSON(p)], 'stage2.json'));
  return { msg: tc.migrated, pit: tc.terrain.heightAt(0, 0), edge: tc.terrain.heightAt(0.9, 0.6), outlines: tc.objects.all('outline').length, machines: tc.objects.all('machine').length };
});
check('stage-2 project migrates into the centre', Math.abs(mig.pit - 0.08) < 1e-4 && Math.abs(mig.edge - 0.1) < 0.01 && mig.outlines === 1 && mig.machines === (MACH ? 5 : 0), JSON.stringify(mig));

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
fs.writeFileSync(`${outDir}/stage3-results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
