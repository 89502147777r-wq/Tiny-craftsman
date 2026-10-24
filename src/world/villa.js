// The project of the first house: a two-storey high-tech villa with a pool (docs/villa-*.png).
// Everything in real millimetres, in the house's own axes: x along the street (to the right
// seen from the street), z into the plot (the street is at z < 0, the garden and the pool at
// z > 8400). Walls are given by their axis lines; an opening by where it runs along its wall
// (from the wall's `a` end), its sill and its head above the floor of its storey.
//
// Levels (above the natural ground): the foundation slab's top = the finished floor of the
// 1st storey, +300; storey 3000 (2800 of masonry on the slab + a 200 floor slab).

export const VILLA = {
  name: 'Вилла хай-тек',
  // where the house's (0, 0) is on the plot: mm from the plot's left edge and from the street
  at: [12600, 4500],
  ffl: 300,                 // the 1st floor above the natural ground
  storey: 3000, slab: 200,  // storey height and the floor slab's thickness
  floors: [
    {
      name: '1 этаж',
      walls: [
        // outer walls (aerated concrete D500, 300)
        { id: 'f', a: [0, 0], b: [13200, 0], kind: 'block' },
        { id: 'r', a: [13200, 0], b: [13200, 8400], kind: 'block' },
        { id: 'k', a: [13200, 8400], b: [0, 8400], kind: 'block' },
        { id: 'l', a: [0, 8400], b: [0, 0], kind: 'block' },
        // the bearing wall inside (the 2nd floor's walls stand on it)
        { id: 'm', a: [4800, 0], b: [4800, 8400], kind: 'block' },
        // partitions (half a brick)
        { id: 'p1', a: [0, 3000], b: [4800, 3000], kind: 'brick' },
        { id: 'p2', a: [1800, 0], b: [1800, 3000], kind: 'brick' },
        { id: 'p3', a: [0, 1500], b: [1800, 1500], kind: 'brick' },
        { id: 'p4', a: [0, 6600], b: [4800, 6600], kind: 'brick' },
      ],
      openings: [
        { w: 'f', from: 2600, to: 3600, sill: 0, head: 2400, type: 'door', name: 'входная дверь (поворотная)' },
        { w: 'f', from: 7200, to: 9000, sill: 1000, head: 2750, type: 'window', name: 'окно над столешницей' },
        { w: 'f', from: 10200, to: 12600, sill: 900, head: 2750, type: 'window' },
        { w: 'r', from: 3600, to: 8400, sill: 0, head: 2750, type: 'glass', name: 'угловое остекление' },
        { w: 'k', from: 0, to: 7200, sill: 0, head: 2750, type: 'portal', name: 'подъёмно-сдвижной портал' },
        { w: 'l', from: 2400, to: 4800, sill: 0, head: 2750, type: 'glass' },
        { w: 'l', from: 5700, to: 6600, sill: 0, head: 2100, type: 'door', name: 'из котельной под навес' },
        { w: 'm', from: 400, to: 2600, sill: 0, head: 2400, type: 'pass', name: 'проход холл → гостиная' },
        { w: 'p1', from: 2600, to: 3500, sill: 0, head: 2100, type: 'door' },
        { w: 'p2', from: 400, to: 1200, sill: 0, head: 2100, type: 'door' },
        { w: 'p2', from: 2000, to: 2800, sill: 0, head: 2100, type: 'door' },
        { w: 'p4', from: 3600, to: 4400, sill: 0, head: 2100, type: 'door' },
      ],
      rooms: [
        { name: 'холл', at: [3300, 1500] }, { name: 'WC', at: [900, 750] }, { name: 'котельная', at: [900, 2250] },
        { name: 'гостевая', at: [2400, 4800] }, { name: 'с/у', at: [2400, 7500] },
        { name: 'кухня', at: [7500, 1600] }, { name: 'столовая', at: [7500, 5600] }, { name: 'гостиная · второй свет', at: [11100, 6000] },
        { name: 'навес', at: [-2400, 4200] },
      ],
      // steel columns of the carport under the console (a 159 pipe)
      columns: [[-4650, 150], [-4650, 8250]],
    },
    {
      name: '2 этаж',
      walls: [
        { id: 'f', a: [-4800, 0], b: [13200, 0], kind: 'block' },
        { id: 'r', a: [13200, 0], b: [13200, 8400], kind: 'block' },
        { id: 'k', a: [-4800, 8400], b: [13200, 8400], kind: 'block' },
        { id: 'l', a: [-4800, 0], b: [-4800, 8400], kind: 'block' },
        // over the 1st floor's left wall and its bearing wall
        { id: 'm0', a: [0, 0], b: [0, 8400], kind: 'block' },
        { id: 'm1', a: [4800, 1800], b: [4800, 8400], kind: 'block' },
        { id: 'q1', a: [-4800, 3000], b: [0, 3000], kind: 'brick' },
        { id: 'q2', a: [-2400, 0], b: [-2400, 3000], kind: 'brick' },
        { id: 'q3', a: [0, 1800], b: [4800, 1800], kind: 'brick' },
        { id: 'q4', a: [0, 3600], b: [4800, 3600], kind: 'brick' },
        { id: 'q5', a: [2400, 1800], b: [2400, 3600], kind: 'brick' },
        { id: 'q6', a: [6000, 1800], b: [6000, 8400], kind: 'brick' },
        { id: 'q7', a: [6000, 1800], b: [9000, 1800], kind: 'brick' },
        { id: 'q8', a: [9000, 1800], b: [9000, 8400], kind: 'brick' },
      ],
      openings: [
        { w: 'f', from: 600, to: 1800, sill: 1500, head: 2400, type: 'window', name: 'окно-щель' },
        { w: 'f', from: 6000, to: 8400, sill: 1500, head: 2400, type: 'window', name: 'окно-щель' },
        { w: 'f', from: 14400, to: 17400, sill: 900, head: 2750, type: 'window' },
        { w: 'k', from: 0, to: 4800, sill: 0, head: 2750, type: 'glass', name: 'угловое остекление' },
        { w: 'k', from: 5400, to: 9000, sill: 0, head: 2750, type: 'glass' },
        { w: 'k', from: 11100, to: 13500, sill: 0, head: 2750, type: 'glass' },
        { w: 'k', from: 13800, to: 18000, sill: 0, head: 2750, type: 'glass', name: 'второй свет' },
        { w: 'r', from: 3600, to: 8400, sill: 0, head: 2750, type: 'glass', name: 'второй свет' },
        { w: 'l', from: 3600, to: 8400, sill: 0, head: 2750, type: 'glass' },
        { w: 'm0', from: 500, to: 1400, sill: 0, head: 2100, type: 'door' },
        { w: 'q1', from: 3600, to: 4400, sill: 0, head: 2100, type: 'door' },
        { w: 'q2', from: 1200, to: 2000, sill: 0, head: 2100, type: 'door' },
        { w: 'q3', from: 600, to: 1500, sill: 0, head: 2100, type: 'door' },
        { w: 'q3', from: 3000, to: 3900, sill: 0, head: 2100, type: 'door' },
        { w: 'q4', from: 1000, to: 1900, sill: 0, head: 2100, type: 'door' },
        { w: 'q7', from: 600, to: 1500, sill: 0, head: 2100, type: 'door' },
      ],
      rooms: [
        { name: 'мастер-спальня', at: [-2400, 5700] }, { name: 'с/у', at: [-3600, 1500] }, { name: 'гардероб', at: [-1200, 1500] },
        { name: 'коридор', at: [2400, 900] }, { name: 'с/у', at: [1200, 2700] }, { name: 'постирочная', at: [3600, 2700] },
        { name: 'спальня 2', at: [2400, 6000] }, { name: 'спальня 3', at: [7500, 5100] }, { name: 'кабинет-галерея', at: [11100, 1800] },
      ],
      // glass railings (1100 high) at the edges of the holes in this floor
      rails: [[[9000, 3600], [13200, 3600]], [[4800, 7800], [6000, 7800]]],
    },
  ],
  // holes in the floor slab over the 1st storey: the double height, the stair
  holes: [
    { name: 'второй свет', x0: 9000, z0: 3600, x1: 13200, z1: 8400 },
    { name: 'лестница', x0: 4800, z0: 3300, x1: 6000, z1: 7800 },
  ],
  // the slab over the 1st storey runs out 4800 over the carport (a console on the columns)
  slab1: { x0: -4800, z0: 0, x1: 13200, z1: 8400 },
  roofSlab: { x0: -4800, z0: 0, x1: 13200, z1: 8400, parapet: 600 },
  // straight stair: 17 risers of 176.5, 16 treads of 280, from the dining room up toward the street
  stair: { x0: 4850, x1: 5950, zBottom: 7800, zTop: 3320, risers: 17 },
  site: {
    plot: [35540, 26650],
    // in the house's axes
    drive: { x0: -4800, z0: -4500, x1: 0, z1: 0, name: 'въезд · крупноформатная плитка' },
    path: { x0: 2500, z0: -4500, x1: 3700, z1: 0, name: 'дорожка к входу' },
    terrace: { x0: 6000, z0: 8400, x1: 13200, z1: 10800, y: 300, name: 'терраса · ДПК' },
    poolDeck: { x0: 3600, z0: 10800, x1: 13200, z1: 14900, y: 300, name: 'обход · керамогранит' },
    // the bowl inside: 8.0 × 3.5, 1.5 of water (the water 100 under the coping)
    pool: { x0: 4400, z0: 11100, x1: 12400, z1: 14600, depth: 1500, water: 100, wall: 250, name: 'бассейн 8,0 × 3,5' },
    fence: { z: -4500, gate: [-4800, 0] },
  },
};

// the foundation pits to set out (outer faces of the slab + 500 of working room each side)
// depths in real mm below the natural ground
export const PITS = [
  // slab 300 on 200 of gravel and 300 of sand, top at +300 → 500 of digging
  { name: 'плита дома', x0: -150 - 600, z0: -150 - 600, x1: 13200 + 150 + 600, z1: 8400 + 150 + 600, depth: 500 },
  // the bowl's floor 1500 + 100 under the coping at +300 → −1300; its slab 250, lean concrete 100,
  // gravel 200 → −1850; walls 250, 500 of working room
  { name: 'котлован бассейна', x0: 4400 - 250 - 500, z0: 11100 - 250 - 500, x1: 12400 + 250 + 500, z1: 14600 + 250 + 500, depth: 1850 },
];
