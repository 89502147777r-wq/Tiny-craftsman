import * as THREE from 'three';

// Touch-first input:
//   1 finger  → the active tool (shovel, marking, formwork, rebar, excavator);
//               if the tool does not take it, it orbits the camera (turn + tilt)
//   2 fingers → the plot follows the fingers (any tool, any zoom):
//               drag = move over the plot, pinch = zoom, twist = turn around
//   double tap in camera mode → focus & centre on that spot
// Mouse: left = tool, right = orbit, middle or shift+drag = pan, wheel = zoom.
// A tool receives down(p, e) → true if it takes the gesture, move(p, e),
// up(p, e) and interrupt() (a second finger arrived).
export class Gestures {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.ptrs = new Map();
    this.mode = 'none';
    this.ray = new THREE.Raycaster();
    this.lastTap = { t: 0, x: 0, y: 0 };
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { e.preventDefault(); app.rig.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    // iOS Safari page zoom / bounce
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.target === el) e.preventDefault(); }, { passive: false });
  }

  ndc(x, y) {
    const r = this.el.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  pick(x, y) {
    this.ray.setFromCamera(this.ndc(x, y), this.app.camera);
    return this.app.terrain.raycast(this.ray.ray);
  }

  // ground point under the finger, or on a horizontal plane when off the soil
  ground(x, y, h = 0.1) {
    const hit = this.pick(x, y);
    if (hit) return hit.point;
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), p) ? p : null;
  }

  down(e) {
    const app = this.app;
    app.sfx.unlock();
    try { this.el.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already released pointer */ }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button });
    if (this.ptrs.size === 2) {
      // second finger: always a camera gesture
      if (this.mode === 'tool') {
        const t = app.activeTool();
        // fingers of a pinch land a few ms apart: a stroke that just started was not meant
        if (performance.now() - this.toolT0 < 250 && t?.abort) t.abort(); else t?.interrupt?.();
        app.ui.refresh();
      }
      this.mode = 'pinch';
      this.pinch = this.pinchState();
      return;
    }
    if (this.ptrs.size > 2) return;
    if (e.pointerType === 'mouse' && e.button === 2) { this.mode = 'orbit'; return; }
    if (e.pointerType === 'mouse' && e.button === 1) { this.mode = 'pan'; return; }
    if (e.pointerType === 'mouse' && e.shiftKey) { this.mode = 'pan'; return; }
    const tool = app.activeTool();
    if (tool) {
      const p = this.ground(e.clientX, e.clientY);
      if (p && tool.down(p, e)) {
        this.mode = 'tool';
        this.toolT0 = performance.now();
        app.ui.refresh();
        return;
      }
      if (tool.blocksOrbit?.()) { this.mode = 'none'; return; }
    }
    this.mode = 'orbit';
  }

  move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const app = this.app;
    const H = this.el.clientHeight || 800;
    if (this.mode === 'orbit') { app.rig.orbit(dx / H * 3.2, dy / H * 2.4); return; }
    if (this.mode === 'pan') { app.rig.pan(dx / H, dy / H); return; }
    if (this.mode === 'pinch' && this.ptrs.size >= 2) {
      // the ground follows the fingers: midpoint drag = move over the plot,
      // spread = zoom, twist = turn around
      const s = this.pinchState(), q = this.pinch;
      if (q.d > 0 && s.d > 0) app.rig.zoom(q.d / s.d);
      let da = s.a - q.a;
      if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      app.rig.pan((s.mx - q.mx) / H, (s.my - q.my) / H);
      app.rig.orbit(-da, 0);
      this.pinch = s;
      return;
    }
    if (this.mode === 'tool') {
      const g = this.ground(e.clientX, e.clientY);
      if (g) app.activeTool()?.move(g, e);
      app.ui.moveMeasure(e.clientX, e.clientY);
    }
  }

  up(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    const app = this.app;
    const isTap = performance.now() - p.t0 < 280 && Math.hypot(p.x - p.x0, p.y - p.y0) < 10;
    if (this.mode === 'tool') {
      app.activeTool()?.up(this.ground(e.clientX, e.clientY), e);
      this.mode = 'none';
      app.ui.refresh();
    } else if (this.mode === 'orbit' && isTap && app.tool === 'camera') {
      const now = performance.now();
      if (now - this.lastTap.t < 330 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30) {
        const hit = this.pick(p.x, p.y);
        if (hit) { app.rig.lookAtPoint(hit.point); app.focusPoint = null; }
        this.lastTap.t = 0;
      } else this.lastTap = { t: now, x: p.x, y: p.y };
    }
    if (this.ptrs.size === 0) this.mode = 'none';
    else if (this.mode === 'pinch' && this.ptrs.size === 1) this.mode = 'hold'; // wait for all fingers up
  }

  pinchState() {
    const [a, b] = [...this.ptrs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ax: a.x, ay: a.y, bx: b.x, by: b.y };
  }
}
