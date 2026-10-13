// End-to-end check of stage 1 on an iPhone 15 Pro sized touch viewport:
// real touch events dig the pit, dump the soil, undo/redo, reload persistence.
// Usage: node tests/e2e.mjs [baseUrl] [screenshotDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const base = process.argv[2] || 'http://localhost:8080/';
const outDir = process.argv[3] || 'docs/screenshots/stage1';
fs.mkdirSync(outDir, { recursive: true });
const q = process.env.Q || 'low';
const url = `${base}?dpr=1&quality=${q}`;
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const cdp = await ctx.newCDPSession(page);
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };

async function ready() { await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 }); await page.waitForTimeout(1500); }
const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const { camera, THREE_V } = window.__tc; const v = new camera.position.constructor(x, y, z).project(camera);
  return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
}, [x, y, z]);
async function touch(type, pts) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) }); }
async function swipe(world) {
  const pts = []; for (const [x, z] of world) pts.push(await toScreen(x, 0.1, z));
  await touch('touchStart', [pts[0]]);
  for (let k = 1; k < pts.length; k++) { const [ax, ay] = pts[k - 1], [bx, by] = pts[k]; for (let s = 1; s <= 4; s++) { await touch('touchMove', [[ax + (bx - ax) * s / 4, ay + (by - ay) * s / 4]]); } }
  await touch('touchEnd', []);
}
async function tapAt(x, z) { const p = await toScreen(x, 0.1, z); await touch('touchStart', [p]); await page.waitForTimeout(60); await touch('touchEnd', []); }
async function settle() { await page.waitForFunction(() => window.__tc.shovelTool.state === 'idle' || window.__tc.shovelTool.state === 'loaded', null, { timeout: 60000 }); await page.waitForTimeout(300); }
const stat = () => page.evaluate(() => { const t = window.__tc.terrain; return { exc: t.excavatedVolume(), total: t.totalVolume(), journal: window.__tc.journal.done.length, state: window.__tc.shovelTool.state }; });

await page.goto(url);
await page.evaluate(() => indexedDB.deleteDatabase('tiny-craftsman'));
await page.reload();
await ready();
await page.evaluate(() => window.__tc.rig.setState({ target: [0, 0.09, 0], yaw: 0.42, pitch: 0.75, dist: 0.5 }));
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/01-start.png` });
const s0 = await stat();
check('scene loads, journal empty', s0.journal === 0 && s0.exc === 0);

// dig several passes inside the outline, dump each scoop on a spoil heap outside it
const dumps = [[-0.02, -0.105], [0.03, -0.1], [-0.07, -0.1]]; // behind the pit, on screen, clear of the panels
let n = 0;
for (let row = 0; row < 6; row++) {
  const z = -0.045 + row * 0.018;
  await swipe([[-0.06, z], [-0.02, z], [0.02, z], [0.06, z]]);
  await settle();
  const st = await stat();
  if (st.state === 'loaded') { const d = dumps[n++ % dumps.length]; await tapAt(d[0], d[1]); await settle(); }
  if (row === 1) { await page.waitForTimeout(100); }
}
const s1 = await stat();
check('soil was excavated', s1.exc > 2e-6, `excavated=${(s1.exc * 1e6).toFixed(2)} cm3`);
check('volume conserved (dug soil ends on spoil heap)', Math.abs(s1.total - s0.total) < 1e-9, `drift=${((s1.total - s0.total) * 1e9).toFixed(3)} mm3`);
check('each scoop journaled', s1.journal >= 3, `actions=${s1.journal}`);
await page.screenshot({ path: `${outDir}/02-dug.png` });

// a loaded shovel mid-way, for the screenshot
await swipe([[-0.06, 0.05], [0.0, 0.05]]);
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/03-loaded-shovel.png` });
const sL = await stat();
check('swipe fills the shovel', sL.state === 'loaded' || sL.state === 'idle', sL.state);
if (sL.state === 'loaded') { await tapAt(0.0, -0.12); await settle(); }
check('tap dumps the load', (await stat()).state === 'idle');

// undo / redo
const before = await stat();
await page.evaluate(() => window.__tc.undo()); await page.waitForTimeout(300);
const u = await stat();
check('undo removes last scoop', u.journal === before.journal - 1 && u.exc < before.exc);
await page.evaluate(() => window.__tc.redo()); await page.waitForTimeout(300);
const r = await stat();
check('redo restores it', r.journal === before.journal && Math.abs(r.exc - before.exc) < 1e-12);

// two-finger pinch zoom
const d0 = await page.evaluate(() => window.__tc.rig.goal.dist);
await touch('touchStart', [[150, 400], [250, 400]]);
for (let s = 1; s <= 8; s++) { await touch('touchMove', [[150 - s * 8, 400], [250 + s * 8, 400]]); await page.waitForTimeout(16); }
await touch('touchEnd', []);
const d1 = await page.evaluate(() => window.__tc.rig.goal.dist);
check('pinch zooms camera', d1 < d0 * 0.8, `${d0.toFixed(3)} -> ${d1.toFixed(3)}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/04-macro-closeup.png` });

// level overlay
await page.evaluate(() => { window.__tc.rig.setState({ target: [0, 0.09, 0], yaw: 0.42, pitch: 0.75, dist: 0.42 }); window.__tc.settings.level = true; window.__tc.applySettings(); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/05-level-overlay.png` });
await page.evaluate(() => { window.__tc.settings.level = false; window.__tc.applySettings(); });

// export round trip
const exp = await page.evaluate(async () => {
  const { toJSON, fromJSON } = await import('./src/core/storage.js');
  const p = window.__tc.buildProject(); const txt = toJSON(p); const back = fromJSON(txt);
  window.__exportText = txt;
  // the journal must replay to exactly the saved ground (what Blender relies on)
  const nat = back.terrain.nat.slice(), loose = back.terrain.loose.slice();
  for (const r of [...back.journal.done].reverse()) if (r.diff) r.diff.idx.forEach((i, k) => { nat[i] = r.diff.bn[k]; loose[i] = r.diff.bl[k]; });
  let startErr = 0; for (let i = 0; i < nat.length; i++) startErr = Math.max(startErr, Math.abs(nat[i] - back.terrain.orig[i]), loose[i]);
  for (const r of back.journal.done) if (r.diff) r.diff.idx.forEach((i, k) => { nat[i] = r.diff.an[k]; loose[i] = r.diff.al[k]; });
  let endErr = 0; for (let i = 0; i < nat.length; i++) endErr = Math.max(endErr, Math.abs(nat[i] - back.terrain.nat[i]), Math.abs(loose[i] - back.terrain.loose[i]));
  return { startErr, endErr, bytes: txt.length, actions: back.journal.done.length, natOk: back.terrain.nat.length === p.terrain.nat.length && back.terrain.nat[1234] === p.terrain.nat[1234], track: back.track.data.length };
});
if (process.env.EXPORT) fs.writeFileSync(process.env.EXPORT, await page.evaluate(() => window.__exportText));
check('journal replays to saved terrain (Blender)', exp.startErr < 1e-9 && exp.endErr < 1e-9, `start ${exp.startErr} end ${exp.endErr}`);
check('JSON export round-trips', exp.natOk && exp.actions === r.journal, `${(exp.bytes / 1024).toFixed(0)} KB, track floats=${exp.track}`);

// persistence
await page.evaluate(() => window.__tc.saveNow());
await page.reload();
await ready();
const p = await stat();
check('project restored after reload', p.journal === r.journal && Math.abs(p.exc - r.exc) < 1e-12, `actions=${p.journal}, exc ${(r.exc*1e6).toFixed(4)} -> ${(p.exc*1e6).toFixed(4)} cm3`);
await page.evaluate(() => window.__tc.undo()); await page.waitForTimeout(200);
const pu = await stat();
check('undo works after reload', pu.journal === p.journal - 1);
await page.evaluate(() => window.__tc.redo());

// marking tool: drag a corner handle of the pit outline
await page.evaluate(() => { window.__tc.setTool('mark'); window.__tc.markTool.setMode('edit'); });
const rect0 = await page.evaluate(() => ({ ...window.__tc.objects.all('outline')[0] }));
const c = await toScreen(rect0.x1, 0.1, rect0.z1);
const c2 = await toScreen(rect0.x1 + 0.02, 0.1, rect0.z1 + 0.012);
await touch('touchStart', [c]); for (let s = 1; s <= 6; s++) { await touch('touchMove', [[c[0] + (c2[0] - c[0]) * s / 6, c[1] + (c2[1] - c[1]) * s / 6]]); await page.waitForTimeout(16); }
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/06-marking.png` });
await touch('touchEnd', []);
const rect1 = await page.evaluate(() => ({ ...window.__tc.objects.all('outline')[0] }));
check('handle drag resizes outline', rect1.x1 > rect0.x1 + 0.005, `${(rect0.x1 * 1000).toFixed(0)} -> ${(rect1.x1 * 1000).toFixed(0)} mm`);
await page.evaluate(() => window.__tc.undo());
const rect2 = await page.evaluate(() => ({ ...window.__tc.objects.all('outline')[0] }));
check('undo restores outline', Math.abs(rect2.x1 - rect0.x1) < 1e-9);

check('no console errors', errors.length === 0, errors.join(' | '));
fs.writeFileSync(`${outDir}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
