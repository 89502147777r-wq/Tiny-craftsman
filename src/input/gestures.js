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
    // the page hidden or left: no finger is on it any more
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    window.addEventListener('blur', () => this.reset());
  }

  // all fingers off: a stroke in progress ends as if lifted
  reset() {
    if (this.mode === 'tool') { try { this.app.activeTool()?.up(null, {}); } catch { /* the tool needed the point */ } this.app.ui?.refresh(); }
    this.ptrs.clear();
    this.mode = 'none';
    this.app.rig.held = false;
  }

  ndc(x, y) {
    const r = this.el.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  pick(x, y) {
    this.ray.setFromCamera(this.ndc(x, y), this.app.camera);
    return this.app.terrain.raycast(this.ray.ray);
  }
  // for the camera: the nearest thing under the finger — the masonry, the slabs, the roof … or
  // the ground (a wall up close in front of the ground)
  pickAll(x, y) {
    const t = this.pick(x, y), w = this.app.wallView?.group;
    let best = t ? { point: t.point.clone(), distance: t.point.distanceTo(this.ray.ray.origin) } : null;
    if (w) {
      try {
        const h = this.ray.intersectObject(w, true).find((q) => q.object.visible !== false && !q.object.material?.transparent);
        if (h && (!best || h.distance < best.distance)) best = { point: h.point.clone(), distance: h.distance };
      } catch { /* a mesh without a position to test */ }
    }
    return best;
  }

  // ground point under the finger, or on a horizontal plane when off the soil
  ground(x, y, h = 0.1) {
    const hit = this.pick(x, y);
    if (hit) return hit.point;
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), p) ? p : null;
  }

  // the point a tool gets: the ground (or what lies on it) under the finger; with nothing there —
  // looking up at a wall under the eaves, behind a porch's pillars, at the sky over it — a point on
  // the ray as far off as what the camera looks at (the tools aiming by the ray itself — the facade,
  // the roof — work on, the stroke is not lost to the camera)
  point(x, y) { return this.ground(x, y) || (this.app.activeTool()?.aimsByRay?.() ? this.ray.ray.at(this.app.camera.position.distanceTo(this.app.rig.target), new THREE.Vector3()) : null); }

  down(e) {
    const app = this.app;
    app.sfx.unlock();
    try { this.el.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already released pointer */ }
    // the first finger of a new touch: whatever is still held is stale (iOS loses a pointerup
    // to a system gesture or an app switch — the next touch would be taken for a second finger)
    if (e.pointerType === 'touch' && e.isPrimary && this.ptrs.size) this.reset();
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button });
    if (this.ptrs.size === 2) {
      // second finger while the tool carries something it can turn (an empty pallet): it turns it
      // round its middle — the first finger keeps carrying
      const tt = app.activeTool();
      if (this.mode === 'tool' && tt?.twistable?.()) {
        const [first] = [...this.ptrs.keys()], f = this.ptrs.get(first);
        this.mode = 'twist'; this.tw = { id: e.pointerId, first, a: Math.atan2(e.clientY - f.y, e.clientX - f.x) };
        return;
      }
      // otherwise the second finger: a camera gesture
      if (this.mode === 'tool') {
        const t = app.activeTool();
        // fingers of a pinch land a few ms apart: a stroke that just started was not meant
        if (performance.now() - this.toolT0 < 250 && t?.abort) t.abort(); else t?.interrupt?.();
        app.ui.refresh();
      }
      this.mode = 'pinch';
      this.pinch = this.pinchState();
      // what is between the fingers: it stays under them (its depth for the pan, the point the
      // pinch zooms to); the twist and the spread count only past a small dead zone (two fingers
      // moving the picture always turn it a little)
      const s = this.pinch, a = this.pickAll(s.mx, s.my), cam = app.camera;
      this.anchor = a ? { p: a.point, depth: Math.max(0.01, a.point.clone().sub(cam.position).dot(cam.getWorldDirection(new THREE.Vector3()))) } : null;
      this.pinch0 = { d: s.d, a: s.a, twist: false, spread: false };
      app.rig.held = true;
      return;
    }
    if (this.ptrs.size > 2) return;
    if (e.pointerType === 'mouse' && e.button === 2) { this.mode = 'orbit'; return; }
    if (e.pointerType === 'mouse' && e.button === 1) { this.mode = 'pan'; return; }
    if (e.pointerType === 'mouse' && e.shiftKey) { this.mode = 'pan'; return; }
    const tool = app.activeTool();
    if (tool) {
      const p = this.point(e.clientX, e.clientY);
      if (p) app.lastPoint = p.clone();
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
      const s = this.pinchState(), q = this.pinch, z0 = this.pinch0, A = this.anchor;
      const wrap = (v) => (v > Math.PI ? v - Math.PI * 2 : v < -Math.PI ? v + Math.PI * 2 : v);
      if (!z0.spread && z0.d > 0 && Math.abs(Math.log(s.d / z0.d)) > 0.06) z0.spread = true;
      if (!z0.twist && Math.abs(wrap(s.a - z0.a)) > 0.12) z0.twist = true;
      if (z0.spread && q.d > 0 && s.d > 0) { const f = q.d / s.d; app.rig.zoomAt(f, A?.p); if (A) A.depth *= f; }
      app.rig.pan((s.mx - q.mx) / H, (s.my - q.my) / H, A?.depth);
      if (z0.twist) app.rig.orbit(-wrap(s.a - q.a), 0);
      this.pinch = s;
      return;
    }
    if (this.mode === 'twist') {
      const tw = this.tw, f = this.ptrs.get(tw.first), sc = this.ptrs.get(tw.id);
      if (e.pointerId === tw.first) { const g = this.ground(e.clientX, e.clientY); if (g) { app.activeTool()?.move(g, e); app.lastPoint = g.clone(); } }
      if (f && sc) {
        const a = Math.atan2(sc.y - f.y, sc.x - f.x); let d = a - tw.a; tw.a = a;
        if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
        app.activeTool()?.twist?.(-d);   // (clockwise on the screen: clockwise seen from above)
      }
      return;
    }
    if (this.mode === 'tool') {
      const g = this.point(e.clientX, e.clientY);
      if (g) { app.activeTool()?.move(g, e); app.lastPoint = g.clone(); }
      app.ui.moveMeasure(e.clientX, e.clientY);
    }
  }

  up(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    const app = this.app;
    const isTap = performance.now() - p.t0 < 350 && Math.hypot(p.x - p.x0, p.y - p.y0) < 14;
    if (this.mode === 'twist') {
      // the turning finger off: carrying goes on; the carrying finger off: it is put down
      if (e.pointerId === this.tw.id) { this.mode = 'tool'; return; }
      app.activeTool()?.up(this.ground(e.clientX, e.clientY), e);
      this.mode = 'hold'; app.ui.refresh();
      if (this.ptrs.size === 0) this.mode = 'none';
      return;
    }
    if (this.mode === 'tool') {
      app.activeTool()?.up(this.point(e.clientX, e.clientY), e);
      this.mode = 'none';
      app.ui.refresh();
    } else if (this.mode === 'orbit' && isTap && app.tool === 'camera') {
      const now = performance.now();
      if (now - this.lastTap.t < 380 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 40) {
        const hit = this.pickAll(p.x, p.y);
        if (hit) { app.rig.lookAtPoint(hit.point); app.focusPoint = null; }
        this.lastTap.t = 0;
      } else this.lastTap = { t: now, x: p.x, y: p.y };
    }
    if (this.ptrs.size < 2) this.app.rig.held = false;
    if (this.ptrs.size === 0) this.mode = 'none';
    else if (this.mode === 'pinch' && this.ptrs.size === 1) this.mode = 'hold'; // wait for all fingers up
  }

  pinchState() {
    const [a, b] = [...this.ptrs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ax: a.x, ay: a.y, bx: b.x, by: b.y };
  }
}
