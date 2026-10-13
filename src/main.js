import * as THREE from 'three';
import { BUILD, STAGE, TRAY, MODEL_SCALE, DEFAULT_SETTINGS, DEFAULT_MARK, TERRAIN_RES } from './config.js';
import { loadAssets } from './world/assets.js';
import { buildWorkshop } from './world/workshop.js';
import { Terrain } from './world/terrain.js';
import { makeTerrainMaterial } from './world/terrainMaterial.js';
import { Grass } from './world/grass.js';
import { SoilParticles } from './world/particles.js';
import { Marking } from './world/marking.js';
import { Shovel } from './world/shovel.js';
import { makeDust } from './world/dust.js';
import { Pipeline } from './render/pipeline.js';
import { CameraRig } from './input/cameraRig.js';
import { Gestures } from './input/gestures.js';
import { Journal } from './core/journal.js';
import { Recorder, TRACK_FIELDS } from './core/recorder.js';
import { saveLocal, loadLocal, clearLocal, toJSON, fromJSON, download } from './core/storage.js';
import { ShovelTool } from './tools/shovelTool.js';
import { Sfx } from './audio/sfx.js';
import { UI } from './ui/ui.js';

const app = (window.__tc = { ready: false, BUILD });

async function main() {
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__TC_TEST });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.renderer = renderer;

  app.settings = { ...DEFAULT_SETTINGS, ...readSettings() };
  // URL overrides (handy for testing / recording): ?quality=low&dpr=1
  const params = new URLSearchParams(location.search);
  if (params.get('quality')) app.settings.quality = params.get('quality');
  app.dprOverride = params.get('dpr') ? Number(params.get('dpr')) : 0;
  const scene = (app.scene = new THREE.Scene());
  const camera = (app.camera = new THREE.PerspectiveCamera(45, 1, 0.008, 30));

  const tex = await loadAssets(renderer, (f) => { document.getElementById('loadbar').style.width = `${Math.round(f * 100)}%`; });
  app.tex = tex;
  app.workshop = buildWorkshop(scene, renderer, tex);

  const terrain = (app.terrain = new Terrain());
  app.terrainMat = makeTerrainMaterial(tex);
  scene.add(terrain.buildMesh(app.terrainMat));
  app.grass = new Grass(terrain); scene.add(app.grass.mesh);
  app.particles = new SoilParticles(tex, terrain); scene.add(app.particles.mesh, app.particles.clods);
  app.marking = new Marking(terrain); scene.add(app.marking.group);
  app.shovel = new Shovel(tex); scene.add(app.shovel.root);
  app.shovel.setType(app.settings.shovel);
  app.dust = makeDust(); scene.add(app.dust.points);

  app.pipeline = new Pipeline(renderer);
  app.rig = new CameraRig(camera);
  app.journal = new Journal(terrain);
  app.recorder = new Recorder();
  app.sfx = new Sfx();
  app.shovelTool = new ShovelTool(app);
  app.clock = 0;
  app.tool = 'shovel';

  // ---- restore the saved project -------------------------------------------------
  const saved = await loadLocal();
  if (saved) {
    try { applyProject(saved); } catch (e) { console.warn('could not restore project', e); }
  }
  app.marking.setRect(app.marking.rect);
  syncMarkUniform();

  app.ui = new UI(app);
  app.gestures = new Gestures(app, canvas);
  app.journal.onChange = () => { app.ui.refresh(); scheduleSave(); };
  app.onShovelState = () => app.ui.refresh();
  applySettings();
  setTool(app.tool);

  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);

  // keep the camera from stalling on first frame: settle immediately
  app.rig.update(1);
  renderer.compile(scene, camera);

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0;
  app.fps = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 1) { app.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    step(dt, now / 1000);
    requestAnimationFrame(frame);
  }
  document.getElementById('loading').classList.add('done');
  document.getElementById('ui').hidden = false;
  app.ready = true;
  requestAnimationFrame(frame);
}

function step(dt, time) {
  if (!document.hidden) app.clock += dt;
  const { terrain } = app;
  app.shovelTool.update(dt);
  app.particles.update(dt);
  // soil physics gets a time budget per frame (small piles settle in a blink)
  const budget = app.settings.quality === 'low' ? 2.5 : 4;
  const t0 = performance.now();
  for (let i = 0; i < 80 && terrain.active && performance.now() - t0 < budget; i++) terrain.relax(1);
  terrain.updateMesh();
  app.grass.update();
  app.marking.update();
  app.shovel.update(dt);
  app.dust.update(dt, time);
  app.rig.update(dt);
  updateFocus();
  app.terrainMat.userData.uniforms.uTime.value = time;
  app.pipeline.focus = app.rig.focus;
  app.pipeline.render(app.scene, app.camera, time);
  app.recorder.sample(app.clock, dt, app.camera, app.rig.focus, app.shovel);
  app.ui.tick(dt);
}

// Autofocus: on the blade while working, otherwise on the orbit target.
const _f = new THREE.Vector3(), _fwd = new THREE.Vector3();
function updateFocus() {
  const cam = app.camera;
  const st = app.shovelTool.state;
  if (app.tool === 'shovel' && st !== 'idle') _f.copy(app.shovel.root.position);
  else if (app.focusPoint) _f.copy(app.focusPoint);
  else _f.copy(app.rig.target);
  cam.getWorldDirection(_fwd);
  app.rig.focusGoal = Math.max(0.03, _f.sub(cam.position).dot(_fwd));
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const q = app.settings.quality;
  const dprCap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1.15;
  app.renderer.setPixelRatio(app.dprOverride || Math.min(window.devicePixelRatio || 1, dprCap));
  app.renderer.setSize(w, h, false);
  app.camera.aspect = w / h;
  // portrait phones get a wider lens so the whole plot fits
  app.camera.fov = w < h ? 52 : 38;
  app.camera.updateProjectionMatrix();
}

// ---- tools ------------------------------------------------------------------------
function setTool(t) {
  if (app.tool === 'shovel' && t !== 'shovel') app.shovelTool.finish();
  app.tool = t;
  if (t !== 'shovel' && app.shovelTool.state === 'idle') {
    // lean the shovel against the tray corner when it is not in use
    const p = new THREE.Vector3(-0.128, 0, 0.128);
    app.shovel.setPose({ pos: new THREE.Vector3(p.x, app.terrain.heightAt(p.x, p.z) - 0.006, p.z), dir: new THREE.Vector2(0.7, -0.7), tilt: 0.22, roll: 0 });
  }
  app.ui?.refresh();
}
app.setTool = setTool;

function undo() {
  if (app.shovelTool.abort()) { app.ui.refresh(); return; }
  const rec = app.journal.undo();
  if (rec?.type === 'mark') { app.marking.setRect(rec.extra.before); syncMarkUniform(); }
  app.ui.refresh();
}
function redo() {
  if (app.shovelTool.busy) app.shovelTool.finish();
  const rec = app.journal.redo();
  if (rec?.type === 'mark') { app.marking.setRect(rec.extra.after); syncMarkUniform(); }
  app.ui.refresh();
}
app.undo = undo; app.redo = redo;

function syncMarkUniform() {
  const r = app.marking.rect;
  app.terrainMat.userData.uniforms.uMark.value.set(r.x0, r.z0, r.x1, r.z1);
}
app.syncMarkUniform = syncMarkUniform;

// ---- settings ----------------------------------------------------------------------
function readSettings() {
  try { return JSON.parse(localStorage.getItem('tc-settings') || '{}'); } catch { return {}; }
}
function applySettings() {
  const s = app.settings;
  try { localStorage.setItem('tc-settings', JSON.stringify(s)); } catch { /* private mode */ }
  if (app.shovel.type !== s.shovel && !app.shovelTool.busy) app.shovel.setType(s.shovel);
  app.terrainMat.userData.uniforms.uTargetY.value = TRAY.soil - s.target / 1000;
  app.terrainMat.userData.uniforms.uLevel.value = s.level ? 1 : 0;
  app.pipeline.dofAmount = s.dof;
  if (app.pipeline.quality !== s.quality || !app.pipeline.target) app.pipeline.setQuality(s.quality);
  app.workshop.sun.shadow.mapSize.setScalar(s.quality === 'low' ? 1024 : 2048);
  if (app.workshop.sun.shadow.map) { app.workshop.sun.shadow.map.dispose(); app.workshop.sun.shadow.map = null; }
  app.rig.shake = s.shake;
  app.sfx.enabled = s.sound;
  resize();
  app.ui?.refresh();
}
app.applySettings = applySettings;

// ---- persistence -----------------------------------------------------------------------
function buildProject() {
  const t = app.terrain;
  // an action still in progress (soil on the shovel) is not saved: the ground
  // is stored as it was before it, so the file always equals its journal
  const base = app.journal.pending ? app.journal.pending.snap : t;
  const strip = (r) => ({ id: r.id, type: r.type, t0: r.t0, t1: r.t1, meta: r.meta, diff: r.diff, extra: r.extra });
  return {
    format: 'tiny-craftsman-project', version: 1, build: BUILD, stage: STAGE, savedAt: new Date().toISOString(),
    clock: app.clock, scale: MODEL_SCALE, units: 'metres (real size of the diorama)',
    tray: TRAY,
    terrain: { res: t.res, size: t.size, floorY: t.floorY, soilY: TRAY.soil, seed: t.seed, nat: base.nat, loose: base.loose, orig: t.orig },
    mark: app.marking.rect,
    settings: app.settings,
    camera: app.rig.state(),
    journal: { nextId: app.journal.nextId, done: app.journal.done.map(strip), undone: app.journal.undone.map(strip) },
    track: { fields: TRACK_FIELDS, rate: 20, data: app.recorder.toArray() },
  };
}
app.buildProject = buildProject;

function applyProject(p) {
  if (p.format !== 'tiny-craftsman-project') throw new Error('not a Tiny Craftsman project');
  const t = app.terrain;
  if (p.terrain.res !== TERRAIN_RES) throw new Error('terrain resolution mismatch');
  t.seed = p.terrain.seed;
  t.orig.set(p.terrain.orig); t.nat.set(p.terrain.nat); t.loose.set(p.terrain.loose);
  t.markAll(); t.active = null;
  app.particles.clearClods();
  app.clock = p.clock || 0;
  if (p.mark) app.marking.setRect(p.mark);
  if (p.settings) Object.assign(app.settings, p.settings);
  app.rig.setState(p.camera);
  const j = app.journal;
  j.pending = null;
  j.done = p.journal?.done || []; j.undone = p.journal?.undone || []; j.nextId = p.journal?.nextId || j.done.length + 1;
  app.recorder.load(p.track?.data);
}

let saveTimer = 0;
function scheduleSave() {
  app.ui?.setSaveState('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1200);
}
app.scheduleSave = scheduleSave;
let saveChain = Promise.resolve();
// saves are serialised: a request during a running save waits for it and then saves again
function saveNow() {
  clearTimeout(saveTimer);
  if (!app.ready) return Promise.resolve();
  saveChain = saveChain.then(async () => {
    try {
      if (app.shovelTool.state === 'settle' || app.shovelTool.state === 'dump') app.shovelTool.finish();
      await saveLocal(buildProject());
      app.ui?.setSaveState('saved');
    } catch (e) {
      console.error(e);
      app.ui?.setSaveState('error');
    }
  });
  return saveChain;
}
app.saveNow = saveNow;
// camera/tool track is saved periodically even without terrain edits
setInterval(() => { if (app.ready && !document.hidden) saveNow(); }, 20000);

app.exportProject = () => {
  app.shovelTool.finish();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  download(`tiny-craftsman-stage${STAGE}-${stamp}.json`, toJSON(buildProject()));
};

app.importProject = async (file) => {
  const p = fromJSON(await file.text());
  applyProject(p);
  app.marking.setRect(app.marking.rect);
  syncMarkUniform();
  applySettings();
  await saveNow();
};

app.newProject = async () => {
  app.shovelTool.abort();
  app.shovelTool.finish();
  await clearLocal();
  app.terrain.generate(7);
  app.particles.clearClods();
  app.journal.done = []; app.journal.undone = []; app.journal.pending = null; app.journal.nextId = 1;
  app.recorder.load(null);
  app.clock = 0;
  app.marking.setRect(DEFAULT_MARK);
  syncMarkUniform();
  app.ui.refresh();
  await saveNow();
};

main().catch((e) => {
  console.error(e);
  const sub = document.querySelector('#loading .sub');
  if (sub) sub.textContent = 'Ошибка запуска: ' + e.message;
});
