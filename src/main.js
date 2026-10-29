import { Mirrors } from './render/mirrors.js';
import * as THREE from 'three';
import { BUILD, STAGE, TRAY, MODEL_SCALE, DEFAULT_SETTINGS, DEFAULT_OUTLINES, MACHINES_ENABLED, K, KT, M_SOIL, M_SAND, M_G5, M_G20, CONCRETE, PUMP, DELIVERY } from './config.js';
import { loadAssets } from './world/assets.js';
import { buildWorkshop } from './world/workshop.js';
import { Terrain } from './world/terrain.js';
import { SOIL } from './world/soilColor.js';
import { makeTerrainMaterial, makeLightTerrainMaterial, makeFallbackTerrainMaterial } from './world/terrainMaterial.js';
import { Grass } from './world/grass.js';
import { SoilParticles } from './world/particles.js';
import { OutlineView, contains, gradeY } from './world/outlines.js';
import { FormworkView } from './world/formwork.js';
import { RebarView } from './world/rebar.js';
import { WallView } from './world/walls.js';
import { buildStacks } from './world/stacks.js';
import { Sky } from './world/sky.js';
import { Backdrop, PANOS, isPano } from './world/backdrop.js';
import { slabCage, isSlab, slabClip } from './tools/slab.js';
import { Shovel } from './world/shovel.js';
import { Rake } from './world/rake.js';
import { makeDust } from './world/dust.js';
import { Pipeline } from './render/pipeline.js';
import { CameraRig } from './input/cameraRig.js';
import { Gestures } from './input/gestures.js';
import { Journal } from './core/journal.js';
import { ObjectStore } from './core/objects.js';
import { Recorder, TRACK_FIELDS } from './core/recorder.js';
import { loadLocal, clearLocal, saveParts, loadParts, toJSON, fromJSON, download } from './core/storage.js';
import { ScoopTool } from './tools/scoopTool.js';
import { RakeTool } from './tools/rakeTool.js';
import { MaterialTool } from './tools/materialTool.js';
import { HoseTool, PailTool, ScreedTool, VibratorTool, TrowelTool, BitumenTool, PlateTool, BreakerTool } from './tools/concreteTools.js';
import { ConcreteGear } from './world/concreteGear.js';
import { MarkTool } from './tools/markTool.js';
import { BuildTool } from './tools/buildTool.js';
import { WallTool } from './tools/wallTool.js';
import { MachineTool } from './tools/machineTool.js';
import { Sfx } from './audio/sfx.js';
import { UI } from './ui/ui.js';
import { ProjectView } from './world/projectView.js';
import { PoolView } from './world/poolView.js';
import { GardenView } from './world/gardenView.js';
import { buildBitumen } from './world/bitumen.js';
import { Budget } from './core/budget.js';
import { HandTools } from './world/handTools.js';
import { initLang } from './i18n/i18n.js';

const app = (window.__tc = { ready: false, BUILD });

async function main() {
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.renderer = renderer;
  // shader problems on a device are shown on screen (so they can be reported) instead of
  // silently leaving an object undrawn; the soil then falls back to a plain material
  app.shaderErrors = [];
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join(' | ').trim();
    console.error('shader error', log);
    app.shaderErrors.push(log || 'link failed');
  };

  const stored = readSettings();
  // BUILD 3: the construction-site panorama becomes the default background once
  if ((stored.build || 0) < 3) { delete stored.backdrop; delete stored.orbit; }
  // BUILD 8: model scale 1:3.5 — the dig / trench presets of 1:12 no longer fit
  if ((stored.build || 0) < 8) { delete stored.bite; delete stored.target; delete stored.trenchWidth; delete stored.trenchDepth; }
  if ((stored.build || 0) < 9) delete stored.target; // BUILD 9: pits are 6 shovel passes deep
  if (stored.backdrop === 'photo1' || stored.backdrop === 'photo2') stored.backdrop = 'posters'; // two prints on the table since BUILD 5
  app.settings = { ...DEFAULT_SETTINGS, ...stored, build: BUILD };
  initLang(app.settings);
  // the pump gives more: × 2 in BUILD 42, × 2.5 in BUILD 43, × 2.5 in BUILD 44 (a stored choice follows)
  if (stored?.pump !== undefined && !stored.pumpX12) app.settings.pump *= stored.pumpX5 ? 2.5 : stored.pumpX2 ? 6.25 : 12.5;
  app.settings.pumpX2 = app.settings.pumpX5 = app.settings.pumpX12 = true;
  if (typeof app.settings.pump === 'number') app.settings.pump = PUMP.reduce((a, v) => (Math.abs(v - app.settings.pump) < Math.abs(a - app.settings.pump) ? v : a));   // the nearest step
  if (!PUMP.includes(app.settings.pump)) app.settings.pump = DEFAULT_SETTINGS.pump;   // BUILD 23: real pump rates
  if (!DELIVERY.includes(app.settings.delivery)) app.settings.delivery = DEFAULT_SETTINGS.delivery;   // BUILD 36: truck-sized deliveries
  if (app.settings.wallKind && !['block', 'brick', 'cinder', 'blind', 'lform', 'studs', 'lintel', 'prop', 'ublock', 'ucage', 'belt', 'slab', 'window', 'door', 'roof', 'facade', 'proof', 'rwin', 'pool', 'land', 'ext', 'column'].includes(app.settings.wallKind)) app.settings.wallKind = 'brick';   // BUILD 45: free brickwork (no thickness modes)
  // URL overrides (handy for testing / recording): ?quality=low&dpr=1
  const params = new URLSearchParams(location.search);
  if (params.get('quality')) app.settings.quality = params.get('quality');
  // the film mode (film/director.js): a short played out on a clean plot of its own — nothing is
  // read from the saved project or written over it; ?offline=1: drawn frame by frame by a script
  app.filmMode = params.get('film') || null;
  app.filmOffline = !!app.filmMode && params.get('offline') === '1';
  // (and the dice seeded: a film drawn frame by frame is the same every run — it can be drawn in
  // parts, by several workers, and taken up again where it stopped)
  if (app.filmOffline) { let x = 0x2f6b9a31; Math.random = () => { x |= 0; x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  app.dprOverride = params.get('dpr') ? Number(params.get('dpr')) : 0;
  const scene = (app.scene = new THREE.Scene());
  const camera = (app.camera = new THREE.PerspectiveCamera(45, 1, 0.008, 40));

  const tex = await loadAssets(renderer, (f) => { document.getElementById('loadbar').style.width = `${Math.round(f * 100)}%`; }, app.settings.quality);
  app.tex = tex;
  app.workshop = buildWorkshop(scene, renderer, tex);
  app.stacks = buildStacks(tex);
  scene.add(app.stacks);

  const terrain = (app.terrain = new Terrain());
  // ?soil=light forces the light soil shader (testing the fallback)
  app.terrainMat = new URLSearchParams(location.search).get('soil') === 'light' ? (app.lightMat = makeLightTerrainMaterial(tex)) : makeTerrainMaterial(tex);
  scene.add(terrain.buildMesh(app.terrainMat));
  app.grass = new Grass(terrain); scene.add(app.grass.mesh);
  app.particles = new SoilParticles(tex, terrain); scene.add(app.particles.mesh, app.particles.clods);
  app.shovel = new Shovel(tex, app); scene.add(app.shovel.root);
  app.shovel.setType(app.settings.shovel);
  app.rake = new Rake(tex); scene.add(app.rake.root);
  app.concreteGear = new ConcreteGear(); scene.add(app.concreteGear.root);
  app.handTools = new HandTools(); scene.add(app.handTools.root); app.handTools.loadModels();
  app.dust = makeDust(); scene.add(app.dust.points);

  app.objects = new ObjectStore();
  app.outlineView = new OutlineView(terrain, app.objects); scene.add(app.outlineView.group);
  app.projectView = new ProjectView(); scene.add(app.projectView.group);
  app.formView = new FormworkView(tex, app.objects, terrain); scene.add(app.formView.group);
  app.rebarView = new RebarView(app.objects); scene.add(app.rebarView.group);
  app.wallView = new WallView(app.objects, tex); scene.add(app.wallView.group); app.wallView.app = app;
  app.wallView.terrain = terrain;   // (what the props of a slab stand on)
  app.poolView = new PoolView(app.objects); app.wallView.group.add(app.poolView.group);   // (picked as the walls are)
  app.gardenView = new GardenView(app.objects); app.wallView.group.add(app.gardenView.group);
  // the bitumen coats (bitumen.js): the textures the walls look them up in, built anew when they change
  { let dirty = true; app.objects.on((id, rec) => { if (rec?.type === 'bitumen' || id === app._bitId) dirty = true; });
    app.bitumenSync = () => { if (!dirty) return; dirty = false; const r = app.objects.all('bitumen')[0] || null; app._bitId = r?.id ?? null; buildBitumen(r, terrain.halfX, terrain.halfZ); }; }
  app.wallView.terrainY = (x, z) => terrain.heightAt(x, z);
  const u = app.terrainMat.userData.uniforms;
  u.tMask.value = app.outlineView.mask;
  u.uPlot.value.set(-terrain.halfX, -terrain.halfZ, terrain.sizeX, terrain.sizeZ);

  app.pipeline = new Pipeline(renderer);
  app.mirrors = new Mirrors(renderer);
  app.rig = new CameraRig(camera);
  app.journal = new Journal(terrain, app.objects);
  // a physics action still running (stripping) finishes before the next one starts
  app.journal.onBeforeBegin = () => { const j = app.physJob; if (j && !j.finishing) { j.finishing = true; j.finish(); } };
  app.recorder = new Recorder();
  app.sfx = new Sfx();
  app.shovelTool = new ScoopTool(app, app.shovel);
  app.rakeTool = new RakeTool(app, app.rake);
  app.concreteTools = { hose: new HoseTool(app), pail: new PailTool(app), screed: new ScreedTool(app), vibro: new VibratorTool(app), trowel: new TrowelTool(app), bitumen: new BitumenTool(app), plate: new PlateTool(app), breaker: new BreakerTool(app) };
  app.materialTools = { sand: new MaterialTool(app, M_SAND), g5: new MaterialTool(app, M_G5), g20: new MaterialTool(app, M_G20), soil: new MaterialTool(app, M_SOIL) };
  app.markTool = new MarkTool(app);
  app.formTool = new BuildTool(app, 'form');
  app.rebarTool = new BuildTool(app, 'rebar');
  app.wallTool = new WallTool(app);
  app.machineTool = new MachineTool(app);
  app.backdrop = new Backdrop(app);
  app.sky = new Sky(app);   // the time of day and the weather (sky.js)
  app.budget = new Budget(app);
  app.journal.onBeforeCommit = (p) => { app.machineTool.sync(); app.budget.price(p); };   // (what an action used is paid in its own entry)
  app.clock = 0;
  app.tool = 'shovel';

  // ---- restore the saved project, or start a fresh plot -------------------------------------
  // (saved by parts since BUILD 187; before, one record)
  let saved = null, byParts = false;
  if (!app.filmMode) try { saved = assembleParts(await loadParts()); byParts = !!saved; } catch (e) { console.warn('could not read the saved parts', e); }
  if (!saved && !app.filmMode) { saved = await loadLocal(); SAVE.legacy = !!saved; }
  if (app.filmMode) saved = null;
  let restored = false;
  if (saved) {
    try { applyProject(saved); restored = true; } catch (e) { console.warn('could not restore project', e); }
  }
  // (what was just read is what is stored: nothing to write until something changes)
  if (restored && byParts && !app.migrated) { app.terrain.sDirty.fill(0); for (const r of [...app.journal.done, ...app.journal.undone]) SAVE.j.add(r.id); SAVE.trackT = performance.now(); }
  if (!restored) freshPlot();
  if (app.filmMode) { app.objects.load({ nextId: 1, items: [] }); app.settings.quiet = false; app.settings.orbit = false; app.settings.hints = false; }

  app.ui = new UI(app);
  app.gestures = new Gestures(app, canvas);
  app.journal.onChange = () => { app.ui.refresh(); app.budget.refresh(); scheduleSave(); };
  app.budget.mount();
  app.onShovelState = () => app.ui.refresh();
  applySettings();
  setTool(app.tool);
  if (app.migrated) app.ui.toast(app.migrated);

  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(true); });
  window.addEventListener('pagehide', () => saveNow(true));

  app.rig.update(1);
  renderer.compile(scene, camera);
  checkTerrainShader();

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0;
  app.fps = 0;
  // Drawn only as often as the picture changes (the phone stays cool): every frame while a
  // finger is on the screen or was a moment ago, 30 a second while a tool, a machine, the
  // soil or the camera is still moving by itself, else 2 a second (the clock, curing)
  let lastDraw = 0;
  app.lastInput = performance.now();
  app.poke = () => { app.lastInput = performance.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown']) window.addEventListener(ev, app.poke, { passive: true, capture: true });
  const moving = (rain = true) => {
    const r = app.rig, g = r.goal;
    return app.settings.orbit || !!app.physJob || app.terrain.active || app.particles.busy || app.shovelTool.busy || app.rakeTool.busy || app.wallTool.busy
      || Object.values(app.concreteTools).some((t) => t.busy) || Object.values(app.materialTools).some((t) => t.busy) || app.machineTool.busy() || (rain && app.sky?.busy)
      || Math.abs(r.dist - g.dist) > 1e-4 || r.target.distanceToSquared(g.target) > 1e-9 || Math.abs(r.yaw - g.yaw) > 1e-4 || Math.abs(r.pitch - g.pitch) > 1e-4 || Math.abs(r.focus - r.focusGoal) > 1e-3;
  };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (app.film) { if (!app.filmOffline) app.filmStep(dt, now / 1000); requestAnimationFrame(frame); return; }
    const recent = now - app.lastInput < 1500, mv = moving();
    const due = recent || (now - lastDraw > (mv ? 30 : 480));
    // (the hand-held sway runs only while drawn smoothly; the shadows are drawn again only when
    // something but the rain moves — else twice a second, for the sun)
    app.rig.live = recent || mv;
    app.shadowLive = recent || (mv && moving(false));
    if (due) {
      const fd = (now - lastDraw) / 1000;
      lastDraw = now;
      fpsAcc += fd; fpsN++;
      if (fpsAcc > 1) { app.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    }
    step(dt, now / 1000, due);
    requestAnimationFrame(frame);
  }
  // the shaders of what is hidden yet (the pump and its hose, the stream of concrete, the hand
  // tools, the ghosts …) made ready while the loading screen is still up — compiled the first time
  // they show, they held the game for a second or two on a phone (the first touch of the hose);
  // all shown once into a small target (the shadows too), nothing is left to compile then
  // (in the background where the phone can — KHR_parallel_shader_compile — and again whenever the
  // light round them changes: a material is compiled anew for another sky)
  app.warmUp = () => {
    const hid = [];
    scene.traverse((o) => { if (!o.visible) { hid.push(o); o.visible = true; } });
    let p = null;
    try { p = renderer.compileAsync ? renderer.compileAsync(scene, camera) : (renderer.compile(scene, camera), null); } catch { /* not worth stopping for */ }
    for (const o of hid) o.visible = false;   // (the programs are made; they finish linking on their own)
    return p?.catch?.(() => {});
  };
  if (!app.filmMode) app.warmUp();
  document.getElementById('loading').classList.add('done');
  document.getElementById('ui').hidden = !!app.filmMode;
  app.ready = true;
  if (app.filmMode) await startFilm(app.filmMode);
  requestAnimationFrame(frame);
}

// If the soil shader could not be built on this device, step down: full → light
// (same soil colouring, plain lookups) → plain. The error stays in the menu.
function checkTerrainShader() {
  const t = app.terrain.mesh, mat = t?.material;
  if (!mat || mat === app.fallbackMat) return;
  const prog = app.renderer.properties.get(mat).currentProgram;
  if (!(prog && prog.diagnostics && prog.diagnostics.runnable === false)) return;
  const old = app.terrainMat.userData.uniforms;
  let next, msg;
  if (mat === app.terrainMat && !app.lightMat) {
    next = app.lightMat = makeLightTerrainMaterial(app.tex);
    msg = 'Грунт: упрощённый шейдер (устройство не собрало полный)';
  } else {
    next = app.fallbackMat = makeFallbackTerrainMaterial(app.tex);
    msg = 'Грунт: простой материал (устройство не собрало шейдер)';
  }
  if (next.userData.uniforms) {
    for (const k of ['tMask', 'uPlot', 'uLevel', 'uLayer', 'uChalk']) next.userData.uniforms[k].value = old[k].value;
    app.terrainMat = next;
  }
  t.material = next;
  app.shaderNote = msg;
  console.error(msg, app.shaderErrors[0]);
  setTimeout(() => app.ui?.toast(msg), 1500);
}
let shaderCheckT = 0;

// Out of video memory (iPhones, in-app browsers): a buffer that did not fit is
// silently not drawn. Step the quality down and upload the soil mesh again.
function checkGpuMemory() {
  const gl = app.renderer.getContext();
  const e = gl.getError();
  if (e !== gl.OUT_OF_MEMORY) return;
  const q = app.settings.quality, next = q === 'high' ? 'medium' : 'low';
  console.error('WebGL out of memory, quality', q, '→', next);
  if (q !== 'low') { app.settings.quality = next; applySettings(); }
  app.terrain.mesh.geometry.dispose();   // re-created on the next frame
  app.ui?.toast(q !== 'low' ? `Не хватило видеопамяти — качество снижено до «${next === 'medium' ? 'среднее' : 'низкое'}»` : 'Не хватает видеопамяти устройства');
}

let concAcc = 0, shadowT = 0;   // (the time since the concrete last flowed / the shadows were drawn)
function step(dt, time, render = true) {
  if (!document.hidden) app.clock += dt;
  const { terrain } = app;
  app.shovelTool.update(dt);
  for (const t of Object.values(app.materialTools)) t.update(dt);
  for (const t of Object.values(app.concreteTools)) t.update(dt);
  app.machineTool.update(dt);
  app.physJob?.update(dt);
  app.wallTool.update(dt);
  app.particles.update(dt);
  // soil physics gets a time budget per frame (small piles settle in a blink)
  const budget = app.settings.quality === 'low' ? 2.5 : 4;
  const t0 = performance.now();
  // (a film drawn frame by frame: by count, not by the clock — the same every run)
  for (let i = 0; i < 80 && terrain.active && (app.filmOffline || performance.now() - t0 < budget); i++) terrain.relax(1);
  app.machineTool.afterRelax?.();   // (what slumped back into a pushing bucket goes out ahead again)
  // fresh concrete creeps: a few passes per frame
  terrain.clock = app.clock;
  // (only while a concrete action is open: what it does to the concrete belongs to its journal entry)
  // (30 times a second, with the time that has passed: the same flow, half the work at 60 fps)
  // (30 times a second, with the time that has passed: the same flow, half the work at 60 fps;
  // the surface redrawn with it — while pouring it would change every frame for nothing)
  let concTick = true;
  if (Object.values(app.concreteTools).some((c) => c.busy) || (app.shovelTool.busy && terrain.cActive)) { concAcc += dt; concTick = concAcc >= 1 / 31; if (concTick) { terrain.concStep(Math.min(concAcc, 0.1), 2); concAcc = 0; } } else concAcc = 0;   // only the tiles where it moves
  if (concTick) terrain.updateMesh();
  app.grass.update();
  app.outlineView.update();
  app.formView.update();
  app.rebarView.update();
  app.wallView.update();
  app.poolView.update(dt, app);
  app.gardenView.update(dt, app);
  app.wallView.columns.update(app.objects);
  app.bitumenSync();
  app.shovel.update(dt);
  app.rake.update(dt);
  app.concreteGear.update(dt, app.camera.position);
  app.dust.update(dt, time);
  if (app.settings.orbit) app.rig.orbit(-dt * 0.12, 0);
  app.rig.update(dt);
  app.workshop.followShadow(app.workshop.sun, app.rig.target, app.rig.dist, app.rig.yaw);
  app.backdrop.update();
  app.sky.update(dt);
  updateFocus();
  app.terrainMat.userData.uniforms.uTime.value = time;
  app.terrainMat.userData.uniforms.uClock.value = app.clock;
  if (app.wallView) app.wallView.concU.uClock.value = app.clock;
  app.pipeline.focus = app.rig.focus;
  if (render) {
    const sm = app.renderer.shadowMap;
    sm.autoUpdate = false;
    shadowT += dt;
    if (app.shadowLive !== false || shadowT > 0.5) { sm.needsUpdate = true; shadowT = 0; }
    app.pipeline.render(app.scene, app.camera, time);
    app.mirrors.render(app.scene);
  }
  if (render && (shaderCheckT += dt) > 1) { shaderCheckT = 0; checkTerrainShader(); checkGpuMemory(); }
  app.recorder.sample(app.clock, dt, trackRow);
  app.ui.tick(dt);
}

// the film mode: the director's frame, then the work `speed` times as fast (in steps of a 30th
// at most), drawn once
async function startFilm(name) {
  const [{ Director }, films] = await Promise.all([import('./film/director.js'), import('./film/poolFilm.js')]);
  const script = { pool: films.poolFilm }[name];
  if (!script) { app.ui.toast('Нет такого ролика: ' + name); return; }
  app.rig.shake = false;
  // (a back garden: a meadow round the plot, not the construction yard's blocks of flats)
  app.settings.backdrop = 'meadow';
  try { await app.backdrop.set('meadow'); } catch (e) { console.warn(e); }
  app.sfx.unlock?.();
  app.film = new Director(app, script, app.filmOffline);
}
app.filmStep = (dt, time = performance.now() / 1000, draw = true) => {
  const f = app.film; if (!f) return;
  if (app.filmOffline) time = f.t;   // (the water's waves, the grass: on the film's clock)
  f.update(dt);
  // (on the phone at most 5 steps a frame — it stays smooth; frame by frame, a 30th each)
  const sim = dt * f.speed, n = Math.max(1, Math.min(app.filmOffline ? 1e3 : 5, Math.ceil(sim / (1 / 30))));
  app.rig.live = true; app.shadowLive = true;
  for (let i = 0; i < n; i++) step(sim / n, time, draw && i === n - 1);
};

// run the simulation ahead without drawing (tests, slow software renderers)
app.simulate = (seconds, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) step(dt, performance.now() / 1000, false);
};

function trackRow(clock) {
  const c = app.camera, s = app.shovel;
  const p = c.position, q = c.quaternion, sp = s.root.position, sq = s.root.quaternion;
  const row = [clock, p.x, p.y, p.z, q.x, q.y, q.z, q.w, c.fov, app.rig.focus, sp.x, sp.y, sp.z, sq.x, sq.y, sq.z, sq.w, s.fill, s.type === 'scoop' ? 1 : 0];
  row.push(...new Array(44).fill(0));   // (the columns of the old machines, kept: the recorded tracks keep their layout)
  const rp = app.rake.root.position, rq = app.rake.root.quaternion;
  row.push(rp.x, rp.y, rp.z, rq.x, rq.y, rq.z, rq.w, app.rake.lift);
  return row;
}

// Autofocus: on the working tool, otherwise on the orbit target.
const _f = new THREE.Vector3(), _fwd = new THREE.Vector3();
function updateFocus() {
  const cam = app.camera;
  const mt = app.machineTool;
  if (app.tool === 'shovel' && app.shovelTool.state !== 'idle') _f.copy(app.shovel.root.position);
  else if (app.tool === 'rake' && app.rakeTool.busy) _f.copy(app.rake.root.position);
  else if (app.materialTools[app.tool]?.busy) _f.copy(app.materialTools[app.tool].p);
  else if (app.concreteTools[app.tool]?.busy) _f.copy(app.concreteGear.pos);
  else if (app.tool === 'machine' && mt.focus(_f)) { /* the loader */ }
  else if (app.focusPoint) _f.copy(app.focusPoint);
  else _f.copy(app.rig.target);
  cam.getWorldDirection(_fwd);
  app.rig.focusGoal = Math.max(0.03, _f.sub(cam.position).dot(_fwd));
}

// Size of the screen we draw on. iOS home-screen apps with a translucent status
// bar report a viewport that is short by the status-bar height (a black band
// at the bottom): there the whole screen is used.
function viewportSize() {
  let w = window.innerWidth, h = window.innerHeight;
  if (navigator.standalone && window.screen) {
    const a = Math.min(screen.width, screen.height), b = Math.max(screen.width, screen.height);
    if (w < h) { w = a; h = Math.max(h, b); } else { w = Math.max(w, b); h = a; }
  }
  const root = document.documentElement.style;
  root.setProperty('--app-w', `${w}px`);
  root.setProperty('--app-h', `${h}px`);
  return [w, h];
}

function resize() {
  const [w, h] = viewportSize();
  const q = app.settings.quality;
  const dprCap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1.15;
  app.renderer.setPixelRatio(app.dprOverride || Math.min(window.devicePixelRatio || 1, dprCap));
  app.renderer.setSize(w, h, false);
  app.camera.aspect = w / h;
  // portrait phones get a wider lens so the whole plot fits
  app.camera.fov = w < h ? 52 : 38;
  app.camera.updateProjectionMatrix();
}

// ---- tools ------------------------------------------------------------------------------
app.activeTool = () => ({ shovel: app.shovelTool, rake: app.rakeTool, ...app.materialTools, ...app.concreteTools, mark: app.markTool, form: app.formTool, rebar: app.rebarTool, wall: app.wallTool, machine: app.machineTool }[app.tool] || null);
app.busy = () => !!app.physJob || app.wallTool?.busy || !!app.physLoading || app.shovelTool.busy || app.rakeTool.busy || Object.values(app.concreteTools).some((t) => t.busy) || Object.values(app.materialTools).some((t) => t.busy) || app.machineTool.busy();

function setTool(t) {
  if (app.tool === 'shovel' && t !== 'shovel') app.shovelTool.finish();
  if (app.tool === 'rake' && t !== 'rake') app.rakeTool.finish();
  if (app.materialTools[app.tool] && t !== app.tool) app.materialTools[app.tool].finish();
  if (app.concreteTools[app.tool] && t !== app.tool) app.concreteTools[app.tool].finish();
  // the concrete tool in hand: shown where it was last, hidden with other tools
  if (!app.concreteTools[t]) app.concreteGear.set(null);
  else if (app.concreteGear.show !== t) app.concreteGear.set(t, app.rig.target.clone().setY(app.terrain.heightAt(app.rig.target.x, app.rig.target.z)));
  if (app.tool === 'mark' && t !== 'mark' && app.markTool.trench) app.markTool.finishTrench();
  if (app.tool === 'machine' && t !== 'machine') app.machineTool.finish();
  app.tool = t;
  app.outlineView.setHandles(t === 'mark', app.markTool.selected);
  if (t !== 'shovel' && app.shovelTool.state === 'idle') {
    // lean the shovel against the tray corner when it is not in use (no tray round a 360°
    // place: put away)
    const x = -app.terrain.halfX + 0.012 * KT, z = app.terrain.halfZ - 0.012 * KT;
    app.shovel.setPose({ pos: new THREE.Vector3(x, app.terrain.heightAt(x, z) - 0.006 * KT, z), dir: new THREE.Vector2(0.7, -0.7), tilt: 0.22, roll: 0 });
    app.shovel.root.visible = !isPano(app.settings.backdrop);
  }
  if (t === 'shovel' && app.shovelTool.state === 'idle') {
    // taken up: it stands in the soil in the middle of the screen
    const g = app.rig.target, x = THREE.MathUtils.clamp(g.x, -app.terrain.halfX + 0.03, app.terrain.halfX - 0.03), z = THREE.MathUtils.clamp(g.z, -app.terrain.halfZ + 0.03, app.terrain.halfZ - 0.03);
    app.shovel.setPose({ pos: new THREE.Vector3(x, app.terrain.heightAt(x, z), z), dir: new THREE.Vector2(0.7, -0.7), tilt: 0.25, roll: 0 }, true);
    app.shovel.root.visible = true;
  }
  if (t !== 'rake' && !app.rakeTool.busy) {
    // the rake is put down along the front edge: tines in the soil, handle on the ground
    app.rakeTool.putDown();
  }
  if (t === 'machine') app.machineTool.show(true);
  // the next course of a wall (ghosts, cord) only while working on walls
  if (t === 'wall') app.wallTool._focus(); else { app.wallView.focus = null; app.wallView.marks = false; app.wallView.dirty = true; }
  app.ui?.refresh();
}
app.setTool = setTool;

function undo() {
  if (app.physJob?.abort()) { app.ui.refresh(); return; }
  if (app.shovelTool.abort()) { app.ui.refresh(); return; }
  if (app.rakeTool.abort()) { app.ui.refresh(); return; }
  for (const t of Object.values(app.materialTools)) if (t.abort()) { app.ui.refresh(); return; }
  for (const t of Object.values(app.concreteTools)) if (t.abort()) { app.ui.refresh(); return; }
  if (app.machineTool.abort()) { app.ui.refresh(); return; }
  app.journal.undo();
  app.ui.refresh();
}
function redo() {
  app.physJob?.finish();
  if (app.shovelTool.busy) app.shovelTool.finish();
  app.rakeTool.finish();
  for (const t of Object.values(app.materialTools)) t.finish();
  for (const t of Object.values(app.concreteTools)) t.finish();
  app.machineTool.finish();
  if (app.journal.pending) app.journal.commit(app.clock);
  app.journal.redo();
  app.ui.refresh();
}
app.undo = undo; app.redo = redo;

// design grade (lowest allowed cut) at a point: the deepest outline containing it
app.outlineContains = contains;
app.gradeAt = (x, z) => {
  let g = null;
  for (const o of app.objects.all('outline')) if (contains(o, x, z)) { const y = gradeY(o); g = g === null ? y : Math.min(g, y); }
  return g;
};

// placed object under the finger (formwork / rebar)
const _ray = new THREE.Raycaster();
app.pickObject = (cx, cy, kind) => {
  _ray.setFromCamera(app.gestures.ndc(cx, cy), app.camera);
  const views = kind === 'form' ? [app.formView] : kind === 'wall' ? [app.wallView] : [app.rebarView];
  const hits = _ray.intersectObjects(views.map((v) => v.group), true);
  app.lastPick = null;
  for (const h of hits) for (const v of views) { const id = v.ownerOf(h); if (id) { app.lastPick = h; return id; } }   // (the hit: what part of it was touched)
  // thin bars are hard to hit: try a fat ray against the bar axes
  if (kind === 'rebar') return app.rebarView.near?.(_ray.ray) ?? null;
  return null;
};

app.setBackdrop = async (mode) => {
  app.settings.backdrop = mode;
  app.ui?.toast(isPano(mode) ? `Загружаю панораму «${PANOS[mode].name}»…` : '');
  await app.backdrop.set(mode);
  applySettings();
};

// ---- settings ---------------------------------------------------------------------------
function readSettings() {
  try { return JSON.parse(localStorage.getItem('tc-settings') || '{}'); } catch { return {}; }
}
function applySettings() {
  const s = app.settings;
  if (!app.filmMode) try { localStorage.setItem('tc-settings', JSON.stringify(s)); } catch { /* private mode */ }
  if (app.shovel.type !== s.shovel && !app.shovelTool.busy) app.shovel.setType(s.shovel);
  app.terrainMat.userData.uniforms.uLevel.value = s.level ? 1 : 0;
  app.terrainMat.userData.uniforms.uLayer.value = SOIL.layer = Math.max(0.004, s.bite / 1000);
  app.pipeline.dofAmount = isPano(s.backdrop) ? 0 : s.dof;
  app.shovel.root.visible = app.tool === 'shovel' || app.shovelTool.state !== 'idle' || !isPano(s.backdrop);   // (put away round a 360° place)   // (a real place round it: no miniature blur)
  if (app.pipeline.quality !== s.quality || !app.pipeline.target) app.pipeline.setQuality(s.quality);
  const sm = s.quality === 'low' ? 1024 : s.quality === 'medium' ? 2048 : 3072;
  if (app.workshop.sun.shadow.mapSize.x !== sm) {
    app.workshop.sun.shadow.mapSize.setScalar(sm);
    if (app.workshop.sun.shadow.map) { app.workshop.sun.shadow.map.dispose(); app.workshop.sun.shadow.map = null; }
  }
  if (app.projectView.show !== (s.project || 'off')) app.projectView.setShow(s.project || 'off');
  app.rig.shake = s.shake;
  app.sfx.enabled = s.sound;
  if (app.backdrop.mode !== s.backdrop) app.backdrop.set(s.backdrop);
  resize();
  app.ui?.refresh();
}
app.applySettings = applySettings;

// ---- persistence --------------------------------------------------------------------------
function freshPlot() {
  app.terrain.generate(7);
  app.terrain.active = null;
  app.objects.load({ nextId: 1, items: [] });
  for (const o of DEFAULT_OUTLINES) app.objects.add({ type: 'outline', ...o, id: undefined });
}

function buildProject(parts = false) {
  const t = app.terrain;
  // an action still in progress (soil on the shovel) is not saved: the ground
  // and objects are stored as they were before it, so the file equals its journal
  const base = app.journal.pending ? app.journal.pending.snap : t;
  const objects = app.objects.toJSON();
  if (app.journal.pending && app.objects.tx) {
    const before = new Map(app.objects.tx);
    objects.items = objects.items.filter((r) => !before.has(r.id)).concat([...before.values()].filter(Boolean));
  }
  const strip = (r) => ({ id: r.id, type: r.type, t0: r.t0, t1: r.t1, meta: r.meta, diff: r.diff, objs: r.objs });
  return {
    format: 'tiny-craftsman-project', version: 3, build: BUILD, stage: STAGE, savedAt: new Date().toISOString(),
    clock: app.clock, scale: MODEL_SCALE, units: 'metres (real size of the diorama)',
    tray: TRAY,
    terrain: parts ? { rx: t.rx, rz: t.rz, cell: t.cell, sizeX: t.sizeX, sizeZ: t.sizeZ, floorY: t.floorY, soilY: TRAY.soil, seed: t.seed } : { rx: t.rx, rz: t.rz, cell: t.cell, sizeX: t.sizeX, sizeZ: t.sizeZ, floorY: t.floorY, soilY: TRAY.soil, seed: t.seed, nat: base.nat, loose: base.loose, ldep: base.ldep || t.ldep, orig: t.orig,
      layers: { count: 3, n: base.lN || t.lN, h: base.lH || t.lH, m: base.lM || t.lM, materials: ['soil', 'sand', 'gravel 5-20', 'gravel 20-40'] },
      concrete: { h: base.conc || t.conc, poured: base.cTime || t.cTime, smooth: base.cSm || t.cSm, cureSeconds: CONCRETE.cure },
      onConcrete: { h: base.top || t.top, m: base.topM || t.topM } },
    objects,
    settings: app.settings,
    camera: app.rig.state(),
    journal: parts ? { nextId: app.journal.nextId, done: app.journal.done.map((r) => r.id), undone: app.journal.undone.map((r) => r.id) } : { nextId: app.journal.nextId, done: app.journal.done.map(strip), undone: app.journal.undone.map(strip) },
    ...(parts ? {} : { track: { fields: TRACK_FIELDS, rate: 20, data: app.recorder.toArray() } }),
  };
}
app.buildProject = buildProject;

function applyProject(p) {
  if (p.format !== 'tiny-craftsman-project') throw new Error('not a Tiny Craftsman project');
  const t = app.terrain, j = app.journal;
  app.particles.clearClods();
  app.migrated = null;
  if (p.version === 1 || p.terrain.rx !== t.rx || p.terrain.rz !== t.rz) {
    // a project from an earlier, smaller tray: its ground goes into the middle of
    // the new plot, its outlines / formwork / rebar stay, the machines are parked
    // afresh; the old journal cannot be replayed on the new grid
    migrateGrid(p);
    deepenOutlines(p);
    j.pending = null; j.done = []; j.undone = []; j.nextId = 1;
    app.recorder.load(null);
    app.clock = p.clock || 0;
    if (p.settings) Object.assign(app.settings, p.settings, { backdrop: app.settings.backdrop });
    app.migrated = app.migratedSame
      ? 'Участок пересчитан на более мелкую сетку грунта (3 мм) — журнал отмен начат заново'
      : `Проект этапа ${p.stage || 1} перенесён в центр участка ${Math.round(TRAY.innerX * 100)}×${Math.round(TRAY.innerZ * 100)} см (журнал начат заново)`;
    return;
  }
  t.seed = p.terrain.seed;
  t.orig.set(p.terrain.orig); t.nat.set(p.terrain.nat); t.loose.set(p.terrain.loose);
  if (p.terrain.ldep && p.terrain.ldep.length === t.ldep.length) t.ldep.set(p.terrain.ldep); else t.ldep.fill(0.02);
  const L = p.terrain.layers;
  if (L && L.h.length === t.lH.length) { t.lH.set(L.h); t.lM.set(L.m); t.lN.set(L.n); } else t.layersFromLoose();   // before BUILD 17: all soil
  const C = p.terrain.concrete;
  if (C && C.h.length === t.conc.length) { t.conc.set(C.h); t.cTime.set(C.poured); t.cSm.set(C.smooth); } else { t.conc.fill(0); t.cSm.fill(0); }
  const P = p.terrain.onConcrete;   // BUILD 28+: sand / stone lying on concrete
  if (P && P.h.length === t.top.length) { t.top.set(P.h); t.topM.set(P.m); } else { t.top.fill(0); t.topM.fill(0); }
  t.cActive = null;
  app.clock = p.clock || 0;
  t.sanitizeConcrete(app.clock);
  t.markAll(); t.active = null;
  const rescaled = (p.scale || 12) !== MODEL_SCALE;
  if (rescaled || !MACHINES_ENABLED) {
    // another model scale: boards and bars were cut for it, so only the ground and
    // the setting-out stay (and machines are off for now)
    const keep = (r) => (r.type === 'machine' ? false : rescaled ? r.type === 'outline' : true);
    const items = (p.objects?.items || []).filter(keep);
    app.objects.load({ nextId: p.objects?.nextId || 1, items });
  } else app.objects.load(p.objects);
  // the cages of floor slabs are laid out again by the current rules (BUILD 79: round an
  // opening, not across it; nothing sticking out of the edge)
  // slabs set out before BUILD 91: their true outline (the faces of the walls under them)
  for (const b of app.objects.all('belt')) if (isSlab(b) && !b.clip) { const clip = slabClip(b, app.objects.all('unit'), app.objects.all('belt')); if (clip) app.objects.update(b.id, { clip }); }
  for (const c of app.objects.all('cage')) {
    const b = c.beltId != null && app.objects.get(c.beltId);
    if (isSlab(b)) Object.assign(c, (({ bars, chairs, frogs, ties, stars }) => ({ bars, chairs, frogs, ties, stars }))(slabCage(b)));
  }
  if (rescaled) {
    if (p.settings) Object.assign(app.settings, p.settings, { bite: DEFAULT_SETTINGS.bite, trenchWidth: DEFAULT_SETTINGS.trenchWidth, trenchDepth: DEFAULT_SETTINGS.trenchDepth, backdrop: p.settings.backdrop });
    app.rig.setState(p.camera);
    j.pending = null; j.done = []; j.undone = []; j.nextId = 1;
    app.recorder.load(null);
    deepenOutlines(p);
    app.migrated = `Масштаб изменён на 1:${MODEL_SCALE}: грунт и разметка сохранены, опалубку и арматуру поставьте заново (журнал начат заново)`;
    return;
  }
  if (p.settings) Object.assign(app.settings, p.settings, (p.build || 0) < 9 ? { target: DEFAULT_SETTINGS.target } : {});
  deepenOutlines(p);
  app.rig.setState(p.camera);
  j.pending = null;
  j.done = p.journal?.done || []; j.undone = p.journal?.undone || []; j.nextId = p.journal?.nextId || j.done.length + 1;
  if (j.trim()) app.migrated = 'Проект стал слишком тяжёлым для телефона — старая история отмен сокращена (сам проект цел)';
  app.recorder.load(fitTrack(p.track));
}

// a recorded track in the current field layout; tracks of older builds whose fields are
// a prefix of today's (new fields are only ever appended) get the new columns as zeros
function fitTrack(tr) {
  const f = tr?.fields, d = tr?.data;
  if (!f || !d || !f.every((k, i) => TRACK_FIELDS[i] === k)) return null;
  if (f.length === TRACK_FIELDS.length) return d;
  const F0 = f.length, F = TRACK_FIELDS.length, n = Math.floor(d.length / F0), out = new Float32Array(n * F);
  for (let r = 0; r < n; r++) for (let k = 0; k < F0; k++) out[r * F + k] = d[r * F0 + k];
  return out;
}

// BUILD 9: pits and trenches of older projects were too shallow (2–3 passes of the
// shovel at 1:3.5) — give them the full 6 passes once
function deepenOutlines(p) {
  if ((p.build || 0) >= 9) return;
  const deep = DEFAULT_SETTINGS.target;
  for (const o of app.objects.all('outline')) if (o.depth < deep) app.objects.update(o.id, { depth: deep });
}

function migrateGrid(p) {
  const t = app.terrain, pt = p.terrain;
  t.generate(pt.seed || 7);
  // old grid: v1 = square (size, res), v2+ = rx × rz cells of `cell`
  const rx = pt.rx ?? pt.res, rz = pt.rz ?? pt.res, n = rx + 1;
  const cell = pt.cell ?? pt.size / pt.res, hx = rx * cell / 2, hz = rz * cell / 2;
  // same plot, only a finer grid: everything stays where it is (machines too)
  app.migratedSame = Math.abs(hx - t.halfX) < 1e-6 && Math.abs(hz - t.halfZ) < 1e-6;
  const dy = TRAY.soil - (pt.soilY || 0.056);
  const at = (arr, x, z) => {
    const cx = Math.min(rx - 1e-3, Math.max(0, (x + hx) / cell)), cz = Math.min(rz - 1e-3, Math.max(0, (z + hz) / cell));
    const ix = Math.floor(cx), iz = Math.floor(cz), fx = cx - ix, fz = cz - iz, i = iz * n + ix;
    return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fz) + (arr[i + n] * (1 - fx) + arr[i + n + 1] * fx) * fz;
  };
  for (let iz = 0; iz <= t.rz; iz++) for (let ix = 0; ix <= t.rx; ix++) {
    const x = t.toWorldX(ix), z = t.toWorldZ(iz);
    if (!app.migratedSame && (Math.abs(x) > hx - cell || Math.abs(z) > hz - cell)) continue;
    const i = iz * t.nx + ix;
    t.orig[i] = at(pt.orig, x, z) + dy;
    t.nat[i] = at(pt.nat, x, z) + dy;
    t.loose[i] = at(pt.loose, x, z);
  }
  t.layersFromLoose();
  t.markAll();
  for (let i = 0; i < 6000 && t.active; i++) t.relax(1);
  t.active = null;
  if (p.objects?.items) {
    // keep the setting-out and everything built on it; machines get parked
    const items = app.migratedSame && MACHINES_ENABLED ? p.objects.items : p.objects.items.filter((r) => r.type !== 'machine');
    const next = Math.max(p.objects.nextId || 1, ...items.map((r) => r.id + 1));
    app.objects.load({ nextId: next, items });
  } else {
    app.objects.load({ nextId: 1, items: [] });
    const r = p.mark || DEFAULT_OUTLINES[0];
    app.objects.add({ type: 'outline', kind: 'rect', x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, depth: p.settings?.target || 15 });
  }
}

// Saving: by parts (storage.js) — the ground's tiles changed since the last save, the
// journal's new entries, the rest (small). A whole project is tens of MB: copied at every
// action it froze the game for a second each time (the loader, the truck). And not while
// the work goes on: when the finger has rested a moment (or after 15 s at the latest).
const SAVE = { j: new Set(), trackT: -1e9, legacy: false, wait0: 0 };
let saveTimer = 0;
function scheduleSave() {
  if (app.filmMode) return;   // (a film's plot is never saved)
  app.ui?.setSaveState('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(lazySave, 1500);
}
function lazySave() {
  const now = performance.now();
  if (!SAVE.wait0) SAVE.wait0 = now;
  if ((now - app.lastInput < 1200 || app.busy?.()) && now - SAVE.wait0 < 15000) { saveTimer = setTimeout(lazySave, 700); return; }
  SAVE.wait0 = 0;
  saveNow();
}
app.scheduleSave = scheduleSave;
let saveChain = Promise.resolve();
// the fields of the ground saved per tile (and their values per cell)
const TFIELDS = [['nat', 1], ['loose', 1], ['ldep', 1], ['orig', 1], ['lN', 1], ['lH', 3], ['lM', 3], ['conc', 1], ['cTime', 1], ['cSm', 1], ['top', 1], ['topM', 1]];
const STILE = 64;
function tileOf(src, t, k) {
  const tx = k % t.stnx, tz = (k / t.stnx) | 0, x0 = tx * STILE, z0 = tz * STILE, w = Math.min(t.nx, x0 + STILE) - x0, h = Math.min(t.nz, z0 + STILE) - z0, out = { x0, z0, w, h };
  for (const [f, m] of TFIELDS) {
    const A = f === 'orig' ? t.orig : src[f] || t[f], B = new A.constructor(w * h * m);
    for (let z = 0; z < h; z++) { const i = ((z0 + z) * t.nx + x0) * m; B.set(A.subarray(i, i + w * m), z * w * m); }
    out[f] = B;
  }
  return out;
}
// the parts to write now: [[key, value]…], keys to delete
function buildParts(force) {
  const t = app.terrain, j = app.journal, pend = j.pending, src = pend ? pend.snap : t, puts = [], dels = [];
  // (an action going on: the ground as it was before it — its tiles stay to be written again)
  for (let k = 0; k < t.sDirty.length; k++) if (t.sDirty[k]) { puts.push(['p:t:' + k, tileOf(src, t, k)]); if (!pend) t.sDirty[k] = 0; }
  const strip = (r) => ({ id: r.id, type: r.type, t0: r.t0, t1: r.t1, meta: r.meta, diff: r.diff, objs: r.objs });
  const ids = new Set();
  for (const r of [...j.done, ...j.undone]) { ids.add(r.id); if (!SAVE.j.has(r.id)) { puts.push(['p:j:' + r.id, strip(r)]); SAVE.j.add(r.id); } }
  for (const id of [...SAVE.j]) if (!ids.has(id)) { dels.push('p:j:' + id); SAVE.j.delete(id); }
  if (force || performance.now() - SAVE.trackT > 120000) { puts.push(['p:track', { fields: TRACK_FIELDS, rate: 20, data: app.recorder.toArray() }]); SAVE.trackT = performance.now(); }
  const meta = buildProject(true);
  meta.terrain.tiles = { size: STILE, nx: t.stnx, nz: t.stnz };
  puts.push(['p:meta', meta]);
  return { puts, dels };
}
// the saved parts → a project (as buildProject makes it), or null
function assembleParts(parts) {
  const meta = parts.get('p:meta');
  if (!meta || !meta.terrain?.tiles) return null;
  const T = meta.terrain, n = (T.rx + 1) * (T.rz + 1), nx = T.rx + 1, arr = {};
  for (const [f, m] of TFIELDS) arr[f] = new ({ lN: Uint8Array, lM: Uint8Array, topM: Uint8Array }[f] || Float32Array)(n * m);
  for (let k = 0; k < T.tiles.nx * T.tiles.nz; k++) {
    const q = parts.get('p:t:' + k);
    if (!q) return null;
    for (const [f, m] of TFIELDS) for (let z = 0; z < q.h; z++) { const i = ((q.z0 + z) * nx + q.x0) * m; arr[f].set(q[f].subarray(z * q.w * m, (z + 1) * q.w * m), i); }
  }
  const p = { ...meta };
  p.terrain = { ...T, nat: arr.nat, loose: arr.loose, ldep: arr.ldep, orig: arr.orig, layers: { count: 3, n: arr.lN, h: arr.lH, m: arr.lM, materials: ['soil', 'sand', 'gravel 5-20', 'gravel 20-40'] },
    concrete: { h: arr.conc, poured: arr.cTime, smooth: arr.cSm, cureSeconds: CONCRETE.cure }, onConcrete: { h: arr.top, m: arr.topM } };
  const ent = (id) => parts.get('p:j:' + id);
  p.journal = { nextId: meta.journal.nextId, done: meta.journal.done.map(ent).filter(Boolean), undone: meta.journal.undone.map(ent).filter(Boolean) };
  p.track = parts.get('p:track') || null;
  return p;
}
// saves are serialised: a request during a running save waits for it and then saves again
function saveNow(force = false) {
  clearTimeout(saveTimer);
  if (!app.ready || app.filmMode) return Promise.resolve();
  saveChain = saveChain.then(async () => {
    try {
      if (app.shovelTool.state === 'settle' || app.shovelTool.state === 'dump') app.shovelTool.finish();
      const { puts, dels } = buildParts(force);
      await saveParts(puts, dels, SAVE.legacy);
      SAVE.legacy = false;
      app.ui?.setSaveState('saved');
    } catch (e) {
      console.error(e);
      app.terrain.sDirty.fill(1); SAVE.j.clear();   // (written again whole next time)
      app.ui?.setSaveState('error');
    }
  });
  return saveChain;
}
app.saveNow = saveNow;
// camera/tool track is saved now and then even without edits (when nothing is going on)
setInterval(() => { if (app.ready && !document.hidden) lazySave(); }, 60000);

app.exportProject = () => {
  app.shovelTool.finish();
  app.rakeTool.finish();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  let text;
  try { text = toJSON(buildProject()); } catch (e) { app.ui?.toast('Не удалось собрать проект: ' + (e?.message || e)); return; }
  download(`tiny-craftsman-stage${STAGE}-${stamp}.json`, text).catch((e) => app.ui?.toast('Не удалось сохранить файл: ' + (e?.message || e)));
};

// the buildings only (no undo history, no ground): small enough to send — what is built, to look into
app.exportObjects = async () => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  // (the buildings and the ground they stand on — the soil, the sand, the gravel, the concrete
  // cast in it — without the history: a project that opens as it is, a few MB packed)
  const p = buildProject(); p.journal = { nextId: app.journal.nextId, done: [], undone: [] }; delete p.track;
  const text = toJSON(p);
  let blob = new Blob([text], { type: 'application/json' }), name = `tiny-craftsman-buildings-${stamp}.json`;
  try { if (typeof CompressionStream !== 'undefined') { blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob(); blob = new Blob([blob], { type: 'application/gzip' }); name += '.gz'; } } catch { /* not compressed */ }
  download(name, blob).catch((e) => app.ui?.toast('Не удалось сохранить файл: ' + (e?.message || e)));
};

app.importProject = async (file) => {
  // (a packed one — the bug-report export: .gz)
  let text;
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b && typeof DecompressionStream !== 'undefined') text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  else text = await file.text();
  const p = fromJSON(text);
  await clearLocal(); SAVE.j.clear(); SAVE.legacy = false;
  applyProject(p);
  applySettings();
  if (app.migrated) app.ui.toast(app.migrated);
  await saveNow();
};

app.newProject = async () => {
  app.shovelTool.abort();
  app.shovelTool.finish();
  app.rakeTool.abort();
  for (const t of Object.values(app.materialTools)) t.abort();
  for (const t of Object.values(app.concreteTools)) t.abort();
  app.machineTool.abort();
  app.machineTool.finish();
  await clearLocal(); SAVE.j.clear(); SAVE.legacy = false;
  app.particles.clearClods();
  app.journal.done = []; app.journal.undone = []; app.journal.pending = null; app.journal.nextId = 1;
  freshPlot();
  app.recorder.load(null);
  app.clock = 0;
  app.markTool.select(null);
  app.ui.refresh();
  await saveNow();
};

main().catch((e) => {
  console.error(e);
  const sub = document.querySelector('#loading .sub');
  if (sub) sub.textContent = 'Ошибка запуска: ' + e.message;
});
