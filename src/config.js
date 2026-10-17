// Global constants. All world units are metres: the diorama is a real-size
// object on a real-size workshop table, built at model scale 1:10.47 (860 mm = 9 m).
export const BUILD = 44;
export const STAGE = 3;
export const MODEL_SCALE = 9000 / 860;   // 1:10.47 — 860 mm of the model is 9 m
// how much finer everything is than at the old 1:3.5 (texture sizes of stones, pores …)
export const RESCALE = MODEL_SCALE / 3.5;
// Many sizes were first designed at 1:12; K = how much bigger real things built on the
// plot are now (pegs, string line, boards …). KT is the size of the game tools — the
// shovel, the rake, the machines — and of the touch tolerances: they keep the size they
// had at 1:3.5 (a true-scale shovel would take thousands of passes for a house pit).
export const K = 12 / MODEL_SCALE;
export const KT = 12 / 3.5;
// machines are switched off for now (they cost a lot of video memory on phones)
export const MACHINES_ENABLED = false;

// Diorama board: 2.4 × 1.8 m inside = a 25 × 19 m building plot at 1:10.47.
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
  soil: 0.100,        // natural ground level (90 mm of soil = 0.94 m at 1:10.47)
};

// size of one soil photo tile on the table (the sand is real sand of the
// diorama, so this does not follow the model scale)
export const SOIL_TILE = 0.207;
export const LOAM_TILE = 0.175;

export const TERRAIN_CELL = 0.003; // 800 × 600

// Soil mechanics (tangent of the angle at which material starts to slide).
export const REPOSE_LOOSE = Math.tan(37 * Math.PI / 180);  // freshly dug loose soil
// loose materials (terrain layers). Repose = angle of a dry heap; tile = real size of
// the photo texture in the model (m); colour = average, for crumbs and the shovel load
export const MATERIALS = [
  { id: 'soil', name: 'Грунт', repose: Math.tan(37 * Math.PI / 180) },
  { id: 'sand', name: 'Песок', repose: Math.tan(33 * Math.PI / 180), tile: 1.8 / MODEL_SCALE, color: 0xc9a46a },
  { id: 'g5', name: 'Щебень 5–20', repose: Math.tan(37 * Math.PI / 180), tile: 1.0 / MODEL_SCALE, color: 0xa3a29e },   // tile: real metres per repeat of the photo
  { id: 'g20', name: 'Щебень 20–40', repose: Math.tan(39 * Math.PI / 180), tile: 2.6 / MODEL_SCALE, color: 0x86847f },   // stones ~2.5× those of 5–20
];
export const M_SOIL = 0, M_SAND = 1, M_G5 = 2, M_G20 = 3;
// deliveries (real m³ → model volume: ÷ scale³) — a tipper truck brings 3–10 m³ — and the
// wheelbarrow for exact work
export const DELIVERY = [1, 3, 5, 10];
export const BUCKET = 0.1;   // a 100 l wheelbarrow (real m³)

// fresh concrete (S4 slump): flows while its surface is steeper than `yield`, a share
// `rate` of the excess per pass (viscous, not like water); stiff after `stiff` of
// the curing time; `cure` = seconds of the project clock from wet dark to set light grey
// hc: concrete has a yield stress — a layer thinner than ~hc hardly moves, so a lump keeps
// its shape while a thick pour levels out (allowed slope = yield + hc / thickness)
// Fresh concrete as a Bingham (viscoplastic) fluid, real values for pumped concrete
// (S3–S4): yield stress tau (Pa) — below it the concrete stands like a heap; plastic
// viscosity mu (Pa·s) — how fast it flows above it; density rho. Vibration fluidises it
// (tau, mu drop to tauVib, muVib). It sets after `stiff` of `cure` seconds.
export const CONCRETE = { tau: 250, mu: 25, rho: 2400, tauVib: 2, muVib: 1.5, cure: 300, stiff: 0.35, color: 0x7d7b76 };
export const PUMP = [0.125, 0.3125, 0.625];   // pump hose delivery, real m³ per second (450 / 1125 / 2250 m³/h — 12.5 × a real pump, for the game)

export const REPOSE_NATIVE = Math.tan(78 * Math.PI / 180); // undisturbed cohesive ground

export const SHOVELS = {
  // scale copies of a Russian штыковая (ЛКО) and совковая (ЛСП) shovel
  // (blade 21 × 29 cm and 27 × 31 cm real; capacity in m³ of the model)
  spade: { name: 'Штыковая', width: 0.0175 * KT, length: 0.024 * KT, capacity: 2.6e-6 * KT ** 3, pointed: true },
  scoop: { name: 'Совковая', width: 0.0225 * KT, length: 0.026 * KT, capacity: 4.2e-6 * KT ** 3, pointed: false },
};

// garden rake (грабли): head 32 cm with 14 tines 7 cm long, handle 1.4 m — sizes of
// the model; how it moves soil is tuned in Terrain.rakeStep
export const RAKE = {
  width: 0.027 * KT, tines: 14, tineLen: 0.0058 * KT, handle: 0.115 * KT,
  bite: 0.0006,      // m the tines go below the line the head rests on
  climb: 0.18,       // how steeply the pulled head may rise (it bites into a heap)
  push: 0.55,        // share of the soil above the line that goes along with the head
  groove: 0.00035,   // depth of the furrows the tines leave
};

export const DEFAULT_SETTINGS = {
  shovel: 'spade',
  bite: 12,         // mm the blade goes in per pass
  target: 75,       // design depth of the pit, mm (model) = 6 passes of the shovel, 0.79 m real
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
  trenchWidth: 500,  // new trench width, mm (real)
  trenchDepth: 700,  // new trench depth, mm (real) — the box holds 0.94 m of soil
  backdrop: 'site',
  orbit: false,      // slow automatic camera fly-around (панорама)
  quiet: false,      // quiet mode: one round button instead of the panels (for filming)
  matMode: 'deliver', // sand / crushed stone: 'deliver' a heap or pour from a 'bucket'
  delivery: 3,       // size of a delivered heap, real m³
  pump: 0.3125,      // concrete pump hose, real m³/s
  wallTurn: false,   // a new wall: the other direction (along ↔ across)
  wallKind: 'block', // walls: 'block' (aerated concrete) | 'brick' … 'brick5' (½ … 2½ bricks)
  wallHeight: 1500,  // planned wall height, real mm
  openKind: 'window', // an opening being marked: 'window' | 'door'
};

// the first outline on a new plot: a 9 × 9 m slab pit, 75 mm (0.78 m) deep
export const DEFAULT_OUTLINES = [{ id: 1, kind: 'rect', x0: -0.43, z0: -0.33, x1: 0.43, z1: 0.53, depth: 75 }];   // a 9 × 9 m house

// where the machines wait, along the back edge of the plot (x, z, yaw)
export const PARKING = { excavator: [-0.85, -0.68, -Math.PI / 2], tractor: [-0.42, -0.7, -Math.PI / 2], mixer: [0.2, -0.72, 0], pump: [0.82, -0.7, 0], siteMixer: [1.02, -0.3, 0.4] };

// Construction materials, real sizes converted to the model.
export const MAT = {
  board: { t: 0.025 / MODEL_SCALE, h: 0.15 / MODEL_SCALE },      // 25 × 150 mm formwork board
  stake: { s: 0.05 / MODEL_SCALE, step: 0.8 / MODEL_SCALE },     // 50 × 50 mm stakes every 0.8 m
  rebarD: [8, 10, 12, 14],                                       // available bar diameters, mm (real)
  meshCell: 0.1 / MODEL_SCALE, meshD: 0.004 / MODEL_SCALE,       // welded mesh 100 × 100, Ø4
};
