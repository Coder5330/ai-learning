/*
 * mazegen.js — procedurally generated arenas.
 *
 * This is the part that makes the whole thing mean something.
 *
 * On a fixed maze, evolution does not have to learn "how to solve a maze". It
 * can learn "turn left, then right, then left" — a memorised route that is
 * worth nothing anywhere else. The population looks like it is getting smarter
 * and is really just overfitting to one map.
 *
 * In Endless mode every generation gets a maze nobody has ever seen, so a
 * memorised route is worth exactly nothing and the only thing selection can
 * reward is general maze-solving. That also makes the escape rate an honest
 * number: it is measured on unseen mazes, so it IS the generalisation score.
 *
 * Difficulty then ramps by tier — bigger, fewer loops, more lava, then
 * crushers, then a chaser — as the population keeps clearing the current one.
 */

/** mulberry32 — small, fast, and deterministic given a seed. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Carve a maze with a recursive backtracker, then knock some walls out.
 *
 * `loopiness` is the important dial. At 0 you get a perfect maze: exactly one
 * route between any two points, every wrong turn a dead end, and a reactive
 * agent has almost no chance. Adding loops gives more than one way through, so
 * a decent-but-imperfect policy still finds *an* exit, which is what gives
 * evolution a gradient to climb.
 *
 * Returns an array of strings using '#' and '.', with 'S' and 'G' placed.
 */
function generateMaze(cols, rows, loopiness, rng) {
  const w = cols % 2 === 0 ? cols + 1 : cols;
  const h = rows % 2 === 0 ? rows + 1 : rows;

  const grid = Array.from({ length: h }, () => new Array(w).fill('#'));
  const stack = [[1, 1]];
  grid[1][1] = '.';
  const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options = [];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && grid[ny][nx] === '#') {
        options.push([nx, ny, dx, dy]);
      }
    }
    if (!options.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = options[(rng() * options.length) | 0];
    grid[y + dy / 2][x + dx / 2] = '.';
    grid[ny][nx] = '.';
    stack.push([nx, ny]);
  }

  if (loopiness > 0) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (grid[y][x] !== '#') continue;
        if ((x % 2 === 1) === (y % 2 === 1)) continue; // only between-cell walls
        if (rng() < loopiness) grid[y][x] = '.';
      }
    }
  }

  grid[1][1] = 'S';
  grid[h - 2][w - 2] = 'G';
  return grid.map(r => r.join(''));
}

/** Every open, non-start, non-goal cell. */
function openCells(grid) {
  const out = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[0].length; x++) {
      if (grid[y][x] === '.') out.push([x, y]);
    }
  }
  return out;
}

/**
 * Sprinkle lava into a carved maze.
 *
 * Two rules keep it survivable. Lava is never placed next to lava, so every
 * pool stays one cell across and the jump arc can always clear it; and nothing
 * goes within a few cells of the start, so a generation is not wiped out
 * before it has moved. Lava does not need a reachability check — the distance
 * field treats it as passable, because it is, by jumping.
 */
function addLava(grid, count, rng) {
  const g = grid.map(r => r.split(''));
  const cells = openCells(grid);
  const [sx, sy] = [1, 1];
  let placed = 0, attempts = 0;

  while (placed < count && attempts < count * 60) {
    attempts++;
    const [x, y] = cells[(rng() * cells.length) | 0];
    if (g[y][x] !== '.') continue;
    if (Math.abs(x - sx) + Math.abs(y - sy) < 4) continue;
    if (g[y - 1][x] === '~' || g[y + 1][x] === '~'
      || g[y][x - 1] === '~' || g[y][x + 1] === '~') continue;
    g[y][x] = '~';
    placed++;
  }
  return g.map(r => r.join(''));
}

/**
 * Find straight open runs a crusher can patrol without clipping a wall — the
 * same thing tools/validate-levels.js checks for the hand-made levels.
 */
function findCrusherLanes(grid, minLength) {
  const h = grid.length, w = grid[0].length;
  const lanes = [];
  const passable = (x, y) => grid[y][x] === '.' || grid[y][x] === 'S' || grid[y][x] === 'G';

  for (let y = 1; y < h - 1; y++) {
    let run = 0;
    for (let x = 1; x < w; x++) {
      if (x < w - 1 && passable(x, y)) { run++; continue; }
      if (run >= minLength) lanes.push({ from: [x - run, y], to: [x - 1, y] });
      run = 0;
    }
  }
  for (let x = 1; x < w - 1; x++) {
    let run = 0;
    for (let y = 1; y < h; y++) {
      if (y < h - 1 && passable(x, y)) { run++; continue; }
      if (run >= minLength) lanes.push({ from: [x, y - run], to: [x, y - 1] });
      run = 0;
    }
  }
  return lanes;
}

/**
 * The difficulty ladder. Size grows, loops disappear, then hazards arrive one
 * kind at a time — so when the escape rate falls off a cliff you can see
 * exactly which new thing caused it.
 */
const TIERS = [
  { cols: 11, rows: 9,  loop: 0.30, lava: 0, crushers: 0, chaser: false },
  { cols: 13, rows: 9,  loop: 0.26, lava: 0, crushers: 0, chaser: false },
  { cols: 13, rows: 11, loop: 0.24, lava: 2, crushers: 0, chaser: false },
  { cols: 15, rows: 11, loop: 0.22, lava: 3, crushers: 0, chaser: false },
  { cols: 17, rows: 13, loop: 0.20, lava: 4, crushers: 1, chaser: false },
  { cols: 19, rows: 13, loop: 0.18, lava: 5, crushers: 1, chaser: false },
  { cols: 21, rows: 15, loop: 0.16, lava: 6, crushers: 2, chaser: false },
  { cols: 23, rows: 15, loop: 0.14, lava: 7, crushers: 2, chaser: true },
  { cols: 25, rows: 17, loop: 0.12, lava: 8, crushers: 3, chaser: true },
];

/** A one-line description of what a tier throws at you. */
function describeTier(i) {
  const t = TIERS[Math.min(i, TIERS.length - 1)];
  const bits = [`${t.cols}×${t.rows}`];
  if (t.lava) bits.push(`${t.lava} lava`);
  if (t.crushers) bits.push(`${t.crushers} crusher${t.crushers > 1 ? 's' : ''}`);
  if (t.chaser) bits.push('a chaser');
  return bits.join(' · ');
}

/**
 * Build a complete, never-before-seen level for a difficulty tier.
 * Same shape as the hand-made entries in js/levels.js.
 */
function proceduralLevel(tierIndex, seed) {
  const t = TIERS[Math.min(tierIndex, TIERS.length - 1)];
  const rng = makeRng(seed);

  let rows = generateMaze(t.cols, t.rows, t.loop, rng);
  if (t.lava) rows = addLava(rows, t.lava, rng);

  const movers = [];
  if (t.crushers) {
    const lanes = findCrusherLanes(rows, 5);
    for (let i = 0; i < t.crushers && lanes.length; i++) {
      const lane = lanes.splice((rng() * lanes.length) | 0, 1)[0];
      movers.push({
        kind: 'crusher',
        from: lane.from,
        to: lane.to,
        speed: 0.055 + rng() * 0.03,
        phase: rng(),
      });
    }
  }
  if (t.chaser) {
    // Park it well away from the start, or the first few ticks are a massacre
    // and nothing gets far enough to be worth selecting.
    const cells = openCells(rows).filter(([x, y]) => x + y > (t.cols + t.rows) * 0.4);
    if (cells.length) {
      const [x, y] = cells[(rng() * cells.length) | 0];
      movers.push({ kind: 'chaser', at: [x, y], speed: 0.075 });
    }
  }

  return {
    name: `∞ · Tier ${tierIndex + 1}`,
    note: `A maze nobody has seen before: ${describeTier(tierIndex)}. `
        + 'A new one is generated every generation, so there is no route to '
        + 'memorise — the escape rate is measured entirely on unseen mazes.',
    rows,
    movers,
    procedural: true,
    tier: tierIndex,
    seed,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    makeRng, generateMaze, addLava, findCrusherLanes,
    proceduralLevel, describeTier, TIERS,
  };
}
