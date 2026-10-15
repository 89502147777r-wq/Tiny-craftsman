// Global constants. All world units are metres: the diorama is a real-size
// object on a real-size workshop table, built at model scale 1:3.5.
export const BUILD = 16;
export const STAGE = 3;
export const MODEL_SCALE = 3.5;
// Many sizes were first designed at 1:12; K = how much bigger everything built
// on the plot is now (shovel, pegs, string line, boards, bars, crumbs …).
export const K = 12 / MODEL_SCALE;
// machines are switched off for now (they cost a lot of video memory on phones)
export const MACHINES_ENABLED = false;

// Diorama board: 2.4 × 1.8 m inside = an 8.4 × 6.3 m building plot at 1:3.5.
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
  soil: 0.100,        // natural ground level (90 mm of soil = 31.5 cm at 1:3.5)
};

// size of one soil photo tile on the table (the sand is real sand of the
// diorama, so this does not follow the model scale)
export const SOIL_TILE = 0.207;
export const LOAM_TILE = 0.175;

export const TERRAIN_CELL = 0.003; // 800 × 600

// Soil mechanics (tangent of the angle at which material starts to slide).
export const REPOSE_LOOSE = Math.tan(37 * Math.PI / 180);  // freshly dug loose soil
export const REPOSE_NATIVE = Math.tan(78 * Math.PI / 180); // undisturbed cohesive ground

export const SHOVELS = {
  // scale copies of a Russian штыковая (ЛКО) and совковая (ЛСП) shovel
  // (blade 21 × 29 cm and 27 × 31 cm real; capacity in m³ of the model)
  spade: { name: 'Штыковая', width: 0.0175 * K, length: 0.024 * K, capacity: 2.6e-6 * K ** 3, pointed: true },
  scoop: { name: 'Совковая', width: 0.0225 * K, length: 0.026 * K, capacity: 4.2e-6 * K ** 3, pointed: false },
};

// garden rake (грабли): head 32 cm with 14 tines 7 cm long, handle 1.4 m — sizes of
// the model; how it moves soil is tuned in Terrain.rakeStep
export const RAKE = {
  width: 0.027 * K, tines: 14, tineLen: 0.0058 * K, handle: 0.115 * K,
  bite: 0.0006,      // m the tines go below the line the head rests on
  climb: 0.18,       // how steeply the pulled head may rise (it bites into a heap)
  push: 0.55,        // share of the soil above the line that goes along with the head
  groove: 0.00035,   // depth of the furrows the tines leave
};

export const DEFAULT_SETTINGS = {
  shovel: 'spade',
  bite: 12,         // mm the blade goes in per pass
  target: 75,       // design depth of the pit, mm (model) = 6 passes of the shovel, 26 cm real
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
  trenchWidth: 300,  // new trench width, mm (real)
  trenchDepth: 250,  // new trench depth, mm (real) — the box holds 31 cm of soil
  backdrop: 'site',
  orbit: false,      // slow automatic camera fly-around (панорама)
  quiet: false,      // quiet mode: one round button instead of the panels (for filming)
};

// the first outline on a new plot: a 2.6 × 2.1 m slab pit, 75 mm (26 cm) deep
export const DEFAULT_OUTLINES = [{ id: 1, kind: 'rect', x0: -0.375, z0: -0.2, x1: 0.375, z1: 0.4, depth: 75 }];

// where the machines wait, along the back edge of the plot (x, z, yaw)
export const PARKING = { excavator: [-0.85, -0.68, -Math.PI / 2], tractor: [-0.42, -0.7, -Math.PI / 2], mixer: [0.2, -0.72, 0], pump: [0.82, -0.7, 0], siteMixer: [1.02, -0.3, 0.4] };

// Construction materials, real sizes converted to the model.
export const MAT = {
  board: { t: 0.025 / MODEL_SCALE, h: 0.15 / MODEL_SCALE },      // 25 × 150 mm formwork board
  stake: { s: 0.05 / MODEL_SCALE, step: 0.8 / MODEL_SCALE },     // 50 × 50 mm stakes every 0.8 m
  rebarD: [8, 10, 12, 14],                                       // available bar diameters, mm (real)
  meshCell: 0.1 / MODEL_SCALE, meshD: 0.004 / MODEL_SCALE,       // welded mesh 100 × 100, Ø4
};
