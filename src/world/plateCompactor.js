import * as THREE from 'three';

// A walk-behind plate compactor of the 60–90 kg class (the size of a Wacker Neuson
// VP 1550 / Ammann APF 15/50), modelled in real millimetres and scaled to the
// model (1:3.5). Local frame: x across, y up, z forward (the travel direction);
// the origin is under the middle of the base plate.
//   lower  – base plate with the turned-up nose, side skirts, the exciter (shakes hard)
//   upper  – rubber mounts, frame, belt guard, engine, roll cage (shakes a little)
//   handle – guide handle on rubber dampers (almost still)
const S = 1 / 1000 / 3.5;   // real mm → model m

export function makePlateCompactor() {
  const root = new THREE.Group();
  root.name = 'plate-compactor';
  const M = {
    plate: new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.55, metalness: 0.7 }),
    worn: new THREE.MeshStandardMaterial({ color: 0x8d8f91, roughness: 0.35, metalness: 0.9 }),   // the bottom edge, polished by the ground
    orange: new THREE.MeshStandardMaterial({ color: 0xe8870e, roughness: 0.45, metalness: 0.15 }),
    black: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.9 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.45, metalness: 0.8 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.4, metalness: 0.1 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6b6e72, roughness: 0.4, metalness: 0.85 }),
  };
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), mat); m.position.set(x * S, y * S, z * S); return m; };
  const cyl = (r, len, mat, x, y, z, axis = 'x', seg = 20) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * S, r * S, len * S, seg), mat);
    m.position.set(x * S, y * S, z * S);
    if (axis === 'x') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  };
  const tube = (pts, r, mat, closed = false) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x * S, y * S, z * S)), closed, 'catmullrom', 0.2), pts.length * 12, r * S, 8, closed), mat);

  // ---- lower mass: base plate 450 × 550, 12 mm, nose turned up over 90 mm ----------
  const lower = new THREE.Group();
  const W = 450, L = 550;
  {
    // side profile of the plate (z, y), extruded across the width
    const p = new THREE.Shape();
    p.moveTo(-L / 2, 0); p.lineTo(L / 2 - 90, 0);
    p.quadraticCurveTo(L / 2 - 10, 0, L / 2, 55);            // the nose: runs over the material instead of digging in
    p.lineTo(L / 2 - 12, 58); p.quadraticCurveTo(L / 2 - 22, 12, L / 2 - 92, 12);
    p.lineTo(-L / 2 + 25, 12); p.quadraticCurveTo(-L / 2 + 5, 12, -L / 2, 30);   // a slight lift at the back too
    p.lineTo(-L / 2 - 6, 26); p.quadraticCurveTo(-L / 2, 2, -L / 2 + 20, 0);
    const g = new THREE.ExtrudeGeometry(p, { depth: W, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -W / 2); g.rotateY(-Math.PI / 2); g.scale(S, S, S);
    const plate = new THREE.Mesh(g, M.plate);
    lower.add(plate);
    // the polished wear strip at the bottom
    lower.add(box(W - 4, 2, L - 120, M.worn, 0, 0.5, -20));
    // side skirts (stiffening walls along both sides)
    for (const sx of [-1, 1]) lower.add(box(10, 45, L - 110, M.plate, sx * (W / 2 - 5), 34, -15));
    // cross ribs
    for (const z of [-170, 40]) lower.add(box(W - 20, 30, 10, M.plate, 0, 27, z));
    // exciter: a cylinder across the plate, front half, with its end caps and bolts
    lower.add(cyl(68, W - 70, M.plate, 0, 82, 80));
    for (const sx of [-1, 1]) {
      lower.add(cyl(76, 18, M.black, sx * (W / 2 - 44), 82, 80));
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; lower.add(cyl(5, 8, M.steel, sx * (W / 2 - 32), 82 + Math.sin(a) * 58, 80 + Math.cos(a) * 58, 'x', 6)); }
    }
    // exciter pulley
    lower.add(cyl(48, 22, M.black, -(W / 2 - 18), 82, 80));
  }
  root.add(lower);

  // ---- upper mass on four rubber mounts ----------------------------------------------
  const upper = new THREE.Group();
  {
    // rubber buffers between the plate and the engine plate
    for (const [x, z] of [[-150, -150], [150, -150], [-150, 175], [150, 175]]) {
      upper.add(cyl(28, 40, M.rubber, x, 62, z, 'y', 14));
      upper.add(cyl(32, 6, M.steel, x, 85, z, 'y', 14));
    }
    // engine base plate (frame)
    upper.add(box(380, 10, 440, M.black, 0, 92, 10));
    // belt guard on the left: a long orange cover from the engine pulley down to the exciter
    upper.add(box(36, 170, 330, M.orange, -(W / 2 - 12), 150, 25));
    upper.add(cyl(85, 36, M.orange, -(W / 2 - 12), 150, 175));
    // engine (Honda GX160 class): crankcase, cylinder slanted, tank, air cleaner, muffler, recoil starter
    const eng = new THREE.Group();
    eng.add(box(250, 150, 230, M.alu, 0, 172, -10));                          // crankcase
    eng.add(box(130, 120, 150, M.alu, 70, 250, -40));                          // cylinder + head
    for (let k = 0; k < 6; k++) eng.add(box(134, 4, 154, M.alu, 70, 205 + k * 16, -40));   // cooling fins
    eng.add(box(230, 85, 150, M.red, -10, 320, 55));                           // fuel tank
    eng.add(cyl(26, 20, M.black, 60, 370, 85, 'y', 16));                      // filler cap
    eng.add(box(150, 110, 85, M.black, 85, 265, 105));                         // air cleaner
    eng.add(box(110, 90, 110, M.black, 120, 210, -150));                       // muffler
    eng.add(box(114, 70, 114, M.steel, 120, 212, -150).translateZ(2 * S));     // its heat shield (perforated look via the colour)
    eng.add(cyl(95, 50, M.red, -150, 210, -10));                               // recoil starter housing (fan cover)
    eng.add(box(30, 14, 14, M.black, -186, 250, -10));                         // the pull handle
    eng.add(box(20, 40, 30, M.black, 40, 330, -40));                           // throttle body / choke lever
    eng.add(box(110, 35, 30, M.white, -10, 300, 135));                         // label plate on the tank
    eng.position.y = 0;
    upper.add(eng);
    // roll cage: a tubular hoop over the engine with a lifting eye at the top
    upper.add(tube([[-185, 95, -200], [-185, 330, -200], [-150, 420, -100], [0, 445, 0], [150, 420, -100], [185, 330, -200], [185, 95, -200]], 13, M.orange));
    upper.add(tube([[-185, 95, 215], [-185, 300, 215], [-160, 395, 120], [0, 420, 30], [160, 395, 120], [185, 300, 215], [185, 95, 215]], 13, M.orange));
    upper.add(tube([[0, 445, 0], [0, 420, 30]], 13, M.orange));
    const eye = new THREE.Mesh(new THREE.TorusGeometry(26 * S, 8 * S, 8, 16), M.orange);
    eye.position.set(0, 470 * S, 10 * S);
    upper.add(eye);
    // handle bracket at the back with its rubber dampers
    upper.add(box(260, 60, 40, M.black, 0, 125, -235));
    for (const sx of [-1, 1]) upper.add(cyl(24, 40, M.rubber, sx * 110, 140, -255, 'x', 12));
  }
  root.add(upper);

  // ---- guide handle (folds; here in the working position, ~40° up) -------------------
  const handle = new THREE.Group();
  {
    const a = (40 * Math.PI) / 180, len = 950;
    const dz = -Math.cos(a) * len, dy = Math.sin(a) * len;
    for (const sx of [-1, 1]) handle.add(tube([[sx * 140, 140, -255], [sx * 150, 140 + dy * 0.5, -255 + dz * 0.5], [sx * 170, 140 + dy, -255 + dz]], 14, M.black));
    // the grip bar with its rubber sleeve, and a cross brace
    handle.add(tube([[-190, 140 + dy, -255 + dz], [190, 140 + dy, -255 + dz]], 15, M.black));
    handle.add(cyl(21, 300, M.rubber, 0, 140 + dy, -255 + dz));
    handle.add(tube([[-148, 140 + dy * 0.45, -255 + dz * 0.45], [148, 140 + dy * 0.45, -255 + dz * 0.45]], 11, M.black));
    // throttle lever on the right grip, with its cable down to the engine
    handle.add(box(20, 14, 80, M.red, 150, 140 + dy + 25, -255 + dz + 30));
    handle.add(tube([[150, 140 + dy + 20, -255 + dz + 50], [120, 140 + dy * 0.5, -255 + dz * 0.5 + 40], [50, 330, -60]], 3.5, M.black));
  }
  root.add(handle);

  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  root.userData = { lower, upper, handle };
  return root;
}

// shake it: the plate hard, the engine on its mounts less, the handle hardly
export function shakePlateCompactor(root, on, t) {
  const { lower, upper, handle } = root.userData;
  const k = on ? 1 : 0;
  const ph = t * 95;   // ~ 95 Hz exciter, sampled per frame: looks like a buzz
  lower.position.set(Math.sin(ph * 1.3) * 0.6 * S * k, Math.abs(Math.sin(ph)) * 2.2 * S * k, Math.cos(ph * 0.7) * 0.8 * S * k);
  upper.position.set(Math.sin(ph * 1.7) * 0.4 * S * k, Math.abs(Math.sin(ph + 1)) * 0.9 * S * k, 0);
  handle.position.y = Math.sin(ph * 0.9) * 0.25 * S * k;
}
