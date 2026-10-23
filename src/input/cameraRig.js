import * as THREE from 'three';

// Orbiting "macro lens on a slider" camera. Spherical coordinates around a
// target on the diorama, smoothed, with an optional hand-held breathing
// motion so the footage feels like a real phone/camera shot.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0.1, 0.1);
    this.yaw = 0.42; this.pitch = 0.36; this.dist = 1.5;
    this.goal = { target: this.target.clone(), yaw: this.yaw, pitch: this.pitch, dist: this.dist };
    this.limits = { minDist: 0.035, maxDist: 4, minPitch: 0.08, maxPitch: 1.5, boxX: 1.5, boxZ: 1.2 };
    this.shake = true;
    this.t = 0;
    this.focusGoal = 0.36;
    this.focus = 0.36;
  }

  orbit(dx, dy) {
    this.goal.yaw -= dx;
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy, this.limits.minPitch, this.limits.maxPitch);
  }

  zoom(f) {
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * f, this.limits.minDist, this.limits.maxDist);
  }

  // slide the target over the plot so the ground follows the fingers
  // (dx, dy in screen heights); works at any zoom
  pan(dx, dy) {
    const yaw = this.goal.yaw;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    // visible ground height at the target ≈ 2·dist·tan(fov/2), foreshortened by the pitch
    const h = 2 * this.goal.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // in the plane of the screen: across — sideways, up / down — along the camera's own up
    // (from above that is over the ground, from low down it is up the picture), so the
    // picture follows the fingers both ways alike (not a dolly in and out)
    const p = this.goal.pitch, up = new THREE.Vector3(0, Math.cos(p), 0).addScaledVector(fwd, Math.sin(p));
    this.goal.target.addScaledVector(right, -dx * h).addScaledVector(up, dy * h);
    this.clampTarget();
  }

  clampTarget() {
    const g = this.goal.target, l = this.limits;
    g.x = THREE.MathUtils.clamp(g.x, -l.boxX, l.boxX);
    g.z = THREE.MathUtils.clamp(g.z, -l.boxZ, l.boxZ);
    g.y = THREE.MathUtils.clamp(g.y, -0.25, 1.5);
  }

  lookAtPoint(p) { this.goal.target.copy(p); this.clampTarget(); }

  update(dt) {
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goal.target, k);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.dist += (this.goal.dist - this.dist) * k;
    if (this.live !== false) this.t += dt;   // (still while the picture is drawn twice a second: it would jump)
    const cam = this.camera;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // never dip below the table top, never out of the panorama's sphere
    cam.position.y = Math.max(cam.position.y, 0.012);
    const l = this.limits, R = Math.hypot(cam.position.x, cam.position.y, cam.position.z);
    if (l.sphere && R > l.sphere) cam.position.multiplyScalar(l.sphere / R);
    const look = this.target.clone();
    if (this.shake) {
      const t = this.t, a = this.dist * 0.0028;
      cam.position.x += a * (Math.sin(t * 0.93) * 0.6 + Math.sin(t * 2.11 + 1) * 0.25);
      cam.position.y += a * (Math.sin(t * 1.27 + 2) * 0.5 + Math.sin(t * 2.71) * 0.2);
      look.x += a * 0.5 * Math.sin(t * 0.71 + 4);
      look.y += a * 0.5 * Math.sin(t * 1.13 + 3);
    }
    cam.lookAt(look);
    this.focus += (this.focusGoal - this.focus) * (1 - Math.exp(-dt * 6));
  }

  state() {
    return { target: this.goal.target.toArray(), yaw: this.goal.yaw, pitch: this.goal.pitch, dist: this.goal.dist };
  }

  setState(s, snap = true) {
    if (!s) return;
    this.goal.target.fromArray(s.target); this.goal.yaw = s.yaw; this.goal.pitch = s.pitch; this.goal.dist = s.dist;
    if (snap) { this.target.copy(this.goal.target); this.yaw = s.yaw; this.pitch = s.pitch; this.dist = s.dist; }
  }
}
