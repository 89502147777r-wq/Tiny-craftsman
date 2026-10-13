// Global constants. All world units are metres: the diorama is a real-size
// object on a real-size workshop table, built at model scale 1:12.
export const BUILD = 1;
export const STAGE = 1;
export const MODEL_SCALE = 12;

export const TRAY = {
  inner: 0.30,        // inner side of the plywood tray (square)
  wall: 0.012,        // wall thickness
  height: 0.068,      // wall top above the table
  floor: 0.010,       // top of the tray bottom board (soil cannot go lower)
  soil: 0.056,        // natural ground level
};

export const TERRAIN_RES = 180; // cells per side (≈1.67 mm per cell)

// Soil mechanics (tangent of the angle at which material starts to slide).
export const REPOSE_LOOSE = Math.tan(37 * Math.PI / 180);  // freshly dug loose soil
export const REPOSE_NATIVE = Math.tan(78 * Math.PI / 180); // undisturbed cohesive ground

export const SHOVELS = {
  // 1:12 copies of a Russian штыковая (ЛКО) and совковая (ЛСП) shovel.
  spade: { name: 'Штыковая', width: 0.0175, length: 0.024, capacity: 2.6e-6, pointed: true },
  scoop: { name: 'Совковая', width: 0.0225, length: 0.026, capacity: 4.2e-6, pointed: false },
};

export const DEFAULT_SETTINGS = {
  shovel: 'spade',
  bite: 5,          // mm the blade goes in per pass
  target: 15,       // design depth of the pit, mm (model)
  dof: 1,
  quality: 'high',
  shake: true,
  sound: true,
  level: false,
};

export const DEFAULT_MARK = { x0: -0.075, z0: -0.06, x1: 0.075, z1: 0.06 };
