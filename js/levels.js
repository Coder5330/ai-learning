/*
 * levels.js — the campaign.
 *
 * Five arenas, and they are all meant to be hard. Endless mode (the default,
 * in js/mazegen.js) is where the population learns to solve mazes in general;
 * this is where you point it at one specific horrible one and watch it grind.
 * Expect hundreds of generations, not dozens. Level 5 may never fall.
 *
 * These were built by tools/build-levels.js from fixed seeds and checked with
 * World.validate(). A 31x21 maze with three switches, sixteen lava pools and a
 * chaser in it is not something to draw by hand — one wrong character makes an
 * unsolvable arena and you will not spot it by eye. Re-run
 *
 *     node tools/build-levels.js
 *
 * to regenerate them, or edit the ASCII below directly and check your work
 * with `node tools/validate-levels.js`.
 *
 *   '#'  wall     solid, and too tall to jump over
 *   '.'  floor    safe ground
 *   '~'  lava     ground level, but standing on it kills — jump across
 *   ' '  void     no floor at all; walk off it and you fall out of the world
 *   'P'  plate    a switch. EVERY plate must be pressed before the doors open
 *   'D'  door     solid until this agent has pressed all of them
 *   'S'  start    exactly one
 *   'G'  goal
 *
 * `movers` is optional. Three kinds:
 *
 *   { kind: 'crusher', from: [x, y], to: [x, y], speed: 0.07, phase: 0.5 }
 *   { kind: 'spinner', at:   [x, y], arms: 3, reach: 1.5, speed: 0.035 }
 *   { kind: 'chaser',  at:   [x, y], speed: 0.085 }
 *
 * A crusher slides back and forth between two cells; `phase` (0..1) staggers
 * where it starts. A spinner sweeps a circle, and its arms are low enough to
 * hurdle with good timing. A chaser heads for whichever agent is nearest,
 * which changes constantly — much harder to learn against, so use it sparingly.
 *
 * Neither walls nor chasers can be jumped: the jump arc peaks at 0.81 against
 * a wall height of 1.0, deliberately.
 */

const LEVELS = [
  {
    name: "1 · The Long Way",
    note: "A near-perfect maze, which means close to one correct route and a dead end down almost every wrong turn. No hazards at all — this one is purely about the size of the search. Expect a long plateau before anything escapes.",
    rows: [
      '###########################',
      '#S#.....#.................#',
      '#.#.###.#.#######.###.###.#',
      '#...#.#.#...#...#.#...#...#',
      '#####.#.#.#.#.#.###.###.#.#',
      '#.......#.#.#.#.......#.#.#',
      '#.#######.#.#.#####.#.#.#.#',
      '#...#...#.#.#...#...#.#.#.#',
      '###.#.#.#.#.###.#.#.#.#.#.#',
      '#.#.#...#.#.....#.#.#.#.#.#',
      '#.#.###.#.#######.#.###.#.#',
      '#.#...#.......#...#.#...#.#',
      '#.###.#######.#.###.#.###.#',
      '#.#...#.....#.#.....#.#.#.#',
      '#.#.###.###.#.###.#.#.#.#.#',
      '#.#.#...#...#...#.#.#.#...#',
      '#.#.###.#.#######.#.#.#.###',
      '#.......#.........#...#..G#',
      '###########################',
    ],
  },
  {
    name: "2 · Trapworks",
    note: "The same brutal geometry with fourteen pools of lava in it. Every one is jumpable, and the population has to work out which of the dead ends are worth burning to death in.",
    rows: [
      '###########################',
      '#S...~..#~........#.....#.#',
      '#######~###.#.###.###.#.#.#',
      '#...#.#...#.~.#~..#...#.#.#',
      '#.#.#.###.#.#.###.#.#.#.#.#',
      '#.#~....#.#.#...#...#.#..~#',
      '#.#.#####.#.###.#####.###.#',
      '#.#.#...#.#...#.#.......#.#',
      '#.###.#.#.#~#.#.#.#######.#',
      '#...#.#.......#.#.........#',
      '###.#~#########.#.#########',
      '#...#.#...#...#.#.......#.#',
      '#.###.#.#.#.#.#.#######.#.#',
      '#...#.#.....#.#.#...#...#~#',
      '###.#.#.#####.#.#.#.#.###.#',
      '#...#....~#..~#.....#.....#',
      '#.#######.#.#######.#####.#',
      '#.~.................#.~..G#',
      '###########################',
    ],
  },
  {
    name: "3 · The Switchyard",
    note: "Two switches, and the exit stays shut until BOTH are down. That means two long detours in the wrong direction before the goal is even reachable — the hardest thing in the project to learn, because for most of a run walking away from the exit is the only right move.",
    rows: [
      '###########################',
      '#S#.....#..~..~.....#.....#',
      '#.###.#.#.#.#.###.#P###.#.#',
      '#...#.#...#.#.#...#...#.#.#',
      '###.#.#####.#.#.#.###.#.#.#',
      '#.#.#.#...#...#...#.....#.#',
      '#.#.###.#.###.###.#.#####.#',
      '#.#.#...#...#...#.#.#...#.#',
      '#.#.#.#####.#####.###.#.#.#',
      '#.#.#......~.~..#.....#.#.#',
      '#.#.#.###.#.###.#.###.#.#.#',
      '#.#.#.#...#..~......#.#.#.#',
      '#.#.#.#.###########.###.###',
      '#...#.#...#.......#.....P.#',
      '#.#.#####.#.###.#.###.#.#.#',
      '#.#.....#...#...#.#..~#.#.#',
      '#.#####.#####.###.#~#######',
      '#.............#...~.....DG#',
      '###########################',
    ],
    movers: [
      {kind: "crusher", from: [25, 1], to: [25, 11], speed: 0.061, phase: 0.14},
      {kind: "crusher", from: [5, 9], to: [10, 9], speed: 0.076, phase: 0.61},
    ],
  },
  {
    name: "4 · The Machine",
    note: "A locked exit, spinning bars, patrolling crushers and lava, all in the same maze. Nothing here is new on its own; surviving all of it on one run is.",
    rows: [
      '#############################',
      '#S..#.............#...#..P..#',
      '###.#####.....#.###.#.#.###.#',
      '#.#...........~.#...#.#~#...#',
      '#.#.....#.....###.###.#.#.###',
      '#.#...........#...#.#...#...#',
      '#.#....~#.#.#.#.###.#######.#',
      '#...........#.....#~..#.....#',
      '#.###.###.#######.#.#.#.#####',
      '#.....#...#...#.....#.#.#.~.#',
      '#.#.#.#.###.#.###.#####.#.#.#',
      '#.#.#.#.#...#...#.#..~#...#~#',
      '#.#.###.#.#####.#.#.#.###.#.#',
      '#.#.~...#.#.....#.#.#...#.#.#',
      '#.#######.#.#####.#.###.###.#',
      '#...#.....#.#...#.#...#...#.#',
      '###.###.###.#~#.#####.###.###',
      '#......~#~.....~......#...DG#',
      '#############################',
    ],
    movers: [
      {kind: "spinner", at: [5, 5], arms: 2, reach: 1.35, speed: 0.05313047093339264, phase: 2.9119954481617483},
      {kind: "spinner", at: [11, 3], arms: 2, reach: 1.35, speed: 0.05425062124966644, phase: 1.2379673327999239},
      {kind: "crusher", from: [11, 1], to: [11, 7], speed: 0.074, phase: 0.37},
      {kind: "crusher", from: [5, 3], to: [5, 11], speed: 0.053, phase: 0.35},
      {kind: "crusher", from: [1, 7], to: [11, 7], speed: 0.071, phase: 0.47},
    ],
  },
  {
    name: "5 · The Labyrinth",
    note: "Everything at once, at full size: three switches to find, a sealed exit, sixteen lava pools, spinners, crushers, and something hunting you the whole time. This is not meant to be beaten quickly, or necessarily at all.",
    rows: [
      '###############################',
      '#S..#..~......#.....~...#..~..#',
      '###.#.#####.#.###.###.#.#####.#',
      '#...#.......#...#...#.#.P...#.#',
      '#.#########.###.###.#.#####.#.#',
      '#.#.....#...#.#.....#.....#..~#',
      '#.#.###.#~###.###~#.#####.###.#',
      '#..~#.#P..#.#.....#.....#.#...#',
      '#####.#####.#.###.#######.#.###',
      '#...............#....~....#.#.#',
      '#.######.~....#.#.#.#######.#.#',
      '#..~..........#.#P#.~...#.....#',
      '########......#~#######.#.~...#',
      '#.............#.......#.......#',
      '#.#########.#.#######.###....~#',
      '#.#...#.......#.....#...#.....#',
      '#.#.###.#######.#.#####.#.#.###',
      '#.#.....#.....#.#.......#.#.#.#',
      '#.#######.###.#.#.#.#.###.#.###',
      '#.........~.#.....#.......#~DG#',
      '###############################',
    ],
    movers: [
      {kind: "spinner", at: [27, 13], arms: 3, reach: 1.35, speed: 0.05086614966392517, phase: 1.0371736194500816},
      {kind: "spinner", at: [10, 11], arms: 2, reach: 1.35, speed: 0.037085713022388514, phase: 0.8905977289244708},
      {kind: "crusher", from: [1, 9], to: [15, 9], speed: 0.079, phase: 0.75},
      {kind: "crusher", from: [1, 19], to: [9, 19], speed: 0.055, phase: 0.38},
      {kind: "crusher", from: [5, 3], to: [11, 3], speed: 0.057, phase: 0.79},
      {kind: "chaser", at: [18, 9], speed: 0.08},
    ],
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LEVELS;
}
