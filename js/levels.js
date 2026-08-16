/*
 * levels.js — the arenas.
 *
 * ADDING YOUR OWN: copy any block below and draw a new one. Every row must be
 * the same length, there must be exactly one 'S', and at least one 'G' has to
 * be reachable from it.
 *
 *   '#'  wall     solid, and too tall to jump over
 *   '.'  floor    safe ground
 *   '~'  lava     ground level, but standing on it kills — jump across
 *   ' '  void     no floor at all; walk off it and you fall out of the world
 *   'S'  start
 *   'G'  goal
 *
 * `movers` is optional. Two kinds:
 *
 *   { kind: 'crusher', from: [x, y], to: [x, y], speed: 0.07, phase: 0.5 }
 *   { kind: 'chaser',  at:   [x, y], speed: 0.09 }
 *
 * A crusher slides back and forth forever between two cells. `phase` (0..1)
 * staggers where it starts, so a row of them is not in lockstep. A chaser
 * heads for whichever agent is nearest, which changes constantly — it is much
 * harder to learn against, so use it sparingly.
 *
 * Crushers are half a unit tall and CAN be jumped over with good timing.
 * Chasers cannot. Neither can walls: the jump arc peaks at 0.81 and a wall is
 * 1.0, deliberately.
 *
 * Run `node tools/validate-levels.js` to check a level before loading it, and
 * `node tools/gen-maze.js 21 15` to have one generated for you.
 *
 * Keep them roughly in order of difficulty — with curriculum mode on, the
 * population only moves up once it can reliably escape the level it is on, and
 * it carries its brains with it.
 */

const LEVELS = [
  {
    name: '1 · Corridor',
    note: 'One passage, two corners, nowhere to go wrong. Just "can it move without grinding along the walls" — expect an escape within a handful of generations.',
    rows: [
      '#############',
      '#S..........#',
      '###########.#',
      '#G..........#',
      '#############',
    ],
  },
  {
    name: '2 · Switchbacks',
    note: 'Still no choices to make, but four times as long. Getting through needs a turn that holds up over and over.',
    rows: [
      '###############',
      '#S............#',
      '#############.#',
      '#.............#',
      '#.#############',
      '#.............#',
      '#############.#',
      '#............G#',
      '###############',
    ],
  },
  {
    name: '3 · First Lava',
    note: 'Two walls of lava, no way round either, and one new button to discover. Watch the first few generations walk straight in — nothing tells them it is dangerous except dying.',
    rows: [
      '###############',
      '#S....~....~..#',
      '#.....~....~..#',
      '#.....~....~..#',
      '#.....~....~..#',
      '#.....~....~.G#',
      '###############',
    ],
  },
  {
    name: '4 · Hot Forks',
    note: 'Branches, dead ends, and lava down two of the corridors. The safe route is longer, so it has to be worth learning.',
    rows: [
      '#################',
      '#S....#.........#',
      '#####.#.#######.#',
      '#...#.#.#.....#.#',
      '#.#.#.#.#.###.#.#',
      '#~#...#...#...#~#',
      '#.#####.###.###.#',
      '#.....#.#...#...#',
      '#####.#.#.###.###',
      '#....G..#.......#',
      '#################',
    ],
  },
  {
    name: '5 · The Gap',
    note: 'Ledges over nothing, and the gaps are two cells wide — right at the edge of what the jump arc can carry. A missed one falls forever, which at least frees up the clock for everyone else.',
    rows: [
      '###################',
      '#S...  ....  .....#',
      '#....  ....  .....#',
      '#....  ....  .....#',
      '#....  ....  .....#',
      '#....  ....  ....G#',
      '###################',
    ],
  },
  {
    name: '6 · Crushers',
    note: 'An open room and three blocks sliding through it. They are short enough to hurdle if the timing is right, which almost never happens on purpose before generation fifty.',
    rows: [
      '#################',
      '#S..............#',
      '#...............#',
      '#...............#',
      '#...............#',
      '#..............G#',
      '#################',
    ],
    movers: [
      { kind: 'crusher', from: [4, 1], to: [4, 5], speed: 0.07, phase: 0.0 },
      { kind: 'crusher', from: [8, 5], to: [8, 1], speed: 0.07, phase: 0.35 },
      { kind: 'crusher', from: [12, 1], to: [12, 5], speed: 0.07, phase: 0.7 },
    ],
  },
  {
    name: '7 · The Knot',
    note: 'No hazards at all — just a real maze, with dead ends and one long correct route. Everything up to here could be solved by running at the exit and jumping; this cannot.',
    rows: [
      '#####################',
      '#S....#.............#',
      '#####.#######.#.#.#.#',
      '#.........#...#...#.#',
      '#.#.#####.#.###.#.#.#',
      '#.#.....#.#.....#.#.#',
      '#.#.#.###.#######.#.#',
      '#...#...#.........#.#',
      '###.###.###.#.#######',
      '#...#.#...#.#.......#',
      '#.###.#.###.#.#####.#',
      '#.#.......#.#...#...#',
      '#.###.###.#.#####.#.#',
      '#.......#.........#G#',
      '#####################',
    ],
  },
  {
    name: '8 · Hot Warren',
    note: 'Navigation and survival at the same time, which is a far bigger ask than either alone. Lava in two corridors and a crusher sweeping the final approach — there are ways round both, which is the only reason this is learnable at all.',
    rows: [
      '#####################',
      '#S#.........#.......#',
      '#.#.#####.#.#.###.###',
      '#...#.......#...#...#',
      '#.###.###.#.###.#.#.#',
      '#.....#...~...#...#.#',
      '#.#.#.#.#.###.#####.#',
      '#.#...#.....#.......#',
      '#######.#.#.###.#.#.#',
      '#...~...#.#.....#...#',
      '#.#######.#.#.###.###',
      '#.......#...#.....#.#',
      '#.#####.###.###.###.#',
      '#..................G#',
      '#####################',
    ],
    movers: [
      { kind: 'crusher', from: [4, 13], to: [16, 13], speed: 0.07, phase: 0.0 },
    ],
  },
  {
    name: '9 · The Long Dark',
    note: 'The big one, and something in it is looking for you. The chaser goes for whichever agent is nearest, so no two runs are the same — give it a few hundred generations, or hit Turbo and go make a coffee.',
    rows: [
      '###############################',
      '#S............#.....#.....#...#',
      '#############.###.#.###.#.###.#',
      '#...........#.#...#.....#...#.#',
      '#.###.#.#####.#.###########.#.#',
      '#.....#.#.....#...#.......#...#',
      '#.#.###.#.#######.#.###.#####.#',
      '#.#.....#...#.....#...#...#...#',
      '#.#########.###.#####.###.#.###',
      '#...#.....#.#...#...#...#.#...#',
      '#.#.#.#.###.#.#.#.###.###.###.#',
      '#.#...#.#...#.#.......#.....#.#',
      '#.#####.#.###.#######.#.###.#.#',
      '#.#...#.#...#.......#.#.#...#.#',
      '#.#.###.###.#####.#.#.#.#####.#',
      '#.#.#.....#.#...#.#.#.#...#...#',
      '#.#.#.#####.#.#.###.#.###.#.###',
      '#.#.#.......#.#.#...#...#.#...#',
      '#.#.#########.#.#.#####.#.###.#',
      '#.............#...#.....#....G#',
      '###############################',
    ],
    movers: [
      { kind: 'chaser', at: [15, 9], speed: 0.085 },
    ],
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LEVELS;
}
