import * as THREE from 'three';

// Orbiting "macro lens on a slider" camera. Spherical coordinates around a
// target on the diorama, smoothed, with an optional hand-held breathing
// motion so the footage feels like a real phone/camera shot.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0.09, 0);
    this.yaw = 0.42; this.pitch = 0.6; this.dist = 0.78;
    this.goal = { target: this.target.clone(), yaw: this.yaw, pitch: this.pitch, dist: this.dist };
    this.limits = { minDist: 0.06, maxDist: 1.2, minPitch: 0.1, maxPitch: 1.45, box: 0.42 };
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

  // pan in the camera's screen plane, scaled by distance
  pan(dx, dy) {
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const fwd = new THREE.Vector3(Math.sin(this.goal.yaw), 0, Math.cos(this.goal.yaw)).negate();
    const k = this.goal.dist;
    this.goal.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
    const b = this.limits.box;
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -b, b);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, -b, b);
  }

  lookAtPoint(p) { this.goal.target.copy(p); }

  update(dt) {
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goal.target, k);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.dist += (this.goal.dist - this.dist) * k;
    this.t += dt;
    const cam = this.camera;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // never dip below the table top
    cam.position.y = Math.max(cam.position.y, 0.012);
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
