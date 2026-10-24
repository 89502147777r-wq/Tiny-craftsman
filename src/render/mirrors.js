import * as THREE from 'three';

// Rear-view mirrors over the picture (the cab view of a machine): each one a small camera looking
// back from where the mirror is, drawn into its own texture and laid over the screen flipped left
// to right, as a mirror shows it. One mirror is drawn afresh a frame, in turn (they are small; the
// picture in them a frame or two old is not seen).
const RT_W = 320;

export class Mirrors {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.list = [];
    this.turn = 0;
  }
  // defs: [{ rect: [x, y, w, h] (share of the screen from its top left), round }] — or none: hidden
  set(defs) {
    const n = defs?.length || 0;
    while (this.list.length > n) { const m = this.list.pop(); this.scene.remove(m.frame, m.quad); m.rt.dispose(); m.quad.material.dispose(); }
    while (this.list.length < n) {
      const rt = new THREE.WebGLRenderTarget(RT_W, RT_W / 2, { type: THREE.HalfFloatType });
      const map = rt.texture; map.wrapS = THREE.RepeatWrapping; map.repeat.x = -1;   // (flipped: a mirror)
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map, depthTest: false, depthWrite: false }));
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, depthWrite: false }));
      frame.renderOrder = 1; quad.renderOrder = 2;
      this.scene.add(frame, quad);
      this.list.push({ rt, quad, frame, cam: new THREE.PerspectiveCamera(32, 2, 0.008, 40), fresh: false });
    }
    defs?.forEach((d, k) => { this.list[k].rect = d.rect; });
  }
  get on() { return this.list.length > 0; }
  // where each looks from: { pos, dir } in the world (called each frame by whoever owns them)
  aim(k, pos, dir) { const m = this.list[k]; if (!m) return; m.cam.position.copy(pos); m.cam.lookAt(pos.clone().add(dir)); }
  render(scene) {
    if (!this.list.length) return;
    const r = this.renderer, size = r.getSize(new THREE.Vector2()), W = size.x, H = size.y;
    // (one fresh picture a frame, in turn — all of them at first)
    const draw = this.list.some((m) => !m.fresh) ? this.list.filter((m) => !m.fresh) : [this.list[this.turn++ % this.list.length]];
    const keep = r.getRenderTarget(), auto = r.autoClear, sh = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    for (const m of draw) {
      const [, , w, h] = m.rect, aspect = (w * W) / (h * H);
      if (Math.abs(m.cam.aspect - aspect) > 1e-3) { m.cam.aspect = aspect; m.cam.updateProjectionMatrix(); m.rt.setSize(RT_W, Math.max(32, Math.round(RT_W / aspect))); }
      r.setRenderTarget(m.rt); r.autoClear = true; r.render(scene, m.cam); m.fresh = true;
    }
    // laid over the picture: the frame a little bigger than the glass
    for (const m of this.list) {
      const [x, y, w, h] = m.rect, cx = x + w / 2, cy = 1 - (y + h / 2), bx = 4 / W, by = 4 / H;
      m.quad.position.set(cx, cy, 0); m.quad.scale.set(w, h, 1);
      m.frame.position.set(cx, cy, 0); m.frame.scale.set(w + bx * 2, h + by * 2, 1);
    }
    r.setRenderTarget(null); r.autoClear = false;
    r.render(this.scene, this.cam);
    r.setRenderTarget(keep); r.autoClear = auto; r.shadowMap.autoUpdate = sh;
  }
}
