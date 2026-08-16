#!/usr/bin/env node
/*
 * Make a new maze and print it as ASCII, ready to paste into js/levels.js.
 *
 *   node tools/gen-maze.js                 # 21x15, a few loops
 *   node tools/gen-maze.js 31 21           # bigger
 *   node tools/gen-maze.js 31 21 0         # 0 loops = perfect maze, one route
 *   node tools/gen-maze.js 31 21 0.15 1234 # fixed seed, same maze every time
 *
 * Args: <cols> <rows> <loopiness 0..1> <seed>
 * cols/rows are in cells and get rounded up to odd numbers (walls need to
 * land in between).
 */

function makeRng(seed) {
  // mulberry32 — small, fast, and deterministic given a seed
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(cols, rows, loopiness, seed) {
  const w = cols % 2 === 0 ? cols + 1 : cols;
  const h = rows % 2 === 0 ? rows + 1 : rows;
  const rng = makeRng(seed);

  // Start solid, then carve. Odd coordinates are cells, even ones are the
  // walls between them.
  const grid = Array.from({ length: h }, () => new Array(w).fill('#'));

  const stack = [[1, 1]];
  grid[1][1] = '.';
  const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];

  // Recursive backtracker: walk to a random unvisited neighbour, knocking out
  // the wall on the way, and reverse out when boxed in. Produces long winding
  // corridors with plenty of dead ends, which is exactly what we want to be
  // hard for a reactive agent.
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

  // Knock out some extra walls to create loops. A perfect maze has exactly one
  // route to the exit, which makes for a brutal search problem; a few loops
  // gives the population more than one thing to find.
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

const [, , aCols, aRows, aLoop, aSeed] = process.argv;
const cols = parseInt(aCols || '21', 10);
const rows = parseInt(aRows || '15', 10);
const loop = aLoop === undefined ? 0.08 : parseFloat(aLoop);
const seed = parseInt(aSeed || String((Math.random() * 1e9) | 0), 10);

const maze = generate(cols, rows, loop, seed);
console.error(`// ${maze[0].length}x${maze.length}, loopiness ${loop}, seed ${seed}`);
console.log(maze.map(r => `    '${r}',`).join('\n'));

module.exports = { generate, makeRng };
