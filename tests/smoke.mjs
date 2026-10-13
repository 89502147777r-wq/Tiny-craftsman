// Quick load check: opens the game in Chromium (iPhone 15 Pro viewport),
// waits for the scene and saves a screenshot. Usage: node tests/smoke.mjs [url] [out.png]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const url = process.argv[2] || 'http://localhost:8080/?dpr=1';
const out = process.argv[3] || 'smoke.png';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__tc && window.__tc.ready, null, { timeout: 120000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: out });
console.log(JSON.stringify({ fps: await page.evaluate(() => window.__tc.fps), errors }, null, 1));
await browser.close();
