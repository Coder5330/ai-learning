#!/usr/bin/env node
/*
 * Build the campaign and print it as a levels.js block.
 *
 *   node tools/build-levels.js
 *
 * The five campaign levels are large, near-perfect mazes with hazards layered
 * on, which is not something anyone should be drawing by hand — a single wrong
 * character makes an unsolvable arena, and at 31x21 you will not spot it. This
 * generates them from fixed seeds, checks every one, and prints the result to
 * paste into js/levels.js. Same seeds in, same levels out.
 */

const {
  makeRng, generateMaze, addLava, addSpinner, findCrusherLanes,
} = require('../js/mazegen.js');
const { World } = require('../js/world.js');

/** Cells the agent can still walk to with the doors shut. */
function reachableWithDoorsShut(g) {
  const h = g.length, w = g[0].length;
  const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h
    && g[y][x] !== '#' && g[y][x] !== 'D';
  const seen = new Set(['1,1']);
  const out = [[1, 1]];
  for (let i = 0; i < out.length; i++) {
    const [x, y] = out[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (!ok(nx, ny) || seen.has(key)) continue;
      seen.add(key);
      out.push([nx, ny]);
    }
  }
  return out;
}

/** Seal the goal behind a door and scatter `plates` switches on the near side. */
function lockTheExit(rows, plates, rng) {
  const h = rows.length, w = rows[0].length;
  let goal = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (rows[y][x] === 'G') goal = [x, y];
  }
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [goal[0] + dx, goal[1] + dy])
    .filter(([x, y]) => x > 0 && y > 0 && x < w - 1 && y < h - 1 && rows[y][x] !== '#');

  for (const pick of neighbours) {
    const g = rows.map(r => r.split(''));
    for (const [x, y] of neighbours) {
      g[y][x] = (x === pick[0] && y === pick[1]) ? 'D' : '#';
    }

    const near = reachableWithDoorsShut(g);
    if (near.some(([x, y]) => x === goal[0] && y === goal[1])) continue;

    // The door must still open onto the goal once a switch is pressed.
    const openTest = g.map(r => r.join('').replace(/D/g, '.'));
    if (!reachableWithDoorsShut(openTest.map(r => r.split('')))
      .some(([x, y]) => x === goal[0] && y === goal[1])) continue;

    // Switches go far from the start and far from each other, so clearing one
    // never happens to put you on top of the next.
    const chosen = [];
    const spread = (x, y) => chosen.every(([px, py]) =>
      Math.abs(px - x) + Math.abs(py - y) > (w + h) / 4);
    const pool = near
      .filter(([x, y]) => g[y][x] === '.' && x + y > (w + h) / 4)
      .sort(() => rng() - 0.5);
    for (const [x, y] of pool) {
      if (chosen.length >= plates) break;
      if (!spread(x, y)) continue;
      chosen.push([x, y]);
    }
    if (chosen.length < plates) continue;
    for (const [x, y] of chosen) g[y][x] = 'P';
    return g.map(r => r.join(''));
  }
  return null;
}

const SPECS = [
  {
    name: '1 · The Long Way',
    seed: 20260816,
    cols: 27, rows: 19, loop: 0.06,
    lava: 0, plates: 0, spinners: 0, crushers: 0, chaser: false,
    note: 'A near-perfect maze, which means close to one correct route and a '
        + 'dead end down almost every wrong turn. No hazards at all — this one '
        + 'is purely about the size of the search. Expect a long plateau before '
        + 'anything escapes.',
  },
  {
    name: '2 · Trapworks',
    seed: 771,
    cols: 27, rows: 19, loop: 0.04,
    lava: 14, plates: 0, spinners: 0, crushers: 0, chaser: false,
    note: 'The same brutal geometry with fourteen pools of lava in it. Every '
        + 'one is jumpable, and the population has to work out which of the '
        + 'dead ends are worth burning to death in.',
  },
  {
    name: '3 · The Switchyard',
    seed: 30313,
    cols: 27, rows: 19, loop: 0.09,
    lava: 8, plates: 2, spinners: 0, crushers: 2, chaser: false,
    note: 'Two switches, and the exit stays shut until BOTH are down. That '
        + 'means two long detours in the wrong direction before the goal is '
        + 'even reachable — the hardest thing in the project to learn, because '
        + 'for most of a run walking away from the exit is the only right move.',
  },
  {
    name: '4 · The Machine',
    seed: 8899,
    cols: 29, rows: 19, loop: 0.08,
    lava: 12, plates: 1, spinners: 2, crushers: 3, chaser: false,
    note: 'A locked exit, spinning bars, patrolling crushers and lava, all in '
        + 'the same maze. Nothing here is new on its own; surviving all of it '
        + 'on one run is.',
  },
  {
    name: '5 · The Labyrinth',
    seed: 4242424,
    cols: 31, rows: 21, loop: 0.05,
    lava: 16, plates: 3, spinners: 2, crushers: 3, chaser: true,
    note: 'Everything at once, at full size: three switches to find, a sealed '
        + 'exit, sixteen lava pools, spinners, crushers, and something hunting '
        + 'you the whole time. This is not meant to be beaten quickly, or '
        + 'necessarily at all.',
  },
];

const out = [];
let failed = 0;

for (const spec of SPECS) {
  const rng = makeRng(spec.seed);
  let rows = generateMaze(spec.cols, spec.rows, spec.loop, rng);
  const movers = [];

  if (spec.plates) {
    const locked = lockTheExit(rows, spec.plates, rng);
    if (!locked) { console.error(`! ${spec.name}: could not lock the exit`); failed++; continue; }
    rows = locked;
  }
  for (let i = 0; i < spec.spinners; i++) {
    const spun = addSpinner(rows, rng);
    if (!spun) break;
    rows = spun.rows;
    movers.push(spun.mover);
  }
  if (spec.lava) rows = addLava(rows, spec.lava, rng);

  const lanes = findCrusherLanes(rows, 6);
  for (let i = 0; i < spec.crushers && lanes.length; i++) {
    const lane = lanes.splice((rng() * lanes.length) | 0, 1)[0];
    movers.push({
      kind: 'crusher', from: lane.from, to: lane.to,
      speed: +(0.05 + rng() * 0.03).toFixed(3), phase: +rng().toFixed(2),
    });
  }
  if (spec.chaser) {
    const open = [];
    for (let y = 1; y < rows.length - 1; y++) {
      for (let x = 1; x < rows[0].length - 1; x++) {
        if (rows[y][x] === '.' && x + y > (spec.cols + spec.rows) * 0.5) open.push([x, y]);
      }
    }
    if (open.length) movers.push({ kind: 'chaser', at: open[(rng() * open.length) | 0], speed: 0.08 });
  }

  const level = { name: spec.name, note: spec.note, rows, movers };
  const world = new World(level);
  const problems = world.validate();
  if (problems.length) {
    console.error(`! ${spec.name}`);
    for (const p of problems) console.error(`    ${p}`);
    failed++;
    continue;
  }

  console.error(`✓ ${spec.name.padEnd(20)} ${world.w}x${world.h}` +
    `  direct ${String(world.startDist).padStart(3)}` +
    `  full route ${String(world.routeLength).padStart(4)}` +
    `  ${world.plates.length} switches`);

  const moverLines = movers.map(m => '      ' + JSON.stringify(m)
    .replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ') + ',').join('\n');

  out.push(
    '  {\n' +
    `    name: ${JSON.stringify(level.name)},\n` +
    `    note: ${JSON.stringify(level.note)},\n` +
    '    rows: [\n' +
    rows.map(r => `      '${r}',`).join('\n') + '\n' +
    '    ],\n' +
    (movers.length ? `    movers: [\n${moverLines}\n    ],\n` : '') +
    '  },'
  );
}

console.log(out.join('\n'));
process.exit(failed ? 1 : 0);
