import * as THREE from 'three';

// Touch-first input:
//   1 finger  → current tool (shovel / stakes) or orbit in camera mode
//   2 fingers → pinch = zoom, drag = orbit, always (any tool)
//   double tap in camera mode → focus & centre on that spot
// Mouse: left = tool, right/middle = orbit, wheel = zoom, shift+drag = pan.
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

  pick(x, y) {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.app.camera);
    return this.app.terrain.raycast(this.ray.ray);
  }

  // where the finger points on a horizontal plane (used when dragging past the soil)
  pickPlane(x, y, h) {
    const hit = this.pick(x, y);
    if (hit) return hit.point;
    const p = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
    return this.ray.ray.intersectPlane(plane, p) ? p : null;
  }

  down(e) {
    const app = this.app;
    app.sfx.unlock();
    this.el.setPointerCapture?.(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button, shift: e.shiftKey });
    if (this.ptrs.size === 2) {
      // second finger: always a camera gesture
      if (this.mode === 'tool') {
        // fingers of a pinch land a few ms apart: a dig that just started was not meant
        if (performance.now() - this.toolT0 < 250) { this.app.shovelTool.abort(); this.app.ui.refresh(); } else this.endTool(true);
      }
      this.mode = 'pinch';
      this.pinch = this.pinchState();
      return;
    }
    if (this.ptrs.size > 2) return;
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) { this.mode = 'orbit'; return; }
    if (e.pointerType === 'mouse' && e.shiftKey) { this.mode = 'pan'; return; }
    const tool = app.tool;
    if (tool === 'camera') { this.mode = 'orbit'; return; }
    if (tool === 'shovel') {
      const hit = this.pick(e.clientX, e.clientY);
      const st = app.shovelTool.state;
      if (st === 'loaded') {
        const p = hit ? hit.point : this.pickPlane(e.clientX, e.clientY, 0.05);
        if (p) { app.shovelTool.down(p); this.mode = 'tool'; this.toolT0 = performance.now(); }
        return;
      }
      if (hit && (st === 'idle')) { app.shovelTool.down(hit.point); this.mode = 'tool'; this.toolT0 = performance.now(); app.ui.refresh(); return; }
      if (st !== 'idle') { this.mode = 'none'; return; }
      this.mode = 'orbit';
      return;
    }
    if (tool === 'mark') {
      const hit = this.pick(e.clientX, e.clientY);
      const i = hit ? app.marking.pick(hit.point.x, hit.point.z, 0.022) : -1;
      if (i >= 0) {
        this.mode = 'stake';
        this.stake = i;
        this.stakeBefore = { ...app.marking.rect };
        app.marking.highlight = i;
        app.marking.update(true);
        app.ui.showMeasure(e.clientX, e.clientY);
        return;
      }
      this.mode = 'orbit';
    }
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
      const s = this.pinchState();
      if (this.pinch.d > 0 && s.d > 0) app.rig.zoom(this.pinch.d / s.d);
      app.rig.orbit((s.mx - this.pinch.mx) / H * 2.6, (s.my - this.pinch.my) / H * 2.0);
      this.pinch = s;
      return;
    }
    if (this.mode === 'tool') {
      const hit = app.shovelTool.state === 'aim' ? this.pickPlane(e.clientX, e.clientY, 0.05) : this.pick(e.clientX, e.clientY)?.point;
      if (hit) app.shovelTool.move(hit);
      return;
    }
    if (this.mode === 'stake') {
      const hit = this.pickPlane(e.clientX, e.clientY, 0.055);
      if (hit) {
        app.marking.moveCorner(this.stake, hit.x, hit.z);
        app.syncMarkUniform();
        app.ui.showMeasure(e.clientX, e.clientY);
      }
    }
  }

  up(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    const app = this.app;
    const isTap = performance.now() - p.t0 < 280 && Math.hypot(p.x - p.x0, p.y - p.y0) < 10;
    if (this.mode === 'tool') { this.endTool(false); }
    else if (this.mode === 'stake') {
      app.marking.highlight = -1;
      app.marking.update(true);
      app.ui.hideMeasure();
      const b = this.stakeBefore, a = { ...app.marking.rect };
      if (b.x0 !== a.x0 || b.x1 !== a.x1 || b.z0 !== a.z0 || b.z1 !== a.z1) app.journal.record('mark', b, a, app.clock);
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

  endTool(interrupted) {
    const st = this.app.shovelTool;
    if (interrupted) st.interrupt(); else st.up();
    this.mode = 'none';
    this.app.ui.refresh();
  }

  pinchState() {
    const [a, b] = [...this.ptrs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
}
