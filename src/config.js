// Global constants. All world units are metres: the diorama is a real-size
// object on a real-size workshop table, built at model scale 1:12.
export const BUILD = 7;
export const STAGE = 3;
export const MODEL_SCALE = 12;

// Diorama board: 2.4 × 1.8 m inside = a 28.8 × 21.6 m building plot at 1:12:
// room for the house, the machines parked along the back edge and a truck.
// Photo backdrop, as on the real table: one continuous sheet glued to the
// outside of the box along two sides that meet at a rounded corner
// (sx, sz = which corner: -x left, -z far side). Side 1 = the left side
// (crane photo), side 2 = the far side (billboard); `first` = the axis side 1
// runs along. The photos blend over the rounded corner, so there is no seam.
export const BACKDROP = { sx: -1, sz: -1, first: 'z', radius: 0.24, height: 1.35 };

export const TRAY = {
  innerX: 2.4,        // inner size of the plywood tray along X
  innerZ: 1.8,        // … and along Z
  wall: 0.018,        // wall thickness
  height: 0.106,      // wall top above the table
  floor: 0.010,       // top of the tray bottom board (soil cannot go lower)
  soil: 0.100,        // natural ground level (90 mm of soil = 1.08 m)
};

// real size of one soil photo tile at 1:12 (Poly Haven: gravelly_sand covers 2.48 m, forest_ground_06 2.1 m)
export const SOIL_TILE = 2.48 / 12;
export const LOAM_TILE = 2.1 / 12;

export const TERRAIN_CELL = 0.003; // 800 × 600

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
  target: 25,       // design depth of the pit, mm (model)
  dof: 1,
  quality: 'high',
  shake: true,
  sound: true,
  level: false,
  stopAtGrade: true, // the shovel stops at the design depth inside the outline
  slab: 200,         // slab / strip height above the pit floor, mm (real)
  rebarD: 12,        // bar diameter, mm (real)
  rebarStep: 200,    // bar spacing, mm (real)
  cover: 40,         // concrete cover, mm (real)
  trenchWidth: 400,  // new trench width, mm (real)
  trenchDepth: 600,  // new trench depth, mm (real)
  backdrop: 'site',
  orbit: false,      // slow automatic camera fly-around (панорама)
};

// the first outline on a new plot: a 9 × 7.2 m house pit, 25 mm (30 cm) deep
export const DEFAULT_OUTLINES = [{ id: 1, kind: 'rect', x0: -0.375, z0: -0.2, x1: 0.375, z1: 0.4, depth: 25 }];

// where the machines wait, along the back edge of the plot (x, z, yaw)
export const PARKING = { excavator: [-0.85, -0.68, -Math.PI / 2], tractor: [-0.42, -0.7, -Math.PI / 2], mixer: [0.2, -0.72, 0], pump: [0.82, -0.7, 0], siteMixer: [1.02, -0.3, 0.4] };

// Construction materials, real sizes converted to the model (÷12).
export const MAT = {
  board: { t: 0.025 / 12, h: 0.15 / 12 },          // 25 × 150 mm formwork board
  stake: { s: 0.05 / 12, step: 0.8 / 12 },         // 50 × 50 mm stakes every 0.8 m
  rebarD: [8, 10, 12, 14],                         // available bar diameters, mm (real)
  meshCell: 0.1 / 12, meshD: 0.004 / 12,           // welded mesh 100 × 100, Ø4
};
