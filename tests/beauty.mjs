// Report screenshots at "high" quality: digs a pit through the game API
// (same code path as touch input) and shoots a few macro angles.
// Usage: node tests/beauty.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const base = process.argv[2] || 'http://localhost:8080/';
const outDir = process.argv[3] || 'docs/screenshots/stage1';
fs.mkdirSync(outDir, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?dpr=1&quality=low`);
await page.evaluate(() => indexedDB.deleteDatabase('tiny-craftsman'));
await page.reload();
await page.waitForFunction(() => window.__tc?.ready, null, { timeout: 120000 });

// dig the pit row by row, spoil heaps behind and to the right of the outline
await page.evaluate(async () => {
  const tc = window.__tc, V = tc.camera.position.constructor;
  const wait = () => new Promise((res) => { const f = () => (tc.shovelTool.state === 'idle' ? res() : setTimeout(f, 50)); f(); });
  const dumps = [[0.1, -0.1], [0.115, -0.08], [0.085, -0.115], [0.12, -0.05], [0.115, 0.02], [0.12, 0.06]];
  let k = 0;
  tc.settings.bite = 5; tc.settings.stopAtGrade = true;
  // swipes along the outline, row after row; the blade stops at the design grade
  for (let pass = 0; pass < 3; pass++) {
    for (let z = -0.052; z <= 0.053; z += 0.013) {
      let x = -0.068;
      while (x < 0.068) {
        const xStart = x;
        tc.shovelTool.down(new V(x, 0.056, z));
        while (tc.shovelTool.state === 'dig' && x < 0.068) { x += 0.0015; tc.shovelTool.move(new V(x, 0.056, z)); }
        tc.shovelTool.up();
        if (tc.shovelTool.state === 'loaded') {
          const d = dumps[k++ % dumps.length];
          tc.shovelTool.down(new V(d[0] + (Math.random() - 0.5) * 0.012, 0.056, d[1] + (Math.random() - 0.5) * 0.012));
          tc.shovelTool.up();
          tc.shovelTool.finish();
        }
        await wait();
        if (x === xStart) x += 0.006;
      }
    }
  }
});

const shoot = async (name, cam, setup) => {
  await page.evaluate(([cam, setup]) => {
    const tc = window.__tc;
    tc.settings.quality = 'high'; tc.dprOverride = 1.5; tc.settings.level = !!setup?.level; tc.settings.shake = false;
    tc.applySettings();
    tc.rig.setState(cam);
    tc.focusPoint = null;
    if (setup?.tool) tc.setTool(setup.tool);
  }, [cam, setup]);
  if (setup?.loaded) {
    await page.evaluate(() => {
      const tc = window.__tc, V = tc.camera.position.constructor;
      tc.setTool('shovel');
      tc.shovelTool.down(new V(-0.03, 0.056, 0.07));
      for (let x = -0.03; x < 0.0 && tc.shovelTool.state === 'dig'; x += 0.001) tc.shovelTool.move(new V(x, 0.056, 0.07));
      tc.shovelTool.up();
    });
  }
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  console.log('shot', name);
};

await shoot('10-hero', { target: [0.0, 0.04, 0.0], yaw: 0.55, pitch: 0.5, dist: 0.5 });
await shoot('11-pit-macro', { target: [-0.02, 0.045, 0.0], yaw: 0.35, pitch: 0.42, dist: 0.2 });
await shoot('12-spoil-heap', { target: [0.105, 0.06, -0.06], yaw: 0.9, pitch: 0.42, dist: 0.2 });
await shoot('13-level', { target: [0.0, 0.04, 0.0], yaw: 0.0, pitch: 1.1, dist: 0.36 }, { level: true });
await shoot('14-loaded-shovel', { target: [-0.02, 0.06, 0.07], yaw: 0.5, pitch: 0.5, dist: 0.26 }, { loaded: true });
console.log(JSON.stringify(await page.evaluate(() => ({ exc: window.__tc.terrain.excavatedVolume() * 1e6, actions: window.__tc.journal.done.length, depth: window.__tc.terrain.pitStats(window.__tc.marking.rect).meanDepth * 1000 }))));
await browser.close();
