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
    note: "Two switches, and the exit stays shut until BOTH are down. That means two long detours in the wrong direction before the goal is even reachable — the hardest thing in the project to learn, because for most of a run walking away from the exit is the only right move. Getting both switches down takes a couple of hundred generations; the walk back to the door takes longer.",
    rows: [
      '###########################',
      '#S#.....#.................#',
      '#.###.#.#.#.#.###.#.###.#.#',
      '#...........#.#.P.#...#.#.#',
      '###.#.#####.#.#.#.###.#.#.#',
      '#.#.#.#...#...#...#.....#.#',
      '#.#.###.#.###.###.#.#####.#',
      '#.#.....#....~....#.#...#.#',
      '#.#.#.#####.#####.###.#.#.#',
      '#.#.#...........#.~...#.#.#',
      '#.#.#.###.#.###.#.###.#.#.#',
      '#.#.#.#...#.........#.#.#.#',
      '#.#.#.#.#.#####.###.#.#.###',
      '#.....#...#.......#.....~.#',
      '#P#~#####.#.###.#.#.#.#.#.#',
      '#.#.....#...#...#.#...#~#.#',
      '#.###.#.###.#.###.#.#.#####',
      '#.......................DG#',
      '###########################',
    ],
    movers: [
      {kind: "crusher", from: [9, 9], to: [9, 15], speed: 0.052, phase: 0.01},
    ],
  },
  {
    name: "4 · The Machine",
    note: "A locked exit, spinning bars, patrolling crushers and lava, all in the same maze. Nothing here is new on its own; surviving all of it on one run is.",
    rows: [
      '#############################',
      '#S..#.~...~.......#...#.....#',
      '###.#######.###.###.#.#.###.#',
      '#.#.........#...#...#.#.#...#',
      '#.#.#.#.#.###.###.###.#.#.###',
      '#.#...#.....#.#...#.#...#~..#',
      '#.###.#.#.#.#.#.###.#######.#',
      '#.~.........#.....#...#....~#',
      '#.###.###.#######.#.#.#.#####',
      '#.........#..P#..~..#.#.#...#',
      '#.#.#.....#.#.###.#####.#.#~#',
      '#.#.#.......#.....#...#...#.#',
      '#.#.#.....#####.#.#.#.###.#.#',
      '#.#.............#.#.....#.#.#',
      '#.#######.....###.#~###.###.#',
      '#...#...........#.#...#.~.#.#',
      '###.###.#.....#.#####.###.###',
      '#.......#.................DG#',
      '#############################',
    ],
    movers: [
      {kind: "spinner", at: [11, 15], arms: 3, reach: 1.35, speed: 0.05096031020628289, phase: 2.739485845621508},
      {kind: "spinner", at: [7, 11], arms: 3, reach: 1.35, speed: 0.046773735237075016, phase: 4.53305767380738},
      {kind: "crusher", from: [3, 7], to: [11, 7], speed: 0.073, phase: 0.95},
      {kind: "crusher", from: [1, 9], to: [9, 9], speed: 0.062, phase: 0.78},
    ],
  },
  {
    name: "5 · The Labyrinth",
    note: "Everything at once, at full size: three switches to find, a sealed exit, sixteen lava pools, spinners, crushers, and something hunting you the whole time. This is not meant to be beaten quickly, or necessarily at all. Nothing has escaped it yet.",
    rows: [
      '###############################',
      '#S..#.........#......~..#.P.~.#',
      '###.#.#####.#.###.###.#.#####.#',
      '#...#...........#~..#.#.....#.#',
      '#.#########.#.#.###.#.#####.#.#',
      '#.#.....#...#.......#.....#~.~#',
      '#.#.###.#~###~....#.#####.###.#',
      '#...#.#...#.#.....#.....#.#...#',
      '###.#.#####.#.....###.###.#.###',
      '#....P......#.~........~..#.#.#',
      '#.#####.#.#.#.#.#.#P#######.#~#',
      '#.......#.....#.#~#.....#...#.#',
      '#############.#.#######.###.#.#',
      '#...~.......#.#.......#...#...#',
      '#.#.#######.#.###.......#.###.#',
      '#.#...#.~.....#.........#.#...#',
      '#.#.###.#######.#.......#.#.###',
      '#.#.....#.....#.#.......#.#.#.#',
      '#.#.#####.###.#.#......##.#.###',
      '#.........~.#.....#.......#.DG#',
      '###############################',
    ],
    movers: [
      {kind: "spinner", at: [20, 16], arms: 3, reach: 1.35, speed: 0.03412678270949982, phase: 3.8050529012121737},
      {kind: "spinner", at: [15, 7], arms: 3, reach: 1.35, speed: 0.04205160197569057, phase: 1.7808339181265038},
      {kind: "crusher", from: [5, 1], to: [13, 1], speed: 0.068, phase: 1},
      {kind: "crusher", from: [17, 14], to: [23, 14], speed: 0.055, phase: 0.98},
      {kind: "crusher", from: [19, 13], to: [19, 19], speed: 0.068, phase: 0.15},
      {kind: "chaser", at: [16, 13], speed: 0.08},
    ],
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LEVELS;
}
